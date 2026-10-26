//! Svelte: a port of `prettier-plugin-svelte` 4.1.1 and of the parser of Svelte 5.57. See "Svelte" in `../CLAUDE.md`.

mod ast;
mod code;
mod doc;
mod js;
mod parser;
mod pattern;
mod print;
mod tailwind;
mod verify;

use crate::FormatError;
use crate::html::js::Parse;
use crate::html::writer::Writer;
use crate::js::context::JsFormatContext;
use crate::options::{
    EmbeddedLanguageFormatting, Flavor, FormatOptions, JavaScriptParser, ParseParts,
};
use crate::range::{Offsets, write_with_line_ending};
use crate::stack::Stack;
use crate::syntax_error::{BeforeNormalizing, Message, SyntaxError};

/// Allocations made while formatting one file that can be reused for the next.
#[derive(Default)]
pub struct Scratch {
    document: crate::Scratch,
    /// See [`Scratch::unformatted`].
    unformatted: Vec<Unformatted>,
}

/// The content of a `<script>` or `<style>` that couldn't be parsed and was left unformatted.
#[derive(Debug, Clone)]
pub struct Unformatted {
    /// The error message.
    pub message: Vec<u8>,
    /// Byte offset in the component, not counting a byte order mark.
    pub at: u32,
}

impl Scratch {
    /// The parts of the most recently formatted component that were left unformatted, in source order.
    pub fn unformatted(&self) -> &[Unformatted] {
        &self.unformatted
    }
}

/// The parsers for the JavaScript in a component.
#[derive(Copy, Clone)]
struct Parsers<'p> {
    program: Parse<'p>,
    parts: ParseParts,
}

impl<'p> Parsers<'p> {
    /// `parse_javascript` is used instead of `options.parse_javascript`.
    fn new(
        parse_javascript: Option<JavaScriptParser<'p>>,
        options: &FormatOptions,
    ) -> Option<Parsers<'p>> {
        Some(Parsers {
            program: Parse::new(parse_javascript, options)?,
            parts: options.parse_parts?,
        })
    }

    /// Parses `text`. Returns `Err(None)` if an expression in it is nested too deeply.
    fn tree_of<'a>(self, text: &'a [u8]) -> Result<ast::Tree<'a>, Option<SyntaxError>> {
        let mut tree = Err(None);
        (self.parts)(text, &mut |parse_part| {
            let mut js = js::FromParser {
                parse: self.program,
                parse_part,
                is_typescript: false,
                is_nested_too_deeply: false,
                typescript_at: None,
                stopped_at: None,
            };
            let parsed = parser::parse(text, &mut js);
            tree = parsed.map_err(|error| {
                // The expected token is missing because the expression was cut off at the `as`: `{a as b}`,
                // `{(a as b)}`.
                let word = js.stopped_at.and_then(|it| {
                    let between = text.get(it..error.1 as usize)?;
                    let leading_whitespace = text[it..].len() - text[it..].trim_ascii_start().len();
                    between
                        .trim_ascii()
                        .is_empty()
                        .then_some(it + leading_whitespace)
                });
                let typescript_at = (js.typescript_at)
                    .filter(|&it| it == error.1 as usize)
                    .or(word);
                match typescript_at {
                    _ if js.is_nested_too_deeply => None,
                    Some(at) => Some(SyntaxError(Message::TypeScriptInJavaScript, at as u32)),
                    None => Some(error),
                }
            });
        });
        tree
    }
}

/// Appends the formatted text to `out`. `parse_javascript` is used instead of `options.parse_javascript`.
pub fn format(
    path: &[u8],
    original: &[u8],
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    scratch.unformatted.clear();
    let Some(parsers) = Parsers::new(parse_javascript, options) else {
        return Err(FormatError::SyntaxError);
    };
    let without_bom = original.strip_prefix(crate::text::BOM).unwrap_or(original);
    let first = original.len() - without_bom.len();
    let range = Offsets::new(original, first, options);
    if (range.start >= range.end && !without_bom.is_empty())
        || (options.require_pragma && !print::has_pragma(without_bom))
    {
        out.extend_from_slice(original);
        return Ok(());
    }
    let normalized = bun_core::strings::crlf_as_lf(without_bom);
    let text = trimmed(&normalized);
    // Maps an offset in `text` to an offset in the file.
    let in_file = |SyntaxError(message, at): SyntaxError| {
        let before = (normalized.len() - trimmed_start(&normalized).len()) as u32;
        SyntaxError(message, before + at).before_normalizing_end_of_line(without_bom)
    };
    let to_format_error = |error: SyntaxError| FormatError::SyntaxErrorAt(in_file(error));
    let mut tree = (parsers.tree_of(text))
        .map_err(|error| error.map_or(FormatError::NestedTooDeeply, to_format_error))?;
    // Prettier's `isSourceElement` accepts nothing in a component, as in HTML, so a range leaves the text unchanged.
    // Prettier itself prints the text that the plugin parsed, where `<script ✂prettier:content✂="..">{}</script>`
    // replaces each script.
    if range.start > first || range.end < original.len() {
        out.extend_from_slice(&original[..first]);
        let line_ending = options.line_ending.resolve(original);
        write_with_line_ending(&normalized, line_ending.as_bytes(), out);
        return Ok(());
    }
    let host = FormatOptions {
        line_ending: options.line_ending.resolve(original),
        filepath: Some(options.filepath.clone().unwrap_or_else(|| path.into())),
        flavor: Flavor::Prettier,
        ..options.clone()
    };
    let svelte = options.svelte;
    let is_typescript = tree.uses_typescript;
    let program_parser = (parsers.program, is_typescript);
    let sorted = (options.tailwind.as_deref())
        .and_then(|it| tailwind::sort(&mut tree, text, it, program_parser));
    let text = sorted.as_deref().unwrap_or(text);
    let stack = Stack::for_tree();
    let mut expand =
        |pattern: &[u8]| pattern::expand(parsers.program, pattern, is_typescript, &stack);
    let printer = print::Printer::new(tree, text, (&host, svelte), &mut expand, &stack);
    let mut document = printer.print_root();
    if stack.ran_out() {
        return Err(FormatError::NestedTooDeeply);
    }
    // Without `embed`, the only JavaScript the plugin can print is an identifier, and it throws for a script or a
    // style sheet.
    if options.embedded_language_formatting == EmbeddedLanguageFormatting::Off
        && !document.replace_identifier_code_with_text()
    {
        let error = SyntaxError(Message::NeedsEmbeddedFormatting, 0);
        return Err(FormatError::SyntaxErrorAt(error));
    }
    let (stack, unformatted) = (Stack::new(), Default::default());
    let settings = code::CodeSettings {
        options: &host,
        is_typescript,
        indents_script_and_style: svelte.indents_script_and_style,
        script_flavor: options.flavor,
        stack: &stack,
        parse: parsers.program,
        unformatted: &unformatted,
    };
    let mut context =
        JsFormatContext::without_file(host.clone(), &crate::js::comments::NO_COMMENTS);
    context.parse_javascript = parse_javascript;
    let root = crate::ir::run::write_with(context, text, &mut scratch.document, |f| {
        let mut writer = Writer::new(f, Some(0), true);
        let mut write = doc::Write {
            code: &mut |code, out| code::write_code(code, out, &settings),
            stack: &stack,
        };
        doc::write(document, &mut writer, &mut write);
        writer.finish();
    })?;
    if stack.ran_out() {
        return Err(FormatError::NestedTooDeeply);
    }
    // Scripts are written first, wherever they are in the source.
    let mut unformatted = unformatted.take();
    crate::sort::sort_by_key(&mut unformatted, |it| it.1);
    let before = (normalized.len() - trimmed_start(&normalized).len()) as u32;
    let mut offsets = BeforeNormalizing::new(without_bom);
    scratch
        .unformatted
        .extend(unformatted.into_iter().map(|(message, at)| {
            let at = offsets.original_offset_of(before + at);
            Unformatted { message, at }
        }));
    if original.starts_with(crate::text::BOM) {
        out.extend_from_slice(crate::text::BOM);
    }
    crate::ir::run::print(root, text, &host, &mut scratch.document, out)
}

/// Strips leading HTML whitespace. The plugin strips everything that JavaScript counts as whitespace, including a
/// no-break space, which Svelte treats as text.
fn trimmed_start(text: &[u8]) -> &[u8] {
    text.trim_ascii_start()
}

/// Also strips the end. Svelte calls `trimEnd()`, so it drops a trailing no-break space. That space would be text if
/// it ended up before a `<style>`.
fn trimmed(text: &[u8]) -> &[u8] {
    bun_core::strings::trim_js_whitespace_end(trimmed_start(text))
}

fn prepared(text: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    bun_core::strings::crlf_as_lf(text.strip_prefix(crate::text::BOM).unwrap_or(text))
}

/// For `--debug-check`. True if `after`, the formatted form of `before`, has the same content as `before`, with
/// nothing lost or added. See `verify.rs`.
#[optimize(size)]
pub fn has_same_content(
    before: &[u8],
    after: &[u8],
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
) -> bool {
    let Some(parsers) = Parsers::new(parse_javascript, options) else {
        return false;
    };
    let before = prepared(before);
    // `insertPragma` adds this comment at the top.
    let before = match options.insert_pragma && !print::has_pragma(&before) {
        true => [b"<!-- @format -->\n", &before[..]].concat(),
        false => before.into_owned(),
    };
    let sensitivity = options.html_whitespace_sensitivity;
    let matches_input =
        |after: &[u8]| verify::has_same_content(&before, &prepared(after), parsers, sensitivity);
    if matches_input(after) {
        return true;
    }
    if options.sort_imports.is_none() && options.jsdoc.is_none() && options.tailwind.is_none() {
        return false;
    }
    // These options change the content: two imports of one module can merge, words in a JSDoc comment can change, and
    // a duplicate class is dropped. So check the output of a run without them instead.
    let plain = FormatOptions {
        sort_imports: None,
        jsdoc: None,
        tailwind: None,
        insert_pragma: false,
        ..options.clone()
    };
    let (mut scratch, mut formatted) = (Scratch::default(), Vec::new());
    format(
        b"",
        &before,
        &plain,
        parse_javascript,
        &mut scratch,
        &mut formatted,
    )
    .is_ok()
        && matches_input(&formatted)
}
