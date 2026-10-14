use bun_lint::prelude::*;
use bun_lint::types::tsutils::is_union_type;

/// Enforce that `this` is used when only `this` type is returned.
pub struct PreferReturnThisType;

const USE_THIS_TYPE: Message = Message::new("useThisType", "Use `this` type instead.");

fn try_get_name_in_type<'a>(name: Name<'a>, type_node: TypeNode<'a>, is_oxlint: bool) -> Option<TypeNode<'a>> {
    // tsgolint does not look into a ParenthesizedType.
    if is_oxlint && type_node.is_parenthesized() {
        return None;
    }
    match type_node.kind() {
        TypeKind::Ref { name: type_name, .. } => {
            type_name.as_ident().is_some_and(|it| it.name() == name).then_some(type_node)
        }
        TypeKind::Union(types) => types.iter().find_map(|ty| try_get_name_in_type(name, ty, is_oxlint)),
        _ => None,
    }
}

fn is_function_returning_this<'a>(original_func: Func<'a>, original_class: Class<'a>, is_oxlint: bool) -> bool {
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
        // For tsgolint the type of a class expression is not an InterfaceType: only the keyword counts.
        if is_oxlint && class_type.this_type().is_none() {
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
        if !is_oxlint && is_union_type(ty) && ty.types().contains(class_type) {
            return false;
        }
    }
    has_return_this
}

impl Rule for PreferReturnThisType {
    const META: Meta = Meta::typescript("prefer-return-this-type", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().members();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferReturnThisType
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.has_classes().then_some(())
    }

    fn member<'a>(&self, node: Member<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = node.file().language().is_oxlint;
        // tsgolint listens to MethodDeclaration and PropertyDeclaration only, abstract or not.
        if !is_oxlint && node.flags().contains(Flags::ABSTRACT) {
            return;
        }
        let original_func = match node.kind() {
            MemberKind::Method => node.func(),
            MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor if !is_oxlint => node.func(),
            // For tsgolint the initializer itself is the function, not a ParenthesizedExpression.
            MemberKind::Property => {
                node.init().filter(|init| !is_oxlint || !init.is_parenthesized()).and_then(Expr::as_fn)
            }
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
        let Some(found) = try_get_name_in_type(class_name.name(), return_type, is_oxlint) else {
            return;
        };
        if is_function_returning_this(original_func, original_class, is_oxlint) {
            cx.report(found, USE_THIS_TYPE).fix(|fixer| fixer.replace(found, "this"));
        }
    }
}
