use bun_lint::prelude::*;

/// Disallow the use of `arguments.caller` or `arguments.callee`.
pub struct NoCaller;

const UNEXPECTED: Message = Message::new("unexpected", "Avoid arguments.{{prop}}.");

impl Rule for NoCaller {
    const META: Meta = Meta::eslint("no-caller", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Dot]).types(&[TypeTag::Ref]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCaller
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("arguments") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { obj, name, .. } = e.kind() else {
            return;
        };
        // The `name` of ESLint's `PrivateIdentifier` is without the `#`.
        let prop = name.bytes();
        let prop = prop.strip_prefix(b"#").unwrap_or(prop);
        if matches!(prop, b"callee" | b"caller") && obj.is_ident("arguments") && ast_utils::is_member_expression(e) {
            // oxlint points at the property.
            let place = if cx.language().is_oxlint { name.span() } else { e.span() };
            cx.report(place, UNEXPECTED).data("prop", prop);
        }
    }

    // What a class implements and what an interface extends is a `MemberExpression` too.
    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Ref { name, .. } = ty.kind()
            && let (Some(object), Some(property)) = (name.get(0), name.get(1))
            && object.name().is("arguments")
            && property.name().is_any(&["callee", "caller"])
            && utils::estree_type_name(Node::Type(ty)) != "TSTypeReference"
        {
            cx.report(object.span().to(property.span()), UNEXPECTED).data("prop", property.bytes());
        }
    }
}
