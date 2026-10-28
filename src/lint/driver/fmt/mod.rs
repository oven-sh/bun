//! `bun fmt`: Prettier's command line, run on all threads.
//!
//! - [`cli`]: the flags.
//! - [`run`]: runs `bun fmt`, given the flags and an [`Environment`].
//! - [`ForRules`]: runs `bun fmt` for the `bun lint` rules that compare a file with its formatted text.

pub mod cli;
mod config;
mod doctor;
mod editorconfig;
mod files;
mod for_rules;
mod prettier;
mod tailwind;

pub(crate) use files::Exclusions;

use crate::doctor::{Modules, watching};
use crate::run::{Environment, Fatal, Outcome, Pool};
use crate::{fs, git, paths};
use bstr::BStr;
use bun_collections::index_sort::sort_slice_by;
use bun_core::strings;
use bun_format::options::{Code, Goal, ParsePart, PartError, Then};
use bun_format::pragma::BeforeParsing;
use bun_format::syntax_error::SyntaxError;
use bun_format::tailwind::Tailwind;
use bun_format::verify::Program;
use bun_format::{FormatError, FormatOptions, Scratch};
use bun_lint::ast::File;
use bun_lint::js_plugin::{HEAVY, Unformatted};
use bun_lint::json::{Notation, parse_as};
use bun_lint::language::{LanguageOptions, ParseOptions, Parser, SourceType};
use bun_lint::linter::TypesInJavaScript;
use bun_lint::utils::text::ends_with_ignore_ascii_case as ends_in;
use bun_sema::atom::{Intern, Interner, InternerPerThread};
use bun_sema::bind::{BindOptions, Recycled, bind, bind_for_format_in, try_bind_for_format_in};
use bun_sema::hir::Diagnostic;
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;
use bun_sema::util::FxHashMap;
use bun_sema_parser::Summary;
use bun_threading::Guarded;
use cli::{LogLevel, Options};
pub(crate) use config::duplicated_mapping_key;
use config::{Configs, Flavor, Resolved};
use files::{Expanded, Ignored, Kind, Language, Target};
pub use for_rules::ForRules;
use std::borrow::Cow;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

const NESTED_TOO_DEEPLY: &[u8] = b"The code is nested too deeply";
const TOO_LONG: &[u8] = b"The formatted code is too long for a string";
const MAKE_IT_A_WARNING: &[u8] = b"\n  Use --allow-unsupported to make this a warning.";

/// An error or warning about a file's text, with its location.
struct Problem {
    message: Vec<u8>,
    at: Option<SourcePosition>,
}

struct SourcePosition {
    line: u32,
    /// 1-based, in UTF-16 code units, like everywhere else in Bun.
    column: u32,
    line_text: Vec<u8>,
}

impl Problem {
    /// A problem with the whole file, so it has no location.
    fn new(message: &[u8]) -> Problem {
        Problem {
            message: message.to_vec(),
            at: None,
        }
    }

    /// For JavaScript and TypeScript, where U+2028 also ends a line. `offset` is the parser's offset.
    #[cold]
    fn in_file(file: &File, message: &[u8], offset: u32) -> Problem {
        let at = file.position(offset);
        Problem {
            message: message.to_vec(),
            at: Some(SourcePosition {
                line: at.line,
                column: at.column + 1,
                line_text: file.line_text(at.line).to_vec(),
            }),
        }
    }

    /// For every other language. `offset` is a byte offset in `text`, not counting a byte order mark.
    #[cold]
    fn at(text: &[u8], message: &[u8], offset: u32) -> Problem {
        PositionFinder::new(text).problem(message, offset)
    }

    /// Prints it like every other Bun error: the line, a caret, the message and the location.
    fn print(&self, display_name: &[u8], kind: bun_ast::Kind, colors: bool) -> Vec<u8> {
        let message = bun_ast::Msg {
            kind,
            data: bun_ast::Data {
                text: self.message.clone().into(),
                location: Some(bun_ast::Location {
                    file: display_name.to_vec().into(),
                    line: self.at.as_ref().map_or(-1, |it| it.line as i32),
                    column: self.at.as_ref().map_or(-1, |it| it.column as i32),
                    line_text: self.at.as_ref().map(|it| it.line_text.clone().into()),
                    ..Default::default()
                }),
            },
            ..Default::default()
        };
        let mut printed = String::new();
        let _ = match colors {
            true => message.write_format::<true>(&mut printed),
            false => message.write_format::<false>(&mut printed),
        };
        printed.push_str("\n\n");
        printed.into_bytes()
    }
}

/// Converts offsets in a text to lines and columns. Offsets requested in ascending order cost one pass over the text in
/// total. A line's text is attached only to the first problem on it, so the output can't grow beyond the text plus the
/// messages.
struct PositionFinder<'a> {
    text: &'a [u8],
    line: u32,
    line_start: usize,
    /// Line breaks have been searched for up to this offset.
    searched: usize,
    /// The offset the current line has been measured up to, and its length so far in UTF-16 code units.
    measured: (usize, u32),
    /// The last line whose text was shown.
    last_shown_line: u32,
}

impl<'a> PositionFinder<'a> {
    fn new(text: &'a [u8]) -> PositionFinder<'a> {
        PositionFinder {
            text: strings::without_utf8_bom(text),
            line: 1,
            line_start: 0,
            searched: 0,
            measured: (0, 0),
            last_shown_line: 0,
        }
    }

    /// `offset` is a byte offset in the text, not counting a byte order mark.
    fn problem(&mut self, message: &[u8], offset: u32) -> Problem {
        let (text, end) = (self.text, self.text.len().min(offset as usize));
        if end < self.searched {
            *self = PositionFinder::new(text);
        }
        while let Some(found) = strings::index_of_any(&text[self.searched..end], b"\n\r") {
            self.searched += found + 1;
            // In `\r\n`, the `\n` ends the line.
            if text[self.searched - 1] == b'\n' || text.get(self.searched) != Some(&b'\n') {
                (self.line, self.line_start) = (self.line + 1, self.searched);
                self.measured = (self.searched, 0);
            }
        }
        self.searched = end;
        let more = strings::utf8_decoded_len_utf16(&text[self.measured.0..end]) as u32;
        self.measured = (end, self.measured.1 + more);
        let line_text = match std::mem::replace(&mut self.last_shown_line, self.line) == self.line {
            true => &[][..],
            false => {
                let rest = &text[self.line_start..];
                &rest[..strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len())]
            }
        };
        Problem {
            message: message.to_vec(),
            at: Some(SourcePosition {
                line: self.line,
                column: self.measured.1 + 1,
                line_text: line_text.to_vec(),
            }),
        }
    }
}

/// Why a file wasn't formatted.
enum Failure {
    Syntax(Problem),
    /// A formatter bug: it couldn't print the file.
    Bug,
    /// `--debug-check` found that the formatted output doesn't mean the same as the file.
    Changed(&'static str),
    /// TOML that can't be parsed, with the error. oxfmt silently skips such a file, so it isn't an error.
    Unread(Problem),
}

/// The error for the file `display_name` when Tailwind was asked and some class orders are still unknown.
fn unknown_class_order_error(display_name: &[u8]) -> Vec<u8> {
    let what = b": sortTailwindcss could not find the order of some classes.";
    [display_name, what].concat()
}

/// Returns `.svelte` for `src/a.svelte`, or the whole file name if it has no extension.
pub(crate) fn extension_or_name(path: &[u8]) -> &[u8] {
    let name = paths::basename(path);
    strings::last_index_of_char(name, b'.').map_or(name, |dot| &name[dot..])
}

/// Prettier's message for an unknown parser.
fn cannot_resolve_parser(parser: &[u8]) -> Vec<u8> {
    [b"Couldn't resolve parser \"", parser, b"\"."].concat()
}

/// The error for passing `--parser` together with a directory.
fn cannot_force_parser_on(directory_argument: &[u8], parser: &[u8]) -> Vec<u8> {
    let extension: Option<&[u8]> = match parser {
        b"typescript" | b"babel-ts" | b"oxc-ts" => Some(b"ts"),
        b"markdown" | b"remark" => Some(b"md"),
        b"glimmer" => Some(b"hbs"),
        b"json-stringify" => Some(b"json"),
        b"angular" | b"lwc" => Some(b"html"),
        _ if parser.starts_with(b"__") => None,
        _ if Kind::from_parser(parser) == Some(Kind::Script) => Some(b"js"),
        // The other parsers are named after their extension: css, json5, yaml, vue, graphql.
        _ => Some(parser),
    };
    let mut text = [b"--parser ", parser, b" would read every file in \""].concat();
    text.extend_from_slice(&[directory_argument, b"\" as ", parser].concat());
    let Some(extension) = extension else {
        text.extend_from_slice(b"\n  Name the files, or use a glob.");
        return text;
    };
    let directory = paths::from_native(directory_argument);
    let directory = directory.strip_suffix(b"/").unwrap_or(&directory);
    let base = match directory {
        b"." | b"" => Vec::new(),
        _ => [directory, b"/"].concat(),
    };
    text.extend_from_slice(b"\n  Name the files, or use a glob: bun fmt --parser ");
    text.extend_from_slice(&[parser, b" \"", &base, b"**/*.", extension, b"\""].concat());
    text
}

/// Reads all of standard input. `Err` is the message to print.
fn read_stdin() -> Result<Vec<u8>, Vec<u8>> {
    fs::read_stdin()
        .map_err(|error| [&b"Cannot read standard input: "[..], &fs::describe(&error)].concat())
}

/// Code from standard input.
struct Piped<'p> {
    text: Vec<u8>,
    /// Its name in error messages.
    display_name: &'p [u8],
    /// The file names to parse it as. The first one that parses wins.
    paths: &'p [&'p [u8]],
}

/// [`Piped::paths`] for code that has no file name. These only tell the parser which syntax to expect. No config ever
/// sees them. Prettier's TypeScript parsers use the extension to decide whether JSX is allowed, and try both without
/// one.
fn syntaxes_to_try(parser: &[u8], text: &[u8]) -> &'static [&'static [u8]] {
    match parser {
        b"typescript" | b"oxc-ts" if !bun_format::html::is_probably_jsx(text) => {
            &[b"stdin.ts", b"stdin.tsx"]
        }
        b"typescript" | b"oxc-ts" | b"babel-ts" => &[b"stdin.tsx", b"stdin.ts"],
        _ if Kind::from_parser(parser) == Some(Kind::Script) => &[b"stdin.js"],
        _ => &[b""],
    }
}

/// The `is_script` values to parse the file at `path` with, in order, until one parses without errors. Like Prettier's
/// parsers, it tries a module first, then a script.
fn script_modes(path: &[u8]) -> &'static [bool] {
    match path {
        _ if ends_in(path, b".mjs") || ends_in(path, b".mts") => &[false],
        _ if ends_in(path, b".cjs") || ends_in(path, b".cts") => &[true],
        _ => &[false, true],
    }
}

/// How a file is parsed and formatted.
#[derive(Copy, Clone)]
struct How<'h> {
    path: &'h [u8],
    is_script: bool,
    /// Parse it as Flow.
    is_flow: bool,
    resolved: &'h Resolved,
    verifies: bool,
    /// Interns the names in a file with syntax errors. They're freed when the run ends.
    atoms: &'h dyn Intern,
    /// Allocations shared by all files, freed when the run ends.
    memory: &'h Session,
}

impl How<'_> {
    /// Returns the language, dialect and parse options for the file.
    fn language_and_dialect(&self) -> (LanguageOptions, Dialect, ParseOptions) {
        let path = self.path;
        let is_typescript = [&b".ts"[..], b".tsx", b".mts", b".cts"]
            .iter()
            .any(|it| ends_in(path, it));
        let is_oxfmt = self.resolved.options.flavor.is_oxfmt();
        let language = LanguageOptions {
            // oxfmt uses oxc's parser, like oxlint.
            rejects_what_parser_rejects: !is_oxfmt,
            parser: if is_typescript {
                Parser::TypeScript
            } else {
                Parser::Espree
            },
            source_type: if self.is_script {
                SourceType::Script
            } else {
                SourceType::Module
            },
            ..LanguageOptions::default()
        };
        let options = language.parse_options(path);
        let dialect = match self.is_flow {
            true if bun_format::flow::is_parsed_by_babel_flow(&self.resolved.options, path) => {
                Dialect::flow(self.is_script)
            }
            true => Dialect::flow_parser(self.is_script),
            false if is_oxfmt => options.dialect,
            false => Dialect::babel(self.is_script),
        };
        (language, dialect, options)
    }
}

/// Parses `text` and calls `then` with the tree and the interner that owns its names.
fn with_tree<'h, R>(
    how: &How<'h>,
    text: &[u8],
    then: impl FnOnce(Summary<'_, 'h>, &dyn Intern, &LanguageOptions) -> R,
) -> R {
    let (language, dialect, options) = how.language_and_dialect();
    bun_sema_parser::with_summary_in_place(
        dialect,
        (how.memory.arena(), how.memory),
        how.path,
        options.script_kind,
        text,
        how.atoms.for_current_thread(),
        options.experimental_decorators,
        options.every_file_is_a_module,
        true,
        // These atoms are local to the file and mean nothing in another file.
        |summary, atoms| then(summary, atoms, &language),
    )
}

/// Parses `text` and calls `then` with the file, its tree if `how.verifies`, and its first error.
fn with_file<R>(
    how: &How,
    text: &[u8],
    then: impl for<'a> FnOnce(&'a File<'a>, Option<&Program<'a>>, ParseErrors<'a>) -> R,
) -> R {
    let (path, session) = (how.path, how.memory);
    let arena = session.arena();
    with_tree(how, text, |mut summary, atoms, language| {
        // Telling which imports are used needs symbols.
        let needs_symbols = how
            .resolved
            .options
            .sort_imports
            .as_deref()
            .is_some_and(|it| it.needs_symbols());
        let mut recycled = Recycled::for_current_thread();
        // Use the tree in place, where the parser built it, if that's enough.
        if !needs_symbols
            && let Summary::InPlace(hir) = &mut summary
            && let Some(bound) = try_bind_for_format_in(&**hir, &mut recycled)
        {
            let file = File::new(path, &**hir, bound, atoms, language, None).with_text(text);
            let program = how.verifies.then(|| Program::new(&**hir, text, atoms));
            return then(
                &file,
                program.as_ref(),
                ParseErrors {
                    first_error: hir.diagnostics.first(),
                    is_nested_too_deeply: hir.ran_out_of_stack,
                },
            );
        }
        let mut hir = summary.into_arena((arena, session));
        hir.text = Cow::Borrowed(text);
        let bind_options = BindOptions {
            emit_standard_class_fields: true,
            before_es2020: false,
            before_es2017: false,
            runtime: None,
        };
        let program = how.verifies.then(|| Program::new(&hir, text, atoms));
        if needs_symbols {
            let bound = bind(&hir, bind_options, atoms, arena);
            return then(
                &File::new(path, &hir, &bound, atoms, language, None),
                program.as_ref(),
                ParseErrors {
                    first_error: hir.diagnostics.first(),
                    is_nested_too_deeply: hir.ran_out_of_stack || bound.ran_out_of_stack,
                },
            );
        }
        let bound = bind_for_format_in(&hir, bind_options, atoms, &mut recycled);
        then(
            &File::new(path, &hir, bound, atoms, language, None),
            program.as_ref(),
            ParseErrors {
                first_error: hir.diagnostics.first(),
                is_nested_too_deeply: hir.ran_out_of_stack || bound.ran_out_of_stack,
            },
        )
    })
}

/// The parser's and binder's errors for a file.
#[derive(Copy, Clone)]
struct ParseErrors<'a> {
    first_error: Option<&'a Diagnostic>,
    /// The stack ran out, so nothing else is known about the file.
    is_nested_too_deeply: bool,
}

fn syntax_error(file: &File, first: Option<&Diagnostic>) -> Problem {
    let mut message = Vec::new();
    match first.and_then(|it| Some((it, bun_sema::messages::message(it.code)?.1))) {
        Some((diagnostic, text)) => {
            bun_sema::messages::format(&mut message, text, &diagnostic.args)
        }
        None => message.extend_from_slice(b"Unexpected token"),
    }
    Problem::in_file(file, &message, first.map_or(0, |it| it.start))
}

/// For code that isn't JavaScript or TypeScript.
#[cold]
fn syntax_error_at(text: &[u8], SyntaxError(message, offset): SyntaxError) -> Problem {
    Problem::at(text, message.text().as_bytes(), offset)
}

/// Buffers allocated while formatting a file and reused for the next one.
#[derive(Default)]
struct Scratches {
    js: Scratch,
    json: bun_format::json::Scratch,
    css: bun_format::css::Scratch,
    graphql: bun_format::graphql::Scratch,
    handlebars: bun_format::handlebars::Scratch,
    html: bun_format::html::Scratch,
    svelte: bun_format::svelte::Scratch,
    yaml: bun_format::yaml::Scratch,
    markdown: bun_format::markdown::Scratch,
    verify: bun_format::verify::Scratch,
    /// For code blocks in Markdown.
    blocks: Option<Box<Scratches>>,
    /// Warnings about the last formatted file. They don't stop it from being formatted.
    warnings: Vec<Problem>,
}

fn without_final_newline(out: &mut Vec<u8>) {
    let end = match &out[..] {
        [rest @ .., b'\r', b'\n'] | [rest @ .., b'\n' | b'\r'] => rest.len(),
        _ => out.len(),
    };
    out.truncate(end);
}

/// Formats a code block in Markdown. Appends `code`, formatted as if it were the file at `path`. Returns `false` if it
/// can't be formatted, so the block stays unchanged.
fn format_block(path: &[u8], code: &[u8], options: &FormatOptions, out: &mut Vec<u8>) -> bool {
    let names = Session::new();
    let names = (&Interner::new_in(&names) as &dyn Intern, &names);
    format_block_in(path, code, options, out, names, &mut Scratches::default())
}

/// Same, with an interner and scratch buffers that the caller reuses across blocks.
fn format_block_in(
    path: &[u8],
    code: &[u8],
    options: &FormatOptions,
    out: &mut Vec<u8>,
    names: (&dyn Intern, &Session),
    scratch: &mut Scratches,
) -> bool {
    let sort_imports = options.sort_imports.clone();
    let resolved = Resolved {
        options: FormatOptions {
            sort_imports: sort_imports.filter(|it| it.applies_to_embedded_code()),
            ..options.clone()
        },
        ..Resolved::default()
    };
    let formatted = format(path, code, &resolved, names, scratch, false);
    formatted
        .map(|(formatted, _)| out.extend_from_slice(&formatted))
        .is_ok()
}

/// Parses scripts and expressions in HTML.
fn parse_javascript(code: Code<'_>, then: Then<'_>) {
    let names = Session::new();
    let names = (&Interner::new_in(&names) as &dyn Intern, &names);
    parse_code(code, &Resolved::default(), names, then);
}

fn parse_code(
    code: Code<'_>,
    resolved: &Resolved,
    (atoms, memory): (&dyn Intern, &Session),
    then: Then<'_>,
) {
    let how = How {
        path: code.path,
        is_script: code.is_script,
        is_flow: false,
        resolved,
        verifies: false,
        atoms,
        memory,
    };
    with_file(&how, code.text, |file, _, _| then(file));
}

/// Parses the expressions in a Svelte component.
fn parse_parts(text: &[u8], then: &mut dyn FnMut(ParsePart<'_>)) {
    let names = Session::new();
    let (atoms, plain) = (Interner::new_in(&names), Resolved::default());
    let how = |path| How {
        path,
        is_script: false,
        is_flow: false,
        resolved: &plain,
        verifies: false,
        atoms: &atoms,
        memory: &names,
    };
    let [javascript, typescript] =
        [&b"dummy.js"[..], b"dummy.ts"].map(|path| (path, how(path).language_and_dialect()));
    let mut parts = bun_sema_parser::Parts::of(text);
    then(&mut |part, then| {
        let (path, (language, dialect, _)) = match part.is_typescript {
            true => &typescript,
            false => &javascript,
        };
        let part = bun_sema_parser::Part {
            goal: match part.goal {
                Goal::Expression => bun_sema_parser::Goal::Expression,
                Goal::Declaration => bun_sema_parser::Goal::Declaration,
                Goal::Type => bun_sema_parser::Goal::Type,
            },
            from: part.from,
            until: part.until,
        };
        let is_javascript = language.parser != Parser::TypeScript;
        let is_bound = parts.parse(
            *dialect,
            is_javascript,
            part,
            |summary, atoms, code, end| {
                let mut recycled = Recycled::for_current_thread();
                let Summary::InPlace(hir) = summary else {
                    return false;
                };
                let Some(bound) = try_bind_for_format_in(&*hir, &mut recycled) else {
                    return false;
                };
                then(
                    &File::new(path, &*hir, bound, atoms, language, None).with_text(code),
                    end,
                );
                true
            },
        );
        match is_bound {
            Ok(true) => Ok(()),
            // The stack ran out there.
            Ok(false) => Err(PartError {
                at: part.from,
                is_nested_too_deeply: true,
            }),
            Err(error) => Err(PartError {
                at: error.at,
                is_nested_too_deeply: error.is_too_deep,
            }),
        }
    });
}

/// True if both texts parse to the same value. Also true if `before` can't be read as a value, so there's nothing to
/// compare: TOML with a duplicate key, YAML with an alias to a node that contains it.
fn is_same_value(notation: Notation, before: &[u8], after: &[u8]) -> bool {
    match parse_as(notation, before) {
        Ok(before) => parse_as(notation, after).is_ok_and(|after| after == before),
        Err(_) => true,
    }
}

/// The formatted text, and the cursor's new offset if `cursorOffset` was set.
type Formatted = (Vec<u8>, Option<u32>);

/// Formats the file at `path`. With `verifies`, the output is parsed and compared with `text`.
fn format(
    path: &[u8],
    text: &[u8],
    resolved: &Resolved,
    (atoms, memory): (&dyn Intern, &Session),
    scratch: &mut Scratches,
    verifies: bool,
) -> Result<Formatted, Failure> {
    let options = &resolved.options;
    scratch.warnings.clear();
    // Windows PowerShell's `>` writes UTF-16. Some parsers would read it as UTF-8 with a NUL next to every letter.
    if matches!(text, [0xFF, 0xFE, ..] | [0xFE, 0xFF, ..]) {
        return Err(Failure::Syntax(Problem::new(
            b"This file is UTF-16. bun fmt only reads UTF-8",
        )));
    }
    // `name` decides the kind of file. `path` decides whether it's TypeScript.
    let name = options
        .filepath
        .as_deref()
        .filter(|it| !it.is_empty())
        .unwrap_or(path);
    let finish = |done: Result<(), FormatError>, mut out: Vec<u8>, what: &str| match done {
        Ok(()) => {
            if resolved.omits_final_newline {
                without_final_newline(&mut out);
            }
            let cursor = bun_format::cursor::cursor_in_formatted_text(text, options, &out);
            Ok((out, cursor))
        }
        Err(FormatError::SyntaxError) => Err(Failure::Syntax(Problem::new(
            format!("This is not valid {what}").as_bytes(),
        ))),
        Err(FormatError::SyntaxErrorAt(error)) => {
            Err(Failure::Syntax(syntax_error_at(text, error)))
        }
        Err(FormatError::NestedTooDeeply) => Err(Failure::Syntax(Problem::new(NESTED_TOO_DEEPLY))),
        Err(FormatError::TooLong) => Err(Failure::Syntax(Problem::new(TOO_LONG))),
        Err(FormatError::InvalidDocument) => Err(Failure::Bug),
    };
    let mut out = Vec::new();
    let kind = Kind::with_options(name, options);
    if let (None, Some(parser)) = (kind, &options.parser) {
        return Err(Failure::Syntax(Problem::new(&cannot_resolve_parser(
            parser,
        ))));
    }
    match kind {
        Some(Kind::Script) | None => {}
        Some(Kind::Json(parser)) => {
            let done = bun_format::json::format(text, parser, options, &mut scratch.json, &mut out);
            return finish(done, out, "JSON");
        }
        Some(Kind::Css(parser)) => {
            let done = bun_format::css::format(text, parser, options, &mut scratch.css, &mut out);
            return finish(done, out, "CSS");
        }
        Some(Kind::Yaml) => {
            let done = bun_format::yaml::format(text, options, &mut scratch.yaml, &mut out);
            if verifies && done.is_ok() && out != text && !is_same_value(Notation::Yaml, text, &out)
            {
                return Err(Failure::Changed("formatting would change its contents"));
            }
            return finish(done, out, "YAML");
        }
        Some(kind @ (Kind::Markdown | Kind::Mdx)) => {
            let mut blocks = scratch.blocks.take().unwrap_or_default();
            let mut format_block =
                |path: &[u8], code: &[u8], options: &FormatOptions, out: &mut Vec<u8>| {
                    let names = (atoms, memory);
                    format_block_in(path, code, options, out, names, &mut blocks)
                };
            let format_block: Option<&mut bun_format::markdown::FormatBlock<'_>> =
                Some(&mut format_block);
            let markdown = &mut scratch.markdown;
            let (done, what) = match kind {
                Kind::Mdx => (
                    bun_format::markdown::format_mdx_with(
                        text,
                        options,
                        markdown,
                        &mut out,
                        format_block,
                    ),
                    "MDX",
                ),
                _ => (
                    bun_format::markdown::format_with(
                        text,
                        options,
                        markdown,
                        &mut out,
                        format_block,
                    ),
                    "Markdown",
                ),
            };
            scratch.blocks = Some(blocks);
            return finish(done, out, what);
        }
        Some(Kind::GraphQl) => {
            let done = bun_format::graphql::format(text, options, &mut scratch.graphql, &mut out);
            return finish(done, out, "GraphQL");
        }
        Some(Kind::Toml) => {
            let done = bun_format::toml::format(text, options, &mut out);
            if done == Err(FormatError::SyntaxError)
                && let Some((message, offset)) = bun_format::toml::syntax_error(text)
            {
                let error = Problem::at(text, &message, offset);
                return Err(match options.flavor.is_oxfmt() {
                    true => Failure::Unread(error),
                    false => Failure::Syntax(error),
                });
            }
            if verifies && done.is_ok() && out != text && !is_same_value(Notation::Toml, text, &out)
            {
                return Err(Failure::Changed("formatting would change its contents"));
            }
            return finish(done, out, "TOML");
        }
        Some(Kind::Svelte) => {
            let plain = Resolved::default();
            let parse = |code: Code<'_>, then: Then<'_>| {
                parse_code(code, &plain, (atoms, memory), then);
            };
            let parse = Some(&parse as bun_format::options::JavaScriptParser<'_>);
            let done = bun_format::svelte::format(
                name,
                text,
                options,
                parse,
                &mut scratch.svelte,
                &mut out,
            );
            if verifies
                && done.is_ok()
                && out != text
                && !bun_format::svelte::has_same_content(text, &out, options, parse)
            {
                return Err(Failure::Changed("formatting would change its contents"));
            }
            let mut positions = PositionFinder::new(text);
            scratch.warnings = (scratch.svelte.unformatted().iter())
                .map(|it| positions.problem(&it.message, it.at))
                .collect();
            return finish(done, out, "Svelte");
        }
        Some(Kind::Handlebars) => {
            let done =
                bun_format::handlebars::format(text, options, &mut scratch.handlebars, &mut out);
            if verifies && done.is_ok() && out != text {
                match bun_format::handlebars::has_same_meaning(text, &out, options) {
                    Ok(true) => {}
                    Ok(false) => {
                        return Err(Failure::Changed("formatting would change its meaning"));
                    }
                    Err(error) => return finish(Err(error), out, "Handlebars"),
                }
            }
            return finish(done, out, "Handlebars");
        }
        Some(Kind::Html(parser)) => {
            let plain = Resolved::default();
            let parse = |code: Code<'_>, then: Then<'_>| {
                parse_code(code, &plain, (atoms, memory), then);
            };
            let done = bun_format::html::format_with(
                name,
                text,
                parser,
                options,
                Some(&parse),
                &mut scratch.html,
                &mut out,
            );
            if verifies
                && done.is_ok()
                && out != text
                && !bun_format::html::has_same_content(text, &out, parser, options)
            {
                return Err(Failure::Changed(
                    "formatting like Prettier would change its contents",
                ));
            }
            if matches!(done, Err(FormatError::SyntaxError))
                && let Some((message, offset)) = bun_format::html::syntax_error(text, parser)
            {
                return Err(Failure::Syntax(Problem::at(text, &message, offset)));
            }
            let cursor = done.as_ref().ok().copied().flatten();
            return finish(done.map(|_| ()), out, "HTML").map(|(out, _)| (out, cursor));
        }
    }
    let text = match bun_format::pragma::before_parsing(text, options) {
        BeforeParsing::LeaveUnchanged => return Ok((text.to_vec(), options.cursor_offset)),
        BeforeParsing::Format(text) => text,
    };
    // `babel` hands a Flow file to `babel-flow`, which reads the contents of `/*:: */` and `/*: */` as code.
    let is_flow = match options.parser.as_deref() {
        Some(b"flow" | b"babel-flow") => true,
        // oxfmt doesn't parse Flow.
        Some(b"babel") | None => {
            !options.flavor.is_oxfmt()
                && (bun_lint::linter::is_flow_file(&text, name)
                    || (options.parser.is_none() && ends_in(name, b".js.flow")))
        }
        Some(_) => false,
    };
    let has_comment_types = is_flow
        && bun_format::flow::is_parsed_by_babel_flow(options, path)
        && bun_format::flow::may_have_comment_types(&text);
    let text = match has_comment_types {
        true => {
            let how = How {
                path,
                is_script: false,
                is_flow,
                resolved,
                verifies: false,
                atoms,
                memory,
            };
            with_file(&how, &text, |file, _, _| {
                bun_format::flow::uncommented(file)
            })
            .map_or(text, Cow::Owned)
        }
        false => text,
    };
    let mut first_failure = None;
    for &is_script in script_modes(name) {
        let how = How {
            path,
            is_script,
            is_flow,
            resolved,
            verifies,
            atoms,
            memory,
        };
        match format_as(&how, &text, scratch) {
            Err(failure @ Failure::Syntax(_)) => _ = first_failure.get_or_insert(failure),
            done => return done,
        }
    }
    Err(first_failure.unwrap_or(Failure::Bug))
}

fn print<'a>(
    (file, program): (&'a File<'a>, Option<&Program<'a>>),
    parse_errors: ParseErrors<'_>,
    how: &How,
    scratch: &mut Scratches,
) -> Result<Formatted, Failure> {
    if parse_errors.is_nested_too_deeply {
        return Err(Failure::Syntax(Problem::new(NESTED_TOO_DEEPLY)));
    }
    let options = &how.resolved.options;
    // `babel` rejects TypeScript syntax. The parsers that accept it have to be selected by name.
    let accepts_types = matches!(
        options.parser.as_deref(),
        Some(b"flow" | b"babel-flow" | b"typescript" | b"babel-ts")
    );
    let types = match accepts_types {
        true => TypesInJavaScript::Tolerated,
        false => TypesInJavaScript::Rejected,
    };
    let rejection = match options.flavor.is_oxfmt() {
        true if how.resolved.formats_recoverable_errors && !file.has_parse_errors() => None,
        true => bun_lint::linter::oxfmt_rejection(file),
        false => bun_lint::linter::prettier_rejection(file, types),
    };
    if let Some(why) = rejection {
        return Err(Failure::Syntax(Problem::in_file(
            file,
            &why.message,
            why.at,
        )));
    }
    let mut out = Vec::new();
    let parse = |part: &[u8], then: &mut dyn for<'b> FnMut(&'b File<'b>)| {
        with_file(how, part, |file, _, _| then(file))
    };
    let cursor = match bun_format::range::format_with_cursor(
        file,
        options,
        &mut scratch.js,
        &mut out,
        parse,
    ) {
        Ok(cursor) => cursor,
        Err(FormatError::SyntaxError) => {
            return Err(Failure::Syntax(syntax_error(
                file,
                parse_errors.first_error,
            )));
        }
        Err(FormatError::SyntaxErrorAt(error)) => {
            return Err(Failure::Syntax(syntax_error_at(file.text(), error)));
        }
        Err(FormatError::NestedTooDeeply) => {
            return Err(Failure::Syntax(Problem::new(NESTED_TOO_DEEPLY)));
        }
        Err(FormatError::TooLong) => return Err(Failure::Syntax(Problem::new(TOO_LONG))),
        Err(FormatError::InvalidDocument) => return Err(Failure::Bug),
    };
    if how.resolved.omits_final_newline {
        without_final_newline(&mut out);
    }
    if let Some(program) = program
        && out != file.text()
    {
        let is_same = with_tree(how, &out, |after, atoms, _| {
            // The parser recovers from errors, so the tree can be the same even then: `a\n=> b`.
            let (has_parse_errors, after) = match &after {
                Summary::InPlace(hir) => (
                    hir.has_errors || hir.has_parse_diagnostics,
                    Program::new(&**hir, &out, atoms),
                ),
                Summary::InArena(hir) => (
                    hir.has_errors || hir.has_parse_diagnostics,
                    Program::new(&**hir, &out, atoms),
                ),
            };
            !has_parse_errors
                && bun_format::verify::compare(file, program, &after, options, &mut scratch.verify)
                    .is_ok()
        });
        if !is_same {
            return Err(Failure::Changed(
                "formatting would change what the code does",
            ));
        }
    }
    Ok((out, cursor))
}

fn format_as(how: &How, text: &[u8], scratch: &mut Scratches) -> Result<Formatted, Failure> {
    with_file(how, text, |file, program, parse_errors| {
        if parse_errors.is_nested_too_deeply {
            return Err(Failure::Syntax(Problem::new(NESTED_TOO_DEEPLY)));
        }
        // If sorting moves imports, the file is parsed again.
        let how_to_sort = how.resolved.options.sort_imports.as_deref();
        match how_to_sort.and_then(|how| bun_format::sort_imports::sorted_text(file, how)) {
            Some(sorted) => with_file(how, &sorted, |after, program, parse_errors| {
                if how.verifies && !how_to_sort.is_some_and(|it| it.keeps_imports(file, after)) {
                    return Err(Failure::Changed(
                        "sorting imports would change what the code does",
                    ));
                }
                print((after, program), parse_errors, how, scratch)
            }),
            None => print((file, program), parse_errors, how, scratch),
        }
    })
}

/// Why `bun fmt` didn't format a file.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum FormatFailure {
    /// It has a syntax error or is nested too deeply.
    Syntax,
    /// A formatter bug that the formatter detected itself.
    Bug,
}

/// Formats the file at `path` with `options` the way `bun fmt` does. Returns the text and the cursor's new offset. For
/// the formatter's tests.
pub fn format_for_tests(
    path: &[u8],
    text: &[u8],
    options: &FormatOptions,
) -> Result<(Vec<u8>, Option<u32>), FormatFailure> {
    let resolved = Resolved {
        options: FormatOptions {
            format_javascript: Some(format_block),
            parse_javascript: Some(parse_javascript),
            parse_parts: Some(parse_parts),
            ..options.clone()
        },
        formats_recoverable_errors: true,
        ..Resolved::default()
    };
    let names = Session::new();
    format(
        path,
        text,
        &resolved,
        (&Interner::new_in(&names), &names),
        &mut Scratches::default(),
        false,
    )
    .map_err(|failure| match failure {
        Failure::Syntax(_) | Failure::Unread(_) => FormatFailure::Syntax,
        Failure::Bug | Failure::Changed(_) => FormatFailure::Bug,
    })
}

/// Returns one line per comment in the file at `path`, with the node that owns it. With `only_unprinted`, lists only
/// the comments that no printer printed. `None` if the file has a syntax error.
pub fn debug_comments(
    path: &[u8],
    text: &[u8],
    only_unprinted: bool,
    is_oxfmt: bool,
) -> Option<Vec<u8>> {
    let options = FormatOptions {
        flavor: match is_oxfmt {
            true => bun_format::options::Flavor::Oxfmt,
            false => bun_format::options::Flavor::Prettier,
        },
        debug_comments: match only_unprinted {
            true => bun_format::options::DebugComments::Unprinted,
            false => bun_format::options::DebugComments::Owners,
        },
        ..FormatOptions::default()
    };
    Some(format_for_tests(path, text, &options).ok()?.0)
}

/// Runs the `--debug-check` comparison on the Svelte component `before` and its formatted text `after`. True if both
/// have the same content. Lets tests feed the check bad output, which the formatter itself never produces.
pub fn is_same_svelte_for_tests(before: &[u8], after: &[u8]) -> bool {
    let options = FormatOptions {
        parse_javascript: Some(parse_javascript),
        parse_parts: Some(parse_parts),
        ..FormatOptions::default()
    };
    bun_format::svelte::has_same_content(before, after, &options, None)
}

/// The error message for the file at `path`, whose language is unknown.
fn has_no_parser(configs: &Configs, path: Vec<u8>) -> Vec<u8> {
    let is_off = configs.requests_svelte_parser() && configs.turns_svelte_off_for(&path);
    let reason: &[u8] = match is_off {
        true => b"Cannot use --parser svelte, because Svelte is off for \"",
        false => b"No parser could be inferred for file \"",
    };
    [reason, &paths::to_native(path)[..], b"\"."].concat()
}

/// The result for one file.
enum Done {
    Unchanged,
    /// It isn't formatted, or wasn't until this run wrote it. Holds how long that took.
    Different(Duration),
    /// Skipped: neither formatted nor written. See [`git::Files::is_partly_staged`].
    PartlyStaged,
    /// It has Tailwind CSS classes whose order isn't known yet.
    Deferred,
    /// A message to print. The exit code is 2.
    Failed(Vec<u8>),
    /// Also exits with 2.
    NotFormatted(Failure),
}

struct Run<'r> {
    options: &'r Options,
    environment: &'r Environment<'r>,
    out: Outcome,
    began: Instant,
    /// `--doctor`
    modules: Option<&'r Modules>,
    /// [`Configs::is_native`], once that's known. If true, messages use Bun's own wording.
    is_native: bool,
    /// Some matched files were skipped, so the summary can't claim anything about all files.
    has_skipped_files: bool,
}

/// Classifies the file at `path`, in `scope`, the way the tool this run emulates would.
fn language_of(configs: &Configs, scope: &config::Scope, path: &[u8]) -> Language {
    // The `parser` option decides. A parser that Prettier doesn't have belongs to a plugin.
    match configs.parser_for(scope, path) {
        Some(parser) if &*parser == b"svelte" && !configs.formats_svelte(scope, Some(path)) => {
            Language::Other
        }
        Some(parser) if Kind::from_parser(&parser).is_none() => Language::Other,
        Some(_) => Language::Supported,
        None if configs.is_oxfmt_for(scope) => {
            files::language_for_oxfmt(path, configs.formats_svelte(scope, Some(path)))
        }
        None => match files::language_of(path) {
            Language::Unknown
                if path.ends_with(b".svelte") && configs.formats_svelte(scope, Some(path)) =>
            {
                Language::Supported
            }
            Language::Unknown if configs.is_formatted_by_plugin(scope, path) => Language::Other,
            Language::Unknown if files::is_toml(path) && configs.is_native_in(scope) => {
                Language::Supported
            }
            Language::Unknown if files::parser_by_interpreter(path).is_some() => {
                Language::Supported
            }
            language => language,
        },
    }
}

impl Run<'_> {
    /// Prettier's `logger.log`
    fn log(&mut self, text: &[u8]) {
        if self.options.log_level >= LogLevel::Log {
            self.out.stdout.extend_from_slice(text);
            self.out.stdout.push(b'\n');
        }
    }

    /// Prints `src/a.js (1ms)`, which is how `oxfmt --check` lists a file.
    fn log_with_time(&mut self, display_name: &[u8], took: Duration) {
        if self.options.log_level >= LogLevel::Log {
            pretty!(
                &mut self.out.stdout,
                self.colors(),
                "<yellow>{}<r> ({}ms)\n",
                BStr::new(display_name),
                took.as_millis()
            );
        }
    }

    /// Prints oxfmt's end-of-run summary. The counts are unformatted files, formatted files, and files that failed.
    fn print_oxfmt_summary(&mut self, [different, unchanged, failed]: [usize; 3], threads: usize) {
        let total = different + unchanged + failed;
        let prints_errors = self.options.log_level >= LogLevel::Error;
        if failed > 0 {
            if prints_errors {
                let text = b"Error occurred when checking code style in the above files.\n";
                self.out.stderr.extend_from_slice(text);
            }
            return;
        }
        if total == 0 {
            // The reason there are no files has already been printed.
            if self.out.exit_code != 0 {
                return;
            }
            if prints_errors {
                let text = b"No files found matching the given patterns.\n";
                self.out.stderr.extend_from_slice(text);
            }
        } else if self.options.list_different {
            return;
        } else if self.options.check && different == 0 {
            if !self.has_skipped_files {
                self.log(b"All matched files use the correct format.");
            }
        } else if self.options.check {
            self.log(b"");
            let text = format!(
                "Format issues found in above {different} files. Run without `--check` to fix."
            );
            self.log(text.as_bytes());
        }
        let took = self.began.elapsed().as_millis();
        let text = format!("Finished in {took}ms on {total} files using {threads} threads.");
        self.log(text.as_bytes());
    }

    /// Prints the `--check` summary. The counts are files that need formatting, files that are already formatted, and
    /// files that couldn't be checked.
    fn print_check_summary(&mut self, [different, unchanged, failed]: [usize; 3]) {
        let (colors, level) = (self.colors(), self.options.log_level);
        let out = &mut self.out.stderr;
        let files = |n: usize| if n == 1 { "file" } else { "files" };
        if different > 0 && level >= LogLevel::Warn {
            let (needs, them) = if different == 1 {
                ("needs", "it")
            } else {
                ("need", "them")
            };
            pretty!(
                out,
                colors,
                "<b>{} {} {} formatting.<r><d> Run <r><cyan>bun fmt<r><d> to fix {}.<r>\n",
                different,
                files(different),
                needs,
                them
            );
        }
        if failed > 0 && level >= LogLevel::Error {
            let _ = writeln!(out, "Could not check {failed} {}.", files(failed));
        }
        // If not every file is formatted, the reason has already been printed.
        let is_all = different + failed == 0 && self.out.exit_code == 0 && !self.has_skipped_files;
        if !is_all || level < LogLevel::Log {
            return;
        }
        match unchanged {
            0 => {}
            1 => out.extend_from_slice(b"1 file is formatted.\n"),
            all => {
                let _ = writeln!(out, "All {all} files are formatted.");
            }
        }
    }

    /// Warnings look the same with every kind of config.
    fn warn(&mut self, text: &[u8]) {
        if self.options.log_level >= LogLevel::Warn {
            pretty!(
                &mut self.out.stderr,
                self.colors(),
                "<yellow>warn<r><d>:<r> {}\n",
                BStr::new(text)
            );
        }
    }

    /// Prints one line of Prettier's `--check` output: an unformatted file, or how many there are. It's the run's
    /// result rather than a warning, so it keeps the format that scripts parse.
    fn list_as_prettier(&mut self, line: &[u8]) {
        if self.options.log_level >= LogLevel::Warn {
            pretty!(
                &mut self.out.stderr,
                self.colors(),
                "[<yellow>warn<r>] {}\n",
                BStr::new(line)
            );
        }
    }

    /// Errors look the same with every kind of config.
    fn error(&mut self, text: &[u8]) {
        if self.options.log_level >= LogLevel::Error {
            pretty!(
                &mut self.out.stderr,
                self.colors(),
                "<red>error<r><d>:<r> {}\n",
                BStr::new(text)
            );
        }
        self.out.exit_code = 2;
    }

    fn colors(&self) -> bool {
        self.options.color.unwrap_or(self.environment.stderr.colors)
    }

    fn fail(mut self, text: &[u8]) -> Outcome {
        self.error(text);
        self.out
    }

    /// Fails because the config or an ignore file can't be used.
    fn fail_to_start(self, flavor: Flavor, text: &[u8]) -> Outcome {
        let mut out = self.fail(text);
        if flavor == Flavor::Oxfmt || config::is_invalid_value(text) {
            out.exit_code = 1;
        }
        out
    }

    /// Prints warnings about the file `display_name`, which was formatted anyway.
    fn report_warnings(&mut self, display_name: &[u8], warnings: &[Problem]) {
        if self.options.log_level >= LogLevel::Warn {
            for problem in warnings {
                let printed = problem.print(display_name, bun_ast::Kind::Warn, self.colors());
                self.out.stderr.extend_from_slice(&printed);
            }
        }
    }

    /// Prints why the file `display_name` wasn't formatted. It doesn't copy Prettier's or oxfmt's layout, since their
    /// messages differ from ours anyway.
    fn report(&mut self, display_name: &[u8], failure: &Failure) {
        let (problem, kind, level) = match failure {
            Failure::Unread(problem) => (problem, bun_ast::Kind::Warn, LogLevel::Warn),
            Failure::Syntax(problem) => (problem, bun_ast::Kind::Err, LogLevel::Error),
            Failure::Bug => {
                let text =
                    b"The formatter failed, so this file was not formatted. This is a bug in Bun";
                (&Problem::new(text), bun_ast::Kind::Err, LogLevel::Error)
            }
            Failure::Changed(what) => {
                let text = [b"Not formatted, because ", what.as_bytes()].concat();
                (&Problem::new(&text), bun_ast::Kind::Err, LogLevel::Error)
            }
        };
        if self.options.log_level >= level {
            let printed = problem.print(display_name, kind, self.colors());
            self.out.stderr.extend_from_slice(&printed);
        }
        if kind == bun_ast::Kind::Err {
            self.out.exit_code = 2;
        }
    }

    /// Returns what Prettier's `--debug-check` prints instead of the formatted standard input. `path` is from
    /// `--stdin-filepath`.
    fn name_of_stdin(path: Option<&[u8]>) -> Vec<u8> {
        path.map_or_else(|| b"(stdin)\n".to_vec(), |it| paths::to_native(it.to_vec()))
    }

    /// Prettier's `formatStdin`
    fn format_stdin(mut self, configs: &Configs, ignored: &Ignored, name: &[u8]) -> Outcome {
        let text = match read_stdin() {
            Ok(text) => text,
            Err(error) => return self.fail(&error),
        };
        let path = paths::resolve(&self.environment.cwd, &paths::from_native(name));
        let is_read_only = self.options.check || self.options.list_different;
        // Prettier's `listDifferent` prints the `error.message` of what `check` throws and does nothing else.
        let exits_zero_on_error = configs.flavor == Flavor::Prettier && is_read_only;
        // An ignored file's config isn't even read.
        let is_inside_package =
            configs.flavor == Flavor::Prettier && ignored.is_in_node_modules(&path);
        if is_inside_package || ignored.ignores_file(&path, &None) {
            self.out.stdout = text;
            return self.out;
        }
        configs.name(paths::dirname(&path));
        let scope = match configs.for_directory(paths::dirname(&path)) {
            Ok(scope) => scope,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        let language = language_of(configs, &scope, &path);
        let is_ignored = ignored.ignores_file(&path, configs.config_ignores(&scope));
        let is_plugin_language = configs.is_formatted_by_plugin(&scope, &path);
        let not_installed = match language == Language::Other && is_plugin_language {
            true => self.not_installed(configs, &scope, Some(&path)),
            false => Vec::new(),
        };
        if language == Language::Other
            && !is_ignored
            && is_plugin_language
            && not_installed.is_empty()
        {
            let config = configs.config_file_path(&scope);
            return self.format_stdin_with_prettier((Some(&path), config), (name, &text));
        }
        let mut options = match configs.options_for(&scope, &path) {
            Ok(options) => options,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        // oxfmt echoes a Svelte component that it isn't set up to format.
        let is_skipped_by_oxfmt = language == Language::Unknown
            && configs.is_oxfmt_for(&scope)
            && files::is_svelte_for_oxfmt(&path);
        if is_ignored || is_skipped_by_oxfmt {
            self.out.stdout = text;
            return self.out;
        }
        // Same as for a file. A caller that gets the text back with exit code 0 would assume it's formatted.
        let allows = self.options.allow_unsupported;
        if language == Language::Other {
            self.report_unsupported(&mut [(extension_or_name(&path), 1)], &not_installed);
            if allows && !is_read_only {
                self.out.stdout = text;
            }
            return self.out;
        }
        let missing_plugins = configs.missing_plugins(&scope, Some(&path));
        if language == Language::Supported && !allows && !missing_plugins.is_empty() {
            let names: Vec<&[u8]> = missing_plugins.iter().map(|it| &it[..]).collect();
            self.report_skipped_for_plugins(1, &names);
            return self.out;
        }
        if Kind::with_options(&path, &options.options).is_none() {
            // `handleError` stays silent with `--ignore-unknown`. `listDifferent` runs before it and prints the error.
            if configs.flavor == Flavor::Prettier && self.options.ignore_unknown && !is_read_only {
                return self.out;
            }
            let mut out = self.fail_to_start(configs.flavor, &has_no_parser(configs, path));
            if exits_zero_on_error {
                out.exit_code = 0;
            }
            return out;
        }
        let kind = Kind::with_options(&path, &options.options);
        tailwind::only_where_sorted(&mut options.options, kind);
        let piped = Piped {
            text,
            display_name: name,
            paths: &[&path],
        };
        self.print_stdin(configs, piped, options)
    }

    /// `prettier --parser x < file`: Prettier's `formatStdin` without `--stdin-filepath`. Nothing that's keyed on a
    /// file name applies: ignore files, overrides, `.editorconfig`.
    fn format_unnamed_stdin(mut self, configs: &Configs) -> Outcome {
        // Prettier prints its usage. `bun_sys::isatty` is also true for `NUL` on Windows.
        if bun_core::Output::is_stdin_tty() {
            return self.fail(
                b"--parser without files formats standard input, and nothing is piped in\n  Pipe the code in, or name the files to format.",
            );
        }
        let text = match read_stdin() {
            Ok(text) => text,
            Err(error) => return self.fail(&error),
        };
        let is_read_only = self.options.check || self.options.list_different;
        let exits_zero_on_error = configs.flavor == Flavor::Prettier && is_read_only;
        let scope = configs.for_directory(&self.environment.cwd);
        let found = scope.and_then(|scope| Ok((configs.options_without_name(&scope)?, scope)));
        let (mut options, scope) = match found {
            Ok(found) => found,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        // `--config-precedence` can make a config file without `parser` win over the flag.
        let Some(parser) = options.options.parser.clone() else {
            if configs.flavor == Flavor::Prettier && self.options.ignore_unknown && !is_read_only {
                return self.out;
            }
            self.error(b"No parser and no file path given, couldn't infer a parser.");
            if exits_zero_on_error {
                self.out.exit_code = 0;
            }
            return self.out;
        };
        let is_formatted = |kind: &Kind| *kind != Kind::Svelte || options.options.svelte.is_on;
        let Some(kind) = Kind::from_parser(&parser).filter(is_formatted) else {
            // Without the plugin, Prettier has no `svelte` parser either.
            if &*parser == b"svelte" || !configs.lists_unknown_plugins(&scope, None) {
                self.error(&cannot_resolve_parser(&parser));
                self.out.exit_code = match (self.is_native, exits_zero_on_error) {
                    (true, _) => 2,
                    (false, true) => 0,
                    (false, false) => 1,
                };
                return self.out;
            }
            // The parser can only come from a plugin.
            let not_installed = self.not_installed(configs, &scope, None);
            if not_installed.is_empty() {
                let config = configs.config_file_path(&scope);
                return self.format_stdin_with_prettier((None, config), (b"stdin", &text));
            }
            self.report_unsupported(&mut [(&parser, 1)], &not_installed);
            if self.options.allow_unsupported && !is_read_only {
                self.out.stdout = text;
            }
            return self.out;
        };
        let missing_plugins = configs.missing_plugins(&scope, None);
        if !self.options.allow_unsupported && !missing_plugins.is_empty() {
            let names: Vec<&[u8]> = missing_plugins.iter().map(|it| &it[..]).collect();
            self.report_skipped_for_plugins(1, &names);
            return self.out;
        }
        tailwind::only_where_sorted(&mut options.options, Some(kind));
        let paths = syntaxes_to_try(&parser, &text);
        let piped = Piped {
            text,
            display_name: b"stdin",
            paths,
        };
        self.print_stdin(configs, piped, options)
    }

    /// Returns the missing packages among those needed to hand the file at `path` to the project's own Prettier.
    fn not_installed<'s>(
        &self,
        configs: &'s Configs,
        scope: &'s config::Scope,
        path: Option<&[u8]>,
    ) -> Vec<&'s [u8]> {
        let mut missing: Vec<&[u8]> = Vec::new();
        for package in [&b"prettier"[..]]
            .into_iter()
            .chain(configs.plugin_packages(scope, path))
        {
            if !prettier::is_installed(&self.environment.cwd, package)
                && !missing.contains(&package)
            {
                missing.push(package);
            }
        }
        missing
    }

    /// Formats standard input in a plugin's language. See `prettier.rs`. `display_name` is its name in error messages.
    fn format_stdin_with_prettier(
        mut self,
        (path, config): (Option<&[u8]>, Option<&[u8]>),
        (display_name, text): (&[u8], &[u8]),
    ) -> Outcome {
        let is_read_only = self.options.check || self.options.list_different;
        let size = (1, text.len() as u64);
        let bridge = prettier::Prettier::new(self.environment, self.options, size, 1);
        match bridge.format(path, config, text) {
            // Prettier's `listDifferent` prints the `error.message` of what `check` throws and does nothing else.
            Err(Unformatted::Message(message)) if is_read_only => {
                self.error(&message);
                self.out.exit_code = 0;
            }
            // For a `ConfigError`, such as a parser that no plugin provides, Prettier's `handleError` prints only
            // `error.message`.
            Err(Unformatted::Thrown(why)) if why.starts_with(b"ConfigError: ") => {
                let message = &why[b"ConfigError: ".len()..];
                let end = strings::index_of(message, b"\n    at ").unwrap_or(message.len());
                self.error(&message[..end]);
                self.out.exit_code = 1;
            }
            Err(why) => self.error(&[display_name, b": ", &prettier::describe(why)].concat()),
            Ok(formatted) if is_read_only => {
                if formatted != text && !self.options.write {
                    self.log(b"(stdin)");
                    self.out.exit_code = 1;
                }
            }
            Ok(_) if self.options.debug_check => self.out.stdout = Self::name_of_stdin(path),
            Ok(formatted) => self.out.stdout = formatted,
        }
        self.out
    }

    /// Formats standard input, then prints the result or the `--check` verdict.
    fn print_stdin(mut self, configs: &Configs, piped: Piped, mut options: Resolved) -> Outcome {
        let Piped {
            text,
            display_name: name,
            paths,
        } = piped;
        let is_read_only = self.options.check || self.options.list_different;
        let exits_zero_on_error = configs.flavor == Flavor::Prettier && is_read_only;
        for warning in std::mem::take(&mut *configs.warnings.lock()) {
            self.warn(&warning);
        }
        let names = Session::new();
        // Prettier's `listDifferent` runs first and returns, so `--debug-check` never happens.
        let verifies = self.options.debug_check && !is_read_only;
        let mut scratch = Scratches::default();
        let mut format_text = |options: &Resolved| {
            let mut first_failure = None;
            for path in paths {
                match format(
                    path,
                    &text,
                    options,
                    (&Interner::new_in(&names), &names),
                    &mut scratch,
                    verifies,
                ) {
                    Err(failure @ Failure::Syntax(_)) => _ = first_failure.get_or_insert(failure),
                    done => return done,
                }
            }
            Err(first_failure.unwrap_or(Failure::Bug))
        };
        let mut formatted = format_text(&options);
        if let Some(tailwind) = options
            .options
            .tailwind
            .as_deref()
            .filter(|it| it.has_missed())
        {
            match configs.classes.ask(self.environment) {
                Ok(_) => tailwind.has_missed.store(false, Ordering::Relaxed),
                // Same as for a file.
                Err(error) if self.options.allow_unsupported => {
                    self.warn(&error);
                    options.options.tailwind = None;
                }
                Err(error) => return self.fail(&error),
            }
            formatted = format_text(&options);
            if (options.options.tailwind.as_deref()).is_some_and(Tailwind::has_missed) {
                return self.fail(&unknown_class_order_error(name));
            }
        }
        if formatted.is_ok() {
            self.report_warnings(name, &scratch.warnings);
        }
        match formatted {
            Err(failure @ Failure::Unread(_)) => {
                self.report(name, &failure);
                if !is_read_only {
                    self.out.stdout = text;
                }
            }
            Err(failure @ Failure::Syntax(_)) if exits_zero_on_error => {
                self.report(name, &failure);
                self.out.exit_code = 0;
            }
            Err(failure) => self.report(name, &failure),
            // Prettier's `listDifferent` reports nothing with `--write`, and the text isn't printed either.
            Ok((formatted, _)) if is_read_only => {
                if formatted != text && !self.options.write {
                    self.log(b"(stdin)");
                    self.out.exit_code = 1;
                }
            }
            Ok(_) if verifies => {
                let has_file_name = !self.options.formats_unnamed_stdin();
                let path = paths.first().filter(|_| has_file_name);
                self.out.stdout = Self::name_of_stdin(path.copied());
            }
            Ok((formatted, cursor)) => {
                self.out.stdout = formatted;
                // Like Prettier, print the cursor's new offset.
                if let Some(cursor) = cursor {
                    let _ = writeln!(self.out.stderr, "{cursor}");
                }
            }
        }
        self.out
    }

    /// Prettier's `formatFiles`
    fn format_files(mut self, configs: &Configs, ignored: &mut Ignored) -> Outcome {
        let (options, cwd) = (self.options, &self.environment.cwd);
        // Files are written unless a flag disables that.
        let reports_unformatted_only = (options.check || options.list_different) && !options.write;
        let is_read_only = reports_unformatted_only || options.debug_check;
        let is_oxfmt = configs.flavor == Flavor::Oxfmt;
        let only = (options.only.as_ref()).map(|it| git::Files::read(it, self.environment, false));
        let only = match only.transpose() {
            Ok(only) => only,
            Err(Fatal(error)) => return self.fail(&error),
        };
        let is_partly_staged = |target: &Target| {
            only.as_ref()
                .is_some_and(|it| it.is_partly_staged(&target.path))
        };
        if options.check && !self.is_native {
            self.log(b"Checking formatting...");
            if is_oxfmt {
                self.log(b"");
            }
        }
        let pool = Pool::new(options.threads);
        let dot = [b".".to_vec()];
        let patterns = if options.patterns.is_empty() {
            &dot[..]
        } else {
            &options.patterns[..]
        };
        let started = Instant::now();
        let expand = match configs.flavor {
            Flavor::Prettier => files::expand,
            Flavor::Oxfmt => files::expand_as_oxfmt,
        };
        let mut expanded = match expand(
            configs,
            &pool,
            ignored,
            patterns,
            options.error_on_unmatched_pattern,
        ) {
            Ok(expanded) => expanded,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        if let Some(only) = &only {
            expanded.retain(|it| match it {
                Expanded::File(target) => only.has(&target.path),
                Expanded::Error(_) => true,
            });
            if expanded.is_empty() {
                if options.log_level >= LogLevel::Log {
                    let _ = writeln!(self.out.stderr, "{}", only.no_files_message("format"));
                }
                return self.out;
            }
        }
        let finding = started.elapsed();

        // Extensions of files in unsupported languages, with how many files have each.
        let mut others: Vec<(&[u8], usize)> = Vec::new();
        // How many files are skipped because of plugins that `bun fmt` doesn't include, and those plugins' names.
        let mut left_for_plugins: (usize, Vec<&[u8]>) = (0, Vec::new());
        let is_included = |target: &Target| match target.is_named {
            true => !ignored.ignores_file(&target.path, configs.config_ignores(&target.scope)),
            // Without a Prettier or oxfmt config, minified code and lock files are only formatted when they're named.
            false => !(files::is_generated(&target.path) && configs.is_native_in(&target.scope)),
        };
        let mut work: Vec<(usize, &Target)> = Vec::new();
        // Files handed to the project's own Prettier, and the packages that must be installed before more files can be.
        let mut handed_over: Vec<(usize, &Target)> = Vec::new();
        let mut not_installed: Vec<&[u8]> = Vec::new();
        let mut packages: Vec<(&[u8], bool)> = Vec::new();
        let mut has_package = |name| match packages.iter().find(|it| it.0 == name) {
            Some(known) => known.1,
            None => {
                packages.push((name, prettier::is_installed(cwd, name)));
                packages.last().is_some_and(|it| it.1)
            }
        };
        let mut done: Vec<Option<Done>> = Vec::with_capacity(expanded.len());
        for (index, it) in expanded.iter().enumerate() {
            done.push(None);
            let Expanded::File(target) = it else {
                continue;
            };
            let missing_plugins = match options.allow_unsupported {
                true => &[][..],
                false => configs.missing_plugins(&target.scope, Some(&target.path)),
            };
            match language_of(configs, &target.scope, &target.path) {
                _ if !is_included(target) => {}
                Language::Supported if !missing_plugins.is_empty() => {
                    left_for_plugins.0 += 1;
                    for name in missing_plugins {
                        if !left_for_plugins.1.contains(&&name[..]) {
                            left_for_plugins.1.push(name);
                        }
                    }
                }
                Language::Supported => work.push((index, target)),
                Language::Other
                    if configs.is_formatted_by_plugin(&target.scope, &target.path)
                        && [&b"prettier"[..]]
                            .into_iter()
                            .chain(configs.plugin_packages(&target.scope, Some(&target.path)))
                            .all(&mut has_package) =>
                {
                    handed_over.push((index, target));
                }
                Language::Other => {
                    if configs.is_formatted_by_plugin(&target.scope, &target.path) {
                        for package in [&b"prettier"[..]]
                            .into_iter()
                            .chain(configs.plugin_packages(&target.scope, Some(&target.path)))
                        {
                            if !has_package(package) && !not_installed.contains(&package) {
                                not_installed.push(package);
                            }
                        }
                    }
                    let kind = extension_or_name(&target.path);
                    match others.iter_mut().find(|it| it.0 == kind) {
                        Some(entry) => entry.1 += 1,
                        None => others.push((kind, 1)),
                    }
                }
                Language::Unknown if target.ignores_unknown || options.ignore_unknown => {}
                Language::Unknown => {
                    let path = target.path.clone();
                    done[index] = Some(Done::Failed(has_no_parser(configs, path)));
                }
            }
        }
        if let Some(modules) = self.modules {
            let sorted = doctor::Sorted {
                found: &expanded,
                formatted: &work,
                handed_over: &handed_over,
                others: &others,
                left_for_plugins: left_for_plugins.0,
                not_installed: &not_installed,
            };
            let how = crate::doctor::How {
                as_json: options.as_json,
                colors: (options.color).unwrap_or(self.environment.stdout.colors),
            };
            return match doctor::report((configs, cwd), &pool, &sorted, modules, how) {
                Ok(report) => {
                    self.out.stdout = report;
                    self.out
                }
                Err(Fatal(error)) => self.fail_to_start(configs.flavor, &error),
            };
        }
        if options.list_files {
            for (_, target) in work.iter().chain(&handed_over) {
                self.out
                    .stdout
                    .extend_from_slice(&paths::relative(cwd, &target.path));
                self.out.stdout.push(b'\n');
            }
            return self.out;
        }
        // Largest first, so no thread starts a big file when the others are nearly done.
        sort_slice_by(&mut work[..], |a, b| b.1.size.cmp(&a.1.size));
        let started = Instant::now();
        // Has to come before the first parallel region. The pool's threads have enough stack to walk a tree as deep as a parser
        // allows.
        bun_sema_driver::use_dedicated_pool("Bun Format");
        let bridge = (!handed_over.is_empty()).then(|| {
            let size: u64 = handed_over.iter().map(|it| it.1.size).sum();
            let size = (handed_over.len(), size);
            prettier::Prettier::new(self.environment, options, size, pool.threads())
        });
        let scratches: Guarded<Vec<Scratches>> = Guarded::new(Vec::new());
        let names: Vec<Session> = (0..pool.threads().max(1)).map(|_| Session::new()).collect();
        let atoms = InternerPerThread::new_in(&names);
        let memory = Session::new();
        let mut results = Guarded::new(done);
        // Keyed by the file's index in `expanded`.
        let mut warnings: Guarded<Vec<(usize, Vec<Problem>)>> = Guarded::new(Vec::new());
        // Tailwind can't be asked and `--allow-unsupported` permits that, so classes stay unsorted.
        let skips_class_sorting = AtomicBool::new(false);
        let written_files = fs::WrittenFiles::default();
        // A file with several hard links is overwritten in place. A thread reading it through another link at the same
        // time could see partial text and write that back. So each link is locked from its read to its write. The lock
        // is picked by inode modulo 32, so unrelated files occasionally wait for each other.
        let link_locks: [Guarded<()>; 32] = Default::default();
        let lock_for = |target: &Target| {
            let linked = target.linked.filter(|_| !is_read_only);
            linked.map(|(_, inode)| link_locks[inode as usize % link_locks.len()].lock())
        };
        let format_at = |at: usize| {
            let (index, target) = work[at];
            let _link_lock = lock_for(target);
            let began = Instant::now();
            let display_name = paths::relative(cwd, &target.path);
            let mut scratch = scratches.lock().pop().unwrap_or_default();
            let result = (|| {
                let mut options = configs
                    .options_for(&target.scope, &target.path)
                    .map_err(|error| error.0)?;
                if skips_class_sorting.load(Ordering::Relaxed) {
                    options.options.tailwind = None;
                }
                let text = git::read(only.as_ref(), &target.path).map_err(|error| {
                    [
                        b"Unable to read file \"",
                        &display_name[..],
                        b"\":\n",
                        &fs::describe(&error),
                    ]
                    .concat()
                })?;
                let kind = Kind::with_options(&target.path, &options.options);
                tailwind::only_where_sorted(&mut options.options, kind);
                let formatted = match format(
                    &target.path,
                    &text,
                    &options,
                    (&atoms, &memory),
                    &mut scratch,
                    self.options.debug_check,
                ) {
                    Ok((formatted, _)) => formatted,
                    Err(failure) => return Ok(Done::NotFormatted(failure)),
                };
                if options
                    .options
                    .tailwind
                    .as_deref()
                    .is_some_and(Tailwind::has_missed)
                {
                    return Ok(Done::Deferred);
                }
                if !scratch.warnings.is_empty() {
                    let all = std::mem::take(&mut scratch.warnings);
                    warnings.lock().push((index, all));
                }
                if formatted == text {
                    return Ok(Done::Unchanged);
                }
                if !is_read_only && is_partly_staged(target) {
                    return Ok(Done::PartlyStaged);
                }
                if !is_read_only {
                    fs::write_atomically(&written_files, cwd, &target.path, &formatted).map_err(
                        |why| {
                            [
                                b"Unable to write file \"",
                                &display_name[..],
                                b"\":\n",
                                &why,
                            ]
                            .concat()
                        },
                    )?;
                }
                Ok(Done::Different(began.elapsed()))
            })();
            scratches.lock().push(scratch);
            results.lock()[index] = Some(result.unwrap_or_else(Done::Failed));
        };
        pool.for_each(work.len(), 1, &format_at);
        let deferred: Vec<usize> = (0..work.len())
            .filter(|&at| matches!(results.lock()[work[at].0], Some(Done::Deferred)))
            .collect();
        let mut classes_are_unknown = None;
        if !deferred.is_empty() {
            classes_are_unknown = configs.classes.ask(self.environment).err();
            // This second pass runs even if `ask` failed. A Tailwind that can't be asked fails only its own files, and
            // the other Tailwinds' answers are stored.
            pool.for_each(deferred.len(), 1, &|at| format_at(deferred[at]));
            if let Some(error) = &mut classes_are_unknown {
                let still_deferred: Vec<usize> = (deferred.iter().copied())
                    .filter(|&at| matches!(results.lock()[work[at].0], Some(Done::Deferred)))
                    .collect();
                let count = still_deferred.len();
                let detail = match (options.allow_unsupported, count) {
                    (true, 1) => "\nClasses were not sorted in 1 file.".to_owned(),
                    (true, _) => format!("\nClasses were not sorted in {count} files."),
                    (false, 1) => "\n1 file with classes was not formatted.".to_owned(),
                    (false, _) => format!("\n{count} files with classes were not formatted."),
                };
                error.extend_from_slice(detail.as_bytes());
                if options.allow_unsupported {
                    skips_class_sorting.store(true, Ordering::Relaxed);
                    pool.for_each(still_deferred.len(), 1, &|at| format_at(still_deferred[at]));
                }
            }
        }
        if let Some(bridge) = &bridge {
            let is_heavy = |at: usize| handed_over[at].1.size >= HEAVY as u64;
            bridge.for_each(handed_over.len(), &is_heavy, &|at| {
                let (index, target) = handed_over[at];
                let _link_lock = lock_for(target);
                let began = Instant::now();
                let display_name = paths::relative(cwd, &target.path);
                let config = configs.config_file_path(&target.scope);
                let file = (&target.path[..], &display_name[..]);
                let writes = !is_read_only && !is_partly_staged(target);
                let formatted = bridge.format_file(file, config, writes, only.as_ref());
                results.lock()[index] = Some(match formatted {
                    Ok(true) if !is_read_only && !writes => Done::PartlyStaged,
                    Ok(true) => Done::Different(began.elapsed()),
                    Ok(false) => Done::Unchanged,
                    Err(error) => Done::Failed(error),
                });
            });
        }
        let formatting = started.elapsed();

        let (mut different, mut unchanged, mut failed) = (0usize, 0usize, 0usize);
        let (mut written_paths, mut partly_staged) = (Vec::new(), Vec::new());
        let mut warnings = std::mem::take(warnings.get_mut());
        sort_slice_by(&mut warnings[..], |a, b| a.0.cmp(&b.0));
        let mut warnings = warnings.into_iter().peekable();
        let mut results = std::mem::take(results.get_mut());
        // It's a race which hard link gets formatted first and does the write, so report every link to a rewritten file
        // as changed.
        let linked = |it: &Expanded| match it {
            Expanded::File(target) if !is_read_only => target.linked,
            _ => None,
        };
        let rewritten: FxHashMap<fs::Identity, Duration> = (expanded.iter().zip(&results))
            .filter_map(|(it, done)| match done {
                Some(Done::Different(took)) => Some((linked(it)?, *took)),
                _ => None,
            })
            .collect();
        if !rewritten.is_empty() {
            for (it, done) in expanded.iter().zip(&mut results) {
                if matches!(done, Some(Done::Unchanged))
                    && let Some(took) = linked(it).and_then(|it| rewritten.get(&it))
                {
                    *done = Some(Done::Different(*took));
                }
            }
        }
        for (index, (it, done)) in expanded.iter().zip(results).enumerate() {
            let target = match it {
                Expanded::Error(error) => {
                    self.error(error);
                    continue;
                }
                Expanded::File(target) => target,
            };
            let display_name = paths::relative(cwd, &target.path);
            if let Some((_, all)) = warnings.next_if(|it| it.0 == index) {
                self.report_warnings(&display_name, &all);
            }
            match done {
                None => {}
                Some(Done::Unchanged) => {
                    unchanged += 1;
                    if options.debug_check {
                        self.log(&display_name);
                    }
                }
                Some(Done::NotFormatted(failure @ Failure::Unread(_))) => {
                    unchanged += 1;
                    self.report(&display_name, &failure);
                }
                Some(Done::NotFormatted(failure)) => {
                    failed += 1;
                    self.report(&display_name, &failure);
                }
                // Prettier stops at this error.
                Some(Done::Failed(error)) if config::is_invalid_value(&error) => {
                    self.error(&error);
                    self.out.exit_code = 1;
                    return self.out;
                }
                Some(Done::Failed(error)) => {
                    failed += 1;
                    self.error(&error);
                }
                Some(Done::Deferred) => {
                    failed += 1;
                    let text = unknown_class_order_error(&display_name);
                    self.error(&[&text[..], b" It was not formatted."].concat());
                }
                Some(Done::PartlyStaged) => {
                    failed += 1;
                    partly_staged.push(target.path.clone());
                }
                Some(Done::Different(took)) => {
                    different += 1;
                    if !is_read_only && only.is_some() {
                        written_paths.push(target.path.clone());
                    }
                    match (is_oxfmt, options.check) {
                        (true, true) => self.log_with_time(&display_name, took),
                        // oxfmt doesn't list the files it writes.
                        (true, false) if !options.list_different => {}
                        (false, true) if !self.is_native => self.list_as_prettier(&display_name),
                        // The file list is `--check`'s result, so it goes to stdout.
                        (false, true) if options.log_level >= LogLevel::Warn => {
                            self.out.stdout.extend_from_slice(&display_name);
                            self.out.stdout.push(b'\n');
                        }
                        // `--debug-check` lists every passing file below.
                        (false, false) if options.debug_check && !options.list_different => {}
                        _ => self.log(&display_name),
                    }
                    if options.debug_check {
                        self.log(&display_name);
                    }
                }
            }
        }
        if let Some(only) = &only {
            if !partly_staged.is_empty() {
                self.error(&only.partly_staged_error(&mut partly_staged, "formatted"));
            }
            if let Err(Fatal(error)) = only.stage(&written_paths) {
                self.error(&error);
            }
        }
        for warning in std::mem::take(&mut *configs.warnings.lock()) {
            self.warn(&warning);
        }
        let count = |n: usize| {
            if n == 1 {
                "the above file".to_owned()
            } else {
                format!("{n} files")
            }
        };
        // The reason is printed at the end.
        self.has_skipped_files = left_for_plugins.0 > 0
            || !others.is_empty()
            || (classes_are_unknown.is_some() && !options.allow_unsupported);
        // oxfmt has no `--debug-check`, so that flag behaves as it does without a config.
        if is_oxfmt && (options.check || !options.debug_check) {
            self.print_oxfmt_summary([different, unchanged, failed], pool.threads());
        } else if self.is_native {
            if options.check && is_read_only {
                self.print_check_summary([different, unchanged, failed]);
            }
        } else if options.check {
            if failed > 0 {
                self.log(
                    format!(
                        "Error occurred when checking code style in {}.",
                        count(failed)
                    )
                    .as_bytes(),
                );
            } else if different == 0 {
                if !self.has_skipped_files {
                    self.log(b"All matched files use Prettier code style!");
                }
            } else if is_read_only {
                self.list_as_prettier(
                    format!(
                        "Code style issues found in {}. Run bun fmt to fix.",
                        count(different)
                    )
                    .as_bytes(),
                );
            } else {
                self.list_as_prettier(
                    format!("Code style issues fixed in {}.", count(different)).as_bytes(),
                );
            }
        }
        if reports_unformatted_only && different > 0 && self.out.exit_code == 0 {
            self.out.exit_code = 1;
        }
        let sums_up = match self.is_native {
            true => !is_read_only,
            false => !is_oxfmt && !options.check && !options.list_different && !is_read_only,
        };
        if options.log_level >= LogLevel::Log && sums_up {
            let colors = self.colors();
            let took = bun_core::output::Elapsed {
                colors,
                ms: self.began.elapsed().as_secs_f64() * 1000.0,
            };
            let noun = |n: usize| if n == 1 { "file" } else { "files" };
            pretty!(
                &mut self.out.stderr,
                colors,
                "Formatted {} {}<d>, {} unchanged {}<r>\n",
                different,
                noun(different),
                unchanged,
                took
            );
        }
        if options.log_level >= LogLevel::Log && !handed_over.is_empty() {
            let noun = if handed_over.len() == 1 {
                "file"
            } else {
                "files"
            };
            let _ = writeln!(
                self.out.stderr,
                "Used your installed Prettier for {} {noun} in a language that needs a plugin",
                handed_over.len(),
            );
        }
        if options.timing {
            let _ = writeln!(
                self.out.stderr,
                "  wall: {:.1}ms finding files and configs, {:.1}ms formatting, {:.1}ms total, {} threads",
                finding.as_secs_f64() * 1e3,
                formatting.as_secs_f64() * 1e3,
                self.began.elapsed().as_secs_f64() * 1e3,
                pool.threads(),
            );
        }
        let unsupported_options = std::mem::take(&mut *configs.unsupported_options.lock());
        if !unsupported_options.is_empty() {
            let text = [
                &unsupported_options.join(&b", "[..])[..],
                match unsupported_options.len() {
                    1 => &b" is not supported yet and has no effect"[..],
                    _ => b" are not supported yet and have no effect",
                },
            ]
            .concat();
            match options.allow_unsupported {
                true => self.warn(&text),
                false => self.error(&[&text[..], MAKE_IT_A_WARNING].concat()),
            }
        }
        match classes_are_unknown {
            Some(error) if options.allow_unsupported => self.warn(&error),
            Some(error) => self.error(&error),
            None => {}
        }
        if let (count @ 1.., names) = &left_for_plugins {
            self.report_skipped_for_plugins(*count, names);
        }
        // The emulated tool would have formatted or checked these files, so this is an error and is printed last.
        if !others.is_empty() {
            self.report_unsupported(&mut others, &not_installed);
        }
        self.out
    }

    /// Reports that `count` files were skipped because the config uses the plugins `names`, which `bun fmt` doesn't
    /// include.
    fn report_skipped_for_plugins(&mut self, count: usize, names: &[&[u8]]) {
        let (noun, it) = match count {
            1 => ("file was", "it"),
            _ => ("files were", "them"),
        };
        let text = format!(
            "{count} {noun} not formatted because the Prettier config uses plugins that bun fmt does not include: "
        );
        let end = format!("\n  Use --allow-unsupported to format {it} without the plugins.");
        self.error(&[text.as_bytes(), &names.join(&b", "[..]), end.as_bytes()].concat());
    }

    /// Warns about the packages that must be installed before more files can go to the project's own Prettier.
    fn warn_not_installed(&mut self, not_installed: &[&[u8]]) {
        if !not_installed.is_empty() {
            let plugins = not_installed.join(&b", "[..]);
            self.warn(
                &[
                    &b"Not installed: "[..],
                    &plugins,
                    b"\n  Install prettier and every plugin in your config, and bun fmt will use them for these files.",
                ]
                .concat(),
            );
        }
    }

    /// Reports files in unsupported languages. `others` holds their extensions with a file count each. `not_installed`
    /// lists the packages that must be installed before the project's own Prettier can format them.
    fn report_unsupported(&mut self, others: &mut [(&[u8], usize)], not_installed: &[&[u8]]) {
        sort_slice_by(others, |a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        let count: usize = others.iter().map(|it| it.1).sum();
        let (noun, its) = match count {
            1 => ("file was", "its"),
            _ => ("files were", "their"),
        };
        let extension_counts: Vec<Vec<u8>> = others
            .iter()
            .map(|it| format!("{} {}", it.1, BStr::new(it.0)).into_bytes())
            .collect();
        let text = format!(
            "{count} {noun} not formatted because bun fmt does not support {its} language yet: "
        );
        let text = [text.as_bytes(), &extension_counts.join(&b", "[..])].concat();
        self.warn_not_installed(not_installed);
        match self.options.allow_unsupported {
            true => self.warn(&text),
            false => {
                self.error(&[&text[..], MAKE_IT_A_WARNING].concat());
            }
        }
    }

    fn init(self, configs: &Configs) -> Outcome {
        let scope = configs.for_directory(&self.environment.cwd);
        match scope.as_ref().map(|scope| configs.config_of(scope)) {
            Ok(Ok(other)) => {
                let other = other.map(|it| &it.path[..]);
                crate::init::FORMAT.add(other, self.options.bunfig_above(), self.environment)
            }
            Ok(Err(Fatal(error))) => self.fail_to_start(configs.flavor, &error),
            Err(Fatal(error)) => self.fail_to_start(configs.flavor, error),
        }
    }

    fn execute(mut self) -> Outcome {
        let (options, environment) = (self.options, self.environment);
        if options.version {
            self.out.stdout = [environment.version, b"\n"].concat();
            return self.out;
        }
        let configs = Configs::new(options, environment);
        self.is_native = configs.is_native();
        if let Some(name) = (options.plugins.iter()).find(|it| config::is_missing_plugin(it))
            && !options.allow_unsupported
        {
            return self.fail(
                &[
                    b"bun fmt does not include the plugin ",
                    &name[..],
                    b"\n  Use --allow-unsupported to format without it.",
                ]
                .concat(),
            );
        }
        if !(options.plugins.iter()).all(|it| config::is_built_in_plugin(it)) {
            self.warn(b"--plugin has no effect because bun fmt does not load Prettier plugins");
        }
        if configs.requests_svelte_parser()
            && (configs.for_directory(&environment.cwd))
                .is_ok_and(|own| configs.turns_svelte_off(&own, &environment.cwd))
        {
            return self.fail(
                b"Cannot use --parser svelte while Svelte is off (--no-svelte, or svelte = false in bunfig.toml).",
            );
        }
        if options.config.is_some() && !options.config_lookup {
            let mut out = self.fail(b"Cannot use --no-config and --config together.");
            out.exit_code = 1;
            return out;
        }
        if let Some(only) = (options.only.as_ref()).filter(|_| options.stdin_filepath.is_some()) {
            return self.fail(&only.stdin_conflict_error("--stdin-filepath"));
        }
        let is_unnamed = options.formats_unnamed_stdin();
        if let Some(only) = options.only.as_ref().filter(|_| is_unnamed) {
            return self.fail(&only.stdin_conflict_error("--parser without files"));
        }
        // Prettier and oxfmt both report this before they look at files, patterns or config.
        let is_oxfmt = configs.flavor == Flavor::Oxfmt;
        if let Some(conflict) = options.mode_conflict_error(is_oxfmt) {
            let mut out = self.fail(&conflict);
            out.exit_code = 1;
            return out;
        }
        if options.init {
            return self.init(&configs);
        }
        if let Some(file) = &options.find_config_path {
            let path = paths::resolve(&environment.cwd, &paths::from_native(file));
            configs.name(paths::dirname(&path));
            let scope = match configs.for_directory(paths::dirname(&path)) {
                Ok(scope) => scope,
                Err(Fatal(error)) => return self.fail(&error),
            };
            return match &scope.config {
                Some(config) => {
                    let display_name = paths::relative(&environment.cwd, &config.path);
                    self.log(&display_name);
                    self.out
                }
                None => {
                    let mut out = self
                        .fail(&[b"Can not find configure file for \"", &file[..], b"\"."].concat());
                    out.exit_code = 1;
                    out
                }
            };
        }
        if let Err(Fatal(error)) = configs.check() {
            return self.fail_to_start(configs.flavor, &error);
        }
        let from_flag = options.format.iter().rfind(|it| it.0 == b"parser");
        let is_unknown = |it: &&(&[u8], Vec<u8>)| Kind::from_parser(&it.1).is_none();
        if let Some((_, parser)) = from_flag.filter(is_unknown).filter(|_| !is_unnamed) {
            return self.fail(&cannot_resolve_parser(parser));
        }
        // Prettier parses everything in the directory with that parser: lock files, dotfiles, LICENSE. We only do that
        // with a Prettier config. oxfmt has no `--parser`.
        let is_directory = |pattern: &&Vec<u8>| {
            let path = paths::resolve(&environment.cwd, &paths::from_native(pattern));
            matches!(
                fs::link_kind_and_size(&path),
                Some((fs::LinkKind::Directory, _))
            )
        };
        if (self.is_native || is_oxfmt)
            && !options.doctor
            && !options.list_files
            && let Some((_, parser)) = from_flag
            && let Some(directory) = options.patterns.iter().find(is_directory)
        {
            return self.fail(&cannot_force_parser_on(directory, parser));
        }
        // `--doctor` already lists it with its own notes.
        let prints_note = options.log_level >= LogLevel::Warn && !options.doctor;
        let colors = self.colors();
        let mut out = if is_unnamed {
            self.format_unnamed_stdin(&configs)
        } else {
            let (cwd, is_native) = (&environment.cwd, self.is_native);
            let mut ignored = match Ignored::new(options, cwd, configs.flavor, is_native) {
                Ok(ignored) => ignored,
                Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
            };
            match &options.stdin_filepath {
                Some(name) => self.format_stdin(&configs, &ignored, name),
                None => self.format_files(&configs, &mut ignored),
            }
        };
        if let Some(note) = configs.note().filter(|_| prints_note) {
            let note = BStr::new(note);
            pretty!(&mut out.stderr, colors, "<blue>note<r><d>:<r> {}\n", note);
        }
        out
    }
}

/// Runs `bun fmt`. The caller handles `options.help` and `options.cwd`.
pub fn run(options: &Options, environment: &Environment) -> Outcome {
    match options.doctor {
        true => watching(environment, |environment, modules| {
            run_in(options, environment, Some(modules))
        }),
        false => run_in(options, environment, None),
    }
}

fn run_in(options: &Options, environment: &Environment, modules: Option<&Modules>) -> Outcome {
    let mut options = options.clone();
    let mut loaded = options.load_pipes(&environment.cwd);
    let as_oxfmt = options
        .reparsed_for_oxfmt()
        .filter(|_| Configs::new(&options, environment).flavor == Flavor::Oxfmt);
    if let Some(as_oxfmt) = as_oxfmt {
        options = as_oxfmt;
        loaded = loaded.and_then(|()| options.load_pipes(&environment.cwd));
    }
    let run = Run {
        options: &options,
        environment,
        out: Outcome::default(),
        began: Instant::now(),
        modules,
        is_native: false,
        has_skipped_files: false,
    };
    match loaded {
        Ok(()) => run.execute(),
        Err(why) => run.fail(&why),
    }
}
