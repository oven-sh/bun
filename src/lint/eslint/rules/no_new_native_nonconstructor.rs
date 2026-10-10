use bun_lint::prelude::*;

/// Disallow `new` operators with global non-constructor functions.
pub struct NoNewNativeNonconstructor;

const NO_NEW_NONCONSTRUCTOR: Message = Message::new(
    "noNewNonconstructor",
    "`{{name}}` cannot be called as a constructor.",
);

impl Rule for NoNewNativeNonconstructor {
    const META: Meta = Meta::eslint("no-new-native-nonconstructor", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewNativeNonconstructor
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(&["Symbol", "BigInt"]).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
            // oxlint points at the `new`.
            let start = e.span().start;
            let place = if cx.language().is_oxlint { Span::new(start, start + 3) } else { callee.span() };
            cx.report(place, NO_NEW_NONCONSTRUCTOR).data("name", name);
        }
    }
}
