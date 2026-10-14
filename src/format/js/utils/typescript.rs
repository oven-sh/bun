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

/// `| A` and `& A` are a union and an intersection of one type here. Prettier's parsers have them
/// as `A`.
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

/// Those at the start of `comments` for which Prettier's `isEndOfLineComment` holds and
/// `isOwnLineComment` does not: there is code before them on their line, and none after them.
pub(crate) fn end_of_line_comments(comments: &[Comment]) -> &[Comment] {
    let mut count = 0;
    for (index, comment) in comments.iter().enumerate() {
        if comment.preceded_by_newline() {
            break;
        }
        if comment.followed_by_newline() {
            count = index + 1;
        }
    }
    &comments[..count]
}

/// The comments before the union `ty`: those that lead the union, and those that lead its first
/// type.
///
/// Prettier's `shouldAttachToUnionTypeFirstElement`: a block comment on one line, with nothing but
/// blanks and other comments between it and the union.
pub(crate) fn union_leading_comments<'a>(
    ty: TypeNode<'a>,
    f: &Formatter<'a>,
) -> (&'a [Comment], &'a [Comment]) {
    if f.is_quiet() {
        return (&[], &[]);
    }
    let comments = f.comments().comments_before(ty.span().start);
    let mut end = ty.span().start;
    let mut at = comments.len();
    for comment in comments.iter().rev() {
        let is_adjacent = comment.is_block()
            && !comment.is_multiline_block()
            && !f.comments().is_suppression_comment(comment)
            && f.source_text()
                .all_bytes(Span::after(comment.span, end), |b| {
                    matches!(b, b' ' | b'\t')
                });
        if !is_adjacent {
            break;
        }
        end = comment.span.start;
        at -= 1;
    }
    comments.split_at(at)
}

/// Prettier's `shouldHugUnionType` for the union `ty`: it is one object type or name, and otherwise
/// only `null` and `void`.
pub(crate) fn should_hug_type<'a>(
    ty: TypeNode<'a>,
    types: List<'a, TypeNode<'a>>,
    f: &Formatter<'a>,
) -> bool {
    let is_object_like =
        |t: &TypeNode<'a>| matches!(t.kind(), TypeKind::Object(_) | TypeKind::Ref { .. });
    let Some(object_type) = types.iter().find(is_object_like) else {
        return false;
    };
    if !types.iter().all(|t| {
        t == object_type || matches!(t.kind(), TypeKind::Keyword(Keyword::Void | Keyword::Null))
    }) {
        return false;
    }
    // Not if one of the types has a comment.
    if f.is_quiet() {
        return true;
    }
    if !union_leading_comments(ty, f).1.is_empty() {
        return false;
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
