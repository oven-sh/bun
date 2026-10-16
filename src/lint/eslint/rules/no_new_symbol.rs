use bun_lint::prelude::*;

/// Disallow `new` operators with the `Symbol` object.
pub struct NoNewSymbol;

const NO_NEW_SYMBOL: Message =
    Message::new("noNewSymbol", "`Symbol` cannot be called as a constructor.");

impl Rule for NoNewSymbol {
    const META: Meta = Meta::eslint("no-new-symbol", Kind::Problem).deprecated().reports_at_the_end();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewSymbol
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("Symbol").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        if callee.is_ident("Symbol") && ast_utils::is_global_reference(callee) {
            cx.report(callee, NO_NEW_SYMBOL);
        }
    }
}
