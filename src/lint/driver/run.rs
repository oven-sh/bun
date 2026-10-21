//! `bun lint`: ESLint's `cli.execute`.

use crate::cli::Options;
use crate::configs::{self, Flavor, Loaded, Loader};
use crate::discover::{self, Status, Target};
use crate::doctor::{self, Modules};
use crate::format::{self, Format};
use crate::inferred::Inferred;
use crate::lint::{Context, elapsed};
use crate::results::{Counts, FileResult};
use crate::suppressions::{self, Suppressions};
use crate::typed::{self, Typed};
use crate::{Linter, explain, fs, git, paths};
use bstr::BStr;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::formats::Reason;
use bun_lint::js_plugin::{Engine, HEAVY, Host, Loading, Route, Work};
use bun_lint::language::Parser;
use bun_lint::linter::{
    FileConfig, LintMessage, Registry, ResolvedConfig, RuleId, formatting_rule, is_parse_error,
};
use bun_sema::resolve::ScriptKind;
use bun_sema::util::FxHashSet;
use bun_threading::Guarded;
use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// The ESLint version whose behavior this matches.
const ESLINT_VERSION: &str = "10.12.0";

/// Standard output or standard error.
#[derive(Copy, Clone, Default)]
pub struct Stream {
    pub is_tty: bool,
    pub colors: bool,
}

/// A program's source text, in parts.
pub(crate) type Source = &'static [crate::evaluate::Part];

/// A program for the running executable to run: `head`, then `source`.
pub struct Script<'s> {
    /// The program's input, as a declaration.
    pub head: &'s [u8],
    pub source: Source,
    /// The working directory.
    pub cwd: &'s [u8],
}

impl Script<'_> {
    /// Environment variables that control a `bun` process and aren't meant for the one that runs the program. It
    /// inherits all the others. ESLint and Prettier run a config file in their own process, so it sees the environment
    /// they were started with.
    pub const NOT_INHERITED: [&'static [u8]; 7] = [
        // This process already applied these flags. `--cwd=sub` would be applied a second time, inside `sub`.
        b"BUN_OPTIONS",
        // These start a debugger in every such process, which can wait for its client forever. Editors set them for
        // everything their terminals start.
        b"BUN_INSPECT",
        b"BUN_INSPECT_CONNECT_TO",
        b"BUN_INSPECT_NOTIFY",
        b"BUN_INSPECT_PRELOAD",
        // The IPC channel to this process's parent. The descriptor isn't passed on.
        b"NODE_CHANNEL_FD",
        b"NODE_CHANNEL_SERIALIZATION_MODE",
    ];
}

/// Everything `bun lint` needs from the process it runs in.
pub struct Environment<'e> {
    /// The working directory: absolute, and converted by [`from_native_path`](crate::from_native_path).
    pub cwd: Vec<u8>,
    pub stdout: Stream,
    pub stderr: Stream,
    /// Width of stdout's terminal, in columns.
    pub columns: fn() -> u16,
    /// `Output::is_ai_agent()`
    pub is_ai_agent: bool,
    /// `Output::is_github_action()`
    pub is_github_action: bool,
    /// TypeScript's `lib.*.d.ts`, for the rules that need types.
    pub libs: bun_sema_driver::Libs<'e>,
    /// Runs a script to completion. `Ok` is what it printed to standard output. `Err` is why it failed.
    pub run_script: &'e (dyn Fn(&Script) -> Result<Vec<u8>, Vec<u8>> + Sync),
    /// Runs git and waits for it to exit.
    pub run_git: &'e (dyn Fn(&git::Command) -> Result<git::Finished, git::NotRun> + Sync),
    /// The command line of this process, without the executable.
    pub command_line: &'e [&'e [u8]],
    /// Runs the JavaScript rules.
    pub js_engine: &'e dyn Engine,
    /// Bun's version.
    pub version: &'e [u8],
    /// The memory of the machine, or of the container the process is in, in bytes. 0 if unknown, in which case a run
    /// with types checks its programs one after the other.
    pub memory: usize,
}

/// The output to print and the exit code: 0, 1 if there are problems in the code, 2 if linting failed.
#[derive(Default)]
pub struct Outcome {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: u8,
}

/// Environment variables that tell oxlint an agent is running it. Any non-empty value counts.
const OXLINT_AGENT_VARIABLES: [&[u8]; 12] = [
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

/// True if oxlint would default to its `agent` format. If `AGENT` is set, only it decides, like everywhere in Bun.
fn is_agent_for_oxlint() -> bool {
    let get = |name: &[u8]| bun_core::getenv_z(&bun_core::ZBox::from_bytes(name));
    let has = |name: &[u8], part: &[u8]| get(name).is_some_and(|it| strings::contains(it, part));
    let is_set = |&name: &&[u8]| get(name).is_some_and(|it| !it.is_empty());
    get(b"AGENT").is_none()
        && (OXLINT_AGENT_VARIABLES.iter().any(is_set)
            || has(b"PATH", b".pi/agent")
            || has(b"PATH", b".pi\\agent")
            || has(b"EDITOR", b"devin")
            || has(b"TERM_PROGRAM", b"kiro"))
}

/// Error text for `error`, an invalid config found while resolving a file that uses `loaded`. With an oxlint config the
/// message goes to stdout and has to match oxlint's, so it isn't changed.
fn invalid_config(loader: &Loader, loaded: &Loaded, error: &[u8]) -> Vec<u8> {
    match loaded.flavor {
        Flavor::Eslint | Flavor::EslintRc => {
            loader.prefix_with_source(loaded.file.as_deref(), error)
        }
        Flavor::Oxlint | Flavor::BuiltIn => error.to_vec(),
    }
}

/// The message for an error that stops the whole run. ESLint throws and exits with 2.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct Fatal(pub(crate) Vec<u8>);

pub(crate) struct Pool {
    caches: bun_sema_driver::ThreadCaches,
    threads: usize,
}

/// The resources that linting a file needs beyond the native code.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Needs {
    Nothing,
    /// A rule or a processor in JavaScript.
    Engine,
    /// A rule or processor for which the engine has to run the config file and everything it imports.
    Configuration,
    /// Something that makes an engine's memory grow: a file of at least [`HEAVY`] bytes, or ESLint's own `Linter` with
    /// a parser that builds a TypeScript program, which takes gigabytes.
    Heavy,
}

/// The files that are linted without types, as a work queue for the threads that have a VM.
struct Files<'f> {
    heavy: &'f [&'f Target],
    /// Files that need a VM, largest first.
    with_engine: &'f [&'f Target],
    plain: &'f [&'f Target],
    next_heavy: AtomicUsize,
    /// `handed_out` counts the `with_engine` files handed out so far. `ends` counts how many of them came from the
    /// start and how many from the end.
    handed_out: AtomicUsize,
    ends: [AtomicUsize; 2],
    next_plain: AtomicUsize,
    lint: &'f (dyn Fn(&Target) + Sync),
}

impl Files<'_> {
    fn lint_plain(&self) -> bool {
        let next = (self.plain).get(self.next_plain.fetch_add(1, Ordering::Relaxed));
        next.map(|target| (self.lint)(target)).is_some()
    }
}

impl Work for Files<'_> {
    fn has_heavy(&self) -> bool {
        self.next_heavy.load(Ordering::Relaxed) < self.heavy.len()
    }

    fn heavy(&self) -> bool {
        let next = (self.heavy).get(self.next_heavy.fetch_add(1, Ordering::Relaxed));
        next.map(|target| (self.lint)(target)).is_some()
    }

    fn light(&self, realm: usize) -> bool {
        if self.handed_out.fetch_add(1, Ordering::Relaxed) >= self.with_engine.len() {
            return self.lint_plain();
        }
        // A VM never gives back the memory its largest file needed. So a few VMs work down from the largest files and the
        // rest work up from the smallest, until they meet.
        let [first, last] = &self.ends;
        let at = match realm % 4 {
            0 => Some(first.fetch_add(1, Ordering::Relaxed)),
            _ => (self.with_engine.len() - 1).checked_sub(last.fetch_add(1, Ordering::Relaxed)),
        };
        if let Some(target) = at.and_then(|at| self.with_engine.get(at)) {
            (self.lint)(target);
        }
        true
    }

    fn needs_realms(&self) -> bool {
        self.handed_out.load(Ordering::Relaxed) < self.with_engine.len()
    }
}

fn needs(target: &Target) -> Needs {
    let Status::Matched(config) = &target.status else {
        return Needs::Nothing;
    };
    let mut on = (config.js_rules.iter()).filter(|it| it.severity != Severity::Off);
    let route = target.route();
    if route == Route::Language {
        return Needs::Nothing;
    }
    if route != Route::Native && config.language.wants_types {
        return Needs::Heavy;
    }
    let processor = config
        .processor_location
        .as_ref()
        .filter(|_| route == Route::Processor);
    if processor.is_some_and(|it| it.needs_config_file)
        || (route == Route::Eslint && config.for_eslint.is_none())
        || on.clone().any(|it| it.configured.rule.needs_config_file)
    {
        Needs::Configuration.or_heavy(target)
    } else if on.next().is_some() || route != Route::Native {
        Needs::Engine.or_heavy(target)
    } else {
        Needs::Nothing
    }
}

/// True if a rule that's on for the file can hand the file back to its package's JavaScript version.
fn may_be_handed_back(target: &Target) -> bool {
    matches!(&target.status, Status::Matched(config) if config.may_hand_back())
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
    /// The maximum size of Bun's pool (`get_thread_count`). Per-thread state is allocated for every requested thread,
    /// and a `bunfig.toml` can request any number.
    const MAX_THREADS: usize = 1024;

    pub(crate) fn new(threads: usize) -> Pool {
        Pool {
            caches: Default::default(),
            threads: match threads {
                0 => usize::from(bun_core::get_thread_count()),
                threads => threads.min(Pool::MAX_THREADS),
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

/// `--timing`: total time spent in each phase, summed over all threads, in nanoseconds.
#[derive(Default)]
pub(crate) struct Timing {
    is_on: bool,
    pub(crate) read: AtomicU64,
    pub(crate) parse: AtomicU64,
    pub(crate) rules: AtomicU64,
    /// Files in which `File::mentions` returns true for every name, so no rule that looks for a name can be skipped.
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

    /// Adds the time since `started` to `to`. Returns the current time.
    pub(crate) fn add(&self, to: &AtomicU64, started: Option<Instant>) -> Option<Instant> {
        started?;
        to.fetch_add(elapsed(started), Ordering::Relaxed);
        self.now()
    }
}

/// True if comparing `path` by bytes gives the same order as `a.filePath < b.filePath` in JavaScript
/// ([`strings::order_utf16`]).
fn is_ordered_by_bytes(path: &[u8]) -> bool {
    path.iter().all(|&byte| byte < 0xEE)
}

struct Run<'r> {
    options: &'r Options,
    environment: &'r Environment<'r>,
    out: Outcome,
    began: Instant,
    /// True if the run emulates oxlint. `None` until that's known.
    emulates_oxlint: Option<bool>,
    /// `--doctor`
    modules: Option<&'r Modules>,
}

/// Facts to report about the suppressions file.
#[derive(Default)]
struct Suppressed {
    /// It has unused suppressions.
    has_unused: bool,
    /// There are errors from rules it doesn't list. Only oxlint reports that.
    has_new: bool,
    /// Set if this run saved it. `Some(true)` if it already existed.
    updated: Option<bool>,
}

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

    /// Fails with ESLint's exit code, or with oxlint's, which prints the reason to standard output.
    fn fail(mut self, text: &[u8]) -> Outcome {
        self.failed(text);
        self.out
    }

    /// Prints the error and sets the exit code.
    fn failed(&mut self, text: &[u8]) {
        match self.emulates_oxlint() {
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
    }

    /// Prints a note that ESLint and oxlint both have a config for the same files, and which one is used.
    fn note_ignored_config(&mut self, eslint_path: &[u8], oxlint_path: &[u8]) {
        pretty!(
            &mut self.out.stderr,
            self.environment.stderr.colors,
            "<blue>note<r><d>:<r> Using {}. {} is ignored. Use --config to pick it.\n",
            BStr::new(oxlint_path),
            BStr::new(eslint_path)
        );
    }

    /// Rejects the command line. Both tools print that to standard error.
    fn reject(mut self, text: &[u8]) -> Outcome {
        self.error(text);
        self.out.exit_code = match self.emulates_oxlint() {
            true => 1,
            false => 2,
        };
        self.out
    }

    /// Rejects flags of a tool this run isn't emulating.
    fn reject_flag(mut self, text: &[u8]) -> Outcome {
        self.error(text);
        self.out.exit_code = 2;
        self.out
    }

    fn emulates_oxlint(&self) -> bool {
        self.emulates_oxlint
            .unwrap_or_else(|| configs::emulates_oxlint(self.options.flavor, &self.environment.cwd))
    }

    /// `is_oxlint` means the working directory's config is oxlint's. `is_native` means it has no config.
    fn format(&self, is_oxlint: bool, is_native: bool) -> Result<Format, Vec<u8>> {
        let name: &[u8] = match &self.options.format {
            Some(name) => &name[..],
            // This format shows the code, so an agent doesn't have to open the files.
            None if self.environment.is_ai_agent => b"agent",
            None if is_oxlint && is_agent_for_oxlint() => b"agent",
            None if is_oxlint && self.environment.is_github_action => b"github",
            None if is_oxlint || is_native => b"default",
            None => b"stylish",
        };
        Format::by_name(name, is_oxlint).ok_or_else(|| Format::unknown_format_error(name))
    }

    /// Returns the error for an option combination that ESLint's `cli.execute` rejects.
    fn rejection(&self) -> Option<Vec<u8>> {
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
        } else if let Some(project) = (options.tsconfig.as_ref())
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
                .ignored_flags
                .iter()
                .find(|flag| **flag != b"cache")?;
            return Some([b"bun lint does not support --", *flag].concat());
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
        loader.name(paths::dirname(&path));
        let loaded = loader.for_directory(paths::dirname(&path))?;
        let status: Status = match loader.is_ignored_by_flags(&path, &loaded) {
            true => Status::Ignored,
            false => loader.config_of(&loaded, &path).into(),
        };
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
        // For files that ESLint lints, it reports an invalid config itself.
        if let Some(error) = config.error.as_ref().filter(|_| route != Route::Eslint) {
            return Err(Fatal(invalid_config(loader, &loaded, error)));
        }
        if route == Route::Unsupported && config.route_without_processor(&path) == Route::Eslint {
            context.needs_eslint.lock().push((path, loaded.flavor));
            return Ok(Linted {
                results: Vec::new(),
                files: 0,
                listed: None,
            });
        }
        let display_path = if path.ends_with(b"__placeholder__.js") {
            b"<text>".to_vec()
        } else {
            paths::to_native(path.clone())
        };
        let on_circular_fixes = |path: &[u8]| warn_about_circular_fixes(loader, path);
        if let Some(framework) = loaded.framework(&path) {
            let result = context.verify_text_by(
                display_path,
                &path,
                (text, false),
                config,
                &on_circular_fixes,
                &mut |text, _| context.verify_scripts(framework, &path, text, config),
            );
            return Ok(Linted {
                results: vec![result],
                files: 1,
                listed: None,
            });
        }
        // With another parser, whether the text can be parsed here is only known once it's read.
        if matches!(route, Route::Processor | Route::Language | Route::Eslint)
            || config.language.parser == Parser::Other
        {
            let result = context.verify_processed_text(
                &loaded,
                display_path,
                &path,
                text,
                config,
                &on_circular_fixes,
            );
            return Ok(Linted {
                files: usize::from(result.is_some()),
                results: result.into_iter().collect(),
                listed: None,
            });
        }
        let is_javascript =
            ScriptKind::from_file_name(&path).is_some_and(ScriptKind::is_javascript);
        let infers = name.is_some() && config.language.infers_globals.is_for(is_javascript);
        if let Some(inferred) = context.inferred.filter(|_| infers) {
            inferred.files(vec![path.clone()]);
        }
        let has_rules_with_types = config.has_enabled(|it| it.triggers_type_check());
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
            results: vec![context.verify_text(
                display_path,
                &path,
                text,
                config,
                &on_circular_fixes,
            )],
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
        // oxlint doesn't complain about an argument that matches nothing, as long as some file is found.
        let is_oxlint = loader
            .for_directory(&self.environment.cwd)
            .is_ok_and(|it| it.flavor == Flavor::Oxlint);
        let mut targets = discover::find_files(
            loader,
            pool,
            patterns,
            self.options.error_on_unmatched_pattern && !is_oxlint,
        )?;
        if let Some(only) = context.only {
            targets.retain(|it| only.has(&it.path));
            let mut gone = discover::find_files_not_on_disk(loader, patterns, only.not_on_disk())?;
            if !gone.is_empty() {
                targets.append(&mut gone);
                bun_lint::utils::sort::sort_by(&mut targets, |a, b| a.path.cmp(&b.path));
            }
        }
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
        // ESLint only notices when it gets to the file.
        let invalid = targets.iter().find_map(|target| match &target.status {
            Status::Matched(config) if target.route() != Route::Eslint => {
                let error = config.error.as_ref()?;
                Some(invalid_config(loader, &target.loaded, error))
            }
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
        let (for_eslint, with_processor): (Vec<Target>, Vec<Target>) = (unsupported.into_iter())
            .partition(|it| match &it.status {
                Status::Matched(config) => {
                    config.route_without_processor(&it.path) == Route::Eslint
                }
                _ => false,
            });
        let because: &[u8] = b"only an ESLint config can have a processor";
        let with_processor: Vec<Vec<u8>> = with_processor.into_iter().map(|it| it.path).collect();
        not_linted(
            loader,
            &self.environment.cwd,
            &with_processor,
            [because; 2],
            b"",
        );
        let for_eslint = for_eslint.into_iter().map(|it| (it.path, it.loaded.flavor));
        context.needs_eslint.lock().extend(for_eslint);
        let known_to_need_eslint = context.needs_eslint.lock().len();
        let on_circular_fixes = |path: &[u8]| warn_about_circular_fixes(loader, path);
        let mut results = Vec::with_capacity(supported.len());
        if let Some(inferred) = context.inferred {
            let files_inferring_globals = supported.iter().filter(|it| match &it.status {
                Status::Matched(config) => {
                    let kind = ScriptKind::from_file_name(&it.path);
                    (config.language.infers_globals)
                        .is_for(kind.is_some_and(ScriptKind::is_javascript))
                }
                _ => false,
            });
            inferred.searched(
                std::mem::take(&mut *loader.searched_from.lock()),
                std::mem::take(&mut *loader.tsconfigs.lock()),
            );
            inferred.files(files_inferring_globals.map(|it| it.path.clone()).collect());
        }

        // Files that need types go first. Any that turn out to be in no program are linted without types.
        let started = Instant::now();
        let mut without_types: Vec<&Target> = Vec::with_capacity(supported.len());
        let mut with_types: Vec<(&Target, Typed)> = Vec::new();
        let mut rules_without_types: Vec<&'static str> = Vec::new();
        // The configs whose rules are already in that list. Many files share a config.
        let (mut listed, mut last) = (FxHashSet::default(), None);
        for target in &supported {
            let Status::Matched(config) = &target.status else {
                without_types.push(target);
                continue;
            };
            if target.route() != Route::Native || target.framework().is_some() {
                without_types.push(target);
                continue;
            }
            let needing = config
                .configured()
                .filter(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
            if loader.wants_types(&target.loaded, config) {
                match config.has_enabled(|it| it.triggers_type_check()) || context.checks_types {
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
            without_types.push(target);
            let config = Arc::as_ptr(config);
            if last.replace(config) == Some(config) || !listed.insert(config) {
                continue;
            }
            for rule in needing.map(|it| it.entry.meta.name) {
                if !rules_without_types.contains(&rule) {
                    rules_without_types.push(rule);
                }
            }
        }
        // oxlint silently skips these too.
        if !rules_without_types.is_empty() && !is_oxlint {
            let count = format!("{}", rules_without_types.len()).into_bytes();
            let (rules, them): (&[u8], &[u8]) = match rules_without_types.len() {
                1 => (b" rule that needs type information\n  ", b" to run it."),
                _ => (b" rules that need type information\n  ", b" to run them."),
            };
            let remedy: &[u8] = match self.options.type_aware {
                Some(false) => b"Remove typeAware = false or --no-type-aware",
                _ => b"Use --type-aware",
            };
            loader.warn(&[b"Skipped ", &count, rules, remedy, them]);
        }
        let with_engine = (supported.iter()).filter(|it| needs(it) != Needs::Nothing);
        let shared = with_engine.clone().filter(|it| needs(it) != Needs::Heavy);
        let size: u64 = shared.map(|it| it.size).sum();
        // Files that a rule may hand back to its package's JavaScript version.
        let may_need_realm =
            (supported.iter()).filter(|it| may_be_handed_back(it) && it.size < HEAVY as u64);
        let count = with_engine.count() + may_need_realm.clone().count();
        (context.js_plugins).expect(count, size, pool.threads());
        (context.js_plugins).may_need_realm(may_need_realm.map(|it| it.size).sum());
        if !with_types.is_empty() {
            if !is_oxlint {
                loader.advise_about_typescript();
            }
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
        // Slowest first, so no thread starts a slow file when the others are nearly done: files that need JavaScript,
        // then the largest.
        bun_lint::utils::sort::sort_by_cached_key(&mut without_types, |target| {
            std::cmp::Reverse((needs(target), target.size))
        });
        let count = |least: Needs| without_types.partition_point(|target| needs(target) >= least);
        let (with_engine, plain) = without_types.split_at(count(Needs::Engine));
        let (heavy, with_engine) = with_engine.split_at(count(Needs::Heavy));
        let (mut results, mut failure) = (Guarded::new(results), Guarded::new(None));
        let lint = |target: &Target| match context.lint_file(target, &on_circular_fixes) {
            Ok(Some(result)) => results.lock().push(result),
            Ok(None) => {}
            Err(error) => {
                failure.lock().get_or_insert(error);
            }
        };
        let files = Files {
            heavy,
            with_engine,
            plain,
            next_heavy: AtomicUsize::new(0),
            handed_out: AtomicUsize::new(0),
            ends: Default::default(),
            next_plain: AtomicUsize::new(0),
            lint: &lint,
        };
        let mut lint_plain = || {
            pool.for_each(pool.threads(), 1, &|worker| {
                if worker + 1 == pool.threads()
                    && let Some(inferred) = context.inferred
                {
                    inferred.begin();
                }
                // A thread with a VM that's busy counts as one of `--threads`. It continues with these files once it's
                // free.
                while worker + context.js_plugins.busy() < pool.threads() && files.lint_plain() {}
            });
        };
        match heavy.is_empty() && with_engine.is_empty() {
            true => lint_plain(),
            // No VM could start. Lint them here anyway, so that each one fails with the reason.
            false
                if (context.js_plugins)
                    .work_off(&files, &mut lint_plain)
                    .is_err() =>
            {
                files.finish_here();
            }
            false => {}
        }
        phases.linting = started.elapsed().as_secs_f64();
        if let Some(error) = failure.get_mut().take() {
            return Err(error);
        }
        // A comment in a file can turn on a rule that needs `eslint`, which is only discovered when the file is read.
        let needs_eslint = context.needs_eslint.lock();
        let found_late = needs_eslint.get(known_to_need_eslint..).unwrap_or_default();
        let found_late: FxHashSet<&[u8]> = found_late.iter().map(|it| &it.0[..]).collect();
        let files = supported
            .iter()
            .filter(|it| {
                matches!(it.status, Status::Matched(_)) && !found_late.contains(&it.path[..])
            })
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
                "Environment Info:\n\nBun version: {}\nESLint version: {ESLINT_VERSION} (the version bun lint is compatible with)\nTypeScript version: {}",
                BStr::new(environment.version),
                BStr::new(bun_sema_driver::TYPESCRIPT_VERSION.to_bytes()),
            );
            return self.out;
        }
        if let Some(rejection) = self.rejection() {
            return self.reject(&rejection);
        }
        if let Some(only) = options.only.as_ref().filter(|_| options.stdin) {
            return self.reject_flag(&only.stdin_conflict_error("--stdin"));
        }
        let registry = Registry::new(&[
            bun_lint_eslint::RULES,
            bun_lint_typescript::RULES,
            bun_lint_plugins::RULES,
            bun_lint_unicorn::RULES,
            bun_lint_react::RULES,
            bun_lint_jest::RULES,
            bun_lint_json::RULES,
            bun_lint_markdown::RULES,
        ])
        .with_languages(crate::rules::LANGUAGES);
        if let Some(rule) = &options.explain {
            match explain::explain(&registry, rule, environment, options.color) {
                Ok(page) => self.out.stdout = page,
                Err(why) => {
                    self.error(&why);
                    self.out.exit_code = 2;
                }
            }
            return self.out;
        }
        let linter = Linter::new(registry.with_native_plugins(options.native_plugin_rules.clone()));
        bun_sema_driver::use_dedicated_pool("Bun Lint");
        let pool = Pool::new(options.threads);
        // Nothing starts unless a config has a JavaScript plugin.
        let js_plugins = Host::with_engine(
            environment.js_engine,
            &paths::to_native(environment.cwd.clone()),
        )
        .measuring(options.timing);
        let loader = Loader::new(&linter, options, environment, &js_plugins);
        // `--rules` prints the same list either way, and `--doctor` has this in its report.
        let prints_note = !options.rules && !options.doctor && !options.silent;
        if let Some((eslint_path, oxlint_path)) =
            loader.ignored_eslint_config().filter(|_| prints_note)
        {
            self.note_ignored_config(eslint_path, oxlint_path);
        }
        if options.init {
            return match loader.for_directory(&environment.cwd) {
                Ok(found) => crate::init::LINT.add(
                    found.file.as_deref(),
                    options.bunfig_above(),
                    environment,
                ),
                Err(Fatal(error)) => self.fail(&error),
            };
        }
        // An unreadable config is reported when a file is linted with it.
        let cwd_config = loader.for_directory(&environment.cwd).ok();
        let is_oxlint = cwd_config
            .as_ref()
            .is_some_and(|it| it.flavor == Flavor::Oxlint);
        self.emulates_oxlint = Some(is_oxlint || cwd_config.is_none() && loader.emulates_oxlint());
        if let Some(rejection) = loader.refused() {
            return self.reject_flag(rejection);
        }
        // Recorded as the loader's mistake, which is printed next.
        let _ = cwd_config.as_ref().map(|it| loader.check_wildcards(it));
        if let Some(mistake) = loader.mistake() {
            self.out.stderr.extend_from_slice(mistake);
            self.out.exit_code = 2;
            return self.out;
        }
        let is_native = (cwd_config.as_ref()).is_some_and(|it| it.flavor == Flavor::BuiltIn);
        let store = bun_lint_graph::Store::new(&environment.cwd);
        let store = if is_native {
            store.with_nearest_tsconfig()
        } else {
            store
        };
        let store = match &options.tsconfig {
            Some(path) => store.with_tsconfig(path),
            None => store,
        };
        let modules = bun_lint_graph::Graph::new(&store);
        modules.list_files_by(Box::new(|patterns: &[&[u8]], extensions: &[&[u8]]| {
            let run_state = (&linter, environment, &js_plugins);
            discover::list_as_eslint_8(run_state, &pool, patterns, extensions)
        }));
        let format = match self.format(is_oxlint, is_native) {
            Ok(format) => format,
            Err(error) => return self.reject(&error),
        };
        let checks_types =
            options.type_check || cwd_config.as_ref().is_some_and(|it| it.checks_types);
        let config_wants_types = cwd_config.as_ref().and_then(|it| it.wants_types);
        if checks_types && options.type_aware.or(config_wants_types) != Some(true) {
            return self.fail(
                b"The `--type-check` option requires type-aware linting.\nUse `--type-aware --type-check` or enable `options.typeAware` in your config.",
            );
        }
        if options.rules {
            let (out, registry) = (&mut self.out.stdout, linter.registry());
            let colors = options.color.unwrap_or(environment.stdout.colors);
            match format {
                Format::Json | Format::OxlintJson => explain::write_rules_as_json(out, registry),
                _ if environment.stdout.is_tty => {
                    explain::write_rules_by_plugin(out, registry, colors)
                }
                _ => explain::write_rules(out, registry),
            }
            return self.out;
        }
        if let Some(loaded) = self.modules {
            let how = doctor::How {
                as_json: matches!(format, Format::Json | Format::OxlintJson),
                colors: options.color.unwrap_or(environment.stdout.colors),
            };
            return match doctor::lint((&loader, options), &pool, &js_plugins, loaded, how) {
                Ok(report) => {
                    self.out.stdout = report;
                    self.out
                }
                Err(Fatal(error)) => self.fail(&error),
            };
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
        let without_include = Guarded::new(Vec::new());
        let broken_fixes = Guarded::new(Vec::new());
        let handed_back = Guarded::new(Vec::new());
        let (unread, needs_eslint) = (Guarded::new(Vec::new()), Guarded::new(Vec::new()));
        let formatter =
            crate::fmt::ForRules::new(environment, options.bun_format_defaults.as_deref());
        let only = (options.only.as_ref()).map(|it| git::Files::read(it, environment, true));
        let only = match only.transpose() {
            Ok(only) => only,
            Err(Fatal(error)) => return self.reject_flag(&error),
        };
        if let Some(only) = &only {
            store.provide(only.already_read(false));
        }
        // Opt-in, because loading the libraries and types takes longer than linting a small project. A file that's
        // linted with types has them anyway. See `typed::FileGlobals`.
        let by_options = options.infer_globals.is_none() && options.infers_globals_by_options;
        let inferred = (options.infer_globals == Some(true) || by_options)
            .then(|| Inferred::new(environment, pool.threads(), by_options));
        let invalid_tsconfigs = Guarded::new(Default::default());
        let context = Context {
            skipped_in_comments: &skipped_in_comments,
            out_of_stack: &out_of_stack,
            without_include: &without_include,
            broken_fixes: &broken_fixes,
            handed_back: &handed_back,
            unread: &unread,
            needs_eslint: &needs_eslint,
            invalid_tsconfigs: &invalid_tsconfigs,
            memory: &memory,
            atoms: &atoms,
            linter: &linter,
            options,
            cwd: &environment.cwd,
            only: only.as_ref(),
            oxlint_config: (cwd_config.as_deref()).filter(|it| it.flavor == Flavor::Oxlint),
            checks_types,
            keeps_text: format.reads_text() && !options.silent,
            reads_fixes: format.reads_fixes() && !options.silent,
            reads_fix_texts: format.reads_fix_texts() && !options.silent,
            reads_help: format.reads_help() && !options.silent,
            help_on_demand: format.groups() && !options.all,
            reads_suppressions: format.reads_suppressions() && !options.silent,
            js_plugins: &js_plugins,
            modules: &modules,
            formatter: &formatter,
            inferred: inferred.as_ref(),
            timing: &timing,
        };
        if let Some(file) = &options.print_config {
            let file_name: &[u8] = match file.is_empty() {
                true => b"__placeholder__.js",
                false => file,
            };
            let path = paths::resolve(&environment.cwd, &paths::from_native(file_name));
            loader.name(paths::dirname(&path));
            let config = match loader.for_directory(paths::dirname(&path)) {
                Ok(loaded) if loaded.flavor == Flavor::Oxlint => {
                    let printed = loaded.config.oxlint_print_config();
                    crate::print_config::write_indented(&mut self.out.stdout, &printed, 0);
                    self.out.stdout.push(b'\n');
                    return self.out;
                }
                Ok(loaded)
                    if file.is_empty()
                        && matches!(loaded.flavor, Flavor::Eslint | Flavor::EslintRc) =>
                {
                    let message = b"Value for 'print-config' of type 'path' required.";
                    return reject_command_line(message, environment);
                }
                Ok(loaded) => loader.config_of(&loaded, &path),
                Err(Fatal(error)) => return self.fail(&error),
            };
            self.out.stdout = crate::print_config::print(match &config {
                FileConfig::Matched(config) => Some(config),
                _ => None,
            });
            self.out.stdout.push(b'\n');
            // The printed config is the same whether a rule is built in or runs in JavaScript, so add a note.
            if let FileConfig::Matched(config) = &config {
                let on = (config.js_rules.iter()).filter(|it| it.severity != Severity::Off);
                let ids: Vec<&[u8]> = on.map(|it| &it.configured.rule.id[..]).collect();
                if !ids.is_empty() {
                    pretty!(
                        &mut self.out.stderr,
                        environment.stderr.colors,
                        "<blue>note<r><d>:<r> these rules run in JavaScript: {}. All other rules are built in.\n",
                        BStr::new(&ids.join(&b", "[..]))
                    );
                }
            }
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
        let warnings = std::mem::take(&mut *loader.warnings.lock());
        for warning in warnings.iter().filter(|_| !(is_native && options.silent)) {
            self.warn(warning);
        }
        let ignored_eslint_config = loader.ignored_eslint_configs_below();
        for (eslint_path, oxlint_path) in ignored_eslint_config.iter().filter(|_| !options.silent) {
            self.note_ignored_config(eslint_path, oxlint_path);
        }
        let without_types = js_plugins.rules_that_asked_for_types();
        if !without_types.is_empty() {
            let ids: Vec<&[u8]> = without_types.iter().map(|it| &it.id[..]).collect();
            let noun: &[u8] = match ids.len() {
                1 => b" rule",
                _ => b" rules",
            };
            loader.add_unsupported(&[
                ids.len().to_string().as_bytes(),
                noun,
                b" did not run because rules that run in JavaScript cannot use type information: ",
                &ids.join(&b", "[..]),
                match linter.registry().replaces_plugin(b"@typescript-eslint") {
                    true => &b""[..],
                    false => {
                        b"\n  Use --native-plugin-rules=@typescript-eslint to run the built-in versions."
                    }
                },
            ]);
        }
        for (reason, files) in std::mem::take(&mut *handed_back.lock()) {
            // This only happens where no formatter is wired up, and means nothing to the user.
            if reason != Reason::NoFormatter {
                let noun = if files == 1 { "file" } else { "files" };
                let text = reason.text();
                loader.advise(
                    format!(
                        "prettier/prettier ran in JavaScript for {files} {noun} because {text}"
                    )
                    .into_bytes(),
                );
            }
        }
        let mut broken = std::mem::take(&mut *broken_fixes.lock());
        bun_lint::utils::sort::sort_by(&mut broken, |a, b| a.0.cmp(&b.0));
        for (path, rules) in &broken {
            let rules: Vec<Vec<u8>> = rules.iter().map(RuleId::to_vec).collect();
            let of: &[u8] = if rules.is_empty() { b"" } else { b" from " };
            self.warn(
                &[
                    b"Fixes",
                    of,
                    &rules.join(&b", "[..])[..],
                    b" were not applied to ",
                    &paths::relative_escaped(&environment.cwd, &paths::from_native(path))[..],
                    b" because they would cause a syntax error",
                ]
                .concat(),
            );
        }
        let mut incomplete: Vec<Vec<u8>> = std::mem::take(&mut *out_of_stack.lock());
        if !incomplete.is_empty() {
            bun_lint::utils::sort::sort_by(&mut incomplete, |a, b| a.cmp(b));
            incomplete.dedup();
            let examples: Vec<Vec<u8>> = (incomplete.iter().take(3))
                .map(|it| paths::relative_escaped(&environment.cwd, &paths::from_native(it)))
                .collect();
            let more: &[u8] = if incomplete.len() > 3 { b", .." } else { b"" };
            self.warn(
                &[
                    b"The type checker ran out of stack in ",
                    &examples.join(&b", "[..])[..],
                    more,
                    b"\n  Rules that need type information may have missed problems there. This is a bug in Bun.",
                ]
                .concat(),
            );
        }
        // With `--staged`, `--changed` or standard input, the user already knows that only a few files are linted.
        let mut without_include = std::mem::take(&mut *without_include.lock());
        if options.only.is_some() || options.stdin || options.silent {
            without_include.clear();
        }
        without_include.retain(typed::is_out_of_proportion);
        for program in without_include {
            let plural = bun_sema_driver::format::plural;
            let seconds = program.load_time.as_secs_f64();
            let took = match seconds >= 1.0 {
                true => format!("{seconds:.1}s"),
                false => format!("{:.0}ms", seconds * 1e3),
            };
            let relative =
                |path: &[u8]| paths::relative_escaped(&environment.cwd, &paths::from_native(path));
            let (config, example) = (relative(&program.config_path), relative(&program.example));
            let linted = match program.requested_files {
                1 => example,
                many => [
                    &plural(many, b"file", b"files")[..],
                    b" (",
                    &example,
                    b", ..)",
                ]
                .concat(),
            };
            // With an oxlint config the flag doesn't select the project.
            let or_the_flag: &[u8] = match options.tsconfig.is_some() || is_oxlint {
                true => b".",
                false => b" or pass --tsconfig.",
            };
            self.warn(
                &[
                    b"Loaded ",
                    &plural(program.included, b"file", b"files")[..],
                    b" in ",
                    took.as_bytes(),
                    b" to lint ",
                    &linted,
                    b"\n  ",
                    &config,
                    b" has no \"include\", so it covers every file under it.",
                    b"\n  To speed this up, add \"include\" to it",
                    or_the_flag,
                ]
                .concat(),
            );
        }
        let mut in_comments = std::mem::take(&mut *skipped_in_comments.lock());
        let mut not_built_in = NotBuiltIn::default();
        in_comments.retain(|it| !not_built_in.record_formatting_rule(it));
        if !in_comments.is_empty() {
            bun_lint::utils::sort::sort_by(&mut in_comments, |a, b| a.cmp(b));
            let noun: &[u8] = match in_comments.len() {
                1 => b" rule enabled in a comment",
                _ => b" rules enabled in comments",
            };
            // With no config file there's no plugin package these rules could come from, so skip the advice.
            let is_native = (cwd_config.as_ref()).is_some_and(|it| it.flavor == Flavor::BuiltIn);
            loader.add_unsupported(&[
                in_comments.len().to_string().as_bytes(),
                noun,
                b" did not run: ",
                &in_comments.join(&b", "[..]),
                match is_native {
                    true => &b""[..],
                    false => b"\n  Enable at least one rule from the same plugin in your config.",
                },
            ]);
        }
        let mut unread: Vec<Vec<u8>> = std::mem::take(&mut *unread.lock());
        if !unread.is_empty() {
            bun_lint::utils::sort::sort_unstable(&mut unread);
            unread.dedup();
            let noun: &[u8] = match unread.len() {
                1 => b" file was not linted because only the parser in your config can read it: ",
                _ => {
                    b" files were not linted because only the parser in your config can read them: "
                }
            };
            let first: Vec<Vec<u8>> = (unread.iter().take(3))
                .map(|it| paths::relative_escaped(&environment.cwd, it))
                .collect();
            loader.add_unsupported(&[
                unread.len().to_string().as_bytes(),
                noun,
                &first.join(&b", "[..]),
                if unread.len() > 3 { b", .." } else { b"" },
                b"\n  To lint with that parser, install eslint: bun add -d eslint",
            ]);
        }
        let mut needs_eslint = std::mem::take(&mut *needs_eslint.lock());
        bun_lint::utils::sort::sort_by(&mut needs_eslint, |a, b| a.0.cmp(&b.0));
        // Each pass of `--fix` finds the same blocks.
        needs_eslint.dedup();
        let of = |is_flat: bool| -> Vec<Vec<u8>> {
            let all = needs_eslint.iter();
            all.filter(|it| (it.1 == Flavor::Eslint) == is_flat)
                .map(|it| it.0.clone())
                .collect()
        };
        let because: [&[u8]; 2] = [
            b"it needs eslint, which is not installed",
            b"they need eslint, which is not installed",
        ];
        let hint = b"\n  Run bun add -d eslint";
        not_linted(&loader, &environment.cwd, &of(true), because, hint);
        // An `.eslintrc` has no languages, so only a custom parser can read such a file.
        let because: &[u8] = b"the parser in your config only works with an eslint.config.js";
        not_linted(&loader, &environment.cwd, &of(false), [because; 2], b"");
        let mut seen: Vec<&Arc<_>> = Vec::new();
        let results = linted.iter().flat_map(|it| &it.results);
        let configs = results.filter_map(|it| it.linted.as_ref());
        for config in configs.map(|it| &it.config) {
            if !seen.iter().any(|it| Arc::ptr_eq(it, config)) {
                seen.push(config);
                not_built_in.add(config);
            }
        }
        let mut unsupported = std::mem::take(&mut *loader.unsupported.lock());
        if options.allow_unsupported {
            for line in unsupported.drain(..) {
                self.warn(&line);
            }
        }
        if let Some(rejection) = loader.refused() {
            return self.reject_flag(rejection);
        }
        if let Some(mistake) = loader.mistake() {
            self.out.stderr.extend_from_slice(mistake);
            self.out.exit_code = 2;
            return self.out;
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

        // Rules that look at several files now revisit the files they have something to report in.
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
        // ESLint lints files one at a time, so it stops at the first path that throws. Threads race here, so pick the
        // first path to get the same error every time.
        let thrown = results.iter().filter(|it| it.thrown.is_some());
        let first = thrown.min_by(|a, b| strings::order_utf16(&a.path, &b.path));
        if let Some(thrown) = first.and_then(|it| it.thrown.as_ref()) {
            return self.fail(thrown);
        }

        let (mut fixed, mut fixes) = (0, 0);
        // Printed after the report, which also covers all the other files.
        let mut not_written: Vec<Vec<u8>> = Vec::new();
        let mut not_staged: Vec<Vec<u8>> = Vec::new();
        if options.fix {
            let portable = |it: &FileResult| paths::from_native(&it.path);
            let changed: Vec<&FileResult> = results.iter().filter(|it| it.is_fixed).collect();
            let (mut failures, mut written_paths) =
                (Guarded::new(Vec::new()), Guarded::new(Vec::new()));
            let fixes_written = AtomicU64::new(0);
            let written_files = fs::WrittenFiles::default();
            pool.for_each(changed.len(), 1, &|index| {
                let result = changed[index];
                let done = match result.text_to_write() {
                    // Never write an empty file instead. Fixes that delete everything produce an empty text, which is
                    // `Some` and gets saved.
                    None => Err(b"the fixed code was lost. This is a bug in Bun.".to_vec()),
                    Some(text) => {
                        fs::write_atomically(&written_files, &environment.cwd, &result.path, text)
                    }
                };
                match done {
                    Ok(()) => {
                        written_paths.lock().push(portable(result));
                        fixes_written.fetch_add(result.fixes as u64, Ordering::Relaxed);
                    }
                    Err(why) => {
                        let line = [b"Cannot write ", &result.path[..], b": ", &why].concat();
                        failures.lock().push(line);
                    }
                }
            });
            if let Some(only) = &only {
                // See `Context::fixes_file`.
                let is_fixable = |it: &LintMessage| it.fix.is_some() && context.should_fix(it);
                let fixable = (results.iter()).filter(|it| it.messages.iter().any(is_fixable));
                let mut partly_staged: Vec<Vec<u8>> = (fixable.map(portable))
                    .filter(|it| only.is_partly_staged(it))
                    .collect();
                if !partly_staged.is_empty() {
                    not_staged.push(only.partly_staged_error(&mut partly_staged, "fixed"));
                }
                not_staged.extend(only.stage(written_paths.get_mut()).err().map(|it| it.0));
            }
            not_written = std::mem::take(failures.get_mut());
            bun_lint::utils::sort::sort_unstable(&mut not_written);
            fixed = changed.len() - not_written.len();
            fixes = fixes_written.into_inner() as usize;
        }

        let suppressed = match options.stdin {
            true => Suppressed::default(),
            false => match self.apply_suppressions(&mut results, is_oxlint, is_native) {
                Ok(suppressed) => suppressed,
                Err(Fatal(error)) => return self.fail(&error),
            },
        };
        for result in &mut results {
            if LintMessage::hide_claimed(&mut result.messages) {
                result.counts = Counts::of(&result.messages);
            }
        }
        let has_unused = suppressed.has_unused && !options.pass_on_unpruned_suppressions;
        // oxlint reports these like problems, after every file's problems.
        let suppression_errors = match is_oxlint {
            true => format::summary::suppression_errors(has_unused, suppressed.has_new),
            false => None,
        };

        let mut counts = Counts::default();
        (results.iter().chain(&suppression_errors)).for_each(|it| counts.add(it.counts));
        if options.quiet {
            results.iter_mut().for_each(FileResult::keep_errors_only);
            results.retain(|it| !it.messages.is_empty());
        }
        // The `options` of an `.oxlintrc.json` fill in what the command line doesn't set.
        let max_warnings = match options.max_warnings {
            -1 => cwd_config
                .as_ref()
                .and_then(|it| it.max_warnings)
                .unwrap_or(-1),
            given => given,
        };
        let denies_warnings =
            options.deny_warnings || cwd_config.as_ref().is_some_and(|it| it.denies_warnings);
        // Outside oxlint mode, `--deny-warnings` is `--max-warnings 0`.
        let max_warnings = match denies_warnings && !is_oxlint {
            true => 0,
            false => max_warnings,
        };
        let has_too_many_warnings = max_warnings >= 0 && counts.warnings as i64 > max_warnings;
        let fails_on_problems =
            counts.errors > 0 || has_too_many_warnings || (denies_warnings && counts.warnings > 0);
        // Only these two formats print files without problems.
        if !matches!(format, Format::Json | Format::JsonWithMetadata) {
            results.retain(|it| !it.messages.is_empty());
        }
        match results.iter().all(|it| is_ordered_by_bytes(&it.path)) {
            true => bun_lint::utils::sort::sort_by(&mut results, |a, b| a.path.cmp(&b.path)),
            false => bun_lint::utils::sort::sort_by(&mut results, |a, b| {
                strings::order_utf16(&a.path, &b.path)
            }),
        }
        results.extend(suppression_errors);
        // oxlint prints its parser's message without ESLint's `Parsing error: ` prefix.
        if is_oxlint {
            let messages = results.iter_mut().flat_map(|it| &mut it.messages);
            for message in messages.filter(|it| is_parse_error(it)) {
                message.message.drain(..b"Parsing error: ".len());
            }
        }
        // With `--silent`, oxlint's formats print what they print when there are no problems.
        if is_oxlint && options.silent {
            results.clear();
        }
        let has_no_files = is_oxlint
            && files == 0
            && !options.stdin
            && !options.pass_on_no_patterns
            && only.is_none();

        let started = Instant::now();
        let with_help: format::WithHelp = &|result, only| context.with_help(result, only);
        let color = options.color.unwrap_or(environment.stdout.colors);
        let to_terminal = environment.stdout.is_tty && options.output_file.is_none();
        let meta = format::Meta {
            help: (context.reads_help && context.help_on_demand).then_some(with_help),
            cwd: &environment.cwd,
            color,
            links: color && to_terminal,
            width: match to_terminal {
                true => (bun_core::output::File::from(bun_core::Fd::stdout()).winsize())
                    .map_or(0, |size| usize::from(size.col)),
                false => 0,
            },
            color_option: options.color,
            max_warnings_exceeded: has_too_many_warnings.then_some((max_warnings, counts.warnings)),
            shows_all: options.all,
            github_annotations: environment.is_github_action && !is_oxlint,
            found: counts,
            fixed,
            updated_suppressions: suppressed.updated,
            run: format::oxlint::Run {
                files,
                rules: cwd_config
                    .as_ref()
                    .filter(|_| is_oxlint && !loader.has_nested_configurations())
                    .map(|it| {
                        let with_types = options.type_aware.or(config_wants_types) == Some(true);
                        it.config
                            .oxlint_number_of_rules(linter.registry(), with_types)
                    }),
                threads: pool.threads(),
                seconds: self.began.elapsed().as_secs_f64(),
            },
            is_oxlint,
            is_native,
            pool: &pool,
            version: environment.version,
        };
        let output = if has_no_files {
            format::summary::without_files(format, &meta, options.error_on_unmatched_pattern)
        } else if (options.silent && !is_oxlint)
            || (only.is_some() && files == 0 && format.is_human_readable())
        {
            Vec::new()
        } else {
            format::format(format, &results, &meta)
        };
        let annotations = match has_no_files || options.silent {
            true => Vec::new(),
            false => format::annotations(format, &results, &meta, options.output_file.is_some()),
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
            if let Err(why) = fs::write_new(&environment.cwd, &path, &output) {
                return self.fail(
                    &[&b"There was a problem writing the output file:\n"[..], &why].concat(),
                );
            }
        } else if !output.is_empty() {
            self.out.stdout = output;
            if !format.is_oxlint_output() {
                self.out.stdout.push(b'\n');
            }
        }
        if !annotations.is_empty() {
            self.out.stdout.extend_from_slice(&annotations);
            self.out.stdout.push(b'\n');
        }

        if !is_oxlint && !options.silent && counts.errors == 0 && has_too_many_warnings {
            self.error(&format::summary::too_many_warnings(max_warnings));
        }
        if !options.silent {
            let colors = environment.stderr.colors;
            format::summary::write_fixed(&mut self.out.stderr, colors, fixes, fixed);
        }
        if let Some(only) = (only.as_ref()).filter(|_| files == 0 && !options.silent) {
            let _ = writeln!(self.out.stderr, "{}", only.no_files_message("lint"));
        } else if !is_oxlint && !options.stdin && !options.silent {
            format::summary::write(
                &mut self.out.stderr,
                environment.stderr.colors,
                counts,
                files,
                0,
                self.began.elapsed().as_secs_f64() * 1000.0,
            );
        }
        // In a run that passes, advice is noise. `--doctor` always prints it.
        if fails_on_problems && format.is_human_readable() && !options.quiet && !options.silent {
            for line in std::mem::take(&mut *loader.advice.lock()) {
                pretty!(
                    &mut self.out.stderr,
                    environment.stderr.colors,
                    "<blue>note<r><d>:<r> {}\n",
                    BStr::new(&line)
                );
            }
        }
        if !fails_on_problems && format.is_human_readable() {
            not_built_in.about_layout.clear();
        }
        for note in not_built_in.notes().filter(|_| !options.silent) {
            pretty!(
                &mut self.out.stderr,
                environment.stderr.colors,
                "<blue>note<r><d>:<r> {}\n",
                note
            );
        }
        if options.timing {
            self.write_timing(&timing, &phases, &pool, &js_plugins.loading());
        }
        not_staged.iter().for_each(|it| self.error(it));
        if !not_written.is_empty() {
            not_written.iter().for_each(|it| self.failed(it));
            return self.out;
        }
        if !not_staged.is_empty() {
            self.out.exit_code = 2;
            return self.out;
        }
        if has_unused && !is_oxlint {
            self.error(
                b"There are suppressions left that do not occur anymore. To resolve this, re-run the command with `--prune-suppressions` to remove unused suppressions. To ignore unused suppressions, use `--pass-on-unpruned-suppressions`.",
            );
            self.out.exit_code = 2;
            return self.out;
        }
        if !unsupported.is_empty() {
            let hint: &[u8] =
                b"\n  Everything else was linted. Use --allow-unsupported to make this a warning.";
            for (at, line) in unsupported.iter().enumerate() {
                match at + 1 == unsupported.len() {
                    true => self.error(&[&line[..], hint].concat()),
                    false => self.error(line),
                }
            }
            self.out.exit_code = 2;
            return self.out;
        }
        self.out.exit_code = if options.exit_on_fatal_error && counts.fatal_errors > 0 {
            2
        } else if is_oxlint && options.suppress_all && !has_no_files {
            // oxlint exits 0 once it has saved the suppressions file, even if problems remain.
            0
        } else {
            u8::from(fails_on_problems || (has_no_files && options.error_on_unmatched_pattern))
        };
        self.out
    }

    /// Handles `eslint-suppressions.json` the way ESLint's `cli.execute` does.
    fn apply_suppressions(
        &self,
        results: &mut [FileResult],
        is_oxlint: bool,
        is_native: bool,
    ) -> Result<Suppressed, Fatal> {
        let (options, cwd) = (self.options, &self.environment.cwd);
        let location = options
            .suppressions_location
            .as_deref()
            .map(paths::from_native);
        let default = if is_oxlint {
            suppressions::OXLINT_FILE_NAME
        } else {
            suppressions::DEFAULT_FILE_NAME
        };
        // One file serves runs from any directory in the project, so its paths are relative to bunfig.toml's directory.
        // If no location is configured, the nearest file between the working directory and that directory is used, and
        // its paths are relative to its own directory. With an ESLint or oxlint config, a new file is created where
        // that tool would look for it.
        let project = options.bunfig_base_directory(cwd);
        let start = match &location {
            Some(_) if options.suppressions_location_is_from_flag => cwd.clone(),
            Some(_) => project,
            None => paths::ancestors(cwd)
                .take_while(|it| it.starts_with(&project))
                .find(|it| fs::is_file(&paths::join(it, default)))
                .map_or_else(
                    || {
                        if is_native {
                            project.clone()
                        } else {
                            cwd.clone()
                        }
                    },
                    <[u8]>::to_vec,
                ),
        };
        let path = match &location {
            Some(location) => paths::resolve(cwd, location),
            None => paths::resolve(&start, default),
        };
        let cwd = &start;
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
            suppressed.save(cwd, &path)?;
        }
        let unused = suppressed.apply(results, cwd, is_oxlint);
        if options.prune_suppressions {
            suppressed.prune(&unused, cwd);
            suppressed.save(cwd, &path)?;
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
            "  wall: {:.1}ms finding files and configs, {:.1}ms type checking and linting, {:.1}ms linting without types, {:.1}ms formatting, {:.1}ms total, {} threads\n  all threads: {:.1}ms reading, {:.1}ms parsing and binding, {:.1}ms in rules",
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
            "  JavaScript: {} engines loaded {} modules, {:.1} MB of source, in {:.1}ms",
            loading.realms,
            loading.modules,
            loading.bytes as f64 / 1e6,
            loading.milliseconds,
        );
        for (i, plugin) in loading.need_config_file.iter().enumerate() {
            let before = match i {
                0 => "; loaded the whole config file for ",
                _ => ", ",
            };
            let _ = write!(self.out.stderr, "{before}{}", BStr::new(plugin));
        }
        if loading.linted_by_eslint > 0 {
            let _ = write!(
                self.out.stderr,
                "; the eslint package linted {} files",
                loading.linted_by_eslint
            );
        }
        if let (most @ 1.., freed) = loading.sizes {
            let most = most as f64 / 1e6;
            let _ = write!(self.out.stderr, "; peak {most:.0} MB");
            if freed > 0 {
                let _ = write!(self.out.stderr, ", engines freed to save memory: {freed}");
            }
        }
        self.out.stderr.push(b'\n');
        // A valid file that falls back to the error-recovering parser is a bug in the fast parser.
        let counts = &bun_sema_parser::COUNTS;
        let _ = write!(
            self.out.stderr,
            "  fast parser: {} files",
            counts.parsed.load(Ordering::Relaxed)
        );
        for (why, count) in bun_sema_parser::Rejection::ALL.iter().zip(&counts.refused) {
            match count.load(Ordering::Relaxed) {
                0 => {}
                count => _ = write!(self.out.stderr, ", fell back ({why:?}): {count}"),
            }
        }
        let without_filter = timing.without_filter.load(Ordering::Relaxed);
        let _ = writeln!(
            self.out.stderr,
            "\n  linted without the name filter: {without_filter} files"
        );
    }
}

/// Rules that `bun lint` leaves out on purpose but that the linted files' configs or comments turn on: deprecated
/// formatting rules, whose job `bun fmt` does, and plugins with no rules here, whose rules oxlint's `categories` turn
/// on without naming them. Every format prints a note that they didn't run. The formats for people only mention the
/// formatting rules if the run fails.
#[derive(Default)]
struct NotBuiltIn {
    /// [`formatting_rule`]
    about_layout: Vec<&'static str>,
    /// [`ResolvedConfig::plugins_without_rules`]
    plugins: Vec<&'static str>,
}

impl NotBuiltIn {
    /// Records the rule `id`, which a comment turns on, if it's such a rule. Returns whether it is.
    fn record_formatting_rule(&mut self, id: &[u8]) -> bool {
        let rule = formatting_rule(id);
        self.about_layout.extend(rule.map(|it| it.0));
        rule.is_some()
    }

    fn add(&mut self, config: &ResolvedConfig) {
        let about_layout = config.formatting_rules.iter();
        let about_layout = about_layout.filter(|it| it.severity != Severity::Off);
        self.about_layout.extend(about_layout.map(|it| it.rule.0));
        let plugins = config.plugins_without_rules.iter();
        self.plugins.extend(plugins.map(|it| it.prefix()));
    }

    fn notes(mut self) -> impl Iterator<Item = String> {
        for names in [&mut self.about_layout, &mut self.plugins] {
            names.sort_unstable();
            names.dedup();
        }
        let about_layout = match &self.about_layout[..] {
            [] => None,
            [one] => Some(format!(
                "1 deprecated formatting rule did not run: {one}\n  Use bun fmt instead."
            )),
            all => Some(format!(
                "{} deprecated formatting rules did not run: {}{}\n  Use bun fmt instead.",
                all.len(),
                all[..all.len().min(3)].join(", "),
                if all.len() > 3 { ", .." } else { "" },
            )),
        };
        let plugins = match &self.plugins[..] {
            [] => None,
            [one] => Some(format!(
                "bun lint has no \"{one}\" rules, so none of them ran\n  Remove \"{one}\" from \"plugins\"."
            )),
            all => Some(format!(
                "bun lint has no \"{}\" rules, so none of them ran\n  Remove them from \"plugins\".",
                all.join("\" or \""),
            )),
        };
        [about_layout, plugins].into_iter().flatten()
    }
}

/// How long each phase of a run took, in seconds.
#[derive(Default)]
struct Phases {
    discovery: f64,
    /// Type checking, plus linting the files that need types.
    checking: f64,
    linting: f64,
    formatting: f64,
}

/// Tells the user that the files at `paths` weren't linted. `because` is the reason, worded for one file and for
/// several.
fn not_linted(loader: &Loader, cwd: &[u8], paths: &[Vec<u8>], because: [&[u8]; 2], hint: &[u8]) {
    if paths.is_empty() {
        return;
    }
    let is_single = paths.len() == 1;
    // The extensions, most frequent first, and the first few files.
    let mut kinds: Vec<(&[u8], usize)> = Vec::new();
    for path in paths {
        let name = paths::basename(path);
        let dot = strings::last_index_of_char(name, b'.').unwrap_or(0);
        match kinds.iter_mut().find(|it| it.0 == &name[dot..]) {
            Some(kind) => kind.1 += 1,
            None => kinds.push((&name[dot..], 1)),
        }
    }
    bun_lint::utils::sort::sort_by_key(&mut kinds, |it| std::cmp::Reverse(it.1));
    let kinds: Vec<Vec<u8>> = (kinds.iter())
        .map(|it| [format!("{} *", it.1).as_bytes(), &paths::escaped(it.0)].concat())
        .collect();
    let first: Vec<Vec<u8>> = (paths.iter().take(3))
        .map(|it| paths::relative_escaped(cwd, it))
        .collect();
    loader.add_unsupported(&[
        paths.len().to_string().as_bytes(),
        if is_single {
            b" file was"
        } else {
            b" files were"
        },
        b" not linted because ",
        because[usize::from(!is_single)],
        b" (",
        &kinds.join(&b", "[..]),
        b"): ",
        &first.join(&b", "[..]),
        if paths.len() > 3 { b", .." } else { b"" },
        hint,
    ]);
}

fn warn_about_circular_fixes(loader: &Loader, path: &[u8]) {
    loader.warn(&[
        b"Circular fixes detected while fixing ",
        &paths::escaped(&paths::to_native(path.to_vec())),
        b". It is likely that you have conflicting rules in your configuration.",
    ]);
}

/// The outcome for a command line that can't be parsed. `message` is the error.
pub fn reject_command_line(message: &[u8], environment: &Environment) -> Outcome {
    let run = Run {
        options: &Options::default(),
        environment,
        out: Outcome::default(),
        began: Instant::now(),
        emulates_oxlint: None,
        modules: None,
    };
    let mut out = run.reject(message);
    pretty!(
        &mut out.stderr,
        environment.stderr.colors,
        "<blue>note<r><d>:<r> run 'bun lint --help' for more information\n",
    );
    out
}

/// Runs `bun lint`. The caller handles `options.help` and `options.cwd`.
pub fn run(options: &Options, environment: &Environment) -> Outcome {
    let mut options = options.clone();
    let loaded = options.load_pipes(&environment.cwd);
    let execute = |environment: &Environment, modules: Option<&Modules>| {
        let run = Run {
            options: &options,
            environment,
            out: Outcome::default(),
            began: Instant::now(),
            emulates_oxlint: None,
            modules,
        };
        match &loaded {
            Ok(()) => run.execute(),
            Err(why) => run.reject_flag(why),
        }
    };
    match options.doctor {
        true => doctor::watching(environment, |environment, modules| {
            execute(environment, Some(modules))
        }),
        false => execute(environment, None),
    }
}
