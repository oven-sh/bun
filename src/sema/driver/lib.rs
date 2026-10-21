//! Type checks a project: finds its configuration and its files, checks them on every core, and reports the errors.
//!
//! `bun check`, `bun build --check` and `bun run --check` all use this, with different roots and different output
//! formatting.

pub mod format;
pub mod host;
pub mod outline;

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
use bun_sema::check::{Program, Requested, compute_ecma_line_starts};
use bun_sema::config::{self, ConfigError};
use bun_sema::hir::FileKind;
use bun_sema::json::Json;
use bun_sema::messages;
use bun_sema::program::{
    COMPARE_PATHS_CASE_SENSITIVE, FileId, Files, GlobalName, Run,
    declaration_emit_output_file_path, has_libraries, own_emit_output_file_path,
};
pub use bun_sema::resolve::ScriptKind;
use bun_sema::resolve::{
    Host, ModuleDetection, Options, ProjectFile, ProjectFiles, ancestors, contains_path,
    displayed_path, get_relative_path_from_directory, inside, is_declaration_file_name,
    is_javascript, is_javascript_file, is_relative, is_same_path, join,
    output_declaration_file_name, run_with_current_helpers, to_path, to_path_in, typescript_path,
};
use bun_sema::session::{Arena, Session};
use bun_sema::util::SharedSort;
use bun_sema::util::{FxHashMap, FxHashSet, ShardedMap};
use bun_sema::verify::verify_project_references;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::cmp::Reverse;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::ThreadId;
use std::time::{Duration, Instant};

/// The caches that a check's worker threads reuse from one file to the next. The threads belong to the pool and outlive
/// the check, so the caches are owned here. A thread holds its set for the duration of a parallel region and gets the
/// same set back in the next one. If a set moved from thread to thread, it would be grown and freed by a different
/// thread than the one that allocated it, and the allocator defers such frees.
#[derive(Default)]
pub struct ThreadCaches {
    idle: Guarded<Vec<CachesOfThread>>,
}

type CachesOfThread = (
    ThreadId,
    RecentAtoms,
    bun_sema_parser::ThreadCaches,
    bun_sema::bind::ThreadCaches,
);

impl ThreadCaches {
    /// Lends the calling thread its set until the guard is dropped.
    pub fn lend(&self) -> impl Drop + '_ {
        struct Lent<'a>(&'a ThreadCaches);
        impl Drop for Lent<'_> {
            fn drop(&mut self) {
                let set = (
                    std::thread::current().id(),
                    RecentAtoms::take(),
                    bun_sema_parser::ThreadCaches::take(),
                    bun_sema::bind::ThreadCaches::take(),
                );
                self.0.idle.lock().push(set);
            }
        }
        let thread = std::thread::current().id();
        let mut idle = self.idle.lock();
        let own = idle.iter().position(|set| set.0 == thread);
        let own = own.map(|at| idle.swap_remove(at));
        drop(idle);
        if let Some((_, atoms, parser, binder)) = own {
            atoms.install();
            parser.install();
            binder.install();
        }
        Lent(self)
    }

    /// Frees the buffers of the parser and the binder, which have the capacity of the largest file a thread has loaded.
    /// Call outside a parallel region.
    pub(crate) fn drop_parser_caches(&self) {
        drop(bun_sema_parser::ThreadCaches::take());
        drop(bun_sema::bind::ThreadCaches::take());
        for set in self.idle.lock().iter_mut() {
            (set.2, set.3) = Default::default();
        }
    }
}

/// The allocator retains a thread's free pages for that thread, and only that thread can release them. Each thread of
/// `pool` does so when it's next idle, like the bundler's `Worker::deinit_soon`.
fn release_free_pages_of(pool: &bun_threading::ThreadPool) {
    use bun_threading::thread_pool::{Node, Task};
    unsafe fn release(task: *mut Task) {
        // SAFETY: `task` was allocated below and queued once.
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

/// Runs `work(i)` for every `i` below `count` on Bun's shared thread pool, on at most `threads` threads at a time.
/// Indices are claimed in order, `run` consecutive ones at a time. Each thread takes the next run when it finishes its
/// previous one.
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
    let region = Region {
        caches,
        next: AtomicUsize::new(0),
        count,
        run,
        work,
    };
    // A pool thread runs the whole region itself. See `runs_regions_inline`.
    if runs_regions_inline() {
        return region.work_off();
    }
    let mut runners = vec![(); threads.clamp(1, count.div_ceil(run))];
    region_pool().each((), |(), (), _| region.work_off(), &mut runners);
}

/// Like `for_each_parallel_in_runs`, while the calling thread runs `meanwhile`. A thread for which
/// `runs_regions_inline` is true runs `meanwhile` afterwards.
pub(crate) fn for_each_parallel_while(
    caches: &ThreadCaches,
    threads: usize,
    count: usize,
    run: usize,
    work: &(dyn Fn(usize) + Sync),
    meanwhile: &mut dyn FnMut(),
) {
    if count == 0 || runs_regions_inline() {
        for_each_parallel_in_runs(caches, threads, count, run, work);
        return meanwhile();
    }
    let region = Region {
        caches,
        next: AtomicUsize::new(0),
        count,
        run,
        work,
    };
    let mut runners = vec![(); threads.clamp(1, count.div_ceil(run))];
    region_pool().each_while((), |(), (), _| region.work_off(), &mut runners, meanwhile);
}

/// Like `for_each_parallel_in_runs`, on the calling thread and on at most `helpers` pool threads. The calling thread
/// starts immediately, and at the end waits until each of the others has looked for work.
pub(crate) fn for_each_with_helpers(
    caches: &ThreadCaches,
    helpers: usize,
    count: usize,
    run: usize,
    work: &(dyn Fn(usize) + Sync),
) {
    let helpers = match helpers.min(count.div_ceil(run).saturating_sub(1)) {
        0 => 0,
        _ if runs_regions_inline() => 0,
        helpers => helpers,
    };
    let region = Region {
        caches,
        next: AtomicUsize::new(0),
        count,
        run,
        work,
    };
    region_pool().each_while(
        (),
        |(), (), _| region.work_off(),
        &mut vec![(); helpers],
        || region.work_off(),
    );
}

/// Like `for_each_parallel_in_runs`, on the calling thread, which runs a program, and on the other threads of that
/// program's share. Spare threads join whenever there are any, until the work runs out.
pub(crate) fn for_each_with_share(
    caches: &ThreadCaches,
    shares: &Shares,
    count: usize,
    run: usize,
    work: &(dyn Fn(usize) + Sync),
) {
    let region = Region {
        caches,
        next: AtomicUsize::new(0),
        count,
        run,
        work,
    };
    if runs_regions_inline() {
        return region.work_off();
    }
    let helpers = shares.helpers_of_this_thread();
    region_pool().each_while(
        (),
        |(), (), _| region.work_off(),
        &mut vec![(); helpers.min(count.div_ceil(run).saturating_sub(1))],
        || {
            let _lent = caches.lend();
            region.work_off_with_spare_threads(shares);
        },
    );
}

/// How a request's threads are divided among its programs while several of them run at the same time. Each program runs
/// on its own thread, which loads and checks it, and has a fixed number of other threads to help.
pub(crate) struct Shares {
    state: Guarded<SharesState>,
    has_changed: bun_threading::Condvar,
    /// Threads with nothing to do, which any program may borrow. Taking one back doesn't wait for the borrower, so this
    /// can be negative.
    spare: AtomicIsize,
}

struct SharesState {
    /// The threads that don't belong to any program. Once every program has its share, they're spare.
    free: usize,
    /// Number of programs that have their share. They get it in turn, so that small ones don't keep a large one
    /// waiting.
    served: usize,
    programs: usize,
    /// The thread that runs a program, and the number of helper threads that program has.
    helpers: Vec<(ThreadId, usize)>,
}

impl Shares {
    fn new(threads: usize, programs: usize) -> Shares {
        Shares {
            state: Guarded::new(SharesState {
                free: threads,
                served: 0,
                programs,
                helpers: Vec::new(),
            }),
            has_changed: bun_threading::Condvar::new(),
            spare: AtomicIsize::new(0),
        }
    }

    /// Takes the share of program number `turn`. Waits until the programs before it have their shares and `threads` are
    /// free.
    fn take(&self, turn: usize, threads: usize) {
        let mut state = self.state.lock();
        while state.served != turn || state.free < threads {
            self.has_changed.wait_guarded(&mut state);
        }
        state.free -= threads;
        state.served += 1;
        if state.served == state.programs {
            self.lend(std::mem::take(&mut state.free));
        }
        drop(state);
        self.has_changed.notify_all();
    }

    fn give_back(&self, threads: usize) {
        let mut state = self.state.lock();
        if state.served == state.programs {
            return self.lend(threads);
        }
        state.free += threads;
        drop(state);
        self.has_changed.notify_all();
    }

    fn lend(&self, threads: usize) {
        self.spare.fetch_add(threads as isize, Ordering::Relaxed);
    }

    fn take_back(&self, threads: usize) {
        self.spare.fetch_sub(threads as isize, Ordering::Relaxed);
    }

    /// Returns how many it got, at most `wanted`. The borrower lends each one again when it's done with it.
    fn borrow(&self, wanted: usize) -> usize {
        if wanted == 0 || self.spare.load(Ordering::Relaxed) <= 0 {
            return 0;
        }
        let mut borrowed = 0;
        let _ = (self.spare).try_update(Ordering::Relaxed, Ordering::Relaxed, |spare| {
            borrowed = spare.clamp(0, wanted as isize);
            Some(spare - borrowed)
        });
        borrowed as usize
    }

    fn helpers_of_this_thread(&self) -> usize {
        let thread = std::thread::current().id();
        let state = self.state.lock();
        let found = state.helpers.iter().find(|it| it.0 == thread);
        found.map_or(0, |it| it.1)
    }
}

/// Until it's dropped, the calling thread runs a program that has `helpers` other threads.
struct RunsHere<'a>(&'a Shares);

impl<'a> RunsHere<'a> {
    fn new(shares: &'a Shares, helpers: usize) -> RunsHere<'a> {
        let thread = std::thread::current().id();
        shares.state.lock().helpers.push((thread, helpers));
        RunsHere(shares)
    }
}

impl Drop for RunsHere<'_> {
    fn drop(&mut self) {
        let thread = std::thread::current().id();
        self.0.state.lock().helpers.retain(|it| it.0 != thread);
    }
}

static DEDICATED_POOL: OnceLock<bun_threading::ThreadPool> = OnceLock::new();

/// The parser nests as deep as on a thread of Bun's pool. The binder, the checker, hundreds of rules and the printers
/// then walk the tree recursively, each with its own frame size, so their threads get eight times that stack. Untouched
/// stack costs no memory.
pub const WORKER_STACK_SIZE: u32 = 8 * bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE;

static INLINE_REGION_THREADS: Guarded<Vec<ThreadId>> = Guarded::new(Vec::new());

/// From now on, parallel regions that start on the calling thread run only on that thread, like they do on a pool
/// thread. Call this on a thread outside the pool that pool threads wait for. If it waited for them too, they'd
/// deadlock.
pub fn run_regions_inline_on_this_thread() {
    INLINE_REGION_THREADS
        .lock()
        .push(std::thread::current().id());
}

/// A pool thread that waited for the others could wait forever, because they may all be waiting like it.
fn runs_regions_inline() -> bool {
    !bun_threading::thread_pool::Thread::current().is_null()
        || INLINE_REGION_THREADS
            .lock()
            .contains(&std::thread::current().id())
}

/// From now on parallel regions run on their own pool. This is for work that blocks its thread on something Bun's pool
/// does. `bun lint` waits for rules in JavaScript, and such a rule can wait for a `Worker`, whose files are read and
/// whose modules are loaded on that pool. `name`: the prefix of the thread names, before their number.
pub fn use_dedicated_pool(name: &'static str) {
    DEDICATED_POOL.get_or_init(|| {
        bun_threading::ThreadPool::init(bun_threading::thread_pool::Config {
            max_threads: u32::from(bun_core::get_thread_count()),
            stack_size: WORKER_STACK_SIZE,
            ..Default::default()
        })
        .named(name)
    });
}

/// The pool that parallel regions run on.
fn region_pool() -> &'static bun_threading::ThreadPool {
    DEDICATED_POOL
        .get()
        .unwrap_or_else(|| bun_threading::WorkPool::get())
}

/// State shared by the threads of [`for_each_parallel_in_runs`].
struct Region<'a> {
    caches: &'a ThreadCaches,
    next: AtomicUsize,
    count: usize,
    run: usize,
    work: &'a (dyn Fn(usize) + Sync),
}

impl Region<'_> {
    /// `work_off`, for a thread that already has its caches. Before each run it looks for spare threads to help.
    fn work_off_with_spare_threads(&self, shares: &Shares) {
        loop {
            let claimed = self.next.load(Ordering::Relaxed);
            let runs_left = self.count.saturating_sub(claimed).div_ceil(self.run);
            let helpers = shares.borrow(runs_left.saturating_sub(1));
            if helpers > 0 {
                return region_pool().each_while(
                    (),
                    |(), (), _| {
                        self.work_off();
                        shares.lend(1);
                    },
                    &mut vec![(); helpers],
                    || self.work_off_with_spare_threads(shares),
                );
            }
            let from = self.next.fetch_add(self.run, Ordering::Relaxed);
            if from >= self.count {
                break;
            }
            for i in from..(from + self.run).min(self.count) {
                (self.work)(i);
            }
        }
    }

    fn work_off(&self) {
        let _lent = self.caches.lend();
        loop {
            let from = self.next.fetch_add(self.run, Ordering::Relaxed);
            if from >= self.count {
                break;
            }
            for i in from..(from + self.run).min(self.count) {
                (self.work)(i);
            }
        }
    }
}

/// A checker is replaced after it has checked `1 / MIN_TASKS` of the total cost, because its private tables grow with
/// every file. A file that costs more than that is heavy and starts before the others.
const MIN_TASKS: usize = 128;
/// A thread takes a run of consecutive files from the queue at a time. The run's cost is the remaining cost divided by
/// the number of threads and by this.
const RUNS_PER_THREAD: usize = 4;

/// How many files a task checks. See `PlanOptions::task_size`.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum TaskSize {
    /// `1 / MIN_TASKS` of the total cost. In a program with fewer files than that, no two files share a task.
    #[default]
    ByCost,
    OneFile,
    /// Every file that its thread takes from the queue, for as long as they're in program order. With one thread and
    /// `Request::order` 1, one task checks the whole program.
    Unlimited,
}

/// How a request is run.
#[derive(Clone, Copy, Default)]
pub struct PlanOptions {
    /// Which files share a task normally depends on their cost and on which thread is free. The output doesn't depend
    /// on it, and tests use this and `discards_first_visits` to verify that.
    pub task_size: TaskSize,
    /// The first visit of every file is discarded like one that ends with an invalid commit, so the file is rechecked.
    pub discards_first_visits: bool,
    /// `Request::after_file` is only called for the files that are checked, not at the end for the declaration files
    /// and JSON files that aren't. The project's own declaration files, which aren't in the default library or in
    /// `node_modules`, count as checked even with `skipLibCheck`, which still means that nothing is reported for them.
    pub after_file_only_for_checked_files: bool,
    /// Only the files of a program that are in `Request::paths` are checked, not what they import. The types of their
    /// imports are computed on demand, as in an editor.
    pub checks_only_requested_paths: bool,
    /// `useSourceOfProjectReferenceRedirect`, as in an editor: an import that leads into a referenced project reads its
    /// source, even if it specifies a declaration file that the project would emit. No referenced project is checked
    /// for the sake of another, and nothing is emitted.
    pub reads_sources_of_references: bool,
    /// `GetCurrentDirectory` of a program is its configuration file's directory, like that of a tsserver
    /// `ConfiguredProject`. Without a configuration file it's `Request::cwd`, which is also what it is when this is
    /// off.
    pub uses_project_directory_as_cwd: bool,
    /// The caller ignores what's reported about the checked files. So no `Diagnostic` is built for it, because each one
    /// copies the lines around it, which in a one-line bundle is a copy of the file. And the files aren't checked:
    /// `Request::after_file` requests the types it needs. See `Requested::Types`.
    pub skips_file_diagnostics: bool,
    /// A file of `Request::paths` is only checked in a project that includes it: the project of the nearest
    /// configuration file or one that it references, or else the same for the configuration files further up
    /// (`findOrCreateDefaultConfiguredProjectWorker`). A file that no project includes isn't checked.
    pub requires_including_project: bool,
    /// With `requires_including_project`: `Request::project` isn't the project of every file. It's the project of
    /// the files that no project includes, which are checked after all. It's never rejected, and shares no parsed file
    /// with the others. Only applies if the request has more programs than threads. Otherwise those files stay
    /// unchecked, because a separate request after this one has all the threads for them, and this request's memory is
    /// free by then.
    pub project_is_fallback: bool,
    /// `CreateProgram` of tsgolint: there's no program for a configuration file that has an error, either in itself or
    /// in what the program reports about its options and files (`GetProgramDiagnostics`). No file is checked in it. See
    /// `Report::rejected_programs`.
    pub rejects_broken_configurations: bool,
    /// A program's `lib.*.d.ts` files come from the `typescript` installed for it: the first `node_modules/typescript`
    /// from the configuration file's directory upwards, if it has the files that `lib` and `target` require. Otherwise
    /// they're `Request::libs`. That way this reads the same declaration of `Element` as the project's own compiler.
    /// The configuration file is also interpreted the way that compiler does. See `resolve::INSTALLED_MAJOR`.
    pub prefers_project_typescript_libs: bool,
    /// Selects what a request's programs share, parsed once and kept until the end (`program::Run`). Off (`bun check`):
    /// the declaration files. On (`bun lint`): every file, including sources, because a typed run over a monorepo loads
    /// the same sources for a hundred programs.
    pub shares_every_file: bool,
    /// Nothing is checked. The caller only wants `Report::globals`. Of a project's root files, only those that can
    /// declare a global are loaded, judged by name and text (`may_declare_a_global`), plus the libraries and the
    /// `types` as always. Of their imports, only what declaration files import is loaded. A file of `Request::paths`
    /// with no configuration file above it isn't in any program, and nothing is reported for a program for which
    /// `Files::global_names` returns `None` or whose packages aren't installed.
    pub only_globals: bool,
    /// The memory of the machine, or of the container the process runs in. A request's programs run at the same time as
    /// long as they fit in a quarter of it. 0 means unknown, and they run one after the other.
    pub memory: usize,
}

/// The progress of a check. Read from another thread.
#[derive(Default)]
pub struct Progress {
    /// The number of files to check. 0 while the program is still loading.
    pub to_check: AtomicUsize,
    pub checked: AtomicUsize,
    /// The same in bytes of source, which predicts the remaining time better, because the largest files are checked
    /// first.
    pub bytes_to_check: AtomicUsize,
    pub bytes_checked: AtomicUsize,
    /// The number of errors found so far.
    pub errors: AtomicUsize,
}

/// A command-line compiler option and its value. `null` unsets the option.
#[derive(Clone)]
pub struct CompilerOption(Vec<u8>, Json);

/// The `Tristate` of the boolean command-line option `name`.
pub fn tristate(compiler_options: &[CompilerOption], name: &[u8]) -> Option<bool> {
    let option = compiler_options.iter().rfind(|option| option.0 == name)?;
    option.1.as_bool()
}

pub enum FlagError {
    /// No compiler option has this name.
    Unknown,
    /// The option requires a value and none was given, or it can't be given on a command line.
    NeedsValue,
    /// The option doesn't accept the value. Holds an enum's allowed values.
    BadValue(Vec<&'static [u8]>),
}

/// True if the compiler option `name`, matched case-insensitively, is a boolean, so its value may be omitted.
fn is_boolean_compiler_option(name: &[u8]) -> bool {
    bun_sema::config_options::choices(name) == Some(&[b"true".as_slice(), b"false"][..])
}

/// Parses `--name value` like `tsc`. `name` is matched case-insensitively. A boolean without a value is `true`.
fn compiler_option_from_flag(
    name: &[u8],
    value: Option<&[u8]>,
) -> Result<CompilerOption, FlagError> {
    use bun_sema::config_options::{choices, from_text, invalid_enum_type, possible_option};
    // These make `tsc` do something other than compile. A configuration file may contain them, with no effect.
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
        // `from_text` with an arbitrary text distinguishes an unknown option from one that needs a value.
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

/// A command-line flag that was rejected.
pub struct RejectedFlag {
    /// As written, up to `=`.
    pub flag: Vec<u8>,
    pub value: Option<Vec<u8>>,
    pub error: FlagError,
}

/// The result of `parseCommandLineWorker` for a command line's arguments.
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
    /// The `errors` about response files. See `Request::errors`.
    pub errors: Vec<Diagnostic>,
    /// The other `errors`. A caller may know more flags, and it words these errors itself.
    pub rejected: Vec<RejectedFlag>,
}

/// `shortOptionNames` of the options that are known here. Both names include their dashes.
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
    /// The response files being read, outermost first.
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
        const MAX_NESTED: usize = 64;
        let file_name = join(self.cwd, file_name);
        // `tryReadFile`. The original keeps reading a file that includes itself, or a long chain of files, until it
        // overflows its stack.
        let is_rejected =
            self.response_files.len() >= MAX_NESTED || self.response_files.contains(&file_name);
        let text = match is_rejected {
            true => None,
            false => host::read_at(&file_name, false),
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

    /// `parseOptionValue` for the flag `s`, which precedes `args[i]`. Returns the index of the next argument. Unlike
    /// the original, this also accepts the value after `=`.
    fn parse_option_value(&mut self, args: &[&[u8]], i: usize, s: &[u8]) -> usize {
        let (flag, inline_value) = match strings::index_of_char_usize(s, b'=') {
            Some(at) => (&s[..at], Some(&s[at + 1..])),
            None => (s, None),
        };
        let name = get_input_option_name(flag);
        if name.eq_ignore_ascii_case(b"build") {
            self.parsed.build = true;
            return i;
        }
        // A boolean only consumes the next argument if that's one of its values.
        let is_value = |next: &&[u8]| {
            !is_boolean_compiler_option(name) || matches!(*next, b"true" | b"false" | b"null")
        };
        let next = match inline_value {
            Some(_) => None,
            None => args.get(i).copied().filter(is_value),
        };
        let consumes_next = match compiler_option_from_flag(name, inline_value.or(next)) {
            Ok(CompilerOption(name, value)) => {
                // An empty list means `ParseListTypeOption` saw a flag, which isn't consumed and stays the next
                // argument.
                let consumes_next = value != Json::Array(Vec::new());
                if name == b"project" {
                    self.parsed.project = value.as_str().map(<[u8]>::to_vec);
                } else {
                    let options = &mut self.parsed.compiler_options;
                    options.retain(|option| option.0 != name);
                    options.push(CompilerOption(name, value));
                }
                consumes_next
            }
            Err(error) => {
                let is_known = !matches!(error, FlagError::Unknown);
                self.parsed.rejected.push(RejectedFlag {
                    flag: flag.to_vec(),
                    value: inline_value.or(next).map(<[u8]>::to_vec),
                    error,
                });
                is_known
            }
        };
        i + usize::from(next.is_some() && consumes_next)
    }
}

/// Returns the command-line options, followed by `noEmit`, since nothing is ever emitted.
fn overriding_options(request: &Request, is_build: bool) -> Vec<(Vec<u8>, Json)> {
    // `convertToOptionsWithAbsolutePaths`: a path on the command line is relative to the working directory, not to the
    // configuration file it overrides.
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
        // A caller that rejects broken configurations wants what `tsc -p` reports about them, including output paths
        // (5011, 5055).
        .chain(
            (!is_build && !request.build && !request.plan_options.rejects_broken_configurations)
                .then(|| (b"noEmit".to_vec(), Json::Bool(true))),
        )
        .collect()
}

/// Returns the `node_modules/typescript` nearest to the configuration file at `config`.
fn installed_typescript(host: &dyn Host, config: &[u8]) -> Option<Vec<u8>> {
    ancestors(dirname::<Posix>(config))
        .map(|directory| inside(directory, b"node_modules/typescript"))
        .find(|package| host.is_dir(package))
}

/// `resolve::INSTALLED_MAJOR` for the configuration file at `config`. See
/// `PlanOptions::prefers_project_typescript_libs`.
fn installed_typescript_defaults(
    host: &dyn Host,
    request: &Request,
    config: &[u8],
) -> Option<(Vec<u8>, Json)> {
    if !request.plan_options.prefers_project_typescript_libs {
        return None;
    }
    installed_major(host, config)
}

/// `resolve::INSTALLED_MAJOR`
fn installed_major(host: &dyn Host, config: &[u8]) -> Option<(Vec<u8>, Json)> {
    major_of_typescript_at(host, &installed_typescript(host, config)?)
}

fn major_of_typescript_at(host: &dyn Host, package: &[u8]) -> Option<(Vec<u8>, Json)> {
    let text = host.read(&inside(package, b"package.json"))?;
    let fields = host.parse_package_json(Session::new().arena(), &text)?;
    let version = fields.get(b"version")?.as_str()?;
    let major = &version[..strings::index_of_char_usize(version, b'.')?];
    let major: u32 = std::str::from_utf8(major).ok()?.parse().ok()?;
    let name = bun_sema::resolve::INSTALLED_MAJOR.to_vec();
    Some((name, Json::Number(f64::from(major))))
}

/// The TypeScript version that the type checker is a port of.
pub use bun_sema::resolve::VERSION_C as TYPESCRIPT_VERSION;

/// The location of TypeScript's `lib.*.d.ts` files.
#[derive(Copy, Clone)]
pub enum Libs<'a> {
    /// In the executable.
    Bundled(host::BundledLibs),
    /// In a directory, as a native path.
    Directory(&'a [u8]),
}

/// `Request::listed_projects`
pub trait ListedProjects: Sync {
    /// Returns the configuration files for the file at `path`, as absolute paths in the checker's format.
    fn of(&self, path: &[u8], is_case_sensitive: bool) -> &[Vec<u8>];
}

#[derive(Clone, Copy)]
pub struct Request<'a> {
    /// The working directory, as a native path.
    pub cwd: &'a [u8],
    /// `--project`: a configuration file, or a directory with a `tsconfig.json` in it.
    pub project: Option<&'a [u8]>,
    /// `parserOptions.project` of typescript-eslint, without `project`: a file of `paths` is checked in the first of
    /// these projects that has it among its root files (`getWatchProgramsForProjects`). The projects they reference
    /// aren't searched. A file that none of them has is checked as if there were no list.
    pub listed_projects: Option<&'a dyn ListedProjects>,
    /// `-b`: `tscBuildCompilation`, even for a project without `references`. Without `project`, the single entry of
    /// `paths` is the project, or else the working directory.
    pub build: bool,
    /// `commandLine.Errors`. If there are any, they are the report.
    pub errors: &'a [Diagnostic],
    /// Files and directories to check instead of all the project's files. The options are still the project's.
    pub paths: &'a [Vec<u8>],
    /// `paths` are the entry points of what is then run or bundled. JavaScript among them is loaded for what it
    /// imports, whatever `allowJs` is set to. Its own errors are those of `checkJs`.
    pub are_entry_points: bool,
    /// `Host::script_kind` of the `paths` whose names don't tell what they're run as.
    pub script_kinds: &'a [(Vec<u8>, ScriptKind)],
    /// `--loader .js:ts`: `Host::extra_file_extensions`, which is also `Host::script_kind` of the project's files that
    /// have these extensions.
    pub script_kinds_by_extension: &'a [(Vec<u8>, ScriptKind)],
    /// `--conditions` of what is run or bundled, besides `customConditions`.
    pub conditions: &'a [Box<[u8]>],
    /// Compiler options given on the command line. They override the configuration file, including those of referenced
    /// projects.
    pub compiler_options: &'a [CompilerOption],
    /// `0`: the number of cores.
    pub threads: usize,
    pub libs: Libs<'a>,
    /// Updated during the check, for a caller that displays progress.
    pub progress: Option<&'a Progress>,
    /// The order in which the files are queued. 1: the largest first. Any other odd number: by index * `order` (mod
    /// 2^32), a fixed permutation. The output doesn't depend on it, and tests use this to verify that.
    pub order: u32,
    pub plan_options: PlanOptions,
    /// Like `tsc`: if there are parse errors, only those are reported. Otherwise, if the options are inconsistent, only
    /// that is reported. Type errors come only after that.
    pub stops_like_tsc: bool,
    /// Uses TypeScript's wording verbatim where Bun would rephrase it (`bun add -d` for `npm i --save-dev`). For
    /// comparison with TypeScript.
    pub uses_typescript_wording: bool,
    /// Called for each file right after it's checked, on the thread that checked it, while the file-local types are
    /// still alive. This is how to read the type of every expression. A discarded task's files are rechecked, so this
    /// can be called more than once for a file, and the last call counts.
    pub after_file: Option<&'a (dyn Fn(&mut bun_sema::check::Checker<'_, '_>, FileId) + Sync)>,
}

/// A diagnostic, ready to be formatted.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// The file, in the checker's path format. Empty for a configuration error.
    pub path: Vec<u8>,
    /// Byte offsets.
    pub start: u32,
    /// Before `start` for a missing value in a JSON file, which decides the order.
    pub end: u32,
    /// `Loc` is `UndefinedTextRange`, which comes before offset 0: `NewCompilerDiagnostic`.
    pub has_undefined_range: bool,
    /// 1-based. Columns count UTF-16 code units, like TypeScript's.
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub code: u32,
    pub category: Category,
    /// The message. Lines after the first are the elaboration, indented by two spaces per level.
    pub text: Vec<u8>,
    /// `MessageArgs` and `MessageChain`, which `text` is built from.
    pub args: Box<[Box<[u8]>]>,
    pub message_chain: Vec<MessageChain>,
    /// Lines of the file from `source_line` on, without their line terminators: a few before the error, the lines it
    /// spans, a few after.
    pub source: Vec<Vec<u8>>,
    pub source_line: u32,
    /// Related information: `'x' is declared here.` These entries have no related information themselves.
    pub related: Vec<Diagnostic>,
    /// The project of a build that reported it, in build order. A file that two projects include counts as a file of
    /// each, just as it's a `SourceFile` of each program.
    pub project: u32,
}

/// `taskResult.builder`: how much of a `Report` one task of a build printed.
#[derive(Clone, Copy)]
pub struct TaskOutput {
    pub resolution_trace: usize,
    pub diagnostics: usize,
    pub listed_files: usize,
}

/// A file that isn't fully checked.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Incomplete {
    pub path: Vec<u8>,
    /// `hir::File::ran_out_of_stack`: the stack was too small for the tree. Otherwise it was too small for a checker
    /// query, which was abandoned.
    pub is_nested_too_deeply: bool,
}

impl Incomplete {
    /// Returns the message about the file, which is displayed as `path`.
    pub fn message(&self, path: &[u8]) -> Vec<u8> {
        let (before, after): (&[u8], &[u8]) = match self.is_nested_too_deeply {
            true => (
                b"the code in ",
                b" is nested too deeply: errors in this file may be missing.",
            ),
            false => (
                b"ran out of stack in ",
                b". This is a bug in Bun: errors in this file may be missing.",
            ),
        };
        [before, path, after].concat()
    }
}

/// A program that wasn't created, because its configuration file can't be read or because of
/// `PlanOptions::rejects_broken_configurations`.
pub struct RejectedProgram {
    pub config_path: Vec<u8>,
    /// The errors from reading the configuration file, or else the program's errors about its options and files.
    pub diagnostics: Vec<Diagnostic>,
    /// The files of `Request::paths` that would have been checked in it, each a `tspath.Path`.
    pub files: Vec<Vec<u8>>,
}

/// A program in which only some files were requested, and whose configuration file has neither `include` nor `files`,
/// and doesn't extend one that has. So it includes every file below it.
pub struct WithoutInclude {
    pub config_path: Vec<u8>,
    /// Number of files it includes.
    pub included: usize,
    /// Number of files of `Request::paths` that were checked in it.
    pub requested_files: usize,
    /// The first of them, a `tspath.Path`.
    pub example: Vec<u8>,
    pub load_time: Duration,
}

/// `PlanOptions::only_globals`
pub struct GlobalsOf {
    /// The files of `Request::paths` that are in the program, each a `tspath.Path`. Sorted.
    pub files: Vec<Vec<u8>>,
    pub names: Vec<GlobalName>,
    /// `checkJs`
    pub checks_javascript: bool,
}

#[derive(Default)]
pub struct Report {
    /// Sorted like TypeScript sorts them: diagnostics without a file first, then by path and position.
    pub diagnostics: Vec<Diagnostic>,
    /// Files whose errors may be incomplete.
    pub incomplete: Vec<Incomplete>,
    /// `Host::take_unreadable`: the source files that couldn't be read. Each was checked as an empty file.
    pub unreadable: Vec<Vec<u8>>,
    pub rejected_programs: Vec<RejectedProgram>,
    pub without_include: Vec<WithoutInclude>,
    pub globals: Vec<GlobalsOf>,
    /// True if `@types/bun` is installed where a checked project would resolve it.
    pub has_bun_types_installed: bool,
    /// By `package.json`.
    pub not_installed: Vec<NotInstalled>,
    /// The scripts of pages that checked files import, which aren't in those files' program.
    scripts_elsewhere: Vec<Vec<u8>>,
    /// `UseCaseSensitiveFileNames`
    pub is_case_sensitive: bool,
    /// `--quiet`, which only a command line can set. No diagnostic is printed.
    pub is_quiet: bool,
    /// `listFiles`: the lines. Under `explainFiles` they're what `ExplainFiles` prints. Otherwise, under `listFiles` or
    /// `listFilesOnly`, they're the program's files in program order.
    pub listed_files: Vec<Vec<u8>>,
    /// `traceResolution`: the lines, in order.
    pub resolution_trace: Vec<Vec<u8>>,
    /// The tasks of a build, in build order. Their output is at the end of `resolution_trace`, `diagnostics` and
    /// `listed_files`, and each task's output is printed together.
    pub tasks: Vec<TaskOutput>,
    pub files_loaded: usize,
    /// With several projects: the number of parses they share. A file that two of them load counts twice in
    /// `files_loaded`, and once here if both parse it the same way.
    pub shared_parses: usize,
    pub files_checked: usize,
    /// The files that would have been checked in a program with an error in its syntax, its options or its global
    /// types. As in `tsc`, nothing else is reported for such a program.
    pub files_not_checked: usize,
    /// The number of tasks that checked them. See `PlanOptions::task_size`.
    pub tasks_run: usize,
    /// Number of projects reported, if `references` are followed. Otherwise 0.
    pub projects_checked: usize,
    /// The configuration file has `references` and no files of its own, and `--build` wasn't given. `tsc` checks
    /// nothing in that case.
    pub follows_references: bool,
    /// `Options::writes_declaration_files`: each source file that a declaration file is emitted for, and the emitted
    /// text.
    pub declaration_files: Vec<(Vec<u8>, Vec<u8>)>,
    pub load_time: Duration,
    pub check_time: Duration,
    /// The maximum stack usage of any file, in bytes.
    pub deepest_stack: usize,
}

impl Report {
    /// True if the exit code is 0: there are no errors, and nothing was left unchecked.
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
        self.unreadable.extend(other.unreadable);
        self.rejected_programs.extend(other.rejected_programs);
        self.without_include.extend(other.without_include);
        self.globals.extend(other.globals);
        self.listed_files.extend(other.listed_files);
        self.scripts_elsewhere.extend(other.scripts_elsewhere);
        self.resolution_trace.extend(other.resolution_trace);
        self.tasks.extend(other.tasks);
        self.has_bun_types_installed |= other.has_bun_types_installed;
        self.files_loaded += other.files_loaded;
        self.shared_parses += other.shared_parses;
        self.files_checked += other.files_checked;
        self.files_not_checked += other.files_not_checked;
        self.tasks_run += other.tasks_run;
        self.check_time += other.check_time;
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

/// The number of lines before and after an error that are stored with it. The layout decides how many of them are
/// shown.
const LINES_BEFORE: u32 = 3;
const LINES_AFTER: u32 = 2;
/// A longer line isn't hand-written. No layout shows it, and only one character more than this is stored
/// (`Diagnostic::source`), because a one-line bundle can have thousands of errors.
pub const MAX_SHOWN_LINE: usize = 1000;

/// The options used when there's no configuration file: the ones `bun init` writes, without the purely stylistic rules.
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

/// Converts `ConfigError::chain` to a `MessageChain`. Each element goes under the last element of the level above.
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

/// TypeScript's messages tell how to install types with npm. This rewrites them for Bun.
fn with_bun_commands(text: Vec<u8>) -> Vec<u8> {
    const NPM: &[u8] = b"npm i --save-dev ";
    if strings::contains(&text, NPM) {
        strings::replace_owned(&text, NPM, b"bun add -d ")
    } else {
        text
    }
}

/// Returns `reported`, located at the bytes `start..end` of the file at `path`, whose text is `text` and whose line
/// starts are `starts`.
fn located(
    path: &[u8],
    text: &[u8],
    starts: &[u32],
    start: u32,
    end: u32,
    reported: Diagnostic,
) -> Diagnostic {
    located_after(
        &Counted::default(),
        path,
        text,
        starts,
        start,
        end,
        reported,
    )
}

/// `counted`: see `line_and_character`.
fn located_after(
    counted: &Counted,
    path: &[u8],
    text: &[u8],
    starts: &[u32],
    start: u32,
    end: u32,
    reported: Diagnostic,
) -> Diagnostic {
    let (line, character) = line_and_character(text, starts, start, counted);
    let (end_line, end_character) = line_and_character(text, starts, end.max(start), counted);
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

/// `GetECMALineAndUTF16CharacterOfPosition`: returns the 0-based line that contains `offset`, and the number of UTF-16
/// code units before it on that line. If one of the offsets in `counted` precedes it on the same line, counting starts
/// there instead of at the start of the line.
fn line_and_character(text: &[u8], starts: &[u32], offset: u32, counted: &Counted) -> (u32, u32) {
    let offset = offset.min(text.len() as u32);
    let line = starts.partition_point(|&s| s <= offset) - 1;
    let mut counted_offsets = counted.counted_offsets.get();
    let nearest = (0..counted_offsets.len())
        .filter(|&i| (starts[line]..=offset).contains(&counted_offsets[i].0))
        .max_by_key(|&i| counted_offsets[i].0);
    let (from, units) = nearest.map_or((starts[line], 0), |i| counted_offsets[i]);
    let character = units + strings::utf8_lossy_len_utf16(&text[from as usize..offset as usize]);
    let updated_index = nearest.unwrap_or_else(|| counted.older.get());
    counted_offsets[updated_index] = (offset, character);
    counted.counted_offsets.set(counted_offsets);
    counted.older.set(1 - updated_index);
    (line as u32, character)
}

/// Two offsets in a text that `line_and_character` was called with, each with its result. There are two because errors
/// that start at the same offset and end further and further on, like those of a chain of operators, alternate between
/// start and end.
#[derive(Default)]
struct Counted {
    counted_offsets: std::cell::Cell<[(u32, u32); 2]>,
    /// The index of the one that was written first.
    older: std::cell::Cell<usize>,
}

fn line_text(text: &[u8], starts: &[u32], line: u32) -> Vec<u8> {
    let from = starts[line as usize] as usize;
    let to = starts
        .get(line as usize + 1)
        .map_or(text.len(), |&s| s as usize);
    let line = text[from..to].trim_end_with(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'));
    let is_inside_a_character = |&at: &usize| line.get(at).is_some_and(|it| it & 0xC0 == 0x80);
    let end = (MAX_SHOWN_LINE + 1..).find(|at| !is_inside_a_character(at));
    line[..line.len().min(end.unwrap_or(line.len()))].to_vec()
}

/// Runs the check that `request` describes. Each program is freed with its `Session` as soon as it has been checked.
/// After `then` returns, the threads' caches are dropped too, and the free memory is returned to the system.
pub fn check_then<R>(request: &Request, then: impl FnOnce(Report) -> R) -> R {
    check_provided_then(request, host::Provided::default(), then)
}

/// `check_then`, for a caller that has read some of the files, or that watches them. With `Provided::ends_the_process`,
/// the other threads free the last program while `then` runs, and nothing else is freed, except under leak detection.
pub fn check_provided_then<R>(
    request: &Request,
    provided: host::Provided,
    then: impl FnOnce(Report) -> R,
) -> R {
    // A no-op if `bun lint` or `bun fmt` already created a pool.
    use_dedicated_pool("Bun Check");
    let threads = match request.threads {
        0 => usize::from(bun_core::get_thread_count()),
        n => n,
    };
    let cwd = host::from_native(request.cwd);
    let applies_to_every_file = !request.plan_options.project_is_fallback;
    let named = (request.project.filter(|_| applies_to_every_file))
        .or_else(|| request.paths.first().map(Vec::as_slice));
    let project = named.map_or_else(|| cwd.clone(), |it| host::from_argument(&cwd, it));
    let mut disk =
        host::Disk::with_already_read(threads, provided.already_read, &project).started_in(&cwd);
    disk.before_read = provided.before_read;
    disk.scripts_of_page = provided.scripts_of_page;
    disk.keeps_byte_order_marks = provided.keeps_byte_order_marks;
    disk.ends_the_process = provided.ends_the_process;
    if let Libs::Bundled(libs) = request.libs {
        disk.bundled_libs = Some(libs);
    }
    let script_kinds = request.script_kinds.iter().map(|(path, kind)| {
        let path = disk.with_on_disk_casing(&host::from_argument(&cwd, path));
        (to_path(&path, disk.is_case_sensitive()).into_owned(), *kind)
    });
    disk.script_kinds = script_kinds.collect();
    disk.script_kinds_by_extension = request.script_kinds_by_extension.to_vec();
    // Work outside a parallel region runs on this thread.
    let lent = disk.caches.lend();
    let report = check_request(&disk, request);
    let then = |mut report: Report| {
        report.is_case_sensitive = disk.is_case_sensitive();
        report.is_quiet = tristate(request.compiler_options, b"quiet") == Some(true);
        report.not_installed =
            dependencies_not_installed(&disk, &cwd, &project, &report.diagnostics);
        then(report)
    };
    if disk.ends_the_process {
        let sessions = std::mem::take(&mut *disk.to_drop_before_the_process_ends.lock());
        let (mut then, mut result) = (Some((then, report)), None);
        Session::drop_before_the_process_ends(sessions, |count, work| {
            disk.parallel_while(count, work, &mut || {
                result = then.take().map(|(then, report)| then(report));
            });
        });
        let result = result.expect("`parallel_while` calls `meanwhile`");
        if !bun_core::feature_flags::HELP_CATCH_MEMORY_ISSUES {
            let _not_dropped = std::mem::ManuallyDrop::new(lent);
            let _not_dropped = std::mem::ManuallyDrop::new(disk);
        }
        return result;
    }
    let result = then(report);
    drop(lent);
    disk.caches.idle.lock().clear();
    // The process continues, so the free pages are returned to the system.
    release_free_pages_of(region_pool());
    if let Some(io_pool) = disk.io_pool() {
        release_free_pages_of(io_pool);
    }
    bun_core::Global::mimalloc_cleanup(true);
    result
}

/// The dependencies of a `package.json` that an error mentions and that aren't in any `node_modules`.
pub struct NotInstalled {
    /// The path of the `package.json`.
    pub manifest: Vec<u8>,
    pub names: Vec<Vec<u8>>,
    /// True if it's the one that `bun install` in the working directory reads.
    pub is_cwd_manifest: bool,
}

/// `Report::not_installed`. An error without a file is about the project in `project`.
fn dependencies_not_installed(
    host: &dyn Host,
    cwd: &[u8],
    project: &[u8],
    diagnostics: &[Diagnostic],
) -> Vec<NotInstalled> {
    // The package name in each message, and the package that has its types.
    let mut missing: Vec<(&[u8], Vec<u8>)> = Vec::new();
    for reported in diagnostics {
        // `bun install` here can't install what a package in `node_modules` is missing.
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
    let cwd_manifest = nearest(cwd);
    let mut found: Vec<NotInstalled> = Vec::new();
    for (from, package) in missing {
        let Some(manifest) = nearest(from) else {
            continue;
        };
        // Yarn Plug'n'Play doesn't create a `node_modules`. Before Yarn 3 the file is `.pnp.js`.
        let has_file = |dir, name: &[u8]| host.is_file(&join(dir, name));
        if ancestors(from).any(|dir| has_file(dir, b".pnp.cjs") || has_file(dir, b".pnp.js")) {
            continue;
        }
        let text = host.read(&manifest);
        let Some(json) = text.and_then(|text| host.parse_package_json(&arena, &text)) else {
            continue;
        };
        // The types of `@scope/name` are in `@types/scope__name`.
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
                    is_cwd_manifest: cwd_manifest.as_ref() == Some(&manifest),
                    manifest: manifest.clone(),
                    names: vec![name],
                }),
            }
        }
    }
    found
}

/// The configuration files that a request has loaded, by path. Finding a path's project loads some of them, and each is
/// loaded once.
#[derive(Default)]
struct Projects {
    loaded: FxHashMap<Vec<u8>, Result<config::Project, Vec<ConfigError>>>,
    /// `Project::files`, as a set for lookups.
    files: FxHashMap<Vec<u8>, FxHashSet<Vec<u8>>>,
    /// An entry point is JavaScript (`Request::are_entry_points`). It belongs to the project that would include it
    /// under `allowJs`.
    includes_javascript: bool,
}

impl Projects {
    /// Returns `None` if `config` can't be read.
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

    /// Like `load`, but hands over ownership of the project.
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
        // `bun check` never emits. It's `tsc --noEmit`, which doesn't report errors about output paths. `tsc -b` has no
        // such option.
        config::load_overriding(disk, &Session::new(), config, &|_| {
            let mut options = overriding_options(request, false);
            options.extend(installed_typescript_defaults(disk, request, config));
            options
        })
    }

    /// Returns `config`, or else the first of the projects it references, directly or indirectly, that has `file` among
    /// its files.
    fn find_project_with(
        &mut self,
        disk: &host::Disk,
        request: &Request,
        config: &[u8],
        file: &[u8],
        follows_references: bool,
    ) -> Option<Vec<u8>> {
        let is_case_sensitive = disk.is_case_sensitive();
        let mut seen: Vec<Vec<u8>> = Vec::new();
        // The configuration files still to visit, next one last. It's a loop because a chain of references can be
        // arbitrarily long.
        let mut pending = vec![config.to_vec()];
        while let Some(config) = pending.pop() {
            let is_seen = |it: &Vec<u8>| is_same_path(it, &config, is_case_sensitive);
            if seen.iter().any(is_seen) || !disk.is_file(&config) {
                continue;
            }
            seen.push(config.clone());
            let is_new = !self.files.contains_key(&config);
            let includes_javascript = self.includes_javascript;
            let Some(project) = self.load(disk, request, &config) else {
                continue;
            };
            let references = project.references.iter().rev();
            pending.extend(
                references
                    .filter(|_| follows_references)
                    .map(|it| config::resolve_config_file_name_of_project_reference(&it.path)),
            );
            if is_new {
                let files = match includes_javascript {
                    false => project.files.clone(),
                    true => {
                        let with_javascript = |has_references: bool| {
                            let mut options = overriding_options(request, has_references);
                            options.push((b"allowJs".to_vec(), Json::Bool(true)));
                            options
                        };
                        config::load_overriding(disk, &Session::new(), &config, &with_javascript)
                            .map(|it| it.files)
                            .unwrap_or_default()
                    }
                };
                let paths = files.iter().map(|it| to_path(it, is_case_sensitive));
                let paths = paths.map(Cow::into_owned).collect();
                (self.files).insert(config.clone(), paths);
            }
            if self.files[&config].contains(&*to_path(file, is_case_sensitive)) {
                return Some(config);
            }
        }
        None
    }

    /// Adds the configuration file and the files of `config` and of the projects it references, directly or indirectly.
    /// `seen`: the configuration files.
    fn files_of_graph(
        &mut self,
        disk: &host::Disk,
        request: &Request,
        config: &[u8],
        seen: &mut Vec<Vec<u8>>,
        files: &mut Vec<Vec<u8>>,
    ) {
        // The configuration files still to add, next one last.
        let mut pending = vec![config.to_vec()];
        while let Some(config) = pending.pop() {
            let is_seen = |it: &Vec<u8>| is_same_path(it, &config, disk.is_case_sensitive());
            if seen.iter().any(is_seen) || !disk.is_file(&config) {
                continue;
            }
            seen.push(config.clone());
            let Some(project) = self.load(disk, request, &config) else {
                continue;
            };
            files.extend(project.files.iter().cloned());
            let references = project.references.iter().rev();
            pending.extend(
                references
                    .map(|it| config::resolve_config_file_name_of_project_reference(&it.path)),
            );
        }
    }

    /// Returns the project in which the file at `path` is checked, chosen like the language service does for an open
    /// file (`findDefaultConfiguredProject`): the project of the nearest configuration file, or else the first of the
    /// projects it references that has the file, as under a solution. Returns `Err` if none of them has it. Then the
    /// nearest configuration file is the best candidate, unless it's a solution, which has no files of its own and no
    /// options for them.
    fn owner_of(
        &mut self,
        disk: &host::Disk,
        request: &Request,
        nearest: Option<Vec<u8>>,
        path: &[u8],
    ) -> Result<Option<Vec<u8>>, Option<Vec<u8>>> {
        let must_include = request.plan_options.requires_including_project;
        let Some(nearest) = nearest else {
            return if must_include { Err(None) } else { Ok(None) };
        };
        if let Some(owner) = self.find_project_with(disk, request, &nearest, path, true) {
            return Ok(Some(owner));
        }
        // `getAncestorConfigFileName`
        let mut below = nearest.clone();
        loop {
            // With `--project`, no other configuration file is tried.
            let is_only_candidate =
                request.project.is_some() && !request.plan_options.project_is_fallback;
            if !must_include || is_only_candidate {
                break;
            }
            // Up to the root. The parent of `/C:` is `/`, which isn't a directory on Windows.
            let parent = ancestors(dirname::<Posix>(&below)).nth(1);
            let Some(above) = parent.and_then(|it| config::find_config(disk, it)) else {
                break;
            };
            if let Some(owner) = self.find_project_with(disk, request, &above, path, true) {
                return Ok(Some(owner));
            }
            below = above;
        }
        let project = self.load(disk, request, &nearest);
        let is_solution =
            project.is_some_and(|it| it.files.is_empty() && !it.references.is_empty());
        Err((!is_solution).then_some(nearest))
    }
}

/// Returns the project that's checked when there's no configuration file: `files` and what they import, as in `tsc
/// a.ts`. Without `files`, everything below `cwd`.
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

/// Returns the paths of the configuration files in directories below `top`.
fn nested_configs(disk: &host::Disk, top: &[u8]) -> Vec<Vec<u8>> {
    let (mut found, mut pending) = (Vec::new(), vec![top.to_vec()]);
    // By real path, because a link can lead back up.
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
            // Directories that no project includes by default.
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
    found.shared_sort_unstable();
    found
}

/// The error for a directory that has no configuration file at or above it, but has the ones in `below` under it.
fn no_project_here(cwd: &[u8], below: &[Vec<u8>]) -> Diagnostic {
    const MAX_LISTED: usize = 8;
    let relative =
        |config: &'_ [u8]| -> Vec<u8> { get_relative_path_from_directory(cwd, config, true) };
    let mut text = [
        b"No tsconfig.json in '",
        &*displayed_path(cwd),
        b"' or above it. Below it:",
    ]
    .concat();
    for config in below.iter().take(MAX_LISTED) {
        text.extend_from_slice(b"\n  ");
        text.extend_from_slice(&relative(config));
    }
    if below.len() > MAX_LISTED {
        let more = below.len() - MAX_LISTED;
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
    // Each script is checked once, in its own project, like a file passed as a path.
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    loop {
        let mut scripts = std::mem::take(&mut report.scripts_elsewhere);
        scripts.retain(|script| seen.insert(script.clone()));
        if scripts.is_empty() {
            return report;
        }
        // They get run no matter how they were found. See `Request::are_entry_points`.
        let page_scripts_request = Request {
            paths: &scripts,
            are_entry_points: true,
            ..*request
        };
        report.merge(check_paths(disk, &page_scripts_request));
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
        .map(|path| disk.with_on_disk_casing(&host::from_argument(&cwd, path)))
        .partition(|path| disk.is_dir(path) || disk.is_file(path));
    let not_found = (missing.iter()).map(|path| global(6053, &[displayed_path(path)]));
    report.diagnostics.extend(not_found);
    if paths.is_empty() && !missing.is_empty() {
        return report;
    }
    let project = request.project;
    let explicit = match project
        .map(|project| disk.with_on_disk_casing(&host::from_argument(&cwd, project)))
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
    let (explicit, fallback_project) = match request.plan_options.project_is_fallback {
        true => (None, explicit),
        false => (explicit, None),
    };
    // `--project`, or else the configuration file nearest to a directory, or else nearest to the working directory.
    // Cached by directory, because a linter run passes every file of a repository.
    let nearest_to: std::cell::RefCell<FxHashMap<Vec<u8>, Option<Vec<u8>>>> = Default::default();
    let config_in = |dir: &[u8]| {
        if explicit.is_some() {
            return explicit.clone();
        }
        if let Some(known) = nearest_to.borrow().get(dir) {
            return known.clone();
        }
        let nearest = config::find_config(disk, dir).or_else(|| config::find_config(disk, &cwd));
        nearest_to
            .borrow_mut()
            .insert(dir.to_vec(), nearest.clone());
        nearest
    };
    // The project that `tsc` compiles in a directory. If it finds none, the nearest one there is.
    let project_in = |dir: &[u8]| {
        let found = || config::find_config_file(disk, dir).or_else(|| config_in(dir));
        explicit.clone().or_else(found)
    };
    let mut projects = Projects {
        // Judged by name, the way `include` matches files.
        includes_javascript: request.are_entry_points && paths.iter().any(|it| is_javascript(it)),
        ..Default::default()
    };
    if paths.is_empty() {
        match project_in(&cwd) {
            Some(config) => {
                let target = ProjectToCheck {
                    config: Some(&config),
                    named: None,
                    checked_elsewhere: None,
                    run: None,
                    room_slot: None,
                };
                let projects = Guarded::new(projects);
                return check_project_of(disk, request, &projects, target, report, started);
            }
            None => {
                // `tsc` prints its help here. This doesn't guess which nested project is meant, because they're
                // fixtures and examples as often as packages. Before a run (`--check`), a list of commands that don't
                // run anything is useless, so it's skipped.
                let below = match request.are_entry_points {
                    true => Vec::new(),
                    false => nested_configs(disk, &cwd),
                };
                if !below.is_empty() {
                    report.diagnostics.push(no_project_here(&cwd, &below));
                    return report;
                }
                // Checks whatever is here, with the default options.
                paths.push(cwd.clone())
            }
        }
    }

    // Each file is checked in its own project, once.
    let mut by_project: Vec<(Option<Vec<u8>>, Extent, Vec<Vec<u8>>)> = Vec::new();
    // Searches from the end, because most files are in the same project as the previous one.
    let mut add = |owner: Option<Vec<u8>>, extent: Extent, file: Vec<u8>| match by_project
        .iter_mut()
        .rev()
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
            let listed = (request.listed_projects.filter(|_| explicit.is_none()))
                .map_or(&[][..], |it| it.of(path, is_case_sensitive));
            let first = (listed.iter())
                .find_map(|it| projects.find_project_with(disk, request, it, path, false));
            if first.is_some() {
                add(first, Extent::Project, path.clone());
                continue;
            }
            let nearest = config_in(dirname::<Posix>(path));
            match projects.owner_of(disk, request, nearest, path) {
                Err(_) if request.plan_options.requires_including_project => {
                    if fallback_project.is_some() {
                        add(fallback_project.clone(), Extent::Project, path.clone());
                    }
                }
                Ok(owner) | Err(owner) => add(owner, Extent::Project, path.clone()),
            }
            continue;
        }
        // A directory means the part of the project that's inside it. The project is the one that would be checked from
        // there without an argument, so that `bun check .` equals `bun check`. The projects list their own files. A
        // configuration file in the directory is checked too.
        let is_in_directory = |file: &Vec<u8>| contains_path(path, file, is_case_sensitive);
        if let Some(config) = project_in(path) {
            let (mut configs, mut files) = (Vec::new(), Vec::new());
            projects.files_of_graph(disk, request, &config, &mut configs, &mut files);
            files.retain(is_in_directory);
            if !files.is_empty() {
                files.extend(configs.into_iter().filter(is_in_directory));
                files.shared_sort_by_cached_key(|it| to_path(it, is_case_sensitive).into_owned());
                files.dedup_by(|a, b| is_same(a, b));
                (files.into_iter()).for_each(|file| add(Some(config.clone()), Extent::Graph, file));
                continue;
            }
        }
        // The project has nothing there, as in `bun check scripts`, or there's no project. Each configuration file at,
        // above or below the directory decides about the files nearest to it.
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
            // A configuration file that can't be read excludes nothing. `check_project_of` reports it.
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
            // A directory means the files the project has in it. If the project has none there, as in `bun check
            // scripts`, it means every file the project doesn't exclude.
            let files = if included.is_empty() {
                others
            } else {
                included
            };
            (files.into_iter()).for_each(|(owner, file)| add(owner, Extent::Project, file));
        }
    }
    // Drops a file that was passed in addition to a directory that contains it.
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
    let runs_concurrently = request.plan_options.memory != 0 && disk.threads() > 1;
    if !(runs_concurrently && by_project.len() > disk.threads()) {
        by_project.retain(|it| fallback_project.is_none() || it.0 != fallback_project);
    }
    let only_globals = request.plan_options.only_globals;
    by_project.retain(|it| !it.2.is_empty() && !(only_globals && it.0.is_none()));
    if by_project.is_empty() && only_globals {
        return report;
    }
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
    let is_single_project = by_project.len() == 1;
    let paths_of = |files: &'_ [Vec<u8>]| -> Vec<Vec<u8>> {
        let paths = files.iter().map(|it| to_path(it, is_case_sensitive));
        paths.map(Cow::into_owned).collect()
    };
    let paths_by_project: Vec<Vec<Vec<u8>>> = by_project.iter().map(|it| paths_of(&it.2)).collect();
    let all: FxHashSet<&[u8]> = (paths_by_project.iter().flatten())
        .map(Vec::as_slice)
        .collect();
    // Declared before any program's session, so it's dropped after them.
    let run_session = Session::new();
    let max_concurrent = match request.plan_options.memory {
        0 => 1,
        _ => disk.threads().min(by_project.len()),
    };
    // Programs with the most files go first, so that no thread starts a large one when the others are nearly done.
    let mut in_order: Vec<usize> = (0..by_project.len()).collect();
    if max_concurrent > 1 {
        in_order.shared_sort_by_key(|&it| Reverse(by_project[it].2.len()));
    }
    let run = (!is_single_project).then(|| {
        let run = Run::new(&run_session, disk.provided_paths().cloned().collect());
        match request.plan_options.shares_every_file {
            true => run,
            false => run.sharing_only_declaration_files(),
        }
    });
    let projects = Guarded::new(projects);
    let shared_bytes = || run.as_ref().map_or(0, Run::bytes);
    let shares =
        (max_concurrent > 1).then(|| Arc::new(Shares::new(disk.threads(), by_project.len())));
    (*disk.shares.lock()).clone_from(&shares);
    let room = Room {
        bytes: (request.plan_options.memory / 4).max(1 << 30),
        shared_bytes: &shared_bytes,
        threads: disk.threads(),
        shares: shares.as_deref(),
        usage: Guarded::new(RoomUsage::default()),
        has_changed: bun_threading::Condvar::new(),
    };
    let next = AtomicUsize::new(0);
    let reports: Vec<Guarded<Option<Report>>> =
        by_project.iter().map(|_| Guarded::new(None)).collect();
    // Each program starts once there are threads and memory for it.
    let check_next_programs = || {
        loop {
            let turn = next.fetch_add(1, Ordering::Relaxed);
            let Some(&index) = in_order.get(turn) else {
                break;
            };
            let (config, extent, files) = &by_project[index];
            let own: FxHashSet<&[u8]> = (paths_by_project[index].iter())
                .map(Vec::as_slice)
                .collect();
            let checked_elsewhere: FxHashSet<&[u8]> = all.difference(&own).copied().collect();
            let room_slot = room.enter(turn, files.len(), all.len());
            let target = ProjectToCheck {
                config: config.as_deref(),
                named: Some((*extent, files.as_slice())),
                checked_elsewhere: (!is_single_project).then_some(&checked_elsewhere),
                run: (run.as_ref())
                    .filter(|_| fallback_project.is_none() || *config != fallback_project),
                room_slot: (max_concurrent > 1).then_some(&room_slot),
            };
            let (so_far, began) = (Report::default(), Instant::now());
            let checked = check_project_of(disk, request, &projects, target, so_far, began);
            *reports[index].lock() = Some(checked);
        }
    };
    // A thread that loads and checks a program needs a worker's stack. The calling thread only has the stack it was
    // given, so in that case it just waits.
    std::thread::scope(|scope| {
        let (threads, mut started) = (
            if max_concurrent > 1 {
                max_concurrent
            } else {
                0
            },
            0,
        );
        for _ in 0..threads {
            // If the thread can't be spawned, the others check its share.
            let thread = std::thread::Builder::new()
                .stack_size(WORKER_STACK_SIZE as usize)
                .spawn_scoped(scope, || {
                    // Same as a pool thread does when it starts, because the parsers check the stack.
                    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Check"));
                    check_next_programs();
                });
            started += usize::from(thread.is_ok());
        }
        if started == 0 {
            check_next_programs();
        }
    });
    *disk.shares.lock() = None;
    for mut checked in reports {
        let Some(checked) = checked.get_mut().take() else {
            continue;
        };
        report.projects_checked += checked
            .projects_checked
            .max(usize::from(!is_single_project));
        report.merge(checked);
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    if request.plan_options.shares_every_file {
        report.shared_parses += run.as_ref().map_or(0, Run::parses);
    }
    if !is_single_project {
        sort_as_one_project(&mut report);
    }
    report
}

/// The scope of the files that a check is limited to.
#[derive(Clone, Copy, PartialEq)]
enum Extent {
    /// They're in the project, or get added to it. The projects it references are built in full.
    Project,
    /// They're in the project or in the projects it references, directly or indirectly, as files or configuration
    /// files. Among these projects, one without such a file is skipped unless a project with such a file references it,
    /// and one that consists only of such files is checked in full.
    Graph,
}

/// The input of `check_project_of`.
#[derive(Clone, Copy)]
struct ProjectToCheck<'a, 'u> {
    /// `None`: there is no configuration file.
    config: Option<&'a [u8]>,
    /// `None`: all of its files.
    named: Option<(Extent, &'a [Vec<u8>])>,
    /// The files that are checked in another project, by `tspath.Path`. This one may import them.
    checked_elsewhere: Option<&'a FxHashSet<&'a [u8]>>,
    /// The request's `Run`, if it has more than one project.
    run: Option<&'a Run<'u>>,
    /// Its slot among the programs that run at the same time.
    room_slot: Option<&'a RoomSlot<'a>>,
}

/// Limits how many programs of a request run at the same time: as many as there are threads and memory for. A program's
/// memory use isn't known before its files are found. Until then it's estimated as the average of the programs that
/// have ended. From then on it's estimated as its current size plus what a check has added on average. A program that
/// turns out larger than the available room continues once others have ended.
struct Room<'a> {
    /// The memory budget of the process.
    bytes: usize,
    /// The size in bytes of what the programs share, which grows.
    shared_bytes: &'a (dyn Fn() -> usize + Sync),
    threads: usize,
    /// `None`: the programs run one after the other, with all threads.
    shares: Option<&'a Shares>,
    usage: Guarded<RoomUsage>,
    has_changed: bun_threading::Condvar,
}

#[derive(Default)]
struct RoomUsage {
    bytes: usize,
    programs: usize,
    /// Programs whose files are found and that are continuing.
    continuing_programs: usize,
    /// Programs waiting for room.
    waiting: usize,
    /// The largest size of a program so far.
    largest: usize,
    ended: usize,
    /// The total size of the programs that have ended.
    ended_bytes: usize,
    /// The part of it that they allocated after their files were found.
    added: usize,
}

/// A program's slot in a `Room`, held until it's dropped.
struct RoomSlot<'a> {
    room: &'a Room<'a>,
    bytes: AtomicUsize,
    /// Its size when its files were found.
    found: AtomicUsize,
    is_continuing: std::sync::atomic::AtomicBool,
    /// Its share of the threads.
    threads: usize,
    /// Its share of the files is no more than one thread's share of the work, so one thread checks it.
    fits_one_thread: bool,
}

impl Room<'_> {
    /// There's always room for a program of this size on each thread, unless `bytes` is too small.
    const SMALL: usize = 64 << 20;

    /// True if the programs' estimates may add up to `bytes`. Then the request uses at most half as much again as when
    /// it runs one program after the other, which takes the shared part plus the largest program, and the process uses
    /// at most `self.bytes`. Part of what the estimates cover is already resident, so this errs on the safe side.
    fn has_room_for(&self, usage: &RoomUsage, bytes: usize) -> bool {
        let shared_bytes = (self.shared_bytes)();
        let resident = bun_sys::self_process_memory_usage().unwrap_or(shared_bytes);
        let one_after_the_other = shared_bytes + usage.largest;
        bytes <= (usage.largest + one_after_the_other / 2).max(self.threads * Room::SMALL)
            && resident + bytes <= self.bytes
    }

    /// Waits, for a program that has `threads`. They're lent out in the meantime.
    fn wait(
        &self,
        usage: &mut bun_threading::guarded::GuardedLock<'_, RoomUsage, bun_threading::Mutex>,
        threads: usize,
    ) {
        if let Some(shares) = self.shares {
            shares.lend(threads);
        }
        usage.waiting += 1;
        self.has_changed.wait_guarded(usage);
        usage.waiting -= 1;
        if let Some(shares) = self.shares {
            shares.take_back(threads);
        }
    }

    /// Enters program number `turn`, which has `files` of `all` files. Waits until it has its threads, and until
    /// there's room for one more program or nothing else runs.
    fn enter(&self, turn: usize, files: usize, all: usize) -> RoomSlot<'_> {
        let threads = (files * self.threads / all.max(1)).clamp(1, self.threads);
        if let Some(shares) = self.shares {
            shares.take(turn, threads);
        }
        let mut usage = self.usage.lock();
        loop {
            let bytes = (usage.ended_bytes / usage.ended.max(1)).max(Room::SMALL);
            if usage.programs == 0 || self.has_room_for(&usage, usage.bytes + bytes) {
                usage.programs += 1;
                usage.bytes += bytes;
                return RoomSlot {
                    room: self,
                    bytes: AtomicUsize::new(bytes),
                    found: AtomicUsize::new(0),
                    is_continuing: std::sync::atomic::AtomicBool::new(false),
                    threads,
                    fits_one_thread: files * self.threads <= all,
                };
            }
            self.wait(&mut usage, threads);
        }
    }
}

impl RoomSlot<'_> {
    fn set_estimate(&self, usage: &mut RoomUsage, bytes: usize) {
        usage.bytes = usage
            .bytes
            .saturating_sub(self.bytes.swap(bytes, Ordering::Relaxed))
            + bytes;
    }

    /// Call once the program's files are found and its size is `bytes`. Waits until there's room for its expected size,
    /// or until no other program is continuing.
    fn files_found(&self, bytes: usize) {
        let mut usage = self.room.usage.lock();
        self.found.store(bytes, Ordering::Relaxed);
        usage.largest = usage.largest.max(bytes);
        let expected = bytes + usage.added / usage.ended.max(1);
        self.set_estimate(&mut usage, expected);
        self.room.has_changed.notify_all();
        while usage.continuing_programs > 0 && !self.room.has_room_for(&usage, usage.bytes) {
            self.room.wait(&mut usage, self.threads);
        }
        usage.continuing_programs += 1;
        self.is_continuing.store(true, Ordering::Relaxed);
    }

    /// Records the program's final size, `bytes`.
    fn record_final_size(&self, bytes: usize) {
        let mut usage = self.room.usage.lock();
        let found = self.found.load(Ordering::Relaxed);
        usage.largest = usage.largest.max(bytes);
        usage.ended += 1;
        usage.ended_bytes += bytes;
        usage.added += bytes.saturating_sub(found);
        self.set_estimate(&mut usage, bytes);
    }
}

impl Drop for RoomSlot<'_> {
    fn drop(&mut self) {
        let mut usage = self.room.usage.lock();
        usage.bytes = usage.bytes.saturating_sub(*self.bytes.get_mut());
        usage.programs -= 1;
        if *self.is_continuing.get_mut() {
            usage.continuing_programs -= 1;
        }
        let has_waiting_program = usage.waiting > 0;
        drop(usage);
        // Memory of this program that the allocator retains for reuse is resident too.
        if has_waiting_program {
            bun_core::Global::mimalloc_cleanup(true);
        }
        self.room.has_changed.notify_all();
        if let Some(shares) = self.room.shares {
            shares.give_back(self.threads);
        }
    }
}

fn check_project_of(
    disk: &host::Disk,
    request: &Request,
    projects: &Guarded<Projects>,
    target: ProjectToCheck<'_, '_>,
    mut report: Report,
    started: Instant,
) -> Report {
    let mut project = match target.config {
        Some(config) => match projects.lock().take(disk, request, config) {
            Ok(project) => project,
            // `tscCompilation`: "these are unrecoverable errors--exit to report them as diagnostics". For a build it's
            // `upToDateStatusTypeConfigFileNotFound`.
            Err(errors) => {
                let is_case_sensitive = disk.is_case_sensitive();
                let files = target.named.map(|it| it.1).unwrap_or_default().iter();
                let mut last = None;
                let diagnostics: Vec<Diagnostic> = (errors.iter())
                    .map(|it| diagnostic_from_config_error(disk, config, it, &mut last))
                    .collect();
                if !request.plan_options.rejects_broken_configurations {
                    match request.build {
                        true => report
                            .diagnostics
                            .push(global(6053, &[displayed_path(config)])),
                        false => report.diagnostics.extend(diagnostics.iter().cloned()),
                    }
                    report.load_time = started.elapsed();
                }
                report.rejected_programs.push(RejectedProgram {
                    config_path: config.to_vec(),
                    diagnostics,
                    files: files
                        .map(|it| to_path(it, is_case_sensitive).into_owned())
                        .collect(),
                });
                return report;
            }
        },
        None => {
            let cwd = host::from_native(request.cwd);
            let files = target.named.map(|it| it.1).unwrap_or_default();
            project_without_config(disk, request, &cwd, files)
        }
    };
    let is_case_sensitive = disk.is_case_sensitive();
    let named = target.named.map(|(extent, named)| {
        if extent == Extent::Project && !request.plan_options.only_globals {
            // Load the whole project even when only some files are checked. Global declarations and module
            // augmentations from any file affect every other file, so a file must produce the same errors with and
            // without path arguments.
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
            // An empty file set in the config file isn't an error when path arguments provide the roots.
            project
                .errors
                .retain(|e| e.code != 18003 && e.code != 18002);
        }
        // From here on they're only used for lookups.
        let named = named.iter().map(|it| to_path(it, is_case_sensitive));
        let mut named: Vec<Vec<u8>> = named.map(Cow::into_owned).collect();
        named.shared_sort_unstable();
        (extent, named)
    });
    let named = (named.as_ref()).map(|(extent, files)| (*extent, files.as_slice()));
    // Done after the configuration file is read, so what it includes and whether its options are consistent is judged
    // the same as in a plain `bun check`.
    let names_javascript =
        |it: (Extent, &[Vec<u8>])| it.1.iter().any(|file| is_javascript_file(disk, file));
    if request.are_entry_points && named.is_some_and(names_javascript) {
        project.options.allow_js = true;
    }
    if request.build || !project.references.is_empty() {
        check_with_references(
            disk,
            project,
            request,
            report,
            started,
            named,
            target.checked_elsewhere,
            target.run,
            target.room_slot,
        )
    } else {
        // All target its files were passed, so the whole project is checked, including files that nothing imports.
        let is_whole = |(extent, named): &(Extent, &[Vec<u8>])| {
            let is_named = |it: &Vec<u8>| is_among(named, &to_path(it, is_case_sensitive));
            *extent == Extent::Graph && project.files.iter().all(is_named)
        };
        let named = named.filter(|it| !is_whole(it)).map(|it| it.1);
        let is_elsewhere = (target.checked_elsewhere)
            .map(|checked_elsewhere| |path: &[u8]| checked_elsewhere.contains(path));
        check_named_files(
            disk,
            project,
            request,
            report,
            started,
            named,
            (is_elsewhere.as_ref()).map(|it| it as &dyn Fn(&[u8]) -> bool),
            None,
            target.run,
            target.room_slot,
        )
    }
}

/// `named` is sorted. Its entries and `file` are `tspath.Path`s.
fn is_among(named: &[Vec<u8>], file: &[u8]) -> bool {
    named.binary_search_by(|it| it.as_slice().cmp(file)).is_ok()
}

struct ReferencedProject {
    project: config::Project,
    /// `upStream`, as indices into the list of projects. A reference that closes a cycle isn't included.
    up_stream: Vec<usize>,
}

/// `Orchestrator`, limited to `GenerateGraph`.
struct Graph<'h> {
    host: &'h dyn Host,
    request: &'h Request<'h>,
    overrides: Vec<(Vec<u8>, Json)>,
    /// `tasks`, until `setup_build_task` takes them: `config` and `resolved`, by the `tspath.Path`
    /// of the configuration file.
    tasks: FxHashMap<Vec<u8>, (Vec<u8>, Option<config::Project>)>,
    /// `order`: dependencies first.
    projects: Vec<ReferencedProject>,
    /// Keyed by the `tspath.Path` of a configuration file, each of which is loaded once. `completed` is its index in
    /// `projects`, and `analyzing` is `None`.
    index_of: FxHashMap<Vec<u8>, Option<usize>>,
    circularity_stack: Vec<Vec<u8>>,
    /// `errors`: TS6202. If there's one, nothing is built.
    errors: Vec<Diagnostic>,
    /// `upToDateStatusTypeConfigFileNotFound`, which a task reports when it runs, with the number of `projects` before
    /// it in the order.
    not_found: Vec<(usize, Diagnostic)>,
}

impl Graph<'_> {
    /// `createBuildTasks`: a configuration file is loaded once, under the name used by the task that runs first. The
    /// tasks of a `singleThreadedWorkGroup` run last in, first out.
    fn create_build_tasks(&mut self, root: config::Project) {
        let key = |name: &[u8]| to_path(name, self.host.is_case_sensitive()).into_owned();
        let referenced = |project: &config::Project| -> Vec<Vec<u8>> {
            let references = project.references.iter();
            let name = |it: &config::ProjectReference| {
                config::resolve_config_file_name_of_project_reference(&it.path)
            };
            references.map(name).collect()
        };
        let load = |config: &[u8]| -> Option<config::Project> {
            let over = |_: bool| {
                let mut options = self.overrides.clone();
                let defaults = installed_typescript_defaults(self.host, self.request, config);
                options.extend(defaults);
                options
            };
            if !self.host.is_file(config) {
                return None;
            }
            // The parse result is freed immediately, because there can be tens of thousands.
            config::load_overriding(self.host, &Session::new(), config, &over).ok()
        };
        // Loads on all threads, by name: what the root references, then what those reference, and so on.
        let mut ahead: FxHashMap<Vec<u8>, Option<config::Project>> = FxHashMap::default();
        let mut names = referenced(&root);
        loop {
            names.shared_sort_unstable();
            names.dedup();
            names.retain(|name| !ahead.contains_key(name));
            let loaded: Vec<Guarded<Option<config::Project>>> =
                names.iter().map(|_| Guarded::new(None)).collect();
            match &names[..] {
                [] => break,
                [name] => *loaded[0].lock() = load(name),
                names => (self.host).parallel(names.len(), &|at| {
                    *loaded[at].lock() = load(&names[at]);
                }),
            }
            let loaded = loaded.into_iter().map(|mut it| it.get_mut().take());
            let before = std::mem::take(&mut names);
            for (name, project) in before.into_iter().zip(loaded) {
                names.extend(project.iter().flat_map(&referenced));
                ahead.insert(name, project);
            }
        }
        let mut queued = referenced(&root);
        let config = root.config_path.clone();
        self.tasks.insert(key(&config), (config, Some(root)));
        while let Some(config) = queued.pop() {
            let path = key(&config);
            if self.tasks.contains_key(&path) {
                continue;
            }
            let resolved = ahead.remove(&config).flatten();
            if let Some(project) = &resolved {
                queued.extend(referenced(project));
            }
            self.tasks.insert(path, (config, resolved));
        }
    }

    /// The start of `setupBuildTask`. Returns `Err` if the task isn't new, with its index in `projects`, or `None` if
    /// nothing has to wait for it.
    fn open_build_task(
        &mut self,
        config_name: &[u8],
        in_circular_context: bool,
    ) -> Result<OpenTask, Option<usize>> {
        let path = to_path(config_name, self.host.is_case_sensitive()).into_owned();
        if let Some(&index) = self.index_of.get(&path) {
            // `analyzing`
            if index.is_none() && !in_circular_context {
                let stack = self.circularity_stack.join(&b'\n');
                self.errors.push(global(6202, &[stack]));
            }
            return Err(index);
        }
        // A missing entry means the task is `completed` and its configuration file wasn't found.
        let Some((config, resolved)) = self.tasks.remove(&path) else {
            return Err(None);
        };
        let Some(project) = resolved else {
            let before = self.projects.len();
            let not_found = global(6053, &[displayed_path(&config)]);
            self.not_found.push((before, not_found));
            return Err(None);
        };
        self.index_of.insert(path.clone(), None);
        let displayed = displayed_path(config_name).into_owned();
        self.circularity_stack.push(displayed);
        Ok(OpenTask {
            path,
            project,
            references_done: 0,
            up_stream: Vec::new(),
            in_circular_context,
        })
    }

    /// `setupBuildTask` for the project at `config_name` and everything it references. It's a loop because a chain of
    /// references can be arbitrarily long.
    fn setup_build_tasks(&mut self, config_name: &[u8]) {
        // The tasks whose references are being set up, each referenced by the one before it.
        let in_circular_context = false;
        let root = self.open_build_task(config_name, in_circular_context);
        let mut open: Vec<OpenTask> = root.into_iter().collect();
        while let Some(mut task) = open.pop() {
            let index = match task.project.references.get(task.references_done) {
                Some(reference) => {
                    let name =
                        config::resolve_config_file_name_of_project_reference(&reference.path);
                    let in_circular_context = task.in_circular_context || reference.circular;
                    task.references_done += 1;
                    open.push(task);
                    match self.open_build_task(&name, in_circular_context) {
                        Ok(referenced) => {
                            open.push(referenced);
                            continue;
                        }
                        Err(index) => index,
                    }
                }
                None => {
                    self.circularity_stack.pop();
                    let index = self.projects.len();
                    self.index_of.insert(task.path, Some(index));
                    self.projects.push(ReferencedProject {
                        project: task.project,
                        up_stream: task.up_stream,
                    });
                    Some(index)
                }
            };
            if let Some(waiting) = open.last_mut() {
                waiting.up_stream.extend(index);
            }
        }
    }
}

/// A task of [`Graph`] between the start and the end of `setupBuildTask`.
struct OpenTask {
    path: Vec<u8>,
    project: config::Project,
    /// Number of `project`'s references that have been set up.
    references_done: usize,
    up_stream: Vec<usize>,
    in_circular_context: bool,
}

/// The files that the projects of a `tsc -b` run are going to emit, and the directories that contain them with all
/// their ancestors, each with the projects that emit into it. Keyed by `tspath.Path`.
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

/// The files that the projects of a `tsc -b` run have emitted so far, and which projects are built. Nothing is written
/// to disk.
struct Emitted {
    /// By `tspath.Path`, like `directories`, because a case-insensitive file system finds a file however its name is
    /// spelled. The projects that emitted the file, each with the text. A JavaScript file is empty, because its text is
    /// never printed.
    files: ShardedMap<Vec<u8>, Guarded<Vec<(usize, Arc<Vec<u8>>)>>>,
    /// The directories that contain the files, and all their ancestors, each with the projects that emitted into it.
    directories: ShardedMap<Vec<u8>, Guarded<Vec<usize>>>,
    has_files: AtomicBool,
    /// By project: the number of projects built before it. `usize::MAX` if it isn't built.
    built_after: Vec<AtomicUsize>,
}

impl Emitted {
    fn new(projects: usize) -> Emitted {
        Emitted {
            files: ShardedMap::default(),
            directories: ShardedMap::default(),
            has_files: AtomicBool::new(false),
            built_after: (0..projects)
                .map(|_| AtomicUsize::new(usize::MAX))
                .collect(),
        }
    }

    /// Call once per project, before it counts as built.
    fn add(&self, project: usize, files: Vec<(Vec<u8>, Arc<Vec<u8>>)>) {
        if !files.is_empty() {
            self.has_files.store(true, Ordering::Relaxed);
        }
        let mut directories: FxHashSet<Vec<u8>> = FxHashSet::default();
        for (path, text) in files {
            let mut directory = dirname::<Posix>(&path);
            while directory.len() > 1 && directories.insert(directory.to_vec()) {
                directory = dirname::<Posix>(directory);
            }
            let per_project = self.files.insert_ref(path, Guarded::default());
            per_project.lock().push((project, text));
        }
        for directory in directories {
            let per_project = self.directories.insert_ref(directory, Guarded::default());
            per_project.lock().push(project);
        }
    }
}

/// The file system as a `tsc -b` run leaves it for one project. It also contains what the projects before it in the
/// build order have emitted, whether it references them or not.
struct WithOutputs<'h> {
    disk: &'h dyn Host,
    emitted: &'h Emitted,
    expected: &'h Expected,
    /// This project's index in the build order.
    index: usize,
    /// Number of projects that were built when this one began. What the others emit in the meantime is invisible to it.
    built_before: usize,
    /// `Host::origin` of what the first project emits.
    first_origin: usize,
    /// The earlier projects that it can't see and whose output it has requested. The answers it got are wrong.
    awaited: Guarded<Vec<usize>>,
    /// `Host::take_unreadable`, for this project only. Others are read through `disk` at the same time.
    unreadable: Guarded<Vec<Vec<u8>>>,
    /// Number of projects being built now. The thread that builds this one loads and checks it, so it has a worker's
    /// stack, and `helpers` help it. `None`: that thread only waits, and the pool does the work.
    built_now: Option<&'h AtomicUsize>,
    /// See `Host::ends_the_process`.
    is_last_program: bool,
}

impl WithOutputs<'_> {
    /// The threads are divided equally among the projects being built. With a project for every thread, each project is
    /// one thread's work, and that thread waits for no other. Rounded up, because the threads of one project do wait
    /// for each other.
    fn helpers(&self, built_now: &AtomicUsize) -> usize {
        let projects = built_now.load(Ordering::Relaxed).max(1);
        self.disk.threads().max(1).div_ceil(projects) - 1
    }

    /// True if this project can see what `project` has emitted.
    fn sees(&self, project: usize) -> bool {
        let built_after = &self.emitted.built_after[project];
        project < self.index && built_after.load(Ordering::Relaxed) < self.built_before
    }

    /// Returns `path` with symlinks resolved in the longest prefix that exists on disk. A workspace package is reached
    /// through a symlink in a `node_modules`, and its emitted files are keyed by its real path.
    fn resolve_links_in_prefix(&self, path: &[u8]) -> Option<Vec<u8>> {
        if !strings::contains(path, b"/node_modules/")
            || self.expected.files.is_empty() && !self.emitted.has_files.load(Ordering::Relaxed)
        {
            return None;
        }
        let on_disk = ancestors(dirname::<Posix>(path))
            .find(|dir| dir.len() <= 1 || self.disk.is_dir(dir))?;
        let real = self.disk.realpath(on_disk);
        (real != on_disk).then(|| [&real[..], &path[on_disk.len()..]].concat())
    }

    /// Records the `projects` that emit the requested path and that this project can't see yet.
    fn wait_for(&self, projects: Option<&Vec<usize>>) {
        let before = projects.into_iter().flatten();
        let before = before.take_while(|&&it| it < self.index);
        let mut pending = before.filter(|&&it| !self.sees(it)).peekable();
        if pending.peek().is_some() {
            self.awaited.lock().extend(pending);
        }
    }

    /// Returns the file with the project that emitted it. If several did, the last in the build order wrote last.
    fn file(&self, name: &[u8]) -> Option<(usize, Arc<Vec<u8>>)> {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(name, self.disk.is_case_sensitive(), &mut buffer[..]);
        self.wait_for(self.expected.files.get(&*path));
        let per_project = self.emitted.files.get_ref(&*path)?.lock();
        let seen = per_project.iter().filter(|it| self.sees(it.0));
        seen.max_by_key(|it| it.0).cloned()
    }

    fn has_directory(&self, name: &[u8]) -> bool {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(name, self.disk.is_case_sensitive(), &mut buffer[..]);
        self.wait_for(self.expected.directories.get(&*path));
        let per_project = self.emitted.directories.get_ref(&*path);
        per_project.is_some_and(|per_project| per_project.lock().iter().any(|&it| self.sees(it)))
    }

    fn emitted_file(&self, path: &[u8]) -> Option<(usize, Arc<Vec<u8>>)> {
        let found_directly = self.file(path);
        found_directly.or_else(|| self.file(&self.resolve_links_in_prefix(path)?))
    }
}

impl Host for WithOutputs<'_> {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        match self.emitted_file(path) {
            Some((_, emitted_text)) => Some(Cow::Owned((*emitted_text).clone())),
            None => self.disk.read(path),
        }
    }
    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        self.read(path).unwrap_or_else(|| {
            self.unreadable.lock().push(path.to_vec());
            Cow::default()
        })
    }
    fn origin(&self, path: &[u8]) -> usize {
        (self.emitted_file(path)).map_or(0, |(project, _)| self.first_origin + project)
    }
    fn take_unreadable(&self) -> Vec<Vec<u8>> {
        std::mem::take(&mut *self.unreadable.lock())
    }
    fn is_file(&self, path: &[u8]) -> bool {
        self.disk.is_file(path) || self.emitted_file(path).is_some()
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        self.disk.is_dir(path)
            || self.has_directory(path)
            || (self.resolve_links_in_prefix(path)).is_some_and(|real| self.has_directory(&real))
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        match self.resolve_links_in_prefix(path) {
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
        options: bun_sema::resolve::ParseOptions,
    ) -> bun_sema::hir::File<'s> {
        self.disk.parse(arena, path, text, atoms, options)
    }
    fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        self.disk.parse_package_json(arena, text)
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        match self.built_now {
            Some(built_now) => (self.disk).with_helpers(self.helpers(built_now), count, work),
            None => self.disk.parallel(count, work),
        }
    }
    fn parallel_while(
        &self,
        count: usize,
        work: &(dyn Fn(usize) + Sync),
        meanwhile: &mut dyn FnMut(),
    ) {
        match self.built_now {
            // The calling thread is one of the workers.
            Some(_) => {
                self.parallel(count, work);
                meanwhile();
            }
            None => self.disk.parallel_while(count, work, meanwhile),
        }
    }
    fn is_single_threaded(&self) -> bool {
        (self.built_now).is_some_and(|built_now| self.helpers(built_now) == 0)
    }
    fn ends_the_process(&self, _: bool) -> bool {
        self.is_last_program
    }
    fn drop_before_the_process_ends(&self, session: Session) {
        self.disk.drop_before_the_process_ends(session);
    }
    fn helpers_now(&self) -> Option<usize> {
        self.built_now.map(|built_now| self.helpers(built_now))
    }
    fn with_helpers(&self, helpers: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
        self.disk.with_helpers(helpers, count, work);
    }
    fn loaded(&self) {
        // Otherwise the threads continue with the next project's files.
        if (self.built_now).is_none_or(|it| it.load(Ordering::Relaxed) < 2) {
            self.disk.loaded();
        }
    }
    fn threads(&self) -> usize {
        self.disk.threads()
    }
    fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
        // The I/O threads serve one load at a time.
        match self.built_now.map(|it| it.load(Ordering::Relaxed)) {
            Some(2..) => None,
            _ => self.disk.io_pool(),
        }
    }
}

/// A session that's dropped on all threads, while the report is printed, if the process is about to exit.
struct Dropped<'a> {
    session: Session,
    /// `None` if the process keeps running or the request has more programs.
    before_the_process_ends: Cell<Option<&'a dyn Host>>,
}

impl Drop for Dropped<'_> {
    fn drop(&mut self) {
        if let Some(host) = self.before_the_process_ends.get() {
            host.drop_before_the_process_ends(std::mem::take(&mut self.session));
        }
    }
}

/// Checks what `tsc -b` checks: `root` and every project it references, each with its own options. Nothing is written.
/// A project reads the declaration files of the projects it references from memory. Without `Request::build` only
/// `root` is reported, like `tsc`, which reads the declaration files that an earlier build wrote. If `root` has no
/// files of its own, `tsc` checks nothing, so here all projects are reported (`Report::follows_references`).
/// `named`: see `check_named_files` and `Extent`.
/// `checked_elsewhere`: see `ProjectToCheck`.
fn check_with_references(
    host: &host::Disk,
    root: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<(Extent, &[Vec<u8>])>,
    checked_elsewhere: Option<&FxHashSet<&[u8]>>,
    run: Option<&Run<'_>>,
    room_slot: Option<&RoomSlot<'_>>,
) -> Report {
    // Declared before any program's session, so it's dropped after them.
    let build_session = Dropped {
        session: Session::new(),
        before_the_process_ends: Cell::new(None),
    };
    // True if the process exits after this build, unless a program finds scripts that belong to another tsconfig.
    let ends_the_process = host.ends_the_process(run.is_some()) && room_slot.is_none();
    let is_case_sensitive = host.is_case_sensitive();
    let root_config_path = root.config_path.clone();
    let follows_references = !request.build && root.files.is_empty();
    let reports_references =
        request.build || follows_references || matches!(named, Some((Extent::Graph, _)));
    let configuration = Session::new();
    let mut graph = Graph {
        host,
        request,
        // The command line applies to the projects that are reported. For a plain `tsc` that's only the project it was
        // given.
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
    graph.setup_build_tasks(&root_config_path);
    let Graph {
        projects,
        index_of,
        mut errors,
        not_found,
        ..
    } = graph;
    let reads_sources = request.plan_options.reads_sources_of_references && !request.build;
    // `buildOrClean`: "Circularity errors prevent any project from being built". A program that reads the sources of
    // what it references doesn't wait for a build, like that of `tsc -p`, which doesn't look for cycles.
    if !errors.is_empty() && !reads_sources {
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
            (verify_project_references(&p.project, &resolved).chunk_by(|a, b| a.0 == b.0))
                .flat_map(|in_one_file| {
                    let problems = in_one_file.iter().map(|it| &it.1);
                    ConfigError::from_problems(host, &configuration, in_one_file[0].0, problems)
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
    // The output directory of each project's declaration files, and the source directory it mirrors. `None`: next to
    // the sources.
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
    // In that case there's one program, `root`'s, and it reads what's on disk. Otherwise one program reads what another
    // emits, and several run at the same time.
    let is_single_program = reads_sources && !reports_references;
    // Nothing waits for output that's never emitted.
    let up_stream: Vec<Vec<usize>> = (projects.iter())
        .map(|p| match reads_sources {
            true => Vec::new(),
            false => p.up_stream.clone(),
        })
        .collect();
    // `ResolvedProjectReferencePaths`: what a project's program is built from. It includes a reference that closes a
    // cycle.
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
    let mut is_read_later = vec![false; projects.len()];
    for &index in references.iter().flatten() {
        is_read_later[index] = true;
    }
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
    let mut is_excluded: Vec<bool> = (has_named.iter().enumerate())
        // A project that's only read is read from its sources, by the program that reads it.
        .map(|(index, has)| {
            !has || reads_sources && !reports_references && Some(index) != root_index
        })
        .collect();
    let mut pending: Vec<usize> = (0..count)
        .filter(|&index| has_named[index] && !reads_sources)
        .collect();
    while let Some(index) = pending.pop() {
        let referenced = references[index].iter();
        pending.extend(referenced.filter(|&&it| std::mem::replace(&mut is_excluded[it], false)));
    }
    // Same as in `build` below.
    let is_solution =
        |index: usize| roots[index].is_empty() && projects[index].project.has_references;
    let loaded = || (0..count).filter(|&index| !is_excluded[index] && !is_solution(index));
    // The programs read the same declaration files: the libraries, what's in `node_modules`, and what one emits for the
    // others. Each is parsed once and freed at the end.
    let build_run = (run.is_none() && !reads_sources && loaded().count() > 1).then(|| {
        let provided = host.provided_paths().cloned().collect();
        Run::new(&build_session.session, provided).sharing_only_declaration_files()
    });
    let request_run = run.filter(|_| !reads_sources);
    let first_origin = match &build_run {
        Some(run) => run.origins(count),
        None => request_run.map_or(1, |run| run.origins(count)),
    };
    let is_read_by_a_program = |index: usize| {
        (0..count)
            .any(|by| !is_excluded[by] && !roots[by].is_empty() && references[by].contains(&index))
    };
    // Under `noEmit` nothing is emitted, and a `.d.ts` next to a `.js` source would be resolved instead of the source.
    let writes_declaration_files = |index: usize| {
        is_read_later[index] && !options_of_projects[index].no_emit && !reads_sources
    };
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
    // `GetOutputPathsFor`: `jsFilePath`. `None`: nothing is written for the file, or the output would overwrite the
    // file itself.
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
    for (index, sources) in roots.iter().enumerate().filter(|_| !reads_sources) {
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
    // `ParseInputOutputNames`, `getOutputDeclarationAndSourceFileNames`, for what a program references, directly or
    // indirectly.
    let mut is_reached = vec![false; count];
    let mut pending: Vec<usize> = loaded()
        .flat_map(|index| &references[index])
        .copied()
        .collect();
    while let Some(index) = pending.pop() {
        if !std::mem::replace(&mut is_reached[index], true) {
            pending.extend(&references[index]);
        }
    }
    let mut project_files = ProjectFiles::default();
    for index in (0..count).filter(|&index| is_reached[index]) {
        for (source, path) in roots[index].iter().zip(&root_paths[index]) {
            let output_dts = match reads_sources {
                true => None,
                false => output_declaration_file_name(source, output_of(index)),
            };
            if let Some(output_dts) = &output_dts {
                let output_path = to_path(output_dts, is_case_sensitive).into_owned();
                let sources = project_files.outputs.entry(output_path).or_default();
                sources.push(path.clone());
            }
            let per_project = project_files.sources.entry(path.clone()).or_default();
            per_project.push(ProjectFile {
                project: index as u32,
                source: source.clone(),
                output_dts: output_dts.unwrap_or_default(),
            });
        }
    }
    let project_files = Arc::new(project_files);
    let inputs: Vec<(config::Project, Vec<ConfigError>)> = (projects.into_iter())
        .zip(about_references)
        .map(|(referenced, about)| (referenced.project, about))
        .collect();
    let emitted = Emitted::new(count);
    // Each program occupies memory for every declaration file it reaches, however few files the project lists. A
    // program that reads the sources of what it references has all of those files too.
    let max_concurrent = if reads_sources { 4usize } else { 16 };
    let max_concurrent = max_concurrent
        .clamp(1, host.threads().max(1))
        .min(count.max(1));
    let built_now = (!reads_sources).then(|| AtomicUsize::new(0));
    // `built_before`: the number of projects built so far. `is_last`: every other project is already built. Returns
    // `Err` with the projects that have to be built first, besides the ones it references.
    let build = |index: usize,
                 built_before: usize,
                 is_last: bool|
     -> Result<Option<Report>, Vec<usize>> {
        let (mut project, mut about_references) = inputs[index].clone();
        if project.files.is_empty() && project.has_references {
            // `upToDateStatusTypeSolution`: there's no program. `buildProject` reports each of
            // `GetConfigFileParsingDiagnostics` as it comes.
            let errors = project.errors.iter().filter(|e| !e.is_about_options);
            let mut last = None;
            let diagnostics: Vec<Diagnostic> = errors
                .map(|error| {
                    diagnostic_from_config_error(host, &project.config_path, error, &mut last)
                })
                .collect();
            return Ok((!diagnostics.is_empty()).then(|| Report {
                diagnostics,
                ..Default::default()
            }));
        }
        if is_excluded[index] {
            return Ok(None);
        }
        project.errors.append(&mut about_references);
        // `initMapperWorker`: the references in order, each project before its own references. A cycle leads back to
        // the project itself, whose files aren't those of a reference.
        let mut is_referenced: FxHashSet<usize> = FxHashSet::default();
        let mut referenced: Vec<usize> = Vec::new();
        let mut pending: Vec<usize> = references[index].iter().rev().copied().collect();
        while let Some(i) = pending.pop() {
            if is_referenced.insert(i) {
                if i != index {
                    referenced.push(i);
                }
                pending.extend(references[i].iter().rev());
            }
        }
        let host = WithOutputs {
            disk: host,
            emitted: &emitted,
            expected: &expected,
            index,
            built_before,
            first_origin,
            awaited: Guarded::new(Vec::new()),
            unreadable: Guarded::new(Vec::new()),
            built_now: built_now.as_ref(),
            is_last_program: is_last && ends_the_process,
        };
        project.options.referenced_options = referenced
            .iter()
            .map(|&i| options_of_projects[i].clone())
            .collect();
        if !referenced.is_empty() {
            project.options.project_files = Some(Arc::clone(&project_files));
            let numbered = (0..).zip(&referenced).map(|(at, &i)| (i as u32, at));
            project.options.referenced_projects = numbered.collect();
        }
        if reads_sources {
            let outputs = referenced.iter().filter_map(|&i| outputs[i].clone());
            project.options.referenced_outputs = outputs.collect();
        }
        let own: FxHashSet<&[u8]> = root_paths[index].iter().map(Vec::as_slice).collect();
        let is_owned_elsewhere = |path: &[u8]| {
            let mut per_project = project_files.sources.get(path).into_iter().flatten();
            !own.contains(path)
                && (per_project.any(|it| is_referenced.contains(&(it.project as usize)))
                    || checked_elsewhere
                        .is_some_and(|checked_elsewhere| checked_elsewhere.contains(path)))
        };
        let is_root = is_same_path(&project.config_path, &root_config_path, is_case_sensitive);
        project.options.is_build = reports_references || !is_root;
        project.options.build_info_file_name = project.get_build_info_file_name();
        project.options.writes_declaration_files = writes_declaration_files(index);
        let no_emit_on_error = project.options.no_emit_on_error;
        let named = match named {
            Some((Extent::Project, files)) if is_root => Some(files),
            // A project that another program reads is built in full. A solution has no program.
            Some((Extent::Graph, files)) if !is_read_by_a_program(index) => {
                let is_named = |file: &Vec<u8>| is_among(files, file);
                (!root_paths[index].iter().all(is_named)).then_some(files)
            }
            _ => None,
        };
        let check = |run: Option<&Run<'_>>, room_slot: Option<&RoomSlot<'_>>| {
            check_named_files(
                &host,
                project,
                request,
                Report::default(),
                Instant::now(),
                named,
                Some(&is_owned_elsewhere),
                Some(&|| !host.awaited.lock().is_empty()),
                run,
                room_slot,
            )
        };
        let mut checked = match &build_run {
            _ if is_single_program => check(run, room_slot),
            Some(run) => check(Some(run), None),
            None => check(request_run, None),
        };
        let mut awaited = std::mem::take(&mut *host.awaited.lock());
        if !awaited.is_empty() {
            awaited.shared_sort_unstable();
            awaited.dedup();
            return Err(awaited);
        }
        // `HandleNoEmitOnError`
        if !(no_emit_on_error && !checked.diagnostics.is_empty()) && !reads_sources {
            let mut files = Vec::new();
            for (source, emitted_text) in std::mem::take(&mut checked.declaration_files) {
                let path = declaration_file_path(index, &source);
                files.push((path_of(path), Arc::new(emitted_text)));
            }
            let no_text = Arc::new(Vec::new());
            for source in &roots[index] {
                if let Some(output) = js_file_path(index, source) {
                    let text = match output.ends_with(b".json") {
                        true => Arc::new(host.disk.read(source).unwrap_or_default().into_owned()),
                        false => Arc::clone(&no_text),
                    };
                    files.push((path_of(output), text));
                }
            }
            emitted.add(index, files);
        }
        Ok(Some(checked))
    };
    // `buildOrClean`: a project is built as soon as the projects it references are.
    struct Builds {
        /// The projects that can be built now.
        ready: BTreeSet<usize>,
        /// By project: the number of projects it waits for that aren't built yet. Besides the ones it references, these
        /// are what `build` returned.
        waits_for: Vec<usize>,
        /// By project: the projects that wait for it.
        waiting: Vec<Vec<usize>>,
        /// Number of projects built.
        built: usize,
        /// Number of projects being built.
        running: usize,
        /// Number of projects that are neither built nor being built.
        left: usize,
    }
    let mut waiting = vec![Vec::new(); count];
    for (index, first) in up_stream.iter().enumerate() {
        for &it in first {
            waiting[it].push(index);
        }
    }
    let builds = Guarded::new(Builds {
        ready: (0..count).filter(|&it| up_stream[it].is_empty()).collect(),
        waits_for: up_stream.iter().map(Vec::len).collect(),
        waiting,
        built: 0,
        running: 0,
        left: count,
    });
    // Projects that a thread is about to start count too.
    let update_built_now = |state: &Builds| {
        if let Some(built_now) = &built_now {
            let projects = (state.running + state.ready.len()).min(max_concurrent);
            built_now.store(projects, Ordering::Relaxed);
        }
    };
    update_built_now(&builds.lock());
    let project_built = bun_threading::Condvar::new();
    let reports: Vec<Guarded<Option<Report>>> = (0..count).map(|_| Guarded::new(None)).collect();
    let build_ready_projects = || {
        let mut state = builds.lock();
        loop {
            // The first in build order.
            let Some(index) = state.ready.pop_first() else {
                if state.left == 0 {
                    return;
                }
                project_built.wait_guarded(&mut state);
                continue;
            };
            state.left -= 1;
            state.running += 1;
            let built_before = state.built;
            let is_last = state.left == 0 && state.running == 1;
            drop(state);
            let has_scripts_elsewhere = |it: &Guarded<Option<Report>>| {
                (it.lock().as_ref()).is_some_and(|it| !it.scripts_elsewhere.is_empty())
            };
            let is_last = is_last && !reports.iter().any(has_scripts_elsewhere);
            let built = build(index, built_before, is_last);
            state = builds.lock();
            let now = &mut *state;
            now.running -= 1;
            match built {
                Ok(report) => {
                    *reports[index].lock() = report;
                    emitted.built_after[index].store(now.built, Ordering::Relaxed);
                    now.built += 1;
                    for it in std::mem::take(&mut now.waiting[index]) {
                        now.waits_for[it] -= 1;
                        if now.waits_for[it] == 0 {
                            now.ready.insert(it);
                        }
                    }
                }
                Err(awaited) => {
                    now.left += 1;
                    let is_built =
                        |it: usize| emitted.built_after[it].load(Ordering::Relaxed) != usize::MAX;
                    for it in awaited.into_iter().filter(|&it| !is_built(it)) {
                        now.waiting[it].push(index);
                        now.waits_for[index] += 1;
                    }
                    if now.waits_for[index] == 0 {
                        now.ready.insert(index);
                    }
                }
            }
            update_built_now(&state);
            project_built.notify_all();
        }
    };
    // A thread that loads and checks what it builds needs a worker's stack. The calling thread only has the stack it
    // was given, so in that case it just waits.
    std::thread::scope(|scope| {
        let mut started = 0;
        for _ in usize::from(built_now.is_none())..max_concurrent {
            // If the thread can't be spawned, the others build its share.
            let builder = std::thread::Builder::new()
                .stack_size(WORKER_STACK_SIZE as usize)
                .spawn_scoped(scope, || {
                    // Same as a pool thread does when it starts, because the parsers check the stack.
                    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Check"));
                    build_ready_projects();
                });
            started += usize::from(builder.is_ok());
        }
        if built_now.is_none() || started == 0 {
            build_ready_projects();
        }
    });
    // `BuildTask.report`: project by project, in build order. What two projects report about a file that both include
    // appears twice.
    let mut not_found = not_found.into_iter().peekable();
    for (index, mut checked) in reports.into_iter().enumerate() {
        while let Some((_, d)) = not_found.next_if(|it| it.0 <= index) {
            // This is the build's error. A plain `tsc` only has what the project reports at its reference.
            if reports_references {
                report.report_task(Report {
                    diagnostics: vec![d],
                    ..Default::default()
                });
            }
        }
        if let Some(mut checked) = checked.get_mut().take()
            // A project that's only read, with no file in the directory that was passed, isn't reported.
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
    if ends_the_process && report.scripts_elsewhere.is_empty() {
        build_session.before_the_process_ends.set(Some(host));
    }
    report
}

/// For what `tsc` has no command for: files that are passed as paths or found in a page, and that are checked in
/// unrelated projects.
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

/// `compareMessageChainContent`, for chains of the same size.
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
    sort_and_deduplicate_with(diagnostics, Vec::new());
}

/// `sort_and_deduplicate`, for `diagnostics` and `per_file_lists` together. Each list in `per_file_lists` has the
/// diagnostics of one path, at least one, in order.
fn sort_and_deduplicate_with(
    diagnostics: &mut Vec<Diagnostic>,
    per_file_lists: Vec<Vec<Diagnostic>>,
) {
    // The path is compared first. So each file's diagnostics are sorted separately, and the files by path. With tens of
    // thousands of diagnostics, most comparisons would otherwise be between two long paths with a common prefix.
    let mut files: FxHashMap<&[u8], usize> = FxHashMap::default();
    let paths = diagnostics.iter().map(|d| &d.path);
    let paths = paths.chain(per_file_lists.iter().map(|list| &list[0].path));
    let file_of = paths.map(|path| {
        let next = files.len();
        *files.entry(typescript_path(path)).or_insert(next)
    });
    let file_of: Vec<usize> = file_of.collect();
    let (file_of, file_of_list) = file_of.split_at(diagnostics.len());
    // Each file's lists, and whether they're a single list that's in order.
    let mut by_file: Vec<(Vec<Diagnostic>, bool)> = Vec::new();
    by_file.resize_with(files.len(), Default::default);
    drop(files);
    for (d, &file) in diagnostics.drain(..).zip(file_of) {
        by_file[file].0.push(d);
    }
    for (mut list, &file) in per_file_lists.into_iter().zip(file_of_list) {
        let (all, is_in_order) = &mut by_file[file];
        match all.is_empty() {
            true => (*all, *is_in_order) = (list, true),
            false => {
                all.append(&mut list);
                *is_in_order = false;
            }
        }
    }
    by_file.shared_sort_by(|a, b| typescript_path(&a.0[0].path).cmp(typescript_path(&b.0[0].path)));
    diagnostics.reserve_exact(by_file.iter().map(|it| it.0.len()).sum());
    for (mut file_diagnostics, is_in_order) in by_file {
        if !is_in_order {
            file_diagnostics.shared_sort_by(compare_diagnostics);
        }
        diagnostics.append(&mut file_diagnostics);
    }
    // `compactAndMergeRelatedInfos`
    diagnostics.dedup_by(|next, first| {
        let is_same = equal_diagnostics_no_related_info(first, next);
        if is_same {
            first.related.append(&mut next.related);
            first.related.shared_sort_by(compare_diagnostics);
            first
                .related
                .dedup_by(|next, first| equal_diagnostics(first, next));
        }
        is_same
    });
}

/// The path, text and line starts of the file that the last error passed to `diagnostic_from_config_error` was in.
/// Cached because each of thousands of `paths` can have an error.
type LastConfigFile = Option<(Vec<u8>, Cow<'static, [u8]>, Vec<u32>)>;

/// Converts `error`, from the project whose configuration file is at `config_path`.
fn diagnostic_from_config_error(
    host: &dyn Host,
    config_path: &[u8],
    error: &ConfigError,
    last: &mut LastConfigFile,
) -> Diagnostic {
    let mut reported = global(error.code, &error.args);
    reported.message_chain = message_chain_of(&error.chain);
    for chain in &reported.message_chain {
        chain.flatten(&mut reported.text, 1);
    }
    if error.at.is_none() && error.related.is_empty() {
        return reported;
    }
    let path = error.at.as_ref().map_or(config_path, |at| &at.0[..]);
    if last.as_ref().is_none_or(|last| last.0 != path) {
        let Some(text) = host.read(path) else {
            return reported;
        };
        let starts = compute_ecma_line_starts(&text);
        *last = Some((path.to_vec(), text, starts));
    }
    let Some((_, text, starts)) = last else {
        return reported;
    };
    let related = error
        .related
        .iter()
        .map(|(from, to, code, args)| located(path, text, starts, *from, *to, global(*code, args)));
    reported.related = related.collect();
    match error.at {
        Some((_, from, to)) => located(path, text, starts, from, to, reported),
        None => reported,
    }
}

/// Checks `project`, which is read through `host`. `report` holds the errors found so far, since `started`.
pub fn check_project(
    host: &dyn Host,
    project: config::Project,
    request: &Request,
    report: Report,
    started: Instant,
) -> Report {
    check_named_files(
        host, project, request, report, started, None, None, None, None, None,
    )
}

/// True if the dependencies of the project at `config` aren't installed: its `package.json` lists packages, and none of
/// them is in a `node_modules`. Then the types of Node, of the test runner and so on aren't available.
fn has_no_installed_dependencies(host: &dyn Host, config: &[u8]) -> bool {
    let above = || ancestors(dirname::<Posix>(config));
    let mut manifests = above().map(|it| inside(it, b"package.json"));
    let manifest = manifests.find(|it| host.is_file(it));
    let text = manifest.and_then(|it| host.read(&it));
    let fields = text.and_then(|it| host.parse_package_json(Session::new().arena(), &it));
    let packages_in = |field: &[u8]| fields.as_ref()?.get(field)?.as_object();
    let fields = [
        &b"dependencies"[..],
        b"devDependencies",
        b"peerDependencies",
    ];
    let mut names = (fields.into_iter().filter_map(packages_in).flatten()).map(|it| &it.0);
    let all = above().map(|it| inside(it, b"node_modules"));
    let all: Vec<Vec<u8>> = all.filter(|it| host.is_dir(it)).collect();
    let is_installed = |name: &Vec<u8>| all.iter().any(|it| host.is_dir(&inside(it, name)));
    let Some(first) = names.next() else {
        return false;
    };
    !is_installed(first) && !names.any(is_installed)
}

/// True if the root file at `path` can add to its program's globals. That's a declaration file, a script (which has
/// neither `import` nor `export`, nor `require` in JavaScript), or a file with `declare global` or a `/// <reference`.
/// Judged by its text, because a false positive only costs a parse. It misses a script that has one of those words in a
/// comment, and a comment between `declare` and `global`. `imports` is called with the name of each package the file
/// imports for its side effects, which may include declaring globals.
fn may_declare_a_global(
    host: &dyn Host,
    path: &[u8],
    every_file_is_a_module: bool,
    imports: &dyn Fn(&[u8]),
) -> bool {
    if is_declaration_file_name(path) {
        return true;
    }
    if path.ends_with(b".json") {
        return false;
    }
    let Some(text) = host.read(path) else {
        return false;
    };
    let has = |word: &[u8]| strings::contains(&text, word);
    // `/// <reference lib="webworker" />`
    if has(b"<reference ") {
        return true;
    }
    let mut from = 0;
    while let Some(found) = strings::index_of(&text[from..], b"global") {
        let before = text[..from + found].trim_ascii_end();
        if before.len() < from + found && before.ends_with(b"declare") {
            return true;
        }
        from += found + b"global".len();
    }
    let (mut from, mut has_import) = (0, false);
    while let Some(found) = strings::index_of(&text[from..], b"import") {
        (from, has_import) = (from + found + b"import".len(), true);
        if let [quote @ (b'"' | b'\''), name @ ..] = text[from..].trim_ascii_start()
            && let Some(end) = strings::index_of_char_usize(name, *quote)
            && !is_relative(&name[..end])
        {
            imports(&name[..end]);
        }
    }
    !every_file_is_a_module
        && !has_import
        && !has(b"export")
        && !(is_javascript(path) && has(b"require"))
}

/// `check_project`. `named`: of all loaded files, only these files (sorted) and the files they refer to are checked.
/// `is_owned_elsewhere`: true for a file of a referenced project, which is loaded but not checked. Both identify a file
/// by its `tspath.Path`.
fn check_named_files(
    host: &dyn Host,
    mut project: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<&[Vec<u8>]>,
    is_owned_elsewhere: Option<&dyn Fn(&[u8]) -> bool>,
    // Called once the program is loaded. True if it shouldn't be checked.
    is_outdated: Option<&dyn Fn() -> bool>,
    run: Option<&Run<'_>>,
    in_room: Option<&RoomSlot<'_>>,
) -> Report {
    let _runs_here = in_room.and_then(|it| Some(RunsHere::new(it.room.shares?, it.threads - 1)));
    let threads = match request.threads {
        0 => usize::from(bun_core::get_thread_count()),
        n => n,
    };
    project.options.current_directory = match project.config_path.as_slice() {
        config_path
            if request.plan_options.uses_project_directory_as_cwd && !config_path.is_empty() =>
        {
            dirname::<Posix>(config_path).to_vec()
        }
        _ => host::from_native(request.cwd),
    };
    let conditions = request.conditions.iter().map(|it| it.to_vec());
    project.options.custom_conditions.extend(conditions);
    let config_path = project.config_path.clone();
    let last = RefCell::new(None);
    let config_diagnostic = |error: &ConfigError| {
        diagnostic_from_config_error(host, &config_path, error, &mut last.borrow_mut())
    };
    // `GetDiagnosticsOfAnyProgram`: configuration file parsing errors are reported regardless of any other diagnostics.
    let first_own_diagnostic = report.diagnostics.len();
    report.diagnostics.extend(
        project
            .errors
            .iter()
            .filter(|error| !error.is_about_options)
            .map(config_diagnostic),
    );
    let always_reported = report.diagnostics.len();
    let is_fallback_project = request.plan_options.project_is_fallback
        && request.project.is_some_and(|it| {
            let it = host::from_argument(&host::from_native(request.cwd), it);
            is_same_path(&it, &config_path, host.is_case_sensitive())
        });
    let rejects_broken = request.plan_options.rejects_broken_configurations && !is_fallback_project;
    let rejected_program = |diagnostics: Vec<Diagnostic>| RejectedProgram {
        config_path: config_path.clone(),
        diagnostics,
        files: named.unwrap_or_default().to_vec(),
    };
    if rejects_broken && always_reported > first_own_diagnostic {
        let diagnostics = report.diagnostics.split_off(first_own_diagnostic);
        report.rejected_programs.push(rejected_program(diagnostics));
        return report;
    }
    let mut about_options: Vec<Diagnostic> = project
        .errors
        .iter()
        .filter(|error| error.is_about_options)
        .map(config_diagnostic)
        .collect();
    project.options.lib_dir = match request.libs {
        Libs::Bundled(_) => host::BUNDLED_LIBS.to_vec(),
        Libs::Directory(dir) => host::from_native(dir),
    };
    if request.plan_options.prefers_project_typescript_libs && !config_path.is_empty() {
        let installed = installed_typescript(host, &config_path);
        // By its real path, because a workspace's packages link to the same one.
        let own = installed.map(|package| inside(&host.realpath(&package), b"lib"));
        if let Some(own) = own.filter(|own| has_libraries(host, &project.options, own)) {
            project.options.lib_dir = own;
        }
    }
    report.has_bun_types_installed = project
        .options
        .effective_type_roots()
        .iter()
        .any(|root| host.is_file(&[&root[..], b"/bun/package.json"].concat()));
    // `"types": ["bun"]` is among the options `bun init` writes, and so among the defaults used when there's no
    // configuration file. It's omitted from `default_compiler_options` because requesting types that aren't installed
    // is an error (TS2688).
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

    if request.plan_options.only_globals {
        if has_no_installed_dependencies(host, &config_path) {
            return report;
        }
        project.options.imports_of_sources_add_no_file = true;
        let is_module = project.options.module_detection == ModuleDetection::Force;
        let roots = &project.files;
        let is_kept: Vec<AtomicBool> = roots.iter().map(|_| AtomicBool::new(false)).collect();
        // `import "mocha";`: the name and the file.
        let side_effect_imports: Guarded<Vec<(Vec<u8>, usize)>> = Guarded::new(Vec::new());
        host.parallel(roots.len(), &|at| {
            let imports = |name: &[u8]| side_effect_imports.lock().push((name.to_vec(), at));
            let may = may_declare_a_global(host, &roots[at], is_module, &imports);
            is_kept[at].store(may, Ordering::Relaxed);
        });
        // One file per name is enough to bring the package in, so the first is kept.
        let mut side_effect_imports = std::mem::take(&mut *side_effect_imports.lock());
        side_effect_imports.shared_sort_unstable();
        side_effect_imports.dedup_by(|a, b| a.0 == b.0);
        for (_, at) in side_effect_imports {
            is_kept[at].store(true, Ordering::Relaxed);
        }
        // A program without a root file has no libraries and no `types`.
        if let Some(first) = is_kept.first()
            && !is_kept.iter().any(|it| it.load(Ordering::Relaxed))
        {
            first.store(true, Ordering::Relaxed);
        }
        let mut is_kept = is_kept.iter();
        (project.files).retain(|_| is_kept.next().is_some_and(|it| it.load(Ordering::Relaxed)));
    }
    let includes_everything = !config_path.is_empty()
        && project.written.include.is_none()
        && project.written.files.is_none();
    let included = project.files.len();
    let raw_options = std::mem::take(&mut project.raw_compiler_options);
    let is_true = |name: &[u8]| raw_options.contains(&(name.to_vec(), Json::Bool(true)));
    project.options.keeps_comments = request.after_file.is_some();
    // Declared before everything that's allocated in it, so it's dropped last.
    let dropped = Dropped {
        session: Session::new(),
        before_the_process_ends: Cell::new(host.ends_the_process(run.is_some()).then_some(host)),
    };
    let session = &dropped.session;
    let files_are_found = |until_it_is_loaded: usize| {
        if let Some(room_slot) = in_room {
            room_slot.files_found(session.allocated_bytes() + until_it_is_loaded);
        }
    };
    let files = Files::load(
        session,
        run,
        host,
        project.options,
        &project.files,
        &files_are_found,
    );
    host.loaded();
    if is_outdated.is_some_and(|is_outdated| is_outdated()) {
        return report;
    }
    if request.plan_options.only_globals {
        let files_of = |names| GlobalsOf {
            files: named.unwrap_or_default().to_vec(),
            names,
            checks_javascript: files.options.check_js == Some(true),
        };
        report.globals.extend(files.global_names().map(files_of));
        return report;
    }
    if rejects_broken {
        let problems = files.program_problems();
        let problems = ConfigError::from_problems(host, session, &config_path, problems.iter());
        about_options.extend(problems.iter().map(config_diagnostic));
        if !about_options.is_empty() {
            report
                .rejected_programs
                .push(rejected_program(about_options));
            return report;
        }
    }
    // In an arena, so that no destructor runs for them. The session frees everything they refer to in one go.
    // `Program::release` frees the little that's on the regular heap.
    let files = session.arena().alloc(files);
    let root = session.arena().alloc(Program::new(session, files));
    let program: &Program = root;
    report.files_loaded = program.files.modules.len();
    report.load_time = started.elapsed();
    if includes_everything
        && let Some(named) = named
        && let Some(example) = named.first()
    {
        report.without_include.push(WithoutInclude {
            config_path: config_path.clone(),
            included,
            requested_files: named.len(),
            example: example.clone(),
            load_time: report.load_time,
        });
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
    let problems = program.files.program_problems();
    let problems = ConfigError::from_problems(host, session, &config_path, problems.iter());
    about_options.extend(problems.iter().map(config_diagnostic));

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
                        || request.after_file.is_some()
                            && request.plan_options.after_file_only_for_checked_files
                            && !module.is_lib
                            && !module.is_from_external_library
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
            // A page represents its scripts.
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
            let edges = match request.plan_options.checks_only_requested_paths {
                true => &[][..],
                false => modules[i].edges,
            };
            for edge in edges.iter().copied().chain(scripts) {
                if !std::mem::replace(&mut is_reached[edge.idx()], true) {
                    to_follow.push(edge.idx());
                }
            }
        }
        is_reached
    });
    // `check_request` checks those scripts in another program afterwards.
    if !scripts_elsewhere.is_empty() {
        dropped.before_the_process_ends.set(None);
    }
    report.scripts_elsewhere = scripts_elsewhere;
    if let Some(is_reached) = &is_reached {
        to_check.retain(|file| is_reached[file.idx()]);
    }
    if let Some(is_owned_elsewhere) = is_owned_elsewhere {
        let path = |f: FileId| program.files.modules[f.idx()].path.text;
        to_check.retain(|&f| !is_owned_elsewhere(path(f)));
    }
    let lists_files_only = is_true(b"listFilesOnly") && request.stops_like_tsc;
    if lists_files_only {
        to_check.clear();
    }
    // Program order (`program.files`): an imported file precedes its importers. A file's position in `to_check` is its
    // index.
    let rank = |f: FileId| program.files.rank_of_file(f);
    to_check.shared_sort_by_key(|&f| rank(f));
    let size = |f: FileId| program.files.modules[f.idx()].hir.source_len;
    report.files_checked = to_check.len();
    // `SkipTypeChecking`: besides its syntax errors, such a file only has what `Emit` reports, which is called after
    // the semantic and global diagnostics of the whole program are collected. So these files come after the
    // type-checked ones, or before them under `Options::emits_first`. If there are no others, they go through the queue
    // themselves.
    // A `Checker` is about 30 KB. Boxing keeps this function's stack frame small.
    let boxed_checker = |spare| Box::new(program.checker_reusing(spare));
    let checker = boxed_checker(None);
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
    // One sorted list per file. A single long list would be moved every time it grows, while the other threads wait.
    let found: Guarded<Vec<Vec<Diagnostic>>> = Guarded::new(Vec::new());
    // `GetDeclarationDiagnostics`
    let emit_diagnostics: Guarded<Vec<Vec<Diagnostic>>> = Guarded::new(Vec::new());
    let incomplete: Guarded<Vec<Incomplete>> = Guarded::new(Vec::new());
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
    let show = |file: FileId, errors: Vec<Explained>, found: &Guarded<Vec<Vec<Diagnostic>>>| {
        if errors.is_empty() || request.plan_options.skips_file_diagnostics {
            return;
        }
        let module = &program.files.modules[file.idx()];
        let text = &text_of(file)[..];
        let starts = compute_ecma_line_starts(text);
        let counted = Counted::default();
        let mut rendered: Vec<Diagnostic> = errors
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
                        let Some((related_file, start, end)) = related.at else {
                            return reported;
                        };
                        if related_file == file {
                            return located_after(
                                &counted,
                                module.file_name(),
                                text,
                                &starts,
                                start,
                                end,
                                reported,
                            );
                        }
                        if related_file == bun_sema::program::IN_CONFIGURATION {
                            return match host.read(&config_path) {
                                Some(text) => {
                                    let starts = compute_ecma_line_starts(&text);
                                    located(&config_path, &text, &starts, start, end, reported)
                                }
                                None => reported,
                            };
                        }
                        let other = &program.files.modules[related_file.idx()];
                        let text = &text_of(related_file)[..];
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
                        with_bun_commands(e.text)
                    },
                    args: e.args,
                    message_chain: e.message_chain,
                    ..global(0, &[""; 0])
                };
                let path = module.file_name();
                located_after(&counted, path, text, &starts, e.start, e.end, reported)
            })
            .collect();
        if let Some(progress) = request.progress {
            progress.errors.fetch_add(rendered.len(), Ordering::Relaxed);
        }
        rendered.shared_sort_by(compare_diagnostics);
        found.lock().push(rendered);
    };
    // The kind of check that `Request::after_file` follows.
    let wanted = match request.plan_options.skips_file_diagnostics {
        true => Requested::Types,
        false => Requested::All,
    };
    let new_checker = |expected: Requested, spare| {
        let mut checker = boxed_checker(spare);
        checker.set_requested(expected);
        checker.begin_stack_budget();
        checker
    };
    // The files that are checked but not yet rendered. Another file's task may still report diagnostics in them.
    let unfinished: Guarded<Vec<(FileId, Checked)>> = Guarded::new(Vec::new());
    /// Checked files whose results are kept.
    struct Outcome {
        /// For `finish_files`.
        checked: Vec<(FileId, Checked)>,
        /// The files in which the native stack ran out.
        incomplete: Vec<FileId>,
    }
    let free_trees = |files: Vec<FileId>| {
        for file in files {
            // SAFETY: the only task that reads the HIR has ended, and its files won't be rechecked.
            unsafe { program.files.free_tree(file) };
        }
    };
    // Checks files outside the queue. Whatever the checker stores is dropped with it.
    let check_chunk = |files: &[FileId], expected: Requested| {
        let mut checker = new_checker(expected, None);
        let (mut checked, mut incomplete) = (Vec::new(), Vec::new());
        for &file in files {
            checked.push((file, checker.check_file(file)));
            if let Some(after_file) = request.after_file
                && expected == wanted
            {
                after_file(&mut checker, file);
            }
            if checker.take_ran_out_of_stack() {
                incomplete.push(file);
            }
        }
        deepest_stack.fetch_max(checker.deepest_stack(), Ordering::Relaxed);
        Outcome {
            checked,
            incomplete,
        }
    };
    let declaration_files: Guarded<Vec<(Vec<u8>, Vec<u8>)>> = Guarded::new(Vec::new());
    let accept = |outcome: Outcome| {
        // The diagnostics that were found are reported. Others may be missing, so the report lists the file as
        // incomplete.
        for file in outcome.incomplete {
            incomplete.lock().push(Incomplete {
                path: program.files.modules[file.idx()].file_name().to_vec(),
                is_nested_too_deeply: program.files.hir(file).ran_out_of_stack,
            });
        }
        unfinished.lock().extend(outcome.checked);
    };
    // Builds the report. No task is running, so every diagnostic is in its file's buffer. It makes no query and reads
    // no HIR.
    let finish_files = || {
        let unfinished: Vec<Guarded<Option<(FileId, Checked)>>> = unfinished
            .lock()
            .drain(..)
            .map(|one| Guarded::new(Some(one)))
            .collect();
        let finish = |i: usize| {
            let (file, mut checked) = unfinished[i].lock().take().unwrap();
            if let Some(emitted_text) = checked.declaration_file.take() {
                let path = program.files.modules[file.idx()].file_name().to_vec();
                declaration_files.lock().push((path, emitted_text));
            }
            let declaration = checked.take_declaration_diagnostics();
            show(file, program.finish_file(file, checked), &found);
            if let Some(declaration) = declaration {
                let declaration = program.finish_file(file, declaration);
                show(file, declaration, &emit_diagnostics);
            }
        };
        // Files with thousands of errors are adjacent, so each thread takes files that are far apart.
        let groups = unfinished.len().min(1024);
        host.parallel(groups, &|group| {
            (group..unfinished.len()).step_by(groups).for_each(finish);
        });
    };
    let bytes_of = |index: usize| size(to_check[index]) as usize;
    // Cost estimate for checking a file: the number of identifiers in its expressions. Each is a symbol to resolve and
    // a type to compute. The text size is a poor predictor: on storybook, tasks partitioned by it take 1.8 times as
    // long as tasks partitioned by the measured time, whereas tasks partitioned by this estimate take 1.1 times as
    // long.
    // A type node is a type to compute too. A declaration file has no expressions, and next.js checks one of 2.9 MB
    // that takes 23% of the check's instructions.
    let cost_of = |file: FileId| {
        let (identifiers, type_nodes) = program.files.sizes[file.idx()];
        identifiers as usize + type_nodes as usize + 1
    };
    let costs: Vec<usize> = to_check.iter().map(|&file| cost_of(file)).collect();
    let size_of = |index: usize| costs[index];
    let threads = match in_room {
        Some(room_slot) if room_slot.fits_one_thread => 1,
        _ => threads,
    };
    let tasks_run = AtomicUsize::new(0);
    // The files of the discarded tasks.
    let lost: Guarded<Vec<usize>> = Guarded::new(Vec::new());
    // Which files are final, and the length of the final prefix in program order. The task that checks the next file
    // enters a cycle where `tsc --singleThreaded` does. See `Checker::set_first_in_order`.
    let final_files = Guarded::new((vec![false; to_check.len()], 0usize));
    // Number of files that are final.
    let files_done = AtomicUsize::new(0);
    /// The driver's record of a file's last check.
    #[derive(Clone, Default)]
    struct Visit {
        /// `Checker::take_unresolved_cycle`
        unresolved_cycle: Vec<u64>,
        /// Commits up to this number don't resolve `unresolved_cycle`.
        commits_compared: u32,
        /// `files_done` when the visit began.
        files_done: usize,
        /// `Checker::can_recheck_early`
        can_recheck_early: bool,
        /// The visit was discarded at a cycle that no commit had resolved.
        was_discarded_at_cycle: bool,
        /// The file was already rechecked early once after a visit that was discarded for another reason.
        was_retried_without_cycle: bool,
        /// The file was already rechecked once because all earlier files were done.
        was_retried_as_first: bool,
        /// Number of times the file was rechecked before the last round.
        rechecks: usize,
    }
    let visits = Guarded::new(vec![Visit::default(); to_check.len()]);
    let index_of_file: FxHashMap<FileId, usize> = (to_check
        .iter()
        .enumerate()
        .map(|(index, &file)| (file, index)))
    .collect();
    // A task that starts with a rechecked file gets its own round number, starting here, so task numbers stay unique.
    const FIRST_RECHECK_ROUND: usize = 2;
    // Every thread takes files from one queue until it's empty. `files`: in program order. `is_last_round`: one thread
    // checks them all in that order, in one task, which is trusted.
    //
    // A file's check time is only known afterwards. So a thread only reserves the rest of its run, and a thread that
    // finds the queue empty takes half of another thread's run (`steal_run`).
    let run_tasks = |round: usize, files: &[usize], expected: Requested, is_last_round: bool| {
        let cost: usize = files.iter().map(|&file| size_of(file)).sum();
        // A checker is replaced after this much cost, because its private tables grow with every file.
        let task_cost = match request.plan_options.task_size {
            _ if is_last_round => usize::MAX,
            TaskSize::ByCost => (cost / MIN_TASKS).max(1),
            TaskSize::OneFile => 1,
            TaskSize::Unlimited => usize::MAX,
        };
        let workers = if is_last_round { 1 } else { threads };
        // The heavy files go first, largest first, so that no thread starts one when the others are nearly done. Then
        // the others in program order, because neighbors use the same types. A single thread takes them all in program
        // order.
        let is_heavy = |file: &usize| workers != 1 && size_of(*file) >= task_cost;
        let (mut queue, light): (Vec<usize>, Vec<usize>) =
            files.iter().partition(|it| is_heavy(it));
        queue.shared_sort_by_key(|&file| Reverse(size_of(file)));
        let mut heavy = queue.len();
        queue.extend(light);
        if request.order != 1 {
            queue.shared_sort_by_key(|&file| (file as u32 + 1).wrapping_mul(request.order));
            heavy = 0;
        }
        // Number of heavy files of `queue` taken, number of light ones taken, and the cost of the rest.
        let left = Guarded::new((0usize, 0usize, cost));
        // Returns the next run: consecutive files of `queue` for one thread. Threads that work far apart request
        // different types at any one time. A run is a share of what's left, so the runs get shorter toward the end. A
        // heavy file is a run by itself. `skips_heavy_files`: this worker takes light files first, so the program's
        // first files get done and discarded files can be rechecked. See `final_files`.
        let take_run = |skips_heavy_files: bool| -> std::ops::Range<usize> {
            let (heavy_taken, light_taken, cost_left) = &mut *left.lock();
            let from = heavy + *light_taken;
            if *heavy_taken < heavy && (!skips_heavy_files || from == queue.len()) {
                *heavy_taken += 1;
                *cost_left = cost_left.saturating_sub(size_of(queue[*heavy_taken - 1]));
                return *heavy_taken - 1..*heavy_taken;
            }
            let share = match is_last_round {
                true => usize::MAX,
                false => *cost_left / (workers * RUNS_PER_THREAD),
            };
            let (mut to, mut cost_of_run) = (from, 0);
            while to < queue.len() && (to == from || cost_of_run < share) {
                cost_of_run += size_of(queue[to]);
                to += 1;
            }
            *light_taken = to - heavy;
            *cost_left = cost_left.saturating_sub(cost_of_run);
            from..to
        };
        /// State that a worker with no files left waits on.
        #[derive(Default)]
        struct Activity {
            /// Number of workers looking for a file or running a task.
            active: usize,
            /// Number of workers waiting.
            waiting: usize,
            /// Counts commits and discards.
            changes: u64,
        }
        let activity = Guarded::new(Activity::default());
        let activity_has_changed = bun_threading::Condvar::new();
        // Call after a commit or a discard. `is_busy`: the caller already has its next file. Otherwise it immediately
        // looks for a file to recheck itself.
        let note_change = |is_busy: bool| {
            let mut activity = activity.lock();
            activity.changes += 1;
            if is_busy && activity.waiting != 0 {
                activity_has_changed.notify_one();
            }
        };
        // Returns the first file in program order that was discarded and is worth rechecking now: its commit was
        // invalid, a commit has resolved the cycle it was discarded for, or all earlier files are done, so its task
        // will be trusted.
        //
        // A file that was discarded at a cycle is rechecked every time that cycle has been committed, because then it
        // gets past it. After an invalid commit or a missed cycle, nothing guarantees that the next commit won't
        // discard the file again. So it gets one early recheck, and then waits until it's the first unchecked file. See
        // also `take_first_unchecked_file`.
        //
        // The round terminates, because a file is rechecked early only if another file became final since its last
        // visit began. That count only grows, and is bounded by the number of files. So it's greater at the start of
        // each early recheck of a file than at the start of the previous visit, whatever that visit was discarded for.
        let take_file_to_recheck = || -> Option<usize> {
            let next = final_files.lock().1;
            let done = files_done.load(Ordering::Acquire);
            let last = program.last_commit();
            let (mut lost, mut visits) = (lost.lock(), visits.lock());
            let mut can_recheck = |file: usize| {
                let visit = &mut visits[file];
                let after = std::mem::replace(&mut visit.commits_compared, last);
                if program.is_cycle_resolved(&visit.unresolved_cycle, after, last) {
                    visit.unresolved_cycle.clear();
                }
                visit.can_recheck_early
                    && (visit.unresolved_cycle.is_empty()
                        && visit.files_done < done
                        && (visit.was_discarded_at_cycle || !visit.was_retried_without_cycle)
                        || file == next && !visit.was_retried_as_first)
            };
            let candidates = lost.iter().enumerate();
            let candidates = candidates.filter(|&(_, &file)| can_recheck(file));
            let candidates: Vec<(usize, usize)> =
                candidates.map(|(at, &file)| (file, at)).collect();
            let &(file, at) = candidates.iter().min()?;
            visits[file].was_retried_as_first |= file == next;
            visits[file].was_retried_without_cycle |= !visits[file].was_discarded_at_cycle;
            visits[file].rechecks += 1;
            lost.swap_remove(at);
            drop((lost, visits));
            if candidates.len() > 1 && activity.lock().waiting != 0 {
                activity_has_changed.notify_one();
            }
            Some(file)
        };
        // Each thread's last task leaves its memory here for that thread's next task. The memory comes from the
        // thread's arena, so no other thread reuses it.
        let spares = Guarded::new(Vec::new());
        // Runs one task, which begins with the file `first` and continues with what `next` returns. Returns the file
        // that the thread's next task begins with.
        let run_task = |first: usize, next: &mut dyn FnMut() -> Option<usize>| -> Option<usize> {
            let thread = std::thread::current().id();
            let spare = {
                let mut spares = spares.lock();
                let own = spares.iter().position(|it: &(ThreadId, _)| it.0 == thread);
                own.map(|at| spares.swap_remove(at).1)
            };
            let mut checker = new_checker(expected, spare);
            // A task's index is the index of its first file, which is unique within the round.
            let round = match visits.lock()[first].rechecks {
                rechecks if rechecks != 0 && !is_last_round => FIRST_RECHECK_ROUND + rechecks,
                _ => round,
            };
            checker.begin_task(round as u32, first as u32);
            checker.see_commits(is_last_round);
            let mut trees_to_free = Vec::new();
            let (mut spent, mut index) = (0, first);
            let upcoming = loop {
                let file = to_check[index];
                {
                    let visit = &mut visits.lock()[index];
                    visit.commits_compared = program.last_commit();
                    visit.files_done = files_done.load(Ordering::Acquire);
                }
                {
                    let (is_checked, next) = &*final_files.lock();
                    let is_done = |before: usize| is_checked[before];
                    // The files in the same import cycle.
                    let components = &program.files.components;
                    let component = components.of_file.get(file.idx());
                    let component = component.and_then(|&at| components.all.get(at as usize));
                    let same_component = component.map_or(&[][..], |it| it.files).iter();
                    let same_component =
                        same_component.filter_map(|it| index_of_file.get(it).copied());
                    checker.set_first_in_order(
                        (*next..index).all(is_done),
                        same_component.take_while(|&it| it < index).all(is_done),
                    );
                }
                let checked = checker.check_file(file);
                if request.plan_options.discards_first_visits
                    && !is_last_round
                    && visits.lock()[index].rechecks == 0
                {
                    checker.discard_until_recheck();
                }
                if let Some(after_file) = request.after_file
                    && expected == wanted
                    && !checker.was_discarded()
                {
                    after_file(&mut checker, file);
                }
                let incomplete = checker.take_ran_out_of_stack().then_some(file);
                if let Some(progress) = request.progress {
                    progress.checked.fetch_add(1, Ordering::Relaxed);
                    let bytes = bytes_of(index);
                    progress.bytes_checked.fetch_add(bytes, Ordering::Relaxed);
                }
                spent += size_of(index);
                let upcoming = next();
                // A task caches what it evaluated about other files, and a file's own check must not hit what a later
                // file's check evaluated. So a task only moves forward in program order.
                let is_last = upcoming.is_none_or(|it| it < index) || spent >= task_cost;
                if !checker.commit_after_file(is_last) {
                    if let Some(progress) = request.progress {
                        progress.checked.fetch_sub(1, Ordering::Relaxed);
                        let bytes = bytes_of(index);
                        progress.bytes_checked.fetch_sub(bytes, Ordering::Relaxed);
                    }
                    {
                        let visit = &mut visits.lock()[index];
                        visit.can_recheck_early = checker.can_recheck_early();
                        visit.unresolved_cycle = checker.take_unresolved_cycle();
                        visit.was_discarded_at_cycle = !visit.unresolved_cycle.is_empty();
                    }
                    lost.lock().push(index);
                    note_change(upcoming.is_some());
                    break upcoming;
                }
                {
                    let (is_checked, next) = &mut *final_files.lock();
                    is_checked[index] = true;
                    while is_checked.get(*next) == Some(&true) {
                        *next += 1;
                    }
                }
                files_done.fetch_add(1, Ordering::Release);
                if program.files.modules[file.idx()].is_leaf {
                    trees_to_free.push(file);
                }
                accept(Outcome {
                    checked: vec![(file, checked)],
                    incomplete: incomplete.into_iter().collect(),
                });
                note_change(upcoming.is_some());
                match upcoming {
                    Some(following) if !is_last => index = following,
                    _ => break upcoming,
                }
            };
            deepest_stack.fetch_max(checker.deepest_stack(), Ordering::Relaxed);
            tasks_run.fetch_add(1, Ordering::Relaxed);
            checker.end_task_after_commits();
            // The checker borrows the files' HIR, so it must be gone before their trees are freed.
            spares.lock().push((thread, checker.into_spare()));
            free_trees(trees_to_free);
            upcoming
        };
        let first_files_worker = AtomicUsize::new(usize::MAX);
        let workers_started = AtomicUsize::new(0);
        // For each worker, the part of its run that it hasn't started. A worker can spend a long time on one file, or
        // wait in the middle of it for another thread's result. So a worker that finds the queue empty takes the second
        // half of the longest of these.
        let runs: Guarded<Vec<std::ops::Range<usize>>> = Guarded::new(Vec::new());
        let steal_run = |thief: usize| -> Option<usize> {
            let mut runs = runs.lock();
            let victim = (0..runs.len()).max_by_key(|&at| runs[at].len())?;
            let (from, to) = (runs[victim].start, runs[victim].end);
            if from == to {
                return None;
            }
            let middle = from + (to - from) / 2;
            runs[victim] = from..middle;
            runs[thief] = middle + 1..to;
            Some(middle)
        };
        let has_file_to_recheck = || {
            let (lost, visits) = (lost.lock(), visits.lock());
            lost.iter().any(|&file| visits[file].can_recheck_early)
        };
        // Call while no worker is active. Returns the first unchecked file if it was discarded, however often it was
        // rechecked before. Its task is trusted about cycles, and no other task is running that could commit and
        // discard it. This keeps the round from ending, and leaving the rest to one thread, because of what other tasks
        // did to that file.
        let take_first_unchecked_file = || -> Option<usize> {
            let next = final_files.lock().1;
            let (mut lost, mut visits) = (lost.lock(), visits.lock());
            let at = lost.iter().position(|&file| file == next)?;
            if !visits[next].can_recheck_early {
                return None;
            }
            visits[next].rechecks += 1;
            lost.swap_remove(at);
            Some(next)
        };
        let shared = (&take_file_to_recheck, &take_run, &run_task, &queue, &lost);
        let (runs, steal_run) = (&runs, &steal_run);
        let has_file_to_recheck = &has_file_to_recheck;
        let take_first_unchecked_file = &take_first_unchecked_file;
        let (activity, activity_has_changed) = (&activity, &activity_has_changed);
        // Returns a closure that runs one task per call on the current thread. The closure returns false once this
        // thread has nothing left to do in this round.
        //
        // A worker that finds no file waits as long as a discarded file can still be rechecked in this round and
        // another worker is active, because that worker's next commit can make the file recheckable. A worker that
        // commits or discards a file and already has its next file wakes one waiting worker. So does a worker that
        // takes a file to recheck and leaves another one behind.
        //
        // Every wait ends, because every active worker eventually finds no file. The last one to do so takes the first
        // unchecked file if that was discarded, and otherwise wakes all the others. A worker that wakes up to no change
        // and no active worker returns. A waiting worker holds no lock and no file.
        //
        // `is_called_again`: the caller calls the closure again right away whenever it returns true. Then the worker
        // stays active in between, because it still has files of its own to check. Otherwise no worker may wait for it
        // in the meantime.
        let worker = |is_called_again: bool| {
            let (take_file_to_recheck, take_run, run_task, queue, lost) = shared;
            let (first_files_worker, id) = (
                &first_files_worker,
                workers_started.fetch_add(1, Ordering::Relaxed),
            );
            {
                let mut runs = runs.lock();
                let workers = runs.len().max(id + 1);
                runs.resize(workers, 0..0);
            }
            let (mut first, mut is_active) = (None, false);
            move || {
                let mut next = || {
                    if let Some(file) = take_file_to_recheck() {
                        return Some(file);
                    }
                    if let Some(at) = runs.lock()[id].next() {
                        return Some(queue[at]);
                    }
                    // The first worker that sees a discarded file moves to the first unchecked files, and stays there.
                    let is_needed = !lost.lock().is_empty();
                    let is_mine = is_needed
                        && first_files_worker
                            .compare_exchange(usize::MAX, id, Ordering::Relaxed, Ordering::Relaxed)
                            .is_ok();
                    let mut run =
                        take_run(is_mine || first_files_worker.load(Ordering::Relaxed) == id);
                    let at = run.next();
                    runs.lock()[id] = run;
                    at.or_else(|| steal_run(id)).map(|at| queue[at])
                };
                let seen = {
                    let mut activity = activity.lock();
                    if !std::mem::replace(&mut is_active, true) {
                        activity.active += 1;
                    }
                    activity.changes
                };
                // A task requests its next file before it commits the last one, and that commit can make a discarded
                // file the next.
                let file = first.take().or_else(&mut next);
                first = file.and_then(|file| run_task(file, &mut next));
                if file.is_some() && is_called_again {
                    return true;
                }
                let mut activity = activity.lock();
                activity.active -= 1;
                is_active = false;
                if file.is_some() {
                    return true;
                }
                if activity.active == 0 {
                    first = take_first_unchecked_file();
                    if first.is_some() {
                        is_active = is_called_again;
                        activity.active += usize::from(is_active);
                        return true;
                    }
                    activity_has_changed.notify_all();
                }
                while activity.changes == seen && activity.active != 0 && has_file_to_recheck() {
                    activity.waiting += 1;
                    activity_has_changed.wait_guarded(&mut activity);
                    activity.waiting -= 1;
                }
                activity.changes != seen
            }
        };
        let work = || {
            let mut run_a_task = worker(true);
            while run_a_task() {}
        };
        match host.helpers_now() {
            Some(_) if workers > 1 => {
                run_with_current_helpers(host, 0, &mut worker(false), &work);
            }
            _ => host.parallel(workers, &|_| work()),
        }
    };
    let run_all_rounds = |expected: Requested| {
        let all: Vec<usize> = (0..to_check.len()).collect();
        run_tasks(0, &all, expected, false);
        let mut again = std::mem::take(&mut *lost.lock());
        if !again.is_empty() {
            again.shared_sort_unstable();
            run_tasks(1, &again, expected, true);
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
    // `GetDiagnosticsOfAnyProgram`: TypeScript's command line proceeds to the next kind of error only if there is none
    // of the previous kind. A file that doesn't parse, or is checked under inconsistent options, produces errors that
    // aren't worth reading.
    let stops = request.stops_like_tsc;
    // `type_checked`: check the files that are type checked, or else the others.
    let check_files = |expected: Requested, type_checked: bool| {
        if type_checked == is_any_type_checked {
            run_all_rounds(expected);
        }
        if !type_checked {
            let tasks = match threads == 1 || host.is_single_threaded() {
                true => 1,
                false => MIN_TASKS,
            };
            let tasks = only_emitted.chunks(only_emitted.len().div_ceil(tasks).max(1));
            let tasks: Vec<&[FileId]> = tasks.collect();
            host.parallel(tasks.len(), &|i| {
                accept(check_chunk(tasks[i], expected));
            });
        }
        finish_files();
    };
    // `EmitFilesAndReportErrors` calls `Emit` after collecting diagnostics, even if there are errors, and the
    // declaration transformer reports under `noEmit` too (`emitDeclarationFile`). `HandleNoEmitOnError` skips `Emit`,
    // and so does `noEmit` on an incremental program. Every `tsc -b` program is incremental. Otherwise this models `tsc
    // -p --noEmit`.
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
        let per_file_lists = std::mem::take(&mut *emit_diagnostics.lock());
        per_file_lists.into_iter().flatten().collect()
    };
    // The per-file lists that `show` built, in addition to `report.diagnostics`.
    let mut per_file_lists: Vec<Vec<Diagnostic>> = Vec::new();
    'stages: {
        if stops {
            let suspects: Vec<FileId> = (0..program.files.modules.len())
                .filter(|&i| {
                    let hir = &program.files.modules[i].hir;
                    // A file that's nested too deeply is only reported when it's visited.
                    (hir.has_parse_diagnostics
                        || hir.has_parse_or_grammar_diagnostics()
                        || hir.may_have_javascript_diagnostics()
                        || hir.ran_out_of_stack)
                        && is_reached.as_ref().is_none_or(|reached| reached[i])
                })
                .map(|i| FileId(i as u32))
                .collect();
            // A checker per file would cost more than checking the files.
            let chunks = suspects.chunks(suspects.len().div_ceil(MIN_TASKS).max(1));
            let chunks: Vec<&[FileId]> = chunks.collect();
            host.parallel(chunks.len(), &|i| {
                accept(check_chunk(chunks[i], Requested::Syntactic));
            });
            finish_files();
            let syntactic = std::mem::take(&mut *found.lock());
            if !syntactic.is_empty() {
                // `GetProgramDiagnostics` isn't called. An incremental program requests them when `Emit` writes its
                // build info (`ensureHasErrorsForState`).
                if explains_files {
                    let is_incremental = options.is_incremental || options.is_build;
                    report.listed_files = explain_files(is_incremental && !lists_files_only);
                }
                report.diagnostics.extend(syntactic.into_iter().flatten());
                report.files_not_checked = std::mem::take(&mut report.files_checked);
                report.diagnostics.extend(emit_on_early_exit());
                break 'stages;
            }
        }
        // Must run before any file is checked, which can free its HIR.
        if explains_files {
            report.listed_files = explain_files(true);
        }
        report.diagnostics.append(&mut about_options);
        // `ListFilesOnly`: no checker is queried, and `Emit` isn't called.
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
            check_files(wanted, type_checked);
            per_file_lists.append(&mut found.lock());
            // Errors without a file that a checker reports after this point are never collected.
            if type_checked {
                report.diagnostics.extend(global_errors());
            }
        }
        // `GetDiagnosticsOfAnyProgram` collects them itself if there are no other errors. This list also contains
        // suggestions.
        let is_error = |d: &Diagnostic| d.category == Category::Error;
        if !stops
            || emits_despite_errors
            || !(report.diagnostics[always_reported..].iter())
                .chain(per_file_lists.iter().flatten())
                .any(is_error)
        {
            per_file_lists.append(&mut emit_diagnostics.lock());
        }
        // `iterateBaseline`: a caller that writes output for every file also does so for the files that aren't checked.
        if let Some(after_file) = request.after_file
            && !request.plan_options.after_file_only_for_checked_files
        {
            let mut is_checked = vec![false; program.files.modules.len()];
            for file in to_check.iter().chain(&only_emitted) {
                is_checked[file.idx()] = true;
            }
            for i in 0..program.files.modules.len() {
                let (file, module) = (FileId(i as u32), &program.files.modules[i]);
                // TypeScript's own libraries aren't the caller's files. With `libReplacement` a library can be any
                // file.
                let is_excluded = match module.is_lib {
                    true => !options.lib_replacement,
                    false => !matches!(module.hir.kind, FileKind::Declaration | FileKind::Json),
                };
                if is_excluded || is_checked[i] {
                    continue;
                }
                let mut checker = boxed_checker(None);
                checker.begin_stack_budget();
                after_file(&mut checker, file);
            }
        }
    }
    report.deepest_stack = deepest_stack.into_inner();
    report.tasks_run = tasks_run.into_inner();
    report.incomplete = std::mem::take(&mut *incomplete.lock());
    report.incomplete.shared_sort();
    report.incomplete.dedup();
    let unreadable = host.take_unreadable();
    let cannot_read = (unreadable.iter()).map(|path| global(5083, &[displayed_path(path)]));
    report.diagnostics.extend(cannot_read);
    report.unreadable.extend(unreadable);
    sort_and_deduplicate_with(&mut report.diagnostics, per_file_lists);
    report.check_time = checking.elapsed();
    report.declaration_files = std::mem::take(&mut *declaration_files.lock());
    if let Some(room_slot) = in_room {
        room_slot.record_final_size(session.allocated_bytes());
    }
    root.release();
    report
}
