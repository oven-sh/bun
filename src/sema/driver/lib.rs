//! Type checks a project: finds its configuration and its files, checks them on every core, and
//! reports the errors.
//!
//! `bun check`, `bun build --check` and `bun run --check` all use this, with different roots and
//! different output formatting.

pub mod format;
pub mod host;

pub use bun_sema::messages::Category;

use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::RecentAtoms;
use bun_sema::check::errors::Checked;
use bun_sema::check::explain::Explained;
use bun_sema::check::task::{Finished, Published};
use bun_sema::check::{FOREIGN_EVALUATION_KINDS, Program, Requested, compute_ecma_line_starts};
use bun_sema::config::{self, ConfigError};
use bun_sema::hir::{ExprTag, FileKind};
use bun_sema::json::Json;
use bun_sema::messages;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{
    Host, Options, Phase, ancestors, inside, is_declaration_file_name, join,
    output_declaration_file_name,
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

/// Runs `work(i)` for every `i` below `count` on Bun's shared thread pool, on at most `threads`
/// threads at a time. Indices are claimed in order: each thread takes the next one when it finishes
/// its previous one.
pub fn for_each_parallel(threads: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
    for_each_parallel_in_runs(&ThreadCaches::default(), threads, count, 1, work);
}

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

/// The same, with each thread claiming `run` consecutive indices at a time.
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

/// A compiler option and its value, from [`compiler_option_from_flag`].
#[derive(Clone)]
pub struct CompilerOption(Vec<u8>, Json);

pub enum FlagError {
    /// No compiler option has this name.
    Unknown,
    /// The option requires a value and none was given, or it cannot be given on a command line.
    NeedsValue,
    /// The value is not one the option accepts. The allowed values, if there is a fixed set.
    BadValue(&'static [&'static [u8]]),
}

/// Whether the compiler option `name`, matched case-insensitively, is a boolean, so that its value
/// may be omitted.
pub fn is_boolean_compiler_option(name: &[u8]) -> bool {
    bun_sema::config_options::choices(name) == Some(&[b"true".as_slice(), b"false"][..])
}

/// `--name value` as `tsc` reads it. `name` is matched case-insensitively. A boolean without a value is `true`.
pub fn compiler_option_from_flag(
    name: &[u8],
    value: Option<&[u8]>,
) -> Result<CompilerOption, FlagError> {
    use bun_sema::config_options::{choices, from_text};
    let allowed = choices(name);
    let value = match value {
        Some(value) => value,
        None if is_boolean_compiler_option(name) => b"true",
        // `from_text` with an arbitrary text distinguishes an unknown option from one that needs a
        // value.
        None if allowed.is_some() || from_text(name, b"0").is_some() => {
            return Err(FlagError::NeedsValue);
        }
        None => return Err(FlagError::Unknown),
    };
    if let Some(allowed) = allowed
        && !allowed.iter().any(|a| a.eq_ignore_ascii_case(value))
    {
        return Err(FlagError::BadValue(allowed));
    }
    match from_text(name, value) {
        Some((name, value)) => Ok(CompilerOption(name.to_vec(), value)),
        None if allowed.is_some() || from_text(name, b"0").is_some() => {
            Err(FlagError::BadValue(&[]))
        }
        None => Err(FlagError::Unknown),
    }
}

/// The command line options, followed by `noEmit`, since nothing is ever emitted.
fn overriding_options(request: &Request, is_build: bool) -> Vec<(Vec<u8>, Json)> {
    request
        .compiler_options
        .iter()
        .map(|option| (option.0.clone(), option.1.clone()))
        .chain((!is_build).then(|| (b"noEmit".to_vec(), Json::Bool(true))))
        .collect()
}

#[derive(Clone, Copy)]
pub struct Request<'a> {
    /// The working directory, as a native path.
    pub cwd: &'a [u8],
    /// `--project`: a configuration file, or a directory with a `tsconfig.json` in it.
    pub project: Option<&'a [u8]>,
    /// Files and directories to check instead of all the files of the project. The options are
    /// still the project's.
    pub paths: &'a [Vec<u8>],
    /// Compiler options given on the command line. They override the configuration file, also of referenced projects.
    pub compiler_options: &'a [CompilerOption],
    /// `0`: the number of cores.
    pub threads: usize,
    /// The directory of TypeScript's `lib.*.d.ts` files, if it should not be discovered
    /// automatically.
    pub lib_dir: Option<&'a [u8]>,
    /// The `node_modules` of the global install, which is searched for them last.
    pub global_node_modules: Option<&'a [u8]>,
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
    pub end: u32,
    /// 1-based. Columns count UTF-16 code units, as TypeScript's do.
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub code: u32,
    pub category: Category,
    /// The message. Lines after the first are the elaboration, indented by two spaces per level.
    pub text: Vec<u8>,
    /// Lines of the file from `source_line` on, without their line terminators: a few before the
    /// error, the lines it spans, a few after.
    pub source: Vec<Vec<u8>>,
    pub source_line: u32,
    /// Related information: `'x' is declared here.` These entries have no related information of
    /// their own.
    pub related: Vec<Diagnostic>,
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

#[derive(Default)]
pub struct Report {
    /// Sorted as TypeScript sorts them: diagnostics without a file first, then by path and
    /// position.
    pub diagnostics: Vec<Diagnostic>,
    /// Files in which a query was abandoned because the stack ran out: errors may be missing.
    pub incomplete: Vec<Vec<u8>>,
    /// Whether `@types/bun` is installed where a checked project would resolve it.
    pub has_bun_types_installed: bool,
    /// The configuration file that was used. Empty if there is none.
    pub config_path: Vec<u8>,
    /// `listFiles`, `listFilesOnly`: the files of the program, in program order.
    pub listed_files: Vec<Vec<u8>>,
    /// `traceResolution`: the lines, in order.
    pub resolution_trace: Vec<Vec<u8>>,
    pub files_loaded: usize,
    pub files_checked: usize,
    /// The steps that ran, in order. See `Plan`.
    pub steps: Vec<StepReport>,
    /// How many projects were checked, if the configuration has `references`. Otherwise 0.
    pub projects_checked: usize,
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
        self.resolution_trace.extend(other.resolution_trace);
        self.has_bun_types_installed |= other.has_bun_types_installed;
        self.files_loaded += other.files_loaded;
        self.files_checked += other.files_checked;
        self.steps.extend(other.steps);
        self.check_time += other.check_time;
        for (phase, more) in self.load_phases.iter_mut().zip(other.load_phases) {
            *phase += more;
        }
        self.deepest_stack = self.deepest_stack.max(other.deepest_stack);
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
    let (category, template) =
        messages::message(code).unwrap_or((Category::Error, "Unknown error."));
    Diagnostic {
        path: Vec::new(),
        start: 0,
        end: 0,
        line: 0,
        column: 0,
        end_line: 0,
        end_column: 0,
        code,
        category,
        text: {
            let mut text = Vec::new();
            messages::format(&mut text, template, args);
            text
        },
        source: Vec::new(),
        source_line: 0,
        related: Vec::new(),
    }
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

/// The 0-based line that contains `offset`, and the number of UTF-16 code units before it on that
/// line.
fn line_and_character(text: &[u8], starts: &[u32], offset: u32) -> (u32, u32) {
    let offset = offset.min(text.len() as u32);
    let line = starts.partition_point(|&s| s <= offset) - 1;
    let before = &text[starts[line] as usize..offset as usize];
    let units = strings::element_length_utf8_into_utf16(before);
    (line as u32, units as u32)
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

/// Expands `paths` (absolute, existing) into root files. A file maps to itself; a directory maps to the files that a project without a
/// config file rooted there would include.
fn roots_of_paths(disk: &host::Disk, paths: &[Vec<u8>], allow_js: bool) -> Vec<Vec<u8>> {
    let mut roots = Vec::new();
    for path in paths {
        if disk.is_dir(path) {
            let compiler = Json::Object(vec![(b"allowJs".to_vec(), Json::Bool(allow_js))]);
            roots.extend(config::without_config(disk, path, compiler, Vec::new()).files);
        } else {
            roots.push(path.clone());
        }
    }
    roots
}

/// Runs the check that `request` describes. Each program is freed with its `Session` as soon as it
/// has been checked. If `then` returns, the caches of the threads are dropped too, and the free
/// memory is returned to the system.
pub fn check_then<R>(request: &Request, then: impl FnOnce(Report) -> R) -> R {
    check_already_read_then(request, host::AlreadyRead::default(), then)
}

/// `check_then`, for a caller that has read some of the files.
pub fn check_already_read_then<R>(
    request: &Request,
    already_read: host::AlreadyRead,
    then: impl FnOnce(Report) -> R,
) -> R {
    let threads = match request.threads {
        0 => usize::from(bun_core::get_thread_count()),
        n => n,
    };
    let disk = host::Disk::with_already_read(threads, already_read);
    // Work outside a parallel region runs on this thread.
    let lent = disk.caches.lend();
    let mut report = check_request(&disk, request);
    if cfg!(windows) {
        for reported in &mut report.diagnostics {
            host::show_drives(&mut reported.text);
            let related = reported.related.iter_mut();
            related.for_each(|related| host::show_drives(&mut related.text));
        }
        report
            .resolution_trace
            .iter_mut()
            .for_each(host::show_drives);
    }
    let result = then(report);
    drop(lent);
    disk.caches.idle.lock().clear();
    // The allocator retains a thread's free pages for that thread. The process continues, so they
    // are returned to the system.
    disk.parallel(threads, &|_| bun_core::Global::mimalloc_cleanup(true));
    bun_core::Global::mimalloc_cleanup(true);
    result
}

pub fn check(request: &Request) -> Report {
    check_then(request, |report| report)
}

fn check_request(disk: &host::Disk, request: &Request) -> Report {
    let started = Instant::now();
    let cwd = host::from_native(request.cwd);
    let mut report = Report::default();

    // Report missing paths (TS6053) before loading the config file or any source file.
    let (paths, missing): (Vec<_>, Vec<_>) = (request.paths.iter())
        .map(|path| join(&cwd, path))
        .partition(|path| disk.is_dir(path) || disk.is_file(path));
    let not_found = missing.iter().map(|path| global(6053, &[path]));
    report.diagnostics.extend(not_found);
    if paths.is_empty() && !missing.is_empty() {
        return report;
    }
    let config_path = match request.project {
        Some(project) => {
            let path = join(&cwd, project);
            if disk.is_dir(&path) {
                let inside = join(&path, b"tsconfig.json");
                if !disk.is_file(&inside) {
                    report.diagnostics.push(global(5057, &[path]));
                    return report;
                }
                Some(inside)
            } else if disk.is_file(&path) {
                Some(path)
            } else {
                report.diagnostics.push(global(5058, &[path]));
                return report;
            }
        }
        // Use the config file nearest to the first path argument, or else nearest to the working directory.
        None => paths
            .first()
            .and_then(|first| {
                let dir = if disk.is_dir(first) {
                    first.as_slice()
                } else {
                    dirname::<Posix>(first)
                };
                config::find_config(disk, dir)
            })
            .or_else(|| config::find_config(disk, &cwd)),
    };
    let mut project = match &config_path {
        // `bun check` never emits. Without `references` it behaves like `tsc --noEmit`, so output-path errors are not reported. With
        // `references` it behaves like `tsc -b`, which has no `--noEmit`.
        Some(path) => config::load_overriding(disk, &Session::new(), path, &|has_references| {
            overriding_options(request, has_references && request.paths.is_empty())
        }),
        None => {
            let mut options = default_compiler_options();
            if let Json::Object(options) = &mut options {
                for option in request.compiler_options {
                    options.retain(|(name, _)| *name != option.0);
                    options.push((option.0.clone(), option.1.clone()));
                }
            }
            config::without_config(disk, &cwd, options, Vec::new())
        }
    };
    report.config_path.clone_from(&project.config_path);
    let mut named = None;
    if !paths.is_empty() {
        let mut roots = roots_of_paths(disk, &paths, project.options.allow_js);
        // Load the whole project even when only some files are checked. Global declarations and module augmentations from any file
        // affect every other file, so a file must produce the same errors with and without path arguments.
        let mut seen: FxHashSet<&[u8]> = project.files.iter().map(Vec::as_slice).collect();
        let more: Vec<Vec<u8>> = roots
            .iter()
            .filter(|root| seen.insert(root.as_slice()))
            .cloned()
            .collect();
        project.files.extend(more);
        project.options.files.clone_from(&project.files);
        // An empty file set in the config file is not an error when path arguments provide the roots.
        project
            .errors
            .retain(|e| e.code != 18003 && e.code != 18002);
        roots.sort_unstable();
        named = Some(roots);
    }
    if config_path.is_none() && paths.is_empty() {
        let configs = workspace_projects(disk, &cwd);
        if !configs.is_empty() {
            return check_workspaces(disk, &configs, project, request, report, started);
        }
    }
    // A config file with an empty file set is left to TS18002 and TS18003. With `extends`, `"files": [], "include": []` is valid.
    let has_no_input = named.as_ref().map_or_else(
        || config_path.is_none() && project.files.is_empty(),
        Vec::is_empty,
    );
    if has_no_input {
        let dir = paths.first().unwrap_or(&cwd);
        report.diagnostics.push(Diagnostic {
            text: [
                b"Nothing to check: no TypeScript files in '",
                &dir[..],
                b"'",
            ]
            .concat(),
            code: 0,
            ..global(18003, &[""; 0])
        });
        return report;
    }
    if named.is_none() && !project.references.is_empty() {
        check_with_references(disk, project, request, report, started)
    } else {
        check_named_files(
            disk,
            project,
            request,
            report,
            started,
            named.as_deref(),
            None,
            None,
        )
    }
}

/// Returns the sorted `tsconfig.json` paths of the directories matched by `workspaces` in `dir`'s `package.json`. Patterns have
/// `bun install` semantics (`WorkspaceMap::process_names_array`).
fn workspace_projects(disk: &host::Disk, dir: &[u8]) -> Vec<Vec<u8>> {
    let package = disk.read(&inside(dir, b"package.json"));
    let package = package.and_then(|text| host::parse_package_json(&Arena::new(), &text, true));
    let workspaces = package.as_ref().and_then(|p| p.get(b"workspaces"));
    // Yarn's object form: `{ "packages": [..] }`.
    let patterns = workspaces.and_then(|w| w.get(b"packages").unwrap_or(w).as_array());
    let patterns: Vec<&[u8]> = (patterns.unwrap_or_default().iter())
        .filter_map(Json::as_str)
        .collect();
    let mut found = Vec::new();
    for (i, &pattern) in patterns.iter().enumerate() {
        if !bun_glob::detect_glob_syntax(pattern) {
            found.push(join(dir, &[pattern, &b"/tsconfig.json"[..]].concat()));
            continue;
        }
        // A negated pattern only filters the matches of earlier patterns.
        if pattern.starts_with(b"!") {
            continue;
        }
        let Ok(Ok(mut walker)) = bun_glob::BunGlobWalker::init_with_cwd(
            &[pattern, &b"/tsconfig.json"[..]].concat(),
            host::to_native(dir),
            false,
            false,
            false,
            false,
            true,
            Some(|name| matches!(name, b"node_modules" | b".git" | b"CMakeFiles")),
        ) else {
            continue;
        };
        let mut matches = bun_glob::walk::Iterator::new(&mut walker);
        if !matches!(matches.init(), Ok(Ok(()))) {
            continue;
        }
        while let Ok(Ok(Some(matched))) = matches.next() {
            let package = &matched[..matched.len() - b"/tsconfig.json".len()];
            let is_negated = patterns[i + 1..].iter().any(|later| {
                let result = bun_glob::r#match(later, package);
                result.is_negated() && !result.matches()
            });
            if !is_negated {
                found.push(join(dir, &matched));
            }
        }
    }
    found.retain(|path| disk.is_file(path));
    found.sort_unstable();
    found.dedup();
    found
}

/// Checks a workspace root that has no config file. Each entry of `configs` is an independent project, as with `bun check -p`. `rest` is the
/// default-options project of the root directory, restricted to the files that no workspace project includes. A file is checked only by the
/// project that includes it, even when other projects import it.
fn check_workspaces(
    disk: &host::Disk,
    configs: &[Vec<u8>],
    mut rest: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
) -> Report {
    let over = |has_references| overriding_options(request, has_references);
    let configuration = Session::new();
    let mut projects: Vec<config::Project> = (configs.iter())
        .map(|path| config::load_overriding(disk, &configuration, path, &over))
        .collect();
    drop(configuration);
    let roots: Vec<Vec<Vec<u8>>> = projects.iter().map(|p| p.files.clone()).collect();
    let named: FxHashSet<&[u8]> = roots.iter().flatten().map(Vec::as_slice).collect();
    rest.files.retain(|file| !named.contains(file.as_slice()));
    rest.options.files.clone_from(&rest.files);
    if !rest.files.is_empty() {
        projects.push(rest);
    }
    for (index, project) in projects.into_iter().enumerate() {
        let own: FxHashSet<&[u8]> = (roots.get(index).into_iter().flatten())
            .map(Vec::as_slice)
            .collect();
        let owned_elsewhere: FxHashSet<&[u8]> = named.difference(&own).copied().collect();
        let (began, so_far) = (Instant::now(), Report::default());
        let checked = if project.references.is_empty() {
            let owned_elsewhere = Some(&owned_elsewhere);
            check_named_files(
                disk,
                project,
                request,
                so_far,
                began,
                None,
                owned_elsewhere,
                None,
            )
        } else {
            check_with_references(disk, project, request, so_far, began)
        };
        report.projects_checked += checked.projects_checked.max(1);
        report.merge(checked);
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    sort_and_deduplicate(&mut report.diagnostics);
    report
}

struct ReferencedProject {
    project: config::Project,
    /// Indices into the list of projects.
    references: Vec<usize>,
}

/// `Orchestrator`, limited to `GenerateGraph`.
struct Graph<'h> {
    host: &'h dyn Host,
    /// For `config::load_overriding`.
    session: &'h Session,
    overrides: Vec<(Vec<u8>, Json)>,
    /// `order`: dependencies first.
    projects: Vec<ReferencedProject>,
    /// Keyed by configuration file, each of which is loaded once. `completed`: its index in
    /// `projects`. `analyzing`: `None`.
    index_of: FxHashMap<Vec<u8>, Option<usize>>,
    circularity_stack: Vec<Vec<u8>>,
    /// `errors`: TS6202. If there is one, nothing is built.
    errors: Vec<Diagnostic>,
    /// `upToDateStatusTypeConfigFileNotFound`, which a task reports when it runs.
    not_found: Vec<Diagnostic>,
}

impl Graph<'_> {
    /// `setupBuildTask`: returns the index of `project` in `projects`.
    fn setup_build_task(&mut self, project: config::Project, in_circular_context: bool) -> usize {
        self.index_of.insert(project.config_path.clone(), None);
        self.circularity_stack.push(project.config_path.clone());
        let mut references = Vec::new();
        for reference in &project.references {
            let path = config::resolve_config_file_name_of_project_reference(&reference.path);
            let in_circular_context = in_circular_context || reference.circular;
            match self.index_of.get(&path) {
                Some(Some(index)) => references.push(*index),
                Some(None) if in_circular_context => {}
                Some(None) => {
                    let stack = self.circularity_stack.join(&b'\n');
                    self.errors.push(global(6202, &[stack]));
                }
                None if !self.host.is_file(&path) => self.not_found.push(global(6053, &[path])),
                None => {
                    let over = |_: bool| self.overrides.clone();
                    let referenced = config::load_overriding(self.host, self.session, &path, &over);
                    references.push(self.setup_build_task(referenced, in_circular_context));
                }
            }
        }
        self.circularity_stack.pop();
        let index = self.projects.len();
        self.index_of
            .insert(project.config_path.clone(), Some(index));
        self.projects.push(ReferencedProject {
            project,
            references,
        });
        index
    }
}

/// The declaration files that the projects of a `tsc -b` run are going to emit, and the directories
/// that contain them with all their ancestors: by which projects.
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

/// The file system as a `tsc -b` run leaves it for one project: it also contains the declaration
/// files of the projects before it in the build order, whether it references them or not.
/// Nothing is written to disk.
struct WithOutputs<'h> {
    disk: &'h dyn Host,
    files: FxHashMap<Vec<u8>, Arc<Vec<u8>>>,
    /// The directories that contain the files, and all their ancestors.
    directories: FxHashSet<Vec<u8>>,
    expected: &'h Expected,
    /// By project: it comes before this one and is not built yet, so `files` lacks what it emits.
    is_pending: Vec<bool>,
    /// Those of them whose output this project has asked for. What it was answered is wrong.
    awaited: Guarded<Vec<usize>>,
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

    fn file(&self, path: &[u8]) -> Option<&Vec<u8>> {
        self.wait_for(self.expected.files.get(path));
        self.files.get(path).map(|text| &**text)
    }

    fn has_directory(&self, path: &[u8]) -> bool {
        self.wait_for(self.expected.directories.get(path));
        self.directories.contains(path)
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
            None => self.disk.read_source(path),
        }
    }
    fn take_unreadable(&self) -> Vec<Vec<u8>> {
        self.disk.take_unreadable()
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
/// memory.
fn check_with_references(
    host: &dyn Host,
    root: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
) -> Report {
    let configuration = Session::new();
    let mut graph = Graph {
        host,
        session: &configuration,
        overrides: overriding_options(request, true),
        projects: Vec::new(),
        index_of: FxHashMap::default(),
        circularity_stack: Vec::new(),
        errors: Vec::new(),
        not_found: Vec::new(),
    };
    graph.setup_build_task(root, false);
    let Graph {
        projects,
        index_of,
        mut errors,
        mut not_found,
        ..
    } = graph;
    // `buildOrClean`: "Circularity errors prevent any project from being built".
    if !errors.is_empty() {
        report.diagnostics.append(&mut errors);
        report.load_time = started.elapsed();
        return report;
    }
    report.diagnostics.append(&mut not_found);
    let resolved = |path: &[u8]| Some(&projects[(*index_of.get(path)?)?].project);
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
            Some((
                output_dir.trim_end_with(|c| c == '/').to_vec(),
                root_dir.trim_end_with(|c| c == '/').to_vec(),
            ))
        })
        .collect();
    let references: Vec<Vec<usize>> = projects.iter().map(|p| p.references.clone()).collect();
    let options_of_projects: Vec<Options> =
        projects.iter().map(|p| p.project.options.clone()).collect();
    let is_read_later = |index: usize| references.iter().any(|of| of.contains(&index));
    let count = projects.len();
    // Under `noEmit` nothing is emitted, and a `.d.ts` next to a `.js` source would be resolved
    // in its place.
    let writes_declaration_files =
        |index: usize| is_read_later(index) && !options_of_projects[index].no_emit;
    let output_of = |index: usize| {
        let output = outputs[index].as_ref();
        output.map(|it| (it.0.as_slice(), it.1.as_slice()))
    };
    let mut expected = Expected::default();
    for index in (0..count).filter(|&index| writes_declaration_files(index)) {
        let sources = roots[index].iter();
        for source in sources.filter(|path| !is_declaration_file_name(path)) {
            if let Some(path) = output_declaration_file_name(source, output_of(index)) {
                expected.add(path, index);
            }
        }
    }
    let inputs: Vec<(config::Project, Vec<ConfigError>)> = (projects.into_iter())
        .zip(about_references)
        .map(|(referenced, about)| (referenced.project, about))
        .collect();
    // The declaration files that each project has emitted, once it is built.
    type Emitted = Vec<(Vec<u8>, Arc<Vec<u8>>)>;
    let emitted: Vec<Guarded<Emitted>> = (0..count).map(|_| Guarded::new(Vec::new())).collect();
    // `is_built`: by project, now. `Err`: the projects that have to be built first, besides those
    // that it references.
    let build = |index: usize, is_built: &[bool]| -> Result<Option<Report>, Vec<usize>> {
        let (mut project, mut about_references) = inputs[index].clone();
        if project.files.is_empty() && !project.references.is_empty() {
            // `upToDateStatusTypeSolution`: there is no program. `GetConfigFileParsingDiagnostics`
            // are reported anyway.
            project.errors.retain(|e| !e.is_about_options);
            if project.errors.is_empty() {
                return Ok(None);
            }
        } else {
            project.errors.append(&mut about_references);
        }
        let mut is_referenced = vec![false; roots.len()];
        let mut pending = references[index].clone();
        while let Some(i) = pending.pop() {
            if !std::mem::replace(&mut is_referenced[i], true) {
                pending.extend(&references[i]);
            }
        }
        // `ParseInputOutputNames`, `getOutputDeclarationAndSourceFileNames`
        let referenced: Vec<usize> = (0..roots.len()).filter(|&i| is_referenced[i]).collect();
        let mut host = WithOutputs {
            disk: host,
            files: FxHashMap::default(),
            directories: FxHashSet::default(),
            expected: &expected,
            is_pending: (0..count).map(|i| i < index && !is_built[i]).collect(),
            awaited: Guarded::new(Vec::new()),
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
        project.options.referenced_sources = (referenced.iter().enumerate())
            .flat_map(|(at, &i)| {
                let output = outputs[i]
                    .as_ref()
                    .map(|it| (it.0.as_slice(), it.1.as_slice()));
                let sources = roots[i]
                    .iter()
                    .filter(|path| !is_declaration_file_name(path));
                sources.map(move |source| {
                    let output_dts = output_declaration_file_name(source, output);
                    (source.clone(), output_dts.unwrap_or_default(), at as u32)
                })
            })
            .collect();
        project.options.referenced_sources.sort_unstable();
        project
            .options
            .referenced_sources
            .dedup_by(|a, b| a.0 == b.0);
        project.options.referenced_output_dts = (project.options.referenced_sources.iter())
            .enumerate()
            .filter(|(_, it)| !it.1.is_empty())
            .map(|(index, it)| (it.1.clone(), index as u32))
            .collect();
        project.options.referenced_output_dts.sort_unstable();
        let own: FxHashSet<&[u8]> = roots[index].iter().map(Vec::as_slice).collect();
        let owned_elsewhere: FxHashSet<&[u8]> = (0..roots.len())
            .filter(|&i| is_referenced[i])
            .flat_map(|i| roots[i].iter().map(Vec::as_slice))
            .filter(|path| !own.contains(path))
            .collect();
        project.options.is_build = true;
        project.options.writes_declaration_files = writes_declaration_files(index);
        let no_emit_on_error = project.options.no_emit_on_error;
        let mut checked = check_named_files(
            &host,
            project,
            request,
            Report::default(),
            Instant::now(),
            None,
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
                if let Some(path) = output_declaration_file_name(&source, output_of(index)) {
                    if let Some(declaration_file_emitted) = request.declaration_file_emitted {
                        declaration_file_emitted(&path, &written);
                    }
                    emitted.push((path, Arc::new(written)));
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
                    let mut first = references[i].iter().chain(&state.awaited[i]);
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
    for mut checked in reports {
        if let Some(checked) = checked.get_mut().take() {
            report.merge(checked);
            report.projects_checked += 1;
        }
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    sort_and_deduplicate(&mut report.diagnostics);
    report
}

/// `SortAndDeduplicateDiagnostics`, with `CompareDiagnostics`.
fn sort_and_deduplicate(diagnostics: &mut Vec<Diagnostic>) {
    diagnostics.sort_by(|a, b| {
        (&a.path, a.start, a.end, a.code, &a.text).cmp(&(&b.path, b.start, b.end, b.code, &b.text))
    });
    diagnostics.dedup_by(|a, b| {
        (&a.path, a.start, a.end, a.code, &a.text) == (&b.path, b.start, b.end, b.code, &b.text)
    });
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
    let of_configuration = |error: &ConfigError| {
        let mut reported = global(error.code, &error.args);
        for (level, code, args) in &error.chain {
            reported.text.push(b'\n');
            for _ in 0..*level {
                reported.text.extend_from_slice(b"  ");
            }
            reported.text.extend_from_slice(&global(*code, args).text);
        }
        match &error.at {
            Some((path, from, to)) => match host.read(path) {
                Some(text) => located(
                    path,
                    &text,
                    &compute_ecma_line_starts(&text),
                    *from,
                    *to,
                    reported,
                ),
                None => reported,
            },
            None => reported,
        }
    };
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
    let config_path = project.config_path.clone();
    let lib_dir = match request.lib_dir {
        Some(dir) => Some(host::from_native(dir)),
        None => host::find_lib_dir(
            host,
            &project.options.base_dir,
            request
                .global_node_modules
                .map(host::from_native)
                .as_deref(),
        ),
    };
    match lib_dir {
        Some(dir) => project.options.lib_dir = dir,
        None if project.options.no_lib => {}
        None => {
            report.diagnostics.push(Diagnostic {
                text: b"Cannot find TypeScript's standard library (lib.es5.d.ts and the rest), which declares Array, Promise and \
                       everything else that is built in. It comes with the typescript package: bun add -d typescript"
                    .to_vec(),
                code: 0,
                ..global(6053, &[""; 0])
            });
            return report;
        }
    }
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
    project.options.has_project_references = !project.references.is_empty();
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
    if is_true(b"listFiles") || is_true(b"listFilesOnly") {
        let path = |&file: &FileId| program.files.module(file).path.to_vec();
        report.listed_files = program.files.order.iter().map(path).collect();
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
                _ if module.is_lib => !skip_lib_check && !skip_default_lib_check,
                FileKind::Declaration => !skip_lib_check,
                FileKind::Ts | FileKind::Tsx => true,
            }
        })
        .map(|i| FileId(i as u32))
        .collect();
    let is_reached = named.map(|named| {
        let modules = &program.files.modules;
        let mut is_reached = vec![false; modules.len()];
        let mut to_follow: Vec<usize> = (0..modules.len())
            .filter(|&i| {
                named
                    .binary_search_by(|it| it.as_slice().cmp(modules[i].path))
                    .is_ok()
            })
            .collect();
        for &i in &to_follow {
            is_reached[i] = true;
        }
        while let Some(i) = to_follow.pop() {
            for edge in modules[i].edges {
                if !std::mem::replace(&mut is_reached[edge.idx()], true) {
                    to_follow.push(edge.idx());
                }
            }
        }
        is_reached
    });
    if let Some(is_reached) = &is_reached {
        to_check.retain(|file| is_reached[file.idx()]);
    }
    if let Some(owned_elsewhere) = owned_elsewhere {
        to_check.retain(|&f| !owned_elsewhere.contains(program.files.modules[f.idx()].path));
    }
    if let Some(only) = request.only {
        to_check.retain(|&f| strings::contains(program.files.modules[f.idx()].path, only));
    }
    if is_true(b"listFilesOnly") && request.stops_like_tsc {
        to_check.clear();
    }
    // Program order (`program.files`): an imported file precedes its importers. The position of a file in `to_check` is its index.
    let place = |f: FileId| program.files.rank_of_file(f);
    to_check.sort_by_key(|&f| place(f));
    let size = |f: FileId| program.files.modules[f.idx()].hir.source_len;
    report.files_checked = to_check.len();
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
            host.read(module.path).unwrap_or_default()
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
                            ..global(0, &[""; 0])
                        };
                        let Some((of, start, end)) = related.at else {
                            return reported;
                        };
                        if of == file {
                            return located(module.path, text, &starts, start, end, reported);
                        }
                        let other = &program.files.modules[of.idx()];
                        let text = &text_of(of)[..];
                        located(
                            other.path,
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
                    ..global(0, &[""; 0])
                };
                located(module.path, text, &starts, e.start, e.end, reported)
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
            let path = program.files.modules[file.idx()].path.to_vec();
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
                let path = program.files.modules[file.idx()].path.to_vec();
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
        let path_of = |file: usize| program.files.modules[to_check[file].idx()].path.to_vec();
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
            let again = Plan::cut(invalid.concat(), &size_of, &request.plan_options);
            invalid = run_round(number, &again, &[], expected);
        }
    };
    let global_errors = || -> Vec<Diagnostic> {
        program
            .global_errors()
            .iter()
            .map(|(code, args)| global(*code, args))
            .collect()
    };
    // `GetDiagnosticsOfAnyProgram`: TypeScript's command line proceeds to the next kind of error
    // only if there is none of the previous kind. A file that does not parse, or is checked under
    // inconsistent options, produces errors that are not worth reading.
    let stops = request.stops_like_tsc;
    let check_files = |expected: Requested| {
        for (number, step) in plan.steps.iter().enumerate() {
            run_step(number, step, expected);
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
            check_files(Requested::Declaration);
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
                report.diagnostics.extend(syntactic);
                report.files_checked = 0;
                report.diagnostics.extend(emit_on_early_exit());
                break 'stages;
            }
        }
        report.diagnostics.append(&mut about_options);
        if stops {
            report.diagnostics.extend(global_errors());
            if report.diagnostics.len() > always_reported {
                report.files_checked = 0;
                report.diagnostics.extend(emit_on_early_exit());
                break 'stages;
            }
        }
        check_files(Requested::All);
        report.diagnostics.append(&mut found.lock());
        report.diagnostics.extend(global_errors());
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
            for file in &to_check {
                is_checked[file.idx()] = true;
            }
            for i in 0..program.files.modules.len() {
                let (file, module) = (FileId(i as u32), &program.files.modules[i]);
                if module.is_lib
                    || !matches!(module.hir.kind, FileKind::Declaration | FileKind::Json)
                    || is_checked[i]
                {
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
    let cannot_read = unreadable.iter().map(|path| global(5083, &[path]));
    report.diagnostics.extend(cannot_read);
    sort_and_deduplicate(&mut report.diagnostics);
    // A program diagnostic without a file has position -1 (`NewCompilerDiagnostic`), a checker
    // diagnostic without a file has position 0 (`NewDiagnosticForNode`).
    let of_the_checker = program.global_errors();
    let in_no_file = report.diagnostics.partition_point(|d| d.path.is_empty());
    report.diagnostics[..in_no_file]
        .sort_by_key(|d| of_the_checker.iter().any(|(code, _)| *code == d.code));
    report.check_time = checking.elapsed();
    report.declaration_files = std::mem::take(&mut *declaration_files.lock());
    if let Some(checked) = request.checked {
        checked(program);
    }
    root.release();
    report
}
