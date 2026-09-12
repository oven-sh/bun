use core::cell::Cell;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use bun_collections::smallvec::SmallVec;
use bun_core::Output;
use bun_core::strings;
#[cfg(windows)]
use bun_event_loop::Task;
use bun_io::KeepAlive;
use bun_jsc::abort_signal::{AbortSubscription, OnAbort};
use bun_jsc::bun_string_jsc;
use bun_jsc::node::PathLike;
use bun_jsc::{
    self as jsc, AbortSignal, AbortSignalRef, ArgumentsSlice, CallFrame, CommonAbortReason,
    CommonAbortReasonExt as _, GlobalRef, JSGlobalObject, JSValue, JsRef, JsResult, SysErrorJsc,
};
use bun_jsc::{JsCell, JsCellRefExt as _};
use bun_paths::resolve_path::{self as Path, platform};
use bun_ptr::{BackRef, ThreadBound};
use bun_sys::{self, SystemErrno};
use bun_threading::Mutex;

use crate::node::types::{Encoding, PathLikeExt};
use crate::webcore::encoding as Encoder;

bun_output::declare_scope!(fs_watch, hidden);

#[cfg(not(windows))]
use super::path_watcher;
#[cfg(windows)]
use super::win_watcher as path_watcher;

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy), so a listener
// that re-enters (`watcher.close()` from inside the callback) is observed by
// the code after the call instead of being miscompiled away under `noalias`.
#[bun_jsc::JsClass(no_constructor)]
pub struct FSWatcher {
    verbose: bool,
    // pub(super): read by `win_watcher::PathWatcher::emit`.
    pub(super) encoding: Encoding,
    global_this: GlobalRef,
    /// JS wrapper object, held weak: the wrapper is rooted by
    /// `has_pending_activity()` while the watcher is open; a strong ref here
    /// would self-pin it forever. Cleared by `detach()`.
    js_this: JsCell<JsRef>,
    persistent: Cell<bool>,
    poll_ref: JsCell<KeepAlive>,
    /// Counted ref on the `AbortSignal` from `options.signal`, for reading its
    /// state and reason. Cleared by `detach()`.
    signal: JsCell<Option<AbortSignalRef>>,
    /// Our abort listener on `signal`; dropping it unregisters. Cleared by
    /// `detach()`.
    abort_subscription: JsCell<Option<AbortSubscription>>,
    /// Our handler on the (shared, per-path) OS watch; dropping it detaches it
    /// and tears the watch down if it was the last. Cleared by `detach()` —
    /// close, the VM's stop phase, or finalize — which is what ends the
    /// watcher thread's access to this object.
    watch: JsCell<Option<path_watcher::Registration>>,
    /// Open/closed state and the pending-activity count that roots the JS
    /// wrapper. Shared with the watcher thread's [`EventSink`] and every
    /// queued [`FSWatchTask`], which only touch this part.
    activity: Arc<Activity>,
}

/// The part of an [`FSWatcher`] the watcher thread and the GC thread reach.
pub(crate) struct Activity {
    /// Serialises `closed` against `ref_task` (watcher thread) so no new
    /// activity is taken once `close()` has decided.
    mutex: Mutex,
    /// User can call close and pre-detach so we need to track this.
    closed: AtomicBool,
    /// While it's not closed, the pending activity
    pending: AtomicU32,
}

impl Activity {
    // this can be called from Watcher Thread or JS Context Thread
    pub(crate) fn ref_task(&self) -> bool {
        let _guard = self.mutex.lock_guard();
        if self.closed.load(Ordering::Relaxed) {
            return false;
        }
        self.pending.fetch_add(1, Ordering::Relaxed);
        true
    }

    pub(crate) fn unref_task(&self) {
        let _guard = self.mutex.lock_guard();
        // JSC eventually will free it
        let prev = self.pending.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(prev > 0);
    }

    #[inline]
    fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Relaxed)
    }

    /// `true` if this call moved the watcher from open to closed.
    fn close(&self) -> bool {
        let _guard = self.mutex.lock_guard();
        if self.closed.load(Ordering::Relaxed) {
            return false;
        }
        self.closed.store(true, Ordering::Relaxed);
        true
    }
}

/// `jsc.Codegen.JSFSWatcher` cached-slot accessors (`values: ["listener"]` in
/// node.classes.ts). The C++ side is emitted by `generate-classes.ts`.
pub mod js {
    bun_jsc::codegen_cached_accessors!("FSWatcher"; listener);
}

/// A batch of events for one watcher, queued to its JS thread
/// (`task_tag::FSWatchTask`). Holds one unit of the watcher's pending
/// activity, which is what keeps `owner` alive until it runs or is released.
pub struct FSWatchTask {
    owner: ThreadBound<FSWatcher>,
    activity: Arc<Activity>,
    entries: EventBatch,
}

type EventBatch = SmallVec<[Event; 8]>;

impl FSWatchTask {
    fn new(
        owner: ThreadBound<FSWatcher>,
        activity: Arc<Activity>,
        entries: EventBatch,
    ) -> Box<Self> {
        Box::new(FSWatchTask {
            owner,
            activity,
            entries,
        })
    }

    /// JS thread: deliver each batched event to the listener.
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) -> JsResult<()> {
        let FSWatchTask {
            owner,
            activity,
            entries,
        } = *self;
        let this = owner.get();
        let result = (|| {
            for event in entries {
                match event {
                    #[cfg(not(windows))]
                    Event::Rename(file_path) => this.emit::<{ EventType::Rename }>(&file_path)?,
                    #[cfg(not(windows))]
                    Event::Change(file_path) => this.emit::<{ EventType::Change }>(&file_path)?,
                    #[cfg(windows)]
                    Event::Rename(mut path) => {
                        this.emit_decoded::<{ EventType::Rename }>(&mut path)?
                    }
                    #[cfg(windows)]
                    Event::Change(mut path) => {
                        this.emit_decoded::<{ EventType::Change }>(&mut path)?
                    }
                    Event::Error { err, close } => this.emit_error(&err, close),
                    Event::NoFilename(event_type) => this.emit_null_filename(event_type),
                    Event::Abort => this.emit_if_aborted(),
                }
                // A filename that could not be built (allocation failure, or
                // the VM is stopping): the rest of the batch is dropped with
                // the task.
            }
            Ok(())
        })();
        activity.unref_task();
        result
    }

    /// The VM is tearing down and nobody will emit these events: drop them and
    /// the activity unit the batch took.
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn release_unrun(self: Box<Self>) {
        self.activity.unref_task();
    }
}

/// One `FSWatcher`'s end of a shared POSIX path watch: what the watcher
/// thread holds (under the manager lock) to batch events and hand them to the
/// owner's JS thread.
#[cfg(not(windows))]
pub(crate) struct EventSink {
    /// Deref'd only by the queued [`FSWatchTask`] on the JS thread; here it is
    /// just carried. The owner drops its `Registration` (which drops this sink)
    /// before it goes away.
    owner: ThreadBound<FSWatcher>,
    activity: Arc<Activity>,
    vm: bun_jsc::VmHandle,
    loop_kind: bun_jsc::LoopKind,
    verbose: bool,
    batch: EventBatch,
}

#[cfg(not(windows))]
impl EventSink {
    /// JS thread.
    fn new(owner: &FSWatcher) -> EventSink {
        let vm = owner.global_this.bun_vm();
        EventSink {
            owner: ThreadBound::new(owner),
            activity: Arc::clone(&owner.activity),
            vm: vm.handle(),
            loop_kind: vm.current_loop_kind(),
            verbose: owner.verbose,
            batch: EventBatch::new(),
        }
    }

    /// Identity of the owning `FSWatcher`, for logs.
    pub(crate) fn owner_addr(&self) -> usize {
        self.owner.addr()
    }

    pub(crate) fn on_path_update(&mut self, event: Event, is_file: bool) {
        if self.verbose {
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

        if self.batch.len() == self.batch.inline_size() {
            self.enqueue();
        }
        self.batch.push(event);
    }

    /// End of one batch of OS events: hand what was collected to the JS thread.
    pub(crate) fn on_update_end(&mut self) {
        if self.verbose {
            Output::flush();
        }
        // we only enqueue after all events are processed
        self.enqueue();
    }

    fn enqueue(&mut self) {
        if self.batch.is_empty() {
            return;
        }

        // false once closed or detached: batches already queued keep their
        // activity unit, but no new one is taken.
        if self.activity.ref_task() {
            let task = FSWatchTask::new(
                self.owner.clone(),
                Arc::clone(&self.activity),
                core::mem::take(&mut self.batch),
            );
            if let Err(task) = self.vm.post_boxed(self.loop_kind, task) {
                // VM torn down: nobody will emit these events.
                task.release_unrun();
            }
            return;
        }
        // closed or detached so just drop the events
        self.batch.clear();
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

impl FSWatcher {
    /// Queue `event` alone to this watcher's JS thread (from the JS thread).
    fn enqueue_one(&self, event: Event) {
        if !self.activity.ref_task() {
            return;
        }
        let mut entries = EventBatch::new();
        entries.push(event);
        let task = FSWatchTask::new(ThreadBound::new(self), Arc::clone(&self.activity), entries);
        let vm = self.global_this.bun_vm();
        #[cfg(not(windows))]
        if let Err(task) = vm.handle().post_boxed(vm.current_loop_kind(), task) {
            task.release_unrun();
        }
        #[cfg(windows)]
        vm.event_loop_mut().enqueue_task(Task::from_boxed(task));
    }

    /// libuv delivers fs events on the JS thread; each becomes its own task.
    #[cfg(windows)]
    pub(crate) fn on_path_update_windows(&self, event: Event, is_file: bool) {
        if self.verbose {
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

        self.enqueue_one(event);
    }

    #[cfg(windows)]
    pub(crate) fn on_update_end(&self) {
        if self.verbose {
            Output::flush();
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

    /// Start the watch and return the JS `FSWatcher` object.
    pub(crate) fn create_fs_watcher(&self) -> bun_sys::Result<JSValue> {
        FSWatcher::init(self)
    }
}

impl OnAbort for FSWatcher {
    fn on_abort(&self, reason: JSValue) {
        self.emit_abort(reason);
    }
}

impl FSWatcher {
    pub(crate) fn emit_if_aborted(&self) {
        let reason = match self.signal.get() {
            Some(s) if s.aborted() => Some(s.js_reason(&self.global_this)),
            _ => None,
        };
        if let Some(err) = reason {
            self.emit_abort(err);
        }
    }

    /// `listener` re-enters JS, which can call `watcher.close()` on this same
    /// object via the wrapper's `m_ctx` — closing and `detach()`-ing. The
    /// trailing `self.close()` observes that and no-ops.
    pub(crate) fn emit_abort(&self, err: JSValue) {
        if self.activity.is_closed() {
            return;
        }
        self.activity.pending.fetch_add(1, Ordering::Relaxed);
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

        self.activity.unref_task();
        self.close();
    }

    /// See `emit_abort` — the trailing `close()` observes a re-entrant
    /// `watcher.close()` from inside the listener.
    pub(crate) fn emit_error(&self, err: &bun_sys::Error, close: bool) {
        if self.activity.is_closed() {
            return;
        }

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

    /// Windows: the path arrives either as a ready-made WTF string (utf8
    /// watchers) or as bytes to encode.
    #[cfg(windows)]
    fn emit_decoded<const EVENT_TYPE: EventType>(
        &self,
        path: &mut StringOrBytesToDecode,
    ) -> JsResult<()> {
        use bun_jsc::StringJsc;
        if self.encoding == Encoding::Utf8 {
            let StringOrBytesToDecode::String(s) = path else {
                // Producer invariant (win_watcher::PathWatcher::emit): when
                // `encoding == Utf8` the payload is always the `String`
                // variant, and `encoding` is immutable after init.
                unreachable!()
            };
            let js = core::mem::take(s).into_js(&self.global_this)?;
            self.emit_with_filename::<EVENT_TYPE>(js);
            Ok(())
        } else {
            let StringOrBytesToDecode::BytesToFree(bytes_ref) = path else {
                unreachable!()
            };
            let bytes = core::mem::take(bytes_ref);
            self.emit::<EVENT_TYPE>(&bytes)
        }
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
    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        self.global_this.bun_vm().loop_ctx()
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if !self.activity.is_closed() && !self.persistent.get() {
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

    /// Called from the GC thread via the codegen `FSWatcher__hasPendingActivity`
    /// thunk; only touches the atomic count so `&self` is sound across threads.
    pub(crate) fn has_pending_activity(&self) -> bool {
        self.activity.pending.load(Ordering::Acquire) > 0
    }

    pub fn close(&self) {
        if self.activity.close() {
            // Read before `detach()` clears the ref; pending activity still
            // roots the wrapper for the close-event emit below.
            let js_this = self.js_this.try_get();
            self.detach();

            if let Some(js_this) = js_this {
                if let Some(listener) = js::listener_get_cached(js_this) {
                    // `closed` is already true so `ref_task()` would return false without
                    // incrementing; bump the counter directly so the `unref_task()` below is
                    // balanced and the count stays > 0 while the close event is emitted.
                    self.activity.pending.fetch_add(1, Ordering::Relaxed);
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
                    self.activity.unref_task();
                }
            }

            self.activity.unref_task();
        }
    }

    /// `bun test --isolate` teardown: `close()` minus the `'close'` event (no
    /// user JS mid-swap; parity with `StatWatcher::close`). Dropping the
    /// initial pending-activity ref is the load-bearing part — `detach()`
    /// alone leaves the count at 1, so `has_pending_activity()` stays true
    /// forever and the GC can never collect the wrapper, pinning the cached
    /// listener (and the outgoing file's entire global) for the rest of the
    /// run.
    pub(crate) fn close_for_isolation(&self) {
        if self.activity.close() {
            self.detach();
            self.activity.unref_task();
        }
    }

    // this can be called multiple times
    pub(crate) fn detach(&self) {
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            handles.swap_remove(&crate::jsc_hooks::ActiveHandle::FsWatcher(
                core::ptr::NonNull::from(self),
            ));
        }

        // Detaches our handler from the shared OS watch (the last one out
        // tears it down).
        self.watch.set(None);

        if self.persistent.get() {
            self.persistent.set(false);
            let vm_ctx = self.vm_ctx();
            self.poll_ref.with_mut(|r| r.unref(vm_ctx));
        }

        self.abort_subscription.set(None);
        self.signal.set(None);

        // Idempotent: `detach()` can run more than once (close + finalize).
        self.js_this.set(JsRef::empty());
    }

    /// codegen `finalize: true` entry point; runs on the mutator thread during
    /// lazy sweep.
    #[allow(clippy::boxed_local)] // codegen's signature
    pub fn finalize(self: Box<Self>) {
        // stop all managers and signals
        self.detach();
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

    pub(crate) fn init(args: &Arguments<'_>) -> bun_sys::Result<JSValue> {
        let mut joined_buf = bun_paths::path_buffer_pool::get();
        let slice = {
            let mut s = args.path.slice();
            if strings::starts_with(s, b"file://") {
                s = &s[b"file://".len()..];
            }
            s
        };
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

        let global: &JSGlobalObject = args.global_this;

        let watcher = Box::new(FSWatcher {
            verbose: args.verbose,
            encoding: args.encoding,
            global_this: GlobalRef::from(global),
            js_this: JsCell::new(JsRef::empty()),
            persistent: Cell::new(args.persistent),
            poll_ref: JsCell::new(KeepAlive::default()),
            signal: JsCell::new(args.signal.map(AbortSignal::ref_)),
            abort_subscription: JsCell::new(None),
            watch: JsCell::new(None),
            activity: Arc::new(Activity {
                mutex: Mutex::default(),
                closed: AtomicBool::new(false),
                pending: AtomicU32::new(1),
            }),
        });

        if args.signal.is_none_or(|s| !s.aborted()) {
            // The box gives the watcher its final address before anything
            // (the sink, the wrapper) records it.
            #[cfg(not(windows))]
            let r = path_watcher::watch(file_path, args.recursive, EventSink::new(&watcher));
            #[cfg(windows)]
            let r = path_watcher::watch(
                global.bun_vm(),
                file_path,
                args.recursive,
                BackRef::new(&*watcher),
            );
            match r {
                Ok(registration) => watcher.watch.set(Some(registration)),
                Err(err) => {
                    // Nothing else holds the watcher yet; dropping it releases
                    // the signal ref.
                    drop(watcher);
                    return Err(bun_sys::Error {
                        errno: err.errno,
                        syscall: bun_sys::Tag::watch,
                        path: args.path.slice().into(),
                        ..Default::default()
                    });
                }
            }
        }

        if watcher.persistent.get() {
            let vm_ctx = watcher.vm_ctx();
            watcher.poll_ref.with_mut(|r| r.ref_(vm_ctx));
        }

        // Ownership of the box moves to the JS wrapper (`FSWatcherClass__finalize`
        // hands it back to `finalize`).
        let js_this = FSWatcher::to_js_boxed(watcher, global);
        js_this.ensure_still_alive();
        let this: &FSWatcher = js_this
            .as_class_ref::<FSWatcher>()
            .expect("FSWatcher wrapper just created");
        this.js_this.set(JsRef::init_weak(js_this));
        js::listener_set_cached(
            js_this,
            global,
            args.listener.with_async_context_if_needed(global),
        );

        if let Some(s) = args.signal {
            if s.aborted() {
                // safely abort next tick
                this.enqueue_one(Event::Abort);
            } else {
                // watch for abortion
                this.abort_subscription
                    .set(Some(s.subscribe(BackRef::new(this))));
            }
        }

        if let Some(handles) = crate::jsc_hooks::active_handles() {
            bun_core::handle_oom(handles.put(
                crate::jsc_hooks::ActiveHandle::FsWatcher(core::ptr::NonNull::from(this)),
                (),
            ));
        }
        Ok(js_this)
    }
}
