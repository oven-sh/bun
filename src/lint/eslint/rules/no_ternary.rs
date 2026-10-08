use bun_lint::prelude::*;

/// Disallow ternary operators.
pub struct NoTernary;

const NO_TERNARY_OPERATOR: Message = Message::new("noTernaryOperator", "Ternary operator used.");

impl Rule for NoTernary {
    const META: Meta = Meta::eslint("no-ternary", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTernary
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Cond], |_, e, cx| {
            cx.report(e, NO_TERNARY_OPERATOR);
        });
    }
}
