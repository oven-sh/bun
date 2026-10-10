use crate::js::format::write_trailing_comments_of;
use crate::js::utils::array::{is_line_after_element_empty, write_array_node};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::prelude::*;
use crate::write;

/// The elements of the array literal `array`.
pub(crate) struct ArrayElementList<'a> {
    array: Expr<'a>,
    elements: List<'a, Expr<'a>>,
    group_id: GroupId,
}

impl<'a> ArrayElementList<'a> {
    pub(crate) fn new(array: Expr<'a>, elements: List<'a, Expr<'a>>, group_id: GroupId) -> Self {
        Self {
            array,
            elements,
            group_id,
        }
    }
}

impl<'a> Format<'a> for ArrayElementList<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !can_concisely_print_array_list(self.array.span(), self.elements, f) {
            // One per line, if they do not fit on one line.
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
        // A comment on a line of its own after the last element is written after the fill: what forces
        // a line break in an item of a fill puts the item on a line of its own.
        let last_with_own_line_comment = self.elements.last().filter(|last| {
            !f.is_quiet()
                && (f
                    .comments()
                    .comments_in(Span::after(last.span(), self.array.span().end))
                    .first())
                .is_some_and(|comment| comment.preceded_by_newline())
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
                    } else if f.comments().comments_before_iter(element.span().start).any(
                        |comment| match block_comment_that_ends_line_starts_one(f) {
                            true => comment.followed_by_newline(),
                            false => comment.is_line(),
                        },
                    ) {
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

/// `[1,⏎/* comment */⏎2]`: for oxfmt the comment stays on its line, for Prettier it is behind the `1,`.
fn block_comment_that_ends_line_starts_one(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `isConciselyPrintedArray`: all elements are numbers, with or without a sign.
pub(crate) fn can_concisely_print_array_list<'a>(
    array_expression_span: Span,
    list: List<'a, Expr<'a>>,
    f: &Formatter<'a>,
) -> bool {
    let Some(first) = list.first() else {
        return false;
    };
    let comments = f.comments();
    let mut comments_iter = comments
        .comments_before_iter(array_expression_span.end)
        .peekable();

    for item in list {
        match item.kind() {
            ExprKind::Number(_) => {}
            ExprKind::Unary {
                op: UnOp::Plus | UnOp::Minus,
                operand,
            } if matches!(operand.kind(), ExprKind::Number(_)) => {
                // `-(/* comment */ 1)`
                let span = item.span();
                while comments_iter
                    .next_if(|comment| comment.span.start <= span.start)
                    .is_some()
                {}
                if comments_iter
                    .peek()
                    .is_some_and(|it| span.contains(it.span))
                {
                    return false;
                }
            }
            _ => return false,
        }
    }

    // Not with a line comment behind an element.
    !comments
        .comments_before_iter(array_expression_span.end)
        .any(|comment| {
            comment.is_line()
                && !comment.preceded_by_newline()
                && comment.span.start > first.span().start
        })
}
