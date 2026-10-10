use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents the use of zero fractions.
pub struct NoZeroFractions;

const ZERO_FRACTION: Message = Message::new("", "Don't use a zero fraction in the number.");
const DANGLING_DOT: Message = Message::new("", "Don't use a dangling dot in the number.");

impl Rule for NoZeroFractions {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-zero-fractions", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(_: &Options) -> Self {
        NoZeroFractions
    }

    fn number_literal<'a>(&self, number_literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        let raw = number_literal.text();
        if !strings::contains_char(raw, b'.') {
            return;
        }
        let Some((fmt, is_dangling_dot)) = format_raw(raw).filter(|it| it.0 != raw) else {
            return;
        };
        let message = if is_dangling_dot { DANGLING_DOT } else { ZERO_FRACTION };
        cx.report(number_literal, message).data("lit", fmt.clone()).fix(|fixer| {
            // `1.0.toString()`, `a[1.0]`
            let is_member =
                |node: Node| matches!(node, Node::Expr(e) if matches!(e.tag(), ExprTag::Dot | ExprTag::Index));
            let is_member_expression =
                matches!(number_literal.owner(), Node::Expr(e) if !e.is_parenthesized() && is_member(e.parent()));
            let is_decimal_integer = fmt.iter().all(|it| matches!(it, b'0'..=b'9' | b'_'));
            let (open, close): (&[u8], &[u8]) = match is_member_expression && is_decimal_integer {
                true => (b"(", b")"),
                false => (b"", b""),
            };
            // `case.0` is not `case0`.
            let before = fixer.file().text().get(..number_literal.span().start as usize).unwrap_or_default();
            let follows_name = text::last_code_point(before)
                .is_some_and(|c| bun_core::lexer::is_type_script_identifier_part(c as i32));
            let space: &[u8] = if follows_name { b" " } else { b"" };
            fixer.replace(number_literal, [space, open, &fmt, close].concat())
        });
    }
}

/// The number as it should be written, and whether nothing follows its dot. `None` without a dot.
fn format_raw(raw: &[u8]) -> Option<(Vec<u8>, bool)> {
    let (base, exponent) = match strings::index_of_any(raw, b"eE") {
        Some(at) => (raw.get(..at)?, raw.get(at + 1..)),
        None => (raw, None),
    };
    let (before, after_and_dot) = strings::split_once_char(base, b'.')?;
    let len = after_and_dot.iter().take_while(|it| it.is_ascii_digit() || **it == b'_').count();
    let (dot_and_fractions, after) = (after_and_dot.get(..len)?, after_and_dot.get(len + 1..).unwrap_or_default());
    let useless = dot_and_fractions.iter().rev().take_while(|it| matches!(it, b'0' | b'_')).count();
    let fixed_dot_and_fractions = dot_and_fractions.get(..len - useless)?;
    let mut formatted = Vec::with_capacity(raw.len());
    formatted.extend_from_slice(if before.is_empty() && fixed_dot_and_fractions.is_empty() { b"0" } else { before });
    if !fixed_dot_and_fractions.is_empty() {
        formatted.push(b'.');
    }
    formatted.extend_from_slice(fixed_dot_and_fractions);
    formatted.extend_from_slice(after);
    if let Some(exponent) = exponent {
        formatted.push(b'e');
        formatted.extend_from_slice(exponent);
    }
    Some((formatted, dot_and_fractions.is_empty()))
}
