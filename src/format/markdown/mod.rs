//! Markdown.
//!
//! The specification is Prettier's `src/language-markdown`, which parses with micromark.
//!
//! ```text
//! text ─ block::parse (with inline) ─→ Tree (mdast) ─ preprocess ─→ sentences ─ printer ─→ the document of `css::doc`
//! ```

pub(crate) mod ast;
mod block;
mod content;
pub(crate) mod embed;
mod front_matter;
mod inline;
mod preprocess;
mod printer;
mod strings;
mod unicode_tables;

use crate::css::doc;
use crate::options::{EmbeddedLanguageFormatting, LineEnding, LineWidth};
use crate::range::{Offsets, trim_start, write_with_line_ending};
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

/// The syntax tree of `text`, for debugging.
pub fn dump_ast(text: &[u8], out: &mut Vec<u8>) {
    let mut tree = ast::Tree::default();
    let blanked = block::blank_front_matter(text);
    let content = blanked.as_deref().unwrap_or(text);
    if let Some(root) = block::parse(content, text, &mut tree) {
        ast::dump(content, &tree, root, out);
    }
}

/// Fills `tree` with the syntax of `text`, which is a description in a JSDoc comment. Returns the root.
pub(crate) fn parse_plain(text: &[u8], tree: &mut ast::Tree) -> Option<ast::NodeId> {
    block::parse_content(text, tree, true)
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
) -> Option<Vec<u8>> {
    // Nothing to format: front matter without anything in it.
    if language.is_empty() {
        return Some(Vec::new());
    }
    let parser = infer_parser(language)?;
    // To the parsers of Prettier it is white space.
    let code = code.strip_prefix(BOM).unwrap_or(code);
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
    let format_javascript = |path: &[u8], out: &mut Vec<u8>| match &options.format_javascript {
        Some(format_javascript) => format_javascript(path, code, &options, out),
        None => false,
    };
    let is_done = if let Some(parser) = crate::json::Parser::from_name(parser) {
        crate::json::format(code, parser, &options, &mut Default::default(), &mut out).is_ok()
    } else if let Some(parser) = crate::css::Parser::from_name(parser) {
        crate::css::format(code, parser, &options, &mut Default::default(), &mut out).is_ok()
    } else {
        match parser {
            b"graphql" => crate::graphql::format(code, &options, &mut Default::default(), &mut out).is_ok(),
            b"yaml" => crate::yaml::format(code, &options, &mut Default::default(), &mut out).is_ok(),
            b"markdown" => format(code, &options, &mut Default::default(), &mut out).is_ok(),
            b"babel" => format_javascript(b"dummy.jsx", &mut out),
            _ if language == b"tsx" => format_javascript(b"dummy.tsx", &mut out),
            _ => format_javascript(b"dummy.ts", &mut out),
        }
    };
    is_done.then_some(out)
}

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Whether a comment with `@` and one of `pragmas` is at the start of `text`, behind the front matter.
fn has_pragma(text: &[u8], pragmas: [&[u8]; 2]) -> bool {
    let content = &text[front_matter::parse(text).map_or(0, |it| it.end)..];
    let content = trim_start(content);
    let strip_pragma = |text: &'_ [u8]| -> Option<usize> {
        let name = text.strip_prefix(b"@")?;
        pragmas.iter().find(|pragma| name.starts_with(pragma)).map(|pragma| pragma.len() + 1)
    };
    // `<!-- @format -->`, `{/* @format */}`
    let is_between = |open: &[&[u8]], close: &[&[u8]]| {
        let mut rest = content;
        for part in open {
            let Some(after) = rest.strip_prefix(*part) else {
                return false;
            };
            rest = trim_start(after);
        }
        let Some(len) = strip_pragma(rest) else {
            return false;
        };
        rest = &rest[len..];
        close.iter().all(|part| match trim_start(rest).strip_prefix(*part) {
            Some(after) => {
                rest = after;
                true
            }
            None => false,
        })
    };
    if is_between(&[b"<!--"], &[b"-->"]) || is_between(&[b"{", b"/*"], &[b"*/", b"}"]) {
        return true;
    }
    // A comment with a line that is nothing but the pragma, which ends on a later line.
    if !content.starts_with(b"<!--") {
        return false;
    }
    let is_blank = |text: &[u8]| text.iter().all(|byte| byte.is_ascii_whitespace());
    let mut lines = bun_core::strings::split(content, b"\n").skip(1);
    let has_line = lines.any(|line| {
        let line = trim_start(line);
        strip_pragma(line).is_some_and(|len| is_blank(&line[len..]))
    });
    has_line && lines.any(|line| bun_core::strings::contains(line, b"-->"))
}

/// Appends the formatted `text` to `out`.
pub fn format(text: &[u8], options: &FormatOptions, scratch: &mut Scratch, out: &mut Vec<u8>) -> Result<(), FormatError> {
    let original = text;
    let first = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let Offsets { start, end, .. } = Offsets::new(original, first, options);
    let mut text = &original[first..];
    let options = FormatOptions {
        line_ending: options.line_ending.resolve(text),
        ..options.clone()
    };
    let is_whole = start <= first && end >= original.len();
    let mut normalized = Vec::new();
    if bun_core::strings::contains_char(text, b'\r') {
        write_with_line_ending(text, b"\n", &mut normalized);
        text = &normalized;
    }
    if (start >= end && !text.is_empty())
        || (options.require_pragma && !has_pragma(text, [b"format", b"prettier"]))
        || (options.check_ignore_pragma && has_pragma(text, [b"noformat", b"noprettier"]))
    {
        out.extend_from_slice(original);
        return Ok(());
    }
    out.extend_from_slice(&original[..first]);
    // Nothing in Markdown can be formatted on its own.
    if !is_whole {
        write_with_line_ending(text, options.line_ending.as_bytes(), out);
        return Ok(());
    }
    let mut with_pragma = Vec::new();
    if options.insert_pragma && !options.require_pragma && !has_pragma(text, [b"format", b"prettier"]) {
        let front_matter_end = front_matter::parse(text).map_or(0, |it| it.end);
        if front_matter_end > 0 {
            with_pragma.extend_from_slice(&text[..front_matter_end]);
            with_pragma.extend_from_slice(b"\n\n");
        }
        with_pragma.extend_from_slice(b"<!-- @format -->\n\n");
        with_pragma.extend_from_slice(&text[front_matter_end..]);
        text = &with_pragma;
    }
    if trim_start(text).is_empty() {
        return Ok(());
    }

    with_document(text, &options, &mut scratch.tree, false, |document| doc::print(document, &options, text, out))
}

/// Calls `then` with the document for `text`, in which every line break is `\n`. `is_in_template`: it is for a
/// template in JavaScript.
fn with_document<R>(
    text: &[u8],
    options: &FormatOptions,
    tree: &mut ast::Tree,
    is_in_template: bool,
    then: impl FnOnce(doc::Doc<'_>) -> R,
) -> Result<R, FormatError> {
    let blanked = block::blank_front_matter(text);
    let original = text;
    let text = blanked.as_deref().unwrap_or(text);
    let root = block::parse(text, original, tree).ok_or(FormatError::NestedTooDeeply)?;
    let mut preprocessor = preprocess::Preprocessor {
        text,
        original,
        wraps_lines: options.prose_wrap == crate::options::ProseWrap::Always,
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
        true => format_embedded(embedded.language, embedded.code, embedded.width, options),
        false => None,
    };
    let mut printer = printer::Printer {
        text,
        original,
        tree,
        options,
        embed: &mut embed,
        is_in_template,
        indentation: 0,
        is_in_label: false,
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
    };
    let document = printer.print(root);
    match printer.is_nested_too_deeply {
        true => Err(FormatError::NestedTooDeeply),
        false => Ok(then(document)),
    }
}
