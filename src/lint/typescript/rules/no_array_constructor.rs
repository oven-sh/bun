use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_array_constructor::{as_array_call, get_arguments_text};

/// Disallow generic `Array` constructors.
pub struct NoArrayConstructor;

const USE_LITERAL: Message = Message::new(
    "useLiteral",
    "The array literal notation [] is preferable.",
);

impl NoArrayConstructor {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = as_array_call(e) else {
            return;
        };
        if call.args().len() == 1 {
            return;
        }
        cx.report(e, USE_LITERAL)
            .fix(|fixer| fixer.replace(e, [&b"["[..], get_arguments_text(e, call), b"]"].concat()));
    }
}

impl Rule for NoArrayConstructor {
    const META: Meta = Meta::typescript("no-array-constructor", Kind::Suggestion)
        .fixable(Fixable::Code)
        .recommended()
        .extends_base_rule("no-array-constructor");
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoArrayConstructor
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call, ExprTag::New], Self::check);
    }
}
