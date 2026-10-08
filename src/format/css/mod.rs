//! CSS, the way Prettier formats it.
//!
//! Prettier parses a style sheet with `postcss`, and what is in it with three more parsers:
//! `postcss-values-parser` for values, `postcss-selector-parser` for selectors and
//! `postcss-media-query-parser` for media queries. What it prints depends on how they take the text
//! apart, mistakes included. So this has the same four parsers.

use crate::{FormatError, FormatOptions};

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

/// Appends the formatted `text` to `out`.
pub fn format(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let _ = (text, parser, options, scratch, out);
    Err(FormatError::SyntaxError)
}
