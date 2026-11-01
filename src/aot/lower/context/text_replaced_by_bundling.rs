use bun_sema::atom::Interner;
use bun_sema::bind::{Bound, Parent};
use bun_sema::erasure::ReplacedText;
use bun_sema::fold::{Constant, Decision, Decisions};
use bun_sema::hir::{
    BinOp, Branches, ExprId, ExprKind, File, PropKind, StmtKind, UnOp, end_of_expr,
    start_inside_parentheses, start_of,
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
    };
    finder.add_branches_of_statements();
    finder.add_expressions();
    finder.replaced
}

struct Finder<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    atoms: &'a Interner<'s>,
    // `FileLowering::find_operand_printed_alone`
    find_operand_printed_alone: &'a dyn Fn(ExprId) -> Option<ExprId>,
    replaced: Vec<ReplacedText>,
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
                    op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                    left,
                    right,
                } => {
                    if decisions.is_dead_expr(right) {
                        self.leave_out(end_of_expr(hir, left), end_of_expr(hir, right));
                    } else if self.is_always_right_operand(op, left) {
                        let start = start_inside_parentheses(hir, expression);
                        self.leave_out(start, start_of(hir, right));
                    }
                }
                ExprKind::Cond { branches, .. } => {
                    let Branches { yes, no } = hir.branches(branches);
                    let kept = match (decisions.is_dead_expr(yes), decisions.is_dead_expr(no)) {
                        (true, false) => no,
                        (false, true) => yes,
                        _ => continue,
                    };
                    let (start, end) = (
                        start_inside_parentheses(hir, expression),
                        hir[expression].end,
                    );
                    // Of `a ? b : c ? d : b` with `a` and `c` false `bun run` prints the first `b`. An error quotes what stands there, so that one is kept.
                    let printed =
                        (self.find_operand_printed_alone)(expression).filter(|&printed| {
                            start <= start_of(hir, printed) && end_of_expr(hir, printed) <= end
                        });
                    let kept = printed.unwrap_or(kept);
                    self.leave_out(start, start_of(hir, kept));
                    self.leave_out(end_of_expr(hir, kept), end);
                }
                ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
                    if !shorthand_values.contains(&expression)
                        && !self.is_object_of_defined_member(expression) =>
                {
                    self.add_defined(expression, decisions.decision(expression));
                }
                _ => {}
            }
        }
    }

    // `CONFIG.a` with a value in its place is printed as that value, without the value of `CONFIG`.
    fn is_object_of_defined_member(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut object = expression;
        while let Parent::Expr(parent) = self.bound.parent_of_expr(object) {
            if hir.type_assertion_operand(parent).is_some() {
                object = parent;
                continue;
            }
            let is_object = matches!(
                hir[parent].kind,
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == object
            );
            let is_defined = !matches!(
                self.decisions.decision(parent),
                Decision::Unknown | Decision::DeferredData
            );
            return is_object && is_defined;
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
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
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
        if let Some(printed) = self.print(decision)
            && written.is_some_and(|written| written != &printed[..])
        {
            self.replace(start, end, printed.into_boxed_slice());
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
