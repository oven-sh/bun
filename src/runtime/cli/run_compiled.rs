use core::sync::atomic::{AtomicBool, Ordering};
use std::collections::BTreeSet;
use std::sync::{Arc, OnceLock};

use bstr::BStr;
use bun_bundler::bundle_v2::FileMap;
use bun_core::{Global, Output, ZBox, env_var};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::aot_options::ReadListener;
use bun_options_types::context::{HotReload, TestGlobals};
use bun_options_types::schema::api::DotEnvBehavior;
use bun_standalone_graph::Graph;
use bun_sys::{Fd, File, Maybe, O};
use bun_threading::Guarded;
use bun_watcher::{ChangedFilePath, WatchEvent, WatchList, Watcher, WatcherContext};

use super::compile_command::{
    CompileFailure, CompileProduct, RequestOrigin, compile_from_context, exit_with_failure,
    print_failure, print_log,
};
use crate::cli::command::{Context, ContextData};

static IS_FROM_DESCRIPTOR: AtomicBool = AtomicBool::new(false);
static GRAPH_DESCRIPTOR: OnceLock<Fd> = OnceLock::new();
static IS_CHECKED: AtomicBool = AtomicBool::new(false);
static FILES_OF_CHECK: OnceLock<Vec<Box<[u8]>>> = OnceLock::new();
static CLEARS_TERMINAL: AtomicBool = AtomicBool::new(false);
static RUNNING_TEST_FILE: Guarded<Vec<u8>> = Guarded::new(Vec::new());
static REFUSED_CHANGES: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
static FILES_RUN_FROM_SOURCE: Guarded<BTreeSet<Vec<u8>>> = Guarded::new(BTreeSet::new());
static FILES_THAT_KEPT_THEIR_RUN: Guarded<BTreeSet<Vec<u8>>> = Guarded::new(BTreeSet::new());
/// The newest line of `REFUSED_CHANGES` that the running test file has made, without its end. It is kept also where the list is full or has the line.
static NEWEST_REFUSAL_OF_RUNNING_TEST_FILE: Guarded<Vec<u8>> = Guarded::new(Vec::new());
const MAX_LISTED_REFUSED_CHANGES: usize = 100;
static CRASH_REPORT: OnceLock<&'static [u8]> = OnceLock::new();
/// The entry points that stand in for what the runner does and no file of the run spells.
static STAND_IN: Guarded<Option<&'static FileMap>> = Guarded::new(None);

pub(crate) enum NonFileTarget<'a> {
    PackageScript(&'a [u8]),
    SeveralProcesses,
    Executable(&'a [u8]),
    ShellScript(&'a [u8]),
}

#[inline]
pub(crate) fn is_requested(ctx: &ContextData) -> bool {
    !runs_compiled_code()
        && !ctx.bundler_options.compile
        && ctx
            .bundler_options
            .aot
            .as_ref()
            .is_some_and(|aot| aot.runs_in_place)
}

#[inline]
pub(crate) fn reject(ctx: &ContextData, target: NonFileTarget<'_>) {
    if is_requested(ctx) {
        exit_non_file_target(target);
    }
}

#[cold]
#[inline(never)]
#[allow(clippy::needless_pass_by_value)] // the last thing the process does
fn exit_non_file_target(target: NonFileTarget<'_>) -> ! {
    match target {
        NonFileTarget::PackageScript(name) => Output::err_generic(
            "--aot does not apply to a package.json script ({}). It compiles a file: put --aot on the bun command inside the script",
            (BStr::new(name),),
        ),
        NonFileTarget::SeveralProcesses => Output::err_generic(
            "--aot does not apply to the processes that --filter, --workspaces, --parallel and --sequential start. Put --aot on the bun command inside the scripts",
            (),
        ),
        NonFileTarget::Executable(path) => Output::err_generic(
            "--aot does not apply to an executable ({}). It compiles a JavaScript or TypeScript file",
            (BStr::new(path),),
        ),
        NonFileTarget::ShellScript(path) => Output::err_generic(
            "--aot does not apply to a shell script ({}). It compiles a JavaScript or TypeScript file",
            (BStr::new(path),),
        ),
    }
    Global::exit(1)
}

/// The build reads the entry point at `path` from memory. A file on disk would be shared by every run in the folder.
pub(crate) fn set_stand_in(path: &[u8], text: &[u8]) {
    // The word `TestRunShowsStandIn:1`, for tests that read it.
    if number_behind_word(b"TestRunShowsStandIn:") == Some(1) {
        bun_core::print_errorln!(
            "AOT stand-in | {}\n{}AOT stand-in ends",
            BStr::new(path),
            BStr::new(text)
        );
    }
    let key = key_of_stand_in(path);
    let mut files = FileMap::default();
    if let Some(earlier) = *STAND_IN.lock() {
        for (key, text) in earlier.map.iter() {
            bun_core::handle_oom(files.map.put(key, text.clone()));
        }
    }
    bun_core::handle_oom(files.map.put(&key, Box::from(text)));
    // It lives as long as the build, which is the last thing the process does.
    *STAND_IN.lock() = Some(Box::leak(Box::new(files)));
}

fn key_of_stand_in(path: &[u8]) -> Vec<u8> {
    let mut key = path.to_vec();
    if cfg!(windows) {
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut key);
    }
    key
}

// No file of the run spells what the runner does for `--globals=vitest`: `Jest::define_vitest_globals()` stores the names on `globalThis` before any file runs. This file
// stands in for that, so that a name which nothing else stores isn't taken for absent.
fn make_stand_in_for_globals_of_vitest() -> Box<[u8]> {
    use bun_js_parser::Jest;
    let mut text = b"const value = process.argv.at(-1)!;\nif (value === \"\\0never\") {\n".to_vec();
    for name in (Jest::GLOBALS.iter()).filter(|name| !Jest::is_of_bun_only(name)) {
        text.extend_from_slice(b"  (globalThis as any).");
        text.extend_from_slice(name.as_bytes());
        text.extend_from_slice(b" = JSON.parse(value);\n");
    }
    text.extend_from_slice(b"}\n");
    // The name of the module. No file is there.
    let path = bun_paths::resolve_path::join_abs_string::<bun_paths::platform::Auto>(
        bun_resolver::fs::FileSystem::get().top_level_dir(),
        &[b"node_modules/.cache/bun-test-globals-of-vitest.ts"],
    )
    .to_vec();
    set_stand_in(&path, &text);
    path.into_boxed_slice()
}

pub(crate) fn files_in_memory() -> Option<&'static FileMap> {
    *STAND_IN.lock()
}

#[cold]
#[inline(never)]
pub(crate) fn start(ctx: Context<'_>, entry_points: Vec<Box<[u8]>>, test_file_count: usize) -> ! {
    let typed: Vec<&'static [u8]> = bun_core::argv()
        .into_iter()
        .skip(1 + bun_core::bun_options_argc())
        .collect();
    let own_count = typed.len().saturating_sub(ctx.passthrough.len());
    let has_globals_of_vitest = ctx.test_options.globals == Some(TestGlobals::Vitest);
    let shares_process = ctx.test_options.isolate_modules;
    if let Some(aot) = ctx.bundler_options.aot.as_mut() {
        aot.has_globals_of_vitest = has_globals_of_vitest;
        if shares_process {
            let replaced = &mut aot.replaced_by_tests.builtins;
            replaced.extend(bun_aot::builtins::lists_laid_anew_between_test_files());
            replaced.sort_unstable();
            replaced.dedup();
        }
    }
    let checks_only = ctx
        .bundler_options
        .aot
        .as_ref()
        .is_some_and(|aot| aot.checks_only);

    let watched =
        (ctx.debug.hot_reload == HotReload::Watch).then(|| WatchedFiles::start(&entry_points));
    if let (Some(watched), Some(aot)) = (watched, ctx.bundler_options.aot.as_mut()) {
        aot.before_read = Some(ReadListener(Arc::new(move |path: &[u8]| {
            watched.add_read_file(path)
        })));
    }

    let mut said_before_the_build = bun_ast::Log::init();
    // SAFETY: nothing else borrows the log in front of the build.
    unsafe { ctx.log_mut() }.append_to(&mut said_before_the_build);

    let mut entry_points = entry_points;
    if has_globals_of_vitest {
        entry_points.push(make_stand_in_for_globals_of_vitest());
    }
    ctx.args.entry_points = entry_points;
    ctx.bundler_options.compile = true;
    ctx.bundler_options.inline_entrypoint_import_meta_main = true;
    ctx.bundler_options.outfile = Box::from(&b"program"[..]);
    // `bun run` and `bun test` put no value in place of `process.env.NODE_ENV`: the program may store another.
    ctx.bundler_options.env_behavior = DotEnvBehavior::LoadAllWithoutInlining;

    let product = match checks_only {
        true => CompileProduct::ReportsOnly,
        #[cfg(unix)]
        false => CompileProduct::UnnamedFile,
        #[cfg(not(unix))]
        false => CompileProduct::GraphBytes,
    };
    let outcome = match compile_from_context(&mut *ctx, product) {
        Err(error) => {
            print_log(&said_before_the_build);
            print_log(ctx.log_ref());
            Output::err_generic("{}", (BStr::new(error.name()),));
            exit_or_wait_for_change(watched)
        }
        Ok(Err(failure)) => {
            // SAFETY: nothing else borrows the log behind a build.
            let log = unsafe { ctx.log_mut() };
            if !log.has_errors() {
                log.add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("the build failed"));
            }
            let target = &ctx.bundler_options.compile_target;
            print_log(&said_before_the_build);
            print_failure(ctx.log_ref(), RequestOrigin::BuildFlag, target, &failure);
            exit_or_wait_for_change(watched)
        }
        Ok(Ok(outcome)) => outcome,
    };
    // A program forked this process, and what goes to its stderr is the program's to read. One that reads nothing would leave it waiting in write().
    if env_var::NODE_CHANNEL_FD.get().is_some() {
        // SAFETY: nothing else borrows the log behind a build.
        let messages = &mut unsafe { ctx.log_mut() }.msgs;
        messages.retain(|message| message.kind == bun_ast::Kind::Err);
    }
    print_log(ctx.log_ref());
    // A run from the sources has no image to say which names the files add to built-in objects.
    #[cfg(unix)]
    let program = outcome.unnamed_file.map(Program::Written);
    #[cfg(not(unix))]
    let program = outcome.graph_bytes.as_deref().map(Program::Bytes);
    let names_added: &[(u32, Vec<u8>)] = match program {
        Some(_) => &[],
        None => &outcome.names_added_to_builtins,
    };
    let check_result = (watched.is_some() || !names_added.is_empty())
        .then(|| write_check_result(watched, names_added));
    let handover = match program {
        Some(_) => Handover {
            flag: GRAPH_FLAG,
            program,
            bytes_after: check_result.as_deref().unwrap_or_default(),
        },
        None => Handover {
            flag: CHECKED_FLAG,
            program: check_result.as_deref().map(Program::Bytes),
            bytes_after: &[],
        },
    };
    log_what_is_handed_over(ctx, test_file_count, handover);
    hand_over(&typed, own_count, handover, ctx.original_cwd.as_deref())
}

/// With a word of `BUN_DEBUG_TEST_AOT_WORDS` that begins with `TestRun`, or with `BUN_JSC_logAOTPhaseTimes`: what the build of a test
/// run hands over, in one line. The hash tells two programs apart.
fn log_what_is_handed_over(ctx: &ContextData, test_file_count: usize, handover: Handover<'_>) {
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty();
    let is_asked = words.is_some_and(|words| {
        bun_core::strings::split(words, b",").any(|word| word.starts_with(b"TestRun"))
    });
    let aot = ctx.bundler_options.aot.as_ref();
    if !(is_asked || env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true))
        || !aot.is_some_and(|aot| aot.runs_tests)
    {
        return;
    }
    if handover.flag == GRAPH_FLAG {
        bun_core::print_errorln!(
            "AOT test run | one program | test files {}",
            test_file_count
        );
    }
    match handover.flag {
        GRAPH_FLAG => {
            let (length, hash) = handover.program.map_or((0, 0), Program::length_and_hash);
            bun_core::print_errorln!(
                "AOT test run | the program | test files compiled {} | {} bytes | hash {:016x}",
                test_file_count,
                length,
                hash,
            )
        }
        _ => bun_core::print_errorln!("AOT test run | no program"),
    }
}

/// With `BUN_JSC_logAOTPhaseTimes`: how long after the process began it has come this far. The stages of the compiler time
/// themselves. This is for what lies in front of the build, and behind it up to the first result.
pub(crate) fn log_step_of_test_run(step: core::fmt::Arguments<'_>) {
    if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
        let elapsed = bun_core::time::nano_timestamp() - bun_core::start_time();
        bun_core::print_errorln!(
            "AOT test run step | {} | at {} ms",
            step,
            elapsed / i128::from(bun_core::time::NS_PER_MS),
        );
    }
}

/// The same, the first time that the run reaches the step.
pub(crate) fn log_first_time_in_test_run(step: &'static str) {
    static REACHED: Guarded<Vec<&'static str>> = Guarded::new(Vec::new());
    if env_var::BUN_JSC_logAOTPhaseTimes.get() != Some(true) {
        return;
    }
    let mut reached = REACHED.lock();
    if reached.contains(&step) {
        return;
    }
    reached.push(step);
    drop(reached);
    log_step_of_test_run(format_args!("{step}"));
}

/// Resetting the kernel's peak RSS loses it, so record it here first. Returns the peak so far.
#[cfg(unix)]
pub(crate) fn record_peak_rss_kb(kilobytes: u64) -> u64 {
    use core::sync::atomic::AtomicU64;
    static PEAK_BEFORE_RESETS: AtomicU64 = AtomicU64::new(0);
    PEAK_BEFORE_RESETS
        .fetch_max(kilobytes, Ordering::Relaxed)
        .max(kilobytes)
}

/// `exited_mb` is what the kernel reports of exited workers. It folds in the processes that a worker waited for, and a spawned
/// process starts from the peak of its parent, so it says something about a worker only above the peak of this process.
pub(crate) fn peak_of_this_process_mb() -> u32 {
    #[cfg(unix)]
    let before_resets = record_peak_rss_kb(0) / 1024;
    #[cfg(not(unix))]
    let before_resets = 0;
    let peak = (Bun__AOT__peakResidentMegabytesOfProcess() as u64).max(before_resets);
    u32::try_from(peak).unwrap_or(u32::MAX)
}

pub(crate) fn logs_accounts() -> bool {
    env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true)
}

pub(crate) fn log_largest_worker(reported_mb: u32, exited_mb: u32) {
    if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
        let is_inherited = exited_mb as usize <= Bun__AOT__peakResidentMegabytesOfProcess();
        let peak_mb = reported_mb.max(if is_inherited { 0 } else { exited_mb });
        if peak_mb > 0 {
            bun_core::print_errorln!(
                "AOT test run | largest worker or child of a worker | peak {} MB",
                peak_mb
            );
        }
    }
}

/// With `BUN_JSC_logAOTPhaseTimes`: what a process of a test run has taken by its end, in one line, so that the lines of a run add
/// up to all of its processor time. Called on the main thread: what the process took less what that thread took is the other
/// threads'. "Waited for" is what its children took, and theirs, as far as each was waited for: for the coordinator that is every
/// worker.
pub(crate) fn log_account_of_process(who: core::fmt::Arguments<'_>) {
    #[cfg(unix)]
    if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
        let usage_of = |who: libc::c_int| {
            let mut usage = core::mem::MaybeUninit::<libc::rusage>::zeroed();
            // SAFETY: all zeroes is a valid `rusage`, and the kernel writes one.
            unsafe {
                libc::getrusage(who, usage.as_mut_ptr());
                usage.assume_init()
            }
        };
        let (own, children) = (usage_of(libc::RUSAGE_SELF), usage_of(libc::RUSAGE_CHILDREN));
        let mut main_thread = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: the kernel writes the time into it.
        unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &raw mut main_thread) };
        let ms = |time: libc::timeval| time.tv_sec as i64 * 1000 + time.tv_usec as i64 / 1000;
        bun_core::print_errorln!(
            "AOT account | {} | wall {} ms | user {} ms | system {} ms | main thread {} ms | waited for: user {} ms | system {} ms | minor faults {} | major faults {} | switches of its own will {} | against it {} | peak {} MB",
            who,
            (bun_core::time::nano_timestamp() - bun_core::start_time()) / 1_000_000,
            ms(own.ru_utime),
            ms(own.ru_stime),
            main_thread.tv_sec as i64 * 1000 + main_thread.tv_nsec as i64 / 1_000_000,
            ms(children.ru_utime),
            ms(children.ru_stime),
            own.ru_minflt,
            own.ru_majflt,
            own.ru_nvcsw,
            own.ru_nivcsw,
            peak_of_this_process_mb(),
        );
        Output::flush();
    }
    #[cfg(not(unix))]
    let _ = who;
}

fn number_behind_word(prefix: &[u8]) -> Option<u32> {
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty()?;
    let mut words = bun_core::strings::split(words, b",");
    let digits = words.find_map(|word| word.strip_prefix(prefix))?;
    bun_core::fmt::parse_int::<u32>(digits, 10).ok()
}

fn hand_over(
    typed: &[&'static [u8]],
    own_count: usize,
    handover: Handover<'_>,
    original_cwd: Option<&[u8]>,
) -> ! {
    // `bun run`: the one loader of the process has read the files, for the run command where it looked for a script, else for the build.
    if let Some(loader) =
        bun_dotenv::instance().filter(|_| !HAS_HANDED_ON_ENVIRONMENT.load(Ordering::Relaxed))
    {
        // SAFETY: this is the main thread, the only one that has the loader.
        hand_on_environment(unsafe { &(*loader).map });
    }
    start_second_process(typed, own_count, handover, original_cwd)
}

struct WatchedFiles {
    watcher: Guarded<SharedWatcher>,
    working_directory: Vec<u8>,
    paths: Guarded<Vec<Vec<u8>>>,
}

struct SharedWatcher(*mut Watcher);
// SAFETY: the watcher is never freed, and one thread at a time has the pointer.
unsafe impl Send for SharedWatcher {}

struct RestartOnChange;

impl WatcherContext for RestartOnChange {
    fn on_file_update(&mut self, events: &mut [WatchEvent], _: &[ChangedFilePath], _: &WatchList) {
        if events.is_empty() {
            return;
        }
        Output::flush();
        bun_removable_features::removable_body!(HotReload, Abort, {
            bun_core::reload_process(CLEARS_TERMINAL.load(Ordering::Relaxed), false);
        });
    }

    fn on_error(&mut self, error: bun_sys::Error) {
        Output::err_generic(
            "--watch could not watch the files of the program: {}",
            (&error,),
        );
        Global::exit(1)
    }
}

impl WatchedFiles {
    #[cold]
    #[inline(never)]
    fn start(entry_points: &[Box<[u8]>]) -> &'static WatchedFiles {
        decide_whether_to_clear_terminal();
        let working_directory = super::check_command::working_directory();
        let directory: &'static [u8] = Box::leak(working_directory.clone().into_boxed_slice());
        let context = Box::leak(Box::new(RestartOnChange));
        let started = Watcher::init(context, directory)
            .map(Box::leak)
            .and_then(|watcher| {
                watcher.start()?;
                Ok(watcher)
            });
        let watcher = match started {
            Ok(watcher) => watcher,
            Err(error) => {
                Output::err_generic("--watch could not start: {}", (error.name(),));
                Global::exit(1)
            }
        };
        let watched: &'static WatchedFiles = Box::leak(Box::new(WatchedFiles {
            watcher: Guarded::new(SharedWatcher(watcher)),
            working_directory,
            paths: Guarded::new(Vec::new()),
        }));
        // They are not read if the options are wrong.
        let in_memory = files_in_memory();
        for entry_point in entry_points {
            if !in_memory.is_some_and(|files| files.contains(entry_point)) {
                watched.add(entry_point);
            }
        }
        watched
    }

    fn add_read_file(&self, path: &[u8]) {
        if !bun_core::strings::contains(path, b"/node_modules/") {
            self.add(bun_sema_driver::host::to_native(path));
        }
    }

    fn add(&self, path: &[u8]) {
        use bun_paths::{platform::Auto, resolve_path::join_abs_string};
        let path = join_abs_string::<Auto>(&self.working_directory, &[path]);
        let shared = self.watcher.lock();
        let watcher = shared.0;
        // SAFETY: see `SharedWatcher`.
        let _ = unsafe { (*watcher).add_file_by_path_slow(path) };
        drop(shared);
        self.paths.lock().push(path.to_vec());
    }
}

fn decide_whether_to_clear_terminal() {
    let keeps_by_default = !Output::enable_ansi_colors_stdout();
    let keeps = match bun_dotenv::instance() {
        // SAFETY: this is the main thread, the only one that has the loader.
        Some(loader) => unsafe { (*loader).has_set_no_clear_terminal_on_reload(keeps_by_default) },
        None => {
            (bun_dotenv::HAS_NO_CLEAR_SCREEN_CLI_FLAG.get().copied()).unwrap_or(keeps_by_default)
        }
    };
    CLEARS_TERMINAL.store(!keeps, Ordering::Relaxed);
}

fn exit_or_wait_for_change(watched: Option<&'static WatchedFiles>) -> ! {
    if watched.is_none() {
        Global::exit(1)
    }
    decide_whether_to_clear_terminal();
    Output::flush();
    loop {
        std::thread::park();
    }
}

/// The files that the build has read, each with a zero byte behind it, and one more zero byte. Then the names: the holder and the
/// length of the name, four bytes each, and the name, which may hold any byte.
fn write_check_result(watched: Option<&WatchedFiles>, names_added: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let mut paths = watched.map_or_else(Vec::new, |watched| {
        core::mem::take(&mut *watched.paths.lock())
    });
    paths.sort_unstable();
    paths.dedup();
    let mut result = Vec::new();
    for path in paths {
        result.extend_from_slice(&path);
        result.push(0);
    }
    result.push(0);
    for (holder, name) in names_added {
        result.extend_from_slice(&holder.to_ne_bytes());
        result.extend_from_slice(&(name.len() as u32).to_ne_bytes());
        result.extend_from_slice(name);
    }
    result
}

/// `CompileProduct::UnnamedFile`
#[cfg(unix)]
#[derive(Copy, Clone)]
pub(crate) struct WrittenProgram {
    descriptor: Fd,
    pub(crate) length: usize,
}

#[derive(Copy, Clone)]
enum Program<'a> {
    Bytes(&'a [u8]),
    #[cfg(unix)]
    Written(WrittenProgram),
}

impl Program<'_> {
    fn length_and_hash(self) -> (usize, u64) {
        match self {
            Program::Bytes(bytes) => (bytes.len(), bun_wyhash::hash(bytes)),
            #[cfg(unix)]
            Program::Written(WrittenProgram { descriptor, length }) => {
                let (access, flags) = (libc::PROT_READ, libc::MAP_SHARED);
                let mapped =
                    bun_sys::mmap(core::ptr::null_mut(), length, access, flags, descriptor, 0);
                let hash = mapped.map_or(0, |start| {
                    // SAFETY: the mapping has `length` bytes, and nothing writes to the file until it is unmapped.
                    let hash =
                        bun_wyhash::hash(unsafe { core::slice::from_raw_parts(start, length) });
                    let _ = bun_sys::munmap(start, length);
                    hash
                });
                (length, hash)
            }
        }
    }
}

#[derive(Copy, Clone)]
struct Handover<'a> {
    flag: &'static [u8],
    program: Option<Program<'a>>,
    /// The check result after a graph.
    bytes_after: &'a [u8],
}

const GRAPH_FLAG: &[u8] = b"--aot-graph-fd=";
const CHECKED_FLAG: &[u8] = b"--aot-checked=";
const NO_DESCRIPTOR: &[u8] = b"-";

#[cold]
#[inline(never)]
pub(crate) fn print_failure_and_exit(ctx: &ContextData, failure: &CompileFailure) -> ! {
    exit_with_failure(
        ctx.log_ref(),
        RequestOrigin::BuildFlag,
        &ctx.bundler_options.compile_target,
        failure,
    )
}

pub(crate) fn temporary_path(directory: &[u8]) -> ZBox {
    let mut name_buffer = [0u8; 64];
    let name = bun_paths::fs::FileSystem::tmpname(
        b"bun-program",
        &mut name_buffer,
        bun_core::fast_random(),
    )
    .expect("64 bytes hold a temporary name");
    ZBox::from_bytes([directory, bun_paths::SEP_STR.as_bytes(), name.as_bytes()].concat())
}

#[cfg(unix)]
fn create_deleted_file(directory: &[u8]) -> Maybe<Fd> {
    let path = temporary_path(directory);
    let file = File::from_fd(bun_sys::openat(
        Fd::cwd(),
        &path,
        O::RDWR | O::CREAT | O::EXCL | O::CLOEXEC,
        0o700,
    )?);
    bun_sys::unlinkat(Fd::cwd(), &path)?;
    Ok(file.into_raw())
}

/// Where the compiled program waits for the process that runs it, best first.
#[cfg(unix)]
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum ProgramFile {
    Memfd,
    /// Not on macOS, which maps shared memory neither executable nor private.
    SharedMemory,
    Deleted,
}

/// `/dev/shm` is mounted `noexec` in most containers, and the engine maps the code from the file.
#[cfg(target_os = "linux")]
fn can_map_code(descriptor: Fd) -> bool {
    let size = bun_sys::page_size();
    let (access, flags) = (libc::PROT_READ | libc::PROT_EXEC, libc::MAP_PRIVATE);
    bun_sys::mmap(core::ptr::null_mut(), size, access, flags, descriptor, 0)
        .is_ok_and(|page| bun_sys::munmap(page, size).is_ok())
}

#[cfg(target_os = "linux")]
fn create_shared_memory() -> Option<Fd> {
    // What `shm_open` and `shm_unlink` do. Before glibc 2.34 they are in librt, which Bun does not link.
    let file = File::from_fd(create_deleted_file(b"/dev/shm").ok()?);
    can_map_code(file.handle()).then(|| file.into_raw())
}

#[cfg(target_os = "freebsd")]
fn create_shared_memory() -> Option<Fd> {
    // SAFETY: `SHM_ANON` stands in for a name and is not read.
    let descriptor =
        unsafe { libc::shm_open(libc::SHM_ANON, libc::O_RDWR | libc::O_CLOEXEC, 0o600) };
    (descriptor >= 0).then(|| Fd::from_native(descriptor))
}

#[cfg(unix)]
fn create_unnamed_file(first: ProgramFile) -> Maybe<(Fd, ProgramFile)> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if first == ProgramFile::Memfd && bun_sys::can_use_memfd() {
        if let Ok(descriptor) =
            bun_sys::memfd_create(c"bun-compiled-program", bun_sys::MemfdFlags::Executable)
        {
            return Ok((descriptor, ProgramFile::Memfd));
        }
    }
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    if first <= ProgramFile::SharedMemory {
        if let Some(descriptor) = create_shared_memory() {
            return Ok((descriptor, ProgramFile::SharedMemory));
        }
    }
    let _ = first;
    let descriptor = create_deleted_file(bun_resolver::fs::RealFS::tmpdir_path())?;
    Ok((descriptor, ProgramFile::Deleted))
}

#[cfg(unix)]
fn write_to_unnamed_file(parts: &[&[u8]], first: ProgramFile) -> Maybe<Fd> {
    let mut first = match env_var::BUN_DEBUG_TEST_AOT_PROGRAM_FILE.get() {
        Some(b"shared-memory") => ProgramFile::SharedMemory,
        Some(b"deleted") => ProgramFile::Deleted,
        _ => first,
    };
    let mut is_last_try = false;
    loop {
        let (error, kind) = match create_unnamed_file(first) {
            Ok((descriptor, kind)) => {
                let file = File::from_fd(descriptor);
                match write_to_empty_file(descriptor, parts) {
                    Ok(()) => return Ok(file.into_raw()),
                    Err(error) => (error, kind),
                }
            }
            // The kinds before it are passed over where they cannot be made.
            Err(error) => (error, ProgramFile::Deleted),
        };
        if is_last_try {
            return Err(error);
        }
        is_last_try = true;
        // Memory can be full where the disk is not, and the disk where memory is not.
        first = match kind {
            ProgramFile::Deleted => ProgramFile::Memfd,
            ProgramFile::Memfd | ProgramFile::SharedMemory => ProgramFile::Deleted,
        };
    }
}

/// `parts`, one behind the other.
#[cfg(unix)]
fn write_to_empty_file(descriptor: Fd, parts: &[&[u8]]) -> Maybe<()> {
    #[cfg(target_os = "linux")]
    if copy_into_mapping_of_empty_file(descriptor, parts) {
        return Ok(());
    }
    write_from_position(descriptor, 0, parts)
}

#[cfg(unix)]
fn write_from_position(descriptor: Fd, mut position: i64, parts: &[&[u8]]) -> Maybe<()> {
    for mut bytes in parts.iter().copied() {
        while !bytes.is_empty() {
            let count = bun_sys::pwrite(descriptor, bytes, position)?;
            bytes = &bytes[count..];
            position += count as i64;
        }
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn write_program_or_exit(parts: &[&[u8]]) -> WrittenProgram {
    match write_to_unnamed_file(parts, ProgramFile::Memfd) {
        Ok(descriptor) => WrittenProgram {
            descriptor,
            length: parts.iter().map(|part| part.len()).sum(),
        },
        Err(error) => exit_write_failed(&error),
    }
}

/// The run waits while a program of hundreds of megabytes is written. Threads that write to one file wait for each other. Threads
/// that copy into a mapping of it do not.
///
/// `false`: the file holds nothing that counts, and the caller writes it.
#[cfg(target_os = "linux")]
fn copy_into_mapping_of_empty_file(descriptor: Fd, parts: &[&[u8]]) -> bool {
    const MIN_BYTES: usize = 16 << 20;
    const MIN_BYTES_OF_THREAD: usize = 4 << 20;
    let length: usize = parts.iter().map(|part| part.len()).sum();
    if length < MIN_BYTES {
        return false;
    }
    // A store to a page that there is no room for ends the process. With the room taken first, it is an error of this call.
    // SAFETY: the system checks the descriptor and the range.
    if unsafe { libc::fallocate(descriptor.native(), 0, 0, length as libc::off_t) } != 0 {
        return false;
    }
    let Ok(start) = bun_sys::mmap(
        core::ptr::null_mut(),
        length,
        libc::PROT_READ | libc::PROT_WRITE,
        libc::MAP_SHARED,
        descriptor,
        0,
    ) else {
        return false;
    };
    // SAFETY: the mapping has `length` bytes that may be written, and nothing else refers to them until `munmap`.
    let mapped = unsafe { core::slice::from_raw_parts_mut(start, length) };
    let share = length
        .div_ceil(usize::from(bun_core::get_thread_count()))
        .max(MIN_BYTES_OF_THREAD);
    let mut room = mapped;
    let mut shares = Vec::new();
    for part in parts {
        let (target, behind) = room.split_at_mut(part.len());
        shares.extend(target.chunks_mut(share).zip(part.chunks(share)));
        room = behind;
    }
    for_each_on_threads(shares, |(target, source)| target.copy_from_slice(source));
    let _ = bun_sys::munmap(start, length);
    true
}

/// `run` for each of `tasks`, on this thread and on as many others as there are further tasks. Where the system has reached a limit
/// of threads it gives fewer, or none: those that run take what is left.
pub(crate) fn for_each_on_threads<Task: Send>(tasks: Vec<Task>, run: impl Fn(Task) + Sync) {
    let others = tasks.len().saturating_sub(1);
    let tasks = Guarded::new(tasks);
    let run_what_is_left = || {
        loop {
            let Some(task) = tasks.lock().pop() else {
                return;
            };
            run(task);
        }
    };
    std::thread::scope(|scope| {
        for _ in 0..others {
            // SAFETY: no state of a VM goes along. `Task` is `Send` and `run` is `Sync`, which a VM, its event loop and its global object are not.
            let thread = std::thread::Builder::new();
            if thread.spawn_scoped(scope, run_what_is_left).is_err() {
                break;
            }
        }
        run_what_is_left();
    });
}

#[cold]
fn exit_write_failed(error: &bun_sys::Error) -> ! {
    Output::err_generic(
        "--aot could not write the compiled program to a temporary file: {}",
        (error,),
    );
    Global::exit(1)
}

fn second_process_arguments(
    typed: &[&'static [u8]],
    own_count: usize,
    handover_flag: &[u8],
) -> Vec<Vec<u8>> {
    let mode_flag = typed[..own_count]
        .iter()
        .position(|token| matches!(*token, b"--aot" | b"--debug-aot"));
    let mut arguments: Vec<Vec<u8>> = Vec::with_capacity(typed.len() + 1);
    if mode_flag.is_none() {
        arguments.push(handover_flag.to_vec());
    }
    for (index, token) in typed.iter().enumerate() {
        if mode_flag == Some(index) {
            arguments.push(handover_flag.to_vec());
        } else {
            arguments.push(token.to_vec());
        }
    }
    arguments
}

#[cfg(unix)]
fn start_second_process(
    typed: &[&'static [u8]],
    own_count: usize,
    handover: Handover<'_>,
    original_cwd: Option<&[u8]>,
) -> ! {
    let after = handover.bytes_after;
    let written = handover.program.map(|program| match program {
        Program::Bytes(bytes) => write_to_unnamed_file(&[bytes, after], ProgramFile::Memfd),
        Program::Written(WrittenProgram { descriptor, length }) => {
            write_from_position(descriptor, length as i64, &[after]).map(|()| descriptor)
        }
    });
    let descriptor = match written {
        None => None,
        Some(Ok(descriptor)) => Some(descriptor),
        Some(Err(error)) => exit_write_failed(&error),
    };
    let descriptor_text = descriptor.map(|descriptor| descriptor.native().to_string());
    let descriptor_text = descriptor_text
        .as_ref()
        .map_or(NO_DESCRIPTOR, String::as_bytes);
    let arguments =
        second_process_arguments(typed, own_count, &[handover.flag, descriptor_text].concat());
    let arguments: Vec<&[u8]> = arguments.iter().map(Vec::as_slice).collect();
    if let Some(Err(error)) =
        original_cwd.map(|directory| bun_sys::chdir(&ZBox::from_bytes(directory)))
    {
        Output::err_generic("--aot could not start bun again: {}", (&error,));
        Global::exit(1)
    }
    Output::flush();
    let errno = bun_core::exec_self(&arguments, descriptor);
    Output::err_generic("--aot could not start bun again: errno {}", (errno,));
    Global::exit(1)
}

#[cfg(windows)]
const HANDLE_FLAG_INHERIT: u32 = 1;

#[cfg(windows)]
unsafe extern "system" {
    fn SetHandleInformation(handle: *mut core::ffi::c_void, mask: u32, flags: u32) -> i32;
    fn GetStartupInfoW(startup_info: *mut bun_sys::windows::STARTUPINFOW);
}

/// `block` is what a parent process hands to the C runtime of its child: a count, then a byte of flags for each
/// descriptor, then a handle for each. The answer starts at descriptor 3.
#[cfg(any(windows, test))]
fn list_open_extra_descriptors(block: &[u8]) -> Vec<bool> {
    const IS_OPEN: u8 = 1;
    const MOST_THAT_LIBUV_HANDS_ON: usize = 255;
    let Some((count, rest)) = block.split_first_chunk::<4>() else {
        return Vec::new();
    };
    let count = (u32::from_ne_bytes(*count) as usize)
        .min(rest.len() / (1 + size_of::<usize>()))
        .min(MOST_THAT_LIBUV_HANDS_ON);
    let flags_from_3_up = rest[..count].iter().skip(3);
    flags_from_3_up
        .map(|flags| (flags & IS_OPEN) != 0)
        .collect()
}

#[cfg(windows)]
fn list_inherited_extra_descriptors() -> Box<[bool]> {
    // SAFETY: integers and null pointers are a valid STARTUPINFOW.
    let mut startup_info: bun_sys::windows::STARTUPINFOW =
        unsafe { bun_core::ffi::zeroed_unchecked() };
    // SAFETY: the call fills the structure it is given.
    unsafe { GetStartupInfoW(&mut startup_info) };
    if startup_info.lpReserved2.is_null() {
        return Box::default();
    }
    // SAFETY: the block is part of the parameters of this process, which are never freed.
    let block = unsafe {
        core::slice::from_raw_parts(
            startup_info.lpReserved2,
            usize::from(startup_info.cbReserved2),
        )
    };
    let is_still_open = |index: usize| Fd::from_uv(3 + index as i32).native() as isize > 0;
    list_open_extra_descriptors(block)
        .into_iter()
        .enumerate()
        .map(|(index, was_open)| was_open && is_still_open(index))
        .collect()
}

#[cfg(windows)]
fn write_to_named_file(path: &bun_core::ZStr, bytes: &[u8], bytes_after: &[u8]) -> Maybe<Fd> {
    let file = File::from_fd(bun_sys::openat(
        Fd::cwd(),
        path,
        O::RDWR | O::CREAT | O::EXCL,
        0o700,
    )?);
    file.write_all(bytes)?;
    file.write_all(bytes_after)?;
    Ok(file.into_raw())
}

#[cfg(windows)]
fn run_second_process(arguments: Vec<Vec<u8>>, original_cwd: Option<&[u8]>) -> u32 {
    use crate::api::bun_process::{Status, sync};

    let executable = match bun_core::self_exe_path() {
        Ok(executable) => executable,
        Err(error) => {
            Output::err_generic(
                "--aot could not start bun again: {}",
                (BStr::new(error.name()),),
            );
            return 1;
        }
    };
    let own_name = bun_core::argv().get(0).unwrap_or(executable);
    let mut argv: Vec<Box<[u8]>> = Vec::with_capacity(arguments.len() + 1);
    argv.push(Box::from(own_name.as_bytes()));
    argv.extend(arguments.into_iter().map(Vec::into_boxed_slice));

    bun_spawn::ctrl_c::install();
    let spawned = sync::spawn(&sync::Options {
        argv,
        argv0: Some(executable.as_ptr().cast::<core::ffi::c_char>()),
        cwd: original_cwd.map(Box::<[u8]>::from).unwrap_or_default(),
        envp: None,
        stderr: sync::SyncStdio::Inherit,
        stdout: sync::SyncStdio::Inherit,
        stdin: sync::SyncStdio::Inherit,
        windows: crate::api::bun_process::WindowsOptions {
            loop_: bun_jsc::EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(
                None, None,
            )),
            ..Default::default()
        },
        inherited_extra_fds: list_inherited_extra_descriptors(),
        ..Default::default()
    });
    match spawned {
        Err(error) => {
            Output::err_generic(
                "--aot could not start bun again: {}",
                (BStr::new(error.name()),),
            );
            1
        }
        Ok(Err(error)) => {
            Output::err_generic("--aot could not start bun again: {}", (&error,));
            1
        }
        Ok(Ok(result)) => match result.status {
            Status::Exited(exited) => exited.raw,
            Status::Err(error) => {
                Output::err_generic("--aot could not start bun again: {}", (&error,));
                1
            }
            Status::Signaled(_) | Status::Running => 1,
        },
    }
}

#[cfg(windows)]
fn start_second_process(
    typed: &[&'static [u8]],
    own_count: usize,
    handover: Handover<'_>,
    original_cwd: Option<&[u8]>,
) -> ! {
    let Some(Program::Bytes(bytes)) = handover.program else {
        let arguments =
            second_process_arguments(typed, own_count, &[handover.flag, NO_DESCRIPTOR].concat());
        Output::flush();
        Global::exit(run_second_process(arguments, original_cwd))
    };
    let path = temporary_path(bun_resolver::fs::RealFS::tmpdir_path());
    let descriptor = match write_to_named_file(&path, bytes, handover.bytes_after) {
        Ok(descriptor) => descriptor,
        Err(error) => {
            let _ = bun_sys::unlinkat(Fd::cwd(), &path);
            exit_write_failed(&error)
        }
    };
    let handle = descriptor.native();
    // SAFETY: `handle` is the open file handle this function owns until the close below.
    unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
    let descriptor_text = (handle as usize).to_string();
    let arguments = second_process_arguments(
        typed,
        own_count,
        &[handover.flag, descriptor_text.as_bytes()].concat(),
    );
    Output::flush();
    let exit_code = run_second_process(arguments, original_cwd);
    let _ = bun_sys::close(descriptor);
    let _ = bun_sys::unlinkat(Fd::cwd(), &path);
    Global::exit(exit_code)
}

fn parse_descriptor(text: &[u8]) -> Option<Fd> {
    if text.is_empty() || !text.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let text = core::str::from_utf8(text).ok()?;
    #[cfg(unix)]
    {
        text.parse::<i32>().ok().map(Fd::from_native)
    }
    #[cfg(windows)]
    {
        let handle = text.parse::<isize>().ok()?;
        Some(Fd::from_system(handle as *mut core::ffi::c_void))
    }
}

#[cold]
#[inline(never)]
pub(crate) fn use_graph_descriptor(text: &[u8]) {
    if Graph::get().is_some() {
        return;
    }
    let Some(descriptor) = parse_descriptor(text) else {
        Output::err_generic(
            "--aot-graph-fd: \"{}\" is not a file descriptor",
            (BStr::new(text),),
        );
        Global::exit(1)
    };
    let failure = match Graph::from_descriptor(descriptor) {
        Ok(Some(_)) => {
            IS_FROM_DESCRIPTOR.store(true, Ordering::Relaxed);
            let _ = GRAPH_DESCRIPTOR.set(descriptor);
            remember_check_result(&Graph::read_after_graph(descriptor).unwrap_or_default());
            return;
        }
        Ok(None) => "empty",
        Err(error) => error.name(),
    };
    Output::err_generic(
        "--aot-graph-fd: the compiled program could not be read ({})",
        (failure,),
    );
    Global::exit(1)
}

#[cfg(not(bun_locked_environment))]
pub(crate) fn writes_program_alone() -> bool {
    bun_core::getenv_z(bun_core::zstr!("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING")).is_some()
        && env_var::BUN_AOT_WRITES_PROGRAM_ALONE.get() == Some(true)
}

#[cfg(bun_locked_environment)]
pub(crate) fn writes_program_alone() -> bool {
    false
}

/// The program begins behind it, at the head of a page of any machine.
const ROOM_OF_LAUNCHER: usize = 64 * 1024;

/// The file can be started as the executable could: a shell script at its head starts this Bun with the file.
#[cfg(unix)]
pub(crate) fn write_program_alone(
    directory: Fd,
    path: &[u8],
    program: &[u8],
    build_id: &[u8; 16],
) -> Maybe<()> {
    let bun = bun_core::self_exe_path().unwrap_or(bun_core::zstr!("bun"));
    let parts: Vec<&[u8]> = bun_core::strings::split(bun.as_bytes(), b"'").collect();
    let quoted = parts.join(&b"'\\''"[..]);
    let mut launcher = [
        &b"#!/bin/sh\ncase \"$0\" in /*) file=\"$0\";; *) file=\"$PWD/$0\";; esac\n"[..],
        b"export BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=\"${BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING-launcher}\"\n",
        b"exec '",
        &quoted,
        b"' --aot-program-file=\"$file\" --aot-program-argv0=\"$0\" \"$@\"\n",
    ]
    .concat();
    launcher.resize(ROOM_OF_LAUNCHER - build_id.len(), b'\n');
    launcher.extend_from_slice(build_id);
    let flags = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC;
    let path = ZBox::from_bytes(path);
    let file = File::from_fd(bun_sys::openat(directory, &path, flags, 0o755)?);
    let written = file
        .write_all(&launcher)
        .and_then(|()| file.write_all(program));
    let _ = bun_sys::close(file.into_raw());
    written
}

#[cfg(not(unix))]
pub(crate) fn write_program_alone(
    directory: Fd,
    path: &[u8],
    program: &[u8],
    _build_id: &[u8; 16],
) -> Maybe<()> {
    File::write_file(directory, &ZBox::from_bytes(path), program)
}

/// The first word of the command line, with the path of the file. Behind it may stand `--aot-program-argv0=` with what was typed to start the file.
#[cfg(not(bun_locked_environment))]
pub(crate) const PROGRAM_FILE_FLAG: &[u8] = b"--aot-program-file=";

/// The caller has seen `PROGRAM_FILE_FLAG`.
#[cfg(not(bun_locked_environment))]
#[cold]
#[inline(never)]
pub(crate) fn load_program_file() -> bun_standalone_graph::Result<Option<*mut Graph>> {
    use bun_paths::resolve_path::{join_abs_string, platform};
    use bun_resolver::compiled_program::{FILE_IN_PLACE_OF_EXECUTABLE, FileInPlaceOfExecutable};

    if bun_core::getenv_z(bun_core::zstr!("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING")).is_none() {
        return Ok(None);
    }
    let mut argv = bun_core::argv().to_vec();
    let place = 1 + bun_core::bun_options_argc();
    let path = &argv.remove(place).as_bytes()[PROGRAM_FILE_FLAG.len()..];
    let typed =
        (argv.get(place)).and_then(|next| next.as_bytes().strip_prefix(b"--aot-program-argv0="));
    if typed.is_some() {
        argv.remove(place);
    }
    let flags = O::RDONLY | O::CLOEXEC;
    let Ok(descriptor) = bun_sys::openat(Fd::cwd(), &ZBox::from_bytes(path), flags, 0) else {
        Output::err_generic(
            "--aot-program-file: {} can't be opened",
            (bun_core::fmt::quote(path),),
        );
        Global::exit(1)
    };
    let mut head = [0u8; 2];
    let has_launcher = matches!(bun_sys::pread(descriptor, &mut head, 0), Ok(2)) && head == *b"#!";
    let offset = if has_launcher { ROOM_OF_LAUNCHER } else { 0 };
    // As an executable is Bun there.
    let graph = match env_var::feature_flag::BUN_BE_BUN::get().unwrap_or(false) {
        true => None,
        false => match Graph::from_descriptor_at(descriptor, offset)? {
            Some(graph) => Some(graph),
            None => Graph::exit_without_program(),
        },
    };

    let mut build_id = [0u8; 16];
    let place = (ROOM_OF_LAUNCHER - build_id.len()) as i64;
    if has_launcher
        && graph.is_some()
        && matches!(bun_sys::pread(descriptor, &mut build_id, place), Ok(16))
    {
        bun_crash_handler::build_id::set_name_of_program_file(&build_id);
    }

    let file = match bun_sys::getcwd_alloc() {
        Ok(cwd) => join_abs_string::<platform::Auto>(cwd.as_bytes(), &[path]).to_vec(),
        Err(_) => path.to_vec(),
    };
    argv[0] = Box::leak(Box::new(ZBox::from_bytes(typed.unwrap_or(&file)))).as_zstr();
    // SAFETY: no other thread has started.
    unsafe { bun_core::set_argv(Vec::leak(argv)) };
    // The program finds the environment that the launcher found.
    #[cfg(unix)]
    if has_launcher {
        let is_of_launcher =
            |variable: &[u8]| variable == b"BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=launcher";
        let mut from = bun_core::c_environ().cast_mut();
        let mut to = from;
        // SAFETY: the block ends with a null pointer, its texts end with NUL, and no other thread has started.
        unsafe {
            while !(*from).is_null() {
                if !is_of_launcher(bun_core::ffi::cstr(*from).to_bytes()) {
                    *to = *from;
                    to = to.add(1);
                }
                from = from.add(1);
            }
            *to = core::ptr::null();
        }
    }
    let _ = FILE_IN_PLACE_OF_EXECUTABLE.set(FileInPlaceOfExecutable {
        path: file.into_boxed_slice(),
        can_be_started: has_launcher,
    });
    Ok(graph)
}

pub(crate) fn graph() -> Option<&'static dyn bun_resolver::StandaloneModuleGraph> {
    if !runs_compiled_code() {
        return None;
    }
    Some(Graph::get_ref()?)
}

/// The compiled program, to pass on to the workers of `bun test --parallel`.
pub(crate) fn graph_descriptor() -> Option<Fd> {
    GRAPH_DESCRIPTOR.get().copied()
}

/// Tells a worker of `bun test --parallel` where the compiled program is.
pub(crate) fn graph_flag_of_test_worker() -> Option<Vec<u8>> {
    let descriptor = graph_descriptor()?;
    let number = match cfg!(windows) {
        // A worker inherits the handle, as this process did.
        true => descriptor.native() as usize,
        // After stdio and the channel to the coordinator.
        false => 4,
    };
    Some([GRAPH_FLAG, number.to_string().as_bytes()].concat())
}

#[inline]
pub(crate) fn runs_compiled_code() -> bool {
    IS_FROM_DESCRIPTOR.load(Ordering::Relaxed)
}

/// `--isolate=modules`: a module graph for each test file in one global object, whose properties are put back between files. What puts them back is a
/// module of Bun's own code that the runner loads for itself. A compiled program holds what its files name and refuses the text of the rest: there
/// each file gets a global object of its own, as under `--isolate`.
pub(crate) fn test_files_share_global(ctx: &ContextData) -> bool {
    ctx.test_options.isolate_modules && !runs_compiled_code()
}

#[cold]
#[inline(never)]
pub(crate) fn use_check_result(text: &[u8]) {
    IS_CHECKED.store(true, Ordering::Relaxed);
    bun_core::replace_restart_arguments(|argument| {
        argument.starts_with(CHECKED_FLAG).then_some(&b"--aot"[..])
    });
    if text == NO_DESCRIPTOR {
        return;
    }
    let Some(list) = parse_descriptor(text).and_then(|descriptor| read_whole_file(descriptor).ok())
    else {
        Output::err_generic(
            "--aot-checked: \"{}\" is not a file descriptor",
            (BStr::new(text),),
        );
        Global::exit(1)
    };
    remember_check_result(&list);
}

fn take_number(bytes: &mut &[u8]) -> Option<u32> {
    let (number, rest) = bytes.split_first_chunk::<4>()?;
    *bytes = rest;
    Some(u32::from_ne_bytes(*number))
}

/// `result`: `write_check_result`, or nothing.
fn remember_check_result(result: &[u8]) {
    let mut rest = result;
    let mut files: Vec<Box<[u8]>> = Vec::new();
    while let Some(end) = bun_core::strings::index_of_char_usize(rest, 0) {
        let path = &rest[..end];
        rest = &rest[end + 1..];
        if path.is_empty() {
            break;
        }
        files.push(Box::from(path));
    }
    let _ = FILES_OF_CHECK.set(files);
    while let (Some(holder), Some(length)) = (take_number(&mut rest), take_number(&mut rest)) {
        let Some((name, behind)) = rest.split_at_checked(length as usize) else {
            break;
        };
        rest = behind;
        // SAFETY: the bytes are copied before the call returns.
        unsafe { Bun__AOT__openNameWithoutImage(holder, name.as_ptr(), name.len()) };
    }
}

pub(crate) fn watch_files_of_check(vm: &VirtualMachine) {
    for path in FILES_OF_CHECK.get().into_iter().flatten() {
        vm.add_to_watcher_if_needed(path);
    }
}

fn read_whole_file(descriptor: Fd) -> Maybe<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match bun_sys::pread(descriptor, &mut chunk, bytes.len() as i64)? {
            0 => break,
            count => bytes.extend_from_slice(&chunk[..count]),
        }
    }
    bun_sys::close(descriptor)?;
    Ok(bytes)
}

#[inline]
pub(crate) fn is_checked() -> bool {
    IS_CHECKED.load(Ordering::Relaxed)
}

unsafe extern "C" {
    safe fn Bun__AOT__listRefusedChanges();
    fn Bun__AOT__openNameWithoutImage(holder: u32, name: *const u8, length: usize);
    safe fn Bun__AOT__peakResidentMegabytesOfProcess() -> usize;
}

pub(crate) fn list_refused_changes() {
    if runs_compiled_code() {
        Bun__AOT__listRefusedChanges();
    }
}

pub(crate) fn will_run_test_file(title: &[u8]) {
    if runs_compiled_code() {
        *RUNNING_TEST_FILE.lock() = title.to_vec();
        NEWEST_REFUSAL_OF_RUNNING_TEST_FILE.lock().clear();
    }
}

pub(crate) fn refused_changes() -> Vec<Vec<u8>> {
    let mut refused = REFUSED_CHANGES.lock();
    FILES_RUN_FROM_SOURCE.lock().clear();
    FILES_THAT_KEPT_THEIR_RUN.lock().clear();
    core::mem::take(&mut *refused)
}

/// BunCompiledModules.cpp. The runner has a test file whose load has settled and whose `describe` callbacks it has yet to call. It turns the
/// event loop once in between.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__isBetweenLoadOfTestFileAndItsCallbacks(
    global: &bun_jsc::JSGlobalObject,
) -> bool {
    let Some(runner) = crate::test_runner::jest::Jest::runner() else {
        return false;
    };
    let Some(file) = runner.bun_test_root.clone_active_file() else {
        return false;
    };
    file.get().is_loading
        && global
            .bun_vm()
            .pending_internal_promise()
            .is_some_and(|load| {
                bun_jsc::JSInternalPromise::opaque_mut(load).status()
                    != bun_jsc::js_promise::Status::Pending
            })
}

/// BunCompiledModules.cpp. Immediates that were set have yet to run.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__hasImmediatesYetToRun(global: &bun_jsc::JSGlobalObject) -> bool {
    let event_loop = global.bun_vm().event_loop_shared();
    !event_loop.immediate_tasks.is_empty() || !event_loop.next_immediate_tasks.is_empty()
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__recordRefusedChange(
    refusal: &bun_core::String,
    source_url: &bun_core::String,
    line: u32,
    column: u32,
) {
    let said = refusal.to_owned_slice();
    if let Some(file_and_why) = said.strip_prefix(RAN_FROM_SOURCE) {
        return add_file_run_from_source(file_and_why);
    }
    if let Some(quoted) = said.strip_prefix(KEPT_RUN) {
        return add_file_that_kept_its_run(&quoted[1..quoted.len() - 1]);
    }
    // Code from a string bears the URL of the file that evaluated it, and its lines are the string's.
    let place = if source_url.to_owned_slice().starts_with(b"file://") {
        let file = path_below_project(&bun_url::path_from_file_url(source_url));
        format!("in code from a string, in {}", BStr::new(&file))
    } else {
        let file = path_below_project(source_url);
        format!("at {}:{line}:{column}", BStr::new(&file))
    };
    let refusal = format!("{}, {place}", BStr::new(&refusal.to_owned_slice()));
    add_refusal_of_running_test_file(refusal.into_bytes());
}

/// `file_and_why`: "'<path>': <why>".
fn add_file_run_from_source(file_and_why: &[u8]) {
    let Some(end) = bun_core::strings::index_of(file_and_why, b"': ") else {
        return;
    };
    let path = bun_core::String::clone_utf8(&file_and_why[1..end]);
    let file = RUNNING_TEST_FILE.lock().clone();
    add_refused_change(
        [
            RAN_FROM_SOURCE,
            &path_below_project(&path)[..],
            &file_and_why[end + 1..],
            b", while ",
            &file[..],
            b" ran",
        ]
        .concat(),
    );
}

fn add_file_that_kept_its_run(path: &[u8]) {
    let path = path_below_project(&bun_core::String::clone_utf8(path));
    let file = RUNNING_TEST_FILE.lock().clone();
    add_refused_change([KEPT_RUN, &path[..], b", while ", &file[..], b" ran"].concat());
}

/// "Kept the run of <path>, while <test file> ran": the path.
fn file_that_kept_its_run(line: &[u8]) -> Option<&[u8]> {
    let rest = line.strip_prefix(KEPT_RUN)?;
    Some(&rest[..bun_core::strings::index_of(rest, b", while ")?])
}

/// "Ran from source <path>[?<query>]: <why>, while <test file> ran": the path.
fn file_run_from_source(line: &[u8]) -> Option<&[u8]> {
    let rest = line.strip_prefix(RAN_FROM_SOURCE)?;
    let path = &rest[..bun_core::strings::index_of(rest, b": ")?];
    let end = bun_core::strings::index_of_char(path, b'?').map_or(path.len(), |at| at as usize);
    Some(&path[..end])
}

fn add_refusal_of_running_test_file(refusal: Vec<u8>) {
    let file = RUNNING_TEST_FILE.lock().clone();
    add_refused_change([&refusal[..], b", while ", &file[..], b" ran"].concat());
    if !refusal.starts_with(LOADED_ADDON) {
        *NEWEST_REFUSAL_OF_RUNNING_TEST_FILE.lock() = refusal;
    }
}

/// Under the line of a test that failed. What was refused may have been caught, and the list at the end of the run stands far from the test.
pub(crate) fn write_note_on_refusal(writer: &mut impl bun_io::Write) {
    if !runs_compiled_code() {
        return;
    }
    let refusal = NEWEST_REFUSAL_OF_RUNNING_TEST_FILE.lock();
    let (what, refusal, way_out): (&str, &[u8], &str) = match &refusal[..] {
        [] => return,
        load if load.starts_with(REFUSED_LOAD) => (
            "--aot refused to load code that wasn't compiled",
            load,
            ", or add --aot-allow-code-from-disk",
        ),
        file if file.starts_with(UNREACHED_FILE) => (
            "--aot refused a computed path that the build didn't see",
            file,
            "",
        ),
        name if name.starts_with(MISSING_EXPORT) => (
            "code from disk imported a name that the build left out",
            &name[MISSING_EXPORT.len()..],
            "",
        ),
        write => ("--aot refused a write to a read-only built-in", write, ""),
    };
    let _ = bun_core::write_pretty!(
        writer,
        Output::enable_ansi_colors_stderr(),
        "  <d>^<r> <yellow>while this file ran, {s}<r><d>: {}. See the end of the run{s}<r>\n",
        what,
        BStr::new(refusal),
        way_out
    );
}

/// `refusals`: "Cannot load '<path>', at <file>:<line>:<column>, while <test file> ran". Each file that asked, once, with the file on disk that makes it the product's.
pub(crate) fn find_why_askers_are_of_product(refusals: &[Vec<u8>]) -> Vec<(Vec<u8>, Vec<u8>)> {
    let top = bun_resolver::fs::FileSystem::get().top_level_dir();
    let top = top.strip_suffix(&[bun_paths::SEP]).unwrap_or(top);
    let mut askers: Vec<&[u8]> = (refusals.iter())
        .filter_map(|refusal| {
            let place = &refusal[bun_core::strings::index_of(refusal, b"', at ")? + 6..];
            let place = &place[..bun_core::strings::index_of(place, b", while ")?];
            place.rsplitn(3, |&byte| byte == b':').nth(2)
        })
        .collect();
    askers.sort_unstable();
    askers.dedup();
    if askers.is_empty() {
        return Vec::new();
    }
    let files = askers.iter().map(|asker| {
        let below = bun_core::strings::replace_owned(asker, b"/", &[bun_paths::SEP]);
        [top, &[bun_paths::SEP], &below[..]].concat()
    });
    let files: Vec<Vec<u8>> = files.collect();
    let is_compiled = |path: &[u8]| bun_jsc::compiled_program::is_compiled_module(path);
    let importers = bun_aot::builtins::find_importers_outside_run(top, &files, &is_compiled);
    (askers.into_iter().zip(importers))
        .filter_map(|(asker, importer)| {
            let importer = importer?;
            let importer = importer
                .strip_prefix(top)?
                .strip_prefix(&[bun_paths::SEP])?;
            let importer = bun_core::strings::replace_owned(importer, &[bun_paths::SEP], b"/");
            Some((asker.to_vec(), importer))
        })
        .collect()
}

fn path_below_project(path: &bun_core::String) -> Vec<u8> {
    let path = path.to_owned_slice();
    let shown = bun_paths::resolve_path::relative(
        bun_resolver::fs::FileSystem::get().top_level_dir(),
        &path,
    );
    bun_core::strings::replace_owned(shown, &[bun_paths::SEP], b"/")
}

pub(crate) const MISSING_EXPORT: &[u8] = b"Missing ";
pub(crate) const REFUSED_LOAD: &[u8] = b"Cannot load ";
pub(crate) const LOADED_ADDON: &[u8] = b"Loaded ";
pub(crate) const UNREACHED_FILE: &[u8] = b"Cannot reach ";
pub(crate) const RAN_FROM_SOURCE: &[u8] = b"Ran from source ";
pub(crate) const KEPT_RUN: &[u8] = b"Kept the run of ";

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__recordMissingExport(
    name: &bun_core::String,
    exporter: &bun_core::String,
    importer: &bun_core::String,
) {
    let refusal = format!(
        "{}'{}' in {}, asked for by {}",
        BStr::new(MISSING_EXPORT),
        BStr::new(&name.to_owned_slice()),
        BStr::new(&path_below_project(exporter)),
        BStr::new(&path_below_project(importer)),
    );
    add_refusal_of_running_test_file(refusal.into_bytes());
}

/// In the process that prints the summary, and in a worker until the file is done.
pub(crate) fn add_refused_change(line: Vec<u8>) {
    let mut refused = REFUSED_CHANGES.lock();
    // Each file once, with the test file under which it first ran so.
    if let Some(file) = file_run_from_source(&line) {
        if FILES_RUN_FROM_SOURCE.lock().insert(file.to_vec()) {
            refused.push(line);
        }
        return;
    }
    // Each file once, with the test file that first asked for it again.
    if let Some(file) = file_that_kept_its_run(&line) {
        if FILES_THAT_KEPT_THEIR_RUN.lock().insert(file.to_vec()) {
            refused.push(line);
        }
        return;
    }
    let listed =
        refused.len() - FILES_RUN_FROM_SOURCE.lock().len() - FILES_THAT_KEPT_THEIR_RUN.lock().len();
    if listed < MAX_LISTED_REFUSED_CHANGES && !refused.contains(&line) {
        refused.push(line);
    }
}

#[inline]
pub(crate) fn is_second_process() -> bool {
    runs_compiled_code() || is_checked()
}

static NAMES_ENVIRONMENT_FILE_THAT_IS_NO_FILE: AtomicBool = AtomicBool::new(false);

/// Asked where the flags are read, so every process of a run has the same answer.
pub(crate) fn note_environment_files(paths: &[&[u8]]) {
    #[cfg(unix)]
    let is_file = |path: &&[u8]| {
        bun_sys::stat(&ZBox::from_bytes(path))
            .is_ok_and(|stat| bun_sys::is_regular_file(stat.st_mode as _))
    };
    #[cfg(unix)]
    NAMES_ENVIRONMENT_FILE_THAT_IS_NO_FILE.store(!paths.iter().all(is_file), Ordering::Relaxed);
    #[cfg(not(unix))]
    let _ = paths;
}

/// `--env-file` may name a pipe, which can be read once, and the first process has read it. Then the process that it starts finds the values in its
/// environment and reads no file, as a worker of `--parallel` does. Files are read by each process: an environment has a limit.
#[inline]
pub(crate) fn has_environment_of_first_process() -> bool {
    is_second_process() && NAMES_ENVIRONMENT_FILE_THAT_IS_NO_FILE.load(Ordering::Relaxed)
}

#[inline]
pub(crate) fn read_no_environment_file_again(ctx: &mut ContextData) {
    if has_environment_of_first_process() {
        ctx.args.env_files.clear();
        ctx.args.disable_default_env_files = true;
    }
}

static HAS_HANDED_ON_ENVIRONMENT: AtomicBool = AtomicBool::new(false);

#[cold]
#[inline(never)]
pub(crate) fn hand_on_environment(map: &bun_dotenv::Map) {
    HAS_HANDED_ON_ENVIRONMENT.store(true, Ordering::Relaxed);
    #[cfg(unix)]
    if NAMES_ENVIRONMENT_FILE_THAT_IS_NO_FILE.load(Ordering::Relaxed) {
        add_to_environment(map);
    }
    #[cfg(not(unix))]
    let _ = map;
}

/// What is set stays. One new block, since `setenv` looks through the whole block for each name.
#[cfg(unix)]
fn add_to_environment(map: &bun_dotenv::Map) {
    use core::ffi::{CStr, c_char};
    unsafe extern "C" {
        safe static environ: core::sync::atomic::AtomicPtr<*const c_char>;
    }
    let mut block: Vec<*const c_char> = Vec::new();
    let mut names: std::collections::BTreeSet<&[u8]> = std::collections::BTreeSet::new();
    let mut entry = environ.load(Ordering::Relaxed);
    // SAFETY: the block ends with a null pointer and each of its entries with a NUL, and nothing frees them.
    while let Some(text) = unsafe { entry.as_ref().filter(|text| !text.is_null()) } {
        // SAFETY: see above.
        let bytes = unsafe { CStr::from_ptr(*text) }.to_bytes();
        let end = bun_core::strings::index_of_char_usize(bytes, b'=').unwrap_or(bytes.len());
        names.insert(&bytes[..end]);
        block.push(*text);
        // SAFETY: the null pointer has not been met.
        entry = unsafe { entry.add(1) };
    }
    for (name, value) in map.map.iter() {
        if names.contains(&**name) {
            continue;
        }
        if let Ok(text) = std::ffi::CString::new([&**name, b"=", &*value.value].concat()) {
            block.push(text.into_raw());
        }
    }
    block.push(core::ptr::null());
    environ.store(
        Box::leak(block.into_boxed_slice()).as_mut_ptr(),
        Ordering::Relaxed,
    );
}

#[cold]
#[inline(never)]
pub(crate) fn print_build_id_and_exit() -> ! {
    let Some(id) = bun_crash_handler::build_id::build_id() else {
        Output::err_generic(
            "--aot-build-id: this executable holds no compiled program",
            (),
        );
        Global::exit(1)
    };
    let _ = Output::writer().write_all(&bun_crash_handler::build_id::write_hexadecimal(&id));
    let _ = Output::writer().write_all(b"\n");
    Output::flush();
    Global::exit(0)
}

pub(crate) fn set_crash_report(report: &'static [u8]) {
    let _ = CRASH_REPORT.set(report);
}

pub(crate) fn decode_requested_crash_report() {
    if let Some(report) = CRASH_REPORT.get() {
        exit_with_decoded_report(report);
    }
}

#[cold]
#[inline(never)]
fn exit_with_decoded_report(report: &[u8]) -> ! {
    use bun_crash_handler::DecodedReport;
    match bun_crash_handler::report_compiled_frames(report) {
        DecodedReport::Frames(frames) => {
            let _ = Output::writer().write_all(&frames);
            Output::flush();
            Global::exit(0)
        }
        DecodedReport::NoCompiledFrames => Output::err_generic(
            "--aot-decode-crash-report: that report has no frames from this executable's compiled code",
            (),
        ),
        DecodedReport::OtherBuild {
            of_report: Some(of_report),
            of_executable,
        } => Output::err_generic(
            "--aot-decode-crash-report: that report is from the build whose ID starts with {}. The ID of this executable starts with {}. Only the build that crashed can read its report",
            (BStr::new(&of_report), BStr::new(&of_executable)),
        ),
        DecodedReport::OtherBuild {
            of_report: None,
            of_executable,
        } => Output::err_generic(
            "--aot-decode-crash-report: that report names no build, so it is not from this executable, whose build ID starts with {}",
            (BStr::new(&of_executable),),
        ),
    }
    Global::exit(1)
}
