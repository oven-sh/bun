use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::ops::Range;

/// Enforce uppercase characters for the value of the escape sequence.
pub struct EscapeCase;

const ESCAPE_CASE: Message = Message::new("", "Use uppercase characters for the value of the escape sequence.");

impl Rule for EscapeCase {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "escape-case", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().string_literals().exprs(&[ExprTag::Regex, ExprTag::Template]);
    no_state!();

    fn new(_: &Options) -> Self {
        EscapeCase
    }

    fn string_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        check(literal.span(), false, cx);
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Regex => check(e.span(), true, cx),
            ExprTag::Template => self.template(e, cx),
            _ => {}
        }
    }
}

impl EscapeCase {
    fn template<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Template(template) = e.kind() else {
            return;
        };
        if !bun_core::strings::contains_char(e.text(), b'\\') || is_string_raw_tagged_template_expression(e.parent()) {
            return;
        }
        let count = template.quasi_count();
        for i in 0..count {
            check(template.quasi_span(i).shrink(1, if i + 1 == count { 1 } else { 2 }), false, cx);
        }
    }
}

fn check(span: Span, is_regex: bool, cx: &Cx<EscapeCase>) {
    let value = cx.slice(span);
    if !bun_core::strings::contains_char(value, b'\\') {
        return;
    }
    let mut has_lowercase = false;
    for_each_escaped_value(value, is_regex, &mut |range| {
        has_lowercase |= value.get(range).is_some_and(|it| it.iter().any(u8::is_ascii_lowercase));
    });
    if has_lowercase {
        cx.report(span, ESCAPE_CASE).fix(|fixer| {
            let mut fixed = value.to_vec();
            for_each_escaped_value(value, is_regex, &mut |range| {
                if let Some(digits) = fixed.get_mut(range) {
                    digits.make_ascii_uppercase();
                }
            });
            fixer.replace(span, fixed)
        });
    }
}

/// Where the digits of `\xAB`, `ꯍ`, `\u{ABC}` are in `value`, and in a regular expression the letter of `\cA`.
fn for_each_escaped_value(value: &[u8], is_regex: bool, visit: &mut dyn FnMut(Range<usize>)) {
    let is_hex = |range: Range<usize>| value.get(range).is_some_and(|it| it.iter().all(u8::is_ascii_hexdigit));
    let (mut at, mut in_escape) = (0, false);
    while let Some(&c) = value.get(at) {
        at += 1;
        if !in_escape {
            in_escape = c == b'\\';
            continue;
        }
        in_escape = false;
        match c {
            b'x' if is_hex(at..at + 2) => {
                visit(at..at + 2);
                at += 2;
            }
            b'u' if value.get(at) == Some(&b'{') => {
                let digits = value.iter().skip(at + 1).take_while(|it| it.is_ascii_hexdigit()).count();
                if value.get(at + 1 + digits) == Some(&b'}') {
                    visit(at + 1..at + 1 + digits);
                    at += digits + 2;
                }
            }
            b'u' if is_hex(at..at + 4) => {
                visit(at..at + 4);
                at += 4;
            }
            b'c' if is_regex && value.get(at).is_some_and(u8::is_ascii_lowercase) => {
                visit(at..at + 1);
                at += 1;
            }
            _ => {}
        }
    }
}

/// ``String.raw`..` ``
fn is_string_raw_tagged_template_expression(node: Node) -> bool {
    let Node::Expr(e) = node else {
        return false;
    };
    let ExprKind::TaggedTemplate(tagged) = e.kind() else {
        return false;
    };
    let tag = tagged.callee();
    matches!(tag.kind(), ExprKind::Dot { obj, name, .. }
        if name.name().is("raw") && obj.is_ident("String") && !obj.is_parenthesized() && !tag.is_parenthesized())
}
