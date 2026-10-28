use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use bstr::BStr;
use bun_core::{Global, Output, ZBox};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::aot_options::ReadListener;
use bun_options_types::context::HotReload;
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

    let independent_files = entry_points[..independent_count].to_vec();
    ctx.args.entry_points = entry_points;
    ctx.bundler_options.compile = true;
    ctx.bundler_options.inline_entrypoint_import_meta_main = true;
    ctx.bundler_options.outfile = Box::from(&b"program"[..]);

    let product = match checks_only {
        true => CompileProduct::ReportsOnly,
        false => CompileProduct::GraphBytes,
    };
    let outcome = match compile_from_context(&mut *ctx, product) {
        Err(error) => {
            print_log(ctx.log_ref());
            Output::err_generic("{}", (BStr::new(error.name()),));
            exit_or_wait_for_change(watched)
        }
        Ok(Err(failure)) => match list_refused_files(&failure, &independent_files) {
            Some(refused_files) => {
                print_log(ctx.log_ref());
                let check_result = write_check_result(&refused_files, watched);
                let handover = Handover {
                    flag: CHECKED_FLAG,
                    bytes: Some(&check_result),
                };
                start_second_process(&typed, own_count, handover, ctx.original_cwd.as_deref())
            }
            None => {
                let target = &ctx.bundler_options.compile_target;
                print_failure(ctx.log_ref(), RequestOrigin::BuildFlag, target, &failure);
                exit_or_wait_for_change(watched)
            }
        },
        Ok(Ok(outcome)) => outcome,
    };
    print_log(ctx.log_ref());
    let check_result = watched.map(|watched| write_check_result(&[], Some(watched)));
    let handover = match &outcome.graph_bytes {
        Some(graph_bytes) => Handover {
            flag: GRAPH_FLAG,
            bytes: Some(graph_bytes),
        },
        None => Handover {
            flag: CHECKED_FLAG,
            bytes: check_result.as_deref(),
        },
    };
    start_second_process(&typed, own_count, handover, ctx.original_cwd.as_deref())
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
        Global::exit(1)
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

fn list_refused_files(
    failure: &CompileFailure,
    independent_files: &[Box<[u8]>],
) -> Option<Vec<u8>> {
    let CompileFailure::Build {
        refused_entry_points: Some(refused),
        ..
    } = failure
    else {
        return None;
    };
    if refused.len() >= independent_files.len() {
        return None;
    }
    let mut list = Vec::new();
    for &position in refused {
        list.extend_from_slice(independent_files.get(position as usize)?);
        list.push(0);
    }
    Some(list)
}

#[derive(Copy, Clone)]
struct Handover<'a> {
    flag: &'static [u8],
    bytes: Option<&'a [u8]>,
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

fn temporary_path(directory: &[u8]) -> ZBox {
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

#[cfg(unix)]
fn create_unnamed_file() -> Maybe<Fd> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if bun_sys::can_use_memfd() {
        if let Ok(descriptor) =
            bun_sys::memfd_create(c"bun-compiled-program", bun_sys::MemfdFlags::Executable)
        {
            return Ok(descriptor);
        }
    }
    create_deleted_file(bun_resolver::fs::RealFS::tmpdir_path())
}

#[cfg(unix)]
fn write_to_unnamed_file(bytes: &[u8]) -> Maybe<Fd> {
    let file = File::from_fd(create_unnamed_file()?);
    file.write_all(bytes)?;
    Ok(file.into_raw())
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
    let descriptor = match handover.bytes.map(write_to_unnamed_file) {
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
fn write_to_named_file(path: &bun_core::ZStr, bytes: &[u8]) -> Maybe<Fd> {
    let file = File::from_fd(bun_sys::openat(
        Fd::cwd(),
        path,
        O::RDWR | O::CREAT | O::EXCL,
        0o700,
    )?);
    file.write_all(bytes)?;
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
    let descriptor = match write_to_named_file(&path, bytes) {
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
    let graph = Graph::get()?;
    // SAFETY: the singleton lives in a process-global static and is never freed.
    Some(unsafe {
        &*(graph.cast_const() as *const (dyn bun_resolver::StandaloneModuleGraph + 'static))
    })
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
    let mut paths = bun_core::strings::split(&list, b"\0");
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
        bun_resolver::fs::FileSystem::instance().top_level_dir(),
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
    runs_compiled_code() || is_checked()
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
