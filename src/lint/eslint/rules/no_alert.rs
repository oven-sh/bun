use bun_lint::prelude::*;

/// Disallow the use of `alert`, `confirm`, and `prompt`.
pub struct NoAlert;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected {{name}}.");

const PROHIBITED: [&str; 3] = ["alert", "confirm", "prompt"];

fn is_prohibited_identifier(name: &[u8]) -> bool {
    PROHIBITED.iter().any(|it| it.as_bytes() == name)
}

/// Something in the file declares what the identifier refers to.
fn is_shadowed(identifier: Expr) -> bool {
    identifier.reference().is_some_and(|it| it.symbol().is_some())
}

/// `object`, which is in `call`, is `this` in the global scope, `window` or `globalThis`.
fn is_global_this_reference_or_global_window<'a>(call: Expr<'a>, object: Expr<'a>) -> bool {
    match object.kind() {
        // oxc has one scope for a file, whatever it takes it for.
        ExprKind::This if call.file().language().is_oxlint => {
            matches!(Node::Expr(call).scope().kind(), ScopeKind::Global | ScopeKind::Module)
        }
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
    const ON: On = On::new().calls_named(&PROHIBITED);
    /// Those of [`PROHIBITED`] that the file mentions.
    type State<'a> = [Option<Name<'a>>; 3];

    fn new(_: &Options) -> Self {
        NoAlert
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions_any(&PROHIBITED) { Self::ON } else { On::new() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let mentioned = PROHIBITED.map(|it| file.find_name(it));
        mentioned.iter().any(Option::is_some).then_some(mentioned)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let callee = call.callee();
        let name = match callee.tag() {
            ExprTag::Ident => callee.as_ident(),
            ExprTag::Dot => callee.member_name().map(Ident::name),
            ExprTag::Index => None,
            _ => return,
        };
        if name.is_some() && !cx.state.contains(&name) {
            return;
        }
        // oxlint points at what is called.
        let place = if cx.language().is_oxlint { callee.span() } else { e.span() };
        match callee.kind() {
            ExprKind::Ident(name) => {
                if !is_shadowed(callee) {
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
    }
}
