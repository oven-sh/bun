use bun_lint::prelude::*;

/// Disallow returning values from setters.
pub struct NoSetterReturn;

const RETURNS_VALUE: Message = Message::new("returnsValue", "Setter cannot return a value.");

/// ESLint's `isSetter`: a setter of an object literal or a class, or the `set` of a property
/// descriptor. oxlint does not look at property descriptors.
fn is_setter(func: Func, is_oxlint: bool) -> bool {
    if func.kind() == FnKind::Setter {
        return true;
    }
    if !is_oxlint
        && let Node::Expr(e) = func.owner()
        && let Node::Prop(prop) = e.parent()
        && prop.value() == Some(e)
        && prop.kind() != PropKind::Spread
        && ast_utils::get_static_property_name(prop).is_some_and(|name| &*name == b"set")
        && let Node::Expr(object) = prop.parent()
    {
        return matches!(object.kind(), ExprKind::Object(_)) && ast_utils::is_property_descriptor(object);
    }
    false
}

impl Rule for NoSetterReturn {
    const META: Meta = Meta::eslint("no-setter-return", Kind::Problem).recommended();
    const ON: On = On::new().funcs();
    no_state!();

    fn new(_: &Options) -> Self {
        NoSetterReturn
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !func.has_body() || !is_setter(func, cx.language().is_oxlint) {
            return;
        }
        if let FnBody::Expr(body) = func.body() {
            cx.report(body, RETURNS_VALUE);
        }
        for statement in func.returns() {
            if let StmtKind::Return(Some(_)) = statement.kind() {
                cx.report(statement, RETURNS_VALUE);
            }
        }
    }
}
