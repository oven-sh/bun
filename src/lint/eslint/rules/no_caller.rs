use bun_lint::prelude::*;

/// Disallow the use of `arguments.caller` or `arguments.callee`.
pub struct NoCaller;

const UNEXPECTED: Message = Message::new("unexpected", "Avoid arguments.{{prop}}.");

/// Whether ESLint has a `MemberExpression` for the `Dot`: not in the name of a JSX element, and not
/// in the operand of a `typeof` type.
// TODO(api): replace by utils::ast_utils::is_member_expression
fn is_member_expression(e: Expr<'_>) -> bool {
    let mut at = e;
    loop {
        match at.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot { obj, .. } if obj == at => at = parent,
                ExprKind::Jsx(jsx) => return jsx.tag() != Some(at) && jsx.close_tag() != Some(at),
                _ => return true,
            },
            Node::Type(ty) => return !matches!(ty.kind(), TypeKind::Typeof { .. }),
            _ => return true,
        }
    }
}

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
            if matches!(prop, b"callee" | b"caller") && obj.is_ident("arguments") && is_member_expression(e) {
                cx.report(e, UNEXPECTED).data("prop", prop);
            }
        });
    }
}
