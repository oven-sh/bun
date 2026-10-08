use bun_lint::prelude::*;

/// Disallow `new` operators with global non-constructor functions.
pub struct NoNewNativeNonconstructor;

const NO_NEW_NONCONSTRUCTOR: Message = Message::new(
    "noNewNonconstructor",
    "`{{name}}` cannot be called as a constructor.",
);

impl Rule for NoNewNativeNonconstructor {
    const META: Meta = Meta::eslint("no-new-native-nonconstructor", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewNativeNonconstructor
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(call) = e.kind() else {
                return;
            };
            let callee = call.callee();
            let Some(name) = callee.as_ident() else {
                return;
            };
            if !name.is_any(&["Symbol", "BigInt"]) {
                return;
            }
            // typescript-eslint always has the variables, from the default library.
            if ast_utils::is_global_reference(callee)
                || (!cx.is_javascript() && callee.symbol().is_none())
            {
                cx.report(callee, NO_NEW_NONCONSTRUCTOR).data("name", name);
            }
        });
    }
}
