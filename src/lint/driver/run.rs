//! `bun lint`: ESLint's `cli.execute`.

use crate::cli::Options;
use crate::configs::Loader;
use crate::discover::{self, Status, Target};
use crate::format::{self, Format};
use crate::lint::{Context, elapsed};
use crate::results::{Counts, FileResult};
use crate::typed::{self, Typed};
use crate::{fs, paths};
use bstr::BStr;
use bun_lint::context::Severity;
use bun_lint::linter::{Linter, Registry};
use bun_threading::Guarded;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// Standard output, or standard error.
#[derive(Copy, Clone, Default)]
pub struct Stream {
    pub is_tty: bool,
    pub colors: bool,
}

/// A program for the running executable to run, as `bun -e <source> <arguments>`.
pub struct Script<'s> {
    pub source: &'static str,
    pub arguments: &'s [&'s [u8]],
    /// The working directory.
    pub cwd: &'s [u8],
}

/// What `bun lint` takes from the process that it runs in.
pub struct Environment<'e> {
    /// The working directory: absolute, as the system writes it.
    pub cwd: Vec<u8>,
    pub stdout: Stream,
    pub stderr: Stream,
    /// `Output::is_ai_agent()`
    pub is_ai_agent: bool,
    /// `Output::is_github_action()`
    pub is_github_action: bool,
    /// TypeScript's `lib.*.d.ts`, for the rules that need types.
    pub libs: bun_sema_driver::Libs<'e>,
    /// Runs a script to its end. `Ok`: what it has printed on standard output. `Err`: it failed, and
    /// this is why.
    pub run_script: &'e (dyn Fn(&Script) -> Result<Vec<u8>, Vec<u8>> + Sync),
    /// The version of Bun.
    pub version: &'e [u8],
}

/// What to print, and the exit code: 0, 1 if there are problems in the code, 2 if linting failed.
#[derive(Default)]
pub struct Outcome {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: u8,
}

/// Why nothing can be linted: the message. ESLint throws, and exits with 2.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct Fatal(pub(crate) Vec<u8>);

/// The threads.
pub(crate) struct Pool {
    caches: bun_sema_driver::ThreadCaches,
    pub(crate) threads: usize,
}

impl Pool {
    fn new(threads: usize) -> Pool {
        Pool {
            caches: Default::default(),
            threads: match threads {
                0 => usize::from(bun_core::get_thread_count()),
                threads => threads,
            },
        }
    }

    /// Calls `work` with every index below `count`, `run` consecutive ones at a time.
    pub(crate) fn for_each(&self, count: usize, run: usize, work: &(dyn Fn(usize) + Sync)) {
        bun_sema_driver::for_each_parallel_in_runs(&self.caches, self.threads, count, run, work);
    }
}

/// `--timing`: how long all threads together have spent on what, in nanoseconds.
#[derive(Default)]
pub(crate) struct Timing {
    is_on: bool,
    pub(crate) read: AtomicU64,
    pub(crate) parse: AtomicU64,
    pub(crate) rules: AtomicU64,
}

impl Timing {
    pub(crate) fn now(&self) -> Option<Instant> {
        self.is_on.then(Instant::now)
    }

    /// Adds the time since `started`. Returns the time.
    pub(crate) fn add(&self, to: &AtomicU64, started: Option<Instant>) -> Option<Instant> {
        started?;
        to.fetch_add(elapsed(started), Ordering::Relaxed);
        self.now()
    }
}

/// `a.filePath < b.filePath` in JavaScript, which compares UTF-16 code units: what is outside of
/// the BMP comes before U+E000.
fn compare_paths(a: &[u8], b: &[u8]) -> std::cmp::Ordering {
    let rank = |byte: u8| match byte {
        0xEE | 0xEF => u16::from(byte) + 0x10,
        0xF0.. => 0xEE,
        _ => u16::from(byte),
    };
    match a.iter().zip(b).find(|(a, b)| a != b) {
        Some((a, b)) => rank(*a).cmp(&rank(*b)),
        None => a.len().cmp(&b.len()),
    }
}

struct Run<'r> {
    options: &'r Options,
    environment: &'r Environment<'r>,
    out: Outcome,
    began: Instant,
}

/// What was linted.
struct Linted {
    results: Vec<FileResult>,
    files: usize,
}

impl Run<'_> {
    fn error(&mut self, text: &[u8]) {
        pretty!(&mut self.out.stderr, self.environment.stderr.colors, "<red>error<r><d>:<r> {}\n", BStr::new(text));
    }

    fn warn(&mut self, text: &[u8]) {
        pretty!(&mut self.out.stderr, self.environment.stderr.colors, "<yellow>warn<r><d>:<r> {}\n", BStr::new(text));
    }

    /// Fails with ESLint's exit code for that.
    fn fail(mut self, text: &[u8]) -> Outcome {
        self.error(text);
        self.out.exit_code = 2;
        self.out
    }

    fn format(&self) -> Result<Format, Vec<u8>> {
        let Some(name) = &self.options.format else {
            return Ok(Format::Stylish);
        };
        Format::by_name(name).ok_or_else(|| {
            [
                b"There is no formatter \"",
                &name[..],
                b"\". Those that exist: stylish, json, json-with-metadata, unix.",
            ]
            .concat()
        })
    }

    /// What ESLint's `cli.execute` refuses. `None`: nothing.
    fn refusal(&self) -> Option<Vec<u8>> {
        let options = self.options;
        let text: &[u8] = if options.print_config.is_some() && !options.patterns.is_empty() {
            b"The --print-config option must be used with exactly one file name."
        } else if options.print_config.is_some() && options.stdin {
            b"The --print-config option is not available for piped-in code."
        } else if options.fix && options.fix_dry_run {
            b"The --fix option and the --fix-dry-run option cannot be used together."
        } else if options.stdin && options.fix {
            b"The --fix option is not available for piped-in code; use --fix-dry-run instead."
        } else if options.fix_type.is_some() && !options.fix && !options.fix_dry_run {
            b"The --fix-type option requires either --fix or --fix-dry-run."
        } else if options.report_unused_disable_directives && options.report_unused_disable_directives_severity.is_some() {
            b"The --report-unused-disable-directives option and the --report-unused-disable-directives-severity option cannot be used together."
        } else if options.ext.as_ref().is_some_and(Vec::is_empty) {
            b"The --ext option value cannot be empty."
        } else if let Some(index) = options.ext.as_ref().and_then(|all| all.iter().position(Vec::is_empty)) {
            return Some(
                format!("The --ext option arguments cannot be empty strings. Found an empty string at index {index}.")
                    .into_bytes(),
            );
        } else if let Some(flag) = options.without_effect.iter().find(|flag| **flag != b"cache") {
            return Some([b"bun lint does not support --", *flag, b"."].concat());
        } else {
            return None;
        };
        Some(text.to_vec())
    }

    /// ESLint's `lintText`.
    fn lint_text(&self, loader: &Loader, context: &Context, text: Vec<u8>) -> Result<Linted, Fatal> {
        let cwd = &self.environment.cwd;
        let name = self.options.stdin_filename.as_deref().filter(|name| !name.is_empty());
        let path = paths::resolve(cwd, &paths::from_native(name.unwrap_or(b"__placeholder__.js")));
        let loaded = loader.for_directory(paths::dirname(&path))?;
        let status: Status = loaded.config.get(loader.linter.registry(), &path).into();
        let Status::Matched(config) = &status else {
            let results = self.options.warn_ignored.then(|| context.ignored(&path, &status));
            return Ok(Linted {
                results: results.into_iter().collect(),
                files: 0,
            });
        };
        if let Some(error) = &config.error {
            return Err(Fatal(error.clone()));
        }
        let shown = if path.ends_with(b"__placeholder__.js") { b"<text>".to_vec() } else { path.clone() };
        let on_circular_fixes = |path: &[u8]| warn_about_circular_fixes(loader, path);
        Ok(Linted {
            results: vec![context.verify_text(shown, &path, text, config, &on_circular_fixes)],
            files: 1,
        })
    }

    /// ESLint's `lintFiles`.
    fn lint_files(&self, loader: &Loader, context: &Context, pool: &Pool, phases: &mut Phases) -> Result<Linted, Fatal> {
        let dot = [b".".to_vec()];
        let patterns = match &self.options.patterns[..] {
            [] if self.options.pass_on_no_patterns => {
                return Ok(Linted {
                    results: Vec::new(),
                    files: 0,
                });
            }
            [] => &dot[..],
            patterns => patterns,
        };
        if patterns.iter().any(|pattern| pattern.trim_ascii().is_empty()) {
            return Err(Fatal(b"'patterns' must be a non-empty string or an array of non-empty strings".to_vec()));
        }
        let started = Instant::now();
        let targets = discover::find_files(loader, pool, patterns, self.options.error_on_unmatched_pattern)?;
        phases.discovery = started.elapsed().as_secs_f64();
        // ESLint finds out when it comes to the file.
        let invalid = targets.iter().find_map(|target| match &target.status {
            Status::Matched(config) => config.error.clone(),
            _ => None,
        });
        if let Some(error) = invalid {
            return Err(Fatal(error));
        }
        let (supported, unsupported): (Vec<Target>, Vec<Target>) = targets.into_iter().partition(|target| match &target.status {
            Status::Matched(config) => config.is_supported(&target.path),
            _ => true,
        });
        if !unsupported.is_empty() {
            let count = format!("{}", unsupported.len()).into_bytes();
            let noun: &[u8] = if unsupported.len() == 1 { b" file was" } else { b" files were" };
            loader.warn(&[&count, noun, b" skipped: only JavaScript and TypeScript can be linted, without a processor."]);
        }
        let on_circular_fixes = |path: &[u8]| warn_about_circular_fixes(loader, path);
        let mut results = Vec::with_capacity(supported.len());

        // Those that need types first. What turns out to be in no program is linted without.
        let started = Instant::now();
        let mut without_types: Vec<&Target> = Vec::with_capacity(supported.len());
        let mut with_types: Vec<(&Target, Typed)> = Vec::new();
        let mut rules_without_types: Vec<&'static str> = Vec::new();
        for target in &supported {
            let Status::Matched(config) = &target.status else {
                without_types.push(target);
                continue;
            };
            let mut needing = config.rules.iter().filter(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
            if loader.wants_types(&target.loaded, config) {
                match needing.next() {
                    Some(_) => with_types.push((target, Typed { path: &target.path, config })),
                    None => without_types.push(target),
                }
                continue;
            }
            for rule in needing.map(|it| it.entry.meta.name) {
                if !rules_without_types.contains(&rule) {
                    rules_without_types.push(rule);
                }
            }
            without_types.push(target);
        }
        if !rules_without_types.is_empty() {
            let count = format!("{}", rules_without_types.len()).into_bytes();
            let noun: &[u8] = if rules_without_types.len() == 1 { b" rule needs" } else { b" rules need" };
            loader.warn(&[&count, noun, b" types, which the configuration does not ask for, and did not run. Use --type-aware to run them."]);
        }
        if !with_types.is_empty() {
            let (targets, files): (Vec<&Target>, Vec<Typed>) = with_types.into_iter().unzip();
            let linted = typed::lint(context, self.environment, &files, &on_circular_fixes);
            for (target, result) in targets.into_iter().zip(linted) {
                match result {
                    Some(result) => results.push(result),
                    None => without_types.push(target),
                }
            }
        }
        phases.checking = started.elapsed().as_secs_f64();

        let started = Instant::now();
        let (mut results, mut failure) = (Guarded::new(results), Guarded::new(None));
        pool.for_each(without_types.len(), 1, &|index| match context.lint_file(without_types[index], &on_circular_fixes) {
            Ok(Some(result)) => results.lock().push(result),
            Ok(None) => {}
            Err(error) => {
                failure.lock().get_or_insert(error);
            }
        });
        phases.linting = started.elapsed().as_secs_f64();
        if let Some(error) = failure.get_mut().take() {
            return Err(error);
        }
        let files = supported.iter().filter(|it| matches!(it.status, Status::Matched(_))).count();
        Ok(Linted {
            results: std::mem::take(results.get_mut()),
            files,
        })
    }

    fn execute(mut self) -> Outcome {
        let (options, environment) = (self.options, self.environment);
        if let Some(refusal) = self.refusal() {
            return self.fail(&refusal);
        }
        let format = match self.format() {
            Ok(format) => format,
            Err(error) => return self.fail(&error),
        };
        let linter = Linter::new(Registry::new(&[bun_lint_eslint::RULES, bun_lint_typescript::RULES]));
        let loader = Loader::new(&linter, options, environment);
        let timing = Timing {
            is_on: options.timing,
            ..Timing::default()
        };
        let context = Context {
            linter: &linter,
            options,
            cwd: &environment.cwd,
            keeps_text: format.reads_text(),
            timing: &timing,
        };
        let pool = Pool::new(options.threads);
        let mut phases = Phases::default();
        let linted = match options.stdin {
            true => match fs::read_stdin() {
                Ok(text) => self.lint_text(&loader, &context, text),
                Err(error) => Err(Fatal([&b"Cannot read standard input: "[..], &fs::describe(&error)].concat())),
            },
            false => self.lint_files(&loader, &context, &pool, &mut phases),
        };
        for warning in std::mem::take(&mut *loader.warnings.lock()) {
            self.warn(&warning);
        }
        let Linted { mut results, files } = match linted {
            Ok(linted) => linted,
            Err(Fatal(error)) => return self.fail(&error),
        };

        if options.fix {
            for result in results.iter().filter(|it| it.is_fixed) {
                let text = result.text.as_deref().unwrap_or_default();
                if let Err(error) = fs::write_atomically(&result.path, text) {
                    let error = [b"Cannot write ", &result.path[..], b": ", &fs::describe(&error)].concat();
                    return self.fail(&error);
                }
            }
        }

        let mut counts = Counts::default();
        results.iter().for_each(|it| counts.add(it.counts));
        if options.quiet {
            results.iter_mut().for_each(FileResult::keep_errors_only);
            results.retain(|it| !it.messages.is_empty());
        }
        let has_too_many_warnings = options.max_warnings >= 0 && counts.warnings as i64 > options.max_warnings;
        results.sort_by(|a, b| compare_paths(&a.path, &b.path));

        let started = Instant::now();
        let meta = format::Meta {
            cwd: &environment.cwd,
            color: options.color.unwrap_or(environment.stdout.colors),
            color_option: options.color,
            max_warnings_exceeded: has_too_many_warnings.then_some((options.max_warnings, counts.warnings)),
        };
        let output = if options.silent { Vec::new() } else { format::format(format, &results, &meta) };
        phases.formatting = started.elapsed().as_secs_f64();
        if let Some(file) = &options.output_file {
            let path = paths::resolve(&environment.cwd, &paths::from_native(file));
            if fs::kind(&path) == Some(fs::Kind::Directory) {
                return self.fail(&[b"Cannot write to output file path, it is a directory: ", &file[..]].concat());
            }
            if let Err(error) = fs::write_new(&path, &output) {
                return self.fail(&[&b"There was a problem writing the output file:\n"[..], &fs::describe(&error)].concat());
            }
        } else if !output.is_empty() {
            self.out.stdout = output;
            self.out.stdout.push(b'\n');
        }

        if counts.errors == 0 && has_too_many_warnings {
            let text = format!("Found too many warnings (maximum: {}).", options.max_warnings);
            self.error(text.as_bytes());
        }
        if !options.stdin && !options.silent {
            self.write_summary(counts, files);
        }
        if options.timing {
            self.write_timing(&timing, &phases, &pool);
        }
        self.out.exit_code = if options.exit_on_fatal_error && counts.fatal_errors > 0 {
            2
        } else {
            u8::from(counts.errors > 0 || has_too_many_warnings || (options.deny_warnings && counts.warnings > 0))
        };
        self.out
    }

    fn write_summary(&mut self, counts: Counts, files: usize) {
        let colors = self.environment.stderr.colors;
        let took = bun_core::output::Elapsed {
            colors,
            ms: self.began.elapsed().as_secs_f64() * 1000.0,
        };
        let noun = if files == 1 { "file" } else { "files" };
        let out = &mut self.out.stderr;
        if counts.errors + counts.warnings == 0 {
            pretty!(out, colors, "<green>\u{2713}<r> No problems<d> in {} {} {}<r>\n", files, noun, took);
        } else {
            pretty!(out, colors, "<d>Linted {} {} {}<r>\n", files, noun, took);
        }
    }

    fn write_timing(&mut self, timing: &Timing, phases: &Phases, pool: &Pool) {
        let cpu = |nanos: &AtomicU64| nanos.load(Ordering::Relaxed) as f64 / 1e6;
        let _ = writeln!(
            self.out.stderr,
            "  wall: {:.1}ms finding files and configurations, {:.1}ms type checking and linting, {:.1}ms linting without types, {:.1}ms formatting, {:.1}ms in all, on {} threads\n  cpu:  {:.1}ms reading, {:.1}ms parsing and binding, {:.1}ms in rules",
            phases.discovery * 1e3,
            phases.checking * 1e3,
            phases.linting * 1e3,
            phases.formatting * 1e3,
            self.began.elapsed().as_secs_f64() * 1e3,
            pool.threads,
            cpu(&timing.read),
            cpu(&timing.parse),
            cpu(&timing.rules),
        );
    }
}

/// How long the parts of a run took, in seconds.
#[derive(Default)]
struct Phases {
    discovery: f64,
    /// With types.
    checking: f64,
    linting: f64,
    formatting: f64,
}

fn warn_about_circular_fixes(loader: &Loader, path: &[u8]) {
    loader.warn(&[
        b"Circular fixes detected while fixing ",
        path,
        b". It is likely that you have conflicting rules in your configuration.",
    ]);
}

/// Does what `bun lint` does. `options.help` and `options.cwd` are for the caller to see to.
pub fn run(options: &Options, environment: &Environment) -> Outcome {
    let run = Run {
        options,
        environment,
        out: Outcome::default(),
        began: Instant::now(),
    };
    run.execute()
}
