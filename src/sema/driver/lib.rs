//! Type checks a project: finds its configuration and its files, checks them on every core, and
//! reports the errors.
//!
//! `bun check`, `bun build --check` and `bun run --check` all use this, with different roots and
//! different output formatting.

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
use bun_sema::check::{
    INFERENCE_WALK_COUNTS, MEMBER_COUNTS, Program, Requested, compute_ecma_line_starts,
};
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
    Host, ModuleDetection, Options, Phase, ProjectFile, ProjectFiles, ancestors, contains_path,
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
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::ThreadId;
use std::time::{Duration, Instant};

/// The caches that the worker threads of a check reuse from one file to the next. The threads
/// belong to the pool and outlive the check, so the caches are owned here: a thread has its set
/// for the duration of a parallel region, and gets the same set back in the next one. A set that
/// went from thread to thread would be grown and freed by another thread than the one that
/// allocated it, and the allocator defers such a free.
#[derive(Default)]
pub struct ThreadCaches {
    idle: Guarded<Vec<(ThreadId, RecentAtoms, bun_sema_parser::ThreadCaches)>>,
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
                    bun_sema_parser::ThreadCaches::take(),
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
        drop(bun_sema_parser::ThreadCaches::take());
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
    let region = Region {
        caches,
        threads: threads.clamp(1, count.div_ceil(run)),
        next: AtomicUsize::new(0),
        count,
        run,
        work,
    };
    // A thread of the pool has its turn.
    if keeps_regions() {
        return region.work_off();
    }
    let mut runners = vec![(); region.threads];
    pool_of_regions().each((), |(), (), _| region.work_off(), &mut runners);
}

/// The same, while the calling thread runs `meanwhile`. A thread that keeps its regions runs `meanwhile` afterwards.
pub(crate) fn for_each_parallel_while(
    caches: &ThreadCaches,
    threads: usize,
    count: usize,
    run: usize,
    work: &(dyn Fn(usize) + Sync),
    meanwhile: &mut dyn FnMut(),
) {
    if count == 0 || keeps_regions() {
        for_each_parallel_in_runs(caches, threads, count, run, work);
        return meanwhile();
    }
    let region = Region {
        caches,
        threads: threads.clamp(1, count.div_ceil(run)),
        next: AtomicUsize::new(0),
        count,
        run,
        work,
    };
    let mut runners = vec![(); region.threads];
    pool_of_regions().each_while((), |(), (), _| region.work_off(), &mut runners, meanwhile);
}

/// The same, on the calling thread and on at most `helpers` threads of the pool. The calling thread begins at once, and in the
/// end waits until each of the others has looked for work.
pub(crate) fn for_each_with_helpers(
    caches: &ThreadCaches,
    helpers: usize,
    count: usize,
    run: usize,
    work: &(dyn Fn(usize) + Sync),
) {
    let helpers = match helpers.min(count.div_ceil(run).saturating_sub(1)) {
        0 => 0,
        _ if keeps_regions() => 0,
        helpers => helpers,
    };
    let region = Region {
        caches,
        threads: 1 + helpers,
        next: AtomicUsize::new(0),
        count,
        run,
        work,
    };
    pool_of_regions().each_while(
        (),
        |(), (), _| region.work_off(),
        &mut vec![(); helpers],
        || region.work_off(),
    );
}

/// The same, on the calling thread, which runs a program, and on the other threads of that program's share. Spare threads join
/// whenever there are some, until the work runs out.
pub(crate) fn for_each_with_a_share(
    caches: &ThreadCaches,
    shares: &Shares,
    count: usize,
    run: usize,
    work: &(dyn Fn(usize) + Sync),
) {
    let region = Region {
        caches,
        threads: 1,
        next: AtomicUsize::new(0),
        count,
        run,
        work,
    };
    if keeps_regions() {
        return region.work_off();
    }
    let helpers = shares.helpers_of_this_thread();
    pool_of_regions().each_while(
        (),
        |(), (), _| region.work_off(),
        &mut vec![(); helpers.min(count.div_ceil(run).saturating_sub(1))],
        || {
            let _lent = caches.lend();
            region.work_off_with_spare_threads(shares);
        },
    );
}

/// How a request's threads are divided among its programs while several of them run at the same time. Each program runs on a
/// thread of its own, which loads and checks it, and has a fixed number of other threads to help with that.
pub(crate) struct Shares {
    state: Guarded<SharesState>,
    has_changed: bun_threading::Condvar,
    /// Threads with nothing to do, which any program may borrow. Whoever takes one back doesn't wait for the borrower, so this
    /// can be negative.
    spare: AtomicIsize,
}

struct SharesState {
    /// The threads that no program has. Once every program has got its share, they are spare.
    free: usize,
    /// How many programs have got their share. They get it in turn, so that small ones don't keep a large one waiting.
    served: usize,
    programs: usize,
    /// The thread that runs a program, and how many others that program has.
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

    /// For program number `turn`. Waits until those before it have their shares and `threads` are free.
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

/// Until it is dropped, the calling thread runs a program that has `helpers` other threads.
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

static OWN_POOL: OnceLock<bun_threading::ThreadPool> = OnceLock::new();

/// The parser nests as deep as on a thread of Bun's pool. The binder, the checker, hundreds of rules and the printers then walk
/// the tree by recursion, with frames of their own size, so their threads have eight times that stack. What is not touched
/// costs no memory.
pub const STACK_OF_A_WORKER: u32 = 8 * bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE;

static KEEP_REGIONS: Guarded<Vec<ThreadId>> = Guarded::new(Vec::new());

/// From now on, parallel regions that start on the calling thread run on that thread alone, like they do on a pool thread. Call
/// this on a thread outside the pool that pool threads wait for. If it waited for them too, they'd deadlock.
pub fn keep_regions_on_this_thread() {
    KEEP_REGIONS.lock().push(std::thread::current().id());
}

/// A thread of a pool that waited for the others could wait for ever: they may all be waiting like it.
fn keeps_regions() -> bool {
    !bun_threading::thread_pool::Thread::current().is_null()
        || KEEP_REGIONS.lock().contains(&std::thread::current().id())
}

/// From now on parallel regions run on a pool of their own. For work that waits on its thread for what Bun's pool does:
/// `bun lint` waits for rules in JavaScript, and such a rule can wait for a `Worker`, whose files are read and whose modules
/// are loaded on that pool. `name`: what its threads are called, before their number.
pub fn use_a_pool_of_their_own(name: &'static str) {
    OWN_POOL.get_or_init(|| {
        bun_threading::ThreadPool::init(bun_threading::thread_pool::Config {
            max_threads: u32::from(bun_core::get_thread_count()),
            stack_size: STACK_OF_A_WORKER,
            ..Default::default()
        })
        .named(name)
    });
}

/// The pool that parallel regions run on.
fn pool_of_regions() -> &'static bun_threading::ThreadPool {
    OWN_POOL
        .get()
        .unwrap_or_else(|| bun_threading::WorkPool::get())
}

/// What the threads of [`for_each_parallel_in_runs`] share.
struct Region<'a> {
    caches: &'a ThreadCaches,
    threads: usize,
    next: AtomicUsize,
    count: usize,
    run: usize,
    work: &'a (dyn Fn(usize) + Sync),
}

impl Region<'_> {
    /// `work_off`, for a thread that has its caches. Before each run it looks for spare threads to help it.
    fn work_off_with_spare_threads(&self, shares: &Shares) {
        loop {
            let claimed = self.next.load(Ordering::Relaxed);
            let runs_left = self.count.saturating_sub(claimed).div_ceil(self.run);
            let helpers = shares.borrow(runs_left.saturating_sub(1));
            if helpers > 0 {
                return pool_of_regions().each_while(
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

/// A checker is replaced after it has checked `1 / MIN_TASKS` of the total cost, because its private tables grow with every
/// file. A file that costs more than that is heavy and starts before the others.
const MIN_TASKS: usize = 128;
/// A thread takes a run of consecutive files from the queue at a time. The run's cost is the remaining cost divided by the
/// number of threads and by this.
const RUNS_PER_THREAD: usize = 4;

/// How a request is run.
#[derive(Clone, Copy)]
pub struct PlanOptions {
    /// How many projects of a `tsc -b` run are loaded or checked at the same time, at most, if each reads the sources of
    /// what it references. Otherwise four times as many. Each occupies memory.
    pub projects_at_once: usize,
    /// `Request::after_file` is only called for the files that are checked, not at the end for the
    /// declaration files and the JSON files that are not. The declaration files of the project itself, which are
    /// not in the default library or in `node_modules`, count as checked even with `skipLibCheck`,
    /// which still means that nothing is reported for them.
    pub after_file_is_for_checked_files: bool,
    /// Of a program, only the files in `Request::paths` are checked, not what they import. The
    /// types of what they import are computed where they are asked for, as in an editor.
    pub checks_only_named: bool,
    /// `useSourceOfProjectReferenceRedirect`, as in an editor: an import that leads into a
    /// referenced project reads its source, also where it names a declaration file that the project
    /// would emit. No referenced project is checked for the sake of another, and nothing is emitted.
    pub reads_sources_of_references: bool,
    /// `GetCurrentDirectory` of a program is the directory of its configuration file, as that of a
    /// `ConfiguredProject` of tsserver is. Without one it is `Request::cwd`, as always otherwise.
    pub current_directory_is_of_the_project: bool,
    /// Nobody reads what is reported about the files that are checked. So no `Diagnostic` is made of it: each has a copy
    /// of the lines around it, which in a bundle on one line is a copy of the file. And the files are not checked:
    /// `Request::after_file` asks for the types that it needs. See `Requested::Types`.
    pub reports_nothing_about_files: bool,
    /// A file of `Request::paths` is checked only in a project that includes it: that of the nearest configuration
    /// file or one that it references, or else the same for the configuration files further up
    /// (`findOrCreateDefaultConfiguredProjectWorker`). A file that none includes is not checked.
    pub only_in_a_project_that_includes: bool,
    /// With `only_in_a_project_that_includes`: `Request::project` isn't the project of every file. It's the project of the files
    /// that no project includes, which are checked after all. It is never refused, and shares no parsed file with the others.
    /// Only if the request has more programs than threads. Otherwise those files stay unchecked: a request of their own, after
    /// this one, has all the threads for them, and the memory of this one is free by then.
    pub project_is_for_the_rest: bool,
    /// `CreateProgram` of tsgolint: there is no program for a configuration file that has an error, in itself or in what
    /// the program says about its options and its files (`GetProgramDiagnostics`). No file is checked in it: see
    /// `Report::refused`.
    pub refuses_broken_configurations: bool,
    /// The `lib.*.d.ts` of a program are those of the `typescript` that is installed for it: of the first
    /// `node_modules/typescript` from the directory of the configuration file upwards, if that has the files that `lib` and
    /// `target` name. Else they are `Request::libs`. What the project's own compiler reads about `Element` is what is read here.
    /// And its configuration file means what it means to that compiler: `resolve::INSTALLED_MAJOR`.
    pub prefers_the_library_of_the_project: bool,
    /// What the programs of a request have in common, parsed once and kept to the end (`program::Run`). Off, `bun check`: the
    /// declaration files. On, `bun lint`: every file, sources too: a run with types over a monorepo loads the same sources
    /// for a hundred programs.
    pub shares_every_file: bool,
    /// Nothing is checked: `Report::globals` is what is asked for. Of the root files of a project only those are loaded that can
    /// declare a global, judged by name and text (`may_declare_a_global`), with the libraries and the `types` as always; of
    /// what they import only what declaration files import. A file of `Request::paths` without a configuration file above
    /// it is in no program, and nothing is said about a program for which `Files::global_names` says nothing, or whose
    /// packages are not installed.
    pub only_the_globals: bool,
    /// The memory of the machine, or of the container that the process is in: the programs of a request run at the same
    /// time as far as a quarter of it goes. 0: it is not known, and they run one after the other.
    pub memory: usize,
}

impl Default for PlanOptions {
    fn default() -> PlanOptions {
        PlanOptions {
            projects_at_once: 4,
            after_file_is_for_checked_files: false,
            checks_only_named: false,
            reads_sources_of_references: false,
            current_directory_is_of_the_project: false,
            reports_nothing_about_files: false,
            only_in_a_project_that_includes: false,
            project_is_for_the_rest: false,
            refuses_broken_configurations: false,
            prefers_the_library_of_the_project: false,
            shares_every_file: false,
            only_the_globals: false,
            memory: 0,
        }
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
        const MAX_NESTED: usize = 64;
        let file_name = join(self.cwd, file_name);
        // `tryReadFile`. The original reads a file that names itself, or a long chain of files,
        // until its stack ends.
        let is_refused =
            self.response_files.len() >= MAX_NESTED || self.response_files.contains(&file_name);
        let text = match is_refused {
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
        // Who refuses a broken configuration asks what `tsc -p` says about it, output paths too (5011, 5055).
        .chain(
            (!is_build && !request.build && !request.plan_options.refuses_broken_configurations)
                .then(|| (b"noEmit".to_vec(), Json::Bool(true))),
        )
        .collect()
}

/// The `node_modules/typescript` that is nearest to the configuration file at `config`.
fn installed_typescript(host: &dyn Host, config: &[u8]) -> Option<Vec<u8>> {
    ancestors(dirname::<Posix>(config))
        .map(|directory| inside(directory, b"node_modules/typescript"))
        .find(|package| host.is_dir(package))
}

/// `resolve::INSTALLED_MAJOR` for the configuration file at `config`: `PlanOptions::prefers_the_library_of_the_project`.
fn defaults_of_the_installed_typescript(
    host: &dyn Host,
    request: &Request,
    config: &[u8],
) -> Option<(Vec<u8>, Json)> {
    if !request.plan_options.prefers_the_library_of_the_project {
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

/// `Request::listed_projects`
pub trait ListedProjects: Sync {
    /// The configuration files for the file at `path`: absolute, in the checker's format.
    fn of(&self, path: &[u8], is_case_sensitive: bool) -> &[Vec<u8>];
}

#[derive(Clone, Copy)]
pub struct Request<'a> {
    /// The working directory, as a native path.
    pub cwd: &'a [u8],
    /// `--project`: a configuration file, or a directory with a `tsconfig.json` in it.
    pub project: Option<&'a [u8]>,
    /// `parserOptions.project` of typescript-eslint, without `project`: a file of `paths` is checked in the first of these
    /// projects that has it among its root files (`getWatchProgramsForProjects`). The projects that one references are not
    /// asked. A file that none of them has is checked as if there were no list.
    pub listed_projects: Option<&'a dyn ListedProjects>,
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
    /// The order in which the files are queued. 1: the largest first. Any other odd
    /// number: by index * `order` (mod 2^32), a fixed permutation. The output does not depend on
    /// it. For tests of that property.
    pub order: u32,
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
    /// are still alive. The way to read the type of every expression without `retains_everything`. A discarded task's files are
    /// rechecked, so this can be called more than once for a file: the last call counts.
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

/// One pass over the queue of files, as it ran. For `--timing`.
#[derive(Clone)]
pub struct RoundReport {
    pub tasks: usize,
    pub files: usize,
    /// Wall time from the start of the first task to the end of the last.
    pub elapsed: Duration,
    /// Summed over the tasks: time spent waiting for the commit mutex, holding it, and waiting for claims of variances.
    pub waits: [Duration; 3],
    /// The discarded tasks: the file each was checking, and why.
    pub lost: Vec<(Vec<u8>, &'static str)>,
    /// Time that threads spent without a task before the round ended, summed over the threads.
    pub idle: Duration,
    /// The five slowest tasks: wall time, number of files, path of the first file.
    pub slowest_tasks: Vec<(Duration, usize, Vec<u8>)>,
    /// Keys that the tasks logged for their commits.
    pub logged: u64,
    /// Entries that those commits stored. The other keys were bound, or another task stored them first.
    pub stored: u64,
}

/// `taskResult.builder`: how much of a `Report` one task of a build has printed.
#[derive(Clone, Copy)]
pub struct TaskOutput {
    pub resolution_trace: usize,
    pub diagnostics: usize,
    pub listed_files: usize,
}

/// A file that is not fully checked.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Incomplete {
    pub path: Vec<u8>,
    /// `hir::File::ran_out_of_stack`: the stack was too small for the tree. Otherwise it was too
    /// small for a query of the checker, which was abandoned.
    pub is_nested_too_deeply: bool,
}

impl Incomplete {
    /// What is said about the file, which is shown as `path`.
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

/// A program that was not made: its configuration file can't be read, or `PlanOptions::refuses_broken_configurations`.
pub struct Refused {
    pub config_path: Vec<u8>,
    /// The errors of reading the configuration file, or else those of the program about its options and its files.
    pub diagnostics: Vec<Diagnostic>,
    /// The files of `Request::paths` that were to be checked in it, each a `tspath.Path`.
    pub files: Vec<Vec<u8>>,
}

/// A program of which only some files were asked for, and whose configuration file has neither `include` nor `files`, nor has
/// one that it extends. So it includes every file below it.
pub struct WithoutInclude {
    pub config_path: Vec<u8>,
    /// How many files it includes.
    pub included: usize,
    /// How many files of `Request::paths` were checked in it.
    pub asked_for: usize,
    /// The first of them, a `tspath.Path`.
    pub example: Vec<u8>,
    pub load_time: Duration,
}

/// `PlanOptions::only_the_globals`
pub struct GlobalsOf {
    /// The files of `Request::paths` that are in the program, each a `tspath.Path`. Sorted.
    pub files: Vec<Vec<u8>>,
    pub names: Vec<GlobalName>,
    /// `checkJs`
    pub checks_javascript: bool,
}

#[derive(Default)]
pub struct Report {
    /// Sorted as TypeScript sorts them: diagnostics without a file first, then by path and
    /// position.
    pub diagnostics: Vec<Diagnostic>,
    /// Files of which errors may be missing.
    pub incomplete: Vec<Incomplete>,
    /// `Host::take_unreadable`: the source files that could not be read. Each was checked as an empty file.
    pub unreadable: Vec<Vec<u8>>,
    pub refused: Vec<Refused>,
    pub without_include: Vec<WithoutInclude>,
    pub globals: Vec<GlobalsOf>,
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
    /// Of several projects: how many parses they have in common. A file that two of them load counts twice in
    /// `files_loaded`, and once here if they read it alike.
    pub files_parsed_for_all: usize,
    pub files_checked: usize,
    /// Those that were to be checked in a program with an error in its syntax, its options or its
    /// global types. As in `tsc`, nothing else is reported for such a program.
    pub files_not_checked: usize,
    /// The rounds that ran, in order.
    pub rounds: Vec<RoundReport>,
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
    /// `Checker::inference_walk_counts`, summed over the tasks.
    pub inference_walks: [u64; INFERENCE_WALK_COUNTS.len()],
    /// `Checker::member_counts`, summed over the tasks.
    pub members: [u64; MEMBER_COUNTS.len()],
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
        self.unreadable.extend(other.unreadable);
        self.refused.extend(other.refused);
        self.without_include.extend(other.without_include);
        self.globals.extend(other.globals);
        self.listed_files.extend(other.listed_files);
        self.scripts_elsewhere.extend(other.scripts_elsewhere);
        self.resolution_trace.extend(other.resolution_trace);
        self.tasks.extend(other.tasks);
        self.has_bun_types_installed |= other.has_bun_types_installed;
        self.files_loaded += other.files_loaded;
        self.files_parsed_for_all += other.files_parsed_for_all;
        self.files_checked += other.files_checked;
        self.files_not_checked += other.files_not_checked;
        self.rounds.extend(other.rounds);
        self.check_time += other.check_time;
        for (phase, more) in self.load_phases.iter_mut().zip(other.load_phases) {
            *phase += more;
        }
        self.deepest_stack = self.deepest_stack.max(other.deepest_stack);
        for (sum, more) in self.inference_walks.iter_mut().zip(other.inference_walks) {
            *sum += more;
        }
        for (sum, more) in self.members.iter_mut().zip(other.members) {
            *sum += more;
        }
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
/// A line with more bytes is not hand-written. No layout shows it, and only one character more of it is stored
/// (`Diagnostic::source`): a bundle on one line can have thousands of errors.
pub const MAX_SHOWN_LINE: usize = 1000;

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

/// `GetECMALineAndUTF16CharacterOfPosition`: the 0-based line that contains `offset`, and the number
/// of UTF-16 code units before it on that line. What follows one of `counted` on its line is counted from there, not
/// from the start of the line.
fn line_and_character(text: &[u8], starts: &[u32], offset: u32, counted: &Counted) -> (u32, u32) {
    let offset = offset.min(text.len() as u32);
    let line = starts.partition_point(|&s| s <= offset) - 1;
    let mut places = counted.places.get();
    let nearest = (0..places.len())
        .filter(|&i| (starts[line]..=offset).contains(&places[i].0))
        .max_by_key(|&i| places[i].0);
    let (from, units) = nearest.map_or((starts[line], 0), |i| places[i]);
    let character = units + strings::utf8_lossy_len_utf16(&text[from as usize..offset as usize]);
    let written = nearest.unwrap_or_else(|| counted.older.get());
    places[written] = (offset, character);
    counted.places.set(places);
    counted.older.set(1 - written);
    (line as u32, character)
}

/// Two offsets in a text that `line_and_character` was asked for, each with the number it found. Two, because errors
/// that start at one place and end further and further on, as those of a chain of operators do, are asked for in turn.
#[derive(Default)]
struct Counted {
    places: std::cell::Cell<[(u32, u32); 2]>,
    /// Which of them was written before the other.
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
    // Unless `bun lint` or `bun fmt` has one.
    use_a_pool_of_their_own("Bun Check");
    let threads = match request.threads {
        0 => usize::from(bun_core::get_thread_count()),
        n => n,
    };
    let cwd = host::from_native(request.cwd);
    let of_every_file = !request.plan_options.project_is_for_the_rest;
    let named = (request.project.filter(|_| of_every_file))
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
    release_free_pages_of(pool_of_regions());
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
            let mut options = overriding_options(request, false);
            options.extend(defaults_of_the_installed_typescript(disk, request, config));
            options
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
        follows_references: bool,
    ) -> Option<Vec<u8>> {
        let is_case_sensitive = disk.is_case_sensitive();
        let mut seen: Vec<Vec<u8>> = Vec::new();
        // Those to look at, the next one last. A loop: a chain of references can be of any length.
        let mut pending = vec![config.to_vec()];
        while let Some(config) = pending.pop() {
            let is_seen = |it: &Vec<u8>| is_same_path(it, &config, is_case_sensitive);
            if seen.iter().any(is_seen) || !disk.is_file(&config) {
                continue;
            }
            seen.push(config.clone());
            let is_new = !self.files.contains_key(&config);
            let counts_javascript = self.counts_javascript;
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
                let files = match counts_javascript {
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
        // Those to add, the next one last.
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
        let has_to_include = request.plan_options.only_in_a_project_that_includes;
        let Some(nearest) = nearest else {
            return if has_to_include { Err(None) } else { Ok(None) };
        };
        if let Some(owner) = self.find_project_with(disk, request, &nearest, path, true) {
            return Ok(Some(owner));
        }
        // `getAncestorConfigFileName`
        let mut below = nearest.clone();
        loop {
            // `--project` is the only one that is asked.
            let is_the_only_one =
                request.project.is_some() && !request.plan_options.project_is_for_the_rest;
            if !has_to_include || is_the_only_one {
                break;
            }
            // Up to the root. What is above `/C:` is `/`, which is no directory of Windows.
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
    found.shared_sort_unstable();
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
    let (explicit, for_the_rest) = match request.plan_options.project_is_for_the_rest {
        true => (None, explicit),
        false => (explicit, None),
    };
    // `--project`, or else the configuration file nearest to a directory, or else nearest to the
    // working directory.
    // By directory: a run of the linter names every file of a repository.
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
                    run: None,
                    place: None,
                };
                let projects = Guarded::new(projects);
                return check_project_of(disk, request, &projects, of, report, started);
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
    // From the end: most files are in the same project as the one before.
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
                Err(_) if request.plan_options.only_in_a_project_that_includes => {
                    if for_the_rest.is_some() {
                        add(for_the_rest.clone(), Extent::Project, path.clone());
                    }
                }
                Ok(owner) | Err(owner) => add(owner, Extent::Project, path.clone()),
            }
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
                files.shared_sort_by_cached_key(|it| to_path(it, is_case_sensitive).into_owned());
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
    let is_at_once = request.plan_options.memory != 0 && disk.threads() > 1;
    if !(is_at_once && by_project.len() > disk.threads()) {
        by_project.retain(|it| for_the_rest.is_none() || it.0 != for_the_rest);
    }
    let only_the_globals = request.plan_options.only_the_globals;
    by_project.retain(|it| !it.2.is_empty() && !(only_the_globals && it.0.is_none()));
    if by_project.is_empty() && only_the_globals {
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
    let is_one = by_project.len() == 1;
    let paths_of = |files: &'_ [Vec<u8>]| -> Vec<Vec<u8>> {
        let paths = files.iter().map(|it| to_path(it, is_case_sensitive));
        paths.map(Cow::into_owned).collect()
    };
    let paths_by_project: Vec<Vec<Vec<u8>>> = by_project.iter().map(|it| paths_of(&it.2)).collect();
    let all: FxHashSet<&[u8]> = (paths_by_project.iter().flatten())
        .map(Vec::as_slice)
        .collect();
    // Declared before the session of any program, so it is dropped after them.
    let of_run = Session::new();
    let at_once = match request.plan_options.memory {
        0 => 1,
        _ => disk.threads().min(by_project.len()),
    };
    // Those with the most files first, so that no thread begins a large one when the others are nearly done.
    let mut in_order: Vec<usize> = (0..by_project.len()).collect();
    if at_once > 1 {
        in_order.shared_sort_by_key(|&it| Reverse(by_project[it].2.len()));
    }
    let run = (!is_one).then(|| {
        let run = Run::new(&of_run, disk.provided_paths().cloned().collect());
        match request.plan_options.shares_every_file {
            true => run,
            false => run.of_declaration_files(),
        }
    });
    let projects = Guarded::new(projects);
    let in_common = || run.as_ref().map_or(0, Run::bytes);
    let shares = (at_once > 1).then(|| Arc::new(Shares::new(disk.threads(), by_project.len())));
    (*disk.shares.lock()).clone_from(&shares);
    let room = Room {
        bytes: (request.plan_options.memory / 4).max(1 << 30),
        in_common: &in_common,
        threads: disk.threads(),
        shares: shares.as_deref(),
        taken: Guarded::new(Taken::default()),
        has_changed: bun_threading::Condvar::new(),
    };
    let next = AtomicUsize::new(0);
    let reports: Vec<Guarded<Option<Report>>> =
        by_project.iter().map(|_| Guarded::new(None)).collect();
    // Each when there are threads and room for it.
    let check_the_next_ones = || {
        loop {
            let turn = next.fetch_add(1, Ordering::Relaxed);
            let Some(&index) = in_order.get(turn) else {
                break;
            };
            let (config, extent, files) = &by_project[index];
            let own: FxHashSet<&[u8]> = (paths_by_project[index].iter())
                .map(Vec::as_slice)
                .collect();
            let elsewhere: FxHashSet<&[u8]> = all.difference(&own).copied().collect();
            let place = room.enter(turn, files.len(), all.len());
            let of = OfProject {
                config: config.as_deref(),
                named: Some((*extent, files.as_slice())),
                elsewhere: (!is_one).then_some(&elsewhere),
                run: (run.as_ref()).filter(|_| for_the_rest.is_none() || *config != for_the_rest),
                place: (at_once > 1).then_some(&place),
            };
            let (so_far, began) = (Report::default(), Instant::now());
            let checked = check_project_of(disk, request, &projects, of, so_far, began);
            *reports[index].lock() = Some(checked);
        }
    };
    // A thread that loads and checks a program needs the stack of a worker. The calling thread has the stack it was given, so it
    // only waits then.
    std::thread::scope(|scope| {
        let (threads, mut started) = (if at_once > 1 { at_once } else { 0 }, 0);
        for _ in 0..threads {
            // Without the thread, the others check its share.
            let thread = std::thread::Builder::new()
                .stack_size(STACK_OF_A_WORKER as usize)
                .spawn_scoped(scope, || {
                    // As a thread of the pool does when it starts: the parsers check the stack.
                    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Check"));
                    check_the_next_ones();
                });
            started += usize::from(thread.is_ok());
        }
        if started == 0 {
            check_the_next_ones();
        }
    });
    *disk.shares.lock() = None;
    for mut checked in reports {
        let Some(checked) = checked.get_mut().take() else {
            continue;
        };
        report.projects_checked += checked.projects_checked.max(usize::from(!is_one));
        report.merge(checked);
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    if request.plan_options.shares_every_file {
        report.files_parsed_for_all += run.as_ref().map_or(0, Run::parses);
    }
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
struct OfProject<'a, 'u> {
    /// `None`: there is no configuration file.
    config: Option<&'a [u8]>,
    /// `None`: all of its files.
    named: Option<(Extent, &'a [Vec<u8>])>,
    /// The files that are checked in another project, by `tspath.Path`. This one may import them.
    elsewhere: Option<&'a FxHashSet<&'a [u8]>>,
    /// Of the request, if it has more than one project.
    run: Option<&'a Run<'u>>,
    /// Among the programs that run at the same time.
    place: Option<&'a Place<'a>>,
}

/// How many programs of a request run at the same time: as many as there are threads and memory for. What a program takes isn't
/// known before its files are found. Until then it counts for what those that have ended took on average. From then on it
/// counts for what it has, plus what a check has added on average. One that turns out larger than there is room for goes on
/// when others have ended.
struct Room<'a> {
    /// What the process may take.
    bytes: usize,
    /// The bytes of what the programs have in common, which grows.
    in_common: &'a (dyn Fn() -> usize + Sync),
    threads: usize,
    /// `None`: one program runs after the other, with all threads.
    shares: Option<&'a Shares>,
    taken: Guarded<Taken>,
    has_changed: bun_threading::Condvar,
}

#[derive(Default)]
struct Taken {
    bytes: usize,
    programs: usize,
    /// Those whose files are found, and that go on.
    going_on: usize,
    /// Those that wait for room.
    waiting: usize,
    /// The most that one has taken so far.
    largest: usize,
    ended: usize,
    /// What those that have ended took, all together.
    of_the_ended: usize,
    /// The part of it that they took after their files were found.
    added: usize,
}

/// Of a program in a `Room`, until it is dropped.
struct Place<'a> {
    room: &'a Room<'a>,
    bytes: AtomicUsize,
    /// What it had when its files were found.
    found: AtomicUsize,
    goes_on: std::sync::atomic::AtomicBool,
    /// Its share of the threads.
    threads: usize,
    /// It has no more of the files than one thread has of the work, so one thread checks it.
    is_for_one_thread: bool,
}

impl Room<'_> {
    /// There is always room for a program of this size on each thread, unless `bytes` says otherwise.
    const SMALL: usize = 64 << 20;

    /// Whether the programs may count for `bytes` together. Then the request takes no more than half as much again as with one
    /// program after the other, which is what they have in common and the largest, and the process no more than `self.bytes`.
    /// Part of what the programs count for is resident already, so this errs on the safe side.
    fn has(&self, taken: &Taken, bytes: usize) -> bool {
        let in_common = (self.in_common)();
        let resident = bun_sys::self_process_memory_usage().unwrap_or(in_common);
        let one_after_the_other = in_common + taken.largest;
        bytes <= (taken.largest + one_after_the_other / 2).max(self.threads * Room::SMALL)
            && resident + bytes <= self.bytes
    }

    /// For a program that has `threads`. They have nothing to do meanwhile.
    fn wait(
        &self,
        taken: &mut bun_threading::guarded::GuardedLock<'_, Taken, bun_threading::Mutex>,
        threads: usize,
    ) {
        if let Some(shares) = self.shares {
            shares.lend(threads);
        }
        taken.waiting += 1;
        self.has_changed.wait_guarded(taken);
        taken.waiting -= 1;
        if let Some(shares) = self.shares {
            shares.take_back(threads);
        }
    }

    /// For program number `turn`, which has `files` of `all` files. Waits until it has its threads, and until there is room for
    /// one more or nothing else runs.
    fn enter(&self, turn: usize, files: usize, all: usize) -> Place<'_> {
        let threads = (files * self.threads / all.max(1)).clamp(1, self.threads);
        if let Some(shares) = self.shares {
            shares.take(turn, threads);
        }
        let mut taken = self.taken.lock();
        loop {
            let bytes = (taken.of_the_ended / taken.ended.max(1)).max(Room::SMALL);
            if taken.programs == 0 || self.has(&taken, taken.bytes + bytes) {
                taken.programs += 1;
                taken.bytes += bytes;
                return Place {
                    room: self,
                    bytes: AtomicUsize::new(bytes),
                    found: AtomicUsize::new(0),
                    goes_on: std::sync::atomic::AtomicBool::new(false),
                    threads,
                    is_for_one_thread: files * self.threads <= all,
                };
            }
            self.wait(&mut taken, threads);
        }
    }
}

impl Place<'_> {
    fn counts_for(&self, taken: &mut Taken, bytes: usize) {
        taken.bytes = taken
            .bytes
            .saturating_sub(self.bytes.swap(bytes, Ordering::Relaxed))
            + bytes;
    }

    /// The files of the program are found, and it has `bytes`. Waits until there is room for what it is expected to take, or no
    /// other goes on.
    fn has_found_its_files(&self, bytes: usize) {
        let mut taken = self.room.taken.lock();
        self.found.store(bytes, Ordering::Relaxed);
        taken.largest = taken.largest.max(bytes);
        let expected = bytes + taken.added / taken.ended.max(1);
        self.counts_for(&mut taken, expected);
        self.room.has_changed.notify_all();
        while taken.going_on > 0 && !self.room.has(&taken, taken.bytes) {
            self.room.wait(&mut taken, self.threads);
        }
        taken.going_on += 1;
        self.goes_on.store(true, Ordering::Relaxed);
    }

    /// It has taken `bytes` in the end.
    fn has_taken(&self, bytes: usize) {
        let mut taken = self.room.taken.lock();
        let found = self.found.load(Ordering::Relaxed);
        taken.largest = taken.largest.max(bytes);
        taken.ended += 1;
        taken.of_the_ended += bytes;
        taken.added += bytes.saturating_sub(found);
        self.counts_for(&mut taken, bytes);
    }
}

impl Drop for Place<'_> {
    fn drop(&mut self) {
        let mut taken = self.room.taken.lock();
        taken.bytes = taken.bytes.saturating_sub(*self.bytes.get_mut());
        taken.programs -= 1;
        if *self.goes_on.get_mut() {
            taken.going_on -= 1;
        }
        let is_one_waiting = taken.waiting > 0;
        drop(taken);
        // What the allocator keeps of this program to use it again is resident too.
        if is_one_waiting {
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
    of: OfProject<'_, '_>,
    mut report: Report,
    started: Instant,
) -> Report {
    let mut project = match of.config {
        Some(config) => match projects.lock().take(disk, request, config) {
            Ok(project) => project,
            // `tscCompilation`: "these are unrecoverable errors--exit to report them as
            // diagnostics". To a build, `upToDateStatusTypeConfigFileNotFound`.
            Err(errors) => {
                let is_case_sensitive = disk.is_case_sensitive();
                let files = of.named.map(|it| it.1).unwrap_or_default().iter();
                let mut last = None;
                let diagnostics: Vec<Diagnostic> = (errors.iter())
                    .map(|it| of_config_error(disk, config, it, &mut last))
                    .collect();
                if !request.plan_options.refuses_broken_configurations {
                    match request.build {
                        true => report
                            .diagnostics
                            .push(global(6053, &[displayed_path(config)])),
                        false => report.diagnostics.extend(diagnostics.iter().cloned()),
                    }
                    report.load_time = started.elapsed();
                }
                report.refused.push(Refused {
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
            let files = of.named.map(|it| it.1).unwrap_or_default();
            project_without_config(disk, request, &cwd, files)
        }
    };
    let is_case_sensitive = disk.is_case_sensitive();
    let named = of.named.map(|(extent, named)| {
        if extent == Extent::Project && !request.plan_options.only_the_globals {
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
        named.shared_sort_unstable();
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
        check_with_references(
            disk,
            project,
            request,
            report,
            started,
            named,
            of.elsewhere,
            of.run,
            of.place,
        )
    } else {
        // All of its files: the project, with what no file imports.
        let is_whole = |(extent, named): &(Extent, &[Vec<u8>])| {
            let is_named = |it: &Vec<u8>| is_among(named, &to_path(it, is_case_sensitive));
            *extent == Extent::Graph && project.files.iter().all(is_named)
        };
        let named = named.filter(|it| !is_whole(it)).map(|it| it.1);
        let is_elsewhere = (of.elsewhere).map(|elsewhere| |path: &[u8]| elsewhere.contains(path));
        check_named_files(
            disk,
            project,
            request,
            report,
            started,
            named,
            (is_elsewhere.as_ref()).map(|it| it as &dyn Fn(&[u8]) -> bool),
            None,
            of.run,
            of.place,
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
    request: &'h Request<'h>,
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
        let load = |config: &[u8]| -> Option<config::Project> {
            let over = |_: bool| {
                let mut options = self.overrides.clone();
                let defaults =
                    defaults_of_the_installed_typescript(self.host, self.request, config);
                options.extend(defaults);
                options
            };
            if !self.host.is_file(config) {
                return None;
            }
            // What is parsed is freed at once: there can be tens of thousands.
            config::load_overriding(self.host, &Session::new(), config, &over).ok()
        };
        // On all threads, by name: what the root references, then what that references, and so on.
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

    /// The start of `setupBuildTask`. `Err`: the task is not new: its index in `projects`, or
    /// `None` if nothing has to wait for it.
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
        // Not there: it is `completed`, and its configuration file was not found.
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
        let shown = displayed_path(config_name).into_owned();
        self.circularity_stack.push(shown);
        Ok(OpenTask {
            path,
            project,
            references_done: 0,
            up_stream: Vec::new(),
            in_circular_context,
        })
    }

    /// `setupBuildTask` for the project at `config_name` and all that it references. A loop: a chain
    /// of references can be of any length.
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
    /// How many of the references of `project` have been set up.
    references_done: usize,
    up_stream: Vec<usize>,
    in_circular_context: bool,
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

/// What the projects of a `tsc -b` run have emitted so far, and which of them are built. Nothing is written to disk.
struct Emitted {
    /// By `tspath.Path`, like `directories`: the file system finds a file however its name is spelled, if it ignores case.
    /// The projects that have emitted the file, each with the text. A JavaScript file is empty: nothing prints its text.
    files: ShardedMap<Vec<u8>, Guarded<Vec<(usize, Arc<Vec<u8>>)>>>,
    /// The directories that contain the files, and all their ancestors: of which projects.
    directories: ShardedMap<Vec<u8>, Guarded<Vec<usize>>>,
    has_files: AtomicBool,
    /// By project: how many were built before it. `usize::MAX`: it is not built.
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

    /// Once for a project, before it counts as built.
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
            let of_all = self.files.insert_ref(path, Guarded::default());
            of_all.lock().push((project, text));
        }
        for directory in directories {
            let of_all = self.directories.insert_ref(directory, Guarded::default());
            of_all.lock().push(project);
        }
    }
}

/// The file system as a `tsc -b` run leaves it for one project: it also contains what the projects
/// before it in the build order have emitted, whether it references them or not.
struct WithOutputs<'h> {
    disk: &'h dyn Host,
    emitted: &'h Emitted,
    expected: &'h Expected,
    /// Of this project, in the build order.
    index: usize,
    /// How many projects were built when this one began. What the others emit meanwhile is not there for it.
    built_before: usize,
    /// `Host::origin` of what the first project emits.
    first_origin: usize,
    /// The projects before it that it does not see, and whose output it has asked for. What it was answered is wrong.
    awaited: Guarded<Vec<usize>>,
    /// `Host::take_unreadable`, for this project: others are read through `disk` at the same time.
    unreadable: Guarded<Vec<Vec<u8>>>,
    /// How many projects are being built now. The thread that builds this one loads and checks it, so it has the stack of a
    /// worker, and `helpers` help it. `None`: it only waits, and the pool does the work.
    built_now: Option<&'h AtomicUsize>,
    /// See `Host::ends_the_process`.
    is_last_of_the_process: bool,
}

impl WithOutputs<'_> {
    /// The threads are divided equally among the projects that are being built. With a project for every thread, each is
    /// the work of one thread, which waits for no other. Rounded up: the threads of one project do wait for each other.
    fn helpers(&self, built_now: &AtomicUsize) -> usize {
        let projects = built_now.load(Ordering::Relaxed).max(1);
        self.disk.threads().max(1).div_ceil(projects) - 1
    }

    /// What `project` has emitted is there.
    fn sees(&self, project: usize) -> bool {
        let built_after = &self.emitted.built_after[project];
        project < self.index && built_after.load(Ordering::Relaxed) < self.built_before
    }

    /// `path` with symlinks resolved in the longest prefix that exists on disk: a workspace package
    /// is reached through a symlink in a `node_modules`, and its emitted files are keyed by its
    /// real path.
    fn through_links(&self, path: &[u8]) -> Option<Vec<u8>> {
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

    /// `projects` emit what was asked for.
    fn wait_for(&self, projects: Option<&Vec<usize>>) {
        let before = projects.into_iter().flatten();
        let before = before.take_while(|&&it| it < self.index);
        let mut pending = before.filter(|&&it| !self.sees(it)).peekable();
        if pending.peek().is_some() {
            self.awaited.lock().extend(pending);
        }
    }

    /// With the project that has emitted it: of several, the last in the build order has written last.
    fn file(&self, name: &[u8]) -> Option<(usize, Arc<Vec<u8>>)> {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(name, self.disk.is_case_sensitive(), &mut buffer[..]);
        self.wait_for(self.expected.files.get(&*path));
        let of_all = self.emitted.files.get_ref(&*path)?.lock();
        let seen = of_all.iter().filter(|it| self.sees(it.0));
        seen.max_by_key(|it| it.0).cloned()
    }

    fn has_directory(&self, name: &[u8]) -> bool {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(name, self.disk.is_case_sensitive(), &mut buffer[..]);
        self.wait_for(self.expected.directories.get(&*path));
        let of_all = self.emitted.directories.get_ref(&*path);
        of_all.is_some_and(|of_all| of_all.lock().iter().any(|&it| self.sees(it)))
    }

    fn written(&self, path: &[u8]) -> Option<(usize, Arc<Vec<u8>>)> {
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
            Some((_, written)) => Some(Cow::Owned((*written).clone())),
            None => self.disk.read(path),
        }
    }
    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        match self.written(path) {
            Some((_, written)) => Cow::Owned((*written).clone()),
            None => self.disk.read(path).unwrap_or_else(|| {
                self.unreadable.lock().push(path.to_vec());
                Cow::default()
            }),
        }
    }
    fn origin(&self, path: &[u8]) -> usize {
        (self.written(path)).map_or(0, |(project, _)| self.first_origin + project)
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
            // The calling thread is one of those that work.
            Some(_) => {
                self.parallel(count, work);
                meanwhile();
            }
            None => self.disk.parallel_while(count, work, meanwhile),
        }
    }
    fn is_of_one_thread(&self) -> bool {
        (self.built_now).is_some_and(|built_now| self.helpers(built_now) == 0)
    }
    fn ends_the_process(&self, _: bool) -> bool {
        self.is_last_of_the_process
    }
    fn helpers_now(&self) -> Option<usize> {
        self.built_now.map(|built_now| self.helpers(built_now))
    }
    fn with_helpers(&self, helpers: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
        self.disk.with_helpers(helpers, count, work);
    }
    fn loaded(&self) {
        // The threads go on to parse the files of the next project.
        if (self.built_now).is_none_or(|it| it.load(Ordering::Relaxed) < 2) {
            self.disk.loaded();
        }
    }
    fn threads(&self) -> usize {
        self.disk.threads()
    }
    fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
        // The threads that only read serve one load at a time.
        match self.built_now.map(|it| it.load(Ordering::Relaxed)) {
            Some(2..) => None,
            _ => self.disk.io_pool(),
        }
    }
}

/// A session that's dropped on all threads if the process is about to exit.
struct Dropped<'a> {
    session: Session,
    /// `None` if the process keeps running or the request has more programs.
    before_the_process_ends: Cell<Option<&'a dyn Host>>,
}

impl Drop for Dropped<'_> {
    fn drop(&mut self) {
        if let Some(host) = self.before_the_process_ends.get() {
            let session = std::mem::take(&mut self.session);
            session.drop_before_the_process_ends(&|count, work| host.parallel(count, work));
        }
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
    host: &host::Disk,
    root: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<(Extent, &[Vec<u8>])>,
    elsewhere: Option<&FxHashSet<&[u8]>>,
    run: Option<&Run<'_>>,
    place: Option<&Place<'_>>,
) -> Report {
    // Declared before the session of any program, so it is dropped after them.
    let of_build = Dropped {
        session: Session::new(),
        before_the_process_ends: Cell::new(None),
    };
    // True if the process exits after this build, unless a program finds scripts that belong to another tsconfig.
    let ends_the_process = host.ends_the_process(run.is_some()) && place.is_none();
    let is_case_sensitive = host.is_case_sensitive();
    let root_config_path = root.config_path.clone();
    let follows_references = !request.build && root.files.is_empty();
    let reports_references =
        request.build || follows_references || matches!(named, Some((Extent::Graph, _)));
    let configuration = Session::new();
    let mut graph = Graph {
        host,
        request,
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
    graph.setup_build_tasks(&root_config_path);
    let Graph {
        projects,
        index_of,
        mut errors,
        not_found,
        ..
    } = graph;
    let reads_sources = request.plan_options.reads_sources_of_references && !request.build;
    // `buildOrClean`: "Circularity errors prevent any project from being built". A program that reads the sources of what it
    // references waits for no build, like that of `tsc -p`, which doesn't look for a circle.
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
                    ConfigError::of_problems(host, &configuration, in_one_file[0].0, problems)
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
    // Then there is one program, that of `root`, and it reads what is on the disk. Otherwise what one program emits
    // another reads, and several run at the same time.
    let is_one_program = reads_sources && !reports_references;
    // Nothing waits for what is not emitted.
    let up_stream: Vec<Vec<usize>> = (projects.iter())
        .map(|p| match reads_sources {
            true => Vec::new(),
            false => p.up_stream.clone(),
        })
        .collect();
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
    let mut is_left_out: Vec<bool> = (has_named.iter().enumerate())
        // What is only read is read from its sources, by the program that reads it.
        .map(|(index, has)| {
            !has || reads_sources && !reports_references && Some(index) != root_index
        })
        .collect();
    let mut pending: Vec<usize> = (0..count)
        .filter(|&index| has_named[index] && !reads_sources)
        .collect();
    while let Some(index) = pending.pop() {
        let referenced = references[index].iter();
        pending.extend(referenced.filter(|&&it| std::mem::replace(&mut is_left_out[it], false)));
    }
    // As `build` below.
    let is_solution =
        |index: usize| roots[index].is_empty() && projects[index].project.has_references;
    let loaded = || (0..count).filter(|&index| !is_left_out[index] && !is_solution(index));
    // The programs read the same declaration files: the libraries, what is in `node_modules`, and what one emits for the
    // others. Each is parsed once, and freed in the end.
    let of_this_build = (run.is_none() && !reads_sources && loaded().count() > 1).then(|| {
        let provided = host.provided_paths().cloned().collect();
        Run::new(&of_build.session, provided).of_declaration_files()
    });
    let of_request = run.filter(|_| !reads_sources);
    let first_origin = match &of_this_build {
        Some(run) => run.origins(count),
        None => of_request.map_or(1, |run| run.origins(count)),
    };
    let is_read_by_a_program = |index: usize| {
        (0..count)
            .any(|by| !is_left_out[by] && !roots[by].is_empty() && references[by].contains(&index))
    };
    // Under `noEmit` nothing is emitted, and a `.d.ts` next to a `.js` source would be resolved
    // in its place.
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
    // `ParseInputOutputNames`, `getOutputDeclarationAndSourceFileNames`, for what a program references, directly or not.
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
            let of_all = project_files.sources.entry(path.clone()).or_default();
            of_all.push(ProjectFile {
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
    // Each program occupies memory, for every declaration file that it reaches, however few files the project lists. One
    // that reads the sources of what it references has all of those files too.
    let at_once = match reads_sources {
        true => request.plan_options.projects_at_once,
        false => request.plan_options.projects_at_once * 4,
    };
    let at_once = at_once.clamp(1, host.threads().max(1)).min(count.max(1));
    let built_now = (!reads_sources).then(|| AtomicUsize::new(0));
    // `built_before`: how many are built now. `Err`: the projects that have to be built first, besides
    // those that it references.
    // `is_last`: every other project is already built.
    let build = |index: usize,
                 built_before: usize,
                 is_last: bool|
     -> Result<Option<Report>, Vec<usize>> {
        let (mut project, mut about_references) = inputs[index].clone();
        if project.files.is_empty() && project.has_references {
            // `upToDateStatusTypeSolution`: there is no program. `buildProject` reports each of
            // `GetConfigFileParsingDiagnostics` as it comes.
            let errors = project.errors.iter().filter(|e| !e.is_about_options);
            let mut last = None;
            let diagnostics: Vec<Diagnostic> = errors
                .map(|error| of_config_error(host, &project.config_path, error, &mut last))
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
            is_last_of_the_process: is_last && ends_the_process,
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
            let mut of_all = project_files.sources.get(path).into_iter().flatten();
            !own.contains(path)
                && (of_all.any(|it| is_referenced.contains(&(it.project as usize)))
                    || elsewhere.is_some_and(|elsewhere| elsewhere.contains(path)))
        };
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
        let check = |run: Option<&Run<'_>>, place: Option<&Place<'_>>| {
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
                place,
            )
        };
        let mut checked = match &of_this_build {
            _ if is_one_program => check(run, place),
            Some(run) => check(Some(run), None),
            None => check(of_request, None),
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
            for (source, written) in std::mem::take(&mut checked.declaration_files) {
                let path = declaration_file_path(index, &source);
                if let Some(declaration_file_emitted) = request.declaration_file_emitted {
                    declaration_file_emitted(&path, &written);
                }
                files.push((path_of(path), Arc::new(written)));
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
    // `buildOrClean`: a project is built as soon as those that it references are.
    struct Builds {
        /// What can be built now.
        ready: BTreeSet<usize>,
        /// By project: how many of those that it waits for are not built. Besides those that it references, they are what
        /// `build` has returned.
        waits_for: Vec<usize>,
        /// By project: those that wait for it.
        waiting: Vec<Vec<usize>>,
        /// How many are built.
        built: usize,
        /// How many are being built.
        running: usize,
        /// How many are neither built nor being built.
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
    // Those that a thread is about to begin count too.
    let count_those_built_now = |state: &Builds| {
        if let Some(built_now) = &built_now {
            let projects = (state.running + state.ready.len()).min(at_once);
            built_now.store(projects, Ordering::Relaxed);
        }
    };
    count_those_built_now(&builds.lock());
    let one_is_built = bun_threading::Condvar::new();
    let reports: Vec<Guarded<Option<Report>>> = (0..count).map(|_| Guarded::new(None)).collect();
    let build_what_is_ready = || {
        let mut state = builds.lock();
        loop {
            // The first in build order.
            let Some(index) = state.ready.pop_first() else {
                if state.left == 0 {
                    return;
                }
                one_is_built.wait_guarded(&mut state);
                continue;
            };
            state.left -= 1;
            state.running += 1;
            let built_before = state.built;
            let is_last = state.left == 0 && state.running == 1;
            drop(state);
            let goes_on_elsewhere = |it: &Guarded<Option<Report>>| {
                (it.lock().as_ref()).is_some_and(|it| !it.scripts_elsewhere.is_empty())
            };
            let is_last = is_last && !reports.iter().any(goes_on_elsewhere);
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
            count_those_built_now(&state);
            one_is_built.notify_all();
        }
    };
    // A thread that loads and checks what it builds needs the stack of a worker: the calling thread has the stack it was
    // given, and only waits then.
    std::thread::scope(|scope| {
        let mut started = 0;
        for _ in usize::from(built_now.is_none())..at_once {
            // Without the thread, the others build its share.
            let builder = std::thread::Builder::new()
                .stack_size(STACK_OF_A_WORKER as usize)
                .spawn_scoped(scope, || {
                    // As a thread of the pool does when it starts: the parsers check the stack.
                    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Check"));
                    build_what_is_ready();
                });
            started += usize::from(builder.is_ok());
        }
        if built_now.is_none() || started == 0 {
            build_what_is_ready();
        }
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
    if ends_the_process && report.scripts_elsewhere.is_empty() {
        of_build.before_the_process_ends.set(Some(host));
    }
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
    // The path decides first. So the diagnostics of each file are sorted by themselves, and the files by their paths: of
    // tens of thousands of diagnostics most comparisons would be of two long paths that begin alike.
    let mut files: FxHashMap<&[u8], usize> = FxHashMap::default();
    let file_of = diagnostics.iter().map(|d| {
        let next = files.len();
        *files.entry(typescript_path(&d.path)).or_insert(next)
    });
    let file_of: Vec<usize> = file_of.collect();
    let mut by_file: Vec<Vec<Diagnostic>> = Vec::new();
    by_file.resize_with(files.len(), Vec::new);
    drop(files);
    for (d, file) in diagnostics.drain(..).zip(file_of) {
        by_file[file].push(d);
    }
    by_file.shared_sort_by(|a, b| typescript_path(&a[0].path).cmp(typescript_path(&b[0].path)));
    for mut of_file in by_file {
        of_file.shared_sort_by(compare_diagnostics);
        diagnostics.append(&mut of_file);
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

/// The path, the text and the line starts of the file that the last error given to `of_config_error`
/// is in: each of thousands of `paths` can have one.
type LastConfigFile = Option<(Vec<u8>, Cow<'static, [u8]>, Vec<u32>)>;

/// `error`, of the project whose configuration file is at `config_path`.
fn of_config_error(
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

/// Checks `project`, which is read through `host`. `report` holds the errors found before this
/// point, since `started`.
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

/// Whether what the project at `config` depends on is not installed: its `package.json` names packages, and none of
/// them is in a `node_modules`. Then the types of Node, of the test runner and so on are not there to be asked.
fn lacks_its_packages(host: &dyn Host, config: &[u8]) -> bool {
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

/// Whether the root file at `path` can add to the globals of its program: it is a declaration file; or a script, which
/// has neither `import` nor `export`, nor `require` in JavaScript; or it has `declare global` or a `/// <reference`. By
/// its text: one that is kept for nothing costs its parse. A script that has such a word in a comment is not seen, nor
/// a comment between `declare` and `global`. `imports`: called with each name of a package that it imports for its
/// effects, which can be to declare globals.
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

/// `check_project`. `named`: of all loaded files, only these files (sorted) and the files they
/// refer to are checked.
/// `is_owned_elsewhere`: of a file of a referenced project, which is loaded but not checked.
/// Both have a `tspath.Path` for each file.
fn check_named_files(
    host: &dyn Host,
    mut project: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<&[Vec<u8>]>,
    is_owned_elsewhere: Option<&dyn Fn(&[u8]) -> bool>,
    // Asked when the program is loaded: whether it is not to be checked.
    is_outdated: Option<&dyn Fn() -> bool>,
    run: Option<&Run<'_>>,
    in_room: Option<&Place<'_>>,
) -> Report {
    let _runs_here = in_room.and_then(|it| Some(RunsHere::new(it.room.shares?, it.threads - 1)));
    let threads = match request.threads {
        0 => usize::from(bun_core::get_thread_count()),
        n => n,
    };
    project.options.current_directory = match project.config_path.as_slice() {
        config_path
            if request.plan_options.current_directory_is_of_the_project
                && !config_path.is_empty() =>
        {
            dirname::<Posix>(config_path).to_vec()
        }
        _ => host::from_native(request.cwd),
    };
    let conditions = request.conditions.iter().map(|it| it.to_vec());
    project.options.custom_conditions.extend(conditions);
    let config_path = project.config_path.clone();
    let last = RefCell::new(None);
    let of_configuration =
        |error: &ConfigError| of_config_error(host, &config_path, error, &mut last.borrow_mut());
    // `GetDiagnosticsOfAnyProgram`: configuration file parsing errors are reported regardless of
    // any other diagnostics.
    let before_its_own = report.diagnostics.len();
    report.diagnostics.extend(
        project
            .errors
            .iter()
            .filter(|error| !error.is_about_options)
            .map(of_configuration),
    );
    let always_reported = report.diagnostics.len();
    let is_for_the_rest = request.plan_options.project_is_for_the_rest
        && request.project.is_some_and(|it| {
            let it = host::from_argument(&host::from_native(request.cwd), it);
            is_same_path(&it, &config_path, host.is_case_sensitive())
        });
    let refuses = request.plan_options.refuses_broken_configurations && !is_for_the_rest;
    let refused = |diagnostics: Vec<Diagnostic>| Refused {
        config_path: config_path.clone(),
        diagnostics,
        files: named.unwrap_or_default().to_vec(),
    };
    if refuses && always_reported > before_its_own {
        let diagnostics = report.diagnostics.split_off(before_its_own);
        report.refused.push(refused(diagnostics));
        return report;
    }
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
    if request.plan_options.prefers_the_library_of_the_project && !config_path.is_empty() {
        let installed = installed_typescript(host, &config_path);
        // By its real path: the packages of a workspace have links to one.
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

    if request.plan_options.only_the_globals {
        if lacks_its_packages(host, &config_path) {
            return report;
        }
        project.options.imports_of_sources_add_no_file = true;
        let is_module = project.options.module_detection == ModuleDetection::Force;
        let roots = &project.files;
        let is_kept: Vec<AtomicBool> = roots.iter().map(|_| AtomicBool::new(false)).collect();
        // `import "mocha";`: the name and the file.
        let for_their_effects: Guarded<Vec<(Vec<u8>, usize)>> = Guarded::new(Vec::new());
        host.parallel(roots.len(), &|at| {
            let imports = |name: &[u8]| for_their_effects.lock().push((name.to_vec(), at));
            let may = may_declare_a_global(host, &roots[at], is_module, &imports);
            is_kept[at].store(may, Ordering::Relaxed);
        });
        // One file for each name brings the package in: the first.
        let mut for_their_effects = std::mem::take(&mut *for_their_effects.lock());
        for_their_effects.shared_sort_unstable();
        for_their_effects.dedup_by(|a, b| a.0 == b.0);
        for (_, at) in for_their_effects {
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
    let written = std::mem::take(&mut project.raw_compiler_options);
    let is_true = |name: &[u8]| written.contains(&(name.to_vec(), Json::Bool(true)));
    project.options.drops_unreferenced = !request.retains_everything;
    project.options.keeps_comments = request.retains_everything
        || request.loaded.is_some()
        || request.checked.is_some()
        || request.after_file.is_some();
    let before = host.times();
    host.spent(Phase::Discover, started.elapsed());
    // Declared before everything that is allocated in it, so it is dropped last.
    let dropped = Dropped {
        session: Session::new(),
        before_the_process_ends: Cell::new(host.ends_the_process(run.is_some()).then_some(host)),
    };
    let session = &dropped.session;
    let files_are_found = |until_it_is_loaded: usize| {
        if let Some(place) = in_room {
            place.has_found_its_files(session.allocated_bytes() + until_it_is_loaded);
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
    if request.plan_options.only_the_globals {
        let files_of = |names| GlobalsOf {
            files: named.unwrap_or_default().to_vec(),
            names,
            checks_javascript: files.options.check_js == Some(true),
        };
        report.globals.extend(files.global_names().map(files_of));
        return report;
    }
    if refuses {
        let problems = files.program_problems();
        let problems = ConfigError::of_problems(host, session, &config_path, problems.iter());
        about_options.extend(problems.iter().map(of_configuration));
        if !about_options.is_empty() {
            report.refused.push(refused(about_options));
            return report;
        }
    }
    // In an arena, so that no destructor runs for them: the session frees what they refer to all
    // at once. `Program::release` frees the little that is on the regular heap.
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
            asked_for: named.len(),
            example: example.clone(),
            load_time: report.load_time,
        });
    }
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
    let problems = program.files.program_problems();
    let problems = ConfigError::of_problems(host, session, &config_path, problems.iter());
    about_options.extend(problems.iter().map(of_configuration));

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
                            && request.plan_options.after_file_is_for_checked_files
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
            let edges = match request.plan_options.checks_only_named {
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
    if let Some(only) = request.only {
        to_check.retain(|&f| strings::contains(program.files.modules[f.idx()].file_name(), only));
    }
    let lists_files_only = is_true(b"listFilesOnly") && request.stops_like_tsc;
    if lists_files_only {
        to_check.clear();
    }
    // Program order (`program.files`): an imported file precedes its importers. The position of a file in `to_check` is its index.
    let place = |f: FileId| program.files.rank_of_file(f);
    to_check.shared_sort_by_key(|&f| place(f));
    let size = |f: FileId| program.files.modules[f.idx()].hir.source_len;
    report.files_checked = to_check.len();
    // `SkipTypeChecking`: besides its syntax, such a file only has what `Emit` reports, which is
    // called after the semantic and the global diagnostics of the whole program are collected. So
    // these files come after the type-checked ones, or before them under `Options::emits_first`. If
    // there are no others, they go through the queue themselves.
    // A `Checker` is about 30 KB. Boxing keeps this function's stack frame small.
    let boxed_checker = || Box::new(program.checker());
    let checker = boxed_checker();
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
    let incomplete: Guarded<Vec<Incomplete>> = Guarded::new(Vec::new());
    let deepest_stack = AtomicUsize::new(0);
    let inference_walks = Guarded::new([0u64; INFERENCE_WALK_COUNTS.len()]);
    let members = Guarded::new([0u64; MEMBER_COUNTS.len()]);
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
        if errors.is_empty() || request.plan_options.reports_nothing_about_files {
            return;
        }
        let module = &program.files.modules[file.idx()];
        let text = &text_of(file)[..];
        let starts = compute_ecma_line_starts(text);
        let counted = Counted::default();
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
                let path = module.file_name();
                located_after(&counted, path, text, &starts, e.start, e.end, reported)
            })
            .collect();
        if let Some(progress) = request.progress {
            progress.errors.fetch_add(shown.len(), Ordering::Relaxed);
        }
        found.lock().extend(shown);
    };
    // What `Request::after_file` is called after.
    let wanted = match request.plan_options.reports_nothing_about_files {
        true => Requested::Types,
        false => Requested::All,
    };
    let new_checker = |expected: Requested| {
        let mut checker = boxed_checker();
        checker.set_requested(expected);
        checker.begin_stack_budget();
        checker
    };
    // The files that are checked but not yet rendered. The task of another file may still report
    // diagnostics in them.
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
        let mut checker = new_checker(expected);
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
        let walks = checker.inference_walk_counts();
        for (sum, more) in inference_walks.lock().iter_mut().zip(walks) {
            *sum += more;
        }
        for (sum, more) in members.lock().iter_mut().zip(checker.member_counts()) {
            *sum += more;
        }
        Outcome {
            checked,
            incomplete,
        }
    };
    let declaration_files: Guarded<Vec<(Vec<u8>, Vec<u8>)>> = Guarded::new(Vec::new());
    let accept = |outcome: Outcome| {
        // The diagnostics that were found are reported. Others may be missing, so the report lists
        // the file as incomplete.
        for file in outcome.incomplete {
            incomplete.lock().push(Incomplete {
                path: program.files.modules[file.idx()].file_name().to_vec(),
                is_nested_too_deeply: program.files.hir(file).ran_out_of_stack,
            });
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
    let cost_of = |file: FileId| {
        let (identifiers, type_nodes) = program.files.sizes[file.idx()];
        identifiers as usize + type_nodes as usize + 1
    };
    let costs: Vec<usize> = to_check.iter().map(|&file| cost_of(file)).collect();
    let size_of = |index: usize| costs[index];
    let threads = match in_room {
        Some(place) if place.is_for_one_thread => 1,
        _ => threads,
    };
    let rounds: Guarded<Vec<RoundReport>> = Guarded::new(Vec::new());
    // For every task of the round: wall time, the number of files, the index of the first file.
    let task_times: Guarded<Vec<(Duration, usize, usize)>> = Guarded::new(Vec::new());
    // The files of the tasks that were lost.
    let lost: Guarded<Vec<usize>> = Guarded::new(Vec::new());
    // Which files are checked for good, and how many from the first one on, in program order. The task that checks the
    // next one enters a ring where `tsc --singleThreaded` does: `Checker::set_first_in_order`.
    let checked_for_good = Guarded::new((vec![false; to_check.len()], 0usize));
    // How many files are checked for good.
    let files_done = AtomicUsize::new(0);
    /// What the driver remembers about the last time a file was checked.
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
        /// The file was already rechecked once because all earlier files were done.
        was_retried_as_first: bool,
        /// How many times the file was rechecked before the last round.
        rechecks: usize,
    }
    let visits = Guarded::new(vec![Visit::default(); to_check.len()]);
    let index_of_file: FxHashMap<FileId, usize> = (to_check
        .iter()
        .enumerate()
        .map(|(index, &file)| (file, index)))
    .collect();
    // A task that starts with a rechecked file gets a round number of its own, starting here, so task numbers stay unique.
    const AGAIN: usize = 2;
    /// What the tasks of a round add up to.
    #[derive(Default)]
    struct Sums {
        tasks: usize,
        logged: u64,
        stored: u64,
        waits: [Duration; 3],
        lost: Vec<(usize, &'static str)>,
    }
    // Every thread takes files from one queue until none is left. `files`: in program order.
    // `is_last_round`: one thread checks them all in that order, in one task, which is believed.
    //
    // No thread holds a file that it has not begun but for the rest of its run, so none is left with a long list when
    // the others are through: how long a file takes is known only afterwards.
    let run_tasks = |round: usize, files: &[usize], expected: Requested, is_last_round: bool| {
        let cost: usize = files.iter().map(|&file| size_of(file)).sum();
        // A checker is replaced by a new one after this much: what it holds for itself grows with every file.
        let task_cost = match is_last_round {
            true => usize::MAX,
            false => (cost / MIN_TASKS).max(1),
        };
        let workers = if is_last_round { 1 } else { threads };
        // The heavy files first, the largest first, so that no thread begins one when the others are nearly done. Then
        // the others in program order: neighbors use the same types. One thread takes them all in program order.
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
        // How many heavy files of `queue` are taken, how many light ones, and the cost of the rest.
        let left = Guarded::new((0usize, 0usize, cost));
        // The next run: consecutive files of `queue` for one thread. Threads that work far apart ask for different
        // types at any one time. A run is a share of what is left, so the runs get shorter toward the end. A heavy file is a
        // run by itself. `skips_heavy_files`: this worker takes light files first, so the first files of the program get
        // done and discarded files can be rechecked. See `checked_for_good`.
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
        // Returns the first file in program order that was discarded and is worth rechecking now: its commit was invalid,
        // a commit has resolved the cycle it was discarded for, or all earlier files are done, so its task will be trusted.
        //
        // The round ends: a file is rechecked early only if another file was checked for good since its last visit began.
        // That count only grows, and no further than the number of files. So it is greater at the start of each early
        // recheck of a file than at the start of the visit before, whatever that visit was discarded for.
        let take_file_to_recheck = || -> Option<usize> {
            let next = checked_for_good.lock().1;
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
                    && (visit.unresolved_cycle.is_empty() && visit.files_done < done
                        || file == next && !visit.was_retried_as_first)
            };
            let candidates = lost.iter().enumerate();
            let candidates = candidates.filter(|&(_, &file)| can_recheck(file));
            let (at, &file) = candidates.min_by_key(|&(_, &file)| file)?;
            visits[file].was_retried_as_first |= file == next;
            visits[file].rechecks += 1;
            lost.swap_remove(at);
            Some(file)
        };
        let is_read_afterwards = request.retains_everything
            || request.after_file.is_some()
                && !request.plan_options.after_file_is_for_checked_files;
        let sums: Guarded<Sums> = Guarded::new(Sums::default());
        let (started, busy) = (Instant::now(), AtomicU64::new(0));
        /// What a worker that has run out of files waits for.
        #[derive(Default)]
        struct Activity {
            /// How many workers are looking for a file or running a task.
            active: usize,
            /// Counts commits and discards. Each one can make a discarded file recheckable.
            changes: u64,
        }
        let activity = Guarded::new(Activity::default());
        let activity_has_changed = bun_threading::Condvar::new();
        let note_change = || {
            activity.lock().changes += 1;
            activity_has_changed.notify_all();
        };
        // One task, which begins with the file `first` and goes on with what `next` returns. Returns the file that the
        // next task of the thread begins with.
        let run_task = |first: usize, next: &mut dyn FnMut() -> Option<usize>| -> Option<usize> {
            let began = Instant::now();
            let mut checker = new_checker(expected);
            // The index of a task is that of its first file, which no other task of the round has.
            let round = match visits.lock()[first].rechecks {
                rechecks if rechecks != 0 && !is_last_round => AGAIN + rechecks,
                _ => round,
            };
            checker.begin_task(round as u32, first as u32);
            checker.see_commits(is_last_round);
            let mut trees_to_free = Vec::new();
            let (mut done, mut spent, mut index) = (0, 0, first);
            let upcoming = loop {
                let file = to_check[index];
                {
                    let visit = &mut visits.lock()[index];
                    visit.commits_compared = program.last_commit();
                    visit.files_done = files_done.load(Ordering::Acquire);
                }
                {
                    let (is_checked, next) = &*checked_for_good.lock();
                    let is_done = |before: usize| is_checked[before];
                    // The files in the same import cycle.
                    let components = &program.files.components;
                    let component = components.of_file.get(file.idx());
                    let component = component.and_then(|&at| components.all.get(at as usize));
                    let around = component.map_or(&[][..], |it| it.files).iter();
                    let around = around.filter_map(|it| index_of_file.get(it).copied());
                    checker.set_first_in_order(
                        (*next..index).all(is_done),
                        around.take_while(|&it| it < index).all(is_done),
                    );
                }
                let checked = checker.check_file(file);
                if let Some(after_file) = request.after_file
                    && expected == wanted
                    && !checker.is_lost()
                {
                    after_file(&mut checker, file);
                }
                let incomplete = checker.take_ran_out_of_stack().then_some(file);
                if let Some(progress) = request.progress {
                    progress.checked.fetch_add(1, Ordering::Relaxed);
                    let bytes = bytes_of(index);
                    progress.bytes_checked.fetch_add(bytes, Ordering::Relaxed);
                }
                (done, spent) = (done + 1, spent + size_of(index));
                let upcoming = next();
                // A task keeps what it evaluated about other files, and a file's own check must not find what a later
                // file's check evaluated. So a task only moves forward in program order.
                let is_last = upcoming.is_none_or(|it| it < index) || spent >= task_cost;
                // Nothing waits for what the tasks that end last have found out.
                let is_read = upcoming.is_some() || is_read_afterwards || !lost.lock().is_empty();
                if !checker.commit_after_file(is_last, is_read) {
                    if let Some(progress) = request.progress {
                        progress.checked.fetch_sub(1, Ordering::Relaxed);
                        let bytes = bytes_of(index);
                        progress.bytes_checked.fetch_sub(bytes, Ordering::Relaxed);
                    }
                    {
                        let visit = &mut visits.lock()[index];
                        visit.can_recheck_early = checker.can_recheck_early();
                        visit.unresolved_cycle = checker.take_unresolved_cycle();
                    }
                    lost.lock().push(index);
                    note_change();
                    break upcoming;
                }
                {
                    let (is_checked, next) = &mut *checked_for_good.lock();
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
                note_change();
                match upcoming {
                    Some(following) if !is_last => index = following,
                    _ => break upcoming,
                }
            };
            deepest_stack.fetch_max(checker.deepest_stack(), Ordering::Relaxed);
            let walks = checker.inference_walk_counts();
            for (sum, more) in inference_walks.lock().iter_mut().zip(walks) {
                *sum += more;
            }
            for (sum, more) in members.lock().iter_mut().zip(checker.member_counts()) {
                *sum += more;
            }
            let ended = checker.end_task_after_commits();
            {
                let mut sums = sums.lock();
                sums.tasks += 1;
                sums.logged += ended.logged;
                sums.stored += ended.stored;
                for (sum, more) in sums.waits.iter_mut().zip(ended.waits) {
                    *sum += more;
                }
                (sums.lost).extend(ended.lost_because_of.map(|why| (index, why)));
            }
            // It holds references into the HIR of files.
            drop(checker);
            free_trees(trees_to_free);
            let elapsed = began.elapsed();
            busy.fetch_add(elapsed.as_nanos() as u64, Ordering::Relaxed);
            task_times.lock().push((elapsed, done, first));
            upcoming
        };
        let first_files_worker = AtomicUsize::new(usize::MAX);
        let workers_started = AtomicUsize::new(0);
        // Returns a closure that runs one task per call on the current thread. It returns false once this thread has nothing
        // left to do in this round.
        //
        // A worker that finds no file waits as long as a file is discarded and another worker is active: that worker's next
        // commit can make the file recheckable. Every wait ends. An active worker either finishes a file, which counts as a
        // change, or finds nothing and stops being active. Both wake every waiting worker, and one that wakes up to no
        // change and no active worker returns. A waiting worker holds no lock and no file.
        let shared = (&take_file_to_recheck, &take_run, &run_task, &queue, &lost);
        let (activity, activity_has_changed) = (&activity, &activity_has_changed);
        let worker = || {
            let (take_file_to_recheck, take_run, run_task, queue, lost) = shared;
            let (first_files_worker, id) = (
                &first_files_worker,
                workers_started.fetch_add(1, Ordering::Relaxed),
            );
            let (mut run, mut first) = (0..0, None);
            move || {
                let mut next = || {
                    if let Some(file) = take_file_to_recheck() {
                        return Some(file);
                    }
                    if run.is_empty() {
                        // The first worker that sees a discarded file moves to the first unchecked files, and stays there.
                        let is_needed = !lost.lock().is_empty();
                        let is_mine = is_needed
                            && first_files_worker
                                .compare_exchange(
                                    usize::MAX,
                                    id,
                                    Ordering::Relaxed,
                                    Ordering::Relaxed,
                                )
                                .is_ok();
                        run = take_run(is_mine || first_files_worker.load(Ordering::Relaxed) == id);
                    }
                    run.next().map(|at| queue[at])
                };
                let seen = {
                    let mut activity = activity.lock();
                    activity.active += 1;
                    activity.changes
                };
                // A task asks for its next file before it commits the last one, and that commit can make a discarded file
                // the next.
                let file = first.take().or_else(&mut next);
                first = file.and_then(|file| run_task(file, &mut next));
                let mut activity = activity.lock();
                activity.active -= 1;
                activity_has_changed.notify_all();
                while file.is_none()
                    && activity.changes == seen
                    && activity.active != 0
                    && !lost.lock().is_empty()
                {
                    activity_has_changed.wait_guarded(&mut activity);
                }
                file.is_some() || activity.changes != seen
            }
        };
        let work = || {
            let mut run_a_task = worker();
            while run_a_task() {}
        };
        match host.helpers_now() {
            Some(_) if workers > 1 => {
                run_with_current_helpers(host, 0, &mut worker(), &work);
            }
            _ => host.parallel(workers, &|_| work()),
        }
        let elapsed = started.elapsed();
        let sums = std::mem::take(&mut *sums.lock());
        let mut slowest = std::mem::take(&mut *task_times.lock());
        slowest.shared_sort_by_key(|&(elapsed, _, file)| (Reverse(elapsed), file));
        slowest.truncate(5);
        let path_of = |file: usize| {
            program.files.modules[to_check[file].idx()]
                .file_name()
                .to_vec()
        };
        rounds.lock().push(RoundReport {
            slowest_tasks: (slowest.into_iter())
                .map(|(elapsed, files, file)| (elapsed, files, path_of(file)))
                .collect(),
            tasks: sums.tasks,
            files: files.len(),
            elapsed,
            waits: sums.waits,
            lost: (sums.lost.into_iter())
                .map(|(file, why)| (path_of(file), why))
                .collect(),
            idle: (elapsed * threads as u32)
                .saturating_sub(Duration::from_nanos(busy.into_inner())),
            logged: sums.logged,
            stored: sums.stored,
        });
    };
    let run_without_steps = |expected: Requested| {
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
    // `GetDiagnosticsOfAnyProgram`: TypeScript's command line proceeds to the next kind of error
    // only if there is none of the previous kind. A file that does not parse, or is checked under
    // inconsistent options, produces errors that are not worth reading.
    let stops = request.stops_like_tsc;
    // `type_checked`: check the files that are type checked, or else the others.
    let check_files = |expected: Requested, type_checked: bool| {
        if type_checked == is_any_type_checked {
            run_without_steps(expected);
        }
        if !type_checked {
            let tasks = match threads == 1 || host.is_of_one_thread() {
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
                accept(check_chunk(&suspects[i..=i], Requested::Syntactic));
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
            check_files(wanted, type_checked);
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
        if let Some(after_file) = request.after_file
            && !request.plan_options.after_file_is_for_checked_files
        {
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
                let mut checker = boxed_checker();
                checker.begin_stack_budget();
                after_file(&mut checker, file);
            }
        }
    }
    report.deepest_stack = deepest_stack.into_inner();
    report.inference_walks = *inference_walks.lock();
    report.members = *members.lock();
    report.rounds = std::mem::take(&mut *rounds.lock());
    report.incomplete = std::mem::take(&mut *incomplete.lock());
    report.incomplete.shared_sort();
    report.incomplete.dedup();
    let unreadable = host.take_unreadable();
    let cannot_read = (unreadable.iter()).map(|path| global(5083, &[displayed_path(path)]));
    report.diagnostics.extend(cannot_read);
    report.unreadable.extend(unreadable);
    sort_and_deduplicate(&mut report.diagnostics);
    report.check_time = checking.elapsed();
    report.declaration_files = std::mem::take(&mut *declaration_files.lock());
    if let Some(checked) = request.checked {
        checked(program);
    }
    if let Some(place) = in_room {
        place.has_taken(session.allocated_bytes());
    }
    root.release();
    report
}
