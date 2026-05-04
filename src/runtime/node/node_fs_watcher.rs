use core::ffi::c_void;
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use bun_aio::KeepAlive;
use bun_core::Output;
use bun_jsc::node::{Encoding, PathLike};
use bun_jsc::webcore::encoding as Encoder;
use bun_jsc::{
    self as jsc, ArgumentsSlice, CallFrame, CommonAbortReason, ConcurrentTask, EventLoop,
    JSGlobalObject, JSValue, JsResult, Task, VirtualMachine, ZigString,
};
use bun_paths::resolve_path as Path;
use bun_str::strings;
use bun_sys::{self, SystemErrno};
use bun_threading::Mutex;
use bun_webcore::AbortSignal;

bun_output::declare_scope!(fs_watch, hidden);

#[cfg(windows)]
use super::win_watcher as path_watcher;
#[cfg(not(windows))]
use super::path_watcher;

// TODO: make this a top-level struct
#[bun_jsc::JsClass]
pub struct FSWatcher {
    // codegen: jsc.Codegen.JSFSWatcher provides toJS/fromJS/fromJSDirect
    ctx: &'static VirtualMachine,
    verbose: bool,

    mutex: Mutex,
    signal: Option<Arc<AbortSignal>>,
    persistent: bool,
    path_watcher: Option<Arc<path_watcher::PathWatcher>>,
    poll_ref: KeepAlive,
    // TODO(port): lifetime — JSC_BORROW; lives as long as `ctx` (singleton VM)
    global_this: &'static JSGlobalObject,
    // TODO(port): bare JSValue heap field — self-wrapper; consider JsRef in Phase B
    js_this: JSValue,
    encoding: Encoding,

    /// User can call close and pre-detach so we need to track this
    closed: bool,

    /// While it's not closed, the pending activity
    pending_activity_count: AtomicU32,
    current_task: FSWatchTask,
}

impl FSWatcher {
    pub fn event_loop(&self) -> &EventLoop {
        self.ctx.event_loop()
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTask) {
        self.event_loop().enqueue_task_concurrent(task);
    }

    /// `pub const finalize = deinit;` — codegen `finalize: true` entry point.
    /// Runs on the mutator thread during lazy sweep.
    pub fn finalize(this: *mut Self) {
        // SAFETY: codegen guarantees `this` is the m_ctx payload, uniquely owned here.
        let this = unsafe { &mut *this };
        // stop all managers and signals
        this.detach();
        // SAFETY: allocated via Box::into_raw in `init`; finalize owns teardown.
        drop(unsafe { Box::from_raw(this) });
    }
}

#[cfg(windows)]
pub type FSWatchTask = FSWatchTaskWindows;
#[cfg(not(windows))]
pub type FSWatchTask = FSWatchTaskPosix;

pub struct FSWatchTaskPosix {
    ctx: *mut FSWatcher,
    count: u8,

    entries: [MaybeUninit<Entry>; 8],
    concurrent_task: ConcurrentTask,
}

#[derive(Clone)]
pub struct Entry {
    event: Event,
    needs_free: bool,
}

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
            let mut that = Box::new(FSWatchTaskPosix {
                ctx: self.ctx,
                count: self.count,
                entries: core::mem::replace(
                    &mut self.entries,
                    [const { MaybeUninit::uninit() }; 8],
                ),
                concurrent_task: ConcurrentTask::default(),
            });
            self.count = 0;
            let that_ptr: *mut FSWatchTaskPosix = &mut *that;
            that.concurrent_task.task = Task::init(that_ptr);
            self.ctx()
                .enqueue_task_concurrent(&mut Box::leak(that).concurrent_task);
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

impl Drop for FSWatchTaskPosix {
    fn drop(&mut self) {
        self.clean_entries();
        #[cfg(debug_assertions)]
        {
            // SAFETY: ctx is valid for the lifetime of any task (BACKREF).
            debug_assert!(!core::ptr::eq(
                unsafe { &(*self.ctx).current_task },
                self as *const _ as *const FSWatchTask
            ));
        }
    }
}

#[cfg(windows)]
pub type EventPathString = StringOrBytesToDecode;
#[cfg(not(windows))]
pub type EventPathString = Box<[u8]>;
// TODO(port): on posix, `EventPathString` is borrowed `&[u8]` at callback time
// but owned `Box<[u8]>` after `dupe()`. Phase B may want `Cow<'_, [u8]>`.

#[derive(Clone)]
pub enum Event {
    Rename(EventPathString),
    Change(EventPathString),
    Error(bun_sys::Error),
    Abort,
    Close,
}

impl Event {
    pub fn dupe(&self) -> Event {
        match self {
            Event::Rename(path) => Event::Rename(Box::<[u8]>::from(&path[..]).into()),
            Event::Change(path) => Event::Change(Box::<[u8]>::from(&path[..]).into()),
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

impl Default for FSWatchTaskWindows {
    fn default() -> Self {
        Self {
            event: Event::Error(bun_sys::Error {
                errno: SystemErrno::EINVAL as _,
                syscall: bun_sys::Tag::Watch,
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
    fn ctx(&self) -> &mut FSWatcher {
        // SAFETY: BACKREF — set from `this` (FSWatcher) at construction; FSWatcher outlives task.
        unsafe { &mut *self.ctx }
    }

    pub fn append_abort(&mut self) {
        let ctx = self.ctx();
        // Balance the `ctx.unrefTask()` at the end of `run()` (matches
        // `onPathUpdateWindows` and the posix `enqueue()` path).
        if !ctx.ref_task() {
            return;
        }
        let task = Box::new(FSWatchTaskWindows {
            ctx: self.ctx,
            event: Event::Abort,
            count: 0,
        });

        ctx.event_loop().enqueue_task(Task::init(Box::leak(task)));
    }

    /// this runs on JS Context Thread
    pub fn run(&mut self) {
        let ctx = self.ctx();

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
}

impl FSWatcher {
    pub fn on_path_update_posix(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
        // SAFETY: ctx was registered as `*mut FSWatcher` cast to `*mut c_void` in `init`.
        let this = unsafe { &mut *(ctx.unwrap() as *mut FSWatcher) };

        if this.verbose {
            match &event {
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

        let cloned = event.dupe();
        this.current_task.append(cloned, true);
    }

    pub fn on_path_update_windows(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
        // SAFETY: ctx was registered as `*mut FSWatcher` cast to `*mut c_void` in `init`.
        let this = unsafe { &mut *(ctx.unwrap() as *mut FSWatcher) };

        if this.verbose {
            match &event {
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

        let task = Box::new(FSWatchTaskWindows {
            ctx: this,
            event,
            count: 0,
        });
        this.event_loop().enqueue_task(Task::init(Box::leak(task)));
    }

    #[cfg(windows)]
    pub const ON_PATH_UPDATE: fn(Option<*mut c_void>, Event, bool) = Self::on_path_update_windows;
    #[cfg(not(windows))]
    pub const ON_PATH_UPDATE: fn(Option<*mut c_void>, Event, bool) = Self::on_path_update_posix;

    pub fn on_update_end(ctx: Option<*mut c_void>) {
        // SAFETY: ctx was registered as `*mut FSWatcher` cast to `*mut c_void` in `init`.
        let this = unsafe { &mut *(ctx.unwrap() as *mut FSWatcher) };
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
            return Err(ctx.throw_invalid_arguments(
                "filename must be a string or TypedArray",
                format_args!(""),
            ));
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
                        return Err(ctx.throw_invalid_arguments(
                            "persistent must be a boolean",
                            format_args!(""),
                        ));
                    }
                    persistent = persistent_.to_boolean();
                }

                if let Some(verbose_) = options_or_callable.get_truthy(ctx, "verbose")? {
                    if !verbose_.is_boolean() {
                        return Err(ctx.throw_invalid_arguments(
                            "verbose must be a boolean",
                            format_args!(""),
                        ));
                    }
                    verbose = verbose_.to_boolean();
                }

                if let Some(encoding_) = options_or_callable.fast_get(ctx, jsc::BuiltinName::Encoding)? {
                    encoding = Encoding::assert(encoding_, ctx, encoding)?;
                }

                if let Some(recursive_) = options_or_callable.get_truthy(ctx, "recursive")? {
                    if !recursive_.is_boolean() {
                        return Err(ctx.throw_invalid_arguments(
                            "recursive must be a boolean",
                            format_args!(""),
                        ));
                    }
                    recursive = recursive_.to_boolean();
                }

                // abort signal
                if let Some(signal_) = options_or_callable.get_truthy(ctx, "signal")? {
                    if let Some(signal_obj) = AbortSignal::from_js(signal_) {
                        // Keep it alive
                        signal_.ensure_still_alive();
                        signal = Some(signal_obj);
                    } else {
                        return Err(ctx.throw_invalid_arguments(
                            "signal is not of type AbortSignal",
                            format_args!(""),
                        ));
                    }
                }

                // listener
                if let Some(callable) = arguments.next_eat() {
                    if !callable.is_cell() || !callable.is_callable() {
                        return Err(ctx.throw_invalid_arguments(
                            "Expected \"listener\" callback to be a function",
                            format_args!(""),
                        ));
                    }
                    listener = callable;
                }
            } else {
                if !options_or_callable.is_cell() || !options_or_callable.is_callable() {
                    return Err(ctx.throw_invalid_arguments(
                        "Expected \"listener\" callback to be a function",
                        format_args!(""),
                    ));
                }
                listener = options_or_callable;
            }
        }
        if listener.is_empty() {
            return Err(
                ctx.throw_invalid_arguments("Expected \"listener\" callback", format_args!(""))
            );
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

impl FSWatcher {
    pub fn init_js(&mut self, listener: JSValue) {
        if self.persistent {
            self.poll_ref.ref_(self.ctx);
        }

        let js_this = self.to_js(self.global_this);
        js_this.ensure_still_alive();
        self.js_this = js_this;
        Self::js::listener_set_cached(js_this, self.global_this, listener);

        if let Some(s) = &self.signal {
            // already aborted?
            if s.aborted() {
                // safely abort next tick
                self.current_task = FSWatchTask {
                    ctx: self,
                    ..Default::default()
                };
                self.current_task.append_abort();
            } else {
                // watch for abortion
                self.signal = Some(s.listen(self, FSWatcher::emit_abort));
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
        // so unref_task() executes before close().
        let guard = scopeguard::guard((), |()| {
            // TODO(port): errdefer — captures &mut self twice; Phase B may inline at fn end.
        });
        let _ = guard;

        err.ensure_still_alive();
        if !self.js_this.is_empty() {
            let js_this = self.js_this;
            js_this.ensure_still_alive();
            if let Some(listener) = Self::js::listener_get_cached(js_this) {
                listener.ensure_still_alive();
                let mut args = [
                    EventType::Error.to_js(self.global_this),
                    if err.is_empty_or_undefined_or_null() {
                        CommonAbortReason::UserAbort.to_js(self.global_this)
                    } else {
                        err
                    },
                ];
                if listener
                    .call_with_global_this(self.global_this, &mut args)
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
            if let Some(listener) = Self::js::listener_get_cached(js_this) {
                listener.ensure_still_alive();
                let global_object = self.global_this;
                let Ok(err_js) = err.to_js(global_object) else {
                    self.close();
                    return;
                };
                let mut args = [EventType::Error.to_js(global_object), err_js];
                if let Err(e) = listener.call_with_global_this(global_object, &mut args) {
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
        let Some(listener) = Self::js::listener_get_cached(js_this) else {
            return;
        };
        emit_js::<EVENT_TYPE>(listener, self.global_this, file_name);
    }

    pub fn emit<const EVENT_TYPE: EventType>(&mut self, file_name: &[u8]) {
        debug_assert!(EVENT_TYPE != EventType::Error);
        let js_this = self.js_this;
        if js_this.is_empty() {
            return;
        }
        let Some(listener) = Self::js::listener_get_cached(js_this) else {
            return;
        };
        let global_object = self.global_this;
        let mut filename: JSValue = JSValue::UNDEFINED;
        if !file_name.is_empty() {
            if self.encoding == Encoding::Buffer {
                filename = match jsc::ArrayBuffer::create_buffer(global_object, file_name) {
                    Ok(v) => v,
                    Err(_) => return, // TODO: properly propagate exception upwards
                };
            } else if self.encoding == Encoding::Utf8 {
                filename = ZigString::from_utf8(file_name).to_js(global_object);
            } else {
                // convert to desired encoding
                filename = match Encoder::to_string(file_name, global_object, self.encoding) {
                    Ok(v) => v,
                    Err(_) => return,
                };
            }
        }

        emit_js::<EVENT_TYPE>(listener, global_object, filename);
    }
}

fn emit_js<const EVENT_TYPE: EventType>(
    listener: JSValue,
    global_object: &JSGlobalObject,
    filename: JSValue,
) {
    let mut args = [EVENT_TYPE.to_js(global_object), filename];

    if let Err(err) = listener.call_with_global_this(global_object, &mut args) {
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
            this.poll_ref.ref_(this.ctx);
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
            this.poll_ref.unref(this.ctx);
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
        let _guard = self.mutex.lock();
        if self.closed {
            return false;
        }
        self.pending_activity_count.fetch_add(1, Ordering::Relaxed);

        true
    }

    #[bun_jsc::host_call]
    pub extern "C" fn has_pending_activity(this: *mut Self) -> bool {
        // SAFETY: called from GC thread; only touches the atomic field.
        unsafe { (*this).pending_activity_count.load(Ordering::Acquire) > 0 }
    }

    pub fn unref_task(&mut self) {
        let _guard = self.mutex.lock();
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
                if let Some(listener) = Self::js::listener_get_cached(js_this) {
                    // `closed` is already true so `refTask()` would return false without
                    // incrementing; bump the counter directly so the `unrefTask()` below is
                    // balanced and the count stays > 0 while the close event is emitted.
                    self.pending_activity_count.fetch_add(1, Ordering::Relaxed);
                    bun_output::scoped_log!(fs_watch, "emit('close')");
                    emit_js::<{ EventType::Close }>(listener, self.global_this, JSValue::UNDEFINED);
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
        if self.ctx.test_isolation_enabled {
            self.ctx.rare_data().remove_fs_watcher_for_isolation(self);
        }

        if let Some(path_watcher) = self.path_watcher.take() {
            path_watcher.detach(self);
        }

        if self.persistent {
            self.persistent = false;
            self.poll_ref.unref(self.ctx);
        }

        if let Some(signal) = self.signal.take() {
            signal.detach(self);
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
        let mut joined_buf = bun_paths::path_buffer_pool().get();
        let file_path: &bun_str::ZStr = 'brk: {
            let mut slice = args.path.slice();
            if strings::starts_with(slice, b"file://") {
                slice = &slice[b"file://".len()..];
            }

            let cwd = bun_fs::FileSystem::instance().top_level_dir;

            break 'brk Path::join_abs_string_buf_z(cwd, &mut joined_buf, &[slice], Path::Style::Auto);
        };

        let vm = args.global_this.bun_vm();

        let mut ctx = Box::new(FSWatcher {
            ctx: vm,
            current_task: FSWatchTask {
                ctx: core::ptr::null_mut(),
                count: 0,
                ..Default::default()
            },
            mutex: Mutex::default(),
            signal: args.signal.map(|s| s.ref_()),
            persistent: args.persistent,
            path_watcher: None,
            // SAFETY: JSGlobalObject is a singleton that outlives FSWatcher (JSC_BORROW per LIFETIMES.tsv).
            global_this: unsafe {
                core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(args.global_this)
            },
            js_this: JSValue::ZERO,
            encoding: args.encoding,
            closed: false,
            verbose: args.verbose,
            poll_ref: KeepAlive::default(),
            pending_activity_count: AtomicU32::new(1),
        });
        let ctx_ptr: *mut FSWatcher = &mut *ctx;
        ctx.current_task.ctx = ctx_ptr;

        ctx.path_watcher = if args.signal.map_or(true, |s| !s.aborted()) {
            match path_watcher::watch(
                vm,
                file_path,
                args.recursive,
                FSWatcher::ON_PATH_UPDATE,
                FSWatcher::on_update_end,
                ctx_ptr as *mut c_void,
            ) {
                bun_sys::Result::Ok(r) => Some(r),
                bun_sys::Result::Err(err) => {
                    // SAFETY: ctx is the only owner; finalize frees the Box.
                    FSWatcher::finalize(Box::into_raw(ctx));
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: err.errno,
                        syscall: bun_sys::Tag::Watch,
                        path: args.path.slice().into(),
                        ..Default::default()
                    });
                }
            }
        } else {
            None
        };
        ctx.init_js(args.listener.with_async_context_if_needed(args.global_this));
        if vm.test_isolation_enabled {
            vm.rare_data().add_fs_watcher_for_isolation(ctx_ptr);
        }
        bun_sys::Result::Ok(Box::into_raw(ctx))
    }
}

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs_watcher.zig (713 lines)
//   confidence: medium
//   todos:      8
//   notes:      .classes.ts payload; defer-based close()/emit_abort() reshaped; EventPathString cfg-split needs Phase B review; Mutex uses manual lock/unlock in close()
// ──────────────────────────────────────────────────────────────────────────
