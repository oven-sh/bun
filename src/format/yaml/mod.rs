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

/// The document for `text`, whose line breaks are `\n`.
pub(crate) fn document<'a>(text: &'a [u8], options: &FormatOptions) -> Result<Doc<'a>, FormatError> {
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
        printed_empty_lines: Default::default(),
        last_group_id: 0,
    };
    Ok(printer.print(tree.root, true))
}

/// `/^\s*#[^\S\n]*@(?:a|b)\s*?(?:\n|$)/`
fn has_pragma(text: &[u8], pragmas: [&[u8]; 2]) -> bool {
    fn without_blanks(mut text: &[u8]) -> &[u8] {
        while let Some(len) = text::white_space_len_at_start(text).filter(|_| text[0] != b'\n') {
            text = &text[len..];
        }
        text
    }
    let Some(rest) = text::trim_start(text).strip_prefix(b"#") else {
        return false;
    };
    let Some(rest) = without_blanks(rest).strip_prefix(b"@") else {
        return false;
    };
    pragmas.iter().any(|pragma| rest.strip_prefix(*pragma).is_some_and(|rest| matches!(without_blanks(rest).first(), None | Some(b'\n'))))
}

/// `/(?:[/\\]|^)\.(?:prettier|stylelint|lintstaged)rc$/`: a file that Prettier first tries to format as JSON.
fn can_be_json(path: &[u8]) -> bool {
    let name = &path[bun_core::strings::last_index_of_any(path, b"/\\").map_or(0, |at| at + 1)..];
    matches!(name, b".prettierrc" | b".stylelintrc" | b".lintstagedrc")
}

/// Appends the formatted `text` to `out`. `options.filepath` says whether it can be JSON.
pub fn format(text: &[u8], options: &FormatOptions, _scratch: &mut Scratch, out: &mut Vec<u8>) -> Result<(), FormatError> {
    const BOM: &[u8] = "\u{FEFF}".as_bytes();
    let original = text;
    let (has_bom, text) = match text.strip_prefix(BOM) {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let mut text: Cow<'_, [u8]> = crate::css::normalize_end_of_line(text);
    if (options.require_pragma && !has_pragma(&text, [b"format", b"prettier"]))
        || (options.check_ignore_pragma && has_pragma(&text, [b"noformat", b"noprettier"]))
    {
        out.extend_from_slice(original);
        return Ok(());
    }
    // Nothing in YAML is something that Prettier formats on its own.
    let is_range =
        options.range_start.is_some_and(|start| start > 0) || options.range_end.is_some_and(|end| (end as usize) < text.len());
    if options.insert_pragma && !options.require_pragma && !is_range && !has_pragma(&text, [b"format", b"prettier"]) {
        text = Cow::Owned([b"# @format\n\n", &text[..]].concat());
    }
    let start = out.len();
    if has_bom {
        out.extend_from_slice(BOM);
    }
    if text::trim(&text).is_empty() {
        return Ok(());
    }
    // It has to be YAML in any case.
    let document = document(&text, options).inspect_err(|_| out.truncate(start))?;
    if is_range {
        doc::print(doc::replace_end_of_line_with_literal_lines(Cow::Borrowed(&text)), options, original, out);
        return Ok(());
    }
    if options.filepath.as_deref().is_some_and(can_be_json) {
        let end = out.len();
        if crate::json::format(&text, crate::json::Parser::Json, options, &mut Default::default(), out).is_ok() {
            return Ok(());
        }
        out.truncate(end);
    }
    doc::print(document, options, original, out);
    Ok(())
}
