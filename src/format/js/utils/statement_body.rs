use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use super::suppressed::FormatSuppressedNode;
use crate::js::format::write_declaration;
use crate::prelude::*;
use crate::write;

/// The body of an `if`, a loop or a `with`: after a space if it is a block, otherwise on the next
/// line if it does not fit.
pub(crate) struct FormatStatementBody<'a> {
    body: Stmt<'a>,
    force_space: bool,
}

impl<'a> FormatStatementBody<'a> {
    pub(crate) fn new(body: Stmt<'a>) -> Self {
        Self {
            body,
            force_space: false,
        }
    }

    /// The body stays on the line: `else if`.
    pub(crate) fn with_forced_space(mut self, forced: bool) -> Self {
        self.force_space = forced;
        self
    }
}

impl<'a> Format<'a> for FormatStatementBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let body = self.body;
        match body.kind() {
            StmtKind::Empty => {
                // `for (x of y) /* comment */ ;`
                if f.comments().has_comment_before(body.span().start) {
                    write!(f, space());
                }
                write!(f, body);
            }
            StmtKind::Block(_) => {
                write!(f, space());
                if matches!(body.ast_parent(), AstNodes::IfStatement(_)) {
                    write!(f, body);
                } else {
                    // The comments before the block are written in it.
                    write_declaration(body, f);
                }
            }
            _ if self.force_space => write!(f, [space(), body]),
            _ => write!(
                f,
                soft_line_indent_or_space(&format_with(|f| {
                    //     if (condition)
                    //       statement; // comment1
                    //     // comment2
                    //     else {}
                    //
                    // `comment1` trails the statement, `comment2` is left for the `else`.
                    let body_span = body.span();
                    let is_consequent_of_if_statement_parent = matches!(
                        body.ast_parent(),
                        AstNodes::IfStatement(parent)
                            if parent.consequent() == Some(body) && parent.alternate().is_some()
                    );
                    if !is_consequent_of_if_statement_parent {
                        return write!(f, body);
                    }
                    if f.comments().has_trailing_suppression_comment(body_span.end) {
                        write!(f, [format_leading_comments(body_span), FormatSuppressedNode(body_span)]);
                    } else {
                        write!(f, FormatNodeWithoutTrailingComments(&body));
                    }
                    let comments = f.comments().end_of_line_comments_after(body_span.end);
                    FormatTrailingComments::Comments(comments).fmt(f);
                }))
            ),
        }
    }
}
