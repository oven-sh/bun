//! `bun format`: the command line of Prettier, on all threads.
//!
//! - [`cli`]: the flags.
//! - [`run`]: `bun format`, given the flags and an [`Environment`].

pub mod cli;
mod config;
mod editorconfig;
mod files;

use crate::run::{Environment, Fatal, Outcome, Pool};
use crate::{fs, paths};
use bstr::BStr;
use bun_core::strings;
use bun_format::pragma::BeforeParsing;
use bun_format::verify::Program;
use bun_format::{FormatError, FormatOptions, Scratch};
use bun_js_parser::sema::Summary;
use bun_lint::ast::File;
use bun_lint::language::{LanguageOptions, Parser, SourceType};
use bun_lint::linter::TypesInJavaScript;
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
use std::time::Instant;

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
}

/// What the file at `path` is parsed as, one after the other until there is no error: whether as
/// a script. A module, then a script, as the parsers of Prettier do.
fn kinds(path: &[u8]) -> &'static [bool] {
    match path {
        _ if path.ends_with(b".mjs") || path.ends_with(b".mts") => &[false],
        _ if path.ends_with(b".cjs") || path.ends_with(b".cts") => &[true],
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

/// Parses `text` and calls `then` with the tree, and with what the names in it are of.
fn with_tree<'h, R>(
    how: &How<'h>,
    text: &[u8],
    then: impl FnOnce(Summary<'_, 'h>, &dyn Intern, &LanguageOptions) -> R,
) -> R {
    let path = how.path;
    let is_typescript = [&b".ts"[..], b".tsx", b".mts", b".cts"]
        .iter()
        .any(|it| path.ends_with(it));
    let language = LanguageOptions {
        parser: if is_typescript {
            Parser::TypeScript
        } else {
            Parser::Espree
        },
        source_type: if how.is_script {
            SourceType::Script
        } else {
            SourceType::Module
        },
        ..LanguageOptions::default()
    };
    let session = how.memory;
    let arena = session.arena();
    let options = language.parse_options(path);
    bun_js_parser::sema::with_summary_in_place(
        match how.is_flow {
            true => Dialect::flow(how.is_script),
            false => Dialect::babel(how.is_script),
        },
        (arena, session),
        path,
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
}

fn without_final_newline(out: &mut Vec<u8>) {
    let end = out.strip_suffix(b"\n").map_or(out.len(), |rest| {
        rest.strip_suffix(b"\r").unwrap_or(rest).len()
    });
    out.truncate(end);
}

/// For a block of code in Markdown: appends `code` formatted as the file at `path`. `false`: it cannot
/// be, and stays as it is.
fn format_javascript(path: &[u8], code: &[u8], options: &FormatOptions, out: &mut Vec<u8>) -> bool {
    let resolved = Resolved {
        options: options.clone(),
        omits_final_newline: false,
    };
    let names = Session::new();
    let formatted = format(
        path,
        code,
        &resolved,
        (&Interner::new_in(&names), &names),
        &mut Scratches::default(),
        false,
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
        Err(FormatError::NestedTooDeeply) => Err(Failure::Syntax(NESTED_TOO_DEEPLY.to_vec())),
        Err(FormatError::InvalidDocument) => Err(Failure::Bug("the formatter failed")),
    };
    let mut out = Vec::new();
    match Kind::of(name, options.parser.as_deref()) {
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
        Some(Kind::Markdown) => {
            let done = bun_format::markdown::format(text, options, &mut scratch.markdown, &mut out);
            return finish(done, out, "Markdown");
        }
        Some(Kind::Mdx) => {
            let done =
                bun_format::markdown::format_mdx(text, options, &mut scratch.markdown, &mut out);
            return finish(done, out, "MDX");
        }
        Some(Kind::GraphQl) => {
            let done = bun_format::graphql::format(text, options, &mut scratch.graphql, &mut out);
            return finish(done, out, "GraphQL");
        }
        Some(Kind::Handlebars) => {
            let done =
                bun_format::handlebars::format(text, options, &mut scratch.handlebars, &mut out);
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
                && !bun_format::html::has_same_content(text, &out, parser, options)
            {
                return Err(Failure::Bug("formatting would change what is in the file"));
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
        Some(b"babel") | None => bun_lint::linter::goes_to_flow(&text, name),
        Some(_) => false,
    };
    let has_comment_types = is_flow
        && options.parser.as_deref() != Some(b"flow")
        && !name.ends_with(b".js.flow")
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
    if let Some(why) = bun_lint::linter::refusal_of_prettier(file, types) {
        let at = file.position(why.at);
        return Err(Failure::Syntax(
            format!(
                "SyntaxError: {} ({}:{})",
                BStr::new(&why.message),
                at.line,
                at.column + 1
            )
            .into_bytes(),
        ));
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
                Summary::InArena(hir) => Program::new(hir, &out, atoms),
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
                print((file, program), first_error, how, scratch)
            }),
            None => print((file, program), first_error, how, scratch),
        }
    })
}

/// The text of the file at `path` formatted with `options`, the way `bun format` does it, and where
/// the cursor ends up. For the tests of the formatter. `Err(true)`: a syntax error.
pub fn format_for_tests(
    path: &[u8],
    text: &[u8],
    options: &FormatOptions,
) -> Result<(Vec<u8>, Option<u32>), bool> {
    let resolved = Resolved {
        options: FormatOptions {
            format_javascript: Some(format_javascript),
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
        false,
    )
    .map_err(|failure| matches!(failure, Failure::Syntax(_)))
}

/// What has become of a file.
enum Done {
    Unchanged,
    /// It is not formatted. With `--write`, it was not.
    Different,
    /// For the user. The exit code is 2.
    Failed(Vec<u8>),
}

struct Run<'r> {
    options: &'r Options,
    environment: &'r Environment<'r>,
    out: Outcome,
    began: Instant,
}

impl Run<'_> {
    /// Prettier's `logger.log`
    fn log(&mut self, text: &[u8]) {
        if self.options.log_level >= LogLevel::Log {
            self.out.stdout.extend_from_slice(text);
            self.out.stdout.push(b'\n');
        }
    }

    /// Prettier's `logger.warn`
    fn warn(&mut self, text: &[u8]) {
        if self.options.log_level >= LogLevel::Warn {
            pretty!(
                &mut self.out.stderr,
                self.colors(),
                "[<yellow>warn<r>] {}\n",
                BStr::new(text)
            );
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
            Failure::Syntax(error) => [shown, b": ", &error].concat(),
            Failure::Bug(what) => [
                shown,
                b": ",
                what.as_bytes(),
                b". It is left as it is. This is a bug in Bun.",
            ]
            .concat(),
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
        let found = configs
            .for_directory(paths::dirname(&path))
            .and_then(|scope| {
                let of_config = configs.ignores_of(&scope);
                let options = configs.options_for(&scope, &path)?;
                let is_another_language = files::language_of(&path) == Language::Other
                    && options.options.parser.is_none();
                Ok(
                    (!ignored.ignores_file(&path, of_config) && !is_another_language)
                        .then_some(options),
                )
            });
        let options = match found {
            Ok(Some(options)) => options,
            Ok(None) => {
                self.out.stdout = text;
                return self.out;
            }
            Err(Fatal(error)) => return self.fail_to_start(configs.flavor, &error),
        };
        let is_left_alone = configs.flavor == Flavor::Oxfmt && files::is_left_alone_by_oxfmt(&path);
        if is_left_alone
            || (files::language_of(&path) == Language::Unknown && options.options.parser.is_none())
        {
            let only_looks = self.options.check || self.options.list_different;
            let mut out = self.fail_to_start(
                configs.flavor,
                &[
                    b"No parser could be inferred for file \"",
                    &path[..],
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
        let names = Session::new();
        match format(
            &path,
            &text,
            &options,
            (&Interner::new_in(&names), &names),
            &mut Scratches::default(),
            self.options.verify,
        ) {
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
        if options.check {
            self.log(b"Checking formatting...");
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
        let is_wanted = |target: &Target| {
            let of_config = configs.ignores_of(&target.scope);
            !target.is_named || !ignored.ignores_file(&target.path, of_config)
        };
        let mut work: Vec<(usize, &Target)> = Vec::new();
        let mut done: Vec<Option<Done>> = Vec::with_capacity(expanded.len());
        for (index, it) in expanded.iter().enumerate() {
            done.push(None);
            let Expanded::File(target) = it else {
                continue;
            };
            match files::language_of(&target.path) {
                _ if !is_wanted(target) => {}
                // The `parser` option says what it is.
                Language::Other | Language::Unknown
                    if configs.names_parser_for(&target.scope, &target.path) =>
                {
                    work.push((index, target))
                }
                Language::Supported => work.push((index, target)),
                Language::Other => {
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
                            &target.path[..],
                            b"\".",
                        ]
                        .concat(),
                    ));
                }
            }
        }
        if options.list_files {
            for (_, target) in &work {
                self.out
                    .stdout
                    .extend_from_slice(&paths::relative(cwd, &target.path));
                self.out.stdout.push(b'\n');
            }
            return self.out;
        }
        // The largest first, so that no thread begins it when the others are nearly done.
        work.sort_by_key(|it| std::cmp::Reverse(it.1.size));
        let started = Instant::now();
        let scratches: Guarded<Vec<Scratches>> = Guarded::new(Vec::new());
        let names: Vec<Session> = (0..pool.threads().max(1)).map(|_| Session::new()).collect();
        let atoms = InternerPerThread::new_in(&names);
        let memory = Session::new();
        let mut results = Guarded::new(done);
        pool.for_each(work.len(), 1, &|at| {
            let (index, target) = work[at];
            let shown = paths::relative(cwd, &target.path);
            let mut scratch = scratches.lock().pop().unwrap_or_default();
            let result = (|| {
                let options = configs
                    .options_for(&target.scope, &target.path)
                    .map_err(|error| error.0)?;
                let text = fs::read_sized(&target.path, target.size).map_err(|error| {
                    [
                        b"Unable to read file \"",
                        &shown[..],
                        b"\":\n",
                        &fs::describe(&error),
                    ]
                    .concat()
                })?;
                let (formatted, _) = format(
                    &target.path,
                    &text,
                    &options,
                    (&atoms, &memory),
                    &mut scratch,
                    self.options.verify && !only_looks,
                )
                .map_err(|failure| Self::describe(&shown, failure))?;
                if formatted == text {
                    return Ok(Done::Unchanged);
                }
                if !only_looks {
                    fs::write_atomically(&target.path, &formatted).map_err(|error| {
                        [
                            b"Unable to write file \"",
                            &shown[..],
                            b"\":\n",
                            &fs::describe(&error),
                        ]
                        .concat()
                    })?;
                }
                Ok(Done::Different)
            })();
            scratches.lock().push(scratch);
            results.lock()[index] = Some(result.unwrap_or_else(Done::Failed));
        });
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
                Some(Done::Failed(error)) => {
                    failed += 1;
                    self.error(&error);
                }
                Some(Done::Different) => {
                    different += 1;
                    match options.check {
                        true => self.warn(&shown),
                        false => self.log(&shown),
                    }
                }
            }
        }
        for warning in std::mem::take(&mut *configs.warnings.lock()) {
            self.warn(&warning);
        }
        if !others.is_empty() {
            others.sort_by_key(|it| (std::cmp::Reverse(it.1), it.0));
            let count: usize = others.iter().map(|it| it.1).sum();
            let noun = if count == 1 { "file is" } else { "files are" };
            let kinds: Vec<Vec<u8>> = others
                .iter()
                .map(|it| format!("{} {}", it.1, BStr::new(it.0)).into_bytes())
                .collect();
            let text = format!(
                "{count} {noun} in a language that bun format does not support yet, and left as they are: "
            );
            self.warn(&[text.as_bytes(), &kinds.join(&b", "[..])].concat());
        }
        let count = |n: usize| {
            if n == 1 {
                "the above file".to_owned()
            } else {
                format!("{n} files")
            }
        };
        if options.check {
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
        if options.log_level >= LogLevel::Log && !options.check && !options.list_different {
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
        self.out
    }

    fn execute(mut self) -> Outcome {
        let (options, environment) = (self.options, self.environment);
        if options.version {
            self.out.stdout = [environment.version, b"\n"].concat();
            return self.out;
        }
        if !options.plugins.is_empty() {
            self.warn(b"Plugins are not supported: --plugin has no effect.");
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
