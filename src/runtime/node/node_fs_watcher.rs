use core::cell::Cell;
use core::ffi::c_void;

use bun_core::BoundedArray;
use bun_core::Output;
use bun_core::strings;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{BoxedTask, TaskTag, task_tag};
use bun_io::KeepAlive;
#[cfg(not(target_os = "macos"))]
use bun_jsc::SysErrorJsc as _;
use bun_jsc::bindgen::JsScope;
use bun_jsc::bun_string_jsc;
use bun_jsc::node::PathLike;
use bun_jsc::{
    self as jsc, AbortSignal, AbortSignalRef, ArgumentsSlice, CommonAbortReason,
    CommonAbortReasonExt as _, GlobalRef, JSGlobalObject, JSValue, JsRef, JsResult,
    VirtualMachineRef as VirtualMachine,
};
use bun_jsc::{JsCell, JsCellRefExt as _, WrapperGuard};
use bun_ptr::{RefPtr, ThreadSafeRefCount};
use bun_sys::{self, SystemErrno};
use bun_threading::Mutex;

use crate::generated_bindgen::node_fs_watcher::js_FSWatcher as js;
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
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub(crate) struct FSWatcher {
    /// JS-thread uses only.
    ctx: bun_ptr::BackRef<VirtualMachine>,
    /// How the (process-wide) watcher thread delivers event batches to the
    /// VM while this watcher is attached. Weak: `detach()` — close, the VM's stop
    /// phase, or finalize — is what ends the thread's access to `self`.
    handle: bun_jsc::VmHandle,
    loop_kind: bun_jsc::LoopKind,
    verbose: bool,

    mutex: Mutex,
    signal: JsCell<Option<AbortSignalRef>>,
    persistent: Cell<bool>,
    path_watcher: Cell<Option<path_watcher::Handle>>,
    poll_ref: KeepAlive,
    global_this: GlobalRef,
    /// The JS wrapper, held strong while the watcher is open so that the listener stays callable.
    pub(crate) js_this: JsCell<JsRef>,
    encoding: Encoding,

    /// User can call close and pre-detach so we need to track this
    closed: Cell<bool>,

    /// The JS wrapper holds one ref, and so does each task queued for the JS thread.
    ref_count: ThreadSafeRefCount<FSWatcher>,
    /// What the next task delivers. On POSIX, under the lock of `PathWatcherManager`.
    pending_events: JsCell<Events>,

    /// Armed until `detach()`: the watcher closes with the context that started it.
    abort_handle: bun_jsc::AbortHandle,
}

bun_jsc::impl_abort_handle_owner!(FSWatcher, abort_handle, |this, cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ not yet detached).
    unsafe {
        match cause {
            bun_jsc::AbortCause::Signal(reason) => RefPtr::init_ref(this).emit_abort(reason),
            bun_jsc::AbortCause::ContextStopped(_) => (*this).close_without_event(),
        }
    }
});

impl FSWatcher {
    /// `self`'s address as `*mut Self` for path-watcher / abort-signal /
    /// rare-data ctx slots. Callbacks deref it as `&*const` (shared) — all
    /// mutation goes through `Cell`/`JsCell` — so no write provenance is
    /// required; the `*mut` spelling is purely to match the C signature.
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    /// Runs on the mutator thread during lazy sweep, before the wrapper's ref is dropped.
    pub(crate) fn finalize(&self) {
        // stop all managers and signals
        self.detach();
    }
}

pub(crate) struct FSWatchTask {
    events: Events,
    concurrent_task: ConcurrentTask,
    ctx: RefPtr<FSWatcher>,
}

impl BoxedTask for FSWatchTask {
    const TAG: TaskTag = task_tag::FSWatchTask;
    /// A batch of events the watcher thread posted that nobody will emit.
    fn release_unrun(self: Box<Self>) {}
    /// The watcher closes with the context that started it (`abort_handle`); a batch that arrives
    /// afterwards finds it closed.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

type Events = BoundedArray<Event, 8>;

impl FSWatchTask {
    /// JS thread: deliver each batched event to the listener.
    pub(crate) fn run(&mut self) -> JsResult<()> {
        for event in self.events.as_slice() {
            let emitted = match event {
                Event::Rename(file_path) => self.ctx.emit::<{ EventType::Rename }>(file_path),
                Event::Change(file_path) => self.ctx.emit::<{ EventType::Change }>(file_path),
                #[cfg(not(target_os = "macos"))]
                Event::Error { err, close } => {
                    self.ctx.emit_error(err, *close);
                    Ok(())
                }
                #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
                Event::NoFilename(event_type) => {
                    self.ctx.emit_null_filename(*event_type);
                    Ok(())
                }
                #[cfg(windows)]
                Event::Deleted(errno) => {
                    self.ctx.emit_deleted(*errno);
                    Ok(())
                }
                Event::Abort => {
                    self.ctx.emit_if_aborted();
                    Ok(())
                }
            };
            // A filename that could not be built (allocation failure, or the
            // VM is stopping): the rest of the batch is dropped with the task.
            emitted?;
        }
        Ok(())
    }
}

impl FSWatcher {
    fn append_event(self: &RefPtr<Self>, event: Event) {
        if self.pending_events.get().len() == 8 {
            self.enqueue_events();
        }
        self.pending_events
            .with_mut(|events| events.append_assume_capacity(event));
    }

    fn enqueue_abort(self: &RefPtr<Self>) {
        self.append_event(Event::Abort);
        self.enqueue_events();
    }

    fn enqueue_events(self: &RefPtr<Self>) {
        if self.pending_events.get().is_empty() {
            return;
        }
        let Some(ctx) = self.ref_task() else {
            self.pending_events.with_mut(Events::clear);
            return;
        };
        let batch = Box::new(FSWatchTask {
            events: self.pending_events.take(),
            concurrent_task: ConcurrentTask::default(),
            ctx,
        });
        let _ =
            (self.handle).post_intrusive(self.loop_kind, batch, |batch| &mut batch.concurrent_task);
    }
}

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
    pub(crate) fn to_event(self, path: Box<[u8]>) -> Event {
        match self {
            WatchEventKind::Rename => Event::Rename(path),
            WatchEventKind::Change => Event::Change(path),
        }
    }
}

pub(crate) enum Event {
    Rename(Box<[u8]>),
    Change(Box<[u8]>),
    #[cfg(not(target_os = "macos"))]
    Error {
        err: bun_sys::Error,
        close: bool,
    },
    /// An event with no filename, surfaced to JS with `null`, matching node:
    /// `Change` when the OS event queue overflowed and changes were lost.
    #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
    NoFilename(WatchEventKind),
    /// Deleting the watched directory ends the watch, as in libuv 1.53: https://github.com/libuv/libuv/pull/5013
    #[cfg(windows)]
    Deleted(bun_sys::E),
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

impl FSWatcher {
    /// Recover the `FSWatcher` from the `*mut c_void` userdata stashed in `init`.
    ///
    /// Centralises the set-once `Option<*mut c_void> → &RefPtr` cast so the
    /// watcher-backend callbacks (`on_path_update`, `on_update_end`)
    /// stay safe at the call site. R-2: deref as shared — all `FSWatcher`
    /// mutation goes through `Cell`/`JsCell`.
    #[inline]
    fn from_ctx(ctx: &Option<*mut c_void>) -> &RefPtr<FSWatcher> {
        // SAFETY: ctx was registered as `*mut FSWatcher` cast to `*mut c_void`
        // in `init`. The FSWatcher is heap-stable and
        // outlives every watcher callback — it owns the `path_watcher`
        // registration, which is dropped before the wrapper's ref in `finalize`.
        // `RefPtr` is a transparent pointer.
        unsafe { &*core::ptr::from_ref(ctx.as_ref().unwrap()).cast() }
    }

    pub(crate) fn on_path_update(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
        let this = Self::from_ctx(&ctx);

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

        this.append_event(event);
    }

    pub(crate) fn on_update_end(ctx: Option<*mut c_void>) {
        let this = Self::from_ctx(&ctx);
        if this.verbose {
            Output::flush();
        }
        this.enqueue_events();
    }
}

pub(crate) struct Arguments<'a> {
    pub path: PathLike<'static>,
    pub(crate) listener: JSValue,
    pub global_this: &'a JSGlobalObject,
    /// The context of the script that called `fs.watch`: the watcher is that script's.
    pub(crate) context: &'a bun_jsc::ScriptExecutionContext,
    pub(crate) signal: Option<AbortSignalRef>,
    pub(crate) persistent: bool,
    pub(crate) recursive: bool,
    pub(crate) encoding: Encoding,
    pub(crate) verbose: bool,
}

impl<'a> Arguments<'a> {
    pub(crate) fn from_js(
        cx: &bun_jsc::JsThread<'a>,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Arguments<'a>> {
        let Some(path) = PathLike::from_js(cx.global(), arguments)? else {
            return Err(cx
                .global()
                .throw_invalid_arguments(format_args!("filename must be a string or TypedArray")));
        };
        // `PathLike: Drop` releases the path: `?` on the error paths below
        // drops `path` automatically.

        let mut listener: JSValue = JSValue::ZERO;
        let mut signal: Option<AbortSignalRef> = None;
        let mut persistent: bool = true;
        let mut recursive: bool = false;
        let mut encoding: Encoding = Encoding::Utf8;
        let mut verbose = false;
        if let Some(options_or_callable) = arguments.next_eat() {
            // options
            if options_or_callable.is_object() {
                if let Some(persistent_) =
                    options_or_callable.get_truthy(cx.global(), "persistent")?
                {
                    if !persistent_.is_boolean() {
                        return Err(cx.global().throw_invalid_arguments(format_args!(
                            "persistent must be a boolean"
                        )));
                    }
                    persistent = persistent_.to_boolean();
                }

                if let Some(verbose_) = options_or_callable.get_truthy(cx.global(), "verbose")? {
                    if !verbose_.is_boolean() {
                        return Err(cx
                            .global()
                            .throw_invalid_arguments(format_args!("verbose must be a boolean")));
                    }
                    verbose = verbose_.to_boolean();
                }

                if let Some(encoding_) =
                    options_or_callable.fast_get(cx.global(), jsc::BuiltinName::encoding)?
                {
                    encoding = Encoding::assert(encoding_, cx.global(), encoding)?;
                }

                if let Some(recursive_) =
                    options_or_callable.get_truthy(cx.global(), "recursive")?
                {
                    if !recursive_.is_boolean() {
                        return Err(cx
                            .global()
                            .throw_invalid_arguments(format_args!("recursive must be a boolean")));
                    }
                    recursive = recursive_.to_boolean();
                }

                // abort signal
                if let Some(signal_) = options_or_callable.get_truthy(cx.global(), "signal")? {
                    signal = AbortSignal::ref_from_js(signal_);
                    if signal.is_none() {
                        return Err(cx.global().throw_invalid_arguments(format_args!(
                            "signal is not of type AbortSignal"
                        )));
                    }
                }

                // listener
                if let Some(callable) = arguments.next_eat() {
                    if !callable.is_cell() || !callable.is_callable() {
                        return Err(cx.global().throw_invalid_arguments(format_args!(
                            "Expected \"listener\" callback to be a function"
                        )));
                    }
                    listener = callable;
                }
            } else {
                if !options_or_callable.is_cell() || !options_or_callable.is_callable() {
                    return Err(cx.global().throw_invalid_arguments(format_args!(
                        "Expected \"listener\" callback to be a function"
                    )));
                }
                listener = options_or_callable;
            }
        }
        if listener.is_empty() {
            return Err(cx
                .global()
                .throw_invalid_arguments(format_args!("Expected \"listener\" callback")));
        }

        Ok(Arguments {
            path,
            listener,
            global_this: cx.global(),
            context: cx.context(),
            signal,
            persistent,
            recursive,
            encoding,
            verbose,
        })
    }

    pub(crate) fn create_fs_watcher(self) -> bun_sys::Result<JSValue> {
        FSWatcher::init(self)
    }
}

impl FSWatcher {
    /// The GC wrapper takes over `self`.
    fn init_js(
        self: RefPtr<Self>,
        global: &JSGlobalObject,
        listener: JSValue,
    ) -> WrapperGuard<'_, Self> {
        if self.persistent.get() {
            let vm_ctx = self.ctx.loop_ctx();
            self.poll_ref.ref_(vm_ctx);
        }

        if let Some(s) = self.signal.get() {
            // already aborted?
            if s.aborted() {
                // safely abort next tick
                self.enqueue_abort();
            } else {
                // SAFETY: this is the live boxed FSWatcher; `detach()` disarms the handle.
                unsafe { bun_jsc::AbortHandle::follow_owner(self.as_ptr(), s.clone()) };
            }
        }

        let this = js::wrap(self, global);
        this.set_js_ref_strong(global);
        js::listener_set_cached(this.to_js(), global, listener);
        this
    }

    pub(crate) fn emit_if_aborted(self: &RefPtr<Self>) {
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
    pub(crate) fn emit_abort(self: &RefPtr<Self>, err: JSValue) {
        if self.closed.get() {
            return;
        }
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
                global_this.bun_vm().event_loop().run_callback(
                    bun_event_loop::ContextId::NONE,
                    listener,
                    &global_this,
                    global_this.to_js_value(),
                    &args,
                );
            }
        }

        self.close();
    }

    /// Reported like an abort: not thrown when there is no 'error' listener.
    #[cfg(windows)]
    fn emit_deleted(self: &RefPtr<Self>, errno: bun_sys::E) {
        if !self.closed.get() {
            let err = bun_sys::Error::from_code(errno, bun_sys::Tag::watch);
            self.emit_abort(err.to_js(&self.global_this));
        }
    }

    /// R-2: see `emit_abort` — `&self` + `Cell` so the trailing `close()`
    /// observes a re-entrant `watcher.close()` from inside the listener.
    #[cfg(not(target_os = "macos"))]
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
                global_object.bun_vm().event_loop().run_callback(
                    bun_event_loop::ContextId::NONE,
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

    #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
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
    #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
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
    global_object.bun_vm().event_loop().run_callback(
        bun_event_loop::ContextId::NONE,
        listener,
        global_object,
        global_object.to_js_value(),
        &args,
    );
}

impl FSWatcher {
    pub(crate) fn r#ref(&self) {
        if !self.closed.get() && !self.persistent.get() {
            self.persistent.set(true);
            let vm_ctx = self.ctx.loop_ctx();
            self.poll_ref.ref_(vm_ctx);
        }
    }

    pub(crate) fn unref(&self) {
        if self.persistent.get() {
            self.persistent.set(false);
            let vm_ctx = self.ctx.loop_ctx();
            self.poll_ref.unref(vm_ctx);
        }
    }

    // this can be called from Watcher Thread or JS Context Thread
    /// Never the last ref on the watcher thread: `finalize` detaches the watcher before the wrapper's ref is dropped.
    fn ref_task(self: &RefPtr<Self>) -> Option<RefPtr<Self>> {
        // Serialises the read of `closed` against the JS thread's `close()`.
        let _guard = self.mutex.lock_guard();
        (!self.closed.get()).then(|| self.clone())
    }

    pub(crate) fn close(&self) {
        let guard = self.mutex.lock_guard();
        if !self.closed.get() {
            self.closed.set(true);
            // Taken before `detach()` clears it: roots the wrapper while 'close' is emitted.
            let js_this = self.js_this.replace(JsRef::empty());
            drop(guard);
            self.detach();

            if let Some(js_this) = js_this.try_get() {
                if let Some(listener) = js::listener_get_cached(js_this) {
                    bun_output::scoped_log!(fs_watch, "emit('close')");
                    // Reported here rather than returned: `close()` runs from
                    // host functions and error paths that must finish releasing
                    // the watcher, and a throwing 'close' listener is uncaught in
                    // Node too (it emits on the next tick).
                    let global = self.global_this;
                    global.bun_vm().event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        listener,
                        &global,
                        global.to_js_value(),
                        &[EventType::Close.to_js(&global), JSValue::UNDEFINED],
                    );
                }
            }
        }
    }

    /// The watcher's context is stopping: `close()` minus the `'close'` event
    /// (no user JS then; parity with `StatWatcher::close`).
    fn close_without_event(&self) {
        let guard = self.mutex.lock_guard();
        if !self.closed.get() {
            self.closed.set(true);
            drop(guard);
            self.detach();
        }
    }

    // this can be called multiple times
    pub(crate) fn detach(&self) {
        let ctx_ptr = self.as_ctx_ptr().cast::<c_void>();
        self.abort_handle.leave();

        if let Some(watcher) = self.path_watcher.take() {
            path_watcher::PathWatcher::detach(watcher, ctx_ptr);
        }

        if self.persistent.get() {
            self.persistent.set(false);
            let vm_ctx = self.ctx.loop_ctx();
            self.poll_ref.unref(vm_ctx);
        }

        self.abort_handle.unfollow();
        self.signal.set(None);

        // Idempotent: `detach()` can run more than once (close + finalize).
        self.js_this.set(JsRef::empty());
    }

    pub(crate) fn do_close(&self, _: &mut JsScope<'_>) {
        self.close();
    }

    /// Returns the JS wrapper (`undefined` once `detach()` has cleared it).
    pub(crate) fn init(args: Arguments<'_>) -> bun_sys::Result<JSValue> {
        let slice = {
            let mut s = args.path.slice();
            if strings::starts_with(s, b"file://") {
                s = &s[b"file://".len()..];
            }
            s
        };
        let cwd = bun_resolver::fs::FileSystem::get().top_level_dir();
        let mut file_path = bun_paths::Path::resolve(&[cwd, slice]);
        // The Windows backend does not need the trailing separator.
        if cfg!(not(windows)) {
            file_path.copy_trailing_sep_from(slice);
        }
        if file_path.len() >= bun_paths::MAX_PATH_BYTES {
            return Err(bun_sys::Error {
                errno: SystemErrno::ENAMETOOLONG as _,
                syscall: bun_sys::Tag::watch,
                path: args.path.slice().into(),
                ..Default::default()
            });
        }
        let file_path: &bun_core::ZStr = &file_path;

        let vm_ref = args.global_this.bun_vm();
        let is_aborted = args.signal.as_ref().is_some_and(|s| s.aborted());

        let watcher = RefPtr::new(FSWatcher {
            ctx: bun_ptr::BackRef::new(vm_ref),
            handle: vm_ref.handle(),
            loop_kind: vm_ref.current_loop_kind(),
            pending_events: JsCell::new(Events::new()),
            mutex: Mutex::default(),
            signal: JsCell::new(args.signal),
            persistent: Cell::new(args.persistent),
            path_watcher: Cell::new(None),
            global_this: GlobalRef::from(args.global_this),
            js_this: JsCell::new(JsRef::empty()),
            encoding: args.encoding,
            closed: Cell::new(false),
            verbose: args.verbose,
            poll_ref: KeepAlive::default(),
            ref_count: ThreadSafeRefCount::init(),
            abort_handle: bun_jsc::AbortHandle::for_owner::<FSWatcher>(),
        });
        let ctx = watcher.as_ptr();

        watcher.path_watcher.set(if !is_aborted {
            match path_watcher::watch(vm_ref, file_path, args.recursive, ctx.cast()) {
                Ok(r) => Some(r),
                Err(err) => {
                    watcher.detach();
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
        let listener = args.listener.with_async_context_if_needed(args.global_this);
        let watcher = watcher.init_js(args.global_this, listener);
        // SAFETY: `ctx` is heap-allocated; `detach()` disarms it before it is finalized.
        unsafe { bun_jsc::AbortHandle::arm_owner(ctx, args.context) };
        Ok(watcher.js_this.get_or_undefined())
    }
}
