//! How comments are written.
//!
//! [`Comments`](super::comments::Comments) tells which comments belong where. This writes them,
//! with the spaces and line breaks around them, and marks them as printed.

use super::comments::{Comment, CommentKind, lines};
use crate::prelude::*;
use crate::write;

/// 0 if something is before `comment` on its line, 1 if nothing is, 2 if the line before is empty
/// as well: Prettier's `hasNewline(.., { backwards: true })` and `isPreviousLineEmpty`.
fn lines_before(comment: &Comment, f: &Formatter<'_>) -> usize {
    fn without_blanks(text: &[u8]) -> &[u8] {
        let blanks = text.iter().rev().take_while(|b| matches!(b, b' ' | b'\t')).count();
        &text[..text.len() - blanks]
    }
    fn without_line_break(text: &[u8]) -> Option<&[u8]> {
        match text {
            [rest @ .., b'\r', b'\n'] | [rest @ .., b'\n' | b'\r'] | [rest @ .., 0xE2, 0x80, 0xA8 | 0xA9] => Some(rest),
            _ => None,
        }
    }
    let before = f.source_text().slice_range(0, comment.span.start);
    match without_line_break(without_blanks(before)) {
        None => 0,
        Some(before) => 1 + usize::from(without_line_break(without_blanks(before)).is_some()),
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
            Self::Node(span) => (f.comments().comments_before(span.start), span.start),
            Self::Comments(comments) => (comments, u32::MAX),
        };
        write_leading_comments(comments, node_start, f);
    }
}

/// `node_start`: where the node starts that they lead.
#[cold]
fn write_leading_comments<'a>(comments: &'a [Comment], node_start: u32, f: &mut Formatter<'a>) {
    // A comment that has been moved out of a node that is written as it is in the source is in that
    // text.
    let is_ignored = comments.iter().any(|comment| comment.is_moved() && f.comments().is_suppression_comment(comment));
    for comment in comments {
        f.comments_mut().increment_printed_count();
        if is_ignored && comment.is_moved() && comment.span.start >= node_start {
            continue;
        }
        write!(f, comment);

        let lines_after = f.source_text().lines_after(comment.span.end);
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
            Self::Node((enclosing, preceding, following)) => {
                f.comments().get_trailing_comments(enclosing, preceding, following)
            }
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
    let mut previous_comment: Option<&Comment> = None;

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
            let is_first_in_file = f.source_text().slice_range(0, comment.span.start) == b"\xEF\xBB\xBF";
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
            write!(f, [previous_comment.is_some().then_some(hard_line_break()), comment]);
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

impl<'a> Format<'a> for Comment {
    /// Prettier's `printComment`.
    fn fmt(&self, f: &mut Formatter<'a>) {
        let content = f.source_text().text_for(&self.span);
        if self.is_line() {
            return write!(f, text(crate::pragma::trim_end(content)));
        }
        if super::jsdoc::write_comment(self, f) {
            return;
        }
        if self.is_indentable_block() {
            // In Markdown, two spaces at the end of a line are a line break.
            let is_jsdoc = content.starts_with(b"/**") && (content.get(3) != Some(&b'*') || f.options().flavor.is_oxfmt());
            let mut lines = lines(content).peekable();
            write!(f, text(lines.next().unwrap_or_default().trim_ascii_end()));
            while let Some(line) = lines.next() {
                let trimmed = line.trim_ascii();
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
                for (index, line) in lines(content).enumerate() {
                    if index > 0 {
                        out.push(b'\n');
                    }
                    out.extend_from_slice(line);
                }
            });
        }
    }
}
