//! oxfmt's `jsdoc` option: formats JSDoc comments the way
//! [prettier-plugin-jsdoc](https://github.com/hosseinmd/prettier-plugin-jsdoc) does.
//!
//! This follows `oxc_formatter`'s `formatter/jsdoc`, which is under the MIT license. `File::jsdoc` parses the comments,
//! and this crate's Markdown parser parses the descriptions.

mod embedded;
mod imports;
mod line_buffer;
mod markdown;
mod markers;
mod normalize;
mod param_order;
mod serialize;
mod tag_formatters;
mod text;
mod wrap;

use self::serialize::{FormattedJsdoc, format_jsdoc_comment};
use super::comments::Comment;
use crate::prelude::*;
use crate::stack::Stack;
use crate::write;
use bun_core::strings;
use bun_lint::ast::jsdoc::JSDoc;

/// Writes the formatted `comment` if the `jsdoc` option is set and it's a JSDoc comment that formatting changes.
/// Returns true if it wrote it.
pub(crate) fn write_comment<'a>(comment: Comment<'_>, f: &mut Formatter<'a>) -> bool {
    let Some(options) = f.options().jsdoc else {
        return false;
    };
    let stack = Stack::for_tree();
    let is_written = write_formatted(comment, &options, &stack, f);
    f.context_mut().ran_out_of_stack |= stack.ran_out();
    is_written
}

fn write_formatted<'a>(
    comment: Comment<'_>,
    options: &JsdocOptions,
    stack: &Stack,
    f: &mut Formatter<'a>,
) -> bool {
    let content = f.source_text().text_for(&comment.span());
    if !content.starts_with(b"/**") {
        return false;
    }
    let docs = f.file().jsdoc();
    // `/*****/` isn't a JSDoc comment.
    let Some(first) = docs
        .at(comment.span().start)
        .filter(|doc| !doc.is_all_asterisks())
    else {
        return false;
    };
    let before = f.source_text().text_for(&Span::before(0, comment.span()));
    let tab_width = f.options().indent_width.value() as usize;
    let indent: usize = before
        .iter()
        .rev()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .map(|&byte| if byte == b'\t' { tab_width } else { 1 })
        .sum();
    let available_width = (f.options().line_width.value() as usize).saturating_sub(indent);
    let write_lines = |lines: &[u8], f: &mut Formatter<'a>| {
        // See `Comment::fmt`. Without the boundary, a pending line suffix comment would be printed after the `/**`.
        write!(f, [line_suffix_boundary(), "/**"]);
        for line in strings::split(lines, b"\n") {
            write!(f, [hard_line_break(), " *"]);
            if !line.is_empty() {
                write!(f, " ");
                f.write_text(line, None);
            }
        }
        write!(f, [hard_line_break(), " */"]);
    };
    // Removing an escape or a space could produce a `*/`, which would end the comment early.
    let format = |doc: JSDoc<'a>, f: &Formatter<'a>| {
        format_jsdoc_comment(doc, f.file(), options, f.options(), available_width, stack).filter(
            |formatted| match formatted {
                FormattedJsdoc::SingleLine(text) | FormattedJsdoc::MultiLine(text) => {
                    !strings::contains(text, b"*/")
                }
                FormattedJsdoc::Empty => true,
            },
        )
    };

    match format(first, f) {
        None => return false,
        Some(FormattedJsdoc::Empty) => {}
        Some(FormattedJsdoc::SingleLine(line)) => {
            write!(f, "/** ");
            f.write_text(&line, None);
            write!(f, " */");
        }
        Some(FormattedJsdoc::MultiLine(lines)) => write_lines(&lines, f),
    }
    true
}
