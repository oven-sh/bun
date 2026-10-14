use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::prelude::*;
use crate::{format_args, write};

/// Prettier's `printClause`: the body of an `if`, an `else`, a loop or a `with`. After a space if
/// it is a block, otherwise on the next line if it does not fit.
pub(crate) struct FormatStatementBody<'a> {
    body: Stmt<'a>,
    force_space: bool,
    skip_trailing_comments: bool,
}

impl<'a> FormatStatementBody<'a> {
    pub(crate) fn new(body: Stmt<'a>) -> Self {
        Self {
            body,
            force_space: false,
            skip_trailing_comments: false,
        }
    }

    /// The body stays on the line: `else if`.
    pub(crate) fn with_forced_space(mut self, forced: bool) -> Self {
        self.force_space = forced;
        self
    }

    /// The caller writes the trailing comments of the body.
    pub(crate) fn without_trailing_comments(mut self, skip: bool) -> Self {
        self.skip_trailing_comments = skip;
        self
    }
}

impl<'a> Format<'a> for FormatStatementBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let body = self.body;
        let content = format_with(|f| match self.skip_trailing_comments {
            true => write!(f, FormatNodeWithoutTrailingComments(&body)),
            false => write!(f, body),
        });
        let first_leading_comment = match f.is_quiet() {
            true => None,
            false => f.comments().of_node(body.as_ast_nodes()).leading.first(),
        };
        let is_empty = matches!(body.kind(), StmtKind::Empty);
        let is_block = matches!(body.kind(), StmtKind::Block(_));
        if first_leading_comment.is_some()
            && (is_empty || is_block)
            && comments_stay_between_head_and_body(f)
        {
            write_space_before_body(body.as_ast_nodes(), f);
            return write!(f, content);
        }
        if is_empty {
            return write!(f, [maybe_space(first_leading_comment.is_some()), content]);
        }

        // Prettier's `shouldPrintLeadingHardline`
        if first_leading_comment
            .is_some_and(|comment| comment.is_multiline_block() || comment.has_newline_before())
        {
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

/// See [`comments_stay_between_head_and_body`]: what separates a head from `body`. A line break if the first leading
/// comment of the body starts its line, otherwise a space.
///
/// ```js
/// while (a)
/// // comment
/// {}
/// ```
pub(crate) fn write_space_before_body<'a>(body: AstNodes<'a>, f: &mut Formatter<'a>) {
    let starts_on_new_line = !f.is_quiet()
        && comments_stay_between_head_and_body(f)
        && (f.comments().of_node(body).leading.first())
            .is_some_and(|comment| comment.has_newline_before());
    match starts_on_new_line {
        true => write!(f, hard_line_break()),
        false => write!(f, space()),
    }
}

/// See [`comments_stay_between_head_and_body`]: writes `comments`, which are between the end of a block or a statement and
/// the keyword that continues it (`else`, `catch`, `finally`, `while`). The ones on the line of the block trail it, the
/// others keep their lines. Returns whether the caller still has to separate the keyword from what is before it.
///
/// ```js
/// if (a) {
/// } // comment
/// // comment
/// else {
/// }
/// ```
pub(crate) fn write_comments_before_keyword<'a>(
    comments: CommentList<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    let same_line_count = comments
        .iter()
        .take_while(|comment| !comment.has_newline_before())
        .count();
    let (same_line, own_line) = comments.split_at(same_line_count);
    write!(f, FormatTrailingComments::Comments(same_line));
    if let Some(first) = own_line.first() {
        let start = first.span().start as usize;
        match crate::text::is_previous_line_empty(f.source_text().as_bytes(), start) {
            true => write!(f, empty_line()),
            false => write!(f, hard_line_break()),
        }
        write!(f, FormatLeadingComments::Comments(own_line));
        false
    } else if same_line.last().is_some_and(|comment| comment.is_line()) {
        write!(f, hard_line_break());
        false
    } else {
        true
    }
}
