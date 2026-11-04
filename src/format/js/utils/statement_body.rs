use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::prelude::*;
use crate::{format_args, write};

/// Prettier's `printClause`: the body of an `if`, `else`, loop or `with`. A block goes after a space. Anything else
/// goes on the next line if it doesn't fit.
pub(crate) struct FormatStatementBody<'a> {
    body: Stmt<'a>,
    force_space: bool,
    trailing_comments: TrailingComments,
}

/// Which of a body's trailing comments are printed with it. The caller prints the others.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum TrailingComments {
    All,
    /// The ones on the line where the body ends.
    OnSameLine,
    None,
}

impl<'a> FormatStatementBody<'a> {
    pub(crate) fn new(body: Stmt<'a>) -> Self {
        Self {
            body,
            force_space: false,
            trailing_comments: TrailingComments::All,
        }
    }

    /// The body stays on the line: `else if`.
    pub(crate) fn with_forced_space(mut self, forced: bool) -> Self {
        self.force_space = forced;
        self
    }

    pub(crate) fn with_trailing_comments(mut self, trailing_comments: TrailingComments) -> Self {
        self.trailing_comments = trailing_comments;
        self
    }
}

impl<'a> Format<'a> for FormatStatementBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !f.is_quiet() {
            return self.fmt_with_comments(f);
        }
        let body = self.body;
        match body.kind() {
            StmtKind::Empty => write!(f, body),
            StmtKind::Block(_) => write!(f, [space(), body]),
            _ if self.force_space => write!(f, [space(), body]),
            _ => write!(f, soft_line_indent_or_space(&body)),
        }
    }
}

impl<'a> FormatStatementBody<'a> {
    /// Not inlined: `if (a) if (b) ..` is nested, and inlining would add this function's stack use to every level.
    #[inline(never)]
    fn fmt_with_comments(&self, f: &mut Formatter<'a>) {
        let body = self.body;
        let content = format_with(|f| {
            if f.is_quiet() || self.trailing_comments == TrailingComments::All {
                return write!(f, body);
            }
            write!(f, FormatNodeWithoutTrailingComments(&body));
            if self.trailing_comments == TrailingComments::OnSameLine {
                let (same_line, _) =
                    split_at_first_own_line(f.comments().of_node(body.as_ast_nodes()).trailing);
                write!(f, FormatTrailingComments::Comments(same_line));
            }
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
            if has_line_comment_before_semicolon(body, f) {
                write!(f, expand_parent());
            }
            write!(f, soft_line_indent_or_space(&content));
        }
    }
}

/// `if (a) b() // comment⏎;[c].d()`: the `;` ends `b()`. oxfmt prints the comment after the `;`, and the statement
/// whose body is `b()` breaks. Not after `return` and `throw`.
fn has_line_comment_before_semicolon<'a>(body: Stmt<'a>, f: &Formatter<'a>) -> bool {
    if f.is_quiet()
        || !f.options().flavor.is_oxfmt()
        || matches!(body.kind(), StmtKind::Return(_) | StmtKind::Throw(_))
    {
        return false;
    }
    let span = body.span();
    f.file().without_semicolon(span).end < span.end
        && (f.comments().comments_directly_before(span.end - 1).iter())
            .any(|comment| comment.is_line() && !comment.has_newline_before())
}

/// Splits `comments`, which follow something, into those on its line and the rest.
fn split_at_first_own_line(comments: CommentList<'_>) -> (CommentList<'_>, CommentList<'_>) {
    let same_line_count = comments
        .iter()
        .take_while(|comment| !comment.has_newline_before())
        .count();
    comments.split_at(same_line_count)
}

/// Prints an empty line if there's one before `comment`, which starts its line. Otherwise a line break.
fn write_line_break_before(comment: Comment<'_>, f: &mut Formatter<'_>) {
    let start = comment.span().start as usize;
    match crate::text::is_previous_line_empty(f.source_text().as_bytes(), start) {
        true => write!(f, empty_line()),
        false => write!(f, hard_line_break()),
    }
}

/// See [`comments_stay_between_head_and_body`]. Prints the separator between a head and `body`: a line break if the
/// body's first leading comment starts its line, otherwise a space.
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

/// See [`comments_stay_between_head_and_body`]. Prints the comments between the end of a block or statement and the
/// keyword that continues it (`else`, `catch`, `finally`, `while`). The ones on the block's line trail it, and the
/// others keep their lines. Returns true if the caller still has to separate the keyword from what's before it.
///
/// `trailing` is the block's trailing comments. `others` is the comments after them, which another node owns.
///
/// ```js
/// if (a) {
/// } // comment
/// // comment
/// else {
/// }
/// ```
pub(crate) fn write_comments_before_keyword<'a>(
    trailing: CommentList<'a>,
    others: CommentList<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    let needs_separator = write_run_of_comments_before_keyword(trailing, f);
    match others.is_empty() {
        true => needs_separator,
        false => write_run_of_comments_before_keyword(others, f),
    }
}

fn write_run_of_comments_before_keyword<'a>(
    comments: CommentList<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    let (same_line, own_line) = split_at_first_own_line(comments);
    write!(f, FormatTrailingComments::Comments(same_line));
    if let Some(first) = own_line.first() {
        write_line_break_before(first, f);
        write!(f, FormatLeadingComments::Comments(own_line));
        false
    } else if same_line.last().is_some_and(|comment| comment.is_line()) {
        write!(f, hard_line_break());
        false
    } else {
        true
    }
}

/// See [`comments_stay_between_head_and_body`]. Prints `comments`, which come before a `;` or `:` that the caller
/// prints next. The ones on the line of the preceding code trail it, and the others keep their lines. Returns true if a
/// line break has to follow the token because a line comment is waiting for the end of the line.
///
/// ```js
/// case a
/// // comment
/// : {
/// }
/// ```
pub(crate) fn write_comments_before_token<'a>(
    comments: CommentList<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    let (same_line, own_line) = split_at_first_own_line(comments);
    write!(f, FormatTrailingComments::Comments(same_line));
    for comment in own_line {
        if f.comments_mut().mark_printed(comment) {
            write_line_break_before(comment, f);
            write!(f, [comment, comment.is_line().then_some(hard_line_break())]);
        }
    }
    own_line.is_empty() && same_line.last().is_some_and(|comment| comment.is_line())
}
