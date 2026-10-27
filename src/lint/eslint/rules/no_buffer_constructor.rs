use bun_lint::prelude::*;

/// Disallow use of the `Buffer()` constructor.
pub struct NoBufferConstructor;

const DEPRECATED: Message = Message::new(
    "deprecated",
    "{{expr}} is deprecated. Use Buffer.from(), Buffer.alloc(), or Buffer.allocUnsafe() instead.",
);

impl Rule for NoBufferConstructor {
    const META: Meta = Meta::eslint("no-buffer-constructor", Kind::Problem).deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoBufferConstructor
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("Buffer") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (call, expr) = match e.kind() {
            ExprKind::Call(call) => (call, "Buffer()"),
            ExprKind::New(call) => (call, "new Buffer()"),
            _ => return,
        };
        if call.callee().is_ident("Buffer") {
            cx.report(e, DEPRECATED).data("expr", expr);
        }
    }
}
