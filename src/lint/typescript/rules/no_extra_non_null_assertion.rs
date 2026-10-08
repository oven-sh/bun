use bun_lint::prelude::*;

/// Disallow extra non-null assertions.
pub struct NoExtraNonNullAssertion;

const NO_EXTRA_NON_NULL_ASSERTION: Message =
    Message::new("noExtraNonNullAssertion", "Forbidden extra non-null assertion.");

impl NoExtraNonNullAssertion {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(parent) = e.parent() else {
            return;
        };
        let is_extra = match parent.kind() {
            ExprKind::Call(call) => call.is_optional() && call.callee() == e,
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                chain == Chain::Start && obj == e
            }
            ExprKind::NonNull(_) => true,
            _ => false,
        };
        // `(a?.b!)!`: there is a `ChainExpression` between the two.
        if !is_extra || e.is_chain_root() {
            return;
        }
        let end = e.span().end;
        cx.report(e, NO_EXTRA_NON_NULL_ASSERTION)
            .fix(|fixer| fixer.remove(Span::new(end - 1, end)));
    }
}

impl Rule for NoExtraNonNullAssertion {
    const META: Meta = Meta::typescript("no-extra-non-null-assertion", Kind::Problem)
        .fixable(Fixable::Code)
        .recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExtraNonNullAssertion
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::NonNull], Self::check);
    }
}
