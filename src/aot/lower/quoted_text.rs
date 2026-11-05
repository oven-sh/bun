use bun_core::fmt::pow10_exp_1e4_to_1e9;
use bun_core::identifier::is_identifier;
use bun_core::printer::write_pre_quoted_string;
use bun_core::strings::{CodepointIterator, Cursor, Encoding, contains_char, index_of};
use bun_sema::atom::{Atom, known, written_name};
use bun_sema::bind::{FnOwner, Parent};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    BinOp, Call, Chain, ExprFlags, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, NameKind, PatId,
    PatKind, PropId, PropKey, PropKind, StmtId, StmtKind, UnOp, VarKind, end_of_expr, start_of,
};
use bun_sort_by_number::SortByNumber;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::{FileLowering, FunctionLowering};
use crate::ir::generated::QuotedText;
use crate::load::test_runner_names::{skip_to_written_use, written_name_of_local};

#[derive(Default)]
pub(in crate::lower) struct QuotedTexts {
    text: Vec<u8>,
    places: FxHashMap<ExprId, (u32, u32)>,
    is_printed: Vec<u64>,
    quoted: Vec<QuotedText>,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Level {
    Lowest,
    Comma,
    Spread,
    Yield,
    Assign,
    Conditional,
    NullishCoalescing,
    LogicalOr,
    LogicalAnd,
    BitwiseOr,
    BitwiseXor,
    BitwiseAnd,
    Equals,
    Compare,
    Shift,
    Add,
    Multiply,
    Exponentiation,
    Prefix,
    Postfix,
    New,
    Call,
}

impl Level {
    const ALL: [Level; 22] = [
        Level::Lowest,
        Level::Comma,
        Level::Spread,
        Level::Yield,
        Level::Assign,
        Level::Conditional,
        Level::NullishCoalescing,
        Level::LogicalOr,
        Level::LogicalAnd,
        Level::BitwiseOr,
        Level::BitwiseXor,
        Level::BitwiseAnd,
        Level::Equals,
        Level::Compare,
        Level::Shift,
        Level::Add,
        Level::Multiply,
        Level::Exponentiation,
        Level::Prefix,
        Level::Postfix,
        Level::New,
        Level::Call,
    ];

    fn below(self) -> Level {
        Level::ALL[(self as usize).saturating_sub(1)]
    }
}

#[derive(Copy, Clone, Default)]
struct Around {
    forbids_call: bool,
    start_of_new: Option<usize>,
    forbids_in: bool,
    has_parent_outside_chain: bool,
}

fn level_and_text_of(op: BinOp) -> (Level, &'static [u8]) {
    match op {
        BinOp::Add => (Level::Add, b"+"),
        BinOp::Sub => (Level::Add, b"-"),
        BinOp::Mul => (Level::Multiply, b"*"),
        BinOp::Div => (Level::Multiply, b"/"),
        BinOp::Rem => (Level::Multiply, b"%"),
        BinOp::Pow => (Level::Exponentiation, b"**"),
        BinOp::Shl => (Level::Shift, b"<<"),
        BinOp::Shr => (Level::Shift, b">>"),
        BinOp::UShr => (Level::Shift, b">>>"),
        BinOp::BitAnd => (Level::BitwiseAnd, b"&"),
        BinOp::BitOr => (Level::BitwiseOr, b"|"),
        BinOp::BitXor => (Level::BitwiseXor, b"^"),
        BinOp::Lt => (Level::Compare, b"<"),
        BinOp::Le => (Level::Compare, b"<="),
        BinOp::Gt => (Level::Compare, b">"),
        BinOp::Ge => (Level::Compare, b">="),
        BinOp::EqEq => (Level::Equals, b"=="),
        BinOp::NotEq => (Level::Equals, b"!="),
        BinOp::EqEqEq => (Level::Equals, b"==="),
        BinOp::NotEqEq => (Level::Equals, b"!=="),
        BinOp::In => (Level::Compare, b"in"),
        BinOp::Instanceof => (Level::Compare, b"instanceof"),
        BinOp::And => (Level::LogicalAnd, b"&&"),
        BinOp::Or => (Level::LogicalOr, b"||"),
        BinOp::Nullish => (Level::NullishCoalescing, b"??"),
        BinOp::Comma => (Level::Comma, b","),
    }
}

struct Printer<'f, 'a, 'c, 'p, 's> {
    file: &'f FileLowering<'a, 'c, 'p, 's>,
    text: Vec<u8>,
    places: FxHashMap<ExprId, (u32, u32)>,
    minifies_syntax: bool,
    gaps: u32,
    end_of_number: usize,
    start: usize,
    start_of_statement: usize,
    start_of_arrow_body: usize,
}

struct OpenOperator {
    expression: ExprId,
    op: BinOp,
    right: ExprId,
    right_level: Level,
    beside: Around,
    start: usize,
    wraps: bool,
    gaps: u32,
}

fn is_truthy(constant: Constant, is_empty: impl FnOnce(Atom) -> bool) -> Option<bool> {
    Some(match constant {
        Constant::Undefined | Constant::Null => false,
        Constant::Boolean(value) => value,
        Constant::Number(number) => number != 0.0 && !number.is_nan(),
        Constant::String(text) => !is_empty(text),
        Constant::BigInt(_) => return None,
    })
}

impl Printer<'_, '_, '_, '_, '_> {
    fn minifies_syntax(&self) -> bool {
        self.minifies_syntax
    }

    fn brace_would_open_block(&self) -> bool {
        self.text.len() == self.start_of_statement || self.text.len() == self.start_of_arrow_body
    }

    fn space_before_name(&mut self) {
        let is_part_of_name =
            |last: u8| last == b'_' || last == b'$' || last >= 0x80 || last.is_ascii_alphanumeric();
        if self.text[self.start..]
            .last()
            .is_some_and(|&last| is_part_of_name(last))
        {
            self.text.push(b' ');
        }
    }

    fn word(&mut self, word: &[u8]) {
        self.space_before_name();
        self.text.extend_from_slice(word);
    }

    #[inline]
    fn few_characters(&mut self, characters: &[u8]) {
        for &character in characters {
            self.text.push(character);
        }
    }

    fn operator(&mut self, operator: &[u8]) {
        if matches!(operator[0], b'+' | b'-')
            && self.text[self.start..].last() == Some(&operator[0])
        {
            self.text.push(b' ');
        }
        self.few_characters(operator);
    }

    #[inline]
    fn constant_of(&self, expression: ExprId) -> Option<Constant> {
        let (hir, decisions) = (self.file.hir, self.file.decisions());
        if !decisions.is_constant_in_bun_run(hir, expression) {
            return None;
        }
        self.constant_unless_template(expression)
    }

    fn constant_unless_template(&self, expression: ExprId) -> Option<Constant> {
        let (hir, decisions) = (self.file.hir, self.file.decisions());
        let is_template = matches!(hir[expression].kind, ExprKind::Template { .. })
            || (!self.minifies_syntax()
                && hir
                    .expr_flags(expression)
                    .contains(ExprFlags::TEMPLATE_LITERAL));
        if is_template {
            return None;
        }
        match decisions.constant(hir, expression) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                Some(constant)
            }
            FoldedValue::Unknown => None,
        }
    }

    fn number(&mut self, number: f64, level: Level) {
        if number.is_nan() {
            return self.word(b"NaN");
        }
        if number.is_infinite() {
            let wraps = number.is_sign_negative() && level >= Level::Prefix;
            if wraps {
                self.text.push(b'(');
            }
            if number.is_sign_negative() {
                self.operator(b"-");
            }
            self.word(b"Infinity");
            if wraps {
                self.text.push(b')');
            }
            return;
        }
        if !number.is_sign_negative() {
            self.space_before_name();
            append_printed_number(number, &mut self.text);
            self.end_of_number = self.text.len();
        } else if level >= Level::Prefix {
            self.text.extend_from_slice(b"(-");
            append_printed_number(number.abs(), &mut self.text);
            self.text.push(b')');
        } else {
            self.operator(b"-");
            append_printed_number(number.abs(), &mut self.text);
            self.end_of_number = self.text.len();
        }
    }

    fn constant(&mut self, constant: Constant, level: Level) {
        match constant {
            Constant::Undefined => self.word(b"undefined"),
            Constant::Null => self.word(b"null"),
            Constant::Boolean(value) => self.word(if value { b"true" } else { b"false" }),
            Constant::Number(number) => self.number(number, level),
            Constant::String(text) => {
                append_printed_text(self.file.queries.atom_bytes(text), &mut self.text);
            }
            Constant::BigInt(digits) => {
                self.word(self.file.queries.atom_bytes(digits));
                if self.text.last() != Some(&b'n') {
                    self.text.push(b'n');
                }
            }
        }
    }

    fn list(&mut self, list: impl Iterator<Item = ExprId>) {
        for (index, item) in list.enumerate() {
            if index > 0 {
                self.few_characters(b", ");
            }
            self.expression(item, Level::Comma, Around::default());
        }
    }

    fn characters(&mut self, text: Atom, quote: u8) {
        write_pre_quoted_string(
            self.file.queries.atom_bytes(text),
            &mut self.text,
            quote,
            true,
            false,
            Encoding::Utf8,
        )
        .expect("a list of bytes takes every byte");
    }

    fn pattern(&mut self, pattern: PatId) {
        let hir = self.file.hir;
        let written = hir[pattern];
        match written.kind {
            PatKind::Missing => {}
            PatKind::Ident(name) => {
                self.space_before_name();
                append_printed_name(
                    written_name_of_local(self.file.queries.atom_bytes(name)),
                    &mut self.text,
                );
            }
            PatKind::Array(_) | PatKind::Object(_)
                if !self.file.is_on_one_line(written.pos, written.end) =>
            {
                self.gaps += 1
            }
            PatKind::Array(elements) => {
                self.text.push(b'[');
                let count = elements.len();
                for (index, element) in elements.iter().enumerate() {
                    let element = hir[element];
                    if index > 0 {
                        self.text.extend_from_slice(b", ");
                    }
                    if element.is_rest {
                        self.text.extend_from_slice(b"...");
                    }
                    self.pattern(element.pat);
                    self.default_of_pattern(element.default);
                    if index + 1 == count && matches!(hir[element.pat].kind, PatKind::Missing) {
                        self.text.push(b',');
                    }
                }
                self.text.push(b']');
            }
            PatKind::Object(properties) => {
                self.text.push(b'{');
                for (index, property) in properties.iter().enumerate() {
                    let property = hir[property];
                    self.text
                        .extend_from_slice(if index > 0 { b", " } else { b" " });
                    match property.key {
                        _ if property.is_rest => self.text.extend_from_slice(b"..."),
                        PropKey::Computed(key) => {
                            self.text.push(b'[');
                            self.expression(key, Level::Comma, Around::default());
                            self.text.extend_from_slice(b"]: ");
                        }
                        PropKey::Name(key) => {
                            let key = self.file.queries.atom_bytes(key);
                            let is_named_like_key = matches!(hir[property.value].kind, PatKind::Ident(name) if self.file.queries.atom_bytes(name) == key);
                            let is_written_as_name = matches!(
                                property.name_kind,
                                NameKind::Identifier | NameKind::StringLiteral
                            );
                            if !(is_identifier(key) && is_named_like_key && is_written_as_name) {
                                self.key(key, property.name_kind);
                                self.text.extend_from_slice(b": ");
                            }
                        }
                        PropKey::None | PropKey::Private(_) => self.gaps += 1,
                    }
                    self.pattern(property.value);
                    self.default_of_pattern(property.default);
                }
                self.text
                    .extend_from_slice(if properties.is_empty() { b"}" } else { b" }" });
            }
        }
    }

    fn default_of_pattern(&mut self, default: ExprId) {
        if default.is_some() {
            self.text.extend_from_slice(b" = ");
            self.expression(default, Level::Comma, Around::default());
        }
    }

    fn parameters(&mut self, function: FnId) {
        let hir = self.file.hir;
        let written = hir[function];
        self.text.push(b'(');
        for (index, parameter) in written.params.iter().enumerate() {
            let parameter = hir[parameter];
            if index > 0 {
                self.text.extend_from_slice(b", ");
            }
            if parameter.flags.contains(Flags::REST) {
                self.text.extend_from_slice(b"...");
            }
            self.pattern(parameter.pat);
            self.default_of_pattern(parameter.default);
        }
        self.text.push(b')');
    }

    fn function_without_statements(&mut self, function: FnId) {
        let written = self.file.hir[function];
        if written.flags.contains(Flags::ASYNC) {
            self.word(b"async ");
        }
        if written.kind != FnKind::Arrow {
            self.word(b"function");
            if written.flags.contains(Flags::GENERATOR) {
                self.text.extend_from_slice(b"* ");
            }
            if written.name != Atom::NONE {
                self.space_before_name();
                append_printed_name(
                    written_name_of_local(self.file.queries.atom_bytes(written.name)),
                    &mut self.text,
                );
            }
        }
        self.parameters(function);
        self.text
            .extend_from_slice(if written.kind == FnKind::Arrow {
                b" => {}"
            } else {
                b" {}"
            });
    }

    fn arrow(&mut self, function: FnId, body: ExprId) {
        if self.file.hir[function].flags.contains(Flags::ASYNC) {
            self.word(b"async ");
        }
        self.parameters(function);
        self.text.extend_from_slice(b" => ");
        self.start_of_arrow_body = self.text.len();
        let around = Around {
            forbids_in: true,
            ..Around::default()
        };
        self.expression(body, Level::Comma, around);
    }

    fn member_name(&mut self, name: &[u8], starts_chain: bool, brackets: Option<u8>) {
        let Some(quote) = brackets else {
            if starts_chain {
                self.text.extend_from_slice(b"?.");
            } else {
                if self.end_of_number == self.text.len() {
                    self.text.push(b' ');
                }
                self.text.push(b'.');
            }
            append_printed_name(name, &mut self.text);
            return;
        };
        self.text
            .extend_from_slice(if starts_chain { b"?.[" } else { b"[" });
        match quote {
            b'`' => {
                self.text.push(b'`');
                write_pre_quoted_string(name, &mut self.text, b'`', true, false, Encoding::Utf8)
                    .expect("a list of bytes takes every byte");
                self.text.push(b'`');
            }
            _ => append_printed_text(name, &mut self.text),
        }
        self.text.push(b']');
    }

    fn has_dot_where_syntax_is_minified(&self, name: &[u8]) -> bool {
        self.minifies_syntax() && name.is_ascii() && is_identifier(name)
    }

    fn begin_link(&mut self, chain: Chain, around: &mut Around) -> bool {
        let wraps = chain != Chain::No && around.has_parent_outside_chain;
        if wraps {
            self.text.push(b'(');
            around.start_of_new = None;
        }
        around.has_parent_outside_chain = chain == Chain::No;
        around.forbids_in = false;
        wraps
    }

    fn key(&mut self, key: &[u8], written_as: NameKind) -> bool {
        match written_as {
            NameKind::Identifier | NameKind::StringLiteral | NameKind::Jsx
                if is_identifier(key)
                    && (key.is_ascii() || written_as != NameKind::StringLiteral) =>
            {
                self.space_before_name();
                append_printed_name(key, &mut self.text);
                return true;
            }
            NameKind::Identifier | NameKind::StringLiteral | NameKind::Jsx => {
                append_quoted_text(key, false, &mut self.text)
            }
            NameKind::NumericLiteral => self.numeric_key(key),
            NameKind::ComputedString => {
                self.text.push(b'[');
                append_printed_text(key, &mut self.text);
                self.text.push(b']');
            }
            NameKind::ComputedNumber => {
                self.text.push(b'[');
                self.numeric_key(key);
                self.text.push(b']');
            }
        }
        false
    }

    fn numeric_key(&mut self, key: &[u8]) {
        match core::str::from_utf8(key)
            .ok()
            .and_then(|key| key.parse().ok())
        {
            Some(number) => self.number(number, Level::Lowest),
            None => self.word(key),
        }
    }

    fn property(&mut self, property: PropId) {
        let hir = self.file.hir;
        let property = hir[property];
        match (property.kind, property.key) {
            (PropKind::Spread, _) => {
                self.text.extend_from_slice(b"...");
                self.expression(property.value, Level::Comma, Around::default());
            }
            (PropKind::Init | PropKind::Shorthand, PropKey::Name(key)) => {
                let value = self.file.skip_to_written_expression(property.value);
                let text = self.file.queries.atom_bytes(key);
                let is_named_like_key = matches!(hir[value].kind, ExprKind::Ident(name) if written_name_of_local(self.file.queries.atom_bytes(name)) == text)
                    && self.constant_of(value).is_none();
                let is_name = self.key(text, property.name_kind);
                let sets_prototype = key == known::__proto__ && property.kind == PropKind::Init;
                if is_name && is_named_like_key && !sets_prototype {
                    return;
                }
                self.text.extend_from_slice(b": ");
                self.expression(property.value, Level::Comma, Around::default());
            }
            (PropKind::Init, PropKey::Computed(key)) => {
                self.text.push(b'[');
                self.expression(key, Level::Comma, Around::default());
                self.text.extend_from_slice(b"]: ");
                self.expression(property.value, Level::Comma, Around::default());
            }
            _ => self.gaps += 1,
        }
    }

    fn call(&mut self, site: Call, mut around: Around, level: Level) -> (usize, bool) {
        let mut wraps = level >= Level::New || around.forbids_call;
        wraps |= site.chain != Chain::No && around.has_parent_outside_chain;
        if wraps {
            self.text.push(b'(');
        }
        let start = self.text.len();
        around = Around {
            has_parent_outside_chain: site.chain == Chain::No,
            ..Around::default()
        };
        self.expression(site.callee, Level::Postfix, around);
        if site.chain == Chain::Start {
            self.text.extend_from_slice(b"?.");
        }
        self.text.push(b'(');
        self.list(self.file.hir.ids(site.args));
        self.text.push(b')');
        (start, wraps)
    }

    fn operators(&mut self, mut expression: ExprId, mut level: Level, mut around: Around) {
        let hir = self.file.hir;
        let mut open: SmallVec<[OpenOperator; 2]> = SmallVec::new();
        loop {
            expression = self.file.skip_type_syntax(expression);
            let ExprKind::Binary { op, left, right } = hir[expression].kind else {
                self.expression(expression, level, around);
                break;
            };
            if let Some(constant) = self.constant_of(expression) {
                self.constant(constant, level);
                break;
            }
            let known = match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    self.constant_of(self.file.skip_type_syntax(left))
                }
                _ => None,
            };
            let is_empty = |text: Atom| self.file.queries.atom_bytes(text).is_empty();
            let keeps_right = known.and_then(|known| match op {
                BinOp::And => is_truthy(known, is_empty),
                BinOp::Or => is_truthy(known, is_empty).map(|is_truthy| !is_truthy),
                _ => Some(matches!(known, Constant::Undefined | Constant::Null)),
            });
            match (known, keeps_right) {
                (_, Some(true)) => {
                    expression = right;
                    continue;
                }
                (Some(known), Some(false)) => {
                    self.constant(known, level);
                    break;
                }
                _ => {}
            }
            let names_callee = || {
                matches!(
                    hir[self.file.skip_type_syntax(right)].kind,
                    ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Ident(_)
                )
            };
            if op == BinOp::Comma
                && self.minifies_syntax()
                && self.constant_of(self.file.skip_type_syntax(left)).is_some()
                && !names_callee()
            {
                expression = right;
                continue;
            }
            let own = level_and_text_of(op).0;
            let begins_with_literal = self.brace_would_open_block()
                && matches!(
                    hir[self.file.skip_type_syntax(left)].kind,
                    ExprKind::Object(_)
                );
            let wraps =
                level >= own || (op == BinOp::In && around.forbids_in) || begins_with_literal;
            if wraps {
                self.text.push(b'(');
            }
            let (mut left_level, mut right_level) = (own.below(), own.below());
            match op {
                BinOp::Pow => left_level = own,
                BinOp::Comma => {}
                _ => right_level = own,
            }
            let is_and_or_or = |operand: ExprId| {
                matches!(
                    hir[self.file.skip_type_syntax(operand)].kind,
                    ExprKind::Binary {
                        op: BinOp::And | BinOp::Or,
                        ..
                    }
                )
            };
            if op == BinOp::Nullish {
                if is_and_or_or(left) {
                    left_level = Level::Prefix;
                }
                if is_and_or_or(right) {
                    right_level = Level::Prefix;
                }
            }
            if op == BinOp::Pow {
                let base = self.file.skip_type_syntax(left);
                let is_prefixed = matches!(
                    hir[base].kind,
                    ExprKind::Await(_)
                        | ExprKind::Unary {
                            op: UnOp::Plus
                                | UnOp::Minus
                                | UnOp::BitNot
                                | UnOp::Not
                                | UnOp::Typeof
                                | UnOp::Void
                                | UnOp::Delete,
                            ..
                        }
                );
                if is_prefixed || self.constant_of(base).is_some() {
                    left_level = Level::Call;
                }
            }
            let beside = Around {
                forbids_in: around.forbids_in || wraps,
                ..Around::default()
            };
            open.push(OpenOperator {
                expression,
                op,
                right,
                right_level,
                beside,
                start: self.text.len(),
                wraps,
                gaps: self.gaps,
            });
            if let ExprKind::PrivateIdentifier(name) = hir[left].kind
                && op == BinOp::In
            {
                append_printed_name(
                    written_name(self.file.queries.atom_bytes(name)),
                    &mut self.text,
                );
                break;
            }
            (expression, level, around) = (left, left_level, beside);
        }
        while let Some(operator) = open.pop() {
            if operator.op != BinOp::Comma {
                self.text.push(b' ');
            }
            self.few_characters(level_and_text_of(operator.op).1);
            self.text.push(b' ');
            self.expression(operator.right, operator.right_level, operator.beside);
            let end = self.text.len();
            if operator.wraps {
                self.text.push(b')');
            }
            if matches!(operator.op, BinOp::In | BinOp::Instanceof) && self.gaps == operator.gaps {
                self.places
                    .insert(operator.expression, (operator.start as u32, end as u32));
            }
        }
    }

    fn unary(&mut self, op: UnOp, operand: ExprId, level: Level) -> (usize, bool) {
        let is_postfix = matches!(op, UnOp::PostInc | UnOp::PostDec);
        let wraps = level
            >= if is_postfix {
                Level::Postfix
            } else {
                Level::Prefix
            };
        if wraps {
            self.text.push(b'(');
        }
        let start = self.text.len();
        match op {
            UnOp::PostInc | UnOp::PostDec => {
                self.expression(operand, Level::Postfix.below(), Around::default());
                self.text
                    .extend_from_slice(if op == UnOp::PostInc { b"++" } else { b"--" });
                return (start, wraps);
            }
            UnOp::Typeof => self.word(b"typeof "),
            UnOp::Void => self.word(b"void "),
            UnOp::Delete => self.word(b"delete "),
            UnOp::Plus => self.operator(b"+"),
            UnOp::Minus => self.operator(b"-"),
            UnOp::BitNot => self.operator(b"~"),
            UnOp::Not => self.operator(b"!"),
            UnOp::PreInc => self.operator(b"++"),
            UnOp::PreDec => self.operator(b"--"),
        }
        self.expression(operand, Level::Prefix.below(), Around::default());
        (start, wraps)
    }

    fn expression(&mut self, expression: ExprId, level: Level, mut around: Around) {
        let hir = self.file.hir;
        let expression = self.file.skip_to_written_expression(expression);
        if let Some(constant) = self.constant_of(expression) {
            return self.constant(constant, level);
        }
        let gaps = self.gaps;
        let whole = |printer: &Printer<'_, '_, '_, '_, '_>| (printer.text.len(), false);
        let (start, wraps) = match hir[expression].kind {
            ExprKind::Missing => whole(self),
            ExprKind::Ident(name) => {
                let written = written_name_of_local(self.file.queries.atom_bytes(name));
                if written.starts_with(b"%") {
                    self.gaps += 1;
                    whole(self)
                } else {
                    self.space_before_name();
                    let start = whole(self);
                    self.file
                        .append_written_identifier(expression, written, &mut self.text);
                    start
                }
            }
            ExprKind::This => {
                self.word(b"this");
                whole(self)
            }
            ExprKind::Super => {
                self.word(b"super");
                whole(self)
            }
            ExprKind::ImportMeta => {
                self.word(b"import.meta");
                whole(self)
            }
            ExprKind::NewTarget(_) => {
                self.word(b"new.target");
                whole(self)
            }
            ExprKind::Regex { .. } => {
                self.space_before_name();
                let start = whole(self);
                let characters = CodepointIterator::init(
                    &hir.text[hir[expression].pos as usize..hir[expression].end as usize],
                );
                let mut cursor = Cursor::default();
                while characters.next(&mut cursor) {
                    match (u8::try_from(cursor.c), char::from_u32(cursor.c as u32)) {
                        (Ok(character), _) if character.is_ascii() => self.text.push(character),
                        (_, Some(character)) => {
                            for unit in character.encode_utf16(&mut [0; 2]) {
                                self.text
                                    .extend_from_slice(format!("\\u{unit:04X}").as_bytes());
                            }
                        }
                        (_, None) => self.gaps += 1,
                    }
                }
                start
            }
            ExprKind::Spread(operand) => {
                self.text.extend_from_slice(b"...");
                self.expression(operand, Level::Comma, Around::default());
                whole(self)
            }
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                let wraps = self.begin_link(chain, &mut around);
                let start = around.start_of_new.unwrap_or(self.text.len());
                self.expression(obj, Level::Postfix, around);
                let name = written_name(self.file.queries.atom_bytes(name));
                let is_of_import_meta = chain == Chain::No
                    && matches!(hir[obj].kind, ExprKind::ImportMeta)
                    && name.is_ascii()
                    && is_identifier(name);
                let stays_in_brackets = hir.is_written_in_brackets(expression)
                    && !is_of_import_meta
                    && !self.has_dot_where_syntax_is_minified(name);
                let quote = stays_in_brackets.then(|| {
                    if self.minifies_syntax() {
                        b'"'
                    } else {
                        hir.text[hir.name_pos(expression) as usize]
                    }
                });
                self.member_name(name, chain == Chain::Start, quote);
                (start, wraps)
            }
            ExprKind::Index { obj, index, chain } => {
                let wraps = self.begin_link(chain, &mut around);
                let start = around.start_of_new.unwrap_or(self.text.len());
                self.expression(obj, Level::Postfix, around);
                let name = match self.constant_of(self.file.skip_type_syntax(index)) {
                    Some(Constant::String(text)) => Some(self.file.queries.atom_bytes(text)),
                    _ => None,
                };
                match name.filter(|name| self.has_dot_where_syntax_is_minified(name)) {
                    Some(name) => self.member_name(name, chain == Chain::Start, None),
                    None => {
                        self.text.extend_from_slice(if chain == Chain::Start {
                            b"?.["
                        } else {
                            b"["
                        });
                        self.expression(index, Level::Lowest, Around::default());
                        self.text.push(b']');
                    }
                }
                (start, wraps)
            }
            ExprKind::Call(site) => self.call(hir[site], around, level),
            ExprKind::New(site) => {
                let site = hir[site];
                let wraps = level >= Level::Call;
                if wraps {
                    self.text.push(b'(');
                }
                self.space_before_name();
                let start = around
                    .start_of_new
                    .filter(|_| !wraps)
                    .unwrap_or(self.text.len());
                self.text.extend_from_slice(b"new ");
                let callee = Around {
                    forbids_call: true,
                    start_of_new: Some(start),
                    ..Around::default()
                };
                self.expression(site.callee, Level::New, callee);
                if !site.args.is_empty() || level >= Level::Postfix {
                    self.text.push(b'(');
                    self.list(hir.ids(site.args));
                    self.text.push(b')');
                }
                (start, wraps)
            }
            ExprKind::Unary { op, operand } => self.unary(op, operand, level),
            ExprKind::Binary { .. } => return self.operators(expression, level, around),
            ExprKind::Assign { op, target, value } => {
                let wraps = level >= Level::Assign;
                if wraps {
                    self.text.push(b'(');
                }
                let start = self.text.len();
                let beside = Around {
                    forbids_in: around.forbids_in || wraps,
                    ..Around::default()
                };
                self.expression(target, Level::Assign, beside);
                self.text.push(b' ');
                if let Some(op) = op {
                    self.text.extend_from_slice(level_and_text_of(op).1);
                }
                self.few_characters(b"= ");
                self.expression(value, Level::Assign.below(), beside);
                (start, wraps)
            }
            ExprKind::Cond { test, branches }
                if let Some(is_truthy) = self
                    .constant_of(self.file.skip_type_syntax(test))
                    .and_then(|known| {
                        is_truthy(known, |text| self.file.queries.atom_bytes(text).is_empty())
                    }) =>
            {
                let branches = hir.branches(branches);
                return self.expression(
                    if is_truthy { branches.yes } else { branches.no },
                    level,
                    around,
                );
            }
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let wraps = level >= Level::Conditional;
                if wraps {
                    self.text.push(b'(');
                }
                let start = self.text.len();
                let beside = Around {
                    start_of_new: None,
                    forbids_in: around.forbids_in && !wraps,
                    ..around
                };
                self.expression(test, Level::Conditional, beside);
                self.text.extend_from_slice(b" ? ");
                self.expression(branches.yes, Level::Yield, Around::default());
                self.text.extend_from_slice(b" : ");
                let last = Around {
                    forbids_in: true,
                    ..beside
                };
                self.expression(branches.no, Level::Yield, last);
                (start, wraps)
            }
            ExprKind::Await(operand) => {
                let wraps = level >= Level::Prefix;
                if wraps {
                    self.text.push(b'(');
                }
                self.space_before_name();
                let start = self.text.len();
                self.text.extend_from_slice(b"await ");
                self.expression(operand, Level::Prefix.below(), Around::default());
                (start, wraps)
            }
            ExprKind::String(text) => {
                let start = self.text.len();
                self.text.push(b'`');
                self.characters(text, b'`');
                self.text.push(b'`');
                (start, false)
            }
            ExprKind::Template { exprs } => {
                let start = self.text.len();
                let texts = hir.template_texts(exprs);
                self.text.push(b'`');
                self.characters(hir.id_at(texts, 0), b'`');
                for (index, substitution) in hir.ids(exprs).enumerate() {
                    self.text.extend_from_slice(b"${");
                    self.expression(substitution, Level::Lowest, Around::default());
                    self.text.push(b'}');
                    self.characters(hir.id_at(texts, index + 1), b'`');
                }
                self.text.push(b'`');
                (start, false)
            }
            ExprKind::TaggedTemplate(site)
                if hir
                    .template_parts(hir.template_of(site))
                    .iter()
                    .all(|part| self.file.queries.atom_bytes(part.raw).is_ascii()) =>
            {
                let start = around.start_of_new.unwrap_or(self.text.len());
                let tag = Around {
                    start_of_new: around.start_of_new,
                    ..Around::default()
                };
                self.expression(hir[site].callee, Level::Postfix, tag);
                self.text.push(b'`');
                let mut substitutions = hir.ids(hir[site].args);
                for (index, part) in hir.template_parts(hir.template_of(site)).iter().enumerate() {
                    if index > 0 {
                        self.text.extend_from_slice(b"${");
                        match substitutions.next() {
                            Some(substitution) => {
                                self.expression(substitution, Level::Lowest, Around::default())
                            }
                            None => self.gaps += 1,
                        }
                        self.text.push(b'}');
                    }
                    self.text
                        .extend_from_slice(self.file.queries.atom_bytes(part.raw));
                }
                self.text.push(b'`');
                (start, false)
            }
            ExprKind::Yield { value, star } => {
                let wraps = level >= Level::Assign;
                if wraps {
                    self.text.push(b'(');
                }
                self.space_before_name();
                let start = self.text.len();
                self.text
                    .extend_from_slice(if star { b"yield*" } else { b"yield" });
                if let Some(value) = value.some() {
                    self.text.push(b' ');
                    self.expression(value, Level::Yield, Around::default());
                }
                (start, wraps)
            }
            ExprKind::Fn(function) => {
                let wraps = match hir[function].kind {
                    FnKind::Arrow => level >= Level::Assign,
                    _ => self.text.len() == self.start_of_statement,
                };
                if wraps {
                    self.text.push(b'(');
                }
                let start = self.text.len();
                match hir[function].body {
                    FnBody::Expr(body) => self.arrow(function, body),
                    FnBody::Block(statements) if statements.is_empty() => {
                        self.function_without_statements(function)
                    }
                    FnBody::None | FnBody::Block(_) => self.gaps += 1,
                }
                (start, wraps)
            }
            ExprKind::Array(items)
                if items.is_empty()
                    || self
                        .file
                        .is_on_one_line(hir[expression].pos, hir[expression].end) =>
            {
                let start = self.text.len();
                self.text.push(b'[');
                let ends_in_hole = hir
                    .ids(items)
                    .last()
                    .is_some_and(|last| matches!(hir[last].kind, ExprKind::Missing));
                self.list(hir.ids(items));
                if ends_in_hole {
                    self.text.push(b',');
                }
                self.text.push(b']');
                (start, false)
            }
            ExprKind::Object(properties)
                if properties.is_empty()
                    || self
                        .file
                        .is_on_one_line(hir[expression].pos, hir[expression].end) =>
            {
                let wraps = self.brace_would_open_block();
                if wraps {
                    self.text.push(b'(');
                }
                let start = self.text.len();
                self.text.push(b'{');
                for (index, property) in properties.iter().enumerate() {
                    self.text
                        .extend_from_slice(if index > 0 { b", " } else { b" " });
                    self.property(property);
                }
                self.text
                    .extend_from_slice(if properties.is_empty() { b"}" } else { b" }" });
                (start, wraps)
            }
            _ => {
                self.gaps += 1;
                whole(self)
            }
        };
        let end = self.text.len();
        if wraps {
            self.text.push(b')');
        }
        let is_quoted = matches!(
            hir[expression].kind,
            ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Yield { star: true, .. }
                | ExprKind::Assign { op: None, .. }
                | ExprKind::Unary {
                    op: UnOp::Delete,
                    ..
                }
        );
        if is_quoted && self.gaps == gaps {
            self.places.insert(expression, (start as u32, end as u32));
        }
    }
}

impl<'a, 'c, 'p, 's> FileLowering<'a, 'c, 'p, 's> {
    fn is_on_one_line(&self, start: u32, end: u32) -> bool {
        let text = self.hir.text.get(start as usize..end as usize);
        text.is_some_and(|text| !contains_char(text, b'\n'))
    }

    #[inline]
    fn skip_to_written_expression(&self, expression: ExprId) -> ExprId {
        let written = self.skip_type_syntax(expression);
        match self.hir[written].kind {
            ExprKind::Cond { .. } => {
                skip_to_written_use(self.hir, |name| self.queries.atom_bytes(name), written)
            }
            _ => written,
        }
    }

    fn is_printed(&self, expression: ExprId) -> bool {
        let written = self.hir[expression];
        match written.kind {
            ExprKind::Array(_) | ExprKind::Object(_) => {
                self.is_on_one_line(written.pos, written.end)
            }
            ExprKind::Fn(function) => match self.hir[function].body {
                FnBody::Expr(_) => true,
                FnBody::Block(statements) => statements.is_empty(),
                FnBody::None => false,
            },
            ExprKind::Class(_)
            | ExprKind::Jsx(_)
            | ExprKind::JsxText(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::PrivateIdentifier(_) => false,
            _ => true,
        }
    }

    fn expression_around(&self, expression: ExprId) -> Option<ExprId> {
        match self.bound.parent_of_expr(expression) {
            Parent::Expr(around) => Some(around),
            Parent::Prop(property) | Parent::PropKey(property) => {
                self.bound.prop_owner[property.idx()].some()
            }
            Parent::FnBody(function) => match self.bound.fns[function.idx()].owner {
                FnOwner::Expr(around) => Some(around),
                _ => None,
            },
            _ => None,
        }
    }

    fn outermost_printed_expression_around(&self, expression: ExprId) -> ExprId {
        let mut outermost = expression;
        while let Some(around) = self
            .expression_around(outermost)
            .filter(|&around| self.is_printed(around))
        {
            outermost = around;
        }
        outermost
    }

    fn print_quoted_text(
        &mut self,
        print: impl FnOnce(&mut Printer<'_, 'a, 'c, 'p, 's>),
    ) -> Option<(u32, u32)> {
        let text = core::mem::take(&mut self.quoted_texts.text);
        let start = text.len();
        let mut printer = Printer {
            text,
            places: core::mem::take(&mut self.quoted_texts.places),
            minifies_syntax: self.inputs.options.removable.minifies_syntax(),
            file: self,
            gaps: 0,
            end_of_number: usize::MAX,
            start,
            start_of_statement: usize::MAX,
            start_of_arrow_body: usize::MAX,
        };
        print(&mut printer);
        let Printer {
            text, places, gaps, ..
        } = printer;
        let end = text.len();
        self.quoted_texts.text = text;
        self.quoted_texts.places = places;
        (gaps == 0).then_some((start as u32, end as u32))
    }

    #[inline]
    fn quotes_texts(&self) -> bool {
        !self.inputs.options.obfuscates && self.inputs.options.embeds_function_text
    }

    fn quote_at(&mut self, position: u32, expression: ExprId) {
        let expression = self.skip_to_written_expression(expression);
        let mut place = self.quoted_texts.places.get(&expression).copied();
        if place.is_none() {
            let outermost = self.outermost_printed_expression_around(expression);
            let is_printed = &mut self.quoted_texts.is_printed;
            if is_printed.is_empty() {
                is_printed.resize(self.hir.exprs.len().div_ceil(64), 0);
            }
            let word = &mut is_printed[outermost.idx() / 64];
            let bit = 1 << (outermost.idx() % 64);
            if *word & bit != 0 {
                return;
            }
            *word |= bit;
            let is_statement = matches!(self.bound.parent_of_expr(outermost), Parent::Stmt(statement) if matches!(self.hir[statement].kind, StmtKind::Expr(_)));
            self.print_quoted_text(|printer| {
                if is_statement {
                    printer.start_of_statement = printer.start;
                }
                printer.expression(outermost, Level::Lowest, Around::default());
            });
            place = self.quoted_texts.places.get(&expression).copied();
        }
        if let Some((start, end)) = place {
            self.quoted_texts.quoted.push(QuotedText {
                position,
                start,
                end,
            });
        }
    }

    fn find_expression_quoted_for_member(&self, access: ExprId) -> ExprId {
        let mut operand = access;
        while let Parent::Expr(around) = self.bound.parent_of_expr(operand) {
            match self.hir[around].kind {
                _ if self.hir.type_assertion_operand(around) == Some(operand) => operand = around,
                ExprKind::Assign {
                    op: None, target, ..
                } if target == operand => return around,
                ExprKind::Unary {
                    op: UnOp::Delete, ..
                } => return around,
                _ => break,
            }
        }
        access
    }

    pub(in crate::lower) fn operator_position_of(&self, binary: ExprId) -> u32 {
        let hir = self.hir;
        let ExprKind::Binary { op, left, right } = hir[binary].kind else {
            return hir[binary].pos;
        };
        let from = end_of_expr(hir, left);
        let between = hir.text.get(from as usize..start_of(hir, right) as usize);
        let written = between.and_then(|between| index_of(between, level_and_text_of(op).1));
        written.map_or(hir[binary].pos, |written| from + written as u32)
    }

    pub(in crate::lower) fn take_quoted_texts(&mut self) -> (Vec<QuotedText>, Vec<u8>) {
        let QuotedTexts {
            text, mut quoted, ..
        } = core::mem::take(&mut self.quoted_texts);
        let text_of = |quoted: &QuotedText| &text[quoted.start as usize..quoted.end as usize];
        quoted.sort_by_u32(|quoted| quoted.position);
        let mut kept: Vec<QuotedText> = Vec::with_capacity(quoted.len());
        let mut index = 0;
        while let Some(first) = quoted.get(index) {
            let (mut earliest, mut is_one_text) = (first, true);
            index += 1;
            while let Some(next) = quoted.get(index)
                && next.position == first.position
            {
                is_one_text = is_one_text && text_of(next) == text_of(first);
                if next.start < earliest.start {
                    earliest = next;
                }
                index += 1;
            }
            if is_one_text {
                kept.push(QuotedText { ..*earliest });
            }
        }
        (kept, text)
    }

    pub(in crate::lower) fn append_identifier(
        &self,
        identifier: ExprId,
        name: Atom,
        text: &mut Vec<u8>,
    ) {
        if !self.append_short_binding_name(self.bound.binding(identifier), text) {
            append_printed_name(written_name_of_local(self.queries.atom_bytes(name)), text);
        }
    }

    fn append_written_identifier(&self, identifier: ExprId, written: &[u8], text: &mut Vec<u8>) {
        if !self.append_short_binding_name(self.bound.binding(identifier), text) {
            append_printed_name(written, text);
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    #[inline]
    pub(in crate::lower) fn quote_if_next_fails(&mut self, expression: ExprId) {
        if self.file.quotes_texts() {
            let position = self.position();
            self.file.quote_at(position, expression);
        }
    }

    pub(in crate::lower) fn report_at_member(&mut self, access: ExprId) {
        let Some((object, _)) = self.file.hir.member_key(access) else {
            unreachable!("report_at_member takes a Dot or an Index expression");
        };
        self.set_position(self.file.last_token_position_of(object));
        if self.file.quotes_texts() {
            let quoted = self.file.find_expression_quoted_for_member(access);
            self.quote_if_next_fails(quoted);
        }
    }

    pub(in crate::lower) fn report_at_operator(&mut self, binary: ExprId) {
        self.set_position(self.file.operator_position_of(binary));
        self.quote_if_next_fails(binary);
    }

    pub(in crate::lower) fn quote_head_of_loop_if_next_fails(
        &mut self,
        left: StmtId,
        subject: ExprId,
    ) {
        let hir = self.file.hir;
        self.quote_printed_if_next_fails(|printer| {
            match hir[left].kind {
                StmtKind::Var(declarations) => match declarations.iter().next() {
                    Some(declaration) => {
                        let declaration = hir[declaration];
                        if !matches!(hir[declaration.pat].kind, PatKind::Ident(_)) {
                            printer.text.extend_from_slice(match declaration.kind {
                                VarKind::Var => b"var ".as_slice(),
                                VarKind::Let => b"let ",
                                VarKind::Const => b"const ",
                                VarKind::Using => b"using ",
                                VarKind::AwaitUsing => b"await using ",
                            });
                        }
                        printer.pattern(declaration.pat);
                    }
                    None => printer.gaps += 1,
                },
                StmtKind::Expr(target) => {
                    printer.expression(target, Level::Postfix, Around::default())
                }
                _ => printer.gaps += 1,
            }
            printer.text.extend_from_slice(b" of ");
            printer.expression(subject, Level::Comma, Around::default());
        });
    }

    pub(in crate::lower) fn quote_pattern_if_next_fails(&mut self, pattern: PatId) {
        self.set_position(self.file.hir[pattern].pos);
        self.quote_printed_if_next_fails(|printer| printer.pattern(pattern));
    }

    pub(in crate::lower) fn quote_assigned_pattern_if_next_fails(&mut self, pattern: ExprId) {
        self.set_position(self.file.hir[pattern].pos);
        self.quote_printed_if_next_fails(|printer| {
            printer.expression(pattern, Level::Assign, Around::default())
        });
    }

    fn quote_printed_if_next_fails(
        &mut self,
        print: impl FnOnce(&mut Printer<'_, '_, '_, '_, '_>),
    ) {
        let position = self.position();
        if !self.file.quotes_texts() {
            return;
        }
        if let Some((start, end)) = self.file.print_quoted_text(print) {
            self.file.quoted_texts.quoted.push(QuotedText {
                position,
                start,
                end,
            });
        }
    }
}

pub(in crate::lower) fn append_printed_text(text: &[u8], printed: &mut Vec<u8>) {
    append_quoted_text(text, true, printed);
}

fn append_quoted_text(text: &[u8], may_be_template: bool, printed: &mut Vec<u8>) {
    let (mut single_cost, mut double_cost, mut backtick_cost) = (0, 0, 0);
    let mut bytes = text.iter().take(1024).enumerate();
    while let Some((index, &byte)) = bytes.next() {
        match byte {
            b'\'' => single_cost += 1,
            b'"' => double_cost += 1,
            b'`' => backtick_cost += 1,
            b'\n' => {
                single_cost += 1;
                double_cost += 1;
            }
            b'\\' => {
                bytes.next();
            }
            b'$' if text.get(index + 1) == Some(&b'{') => backtick_cost += 1,
            _ => {}
        }
    }
    let quote = if may_be_template && backtick_cost < single_cost.min(double_cost) {
        b'`'
    } else if single_cost < double_cost {
        b'\''
    } else {
        b'"'
    };
    printed.push(quote);
    write_pre_quoted_string(text, printed, quote, true, false, Encoding::Utf8)
        .expect("a list of bytes takes every byte");
    printed.push(quote);
}

pub(in crate::lower) fn append_printed_name(name: &[u8], printed: &mut Vec<u8>) {
    if name.is_ascii() {
        printed.extend_from_slice(name);
        return;
    }
    let characters = CodepointIterator::init(name);
    let mut cursor = Cursor::default();
    while characters.next(&mut cursor) {
        match u8::try_from(cursor.c) {
            Ok(character) if character.is_ascii() => printed.push(character),
            _ => printed.extend_from_slice(format!("\\u{{{:x}}}", cursor.c).as_bytes()),
        }
    }
}

pub(in crate::lower) fn append_printed_number(number: f64, printed: &mut Vec<u8>) {
    let is_integer = number.fract() == 0.0 && number < (u64::MAX >> 12) as f64;
    match is_integer
        .then(|| pow10_exp_1e4_to_1e9(number as u64))
        .flatten()
    {
        Some(exponent) => printed.extend_from_slice(&[b'1', b'e', b'0' + exponent]),
        None if is_integer && number.is_sign_positive() => append_digits(number as u64, printed),
        None => printed.extend_from_slice(format!("{number}").as_bytes()),
    }
}

fn append_digits(mut number: u64, printed: &mut Vec<u8>) {
    let mut digits = [0; 20];
    let mut first = digits.len();
    loop {
        first -= 1;
        digits[first] = b'0' + (number % 10) as u8;
        number /= 10;
        if number == 0 {
            break;
        }
    }
    for &digit in &digits[first..] {
        printed.push(digit);
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::testing::{default_settings, lower_program_with_settings};

    fn text_of_quotes(source: &str) -> Vec<u8> {
        let lowered = lower_program_with_settings(&[("main.js", source)], &default_settings());
        let modules = lowered
            .into_iter()
            .map(|(_, lowered)| lowered.fragment.module);
        modules
            .flat_map(|module| module.positions.text_of_quotes)
            .collect()
    }

    #[test]
    fn sum_of_400_000_terms_is_printed() {
        let sum = vec!["holder.a"; 400_000].join(" + ");
        let source = format!("export function probe(holder) {{\n  return {sum};\n}}\n");
        assert_eq!(text_of_quotes(&source), sum.as_bytes());
    }

    #[test]
    fn property_that_sets_the_prototype_keeps_its_value() {
        let source = "export function probe(run, __proto__, key) {\n  return run({ __proto__: __proto__, key: key }, { __proto__ });\n}\n";
        let printed = "run({ __proto__: __proto__, key }, { __proto__ })";
        assert_eq!(String::from_utf8_lossy(&text_of_quotes(source)), printed);
    }
}
