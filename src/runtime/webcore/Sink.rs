use core::cell::Cell;
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
    ErrorCode, JSGlobalObject, JSValue, JsClass, JsError, JsResult, JsThread, SysErrorJsc as _,
};
use bun_ptr::{BackRef, RawSlice};
use bun_sys::{self as sys, Error as SysError};

pub(crate) use crate::webcore::array_buffer_sink::ArrayBufferSink;

/// Emits the `JsSinkType` items that every sink forwards 1:1 to an inherent
/// method of the same name (`memory_cost`, `write_bytes` -> `write`,
/// `write_utf16`, `write_latin1`, `end`, `flush_from_js`, `start`).
/// Invoke inside the `impl JsSinkType for T` block; `Self::name` resolves to
/// the inherent method ahead of the trait item being defined, so the forward
/// does not recurse. Items whose bodies differ per sink (`finalize`,
/// `end_from_js`, `source`) stay hand-written.
#[macro_export]
macro_rules! impl_js_sink_forwarders {
    // `start` also wants the context of the script that starts the sink.
    (start_takes_context) => {
        $crate::impl_js_sink_forwarders!(@common);
        fn start(
            &mut self,
            config: $crate::webcore::streams::Start,
            context: &::bun_jsc::ScriptExecutionContext,
        ) -> ::bun_sys::Result<()> {
            Self::start(self, &config, context)
        }
    };
    () => {
        $crate::impl_js_sink_forwarders!(@common);
        fn start(
            &mut self,
            config: $crate::webcore::streams::Start,
            _context: &::bun_jsc::ScriptExecutionContext,
        ) -> ::bun_sys::Result<()> {
            Self::start(self, &config)
        }
    };
    (@common) => {
        fn memory_cost(&self) -> usize {
            Self::memory_cost(self)
        }
        fn write_bytes(
            &mut self,
            data: &$crate::webcore::streams::Result,
        ) -> $crate::webcore::streams::result::Writable {
            Self::write(self, data)
        }
        fn write_utf16(
            &mut self,
            data: &$crate::webcore::streams::Result,
        ) -> $crate::webcore::streams::result::Writable {
            Self::write_utf16(self, data)
        }
        fn write_latin1(
            &mut self,
            data: &$crate::webcore::streams::Result,
        ) -> $crate::webcore::streams::result::Writable {
            Self::write_latin1(self, data)
        }
        fn end(&mut self, err: ::core::option::Option<::bun_sys::Error>) -> ::bun_sys::Result<()> {
            Self::end(self, err)
        }
        fn flush_from_js(
            &mut self,
            cx: &::bun_jsc::JsThread<'_>,
            wait: bool,
        ) -> ::bun_sys::Result<::bun_jsc::JSValue> {
            Self::flush_from_js(self, cx, wait)
        }
    };
}

/// What [`JSSink`] and [`ReadableSinkController`] call on a sink.
pub(crate) trait JsSinkType: Sized + 'static {
    const NAME: &'static str;

    fn memory_cost(&self) -> usize;
    /// The JS object that holds `this` is giving up its claim on the sink. Raw
    /// pointer, not `&mut self`: for `ArrayBufferSink`, `FileSink` and
    /// `FetchRequestBodySink` that releases the allocation, and freeing under a
    /// live reference argument is UB.
    ///
    /// # Safety
    /// `this` is the object's live sink and must not be used after the call.
    unsafe fn finalize(this: *mut Self);
    fn write_bytes(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn end(&mut self, err: Option<SysError>) -> sys::Result<()>;
    fn end_from_js(&mut self, cx: &JsThread<'_>) -> sys::Result<JSValue>;
    fn flush_from_js(&mut self, cx: &JsThread<'_>, wait: bool) -> sys::Result<JSValue>;
    fn start(
        &mut self,
        config: streams::Start,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> sys::Result<()>;
    fn pending_state_is_pending(&self) -> bool {
        false
    }
    fn protect_js_wrapper(&mut self, _global: &JSGlobalObject, _this_value: JSValue) {}
    fn update_ref(&mut self, _value: bool) {}
    fn get_fd(&self) -> Option<i32> {
        None
    }
}

/// A sink that a stream writes to through a [`ReadableSinkController`].
pub(crate) trait ControlledSink: JsSinkType {
    fn controller_sink(this: NonNull<Self>) -> ControllerSink;

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
        // SAFETY: caller contract; `end` does not free the sink.
        unsafe { (*this).end(None) }
    }

    fn source(&mut self) -> &mut SourceHandle;
}

// ──────────────────────────────────────────────────────────────────────────
// What a sink's JS object and a controller both do
//
// `sink` is live, and host functions are synchronous on one thread, so the
// `&mut T` each of these forms is the only one for as long as it lasts.
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
    let sink = unsafe { &mut *sink.as_ptr() };
    // The chunk's argument slot holds the bytes for the call, and the sink copies what it keeps.
    let written = match chunk {
        SinkChunk::Bytes(buffer) => buffer.with_bytes(&cx.heap, |bytes| {
            (!bytes.is_empty()).then(|| sink.write_bytes(&Temporary(RawSlice::new(bytes))))
        }),
        SinkChunk::Text(text) if text.is_empty() => None,
        SinkChunk::Text(text) if text.is_utf16() => Some(sink.write_utf16(&Temporary(
            RawSlice::new(bytemuck::cast_slice(text.utf16())),
        ))),
        SinkChunk::Text(text) => Some(sink.write_latin1(&Temporary(RawSlice::new(text.latin1())))),
        SinkChunk::Other(value) => return Err(throw_invalid_chunk(cx.global(), value.to_js())),
    };
    Ok(match written {
        Some(written) => written.to_js(&cx.js_thread()),
        None => JSValue::js_number(0.0),
    })
}

fn flush_sink<T: JsSinkType>(
    sink: NonNull<T>,
    cx: &JsThread<'_>,
    wait: Option<bool>,
) -> JsResult<JSValue> {
    // SAFETY: see the section comment.
    unsafe { &mut *sink.as_ptr() }
        .flush_from_js(cx, wait == Some(true))
        .map_err(|error| error.throw(cx.global()))
}

fn start_sink<T: JsSinkType>(
    sink: NonNull<T>,
    cx: &JsThread<'_>,
    config: streams::Start,
) -> JsResult<()> {
    // SAFETY: see the section comment.
    unsafe { &mut *sink.as_ptr() }
        .start(config, cx.context())
        .map_err(|error| error.throw(cx.global()))
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
    let result = unsafe { &mut *sink.as_ptr() }.end_from_js(cx);
    pending_exception_or(cx.global(), result)
}

/// `reason` is `None` for a clean close.
fn close_sink<T: ControlledSink>(
    sink: NonNull<T>,
    global: &JSGlobalObject,
    reason: Option<JSValue>,
) -> JsResult<()> {
    let sink = sink.as_ptr();
    let result = match reason {
        // SAFETY: see the section comment; `end` does not free the sink.
        None => unsafe { (*sink).end(None) },
        // SAFETY: see the section comment.
        Some(reason) => unsafe { T::close_with_error(sink, global, reason) },
    };
    pending_exception_or(global, result)
}

/// # Safety
/// As [`JsSinkType::finalize`].
unsafe fn finalize_sink<T: JsSinkType>(sink: NonNull<T>) {
    // SAFETY: the caller's contract is the same one.
    unsafe { T::finalize(sink.as_ptr()) }
}

fn sink_memory_cost<T: JsSinkType>(sink: NonNull<T>) -> usize {
    // SAFETY: see the section comment.
    size_of::<T>() + unsafe { sink.as_ref() }.memory_cost()
}

// ──────────────────────────────────────────────────────────────────────────
// JSSink
// ──────────────────────────────────────────────────────────────────────────

/// What the JS object of an `ArrayBufferSink`, a `FileSink` or a `NetworkSink` holds.
pub(crate) struct JSSink<T: JsSinkType> {
    /// `None` once `close()` gave up the object's claim on the sink.
    sink: Cell<Option<NonNull<T>>>,
    ref_count: Cell<i32>,
    /// Hears that its stdin is gone when the object closes or is collected.
    subprocess: Cell<Option<NonNull<Subprocess<'static>>>>,
}

impl<T: JsSinkType> JSSink<T> {
    fn new(sink: NonNull<T>, subprocess: Option<NonNull<Subprocess<'static>>>) -> Self {
        Self {
            sink: Cell::new(Some(sink)),
            ref_count: Cell::new(1),
            subprocess: Cell::new(subprocess),
        }
    }

    fn open_sink(&self, global: &JSGlobalObject) -> JsResult<NonNull<T>> {
        self.sink
            .get()
            .ok_or_else(|| throw_already_closed(global, T::NAME))
    }

    fn notify_subprocess(&self) {
        if let Some(subprocess) = self.subprocess.take() {
            // SAFETY: the `Subprocess` clears this with `forget_subprocess` before it is freed.
            unsafe { subprocess.as_ref() }.on_stdin_destroyed();
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.sink.get().map_or(0, sink_memory_cost)
    }

    pub(crate) fn close(&self, cx: &mut JsScope<'_>) -> JsResult<()> {
        let Some(sink) = self.sink.take() else {
            return Ok(());
        };
        // SAFETY: the object's live sink.
        let result = pending_exception_or(cx.global(), unsafe { &mut *sink.as_ptr() }.end(None));
        // The sink is taken, so `Drop` will not do these. They happen even if the close threw.
        self.notify_subprocess();
        // SAFETY: `end` does not free the sink, and nothing uses it after this.
        unsafe { T::finalize(sink.as_ptr()) };
        result
    }

    pub(crate) fn flush(&self, cx: &mut JsScope<'_>, wait: Option<bool>) -> JsResult<JSValue> {
        flush_sink(self.open_sink(cx.global())?, &cx.js_thread(), wait)
    }

    pub(crate) fn end<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<JSValue> {
        // SAFETY: the object's live sink, which `end_from_js` does not free.
        let sink = unsafe { &mut *self.open_sink(cx.global())?.as_ptr() };
        let result = sink
            .end_from_js(&cx.js_thread())
            .map_err(|error| error.throw(cx.global()));
        // The object stays attached and alive so that the pending write can resolve its promise.
        if sink.pending_state_is_pending() {
            sink.protect_js_wrapper(cx.global(), this_value.to_js());
        }
        result
    }

    fn start_with_config(&self, cx: &mut JsScope<'_>, config: streams::Start) -> JsResult<()> {
        start_sink(self.open_sink(cx.global())?, &cx.js_thread(), config)
    }

    pub(crate) fn write<'a>(
        &self,
        cx: &mut JsScope<'a>,
        chunk: SinkChunk<'a>,
    ) -> JsResult<JSValue> {
        write_chunk(self.open_sink(cx.global())?, cx, chunk)
    }

    pub(crate) fn r#ref(&self) {
        let Some(sink) = self.sink.get() else { return };
        self.ref_count.set(self.ref_count.get() + 1);
        if self.ref_count.get() == 1 {
            // SAFETY: the object's live sink.
            unsafe { &mut *sink.as_ptr() }.update_ref(true);
        }
    }

    pub(crate) fn unref(&self) {
        let Some(sink) = self.sink.get() else { return };
        self.ref_count.set((self.ref_count.get() - 1).max(0));
        if self.ref_count.get() == 0 {
            // SAFETY: the object's live sink.
            unsafe { &mut *sink.as_ptr() }.update_ref(false);
        }
    }

    pub(crate) fn get_fd(&self) -> SinkFd {
        match self.sink.get() {
            None => SinkFd::Closed,
            // SAFETY: the object's live sink.
            Some(sink) => unsafe { sink.as_ref() }
                .get_fd()
                .map_or(SinkFd::None, SinkFd::Fd),
        }
    }
}

impl<T: JsSinkType> JSSink<T>
where
    Self: JsClass,
{
    /// A new JS object, which takes over one claim on `sink`.
    pub(crate) fn create_object(
        global: &JSGlobalObject,
        sink: &mut T,
        subprocess: Option<NonNull<Subprocess<'static>>>,
    ) -> JSValue {
        Self::new(NonNull::from(sink), subprocess).to_js(global)
    }

    /// The sink of `value`, unless that is not such an object or it is closed.
    pub(crate) fn sink_from_js(value: JSValue) -> Option<NonNull<T>> {
        value.as_class_ref::<Self>()?.sink.get()
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
        Self::new(bun_core::heap::alloc_nn(ArrayBufferSink::default()), None)
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

impl<T: JsSinkType> Drop for JSSink<T> {
    fn drop(&mut self) {
        self.notify_subprocess();
        if let Some(sink) = self.sink.take() {
            // SAFETY: the object's live sink, which nothing uses after this.
            unsafe { T::finalize(sink.as_ptr()) };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadableSinkController
// ──────────────────────────────────────────────────────────────────────────

/// The sink of a [`ReadableSinkController`].
#[derive(Copy, Clone)]
pub(crate) enum ControllerSink {
    File(NonNull<FileSink>),
    HTMLRewriter(NonNull<RewriterPipe>),
    HTTPResponse(NonNull<HTTPResponseSink>),
    HTTPSResponse(NonNull<HTTPSResponseSink>),
    Network(NonNull<NetworkSink>),
    FetchRequestBody(NonNull<FetchRequestBodySink>),
}

impl ControllerSink {
    /// # Safety
    /// The sink is live, and nothing else borrows it.
    unsafe fn source<'a>(self) -> &'a mut SourceHandle {
        // SAFETY: caller contract.
        unsafe {
            match self {
                Self::File(sink) => (*sink.as_ptr()).source(),
                Self::HTMLRewriter(sink) => (*sink.as_ptr()).source(),
                Self::HTTPResponse(sink) => (*sink.as_ptr()).source(),
                Self::HTTPSResponse(sink) => (*sink.as_ptr()).source(),
                Self::Network(sink) => (*sink.as_ptr()).source(),
                Self::FetchRequestBody(sink) => (*sink.as_ptr()).source(),
            }
        }
    }
}

/// Writes to a native sink on behalf of a stream: it is the `controller` of a
/// `type: "direct"` stream, and what the pump of any other stream writes to.
///
/// The bindgen calls what takes `&self`. A sink holds the JS object, as its
/// `source()` or in its `PipeCell`, and calls what takes `controller`.
pub(crate) struct ReadableSinkController {
    /// Dangles once detached, which comes before the sink is freed.
    sink: ControllerSink,
    is_attached: Cell<bool>,
    /// The destination went away (peer abort, write error) before the source closed the controller.
    destination_closed: Cell<bool>,
}

impl ReadableSinkController {
    /// A new controller attached to `sink`.
    pub(crate) fn create<T: ControlledSink>(global: &JSGlobalObject, sink: NonNull<T>) -> JSValue {
        Self {
            sink: T::controller_sink(sink),
            is_attached: Cell::new(true),
            destination_closed: Cell::new(false),
        }
        .to_js(global)
    }

    /// [`assign_controller_to_stream`](Self::assign_controller_to_stream) with a new controller.
    pub(crate) fn assign_to_stream<T: ControlledSink>(
        global: &JSGlobalObject,
        stream: JSValue,
        sink: NonNull<T>,
    ) -> JSValue {
        Self::assign_controller_to_stream(Self::create(global, sink), global, stream)
    }

    /// Pumps `stream` into the sink. Returns `undefined` (drained already), the pump's promise, or what it threw as an `Exception`.
    pub(crate) fn assign_controller_to_stream(
        controller: JSValue,
        global: &JSGlobalObject,
        stream: JSValue,
    ) -> JSValue {
        // Before the pump starts: it drains what the stream already holds, user code included, and a sink that fails in there detaches its `source()`.
        // SAFETY: the caller owns the live sink for this synchronous call.
        *unsafe { Self::from_controller(controller).sink.source() } =
            SourceHandle::JSController(controller);
        let result = js::assign_to_stream(controller, stream);
        // Nothing will `end()` or `close()` the controller, and `Drop` would finalize a sink that its owner has freed.
        if result.to_error().is_some() {
            crate::dispatch::fold(Self::detach(controller, global));
        }
        result
    }

    fn from_controller(controller: JSValue) -> &'static Self {
        controller.as_class_ref().expect("a ReadableSinkController")
    }

    pub(crate) fn detach(controller: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        Self::from_controller(controller).detach_with_reason(global, None)
    }

    /// The sink closed underneath its source.
    pub(crate) fn on_close(
        controller: JSValue,
        global: &JSGlobalObject,
        reason: JSValue,
    ) -> JsResult<()> {
        Self::from_controller(controller)
            .destination_closed
            .set(true);
        js::on_close(controller, global, reason, true)
    }

    /// The sink can take more.
    pub(crate) fn on_ready(controller: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        js::on_ready(controller, global)
    }

    /// The first reason stays.
    pub(crate) fn set_fail_reason(controller: JSValue, global: &JSGlobalObject, reason: JSValue) {
        if js::fail_reason_get_cached(controller).is_none() {
            js::fail_reason_set_cached(controller, global, reason);
        }
    }

    /// The JS object that holds `self`. In `Drop` it is dead, and only compared.
    fn this_value(&self) -> JSValue {
        // SAFETY: `create` is the only constructor, and it gives the controller to its JS object.
        unsafe { self.wrapper_value() }
    }

    fn sink(&self) -> Option<ControllerSink> {
        self.is_attached.get().then_some(self.sink)
    }

    /// For a native transform, which writes to the sink without the controller's methods.
    pub(crate) fn handle(&self) -> SinkHandle {
        let Some(sink) = self.sink() else {
            return SinkHandle::None;
        };
        // SAFETY: the sink is live for as long as the controller is attached.
        unsafe {
            match sink {
                ControllerSink::File(sink) => {
                    SinkHandle::FileSink(BackRef::from_raw(sink.as_ptr()))
                }
                ControllerSink::HTMLRewriter(sink) => {
                    SinkHandle::HTMLRewriter(BackRef::from_raw(sink.as_ptr()))
                }
                ControllerSink::HTTPResponse(sink) => {
                    SinkHandle::HttpResponse(BackRef::from_raw_mut(sink.as_ptr()))
                }
                ControllerSink::HTTPSResponse(sink) => {
                    SinkHandle::HttpsResponse(BackRef::from_raw_mut(sink.as_ptr()))
                }
                ControllerSink::Network(sink) => {
                    SinkHandle::S3Upload(BackRef::from_raw_mut(sink.as_ptr()))
                }
                ControllerSink::FetchRequestBody(sink) => {
                    SinkHandle::FetchRequestBody(BackRef::from_raw_mut(sink.as_ptr()))
                }
            }
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        match self.sink() {
            None => 0,
            Some(ControllerSink::File(sink)) => sink_memory_cost(sink),
            Some(ControllerSink::HTMLRewriter(sink)) => sink_memory_cost(sink),
            Some(ControllerSink::HTTPResponse(sink)) => sink_memory_cost(sink),
            Some(ControllerSink::HTTPSResponse(sink)) => sink_memory_cost(sink),
            Some(ControllerSink::Network(sink)) => sink_memory_cost(sink),
            Some(ControllerSink::FetchRequestBody(sink)) => sink_memory_cost(sink),
        }
    }

    /// `None`: the destination went away, so `write()` and `flush()` report 0 bytes and the source can stop.
    fn sink_unless_closed(&self, global: &JSGlobalObject) -> JsResult<Option<ControllerSink>> {
        if self.is_attached.get() || self.destination_closed.get() {
            return Ok(self.sink());
        }
        Err(throw_already_closed(
            global,
            match self.sink {
                ControllerSink::File(_) => FileSink::NAME,
                ControllerSink::HTMLRewriter(_) => RewriterPipe::NAME,
                ControllerSink::HTTPResponse(_) => HTTPResponseSink::NAME,
                ControllerSink::HTTPSResponse(_) => HTTPSResponseSink::NAME,
                ControllerSink::Network(_) => NetworkSink::NAME,
                ControllerSink::FetchRequestBody(_) => FetchRequestBodySink::NAME,
            },
        ))
    }

    /// `end()` and `close()` detach before they run any JS: the close handler can re-enter the event loop and free the sink (`handle_resolve_stream` -> `destroy_sink`).
    fn take_sink(&self) -> Option<ControllerSink> {
        let sink = self.sink()?;
        self.is_attached.set(false);
        // `SourceHandle::JSController` does not root the controller, so from here on it must not fire. A sink that was assigned to another stream since holds the newer controller.
        // SAFETY: the sink was attached, so it is live.
        let source = unsafe { sink.source() };
        if matches!(*source, SourceHandle::JSController(held) if held == self.this_value()) {
            source.clear();
        }
        if let ControllerSink::HTMLRewriter(pipe) = sink {
            // SAFETY: as above.
            unsafe { pipe.as_ref() }.release_pump_ref();
        }
        Some(sink)
    }

    fn detach_with_reason(&self, global: &JSGlobalObject, reason: Option<JSValue>) -> JsResult<()> {
        let controller = self.this_value();
        if let Some(reason) = reason {
            Self::set_fail_reason(controller, global, reason);
        }
        self.take_sink();
        // A sink whose close re-enters here (FileSink's `on_close` runs inside `close(error)`) detaches before `close` passes the reason, which `failReason` already has.
        let reason = reason
            .or_else(|| js::fail_reason_get_cached(controller))
            .unwrap_or(JSValue::UNDEFINED);
        js::on_close(controller, global, reason, false)
    }

    /// `onClose` closes a direct stream and settles its promise, so it runs even if the sink's own `end` or `close` threw, and the sink's error wins.
    fn detach_after<R>(
        &self,
        global: &JSGlobalObject,
        reason: Option<JSValue>,
        result: JsResult<R>,
    ) -> JsResult<R> {
        let error = match result {
            Ok(value) => return self.detach_with_reason(global, reason).map(|()| value),
            Err(error) => error,
        };
        if matches!(error, JsError::Terminated) || global.has_pending_termination_exception() {
            return Err(error);
        }
        let exception = global.take_exception(error);
        if let Err(error) = self.detach_with_reason(global, reason) {
            if matches!(error, JsError::Terminated) || !global.clear_exception_except_termination()
            {
                return Err(error);
            }
        }
        Err(global.throw_value(exception))
    }

    pub(crate) fn is_attached(&self) -> bool {
        self.is_attached.get()
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
            ControllerSink::File(sink) => close_sink(sink, global, reason),
            ControllerSink::HTMLRewriter(sink) => close_sink(sink, global, reason),
            ControllerSink::HTTPResponse(sink) => close_sink(sink, global, reason),
            ControllerSink::HTTPSResponse(sink) => close_sink(sink, global, reason),
            ControllerSink::Network(sink) => close_sink(sink, global, reason),
            ControllerSink::FetchRequestBody(sink) => close_sink(sink, global, reason),
        };
        self.detach_after(global, reason, result)
    }

    pub(crate) fn flush(&self, cx: &mut JsScope<'_>, wait: Option<bool>) -> JsResult<JSValue> {
        let Some(sink) = self.sink_unless_closed(cx.global())? else {
            return Ok(JSValue::js_number(0.0));
        };
        let cx = &cx.js_thread();
        match sink {
            ControllerSink::File(sink) => flush_sink(sink, cx, wait),
            ControllerSink::HTMLRewriter(sink) => flush_sink(sink, cx, wait),
            ControllerSink::HTTPResponse(sink) => flush_sink(sink, cx, wait),
            ControllerSink::HTTPSResponse(sink) => flush_sink(sink, cx, wait),
            ControllerSink::Network(sink) => flush_sink(sink, cx, wait),
            ControllerSink::FetchRequestBody(sink) => flush_sink(sink, cx, wait),
        }
    }

    pub(crate) fn end(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(sink) = self.take_sink() else {
            return Ok(JSValue::UNDEFINED);
        };
        let cx = &cx.js_thread();
        let result = match sink {
            ControllerSink::File(sink) => end_sink(sink, cx),
            ControllerSink::HTMLRewriter(sink) => end_sink(sink, cx),
            ControllerSink::HTTPResponse(sink) => end_sink(sink, cx),
            ControllerSink::HTTPSResponse(sink) => end_sink(sink, cx),
            ControllerSink::Network(sink) => end_sink(sink, cx),
            ControllerSink::FetchRequestBody(sink) => end_sink(sink, cx),
        };
        self.detach_after(cx.global(), None, result)
    }

    pub(crate) fn start(
        &self,
        cx: &mut JsScope<'_>,
        options: &ReadableSinkControllerStartOptions<'_>,
    ) -> JsResult<()> {
        let Some(sink) = self.sink_unless_closed(cx.global())? else {
            return Ok(());
        };
        let cx = &cx.js_thread();
        let chunk_size = streams::Start::chunk_size(options.high_water_mark);
        match sink {
            ControllerSink::File(sink) => {
                let config = streams::Start::file_sink(&options.path, options.fd);
                start_sink(sink, cx, config)
            }
            ControllerSink::HTMLRewriter(sink) => start_sink(sink, cx, chunk_size),
            ControllerSink::HTTPResponse(sink) => start_sink(sink, cx, chunk_size),
            ControllerSink::HTTPSResponse(sink) => start_sink(sink, cx, chunk_size),
            ControllerSink::Network(sink) => start_sink(sink, cx, chunk_size),
            ControllerSink::FetchRequestBody(sink) => start_sink(sink, cx, chunk_size),
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
        let Some(sink) = self.sink_unless_closed(cx.global())? else {
            return Ok(JSValue::js_number(0.0));
        };
        match sink {
            ControllerSink::File(sink) => write_chunk(sink, cx, data),
            ControllerSink::HTMLRewriter(sink) => write_chunk(sink, cx, data),
            ControllerSink::HTTPResponse(sink) => write_chunk(sink, cx, data),
            ControllerSink::HTTPSResponse(sink) => write_chunk(sink, cx, data),
            ControllerSink::Network(sink) => write_chunk(sink, cx, data),
            ControllerSink::FetchRequestBody(sink) => write_chunk(sink, cx, data),
        }
    }

    /// `write` of bytes that are not in a JS object.
    pub(crate) fn write_bytes(&self, cx: &mut JsScope<'_>, bytes: &[u8]) -> JsResult<JSValue> {
        if self.sink_unless_closed(cx.global())?.is_none() || bytes.is_empty() {
            return Ok(JSValue::js_number(0.0));
        }
        let written = self.handle().write(&Temporary(RawSlice::new(bytes)));
        Ok(written.to_js(&cx.js_thread()))
    }

    /// The `sinkId` of a `FileSink` and a `NetworkSink` in `Sink.bind.ts` are these.
    pub(crate) fn get_sink_id(&self) -> u8 {
        match self.sink {
            ControllerSink::File(_) => 2,
            ControllerSink::HTMLRewriter(_) => 3,
            ControllerSink::HTTPResponse(_) => 4,
            ControllerSink::HTTPSResponse(_) => 5,
            ControllerSink::Network(_) => 6,
            ControllerSink::FetchRequestBody(_) => 7,
        }
    }
}

impl Drop for ReadableSinkController {
    fn drop(&mut self) {
        let Some(sink) = self.take_sink() else { return };
        // SAFETY: the sink was attached, so it is live, and nothing uses it after this.
        unsafe {
            match sink {
                // Its controller holds no claim on it.
                ControllerSink::File(sink) => FileSink::controller_finalize(sink.as_ptr()),
                ControllerSink::HTMLRewriter(sink) => finalize_sink(sink),
                ControllerSink::HTTPResponse(sink) => finalize_sink(sink),
                ControllerSink::HTTPSResponse(sink) => finalize_sink(sink),
                ControllerSink::Network(sink) => finalize_sink(sink),
                ControllerSink::FetchRequestBody(sink) => finalize_sink(sink),
            }
        }
    }
}
