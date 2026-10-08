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
use bun_format::{FormatError, FormatOptions, Scratch};
use bun_lint::ast::File;
use bun_lint::language::LanguageOptions;
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, bind};
use bun_sema::hir::Diagnostic;
use bun_sema::session::Session;
use bun_threading::Guarded;
use cli::{LogLevel, Options};
use config::Configs;
use files::{Expanded, Ignored, Language, Target};
use std::borrow::Cow;
use std::io::Write;
use std::time::Instant;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// Why a file is left as it is.
enum Failure {
    /// `SyntaxError: ';' expected. (1:7)`
    Syntax(Vec<u8>),
    /// A bug in the formatter.
    Bug(&'static str),
    Unsupported(&'static str),
}

/// Parses `text` as the file at `path` and calls `then` with it, and with the first error in it.
fn with_file<R>(path: &[u8], text: &[u8], then: impl for<'a> FnOnce(&'a File<'a>, Option<&'a Diagnostic>) -> R) -> R {
    let language = LanguageOptions::default();
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let how = language.parse_options(path);
    let (mut hir, _) = bun_js_parser::sema::summarize(
        arena,
        path,
        how.script_kind,
        text,
        &atoms,
        how.experimental_decorators,
        how.every_file_is_a_module,
    );
    hir.text = Cow::Borrowed(text);
    let bind_options = BindOptions {
        emit_standard_class_fields: true,
        before_es2020: false,
        before_es2017: false,
    };
    let bound = bind(&hir, bind_options, &atoms, arena);
    then(&File::new(path, &hir, &bound, &atoms, &language, None), hir.diagnostics.first())
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

/// The formatted text of the file at `path`. `verifies`: it is parsed and compared with `text`.
fn format(path: &[u8], text: &[u8], options: &FormatOptions, scratch: &mut Scratch, verifies: bool) -> Result<Vec<u8>, Failure> {
    if !options.is_supported() {
        return Err(Failure::Unsupported("experimentalTernaries and experimentalOperatorPosition are not supported yet."));
    }
    with_file(path, text, |file, first_error| {
        let mut out = Vec::new();
        match bun_format::format(file, options, scratch, &mut out) {
            Ok(()) => {}
            Err(FormatError::SyntaxError) => return Err(Failure::Syntax(syntax_error(file, first_error))),
            Err(FormatError::InvalidDocument) => return Err(Failure::Bug("the formatter failed")),
        }
        if verifies && out != text {
            let is_same = with_file(path, &out, |after, _| !after.has_parse_errors() && bun_format::verify::compare(file, after).is_ok());
            if !is_same {
                return Err(Failure::Bug("formatting would change what the code means"));
            }
        }
        Ok(out)
    })
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
            pretty!(&mut self.out.stderr, self.colors(), "[<yellow>warn<r>] {}\n", BStr::new(text));
        }
    }

    /// Prettier's `logger.error`
    fn error(&mut self, text: &[u8]) {
        if self.options.log_level >= LogLevel::Error {
            for line in bun_core::strings::split(text, b"\n") {
                pretty!(&mut self.out.stderr, self.colors(), "[<red>error<r>] {}\n", BStr::new(line));
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

    fn describe(shown: &[u8], failure: Failure) -> Vec<u8> {
        match failure {
            Failure::Syntax(error) => [shown, b": ", &error].concat(),
            Failure::Unsupported(why) => [shown, b": ", why.as_bytes()].concat(),
            Failure::Bug(what) => [shown, b": ", what.as_bytes(), b". It is left as it is. This is a bug in Bun."].concat(),
        }
    }

    /// Prettier's `formatStdin`
    fn format_stdin(mut self, configs: &Configs, ignored: &Ignored, name: &[u8]) -> Outcome {
        let text = match fs::read_stdin() {
            Ok(text) => text,
            Err(error) => return self.fail(&[&b"Cannot read standard input: "[..], &fs::describe(&error)].concat()),
        };
        let path = paths::resolve(&self.environment.cwd, &paths::from_native(name));
        let found = configs.for_directory(paths::dirname(&path)).and_then(|scope| {
            let of_config = scope.config.as_ref().map_or(&None, |it| &it.ignores);
            let is_left_alone = ignored.ignores_file(&path, of_config) || files::language_of(&path) == Language::Other;
            Ok((!is_left_alone).then_some(configs.options_for(&scope, &path)?))
        });
        let options = match found {
            Ok(Some(options)) => options,
            Ok(None) => {
                self.out.stdout = text;
                return self.out;
            }
            Err(Fatal(error)) => return self.fail(&error),
        };
        if files::language_of(&path) == Language::Unknown {
            return self.fail(&[b"No parser could be inferred for file \"", &path[..], b"\"."].concat());
        }
        match format(&path, &text, &options, &mut Scratch::default(), self.options.verify) {
            Err(failure) => self.error(&Self::describe(name, failure)),
            Ok(formatted) if self.options.check || self.options.list_different => {
                if formatted != text {
                    self.log(b"(stdin)");
                    self.out.exit_code = 1;
                }
            }
            Ok(formatted) => self.out.stdout = formatted,
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
        let patterns = if options.patterns.is_empty() { &dot[..] } else { &options.patterns[..] };
        let started = Instant::now();
        let expanded = match files::expand(configs, &pool, ignored, patterns, options.error_on_unmatched_pattern) {
            Ok(expanded) => expanded,
            Err(Fatal(error)) => return self.fail(&error),
        };
        let finding = started.elapsed();

        // What is not to be formatted after all.
        let mut others = 0;
        let is_wanted = |target: &Target| {
            let of_config = target.scope.config.as_ref().map_or(&None, |it| &it.ignores);
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
                Language::Supported => work.push((index, target)),
                Language::Other => others += 1,
                Language::Unknown if target.ignores_unknown || options.ignore_unknown => {}
                Language::Unknown => {
                    done[index] = Some(Done::Failed([b"No parser could be inferred for file \"", &target.path[..], b"\"."].concat()));
                }
            }
        }
        // The largest first, so that no thread begins it when the others are nearly done.
        work.sort_by_key(|it| std::cmp::Reverse(it.1.size));
        let started = Instant::now();
        let scratches: Guarded<Vec<Scratch>> = Guarded::new(Vec::new());
        let mut results = Guarded::new(done);
        pool.for_each(work.len(), 1, &|at| {
            let (index, target) = work[at];
            let shown = paths::relative(cwd, &target.path);
            let mut scratch = scratches.lock().pop().unwrap_or_default();
            let result = (|| {
                let options = configs.options_for(&target.scope, &target.path).map_err(|error| error.0)?;
                let text = fs::read_sized(&target.path, target.size)
                    .map_err(|error| [b"Unable to read file \"", &shown[..], b"\":\n", &fs::describe(&error)].concat())?;
                let formatted = format(&target.path, &text, &options, &mut scratch, self.options.verify && !only_looks)
                    .map_err(|failure| Self::describe(&shown, failure))?;
                if formatted == text {
                    return Ok(Done::Unchanged);
                }
                if !only_looks {
                    fs::write_atomically(&target.path, &formatted)
                        .map_err(|error| [b"Unable to write file \"", &shown[..], b"\":\n", &fs::describe(&error)].concat())?;
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
        if others > 0 {
            let noun = if others == 1 { "file is" } else { "files are" };
            let text = format!("{others} {noun} in a language that bun format does not support yet (CSS, JSON, Markdown, YAML, HTML, ..) and left as they are.");
            self.warn(text.as_bytes());
        }
        let count = |n: usize| if n == 1 { "the above file".to_owned() } else { format!("{n} files") };
        if options.check {
            if failed > 0 {
                self.log(format!("Error occurred when checking code style in {}.", count(failed)).as_bytes());
            } else if different == 0 {
                self.log(b"All matched files use Prettier code style!");
            } else if only_looks {
                self.warn(format!("Code style issues found in {}. Run bun format to fix.", count(different)).as_bytes());
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
            pretty!(&mut self.out.stderr, colors, "Formatted {} {}<d>, {} unchanged {}<r>\n", different, noun(different), unchanged, took);
        }
        if options.timing {
            let _ = writeln!(
                self.out.stderr,
                "  wall: {:.1}ms finding files and configurations, {:.1}ms formatting, {:.1}ms in all, on {} threads",
                finding.as_secs_f64() * 1e3,
                formatting.as_secs_f64() * 1e3,
                self.began.elapsed().as_secs_f64() * 1e3,
                pool.threads,
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
                    let mut out = self.fail(&[b"Can not find configure file for \"", &file[..], b"\"."].concat());
                    out.exit_code = 1;
                    out
                }
            };
        }
        let mut ignored = Ignored::new(options, &environment.cwd);
        match &options.stdin_filepath {
            Some(name) => self.format_stdin(&configs, &ignored, name),
            None => self.format_files(&configs, &mut ignored),
        }
    }
}

/// Does what `bun format` does. `options.help` and `options.cwd` are for the caller to see to.
pub fn run(options: &Options, environment: &Environment) -> Outcome {
    let run = Run {
        options,
        environment,
        out: Outcome::default(),
        began: Instant::now(),
    };
    run.execute()
}
