//! What `print/jsx/` and the code around JSX elements share.

use crate::prelude::*;
use crate::{format_args, write};

fn is_jsx_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\n' | b'\t' | b'\r')
}

/// Prettier's `isMeaningfulJsxText`: it is not only white space with a line break in it.
pub(crate) fn is_meaningful_jsx_text(text: &[u8]) -> bool {
    !text.iter().copied().all(is_jsx_whitespace) || !bun_core::strings::contains_char(text, b'\n')
}

/// Whether an element gets parentheses if it breaks.
#[derive(Copy, Clone, Debug)]
pub(crate) enum WrapState {
    /// Where it is, it is set apart already: in an array, in `{}`, as an argument.
    NoWrap,
    WrapOnBreak,
}

/// A space between children. At the end of a line it has to be written as `{" "}`.
pub(crate) struct JsxSpace;

impl<'a> Format<'a> for JsxSpace {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, [if_group_breaks(&format_args!(JsxRawSpace, soft_line_break())), if_group_fits_on_line(&space())]);
    }
}

/// `{" "}`
pub(crate) struct JsxRawSpace;

impl<'a> Format<'a> for JsxRawSpace {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(
            f,
            match f.options().quote_style {
                QuoteStyle::Double => r#"{" "}"#,
                QuoteStyle::Single => "{' '}",
            }
        );
    }
}

/// `{" "}`. `child`: what is in the braces.
pub(crate) fn is_whitespace_jsx_expression<'a>(child: Expr<'a>, comments: &Comments<'a>) -> bool {
    matches!(child.kind(), ExprKind::String(value) if value.bytes() == b" ")
        && !child.is_jsx_text()
        && child.jsx_container_span().is_some_and(|span| !comments.has_comment_in_span(span))
}

/// `<a />`
pub(crate) fn is_self_closing_element(child: Expr<'_>) -> bool {
    child.jsx_container_span().is_none() && matches!(child.kind(), ExprKind::Jsx(jsx) if jsx.is_self_closing())
}

/// A child of an element, with text split into its words.
#[derive(Debug, Clone, Copy)]
pub(crate) enum JsxChild<'a> {
    Word(JsxWord<'a>),
    /// White space without a line break, or `{" "}`: it means a space.
    Whitespace,
    /// White space with a line break next to text: it means nothing, and shows where a line can
    /// end.
    Newline,
    /// White space with an empty line between two children that are not text.
    EmptyLine,
    /// An element, or something in braces.
    NonText(Expr<'a>),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct JsxWord<'a> {
    text: &'a [u8],
}

impl JsxWord<'_> {
    fn chars(&self) -> impl Iterator<Item = char> {
        bstr::ByteSlice::chars(self.text)
    }

    pub(crate) fn is_single_character(&self) -> bool {
        self.chars().count() == 1
    }

    pub(crate) fn is_single_alphabetic_character(&self) -> bool {
        self.is_single_character() && self.chars().all(char::is_alphabetic)
    }
}

impl<'a> Format<'a> for JsxWord<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, text_without_whitespace(self.text));
    }
}

/// Runs of white space and runs of anything else, in turns.
fn chunks(text: &[u8]) -> impl Iterator<Item = (bool, &[u8])> {
    text.chunk_by(|a, b| is_jsx_whitespace(*a) == is_jsx_whitespace(*b))
        .map(|chunk| (chunk.first().copied().is_some_and(is_jsx_whitespace), chunk))
}

/// Prettier's `separatorWithWhitespace` and the splitting in `printJsxChildren`.
pub(crate) fn jsx_split_children<'a>(jsx: Jsx<'a>, comments: &Comments<'a>, source: SourceText<'a>) -> Vec<JsxChild<'a>> {
    let has_newline = |whitespace: &[u8]| bun_core::strings::contains_char(whitespace, b'\n');
    let mut builder = JsxSplitChildrenBuilder { buffer: Vec::new() };

    for child in jsx.children_with_whitespace() {
        let text = match child {
            bun_lint::ast::JsxChild::Whitespace(span) => source.text_for(&span),
            bun_lint::ast::JsxChild::Expr(e) if e.is_jsx_text() => e.text(),
            bun_lint::ast::JsxChild::Expr(e) if is_whitespace_jsx_expression(e, comments) => {
                builder.entry(JsxChild::Whitespace);
                continue;
            }
            bun_lint::ast::JsxChild::Expr(e) => {
                builder.entry(JsxChild::NonText(e));
                continue;
            }
        };

        let mut chunks = chunks(text).peekable();
        if let Some((_, whitespace)) = chunks.next_if(|it| it.0) {
            if !has_newline(whitespace) {
                builder.entry(JsxChild::Whitespace);
            } else if chunks.peek().is_none() {
                // Nothing but white space.
                if bun_core::strings::count_char(whitespace, b'\n') > 1 {
                    builder.entry(JsxChild::EmptyLine);
                }
                continue;
            } else {
                builder.entry(JsxChild::Newline);
            }
        }
        while let Some((is_whitespace, chunk)) = chunks.next() {
            if !is_whitespace {
                builder.entry(JsxChild::Word(JsxWord { text: chunk }));
            } else if chunks.peek().is_none() {
                // That between words is a place where the line can break, no more.
                builder.entry(if has_newline(chunk) { JsxChild::Newline } else { JsxChild::Whitespace });
            }
        }
    }
    builder.buffer
}

struct JsxSplitChildrenBuilder<'a> {
    buffer: Vec<JsxChild<'a>>,
}

impl<'a> JsxSplitChildrenBuilder<'a> {
    /// Of several kinds of white space in a row, only one is kept. A space wins.
    fn entry(&mut self, child: JsxChild<'a>) {
        match self.buffer.last_mut() {
            Some(last @ (JsxChild::EmptyLine | JsxChild::Newline | JsxChild::Whitespace)) => match child {
                JsxChild::Whitespace => *last = child,
                JsxChild::NonText(_) | JsxChild::Word(_) => self.buffer.push(child),
                JsxChild::Newline | JsxChild::EmptyLine => {}
            },
            _ => self.buffer.push(child),
        }
    }
}
