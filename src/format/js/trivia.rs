//! How comments are written.
//!
//! [`Comments`](super::comments::Comments) says which comments a node owns. The functions here write them, with the spaces and
//! line breaks around them, and mark them as printed. They are Prettier's `printLeadingComments`, `printTrailingComments` and
//! `printDanglingComments`.

use super::ast_nodes::AstNodes;
use super::comments::{Comment, CommentExt, CommentList};
use crate::prelude::*;
use crate::write;

/// 0 if something is before `comment` on its line, 1 if nothing is, 2 if the line before is empty
/// as well: Prettier's `hasNewline(.., { backwards: true })` and `isPreviousLineEmpty`.
fn lines_before(comment: Comment<'_>, f: &Formatter<'_>) -> usize {
    /// Without the blanks at the end of `text` and the line break before them, if there is one.
    fn without_last_line(text: &[u8]) -> Option<&[u8]> {
        let text = bun_core::strings::trim_right(text, b" \t");
        match bun_core::strings::js_line_break_len_back(text) {
            0 => None,
            len => Some(&text[..text.len() - len]),
        }
    }
    let before = f.source_text().text_for(&Span::before(0, comment.span()));
    match without_last_line(before) {
        None => 0,
        Some(before) => 1 + usize::from(without_last_line(before).is_some()),
    }
}

/// The leading comments that `node` owns.
#[inline]
pub(crate) const fn leading_comments<'a>(node: AstNodes<'a>) -> FormatLeadingComments<'a> {
    FormatLeadingComments::Owner(node)
}

#[derive(Copy, Clone)]
pub(crate) enum FormatLeadingComments<'a> {
    Owner(AstNodes<'a>),
    Comments(CommentList<'a>),
}

impl<'a> Format<'a> for FormatLeadingComments<'a> {
    #[inline(always)]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let comments = match *self {
            Self::Owner(_) if f.is_quiet() => return,
            Self::Owner(node) => f.comments().of_node(node).leading,
            Self::Comments(comments) => comments,
        };
        if !comments.is_empty() {
            write_leading_comments(comments, f);
        }
    }
}

/// `a ⏎ /* comment */; ⏎ b`: the `;`, which is that of `a`, is written before the comment. For oxfmt
/// the comment stays on a line of its own, so the line breaks after it are counted from the end of the `;`.
/// For Prettier it is on the line of `b`.
pub(crate) fn comment_before_semicolon_keeps_its_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Where `comment`, which leads something, ends. See [`comment_before_semicolon_keeps_its_line`].
fn end_with_semicolon_of_statement_before(comment: Comment<'_>, f: &Formatter<'_>) -> u32 {
    let end = comment.span().end;
    if !comment.has_newline_before() || !comment_before_semicolon_keeps_its_line(f) {
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

/// Prettier's `mergeNestledJsdocComments`: `/** .. *//** .. */`, which JSDoc uses for the overloads of a function. The two
/// comments stay together, without a space between them.
fn is_nestled_jsdoc_comment(comment: Comment<'_>, next: Option<Comment<'_>>) -> bool {
    next.is_some_and(|next| {
        next.span().start == comment.span().end
            && comment.is_indentable_block()
            && next.is_indentable_block()
    })
}

fn is_nestled_jsdoc_comment_after(previous: Option<Comment<'_>>, comment: Comment<'_>) -> bool {
    previous.is_some_and(|previous| is_nestled_jsdoc_comment(previous, Some(comment)))
}

#[cold]
fn write_leading_comments<'a>(comments: CommentList<'a>, f: &mut Formatter<'a>) {
    for (index, comment) in comments.iter().enumerate() {
        if !f.comments_mut().mark_printed(comment) {
            continue;
        }
        write!(f, comment);
        if is_nestled_jsdoc_comment(comment, comments.get(index + 1)) {
            continue;
        }

        let lines_after = (f.source_text().lines_after(comment.span().end)).max(
            f.source_text()
                .lines_after(end_with_semicolon_of_statement_before(comment, f)),
        );
        match (comment.is_block(), lines_after) {
            (true, 0) => write!(f, space()),
            (true, 1) if lines_before(comment, f) == 0 => write!(f, soft_line_break_or_space()),
            (_, 0 | 1) => write!(f, hard_line_break()),
            _ => write!(f, empty_line()),
        }
    }
}

/// The trailing comments that `node` owns.
#[inline]
pub(crate) const fn trailing_comments<'a>(node: AstNodes<'a>) -> FormatTrailingComments<'a> {
    FormatTrailingComments::Owner(node)
}

#[derive(Clone, Copy)]
pub(crate) enum FormatTrailingComments<'a> {
    Owner(AstNodes<'a>),
    Comments(CommentList<'a>),
}

impl<'a> Format<'a> for FormatTrailingComments<'a> {
    #[inline(always)]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let comments = match *self {
            Self::Owner(_) if f.is_quiet() => return,
            Self::Owner(node) => f.comments().of_node(node).trailing,
            Self::Comments(comments) => comments,
        };
        if !comments.is_empty() {
            write_trailing_comments(comments, f);
        }
    }
}

#[cold]
fn write_trailing_comments<'a>(comments: CommentList<'a>, f: &mut Formatter<'a>) {
    let mut total_lines_before = 0;
    // `a; // b` and `; // c` on the next line: the one before the empty statement has been written by itself.
    let mut previous_comment: Option<Comment<'a>> = comments.first().and_then(|first| {
        let previous = f.comments().last_printed()?;
        if first.span().start < previous.span().end {
            return None;
        }
        let between = previous.span().between(first.span());
        let is_only_empty_statements =
            (f.source_text()).all_bytes(between, |b| b.is_ascii_whitespace() || b == b';');
        (previous.is_line() && is_only_empty_statements).then_some(previous)
    });

    for comment in comments {
        if !f.comments_mut().mark_printed(comment) {
            continue;
        }

        if is_nestled_jsdoc_comment_after(previous_comment, comment) {
            match total_lines_before > 0 {
                true => write!(f, line_suffix(&comment)),
                false => write!(f, comment),
            }
            previous_comment = Some(comment);
            continue;
        }

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
                f.source_text().text_for(&Span::before(0, comment.span())) == b"\xEF\xBB\xBF";
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

/// The dangling comments that `node` owns.
#[inline]
pub(crate) const fn dangling_comments<'a>(node: AstNodes<'a>) -> FormatDanglingComments<'a> {
    FormatDanglingComments::Owner {
        node,
        indent: DanglingIndentMode::None,
    }
}

pub(crate) enum FormatDanglingComments<'a> {
    Owner {
        node: AstNodes<'a>,
        indent: DanglingIndentMode,
    },
    Comments {
        comments: CommentList<'a>,
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
            FormatDanglingComments::Owner { indent, .. }
            | FormatDanglingComments::Comments { indent, .. } => *indent = mode,
        }
        self
    }
}

impl<'a> Format<'a> for FormatDanglingComments<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (comments, indent) = match *self {
            Self::Owner { .. } if f.is_quiet() => return,
            Self::Owner { node, indent } => (f.comments().of_node(node).dangling, indent),
            Self::Comments { comments, indent } => (comments, indent),
        };
        if !comments.is_empty() {
            write_dangling_comments(comments, indent, f);
        }
    }
}

#[cold]
fn write_dangling_comments<'a>(
    comments: CommentList<'a>,
    indent: DanglingIndentMode,
    f: &mut Formatter<'a>,
) {
    let content = format_with(|f: &mut Formatter<'a>| {
        let mut previous_comment: Option<Comment<'a>> = None;
        for comment in comments {
            if !f.comments_mut().mark_printed(comment) {
                continue;
            }
            let needs_line_break = previous_comment.is_some()
                && !is_nestled_jsdoc_comment_after(previous_comment, comment);
            write!(f, [needs_line_break.then_some(hard_line_break()), comment]);
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

/// oxfmt hands its document for a script of a Vue file to Prettier, whose printer takes away the blanks before a line
/// break.
fn is_printed_by_prettier_for_oxfmt(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt() && f.options().in_html.root != HtmlRoot::None
}

impl<'a> Format<'a> for Comment<'a> {
    /// Prettier's `printComment`.
    fn fmt(&self, f: &mut Formatter<'a>) {
        let content = self.text();
        if self.is_line() {
            // `-->` starts a comment at the start of a line only. oxfmt prints `var --> comment`.
            if content.starts_with(b"-->") {
                write!(f, hard_line_break());
            }
            return write!(f, text(bun_core::strings::trim_js_whitespace_end(content)));
        }
        if super::jsdoc::write_comment(*self, f) {
            return;
        }
        if self.is_indentable_block() {
            // In Markdown, two spaces at the end of a line are a line break.
            let is_jsdoc = content.starts_with(b"/**")
                && (content.get(3) != Some(&b'*') || f.options().flavor.is_oxfmt())
                && !is_printed_by_prettier_for_oxfmt(f);
            let mut lines = bun_core::strings::split_crlf_lines(content).peekable();
            let first = lines.next().unwrap_or_default();
            // A comment that waits for the end of the line would be written at the first line break in this one. Prettier
            // prints `a; /**⏎// b⏎ * c⏎ */` for `a // b⏎; /**⏎ * c⏎ */`.
            write!(f, line_suffix_boundary());
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
