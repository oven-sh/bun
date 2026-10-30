use core::num::NonZeroU32;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

use bstr::BStr;
use bun_core::{Global, Output, ZBox, env_var};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::aot_options::ReadListener;
use bun_options_types::aot_options::ReplacedByTests;
use bun_options_types::context::HotReload;
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
static REFUSED_FILES: OnceLock<Vec<Box<[u8]>>> = OnceLock::new();
static FILES_OF_CHECK: OnceLock<Vec<Box<[u8]>>> = OnceLock::new();
static CLEARS_TERMINAL: AtomicBool = AtomicBool::new(false);
static RUNNING_TEST_FILE: Guarded<Vec<u8>> = Guarded::new(Vec::new());
static REFUSED_CHANGES: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
const MAX_LISTED_REFUSED_CHANGES: usize = 100;
static CRASH_REPORT: OnceLock<&'static [u8]> = OnceLock::new();

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

#[cold]
#[inline(never)]
pub(crate) fn start(ctx: Context<'_>, entry_points: Vec<Box<[u8]>>, independent_count: usize) -> ! {
    let typed: Vec<&'static [u8]> = bun_core::argv()
        .into_iter()
        .skip(1 + bun_core::bun_options_argc())
        .collect();
    let own_count = typed.len().saturating_sub(ctx.passthrough.len());
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

    let mut entry_points = entry_points;
    let mut independent_count = independent_count;
    let mut refused_files = Vec::new();
    let defines = ctx.args.define.clone();
    ctx.bundler_options.compile = true;
    ctx.bundler_options.inline_entrypoint_import_meta_main = true;
    ctx.bundler_options.outfile = Box::from(&b"program"[..]);
    // `bun run` and `bun test` put no value in place of `process.env.NODE_ENV`: the program may store another.
    ctx.bundler_options.env_behavior = DotEnvBehavior::LoadAllWithoutInlining;

    let product = match checks_only {
        true => CompileProduct::ReportsOnly,
        false => CompileProduct::GraphBytes,
    };
    let outcome = loop {
        ctx.args.entry_points.clone_from(&entry_points);
        let failure = match compile_from_context(&mut *ctx, product) {
            Err(error) => {
                print_log(ctx.log_ref());
                Output::err_generic("{}", (BStr::new(error.name()),));
                exit_or_wait_for_change(watched)
            }
            Ok(Err(failure)) => failure,
            // Each query of a file is an instance of its own, which only code from disk can be. The program is compiled once more, for that.
            Ok(Ok(outcome)) if outcome.imports_file_with_query => {
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.loads_code_from_disk = true;
                }
                if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
                    bun_core::print_errorln!(
                        "AOT files are loaded again | a file is imported with a query"
                    );
                }
                // SAFETY: nothing else borrows the log between two builds.
                unsafe { ctx.log_mut() }.reset();
                ctx.args.define.clone_from(&defines);
                continue;
            }
            Ok(Ok(outcome)) => break outcome,
        };
        // It names what the test files name, so it reaches whatever one of those files reaches.
        let stand_in = (ctx.bundler_options.aot.as_ref())
            .is_some_and(|aot| aot.host_runs_files_from_disk)
            .then(|| entry_points.len() - 1);
        let Some(refused) = find_refused_files(&failure, independent_count, stand_in, !checks_only)
        else {
            let target = &ctx.bundler_options.compile_target;
            print_failure(ctx.log_ref(), RequestOrigin::BuildFlag, target, &failure);
            exit_or_wait_for_change(watched)
        };
        if !checks_only {
            // The next build repeats the warnings.
            // SAFETY: nothing else borrows the log between two builds.
            let messages = &mut unsafe { ctx.log_mut() }.msgs;
            messages.retain(|message| message.kind == bun_ast::Kind::Err);
        }
        print_log(ctx.log_ref());
        if let Some(stand_in) = stand_in {
            let refused = refused.iter().map(|&position| &*entry_points[position]);
            leave_out_of_stand_in(&entry_points[stand_in], &refused.collect::<Vec<_>>());
        }
        for &position in refused.iter().rev() {
            refused_files.extend_from_slice(&entry_points.remove(position));
            refused_files.push(0);
        }
        independent_count -= refused.len();
        // With no file left to run there is no program to build. Each file fails by itself, as under `bun test`.
        if checks_only || independent_count == 0 {
            let check_result = write_check_result(&refused_files, watched);
            let handover = Handover {
                flag: CHECKED_FLAG,
                bytes: Some(&check_result),
                bytes_after: &[],
            };
            hand_over(&typed, own_count, handover, ctx.original_cwd.as_deref())
        }
        // The other files are compiled without them.
        if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
            bun_core::print_errorln!(
                "AOT files are loaded again | without {} test files that reach an error",
                refused.len()
            );
        }
        // SAFETY: nothing else borrows the log between two builds.
        unsafe { ctx.log_mut() }.reset();
        ctx.args.define.clone_from(&defines);
    };
    // A part over the shared program reads none of the files it imports, so what it says about types is not true.
    let aot = ctx.bundler_options.aot.as_ref();
    if !aot.is_some_and(|aot| aot.is_part_of_test_files)
        || env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true)
    {
        print_log(ctx.log_ref());
    }
    let mut check_result = (watched.is_some() || !refused_files.is_empty())
        .then(|| write_check_result(&refused_files, watched));
    if builds_what_test_parts_share() && outcome.graph_bytes.is_some() {
        // The build ends with more built-ins than it was told of. The exports and modules are those that it was told of.
        let told = ctx
            .bundler_options
            .aot
            .as_ref()
            .map(|aot| &aot.replaced_by_tests);
        let replaced = ReplacedByTests {
            builtins: outcome.replaced_builtins.builtins.clone(),
            names_added_to_builtins: outcome.replaced_builtins.names_added_to_builtins.clone(),
            ..told.cloned().unwrap_or_default()
        };
        let after_graph = check_result.get_or_insert_default();
        append_what_tests_replace(after_graph, &replaced);
    }
    let handover = match &outcome.graph_bytes {
        Some(graph_bytes) => Handover {
            flag: GRAPH_FLAG,
            bytes: Some(graph_bytes),
            bytes_after: check_result.as_deref().unwrap_or_default(),
        },
        None => Handover {
            flag: CHECKED_FLAG,
            bytes: check_result.as_deref(),
            bytes_after: &[],
        },
    };
    hand_over(&typed, own_count, handover, ctx.original_cwd.as_deref())
}

/// How a process with `--aot-build-test-part` tells that it has checked the files and made no program. 0 is a program, and any other exit status a failed build.
pub(crate) const PART_HAS_NO_PROGRAM: u32 = 3;
static TEST_PART_DESCRIPTOR: OnceLock<Fd> = OnceLock::new();
/// The programs that the part is built above, the first of them first.
static BELOW_TEST_PART: Guarded<Vec<(&'static [u8], &'static Graph)>> = Guarded::new(Vec::new());
/// What the build of the last of them was told and found that tests replace.
static REPLACED_BELOW_TEST_PART: Guarded<Option<ReplacedByTests>> = Guarded::new(None);
static BUILDS_WHAT_TEST_PARTS_SHARE: AtomicBool = AtomicBool::new(false);
static BUILDS_PACKAGES_ALONE: AtomicBool = AtomicBool::new(false);
static THREADS_OF_TEST_PART: AtomicU32 = AtomicU32::new(0);
/// In the place of the descriptor of the program below.
const SHARED_BY_TEST_PARTS: &[u8] = b"shared";
const TEST_PART_FLAG: &[u8] = b"--aot-build-test-part=";

#[inline]
pub(crate) fn builds_test_part() -> bool {
    TEST_PART_DESCRIPTOR.get().is_some()
}

#[cold]
#[inline(never)]
pub(crate) fn use_test_part_descriptor(text: &[u8]) {
    let mut words = bun_core::strings::split(text, b",");
    let descriptor = words.next().and_then(parse_descriptor);
    for word in words {
        if word == SHARED_BY_TEST_PARTS {
            BUILDS_WHAT_TEST_PARTS_SHARE.store(true, Ordering::Relaxed);
        } else if word == b"packages" {
            BUILDS_PACKAGES_ALONE.store(true, Ordering::Relaxed);
        } else if let Some(count) = word.strip_prefix(b"threads:") {
            let count = bun_core::fmt::parse_int::<u32>(count, 10).unwrap_or(0);
            THREADS_OF_TEST_PART.store(count, Ordering::Relaxed);
        } else {
            #[cfg(unix)]
            {
                let colon = bun_core::strings::index_of_char_usize(word, b':');
                let number = || parse_descriptor(&word[colon? + 1..]);
                let Some(below) = number().and_then(Graph::read_image) else {
                    Output::err_generic(
                        "--aot-build-test-part: the program in \"{}\" could not be read",
                        (BStr::new(word),),
                    );
                    Global::exit(1)
                };
                BELOW_TEST_PART.lock().push(below);
                let after = number().and_then(Graph::read_after_graph);
                let (_, replaced) = split_off_what_tests_replace(&after.unwrap_or_default());
                *REPLACED_BELOW_TEST_PART.lock() = replaced;
            }
        }
    }
    let Some(descriptor) = descriptor else {
        Output::err_generic(
            "--aot-build-test-part: \"{}\" is not a file descriptor",
            (BStr::new(text),),
        );
        Global::exit(1)
    };
    let _ = TEST_PART_DESCRIPTOR.set(descriptor);
    *BUILD_BEGAN.lock() = Some(std::time::Instant::now());
    // A program of test files is built beside the tests, which are what the user waits for. It takes the processors that they leave:
    // workers that have no program to run are idle, and then it has them all. The threads that come inherit this.
    #[cfg(unix)]
    if !builds_what_test_parts_share() && !BELOW_TEST_PART.lock().is_empty() {
        // SAFETY: it changes the priority of the calling thread and touches no memory.
        unsafe { libc::nice(10) };
    }
}

/// When this process began to build.
static BUILD_BEGAN: Guarded<Option<std::time::Instant>> = Guarded::new(None);

/// With `BUN_JSC_logAOTPhaseTimes`: how long after the process began to build it has come this far. The stages of the compiler
/// time themselves. This is for what the process does around them.
pub(crate) fn log_step_of_build(step: &str) {
    if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
        let began = *BUILD_BEGAN.lock();
        bun_core::print_errorln!(
            "AOT part build step | {} | at {} ms",
            step,
            began.map_or(0, |began| began.elapsed().as_millis()),
        );
    }
}

/// With `BUN_JSC_logAOTPhaseTimes`: what the build of a part took from this process, in one line.
fn log_cost_of_build() {
    #[cfg(unix)]
    if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
        let mut usage = core::mem::MaybeUninit::<libc::rusage>::zeroed();
        // SAFETY: all zeroes is a valid `rusage`, and the kernel writes one.
        let usage = unsafe {
            libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr());
            usage.assume_init()
        };
        let ms = |time: libc::timeval| time.tv_sec as i64 * 1000 + time.tv_usec as i64 / 1000;
        let text = File::read_from(Fd::cwd(), b"/proc/self/smaps_rollup").unwrap_or_default();
        let mut lines = bun_core::strings::split(&text, b"\n");
        let own = lines.find(|line| line.starts_with(b"Private_Dirty:"));
        bun_core::print_errorln!(
            "AOT part build | {} | wall {} ms | user {} ms | system {} ms | most resident {} KB | at the end {}",
            match (builds_what_test_parts_share(), builds_packages_alone()) {
                (true, true) => "the packages that test files share",
                (true, false) => "what test files share",
                (false, _) => "test files",
            },
            BUILD_BEGAN
                .lock()
                .map_or(0, |began| began.elapsed().as_millis()),
            ms(usage.ru_utime),
            ms(usage.ru_stime),
            Bun__AOT__peakResidentMegabytesOfProcess() * 1024,
            BStr::new(own.unwrap_or_default()),
        );
    }
}

fn exit_builder(exit_code: u32) -> ! {
    log_cost_of_build();
    Global::exit(exit_code)
}

/// How many threads the process that started this one gives the build.
pub(crate) fn threads_of_test_part() -> Option<NonZeroU32> {
    NonZeroU32::new(THREADS_OF_TEST_PART.load(Ordering::Relaxed))
}

pub(crate) fn builds_what_test_parts_share() -> bool {
    BUILDS_WHAT_TEST_PARTS_SHARE.load(Ordering::Relaxed)
}

/// What the test files import is built once, as programs of its own, and the test files are built above them, a few at a time.
pub(crate) fn test_parts_share_a_program(ctx: &ContextData) -> bool {
    let aot = ctx.bundler_options.aot.as_ref();
    // The programs go to a worker by descriptor, and the engine has to take one image above another: it does not where images are
    // position independent (macOS, Windows, a hardened build).
    cfg!(unix)
        && Bun__AOT__takesImagesAboveOthers()
        && aot.is_some_and(|aot| !aot.test_run_is_one_program)
}

/// How many programs what the test files import is cut into: Bun's own code with the packages, and the rest above it.
pub(crate) fn test_run_layers(ctx: &ContextData) -> u32 {
    if !test_parts_share_a_program(ctx) {
        return 0;
    }
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty();
    let is_one = words.is_some_and(|words| {
        bun_core::strings::split(words, b",").any(|word| word == b"TestRunLayers:1")
    });
    if is_one { 1 } else { 2 }
}

/// Of what the test files share, the files of packages are a program of their own, which is built first.
pub(crate) fn builds_packages_alone() -> bool {
    BUILDS_PACKAGES_ALONE.load(Ordering::Relaxed)
}

pub(crate) fn images_below_test_part() -> Vec<&'static [u8]> {
    let below = BELOW_TEST_PART.lock();
    below.iter().map(|&(image, _)| image).collect()
}

pub(crate) fn is_module_below_test_part(path: &[u8]) -> bool {
    let below = BELOW_TEST_PART.lock();
    // The graph of a program that does not run knows its entry points alone. What they import is there as well: built again above, the file would run twice.
    let images: Vec<&'static [u8]> = below.iter().map(|&(image, _)| image).collect();
    below.iter().any(|(_, graph)| graph.is_source_file(path))
        || bun_jsc::compiled_program::images_hold_file(&images, path)
}

pub(crate) fn replaced_below_test_part() -> ReplacedByTests {
    REPLACED_BELOW_TEST_PART.lock().clone().unwrap_or_default()
}

const MARK_OF_WHAT_TESTS_REPLACE: &[u8; 8] = b"replaced";

/// A program that others are built above says behind its graph, and behind the check result, what its build took tests to replace.
fn append_what_tests_replace(after_graph: &mut Vec<u8>, replaced: &ReplacedByTests) {
    let bytes = replaced.to_bytes();
    after_graph.extend_from_slice(&bytes);
    after_graph.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    after_graph.extend_from_slice(MARK_OF_WHAT_TESTS_REPLACE);
}

fn split_off_what_tests_replace(after_graph: &[u8]) -> (&[u8], Option<ReplacedByTests>) {
    let split = || {
        let rest = after_graph.strip_suffix(MARK_OF_WHAT_TESTS_REPLACE)?;
        let (rest, length) = rest.split_last_chunk::<4>()?;
        let start = rest
            .len()
            .checked_sub(u32::from_le_bytes(*length) as usize)?;
        Some((&rest[..start], ReplacedByTests::from_bytes(&rest[start..])?))
    };
    match split() {
        Some((rest, replaced)) => (rest, Some(replaced)),
        None => (after_graph, None),
    }
}

/// How many test files a program holds, where `bun test --aot` was told to build more than one.
pub(crate) fn test_part_files(ctx: &ContextData) -> Option<u32> {
    // A process that runs test files starts a VM and the shared program, so it gets more than one file to run.
    const FILES_ABOVE_SHARED_PROGRAM: u32 = 16;
    let aot = ctx.bundler_options.aot.as_ref()?;
    let written = aot.test_run_part_files.map(|files| files.max(1));
    written.or_else(|| test_parts_share_a_program(ctx).then_some(FILES_ABOVE_SHARED_PROGRAM))
}

/// Whether this `bun test --aot` builds a program per part.
///
/// `reaches_much_source`: whether the test files and what they import are more than one program should hold. Asked last.
pub(crate) fn splits_test_files(
    ctx: &ContextData,
    file_count: usize,
    reaches_much_source: impl FnOnce() -> bool,
) -> bool {
    let Some(aot) = ctx.bundler_options.aot.as_ref() else {
        return false;
    };
    // Each program above the layers runs in a worker process, under the coordinator of `--parallel`. Without that flag plain
    // `bun test` runs every file in its own process: they share a global object unless `--isolate` is there, `process.exitCode`
    // is the command's, and the report is another runner's. So without it the test files are one program.
    let runs_in_workers = ctx.test_options.parallel > 0;
    // The word `TestRunLayers:1` or `TestRunLayers:2` brings layers whatever the flags are and however small the run is.
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty();
    let is_told_to_build_layers = test_run_layers(ctx) > 0
        && words.is_some_and(|words| {
            bun_core::strings::split(words, b",").any(|word| word.starts_with(b"TestRunLayers:"))
        });
    let is_told_to = aot.test_run_part_files.is_some() || is_told_to_build_layers;
    !builds_test_part()
        && !aot.checks_only
        && (runs_in_workers || is_told_to)
        && ctx.debug.hot_reload != HotReload::Watch
        && env_var::BUN_AOT_TEST_FILES_FROM_DISK.get() != Some(true)
        && (is_told_to_build_layers
            || test_part_files(ctx).is_some_and(|files| file_count > files as usize))
        // Layers are there for the memory that the build of one large program takes. The lowest holds all of Bun's own code, which
        // takes seconds to compile, so a small project is sooner built as one program.
        && (is_told_to || reaches_much_source())
}

/// With a word of `BUN_DEBUG_TEST_AOT_WORDS` that begins with `TestRun`, or with `BUN_JSC_logAOTPhaseTimes`: how this
/// `bun test --aot` is built, in one line. A test that means to test layers looks for it: the flags, the size of the project and
/// the platform all have a say in the form, and a run in another form passes as well.
pub(crate) fn log_form_of_test_run(ctx: &ContextData, file_count: usize, splits_files: bool) {
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty();
    let is_asked = words.is_some_and(|words| {
        bun_core::strings::split(words, b",").any(|word| word.starts_with(b"TestRun"))
    });
    if builds_test_part() || !(is_asked || env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true)) {
        return;
    }
    let files_to_a_program = test_part_files(ctx).unwrap_or(0);
    match (splits_files, test_run_layers(ctx)) {
        (false, _) if !cfg!(unix) || !Bun__AOT__takesImagesAboveOthers() => {
            bun_core::print_errorln!(
                "AOT test run | one program: this Bun loads one program a realm | test files {}",
                file_count,
            );
        }
        (false, _) => {
            bun_core::print_errorln!("AOT test run | one program | test files {}", file_count);
        }
        (true, 0) => bun_core::print_errorln!(
            "AOT test run | programs without layers: this Bun loads one program a realm | test files {} | to a program {}",
            file_count,
            files_to_a_program,
        ),
        (true, layers) => bun_core::print_errorln!(
            "AOT test run | layers {} | test files {} | to a program {}",
            layers,
            file_count,
            files_to_a_program,
        ),
    }
}

/// The test files of this part, which the process that started this one wrote where the program goes.
pub(crate) fn read_test_part() -> Vec<Box<[u8]>> {
    let descriptor = *TEST_PART_DESCRIPTOR.get().expect("builds a part");
    let mut list = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match bun_sys::pread(descriptor, &mut chunk, list.len() as i64) {
            Ok(0) => break,
            Ok(count) => list.extend_from_slice(&chunk[..count]),
            Err(error) => exit_write_failed(&error),
        }
    }
    bun_core::strings::split(&list, b"\0")
        .filter(|path| !path.is_empty())
        .map(Box::from)
        .collect()
}

fn hand_over(
    typed: &[&'static [u8]],
    own_count: usize,
    handover: Handover<'_>,
    original_cwd: Option<&[u8]>,
) -> ! {
    let Some(&descriptor) = TEST_PART_DESCRIPTOR.get() else {
        start_second_process(typed, own_count, handover, original_cwd)
    };
    log_step_of_build("the program is made");
    let written = bun_sys::ftruncate(descriptor, 0).and_then(|()| {
        write_to_empty_file(
            descriptor,
            [handover.bytes.unwrap_or_default(), handover.bytes_after],
        )
    });
    if let Err(error) = written {
        exit_write_failed(&error)
    }
    log_step_of_build("the program is written");
    Output::flush();
    exit_builder(match handover.flag {
        GRAPH_FLAG => 0,
        _ => PART_HAS_NO_PROGRAM,
    })
}

/// The file that a part's program is written to.
pub(crate) struct TestPartFile {
    pub(crate) descriptor: Fd,
    /// Windows has no unnamed files.
    #[cfg(windows)]
    path: ZBox,
}

impl TestPartFile {
    /// Holds the paths of the part's test files, until the process that builds it replaces them with the program.
    pub(crate) fn create<'p>(
        paths: impl Iterator<Item = &'p [u8]>,
        kind: TestPartKind,
    ) -> Maybe<TestPartFile> {
        let mut list = Vec::new();
        for path in paths {
            list.extend_from_slice(path);
            list.push(0);
        }
        #[cfg(unix)]
        return Ok(TestPartFile {
            descriptor: write_to_unnamed_file(
                &list,
                &[],
                match kind {
                    TestPartKind::TestFiles => ProgramFile::Memfd,
                    // Every process of the run maps it, to the end of the run, and reads some of it. Of a file on disk the system
                    // drops the pages that nobody reads when memory is short. Memory that stands in for a file it cannot drop.
                    TestPartKind::Shared | TestPartKind::SharedPackages => ProgramFile::Deleted,
                },
            )?,
        });
        #[cfg(windows)]
        {
            let _ = kind;
            let path = temporary_path(bun_resolver::fs::RealFS::tmpdir_path());
            let descriptor = write_to_named_file(&path, &list, &[])?;
            // SAFETY: `descriptor` is the open handle this function just made.
            unsafe {
                SetHandleInformation(
                    descriptor.native(),
                    HANDLE_FLAG_INHERIT,
                    HANDLE_FLAG_INHERIT,
                )
            };
            Ok(TestPartFile { descriptor, path })
        }
    }

    pub(crate) fn number_in_child(&self, on_unix: u32) -> usize {
        #[cfg(unix)]
        return on_unix as usize;
        #[cfg(windows)]
        {
            let _ = on_unix;
            self.descriptor.native() as usize
        }
    }
}

impl Drop for TestPartFile {
    fn drop(&mut self) {
        let _ = bun_sys::close(self.descriptor);
        #[cfg(windows)]
        let _ = bun_sys::unlinkat(Fd::cwd(), &self.path);
    }
}

/// What a process with `--aot-build-test-part` builds.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum TestPartKind {
    TestFiles,
    /// What the test files import, or what is left of it above the programs below.
    Shared,
    /// Of what the test files import, the files of packages, with all of Bun's own code.
    SharedPackages,
}

/// `below`: the numbers, in the process that builds, of the descriptors of the programs that it is built above, the lowest first.
/// `threads`: how many the build may use, unless it may use every processor.
pub(crate) fn test_part_arguments(
    descriptor: usize,
    kind: TestPartKind,
    below: core::ops::Range<usize>,
    threads: Option<u32>,
) -> Vec<Vec<u8>> {
    let typed = bun_core::argv()
        .into_iter()
        .skip(1 + bun_core::bun_options_argc());
    let mut flag = [TEST_PART_FLAG, descriptor.to_string().as_bytes()].concat();
    if kind != TestPartKind::TestFiles {
        flag.extend([b",", SHARED_BY_TEST_PARTS].concat());
    }
    if kind == TestPartKind::SharedPackages {
        flag.extend_from_slice(b",packages");
    }
    if let Some(threads) = threads {
        flag.extend(format!(",threads:{threads}").into_bytes());
    }
    for number in below {
        flag.extend(format!(",below:{number}").into_bytes());
    }
    let mut arguments = vec![flag];
    arguments.extend(typed.map(<[u8]>::to_vec));
    arguments
}

/// `below`: the numbers of the descriptors of the programs that the part's was built above, the lowest first.
pub(crate) fn image_flag_of_test_worker(
    has_program: bool,
    descriptor: usize,
    below: core::ops::Range<usize>,
) -> Vec<u8> {
    if !has_program {
        return [CHECKED_FLAG, descriptor.to_string().as_bytes()].concat();
    }
    // In the order in which they were built.
    let numbers: Vec<String> = below
        .chain([descriptor])
        .map(|number| number.to_string())
        .collect();
    [GRAPH_FLAG, numbers.join(",").as_bytes()].concat()
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
        for entry_point in entry_points {
            watched.add(entry_point);
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
        exit_builder(1)
    }
    decide_whether_to_clear_terminal();
    Output::flush();
    loop {
        std::thread::park();
    }
}

fn write_check_result(refused_files: &[u8], watched: Option<&WatchedFiles>) -> Vec<u8> {
    let mut result = refused_files.to_vec();
    result.push(0);
    let mut paths = watched.map_or_else(Vec::new, |watched| {
        core::mem::take(&mut *watched.paths.lock())
    });
    paths.sort_unstable();
    paths.dedup();
    for path in paths {
        result.extend_from_slice(&path);
        result.push(0);
    }
    result
}

/// The stand-in no longer names the files, so nothing of them is in the program: whoever loads one gets what the loader says of it.
/// A line of the stand-in is about one module: `import * as n7 from "<path>";`, `  sink(n7.a, n7.b);`, `  spyOn(n7, "a");`.
fn leave_out_of_stand_in(stand_in: &[u8], files: &[&[u8]]) {
    let Ok(text) = File::read_from(Fd::cwd(), stand_in) else {
        return;
    };
    let name_imported = |line: &[u8]| -> Option<Vec<u8>> {
        let rest = line.strip_prefix(b"import * as ")?;
        let (name, path) = rest.split_at(bun_core::strings::index_of_char_usize(rest, b' ')?);
        let path = path.strip_prefix(b" from \"")?.strip_suffix(b"\";")?;
        files.contains(&path).then(|| name.to_vec())
    };
    let lines = || bun_core::strings::split(&text, b"\n");
    let names: Vec<Vec<u8>> = lines().filter_map(name_imported).collect();
    let is_about = |line: &[u8], name: &[u8]| {
        [&b"import * as "[..], b"  sink(", b"  spyOn("]
            .iter()
            .any(|start| {
                let rest = line
                    .strip_prefix(*start)
                    .and_then(|rest| rest.strip_prefix(name));
                rest.is_some_and(|rest| !rest.first().is_some_and(u8::is_ascii_digit))
            })
    };
    let kept: Vec<&[u8]> = lines()
        .filter(|line| !names.iter().any(|name| is_about(line, name)))
        .collect();
    let _ = File::write_file(Fd::cwd(), &ZBox::from_bytes(stand_in), &kept.join(&b'\n'));
}

/// The positions, in ascending order, of the entry points that the others can run without.
fn find_refused_files(
    failure: &CompileFailure,
    independent_count: usize,
    stand_in: Option<usize>,
    may_refuse_all: bool,
) -> Option<Vec<usize>> {
    let CompileFailure::Build {
        refused_entry_points: Some(refused),
        ..
    } = failure
    else {
        return None;
    };
    let mut refused: Vec<usize> = refused.iter().map(|&position| position as usize).collect();
    refused.retain(|&position| Some(position) != stand_in);
    refused.sort_unstable();
    refused.dedup();
    let are_independent = refused.last().is_some_and(|&last| last < independent_count);
    (are_independent && (may_refuse_all || refused.len() < independent_count)).then_some(refused)
}

#[derive(Copy, Clone)]
struct Handover<'a> {
    flag: &'static [u8],
    bytes: Option<&'a [u8]>,
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
fn write_to_unnamed_file(bytes: &[u8], bytes_after: &[u8], first: ProgramFile) -> Maybe<Fd> {
    let mut first = match env_var::BUN_DEBUG_TEST_AOT_PROGRAM_FILE.get() {
        Some(b"shared-memory") => ProgramFile::SharedMemory,
        Some(b"deleted") => ProgramFile::Deleted,
        _ => first,
    };
    loop {
        let (descriptor, kind) = create_unnamed_file(first)?;
        let file = File::from_fd(descriptor);
        match write_to_empty_file(descriptor, [bytes, bytes_after]) {
            Ok(()) => return Ok(file.into_raw()),
            // Memory can be full where the disk is not.
            Err(_) if kind < ProgramFile::Deleted => first = ProgramFile::Deleted,
            Err(error) => return Err(error),
        }
    }
}

/// `parts`, one behind the other.
fn write_to_empty_file(descriptor: Fd, parts: [&[u8]; 2]) -> Maybe<()> {
    #[cfg(target_os = "linux")]
    if copy_into_mapping_of_empty_file(descriptor, parts) {
        return Ok(());
    }
    let mut position = 0;
    for mut bytes in parts {
        while !bytes.is_empty() {
            let count = bun_sys::pwrite(descriptor, bytes, position)?;
            bytes = &bytes[count..];
            position += count as i64;
        }
    }
    Ok(())
}

/// The run waits while a program of hundreds of megabytes is written. Threads that write to one file wait for each other. Threads
/// that copy into a mapping of it do not.
///
/// `false`: the file holds nothing that counts, and the caller writes it.
#[cfg(target_os = "linux")]
fn copy_into_mapping_of_empty_file(descriptor: Fd, parts: [&[u8]; 2]) -> bool {
    const MIN_BYTES: usize = 16 << 20;
    const MIN_BYTES_OF_THREAD: usize = 4 << 20;
    let length = parts[0].len() + parts[1].len();
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
    let (first, second) = mapped.split_at_mut(parts[0].len());
    std::thread::scope(|scope| {
        for (target, source) in [(first, parts[0]), (second, parts[1])] {
            for (target, source) in target.chunks_mut(share).zip(source.chunks(share)) {
                scope.spawn(move || target.copy_from_slice(source));
            }
        }
    });
    let _ = bun_sys::munmap(start, length);
    true
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
    let written = handover
        .bytes
        .map(|bytes| write_to_unnamed_file(bytes, handover.bytes_after, ProgramFile::Memfd));
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
    let Some(bytes) = handover.bytes else {
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
    let descriptors: Option<Vec<Fd>> = bun_core::strings::split(text, b",")
        .map(parse_descriptor)
        .collect();
    let Some(&[descriptor, ..]) = descriptors.as_deref() else {
        Output::err_generic(
            "--aot-graph-fd: \"{}\" is not a file descriptor",
            (BStr::new(text),),
        );
        Global::exit(1)
    };
    #[cfg(unix)]
    let loaded = match descriptors.as_deref() {
        Some(all @ [_, _, ..]) => Graph::from_descriptors(all),
        _ => Graph::from_descriptor(descriptor),
    };
    #[cfg(not(unix))]
    let loaded = Graph::from_descriptor(descriptor);
    let failure = match loaded {
        Ok(Some(_)) => {
            IS_FROM_DESCRIPTOR.store(true, Ordering::Relaxed);
            let _ = GRAPH_DESCRIPTOR.set(descriptor);
            // Behind each program: the refused files, an empty path, the files of the check.
            let (mut refused, mut checked) = (Vec::new(), Vec::new());
            for &descriptor in descriptors.as_deref().unwrap_or_default() {
                let after_graph = Graph::read_after_graph(descriptor).unwrap_or_default();
                let result = split_off_what_tests_replace(&after_graph).0;
                let mut paths = bun_core::strings::split(result, b"\0");
                for path in paths.by_ref().take_while(|path| !path.is_empty()) {
                    refused.extend_from_slice(path);
                    refused.push(0);
                }
                for path in paths.filter(|path| !path.is_empty()) {
                    checked.extend_from_slice(path);
                    checked.push(0);
                }
            }
            remember_check_result(&[refused, vec![0], checked].concat());
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

fn remember_check_result(list: &[u8]) {
    let mut paths = bun_core::strings::split(list, b"\0");
    let refused = paths.by_ref().take_while(|path| !path.is_empty());
    let _ = REFUSED_FILES.set(refused.map(Box::from).collect());
    let _ = FILES_OF_CHECK.set(
        paths
            .filter(|path| !path.is_empty())
            .map(Box::from)
            .collect(),
    );
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

pub(crate) fn is_refused(path: &[u8]) -> bool {
    REFUSED_FILES
        .get()
        .is_some_and(|files| files.iter().any(|file| &**file == path))
}

#[inline]
pub(crate) fn is_checked() -> bool {
    IS_CHECKED.load(Ordering::Relaxed)
}

unsafe extern "C" {
    safe fn Bun__AOT__listRefusedChanges();
    safe fn Bun__AOT__takesImagesAboveOthers() -> bool;
    #[cfg(unix)]
    safe fn Bun__AOT__peakResidentMegabytesOfProcess() -> usize;
}

pub(crate) fn list_refused_changes() {
    if is_checked() {
        Bun__AOT__listRefusedChanges();
    }
}

pub(crate) fn will_run_test_file(title: &[u8]) {
    if is_checked() {
        *RUNNING_TEST_FILE.lock() = title.to_vec();
    }
}

pub(crate) fn refused_changes() -> Vec<Vec<u8>> {
    core::mem::take(&mut *REFUSED_CHANGES.lock())
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__recordRefusedChange(
    refusal: &bun_core::String,
    source_url: &bun_core::String,
    line: u32,
    column: u32,
) {
    let path = source_url.to_owned_slice();
    let shown = bun_paths::resolve_path::relative(
        bun_resolver::fs::FileSystem::get().top_level_dir(),
        &path,
    );
    let shown = bun_core::strings::replace_owned(shown, &[bun_paths::SEP], b"/");
    let text = format!(
        "{}, at {}:{line}:{column}, while {} ran",
        BStr::new(&refusal.to_owned_slice()),
        BStr::new(&shown),
        BStr::new(&RUNNING_TEST_FILE.lock()[..]),
    )
    .into_bytes();
    let mut refused = REFUSED_CHANGES.lock();
    if refused.len() < MAX_LISTED_REFUSED_CHANGES && !refused.contains(&text) {
        refused.push(text);
    }
}

#[inline]
pub(crate) fn is_second_process() -> bool {
    runs_compiled_code() || is_checked() || builds_test_part()
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
