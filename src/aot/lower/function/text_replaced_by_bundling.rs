use bun_sema::atom::{Interner, known};
use bun_sema::bind::{Binding, Bound, FnOwner, Parent};
use bun_sema::erasure::ReplacedText;
use bun_sema::fold::{Constant, Decision, Decisions};
use bun_sema::hir::{
    BinOp, Branches, ExprId, ExprKind, File, FnBody, FnKind, PropKind, StmtId, StmtKind, UnOp,
    end_of_expr, is_parenthesized, start_inside_parentheses, start_of,
};
use bun_sema::hir_from_data::DataValue;
use rustc_hash::{FxHashMap, FxHashSet};

/// What `bun build` prints differently from the source because its parser knows a value: branches that never run, and names that a define replaces.
/// This build knows more, such as the constants of other files. What only it removes stays in the text, as it stays in a bundle.
/// It starts at what folding has decided and at what is dead, and goes up from there: a file without either is not looked at.
pub(super) fn find_text_replaced_by_bundling<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    decisions: &Decisions<'s>,
    atoms: &Interner<'s>,
) -> Vec<ReplacedText> {
    let mut finder = Finder {
        hir,
        bound,
        decisions: &decisions.as_folded_by_bun_run(),
        atoms,
        replaced: Vec::new(),
        kept_alone: FxHashMap::default(),
        printed_as_constants: FxHashMap::default(),
        opened: FxHashSet::default(),
        defined_at_heads: FxHashSet::default(),
    };
    finder.add_branches_of_statements();
    let folded = finder.find_operators_printed_as_one_operand();
    finder.add_parentheses_at_heads(&folded);
    for &expression in &folded {
        finder.add_operator_printed_as_one_operand(expression);
    }
    finder.add_defined_names();
    finder.replaced
}

struct Finder<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    atoms: &'a Interner<'s>,
    replaced: Vec<ReplacedText>,
    // `true ? a : b`, `true && a`, `false || a` and `null ?? a`, each with the operand that is printed in place of all of it.
    kept_alone: FxHashMap<ExprId, ExprId>,
    // The operators in whose place a constant is printed: `true && false`, `false && f()`.
    printed_as_constants: FxHashMap<ExprId, Constant>,
    // Of these only an operand is kept, and `(` is printed in front of it.
    opened: FxHashSet<ExprId>,
    // Names that a define replaces, with which a statement or the body of an arrow function starts.
    defined_at_heads: FxHashSet<ExprId>,
}

impl Finder<'_, '_> {
    fn replace(&mut self, start: u32, end: u32, text: Box<[u8]>) {
        if start < end || !text.is_empty() {
            self.replaced.push(ReplacedText { start, end, text });
        }
    }

    fn leave_out(&mut self, start: u32, end: u32) {
        self.replace(start, end, Box::default());
    }

    fn byte_at(&self, offset: u32) -> Option<u8> {
        self.hir.text.get(offset as usize).copied()
    }

    // `if (false) f();` stays `if (false) ;`, `if (false) { f(); }` stays `if (false) {}`, and an `else` that never runs goes.
    fn add_branches_of_statements(&mut self) {
        let (hir, bound, decisions) = (self.hir, self.bound, self.decisions);
        for branch in decisions.dead_stmts() {
            let Parent::Stmt(statement) = bound.parent_of_stmt(branch) else {
                continue;
            };
            let StmtKind::If { yes, no, .. } = hir[statement].kind else {
                continue;
            };
            // What stands in a dead branch goes with it.
            if decisions.is_dead_stmt(statement) {
                continue;
            }
            if branch == no {
                self.leave_out(hir[yes].loc.end, hir[no].loc.end);
                continue;
            }
            let (start, end) = (hir[yes].start, hir[yes].loc.end);
            match hir[yes].kind {
                StmtKind::Block(_) => self.leave_out(start + 1, end - 1),
                _ if hir.text.get(end as usize - 1) == Some(&b';') => {
                    self.leave_out(start, end - 1);
                }
                _ => {}
            }
        }
    }

    /// The operators of which `bun build` prints one operand alone, an operand before the operator around it. What is asked about one of them later is answered out of two tables.
    fn find_operators_printed_as_one_operand(&mut self) -> Vec<ExprId> {
        let (hir, bound, decisions) = (self.hir, self.bound, self.decisions);
        let dead = decisions.dead_exprs();
        let above_dead_operands = dead.filter_map(|operand| match bound.parent_of_expr(operand) {
            Parent::Expr(expression) => Some(expression),
            _ => None,
        });
        let goes_on = decisions.operators_that_go_on_to_the_right();
        // What stands in a dead operand goes with it.
        let mut folded: Vec<ExprId> = above_dead_operands
            .chain(goes_on.iter().copied())
            .filter(|&expression| !decisions.is_dead_expr(expression))
            .collect();
        folded.sort_unstable();
        folded.dedup();
        folded.retain(|&expression| {
            let printed = match hir[expression].kind {
                ExprKind::Binary {
                    op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                    left,
                    right,
                } => match decisions.is_dead_expr(right) {
                    true => Some(left),
                    false => self.is_always_right_operand(op, left).then_some(right),
                },
                ExprKind::Cond { branches, .. } => {
                    let Branches { yes, no } = hir.branches(branches);
                    match (decisions.is_dead_expr(yes), decisions.is_dead_expr(no)) {
                        (true, false) => Some(no),
                        (false, true) => Some(yes),
                        _ => None,
                    }
                }
                _ => None,
            };
            let Some(printed) = printed else {
                return false;
            };
            if !matches!(hir[expression].kind, ExprKind::Binary { left, .. } if left == printed) {
                self.kept_alone.insert(expression, printed);
            }
            if let Some(constant) = self.find_written_or_defined(printed) {
                self.printed_as_constants.insert(expression, constant);
            }
            true
        });
        folded
    }

    // The operand that is printed in place of all of `true ? a : b`, `true && a`, `false || a` and `null ?? a`.
    fn find_operand_kept(&self, expression: ExprId) -> Option<ExprId> {
        self.kept_alone.get(&expression).copied()
    }

    fn add_operator_printed_as_one_operand(&mut self, expression: ExprId) {
        let hir = self.hir;
        let Some(kept) = self.find_operand_kept(expression) else {
            // `false && f()` stays `false`.
            if let ExprKind::Binary { left, right, .. } = hir[expression].kind {
                self.leave_out(end_of_expr(hir, left), end_of_expr(hir, right));
            }
            return;
        };
        let in_front: &[u8] = if self.opened.contains(&expression) {
            b"("
        } else if self.would_be_reference(expression, kept) {
            b"0, "
        } else {
            b""
        };
        let start = start_inside_parentheses(hir, expression);
        self.replace(start, start_of(hir, kept), in_front.into());
        self.leave_out(end_of_expr(hir, kept), hir[expression].end);
        for operator in self.find_operators_that_would_end_head_of_loop(expression, kept) {
            let (start, end) = (start_of(hir, operator), end_of_expr(hir, operator));
            self.replace(start, start, Box::new(*b"("));
            self.replace(end, end, Box::new(*b")"));
        }
    }

    // At the head of a statement or of the body of an arrow function `{ a }` alone is a block, and at the head of a statement `function` and `class` start a declaration. `bun build` prints `({ a })`.
    // Only what has lost an operator in front of it, or stands where a name stood, has come to stand at a head.
    fn add_parentheses_at_heads(&mut self, folded: &[ExprId]) {
        let decided = self.decisions.decided().iter();
        let defined = decided.filter(|entry| matches!(entry.1, Decision::Data(_)));
        let mut passed = FxHashSet::default();
        let heads: Vec<(ExprId, bool)> = (folded.iter().copied())
            .chain(defined.map(|entry| entry.0))
            .filter_map(|expression| self.find_head_that_starts_with(expression, &mut passed))
            .collect();
        for (head, is_statement) in heads {
            self.add_parentheses_at_head(head, is_statement);
        }
    }

    /// The expression that is a whole statement, or the whole body of an arrow function, and whose printed text starts with that of `first`. With it: whether it is a statement.
    /// `passed`: where an earlier search has come by. What lies above has been answered.
    fn find_head_that_starts_with(
        &self,
        mut first: ExprId,
        passed: &mut FxHashSet<ExprId>,
    ) -> Option<(ExprId, bool)> {
        let (hir, bound) = (self.hir, self.bound);
        while !is_parenthesized(hir, first) && passed.insert(first) {
            match bound.parent_of_expr(first) {
                Parent::Expr(parent) => {
                    let first_of_parent = match self.find_operand_kept(parent) {
                        Some(kept) => Some(kept),
                        None => find_first_operand(hir, parent),
                    };
                    if first_of_parent != Some(first) {
                        return None;
                    }
                    first = parent;
                }
                Parent::Stmt(statement) => {
                    let is_whole = matches!(hir[statement].kind, StmtKind::Expr(_));
                    return (is_whole && !self.is_head_of_loop(statement)).then_some((first, true));
                }
                Parent::FnBody(function) => {
                    let is_body = matches!(hir[function].body, FnBody::Expr(body) if body == first);
                    return is_body.then_some((first, false));
                }
                _ => return None,
            }
        }
        None
    }

    // The first part of `for (;;)`.
    fn is_head_of_loop(&self, statement: StmtId) -> bool {
        matches!(
            self.bound.parent_of_stmt(statement),
            Parent::Stmt(parent) if matches!(self.hir[parent].kind, StmtKind::For { init, .. } if init == statement)
        )
    }

    fn add_parentheses_at_head(&mut self, mut first: ExprId, is_statement: bool) {
        let hir = self.hir;
        let mut folded = None;
        let mut assignment = None;
        while !is_parenthesized(hir, first) {
            if let Some(kept) = self.find_operand_kept(first) {
                (folded, assignment, first) = (Some(first), None, kept);
                continue;
            }
            if matches!(self.decisions.decision(first), Decision::Data(_)) {
                self.defined_at_heads.insert(first);
                return;
            }
            let needs_parentheses = match hir[first].kind {
                ExprKind::Object(_) => true,
                ExprKind::Fn(function) => is_statement && hir[function].kind != FnKind::Arrow,
                ExprKind::Class(_) => is_statement,
                _ => false,
            };
            if let (true, Some(folded)) = (needs_parentheses, folded) {
                let end = hir[assignment.unwrap_or(first)].end;
                self.opened.insert(folded);
                self.replace(end, end, Box::new(*b")"));
                return;
            }
            // `({ a } = b)`
            assignment = match hir[first].kind {
                ExprKind::Assign { .. } => Some(first),
                _ => None,
            };
            match find_first_operand(hir, first) {
                Some(operand) => first = operand,
                None => return,
            }
        }
    }

    // `(true ? o.m : 0)()` calls the function without `o`, and `(o.m)()` would call it on `o`. `bun build` prints `(0, o.m)()`.
    fn would_be_reference(&self, expression: ExprId, mut kept: ExprId) -> bool {
        let hir = self.hir;
        let Parent::Expr(parent) = self.bound.parent_of_expr(expression) else {
            return false;
        };
        let user = hir[parent].kind;
        let is_callee = matches!(
            user,
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) if hir[call].callee == expression
        );
        while let Some(operand) = self.find_operand_kept(kept) {
            kept = operand;
        }
        match (hir[kept].kind, user) {
            (ExprKind::Dot { .. } | ExprKind::Index { .. }, ExprKind::Unary { op, .. }) => {
                op == UnOp::Delete
            }
            (ExprKind::Dot { .. } | ExprKind::Index { .. }, _) => is_callee,
            // `eval(..)` sees the variables around the call, and `typeof` of a name that nothing declares does not throw.
            (ExprKind::Ident(name), ExprKind::Call(_)) => is_callee && name == known::eval,
            (ExprKind::Ident(_), ExprKind::Unary { op, .. }) => {
                op == UnOp::Typeof && self.bound.binding(kept) == Binding::Free
            }
            _ => false,
        }
    }

    // `for (let i = true ? "a" in o : 0; ..)`: between `?` and `:` an `in` is an operator, and without them it would make this a `for (.. in ..)`. `bun build` prints `("a" in o)`.
    fn find_operators_that_would_end_head_of_loop(
        &self,
        expression: ExprId,
        kept: ExprId,
    ) -> Vec<ExprId> {
        let hir = self.hir;
        let mut found = Vec::new();
        if !matches!(hir[expression].kind, ExprKind::Cond { .. }) {
            return found;
        }
        let mut operands = vec![kept];
        while let Some(operand) = operands.pop() {
            if is_parenthesized(hir, operand) {
                continue;
            }
            match hir[operand].kind {
                ExprKind::Binary { op: BinOp::In, .. } => found.push(operand),
                // It looks into its own operand.
                ExprKind::Cond { .. } if self.kept_alone.contains_key(&operand) => {}
                ExprKind::Binary { left, right, .. } => operands.extend([left, right]),
                ExprKind::Assign { value, .. } => operands.push(value),
                ExprKind::Cond { test, branches } => {
                    operands.extend([test, hir.branches(branches).no]);
                }
                ExprKind::Unary { operand, .. }
                | ExprKind::Await(operand)
                | ExprKind::Spread(operand)
                | ExprKind::Yield { value: operand, .. } => operands.push(operand),
                ExprKind::Fn(function) => {
                    if let FnBody::Expr(body) = hir[function].body {
                        operands.push(body);
                    }
                }
                _ => {}
            }
        }
        if !found.is_empty() && !self.stands_open_in_head_of_loop(expression) {
            found.clear();
        }
        found
    }

    // Nothing that closes lies between the expression and the head: no parentheses, brackets or braces, and no `?` with its `:`.
    fn stands_open_in_head_of_loop(&self, mut expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        while !is_parenthesized(hir, expression) {
            let parent = match bound.parent_of_expr(expression) {
                Parent::Expr(parent) => parent,
                Parent::FnBody(function) => match bound.fns[function.idx()].owner {
                    FnOwner::Expr(arrow) => arrow,
                    _ => return false,
                },
                Parent::VarInit(declaration) => {
                    return self.is_head_of_loop(bound.var_stmt[declaration.idx()]);
                }
                Parent::Stmt(statement) => return self.is_head_of_loop(statement),
                _ => return false,
            };
            let is_open = match hir[parent].kind {
                ExprKind::Binary { .. }
                | ExprKind::Unary { .. }
                | ExprKind::Await(_)
                | ExprKind::Yield { .. }
                | ExprKind::Fn(_) => true,
                ExprKind::Assign { value, .. } => value == expression,
                ExprKind::Cond { branches, .. } => hir.branches(branches).yes != expression,
                _ => hir.type_assertion_operand(parent) == Some(expression),
            };
            if !is_open {
                return false;
            }
            expression = parent;
        }
        false
    }

    // `true && f()` is printed as `f()`.
    fn is_always_right_operand(&self, op: BinOp, left: ExprId) -> bool {
        let Some(left) = self.find_written_or_defined(left) else {
            return false;
        };
        match op {
            BinOp::And => self.is_truthy(left) == Some(true),
            BinOp::Or => self.is_truthy(left) == Some(false),
            _ => matches!(left, Constant::Undefined | Constant::Null),
        }
    }

    fn find_written_or_defined(&self, expression: ExprId) -> Option<Constant> {
        match self.hir[expression].kind {
            ExprKind::Null => Some(Constant::Null),
            ExprKind::True => Some(Constant::Boolean(true)),
            ExprKind::False => Some(Constant::Boolean(false)),
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => {
                let operand = self.find_written_or_defined(operand)?;
                Some(Constant::Boolean(!self.is_truthy(operand)?))
            }
            ExprKind::Ident(_) | ExprKind::Dot { .. } => {
                match self.decisions.decision(expression) {
                    Decision::Constant(constant) => Some(constant),
                    _ => None,
                }
            }
            ExprKind::Binary { .. } | ExprKind::Cond { .. } => {
                self.printed_as_constants.get(&expression).copied()
            }
            _ => None,
        }
    }

    fn add_defined_names(&mut self) {
        let (hir, bound, decisions) = (self.hir, self.bound, self.decisions);
        for &(expression, decision) in decisions.decided() {
            if !matches!(
                hir[expression].kind,
                ExprKind::Ident(_) | ExprKind::Dot { .. }
            ) {
                continue;
            }
            let is_shorthand = matches!(
                bound.parent_of_expr(expression),
                Parent::Prop(property) if hir[property].kind == PropKind::Shorthand
            );
            if !is_shorthand {
                self.add_defined(expression, decision);
            } else if let Some(printed) = self.print(decision) {
                // `{ DEFINED }` is printed as `{ DEFINED: false }`.
                let end = hir[expression].end;
                self.replace(end, end, [b": ", &printed[..]].concat().into_boxed_slice());
            }
        }
    }

    // `!DEFINED` is printed as its value too.
    fn add_defined(&mut self, mut expression: ExprId, mut decision: Decision<'_>) {
        while let Decision::Constant(constant) = decision
            && let Parent::Expr(parent) = self.bound.parent_of_expr(expression)
            && let ExprKind::Unary { op: UnOp::Not, .. } = self.hir[parent].kind
            && let Some(is_truthy) = self.is_truthy(constant)
        {
            expression = parent;
            decision = Decision::Constant(Constant::Boolean(!is_truthy));
        }
        let start = start_inside_parentheses(self.hir, expression);
        let end = self.hir[expression].end;
        let written = self.hir.text.get(start as usize..end as usize);
        if let Some(mut printed) = self.print(decision)
            && written.is_some_and(|written| written != &printed[..])
        {
            let in_front = self.byte_at(start.wrapping_sub(1));
            if self.needs_parentheses(expression, &printed) {
                printed = [b"(", &printed[..], b")"].concat();
            } else if printed.starts_with(b"-") && in_front == Some(b'-') {
                // `1-NEGATIVE`: `--` is another operator.
                printed.insert(0, b' ');
            } else if printed.iter().all(u8::is_ascii_digit) && self.byte_at(end) == Some(b'.') {
                // `WHOLE.toFixed()`: `5.` is all of a number.
                printed.push(b' ');
            }
            self.replace(start, end, printed.into_boxed_slice());
        }
    }

    // Where a name stood: `{ a: 1 }` at a head is a block, `-1 ** 2` is no expression, and `-1.toFixed()` negates the text.
    fn needs_parentheses(&self, expression: ExprId, printed: &[u8]) -> bool {
        let hir = self.hir;
        if is_parenthesized(hir, expression) {
            return false;
        }
        let parent = match self.bound.parent_of_expr(expression) {
            Parent::Expr(parent) => hir[parent].kind,
            _ => ExprKind::Missing,
        };
        match printed.first() {
            Some(b'{') => self.defined_at_heads.contains(&expression),
            Some(b'-') => match parent {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj == expression,
                ExprKind::Binary { op, left, .. } => op == BinOp::Pow && left == expression,
                _ => false,
            },
            _ => false,
        }
    }

    fn is_truthy(&self, constant: Constant) -> Option<bool> {
        Some(match constant {
            Constant::Undefined | Constant::Null => false,
            Constant::Boolean(value) => value,
            Constant::Number(number) => number != 0.0 && !number.is_nan(),
            Constant::String(text) => !self.atoms.bytes(text).is_empty(),
            Constant::BigInt(_) => return None,
        })
    }

    // As `bun build` prints it. None: it stays as it is written.
    fn print(&self, decision: Decision<'_>) -> Option<Vec<u8>> {
        let mut printed = Vec::new();
        match decision {
            Decision::Constant(constant) => {
                self.print_data(constant.to_data_value(), &mut printed)?;
            }
            Decision::Data(data) => self.print_data(*data, &mut printed)?,
            Decision::GlobalPath(path) => {
                let names: Vec<&[u8]> = path.iter().map(|&name| self.atoms.bytes(name)).collect();
                printed = names.join(&b'.');
            }
            Decision::Unknown | Decision::DeferredData => return None,
        }
        Some(printed)
    }

    fn print_data(&self, data: DataValue<'_>, printed: &mut Vec<u8>) -> Option<()> {
        match data {
            DataValue::Undefined => printed.extend_from_slice(b"undefined"),
            DataValue::Null => printed.extend_from_slice(b"null"),
            DataValue::Boolean(value) => printed.extend_from_slice(value.to_string().as_bytes()),
            // Where JavaScript writes a number without an exponent, as Rust does.
            DataValue::Number(number)
                if (1e-6..1e15).contains(&number.abs())
                    || (number == 0.0 && number.is_sign_positive()) =>
            {
                printed.extend_from_slice(number.to_string().as_bytes());
            }
            DataValue::Number(_) | DataValue::BigInt(_) => return None,
            DataValue::String(text) => print_string(self.atoms.bytes(text), true, printed)?,
            DataValue::Array(elements) => {
                printed.push(b'[');
                for (index, &element) in elements.iter().enumerate() {
                    if index > 0 {
                        printed.extend_from_slice(b", ");
                    }
                    self.print_data(element, printed)?;
                }
                printed.push(b']');
            }
            DataValue::Object([]) => printed.extend_from_slice(b"{}"),
            DataValue::Object(properties) => {
                printed.extend_from_slice(b"{ ");
                for (index, &(key, value)) in properties.iter().enumerate() {
                    if index > 0 {
                        printed.extend_from_slice(b", ");
                    }
                    let key = self.atoms.bytes(key);
                    match is_plain_identifier(key) {
                        true => printed.extend_from_slice(key),
                        false => print_string(key, false, printed)?,
                    }
                    printed.extend_from_slice(b": ");
                    self.print_data(value, printed)?;
                }
                printed.extend_from_slice(b" }");
            }
        }
        Some(())
    }
}

// The operand with whose first token the expression starts.
fn find_first_operand(hir: &File<'_>, expression: ExprId) -> Option<ExprId> {
    match hir[expression].kind {
        ExprKind::Dot { obj: first, .. }
        | ExprKind::Index { obj: first, .. }
        | ExprKind::Binary { left: first, .. }
        | ExprKind::Assign { target: first, .. }
        | ExprKind::Cond { test: first, .. }
        | ExprKind::Unary {
            op: UnOp::PostInc | UnOp::PostDec,
            operand: first,
        }
        | ExprKind::As { expr: first, .. }
        | ExprKind::Satisfies { expr: first, .. }
        | ExprKind::Instantiation { expr: first, .. }
        | ExprKind::AsConst(first)
        | ExprKind::NonNull(first) => Some(first),
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => Some(hir[call].callee),
        _ => None,
    }
}

fn is_plain_identifier(name: &[u8]) -> bool {
    let is_start = |byte: u8| byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$');
    match name {
        [first, rest @ ..] => {
            is_start(*first)
                && rest
                    .iter()
                    .all(|&byte| is_start(byte) || byte.is_ascii_digit())
        }
        [] => false,
    }
}

// `best_quote_char_for_string` of the printer, and its escapes. None: a control character, or no UTF-8.
fn print_string(text: &[u8], allows_backtick: bool, printed: &mut Vec<u8>) -> Option<()> {
    let text = core::str::from_utf8(text).ok()?;
    let count = |wanted: u8| text.bytes().filter(|&byte| byte == wanted).count();
    let (single, double) = (count(b'\''), count(b'"'));
    let pairs = text.bytes().zip(text.bytes().skip(1));
    let backtick = count(b'`') + pairs.filter(|&pair| pair == (b'$', b'{')).count();
    let quote = match () {
        () if allows_backtick && backtick < single.min(double) => '`',
        () if single < double => '\'',
        () => '"',
    };
    let mut push = |part: &str| printed.extend_from_slice(part.as_bytes());
    push(quote.encode_utf8(&mut [0; 4]));
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        let code = u32::from(character);
        match character {
            '\\' => push("\\\\"),
            '$' if quote == '`' && characters.peek() == Some(&'{') => push("\\$"),
            _ if character == quote => push(&format!("\\{character}")),
            ' '..='~' => push(character.encode_utf8(&mut [0; 4])),
            _ if code < 0xA0 => return None,
            _ if code <= 0xFF => push(&format!("\\x{code:02X}")),
            _ => {
                for unit in character.encode_utf16(&mut [0; 2]) {
                    push(&format!("\\u{unit:04X}"));
                }
            }
        }
    }
    push(quote.encode_utf8(&mut [0; 4]));
    Some(())
}
