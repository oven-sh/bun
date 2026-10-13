//! Svelte: a port of `prettier-plugin-svelte` 4.1.1 and of the parser of Svelte 5.57. See "Svelte" in `../CLAUDE.md`.

mod ast;
mod code;
mod doc;
mod js;
mod parser;
mod pattern;
mod print;
mod snip;
mod tailwind;
mod verify;

use crate::FormatError;
use crate::html::js::Parse;
use crate::html::writer::Writer;
use crate::js::context::JsFormatContext;
use crate::options::{
    EmbeddedLanguageFormatting, Flavor, FormatOptions, JavaScriptParser, ParseParts,
};
use crate::stack::Stack;
use crate::syntax_error::{Message, SyntaxError};

/// Everything that is allocated to format a text and can be used again for the next one.
#[derive(Default)]
pub struct Scratch {
    document: crate::Scratch,
    /// See [`Scratch::unformatted`].
    unformatted: Vec<Unformatted>,
}

/// What is in a `<script>` or a `<style>` cannot be parsed, and has stayed as it is.
#[derive(Debug, Clone)]
pub struct Unformatted {
    /// What is wrong with it.
    pub message: Vec<u8>,
    /// At which byte of the component, not counting a byte order mark.
    pub at: u32,
}

impl Scratch {
    /// What has stayed as it is in the component that has been formatted last.
    pub fn unformatted(&self) -> &[Unformatted] {
        &self.unformatted
    }
}

/// What parses the JavaScript in a component.
#[derive(Copy, Clone)]
struct Parsers<'p> {
    program: Parse<'p>,
    parts: ParseParts,
}

impl<'p> Parsers<'p> {
    /// `parse_javascript`: in the place of `options.parse_javascript`.
    fn new(
        parse_javascript: Option<JavaScriptParser<'p>>,
        options: &FormatOptions,
    ) -> Option<Parsers<'p>> {
        Some(Parsers {
            program: Parse::new(parse_javascript, options)?,
            parts: options.parse_parts?,
        })
    }

    /// The tree of `text`, which has been snipped.
    fn tree_of<'a>(self, text: &'a [u8]) -> Result<ast::Tree<'a>, SyntaxError> {
        let mut tree = Err(SyntaxError(Message::UnexpectedToken, 0));
        (self.parts)(text, &mut |parse_part| {
            tree = parser::parse(
                text,
                &mut js::FromParser {
                    parse: self.program,
                    parse_part,
                    is_typescript: false,
                },
            );
        });
        tree
    }
}

/// Appends the formatted text to `out`. `parse_javascript`: in the place of `options.parse_javascript`.
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
    let without_mark = original.strip_prefix(crate::text::BOM).unwrap_or(original);
    if options.require_pragma && !print::has_pragma(without_mark) {
        out.extend_from_slice(original);
        return Ok(());
    }
    let text = bun_core::strings::crlf_as_lf(without_mark);
    let snipped = snip::snip(&text);
    // `at`: in the snipped text.
    let refuse = |SyntaxError(message, at): SyntaxError| {
        let error = SyntaxError(message, snipped.place_in_source(at));
        FormatError::SyntaxErrorAt(error.before_normalizing_end_of_line(without_mark))
    };
    let mut tree = parsers.tree_of(&snipped.text).map_err(refuse)?;
    let host = FormatOptions {
        line_ending: options.line_ending.resolve(original),
        filepath: Some(options.filepath.clone().unwrap_or_else(|| path.into())),
        flavor: Flavor::Prettier,
        ..options.clone()
    };
    let svelte = options.svelte;
    let how = (parsers.program, snipped.is_typescript);
    let sorted = (options.tailwind.as_deref())
        .and_then(|it| tailwind::sort(&mut tree, &snipped.text, it, how));
    let text = sorted.as_deref().unwrap_or(&snipped.text);
    let stack = Stack::for_tree();
    let mut expand =
        |pattern: &[u8]| pattern::expand(parsers.program, pattern, snipped.is_typescript, &stack);
    let printer = print::Printer::new(
        tree,
        (text, &snipped.contents[..]),
        (&host, svelte),
        &mut expand,
        &stack,
    );
    let document = printer.print_root();
    if stack.ran_out() {
        return Err(FormatError::NestedTooDeeply);
    }
    let mut document = document
        .map_err(|print::Thrown(at)| refuse(SyntaxError(Message::CannotBeFormatted, at)))?;
    // Without `embed` the plugin knows names and nothing else of JavaScript, and throws for a script and for a style sheet.
    if options.embedded_language_formatting == EmbeddedLanguageFormatting::Off
        && !document.replace_code_by_names()
    {
        let error = SyntaxError(Message::NeedsEmbeddedFormatting, 0);
        return Err(FormatError::SyntaxErrorAt(error));
    }
    let (stack, unformatted) = (Stack::new(), Default::default());
    let how = code::How {
        options: &host,
        is_typescript: snipped.is_typescript,
        indents_script_and_style: svelte.indents_script_and_style,
        script_flavor: options.flavor,
        stack: &stack,
        parse: parsers.program,
        unformatted: &unformatted,
    };
    let mut context = JsFormatContext::without_file(text, host.clone(), &[]);
    context.parse_javascript = parse_javascript;
    let root = crate::ir::run::write_with(context, text, &mut scratch.document, |f| {
        let mut writer = Writer::new(f, Some(0), true);
        let mut write = doc::Write {
            code: &mut |code, out| code::write_code(code, out, &how),
            stack: &stack,
        };
        doc::write(document, &mut writer, &mut write);
        writer.finish();
    })?;
    if stack.ran_out() {
        return Err(FormatError::NestedTooDeeply);
    }
    for (index, message, at) in unformatted.take() {
        if let Some(start) = snipped.start_of_content(index) {
            let place = SyntaxError(Message::UnexpectedToken, start + at);
            let at = place.before_normalizing_end_of_line(without_mark).1;
            scratch.unformatted.push(Unformatted { message, at });
        }
    }
    if original.starts_with(crate::text::BOM) {
        out.extend_from_slice(crate::text::BOM);
    }
    crate::ir::run::print(root, text, &host, &mut scratch.document, out)
}

fn prepared(text: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    bun_core::strings::crlf_as_lf(text.strip_prefix(crate::text::BOM).unwrap_or(text))
}

/// `--debug-check`: whether `after`, which `before` has been formatted to, has all that is in `before` and nothing else. See
/// `verify.rs`.
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
    // The comment that is put in front of it.
    let before = match options.insert_pragma && !print::has_pragma(&before) {
        true => [b"<!-- @format -->\n", &before[..]].concat(),
        false => before.into_owned(),
    };
    let is_kept_in = |after: &[u8]| verify::has_same_content(&before, &prepared(after), parsers);
    if is_kept_in(after) {
        return true;
    }
    if options.sort_imports.is_none() && options.jsdoc.is_none() && options.tailwind.is_none() {
        return false;
    }
    // Two imports of a module can become one, words of a JSDoc comment others, and a class that is there twice is there
    // once. The rest is compared without that.
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
        && is_kept_in(&formatted)
}
