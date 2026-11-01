use core::num::NonZeroU32;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

use bstr::BStr;
use bun_bundler::bundle_v2::FileMap;
use bun_core::{Global, Output, ZBox, env_var};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::aot_options::HeapSize;
use bun_options_types::aot_options::ReadListener;
use bun_options_types::aot_options::ReplacedByTests;
use bun_options_types::context::{HotReload, TestGlobals};
use bun_options_types::schema::api::DotEnvBehavior;
use bun_standalone_graph::Graph;
use bun_standalone_graph::executable_request::{FirstProgramBelow, PlaceOfProgram};
use bun_sys::{Fd, File, Maybe, O};
use bun_threading::Guarded;
use bun_watcher::{ChangedFilePath, WatchEvent, WatchList, Watcher, WatcherContext};

use super::compile_command::{
    CompileFailure, CompileProduct, RequestOrigin, compile_from_context, exit_with_failure,
    print_failure, print_log,
};
use crate::cli::command::{Context, ContextData};
use crate::cli::test::memory_of_job;

static IS_FROM_DESCRIPTOR: AtomicBool = AtomicBool::new(false);
static IS_ONE_PROGRAM: AtomicBool = AtomicBool::new(false);
static GRAPH_DESCRIPTOR: OnceLock<Fd> = OnceLock::new();
static IS_CHECKED: AtomicBool = AtomicBool::new(false);
static REFUSED_FILES: OnceLock<Vec<(Box<[u8]>, Box<[u8]>)>> = OnceLock::new();
const SAID_OF_REFUSED_FILE: u8 = 1;
static FILES_OF_CHECK: OnceLock<Vec<Box<[u8]>>> = OnceLock::new();
static CLEARS_TERMINAL: AtomicBool = AtomicBool::new(false);
static RUNNING_TEST_FILE: Guarded<Vec<u8>> = Guarded::new(Vec::new());
static REFUSED_CHANGES: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
static NEWEST_REFUSAL_OF_RUNNING_TEST_FILE: Guarded<Vec<u8>> = Guarded::new(Vec::new());
const MAX_LISTED_REFUSED_CHANGES: usize = 100;
static CRASH_REPORT: OnceLock<&'static [u8]> = OnceLock::new();
/// What stands in for the files that use the program and that the build does not see.
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

/// The build reads the entry point at `path` from memory. As a file of the project it belonged to every run in the folder at once:
/// each layer has a text of its own, and one run's build read what another run had written for another layer.
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
    *STAND_IN.lock() = Some(Box::leak(Box::new(files)));
}

fn key_of_stand_in(path: &[u8]) -> Vec<u8> {
    let mut key = path.to_vec();
    if cfg!(windows) {
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut key);
    }
    // It lives as long as the build, which is the last thing the process does.
    key
}

fn make_stand_in_for_globals_of_vitest() -> Box<[u8]> {
    use bun_js_parser::Jest;
    let mut text = b"const value = process.argv.at(-1)!;\nif (value === \"\\0never\") {\n".to_vec();
    for name in (Jest::GLOBALS.iter()).filter(|name| !Jest::is_of_bun_only(name)) {
        text.extend_from_slice(b"  (globalThis as any).");
        text.extend_from_slice(name.as_bytes());
        text.extend_from_slice(b" = JSON.parse(value);\n");
    }
    text.extend_from_slice(b"}\n");
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
pub(crate) fn start(ctx: Context<'_>, entry_points: Vec<Box<[u8]>>, independent_count: usize) -> ! {
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
    if builds_what_test_parts_share() {
        entry_points[..independent_count].sort_unstable();
        if let Some(aot) = ctx.bundler_options.aot.as_mut() {
            aot.entry_points_only_imported_from_above.sort_unstable();
            aot.entry_points_required_from_above.sort_unstable();
        }
    }
    if has_globals_of_vitest {
        entry_points.push(make_stand_in_for_globals_of_vitest());
    }
    let mut independent_count = independent_count;
    let mut refused_count = 0;
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
                print_log(&said_before_the_build);
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
            .filter(|aot| aot.host_runs_files_from_disk)
            .and_then(|aot| aot.stand_in_for_files_from_disk.as_deref())
            .and_then(|path| entry_points.iter().position(|entry| **entry == *path));
        let Some(refused) = find_refused_files(&failure, independent_count, stand_in, !checks_only)
        else {
            // SAFETY: nothing else borrows the log behind a build.
            let log = unsafe { ctx.log_mut() };
            if !log.has_errors() {
                log.add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("the build failed"));
            }
            let target = &ctx.bundler_options.compile_target;
            print_log(&said_before_the_build);
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
        let said = list_errors(ctx.log_ref());
        for &position in refused.iter().rev() {
            if says_its_form() {
                let path = BStr::new(&entry_points[position]);
                bun_core::print_errorln!("AOT test run | refused | {}", path);
            }
            refused_files.extend_from_slice(&entry_points.remove(position));
            refused_files.push(SAID_OF_REFUSED_FILE);
            refused_files.extend_from_slice(&said);
            refused_files.push(0);
        }
        independent_count -= refused.len();
        refused_count += refused.len();
        // With no file left to run there is no program to build. Each file fails by itself, as under `bun test`.
        if checks_only || independent_count == 0 {
            let check_result = write_check_result(&refused_files, watched, &[]);
            let handover = Handover {
                flag: CHECKED_FLAG,
                bytes: Some(&check_result),
                bytes_after: &[],
            };
            log_what_is_handed_over(ctx, independent_count, refused_count, handover);
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
    if aot.is_some_and(|aot| aot.is_part_of_test_files)
        && env_var::BUN_JSC_logAOTPhaseTimes.get() != Some(true)
    {
        // SAFETY: nothing else borrows the log behind a build.
        let messages = &mut unsafe { ctx.log_mut() }.msgs;
        messages.retain(|message| !is_said_about_types(&message.data.text));
    }
    print_log(ctx.log_ref());
    let names_added: &[(u32, Vec<u8>)] = match outcome.graph_bytes {
        Some(_) => &[],
        None => &outcome.replaced_builtins.names_added_to_builtins,
    };
    let mut check_result =
        (watched.is_some() || !refused_files.is_empty() || !names_added.is_empty())
            .then(|| write_check_result(&refused_files, watched, names_added));
    if builds_what_test_parts_share() && outcome.graph_bytes.is_some() {
        // The build ends with more built-ins than it was told of. The exports and modules are those that it was told of.
        let told = ctx
            .bundler_options
            .aot
            .as_ref()
            .map(|aot| &aot.replaced_by_tests);
        // What the programs below said about their parameters holds for whoever is built above this one too.
        let mut parameters_that_start_workers =
            (outcome.replaced_builtins.parameters_that_start_workers).clone();
        if let Some(told) = told {
            parameters_that_start_workers.extend_from_slice(&told.parameters_that_start_workers);
        }
        parameters_that_start_workers.sort_unstable();
        parameters_that_start_workers.dedup();
        // A spy of a package below may meet what a test file hands on.
        let spies_on_unknown_objects = outcome.replaced_builtins.spies_on_unknown_objects
            || told.is_some_and(|told| told.spies_on_unknown_objects);
        let mut names_spied_on_unknown_objects =
            (outcome.replaced_builtins.names_spied_on_unknown_objects).clone();
        if let Some(told) = told {
            names_spied_on_unknown_objects.extend_from_slice(&told.names_spied_on_unknown_objects);
        }
        names_spied_on_unknown_objects.sort_unstable();
        names_spied_on_unknown_objects.dedup();
        let replaced = ReplacedByTests {
            builtins: outcome.replaced_builtins.builtins.clone(),
            names_added_to_builtins: outcome.replaced_builtins.names_added_to_builtins.clone(),
            parameters_that_start_workers,
            stores_loader_functions: outcome.replaced_builtins.stores_loader_functions
                || told.is_some_and(|told| told.stores_loader_functions),
            evicts_any_module: outcome.replaced_builtins.evicts_any_module
                || told.is_some_and(|told| told.evicts_any_module),
            any_module: outcome.replaced_builtins.any_module
                || told.is_some_and(|told| told.any_module),
            spies_on_unknown_objects,
            names_spied_on_unknown_objects,
            spy_may_meet_module_that_no_file_spells: told.is_some_and(|told| {
                told.spy_may_meet_module_that_no_file_spells
                    || (spies_on_unknown_objects && told.hands_on_any_module)
            }),
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
    log_what_is_handed_over(ctx, independent_count, refused_count, handover);
    hand_over(&typed, own_count, handover, ctx.original_cwd.as_deref())
}

fn log_what_is_handed_over(
    ctx: &ContextData,
    compiled: usize,
    refused: usize,
    handover: Handover<'_>,
) {
    let aot = ctx.bundler_options.aot.as_ref();
    if !says_its_form() || !aot.is_some_and(|aot| aot.runs_tests) {
        return;
    }
    let are_test_files = !builds_what_test_parts_share()
        && aot.is_some_and(|aot| aot.main_modules_beside_entry_points.is_empty());
    let kind = match are_test_files {
        true => "test files",
        false => "files below the test files",
    };
    let bytes = handover.bytes.unwrap_or_default();
    match handover.flag {
        GRAPH_FLAG => bun_core::print_errorln!(
            "AOT test run | the program | {} compiled {} | refused {} | {} bytes | hash {:016x}",
            kind,
            compiled,
            refused,
            bytes.len(),
            bun_wyhash::hash(bytes),
        ),
        _ => bun_core::print_errorln!("AOT test run | no program | {} refused {}", kind, refused),
    }
}

/// How a process with `--aot-build-test-part` tells that it has checked the files and made no program. 0 is a program, and any other exit status a failed build.
pub(crate) const PART_HAS_NO_PROGRAM: u32 = 3;
/// The build began beside the build of the program below and guessed wrongly what that would hold. It is started again, above the program.
pub(crate) const PART_IS_BUILT_AGAIN: u32 = 4;
pub(crate) const PART_HAS_NO_ROOM: u32 = 5;
/// Whether a program can wait in memory in place of a file of the temporary directory: `ProgramFile`.
pub(crate) const PROGRAMS_CAN_WAIT_IN_MEMORY: bool = cfg!(any(
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd"
));
static TEST_PART_DESCRIPTOR: OnceLock<Fd> = OnceLock::new();
/// The programs that the part is built above, the first of them first.
static BELOW_TEST_PART: Guarded<Vec<(&'static [u8], &'static Graph)>> = Guarded::new(Vec::new());
static ROOM_BELOW_TEST_PART: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(0);
static FIRST_BELOW_TEST_PART: OnceLock<(&'static [u8], Fd, u64)> = OnceLock::new();
/// What the build of the last of them was told and found that tests replace.
static REPLACED_BELOW_TEST_PART: Guarded<Option<ReplacedByTests>> = Guarded::new(None);
/// The last of the programs below, while it is still being built.
#[cfg(unix)]
static STILL_BUILT_BELOW: Guarded<Option<StillBuiltBelow>> = Guarded::new(None);
static BEGINS_BESIDE_BUILD_BELOW: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
struct StillBuiltBelow {
    /// Where its build writes it.
    program: Fd,
    /// `bun test` writes a byte here when that build has ended: "1" with a program, "0" without. It writes none where the build failed.
    ended: Fd,
    /// The files that it will hold, as far as this build can tell.
    guess: std::collections::BTreeSet<Box<[u8]>>,
    /// What this build has asked about and no program that is there holds.
    asked: std::collections::BTreeSet<Box<[u8]>>,
}
static BUILDS_WHAT_TEST_PARTS_SHARE: AtomicBool = AtomicBool::new(false);
static BUILDS_PACKAGES_ALONE: AtomicBool = AtomicBool::new(false);
static BUILDS_LIBRARY_ALONE: AtomicBool = AtomicBool::new(false);
static BUILDS_REFERENCE_LIBRARY: AtomicBool = AtomicBool::new(false);
static REFERENCE_LIBRARY_IMAGE: Guarded<Option<&'static [u8]>> = Guarded::new(None);
/// The first of `BELOW_TEST_PART` is the library that this Bun holds compiled.
static IS_ABOVE_LIBRARY_OF_THIS_BUN: AtomicBool = AtomicBool::new(false);
static BUILDS_WHAT_COMPUTED_IMPORTS_REACH: AtomicBool = AtomicBool::new(false);
/// Not 0: of what the test files share and no program below holds, the build takes the lowest files: one part in so many.
static LOWEST_PART_IN: AtomicU32 = AtomicU32::new(0);
static THREADS_OF_TEST_PART: AtomicU32 = AtomicU32::new(0);
static MEGABYTES_THAT_BUILD_MAY_TAKE: AtomicU32 = AtomicU32::new(0);
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
        } else if word == b"library" {
            BUILDS_LIBRARY_ALONE.store(true, Ordering::Relaxed);
        } else if word == b"reference-build" {
            BUILDS_REFERENCE_LIBRARY.store(true, Ordering::Relaxed);
        } else if word == b"computed" {
            BUILDS_WHAT_COMPUTED_IMPORTS_REACH.store(true, Ordering::Relaxed);
        } else if let Some(parts) = word.strip_prefix(b"lowest-in:") {
            let parts = bun_core::fmt::parse_int::<u32>(parts, 10).unwrap_or(0);
            LOWEST_PART_IN.store(parts, Ordering::Relaxed);
        } else if let Some(megabytes) = word.strip_prefix(b"may-take:") {
            let megabytes = bun_core::fmt::parse_int::<u32>(megabytes, 10).unwrap_or(0);
            MEGABYTES_THAT_BUILD_MAY_TAKE.store(megabytes, Ordering::Relaxed);
        } else if let Some(count) = word.strip_prefix(b"threads:") {
            let count = bun_core::fmt::parse_int::<u32>(count, 10).unwrap_or(0);
            THREADS_OF_TEST_PART.store(count, Ordering::Relaxed);
        } else {
            #[cfg(unix)]
            {
                if let Some(numbers) = word.strip_prefix(b"later:") {
                    let numbers = bun_core::strings::split_once_char(numbers, b':');
                    let descriptors = numbers.and_then(|(program, ended)| {
                        Some((parse_descriptor(program)?, parse_descriptor(ended)?))
                    });
                    let Some((program, ended)) = descriptors else {
                        Output::err_generic(
                            "--aot-build-test-part: \"{}\" names no two file descriptors",
                            (BStr::new(word),),
                        );
                        Global::exit(1)
                    };
                    BEGINS_BESIDE_BUILD_BELOW.store(true, Ordering::Relaxed);
                    *STILL_BUILT_BELOW.lock() = Some(StillBuiltBelow {
                        program,
                        ended,
                        guess: Default::default(),
                        asked: Default::default(),
                    });
                    continue;
                }
                let colon = bun_core::strings::index_of_char_usize(word, b':');
                let number = || parse_descriptor(&word[colon? + 1..]);
                let Some((image, graph, offset)) =
                    number().and_then(Graph::read_image_and_its_offset)
                else {
                    Output::err_generic(
                        "--aot-build-test-part: the program in \"{}\" could not be read",
                        (BStr::new(word),),
                    );
                    Global::exit(1)
                };
                if word.starts_with(b"reference:") {
                    *REFERENCE_LIBRARY_IMAGE.lock() = Some(image);
                    continue;
                }
                BELOW_TEST_PART.lock().push((image, graph));
                note_program_below(number(), image, offset);
                // The library that this Bun holds was built for every run, so it says nothing about this one.
                if word.starts_with(b"library:") {
                    IS_ABOVE_LIBRARY_OF_THIS_BUN.store(true, Ordering::Relaxed);
                    continue;
                }
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
    // So does a build that begins beside the build of the program below, which the run waits for first. When that has ended this
    // one is alone.
    #[cfg(unix)]
    if (!builds_what_test_parts_share() && !BELOW_TEST_PART.lock().is_empty())
        || begins_beside_build_below()
    {
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

/// With `BUN_JSC_logAOTPhaseTimes`: how long after the process that runs the tests began it has come this far. The builders time
/// themselves. This is for what lies in front of the first build, between two builds, and behind the last one up to the first result.
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
                (true, _) if builds_library_alone() => "Bun's own code",
                (true, true) => "the packages that test files share",
                (true, false) if builds_what_computed_imports_reach() =>
                    "what computed imports reach",
                (true, false) if percent_of_files_that_go_lowest().is_some() =>
                    "the lowest of what test files share",
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
        let may_take = u64::from(MEGABYTES_THAT_BUILD_MAY_TAKE.load(Ordering::Relaxed));
        if may_take != 0 {
            let took = Bun__AOT__peakResidentMegabytesOfProcess() as u64;
            bun_core::print_errorln!(
                "AOT part build | the plan said that it may take {} MB | most resident {} MB: {} percent of that",
                may_take,
                took,
                took * 100 / may_take,
            );
        }
    }
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
/// builder and every worker.
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
            (Bun__AOT__peakResidentMegabytesOfProcess() as u64).max(record_peak_rss_kb(0) / 1024),
        );
        Output::flush();
    }
    #[cfg(not(unix))]
    let _ = who;
}

fn exit_builder(exit_code: u32) -> ! {
    log_cost_of_build();
    // Which layer is in the line above.
    log_account_of_process(format_args!(
        "builder of {}",
        match builds_what_test_parts_share() {
            true => "a layer",
            false => "test files",
        }
    ));
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

fn number_behind_word(prefix: &[u8]) -> Option<u32> {
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty()?;
    let mut words = bun_core::strings::split(words, b",");
    let digits = words.find_map(|word| word.strip_prefix(prefix))?;
    bun_core::fmt::parse_int::<u32>(digits, 10).ok()
}

pub(crate) fn test_run_layers(ctx: &ContextData) -> u32 {
    if !test_parts_share_a_program(ctx) {
        return 0;
    }
    number_behind_word(b"TestRunLayers:").map_or(2, |layers| layers.max(1))
}

pub(crate) fn is_number_of_layers_given() -> bool {
    number_behind_word(b"TestRunLayers:").is_some()
}

pub(crate) const BYTES_HELD_WHEN_MODULES_ARE_BOUND: u64 = 13;
const BYTES_HELD_FOR_A_BYTE_COMPILED_ABOVE_PACKAGES: u64 = 9;
const BYTES_HELD_BY_ANY_BUILD: u64 = 150 << 20;
const PERCENT_OF_MEMORY_THAT_IS_PLANNED_FOR: u64 = 93;
const MOST_PROGRAMS_OF_PROJECT: u32 = 4;

pub(crate) fn plan_programs_of_project(memory_limit: Option<u64>, bytes_of_project: u64) -> u32 {
    let memory = memory_of_job::find(memory_limit);
    let planned_for = memory / 100 * PERCENT_OF_MEMORY_THAT_IS_PLANNED_FOR;
    let estimate = |programs: u32| {
        BYTES_HELD_BY_ANY_BUILD
            + bytes_of_project * BYTES_HELD_WHEN_MODULES_ARE_BOUND
            + bytes_of_project.div_ceil(u64::from(programs))
                * BYTES_HELD_FOR_A_BYTE_COMPILED_ABOVE_PACKAGES
    };
    let least = estimate(MOST_PROGRAMS_OF_PROJECT);
    let programs = (1..MOST_PROGRAMS_OF_PROJECT)
        .find(|&programs| estimate(programs) <= planned_for.max(least + least / 20))
        .unwrap_or(MOST_PROGRAMS_OF_PROJECT);
    MEGABYTES_THAT_BUILD_MAY_TAKE.store((estimate(programs) >> 20) as u32, Ordering::Relaxed);
    log_step_of_test_run(format_args!(
        "the layers are planned: the files of the project hold {} KB | as one program they may take {} MB | the run can get {} MB and plans for {} | {} programs, each may take {} MB",
        bytes_of_project >> 10,
        estimate(1) >> 20,
        memory >> 20,
        planned_for >> 20,
        programs,
        estimate(programs) >> 20,
    ));
    programs
}

/// The files of packages that only an import with a computed name reaches, `import(`a/b/${name}.js`)`, are a program of their own,
/// over the packages and under the files of the project. There can be thousands behind one import. The word
/// `TestRunComputedLayer:0` leaves them to the program that holds the import.
pub(crate) fn test_run_has_layer_of_computed_imports(ctx: &ContextData) -> bool {
    test_run_layers(ctx) > 1 && number_behind_word(b"TestRunComputedLayer:") != Some(0)
}

/// The word `TestRunNamesPackages:1`, with BUN_AOT_TESTS_NAME_WHAT_THEY_USE.
pub(crate) fn packages_are_told_what_is_used() -> bool {
    number_behind_word(b"TestRunNamesPackages:") == Some(1)
}

pub(crate) fn builds_what_computed_imports_reach() -> bool {
    BUILDS_WHAT_COMPUTED_IMPORTS_REACH.load(Ordering::Relaxed)
}

/// The build of the layer above that one begins beside it: see `begins_beside_build_below`. With the word
/// `TestRunLayersBuiltAlone`, for measuring, every layer is built with nothing beside it.
pub(crate) fn test_run_builds_layers_side_by_side() -> bool {
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty();
    !words.is_some_and(|words| {
        bun_core::strings::split(words, b",").any(|word| word == b"TestRunLayersBuiltAlone")
    })
}

/// The build has nothing to compile. What is built above does without its program.
pub(crate) fn exit_without_program() -> ! {
    Output::flush();
    exit_builder(PART_HAS_NO_PROGRAM)
}

/// For a build that takes the lowest of the files that no program below holds: how much of them, by the bytes of their texts.
/// The word `TestRunLowestPercent:<n>` says otherwise than the number of programs that are still to come.
pub(crate) fn percent_of_files_that_go_lowest() -> Option<u32> {
    let parts = NonZeroU32::new(LOWEST_PART_IN.load(Ordering::Relaxed))?;
    let even_share = 100 / parts;
    let written = number_behind_word(b"TestRunLowestPercent:");
    Some(written.map_or(even_share, |percent| percent.min(100)))
}

/// Of what the test files share, the files of packages are a program of their own, which is built first.
pub(crate) fn builds_packages_alone() -> bool {
    BUILDS_PACKAGES_ALONE.load(Ordering::Relaxed)
}

/// Bun's own code and nothing else, for every test run of this Bun: no project is known. A step of Bun's build asks for it.
pub(crate) fn builds_library_alone() -> bool {
    BUILDS_LIBRARY_ALONE.load(Ordering::Relaxed)
}

pub(crate) fn builds_reference_library() -> bool {
    BUILDS_REFERENCE_LIBRARY.load(Ordering::Relaxed)
}

pub(crate) fn reference_library_image() -> Option<&'static [u8]> {
    *REFERENCE_LIBRARY_IMAGE.lock()
}

/// Whether a program of this run lies below: one whose build knew the files of the run.
pub(crate) fn is_above_program_of_run() -> bool {
    let library = usize::from(is_above_library_of_this_bun());
    BELOW_TEST_PART.lock().len() > library
}

pub(crate) fn is_above_library_of_this_bun() -> bool {
    IS_ABOVE_LIBRARY_OF_THIS_BUN.load(Ordering::Relaxed)
}

/// Bun's own code, compiled when this Bun was built (`compiledLibrary` of scripts/build/config.ts): a section of the executable
/// that no segment holds, compressed. Nothing reads it until a test run is built in layers: it is the lowest of them.
/// `None`: this Bun was built without it, and the lowest layer of each run holds that code.
#[cfg(unix)]
fn read_library_of_this_bun(reads_bytes: bool) -> Option<Vec<u8>> {
    use bun_exe_format::image::KnownSection;
    use bun_exe_format::section::find_known_section;
    let path = bun_core::self_exe_path().ok()?;
    let read = bun_standalone_graph::with_executable_image(path, |file| {
        let section = find_known_section(file, KnownSection::CompiledLibrary).ok()?;
        let size = if reads_bytes { section.size } else { 0 };
        let mut bytes = vec![0; size as usize];
        (file.read)(section.file_offset as usize, &mut bytes).then_some(bytes)
    });
    read.ok()?
}

/// Whether the layers of this run stand on the library that this Bun holds compiled. That was compiled as a run without any
/// option for the compiler compiles it.
pub(crate) fn stands_on_library_of_this_bun(ctx: &ContextData) -> bool {
    let Some(aot) = ctx.bundler_options.aot.as_ref() else {
        return false;
    };
    let is_compiled_as_always = aot.heap == HeapSize::Standard
        && !aot.reports_type_mismatches
        && aot.option_words.is_empty();
    #[cfg(unix)]
    {
        static HOLDS: OnceLock<bool> = OnceLock::new();
        test_run_layers(ctx) > 0
            && is_compiled_as_always
            && *HOLDS.get_or_init(|| read_library_of_this_bun(false).is_some())
    }
    #[cfg(not(unix))]
    {
        let _ = is_compiled_as_always;
        false
    }
}

/// In a file of its own, as a layer that the run builds is.
#[cfg(unix)]
pub(crate) fn unpack_library_of_this_bun() -> Option<TestPartFile> {
    let section = read_library_of_this_bun(true)?;
    let unpack = || {
        // Two thirds of the program are zeros in one piece, the room for what the programs above bring. The section leaves them
        // out: how many bytes lie in front of them, how many they are, and the rest, compressed.
        let (before, behind) = section.split_first_chunk::<8>()?;
        let (zeros, compressed) = behind.split_first_chunk::<8>()?;
        let (before, zeros) = (u64::from_le_bytes(*before), u64::from_le_bytes(*zeros));
        let rest = bun_zstd::decompress_alloc(compressed).ok()?;
        let (first, second) = rest.split_at_checked(usize::try_from(before).ok()?)?;
        let (descriptor, _) = create_unnamed_file(ProgramFile::Deleted).ok()?;
        let file = TestPartFile { descriptor };
        // A file has zeros where nothing was written.
        let behind_zeros = i64::try_from(before.checked_add(zeros)?).ok()?;
        bun_sys::ftruncate(descriptor, behind_zeros + second.len() as i64).ok()?;
        let written = File::borrow(&descriptor);
        written.pwrite_all(first, 0).ok()?;
        written.pwrite_all(second, behind_zeros).ok()?;
        Some(file)
    };
    let Some(file) = unpack() else {
        Output::err_generic(
            "Bun's own code, which this executable holds compiled, could not be unpacked",
            (),
        );
        Global::exit(1)
    };
    log_step_of_build("Bun's own code is unpacked");
    Some(file)
}

#[cfg(unix)]
fn note_program_below(descriptor: Option<Fd>, image: &'static [u8], offset: u64) {
    let size = descriptor.and_then(|descriptor| bun_sys::get_file_size(descriptor).ok());
    let room = Graph::room_of_program(size.unwrap_or(0) as usize);
    ROOM_BELOW_TEST_PART.fetch_add(room, Ordering::Relaxed);
    if let Some(file) = descriptor {
        let _ = FIRST_BELOW_TEST_PART.set((image, file, offset));
    }
}

pub(crate) fn place_of_program_being_built() -> Option<PlaceOfProgram<'static>> {
    let mapped_at = Graph::address_of_program(ROOM_BELOW_TEST_PART.load(Ordering::Relaxed))?;
    let first_below = FIRST_BELOW_TEST_PART
        .get()
        .filter(|_| builds_what_test_parts_share());
    Some(PlaceOfProgram {
        mapped_at,
        first_below: first_below.map(|&(image, file, offset)| FirstProgramBelow {
            image,
            file,
            offset,
        }),
    })
}

pub(crate) fn images_below_test_part() -> Vec<&'static [u8]> {
    let below = BELOW_TEST_PART.lock();
    below.iter().map(|&(image, _)| image).collect()
}

pub(crate) fn is_module_below_test_part(path: &[u8]) -> bool {
    if is_module_of_program_that_is_there(path) {
        return true;
    }
    #[cfg(unix)]
    return STILL_BUILT_BELOW
        .lock()
        .as_mut()
        .is_some_and(|still_built| {
            if !still_built.asked.contains(path) {
                still_built.asked.insert(Box::from(path));
            }
            still_built.guess.contains(path)
        });
    #[cfg(not(unix))]
    false
}

/// The process was started while the program right below its own was still being built. Of that program a front end needs to know
/// which files it holds, and nothing else until it hands its work to the engine. So this build guesses them, loads and binds its
/// files beside the other build, on processors that would idle, and waits where it would take much memory. Then it looks at the
/// program. Where that holds what was guessed, nothing was lost, and where not, `bun test` starts this build again, no later than
/// it would have started it.
pub(crate) fn begins_beside_build_below() -> bool {
    BEGINS_BESIDE_BUILD_BELOW.load(Ordering::Relaxed)
}

/// `files`: what the program that is still being built will hold. What was asked before counts for nothing.
pub(crate) fn guess_what_program_below_holds(files: Vec<Box<[u8]>>) {
    #[cfg(unix)]
    if let Some(still_built) = STILL_BUILT_BELOW.lock().as_mut() {
        still_built.guess = files.into_iter().collect();
        still_built.asked.clear();
    }
    #[cfg(not(unix))]
    drop(files);
}

/// `ImagesBelow::wait_for_all`
pub(crate) fn wait_for_program_below() -> Vec<&'static [u8]> {
    #[cfg(unix)]
    if let Some(still_built) = STILL_BUILT_BELOW.lock().take() {
        wait_for(&still_built);
    }
    images_below_test_part()
}

#[cfg(unix)]
fn wait_for(still_built: &StillBuiltBelow) {
    log_step_of_build("it waits for the program below");
    let mut answer = [0u8; 1];
    let has_program = loop {
        match bun_sys::read(still_built.ended, &mut answer) {
            Ok(1) => break answer[0] == b'1',
            Err(error) if error.get_errno() == bun_sys::E::EINTR => {}
            // The build below failed, or `bun test` is gone: nobody waits for this program. Or that build is started again, with
            // another file to write to than the one that this build holds: then so is this one.
            Ok(_) => exit_builder(PART_IS_BUILT_AGAIN),
            Err(error) => {
                Output::err(
                    error,
                    "--aot-build-test-part: how the build of the program below ended could not be read",
                    (),
                );
                Output::flush();
                exit_builder(1)
            }
        }
    };
    log_step_of_build("the program below is there");
    let mut is_as_guessed = true;
    if has_program {
        let Some((image, graph, offset)) = Graph::read_image_and_its_offset(still_built.program)
        else {
            Output::err_generic(
                "--aot-build-test-part: the program below could not be read",
                (),
            );
            Output::flush();
            exit_builder(1)
        };
        BELOW_TEST_PART.lock().push((image, graph));
        note_program_below(Some(still_built.program), image, offset);
        let after = Graph::read_after_graph(still_built.program).unwrap_or_default();
        let (_, replaced) = split_off_what_tests_replace(&after);
        // This build was told what the program under that one ends with.
        is_as_guessed = replaced == *REPLACED_BELOW_TEST_PART.lock();
    }
    let differing = (still_built.asked.iter())
        .filter(|path| {
            is_module_of_program_that_is_there(path) != still_built.guess.contains(*path)
        })
        .count();
    if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
        Output::flush();
        bun_core::print_errorln!(
            "AOT part build | began beside the build below | files guessed {} | files asked about {} | answered otherwise by the program {} | it ends with what tests replace as it began {}",
            still_built.guess.len(),
            still_built.asked.len(),
            differing,
            is_as_guessed,
        );
        Output::flush();
    }
    if differing > 0 || !is_as_guessed {
        Output::flush();
        exit_builder(PART_IS_BUILT_AGAIN)
    }
}

fn is_module_of_program_that_is_there(path: &[u8]) -> bool {
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
    // Each program above the layers has a process of its own. Without `--parallel`, which gives every file a global object of its own,
    // and without `--isolate` the test files share one, so they are one program. Only a word brings layers to such a run: splits_test_files().
    let share_global_object = ctx.test_options.parallel <= 1 && !ctx.test_options.isolate;
    let files = match share_global_object {
        true => u32::MAX,
        false => FILES_ABOVE_SHARED_PROGRAM,
    };
    written.or_else(|| test_parts_share_a_program(ctx).then_some(files))
}

/// Whether this `bun test --aot` builds a program per part.
///
/// `reach_more_source_than`: whether the test files and what they import hold more bytes of source. Asked last.
pub(crate) fn splits_test_files(
    ctx: &ContextData,
    reach_more_source_than: impl FnOnce(u64) -> bool,
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
        && test_part_files(ctx).is_some()
        // Several programs are there for the memory that the build of one large program takes, and for nothing else: they are
        // never sooner done, and a small run loses seconds (what the test files share has to be open to whatever they may do
        // with it, and the lowest layer holds all of Bun's own code). So a run is one program where the build of that fits into
        // the memory that the run can get.
        && (is_told_to || reach_more_source_than(source_that_fits_in_memory(ctx)))
}

/// How many bytes of source a program may hold for its build to fit into the memory that this `bun test --aot` can get.
pub(crate) fn source_that_fits_in_memory(ctx: &ContextData) -> u64 {
    memory_of_job::find(ctx.test_options.aot_memory_limit) / BYTES_HELD_FOR_A_BYTE_OF_SOURCE
}

/// What a build holds at its highest for each byte of source that it compiles: the most that was measured, since a guess that is
/// too low ends with the system killing the build. On a large application (10-30): its packages 40 (4.09 GB for 102 MB), its own
/// files 24, everything with the test files as one program 31 (10.3 GB for 334 MB). It falls as the compiler's memory does.
pub(crate) const BYTES_HELD_FOR_A_BYTE_OF_SOURCE: u64 = 40;

fn says_its_form() -> bool {
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty();
    let is_asked = words.is_some_and(|words| {
        bun_core::strings::split(words, b",").any(|word| word.starts_with(b"TestRun"))
    });
    is_asked || env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true)
}

/// With a word of `BUN_DEBUG_TEST_AOT_WORDS` that begins with `TestRun`, or with `BUN_JSC_logAOTPhaseTimes`: how this
/// `bun test --aot` is built, in one line. A test that means to test layers looks for it: the flags, the size of the project and
/// the platform all have a say in the form, and a run in another form passes as well.
pub(crate) fn log_form_of_test_run(ctx: &ContextData, file_count: usize, splits_files: bool) {
    if builds_test_part() || !says_its_form() {
        return;
    }
    let files_to_a_program = test_part_files(ctx).unwrap_or(0).min(file_count as u32);
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
            "AOT test run | layers {} | test files {} | to a program {}{}{}",
            layers,
            file_count,
            files_to_a_program,
            match test_run_has_layer_of_computed_imports(ctx) {
                true => " | and a layer for what computed imports reach",
                false => "",
            },
            match stands_on_library_of_this_bun(ctx) {
                true => " | over Bun's own code as this Bun holds it",
                false => "",
            },
        ),
    }
}

static LISTS_FOR_BUILDS_OF_LAYERS: Guarded<Vec<u8>> = Guarded::new(Vec::new());
static LISTS_HANDED_BY_RUN: Guarded<Option<Vec<Vec<Box<[u8]>>>>> = Guarded::new(None);

pub(crate) fn hand_lists_to_builds_of_layers(lists: &[&[Box<[u8]>]]) {
    let mut written = Vec::new();
    for list in lists {
        for entry in *list {
            written.extend_from_slice(entry);
            written.push(0);
        }
        written.push(0);
    }
    *LISTS_FOR_BUILDS_OF_LAYERS.lock() = written;
}

pub(crate) fn take_lists_handed_by_run() -> Option<Vec<Vec<Box<[u8]>>>> {
    let words = env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty();
    let reads_itself = words.is_some_and(|words| {
        bun_core::strings::split(words, b",").any(|word| word == b"TestRunBuildsReadTheProject")
    });
    LISTS_HANDED_BY_RUN.lock().take().filter(|_| !reads_itself)
}

pub(crate) fn read_test_part() -> Vec<Box<[u8]>> {
    let descriptor = *TEST_PART_DESCRIPTOR.get().expect("builds a part");
    let mut list = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        match bun_sys::pread(descriptor, &mut chunk, list.len() as i64) {
            Ok(0) => break,
            Ok(count) => list.extend_from_slice(&chunk[..count]),
            Err(error) => exit_write_failed(&error),
        }
    }
    let mut lists: Vec<Vec<Box<[u8]>>> = vec![Vec::new()];
    let mut rest = &list[..];
    while let Some(end) = bun_core::strings::index_of_char_usize(rest, 0) {
        match end {
            0 => lists.push(Vec::new()),
            _ => lists
                .last_mut()
                .expect("never empty")
                .push(Box::from(&rest[..end])),
        }
        rest = &rest[end + 1..];
    }
    let test_files = lists.remove(0);
    if !lists.is_empty() {
        lists.pop();
        *LISTS_HANDED_BY_RUN.lock() = Some(lists);
    }
    test_files
}

fn hand_over(
    typed: &[&'static [u8]],
    own_count: usize,
    handover: Handover<'_>,
    original_cwd: Option<&[u8]>,
) -> ! {
    let Some(&descriptor) = TEST_PART_DESCRIPTOR.get() else {
        if let Some(loader) =
            bun_dotenv::instance().filter(|_| !HAS_HANDED_ON_ENVIRONMENT.load(Ordering::Relaxed))
        {
            // SAFETY: this is the main thread, the only one that has the loader.
            hand_on_environment(unsafe { &(*loader).map });
        }
        start_second_process(typed, own_count, handover, original_cwd)
    };
    log_step_of_build("the program is made");
    if env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
        let bytes = handover.bytes.unwrap_or_default();
        bun_core::print_errorln!(
            "AOT part build | the program | {} bytes | hash {:016x}",
            bytes.len(),
            bun_wyhash::hash(bytes),
        );
    }
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
    /// `in_memory`: the temporary directory has had no room for a program of this run.
    pub(crate) fn create<'p>(
        paths: impl Iterator<Item = &'p [u8]>,
        kind: TestPartKind,
        in_memory: bool,
    ) -> Maybe<TestPartFile> {
        let mut list = Vec::new();
        for path in paths {
            list.extend_from_slice(path);
            list.push(0);
        }
        if !matches!(kind, TestPartKind::TestFiles | TestPartKind::SharedPackages) {
            let lists = LISTS_FOR_BUILDS_OF_LAYERS.lock();
            if !lists.is_empty() {
                list.push(0);
                list.extend_from_slice(&lists);
            }
        }
        #[cfg(unix)]
        return Ok(TestPartFile {
            descriptor: write_to_unnamed_file(
                &list,
                &[],
                match kind {
                    _ if in_memory => ProgramFile::Memfd,
                    // Every process of the run maps it, to the end of the run, and reads some of it. Of a file on disk the system
                    // drops the pages that nobody reads when memory is short. Memory that stands in for a file it cannot drop.
                    TestPartKind::Shared
                    | TestPartKind::SharedLowest { .. }
                    | TestPartKind::SharedComputed
                    | TestPartKind::SharedPackages => ProgramFile::Deleted,
                    TestPartKind::TestFiles => ProgramFile::Deleted,
                },
            )?,
        });
        #[cfg(windows)]
        {
            let _ = (kind, in_memory);
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

pub(crate) struct TestPartMessages {
    #[cfg(unix)]
    pub(crate) descriptor: Fd,
    #[cfg(windows)]
    pub(crate) path: ZBox,
}

impl TestPartMessages {
    pub(crate) fn create() -> Maybe<TestPartMessages> {
        #[cfg(unix)]
        return Ok(TestPartMessages {
            descriptor: create_unnamed_file(ProgramFile::Memfd)?.0,
        });
        #[cfg(windows)]
        Ok(TestPartMessages {
            path: temporary_path(bun_resolver::fs::RealFS::tmpdir_path()),
        })
    }

    pub(crate) fn read(&self) -> Vec<u8> {
        #[cfg(unix)]
        {
            let mut messages = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match bun_sys::pread(self.descriptor, &mut chunk, messages.len() as i64) {
                    Ok(0) => break,
                    Ok(count) => messages.extend_from_slice(&chunk[..count]),
                    Err(error) if error.get_errno() == bun_sys::E::EINTR => {}
                    Err(_) => break,
                }
            }
            messages
        }
        #[cfg(windows)]
        File::read_from(Fd::cwd(), self.path.as_bytes()).unwrap_or_default()
    }
}

impl Drop for TestPartMessages {
    fn drop(&mut self) {
        #[cfg(unix)]
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
    /// Of what is left of it above the programs below, the lowest files: one part in so many. Other programs with what test files
    /// import are built above it.
    SharedLowest {
        part_in: u32,
    },
    /// The files that only imports with computed names reach.
    SharedComputed,
    /// Of what the test files import, the files of packages, with all of Bun's own code unless this Bun holds that compiled.
    SharedPackages,
}

impl TestPartKind {
    /// As the build itself says it in `log_cost_of_build`.
    pub(crate) fn name(self) -> &'static str {
        match self {
            TestPartKind::TestFiles => "test files",
            TestPartKind::Shared => "what test files share",
            TestPartKind::SharedLowest { .. } => "the lowest of what test files share",
            TestPartKind::SharedComputed => "what computed imports reach",
            TestPartKind::SharedPackages => "the packages that test files share",
        }
    }
}

struct WordsThatNameTestFiles {
    paths_and_filters: Vec<&'static [u8]>,
    lists: Vec<&'static [u8]>,
}

static WORDS_THAT_NAME_TEST_FILES: Guarded<WordsThatNameTestFiles> =
    Guarded::new(WordsThatNameTestFiles {
        paths_and_filters: Vec::new(),
        lists: Vec::new(),
    });

pub(crate) fn note_words_that_name_test_files(
    positionals: &[&'static [u8]],
    lists: &[&'static [u8]],
) {
    *WORDS_THAT_NAME_TEST_FILES.lock() = WordsThatNameTestFiles {
        paths_and_filters: positionals.iter().skip(1).copied().collect(),
        lists: lists.to_vec(),
    };
}

fn leave_out_words_that_name_test_files(
    typed: impl Iterator<Item = &'static [u8]>,
    words: &WordsThatNameTestFiles,
) -> Vec<&'static [u8]> {
    let mut paths_and_filters = words.paths_and_filters.iter().peekable();
    let mut kept: Vec<&'static [u8]> = Vec::new();
    for word in typed {
        if paths_and_filters
            .next_if(|it| core::ptr::eq(it.as_ptr(), word.as_ptr()))
            .is_some()
        {
            continue;
        }
        let place = word.as_ptr_range();
        let Some(list) = words
            .lists
            .iter()
            .find(|list| place.contains(&list.as_ptr()))
        else {
            kept.push(word);
            continue;
        };
        if core::ptr::eq(list.as_ptr(), word.as_ptr()) {
            kept.pop();
        }
    }
    kept
}

/// `below`: the numbers, in the process that builds, of the descriptors of the programs that it is built above, the lowest first.
/// `is_above_library`: the first of them is the library that this Bun holds compiled.
/// `threads`: how many the build may use, unless it may use every processor.
/// `told_of_last_below`: the last of `below` is still being built. The number of the descriptor that says when it is there.
pub(crate) fn test_part_arguments(
    descriptor: usize,
    kind: TestPartKind,
    below: core::ops::Range<usize>,
    is_above_library: bool,
    threads: Option<u32>,
    told_of_last_below: Option<usize>,
) -> Vec<Vec<u8>> {
    let typed = bun_core::argv()
        .into_iter()
        .skip(1 + bun_core::bun_options_argc());
    let typed = leave_out_words_that_name_test_files(typed, &WORDS_THAT_NAME_TEST_FILES.lock());
    let mut flag = [TEST_PART_FLAG, descriptor.to_string().as_bytes()].concat();
    if kind != TestPartKind::TestFiles {
        flag.extend([b",", SHARED_BY_TEST_PARTS].concat());
    }
    if kind == TestPartKind::SharedPackages {
        flag.extend_from_slice(b",packages");
    }
    if kind == TestPartKind::SharedComputed {
        flag.extend_from_slice(b",computed");
    }
    if let TestPartKind::SharedLowest { part_in } = kind {
        flag.extend(format!(",lowest-in:{part_in}").into_bytes());
    }
    let may_take = MEGABYTES_THAT_BUILD_MAY_TAKE.load(Ordering::Relaxed);
    if may_take != 0
        && matches!(
            kind,
            TestPartKind::Shared | TestPartKind::SharedLowest { .. }
        )
    {
        flag.extend(format!(",may-take:{may_take}").into_bytes());
    }
    if let Some(threads) = threads {
        flag.extend(format!(",threads:{threads}").into_bytes());
    }
    let library = below.start..below.start + usize::from(is_above_library);
    let last = below.end.wrapping_sub(1);
    for number in below {
        if let Some(told) = told_of_last_below.filter(|_| number == last) {
            flag.extend(format!(",later:{number}:{told}").into_bytes());
            continue;
        }
        let word = match library.contains(&number) {
            true => "library",
            false => "below",
        };
        flag.extend(format!(",{word}:{number}").into_bytes());
    }
    let mut arguments = vec![flag];
    arguments.extend(typed.into_iter().map(<[u8]>::to_vec));
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
        exit_builder(1)
    }
    decide_whether_to_clear_terminal();
    Output::flush();
    loop {
        std::thread::park();
    }
}

fn is_said_about_types(text: &[u8]) -> bool {
    let Some(rest) = text.strip_prefix(b"TS") else {
        return false;
    };
    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
    let number = rest[..digits].iter().fold(0u32, |number, digit| {
        number.saturating_mul(10) + u32::from(digit - b'0')
    });
    number < 100_000 || matches!(number, 100_009 | 100_010 | 100_066 | 100_075)
}

fn list_errors(log: &bun_ast::Log) -> Vec<u8> {
    let mut said = Vec::new();
    for message in log.msgs.iter().filter(|it| it.kind == bun_ast::Kind::Err) {
        if said.is_empty() {
            said.extend_from_slice(&message.data.text);
        }
        said.push(b'\n');
        if let Some(location) = message.data.location.as_ref().filter(|it| it.line > 0) {
            said.extend_from_slice(&location.file);
            said.extend_from_slice(format!(":{}:{}: ", location.line, location.column).as_bytes());
        }
        said.extend_from_slice(&message.data.text);
    }
    said.retain(|&byte| byte != 0 && byte != SAID_OF_REFUSED_FILE);
    said
}

fn write_check_result(
    refused_files: &[u8],
    watched: Option<&WatchedFiles>,
    names_added: &[(u32, Vec<u8>)],
) -> Vec<u8> {
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
    result.push(0);
    for (holder, name) in names_added {
        result.extend_from_slice(holder.to_string().as_bytes());
        result.push(b' ');
        result.extend_from_slice(name);
        result.push(0);
    }
    result
}

/// The stand-in no longer names the files, so nothing of them is in the program: whoever loads one gets what the loader says of it.
/// A line of the stand-in is about one module: `import * as n7 from "<path>";`, `  sink(n7.a, n7.b);`, `  spyOn(n7, "a");`.
fn leave_out_of_stand_in(stand_in: &[u8], files: &[&[u8]]) {
    let key = key_of_stand_in(stand_in);
    let Some(text) = files_in_memory().and_then(|held| held.map.get(key.as_slice())) else {
        return;
    };
    let name_imported = |line: &[u8]| -> Option<Vec<u8>> {
        let rest = line.strip_prefix(b"import * as ")?;
        let (name, path) = rest.split_at(bun_core::strings::index_of_char_usize(rest, b' ')?);
        let path = path.strip_prefix(b" from \"")?.strip_suffix(b"\";")?;
        files.contains(&path).then(|| name.to_vec())
    };
    let lines = || bun_core::strings::split(text, b"\n");
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
    set_stand_in(stand_in, &kept.join(&b'\n'));
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
    if may_refuse_all
        && refused
            .last()
            .is_some_and(|&last| last >= independent_count)
    {
        return Some((0..independent_count).collect());
    }
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
    let mut is_last_try = false;
    loop {
        let (error, kind) = match create_unnamed_file(first) {
            Ok((descriptor, kind)) => {
                let file = File::from_fd(descriptor);
                match write_to_empty_file(descriptor, [bytes, bytes_after]) {
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
    let shares = [(first, parts[0]), (second, parts[1])].into_iter();
    let shares =
        shares.flat_map(|(target, source)| target.chunks_mut(share).zip(source.chunks(share)));
    for_each_on_threads(shares.collect(), |(target, source)| {
        target.copy_from_slice(source)
    });
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
    use bun_sys::E;
    let errno = error.get_errno();
    let has_no_room = matches!(errno, E::ENOSPC | E::EFBIG | E::ENOMEM);
    #[cfg(unix)]
    let has_no_room = has_no_room || errno == E::EDQUOT;
    if has_no_room && TEST_PART_DESCRIPTOR.get().is_some() {
        Output::flush();
        exit_builder(PART_HAS_NO_ROOM)
    }
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
            let is_one_program = descriptors.as_deref().is_some_and(|all| all.len() == 1);
            IS_ONE_PROGRAM.store(is_one_program, Ordering::Relaxed);
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

pub(crate) fn test_files_share_global(ctx: &ContextData) -> bool {
    ctx.test_options.isolate_modules && !IS_ONE_PROGRAM.load(Ordering::Relaxed)
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
    let refused = refused.map(|refused| {
        let end = bun_core::strings::index_of_char_usize(refused, SAID_OF_REFUSED_FILE);
        let (path, said) = refused.split_at(end.unwrap_or(refused.len()));
        (
            Box::from(path),
            Box::from(said.get(1..).unwrap_or_default()),
        )
    });
    let _ = REFUSED_FILES.set(refused.collect());
    let watched = paths.by_ref().take_while(|path| !path.is_empty());
    let _ = FILES_OF_CHECK.set(watched.map(Box::from).collect());
    for added in paths.filter(|added| !added.is_empty()) {
        let Some(space) = bun_core::strings::index_of_char_usize(added, b' ') else {
            continue;
        };
        let holder = core::str::from_utf8(&added[..space]).ok();
        if let Some(holder) = holder.and_then(|holder| holder.parse().ok()) {
            let name = &added[space + 1..];
            // SAFETY: the bytes are copied before the call returns.
            unsafe { Bun__AOT__openNameWithoutImage(holder, name.as_ptr(), name.len()) };
        }
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

pub(crate) fn is_refused(path: &[u8]) -> bool {
    find_what_build_said_of_refused_file(path).is_some()
}

pub(crate) fn find_what_build_said_of_refused_file(path: &[u8]) -> Option<&'static [u8]> {
    let files = REFUSED_FILES.get()?.iter();
    files
        .into_iter()
        .find(|file| &*file.0 == path)
        .map(|file| &*file.1)
}

#[inline]
pub(crate) fn is_checked() -> bool {
    IS_CHECKED.load(Ordering::Relaxed)
}

unsafe extern "C" {
    safe fn Bun__AOT__listRefusedChanges();
    fn Bun__AOT__openNameWithoutImage(holder: u32, name: *const u8, length: usize);
    safe fn Bun__AOT__takesImagesAboveOthers() -> bool;
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
    core::mem::take(&mut *REFUSED_CHANGES.lock())
}

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

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__recordRefusedChange(
    refusal: &bun_core::String,
    source_url: &bun_core::String,
    line: u32,
    column: u32,
) {
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

fn add_refusal_of_running_test_file(refusal: Vec<u8>) {
    let file = RUNNING_TEST_FILE.lock().clone();
    add_refused_change([&refusal[..], b", while ", &file[..], b" ran"].concat());
    if !refusal.starts_with(LOADED_ADDON) {
        *NEWEST_REFUSAL_OF_RUNNING_TEST_FILE.lock() = refusal;
    }
}

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

pub(crate) fn find_why_askers_are_of_product(refusals: &[Vec<u8>]) -> Vec<(Vec<u8>, Vec<u8>)> {
    let top = bun_resolver::fs::FileSystem::get().top_level_dir();
    let top = top.strip_suffix(&[bun_paths::SEP]).unwrap_or(top);
    let top = bun_core::strings::replace_owned(top, &[bun_paths::SEP], b"/");
    let mut askers: Vec<&[u8]> = (refusals.iter())
        .filter_map(|refusal| {
            let place = &refusal[bun_core::strings::index_of(refusal, b"', at ")? + 6..];
            let place = &place[..bun_core::strings::index_of(place, b", while ")?];
            place.rsplitn(3, |&byte| byte == b':').nth(2)
        })
        .collect();
    askers.sort_unstable();
    askers.dedup();
    (askers.into_iter())
        .filter_map(|asker| {
            let file = [&top[..], b"/", asker].concat();
            let importer = bun_aot::builtins::find_importer_outside_tests(&top, &file)?;
            let importer = importer
                .strip_prefix(&top[..])?
                .strip_prefix(b"/")?
                .to_vec();
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
    if refused.len() < MAX_LISTED_REFUSED_CHANGES && !refused.contains(&line) {
        refused.push(line);
    }
}

#[inline]
pub(crate) fn is_second_process() -> bool {
    runs_compiled_code() || is_checked() || builds_test_part()
}

static NAMES_ENVIRONMENT_FILE_THAT_IS_NO_FILE: AtomicBool = AtomicBool::new(false);

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
