//! Formats code and types embedded in comments, each in its own language.

use super::text::trim_end_matches;
use crate::options::{
    EmbeddedLanguageFormatting, FormatOptions, LineEnding, LineWidth, TrailingCommas,
};
use bun_core::strings;

/// oxfmt's maximum line width.
const MAX_LINE_WIDTH: usize = 320;

/// Returns the options for content embedded in a comment of a file that's formatted with `options`.
pub(super) fn embedded_options(options: &FormatOptions, print_width: usize) -> FormatOptions {
    // oxfmt stores it in 16 bits.
    let width = u16::try_from(print_width)
        .map_or(80, usize::from)
        .clamp(1, MAX_LINE_WIDTH);
    FormatOptions {
        line_width: LineWidth(width as u32),
        // The lines are written to the file's document one by one.
        line_ending: LineEnding::Lf,
        jsdoc: None,
        sort_imports: None,
        filepath: None,
        parser: None,
        range_start: None,
        range_end: None,
        cursor_offset: None,
        insert_pragma: false,
        require_pragma: false,
        check_ignore_pragma: false,
        is_in_markdown: false,
        ..options.clone()
    }
}

/// Formats `code` as if it were the file at `path`, and trims trailing whitespace. Returns `None` on a syntax error.
fn parse_and_build(path: &[u8], code: &[u8], options: &FormatOptions) -> Option<Vec<u8>> {
    let format_javascript = options.format_javascript?;
    let mut out = Vec::new();
    if !format_javascript(path, code, options, &mut out) {
        return None;
    }
    out.truncate(strings::trim_unicode_whitespace_end(&out).len());
    Some(out)
}

const TSX: &[u8] = b"dummy.tsx";
const JSX: &[u8] = b"dummy.jsx";

pub(super) fn is_js_ts_lang(lang: &[u8]) -> bool {
    [
        &b"js"[..],
        b"javascript",
        b"jsx",
        b"ts",
        b"typescript",
        b"tsx",
    ]
    .iter()
    .any(|name| lang.eq_ignore_ascii_case(name))
}

/// Formats code in a description, for the languages other than JavaScript and TypeScript that prettier-plugin-jsdoc
/// formats. `None` means the code stays as it is.
pub(super) fn format_embedded_language(
    lang: &[u8],
    code: &[u8],
    print_width: usize,
    options: &FormatOptions,
) -> Option<Vec<u8>> {
    if matches!(
        options.embedded_language_formatting,
        EmbeddedLanguageFormatting::Off
    ) {
        return None;
    }
    let options = FormatOptions {
        line_width: LineWidth(u32::try_from(print_width).unwrap_or(u32::MAX)),
        ..embedded_options(options, print_width)
    };
    let mut out = Vec::new();
    let css = |parser, out: &mut Vec<u8>| {
        crate::css::format(code, parser, &options, &mut Default::default(), out)
    };
    match &lang.to_ascii_lowercase()[..] {
        b"css" => css(crate::css::Parser::Css, &mut out),
        b"less" => css(crate::css::Parser::Less, &mut out),
        b"scss" => css(crate::css::Parser::Scss, &mut out),
        b"json" => crate::json::format(
            code,
            crate::json::Parser::Json,
            &options,
            &mut Default::default(),
            &mut out,
        ),
        b"yaml" => crate::yaml::format(code, &options, &mut Default::default(), &mut out),
        _ => return None,
    }
    .ok()?;
    out.truncate(strings::trim_unicode_whitespace_end(&out).len());
    Some(out)
}

/// Returns the template literal nesting depth at the end of `line`, given `depth` at its start.
pub(super) fn update_template_depth(line: &[u8], mut depth: u32) -> u32 {
    // For each open `${`, the number of open braces inside it.
    let mut expression_brace_depth: smallvec::SmallVec<[u32; 4]> = smallvec::SmallVec::new();
    let mut i = 0;
    while i < line.len() {
        match line[i] {
            b'\\' => i += 1,
            b'`' if expression_brace_depth.is_empty() => {
                depth = u32::from(depth == 0) + depth.saturating_sub(1)
            }
            b'`' => expression_brace_depth.push(0),
            b'$' if depth > 0 && line.get(i + 1) == Some(&b'{') => {
                expression_brace_depth.push(0);
                i += 1;
            }
            b'{' => {
                if let Some(last) = expression_brace_depth.last_mut() {
                    *last += 1;
                }
            }
            b'}' => match expression_brace_depth.last_mut() {
                Some(0) => {
                    expression_brace_depth.pop();
                }
                Some(last) => *last -= 1,
                None => {}
            },
            _ => {}
        }
        i += 1;
    }
    depth
}

/// Formats `code` as JavaScript or TypeScript with lines of at most `print_width` columns. Returns `None` if it parses
/// as neither.
pub(super) fn format_embedded_js(
    code: &[u8],
    print_width: usize,
    options: &FormatOptions,
) -> Option<Vec<u8>> {
    let base_options = embedded_options(options, print_width);
    let trimmed = strings::trim_unicode_whitespace(code);
    if !trimmed.starts_with(b"{") {
        // Try TSX first, because `getItem<number>(..)` means something else in JSX.
        return parse_and_build(TSX, code, &base_options)
            .or_else(|| parse_and_build(JSX, code, &base_options));
    }
    // An object literal, which would parse as a block with labels. prettier-plugin-jsdoc formats it as JSON, which
    // keeps quoted keys, so an object with quotes is left as is.
    let has_quoted_keys = strings::index_of_char_usize(trimmed, b'"').is_some_and(|quote| {
        strings::index_of_char_usize(trimmed, b'}').is_some_and(|brace| quote < brace)
    });
    if has_quoted_keys {
        return None;
    }
    let wrapped = [b"(", trimmed, b")"].concat();
    let object_options = FormatOptions {
        trailing_commas: TrailingCommas::None,
        ..base_options
    };
    let format_object = |path: &[u8]| -> Option<Vec<u8>> {
        let formatted = parse_and_build(path, &wrapped, &object_options)?;
        let Some(inner) = formatted
            .strip_prefix(b"(")
            .and_then(|inner| inner.strip_suffix(b");"))
        else {
            return Some(formatted);
        };
        // Something follows the object, so this is a call, and the parentheses aren't the ones we added.
        strings::trim_unicode_whitespace(inner)
            .ends_with(b"}")
            .then(|| inner.to_vec())
    };
    format_object(JSX).or_else(|| format_object(TSX))
}

/// prettier-plugin-jsdoc's `formatType`: formats the type as the right side of `type __t = ..;`. Returns `None` if that
/// fails or changes nothing. `options` come from [`embedded_options`].
pub(super) fn format_type_via_formatter(
    type_str: &[u8],
    options: &FormatOptions,
) -> Option<Vec<u8>> {
    if type_str.is_empty() {
        return None;
    }
    // `...Type` is formatted as `(Type)[]`.
    if let Some(rest) = type_str.strip_prefix(b"...") {
        let rest = strings::trim_unicode_whitespace_start(rest);
        if rest.is_empty() {
            return None;
        }
        let formatted = format_type_via_formatter(&[b"(", rest, b")[]"].concat(), options)?;
        return Some([b"...", formatted.strip_suffix(b"[]")?].concat());
    }
    if !needs_formatter_pass(type_str) {
        return None;
    }
    const START: &[u8] = b"type __t = ";
    let formatted = parse_and_build(TSX, &[START, type_str, b";"].concat(), options)?;
    let result = strings::trim_unicode_whitespace_start(formatted.get(START.len()..)?);
    let result = trim_end_matches(result, |c| c == ';' || c == '\n');
    let result = strings::trim_unicode_whitespace(result.strip_prefix(b"|").unwrap_or(result));
    (!result.is_empty() && result != type_str).then(|| result.to_vec())
}

/// True if the type contains anything the formatter could change.
fn needs_formatter_pass(type_str: &[u8]) -> bool {
    strings::index_of_any(type_str, b"|&{}()\n").is_some() || strings::contains(type_str, b"=>")
}
