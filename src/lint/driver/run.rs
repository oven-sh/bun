//! `bun lint`: ESLint's `cli.execute`.

use crate::cli::Options;
use crate::configs::{Flavor, Loader};
use crate::discover::{self, Status, Target};
use crate::format::{self, Format};
use crate::lint::{Context, elapsed};
use crate::results::{Counts, FileResult};
use crate::suppressions::{self, Suppressions};
use crate::typed::{self, Typed};
use crate::{fs, paths};
use bstr::BStr;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin::{Engine, Host, Loading, Route};
use bun_lint::linter::{FileConfig, Linter, Registry};
use bun_sema::util::FxHashSet;
use bun_threading::Guarded;
use std::io::Write;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// The version of ESLint whose behavior this is.
const ESLINT_VERSION: &str = "10.12.0";

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
    /// The working directory: absolute, and through [`from_native_path`](crate::from_native_path).
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
    /// Where the rules that are written in JavaScript run.
    pub js_engine: &'e dyn Engine,
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

const NO_FILES_FOR_OXLINT: &[u8] =
    b"No files found to lint. Please check your paths and ignore patterns.";

/// Why nothing can be linted: the message. ESLint throws, and exits with 2.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct Fatal(pub(crate) Vec<u8>);

/// The threads.
pub(crate) struct Pool {
    caches: bun_sema_driver::ThreadCaches,
    threads: AtomicUsize,
}

/// With rules in JavaScript, more threads than this take more time and memory, and are no faster:
/// the engines of a process share what hands out memory for compiled code.
const MOST_THREADS_WITH_JS_PLUGINS: usize = 16;

/// There is one more engine for JavaScript for so many files that need one: to start it and to load the plugins takes as long as
/// to lint them.
const FILES_FOR_AN_ENGINE: usize = 32;

/// What it takes to lint a file, beyond what is in this program.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Needs {
    Nothing,
    /// A rule or a processor in JavaScript.
    Engine,
    /// One for which the engine has to run the configuration file, with all that it imports.
    Configuration,
}

/// How many engines lint so many files.
fn engines_for(files: usize) -> usize {
    files.div_ceil(FILES_FOR_AN_ENGINE).max(1)
}

fn needs(target: &Target) -> Needs {
    let Status::Matched(config) = &target.status else {
        return Needs::Nothing;
    };
    let mut on = (config.js_rules.iter()).filter(|it| it.severity != Severity::Off);
    let processor = config
        .processor_location
        .as_ref()
        .filter(|_| target.has_processor());
    if processor.is_some_and(|it| it.needs_the_configuration)
        || on
            .clone()
            .any(|it| it.configured.rule.needs_the_configuration)
    {
        Needs::Configuration
    } else if on.next().is_some() || target.has_processor() {
        Needs::Engine
    } else {
        Needs::Nothing
    }
}

/// How many threads lint. 0: one for each core.
pub(crate) fn threads_to_lint_on(options: &Options, js_plugins: &Host) -> usize {
    match options.threads {
        0 if js_plugins.has_plugins() => usize::from(bun_core::get_thread_count())
            .min(MOST_THREADS_WITH_JS_PLUGINS)
            .min(js_plugins.most_realms()),
        // A file with types is linted by the thread that has checked it, so each thread can have a realm.
        threads if js_plugins.has_plugins() => threads.min(js_plugins.most_realms()),
        threads => threads,
    }
}

impl Pool {
    pub(crate) fn new(threads: usize) -> Pool {
        Pool {
            caches: Default::default(),
            threads: AtomicUsize::new(match threads {
                0 => usize::from(bun_core::get_thread_count()),
                threads => threads,
            }),
        }
    }

    pub(crate) fn threads(&self) -> usize {
        self.threads.load(Ordering::Relaxed)
    }

    /// Calls `work` with every index below `count`, `run` consecutive ones at a time.
    pub(crate) fn for_each(&self, count: usize, run: usize, work: &(dyn Fn(usize) + Sync)) {
        bun_sema_driver::for_each_parallel_in_runs(&self.caches, self.threads(), count, run, work);
    }
}

/// `--timing`: how long all threads together have spent on what, in nanoseconds.
#[derive(Default)]
pub(crate) struct Timing {
    is_on: bool,
    pub(crate) read: AtomicU64,
    pub(crate) parse: AtomicU64,
    pub(crate) rules: AtomicU64,
    /// Files in which `File::mentions` says yes to every name, so that each rule about a name listens.
    pub(crate) without_filter: AtomicU64,
}

impl Timing {
    pub(crate) fn now(&self) -> Option<Instant> {
        self.is_on.then(Instant::now)
    }

    pub(crate) fn count(&self, what: &AtomicU64) {
        if self.is_on {
            what.fetch_add(1, Ordering::Relaxed);
        }
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

/// Whether [`compare_paths`] is the order of the bytes for `path`.
fn is_ordered_by_bytes(path: &[u8]) -> bool {
    path.iter().all(|&byte| byte < 0xEE)
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
    /// `--list-files`
    listed: Option<Vec<Vec<u8>>>,
}

impl Run<'_> {
    fn error(&mut self, text: &[u8]) {
        pretty!(
            &mut self.out.stderr,
            self.environment.stderr.colors,
            "<red>error<r><d>:<r> {}\n",
            BStr::new(text)
        );
    }

    fn warn(&mut self, text: &[u8]) {
        pretty!(
            &mut self.out.stderr,
            self.environment.stderr.colors,
            "<yellow>warn<r><d>:<r> {}\n",
            BStr::new(text)
        );
    }

    /// Fails with ESLint's exit code for that.
    fn fail(mut self, text: &[u8]) -> Outcome {
        self.error(text);
        self.out.exit_code = 2;
        self.out
    }

    /// `is_oxlint`: the configuration of the working directory is oxlint's.
    fn format(&self, is_oxlint: bool) -> Result<Format, Vec<u8>> {
        let Some(name) = &self.options.format else {
            return Ok(match is_oxlint {
                // An agent is saved from opening the files.
                _ if self.environment.is_ai_agent => Format::Agent,
                // Like its `default`.
                true => Format::Pretty,
                false => Format::Stylish,
            });
        };
        Format::by_name(name, is_oxlint).ok_or_else(|| {
            [
                b"There is no formatter \"",
                &name[..],
                b"\". Those that exist: ",
                Format::NAMES.as_bytes(),
                b".",
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
        } else if options.report_unused_disable_directives
            && options.report_unused_disable_directives_severity.is_some()
        {
            b"The --report-unused-disable-directives option and the --report-unused-disable-directives-severity option cannot be used together."
        } else if options.ext.as_ref().is_some_and(Vec::is_empty) {
            b"The --ext option value cannot be empty."
        } else if let Some(index) = options
            .ext
            .as_ref()
            .and_then(|all| all.iter().position(Vec::is_empty))
        {
            return Some(
                format!("The --ext option arguments cannot be empty strings. Found an empty string at index {index}.")
                    .into_bytes(),
            );
        } else if options.suppress_all && options.suppress_rule.is_some() {
            b"The --suppress-all option and the --suppress-rule option cannot be used together."
        } else if options.suppress_all && options.prune_suppressions {
            b"The --suppress-all option and the --prune-suppressions option cannot be used together."
        } else if options.suppress_rule.is_some() && options.prune_suppressions {
            b"The --suppress-rule option and the --prune-suppressions option cannot be used together."
        } else if options.stdin
            && (options.suppress_all
                || options.suppress_rule.is_some()
                || options.prune_suppressions)
        {
            b"The --suppress-all, --suppress-rule, and --prune-suppressions options cannot be used with piped-in code."
        } else {
            let flag = options
                .without_effect
                .iter()
                .find(|flag| **flag != b"cache")?;
            return Some([b"bun lint does not support --", *flag, b"."].concat());
        };
        Some(text.to_vec())
    }

    /// ESLint's `lintText`.
    fn lint_text(
        &self,
        loader: &Loader,
        context: &Context,
        text: Vec<u8>,
    ) -> Result<Linted, Fatal> {
        let cwd = &self.environment.cwd;
        let name = self
            .options
            .stdin_filename
            .as_deref()
            .filter(|name| !name.is_empty());
        let path = paths::resolve(
            cwd,
            &paths::from_native(name.unwrap_or(b"__placeholder__.js")),
        );
        let loaded = loader.for_directory(paths::dirname(&path))?;
        let status: Status = loaded.config.get(loader.linter.registry(), &path).into();
        let Status::Matched(config) = &status else {
            let results = self
                .options
                .warn_ignored
                .then(|| context.ignored(&path, &status));
            return Ok(Linted {
                results: results.into_iter().collect(),
                files: 0,
                listed: None,
            });
        };
        if let Some(error) = &config.error {
            return Err(Fatal(error.clone()));
        }
        let shown = if path.ends_with(b"__placeholder__.js") {
            b"<text>".to_vec()
        } else {
            paths::to_native(path.clone())
        };
        let on_circular_fixes = |path: &[u8]| warn_about_circular_fixes(loader, path);
        if let Some(framework) = loaded.framework(&path) {
            let result = context.verify_text_by(
                shown,
                &path,
                text,
                config,
                &on_circular_fixes,
                &mut |text| context.verify_scripts(framework, &path, text, config),
            );
            return Ok(Linted {
                results: vec![result],
                files: 1,
                listed: None,
            });
        }
        if loaded.routes(config, &path) == Route::Processor {
            let result = context.verify_processed_text(
                &loaded,
                shown,
                &path,
                text,
                config,
                &on_circular_fixes,
            );
            return Ok(Linted {
                results: vec![result],
                files: 1,
                listed: None,
            });
        }
        let needs_types = name.is_some()
            && loader.wants_types(&loaded, config)
            && config
                .rules
                .iter()
                .any(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
        if needs_types {
            let file = Typed {
                path: &path,
                config,
                text: Some(text.clone()),
            };
            if let Some(Some(result)) =
                typed::lint(context, self.environment, &[file], &on_circular_fixes).pop()
            {
                return Ok(Linted {
                    results: vec![result],
                    files: 1,
                    listed: None,
                });
            }
        }
        Ok(Linted {
            results: vec![context.verify_text(shown, &path, text, config, &on_circular_fixes)],
            files: 1,
            listed: None,
        })
    }

    /// ESLint's `lintFiles`.
    fn lint_files(
        &self,
        loader: &Loader,
        context: &Context,
        pool: &Pool,
        phases: &mut Phases,
    ) -> Result<Linted, Fatal> {
        let dot = [b".".to_vec()];
        let patterns = match &self.options.patterns[..] {
            [] if self.options.pass_on_no_patterns => {
                return Ok(Linted {
                    results: Vec::new(),
                    files: 0,
                    listed: None,
                });
            }
            [] => &dot[..],
            patterns => patterns,
        };
        if patterns
            .iter()
            .any(|pattern| pattern.trim_ascii().is_empty())
        {
            return Err(Fatal(
                b"'patterns' must be a non-empty string or an array of non-empty strings".to_vec(),
            ));
        }
        let started = Instant::now();
        // oxlint says nothing about an argument that matches nothing, as long as there is a file.
        let is_oxlint = loader
            .for_directory(&self.environment.cwd)
            .is_ok_and(|it| it.flavor == Flavor::Oxlint);
        let targets = discover::find_files(
            loader,
            pool,
            patterns,
            self.options.error_on_unmatched_pattern && !is_oxlint,
        )?;
        phases.discovery = started.elapsed().as_secs_f64();
        // Every configuration is loaded by now.
        let has_processors = targets.iter().any(Target::has_processor);
        let threads = match threads_to_lint_on(self.options, context.js_plugins) {
            0 if has_processors => pool
                .threads()
                .min(MOST_THREADS_WITH_JS_PLUGINS)
                .min(context.js_plugins.most_realms()),
            threads => threads,
        };
        if threads > 0 {
            pool.threads.store(threads, Ordering::Relaxed);
        }
        if has_processors || context.js_plugins.has_plugins() {
            bun_sema_driver::keep_to_the_same_threads();
        }
        if is_oxlint
            && self.options.error_on_unmatched_pattern
            && !targets
                .iter()
                .any(|it| matches!(it.status, Status::Matched(_)))
        {
            return Err(Fatal(NO_FILES_FOR_OXLINT.to_vec()));
        }
        if self.options.list_files {
            let listed = targets
                .into_iter()
                .filter(|it| matches!(it.status, Status::Matched(_)));
            return Ok(Linted {
                results: Vec::new(),
                files: 0,
                listed: Some(listed.map(|it| it.path).collect()),
            });
        }
        // ESLint finds out when it comes to the file.
        let invalid = targets.iter().find_map(|target| match &target.status {
            Status::Matched(config) => config.error.clone(),
            _ => None,
        });
        if let Some(error) = invalid {
            return Err(Fatal(error));
        }
        let (supported, unsupported): (Vec<Target>, Vec<Target>) =
            targets
                .into_iter()
                .partition(|target| match &target.status {
                    Status::Matched(config) => {
                        target.loaded.routes(config, &target.path) != Route::Unsupported
                    }
                    _ => true,
                });
        if !unsupported.is_empty() {
            let count = format!("{}", unsupported.len()).into_bytes();
            let noun: &[u8] = if unsupported.len() == 1 {
                b" file was"
            } else {
                b" files were"
            };
            // By what they are called, the most frequent first, and the first few.
            let mut kinds: Vec<(&[u8], usize)> = Vec::new();
            for target in &unsupported {
                let name = paths::basename(&target.path);
                let dot = strings::last_index_of_char(name, b'.').unwrap_or(0);
                match kinds.iter_mut().find(|it| it.0 == &name[dot..]) {
                    Some(kind) => kind.1 += 1,
                    None => kinds.push((&name[dot..], 1)),
                }
            }
            kinds.sort_by_key(|it| std::cmp::Reverse(it.1));
            let kinds: Vec<Vec<u8>> = (kinds.iter())
                .map(|it| [format!("{} *", it.1).as_bytes(), it.0].concat())
                .collect();
            let first = unsupported.iter().take(3);
            let first: Vec<Vec<u8>> = first
                .map(|it| paths::relative(&self.environment.cwd, &it.path))
                .collect();
            let more: &[u8] = if unsupported.len() > 3 { b", .." } else { b"" };
            loader.cannot_do(&[
                &count,
                noun,
                b" not linted, only JavaScript and TypeScript can be (",
                &kinds.join(&b", "[..]),
                b"): ",
                &first.join(&b", "[..]),
                more,
            ]);
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
            if target.has_processor() || target.framework().is_some() {
                without_types.push(target);
                continue;
            }
            let mut needing = config
                .rules
                .iter()
                .filter(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
            if loader.wants_types(&target.loaded, config) {
                match needing.next() {
                    Some(_) => with_types.push((
                        target,
                        Typed {
                            path: &target.path,
                            config,
                            text: None,
                        },
                    )),
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
            let noun: &[u8] = if rules_without_types.len() == 1 {
                b" rule needs"
            } else {
                b" rules need"
            };
            loader.warn(&[&count, noun, b" types, which the configuration does not ask for, and did not run. Use --type-aware to run them."]);
        }
        // A file with types is linted by the thread that has checked it, whichever that is.
        let with_engine = (without_types.iter()).filter(|it| needs(it) != Needs::Nothing);
        context.js_plugins.expect(
            match with_types.iter().any(|it| needs(it.0) != Needs::Nothing) {
                true => pool.threads(),
                false => engines_for(with_engine.count())
                    .min(pool.threads())
                    .min(context.js_plugins.most_realms()),
            },
        );
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
        // What takes longest first, so that no thread begins it when the others are nearly done: what needs JavaScript, then
        // the largest.
        without_types.sort_by_cached_key(|target| std::cmp::Reverse((needs(target), target.size)));
        let count = |least: Needs| without_types.partition_point(|target| needs(target) >= least);
        let (with_engine, plain) = without_types.split_at(count(Needs::Engine));
        // One engine is enough to run the configuration file.
        let (with_configuration, with_engine) = with_engine.split_at(count(Needs::Configuration));
        let units: Vec<&[&Target]> = std::iter::once(with_configuration)
            .chain(with_engine.chunks(1))
            .collect();
        let engines = engines_for(units.len()).min(context.js_plugins.most_realms());
        let (next_unit, next_plain) = (AtomicUsize::new(0), AtomicUsize::new(0));
        let (mut results, mut failure) = (Guarded::new(results), Guarded::new(None));
        let lint = |target: &Target| match context.lint_file(target, &on_circular_fixes) {
            Ok(Some(result)) => results.lock().push(result),
            Ok(None) => {}
            Err(error) => {
                failure.lock().get_or_insert(error);
            }
        };
        pool.for_each(pool.threads(), 1, &|worker| {
            while worker < engines
                && let Some(unit) = units.get(next_unit.fetch_add(1, Ordering::Relaxed))
            {
                unit.iter().for_each(|target| lint(target));
            }
            while let Some(target) = plain.get(next_plain.fetch_add(1, Ordering::Relaxed)) {
                lint(target);
            }
        });
        phases.linting = started.elapsed().as_secs_f64();
        if let Some(error) = failure.get_mut().take() {
            return Err(error);
        }
        let files = supported
            .iter()
            .filter(|it| matches!(it.status, Status::Matched(_)))
            .count();
        Ok(Linted {
            results: std::mem::take(results.get_mut()),
            files,
            listed: None,
        })
    }

    fn execute(mut self) -> Outcome {
        let (options, environment) = (self.options, self.environment);
        if options.version {
            self.out.stdout = [environment.version, b"\n"].concat();
            return self.out;
        }
        if options.env_info {
            let _ = writeln!(
                self.out.stdout,
                "Environment Info:\n\nBun version: {}\nESLint version: {ESLINT_VERSION} (the version that bun lint matches)\nTypeScript version: {}",
                BStr::new(environment.version),
                BStr::new(bun_sema_driver::TYPESCRIPT_VERSION.to_bytes()),
            );
            return self.out;
        }
        if let Some(refusal) = self.refusal() {
            return self.fail(&refusal);
        }
        let linter = Linter::new(Registry::new(&[
            bun_lint_eslint::RULES,
            bun_lint_typescript::RULES,
            bun_lint_plugins::RULES,
        ]));
        let pool = Pool::new(options.threads);
        // Nothing is started unless a configuration has a plugin in JavaScript.
        let js_plugins = Host::with_engine(
            environment.js_engine,
            &paths::to_native(environment.cwd.clone()),
        )
        .measuring(options.timing);
        let store = bun_lint_graph::Store::new(&environment.cwd);
        let modules = bun_lint_graph::Graph::new(&store);
        let loader = Loader::new(&linter, options, environment, &js_plugins);
        // One that cannot be read is reported when a file is linted with it.
        let of_cwd = loader.for_directory(&environment.cwd).ok();
        let format = match self.format(
            of_cwd
                .as_ref()
                .is_some_and(|it| it.flavor == Flavor::Oxlint),
        ) {
            Ok(format) => format,
            Err(error) => return self.fail(&error),
        };
        if options.rules {
            let as_json = matches!(format, Format::Json | Format::OxlintJson);
            format::oxlint::write_rules(&mut self.out.stdout, linter.registry(), as_json);
            return self.out;
        }
        let timing = Timing {
            is_on: options.timing,
            ..Timing::default()
        };
        let names: Vec<_> = (0..pool.threads().max(1))
            .map(|_| bun_sema::session::Session::new())
            .collect();
        let atoms = bun_sema::atom::InternerPerThread::new_in(&names);
        let memory = bun_sema::session::Session::new();
        let context = Context {
            memory: &memory,
            atoms: &atoms,
            linter: &linter,
            options,
            cwd: &environment.cwd,
            keeps_text: format.reads_text() && !options.silent,
            reads_fixes: format.reads_fixes() && !options.silent,
            reads_suppressions: format.reads_suppressions() && !options.silent,
            js_plugins: &js_plugins,
            modules: &modules,
            timing: &timing,
        };
        if let Some(file) = &options.print_config {
            let path = paths::resolve(&environment.cwd, &paths::from_native(file));
            let config = match loader.for_directory(paths::dirname(&path)) {
                Ok(loaded) => loaded.config.get(linter.registry(), &path),
                Err(Fatal(error)) => return self.fail(&error),
            };
            self.out.stdout = crate::print_config::print(match &config {
                FileConfig::Matched(config) => Some(config),
                _ => None,
            });
            self.out.stdout.push(b'\n');
            return self.out;
        }
        let mut phases = Phases::default();
        let linted = match options.stdin {
            true => match fs::read_stdin() {
                Ok(text) => self.lint_text(&loader, &context, text),
                Err(error) => Err(Fatal(
                    [&b"Cannot read standard input: "[..], &fs::describe(&error)].concat(),
                )),
            },
            false => self.lint_files(&loader, &context, &pool, &mut phases),
        };
        for warning in std::mem::take(&mut *loader.warnings.lock()) {
            self.warn(&warning);
        }
        let without_types = js_plugins.rules_that_asked_for_types();
        if !without_types.is_empty() {
            let ids: Vec<&[u8]> = without_types.iter().map(|it| &it.id[..]).collect();
            let noun: &[u8] = match ids.len() {
                1 => b" rule",
                _ => b" rules",
            };
            loader.cannot_do(&[
                ids.len().to_string().as_bytes(),
                noun,
                b" in JavaScript did not run, only the built-in rules have types: ",
                &ids.join(&b", "[..]),
            ]);
        }
        let mut unsupported = std::mem::take(&mut *loader.unsupported.lock());
        if options.allow_unsupported {
            for line in unsupported.drain(..) {
                self.warn(&line);
            }
        }
        let Linted {
            mut results,
            files,
            listed,
        } = match linted {
            Ok(linted) => linted,
            Err(Fatal(error)) => {
                let is_about_files = error == NO_FILES_FOR_OXLINT;
                let mut out = self.fail(&error);
                // As oxlint.
                out.exit_code = if is_about_files { 1 } else { out.exit_code };
                return out;
            }
        };
        if let Some(listed) = listed {
            for path in listed {
                self.out.stdout.extend_from_slice(&paths::to_native(path));
                self.out.stdout.push(b'\n');
            }
            return self.out;
        }

        // The rules that are about several files look at those that they have something to say about.
        let started = Instant::now();
        let again: FxHashSet<Vec<u8>> = modules
            .complete(&|count, work| pool.for_each(count, 1, work))
            .into_iter()
            .collect();
        if !again.is_empty() {
            let mut at: Vec<usize> = (0..results.len())
                .filter(|&at| again.contains(&paths::from_native(&results[at].path)))
                .collect();
            at.reverse();
            let mut picked: Vec<Guarded<Option<FileResult>>> = at
                .into_iter()
                .map(|at| Guarded::new(Some(results.swap_remove(at))))
                .collect();
            let mut failure = Guarded::new(None);
            pool.for_each(picked.len(), 1, &|index| {
                if let Some(result) = picked[index].lock().as_mut()
                    && let Err(error) = context.lint_again(result)
                {
                    failure.lock().get_or_insert(error);
                }
            });
            if let Some(Fatal(error)) = failure.get_mut().take() {
                return self.fail(&error);
            }
            results.extend(picked.iter_mut().filter_map(|it| it.get_mut().take()));
        }
        phases.linting += started.elapsed().as_secs_f64();
        if let Some(thrown) = results.iter().find_map(|it| it.thrown.as_ref()) {
            return self.fail(thrown);
        }

        let mut fixed = 0;
        if options.fix {
            let changed: Vec<&FileResult> = results.iter().filter(|it| it.is_fixed).collect();
            let mut failure = Guarded::new(None);
            pool.for_each(changed.len(), 1, &|index| {
                let result = changed[index];
                if let Err(error) =
                    fs::write_atomically(&result.path, result.text.as_deref().unwrap_or_default())
                {
                    failure.lock().get_or_insert(
                        [
                            b"Cannot write ",
                            &result.path[..],
                            b": ",
                            &fs::describe(&error),
                        ]
                        .concat(),
                    );
                }
            });
            if let Some(error) = failure.get_mut().take() {
                return self.fail(&error);
            }
            fixed = changed.len();
        }

        let mut has_unused_suppressions = false;
        if !options.stdin {
            match self.apply_suppressions(
                &mut results,
                of_cwd
                    .as_ref()
                    .is_some_and(|it| it.flavor == Flavor::Oxlint),
            ) {
                Ok(has_unused) => has_unused_suppressions = has_unused,
                Err(Fatal(error)) => return self.fail(&error),
            }
        }

        let mut counts = Counts::default();
        results.iter().for_each(|it| counts.add(it.counts));
        if options.quiet {
            results.iter_mut().for_each(FileResult::keep_errors_only);
            results.retain(|it| !it.messages.is_empty());
        }
        // What the command line does not say, the `options` of an `.oxlintrc.json` can.
        let max_warnings = match options.max_warnings {
            -1 => of_cwd.as_ref().and_then(|it| it.max_warnings).unwrap_or(-1),
            given => given,
        };
        let denies_warnings =
            options.deny_warnings || of_cwd.as_ref().is_some_and(|it| it.denies_warnings);
        let has_too_many_warnings = max_warnings >= 0 && counts.warnings as i64 > max_warnings;
        match results.iter().all(|it| is_ordered_by_bytes(&it.path)) {
            true => results.sort_by(|a, b| a.path.cmp(&b.path)),
            false => results.sort_by(|a, b| compare_paths(&a.path, &b.path)),
        }

        let started = Instant::now();
        let meta = format::Meta {
            cwd: &environment.cwd,
            color: options.color.unwrap_or(environment.stdout.colors),
            color_option: options.color,
            max_warnings_exceeded: has_too_many_warnings.then_some((max_warnings, counts.warnings)),
            shows_all: options.all,
            github_annotations: environment.is_github_action,
            run: format::oxlint::Run {
                files,
                rules: of_cwd
                    .as_ref()
                    .filter(|_| format == Format::OxlintJson)
                    .and_then(|it| {
                        match it.config.get(
                            linter.registry(),
                            &paths::join(&environment.cwd, b"__placeholder__.js"),
                        ) {
                            FileConfig::Matched(config) => Some(
                                config
                                    .rules
                                    .iter()
                                    .filter(|it| it.severity != Severity::Off)
                                    .count(),
                            ),
                            _ => None,
                        }
                    }),
                threads: pool.threads(),
                seconds: self.began.elapsed().as_secs_f64(),
            },
            pool: &pool,
            version: environment.version,
        };
        let output = if options.silent {
            Vec::new()
        } else {
            format::format(format, &results, &meta)
        };
        phases.formatting = started.elapsed().as_secs_f64();
        if let Some(file) = &options.output_file {
            let path = paths::resolve(&environment.cwd, &paths::from_native(file));
            if fs::kind(&path) == Some(fs::Kind::Directory) {
                return self.fail(
                    &[
                        b"Cannot write to output file path, it is a directory: ",
                        &file[..],
                    ]
                    .concat(),
                );
            }
            if let Err(error) = fs::write_new(&path, &output) {
                return self.fail(
                    &[
                        &b"There was a problem writing the output file:\n"[..],
                        &fs::describe(&error),
                    ]
                    .concat(),
                );
            }
        } else if !output.is_empty() {
            self.out.stdout = output;
            self.out.stdout.push(b'\n');
        }

        if counts.errors == 0 && has_too_many_warnings {
            let text = format!("Found too many warnings (maximum: {max_warnings}).");
            self.error(text.as_bytes());
        }
        if !options.stdin && !options.silent {
            self.write_summary(counts, files, fixed);
        }
        if options.timing {
            self.write_timing(&timing, &phases, &pool, &js_plugins.loading());
        }
        if has_unused_suppressions && !options.pass_on_unpruned_suppressions {
            self.error(
                b"There are suppressions left that do not occur anymore. To resolve this, re-run the command with `--prune-suppressions` to remove unused suppressions. To ignore unused suppressions, use `--pass-on-unpruned-suppressions`.",
            );
            self.out.exit_code = 2;
            return self.out;
        }
        if !unsupported.is_empty() {
            let mut text =
                b"The configuration asks for what cannot be done yet. All else was linted."
                    .to_vec();
            for line in &unsupported {
                text.extend_from_slice(&[b"\n  ", &line[..]].concat());
            }
            text.extend_from_slice(b"\n  --allow-unsupported makes this a warning.");
            self.error(&text);
            self.out.exit_code = 2;
            return self.out;
        }
        self.out.exit_code = if options.exit_on_fatal_error && counts.fatal_errors > 0 {
            2
        } else {
            u8::from(
                counts.errors > 0
                    || has_too_many_warnings
                    || (denies_warnings && counts.warnings > 0),
            )
        };
        self.out
    }

    /// What ESLint's `cli.execute` does about `eslint-suppressions.json`. Returns whether that has
    /// what does not occur.
    fn apply_suppressions(
        &self,
        results: &mut [FileResult],
        is_oxlint: bool,
    ) -> Result<bool, Fatal> {
        let (options, cwd) = (self.options, &self.environment.cwd);
        let location = options
            .suppressions_location
            .as_deref()
            .map(paths::from_native);
        let default = if is_oxlint {
            suppressions::FILE_NAME_OF_OXLINT
        } else {
            suppressions::DEFAULT_FILE_NAME
        };
        let path = paths::resolve(cwd, location.as_deref().unwrap_or(default));
        let writes = options.suppress_all || options.suppress_rule.is_some();
        let exists = fs::is_file(&path);
        if location.is_some() && !exists && !writes {
            return Err(Fatal(
                b"The suppressions file does not exist. Please run the command with `--suppress-all` or `--suppress-rule` to create it.".to_vec(),
            ));
        }
        if !writes && !options.prune_suppressions && !exists {
            return Ok(false);
        }
        let mut suppressed = Suppressions::load(&path)?;
        if writes {
            suppressed.suppress(results, cwd, options.suppress_rule.as_deref());
            suppressed.save(&path)?;
        }
        let unused = suppressed.apply(results, cwd);
        if options.prune_suppressions {
            suppressed.prune(&unused, cwd);
            suppressed.save(&path)?;
            return Ok(false);
        }
        Ok(!unused.is_empty())
    }

    /// `fixed`: how many files were written.
    fn write_summary(&mut self, counts: Counts, files: usize, fixed: usize) {
        let colors = self.environment.stderr.colors;
        let took = bun_core::output::Elapsed {
            colors,
            ms: self.began.elapsed().as_secs_f64() * 1000.0,
        };
        let noun = if files == 1 { "file" } else { "files" };
        let fixed = if fixed > 0 {
            format!(", fixed {fixed}")
        } else {
            String::new()
        };
        let out = &mut self.out.stderr;
        if counts.errors + counts.warnings == 0 {
            pretty!(
                out,
                colors,
                "<green>\u{2713}<r> No problems<d> in {} {}{} {}<r>\n",
                files,
                noun,
                fixed,
                took
            );
        } else {
            pretty!(
                out,
                colors,
                "<d>Linted {} {}{} {}<r>\n",
                files,
                noun,
                fixed,
                took
            );
        }
    }

    fn write_timing(&mut self, timing: &Timing, phases: &Phases, pool: &Pool, loading: &Loading) {
        let cpu = |nanos: &AtomicU64| nanos.load(Ordering::Relaxed) as f64 / 1e6;
        let _ = writeln!(
            self.out.stderr,
            "  wall: {:.1}ms finding files and configurations, {:.1}ms type checking and linting, {:.1}ms linting without types, {:.1}ms formatting, {:.1}ms in all, on {} threads\n  summed over the threads: {:.1}ms reading, {:.1}ms parsing and binding, {:.1}ms in rules",
            phases.discovery * 1e3,
            phases.checking * 1e3,
            phases.linting * 1e3,
            phases.formatting * 1e3,
            self.began.elapsed().as_secs_f64() * 1e3,
            pool.threads(),
            cpu(&timing.read),
            cpu(&timing.parse),
            cpu(&timing.rules),
        );
        let _ = write!(
            self.out.stderr,
            "  JavaScript: {} engines, which have loaded {} modules, {:.1} MB of source, in {:.1}ms",
            loading.realms,
            loading.modules,
            loading.bytes as f64 / 1e6,
            loading.milliseconds,
        );
        for (i, plugin) in loading.need_the_configuration.iter().enumerate() {
            let before = match i {
                0 => "; with the whole configuration file, which alone has ",
                _ => ", ",
            };
            let _ = write!(self.out.stderr, "{before}{}", BStr::new(plugin));
        }
        self.out.stderr.push(b'\n');
        // Every file that is valid and goes to the parser that recovers from errors is a defect of the other.
        let counts = &bun_js_parser::sema::DIRECT_PARSER_COUNTS;
        let _ = write!(
            self.out.stderr,
            "  parsed directly: {} files",
            counts.parsed.load(Ordering::Relaxed)
        );
        for (why, count) in bun_js_parser::sema::REFUSALS.iter().zip(&counts.refused) {
            match count.load(Ordering::Relaxed) {
                0 => {}
                count => _ = write!(self.out.stderr, ", refused ({why:?}): {count}"),
            }
        }
        let without_filter = timing.without_filter.load(Ordering::Relaxed);
        let _ = writeln!(
            self.out.stderr,
            "\n  without a filter of the names they mention: {without_filter} files"
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
