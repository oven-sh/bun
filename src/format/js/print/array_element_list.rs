use crate::js::format::write_trailing_comments_of;
use crate::js::utils::array::{is_line_after_element_empty, write_array_node};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::typecast::has_comments;
use crate::prelude::*;
use crate::write;

/// The elements of an array literal.
pub(crate) struct ArrayElementList<'a> {
    elements: List<'a, Expr<'a>>,
    group_id: GroupId,
}

impl<'a> ArrayElementList<'a> {
    pub(crate) fn new(elements: List<'a, Expr<'a>>, group_id: GroupId) -> Self {
        Self { elements, group_id }
    }
}

impl<'a> Format<'a> for ArrayElementList<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !can_concisely_print_array_list(self.elements, f) {
            // One per line if they don't all fit on one line.
            return write_array_node(
                self.elements.len(),
                self.elements
                    .iter()
                    .map(|e| (!matches!(e.kind(), ExprKind::Missing)).then_some(e)),
                f,
            );
        }

        // As many on each line as fit.
        let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
        // A comment on its own line after the last element is written after the fill, because a forced line break
        // inside a fill item would put that item on its own line.
        let last_with_own_line_comment = self.elements.last().filter(|last| {
            !f.is_quiet()
                && (f.comments().of_node(last.as_ast_nodes()).trailing.first())
                    .is_some_and(|comment| comment.has_newline_before())
        });
        let mut filler = f.fill();
        let mut previous_end = 0;
        for element in FormatSeparatedIter::new(self.elements.iter(), ",")
            .with_trailing_separator(trailing_separator)
            .with_group_id(Some(self.group_id))
        {
            filler.entry(
                &format_with(|f| {
                    if is_line_after_element_empty(
                        f.source_text().as_bytes(),
                        previous_end as usize,
                    ) {
                        write!(f, empty_line());
                    } else if !f.is_quiet()
                        && (f.comments().of_node(element.as_ast_nodes()).leading.iter()).any(
                            |comment| match block_comment_that_ends_line_starts_line(f) {
                                true => comment.has_newline_after(),
                                false => comment.is_line(),
                            },
                        )
                    {
                        write!(f, hard_line_break());
                    } else {
                        write!(f, soft_line_break_or_space());
                    }
                }),
                &format_with(|f| match last_with_own_line_comment == Some(*element) {
                    true => FormatNodeWithoutTrailingComments(&element).fmt(f),
                    false => element.fmt(f),
                }),
            );
            previous_end = element.span().end;
        }
        filler.finish();
        if let Some(last) = last_with_own_line_comment {
            write_trailing_comments_of(last.as_ast_nodes(), f);
        }
    }
}

/// `[1,⏎/* comment */⏎2]`: for oxfmt the comment stays on its own line, and for Prettier it goes after the `1,`.
fn block_comment_that_ends_line_starts_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `isConciselyPrintedArray`: all elements are numbers, with or without a sign, and none is followed by a
/// line comment on its line.
pub(crate) fn can_concisely_print_array_list<'a>(
    list: List<'a, Expr<'a>>,
    f: &Formatter<'a>,
) -> bool {
    !list.is_empty()
        && list.iter().all(|element| {
            let is_number = match element.kind() {
                ExprKind::Number(_) => true,
                ExprKind::Unary {
                    op: UnOp::Plus | UnOp::Minus,
                    operand,
                } => {
                    matches!(operand.kind(), ExprKind::Number(_))
                        && (f.is_quiet() || !has_comments(operand, f))
                }
                _ => false,
            };
            is_number && !has_line_comment_after_code(element, f)
        })
}

/// True if a line comment trails `element` on its line. For oxfmt, also if one leads it: `[ // comment⏎1, 2]`.
fn has_line_comment_after_code<'a>(element: Expr<'a>, f: &Formatter<'a>) -> bool {
    if f.is_quiet() {
        return false;
    }
    let owned = f.comments().of_node(element.as_ast_nodes());
    let leading = match f.options().flavor.is_oxfmt() {
        true => owned.leading,
        false => CommentList::empty(),
    };
    (leading.iter().chain(owned.trailing))
        .any(|comment| comment.is_line() && !comment.has_newline_before())
}
