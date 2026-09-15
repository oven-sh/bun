//! The CoreFoundation / FSEvents (CoreServices) entry points `fs.watch()` uses
//! on macOS, resolved once with `dlopen`/`dlsym` (Bun does not link the
//! frameworks), behind owned handle types and typed callbacks so callers need
//! no `unsafe`.
//!
//! Only the surface `bun_runtime::node::fs_events` needs is here: a run loop
//! with one custom source to wake it, and one `FSEventStream` at a time.

use core::ffi::{CStr, c_char, c_long, c_void};
use core::ptr::{self, NonNull};
use std::sync::OnceLock;

use bun_core::{ZStr, zstr};

type CFIndex = c_long;
type CFTimeInterval = f64;
type CFTypeRef = *mut c_void;
type CFAllocatorRef = *mut c_void;
type CFArrayRef = *mut c_void;
type CFStringRef = *mut c_void;
type CFRunLoopRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type FSEventStreamRef = *mut c_void;

pub type FSEventStreamEventFlags = u32;
pub type FSEventStreamCreateFlags = u32;
pub type FSEventStreamEventId = u64;

/// `kFSEventStreamEventIdSinceNow`.
pub const EVENT_ID_SINCE_NOW: FSEventStreamEventId = u64::MAX;

/// `kFSEventStreamCreateFlag*`.
pub mod create_flags {
    pub const NO_DEFER: u32 = 0x2;
    pub const FILE_EVENTS: u32 = 0x10;
}

/// `kFSEventStreamEventFlagItem*`.
pub mod event_flags {
    pub const ITEM_CREATED: u32 = 0x100;
    pub const ITEM_REMOVED: u32 = 0x200;
    pub const ITEM_INODE_META_MOD: u32 = 0x400;
    pub const ITEM_RENAMED: u32 = 0x800;
    pub const ITEM_MODIFIED: u32 = 0x1000;
    pub const ITEM_FINDER_INFO_MOD: u32 = 0x2000;
    pub const ITEM_CHANGE_OWNER: u32 = 0x4000;
    pub const ITEM_XATTR_MOD: u32 = 0x8000;
    pub const ITEM_IS_DIR: u32 = 0x20000;
}

type FSEventStreamCallback = extern "C" fn(
    FSEventStreamRef,
    *mut c_void,
    usize,
    *mut c_void,
    *const FSEventStreamEventFlags,
    *const FSEventStreamEventId,
);

#[repr(C)]
struct CFRunLoopSourceContext {
    version: CFIndex,
    info: *mut c_void,
    retain: Option<extern "C" fn(*const c_void) -> *const c_void>,
    release: Option<extern "C" fn(*const c_void)>,
    copy_description: Option<extern "C" fn(*const c_void) -> *mut c_void>,
    equal: Option<extern "C" fn(*const c_void, *const c_void) -> u8>,
    hash: Option<extern "C" fn(*const c_void) -> usize>,
    schedule: Option<extern "C" fn(*mut c_void, *mut c_void, *mut c_void)>,
    cancel: Option<extern "C" fn(*mut c_void, *mut c_void, *mut c_void)>,
    perform: extern "C" fn(*mut c_void),
}

#[repr(C)]
struct FSEventStreamContext {
    version: CFIndex,
    info: *mut c_void,
    retain: *mut c_void,
    release: *mut c_void,
    copy_description: *mut c_void,
}

struct Fns {
    array_create: unsafe extern "C" fn(
        CFAllocatorRef,
        *const *const c_void,
        CFIndex,
        *const c_void,
    ) -> CFArrayRef,
    retain: unsafe extern "C" fn(CFTypeRef) -> CFTypeRef,
    release: unsafe extern "C" fn(CFTypeRef),
    run_loop_add_source: unsafe extern "C" fn(CFRunLoopRef, CFRunLoopSourceRef, CFStringRef),
    run_loop_get_current: unsafe extern "C" fn() -> CFRunLoopRef,
    run_loop_remove_source: unsafe extern "C" fn(CFRunLoopRef, CFRunLoopSourceRef, CFStringRef),
    run_loop_run: unsafe extern "C" fn(),
    run_loop_source_create: unsafe extern "C" fn(
        CFAllocatorRef,
        CFIndex,
        *mut CFRunLoopSourceContext,
    ) -> CFRunLoopSourceRef,
    run_loop_source_signal: unsafe extern "C" fn(CFRunLoopSourceRef),
    run_loop_stop: unsafe extern "C" fn(CFRunLoopRef),
    run_loop_wake_up: unsafe extern "C" fn(CFRunLoopRef),
    string_create_with_file_system_representation:
        unsafe extern "C" fn(CFAllocatorRef, *const c_char) -> CFStringRef,
    run_loop_default_mode: *const CFStringRef,

    fs_event_stream_create: unsafe extern "C" fn(
        CFAllocatorRef,
        FSEventStreamCallback,
        *const FSEventStreamContext,
        CFArrayRef,
        FSEventStreamEventId,
        CFTimeInterval,
        FSEventStreamCreateFlags,
    ) -> FSEventStreamRef,
    fs_event_stream_invalidate: unsafe extern "C" fn(FSEventStreamRef),
    fs_event_stream_release: unsafe extern "C" fn(FSEventStreamRef),
    fs_event_stream_schedule_with_run_loop:
        unsafe extern "C" fn(FSEventStreamRef, CFRunLoopRef, CFStringRef),
    fs_event_stream_start: unsafe extern "C" fn(FSEventStreamRef) -> u8,
    fs_event_stream_stop: unsafe extern "C" fn(FSEventStreamRef),
}

// SAFETY: a table of resolved function pointers plus `kCFRunLoopDefaultMode`'s
// address inside the (never unloaded) framework image; immutable once built.
unsafe impl Send for Fns {}
// SAFETY: as above.
unsafe impl Sync for Fns {}

static FNS: OnceLock<Fns> = OnceLock::new();

fn fns() -> &'static Fns {
    FNS.get_or_init(load)
}

/// Resolve `name` in `handle` as a `T`.
///
/// # Safety
/// `T` is the (pointer-sized) C type the framework declares for `name`.
unsafe fn sym<T>(handle: *mut c_void, name: &CStr, framework: &str) -> T {
    const { assert!(core::mem::size_of::<T>() == core::mem::size_of::<*mut c_void>()) };
    let Some(p) = crate::dlsym_impl(Some(handle), ZStr::from_cstr(name)) else {
        panic!("Cannot Load {framework}");
    };
    // SAFETY: `p` is the non-null address `dlsym` resolved for `name`, and the
    // caller vouches that `T` is that symbol's type.
    unsafe { core::mem::transmute_copy::<*mut c_void, T>(&p) }
}

fn load() -> Fns {
    let Some(cf) = crate::dlopen(
        zstr!("/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"),
        crate::RTLD::LAZY | crate::RTLD::LOCAL,
    ) else {
        panic!("Cannot Load CoreFoundation");
    };
    let Some(cs) = crate::dlopen(
        zstr!("/System/Library/Frameworks/CoreServices.framework/Versions/A/CoreServices"),
        crate::RTLD::LAZY | crate::RTLD::LOCAL,
    ) else {
        panic!("Cannot Load CoreServices");
    };
    const CF: &str = "CoreFoundation";
    const CS: &str = "CoreServices";
    // SAFETY: each field's type is the signature CFRunLoop.h / CFArray.h /
    // CFString.h / FSEvents.h declare for the symbol it is loaded from.
    unsafe {
        Fns {
            array_create: sym(cf, c"CFArrayCreate", CF),
            retain: sym(cf, c"CFRetain", CF),
            release: sym(cf, c"CFRelease", CF),
            run_loop_add_source: sym(cf, c"CFRunLoopAddSource", CF),
            run_loop_get_current: sym(cf, c"CFRunLoopGetCurrent", CF),
            run_loop_remove_source: sym(cf, c"CFRunLoopRemoveSource", CF),
            run_loop_run: sym(cf, c"CFRunLoopRun", CF),
            run_loop_source_create: sym(cf, c"CFRunLoopSourceCreate", CF),
            run_loop_source_signal: sym(cf, c"CFRunLoopSourceSignal", CF),
            run_loop_stop: sym(cf, c"CFRunLoopStop", CF),
            run_loop_wake_up: sym(cf, c"CFRunLoopWakeUp", CF),
            string_create_with_file_system_representation: sym(
                cf,
                c"CFStringCreateWithFileSystemRepresentation",
                CF,
            ),
            run_loop_default_mode: sym(cf, c"kCFRunLoopDefaultMode", CF),

            fs_event_stream_create: sym(cs, c"FSEventStreamCreate", CS),
            fs_event_stream_invalidate: sym(cs, c"FSEventStreamInvalidate", CS),
            fs_event_stream_release: sym(cs, c"FSEventStreamRelease", CS),
            fs_event_stream_schedule_with_run_loop: sym(
                cs,
                c"FSEventStreamScheduleWithRunLoop",
                CS,
            ),
            fs_event_stream_start: sym(cs, c"FSEventStreamStart", CS),
            fs_event_stream_stop: sym(cs, c"FSEventStreamStop", CS),
        }
    }
}

impl Fns {
    #[inline]
    fn default_mode(&self) -> CFStringRef {
        // SAFETY: `run_loop_default_mode` is the address of the framework's
        // `kCFRunLoopDefaultMode` constant, valid for the life of the process.
        unsafe { *self.run_loop_default_mode }
    }
}

/// Resolve every entry point now (the first use does this lazily otherwise).
/// Panics if either framework cannot be loaded.
pub fn ensure_loaded() {
    let _ = fns();
}

// ─── CFString / CFArray ─────────────────────────────────────────────────────

/// An owned reference to a `CFString`.
pub struct CFString(NonNull<c_void>);

impl CFString {
    /// `CFStringCreateWithFileSystemRepresentation`.
    pub fn from_file_system_path(path: &ZStr) -> Option<CFString> {
        // SAFETY: `path` is NUL-terminated; a NULL allocator selects the default.
        let s = unsafe {
            (fns().string_create_with_file_system_representation)(
                ptr::null_mut(),
                path.as_ptr().cast::<c_char>(),
            )
        };
        NonNull::new(s).map(CFString)
    }
}

impl Drop for CFString {
    fn drop(&mut self) {
        // SAFETY: we own the +1 `Create` returned.
        unsafe { (fns().release)(self.0.as_ptr()) }
    }
}

// SAFETY: an immutable CFString is safe to use and release from any thread.
unsafe impl Send for CFString {}

/// An owned `CFArray` of [`CFString`]s. The array is created without retain
/// callbacks, so the strings are kept alive alongside it and released with it.
pub struct CFStringArray {
    array: NonNull<c_void>,
    _strings: Vec<CFString>,
}

impl CFStringArray {
    pub fn new(strings: Vec<CFString>) -> Option<CFStringArray> {
        let values: Vec<*const c_void> =
            strings.iter().map(|s| s.0.as_ptr().cast_const()).collect();
        // SAFETY: `values` holds `values.len()` valid CFStringRefs; NULL
        // callbacks make the array a plain pointer vector (no retain/release).
        let array = unsafe {
            (fns().array_create)(
                ptr::null_mut(),
                values.as_ptr(),
                values.len() as CFIndex,
                ptr::null(),
            )
        };
        NonNull::new(array).map(|array| CFStringArray {
            array,
            _strings: strings,
        })
    }
}

impl Drop for CFStringArray {
    fn drop(&mut self) {
        // SAFETY: we own the +1 `CFArrayCreate` returned; the element strings
        // are released afterwards by `_strings`.
        unsafe { (fns().release)(self.array.as_ptr()) }
    }
}

// SAFETY: an immutable CFArray of immutable CFStrings; usable from any thread.
unsafe impl Send for CFStringArray {}

// ─── CFRunLoop / CFRunLoopSource ────────────────────────────────────────────

/// A retained reference to a thread's `CFRunLoop`.
pub struct RunLoop(NonNull<c_void>);

impl RunLoop {
    /// The calling thread's run loop, retained so the reference outlives the
    /// thread's own teardown of it.
    pub fn current() -> RunLoop {
        let f = fns();
        // SAFETY: `CFRunLoopGetCurrent` never returns NULL; `CFRetain` on it
        // gives us our own reference.
        let rl = unsafe { (f.retain)((f.run_loop_get_current)()) };
        RunLoop(NonNull::new(rl).expect("CFRunLoopGetCurrent"))
    }

    /// `CFRunLoopRun` on the calling thread; returns once the loop is stopped.
    pub fn run_current() {
        // SAFETY: no preconditions.
        unsafe { (fns().run_loop_run)() }
    }

    /// `CFRunLoopStop` (callable from any thread).
    pub fn stop(&self) {
        // SAFETY: `self.0` is a live run loop we hold a reference to.
        unsafe { (fns().run_loop_stop)(self.0.as_ptr()) }
    }

    /// `CFRunLoopWakeUp` (callable from any thread).
    pub fn wake_up(&self) {
        // SAFETY: as `stop`.
        unsafe { (fns().run_loop_wake_up)(self.0.as_ptr()) }
    }

    /// Add `source` to this run loop's default mode.
    pub fn add_source(&self, source: &RunLoopSource) {
        let f = fns();
        // SAFETY: both handles are live references we hold.
        unsafe { (f.run_loop_add_source)(self.0.as_ptr(), source.0.as_ptr(), f.default_mode()) }
    }

    /// Remove `source` from this run loop's default mode.
    pub fn remove_source(&self, source: &RunLoopSource) {
        let f = fns();
        // SAFETY: both handles are live references we hold.
        unsafe { (f.run_loop_remove_source)(self.0.as_ptr(), source.0.as_ptr(), f.default_mode()) }
    }
}

impl Drop for RunLoop {
    fn drop(&mut self) {
        // SAFETY: releases the reference `current` retained.
        unsafe { (fns().release)(self.0.as_ptr()) }
    }
}

// SAFETY: `CFRunLoopStop`, `CFRunLoopWakeUp` and `CFRunLoopAddSource` are the
// documented cross-thread operations on a run loop, and the reference itself is
// a thread-safe retain count.
unsafe impl Send for RunLoop {}
// SAFETY: as above.
unsafe impl Sync for RunLoop {}

/// The `perform` callback of a [`RunLoopSource`]: runs on the run loop's
/// thread after the source is signalled and the loop woken.
pub trait RunLoopSourceHandler: Sync + 'static {
    fn perform(&'static self);
}

/// An owned version-0 `CFRunLoopSource` whose `perform` calls a
/// [`RunLoopSourceHandler`].
pub struct RunLoopSource(NonNull<c_void>);

impl RunLoopSource {
    pub fn new<H: RunLoopSourceHandler>(handler: &'static H) -> Option<RunLoopSource> {
        extern "C" fn perform<H: RunLoopSourceHandler>(info: *mut c_void) {
            // SAFETY: `info` is the `&'static H` stored in the context below.
            let handler: &'static H = unsafe { &*info.cast::<H>() };
            handler.perform();
        }
        let mut ctx = CFRunLoopSourceContext {
            version: 0,
            info: ptr::from_ref::<H>(handler).cast_mut().cast::<c_void>(),
            retain: None,
            release: None,
            copy_description: None,
            equal: None,
            hash: None,
            schedule: None,
            cancel: None,
            perform: perform::<H>,
        };
        // SAFETY: `ctx` is a valid version-0 context for the duration of the
        // call (CF copies it).
        let source = unsafe { (fns().run_loop_source_create)(ptr::null_mut(), 0, &raw mut ctx) };
        NonNull::new(source).map(RunLoopSource)
    }

    /// `CFRunLoopSourceSignal` (callable from any thread; wake the run loop
    /// afterwards to have `perform` run promptly).
    pub fn signal(&self) {
        // SAFETY: `self.0` is the live source we own.
        unsafe { (fns().run_loop_source_signal)(self.0.as_ptr()) }
    }
}

impl Drop for RunLoopSource {
    fn drop(&mut self) {
        // SAFETY: releases the +1 `CFRunLoopSourceCreate` returned.
        unsafe { (fns().release)(self.0.as_ptr()) }
    }
}

// SAFETY: `CFRunLoopSourceSignal` is the documented way to poke a run loop
// from another thread; the handler is `Sync` and the reference is a
// thread-safe retain count.
unsafe impl Send for RunLoopSource {}
// SAFETY: as above.
unsafe impl Sync for RunLoopSource {}

// ─── FSEventStream ──────────────────────────────────────────────────────────

/// One `FSEventStream` callback's batch of events.
pub struct Events<'a> {
    paths: &'a [*const c_char],
    flags: &'a [FSEventStreamEventFlags],
}

impl<'a> Events<'a> {
    #[inline]
    pub fn len(&self) -> usize {
        self.paths.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.paths.is_empty()
    }

    /// The `i`th event's path (as reported: absolute, by realpath) and flags.
    #[inline]
    pub fn get(&self, i: usize) -> (&'a [u8], FSEventStreamEventFlags) {
        // SAFETY: without `kFSEventStreamCreateFlagUseCFTypes`, `eventPaths`
        // is an array of NUL-terminated C strings valid for the callback.
        let path = unsafe { CStr::from_ptr(self.paths[i]) }.to_bytes();
        (path, self.flags[i])
    }

    pub fn iter(&self) -> impl Iterator<Item = (&'a [u8], FSEventStreamEventFlags)> + '_ {
        (0..self.len()).map(move |i| self.get(i))
    }
}

/// Receives an [`EventStream`]'s events on the run loop thread it was
/// scheduled on.
pub trait EventStreamHandler: Sync + 'static {
    fn on_events(&'static self, events: Events<'_>);
}

/// An owned `FSEventStream`, created and scheduled on the calling thread's run
/// loop in one step and from then on used only on that thread (checked);
/// dropping it invalidates (unschedules) and releases it.
pub struct EventStream {
    stream: NonNull<c_void>,
    /// The run loop (thread) the stream is scheduled on; compared, never
    /// dereferenced.
    run_loop: CFRunLoopRef,
}

/// `kFSEventStreamCreateFlagUseCFTypes` / `kFSEventStreamCreateFlagUseExtendedData`:
/// both change what the callback's `eventPaths` points at, which [`Events`]
/// reads as C strings, so [`EventStream::new_scheduled`] refuses them.
const CALLBACK_SHAPE_FLAGS: FSEventStreamCreateFlags = 0x1 | 0x40;

impl EventStream {
    /// `FSEventStreamCreate` + `FSEventStreamScheduleWithRunLoop` on the
    /// calling thread's run loop (default mode). `None` if the stream could
    /// not be created.
    pub fn new_scheduled<H: EventStreamHandler>(
        handler: &'static H,
        paths: &CFStringArray,
        since: FSEventStreamEventId,
        latency: f64,
        flags: FSEventStreamCreateFlags,
    ) -> Option<EventStream> {
        extern "C" fn callback<H: EventStreamHandler>(
            _stream: FSEventStreamRef,
            info: *mut c_void,
            num_events: usize,
            event_paths: *mut c_void,
            event_flags: *const FSEventStreamEventFlags,
            _event_ids: *const FSEventStreamEventId,
        ) {
            // SAFETY: `info` is the `&'static H` stored in the context below.
            let handler: &'static H = unsafe { &*info.cast::<H>() };
            let events = if num_events == 0 {
                Events {
                    paths: &[],
                    flags: &[],
                }
            } else {
                // SAFETY: FSEvents passes `num_events`-long arrays of C-string
                // pointers and flags, valid for the duration of the callback.
                unsafe {
                    Events {
                        paths: core::slice::from_raw_parts(
                            event_paths.cast::<*const c_char>(),
                            num_events,
                        ),
                        flags: core::slice::from_raw_parts(event_flags, num_events),
                    }
                }
            };
            handler.on_events(events);
        }
        debug_assert_eq!(flags & CALLBACK_SHAPE_FLAGS, 0);
        let flags = flags & !CALLBACK_SHAPE_FLAGS;
        let f = fns();
        let ctx = FSEventStreamContext {
            version: 0,
            info: ptr::from_ref::<H>(handler).cast_mut().cast::<c_void>(),
            retain: ptr::null_mut(),
            release: ptr::null_mut(),
            copy_description: ptr::null_mut(),
        };
        // SAFETY: `ctx` is a valid version-0 context (copied by the call);
        // `paths` is a live CFArray of CFStrings.
        let stream = unsafe {
            (f.fs_event_stream_create)(
                ptr::null_mut(),
                callback::<H>,
                &raw const ctx,
                paths.array.as_ptr(),
                since,
                latency,
                flags,
            )
        };
        let stream = NonNull::new(stream)?;
        // SAFETY: no preconditions; never NULL.
        let run_loop = unsafe { (f.run_loop_get_current)() };
        // SAFETY: `stream` was just created; `run_loop` is this thread's.
        unsafe {
            (f.fs_event_stream_schedule_with_run_loop)(stream.as_ptr(), run_loop, f.default_mode())
        };
        Some(EventStream { stream, run_loop })
    }

    #[track_caller]
    fn assert_on_run_loop_thread(&self) {
        // SAFETY: no preconditions.
        let current = unsafe { (fns().run_loop_get_current)() };
        assert!(
            ptr::eq(current, self.run_loop),
            "FSEventStream used off the thread it is scheduled on"
        );
    }

    /// `FSEventStreamStart`; `false` if it failed.
    pub fn start(&self) -> bool {
        self.assert_on_run_loop_thread();
        // SAFETY: the live, scheduled stream we own, on its run loop's thread.
        unsafe { (fns().fs_event_stream_start)(self.stream.as_ptr()) != 0 }
    }

    /// `FSEventStreamStop`.
    pub fn stop(&self) {
        self.assert_on_run_loop_thread();
        // SAFETY: as `start`.
        unsafe { (fns().fs_event_stream_stop)(self.stream.as_ptr()) }
    }
}

impl Drop for EventStream {
    fn drop(&mut self) {
        self.assert_on_run_loop_thread();
        let f = fns();
        // SAFETY: the live, scheduled stream we own, on its run loop's thread;
        // invalidate unschedules it, release drops our +1.
        unsafe {
            (f.fs_event_stream_invalidate)(self.stream.as_ptr());
            (f.fs_event_stream_release)(self.stream.as_ptr());
        }
    }
}

// SAFETY: every operation (start/stop/drop) checks it runs on the thread whose
// run loop the stream was scheduled on, so holding or moving the handle
// elsewhere cannot drive the stream from another thread.
unsafe impl Send for EventStream {}
