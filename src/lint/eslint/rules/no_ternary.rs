use bun_lint::prelude::*;

/// Disallow ternary operators.
pub struct NoTernary;

const NO_TERNARY_OPERATOR: Message = Message::new("noTernaryOperator", "Ternary operator used.");

impl Rule for NoTernary {
    const META: Meta = Meta::eslint("no-ternary", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Cond]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoTernary
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        cx.report(e, NO_TERNARY_OPERATOR);
    }
}
