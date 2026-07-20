use core::cell::UnsafeCell;
use core::ffi::{c_char, c_int, c_long, c_void};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_collections::VecExt;
use bun_core::zstr;
use bun_threading::{Mutex, Semaphore, UnboundedQueue};

// Both siblings are wired into `crate::node`, and intra-crate module cycles
// are fine in Rust, so import the real shapes instead of mirroring them.
use super::node_fs_watcher::Event;
use super::node_fs_watcher::WatchEventKind;

pub(crate) type CFAbsoluteTime = f64;
pub(crate) type CFTimeInterval = f64;

pub(crate) type FSEventStreamEventFlags = c_int;
pub(crate) type CFIndex = c_long;

pub(crate) type FSEventStreamCreateFlags = u32;
pub(crate) type FSEventStreamEventId = u64;

pub(crate) type CFArrayRef = *mut c_void;
pub(crate) type CFAllocatorRef = *mut c_void;
pub(crate) type CFRunLoopRef = *mut c_void;
pub(crate) type CFRunLoopSourceRef = *mut c_void;
pub(crate) type CFStringRef = *mut c_void;
pub(crate) type CFTypeRef = *mut c_void;
pub(crate) type FSEventStreamRef = *mut c_void;
pub(crate) type FSEventStreamCallback = unsafe extern "C" fn(
    FSEventStreamRef,
    *mut c_void,
    usize,
    *mut c_void,
    *mut FSEventStreamEventFlags,
    *mut FSEventStreamEventId,
);

// we only care about info and perform
#[repr(C)]
pub struct CFRunLoopSourceContext {
    pub version: CFIndex,
    pub info: *mut c_void,
    pub retain: Option<unsafe extern "C" fn(*const c_void) -> *const c_void>,
    pub release: Option<unsafe extern "C" fn(*const c_void)>,
    pub copy_description: Option<unsafe extern "C" fn(*const c_void) -> *mut c_void>,
    pub equal: Option<unsafe extern "C" fn(*const c_void, *const c_void) -> u8>,
    pub hash: Option<unsafe extern "C" fn(*const c_void) -> usize>,
    pub schedule: Option<unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void)>,
    pub cancel: Option<unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void)>,
    pub perform: unsafe extern "C" fn(*mut c_void),
}

#[repr(C)]
pub struct FSEventStreamContext {
    pub version: CFIndex,
    pub info: *mut c_void,
    pub pad: [*mut c_void; 3],
}

impl Default for FSEventStreamContext {
    fn default() -> Self {
        Self {
            version: 0,
            info: ptr::null_mut(),
            pad: [ptr::null_mut(); 3],
        }
    }
}

pub(crate) const K_FS_EVENT_STREAM_CREATE_FLAG_NO_DEFER: c_int = 2;
pub(crate) const K_FS_EVENT_STREAM_CREATE_FLAG_FILE_EVENTS: c_int = 16;

pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_CHANGE_OWNER: c_int = 0x4000;
pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_CREATED: c_int = 0x100;
pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_FINDER_INFO_MOD: c_int = 0x2000;
pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_INODE_META_MOD: c_int = 0x400;
pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_IS_DIR: c_int = 0x20000;
pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_MODIFIED: c_int = 0x1000;
pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_REMOVED: c_int = 0x200;
pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_RENAMED: c_int = 0x800;
pub(crate) const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_XATTR_MOD: c_int = 0x8000;

pub(crate) const K_FS_EVENTS_MODIFIED: c_int = K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_CHANGE_OWNER
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_FINDER_INFO_MOD
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_INODE_META_MOD
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_MODIFIED
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_XATTR_MOD;

pub(crate) const K_FS_EVENTS_RENAMED: c_int = K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_CREATED
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_REMOVED
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_RENAMED;

static FSEVENTS_DEFAULT_LOOP_MUTEX: Mutex = Mutex::new();
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
static FSEVENTS_DEFAULT_LOOP: std::sync::OnceLock<&'static FSEventsLoop> =
    std::sync::OnceLock::new();

#[cfg(unix)]
fn dlsym<T>(handle: *mut c_void, symbol: &core::ffi::CStr) -> Option<T> {
    const { assert!(core::mem::size_of::<T>() == core::mem::size_of::<*mut c_void>()) };
    // SAFETY: handle is a valid dlopen handle; symbol is NUL-terminated
    let ptr = unsafe { bun_sys::c::dlsym(handle, symbol.as_ptr()) };
    if ptr.is_null() {
        return None;
    }
    // SAFETY: genuine FFI — dlsym yields an opaque address that must be reinterpreted
    // as the symbol's true type. Callers monomorphise T to the matching `extern "C" fn`
    // (or pointer-sized data symbol) declared by CoreFoundation/CoreServices; the const
    // assert above enforces size parity, and the null check rules out the absent-symbol
    // case so the resulting fn pointer is always non-null. Not expressible via a
    // safe cast: fn pointers are not Pod and `as` can't cast data→fn pointers.
    Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&ptr) })
}
#[cfg(not(unix))]
fn dlsym<T>(_handle: *mut c_void, _symbol: &core::ffi::CStr) -> Option<T> {
    // FSEvents is macOS-only; CoreFoundation/CoreServices loaders below are
    // gated behind `target_os = "macos"`, so this body is unreachable on
    // Windows but must still type-check.
    None
}

// Clone/Copy: bitwise OK — `handle` is a leaked dlopen handle held for the
// process lifetime (never dlclosed); the rest are resolved fn pointers.
#[derive(Clone, Copy)]
pub struct CoreFoundation {
    pub handle: *mut c_void,
    pub array_create: unsafe extern "C" fn(
        CFAllocatorRef,
        *mut *mut c_void,
        CFIndex,
        *const c_void,
    ) -> CFArrayRef,
    pub retain: unsafe extern "C" fn(CFTypeRef) -> CFTypeRef,
    pub release: unsafe extern "C" fn(CFTypeRef),

    pub run_loop_add_source: unsafe extern "C" fn(CFRunLoopRef, CFRunLoopSourceRef, CFStringRef),
    pub run_loop_get_current: unsafe extern "C" fn() -> CFRunLoopRef,
    pub run_loop_remove_source: unsafe extern "C" fn(CFRunLoopRef, CFRunLoopSourceRef, CFStringRef),
    pub run_loop_run: unsafe extern "C" fn(),
    pub run_loop_source_create: unsafe extern "C" fn(
        CFAllocatorRef,
        CFIndex,
        *mut CFRunLoopSourceContext,
    ) -> CFRunLoopSourceRef,
    pub run_loop_source_signal: unsafe extern "C" fn(CFRunLoopSourceRef),
    pub run_loop_stop: unsafe extern "C" fn(CFRunLoopRef),
    pub run_loop_wake_up: unsafe extern "C" fn(CFRunLoopRef),
    pub string_create_with_file_system_representation:
        unsafe extern "C" fn(CFAllocatorRef, *const u8) -> CFStringRef,
    pub run_loop_default_mode: *const CFStringRef,
}

// SAFETY: `handle` is a leaked dlopen handle (never dlclosed) and `run_loop_default_mode` points at a process-static CFStringRef
// inside the loaded framework. Everything else is a resolved fn pointer.
// Sharing/sending bitwise copies across threads is sound.
unsafe impl Send for CoreFoundation {}
// SAFETY: all fields are immutable process-lifetime data (leaked dlopen handle,
// framework-static `*const CFStringRef`, resolved fn pointers); none provide
// interior mutability, so concurrent `&CoreFoundation` access is sound.
unsafe impl Sync for CoreFoundation {}

impl CoreFoundation {
    pub fn get() -> CoreFoundation {
        *FSEVENTS_CF.get_or_init(init_core_foundation)
    }
}

// Clone/Copy: bitwise OK — `handle` is a leaked dlopen handle held for the
// process lifetime (never dlclosed); the rest are resolved fn pointers.
#[derive(Clone, Copy)]
pub struct CoreServices {
    pub handle: *mut c_void,
    pub fs_event_stream_create: unsafe extern "C" fn(
        CFAllocatorRef,
        FSEventStreamCallback,
        *mut FSEventStreamContext,
        CFArrayRef,
        FSEventStreamEventId,
        CFTimeInterval,
        FSEventStreamCreateFlags,
    ) -> FSEventStreamRef,
    pub fs_event_stream_invalidate: unsafe extern "C" fn(FSEventStreamRef),
    pub fs_event_stream_release: unsafe extern "C" fn(FSEventStreamRef),
    pub fs_event_stream_schedule_with_run_loop:
        unsafe extern "C" fn(FSEventStreamRef, CFRunLoopRef, CFStringRef),
    pub fs_event_stream_start: unsafe extern "C" fn(FSEventStreamRef) -> c_int,
    pub fs_event_stream_stop: unsafe extern "C" fn(FSEventStreamRef),
    // libuv set it to -1 so the actual value is this
    pub k_fs_event_stream_event_id_since_now: FSEventStreamEventId,
}

// SAFETY: `handle` is a leaked dlopen handle (never dlclosed); the rest are
// resolved fn pointers and a u64 sentinel. Sharing/sending across threads is
// sound.
unsafe impl Send for CoreServices {}
// SAFETY: all fields are immutable process-lifetime data (leaked dlopen handle,
// resolved fn pointers, a `u64` constant); none provide interior mutability, so
// concurrent `&CoreServices` access is sound.
unsafe impl Sync for CoreServices {}

impl CoreServices {
    pub fn get() -> CoreServices {
        *FSEVENTS_CS.get_or_init(init_core_services)
    }
}

// Write-once fn-ptr tables; `OnceLock` provides the one-init + acquire/release
// publish that the prior RacyCell + hand-rolled double-checked-lock encoded.
static FSEVENTS_CF: std::sync::OnceLock<CoreFoundation> = std::sync::OnceLock::new();
static FSEVENTS_CS: std::sync::OnceLock<CoreServices> = std::sync::OnceLock::new();

fn init_core_foundation() -> CoreFoundation {
    let fsevents_cf_handle = bun_sys::dlopen(
        zstr!("/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"),
        bun_sys::RTLD::LAZY | bun_sys::RTLD::LOCAL,
    );
    let Some(fsevents_cf_handle) = fsevents_cf_handle else {
        panic!("Cannot Load CoreFoundation");
    };

    CoreFoundation {
        handle: fsevents_cf_handle,
        array_create: dlsym(fsevents_cf_handle, c"CFArrayCreate")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        retain: dlsym(fsevents_cf_handle, c"CFRetain")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        release: dlsym(fsevents_cf_handle, c"CFRelease")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_add_source: dlsym(fsevents_cf_handle, c"CFRunLoopAddSource")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_get_current: dlsym(fsevents_cf_handle, c"CFRunLoopGetCurrent")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_remove_source: dlsym(fsevents_cf_handle, c"CFRunLoopRemoveSource")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_run: dlsym(fsevents_cf_handle, c"CFRunLoopRun")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_source_create: dlsym(fsevents_cf_handle, c"CFRunLoopSourceCreate")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_source_signal: dlsym(fsevents_cf_handle, c"CFRunLoopSourceSignal")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_stop: dlsym(fsevents_cf_handle, c"CFRunLoopStop")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_wake_up: dlsym(fsevents_cf_handle, c"CFRunLoopWakeUp")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        string_create_with_file_system_representation: dlsym(
            fsevents_cf_handle,
            c"CFStringCreateWithFileSystemRepresentation",
        )
        .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
        run_loop_default_mode: dlsym(fsevents_cf_handle, c"kCFRunLoopDefaultMode")
            .unwrap_or_else(|| panic!("Cannot Load CoreFoundation")),
    }
}

fn init_core_services() -> CoreServices {
    let fsevents_cs_handle = bun_sys::dlopen(
        zstr!("/System/Library/Frameworks/CoreServices.framework/Versions/A/CoreServices"),
        bun_sys::RTLD::LAZY | bun_sys::RTLD::LOCAL,
    );
    let Some(fsevents_cs_handle) = fsevents_cs_handle else {
        panic!("Cannot Load CoreServices");
    };

    CoreServices {
        handle: fsevents_cs_handle,
        fs_event_stream_create: dlsym(fsevents_cs_handle, c"FSEventStreamCreate")
            .unwrap_or_else(|| panic!("Cannot Load CoreServices")),
        fs_event_stream_invalidate: dlsym(fsevents_cs_handle, c"FSEventStreamInvalidate")
            .unwrap_or_else(|| panic!("Cannot Load CoreServices")),
        fs_event_stream_release: dlsym(fsevents_cs_handle, c"FSEventStreamRelease")
            .unwrap_or_else(|| panic!("Cannot Load CoreServices")),
        fs_event_stream_schedule_with_run_loop: dlsym(
            fsevents_cs_handle,
            c"FSEventStreamScheduleWithRunLoop",
        )
        .unwrap_or_else(|| panic!("Cannot Load CoreServices")),
        fs_event_stream_start: dlsym(fsevents_cs_handle, c"FSEventStreamStart")
            .unwrap_or_else(|| panic!("Cannot Load CoreServices")),
        fs_event_stream_stop: dlsym(fsevents_cs_handle, c"FSEventStreamStop")
            .unwrap_or_else(|| panic!("Cannot Load CoreServices")),
        k_fs_event_stream_event_id_since_now: 18446744073709551615,
    }
}

pub struct FSEventsLoop {
    signal_source: AtomicPtr<c_void>,
    loop_: AtomicPtr<c_void>,
    mutex: Mutex,
    sem: Semaphore,
    tasks: UnboundedQueue<ConcurrentTask>,
    thread: UnsafeCell<Option<std::thread::JoinHandle<()>>>,
    state: UnsafeCell<FSEventsLoopState>,
}

struct FSEventsLoopState {
    watchers: Vec<Option<NonNull<FSEventsWatcher>>>,
    watcher_count: u32,
    has_scheduled_watchers: bool,
    fsevent_stream: FSEventStreamRef,
    paths: Option<Box<[*mut c_void]>>,
    cf_paths: CFArrayRef,
}

// SAFETY: cross-thread pointers are `AtomicPtr`; `state` is only accessed under `mutex`; `thread` is only touched by `init()`/`shutdown()` on the JS thread.
unsafe impl Sync for FSEventsLoop {}
// SAFETY: no thread-affine data; the loop is a leaked `&'static` singleton and all shared access is synchronized per the `Sync` impl above.
unsafe impl Send for FSEventsLoop {}

impl FSEventsLoop {
    #[inline]
    #[allow(clippy::mut_from_ref)]
    unsafe fn state(&self) -> &mut FSEventsLoopState {
        // SAFETY: the caller holds `self.mutex`, so this is the only live reference to `state`.
        unsafe { &mut *self.state.get() }
    }
}

pub struct Task {
    pub ctx: *mut (),
    pub callback: fn(*mut ()),
}

impl Task {
    pub fn run(&mut self) {
        let callback = self.callback;
        let ctx = self.ctx;
        debug_assert!(!ctx.is_null());
        callback(ctx);
    }

    pub fn new<T>(ctx: &'static T, callback: fn(&T)) -> Task {
        Task {
            // SAFETY: `fn(&T)` and `fn(*mut ())` have identical single-pointer ABI, and `ctx` is a valid `&T` at call time.
            callback: unsafe { bun_ptr::cast_fn_ptr::<fn(&T), fn(*mut ())>(callback) },
            ctx: core::ptr::from_ref::<T>(ctx).cast_mut().cast::<()>(),
        }
    }
}

pub struct ConcurrentTask {
    pub task: Task,
    pub next: bun_threading::Link<ConcurrentTask>,
    pub auto_delete: bool,
}

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue<ConcurrentTask>`.
unsafe impl bun_threading::Linked for ConcurrentTask {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

impl ConcurrentTask {
    pub(crate) fn from(
        this: &mut ConcurrentTask,
        task: Task,
        auto_delete: bool,
    ) -> &mut ConcurrentTask {
        *this = ConcurrentTask {
            task,
            next: bun_threading::Link::new(),
            auto_delete,
        };
        this
    }
}

impl FSEventsLoop {
    fn cf_thread_loop(&'static self) {
        bun_core::Output::Source::configure_named_thread(zstr!("CFThreadLoop"));

        let cf = CoreFoundation::get();
        let signal_source = self.signal_source.load(Ordering::Relaxed);

        // SAFETY: CF fn pointers loaded via dlsym; signal_source is valid
        unsafe {
            // Retain the run loop so it outlives this thread's pthread-TSD destructor; `shutdown()` releases it after `thread.join()`.
            let loop_ = (cf.retain)((cf.run_loop_get_current)());
            self.loop_.store(loop_, Ordering::Release);

            (cf.run_loop_add_source)(loop_, signal_source, *cf.run_loop_default_mode);

            self.sem.post();

            (cf.run_loop_run)();
            (cf.run_loop_remove_source)(loop_, signal_source, *cf.run_loop_default_mode);
        }
    }

    // Runs in CF thread, executed after `enqueueTaskConcurrent()`. Body
    // discharges its own preconditions; safe `extern "C" fn` coerces to the
    // `CFRunLoopSourceContext.perform` fn-pointer slot.
    extern "C" fn cf_loop_callback(arg: *mut c_void) {
        if arg.is_null() {
            return;
        }
        // SAFETY: `arg` is the leaked `&'static FSEventsLoop` set as `ctx.info` in `init()`.
        let this: &FSEventsLoop = unsafe { &*arg.cast::<FSEventsLoop>() };

        let concurrent = this.tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return;
        }

        let mut iter = concurrent.iterator();
        loop {
            let task = iter.next();
            if task.is_null() {
                break;
            }
            // SAFETY: task is a valid *mut ConcurrentTask from the queue
            let task = unsafe { &mut *task };
            task.task.run();
            if task.auto_delete {
                // SAFETY: was heap-allocated in enqueue_task_concurrent
                drop(unsafe { bun_core::heap::take(std::ptr::from_mut::<ConcurrentTask>(task)) });
            }
        }
    }

    pub fn init() -> crate::Result<&'static FSEventsLoop> {
        // Owning raw pointer first, shared view second: the error paths below reclaim
        // through `this_ptr`, which must not be derived from a shared reference.
        let this_ptr: *mut FSEventsLoop = bun_core::heap::into_raw(Box::new(FSEventsLoop {
            signal_source: AtomicPtr::new(ptr::null_mut()),
            loop_: AtomicPtr::new(ptr::null_mut()),
            mutex: Mutex::new(),
            sem: Semaphore::default(),
            tasks: UnboundedQueue::default(),
            thread: UnsafeCell::new(None),
            state: UnsafeCell::new(FSEventsLoopState {
                watchers: Vec::new(),
                watcher_count: 0,
                has_scheduled_watchers: false,
                fsevent_stream: ptr::null_mut(),
                paths: None,
                cf_paths: ptr::null_mut(),
            }),
        }));
        // SAFETY: just allocated and exclusively owned; the CF thread only sees it after spawn.
        let this: &'static FSEventsLoop = unsafe { &*this_ptr };

        let cf = CoreFoundation::get();

        let mut ctx = CFRunLoopSourceContext {
            version: 0,
            info: core::ptr::from_ref::<FSEventsLoop>(this)
                .cast_mut()
                .cast::<c_void>(),
            retain: None,
            release: None,
            copy_description: None,
            equal: None,
            hash: None,
            schedule: None,
            cancel: None,
            perform: Self::cf_loop_callback,
        };

        // SAFETY: ctx is stack-local and outlives the call; CF copies it
        let signal_source =
            unsafe { (cf.run_loop_source_create)(ptr::null_mut(), 0, &raw mut ctx) };
        if signal_source.is_null() {
            // SAFETY: nothing else has seen the allocation (published only on Ok).
            drop(unsafe { bun_core::heap::take(this_ptr) });
            return Err(crate::Error::FailedToCreateCoreFoudationSourceLoop);
        }
        this.signal_source.store(signal_source, Ordering::Relaxed);

        let handle = match std::thread::Builder::new()
            .name("CFThreadLoop".into())
            .spawn(move || this.cf_thread_loop())
        {
            Ok(handle) => handle,
            Err(_) => {
                // SAFETY: the source was never scheduled on a run loop and the allocation
                // was never published, so both are exclusively owned here.
                unsafe {
                    (cf.release)(signal_source.cast());
                    drop(bun_core::heap::take(this_ptr));
                }
                return Err(crate::Error::FailedToSpawnFSEventsThread);
            }
        };
        // SAFETY: `thread` is only touched by `init()`/`shutdown()` on the JS thread; the CF thread never accesses it.
        unsafe {
            *this.thread.get() = Some(handle);
        }

        // sync threads
        this.sem.wait();
        Ok(this)
    }

    fn enqueue_task_concurrent(&self, task: Task) {
        let cf = CoreFoundation::get();
        let concurrent = bun_core::heap::into_raw(Box::new(ConcurrentTask {
            task: Task {
                ctx: ptr::null_mut(),
                callback: |_| {},
            },
            next: bun_threading::Link::new(),
            auto_delete: false,
        }));
        // SAFETY: concurrent is a valid freshly-boxed non-null pointer
        unsafe {
            ConcurrentTask::from(&mut *concurrent, task, true);
            self.tasks.push(NonNull::new_unchecked(concurrent));
        }
        let signal_source = self.signal_source.load(Ordering::Relaxed);
        let loop_ = self.loop_.load(Ordering::Acquire);
        // SAFETY: CF fn pointers loaded via dlsym; handles valid per above.
        unsafe {
            (cf.run_loop_source_signal)(signal_source);
            (cf.run_loop_wake_up)(loop_);
        }
    }

    // Runs in CF thread, when there're events in FSEventStream. Body discharges
    // its own preconditions; safe `extern "C" fn` coerces to the
    // `FSEventStreamCallback` pointer type.
    extern "C" fn _events_cb(
        _: FSEventStreamRef,
        info: *mut c_void,
        num_events: usize,
        event_paths: *mut c_void,
        event_flags: *mut FSEventStreamEventFlags,
        _: *mut FSEventStreamEventId,
    ) {
        let paths_ptr = event_paths as *const *const c_char;
        // SAFETY: event_paths is a `char **` of length num_events per FSEvents API
        let paths = unsafe { bun_core::ffi::slice(paths_ptr, num_events) };
        // SAFETY: `info` is the leaked `&'static FSEventsLoop` set as `ctx.info` in `_schedule()`.
        let loop_: &FSEventsLoop = unsafe { &*info.cast::<FSEventsLoop>() };
        // SAFETY: event_flags is an array of length num_events per FSEvents API
        let event_flags = unsafe { bun_core::ffi::slice(event_flags.cast_const(), num_events) };

        // Hold the mutex for the whole iteration. `unregisterWatcher` on the
        // main thread nulls the entry under this same mutex and then the
        // caller immediately frees the FSEventsWatcher (and its path buffer),
        // so without this lock we can read `handle.path` / call `handle.emit`
        // on freed memory. Holding the lock also prevents `registerWatcher`
        // from reallocating the `watchers` buffer mid-iteration.
        let _guard = loop_.mutex.lock_guard();
        // SAFETY: holding `mutex` — see `FSEventsLoop::state`.
        let state = unsafe { loop_.state() };

        for watcher in state.watchers.slice() {
            let Some(handle) = *watcher else { continue };
            // `handle` is alive while held under the mutex (see comment above);
            // `BackRef` invariant (pointee outlives holder) holds for this
            // scope. `emit`/`flush` take `&self`, so a shared borrow suffices.
            let handle = bun_ptr::BackRef::from(handle);
            let handle_path = handle.path.slice();

            for (i, path_ptr) in paths.iter().enumerate() {
                let mut flags = event_flags[i];
                // SAFETY: each path_ptr is a NUL-terminated C string from FSEvents
                let mut path = unsafe { bun_core::ffi::cstr(*path_ptr) }.to_bytes();
                // Filter out paths that are outside handle's request
                if path.len() < handle_path.len() || !path.starts_with(handle_path) {
                    continue;
                }
                let is_file = (flags & K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_IS_DIR) == 0;

                // Remove common prefix, unless the watched folder is "/"
                if !(handle_path.len() == 1 && handle_path[0] == b'/') {
                    path = &path[handle_path.len()..];

                    // Ignore events with path equal to directory itself
                    if path.len() <= 1 && !is_file {
                        continue;
                    }

                    if path.is_empty() {
                        // Since we're using fsevents to watch the file itself handle_path == path, and we now need to get the basename of the file back
                        let basename = bun_core::strings::last_index_of_char(handle_path, b'/')
                            .unwrap_or(handle_path.len());
                        path = &handle_path[basename..];
                        // Created and Removed seem to be always set, but don't make sense
                        flags &= !K_FS_EVENTS_RENAMED;
                    }

                    if path.first() == Some(&b'/') {
                        // Skip forward slash
                        path = &path[1..];
                    }
                }

                // Do not emit events from subdirectories (without option set)
                if path.is_empty()
                    || (bun_core::strings::index_of_char_usize(path, b'/').is_some()
                        && !handle.recursive)
                {
                    continue;
                }

                let mut is_rename = true;

                if (flags & K_FS_EVENTS_RENAMED) == 0 {
                    if (flags & K_FS_EVENTS_MODIFIED) != 0 || is_file {
                        is_rename = false;
                    }
                }

                let event_type: WatchEventKind = if is_rename {
                    WatchEventKind::Rename
                } else {
                    WatchEventKind::Change
                };
                handle.emit(event_type.to_event(path.into()), is_file);
            }
            handle.flush();
        }
    }

    // Runs on CF Thread
    fn _schedule(&self) {
        let _guard = self.mutex.lock_guard();
        // SAFETY: holding `mutex` — see `FSEventsLoop::state`.
        let state = unsafe { self.state() };
        state.has_scheduled_watchers = false;
        let watcher_count = state.watcher_count;

        let cf = CoreFoundation::get();
        let cs = CoreServices::get();

        // SAFETY: all CF/CS calls below operate on handles we own
        unsafe {
            if !state.fsevent_stream.is_null() {
                let stream = state.fsevent_stream;
                // Stop emitting events
                (cs.fs_event_stream_stop)(stream);

                // Release stream
                (cs.fs_event_stream_invalidate)(stream);
                (cs.fs_event_stream_release)(stream);
                state.fsevent_stream = ptr::null_mut();
            }
            // clean old paths
            if let Some(p) = state.paths.take() {
                for s in p.iter() {
                    if !s.is_null() {
                        (cf.release)(*s);
                    }
                }
                drop(p);
            }
            if !state.cf_paths.is_null() {
                let cfp = state.cf_paths;
                state.cf_paths = ptr::null_mut();
                (cf.release)(cfp);
            }

            if watcher_count == 0 {
                return;
            }

            let mut paths: Box<[*mut c_void]> =
                vec![ptr::null_mut(); watcher_count as usize].into_boxed_slice();
            let mut count: u32 = 0;
            for w in state.watchers.slice() {
                if let Some(watcher) = *w {
                    // SAFETY: watcher alive under mutex; its `path` borrows from the
                    // owning PathWatcher, whose `ZBox` storage is NUL-terminated, so
                    // `as_ptr()` yields a valid C string for CF.
                    let watcher = &*watcher.as_ptr();
                    let path = (cf.string_create_with_file_system_representation)(
                        ptr::null_mut(),
                        watcher.path.slice().as_ptr().cast(),
                    );
                    paths[count as usize] = path;
                    count += 1;
                }
            }

            let cf_paths = (cf.array_create)(
                ptr::null_mut(),
                paths.as_mut_ptr(),
                count as CFIndex,
                ptr::null(),
            );
            let mut ctx = FSEventStreamContext {
                info: core::ptr::from_ref::<FSEventsLoop>(self)
                    .cast_mut()
                    .cast::<c_void>(),
                ..Default::default()
            };

            let latency: CFAbsoluteTime = 0.05;
            // Explanation of selected flags:
            // 1. NoDefer - without this flag, events that are happening continuously
            //    (i.e. each event is happening after time interval less than `latency`,
            //    counted from previous event), will be deferred and passed to callback
            //    once they'll either fill whole OS buffer, or when this continuous stream
            //    will stop (i.e. there'll be delay between events, bigger than
            //    `latency`).
            //    Specifying this flag will invoke callback after `latency` time passed
            //    since event.
            // 2. FileEvents - fire callback for file changes too (by default it is firing
            //    it only for directory changes).
            //
            let flags: FSEventStreamCreateFlags = (K_FS_EVENT_STREAM_CREATE_FLAG_NO_DEFER
                | K_FS_EVENT_STREAM_CREATE_FLAG_FILE_EVENTS)
                as FSEventStreamCreateFlags;

            //
            // NOTE: It might sound like a good idea to remember last seen StreamEventId,
            // but in reality one dir might have last StreamEventId less than, the other,
            // that is being watched now. Which will cause FSEventStream API to report
            // changes to files from the past.
            //
            let r#ref = (cs.fs_event_stream_create)(
                ptr::null_mut(),
                Self::_events_cb,
                &raw mut ctx,
                cf_paths,
                cs.k_fs_event_stream_event_id_since_now,
                latency,
                flags,
            );
            if r#ref.is_null() {
                // FSEventStreamCreate can fail under rapid stream churn (resource
                // exhaustion); passing NULL into ScheduleWithRunLoop crashes the CF thread.
                for s in &paths[..count as usize] {
                    if !s.is_null() {
                        (cf.release)(*s);
                    }
                }
                drop(paths);
                (cf.release)(cf_paths);
                return;
            }

            (cs.fs_event_stream_schedule_with_run_loop)(
                r#ref,
                self.loop_.load(Ordering::Relaxed),
                *cf.run_loop_default_mode,
            );
            if (cs.fs_event_stream_start)(r#ref) == 0 {
                //clean in case of failure
                for s in &paths[..count as usize] {
                    if !s.is_null() {
                        (cf.release)(*s);
                    }
                }
                drop(paths);
                (cf.release)(cf_paths);
                (cs.fs_event_stream_invalidate)(r#ref);
                (cs.fs_event_stream_release)(r#ref);
                return;
            }
            state.fsevent_stream = r#ref;
            state.paths = Some(paths);
            state.cf_paths = cf_paths;
        }
    }

    fn register_watcher(&'static self, watcher: *mut FSEventsWatcher) {
        let _guard = self.mutex.lock_guard();
        // SAFETY: holding `mutex` — see `FSEventsLoop::state`.
        let state = unsafe { self.state() };
        if state.watcher_count as usize == state.watchers.len() {
            state.watcher_count += 1;
            state.watchers.push(NonNull::new(watcher));
        } else {
            for w in state.watchers.slice_mut() {
                if w.is_none() {
                    *w = NonNull::new(watcher);
                    state.watcher_count += 1;
                    break;
                }
            }
        }

        if !state.has_scheduled_watchers {
            state.has_scheduled_watchers = true;
        } else {
            return;
        }
        self.enqueue_task_concurrent(Task::new(self, FSEventsLoop::_schedule));
    }

    fn unregister_watcher(&'static self, watcher: *mut FSEventsWatcher) {
        let _guard = self.mutex.lock_guard();
        // SAFETY: holding `mutex` — see `FSEventsLoop::state`.
        let state = unsafe { self.state() };
        let len = state.watchers.len() as usize;
        for i in 0..len {
            if let Some(item) = state.watchers.slice_mut()[i] {
                if item.as_ptr() == watcher {
                    state.watchers.slice_mut()[i] = None;
                    // if is the last one just pop
                    if i == len - 1 {
                        let _ = state.watchers.pop();
                    }
                    state.watcher_count -= 1;
                    break;
                }
            }
        }

        // Rebuild the FSEventStream on the CF thread so it stops firing for
        // the path we just removed. Without this the stream keeps delivering
        // events for freed paths until another register happens to
        // reschedule. `_events_cb` tolerates the interim (it sees `null` and
        // skips) because both sides hold `this.mutex`.
        if !state.has_scheduled_watchers {
            state.has_scheduled_watchers = true;
        } else {
            return;
        }
        self.enqueue_task_concurrent(Task::new(self, FSEventsLoop::_schedule));
    }

    // Runs on CF loop to close the loop
    fn _stop(&self) {
        let cf = CoreFoundation::get();
        // SAFETY: runs on the CF thread — this is our own run loop.
        unsafe { (cf.run_loop_stop)(self.loop_.load(Ordering::Relaxed)) };
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn shutdown(&'static self) {
        // SAFETY: `thread` is only touched here and in `init()`, always on the JS thread under `FSEVENTS_DEFAULT_LOOP_MUTEX`.
        let Some(thread) = (unsafe { (*self.thread.get()).take() }) else {
            return; // already shut down
        };
        // signal close and wait
        self.enqueue_task_concurrent(Task::new(self, FSEventsLoop::_stop));
        let _ = thread.join();

        let cf = CoreFoundation::get();
        let loop_ = self.loop_.swap(ptr::null_mut(), Ordering::Relaxed);
        debug_assert!(!loop_.is_null());
        // SAFETY: retained in `cf_thread_loop`; sole owner after join.
        unsafe { (cf.release)(loop_) };

        let signal_source = self.signal_source.swap(ptr::null_mut(), Ordering::Relaxed);
        debug_assert!(!signal_source.is_null());
        // SAFETY: signal_source is a valid CF object until released here
        unsafe { (cf.release)(signal_source) };

        let _guard = self.mutex.lock_guard();
        // SAFETY: holding `mutex` — see `FSEventsLoop::state`.
        let state = unsafe { self.state() };
        if state.watcher_count > 0 {
            while let Some(watcher) = state.watchers.pop() {
                if let Some(w) = watcher {
                    // `w` is a registered, not-yet-freed watcher; `BackRef`
                    // invariant holds. `loop_` is a `Cell`, so the write goes
                    // through a shared `&FSEventsWatcher` safely.
                    bun_ptr::BackRef::from(w).loop_.set(None);
                }
            }
        }
    }
}

pub struct FSEventsWatcher {
    /// Borrowed from the owning `PathWatcher`. The
    /// PathWatcher heap-allocates this watcher and only frees it after `Drop`
    /// (→ `unregister_watcher`) has run, so the bytes outlive every read in
    /// `_events_cb` / `_schedule` — `RawSlice` invariant. The backing buffer is
    /// a `ZBox`, so `path.slice().as_ptr()` is NUL-terminated (required by
    /// `CFStringCreateWithFileSystemRepresentation`).
    pub path: bun_ptr::RawSlice<u8>,
    pub callback: Callback,
    pub flush_callback: UpdateEndCallback,
    pub loop_: core::cell::Cell<Option<&'static FSEventsLoop>>,
    pub recursive: bool,
    pub ctx: *mut c_void,
}

pub type Callback = fn(ctx: *mut c_void, event: Event, is_file: bool);
pub(crate) type UpdateEndCallback = fn(ctx: *mut c_void);

impl FSEventsWatcher {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn init(
        loop_: &'static FSEventsLoop,
        path: &[u8],
        recursive: bool,
        callback: Callback,
        update_end: UpdateEndCallback,
        ctx: *mut c_void,
    ) -> Box<FSEventsWatcher> {
        let mut this = Box::new(FSEventsWatcher {
            path: bun_ptr::RawSlice::new(path),
            callback,
            flush_callback: update_end,
            loop_: core::cell::Cell::new(Some(loop_)),
            recursive,
            ctx,
        });

        loop_.register_watcher(&raw mut *this);
        this
    }

    pub(crate) fn emit(&self, event: Event, is_file: bool) {
        (self.callback)(self.ctx, event, is_file);
    }

    pub(crate) fn flush(&self) {
        (self.flush_callback)(self.ctx);
    }
}

impl Drop for FSEventsWatcher {
    fn drop(&mut self) {
        if let Some(loop_) = self.loop_.get() {
            loop_.unregister_watcher(std::ptr::from_mut(self));
        }
    }
}

pub fn watch(
    path: &[u8],
    recursive: bool,
    callback: Callback,
    update_end: UpdateEndCallback,
    ctx: *mut c_void,
) -> crate::Result<Box<FSEventsWatcher>> {
    if let Some(&loop_) = FSEVENTS_DEFAULT_LOOP.get() {
        return Ok(FSEventsWatcher::init(
            loop_, path, recursive, callback, update_end, ctx,
        ));
    }
    let _guard = FSEVENTS_DEFAULT_LOOP_MUTEX.lock_guard();
    let loop_: &'static FSEventsLoop = match FSEVENTS_DEFAULT_LOOP.get() {
        Some(&l) => l,
        None => {
            let l = FSEventsLoop::init()?;
            let _ = FSEVENTS_DEFAULT_LOOP.set(l);
            bun_core::Global::add_pre_exit_callback(close_and_wait_on_exit);
            l
        }
    };
    Ok(FSEventsWatcher::init(
        loop_, path, recursive, callback, update_end, ctx,
    ))
}

extern "C" fn close_and_wait_on_exit() {
    close_and_wait()
}

pub(crate) fn close_and_wait() {
    #[cfg(target_os = "macos")]
    if let Some(&loop_) = FSEVENTS_DEFAULT_LOOP.get() {
        let _guard = FSEVENTS_DEFAULT_LOOP_MUTEX.lock_guard();
        loop_.shutdown();
    }
}
