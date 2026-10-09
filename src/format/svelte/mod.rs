//! Svelte: a port of `prettier-plugin-svelte` 4.1.1 and of the parser of Svelte 5.57. See "Svelte" in `../CLAUDE.md`.

mod ast;
mod code;
mod doc;
mod dump;
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
use crate::options::{EmbeddedLanguageFormatting, Flavor, FormatOptions, JavaScriptParser};
use parser::Js;

/// Everything that is allocated to format a text and can be used again for the next one.
#[derive(Default)]
pub struct Scratch {
    document: crate::Scratch,
}

/// For the comparison with `svelte/compiler`: the snipped text, and the tree as JSON or what is thrown.
pub fn tree_for_tests(text: &[u8], parse: crate::options::ParseJavaScript) -> (Vec<u8>, Vec<u8>) {
    let text = text.strip_prefix(crate::text::BOM).unwrap_or(text);
    let text = bun_core::strings::crlf_as_lf(text);
    let snipped = snip::snip(&text);
    let js = &mut js::FromParser {
        parse: Parse::Function(parse),
        is_typescript: false,
    };
    let parsed = parser::parse(&snipped.text, js);
    let tree = match parsed {
        Ok(tree) => dump::dump(&tree),
        Err(error) => format!("{{\"code\":\"{}\",\"at\":{}}}", error.code, error.at).into_bytes(),
    };
    let head = format!(
        "{{\"typescript\":{},\"contents\":{}}}\n",
        snipped.is_typescript,
        snipped.contents.len()
    );
    ([head.as_bytes(), &snipped.text].concat(), tree)
}

/// Appends the formatted text to `out`. `js`: what says where the expressions end.
fn format_with_js(
    path: &[u8],
    original: &[u8],
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
    js: &mut dyn Js,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let text = original.strip_prefix(crate::text::BOM).unwrap_or(original);
    if options.require_pragma && !print::has_pragma(text) {
        out.extend_from_slice(original);
        return Ok(());
    }
    let text = bun_core::strings::crlf_as_lf(text);
    let snipped = snip::snip(&text);
    let tree = parser::parse(&snipped.text, js).map_err(|error| match error.code {
        "nested_too_deeply" => FormatError::NestedTooDeeply,
        _ => FormatError::SyntaxError,
    })?;
    let host = FormatOptions {
        line_ending: options.line_ending.resolve(original),
        filepath: Some(options.filepath.clone().unwrap_or_else(|| path.into())),
        flavor: Flavor::Prettier,
        ..options.clone()
    };
    let svelte = options.svelte;
    let parse = Parse::new(parse_javascript, options);
    let mut tree = tree;
    let sorted = options.tailwind.as_deref().and_then(|it| {
        tailwind::sort(&mut tree, &snipped.text, it, (parse, snipped.is_typescript))
    });
    let text = sorted.as_deref().unwrap_or(&snipped.text);
    let mut expand = |pattern: &[u8]| pattern::expand(parse?, pattern, snipped.is_typescript);
    let printer = print::Printer::new(
        tree,
        (text, &snipped.contents[..]),
        (&host, svelte),
        &mut expand,
    );
    let document = printer.print_root().map_err(|failure| match failure {
        print::Failure::NestedTooDeeply => FormatError::NestedTooDeeply,
        print::Failure::Thrown => FormatError::SyntaxError,
    })?;
    // Without `embed` the plugin knows names and nothing else of JavaScript, and throws for a script and for a style sheet.
    let mut document = document;
    if options.embedded_language_formatting == EmbeddedLanguageFormatting::Off
        && !document.replace_code_by_names()
    {
        return Err(FormatError::SyntaxError);
    }
    let how = code::How {
        options: &host,
        is_typescript: snipped.is_typescript,
        indents_script_and_style: svelte.indents_script_and_style,
        script_flavor: options.flavor,
    };
    let mut context = JsFormatContext::without_file(text, host.clone(), &[]);
    context.parse_javascript = parse_javascript;
    let root = crate::ir::run::write_with(context, text, &mut scratch.document, |f| {
        let mut writer = Writer::new(f, Some(0), true);
        doc::write(document, &mut writer, &mut |code, out| {
            code::write_code(code, out, &how)
        });
        writer.finish();
    })?;
    if original.starts_with(crate::text::BOM) {
        out.extend_from_slice(crate::text::BOM);
    }
    crate::ir::run::print(root, text, &host, &mut scratch.document, out)
}

/// Appends the formatted text to `out`. `parse_javascript`: in the place of `options.parse_javascript`.
pub fn format(
    path: &[u8],
    text: &[u8],
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let Some(parse) = Parse::new(parse_javascript, options) else {
        return Err(FormatError::SyntaxError);
    };
    let js = &mut js::FromParser {
        parse,
        is_typescript: false,
    };
    format_with_js(path, text, options, parse_javascript, js, scratch, out)
}

fn prepared(text: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    bun_core::strings::crlf_as_lf(text.strip_prefix(crate::text::BOM).unwrap_or(text))
}

/// Whether `after`, which `before` has been formatted to, has all that is in `before` and nothing else. See `verify.rs`.
pub fn has_same_content(
    before: &[u8],
    after: &[u8],
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
) -> bool {
    let Some(parse) = Parse::new(parse_javascript, options) else {
        return false;
    };
    let js = || js::FromParser {
        parse,
        is_typescript: false,
    };
    let before = prepared(before);
    // The comment that is put in front of it.
    let before = match options.insert_pragma && !print::has_pragma(&before) {
        true => [b"<!-- @format -->\n", &before[..]].concat(),
        false => before.into_owned(),
    };
    let is_kept_in = |after: &[u8]| {
        verify::has_same_content((&before, &prepared(after)), (&mut js(), &mut js()))
    };
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
