use bun_lint::prelude::*;

/// Disallow use of the `Buffer()` constructor.
pub struct NoBufferConstructor;

const DEPRECATED: Message = Message::new(
    "deprecated",
    "{{expr}} is deprecated. Use Buffer.from(), Buffer.alloc(), or Buffer.allocUnsafe() instead.",
);

impl Rule for NoBufferConstructor {
    const META: Meta = Meta::eslint("no-buffer-constructor", Kind::Problem).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoBufferConstructor
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call, ExprTag::New], |_, e, cx| {
            let (call, expr) = match e.kind() {
                ExprKind::Call(call) => (call, "Buffer()"),
                ExprKind::New(call) => (call, "new Buffer()"),
                _ => return,
            };
            if call.callee().is_ident("Buffer") {
                cx.report(e, DEPRECATED).data("expr", expr);
            }
        });
    }
}
