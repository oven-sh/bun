//! oxfmt's `jsdoc` option: JSDoc comments are formatted the way
//! [prettier-plugin-jsdoc](https://github.com/hosseinmd/prettier-plugin-jsdoc) does it.
//!
//! This follows `oxc_formatter`'s `formatter/jsdoc` and the parser of `oxc_jsdoc`, which are under the MIT
//! license. Descriptions are parsed by the parser for Markdown of this crate.

mod embedded;
mod imports;
mod line_buffer;
mod markdown;
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

fn has_line_terminator(text: &[u8]) -> bool {
    strings::index_of_any(text, b"\n\r").is_some() || strings::contains(text, b"\xE2\x80\xA8") || strings::contains(text, b"\xE2\x80\xA9")
}

/// Whether oxc's parser takes `comment`, a block comment, for one that leads what follows it. It trails what is
/// before it if that is on its line and nothing follows on its line.
fn is_leading(comment: &Comment, f: &Formatter<'_>) -> bool {
    let text = f.file().text();
    let slice = |start: u32, end: u32| text.get(start as usize..end as usize).unwrap_or_default();
    // A line break between the token before it and the comment?
    let mut first_start = comment.span.start;
    for before in f.file().comments_before(comment.span).collect::<Vec<_>>().into_iter().rev() {
        let span = before.span();
        if text.get(span.start as usize..).is_some_and(|it| it.starts_with(b"//")) || has_line_terminator(slice(span.end, first_start)) {
            return true;
        }
        first_start = span.start;
    }
    let before = slice(0, first_start);
    let token_end = crate::css::text::trim_end(before).len();
    if token_end == 0 || has_line_terminator(&before[token_end..]) {
        return true;
    }
    // Something on its line behind it?
    let mut rest = text.get(comment.span.end as usize..).unwrap_or_default();
    loop {
        rest = match rest {
            [b' ' | b'\t', tail @ ..] => tail,
            // Behind `=` and `(`, a line comment is not taken for one that trails.
            [b'/', b'/', ..] => return matches!(before[..token_end], [.., b'(']) || is_assignment_operator(&before[..token_end]),
            [b'/', b'*', tail @ ..] => tail.get(strings::index_of(tail, b"*/").map_or(tail.len(), |at| at + 2)..).unwrap_or_default(),
            [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..] => return false,
            _ => return true,
        };
    }
}

/// Whether `text` ends with the token `=`.
fn is_assignment_operator(text: &[u8]) -> bool {
    match text {
        [.., before, b'='] => !matches!(before, b'=' | b'!' | b'<' | b'>' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'?'),
        [b'='] => true,
        _ => false,
    }
}

/// `@license` or `@preserve` in `content`, with something behind it.
fn is_legal(content: &[u8]) -> bool {
    [&b"@license"[..], b"@preserve"].iter().any(|word| {
        let mut from = 0;
        while let Some(at) = strings::index_of(&content[from..], word) {
            if from + at + 8 < content.len() {
                return true;
            }
            from += at + 1;
        }
        false
    })
}

/// Writes `comment` formatted, if the `jsdoc` option is set and it is a JSDoc comment that formatting changes.
/// Returns whether it has been written.
pub(crate) fn write_comment<'a>(comment: &Comment, f: &mut Formatter<'a>) -> bool {
    let Some(options) = f.options().jsdoc else {
        return false;
    };
    let content = f.source_text().text_for(&comment.span);
    let Some(inner) = content.strip_prefix(b"/**").and_then(|rest| rest.strip_suffix(b"*/")) else {
        return false;
    };
    // `/*****/` is none.
    if inner.iter().all(|&byte| byte == b'*') || is_legal(&content[2..content.len() - 2]) || !is_leading(comment, f) {
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
    let after = f.file().text().get(comment.span.end as usize..).unwrap_or_default();
    match format_jsdoc_comment(content, after, &options, f.options(), available_width) {
        None => return false,
        Some(FormattedJsdoc::Empty) => {}
        Some(FormattedJsdoc::SingleLine(line)) => {
            write!(f, "/** ");
            f.write_text(&line, None);
            write!(f, " */");
        }
        Some(FormattedJsdoc::MultiLine(lines)) => {
            write!(f, "/**");
            for line in strings::split(&lines, b"\n") {
                write!(f, [hard_line_break(), " *"]);
                if !line.is_empty() {
                    write!(f, " ");
                    f.write_text(line, None);
                }
            }
            write!(f, [hard_line_break(), " */"]);
        }
    }
    true
}
