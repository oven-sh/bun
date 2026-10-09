use bun_lint::prelude::*;

/// Disallow the use of `alert`, `confirm`, and `prompt`.
pub struct NoAlert;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected {{name}}.");

fn is_prohibited_identifier(name: &[u8]) -> bool {
    matches!(name, b"alert" | b"confirm" | b"prompt")
}

/// Something in the file declares what the identifier refers to.
fn is_shadowed(identifier: Expr) -> bool {
    identifier.reference().is_some_and(|it| it.symbol().is_some())
}

/// `object`, which is in `call`, is `this` in the global scope, `window` or `globalThis`.
fn is_global_this_reference_or_global_window<'a>(call: Expr<'a>, object: Expr<'a>) -> bool {
    match object.kind() {
        ExprKind::This => Node::Expr(call).scope().kind() == ScopeKind::Global,
        ExprKind::Ident(name) => match name.bytes() {
            b"window" => !is_shadowed(object),
            b"globalThis" => !is_shadowed(object) && object.file().global(b"globalThis").is_some(),
            _ => false,
        },
        _ => false,
    }
}

impl Rule for NoAlert {
    const META: Meta = Meta::eslint("no-alert", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAlert
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["alert", "confirm", "prompt"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let ExprKind::Call(call) = e.kind() else {
                return;
            };
            let callee = call.callee();
            // oxlint points at what is called.
            let place = if cx.language().is_oxlint { callee.span() } else { e.span() };
            match callee.kind() {
                ExprKind::Ident(name) => {
                    if is_prohibited_identifier(name.bytes()) && !is_shadowed(callee) {
                        cx.report(place, UNEXPECTED).data("name", name);
                    }
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    if let Some(name) = ast_utils::get_static_property_name(callee)
                        && is_prohibited_identifier(&name)
                        && is_global_this_reference_or_global_window(e, obj)
                    {
                        cx.report(place, UNEXPECTED).data("name", name);
                    }
                }
                _ => {}
            }
        });
    }
}
