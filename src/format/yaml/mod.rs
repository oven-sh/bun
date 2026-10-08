//! YAML: Prettier's `language-yaml`, with ports of the parsers that it uses, `yaml` and
//! `yaml-unist-parser`.

mod ast;
mod compose;
mod cst;
mod lexer;
mod printer;

use crate::css::doc::{self, Doc};
use crate::css::text;
use crate::options::{QuoteStyle, TrailingCommas};
use crate::{FormatError, FormatOptions};
use std::borrow::Cow;

/// What can be used again for the next file.
#[derive(Default)]
pub struct Scratch {}

/// Whether Prettier takes the file at `path` for YAML.
pub fn is_yaml_path(path: &[u8]) -> bool {
    let name = &path[bun_core::strings::last_index_of_any(path, b"/\\").map_or(0, |at| at + 1)..];
    const EXTENSIONS: [&[u8]; 10] = [
        b".yml",
        b".mir",
        b".reek",
        b".rviz",
        b".sublime-syntax",
        b".syntax",
        b".yaml",
        b".yaml-tmlanguage",
        b".yaml.sed",
        b".yml.mysql",
    ];
    const NAMES: [&[u8]; 10] = [
        b".clang-format",
        b".clang-tidy",
        b".clangd",
        b".gemrc",
        b"CITATION.cff",
        b"glide.lock",
        b"pixi.lock",
        b".prettierrc",
        b".stylelintrc",
        b".lintstagedrc",
    ];
    NAMES.contains(&name) || EXTENSIONS.iter().any(|extension| name.ends_with(extension))
}

/// Parses `text`, whose line breaks are `\n`, and calls `with_document` with the document for it.
pub(crate) fn parse_and_print<R>(
    text: &[u8],
    options: &FormatOptions,
    with_document: impl FnOnce(Doc<'_>) -> R,
) -> Result<R, FormatError> {
    let lexemes = lexer::lex(text);
    let tokens = cst::parse(text, &lexemes).map_err(|error| match error {
        cst::ParseError::Syntax => FormatError::SyntaxError,
        cst::ParseError::NestedTooDeeply => FormatError::NestedTooDeeply,
    })?;
    let documents = compose::compose(text, &tokens).map_err(|_| FormatError::SyntaxError)?;
    let tree = ast::build(text, &documents, &tokens).map_err(|_| FormatError::SyntaxError)?;
    let mut printer = printer::Printer {
        tree: &tree,
        text,
        prose_wrap: options.prose_wrap,
        single_quote: matches!(options.quote_style, QuoteStyle::Single),
        bracket_spacing: options.bracket_spacing.value(),
        trailing_comma: !matches!(options.trailing_commas, TrailingCommas::None),
        tab_width: u32::from(options.indent_width.value()),
        printed_empty_lines: Vec::new(),
        last_group_id: 0,
    };
    Ok(with_document(printer.print(tree.root, true)))
}

/// Appends the formatted `text` to `out`.
pub fn format(text: &[u8], options: &FormatOptions, _scratch: &mut Scratch, out: &mut Vec<u8>) -> Result<(), FormatError> {
    const BOM: &[u8] = "\u{FEFF}".as_bytes();
    let original = text;
    let (has_bom, text) = match text.strip_prefix(BOM) {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let text: Cow<'_, [u8]> = crate::css::normalize_end_of_line(text);
    if has_bom {
        out.extend_from_slice(BOM);
    }
    if text::trim(&text).is_empty() {
        return Ok(());
    }
    let start = out.len();
    let result = parse_and_print(&text, options, |document| doc::print(document, options, original, out));
    if result.is_err() {
        out.truncate(start - if has_bom { BOM.len() } else { 0 });
    }
    result
}
