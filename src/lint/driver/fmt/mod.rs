//! `bun format`: the command line of Prettier, on all threads.
//!
//! - [`cli`]: the flags.
//! - [`run`]: `bun format`, given the flags and an [`Environment`].

pub mod cli;
mod config;
mod editorconfig;
mod files;
mod prettier;
mod tailwind;

use crate::run::{Environment, Fatal, Outcome, Pool};
use crate::{fs, paths};
use bstr::BStr;
use bun_collections::index_sort::sort_slice_by;
use bun_core::strings;
use bun_format::pragma::BeforeParsing;
use bun_format::syntax_error::SyntaxError;
use bun_format::tailwind::Tailwind;
use bun_format::verify::Program;
use bun_format::{FormatError, FormatOptions, Scratch};
use bun_js_parser::sema::Summary;
use bun_lint::ast::File;
use bun_lint::language::{LanguageOptions, ParseOptions, Parser, SourceType};
use bun_lint::linter::TypesInJavaScript;
use bun_lint::utils::code_frame::{self, Frame, Lines, Place, Version};
use bun_lint::utils::text::ends_with_ignore_ascii_case as ends_in;
use bun_sema::atom::{Intern, Interner, InternerPerThread};
use bun_sema::bind::{BindOptions, Recycled, bind, bind_for_format_in, try_bind_for_format_in};
use bun_sema::hir::Diagnostic;
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;
use bun_threading::Guarded;
use cli::{LogLevel, Options};
use config::{Configs, Flavor, Resolved};
use files::{Expanded, Ignored, Kind, Language, Target};
use std::borrow::Cow;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

const NESTED_TOO_DEEPLY: &[u8] = b"RangeError: The code is nested too deeply.";

/// Why a file is left as it is.
enum Failure {
    /// `SyntaxError: ';' expected. (1:7)`
    Syntax(Vec<u8>),
    /// A bug in the formatter.
    Bug(&'static str),
    /// What Prettier prints does not say what the file says.
    Loss(&'static str),
    /// TOML that cannot be read, with what is wrong with it. oxfmt passes over such a file without a word, so it is no
    /// error.
    Unread(Vec<u8>),
}

/// Prettier's message for a parser that it does not have.
fn cannot_resolve_parser(parser: &[u8]) -> Vec<u8> {
    [b"Couldn't resolve parser \"", parser, b"\"."].concat()
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
        let language = LanguageOptions {
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
        let dialect = match self.is_flow {
            true if bun_format::flow::goes_to_babel(&self.resolved.options, path) => {
                Dialect::flow(self.is_script)
            }
            true => Dialect::flow_parser(self.is_script),
            false => Dialect::babel(self.is_script),
        };
        let options = language.parse_options(path);
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
    bun_js_parser::sema::with_summary_in_place(
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

/// Parses `text` and calls `then` with the file, with its tree, and with the first error in it.
fn with_file<R>(
    how: &How,
    text: &[u8],
    then: impl for<'a> FnOnce(&'a File<'a>, &Program<'a>, Option<&'a Diagnostic>) -> R,
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
            return then(
                &file,
                &Program::new(&**hir, text, atoms),
                hir.diagnostics.first(),
            );
        }
        let mut hir = summary.into_arena((arena, session));
        hir.text = Cow::Borrowed(text);
        let bind_options = BindOptions {
            emit_standard_class_fields: true,
            before_es2020: false,
            before_es2017: false,
        };
        if needs_symbols {
            let bound = bind(&hir, bind_options, atoms, arena);
            return then(
                &File::new(path, &hir, &bound, atoms, language, None),
                &Program::new(&hir, text, atoms),
                hir.diagnostics.first(),
            );
        }
        let bound = bind_for_format_in(&hir, bind_options, atoms, &mut recycled);
        then(
            &File::new(path, &hir, bound, atoms, language, None),
            &Program::new(&hir, text, atoms),
            hir.diagnostics.first(),
        )
    })
}

/// `SyntaxError: ';' expected. (1:7)`
fn syntax_error(file: &File, first: Option<&Diagnostic>) -> Vec<u8> {
    let mut out = b"SyntaxError: ".to_vec();
    match first.and_then(|it| Some((it, bun_sema::messages::message(it.code)?.1))) {
        Some((diagnostic, text)) => bun_sema::messages::format(&mut out, text, &diagnostic.args),
        None => out.extend_from_slice(b"Unexpected token"),
    }
    let at = file.position(first.map_or(0, |it| it.start));
    let _ = write!(out, " ({}:{})", at.line, at.column + 1);
    write_frame(&mut out, file, at.line, at.column);
    out
}

/// `SyntaxError: This string is not closed (3:6)`, of a file that is not a script.
#[cold]
fn syntax_error_at(text: &[u8], SyntaxError(message, offset): SyntaxError) -> Vec<u8> {
    syntax_error_in_words(text, message.text().as_bytes(), offset)
}

/// What Prettier appends to a syntax error: the lines around it. `column`: counted from 0.
fn write_frame<'a>(out: &mut Vec<u8>, lines: &(impl Lines<'a> + ?Sized), line: u32, column: u32) {
    let frame = Frame {
        version: Version::Eight,
        start: Place {
            line,
            column: Some(column),
        },
        end: None,
        message: b"",
        lines_above: 2,
        lines_below: 3,
    };
    // Not lines that nobody has written, which fill the screen.
    let first = line.saturating_sub(frame.lines_above).max(1);
    let last = line.saturating_add(frame.lines_below).min(lines.count());
    if (first..=last).all(|it| lines.line(it).len() <= 1000) {
        let len = out.len();
        out.push(b'\n');
        if !code_frame::write(out, lines, &frame) {
            out.truncate(len);
        }
    }
}

/// `offset`: not counting a byte order mark.
#[cold]
fn syntax_error_in_words(text: &[u8], message: &[u8], offset: u32) -> Vec<u8> {
    let text = strings::without_utf8_bom(text);
    let before = &text[..text.len().min(offset as usize)];
    let (mut line, mut line_start, mut from) = (1u32, 0, 0);
    while let Some(found) = strings::index_of_any(&before[from..], b"\n\r") {
        from += found + 1;
        // The `\n` of `\r\n` ends the line.
        if before[from - 1] == b'\n' || text.get(from) != Some(&b'\n') {
            (line, line_start) = (line + 1, from);
        }
    }
    // As Prettier counts them: in UTF-16 code units.
    let column = bun_lint::source::utf16_len(&before[line_start..]);
    let mut out = format!(
        "SyntaxError: {} ({line}:{})",
        BStr::new(message),
        column + 1
    )
    .into_bytes();
    // No more of them than are shown.
    let lines: Vec<&[u8]> = bun_lint::utils::text::lines(text)
        .take(line as usize + 3)
        .collect();
    write_frame(&mut out, &lines[..], line, column);
    out
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
    yaml: bun_format::yaml::Scratch,
    markdown: bun_format::markdown::Scratch,
    verify: bun_format::verify::Scratch,
    /// For the blocks of code in Markdown.
    blocks: Option<Box<Scratches>>,
}

fn without_final_newline(out: &mut Vec<u8>) {
    let end = match &out[..] {
        [rest @ .., b'\r', b'\n'] | [rest @ .., b'\n' | b'\r'] => rest.len(),
        _ => out.len(),
    };
    out.truncate(end);
}

/// What formats a block of code in Markdown. `verifies`: a block that would not be the same program afterwards stays
/// as it is.
fn format_javascript(verifies: bool) -> bun_format::options::FormatJavaScript {
    fn verified(path: &[u8], code: &[u8], options: &FormatOptions, out: &mut Vec<u8>) -> bool {
        format_block(path, code, options, out, true)
    }
    fn unverified(path: &[u8], code: &[u8], options: &FormatOptions, out: &mut Vec<u8>) -> bool {
        format_block(path, code, options, out, false)
    }
    match verifies {
        true => verified,
        false => unverified,
    }
}

/// Appends `code` formatted as the file at `path`. `false`: it cannot be, and stays as it is.
fn format_block(
    path: &[u8],
    code: &[u8],
    options: &FormatOptions,
    out: &mut Vec<u8>,
    verifies: bool,
) -> bool {
    let names = Session::new();
    let names = (&Interner::new_in(&names) as &dyn Intern, &names);
    format_block_in(
        path,
        code,
        options,
        out,
        verifies,
        names,
        &mut Scratches::default(),
    )
}

/// The same with what the caller keeps from one block to the next.
fn format_block_in(
    path: &[u8],
    code: &[u8],
    options: &FormatOptions,
    out: &mut Vec<u8>,
    verifies: bool,
    names: (&dyn Intern, &Session),
    scratch: &mut Scratches,
) -> bool {
    let sort_imports = options.sort_imports.clone();
    let resolved = Resolved {
        options: FormatOptions {
            sort_imports: sort_imports.filter(|it| it.applies_to_embedded_code()),
            ..options.clone()
        },
        omits_final_newline: false,
    };
    let formatted = format(
        path,
        code,
        &resolved,
        names,
        scratch,
        // Of JSX in MDX, which comes in a fragment, what is in the fragment is printed. That is no program.
        verifies && !options.is_mdx_jsx,
    );
    formatted
        .map(|(formatted, _)| out.extend_from_slice(&formatted))
        .is_ok()
}

/// For the scripts and expressions in HTML: calls `then` with `code` parsed as the file at `path`.
fn parse_javascript(
    path: &[u8],
    code: &[u8],
    is_script: bool,
    then: &mut dyn for<'b> FnMut(&'b File<'b>),
) {
    let names = Session::new();
    let how = How {
        path,
        is_script,
        is_flow: false,
        resolved: &Resolved::default(),
        verifies: false,
        atoms: &Interner::new_in(&names),
        memory: &names,
    };
    with_file(&how, code, |file, _, _| then(file));
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
    // What `>` of Windows PowerShell writes. Some parsers take it for UTF-8 with a NUL next to every letter.
    if matches!(text, [0xFF, 0xFE, ..] | [0xFE, 0xFF, ..]) {
        return Err(Failure::Syntax(
            b"SyntaxError: It is encoded as UTF-16. Only UTF-8 is read.".to_vec(),
        ));
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
        Err(FormatError::SyntaxError) => Err(Failure::Syntax(
            format!("SyntaxError: It is not {what}.").into_bytes(),
        )),
        Err(FormatError::SyntaxErrorAt(error)) => {
            Err(Failure::Syntax(syntax_error_at(text, error)))
        }
        Err(FormatError::NestedTooDeeply) => Err(Failure::Syntax(NESTED_TOO_DEEPLY.to_vec())),
        Err(FormatError::InvalidDocument) => Err(Failure::Bug("the formatter failed")),
    };
    let mut out = Vec::new();
    let kind = Kind::with_options(name, options);
    if let (None, Some(parser)) = (kind, &options.parser) {
        return Err(Failure::Syntax(cannot_resolve_parser(parser)));
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
            return finish(done, out, "a style sheet");
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
                    format_block_in(path, code, options, out, verifies, names, &mut blocks)
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
                return Err(Failure::Unread(syntax_error_in_words(
                    text, &message, offset,
                )));
            }
            if verifies && done.is_ok() && out != text && !is_same_toml(text, &out) {
                return Err(Failure::Loss(
                    "formatting it the way oxfmt does would change what is in it",
                ));
            }
            return finish(done, out, "TOML");
        }
        Some(Kind::Handlebars) => {
            let done =
                bun_format::handlebars::format(text, options, &mut scratch.handlebars, &mut out);
            if verifies && done.is_ok() && scratch.handlebars.is_damaged() {
                return Err(Failure::Loss(
                    "formatting it the way Prettier does would change what it means",
                ));
            }
            return finish(done, out, "Handlebars");
        }
        Some(Kind::Html(parser)) => {
            let plain = Resolved::default();
            let parse = |path: &[u8],
                         code: &[u8],
                         is_script: bool,
                         then: &mut dyn for<'b> FnMut(&'b File<'b>)| {
                let how = How {
                    path,
                    is_script,
                    is_flow: false,
                    resolved: &plain,
                    verifies: false,
                    atoms,
                    memory,
                };
                with_file(&how, code, |file, _, _| then(file));
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
                return Err(Failure::Loss(
                    "formatting it the way Prettier does would change what is in it",
                ));
            }
            if matches!(done, Err(FormatError::SyntaxError))
                && let Some((message, offset)) = bun_format::html::syntax_error(text, parser)
            {
                return Err(Failure::Syntax(syntax_error_in_words(
                    text, &message, offset,
                )));
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
    Err(first_failure.unwrap_or(Failure::Bug("the formatter failed")))
}

fn print<'a>(
    (file, program): (&'a File<'a>, &Program<'a>),
    first_error: Option<&Diagnostic>,
    how: &How,
    scratch: &mut Scratches,
) -> Result<Formatted, Failure> {
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
        true => bun_lint::linter::refusal_of_oxfmt(file, types),
        false => bun_lint::linter::refusal_of_prettier(file, types),
    };
    if let Some(why) = refusal {
        let at = file.position(why.at);
        let mut out = format!(
            "SyntaxError: {} ({}:{})",
            BStr::new(&why.message),
            at.line,
            at.column + 1
        )
        .into_bytes();
        write_frame(&mut out, file, at.line, at.column);
        return Err(Failure::Syntax(out));
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
            return Err(Failure::Syntax(syntax_error(file, first_error)));
        }
        Err(FormatError::SyntaxErrorAt(error)) => {
            return Err(Failure::Syntax(syntax_error_at(file.text(), error)));
        }
        Err(FormatError::NestedTooDeeply) => {
            return Err(Failure::Syntax(NESTED_TOO_DEEPLY.to_vec()));
        }
        Err(FormatError::InvalidDocument) => return Err(Failure::Bug("the formatter failed")),
    };
    if how.resolved.omits_final_newline {
        without_final_newline(&mut out);
    }
    if how.verifies && out != file.text() {
        let is_same = with_tree(how, &out, |after, atoms, _| {
            let after = match &after {
                Summary::InPlace(hir) => Program::new(&**hir, &out, atoms),
                Summary::InArena(hir) => Program::new(&**hir, &out, atoms),
            };
            bun_format::verify::compare(file, program, &after, options, &mut scratch.verify).is_ok()
        });
        if !is_same {
            return Err(Failure::Bug("formatting would change what the code means"));
        }
    }
    Ok((out, cursor))
}

fn format_as(how: &How, text: &[u8], scratch: &mut Scratches) -> Result<Formatted, Failure> {
    with_file(how, text, |file, program, first_error| {
        // A file whose imports move is parsed again.
        let how_to_sort = how.resolved.options.sort_imports.as_deref();
        match how_to_sort.and_then(|how| bun_format::sort_imports::sorted_text(file, how)) {
            Some(sorted) => with_file(how, &sorted, |file, program, first_error| {
                print_with_sorted_classes((file, program), first_error, how, scratch)
            }),
            None => print_with_sorted_classes((file, program), first_error, how, scratch),
        }
    })
}

/// [`print`]. For `prettier-plugin-tailwindcss` a file whose classes move is parsed again.
fn print_with_sorted_classes<'a>(
    (file, program): (&'a File<'a>, &Program<'a>),
    first_error: Option<&Diagnostic>,
    how: &How,
    scratch: &mut Scratches,
) -> Result<Formatted, Failure> {
    let tailwind = how.resolved.options.tailwind.as_deref();
    match tailwind.and_then(|it| bun_format::tailwind::plugin::sorted_text(file, it)) {
        Some(sorted) => with_file(how, &sorted, |file, program, first_error| {
            print((file, program), first_error, how, scratch)
        }),
        None => print((file, program), first_error, how, scratch),
    }
}

/// Why `bun format` leaves a file as it is.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// It has a syntax error or is nested too deeply.
    Syntax,
    /// A bug in the formatter, which it has noticed itself.
    Bug(&'static str),
    /// What Prettier prints does not say what the file says.
    Loss(&'static str),
}

/// The text of the file at `path` formatted with `options`, the way `bun format` does it, and where
/// the cursor ends up. `verifies`: with the checks that `bun format` makes on what it has printed.
/// For the tests of the formatter, and the fuzzers in test/cli/format/oracle/fuzz/libfuzzer.
pub fn format_for_tests(
    path: &[u8],
    text: &[u8],
    options: &FormatOptions,
    verifies: bool,
) -> Result<(Vec<u8>, Option<u32>), Refusal> {
    let resolved = Resolved {
        options: FormatOptions {
            format_javascript: Some(format_javascript(verifies)),
            parse_javascript: Some(parse_javascript),
            ..options.clone()
        },
        omits_final_newline: false,
    };
    let names = Session::new();
    format(
        path,
        text,
        &resolved,
        (&Interner::new_in(&names), &names),
        &mut Scratches::default(),
        verifies,
    )
    .map_err(|failure| match failure {
        Failure::Syntax(_) | Failure::Unread(_) => Refusal::Syntax,
        Failure::Bug(what) => Refusal::Bug(what),
        Failure::Loss(what) => Refusal::Loss(what),
    })
}

/// What has become of a file.
enum Done {
    Unchanged,
    /// It is not formatted. With `--write`, it was not. And how long that took to find out.
    Different(Duration),
    /// It has classes of Tailwind CSS whose order is not known yet.
    PutAside,
    /// For the user. The exit code is 2.
    Failed(Vec<u8>),
    /// See [`Failure::Unread`]. A warning for the user.
    Unread(Vec<u8>),
}

struct Run<'r> {
    options: &'r Options,
    environment: &'r Environment<'r>,
    out: Outcome,
    began: Instant,
}

/// What the file at `path`, which has `scope`, is to the tool that the run stands in for.
fn language_of(configs: &Configs, scope: &config::Scope, path: &[u8]) -> Language {
    // The `parser` option says what it is. One that Prettier does not have is that of a plugin.
    match configs.parser_for(scope, path) {
        Some(parser) if Kind::of_parser(&parser).is_none() => Language::Other,
        Some(_) => Language::Supported,
        None if configs.is_oxfmt_for(scope) => {
            files::language_for_oxfmt(path, configs.formats_svelte(scope))
        }
        None => match files::language_of(path) {
            Language::Unknown if configs.is_read_by_plugin(scope, path) => Language::Other,
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
            self.log(b"All matched files use the correct format.");
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

    /// Prettier's `logger.warn`
    fn warn(&mut self, text: &[u8]) {
        if self.options.log_level >= LogLevel::Warn {
            for line in strings::split(text, b"\n") {
                pretty!(
                    &mut self.out.stderr,
                    self.colors(),
                    "[<yellow>warn<r>] {}\n",
                    BStr::new(line)
                );
            }
        }
    }

    /// Prettier's `logger.error`
    fn error(&mut self, text: &[u8]) {
        if self.options.log_level >= LogLevel::Error {
            for line in strings::split(text, b"\n") {
                pretty!(
                    &mut self.out.stderr,
                    self.colors(),
                    "[<red>error<r>] {}\n",
                    BStr::new(line)
                );
            }
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
        if flavor == Flavor::Oxfmt {
            out.exit_code = 1;
        }
        out
    }

    fn describe(shown: &[u8], failure: Failure) -> Vec<u8> {
        match failure {
            Failure::Syntax(error) | Failure::Unread(error) => [shown, b": ", &error].concat(),
            Failure::Bug(what) => [
                shown,
                b": ",
                what.as_bytes(),
                b". It is left as it is. This is a bug in Bun.",
            ]
            .concat(),
            Failure::Loss(what) => {
                [shown, b": ", what.as_bytes(), b". It is left as it is."].concat()
            }
        }
    }

    /// Prettier's `formatStdin`
    fn format_stdin(mut self, configs: &Configs, ignored: &Ignored, name: &[u8]) -> Outcome {
        let text = match fs::read_stdin() {
            Ok(text) => text,
            Err(error) => {
                return self
                    .fail(&[&b"Cannot read standard input: "[..], &fs::describe(&error)].concat());
            }
        };
        let path = paths::resolve(&self.environment.cwd, &paths::from_native(name));
        // The configuration of a file that is ignored is not even read.
        if ignored.ignores_file(&path, &None) {
            self.out.stdout = text;
            return self.out;
        }
        // The language of a plugin: see `prettier.rs`.
        if let Ok(scope) = configs.for_directory(paths::dirname(&path))
            && language_of(configs, &scope, &path) == Language::Other
            && !ignored.ignores_file(&path, configs.ignores_of(&scope))
            && configs.plugin_that_reads(&scope, &path).is_some()
            && [&b"prettier"[..]]
                .into_iter()
                .chain(configs.packages_of_plugins(&scope))
                .all(|it| prettier::is_installed(&self.environment.cwd, it))
        {
            let size = (1, text.len() as u64);
            let bridge = prettier::Prettier::new(self.environment, self.options, size);
            match bridge.format(&path, configs.path_of_config(&scope), &text) {
                Err(why) => self.error(&[name, b": ", &why].concat()),
                Ok(formatted) if self.options.check || self.options.list_different => {
                    if formatted != text {
                        self.log(b"(stdin)");
                        self.out.exit_code = 1;
                    }
                }
                Ok(formatted) => self.out.stdout = formatted,
            }
            return self.out;
        }
        let found = configs
            .for_directory(paths::dirname(&path))
            .and_then(|scope| {
                let of_config = configs.ignores_of(&scope);
                let options = configs.options_for(&scope, &path)?;
                let is_another_language = language_of(configs, &scope, &path) == Language::Other;
                Ok(
                    (!ignored.ignores_file(&path, of_config) && !is_another_language)
                        .then_some(options),
                )
            });
        let mut options = match found {
            Ok(Some(options)) => options,
            Ok(None) => {
                self.out.stdout = text;
                return self.out;
            }
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        if Kind::with_options(&path, &options.options).is_none() {
            let only_looks = self.options.check || self.options.list_different;
            let mut out = self.fail_to_start(
                configs.flavor,
                &[
                    b"No parser could be inferred for file \"",
                    &paths::to_native(path)[..],
                    b"\".",
                ]
                .concat(),
            );
            // As Prettier's `handleError`.
            if configs.flavor == Flavor::Prettier && only_looks {
                out.exit_code = 0;
            }
            return out;
        }
        let kind = Kind::with_options(&path, &options.options);
        tailwind::only_where_sorted(&mut options.options, kind);
        let names = Session::new();
        let verifies = self.options.verify;
        let format_text = || {
            format(
                &path,
                &text,
                &options,
                (&Interner::new_in(&names), &names),
                &mut Scratches::default(),
                verifies,
            )
        };
        let mut formatted = format_text();
        if let Some(tailwind) = options
            .options
            .tailwind
            .as_deref()
            .filter(|it| it.has_missed())
        {
            if let Err(error) = configs.classes.ask(self.environment) {
                return self.fail(&error);
            }
            tailwind.has_missed.store(false, Ordering::Relaxed);
            formatted = format_text();
        }
        match formatted {
            Err(failure @ Failure::Unread(_)) => {
                self.warn(&Self::describe(name, failure));
                if !self.options.check && !self.options.list_different {
                    self.out.stdout = text;
                }
            }
            Err(failure) => self.error(&Self::describe(name, failure)),
            Ok((formatted, _)) if self.options.check || self.options.list_different => {
                if formatted != text {
                    self.log(b"(stdin)");
                    self.out.exit_code = 1;
                }
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
        let only_looks = (options.check || options.list_different) && !options.write;
        let is_oxfmt = configs.flavor == Flavor::Oxfmt;
        if options.check {
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
        let expanded = match expand(
            configs,
            &pool,
            ignored,
            patterns,
            options.error_on_unmatched_pattern,
        ) {
            Ok(expanded) => expanded,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        let finding = started.elapsed();

        // What is not to be formatted after all.
        let mut others: Vec<(&[u8], usize)> = Vec::new();
        // How many files are left alone because of plugins that are not there, and which.
        let mut left_for_plugins: (usize, Vec<&[u8]>) = (0, Vec::new());
        let is_wanted = |target: &Target| {
            let of_config = configs.ignores_of(&target.scope);
            !target.is_named || !ignored.ignores_file(&target.path, of_config)
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
                false => configs.missing_plugins(&target.scope),
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
                            .chain(configs.packages_of_plugins(&target.scope))
                            .all(&mut has_package) =>
                {
                    handed_over.push((index, target));
                }
                Language::Other => {
                    if configs
                        .plugin_that_reads(&target.scope, &target.path)
                        .is_some()
                    {
                        for package in [&b"prettier"[..]]
                            .into_iter()
                            .chain(configs.packages_of_plugins(&target.scope))
                        {
                            if !has_package(package) && !not_installed.contains(&package) {
                                not_installed.push(package);
                            }
                        }
                    }
                    let name = paths::basename(&target.path);
                    let kind =
                        strings::last_index_of_char(name, b'.').map_or(name, |dot| &name[dot..]);
                    match others.iter_mut().find(|it| it.0 == kind) {
                        Some(entry) => entry.1 += 1,
                        None => others.push((kind, 1)),
                    }
                }
                Language::Unknown if target.ignores_unknown || options.ignore_unknown => {}
                Language::Unknown => {
                    done[index] = Some(Done::Failed(
                        [
                            b"No parser could be inferred for file \"",
                            &paths::to_native(target.path.clone())[..],
                            b"\".",
                        ]
                        .concat(),
                    ));
                }
            }
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
        // Before any other thread runs: this starts JavaScriptCore, and so would the first pattern of a configuration that one
        // of them compiles. The thread that starts it is its main thread.
        let bridge = (!handed_over.is_empty()).then(|| {
            // The threads that hand files over wait for a VM, which loads its modules and reads files on Bun's pool: with all of
            // that pool's threads waiting, for ever.
            bun_sema_driver::use_a_pool_of_their_own("Bun Format");
            let size: u64 = handed_over.iter().map(|it| it.1.size).sum();
            prettier::Prettier::new(self.environment, options, (handed_over.len(), size))
        });
        let scratches: Guarded<Vec<Scratches>> = Guarded::new(Vec::new());
        let names: Vec<Session> = (0..pool.threads().max(1)).map(|_| Session::new()).collect();
        let atoms = InternerPerThread::new_in(&names);
        let memory = Session::new();
        let mut results = Guarded::new(done);
        // Tailwind cannot be asked, and that is allowed.
        let leaves_classes = AtomicBool::new(false);
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
                let text = fs::read_sized(&target.path, target.size).map_err(|error| {
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
                // What a template would lose is known without a second look, and the second look at HTML is a short
                // one, which only a file that changes gets.
                let is_free = || {
                    matches!(
                        Kind::with_options(&target.path, &options.options),
                        Some(Kind::Handlebars | Kind::Html(_))
                    )
                };
                let formatted = match format(
                    &target.path,
                    &text,
                    &options,
                    (&atoms, &memory),
                    &mut scratch,
                    self.options.verify && (!only_looks || is_free()),
                ) {
                    Ok((formatted, _)) => formatted,
                    Err(failure @ Failure::Unread(_)) => {
                        return Ok(Done::Unread(Self::describe(&shown, failure)));
                    }
                    Err(failure) => return Err(Self::describe(&shown, failure)),
                };
                if options
                    .options
                    .tailwind
                    .as_deref()
                    .is_some_and(Tailwind::has_missed)
                {
                    return Ok(Done::PutAside);
                }
                if formatted == text {
                    return Ok(Done::Unchanged);
                }
                if !only_looks {
                    fs::write_atomically(cwd, &target.path, &formatted).map_err(|why| {
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
                let files = if left.len() == 1 { "file" } else { "files" };
                let what = match options.allow_unsupported {
                    true => "The classes are not sorted in",
                    false => "Left as they are:",
                };
                error.extend_from_slice(format!("\n{what} {} {files}.", left.len()).as_bytes());
                if options.allow_unsupported {
                    leaves_classes.store(true, Ordering::Relaxed);
                    pool.for_each(left.len(), 1, &|at| format_at(left[at]));
                }
            }
        }
        if let Some(bridge) = &bridge {
            pool.for_each(handed_over.len(), 1, &|at| {
                let (index, target) = handed_over[at];
                let began = Instant::now();
                let shown = paths::relative(cwd, &target.path);
                let config = configs.path_of_config(&target.scope);
                let file = (&target.path[..], target.size, &shown[..]);
                results.lock()[index] = Some(match bridge.format_file(file, config, !only_looks) {
                    Ok(true) => Done::Different(began.elapsed()),
                    Ok(false) => Done::Unchanged,
                    Err(error) => Done::Failed(error),
                });
            });
        }
        let formatting = started.elapsed();

        let (mut different, mut unchanged, mut failed) = (0usize, 0usize, 0usize);
        for (it, done) in expanded.iter().zip(std::mem::take(results.get_mut())) {
            let target = match it {
                Expanded::Error(error) => {
                    self.error(error);
                    continue;
                }
                Expanded::File(target) => target,
            };
            let shown = paths::relative(cwd, &target.path);
            match done {
                None => {}
                Some(Done::Unchanged) => unchanged += 1,
                Some(Done::Unread(warning)) => {
                    unchanged += 1;
                    self.warn(&warning);
                }
                Some(Done::Failed(error)) => {
                    failed += 1;
                    self.error(&error);
                }
                Some(Done::PutAside) => {
                    failed += 1;
                    classes_are_unknown.get_or_insert_with(|| {
                        let name = configs.classes.name().as_bytes();
                        [name, b": The order of some classes cannot be found."].concat()
                    });
                }
                Some(Done::Different(took)) => {
                    different += 1;
                    match (is_oxfmt, options.check) {
                        (true, true) => self.log_with_time(&shown, took),
                        // oxfmt does not name the files that it writes.
                        (true, false) if !options.list_different => {}
                        (false, true) => self.warn(&shown),
                        (_, false) => self.log(&shown),
                    }
                }
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
        if is_oxfmt {
            self.sum_up_as_oxfmt([different, unchanged, failed], pool.threads());
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
                self.log(b"All matched files use Prettier code style!");
            } else if only_looks {
                self.warn(
                    format!(
                        "Code style issues found in {}. Run bun format to fix.",
                        count(different)
                    )
                    .as_bytes(),
                );
            } else {
                self.warn(format!("Code style issues fixed in {}.", count(different)).as_bytes());
            }
        }
        if only_looks && different > 0 && self.out.exit_code == 0 {
            self.out.exit_code = 1;
        }
        let sums_up = !is_oxfmt && !options.check && !options.list_different;
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
                "file was"
            } else {
                "files were"
            };
            let _ = writeln!(
                self.out.stderr,
                "{} {noun} handed to the Prettier of the project, for a language that only a plugin reads.",
                handed_over.len(),
            );
        }
        if options.timing {
            let _ = writeln!(
                self.out.stderr,
                "  wall: {:.1}ms finding files and configurations, {:.1}ms formatting, {:.1}ms in all, on {} threads",
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
                b" is not supported yet, and has no effect",
            ]
            .concat();
            match options.allow_unsupported {
                true => self.warn(&[&text[..], b"."].concat()),
                false => {
                    self.error(
                        &[&text[..], b". With --allow-unsupported this is a warning."].concat(),
                    );
                }
            }
        }
        match classes_are_unknown {
            Some(error) if options.allow_unsupported => self.warn(&error),
            Some(error) => self.error(&error),
            None => {}
        }
        if let (count @ 1.., names) = &left_for_plugins {
            let noun = if *count == 1 { "file is" } else { "files are" };
            let text = format!(
                "{count} {noun} left as they are: the configuration names plugins that bun format does not have, and that may print them in another way: "
            );
            self.error(
                &[
                    text.as_bytes(),
                    &names.join(&b", "[..]),
                    b". With --allow-unsupported they are formatted without.",
                ]
                .concat(),
            );
        }
        // The tool that this stands in for would have formatted or checked them, so this comes last and is an error.
        if !others.is_empty() {
            sort_slice_by(&mut others[..], |a, b| {
                b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0))
            });
            let count: usize = others.iter().map(|it| it.1).sum();
            let noun = if count == 1 { "file is" } else { "files are" };
            let kinds: Vec<Vec<u8>> = others
                .iter()
                .map(|it| format!("{} {}", it.1, BStr::new(it.0)).into_bytes())
                .collect();
            let text = format!(
                "{count} {noun} in a language that bun format does not support yet, and left as they are: "
            );
            let text = [text.as_bytes(), &kinds.join(&b", "[..])].concat();
            if !not_installed.is_empty() {
                let plugins = not_installed.join(&b", "[..]);
                self.warn(
                    &[
                        &b"Not installed: "[..],
                        &plugins,
                        b". With all plugins of the configuration and prettier installed, bun format hands the files of their languages to them.",
                    ]
                    .concat(),
                );
            }
            match options.allow_unsupported {
                true => self.warn(&text),
                false => {
                    self.error(
                        &[&text[..], b". With --allow-unsupported this is a warning."].concat(),
                    );
                }
            }
        }
        self.out
    }

    /// `oxfmt --init`
    fn init(mut self) -> Outcome {
        let environment = self.environment;
        let cwd = &environment.cwd;
        if config::has_configuration_of_oxfmt(cwd) {
            let mut out = self.fail(b"A configuration file of oxfmt already exists.");
            out.exit_code = 1;
            return out;
        }
        let schema = &b"node_modules/oxfmt/configuration_schema.json"[..];
        let text = match fs::is_file(&paths::join(cwd, schema)) {
            true => [
                b"{\n  \"$schema\": \"./",
                schema,
                b"\",\n  \"ignorePatterns\": []\n}\n",
            ]
            .concat(),
            false => b"{\n  \"ignorePatterns\": []\n}\n".to_vec(),
        };
        match fs::write_new(&paths::join(cwd, b".oxfmtrc.json"), &text) {
            Ok(()) => {
                self.out.stdout = b"Created `.oxfmtrc.json`.\n".to_vec();
                self.out
            }
            Err(error) => {
                self.fail(&[&b"Cannot write .oxfmtrc.json: "[..], &fs::describe(&error)].concat())
            }
        }
    }

    fn execute(mut self) -> Outcome {
        let (options, environment) = (self.options, self.environment);
        if options.version {
            self.out.stdout = [environment.version, b"\n"].concat();
            return self.out;
        }
        if let Some(name) = (options.plugins.iter()).find(|it| config::is_missing_plugin(it))
            && !options.allow_unsupported
        {
            return self.fail(
                &[
                    b"bun format does not have the plugin ",
                    &name[..],
                    b", which may print files in another way. With --allow-unsupported they are formatted without.",
                ]
                .concat(),
            );
        }
        if !(options.plugins.iter()).all(|it| config::is_built_in_plugin(it)) {
            self.warn(b"Plugins are not supported: --plugin has no effect.");
        }
        if options.init {
            return self.init();
        }
        if options.config.is_some() && !options.config_lookup {
            let mut out = self.fail(b"Cannot use --no-config and --config together.");
            out.exit_code = 1;
            return out;
        }
        let configs = Configs::new(options, environment);
        if let Some(file) = &options.find_config_path {
            let path = paths::resolve(&environment.cwd, &paths::from_native(file));
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
        if let Some((_, parser)) = from_flag.filter(|it| Kind::of_parser(&it.1).is_none()) {
            return self.fail(&cannot_resolve_parser(parser));
        }
        let mut ignored = match Ignored::new(options, &environment.cwd, configs.flavor) {
            Ok(ignored) => ignored,
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        match &options.stdin_filepath {
            Some(name) => self.format_stdin(&configs, &ignored, name),
            None => self.format_files(&configs, &mut ignored),
        }
    }
}

/// Does what `bun format` does. `options.help` and `options.cwd` are for the caller to see to.
pub fn run(options: &Options, environment: &Environment) -> Outcome {
    let as_oxfmt = options
        .as_oxfmt_reads_it()
        .filter(|_| Configs::new(options, environment).flavor == Flavor::Oxfmt);
    let options = as_oxfmt.as_ref().unwrap_or(options);
    let run = Run {
        options,
        environment,
        out: Outcome::default(),
        began: Instant::now(),
    };
    run.execute()
}
