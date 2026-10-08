//! oxfmt's `jsdoc` option: JSDoc comments are formatted the way
//! [prettier-plugin-jsdoc](https://github.com/hosseinmd/prettier-plugin-jsdoc) does it.
//!
//! This follows `oxc_formatter`'s `formatter/jsdoc` and the parser of `oxc_jsdoc`, which are under the MIT
//! license. Descriptions are parsed by the parser for Markdown of this crate.

mod embedded;
mod imports;
mod line_buffer;
mod markdown;
mod markers;
mod normalize;
mod param_order;
mod parser;
mod serialize;
mod tag_formatters;
mod text;
mod wrap;

use self::serialize::{FormattedJsdoc, format_jsdoc_comment};
use super::comments::Comment;
use crate::prelude::*;
use crate::write;
use bun_core::strings;

/// Writes `comment` formatted, if the `jsdoc` option is set and it is a JSDoc comment that formatting changes.
/// Returns whether it has been written.
pub(crate) fn write_comment<'a>(comment: &Comment, f: &mut Formatter<'a>) -> bool {
    let Some(options) = f.options().jsdoc else {
        return false;
    };
    let content = f.source_text().text_for(&comment.span);
    let Some(inner) = content
        .strip_prefix(b"/**")
        .and_then(|rest| rest.strip_suffix(b"*/"))
    else {
        return false;
    };
    // `/*****/` is none.
    if inner.iter().all(|&byte| byte == b'*') {
        return false;
    }
    let before = f.source_text().slice_range(0, comment.span.start);
    let tab_width = f.options().indent_width.value() as usize;
    let indent: usize = before
        .iter()
        .rev()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .map(|&byte| if byte == b'\t' { tab_width } else { 1 })
        .sum();
    let available_width = (f.options().line_width.value() as usize).saturating_sub(indent);
    let write_lines = |lines: &[u8], f: &mut Formatter<'a>| {
        write!(f, "/**");
        for line in strings::split(lines, b"\n") {
            write!(f, [hard_line_break(), " *"]);
            if !line.is_empty() {
                write!(f, " ");
                f.write_text(line, None);
            }
        }
        write!(f, [hard_line_break(), " */"]);
    };
    // An escape or a blank that is gone would end the comment early.
    let format = |content: &[u8], end: usize, f: &Formatter<'a>| {
        let after = f.file().text().get(end..).unwrap_or_default();
        format_jsdoc_comment(content, after, &options, f.options(), available_width).filter(
            |formatted| match formatted {
                FormattedJsdoc::SingleLine(text) | FormattedJsdoc::MultiLine(text) => {
                    !strings::contains(text, b"*/")
                }
                FormattedJsdoc::Empty => true,
            },
        )
    };

    // Comments that directly follow each other have been made one. Each is formatted by itself, and they go on
    // following each other directly if each has several lines.
    if strings::contains(inner, b"*//**") {
        let mut formatted = Vec::new();
        let mut start = 0;
        while start < content.len() {
            let end = strings::index_of(&content[start..], b"*//**")
                .map_or(content.len(), |at| start + at + 2);
            match format(&content[start..end], comment.span.start as usize + end, f) {
                Some(FormattedJsdoc::MultiLine(lines)) => formatted.push(lines),
                _ => return false,
            }
            start = end;
        }
        for lines in &formatted {
            write_lines(lines, f);
        }
        return true;
    }

    match format(content, comment.span.end as usize, f) {
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
