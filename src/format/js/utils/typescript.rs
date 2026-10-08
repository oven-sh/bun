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

/// Prettier's `shouldHugUnionType` for the union `ty`: it is one object type or name, and otherwise
/// only `null` and `void`.
pub(crate) fn should_hug_type<'a>(ty: TypeNode<'a>, types: List<'a, TypeNode<'a>>, f: &Formatter<'a>) -> bool {
    let is_object_like = |t: &TypeNode<'a>| matches!(t.kind(), TypeKind::Object(_) | TypeKind::Ref { .. });
    let Some(object_type) = types.iter().find(is_object_like) else {
        return false;
    };
    if !types.iter().all(|t| t == object_type || matches!(t.kind(), TypeKind::Keyword(Keyword::Void | Keyword::Null))) {
        return false;
    }
    // Not if there are comments between the types.
    if f.is_quiet() {
        return true;
    }
    let mut start = ty.span().start;
    for t in types {
        if f.comments().has_comment_in_range(start, t.span().start) {
            return false;
        }
        start = t.span().end;
    }
    true
}
