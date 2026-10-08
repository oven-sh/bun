use bun_lint::prelude::*;

/// Disallow `new` operators with the `Symbol` object.
pub struct NoNewSymbol;

const NO_NEW_SYMBOL: Message =
    Message::new("noNewSymbol", "`Symbol` cannot be called as a constructor.");

impl Rule for NoNewSymbol {
    const META: Meta = Meta::eslint("no-new-symbol", Kind::Problem).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewSymbol
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Symbol") {
            return;
        }
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(call) = e.kind() else {
                return;
            };
            let callee = call.callee();
            if callee.is_ident("Symbol") && ast_utils::is_global_reference(callee) {
                cx.report(callee, NO_NEW_SYMBOL);
            }
        });
    }
}
