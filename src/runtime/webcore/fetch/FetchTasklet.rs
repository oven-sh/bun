use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_boringssl as boringssl;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_core::{MutableString, String as BunString};
use bun_event_loop::{ConcurrentTask::ConcurrentTask, Task, Taskable};
use bun_http as http;
use bun_http::Method;
use bun_http::{
    AsyncHTTP, CertificateInfo, FetchRedirect, HTTPClientResult, HTTPResponseMetadata, Headers,
    Signals, ThreadSafeStreamBuffer,
};
use bun_io::KeepAlive;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, StrongOptional};
use bun_ptr::{AliasableBox, RefPtr};
use bun_threading::{Mutex, MutexGuard};
use bun_url::URL as ZigURL;

use crate::api::bun_x509 as X509;
use crate::generated_bindgen::fetch_tasklet::{
    Bun__FetchTasklet__onRejectRequestStream, Bun__FetchTasklet__onResolveRequestStream,
};
use crate::webcore::blob::{Any as AnyBlob, Blob, SizeType as BlobSizeType, Store as BlobStore};
use crate::webcore::body::{self, Body, Value as BodyValue, ValueError as BodyValueError};
use crate::webcore::fetch::fetch_request_body_sink::FetchRequestBodySink;
use crate::webcore::readable_stream::{ReadableStream, Strong as ReadableStreamStrong};
use crate::webcore::response::HeadersRef;
use crate::webcore::sink::ReadableSinkController;
use crate::webcore::streams::EncodedChunk;
use crate::webcore::streams::{SourceHandle, StreamError, StreamResult, Writable};
use crate::webcore::{AbortSignal, DrainResult, InternalBlob, Response, SinkHandle};
use bun_jsc::AbortSignalRef;

// `bun_event_loop::JsResult` (cycle-broken erased error) — used by
// ConcurrentTask callbacks at the tier-3 layer.

use http::signals::BODY_HIGH_WATER_MARK;

use boringssl::c::OwnedX509;

// ConcurrentTask::from() needs `Taskable`; tag is declared in bun_event_loop
// but the impl lives next to the type (cycle-break).
/// The "last ref dropped on the HTTP thread → deinit on the JS thread" hop:
/// same pointer, its own tag, so teardown can tell it from a progress update.
#[repr(transparent)]
pub(crate) struct FetchTaskletDeinitHop(FetchTasklet);
impl Taskable for FetchTaskletDeinitHop {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTaskletDeinit;
    /// The last ref dropped on the HTTP thread while we were tearing down:
    /// deinit here, on the JS thread with the heap alive, as the hop intended.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { Self::run(this) }
    }
    /// Frees a tasklet; calls no script.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
impl FetchTaskletDeinitHop {
    /// # Safety
    /// `this` is the tasklet the hop was created from, ref_count == 0, JS thread.
    pub(crate) unsafe fn run(this: *mut Self) {
        // SAFETY: fn contract — sole owner.
        drop(unsafe { bun_core::heap::take(this.cast::<FetchTasklet>()) });
    }
}

/// The HTTP thread drained the request body's buffer: the hop that tells the sink, on the JS
/// thread. Same pointer, its own tag.
#[repr(transparent)]
pub(crate) struct FetchTaskletRequestDrain(FetchTasklet);
impl Taskable for FetchTaskletRequestDrain {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTaskletRequestDrain;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; the task owns a ref.
        drop(unsafe { RefPtr::from_raw(this.cast::<FetchTasklet>()) });
    }
    /// Enters no context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

/// The HTTP thread's ref, and how that thread reaches the JS thread.
struct HttpThreadRef {
    tasklet: NonNull<FetchTasklet>,
    ticket: jsc::Ticket,
}

impl Drop for HttpThreadRef {
    fn drop(&mut self) {
        let tasklet = self.tasklet.as_ptr();
        // SAFETY: the ref taken in `queue`.
        if unsafe { bun_ptr::ThreadSafeRefCount::release(tasklet) } {
            // It holds JSC handles, so it is freed on the JS thread.
            self.ticket
                .post(ConcurrentTask::create(bun_event_loop::Task::init(
                    tasklet.cast::<FetchTaskletDeinitHop>(),
                )));
        }
    }
}

impl Taskable for FetchTasklet {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTasklet;
    /// No other progress update follows one that does not run.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; `js_ref` keeps the tasklet alive.
        drop(unsafe { (*this).js_ref.take() });
    }
    /// `on_progress_update` decides: a fetch whose context stopped reports nothing, and what is left
    /// of it is released there.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

bun_output::declare_scope!(FetchTasklet, visible);

/// Upper bound on the Content-Length-driven `reserve_exact` in `store_result()`.
const SCHEDULED_PRERESERVE_MAX: usize = 256 * 1024 * 1024;

use http::signals::BodyReceiveMode;

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct FetchTasklet {
    /// The JS controller holds a detachable back-pointer into it.
    sink: Option<AliasableBox<FetchRequestBodySink>>,
    /// `None` before the request is built and in `drop`.
    async_http_id: Option<u32>,
    method: Method,
    pub(crate) result: HTTPClientResult<'static>,
    pub(crate) metadata: Option<HTTPResponseMetadata>,
    /// Held while the request is out on the HTTP thread (`queue` until its
    /// final callback / `release_at_shutdown`): how that thread posts progress
    /// and deinit tasks, and what makes the VM wait for it. JS-thread code uses
    /// the VM through `global_this` instead and never touches this.
    http_ref: Option<HttpThreadRef>,
    /// Held until the last progress update.
    js_ref: Option<RefPtr<FetchTasklet>>,
    pub global_this: GlobalRef,
    pub(crate) request_body: HTTPRequestBody,
    /// This side's ref; the HTTP thread holds the other.
    pub(crate) request_body_streaming_buffer: Option<RefPtr<ThreadSafeStreamBuffer>>,

    /// buffer used to stream response to JS
    pub(crate) scheduled_response_buffer: MutableString,
    /// response weak ref we need this to track the response JS lifetime
    pub(crate) response: jsc::Weak<FetchTasklet>,
    /// native response ref if we still need it when JS is discarted
    pub(crate) native_response: JsCell<Option<RefPtr<Response>>>,
    /// The response body stream while this tasklet is its producer.
    pub(crate) response_stream: crate::webcore::byte_stream::ProducerHold,
    pub(crate) request_headers: Headers,
    /// `Content-Length` framing a streaming body; `write_request_data` counts against it.
    pub(crate) declared_request_body_len: Option<u64>,
    pub(crate) request_body_len_written: u64,
    /// The count missed and `WriteMessageType::LengthMismatch` was sent.
    pub(crate) request_body_mismatched: bool,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) concurrent_task: ConcurrentTask,
    pub poll_ref: KeepAlive,
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    pub(crate) body_size: http::BodySize,

    /// This is url + proxy memory buffer and is owned by FetchTasklet
    /// We always clone url and proxy (if informed)
    url_proxy_buffer: Box<[u8]>,
    url_len: usize,

    /// The context whose script called `fetch()`, and its `signal` option.
    pub(crate) abort_handle: jsc::AbortHandle,
    /// That context's id: the handle forgets its context once that stops.
    pub(crate) context: jsc::ContextId,
    pub(crate) signals: Signals,
    pub(crate) signal_store: http::signals::Store,
    pub(crate) has_schedule_callback: AtomicBool,

    // must be stored because AbortSignal stores reason weakly
    pub(crate) abort_reason: StrongOptional,

    // custom checkServerIdentity
    pub(crate) check_server_identity: StrongOptional,
    /// The `Bun.FetchSession` of this request, kept from being collected (and
    /// closing its pool) while the request can still park a socket there.
    pub(crate) fetch_session: Option<super::fetch_session::SessionHold>,
    /// The session has the callback, and holds it; `fetch_session` holds the session.
    pub(crate) session_check_server_identity: bool,
    pub(crate) reject_unauthorized: bool,
    pub(crate) upgraded_connection: bool,
    pub(crate) unix_socket_path: Box<[u8]>,
    pub(crate) is_waiting_body: bool,
    pub(crate) is_waiting_abort: bool,
    pub(crate) is_waiting_request_stream_start: bool,
    pub(crate) mutex: Mutex,

    pub(crate) tracker: AsyncTaskTracker,

    pub(crate) ref_count: bun_ptr::ThreadSafeRefCount<FetchTasklet>,
}

// Boxing `AnyBlob` is not viable: the `AnyBlob` arm is constructed/matched in
// `fetch.rs` (e.g. `HTTPRequestBodyExt::any_blob`) and would require changes
// across files. The enum is also short-lived per-request, so the size cost is bounded.
#[allow(clippy::large_enum_variant)]
pub(crate) enum HTTPRequestBody {
    AnyBlob(AnyBlob),
    Sendfile(http::SendFile),
    ReadableStream(ReadableStreamStrong),
}

impl Default for HTTPRequestBody {
    fn default() -> Self {
        // `Blob` has no `const EMPTY`
        // (non-Copy fields), so use the runtime `Default` instead of a const.
        HTTPRequestBody::AnyBlob(AnyBlob::Blob(Blob::default()))
    }
}

impl HTTPRequestBody {
    pub(crate) fn store(&self) -> Option<&BlobStore> {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.store(),
            _ => None,
        }
    }

    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.slice(),
            _ => b"",
        }
    }

    fn take_sendfile(&mut self) -> Option<http::SendFile> {
        if let HTTPRequestBody::Sendfile(_) = self
            && let HTTPRequestBody::Sendfile(sendfile) = core::mem::take(self)
        {
            return Some(sendfile);
        }
        None
    }

    pub(crate) fn from_js(cx: &bun_jsc::JsThread<'_>, value: JSValue) -> JsResult<HTTPRequestBody> {
        let mut body_value = BodyValue::from_js(cx.global(), value)?;
        if matches!(body_value, BodyValue::Used)
            || (matches!(&body_value, BodyValue::Locked(l) if !l.action.is_none() || l.is_disturbed2(cx.global())))
        {
            return Err(cx
                .global()
                .err(
                    jsc::ErrorCode::BODY_ALREADY_USED,
                    format_args!("body already used"),
                )
                .throw());
        }
        body_value.to_blob_if_in_memory();
        if let BodyValue::Locked(locked) = &mut body_value {
            if locked.readable.has() {
                return Ok(HTTPRequestBody::ReadableStream(core::mem::take(
                    &mut locked.readable,
                )));
            }
        }
        if matches!(&body_value, BodyValue::Locked(_)) {
            let readable = body_value.to_readable_stream(cx)?;
            if !readable.is_empty_or_undefined_or_null() {
                if let BodyValue::Locked(l) = &mut body_value {
                    if l.readable.has() {
                        return Ok(HTTPRequestBody::ReadableStream(core::mem::take(
                            &mut l.readable,
                        )));
                    }
                }
            }
        }
        Ok(HTTPRequestBody::AnyBlob(body_value.use_as_any_blob()))
    }

    pub(crate) fn needs_to_read_file(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.needs_to_read_file(),
            _ => false,
        }
    }

    pub(crate) fn is_s3(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.is_s3(),
            _ => false,
        }
    }

    pub(crate) fn has_content_type_from_user(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.has_content_type_from_user(),
            _ => false,
        }
    }

    pub(crate) fn get_any_blob(&mut self) -> Option<&mut AnyBlob> {
        match self {
            HTTPRequestBody::AnyBlob(blob) => Some(blob),
            _ => None,
        }
    }

    pub(crate) fn has_body(&mut self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.size() > 0,
            HTTPRequestBody::ReadableStream(stream) => stream.has(),
            HTTPRequestBody::Sendfile(_) => true,
        }
    }
}

jsc::impl_abort_handle_owner!(FetchTasklet, abort_handle, |this, cause| {
    // SAFETY: trait contract — `this` is live; JS thread.
    unsafe {
        match cause {
            jsc::AbortCause::Signal(reason) => (*this).abort_listener(reason),
            jsc::AbortCause::ContextStopped(jsc::StopReason::VmTeardown) => {
                (*this).abort_task();
                drop((*this).detach_native_request_body_sink());
            }
            // The VM keeps running, so the final progress update cancels the request body sink.
            jsc::AbortCause::ContextStopped(_) => (*this).abort_task(),
        }
    }
});

impl Drop for FetchTasklet {
    fn drop(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "deinit");
        self.ref_count.assert_no_refs();
        self.async_http_id = None;
        self.response.clear();
        self.native_response.set(None);
        self.clear_stream_handlers();
        self.fetch_session = None;
        self.clear_abort_signal();
        self.clear_sink();
    }
}

impl FetchTasklet {
    const HOLDS_REF: &str = "fetch on the HTTP thread holds a ref";

    /// Recover `&mut Self` from a type-erased `*mut c_void` callback context.
    ///
    /// INVARIANT: every callback that stores a `FetchTasklet*` as `ctx` (the
    /// readable-stream available/start-streaming hooks and the ByteStream
    /// cancel handler) holds one strong ref on the tasklet for the lifetime
    /// of the registration, and fires only on the JS thread — so the returned
    /// `&mut` is the sole live borrow.
    #[inline]
    fn from_ctx<'a>(ctx: NonNull<c_void>) -> &'a mut Self {
        // SAFETY: see INVARIANT above.
        unsafe { bun_ptr::callback_ctx::<FetchTasklet>(ctx.as_ptr()) }
    }

    /// Recover `&mut Self` from a `*mut FetchTasklet` callback arg.
    ///
    /// INVARIANT: every `*mut FetchTasklet` threaded through the HTTP-thread
    /// callback (`callback`), the drain hook (`on_write_request_data_drain` /
    /// `resume_request_data_stream`), and the JS-thread enqueue
    /// (`queue` → `node`) was produced by `heap::into_raw(Box<FetchTasklet>)`
    /// in `get()` and is kept alive by the intrusive `ref_count` until
    /// `drop`. Access on either thread is serialised: HTTP-thread writes
    /// happen under `mutex.lock()` and JS-thread access is single-threaded.
    #[inline]
    fn from_raw_mut<'a>(this: *mut FetchTasklet) -> &'a mut Self {
        // SAFETY: see INVARIANT above.
        unsafe { &mut *this }
    }
    /// Shared variant of [`from_raw_mut`].
    #[inline]
    fn from_raw_ref<'a>(this: *mut FetchTasklet) -> &'a Self {
        // SAFETY: see [`from_raw_mut`] INVARIANT.
        unsafe { &*this }
    }

    #[inline]
    fn abort_signal(&self) -> Option<&AbortSignal> {
        self.abort_handle.signal()
    }

    /// True iff an attached AbortSignal has fired.
    #[inline]
    pub(crate) fn signal_aborted(&self) -> bool {
        self.abort_signal().is_some_and(|s| s.aborted())
    }

    /// Mutable access to the request-body sink while `self.sink` is `Some`
    /// (owned allocation from `start_request_stream` until `clear_sink`).
    #[inline]
    pub(crate) fn sink_mut(&mut self) -> Option<&mut FetchRequestBodySink> {
        // SAFETY: owned by `self`, and JS-thread-only.
        self.sink.as_ref().map(|p| unsafe { &mut *p.as_ptr() })
    }

    /// HTTP thread only.
    fn ticket(&self) -> &jsc::Ticket {
        &self.http_ref.as_ref().expect(Self::HOLDS_REF).ticket
    }

    fn take_request_stream_ref(&mut self) -> Option<RefPtr<Self>> {
        self.sink_mut()?.task.take()
    }

    fn clear_sink(&mut self) {
        if let Some(owned) = self.sink.take() {
            // SAFETY: JS thread; the controller's back-pointer is cleared by `detach` below.
            let sink = unsafe { &mut *owned.as_ptr() };
            let _stream_ref = sink.task.take();
            // `detach` may fire the controller's onClose; every terminal path
            // here has already cleared it, so this just detaches the controller.
            sink.source.detach(&self.global_this);
        }
        if let Some(buffer) = self.request_body_streaming_buffer.take() {
            // The HTTP thread may still be using its ref; `clear_drain_callback`
            // synchronises with it through the buffer's mutex.
            buffer.clear_drain_callback();
        }
    }

    /// `HTTPClientResultCallback::release_at_shutdown` for `FetchTasklet`.
    /// Called from `dealloc_in_flight_for_exit` on the HTTP thread for each
    /// request still in `in_flight` when `process.exit()` interrupts it.
    /// `queue()` left two refs (`js_ref` and `http_ref`); the final
    /// `callback`'s deref and `on_progress_update`'s JS-side deref will never
    /// run, so this must balance both — but only when no `on_progress_update`
    /// is already parked in the parent's concurrent queue.
    ///
    /// The `has_schedule_callback` flag distinguishes the two states:
    ///   * `false` — nothing queued. Drop both refs here; the last one hops
    ///     `deinit` to the JS thread, which teardown runs from its queue release.
    ///   * `true` — a non-final `on_progress_update` is queued (this entry is
    ///     still in `in_flight`, so the *final* `callback` hasn't run). That
    ///     queued node needs `js_ref` and its VM releases it from its
    ///     queue; dropping it here too would leave the queued node pointing at
    ///     a freed `FetchTasklet`. Drop only the HTTP-side ref.
    ///
    /// Only reachable for a request whose VM has *not* torn down (a worker
    /// still running when the main thread exits): a VM's teardown waits for its
    /// fetches' tickets — i.e. for their final callback — before the exiting
    /// main thread parks the HTTP thread. `has_schedule_callback` is written by
    /// the HTTP-thread `callback` and the JS-thread `on_progress_update` under
    /// its own compare-exchange discipline, which this load relies on.
    ///
    /// SAFETY: `this` is the live `*mut FetchTasklet` registered as
    /// `result_callback.ctx` in `get()`; HTTP-thread-only at this point.
    unsafe fn release_at_shutdown(this: *mut ()) {
        let this = this.cast::<FetchTasklet>();
        // Free the body-bytes buffer the same way the `is_shutting_down`
        // branch in `callback` does (no JS-thread drain will reclaim it).
        // SAFETY: caller contract — `this` is live and HTTP-thread-exclusive.
        let queued_progress_update =
            unsafe { (*this).has_schedule_callback.load(Ordering::Acquire) };
        // SAFETY: caller contract — `this` is live and HTTP-thread-exclusive.
        unsafe {
            (*this).scheduled_response_buffer = MutableString::default();
            let _http_ref = (*this).http_ref.take().expect(Self::HOLDS_REF);
            if !queued_progress_update {
                // Not the last ref: `_http_ref` is still held.
                (*this).js_ref = None;
            }
        }
    }

    fn start_request_stream(&mut self) -> JsResult<()> {
        self.is_waiting_request_stream_start = false;
        debug_assert!(matches!(
            self.request_body,
            HTTPRequestBody::ReadableStream(_)
        ));
        let HTTPRequestBody::ReadableStream(ref stream_ref) = self.request_body else {
            return Ok(());
        };
        let Some(stream) = stream_ref.get() else {
            return Ok(());
        };
        if self.signal_aborted() {
            return stream.abort(&self.global_this);
        }

        let global_this = self.global_this;
        if stream.is_locked(&global_this) || stream.is_disturbed(&global_this) {
            let err = jsc::SystemError {
                code: BunString::static_(<&'static str>::from(
                    jsc::ErrorCode::ERR_STREAM_CANNOT_PIPE,
                )),
                message: BunString::static_("Stream already used, please create a new one"),
                ..Default::default()
            };
            let err_instance = err.to_error_instance(&global_this);
            err_instance.ensure_still_alive();
            self.write_end_request(Some(err_instance));
            return Ok(());
        }

        let self_ptr = std::ptr::from_mut::<FetchTasklet>(self);
        let owned = self.sink.insert(AliasableBox::new(FetchRequestBodySink {
            // SAFETY: `self` is the live heap tasklet.
            task: Some(unsafe { RefPtr::init_ref(self_ptr) }),
            high_water_mark: 16384,
            ..Default::default()
        }));
        // SAFETY: just allocated, and freed by `clear_sink` after its last use here.
        let sink = unsafe { &mut *owned.as_ptr() };
        let sink_handle = SinkHandle::FetchRequestBody(bun_ptr::BackRef::new_mut(sink));

        // Native ByteStream/FileReader fast-path: wire the SinkHandle
        // directly, skipping the JS pump.
        match stream.wire_native_sink(&global_this, sink_handle, JSValue::UNDEFINED, |src| {
            sink.source = src;
        }) {
            crate::webcore::readable_stream::NativeWireResult::Wired => return Ok(()),
            crate::webcore::readable_stream::NativeWireResult::EndedInline(err) => {
                // The state that `end_from_stream` leaves it in.
                sink.ended = true;
                sink.source.clear();
                let _stream_ref = sink.task.take();
                let err_js = err.map(|err| {
                    let err_js = err.to_js(&global_this);
                    err_js.ensure_still_alive();
                    err_js
                });
                self.write_end_request(err_js);
                return Ok(());
            }
            crate::webcore::readable_stream::NativeWireResult::NotNative => {}
        }

        let assignment_result = ReadableSinkController::assign_to_stream(
            &global_this,
            stream.value,
            core::ptr::NonNull::from(&mut *sink),
        );
        assignment_result.ensure_still_alive();

        if let Some(err) = assignment_result.to_error() {
            self.write_end_request(Some(err));
            self.clear_sink();
            return Ok(());
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    bun_jsc::js_promise::Status::Pending => {
                        assignment_result.then(
                            &global_this,
                            self_ptr,
                            Bun__FetchTasklet__onResolveRequestStream,
                            Bun__FetchTasklet__onRejectRequestStream,
                        );
                    }
                    bun_jsc::js_promise::Status::Fulfilled => {
                        let _stream_ref = sink.task.take();
                        self.write_end_request(None);
                    }
                    bun_jsc::js_promise::Status::Rejected => {
                        promise.set_handled(global_this.vm());
                        let result = promise.result(global_this.vm());
                        let _stream_ref = sink.task.take();
                        self.write_end_request(Some(result));
                    }
                }
                return Ok(());
            }
        }

        // undefined/null: the stream drained synchronously inside assignToStream.
        let _stream_ref = sink.task.take();
        self.write_end_request(None);
        Ok(())
    }

    fn on_body_received(&mut self) -> JsResult<()> {
        // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
        let mut buffer_reset = true;
        // The reset must run on `?` failure paths too.
        let result = self.deliver_body(&mut buffer_reset);
        if buffer_reset {
            let list = &mut self.scheduled_response_buffer.list;
            if list.capacity() > http::DECODED_BODY_RETAIN_CAP {
                *list = Vec::new();
            } else {
                list.clear();
            }
        }
        result
    }

    /// Clears `buffer_reset` where `scheduled_response_buffer` must keep its bytes.
    fn deliver_body(&mut self, buffer_reset: &mut bool) -> JsResult<()> {
        let success = self.result.is_success();
        let global_this = self.global_this;
        bun_output::scoped_log!(
            FetchTasklet,
            "onBodyReceived success={} has_more={}",
            success,
            self.result.has_more
        );

        if !success {
            let mut err = self.on_reject();
            let mut js_err = JSValue::ZERO;
            // if we are streaming update with error
            if let Some(bytes) = self.response_stream.take() {
                js_err = err.to_js(&global_this);
                js_err.ensure_still_alive();
                bytes.on_data(StreamResult::Err(StreamError::JSValue(
                    bun_jsc::strong::Optional::create(js_err, &global_this),
                )));
            }
            // A failure result is terminal (only `InFlightRequest::finish`
            // reports `fail`), so everything pending must settle
            // here: a still-streaming request-body sink does not exempt the
            // response body. Returning right after `sink.cancel()` used to
            // leave a buffered `arrayBuffer()`/`text()` promise pending
            // forever when a fetch with an in-flight streaming request body
            // was aborted mid-response.
            if self.sink_mut().is_some() && js_err.is_empty() {
                js_err = err.to_js(&global_this);
                js_err.ensure_still_alive();
            }
            // if we are buffering resolve the promise
            if let Some(response) = self.native_response.get().as_deref() {
                // body value now owns the error
                let body = response.get_body_value();
                body.to_error_instance(err, &global_this)?;
            }
            // Cancel the request-body sink last: closing the sink signal fires
            // the controller's onClose synchronously, which can re-enter the
            // tasklet.
            if !js_err.is_empty() {
                self.cancel_request_body_sink(js_err);
            }
            return Ok(());
        }

        // body can be marked as used but we still need to pipe the data
        if !self.result.has_more {
            // Unhook before the final delivery so it cannot signal a producer that is done;
            // release after it so the bytes land in memory we still pin.
            if let Some(bytes) = self.response_stream.take() {
                bun_output::scoped_log!(FetchTasklet, "onBodyReceived response_stream done");
                bytes.size_hint.set(self.get_size_hint());
                *buffer_reset = false;
                let chunk = self.scheduled_response_buffer.list.as_slice();
                bytes.on_data(StreamResult::TemporaryAndDone(chunk));
                return Ok(());
            }
        } else if let Some(bytes) = self.response_stream.bytes() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived response_stream");
            bytes.size_hint.set(self.get_size_hint());
            let chunk = self.scheduled_response_buffer.list.as_slice();
            bytes.on_data(StreamResult::Temporary(chunk));
            if self.response_stream.is_held() {
                self.after_body_chunk_delivered(&bytes);
            }
            return Ok(());
        }

        if let Some(response) = self.native_response.get().as_deref() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived Current Response");
            let size_hint = self.get_size_hint();
            response.set_size_hint(size_hint);
            if let Some(readable) = response.get_body_readable_stream() {
                bun_output::scoped_log!(
                    FetchTasklet,
                    "onBodyReceived CurrentResponse BodyReadableStream"
                );
                if let Some(bytes) = readable.ptr.bytes() {
                    let chunk = self.scheduled_response_buffer.list.as_slice();

                    if self.result.has_more {
                        bytes.on_data(StreamResult::Temporary(chunk));
                    } else {
                        readable.value.ensure_still_alive();
                        response.detach_readable_stream(&global_this);
                        bytes.on_data(StreamResult::TemporaryAndDone(chunk));
                    }

                    return Ok(());
                }
            }

            let body = response.get_body_value();
            // `BodyAbortListener::on_abort` may have set `Error` while this
            // callback was queued; checked before `buffer_reset` is cleared so
            // the caller still drops the bytes.
            if !matches!(body, BodyValue::Locked(_)) {
                return Ok(());
            }
            // we will reach here when not streaming, this is also the only case we dont wanna to reset the buffer
            *buffer_reset = false;
            if !self.result.has_more {
                let scheduled_response_buffer =
                    core::mem::take(&mut self.scheduled_response_buffer.list);
                // done resolve body
                let old = core::mem::replace(
                    body,
                    BodyValue::InternalBlob(InternalBlob {
                        bytes: scheduled_response_buffer,
                        was_string: false,
                    }),
                );
                bun_output::scoped_log!(
                    FetchTasklet,
                    "onBodyReceived body_value length={}",
                    match body {
                        BodyValue::InternalBlob(b) => b.bytes.len(),
                        _ => 0,
                    }
                );

                self.scheduled_response_buffer = MutableString::default();

                if matches!(old, BodyValue::Locked(_)) {
                    bun_output::scoped_log!(FetchTasklet, "onBodyReceived old.resolve");
                    let mut old = old;
                    // BodyValue::resolve takes `Option<NonNull<FetchHeaders>>` (opaque C++ handle
                    // mutated via FFI); the inherent `get_fetch_headers` returns `Option<&_>`, so
                    // erase the borrow into a raw NonNull. Disjoint from `body` (response.init vs
                    // response.body) and outlives this block.
                    let headers = response.get_fetch_headers().map(core::ptr::NonNull::from);
                    let context = self.global_this.bun_vm().context_of(self.context);
                    BodyValue::resolve(
                        &mut old,
                        body,
                        &self.global_this.js_thread(context),
                        headers,
                    )?;
                }
            }
        }
        Ok(())
    }

    /// SAFETY: `this` is the tasklet of a posted update. The last update may free it.
    pub(crate) unsafe fn on_progress_update(this: *mut Self) -> JsResult<()> {
        jsc::mark_binding!();
        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate");
        // SAFETY: fn contract; `_js_ref` outlives the last use of `this`.
        unsafe {
            let vm = (*this).global_this.bun_vm();
            // The response, the upload's pump and what they settle continue the script that fetched.
            let _context = vm.enter_context((*this).context);
            let lock = (*this).mutex.lock_guard();
            (*this)
                .has_schedule_callback
                .store(false, Ordering::Relaxed);
            let is_done = !(*this).result.has_more;
            let _js_ref = if is_done { (*this).js_ref.take() } else { None };
            (*this).update_progress(vm, lock, is_done)
        }
    }

    fn update_progress(
        &mut self,
        vm: &VirtualMachine,
        lock: MutexGuard,
        is_done: bool,
    ) -> JsResult<()> {
        // teardown forbade script: we cannot touch JS
        if !vm.script_allowed() {
            // The certificate will never be checked; release the parked
            // HTTP-thread socket instead of leaving it occupying an active
            // request slot until the idle timeout.
            if self.result.certificate_info.take().is_some() {
                if let Some(id) = self.async_http_id {
                    http::HTTPThread::schedule_shutdown(id);
                }
            }
            return Ok(());
        }

        if self.is_waiting_request_stream_start && self.result.can_stream {
            // Fails only if the VM is being stopped.
            self.start_request_stream()?;
            // Makes wpt-h2 number-chunk test deterministic.
            // `assign_to_stream` kicks off `await reader.read()`; an invalid
            // chunk type (e.g. a JS number) throws inside `sink.write` and lands in
            // `writeEndRequest` → `abort_reason` on the next microtask. Drain now so the
            // abort is observable below before we commit to resolving the Response.
            //
            // Only drain when this same progress tick would otherwise *resolve* the
            // promise (i.e. response metadata is already present). On the common
            // can_stream-only first progress (`metadata == None`) we early-return
            // right below anyway.
            //
            // Drain ONLY the JSC microtask queue, NOT Bun's `EventLoop::drain_microtasks`:
            // that additionally runs `release_weak_refs` + `deferred_tasks.run()`,
            // which is observable in `fetch-leak-test-fixture-5.js`'s post-batch
            // `heapStats().Promise` count for the streaming-body cases when a fast
            // loopback coalesces `can_stream` and `metadata` into one callback —
            // pushed the count over its 35-object threshold (#53208/#53214 flaky).
            // The JSC-only drain is `&self`, runs just promise reactions (sufficient
            // for the queued `endSink(err)` to land in `write_end_request` →
            // `abort_reason`), and leaves the Bun event loop untouched.
            if self.metadata.is_some() && !self.is_waiting_body {
                vm.jsc_vm().drain_microtasks();
            }
        }

        let result = self.deliver_progress(vm);
        drop(lock);
        if is_done {
            // The HTTP layer will not drain the request body again.
            self.cancel_request_body_sink(JSValue::UNDEFINED);
            self.poll_ref.unref(bun_io::js_vm_ctx());
        }
        result
    }

    fn deliver_progress(&mut self, vm: &VirtualMachine) -> JsResult<()> {
        let global_this = self.global_this;
        // if we already respond the metadata and still need to process the body
        if self.is_waiting_body {
            // `scheduled_response_buffer` has two readers that both drain-and-reset:
            // this path (onBodyReceived) and `onStartStreamingHTTPResponseBodyCallback`,
            // which runs once when JS first touches `res.body` and hands any already-
            // buffered bytes to the new ByteStream synchronously.
            //
            // That creates a stale-task race:
            //   1. HTTP thread `callback()` writes N bytes to the buffer and enqueues
            //      this onProgressUpdate task (under mutex).
            //   2. Main thread: JS touches `res.body` -> `onStartStreaming` drains those
            //      N bytes and resets the buffer (under mutex).
            //   3. This task runs and finds the buffer empty.
            //
            // The task cannot be un-enqueued in step 2, and at schedule time (step 1)
            // the buffer was non-empty, so the only place the staleness is observable
            // is here when the task runs.
            //
            // Without this guard, `onBodyReceived` would call `ByteStream.onData` with
            // a zero-length non-terminal chunk. That resolves the reader's pending
            // pull with `len=0`; `native-readable.ts` `handleNumberResult(0)` does not
            // `push()`, so node:stream `state.reading` (set before the previous `_read()`
            // early-returned on `kPendingRead`) is never cleared, `_read()` is never
            // called again, and `pipeline(Readable.fromWeb(res.body), ...)` stalls
            // forever — eventually spinning at 100% CPU once `poll_ref` unrefs.
            if self.scheduled_response_buffer.list.is_empty()
                && self.result.has_more
                && self.result.is_success()
            {
                return Ok(());
            }
            return self.on_body_received();
        }
        // Run the user-supplied `checkServerIdentity` callback as soon as the
        // certificate arrives. The HTTP thread parks the connection after the
        // TLS handshake (`is_waiting_for_cert_check`) and does not transmit
        // the request until this check passes, so this block must run BEFORE
        // the metadata-less early return below — the parked connection's
        // first progress update carries only the certificate (no metadata, no
        // failure) and would otherwise be dropped, leaving the socket parked
        // until the idle timeout.
        if let Some(certificate_info) = self.result.certificate_info.take() {
            // With `rejectUnauthorized: false` the callback still runs, like
            // Node's, but its verdict is not enforced.
            let verdict = self.run_check_server_identity(&certificate_info);
            if self.reject_unauthorized && !self.enforce_server_identity_verdict(verdict) {
                bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: aborted due certError");
                drop(certificate_info);
                // `check_server_identity` already set abort_reason / aborted /
                // result.fail and scheduled the shutdown of the parked
                // socket; all that is left is rejecting the promise.
                let promise_value = self.promise.value_or_empty();
                if promise_value.is_empty_or_undefined_or_null() {
                    bun_output::scoped_log!(
                        FetchTasklet,
                        "onProgressUpdate: promise_value is null"
                    );
                    self.promise = jsc::JSPromiseStrong::empty();
                    return Ok(());
                }
                // we need to abort the request
                let promise = promise_value.as_any_promise().unwrap();
                let tracker = self.tracker;
                let mut result = self.on_reject();

                promise_value.ensure_still_alive();
                let r = promise.reject_with_async_stack(&global_this, result.to_js(&global_this));
                drop(result);

                tracker.did_dispatch(&global_this);
                self.promise = jsc::JSPromiseStrong::empty();
                return r;
            }
            drop(certificate_info);
            // checkServerIdentity passed: un-park the HTTP-thread connection
            // so the request is finally written to the now-verified peer. If
            // the connection already closed/failed the resume is a no-op
            // (keyed through the abort tracker).
            if let Some(id) = self.async_http_id {
                http::HTTPThread::schedule_cert_check_resume(id);
            }
            // Fall through. The common case (certificate-only update) returns
            // at the metadata-less early return below; the #27275 coalesced
            // case — the connection failed after the handshake but before
            // response headers arrived, so the certificate_info from the
            // first progress update was merged into the later failure result
            // — falls through to the reject logic with `result.fail` set.
        }

        if self.metadata.is_none() && self.result.is_success() {
            return Ok(());
        }

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit
        if self.is_waiting_abort {
            return Ok(());
        }
        let promise_value = self.promise.value_or_empty();

        if promise_value.is_empty_or_undefined_or_null() {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is null");
            self.promise = jsc::JSPromiseStrong::empty();
            return Ok(());
        }

        // WHATWG fetch: once the response head is available the promise
        // resolves; post-head failures (body decompression etc.) surface on
        // the body reader regardless of whether head+body arrived in one read.
        let success = self.result.is_success() || self.metadata.is_some();

        // Paired with the microtask drain after
        // startRequestStream above: the request-body sink may have set `abort_reason`
        // via writeEndRequest while the HTTP result is still a success — server HEADERS
        // raced ahead of the scheduled shutdown. Reject with that reason instead of
        // resolving a 200 Response. Makes wpt-h2 number-chunk test deterministic.
        if success && self.abort_reason.has() {
            let promise = promise_value.as_any_promise().unwrap();
            let tracker = self.tracker;
            // get_abort_error consumes abort_reason and clears the signal handler.
            let mut err = self.get_abort_error().unwrap();
            promise_value.ensure_still_alive();
            let r = promise.reject_with_async_stack(&global_this, err.to_js(&global_this));
            drop(err);
            tracker.did_dispatch(&global_this);
            self.promise = jsc::JSPromiseStrong::empty();
            return r;
        }

        let tracker = self.tracker;
        tracker.will_dispatch(&global_this);
        let dispatch_cleanup = |_this: &mut FetchTasklet| {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is not null");
            tracker.did_dispatch(&global_this);
        };

        let result = if success {
            let resolved = self.on_resolve();
            // Cancel the request-body sink last (as on_body_received does):
            // closing the sink signal runs the user's cancel callback
            // synchronously, so the body error must already be stored.
            if self.result.fail.is_some() && self.sink_mut().is_some() {
                let mut err = self.on_reject();
                let err_js = err.to_js(&global_this);
                err_js.ensure_still_alive();
                self.cancel_request_body_sink(err_js);
            }
            StrongOptional::create(resolved, &global_this)
        } else {
            // in this case we wanna a jsc.Strong.Optional so we just convert it
            let mut value = self.on_reject();
            let err_js = value.to_js(&global_this);
            self.cancel_request_body_sink(err_js);
            // `to_js` leaves `value` in the `JSValue(Strong)` state. Move
            // that Strong out instead of allocating a
            // second one.
            let BodyValueError::JSValue(strong) = value else {
                unreachable!("ValueError::to_js leaves self in JSValue state");
            };
            strong
        };

        promise_value.ensure_still_alive();

        let holder = Box::new(FetchTaskletPromiseSettle {
            held: result,
            // we need the promise to be alive until the task is done
            promise: self.promise.take(),
            global_object: global_this,
            success,
            context: self.context,
        });
        vm.event_loop().enqueue_task(Task::from_boxed(holder));

        dispatch_cleanup(self);
        Ok(())
    }

    /// `Ok` when the callback approved the certificate; `Err(Some(error))`
    /// with the reason when it did not; `Err(None)` when there was no
    /// certificate to show it.
    fn run_check_server_identity(
        &mut self,
        certificate_info: &CertificateInfo,
    ) -> Result<(), Option<JSValue>> {
        let Some(check_server_identity) = self.check_server_identity_callback() else {
            return Err(None);
        };
        check_server_identity.ensure_still_alive();
        if certificate_info.cert.is_empty() {
            return Err(None);
        }
        let mut x509 = OwnedX509::from_der(&certificate_info.cert).ok_or(None)?;
        let global_object = self.global_this;
        let js_cert = X509::to_js(&mut x509, &global_object)
            .map_err(|e| Some(global_object.take_exception(e)))?;
        let js_hostname: JSValue =
            bun_string_jsc::create_utf8_for_js(&global_object, &certificate_info.hostname)
                .map_err(|e| Some(global_object.take_exception(e)))?;
        js_hostname.ensure_still_alive();
        js_cert.ensure_still_alive();
        let check_result = match check_server_identity.call(
            &global_object,
            JSValue::UNDEFINED,
            &[js_hostname, js_cert],
        ) {
            Ok(v) => v,
            Err(e) => return Err(Some(global_object.take_exception(e))),
        };

        // > Returns <Error> object [...] on failure
        // Any object counts: a DOMException or a util.inherits() error is not an ErrorInstance cell.
        if check_result.is_object() && check_result.as_any_promise().is_none() {
            return Err(Some(check_result));
        }
        // Like Node, fail on any other truthy value, a Promise included: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1671-L1688
        if check_result.to_boolean() {
            let received = JSGlobalObject::determine_specific_type(&global_object, check_result)
                .map_err(|e| Some(global_object.take_exception(e)))?;
            return Err(Some(
                global_object
                    .err(
                        jsc::ErrorCode::INVALID_RETURN_VALUE,
                        format_args!(
                            "Expected undefined or an Error to be returned from the \"tls.checkServerIdentity\" function but got {received}."
                        ),
                    )
                    .to_js(),
            ));
        }
        // > On success, returns <undefined>
        Ok(())
    }

    /// Fail the request for a rejected certificate. Returns whether it may proceed.
    fn enforce_server_identity_verdict(&mut self, verdict: Result<(), Option<JSValue>>) -> bool {
        match verdict {
            Ok(()) => true,
            Err(Some(reason)) => {
                let global_object = self.global_this;
                // mark to wait until deinit
                self.is_waiting_abort = self.result.has_more;
                self.abort_reason.set(&global_object, reason);
                self.abort_task();
                self.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
                false
            }
            Err(None) => {
                // Every false return must have scheduled the parked socket's shutdown.
                if let Some(id) = self.async_http_id {
                    http::HTTPThread::schedule_shutdown(id);
                }
                self.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
                false
            }
        }
    }

    /// The request's own `checkServerIdentity`, else its session's.
    fn check_server_identity_callback(&self) -> Option<JSValue> {
        self.check_server_identity.get().or_else(|| {
            if !self.session_check_server_identity {
                return None;
            }
            self.fetch_session.as_ref()?.check_server_identity()
        })
    }

    fn get_abort_error(&mut self) -> Option<BodyValueError> {
        if self.abort_reason.has() {
            let out = core::mem::replace(&mut self.abort_reason, StrongOptional::empty());
            self.clear_abort_signal();
            return Some(BodyValueError::JSValue(out));
        }

        if let Some(signal) = self.abort_signal() {
            if let Some(reason) = signal.reason_if_aborted(&self.global_this) {
                // `AbortReason::to_body_value_error` lives in bun_jsc but
                // would forward-depend on bun_runtime; reconstruct the trivial
                // mapping at the call site (per AbortSignal.rs note).
                let out = match reason {
                    jsc::abort_signal::AbortReason::Common(r) => BodyValueError::AbortReason(r),
                    jsc::abort_signal::AbortReason::Js(v) => {
                        BodyValueError::JSValue(StrongOptional::create(v, &self.global_this))
                    }
                };
                self.clear_abort_signal();
                return Some(out);
            }
        }

        None
    }

    fn clear_abort_signal(&mut self) {
        self.abort_handle.unfollow();
    }

    fn on_reject(&mut self) -> BodyValueError {
        debug_assert!(self.result.fail.is_some());
        bun_output::scoped_log!(FetchTasklet, "onReject");

        if let Some(err) = self.get_abort_error() {
            return err;
        }

        if let Some(reason) = self.result.abort_reason() {
            return BodyValueError::AbortReason(reason);
        }

        let fail = self.result.fail.unwrap();

        if fail == http::Error::RequestBodyNotReusable {
            return BodyValueError::TypeError(BunString::static_(
                "Request body is a ReadableStream and cannot be replayed for this redirect",
            ));
        }

        if fail == http::Error::ProxyConnectFailed {
            if let Some(metadata) = &self.result.proxy_connect_response {
                let global_this = self.global_this;
                let error = Self::proxy_connect_error(&global_this, metadata)
                    .unwrap_or_else(|e| global_this.take_exception(e));
                return BodyValueError::JSValue(StrongOptional::create(error, &global_this));
            }
        }

        if fail == http::Error::RequestBodyLengthMismatch
            && let Some(declared) = self.declared_request_body_len
        {
            let written = self.request_body_len_written;
            let err = self
                .global_this
                .err(
                    jsc::ErrorCode::ERR_HTTP_CONTENT_LENGTH_MISMATCH,
                    format_args!(
                        "Request body of {written} bytes does not match the Content-Length of {declared}"
                    ),
                )
                .to_js();
            return BodyValueError::JSValue(StrongOptional::create(err, &self.global_this));
        }

        // some times we don't have metadata so we also check the request's URL
        // Without the URL's userinfo: errors get logged.
        let href = match &self.metadata {
            Some(metadata) => metadata.url(),
            None => &self.url_proxy_buffer[..self.url_len],
        };
        let path = BunString::clone_utf8(&ZigURL::parse(href).href_without_userinfo());

        // The hostname never resolved: report the resolver error (`ENOTFOUND`,
        // ...) with `syscall`/`hostname`, the same shape `node:dns` produces,
        // rather than a generic connect-failure message. `dns_error` is the
        // raw getaddrinfo(3) code and is nonzero on this path, so `init_eai`
        // is always `Some`.
        if fail == http::Error::DNSResolveFailed {
            if let Some(dns_err) = c_ares::Error::init_eai(self.result.dns_error) {
                // `dns_hostname` is the owned copy of the exact name the
                // connect resolved (proxy or post-redirect target), captured
                // on the HTTP thread.
                let hostname: &[u8] = self.result.dns_hostname.as_deref().unwrap_or(b"");
                let mut err = crate::dns_jsc::cares_jsc::system_error_with_syscall_and_hostname(
                    dns_err,
                    b"getaddrinfo",
                    hostname,
                );
                err.path = path;
                return BodyValueError::SystemTypeError(err);
            }
        }

        // Socket-level failures carry the errno name `node:net` would report.
        let code: &'static str = match fail {
            http::Error::ConnectionClosed => "ECONNRESET",
            http::Error::Timeout => "ETIMEDOUT",
            http::Error::ConnectionRefused => self.connect_errno_name().unwrap_or("ECONNREFUSED"),
            http::Error::FailedToOpenSocket => {
                self.connect_errno_name().unwrap_or_else(|| fail.name())
            }
            http::Error::TLSHandshakeFailed => "EPROTO",
            _ => fail.name(),
        };

        let message = match fail {
            http::Error::ConnectionClosed => BunString::create_format(format_args!(
                "{code}: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
            )),
            http::Error::FailedToOpenSocket => BunString::create_format(format_args!(
                "{code}: Was there a typo in the url or port?"
            )),
            http::Error::TooManyRedirects => BunString::create_format(format_args!(
                "{code}: The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()",
            )),
            http::Error::ConnectionRefused => BunString::create_format(format_args!(
                "{code}: Unable to connect. Is the computer able to access the url?"
            )),
            http::Error::TLSHandshakeFailed => BunString::create_format(format_args!(
                "{code}: The TLS handshake failed. Does the server speak TLS on this port?"
            )),
            http::Error::RedirectURLInvalid => BunString::create_format(format_args!(
                "{code}: Redirect URL in Location header is invalid."
            )),

            http::Error::Cert(http::CertError::UNABLE_TO_GET_ISSUER_CERT) => {
                BunString::static_("unable to get issuer certificate")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_GET_CRL) => {
                BunString::static_("unable to get certificate CRL")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_DECRYPT_CERT_SIGNATURE) => {
                BunString::static_("unable to decrypt certificate's signature")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_DECRYPT_CRL_SIGNATURE) => {
                BunString::static_("unable to decrypt CRL's signature")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY) => {
                BunString::static_("unable to decode issuer public key")
            }
            http::Error::Cert(http::CertError::CERT_SIGNATURE_FAILURE) => {
                BunString::static_("certificate signature failure")
            }
            http::Error::Cert(http::CertError::CRL_SIGNATURE_FAILURE) => {
                BunString::static_("CRL signature failure")
            }
            http::Error::Cert(http::CertError::CERT_NOT_YET_VALID) => {
                BunString::static_("certificate is not yet valid")
            }
            http::Error::Cert(http::CertError::CRL_NOT_YET_VALID) => {
                BunString::static_("CRL is not yet valid")
            }
            http::Error::Cert(http::CertError::CERT_HAS_EXPIRED) => {
                BunString::static_("certificate has expired")
            }
            http::Error::Cert(http::CertError::CRL_HAS_EXPIRED) => {
                BunString::static_("CRL has expired")
            }
            http::Error::Cert(http::CertError::ERROR_IN_CERT_NOT_BEFORE_FIELD) => {
                BunString::static_("format error in certificate's notBefore field")
            }
            http::Error::Cert(http::CertError::ERROR_IN_CERT_NOT_AFTER_FIELD) => {
                BunString::static_("format error in certificate's notAfter field")
            }
            http::Error::Cert(http::CertError::ERROR_IN_CRL_LAST_UPDATE_FIELD) => {
                BunString::static_("format error in CRL's lastUpdate field")
            }
            http::Error::Cert(http::CertError::ERROR_IN_CRL_NEXT_UPDATE_FIELD) => {
                BunString::static_("format error in CRL's nextUpdate field")
            }
            http::Error::Cert(http::CertError::OUT_OF_MEM) => BunString::static_("out of memory"),
            http::Error::Cert(http::CertError::DEPTH_ZERO_SELF_SIGNED_CERT) => {
                BunString::static_("self signed certificate")
            }
            http::Error::Cert(http::CertError::SELF_SIGNED_CERT_IN_CHAIN) => {
                BunString::static_("self signed certificate in certificate chain")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_GET_ISSUER_CERT_LOCALLY) => {
                BunString::static_("unable to get local issuer certificate")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_VERIFY_LEAF_SIGNATURE) => {
                BunString::static_("unable to verify the first certificate")
            }
            http::Error::Cert(http::CertError::CERT_CHAIN_TOO_LONG) => {
                BunString::static_("certificate chain too long")
            }
            http::Error::Cert(http::CertError::CERT_REVOKED) => {
                BunString::static_("certificate revoked")
            }
            http::Error::Cert(http::CertError::INVALID_CA) => {
                BunString::static_("invalid CA certificate")
            }
            http::Error::Cert(http::CertError::INVALID_NON_CA) => {
                BunString::static_("invalid non-CA certificate (has CA markings)")
            }
            http::Error::Cert(http::CertError::PATH_LENGTH_EXCEEDED) => {
                BunString::static_("path length constraint exceeded")
            }
            http::Error::Cert(http::CertError::PROXY_PATH_LENGTH_EXCEEDED) => {
                BunString::static_("proxy path length constraint exceeded")
            }
            http::Error::Cert(http::CertError::PROXY_CERTIFICATES_NOT_ALLOWED) => {
                BunString::static_(
                    "proxy certificates not allowed, please set the appropriate flag",
                )
            }
            http::Error::Cert(http::CertError::INVALID_PURPOSE) => {
                BunString::static_("unsupported certificate purpose")
            }
            http::Error::Cert(http::CertError::CERT_UNTRUSTED) => {
                BunString::static_("certificate not trusted")
            }
            http::Error::Cert(http::CertError::CERT_REJECTED) => {
                BunString::static_("certificate rejected")
            }
            http::Error::Cert(http::CertError::APPLICATION_VERIFICATION) => {
                BunString::static_("application verification failure")
            }
            http::Error::Cert(http::CertError::SUBJECT_ISSUER_MISMATCH) => {
                BunString::static_("subject issuer mismatch")
            }
            http::Error::Cert(http::CertError::AKID_SKID_MISMATCH) => {
                BunString::static_("authority and subject key identifier mismatch")
            }
            http::Error::Cert(http::CertError::AKID_ISSUER_SERIAL_MISMATCH) => {
                BunString::static_("authority and issuer serial number mismatch")
            }
            http::Error::Cert(http::CertError::KEYUSAGE_NO_CERTSIGN) => {
                BunString::static_("key usage does not include certificate signing")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_GET_CRL_ISSUER) => {
                BunString::static_("unable to get CRL issuer certificate")
            }
            http::Error::Cert(http::CertError::UNHANDLED_CRITICAL_EXTENSION) => {
                BunString::static_("unhandled critical extension")
            }
            http::Error::Cert(http::CertError::KEYUSAGE_NO_CRL_SIGN) => {
                BunString::static_("key usage does not include CRL signing")
            }
            http::Error::Cert(http::CertError::KEYUSAGE_NO_DIGITAL_SIGNATURE) => {
                BunString::static_("key usage does not include digital signature")
            }
            http::Error::Cert(http::CertError::UNHANDLED_CRITICAL_CRL_EXTENSION) => {
                BunString::static_("unhandled critical CRL extension")
            }
            http::Error::Cert(http::CertError::INVALID_EXTENSION) => {
                BunString::static_("invalid or inconsistent certificate extension")
            }
            http::Error::Cert(http::CertError::INVALID_POLICY_EXTENSION) => {
                BunString::static_("invalid or inconsistent certificate policy extension")
            }
            http::Error::Cert(http::CertError::NO_EXPLICIT_POLICY) => {
                BunString::static_("no explicit policy")
            }
            http::Error::Cert(http::CertError::DIFFERENT_CRL_SCOPE) => {
                BunString::static_("Different CRL scope")
            }
            http::Error::Cert(http::CertError::UNSUPPORTED_EXTENSION_FEATURE) => {
                BunString::static_("Unsupported extension feature")
            }
            http::Error::Cert(http::CertError::UNNESTED_RESOURCE) => {
                BunString::static_("RFC 3779 resource not subset of parent's resources")
            }
            http::Error::Cert(http::CertError::PERMITTED_VIOLATION) => {
                BunString::static_("permitted subtree violation")
            }
            http::Error::Cert(http::CertError::EXCLUDED_VIOLATION) => {
                BunString::static_("excluded subtree violation")
            }
            http::Error::Cert(http::CertError::SUBTREE_MINMAX) => {
                BunString::static_("name constraints minimum and maximum not supported")
            }
            http::Error::Cert(http::CertError::UNSUPPORTED_CONSTRAINT_TYPE) => {
                BunString::static_("unsupported name constraint type")
            }
            http::Error::Cert(http::CertError::UNSUPPORTED_CONSTRAINT_SYNTAX) => {
                BunString::static_("unsupported or invalid name constraint syntax")
            }
            http::Error::Cert(http::CertError::UNSUPPORTED_NAME_SYNTAX) => {
                BunString::static_("unsupported or invalid name syntax")
            }
            http::Error::Cert(http::CertError::CRL_PATH_VALIDATION_ERROR) => {
                BunString::static_("CRL path validation error")
            }
            http::Error::Cert(http::CertError::SUITE_B_INVALID_VERSION) => {
                BunString::static_("Suite B: certificate version invalid")
            }
            http::Error::Cert(http::CertError::SUITE_B_INVALID_ALGORITHM) => {
                BunString::static_("Suite B: invalid public key algorithm")
            }
            http::Error::Cert(http::CertError::SUITE_B_INVALID_CURVE) => {
                BunString::static_("Suite B: invalid ECC curve")
            }
            http::Error::Cert(http::CertError::SUITE_B_INVALID_SIGNATURE_ALGORITHM) => {
                BunString::static_("Suite B: invalid signature algorithm")
            }
            http::Error::Cert(http::CertError::SUITE_B_LOS_NOT_ALLOWED) => {
                BunString::static_("Suite B: curve not allowed for this LOS")
            }
            http::Error::Cert(http::CertError::SUITE_B_CANNOT_SIGN_P_384_WITH_P_256) => {
                BunString::static_("Suite B: cannot sign P-384 with P-256")
            }
            http::Error::Cert(http::CertError::EMAIL_MISMATCH) => {
                BunString::static_("Email address mismatch")
            }
            http::Error::Cert(http::CertError::IP_ADDRESS_MISMATCH) => {
                BunString::static_("IP address mismatch")
            }
            http::Error::Cert(http::CertError::INVALID_CALL) => {
                BunString::static_("Invalid certificate verification context")
            }
            http::Error::Cert(http::CertError::STORE_LOOKUP) => {
                BunString::static_("Issuer certificate lookup error")
            }
            http::Error::Cert(http::CertError::NAME_CONSTRAINTS_WITHOUT_SANS) => {
                BunString::static_("Issuer has name constraints but leaf has no SANs")
            }
            http::Error::Cert(http::CertError::UNKNOWN_CERTIFICATE_VERIFICATION_ERROR) => {
                BunString::static_("unknown certificate verification error")
            }

            _ => BunString::create_format(format_args!(
                "{code} fetching \"{path}\". For more information, pass `verbose: true` in the second argument to fetch()",
            )),
        };

        let fetch_error = jsc::SystemError {
            code: BunString::static_(code),
            message,
            path,
            ..Default::default()
        };

        BodyValueError::SystemTypeError(fetch_error)
    }

    fn connect_errno_name(&self) -> Option<&'static str> {
        if self.result.connect_errno == 0 {
            return None;
        }
        bun_sys::SystemErrno::init(i64::from(self.result.connect_errno)).map(Into::into)
    }

    /// `ERR_PROXY_TUNNEL` with the `status`, `statusText` and `headers` of the
    /// proxy's reply to CONNECT.
    fn proxy_connect_error(
        global_this: &JSGlobalObject,
        response: &HTTPResponseMetadata,
    ) -> JsResult<JSValue> {
        let error = global_this
            .err(
                jsc::ErrorCode::PROXY_TUNNEL,
                format_args!(
                    "Proxy refused to open a tunnel: {} {}",
                    response.status_code(),
                    bstr::BStr::new(response.status_text()),
                ),
            )
            .to_js();
        error.put(
            global_this,
            b"status".as_slice(),
            JSValue::js_number_from_int32(response.status_code() as i32),
        );
        error.put(
            global_this,
            b"statusText".as_slice(),
            bun_string_jsc::create_utf8_for_js(global_this, response.status_text())?,
        );
        let mut headers = HeadersRef::create_from_headers(response.headers());
        error.put(
            global_this,
            b"headers".as_slice(),
            headers.to_js(global_this),
        );
        Ok(error)
    }

    fn on_readable_stream_available(
        ctx: NonNull<c_void>,
        _global_this: &JSGlobalObject,
        readable: ReadableStream,
    ) {
        let this = Self::from_ctx(ctx);
        if let crate::webcore::readable_stream::Source::Bytes(bytes) = readable.ptr {
            // SAFETY: the caller holds the stream, which owns the live ByteStream. JS thread.
            unsafe { this.response_stream.hold(bytes) };
        } else {
            this.response_stream.release();
        }
    }

    fn on_start_streaming_http_response_body_callback(ctx: NonNull<c_void>) -> DrainResult {
        let this = Self::from_ctx(ctx);
        if this.signal_store.aborted.load(Ordering::Relaxed) {
            return DrainResult::Aborted;
        }

        // A body consumer is attaching; keep the process alive until the
        // body finishes (undone in `on_progress_update` when `is_done`), or
        // until the stream parks unread (`park_body_stream`).
        this.poll_ref.ref_(bun_io::js_vm_ctx());

        let lock = this.mutex.lock_guard();
        let size_hint = this.get_size_hint() as usize;
        let drained = core::mem::take(&mut this.scheduled_response_buffer.list);
        drop(lock);

        // After the take, not before: a chunk the HTTP thread appends (and pauses for) in
        // between would otherwise reach the stream with its task finding the buffer empty, and
        // nothing left to undo that pause. Unconditional: also flushes body bytes the client
        // holds that arrived with no follow-up read (`drain_response_body`).
        this.signal_store.receive_on_demand();
        this.schedule_receive_resume();

        if drained.is_empty() {
            DrainResult::EstimatedSize(size_hint)
        } else {
            DrainResult::Owned {
                list: drained,
                size_hint,
            }
        }
    }

    fn get_size_hint(&self) -> BlobSizeType {
        match self.body_size {
            http::BodySize::ContentLength(n) => n as BlobSizeType,
            http::BodySize::TotalReceived(n) => n as BlobSizeType,
            http::BodySize::Unknown => 0,
        }
    }

    /// Unhook from the response ByteStream (the stream can outlive us in JS). Touches no JS cell.
    fn clear_stream_handlers(&self) {
        self.response_stream.release();
    }

    /// reader.cancel() / body.cancel(): the server has to see the close (Node, Deno and browsers
    /// abort too). `&self` because a failed sink write reaches here from inside `on_body_received`.
    pub(crate) fn on_stream_cancelled(&self) {
        self.abort_task();
        self.abandon_response_body();
    }

    /// `SourceHandle::consumer_collected`: the stream's wrapper was swept, so nothing
    /// can read the rest of the body. Inside a GC sweep, like `on_response_finalize`.
    pub(crate) fn on_body_stream_collected(&self) {
        bun_output::scoped_log!(FetchTasklet, "onBodyStreamCollected");
        self.abandon_response_body();
    }

    pub(crate) fn on_stream_drained(&self) {
        self.unpark_body_stream();
        self.resume_receive();
    }

    fn resume_receive(&self) {
        if self.signal_store.unpause_receive() {
            self.schedule_receive_resume();
        }
    }

    /// A native sink was wired to the stream: something waits for bytes again.
    pub(crate) fn on_consumer_attached(&self) {
        self.unpark_body_stream();
    }

    /// The other half of this rule is in `store_result` (HTTP thread).
    fn after_body_chunk_delivered(&self, bytes: &crate::webcore::ByteStream) {
        use crate::webcore::byte_stream::AfterDelivery;
        bun_output::scoped_log!(
            FetchTasklet,
            "afterBodyChunkDelivered buffered={}",
            bytes.buffered_len()
        );
        match self.response_stream.after_delivery(bytes) {
            AfterDelivery::Resume => self.resume_receive(),
            AfterDelivery::Pause => self.signal_store.pause_receive(),
            AfterDelivery::Park => {
                self.signal_store.pause_receive();
                self.park_body_stream();
            }
        }
    }

    fn park_body_stream(&self) {
        if self.response_stream.park() {
            bun_output::scoped_log!(FetchTasklet, "parkBodyStream");
            self.poll_ref.unref(bun_io::js_vm_ctx());
        }
    }

    fn unpark_body_stream(&self) {
        if self.response_stream.unpark() {
            bun_output::scoped_log!(FetchTasklet, "unparkBodyStream");
            self.poll_ref.ref_(bun_io::js_vm_ctx());
        }
    }

    fn on_start_buffering_callback(ctx: NonNull<c_void>) {
        let this = Self::from_ctx(ctx);
        this.poll_ref.ref_(bun_io::js_vm_ctx());
        if this.signal_store.receive_all() {
            this.schedule_receive_resume();
        }
    }

    fn schedule_receive_resume(&self) {
        if let Some(id) = self.async_http_id {
            http::HTTPThread::schedule_receive_resume(id);
        }
    }

    fn to_body_value(&mut self) -> BodyValue {
        if let Some(err) = self.get_abort_error() {
            return BodyValue::Error(err);
        }
        if self.result.fail.is_some() {
            // Head received but body failed in the same callback; surface on
            // the body so this matches the split-read `on_body_received` path.
            return BodyValue::Error(self.on_reject());
        }
        if self.is_waiting_body {
            let mut pending = body::PendingValue::new(&self.global_this);
            pending.size_hint = self.get_size_hint();
            pending.task = Some(NonNull::from(&mut *self).cast::<c_void>());
            pending.on_start_streaming =
                Some(FetchTasklet::on_start_streaming_http_response_body_callback);
            pending.on_readable_stream_available = Some(FetchTasklet::on_readable_stream_available);
            pending.on_start_buffering = Some(FetchTasklet::on_start_buffering_callback);
            pending.producer = SourceHandle::FetchResponseBody(bun_ptr::BackRef::new_mut(self));
            return BodyValue::Locked(pending);
        }

        let scheduled_response_buffer = core::mem::take(&mut self.scheduled_response_buffer);
        let response = BodyValue::InternalBlob(InternalBlob {
            bytes: scheduled_response_buffer.list,
            was_string: false,
        });
        self.scheduled_response_buffer = MutableString::default();

        response
    }

    /// <https://fetch.spec.whatwg.org/#main-fetch>: HEAD responses and null body
    /// statuses have no body. Not 101: the HTTP client only accepts it for a
    /// requested upgrade, and the upgraded connection is then the body.
    fn response_body_is_null(&self, status_code: u16) -> bool {
        (crate::server::http_status_text::is_null_body(status_code) && status_code != 101)
            || self.method == Method::HEAD
    }

    /// Content the server frames anyway (a 205 with content) is dropped and the connection
    /// closed. `is_waiting_body` stays false: nothing may reach this body.
    fn null_body_value(&mut self) -> BodyValue {
        self.scheduled_response_buffer = MutableString::default();
        if self.result.has_more {
            self.abandon_response_body();
        }
        BodyValue::Null
    }

    fn to_response(&mut self) -> Response {
        bun_output::scoped_log!(FetchTasklet, "toResponse");
        debug_assert!(self.metadata.is_some());
        // at this point we always should have metadata
        let metadata = self.metadata.as_ref().unwrap();
        // reshaped for borrowck — capture metadata fields before to_body_value() takes &mut self
        let headers = HeadersRef::create_from_headers(metadata.headers());
        let status_code = metadata.status_code() as u16;
        // Fast path: when the wire reason phrase matches the canonical text for
        // this status code, store a StaticEncodedSlice and skip the WTF allocation.
        let status_text = match crate::server::http_status_text::get(status_code)
            .map(|t| &t[4..])
            .filter(|canon| *canon == metadata.status_text())
        {
            Some(canon) => BunString::static_(canon),
            None => BunString::clone_utf8(metadata.status_text()),
        };
        let url = BunString::clone_utf8(metadata.url());
        let redirected = self.result.redirected;
        let body = if self.response_body_is_null(status_code) {
            self.null_body_value()
        } else {
            self.is_waiting_body = self.result.has_more;
            self.to_body_value()
        };
        Response::init(
            crate::webcore::response::Init {
                headers: Some(headers),
                status_code,
                status_text,
                ..Default::default()
            },
            Body::new(body),
            url,
            redirected,
        )
    }

    /// Nothing will read the rest of the body: abort the transport, let go of the loop and of the
    /// response; `callback` drops whatever still arrives. Safe inside a GC sweep
    /// (`on_response_finalize`, `on_body_stream_collected`): no JS cell is touched; the
    /// request-body sink is left for `clear_sink()` in `drop()`.
    fn abandon_response_body(&self) {
        bun_output::scoped_log!(FetchTasklet, "abandonResponseBody");
        self.signal_store.abandon();
        self.abort_transport();
        self.poll_ref.unref(bun_io::js_vm_ctx());
        self.clear_stream_handlers();
        self.response.clear();
        self.native_response.set(None);
    }

    fn on_resolve(&mut self) -> JSValue {
        bun_output::scoped_log!(FetchTasklet, "onResolve");
        let response = RefPtr::new(self.to_response());
        // The fetch() promise is about to resolve; from here the paused
        // transport should not by itself keep the event loop alive. The body
        // consumer hooks (`on_start_streaming_http_response_body_callback`,
        // `on_start_buffering_callback`) re-ref if the caller reads the body.
        if self.is_waiting_body {
            self.poll_ref.unref(bun_io::js_vm_ctx());
        }
        let global_this = self.global_this;
        let response_js = Response::to_js(response.clone(), &global_this);
        response_js.ensure_still_alive();
        self.response = jsc::Weak::<FetchTasklet>::create(
            response_js,
            &global_this,
            jsc::WeakRefType::FetchResponse,
            self,
        );
        let response_ptr = response.as_ptr();
        self.native_response.set(Some(response));
        // Response-owned listener so abort still errors the body after this tasklet detaches its own.
        if let Some(signal) = self.abort_signal() {
            // SAFETY: `native_response` and the wrapper each hold a ref on the live heap allocation.
            unsafe {
                Response::attach_abort_signal(response_ptr, &global_this, signal, self.context)
            };
        }
        response_js
    }

    fn get(
        cx: &bun_jsc::JsThread<'_>,
        fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> crate::Result<(*mut FetchTasklet, Box<AsyncHTTP<'static>>)> {
        let mut fetch_tasklet = Box::new(FetchTasklet {
            sink: None,
            async_http_id: None,
            method: fetch_options.method,
            result: HTTPClientResult::default(),
            metadata: None,
            http_ref: None,
            js_ref: None,
            global_this: GlobalRef::from(cx.global()),
            request_body: fetch_options.body,
            request_body_streaming_buffer: None,
            scheduled_response_buffer: MutableString::default(),
            response: jsc::Weak::default(),
            native_response: JsCell::new(None),
            response_stream: Default::default(),
            request_headers: fetch_options.headers,
            declared_request_body_len: None,
            request_body_len_written: 0,
            request_body_mismatched: false,
            promise,
            concurrent_task: ConcurrentTask::default(),
            poll_ref: KeepAlive::default(),
            body_size: http::BodySize::Unknown,
            url_proxy_buffer: fetch_options.url_proxy_buffer,
            url_len: fetch_options.url.href.len(),
            abort_handle: jsc::AbortHandle::for_owner::<FetchTasklet>(),
            context: cx.context().id(),
            signals: Signals::default(),
            signal_store: http::signals::Store::unclaimed(),
            has_schedule_callback: AtomicBool::new(false),
            abort_reason: StrongOptional::empty(),
            check_server_identity: fetch_options.check_server_identity,
            fetch_session: fetch_options.fetch_session,
            session_check_server_identity: fetch_options.session_check_server_identity,
            reject_unauthorized: fetch_options.reject_unauthorized,
            upgraded_connection: fetch_options.upgraded_connection,
            unix_socket_path: fetch_options.unix_socket_path,
            is_waiting_body: false,
            is_waiting_abort: false,
            is_waiting_request_stream_start: false,
            mutex: Mutex::new(),
            tracker: AsyncTaskTracker::init(cx.vm()),
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
        });

        fetch_tasklet.signals = fetch_tasklet.signal_store.to_with_backpressure();

        fetch_tasklet.tracker.did_schedule(cx.global());

        let url = fetch_options.url;
        let env = cx.vm().transpiler.get().env_mut();
        // Capture the proxy env so the HTTP thread can re-resolve per redirect
        // hop (`HTTPClient::reevaluate_proxy_for_redirect`). `ProxySettings`
        // owns copies of the env values, so a later `process.env.HTTP_PROXY =
        // ...` on the JS thread cannot invalidate them mid-request.
        let proxy_settings: Option<Box<http::ProxySettings>> = match &fetch_options.proxy {
            ProxyPolicy::Direct => None,
            ProxyPolicy::Explicit {
                href,
                respect_no_proxy,
            } => http::ProxySettings::from_explicit(href, env, *respect_no_proxy),
            // A unix socket is the whole route; the proxy env never applies to it.
            ProxyPolicy::Env if !fetch_tasklet.unix_socket_path.is_empty() => None,
            ProxyPolicy::Env => http::ProxySettings::from_env(env),
        };
        // Hop-0 proxy borrows the boxed `ProxySettings` heap storage, which is
        // moved into `AsyncHTTP::init` below and lives on `client` for the
        // lifetime of the request.
        let proxy: Option<ZigURL> = proxy_settings.as_deref().and_then(|s| {
            let href: *const [u8] = s.resolve(&url)?;
            // SAFETY: see block comment above.
            Some(ZigURL::parse(unsafe { &*href }))
        });

        // The callback keeps a request on HTTP/1.1. Under `rejectUnauthorized:
        // false` its verdict is not enforced, so a request pinned to h2/h3
        // goes ahead without it.
        let advisory_on_pinned_protocol = !fetch_tasklet.reject_unauthorized
            && matches!(
                fetch_options.forced_protocol,
                Some(http::Protocol::Http2 | http::Protocol::Http3)
            );
        if (fetch_tasklet.check_server_identity.has()
            || fetch_tasklet.session_check_server_identity)
            && !advisory_on_pinned_protocol
        {
            fetch_tasklet
                .signal_store
                .cert_errors
                .store(true, Ordering::Relaxed);
        } else {
            fetch_tasklet.signals.cert_errors = None;
        }

        let sendfile = fetch_tasklet.request_body.take_sendfile();

        let fetch_tasklet_ptr = bun_core::heap::into_raw(fetch_tasklet);
        // SAFETY: just allocated, and `fetch_tasklet` is not used once `fetch_tasklet_ptr` is
        // dereferenced. `'static`: `http` is an `AsyncHTTP<'static>` that borrows (headers_buf,
        // request_body, unix_socket_path) FetchTasklet-owned storage. NOT process-lifetime:
        // `request_headers.buf`, `request_body` and `unix_socket_path` are not reallocated for the
        // lifetime of the request, whose ref on the tasklet goes after `callback` has dropped it.
        let fetch_tasklet: &'static mut FetchTasklet = unsafe { &mut *fetch_tasklet_ptr };

        // This task gets queued on the HTTP thread.
        let headers_buf: &'static [u8] = fetch_tasklet.request_headers.buf.as_slice();
        let request_body_slice: &'static [u8] = fetch_tasklet.request_body.slice();
        let unix_socket_path: &'static [u8] = &fetch_tasklet.unix_socket_path;
        // `MultiArrayList` owns its
        // allocation, so clone; AsyncHTTP::init clones again for the client.
        let header_entries = bun_core::handle_oom(fetch_tasklet.request_headers.entries.clone());
        // `url` is moved into `AsyncHTTP::init`; capture the one
        // post-move query (`is_http()`, debug-assert only) up front.
        let url_is_http = url.is_http();

        let mut http = AsyncHTTP::init(
            fetch_options.method,
            url,
            header_entries,
            headers_buf,
            request_body_slice,
            // handles response events (on headers, on body, etc.)
            http::HTTPClientResultCallback::new_with_release::<FetchTasklet>(
                fetch_tasklet_ptr,
                // SAFETY: `new_with_release` guarantees the pointer/lifetime
                // contract `callback` documents.
                FetchTasklet::callback,
                FetchTasklet::release_at_shutdown,
            ),
            fetch_options.redirect_type,
            http::async_http::Options {
                http_proxy: proxy,
                proxy_settings,
                proxy_headers: fetch_options.proxy_headers,
                signals: Some(fetch_tasklet.signals),
                unix_socket_path: Some(unix_socket_path),
                disable_timeout: Some(fetch_options.disable_timeout),
                idle_timeout_seconds: fetch_options.idle_timeout_seconds,
                disable_keepalive: Some(fetch_options.disable_keepalive),
                disable_decompression: Some(fetch_options.disable_decompression),
                max_redirects: fetch_options.max_redirects,
                reject_unauthorized: Some(fetch_options.reject_unauthorized),
                verbose: Some(fetch_options.verbose),
                tls_props: fetch_options.ssl_config,
                compress: fetch_options.compress,
                pool: fetch_options.pool,
                bypass_pool: fetch_options.bypass_pool,
            },
        );
        fetch_tasklet.async_http_id = Some(http.async_http_id);
        // enable streaming the write side
        let is_stream = matches!(
            fetch_tasklet.request_body,
            HTTPRequestBody::ReadableStream(_)
        );
        http.client.flags.is_streaming_request_body = is_stream;
        http.client.flags.forced_protocol = fetch_options.forced_protocol;
        http.client.flags.is_node_http_client = fetch_options.is_node_http_client;
        fetch_tasklet.is_waiting_request_stream_start = is_stream;
        if is_stream {
            // An upgraded connection tunnels its "body", so those bytes are not counted.
            let framing = fetch_options.stream_framing;
            if !fetch_tasklet.upgraded_connection {
                fetch_tasklet.declared_request_body_len = framing.content_length;
            }
            let buffer = ThreadSafeStreamBuffer::new(
                FetchTasklet::on_write_request_data_drain,
                fetch_tasklet_ptr,
            );
            fetch_tasklet.request_body_streaming_buffer = Some(buffer.clone());
            http.request_body = http::HTTPRequestBody::Stream(http::http_request_body::Stream {
                buffer: Some(buffer),
                ended: false,
                framing,
            });
        }
        // TODO is this necessary? the http client already sets the redirect type,
        // so manually setting it here seems redundant
        if fetch_options.redirect_type != FetchRedirect::Follow {
            http.client.remaining_redirect_count = 0;
        }

        // we want to return after headers are received
        fetch_tasklet
            .signal_store
            .header_progress
            .store(true, Ordering::Relaxed);

        if let Some(sendfile) = sendfile {
            debug_assert!(url_is_http);
            debug_assert!(!matches!(fetch_options.proxy, ProxyPolicy::Explicit { .. }));
            http.request_body = http::HTTPRequestBody::Sendfile(sendfile);
        }

        if let Some(signal) = fetch_options.signal {
            // SAFETY: the tasklet is heap-allocated and drops its handle with itself.
            unsafe { jsc::AbortHandle::follow_owner(fetch_tasklet_ptr, signal) };
        }
        Ok((fetch_tasklet_ptr, http))
    }

    pub(crate) fn abort_listener(&mut self, reason: JSValue) {
        bun_output::scoped_log!(FetchTasklet, "abortListener");
        let this = self;
        reason.ensure_still_alive();
        this.abort_reason.set(&this.global_this, reason);
        this.abort_task();
        if this.sink_mut().is_some() {
            this.cancel_request_body_sink(reason);
            return;
        }
        // Abort fired before the HTTP thread asked for the body, so the
        // ReadableStream was never wired into a sink. Cancel it directly so
        // the underlying source's cancel(reason) callback still observes the
        // signal's reason (https://fetch.spec.whatwg.org/#abort-fetch step 5).
        if this.is_waiting_request_stream_start {
            if let HTTPRequestBody::ReadableStream(stream_ref) = &this.request_body {
                this.is_waiting_request_stream_start = false;
                if let Some(stream) = stream_ref.get() {
                    crate::dispatch::fold(stream.cancel_with_reason(&this.global_this, reason));
                }
            }
        }
    }

    /// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
    fn on_write_request_data_drain(this: *mut FetchTasklet) {
        // SAFETY: the HTTP thread's ref keeps `this` alive.
        let task = unsafe { RefPtr::init_ref(this) }.into_raw();
        let task = ConcurrentTask::create_from(task.cast::<FetchTaskletRequestDrain>());
        Self::from_raw_ref(this).ticket().post(task);
    }

    /// This is ALWAYS called from the main thread
    pub(crate) fn resume_request_data_stream(this: &RefPtr<FetchTasklet>) {
        let this_ref = Self::from_raw_mut(this.as_ptr());
        bun_output::scoped_log!(FetchTasklet, "resumeRequestDataStream");
        if !this_ref.signal_aborted() {
            let global_this = this_ref.global_this;
            if let Some(sink) = this_ref.sink_mut() {
                sink.on_drain(&global_this);
            }
        }
    }

    /// True for upgraded connections, HTTP/2 (DATA frames) and `Content-Length` framing.
    pub(crate) fn skip_chunked_framing(&self) -> bool {
        self.upgraded_connection || self.result.is_http2 || self.declared_request_body_len.is_some()
    }

    /// The HTTP thread decides: only it knows whether a followed redirect already dropped the body.
    fn report_content_length_mismatch(&mut self, written: u64) {
        self.request_body_len_written = written;
        self.request_body_mismatched = true;
        if let Some(id) = self.async_http_id {
            http::HTTPThread::schedule_request_write(
                id,
                http::http_thread::WriteMessageType::LengthMismatch,
            );
        }
    }

    /// Called from `FetchRequestBodySink::write_*`; `high_water_mark` is the
    /// sink's configured HWM so the backpressure threshold tracks
    /// `start({ highWaterMark })`.
    pub(crate) fn write_request_data(
        &mut self,
        data: EncodedChunk<'_>,
        high_water_mark: usize,
    ) -> Writable {
        if self.signal_aborted() || self.request_body_mismatched {
            return Writable::Done;
        }
        // An empty chunk is a no-op on every framing path. It must not reach
        // the chunked framer below, which would serialize it as "0\r\n\r\n",
        // the chunked-body TERMINATOR (RFC 9112 section 7.1), ending the
        // message mid-upload. It must also never report Backpressure: nothing
        // gets buffered, so the HTTP thread's report_drain (what resumes a
        // paused sink) can never fire, and the upload stalls forever.
        let utf8_len = data.utf8_len();
        bun_output::scoped_log!(FetchTasklet, "writeRequestData {}", utf8_len);
        if utf8_len == 0 {
            return Writable::Owned(0);
        }
        // A surplus byte would sit where a keep-alive peer parses the next request.
        if let Some(declared) = self.declared_request_body_len {
            let written = self
                .request_body_len_written
                .saturating_add(utf8_len as u64);
            if written > declared {
                self.report_content_length_mismatch(written);
                return Writable::Err(bun_sys::Error::from_code(
                    bun_sys::E::ECANCELED,
                    bun_sys::Tag::write,
                ));
            }
            self.request_body_len_written = written;
        }
        let len = utf8_len as BlobSizeType;
        let Some(thread_safe_stream_buffer) = self.request_body_streaming_buffer.as_deref() else {
            return Writable::Done;
        };
        // Mutex guards `buffer` against the HTTP thread; released when `locked` drops.
        let mut locked = thread_safe_stream_buffer.lock();
        let stream_buffer = &mut locked.buffer;

        // dont have backpressure so we will schedule the data to be written
        // if we have backpressure the onWritable will drain the buffer
        let needs_schedule = stream_buffer.is_empty();
        if self.skip_chunked_framing() {
            data.append_utf8_into(&mut stream_buffer.list);
        } else {
            //16 is the max size of a hex number size that represents 64 bits + 2 for the \r\n
            let mut formated_size_buffer = [0u8; 18];
            use std::io::Write;
            let formated_size = {
                let mut cursor = &mut formated_size_buffer[..];
                write!(cursor, "{:x}\r\n", utf8_len).expect("unreachable");
                let written = 18 - cursor.len();
                &formated_size_buffer[..written]
            };
            let _ = stream_buffer.ensure_unused_capacity(formated_size.len() + utf8_len + 2); // OOM/capacity: fire-and-forget
            stream_buffer.write_assume_capacity(formated_size);
            data.append_utf8_into(&mut stream_buffer.list);
            stream_buffer.write_assume_capacity(b"\r\n");
        }

        let result = if stream_buffer.size() >= high_water_mark {
            Writable::Backpressure(len)
        } else {
            Writable::Owned(len)
        };

        if needs_schedule {
            // wakeup the http thread to write the data
            http::HTTPThread::schedule_request_write(
                self.async_http_id.unwrap(),
                http::http_thread::WriteMessageType::Data,
            );
        }

        // pause the stream if we hit the high water mark
        result
    }

    pub(crate) fn write_end_request(&mut self, err: Option<JSValue>) {
        bun_output::scoped_log!(FetchTasklet, "writeEndRequest hasError? {}", err.is_some());
        if self.request_body_mismatched {
            // The pump ending on the `Writable::Err` the mismatch gave it; already reported.
            return;
        }
        if let Some(js_error) = err {
            if self.signal_store.aborted.load(Ordering::Relaxed) || self.abort_reason.has() {
                return;
            }
            if !js_error.is_undefined_or_null() {
                self.abort_reason.set(&self.global_this, js_error);
            }
            self.abort_task();
        } else {
            if self.signal_store.aborted.load(Ordering::Relaxed) {
                return;
            }
            // Short of the announced length, the peer would wait for the rest forever.
            let written = self.request_body_len_written;
            if let Some(declared) = self.declared_request_body_len
                && written < declared
            {
                self.report_content_length_mismatch(written);
                return;
            }
            if !self.skip_chunked_framing() {
                // Using chunked transfer encoding, send the terminating chunk
                let Some(thread_safe_stream_buffer) = self.request_body_streaming_buffer.as_deref()
                else {
                    return;
                };
                // Mutex guards `buffer` against the HTTP thread; released when
                // the lock guard drops.
                let _ = thread_safe_stream_buffer
                    .lock()
                    .buffer
                    .write(http::END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY); // OOM/capacity: fire-and-forget
            }
            if let Some(id) = self.async_http_id {
                http::HTTPThread::schedule_request_write(
                    id,
                    http::http_thread::WriteMessageType::End,
                );
            }
        }
    }

    fn abort_task(&self) {
        if self.abort_transport() {
            self.tracker.did_cancel(&self.global_this);
        }
    }

    /// Idempotent: an AbortSignal, VM teardown and `abandon_response_body` can all reach here for
    /// the same fetch. Only the first enqueues a shutdown. No JS.
    fn abort_transport(&self) -> bool {
        if self.signal_store.aborted.swap(true, Ordering::Relaxed) {
            return false;
        }
        if let Some(id) = self.async_http_id {
            http::HTTPThread::schedule_shutdown(id);
        }
        true
    }

    /// Cancel an in-flight request-body sink: stores the abort reason, aborts
    /// the HTTP task, marks the sink ended/done, and fires the controller's
    /// onClose (which cancels the upstream ReadableStream reader).
    pub(crate) fn cancel_request_body_sink(&mut self, reason: JSValue) {
        let Some(sink) = self.sink_mut() else {
            return;
        };
        if sink.ended {
            return;
        }
        sink.ended = true;
        sink.done = true;
        let is_native = matches!(
            sink.source,
            SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
        );
        if !reason.is_empty_or_undefined_or_null() && !self.abort_reason.has() {
            let global_this = self.global_this;
            self.abort_reason.set(&global_this, reason);
        }
        self.abort_task();
        if let Some(sink) = self.sink_mut() {
            sink.pending.result = Writable::Done;
            sink.pending.run();
            sink.source.close(None);
            if is_native {
                // No pump promise will settle. This may be the last ref.
                drop(sink.task.take());
            }
        }
    }

    /// Ends a request body sink that's wired to a native source. VM teardown drops the progress
    /// update without running it and destroys the source without ending its sink. A sink fed by
    /// a JS pump is finalized by its controller cell instead.
    fn detach_native_request_body_sink(&mut self) -> Option<RefPtr<Self>> {
        let global_this = self.global_this;
        let sink = self.sink_mut()?;
        if sink.ended
            || !matches!(
                sink.source,
                SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
            )
        {
            return None;
        }
        sink.ended = true;
        sink.done = true;
        sink.source.detach(&global_this);
        sink.task.take()
    }

    pub(crate) fn queue(
        cx: &bun_jsc::JsThread<'_>,
        fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> crate::Result<*mut FetchTasklet> {
        http::http_thread::init(&http::http_thread::InitOpts::default());
        let (node, request) = Self::get(cx, fetch_options, promise)?;

        let node_ref = Self::from_raw_mut(node);
        node_ref.poll_ref.ref_(bun_io::js_vm_ctx());

        // SAFETY: the ref that `get` made it with.
        let js_ref = node_ref.js_ref.insert(unsafe { RefPtr::from_raw(node) });
        // Out on the HTTP thread from here until its final callback: its context
        // aborts it when it stops, and the VM waits for it (the ticket).
        node_ref.http_ref = Some(HttpThreadRef {
            tasklet: js_ref.clone().into_non_null(),
            ticket: cx.vm().ticket(),
        });
        // SAFETY: as in `get`.
        unsafe { jsc::AbortHandle::arm_owner(node, cx.context()) };
        http::HTTPThread::schedule([request]);

        Ok(node)
    }

    /// Called from HTTP thread. Handles HTTP events received from socket.
    ///
    /// # Safety
    /// `task` must be a live heap-allocated `FetchTasklet` with the
    /// HTTP-thread ref still held.
    fn callback(
        task: *mut FetchTasklet,
        finished: Option<http::FinishedRequest>,
        result: HTTPClientResult,
    ) {
        drop(finished);
        let is_done = !result.has_more;
        // SAFETY: fn contract; `http_ref` is HTTP-thread-only.
        unsafe {
            Self::store_result(task, result);
            if is_done {
                drop((*task).http_ref.take().expect(Self::HOLDS_REF));
            }
        }
    }

    /// SAFETY: as [`Self::callback`].
    unsafe fn store_result(task: *mut FetchTasklet, mut result: HTTPClientResult) {
        let task_ref = Self::from_raw_mut(task);
        // Before the lock, so that it is freed after the unlock.
        let body_owned = core::mem::take(&mut result.body_owned);
        let _lock = task_ref.mutex.lock_guard();

        bun_output::scoped_log!(
            FetchTasklet,
            "callback success={} receive_mode={:?} has_more={} bytes={}",
            result.is_success(),
            task_ref.signal_store.body_receive_mode(),
            result.has_more,
            result.body.len()
        );

        let prev_metadata = task_ref.result.metadata.take();
        let prev_cert_info = task_ref.result.certificate_info.take();
        let prev_can_stream = task_ref.result.can_stream;
        // `result.body` borrows the HTTP thread's scratch buffer on non-terminal
        // callbacks; the terminal callback carries the bytes in `body_owned`
        // instead. Capture both; the stored copy keeps neither.
        let body: &[u8] = result.body;
        task_ref.result = result.without_borrowed_body();
        // can_stream is a one-shot signal to start the request body stream; don't let a
        // later coalesced result clobber it before the JS thread sees it.
        task_ref.result.can_stream = task_ref.result.can_stream || prev_can_stream;

        // Preserve pending certificate info if it was preovided in the previous update.
        if task_ref.result.certificate_info.is_none() {
            if let Some(cert_info) = prev_cert_info {
                task_ref.result.certificate_info = Some(cert_info);
            }
        }

        // metadata should be provided only once
        if let Some(metadata) = task_ref.result.metadata.take().or(prev_metadata) {
            bun_output::scoped_log!(FetchTasklet, "added callback metadata");
            if task_ref.metadata.is_none() {
                task_ref.metadata = Some(metadata);
            }

            task_ref.result.metadata = None;
        }

        task_ref.body_size = task_ref.result.body_size;

        let success = task_ref.result.is_success();

        if task_ref.signal_store.body_receive_mode() == BodyReceiveMode::Abandoned {
            if task_ref.scheduled_response_buffer.list.capacity() > 0 {
                task_ref.scheduled_response_buffer = MutableString::default();
            }
            if success && task_ref.result.has_more {
                return;
            }
        } else if success {
            let scheduled = &mut task_ref.scheduled_response_buffer;
            if body.is_empty() && !body_owned.is_empty() && scheduled.list.is_empty() {
                scheduled.list = body_owned;
            } else {
                // Grow to Content-Length once so the per-packet append below
                // doesn't leave the ~2x doubling over-capacity that the
                // ArrayBuffer would adopt. Only for a consumer that wants the whole body.
                if task_ref.signal_store.body_receive_mode() == BodyReceiveMode::BufferAll {
                    if let http::BodySize::ContentLength(n) = task_ref.body_size {
                        if n > scheduled.list.capacity() {
                            let additional = n
                                .min(SCHEDULED_PRERESERVE_MAX)
                                .saturating_sub(scheduled.list.len());
                            let _ = scheduled.list.try_reserve_exact(additional);
                        }
                    }
                }
                let chunk = if body.is_empty() {
                    body_owned.as_slice()
                } else {
                    body
                };
                if !chunk.is_empty() {
                    bun_core::handle_oom(scheduled.write(chunk));
                }
            }
            if task_ref.result.has_more
                && task_ref.scheduled_response_buffer.list.len() >= BODY_HIGH_WATER_MARK
            {
                task_ref.signal_store.pause_receive();
            }
        }

        if let Err(has_schedule_callback) = task_ref.has_schedule_callback.compare_exchange(
            false,
            true,
            Ordering::Acquire,
            Ordering::Relaxed,
        ) {
            if has_schedule_callback {
                return;
            }
        }
        let ct = core::ptr::NonNull::from(task_ref.concurrent_task.from(task));
        // `ct` is the inline `concurrent_task` field of the heap tasklet; the
        // queue takes ownership of its `next` link. This thread's ref keeps the
        // tasklet (and the ticket in it) alive across the post.
        task_ref.ticket().post_intrusive(ct);
    }
}

pub(crate) fn on_resolve_request_stream(
    _: &mut JsScope<'_>,
    _: JsLocal<'_>,
    context: *mut FetchTasklet,
) {
    // SAFETY: the tasklet that `start_request_stream` passed, which this ref keeps alive.
    unsafe {
        let _stream_ref = (*context).take_request_stream_ref();
        (*context).write_end_request(None);
    }
}

pub(crate) fn on_reject_request_stream(
    _: &mut JsScope<'_>,
    err: JsLocal<'_>,
    context: *mut FetchTasklet,
) {
    // SAFETY: the tasklet that `start_request_stream` passed, which this ref keeps alive.
    unsafe {
        let _stream_ref = (*context).take_request_stream_ref();
        (*context).write_end_request(Some(err.to_js()));
    }
}

impl FetchTasklet {
    #[bun_uws::uws_callback(export = "Bun__FetchResponse_finalize", no_catch)]
    pub(crate) fn on_response_finalize(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "onResponseFinalize");
        let Some(response) = self.native_response.get().as_deref() else {
            return;
        };
        let BodyValue::Locked(locked) = response.get_body_value() else {
            // The body arrived or failed; nothing is underway.
            return;
        };
        // What can outlive the Response and still take the body: its stream (whose own collection
        // is `on_body_stream_collected`), or a whole-body consumer (`.text()` and friends hold a
        // promise, `Bun.write` an `on_receive_value`).
        let outlived = self.response_stream.is_held()
            || locked.on_receive_value.is_some()
            || locked.promise.is_some();
        if !outlived {
            self.abandon_response_body();
        }
    }
}

pub(crate) struct FetchOptions {
    pub method: Method,
    pub(crate) headers: Headers,
    pub(crate) body: HTTPRequestBody,
    /// For a `ReadableStream` body; `transfer_encoding` points into `headers.buf`.
    pub(crate) stream_framing: http::http_request_body::StreamFraming,
    pub(crate) disable_timeout: bool,
    /// Per-request idle-timeout override, from `fetch(url, { timeout: <ms> })`.
    pub(crate) idle_timeout_seconds: Option<core::ffi::c_uint>,
    pub(crate) disable_keepalive: bool,
    pub(crate) disable_decompression: bool,
    pub(crate) max_redirects: Option<u8>,
    pub(crate) reject_unauthorized: bool,
    pub(crate) url: ZigURL<'static>,
    pub(crate) verbose: http::HTTPVerboseLevel,
    pub(crate) redirect_type: FetchRedirect,
    pub(crate) proxy: ProxyPolicy,
    pub(crate) proxy_headers: Option<Headers>,
    pub(crate) url_proxy_buffer: Box<[u8]>,
    pub(crate) signal: Option<AbortSignalRef>,
    pub(crate) check_server_identity: StrongOptional,
    pub(crate) unix_socket_path: Box<[u8]>,
    pub(crate) ssl_config: Option<http::ssl_config::SharedPtr>,
    pub(crate) upgraded_connection: bool,
    pub(crate) forced_protocol: Option<http::Protocol>,
    pub(crate) is_node_http_client: bool,
    pub(crate) compress: Option<http::compress_body::CompressOption>,
    pub(crate) pool: http::PoolOptions,
    pub(crate) bypass_pool: bool,
    pub(crate) fetch_session: Option<super::fetch_session::SessionHold>,
    /// The session has the callback, and holds it; `fetch_session` holds the session.
    pub(crate) session_check_server_identity: bool,
}

/// Where a request's proxy comes from.
pub(crate) enum ProxyPolicy {
    /// `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`.
    Env,
    /// `proxy: false`.
    Direct,
    /// `href` (borrowing `url_proxy_buffer`), for every hop `NO_PROXY` does not
    /// exempt when it is respected.
    Explicit {
        href: &'static [u8],
        respect_no_proxy: bool,
    },
}

pub(crate) struct FetchTaskletPromiseSettle {
    held: StrongOptional,
    promise: jsc::JSPromiseStrong,
    global_object: GlobalRef,
    success: bool,
    /// The context of the script that fetched.
    context: jsc::ContextId,
}

impl FetchTaskletPromiseSettle {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(mut self: Box<Self>) -> JsResult<()> {
        let prom = self.promise.value_or_empty().as_any_promise().unwrap();
        let res = self.held.swap();
        res.ensure_still_alive();
        if self.success {
            prom.resolve(&self.global_object, res)
        } else {
            prom.reject_with_async_stack(&self.global_object, res)
        }
    }
}

impl bun_event_loop::BoxedTask for FetchTaskletPromiseSettle {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTaskletPromiseSettle;
    /// Drop the held value and promise handle without settling.
    fn release_unrun(self: Box<Self>) {}
    /// The fetch() promise is settled for the script that fetched.
    fn context(&self) -> bun_event_loop::ContextId {
        self.context
    }
}
