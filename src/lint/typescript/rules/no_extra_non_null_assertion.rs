use bun_lint::prelude::*;

/// Disallow extra non-null assertions.
pub struct NoExtraNonNullAssertion;

const NO_EXTRA_NON_NULL_ASSERTION: Message =
    Message::new("noExtraNonNullAssertion", "Forbidden extra non-null assertion.");

impl NoExtraNonNullAssertion {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // All but the last `!` of `x!!!`.
        // oxlint points at the `!`.
        let is_oxlint = cx.language().is_oxlint;
        for inner in e.inner_non_null_spans() {
            let assertion = Span::new(inner.end - 1, inner.end);
            cx.report(if is_oxlint { assertion } else { inner }, NO_EXTRA_NON_NULL_ASSERTION)
                .fix(|fixer| fixer.remove(assertion));
        }
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
        let assertion = Span::new(end - 1, end);
        cx.report(if is_oxlint { assertion } else { e.span() }, NO_EXTRA_NON_NULL_ASSERTION)
            .fix(|fixer| fixer.remove(assertion));
    }
}

impl Rule for NoExtraNonNullAssertion {
    const META: Meta = Meta::typescript("no-extra-non-null-assertion", Kind::Problem)
        .fixable(Fixable::Code)
        .recommended();
    const ON: On = On::new().exprs(&[ExprTag::NonNull]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoExtraNonNullAssertion
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}
