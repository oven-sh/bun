use crate::js::utils::array::write_array_node;
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
                self.elements.iter().map(|e| (!matches!(e.kind(), ExprKind::Missing)).then_some(e)),
                f,
            );
        }

        // As many on each line as fit.
        let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
        let mut filler = f.fill();
        for element in FormatSeparatedIter::new(self.elements.iter(), ",")
            .with_trailing_separator(trailing_separator)
            .with_group_id(Some(self.group_id))
        {
            filler.entry(
                &format_with(|f| {
                    if f.lines_before(element.span()) > 1 {
                        write!(f, empty_line());
                    } else if f.comments().has_leading_own_line_comment(element.span().start) {
                        write!(f, hard_line_break());
                    } else {
                        write!(f, soft_line_break_or_space());
                    }
                }),
                &element,
            );
        }
        filler.finish();
    }
}

/// Prettier's `isConciselyPrintedArray`: all elements are numbers, with or without a sign.
pub(crate) fn can_concisely_print_array_list<'a>(
    array_expression_span: Span,
    list: List<'a, Expr<'a>>,
    f: &Formatter<'a>,
) -> bool {
    if list.is_empty() {
        return false;
    }
    let comments = f.comments();
    let mut comments_iter = comments.comments_before_iter(array_expression_span.end);

    for item in list {
        match item.kind() {
            ExprKind::Number(_) => {}
            ExprKind::Unary {
                op: UnOp::Plus | UnOp::Minus,
                operand,
            } if matches!(operand.kind(), ExprKind::Number(_)) => {
                // `-(/* comment */ 1)`
                let span = item.span();
                if comments_iter.find(|comment| comment.span.start > span.start).is_some_and(|it| span.contains(it.span)) {
                    return false;
                }
            }
            _ => return false,
        }
    }

    // Not with a line comment behind an element.
    !comments
        .comments_before_iter(array_expression_span.end)
        .any(|comment| comment.is_line() && !comment.preceded_by_newline())
}
