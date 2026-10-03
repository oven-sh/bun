//! Type checks a project: finds its configuration and its files, checks them on every core, and says what is wrong.
//!
//! `bun check`, `bun build --check` and `bun run --check` are this with different roots and a different way of showing the result.

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
    Host, Options, Phase, inside, is_declaration_file_name, join, output_declaration_file_name,
};
use bun_sema::types::LinkCounts;
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_sema::verify::verify_project_references;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::cmp::Reverse;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

/// Runs `work(i)` for every `i` below `count` on the threads everything else in Bun runs on, no more than `threads` of them at a time. They take
/// the numbers in order, each the next one when it is done with the last.
pub fn for_each_parallel(threads: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
    for_each_parallel_in_runs(&ThreadCaches::default(), threads, count, 1, work);
}

/// What the threads that work for a check keep from one file to the next. The threads are the pool's and outlive the check, so the
/// caches are owned here: a thread borrows a set for the length of a parallel region.
#[derive(Default)]
pub struct ThreadCaches {
    idle: Guarded<Vec<(RecentAtoms, bun_js_parser::sema::ThreadCaches)>>,
}

impl ThreadCaches {
    /// Lends the calling thread a set until the guard is dropped.
    pub fn lend(&self) -> impl Drop + '_ {
        struct Lent<'a>(&'a ThreadCaches);
        impl Drop for Lent<'_> {
            fn drop(&mut self) {
                let set = (
                    RecentAtoms::take(),
                    bun_js_parser::sema::ThreadCaches::take(),
                );
                self.0.idle.lock().push(set);
            }
        }
        let (atoms, parser) = self.idle.lock().pop().unwrap_or_default();
        atoms.install();
        parser.install();
        Lent(self)
    }
}

/// The same, each thread taking `run` numbers in a row at a time.
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

/// What one thread does between two barriers, with one `Checker` and one buffer: `check_file` for each file, in program order. A file
/// is named by its index: its position in program order among the files to check.
type Task = Vec<usize>;

/// The constants of a `Plan`. They are options for as long as they are being chosen: the standalone command line sets them.
#[derive(Clone, Copy)]
pub struct PlanOptions {
    /// Steps that follow each other hold at most 1, g, g * g, .. tasks.
    pub step_growth: usize,
    /// How many light files are checked in steps of growing size, one file per task, before the one step with all other files. They
    /// are spread evenly over the light files of the program.
    pub warm_up_files: usize,
    /// A larger file is heavy. It is not in the warm-up, and it is a task of its own.
    pub warm_up_max_bytes: usize,
    /// After the warm-up, light files that follow each other in program order are one task until they have this much source. 0: one
    /// file per task.
    pub chunk_bytes: usize,
    /// .. or until they have the source of the step divided by this, if that is less: a step with many files has about this many tasks
    /// at least. Not a function of the thread count.
    pub min_tasks: usize,
    /// `--checkers`. Not 0: `checkerPool`, and none of the above.
    pub checkers: usize,
}

impl Default for PlanOptions {
    fn default() -> PlanOptions {
        PlanOptions {
            step_growth: 8,
            warm_up_files: 1 + 8 + 64,
            warm_up_max_bytes: 16 << 10,
            chunk_bytes: 64 << 10,
            min_tasks: 64,
            checkers: 0,
        }
    }
}

/// Which task is in which step, and in which order the tasks of a step are published. A FUNCTION OF THE PROGRAM ALONE: not of the thread
/// count, not of time. During a step the published state is read-only and a task writes to its own buffer, so the result of a task is
/// a function of the program and of the published state at the start of its step. By induction over the steps, so is the output.
struct Plan {
    steps: Vec<Vec<Task>>,
}

impl Plan {
    /// `createCheckers`, `forEachCheckerGroupDo`: file `i` of the program belongs to checker `i % checkers`, and a checker goes through
    /// its files in program order. The checkers share nothing. `rank_of(i)`: where file `i` of those to check is in the program, which
    /// has `files` files.
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
        Plan { steps: vec![tasks] }
    }

    /// `count`: how many files there are to check. `size_of(i)`: the bytes of source of file `i`.
    ///
    /// No order among the tasks is needed: what they observe of each other is published, or each computes its own copy.
    fn new(
        count: usize,
        bytes_of: &dyn Fn(usize) -> usize,
        size_of: &dyn Fn(usize) -> usize,
        options: PlanOptions,
    ) -> Plan {
        assert!(options.step_growth >= 1);
        let mut steps: Vec<Vec<Task>> = Vec::new();
        // THE WARM-UP fills the published state with what most tasks need. Until that is published, each task of a step computes its own
        // copy. Short steps, so of light files. A sample of the whole program: its first files are not like the bulk of it.
        let is_heavy = |file: usize| bytes_of(file) > options.warm_up_max_bytes;
        let light: Vec<usize> = (0..count).filter(|&file| !is_heavy(file)).collect();
        let wanted = options.warm_up_files.min(light.len());
        let warm_up = (0..wanted).map(|i| light[i * light.len() / wanted]);
        let warm_up: Vec<usize> = warm_up.collect();
        let (mut tasks, mut limit) = (warm_up.iter().map(|&file| vec![file]).peekable(), 1usize);
        while tasks.peek().is_some() {
            steps.push(tasks.by_ref().take(limit).collect());
            limit = limit.saturating_mul(options.step_growth);
        }
        // ONE STEP WITH ALL OTHER FILES. The heaviest file of a program takes about as long as a thread's share of the whole check, so
        // there is one step in which heavy files run, and they are started first.
        let rest = (0..count).filter(|file| warm_up.binary_search(file).is_err());
        let chunks = Plan::cut(rest.collect(), size_of, options);
        if !chunks.is_empty() {
            steps.push(chunks);
        }
        Plan { steps }
    }

    /// The tasks of one step for `rest`, which is in program order.
    fn cut(rest: Vec<usize>, size_of: &dyn Fn(usize) -> usize, options: PlanOptions) -> Vec<Task> {
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
        // How much source the last chunk has, if it is of light files.
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

/// How far a check has got. Read from another thread.
#[derive(Default)]
pub struct Progress {
    /// How many files there are to check. 0: the program is still being loaded.
    pub to_check: AtomicUsize,
    pub checked: AtomicUsize,
    /// The same in bytes of source, which says more about how long it will take: the biggest files go first.
    pub bytes_to_check: AtomicUsize,
    pub bytes_checked: AtomicUsize,
    /// How many errors have been found.
    pub errors: AtomicUsize,
}

/// A compiler option and its value, from [`compiler_option_from_flag`].
#[derive(Clone)]
pub struct CompilerOption(Vec<u8>, Json);

pub enum FlagError {
    /// No compiler option has this name.
    Unknown,
    /// The option takes a value and none was given, or it cannot be given on a command line.
    NeedsValue,
    /// The value is not one the option takes. The allowed values, if there is a fixed set.
    BadValue(&'static [&'static [u8]]),
}

/// Whether the compiler option `name`, in any case, is a boolean, so that its value may be left out.
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
        // `from_text` with any text tells an unknown option from one that needs a value.
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

/// `noEmit`, since nothing is ever written, after what the command line says.
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
    /// The working directory, as the operating system names it.
    pub cwd: &'a [u8],
    /// `--project`: a configuration file, or a directory with a `tsconfig.json` in it.
    pub project: Option<&'a [u8]>,
    /// Files and directories to check instead of all the project names. The options are still the project's.
    pub paths: &'a [Vec<u8>],
    /// Compiler options given on the command line. They override the configuration file, also of referenced projects.
    pub compiler_options: &'a [CompilerOption],
    /// `0`: as many as there are cores.
    pub threads: usize,
    /// Where TypeScript's `lib.*.d.ts` are, if that is not to be found out.
    pub lib_dir: Option<&'a [u8]>,
    /// The `node_modules` of what is installed globally, where they are looked for last.
    pub global_node_modules: Option<&'a [u8]>,
    /// Kept up to date on the way, for whoever shows how far it has got.
    pub progress: Option<&'a Progress>,
    /// Of all that is loaded, only the files with this in their path are checked. For looking into one file of a big project.
    pub only: Option<&'a [u8]>,
    /// The order in which the tasks of a step are STARTED. 1: the largest first. Any other odd number: by index * `order` (mod 2^32), a
    /// fixed permutation. The output does not depend on it. For tests of that property.
    pub order: u32,
    /// `Published::digest` is computed at every barrier. For tests: it is a function of the program.
    pub digests: bool,
    pub plan_options: PlanOptions,
    /// Nothing is forgotten once it is checked: for whoever goes on to ask about the program. It takes several times the memory.
    pub retains_everything: bool,
    /// As `tsc` does: if something does not parse, that is all that is said. If the options do not go together, that is. Only then come the
    /// errors about types.
    pub stops_like_tsc: bool,
    /// Word for word, where Bun would put it otherwise (`bun add -d` for `npm i --save-dev`). For comparing with TypeScript.
    pub uses_typescript_wording: bool,
    /// Called with everything that was loaded, before any of it is checked.
    pub loaded: Option<&'a (dyn Fn(&Program) + Sync)>,
    /// Called with it again when all of it is checked.
    pub checked: Option<&'a (dyn Fn(&Program) + Sync)>,
    /// Called for each file right after it is checked, on the thread that checked it, while the types that are local to the file
    /// are still alive. The way to read the type of every expression without `retains_everything`. An invalid task is retried
    /// (`Program::validate`), so this can be called more than once for a file: the last call counts.
    pub after_file: Option<&'a (dyn Fn(&mut bun_sema::check::Checker<'_>, FileId) + Sync)>,
    /// Called with the path and the text of each declaration file that a project of a `tsc -b` run leaves for those that reference it.
    /// Nothing is written to the disk: this is the way to see them.
    pub declaration_file_emitted: Option<&'a (dyn Fn(&[u8], &[u8]) + Sync)>,
}

/// Something that is wrong, ready to be shown.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// The file, as the checker names it. Empty for what is wrong with the configuration.
    pub path: Vec<u8>,
    /// Offsets in bytes.
    pub start: u32,
    pub end: u32,
    /// From 1. Columns count UTF-16 code units, as TypeScript's do.
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub code: u32,
    pub category: Category,
    /// The message. Lines after the first are reasons, indented by two spaces a level.
    pub text: Vec<u8>,
    /// Lines of the file from `source_line` on, without their line terminators: a few before the error, those it is on, a few after.
    pub source: Vec<Vec<u8>>,
    pub source_line: u32,
    /// What else has to do with it: `'x' is declared here.` None of these has any of its own.
    pub related: Vec<Diagnostic>,
}

/// A step of a `Plan`, as it ran.
#[derive(Clone)]
pub struct StepReport {
    pub tasks: usize,
    /// Of all its tasks.
    pub files: usize,
    /// Wall time from the start of the first task to the end of the last, and in the two halves of the barrier after it.
    pub in_tasks: Duration,
    pub in_link: Duration,
    pub in_publish: Duration,
    /// How long threads had no task because the step was not over, summed over the threads.
    pub idle: Duration,
    /// Entries of the tasks' buffers: all that were handed to the barrier, those that were published, those that lost to a lower task.
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
    /// Sorted as TypeScript sorts them: what has no file first, then by path and position.
    pub diagnostics: Vec<Diagnostic>,
    /// Files in which something went unanswered for want of stack: errors may be missing.
    pub incomplete: Vec<Vec<u8>>,
    /// Whether `@types/bun` is where a project that was checked would find it.
    pub has_bun_types_installed: bool,
    /// The configuration file that was used. Empty if there is none.
    pub config_path: Vec<u8>,
    /// `listFiles`, `listFilesOnly`: the files of the program, in its order.
    pub listed_files: Vec<Vec<u8>>,
    pub files_loaded: usize,
    pub files_checked: usize,
    /// The steps that ran, in order. See `Plan`.
    pub steps: Vec<StepReport>,
    /// How many projects were checked, if the configuration has `references`. Otherwise 0.
    pub projects_checked: usize,
    /// `Options::writes_declaration_files`: each source file that a declaration file is written for, and what is written.
    pub declaration_files: Vec<(Vec<u8>, Vec<u8>)>,
    pub load_time: Duration,
    pub check_time: Duration,
    /// `load_time`, by what it went on: in the order of `Phase::ALL`.
    pub load_phases: [Duration; Phase::ALL.len()],
    /// The most stack any file took, in bytes.
    pub deepest_stack: usize,
}

impl Report {
    /// Whether the exit code is 0: nothing is wrong, and nothing went unlooked at.
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

/// How many lines before and after an error are kept with it. How many of them are shown is up to the layout.
const LINES_BEFORE: u32 = 3;
const LINES_AFTER: u32 = 2;

/// What is checked by where there is no configuration file: what `bun init` writes, less the rules that are a matter of taste.
fn default_compiler_options() -> Json {
    let text = br#"{
        "lib": ["ESNext"], "target": "ESNext", "module": "Preserve", "moduleDetection": "force", "jsx": "react-jsx",
        "allowJs": true, "moduleResolution": "bundler", "allowImportingTsExtensions": true, "verbatimModuleSyntax": true,
        "noEmit": true, "strict": true, "skipLibCheck": true
    }"#;
    Json::parse(text).unwrap_or(Json::Null)
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

/// `said`, of the bytes `start..end` of the file at `path`, which reads `text` and whose lines start at `starts`.
fn located(
    path: &[u8],
    text: &[u8],
    starts: &[u32],
    start: u32,
    end: u32,
    said: Diagnostic,
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
        ..said
    }
}

/// The line `offset` is on, from 0, and how many UTF-16 code units come before it there.
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

/// Checks what `request` asks for. `then` is handed the report WHILE ALL THAT WAS LOADED IS STILL THERE. Freeing it takes up to 3% of the
/// time of the check, and the system takes it all back at once: who ends the process does so in `then`. For who returns from it, all
/// is dropped, the caches of the threads too, and the free memory goes back to the system.
pub fn check_then<R>(request: &Request, then: impl FnOnce(Report) -> R) -> R {
    let threads = match request.threads {
        0 => std::thread::available_parallelism().map_or(4, usize::from),
        n => n,
    };
    let disk = host::Disk::new(threads);
    // What is not done in a parallel region is done on this thread.
    let lent = disk.caches.lend();
    let (mut report, program) = check_request(&disk, request);
    if cfg!(windows) {
        for said in &mut report.diagnostics {
            host::show_drives(&mut said.text);
            let related = said.related.iter_mut();
            related.for_each(|related| host::show_drives(&mut related.text));
        }
    }
    let result = then(report);
    drop(program);
    drop(lent);
    disk.caches.idle.lock().clear();
    // The allocator keeps the free pages of a thread for that thread. The process goes on, so they go back to the system.
    disk.parallel(threads, &|_| bun_core::Global::mimalloc_cleanup(true));
    bun_core::Global::mimalloc_cleanup(true);
    result
}

pub fn check(request: &Request) -> Report {
    check_then(request, |report| report)
}

/// Returns the report and the last program that was checked. The caller decides when to drop the program.
fn check_request(disk: &host::Disk, request: &Request) -> (Report, Option<Box<Program>>) {
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
        return (report, None);
    }
    let config_path = match request.project {
        Some(project) => {
            let path = join(&cwd, project);
            if disk.is_dir(&path) {
                let inside = join(&path, b"tsconfig.json");
                if !disk.is_file(&inside) {
                    report.diagnostics.push(global(5057, &[path]));
                    return (report, None);
                }
                Some(inside)
            } else if disk.is_file(&path) {
                Some(path)
            } else {
                report.diagnostics.push(global(5058, &[path]));
                return (report, None);
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
        Some(path) => config::load_overriding(disk, path, &|has_references| {
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
        return (report, None);
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
        )
    }
}

/// Returns the sorted `tsconfig.json` paths of the directories matched by `workspaces` in `dir`'s `package.json`. Patterns have
/// `bun install` semantics (`WorkspaceMap::process_names_array`).
fn workspace_projects(disk: &host::Disk, dir: &[u8]) -> Vec<Vec<u8>> {
    let package = disk.read(&inside(dir, b"package.json"));
    let package = package.and_then(|text| Json::parse(&text));
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
            Some(|name| matches!(name, b"node_modules" | b".git")),
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
) -> (Report, Option<Box<Program>>) {
    let over = |has_references| overriding_options(request, has_references);
    let mut projects: Vec<config::Project> = (configs.iter())
        .map(|path| config::load_overriding(disk, path, &over))
        .collect();
    let roots: Vec<Vec<Vec<u8>>> = projects.iter().map(|p| p.files.clone()).collect();
    let named: FxHashSet<&[u8]> = roots.iter().flatten().map(Vec::as_slice).collect();
    rest.files.retain(|file| !named.contains(file.as_slice()));
    rest.options.files.clone_from(&rest.files);
    if !rest.files.is_empty() {
        projects.push(rest);
    }
    let mut program = None;
    for (index, project) in projects.into_iter().enumerate() {
        let own: FxHashSet<&[u8]> = (roots.get(index).into_iter().flatten())
            .map(Vec::as_slice)
            .collect();
        let owned_elsewhere: FxHashSet<&[u8]> = named.difference(&own).copied().collect();
        // Drop the previous program before loading the next one to bound peak memory.
        drop(program.take());
        let (began, so_far) = (Instant::now(), Report::default());
        let checked = if project.references.is_empty() {
            let owned_elsewhere = Some(&owned_elsewhere);
            check_named_files(disk, project, request, so_far, began, None, owned_elsewhere)
        } else {
            check_with_references(disk, project, request, so_far, began)
        };
        report.projects_checked += checked.0.projects_checked.max(1);
        report.merge(checked.0);
        program = checked.1;
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    sort_and_deduplicate(&mut report.diagnostics);
    (report, program)
}

struct ReferencedProject {
    project: config::Project,
    /// Indices into the list of projects.
    references: Vec<usize>,
}

/// `Orchestrator`, as far as `GenerateGraph` goes.
struct Graph<'h> {
    host: &'h dyn Host,
    overrides: Vec<(Vec<u8>, Json)>,
    /// `order`: dependencies first.
    projects: Vec<ReferencedProject>,
    /// By configuration file, each of which is loaded once. `completed`: where it is in `projects`. `analyzing`: `None`.
    index_of: FxHashMap<Vec<u8>, Option<usize>>,
    circularity_stack: Vec<Vec<u8>>,
    /// `errors`: TS6202. With one of these nothing is built.
    errors: Vec<Diagnostic>,
    /// `upToDateStatusTypeConfigFileNotFound`, which a task says when it is run.
    not_found: Vec<Diagnostic>,
}

impl Graph<'_> {
    /// `setupBuildTask`: where `project` is in `projects`.
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
                    let referenced = config::load_overriding(self.host, &path, &over);
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

/// The file system as a `tsc -b` run leaves it: the declaration files of the projects that have been built so far are there too.
/// Nothing is written to the disk.
struct WithOutputs<'h> {
    disk: &'h dyn Host,
    files: FxHashMap<Vec<u8>, Vec<u8>>,
    /// The directories the files are in, and all above them.
    directories: FxHashSet<Vec<u8>>,
}

impl WithOutputs<'_> {
    fn add(&mut self, path: Vec<u8>, text: Vec<u8>) {
        let mut directory = dirname::<Posix>(&path);
        while directory.len() > 1 && self.directories.insert(directory.to_vec()) {
            directory = dirname::<Posix>(directory);
        }
        self.files.insert(path, text);
    }

    /// `path` with the links followed in as much of it as is on the disk: a package of the workspace is found by way of a link in a
    /// `node_modules`, and what it has written goes by where it is.
    fn through_links(&self, path: &[u8]) -> Option<Vec<u8>> {
        if self.files.is_empty() || !strings::contains(path, b"/node_modules/") {
            return None;
        }
        let mut on_disk = dirname::<Posix>(path);
        while on_disk.len() > 1 && !self.disk.is_dir(on_disk) {
            on_disk = dirname::<Posix>(on_disk);
        }
        let real = self.disk.realpath(on_disk);
        (real != on_disk).then(|| [&real[..], &path[on_disk.len()..]].concat())
    }

    fn written(&self, path: &[u8]) -> Option<&Vec<u8>> {
        let written = self.files.get(path);
        written.or_else(|| self.files.get(&self.through_links(path)?))
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
            || self.directories.contains(path)
            || (self.through_links(path)).is_some_and(|real| self.directories.contains(&real))
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        match self.through_links(path) {
            Some(real) if self.files.contains_key(&real) || self.directories.contains(&real) => {
                real
            }
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
    fn parse(
        &self,
        path: &[u8],
        text: &[u8],
        atoms: &bun_sema::atom::Interner,
        options: &bun_sema::resolve::Options,
    ) -> bun_sema::hir::File {
        self.disk.parse(path, text, atoms, options)
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        self.disk.parallel(count, work);
    }
    fn threads(&self) -> usize {
        self.disk.threads()
    }
    fn readers(&self) -> usize {
        self.disk.readers()
    }
}

/// What `tsc -b` checks: `root` and every project it references, each with its own options. Nothing is written: a project reads the
/// declaration files of those it references from memory.
fn check_with_references(
    host: &dyn Host,
    root: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
) -> (Report, Option<Box<Program>>) {
    let mut graph = Graph {
        host,
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
        return (report, None);
    }
    report.diagnostics.append(&mut not_found);
    let resolved = |path: &[u8]| Some(&projects[(*index_of.get(path)?)?].project);
    let mut about_references: Vec<Vec<ConfigError>> = (projects.iter())
        .map(|p| {
            (verify_project_references(&p.project, &resolved).iter())
                .map(|(config_path, problem)| ConfigError::of_problem(host, config_path, problem))
                .collect()
        })
        .collect();
    // A file that belongs to a referenced project is checked there, with that project's options.
    let roots: Vec<Vec<Vec<u8>>> = projects.iter().map(|p| p.project.files.clone()).collect();
    // Where each project's declaration files would go, and the directory they mirror. `None`: next to the sources.
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
    let mut host = WithOutputs {
        disk: host,
        files: FxHashMap::default(),
        directories: FxHashSet::default(),
    };
    let is_read_later = |index: usize| references.iter().any(|of| of.contains(&index));
    let mut program = None;
    for (index, referenced) in projects.into_iter().enumerate() {
        let mut project = referenced.project;
        if project.files.is_empty() && !project.references.is_empty() {
            // `upToDateStatusTypeSolution`: there is no program. `GetConfigFileParsingDiagnostics` are said all the same.
            project.errors.retain(|e| !e.is_about_options);
            if project.errors.is_empty() {
                continue;
            }
        } else {
            project.errors.append(&mut about_references[index]);
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
        // Under `noEmit` nothing is written, and a `.d.ts` next to a `.js` source would be resolved in its place.
        project.options.writes_declaration_files = is_read_later(index) && !project.options.no_emit;
        let no_emit_on_error = project.options.no_emit_on_error;
        // Not two programs at a time.
        drop(program.take());
        let mut checked = check_named_files(
            &host,
            project,
            request,
            Report::default(),
            Instant::now(),
            None,
            Some(&owned_elsewhere),
        );
        // `HandleNoEmitOnError`
        if !(no_emit_on_error && !checked.0.diagnostics.is_empty()) {
            let output = outputs[index]
                .as_ref()
                .map(|it| (it.0.as_slice(), it.1.as_slice()));
            for (source, written) in std::mem::take(&mut checked.0.declaration_files) {
                if let Some(path) = output_declaration_file_name(&source, output) {
                    if let Some(declaration_file_emitted) = request.declaration_file_emitted {
                        declaration_file_emitted(&path, &written);
                    }
                    host.add(path, written);
                }
            }
        }
        report.merge(checked.0);
        program = checked.1;
        report.projects_checked += 1;
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    sort_and_deduplicate(&mut report.diagnostics);
    (report, program)
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

/// Checks `project`, which is read through `host`. `report` has what has been found wrong on the way to it, since `started`.
pub fn check_project(
    host: &dyn Host,
    project: config::Project,
    request: &Request,
    report: Report,
    started: Instant,
) -> Report {
    check_named_files(host, project, request, report, started, None, None).0
}

/// `check_project`. `named`: of all that is loaded, only these files, sorted, and what they refer to is checked.
/// `owned_elsewhere`: files of referenced projects, which are loaded but not checked.
fn check_named_files(
    host: &dyn Host,
    mut project: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<&[Vec<u8>]>,
    owned_elsewhere: Option<&FxHashSet<&[u8]>>,
) -> (Report, Option<Box<Program>>) {
    let threads = match request.threads {
        0 => std::thread::available_parallelism().map_or(4, usize::from),
        n => n,
    };
    let of_configuration = |error: &ConfigError| {
        let mut said = global(error.code, &error.args);
        for (level, code, args) in &error.chain {
            said.text.push(b'\n');
            for _ in 0..*level {
                said.text.extend_from_slice(b"  ");
            }
            said.text.extend_from_slice(&global(*code, args).text);
        }
        match &error.at {
            Some((path, from, to)) => match host.read(path) {
                Some(text) => located(
                    path,
                    &text,
                    &compute_ecma_line_starts(&text),
                    *from,
                    *to,
                    said,
                ),
                None => said,
            },
            None => said,
        }
    };
    // `GetDiagnosticsOfAnyProgram`: what is wrong with the way the configuration file is written is said whatever else there is to say.
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
            return (report, None);
        }
    }
    report.has_bun_types_installed = project
        .options
        .effective_type_roots()
        .iter()
        .any(|root| host.is_file(&[&root[..], b"/bun/package.json"].concat()));
    // `"types": ["bun"]` is among what `bun init` writes, and so among what goes where there is no configuration file. It is left out
    // of `default_compiler_options` because what is not installed cannot be asked for (TS2688).
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
    let files = Files::load(host, project.options, &project.files);
    let program = Program::new(std::sync::Arc::new(files));
    report.files_loaded = program.files.modules.len();
    report.load_time = started.elapsed();
    let after = host.times();
    for (i, phase) in report.load_phases.iter_mut().enumerate() {
        *phase = after[i] - before[i];
    }
    if let Some(loaded) = request.loaded {
        loaded(&program);
    }
    if is_true(b"listFiles") || is_true(b"listFilesOnly") {
        let path = |&file: &FileId| program.files.module(file).path.clone();
        report.listed_files = program.files.order.iter().map(path).collect();
    }
    about_options.extend(
        program
            .files
            .program_problems()
            .iter()
            .map(|problem| of_configuration(&ConfigError::of_problem(host, &config_path, problem))),
    );

    let checking = Instant::now();
    let mut to_check: Vec<FileId> = (0..program.files.modules.len())
        .filter(|&i| {
            let module = &program.files.modules[i];
            match module.hir.kind {
                // Only what the parser objects to is said of JSON.
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
            .filter(|&i| named.binary_search(&modules[i].path).is_ok())
            .collect();
        for &i in &to_follow {
            is_reached[i] = true;
        }
        while let Some(i) = to_follow.pop() {
            for edge in &modules[i].edges {
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
        to_check
            .retain(|&f| !owned_elsewhere.contains(program.files.modules[f.idx()].path.as_slice()));
    }
    if let Some(only) = request.only {
        to_check.retain(|&f| strings::contains(&program.files.modules[f.idx()].path, only));
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
    // `Files::parse_and_bind` keeps the text of every file but those of the default library.
    let text_of = |file: FileId| {
        let module = &program.files.modules[file.idx()];
        if module.is_lib {
            host.read(&module.path).unwrap_or_default()
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
                        let said = Diagnostic {
                            code: related.code,
                            category: related.category,
                            text: related.text,
                            ..global(0, &[""; 0])
                        };
                        let Some((of, start, end)) = related.at else {
                            return said;
                        };
                        if of == file {
                            return located(&module.path, text, &starts, start, end, said);
                        }
                        let other = &program.files.modules[of.idx()];
                        let text = &text_of(of)[..];
                        located(
                            &other.path,
                            text,
                            &compute_ecma_line_starts(text),
                            start,
                            end,
                            said,
                        )
                    })
                    .collect();
                let said = Diagnostic {
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
                located(&module.path, text, &starts, e.start, e.end, said)
            })
            .collect();
        if let Some(progress) = request.progress {
            progress.errors.fetch_add(shown.len(), Ordering::Relaxed);
        }
        found.lock().extend(shown);
    };
    let new_checker = |wanted: Requested| {
        let mut checker = program.checker();
        checker.set_requested(wanted);
        checker.begin_stack_budget();
        checker
    };
    // 0: the tasks are not `checkerPool`'s.
    let checker_count = match request.plan_options.checkers {
        0 => 0,
        checkers => checkers.min(program.files.order.len()).clamp(1, 256),
    };
    // Of the files that are checked and not yet rendered. The task of another file may still report in them.
    let unfinished: Guarded<Vec<(FileId, Checked)>> = Guarded::new(Vec::new());
    /// What a task leaves at the barrier.
    struct Outcome {
        /// `None`: the files were checked outside the plan.
        finished: Option<Finished>,
        /// For `finish_files`.
        checked: Vec<(FileId, Checked)>,
        /// The files in which the native stack ran out.
        incomplete: Vec<FileId>,
        generic_relation_entries_not_published: u64,
        /// The files whose trees are freed once the task is validated: a retry reads them again.
        trees_to_free: Vec<FileId>,
    }
    let free_trees = |files: Vec<FileId>| {
        for file in files {
            // SAFETY: the only task that reads the tree has ended and will not be retried.
            unsafe { program.files.free_tree(file) };
        }
    };
    // `task`: its step, its place in the step, and `is_read_later`. `None`: the files are checked outside the plan.
    let check_chunk = |files: &[FileId], wanted: Requested, task: Option<(usize, usize, bool)>| {
        let mut checker = new_checker(wanted);
        if let Some((step, index, is_read_later)) = task {
            checker.begin_task(step as u32, index as u32, is_read_later);
            checker.set_checker_count(checker_count as u32);
        }
        let (mut checked, mut incomplete) = (Vec::new(), Vec::new());
        for &file in files {
            checked.push((file, checker.check_file(file)));
            if let Some(after_file) = request.after_file
                && wanted == Requested::All
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
        };
        // It holds references into trees.
        drop(checker);
        // At the end of the task, not of the file: an entry of the buffer can hold a value that is bound to an earlier file of the task.
        // A freed tree does not come back, and a file that is checked outside the plan is checked again by its task.
        if let Some(finished) = &outcome.finished {
            let is_leaf = |file: &&FileId| program.files.modules[file.idx()].is_leaf;
            outcome.trees_to_free = files.iter().filter(is_leaf).copied().collect();
            if !finished.can_be_invalid() {
                free_trees(std::mem::take(&mut outcome.trees_to_free));
            }
        }
        outcome
    };
    let declaration_files: Guarded<Vec<(Vec<u8>, Vec<u8>)>> = Guarded::new(Vec::new());
    let accept = |outcome: Outcome| {
        // What was found is reported. What was not found may be missing, and the report lists the file as incomplete.
        for file in outcome.incomplete {
            let path = program.files.modules[file.idx()].path.clone();
            incomplete.lock().push(path);
        }
        unfinished.lock().extend(outcome.checked);
    };
    // THE REPORT. No task is running: every diagnostic is in the buffer of its file. It makes no query and reads no tree.
    let finish_files = || {
        let unfinished: Vec<Guarded<Option<(FileId, Checked)>>> = unfinished
            .lock()
            .drain(..)
            .map(|one| Guarded::new(Some(one)))
            .collect();
        host.parallel(unfinished.len(), &|i| {
            let (file, mut checked) = unfinished[i].lock().take().unwrap();
            if let Some(written) = checked.declaration_file.take() {
                let path = program.files.modules[file.idx()].path.clone();
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
    // An estimate of what it costs to check a file: how many identifiers its expressions have. Each is a symbol to find and a type to
    // work out. The size of the text says next to nothing: on storybook, tasks cut by it take 1.8 times as long as tasks cut by the
    // time itself, where tasks cut by this take 1.1 times.
    let is_identifier = |tag: ExprTag| tag == ExprTag::Ident;
    let costs: Vec<usize> = (to_check.iter())
        .map(|&file| {
            let tags = program.files.hir(file).exprs.iter().map(|it| it.kind.tag());
            tags.filter(|&tag| is_identifier(tag)).count() + 1
        })
        .collect();
    let size_of = |index: usize| costs[index];
    let plan = match request.plan_options.checkers {
        0 => Plan::new(to_check.len(), &bytes_of, &size_of, request.plan_options),
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
    // Returns the invalid tasks.
    let run_round = |number: usize, step: &[Task], wanted: Requested| -> Vec<Task> {
        // After the last step the published state is read by the loop over the files that are not checked, which runs with `after_file`,
        // and by a caller that goes on to ask about the program.
        let is_read_later = number + 1 != plan.steps.len()
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
            let files: Vec<FileId> = step[index].iter().map(|&file| to_check[file]).collect();
            let outcome = check_chunk(&files, wanted, Some((number, index, is_read_later)));
            *outcomes[index].lock() = Some(outcome);
            busy.fetch_add(began.elapsed().as_nanos() as u64, Ordering::Relaxed);
        });
        let in_tasks = started.elapsed();
        // THE BARRIER. Everything from here on is in task order.
        let mut outcomes: Vec<Outcome> = (outcomes.into_iter())
            .map(|mut outcome| outcome.get_mut().take().unwrap())
            .collect();
        let mut finished: Vec<Finished> = (outcomes.iter_mut())
            .map(|outcome| outcome.finished.take().unwrap())
            .collect();
        // The checkers of `checkerPool` share nothing, so there is no serial order to validate against.
        let mut invalid: Vec<Task> = Vec::new();
        if checker_count == 0 {
            let is_invalid = program.validate(&finished);
            let mut at = is_invalid.iter();
            finished.retain(|_| !*at.next().unwrap());
            let mut at = is_invalid.iter().zip(step);
            outcomes.retain(|_| {
                let (&is_invalid, task) = at.next().unwrap();
                if is_invalid {
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
        steps.lock().push(StepReport {
            tasks,
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
    let run_step = |number: usize, step: &[Task], wanted: Requested| {
        let mut invalid = run_round(number, step, wanted);
        while !invalid.is_empty() {
            let again = Plan::cut(invalid.concat(), &size_of, request.plan_options);
            invalid = run_round(number, &again, wanted);
        }
    };
    let global_errors = || -> Vec<Diagnostic> {
        program
            .global_errors()
            .iter()
            .map(|(code, args)| global(*code, args))
            .collect()
    };
    // `GetDiagnosticsOfAnyProgram`: TypeScript's command line goes on to the next kind of error only if there is none of the last. What
    // does not parse, or is checked under options that make no sense, gives errors that are not worth reading.
    let stops = request.stops_like_tsc;
    let check_files = |wanted: Requested| {
        for (number, step) in plan.steps.iter().enumerate() {
            run_step(number, step, wanted);
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
        // `iterateBaseline`: whoever writes something for every file does so for the files that are not checked as well.
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
    // What the program says of no file is at -1 (`NewCompilerDiagnostic`), what the checker says of none at 0 (`NewDiagnosticForNode`).
    let of_the_checker = program.global_errors();
    let in_no_file = report.diagnostics.partition_point(|d| d.path.is_empty());
    report.diagnostics[..in_no_file]
        .sort_by_key(|d| of_the_checker.iter().any(|(code, _)| *code == d.code));
    report.check_time = checking.elapsed();
    report.declaration_files = std::mem::take(&mut *declaration_files.lock());
    if let Some(checked) = request.checked {
        checked(&program);
    }
    (report, Some(Box::new(program)))
}
