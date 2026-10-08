//! How comments are written.
//!
//! [`Comments`](super::comments::Comments) tells which comments belong where. This writes them,
//! with the spaces and line breaks around them, and marks them as printed.

use super::comments::{Comment, CommentKind};
use crate::prelude::*;
use crate::write;

/// JSDoc has a form in which several `/** .. */` directly follow each other, for the overloads of
/// a function. They have to stay that way.
fn should_nestle_adjacent_doc_comments(current: &Comment, next: &Comment) -> bool {
    current.is_jsdoc()
        && next.is_jsdoc()
        && current.is_multiline_block()
        && next.is_multiline_block()
        && current.span.end == next.span.start
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
        let comments = match *self {
            Self::Node(span) if f.comments().next_start() >= span.start => return,
            Self::Node(span) => f.comments().comments_before(span.start),
            Self::Comments(comments) => comments,
        };
        write_leading_comments(comments, f);
    }
}

#[cold]
fn write_leading_comments<'a>(comments: &'a [Comment], f: &mut Formatter<'a>) {
    for (index, comment) in comments.iter().enumerate() {
        f.comments_mut().increment_printed_count();
        write!(f, comment);

        let lines_after = f.source_text().lines_after(comment.span.end);
        match comment.kind {
            CommentKind::SingleLineBlock | CommentKind::MultiLineBlock => match lines_after {
                0 => {
                    let should_nestle = comments
                        .get(index + 1)
                        .is_some_and(|next| should_nestle_adjacent_doc_comments(comment, next));
                    write!(f, maybe_space(!should_nestle));
                }
                1 if f.lines_before(comment.span) == 0 => write!(f, soft_line_break_or_space()),
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

        let lines_before = f.lines_before(comment.span);
        total_lines_before += lines_before;

        let should_nestle = previous_comment
            .is_some_and(|previous| should_nestle_adjacent_doc_comments(previous, comment));
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
                line_suffix(&format_with(|f| {
                    match lines_before {
                        _ if should_nestle => {}
                        0 if is_after_line_comment => write!(f, hard_line_break()),
                        0 => write!(f, space()),
                        1 => write!(f, hard_line_break()),
                        _ => write!(f, empty_line()),
                    }
                    write!(f, comment);
                }))
            );
        } else {
            let content = format_with(|f| write!(f, [maybe_space(!should_nestle), comment]));
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
            Self::Node { span, indent } => (f.comments().comments_before(span.end), indent),
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
            let should_nestle = previous_comment
                .is_some_and(|previous| should_nestle_adjacent_doc_comments(previous, comment));
            let needs_break = previous_comment.is_some() && !should_nestle;
            write!(f, [needs_break.then_some(hard_line_break()), comment]);
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

/// The lines of `text`, which end with `\n`, `\r\n`, `\r`, U+2028 or U+2029.
fn lines(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let text = rest?;
        let mut from = 0;
        while let Some(at) = bun_core::strings::index_of_any(&text[from..], b"\n\r\xE2") {
            let at = from + at;
            let len = match &text[at..] {
                [b'\r', b'\n', ..] => 2,
                [b'\n' | b'\r', ..] => 1,
                [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
                _ => {
                    from = at + 1;
                    continue;
                }
            };
            rest = Some(&text[at + len..]);
            return Some(&text[..at]);
        }
        rest = None;
        Some(text)
    })
}

/// Prettier's `isIndentableBlockComment`: every line but the first starts with a `*`, so the
/// stars can be lined up.
pub(crate) fn is_alignable_comment(text: &[u8]) -> bool {
    lines(text).skip(1).all(|line| line.trim_ascii_start().starts_with(b"*"))
}

impl<'a> Format<'a> for Comment {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let content = f.source_text().text_for(&self.span);
        if !self.is_multiline_block() {
            return write!(f, text(content.trim_ascii_end()));
        }
        let mut lines = lines(content);
        let first = lines.next().unwrap_or_default().trim_ascii_end();
        if is_alignable_comment(content) {
            write!(f, text(first));
            for line in lines {
                write!(f, [hard_line_break(), " ", text(line.trim_ascii())]);
            }
        } else if !bun_core::strings::contains_char(content, b'\r')
            && first.len() == bun_core::strings::index_of_char_usize(content, b'\n').unwrap_or(0)
        {
            write!(f, text(content));
        } else {
            f.write_built_text(|out| {
                out.extend_from_slice(first);
                for line in lines {
                    out.push(b'\n');
                    out.extend_from_slice(line);
                }
            });
        }
    }
}
