//! `bun lint`: ESLint's `cli.execute`.

use crate::cli::{Options, Tool};
use crate::configs::{self, Flavor, Loader};
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
use bun_lint::js_plugin::{Engine, HEAVY, Host, Loading, Route};
use bun_lint::linter::{FileConfig, LintMessage, Linter, Registry, RuleId};
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

/// The text of a program, in parts: several programs begin with the same.
pub(crate) type Source = &'static [&'static str];

/// A program for the running executable to run, as `bun -e <source> <arguments>`.
pub struct Script<'s> {
    pub source: Source,
    pub arguments: &'s [&'s [u8]],
    /// The working directory.
    pub cwd: &'s [u8],
}

impl Script<'_> {
    /// The variables of the environment that steer a `bun` process and are not meant for the one that runs the program. It
    /// inherits all others: ESLint and Prettier run a configuration file in their own process, so it sees what they were started with.
    pub const NOT_INHERITED: [&'static [u8]; 7] = [
        // This process has applied these flags. `--cwd=sub` would be applied once more, in `sub`.
        b"BUN_OPTIONS",
        // A debugger in every such process, which can wait for its client for ever. Editors set these for all that their terminals start.
        b"BUN_INSPECT",
        b"BUN_INSPECT_CONNECT_TO",
        b"BUN_INSPECT_NOTIFY",
        b"BUN_INSPECT_PRELOAD",
        // The channel to what has started this process. The descriptor is not passed on.
        b"NODE_CHANNEL_FD",
        b"NODE_CHANNEL_SERIALIZATION_MODE",
    ];
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

/// What `oxlint --init` writes.
const INITIAL_OXLINTRC: &[u8] = br#"{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": [
    "typescript",
    "unicorn",
    "oxc"
  ],
  "categories": {
    "correctness": "error"
  },
  "rules": {},
  "env": {
    "builtin": true
  }
}"#;

/// The variables that tell oxlint that an agent runs it. Any value counts but an empty one.
const AGENTS_FOR_OXLINT: [&[u8]; 12] = [
    b"AI_AGENT",
    b"CLAUDECODE",
    b"CLAUDE_CODE",
    b"REPL_ID",
    b"GEMINI_CLI",
    b"CODEX_SANDBOX",
    b"CODEX_THREAD_ID",
    b"COPILOT_CLI",
    b"OPENCODE",
    b"JUNIE_DATA",
    b"JUNIE_SHIM_PATH",
    b"CURSOR_AGENT",
];

/// Whether `agent` would be oxlint's format. `AGENT` alone decides if it is set, as everywhere in Bun.
fn is_agent_for_oxlint() -> bool {
    let get = |name: &[u8]| bun_core::getenv_z(&bun_core::ZBox::from_bytes(name));
    let has = |name: &[u8], part: &[u8]| get(name).is_some_and(|it| strings::contains(it, part));
    let is_set = |&name: &&[u8]| get(name).is_some_and(|it| !it.is_empty());
    get(b"AGENT").is_none()
        && (AGENTS_FOR_OXLINT.iter().any(is_set)
            || has(b"PATH", b".pi/agent")
            || has(b"PATH", b".pi\\agent")
            || has(b"EDITOR", b"devin")
            || has(b"TERM_PROGRAM", b"kiro"))
}

/// Why nothing can be linted: the message. ESLint throws, and exits with 2.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct Fatal(pub(crate) Vec<u8>);

/// The threads.
pub(crate) struct Pool {
    caches: bun_sema_driver::ThreadCaches,
    threads: usize,
}

/// More engines for JavaScript than this take more time and memory, and are no faster: the engines of a process share what
/// hands out memory for compiled code.
const MOST_ENGINES: usize = 16;

/// What it takes to lint a file, beyond what is in this program.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Needs {
    Nothing,
    /// A rule or a processor in JavaScript.
    Engine,
    /// One for which the engine has to run the configuration file, with all that it imports.
    Configuration,
    /// What makes an engine grow: a file of [`HEAVY`] bytes, or ESLint's own `Linter` with a parser that makes a TypeScript
    /// program: gigabytes.
    Heavy,
}

fn needs(target: &Target) -> Needs {
    let Status::Matched(config) = &target.status else {
        return Needs::Nothing;
    };
    let mut on = (config.js_rules.iter()).filter(|it| it.severity != Severity::Off);
    let route = target.route();
    if route != Route::Native && config.language.wants_types {
        return Needs::Heavy;
    }
    let processor = config
        .processor_location
        .as_ref()
        .filter(|_| route == Route::Processor);
    if processor.is_some_and(|it| it.needs_the_configuration)
        || (route == Route::Eslint && config.for_eslint.is_none())
        || on
            .clone()
            .any(|it| it.configured.rule.needs_the_configuration)
    {
        Needs::Configuration.or_heavy(target)
    } else if on.next().is_some() || route != Route::Native {
        Needs::Engine.or_heavy(target)
    } else {
        Needs::Nothing
    }
}

impl Needs {
    fn or_heavy(self, target: &Target) -> Needs {
        match target.size >= HEAVY as u64 {
            true => Needs::Heavy,
            false => self,
        }
    }
}

impl Pool {
    pub(crate) fn new(threads: usize) -> Pool {
        Pool {
            caches: Default::default(),
            threads: match threads {
                0 => usize::from(bun_core::get_thread_count()),
                threads => threads,
            },
        }
    }

    pub(crate) fn threads(&self) -> usize {
        self.threads
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
    /// Whether it stands in for oxlint, once that is known.
    is_for_oxlint: Option<bool>,
}

/// What there is to say about the file of suppressions.
#[derive(Default)]
struct Suppressed {
    /// It has what does not occur.
    has_unused: bool,
    /// There are errors of rules that it does not have. Only oxlint says so.
    has_new: bool,
    /// It was written. `Some(true)`: it was there before.
    updated: Option<bool>,
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
        format::summary::write_error(&mut self.out.stderr, self.environment.stderr.colors, text);
    }

    fn warn(&mut self, text: &[u8]) {
        pretty!(
            &mut self.out.stderr,
            self.environment.stderr.colors,
            "<yellow>warn<r><d>:<r> {}\n",
            BStr::new(text)
        );
    }

    /// Fails with the exit code that ESLint has for that, or oxlint, which says why on standard output.
    fn fail(mut self, text: &[u8]) -> Outcome {
        match self.is_for_oxlint() {
            true => {
                let colors = (self.options.color).unwrap_or(self.environment.stdout.colors);
                format::summary::write_error(&mut self.out.stdout, colors, text);
                self.out.exit_code = 1;
            }
            false => {
                self.error(text);
                self.out.exit_code = 2;
            }
        }
        self.out
    }

    /// Refuses the command line, which both do on standard error.
    fn refuse(mut self, text: &[u8]) -> Outcome {
        self.error(text);
        self.out.exit_code = match self.is_for_oxlint() {
            true => 1,
            false => 2,
        };
        self.out
    }

    fn is_for_oxlint(&self) -> bool {
        self.is_for_oxlint
            .unwrap_or_else(|| configs::is_for_oxlint(self.options.flavor, &self.environment.cwd))
    }

    /// oxlint's `--init`, which however writes over a file that is there.
    fn write_initial_configuration(mut self) -> Outcome {
        let path = paths::join(&self.environment.cwd, b".oxlintrc.json");
        if fs::kind(&path).is_some() {
            return self.fail(&[&path[..], b" exists already."].concat());
        }
        if self.options.flavor != Some(Tool::Oxlint)
            && let Some(file) = configs::file_of_eslint(&self.environment.cwd)
        {
            return self.fail(
                &[
                    b"--init writes an .oxlintrc.json, which would count in place of ",
                    &file[..],
                    b". Use --flavor=oxlint to write it.",
                ]
                .concat(),
            );
        }
        if let Err(error) = fs::write_new(&path, INITIAL_OXLINTRC) {
            return self
                .fail(&[b"Cannot write ", &path[..], b": ", &fs::describe(&error)].concat());
        }
        self.out.stdout = b"Configuration file created\n".to_vec();
        self.out
    }

    /// `is_oxlint`: the configuration of the working directory is oxlint's.
    fn format(&self, is_oxlint: bool) -> Result<Format, Vec<u8>> {
        let name: &[u8] = match &self.options.format {
            Some(name) => &name[..],
            // An agent is saved from opening the files.
            None if self.environment.is_ai_agent => b"agent",
            None if is_oxlint && is_agent_for_oxlint() => b"agent",
            None if is_oxlint && self.environment.is_github_action => b"github",
            None if is_oxlint => b"default",
            None => b"stylish",
        };
        Format::by_name(name, is_oxlint).ok_or_else(|| {
            [
                b"There is no formatter \"",
                name,
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
        } else if let Some(project) = (options.project.as_ref())
            .map(|it| paths::resolve(&self.environment.cwd, &paths::from_native(it)))
            .filter(|it| fs::kind(it).is_none())
        {
            return Some(
                [
                    b"The tsconfig file \"",
                    &paths::to_native(project)[..],
                    b"\" does not exist, Please provide a valid tsconfig file.",
                ]
                .concat(),
            );
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
                .then(|| context.ignored(&path, &status, loaded.flavor));
            return Ok(Linted {
                results: results.into_iter().collect(),
                files: 0,
                listed: None,
            });
        };
        let route = loaded.routes(config, &path);
        // ESLint says itself what is wrong with a configuration for what it lints.
        if let Some(error) = config.error.as_ref().filter(|_| route != Route::Eslint) {
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
        if matches!(route, Route::Processor | Route::Eslint) {
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
        let has_rules_with_types = (config.rules.iter())
            .any(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
        let needs_types = name.is_some()
            && loader.wants_types(&loaded, config)
            && (has_rules_with_types || context.checks_types);
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
            Status::Matched(config) if target.route() != Route::Eslint => config.error.clone(),
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
            bun_lint::utils::sort::sort_by_key(&mut kinds, |it| std::cmp::Reverse(it.1));
            let kinds: Vec<Vec<u8>> = (kinds.iter())
                .map(|it| [format!("{} *", it.1).as_bytes(), it.0].concat())
                .collect();
            let first = unsupported.iter().take(3);
            let first: Vec<Vec<u8>> = first
                .map(|it| paths::relative(&self.environment.cwd, &it.path))
                .collect();
            let more: &[u8] = if unsupported.len() > 3 { b", .." } else { b"" };
            let is_for_eslint = |it: &Target| match &it.status {
                Status::Matched(config) => config.route_as_it_is(&it.path) == Route::Eslint,
                _ => false,
            };
            let hint: &[u8] = match unsupported.iter().any(is_for_eslint) {
                true => b". The package \"eslint\" lints other languages, if it is installed",
                false => b"",
            };
            loader.cannot_do(&[
                &count,
                noun,
                b" not linted, only JavaScript and TypeScript can be (",
                &kinds.join(&b", "[..]),
                b"): ",
                &first.join(&b", "[..]),
                more,
                hint,
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
            if target.route() != Route::Native || target.framework().is_some() {
                without_types.push(target);
                continue;
            }
            let mut needing = config
                .rules
                .iter()
                .filter(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
            if loader.wants_types(&target.loaded, config) {
                match needing.next().is_some() || context.checks_types {
                    true => with_types.push((
                        target,
                        Typed {
                            path: &target.path,
                            config,
                            text: None,
                        },
                    )),
                    false => without_types.push(target),
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
        // oxlint leaves them out too, and says nothing.
        if !rules_without_types.is_empty() && !is_oxlint {
            let count = format!("{}", rules_without_types.len()).into_bytes();
            let noun: &[u8] = if rules_without_types.len() == 1 {
                b" rule needs"
            } else {
                b" rules need"
            };
            loader.warn(&[&count, noun, b" types, which the configuration does not ask for, and did not run. Use --type-aware to run them."]);
        }
        let with_engine = (supported.iter()).filter(|it| needs(it) != Needs::Nothing);
        let most_engines = (pool.threads())
            .min(MOST_ENGINES)
            .min(context.js_plugins.most_realms());
        let shared = with_engine.clone().filter(|it| needs(it) != Needs::Heavy);
        let size: u64 = shared.map(|it| it.size).sum();
        (context.js_plugins).expect(with_engine.count(), size, most_engines);
        if !with_types.is_empty() {
            let (targets, files): (Vec<&Target>, Vec<Typed>) = with_types.into_iter().unzip();
            let linted = typed::lint(context, self.environment, &files, &on_circular_fixes);
            for (target, result) in targets.into_iter().zip(linted) {
                match result {
                    Some(result) => results.push(result),
                    None => without_types.push(target),
                }
            }
            results.append(&mut context.invalid_tsconfigs.lock().results);
        }
        phases.checking = started.elapsed().as_secs_f64();

        let started = Instant::now();
        // What takes longest first, so that no thread begins it when the others are nearly done: what needs JavaScript, then
        // the largest.
        bun_lint::utils::sort::sort_by_cached_key(&mut without_types, |target| {
            std::cmp::Reverse((needs(target), target.size))
        });
        let count = |least: Needs| without_types.partition_point(|target| needs(target) >= least);
        let (with_engine, plain) = without_types.split_at(count(Needs::Engine));
        let (heavy, with_engine) = with_engine.split_at(count(Needs::Heavy));
        let (taken, first, last) = (
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
        );
        let next_plain = AtomicUsize::new(0);
        let (mut results, mut failure) = (Guarded::new(results), Guarded::new(None));
        let lint = |target: &Target| match context.lint_file(target, &on_circular_fixes) {
            Ok(Some(result)) => results.lock().push(result),
            Ok(None) => {}
            Err(error) => {
                failure.lock().get_or_insert(error);
            }
        };
        pool.for_each(pool.threads(), 1, &|worker| {
            // An engine keeps the memory that its largest file took, and a thread the engine that it had. So few threads begin
            // with the largest, and the others with the smallest, until they meet.
            let lint_with_engine = || {
                while taken.fetch_add(1, Ordering::Relaxed) < with_engine.len() {
                    let at = match worker % 4 {
                        0 => Some(first.fetch_add(1, Ordering::Relaxed)),
                        _ => (with_engine.len() - 1)
                            .checked_sub(last.fetch_add(1, Ordering::Relaxed)),
                    };
                    if let Some(target) = at.and_then(|at| with_engine.get(at)) {
                        lint(target);
                    }
                }
            };
            if worker == 0 && !heavy.is_empty() {
                let mut lint_all = || heavy.iter().for_each(|target| lint(target));
                if context.js_plugins.keep_a_realm(&mut lint_all).is_err() {
                    lint_all();
                }
            }
            // A thread can have to wait for an engine, so every other one begins with what needs none.
            if worker % 2 == 0 {
                lint_with_engine();
            }
            while let Some(target) = plain.get(next_plain.fetch_add(1, Ordering::Relaxed)) {
                lint(target);
            }
            lint_with_engine();
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
            return self.refuse(&refusal);
        }
        if options.init {
            return self.write_initial_configuration();
        }
        let linter = Linter::new(Registry::new(&[
            bun_lint_eslint::RULES,
            bun_lint_typescript::RULES,
            bun_lint_plugins::RULES,
            bun_lint_unicorn::RULES,
            bun_lint_react::RULES,
            bun_lint_jest::RULES,
        ]));
        bun_sema_driver::use_a_pool_of_their_own("Bun Lint");
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
        if let Some((of_eslint, of_oxlint)) = loader.undecided() {
            self.error(
                &[
                    b"Both ",
                    &of_eslint[..],
                    b" and ",
                    &of_oxlint[..],
                    b" are here. Say which one this run is for: --flavor=oxlint or --flavor=eslint.",
                ]
                .concat(),
            );
            self.out.exit_code = 2;
            return self.out;
        }
        // One that cannot be read is reported when a file is linted with it.
        let of_cwd = loader.for_directory(&environment.cwd).ok();
        let is_oxlint = of_cwd
            .as_ref()
            .is_some_and(|it| it.flavor == Flavor::Oxlint);
        self.is_for_oxlint = Some(is_oxlint || of_cwd.is_none() && loader.is_for_oxlint());
        let format = match self.format(is_oxlint) {
            Ok(format) => format,
            Err(error) => return self.refuse(&error),
        };
        let checks_types = options.type_check || of_cwd.as_ref().is_some_and(|it| it.checks_types);
        let of_file = of_cwd.as_ref().and_then(|it| it.wants_types);
        if checks_types && options.type_aware.or(of_file) != Some(true) {
            return self.fail(
                b"The `--type-check` option requires type-aware linting.\nUse `--type-aware --type-check` or enable `options.typeAware` in your config.",
            );
        }
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
        let (skipped_in_comments, out_of_stack) =
            (Guarded::new(Vec::new()), Guarded::new(Vec::new()));
        let broken_fixes = Guarded::new(Vec::new());
        let invalid_tsconfigs = Guarded::new(Default::default());
        let context = Context {
            skipped_in_comments: &skipped_in_comments,
            out_of_stack: &out_of_stack,
            broken_fixes: &broken_fixes,
            invalid_tsconfigs: &invalid_tsconfigs,
            memory: &memory,
            atoms: &atoms,
            linter: &linter,
            options,
            cwd: &environment.cwd,
            of_oxlint: (of_cwd.as_deref()).filter(|it| it.flavor == Flavor::Oxlint),
            checks_types,
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
                Ok(loaded) if loaded.flavor == Flavor::Oxlint => {
                    let printed = loaded.config.printed_for_oxlint();
                    crate::print_config::write_indented(&mut self.out.stdout, &printed, 0);
                    self.out.stdout.push(b'\n');
                    return self.out;
                }
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
        let mut broken = std::mem::take(&mut *broken_fixes.lock());
        bun_lint::utils::sort::sort_by(&mut broken, |a, b| a.0.cmp(&b.0));
        for (path, rules) in &broken {
            let rules: Vec<Vec<u8>> = rules.iter().map(RuleId::to_vec).collect();
            let of: &[u8] = if rules.is_empty() { b"" } else { b" of " };
            self.warn(
                &[
                    b"Fixes",
                    of,
                    &rules.join(&b", "[..])[..],
                    b" would leave ",
                    &paths::relative(&environment.cwd, &paths::from_native(path))[..],
                    b" with a syntax error. They are not applied.",
                ]
                .concat(),
            );
        }
        let mut incomplete: Vec<Vec<u8>> = std::mem::take(&mut *out_of_stack.lock());
        if !incomplete.is_empty() {
            bun_lint::utils::sort::sort_by(&mut incomplete, |a, b| a.cmp(b));
            incomplete.dedup();
            let shown: Vec<Vec<u8>> = (incomplete.iter().take(3))
                .map(|it| paths::relative(&environment.cwd, &paths::from_native(it)))
                .collect();
            let more: &[u8] = if incomplete.len() > 3 { b", .." } else { b"" };
            self.warn(
                &[
                    b"The type checker ran out of stack in ",
                    &shown.join(&b", "[..])[..],
                    more,
                    b". This is a bug in Bun: the rules that need types may have missed problems there.",
                ]
                .concat(),
            );
        }
        let mut in_comments = std::mem::take(&mut *skipped_in_comments.lock());
        if !in_comments.is_empty() {
            bun_lint::utils::sort::sort_by(&mut in_comments, |a, b| a.cmp(b));
            let noun: &[u8] = match in_comments.len() {
                1 => b" rule that a comment turns on",
                _ => b" rules that comments turn on",
            };
            loader.cannot_do(&[
                in_comments.len().to_string().as_bytes(),
                noun,
                b" did not run, the configuration has to turn on a rule of the plugin: ",
                &in_comments.join(&b", "[..]),
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
            Err(Fatal(error)) => return self.fail(&error),
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
                let text = result.written().unwrap_or_default();
                if let Err(why) = fs::write_atomically(&environment.cwd, &result.path, text) {
                    failure
                        .lock()
                        .get_or_insert([b"Cannot write ", &result.path[..], b": ", &why].concat());
                }
            });
            if let Some(error) = failure.get_mut().take() {
                return self.fail(&error);
            }
            fixed = changed.len();
        }

        let suppressed = match options.stdin {
            true => Suppressed::default(),
            false => match self.apply_suppressions(&mut results, is_oxlint) {
                Ok(suppressed) => suppressed,
                Err(Fatal(error)) => return self.fail(&error),
            },
        };
        let has_unused = suppressed.has_unused && !options.pass_on_unpruned_suppressions;
        // oxlint reports it like problems, after those of all files.
        let about_suppressions = match is_oxlint {
            true => format::summary::about_suppressions(has_unused, suppressed.has_new),
            false => None,
        };

        let mut counts = Counts::default();
        (results.iter().chain(&about_suppressions)).for_each(|it| counts.add(it.counts));
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
            true => bun_lint::utils::sort::sort_by(&mut results, |a, b| a.path.cmp(&b.path)),
            false => {
                bun_lint::utils::sort::sort_by(&mut results, |a, b| compare_paths(&a.path, &b.path))
            }
        }
        results.extend(about_suppressions);
        // oxlint's formats print what they print when there is no problem.
        if is_oxlint && options.silent {
            results.clear();
        }
        let has_no_files =
            is_oxlint && files == 0 && !options.stdin && !options.pass_on_no_patterns;

        let started = Instant::now();
        let meta = format::Meta {
            cwd: &environment.cwd,
            color: options.color.unwrap_or(environment.stdout.colors),
            color_option: options.color,
            max_warnings_exceeded: has_too_many_warnings.then_some((max_warnings, counts.warnings)),
            shows_all: options.all,
            github_annotations: environment.is_github_action && !is_oxlint,
            found: counts,
            fixed,
            updated_suppressions: suppressed.updated,
            run: format::oxlint::Run {
                files,
                rules: of_cwd
                    .as_ref()
                    .filter(|_| is_oxlint && !loader.has_nested_configurations())
                    .map(|it| {
                        let with_types = options.type_aware.or(of_file) == Some(true);
                        it.config
                            .number_of_rules_of_oxlint(linter.registry(), with_types)
                    }),
                threads: pool.threads(),
                seconds: self.began.elapsed().as_secs_f64(),
            },
            pool: &pool,
            version: environment.version,
        };
        let output = if has_no_files {
            format::summary::without_files(format, &meta, options.error_on_unmatched_pattern)
        } else if options.silent && !is_oxlint {
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
            if !format.is_of_oxlint() {
                self.out.stdout.push(b'\n');
            }
        }

        if !is_oxlint && counts.errors == 0 && has_too_many_warnings {
            self.error(&format::summary::too_many_warnings(max_warnings));
        }
        if !is_oxlint && !options.stdin && !options.silent {
            format::summary::write(
                &mut self.out.stderr,
                environment.stderr.colors,
                counts,
                files,
                fixed,
                self.began.elapsed().as_secs_f64() * 1000.0,
            );
        }
        if options.timing {
            self.write_timing(&timing, &phases, &pool, &js_plugins.loading());
        }
        if has_unused && !is_oxlint {
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
        } else if is_oxlint && options.suppress_all && !has_no_files {
            // To have written the file is a success for oxlint, whatever is left.
            0
        } else {
            u8::from(
                counts.errors > 0
                    || has_too_many_warnings
                    || (denies_warnings && counts.warnings > 0)
                    || (has_no_files && options.error_on_unmatched_pattern),
            )
        };
        self.out
    }

    /// What ESLint's `cli.execute` does about `eslint-suppressions.json`.
    fn apply_suppressions(
        &self,
        results: &mut [FileResult],
        is_oxlint: bool,
    ) -> Result<Suppressed, Fatal> {
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
            return Ok(Suppressed::default());
        }
        let updated = (writes || (options.prune_suppressions && exists)).then_some(exists);
        let mut suppressed = Suppressions::load(&path)?;
        if writes {
            suppressed.suppress(results, cwd, options.suppress_rule.as_deref(), is_oxlint);
            suppressed.save(&path)?;
        }
        let unused = suppressed.apply(results, cwd, is_oxlint);
        if options.prune_suppressions {
            suppressed.prune(&unused, cwd);
            suppressed.save(&path)?;
            return Ok(Suppressed {
                updated,
                ..Suppressed::default()
            });
        }
        let is_new = |it: &LintMessage| {
            it.severity == Severity::Error && suppressions::rule_of(it, true).is_some()
        };
        Ok(Suppressed {
            has_unused: !unused.is_empty(),
            has_new: is_oxlint
                && !writes
                && (results.iter()).any(|it| it.messages.iter().any(is_new)),
            updated,
        })
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
        if loading.linted_by_eslint > 0 {
            let _ = write!(
                self.out.stderr,
                "; the package eslint has linted {} texts",
                loading.linted_by_eslint
            );
        }
        if let (largest @ 1.., freed) = loading.sizes {
            let largest = largest as f64 / 1e6;
            let _ = write!(self.out.stderr, "; the largest took {largest:.0} MB");
            if freed > 0 {
                let _ = write!(self.out.stderr, ", freed to stay in the memory: {freed}");
            }
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
        &paths::to_native(path.to_vec()),
        b". It is likely that you have conflicting rules in your configuration.",
    ]);
}

/// Does what `bun lint` does. `options.help` and `options.cwd` are for the caller to see to.
/// What there is to say about a command line that cannot be read, which is `message`.
pub fn refuse_command_line(message: &[u8], environment: &Environment) -> Outcome {
    let run = Run {
        options: &Options::default(),
        environment,
        out: Outcome::default(),
        began: Instant::now(),
        is_for_oxlint: None,
    };
    let mut out = run.refuse(message);
    pretty!(
        &mut out.stderr,
        environment.stderr.colors,
        "<blue>note<r><d>:<r> run 'bun lint --help' for more information\n",
    );
    out
}

pub fn run(options: &Options, environment: &Environment) -> Outcome {
    let run = Run {
        options,
        environment,
        out: Outcome::default(),
        began: Instant::now(),
        is_for_oxlint: None,
    };
    run.execute()
}
