use bun_lint::prelude::*;

/// Disallow `new` operators with calls to `require`.
pub struct NoNewRequire;

const NO_NEW_REQUIRE: Message = Message::new("noNewRequire", "Unexpected use of new with require.");

impl Rule for NoNewRequire {
    const META: Meta = Meta::eslint("no-new-require", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewRequire
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::New], |_, e, cx| {
            if let ExprKind::New(call) = e.kind()
                && call.callee().is_ident("require")
            {
                cx.report(e, NO_NEW_REQUIRE);
            }
        });
    }
}
