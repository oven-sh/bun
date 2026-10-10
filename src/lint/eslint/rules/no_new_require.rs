use bun_lint::prelude::*;

/// Disallow `new` operators with calls to `require`.
pub struct NoNewRequire;

const NO_NEW_REQUIRE: Message = Message::new("noNewRequire", "Unexpected use of new with require.");

impl Rule for NoNewRequire {
    const META: Meta = Meta::eslint("no-new-require", Kind::Suggestion).deprecated();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewRequire
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("require").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::New(call) = e.kind()
            && call.callee().is_ident("require")
        {
            cx.report(e, NO_NEW_REQUIRE);
        }
    }
}
