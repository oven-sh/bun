//! CSS, the way Prettier formats it.
//!
//! Prettier parses a style sheet with `postcss`, and what is in it with three more parsers:
//! `postcss-values-parser` for values, `postcss-selector-parser` for selectors and
//! `postcss-media-query-parser` for media queries. What it prints depends on how they take the text
//! apart, mistakes included. So this has the same four parsers.

mod doc;
pub(crate) mod embed;
mod media_query;
mod misc;
mod parse;
mod postcss;
mod printer;
mod selector_parser;
mod text;
mod value_groups;
mod value_parser;

use self::doc::Doc;
use crate::options::{QuoteStyle, TrailingCommas};
use crate::pragma::BeforeParsing;
use crate::{FormatError, FormatOptions};
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
    const EXTENSIONS: [(&[u8], Parser); 5] = [
        (b".css", Parser::Css),
        (b".wxss", Parser::Css),
        (b".pcss", Parser::Css),
        (b".postcss", Parser::Css),
        (b".less", Parser::Less),
    ];
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(b".scss") {
        return Some(Parser::Scss);
    }
    EXTENSIONS.iter().find(|(extension, _)| lower.ends_with(extension)).map(|(_, parser)| *parser)
}

/// Everything that is allocated to format a style sheet. It is reused for the next one.
#[derive(Default)]
pub struct Scratch {}

/// Prettier's `parseFrontMatter`: the length of the front matter at the start of `text`.
fn front_matter_len(text: &[u8]) -> Option<usize> {
    let delimiter = text.get(..3).filter(|it| matches!(*it, b"---" | b"+++"))?;
    let first_line_break = text::index_of_char_from(text, b'\n', 3)?;
    let language = text::trim(&text[3..first_line_break]);
    let is_yaml = delimiter == b"---" && (language.is_empty() || language == b"yaml");
    let end = text::index_of_from(text, &[b"\n", delimiter].concat(), first_line_break)
        .or_else(|| text::index_of_from(text, b"\n...", first_line_break).filter(|_| is_yaml))?;
    Some(end + 1 + 3)
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
                b'u' | b'U' if text.get(i..i + 4).is_some_and(|it| it.eq_ignore_ascii_case(b"url(")) => {
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

/// `normalizeEndOfLine`
fn normalize_end_of_line(text: &[u8]) -> Cow<'_, [u8]> {
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

/// Parses `text`, whose line breaks are `\n`, and calls `with_document` with the document for it.
fn parse_and_print<R>(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    with_document: impl FnOnce(Doc<'_>) -> R,
) -> Result<R, FormatError> {
    // What is parsed has blanks in the place of the front matter, so that all positions stay.
    let front_matter = front_matter_len(text).map(|len| &text[..len]);
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

    let tree = postcss::parse(&blanked, parser).map_err(|_| FormatError::SyntaxError)?;
    let root = parse::parse(&tree, &blanked, text, parser).map_err(|_| FormatError::SyntaxError)?;
    let mut printer = printer::Printer {
        text,
        syntax: parser,
        single_quote: matches!(options.quote_style, QuoteStyle::Single),
        trailing_comma: !matches!(options.trailing_commas, TrailingCommas::None),
        css_stack: Vec::new(),
        value_stack: Vec::new(),
        has_failed: false,
    };
    let mut document = printer.print_root(&root);
    if printer.has_failed {
        return Err(FormatError::SyntaxError);
    }
    if let Some(front_matter) = front_matter {
        let has_nodes = root.nodes.as_ref().is_some_and(|nodes| !nodes.is_empty());
        // Prettier's `printEmbedFrontMatter`, for front matter that is empty.
        let first_line_end = text::index_of_char_from(front_matter, b'\n', 0).unwrap_or(front_matter.len());
        let last_line_start = bun_core::strings::last_index_of_char(front_matter, b'\n').map_or(0, |at| at + 1);
        let language = text::trim(&front_matter[3..first_line_end]);
        let is_embedded = matches!(language, b"" | b"yaml" | b"toml");
        let is_empty = text::trim(front_matter.get(first_line_end..last_line_start).unwrap_or_default()).is_empty();
        let front_matter = match is_embedded && is_empty {
            true => Doc::Array(vec![
                Doc::from(&front_matter[..3]),
                Doc::from(language),
                doc::hardline(),
                Doc::from(&front_matter[last_line_start..]),
            ]),
            false => Doc::from(front_matter),
        };
        document = Doc::Array(vec![
            front_matter,
            doc::hardline(),
            if has_nodes { doc::hardline() } else { Doc::EMPTY },
            document,
        ]);
    }
    Ok(with_document(document))
}

/// Appends the formatted `text` to `out`.
pub fn format(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    _scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    const BOM: &[u8] = "\u{FEFF}".as_bytes();
    let original = text;
    let (has_bom, text) = match text.strip_prefix(BOM) {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let text = normalize_end_of_line(text);
    let text = match crate::pragma::before_parsing_css(&text, front_matter_len(&text).unwrap_or(0), options) {
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
    // Nothing in a style sheet is something that Prettier formats on its own.
    let is_range = options.range_start.is_some_and(|start| start > 0)
        || options.range_end.is_some_and(|end| (end as usize) < text.len());
    parse_and_print(text, parser, options, |document| {
        if has_bom {
            out.extend_from_slice(BOM);
        }
        let document = match is_range {
            true => doc::replace_end_of_line_with_literal_lines(Cow::Borrowed(text)),
            false => document,
        };
        doc::print(document, options, original, out);
    })
}
