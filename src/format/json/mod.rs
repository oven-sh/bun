//! JSON, the way Prettier formats it.
//!
//! Prettier has four parsers for it. All take what Babel's expression parser takes, as long as it
//! is made of objects, arrays, literals, `NaN`, `Infinity`, `undefined`, signs and templates
//! without substitutions.
//!
//! - `json`, `jsonc` and `json5` are printed by the printer for JavaScript: an object or an array
//!   is on one line if it fits, comments are kept.
//! - `json-stringify` is printed like `JSON.stringify(value, null, 2)` does. It has no comments.

mod comments;
mod document;
mod parser;
mod range;
mod sort_package_json;
mod writer;

pub use sort_package_json::{SortPackageJson, sort_package_json};

use crate::options::{Expand, IndentStyle, QuoteProperties, QuoteStyle};
use crate::{FormatError, FormatOptions};

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Parser {
    /// Names are quoted, there are no trailing commas.
    Json,
    /// Names are quoted. Nothing but comments is a document too.
    Jsonc,
    /// Names and strings are quoted as `quoteProps` and `singleQuote` say.
    Json5,
    /// `package.json`, `package-lock.json`, `composer.json`
    JsonStringify,
}

impl Parser {
    /// Prettier's `parser` option.
    pub fn from_name(name: &[u8]) -> Option<Parser> {
        match name {
            b"json" => Some(Parser::Json),
            b"jsonc" => Some(Parser::Jsonc),
            b"json5" => Some(Parser::Json5),
            b"json-stringify" => Some(Parser::JsonStringify),
            _ => None,
        }
    }
}

/// The parser that Prettier infers from the name of a file. `None` if it is not JSON.
pub fn parser_for_path(path: &[u8]) -> Option<Parser> {
    use bun_core::strings::last_index_of_char;
    let separator = last_index_of_char(path, b'/').max(last_index_of_char(path, b'\\'));
    let basename = path.get(separator.map_or(0, |at| at + 1)..).unwrap_or_default().to_ascii_lowercase();
    let basename = &basename[..];
    if matches!(basename, b"package.json" | b"package-lock.json" | b"composer.json") {
        return Some(Parser::JsonStringify);
    }
    // Prettier compares the name in lower case with the extensions as they are, so those with an
    // upper case letter (`.4DForm`, `.4DProject`, `.JSON-tmLanguage`) never match.
    const FILENAMES: [&[u8]; 15] = [
        b".all-contributorsrc",
        b".arcconfig",
        b".auto-changelog",
        b".c8rc",
        b".htmlhintrc",
        b".imgbotconfig",
        b".nycrc",
        b".tern-config",
        b".tern-project",
        b".watchmanconfig",
        b".babelrc",
        b".jscsrc",
        b".jshintrc",
        b".jslintrc",
        b".swcrc",
    ];
    const EXTENSIONS: [(&[u8], Parser); 37] = [
        (b".importmap", Parser::JsonStringify),
        (b".json", Parser::Json),
        (b".avsc", Parser::Json),
        (b".geojson", Parser::Json),
        (b".gltf", Parser::Json),
        (b".har", Parser::Json),
        (b".ice", Parser::Json),
        (b".json.example", Parser::Json),
        (b".mcmeta", Parser::Json),
        (b".sarif", Parser::Json),
        (b".slnlaunch", Parser::Json),
        (b".tact", Parser::Json),
        (b".tfstate", Parser::Json),
        (b".tfstate.backup", Parser::Json),
        (b".topojson", Parser::Json),
        (b".webapp", Parser::Json),
        (b".webmanifest", Parser::Json),
        (b".yy", Parser::Json),
        (b".yyp", Parser::Json),
        (b".jsonc", Parser::Jsonc),
        (b".code-snippets", Parser::Jsonc),
        (b".code-workspace", Parser::Jsonc),
        (b".sublime-build", Parser::Jsonc),
        (b".sublime-color-scheme", Parser::Jsonc),
        (b".sublime-commands", Parser::Jsonc),
        (b".sublime-completions", Parser::Jsonc),
        (b".sublime-keymap", Parser::Jsonc),
        (b".sublime-macro", Parser::Jsonc),
        (b".sublime-menu", Parser::Jsonc),
        (b".sublime-mousemap", Parser::Jsonc),
        (b".sublime-project", Parser::Jsonc),
        (b".sublime-settings", Parser::Jsonc),
        (b".sublime-theme", Parser::Jsonc),
        (b".sublime-workspace", Parser::Jsonc),
        (b".sublime_metrics", Parser::Jsonc),
        (b".sublime_session", Parser::Jsonc),
        (b".json5", Parser::Json5),
    ];
    if FILENAMES.contains(&basename) {
        return Some(Parser::Json);
    }
    EXTENSIONS.iter().find(|(extension, _)| basename.ends_with(extension)).map(|(_, parser)| *parser)
}

/// What the options and the parser come down to.
struct Config {
    parser: Parser,
    print_width: u32,
    indent_width: u32,
    indent_style: IndentStyle,
    line_ending: &'static [u8],
    bracket_spacing: bool,
    /// `objectWrap: "preserve"`: an object with a line break after its `{` stays broken.
    preserves_wrap: bool,
    trailing_comma: bool,
    quote_properties: QuoteProperties,
    /// The quotes of all strings. `None`: those that take fewer escapes.
    string_quote: Option<QuoteStyle>,
    /// The quotes of a string that has as many of one kind in it as of the other.
    preferred_quote: QuoteStyle,
    /// The quotes of a name that is written without.
    name_quote: QuoteStyle,
    /// The number of columns that all lines are indented by: what is formatted is a part of a
    /// document.
    alignment: u32,
}

impl Config {
    fn new(parser: Parser, options: &FormatOptions, text: &[u8]) -> Config {
        // Prettier's `printString`. `json5` with `quoteProps: "preserve"` is how JSON with trailing
        // commas was asked for before there was `jsonc`.
        let is_double = parser != Parser::Json5
            || (options.quote_properties == QuoteProperties::Preserve && options.quote_style.is_double());
        Config {
            parser,
            print_width: u32::from(options.line_width.value()),
            indent_width: u32::from(options.indent_width.value()),
            indent_style: options.indent_style,
            line_ending: options.line_ending.resolve(text).as_bytes(),
            bracket_spacing: options.bracket_spacing.value(),
            preserves_wrap: options.expand == Expand::Auto,
            trailing_comma: matches!(parser, Parser::Jsonc | Parser::Json5) && !options.trailing_commas.is_none(),
            quote_properties: options.quote_properties,
            string_quote: is_double.then_some(QuoteStyle::Double),
            preferred_quote: options.quote_style,
            name_quote: if is_double { QuoteStyle::Double } else { options.quote_style },
            alignment: 0,
        }
    }

    #[inline]
    fn is_stringify(&self) -> bool {
        self.parser == Parser::JsonStringify
    }
}

/// Everything that is allocated to format a document. It is reused for the next one.
#[derive(Default)]
pub struct Scratch {
    tree: parser::Tree,
    frames: writer::Frames,
    attached: Vec<comments::Attached>,
    document_frames: document::Frames,
    storage: crate::ir::formatter::Storage,
    propagate: crate::ir::document::PropagateBuffers,
    printer: crate::ir::printer::PrinterBuffers,
    /// The text with `\n` for every line break, if it has others.
    normalized: Vec<u8>,
}

/// Appends the formatted `text` to `out`.
pub fn format(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
    let original = text;
    let config = Config::new(parser, options, text);
    let (bom, text) = match text.strip_prefix(BOM) {
        Some(text) => (BOM, text),
        None => (&[][..], text),
    };

    // For Prettier, every `json` document has a pragma and none has one that says to ignore it.
    let mut with_pragma = Vec::new();
    let mut text = text;
    if parser != Parser::Json && (options.require_pragma || options.check_ignore_pragma || options.insert_pragma) {
        if (options.require_pragma && !crate::pragma::has_pragma(text))
            || (options.check_ignore_pragma && crate::pragma::has_ignore_pragma(text))
        {
            out.extend_from_slice(original);
            return Ok(());
        }
        let is_whole = options.range_start.unwrap_or(0) == 0 && options.range_end.is_none();
        // What writes `json-stringify` cannot write a comment.
        if options.insert_pragma
            && !options.require_pragma
            && is_whole
            && parser != Parser::JsonStringify
            && !crate::pragma::has_pragma(text)
        {
            crate::pragma::insert_pragma(text, &mut with_pragma);
            text = &with_pragma;
        }
    }

    let mut normalized = std::mem::take(&mut scratch.normalized);
    let has_carriage_return = bun_core::strings::contains_char(text, b'\r');
    if has_carriage_return {
        normalize_line_breaks(text, &mut normalized);
    }
    let result = if options.range_start.is_some() || options.range_end.is_some() {
        range::format(original, if has_carriage_return { &normalized } else { text }, config, options, scratch, out)
    } else {
        let start = out.len();
        out.extend_from_slice(bom);
        let result = format_normalized(if has_carriage_return { &normalized } else { text }, &config, options, scratch, out);
        // Nothing but white space is nothing.
        if out.len() == start + bom.len() {
            out.truncate(start);
        }
        result
    };
    scratch.normalized = normalized;
    result
}

/// Prettier's `coreFormat`. `text` has no byte order mark and no `\r`.
fn format_normalized(
    text: &[u8],
    config: &Config,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let Scratch {
        tree,
        frames,
        attached,
        document_frames,
        storage,
        propagate,
        printer,
        ..
    } = scratch;
    parser::parse(text, config, tree).map_err(|_| FormatError::SyntaxError)?;
    if tree.comments.is_empty() {
        if !tree.nodes.is_empty() {
            writer::write(text, tree, config, frames, out);
        }
        return Ok(());
    }
    // Only `jsonc` takes a document that is nothing but comments.
    if config.is_stringify() || (tree.nodes.is_empty() && config.parser != Parser::Jsonc) {
        return Err(FormatError::SyntaxError);
    }
    comments::attach(text, tree, attached);
    let root = document::build(text, tree, attached, config, document_frames, storage);
    crate::ir::document::propagate_expand(root, storage, propagate);
    // The line breaks of `config`: those of the options, or of the text if they leave it to that.
    let mut printer_options = options.clone();
    printer_options.line_ending = match config.line_ending {
        b"\r\n" => crate::options::LineEnding::Crlf,
        b"\r" => crate::options::LineEnding::Cr,
        _ => crate::options::LineEnding::Lf,
    };
    let printer_options = crate::ir::printer::PrinterOptions::new(&printer_options, text);
    crate::ir::printer::print(root, storage, text, printer_options, printer, out)
        .map_err(|_| FormatError::InvalidDocument)
}

/// `\r\n` and `\r` are `\n` in `out`.
fn normalize_line_breaks(text: &[u8], out: &mut Vec<u8>) {
    out.clear();
    out.reserve(text.len());
    let mut rest = text;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\r') {
        out.extend_from_slice(&rest[..at]);
        out.push(b'\n');
        rest = &rest[at + 1..];
        rest = rest.strip_prefix(b"\n").unwrap_or(rest);
    }
    out.extend_from_slice(rest);
}
