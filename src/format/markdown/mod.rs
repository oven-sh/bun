//! Markdown.
//!
//! The specification is Prettier's `src/language-markdown`, which parses with micromark.
//!
//! ```text
//! text ─ block::parse (with inline) ─→ Tree (mdast) ─ preprocess ─→ sentences ─ printer ─→ the document of `css::doc`
//! ```

mod ast;
mod block;
mod content;
mod front_matter;
mod inline;
mod preprocess;
mod printer;
mod strings;
mod unicode_tables;

use crate::css::doc;
use crate::options::{EmbeddedLanguageFormatting, LineEnding, LineWidth};
use crate::range::write_with_line_ending;
use crate::{FormatError, FormatOptions};

/// Whether Prettier takes the file at `path` for Markdown.
pub fn is_markdown_path(path: &[u8]) -> bool {
    const EXTENSIONS: [&[u8]; 10] = [
        b".md", b".livemd", b".markdown", b".mdown", b".mdwn", b".mkd", b".mkdn", b".mkdown", b".ronn", b".scd",
    ];
    let separator = bun_core::strings::last_index_of_char(path, b'/').max(bun_core::strings::last_index_of_char(path, b'\\'));
    let name = &path[separator.map_or(0, |at| at + 1)..];
    let name = name.to_ascii_lowercase();
    matches!(&name[..], b"contents.lr" | b"readme")
        || EXTENSIONS.iter().any(|extension| name.ends_with(extension))
        || name.ends_with(b".workbook")
}

/// Everything that is allocated to format a text. It is reused for the next one.
#[derive(Default)]
pub struct Scratch {
    tree: ast::Tree,
}

/// Formats JavaScript or TypeScript: the name of a file that says which it is, the code, the options, and
/// where the result is appended. Returns whether it could be formatted.
pub type FormatJavaScript<'f> = dyn FnMut(&[u8], &[u8], &FormatOptions, &mut Vec<u8>) -> bool + 'f;

/// The syntax tree of `text`, for debugging.
pub fn dump_ast(text: &[u8], out: &mut Vec<u8>) {
    let mut tree = ast::Tree::default();
    if let Some(root) = block::parse(text, &mut tree) {
        ast::dump(text, &tree, root, out);
    }
}

/// Prettier's `inferParser(options, { language })`: the parser for code in `language`.
fn infer_parser(language: &[u8]) -> Option<&'static [u8]> {
    Some(match language {
        // The names of languages, then other names for them, then extensions of files.
        b"json.stringify" | b"geojson" | b"jsonl" | b"sarif" | b"topojson" | b"importmap" => b"json-stringify",
        b"json" | b"4DForm" | b"4DProject" | b"avsc" | b"gltf" | b"har" | b"ice" | b"JSON-tmLanguage" | b"json.example"
        | b"mcmeta" | b"slnlaunch" | b"tact" | b"tfstate" | b"tfstate.backup" | b"webapp" | b"webmanifest" | b"yy"
        | b"yyp" => b"json",
        b"jsonc" | b"code-snippets" | b"code-workspace" | b"sublime-build" | b"sublime-color-scheme" | b"sublime-commands"
        | b"sublime-completions" | b"sublime-keymap" | b"sublime-macro" | b"sublime-menu" | b"sublime-mousemap"
        | b"sublime-project" | b"sublime-settings" | b"sublime-theme" | b"sublime-workspace" | b"sublime_metrics"
        | b"sublime_session" => b"jsonc",
        b"json5" => b"json5",
        b"javascript" | b"jsx" | b"js" | b"node" | b"_js" | b"bones" | b"cjs" | b"es" | b"es6" | b"gs" | b"jake" | b"jsb"
        | b"jscad" | b"jsfl" | b"jslib" | b"jsm" | b"jspre" | b"jss" | b"mjs" | b"njs" | b"pac" | b"sjs" | b"ssjs"
        | b"xsjs" | b"xsjslib" | b"start.frag" | b"end.frag" | b"wxs" => b"babel",
        b"typescript" | b"tsx" | b"ts" | b"typescriptreact" | b"cts" | b"mts" | b"angular-ts" => b"typescript",
        b"graphql" | b"gql" | b"graphqls" => b"graphql",
        b"markdown" | b"md" | b"pandoc" | b"livemd" | b"mdown" | b"mdwn" | b"mkd" | b"mkdn" | b"mkdown" | b"ronn" | b"scd"
        | b"workbook" => b"markdown",
        b"css" | b"postcss" | b"wxss" | b"pcss" => b"css",
        b"less" | b"less-css" => b"less",
        b"scss" => b"scss",
        b"yaml" | b"yml" | b"mir" | b"reek" | b"rviz" | b"sublime-syntax" | b"syntax" | b"yaml-tmlanguage" | b"yaml.sed"
        | b"yml.mysql" => b"yaml",
        _ => return None,
    })
}

/// Formats `code`, which is in a block of code in `language`, for lines of `width` columns.
fn format_embedded(
    language: &[u8],
    code: &[u8],
    width: usize,
    options: &FormatOptions,
    format_javascript: &mut FormatJavaScript<'_>,
) -> Option<Vec<u8>> {
    // Nothing to format: front matter without anything in it.
    if language.is_empty() {
        return Some(Vec::new());
    }
    let parser = infer_parser(language)?;
    let options = FormatOptions {
        line_width: LineWidth(width.clamp(1, usize::from(u16::MAX)) as u16),
        line_ending: LineEnding::Lf,
        parser: None,
        filepath: None,
        range_start: None,
        range_end: None,
        cursor_offset: None,
        insert_pragma: false,
        require_pragma: false,
        check_ignore_pragma: false,
        is_in_markdown: true,
        ..options.clone()
    };
    let mut out = Vec::new();
    let is_done = if let Some(parser) = crate::json::Parser::from_name(parser) {
        crate::json::format(code, parser, &options, &mut Default::default(), &mut out).is_ok()
    } else if let Some(parser) = crate::css::Parser::from_name(parser) {
        crate::css::format(code, parser, &options, &mut Default::default(), &mut out).is_ok()
    } else {
        match parser {
            b"graphql" => crate::graphql::format(code, &options, &mut Default::default(), &mut out).is_ok(),
            b"yaml" => crate::yaml::format(code, &options, &mut Default::default(), &mut out).is_ok(),
            b"markdown" => format(code, &options, &mut Default::default(), &mut out, format_javascript).is_ok(),
            b"babel" => format_javascript(b"dummy.jsx", code, &options, &mut out),
            _ if language == b"tsx" => format_javascript(b"dummy.tsx", code, &options, &mut out),
            _ => format_javascript(b"dummy.ts", code, &options, &mut out),
        }
    };
    is_done.then_some(out)
}

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Appends the formatted `text` to `out`.
pub fn format(
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    format_javascript: &mut FormatJavaScript<'_>,
) -> Result<(), FormatError> {
    let first = if text.starts_with(BOM) { BOM.len() } else { 0 };
    out.extend_from_slice(&text[..first]);
    let mut text = &text[first..];
    let options = FormatOptions {
        line_ending: options.line_ending.resolve(text),
        ..options.clone()
    };
    let mut normalized = Vec::new();
    if bun_core::strings::contains_char(text, b'\r') {
        write_with_line_ending(text, b"\n", &mut normalized);
        text = &normalized;
    }
    if crate::range::trim_start(text).is_empty() {
        return Ok(());
    }

    let tree = &mut scratch.tree;
    let root = block::parse(text, tree).ok_or(FormatError::NestedTooDeeply)?;
    let mut preprocessor = preprocess::Preprocessor {
        text,
        tree,
        tab_width: usize::from(options.indent_width.value()),
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
    };
    preprocessor.run(root);
    if preprocessor.is_nested_too_deeply {
        return Err(FormatError::NestedTooDeeply);
    }

    let formats_embedded = matches!(options.embedded_language_formatting, EmbeddedLanguageFormatting::Auto);
    let mut embed = |embedded: &printer::Embedded<'_>| match formats_embedded {
        true => format_embedded(embedded.language, embedded.code, embedded.width, &options, format_javascript),
        false => None,
    };
    let mut printer = printer::Printer {
        text,
        tree,
        options: &options,
        embed: &mut embed,
        indentation: 0,
        is_in_label: false,
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
    };
    let document = printer.print(root);
    if printer.is_nested_too_deeply {
        return Err(FormatError::NestedTooDeeply);
    }
    doc::print(document, &options, text, out);
    Ok(())
}
