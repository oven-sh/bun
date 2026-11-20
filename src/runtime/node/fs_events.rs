use core::cell::UnsafeCell;
use core::ffi::{c_char, c_int, c_long, c_void};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_core::zstr;
use bun_ptr::AliasableBox;
use bun_threading::{Guarded, Mutex, Semaphore, UnboundedQueue};

// Both siblings are wired into `crate::node`, and intra-crate module cycles
// are fine in Rust, so import the real shapes instead of mirroring them.
use super::node_fs_watcher::WatchEventKind;
use super::path_watcher::PathWatcherManager;

type CFAbsoluteTime = f64;
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
pub(crate) struct CFRunLoopSourceContext {
    pub(crate) version: CFIndex,
    pub(crate) info: *mut c_void,
    pub(crate) retain: Option<unsafe extern "C" fn(*const c_void) -> *const c_void>,
    pub(crate) release: Option<unsafe extern "C" fn(*const c_void)>,
    pub(crate) copy_description: Option<unsafe extern "C" fn(*const c_void) -> *mut c_void>,
    pub(crate) equal: Option<unsafe extern "C" fn(*const c_void, *const c_void) -> u8>,
    pub(crate) hash: Option<unsafe extern "C" fn(*const c_void) -> usize>,
    pub(crate) schedule: Option<unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void)>,
    pub(crate) cancel: Option<unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void)>,
    pub(crate) perform: unsafe extern "C" fn(*mut c_void),
}

const K_FS_EVENT_STREAM_CREATE_FLAG_NO_DEFER: c_int = 2;
const K_FS_EVENT_STREAM_CREATE_FLAG_FILE_EVENTS: c_int = 16;

const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_CHANGE_OWNER: c_int = 0x4000;
const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_CREATED: c_int = 0x100;
const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_FINDER_INFO_MOD: c_int = 0x2000;
const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_INODE_META_MOD: c_int = 0x400;
const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_IS_DIR: c_int = 0x20000;
const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_MODIFIED: c_int = 0x1000;
const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_REMOVED: c_int = 0x200;
const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_RENAMED: c_int = 0x800;
const K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_XATTR_MOD: c_int = 0x8000;

const K_FS_EVENTS_MODIFIED: c_int = K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_CHANGE_OWNER
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_FINDER_INFO_MOD
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_INODE_META_MOD
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_MODIFIED
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_XATTR_MOD;

const K_FS_EVENTS_RENAMED: c_int = K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_CREATED
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_REMOVED
    | K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_RENAMED;

static FSEVENTS_DEFAULT_LOOP_MUTEX: Mutex = Mutex::new();
static FSEVENTS_DEFAULT_LOOP: std::sync::OnceLock<&'static FSEventsLoop> =
    std::sync::OnceLock::new();

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
    // case so the resulting fn pointer is always non-null. Not expressible via
    // `as`, which can't cast data→fn pointers.
    Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&ptr) })
}

// Clone/Copy: bitwise OK — resolved fn pointers plus a framework-static
// `*const CFStringRef`; the dlopen handle they came from is leaked (never
// dlclosed), so copies stay valid for the process lifetime.
#[derive(Clone, Copy)]
pub(crate) struct CoreFoundation {
    pub(crate) array_create: unsafe extern "C" fn(
        CFAllocatorRef,
        *mut *mut c_void,
        CFIndex,
        *const c_void,
    ) -> CFArrayRef,
    pub(crate) retain: unsafe extern "C" fn(CFTypeRef) -> CFTypeRef,
    pub(crate) release: unsafe extern "C" fn(CFTypeRef),

    pub(crate) run_loop_add_source:
        unsafe extern "C" fn(CFRunLoopRef, CFRunLoopSourceRef, CFStringRef),
    pub(crate) run_loop_get_current: unsafe extern "C" fn() -> CFRunLoopRef,
    pub(crate) run_loop_remove_source:
        unsafe extern "C" fn(CFRunLoopRef, CFRunLoopSourceRef, CFStringRef),
    pub(crate) run_loop_run: unsafe extern "C" fn(),
    pub(crate) run_loop_source_create: unsafe extern "C" fn(
        CFAllocatorRef,
        CFIndex,
        *mut CFRunLoopSourceContext,
    ) -> CFRunLoopSourceRef,
    pub(crate) run_loop_source_signal: unsafe extern "C" fn(CFRunLoopSourceRef),
    pub(crate) run_loop_stop: unsafe extern "C" fn(CFRunLoopRef),
    pub(crate) run_loop_wake_up: unsafe extern "C" fn(CFRunLoopRef),
    pub(crate) string_create_with_file_system_representation:
        unsafe extern "C" fn(CFAllocatorRef, *const u8) -> CFStringRef,
    pub(crate) run_loop_default_mode: *const CFStringRef,
}

// SAFETY: `run_loop_default_mode` points at a process-static CFStringRef
// inside the loaded (never-dlclosed) framework; every other field is a
// resolved fn pointer. Sharing/sending bitwise copies across threads is sound.
unsafe impl Send for CoreFoundation {}
// SAFETY: all fields are immutable process-lifetime data (framework-static
// `*const CFStringRef`, resolved fn pointers); none provide interior
// mutability, so concurrent `&CoreFoundation` access is sound.
unsafe impl Sync for CoreFoundation {}

impl CoreFoundation {
    pub(crate) fn get() -> CoreFoundation {
        *FSEVENTS_CF.get_or_init(init_core_foundation)
    }
}

// Clone/Copy: bitwise OK — resolved fn pointers (from a leaked, never-dlclosed
// dlopen handle) plus a `u64` sentinel.
#[derive(Clone, Copy)]
pub(crate) struct CoreServices {
    pub(crate) fs_event_stream_create: unsafe extern "C" fn(
        CFAllocatorRef,
        FSEventStreamCallback,
        *mut c_void,
        CFArrayRef,
        FSEventStreamEventId,
        CFTimeInterval,
        FSEventStreamCreateFlags,
    ) -> FSEventStreamRef,
    pub(crate) fs_event_stream_invalidate: unsafe extern "C" fn(FSEventStreamRef),
    pub(crate) fs_event_stream_release: unsafe extern "C" fn(FSEventStreamRef),
    pub(crate) fs_event_stream_schedule_with_run_loop:
        unsafe extern "C" fn(FSEventStreamRef, CFRunLoopRef, CFStringRef),
    pub(crate) fs_event_stream_start: unsafe extern "C" fn(FSEventStreamRef) -> c_int,
    pub(crate) fs_event_stream_stop: unsafe extern "C" fn(FSEventStreamRef),
    // libuv set it to -1 so the actual value is this
    pub(crate) k_fs_event_stream_event_id_since_now: FSEventStreamEventId,
}

impl CoreServices {
    pub(crate) fn get() -> CoreServices {
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

pub(crate) struct FSEventsLoop {
    signal_source: AtomicPtr<c_void>,
    loop_: AtomicPtr<c_void>,
    mutex: Guarded<FSEventsLoopState>,
    sem: Semaphore,
    tasks: UnboundedQueue<ConcurrentTask>,
    thread: UnsafeCell<Option<std::thread::JoinHandle<()>>>,
}

struct FSEventsLoopState {
    has_scheduled_watchers: bool,
    stream: Option<StartedStream>,
}

/// The array does not retain the strings in it.
struct StreamPaths {
    strings: Vec<CFStringRef>,
    array: CFArrayRef,
}

impl Drop for StreamPaths {
    fn drop(&mut self) {
        let cf = CoreFoundation::get();
        for &object in self.strings.iter().chain([&self.array]) {
            if !object.is_null() {
                // SAFETY: from a `Create` function, and released nowhere else.
                unsafe { (cf.release)(object) };
            }
        }
    }
}

struct EventStream(NonNull<c_void>);

impl Drop for EventStream {
    fn drop(&mut self) {
        let cs = CoreServices::get();
        // SAFETY: from `FSEventStreamCreate`, and scheduled on the run loop of this thread.
        unsafe {
            (cs.fs_event_stream_invalidate)(self.0.as_ptr());
            (cs.fs_event_stream_release)(self.0.as_ptr());
        }
    }
}

struct StartedStream {
    stream: EventStream,
    _paths: StreamPaths,
}

impl Drop for StartedStream {
    fn drop(&mut self) {
        // SAFETY: `FSEventStreamStart` succeeded.
        unsafe { (CoreServices::get().fs_event_stream_stop)(self.stream.0.as_ptr()) };
    }
}

// SAFETY: cross-thread pointers are `AtomicPtr`; the pointers in `FSEventsLoopState` are only used under `mutex`; `thread` is only touched by `init()`/`shutdown()` on the JS thread.
unsafe impl Sync for FSEventsLoop {}

pub(crate) struct Task {
    pub ctx: &'static FSEventsLoop,
    pub callback: fn(&FSEventsLoop),
}

impl Task {
    pub(crate) fn run(&mut self) {
        (self.callback)(self.ctx);
    }

    pub(crate) fn new(ctx: &'static FSEventsLoop, callback: fn(&FSEventsLoop)) -> Task {
        Task { ctx, callback }
    }
}

pub(crate) struct ConcurrentTask {
    pub task: Task,
    pub(crate) next: bun_threading::Link<ConcurrentTask>,
}

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue<ConcurrentTask>`.
unsafe impl bun_threading::Linked for ConcurrentTask {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
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
            // SAFETY: heap-allocated in `enqueue_task_concurrent`; this thread
            // owns it exclusively once popped.
            unsafe { bun_core::heap::take(task) }.task.run();
        }
    }

    pub(crate) fn init() -> crate::Result<&'static FSEventsLoop> {
        let owned = AliasableBox::new(FSEventsLoop {
            signal_source: AtomicPtr::new(ptr::null_mut()),
            loop_: AtomicPtr::new(ptr::null_mut()),
            sem: Semaphore::default(),
            tasks: UnboundedQueue::default(),
            thread: UnsafeCell::new(None),
            mutex: Guarded::new(FSEventsLoopState {
                has_scheduled_watchers: false,
                stream: None,
            }),
        });
        // SAFETY: leaked once the CF thread has it, and not used after an early return.
        let this: &'static FSEventsLoop = unsafe { &*owned.as_ptr() };

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
            return Err(crate::Error::FailedToCreateCoreFoudationSourceLoop);
        }
        this.signal_source.store(signal_source, Ordering::Relaxed);

        let handle = match std::thread::Builder::new()
            .name("CFThreadLoop".into())
            .spawn(move || this.cf_thread_loop())
        {
            Ok(handle) => handle,
            Err(_) => {
                // SAFETY: the source was never scheduled on a run loop.
                unsafe { (cf.release)(signal_source.cast()) };
                return Err(crate::Error::FailedToSpawnFSEventsThread);
            }
        };
        owned.into_raw();
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
        self.tasks.push(bun_core::heap::alloc_nn(ConcurrentTask {
            task,
            next: bun_threading::Link::new(),
        }));
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
    extern "C" fn events_cb(
        _: FSEventStreamRef,
        _: *mut c_void,
        num_events: usize,
        event_paths: *mut c_void,
        event_flags: *mut FSEventStreamEventFlags,
        _: *mut FSEventStreamEventId,
    ) {
        let paths_ptr = event_paths as *const *const c_char;
        // SAFETY: event_paths is a `char **` of length num_events per FSEvents API
        let paths = unsafe { bun_core::ffi::slice(paths_ptr, num_events) };
        // SAFETY: event_flags is an array of length num_events per FSEvents API
        let event_flags = unsafe { bun_core::ffi::slice(event_flags.cast_const(), num_events) };

        for watcher in PathWatcherManager::lock().watchers() {
            let watcher_path = watcher.path.as_bytes();

            for (i, path_ptr) in paths.iter().enumerate() {
                let mut flags = event_flags[i];
                // SAFETY: each path_ptr is a NUL-terminated C string from FSEvents
                let mut path = unsafe { bun_core::ffi::cstr(*path_ptr) }.to_bytes();
                // Filter out paths that are outside watcher's request
                if path.len() < watcher_path.len() || !path.starts_with(watcher_path) {
                    continue;
                }
                let is_file = (flags & K_FS_EVENT_STREAM_EVENT_FLAG_ITEM_IS_DIR) == 0;

                // Remove common prefix, unless the watched folder is "/"
                if !(watcher_path.len() == 1 && watcher_path[0] == b'/') {
                    path = &path[watcher_path.len()..];

                    // Ignore events with path equal to directory itself
                    if path.len() <= 1 && !is_file {
                        continue;
                    }

                    if path.is_empty() {
                        // Since we're using fsevents to watch the file itself watcher_path == path, and we now need to get the basename of the file back
                        let basename = bun_core::strings::last_index_of_char(watcher_path, b'/')
                            .unwrap_or(watcher_path.len());
                        path = &watcher_path[basename..];
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
                        && !watcher.recursive)
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
                watcher.emit(event_type, path, is_file);
            }
            watcher.flush();
        }
    }

    // Runs on CF Thread
    fn schedule(&self) {
        let mut state = self.mutex.lock();
        state.has_scheduled_watchers = false;
        state.stream = None;

        let cf = CoreFoundation::get();
        let cs = CoreServices::get();

        // SAFETY: all CF/CS calls below operate on handles we own
        unsafe {
            let manager = PathWatcherManager::lock();
            let mut paths = StreamPaths {
                strings: Vec::with_capacity(manager.watcher_count()),
                array: ptr::null_mut(),
            };
            for watcher in manager.watchers() {
                // SAFETY: a `ZBox` is NUL-terminated.
                paths
                    .strings
                    .push((cf.string_create_with_file_system_representation)(
                        ptr::null_mut(),
                        watcher.path.as_ptr().cast(),
                    ));
            }
            drop(manager);
            if paths.strings.is_empty() {
                return;
            }

            paths.array = (cf.array_create)(
                ptr::null_mut(),
                paths.strings.as_mut_ptr(),
                paths.strings.len() as CFIndex,
                ptr::null(),
            );
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
                Self::events_cb,
                ptr::null_mut(),
                paths.array,
                cs.k_fs_event_stream_event_id_since_now,
                latency,
                flags,
            );
            let Some(stream) = NonNull::new(r#ref).map(EventStream) else {
                // FSEventStreamCreate can fail under rapid stream churn (resource
                // exhaustion); passing NULL into ScheduleWithRunLoop crashes the CF thread.
                return;
            };

            (cs.fs_event_stream_schedule_with_run_loop)(
                r#ref,
                self.loop_.load(Ordering::Relaxed),
                *cf.run_loop_default_mode,
            );
            if (cs.fs_event_stream_start)(r#ref) != 0 {
                state.stream = Some(StartedStream {
                    stream,
                    _paths: paths,
                });
            }
        }
    }

    fn reschedule(&'static self) {
        let mut state = self.mutex.lock();
        if !state.has_scheduled_watchers {
            state.has_scheduled_watchers = true;
        } else {
            return;
        }
        self.enqueue_task_concurrent(Task::new(self, FSEventsLoop::schedule));
    }

    // Runs on CF loop to close the loop
    fn stop(&self) {
        let cf = CoreFoundation::get();
        // SAFETY: runs on the CF thread — this is our own run loop.
        unsafe { (cf.run_loop_stop)(self.loop_.load(Ordering::Relaxed)) };
    }

    fn shutdown(&'static self) {
        // SAFETY: `thread` is only touched here and in `init()`, always on the JS thread under `FSEVENTS_DEFAULT_LOOP_MUTEX`.
        let Some(thread) = (unsafe { (*self.thread.get()).take() }) else {
            return; // already shut down
        };
        // signal close and wait
        self.enqueue_task_concurrent(Task::new(self, FSEventsLoop::stop));
        let _ = thread.join();
        // From here on `reschedule` returns before it signals `signal_source` and `loop_`, released below.
        self.mutex.lock().has_scheduled_watchers = true;

        let cf = CoreFoundation::get();
        let loop_ = self.loop_.swap(ptr::null_mut(), Ordering::Relaxed);
        debug_assert!(!loop_.is_null());
        // SAFETY: retained in `cf_thread_loop`; sole owner after join.
        unsafe { (cf.release)(loop_) };

        let signal_source = self.signal_source.swap(ptr::null_mut(), Ordering::Relaxed);
        debug_assert!(!signal_source.is_null());
        // SAFETY: signal_source is a valid CF object until released here
        unsafe { (cf.release)(signal_source) };
    }
}

pub(crate) fn start() -> crate::Result<()> {
    if FSEVENTS_DEFAULT_LOOP.get().is_some() {
        return Ok(());
    }
    let _guard = FSEVENTS_DEFAULT_LOOP_MUTEX.lock_guard();
    if FSEVENTS_DEFAULT_LOOP.get().is_none() {
        let _ = FSEVENTS_DEFAULT_LOOP.set(FSEventsLoop::init()?);
        bun_core::Global::add_pre_exit_callback(close_and_wait_on_exit);
    }
    Ok(())
}

/// Rebuilds the stream for the paths that are watched now.
pub(crate) fn reschedule() {
    FSEVENTS_DEFAULT_LOOP.wait().reschedule();
}

extern "C" fn close_and_wait_on_exit() {
    close_and_wait()
}

fn close_and_wait() {
    if let Some(&loop_) = FSEVENTS_DEFAULT_LOOP.get() {
        let _guard = FSEVENTS_DEFAULT_LOOP_MUTEX.lock_guard();
        loop_.shutdown();
    }
}
