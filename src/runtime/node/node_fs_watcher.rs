use core::cell::Cell;
use core::ffi::c_void;
#[cfg(not(windows))]
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::Output;
use bun_core::strings;
#[cfg(not(windows))]
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, TaskTag, Taskable, task_tag};
use bun_io::KeepAlive;
use bun_jsc::abort_signal::AbortListener;
use bun_jsc::bun_string_jsc;
use bun_jsc::node::PathLike;
use bun_jsc::{
    self as jsc, AbortSignal, AbortSignalRef, ArgumentsSlice, CallFrame, CommonAbortReason,
    CommonAbortReasonExt as _, GlobalRef, JSGlobalObject, JSValue, JsRef, JsResult, SysErrorJsc,
    VirtualMachineRef as VirtualMachine,
};
use bun_jsc::{JsCell, JsCellRefExt as _};
use bun_paths::resolve_path::{self as Path, platform};
use bun_sys::{self, SystemErrno};
use bun_threading::Mutex;

use crate::node::types::{Encoding, PathLikeExt};
use crate::webcore::encoding as Encoder;

bun_output::declare_scope!(fs_watch, hidden);

#[cfg(not(windows))]
use super::path_watcher;
#[cfg(windows)]
use super::win_watcher as path_watcher;

// TODO: make this a top-level struct
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). `&mut Self`
// carried LLVM `noalias`, so a host-fn that re-entered JS while holding it let
// the optimiser cache `self.closed` etc. across the FFI call — the `*mut Self`
// dance in the old `emit_abort`/`emit_error` was a manual workaround for
// exactly that. With `Cell`/`JsCell` (UnsafeCell-backed) the miscompile is
// structurally impossible and those methods are now plain `&self`.
#[bun_jsc::JsClass(no_constructor)]
pub struct FSWatcher {
    // codegen: jsc.Codegen.JSFSWatcher provides toJS/fromJS/fromJSDirect
    /// JS-thread uses only.
    ctx: *mut VirtualMachine,
    /// How the (process-wide) watcher thread delivers event batches to the
    /// VM while this watcher is attached (POSIX; on Windows libuv delivers fs
    /// events on the JS thread). Weak: `detach()` — close, the VM's stop
    /// phase, or finalize — is what ends the thread's access to `self`.
    #[cfg(not(windows))]
    handle: bun_jsc::VmHandle,
    #[cfg(not(windows))]
    loop_kind: bun_jsc::LoopKind,
    verbose: bool,

    mutex: Mutex,
    signal: JsCell<Option<AbortSignalRef>>,
    persistent: Cell<bool>,
    path_watcher: Cell<Option<*mut path_watcher::PathWatcher>>,
    poll_ref: JsCell<KeepAlive>,
    global_this: GlobalRef,
    /// JS wrapper object, held weak: the wrapper is rooted by
    /// `has_pending_activity()` while the watcher is open; a strong ref here
    /// would self-pin it forever. Cleared by `detach()`.
    js_this: JsCell<JsRef>,
    // pub(super): read directly by `win_watcher::PathWatcher::emit`.
    pub(super) encoding: Encoding,

    /// User can call close and pre-detach so we need to track this
    closed: Cell<bool>,

    /// While it's not closed, the pending activity
    pending_activity_count: AtomicU32,
    current_task: JsCell<FSWatchTask>,
}

/// `jsc.Codegen.JSFSWatcher` cached-slot accessors (`values: ["listener"]` in
/// node.classes.ts). The C++ side is emitted by `generate-classes.ts`.
pub mod js {
    bun_jsc::codegen_cached_accessors!("FSWatcher"; listener);
}

impl FSWatcher {
    /// JS thread only (Windows delivers fs events on the loop thread).
    #[cfg(windows)]
    #[inline]
    fn vm(&self) -> &mut VirtualMachine {
        // SAFETY: `ctx` is the live per-thread VM (set in `init`); every caller
        // is on its JS thread.
        unsafe { &mut *self.ctx }
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        // SAFETY: `self.ctx` is the live per-thread VM singleton backref.
        unsafe { VirtualMachine::event_loop_ctx(self.ctx) }
    }

    /// Watcher thread → JS thread. `task` is the intrusive node of a heap batch
    /// task; the queue takes ownership unless the VM has been torn down, in
    /// which case the caller gets it back.
    #[cfg(not(windows))]
    pub(crate) fn post(
        &self,
        task: core::ptr::NonNull<ConcurrentTask>,
    ) -> bun_jsc::vm_handle::Posted {
        self.handle.post(self.loop_kind, task)
    }

    /// `self`'s address as `*mut Self` for path-watcher / abort-signal /
    /// rare-data ctx slots. Callbacks deref it as `&*const` (shared) — all
    /// mutation goes through `Cell`/`JsCell` — so no write provenance is
    /// required; the `*mut` spelling is purely to match the C signature.
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    /// Codegen `finalize: true` entry point. Runs on the mutator thread during lazy sweep.
    #[allow(clippy::boxed_local)] // codegen's signature
    pub fn finalize(self: Box<Self>) {
        // stop all managers and signals
        self.detach();
    }
}

#[cfg(windows)]
pub type FSWatchTask = FSWatchTaskWindows;
#[cfg(not(windows))]
pub type FSWatchTask = FSWatchTaskPosix;

// `Event::Rename`/`Change` carry `StringOrBytesToDecode` on Windows, which
// does not coerce to the `&[u8]` `emit()` expects — gate the whole posix task
// to keep the Windows build sound.
#[cfg(not(windows))]
pub struct FSWatchTaskPosix {
    /// `None` only during `FSWatcher::init` two-phase construction (the task is
    /// embedded as `current_task` before the boxed `FSWatcher` address is
    /// known); patched to `Some` immediately after.
    ctx: Option<bun_ptr::ParentRef<FSWatcher>>,
    count: u8,

    entries: [MaybeUninit<Entry>; 8],
    concurrent_task: ConcurrentTask,
}

#[cfg(not(windows))]
impl Taskable for FSWatchTaskPosix {
    const TAG: TaskTag = task_tag::FSWatchTask;
    /// A batch of events the watcher thread posted that nobody will emit:
    /// free it (its entries own their paths) and drop the activity unit it
    /// took — as the refused-post path in `enqueue` does.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; the FSWatcher outlives its tasks.
        unsafe {
            let ctx = (*this).ctx;
            Self::deinit(this);
            ctx.expect("FSWatchTask.ctx unset").get().unref_task();
        }
    }
}

#[cfg(not(windows))]
pub struct Entry {
    event: Event,
    needs_free: bool,
}

#[cfg(not(windows))]
impl FSWatchTaskPosix {
    fn ctx(&self) -> &FSWatcher {
        // BACKREF — `ctx` is the live owning FSWatcher (set right after
        // boxing in `init`); FSWatcher outlives all its tasks.
        // R-2: `ParentRef: Deref<Target=FSWatcher>` yields `&FSWatcher`; all
        // FSWatcher host-fns take `&self` (Cell/JsCell-backed).
        self.ctx.as_ref().expect("FSWatchTask.ctx unset").get()
    }

    pub(crate) fn append(&mut self, event: Event, needs_free: bool) {
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

    /// JS thread: deliver each batched event to the listener.
    pub(crate) fn run(&mut self) -> JsResult<()> {
        let ctx: *const FSWatcher = self.ctx();
        // SAFETY: BACKREF — the FSWatcher outlives its tasks.
        let _unref = scopeguard::guard((), |()| unsafe { (*ctx).unref_task() });
        for i in 0..self.count as usize {
            // SAFETY: entries [0..count) were written by `append`.
            let entry = unsafe { self.entries[i].assume_init_ref() };
            let emitted = match &entry.event {
                Event::Rename(file_path) => self.ctx().emit::<{ EventType::Rename }>(file_path),
                Event::Change(file_path) => self.ctx().emit::<{ EventType::Change }>(file_path),
                Event::Error { err, close } => {
                    self.ctx().emit_error(err, *close);
                    Ok(())
                }
                Event::NoFilename(event_type) => {
                    self.ctx().emit_null_filename(*event_type);
                    Ok(())
                }
                Event::Abort => {
                    self.ctx().emit_if_aborted();
                    Ok(())
                }
            };
            // A filename that could not be built (allocation failure, or the
            // VM is stopping): the rest of the batch is dropped with the task.
            emitted?;
        }
        Ok(())
    }

    pub(crate) fn append_abort(&mut self) {
        self.append(Event::Abort, false);
        self.enqueue();
    }

    pub(crate) fn enqueue(&mut self) {
        if self.count == 0 {
            return;
        }

        // if false is closed or detached (can still contain valid refs but will not create a new one)
        if self.ctx().ref_task() {
            // Reshaped for borrowck — clone self into a heap task, then reset.
            let that = bun_core::heap::into_raw(Box::new(FSWatchTaskPosix {
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
            // until the JS thread drains and `heap::take`s it in `dispatch`.
            unsafe {
                (*that).concurrent_task.task = Task::init(that);
                let node = core::ptr::NonNull::new_unchecked(core::ptr::addr_of_mut!(
                    (*that).concurrent_task
                ));
                if let bun_jsc::vm_handle::Posted::Refused(_) = self.ctx().post(node) {
                    // VM torn down: nobody will emit these events. Free the batch
                    // (its entries own their paths) and drop the activity ref.
                    let mut task = bun_core::heap::take(that);
                    task.clean_entries();
                    self.ctx().unref_task();
                }
            }
            return;
        }
        // closed or detached so just cleanEntries
        self.clean_entries();
    }

    pub(crate) fn clean_entries(&mut self) {
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
    /// `FSWatchTaskPosix.deinit`. **Not** `impl Drop`:
    /// this is only ever called on heap clones produced by `enqueue()` (via the
    /// task dispatcher), never on the embedded `FSWatcher.current_task` field —
    /// the assert below enforces that. A `Drop` impl would also fire on
    /// `*self = Self{..}` in `append()` and on `heap::take` in `finalize`,
    /// where `self` *is* `current_task`, which would always trip the assert.
    ///
    /// # Safety
    /// `this` must be the unique `heap::alloc` pointer produced by
    /// `enqueue()`; called from the JS-thread task dispatcher only.
    pub(crate) unsafe fn deinit(this: *mut Self) {
        // SAFETY: caller contract — `this` is the unique live heap clone from
        // `enqueue()`; reclaim ownership (paired with its `heap::alloc`).
        let mut task = unsafe { bun_core::heap::take(this) };
        task.clean_entries();
        #[cfg(debug_assertions)]
        {
            debug_assert!(!core::ptr::eq(task.ctx().current_task.as_ptr(), this));
        }
    }
}

#[cfg(windows)]
pub type EventPathString = StringOrBytesToDecode;
#[cfg(not(windows))]
pub type EventPathString = Box<[u8]>;

/// The kind of change a watcher backend reports for a path, before it becomes a JS event.
/// Every backend (inotify, kqueue, FSEvents, Windows) produces exactly these two.
#[derive(Copy, Clone, Default, Eq, PartialEq, strum::IntoStaticStr)]
pub enum WatchEventKind {
    #[strum(serialize = "rename")]
    Rename,
    #[strum(serialize = "change")]
    #[default]
    Change,
}

impl WatchEventKind {
    pub(crate) fn to_event(self, path: EventPathString) -> Event {
        match self {
            WatchEventKind::Rename => Event::Rename(path),
            WatchEventKind::Change => Event::Change(path),
        }
    }
}

pub enum Event {
    Rename(EventPathString),
    Change(EventPathString),
    Error {
        err: bun_sys::Error,
        close: bool,
    },
    /// An event with no filename, surfaced to JS with `null`, matching node:
    /// `Change` when the OS event queue overflowed and changes were lost,
    /// `Rename` when libuv could not convert a name to UTF-8 (Windows).
    NoFilename(WatchEventKind),
    Abort,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy, strum::IntoStaticStr)]
pub enum EventType {
    Rename = 0,
    Change = 1,
    Error = 2,
    Close = 4,
}

impl EventType {
    pub fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        Bun__domEventNameToJS(global_object, self)
    }
}

unsafe extern "C" {
    safe fn Bun__domEventNameToJS(global: &JSGlobalObject, event_type: EventType) -> JSValue;
}

#[cfg(windows)]
pub struct FSWatchTaskWindows {
    event: Event,
    ctx: Option<bun_ptr::ParentRef<FSWatcher>>,
}

#[cfg(windows)]
impl Taskable for FSWatchTaskWindows {
    const TAG: TaskTag = task_tag::FSWatchTask;
    /// As the POSIX task: free the batch, drop the activity unit.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; the FSWatcher outlives its tasks.
        unsafe {
            let ctx = (*this).ctx;
            Self::deinit(this);
            ctx.expect("FSWatchTask.ctx unset").get().unref_task();
        }
    }
}

#[cfg(windows)]
impl Default for FSWatchTaskWindows {
    fn default() -> Self {
        Self {
            event: Event::Error {
                err: bun_sys::Error {
                    errno: SystemErrno::EINVAL as _,
                    syscall: bun_sys::Tag::watch,
                    ..Default::default()
                },
                close: true,
            },
            ctx: None,
        }
    }
}

pub enum StringOrBytesToDecode {
    String(bun_core::String),
    BytesToFree(Box<[u8]>),
}

// `PathWatcher::emit` and `Event::dupe` take a borrowed `&[u8]` rel-path and box
// it into the owned `bytes_to_free` arm so the Windows task can carry it across
// the thread hop.
impl From<&[u8]> for StringOrBytesToDecode {
    #[inline]
    fn from(bytes: &[u8]) -> Self {
        StringOrBytesToDecode::BytesToFree(Box::<[u8]>::from(bytes))
    }
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

#[cfg(windows)]
impl FSWatchTaskWindows {
    pub(crate) fn append_abort(&mut self) {
        let ctx = self.ctx;
        // Balance the `ctx.unrefTask()` at the end of `run()` (matches
        // `onPathUpdateWindows` and the posix `enqueue()` path).
        // SAFETY: ParentRef — `ctx` is the live owning FSWatcher set at
        // construction; FSWatcher outlives every task it enqueues.
        // R-2: `ref_task` takes `&self`; ParentRef Derefs to `&FSWatcher`.
        if !ctx.expect("FSWatchTask.ctx unset").ref_task() {
            return;
        }
        let task = bun_core::heap::into_raw(Box::new(FSWatchTaskWindows {
            ctx,
            event: Event::Abort,
        }));

        // `ctx` is the live owning `ParentRef<FSWatcher>` (BACKREF); `vm()` →
        // `event_loop_mut()` is the audited safe `&mut EventLoop` accessor.
        // Ownership of `task` transfers to the queue (drained on the same thread).
        ctx.expect("FSWatchTask.ctx unset")
            .vm()
            .event_loop_mut()
            .enqueue_task(Task::init(task));
    }

    /// this runs on JS Context Thread
    pub(crate) fn run(&mut self) -> JsResult<()> {
        // BACKREF — `self.ctx` is the live owning FSWatcher (set at
        // construction), outliving every task it enqueues. R-2: all FSWatcher
        // methods below take `&self`, so a single `&FSWatcher` held across the
        // match is sound (aliased shared borrows are fine; the old `*mut Self`
        // re-derive dance is no longer needed). `ParentRef` Derefs to `&T`.
        let ctx: &FSWatcher = &self.ctx.expect("FSWatchTask.ctx unset");
        let _unref = scopeguard::guard((), |()| ctx.unref_task());
        match &mut self.event {
            Event::Rename(path) => Self::run_path::<{ EventType::Rename }>(ctx, path),
            Event::Change(path) => Self::run_path::<{ EventType::Change }>(ctx, path),
            Event::Error { err, close } => {
                ctx.emit_error(err, *close);
                Ok(())
            }
            Event::NoFilename(event_type) => {
                ctx.emit_null_filename(*event_type);
                Ok(())
            }
            Event::Abort => {
                ctx.emit_if_aborted();
                Ok(())
            }
        }
    }

    fn run_path<const EVENT_TYPE: EventType>(
        ctx: &FSWatcher,
        path: &mut StringOrBytesToDecode,
    ) -> JsResult<()> {
        use bun_jsc::StringJsc;
        if ctx.encoding == Encoding::Utf8 {
            let StringOrBytesToDecode::String(s) = path else {
                // Producer invariant (win_watcher::on_path_update_windows): when
                // `ctx.encoding == Utf8` the payload is always the `String`
                // variant, and `encoding` is immutable after init.
                unreachable!()
            };
            let js = core::mem::take(s).into_js(&ctx.global_this)?;
            ctx.emit_with_filename::<EVENT_TYPE>(js);
            Ok(())
        } else {
            let StringOrBytesToDecode::BytesToFree(bytes_ref) = path else {
                unreachable!()
            };
            let bytes = core::mem::take(bytes_ref);
            ctx.emit::<EVENT_TYPE>(&bytes)
        }
    }

    /// `FSWatchTaskWindows.deinit`. Explicit, not
    /// `impl Drop`, to mirror `FSWatchTaskPosix::deinit` so the dispatcher can
    /// call `FSWatchTask::deinit` uniformly.
    ///
    /// # Safety
    /// `this` must be the unique `heap::alloc` pointer produced by
    /// `append_abort()` / `on_path_update_windows()`.
    pub(crate) unsafe fn deinit(this: *mut Self) {
        // SAFETY: paired with `heap::alloc` at the enqueue site.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

impl FSWatcher {
    /// Recover `&FSWatcher` from the `*mut c_void` userdata stashed in `init`.
    ///
    /// Centralises the set-once `Option<*mut c_void> → &FSWatcher` deref so the
    /// three watcher-backend callbacks (`on_path_update_*`, `on_update_end`)
    /// stay safe at the call site. R-2: deref as shared — all `FSWatcher`
    /// mutation goes through `Cell`/`JsCell`.
    #[inline]
    fn from_ctx<'a>(ctx: Option<*mut c_void>) -> &'a FSWatcher {
        // SAFETY: ctx was registered as `*mut FSWatcher` cast to `*mut c_void`
        // in `init`. The FSWatcher is heap-stable (`heap::into_raw`) and
        // outlives every watcher callback — it owns the `path_watcher`
        // registration, which is dropped before the FSWatcher in `finalize`.
        unsafe { &*ctx.unwrap().cast::<FSWatcher>() }
    }

    #[cfg(not(windows))]
    pub(crate) fn on_path_update_posix(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
        let this = Self::from_ctx(ctx);

        if this.verbose {
            match &event {
                Event::Rename(value) | Event::Change(value) => {
                    if is_file {
                        bun_core::pretty_errorln!(
                            "<r> <d>File changed: {}<r>",
                            bstr::BStr::new(value)
                        );
                    } else {
                        bun_core::pretty_errorln!(
                            "<r> <d>Dir changed: {}<r>",
                            bstr::BStr::new(value)
                        );
                    }
                }
                _ => {}
            }
        }

        this.current_task.with_mut(|t| t.append(event, true));
    }

    #[cfg(windows)]
    pub(crate) fn on_path_update_windows(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
        let this = Self::from_ctx(ctx);

        if this.verbose {
            match &event {
                Event::Rename(value) | Event::Change(value) => {
                    if is_file {
                        bun_core::pretty_errorln!("<r> <d>File changed: {}<r>", value);
                    } else {
                        bun_core::pretty_errorln!("<r> <d>Dir changed: {}<r>", value);
                    }
                }
                _ => {}
            }
        }

        if !this.ref_task() {
            return;
        }

        let task = bun_core::heap::into_raw(Box::new(FSWatchTaskWindows {
            // SAFETY: `this` is the live owning `&FSWatcher` (BACKREF) recovered
            // from the registered userdata; outlives every task it enqueues.
            ctx: Some(unsafe { bun_ptr::ParentRef::from_raw(this.as_ctx_ptr()) }),
            event,
        }));
        // `vm()` is the BACKREF accessor; `event_loop_mut()` is the audited
        // safe `&mut EventLoop` accessor. Ownership of `task` transfers to the
        // queue.
        this.vm().event_loop_mut().enqueue_task(Task::init(task));
        let _ = is_file;
    }

    #[cfg(windows)]
    pub(crate) const ON_PATH_UPDATE: fn(Option<*mut c_void>, Event, bool) =
        Self::on_path_update_windows;
    #[cfg(not(windows))]
    pub(crate) const ON_PATH_UPDATE: fn(Option<*mut c_void>, Event, bool) =
        Self::on_path_update_posix;

    pub(crate) fn on_update_end(ctx: Option<*mut c_void>) {
        let this = Self::from_ctx(ctx);
        if this.verbose {
            Output::flush();
        }
        #[cfg(unix)]
        {
            // we only enqueue after all events are processed
            this.current_task.with_mut(|t| t.enqueue());
        }
    }
}

pub struct Arguments<'a> {
    pub path: PathLike<'static>,
    pub(crate) listener: JSValue,
    pub global_this: &'a JSGlobalObject,
    pub(crate) signal: Option<&'a AbortSignal>,
    pub(crate) persistent: bool,
    pub(crate) recursive: bool,
    pub(crate) encoding: Encoding,
    pub(crate) verbose: bool,
}

impl<'a> Arguments<'a> {
    pub fn from_js(
        ctx: &'a JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Arguments<'a>> {
        let Some(path) = PathLike::from_js(ctx, arguments)? else {
            return Err(ctx
                .throw_invalid_arguments(format_args!("filename must be a string or TypedArray")));
        };
        // `PathLike: Drop` releases the path: `?` on the error paths below
        // drops `path` automatically.

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
                        return Err(ctx
                            .throw_invalid_arguments(format_args!("recursive must be a boolean")));
                    }
                    recursive = recursive_.to_boolean();
                }

                // abort signal
                if let Some(signal_) = options_or_callable.get_truthy(ctx, "signal")? {
                    if let Some(signal_obj) = AbortSignal::from_js(signal_) {
                        // Keep it alive
                        signal_.ensure_still_alive();
                        // `signal_obj` is the live C++ AbortSignal owned by
                        // `signal_` (kept reachable for the duration of the call
                        // by `ensure_still_alive`). `AbortSignal` is an
                        // `opaque_ffi!` ZST handle; `opaque_ref` is the
                        // centralised deref proof.
                        signal = Some(AbortSignal::opaque_ref(signal_obj));
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

    pub(crate) fn create_fs_watcher(&self) -> bun_sys::Result<*mut FSWatcher> {
        FSWatcher::init(self)
    }
}

impl AbortListener for FSWatcher {
    // R-2: trait sig is fixed at `&mut self`; body just reborrows as `&self`
    // (auto-deref) and calls the interior-mutable `emit_abort`.
    fn on_abort(&mut self, reason: JSValue) {
        (*self).emit_abort(reason);
    }
}

impl FSWatcher {
    /// Read access to the JS wrapper value. Exposed for `NodeFS::watch`.
    /// Returns `UNDEFINED` if the wrapper reference has been cleared.
    #[inline]
    pub(crate) fn js_this(&self) -> JSValue {
        self.js_this.get_or_undefined()
    }

    /// `FSWatcher.initJS`. Takes `*mut Self` so the
    /// already-heap-allocated payload can be handed to `${T}__create` via
    /// `to_js_ptr` without re-boxing (see jsc_macros::JsClass).
    ///
    /// # Safety
    /// `this` must be the unique `heap::alloc` pointer produced by `init`;
    /// JS-thread only.
    pub(crate) unsafe fn init_js(this: *mut Self, listener: JSValue) {
        // SAFETY: caller contract — `this` is uniquely owned and live.
        // R-2: deref as shared; mutation goes through `Cell`/`JsCell`.
        let this_ref = unsafe { &*this };
        if this_ref.persistent.get() {
            let vm_ctx = this_ref.vm_ctx();
            this_ref.poll_ref.with_mut(|r| r.ref_(vm_ctx));
        }

        // SAFETY: ownership of `this` transfers to the GC wrapper here; the
        // wrapper's finalize hook is `FSWatcher::finalize` which calls
        // `heap::take(this)`.
        let js_this = unsafe { Self::to_js_ptr(this, &this_ref.global_this) };
        js_this.ensure_still_alive();
        this_ref.js_this.set(JsRef::init_weak(js_this));
        js::listener_set_cached(js_this, &this_ref.global_this, listener);

        if let Some(s) = this_ref.signal.get() {
            // already aborted?
            if s.aborted() {
                // safely abort next tick
                this_ref.current_task.set(FSWatchTask {
                    // SAFETY: `this` is the live boxed FSWatcher (shared; the task only reads).
                    ctx: Some(unsafe { bun_ptr::ParentRef::from_raw(this) }),
                    ..Default::default()
                });
                this_ref.current_task.with_mut(|t| t.append_abort());
            } else {
                // watch for abortion
                s.listen::<FSWatcher>(this);
            }
        }
    }

    pub(crate) fn emit_if_aborted(&self) {
        let reason = match self.signal.get() {
            Some(s) if s.aborted() => Some(s.js_reason(&self.global_this)),
            _ => None,
        };
        if let Some(err) = reason {
            self.emit_abort(err);
        }
    }

    /// R-2: `&self` + `Cell<bool>` for `closed` makes the old `*mut Self`
    /// re-derive dance unnecessary. `listener.call_with_global_this(...)`
    /// re-enters JS, which can call `watcher.close()` on this same object via
    /// the wrapper's `m_ptr` — setting `closed = true` and `detach()`-ing.
    /// `Cell::get()` after the callback observes that write because
    /// `UnsafeCell` suppresses `noalias` on `&Self`; the trailing
    /// `self.close()` then no-ops.
    pub(crate) fn emit_abort(&self, err: JSValue) {
        if self.closed.get() {
            return;
        }
        self.pending_activity_count.fetch_add(1, Ordering::Relaxed);
        // unref_task() must execute before close(). No early returns below,
        // so both calls are inlined at the end of this function.

        err.ensure_still_alive();
        let js_this = self.js_this.try_get();
        if let Some(js_this) = js_this {
            js_this.ensure_still_alive();
            if let Some(listener) = js::listener_get_cached(js_this) {
                listener.ensure_still_alive();
                let global_this = self.global_this;
                let args = [
                    EventType::Error.to_js(&global_this),
                    if err.is_empty_or_undefined_or_null() {
                        CommonAbortReason::UserAbort.to_js(&global_this)
                    } else {
                        err
                    },
                    // `fromAbort`: the JS side offers the reason to an 'error'
                    // listener but does not treat its absence as unhandled.
                    JSValue::TRUE,
                ];
                // Reported here rather than returned: the watcher still closes
                // (and emits 'close') below whatever the listener did.
                global_this.bun_vm().event_loop_mut().run_callback(
                    listener,
                    &global_this,
                    global_this.to_js_value(),
                    &args,
                );
            }
        }

        self.unref_task();
        self.close();
    }

    /// R-2: see `emit_abort` — `&self` + `Cell` so the trailing `close()`
    /// observes a re-entrant `watcher.close()` from inside the listener.
    pub(crate) fn emit_error(&self, err: &bun_sys::Error, close: bool) {
        if self.closed.get() {
            return;
        }
        // Reshaped for borrowck — `defer this.close()` moved to fn end.

        let js_this = self.js_this.try_get();
        if let Some(js_this) = js_this {
            js_this.ensure_still_alive();
            if let Some(listener) = js::listener_get_cached(js_this) {
                listener.ensure_still_alive();
                let global_object = self.global_this;
                let err_js = err.to_js(&global_object);
                let args = [EventType::Error.to_js(&global_object), err_js];
                // As `emit_abort`: reported here so the close below still runs.
                global_object.bun_vm().event_loop_mut().run_callback(
                    listener,
                    &global_object,
                    global_object.to_js_value(),
                    &args,
                );
            }
        }

        if close {
            self.close();
        }
    }

    pub(crate) fn emit_with_filename<const EVENT_TYPE: EventType>(&self, file_name: JSValue) {
        let Some(js_this) = self.js_this.try_get() else {
            return;
        };
        let Some(listener) = js::listener_get_cached(js_this) else {
            return;
        };
        emit_js::<EVENT_TYPE>(listener, &self.global_this, file_name);
    }

    /// `Event::NoFilename`: deliver `(event, null)` regardless of encoding.
    fn emit_null_filename(&self, event_type: WatchEventKind) {
        match event_type {
            WatchEventKind::Rename => {
                self.emit_with_filename::<{ EventType::Rename }>(JSValue::NULL)
            }
            WatchEventKind::Change => {
                self.emit_with_filename::<{ EventType::Change }>(JSValue::NULL)
            }
        }
    }

    pub(crate) fn emit<const EVENT_TYPE: EventType>(&self, file_name: &[u8]) -> JsResult<()> {
        debug_assert!(EVENT_TYPE != EventType::Error);
        let Some(js_this) = self.js_this.try_get() else {
            return Ok(());
        };
        let Some(listener) = js::listener_get_cached(js_this) else {
            return Ok(());
        };
        let global_object = self.global_this;
        let mut filename: JSValue = JSValue::UNDEFINED;
        if !file_name.is_empty() {
            if self.encoding == Encoding::Buffer {
                filename = jsc::ArrayBuffer::create_buffer(&global_object, file_name)?;
            } else if self.encoding == Encoding::Utf8 {
                filename = bun_string_jsc::create_utf8_for_js(&global_object, file_name)?;
            } else {
                // convert to desired encoding
                filename = Encoder::to_string(file_name, &global_object, self.encoding)?;
            }
        }

        emit_js::<EVENT_TYPE>(listener, &global_object, filename);
        Ok(())
    }
}

/// Each event's listener call is a top-level call of its own: what it throws
/// is reported there and the batch goes on (node: `'change'` events keep
/// arriving after a throwing listener).
fn emit_js<const EVENT_TYPE: EventType>(
    listener: JSValue,
    global_object: &JSGlobalObject,
    filename: JSValue,
) {
    let args = [EVENT_TYPE.to_js(global_object), filename];
    global_object.bun_vm().event_loop_mut().run_callback(
        listener,
        global_object,
        global_object.to_js_value(),
        &args,
    );
}

impl FSWatcher {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if !self.closed.get() && !self.persistent.get() {
            self.persistent.set(true);
            let vm_ctx = self.vm_ctx();
            self.poll_ref.with_mut(|r| r.ref_(vm_ctx));
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_unref(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.persistent.get() {
            self.persistent.set(false);
            let vm_ctx = self.vm_ctx();
            self.poll_ref.with_mut(|r| r.unref(vm_ctx));
        }
        Ok(JSValue::UNDEFINED)
    }

    // this can be called from Watcher Thread or JS Context Thread
    pub(crate) fn ref_task(&self) -> bool {
        let _guard = self.mutex.lock_guard();
        // R-2: `closed: Cell<bool>` is `!Sync`, but `FSWatcher` itself is
        // `!Sync` (raw-pointer fields, no `unsafe impl Sync`); cross-thread
        // access goes through `*mut FSWatcher` in `FSWatchTask.ctx` exactly as
        // before. The mutex serialises this read against the JS-thread
        // `close()` write — same soundness profile as the bare `bool` it
        // replaced.
        if self.closed.get() {
            return false;
        }
        self.pending_activity_count.fetch_add(1, Ordering::Relaxed);

        true
    }

    /// Called from the GC thread via the codegen `FSWatcher__hasPendingActivity`
    /// thunk; only touches the atomic field so `&self` is sound across threads.
    pub(crate) fn has_pending_activity(&self) -> bool {
        self.pending_activity_count.load(Ordering::Acquire) > 0
    }

    pub(crate) fn unref_task(&self) {
        let _guard = self.mutex.lock_guard();
        // JSC eventually will free it
        let prev = self.pending_activity_count.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(prev > 0);
    }

    pub fn close(&self) {
        self.mutex.lock();
        if !self.closed.get() {
            self.closed.set(true);
            // Read before `detach()` clears the ref; pending activity still
            // roots the wrapper for the close-event emit below.
            let js_this = self.js_this.try_get();
            self.mutex.unlock();
            self.detach();

            if let Some(js_this) = js_this {
                if let Some(listener) = js::listener_get_cached(js_this) {
                    // `closed` is already true so `refTask()` would return false without
                    // incrementing; bump the counter directly so the `unrefTask()` below is
                    // balanced and the count stays > 0 while the close event is emitted.
                    self.pending_activity_count.fetch_add(1, Ordering::Relaxed);
                    bun_output::scoped_log!(fs_watch, "emit('close')");
                    // Reported here rather than returned: `close()` runs from
                    // host functions and error paths that must finish releasing
                    // the watcher, and a throwing 'close' listener is uncaught in
                    // Node too (it emits on the next tick).
                    let global = self.global_this;
                    global.bun_vm().event_loop_mut().run_callback(
                        listener,
                        &global,
                        global.to_js_value(),
                        &[EventType::Close.to_js(&global), JSValue::UNDEFINED],
                    );
                    self.unref_task();
                }
            }

            self.unref_task();
        } else {
            self.mutex.unlock();
        }
        // Manual lock/unlock: the lock is released
        // before `detach()` on the not-closed path and in the else branch — every
        // path unlocks exactly once. `ref_task`/`unref_task` use the RAII guard.
    }

    /// `bun test --isolate` teardown: `close()` minus the `'close'` event (no
    /// user JS mid-swap; parity with `StatWatcher::close`). Dropping the
    /// initial pending-activity ref is the load-bearing part — `detach()`
    /// alone leaves `pending_activity_count` at 1, so `has_pending_activity()`
    /// stays true forever and the GC can never collect the wrapper, pinning
    /// the cached listener (and the outgoing file's entire global) for the
    /// rest of the run.
    pub(crate) fn close_for_isolation(&self) {
        self.mutex.lock();
        if !self.closed.get() {
            self.closed.set(true);
            self.mutex.unlock();
            self.detach();
            self.unref_task();
        } else {
            self.mutex.unlock();
        }
    }

    // this can be called multiple times
    pub(crate) fn detach(&self) {
        let ctx_ptr = self.as_ctx_ptr().cast::<c_void>();
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            handles.swap_remove(&crate::jsc_hooks::ActiveHandle::FsWatcher(
                core::ptr::NonNull::from(self),
            ));
        }

        if let Some(watcher) = self.path_watcher.take() {
            // Both backends expose `detach` as an associated fn over `*mut PathWatcher`
            // (it self-destroys via `heap::take` on the last handler, so it cannot
            // soundly take `&mut self`). `watcher` is the live pointer returned by
            // `path_watcher::watch`.
            path_watcher::PathWatcher::detach(watcher, ctx_ptr);
        }

        if self.persistent.get() {
            self.persistent.set(false);
            let vm_ctx = self.vm_ctx();
            self.poll_ref.with_mut(|r| r.unref(vm_ctx));
        }

        if let Some(signal) = self.signal.replace(None) {
            // `AbortSignalRef::Drop` already does the `unref`, so only
            // remove the listener here to avoid a double-unref.
            signal.clean_native_bindings(ctx_ptr);
        }

        // Idempotent: `detach()` can run more than once (close + finalize).
        self.js_this.set(JsRef::empty());
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_close(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.close();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn init(args: &Arguments<'_>) -> bun_sys::Result<*mut FSWatcher> {
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
        let cwd = bun_resolver::fs::FileSystem::get().top_level_dir;
        let joined_buf_len = joined_buf.len();
        let Some(joined) = Path::join_abs_string_buf_checked::<platform::Auto>(
            cwd,
            &mut joined_buf[..joined_buf_len - 1],
            &[slice],
        ) else {
            return Err(bun_sys::Error {
                errno: SystemErrno::ENAMETOOLONG as _,
                syscall: bun_sys::Tag::watch,
                path: args.path.slice().into(),
                ..Default::default()
            });
        };
        let joined_len = joined.len();
        joined_buf[joined_len] = 0;
        let file_path: &bun_core::ZStr = bun_core::ZStr::from_buf(&joined_buf[..], joined_len);

        let vm = args.global_this.bun_vm_ptr();
        // `bun_vm()` is the audited safe `&'static VirtualMachine` accessor —
        // single deref site so the four uses below stay safe.
        let vm_ref = args.global_this.bun_vm();

        let ctx = bun_core::heap::into_raw(Box::new(FSWatcher {
            ctx: vm,
            #[cfg(not(windows))]
            handle: vm_ref.handle(),
            #[cfg(not(windows))]
            loop_kind: vm_ref.current_loop_kind(),
            current_task: JsCell::new(FSWatchTask {
                ctx: None,
                ..Default::default()
            }),
            mutex: Mutex::default(),
            signal: JsCell::new(args.signal.map(|s| s.ref_())),
            persistent: Cell::new(args.persistent),
            path_watcher: Cell::new(None),
            global_this: GlobalRef::from(args.global_this),
            js_this: JsCell::new(JsRef::empty()),
            encoding: args.encoding,
            closed: Cell::new(false),
            verbose: args.verbose,
            poll_ref: JsCell::new(KeepAlive::default()),
            pending_activity_count: AtomicU32::new(1),
        }));
        // SAFETY: `ctx` is the freshly-boxed payload; uniquely owned here.
        // R-2: deref as shared; mutation goes through `JsCell`.
        let ctx_ref = unsafe { &*ctx };
        // SAFETY: `ctx` is the heap-stable Box address (shared; the task only reads).
        let parent = unsafe { bun_ptr::ParentRef::from_raw(ctx) };
        ctx_ref.current_task.with_mut(|t| t.ctx = Some(parent));

        ctx_ref
            .path_watcher
            .set(if args.signal.is_none_or(|s| !s.aborted()) {
                // The two backends take different arities (the Windows
                // backend dropped the callback parameters — only one valid
                // value each), so the call is cfg-split.
                #[cfg(windows)]
                let r = path_watcher::watch(vm_ref, file_path, args.recursive, ctx as *mut c_void);
                #[cfg(not(windows))]
                let r = path_watcher::watch(
                    vm_ref,
                    file_path,
                    args.recursive,
                    FSWatcher::ON_PATH_UPDATE,
                    FSWatcher::on_update_end,
                    ctx.cast::<c_void>(),
                );
                match r {
                    Ok(r) => Some(r),
                    Err(err) => {
                        // SAFETY: `ctx` was produced by `heap::into_raw` above and
                        // never handed to a JS wrapper; reclaim ownership.
                        FSWatcher::finalize(unsafe { Box::from_raw(ctx) });
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
            });
        // SAFETY: `ctx` is the unique heap pointer; `init_js` hands ownership to
        // the GC wrapper via `to_js_ptr`.
        unsafe {
            FSWatcher::init_js(
                ctx,
                args.listener.with_async_context_if_needed(args.global_this),
            )
        };
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            bun_core::handle_oom(handles.put(
                crate::jsc_hooks::ActiveHandle::FsWatcher(
                    core::ptr::NonNull::new(ctx).expect("init: watcher"),
                ),
                (),
            ));
        }
        Ok(ctx)
    }
}

#[cfg(not(windows))]
impl Default for FSWatchTaskPosix {
    fn default() -> Self {
        Self {
            ctx: None,
            count: 0,
            entries: [const { MaybeUninit::uninit() }; 8],
            concurrent_task: ConcurrentTask::default(),
        }
    }
}
