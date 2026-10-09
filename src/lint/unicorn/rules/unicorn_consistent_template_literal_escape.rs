use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent style for escaping `${` in template literals.
pub struct ConsistentTemplateLiteralEscape;

const CONSISTENT_TEMPLATE_LITERAL_ESCAPE: Message = Message::new("", "Invalid escape sequence in template literal.");

impl Rule for ConsistentTemplateLiteralEscape {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "consistent-template-literal-escape", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ConsistentTemplateLiteralEscape
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Template], |_, e, cx| {
            let ExprKind::Template(template_literal) = e.kind() else {
                return;
            };
            // Its own text only: templates can be in each other.
            for i in 0..template_literal.quasi_count() {
                let (value, quasi_start) = (template_literal.raw(i), template_literal.quasi_span(i).start + 1);
                let mut from = 0;
                while let Some(found) = value.get(from..).and_then(|rest| strings::index_of(rest, b"$\\{")) {
                    if matches!(e.parent(), Node::Expr(it) if it.tag() == ExprTag::TaggedTemplate) {
                        return;
                    }
                    let start = from + found;
                    from = start + 3;
                    // `\$\{`
                    let backslash_count = value.iter().take(start).rev().take_while(|it| **it == b'\\').count();
                    let start = quasi_start + (start - backslash_count % 2) as u32;
                    let error_span = Span::new(start, start + 3 + (backslash_count % 2) as u32);
                    cx.report(error_span, CONSISTENT_TEMPLATE_LITERAL_ESCAPE)
                        .fix(|fixer| fixer.replace(error_span, "\\${"));
                }
            }
        });
    }
}
