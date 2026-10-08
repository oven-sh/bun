//! Code and types in comments, which are formatted as what they are.

use super::text::{trim, trim_end, trim_end_matches, trim_start};
use crate::options::{EmbeddedLanguageFormatting, FormatOptions, LineWidth, TrailingCommas};
use bun_core::strings;

/// The widest line that oxfmt knows.
const MAX_LINE_WIDTH: usize = 320;

/// The options for something in a comment of a file that is formatted with `options`.
pub(super) fn embedded_options(options: &FormatOptions, print_width: usize) -> FormatOptions {
    let width = u16::try_from(print_width)
        .map_or(80, usize::from)
        .clamp(1, MAX_LINE_WIDTH);
    FormatOptions {
        line_width: LineWidth(width as u16),
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

/// `code` formatted as the file at `path`, without white space at its end. `None` if it has a syntax error.
fn parse_and_build(path: &[u8], code: &[u8], options: &FormatOptions) -> Option<Vec<u8>> {
    let format_javascript = options.format_javascript?;
    let mut out = Vec::new();
    if !format_javascript(path, code, options, &mut out) {
        return None;
    }
    out.truncate(trim_end(&out).len());
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

/// Code in a description in one of the languages that prettier-plugin-jsdoc formats and that is neither JavaScript
/// nor TypeScript. `None`: it stays as it is.
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
        line_width: LineWidth(u16::try_from(print_width).unwrap_or(u16::MAX)),
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
    out.truncate(trim_end(&out).len());
    Some(out)
}

/// How deep in template literals the end of `line` is, if its start is `depth` deep.
pub(super) fn update_template_depth(line: &[u8], mut depth: u32) -> u32 {
    // For each `${` that is open: how many braces are open in it.
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

/// `code` formatted as JavaScript or TypeScript, in lines of at most `print_width` columns. `None` if it is
/// neither.
pub(super) fn format_embedded_js(
    code: &[u8],
    print_width: usize,
    options: &FormatOptions,
) -> Option<Vec<u8>> {
    let base_options = embedded_options(options, print_width);
    let trimmed = trim(code);
    if !trimmed.starts_with(b"{") {
        // TSX first: `getItem<number>(..)` is something else in JSX.
        return parse_and_build(TSX, code, &base_options)
            .or_else(|| parse_and_build(JSX, code, &base_options));
    }
    // An object, which would be a block with labels. prettier-plugin-jsdoc formats it as JSON, which keeps the
    // quotes of keys, so one with quotes is left alone.
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
        // Something behind the object: it is a call, and the parentheses are not the ones that were added.
        trim(inner).ends_with(b"}").then(|| inner.to_vec())
    };
    format_object(JSX).or_else(|| format_object(TSX))
}

/// `formatType` of prettier-plugin-jsdoc: the type is formatted as that of `type __t = ..;`. `None` if that
/// fails or changes nothing. `options`: from [`embedded_options`].
pub(super) fn format_type_via_formatter(
    type_str: &[u8],
    options: &FormatOptions,
) -> Option<Vec<u8>> {
    if type_str.is_empty() {
        return None;
    }
    // `...Type` is formatted as `(Type)[]`.
    if let Some(rest) = type_str.strip_prefix(b"...") {
        let rest = trim_start(rest);
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
    let result = trim_start(formatted.get(START.len()..)?);
    let result = trim_end_matches(result, |c| c == ';' || c == '\n');
    let result = trim(result.strip_prefix(b"|").unwrap_or(result));
    (!result.is_empty() && result != type_str).then(|| result.to_vec())
}

/// Whether there is anything in the type that the formatter could change.
fn needs_formatter_pass(type_str: &[u8]) -> bool {
    strings::index_of_any(type_str, b"|&{}()\n").is_some() || strings::contains(type_str, b"=>")
}
