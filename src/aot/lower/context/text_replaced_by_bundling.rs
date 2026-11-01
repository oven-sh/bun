use bun_sema::atom::Interner;
use bun_sema::bind::{Bound, Parent};
use bun_sema::erasure::ReplacedText;
use bun_sema::fold::{Constant, Decision, Decisions};
use bun_sema::hir::{
    BinOp, Branches, ExprId, ExprKind, File, FnBody, FnKind, PropKind, StmtId, StmtKind, UnOp,
    end_of_expr, is_parenthesized, start_inside_parentheses, start_of,
};
use bun_sema::hir_from_data::DataValue;
use rustc_hash::FxHashSet;

/// What `bun build` prints differently from the source because its parser knows a value: branches that never run, and names that a define replaces.
/// This build knows more, such as the constants of other files. What only it removes stays in the text, as it stays in a bundle.
pub(super) fn find_text_replaced_by_bundling<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    decisions: &Decisions<'s>,
    atoms: &Interner<'s>,
    find_operand_printed_alone: &dyn Fn(ExprId) -> Option<ExprId>,
) -> Vec<ReplacedText> {
    let mut finder = Finder {
        hir,
        bound,
        decisions: &decisions.as_folded_by_bun_run(),
        atoms,
        find_operand_printed_alone,
        replaced: Vec::new(),
        opened: FxHashSet::default(),
        defined_at_heads: FxHashSet::default(),
        heads_of_loops: Vec::new(),
    };
    finder.add_branches_of_statements();
    finder.add_parentheses_at_heads();
    finder.add_expressions();
    join_text_to_part_in_front(finder.replaced)
}

// Text that is only added goes with a part that is left out right in front of it, and would be written into a text there that is longer than what it replaces.
fn join_text_to_part_in_front(mut replaced: Vec<ReplacedText>) -> Vec<ReplacedText> {
    replaced.sort_by_key(|part| (part.start, part.end));
    let mut joined: Vec<ReplacedText> = Vec::with_capacity(replaced.len());
    for part in replaced {
        match joined.last_mut() {
            Some(last) if last.end == part.start && part.start == part.end => {
                last.text = [&last.text[..], &part.text[..]].concat().into_boxed_slice();
            }
            _ => joined.push(part),
        }
    }
    joined
}

struct Finder<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    atoms: &'a Interner<'s>,
    // `FileLowering::find_operand_printed_alone`
    find_operand_printed_alone: &'a dyn Fn(ExprId) -> Option<ExprId>,
    replaced: Vec<ReplacedText>,
    // Of these only an operand is kept, and `(` is printed in front of it.
    opened: FxHashSet<ExprId>,
    // Names that a define replaces, with which a statement or the body of an arrow function starts.
    defined_at_heads: FxHashSet<ExprId>,
    // Where the first part of the head of each `for (;;)` starts, in order, and the furthest end of those up to it.
    heads_of_loops: Vec<(u32, u32)>,
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

    // `if (false) f();` stays `if (false) ;`, `if (false) { f(); }` stays `if (false) {}`, and an `else` that never runs goes.
    fn add_branches_of_statements(&mut self) {
        let (hir, decisions) = (self.hir, self.decisions);
        for statement in hir.stmts.iter() {
            let StmtKind::If { yes, no, .. } = statement.kind else {
                continue;
            };
            if no.is_some() && decisions.is_dead_stmt(no) {
                self.leave_out(hir[yes].loc.end, hir[no].loc.end);
            }
            if !decisions.is_dead_stmt(yes) {
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

    fn add_expressions(&mut self) {
        let (hir, decisions) = (self.hir, self.decisions);
        // `{ DEFINED }` is printed as `{ DEFINED: false }`.
        let mut shorthand_values: FxHashSet<ExprId> = FxHashSet::default();
        for property in hir.props.iter() {
            if property.kind != PropKind::Shorthand {
                continue;
            }
            let decision = decisions.decision(property.value);
            if !matches!(decision, Decision::Unknown) {
                shorthand_values.insert(property.value);
            }
            if let Some(printed) = self.print(decision) {
                let end = hir[property.value].end;
                self.replace(end, end, [b": ", &printed[..]].concat().into_boxed_slice());
            }
        }
        for index in 0..hir.exprs.len() {
            let expression = ExprId(index as u32);
            match hir[expression].kind {
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    left,
                    right,
                } if decisions.is_dead_expr(right) => {
                    self.leave_out(end_of_expr(hir, left), end_of_expr(hir, right));
                }
                ExprKind::Binary { .. } | ExprKind::Cond { .. } => {
                    if let Some(kept) = self.find_operand_kept(expression) {
                        self.keep_alone(expression, kept);
                    }
                }
                ExprKind::Ident(_) | ExprKind::Dot { .. }
                    if !shorthand_values.contains(&expression) =>
                {
                    self.add_defined(expression, decisions.decision(expression));
                }
                _ => {}
            }
        }
    }

    // The operand that is printed in place of all of `true ? a : b`, `true && a`, `false || a` and `null ?? a`.
    fn find_operand_kept(&self, expression: ExprId) -> Option<ExprId> {
        let (hir, decisions) = (self.hir, self.decisions);
        match hir[expression].kind {
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                left,
                right,
            } => {
                let is_kept = !decisions.is_dead_expr(right);
                (is_kept && self.is_always_right_operand(op, left)).then_some(right)
            }
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                let kept = match (decisions.is_dead_expr(yes), decisions.is_dead_expr(no)) {
                    (true, false) => no,
                    (false, true) => yes,
                    _ => return None,
                };
                let (start, end) = (
                    start_inside_parentheses(hir, expression),
                    hir[expression].end,
                );
                // Of `a ? b : c ? d : b` with `a` and `c` false `bun run` prints the first `b`. An error quotes what stands there, so that one is kept.
                let printed = (self.find_operand_printed_alone)(expression).filter(|&printed| {
                    start <= start_of(hir, printed) && end_of_expr(hir, printed) <= end
                });
                Some(printed.unwrap_or(kept))
            }
            _ => None,
        }
    }

    // What is printed in front of the operand stands in place of what is left out there: text that is only added behind a part that goes would go with it.
    fn keep_alone(&mut self, expression: ExprId, kept: ExprId) {
        let hir = self.hir;
        let end_of_kept = end_of_expr(hir, kept);
        let in_front: &[u8] = if self.opened.contains(&expression) {
            b"("
        } else if self.would_be_reference(expression, kept) {
            b"0, "
        } else if self.would_end_head_of_loop(expression, kept) {
            self.replace(end_of_kept, end_of_kept, Box::new(*b")"));
            b"("
        } else {
            b""
        };
        let start = start_inside_parentheses(hir, expression);
        self.replace(start, start_of(hir, kept), in_front.into());
        self.leave_out(end_of_kept, hir[expression].end);
    }

    // At the head of a statement or of the body of an arrow function `{ a }` alone is a block, and at the head of a statement `function` and `class` start a declaration. `bun build` prints `({ a })`.
    fn add_parentheses_at_heads(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for index in 0..hir.stmts.len() {
            let statement = StmtId(index as u32);
            match hir[statement].kind {
                StmtKind::Expr(expression) => {
                    let is_head_of_loop = matches!(
                        bound.parent_of_stmt(statement),
                        Parent::Stmt(parent) if matches!(hir[parent].kind, StmtKind::For { init, .. } if init == statement)
                    );
                    if !is_head_of_loop {
                        self.add_parentheses_at_head(expression, true);
                    }
                }
                StmtKind::For { init, .. } if init.is_some() => {
                    (self.heads_of_loops).push((hir[init].start, hir[init].loc.end));
                }
                _ => {}
            }
        }
        self.heads_of_loops.sort_unstable();
        let mut furthest = 0;
        for head in &mut self.heads_of_loops {
            furthest = furthest.max(head.1);
            head.1 = furthest;
        }
        for function in hir.fns.iter() {
            if let (FnKind::Arrow, FnBody::Expr(body)) = (function.kind, function.body) {
                self.add_parentheses_at_head(body, false);
            }
        }
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
        let (takes_member, takes_name) = match hir[parent].kind {
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => {
                let is_callee = hir[call].callee == expression;
                (is_callee, is_callee)
            }
            ExprKind::Unary { op, .. } => (op == UnOp::Delete, op == UnOp::Typeof),
            _ => return false,
        };
        while let Some(operand) = self.find_operand_kept(kept) {
            kept = operand;
        }
        match hir[kept].kind {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => takes_member,
            ExprKind::Ident(_) => takes_name,
            _ => false,
        }
    }

    // `for (let i = true ? "a" in o : 0; ..)`: between `?` and `:` an `in` is an operator, and without them it would make this a `for (.. in ..)`.
    fn would_end_head_of_loop(&self, expression: ExprId, kept: ExprId) -> bool {
        let hir = self.hir;
        let start = hir[expression].pos;
        let heads_in_front = (self.heads_of_loops).partition_point(|head| head.0 <= start);
        let is_in_head = heads_in_front
            .checked_sub(1)
            .is_some_and(|last| start < self.heads_of_loops[last].1);
        if !is_in_head || !matches!(hir[expression].kind, ExprKind::Cond { .. }) {
            return false;
        }
        let mut operands = vec![kept];
        while let Some(operand) = operands.pop() {
            if is_parenthesized(hir, operand) {
                continue;
            }
            match hir[operand].kind {
                ExprKind::Binary { op: BinOp::In, .. } => return true,
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
            _ => None,
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
            if self.needs_parentheses(expression, &printed) {
                printed = [b"(", &printed[..], b")"].concat();
            }
            self.replace(start, end, printed.into_boxed_slice());
        }
    }

    // Where a name stood: `{ a: 1 }` at a head is a block, `-1 ** 2` and `5.toFixed()` are no expressions, `-1.toFixed()` negates the text, and `--1` is another operator.
    fn needs_parentheses(&self, expression: ExprId, printed: &[u8]) -> bool {
        let hir = self.hir;
        if is_parenthesized(hir, expression) {
            return false;
        }
        let parent = match self.bound.parent_of_expr(expression) {
            Parent::Expr(parent) => hir[parent].kind,
            _ => ExprKind::Missing,
        };
        let is_object_of_name = matches!(parent, ExprKind::Dot { obj, .. } if obj == expression);
        match printed.first() {
            Some(b'{') => self.defined_at_heads.contains(&expression),
            Some(b'0'..=b'9') => is_object_of_name,
            Some(b'-') => {
                let in_front = (hir[expression].pos as usize).checked_sub(1);
                is_object_of_name
                    || in_front.and_then(|at| hir.text.get(at)) == Some(&b'-')
                    || matches!(parent, ExprKind::Index { obj, .. } if obj == expression)
                    || matches!(parent, ExprKind::Binary { op: BinOp::Pow, left, .. } if left == expression)
            }
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
