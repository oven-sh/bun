use crate::prelude::*;

/// A keyword, a literal, or a name without type arguments.
pub(crate) fn is_simple_type(ty: TypeNode<'_>) -> bool {
    match ty.kind() {
        TypeKind::Keyword(keyword) => keyword != Keyword::Intrinsic,
        TypeKind::Template(_)
        | TypeKind::StringLit(_)
        | TypeKind::NumberLit(_)
        | TypeKind::BigIntLit { .. }
        | TypeKind::BoolLit(_) => true,
        TypeKind::Ref { args, .. } => args.is_empty(),
        _ => false,
    }
}

/// `{ .. }`: a type literal or a mapped type.
pub(crate) fn is_object_like_type(ty: TypeNode<'_>) -> bool {
    matches!(ty.kind(), TypeKind::Object(_) | TypeKind::Mapped(_))
}

/// `| A` and `& A` are a union and an intersection of one type here. Prettier's parsers produce plain `A`.
pub(crate) fn without_lone_operator(mut ty: TypeNode<'_>) -> TypeNode<'_> {
    while let TypeKind::Union(types) | TypeKind::Intersection(types) = ty.kind()
        && types.len() == 1
        && let Some(only) = types.first()
        && !crate::js::print::flow::is_interface_type(ty)
    {
        ty = only;
    }
    ty
}

/// Prettier's `hasLeadingOwnLineComment`: a leading comment of `node` is the last thing on its line.
pub(crate) fn has_leading_own_line_comment<'a>(node: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    !f.is_quiet()
        && (f.comments().of_node(node).leading.iter()).any(|comment| comment.has_newline_after())
}

/// Prettier's `shouldHugUnionType`: `types` are one object type or type reference, and otherwise only `null` and `void`.
///
/// ```ts
/// let a: {
///   b: string;
/// } | null;
/// ```
pub(crate) fn should_hug_type<'a>(types: List<'a, TypeNode<'a>>, f: &Formatter<'a>) -> bool {
    let is_object_like =
        |t: &TypeNode<'a>| matches!(t.kind(), TypeKind::Object(_) | TypeKind::Ref { .. });
    let Some(object_type) = types.iter().find(is_object_like) else {
        return false;
    };
    types.iter().all(|t| {
        t == object_type || matches!(t.kind(), TypeKind::Keyword(Keyword::Void | Keyword::Null))
    }) && (f.is_quiet()
        || !types
            .iter()
            .any(|t| f.comments().has_comments(t.as_ast_nodes())))
}
