use crate::js::format::write_trailing_comments_of;
use crate::js::parentheses::ts_type::{effective_parent, needs_parentheses};
use crate::js::siblings::following_span_start_in;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typescript::{end_of_line_comments, should_hug_type, union_leading_comments};
use crate::prelude::*;
use crate::{format_args, write};
use std::cell::Cell;

/// `A | B`. The comments before it are not written yet.
pub(crate) fn write_ts_union_type<'a>(ty: TypeNode<'a>, types: List<'a, TypeNode<'a>>, f: &mut Formatter<'a>) {
    write_ts_union_type_in(ty, types, false, f);
}

/// Prettier's `printUnionType`.
///
/// ```ts
/// A | B | C
///
/// | A
/// | B
/// | C
/// ```
///
/// `is_indented_by_parent`: it is the right side of a type alias, which has a line break and an
/// indentation after the `=`.
pub(crate) fn write_ts_union_type_in<'a>(
    ty: TypeNode<'a>,
    types: List<'a, TypeNode<'a>>,
    is_indented_by_parent: bool,
    f: &mut Formatter<'a>,
) {
    if types.len() == 1 {
        return write!(f, types.first());
    }

    let (leading_comments, _) = union_leading_comments(ty, f);
    let format_leading_comments = FormatLeadingComments::Comments(leading_comments);

    // A `prettier-ignore` comment on a line of its own is about the first type only.
    let suppression = leading_comments.iter().find(|comment| f.comments().is_suppression_comment(comment));
    if suppression.is_some_and(|comment| !comment.preceded_by_newline()) {
        return write!(f, [format_leading_comments, FormatSuppressedNode(ty.span())]);
    }

    // `{ a: string } | null | void` is written like the object type alone.
    if should_hug_type(ty, types, f) {
        write!(f, format_leading_comments);
        f.join_with(" | ").entries(types.iter());
        return;
    }

    let parent = effective_parent(ty.ast_parent());
    let is_one_of_several_tuple_elements =
        matches!(parent, AstNodes::TSTupleType(tuple) if matches!(tuple.kind(), TypeKind::Tuple(it) if it.len() > 1));
    // Prettier's `shouldUnionTypePrintOwnComments`. Otherwise they are outside of the parentheses.
    let prints_own_comments = !is_one_of_several_tuple_elements
        && !matches!(parent, AstNodes::TSUnionType(_) | AstNodes::TSIntersectionType(_));

    let members = UnionMembers {
        ty,
        types,
        parent,
        is_first_type_suppressed: suppression.is_some(),
    };
    let printed = format_with(|f| {
        write!(f, [prints_own_comments.then_some(format_leading_comments), group(&format_args!(if_group_breaks(&"| "), members))]);
        if prints_own_comments {
            write_trailing_comments_of(AstNodes::TSUnionType(ty), f);
            // Prettier does not attach comments to the `: T` of a property signature.
            if f.comments().next_start() != u32::MAX
                && matches!(parent, AstNodes::TSTypeAnnotation(_))
                && matches!(parent.parent(), AstNodes::TSPropertySignature(_))
            {
                write_trailing_comments_of(parent, f);
            }
        }
    });
    if !prints_own_comments {
        write!(f, format_leading_comments);
    }

    if needs_parentheses(ty, f) {
        return write!(f, group(&format_args!(indent(&format_args!(soft_line_break(), printed)), soft_line_break())));
    }
    if is_one_of_several_tuple_elements {
        return write!(
            f,
            group(&format_args!(
                indent(&format_args!(if_group_breaks(&format_args!("(", soft_line_break())), printed)),
                soft_line_break(),
                if_group_breaks(&")")
            ))
        );
    }
    if is_indented_by_parent || !should_indent_union_type(ty, parent) {
        return write!(f, printed);
    }
    write!(f, group(&indent(&format_args!(soft_line_break(), printed))));
}

/// Prettier's `shouldIndentUnionType`.
fn should_indent_union_type<'a>(ty: TypeNode<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        AstNodes::TSTypeAssertion(_) | AstNodes::TSTupleType(_) | AstNodes::TSTypeParameterInstantiation(_) => false,
        AstNodes::TSConditionalType(conditional) => {
            !matches!(conditional.kind(), TypeKind::Cond { yes, no, .. } if yes.span().contains(ty.span()) || no.span().contains(ty.span()))
        }
        _ => true,
    }
}

/// The types of a union that is not on one line with an object type, and the `|` between them.
#[derive(Copy, Clone)]
struct UnionMembers<'a> {
    ty: TypeNode<'a>,
    types: List<'a, TypeNode<'a>>,
    /// What the union is in.
    parent: AstNodes<'a>,
    /// A `prettier-ignore` comment is before the union.
    is_first_type_suppressed: bool,
}

impl<'a> Format<'a> for UnionMembers<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            for (index, member) in self.types.iter().enumerate() {
                if index > 0 {
                    write!(f, [soft_line_break_or_space(), "| "]);
                }
                write!(f, align(2, &member));
            }
            return;
        }

        let is_suppressed = Cell::new(self.is_first_type_suppressed);
        let mut iter = self.types.iter().peekable();
        while let Some(member) = iter.next() {
            let next = iter.peek().copied();
            let (leading_comments, _) = comments_before_member(member, f);

            let format_member = format_with(|f| write_member(member, is_suppressed.get(), f));
            // The comments between it and the next type that do not lead that one.
            let format_trailing_comments = format_with(|f| {
                let comments = match next {
                    Some(next) => {
                        let (comments, start) = comments_before_member(next, f);
                        is_suppressed.set(comments.iter().any(|comment| f.comments().is_suppression_comment(comment)));
                        &comments[..comments.len() - count_leading_comments(comments, start, f)]
                    }
                    None => {
                        // `A | (B /* comment */)`
                        write!(f, FormatTrailingComments::Comments(f.comments().comments_before(self.ty.span().end)));
                        self.comments_after_last_member(f)
                    }
                };
                write!(f, FormatTrailingComments::Comments(comments));
            });

            // The comments after a type are only aligned with it if there are comments before it.
            if leading_comments.is_empty() {
                write!(f, [align(2, &format_member), format_trailing_comments]);
            } else {
                let leading_comments = FormatLeadingComments::Comments(leading_comments);
                write!(f, align(2, &format_args!(leading_comments, format_member, format_trailing_comments)));
            }
            if next.is_some() {
                write!(f, [soft_line_break_or_space(), "| "]);
            }
        }
    }
}

impl<'a> UnionMembers<'a> {
    /// Prettier's `handleLastUnionElementInExpression`: a comment at the end of a line after a union
    /// in parentheses is written after its last type.
    ///
    /// ```ts
    /// type A = (
    ///   | "a" // comment
    ///   | "b" // comment
    /// )[];
    /// ```
    fn comments_after_last_member(&self, f: &Formatter<'a>) -> &'a [Comment] {
        if !matches!(self.parent, AstNodes::TSArrayType(_) | AstNodes::TSUnionType(_) | AstNodes::TSIntersectionType(_)) {
            return &[];
        }
        // Only those that are in the parent.
        let (span, parent_end) = (self.ty.span(), self.parent.span().end);
        let end = match following_span_start_in(span, self.parent) {
            0 => parent_end,
            following => following.min(parent_end),
        };
        end_of_line_comments(f.comments().comments_in_range(span.end, end))
    }
}

/// The comments before `member` that are not written by `member` itself, and where the rest of
/// them, or `member`, starts.
fn comments_before_member<'a>(member: TypeNode<'a>, f: &Formatter<'a>) -> (&'a [Comment], u32) {
    let start = member.span().start;
    match member.kind() {
        TypeKind::Union(types) if types.len() > 1 => {
            let (comments, first_type_comments) = union_leading_comments(member, f);
            (comments, first_type_comments.first().map_or(start, |comment| comment.span.start))
        }
        _ => (f.comments().comments_before(start), start),
    }
}

/// How many of `comments`, which are between two types of a union, lead the second one, which
/// starts at `start`: those that are after the `|` on the line of the type. All others trail the
/// first type (Prettier's `handleUnionTypeComments`).
fn count_leading_comments(comments: &[Comment], start: u32, f: &Formatter<'_>) -> usize {
    let mut end = start;
    let mut count = 0;
    for comment in comments.iter().rev() {
        let is_adjacent = !comment.followed_by_newline()
            && f.source_text().all_bytes_match(comment.span.end, end, |b| b.is_ascii_whitespace() || b == b'(');
        if !is_adjacent {
            break;
        }
        if comment.preceded_by_newline() {
            return 0;
        }
        count += 1;
        end = comment.span.start;
    }
    count
}

/// A type of a union. The comments before it are written, those after it are not.
fn write_member<'a>(member: TypeNode<'a>, is_suppressed: bool, f: &mut Formatter<'a>) {
    let span = member.span();
    if !is_suppressed && !f.comments().has_trailing_suppression_comment(span.end) {
        return match member.kind() {
            // It takes some of the comments after it: see `comments_after_last_member`.
            TypeKind::Union(types) if types.len() > 1 => write!(f, member),
            _ => write!(f, FormatNodeWithoutTrailingComments(&member)),
        };
    }
    let needs_parentheses = needs_parentheses(member, f);
    write!(f, [needs_parentheses.then_some("("), FormatSuppressedNode(span), needs_parentheses.then_some(")")]);
}
