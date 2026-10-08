use bun_lint::prelude::*;

/// Disallow non-null assertions using the `!` postfix operator.
pub struct NoNonNullAssertion;

const NO_NON_NULL: Message = Message::new("noNonNull", "Forbidden non-null assertion.");

impl Rule for NoNonNullAssertion {
    const META: Meta = Meta::typescript("no-non-null-assertion", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNonNullAssertion
    }

    fn register<'a>(&'a self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::NonNull], |_, e, cx| {
            cx.report(e, NO_NON_NULL);
        });
    }
}
