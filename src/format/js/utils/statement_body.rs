use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::prelude::*;
use crate::{format_args, write};

/// Prettier's `printClause`: the body of an `if`, an `else`, a loop or a `with`. After a space if
/// it is a block, otherwise on the next line if it does not fit.
///
/// The comments between the head of the statement and the body lead the body.
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
        let content = FormatBodyAndItsComments(body);
        if matches!(body.kind(), StmtKind::Empty) {
            // Not `is_quiet`: to the statement that this is the body of, a `;` at its end and the
            // comments before that are not part of it.
            let has_comments = f.comments().has_comment_before(body.span().start);
            return write!(f, [maybe_space(has_comments), format_leading_comments(body.span()), content]);
        }

        let first_comment = match f.is_quiet() {
            true => None,
            false => f.comments().comments_before(body.span().start).first(),
        };
        let is_block = matches!(body.kind(), StmtKind::Block(_));
        // Prettier's `shouldPrintLeadingHardline`
        if first_comment.is_some_and(|comment| comment.is_multiline_block() || comment.preceded_by_newline()) {
            match is_block {
                true => write!(f, [hard_line_break(), content]),
                false => write!(f, indent(&format_args!(hard_line_break(), content))),
            }
        } else if is_block || self.force_space {
            write!(f, [space(), content]);
        } else {
            write!(f, soft_line_indent_or_space(&content));
        }
    }
}

struct FormatBodyAndItsComments<'a>(Stmt<'a>);

impl<'a> Format<'a> for FormatBodyAndItsComments<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let body = self.0;
        if f.is_quiet() {
            return write!(f, body);
        }
        let alternate = match body.ast_parent() {
            AstNodes::IfStatement(parent) if parent.consequent() == Some(body) => parent.alternate(),
            _ => None,
        };
        let Some(alternate) = alternate else {
            return write!(f, body);
        };

        //     if (condition)
        //       statement; // comment1
        //     // comment2
        //     else {}
        //
        // `comment1` trails the statement, `comment2` is left for the `else`.
        write!(f, FormatNodeWithoutTrailingComments(&body));
        if matches!(body.kind(), StmtKind::Block(_)) {
            return;
        }
        let end = f.comments().without_semicolon(body.span()).end;
        let comments = comments_before_else(body, alternate, f);
        let count = comments
            .iter()
            .take_while(|comment| {
                !comment.is_multiline_block() && !f.source_text().contains_newline_between(end, comment.span.start)
            })
            .count();
        write!(f, FormatTrailingComments::Comments(&comments[..count]));
    }
}

/// The comments that are not printed yet between `consequent` and the `else` after it.
pub(crate) fn comments_before_else<'a>(consequent: Stmt<'a>, alternate: Stmt<'a>, f: &Formatter<'a>) -> &'a [Comment] {
    let comments = f.comments().comments_before(alternate.span().start);
    let mut position = consequent.span().end;
    let count = comments
        .iter()
        .take_while(|comment| {
            let gap = f.source_text().slice_range(position, comment.span.start);
            position = comment.span.end;
            !bun_core::strings::contains(gap, b"else")
        })
        .count();
    &comments[..count]
}
