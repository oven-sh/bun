//! `bun:desktop`: loads the UI library (`packages/bun-desktop`) and makes the event loop wait in the window system's.
//!
//! The library is not linked, so that `bun` does not depend on X11, Vulkan or AppKit. It holds no JS value: it queues
//! events, which `bun_ui` takes once the library has returned.

use core::cell::{Cell, RefCell};
use core::ffi::{c_longlong, c_void};
use std::sync::OnceLock;

use bstr::BStr;
use bun_event_loop::ConcurrentTask::{Task, task_tag};
use bun_event_loop::EventLoopTimer::EventLoopTimer;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JsResult};
use bun_standalone_graph::StandaloneModuleGraph::CompileTarget;
use bun_standalone_graph::desktop as bundle;

#[path = "../../dom/abi.rs"]
mod abi;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
mod child;
mod host;
mod host_abi;
#[path = "../../ui/protocol.rs"]
mod protocol;
#[cfg(unix)]
pub(crate) mod quick_fs;

pub(crate) mod main_thread;
pub(crate) mod tasks;
pub(crate) mod web;

struct Library {
    path: Box<[u8]>,
    init: extern "C" fn(tick: extern "C" fn(), has_main_thread: bool),
    #[cfg(unix)]
    run: extern "C" fn() -> !,
    #[cfg(unix)]
    call_on_main_thread: main_thread::Door,
    call_on_javascript_thread: main_thread::Door,
    renderer: extern "C" fn() -> *const c_void,
    ui: &'static protocol::Ui,
    graphics: extern "C" fn() -> *const c_void,
}

impl Library {
    fn open(path: &[u8]) -> Result<Library, Vec<u8>> {
        let failure = |reason: &dyn core::fmt::Display| {
            format!("Failed to load {}: {reason}", BStr::new(path)).into_bytes()
        };
        // SAFETY: the library is part of the program.
        let library = unsafe { bun_sys::DynLib::open(path) }.map_err(|error| {
            #[cfg(unix)]
            {
                // SAFETY: null, or a C string that lasts until this thread's next call into the loader.
                let message = unsafe { libc::dlerror() };
                if !message.is_null() {
                    // SAFETY: as above.
                    let message = unsafe { core::ffi::CStr::from_ptr(message) };
                    return failure(&BStr::new(message.to_bytes()));
                }
            }
            failure(&error)
        })?;
        let library = library.leak();
        macro_rules! find {
            ($name:literal) => {
                // SAFETY: the library is never unloaded, and its version vouches for the types.
                unsafe { library.lookup_as(bun_core::zstr!($name)) }
            };
        }
        let version: Option<extern "C" fn() -> u32> = find!("bun_desktop_abi_version");
        let version = version.map(|version| version());
        if version != Some(abi::ABI_VERSION) {
            return Err(failure(&"it was built for another version of Bun"));
        }
        #[cfg(any(unix, not(bun_asan)))]
        if let Some(set) = find!("bun_desktop_set_allocator") {
            let set: extern "C" fn(&'static host_abi::Allocator) = set;
            set(&host::ALLOCATOR);
        }
        if let Some(set_host) = find!("bun_desktop_set_host") {
            let set_host: extern "C" fn(&'static host_abi::Host) = set_host;
            set_host(&host::HOST);
        }
        macro_rules! lookup {
            ($name:literal) => {
                find!($name).ok_or_else(|| failure(&concat!("it has no ", $name)))?
            };
        }
        let ui: extern "C" fn() -> &'static protocol::Ui = lookup!("bun_desktop_ui");
        Ok(Library {
            path: path.into(),
            init: lookup!("bun_desktop_init"),
            #[cfg(unix)]
            run: lookup!("bun_desktop_run"),
            #[cfg(unix)]
            call_on_main_thread: lookup!("bun_desktop_call_on_main_thread"),
            call_on_javascript_thread: lookup!("bun_desktop_call_on_javascript_thread"),
            renderer: lookup!("bun_desktop_renderer"),
            ui: ui(),
            graphics: lookup!("bun_desktop_graphics"),
        })
    }
}

static LIBRARY: OnceLock<Library> = OnceLock::new();

thread_local! {
    static IS_QUEUED: Cell<bool> = const { Cell::new(false) };
    static IS_TICKING: Cell<bool> = const { Cell::new(false) };
    static IDLE_WORK: Cell<*mut c_void> = const { Cell::new(core::ptr::null_mut()) };
}

/// For what only the library itself sets going.
fn library() -> &'static Library {
    LIBRARY.get().expect("bun:desktop was loaded")
}

/// The `abi::Renderer` for `bun_dom`, or null.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__renderer() -> *const c_void {
    LIBRARY
        .get()
        .map_or(core::ptr::null(), |library| (library.renderer)())
}

/// The `abi_graphics::Graphics` for `bun_dom`, or null.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__graphics() -> *const c_void {
    LIBRARY
        .get()
        .map_or(core::ptr::null(), |library| (library.graphics)())
}

unsafe extern "C" {
    fn us_loop_set_foreign_wait(
        loop_: &bun_uws::Loop,
        wait: Option<extern "C" fn(source: isize, timeout_ns: c_longlong)>,
    );
    fn us_loop_foreign_wait_reenter(loop_: &bun_uws::Loop);
    safe fn Bun__DesktopIdleWork__create(vm: &bun_jsc::VM) -> *mut c_void;
    fn Bun__DesktopIdleWork__beforeWait(
        work: *mut c_void,
        timeout_ns: c_longlong,
        slack_ms: f64,
    ) -> c_longlong;
    fn Bun__DesktopIdleWork__didGetEvents(work: *mut c_void, has_input: bool);
    safe fn Bun__Ui__handleEvents(global: &JSGlobalObject);
    fn Bun__Ui__fireTimer(timer: *mut c_void);
}

struct DesktopEventsTask;
impl bun_event_loop::Taskable for DesktopEventsTask {
    const TAG: bun_event_loop::TaskTag = task_tag::DesktopEventsTask;
    /// Nothing is owned.
    unsafe fn release_unrun(_: *mut Self) {}
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

/// In place of the event loop's poll. The JS heap may be the collector's.
extern "C" fn wait_for_ui(source: isize, mut timeout_ns: c_longlong) {
    #[cfg(unix)]
    quick_fs::begin_turn();
    let is_idle = timeout_ns != 0;
    if is_idle && !IDLE_WORK.get().is_null() {
        // SAFETY: it is never freed, and this is the thread of its VM.
        timeout_ns = unsafe {
            Bun__DesktopIdleWork__beforeWait(IDLE_WORK.get(), timeout_ns, bun_web::tasks::slack())
        };
    }
    let has_events = (library().ui.pump)(source, timeout_ns, IS_TICKING.replace(false));
    if is_idle {
        bun_web::tasks::caught_up();
    }
    if !has_events {
        return;
    }
    if !IDLE_WORK.get().is_null() {
        // SAFETY: as above.
        unsafe { Bun__DesktopIdleWork__didGetEvents(IDLE_WORK.get(), (library().ui.has_input)()) };
    }
    if !IS_QUEUED.replace(true) {
        let task = Task::init(core::ptr::dangling_mut::<DesktopEventsTask>());
        VirtualMachine::get().event_loop().enqueue_task(task);
    }
}

/// `pump` does not return while a menu is open or a window is being resized, and calls this.
extern "C" fn tick() {
    let event_loop = VirtualMachine::get().event_loop();
    // SAFETY: this thread's loop, which is in `wait_for_ui`.
    unsafe { us_loop_foreign_wait_reenter(event_loop.usockets_loop()) };
    on_events(event_loop.global_ref());
    event_loop.tick();
    IS_TICKING.set(true);
    event_loop.auto_tick();
    IS_TICKING.set(false);
    event_loop.tick();
}

/// Windows and tray icons would otherwise stay on screen while the process is being torn down.
extern "C" fn close_everything() {
    if !bun_core::Global::is_panicking() && bun_crash_handler::cli_state::is_main_thread() {
        let _ = (library().ui.perform)(protocol::Command::ShutDown { is_exiting: true });
    }
}

pub(crate) fn on_events(global: &JSGlobalObject) {
    IS_QUEUED.set(false);
    Bun__Ui__handleEvents(global);
}

#[unsafe(no_mangle)]
fn __bun_web_handle_input(vm: &VirtualMachine) {
    let has_input = |library: &Library| (library.ui.has_input)();
    if !vm.is_main_thread.get() || !LIBRARY.get().is_some_and(has_input) {
        return;
    }
    if !IDLE_WORK.get().is_null() {
        // SAFETY: it is never freed, and this is the thread of its VM.
        unsafe { Bun__DesktopIdleWork__didGetEvents(IDLE_WORK.get(), true) };
    }
    Bun__Ui__handleEvents(vm.global());
}

/// # Safety
/// It has the tag `Ui`, and has left the heap.
pub(crate) unsafe fn fire_timer(timer: *mut EventLoopTimer) {
    // SAFETY: the caller's contract.
    unsafe { Bun__Ui__fireTimer(timer.cast()) }
}

fn find_library(global: &JSGlobalObject) -> Result<Vec<u8>, Vec<u8>> {
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    if let Some(path) = child::library() {
        return Ok(path.to_vec());
    }
    if global.bun_vm().standalone_module_graph.is_some() {
        return bundle::library_in_bundle().ok_or_else(|| {
            b"This executable is not in the bundle that has its UI library. Build it with --desktop, and keep the bundle's files together.".to_vec()
        });
    }
    fn find_or_download(global: &JSGlobalObject) -> Result<Vec<u8>, Vec<u8>> {
        bundle::library_for(&CompileTarget::default(), global.bun_vm().env_loader())
            .map_err(|error| error.slice().to_vec())
    }
    bun_removable_features::call_removable!(Tools, Abort, find_or_download, global)
}

fn load(global: &JSGlobalObject) -> JsResult<()> {
    if !global.bun_vm().is_main_thread.get() {
        return Err(global.throw(format_args!("bun:desktop is not available in a Worker")));
    }
    let opened = find_library(global)
        .and_then(|path| Library::open(&path))
        .map_err(|message| global.throw(format_args!("{}", BStr::new(&message))))?;
    if is_page_process() {
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
        child::seal(opened.ui);
        (opened.ui.become_page_process)();
    }
    (opened.init)(tick, main_thread::is_lent());
    LIBRARY.get_or_init(|| opened);
    let loop_ = global.bun_vm().event_loop().usockets_loop();
    // SAFETY: the main thread's loop, which lives as long as the process.
    unsafe { us_loop_set_foreign_wait(loop_, Some(wait_for_ui)) };
    bun_core::Global::set_before_exit_callback(close_everything);
    if global.bun_vm().hand_over_idle_collections() {
        IDLE_WORK.set(Bun__DesktopIdleWork__create(global.vm()));
    }
    Ok(())
}

/// The `protocol::Ui` for `bun_ui`, which calls it once, or null if it has thrown.
#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__load(global: &JSGlobalObject) -> *const c_void {
    load(global).map_or(core::ptr::null(), |()| {
        core::ptr::from_ref(library().ui).cast()
    })
}

/// A realm that is none of the program has only the text of built-in functions.
#[unsafe(no_mangle)]
fn __bun_desktop_can_show_pages_without_program() -> bool {
    bun_removable_features::can_run_uncompiled_code()
        && bun_core::code_generation_from_strings_by_flags()
            != bun_core::CodeGenerationFromStrings::Strict
}

#[unsafe(no_mangle)]
fn __bun_desktop_path_of_library() -> &'static [u8] {
    &library().path
}

#[unsafe(no_mangle)]
fn __bun_desktop_can_sandbox_pages() -> bool {
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    return child::is_supported();
    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
    false
}

#[unsafe(no_mangle)]
fn __bun_desktop_has_http_client() -> bool {
    !bun_removable_features::is_removed(bun_removable_features::Feature::HttpClient)
}

#[unsafe(no_mangle)]
fn __bun_desktop_can_start_programs() -> bool {
    !bun_removable_features::is_removed(bun_removable_features::Feature::ChildProcess)
}

#[unsafe(no_mangle)]
fn __bun_desktop_can_run_uncompiled_code() -> bool {
    bun_removable_features::can_run_uncompiled_code()
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
#[inline(never)]
pub(crate) fn has_pages_without_program() -> bool {
    child::has_pages() && !child::runs_program()
}

#[inline(never)]
pub(crate) fn is_page_process() -> bool {
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    return child::has_pages();
    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
    false
}

/// In place of the entry point. False if this is no such process.
#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
#[inline(never)]
pub(crate) fn enter_page_process() -> bool {
    if child::has_pages() {
        child::enter();
        return true;
    }
    false
}

#[unsafe(no_mangle)]
fn __bun_desktop_find_chrome() -> Option<Vec<u8>> {
    crate::webview::chrome_process::find_chrome(None).map(|path| path.as_bytes().to_vec())
}

thread_local! {
    static MAPPED: RefCell<Vec<(Box<[u8]>, &'static [u8])>> = const { RefCell::new(Vec::new()) };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Desktop__mappedResource(bytes: *const u8, len: usize) -> *const u8 {
    // SAFETY: the caller passes a live slice.
    let bytes = unsafe { core::slice::from_raw_parts(bytes, len) };
    MAPPED.with_borrow(|all| {
        all.iter()
            .find(|it| it.1 == bytes)
            .map_or(core::ptr::null(), |it| it.1.as_ptr())
    })
}

#[cfg(unix)]
fn map_resource(path: &[u8]) -> Option<&'static [u8]> {
    const WORTHWHILE: usize = 32 << 10;
    let ships = resources_path().is_some_and(|it| {
        path.strip_prefix(&it[..]).is_some_and(|rest| {
            rest.starts_with(b"/") && !bun_core::strings::contains(rest, b"/../")
        })
    });
    ships.then_some(())?;
    let known = MAPPED.with_borrow(|all| Some(all.iter().find(|it| *it.0 == *path)?.1));
    if known.is_some() {
        return known;
    }
    let file = bun_sys::File::openat(bun_sys::Fd::cwd(), path, bun_sys::O::RDONLY, 0).ok()?;
    let len = file.get_end_pos().ok().filter(|it| *it >= WORTHWHILE)?;
    let (prot, flags) = (libc::PROT_READ, libc::MAP_PRIVATE);
    // SAFETY: not `MAP_FIXED`.
    let start = unsafe { bun_sys::mmap(core::ptr::null_mut(), len, prot, flags, file.fd(), 0) };
    let start = start.ok()?;
    // SAFETY: never unmapped, and an installed program's files are replaced, not written to.
    let bytes = unsafe { core::slice::from_raw_parts(start.cast_const(), len) };
    MAPPED.with_borrow_mut(|all| all.push((path.into(), bytes)));
    Some(bytes)
}

#[cfg(not(unix))]
fn map_resource(_: &[u8]) -> Option<&'static [u8]> {
    None
}

pub(crate) fn resources_path() -> Option<Vec<u8>> {
    bun_jsc::virtual_machine::standalone_module_graph()?;
    bundle::resources_in_bundle()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Desktop__resourcesPath() -> bun_core::String {
    bun_core::String::clone_utf8(&resources_path().unwrap_or_default())
}
