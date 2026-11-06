//! HTML, Vue, Angular templates, Lightning Web Components and MJML.
//!
//! Follows Prettier's `src/language-html`, which parses with `angular-html-parser`.
//!
//! ```text
//! text ─ lexer ─→ tokens ─ parser, parse ─→ Tree ─ preprocess ─→ whitespace sensitivity ─ printer ─→ `ir` document
//! ```
//!
//! Code in another language (scripts, style sheets, expressions in attributes) is written into the same document by
//! that language's formatter. See `embed`.

mod angular;
mod angular_print;
mod ast;
mod canonical;
mod cursor;
mod data;
pub(crate) mod embed;
mod error;
pub(crate) mod in_js;
pub(crate) mod js;
mod lexer;
mod map_strings;
mod parse;
mod parser;
pub(crate) mod preprocess;
mod printer;
mod runs;
mod tag;
mod tailwind;
mod utilities;
pub(crate) mod verify;
mod vue;
pub(crate) mod writer;

pub use js::is_probably_jsx;

use crate::cursor::Region;
use crate::ir::formatter::Formatter;
use crate::js::context::JsFormatContext;
use crate::js::sort_imports::SortImports;
use crate::options::{Flavor, HtmlRoot, InHtml, JavaScriptParser};
use crate::range::{Offsets, normalized_len, write_with_line_ending};
use crate::text::BOM;
use crate::{FormatError, FormatOptions, front_matter};
use bun_core::strings;
use cursor::Cursor;
use std::borrow::Cow;

/// Prettier's `parser` option.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Parser {
    Html,
    Angular,
    Vue,
    Lwc,
    Mjml,
    /// `__ng_action`, `__ng_binding`, `__ng_directive`, `__ng_interpolation`: the text is an Angular expression with no
    /// HTML around it.
    AngularExpression(HtmlRoot),
}

impl Parser {
    pub fn from_name(name: &[u8]) -> Option<Parser> {
        Some(match name {
            b"html" => Parser::Html,
            b"angular" => Parser::Angular,
            b"vue" => Parser::Vue,
            b"lwc" => Parser::Lwc,
            b"mjml" => Parser::Mjml,
            b"__ng_action" => Parser::AngularExpression(HtmlRoot::NgAction),
            b"__ng_binding" => Parser::AngularExpression(HtmlRoot::NgBinding),
            b"__ng_directive" => Parser::AngularExpression(HtmlRoot::NgDirective),
            b"__ng_interpolation" => Parser::AngularExpression(HtmlRoot::NgInterpolation),
            _ => return None,
        })
    }
}

/// Returns the parser Prettier infers from a file name, or `None` if it's none of these languages.
pub fn parser_for_path(path: &[u8]) -> Option<Parser> {
    const EXTENSIONS: [(&[u8], Parser); 10] = [
        (b".component.html", Parser::Angular),
        (b".html", Parser::Html),
        (b".hta", Parser::Html),
        (b".htm", Parser::Html),
        (b".html.hl", Parser::Html),
        (b".inc", Parser::Html),
        (b".xht", Parser::Html),
        (b".xhtml", Parser::Html),
        (b".mjml", Parser::Mjml),
        (b".vue", Parser::Vue),
    ];
    EXTENSIONS
        .iter()
        .find(|(extension, _)| {
            (path.len().checked_sub(extension.len()))
                .is_some_and(|at| path[at..].eq_ignore_ascii_case(extension))
        })
        .map(|(_, parser)| *parser)
}

/// Allocations for formatting a text, reused for the next one.
#[derive(Default)]
pub struct Scratch {
    document: crate::Scratch,
    /// What has read the last text that was one run, and what it has written.
    runs: Option<(runs::Runs, Vec<u8>)>,
    scripts: Scripts,
    style_sheets: crate::css::Scratch,
}

impl Scratch {
    /// What the scripts that go the quick way keep from one to the next.
    pub fn quick_way(&self) -> &crate::js::quick::Scratch {
        &self.scripts.quick
    }

    pub fn quick_way_mut(&mut self) -> &mut crate::js::quick::Scratch {
        &mut self.scripts.quick
    }
}

/// For the scripts that go the quick way.
#[derive(Default)]
pub(crate) struct Scripts {
    pub(crate) quick: crate::js::quick::Scratch,
    /// The last one, formatted.
    pub(crate) formatted: Vec<u8>,
    /// The name of an attribute with code in it.
    pub(crate) name: Vec<u8>,
    /// The quick way has refused the script that is written next, so it isn't asked again.
    pub(crate) has_refused_next: bool,
}

/// The `options` that Prettier's functions receive.
pub(crate) struct Options<'o> {
    pub(crate) parser: Parser,
    /// `originalText`, where every line break is `\n`.
    pub(crate) original_text: &'o [u8],
    pub(crate) format: &'o FormatOptions,
    pub(crate) filepath: Option<&'o [u8]>,
    /// True if there's a `parentParser`, that is, the text is embedded in another language.
    pub(crate) has_parent_parser: bool,
    /// The flavor that scripts are formatted in.
    pub(crate) script_flavor: Flavor,
}

/// `/^\s*<!--\s*@(?:a|b)\s*-->/.test(text)`
fn has_pragma(text: &[u8], pragmas: [&[u8]; 2]) -> bool {
    (|| {
        let rest = strings::trim_js_whitespace_start(
            strings::trim_js_whitespace_start(text).strip_prefix(b"<!--")?,
        )
        .strip_prefix(b"@")?;
        let rest = pragmas.iter().find_map(|pragma| {
            rest.strip_prefix(*pragma)
                .filter(|rest| strings::trim_js_whitespace_start(rest).starts_with(b"-->"))
        });
        rest.map(|_| ())
    })()
    .is_some()
}

/// Returns the text to parse, which is `text` with its front matter replaced with spaces so that all offsets stay
/// valid, and the front matter's length.
fn without_front_matter(text: &[u8]) -> (Cow<'_, [u8]>, Option<usize>) {
    let Some(len) = front_matter::parse(text).map(|it| it.end) else {
        return (Cow::Borrowed(text), None);
    };
    let mut blanked = text.to_vec();
    for byte in &mut blanked[..len] {
        if *byte != b'\n' {
            *byte = b' ';
        }
    }
    (Cow::Owned(blanked), Some(len))
}

/// Returns the text to format: `text` without its byte order mark, with every line break as `\n`, and with the pragma
/// inserted if requested. Also returns whether only a range of it is formatted. Returns `None` if the text stays as it
/// is, because of a pragma or because the range is empty.
fn prepared_text<'t>(text: &'t [u8], options: &FormatOptions) -> Option<(Cow<'t, [u8]>, bool)> {
    let original = text;
    let first = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let Offsets { start, end, .. } = Offsets::new(text, first, options);
    let text = bun_core::strings::crlf_as_lf(&text[first..]);
    let [start, end] = [start, end].map(|offset| match &text {
        Cow::Borrowed(_) => original.get(first..offset).map_or(0, |before| before.len()),
        Cow::Owned(_) => normalized_len(original.get(first..offset).unwrap_or_default()),
    });
    let has_format_pragma = (options.require_pragma || options.insert_pragma)
        && has_pragma(&text, [b"format", b"prettier"]);
    if (start >= end && !text.is_empty())
        || (options.require_pragma && !has_format_pragma)
        || (options.check_ignore_pragma && has_pragma(&text, [b"noformat", b"noprettier"]))
    {
        return None;
    }
    let is_range = start > 0 || end < text.len();
    Some(
        match !is_range && options.insert_pragma && !options.require_pragma && !has_format_pragma {
            true => (
                Cow::Owned([b"<!-- @format -->\n\n", &text[..]].concat()),
                false,
            ),
            false => (text, is_range),
        },
    )
}

/// True if `after`, the result of formatting `before` with `options`, has the same content as `before`.
fn keeps_content(before: &[u8], after: &[u8], parser: Parser, options: &FormatOptions) -> bool {
    let after = bun_core::strings::crlf_as_lf(after.strip_prefix(BOM).unwrap_or(after));
    prepared_text(before, options).is_none_or(|(before, _)| {
        strings::trim_js_whitespace(&before).is_empty()
            || verify::has_same_content(&before, &after, parser)
    })
}

/// Like `keeps_content`, but tolerates changes to imports, JSDoc comments and classes if `options` asks for them. See
/// `verify.rs`.
pub fn has_same_content(
    before: &[u8],
    after: &[u8],
    parser: Parser,
    options: &FormatOptions,
) -> bool {
    if matches!(parser, Parser::AngularExpression(_))
        || keeps_content(before, after, parser, options)
    {
        return true;
    }
    if options.sort_imports.is_none() && options.jsdoc.is_none() && options.tailwind.is_none() {
        return false;
    }
    // Two imports of a module can be merged, words in a JSDoc comment can change, and a duplicate class is removed. So
    // compare against the output without those options.
    let plain = FormatOptions {
        sort_imports: None,
        jsdoc: None,
        tailwind: None,
        ..options.clone()
    };
    let (mut scratch, mut formatted) = (Scratch::default(), Vec::new());
    format(b"", before, parser, &plain, &mut scratch, &mut formatted).is_ok()
        && keeps_content(before, &formatted, parser, &plain)
}

/// True if oxfmt formats the scripts itself in a text parsed with `parser`. It leaves the HTML and all other embedded
/// code to Prettier.
fn is_vue_file(options: &FormatOptions, parser: Parser) -> bool {
    parser == Parser::Vue && !options.is_in_markdown
}

/// Returns `options` adjusted for a text parsed with `parser`.
pub(crate) fn options_of_host(options: &FormatOptions, parser: Parser) -> FormatOptions {
    let is_vue_file = is_vue_file(options, parser);
    // Prettier's plugins sort a Vue file's imports before it's parsed. See `with_sorted_scripts`.
    let sort_imports = options.sort_imports.clone();
    FormatOptions {
        sort_imports: sort_imports.filter(|how| match how.is_applied_by_format() {
            true => is_vue_file,
            false => parser != Parser::Vue && how.applies_to_embedded_code(),
        }),
        jsdoc: options.jsdoc.filter(|_| is_vue_file),
        flavor: Flavor::Prettier,
        ..options.clone()
    }
}

/// Does what `@trivago/prettier-plugin-sort-imports` and `@ianvs/prettier-plugin-sort-imports` do to a Vue file's text
/// before it's parsed: sorts the imports of the first top-level `<script>` and the first top-level `<script setup>`.
/// Returns `None` if nothing changes.
fn with_sorted_scripts(text: &[u8], how: &SortImports, parse: js::Parse<'_>) -> Option<Vec<u8>> {
    let (content, front_matter_len) = without_front_matter(text);
    let mut tree = ast::Tree::default();
    parse::parse(&content, front_matter_len, Parser::Vue, &mut tree).ok()?;
    let (mut sorted_text, mut from) = (Vec::new(), 0);
    // `descriptor.script`, `descriptor.scriptSetup`
    let mut is_found = [false; 2];
    for id in tree.children(tree.root) {
        let node = &tree[id];
        if node.kind != ast::Kind::Element || !node.is_full_name(b"script") {
            continue;
        }
        let (start, end) = (node.start_span.end as usize, node.end_span.start as usize);
        let Some(code) = text.get(start..end).filter(|_| node.end_span().is_some()) else {
            continue;
        };
        if strings::trim_js_whitespace(code).is_empty() && tree.attribute(id, b"src").is_none() {
            continue;
        }
        let is_setup = tree.attribute(id, b"setup").is_some();
        if std::mem::replace(&mut is_found[usize::from(is_setup)], true) {
            continue;
        }
        if let Some(sorted) = js::sorted_script(parse, code, how) {
            sorted_text.extend_from_slice(text.get(from..start)?);
            sorted_text.push(b'\n');
            sorted_text.extend_from_slice(&sorted);
            sorted_text.push(b'\n');
            from = end;
        }
    }
    (from > 0).then(|| {
        sorted_text.extend_from_slice(text.get(from..).unwrap_or_default());
        sorted_text
    })
}

/// Returns why `text` can't be parsed: Prettier's message and the error's byte offset in `text`, not counting a byte
/// order mark. Returns `None` if it parses.
pub fn syntax_error(text: &[u8], parser: Parser) -> Option<(Vec<u8>, u32)> {
    let original = text.strip_prefix(BOM).unwrap_or(text);
    let text = bun_core::strings::crlf_as_lf(original);
    let (content, front_matter_len) = without_front_matter(&text);
    let mut tree = ast::Tree::default();
    let Err(parse::ParseError::Syntax(error)) =
        parse::parse(&content, front_matter_len, parser, &mut tree)
    else {
        return None;
    };
    // A two-byte line break is a single byte in the parsed text.
    let (mut at, mut left) = (0, error.at as usize);
    while left > 0 && at < original.len() {
        at += if original[at..].starts_with(b"\r\n") {
            2
        } else {
            1
        };
        left -= 1;
    }
    Some((error.message(), at as u32))
}

/// True if `text`, where every line break is `\n`, has no syntax error.
pub(crate) fn can_be_parsed(text: &[u8], parser: Parser) -> bool {
    let (content, front_matter_len) = without_front_matter(text);
    parse::parse(
        &content,
        front_matter_len,
        parser,
        &mut ast::Tree::default(),
    )
    .is_ok()
}

/// The result of writing a document.
struct DocumentSummary {
    /// The part of the text around the cursor, which is marked in the document.
    region: Option<Region>,
    /// The number of top-level nodes.
    top_level_count: usize,
    /// The document is of no use: the text has to be formatted without short cuts.
    has_wrong_short_cut: bool,
    /// Why the document of the quick way is of no use, if that's what has been written.
    unwritten: Option<crate::js::quick_guests::from_doc::Unwritten>,
}

/// Writes the document for `text`, where every line break is `\n`. Returns the number of top-level nodes.
///
/// `is_embedded` means the text is embedded in another language, so no line break is written at the end. `indent_level`
/// is the number of `indent`s around what's written, if known.
pub(crate) fn write_document(
    text: &[u8],
    parser: Parser,
    path: Option<&[u8]>,
    options: &FormatOptions,
    is_embedded: bool,
    indent_level: Option<u32>,
    f: &mut Formatter<'_>,
) -> Result<usize, FormatError> {
    write_document_with_cursor(
        text,
        parser,
        path,
        options,
        is_embedded,
        indent_level,
        None,
        Flavor::Prettier,
        None,
        &mut None,
        &mut Scripts::default(),
        f,
        None,
    )
    .map(|summary| summary.top_level_count)
}

/// Like `write_document` for a text in a template, but writes to the document of the quick way. Nothing is kept of what
/// is written to `f`.
pub(crate) fn write_document_to_quick<'w, 'f>(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    indent_level: u32,
    f: &'w mut Formatter<'f>,
    quick: writer::ToQuick<'w, 'f>,
) -> Result<(usize, Option<crate::js::quick_guests::from_doc::Unwritten>), FormatError> {
    // This is all that's ever checked about the file name.
    let path = options.is_in_html_file.then_some(&b".html"[..]);
    write_document_with_cursor(
        text,
        parser,
        path,
        options,
        true,
        Some(indent_level),
        None,
        Flavor::Prettier,
        None,
        &mut None,
        &mut Scripts::default(),
        f,
        Some(quick),
    )
    .map(|summary| (summary.top_level_count, summary.unwritten))
}

/// Like `write_document`. `cursor_offset` is the cursor's offset in `text`, and `script_flavor` is the flavor that
/// scripts are formatted in. `found` is what `Runs::whole` has left. `spare` is what has read another text, whose buffers
/// are used and left there again.
#[allow(clippy::too_many_arguments)]
fn write_document_with_cursor<'w, 'f>(
    text: &[u8],
    parser: Parser,
    path: Option<&[u8]>,
    options: &FormatOptions,
    is_embedded: bool,
    indent_level: Option<u32>,
    cursor_offset: Option<u32>,
    script_flavor: Flavor,
    found: Option<(runs::Runs, Vec<u8>)>,
    spare: &mut Option<(runs::Runs, Vec<u8>)>,
    scripts: &mut Scripts,
    f: &'w mut Formatter<'f>,
    quick: Option<writer::ToQuick<'w, 'f>>,
) -> Result<DocumentSummary, FormatError> {
    let (content, front_matter_len) = without_front_matter(text);
    let mut tree = ast::Tree::default();
    // A node for some twenty bytes: the list doesn't move while a small text is read.
    tree.nodes.reserve(text.len() / 24 + 8);
    if let Some((runs, printed)) = found {
        (tree.runs, tree.printed) = (Some(runs), printed);
    } else if let Some((runs, mut printed)) = spare.take() {
        printed.clear();
        (tree.spare_runs, tree.printed) = (Some(runs), printed);
    }
    // Only where lines start at a known column, and nobody asks where a node has gone.
    let reads_runs = !is_embedded && indent_level == Some(0) && cursor_offset.is_none();
    // Vue compiles nothing under `v-pre`.
    let reads_runs = reads_runs
        && (parser != Parser::Vue
            || (!strings::contains(text, b"v-pre") && !script_flavor.is_oxfmt()));
    let runs = runs::Settings::new(parser, options, path, front_matter_len.unwrap_or(0))
        .filter(|_| reads_runs);
    // The code in a template is formatted while it is read.
    if let Some(settings) = runs.filter(|_| parser == Parser::Vue) {
        let reader = match &mut tree.runs {
            Some(runs) => runs,
            None => (tree.spare_runs).get_or_insert_with(|| runs::Runs::new(settings)),
        };
        reader.guests = Some(Box::new(runs::OwnGuests {
            options: options.clone(),
            scripts: std::mem::take(scripts),
        }));
    }
    let parsed = parse::parse_with_runs(&content, front_matter_len, parser, runs, &mut tree);
    for reader in [&mut tree.runs, &mut tree.spare_runs].into_iter().flatten() {
        if let Some(guests) = reader.guests.take() {
            *scripts = guests.scripts;
        }
    }
    parsed.map_err(|error| match error {
        parse::ParseError::Syntax(_) => FormatError::SyntaxError,
        parse::ParseError::NestedTooDeeply => FormatError::NestedTooDeeply,
    })?;
    let cursor = cursor_offset.map_or(Cursor::Nowhere, |offset| cursor::locate(&tree, offset));
    let options = Options {
        parser,
        original_text: text,
        format: options,
        filepath: path,
        has_parent_parser: is_embedded || options.is_in_markdown,
        script_flavor,
    };
    if !preprocess::preprocess(&mut tree, &options) {
        return Err(FormatError::NestedTooDeeply);
    }
    if options.format.html_template_depth > 0 && in_js::would_repeat_substitution(&tree) {
        return Err(FormatError::SyntaxError);
    }
    let mut printer = printer::Printer {
        tree: &tree,
        options: &options,
        out: match quick {
            Some(quick) => writer::Writer::to_quick(f, quick, indent_level),
            None => writer::Writer::new(f, indent_level, !is_embedded),
        },
        ancestors: 0,
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
        has_wrong_short_cut: false,
        has_typescript_script: None,
        has_tsx_script: None,
        cursor,
        css_scratch: Default::default(),
        scripts: std::mem::take(scripts),
    };
    printer.print_root(!is_embedded);
    let is_nested_too_deeply = printer.is_nested_too_deeply;
    let has_wrong_short_cut = printer.has_wrong_short_cut
        || (tree.assumes_typescript)
            .is_some_and(|it| it != printer.is_vue_sfc_with_typescript_script());
    *scripts = std::mem::take(&mut printer.scripts);
    let unwritten = printer.out.unwritten();
    printer.out.finish();
    let (region, top_level_count) = (cursor.region(&tree), tree.children(tree.root).count());
    *spare = (tree.spare_runs.take().or_else(|| tree.runs.take()))
        .map(|runs| (runs, std::mem::take(&mut tree.printed)));
    match is_nested_too_deeply {
        true => Err(FormatError::NestedTooDeeply),
        false => Ok(DocumentSummary {
            region,
            top_level_count,
            has_wrong_short_cut,
            unwritten,
        }),
    }
}

/// Appends what is printed for `text`, a Vue file called `name` that is one run, for which `lines` is printed: lines, and
/// between them code, which its formatter prints as a text. `options` are those that the caller has asked for,
/// `options_of_text` makes those of the text. Where code takes a document, it returns the rest of `lines` from that code
/// on: what is in front of it has been appended, with a line break at its end.
fn write_lines_and_code<'l>(
    mut lines: &'l [u8],
    (text, name): (&[u8], &[u8]),
    options: &FormatOptions,
    options_of_text: &dyn Fn() -> FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Option<&'l [u8]> {
    use runs::Language;
    let (all, start) = (lines, out.len());
    let formatted = &mut scratch.scripts.formatted;
    while let Some((before, code, after)) = runs::Code::split(lines) {
        out.extend_from_slice(before);
        out.push(b'\n');
        let rest = lines.get(before.len()..);
        let source = code.span.of(text);
        let style_sheet = match code.language {
            Language::Script => return rest,
            Language::JavaScript | Language::TypeScript => None,
            Language::Css => Some(crate::css::Parser::Css),
            Language::Scss => Some(crate::css::Parser::Scss),
            Language::Less => Some(crate::css::Parser::Less),
        };
        let is_formatted = match style_sheet {
            None => {
                let script = crate::js::quick::Script {
                    text: source,
                    name,
                    is_typescript: code.language == Language::TypeScript,
                    is_no_module: false,
                    indentation: u32::from(code.level),
                };
                let quick = &mut scratch.scripts.quick;
                let is_formatted =
                    crate::js::quick::format_script(script, options, quick, formatted).is_ok();
                scratch.scripts.has_refused_next = !is_formatted;
                is_formatted
            }
            // Its lines would have to be indented.
            Some(_) if code.level != 0 => false,
            Some(parser) => {
                let options = FormatOptions {
                    in_html: InHtml {
                        root: HtmlRoot::Program,
                        ..InHtml::default()
                    },
                    ..embed::options_for_printed_text(&options_of_text(), 0)
                };
                formatted.clear();
                let style_sheets = &mut scratch.style_sheets;
                crate::css::format(source, parser, &options, style_sheets, formatted).is_ok()
                    // A line break in a text.
                    && !strings::contains_char(formatted, b'\r')
            }
        };
        let printed = formatted.trim_ascii_end();
        // The tags are at the left margin. White space at the end of the code is another matter.
        if !is_formatted
            || code.tag_level != 0
            || printed.is_empty()
            || formatted.get(printed.len()..) != Some(b"\n")
        {
            return rest;
        }
        let (byte, count) = match options.indent_style.is_tab() {
            true => (b'\t', usize::from(code.level)),
            false => (
                b' ',
                usize::from(code.level) * options.indent_width.value() as usize,
            ),
        };
        if crate::is_too_long(out.len().saturating_add(count)) {
            return rest;
        }
        out.resize(out.len() + count, byte);
        out.extend_from_slice(printed);
        out.push(b'\n');
        lines = after;
    }
    out.extend_from_slice(lines);
    out.push(b'\n');
    // The printer says so.
    crate::is_too_long(out.len()).then(|| {
        out.truncate(start);
        out.push(b'\n');
        all
    })
}

/// Formats `text`, an Angular expression, and appends it to `out` without a final line break.
///
/// Prettier's parsers for these have no pragma support, so it behaves as if any required pragma were present.
fn format_angular_expression(
    text: &[u8],
    root: HtmlRoot,
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let start = out.len();
    let options = FormatOptions {
        line_ending: options.line_ending.resolve(text),
        ..options.clone()
    };
    let text = match text.strip_prefix(BOM) {
        Some(rest) => {
            out.extend_from_slice(BOM);
            rest
        }
        None => text,
    };
    let text = bun_core::strings::crlf_as_lf(text);
    if strings::trim_js_whitespace(&text).is_empty() {
        return Ok(());
    }
    let mut context =
        JsFormatContext::without_file(options.clone(), &crate::js::comments::NO_COMMENTS);
    context.parse_javascript = parse_javascript;
    let mut is_written = false;
    let document = crate::ir::run::write_with(context, &text, &mut scratch.document, |f| {
        let mut printer = printer::Printer {
            tree: &ast::Tree::default(),
            options: &Options {
                parser: Parser::Angular,
                original_text: &text,
                format: &options,
                filepath: None,
                has_parent_parser: false,
                script_flavor: options.flavor,
            },
            out: writer::Writer::new(f, Some(0), true),
            ancestors: 0,
            stack_check: bun_core::StackCheck::init(),
            is_nested_too_deeply: false,
            has_wrong_short_cut: false,
            has_typescript_script: None,
            has_tsx_script: None,
            cursor: Cursor::Nowhere,
            css_scratch: Default::default(),
            scripts: Default::default(),
        };
        let in_html = InHtml {
            root,
            ..InHtml::default()
        };
        is_written = printer.write_angular_expression(&text, in_html, js::Hug::Bare);
        printer.out.finish();
    });
    document
        .and_then(|document| match is_written {
            true => crate::ir::run::print(document, &text, &options, &mut scratch.document, out),
            false => Err(FormatError::SyntaxError),
        })
        .inspect_err(|_| out.truncate(start))
}

/// Appends the formatted `text` to `out`. `path` is the file's name.
pub fn format(
    path: &[u8],
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    format_with_cursor(path, text, parser, options, scratch, out).map(|_| ())
}

/// Like `format`. Returns the new position of the cursor, which is at `options.cursor_offset` in `text`, relative to
/// the appended text and in UTF-16 code units like the option.
fn format_with_cursor(
    path: &[u8],
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<Option<u32>, FormatError> {
    format_with(path, text, parser, options, None, scratch, out)
}

/// Like `format_with_cursor`. `parse_javascript` replaces `options.parse_javascript`.
pub fn format_with(
    path: &[u8],
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<Option<u32>, FormatError> {
    match format_once(path, text, parser, options, parse_javascript, scratch, out) {
        // A short cut in a script that rests on a wrong guess shows when the document is printed.
        Err(FormatError::InvalidDocument) if !options.no_short_cuts => {
            let options = FormatOptions {
                no_short_cuts: true,
                ..options.clone()
            };
            format_once(path, text, parser, &options, parse_javascript, scratch, out)
        }
        result => result,
    }
}

fn format_once(
    path: &[u8],
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<Option<u32>, FormatError> {
    if let Parser::AngularExpression(root) = parser {
        return format_angular_expression(text, root, options, parse_javascript, scratch, out)
            .map(|()| None);
    }
    let original = text;
    let has_bom = text.starts_with(BOM);
    let Some((text, is_range)) = prepared_text(text, options) else {
        out.extend_from_slice(original);
        return Ok(options.cursor_offset);
    };
    if has_bom {
        out.extend_from_slice(BOM);
    }
    // Prettier uses JavaScript's definition of whitespace, so it prints nothing for a lone no-break space.
    if text.trim_ascii().is_empty() {
        return Ok(None);
    }
    // Prettier's `isSourceElement`: no node can be formatted on its own, except in Vue, where every node can. But it
    // never finds the root's children, so in Vue the range becomes the whole text.
    if is_range && parser != Parser::Vue {
        if !can_be_parsed(&text, parser) {
            out.truncate(out.len() - if has_bom { BOM.len() } else { 0 });
            return Err(FormatError::SyntaxError);
        }
        let from = out.len() - if has_bom { BOM.len() } else { 0 };
        write_with_line_ending(&text, options.line_ending.resolve(original).as_bytes(), out);
        // `options.cursor_offset` is relative to `original`.
        return Ok(crate::cursor::cursor_in_formatted_text(
            original,
            options,
            &out[from..],
        ));
    }
    let sorts_text = (options.sort_imports.as_deref())
        .filter(|how| parser == Parser::Vue && !how.is_applied_by_format())
        .filter(|how| how.applies_to_embedded_code());
    let text = match sorts_text.zip(js::Parse::new(parse_javascript, options)) {
        Some((how, parse)) => with_sorted_scripts(&text, how, parse).map_or(text, Cow::Owned),
        None => text,
    };
    let text = match options.tailwind.as_deref() {
        Some(how) => {
            let parse = js::Parse::new(parse_javascript, options);
            tailwind::with_sorted_classes(&text, parser, how, parse).map_or(text, Cow::Owned)
        }
        None => text,
    };
    // Convert it to an offset in `text`, which has one byte per line break and no byte order mark.
    let cursor_offset = crate::cursor::cursor_offset_in_bytes(original, options).map(|offset| {
        let before = original.get(..offset as usize).unwrap_or(original);
        offset.saturating_sub(
            strings::count(before, b"\r\n") as u32 + if has_bom { BOM.len() as u32 } else { 0 },
        )
    });
    let start = out.len() - if has_bom { BOM.len() } else { 0 };
    let script_flavor = match is_vue_file(options, parser) {
        true => options.flavor,
        false => Flavor::Prettier,
    };
    let options_of_text = || FormatOptions {
        line_ending: options.line_ending.resolve(original),
        is_in_html_file: path.ends_with(b".html") || path.ends_with(b".htm"),
        filepath: Some(options.filepath.clone().unwrap_or_else(|| path.into())),
        ..options_of_host(options, parser)
    };
    // A text that is one run from its start to its end needs no tree and no document. Behind front matter it needs no
    // tree.
    let mut found = None;
    let can_be_one_run = match parser {
        Parser::Html => true,
        // Vue compiles nothing under `v-pre`.
        Parser::Vue => !script_flavor.is_oxfmt() && !strings::contains(&text, b"v-pre"),
        _ => false,
    };
    if can_be_one_run
        && !is_range
        && cursor_offset.is_none()
        && let front_matter_len = front_matter::parse(&text).map_or(0, |it| it.end)
        && let Some(settings) = runs::Settings::new(parser, options, Some(path), front_matter_len)
    {
        let (mut runs, mut printed) = match scratch.runs.take() {
            Some((mut runs, mut printed)) => {
                runs.reset(settings);
                printed.clear();
                (runs, printed)
            }
            None => (runs::Runs::new(settings), Vec::new()),
        };
        let guests = (parser == Parser::Vue).then_some(runs::Guests {
            options,
            scripts: &mut scratch.scripts,
        });
        if let Some((span, is_in_text)) = runs.whole(&text, &mut printed, guests)
            && options.line_ending.resolve(original) == crate::options::LineEnding::Lf
            && let Some(whole) = (if is_in_text { &text[..] } else { &printed[..] })
                .get(span.start as usize..span.end as usize)
        {
            if front_matter_len == 0 && (is_in_text || !strings::contains_char(whole, 0)) {
                out.extend_from_slice(whole);
                out.push(b'\n');
                scratch.runs = Some((runs, printed));
                return Ok(None);
            }
            let (mut whole, mut lines_so_far) = (whole, Vec::new());
            if front_matter_len == 0 && parser == Parser::Vue {
                let written = out.len();
                let named = (&text[..], options.filepath.as_deref().unwrap_or(path));
                let Some(rest) =
                    write_lines_and_code(whole, named, options, &options_of_text, scratch, out)
                else {
                    scratch.runs = Some((runs, printed));
                    return Ok(None);
                };
                // What has been printed are lines like the others. Nothing is formatted twice.
                let lines = out.get(written..out.len() - 1).unwrap_or_default();
                lines_so_far.reserve(lines.len() + rest.len());
                lines_so_far.extend_from_slice(lines);
                lines_so_far.extend_from_slice(rest);
                out.truncate(written);
                whole = &lines_so_far;
            }
            let options = options_of_text();
            let mut context =
                JsFormatContext::without_file(options.clone(), &crate::js::comments::NO_COMMENTS);
            context.parse_javascript = parse_javascript;
            context.short_cuts = crate::js::flat::ShortCuts::for_host(&options);
            let mut has_wrong_short_cut = false;
            let root = crate::ir::run::write_with(context, &text, &mut scratch.document, |f| {
                let mut printer = printer::Printer {
                    tree: &ast::Tree::default(),
                    options: &Options {
                        parser,
                        original_text: &text,
                        format: &options,
                        filepath: Some(path).filter(|path| !path.is_empty()),
                        has_parent_parser: options.is_in_markdown,
                        script_flavor,
                    },
                    out: writer::Writer::new(f, Some(0), true),
                    ancestors: 0,
                    stack_check: bun_core::StackCheck::init(),
                    is_nested_too_deeply: false,
                    has_wrong_short_cut: false,
                    has_typescript_script: None,
                    has_tsx_script: None,
                    cursor: Cursor::Nowhere,
                    css_scratch: Default::default(),
                    scripts: std::mem::take(&mut scratch.scripts),
                };
                printer.print_front_matter_and_run(&text[..front_matter_len], whole);
                has_wrong_short_cut = printer.has_wrong_short_cut || printer.is_nested_too_deeply;
                scratch.scripts = std::mem::take(&mut printer.scripts);
                printer.out.finish();
            });
            return root
                .and_then(|root| match has_wrong_short_cut {
                    // Once more, without short cuts.
                    true => Err(FormatError::InvalidDocument),
                    false => Ok(root),
                })
                .and_then(|root| {
                    crate::ir::run::print(root, &text, &options, &mut scratch.document, out)
                })
                .map(|()| None)
                .inspect_err(|_| out.truncate(start));
        }
        found = Some((runs, printed));
    }
    let mut options = options_of_text();
    let path = Some(path).filter(|path| !path.is_empty());
    let (result, root) = loop {
        let (mut result, mut has_wrong_short_cut) = (Ok(None), false);
        let mut context =
            JsFormatContext::without_file(options.clone(), &crate::js::comments::NO_COMMENTS);
        context.parse_javascript = parse_javascript;
        context.short_cuts = crate::js::flat::ShortCuts::for_host(&options);
        let root = crate::ir::run::write_with(context, &text, &mut scratch.document, |f| {
            result = write_document_with_cursor(
                &text,
                parser,
                path,
                &options,
                false,
                Some(0),
                cursor_offset,
                script_flavor,
                found.take(),
                &mut scratch.runs,
                &mut scratch.scripts,
                f,
                None,
            )
            .map(|summary| {
                has_wrong_short_cut = summary.has_wrong_short_cut;
                summary.region
            });
        });
        if !has_wrong_short_cut || options.no_short_cuts {
            break (result, root);
        }
        options.no_short_cuts = true;
    };
    let printed_from = out.len();
    let region = result
        .and_then(|region| root.map(|root| (region, root)))
        .and_then(|(region, root)| {
            crate::ir::run::print(root, &text, &options, &mut scratch.document, out)
                .map(|()| region)
        })
        .inspect_err(|_| out.truncate(start))?;
    // `formatRange` drops the final line break.
    if is_range {
        out.truncate(printed_from + strings::trim_js_whitespace_end(&out[printed_from..]).len());
    }
    let (Some(offset), Some(region)) = (cursor_offset, region) else {
        return Ok(None);
    };
    let printed = out.get(printed_from..).unwrap_or_default();
    // Without a node on one side, the region extends to that end of the document.
    let [first, second] = scratch.document.marks();
    let marks = match region {
        Region::Between {
            before: None,
            after: Some(_),
        } => Some(0).zip(second),
        Region::Between {
            before: Some(_),
            after: None,
        } => first.zip(Some(printed.len() as u32)),
        _ => first.zip(second),
    };
    Ok(Some(
        crate::cursor::cursor_in_region(&text, offset, region, printed, marks) + u32::from(has_bom),
    ))
}
