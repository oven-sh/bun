//! `bun fmt`: the command line of Prettier, on all threads.
//!
//! - [`cli`]: the flags.
//! - [`run`]: `bun fmt`, given the flags and an [`Environment`].
//! - [`ForRules`]: `bun fmt` for the rules of `bun lint` that hold a file against its formatted text.

pub mod cli;
mod config;
mod doctor;
mod editorconfig;
mod files;
mod for_rules;
mod prettier;
mod tailwind;

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
use bun_lint::language::{LanguageOptions, ParseOptions, Parser, SourceType};
use bun_lint::linter::TypesInJavaScript;
use bun_lint::utils::text::ends_with_ignore_ascii_case as ends_in;
use bun_sema::atom::{Intern, Interner, InternerPerThread};
use bun_sema::bind::{BindOptions, Recycled, bind, bind_for_format_in, try_bind_for_format_in};
use bun_sema::hir::Diagnostic;
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;
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

/// What is wrong with the text of a file, and where.
struct Problem {
    message: Vec<u8>,
    at: Option<Place>,
}

struct Place {
    line: u32,
    /// From 1, in UTF-16 code units, as everywhere in Bun.
    column: u32,
    line_text: Vec<u8>,
}

impl Problem {
    /// It is about the whole file.
    fn new(message: &[u8]) -> Problem {
        Problem {
            message: message.to_vec(),
            at: None,
        }
    }

    /// In JavaScript or TypeScript, where U+2028 ends a line too. `offset`: as the parser counts it.
    #[cold]
    fn in_file(file: &File, message: &[u8], offset: u32) -> Problem {
        let at = file.position(offset);
        Problem {
            message: message.to_vec(),
            at: Some(Place {
                line: at.line,
                column: at.column + 1,
                line_text: file.line_text(at.line).to_vec(),
            }),
        }
    }

    /// In any other language. `offset`: in `text`, not counting a byte order mark.
    #[cold]
    fn at(text: &[u8], message: &[u8], offset: u32) -> Problem {
        Places::new(text).problem(message, offset)
    }

    /// As Bun prints every other error: the line, a caret, the message, and where it is. `shown`: the name of the file.
    fn print(&self, shown: &[u8], kind: bun_ast::Kind, colors: bool) -> Vec<u8> {
        let message = bun_ast::Msg {
            kind,
            data: bun_ast::Data {
                text: self.message.clone().into(),
                location: Some(bun_ast::Location {
                    file: shown.to_vec().into(),
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

/// The lines and columns of places in a text. Asked for one after the other, from the first to the last, they take one pass
/// over the text, and what is printed is no longer than the text and the messages: a line is shown with the first problem
/// that is in it.
struct Places<'a> {
    text: &'a [u8],
    line: u32,
    line_start: usize,
    /// Up to where line breaks have been looked for.
    searched: usize,
    /// Up to where the line has been measured, and how many UTF-16 code units that is.
    measured: (usize, u32),
    /// The line that has been shown last.
    shown: u32,
}

impl<'a> Places<'a> {
    fn new(text: &'a [u8]) -> Places<'a> {
        Places {
            text: strings::without_utf8_bom(text),
            line: 1,
            line_start: 0,
            searched: 0,
            measured: (0, 0),
            shown: 0,
        }
    }

    /// `offset`: in the text, not counting a byte order mark.
    fn problem(&mut self, message: &[u8], offset: u32) -> Problem {
        let (text, end) = (self.text, self.text.len().min(offset as usize));
        if end < self.searched {
            *self = Places::new(text);
        }
        while let Some(found) = strings::index_of_any(&text[self.searched..end], b"\n\r") {
            self.searched += found + 1;
            // The `\n` of `\r\n` ends the line.
            if text[self.searched - 1] == b'\n' || text.get(self.searched) != Some(&b'\n') {
                (self.line, self.line_start) = (self.line + 1, self.searched);
                self.measured = (self.searched, 0);
            }
        }
        self.searched = end;
        let more = strings::utf8_decoded_len_utf16(&text[self.measured.0..end]) as u32;
        self.measured = (end, self.measured.1 + more);
        let line_text = match std::mem::replace(&mut self.shown, self.line) == self.line {
            true => &[][..],
            false => {
                let rest = &text[self.line_start..];
                &rest[..strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len())]
            }
        };
        Problem {
            message: message.to_vec(),
            at: Some(Place {
                line: self.line,
                column: self.measured.1 + 1,
                line_text: line_text.to_vec(),
            }),
        }
    }
}

/// Why a file is left as it is.
enum Failure {
    Syntax(Problem),
    /// A bug in the formatter: it could not print the file.
    Bug,
    /// `--debug-check`: what would be written does not say what the file says.
    Changed(&'static str),
    /// TOML that cannot be read, with what is wrong with it. oxfmt passes over such a file without a word, so it is no
    /// error.
    Unread(Problem),
}

/// Tailwind has been asked, and the order of the classes in the file that is shown as `shown` is still not known.
fn has_classes_without_order(shown: &[u8]) -> Vec<u8> {
    let what = b": sortTailwindcss could not find the order of some classes.";
    [shown, what].concat()
}

/// `.svelte` of `src/a.svelte`. The name of a file that has no ending.
pub(crate) fn ending_of(path: &[u8]) -> &[u8] {
    let name = paths::basename(path);
    strings::last_index_of_char(name, b'.').map_or(name, |dot| &name[dot..])
}

/// Prettier's message for a parser that it does not have.
fn cannot_resolve_parser(parser: &[u8]) -> Vec<u8> {
    [b"Couldn't resolve parser \"", parser, b"\"."].concat()
}

/// The error for `--parser` with the directory `written` as an argument.
fn cannot_force_parser_on(written: &[u8], parser: &[u8]) -> Vec<u8> {
    let extension: Option<&[u8]> = match parser {
        b"typescript" | b"babel-ts" | b"oxc-ts" => Some(b"ts"),
        b"markdown" | b"remark" => Some(b"md"),
        b"glimmer" => Some(b"hbs"),
        b"json-stringify" => Some(b"json"),
        b"angular" | b"lwc" => Some(b"html"),
        _ if parser.starts_with(b"__") => None,
        _ if Kind::of_parser(parser) == Some(Kind::Script) => Some(b"js"),
        // The others are named like their files: css, json5, yaml, vue, graphql.
        _ => Some(parser),
    };
    let mut text = [b"--parser ", parser, b" would read every file in \""].concat();
    text.extend_from_slice(&[written, b"\" as ", parser].concat());
    let Some(extension) = extension else {
        text.extend_from_slice(b"\n  Name the files, or use a glob.");
        return text;
    };
    let directory = paths::from_native(written);
    let directory = directory.strip_suffix(b"/").unwrap_or(&directory);
    let base = match directory {
        b"." | b"" => Vec::new(),
        _ => [directory, b"/"].concat(),
    };
    text.extend_from_slice(b"\n  Name the files, or use a glob: bun fmt --parser ");
    text.extend_from_slice(&[parser, b" \"", &base, b"**/*.", extension, b"\""].concat());
    text
}

/// All of standard input, or the error to print.
fn read_stdin() -> Result<Vec<u8>, Vec<u8>> {
    fs::read_stdin()
        .map_err(|error| [&b"Cannot read standard input: "[..], &fs::describe(&error)].concat())
}

/// Code from standard input.
struct Piped<'p> {
    text: Vec<u8>,
    /// Its name in error messages.
    shown: &'p [u8],
    /// The file names to parse it as. The first one that parses wins.
    paths: &'p [&'p [u8]],
}

/// [`Piped::paths`] for code that has no file name. These only tell the parser which syntax to expect. No config ever sees
/// them. Prettier's TypeScript parsers go by the extension to allow JSX or not. Without one they try both.
fn syntaxes_to_try(parser: &[u8], text: &[u8]) -> &'static [&'static [u8]] {
    match parser {
        b"typescript" | b"oxc-ts" if !bun_format::html::is_probably_jsx(text) => {
            &[b"stdin.ts", b"stdin.tsx"]
        }
        b"typescript" | b"oxc-ts" | b"babel-ts" => &[b"stdin.tsx", b"stdin.ts"],
        _ if Kind::of_parser(parser) == Some(Kind::Script) => &[b"stdin.js"],
        _ => &[b""],
    }
}

/// What the file at `path` is parsed as, one after the other until there is no error: whether as
/// a script. A module, then a script, as the parsers of Prettier do.
fn kinds(path: &[u8]) -> &'static [bool] {
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
    /// It is parsed as Flow.
    is_flow: bool,
    resolved: &'h Resolved,
    verifies: bool,
    /// For the names in a file with syntax errors. They are freed when the run ends.
    atoms: &'h dyn Intern,
    /// What is allocated for all files. It is freed when the run ends.
    memory: &'h Session,
}

impl How<'_> {
    /// What the file is parsed as.
    fn language_and_dialect(&self) -> (LanguageOptions, Dialect, ParseOptions) {
        let path = self.path;
        let is_typescript = [&b".ts"[..], b".tsx", b".mts", b".cts"]
            .iter()
            .any(|it| ends_in(path, it));
        let is_oxfmt = self.resolved.options.flavor.is_oxfmt();
        let language = LanguageOptions {
            // oxfmt has oxc's parser, like oxlint.
            refuses_what_parser_refuses: !is_oxfmt,
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
            true if bun_format::flow::goes_to_babel(&self.resolved.options, path) => {
                Dialect::flow(self.is_script)
            }
            true => Dialect::flow_parser(self.is_script),
            false if is_oxfmt => options.dialect,
            false => Dialect::babel(self.is_script),
        };
        (language, dialect, options)
    }
}

/// Parses `text` and calls `then` with the tree, and with what the names in it are of.
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
        how.atoms.of_this_thread(),
        options.experimental_decorators,
        options.every_file_is_a_module,
        // The names are the file's own.
        |summary, atoms| then(summary, atoms, &language),
    )
}

/// Parses `text` and calls `then` with the file, with its tree if `how.verifies`, and with the first error in it.
fn with_file<R>(
    how: &How,
    text: &[u8],
    then: impl for<'a> FnOnce(&'a File<'a>, Option<&Program<'a>>, Refused<'a>) -> R,
) -> R {
    let (path, session) = (how.path, how.memory);
    let arena = session.arena();
    with_tree(how, text, |mut summary, atoms, language| {
        // To tell which imports are used takes symbols.
        let needs_symbols = how
            .resolved
            .options
            .sort_imports
            .as_deref()
            .is_some_and(|it| it.needs_symbols());
        let mut recycled = Recycled::of_this_thread();
        // Where the parser has left it, if that will do.
        if !needs_symbols
            && let Summary::InPlace(hir) = &mut summary
            && let Some(bound) = try_bind_for_format_in(&**hir, &mut recycled)
        {
            let file = File::new(path, &**hir, bound, atoms, language, None).with_text(text);
            let program = how.verifies.then(|| Program::new(&**hir, text, atoms));
            return then(
                &file,
                program.as_ref(),
                Refused {
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
        };
        let program = how.verifies.then(|| Program::new(&hir, text, atoms));
        if needs_symbols {
            let bound = bind(&hir, bind_options, atoms, arena);
            return then(
                &File::new(path, &hir, &bound, atoms, language, None),
                program.as_ref(),
                Refused {
                    first_error: hir.diagnostics.first(),
                    is_nested_too_deeply: hir.ran_out_of_stack || bound.ran_out_of_stack,
                },
            );
        }
        let bound = bind_for_format_in(&hir, bind_options, atoms, &mut recycled);
        then(
            &File::new(path, &hir, bound, atoms, language, None),
            program.as_ref(),
            Refused {
                first_error: hir.diagnostics.first(),
                is_nested_too_deeply: hir.ran_out_of_stack || bound.ran_out_of_stack,
            },
        )
    })
}

/// What the parser and the binder have to say against a file.
#[derive(Copy, Clone)]
struct Refused<'a> {
    first_error: Option<&'a Diagnostic>,
    /// There was no stack for it. Nothing else is known about the file.
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

/// What is allocated to format a file, and used again for the next.
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
    /// For the blocks of code in Markdown.
    blocks: Option<Box<Scratches>>,
    /// What is to be said about the file that has been formatted last, though it has been formatted.
    warnings: Vec<Problem>,
}

fn without_final_newline(out: &mut Vec<u8>) {
    let end = match &out[..] {
        [rest @ .., b'\r', b'\n'] | [rest @ .., b'\n' | b'\r'] => rest.len(),
        _ => out.len(),
    };
    out.truncate(end);
}

/// For a block of code in Markdown. Appends `code` formatted as the file at `path`. `false`: it cannot be, and stays as
/// it is.
fn format_block(path: &[u8], code: &[u8], options: &FormatOptions, out: &mut Vec<u8>) -> bool {
    let names = Session::new();
    let names = (&Interner::new_in(&names) as &dyn Intern, &names);
    format_block_in(path, code, options, out, names, &mut Scratches::default())
}

/// The same with what the caller keeps from one block to the next.
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

/// For the scripts and expressions in HTML.
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

/// For the expressions in a component of Svelte.
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
                let mut recycled = Recycled::of_this_thread();
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
            // The stack has ended there.
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

/// Whether the two texts are the same value. What cannot be read as a value, with a key twice, is not looked at.
fn is_same_toml(before: &[u8], after: &[u8]) -> bool {
    use bun_lint::json::{Notation, parse_as};
    match parse_as(Notation::Toml, before) {
        Ok(before) => parse_as(Notation::Toml, after).is_ok_and(|after| after == before),
        Err(_) => true,
    }
}

/// The formatted text, and where the cursor is in it, if `cursorOffset` says where it was.
type Formatted = (Vec<u8>, Option<u32>);

/// The formatted text of the file at `path`. `verifies`: it is parsed and compared with `text`.
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
    // What `>` of Windows PowerShell writes. Some parsers take it for UTF-8 with a NUL next to every letter.
    if matches!(text, [0xFF, 0xFE, ..] | [0xFE, 0xFF, ..]) {
        return Err(Failure::Syntax(Problem::new(
            b"This file is UTF-16. bun fmt only reads UTF-8",
        )));
    }
    // The name says what kind of file it is. Whether it is TypeScript is up to `path`.
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
            let mut sorted = Vec::new();
            let text = match options
                .sort_package_json
                .filter(|_| paths::basename(name) == b"package.json")
            {
                Some(sort) if bun_format::json::sort_package_json(text, sort, &mut sorted) => {
                    &sorted[..]
                }
                _ => text,
            };
            let done = bun_format::json::format(text, parser, options, &mut scratch.json, &mut out);
            return finish(done, out, "JSON");
        }
        Some(Kind::Css(parser)) => {
            let done = bun_format::css::format(text, parser, options, &mut scratch.css, &mut out);
            return finish(done, out, "CSS");
        }
        Some(Kind::Yaml) => {
            let done = bun_format::yaml::format(text, options, &mut scratch.yaml, &mut out);
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
            if verifies && done.is_ok() && out != text && !is_same_toml(text, &out) {
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
            let mut places = Places::new(text);
            scratch.warnings = (scratch.svelte.unformatted().iter())
                .map(|it| places.problem(&it.message, it.at))
                .collect();
            return finish(done, out, "Svelte");
        }
        Some(Kind::Handlebars) => {
            let done =
                bun_format::handlebars::format(text, options, &mut scratch.handlebars, &mut out);
            if verifies && done.is_ok() && out != text {
                match bun_format::handlebars::says_the_same(text, &out, options) {
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
        BeforeParsing::LeaveAsItIs => return Ok((text.to_vec(), options.cursor_offset)),
        BeforeParsing::Format(text) => text,
    };
    // `babel` hands a file of Flow to `babel-flow`, which reads what is in `/*:: */` and `/*: */` as code.
    let is_flow = match options.parser.as_deref() {
        Some(b"flow" | b"babel-flow") => true,
        // oxfmt does not read Flow.
        Some(b"babel") | None => {
            !options.flavor.is_oxfmt()
                && (bun_lint::linter::goes_to_flow(&text, name)
                    || (options.parser.is_none() && ends_in(name, b".js.flow")))
        }
        Some(_) => false,
    };
    let has_comment_types = is_flow
        && bun_format::flow::goes_to_babel(options, path)
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
    for &is_script in kinds(name) {
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
    refused: Refused<'_>,
    how: &How,
    scratch: &mut Scratches,
) -> Result<Formatted, Failure> {
    if refused.is_nested_too_deeply {
        return Err(Failure::Syntax(Problem::new(NESTED_TOO_DEEPLY)));
    }
    let options = &how.resolved.options;
    // `babel` refuses the syntax of TypeScript. The parsers that take it have to be asked for by name.
    let takes_types = matches!(
        options.parser.as_deref(),
        Some(b"flow" | b"babel-flow" | b"typescript" | b"babel-ts")
    );
    let types = match takes_types {
        true => TypesInJavaScript::Tolerated,
        false => TypesInJavaScript::Refused,
    };
    let refusal = match options.flavor.is_oxfmt() {
        true if how.resolved.formats_what_has_errors && !file.has_parse_errors() => None,
        true => bun_lint::linter::refusal_of_oxfmt(file),
        false => bun_lint::linter::refusal_of_prettier(file, types),
    };
    if let Some(why) = refusal {
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
            return Err(Failure::Syntax(syntax_error(file, refused.first_error)));
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
            let after = match &after {
                Summary::InPlace(hir) => Program::new(&**hir, &out, atoms),
                Summary::InArena(hir) => Program::new(&**hir, &out, atoms),
            };
            bun_format::verify::compare(file, program, &after, options, &mut scratch.verify).is_ok()
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
    with_file(how, text, |file, program, refused| {
        if refused.is_nested_too_deeply {
            return Err(Failure::Syntax(Problem::new(NESTED_TOO_DEEPLY)));
        }
        // A file whose imports move is parsed again.
        let how_to_sort = how.resolved.options.sort_imports.as_deref();
        match how_to_sort.and_then(|how| bun_format::sort_imports::sorted_text(file, how)) {
            Some(sorted) => with_file(how, &sorted, |after, program, refused| {
                if how.verifies && !how_to_sort.is_some_and(|it| it.keeps_imports(file, after)) {
                    return Err(Failure::Changed(
                        "sorting imports would change what the code does",
                    ));
                }
                print((after, program), refused, how, scratch)
            }),
            None => print((file, program), refused, how, scratch),
        }
    })
}

/// Why `bun fmt` leaves a file as it is.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// It has a syntax error or is nested too deeply.
    Syntax,
    /// A bug in the formatter, which it has noticed itself.
    Bug,
}

/// The text of the file at `path` formatted with `options`, the way `bun fmt` does it, and where
/// the cursor ends up. For the tests of the formatter.
pub fn format_for_tests(
    path: &[u8],
    text: &[u8],
    options: &FormatOptions,
) -> Result<(Vec<u8>, Option<u32>), Refusal> {
    let resolved = Resolved {
        options: FormatOptions {
            format_javascript: Some(format_block),
            parse_javascript: Some(parse_javascript),
            parse_parts: Some(parse_parts),
            ..options.clone()
        },
        formats_what_has_errors: true,
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
        Failure::Syntax(_) | Failure::Unread(_) => Refusal::Syntax,
        Failure::Bug | Failure::Changed(_) => Refusal::Bug,
    })
}

/// What `--debug-check` says about the Svelte component `before` if `after` is what it is formatted to: whether both say the
/// same. For the tests of the check, which the formatter gives nothing to complain about.
pub fn is_same_svelte_for_tests(before: &[u8], after: &[u8]) -> bool {
    let options = FormatOptions {
        parse_javascript: Some(parse_javascript),
        parse_parts: Some(parse_parts),
        ..FormatOptions::default()
    };
    bun_format::svelte::has_same_content(before, after, &options, None)
}

/// Why the file at `path`, which has `scope`, is in no language that is known.
fn has_no_parser(configs: &Configs, scope: &config::Scope, path: Vec<u8>) -> Vec<u8> {
    let is_off = || configs.asks_for_parser_of_svelte() && configs.turns_svelte_off_for(&path);
    let reason: &[u8] = match configs.leaves_svelte_for_part(scope, &path) {
        true => b"A range or a cursor offset cannot be used with a Svelte file: \"",
        false if is_off() => b"Cannot use --parser svelte, because Svelte is off for \"",
        false => b"No parser could be inferred for file \"",
    };
    [reason, &paths::to_native(path)[..], b"\"."].concat()
}

/// What has become of a file.
enum Done {
    Unchanged,
    /// It is not formatted. With `--write`, it was not. And how long that took to find out.
    Different(Duration),
    /// Skipped: neither formatted nor written. See [`git::Files::is_partly_staged`].
    PartlyStaged,
    /// It has classes of Tailwind CSS whose order is not known yet.
    PutAside,
    /// For the user. The exit code is 2.
    Failed(Vec<u8>),
    /// The same.
    Refused(Failure),
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
    /// Some of the files that were found have not been looked at, so nothing can be said about all of them.
    has_left_files: bool,
}

/// What the file at `path`, which has `scope`, is to the tool that the run stands in for.
fn language_of(configs: &Configs, scope: &config::Scope, path: &[u8]) -> Language {
    // The `parser` option says what it is. One that Prettier does not have is that of a plugin.
    match configs.parser_for(scope, path) {
        Some(parser) if &*parser == b"svelte" && !configs.formats_svelte(scope, Some(path)) => {
            Language::Other
        }
        Some(parser) if Kind::of_parser(&parser).is_none() => Language::Other,
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
            Language::Unknown if configs.is_read_by_plugin(scope, path) => Language::Other,
            Language::Supported if configs.is_read_by_plugin(scope, path) => Language::Other,
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

    /// `src/a.js (1ms)`: how `oxfmt --check` names a file.
    fn log_with_time(&mut self, shown: &[u8], took: Duration) {
        if self.options.log_level >= LogLevel::Log {
            pretty!(
                &mut self.out.stdout,
                self.colors(),
                "<yellow>{}<r> ({}ms)\n",
                BStr::new(shown),
                took.as_millis()
            );
        }
    }

    /// What oxfmt says at the end of a run, in which so many files were not formatted, were, and could not be.
    fn sum_up_as_oxfmt(&mut self, [different, unchanged, failed]: [usize; 3], threads: usize) {
        let total = different + unchanged + failed;
        let says_errors = self.options.log_level >= LogLevel::Error;
        if failed > 0 {
            if says_errors {
                let text = b"Error occurred when checking code style in the above files.\n";
                self.out.stderr.extend_from_slice(text);
            }
            return;
        }
        if total == 0 {
            // Why there is none has been said.
            if self.out.exit_code != 0 {
                return;
            }
            if says_errors {
                let text = b"No files found matching the given patterns.\n";
                self.out.stderr.extend_from_slice(text);
            }
        } else if self.options.list_different {
            return;
        } else if self.options.check && different == 0 {
            if !self.has_left_files {
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
    fn sum_up_check(&mut self, [different, unchanged, failed]: [usize; 3]) {
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
        let is_all = different + failed == 0 && self.out.exit_code == 0 && !self.has_left_files;
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

    /// A warning looks the same whichever config there is.
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

    /// A line of what Prettier's `--check` prints: a file that isn't formatted, or how many there are. It's the result of the
    /// run and not a warning about it, so it stays as scripts know it.
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

    /// An error looks the same whichever config there is.
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

    /// The configuration, or what says which files to ignore, cannot be used.
    fn fail_to_start(self, flavor: Flavor, text: &[u8]) -> Outcome {
        let mut out = self.fail(text);
        if flavor == Flavor::Oxfmt || config::is_invalid_value(text) {
            out.exit_code = 1;
        }
        out
    }

    /// Says what is wrong in the file that is shown as `shown`, which has been formatted all the same.
    fn report_warnings(&mut self, shown: &[u8], warnings: &[Problem]) {
        if self.options.log_level >= LogLevel::Warn {
            for problem in warnings {
                let printed = problem.print(shown, bun_ast::Kind::Warn, self.colors());
                self.out.stderr.extend_from_slice(&printed);
            }
        }
    }

    /// Says why the file that is shown as `shown` is left as it is. Not in the way of Prettier or oxfmt, whose words for it
    /// are others anyway.
    fn report(&mut self, shown: &[u8], failure: &Failure) {
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
            let printed = problem.print(shown, kind, self.colors());
            self.out.stderr.extend_from_slice(&printed);
        }
        if kind == bun_ast::Kind::Err {
            self.out.exit_code = 2;
        }
    }

    /// What Prettier's `--debug-check` prints in place of the formatted text of standard input. `path`: of
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
        let only_looks = self.options.check || self.options.list_different;
        // Prettier's `listDifferent` says `error.message` of what `check` throws, and that is all.
        let forgives = configs.flavor == Flavor::Prettier && only_looks;
        // The configuration of a file that is ignored is not even read.
        let is_of_a_package =
            configs.flavor == Flavor::Prettier && ignored.is_in_node_modules(&path);
        if is_of_a_package || ignored.ignores_file(&path, &None) {
            self.out.stdout = text;
            return self.out;
        }
        configs.name(paths::dirname(&path));
        let scope = match configs.for_directory(paths::dirname(&path)) {
            Ok(scope) => scope,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        let language = language_of(configs, &scope, &path);
        let is_ignored = ignored.ignores_file(&path, configs.ignores_of(&scope));
        let is_of_plugin = configs.plugin_that_reads(&scope, &path).is_some();
        let not_installed = match language == Language::Other && is_of_plugin {
            true => self.not_installed(configs, &scope, Some(&path)),
            false => Vec::new(),
        };
        if language == Language::Other && !is_ignored && is_of_plugin && not_installed.is_empty() {
            let config = configs.path_of_config(&scope);
            return self.format_stdin_with_prettier((Some(&path), config), (name, &text));
        }
        let mut options = match configs.options_for(&scope, &path) {
            Ok(options) => options,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        // oxfmt gives a component back that it is not to format.
        let is_left_by_oxfmt = language == Language::Unknown
            && configs.is_oxfmt_for(&scope)
            && files::is_svelte_for_oxfmt(&path);
        if is_ignored || is_left_by_oxfmt {
            self.out.stdout = text;
            return self.out;
        }
        // As for a file. Who gets the text back with 0 takes it for formatted.
        let allows = self.options.allow_unsupported;
        // It is the plugin that is missing, not the language.
        let plugin = (configs.plugin_that_reads(&scope, &path))
            .filter(|_| files::language_of(&path) == Language::Supported);
        if let (Language::Other, Some(plugin)) = (language, plugin) {
            self.say_not_installed(&not_installed);
            if !allows {
                self.say_left_for_plugins(1, &[plugin]);
                return self.out;
            }
        } else if language == Language::Other {
            self.say_unsupported(&mut [(ending_of(&path), 1)], &not_installed);
            if allows && !only_looks {
                self.out.stdout = text;
            }
            return self.out;
        }
        let missing_plugins = configs.missing_plugins(&scope, Some(&path));
        if language == Language::Supported && !allows && !missing_plugins.is_empty() {
            let names: Vec<&[u8]> = missing_plugins.iter().map(|it| &it[..]).collect();
            self.say_left_for_plugins(1, &names);
            return self.out;
        }
        if Kind::with_options(&path, &options.options).is_none() {
            // `handleError` has nothing to say then. `listDifferent` has said it before.
            if configs.flavor == Flavor::Prettier && self.options.ignore_unknown && !only_looks {
                return self.out;
            }
            let mut out = self.fail_to_start(configs.flavor, &has_no_parser(configs, &scope, path));
            if forgives {
                out.exit_code = 0;
            }
            return out;
        }
        let kind = Kind::with_options(&path, &options.options);
        tailwind::only_where_sorted(&mut options.options, kind);
        let piped = Piped {
            text,
            shown: name,
            paths: &[&path],
        };
        self.print_stdin(configs, piped, options)
    }

    /// `prettier --parser x < file`: Prettier's `formatStdin` without `--stdin-filepath`. Whatever goes by a file name doesn't
    /// apply: ignore files, overrides, `.editorconfig`.
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
        let only_looks = self.options.check || self.options.list_different;
        let forgives = configs.flavor == Flavor::Prettier && only_looks;
        let scope = configs.for_directory(&self.environment.cwd);
        let found = scope.and_then(|scope| Ok((configs.options_without_name(&scope)?, scope)));
        let (mut options, scope) = match found {
            Ok(found) => found,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        // `--config-precedence` can make a config file without `parser` win over the flag.
        let Some(parser) = options.options.parser.clone() else {
            if configs.flavor == Flavor::Prettier && self.options.ignore_unknown && !only_looks {
                return self.out;
            }
            self.error(b"No parser and no file path given, couldn't infer a parser.");
            if forgives {
                self.out.exit_code = 0;
            }
            return self.out;
        };
        let is_formatted = |kind: &Kind| *kind != Kind::Svelte || options.options.svelte.is_on;
        let Some(kind) = Kind::of_parser(&parser).filter(is_formatted) else {
            if !configs.names_other_plugins(&scope, None) {
                self.error(&cannot_resolve_parser(&parser));
                self.out.exit_code = match (self.is_native, forgives) {
                    (true, _) => 2,
                    (false, true) => 0,
                    (false, false) => 1,
                };
                return self.out;
            }
            // It can only be a plugin's.
            let not_installed = self.not_installed(configs, &scope, None);
            if not_installed.is_empty() {
                let config = configs.path_of_config(&scope);
                return self.format_stdin_with_prettier((None, config), (b"stdin", &text));
            }
            self.say_unsupported(&mut [(&parser, 1)], &not_installed);
            if self.options.allow_unsupported && !only_looks {
                self.out.stdout = text;
            }
            return self.out;
        };
        let missing_plugins = configs.missing_plugins(&scope, None);
        if !self.options.allow_unsupported && !missing_plugins.is_empty() {
            let names: Vec<&[u8]> = missing_plugins.iter().map(|it| &it[..]).collect();
            self.say_left_for_plugins(1, &names);
            return self.out;
        }
        tailwind::only_where_sorted(&mut options.options, Some(kind));
        let paths = syntaxes_to_try(&parser, &text);
        let piped = Piped {
            text,
            shown: b"stdin",
            paths,
        };
        self.print_stdin(configs, piped, options)
    }

    /// The packages that aren't installed, of those it takes to hand the file at `path` to the project's own Prettier.
    fn not_installed<'s>(
        &self,
        configs: &'s Configs,
        scope: &'s config::Scope,
        path: Option<&[u8]>,
    ) -> Vec<&'s [u8]> {
        let mut missing: Vec<&[u8]> = Vec::new();
        for package in [&b"prettier"[..]]
            .into_iter()
            .chain(configs.packages_of_plugins(scope, path))
        {
            if !prettier::is_installed(&self.environment.cwd, package)
                && !missing.contains(&package)
            {
                missing.push(package);
            }
        }
        missing
    }

    /// Standard input in the language of a plugin: see `prettier.rs`. `shown` is its name in error messages.
    fn format_stdin_with_prettier(
        mut self,
        (path, config): (Option<&[u8]>, Option<&[u8]>),
        (shown, text): (&[u8], &[u8]),
    ) -> Outcome {
        let only_looks = self.options.check || self.options.list_different;
        let size = (1, text.len() as u64);
        let bridge = prettier::Prettier::new(self.environment, self.options, size, 1);
        match bridge.format(path, config, text) {
            // Prettier's `listDifferent` prints `error.message` of what `check` throws, and that is all.
            Err(Unformatted::Message(message)) if only_looks => {
                self.error(&message);
                self.out.exit_code = 0;
            }
            // Prettier's `handleError` prints only `error.message` of a `ConfigError`, like a parser that no plugin has.
            Err(Unformatted::Thrown(why)) if why.starts_with(b"ConfigError: ") => {
                let message = &why[b"ConfigError: ".len()..];
                let end = strings::index_of(message, b"\n    at ").unwrap_or(message.len());
                self.error(&message[..end]);
                self.out.exit_code = 1;
            }
            Err(why) => self.error(&[shown, b": ", &prettier::describe(why)].concat()),
            Ok(formatted) if only_looks => {
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

    /// Formats what came from standard input, then prints the result, or what `--check` says about it.
    fn print_stdin(mut self, configs: &Configs, piped: Piped, mut options: Resolved) -> Outcome {
        let Piped {
            text,
            shown: name,
            paths,
        } = piped;
        let only_looks = self.options.check || self.options.list_different;
        let forgives = configs.flavor == Flavor::Prettier && only_looks;
        for warning in std::mem::take(&mut *configs.warnings.lock()) {
            self.warn(&warning);
        }
        let names = Session::new();
        // Prettier's `listDifferent` comes first, and that is all.
        let verifies = self.options.debug_check && !only_looks;
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
                // As for a file.
                Err(error) if self.options.allow_unsupported => {
                    self.warn(&error);
                    options.options.tailwind = None;
                }
                Err(error) => return self.fail(&error),
            }
            formatted = format_text(&options);
            if (options.options.tailwind.as_deref()).is_some_and(Tailwind::has_missed) {
                return self.fail(&has_classes_without_order(name));
            }
        }
        if formatted.is_ok() {
            self.report_warnings(name, &scratch.warnings);
        }
        match formatted {
            Err(failure @ Failure::Unread(_)) => {
                self.report(name, &failure);
                if !only_looks {
                    self.out.stdout = text;
                }
            }
            Err(failure @ Failure::Syntax(_)) if forgives => {
                self.report(name, &failure);
                self.out.exit_code = 0;
            }
            Err(failure) => self.report(name, &failure),
            // Prettier's `listDifferent`: with `--write` it has nothing to say, and nothing is printed either.
            Ok((formatted, _)) if only_looks => {
                if formatted != text && !self.options.write {
                    self.log(b"(stdin)");
                    self.out.exit_code = 1;
                }
            }
            Ok(_) if verifies => {
                let is_named = !self.options.formats_unnamed_stdin();
                let path = paths.first().filter(|_| is_named);
                self.out.stdout = Self::name_of_stdin(path.copied());
            }
            Ok((formatted, cursor)) => {
                self.out.stdout = formatted;
                // As Prettier: where the cursor is now.
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
        // Files are written unless a flag says otherwise.
        let asks_for_different = (options.check || options.list_different) && !options.write;
        let only_looks = asks_for_different || options.debug_check;
        let is_oxfmt = configs.flavor == Flavor::Oxfmt;
        let only =
            (options.only.as_ref()).map(|it| git::Files::read(it, !only_looks, self.environment));
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
                    let _ = writeln!(self.out.stderr, "{}", only.nothing_left("format"));
                }
                return self.out;
            }
        }
        let finding = started.elapsed();

        // What is not to be formatted after all.
        let mut others: Vec<(&[u8], usize)> = Vec::new();
        // How many files are left alone because of plugins that are not there, and which.
        let mut left_for_plugins: (usize, Vec<&[u8]>) = (0, Vec::new());
        let is_wanted = |target: &Target| match target.is_named {
            true => !ignored.ignores_file(&target.path, configs.ignores_of(&target.scope)),
            // Without a Prettier or oxfmt config, minified code and lock files are only formatted when they're named.
            false => !(files::is_generated(&target.path) && configs.is_native_in(&target.scope)),
        };
        let mut work: Vec<(usize, &Target)> = Vec::new();
        // What goes to the project's own Prettier, and the plugins that would have to be installed for more to go there.
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
                _ if !is_wanted(target) => {}
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
                    if (configs.plugin_that_reads(&target.scope, &target.path)).is_some()
                        && [&b"prettier"[..]]
                            .into_iter()
                            .chain(configs.packages_of_plugins(&target.scope, Some(&target.path)))
                            .all(&mut has_package) =>
                {
                    handed_over.push((index, target));
                }
                Language::Other => {
                    let plugin = configs.plugin_that_reads(&target.scope, &target.path);
                    if plugin.is_some() {
                        for package in [&b"prettier"[..]]
                            .into_iter()
                            .chain(configs.packages_of_plugins(&target.scope, Some(&target.path)))
                        {
                            if !has_package(package) && !not_installed.contains(&package) {
                                not_installed.push(package);
                            }
                        }
                    }
                    // It is the plugin that is missing, not the language.
                    if let Some(plugin) = plugin
                        && files::language_of(&target.path) == Language::Supported
                    {
                        if options.allow_unsupported {
                            work.push((index, target));
                        } else {
                            left_for_plugins.0 += 1;
                            if !left_for_plugins.1.contains(&plugin) {
                                left_for_plugins.1.push(plugin);
                            }
                        }
                        continue;
                    }
                    let kind = ending_of(&target.path);
                    match others.iter_mut().find(|it| it.0 == kind) {
                        Some(entry) => entry.1 += 1,
                        None => others.push((kind, 1)),
                    }
                }
                Language::Unknown if target.ignores_unknown || options.ignore_unknown => {}
                Language::Unknown => {
                    let path = target.path.clone();
                    done[index] = Some(Done::Failed(has_no_parser(configs, &target.scope, path)));
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
        // The largest first, so that no thread begins it when the others are nearly done.
        sort_slice_by(&mut work[..], |a, b| b.1.size.cmp(&a.1.size));
        let started = Instant::now();
        // Has to come before the first parallel region. The pool's threads have enough stack to walk a tree as deep as a parser
        // allows.
        bun_sema_driver::use_a_pool_of_their_own("Bun Format");
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
        // By the place of a file in `expanded`.
        let mut warnings: Guarded<Vec<(usize, Vec<Problem>)>> = Guarded::new(Vec::new());
        // Tailwind cannot be asked, and that is allowed.
        let leaves_classes = AtomicBool::new(false);
        let once = fs::Written::default();
        let format_at = |at: usize| {
            let (index, target) = work[at];
            let began = Instant::now();
            let shown = paths::relative(cwd, &target.path);
            let mut scratch = scratches.lock().pop().unwrap_or_default();
            let result = (|| {
                let mut options = configs
                    .options_for(&target.scope, &target.path)
                    .map_err(|error| error.0)?;
                if leaves_classes.load(Ordering::Relaxed) {
                    options.options.tailwind = None;
                }
                let text = fs::read(&target.path).map_err(|error| {
                    [
                        b"Unable to read file \"",
                        &shown[..],
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
                    Err(failure) => return Ok(Done::Refused(failure)),
                };
                if options
                    .options
                    .tailwind
                    .as_deref()
                    .is_some_and(Tailwind::has_missed)
                {
                    return Ok(Done::PutAside);
                }
                if !scratch.warnings.is_empty() {
                    let all = std::mem::take(&mut scratch.warnings);
                    warnings.lock().push((index, all));
                }
                if formatted == text {
                    return Ok(Done::Unchanged);
                }
                if !only_looks && is_partly_staged(target) {
                    return Ok(Done::PartlyStaged);
                }
                if !only_looks {
                    fs::write_atomically(&once, cwd, &target.path, &formatted).map_err(|why| {
                        [b"Unable to write file \"", &shown[..], b"\":\n", &why].concat()
                    })?;
                }
                Ok(Done::Different(began.elapsed()))
            })();
            scratches.lock().push(scratch);
            results.lock()[index] = Some(result.unwrap_or_else(Done::Failed));
        };
        pool.for_each(work.len(), 1, &format_at);
        let put_aside: Vec<usize> = (0..work.len())
            .filter(|&at| matches!(results.lock()[work[at].0], Some(Done::PutAside)))
            .collect();
        let mut classes_are_unknown = None;
        if !put_aside.is_empty() {
            classes_are_unknown = configs.classes.ask(self.environment).err();
            // A Tailwind that cannot be asked takes only its own files with it, as in the next run, which knows the answers
            // of the others.
            pool.for_each(put_aside.len(), 1, &|at| format_at(put_aside[at]));
            if let Some(error) = &mut classes_are_unknown {
                let left: Vec<usize> = (put_aside.iter().copied())
                    .filter(|&at| matches!(results.lock()[work[at].0], Some(Done::PutAside)))
                    .collect();
                let count = left.len();
                let said = match (options.allow_unsupported, count) {
                    (true, 1) => "\nClasses were not sorted in 1 file.".to_owned(),
                    (true, _) => format!("\nClasses were not sorted in {count} files."),
                    (false, 1) => "\n1 file with classes was not formatted.".to_owned(),
                    (false, _) => format!("\n{count} files with classes were not formatted."),
                };
                error.extend_from_slice(said.as_bytes());
                if options.allow_unsupported {
                    leaves_classes.store(true, Ordering::Relaxed);
                    pool.for_each(left.len(), 1, &|at| format_at(left[at]));
                }
            }
        }
        if let Some(bridge) = &bridge {
            let is_heavy = |at: usize| handed_over[at].1.size >= HEAVY as u64;
            bridge.for_each(handed_over.len(), &is_heavy, &|at| {
                let (index, target) = handed_over[at];
                let began = Instant::now();
                let shown = paths::relative(cwd, &target.path);
                let config = configs.path_of_config(&target.scope);
                let file = (&target.path[..], &shown[..]);
                let writes = !only_looks && !is_partly_staged(target);
                results.lock()[index] = Some(match bridge.format_file(file, config, writes) {
                    Ok(true) if !only_looks && !writes => Done::PartlyStaged,
                    Ok(true) => Done::Different(began.elapsed()),
                    Ok(false) => Done::Unchanged,
                    Err(error) => Done::Failed(error),
                });
            });
        }
        let formatting = started.elapsed();

        let (mut different, mut unchanged, mut failed) = (0usize, 0usize, 0usize);
        let (mut written, mut partly_staged) = (Vec::new(), Vec::new());
        let mut warnings = std::mem::take(warnings.get_mut());
        sort_slice_by(&mut warnings[..], |a, b| a.0.cmp(&b.0));
        let mut warnings = warnings.into_iter().peekable();
        let results = std::mem::take(results.get_mut());
        for (index, (it, done)) in expanded.iter().zip(results).enumerate() {
            let target = match it {
                Expanded::Error(error) => {
                    self.error(error);
                    continue;
                }
                Expanded::File(target) => target,
            };
            let shown = paths::relative(cwd, &target.path);
            if let Some((_, all)) = warnings.next_if(|it| it.0 == index) {
                self.report_warnings(&shown, &all);
            }
            match done {
                None => {}
                Some(Done::Unchanged) => {
                    unchanged += 1;
                    if options.debug_check {
                        self.log(&shown);
                    }
                }
                Some(Done::Refused(failure @ Failure::Unread(_))) => {
                    unchanged += 1;
                    self.report(&shown, &failure);
                }
                Some(Done::Refused(failure)) => {
                    failed += 1;
                    self.report(&shown, &failure);
                }
                // Prettier goes no further.
                Some(Done::Failed(error)) if config::is_invalid_value(&error) => {
                    self.error(&error);
                    self.out.exit_code = 1;
                    return self.out;
                }
                Some(Done::Failed(error)) => {
                    failed += 1;
                    self.error(&error);
                }
                Some(Done::PutAside) => {
                    failed += 1;
                    let text = has_classes_without_order(&shown);
                    self.error(&[&text[..], b" It was not formatted."].concat());
                }
                Some(Done::PartlyStaged) => {
                    failed += 1;
                    partly_staged.push(target.path.clone());
                }
                Some(Done::Different(took)) => {
                    different += 1;
                    if !only_looks && only.is_some() {
                        written.push(target.path.clone());
                    }
                    match (is_oxfmt, options.check) {
                        (true, true) => self.log_with_time(&shown, took),
                        // oxfmt does not name the files that it writes.
                        (true, false) if !options.list_different => {}
                        (false, true) if !self.is_native => self.list_as_prettier(&shown),
                        // The list of files is what `--check` was asked for, so it goes to stdout.
                        (false, true) if options.log_level >= LogLevel::Warn => {
                            self.out.stdout.extend_from_slice(&shown);
                            self.out.stdout.push(b'\n');
                        }
                        // Every file that passes is named below.
                        (false, false) if options.debug_check && !options.list_different => {}
                        _ => self.log(&shown),
                    }
                    if options.debug_check {
                        self.log(&shown);
                    }
                }
            }
        }
        if let Some(only) = &only {
            if !partly_staged.is_empty() {
                self.error(&only.refusal_to_write(&mut partly_staged, "formatted"));
            }
            if let Err(Fatal(error)) = only.stage(&written) {
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
        // Why is said at the end.
        self.has_left_files = left_for_plugins.0 > 0
            || !others.is_empty()
            || (classes_are_unknown.is_some() && !options.allow_unsupported);
        // oxfmt has no `--debug-check`, so there it is as without a config.
        if is_oxfmt && (options.check || !options.debug_check) {
            self.sum_up_as_oxfmt([different, unchanged, failed], pool.threads());
        } else if self.is_native {
            if options.check && only_looks {
                self.sum_up_check([different, unchanged, failed]);
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
                if !self.has_left_files {
                    self.log(b"All matched files use Prettier code style!");
                }
            } else if only_looks {
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
        if asks_for_different && different > 0 && self.out.exit_code == 0 {
            self.out.exit_code = 1;
        }
        let sums_up = match self.is_native {
            true => !only_looks,
            false => !is_oxfmt && !options.check && !options.list_different && !only_looks,
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
            self.say_left_for_plugins(*count, names);
        }
        // The tool that this stands in for would have formatted or checked them, so this comes last and is an error.
        if !others.is_empty() {
            self.say_unsupported(&mut others, &not_installed);
        } else {
            self.say_not_installed(&not_installed);
        }
        self.out
    }

    /// So many files are left alone because of plugins that are not there: `names`.
    fn say_left_for_plugins(&mut self, count: usize, names: &[&[u8]]) {
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

    /// The packages that would have to be installed for more files to go to the project's own Prettier.
    fn say_not_installed(&mut self, not_installed: &[&[u8]]) {
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

    /// `others`: the endings of the files in another language, and how many have each. `not_installed`: the packages that would
    /// have to be installed for them to go to the project's own Prettier.
    fn say_unsupported(&mut self, others: &mut [(&[u8], usize)], not_installed: &[&[u8]]) {
        sort_slice_by(others, |a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        let count: usize = others.iter().map(|it| it.1).sum();
        let (noun, its) = match count {
            1 => ("file was", "its"),
            _ => ("files were", "their"),
        };
        let kinds: Vec<Vec<u8>> = others
            .iter()
            .map(|it| format!("{} {}", it.1, BStr::new(it.0)).into_bytes())
            .collect();
        let text = format!(
            "{count} {noun} not formatted because bun fmt does not support {its} language yet: "
        );
        let text = [text.as_bytes(), &kinds.join(&b", "[..])].concat();
        self.say_not_installed(not_installed);
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
        if !(options.plugins.iter()).all(|it| configs.is_built_in(it)) {
            self.warn(b"--plugin has no effect because bun fmt does not load Prettier plugins");
        }
        if configs.asks_for_parser_of_svelte()
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
            return self.fail(&only.refusal_of_stdin("--stdin-filepath"));
        }
        let is_unnamed = options.formats_unnamed_stdin();
        if let Some(only) = options.only.as_ref().filter(|_| is_unnamed) {
            return self.fail(&only.refusal_of_stdin("--parser without files"));
        }
        // Prettier and oxfmt both report this before they look at files, patterns or config.
        let is_oxfmt = configs.flavor == Flavor::Oxfmt;
        if let Some(refusal) = options.refusal_of_modes(is_oxfmt) {
            let mut out = self.fail(&refusal);
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
                    let shown = paths::relative(&environment.cwd, &config.path);
                    self.log(&shown);
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
        let is_unknown = |it: &&(&[u8], Vec<u8>)| Kind::of_parser(&it.1).is_none();
        if let Some((_, parser)) = from_flag.filter(is_unknown).filter(|_| !is_unnamed) {
            return self.fail(&cannot_resolve_parser(parser));
        }
        // Prettier reads everything in the directory with that parser: lock files, dotfiles, LICENSE. A Prettier config gets that.
        // oxfmt has no `--parser`.
        let is_directory = |written: &&Vec<u8>| {
            let path = paths::resolve(&environment.cwd, &paths::from_native(written));
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
        let is_said = options.log_level >= LogLevel::Warn && !options.doctor;
        let colors = self.colors();
        let mut out = if is_unnamed {
            self.format_unnamed_stdin(&configs)
        } else {
            let mut ignored = match Ignored::new(options, &environment.cwd, configs.flavor) {
                Ok(ignored) => ignored,
                Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
            };
            match &options.stdin_filepath {
                Some(name) => self.format_stdin(&configs, &ignored, name),
                None => self.format_files(&configs, &mut ignored),
            }
        };
        if let Some(note) = configs.note().filter(|_| is_said) {
            let note = BStr::new(note);
            pretty!(&mut out.stderr, colors, "<blue>note<r><d>:<r> {}\n", note);
        }
        out
    }
}

/// Does what `bun fmt` does. `options.help` and `options.cwd` are for the caller to see to.
pub fn run(options: &Options, environment: &Environment) -> Outcome {
    match options.doctor {
        true => watching(environment, |environment, modules| {
            run_in(options, environment, Some(modules))
        }),
        false => run_in(options, environment, None),
    }
}

fn run_in(options: &Options, environment: &Environment, modules: Option<&Modules>) -> Outcome {
    let as_oxfmt = options
        .as_oxfmt_reads_it()
        .filter(|_| Configs::new(options, environment).flavor == Flavor::Oxfmt);
    let options = as_oxfmt.as_ref().unwrap_or(options);
    let run = Run {
        options,
        environment,
        out: Outcome::default(),
        began: Instant::now(),
        modules,
        is_native: false,
        has_left_files: false,
    };
    run.execute()
}
