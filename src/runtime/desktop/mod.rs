//! `bun:desktop`: loads the UI library (`packages/bun-desktop`) and makes the event loop wait in the window system's.
//!
//! The library is not linked, so that `bun` does not depend on X11, Vulkan or AppKit. It holds no JS value: it queues
//! events, which JavaScript takes once the library has returned.

use core::cell::{Cell, RefCell};
use core::ffi::{c_longlong, c_void};
use std::sync::OnceLock;

use bstr::BStr;
use bun_event_loop::ConcurrentTask::{Task, task_tag};
use bun_jsc::bindgen::{self, BufferSource, Callable, JsHeap, JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSString, JSValue, JsResult};
use bun_standalone_graph::StandaloneModuleGraph::CompileTarget;
use bun_standalone_graph::desktop as bundle;

#[path = "../../dom/abi.rs"]
#[allow(dead_code, unreachable_pub)]
mod abi;
#[cfg(unix)]
pub(crate) mod quick_fs;

pub(crate) mod main_thread;

/// The `source` of a `pump` that only waits for the UI.
const NO_SOURCE: isize = -1;
const FOREVER: i64 = -1;

#[repr(C)]
struct RawBytes {
    ptr: *mut u8,
    len: usize,
    capacity: usize,
}

struct Library {
    init: extern "C" fn(tick: extern "C" fn(), has_main_thread: bool),
    #[cfg(unix)]
    run: extern "C" fn() -> !,
    call_on_main_thread: main_thread::Door,
    call_on_javascript_thread: main_thread::Door,
    renderer: extern "C" fn() -> *const c_void,
    call: unsafe extern "C" fn(*const u8, usize) -> RawBytes,
    post: extern "C" fn(command: u32, surface: u32, argument: u32),
    draw: unsafe extern "C" fn(*const u8, usize, *const u8, usize),
    measure: unsafe extern "C" fn(*mut [f64; 12], *const u8, usize),
    drain_numbers: unsafe extern "C" fn(*mut f64, usize) -> usize,
    drain: extern "C" fn() -> RawBytes,
    pump: extern "C" fn(source: isize, timeout_ns: i64, from_tick: bool) -> bool,
    present: extern "C" fn(),
    put_blob: unsafe extern "C" fn(*const u8, usize) -> u32,
    take_blob: extern "C" fn(u32) -> RawBytes,
    free: unsafe extern "C" fn(RawBytes),
}

impl Library {
    fn open(path: &[u8]) -> Result<Library, Vec<u8>> {
        let failure = |reason: &dyn core::fmt::Display| {
            format!("Failed to load {}: {reason}", BStr::new(path)).into_bytes()
        };
        let library = bun_sys::DynLib::open(path).map_err(|error| {
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
        let version = library
            .lookup::<extern "C" fn() -> u32>(bun_core::zstr!("bun_desktop_abi_version"))
            .map(|version| version());
        if version != Some(abi::ABI_VERSION) {
            return Err(failure(&"it was built for another version of Bun"));
        }
        macro_rules! lookup {
            ($name:literal) => {
                library
                    .lookup(bun_core::zstr!($name))
                    .ok_or_else(|| failure(&concat!("it has no ", $name)))?
            };
        }
        Ok(Library {
            init: lookup!("bun_desktop_init"),
            #[cfg(unix)]
            run: lookup!("bun_desktop_run"),
            call_on_main_thread: lookup!("bun_desktop_call_on_main_thread"),
            call_on_javascript_thread: lookup!("bun_desktop_call_on_javascript_thread"),
            renderer: lookup!("bun_desktop_renderer"),
            call: lookup!("bun_desktop_call"),
            post: lookup!("bun_desktop_post"),
            draw: lookup!("bun_desktop_draw"),
            measure: lookup!("bun_desktop_measure"),
            drain_numbers: lookup!("bun_desktop_drain_numbers"),
            drain: lookup!("bun_desktop_drain"),
            pump: lookup!("bun_desktop_pump"),
            present: lookup!("bun_desktop_present"),
            put_blob: lookup!("bun_desktop_put_blob"),
            take_blob: lookup!("bun_desktop_take_blob"),
            free: lookup!("bun_desktop_free"),
        })
    }

    fn call<R>(&self, json: &[u8], read: impl FnOnce(&[u8]) -> R) -> R {
        // SAFETY: a live slice.
        self.read(unsafe { (self.call)(json.as_ptr(), json.len()) }, read)
    }

    fn read<R>(&self, bytes: RawBytes, read: impl FnOnce(&[u8]) -> R) -> R {
        // SAFETY: the parts of a `Vec<u8>` of the library, which is freed below.
        let result = read(unsafe { core::slice::from_raw_parts(bytes.ptr, bytes.len) });
        // SAFETY: it came from the library, and `bytes` moves.
        unsafe { (self.free)(bytes) };
        result
    }
}

static LIBRARY: OnceLock<Library> = OnceLock::new();

thread_local! {
    static IS_QUEUED: Cell<bool> = const { Cell::new(false) };
    static IS_TICKING: Cell<bool> = const { Cell::new(false) };
    static IDLE_WORK: Cell<*mut c_void> = const { Cell::new(core::ptr::null_mut()) };
}

/// `internal/desktop/native.ts` calls `load` before it calls anything else.
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

unsafe extern "C" {
    fn us_loop_set_foreign_wait(
        loop_: &bun_uws::Loop,
        wait: Option<extern "C" fn(source: isize, timeout_ns: c_longlong)>,
    );
    fn us_loop_foreign_wait_reenter(loop_: &bun_uws::Loop);
    safe fn Bun__DesktopIdleWork__create(vm: &bun_jsc::VM) -> *mut c_void;
    fn Bun__DesktopIdleWork__beforeWait(work: *mut c_void, timeout_ns: c_longlong) -> c_longlong;
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
    if timeout_ns != 0 && !IDLE_WORK.get().is_null() {
        // SAFETY: it is never freed, and this is the thread of its VM.
        timeout_ns = unsafe { Bun__DesktopIdleWork__beforeWait(IDLE_WORK.get(), timeout_ns) };
    }
    if (library().pump)(source, timeout_ns, IS_TICKING.replace(false)) && !IS_QUEUED.replace(true) {
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
        library().call(br#"["shutdown",true]"#, |_| {});
    }
}

#[derive(Default)]
pub(crate) struct VmState {
    on_events: bun_jsc::strong::StrongCell,
    keep_alive: bun_io::JsKeepAlive,
}

fn state(global: &JSGlobalObject) -> &VmState {
    &crate::jsc_hooks::state_of(global.bun_vm()).desktop
}

pub(crate) fn on_events(global: &JSGlobalObject) {
    IS_QUEUED.set(false);
    if let Some(callback) = state(global).on_events.get() {
        global.bun_vm().event_loop().run_callback(
            bun_event_loop::ContextId::NONE,
            callback,
            global,
            JSValue::UNDEFINED,
            &[],
        );
    }
}

fn find_library(global: &JSGlobalObject) -> Result<Vec<u8>, Vec<u8>> {
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

pub(crate) fn load<'a>(cx: &mut JsScope<'a>, on_events: JsLocal<'a, Callable>) -> JsResult<()> {
    let global = cx.global();
    if !global.bun_vm().is_main_thread.get() {
        return Err(global.throw(format_args!("bun:desktop is not available in a Worker")));
    }
    match LIBRARY.get() {
        // A new global object, as `bun test --isolate` makes. It numbers its windows from the start.
        Some(library) => library.call(br#"["shutdown",false]"#, |_| {}),
        None => {
            let opened = find_library(global)
                .and_then(|path| Library::open(&path))
                .map_err(|message| global.throw(format_args!("{}", BStr::new(&message))))?;
            (opened.init)(tick, main_thread::is_lent());
            LIBRARY.get_or_init(|| opened);
            let loop_ = global.bun_vm().event_loop().usockets_loop();
            // SAFETY: the main thread's loop, which lives as long as the process.
            unsafe { us_loop_set_foreign_wait(loop_, Some(wait_for_ui)) };
            bun_core::Global::set_before_exit_callback(close_everything);
            if global.bun_vm().hand_over_idle_collections() {
                IDLE_WORK.set(Bun__DesktopIdleWork__create(global.vm()));
            }
        }
    }
    state(global)
        .on_events
        .set(bun_jsc::Strong::create(on_events.to_js(), global));
    Ok(())
}

pub(crate) fn call<'a>(
    heap: &JsHeap<'a>,
    json: &[u8],
) -> bindgen::Result<'a, JsLocal<'a, JSString>> {
    library().call(json, |reply| heap.create_utf8_string(reply))
}

pub(crate) fn post(command: u32, surface: u32, argument: u32) {
    (library().post)(command, surface, argument);
}

pub(crate) fn draw(numbers: &[u8], len: u32, text: &[u8]) {
    let numbers = &numbers[..numbers.len().min(len as usize * 8)];
    // SAFETY: live slices.
    unsafe { (library().draw)(numbers.as_ptr(), numbers.len(), text.as_ptr(), text.len()) };
}

fn with_numbers<'a, R>(
    heap: &JsHeap<'a>,
    numbers: JsLocal<'a, BufferSource>,
    f: impl FnOnce(&mut [f64]) -> R,
) -> R {
    // SAFETY: no other argument is a buffer, and any bytes are an `f64`.
    unsafe { numbers.with_bytes_mut(heap, |bytes| f(bytes.align_to_mut().1)) }
}

pub(crate) fn measure<'a>(heap: &JsHeap<'a>, numbers: JsLocal<'a, BufferSource>, text: &[u8]) {
    with_numbers(heap, numbers, |numbers| {
        if let Some(numbers) = numbers.first_chunk_mut() {
            // SAFETY: a live array and a live slice.
            unsafe { (library().measure)(numbers, text.as_ptr(), text.len()) };
        }
    });
}

pub(crate) fn drain_numbers<'a>(heap: &JsHeap<'a>, numbers: JsLocal<'a, BufferSource>) -> u32 {
    with_numbers(heap, numbers, |numbers| {
        // SAFETY: a live slice.
        unsafe { (library().drain_numbers)(numbers.as_mut_ptr(), numbers.len()) as u32 }
    })
}

pub(crate) fn drain<'a>(heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a, JSString>> {
    let library = library();
    library.read((library.drain)(), |events| heap.create_utf8_string(events))
}

pub(crate) fn drain_microtasks(cx: &mut JsScope<'_>) {
    cx.global().bun_vm().drain_microtasks();
}

pub(crate) fn wait_for(cx: &mut JsScope<'_>, promise: JsLocal<'_>) {
    if let Some(promise) = promise.to_js().as_any_promise() {
        let _ = cx.global().bun_vm().wait_for_promise(promise);
    }
}

pub(crate) fn encode_text<'a>(
    heap: &JsHeap<'a>,
    label: &[u8],
    text: &[u8],
    for_query: bool,
) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
    use encoding_rs::EncoderResult;
    use std::io::Write as _;
    let (Some(label), Ok(mut rest)) = (
        crate::webcore::EncodingLabel::which(label),
        core::str::from_utf8(text),
    ) else {
        return heap.create_buffer(text);
    };
    let mut encoder = label.encoding_rs().output_encoding().new_encoder();
    let mut encoded = Vec::with_capacity(text.len() + 16);
    loop {
        let (result, read) =
            encoder.encode_from_utf8_to_vec_without_replacement(rest, &mut encoded, true);
        rest = &rest[read..];
        match result {
            EncoderResult::InputEmpty => return heap.create_buffer(&encoded),
            EncoderResult::OutputFull => encoded.reserve(rest.len() + 16),
            EncoderResult::Unmappable(it) if for_query => {
                let _ = write!(encoded, "%26%23{}%3B", it as u32);
            }
            EncoderResult::Unmappable(it) => {
                let _ = write!(encoded, "&#{};", it as u32);
            }
        }
    }
}

/// Blocks until the UI has events.
pub(crate) fn wait() {
    while !(library().pump)(NO_SOURCE, FOREVER, false) {}
}

pub(crate) fn present() {
    (library().present)();
}

pub(crate) fn put_blob(bytes: &[u8]) -> u32 {
    // SAFETY: a live slice, which is copied.
    unsafe { (library().put_blob)(bytes.as_ptr(), bytes.len()) }
}

pub(crate) fn take_blob<'a>(
    heap: &JsHeap<'a>,
    id: u32,
) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
    let library = library();
    library.read((library.take_blob)(id), |bytes| heap.create_buffer(bytes))
}

pub(crate) fn keep_alive(heap: &JsHeap<'_>, on: bool) {
    // SAFETY: reads the VM's state.
    let keep_alive = &state(unsafe { heap.global() }).keep_alive;
    if on {
        keep_alive.ref_(bun_io::js_vm_ctx());
    } else {
        keep_alive.unref(bun_io::js_vm_ctx());
    }
}

/// `app.requestSingleInstanceLock()` answers before it returns. False if nothing listens.
pub(crate) fn write_to_unix_socket(path: &[u8], message: &[u8]) -> bool {
    #[cfg(unix)]
    {
        use std::io::Write as _;
        use std::os::unix::ffi::OsStrExt as _;
        std::os::unix::net::UnixStream::connect(std::ffi::OsStr::from_bytes(path))
            .and_then(|mut stream| {
                stream.set_write_timeout(Some(core::time::Duration::from_secs(5)))?;
                // An instance that is stuck still holds the lock.
                let _ = stream.write_all(message);
                Ok(())
            })
            .is_ok()
    }
    #[cfg(not(unix))]
    {
        let _ = (path, message);
        false
    }
}

pub(crate) fn find_chrome() -> Option<Vec<u8>> {
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
pub(crate) fn map_resource(path: &[u8]) {
    const WORTHWHILE: usize = 32 << 10;
    let ships = resources_path().is_some_and(|it| {
        path.strip_prefix(&it[..]).is_some_and(|rest| {
            rest.starts_with(b"/") && !bun_core::strings::contains(rest, b"/../")
        })
    });
    if !ships || MAPPED.with_borrow(|all| all.iter().any(|it| *it.0 == *path)) {
        return;
    }
    let map = || {
        let file = bun_sys::File::openat(bun_sys::Fd::cwd(), path, bun_sys::O::RDONLY, 0).ok()?;
        let len = file.get_end_pos().ok().filter(|it| *it >= WORTHWHILE)?;
        let (prot, flags) = (libc::PROT_READ, libc::MAP_PRIVATE);
        let start = bun_sys::mmap(core::ptr::null_mut(), len, prot, flags, file.fd(), 0).ok()?;
        // SAFETY: never unmapped, and an installed program's files are replaced, not written to.
        Some(unsafe { core::slice::from_raw_parts(start.cast_const(), len) })
    };
    if let Some(bytes) = map() {
        MAPPED.with_borrow_mut(|all| all.push((path.into(), bytes)));
    }
}

#[cfg(not(unix))]
pub(crate) fn map_resource(_: &[u8]) {}

pub(crate) fn resources_path() -> Option<Vec<u8>> {
    bun_jsc::virtual_machine::standalone_module_graph()?;
    bundle::resources_in_bundle()
}
