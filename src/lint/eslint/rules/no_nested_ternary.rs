use bun_lint::prelude::*;

/// Disallow nested ternary expressions.
pub struct NoNestedTernary;

const NO_NESTED_TERNARY: Message =
    Message::new("noNestedTernary", "Do not nest ternary expressions.");

impl Rule for NoNestedTernary {
    const META: Meta = Meta::eslint("no-nested-ternary", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Cond]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoNestedTernary
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((_, yes, no)) = e.as_cond()
            && (no.tag() == ExprTag::Cond || yes.tag() == ExprTag::Cond)
        {
            cx.report(e, NO_NESTED_TERNARY);
        }
    }
}
