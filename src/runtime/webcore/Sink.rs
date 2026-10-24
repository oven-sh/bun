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
use bun_removable_features::removable_body;
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
    fn to_any_sink(this: NonNull<Self>) -> AnyControlledSink;

    /// `assign_to_stream` made `controller` for this sink: a sink that keeps JS values roots it and puts them on it.
    fn controller_created(&mut self, _controller: JSValue, _global: &JSGlobalObject) {}

    /// Once per controller, on every detach path including its `Drop`. A sink
    /// co-owned by another GC cell releases the controller's claim here (sweep
    /// order between the two cells is unspecified, so neither destructor alone
    /// may free it). Never free the allocation inline: the caller holds
    /// `&mut Self` and the controller keeps using the sink in the same frame;
    /// defer a last-owner free to the event loop.
    fn controller_detached(&mut self) {}

    /// A controller died still attached to `this`, right after
    /// [`controller_detached`](Self::controller_detached). The default gives up
    /// the claim like any other cell; a sink whose controller holds no claim overrides it.
    ///
    /// # Safety
    /// As [`finalize`](JsSinkType::finalize).
    unsafe fn controller_finalize(this: *mut Self) {
        // SAFETY: the caller's contract is the same one.
        unsafe { Self::finalize(this) }
    }

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
            if bytes.is_empty() {
                return streams::Writable::Owned(0);
            }
            sink.write_bytes(&Temporary(RawSlice::new(bytes)))
        }),
        SinkChunk::Text(text) if text.is_empty() => return Ok(JSValue::js_number(0.0)),
        SinkChunk::Text(text) if text.is_utf16() => sink.write_utf16(&Temporary(RawSlice::new(
            bytemuck::cast_slice(text.utf16()),
        ))),
        SinkChunk::Text(text) => sink.write_latin1(&Temporary(RawSlice::new(text.latin1()))),
        SinkChunk::Other(value) => return Err(throw_invalid_chunk(cx.global(), value.to_js())),
    };
    Ok(written.to_js(&cx.js_thread()))
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

/// `SourceHandle::JSController` does not root the controller, so once it detaches the source must not fire. A sink that was assigned to another stream since holds the newer controller.
fn controller_detached<T: ControlledSink>(sink: NonNull<T>, controller: JSValue) {
    // SAFETY: see the section comment.
    let sink = unsafe { &mut *sink.as_ptr() };
    let source = sink.source();
    if matches!(*source, SourceHandle::JSController(held) if held == controller) {
        source.clear();
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
pub(crate) struct JSSink<T: JsSinkType> {
    /// `None` once `close()` gave up the object's claim on the sink.
    sink: Cell<Option<NonNull<T>>>,
    ref_count: Cell<i32>,
    /// Notified that its stdin is gone when the object closes or is collected.
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

    fn sink_or_throw(&self, global: &JSGlobalObject) -> JsResult<NonNull<T>> {
        self.sink
            .get()
            .ok_or_else(|| throw_already_closed(global, T::NAME))
    }

    fn notify_subprocess(&self) {
        if let Some(subprocess) = self.subprocess.take() {
            removable_body!(Spawn, Abort, {
                // SAFETY: the `Subprocess` clears this with `forget_subprocess` before it is freed.
                unsafe { subprocess.as_ref() }.on_stdin_destroyed();
            });
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
        // The sink is taken, so `Drop` will not do these: the subprocess first, so that it clears
        // its weak back-pointer, then `finalize`. They happen even if the close threw.
        self.notify_subprocess();
        // SAFETY: `end` does not free the sink, and nothing uses it after this.
        unsafe { T::finalize(sink.as_ptr()) };
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
        // SAFETY: the object's live sink, which `end_from_js` does not free.
        let sink = unsafe { &mut *self.sink_or_throw(cx.global())?.as_ptr() };
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
        mut sink: NonNull<T>,
    ) -> JSValue {
        // SAFETY: `sink` is a live sink owned by the caller for this synchronous call.
        let sink = unsafe { sink.as_mut() };
        sink.controller_created(controller, global);
        *sink.source() = SourceHandle::JSController(controller);
        start_pump(global, stream, controller)
    }

    pub(crate) fn detach(controller: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        let this: &Self = controller.as_class_ref().expect("a ReadableSinkController");
        this.detach_with_reason(global, None)
    }

    /// The sink closed underneath its source.
    pub(crate) fn on_close(
        controller: JSValue,
        global: &JSGlobalObject,
        reason: JSValue,
    ) -> JsResult<()> {
        let this: &Self = controller.as_class_ref().expect("a ReadableSinkController");
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
                removable_body!(HtmlRewriter, Abort, { sink_memory_cost(sink) })
            }
            Some(AnyControlledSink::HTTPResponseSink(sink)) => {
                removable_body!(Serve, Abort, { sink_memory_cost(sink) })
            }
            Some(AnyControlledSink::HTTPSResponseSink(sink)) => {
                removable_body!(Serve, Abort, { sink_memory_cost(sink) })
            }
            Some(AnyControlledSink::NetworkSink(sink)) => {
                removable_body!(S3Client, Abort, { sink_memory_cost(sink) })
            }
            Some(AnyControlledSink::FetchRequestBodySink(sink)) => {
                removable_body!(Fetch, Abort, { sink_memory_cost(sink) })
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

    /// `end()` and `close()` detach before they run any JS: the close handler can re-enter the event loop and free the sink (`handle_resolve_stream` -> `destroy_sink`).
    fn take_sink(&self) -> Option<AnyControlledSink> {
        let sink = self.sink()?;
        self.is_detached.set(true);
        let controller = self.this_value();
        match sink {
            AnyControlledSink::FileSink(sink) => controller_detached(sink, controller),
            AnyControlledSink::RewriterPipe(sink) => {
                removable_body!(HtmlRewriter, Abort, {
                    controller_detached(sink, controller)
                })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body!(Serve, Abort, { controller_detached(sink, controller) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body!(Serve, Abort, { controller_detached(sink, controller) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body!(S3Client, Abort, { controller_detached(sink, controller) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body!(Fetch, Abort, { controller_detached(sink, controller) })
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
                removable_body!(HtmlRewriter, Abort, { close_sink(sink, global, reason) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body!(Serve, Abort, { close_sink(sink, global, reason) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body!(Serve, Abort, { close_sink(sink, global, reason) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body!(S3Client, Abort, { close_sink(sink, global, reason) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body!(Fetch, Abort, { close_sink(sink, global, reason) })
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
                removable_body!(HtmlRewriter, Abort, { flush_sink(sink, cx, wait) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body!(Serve, Abort, { flush_sink(sink, cx, wait) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body!(Serve, Abort, { flush_sink(sink, cx, wait) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body!(S3Client, Abort, { flush_sink(sink, cx, wait) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body!(Fetch, Abort, { flush_sink(sink, cx, wait) })
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
                removable_body!(HtmlRewriter, Abort, { end_sink(sink, cx) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body!(Serve, Abort, { end_sink(sink, cx) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body!(Serve, Abort, { end_sink(sink, cx) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body!(S3Client, Abort, { end_sink(sink, cx) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body!(Fetch, Abort, { end_sink(sink, cx) })
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
                removable_body!(HtmlRewriter, Abort, { start_sink(sink, cx, chunk_size) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body!(Serve, Abort, { start_sink(sink, cx, chunk_size) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body!(Serve, Abort, { start_sink(sink, cx, chunk_size) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body!(S3Client, Abort, { start_sink(sink, cx, chunk_size) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body!(Fetch, Abort, { start_sink(sink, cx, chunk_size) })
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
                removable_body!(HtmlRewriter, Abort, { write_chunk(sink, cx, data) })
            }
            AnyControlledSink::HTTPResponseSink(sink) => {
                removable_body!(Serve, Abort, { write_chunk(sink, cx, data) })
            }
            AnyControlledSink::HTTPSResponseSink(sink) => {
                removable_body!(Serve, Abort, { write_chunk(sink, cx, data) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body!(S3Client, Abort, { write_chunk(sink, cx, data) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body!(Fetch, Abort, { write_chunk(sink, cx, data) })
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
        let written = unsafe { sink.to_sink_handle() }.write(&Temporary(RawSlice::new(bytes)));
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
                    removable_body!(Serve, Abort, { controller_finalize(sink) })
                }
                AnyControlledSink::HTTPSResponseSink(sink) => {
                    removable_body!(Serve, Abort, { controller_finalize(sink) })
                }
                AnyControlledSink::NetworkSink(sink) => {
                    removable_body!(S3Client, Abort, { controller_finalize(sink) })
                }
                AnyControlledSink::FetchRequestBodySink(sink) => {
                    removable_body!(Fetch, Abort, { controller_finalize(sink) })
                }
            }
        }
    }
}
