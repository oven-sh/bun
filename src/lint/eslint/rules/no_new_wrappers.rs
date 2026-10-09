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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["String", "Number", "Boolean"]) {
            return;
        }
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
                // Of what is long, oxlint points at `new String`.
                let place = match cx.language().is_oxlint && e.span().len() > 24 {
                    true => e.span().to(call.callee().span()),
                    false => e.span(),
                };
                cx.report(place, NO_CONSTRUCTOR).data("fn", name);
            }
        });
    }
}
