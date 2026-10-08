use bun_lint::prelude::*;

/// Disallow `new` operators with the `String`, `Number`, and `Boolean` objects.
pub struct NoNewWrappers;

const NO_CONSTRUCTOR: Message =
    Message::new("noConstructor", "Do not use {{fn}} as a constructor.");

impl Rule for NoNewWrappers {
    const META: Meta = Meta::eslint("no-new-wrappers", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewWrappers
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(call) = e.kind() else {
                return;
            };
            let Some(name) = call.callee().as_ident() else {
                return;
            };
            if !name.is_any(&["String", "Number", "Boolean"]) {
                return;
            }
            if cx.file().global(name.bytes()).is_some()
                && Node::Expr(e).scope().resolve_name(name).is_none()
            {
                cx.report(e, NO_CONSTRUCTOR).data("fn", name);
            }
        });
    }
}
