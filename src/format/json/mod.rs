//! JSON, formatted the way Prettier does.
//!
//! Prettier has four parsers for it. All accept what Babel's expression parser accepts, as long as it's made of
//! objects, arrays, literals, `NaN`, `Infinity`, `undefined`, signs and templates without substitutions.
//!
//! - `json`, `jsonc` and `json5` go through the JavaScript printer: an object or an array is on one line if it fits,
//!   and comments are kept.
//! - `json-stringify` prints like `JSON.stringify(value, null, 2)`. It doesn't allow comments.

mod comments;
mod document;
mod parser;
mod range;
mod sort_package_json;
mod writer;

pub use sort_package_json::{Plugin as PackageJsonPlugin, SortPackageJson};

use crate::options::{Expand, Flavor, IndentStyle, QuoteProperties, QuoteStyle};
use crate::syntax_error::{Message, SyntaxError};
use crate::text::BOM;
use crate::{FormatError, FormatOptions};
use bun_lint::paths::file_name;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Parser {
    /// Names are quoted, and there are no trailing commas.
    Json,
    /// Names are quoted. A document with only comments is valid too.
    Jsonc,
    /// Names and strings are quoted according to `quoteProps` and `singleQuote`.
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

/// The parser that Prettier infers from a file name. `None` if it isn't JSON.
pub fn parser_for_path(path: &[u8]) -> Option<Parser> {
    let basename = file_name(path).to_ascii_lowercase();
    let basename = &basename[..];
    if matches!(
        basename,
        b"package.json" | b"package-lock.json" | b"composer.json"
    ) {
        return Some(Parser::JsonStringify);
    }
    // Prettier compares the lowercased name with the extensions as listed, so the ones with an uppercase letter
    // (`.4DForm`, `.4DProject`, `.JSON-tmLanguage`) never match.
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
    EXTENSIONS
        .iter()
        .find(|(extension, _)| basename.ends_with(extension))
        .map(|(_, parser)| *parser)
}

/// The settings derived from the options and the parser.
struct Config {
    parser: Parser,
    flavor: Flavor,
    print_width: u32,
    indent_width: u32,
    indent_style: IndentStyle,
    line_ending: &'static [u8],
    bracket_spacing: bool,
    /// `objectWrap: "preserve"`: an object with a line break after its `{` stays broken.
    preserves_wrap: bool,
    trailing_comma: bool,
    quote_properties: QuoteProperties,
    /// The quotes for all strings. `None` picks whichever needs fewer escapes.
    string_quote: Option<QuoteStyle>,
    /// The quotes for a string that contains as many of one kind as of the other.
    preferred_quote: QuoteStyle,
    /// The quotes added to a name that has none.
    name_quote: QuoteStyle,
    /// How many columns all lines are indented by, when formatting part of a document.
    alignment: u32,
}

impl Config {
    fn new(parser: Parser, options: &FormatOptions, text: &[u8]) -> Config {
        // Prettier's `printString`. `json5` with `quoteProps: "preserve"` is how people asked for JSON with trailing
        // commas before `jsonc` existed.
        let is_double = parser != Parser::Json5
            || (options.quote_properties == QuoteProperties::Preserve
                && options.quote_style.is_double());
        Config {
            parser,
            flavor: options.flavor,
            print_width: options.line_width.value(),
            indent_width: options.indent_width.value(),
            indent_style: options.indent_style,
            line_ending: options.line_ending.resolve(text).as_bytes(),
            bracket_spacing: options.bracket_spacing.value(),
            preserves_wrap: options.expand == Expand::Auto,
            trailing_comma: matches!(parser, Parser::Jsonc | Parser::Json5)
                && !options.trailing_commas.is_none(),
            quote_properties: options.quote_properties,
            string_quote: is_double.then_some(QuoteStyle::Double),
            preferred_quote: options.quote_style,
            name_quote: if is_double {
                QuoteStyle::Double
            } else {
                options.quote_style
            },
            alignment: 0,
        }
    }

    #[inline]
    fn is_stringify(&self) -> bool {
        self.parser == Parser::JsonStringify
    }
}

/// Everything that's allocated to format a document. It's reused for the next one.
#[derive(Default)]
pub struct Scratch {
    tree: parser::Tree,
    frames: writer::Frames,
    attached: Vec<comments::Attached>,
    document_frames: document::Frames,
    storage: crate::ir::formatter::Storage,
    propagate: crate::ir::document::PropagateBuffers,
    printer: crate::ir::printer::PrinterBuffers,
    /// The text with every line break replaced by `\n`, if it has other kinds.
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
    let original = text;
    let config = Config::new(parser, options, text);
    let (bom, text) = match text.strip_prefix(BOM) {
        Some(text) => (BOM, text),
        None => (&[][..], text),
    };

    // To Prettier, every `json` document has a pragma and none has an ignore pragma.
    let mut with_pragma = Vec::new();
    let mut text = text;
    if parser != Parser::Json
        && (options.require_pragma || options.check_ignore_pragma || options.insert_pragma)
    {
        if (options.require_pragma && !crate::pragma::has_pragma(text))
            || (options.check_ignore_pragma && crate::pragma::has_ignore_pragma(text))
        {
            out.extend_from_slice(original);
            return Ok(());
        }
        let is_whole = options.range_start.unwrap_or(0) == 0 && options.range_end.is_none();
        // The `json-stringify` printer can't print a comment.
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
        normalized.clear();
        normalized.reserve(text.len());
        bun_core::strings::push_crlf_as_lf(&mut normalized, text);
    }
    let result = if options.range_start.is_some() || options.range_end.is_some() {
        range::format(
            original,
            if has_carriage_return {
                &normalized
            } else {
                text
            },
            config,
            options,
            scratch,
            out,
        )
    } else {
        // The BOM stays, even if only whitespace follows, which formats to nothing.
        out.extend_from_slice(bom);
        format_normalized(
            if has_carriage_return {
                &normalized
            } else {
                text
            },
            &config,
            options,
            scratch,
            out,
        )
    };
    scratch.normalized = normalized;
    result.map_err(|error| error.before_normalizing_end_of_line(text))
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
    parser::parse(text, config, tree)?;
    // With this parser a comment is a syntax error, so no comment would have to move with a member.
    if config.is_stringify()
        && tree.comments.is_empty()
        && let Some(how) = &options.sort_package_json
        && (options.filepath.as_deref()).is_some_and(|it| file_name(it) == b"package.json")
    {
        sort_package_json::sort(text, tree, how);
    }
    // The writer doesn't mark a line break in a string. See `FormatOptions::is_in_markdown`.
    let has_marks = options.is_in_markdown && bun_core::strings::contains(text, b"\\\n");
    if tree.comments.is_empty() && !has_marks {
        if !tree.nodes.is_empty() {
            writer::write(text, tree, config, frames, out)?;
        }
        return Ok(());
    }
    // Only `jsonc` accepts a document that's only comments.
    if !tree.comments.is_empty()
        && (config.is_stringify() || (tree.nodes.is_empty() && config.parser != Parser::Jsonc))
    {
        return Err(FormatError::SyntaxErrorAt(match config.is_stringify() {
            true => SyntaxError(Message::UnexpectedToken, tree.comments[0].start),
            false => SyntaxError(Message::UnexpectedEnd, text.len() as u32),
        }));
    }
    comments::attach(text, tree, attached);
    let root = document::build(text, tree, attached, config, document_frames, storage);
    crate::ir::document::propagate_expand(root, storage, propagate);
    // `config`'s line ending: the one from the options, or the text's if the options leave it to that.
    let mut printer_options = options.clone();
    printer_options.line_ending = match config.line_ending {
        b"\r\n" => crate::options::LineEnding::Crlf,
        b"\r" => crate::options::LineEnding::Cr,
        _ => crate::options::LineEnding::Lf,
    };
    let printer_options = crate::ir::printer::PrinterOptions::new(&printer_options, text);
    crate::ir::printer::print(root, storage, text, printer_options, printer, out)
        .map_err(FormatError::from)
}
