use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_loss_of_precision::{ON, expr, member, pat, prop, ty};

/// Disallow literal numbers that lose precision.
pub struct NoLossOfPrecision;

impl Rule for NoLossOfPrecision {
    const META: Meta = Meta::typescript("no-loss-of-precision", Kind::Problem)
        .deprecated()
        .extends_base_rule("no-loss-of-precision");
    const ON: On = ON;
    no_state!();

    fn new(_: &Options) -> Self {
        NoLossOfPrecision
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        expr(e, cx);
    }

    fn ty<'a>(&self, it: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        ty(it, cx);
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        pat(pattern, cx);
    }

    fn member<'a>(&self, it: Member<'a>, cx: &mut Cx<'a, Self>) {
        member(it, cx);
    }

    fn prop<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        prop(property, cx);
    }
}
