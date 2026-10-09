//! CSS, the way Prettier formats it.
//!
//! Prettier parses a style sheet with `postcss`, and what is in it with three more parsers:
//! `postcss-values-parser` for values, `postcss-selector-parser` for selectors and
//! `postcss-media-query-parser` for media queries. What it prints depends on how they take the text
//! apart, mistakes included. So this has the same four parsers.

pub(crate) mod doc;
pub(crate) mod embed;
mod media_query;
mod memo;
mod misc;
mod parse;
mod postcss;
mod printer;
mod selector_parser;
mod sink;
mod value_groups;
mod value_parser;

use self::doc::Doc;
use self::memo::Memo;
use self::sink::Sink;
use crate::options::{EmbeddedLanguageFormatting, QuoteStyle, TrailingCommas};
use crate::pragma::BeforeParsing;
use crate::range::Offsets;
use crate::text::{self, BOM};
use crate::{FormatError, FormatOptions, front_matter};
use std::borrow::Cow;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Parser {
    Css,
    Less,
    Scss,
}

impl Parser {
    /// Prettier's `parser` option.
    pub fn from_name(name: &[u8]) -> Option<Parser> {
        match name {
            b"css" => Some(Parser::Css),
            b"less" => Some(Parser::Less),
            b"scss" => Some(Parser::Scss),
            _ => None,
        }
    }
}

/// The parser that Prettier infers from the name of a file. `None` if it is not a style sheet.
pub fn parser_for_path(path: &[u8]) -> Option<Parser> {
    const EXTENSIONS: [(&[u8], Parser); 6] = [
        (b".scss", Parser::Scss),
        (b".css", Parser::Css),
        (b".wxss", Parser::Css),
        (b".pcss", Parser::Css),
        (b".postcss", Parser::Css),
        (b".less", Parser::Less),
    ];
    EXTENSIONS
        .iter()
        .find(|(extension, _)| {
            path.len()
                .checked_sub(extension.len())
                .is_some_and(|at| path[at..].eq_ignore_ascii_case(extension))
        })
        .map(|(_, parser)| *parser)
}

/// Everything that is allocated to format a style sheet. It is reused for the next one.
#[derive(Default)]
pub struct Scratch {
    memo: Memo,
}

/// Prettier's `replaceQuotesInInlineComments`: the inline comments in which quotes and asterisks are to
/// be replaced by blanks, for `postcss-less` not to stumble over them.
fn inline_comments_with_quotes(text: &[u8]) -> Vec<(usize, usize)> {
    #[derive(Copy, Clone, PartialEq)]
    enum State {
        Initial,
        Quotes(u8),
        Url,
        CommentBlock,
        CommentInline,
    }
    let mut state = State::Initial;
    let mut state_to_return_from_quotes = State::Initial;
    let mut inline_comment_start = 0;
    let mut inline_comment_contains_quotes = false;
    let mut comments = Vec::new();
    let mut i = 0;
    while let Some(&c) = text.get(i) {
        match state {
            State::Initial => match c {
                b'\'' | b'"' => state = State::Quotes(c),
                b'u' | b'U'
                    if text
                        .get(i..i + 4)
                        .is_some_and(|it| it.eq_ignore_ascii_case(b"url(")) =>
                {
                    state = State::Url;
                    i += 3;
                }
                b'/' if text.get(i + 1) == Some(&b'*') => {
                    state = State::CommentBlock;
                    i += 1;
                }
                b'/' if text.get(i + 1) == Some(&b'/') => {
                    state = State::CommentInline;
                    inline_comment_start = i;
                    i += 1;
                }
                _ => {}
            },
            State::Quotes(quote) => {
                if c == quote && text[i - 1] != b'\\' {
                    state = std::mem::replace(&mut state_to_return_from_quotes, State::Initial);
                }
                if matches!(c, b'\n' | b'\r') {
                    return Vec::new();
                }
            }
            State::Url => match c {
                b')' => state = State::Initial,
                b'\n' | b'\r' => return Vec::new(),
                b'\'' | b'"' => {
                    state = State::Quotes(c);
                    state_to_return_from_quotes = State::Url;
                }
                _ => {}
            },
            State::CommentBlock => {
                if c == b'/' && text[i - 1] == b'*' {
                    state = State::Initial;
                }
            }
            State::CommentInline => match c {
                b'"' | b'\'' | b'*' => inline_comment_contains_quotes = true,
                b'\n' | b'\r' => {
                    if inline_comment_contains_quotes {
                        comments.push((inline_comment_start, i));
                    }
                    state = State::Initial;
                    inline_comment_contains_quotes = false;
                }
                _ => {}
            },
        }
        i += 1;
    }
    comments
}

/// `each(@list, { .. })` of Less is a statement for oxfmt, which writes the `;` behind it if there is none. `postcss-less`
/// goes on to the next `;`, wherever that is. So here the `;` is there before anything is parsed.
fn with_semicolons_behind_each(text: &[u8]) -> Cow<'_, [u8]> {
    if !bun_core::strings::contains(text, b"each(") {
        return Cow::Borrowed(text);
    }
    // How many `(` are open, and how many were when the statement started that the scan is in. What is in its parentheses
    // is printed as it is.
    let mut depth = 0usize;
    let mut statement = None;
    let mut missing: Vec<usize> = Vec::new();
    // The last character that is neither white space nor in a comment.
    let mut last = b';';
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        let rest = &text[at..];
        let len = match byte {
            b'"' | b'\'' => {
                let mut end = 1;
                while rest.get(end).is_some_and(|it| *it != byte) {
                    end += 1 + usize::from(rest[end] == b'\\');
                }
                end + 1
            }
            b'/' if rest.starts_with(b"/*") => {
                at +=
                    bun_core::strings::index_of(&rest[2..], b"*/").map_or(rest.len(), |it| it + 4);
                continue;
            }
            b'/' if rest.starts_with(b"//") && last != b':' => {
                at += bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
                continue;
            }
            b'e' if statement.is_none()
                && matches!(last, b';' | b'{' | b'}')
                && rest.starts_with(b"each(") =>
            {
                statement = Some(depth);
                depth += 1;
                5
            }
            b'(' => {
                depth += 1;
                1
            }
            b')' => {
                depth = depth.saturating_sub(1);
                if statement == Some(depth) {
                    statement = None;
                    let blanks = text::leading_white_space_len(&rest[1..]);
                    if rest.get(1 + blanks) != Some(&b';') {
                        missing.push(at + 1);
                    }
                    (at, last) = (at + 1, b';');
                    continue;
                }
                1
            }
            _ => 1,
        };
        at += len;
        if !byte.is_ascii_whitespace() {
            last = text.get(at - 1).map_or(byte, |it| *it);
        }
    }
    if missing.is_empty() {
        return Cow::Borrowed(text);
    }
    let mut result = Vec::with_capacity(text.len() + missing.len());
    let mut from = 0;
    for at in missing {
        result.extend_from_slice(&text[from..at]);
        result.push(b';');
        from = at;
    }
    result.extend_from_slice(&text[from..]);
    Cow::Owned(result)
}

/// `normalizeEndOfLine`
pub(crate) fn normalize_end_of_line(text: &[u8]) -> Cow<'_, [u8]> {
    if !bun_core::strings::contains_char(text, b'\r') {
        return Cow::Borrowed(text);
    }
    let mut normalized = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\r') {
        normalized.extend_from_slice(&rest[..at]);
        normalized.push(b'\n');
        rest = &rest[at + 1..];
        rest = rest.strip_prefix(b"\n").unwrap_or(rest);
    }
    normalized.extend_from_slice(rest);
    Cow::Owned(normalized)
}

/// Parses `text`, whose line breaks are `\n`, and writes it to `sink`.
fn parse_and_print<'o>(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    mut sink: Sink<'o>,
    memo: &'o mut Memo,
) -> Result<Sink<'o>, FormatError> {
    let with_semicolons = match parser == Parser::Less && options.flavor.is_oxfmt() {
        true => with_semicolons_behind_each(text),
        false => Cow::Borrowed(text),
    };
    let text = &with_semicolons[..];
    // What is parsed has blanks in the place of the front matter, so that all positions stay.
    let front_matter = front_matter::parse(text).map(|it| &text[..it.end]);
    let mut blanked: Cow<'_, [u8]> = match front_matter {
        None => Cow::Borrowed(text),
        Some(front_matter) => {
            let mut blanked = text.to_vec();
            for byte in &mut blanked[..front_matter.len()] {
                if *byte != b'\n' {
                    *byte = b' ';
                }
            }
            Cow::Owned(blanked)
        }
    };

    if parser == Parser::Less {
        for (start, end) in inline_comments_with_quotes(&blanked) {
            for byte in &mut blanked.to_mut()[start..end] {
                if matches!(byte, b'"' | b'\'' | b'*') {
                    *byte = b' ';
                }
            }
        }
    }

    let placeholder = match options.flavor.is_oxfmt() {
        true => postcss::Placeholder::Statement,
        false => postcss::Placeholder::AtRule,
    };
    let tree = postcss::parse(&blanked, parser, placeholder).map_err(FormatError::SyntaxErrorAt)?;
    if let Some(front_matter) = front_matter {
        let has_nodes = tree.nodes[0].first_child != 0;
        // Prettier's `printEmbedFrontMatter`.
        let first_line_end =
            text::index_of_char_from(front_matter, b'\n', 0).unwrap_or(front_matter.len());
        let last_line_start =
            bun_core::strings::last_index_of_char(front_matter, b'\n').map_or(0, |at| at + 1);
        let language = text::trim(&front_matter[3..first_line_end]);
        let is_toml =
            language == b"toml" || (language.is_empty() && front_matter.starts_with(b"+++"));
        let is_yaml = language == b"yaml" || (language.is_empty() && !is_toml);
        let value = text::trim(
            front_matter
                .get(first_line_end..last_line_start)
                .unwrap_or_default(),
        );
        // There is no formatter for TOML, and what is not YAML after all stays as it is.
        let formatted = match value {
            _ if matches!(
                options.embedded_language_formatting,
                EmbeddedLanguageFormatting::Off
            ) =>
            {
                None
            }
            b"" if is_yaml || is_toml => Some(Doc::EMPTY),
            _ if is_yaml => crate::yaml::document(value, options)
                .ok()
                .map(|it| doc::strip_trailing_hardline(doc::clean(it))),
            _ => None,
        };
        let front_matter = match formatted {
            Some(formatted) => Doc::MarkAsRoot(Box::new(Doc::Array(vec![
                Doc::from(&front_matter[..3]),
                Doc::from(language),
                doc::hardline(),
                if formatted.is_empty_text() {
                    Doc::EMPTY
                } else {
                    Doc::Array(vec![formatted, doc::hardline()])
                },
                Doc::from(&front_matter[last_line_start..]),
            ]))),
            None => Doc::from(front_matter),
        };
        sink.document(&Doc::Array(vec![
            front_matter,
            doc::hardline(),
            if has_nodes {
                doc::hardline()
            } else {
                Doc::EMPTY
            },
        ]));
    }
    let mut printer = printer::Printer {
        context: parse::Context {
            text: &blanked,
            original_text: text,
            is_original_text: matches!(blanked, Cow::Borrowed(_)),
            extra: &tree.extra,
            syntax: parser,
            is_oxfmt: options.flavor.is_oxfmt(),
            refusal: Default::default(),
        },
        single_quote: matches!(options.quote_style, QuoteStyle::Single),
        trailing_comma: !matches!(options.trailing_commas, TrailingCommas::None),
        is_oxfmt: options.flavor.is_oxfmt(),
        is_html_style_attribute: options.in_html.is_style_attribute,
        tailwind: options.tailwind.clone(),
        value_stack: Vec::new(),
        comment_behind_comma: 0,
        index_in_comma_group: 0,
        comments_above_item: (0, 0),
        scratch: Vec::new(),
        failure: None,
        sink,
        memo,
        is_memoizable: false,
    };
    printer.print_root(&tree, &mut parse::Parsed::default());
    match printer.failure {
        Some(error) => Err(FormatError::SyntaxErrorAt(error)),
        None => Ok(printer.sink),
    }
}

/// Prettier's `textToDoc`: the document for `text`, whose line breaks are `\n`, in another language.
pub(crate) fn document(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
) -> Result<Doc<'static>, FormatError> {
    let mut memo = Memo::default();
    let sink = parse_and_print(text, parser, options, Sink::to_document(), &mut memo)?;
    Ok(doc::strip_trailing_hardline(doc::clean(
        sink.into_document(),
    )))
}

/// Appends the formatted `text` to `out`.
pub fn format(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let original = text;
    let (has_bom, text) = match text.strip_prefix(BOM) {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let in_original = |error: FormatError| error.before_normalizing_end_of_line(text);
    // Prettier's `normalizeInputAndOptions`: the offsets count UTF-16 code units of `original`.
    let first = original.len() - text.len();
    let Offsets { start, end, .. } = Offsets::new(original, first, options);
    if start >= end && !text.is_empty() {
        out.extend_from_slice(original);
        return Ok(());
    }
    // Nothing in a style sheet is something that Prettier formats on its own.
    let is_range = start > first || end < original.len();
    let text = normalize_end_of_line(text);
    let text = match crate::pragma::before_parsing_css(
        &text,
        front_matter::parse(&text).map_or(0, |it| it.end),
        !is_range,
        options,
    ) {
        BeforeParsing::LeaveAsItIs => {
            out.extend_from_slice(original);
            return Ok(());
        }
        BeforeParsing::Format(text) => text,
    };
    let text = &text[..];
    if text::trim(text).is_empty() {
        if has_bom {
            out.extend_from_slice(BOM);
        }
        return Ok(());
    }
    let start = out.len();
    if has_bom {
        out.extend_from_slice(BOM);
    }
    if is_range {
        parse_and_print(
            text,
            parser,
            options,
            Sink::to_document(),
            &mut scratch.memo,
        )
        .inspect_err(|_| out.truncate(start))
        .map_err(in_original)?;
        doc::print(
            doc::replace_end_of_line_with_literal_lines(Cow::Borrowed(text)),
            options,
            original,
            out,
        );
        return Ok(());
    }
    let is_in_html = options.in_html.root != crate::options::HtmlRoot::None;
    let sink = Sink::to_output(doc::Printer::new(options, original, out), is_in_html);
    let result = parse_and_print(text, parser, options, sink, &mut scratch.memo).map(drop);
    result
        .inspect_err(|_| out.truncate(start))
        .map_err(in_original)
}
