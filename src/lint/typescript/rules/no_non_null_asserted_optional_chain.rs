use bun_lint::prelude::*;

/// Disallow non-null assertions after an optional chain expression.
pub struct NoNonNullAssertedOptionalChain;

const NO_NON_NULL_OPTIONAL_CHAIN: Message = Message::new(
    "noNonNullOptionalChain",
    "Optional chain expressions can return undefined by design - using a non-null assertion is unsafe and wrong.",
);
const SUGGEST_REMOVING_NON_NULL: Message =
    Message::new("suggestRemovingNonNull", "You should remove the non-null assertion.");

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
            // `(x?.y)!` is reported at the chain, `x?.y!` at the assertion.
            let at = if operand.is_chain_root() {
                operand
            } else if e.is_chain_root() {
                e
            } else {
                return;
            };
            let end = e.span().end;
            cx.report(at, NO_NON_NULL_OPTIONAL_CHAIN)
                .suggest(SUGGEST_REMOVING_NON_NULL, |fixer| fixer.remove(Span::new(end.saturating_sub(1), end)));
        });
    }
}
