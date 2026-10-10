//! How comments are written.
//!
//! [`Comments`](super::comments::Comments) tells which comments belong where. This writes them,
//! with the spaces and line breaks around them, and marks them as printed.

use super::comments::{Comment, CommentKind};
use crate::prelude::*;
use crate::write;

/// 0 if something is before `comment` on its line, 1 if nothing is, 2 if the line before is empty
/// as well: Prettier's `hasNewline(.., { backwards: true })` and `isPreviousLineEmpty`.
fn lines_before(comment: &Comment, f: &Formatter<'_>) -> usize {
    /// Without the blanks at the end of `text` and the line break before them, if there is one.
    fn without_last_line(text: &[u8]) -> Option<&[u8]> {
        let text = bun_core::strings::trim_right(text, b" \t");
        match bun_core::strings::js_line_break_len_back(text) {
            0 => None,
            len => Some(&text[..text.len() - len]),
        }
    }
    let before = f.source_text().text_for(&Span::before(0, comment.span));
    match without_last_line(before) {
        None => 0,
        Some(before) => 1 + usize::from(without_last_line(before).is_some()),
    }
}

/// The comments before the node at `span`.
#[inline]
pub(crate) const fn format_leading_comments<'a>(span: Span) -> FormatLeadingComments<'a> {
    FormatLeadingComments::Node(span)
}

#[derive(Debug, Copy, Clone)]
pub(crate) enum FormatLeadingComments<'a> {
    Node(Span),
    Comments(&'a [Comment]),
}

impl<'a> Format<'a> for FormatLeadingComments<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (comments, node_start) = match *self {
            Self::Node(span) if f.comments().next_start() > span.start => return,
            Self::Node(span) => (f.comments().comments_leading_node(span), span.start),
            Self::Comments(comments) => (comments, u32::MAX),
        };
        write_leading_comments(comments, node_start, f);
    }
}

/// `a ⏎ /* comment */; ⏎ b`: the `;`, which is that of `a`, is written before the comment. For oxfmt
/// the comment stays on a line of its own, so the line breaks after it are counted from behind the `;`.
/// For Prettier it is on the line of `b`.
pub(crate) fn comment_before_semicolon_keeps_its_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Where `comment`, which leads something, ends. See [`comment_before_semicolon_keeps_its_line`].
fn end_with_semicolon_of_statement_before(comment: &Comment, f: &Formatter<'_>) -> u32 {
    let end = comment.span.end;
    if !comment.preceded_by_newline() || !comment_before_semicolon_keeps_its_line(f) {
        return end;
    }
    let rest = f.source_text().as_bytes().get(end as usize..);
    let blanks = (rest.unwrap_or_default().iter())
        .take_while(|b| b.is_ascii_whitespace())
        .count() as u32;
    match f.source_text().byte_at(end + blanks) {
        Some(b';') => end + blanks + 1,
        _ => end,
    }
}

/// `node_start`: where the node starts that they lead.
#[cold]
fn write_leading_comments<'a>(comments: &'a [Comment], node_start: u32, f: &mut Formatter<'a>) {
    // A comment that has been moved out of a node that is written as it is in the source is in that
    // text.
    let is_ignored = comments
        .iter()
        .any(|comment| comment.is_moved() && f.comments().is_suppression_comment(comment));
    for comment in comments {
        f.comments_mut().increment_printed_count();
        if is_ignored && comment.is_moved() && comment.span.start >= node_start {
            continue;
        }
        write!(f, comment);

        let lines_after = (f.source_text().lines_after(comment.span.end)).max(
            f.source_text()
                .lines_after(end_with_semicolon_of_statement_before(comment, f)),
        );
        match comment.kind {
            CommentKind::SingleLineBlock | CommentKind::MultiLineBlock => match lines_after {
                0 => write!(f, space()),
                1 if lines_before(comment, f) == 0 => write!(f, soft_line_break_or_space()),
                1 => write!(f, hard_line_break()),
                _ => write!(f, empty_line()),
            },
            CommentKind::Line => match lines_after {
                0 | 1 => write!(f, hard_line_break()),
                _ => write!(f, empty_line()),
            },
        }
    }
}

/// The comments after the node at `preceding_span`, whose parent is at `enclosing_span` and whose
/// next sibling starts at `following_span_start`, which is 0 if there is none.
#[inline]
pub(crate) const fn format_trailing_comments<'a>(
    enclosing_span: Span,
    preceding_span: Span,
    following_span_start: u32,
) -> FormatTrailingComments<'a> {
    FormatTrailingComments::Node((enclosing_span, preceding_span, following_span_start))
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum FormatTrailingComments<'a> {
    /// `(enclosing_span, preceding_span, following_span_start)`
    Node((Span, Span, u32)),
    Comments(&'a [Comment]),
}

impl<'a> Format<'a> for FormatTrailingComments<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let comments = match *self {
            Self::Node((enclosing, ..)) if f.comments().next_start() >= enclosing.end => return,
            Self::Node((enclosing, preceding, following)) => f
                .comments()
                .get_trailing_comments(enclosing, preceding, following),
            Self::Comments(comments) => comments,
        };
        if !comments.is_empty() {
            write_trailing_comments(comments, f);
        }
    }
}

#[cold]
fn write_trailing_comments<'a>(comments: &'a [Comment], f: &mut Formatter<'a>) {
    let mut total_lines_before = 0;
    // `a; // b` and `; // c` on the next line: the one before the empty statement has been written by itself.
    let mut previous_comment: Option<&Comment> = comments.first().and_then(|first| {
        let previous = f.comments().printed_comments().last()?;
        if first.span.start < previous.span.end {
            return None;
        }
        let between = previous.span.between(first.span);
        let is_only_empty_statements =
            (f.source_text()).all_bytes(between, |b| b.is_ascii_whitespace() || b == b';');
        (previous.is_line() && is_only_empty_statements).then_some(previous)
    });

    for comment in comments {
        f.comments_mut().increment_printed_count();

        let lines_before = lines_before(comment, f);
        total_lines_before += lines_before;

        let is_after_line_comment = previous_comment.is_some_and(|previous| previous.is_line());

        // A comment on a line of its own at the end of a block or an object is a trailing comment
        // of what is before it, and stays on its own line:
        //
        //     {
        //       x: 1,
        //       y: 2
        //       // A comment
        //     }
        if total_lines_before > 0 || is_after_line_comment {
            write!(
                f,
                [
                    line_suffix(&format_with(|f| {
                        match lines_before {
                            0 if is_after_line_comment => write!(f, hard_line_break()),
                            0 => write!(f, space()),
                            1 => write!(f, hard_line_break()),
                            _ => write!(f, empty_line()),
                        }
                        write!(f, comment);
                    })),
                    expand_parent()
                ]
            );
        } else {
            // Nothing but a byte order mark is before it.
            let is_first_in_file =
                f.source_text().text_for(&Span::before(0, comment.span)) == b"\xEF\xBB\xBF";
            let content = format_with(|f| write!(f, [maybe_space(!is_first_in_file), comment]));
            if comment.is_line() {
                write!(f, [line_suffix(&content), expand_parent()]);
            } else {
                write!(f, content);
            }
        }

        previous_comment = Some(comment);
    }
}

/// The comments that are left in the node at `span`, which has nothing else in it: `{ /* a */ }`.
#[inline]
pub(crate) const fn format_dangling_comments<'a>(span: Span) -> FormatDanglingComments<'a> {
    FormatDanglingComments::Node {
        span,
        indent: DanglingIndentMode::None,
    }
}

pub(crate) enum FormatDanglingComments<'a> {
    Node {
        span: Span,
        indent: DanglingIndentMode,
    },
    Comments {
        comments: &'a [Comment],
        indent: DanglingIndentMode,
    },
}

#[derive(Copy, Clone, Debug)]
pub(crate) enum DanglingIndentMode {
    /// On lines of their own, indented.
    Block,
    /// On lines of their own, indented, unless it is a single block comment that fits.
    Soft,
    /// Each on its own line.
    None,
}

impl FormatDanglingComments<'_> {
    #[must_use]
    pub(crate) fn with_block_indent(self) -> Self {
        self.with_indent_mode(DanglingIndentMode::Block)
    }

    #[must_use]
    pub(crate) fn with_soft_block_indent(self) -> Self {
        self.with_indent_mode(DanglingIndentMode::Soft)
    }

    fn with_indent_mode(mut self, mode: DanglingIndentMode) -> Self {
        match &mut self {
            FormatDanglingComments::Node { indent, .. }
            | FormatDanglingComments::Comments { indent, .. } => *indent = mode,
        }
        self
    }
}

impl<'a> Format<'a> for FormatDanglingComments<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (comments, indent) = match *self {
            Self::Node { span, .. } if f.comments().next_start() >= span.end => return,
            Self::Node { span, indent } => (f.comments().comments_before_end_of(span), indent),
            Self::Comments { comments, indent } => (comments, indent),
        };
        if !comments.is_empty() {
            write_dangling_comments(comments, indent, f);
        }
    }
}

#[cold]
fn write_dangling_comments<'a>(
    comments: &'a [Comment],
    indent: DanglingIndentMode,
    f: &mut Formatter<'a>,
) {
    let content = format_with(|f: &mut Formatter<'a>| {
        let mut previous_comment: Option<&Comment> = None;
        for comment in comments {
            f.comments_mut().increment_printed_count();
            write!(
                f,
                [
                    previous_comment.is_some().then_some(hard_line_break()),
                    comment
                ]
            );
            previous_comment = Some(comment);
        }
        if matches!(indent, DanglingIndentMode::Soft)
            && previous_comment.is_some_and(|previous| previous.is_line())
        {
            write!(f, hard_line_break());
        }
    });
    match indent {
        DanglingIndentMode::Block => write!(f, block_indent(&content)),
        DanglingIndentMode::Soft => write!(f, group(&soft_block_indent(&content))),
        DanglingIndentMode::None => write!(f, content),
    }
}

/// For oxfmt the comments between the head of something and its body, between a `}` and the keyword
/// after it, and between what is called and the `(` stay where they are. Prettier attaches each to a
/// node, which can be in the body, or in the parentheses.
///
/// ```js
/// function a() // comment      function a() {
/// {}                             // comment
///                              }
/// ```
pub(crate) fn comments_stay_between_head_and_body(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// See [`comments_stay_between_head_and_body`]: what is between a head and its body, which starts at
/// `body_start`: a space, or a line break if a comment starts the next line, and the comments.
pub(crate) fn write_head_body_separator(body_start: u32, f: &mut Formatter<'_>) {
    let comments = f.comments().comments_before(body_start);
    match comments
        .first()
        .is_some_and(|comment| comment.preceded_by_newline())
    {
        true => write!(f, hard_line_break()),
        false => write!(f, space()),
    }
    FormatLeadingComments::Comments(comments).fmt(f);
}

/// See [`comments_stay_between_head_and_body`]: `comments` are between a `}` and a keyword, or between
/// what is called and the `(`. Those on the line of what is before them trail it, the others keep
/// their lines. Returns whether what separates the two if there are no comments is still to be written.
pub(crate) fn write_comments_between_blocks<'a>(
    comments: &'a [Comment],
    f: &mut Formatter<'a>,
) -> bool {
    let same_line_count = comments
        .iter()
        .take_while(|comment| !comment.preceded_by_newline())
        .count();
    let (same_line, own_line) = comments.split_at(same_line_count);
    FormatTrailingComments::Comments(same_line).fmt(f);
    if let Some(first) = own_line.first() {
        match lines_before(first, f) > 1 {
            true => write!(f, empty_line()),
            false => write!(f, hard_line_break()),
        }
        FormatLeadingComments::Comments(own_line).fmt(f);
        false
    } else if same_line.last().is_some_and(|comment| comment.is_line()) {
        write!(f, hard_line_break());
        false
    } else {
        true
    }
}

/// See [`comments_stay_between_head_and_body`]: writes the comments after `start` that are before
/// `character`, which the caller writes next. Returns whether a line break has to follow that, because a
/// line comment is waiting for the end of the line.
pub(crate) fn write_trailing_comments_before(
    start: u32,
    character: u8,
    f: &mut Formatter<'_>,
) -> bool {
    let comments = f.comments().comments_before_character(start, character);
    let same_line_count = comments
        .iter()
        .take_while(|comment| !comment.preceded_by_newline())
        .count();
    let (same_line, own_line) = comments.split_at(same_line_count);
    FormatTrailingComments::Comments(same_line).fmt(f);
    for comment in own_line {
        match lines_before(comment, f) > 1 {
            true => write!(f, empty_line()),
            false => write!(f, hard_line_break()),
        }
        f.comments_mut().increment_printed_count();
        write!(f, [comment, comment.is_line().then_some(hard_line_break())]);
    }
    own_line.is_empty() && same_line.last().is_some_and(|comment| comment.is_line())
}

/// oxfmt hands its document for a script of a Vue file to Prettier, whose printer takes away the blanks before a line
/// break.
fn is_printed_by_prettier_for_oxfmt(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt() && f.options().in_html.root != HtmlRoot::None
}

impl<'a> Format<'a> for Comment {
    /// Prettier's `printComment`.
    fn fmt(&self, f: &mut Formatter<'a>) {
        let content = f.source_text().text_for(&self.span);
        if self.is_line() {
            return write!(f, text(bun_core::strings::trim_js_whitespace_end(content)));
        }
        if super::jsdoc::write_comment(self, f) {
            return;
        }
        if self.is_indentable_block() {
            // In Markdown, two spaces at the end of a line are a line break.
            let is_jsdoc = content.starts_with(b"/**")
                && (content.get(3) != Some(&b'*') || f.options().flavor.is_oxfmt())
                && !is_printed_by_prettier_for_oxfmt(f);
            let mut lines = bun_core::strings::split_crlf_lines(content).peekable();
            let first = lines.next().unwrap_or_default();
            write!(f, text(bun_core::strings::trim_js_whitespace_end(first)));
            while let Some(line) = lines.next() {
                let trimmed = bun_core::strings::trim_js_whitespace(line);
                write!(f, [hard_line_break(), " ", text(trimmed)]);
                if is_jsdoc && trimmed != b"*" && line.ends_with(b"  ") && lines.peek().is_some() {
                    // A line break in a text keeps the spaces before it. The one that follows
                    // only indents.
                    write!(f, text(b"  \n"));
                }
            }
        } else if !bun_core::strings::contains_char(content, b'\r') {
            write!(f, text(content));
        } else {
            f.write_built_text(|out| {
                for (index, line) in bun_core::strings::split_crlf_lines(content).enumerate() {
                    if index > 0 {
                        out.push(b'\n');
                    }
                    out.extend_from_slice(line);
                }
            });
        }
    }
}
