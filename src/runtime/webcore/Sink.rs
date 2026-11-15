use core::borrow::Borrow;
use core::cell::Cell;
use core::ptr::NonNull;

use crate::api::bun_subprocess::Subprocess;
use crate::api::html_rewriter::RewriterPipe;
use crate::generated_bindgen::sink::{
    ArrayBufferSinkStartOptions, FileSinkStartOptions, NetworkSinkStartOptions,
    ReadableSinkControllerStartOptions, SinkChunk, SinkFd, js_ReadableSinkController as js,
};
use crate::webcore::fetch::FetchRequestBodySink;
use crate::webcore::file_sink::FileSink;
use crate::webcore::streams::{
    self, HTTPServerWritable, NetworkSink, Result::Temporary, SourceHandle,
};
use bun_core::EncodedUnits;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsPayload, JsScope, JsWrapper};
use bun_jsc::{
    ErrorCode, JSGlobalObject, JSValue, JsClass, JsError, JsResult, JsThread, SysErrorJsc as _,
};
use bun_ptr::{RefCounted, RefPtr};
use bun_removable_features::removable_body_behind_value;
use bun_sys::{self as sys, Error as SysError};

pub(crate) use crate::webcore::array_buffer_sink::ArrayBufferSink;

/// Emits the `JsSinkType` items that every sink forwards 1:1 to an inherent
/// method of the same name (`memory_cost`, `write_bytes` -> `write`,
/// `write_utf16`, `write_latin1`, `end`, `flush_from_js`, `start`).
/// Invoke inside the `impl JsSinkType for T` block; `Self::name` resolves to
/// the inherent method ahead of the trait item being defined, so the forward
/// does not recurse. `end_from_js` differs per sink and stays hand-written.
#[macro_export]
macro_rules! impl_js_sink_forwarders {
    // `start` also wants the context of the script that starts the sink.
    (start_takes_context) => {
        $crate::impl_js_sink_forwarders!(@common);
        fn start(
            &self,
            config: $crate::webcore::streams::Start,
            context: &::bun_jsc::ScriptExecutionContext,
        ) -> ::bun_sys::Result<()> {
            Self::start(self, &config, context)
        }
    };
    () => {
        $crate::impl_js_sink_forwarders!(@common);
        fn start(
            &self,
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
            &self,
            data: &$crate::webcore::streams::Result<'_>,
        ) -> $crate::webcore::streams::result::Writable<'_> {
            Self::write(self, data)
        }
        fn write_utf16(
            &self,
            text: &[u16],
        ) -> $crate::webcore::streams::result::Writable<'_> {
            Self::write_utf16(self, text)
        }
        fn write_latin1(
            &self,
            data: &$crate::webcore::streams::Result<'_>,
        ) -> $crate::webcore::streams::result::Writable<'_> {
            Self::write_latin1(self, data)
        }
        fn end(
            &self,
            err: ::core::option::Option<::bun_sys::Error>,
        ) -> ::bun_sys::Result<()> {
            Self::end(self, err)
        }
        fn flush_from_js(
            &self,
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
    fn write_bytes(&self, data: &streams::Result<'_>) -> streams::result::Writable<'_>;
    fn write_utf16(&self, text: &[u16]) -> streams::result::Writable<'_>;
    fn write_latin1(&self, data: &streams::Result<'_>) -> streams::result::Writable<'_>;
    fn end(&self, err: Option<SysError>) -> sys::Result<()>;
    fn end_from_js(&self, cx: &JsThread<'_>) -> sys::Result<JSValue>;
    fn flush_from_js(&self, cx: &JsThread<'_>, wait: bool) -> sys::Result<JSValue>;
    fn start(
        &self,
        config: streams::Start,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> sys::Result<()>;
    fn is_pending(&self) -> bool {
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
    /// Keeps the sink alive. Dropped inside a GC sweep.
    type Wrapped: Borrow<Self>;
    /// `close()` ended the sink: release what does not have to wait until the object is collected.
    fn wrapper_closed(&self);
}

/// A sink that a stream writes to through a [`ReadableSinkController`].
pub(crate) trait ControlledSink: JsSinkType + RefCounted {
    fn to_any_sink(this: RefPtr<Self>) -> AnyControlledSink;

    /// `assign_to_stream` made `controller` for this sink: a sink that keeps JS values roots it and puts them on it.
    fn controller_created(&self, _controller: JSValue, _global: &JSGlobalObject) {}

    /// A controller is collected while it is attached. Inside a GC sweep.
    fn controller_finalize(&self) {}

    /// The source failed, so the bytes written so far are a truncated body:
    /// `controller.close(error)` with a truthy argument, or the pump's close
    /// for an errored stream, whose `reason` may be nullish. The default keeps
    /// the clean end for sinks whose owner handles the pump promise rejection.
    fn close_with_error(&self, _global: &JSGlobalObject, _reason: JSValue) -> sys::Result<()> {
        self.end(None)
    }

    fn source(&self) -> &Cell<SourceHandle>;
}

// ──────────────────────────────────────────────────────────────────────────
// What a sink's JS object and a controller both do
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
    sink: &T,
    cx: &mut JsScope<'a>,
    chunk: SinkChunk<'a>,
) -> JsResult<JSValue> {
    // The chunk's argument slot holds the bytes for the call, and the sink copies what it keeps.
    let written = match chunk {
        SinkChunk::Bytes(buffer) => buffer.with_bytes(&cx.heap, |bytes| {
            if bytes.is_empty() {
                return streams::Writable::Owned(0);
            }
            sink.write_bytes(&Temporary(bytes))
        }),
        SinkChunk::Text(text) if text.is_empty() => return Ok(JSValue::js_number(0.0)),
        SinkChunk::Text(text) => match text.encoded_units() {
            EncodedUnits::Utf16(units) => sink.write_utf16(units),
            EncodedUnits::Latin1(bytes) | EncodedUnits::Utf8(bytes) => {
                sink.write_latin1(&Temporary(bytes))
            }
        },
        SinkChunk::Other(value) => return Err(throw_invalid_chunk(cx.global(), value.to_js())),
    };
    Ok(written.to_js(&cx.js_thread()))
}

fn flush_sink<T: JsSinkType>(sink: &T, cx: &JsThread<'_>, wait: Option<bool>) -> JsResult<JSValue> {
    let result = sink.flush_from_js(cx, wait == Some(true));
    result.map_err(|error| error.throw(cx.global()))
}

fn start_sink<T: JsSinkType>(sink: &T, cx: &JsThread<'_>, config: streams::Start) -> JsResult<()> {
    let result = sink.start(config, cx.context());
    result.map_err(|error| error.throw(cx.global()))
}

/// A sink can leave an exception pending and return no error. A termination stays pending: `BunStreamSource.cpp` stops on it.
fn pending_exception_or<R>(global: &JSGlobalObject, result: sys::Result<R>) -> JsResult<R> {
    if global.has_exception() {
        return Err(JsError::Thrown);
    }
    result.map_err(|error| error.throw(global))
}

fn end_sink<T: JsSinkType>(sink: &T, cx: &JsThread<'_>) -> JsResult<JSValue> {
    let result = sink.end_from_js(cx);
    pending_exception_or(cx.global(), result)
}

/// `reason` is `None` for a clean close.
fn close_sink<T: ControlledSink>(
    sink: &T,
    global: &JSGlobalObject,
    reason: Option<JSValue>,
) -> JsResult<()> {
    let result = match reason {
        None => sink.end(None),
        Some(reason) => sink.close_with_error(global, reason),
    };
    pending_exception_or(global, result)
}

fn sink_memory_cost<T: JsSinkType>(sink: &T) -> usize {
    size_of::<T>() + sink.memory_cost()
}

// ──────────────────────────────────────────────────────────────────────────
// JSSink
// ──────────────────────────────────────────────────────────────────────────

/// What the JS object of an `ArrayBufferSink`, a `FileSink` or a `NetworkSink` holds.
pub(crate) struct JSSink<T: WrappedSink> {
    sink: T::Wrapped,
    is_closed: Cell<bool>,
    ref_count: Cell<i32>,
    /// Notified that its stdin is gone when the object closes or is collected.
    subprocess: Cell<Option<NonNull<Subprocess<'static>>>>,
}

impl<T: WrappedSink> JSSink<T> {
    fn new(sink: T::Wrapped, subprocess: Option<NonNull<Subprocess<'static>>>) -> Self {
        Self {
            sink,
            is_closed: Cell::new(false),
            ref_count: Cell::new(1),
            subprocess: Cell::new(subprocess),
        }
    }

    /// `None` after `close()`.
    fn sink(&self) -> Option<&T> {
        (!self.is_closed.get()).then(|| self.sink.borrow())
    }

    fn sink_or_throw(&self, global: &JSGlobalObject) -> JsResult<&T> {
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
        sink_memory_cost::<T>(self.sink.borrow())
    }

    pub(crate) fn close(&self, cx: &mut JsScope<'_>) -> JsResult<()> {
        let Some(sink) = self.sink() else {
            return Ok(());
        };
        self.is_closed.set(true);
        let result = pending_exception_or(cx.global(), sink.end(None));
        self.notify_subprocess();
        sink.wrapper_closed();
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
        let sink = self.sink_or_throw(cx.global())?;
        let result = sink
            .end_from_js(&cx.js_thread())
            .map_err(|error| error.throw(cx.global()));
        // The object stays attached and alive so that the pending write can resolve its promise.
        if sink.is_pending() {
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
            sink.update_ref(true);
        }
    }

    pub(crate) fn unref(&self) {
        let Some(sink) = self.sink() else { return };
        self.ref_count.set((self.ref_count.get() - 1).max(0));
        if self.ref_count.get() == 0 {
            sink.update_ref(false);
        }
    }

    pub(crate) fn get_fd(&self) -> SinkFd {
        match self.sink() {
            None => SinkFd::Closed,
            Some(sink) => sink.get_fd().map_or(SinkFd::None, SinkFd::Fd),
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

    /// The `Subprocess` is going away, or its stdin already has.
    pub(crate) fn forget_subprocess(value: JSValue) {
        if let Some(this) = value.as_class_ref::<Self>() {
            this.subprocess.set(None);
        }
    }
}

impl JSSink<ArrayBufferSink> {
    pub(crate) fn constructor() -> Self {
        Self::new(ArrayBufferSink::default(), None)
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
    /// The sink of `value`, unless that is not such an object or it is closed.
    pub(crate) fn sink_from_js(value: JSValue) -> Option<RefPtr<FileSink>> {
        value
            .as_class_ref::<Self>()?
            .sink()
            .map(FileSink::ref_guard)
    }

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
pub(crate) enum AnyControlledSink {
    FileSink(RefPtr<FileSink>),
    RewriterPipe(RefPtr<RewriterPipe>),
    HTTPServerWritable(RefPtr<HTTPServerWritable>),
    NetworkSink(RefPtr<NetworkSink>),
    FetchRequestBodySink(RefPtr<FetchRequestBodySink>),
}

/// `$body` for the sink with its real type, behind the guard of the feature that makes it.
macro_rules! dispatch {
    ($any:expr, |$sink:ident| $body:expr) => {
        match $any {
            AnyControlledSink::FileSink($sink) => $body,
            AnyControlledSink::RewriterPipe($sink) => {
                removable_body_behind_value!(HtmlRewriter, { $body })
            }
            AnyControlledSink::HTTPServerWritable($sink) => {
                removable_body_behind_value!(Serve, { $body })
            }
            AnyControlledSink::NetworkSink($sink) => {
                removable_body_behind_value!(S3Client, { $body })
            }
            AnyControlledSink::FetchRequestBodySink($sink) => {
                removable_body_behind_value!(Fetch, { $body })
            }
        }
    };
}

/// Writes to a native sink on behalf of a stream: it is the `controller` of a
/// `type: "direct"` stream, and what the pump of any other stream writes to.
///
/// Generated code calls the `&self` methods. A sink calls the functions that take
/// `controller: JSValue`, which it keeps as its `source()` or in its `PipeCell`.
pub(crate) struct ReadableSinkController {
    sink: AnyControlledSink,
    is_detached: Cell<bool>,
    /// The destination went away (peer abort, write error) before the source closed the controller.
    destination_closed: Cell<bool>,
}

impl ReadableSinkController {
    /// A new controller attached to `sink`, which it holds until it is collected.
    pub(crate) fn create<T: ControlledSink>(global: &JSGlobalObject, sink: &RefPtr<T>) -> JSValue {
        Self {
            sink: T::to_any_sink(sink.clone()),
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
        sink: &RefPtr<T>,
    ) -> JSValue {
        let controller = Self::create(global, sink);
        Self::assign_controller_to_stream::<T>(global, stream, controller, sink)
    }

    /// [`assign_to_stream`](Self::assign_to_stream) through a `controller` from [`create`](Self::create).
    pub(crate) fn assign_controller_to_stream<T: ControlledSink>(
        global: &JSGlobalObject,
        stream: JSValue,
        controller: JSValue,
        sink: &T,
    ) -> JSValue {
        sink.controller_created(controller, global);
        sink.source().set(SourceHandle::JSController(controller));
        start_pump(global, stream, controller)
    }

    pub(crate) fn detach(controller: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        let this = controller
            .as_class_ref::<Self>()
            .expect("a ReadableSinkController");
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

    fn sink(&self) -> Option<&AnyControlledSink> {
        (!self.is_detached.get()).then_some(&self.sink)
    }

    /// For a native transform, which writes to the sink without the controller's methods. `None` once detached.
    pub(crate) fn write_native(&self, bytes: &[u8]) -> Option<streams::Writable<'_>> {
        let data = &Temporary(bytes);
        Some(dispatch!(self.sink()?, |sink| sink.write(data)))
    }

    pub(crate) fn memory_cost(&self) -> usize {
        dispatch!(&self.sink, |sink| sink_memory_cost(&**sink))
    }

    /// `None`: the destination went away, so `write()` and `flush()` report 0 bytes and the source can stop.
    fn sink_or_throw(&self, global: &JSGlobalObject) -> JsResult<Option<&AnyControlledSink>> {
        if !self.is_detached.get() || self.destination_closed.get() {
            return Ok(self.sink());
        }
        Err(throw_already_closed(
            global,
            match &self.sink {
                AnyControlledSink::FileSink(_) => FileSink::NAME,
                AnyControlledSink::RewriterPipe(_) => RewriterPipe::NAME,
                AnyControlledSink::HTTPServerWritable(sink) if sink.is_ssl => "HTTPSResponseSink",
                AnyControlledSink::HTTPServerWritable(_) => HTTPServerWritable::NAME,
                AnyControlledSink::NetworkSink(_) => NetworkSink::NAME,
                AnyControlledSink::FetchRequestBodySink(_) => FetchRequestBodySink::NAME,
            },
        ))
    }

    /// `end()` and `close()` detach before they run any JS, which can call them again.
    fn detach_sink(&self) -> Option<&AnyControlledSink> {
        let sink = self.sink()?;
        self.is_detached.set(true);
        let source = match sink {
            AnyControlledSink::FileSink(sink) => sink.source(),
            AnyControlledSink::RewriterPipe(sink) => sink.source(),
            AnyControlledSink::HTTPServerWritable(sink) => sink.source(),
            AnyControlledSink::NetworkSink(sink) => sink.source(),
            AnyControlledSink::FetchRequestBodySink(sink) => sink.source(),
        };
        // `SourceHandle::JSController` does not root the controller, so once it detaches the source must not fire. A sink that was assigned to another stream since holds the newer controller.
        if matches!(source.get(), SourceHandle::JSController(held) if held == self.this_value()) {
            source.set(SourceHandle::None);
        }
        Some(sink)
    }

    fn detach_with_reason(&self, global: &JSGlobalObject, reason: Option<JSValue>) -> JsResult<()> {
        let controller = self.this_value();
        if let Some(reason) = reason {
            js::set_fail_reason(controller, reason);
        }
        self.detach_sink();
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
        let Some(sink) = self.detach_sink() else {
            return Ok(());
        };
        let global = cx.global();
        let reason = error.map(JsLocal::to_js);
        let result = dispatch!(sink, |sink| close_sink(&**sink, global, reason));
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
        dispatch!(sink, |sink| flush_sink(&**sink, cx, wait))
    }

    pub(crate) fn end(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(sink) = self.detach_sink() else {
            return Ok(JSValue::UNDEFINED);
        };
        let cx = &cx.js_thread();
        let result = dispatch!(sink, |sink| end_sink(&**sink, cx));
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
                start_sink(&**sink, cx, config)
            }
            AnyControlledSink::RewriterPipe(sink) => {
                removable_body_behind_value!(HtmlRewriter, { start_sink(&**sink, cx, chunk_size) })
            }
            AnyControlledSink::HTTPServerWritable(sink) => {
                removable_body_behind_value!(Serve, { start_sink(&**sink, cx, chunk_size) })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body_behind_value!(S3Client, { start_sink(&**sink, cx, chunk_size) })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body_behind_value!(Fetch, { start_sink(&**sink, cx, chunk_size) })
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
        dispatch!(sink, |sink| write_chunk(&**sink, cx, data))
    }

    /// `write` of bytes that are not in a JS object.
    pub(crate) fn write_bytes(&self, cx: &mut JsScope<'_>, bytes: &[u8]) -> JsResult<JSValue> {
        self.sink_or_throw(cx.global())?;
        if !bytes.is_empty()
            && let Some(written) = self.write_native(bytes)
        {
            return Ok(written.to_js(&cx.js_thread()));
        }
        Ok(JSValue::js_number(0.0))
    }

    /// 2 and 6 must match `sinkPrototype(..)` in `Sink.bind.ts`.
    pub(crate) fn get_sink_id(&self) -> u8 {
        match &self.sink {
            AnyControlledSink::FileSink(_) => 2,
            AnyControlledSink::RewriterPipe(_) => 3,
            AnyControlledSink::HTTPServerWritable(sink) if sink.is_ssl => 5,
            AnyControlledSink::HTTPServerWritable(_) => 4,
            AnyControlledSink::NetworkSink(_) => 6,
            AnyControlledSink::FetchRequestBodySink(_) => 7,
        }
    }
}

/// Start the pump from `stream` into `controller`, whose sink
/// already holds it as its `source()`. Out of line so the
/// `assign_controller_to_stream` instantiations share one copy.
#[inline(never)]
fn start_pump(global: &JSGlobalObject, stream: JSValue, controller: JSValue) -> JSValue {
    let result = js::assign_to_stream(controller, global, stream);
    // Setup threw (e.g. a direct stream's `pull` getter): nothing will ever
    // end()/close() the controller.
    if result.to_error().is_some() {
        crate::dispatch::fold(ReadableSinkController::detach(controller, global));
    }
    result
}

impl Drop for ReadableSinkController {
    fn drop(&mut self) {
        let Some(sink) = self.detach_sink() else {
            return;
        };
        match sink {
            AnyControlledSink::FileSink(sink) => sink.controller_finalize(),
            AnyControlledSink::RewriterPipe(sink) => sink.controller_finalize(),
            AnyControlledSink::HTTPServerWritable(sink) => {
                removable_body_behind_value!(Serve, { sink.controller_finalize() })
            }
            AnyControlledSink::NetworkSink(sink) => {
                removable_body_behind_value!(S3Client, { sink.controller_finalize() })
            }
            AnyControlledSink::FetchRequestBodySink(sink) => {
                removable_body_behind_value!(Fetch, { sink.controller_finalize() })
            }
        }
    }
}
