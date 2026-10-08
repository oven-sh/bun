use bun_lint::prelude::*;
use bun_lint::types::tsutils::is_union_type;

/// Enforce that `this` is used when only `this` type is returned.
pub struct PreferReturnThisType;

const USE_THIS_TYPE: Message = Message::new("useThisType", "Use `this` type instead.");

fn try_get_name_in_type<'a>(name: Name<'a>, type_node: TypeNode<'a>) -> Option<TypeNode<'a>> {
    match type_node.kind() {
        TypeKind::Ref { name: type_name, .. } => {
            type_name.as_ident().is_some_and(|it| it.name() == name).then_some(type_node)
        }
        TypeKind::Union(types) => types.iter().find_map(|ty| try_get_name_in_type(name, ty)),
        _ => None,
    }
}

fn is_function_returning_this<'a>(original_func: Func<'a>, original_class: Class<'a>) -> bool {
    if original_func.this_param().is_some() {
        return false;
    }
    let body = original_func.body();
    if matches!(body, FnBody::None) {
        return false;
    }
    // Of a class expression it is the type of the constructor, which has no `this` type.
    let class_type = original_class.type_at_location();
    if let FnBody::Expr(body) = body {
        return class_type.this_type() == Some(body.ty());
    }

    let mut has_return_this = false;
    for statement in original_func.returns() {
        let StmtKind::Return(Some(expr)) = statement.kind() else {
            continue;
        };
        if matches!(expr.kind(), ExprKind::This) && !expr.is_parenthesized() {
            has_return_this = true;
            continue;
        }
        let ty = expr.ty();
        if class_type == ty {
            return false;
        }
        if class_type.this_type() == Some(ty) {
            has_return_this = true;
            continue;
        }
        if is_union_type(ty) && ty.types().contains(class_type) {
            return false;
        }
    }
    has_return_this
}

impl PreferReturnThisType {
    fn check_member<'a>(&self, node: Member<'a>, cx: &mut Cx<'a, Self>) {
        if node.flags().contains(Flags::ABSTRACT) {
            return;
        }
        let original_func = match node.kind() {
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor => node.func(),
            MemberKind::Property => node.init().and_then(Expr::as_fn),
            _ => None,
        };
        let Some(original_func) = original_func else {
            return;
        };
        let Some(return_type) = original_func.return_type() else {
            return;
        };
        let Node::Class(original_class) = node.parent() else {
            return;
        };
        let Some(class_name) = original_class.name() else {
            return;
        };
        let Some(found) = try_get_name_in_type(class_name.name(), return_type) else {
            return;
        };
        if is_function_returning_this(original_func, original_class) {
            cx.report(found, USE_THIS_TYPE).fix(|fixer| fixer.replace(found, "this"));
        }
    }
}

impl Rule for PreferReturnThisType {
    const META: Meta = Meta::typescript("prefer-return-this-type", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferReturnThisType
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_classes() {
            on.members(Self::check_member);
        }
    }
}
