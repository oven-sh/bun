use bun_lint::prelude::*;

/// Disallow the use of `arguments.caller` or `arguments.callee`.
pub struct NoCaller;

const UNEXPECTED: Message = Message::new("unexpected", "Avoid arguments.{{prop}}.");

impl Rule for NoCaller {
    const META: Meta = Meta::eslint("no-caller", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCaller
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Dot], |_, e, cx| {
            let ExprKind::Dot { obj, name, .. } = e.kind() else {
                return;
            };
            // The `name` of ESLint's `PrivateIdentifier` is without the `#`.
            let prop = name.bytes();
            let prop = prop.strip_prefix(b"#").unwrap_or(prop);
            if matches!(prop, b"callee" | b"caller") && obj.is_ident("arguments") && ast_utils::is_member_expression(e) {
                cx.report(e, UNEXPECTED).data("prop", prop);
            }
        });
    }
}
