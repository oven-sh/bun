//! YAML: Prettier's `language-yaml`, with ports of the parsers that it uses, `yaml` and
//! `yaml-unist-parser`.

mod ast;
mod compose;
mod cst;
mod lexer;
mod printer;

use crate::css::doc::{self, Doc, Elements};
use crate::options::{QuoteStyle, TrailingCommas};
use crate::syntax_error::{Message, SyntaxError};
use crate::text::{self, BOM, has_pragma_in_hash_comment as has_pragma};
use crate::{FormatError, FormatOptions};
use std::borrow::Cow;

/// What can be used again for the next file.
#[derive(Default)]
pub struct Scratch {
    elements: Elements,
}

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

/// The document for `text`, whose line breaks are `\n`, as a tree.
pub(crate) fn document(text: &[u8], options: &FormatOptions) -> Result<Doc<'static>, FormatError> {
    let mut elements = Elements::default();
    write_document(text, options, &mut elements)?;
    Ok(elements.to_tree())
}

/// Writes the document for `text`, whose line breaks are `\n`, to `out`, which is empty.
fn write_document(
    text: &[u8],
    options: &FormatOptions,
    out: &mut Elements,
) -> Result<(), FormatError> {
    let lexemes = lexer::lex(text);
    let tokens = cst::parse(text, &lexemes).map_err(|(error, at)| match error {
        cst::ParseError::Syntax => {
            FormatError::SyntaxErrorAt(SyntaxError(Message::UnexpectedToken, at))
        }
        cst::ParseError::NestedTooDeeply => FormatError::NestedTooDeeply,
    })?;
    let documents = compose::compose(text, &tokens).map_err(FormatError::SyntaxErrorAt)?;
    let tree = ast::build(text, &documents, &tokens).map_err(FormatError::SyntaxErrorAt)?;
    let mut printer = printer::Printer {
        tree: &tree,
        text,
        prose_wrap: options.prose_wrap,
        single_quote: matches!(options.quote_style, QuoteStyle::Single),
        bracket_spacing: options.bracket_spacing.value(),
        trailing_comma: !matches!(options.trailing_commas, TrailingCommas::None),
        // Without indentation there is no structure, so for oxfmt there is some.
        tab_width: u32::from(options.indent_width.value())
            .max(u32::from(options.flavor.is_oxfmt())),
        is_oxfmt: options.flavor.is_oxfmt(),
        is_last_document: true,
        is_first_item_ignored: false,
        comment_in_brackets: None,
        printed_empty_lines: vec![false; text.len() + 1],
        last_group_id: 0,
        out,
    };
    printer.print(tree.root, true);
    Ok(())
}

/// `/(?:[/\\]|^)\.(?:prettier|stylelint|lintstaged)rc$/`: a file that Prettier first tries to format as JSON.
fn can_be_json(path: &[u8]) -> bool {
    let name = &path[bun_core::strings::last_index_of_any(path, b"/\\").map_or(0, |at| at + 1)..];
    matches!(name, b".prettierrc" | b".stylelintrc" | b".lintstagedrc")
}

/// Appends the formatted `text` to `out`. `options.filepath` says whether it can be JSON.
pub fn format(
    text: &[u8],
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
    let mut text: Cow<'_, [u8]> = crate::css::normalize_end_of_line(text);
    if (options.require_pragma && !has_pragma(&text, [b"format", b"prettier"]))
        || (options.check_ignore_pragma && has_pragma(&text, [b"noformat", b"noprettier"]))
    {
        out.extend_from_slice(original);
        return Ok(());
    }
    // Nothing in YAML is something that Prettier formats on its own.
    let is_range = options.range_start.is_some_and(|start| start > 0)
        || options
            .range_end
            .is_some_and(|end| (end as usize) < text.len());
    if options.insert_pragma
        && !options.require_pragma
        && !is_range
        && !has_pragma(&text, [b"format", b"prettier"])
    {
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
    let document = &mut scratch.elements;
    document.clear();
    write_document(&text, options, document)
        .inspect_err(|_| out.truncate(start))
        .map_err(in_original)?;
    if is_range {
        doc::print(
            doc::replace_end_of_line_with_literal_lines(Cow::Borrowed(&text)),
            options,
            original,
            out,
        );
        return Ok(());
    }
    if options.filepath.as_deref().is_some_and(can_be_json) {
        let end = out.len();
        if crate::json::format(
            &text,
            crate::json::Parser::Json,
            options,
            &mut Default::default(),
            out,
        )
        .is_ok()
        {
            return Ok(());
        }
        out.truncate(end);
    }
    doc::Printer::new(options, original, out).print(document, 0, 0);
    Ok(())
}
