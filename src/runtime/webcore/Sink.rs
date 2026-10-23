use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use crate::api::bun_subprocess::Subprocess;
use crate::api::html_rewriter::RewriterPipe;
use crate::generated_bindgen::sink::{
    SinkChunk, SinkFd, SinkStartOptions, js_ReadableSinkController as js,
};
use crate::webcore::SinkHandle;
use crate::webcore::fetch::FetchRequestBodySink;
use crate::webcore::file_sink::FileSink;
use crate::webcore::streams::{
    self, HTTPResponseSink, HTTPSResponseSink, NetworkSink, SourceHandle,
};
use bun_jsc::bindgen::{JsHeap, JsLocal, JsPayload, JsScope, JsWrapper};
use bun_jsc::{ErrorCode, JSGlobalObject, JSValue, JsClass, JsError, JsResult, JsThread};
use bun_sys::{self as sys, Error as SysError};
use bun_sys_jsc::ErrorJsc as _;

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

/// `sinkId` of a sink's JS object and of its controller.
#[repr(u8)]
#[derive(Copy, Clone)]
pub(crate) enum SinkId {
    ArrayBuffer = 0,
    File = 2,
    HTMLRewriter = 3,
    HTTPResponse = 4,
    HTTPSResponse = 5,
    Network = 6,
    FetchRequestBody = 7,
}

/// What [`JSSink`] and [`ReadableSinkController`] call on a sink.
pub(crate) trait JsSinkType: Sized + 'static {
    const NAME: &'static str;
    const ID: SinkId;

    fn memory_cost(&self) -> usize;
    /// The JS object that holds `this` is giving up its claim on the sink. Raw
    /// pointer, not `&mut self`: for `ArrayBufferSink`, `FileSink` and
    /// `FetchRequestBodySink` that releases the allocation, and freeing under a
    /// live reference argument is UB.
    ///
    /// # Safety
    /// `this` is the object's live sink and must not be used after the call.
    unsafe fn finalize(this: *mut Self);
    /// A controller died still attached to `this`, right after
    /// [`controller_detached`](Self::controller_detached). The default gives up
    /// the claim like any other object; a sink whose controller holds no claim
    /// overrides it.
    ///
    /// # Safety
    /// As [`finalize`](Self::finalize).
    unsafe fn controller_finalize(this: *mut Self) {
        // SAFETY: the caller's contract is the same one.
        unsafe { Self::finalize(this) }
    }
    fn write_bytes(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn end(&mut self, err: Option<SysError>) -> sys::Result<()>;
    fn end_from_js(&mut self, cx: &JsThread<'_>) -> sys::Result<JSValue>;
    fn flush_from_js(&mut self, cx: &JsThread<'_>, wait: bool) -> sys::Result<JSValue>;
    fn start_config(options: &SinkStartOptions<'_>) -> streams::Start {
        streams::Start::chunk_size(options)
    }
    fn start(
        &mut self,
        config: streams::Start,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> sys::Result<()>;
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

    fn source(&mut self) -> Option<&mut SourceHandle> {
        None
    }
    /// `assign_to_stream` made `controller` for this sink: a sink that keeps JS values roots it and puts them on it.
    fn controller_created(&mut self, _controller: JSValue, _global: &JSGlobalObject) {}
    /// Once per controller, on every detach path including its collection. A
    /// sink co-owned by another GC cell releases the controller's claim here
    /// (sweep order between the two cells is unspecified, so neither alone may
    /// free it). Never free the allocation inline: the caller holds
    /// `&mut Self` and keeps using the sink in the same frame; defer a
    /// last-owner free to the event loop.
    fn controller_detached(&mut self) {}
    fn pending_state_is_pending(&self) -> bool {
        false
    }
    fn protect_js_wrapper(&mut self, _global: &JSGlobalObject, _this_value: JSValue) {}
    fn update_ref(&mut self, _value: bool) {}
    fn get_fd(&self) -> Option<i32> {
        None
    }
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
fn throw_sys_error(global: &JSGlobalObject, error: &SysError) -> JsError {
    match error.to_js(global) {
        Ok(value) => global.throw_value(value),
        Err(thrown) => thrown,
    }
}

fn write_chunk<'a, T: JsSinkType>(
    sink: NonNull<T>,
    cx: &mut JsScope<'a>,
    chunk: Option<SinkChunk<'a>>,
) -> JsResult<JSValue> {
    use streams::Result::Temporary;
    // SAFETY: see the section comment.
    let sink = unsafe { &mut *sink.as_ptr() };
    // The chunk's argument slot holds the bytes for the call, and the sink copies what it keeps.
    let written = match &chunk {
        Some(SinkChunk::Bytes(buffer)) => buffer.with_bytes(&cx.heap, |bytes| {
            (!bytes.is_empty()).then(|| sink.write_bytes(&Temporary(bun_ptr::RawSlice::new(bytes))))
        }),
        Some(SinkChunk::Text(text)) if text.is_empty() => None,
        Some(SinkChunk::Text(text)) if text.is_utf16() => Some(sink.write_utf16(&Temporary(
            bun_ptr::RawSlice::new(bytemuck::cast_slice(text.utf16())),
        ))),
        Some(SinkChunk::Text(text)) => {
            Some(sink.write_latin1(&Temporary(bun_ptr::RawSlice::new(text.latin1()))))
        }
        None | Some(SinkChunk::Invalid(_)) => {
            let code = match &chunk {
                None => ErrorCode::MISSING_ARGS,
                Some(SinkChunk::Invalid(value)) if value.to_js().is_undefined_or_null() => {
                    ErrorCode::STREAM_NULL_VALUES
                }
                _ => ErrorCode::INVALID_ARG_TYPE,
            };
            let global = cx.global();
            return Err(global.throw_value(global.to_type_error(
                code,
                format_args!("write() expects a string, ArrayBufferView, or ArrayBuffer"),
            )));
        }
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
        .map_err(|error| throw_sys_error(cx.global(), &error))
}

fn start_sink<T: JsSinkType>(
    sink: NonNull<T>,
    cx: &JsThread<'_>,
    options: &SinkStartOptions<'_>,
) -> JsResult<()> {
    // SAFETY: see the section comment.
    unsafe { &mut *sink.as_ptr() }
        .start(T::start_config(options), cx.context())
        .map_err(|error| throw_sys_error(cx.global(), &error))
}

/// The sink can also leave an exception pending and return no error.
fn end_sink<T: JsSinkType>(sink: NonNull<T>, cx: &JsThread<'_>) -> JsResult<JSValue> {
    // SAFETY: see the section comment.
    bun_jsc::call_check_slow(cx.global(), || {
        unsafe { &mut *sink.as_ptr() }.end_from_js(cx)
    })?
    .map_err(|error| throw_sys_error(cx.global(), &error))
}

/// `reason` is `None` for a clean close, else the failed source's reason, which the pump may pass as `undefined`.
/// As [`end_sink`], the sink can also leave an exception pending.
///
/// # Safety
/// `sink` is live. `close_with_error` may re-enter or free it.
unsafe fn close_sink<T: JsSinkType>(
    sink: NonNull<T>,
    global: &JSGlobalObject,
    reason: Option<JSValue>,
) -> JsResult<()> {
    bun_jsc::call_check_slow(global, || match reason {
        // SAFETY: caller contract; `end` does not free the sink.
        None => unsafe { (*sink.as_ptr()).end(None) },
        // SAFETY: caller contract.
        Some(reason) => unsafe { T::close_with_error(sink.as_ptr(), global, reason) },
    })?
    .map_err(|error| throw_sys_error(global, &error))
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
        match self.sink.get() {
            // SAFETY: the object's live sink.
            Some(sink) => size_of::<T>() + unsafe { sink.as_ref() }.memory_cost(),
            None => 0,
        }
    }

    pub(crate) fn close(&self, cx: &mut JsScope<'_>) -> JsResult<()> {
        let Some(sink) = self.sink.take() else {
            return Ok(());
        };
        // SAFETY: the object's live sink, which a clean close does not free.
        let result = unsafe { close_sink(sink, cx.global(), None) };
        // `Drop` no longer sees the sink, so this does what it would, even if the close threw.
        self.notify_subprocess();
        // SAFETY: as above, and nothing uses it after this.
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
        let sink = self.open_sink(cx.global())?;
        let result = end_sink(sink, &cx.js_thread());
        // SAFETY: `end_from_js` does not free the sink.
        let sink = unsafe { &mut *sink.as_ptr() };
        // The object stays attached and alive so that the pending write can resolve its promise.
        if sink.pending_state_is_pending() {
            sink.protect_js_wrapper(cx.global(), this_value.to_js());
        }
        result
    }

    pub(crate) fn start(
        &self,
        cx: &mut JsScope<'_>,
        options: &SinkStartOptions<'_>,
    ) -> JsResult<()> {
        start_sink(self.open_sink(cx.global())?, &cx.js_thread(), options)
    }

    pub(crate) fn write<'a>(
        &self,
        cx: &mut JsScope<'a>,
        chunk: Option<SinkChunk<'a>>,
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
        // SAFETY: `value` holds the payload.
        unsafe { &*Self::from_js(value)? }.sink.get()
    }

    /// The `Subprocess` is going away, or its stdin already has.
    pub(crate) fn forget_subprocess(value: JSValue) {
        if let Some(this) = Self::from_js(value) {
            // SAFETY: `value` holds the payload.
            unsafe { &*this }.subprocess.set(None);
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

unsafe extern "C" {
    /// Returns undefined (drained inline), the pump promise, or the thrown Exception cell.
    safe fn ReadableSinkController__assignToStream(
        global: &JSGlobalObject,
        stream: JSValue,
        controller: JSValue,
    ) -> JSValue;
}

/// Writes to a native sink on behalf of a stream: it is the `controller` of a
/// `type: "direct"` stream, and what the pump of any other stream writes to.
pub(crate) struct ReadableSinkController {
    id: SinkId,
    /// A `T` of `id`. `None` once detached: the controller must be detached before the sink is freed.
    sink: Cell<Option<NonNull<c_void>>>,
    /// The destination went away (peer abort, write error) before the source closed the controller.
    destination_closed: Cell<bool>,
}

impl ReadableSinkController {
    /// A new controller attached to `sink`.
    pub(crate) fn create<T: JsSinkType>(global: &JSGlobalObject, sink: NonNull<T>) -> JSValue {
        Self {
            id: T::ID,
            sink: Cell::new(Some(sink.cast())),
            destination_closed: Cell::new(false),
        }
        .to_js(global)
    }

    /// Pump `stream` into `sink` through a new controller, kept as the sink's
    /// `source()`. It is installed before the pump starts because the pump
    /// drains whatever the stream already holds (user code included) before
    /// returning, and a sink failing in there detaches its `source()`.
    pub(crate) fn assign_to_stream<T: JsSinkType>(
        global: &JSGlobalObject,
        stream: JSValue,
        sink: NonNull<T>,
    ) -> JSValue {
        let controller = Self::create(global, sink);
        Self::assign_controller_to_stream(global, stream, controller, sink)
    }

    /// [`assign_to_stream`](Self::assign_to_stream) through a `controller` from [`create`](Self::create).
    pub(crate) fn assign_controller_to_stream<T: JsSinkType>(
        global: &JSGlobalObject,
        stream: JSValue,
        controller: JSValue,
        mut sink: NonNull<T>,
    ) -> JSValue {
        // SAFETY: the caller owns the live sink for this synchronous call.
        let sink = unsafe { sink.as_mut() };
        sink.controller_created(controller, global);
        if let Some(source) = sink.source() {
            *source = SourceHandle::JSController(controller);
        }
        let result = ReadableSinkController__assignToStream(global, stream, controller);
        // Setup threw (e.g. a direct stream's `pull` getter): nothing will ever
        // end() or close() the controller, and its `Drop` would otherwise run
        // `controller_finalize` on the sink after its owner has freed it.
        // Detach it while the sink is live (a no-op if it already detached in
        // the call).
        if result.to_error().is_some() {
            crate::dispatch::fold(Self::detach_value(global, controller));
        }
        result
    }

    /// `controller` is one that a sink holds as its `source()` or in its `PipeCell`.
    fn of<'a>(controller: JSValue) -> &'a Self {
        // SAFETY: the cell holds the payload, and every field is a `Cell`.
        unsafe {
            js::from_js(controller)
                .expect("a ReadableSinkController")
                .as_ref()
        }
    }

    pub(crate) fn detach_value(global: &JSGlobalObject, controller: JSValue) -> JsResult<()> {
        Self::of(controller).detach(controller, global, None)
    }

    /// The sink closed underneath its source.
    pub(crate) fn on_close(
        global: &JSGlobalObject,
        controller: JSValue,
        reason: JSValue,
    ) -> JsResult<()> {
        Self::of(controller).destination_closed.set(true);
        if js::source_get_cached(controller).is_none() {
            return Ok(());
        }
        bun_jsc::cpp::ReadableSinkController__onClose(controller, global, reason, true)
    }

    /// The sink can take more.
    pub(crate) fn on_ready(global: &JSGlobalObject, controller: JSValue) -> JsResult<()> {
        bun_jsc::cpp::ReadableSinkController__onReady(controller, global)
    }

    /// For a native transform, which writes to the sink without the controller's methods.
    pub(crate) fn handle(&self) -> SinkHandle {
        use bun_ptr::BackRef;
        let Some(sink) = self.sink.get() else {
            return SinkHandle::None;
        };
        let sink = sink.as_ptr();
        // SAFETY: a live `T` of `id`, for as long as the controller is attached.
        unsafe {
            match self.id {
                SinkId::ArrayBuffer => SinkHandle::ArrayBuffer(BackRef::from_raw_mut(sink.cast())),
                SinkId::File => SinkHandle::FileSink(BackRef::from_raw(sink.cast())),
                SinkId::HTMLRewriter => SinkHandle::HTMLRewriter(BackRef::from_raw(sink.cast())),
                SinkId::HTTPResponse => {
                    SinkHandle::HttpResponse(BackRef::from_raw_mut(sink.cast()))
                }
                SinkId::HTTPSResponse => {
                    SinkHandle::HttpsResponse(BackRef::from_raw_mut(sink.cast()))
                }
                SinkId::Network => SinkHandle::S3Upload(BackRef::from_raw_mut(sink.cast())),
                SinkId::FetchRequestBody => {
                    SinkHandle::FetchRequestBody(BackRef::from_raw_mut(sink.cast()))
                }
            }
        }
    }

    fn sink_name(&self) -> &'static str {
        match self.id {
            SinkId::ArrayBuffer => ArrayBufferSink::NAME,
            SinkId::File => FileSink::NAME,
            SinkId::HTMLRewriter => RewriterPipe::NAME,
            SinkId::HTTPResponse => HTTPResponseSink::NAME,
            SinkId::HTTPSResponse => HTTPSResponseSink::NAME,
            SinkId::Network => NetworkSink::NAME,
            SinkId::FetchRequestBody => FetchRequestBodySink::NAME,
        }
    }

    /// `None`: the destination went away, so `write()` and `flush()` report 0 bytes and the source can stop.
    fn attached_sink(&self, global: &JSGlobalObject) -> JsResult<Option<NonNull<c_void>>> {
        match self.sink.get() {
            None if !self.destination_closed.get() => {
                Err(throw_already_closed(global, self.sink_name()))
            }
            sink => Ok(sink),
        }
    }

    /// The controller stops being attached to `sink`.
    ///
    /// `SourceHandle::JSController` has the controller's bits without rooting
    /// the cell, so the controller can be collected while the sink still has a
    /// flush in flight. From here on the source must never fire: it would
    /// decode a dead cell. A sink that was assigned to another stream since
    /// holds the newer controller's bits, and keeps them.
    fn sink_detached(&self, sink: NonNull<c_void>, controller: JSValue) {
        fn detached<T: JsSinkType>(sink: NonNull<c_void>, controller: JSValue) {
            // SAFETY: a live `T`; see the section comment above `write_chunk`.
            let sink = unsafe { sink.cast::<T>().as_mut() };
            if let Some(source) = sink.source() {
                if matches!(*source, SourceHandle::JSController(held) if held == controller) {
                    source.clear();
                }
            }
            sink.controller_detached();
        }
        match self.id {
            SinkId::ArrayBuffer => detached::<ArrayBufferSink>(sink, controller),
            SinkId::File => detached::<FileSink>(sink, controller),
            SinkId::HTMLRewriter => detached::<RewriterPipe>(sink, controller),
            SinkId::HTTPResponse => detached::<HTTPResponseSink>(sink, controller),
            SinkId::HTTPSResponse => detached::<HTTPSResponseSink>(sink, controller),
            SinkId::Network => detached::<NetworkSink>(sink, controller),
            SinkId::FetchRequestBody => detached::<FetchRequestBodySink>(sink, controller),
        }
    }

    /// For `end()` and `close()`, which detach before they run any JS: the
    /// close handler can re-enter the event loop and free the sink (e.g.
    /// `handle_resolve_stream` -> `destroy_sink`) while they still use it.
    fn take_sink(&self, controller: JSValue) -> Option<NonNull<c_void>> {
        let sink = self.sink.get()?;
        self.sink_detached(sink, controller);
        self.sink.set(None);
        Some(sink)
    }

    fn detach(
        &self,
        controller: JSValue,
        global: &JSGlobalObject,
        reason: Option<JSValue>,
    ) -> JsResult<()> {
        if let Some(reason) = reason {
            if js::fail_reason_get_cached(controller).is_none() {
                js::fail_reason_set_cached(controller, global, reason);
            }
        }
        if let Some(sink) = self.sink.take() {
            self.sink_detached(sink, controller);
        }
        if js::source_get_cached(controller).is_none() {
            return Ok(());
        }
        // A sink whose close re-enters here (FileSink's `on_close` runs inside `close(error)`) detaches before `close` passes the reason, which `failReason` already has.
        let reason = reason
            .or_else(|| js::fail_reason_get_cached(controller))
            .unwrap_or(JSValue::UNDEFINED);
        bun_jsc::cpp::ReadableSinkController__onClose(controller, global, reason, false)
    }

    /// The close handler moves a direct stream to closed and settles its close
    /// promise, so it runs even if the sink's own `end` or `close` threw. The
    /// sink's error wins over the handler's.
    fn detach_after<R>(
        &self,
        controller: JSValue,
        global: &JSGlobalObject,
        reason: Option<JSValue>,
        result: JsResult<R>,
    ) -> JsResult<R> {
        let error = match result {
            Ok(value) => return self.detach(controller, global, reason).map(|()| value),
            Err(error) => error,
        };
        if matches!(error, JsError::Terminated) || global.has_pending_termination_exception() {
            return Err(error);
        }
        let exception = global.take_exception(error);
        if let Err(error) = self.detach(controller, global, reason) {
            if matches!(error, JsError::Terminated) || !global.clear_exception_except_termination()
            {
                return Err(error);
            }
        }
        Err(global.throw_value(exception))
    }

    fn end_value(&self, controller: JSValue, cx: &JsThread<'_>) -> JsResult<JSValue> {
        let Some(sink) = self.take_sink(controller) else {
            return Ok(JSValue::UNDEFINED);
        };
        let result = match self.id {
            SinkId::ArrayBuffer => end_sink::<ArrayBufferSink>(sink.cast(), cx),
            SinkId::File => end_sink::<FileSink>(sink.cast(), cx),
            SinkId::HTMLRewriter => end_sink::<RewriterPipe>(sink.cast(), cx),
            SinkId::HTTPResponse => end_sink::<HTTPResponseSink>(sink.cast(), cx),
            SinkId::HTTPSResponse => end_sink::<HTTPSResponseSink>(sink.cast(), cx),
            SinkId::Network => end_sink::<NetworkSink>(sink.cast(), cx),
            SinkId::FetchRequestBody => end_sink::<FetchRequestBodySink>(sink.cast(), cx),
        };
        self.detach_after(controller, cx.global(), None, result)
    }

    /// `reason` as for [`close_sink`].
    fn close_value(
        &self,
        controller: JSValue,
        global: &JSGlobalObject,
        reason: Option<JSValue>,
    ) -> JsResult<()> {
        let Some(sink) = self.take_sink(controller) else {
            return Ok(());
        };
        // SAFETY: the sink was live when `take_sink` detached it, and nothing has run since.
        let result = unsafe {
            match self.id {
                SinkId::ArrayBuffer => close_sink::<ArrayBufferSink>(sink.cast(), global, reason),
                SinkId::File => close_sink::<FileSink>(sink.cast(), global, reason),
                SinkId::HTMLRewriter => close_sink::<RewriterPipe>(sink.cast(), global, reason),
                SinkId::HTTPResponse => close_sink::<HTTPResponseSink>(sink.cast(), global, reason),
                SinkId::HTTPSResponse => {
                    close_sink::<HTTPSResponseSink>(sink.cast(), global, reason)
                }
                SinkId::Network => close_sink::<NetworkSink>(sink.cast(), global, reason),
                SinkId::FetchRequestBody => {
                    close_sink::<FetchRequestBodySink>(sink.cast(), global, reason)
                }
            }
        };
        self.detach_after(controller, global, reason, result)
    }

    /// A falsy `error` is the same clean close as `close()`.
    pub(crate) fn close<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        error: JsLocal<'a>,
    ) -> JsResult<()> {
        let error = error.to_js();
        self.close_value(
            this_value.to_js(),
            cx.global(),
            error.to_boolean().then_some(error),
        )
    }

    pub(crate) fn flush(&self, cx: &mut JsScope<'_>, wait: Option<bool>) -> JsResult<JSValue> {
        let Some(sink) = self.attached_sink(cx.global())? else {
            return Ok(JSValue::js_number(0.0));
        };
        let cx = &cx.js_thread();
        match self.id {
            SinkId::ArrayBuffer => flush_sink::<ArrayBufferSink>(sink.cast(), cx, wait),
            SinkId::File => flush_sink::<FileSink>(sink.cast(), cx, wait),
            SinkId::HTMLRewriter => flush_sink::<RewriterPipe>(sink.cast(), cx, wait),
            SinkId::HTTPResponse => flush_sink::<HTTPResponseSink>(sink.cast(), cx, wait),
            SinkId::HTTPSResponse => flush_sink::<HTTPSResponseSink>(sink.cast(), cx, wait),
            SinkId::Network => flush_sink::<NetworkSink>(sink.cast(), cx, wait),
            SinkId::FetchRequestBody => flush_sink::<FetchRequestBodySink>(sink.cast(), cx, wait),
        }
    }

    pub(crate) fn end<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<JSValue> {
        self.end_value(this_value.to_js(), &cx.js_thread())
    }

    pub(crate) fn start(
        &self,
        cx: &mut JsScope<'_>,
        options: &SinkStartOptions<'_>,
    ) -> JsResult<()> {
        let Some(sink) = self.attached_sink(cx.global())? else {
            return Ok(());
        };
        let cx = &cx.js_thread();
        match self.id {
            SinkId::ArrayBuffer => start_sink::<ArrayBufferSink>(sink.cast(), cx, options),
            SinkId::File => start_sink::<FileSink>(sink.cast(), cx, options),
            SinkId::HTMLRewriter => start_sink::<RewriterPipe>(sink.cast(), cx, options),
            SinkId::HTTPResponse => start_sink::<HTTPResponseSink>(sink.cast(), cx, options),
            SinkId::HTTPSResponse => start_sink::<HTTPSResponseSink>(sink.cast(), cx, options),
            SinkId::Network => start_sink::<NetworkSink>(sink.cast(), cx, options),
            SinkId::FetchRequestBody => {
                start_sink::<FetchRequestBodySink>(sink.cast(), cx, options)
            }
        }
    }

    pub(crate) fn write<'a>(
        &self,
        cx: &mut JsScope<'a>,
        chunk: Option<SinkChunk<'a>>,
    ) -> JsResult<JSValue> {
        let Some(sink) = self.attached_sink(cx.global())? else {
            return Ok(JSValue::js_number(0.0));
        };
        match self.id {
            SinkId::ArrayBuffer => write_chunk::<ArrayBufferSink>(sink.cast(), cx, chunk),
            SinkId::File => write_chunk::<FileSink>(sink.cast(), cx, chunk),
            SinkId::HTMLRewriter => write_chunk::<RewriterPipe>(sink.cast(), cx, chunk),
            SinkId::HTTPResponse => write_chunk::<HTTPResponseSink>(sink.cast(), cx, chunk),
            SinkId::HTTPSResponse => write_chunk::<HTTPSResponseSink>(sink.cast(), cx, chunk),
            SinkId::Network => write_chunk::<NetworkSink>(sink.cast(), cx, chunk),
            SinkId::FetchRequestBody => write_chunk::<FetchRequestBodySink>(sink.cast(), cx, chunk),
        }
    }

    pub(crate) fn get_sink_id(&self) -> u8 {
        self.id as u8
    }
}

impl Drop for ReadableSinkController {
    fn drop(&mut self) {
        let Some(sink) = self.sink.take() else { return };
        // SAFETY: only a controller in its JS object is dropped. The dead cell is compared, not read.
        self.sink_detached(sink, unsafe { self.wrapper_value() });
        let sink = sink.as_ptr();
        // SAFETY: a live `T` of `id`, which nothing uses after this.
        unsafe {
            match self.id {
                SinkId::ArrayBuffer => ArrayBufferSink::controller_finalize(sink.cast()),
                SinkId::File => FileSink::controller_finalize(sink.cast()),
                SinkId::HTMLRewriter => RewriterPipe::controller_finalize(sink.cast()),
                SinkId::HTTPResponse => HTTPResponseSink::controller_finalize(sink.cast()),
                SinkId::HTTPSResponse => HTTPSResponseSink::controller_finalize(sink.cast()),
                SinkId::Network => NetworkSink::controller_finalize(sink.cast()),
                SinkId::FetchRequestBody => FetchRequestBodySink::controller_finalize(sink.cast()),
            }
        }
    }
}

impl SourceHandle {
    /// Disconnect the upstream source: JSController → detach; ByteStream → clear its SinkHandle.
    pub(crate) fn detach(&mut self, global: &JSGlobalObject) {
        match *self {
            SourceHandle::JSController(value) => {
                self.clear();
                crate::dispatch::fold(ReadableSinkController::detach_value(global, value));
            }
            SourceHandle::ByteStream(bs) => {
                bs.unpipe_without_deref();
                self.clear();
            }
            SourceHandle::FileReader(fr) => {
                fr.unpipe_without_deref();
                self.clear();
            }
            _ => {}
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// For `BunStreamSource.cpp`, which drives a controller without its methods
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub(crate) extern "C" fn ReadableSinkController__isAttached(this: &ReadableSinkController) -> bool {
    this.sink.get().is_some()
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn ReadableSinkController__end(
    global: &JSGlobalObject,
    controller: JSValue,
) -> JSValue {
    bun_jsc::host_fn::to_js_host_call(global, || {
        ReadableSinkController::of(controller)
            .end_value(controller, &global.js_thread_of_caller_no_frame())
    })
}

/// An empty `reason` is a clean close. Any other, `undefined` too, tells the sink that its source failed.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn ReadableSinkController__close(
    global: &JSGlobalObject,
    controller: JSValue,
    reason: JSValue,
) -> JSValue {
    bun_jsc::host_fn::to_js_host_call(global, || {
        ReadableSinkController::of(controller)
            .close_value(controller, global, (!reason.is_empty()).then_some(reason))
            .map(|()| JSValue::UNDEFINED)
    })
}

/// A native transform, or the pump with a chunk that is a view, writes bytes
/// to the sink. The result is what [`streams::result::Writable::to_js`] makes,
/// so `nativeSinkWriteIsBackpressure` reads a negative number or a pending
/// promise as it does for the controller's `write()`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn ReadableSinkController__writeBytes(
    this: &ReadableSinkController,
    global: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    let handle = this.handle();
    if handle.is_none() || len == 0 || ptr.is_null() {
        return JSValue::js_number(0.0);
    }
    // SAFETY: the caller keeps `[ptr, ptr + len)` readable for this call (a
    // GC-kept `JSArrayBufferView` or its own scratch buffer).
    let bytes = unsafe { core::slice::from_raw_parts(ptr, len) };
    handle
        .write(&streams::Result::Temporary(bun_ptr::RawSlice::new(bytes)))
        // A C++ transform step, which script is running, calls this.
        .to_js(&global.js_thread_of_caller_no_frame())
}
