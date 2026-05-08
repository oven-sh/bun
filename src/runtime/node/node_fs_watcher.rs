use core::ffi::c_void;
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_aio::KeepAlive;
use bun_core::Output;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{task_tag, Task, TaskTag, Taskable};
use bun_jsc::abort_signal::AbortListener;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::node::PathLike;
use bun_jsc::{
    self as jsc, AbortSignal, AbortSignalRef, ArgumentsSlice, CallFrame, CommonAbortReason,
    GlobalRef, JSGlobalObject, JSValue, JsResult, SysErrorJsc, VirtualMachineRef as VirtualMachine,
    ZigStringJsc as _,
};
use bun_string::ZigString;
use bun_paths::resolve_path::{self as Path, platform};
use bun_str::strings;
use bun_sys::{self, SystemErrno};
use bun_threading::Mutex;

use crate::node::types::{Encoding, PathLikeExt};
use crate::webcore::encoding as Encoder;

bun_output::declare_scope!(fs_watch, hidden);

#[cfg(windows)]
use super::win_watcher as path_watcher;
#[cfg(not(windows))]
use super::path_watcher;

// TODO: make this a top-level struct
#[bun_jsc::JsClass(no_constructor)]
pub struct FSWatcher {
    // codegen: jsc.Codegen.JSFSWatcher provides toJS/fromJS/fromJSDirect
    ctx: *mut VirtualMachine,
    verbose: bool,

    mutex: Mutex,
    signal: Option<AbortSignalRef>,
    persistent: bool,
    path_watcher: Option<*mut path_watcher::PathWatcher>,
    poll_ref: KeepAlive,
    global_this: GlobalRef,
    // TODO(port): bare JSValue heap field — self-wrapper; consider JsRef in Phase B
    pub(super) js_this: JSValue,
    encoding: Encoding,

    /// User can call close and pre-detach so we need to track this
    closed: bool,

    /// While it's not closed, the pending activity
    pending_activity_count: AtomicU32,
    current_task: FSWatchTask,
}

/// `jsc.Codegen.JSFSWatcher` cached-slot accessors (`values: ["listener"]` in
/// node.classes.ts). The C++ side is emitted by `generate-classes.ts`.
pub mod js {
    bun_jsc::codegen_cached_accessors!("FSWatcher"; listener);
}

impl FSWatcher {
    #[inline]
    fn vm(&self) -> &'static mut VirtualMachine {
        // SAFETY: BACKREF — `ctx` is the per-thread `VirtualMachine` singleton
        // (set in `init` from `globalThis.bunVM()`); it outlives every
        // FSWatcher and all access is on the JS thread.
        unsafe { &mut *self.ctx }
    }

    #[inline]
    fn vm_ctx(&self) -> bun_aio::EventLoopCtx {
        VirtualMachine::event_loop_ctx(self.ctx)
    }

    #[inline]
    pub fn event_loop(&self) -> *mut EventLoop {
        self.vm().event_loop()
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTask) {
        // SAFETY: `event_loop()` returns the live JS-thread loop (BACKREF via
        // `ctx`); `enqueue_task_concurrent` is the documented cross-thread
        // entry point and only touches the lock-free queue.
        unsafe { (*self.event_loop()).enqueue_task_concurrent(task) }
    }

    /// `pub const finalize = deinit;` — codegen `finalize: true` entry point.
    /// Runs on the mutator thread during lazy sweep.
    pub fn finalize(this: *mut Self) {
        // SAFETY: codegen guarantees `this` is the m_ctx payload, uniquely owned here.
        let this_ref = unsafe { &mut *this };
        // stop all managers and signals
        this_ref.detach();
        // SAFETY: allocated via Box::into_raw in `init`; finalize owns teardown.
        drop(unsafe { Box::from_raw(this) });
    }
}

#[cfg(windows)]
pub type FSWatchTask = FSWatchTaskWindows;
#[cfg(not(windows))]
pub type FSWatchTask = FSWatchTaskPosix;

// Zig only references `FSWatchTaskPosix` from posix paths, so its lazy
// compilation never type-checks the body on Windows. Rust type-checks
// unconditionally, and `Event::Rename`/`Change` carry `StringOrBytesToDecode`
// on Windows which does not coerce to the `&[u8]` `emit()` expects — gate the
// whole posix task to keep the Windows build sound.
#[cfg(not(windows))]
pub struct FSWatchTaskPosix {
    ctx: *mut FSWatcher,
    count: u8,

    entries: [MaybeUninit<Entry>; 8],
    concurrent_task: ConcurrentTask,
}

#[cfg(not(windows))]
impl Taskable for FSWatchTaskPosix {
    const TAG: TaskTag = task_tag::FSWatchTask;
}

#[cfg(not(windows))]
pub struct Entry {
    event: Event,
    needs_free: bool,
}

#[cfg(not(windows))]
impl FSWatchTaskPosix {
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    fn ctx(&self) -> &mut FSWatcher {
        // SAFETY: BACKREF — `ctx` always points to the live owning FSWatcher
        // (set at `init`, line 674 in Zig); FSWatcher outlives all its tasks.
        unsafe { &mut *self.ctx }
    }

    pub fn append(&mut self, event: Event, needs_free: bool) {
        if self.count == 8 {
            self.enqueue();
            let ctx = self.ctx;
            *self = Self {
                ctx,
                count: 0,
                entries: [const { MaybeUninit::uninit() }; 8],
                concurrent_task: ConcurrentTask::default(),
            };
        }

        self.entries[self.count as usize].write(Entry { event, needs_free });
        self.count += 1;
    }

    pub fn run(&mut self) {
        // this runs on JS Context Thread

        for i in 0..self.count as usize {
            // SAFETY: entries [0..count) were written by `append`.
            let entry = unsafe { self.entries[i].assume_init_ref() };
            match &entry.event {
                Event::Rename(file_path) => self.ctx().emit::<{ EventType::Rename }>(file_path),
                Event::Change(file_path) => self.ctx().emit::<{ EventType::Change }>(file_path),
                Event::Error(err) => self.ctx().emit_error(err.clone()),
                Event::Abort => self.ctx().emit_if_aborted(),
                Event::Close => self.ctx().emit::<{ EventType::Close }>(b""),
            }
        }

        self.ctx().unref_task();
    }

    pub fn append_abort(&mut self) {
        self.append(Event::Abort, false);
        self.enqueue();
    }

    pub fn enqueue(&mut self) {
        if self.count == 0 {
            return;
        }

        // if false is closed or detached (can still contain valid refs but will not create a new one)
        if self.ctx().ref_task() {
            // PORT NOTE: reshaped for borrowck — clone self into a heap task, then reset.
            let that = Box::into_raw(Box::new(FSWatchTaskPosix {
                ctx: self.ctx,
                count: self.count,
                entries: core::mem::replace(
                    &mut self.entries,
                    [const { MaybeUninit::uninit() }; 8],
                ),
                concurrent_task: ConcurrentTask::default(),
            }));
            self.count = 0;
            // SAFETY: `that` is a freshly-boxed task; the concurrent queue takes
            // ownership of the `ConcurrentTask` node (and transitively the box)
            // until the JS thread drains and `Box::from_raw`s it in `dispatch`.
            unsafe {
                (*that).concurrent_task.task = Task::init(that);
                self.ctx()
                    .enqueue_task_concurrent(core::ptr::addr_of_mut!((*that).concurrent_task));
            }
            return;
        }
        // closed or detached so just cleanEntries
        self.clean_entries();
    }

    pub fn clean_entries(&mut self) {
        for i in 0..self.count as usize {
            // SAFETY: entries [0..count) were written by `append`.
            let needs_free = unsafe { self.entries[i].assume_init_ref() }.needs_free;
            if needs_free {
                // SAFETY: entries [0..count) were written by `append`; dropped at most once
                // (count is reset to 0 below).
                unsafe { self.entries[i].assume_init_drop() };
            }
        }
        self.count = 0;
    }
}

#[cfg(not(windows))]
impl FSWatchTaskPosix {
    /// `FSWatchTaskPosix.deinit` (node_fs_watcher.zig:61). **Not** `impl Drop`:
    /// this is only ever called on heap clones produced by `enqueue()` (via the
    /// task dispatcher), never on the embedded `FSWatcher.current_task` field —
    /// the assert below enforces that. A `Drop` impl would also fire on
    /// `*self = Self{..}` in `append()` and on `Box::from_raw` in `finalize`,
    /// where `self` *is* `current_task`, which would always trip the assert.
    ///
    /// # Safety
    /// `this` must be the unique `Box::into_raw` pointer produced by
    /// `enqueue()`; called from the JS-thread task dispatcher only.
    pub unsafe fn deinit(this: *mut Self) {
        // SAFETY: caller contract — `this` is the live heap clone.
        let this_ref = unsafe { &mut *this };
        this_ref.clean_entries();
        #[cfg(debug_assertions)]
        {
            // SAFETY: ctx is valid for the lifetime of any task (BACKREF).
            debug_assert!(!core::ptr::eq(
                unsafe { core::ptr::addr_of!((*this_ref.ctx).current_task) },
                this.cast_const()
            ));
        }
        // SAFETY: paired with `Box::into_raw` in `enqueue()`.
        drop(unsafe { Box::from_raw(this) });
    }
}

#[cfg(windows)]
pub type EventPathString = StringOrBytesToDecode;
#[cfg(not(windows))]
pub type EventPathString = Box<[u8]>;
// TODO(port): on posix, `EventPathString` is borrowed `&[u8]` at callback time
// but owned `Box<[u8]>` after `dupe()`. Phase B may want `Cow<'_, [u8]>`.

pub enum Event {
    Rename(EventPathString),
    Change(EventPathString),
    Error(bun_sys::Error),
    Abort,
    Close,
}

impl Event {
    #[cfg(not(windows))]
    pub fn dupe(&self) -> Event {
        match self {
            Event::Rename(path) => Event::Rename(Box::<[u8]>::from(&path[..])),
            Event::Change(path) => Event::Change(Box::<[u8]>::from(&path[..])),
            Event::Error(err) => Event::Error(err.clone()),
            Event::Abort => Event::Abort,
            Event::Close => Event::Close,
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy, strum::IntoStaticStr)]
pub enum EventType {
    Rename = 0,
    Change = 1,
    Error = 2,
    Abort = 3,
    Close = 4,
}

impl EventType {
    pub fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call into C++; EventType is #[repr(u8)] matching the C++ enum.
        unsafe { Bun__domEventNameToJS(global_object, self) }
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Bun__domEventNameToJS(global: *const JSGlobalObject, event_type: EventType) -> JSValue;
}

pub struct FSWatchTaskWindows {
    event: Event,
    ctx: *mut FSWatcher,

    /// Unused: To match the API of the posix version
    count: u8, // u0 in Zig
}

impl Taskable for FSWatchTaskWindows {
    const TAG: TaskTag = task_tag::FSWatchTask;
}

impl Default for FSWatchTaskWindows {
    fn default() -> Self {
        Self {
            event: Event::Error(bun_sys::Error {
                errno: SystemErrno::EINVAL as _,
                syscall: bun_sys::Tag::watch,
                ..Default::default()
            }),
            ctx: core::ptr::null_mut(),
            count: 0,
        }
    }
}

pub enum StringOrBytesToDecode {
    String(bun_str::String),
    BytesToFree(Box<[u8]>),
}

impl core::fmt::Display for StringOrBytesToDecode {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            StringOrBytesToDecode::String(s) => write!(f, "{}", s),
            StringOrBytesToDecode::BytesToFree(utf8) => {
                write!(f, "{}", bstr::BStr::new(utf8))
            }
        }
    }
}

impl FSWatchTaskWindows {
    pub fn append_abort(&mut self) {
        let ctx = self.ctx;
        // Balance the `ctx.unrefTask()` at the end of `run()` (matches
        // `onPathUpdateWindows` and the posix `enqueue()` path).
        // SAFETY: BACKREF — `ctx` is the live owning FSWatcher set at
        // construction; FSWatcher outlives every task it enqueues.
        if !unsafe { &mut *ctx }.ref_task() {
            return;
        }
        let task = Box::into_raw(Box::new(FSWatchTaskWindows {
            ctx,
            event: Event::Abort,
            count: 0,
        }));

        // SAFETY: event_loop() is the live JS-thread loop (BACKREF via `ctx`);
        // ownership of `task` transfers to the queue (drained on the same thread).
        unsafe { (*(*ctx).event_loop()).enqueue_task(Task::init(task)) };
    }

    /// this runs on JS Context Thread
    pub fn run(&mut self) {
        // PORT NOTE: reshaped for borrowck — a `fn ctx(&self) -> &mut FSWatcher`
        // helper would tie the returned `&mut` to `&self` via lifetime elision,
        // which then conflicts with `&mut self.event` below (and is unsound on
        // its own: two calls would alias the same `&mut`). Copy the raw backref
        // and deref it directly so no borrow of `*self` is held across the match.
        let ctx_ptr = self.ctx;
        // SAFETY: BACKREF — set from `this` (FSWatcher) at construction;
        // FSWatcher outlives every task it enqueues.
        let ctx = unsafe { &mut *ctx_ptr };

        match &mut self.event {
            Event::Rename(path) => Self::run_path::<{ EventType::Rename }>(ctx, path),
            Event::Change(path) => Self::run_path::<{ EventType::Change }>(ctx, path),
            Event::Error(err) => ctx.emit_error(err.clone()),
            Event::Abort => ctx.emit_if_aborted(),
            Event::Close => ctx.emit::<{ EventType::Close }>(b""),
        }

        ctx.unref_task();
    }

    #[cfg(windows)]
    fn run_path<const EVENT_TYPE: EventType>(ctx: &mut FSWatcher, path: &mut StringOrBytesToDecode) {
        use bun_jsc::StringJsc;
        if ctx.encoding == Encoding::Utf8 {
            let StringOrBytesToDecode::String(s) = path else {
                // TODO(port): Zig accesses `path.string` unconditionally here
                unreachable!()
            };
            let Ok(js) = s.transfer_to_js(ctx.global_this) else { return };
            ctx.emit_with_filename::<EVENT_TYPE>(js);
        } else {
            let StringOrBytesToDecode::BytesToFree(bytes_ref) = path else {
                unreachable!()
            };
            let bytes = core::mem::take(bytes_ref);
            ctx.emit::<EVENT_TYPE>(&bytes);
            drop(bytes);
        }
    }

    #[cfg(not(windows))]
    fn run_path<const EVENT_TYPE: EventType>(_ctx: &mut FSWatcher, _path: &mut EventPathString) {
        unreachable!("FSWatchTaskWindows::run is windows-only")
    }

    /// `FSWatchTaskWindows.deinit` (node_fs_watcher.zig:259). Explicit, not
    /// `impl Drop`, to mirror `FSWatchTaskPosix::deinit` so the dispatcher can
    /// call `FSWatchTask::deinit` uniformly.
    ///
    /// # Safety
    /// `this` must be the unique `Box::into_raw` pointer produced by
    /// `append_abort()` / `on_path_update_windows()`.
    pub unsafe fn deinit(this: *mut Self) {
        // `Event` (and `StringOrBytesToDecode`) free their payloads via Drop,
        // so dropping the Box is `event.deinit() + bun.destroy(this)`.
        // SAFETY: paired with `Box::into_raw` at the enqueue site.
        drop(unsafe { Box::from_raw(this) });
    }
}

impl FSWatcher {
    pub fn on_path_update_posix(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
        // SAFETY: ctx was registered as `*mut FSWatcher` cast to `*mut c_void` in `init`.
        let this = unsafe { &mut *ctx.unwrap().cast::<FSWatcher>() };

        if this.verbose {
            match &event {
                #[cfg(not(windows))]
                Event::Rename(value) | Event::Change(value) => {
                    if is_file {
                        Output::pretty_errorln(
                            format_args!("<r> <d>File changed: {}<r>", bstr::BStr::new(value)),
                        );
                    } else {
                        Output::pretty_errorln(
                            format_args!("<r> <d>Dir changed: {}<r>", bstr::BStr::new(value)),
                        );
                    }
                }
                _ => {}
            }
        }

        #[cfg(not(windows))]
        {
            let cloned = event.dupe();
            this.current_task.append(cloned, true);
        }
        #[cfg(windows)]
        let _ = (event, is_file);
    }

    pub fn on_path_update_windows(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
        // SAFETY: ctx was registered as `*mut FSWatcher` cast to `*mut c_void` in `init`.
        let this = unsafe { &mut *ctx.unwrap().cast::<FSWatcher>() };

        if this.verbose {
            match &event {
                #[cfg(windows)]
                Event::Rename(value) | Event::Change(value) => {
                    if is_file {
                        Output::pretty_errorln(format_args!("<r> <d>File changed: {}<r>", value));
                    } else {
                        Output::pretty_errorln(format_args!("<r> <d>Dir changed: {}<r>", value));
                    }
                }
                _ => {}
            }
        }

        if !this.ref_task() {
            return;
        }

        let task = Box::into_raw(Box::new(FSWatchTaskWindows {
            ctx: this,
            event,
            count: 0,
        }));
        // SAFETY: event_loop() is the live JS-thread loop; ownership of `task`
        // transfers to the queue.
        unsafe { (*this.event_loop()).enqueue_task(Task::init(task)) };
        let _ = is_file;
    }

    #[cfg(windows)]
    pub const ON_PATH_UPDATE: fn(Option<*mut c_void>, Event, bool) = Self::on_path_update_windows;
    #[cfg(not(windows))]
    pub const ON_PATH_UPDATE: fn(Option<*mut c_void>, Event, bool) = Self::on_path_update_posix;

    pub fn on_update_end(ctx: Option<*mut c_void>) {
        // SAFETY: ctx was registered as `*mut FSWatcher` cast to `*mut c_void` in `init`.
        let this = unsafe { &mut *ctx.unwrap().cast::<FSWatcher>() };
        if this.verbose {
            Output::flush();
        }
        #[cfg(unix)]
        {
            // we only enqueue after all events are processed
            this.current_task.enqueue();
        }
    }
}

pub struct Arguments<'a> {
    pub path: PathLike,
    pub listener: JSValue,
    pub global_this: &'a JSGlobalObject,
    pub signal: Option<&'a AbortSignal>,
    pub persistent: bool,
    pub recursive: bool,
    pub encoding: Encoding,
    pub verbose: bool,
}

impl<'a> Arguments<'a> {
    pub fn from_js(
        ctx: &'a JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Arguments<'a>> {
        let Some(path) = PathLike::from_js(ctx, arguments)? else {
            return Err(ctx.throw_invalid_arguments(format_args!(
                "filename must be a string or TypedArray"
            )));
        };
        // TODO(port): PathLike Drop — Zig had `defer if (should_deinit_path) path.deinit();`
        // Once PathLike: Drop, `?` on the error paths below drops it automatically.

        let mut listener: JSValue = JSValue::ZERO;
        let mut signal: Option<&AbortSignal> = None;
        let mut persistent: bool = true;
        let mut recursive: bool = false;
        let mut encoding: Encoding = Encoding::Utf8;
        let mut verbose = false;
        if let Some(options_or_callable) = arguments.next_eat() {
            // options
            if options_or_callable.is_object() {
                if let Some(persistent_) = options_or_callable.get_truthy(ctx, "persistent")? {
                    if !persistent_.is_boolean() {
                        return Err(ctx.throw_invalid_arguments(format_args!(
                            "persistent must be a boolean"
                        )));
                    }
                    persistent = persistent_.to_boolean();
                }

                if let Some(verbose_) = options_or_callable.get_truthy(ctx, "verbose")? {
                    if !verbose_.is_boolean() {
                        return Err(
                            ctx.throw_invalid_arguments(format_args!("verbose must be a boolean"))
                        );
                    }
                    verbose = verbose_.to_boolean();
                }

                if let Some(encoding_) =
                    options_or_callable.fast_get(ctx, jsc::BuiltinName::encoding)?
                {
                    encoding = Encoding::assert(encoding_, ctx, encoding)?;
                }

                if let Some(recursive_) = options_or_callable.get_truthy(ctx, "recursive")? {
                    if !recursive_.is_boolean() {
                        return Err(ctx.throw_invalid_arguments(format_args!(
                            "recursive must be a boolean"
                        )));
                    }
                    recursive = recursive_.to_boolean();
                }

                // abort signal
                if let Some(signal_) = options_or_callable.get_truthy(ctx, "signal")? {
                    if let Some(signal_obj) = AbortSignal::from_js(signal_) {
                        // Keep it alive
                        signal_.ensure_still_alive();
                        // SAFETY: `signal_obj` is the live C++ AbortSignal owned
                        // by `signal_` (a JS AbortSignal kept reachable for the
                        // duration of the call by `ensure_still_alive`). Borrow
                        // is bounded by `'a` (the global / arguments lifetime).
                        signal = Some(unsafe { &*signal_obj });
                    } else {
                        return Err(ctx.throw_invalid_arguments(format_args!(
                            "signal is not of type AbortSignal"
                        )));
                    }
                }

                // listener
                if let Some(callable) = arguments.next_eat() {
                    if !callable.is_cell() || !callable.is_callable() {
                        return Err(ctx.throw_invalid_arguments(format_args!(
                            "Expected \"listener\" callback to be a function"
                        )));
                    }
                    listener = callable;
                }
            } else {
                if !options_or_callable.is_cell() || !options_or_callable.is_callable() {
                    return Err(ctx.throw_invalid_arguments(format_args!(
                        "Expected \"listener\" callback to be a function"
                    )));
                }
                listener = options_or_callable;
            }
        }
        if listener.is_empty() {
            return Err(ctx.throw_invalid_arguments(format_args!("Expected \"listener\" callback")));
        }

        Ok(Arguments {
            path,
            listener,
            global_this: ctx,
            signal,
            persistent,
            recursive,
            encoding,
            verbose,
        })
    }

    pub fn create_fs_watcher(self) -> bun_sys::Result<*mut FSWatcher> {
        FSWatcher::init(self)
    }
}

impl AbortListener for FSWatcher {
    fn on_abort(&mut self, reason: JSValue) {
        self.emit_abort(reason);
    }
}

impl FSWatcher {
    /// Read access to the JS wrapper value. Exposed for `NodeFS::watch`, which
    /// in Zig reads the `js_this` field directly off the by-value `*FSWatcher`.
    #[inline]
    pub fn js_this(&self) -> JSValue {
        self.js_this
    }

    /// `FSWatcher.initJS` (node_fs_watcher.zig:537). Takes `*mut Self` so the
    /// already-heap-allocated payload can be handed to `${T}__create` via
    /// `to_js_ptr` without re-boxing (see jsc_macros::JsClass).
    ///
    /// # Safety
    /// `this` must be the unique `Box::into_raw` pointer produced by `init`;
    /// JS-thread only.
    pub unsafe fn init_js(this: *mut Self, listener: JSValue) {
        // SAFETY: caller contract — `this` is uniquely owned and live.
        let this_ref = unsafe { &mut *this };
        if this_ref.persistent {
            this_ref.poll_ref.ref_(this_ref.vm_ctx());
        }

        // SAFETY: ownership of `this` transfers to the GC wrapper here; the
        // wrapper's finalize hook is `FSWatcher::finalize` which calls
        // `Box::from_raw(this)`.
        let js_this = unsafe { Self::to_js_ptr(this, &this_ref.global_this) };
        js_this.ensure_still_alive();
        this_ref.js_this = js_this;
        js::listener_set_cached(js_this, &this_ref.global_this, listener);

        if let Some(s) = &this_ref.signal {
            // already aborted?
            if s.aborted() {
                // safely abort next tick
                this_ref.current_task = FSWatchTask {
                    ctx: this,
                    ..Default::default()
                };
                this_ref.current_task.append_abort();
            } else {
                // watch for abortion
                s.listen::<FSWatcher>(this);
            }
        }
    }

    pub fn emit_if_aborted(&mut self) {
        if let Some(s) = &self.signal {
            if s.aborted() {
                let err = s.abort_reason();
                self.emit_abort(err);
            }
        }
    }

    pub fn emit_abort(&mut self, err: JSValue) {
        if self.closed {
            return;
        }
        self.pending_activity_count.fetch_add(1, Ordering::Relaxed);
        // PORT NOTE: Zig has `defer this.close(); defer this.unrefTask();` — defers run LIFO,
        // so unref_task() executes before close(). No early returns below, so both calls are
        // inlined at the end of this function.

        err.ensure_still_alive();
        if !self.js_this.is_empty() {
            let js_this = self.js_this;
            js_this.ensure_still_alive();
            if let Some(listener) = js::listener_get_cached(js_this) {
                listener.ensure_still_alive();
                let args = [
                    EventType::Error.to_js(&self.global_this),
                    if err.is_empty_or_undefined_or_null() {
                        CommonAbortReason::UserAbort.to_js(&self.global_this)
                    } else {
                        err
                    },
                ];
                if listener
                    .call_with_global_this(&self.global_this, &args)
                    .is_err()
                {
                    self.global_this.clear_exception();
                }
            }
        }

        self.unref_task();
        self.close();
    }

    pub fn emit_error(&mut self, err: bun_sys::Error) {
        if self.closed {
            return;
        }
        // PORT NOTE: reshaped for borrowck — `defer this.close()` moved to fn end.

        if !self.js_this.is_empty() {
            let js_this = self.js_this;
            js_this.ensure_still_alive();
            if let Some(listener) = js::listener_get_cached(js_this) {
                listener.ensure_still_alive();
                let global_object = self.global_this;
                let err_js = err.to_js(&global_object);
                let args = [EventType::Error.to_js(&global_object), err_js];
                if let Err(e) = listener.call_with_global_this(&global_object, &args) {
                    self.global_this.report_active_exception_as_unhandled(e);
                }
            }
        }

        self.close();
    }

    pub fn emit_with_filename<const EVENT_TYPE: EventType>(&mut self, file_name: JSValue) {
        let js_this = self.js_this;
        if js_this.is_empty() {
            return;
        }
        let Some(listener) = js::listener_get_cached(js_this) else {
            return;
        };
        emit_js::<EVENT_TYPE>(listener, &self.global_this, file_name);
    }

    pub fn emit<const EVENT_TYPE: EventType>(&mut self, file_name: &[u8]) {
        debug_assert!(EVENT_TYPE != EventType::Error);
        let js_this = self.js_this;
        if js_this.is_empty() {
            return;
        }
        let Some(listener) = js::listener_get_cached(js_this) else {
            return;
        };
        let global_object = self.global_this;
        let mut filename: JSValue = JSValue::UNDEFINED;
        if !file_name.is_empty() {
            if self.encoding == Encoding::Buffer {
                filename = match jsc::ArrayBuffer::create_buffer(&global_object, file_name) {
                    Ok(v) => v,
                    Err(_) => return, // TODO: properly propagate exception upwards
                };
            } else if self.encoding == Encoding::Utf8 {
                filename = ZigString::from_utf8(file_name).to_js(&global_object);
            } else {
                // convert to desired encoding
                filename = match Encoder::to_string(file_name, &global_object, self.encoding) {
                    Ok(v) => v,
                    Err(_) => return,
                };
            }
        }

        emit_js::<EVENT_TYPE>(listener, &global_object, filename);
    }
}

fn emit_js<const EVENT_TYPE: EventType>(
    listener: JSValue,
    global_object: &JSGlobalObject,
    filename: JSValue,
) {
    let args = [EVENT_TYPE.to_js(global_object), filename];

    if let Err(err) = listener.call_with_global_this(global_object, &args) {
        global_object.report_active_exception_as_unhandled(err);
    }
}

impl FSWatcher {
    #[bun_jsc::host_fn(method)]
    pub fn do_ref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !this.closed && !this.persistent {
            this.persistent = true;
            this.poll_ref.ref_(this.vm_ctx());
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.persistent {
            this.persistent = false;
            this.poll_ref.unref(this.vm_ctx());
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn has_ref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::from(this.persistent))
    }

    // this can be called from Watcher Thread or JS Context Thread
    pub fn ref_task(&mut self) -> bool {
        let _guard = self.mutex.lock_guard();
        if self.closed {
            return false;
        }
        self.pending_activity_count.fetch_add(1, Ordering::Relaxed);

        true
    }

    /// Called from the GC thread via the codegen `FSWatcher__hasPendingActivity`
    /// thunk; only touches the atomic field so `&self` is sound across threads.
    pub fn has_pending_activity(&self) -> bool {
        self.pending_activity_count.load(Ordering::Acquire) > 0
    }

    pub fn unref_task(&mut self) {
        let _guard = self.mutex.lock_guard();
        // JSC eventually will free it
        let prev = self.pending_activity_count.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(prev > 0);
    }

    pub fn close(&mut self) {
        self.mutex.lock();
        if !self.closed {
            self.closed = true;
            let js_this = self.js_this;
            self.mutex.unlock();
            self.detach();

            if !js_this.is_empty() {
                if let Some(listener) = js::listener_get_cached(js_this) {
                    // `closed` is already true so `refTask()` would return false without
                    // incrementing; bump the counter directly so the `unrefTask()` below is
                    // balanced and the count stays > 0 while the close event is emitted.
                    self.pending_activity_count.fetch_add(1, Ordering::Relaxed);
                    bun_output::scoped_log!(fs_watch, "emit('close')");
                    emit_js::<{ EventType::Close }>(listener, &self.global_this, JSValue::UNDEFINED);
                    self.unref_task();
                }
            }

            self.unref_task();
        } else {
            self.mutex.unlock();
        }
        // TODO(port): bun.Mutex lock/unlock — verify RAII guard vs manual unlock semantics in Phase B
    }

    // this can be called multiple times
    pub fn detach(&mut self) {
        if self.vm().test_isolation_enabled {
            self.vm()
                .rare_data()
                .remove_fs_watcher_for_isolation(std::ptr::from_mut::<Self>(self).cast::<c_void>());
        }

        if let Some(watcher) = self.path_watcher.take() {
            // Both backends expose `detach` as an associated fn over `*mut PathWatcher`
            // (it self-destroys via `Box::from_raw` on the last handler, so it cannot
            // soundly take `&mut self`). `watcher` is the live pointer returned by
            // `path_watcher::watch`.
            path_watcher::PathWatcher::detach(watcher, std::ptr::from_mut::<Self>(self).cast::<c_void>());
        }

        if self.persistent {
            self.persistent = false;
            self.poll_ref.unref(self.vm_ctx());
        }

        if let Some(signal) = self.signal.take() {
            // PORT NOTE: Zig `signal.detach(this)` = `cleanNativeBindings` +
            // `unref`. `AbortSignalRef::Drop` already does the `unref`, so only
            // remove the listener here to avoid a double-unref.
            signal.clean_native_bindings(std::ptr::from_mut::<Self>(self).cast::<c_void>());
        }

        self.js_this = JSValue::ZERO;
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_close(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.close();
        Ok(JSValue::UNDEFINED)
    }

    pub fn init(args: Arguments<'_>) -> bun_sys::Result<*mut FSWatcher> {
        let mut joined_buf = bun_paths::path_buffer_pool::get();
        let slice = {
            let mut s = args.path.slice();
            if strings::starts_with(s, b"file://") {
                s = &s[b"file://".len()..];
            }
            s
        };
        // SAFETY: `FileSystem::instance()` returns the process-global singleton
        // initialized at startup; never null once init has run.
        let cwd = unsafe { (*bun_resolver::fs::FileSystem::instance()).top_level_dir };
        let file_path: &bun_str::ZStr =
            Path::join_abs_string_buf_z::<platform::Auto>(cwd, &mut joined_buf[..], &[slice]);

        let vm = args.global_this.bun_vm_ptr();

        let ctx = Box::into_raw(Box::new(FSWatcher {
            ctx: vm,
            current_task: FSWatchTask {
                ctx: core::ptr::null_mut(),
                count: 0,
                ..Default::default()
            },
            mutex: Mutex::default(),
            // SAFETY: `args.signal` is a live borrow of the JS AbortSignal (kept
            // reachable by the caller's frame); `ref_()` bumps the C++ intrusive
            // refcount and `adopt` takes ownership of that +1.
            signal: args
                .signal
                .map(|s| unsafe { AbortSignalRef::adopt(s.ref_()) }),
            persistent: args.persistent,
            path_watcher: None,
            global_this: GlobalRef::from(args.global_this),
            js_this: JSValue::ZERO,
            encoding: args.encoding,
            closed: false,
            verbose: args.verbose,
            poll_ref: KeepAlive::default(),
            pending_activity_count: AtomicU32::new(1),
        }));
        // SAFETY: `ctx` is the freshly-boxed payload; uniquely owned here.
        let ctx_ref = unsafe { &mut *ctx };
        ctx_ref.current_task.ctx = ctx;

        ctx_ref.path_watcher = if args.signal.map_or(true, |s| !s.aborted()) {
            // PORT NOTE: Zig passes `comptime callback` / `comptime updateEnd`
            // and both backends `@compileError` if they aren't exactly
            // `onPathUpdateFn` / `onUpdateEndFn`. The Windows port dropped
            // those parameters (only one valid value each), so the call is
            // cfg-split by arity.
            #[cfg(windows)]
            // SAFETY: `vm` is the live per-thread VirtualMachine returned by `bun_vm()`.
            let r = path_watcher::watch(
                unsafe { &*vm },
                file_path,
                args.recursive,
                ctx as *mut c_void,
            );
            #[cfg(not(windows))]
            // SAFETY: `vm` is the live per-thread VirtualMachine returned by `bun_vm()`.
            let r = path_watcher::watch(
                unsafe { &*vm },
                file_path,
                args.recursive,
                FSWatcher::ON_PATH_UPDATE,
                FSWatcher::on_update_end,
                ctx.cast::<c_void>(),
            );
            match r {
                Ok(r) => Some(r),
                Err(err) => {
                    // SAFETY: ctx is the only owner; finalize frees the Box.
                    FSWatcher::finalize(ctx);
                    return Err(bun_sys::Error {
                        errno: err.errno,
                        syscall: bun_sys::Tag::watch,
                        path: args.path.slice().into(),
                        ..Default::default()
                    });
                }
            }
        } else {
            None
        };
        // SAFETY: `ctx` is the unique heap pointer; `init_js` hands ownership to
        // the GC wrapper via `to_js_ptr`.
        unsafe {
            FSWatcher::init_js(
                ctx,
                args.listener.with_async_context_if_needed(args.global_this),
            )
        };
        // SAFETY: `vm` is the live per-thread VirtualMachine.
        if unsafe { (*vm).test_isolation_enabled } {
            unsafe { &mut *vm }.rare_data().add_fs_watcher_for_isolation(
                ctx.cast::<c_void>(),
                // §Dispatch cold-path vtable — `bun_jsc::RareData` stores
                // (ptr, close-fn) so it can fire detach without naming FSWatcher.
                // SAFETY (callee contract): `p` is the `ctx` registered above;
                // still live until `remove_fs_watcher_for_isolation` runs.
                |p| unsafe { (*p.cast::<FSWatcher>()).detach() },
            );
        }
        Ok(ctx)
    }
}

#[cfg(not(windows))]
impl Default for FSWatchTaskPosix {
    fn default() -> Self {
        Self {
            ctx: core::ptr::null_mut(),
            count: 0,
            entries: [const { MaybeUninit::uninit() }; 8],
            concurrent_task: ConcurrentTask::default(),
        }
    }
}

// ported from: src/runtime/node/node_fs_watcher.zig
