//! Markdown.
//!
//! The specification is Prettier's `src/language-markdown`, which parses with micromark. The parser is Bun's own, `bun_md`.
//!
//! ```text
//! text ─ bun_md ─→ events ─ parse ─→ Tree (mdast) ─ preprocess ─→ sentences ─ printer ─→ the document of `css::doc`
//! ```

pub(crate) mod ast;
pub(crate) mod embed;
mod parse;
mod preprocess;
mod printer;
mod spans;
mod strings;
mod unicode_tables;

use crate::css::doc;
use crate::front_matter;
use crate::options::{EmbeddedLanguageFormatting, LineEnding, LineWidth};
use crate::range::{Offsets, write_with_line_ending};
use crate::text::{BOM, trim_start};
use crate::{FormatError, FormatOptions};

/// Whether Prettier takes the file at `path` for Markdown.
pub fn is_markdown_path(path: &[u8]) -> bool {
    const EXTENSIONS: [&[u8]; 10] = [
        b".md",
        b".livemd",
        b".markdown",
        b".mdown",
        b".mdwn",
        b".mkd",
        b".mkdn",
        b".mkdown",
        b".ronn",
        b".scd",
    ];
    let separator = bun_core::strings::last_index_of_char(path, b'/')
        .max(bun_core::strings::last_index_of_char(path, b'\\'));
    let name = &path[separator.map_or(0, |at| at + 1)..];
    let name = name.to_ascii_lowercase();
    matches!(&name[..], b"contents.lr" | b"readme")
        || EXTENSIONS.iter().any(|extension| name.ends_with(extension))
        || name.ends_with(b".workbook")
}

pub fn is_mdx_path(path: &[u8]) -> bool {
    path.len() >= 4 && path[path.len() - 4..].eq_ignore_ascii_case(b".mdx")
}

/// In the place of the language of a block of code: JSX in MDX, `import` and `export` in MDX.
const MDX_JSX: &[u8] = b"\0jsx";
const MDX_ES_SYNTAX: &[u8] = b"\0es";

/// Everything that is allocated to format a text. It is reused for the next one.
#[derive(Default)]
pub struct Scratch {
    tree: ast::Tree,
}

/// The syntax tree of `original`, for debugging.
pub fn dump_ast(original: &[u8], out: &mut Vec<u8>) {
    let mut tree = ast::Tree::default();
    let blanked = parse::blank_front_matter(original);
    let content = blanked.as_deref().unwrap_or(original);
    if let Some(root) = parse::parse(content, original, parse::Syntax::Markdown, &mut tree) {
        ast::dump(content, &tree, root, out);
    }
}

/// For the harness: the syntax tree of `original`, which is MDX.
pub fn dump_mdx_ast(original: &[u8], out: &mut Vec<u8>) {
    let mut tree = ast::Tree::default();
    if let Some(root) = parse::parse(original, original, parse::Syntax::Mdx, &mut tree) {
        ast::dump(original, &tree, root, out);
    }
}

/// For the harness: makes the syntax tree of `original`. Returns how many nodes it has.
pub fn count_nodes(original: &[u8], scratch: &mut Scratch) -> usize {
    let blanked = parse::blank_front_matter(original);
    let content = blanked.as_deref().unwrap_or(original);
    let syntax = parse::Syntax::Markdown;
    parse::parse(content, original, syntax, &mut scratch.tree);
    scratch.tree.nodes.len()
}

/// For the harness: what `Bun.markdown.html` makes of `text` with the options `on` set.
pub fn render_to_html(text: &[u8], on: &[&str]) -> Option<Box<[u8]>> {
    let mut options = bun_md::root::Options::default();
    for (name, _, set) in bun_md::root::Options::BOOL_FIELD_SETTERS {
        if on.contains(name) {
            set(&mut options, true);
        }
    }
    bun_md::root::render_to_html_with_options(text, options).ok()
}

/// Fills `tree` with the syntax of `text`, which is a description in a JSDoc comment. Returns the root.
pub(crate) fn parse_plain(text: &[u8], tree: &mut ast::Tree) -> Option<ast::NodeId> {
    parse::parse_content(text, tree, true)
}

/// Prettier's `inferParser(options, { language })`: the parser for code in `language`.
pub(crate) fn infer_parser(language: &[u8]) -> Option<&'static [u8]> {
    Some(match language {
        // The names of languages, then other names for them, then extensions of files.
        b"json.stringify" | b"geojson" | b"jsonl" | b"sarif" | b"topojson" | b"importmap" => {
            b"json-stringify"
        }
        b"json" | b"4DForm" | b"4DProject" | b"avsc" | b"gltf" | b"har" | b"ice"
        | b"JSON-tmLanguage" | b"json.example" | b"mcmeta" | b"slnlaunch" | b"tact"
        | b"tfstate" | b"tfstate.backup" | b"webapp" | b"webmanifest" | b"yy" | b"yyp" => b"json",
        b"jsonc"
        | b"code-snippets"
        | b"code-workspace"
        | b"sublime-build"
        | b"sublime-color-scheme"
        | b"sublime-commands"
        | b"sublime-completions"
        | b"sublime-keymap"
        | b"sublime-macro"
        | b"sublime-menu"
        | b"sublime-mousemap"
        | b"sublime-project"
        | b"sublime-settings"
        | b"sublime-theme"
        | b"sublime-workspace"
        | b"sublime_metrics"
        | b"sublime_session" => b"jsonc",
        b"json5" => b"json5",
        b"javascript" | b"jsx" | b"js" | b"node" | b"_js" | b"bones" | b"cjs" | b"es" | b"es6"
        | b"gs" | b"jake" | b"jsb" | b"jscad" | b"jsfl" | b"jslib" | b"jsm" | b"jspre" | b"jss"
        | b"mjs" | b"njs" | b"pac" | b"sjs" | b"ssjs" | b"xsjs" | b"xsjslib" | b"start.frag"
        | b"end.frag" | b"wxs" => b"babel",
        b"typescript" | b"tsx" | b"ts" | b"typescriptreact" | b"cts" | b"mts" | b"angular-ts" => {
            b"typescript"
        }
        b"graphql" | b"gql" | b"graphqls" => b"graphql",
        b"handlebars" | b"hbs" | b"htmlbars" => b"glimmer",
        b"mdx" => b"mdx",
        b"html" | b"hta" | b"htm" | b"html.hl" | b"inc" | b"xht" => b"html",
        // `xhtml` is another name for two languages, of which this is the first.
        b"angular" | b"xhtml" | b"component.html" => b"angular",
        b"vue" => b"vue",
        b"lightning web components" | b"LWC" | b"lwc" => b"lwc",
        b"mjml" | b"MJML" => b"mjml",
        b"markdown" | b"md" | b"pandoc" | b"livemd" | b"mdown" | b"mdwn" | b"mkd" | b"mkdn"
        | b"mkdown" | b"ronn" | b"scd" | b"workbook" => b"markdown",
        b"css" | b"postcss" | b"wxss" | b"pcss" => b"css",
        b"less" | b"less-css" => b"less",
        b"scss" => b"scss",
        b"yaml" | b"yml" | b"mir" | b"reek" | b"rviz" | b"sublime-syntax" | b"syntax"
        | b"yaml-tmlanguage" | b"yaml.sed" | b"yml.mysql" => b"yaml",
        _ => return None,
    })
}

/// oxfmt's `route`: the parser for a block of code in `language`, and for JavaScript and TypeScript the name of a file
/// that says what it is. The names are those of Shiki. What has none of them stays as it is written.
pub(crate) fn parser_of_oxfmt(language: &[u8]) -> Option<(&'static [u8], &'static [u8])> {
    Some(match language {
        b"graphql" | b"gql" => (b"graphql", b""),
        b"css" | b"postcss" => (b"css", b""),
        b"scss" => (b"scss", b""),
        b"less" => (b"less", b""),
        b"yaml" | b"yml" => (b"yaml", b""),
        b"json" => (b"json", b""),
        b"jsonc" => (b"jsonc", b""),
        b"json5" => (b"json5", b""),
        b"html" => (b"html", b""),
        b"angular" | b"angular-html" => (b"angular", b""),
        b"vue" => (b"vue", b""),
        b"handlebars" | b"hbs" => (b"glimmer", b""),
        b"mdx" => (b"mdx", b""),
        b"markdown" | b"md" => (b"markdown", b""),
        b"javascript" | b"js" => (b"babel", b"dummy.js"),
        b"jsx" => (b"babel", b"dummy.jsx"),
        b"mjs" => (b"babel", b"dummy.mjs"),
        b"cjs" => (b"babel", b"dummy.cjs"),
        b"typescript" | b"angular-ts" | b"ts" => (b"typescript", b"dummy.ts"),
        b"tsx" => (b"typescript", b"dummy.tsx"),
        b"mts" => (b"typescript", b"dummy.mts"),
        b"cts" => (b"typescript", b"dummy.cts"),
        _ => return None,
    })
}

/// Formats `code`, which is in a block of code in `language`, for lines of `width` columns.
fn format_embedded(
    language: &[u8],
    code: &[u8],
    width: usize,
    options: &FormatOptions,
    is_in_template: bool,
    format_block: Option<&mut FormatBlock<'_>>,
) -> Option<Vec<u8>> {
    // Nothing to format: front matter without anything in it.
    if language.is_empty() {
        return Some(Vec::new());
    }
    let is_mdx_jsx = language == MDX_JSX;
    let mut file_of_oxfmt: &[u8] = b"";
    let parser: &[u8] = match language {
        _ if is_mdx_jsx || language == MDX_ES_SYNTAX => b"babel",
        // The language of a plugin, which oxfmt has too.
        b"svelte" if options.svelte.is_in_markdown => b"svelte",
        _ if options.flavor.is_oxfmt() => {
            let parser;
            (parser, file_of_oxfmt) = parser_of_oxfmt(language)?;
            parser
        }
        b"angular-html" => b"angular",
        _ => infer_parser(language)?,
    };
    let in_fragment;
    let code = match is_mdx_jsx {
        true => {
            in_fragment = [b"<$>", code, b"</$>"].concat();
            &in_fragment[..]
        }
        false => code,
    };
    // To the parsers of Prettier it is white space.
    let code = code.strip_prefix(BOM).unwrap_or(code);
    // To these parsers, nothing is a syntax error. Only a whole file with nothing in it does not get to them.
    if matches!(parser, b"json" | b"json5" | b"json-stringify" | b"graphql")
        && trim_start(code).is_empty()
    {
        return None;
    }
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
        is_mdx_jsx,
        is_mdx_es_syntax: language == MDX_ES_SYNTAX,
        ..options.clone()
    };
    let mut out = Vec::new();
    let is_done = if let Some(parser) = crate::json::Parser::from_name(parser) {
        crate::json::format(code, parser, &options, &mut Default::default(), &mut out).is_ok()
    } else if let Some(parser) = crate::css::Parser::from_name(parser) {
        crate::css::format(code, parser, &options, &mut Default::default(), &mut out).is_ok()
    } else if let Some(parser) = crate::html::Parser::from_name(parser) {
        options.embedded_html
            && crate::html::format(
                b"",
                code,
                parser,
                &options,
                &mut Default::default(),
                &mut out,
            )
            .is_ok()
            // A block of which something would be lost stays as it is.
            && crate::html::has_same_content(code, &out, parser, &options)
    } else {
        match parser {
            b"graphql" => {
                crate::graphql::format(code, &options, &mut Default::default(), &mut out).is_ok()
            }
            b"glimmer" => {
                let mut scratch = crate::handlebars::Scratch::default();
                crate::handlebars::format(code, &options, &mut scratch, &mut out).is_ok()
                    && !scratch.is_damaged()
            }
            b"yaml" => {
                crate::yaml::format(code, &options, &mut Default::default(), &mut out).is_ok()
            }
            b"svelte" => {
                let scratch = &mut Default::default();
                crate::svelte::format(b"", code, &options, None, scratch, &mut out).is_ok()
                    // A block of which something would be lost stays as it is.
                    && crate::svelte::has_same_content(code, &out, &options, None)
            }
            b"markdown" | b"mdx" => {
                let mode = Mode {
                    is_in_template,
                    is_mdx: parser == b"mdx",
                };
                let scratch = &mut Default::default();
                format_in(code, &options, scratch, &mut out, mode, format_block).is_ok()
            }
            _ => {
                let path: &[u8] = match parser {
                    _ if !file_of_oxfmt.is_empty() => file_of_oxfmt,
                    b"babel" => b"dummy.jsx",
                    _ if language == b"tsx" => b"dummy.tsx",
                    _ => b"dummy.ts",
                };
                match (format_block, options.format_javascript) {
                    (Some(format), _) => format(path, code, &options, &mut out),
                    (None, Some(format)) => format(path, code, &options, &mut out),
                    (None, None) => false,
                }
            }
        }
    };
    is_done.then_some(out)
}

/// Whether a comment with `@` and one of `pragmas` is at the start of `text`, behind the front matter.
fn has_pragma(text: &[u8], pragmas: [&[u8]; 2]) -> bool {
    let content = &text[front_matter::parse(text).map_or(0, |it| it.end)..];
    let content = trim_start(content);
    let strip_pragma = |text: &'_ [u8]| -> Option<usize> {
        let name = text.strip_prefix(b"@")?;
        pragmas
            .iter()
            .find(|pragma| name.starts_with(pragma))
            .map(|pragma| pragma.len() + 1)
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
        close
            .iter()
            .all(|part| match trim_start(rest).strip_prefix(*part) {
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

/// Formats the JavaScript and TypeScript in blocks of code, as [`crate::options::FormatJavaScript`] does. It can keep
/// what it allocates from one block to the next.
pub type FormatBlock<'f> = dyn FnMut(&[u8], &[u8], &FormatOptions, &mut Vec<u8>) -> bool + 'f;

/// Appends the formatted `text` to `out`.
pub fn format(
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    format_with(text, options, scratch, out, None)
}

/// The same. `format_block` takes the place of `FormatOptions::format_javascript`.
pub fn format_with(
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    format_block: Option<&mut FormatBlock<'_>>,
) -> Result<(), FormatError> {
    format_in(text, options, scratch, out, Mode::default(), format_block)
}

/// The same for MDX.
pub fn format_mdx_with(
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    format_block: Option<&mut FormatBlock<'_>>,
) -> Result<(), FormatError> {
    let mode = Mode {
        is_mdx: true,
        ..Mode::default()
    };
    format_in(text, options, scratch, out, mode, format_block)
}

#[derive(Copy, Clone, Default)]
struct Mode {
    /// The document is for a template in JavaScript.
    is_in_template: bool,
    is_mdx: bool,
}

fn format_in(
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    mode: Mode,
    format_block: Option<&mut FormatBlock<'_>>,
) -> Result<(), FormatError> {
    let original = text;
    let first = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let Offsets { start, end, .. } = Offsets::new(original, first, options);
    let mut text = &original[first..];
    let mut options = FormatOptions {
        line_ending: options.line_ending.resolve(text),
        ..options.clone()
    };
    // oxfmt hands MDX to the Prettier that comes with it, and nothing in it comes back: the code in it is Prettier's
    // too, and what only oxfmt does is not done.
    if mode.is_mdx && options.flavor.is_oxfmt() {
        options.flavor = crate::options::Flavor::Prettier;
        (options.sort_imports, options.jsdoc, options.tailwind) = (None, None, None);
    }
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
    if options.insert_pragma
        && !options.require_pragma
        && !has_pragma(text, [b"format", b"prettier"])
    {
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

    let tree = &mut scratch.tree;
    with_document(text, &options, tree, mode, format_block, |document| {
        doc::print(document, &options, text, out)
    })
}

/// Calls `then` with the document for `text`, in which every line break is `\n`.
fn with_document<R>(
    text: &[u8],
    options: &FormatOptions,
    tree: &mut ast::Tree,
    mode: Mode,
    mut format_block: Option<&mut FormatBlock<'_>>,
    then: impl FnOnce(doc::Doc<'_>) -> R,
) -> Result<R, FormatError> {
    let blanked = parse::blank_front_matter(text);
    let original = text;
    let text = blanked.as_deref().unwrap_or(text);
    let syntax = if mode.is_mdx {
        parse::Syntax::Mdx
    } else if options.flavor.is_oxfmt() {
        parse::Syntax::WithDirectives
    } else {
        parse::Syntax::Markdown
    };
    let root = parse::parse(text, original, syntax, tree).ok_or(FormatError::NestedTooDeeply)?;
    let mut preprocessor = preprocess::Preprocessor {
        text,
        original,
        wraps_lines: options.prose_wrap == crate::options::ProseWrap::Always,
        is_mdx: mode.is_mdx,
        is_for_oxfmt: options.flavor.is_oxfmt(),
        tree,
        tab_width: usize::from(options.indent_width.value()),
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
    };
    preprocessor.run(root);
    if preprocessor.is_nested_too_deeply {
        return Err(FormatError::NestedTooDeeply);
    }

    let formats_embedded = matches!(
        options.embedded_language_formatting,
        EmbeddedLanguageFormatting::Auto
    );
    let mut embed = |embedded: &printer::Embedded<'_>| match formats_embedded {
        true => format_embedded(
            embedded.language,
            embedded.code,
            embedded.width,
            options,
            mode.is_in_template,
            format_block.as_deref_mut(),
        ),
        false => None,
    };
    let mut printer = printer::Printer {
        text,
        original,
        tree,
        options,
        embed: &mut embed,
        is_in_template: mode.is_in_template,
        is_mdx: mode.is_mdx,
        indentation: 0,
        is_in_label: false,
        first_of_run: Vec::new(),
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
    };
    let document = printer.print(root);
    match printer.is_nested_too_deeply {
        true => Err(FormatError::NestedTooDeeply),
        false => Ok(then(document)),
    }
}
