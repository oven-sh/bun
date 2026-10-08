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
pub(crate) fn write_ts_union_type<'a>(
    ty: TypeNode<'a>,
    types: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
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
    let suppression = leading_comments
        .iter()
        .find(|comment| f.comments().is_suppression_comment(comment));
    if suppression.is_some_and(|comment| !comment.preceded_by_newline()) {
        return write!(
            f,
            [format_leading_comments, FormatSuppressedNode(ty.span())]
        );
    }

    // `{ a: string } | null | void` is written like the object type alone.
    if should_hug_type(ty, types, f) {
        write!(f, format_leading_comments);
        f.join_with(" | ").entries(types.iter());
        return;
    }

    let parent = effective_parent(ty.ast_parent());
    let is_one_of_several_tuple_elements = matches!(parent, AstNodes::TSTupleType(tuple) if matches!(tuple.kind(), TypeKind::Tuple(it) if it.len() > 1));
    // Prettier's `shouldUnionTypePrintOwnComments`. Otherwise they are outside of the parentheses.
    let prints_own_comments = !is_one_of_several_tuple_elements
        && !matches!(
            parent,
            AstNodes::TSUnionType(_) | AstNodes::TSIntersectionType(_)
        );

    let members = UnionMembers {
        ty,
        types,
        parent,
        is_first_type_suppressed: suppression.is_some()
            || follows_printed_suppression_comment(ty, f),
    };
    if union_breaks_one_per_line(f) {
        return write_union_one_per_line(&members, is_one_of_several_tuple_elements, f);
    }

    let printed = format_with(|f| {
        write!(
            f,
            [
                prints_own_comments.then_some(format_leading_comments),
                group(&format_args!(if_group_breaks(&"| "), members))
            ]
        );
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
        return write!(
            f,
            group(&format_args!(
                indent(&format_args!(soft_line_break(), printed)),
                soft_line_break()
            ))
        );
    }
    if is_one_of_several_tuple_elements {
        return write!(
            f,
            group(&format_args!(
                indent(&format_args!(
                    if_group_breaks(&format_args!("(", soft_line_break())),
                    printed
                )),
                soft_line_break(),
                if_group_breaks(&")")
            ))
        );
    }
    if is_indented_by_parent || !should_indent_union_type(ty, parent) {
        return write!(f, printed);
    }
    // With `experimentalTernaries` the type after `extends` is in parentheses that start with a line break. This is a second
    // one, and Prettier writes both.
    let is_after_line_break = f.options().experimental_ternaries
        && matches!(parent, AstNodes::TSConditionalType(it) if matches!(it.kind(), TypeKind::Cond { extends, .. } if extends.span().contains(ty.span())));
    let line = if is_after_line_break {
        soft_empty_line()
    } else {
        soft_line_break()
    };
    write!(f, group(&indent(&format_args!(line, printed))));
}

/// Whether what the union `ty` is in has written a `prettier-ignore` comment that leads it, outside
/// of its parentheses.
fn follows_printed_suppression_comment<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    if !f.comments().has_suppression_comments() {
        return false;
    }
    let mut end = ty.span().start;
    for comment in f.comments().printed_comments().iter().rev() {
        let is_adjacent = !comment.is_moved()
            && comment.span.end <= end
            && f.source_text().all_bytes_match(comment.span.end, end, |b| {
                b.is_ascii_whitespace() || b == b'('
            });
        if !is_adjacent {
            return false;
        }
        if f.comments().is_suppression_comment(comment) {
            // At the end of a line it trails what is before it.
            return comment.preceded_by_newline();
        }
        end = comment.span.start;
    }
    false
}

/// oxfmt follows Prettier 3.8: a union that does not fit where it is has each type on a line of its
/// own. 3.9 first tries all of them on one line, after a line break.
///
/// ```ts
/// type A =              type A =
///   | "aaaaaaaaaa"        "aaaaaaaaaa" | "bbbbbbbbbb";
///   | "bbbbbbbbbb";
/// ```
pub(crate) fn union_breaks_one_per_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// oxc's `TSUnionType::write`, which is `printUnionType` of Prettier 3.8, for a union that is not
/// written like an object type.
fn write_union_one_per_line<'a>(
    members: &UnionMembers<'a>,
    is_one_of_several_tuple_elements: bool,
    f: &mut Formatter<'a>,
) {
    let leading_comments = match f.is_quiet() {
        true => &[][..],
        false => f.comments().comments_before(members.ty.span().start),
    };
    let is_after_code_at_end_of_line = |comment: &Comment| {
        comment.is_block() && !comment.preceded_by_newline() && comment.followed_by_newline()
    };
    let is_jsdoc = |comment: &Comment| f.source_text().text_for(comment).starts_with(b"/**");
    let is_in_type_alias = matches!(members.parent, AstNodes::TSTypeAliasDeclaration(_));

    let should_indent = match members.parent {
        AstNodes::TSTypeAssertion(_)
        | AstNodes::TSTupleType(_)
        | AstNodes::TSTypeParameterInstantiation(_) => false,
        // The line break after the `=`, which a comment forces, comes with an indentation.
        AstNodes::TSTypeAliasDeclaration(statement) => {
            !leading_comments
                .iter()
                .any(|comment| is_after_code_at_end_of_line(comment) && is_jsdoc(comment))
                && !f
                    .comments()
                    .printed_comments()
                    .last()
                    .is_some_and(|comment| {
                        comment.followed_by_newline()
                            && comment.span.start > statement.span_without_export().start
                    })
        }
        _ => true,
    };
    let needs_parentheses = needs_parentheses(members.ty, f);
    let starts_with_line_break = should_indent && leading_comments.is_empty();
    let types = format_with(|f| {
        let first_separator = format_args!(
            starts_with_line_break.then_some(soft_line_break_or_space()),
            "| "
        );
        write!(f, [if_group_breaks(&first_separator), members]);
    });
    let content = format_with(|f| {
        if needs_parentheses {
            write!(f, [indent(&types), soft_line_break()]);
        } else if is_one_of_several_tuple_elements {
            write!(
                f,
                [
                    indent(&format_args!(
                        if_group_breaks(&format_args!("(", soft_line_break())),
                        types
                    )),
                    soft_line_break(),
                    if_group_breaks(&")")
                ]
            );
        } else {
            write!(f, types);
        }
    });

    // `| (A | B)`
    let is_only_type = matches!(members.ty.ast_parent(), AstNodes::TSUnionType(_))
        && !matches!(members.parent, AstNodes::TSUnionType(_));
    let has_end_of_line_comment = leading_comments
        .iter()
        .any(|comment| comment.followed_by_newline());
    let has_own_line_comment = leading_comments
        .iter()
        .any(|comment| comment.preceded_by_newline())
        || (is_in_type_alias
            && leading_comments
                .iter()
                .any(|it| is_after_code_at_end_of_line(it) && !is_jsdoc(it)));
    let breaks_before_comments = match is_only_type {
        true => has_end_of_line_comment,
        false => has_own_line_comment,
    };
    let breaks_after_comments = is_only_type && has_own_line_comment && !has_end_of_line_comment;
    let inner = format_with(|f| {
        write!(
            f,
            [
                breaks_before_comments.then_some(soft_line_break()),
                FormatLeadingComments::Comments(leading_comments),
                breaks_after_comments.then_some(soft_line_break()),
                group(&content)
            ]
        );
    });
    match should_indent && !needs_parentheses {
        true => write!(f, group(&indent(&inner))),
        false => write!(f, group(&inner)),
    }
}

/// Prettier's `shouldIndentUnionType`.
fn should_indent_union_type<'a>(ty: TypeNode<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        AstNodes::TSTypeAssertion(_)
        | AstNodes::TSTupleType(_)
        | AstNodes::TSTypeParameterInstantiation(_) => false,
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
        if f.is_quiet() && !self.is_first_type_suppressed {
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
            let is_suppression = |comment: &Comment| f.comments().is_suppression_comment(comment);
            // A `prettier-ignore` comment leads it, or trails it with the `|` behind it.
            let is_member_suppressed = is_suppressed.get()
                || leading_comments.iter().any(is_suppression)
                || next.is_some_and(|next| {
                    let comments = f
                        .comments()
                        .comments_in_range(member.span().end, next.span().start);
                    let trailing =
                        comments.len() - count_leading_comments(comments, next.span().start, f);
                    comments[..trailing]
                        .iter()
                        .any(|comment| is_suppression(comment) && !comment.preceded_by_newline())
                });

            let format_member = format_with(|f| write_member(member, is_member_suppressed, f));
            // The comments between it and the next type that do not lead that one.
            let format_trailing_comments = format_with(|f| {
                let comments = match next {
                    Some(next) => {
                        let (comments, start) = comments_before_member(next, f);
                        // Prettier's `handleUnionTypeComments`: on a line of its own it is about the next type.
                        is_suppressed.set(comments.iter().any(|comment| {
                            f.comments().is_suppression_comment(comment)
                                && comment.preceded_by_newline()
                        }));
                        &comments[..comments.len() - count_leading_comments(comments, start, f)]
                    }
                    None => {
                        // `A | (B /* comment */)`
                        write!(
                            f,
                            FormatTrailingComments::Comments(
                                f.comments().comments_before(self.ty.span().end)
                            )
                        );
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
                write!(
                    f,
                    align(
                        2,
                        &format_args!(leading_comments, format_member, format_trailing_comments)
                    )
                );
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
        if !matches!(
            self.parent,
            AstNodes::TSArrayType(_) | AstNodes::TSUnionType(_) | AstNodes::TSIntersectionType(_)
        ) {
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
            (
                comments,
                first_type_comments
                    .first()
                    .map_or(start, |comment| comment.span.start),
            )
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
            && f.source_text().all_bytes_match(comment.span.end, end, |b| {
                b.is_ascii_whitespace() || b == b'('
            });
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
    write!(
        f,
        [
            needs_parentheses.then_some("("),
            FormatSuppressedNode(span),
            needs_parentheses.then_some(")")
        ]
    );
}
