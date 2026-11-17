use core::cell::Cell;
use core::ops::Deref;
use core::ptr::NonNull;

use crate::api::bun_subprocess::Subprocess;
use crate::api::html_rewriter::RewriterPipe;
use crate::generated_bindgen::sink::{
    ArrayBufferSinkStartOptions, FileSinkStartOptions, NetworkSinkStartOptions,
    ReadableSinkControllerStartOptions, SinkChunk, SinkFd, js_ReadableSinkController as js,
};
use crate::webcore::SinkHandle;
use crate::webcore::fetch::FetchRequestBodySink;
use crate::webcore::file_sink::FileSink;
use crate::webcore::streams::{
    self, HTTPResponseSink, HTTPSResponseSink, NetworkSink, Result::Temporary, SourceHandle,
};
use bun_jsc::bindgen::{JsHeap, JsLocal, JsPayload, JsScope, JsWrapper};
use bun_jsc::{
    ErrorCode, JSGlobalObject, JSValue, JsCell, JsClass, JsError, JsResult, JsThread,
    SysErrorJsc as _,
};
use bun_ptr::{AliasableBox, BackRef};
use bun_removable_features::removable_body_behind_value;
use bun_sys::{self as sys, Error as SysError};

pub(crate) use crate::webcore::array_buffer_sink::ArrayBufferSink;

/// Emits the `JsSinkType` items that every sink forwards 1:1 to an inherent
/// method of the same name (`memory_cost`, `write_bytes` -> `write`,
/// `write_utf16`, `write_latin1`, `end`, `flush_from_js`, `start`).
/// Invoke inside the `impl JsSinkType for T` block; `Self::name` resolves to
/// the inherent method ahead of the trait item being defined, so the forward
/// does not recurse. `end_from_js` differs per sink and stays hand-written.
/// The arm without arguments also emits `Entered` and `enter`.
#[macro_export]
macro_rules! impl_js_sink_forwarders {
    // `start` also wants the context of the script that starts the sink.
    (start_takes_context) => {
        $crate::impl_js_sink_forwarders!(@common);
        fn start(
            this: &mut Self::Entered<'_>,
            config: $crate::webcore::streams::Start,
            context: &::bun_jsc::ScriptExecutionContext,
        ) -> ::bun_sys::Result<()> {
            Self::start(this, &config, context)
        }
    };
    () => {
        $crate::impl_js_sink_forwarders!(@common);
        type Entered<'a> = &'a mut Self;
        unsafe fn enter<'a>(mut this: ::core::ptr::NonNull<Self>) -> &'a mut Self {
            // SAFETY: trait contract.
            unsafe { this.as_mut() }
        }
        fn start(
            this: &mut Self::Entered<'_>,
            config: $crate::webcore::streams::Start,
            _context: &::bun_jsc::ScriptExecutionContext,
        ) -> ::bun_sys::Result<()> {
            Self::start(this, &config)
        }
    };
    (@common) => {
        fn memory_cost(&self) -> usize {
            Self::memory_cost(self)
        }
        fn write_bytes(
            this: &mut Self::Entered<'_>,
            data: &$crate::webcore::streams::Result<'_>,
        ) -> $crate::webcore::streams::result::Writable {
            Self::write(this, data)
        }
        fn write_utf16(
            this: &mut Self::Entered<'_>,
            text: &[u16],
        ) -> $crate::webcore::streams::result::Writable {
            Self::write_utf16(this, text)
        }
        fn write_latin1(
            this: &mut Self::Entered<'_>,
            data: &$crate::webcore::streams::Result<'_>,
        ) -> $crate::webcore::streams::result::Writable {
            Self::write_latin1(this, data)
        }
        fn end(
            this: &mut Self::Entered<'_>,
            err: ::core::option::Option<::bun_sys::Error>,
        ) -> ::bun_sys::Result<()> {
            Self::end(this, err)
        }
        fn flush_from_js(
            this: &mut Self::Entered<'_>,
            cx: &::bun_jsc::JsThread<'_>,
            wait: bool,
        ) -> ::bun_sys::Result<::bun_jsc::JSValue> {
            Self::flush_from_js(this, cx, wait)
        }
    };
}

/// What [`JSSink`] and [`ReadableSinkController`] call on a sink.
pub(crate) trait JsSinkType: Sized + 'static {
    const NAME: &'static str;

    /// `&Self` for a sink that the JS it runs can reach, else `&mut Self`.
    type Entered<'a>: Deref<Target = Self>;
    /// # Safety
    /// `this` is live for as long as the result is used. A `&mut Self` is the only borrow.
    unsafe fn enter<'a>(this: NonNull<Self>) -> Self::Entered<'a>;
    /// Also returns a ref on a sink that the JS it runs can free.
    ///
    /// # Safety
    /// As [`enter`](Self::enter). The ref, where there is one, keeps `this` alive until it is dropped.
    unsafe fn enter_with_ref<'a>(this: NonNull<Self>) -> (impl Sized, Self::Entered<'a>) {
        // SAFETY: caller contract.
        ((), unsafe { Self::enter(this) })
    }

    fn memory_cost(&self) -> usize;
    fn write_bytes(
        this: &mut Self::Entered<'_>,
        data: &streams::Result<'_>,
    ) -> streams::result::Writable;
    fn write_utf16(this: &mut Self::Entered<'_>, text: &[u16]) -> streams::result::Writable;
    fn write_latin1(
        this: &mut Self::Entered<'_>,
        data: &streams::Result<'_>,
    ) -> streams::result::Writable;
    fn end(this: &mut Self::Entered<'_>, err: Option<SysError>) -> sys::Result<()>;
    fn end_from_js(this: &mut Self::Entered<'_>, cx: &JsThread<'_>) -> sys::Result<JSValue>;
    fn flush_from_js(
        this: &mut Self::Entered<'_>,
        cx: &JsThread<'_>,
        wait: bool,
    ) -> sys::Result<JSValue>;
    fn start(
        this: &mut Self::Entered<'_>,
        config: streams::Start,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> sys::Result<()>;
    fn pending_state_is_pending(&self) -> bool {
        false
    }
    fn protect_js_wrapper(&self, _global: &JSGlobalObject, _this_value: JSValue) {}
    fn update_ref(&self, _value: bool) {}
    fn get_fd(&self) -> Option<i32> {
        None
    }
}

/// A sink that script holds through a [`JSSink`].
pub(crate) trait WrappedSink: JsSinkType {
    /// Keeps the sink alive. Dropped by `close()`, or inside a GC sweep.
    type Wrapped;
    fn as_non_null(wrapped: &Self::Wrapped) -> NonNull<Self>;
}

/// A sink that a stream writes to through a [`ReadableSinkController`].
pub(crate) trait ControlledSink: JsSinkType {
    fn to_any_sink(this: NonNull<Self>) -> AnyControlledSink;

    /// `assign_to_stream` made `controller` for this sink: a sink that keeps JS values roots it and puts them on it.
    fn controller_created(
        _this: &mut Self::Entered<'_>,
        _controller: JSValue,
        _global: &JSGlobalObject,
    ) {
    }

    /// Once per controller, on every detach path including its `Drop`. A sink
    /// co-owned by another GC cell releases the controller's claim here (sweep
    /// order between the two cells is unspecified, so neither destructor alone
    /// may free it). Never free the allocation inline: the caller holds
    /// `&Self` and the controller keeps using the sink in the same frame;
    /// defer a last-owner free to the event loop.
    fn controller_detached(&self) {}

    /// A controller died still attached to `this`, right after
    /// [`controller_detached`](Self::controller_detached).
    ///
    /// # Safety
    /// `this` is live unless `controller_detached` released its last ref, and is not used after the call, which may free it.
    unsafe fn controller_finalize(this: *mut Self);

    /// The source failed, so the bytes written so far are a truncated body:
    /// `controller.close(error)` with a truthy argument, or the pump's close
    /// for an errored stream, whose `reason` may be nullish. The default keeps
    /// the clean end for sinks whose owner handles the pump promise rejection.
    ///
    /// Raw pointer: failing can re-enter the sink through its owner and may
    /// free it.
    ///
    /// # Safety
    /// `this` is the controller's live sink.
    unsafe fn close_with_error(
        this: *mut Self,
        _global: &JSGlobalObject,
        _reason: JSValue,
    ) -> sys::Result<()> {
        // SAFETY: caller contract.
        let (_ref, mut this) = unsafe { Self::enter_with_ref(NonNull::new_unchecked(this)) };
        Self::end(&mut this, None)
    }

    fn source<'a>(this: &'a mut Self::Entered<'_>) -> &'a Cell<SourceHandle>;
}

// ──────────────────────────────────────────────────────────────────────────
// What a sink's JS object and a controller both do
//
// `sink` is live, and host functions are synchronous on one thread, so the
// `&mut T` that `enter` may form is the only one for as long as it lasts.
// ──────────────────────────────────────────────────────────────────────────

#[cold]
fn throw_already_closed(global: &JSGlobalObject, name: &str) -> JsError {
    global.throw(format_args!(
        "This {name} has already been closed. A \"direct\" ReadableStream terminates its underlying socket once `async pull()` returns.",
    ))
}

#[cold]
fn throw_invalid_chunk(global: &JSGlobalObject, chunk: JSValue) -> JsError {
    let code = if chunk.is_undefined_or_null() {
        ErrorCode::STREAM_NULL_VALUES
    } else {
        ErrorCode::INVALID_ARG_TYPE
    };
    global.throw_value(global.to_type_error(
        code,
        format_args!("write() expects a string, ArrayBufferView, or ArrayBuffer"),
    ))
}

fn write_chunk<'a, T: JsSinkType>(
    sink: NonNull<T>,
    cx: &mut JsScope<'a>,
    chunk: SinkChunk<'a>,
) -> JsResult<JSValue> {
    // SAFETY: see the section comment.
    let (_ref, mut sink) = unsafe { T::enter_with_ref(sink) };
    // The chunk's argument slot holds the bytes for the call, and the sink copies what it keeps.
    let written = match chunk {
        SinkChunk::Bytes(buffer) => buffer.with_bytes(&cx.heap, |bytes| {
            if bytes.is_empty() {
                return streams::Writable::Owned(0);
            }
            T::write_bytes(&mut sink, &Temporary(bytes))
        }),
        SinkChunk::Text(text) if text.is_empty() => return Ok(JSValue::js_number(0.0)),
        SinkChunk::Text(text) if text.is_utf16() => T::write_utf16(&mut sink, text.utf16()),
        SinkChunk::Text(text) => T::write_latin1(&mut sink, &Temporary(text.latin1())),
        SinkChunk::Other(value) => return Err(throw_invalid_chunk(cx.global(), value.to_js())),
    };
    Ok(written.to_js(&cx.js_thread()))
}

fn flush_sink<T: JsSinkType>(
    sink: NonNull<T>,
    cx: &JsThread<'_>,
    wait: Option<bool>,
) -> JsResult<JSValue> {
    let wait = wait == Some(true);
    // SAFETY: see the section comment. Only the Windows writer calls its handler from `flush`.
    #[cfg(not(windows))]
    let result = T::flush_from_js(&mut unsafe { T::enter(sink) }, cx, wait);
    // SAFETY: see the section comment.
    #[cfg(windows)]
    let result = T::flush_from_js(&mut unsafe { T::enter_with_ref(sink) }.1, cx, wait);
    result.map_err(|error| error.throw(cx.global()))
}

fn start_sink<T: JsSinkType>(
    sink: NonNull<T>,
    cx: &JsThread<'_>,
    config: streams::Start,
) -> JsResult<()> {
    // SAFETY: see the section comment.
    let result = T::start(
        &mut unsafe { T::enter_with_ref(sink) }.1,
        config,
        cx.context(),
    );
    result.map_err(|error| error.throw(cx.global()))
}

/// A sink can leave an exception pending and return no error. A termination stays pending: `BunStreamSource.cpp` stops on it.
fn pending_exception_or<R>(global: &JSGlobalObject, result: sys::Result<R>) -> JsResult<R> {
    if global.has_exception() {
        return Err(JsError::Thrown);
    }
    result.map_err(|error| error.throw(global))
}

fn end_sink<T: JsSinkType>(sink: NonNull<T>, cx: &JsThread<'_>) -> JsResult<JSValue> {
    // SAFETY: see the section comment.
    let result = T::end_from_js(&mut unsafe { T::enter_with_ref(sink) }.1, cx);
    pending_exception_or(cx.global(), result)
}

/// `reason` is `None` for a clean close.
fn close_sink<T: ControlledSink>(
    sink: NonNull<T>,
    global: &JSGlobalObject,
    reason: Option<JSValue>,
) -> JsResult<()> {
    let result = match reason {
        // SAFETY: see the section comment.
        None => T::end(&mut unsafe { T::enter_with_ref(sink) }.1, None),
        // SAFETY: see the section comment.
        Some(reason) => unsafe { T::close_with_error(sink.as_ptr(), global, reason) },
    };
    pending_exception_or(global, result)
}

/// `SourceHandle::JSController` does not root the controller, so once it detaches the source must not fire. A sink that was assigned to another stream since holds the newer controller.
fn controller_detached<T: ControlledSink>(sink: NonNull<T>, controller: JSValue) {
    // SAFETY: see the section comment. Nothing here frees the sink.
    let mut sink = unsafe { T::enter(sink) };
    let source = T::source(&mut sink);
    if matches!(source.get(), SourceHandle::JSController(held) if held == controller) {
        source.set(SourceHandle::None);
    }
    sink.controller_detached();
}

/// # Safety
/// As [`ControlledSink::controller_finalize`].
unsafe fn controller_finalize<T: ControlledSink>(sink: NonNull<T>) {
    // SAFETY: the caller's contract is the same one.
    unsafe { T::controller_finalize(sink.as_ptr()) }
}

fn sink_memory_cost<T: JsSinkType>(sink: NonNull<T>) -> usize {
    // SAFETY: see the section comment.
    size_of::<T>() + unsafe { sink.as_ref() }.memory_cost()
}

// ──────────────────────────────────────────────────────────────────────────
// JSSink
// ──────────────────────────────────────────────────────────────────────────

/// What the JS object of an `ArrayBufferSink`, a `FileSink` or a `NetworkSink` holds.
pub(crate) struct JSSink<T: WrappedSink> {
    /// `None` after `close()`.
    sink: JsCell<Option<T::Wrapped>>,
    ref_count: Cell<i32>,
    /// Notified that its stdin is gone when the object closes or is collected.
    subprocess: Cell<Option<NonNull<Subprocess<'static>>>>,
}

impl<T: WrappedSink> JSSink<T> {
    fn new(sink: T::Wrapped, subprocess: Option<NonNull<Subprocess<'static>>>) -> Self {
        Self {
            sink: JsCell::new(Some(sink)),
            ref_count: Cell::new(1),
            subprocess: Cell::new(subprocess),
        }
    }

    fn sink(&self) -> Option<NonNull<T>> {
        self.sink.get().as_ref().map(T::as_non_null)
    }

    fn sink_or_throw(&self, global: &JSGlobalObject) -> JsResult<NonNull<T>> {
        self.sink()
            .ok_or_else(|| throw_already_closed(global, T::NAME))
    }

    fn notify_subprocess(&self) {
        if let Some(subprocess) = self.subprocess.take() {
            removable_body_behind_value!(Spawn, {
                // SAFETY: the `Subprocess` clears this with `forget_subprocess` before it is freed.
                unsafe { subprocess.as_ref() }.on_stdin_destroyed();
            });
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.sink().map_or(0, sink_memory_cost)
    }

    pub(crate) fn close(&self, cx: &mut JsScope<'_>) -> JsResult<()> {
        let Some(sink) = self.sink.take() else {
            return Ok(());
        };
        // SAFETY: `sink` keeps it alive.
        let ended = T::end(&mut unsafe { T::enter(T::as_non_null(&sink)) }, None);
        let result = pending_exception_or(cx.global(), ended);
        // Before `sink` drops: the subprocess clears `weak_file_sink_stdin_ptr`.
        self.notify_subprocess();
        result
    }

    pub(crate) fn flush(&self, cx: &mut JsScope<'_>, wait: Option<bool>) -> JsResult<JSValue> {
        flush_sink(self.sink_or_throw(cx.global())?, &cx.js_thread(), wait)
    }

    pub(crate) fn end<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<JSValue> {
        // SAFETY: the object's live sink.
        let (_ref, mut sink) = unsafe { T::enter_with_ref(self.sink_or_throw(cx.global())?) };
        let result =
            T::end_from_js(&mut sink, &cx.js_thread()).map_err(|error| error.throw(cx.global()));
        // The object stays attached and alive so that the pending write can resolve its promise.
        if sink.pending_state_is_pending() {
            sink.protect_js_wrapper(cx.global(), this_value.to_js());
        }
        result
    }

    fn start_with_config(&self, cx: &mut JsScope<'_>, config: streams::Start) -> JsResult<()> {
        start_sink(self.sink_or_throw(cx.global())?, &cx.js_thread(), config)
    }

    pub(crate) fn write<'a>(
        &self,
        cx: &mut JsScope<'a>,
        chunk: SinkChunk<'a>,
    ) -> JsResult<JSValue> {
        write_chunk(self.sink_or_throw(cx.global())?, cx, chunk)
    }

    pub(crate) fn r#ref(&self) {
        let Some(sink) = self.sink() else { return };
        self.ref_count.set(self.ref_count.get() + 1);
        if self.ref_count.get() == 1 {
            // SAFETY: the object's live sink.
            unsafe { sink.as_ref() }.update_ref(true);
        }
    }

    pub(crate) fn unref(&self) {
        let Some(sink) = self.sink() else { return };
        self.ref_count.set((self.ref_count.get() - 1).max(0));
        if self.ref_count.get() == 0 {
            // SAFETY: the object's live sink.
            unsafe { sink.as_ref() }.update_ref(false);
        }
    }

    pub(crate) fn get_fd(&self) -> SinkFd {
        match self.sink() {
            None => SinkFd::Closed,
            // SAFETY: the object's live sink.
            Some(sink) => unsafe { sink.as_ref() }
                .get_fd()
                .map_or(SinkFd::None, SinkFd::Fd),
        }
    }
}

impl<T: WrappedSink> JSSink<T>
where
    Self: JsClass,
{
    pub(crate) fn create_object(
        global: &JSGlobalObject,
        sink: T::Wrapped,
        subprocess: Option<NonNull<Subprocess<'static>>>,
    ) -> JSValue {
        Self::new(sink, subprocess).to_js(global)
    }

    /// The sink of `value`, unless that is not such an object or it is closed.
    pub(crate) fn sink_from_js(value: JSValue) -> Option<NonNull<T>> {
        value.as_class_ref::<Self>()?.sink()
    }

    /// The `Subprocess` is going away, or its stdin already has.
    pub(crate) fn forget_subprocess(value: JSValue) {
        if let Some(this) = value.as_class_ref::<Self>() {
            this.subprocess.set(None);
        }
    }
}

impl JSSink<ArrayBufferSink> {
    pub(crate) fn constructor() -> Self {
        Self::new(AliasableBox::new(ArrayBufferSink::default()), None)
    }

    pub(crate) fn call<'a>(heap: &JsHeap<'a>) -> JsWrapper<'a, Self> {
        Self::constructor().into_js(heap)
    }

    pub(crate) fn start(
        &self,
        cx: &mut JsScope<'_>,
        options: &ArrayBufferSinkStartOptions,
    ) -> JsResult<()> {
        self.start_with_config(cx, streams::Start::array_buffer_sink(options))
    }
}

impl JSSink<FileSink> {
    pub(crate) fn start(
        &self,
        cx: &mut JsScope<'_>,
        options: &FileSinkStartOptions<'_>,
    ) -> JsResult<()> {
        self.start_with_config(cx, streams::Start::file_sink(&options.path, options.fd))
    }
}

impl JSSink<NetworkSink> {
    pub(crate) fn start(
        &self,
        cx: &mut JsScope<'_>,
        options: &NetworkSinkStartOptions,
    ) -> JsResult<()> {
        self.start_with_config(cx, streams::Start::chunk_size(options.high_water_mark))
    }
}

impl<T: WrappedSink> Drop for JSSink<T> {
    fn drop(&mut self) {
        self.notify_subprocess();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadableSinkController
// ──────────────────────────────────────────────────────────────────────────

/// The sink of a [`ReadableSinkController`].
#[derive(Copy, Clone)]
pub(crate) enum AnyControlledSink {
    FileSink(NonNull<FileSink>),
    RewriterPipe(NonNull<RewriterPipe>),
    HTTPResponseSink(NonNull<HTTPResponseSink>),
    HTTPSResponseSink(NonNull<HTTPSResponseSink>),
    NetworkSink(NonNull<NetworkSink>),
    FetchRequestBodySink(NonNull<FetchRequestBodySink>),
}

impl AnyControlledSink {
    /// # Safety
    /// The sink is live for as long as the handle is used.
    unsafe fn to_sink_handle(self) -> SinkHandle {
        // SAFETY: caller contract.
        unsafe {
            match self {
                Self::FileSink(sink) => SinkHandle::FileSink(BackRef::from_raw(sink.as_ptr())),
                Self::RewriterPipe(sink) => {
                    SinkHandle::HTMLRewriter(BackRef::from_raw(sink.as_ptr()))
                }
                Self::HTTPResponseSink(sink) => {
                    SinkHandle::HttpResponse(BackRef::from_raw_mut(sink.as_ptr()))
                }
                Self::HTTPSResponseSink(sink) => {
                    SinkHandle::HttpsResponse(BackRef::from_raw_mut(sink.as_ptr()))
                }
                Self::NetworkSink(sink) => {
                    SinkHandle::S3Upload(BackRef::from_raw_mut(sink.as_ptr()))
                }
                Self::FetchRequestBodySink(sink) => {
                    SinkHandle::FetchRequestBody(BackRef::from_raw_mut(sink.as_ptr()))
                }
            }
        }
    }
}

/// Writes to a native sink on behalf of a stream: it is the `controller` of a
/// `type: "direct"` stream, and what the pump of any other stream writes to.
///
/// Generated code calls the `&self` methods. A sink calls the functions that take
/// `controller: JSValue`, which it keeps as its `source()` or in its `PipeCell`.
pub(crate) struct ReadableSinkController {
    /// Dangles once detached: read it through `sink()`. After that only the variant is used.
    sink: AnyControlledSink,
    is_detached: Cell<bool>,
    /// The destination went away (peer abort, write error) before the source closed the controller.
    destination_closed: Cell<bool>,
}

impl ReadableSinkController {
    /// A new controller attached to `sink`; it must be detached before the sink is freed.
    pub(crate) fn create<T: ControlledSink>(global: &JSGlobalObject, sink: NonNull<T>) -> JSValue {
        Self {
            sink: T::to_any_sink(sink),
            is_detached: Cell::new(false),
            destination_closed: Cell::new(false),
        }
        .to_js(global)
    }

    /// Pump `stream` into the sink through a new controller, kept as the
    /// sink's `source()`. It is installed before the pump starts because the
    /// pump drains whatever the stream already holds (user code included)
    /// before returning, and a sink failing in there detaches its `source()`.
    pub(crate) fn assign_to_stream<T: ControlledSink>(
        global: &JSGlobalObject,
        stream: JSValue,
        sink: NonNull<T>,
    ) -> JSValue {
        let controller = Self::create(global, sink);
        Self::assign_controller_to_stream(global, stream, controller, sink)
    }

    /// [`assign_to_stream`](Self::assign_to_stream) through a `controller` from [`create`](Self::create).
    pub(crate) fn assign_controller_to_stream<T: ControlledSink>(
        global: &JSGlobalObject,
        stream: JSValue,
        controller: JSValue,
        sink: NonNull<T>,
    ) -> JSValue {
        // SAFETY: `sink` is a live sink owned by the caller for this synchronous call.
        let mut sink = unsafe { T::enter(sink) };
        T::controller_created(&mut sink, controller, global);
        T::source(&mut sink).set(SourceHandle::JSController(controller));
        start_pump(global, stream, controller)
    }

    pub(crate) fn detach(controller: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        let this = controller
            .as_class_ref::<Self>()
            .expect("a ReadableSinkController");
        this.detach_with_reason(global, None)
    }

    /// [`detach`](Self::detach) for the `Drop` of the sink, which is not entered again.
    pub(crate) fn detach_dropped_sink(
        controller: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        let this = controller
            .as_class_ref::<Self>()
            .expect("a ReadableSinkController");
        this.is_detached.set(true);
        this.detach_with_reason(global, None)
    }

    /// The sink closed underneath its source.
    pub(crate) fn on_close(
        controller: JSValue,
        global: &JSGlobalObject,
        reason: JSValue,
    ) -> JsResult<()> {
        let this = controller
            .as_class_ref::<Self>()
            .expect("a ReadableSinkController");
        this.destination_closed.set(true);
        js::on_close(controller, global, reason, /* sink_closed */ true)
    }

    fn this_value(&self) -> JSValue {
        // SAFETY: `create` is the only constructor, and it gives the controller to its JS object.
        unsafe { self.wrapper_value() }
    }

    fn sink(&self) -> Option<AnyControlledSink> {
        (!self.is_detached.get()).then_some(self.sink)
    }

    /// For a native transform, which writes to the sink without the controller's methods.
    pub(crate) fn sink_handle(&self) -> SinkHandle {
        // SAFETY: the sink is live for as long as the controller is attached.
        self.sink()
            .map_or(SinkHandle::None, |sink| unsafe { sink.to_sink_handle() })
    }

    pub(crate) fn memory_cost(&self) -> usize {
        match self.sink() {
            None => 0,
            Some(AnyControlledSink::FileSink(sink)) => sink_memory_cost(sink),
            Some(AnyControlledSink::RewriterPipe(sink)) => {
                removable_body_behind_value!(HtmlRewriter, { sink_memory_cost(sink) })
            }
            Some(AnyControlledSink::HTTPResponseSink(sink)) => {
                removable_body_behind_value!(Serve, { sink_memory_cost(sink) })
            }
            Some(AnyControlledSink::HTTPSResponseSink(sink)) => {
                removable_body_behind_value!(Serve, { sink_memory_cost(sink) })
            }
            Some(AnyControlledSink::NetworkSink(sink)) => {
                removable_body_behind_value!(S3Client, { sink_memory_cost(sink) })
            }
            Some(AnyControlledSink::FetchRequestBodySink(sink)) => {
                removable_body_behind_value!(Fetch, { sink_memory_cost(sink) })
            }
        }
    }

    /// `None`: the destination went away, so `write()` and `flush()` report 0 bytes and the source can stop.
    fn sink_or_throw(&self, global: &JSGlobalObject) -> JsResult<Option<AnyControlledSink>> {
        if !self.is_detached.get() || self.destination_closed.get() {
            return Ok(self.sink());
        }
        Err(throw_already_closed(
            global,
            match self.sink {
                AnyControlledSink::FileSink(_) => FileSink::NAME,
                AnyControlledSink::RewriterPipe(_) => RewriterPipe::NAME,
                AnyControlledSink::HTTPResponseSink(_) => HTTPResponseSink::NAME,
                AnyControlledSink::HTTPSResponseSink(_) => HTTPSResponseSink::NAME,
                AnyControlledSink::NetworkSink(_) => NetworkSink::NAME,
                AnyControlledSink::FetchRequestBodySink(_) => FetchRequestBodySink::NAME,
            },
        ))
    }

    /// `end()` and `close()` detach before they run any JS: the close handler can re-enter the event loop and free the sink (`handle_resolve_stream`).
    fn take_sink(&self) -> Option<AnyControlledSink> {
        let sink = self.sink()?;
        self.is_detached.set(true);
        let controller = self.this_value();
        match sink {
            AnyControlledSink::FileSink(sink) => controller_detached(sink, controller),
            AnyControlledSink::RewriterPipe(sink) => {
                removable_body_behind_value!(HtmlRewriter, {
                    controller_detached(sink, controller)
                })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body_behind_value!(Serve, { controller_detached(sink, controller) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body_behind_value!(Serve, { controller_detached(sink, controller) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body_behind_value!(S3Client, { controller_detached(sink, controller) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body_behind_value!(Fetch, { controller_detached(sink, controller) })
            }
        }
        Some(sink)
    }

    fn detach_with_reason(&self, global: &JSGlobalObject, reason: Option<JSValue>) -> JsResult<()> {
        let controller = self.this_value();
        if let Some(reason) = reason {
            js::set_fail_reason(controller, reason);
        }
        self.take_sink();
        // A sink whose close re-enters here (FileSink's `on_close` runs inside `close(error)`) detaches before `close` passes the reason, which `failReason` already has.
        let reason = reason
            .or_else(|| js::fail_reason_get_cached(controller))
            .unwrap_or(JSValue::UNDEFINED);
        js::on_close(controller, global, reason, /* sink_closed */ false)
    }

    /// `onClose` closes a direct stream and settles its promise, so it runs even if the sink's own `end` or `close` threw, and the sink's error wins.
    /// A termination from either is returned as it is: nothing is thrown on a VM that is stopping.
    fn detach_and_return<R>(
        &self,
        global: &JSGlobalObject,
        reason: Option<JSValue>,
        result: JsResult<R>,
    ) -> JsResult<R> {
        let Err(error) = result else {
            self.detach_with_reason(global, reason)?;
            return result;
        };
        if global.has_pending_termination_exception() {
            return Err(error);
        }
        let exception = global.take_exception(error);
        if let Err(error) = self.detach_with_reason(global, reason)
            && (matches!(error, JsError::Terminated)
                || !global.clear_exception_except_termination())
        {
            return Err(error);
        }
        Err(global.throw_value(exception))
    }

    pub(crate) fn is_detached(&self) -> bool {
        self.is_detached.get()
    }

    /// `error` is `None` for a clean close, else why the source failed.
    pub(crate) fn close<'a>(
        &self,
        cx: &mut JsScope<'a>,
        error: Option<JsLocal<'a>>,
    ) -> JsResult<()> {
        let Some(sink) = self.take_sink() else {
            return Ok(());
        };
        let global = cx.global();
        let reason = error.map(JsLocal::to_js);
        let result = match sink {
            AnyControlledSink::FileSink(sink) => close_sink(sink, global, reason),
            AnyControlledSink::RewriterPipe(sink) => {
                removable_body_behind_value!(HtmlRewriter, { close_sink(sink, global, reason) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body_behind_value!(Serve, { close_sink(sink, global, reason) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body_behind_value!(Serve, { close_sink(sink, global, reason) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body_behind_value!(S3Client, { close_sink(sink, global, reason) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body_behind_value!(Fetch, { close_sink(sink, global, reason) })
            }
        };
        self.detach_and_return(global, reason, result)
    }

    pub(crate) fn close_with_error<'a>(
        &self,
        cx: &mut JsScope<'a>,
        error: JsLocal<'a>,
    ) -> JsResult<()> {
        self.close(cx, Some(error))
    }

    pub(crate) fn flush(&self, cx: &mut JsScope<'_>, wait: Option<bool>) -> JsResult<JSValue> {
        let Some(sink) = self.sink_or_throw(cx.global())? else {
            return Ok(JSValue::js_number(0.0));
        };
        let cx = &cx.js_thread();
        match sink {
            AnyControlledSink::FileSink(sink) => flush_sink(sink, cx, wait),
            AnyControlledSink::RewriterPipe(sink) => {
                removable_body_behind_value!(HtmlRewriter, { flush_sink(sink, cx, wait) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body_behind_value!(Serve, { flush_sink(sink, cx, wait) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body_behind_value!(Serve, { flush_sink(sink, cx, wait) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body_behind_value!(S3Client, { flush_sink(sink, cx, wait) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body_behind_value!(Fetch, { flush_sink(sink, cx, wait) })
            }
        }
    }

    pub(crate) fn end(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(sink) = self.take_sink() else {
            return Ok(JSValue::UNDEFINED);
        };
        let cx = &cx.js_thread();
        let result = match sink {
            AnyControlledSink::FileSink(sink) => end_sink(sink, cx),
            AnyControlledSink::RewriterPipe(sink) => {
                removable_body_behind_value!(HtmlRewriter, { end_sink(sink, cx) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body_behind_value!(Serve, { end_sink(sink, cx) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body_behind_value!(Serve, { end_sink(sink, cx) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body_behind_value!(S3Client, { end_sink(sink, cx) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body_behind_value!(Fetch, { end_sink(sink, cx) })
            }
        };
        self.detach_and_return(cx.global(), None, result)
    }

    pub(crate) fn start(
        &self,
        cx: &mut JsScope<'_>,
        options: &ReadableSinkControllerStartOptions<'_>,
    ) -> JsResult<()> {
        let Some(sink) = self.sink_or_throw(cx.global())? else {
            return Ok(());
        };
        let cx = &cx.js_thread();
        let chunk_size = streams::Start::chunk_size(options.high_water_mark);
        match sink {
            AnyControlledSink::FileSink(sink) => {
                let config = streams::Start::file_sink(&options.path, options.fd);
                start_sink(sink, cx, config)
            }
            AnyControlledSink::RewriterPipe(sink) => {
                removable_body_behind_value!(HtmlRewriter, { start_sink(sink, cx, chunk_size) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body_behind_value!(Serve, { start_sink(sink, cx, chunk_size) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body_behind_value!(Serve, { start_sink(sink, cx, chunk_size) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body_behind_value!(S3Client, { start_sink(sink, cx, chunk_size) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body_behind_value!(Fetch, { start_sink(sink, cx, chunk_size) })
            }
        }
    }

    pub(crate) fn start_with_high_water_mark(
        &self,
        cx: &mut JsScope<'_>,
        high_water_mark: f64,
    ) -> JsResult<()> {
        let options = ReadableSinkControllerStartOptions {
            high_water_mark: Some(high_water_mark),
            ..Default::default()
        };
        self.start(cx, &options)
    }

    pub(crate) fn write<'a>(&self, cx: &mut JsScope<'a>, data: SinkChunk<'a>) -> JsResult<JSValue> {
        let Some(sink) = self.sink_or_throw(cx.global())? else {
            return Ok(JSValue::js_number(0.0));
        };
        match sink {
            AnyControlledSink::FileSink(sink) => write_chunk(sink, cx, data),
            AnyControlledSink::RewriterPipe(sink) => {
                removable_body_behind_value!(HtmlRewriter, { write_chunk(sink, cx, data) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body_behind_value!(Serve, { write_chunk(sink, cx, data) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body_behind_value!(Serve, { write_chunk(sink, cx, data) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body_behind_value!(S3Client, { write_chunk(sink, cx, data) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body_behind_value!(Fetch, { write_chunk(sink, cx, data) })
            }
        }
    }

    /// `write` of bytes that are not in a JS object.
    pub(crate) fn write_bytes(&self, cx: &mut JsScope<'_>, bytes: &[u8]) -> JsResult<JSValue> {
        let Some(sink) = self.sink_or_throw(cx.global())? else {
            return Ok(JSValue::js_number(0.0));
        };
        if bytes.is_empty() {
            return Ok(JSValue::js_number(0.0));
        }
        // SAFETY: the controller is attached, so the sink is live.
        let written = unsafe { sink.to_sink_handle() }.write(&Temporary(bytes));
        Ok(written.to_js(&cx.js_thread()))
    }

    /// 2 and 6 must match `sinkPrototype(..)` in `Sink.bind.ts`.
    pub(crate) fn get_sink_id(&self) -> u8 {
        match self.sink {
            AnyControlledSink::FileSink(_) => 2,
            AnyControlledSink::RewriterPipe(_) => 3,
            AnyControlledSink::HTTPResponseSink(_) => 4,
            AnyControlledSink::HTTPSResponseSink(_) => 5,
            AnyControlledSink::NetworkSink(_) => 6,
            AnyControlledSink::FetchRequestBodySink(_) => 7,
        }
    }
}

/// Start the pump from `stream` into `controller`, whose sink is live and
/// already holds it as its `source()`. Out of line so the
/// `assign_controller_to_stream` instantiations share one copy.
#[inline(never)]
fn start_pump(global: &JSGlobalObject, stream: JSValue, controller: JSValue) -> JSValue {
    let result = js::assign_to_stream(controller, global, stream);
    // Setup threw (e.g. a direct stream's `pull` getter): nothing will ever
    // end()/close() the controller, and its `Drop` would otherwise finalize
    // the sink after its owner has freed it. Detach it while the sink is live.
    if result.to_error().is_some() {
        crate::dispatch::fold(ReadableSinkController::detach(controller, global));
    }
    result
}

impl Drop for ReadableSinkController {
    fn drop(&mut self) {
        let Some(sink) = self.take_sink() else { return };
        // SAFETY: the sink was attached, so it is live, and nothing uses it after this.
        unsafe {
            match sink {
                AnyControlledSink::FileSink(sink) => controller_finalize(sink),
                AnyControlledSink::RewriterPipe(sink) => controller_finalize(sink),
                AnyControlledSink::HTTPResponseSink(sink) => {
                    removable_body_behind_value!(Serve, { controller_finalize(sink) })
                }
                AnyControlledSink::HTTPSResponseSink(sink) => {
                    removable_body_behind_value!(Serve, { controller_finalize(sink) })
                }
                AnyControlledSink::NetworkSink(sink) => {
                    removable_body_behind_value!(S3Client, { controller_finalize(sink) })
                }
                AnyControlledSink::FetchRequestBodySink(sink) => {
                    removable_body_behind_value!(Fetch, { controller_finalize(sink) })
                }
            }
        }
    }
}
