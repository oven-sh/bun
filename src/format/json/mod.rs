//! JSON, the way Prettier formats it.
//!
//! Prettier has four parsers for it. All take what Babel's expression parser takes, as long as it
//! is made of objects, arrays, literals, `NaN`, `Infinity`, `undefined`, signs and templates
//! without substitutions.
//!
//! - `json`, `jsonc` and `json5` are printed by the printer for JavaScript: an object or an array
//!   is on one line if it fits, comments are kept.
//! - `json-stringify` is printed like `JSON.stringify(value, null, 2)` does. It has no comments.

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

/// Everything that is allocated to format a document. It is reused for the next one.
#[derive(Default)]
pub struct Scratch {}

/// Appends the formatted `text` to `out`.
pub fn format(
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let _ = (text, parser, options, scratch, out);
    Err(FormatError::SyntaxError)
}
