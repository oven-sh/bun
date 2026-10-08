use bun_lint::prelude::*;

/// Disallow nested ternary expressions.
pub struct NoNestedTernary;

const NO_NESTED_TERNARY: Message =
    Message::new("noNestedTernary", "Do not nest ternary expressions.");

impl Rule for NoNestedTernary {
    const META: Meta = Meta::eslint("no-nested-ternary", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNestedTernary
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Cond], |_, e, cx| {
            if let ExprKind::Cond { yes, no, .. } = e.kind()
                && (no.tag() == ExprTag::Cond || yes.tag() == ExprTag::Cond)
            {
                cx.report(e, NO_NESTED_TERNARY);
            }
        });
    }
}
