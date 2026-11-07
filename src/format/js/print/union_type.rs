use super::ts_declarations::{
    comments_after_type_alias_operator, comments_trailing_type_alias_left_side,
};
use crate::js::parentheses::ts_type::{effective_parent, needs_parentheses};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typescript::{should_hug_type, without_lone_operator};
use crate::prelude::*;
use crate::{format_args, write};

/// `A | B`
pub(crate) fn write_ts_union_type<'a>(
    ty: TypeNode<'a>,
    types: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
    write_ts_union_type_in(ty, types, false, f);
}

/// `[A, B | C]`
fn is_one_of_several_tuple_elements(parent: AstNodes<'_>) -> bool {
    matches!(parent, AstNodes::TSTupleType(tuple)
        if matches!(tuple.kind(), TypeKind::Tuple(elements) if elements.len() > 1))
}

/// Prettier's `shouldUnionTypePrintOwnComments`: [`write_ts_union_type_in`] prints the leading and trailing comments of
/// the union `ty`, inside its indentation and its parentheses. False if `ty` isn't a union.
///
/// ```ts
/// let a:
///   // comment
///   | A
///   | B;
/// ```
pub(crate) fn union_prints_own_comments<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    let TypeKind::Union(types) = ty.kind() else {
        return false;
    };
    if types.len() <= 1 || should_hug_type(types, f) {
        return false;
    }
    let parent = effective_parent(ty.ast_parent());
    !is_one_of_several_tuple_elements(parent)
        && !matches!(
            parent,
            AstNodes::TSUnionType(_) | AstNodes::TSIntersectionType(_)
        )
        && !(comments_stay_outside_parentheses(f) && needs_parentheses(ty, f))
}

/// oxfmt leaves `keyof /* comment */ (A | B)` as is. Prettier prints a union's comments inside its parentheses.
fn comments_stay_outside_parentheses(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
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
/// `is_indented_by_parent` means `ty` is the right side of a type alias, which has already printed a line break and an
/// indentation after the `=`.
#[inline(never)]
pub(crate) fn write_ts_union_type_in<'a>(
    ty: TypeNode<'a>,
    types: List<'a, TypeNode<'a>>,
    is_indented_by_parent: bool,
    f: &mut Formatter<'a>,
) {
    if types.len() == 1 {
        return write!(f, types.first());
    }
    let node = AstNodes::TSUnionType(ty);
    let prints_own_comments = !f.is_quiet() && union_prints_own_comments(ty, f);
    let skips_trailing_comments =
        prints_own_comments && f.context_mut().take_skip_trailing_comments();
    let own_leading_comments = prints_own_comments.then(|| leading_comments(node));
    let own_trailing_comments =
        (prints_own_comments && !skips_trailing_comments).then(|| trailing_comments(node));

    if is_ignored_by_comment_of_first_or_last_type(ty, f) {
        let comments_of_last_type = types.last().map_or(CommentList::empty(), |last| {
            let last = without_lone_operator(last).as_ast_nodes();
            f.comments().of_node(last).trailing
        });
        write!(
            f,
            [
                own_leading_comments,
                FormatSuppressedNode(ty.span()),
                FormatTrailingComments::Comments(comments_of_last_type),
                own_trailing_comments
            ]
        );
        // The `)` goes on the next line.
        if needs_parentheses(ty, f) && comments_of_last_type.last().is_some_and(Comment::is_line) {
            write!(f, hard_line_break());
        }
        return;
    }

    let parent = effective_parent(ty.ast_parent());
    if should_hug_type(types, f) {
        f.join_with(" | ").entries(types.iter());
        return;
    }
    if union_breaks_one_per_line(f) {
        return write_union_one_per_line(
            ty,
            types,
            parent,
            prints_own_comments,
            own_trailing_comments,
            f,
        );
    }

    let members = UnionMembers {
        types,
        comments_after_first_operator: CommentList::empty(),
    };
    let printed = format_with(|f| {
        write!(
            f,
            [
                own_leading_comments,
                group(&format_args!(if_group_breaks(&"| "), members)),
                own_trailing_comments
            ]
        );
    });
    if needs_parentheses(ty, f) {
        return write!(
            f,
            group(&format_args!(
                indent(&format_args!(soft_line_break(), printed)),
                soft_line_break()
            ))
        );
    }
    if is_one_of_several_tuple_elements(parent) {
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
    // With `experimentalTernaries` the type after `extends` is in parentheses that start with a line break. This is a
    // second one, and Prettier prints both.
    let is_after_line_break = f.options().experimental_ternaries
        && matches!(parent, AstNodes::TSConditionalType(it) if matches!(it.kind(), TypeKind::Cond { extends, .. } if extends.span().contains(ty.span())));
    let line = if is_after_line_break {
        soft_empty_line()
    } else {
        soft_line_break()
    };
    write!(f, group(&indent(&format_args!(line, printed))));
}

/// In oxfmt a `prettier-ignore` comment before a union applies to the whole union, as with any other node, and so does
/// one after its last type that ends the line. In Prettier an own-line one before the union applies only to the first
/// type, and one after the last type applies only to that type.
fn is_ignored_by_comment_of_first_or_last_type<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    if !f.options().flavor.is_oxfmt() || f.is_quiet() || !f.comments().has_suppression_comments() {
        return false;
    }
    let TypeKind::Union(types) = ty.kind() else {
        return false;
    };
    let is_ignore_comment = |comment: Comment<'a>| f.comments().is_suppression_comment(comment);
    (f.comments()
        .of_node(AstNodes::TSUnionType(ty))
        .leading
        .iter())
    .any(is_ignore_comment)
        || types.last().is_some_and(|last| {
            let last = without_lone_operator(last).as_ast_nodes();
            (f.comments().of_node(last).trailing.iter())
                .any(|comment| is_ignore_comment(comment) && comment.has_newline_after())
        })
}

/// oxfmt follows Prettier 3.8: a union that doesn't fit puts each type on its own line. 3.9 first tries all of them on
/// one line, after a line break.
///
/// ```ts
/// type A =              type A =
///   | "aaaaaaaaaa"        "aaaaaaaaaa" | "bbbbbbbbbb";
///   | "bbbbbbbbbb";
/// ```
pub(crate) fn union_breaks_one_per_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// The comments that the union `ty`, whose parent is `parent`, prints before its first type, in source order:
/// - the comments after a property signature's `:`, which dangle from it in oxfmt (`a: // comment ⏎ | B | C`),
/// - the union's leading comments,
/// - its first type's leading comments that are before its first `|`.
fn comments_before_first_type<'a>(
    ty: TypeNode<'a>,
    parent: AstNodes<'a>,
    f: &Formatter<'a>,
) -> [CommentList<'a>; 3] {
    let TypeKind::Union(types) = ty.kind() else {
        return [CommentList::empty(); 3];
    };
    if f.is_quiet() {
        return [CommentList::empty(); 3];
    }
    let after_colon = match (parent, parent.parent()) {
        (AstNodes::TSTypeAnnotation(_), signature @ AstNodes::TSPropertySignature(_)) => {
            f.comments().of_node(signature).dangling
        }
        _ => CommentList::empty(),
    };
    let first_type_comments = types.first().map_or(CommentList::empty(), |first| {
        let first = without_lone_operator(first).as_ast_nodes();
        let leading_comments = f.comments().of_node(first).leading;
        let before_union = (leading_comments.iter())
            .take_while(|comment| comment.span().start < ty.span().start)
            .count();
        leading_comments.slice(0, before_union)
    });
    let union_comments = f.comments().of_node(AstNodes::TSUnionType(ty)).leading;
    [after_colon, union_comments, first_type_comments]
}

/// oxc's `TSUnionType::write`, which is Prettier 3.8's `printUnionType`, for a union that isn't printed like an object
/// type.
fn write_union_one_per_line<'a>(
    ty: TypeNode<'a>,
    types: List<'a, TypeNode<'a>>,
    parent: AstNodes<'a>,
    prints_own_comments: bool,
    own_trailing_comments: Option<FormatTrailingComments<'a>>,
    f: &mut Formatter<'a>,
) {
    let needs_parentheses = needs_parentheses(ty, f);
    let comments = match (prints_own_comments, needs_parentheses) {
        (true, _) => comments_before_first_type(ty, parent, f),
        // `( // comment ⏎ A | B)[]`. The union's comments are outside the parentheses.
        (false, true) => {
            let [_, _, first_type_comments] = comments_before_first_type(ty, parent, f);
            [
                CommentList::empty(),
                CommentList::empty(),
                first_type_comments,
            ]
        }
        (false, false) => [CommentList::empty(); 3],
    };
    let [_, union_comments, _] = comments;
    let leading_comments = || comments.into_iter().flatten();
    let is_after_code_at_end_of_line = |comment: Comment<'_>| {
        comment.is_block() && !comment.has_newline_before() && comment.has_newline_after()
    };
    let is_in_type_alias = matches!(parent, AstNodes::TSTypeAliasDeclaration(_));
    let has_end_of_line_comment = leading_comments().any(|comment| comment.has_newline_after());
    // Comments go after the `|` that's printed before the first type, wherever they are in the source. But if one of
    // them ends its line, they all stay before the `|`, or there would be a line break between the `|` and the type.
    //
    // ```ts
    // type A = /* comment */ B | C;      type A =
    //                                      | /* comment */ B
    //                                      | C;
    // ```
    let has_comments_before_operator = has_end_of_line_comment;
    // After the `?` or `:` of a conditional type the comments go after the operator, and what follows lines up with
    // them.
    let is_branch_of_conditional_type = matches!(parent, AstNodes::TSConditionalType(it) if matches!(it.kind(), TypeKind::Cond { yes, no, .. } if yes.span().contains(ty.span()) || no.span().contains(ty.span())));

    let should_indent = match parent {
        AstNodes::TSTypeAssertion(_)
        | AstNodes::TSTupleType(_)
        | AstNodes::TSTypeParameterInstantiation(_) => false,
        // A comment forces the line break after the `=`, which already comes with an indentation.
        AstNodes::TSTypeAliasDeclaration(statement) => {
            !type_alias_union_breaks_after_operator(statement, ty, f)
        }
        AstNodes::TSConditionalType(_) if is_branch_of_conditional_type => {
            !has_comments_before_operator
        }
        // A line comment before `as` is printed after it, with a line break and an indentation.
        AstNodes::TSAsExpression(cast) | AstNodes::TSSatisfiesExpression(cast) => {
            !matches!(cast.kind(), ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } if f.comments().has_printed_line_comment_after(expr.span().end))
        }
        _ => true,
    };
    let starts_with_line_break = should_indent && !has_comments_before_operator;
    let members = UnionMembers {
        types,
        comments_after_first_operator: match has_comments_before_operator {
            true => CommentList::empty(),
            false => union_comments,
        },
    };
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
        } else if is_one_of_several_tuple_elements(parent) {
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
    let is_only_type = matches!(ty.ast_parent(), AstNodes::TSUnionType(_))
        && !matches!(parent, AstNodes::TSUnionType(_));
    let has_own_line_comment = leading_comments().any(|comment| comment.has_newline_before())
        || (is_in_type_alias
            && leading_comments().any(|it| is_after_code_at_end_of_line(it) && !is_jsdoc(it)));
    let breaks_before_comments = (has_own_line_comment
        || (has_end_of_line_comment && is_only_type))
        && !is_branch_of_conditional_type;
    let inner = format_with(|f| {
        write!(f, breaks_before_comments.then_some(soft_line_break()));
        if has_comments_before_operator {
            for comments in comments {
                write!(f, FormatLeadingComments::Comments(comments));
            }
        }
        write!(f, group(&content));
    });
    match should_indent && !needs_parentheses {
        true => write!(f, group(&indent(&inner))),
        false => write!(f, group(&inner)),
    }
    write!(f, own_trailing_comments);
}

fn is_jsdoc(comment: Comment<'_>) -> bool {
    comment.text().starts_with(b"/**")
}

/// oxc's `alias_union_breaks_after_operator`: true if the union `ty`, which is the type alias `statement`'s type,
/// leaves the line break and the indentation to the `=`.
///
/// - A JSDoc comment after code ends its line, or a multi-line one has its stars lined up.
/// - A comment that trails the left side ends the `=`'s line.
pub(crate) fn type_alias_union_breaks_after_operator<'a>(
    statement: Stmt<'a>,
    ty: TypeNode<'a>,
    f: &Formatter<'a>,
) -> bool {
    if f.is_quiet() {
        return false;
    }
    let comments = comments_before_first_type(ty, AstNodes::TSTypeAliasDeclaration(statement), f);
    comments.into_iter().flatten().any(|comment| {
        comment.is_indentable_block()
            || (is_jsdoc(comment) && !comment.has_newline_before() && comment.has_newline_after())
    }) || (comments_after_type_alias_operator(statement, f).last())
        .or_else(|| comments_trailing_type_alias_left_side(statement, f).last())
        .is_some_and(|comment| comment.has_newline_after())
}

/// oxc's `union_prints_itself`: a union that a `prettier-ignore` comment applies to is copied from the source, and its
/// parent treats it like any other type.
pub(crate) fn union_prints_itself<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    matches!(ty.kind(), TypeKind::Union(_))
        && (f.is_quiet()
            || !(f.comments().is_ignored(AstNodes::TSUnionType(ty))
                || is_ignored_by_comment_of_first_or_last_type(ty, f)))
}

/// True if `ty`, a property signature's type, is a union that prints the comments after the signature's `:`. See
/// [`comments_before_first_type`].
pub(crate) fn union_prints_comments_after_colon<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    union_breaks_one_per_line(f) && union_prints_own_comments(ty, f) && union_prints_itself(ty, f)
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
        _ => !(ty.file().is_flow() && super::flow::is_union_indented_by_parameters(ty)),
    }
}

/// oxfmt doesn't align the comments after a union's type with it, unless that type is a union in parentheses. Prettier
/// aligns them if there are comments before the type.
fn trailing_comments_are_outside_alignment(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// The types of a union that isn't printed like an object type, and the `|` between them.
#[derive(Copy, Clone)]
struct UnionMembers<'a> {
    types: List<'a, TypeNode<'a>>,
    /// The union's leading comments that are printed with the first type.
    comments_after_first_operator: CommentList<'a>,
}

impl<'a> Format<'a> for UnionMembers<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        for (index, member) in self.types.iter().enumerate() {
            if index > 0 {
                write!(f, [soft_line_break_or_space(), "| "]);
            }
            if f.is_quiet() {
                write!(f, align(2, &member));
                continue;
            }
            // Only the type is aligned, so that an own-line comment after it lines up with the `|`:
            //
            // ```ts
            // | A
            // // comment
            // | B
            // ```
            let member = without_lone_operator(member);
            let node = member.as_ast_nodes();
            let has_leading_comments = !f.comments().of_node(node).leading.is_empty();
            let are_trailing_comments_aligned = match trailing_comments_are_outside_alignment(f) {
                // `| (A | B /* comment */)`
                true => index > 0 && matches!(member.kind(), TypeKind::Union(_)),
                false => has_leading_comments,
            };
            if are_trailing_comments_aligned {
                write!(f, align(2, &member));
                continue;
            }
            let comments_of_union = (index == 0).then_some(FormatLeadingComments::Comments(
                self.comments_after_first_operator,
            ));
            let member = FormatNodeWithoutTrailingComments(&member);
            write!(
                f,
                [
                    align(2, &format_args!(comments_of_union, member)),
                    trailing_comments(node)
                ]
            );
        }
    }
}
