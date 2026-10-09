use bun_lint::prelude::*;

/// Disallow non-null assertions after an optional chain expression.
pub struct NoNonNullAssertedOptionalChain;

const NO_NON_NULL_OPTIONAL_CHAIN: Message = Message::new(
    "noNonNullOptionalChain",
    "Optional chain expressions can return undefined by design - using a non-null assertion is unsafe and wrong.",
);
const SUGGEST_REMOVING_NON_NULL: Message =
    Message::new("suggestRemovingNonNull", "You should remove the non-null assertion.");

/// What oxlint 1.87 does: each `!` is reported by itself, where it is, and what only concerns types is seen through, so
/// that `(a?.b as T)!` is reported too.
fn check_as_oxlint<'a>(e: Expr<'a>, operand: Expr<'a>, cx: &mut Cx<'a, NoNonNullAssertedOptionalChain>) {
    let mut inner = operand;
    while !inner.is_chain_root()
        && let ExprKind::As { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::NonNull(expr)
        | ExprKind::Instantiation { expr, .. } = inner.kind()
    {
        inner = expr;
    }
    let is_whole_chain = inner.is_chain_root();
    if !is_whole_chain && inner.chain() == Chain::No {
        return;
    }
    // In `a?.b!.c` the assertion is about `a?.b` where there is an `a`.
    let last = (is_whole_chain || e.is_chain_root()).then(|| e.span());
    for assertion in e.inner_non_null_spans().chain(last) {
        let mark = Span::new(assertion.end.saturating_sub(1), assertion.end);
        cx.report(mark, NO_NON_NULL_OPTIONAL_CHAIN).suggest(SUGGEST_REMOVING_NON_NULL, |fixer| fixer.remove(mark));
    }
}

impl Rule for NoNonNullAssertedOptionalChain {
    const META: Meta = Meta::typescript("no-non-null-asserted-optional-chain", Kind::Problem)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNonNullAssertedOptionalChain
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::NonNull], |_, e, cx| {
            let ExprKind::NonNull(operand) = e.kind() else {
                return;
            };
            if cx.file().language().is_oxlint {
                return check_as_oxlint(e, operand, cx);
            }
            let remove_assertion = |at: Expr<'a>, assertion: Span| {
                let end = assertion.end;
                cx.report(at, NO_NON_NULL_OPTIONAL_CHAIN)
                    .suggest(SUGGEST_REMOVING_NON_NULL, |fixer| fixer.remove(Span::new(end.saturating_sub(1), end)));
            };
            // `(x?.y)!` is reported at the chain, `x?.y!` at the assertion. `(x?.y!)!` is both, at the
            // same place, the outer one first.
            let is_operand_of_assertion =
                |it: Expr<'a>| matches!(it.parent(), Node::Expr(parent) if parent.tag() == ExprTag::NonNull);
            if operand.is_chain_root() {
                // Of `(x?.y)!!`, the first `!`.
                remove_assertion(operand, e.inner_non_null_spans().next().unwrap_or_else(|| e.span()));
                if operand.tag() == ExprTag::NonNull {
                    remove_assertion(operand, operand.span());
                }
            } else if e.is_chain_root() && !is_operand_of_assertion(e) {
                remove_assertion(e, e.span());
            }
        });
    }
}
