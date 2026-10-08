//! Type checks a project: finds its configuration and its files, checks them on every core, and
//! reports the errors.
//!
//! `bun check`, `bun build --check` and `bun run --check` all use this, with different roots and
//! different output formatting.

pub mod format;
pub mod host;

pub use bun_sema::check::explain::MessageChain;
pub use bun_sema::messages::Category;

use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::path_buffer_pool;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::RecentAtoms;
use bun_sema::check::errors::Checked;
use bun_sema::check::explain::Explained;
use bun_sema::check::task::{Finished, Published};
use bun_sema::check::{
    FOREIGN_EVALUATION_KINDS, Program, Requested, compute_ecma_line_starts, decode_rune,
};
use bun_sema::config::{self, ConfigError};
use bun_sema::hir::{ExprTag, FileKind};
use bun_sema::json::Json;
use bun_sema::messages;
use bun_sema::program::{
    COMPARE_PATHS_CASE_SENSITIVE, FileId, Files, declaration_emit_output_file_path,
    own_emit_output_file_path,
};
pub use bun_sema::resolve::ScriptKind;
use bun_sema::resolve::{
    Host, Options, Phase, ancestors, contains_path, displayed_path,
    get_relative_path_from_directory, inside, is_declaration_file_name, is_javascript,
    is_javascript_file, is_relative, is_same_path, join, output_declaration_file_name, to_path,
    to_path_in, typescript_path,
};
use bun_sema::session::{Arena, Session};
use bun_sema::types::LinkCounts;
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_sema::verify::verify_project_references;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::cmp::Reverse;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::thread::ThreadId;
use std::time::{Duration, Instant};

/// The caches that the worker threads of a check reuse from one file to the next. The threads
/// belong to the pool and outlive the check, so the caches are owned here: a thread has its set
/// for the duration of a parallel region, and gets the same set back in the next one. A set that
/// went from thread to thread would be grown and freed by another thread than the one that
/// allocated it, and the allocator defers such a free.
#[derive(Default)]
pub struct ThreadCaches {
    idle: Guarded<Vec<(ThreadId, RecentAtoms, bun_js_parser::sema::ThreadCaches)>>,
}

impl ThreadCaches {
    /// Lends the calling thread its set until the guard is dropped.
    pub fn lend(&self) -> impl Drop + '_ {
        struct Lent<'a>(&'a ThreadCaches);
        impl Drop for Lent<'_> {
            fn drop(&mut self) {
                let set = (
                    std::thread::current().id(),
                    RecentAtoms::take(),
                    bun_js_parser::sema::ThreadCaches::take(),
                );
                self.0.idle.lock().push(set);
            }
        }
        let thread = std::thread::current().id();
        let mut idle = self.idle.lock();
        let own = idle.iter().position(|set| set.0 == thread);
        let own = own.map(|at| idle.swap_remove(at));
        drop(idle);
        if let Some((_, atoms, parser)) = own {
            atoms.install();
            parser.install();
        }
        Lent(self)
    }

    /// Frees the buffers of the parser, which have the capacity of the largest file that a thread
    /// has parsed. Outside a parallel region.
    pub(crate) fn drop_those_of_the_parser(&self) {
        drop(bun_js_parser::sema::ThreadCaches::take());
        for set in self.idle.lock().iter_mut() {
            set.2 = Default::default();
        }
    }
}

/// The allocator retains a thread's free pages for that thread, and only that thread can release
/// them: each thread of `pool` does when it is next idle, like the bundler's `Worker::deinit_soon`.
fn release_free_pages_of(pool: &bun_threading::ThreadPool) {
    use bun_threading::thread_pool::{Node, Task};
    unsafe fn release(task: *mut Task) {
        // SAFETY: allocated below, and queued once.
        drop(unsafe { bun_core::heap::take(task) });
        bun_core::Global::mimalloc_cleanup(true);
    }
    pool.push_idle_task_to_each_thread(|| {
        bun_core::heap::into_raw(Box::new(Task {
            node: Node::default(),
            callback: release,
        }))
    });
}

/// Runs `work(i)` for every `i` below `count` on Bun's shared thread pool, on at most `threads`
/// threads at a time. Indices are claimed in order, `run` consecutive ones at a time: each thread
/// takes the next run when it finishes its previous one.
pub fn for_each_parallel_in_runs(
    caches: &ThreadCaches,
    threads: usize,
    count: usize,
    run: usize,
    work: &(dyn Fn(usize) + Sync),
) {
    if count == 0 {
        return;
    }
    let next = AtomicUsize::new(0);
    let mut runners = vec![(); threads.clamp(1, count.div_ceil(run))];
    bun_threading::WorkPool::get().each(
        (),
        |(), (), _| {
            let _lent = caches.lend();
            loop {
                let from = next.fetch_add(run, Ordering::Relaxed);
                if from >= count {
                    break;
                }
                for i in from..(from + run).min(count) {
                    work(i);
                }
            }
        },
        &mut runners,
    );
}

/// The work of one thread between two barriers, with one `Checker` and one buffer: `check_file` for
/// each file, in program order. A file is identified by its index: its position in program order
/// among the files to check.
type Task = Vec<usize>;

/// `Some`: the task checks ahead the statements of its one file that begin in this range of the
/// text. See `PlanOptions::split_files`.
type Ahead = Option<(u32, u32)>;

/// The constants of a `Plan`. They are options while they are still being tuned: the standalone
/// command line sets them.
#[derive(Clone, Copy)]
pub struct PlanOptions {
    /// Consecutive steps hold at most 1, g, g * g, .. tasks.
    pub step_growth: usize,
    /// How many light files are checked in steps of growing size, one file per task, before the one step with all other files. They
    /// are spread evenly over the light files of the program.
    pub warm_up_files: usize,
    /// A larger file is heavy. It is not in the warm-up, and it is a task of its own.
    pub warm_up_max_bytes: usize,
    /// After the warm-up, consecutive light files in program order form one task until they reach
    /// this many bytes of source. 0: one file per task.
    pub chunk_bytes: usize,
    /// .. or until they reach the source size of the step divided by this, if that is less: a step
    /// with many files has about this many tasks at least. Not a function of the thread count.
    pub min_tasks: usize,
    /// What a type node adds to the cost estimate of a file, in which an identifier of an expression counts 1.
    pub type_node_cost: usize,
    /// Nonzero: a declaration file is split if its cost estimate is more than the cost of the last step divided by this. Tasks of
    /// about that cost check ranges of its statements ahead and publish what they evaluate (`Checker::check_statements_ahead`). They
    /// stand where the task of the file stood, in the order of the ranges. The task of the file follows in a step of its own.
    /// 0: no file is split.
    pub split_files: u32,
    /// The obstacles that `check_statements_ahead` returns in spite of which a range is published, as a bit set.
    pub split_tolerates: u8,
    /// Whether a range publishes the tables keyed by a type, a signature or a mapper too.
    pub split_publishes_everything: bool,
    /// `--checkers`. Nonzero: `checkerPool` is used, and none of the above applies.
    pub checkers: usize,
    /// One checker (`checkers`) hands out symbol ids as `tsc --singleThreaded` does. Not for
    /// TypeScript's own baselines: its test runner compiles every test in one process, and
    /// `nextSymbolId` belongs to the process.
    pub reproduces_symbol_ids: bool,
    /// How many projects of a `tsc -b` run are loaded or checked at the same time, at most. Each
    /// occupies memory.
    pub projects_at_once: usize,
}

impl Default for PlanOptions {
    fn default() -> PlanOptions {
        PlanOptions {
            step_growth: 8,
            warm_up_files: 1 + 8 + 64,
            warm_up_max_bytes: 16 << 10,
            chunk_bytes: 64 << 10,
            min_tasks: 128,
            type_node_cost: 1,
            split_files: 64,
            split_tolerates: 0,
            split_publishes_everything: false,
            checkers: 0,
            reproduces_symbol_ids: true,
            projects_at_once: 4,
        }
    }
}

/// Which task is in which step, and in which order the tasks of a step are published. A function of
/// the program alone: not of the thread count, not of time. During a step the published state is
/// read-only and a task writes to its own buffer, so the result of a task is a function of the
/// program and of the published state at the start of its step. By induction over the steps, so is
/// the output.
struct Plan {
    steps: Vec<Vec<Task>>,
    /// By task of the step before the last. Empty: no file is split.
    ahead: Vec<Ahead>,
}

impl Plan {
    /// `createCheckers`, `forEachCheckerGroupDo`: file `i` of the program belongs to checker `i %
    /// checkers`, and a checker visits its files in program order. The checkers share nothing.
    /// `rank_of(i)`: the position of file `i` of the files to check in the program, which has
    /// `files` files.
    fn of_checkers(
        count: usize,
        rank_of: &dyn Fn(usize) -> usize,
        files: usize,
        checkers: usize,
    ) -> Plan {
        let checkers = checkers.min(files).clamp(1, 256);
        let mut tasks: Vec<Task> = vec![Vec::new(); checkers];
        for file in 0..count {
            tasks[rank_of(file) % checkers].push(file);
        }
        Plan {
            steps: vec![tasks],
            ahead: Vec::new(),
        }
    }

    /// `count`: the number of files to check. `size_of(i)`: the source size of file `i` in bytes.
    ///
    /// No order among the tasks is needed: what they observe of each other is published, or each
    /// computes its own copy.
    fn new(
        count: usize,
        bytes_of: &dyn Fn(usize) -> usize,
        size_of: &dyn Fn(usize) -> usize,
        ranges_of: &dyn Fn(usize, usize) -> Vec<(u32, u32)>,
        options: &PlanOptions,
    ) -> Plan {
        assert!(options.step_growth >= 1);
        let mut steps: Vec<Vec<Task>> = Vec::new();
        // The warm-up fills the published state with what most tasks need. Until that is published,
        // each task of a step computes its own copy. The steps should be short, so they consist of
        // light files. The files are a sample of the whole program, because its first files are not
        // representative of the rest.
        let is_heavy = |file: usize| bytes_of(file) > options.warm_up_max_bytes;
        let light: Vec<usize> = (0..count).filter(|&file| !is_heavy(file)).collect();
        let expected = options.warm_up_files.min(light.len());
        let warm_up = (0..expected).map(|i| light[i * light.len() / expected]);
        let warm_up: Vec<usize> = warm_up.collect();
        let (mut tasks, mut limit) = (warm_up.iter().map(|&file| vec![file]).peekable(), 1usize);
        while tasks.peek().is_some() {
            steps.push(tasks.by_ref().take(limit).collect());
            limit = limit.saturating_mul(options.step_growth);
        }
        // One step with all other files. The heaviest file of a program takes about as long as a
        // thread's share of the whole check, so there is one step in which heavy files run, and
        // they are started first.
        let rest = (0..count).filter(|file| warm_up.binary_search(file).is_err());
        let chunks = Plan::cut(rest.collect(), size_of, options);
        // `split_files`. `ranges_of(file, parts)`: see there.
        let cost: usize = chunks.iter().flatten().map(|&file| size_of(file)).sum();
        let parts_of = |file: usize| (size_of(file) * options.split_files as usize).div_ceil(cost);
        let (mut tasks, mut ahead, mut split) = (Vec::new(), Vec::new(), Vec::new());
        for chunk in chunks {
            let ranges = match chunk[..] {
                [file] if parts_of(file) > 1 => ranges_of(file, parts_of(file)),
                _ => Vec::new(),
            };
            if ranges.is_empty() {
                tasks.push(chunk);
                ahead.push(None);
                continue;
            }
            for range in ranges {
                tasks.push(chunk.clone());
                ahead.push(Some(range));
            }
            split.push(chunk);
        }
        if !tasks.is_empty() {
            steps.push(tasks);
        }
        if split.is_empty() {
            ahead.clear();
        } else {
            steps.push(split);
        }
        Plan { steps, ahead }
    }

    /// `ahead`, if `number` is the step whose tasks it describes.
    fn ahead_of(&self, number: usize) -> &[Ahead] {
        if number + 2 == self.steps.len() {
            &self.ahead
        } else {
            &[]
        }
    }

    /// The tasks of one step for `rest`, which is in program order.
    fn cut(rest: Vec<usize>, size_of: &dyn Fn(usize) -> usize, options: &PlanOptions) -> Vec<Task> {
        let bytes: usize = rest.iter().map(|&file| size_of(file)).sum();
        // About `min_tasks` tasks, whatever the size of the program: enough for any number of threads, and every further task computes
        // its own copy of what it shares with the others.
        let chunk_bytes = match options.min_tasks {
            0 => options.chunk_bytes,
            tasks => (bytes / tasks).max(1),
        };
        let is_heavy = |file: usize| size_of(file) >= chunk_bytes;
        // The files of a task share a buffer, and neighbours in program order use the same types.
        let mut chunks: Vec<Task> = Vec::new();
        // The source size of the last chunk, if it consists of light files.
        let mut bytes_of_last = None;
        for file in rest {
            match bytes_of_last {
                _ if is_heavy(file) => {
                    chunks.push(vec![file]);
                    bytes_of_last = None;
                }
                Some(so_far) if so_far < chunk_bytes => {
                    chunks.last_mut().unwrap().push(file);
                    bytes_of_last = Some(so_far + size_of(file));
                }
                _ => {
                    chunks.push(vec![file]);
                    bytes_of_last = Some(size_of(file));
                }
            }
        }
        chunks
    }
}

/// The progress of a check. Read from another thread.
#[derive(Default)]
pub struct Progress {
    /// The number of files to check. 0: the program is still being loaded.
    pub to_check: AtomicUsize,
    pub checked: AtomicUsize,
    /// The same in bytes of source, which predicts the remaining time better: the largest files are
    /// checked first.
    pub bytes_to_check: AtomicUsize,
    pub bytes_checked: AtomicUsize,
    /// The number of errors found so far.
    pub errors: AtomicUsize,
}

/// A compiler option of a command line and its value. `null` unsets the option.
#[derive(Clone)]
pub struct CompilerOption(Vec<u8>, Json);

/// The `Tristate` of the boolean option `name` of a command line.
pub fn tristate(compiler_options: &[CompilerOption], name: &[u8]) -> Option<bool> {
    let option = compiler_options.iter().rfind(|option| option.0 == name)?;
    option.1.as_bool()
}

pub enum FlagError {
    /// No compiler option has this name.
    Unknown,
    /// The option requires a value and none was given, or it cannot be given on a command line.
    NeedsValue,
    /// The value is not one the option accepts. The allowed values of an enum.
    BadValue(Vec<&'static [u8]>),
}

/// Whether the compiler option `name`, matched case-insensitively, is a boolean, so that its value
/// may be omitted.
fn is_boolean_compiler_option(name: &[u8]) -> bool {
    bun_sema::config_options::choices(name) == Some(&[b"true".as_slice(), b"false"][..])
}

/// `--name value` as `tsc` reads it. `name` is matched case-insensitively. A boolean without a value is `true`.
fn compiler_option_from_flag(
    name: &[u8],
    value: Option<&[u8]>,
) -> Result<CompilerOption, FlagError> {
    use bun_sema::config_options::{choices, from_text, invalid_enum_type, possible_option};
    // What `tsc` does instead of compiling. A configuration file may have them, to no effect.
    if [&b"all"[..], b"init", b"version"]
        .iter()
        .any(|it| name.eq_ignore_ascii_case(it))
    {
        return Err(FlagError::Unknown);
    }
    if let Some(b"null") = value {
        let name = possible_option(name).ok_or(FlagError::Unknown)?;
        return Ok(CompilerOption(name.to_vec(), Json::Null));
    }
    let (allowed, is_boolean) = (choices(name), is_boolean_compiler_option(name));
    let value = match value {
        Some(value) => value,
        None if is_boolean => b"true",
        // `from_text` with an arbitrary text distinguishes an unknown option from one that needs a
        // value.
        None if allowed.is_some() || from_text(name, b"0").is_some() => {
            return Err(FlagError::NeedsValue);
        }
        None => return Err(FlagError::Unknown),
    };
    match from_text(name, value) {
        Some((name, value)) => match invalid_enum_type(name, &value) {
            Some(allowed) => Err(FlagError::BadValue(allowed)),
            None => Ok(CompilerOption(name.to_vec(), value)),
        },
        None if allowed.is_some() || from_text(name, b"0").is_some() => {
            Err(FlagError::BadValue(Vec::new()))
        }
        None => Err(FlagError::Unknown),
    }
}

/// A flag of a command line that is not accepted.
pub struct RejectedFlag {
    /// As it is written, up to `=`.
    pub flag: Vec<u8>,
    pub value: Option<Vec<u8>>,
    pub error: FlagError,
}

/// What `parseCommandLineWorker` makes of the arguments of a command line.
#[derive(Default)]
pub struct CommandLine {
    /// `fileNames`
    pub paths: Vec<Vec<u8>>,
    /// `--project`
    pub project: Option<Vec<u8>>,
    /// `--build`, which need not be the first argument.
    pub build: bool,
    /// The other `options`.
    pub compiler_options: Vec<CompilerOption>,
    /// `errors`, as far as they are about response files: `Request::errors`.
    pub errors: Vec<Diagnostic>,
    /// The other `errors`. A caller may know more flags, and it says so in its own words.
    pub rejected: Vec<RejectedFlag>,
}

/// `shortOptionNames` of the options that are known here. Both names have their dashes.
pub const SHORT_OPTION_NAMES: &[(&[u8], &[u8])] = &[
    (b"-b", b"--build"),
    (b"-d", b"--declaration"),
    (b"-i", b"--incremental"),
    (b"-m", b"--module"),
    (b"-p", b"--project"),
    (b"-q", b"--quiet"),
    (b"-t", b"--target"),
];

/// `getInputOptionName`, and the first half of `GetOptionDeclarationFromName`.
fn get_input_option_name(flag: &[u8]) -> &[u8] {
    let name = flag.strip_prefix(b"-").unwrap_or(flag);
    let name = name.strip_prefix(b"-").unwrap_or(name);
    let mut short_option_names = SHORT_OPTION_NAMES.iter();
    let long = short_option_names.find(|(short, _)| short[1..].eq_ignore_ascii_case(name));
    long.map_or(name, |(_, long)| &long[2..])
}

/// `commandLineParser`
struct CommandLineParser<'a> {
    /// `currentDirectory`, in the checker's path format.
    cwd: &'a [u8],
    /// The response files that are being read, the outermost first.
    response_files: Vec<Vec<u8>>,
    parsed: CommandLine,
}

/// `parseCommandLineWorker`. `cwd` is a native path.
pub fn parse_command_line(args: &[&[u8]], cwd: &[u8]) -> CommandLine {
    let cwd = host::from_native(cwd);
    let mut parser = CommandLineParser {
        cwd: &cwd,
        response_files: Vec::new(),
        parsed: CommandLine::default(),
    };
    parser.parse_strings(args);
    parser.parsed
}

impl CommandLineParser<'_> {
    /// `parseStrings`
    fn parse_strings(&mut self, args: &[&[u8]]) {
        let mut i = 0;
        while let Some(&s) = args.get(i) {
            i += 1;
            match s.first() {
                None => {}
                Some(b'@') => self.parse_response_file(&s[1..]),
                Some(b'-') => i = self.parse_option_value(args, i, s),
                Some(_) => self.parsed.paths.push(s.to_vec()),
            }
        }
    }

    /// `parseResponseFile`
    fn parse_response_file(&mut self, file_name: &[u8]) {
        let file_name = join(self.cwd, file_name);
        // `tryReadFile`. The original reads a file that names itself until its stack ends.
        let text = match self.response_files.contains(&file_name) {
            true => None,
            false => host::read_at(&file_name),
        };
        let Some(text) = text else {
            let cannot_read = global(5083, &[displayed_path(&file_name)]);
            return self.parsed.errors.push(cannot_read);
        };
        let (mut args, mut pos) = (Vec::new(), 0);
        while pos < text.len() {
            while pos < text.len() && text[pos] <= b' ' {
                pos += 1;
            }
            if pos >= text.len() {
                break;
            }
            let start = pos;
            if text[pos] == b'"' {
                pos += 1;
                while pos < text.len() && text[pos] != b'"' {
                    pos += 1;
                }
                if pos < text.len() {
                    args.push(&text[start + 1..pos]);
                    pos += 1;
                } else {
                    let unterminated = global(6045, &[displayed_path(&file_name)]);
                    self.parsed.errors.push(unterminated);
                }
            } else {
                while pos < text.len() && text[pos] > b' ' {
                    pos += 1;
                }
                args.push(&text[start..pos]);
            }
        }
        self.response_files.push(file_name);
        self.parse_strings(&args);
        self.response_files.pop();
    }

    /// `parseOptionValue` of the flag `s`, which precedes `args[i]`. Returns the index of the next
    /// argument. Besides, the value may follow `=`.
    fn parse_option_value(&mut self, args: &[&[u8]], i: usize, s: &[u8]) -> usize {
        let (flag, written) = match strings::index_of_char_usize(s, b'=') {
            Some(at) => (&s[..at], Some(&s[at + 1..])),
            None => (s, None),
        };
        let name = get_input_option_name(flag);
        if name.eq_ignore_ascii_case(b"build") {
            self.parsed.build = true;
            return i;
        }
        // A boolean takes the next argument only if that is a value of it.
        let is_value = |next: &&[u8]| {
            !is_boolean_compiler_option(name) || matches!(*next, b"true" | b"false" | b"null")
        };
        let next = match written {
            Some(_) => None,
            None => args.get(i).copied().filter(is_value),
        };
        let is_taken = match compiler_option_from_flag(name, written.or(next)) {
            Ok(CompilerOption(name, value)) => {
                // What `ParseListTypeOption` makes no list of is the next argument.
                let is_taken = value != Json::Array(Vec::new());
                if name == b"project" {
                    self.parsed.project = value.as_str().map(<[u8]>::to_vec);
                } else {
                    let options = &mut self.parsed.compiler_options;
                    options.retain(|option| option.0 != name);
                    options.push(CompilerOption(name, value));
                }
                is_taken
            }
            Err(error) => {
                let is_known = !matches!(error, FlagError::Unknown);
                self.parsed.rejected.push(RejectedFlag {
                    flag: flag.to_vec(),
                    value: written.or(next).map(<[u8]>::to_vec),
                    error,
                });
                is_known
            }
        };
        i + usize::from(next.is_some() && is_taken)
    }
}

/// The command line options, followed by `noEmit`, since nothing is ever emitted.
fn overriding_options(request: &Request, is_build: bool) -> Vec<(Vec<u8>, Json)> {
    // `convertToOptionsWithAbsolutePaths`: a path on the command line is relative to the working
    // directory, not to the configuration file that it overrides.
    let cwd = host::from_native(request.cwd);
    let absolute = |value: &Json| match value {
        Json::String(path) => Json::String(host::from_argument(&cwd, path)),
        other => other.clone(),
    };
    request
        .compiler_options
        .iter()
        .map(|CompilerOption(name, value)| {
            let value = match value {
                _ if !bun_sema::config_options::is_file_path(name) => value.clone(),
                Json::Array(paths) => Json::Array(paths.iter().map(absolute).collect()),
                path => absolute(path),
            };
            (name.clone(), value)
        })
        .chain((!is_build && !request.build).then(|| (b"noEmit".to_vec(), Json::Bool(true))))
        .collect()
}

/// The version of TypeScript that the type checker is a port of.
pub use bun_sema::resolve::VERSION_C as TYPESCRIPT_VERSION;

/// Where TypeScript's `lib.*.d.ts` files are.
#[derive(Copy, Clone)]
pub enum Libs<'a> {
    /// In the executable.
    Bundled(host::BundledLibs),
    /// In a directory, as a native path.
    Directory(&'a [u8]),
}

#[derive(Clone, Copy)]
pub struct Request<'a> {
    /// The working directory, as a native path.
    pub cwd: &'a [u8],
    /// `--project`: a configuration file, or a directory with a `tsconfig.json` in it.
    pub project: Option<&'a [u8]>,
    /// `-b`: `tscBuildCompilation`, also for a project without `references`. Without `project`, the
    /// one of `paths` is the project, or else the working directory.
    pub build: bool,
    /// `commandLine.Errors`. If there are any, they are the report.
    pub errors: &'a [Diagnostic],
    /// Files and directories to check instead of all the files of the project. The options are
    /// still the project's.
    pub paths: &'a [Vec<u8>],
    /// `paths` are the entry points of what is then run or bundled. JavaScript among them is loaded
    /// for what it imports, whatever `allowJs` says. Its own errors are those of `checkJs`.
    pub are_entry_points: bool,
    /// `Host::script_kind` of those of `paths` whose names do not tell what they are run as.
    pub script_kinds: &'a [(Vec<u8>, ScriptKind)],
    /// `--loader .js:ts`: `Host::extra_file_extensions`, which is also `Host::script_kind` of the
    /// files of the project that have them.
    pub script_kinds_by_extension: &'a [(Vec<u8>, ScriptKind)],
    /// `--conditions` of what is run or bundled, besides `customConditions`.
    pub conditions: &'a [Box<[u8]>],
    /// Compiler options given on the command line. They override the configuration file, also of referenced projects.
    pub compiler_options: &'a [CompilerOption],
    /// `0`: the number of cores.
    pub threads: usize,
    pub libs: Libs<'a>,
    /// Updated during the check, for a caller that displays progress.
    pub progress: Option<&'a Progress>,
    /// Of all loaded files, only those whose path contains this are checked. For investigating one
    /// file of a large project.
    pub only: Option<&'a [u8]>,
    /// The order in which the tasks of a step are started. 1: the largest first. Any other odd
    /// number: by index * `order` (mod 2^32), a fixed permutation. The output does not depend on
    /// it. For tests of that property.
    pub order: u32,
    /// `Published::digest` is computed at every barrier. For tests: it is a function of the program.
    pub digests: bool,
    /// What the tasks cost is measured with this in place of the time. For tuning the plan: with
    /// one thread, the instructions of the process are those of the task.
    pub task_clock: Option<&'a (dyn Fn() -> u64 + Sync)>,
    pub plan_options: PlanOptions,
    /// Nothing is freed after it is checked: for a caller that goes on to query the program. It
    /// uses several times the memory.
    pub retains_everything: bool,
    /// As `tsc` does: if there are parse errors, only those are reported. Otherwise, if the options
    /// are inconsistent, only that is reported. Type errors come only after that.
    pub stops_like_tsc: bool,
    /// Uses TypeScript's wording verbatim where Bun would rephrase it (`bun add -d` for `npm i
    /// --save-dev`). For comparison with TypeScript.
    pub uses_typescript_wording: bool,
    /// Called with the loaded program, before any of it is checked.
    pub loaded: Option<&'a (dyn Fn(&Program) + Sync)>,
    /// Called with it again when all of it is checked.
    pub checked: Option<&'a (dyn Fn(&Program) + Sync)>,
    /// Called for each file right after it is checked, on the thread that checked it, while the types that are local to the file
    /// are still alive. The way to read the type of every expression without `retains_everything`. An invalid task is retried
    /// (`Program::validate`), so this can be called more than once for a file: the last call counts.
    pub after_file: Option<&'a (dyn Fn(&mut bun_sema::check::Checker<'_, '_>, FileId) + Sync)>,
    /// Called with the path and the text of each declaration file that a project of a `tsc -b` run
    /// emits for the projects that reference it.
    /// Nothing is written to disk: this is the way to observe them.
    pub declaration_file_emitted: Option<&'a (dyn Fn(&[u8], &[u8]) + Sync)>,
}

/// A diagnostic, ready to be formatted.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// The file, in the checker's path format. Empty for a configuration error.
    pub path: Vec<u8>,
    /// Offsets in bytes.
    pub start: u32,
    /// Before `start` for a missing value in a JSON file, which decides the order.
    pub end: u32,
    /// `Loc` is `UndefinedTextRange`, which comes before offset 0: `NewCompilerDiagnostic`.
    pub has_undefined_range: bool,
    /// 1-based. Columns count UTF-16 code units, as TypeScript's do.
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub code: u32,
    pub category: Category,
    /// The message. Lines after the first are the elaboration, indented by two spaces per level.
    pub text: Vec<u8>,
    /// `MessageArgs` and `MessageChain`, which `text` is made of.
    pub args: Box<[Box<[u8]>]>,
    pub message_chain: Vec<MessageChain>,
    /// Lines of the file from `source_line` on, without their line terminators: a few before the
    /// error, the lines it spans, a few after.
    pub source: Vec<Vec<u8>>,
    pub source_line: u32,
    /// Related information: `'x' is declared here.` These entries have no related information of
    /// their own.
    pub related: Vec<Diagnostic>,
    /// Which project of a build has reported it, in build order. A file that two of them include
    /// is a file of each, as it is a `SourceFile` of each program.
    pub project: u32,
}

/// A step of a `Plan`, as it ran.
#[derive(Clone)]
pub struct StepReport {
    pub tasks: usize,
    /// Of all its tasks.
    pub files: usize,
    /// Wall time from the start of the first task to the end of the last, and in each of the two
    /// parts of the barrier after it.
    pub in_tasks: Duration,
    pub in_link: Duration,
    pub in_publish: Duration,
    /// How long threads had no task because the step was not over, summed over the threads.
    pub idle: Duration,
    /// The five tasks that took longest: wall time, the number of files, the path of the first file.
    /// With `Request::task_clock`, all of them, and what that clock measured, as nanoseconds.
    pub slowest_tasks: Vec<(Duration, usize, Vec<u8>)>,
    /// `PlanOptions::split_files`: how many of the tasks checked a range ahead, how many of those were not published, and how many
    /// met each obstacle of `Checker::check_statements_ahead`, by bit.
    pub ranges: usize,
    pub ranges_dropped: usize,
    pub ranges_by_obstacle: [usize; 3],
    /// Entries of the tasks' buffers: all that were passed to the barrier, those that were
    /// published, those that lost to a task with a lower index.
    pub entries: Published,
    /// Types, signatures, mappers and component lists that the tasks have created.
    pub records: LinkCounts,
    /// `Checker::generic_relation_entries_not_published`, summed over the tasks.
    pub generic_relation_entries_not_published: u64,
    /// `Finished::foreign_evaluations`, summed over the tasks: by kind of query, in the order of `FOREIGN_EVALUATION_KINDS`. What a
    /// task computed about a source file of another component, because nothing had published it.
    pub foreign_evaluations: [u64; FOREIGN_EVALUATION_KINDS.len()],
}

/// `taskResult.builder`: how much of a `Report` one task of a build has printed.
#[derive(Clone, Copy)]
pub struct TaskOutput {
    pub resolution_trace: usize,
    pub diagnostics: usize,
    pub listed_files: usize,
}

#[derive(Default)]
pub struct Report {
    /// Sorted as TypeScript sorts them: diagnostics without a file first, then by path and
    /// position.
    pub diagnostics: Vec<Diagnostic>,
    /// Files in which a query was abandoned because the stack ran out: errors may be missing.
    pub incomplete: Vec<Vec<u8>>,
    /// Whether `@types/bun` is installed where a checked project would resolve it.
    pub has_bun_types_installed: bool,
    /// By `package.json`.
    pub not_installed: Vec<NotInstalled>,
    /// The scripts of pages that checked files import, which are not in the program of those files.
    scripts_elsewhere: Vec<Vec<u8>>,
    /// `UseCaseSensitiveFileNames`
    pub is_case_sensitive: bool,
    /// `--quiet`, which only a command line can say: no diagnostic is printed.
    pub is_quiet: bool,
    /// `listFiles`: the lines. Under `explainFiles` what `ExplainFiles` prints, else under
    /// `listFiles` or `listFilesOnly` the files of the program, in program order.
    pub listed_files: Vec<Vec<u8>>,
    /// `traceResolution`: the lines, in order.
    pub resolution_trace: Vec<Vec<u8>>,
    /// The tasks of a build, in build order. Theirs are the last of `resolution_trace`, of
    /// `diagnostics` and of `listed_files`, and what a task has printed is printed together.
    pub tasks: Vec<TaskOutput>,
    pub files_loaded: usize,
    pub files_checked: usize,
    /// Those that were to be checked in a program with an error in its syntax, its options or its
    /// global types. As in `tsc`, nothing else is reported for such a program.
    pub files_not_checked: usize,
    /// The steps that ran, in order. See `Plan`.
    pub steps: Vec<StepReport>,
    /// How many projects are reported, if `references` are followed. Otherwise 0.
    pub projects_checked: usize,
    /// The configuration file has `references` and no files of its own, and `--build` was not
    /// given: `tsc` checks nothing then.
    pub follows_references: bool,
    /// `Options::writes_declaration_files`: each source file that a declaration file is emitted
    /// for, and the emitted text.
    pub declaration_files: Vec<(Vec<u8>, Vec<u8>)>,
    pub load_time: Duration,
    pub check_time: Duration,
    /// `load_time`, broken down by phase, in the order of `Phase::ALL`.
    pub load_phases: [Duration; Phase::ALL.len()],
    /// The maximum stack usage of any file, in bytes.
    pub deepest_stack: usize,
}

impl Report {
    /// Whether the exit code is 0: there are no errors, and nothing was left unchecked.
    pub fn is_ok(&self) -> bool {
        self.error_count() == 0 && self.incomplete.is_empty()
    }

    pub fn error_count(&self) -> usize {
        self.diagnostics
            .iter()
            .filter(|d| d.category == Category::Error)
            .count()
    }

    /// Adds the result of checking another project. The diagnostics are left unsorted.
    fn merge(&mut self, other: Report) {
        self.diagnostics.extend(other.diagnostics);
        self.incomplete.extend(other.incomplete);
        self.listed_files.extend(other.listed_files);
        self.scripts_elsewhere.extend(other.scripts_elsewhere);
        self.resolution_trace.extend(other.resolution_trace);
        self.tasks.extend(other.tasks);
        self.has_bun_types_installed |= other.has_bun_types_installed;
        self.files_loaded += other.files_loaded;
        self.files_checked += other.files_checked;
        self.files_not_checked += other.files_not_checked;
        self.steps.extend(other.steps);
        self.check_time += other.check_time;
        for (phase, more) in self.load_phases.iter_mut().zip(other.load_phases) {
            *phase += more;
        }
        self.deepest_stack = self.deepest_stack.max(other.deepest_stack);
    }

    /// `BuildTask.report`
    fn report_task(&mut self, task: Report) {
        self.tasks.push(TaskOutput {
            resolution_trace: task.resolution_trace.len(),
            diagnostics: task.diagnostics.len(),
            listed_files: task.listed_files.len(),
        });
        self.merge(task);
    }
}

/// The number of lines before and after an error that are stored with it. The layout decides how
/// many of them are shown.
const LINES_BEFORE: u32 = 3;
const LINES_AFTER: u32 = 2;

/// The options used when there is no configuration file: those `bun init` writes, without the
/// purely stylistic rules.
fn default_compiler_options() -> Json {
    let text = |value: &[u8]| Json::String(value.to_vec());
    let options: [(&[u8], Json); 12] = [
        (b"lib", Json::Array(vec![text(b"ESNext")])),
        (b"target", text(b"ESNext")),
        (b"module", text(b"Preserve")),
        (b"moduleDetection", text(b"force")),
        (b"jsx", text(b"react-jsx")),
        (b"allowJs", Json::Bool(true)),
        (b"moduleResolution", text(b"bundler")),
        (b"allowImportingTsExtensions", Json::Bool(true)),
        (b"verbatimModuleSyntax", Json::Bool(true)),
        (b"noEmit", Json::Bool(true)),
        (b"strict", Json::Bool(true)),
        (b"skipLibCheck", Json::Bool(true)),
    ];
    Json::Object(options.map(|(name, value)| (name.to_vec(), value)).into())
}

fn global(code: u32, args: &[impl AsRef<[u8]>]) -> Diagnostic {
    new_compiler_diagnostic(code, args.iter().map(|arg| arg.as_ref().into()).collect())
}

/// `NewCompilerDiagnostic`
fn new_compiler_diagnostic(code: u32, args: Box<[Box<[u8]>]>) -> Diagnostic {
    let (category, template) =
        messages::message(code).unwrap_or((Category::Error, "Unknown error."));
    let mut text = Vec::new();
    messages::format(&mut text, template, &args);
    Diagnostic {
        path: Vec::new(),
        start: 0,
        end: 0,
        has_undefined_range: true,
        line: 0,
        column: 0,
        end_line: 0,
        end_column: 0,
        code,
        category,
        text,
        args,
        message_chain: Vec::new(),
        source: Vec::new(),
        source_line: 0,
        related: Vec::new(),
        project: 0,
    }
}

/// `ConfigError::chain` as `MessageChain`: each element is under the last one of the level above.
fn message_chain_of(lines: &[(u32, u32, Vec<Vec<u8>>)]) -> Vec<MessageChain> {
    let mut chain: Vec<MessageChain> = Vec::new();
    for (level, code, args) in lines {
        let mut under = &mut chain;
        for _ in 1..*level {
            if under.is_empty() {
                break;
            }
            under = &mut under.last_mut().unwrap().message_chain;
        }
        under.push(MessageChain {
            code: *code,
            args: args.iter().map(|arg| arg.as_slice().into()).collect(),
            message_chain: Vec::new(),
        });
    }
    chain
}

/// TypeScript's messages say how to install types with npm.
fn in_terms_of_bun(text: Vec<u8>) -> Vec<u8> {
    const NPM: &[u8] = b"npm i --save-dev ";
    if strings::contains(&text, NPM) {
        strings::replace_owned(&text, NPM, b"bun add -d ")
    } else {
        text
    }
}

/// `reported`, located at the bytes `start..end` of the file at `path`, whose text is `text` and whose
/// line starts are `starts`.
fn located(
    path: &[u8],
    text: &[u8],
    starts: &[u32],
    start: u32,
    end: u32,
    reported: Diagnostic,
) -> Diagnostic {
    let (line, character) = line_and_character(text, starts, start);
    let (end_line, end_character) = line_and_character(text, starts, end.max(start));
    let source_line = line.saturating_sub(LINES_BEFORE);
    let last_line = (end_line + LINES_AFTER).min(starts.len() as u32 - 1);
    Diagnostic {
        path: path.to_vec(),
        start,
        end,
        has_undefined_range: false,
        line: line + 1,
        column: character + 1,
        end_line: end_line + 1,
        end_column: end_character + 1,
        source: (source_line..=last_line)
            .map(|l| line_text(text, starts, l))
            .collect(),
        source_line: source_line + 1,
        ..reported
    }
}

/// `GetECMALineAndUTF16CharacterOfPosition`: the 0-based line that contains `offset`, and the number
/// of UTF-16 code units before it on that line.
fn line_and_character(text: &[u8], starts: &[u32], offset: u32) -> (u32, u32) {
    let offset = offset.min(text.len() as u32);
    let line = starts.partition_point(|&s| s <= offset) - 1;
    let before = &text[starts[line] as usize..offset as usize];
    (line as u32, utf16_len(before) as u32)
}

/// `core.UTF16Len`: a byte that is not part of a well-formed sequence is a U+FFFD of its own.
fn utf16_len(text: &[u8]) -> usize {
    let Some(ascii) = strings::first_non_ascii(text) else {
        return text.len();
    };
    let (mut units, mut rest) = (ascii as usize, &text[ascii as usize..]);
    while !rest.is_empty() {
        let (rune, size) = decode_rune(rest);
        units += if rune < 0x10000 { 1 } else { 2 };
        rest = &rest[size..];
    }
    units
}

fn line_text(text: &[u8], starts: &[u32], line: u32) -> Vec<u8> {
    let from = starts[line as usize] as usize;
    let to = starts
        .get(line as usize + 1)
        .map_or(text.len(), |&s| s as usize);
    text[from..to]
        .trim_end_with(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
        .to_vec()
}

/// Runs the check that `request` describes. Each program is freed with its `Session` as soon as it
/// has been checked. If `then` returns, the caches of the threads are dropped too, and the free
/// memory is returned to the system.
pub fn check_then<R>(request: &Request, then: impl FnOnce(Report) -> R) -> R {
    check_provided_then(request, host::Provided::default(), then)
}

/// `check_then`, for a caller that has read some of the files, or that watches them.
pub fn check_provided_then<R>(
    request: &Request,
    provided: host::Provided,
    then: impl FnOnce(Report) -> R,
) -> R {
    let threads = match request.threads {
        0 => usize::from(bun_core::get_thread_count()),
        n => n,
    };
    let cwd = host::from_native(request.cwd);
    let named = (request.project).or_else(|| request.paths.first().map(Vec::as_slice));
    let project = named.map_or_else(|| cwd.clone(), |it| host::from_argument(&cwd, it));
    let mut disk = host::Disk::with_already_read(threads, provided.already_read, &project);
    disk.before_read = provided.before_read;
    disk.scripts_of_page = provided.scripts_of_page;
    if let Libs::Bundled(libs) = request.libs {
        disk.bundled_libs = Some(libs);
    }
    let script_kinds = request.script_kinds.iter().map(|(path, kind)| {
        let path = disk.as_written(&host::from_argument(&cwd, path));
        (to_path(&path, disk.is_case_sensitive()).into_owned(), *kind)
    });
    disk.script_kinds = script_kinds.collect();
    disk.script_kinds_by_extension = request.script_kinds_by_extension.to_vec();
    // Work outside a parallel region runs on this thread.
    let lent = disk.caches.lend();
    let mut report = check_request(&disk, request);
    report.is_case_sensitive = disk.is_case_sensitive();
    report.is_quiet = tristate(request.compiler_options, b"quiet") == Some(true);
    report.not_installed = dependencies_not_installed(&disk, &cwd, &project, &report.diagnostics);
    let result = then(report);
    drop(lent);
    disk.caches.idle.lock().clear();
    // The process continues, so the free pages are returned to the system.
    release_free_pages_of(bun_threading::WorkPool::get());
    if let Some(io_pool) = disk.io_pool() {
        release_free_pages_of(io_pool);
    }
    bun_core::Global::mimalloc_cleanup(true);
    result
}

/// The dependencies of a `package.json` that an error is about and that no `node_modules` has.
pub struct NotInstalled {
    /// The path of the `package.json`.
    pub manifest: Vec<u8>,
    pub names: Vec<Vec<u8>>,
    /// It is the one that `bun install` in the working directory reads.
    pub is_of_working_directory: bool,
}

/// `Report::not_installed`. An error without a file is about the project in `project`.
fn dependencies_not_installed(
    host: &dyn Host,
    cwd: &[u8],
    project: &[u8],
    diagnostics: &[Diagnostic],
) -> Vec<NotInstalled> {
    // The name of a package in each message, and the package that has its types.
    let mut missing: Vec<(&[u8], Vec<u8>)> = Vec::new();
    for reported in diagnostics {
        // What a package needs and does not have is not for `bun install` here to install.
        if strings::contains(&reported.path, b"/node_modules/") {
            continue;
        }
        let before: &[u8] = match reported.code {
            2307 => b"Cannot find module '",
            2688 => b"Cannot find type definition file for '",
            2882 => b"Cannot find module or type declarations for side-effect import of '",
            _ => b"",
        };
        let specifier = match reported.text.strip_prefix(before) {
            // `console`, `Bun`, `bun:test`
            _ if format::is_about_bun_types(reported) => b"bun'",
            Some(specifier) if !before.is_empty() => specifier,
            _ => continue,
        };
        let specifier = &specifier[..strings::index_of_char_usize(specifier, b'\'').unwrap_or(0)];
        if specifier.is_empty()
            || bun_sema::resolve::is_relative(specifier)
            || strings::contains_char(specifier, b':')
        {
            continue;
        }
        // `@scope/name/path` and `name/path`
        let names = if specifier[0] == b'@' { 2 } else { 1 };
        let package: Vec<&[u8]> = strings::split(specifier, b"/").take(names).collect();
        let package = package.join(&b'/');
        let from = match &reported.path[..] {
            b"" => project,
            path => dirname::<Posix>(path),
        };
        if !missing.iter().any(|it| it.0 == from && it.1 == package) {
            missing.push((from, package));
        }
    }
    let arena = Arena::new();
    let nearest = |from| {
        let mut manifests = ancestors(from).map(|dir| join(dir, b"package.json"));
        manifests.find(|path| host.is_file(path))
    };
    let of_working_directory = nearest(cwd);
    let mut found: Vec<NotInstalled> = Vec::new();
    for (from, package) in missing {
        let Some(manifest) = nearest(from) else {
            continue;
        };
        // Yarn Plug'n'Play installs no `node_modules`. Before Yarn 3 the file is `.pnp.js`.
        let is_there = |dir, name: &[u8]| host.is_file(&join(dir, name));
        if ancestors(from).any(|dir| is_there(dir, b".pnp.cjs") || is_there(dir, b".pnp.js")) {
            continue;
        }
        let text = host.read(&manifest);
        let Some(json) = text.and_then(|text| host.parse_package_json(&arena, &text)) else {
            continue;
        };
        // `@scope/name` has its types in `@types/scope__name`.
        let mangled = strings::replace_owned(package.trim_start_with(|c| c == '@'), b"/", b"__");
        for name in [[b"@types/", &mangled[..]].concat(), package] {
            let kinds: [&[u8]; 4] = [
                b"dependencies",
                b"devDependencies",
                b"peerDependencies",
                b"optionalDependencies",
            ];
            let is_listed =
                (kinds.iter()).any(|kind| json.get(kind).is_some_and(|it| it.get(&name).is_some()));
            let in_modules = |dir| host.is_dir(&join(&join(dir, b"node_modules"), &name));
            if !is_listed || ancestors(from).any(in_modules) {
                continue;
            }
            match found.iter_mut().find(|it| it.manifest == manifest) {
                Some(it) if it.names.contains(&name) => {}
                Some(it) => it.names.push(name),
                None => found.push(NotInstalled {
                    is_of_working_directory: of_working_directory.as_ref() == Some(&manifest),
                    manifest: manifest.clone(),
                    names: vec![name],
                }),
            }
        }
    }
    found
}

/// The configuration files that a request has loaded, by path: finding the project of a path loads
/// some, and each is loaded once.
#[derive(Default)]
struct Projects {
    loaded: FxHashMap<Vec<u8>, Result<config::Project, Vec<ConfigError>>>,
    /// `Project::files`, to look a file up in.
    files: FxHashMap<Vec<u8>, FxHashSet<Vec<u8>>>,
    /// An entry point is JavaScript (`Request::are_entry_points`). It is of the project that would
    /// have it under `allowJs`.
    counts_javascript: bool,
}

impl Projects {
    /// `None`: `config` cannot be read.
    fn load(
        &mut self,
        disk: &host::Disk,
        request: &Request,
        config: &[u8],
    ) -> Option<&config::Project> {
        let loaded = (self.loaded.entry(config.to_vec()))
            .or_insert_with(|| Self::load_from_disk(disk, request, config));
        loaded.as_ref().ok()
    }

    /// `load`, and the project is handed over.
    fn take(
        &mut self,
        disk: &host::Disk,
        request: &Request,
        config: &[u8],
    ) -> Result<config::Project, Vec<ConfigError>> {
        let loaded = self.loaded.remove(config);
        loaded.unwrap_or_else(|| Self::load_from_disk(disk, request, config))
    }

    fn load_from_disk(
        disk: &host::Disk,
        request: &Request,
        config: &[u8],
    ) -> Result<config::Project, Vec<ConfigError>> {
        // `bun check` never emits: it is `tsc --noEmit`, which reports no error about an output path.
        // `tsc -b` has no such option.
        config::load_overriding(disk, &Session::new(), config, &|_| {
            overriding_options(request, false)
        })
    }

    /// `config`, or else the first of the projects that it references, directly or not, that has
    /// `file` among its files.
    fn find_project_with(
        &mut self,
        disk: &host::Disk,
        request: &Request,
        config: &[u8],
        file: &[u8],
        seen: &mut Vec<Vec<u8>>,
    ) -> Option<Vec<u8>> {
        let is_case_sensitive = disk.is_case_sensitive();
        let is_seen = |it: &Vec<u8>| is_same_path(it, config, is_case_sensitive);
        if seen.iter().any(is_seen) || !disk.is_file(config) {
            return None;
        }
        seen.push(config.to_vec());
        let is_new = !self.files.contains_key(config);
        let counts_javascript = self.counts_javascript;
        let project = self.load(disk, request, config)?;
        let references: Vec<Vec<u8>> = (project.references.iter())
            .map(|it| config::resolve_config_file_name_of_project_reference(&it.path))
            .collect();
        if is_new {
            let files = match counts_javascript {
                false => project.files.clone(),
                true => {
                    let with_javascript = |has_references: bool| {
                        let mut options = overriding_options(request, has_references);
                        options.push((b"allowJs".to_vec(), Json::Bool(true)));
                        options
                    };
                    config::load_overriding(disk, &Session::new(), config, &with_javascript)
                        .map(|it| it.files)
                        .unwrap_or_default()
                }
            };
            let paths = files.iter().map(|it| to_path(it, is_case_sensitive));
            let paths = paths.map(Cow::into_owned).collect();
            (self.files).insert(config.to_vec(), paths);
        }
        if self.files[config].contains(&*to_path(file, is_case_sensitive)) {
            return Some(config.to_vec());
        }
        (references.iter()).find_map(|it| self.find_project_with(disk, request, it, file, seen))
    }

    /// Adds the configuration file and the files of `config` and of the projects that it references,
    /// directly or not. `seen`: the configuration files.
    fn files_of_graph(
        &mut self,
        disk: &host::Disk,
        request: &Request,
        config: &[u8],
        seen: &mut Vec<Vec<u8>>,
        files: &mut Vec<Vec<u8>>,
    ) {
        let is_seen = |it: &Vec<u8>| is_same_path(it, config, disk.is_case_sensitive());
        if seen.iter().any(is_seen) || !disk.is_file(config) {
            return;
        }
        seen.push(config.to_vec());
        let Some(project) = self.load(disk, request, config) else {
            return;
        };
        files.extend(project.files.iter().cloned());
        let references: Vec<Vec<u8>> = (project.references.iter())
            .map(|it| config::resolve_config_file_name_of_project_reference(&it.path))
            .collect();
        for it in &references {
            self.files_of_graph(disk, request, it, seen, files);
        }
    }

    /// The project in which the file at `path` is checked, as the language service chooses it for
    /// an open file (`findDefaultConfiguredProject`): that of the nearest configuration file, or
    /// else the first of the projects it references that has the file, as under a solution.
    /// `Err`: none of them has it. The nearest configuration file is the best there is, unless it
    /// is a solution, which has no files of its own and no options for them.
    fn owner_of(
        &mut self,
        disk: &host::Disk,
        request: &Request,
        nearest: Option<Vec<u8>>,
        path: &[u8],
    ) -> Result<Option<Vec<u8>>, Option<Vec<u8>>> {
        let Some(nearest) = nearest else {
            return Ok(None);
        };
        if let Some(owner) = self.find_project_with(disk, request, &nearest, path, &mut Vec::new())
        {
            return Ok(Some(owner));
        }
        let project = self.load(disk, request, &nearest);
        let is_solution =
            project.is_some_and(|it| it.files.is_empty() && !it.references.is_empty());
        Err((!is_solution).then_some(nearest))
    }
}

/// The project checked where there is no configuration file: `files` and what they import, as in
/// `tsc a.ts`. Without `files`, everything below `cwd`.
fn project_without_config(
    disk: &host::Disk,
    request: &Request,
    cwd: &[u8],
    files: &[Vec<u8>],
) -> config::Project {
    let mut options = default_compiler_options();
    if let Json::Object(options) = &mut options {
        let specified = request.compiler_options.iter().cloned();
        let specified = specified.map(|CompilerOption(name, value)| (name, value));
        config::merge_compiler_options(options, specified.collect(), &[]);
    }
    config::without_config(disk, cwd, options, files.to_vec())
}

/// The directories below `top` with a configuration file of their own, as the paths of those files.
fn nested_configs(disk: &host::Disk, top: &[u8]) -> Vec<Vec<u8>> {
    let (mut found, mut pending) = (Vec::new(), vec![top.to_vec()]);
    // By real path: a link can lead back up.
    let mut visited = FxHashSet::default();
    while let Some(dir) = pending.pop() {
        if !visited.insert(disk.realpath(&dir)) {
            continue;
        }
        if dir != top {
            let configs = [b"tsconfig.json", b"jsconfig.json"].map(|name| inside(&dir, name));
            found.extend(configs.into_iter().find(|config| disk.is_file(config)));
        }
        for name in disk.entries(&dir).1 {
            // What no project includes unless it says so.
            let is_skipped = name.starts_with(b".")
                || matches!(
                    &name[..],
                    b"node_modules" | b"bower_components" | b"jspm_packages"
                );
            if !is_skipped {
                pending.push(inside(&dir, &name));
            }
        }
    }
    found.sort_unstable();
    found
}

/// For a directory without a configuration file at or above it, and `below` under it.
fn no_project_here(cwd: &[u8], below: &[Vec<u8>]) -> Diagnostic {
    const NAMED: usize = 8;
    let relative =
        |config: &'_ [u8]| -> Vec<u8> { get_relative_path_from_directory(cwd, config, true) };
    let mut text = [
        b"No tsconfig.json in '",
        &*displayed_path(cwd),
        b"' or above it. Below it:",
    ]
    .concat();
    for config in below.iter().take(NAMED) {
        text.extend_from_slice(b"\n  ");
        text.extend_from_slice(&relative(config));
    }
    if below.len() > NAMED {
        let more = below.len() - NAMED;
        let _ = std::io::Write::write_fmt(&mut text, format_args!("\n  and {more} more"));
    }
    text.extend_from_slice(b"\nTo check one: bun check -p ");
    text.extend_from_slice(&relative(&below[0]));
    text.extend_from_slice(b"\nTo check everything below this directory: bun check .");
    Diagnostic {
        text,
        code: 0,
        ..global(18003, &[""; 0])
    }
}

fn check_request(disk: &host::Disk, request: &Request) -> Report {
    // `ParseBuildCommandLine`: `Projects` is `fileNames`, or else `.`.
    let request = &match (request.build, request.project, request.paths) {
        (true, None, []) => Request {
            project: Some(b"."),
            ..*request
        },
        (true, None, [project]) => Request {
            project: Some(project),
            paths: &[],
            ..*request
        },
        _ => *request,
    };
    let mut report = check_paths(disk, request);
    // Each is checked in its own project, like a file that is named, and once.
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    loop {
        let mut scripts = std::mem::take(&mut report.scripts_elsewhere);
        scripts.retain(|script| seen.insert(script.clone()));
        if scripts.is_empty() {
            return report;
        }
        // They are run, whatever has found them: see `Request::are_entry_points`.
        let of_pages = Request {
            paths: &scripts,
            are_entry_points: true,
            ..*request
        };
        report.merge(check_paths(disk, &of_pages));
        sort_as_one_project(&mut report);
    }
}

fn check_paths(disk: &host::Disk, request: &Request) -> Report {
    let started = Instant::now();
    let cwd = host::from_native(request.cwd);
    let mut report = Report::default();
    // `tscCompilation`, `tscBuildCompilation`
    if !request.errors.is_empty() {
        report.diagnostics.extend_from_slice(request.errors);
        return report;
    }

    // Report missing paths (TS6053) before loading the config file or any source file.
    let is_case_sensitive = disk.is_case_sensitive();
    let is_same = |a: &[u8], b: &[u8]| is_same_path(a, b, is_case_sensitive);
    let (mut paths, missing): (Vec<_>, Vec<_>) = (request.paths.iter())
        .map(|path| disk.as_written(&host::from_argument(&cwd, path)))
        .partition(|path| disk.is_dir(path) || disk.is_file(path));
    let not_found = (missing.iter()).map(|path| global(6053, &[displayed_path(path)]));
    report.diagnostics.extend(not_found);
    if paths.is_empty() && !missing.is_empty() {
        return report;
    }
    let project = request.project;
    let explicit = match project.map(|project| disk.as_written(&host::from_argument(&cwd, project)))
    {
        // `ResolvedProjectPaths`, and `upToDateStatusTypeConfigFileNotFound`.
        Some(path) if request.build => {
            let config = config::resolve_config_file_name_of_project_reference(&path);
            if !disk.is_file(&config) {
                let not_found = global(6053, &[displayed_path(&config)]);
                report.diagnostics.push(not_found);
                return report;
            }
            Some(config)
        }
        Some(path) => {
            if disk.is_dir(&path) {
                let inside = join(&path, b"tsconfig.json");
                if !disk.is_file(&inside) {
                    let not_found = global(5081, &[displayed_path(&inside)]);
                    report.diagnostics.push(not_found);
                    return report;
                }
                Some(inside)
            } else if disk.is_file(&path) {
                Some(path)
            } else {
                report
                    .diagnostics
                    .push(global(5058, &[displayed_path(&path)]));
                return report;
            }
        }
        None => None,
    };
    // `--project`, or else the configuration file nearest to a directory, or else nearest to the
    // working directory.
    let config_in = |dir: &[u8]| {
        let nearest = || config::find_config(disk, dir).or_else(|| config::find_config(disk, &cwd));
        explicit.clone().or_else(nearest)
    };
    // The project that `tsc` compiles in a directory. Where it finds none, the nearest there is.
    let project_in = |dir: &[u8]| {
        let found = || config::find_config_file(disk, dir).or_else(|| config_in(dir));
        explicit.clone().or_else(found)
    };
    let mut projects = Projects {
        // By its name, as `include` finds it.
        counts_javascript: request.are_entry_points && paths.iter().any(|it| is_javascript(it)),
        ..Default::default()
    };
    if paths.is_empty() {
        match project_in(&cwd) {
            Some(config) => {
                let of = OfProject {
                    config: Some(&config),
                    named: None,
                    elsewhere: None,
                };
                return check_project_of(disk, request, &mut projects, of, report, started);
            }
            None => {
                // `tsc` prints its help. Which of them is meant is not for a guess: they are
                // fixtures and examples as often as packages. Before something runs (`--check`),
                // a list of commands that run nothing is of no use.
                let below = match request.are_entry_points {
                    true => Vec::new(),
                    false => nested_configs(disk, &cwd),
                };
                if !below.is_empty() {
                    report.diagnostics.push(no_project_here(&cwd, &below));
                    return report;
                }
                // Whatever is here, with the default options.
                paths.push(cwd.clone())
            }
        }
    }

    // Each file is checked in its own project, once.
    let mut by_project: Vec<(Option<Vec<u8>>, Extent, Vec<Vec<u8>>)> = Vec::new();
    let mut add = |owner: Option<Vec<u8>>, extent: Extent, file: Vec<u8>| match by_project
        .iter_mut()
        .find(|it| {
            it.1 == extent
                && match (&it.0, &owner) {
                    (Some(a), Some(b)) => is_same(a, b),
                    (a, b) => a.is_none() && b.is_none(),
                }
        }) {
        Some(project) => project.2.push(file),
        None => by_project.push((owner, extent, vec![file])),
    };
    for path in &paths {
        if !disk.is_dir(path) {
            let nearest = config_in(dirname::<Posix>(path));
            let owner = projects.owner_of(disk, request, nearest, path);
            let owner = owner.unwrap_or_else(|nearest| nearest);
            add(owner, Extent::Project, path.clone());
            continue;
        }
        // The directory stands for the part of the project that is in it: of the project that is
        // checked from there without an argument, so that `bun check .` is `bun check`.
        // The projects know their files. A configuration file there is checked too.
        let is_in_directory = |file: &Vec<u8>| contains_path(path, file, is_case_sensitive);
        if let Some(config) = project_in(path) {
            let (mut configs, mut files) = (Vec::new(), Vec::new());
            projects.files_of_graph(disk, request, &config, &mut configs, &mut files);
            files.retain(is_in_directory);
            if !files.is_empty() {
                files.extend(configs.into_iter().filter(is_in_directory));
                files.sort_by_cached_key(|it| to_path(it, is_case_sensitive).into_owned());
                files.dedup_by(|a, b| is_same(a, b));
                (files.into_iter()).for_each(|file| add(Some(config.clone()), Extent::Graph, file));
                continue;
            }
        }
        // It has nothing there, as in `bun check scripts`, or there is none. Each configuration
        // file at, above or below the directory has a say about the files that are nearest to it.
        let below = match explicit {
            Some(_) => Vec::new(),
            None => nested_configs(disk, path),
        };
        for config in std::iter::once(config_in(path)).chain(below.into_iter().map(Some)) {
            let is_below =
                |dir: &&[u8]| !is_same(dir, path) && contains_path(path, dir, is_case_sensitive);
            let top = (config.as_deref().map(dirname::<Posix>))
                .filter(is_below)
                .unwrap_or(path);
            // One that cannot be read excludes nothing. `check_project_of` reports it.
            let project = (config.as_ref()).and_then(|it| projects.load(disk, request, it));
            let files = match project {
                Some(project) => project.files_under(disk, top),
                None => project_without_config(disk, request, &cwd, &[]).files_under(disk, top),
            };
            let (mut included, mut others) = (Vec::new(), Vec::new());
            for file in files {
                if config_in(dirname::<Posix>(&file)) == config {
                    match projects.owner_of(disk, request, config.clone(), &file) {
                        Ok(owner) => included.push((owner, file)),
                        Err(nearest) => others.push((nearest, file)),
                    }
                }
            }
            // The directory stands for the files that the project has in it. If it has none there,
            // as in `bun check scripts`, for all that it does not exclude.
            let files = if included.is_empty() {
                others
            } else {
                included
            };
            (files.into_iter()).for_each(|(owner, file)| add(owner, Extent::Project, file));
        }
    }
    // A file that is named besides a directory that has it.
    let in_directories: FxHashSet<Vec<u8>> = (by_project.iter())
        .filter(|it| it.1 == Extent::Graph)
        .flat_map(|it| it.2.iter())
        .map(|file| to_path(file, is_case_sensitive).into_owned())
        .collect();
    for (_, extent, files) in &mut by_project {
        if *extent == Extent::Project {
            files.retain(|it| !in_directories.contains(&*to_path(it, is_case_sensitive)));
        }
    }
    by_project.retain(|it| !it.2.is_empty());
    if by_project.is_empty() {
        report.diagnostics.push(Diagnostic {
            text: [
                b"Nothing to check: no TypeScript files in '",
                &displayed_path(&paths[0])[..],
                b"'",
            ]
            .concat(),
            code: 0,
            ..global(18003, &[""; 0])
        });
        return report;
    }
    let is_one = by_project.len() == 1;
    let paths_of = |files: &'_ [Vec<u8>]| -> Vec<Vec<u8>> {
        let paths = files.iter().map(|it| to_path(it, is_case_sensitive));
        paths.map(Cow::into_owned).collect()
    };
    let paths_by_project: Vec<Vec<Vec<u8>>> = by_project.iter().map(|it| paths_of(&it.2)).collect();
    let all: FxHashSet<&[u8]> = (paths_by_project.iter().flatten())
        .map(Vec::as_slice)
        .collect();
    for ((config, extent, files), paths) in by_project.iter().zip(&paths_by_project) {
        let own: FxHashSet<&[u8]> = paths.iter().map(Vec::as_slice).collect();
        let elsewhere: FxHashSet<&[u8]> = all.difference(&own).copied().collect();
        let of = OfProject {
            config: config.as_deref(),
            named: Some((*extent, files.as_slice())),
            elsewhere: (!is_one).then_some(&elsewhere),
        };
        let (so_far, began) = (Report::default(), Instant::now());
        let checked = check_project_of(disk, request, &mut projects, of, so_far, began);
        report.projects_checked += checked.projects_checked.max(usize::from(!is_one));
        report.merge(checked);
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    if !is_one {
        sort_as_one_project(&mut report);
    }
    report
}

/// Where the files are that a check is limited to.
#[derive(Clone, Copy, PartialEq)]
enum Extent {
    /// In the project, or they are added to it. What it references is built whole.
    Project,
    /// In the project and in those that it references, directly or not: files and configuration
    /// files of theirs. Of these projects, one without such a file is left out, unless one with such
    /// a file references it, and one with nothing but such files is checked whole.
    Graph,
}

/// What `check_project_of` checks.
#[derive(Clone, Copy)]
struct OfProject<'a> {
    /// `None`: there is no configuration file.
    config: Option<&'a [u8]>,
    /// `None`: all of its files.
    named: Option<(Extent, &'a [Vec<u8>])>,
    /// The files that are checked in another project, by `tspath.Path`. This one may import them.
    elsewhere: Option<&'a FxHashSet<&'a [u8]>>,
}

fn check_project_of(
    disk: &host::Disk,
    request: &Request,
    projects: &mut Projects,
    of: OfProject<'_>,
    mut report: Report,
    started: Instant,
) -> Report {
    let mut project = match of.config {
        Some(config) => match projects.take(disk, request, config) {
            Ok(project) => project,
            // `tscCompilation`: "these are unrecoverable errors--exit to report them as
            // diagnostics". To a build, `upToDateStatusTypeConfigFileNotFound`.
            Err(errors) => {
                let errors = errors.iter().map(|it| of_config_error(disk, config, it));
                match request.build {
                    true => report
                        .diagnostics
                        .push(global(6053, &[displayed_path(config)])),
                    false => report.diagnostics.extend(errors),
                }
                report.load_time = started.elapsed();
                return report;
            }
        },
        None => {
            let cwd = host::from_native(request.cwd);
            let files = of.named.map(|it| it.1).unwrap_or_default();
            project_without_config(disk, request, &cwd, files)
        }
    };
    let is_case_sensitive = disk.is_case_sensitive();
    let named = of.named.map(|(extent, named)| {
        if extent == Extent::Project {
            // Load the whole project even when only some files are checked. Global declarations and module augmentations from any file
            // affect every other file, so a file must produce the same errors with and without path arguments.
            let files = project.files.iter();
            let mut seen: FxHashSet<Cow<[u8]>> =
                files.map(|it| to_path(it, is_case_sensitive)).collect();
            let more: Vec<Vec<u8>> = (named.iter())
                .filter(|root| seen.insert(to_path(root, is_case_sensitive)))
                .cloned()
                .collect();
            if !more.is_empty() {
                project.options.own_roots = Some(project.files.len());
            }
            project.files.extend(more);
            project.options.files.clone_from(&project.files);
            // An empty file set in the config file is not an error when path arguments provide the roots.
            project
                .errors
                .retain(|e| e.code != 18003 && e.code != 18002);
        }
        // From here on they are only looked for.
        let named = named.iter().map(|it| to_path(it, is_case_sensitive));
        let mut named: Vec<Vec<u8>> = named.map(Cow::into_owned).collect();
        named.sort_unstable();
        (extent, named)
    });
    let named = (named.as_ref()).map(|(extent, files)| (*extent, files.as_slice()));
    // After the configuration file is read: what it includes and whether its options agree with each
    // other is as `bun check` finds it.
    let names_javascript =
        |it: (Extent, &[Vec<u8>])| it.1.iter().any(|file| is_javascript_file(disk, file));
    if request.are_entry_points && named.is_some_and(names_javascript) {
        project.options.allow_js = true;
    }
    if request.build || !project.references.is_empty() {
        check_with_references(disk, project, request, report, started, named, of.elsewhere)
    } else {
        // All of its files: the project, with what no file imports.
        let is_whole = |(extent, named): &(Extent, &[Vec<u8>])| {
            let is_named = |it: &Vec<u8>| is_among(named, &to_path(it, is_case_sensitive));
            *extent == Extent::Graph && project.files.iter().all(is_named)
        };
        let named = named.filter(|it| !is_whole(it)).map(|it| it.1);
        check_named_files(
            disk,
            project,
            request,
            report,
            started,
            named,
            of.elsewhere,
            None,
        )
    }
}

/// `named` is sorted. It has, and `file` is, a `tspath.Path`.
fn is_among(named: &[Vec<u8>], file: &[u8]) -> bool {
    named.binary_search_by(|it| it.as_slice().cmp(file)).is_ok()
}

struct ReferencedProject {
    project: config::Project,
    /// `upStream`, as indices into the list of projects: not a reference that closes a cycle.
    up_stream: Vec<usize>,
}

/// `Orchestrator`, limited to `GenerateGraph`.
struct Graph<'h> {
    host: &'h dyn Host,
    /// For `config::load_overriding`.
    session: &'h Session,
    overrides: Vec<(Vec<u8>, Json)>,
    /// `tasks`, until `setup_build_task` takes them: `config` and `resolved`, by the `tspath.Path`
    /// of the configuration file.
    tasks: FxHashMap<Vec<u8>, (Vec<u8>, Option<config::Project>)>,
    /// `order`: dependencies first.
    projects: Vec<ReferencedProject>,
    /// Keyed by the `tspath.Path` of a configuration file, each of which is loaded once. `completed`: its index in
    /// `projects`. `analyzing`: `None`.
    index_of: FxHashMap<Vec<u8>, Option<usize>>,
    circularity_stack: Vec<Vec<u8>>,
    /// `errors`: TS6202. If there is one, nothing is built.
    errors: Vec<Diagnostic>,
    /// `upToDateStatusTypeConfigFileNotFound`, which a task reports when it runs: with the number of
    /// `projects` before it in the order.
    not_found: Vec<(usize, Diagnostic)>,
}

impl Graph<'_> {
    /// `createBuildTasks`: a configuration file is loaded once, by the name in the task that runs
    /// first. The tasks of a `singleThreadedWorkGroup` run last in, first out.
    fn create_build_tasks(&mut self, root: config::Project) {
        let key = |name: &[u8]| to_path(name, self.host.is_case_sensitive()).into_owned();
        let referenced = |project: &config::Project| -> Vec<Vec<u8>> {
            let references = project.references.iter();
            let name = |it: &config::ProjectReference| {
                config::resolve_config_file_name_of_project_reference(&it.path)
            };
            references.map(name).collect()
        };
        let mut queued = referenced(&root);
        let config = root.config_path.clone();
        self.tasks.insert(key(&config), (config, Some(root)));
        while let Some(config) = queued.pop() {
            let path = key(&config);
            if self.tasks.contains_key(&path) {
                continue;
            }
            let over = |_: bool| self.overrides.clone();
            let resolved = match self.host.is_file(&config) {
                true => config::load_overriding(self.host, self.session, &config, &over).ok(),
                false => None,
            };
            if let Some(project) = &resolved {
                queued.extend(referenced(project));
            }
            self.tasks.insert(path, (config, resolved));
        }
    }

    /// `setupBuildTask`: the index of the task in `projects`. `None`: nothing has to wait for it.
    fn setup_build_task(&mut self, config_name: &[u8], in_circular_context: bool) -> Option<usize> {
        let path = to_path(config_name, self.host.is_case_sensitive()).into_owned();
        if let Some(&index) = self.index_of.get(&path) {
            // `analyzing`
            if index.is_none() && !in_circular_context {
                let stack = self.circularity_stack.join(&b'\n');
                self.errors.push(global(6202, &[stack]));
            }
            return index;
        }
        // Not there: it is `completed`, and its configuration file was not found.
        let (config, resolved) = self.tasks.remove(&path)?;
        let Some(project) = resolved else {
            let before = self.projects.len();
            let not_found = global(6053, &[displayed_path(&config)]);
            self.not_found.push((before, not_found));
            return None;
        };
        self.index_of.insert(path.clone(), None);
        let shown = displayed_path(config_name).into_owned();
        self.circularity_stack.push(shown);
        let mut up_stream = Vec::new();
        for reference in &project.references {
            let sub_reference =
                config::resolve_config_file_name_of_project_reference(&reference.path);
            let in_circular_context = in_circular_context || reference.circular;
            up_stream.extend(self.setup_build_task(&sub_reference, in_circular_context));
        }
        self.circularity_stack.pop();
        let index = self.projects.len();
        self.index_of.insert(path, Some(index));
        self.projects.push(ReferencedProject { project, up_stream });
        Some(index)
    }
}

/// The files that the projects of a `tsc -b` run are going to emit, and the directories that
/// contain them with all their ancestors: by which projects. Keyed by `tspath.Path`.
#[derive(Default)]
struct Expected {
    files: FxHashMap<Vec<u8>, Vec<usize>>,
    directories: FxHashMap<Vec<u8>, Vec<usize>>,
}

impl Expected {
    fn add(&mut self, path: Vec<u8>, project: usize) {
        let mut directory = dirname::<Posix>(&path);
        while directory.len() > 1 {
            let projects = self.directories.entry(directory.to_vec()).or_default();
            if projects.last() == Some(&project) {
                break;
            }
            projects.push(project);
            directory = dirname::<Posix>(directory);
        }
        self.files.entry(path).or_default().push(project);
    }
}

/// The file system as a `tsc -b` run leaves it for one project: it also contains what the projects
/// before it in the build order have emitted, whether it references them or not.
/// Nothing is written to disk.
struct WithOutputs<'h> {
    disk: &'h dyn Host,
    /// By `tspath.Path`, like `directories`: the file system finds a file however its name is
    /// spelled, if it ignores case. A JavaScript file is empty: nothing prints its text.
    files: FxHashMap<Vec<u8>, Arc<Vec<u8>>>,
    /// The directories that contain the files, and all their ancestors.
    directories: FxHashSet<Vec<u8>>,
    expected: &'h Expected,
    /// By project: it comes before this one and is not built yet, so `files` lacks what it emits.
    is_pending: Vec<bool>,
    /// Those of them whose output this project has asked for. What it was answered is wrong.
    awaited: Guarded<Vec<usize>>,
    /// `Host::take_unreadable`, for this project: others are read through `disk` at the same time.
    unreadable: Guarded<Vec<Vec<u8>>>,
}

impl WithOutputs<'_> {
    fn add(&mut self, path: Vec<u8>, text: Arc<Vec<u8>>) {
        let mut directory = dirname::<Posix>(&path);
        while directory.len() > 1 && self.directories.insert(directory.to_vec()) {
            directory = dirname::<Posix>(directory);
        }
        self.files.insert(path, text);
    }

    /// `path` with symlinks resolved in the longest prefix that exists on disk: a workspace package
    /// is reached through a symlink in a `node_modules`, and its emitted files are keyed by its
    /// real path.
    fn through_links(&self, path: &[u8]) -> Option<Vec<u8>> {
        if self.files.is_empty() && !self.is_pending.contains(&true)
            || !strings::contains(path, b"/node_modules/")
        {
            return None;
        }
        let on_disk = ancestors(dirname::<Posix>(path))
            .find(|dir| dir.len() <= 1 || self.disk.is_dir(dir))?;
        let real = self.disk.realpath(on_disk);
        (real != on_disk).then(|| [&real[..], &path[on_disk.len()..]].concat())
    }

    /// `projects` emit what was asked for.
    fn wait_for(&self, projects: Option<&Vec<usize>>) {
        let pending = projects.into_iter().flatten();
        let mut pending = pending.filter(|&&it| self.is_pending[it]).peekable();
        if pending.peek().is_some() {
            self.awaited.lock().extend(pending);
        }
    }

    fn file(&self, name: &[u8]) -> Option<&Vec<u8>> {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(name, self.disk.is_case_sensitive(), &mut buffer[..]);
        self.wait_for(self.expected.files.get(&*path));
        self.files.get(&*path).map(|text| &**text)
    }

    fn has_directory(&self, name: &[u8]) -> bool {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(name, self.disk.is_case_sensitive(), &mut buffer[..]);
        self.wait_for(self.expected.directories.get(&*path));
        self.directories.contains(&*path)
    }

    fn written(&self, path: &[u8]) -> Option<&Vec<u8>> {
        let written = self.file(path);
        written.or_else(|| self.file(&self.through_links(path)?))
    }
}

impl Host for WithOutputs<'_> {
    fn spent(&self, phase: Phase, time: Duration) {
        self.disk.spent(phase, time);
    }
    fn times(&self) -> [Duration; Phase::ALL.len()] {
        self.disk.times()
    }
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        match self.written(path) {
            Some(written) => Some(Cow::Owned(written.clone())),
            None => self.disk.read(path),
        }
    }
    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        match self.written(path) {
            Some(written) => Cow::Owned(written.clone()),
            None => self.disk.read(path).unwrap_or_else(|| {
                self.unreadable.lock().push(path.to_vec());
                Cow::default()
            }),
        }
    }
    fn take_unreadable(&self) -> Vec<Vec<u8>> {
        std::mem::take(&mut *self.unreadable.lock())
    }
    fn is_file(&self, path: &[u8]) -> bool {
        self.disk.is_file(path) || self.written(path).is_some()
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        self.disk.is_dir(path)
            || self.has_directory(path)
            || (self.through_links(path)).is_some_and(|real| self.has_directory(&real))
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        match self.through_links(path) {
            Some(real) if self.file(&real).is_some() || self.has_directory(&real) => real,
            _ => self.disk.realpath(path),
        }
    }
    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        self.disk.list_dir(path)
    }
    fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        self.disk.entries(path)
    }
    fn is_case_sensitive(&self) -> bool {
        self.disk.is_case_sensitive()
    }
    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        self.disk.script_kind(path)
    }
    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        self.disk.extra_file_extensions()
    }
    fn scripts_of_page(&self, page: &[u8]) -> Vec<Vec<u8>> {
        self.disk.scripts_of_page(page)
    }
    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        text: &[u8],
        atoms: &bun_sema::atom::Interner<'s>,
        options: &bun_sema::resolve::Options,
    ) -> bun_sema::hir::File<'s> {
        self.disk.parse(arena, path, text, atoms, options)
    }
    fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        self.disk.parse_package_json(arena, text)
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        self.disk.parallel(count, work);
    }
    fn loaded(&self) {
        self.disk.loaded();
    }
    fn threads(&self) -> usize {
        self.disk.threads()
    }
    fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
        self.disk.io_pool()
    }
}

/// Checks what `tsc -b` checks: `root` and every project it references, each with its own options.
/// Nothing is written: a project reads the declaration files of the projects it references from
/// memory. Without `Request::build` only `root` is reported, as by `tsc`, which reads the
/// declaration files that an earlier build has written. If `root` has no files of its own, `tsc`
/// checks nothing: then all are reported (`Report::follows_references`).
/// `named`: see `check_named_files` and `Extent`.
/// `elsewhere`: see `OfProject`.
fn check_with_references(
    host: &dyn Host,
    root: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<(Extent, &[Vec<u8>])>,
    elsewhere: Option<&FxHashSet<&[u8]>>,
) -> Report {
    let is_case_sensitive = host.is_case_sensitive();
    let root_config_path = root.config_path.clone();
    let follows_references = !request.build && root.files.is_empty();
    let reports_references =
        request.build || follows_references || matches!(named, Some((Extent::Graph, _)));
    let configuration = Session::new();
    let mut graph = Graph {
        host,
        session: &configuration,
        // The command line is for the projects that are reported: that of a plain `tsc`, for the
        // one that it is given.
        overrides: match reports_references {
            true => overriding_options(request, true),
            false => Vec::new(),
        },
        tasks: FxHashMap::default(),
        projects: Vec::new(),
        index_of: FxHashMap::default(),
        circularity_stack: Vec::new(),
        errors: Vec::new(),
        not_found: Vec::new(),
    };
    graph.create_build_tasks(root);
    graph.setup_build_task(&root_config_path, false);
    let Graph {
        projects,
        index_of,
        mut errors,
        not_found,
        ..
    } = graph;
    // `buildOrClean`: "Circularity errors prevent any project from being built".
    if !errors.is_empty() {
        report.diagnostics.append(&mut errors);
        report.load_time = started.elapsed();
        return report;
    }
    let resolved = |path: &[u8]| {
        let path = to_path(path, is_case_sensitive);
        Some(&projects[(*index_of.get(&*path)?)?].project)
    };
    let root_index =
        (index_of.get(&*to_path(&root_config_path, is_case_sensitive))).and_then(|it| *it);
    let about_references: Vec<Vec<ConfigError>> = (projects.iter())
        .map(|p| {
            (verify_project_references(&p.project, &resolved).iter())
                .map(|(config_path, problem)| {
                    ConfigError::of_problem(host, &configuration, config_path, problem)
                })
                .collect()
        })
        .collect();
    drop(configuration);
    // A file that belongs to a referenced project is checked there, with that project's options.
    let roots: Vec<Vec<Vec<u8>>> = projects.iter().map(|p| p.project.files.clone()).collect();
    let root_paths: Vec<Vec<Vec<u8>>> = (roots.iter())
        .map(|roots| roots.iter().map(|it| to_path(it, is_case_sensitive)))
        .map(|paths| paths.map(Cow::into_owned).collect())
        .collect();
    // The output directory of each project's declaration files, and the source directory it
    // mirrors. `None`: next to the sources.
    let outputs: Vec<Option<(Vec<u8>, Vec<u8>)>> = projects
        .iter()
        .map(|p| {
            let options = &p.project.options;
            let output_dir = [&options.declaration_dir, &options.out_dir]
                .into_iter()
                .find(|dir| !dir.is_empty())?;
            let root_dir = if options.root_dir.is_empty() {
                dirname::<Posix>(&p.project.config_path)
            } else {
                options.root_dir.as_slice()
            };
            Some((output_dir.clone(), root_dir.to_vec()))
        })
        .collect();
    let up_stream: Vec<Vec<usize>> = projects.iter().map(|p| p.up_stream.clone()).collect();
    // `ResolvedProjectReferencePaths`: what the program of a project is made from. One that closes a
    // cycle is among them.
    let references: Vec<Vec<usize>> = (projects.iter())
        .map(|p| {
            let names = (p.project.references.iter())
                .map(|it| config::resolve_config_file_name_of_project_reference(&it.path));
            names
                .filter_map(|name| *index_of.get(&*to_path(&name, is_case_sensitive))?)
                .collect()
        })
        .collect();
    let options_of_projects: Vec<Options> =
        projects.iter().map(|p| p.project.options.clone()).collect();
    let is_read_later = |index: usize| references.iter().any(|of| of.contains(&index));
    let count = projects.len();
    // See `Extent::Graph`.
    let has_named: Vec<bool> = (projects.iter())
        .map(|it| std::iter::once(&it.project.config_path).chain(&it.project.files))
        .map(|mut files| match named {
            Some((Extent::Graph, named)) => {
                files.any(|file| is_among(named, &to_path(file, is_case_sensitive)))
            }
            _ => true,
        })
        .collect();
    let mut is_left_out: Vec<bool> = has_named.iter().map(|has| !has).collect();
    let mut pending: Vec<usize> = (0..count).filter(|&index| has_named[index]).collect();
    while let Some(index) = pending.pop() {
        let referenced = references[index].iter();
        pending.extend(referenced.filter(|&&it| std::mem::replace(&mut is_left_out[it], false)));
    }
    let is_read_by_a_program = |index: usize| {
        (0..count)
            .any(|by| !is_left_out[by] && !roots[by].is_empty() && references[by].contains(&index))
    };
    // Under `noEmit` nothing is emitted, and a `.d.ts` next to a `.js` source would be resolved
    // in its place.
    let writes_declaration_files =
        |index: usize| is_read_later(index) && !options_of_projects[index].no_emit;
    let output_of = |index: usize| {
        let output = outputs[index].as_ref();
        output.map(|it| (it.0.as_slice(), it.1.as_slice(), is_case_sensitive))
    };
    // Not `OutputDts`, for a source outside the common source directory.
    let declaration_file_path = |index: usize, source: &[u8]| {
        let options = &options_of_projects[index];
        let common = outputs[index].as_ref().map(|it| it.1.as_slice());
        declaration_emit_output_file_path(options, source, common, is_case_sensitive)
    };
    // `GetOutputPathsFor`: `jsFilePath`. `None`: nothing is written for the file, or it would be
    // written over the file itself.
    let js_file_path = |index: usize, source: &[u8]| {
        let options = &options_of_projects[index];
        if options.no_emit || options.emit_declaration_only || is_declaration_file_name(source) {
            return None;
        }
        let common = outputs[index].as_ref().map(|it| it.1.as_slice());
        let output = own_emit_output_file_path(options, source, common, is_case_sensitive);
        (!is_same_path(&output, source, is_case_sensitive)).then_some(output)
    };
    let path_of = |name: Vec<u8>| match is_case_sensitive {
        true => name,
        false => to_path(&name, false).into_owned(),
    };
    let mut expected = Expected::default();
    for (index, sources) in roots.iter().enumerate() {
        for source in sources {
            if writes_declaration_files(index)
                && output_declaration_file_name(source, None).is_some()
            {
                expected.add(path_of(declaration_file_path(index, source)), index);
            }
            if let Some(output) = js_file_path(index, source) {
                expected.add(path_of(output), index);
            }
        }
    }
    let inputs: Vec<(config::Project, Vec<ConfigError>)> = (projects.into_iter())
        .zip(about_references)
        .map(|(referenced, about)| (referenced.project, about))
        .collect();
    // What each project has emitted, once it is built: see `WithOutputs::files`.
    type Emitted = Vec<(Vec<u8>, Arc<Vec<u8>>)>;
    let emitted: Vec<Guarded<Emitted>> = (0..count).map(|_| Guarded::new(Vec::new())).collect();
    // `is_built`: by project, now. `Err`: the projects that have to be built first, besides those
    // that it references.
    let build = |index: usize, is_built: &[bool]| -> Result<Option<Report>, Vec<usize>> {
        let (mut project, mut about_references) = inputs[index].clone();
        if project.files.is_empty() && project.has_references {
            // `upToDateStatusTypeSolution`: there is no program. `buildProject` reports each of
            // `GetConfigFileParsingDiagnostics` as it comes.
            let errors = project.errors.iter().filter(|e| !e.is_about_options);
            let diagnostics: Vec<Diagnostic> = errors
                .map(|error| of_config_error(host, &project.config_path, error))
                .collect();
            return Ok((!diagnostics.is_empty()).then(|| Report {
                diagnostics,
                ..Default::default()
            }));
        }
        if is_left_out[index] {
            return Ok(None);
        }
        project.errors.append(&mut about_references);
        // `initMapperWorker`: the references in order, each project before its own references. A
        // cycle leads back to the project itself, whose files are not those of a reference.
        let mut is_referenced = vec![false; roots.len()];
        let mut referenced: Vec<usize> = Vec::new();
        let mut pending: Vec<usize> = references[index].iter().rev().copied().collect();
        while let Some(i) = pending.pop() {
            if !std::mem::replace(&mut is_referenced[i], true) {
                if i != index {
                    referenced.push(i);
                }
                pending.extend(references[i].iter().rev());
            }
        }
        let mut host = WithOutputs {
            disk: host,
            files: FxHashMap::default(),
            directories: FxHashSet::default(),
            expected: &expected,
            is_pending: (0..count).map(|i| i < index && !is_built[i]).collect(),
            awaited: Guarded::new(Vec::new()),
            unreadable: Guarded::new(Vec::new()),
        };
        for i in (0..index).filter(|&i| is_built[i]) {
            for (path, text) in emitted[i].lock().iter() {
                host.add(path.clone(), Arc::clone(text));
            }
        }
        project.options.referenced_options = referenced
            .iter()
            .map(|&i| options_of_projects[i].clone())
            .collect();
        // `ParseInputOutputNames`, `getOutputDeclarationAndSourceFileNames`
        let mut sources: Vec<(Vec<u8>, Vec<u8>, Vec<u8>, u32)> = (referenced.iter().enumerate())
            .flat_map(|(at, &i)| {
                let output = output_of(i);
                roots[i].iter().map(move |source| {
                    let output_dts = output_declaration_file_name(source, output);
                    let path = to_path(source, is_case_sensitive).into_owned();
                    (
                        path,
                        source.clone(),
                        output_dts.unwrap_or_default(),
                        at as u32,
                    )
                })
            })
            .collect();
        // `maps.Copy`: of the projects that have a file, the last one has the entry.
        sources.sort_unstable_by(|a, b| a.0.cmp(&b.0).then(b.3.cmp(&a.3)));
        sources.dedup_by(|a, b| a.0 == b.0);
        let mut output_dts: Vec<(Vec<u8>, u32)> = (sources.iter().enumerate())
            .filter(|(_, it)| !it.2.is_empty())
            .map(|(index, it)| (to_path(&it.2, is_case_sensitive).into_owned(), index as u32))
            .collect();
        let walked = |it: &(Vec<u8>, u32)| sources[it.1 as usize].3;
        output_dts.sort_unstable_by(|a, b| a.0.cmp(&b.0).then(walked(b).cmp(&walked(a))));
        output_dts.dedup_by(|a, b| a.0 == b.0);
        project.options.referenced_sources = sources;
        project.options.referenced_output_dts = output_dts;
        let own: FxHashSet<&[u8]> = root_paths[index].iter().map(Vec::as_slice).collect();
        let owned_elsewhere: FxHashSet<&[u8]> = (0..roots.len())
            .filter(|&i| is_referenced[i])
            .flat_map(|i| root_paths[i].iter().map(Vec::as_slice))
            .chain(elsewhere.into_iter().flatten().copied())
            .filter(|path| !own.contains(path))
            .collect();
        let is_root = is_same_path(&project.config_path, &root_config_path, is_case_sensitive);
        project.options.is_build = reports_references || !is_root;
        project.options.build_info_file_name = project.get_build_info_file_name();
        project.options.writes_declaration_files = writes_declaration_files(index);
        let no_emit_on_error = project.options.no_emit_on_error;
        let named = match named {
            Some((Extent::Project, files)) if is_root => Some(files),
            // What another program reads is built whole. A solution has no program.
            Some((Extent::Graph, files)) if !is_read_by_a_program(index) => {
                let is_named = |file: &Vec<u8>| is_among(files, file);
                (!root_paths[index].iter().all(is_named)).then_some(files)
            }
            _ => None,
        };
        let mut checked = check_named_files(
            &host,
            project,
            request,
            Report::default(),
            Instant::now(),
            named,
            Some(&owned_elsewhere),
            Some(&|| !host.awaited.lock().is_empty()),
        );
        let mut awaited = std::mem::take(&mut *host.awaited.lock());
        if !awaited.is_empty() {
            awaited.sort_unstable();
            awaited.dedup();
            return Err(awaited);
        }
        // `HandleNoEmitOnError`
        if !(no_emit_on_error && !checked.diagnostics.is_empty()) {
            let mut emitted = emitted[index].lock();
            for (source, written) in std::mem::take(&mut checked.declaration_files) {
                let path = declaration_file_path(index, &source);
                if let Some(declaration_file_emitted) = request.declaration_file_emitted {
                    declaration_file_emitted(&path, &written);
                }
                emitted.push((path_of(path), Arc::new(written)));
            }
            let no_text = Arc::new(Vec::new());
            for source in &roots[index] {
                if let Some(output) = js_file_path(index, source) {
                    let text = match output.ends_with(b".json") {
                        true => Arc::new(host.disk.read(source).unwrap_or_default().into_owned()),
                        false => Arc::clone(&no_text),
                    };
                    emitted.push((path_of(output), text));
                }
            }
        }
        Ok(Some(checked))
    };
    // `buildOrClean`: a project is built as soon as those that it references are. The threads here
    // only coordinate: the work of every project is done by the pool, whose threads turn to
    // another project where one has no task for them.
    struct Builds {
        is_started: Vec<bool>,
        is_built: Vec<bool>,
        /// By project: what `build` has returned.
        awaited: Vec<Vec<usize>>,
    }
    let builds = Guarded::new(Builds {
        is_started: vec![false; count],
        is_built: vec![false; count],
        awaited: vec![Vec::new(); count],
    });
    let one_is_built = bun_threading::Condvar::new();
    let reports: Vec<Guarded<Option<Report>>> = (0..count).map(|_| Guarded::new(None)).collect();
    let build_what_is_ready = || {
        loop {
            let mut state = builds.lock();
            let index = loop {
                let is_ready = |&i: &usize| {
                    let mut first = up_stream[i].iter().chain(&state.awaited[i]);
                    !state.is_started[i] && first.all(|&it| state.is_built[it])
                };
                if let Some(index) = (0..count).find(is_ready) {
                    break index;
                }
                if state.is_started.iter().all(|&it| it) {
                    return;
                }
                one_is_built.wait_guarded(&mut state);
            };
            state.is_started[index] = true;
            let is_built = state.is_built.clone();
            drop(state);
            match build(index, &is_built) {
                Ok(report) => {
                    *reports[index].lock() = report;
                    builds.lock().is_built[index] = true;
                }
                Err(awaited) => {
                    let mut state = builds.lock();
                    state.awaited[index].extend(awaited);
                    state.is_started[index] = false;
                }
            }
            one_is_built.notify_all();
        }
    };
    let at_once = (request.plan_options.projects_at_once)
        .min(host.threads())
        .min(count);
    std::thread::scope(|scope| {
        for _ in 1..at_once {
            // Without the thread, the others build its share.
            let _ = std::thread::Builder::new()
                .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
                .spawn_scoped(scope, || {
                    // As a thread of the pool does when it starts: the parsers check the stack.
                    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Check"));
                    build_what_is_ready();
                });
        }
        build_what_is_ready();
    });
    // `BuildTask.report`: project by project, in build order. What two projects say about a file
    // that both include is there twice.
    let mut not_found = not_found.into_iter().peekable();
    for (index, mut checked) in reports.into_iter().enumerate() {
        while let Some((_, d)) = not_found.next_if(|it| it.0 <= index) {
            // Of the build. A plain `tsc` has only what the project says at its reference.
            if reports_references {
                report.report_task(Report {
                    diagnostics: vec![d],
                    ..Default::default()
                });
            }
        }
        if let Some(mut checked) = checked.get_mut().take()
            // A project that is only read, with no file in the directory that was named, is not asked about.
            && (reports_references && has_named[index] || Some(index) == root_index)
        {
            for d in &mut checked.diagnostics {
                d.project = index as u32;
            }
            report.report_task(checked);
            report.projects_checked += usize::from(reports_references);
        }
    }
    report.follows_references = follows_references && named.is_none();
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    report
}

/// For what `tsc` has no command for: files that are named, or found in a page, and that are
/// checked in projects that have nothing to do with each other.
fn sort_as_one_project(report: &mut Report) {
    report.tasks.clear();
    for d in &mut report.diagnostics {
        d.project = 0;
    }
    sort_and_deduplicate(&mut report.diagnostics);
}

/// `Loc`
fn loc(d: &Diagnostic) -> (i64, i64) {
    match d.has_undefined_range {
        true => (-1, -1),
        false => (i64::from(d.start), i64::from(d.end)),
    }
}

/// `EqualDiagnostics`
fn equal_diagnostics(d1: &Diagnostic, d2: &Diagnostic) -> bool {
    equal_diagnostics_no_related_info(d1, d2)
        && d1.related.len() == d2.related.len()
        && (d1.related.iter().zip(&d2.related)).all(|(r1, r2)| equal_diagnostics(r1, r2))
}

/// `EqualDiagnosticsNoRelatedInfo`
fn equal_diagnostics_no_related_info(d1: &Diagnostic, d2: &Diagnostic) -> bool {
    (&d1.path, loc(d1), d1.code, &d1.args) == (&d2.path, loc(d2), d2.code, &d2.args)
        && d1.message_chain == d2.message_chain
}

/// `compareMessageChainSize`
fn compare_message_chain_size(c1: &[MessageChain], c2: &[MessageChain]) -> std::cmp::Ordering {
    let by_length = c2.len().cmp(&c1.len());
    c1.iter().zip(c2).fold(by_length, |c, (c1, c2)| {
        c.then_with(|| compare_message_chain_size(&c1.message_chain, &c2.message_chain))
    })
}

/// `compareMessageChainContent`, of chains of the same size.
fn compare_message_chain_content(c1: &[MessageChain], c2: &[MessageChain]) -> std::cmp::Ordering {
    let equal = std::cmp::Ordering::Equal;
    c1.iter().zip(c2).fold(equal, |c, (c1, c2)| {
        c.then_with(|| c1.args.cmp(&c2.args))
            .then_with(|| compare_message_chain_content(&c1.message_chain, &c2.message_chain))
    })
}

/// `compareRelatedInfo`
fn compare_related_info(r1: &[Diagnostic], r2: &[Diagnostic]) -> std::cmp::Ordering {
    let by_length = r2.len().cmp(&r1.len());
    r1.iter().zip(r2).fold(by_length, |c, (d1, d2)| {
        c.then_with(|| compare_diagnostics(d1, d2))
    })
}

/// `CompareDiagnostics`
fn compare_diagnostics(d1: &Diagnostic, d2: &Diagnostic) -> std::cmp::Ordering {
    let (path1, path2) = (typescript_path(&d1.path), typescript_path(&d2.path));
    (path1, loc(d1), d1.code, &d1.args)
        .cmp(&(path2, loc(d2), d2.code, &d2.args))
        .then_with(|| compare_message_chain_size(&d1.message_chain, &d2.message_chain))
        .then_with(|| compare_message_chain_content(&d1.message_chain, &d2.message_chain))
        .then_with(|| compare_related_info(&d1.related, &d2.related))
}

/// `SortAndDeduplicateDiagnostics`
fn sort_and_deduplicate(diagnostics: &mut Vec<Diagnostic>) {
    diagnostics.sort_by(compare_diagnostics);
    // `compactAndMergeRelatedInfos`
    diagnostics.dedup_by(|next, first| {
        let is_same = equal_diagnostics_no_related_info(first, next);
        if is_same {
            first.related.append(&mut next.related);
            first.related.sort_by(compare_diagnostics);
            first
                .related
                .dedup_by(|next, first| equal_diagnostics(first, next));
        }
        is_same
    });
}

/// `error`, of the project whose configuration file is at `config_path`.
fn of_config_error(host: &dyn Host, config_path: &[u8], error: &ConfigError) -> Diagnostic {
    let mut reported = global(error.code, &error.args);
    reported.message_chain = message_chain_of(&error.chain);
    for chain in &reported.message_chain {
        chain.flatten(&mut reported.text, 1);
    }
    if error.at.is_none() && error.related.is_empty() {
        return reported;
    }
    let path = error.at.as_ref().map_or(config_path, |at| &at.0[..]);
    let Some(text) = host.read(path) else {
        return reported;
    };
    let starts = compute_ecma_line_starts(&text);
    let related = error.related.iter().map(|(from, to, code, args)| {
        located(path, &text, &starts, *from, *to, global(*code, args))
    });
    reported.related = related.collect();
    match error.at {
        Some((_, from, to)) => located(path, &text, &starts, from, to, reported),
        None => reported,
    }
}

/// Checks `project`, which is read through `host`. `report` holds the errors found before this
/// point, since `started`.
pub fn check_project(
    host: &dyn Host,
    project: config::Project,
    request: &Request,
    report: Report,
    started: Instant,
) -> Report {
    check_named_files(host, project, request, report, started, None, None, None)
}

/// `check_project`. `named`: of all loaded files, only these files (sorted) and the files they
/// refer to are checked.
/// `owned_elsewhere`: files of referenced projects, which are loaded but not checked.
/// Both have a `tspath.Path` for each file.
fn check_named_files(
    host: &dyn Host,
    mut project: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<&[Vec<u8>]>,
    owned_elsewhere: Option<&FxHashSet<&[u8]>>,
    // Asked when the program is loaded: whether it is not to be checked.
    is_outdated: Option<&dyn Fn() -> bool>,
) -> Report {
    let threads = match request.threads {
        0 => usize::from(bun_core::get_thread_count()),
        n => n,
    };
    project.options.current_directory = host::from_native(request.cwd);
    let conditions = request.conditions.iter().map(|it| it.to_vec());
    project.options.custom_conditions.extend(conditions);
    let config_path = project.config_path.clone();
    let of_configuration = |error: &ConfigError| of_config_error(host, &config_path, error);
    // `GetDiagnosticsOfAnyProgram`: configuration file parsing errors are reported regardless of
    // any other diagnostics.
    report.diagnostics.extend(
        project
            .errors
            .iter()
            .filter(|error| !error.is_about_options)
            .map(of_configuration),
    );
    let always_reported = report.diagnostics.len();
    let mut about_options: Vec<Diagnostic> = project
        .errors
        .iter()
        .filter(|error| error.is_about_options)
        .map(of_configuration)
        .collect();
    project.options.lib_dir = match request.libs {
        Libs::Bundled(_) => host::BUNDLED_LIBS.to_vec(),
        Libs::Directory(dir) => host::from_native(dir),
    };
    report.has_bun_types_installed = project
        .options
        .effective_type_roots()
        .iter()
        .any(|root| host.is_file(&[&root[..], b"/bun/package.json"].concat()));
    // `"types": ["bun"]` is among the options `bun init` writes, and so among the defaults used
    // when there is no configuration file. It is omitted from `default_compiler_options` because
    // requesting types that are not installed is an error (TS2688).
    if report.has_bun_types_installed
        && project.config_path.is_empty()
        && project.options.types.is_none()
    {
        project.options.types = Some(vec![b"bun".to_vec()]);
    }
    let (skip_lib_check, skip_default_lib_check) = (
        project.options.skip_lib_check,
        project.options.skip_default_lib_check,
    );

    let written = std::mem::take(&mut project.raw_compiler_options);
    let is_true = |name: &[u8]| written.contains(&(name.to_vec(), Json::Bool(true)));
    project.options.drops_unreferenced = !request.retains_everything;
    let before = host.times();
    host.spent(Phase::Discover, started.elapsed());
    // Declared before everything that is allocated in it, so it is dropped last.
    let session = Session::new();
    let files = Files::load(&session, host, project.options, &project.files);
    host.loaded();
    if is_outdated.is_some_and(|is_outdated| is_outdated()) {
        return report;
    }
    // In an arena, so that no destructor runs for them: the session frees what they refer to all
    // at once. `Program::release` frees the little that is on the regular heap.
    let files = session.arena().alloc(files);
    let root = session.arena().alloc(Program::new(&session, files));
    let program: &Program = root;
    report.files_loaded = program.files.modules.len();
    report.load_time = started.elapsed();
    let after = host.times();
    for (i, phase) in report.load_phases.iter_mut().enumerate() {
        *phase = after[i] - before[i];
    }
    if let Some(loaded) = request.loaded {
        loaded(program);
    }
    let explains_files = is_true(b"explainFiles");
    let explain_files = |has_made_diagnostics: bool| {
        let cwd = host::from_native(request.cwd);
        let to_relative_file_name = |file_name: &[u8]| {
            get_relative_path_from_directory(&cwd, file_name, COMPARE_PATHS_CASE_SENSITIVE)
        };
        program
            .files
            .explain_files(host, has_made_diagnostics, &to_relative_file_name)
    };
    if !explains_files && (is_true(b"listFiles") || is_true(b"listFilesOnly")) {
        let file_name = |&file: &FileId| program.files.module(file).file_name();
        let file_names = program.files.order.iter().map(file_name);
        report.listed_files = file_names
            .map(|it| displayed_path(it).into_owned())
            .collect();
    }
    let trace = program.files.resolution_trace.iter();
    report.resolution_trace = trace.map(|it| global(it.code, &it.args).text).collect();
    about_options.extend(
        program
            .files
            .program_problems()
            .iter()
            .map(|problem| ConfigError::of_problem(host, &session, &config_path, problem))
            .map(|error| of_configuration(&error)),
    );

    let checking = Instant::now();
    let mut to_check: Vec<FileId> = (0..program.files.modules.len())
        .filter(|&i| {
            let module = &program.files.modules[i];
            match module.hir.kind {
                // Only parse errors are reported for JSON files.
                FileKind::Json => module.hir.has_parse_diagnostics,
                // `SkipTypeChecking`, and nothing is emitted for a declaration file.
                FileKind::Declaration => {
                    !skip_lib_check && !(skip_default_lib_check && module.is_lib)
                }
                FileKind::Ts | FileKind::Tsx => true,
            }
        })
        .map(|i| FileId(i as u32))
        .collect();
    let mut scripts_elsewhere = Vec::new();
    let is_reached = named.map(|named| {
        let modules = &program.files.modules;
        let mut is_reached = vec![false; modules.len()];
        let mut to_follow: Vec<usize> = (0..modules.len())
            .filter(|&i| is_among(named, modules[i].path.text))
            .collect();
        for &i in &to_follow {
            is_reached[i] = true;
        }
        while let Some(i) = to_follow.pop() {
            // A page stands for its scripts.
            let specifiers = modules[i].bound.specifiers.iter();
            let specifiers = specifiers.map(|&it| program.files.atoms.bytes(it));
            let pages = specifiers.filter(|it| it.ends_with(b".html") && is_relative(it));
            let directory = dirname::<Posix>(modules[i].file_name());
            let scripts = pages.flat_map(|page| host.scripts_of_page(&join(directory, page)));
            let scripts = scripts.filter_map(|script| {
                let here = program.files.by_path.get(&script);
                if here.is_none() {
                    scripts_elsewhere.push(script);
                }
                here
            });
            for edge in modules[i].edges.iter().copied().chain(scripts) {
                if !std::mem::replace(&mut is_reached[edge.idx()], true) {
                    to_follow.push(edge.idx());
                }
            }
        }
        is_reached
    });
    report.scripts_elsewhere = scripts_elsewhere;
    if let Some(is_reached) = &is_reached {
        to_check.retain(|file| is_reached[file.idx()]);
    }
    if let Some(owned_elsewhere) = owned_elsewhere {
        let path = |f: FileId| program.files.modules[f.idx()].path.text;
        to_check.retain(|&f| !owned_elsewhere.contains(path(f)));
    }
    if let Some(only) = request.only {
        to_check.retain(|&f| strings::contains(program.files.modules[f.idx()].file_name(), only));
    }
    let lists_files_only = is_true(b"listFilesOnly") && request.stops_like_tsc;
    if lists_files_only {
        to_check.clear();
    }
    // Program order (`program.files`): an imported file precedes its importers. The position of a file in `to_check` is its index.
    let place = |f: FileId| program.files.rank_of_file(f);
    to_check.sort_by_key(|&f| place(f));
    let size = |f: FileId| program.files.modules[f.idx()].hir.source_len;
    report.files_checked = to_check.len();
    // `SkipTypeChecking`: besides its syntax, such a file only has what `Emit` reports, which is
    // called after the semantic and the global diagnostics of the whole program are collected. So
    // these files come after the plan, or before it under `Options::emits_first`. If there are no
    // others, the plan is theirs.
    let checker = program.checker();
    let (type_checked, only_emitted): (Vec<FileId>, Vec<FileId>) =
        (to_check.into_iter()).partition(|&file| checker.reports_semantic_errors(file));
    drop(checker);
    let is_any_type_checked = !type_checked.is_empty();
    let (to_check, only_emitted) = match is_any_type_checked {
        true => (type_checked, only_emitted),
        false => (only_emitted, type_checked),
    };
    if let Some(progress) = request.progress {
        let bytes = to_check
            .iter()
            .map(|f| program.files.modules[f.idx()].hir.source_len as usize)
            .sum();
        progress.bytes_to_check.fetch_add(bytes, Ordering::Relaxed);
        progress
            .to_check
            .fetch_add(to_check.len(), Ordering::Relaxed);
    }
    let found: Guarded<Vec<Diagnostic>> = Guarded::new(Vec::new());
    // `GetDeclarationDiagnostics`
    let emit_diagnostics: Guarded<Vec<Diagnostic>> = Guarded::new(Vec::new());
    let incomplete: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
    let deepest_stack = AtomicUsize::new(0);
    // `Files::parse_and_bind` retains the text of every file except those of the default library.
    let text_of = |file: FileId| {
        let module = &program.files.modules[file.idx()];
        if module.is_lib {
            host.read(module.file_name()).unwrap_or_default()
        } else {
            std::borrow::Cow::Borrowed(&module.hir.text[..])
        }
    };
    let show = |file: FileId, errors: Vec<Explained>, found: &Guarded<Vec<Diagnostic>>| {
        if errors.is_empty() {
            return;
        }
        let module = &program.files.modules[file.idx()];
        let text = &text_of(file)[..];
        let starts = compute_ecma_line_starts(text);
        let shown: Vec<Diagnostic> = errors
            .into_iter()
            .map(|e| {
                let related = e
                    .related
                    .into_iter()
                    .map(|related| {
                        let reported = Diagnostic {
                            code: related.code,
                            category: related.category,
                            text: related.text,
                            args: related.args,
                            message_chain: related.message_chain,
                            ..global(0, &[""; 0])
                        };
                        let Some((of, start, end)) = related.at else {
                            return reported;
                        };
                        if of == file {
                            return located(
                                module.file_name(),
                                text,
                                &starts,
                                start,
                                end,
                                reported,
                            );
                        }
                        if of == bun_sema::program::IN_CONFIGURATION {
                            return match host.read(&config_path) {
                                Some(text) => {
                                    let starts = compute_ecma_line_starts(&text);
                                    located(&config_path, &text, &starts, start, end, reported)
                                }
                                None => reported,
                            };
                        }
                        let other = &program.files.modules[of.idx()];
                        let text = &text_of(of)[..];
                        located(
                            other.file_name(),
                            text,
                            &compute_ecma_line_starts(text),
                            start,
                            end,
                            reported,
                        )
                    })
                    .collect();
                let reported = Diagnostic {
                    related,
                    code: e.code,
                    category: e.category,
                    text: if request.uses_typescript_wording {
                        e.text
                    } else {
                        in_terms_of_bun(e.text)
                    },
                    args: e.args,
                    message_chain: e.message_chain,
                    ..global(0, &[""; 0])
                };
                located(module.file_name(), text, &starts, e.start, e.end, reported)
            })
            .collect();
        if let Some(progress) = request.progress {
            progress.errors.fetch_add(shown.len(), Ordering::Relaxed);
        }
        found.lock().extend(shown);
    };
    let new_checker = |expected: Requested| {
        let mut checker = program.checker();
        checker.set_requested(expected);
        checker.begin_stack_budget();
        checker
    };
    // 0: the tasks are not `checkerPool` checkers.
    let checker_count = match request.plan_options.checkers {
        0 => 0,
        checkers => checkers.min(program.files.order.len()).clamp(1, 256),
    };
    // The files that are checked but not yet rendered. The task of another file may still report
    // diagnostics in them.
    let unfinished: Guarded<Vec<(FileId, Checked)>> = Guarded::new(Vec::new());
    /// The result of a task at the barrier.
    struct Outcome<'s> {
        /// `None`: the files were checked outside the plan.
        finished: Option<Finished<'s>>,
        /// For `finish_files`.
        checked: Vec<(FileId, Checked)>,
        /// The files in which the native stack ran out.
        incomplete: Vec<FileId>,
        generic_relation_entries_not_published: u64,
        /// The files whose HIR is freed once the task is validated: a retry reads it again.
        trees_to_free: Vec<FileId>,
        /// What `Checker::check_statements_ahead` returned. 0 for any other task.
        obstacles: u8,
    }
    let free_trees = |files: Vec<FileId>| {
        for file in files {
            // SAFETY: the only task that reads the HIR has ended and will not be retried.
            unsafe { program.files.free_tree(file) };
        }
    };
    // `task`: its step, its index in the step, and `is_read_later`. `None`: the files are checked
    // outside the plan.
    let check_chunk =
        |files: &[FileId], expected: Requested, task: Option<(usize, usize, bool)>| {
            let mut checker = new_checker(expected);
            if let Some((step, index, is_read_later)) = task {
                checker.begin_task(step as u32, index as u32, is_read_later);
                checker.set_checker_count(checker_count as u32);
                if checker_count == 1 && request.plan_options.reproduces_symbol_ids {
                    checker.hand_out_symbol_ids();
                }
            }
            let (mut checked, mut incomplete) = (Vec::new(), Vec::new());
            for &file in files {
                checked.push((file, checker.check_file(file)));
                if let Some(after_file) = request.after_file
                    && expected == Requested::All
                {
                    after_file(&mut checker, file);
                }
                if checker.take_ran_out_of_stack() {
                    incomplete.push(file);
                }
                if let (Some(progress), Some(_)) = (request.progress, task) {
                    progress.checked.fetch_add(1, Ordering::Relaxed);
                    let bytes = size(file) as usize;
                    progress.bytes_checked.fetch_add(bytes, Ordering::Relaxed);
                }
            }
            deepest_stack.fetch_max(checker.deepest_stack(), Ordering::Relaxed);
            let mut outcome = Outcome {
                finished: task.map(|_| checker.end_task()),
                checked,
                incomplete,
                generic_relation_entries_not_published: checker
                    .generic_relation_entries_not_published(),
                trees_to_free: Vec::new(),
                obstacles: 0,
            };
            // It holds references into the HIR of files.
            drop(checker);
            // At the end of the task, not of the file: an entry of the buffer can hold a value that is
            // bound to an earlier file of the task.
            // A freed HIR cannot be restored, and a file that is checked outside the plan is checked
            // again by its task.
            if let Some(finished) = &outcome.finished {
                let is_leaf = |file: &&FileId| program.files.modules[file.idx()].is_leaf;
                outcome.trees_to_free = files.iter().filter(is_leaf).copied().collect();
                if !finished.can_be_invalid() {
                    free_trees(std::mem::take(&mut outcome.trees_to_free));
                }
            }
            outcome
        };
    // `place`: the step of the task, and its index in the step.
    let check_ahead = |file: FileId, range: (u32, u32), expected: Requested, place: [usize; 2]| {
        let mut checker = new_checker(expected);
        checker.begin_task(place[0] as u32, place[1] as u32, true);
        let everything = request.plan_options.split_publishes_everything;
        let obstacles = checker.check_statements_ahead(file, range, everything);
        Outcome {
            finished: Some(checker.end_task()),
            checked: Vec::new(),
            incomplete: Vec::new(),
            generic_relation_entries_not_published: checker
                .generic_relation_entries_not_published(),
            trees_to_free: Vec::new(),
            obstacles,
        }
    };
    let declaration_files: Guarded<Vec<(Vec<u8>, Vec<u8>)>> = Guarded::new(Vec::new());
    let accept = |outcome: Outcome| {
        // The diagnostics that were found are reported. Others may be missing, so the report lists
        // the file as incomplete.
        for file in outcome.incomplete {
            let path = program.files.modules[file.idx()].file_name().to_vec();
            incomplete.lock().push(path);
        }
        unfinished.lock().extend(outcome.checked);
    };
    // The report. No task is running: every diagnostic is in the buffer of its file. It makes no
    // query and reads no HIR.
    let finish_files = || {
        let unfinished: Vec<Guarded<Option<(FileId, Checked)>>> = unfinished
            .lock()
            .drain(..)
            .map(|one| Guarded::new(Some(one)))
            .collect();
        host.parallel(unfinished.len(), &|i| {
            let (file, mut checked) = unfinished[i].lock().take().unwrap();
            if let Some(written) = checked.declaration_file.take() {
                let path = program.files.modules[file.idx()].file_name().to_vec();
                declaration_files.lock().push((path, written));
            }
            let declaration = checked.take_declaration_diagnostics();
            show(file, program.finish_file(file, checked), &found);
            if let Some(declaration) = declaration {
                let declaration = program.finish_file(file, declaration);
                show(file, declaration, &emit_diagnostics);
            }
        });
    };
    let bytes_of = |index: usize| size(to_check[index]) as usize;
    // Cost estimate for checking a file: the number of identifiers in its expressions. Each is a
    // symbol to resolve and a type to compute. The text size is a poor predictor: on storybook,
    // tasks partitioned by it take 1.8 times as long as tasks partitioned by the measured time,
    // whereas tasks partitioned by this estimate take 1.1 times as long.
    // A type node is a type to compute too. A declaration file has no expressions: next.js checks one of 2.9 MB that takes 23% of the
    // instructions of the check.
    let is_identifier = |tag: ExprTag| tag == ExprTag::Ident;
    let costs: Vec<usize> = (to_check.iter())
        .map(|&file| {
            let hir = program.files.hir(file);
            let tags = hir.exprs.iter().map(|it| it.kind.tag());
            let type_nodes = hir.types.len() * request.plan_options.type_node_cost;
            tags.filter(|&tag| is_identifier(tag)).count() + type_nodes + 1
        })
        .collect();
    let size_of = |index: usize| costs[index];
    // `PlanOptions::split_files`: the text of file `index` in at most `parts` ranges of about the same length, each from the start of
    // a statement to the start of another. Empty: the file is not split. In a declaration file nothing is inferred and no node is
    // deferred. Nothing that mentions a node of a leaf is published.
    let ranges_of = |index: usize, parts: usize| -> Vec<(u32, u32)> {
        let module = &program.files.modules[to_check[index].idx()];
        let (hir, options) = (&module.hir, &program.files.options);
        let mut ranges: Vec<(u32, u32)> = Vec::new();
        if module.is_leaf
            || hir.kind != FileKind::Declaration
            || options.skip_lib_check
            || options.no_check
        {
            return ranges;
        }
        let mut part_of_last = usize::MAX;
        for s in hir.ids(hir.body) {
            let start = hir[s].start;
            let part = start as usize * parts / (hir.source_len as usize + 1);
            if part != part_of_last {
                if let Some(last) = ranges.last_mut() {
                    last.1 = start;
                }
                ranges.push((start, u32::MAX));
                part_of_last = part;
            }
        }
        if ranges.len() < 2 {
            ranges.clear();
        }
        ranges
    };
    let plan = match request.plan_options.checkers {
        0 => Plan::new(
            to_check.len(),
            &bytes_of,
            &size_of,
            &ranges_of,
            &request.plan_options,
        ),
        checkers => Plan::of_checkers(
            to_check.len(),
            &|index| place(to_check[index]) as usize,
            program.files.order.len(),
            checkers,
        ),
    };
    let in_parallel = |count: usize, work: &(dyn Fn(usize) + Sync)| {
        host.parallel(count, work);
    };
    let steps: Guarded<Vec<StepReport>> = Guarded::new(Vec::new());
    // For every task since the last barrier: wall time, the number of files, the index of the first file.
    let task_times: Guarded<Vec<(Duration, usize, usize)>> = Guarded::new(Vec::new());
    // Returns the invalid tasks.
    // `ahead`: by task. Empty: every task checks whole files.
    let run_round = |number: usize, step: &[Task], ahead: &[Ahead], expected: Requested| {
        // After the last step the published state is read by the loop over the files that are not
        // checked, which runs with `after_file`, and by a caller that goes on to query the program.
        // The tasks of split files read the ranges, and nothing else of the step before theirs.
        let is_read_later = number + 1 + usize::from(!plan.ahead.is_empty()) < plan.steps.len()
            || request.retains_everything
            || request.after_file.is_some();
        let tasks = step.len();
        let weight_of = |i: usize| step[i].iter().map(|&it| size_of(it)).sum::<usize>();
        // The largest first, so that no thread begins it when the others are nearly done.
        let mut start_order: Vec<usize> = (0..tasks).collect();
        match request.order {
            1 => start_order.sort_by_key(|&i| Reverse(weight_of(i))),
            order => start_order.sort_by_key(|&i| (i as u32 + 1).wrapping_mul(order)),
        }
        let outcomes: Vec<Guarded<Option<Outcome>>> =
            (0..tasks).map(|_| Guarded::new(None)).collect();
        let (started, busy) = (Instant::now(), AtomicU64::new(0));
        host.parallel(tasks, &|i| {
            let (index, began) = (start_order[i], Instant::now());
            let cost_before = request.task_clock.map(|clock| clock());
            let files: Vec<FileId> = step[index].iter().map(|&file| to_check[file]).collect();
            let outcome = match ahead.get(index).copied().flatten() {
                Some(range) => check_ahead(files[0], range, expected, [number, index]),
                None => check_chunk(&files, expected, Some((number, index, is_read_later))),
            };
            *outcomes[index].lock() = Some(outcome);
            let elapsed = began.elapsed();
            busy.fetch_add(elapsed.as_nanos() as u64, Ordering::Relaxed);
            let cost = match (request.task_clock, cost_before) {
                (Some(clock), Some(before)) => Duration::from_nanos(clock() - before),
                _ => elapsed,
            };
            task_times.lock().push((cost, files.len(), step[index][0]));
        });
        let in_tasks = started.elapsed();
        // The barrier. Everything from here on is in task order.
        let mut outcomes: Vec<Outcome> = (outcomes.into_iter())
            .map(|mut outcome| outcome.get_mut().take().unwrap())
            .collect();
        let mut finished: Vec<Finished> = (outcomes.iter_mut())
            .map(|outcome| outcome.finished.take().unwrap())
            .collect();
        // The checkers of `checkerPool` share nothing, so there is no serial order to validate against.
        let mut invalid: Vec<Task> = Vec::new();
        let (mut ranges_dropped, mut ranges_by_obstacle) = (0, [0; 3]);
        if checker_count == 0 {
            // The ranges take part like any task, at the place of their file, so the serial order is what it is without them.
            let mut is_invalid = program.validate(&finished);
            // A range that met an obstacle is not published, like an invalid one. Neither is retried: the task of the file
            // evaluates what is missing.
            let tolerated = request.plan_options.split_tolerates & 7;
            for (is_invalid, outcome) in is_invalid.iter_mut().zip(&outcomes) {
                *is_invalid |= outcome.obstacles & !tolerated != 0;
                for (bit, count) in ranges_by_obstacle.iter_mut().enumerate() {
                    *count += usize::from((outcome.obstacles >> bit) & 1);
                }
            }
            let mut at = is_invalid.iter();
            finished.retain(|_| !*at.next().unwrap());
            let mut at = is_invalid.iter().zip(step).enumerate();
            outcomes.retain(|_| {
                let (index, (&is_invalid, task)) = at.next().unwrap();
                if is_invalid && ahead.get(index).is_some_and(Option::is_some) {
                    ranges_dropped += 1;
                } else if is_invalid {
                    if let Some(progress) = request.progress {
                        let bytes = task.iter().map(|&file| bytes_of(file)).sum();
                        progress.checked.fetch_sub(task.len(), Ordering::Relaxed);
                        progress.bytes_checked.fetch_sub(bytes, Ordering::Relaxed);
                    }
                    invalid.push(task.clone());
                }
                !is_invalid
            });
        }
        for outcome in &mut outcomes {
            free_trees(std::mem::take(&mut outcome.trees_to_free));
        }
        let mut foreign_evaluations = [0u64; FOREIGN_EVALUATION_KINDS.len()];
        for finished in &finished {
            for (sum, &more) in foreign_evaluations
                .iter_mut()
                .zip(&finished.foreign_evaluations)
            {
                *sum += u64::from(more);
            }
        }
        let linking = Instant::now();
        let records = program.link(&mut finished, &in_parallel);
        let (in_link, publishing) = (linking.elapsed(), Instant::now());
        let entries = program.publish(&mut finished, &in_parallel, request.digests);
        let in_publish = publishing.elapsed();
        let not_published = outcomes
            .iter()
            .map(|it| it.generic_relation_entries_not_published);
        let generic_relation_entries_not_published = not_published.sum();
        outcomes.into_iter().for_each(&accept);
        let mut slowest = std::mem::take(&mut *task_times.lock());
        slowest.sort_by_key(|&(elapsed, _, file)| (Reverse(elapsed), file));
        if request.task_clock.is_none() {
            slowest.truncate(5);
        }
        let path_of = |file: usize| {
            program.files.modules[to_check[file].idx()]
                .file_name()
                .to_vec()
        };
        steps.lock().push(StepReport {
            slowest_tasks: (slowest.into_iter())
                .map(|(elapsed, files, file)| (elapsed, files, path_of(file)))
                .collect(),
            tasks,
            ranges: ahead.iter().flatten().count(),
            ranges_dropped,
            ranges_by_obstacle,
            files: step.iter().map(Vec::len).sum(),
            in_tasks,
            in_link,
            in_publish,
            idle: (in_tasks * threads as u32)
                .saturating_sub(Duration::from_nanos(busy.into_inner())),
            entries,
            records,
            generic_relation_entries_not_published,
            foreign_evaluations,
        });
        invalid
    };
    // Retries the files of invalid tasks until every task is valid (`Program::validate`). They are partitioned again, because a few long
    // tasks would leave most threads idle. The first task of a round is always valid, so every round has fewer files.
    let run_step = |number: usize, step: &[Task], expected: Requested| {
        let mut invalid = run_round(number, step, plan.ahead_of(number), expected);
        while !invalid.is_empty() {
            let mut files = invalid.concat();
            files.sort_unstable();
            let again = Plan::cut(files, &size_of, &request.plan_options);
            invalid = run_round(number, &again, &[], expected);
        }
    };
    // `NewDiagnosticForNode` without a node: the range is empty, not undefined.
    let global_errors = || -> Vec<Diagnostic> {
        program
            .global_errors()
            .iter()
            .map(|(code, args)| Diagnostic {
                has_undefined_range: false,
                ..global(*code, args)
            })
            .collect()
    };
    // `GetDiagnosticsOfAnyProgram`: TypeScript's command line proceeds to the next kind of error
    // only if there is none of the previous kind. A file that does not parse, or is checked under
    // inconsistent options, produces errors that are not worth reading.
    let stops = request.stops_like_tsc;
    // `type_checked`: the files that are, or else the others.
    let check_files = |expected: Requested, type_checked: bool| {
        if type_checked == is_any_type_checked {
            for (number, step) in plan.steps.iter().enumerate() {
                run_step(number, step, expected);
            }
        }
        if !type_checked {
            // Not a function of the thread count, like the tasks of the plan.
            let tasks = request.plan_options.min_tasks.max(1);
            let tasks = only_emitted.chunks(only_emitted.len().div_ceil(tasks).max(1));
            let tasks: Vec<&[FileId]> = tasks.collect();
            host.parallel(tasks.len(), &|i| {
                accept(check_chunk(tasks[i], expected, None));
            });
        }
        finish_files();
    };
    // `EmitFilesAndReportErrors` calls `Emit` after collecting diagnostics, even if there are errors, and the declaration transformer
    // reports under `noEmit` too (`emitDeclarationFile`). `HandleNoEmitOnError` skips `Emit`, and so does `noEmit` on an incremental
    // program. Every `tsc -b` program is incremental. Otherwise this models `tsc -p --noEmit`.
    let options = &program.files.options;
    let emits_despite_errors = options.emits_declarations
        && !options.no_emit_on_error
        && !match options.is_build {
            true => options.no_emit,
            false => options.is_incremental,
        };
    let emit_on_early_exit = || -> Vec<Diagnostic> {
        if emits_despite_errors {
            check_files(Requested::Declaration, true);
            check_files(Requested::Declaration, false);
            found.lock().clear();
        }
        std::mem::take(&mut *emit_diagnostics.lock())
    };
    'stages: {
        if stops {
            let suspects: Vec<FileId> = (0..program.files.modules.len())
                .filter(|&i| {
                    let hir = &program.files.modules[i].hir;
                    (hir.has_parse_diagnostics
                        || hir.has_parse_or_grammar_diagnostics()
                        || hir.is_js)
                        && is_reached.as_ref().is_none_or(|reached| reached[i])
                })
                .map(|i| FileId(i as u32))
                .collect();
            host.parallel(suspects.len(), &|i| {
                accept(check_chunk(&suspects[i..=i], Requested::Syntactic, None));
            });
            finish_files();
            let syntactic = std::mem::take(&mut *found.lock());
            if !syntactic.is_empty() {
                // `GetProgramDiagnostics` is not called. An incremental program asks for them when
                // `Emit` writes its build info (`ensureHasErrorsForState`).
                if explains_files {
                    let is_incremental = options.is_incremental || options.is_build;
                    report.listed_files = explain_files(is_incremental && !lists_files_only);
                }
                report.diagnostics.extend(syntactic);
                report.files_not_checked = std::mem::take(&mut report.files_checked);
                report.diagnostics.extend(emit_on_early_exit());
                break 'stages;
            }
        }
        // Before a file is checked, which can free its HIR.
        if explains_files {
            report.listed_files = explain_files(true);
        }
        report.diagnostics.append(&mut about_options);
        // `ListFilesOnly`: no checker is asked for anything, and `Emit` is not called.
        if lists_files_only {
            break 'stages;
        }
        if stops {
            report.diagnostics.extend(global_errors());
            if report.diagnostics.len() > always_reported {
                report.files_not_checked = std::mem::take(&mut report.files_checked);
                report.diagnostics.extend(emit_on_early_exit());
                break 'stages;
            }
        }
        let emits_first = options.emits_first && !options.no_emit_on_error;
        for type_checked in [!emits_first, emits_first] {
            check_files(Requested::All, type_checked);
            report.diagnostics.append(&mut found.lock());
            // What a checker reports without a file after this is never asked for.
            if type_checked {
                report.diagnostics.extend(global_errors());
            }
        }
        // `GetDiagnosticsOfAnyProgram` collects them itself if there are no other errors. This list also contains suggestions.
        let is_error = |d: &Diagnostic| d.category == Category::Error;
        if !stops
            || emits_despite_errors
            || !report.diagnostics[always_reported..].iter().any(is_error)
        {
            report.diagnostics.append(&mut emit_diagnostics.lock());
        }
        // `iterateBaseline`: a caller that writes output for every file also does so for the files
        // that are not checked.
        if let Some(after_file) = request.after_file {
            let mut is_checked = vec![false; program.files.modules.len()];
            for file in to_check.iter().chain(&only_emitted) {
                is_checked[file.idx()] = true;
            }
            for i in 0..program.files.modules.len() {
                let (file, module) = (FileId(i as u32), &program.files.modules[i]);
                // None of TypeScript's own libraries is a file of the caller's. With
                // `libReplacement` a library can be any file.
                let is_left_out = match module.is_lib {
                    true => !options.lib_replacement,
                    false => !matches!(module.hir.kind, FileKind::Declaration | FileKind::Json),
                };
                if is_left_out || is_checked[i] {
                    continue;
                }
                let mut checker = program.checker();
                checker.begin_stack_budget();
                after_file(&mut checker, file);
            }
        }
    }
    report.deepest_stack = deepest_stack.into_inner();
    report.steps = std::mem::take(&mut *steps.lock());
    report.incomplete = std::mem::take(&mut *incomplete.lock());
    report.incomplete.sort();
    report.incomplete.dedup();
    let unreadable = host.take_unreadable();
    let cannot_read = (unreadable.iter()).map(|path| global(5083, &[displayed_path(path)]));
    report.diagnostics.extend(cannot_read);
    sort_and_deduplicate(&mut report.diagnostics);
    report.check_time = checking.elapsed();
    report.declaration_files = std::mem::take(&mut *declaration_files.lock());
    if let Some(checked) = request.checked {
        checked(program);
    }
    root.release();
    report
}
