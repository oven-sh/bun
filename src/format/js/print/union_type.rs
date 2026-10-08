use crate::js::parentheses::ts_type::needs_parentheses;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typescript::should_hug_type;
use crate::prelude::*;
use crate::{format_args, write};

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
    let leading_comments = f.comments().comments_before(ty.span().start);

    // `{ a: string } | null | void` is written like the object type alone.
    if should_hug_type(ty, types, f) {
        write!(f, FormatLeadingComments::Comments(leading_comments));
        return format_union_types(types, None, true, f);
    }

    let printed = format_with(|f| {
        let is_suppressed = leading_comments.iter().any(|comment| f.comments().is_suppression_comment(comment));
        let suppressed_node_span = types.first().filter(|_| is_suppressed).map(|it| it.span());
        write!(
            f,
            [
                FormatLeadingComments::Comments(leading_comments),
                group(&format_args!(
                    if_group_breaks(&"| "),
                    format_with(|f| format_union_types(types, suppressed_node_span, false, f))
                ))
            ]
        );
    });

    let parent = ty.ast_parent();
    if needs_parentheses(ty, f) {
        return write!(f, group(&format_args!(indent(&format_args!(soft_line_break(), printed)), soft_line_break())));
    }
    if matches!(parent, AstNodes::TSTupleType(tuple) if matches!(tuple.kind(), TypeKind::Tuple(it) if it.len() > 1)) {
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
            !matches!(conditional.kind(), TypeKind::Cond { yes, no, .. } if yes == ty || no == ty)
        }
        _ => true,
    }
}

/// The types and the `|` between them. `suppressed_node_span`: the type that a `prettier-ignore`
/// comment is before.
fn format_union_types<'a>(
    types: List<'a, TypeNode<'a>>,
    mut suppressed_node_span: Option<Span>,
    should_hug: bool,
    f: &mut Formatter<'a>,
) {
    let mut iter = types.iter().peekable();
    while let Some(element) = iter.next() {
        let element_span = element.span();
        let is_suppressed = !f.is_quiet()
            && (suppressed_node_span == Some(element_span)
                || f.comments().has_trailing_suppression_comment(element_span.end));

        if is_suppressed {
            let comments = f.comments().comments_before(element_span.start);
            let needs_parens = needs_parentheses(element, f);
            write!(
                f,
                [
                    FormatLeadingComments::Comments(comments),
                    needs_parens.then_some("("),
                    FormatSuppressedNode(element_span),
                    needs_parens.then_some(")")
                ]
            );
        } else if should_hug {
            write!(f, element);
        } else {
            write!(f, align(2, &element));
        }

        let Some(next_node_span) = iter.peek().map(|it| it.span()) else {
            break;
        };
        if !f.is_quiet() {
            if f.comments().is_suppressed(next_node_span.start) {
                suppressed_node_span = Some(next_node_span);
            }
            let comments_before_separator = f.comments().comments_before_character(element_span.end, b'|');
            FormatTrailingComments::Comments(comments_before_separator).fmt(f);

            if f.comments().has_leading_own_line_comment(next_node_span.start) {
                let comments = f.comments().comments_before(next_node_span.start);
                FormatTrailingComments::Comments(comments).fmt(f);
            }
        }
        match should_hug {
            true => write!(f, space()),
            false => write!(f, soft_line_break_or_space()),
        }
        write!(f, ["|", space()]);
    }
}
