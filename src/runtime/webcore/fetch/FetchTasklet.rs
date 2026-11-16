use core::cell::{Cell, OnceCell};
use core::sync::atomic::Ordering;

use bun_boringssl as boringssl;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_core::String as BunString;
use bun_event_loop::{Task, Taskable};
use bun_http as http;
use bun_http::Method;
use bun_http::{
    AsyncHTTP, CertificateInfo, FetchRedirect, HTTPClientResult, HTTPResponseMetadata, Headers,
};
use bun_io::{KeepAlive, StreamBuffer};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, GlobalRef, HeadersRef, JSGlobalObject, JSValue, JsResult, StrongCell,
    StrongOptional, WeakGlobalRef,
};
use bun_ptr::{BackRef, CellExt as _, OptionCellExt as _, RefPtr};
use bun_threading::Guarded;
use bun_url::URL as ZigURL;

use crate::api::bun_x509 as X509;
use crate::generated_bindgen::fetch_tasklet::{
    Bun__FetchTasklet__onRejectRequestStream, Bun__FetchTasklet__onResolveRequestStream,
};
use crate::webcore::blob::{Any as AnyBlob, Blob, SizeType as BlobSizeType, Store as BlobStore};
use crate::webcore::body::{self, Body, Value as BodyValue, ValueError as BodyValueError};
use crate::webcore::fetch::fetch_request_body_sink::FetchRequestBodySink;
use crate::webcore::http_result_inbox::{HttpResultInbox, ReceivedGuard, StoreResult};
use crate::webcore::readable_stream::{ReadableStream, Strong as ReadableStreamStrong};
use crate::webcore::sink::ReadableSinkController;
use crate::webcore::streams::EncodedChunk;
use crate::webcore::streams::{SourceHandle, StreamError, StreamResult, Writable};
use crate::webcore::{DrainResult, InternalBlob, Response, SinkHandle};
use bun_jsc::AbortSignalRef;

// `bun_event_loop::JsResult` (cycle-broken erased error) — used by
// ConcurrentTask callbacks at the tier-3 layer.

use http::signals::BODY_HIGH_WATER_MARK;

use boringssl::c::OwnedX509;

// ConcurrentTask::from() needs `Taskable`; tag is declared in bun_event_loop
// but the impl lives next to the type (cycle-break).
/// The HTTP thread drained the request body's buffer: the hop that tells the sink, on the JS
/// thread. Same pointer, its own tag.
#[repr(transparent)]
pub(crate) struct FetchTaskletRequestDrain(FetchTasklet);
impl Taskable for FetchTaskletRequestDrain {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTaskletRequestDrain;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; only `inbox` posts this tag.
        drop(unsafe { HttpResultInbox::<Received>::take_drain(this.cast::<FetchTasklet>()) });
    }
    /// Enters no context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl Taskable for FetchTasklet {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTasklet;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; only `inbox` posts this tag.
        unsafe { HttpResultInbox::<Received>::take(this, |_, _| ()) };
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

#[derive(bun_ptr::RefCounted)]
pub struct FetchTasklet {
    sink: Cell<Option<RefPtr<FetchRequestBodySink>>>,
    /// `None` before the request is built and in `drop`.
    async_http_id: Cell<Option<u32>>,
    method: Method,
    inbox: HttpResultInbox<Received>,
    metadata: OnceCell<HTTPResponseMetadata>,
    /// `HTTPClientResult::is_http2` of the latest progress update.
    is_http2: Cell<bool>,
    pub(crate) global_this: WeakGlobalRef,
    pub(crate) request_body: HTTPRequestBody,
    pub(crate) request_body_streaming_buffer: Guarded<StreamBuffer>,

    /// response weak ref we need this to track the response JS lifetime
    response: OnceCell<jsc::Weak<FetchTasklet>>,
    /// native response ref if we still need it when JS is discarted
    native_response: Cell<Option<RefPtr<Response>>>,
    /// The response body stream while this tasklet is its producer.
    pub(crate) response_stream: crate::webcore::byte_stream::ProducerHold,
    request_headers_buf: Vec<u8>,
    /// `Content-Length` framing a streaming body; `write_request_data` counts against it.
    pub(crate) declared_request_body_len: Option<u64>,
    pub(crate) request_body_len_written: Cell<u64>,
    /// The count missed and `WriteMessageType::LengthMismatch` was sent.
    pub(crate) request_body_mismatched: Cell<bool>,
    promise: Cell<jsc::JSPromiseStrong>,
    pub poll_ref: KeepAlive,

    /// This is url + proxy memory buffer and is owned by FetchTasklet
    /// We always clone url and proxy (if informed)
    url_proxy_buffer: Box<[u8]>,
    url_len: usize,

    /// The context whose script called `fetch()`, and its `signal` option.
    pub(crate) abort_handle: jsc::AbortHandle,
    /// That context's id: the handle forgets its context once that stops.
    pub(crate) context: jsc::ContextId,

    // must be stored because AbortSignal stores reason weakly
    abort_reason: StrongCell,

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
    is_waiting_body: Cell<bool>,
    is_waiting_abort: Cell<bool>,
    pub(crate) is_waiting_request_stream_start: Cell<bool>,

    pub(crate) tracker: AsyncTaskTracker,

    ref_count: bun_ptr::RefCount,
}

bun_core::intrusive_field!(FetchTasklet, inbox: HttpResultInbox<Received>);

#[derive(Default)]
struct Received {
    /// The head, the certificate or the end that the JS thread has not taken, merged, without a body.
    result: Option<HTTPClientResult<'static>>,
    /// buffer used to stream response to JS
    scheduled_response_buffer: Vec<u8>,
    /// Of the latest result.
    body_size: http::BodySize,
    /// Of the latest result.
    is_http2: bool,
    /// Of any result so far.
    can_stream: bool,
}

impl Received {
    /// `body_owned` of the last result has the bytes that are left.
    fn take_result(&mut self) -> Option<HTTPClientResult<'static>> {
        let result = self.result.as_mut()?;
        result.body_size = self.body_size;
        if !result.has_more {
            result.body_owned = core::mem::take(&mut self.scheduled_response_buffer);
        }
        self.result.take()
    }
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
        let body_value = body::extract(cx.global(), value)?;
        body_value.to_blob_if_in_memory();
        if body_value.tag() == body::Tag::Locked {
            return Ok(HTTPRequestBody::ReadableStream(body_value.take_readable()));
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
    let this = unsafe { RefPtr::init_ref(this) };
    match cause {
        jsc::AbortCause::Signal(reason) => this.abort_listener(reason),
        jsc::AbortCause::ContextStopped(jsc::StopReason::VmTeardown) => {
            this.abort_task();
            this.detach_native_request_body_sink();
        }
        // The VM keeps running, so the final progress update cancels the request body sink.
        jsc::AbortCause::ContextStopped(_) => this.abort_task(),
    }
});

impl Drop for FetchTasklet {
    fn drop(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "deinit");
        self.async_http_id.set(None);
        self.clear_response();
        self.native_response.set(None);
        self.clear_stream_handlers();
        self.fetch_session = None;
        self.clear_abort_signal();
        self.clear_sink();
    }
}

impl FetchTasklet {
    /// True iff an attached AbortSignal has fired.
    #[inline]
    pub(crate) fn signal_aborted(&self) -> bool {
        self.abort_handle.signal_aborted()
    }

    fn sink(&self) -> Option<RefPtr<FetchRequestBodySink>> {
        self.sink.with_taken(|sink| sink.clone())
    }

    fn native_response(&self) -> Option<RefPtr<Response>> {
        self.native_response.with_taken(|response| response.clone())
    }

    fn clear_response(&self) {
        if let Some(response) = self.response.get() {
            response.clear();
        }
    }

    fn take_request_stream_ref(&self) -> Option<RefPtr<Self>> {
        self.sink()?.task.take()
    }

    fn clear_sink(&self) {
        if let Some(sink) = self.sink.take() {
            sink.detach(VirtualMachine::get().global());
        }
    }

    fn start_request_stream(this: &RefPtr<Self>, global_this: &JSGlobalObject) -> JsResult<()> {
        this.is_waiting_request_stream_start.set(false);
        debug_assert!(matches!(
            this.request_body,
            HTTPRequestBody::ReadableStream(_)
        ));
        let HTTPRequestBody::ReadableStream(ref stream_ref) = this.request_body else {
            return Ok(());
        };
        let Some(stream) = stream_ref.get() else {
            return Ok(());
        };
        if this.signal_aborted() {
            return stream.abort(global_this);
        }

        if stream.is_locked(global_this) || stream.is_disturbed(global_this) {
            let err = jsc::SystemError {
                code: BunString::static_(<&'static str>::from(
                    jsc::ErrorCode::ERR_STREAM_CANNOT_PIPE,
                )),
                message: BunString::static_("Stream already used, please create a new one"),
                ..Default::default()
            };
            let err_instance = err.to_error_instance(global_this);
            err_instance.ensure_still_alive();
            this.write_end_request(Some(err_instance));
            return Ok(());
        }

        let sink = FetchRequestBodySink::new(this.clone());
        this.sink.set(Some(sink.clone()));
        let sink_handle = SinkHandle::FetchRequestBody(sink.clone());

        // Native ByteStream/FileReader fast-path: wire the SinkHandle
        // directly, skipping the JS pump.
        match stream.wire_native_sink(global_this, &sink_handle, JSValue::UNDEFINED, |src| {
            sink.source.set(src);
        }) {
            crate::webcore::readable_stream::NativeWireResult::Wired => return Ok(()),
            crate::webcore::readable_stream::NativeWireResult::EndedInline(err) => {
                // The state that `end_from_stream` leaves it in.
                sink.ended.set(true);
                sink.source.set(SourceHandle::None);
                let _stream_ref = sink.task.take();
                let err_js = err.map(|err| {
                    let err_js = err.to_js(global_this);
                    err_js.ensure_still_alive();
                    err_js
                });
                this.write_end_request(err_js);
                return Ok(());
            }
            crate::webcore::readable_stream::NativeWireResult::NotNative => {}
        }

        let assignment_result =
            ReadableSinkController::assign_to_stream(global_this, stream.value, &sink);
        assignment_result.ensure_still_alive();

        if let Some(err) = assignment_result.to_error() {
            this.write_end_request(Some(err));
            this.clear_sink();
            return Ok(());
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = assignment_result.as_promise() {
                match promise.status() {
                    bun_jsc::js_promise::Status::Pending => {
                        assignment_result.then(
                            global_this,
                            this.as_ptr(),
                            Bun__FetchTasklet__onResolveRequestStream,
                            Bun__FetchTasklet__onRejectRequestStream,
                        );
                    }
                    bun_jsc::js_promise::Status::Fulfilled => {
                        let _stream_ref = sink.task.take();
                        this.write_end_request(None);
                    }
                    bun_jsc::js_promise::Status::Rejected => {
                        promise.set_handled();
                        let result = promise.result(global_this.vm());
                        let _stream_ref = sink.task.take();
                        this.write_end_request(Some(result));
                    }
                }
                return Ok(());
            }
        }

        // undefined/null: the stream drained synchronously inside assignToStream.
        let _stream_ref = sink.task.take();
        this.write_end_request(None);
        Ok(())
    }

    fn deliver_body_chunk(&self, received: &mut Received) {
        let list = &mut received.scheduled_response_buffer;
        bun_output::scoped_log!(FetchTasklet, "deliverBodyChunk length={}", list.len());
        // `on_start_streaming` took what the task was posted for. An empty chunk stalls `Readable.fromWeb()`.
        if list.is_empty() {
            return;
        }

        let size_hint = received.body_size.size_hint() as BlobSizeType;
        // body can be marked as used but we still need to pipe the data
        if let Some(bytes) = self.response_stream.bytes() {
            bytes.size_hint.set(size_hint);
            bytes.on_data(StreamResult::Temporary(list));
            if self.response_stream.is_held() {
                self.after_body_chunk_delivered(&bytes);
            }
        } else if let Some(response) = self.native_response() {
            response.body().set_size_hint(size_hint);
            if let Some(readable) = response.get_body_readable_stream()
                && let Some(bytes) = readable.ptr.bytes()
            {
                bytes.on_data(StreamResult::Temporary(list));
            } else if response.body().tag() == body::Tag::Locked {
                // Not streaming: the bytes wait for the last result or for `on_start_streaming`.
                return;
            }
        }

        if list.capacity() > http::DECODED_BODY_RETAIN_CAP {
            *list = Vec::new();
        } else {
            list.clear();
        }
    }

    /// For the last result.
    fn on_body_received(
        &self,
        global_this: &JSGlobalObject,
        result: &mut HTTPClientResult<'static>,
    ) -> JsResult<()> {
        let success = result.is_success();
        bun_output::scoped_log!(FetchTasklet, "onBodyReceived success={}", success);

        if !success {
            let mut err = self.on_reject(global_this, result);
            let mut js_err = JSValue::ZERO;
            // if we are streaming update with error
            if let Some(bytes) = self.response_stream.take() {
                js_err = err.to_js(global_this);
                js_err.ensure_still_alive();
                bytes.on_data(StreamResult::Err(StreamError::JSValue(
                    bun_jsc::strong::Optional::create(js_err, global_this),
                )));
            }
            // A failure result is terminal (only `InFlightRequest::finish`
            // reports `fail`), so everything pending must settle
            // here: a still-streaming request-body sink does not exempt the
            // response body. Returning right after `sink.cancel()` used to
            // leave a buffered `arrayBuffer()`/`text()` promise pending
            // forever when a fetch with an in-flight streaming request body
            // was aborted mid-response.
            if self.sink.is_some() && js_err.is_empty() {
                js_err = err.to_js(global_this);
                js_err.ensure_still_alive();
            }
            // if we are buffering resolve the promise
            if let Some(response) = self.native_response() {
                // body value now owns the error
                response.body().to_error_instance(err, global_this)?;
            }
            // Cancel the request-body sink last: closing the sink signal fires
            // the controller's onClose synchronously, which can re-enter the
            // tasklet.
            if !js_err.is_empty() {
                self.cancel_request_body_sink(js_err);
            }
            return Ok(());
        }

        let size_hint = result.body_size.size_hint() as BlobSizeType;
        // Unhook before the final delivery so it cannot signal a producer that is done.
        if let Some(bytes) = self.response_stream.take() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived response_stream done");
            bytes.size_hint.set(size_hint);
            bytes.on_data(StreamResult::TemporaryAndDone(&result.body_owned));
            return Ok(());
        }

        if let Some(response) = self.native_response() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived Current Response");
            response.body().set_size_hint(size_hint);
            if let Some(readable) = response.get_body_readable_stream() {
                bun_output::scoped_log!(
                    FetchTasklet,
                    "onBodyReceived CurrentResponse BodyReadableStream"
                );
                if let Some(bytes) = readable.ptr.bytes() {
                    let _keep = jsc::EnsureStillAlive(readable.value);
                    response.detach_readable_stream(global_this);
                    bytes.on_data(StreamResult::TemporaryAndDone(&result.body_owned));
                    return Ok(());
                }
            }

            let body = response.body();
            // `BodyAbortListener::on_abort` may have set `Error` while this callback was queued.
            if body.tag() != body::Tag::Locked {
                return Ok(());
            }
            bun_output::scoped_log!(
                FetchTasklet,
                "onBodyReceived body_value length={}",
                result.body_owned.len()
            );

            // done resolve body
            let context = global_this.bun_vm().context_of(self.context);
            body.resolve(
                BodyValue::InternalBlob(InternalBlob {
                    bytes: core::mem::take(&mut result.body_owned),
                    was_string: false,
                }),
                &global_this.js_thread(context),
                Some(&response),
            )?;
        }
        Ok(())
    }

    /// # Safety
    /// As [`HttpResultInbox::take`].
    pub(crate) unsafe fn on_progress_update(this: *mut Self) -> JsResult<()> {
        jsc::mark_binding!();
        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate");
        // SAFETY: fn contract.
        unsafe { HttpResultInbox::take(this, Self::update_progress) }
    }

    fn update_progress<'a>(
        this: &'a RefPtr<Self>,
        mut received: ReceivedGuard<'a, Received>,
    ) -> JsResult<()> {
        let vm = VirtualMachine::get();
        // The response, the upload's pump and what they settle continue the script that fetched.
        let _context = vm.enter_context(this.context);
        this.is_http2.set(received.is_http2);
        // teardown forbade script: we cannot touch JS
        if !vm.script_allowed() {
            // The certificate will never be checked; release the parked
            // HTTP-thread socket instead of leaving it occupying an active
            // request slot until the idle timeout.
            if let Some(result) = &mut received.result
                && result.certificate_info.take().is_some()
                && let Some(id) = this.async_http_id.get()
            {
                http::HTTPThread::schedule_shutdown(id);
            }
            return Ok(());
        }
        let Some(global_this) = this.global_this.get() else {
            this.abandon_response_body();
            drop(received);
            this.cancel_request_body_sink(JSValue::UNDEFINED);
            return Ok(());
        };

        let can_stream = received.can_stream;
        // if we already respond the metadata and still need to process the body
        let is_waiting_body = this.is_waiting_body.get();
        let mut result = received.take_result();
        let mut received = Some(received);
        if let Some(metadata) = result.as_mut().and_then(|result| result.metadata.take()) {
            // metadata should be provided only once
            let _ = this.metadata.set(metadata);
        }

        if this.is_waiting_request_stream_start.get() && can_stream {
            received = None;
            // Fails only if the VM is being stopped.
            Self::start_request_stream(this, &global_this)?;
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
            if this.metadata.get().is_some() && !this.is_waiting_body.get() {
                vm.jsc_vm().drain_microtasks();
            }
        }

        // Only the last result matters once the response exists.
        let result = result
            .as_mut()
            .filter(|result| !(is_waiting_body && result.has_more));
        let Some(result) = result else {
            if is_waiting_body {
                // Under the lock, so that a slow sink holds back tunnels, upgrades, HTTP/2 and HTTP/3, which read on while paused.
                this.deliver_body_chunk(&mut received.unwrap_or_else(|| this.inbox.lock()));
            }
            return Ok(());
        };
        drop(received);
        let delivered = if is_waiting_body {
            this.on_body_received(&global_this, result)
        } else {
            this.deliver_progress(vm, &global_this, result)
        };
        if !result.has_more {
            // The HTTP layer will not drain the request body again.
            this.cancel_request_body_sink(JSValue::UNDEFINED);
            this.poll_ref.unref(bun_io::js_vm_ctx());
        }
        delivered
    }

    fn deliver_progress(
        &self,
        vm: &VirtualMachine,
        global_this: &JSGlobalObject,
        result: &mut HTTPClientResult<'static>,
    ) -> JsResult<()> {
        // Run the user-supplied `checkServerIdentity` callback as soon as the
        // certificate arrives. The HTTP thread parks the connection after the
        // TLS handshake (`is_waiting_for_cert_check`) and does not transmit
        // the request until this check passes, so this block must run BEFORE
        // the metadata-less early return below — the parked connection's
        // first progress update carries only the certificate (no metadata, no
        // failure) and would otherwise be dropped, leaving the socket parked
        // until the idle timeout.
        if let Some(certificate_info) = result.certificate_info.take() {
            // With `rejectUnauthorized: false` the callback still runs, like
            // Node's, but its verdict is not enforced.
            let verdict = self.run_check_server_identity(global_this, &certificate_info);
            if self.reject_unauthorized
                && !self.enforce_server_identity_verdict(global_this, verdict, result)
            {
                bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: aborted due certError");
                drop(certificate_info);
                // `check_server_identity` already set abort_reason / aborted /
                // result.fail and scheduled the shutdown of the parked
                // socket; all that is left is rejecting the promise.
                let mut promise = self.promise.take();
                if !promise.has_value() {
                    bun_output::scoped_log!(
                        FetchTasklet,
                        "onProgressUpdate: promise_value is null"
                    );
                    return Ok(());
                }
                // we need to abort the request
                let tracker = self.tracker;
                let mut err = self.on_reject(global_this, result);

                let r = promise.reject_with_async_stack(global_this, Ok(err.to_js(global_this)));
                drop(err);

                tracker.did_dispatch(global_this);
                return r;
            }
            drop(certificate_info);
            // checkServerIdentity passed: un-park the HTTP-thread connection
            // so the request is finally written to the now-verified peer. If
            // the connection already closed/failed the resume is a no-op
            // (keyed through the abort tracker).
            if let Some(id) = self.async_http_id.get() {
                http::HTTPThread::schedule_cert_check_resume(id);
            }
            // Fall through. The common case (certificate-only update) returns
            // at the metadata-less early return below; the #27275 coalesced
            // case — the connection failed after the handshake but before
            // response headers arrived, so the certificate_info from the
            // first progress update was merged into the later failure result
            // — falls through to the reject logic with `result.fail` set.
        }

        if self.metadata.get().is_none() && result.is_success() {
            return Ok(());
        }

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit
        if self.is_waiting_abort.get() {
            return Ok(());
        }
        let mut promise = self.promise.take();

        if !promise.has_value() {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is null");
            return Ok(());
        }

        // WHATWG fetch: once the response head is available the promise
        // resolves; post-head failures (body decompression etc.) surface on
        // the body reader regardless of whether head+body arrived in one read.
        let success = result.is_success() || self.metadata.get().is_some();

        // Paired with the microtask drain after
        // startRequestStream above: the request-body sink may have set `abort_reason`
        // via writeEndRequest while the HTTP result is still a success — server HEADERS
        // raced ahead of the scheduled shutdown. Reject with that reason instead of
        // resolving a 200 Response. Makes wpt-h2 number-chunk test deterministic.
        if success && self.abort_reason.is_some() {
            let tracker = self.tracker;
            // get_abort_error consumes abort_reason and clears the signal handler.
            let mut err = self.get_abort_error(global_this).unwrap();
            let r = promise.reject_with_async_stack(global_this, Ok(err.to_js(global_this)));
            drop(err);
            tracker.did_dispatch(global_this);
            return r;
        }

        let tracker = self.tracker;
        tracker.will_dispatch(global_this);

        let held = if success {
            let resolved = self.on_resolve(global_this, result);
            // Cancel the request-body sink last (as on_body_received does):
            // closing the sink signal runs the user's cancel callback
            // synchronously, so the body error must already be stored.
            if result.fail.is_some() && self.sink.is_some() {
                let mut err = self.on_reject(global_this, result);
                let err_js = err.to_js(global_this);
                err_js.ensure_still_alive();
                self.cancel_request_body_sink(err_js);
            }
            StrongOptional::create(resolved, global_this)
        } else {
            // in this case we wanna a jsc.Strong.Optional so we just convert it
            let mut value = self.on_reject(global_this, result);
            let err_js = value.to_js(global_this);
            self.cancel_request_body_sink(err_js);
            // `to_js` leaves `value` in the `JSValue(Strong)` state. Move
            // that Strong out instead of allocating a
            // second one.
            let BodyValueError::JSValue(strong) = value else {
                unreachable!("ValueError::to_js leaves self in JSValue state");
            };
            strong
        };

        let holder = Box::new(FetchTaskletPromiseSettle {
            held,
            // we need the promise to be alive until the task is done
            promise,
            global_object: GlobalRef::from(global_this),
            success,
            context: self.context,
        });
        vm.event_loop().enqueue_task(Task::from_boxed(holder));

        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is not null");
        tracker.did_dispatch(global_this);
        Ok(())
    }

    /// `Ok` when the callback approved the certificate; `Err(Some(error))`
    /// with the reason when it did not; `Err(None)` when there was no
    /// certificate to show it.
    fn run_check_server_identity(
        &self,
        global_this: &JSGlobalObject,
        certificate_info: &CertificateInfo,
    ) -> Result<(), Option<JSValue>> {
        let Some(check_server_identity) = self.check_server_identity_callback() else {
            return Err(None);
        };
        check_server_identity.ensure_still_alive();
        if certificate_info.cert.is_empty() {
            return Err(None);
        }
        let x509 = OwnedX509::from_der(&certificate_info.cert).ok_or(None)?;
        let js_cert =
            X509::to_js(&x509, global_this).map_err(|e| Some(global_this.take_exception(e)))?;
        let js_hostname: JSValue =
            bun_string_jsc::create_utf8_for_js(global_this, &certificate_info.hostname)
                .map_err(|e| Some(global_this.take_exception(e)))?;
        js_hostname.ensure_still_alive();
        js_cert.ensure_still_alive();
        let check_result = match check_server_identity.call(
            global_this,
            JSValue::UNDEFINED,
            &[js_hostname, js_cert],
        ) {
            Ok(v) => v,
            Err(e) => return Err(Some(global_this.take_exception(e))),
        };

        // > Returns <Error> object [...] on failure
        // Any object counts: a DOMException or a util.inherits() error is not an ErrorInstance cell.
        if check_result.is_object() && check_result.as_promise().is_none() {
            return Err(Some(check_result));
        }
        // Like Node, fail on any other truthy value, a Promise included: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1671-L1688
        if check_result.to_boolean() {
            let received = JSGlobalObject::determine_specific_type(global_this, check_result)
                .map_err(|e| Some(global_this.take_exception(e)))?;
            return Err(Some(
                global_this
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
    fn enforce_server_identity_verdict(
        &self,
        global_this: &JSGlobalObject,
        verdict: Result<(), Option<JSValue>>,
        result: &mut HTTPClientResult<'_>,
    ) -> bool {
        match verdict {
            Ok(()) => true,
            Err(Some(reason)) => {
                // mark to wait until deinit
                self.is_waiting_abort.set(result.has_more);
                self.abort_reason.set(global_this, reason);
                self.abort_task();
                result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
                false
            }
            Err(None) => {
                // Every false return must have scheduled the parked socket's shutdown.
                if let Some(id) = self.async_http_id.get() {
                    http::HTTPThread::schedule_shutdown(id);
                }
                result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
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

    fn get_abort_error(&self, global_this: &JSGlobalObject) -> Option<BodyValueError> {
        if self.abort_reason.is_some() {
            let out = self.abort_reason.take().into();
            self.clear_abort_signal();
            return Some(BodyValueError::JSValue(out));
        }

        let reason = self.abort_handle.signal_reason_if_aborted(global_this)?;
        let out = match reason {
            jsc::abort_signal::AbortReason::Common(r) => BodyValueError::AbortReason(r),
            jsc::abort_signal::AbortReason::Js(v) => {
                BodyValueError::JSValue(StrongOptional::create(v, global_this))
            }
        };
        self.clear_abort_signal();
        Some(out)
    }

    fn clear_abort_signal(&self) {
        self.abort_handle.unfollow();
    }

    fn on_reject(
        &self,
        global_this: &JSGlobalObject,
        result: &HTTPClientResult<'_>,
    ) -> BodyValueError {
        debug_assert!(result.fail.is_some());
        bun_output::scoped_log!(FetchTasklet, "onReject");

        if let Some(err) = self.get_abort_error(global_this) {
            return err;
        }

        if let Some(reason) = result.abort_reason() {
            return BodyValueError::AbortReason(reason);
        }

        let fail = result.fail.unwrap();

        if fail == http::Error::RequestBodyNotReusable {
            return BodyValueError::TypeError(BunString::static_(
                "Request body is a ReadableStream and cannot be replayed for this redirect",
            ));
        }

        if fail == http::Error::ProxyConnectFailed {
            if let Some(metadata) = &result.proxy_connect_response {
                let error = Self::proxy_connect_error(global_this, metadata)
                    .unwrap_or_else(|e| global_this.take_exception(e));
                return BodyValueError::JSValue(StrongOptional::create(error, global_this));
            }
        }

        if fail == http::Error::RequestBodyLengthMismatch
            && let Some(declared) = self.declared_request_body_len
        {
            let written = self.request_body_len_written.get();
            let err = global_this
                .err(
                    jsc::ErrorCode::ERR_HTTP_CONTENT_LENGTH_MISMATCH,
                    format_args!(
                        "Request body of {written} bytes does not match the Content-Length of {declared}"
                    ),
                )
                .to_js();
            return BodyValueError::JSValue(StrongOptional::create(err, global_this));
        }

        // some times we don't have metadata so we also check the request's URL
        // Without the URL's userinfo: errors get logged.
        let href = match self.metadata.get() {
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
            if let Some(dns_err) = c_ares::Error::init_eai(result.dns_error) {
                // `dns_hostname` is the owned copy of the exact name the
                // connect resolved (proxy or post-redirect target), captured
                // on the HTTP thread.
                let hostname: &[u8] = result.dns_hostname.as_deref().unwrap_or(b"");
                let mut err = crate::dns_jsc::cares_jsc::system_error_with_syscall_and_hostname(
                    dns_err,
                    b"getaddrinfo",
                    hostname,
                );
                err.path = path;
                return BodyValueError::SystemTypeError(Box::new(err));
            }
        }

        // Socket-level failures carry the errno name `node:net` would report.
        let code: &'static str = match fail {
            http::Error::ConnectionClosed => "ECONNRESET",
            http::Error::Timeout => "ETIMEDOUT",
            http::Error::ConnectionRefused => {
                Self::connect_errno_name(result).unwrap_or("ECONNREFUSED")
            }
            http::Error::FailedToOpenSocket => {
                Self::connect_errno_name(result).unwrap_or_else(|| fail.name())
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

        BodyValueError::SystemTypeError(Box::new(fetch_error))
    }

    fn connect_errno_name(result: &HTTPClientResult<'_>) -> Option<&'static str> {
        if result.connect_errno == 0 {
            return None;
        }
        bun_sys::SystemErrno::init(i64::from(result.connect_errno)).map(Into::into)
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
        let headers = HeadersRef::create_from_pico_headers(response.headers().list);
        error.put(
            global_this,
            b"headers".as_slice(),
            headers.to_js(global_this),
        );
        Ok(error)
    }

    pub(crate) fn on_readable_stream_available(&self, readable: ReadableStream) {
        if let crate::webcore::readable_stream::Source::Bytes(bytes) = readable.ptr {
            // SAFETY: the caller holds the stream, which owns the live ByteStream. JS thread.
            unsafe { self.response_stream.hold(bytes) };
        } else {
            self.response_stream.release();
        }
    }

    pub(crate) fn on_start_streaming(&self) -> DrainResult {
        if self.inbox.signal_store.aborted.load(Ordering::Relaxed) {
            return DrainResult::Aborted;
        }

        // A body consumer is attaching; keep the process alive until the
        // body finishes (undone in `on_progress_update` when `is_done`), or
        // until the stream parks unread (`park_body_stream`).
        self.poll_ref.ref_(bun_io::js_vm_ctx());

        let mut received = self.inbox.lock();
        let size_hint = received.body_size.size_hint();
        let drained = core::mem::take(&mut received.scheduled_response_buffer);
        drop(received);

        // After the take, not before: a chunk the HTTP thread appends (and pauses for) in
        // between would otherwise reach the stream with its task finding the buffer empty, and
        // nothing left to undo that pause. Unconditional: also flushes body bytes the client
        // holds that arrived with no follow-up read (`drain_response_body`).
        self.inbox.signal_store.receive_on_demand();
        self.schedule_receive_resume();

        if drained.is_empty() {
            DrainResult::EstimatedSize(size_hint)
        } else {
            DrainResult::Owned {
                list: drained,
                size_hint,
            }
        }
    }

    /// Unhook from the response ByteStream (the stream can outlive us in JS). Touches no JS cell.
    fn clear_stream_handlers(&self) {
        self.response_stream.release();
    }

    /// reader.cancel() / body.cancel(): the server has to see the close (Node, Deno and browsers
    /// abort too).
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
        if self.inbox.signal_store.unpause_receive() {
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
            AfterDelivery::Pause => self.inbox.signal_store.pause_receive(),
            AfterDelivery::Park => {
                self.inbox.signal_store.pause_receive();
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

    pub(crate) fn on_start_buffering(&self) {
        self.poll_ref.ref_(bun_io::js_vm_ctx());
        if self.inbox.signal_store.receive_all() {
            self.schedule_receive_resume();
        }
    }

    fn schedule_receive_resume(&self) {
        if let Some(id) = self.async_http_id.get() {
            http::HTTPThread::schedule_receive_resume(id);
        }
    }

    fn to_body_value(
        &self,
        global_this: &JSGlobalObject,
        result: &mut HTTPClientResult<'_>,
    ) -> BodyValue {
        if let Some(err) = self.get_abort_error(global_this) {
            return BodyValue::Error(err);
        }
        if result.fail.is_some() {
            // Head received but body failed in the same callback; surface on
            // the body so this matches the split-read `on_body_received` path.
            return BodyValue::Error(self.on_reject(global_this, result));
        }
        if self.is_waiting_body.get() {
            return BodyValue::from_producer(
                SourceHandle::FetchResponseBody(BackRef::new(self)),
                result.body_size.size_hint() as BlobSizeType,
                global_this,
            );
        }

        BodyValue::InternalBlob(InternalBlob {
            bytes: core::mem::take(&mut result.body_owned),
            was_string: false,
        })
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
    fn null_body_value(&self, has_more: bool) -> BodyValue {
        if has_more {
            self.abandon_response_body();
        }
        BodyValue::Null
    }

    fn to_response(
        &self,
        global_this: &JSGlobalObject,
        result: &mut HTTPClientResult<'_>,
    ) -> Response {
        bun_output::scoped_log!(FetchTasklet, "toResponse");
        // at this point we always should have metadata
        let metadata = self.metadata.get().unwrap();
        let headers = HeadersRef::create_from_pico_headers(metadata.headers().list);
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
        let redirected = result.redirected;
        let body = if self.response_body_is_null(status_code) {
            self.null_body_value(result.has_more)
        } else {
            self.is_waiting_body.set(result.has_more);
            self.to_body_value(global_this, result)
        };
        Response::init(
            crate::webcore::response::Init {
                headers: Cell::new(Some(headers)),
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
    /// response; `store_result` drops whatever still arrives. Safe inside a GC sweep
    /// (`on_response_finalize`, `on_body_stream_collected`): no JS cell is touched; the
    /// request-body sink is left for `clear_sink()` in `drop()`.
    fn abandon_response_body(&self) {
        bun_output::scoped_log!(FetchTasklet, "abandonResponseBody");
        self.inbox.signal_store.abandon();
        self.abort_transport();
        self.poll_ref.unref(bun_io::js_vm_ctx());
        self.clear_stream_handlers();
        self.clear_response();
        self.native_response.set(None);
    }

    fn on_resolve(
        &self,
        global_this: &JSGlobalObject,
        result: &mut HTTPClientResult<'_>,
    ) -> JSValue {
        bun_output::scoped_log!(FetchTasklet, "onResolve");
        let response = RefPtr::new(self.to_response(global_this, result));
        // A paused transport does not keep the event loop alive until the caller reads the body.
        if self.is_waiting_body.get() {
            self.poll_ref.unref(bun_io::js_vm_ctx());
        }
        let response_js = Response::to_js(response.clone(), global_this);
        response_js.ensure_still_alive();
        // SAFETY: `self` is on the heap and owns the handle.
        let weak = unsafe {
            jsc::Weak::create(
                response_js,
                global_this,
                jsc::WeakRefType::FetchResponse,
                self,
            )
        };
        let _ = self.response.set(weak);
        // Response-owned listener so abort still errors the body after this tasklet detaches its own.
        if let Some(signal) = self.abort_handle.signal() {
            Response::attach_abort_signal(&response, global_this, signal, self.context);
        }
        self.native_response.set(Some(response));
        response_js
    }

    pub(crate) fn queue(
        cx: &bun_jsc::JsThread<'_>,
        mut fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) {
        let sendfile = fetch_options.body.take_sendfile();
        // enable streaming the write side
        let is_stream = matches!(fetch_options.body, HTTPRequestBody::ReadableStream(_));
        let framing = fetch_options.stream_framing;

        let fetch_tasklet = Box::new(FetchTasklet {
            sink: Cell::new(None),
            async_http_id: Cell::new(None),
            method: fetch_options.method,
            inbox: HttpResultInbox::new(http::signals::Store::unclaimed(), Received::default()),
            metadata: OnceCell::new(),
            is_http2: Cell::new(false),
            global_this: WeakGlobalRef::new(cx.global()),
            request_body: fetch_options.body,
            request_body_streaming_buffer: Guarded::default(),
            response: OnceCell::new(),
            native_response: Cell::new(None),
            response_stream: Default::default(),
            request_headers_buf: fetch_options.headers.buf,
            // An upgraded connection tunnels its "body", so those bytes are not counted.
            declared_request_body_len: framing
                .content_length
                .filter(|_| is_stream && !fetch_options.upgraded_connection),
            request_body_len_written: Cell::new(0),
            request_body_mismatched: Cell::new(false),
            promise: Cell::new(promise),
            poll_ref: KeepAlive::default(),
            url_proxy_buffer: fetch_options.url_proxy_buffer,
            url_len: fetch_options.url_len,
            abort_handle: jsc::AbortHandle::for_owner::<FetchTasklet>(),
            context: cx.context().id(),
            abort_reason: StrongCell::default(),
            check_server_identity: fetch_options.check_server_identity,
            fetch_session: fetch_options.fetch_session,
            session_check_server_identity: fetch_options.session_check_server_identity,
            reject_unauthorized: fetch_options.reject_unauthorized,
            upgraded_connection: fetch_options.upgraded_connection,
            unix_socket_path: fetch_options.unix_socket_path,
            is_waiting_body: Cell::new(false),
            is_waiting_abort: Cell::new(false),
            is_waiting_request_stream_start: Cell::new(is_stream),
            tracker: AsyncTaskTracker::init(cx.vm()),
            ref_count: bun_ptr::RefCount::init(),
        });

        fetch_tasklet.tracker.did_schedule(cx.global());

        let env = cx.vm().env_loader();
        // Capture the proxy env so the HTTP thread can re-resolve per redirect
        // hop (`HTTPClient::reevaluate_proxy_for_redirect`). `ProxySettings`
        // owns copies of the env values, so a later `process.env.HTTP_PROXY =
        // ...` on the JS thread cannot invalidate them mid-request.
        let proxy_settings: Option<Box<http::ProxySettings>> = match &fetch_options.proxy {
            ProxyPolicy::Direct => None,
            ProxyPolicy::Explicit { respect_no_proxy } => http::ProxySettings::from_explicit(
                &fetch_tasklet.url_proxy_buffer[fetch_tasklet.url_len..],
                env,
                *respect_no_proxy,
            ),
            // A unix socket is the whole route; the proxy env never applies to it.
            ProxyPolicy::Env if !fetch_tasklet.unix_socket_path.is_empty() => None,
            ProxyPolicy::Env => http::ProxySettings::from_env(env),
        };

        // The callback keeps a request on HTTP/1.1. Under `rejectUnauthorized:
        // false` its verdict is not enforced, so a request pinned to h2/h3
        // goes ahead without it.
        let advisory_on_pinned_protocol = !fetch_tasklet.reject_unauthorized
            && matches!(
                fetch_options.forced_protocol,
                Some(http::Protocol::Http2 | http::Protocol::Http3)
            );
        let cert_errors = (fetch_tasklet.check_server_identity.has()
            || fetch_tasklet.session_check_server_identity)
            && !advisory_on_pinned_protocol;

        let drain_task: fn(*mut FetchTasklet) -> Task =
            |this| Task::init(this.cast::<FetchTaskletRequestDrain>());
        let drain_task = is_stream.then_some(drain_task);

        HttpResultInbox::schedule(cx, fetch_tasklet, drain_task, |fetch_tasklet| {
            let signal_store = &fetch_tasklet.inbox.signal_store;
            let mut signals = signal_store.to_with_backpressure();
            if cert_errors {
                signal_store.cert_errors.store(true, Ordering::Relaxed);
            } else {
                signals.cert_errors = None;
            }
            // we want to return after headers are received
            signal_store.header_progress.store(true, Ordering::Relaxed);

            let url = ZigURL::parse(&fetch_tasklet.url_proxy_buffer[..fetch_tasklet.url_len]);
            debug_assert!(sendfile.is_none() || url.is_http());

            let mut http = AsyncHTTP::init(
                fetch_options.method,
                url,
                fetch_options.headers.entries,
                &fetch_tasklet.request_headers_buf,
                fetch_tasklet.request_body.slice(),
                fetch_options.redirect_type,
                http::async_http::Options {
                    http_proxy: None,
                    proxy_settings,
                    proxy_headers: fetch_options.proxy_headers,
                    signals: Some(signals),
                    unix_socket_path: Some(&fetch_tasklet.unix_socket_path),
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
                    redirect_credentials: None,
                    yields_to_other_requests: false,
                },
            );
            fetch_tasklet.async_http_id.set(Some(http.async_http_id));
            http.client.flags.is_streaming_request_body = is_stream;
            http.client.flags.forced_protocol = fetch_options.forced_protocol;
            http.client.flags.is_node_http_client = fetch_options.is_node_http_client;
            if is_stream {
                http.request_body =
                    http::HTTPRequestBody::Stream(http::http_request_body::Stream {
                        buffer: Some(&fetch_tasklet.request_body_streaming_buffer),
                        ended: false,
                        framing,
                    });
            }
            // TODO is this necessary? the http client already sets the redirect type
            if fetch_options.redirect_type != FetchRedirect::Follow {
                http.client.remaining_redirect_count = 0;
            }

            if let Some(sendfile) = sendfile {
                debug_assert!(!matches!(fetch_options.proxy, ProxyPolicy::Explicit { .. }));
                http.request_body = http::HTTPRequestBody::Sendfile(sendfile);
            }

            if let Some(signal) = fetch_options.signal {
                // SAFETY: the tasklet is heap-allocated and drops its handle with itself.
                unsafe { jsc::AbortHandle::follow_owner(fetch_tasklet.as_ptr(), signal) };
            }
            fetch_tasklet.poll_ref.ref_(bun_io::js_vm_ctx());
            http
        });
    }

    pub(crate) fn abort_listener(&self, reason: JSValue) {
        bun_output::scoped_log!(FetchTasklet, "abortListener");
        let this = self;
        reason.ensure_still_alive();
        this.abort_reason
            .set(VirtualMachine::get().global(), reason);
        this.abort_task();
        if this.sink.is_some() {
            this.cancel_request_body_sink(reason);
            return;
        }
        // Abort fired before the HTTP thread asked for the body, so the
        // ReadableStream was never wired into a sink. Cancel it directly so
        // the underlying source's cancel(reason) callback still observes the
        // signal's reason (https://fetch.spec.whatwg.org/#abort-fetch step 5).
        if this.is_waiting_request_stream_start.get() {
            if let HTTPRequestBody::ReadableStream(stream_ref) = &this.request_body {
                this.is_waiting_request_stream_start.set(false);
                if let Some(stream) = stream_ref.get()
                    && let Some(global_this) = this.global_this.get()
                {
                    crate::dispatch::fold(stream.cancel_with_reason(&global_this, reason));
                }
            }
        }
    }

    /// # Safety
    /// As [`HttpResultInbox::take_drain`].
    pub(crate) unsafe fn resume_request_data_stream(this: *mut Self) {
        bun_output::scoped_log!(FetchTasklet, "resumeRequestDataStream");
        // SAFETY: fn contract.
        let this = unsafe { HttpResultInbox::<Received>::take_drain(this) };
        if !this.signal_aborted()
            && let Some(sink) = this.sink()
        {
            sink.on_drain();
        }
    }

    /// True for upgraded connections, HTTP/2 (DATA frames) and `Content-Length` framing.
    pub(crate) fn skip_chunked_framing(&self) -> bool {
        self.upgraded_connection || self.is_http2.get() || self.declared_request_body_len.is_some()
    }

    /// The HTTP thread decides: only it knows whether a followed redirect already dropped the body.
    fn report_content_length_mismatch(&self, written: u64) {
        self.request_body_len_written.set(written);
        self.request_body_mismatched.set(true);
        if let Some(id) = self.async_http_id.get() {
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
        &self,
        data: EncodedChunk<'_>,
        high_water_mark: usize,
    ) -> Writable<'static> {
        if self.signal_aborted() || self.request_body_mismatched.get() {
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
                .get()
                .saturating_add(utf8_len as u64);
            if written > declared {
                self.report_content_length_mismatch(written);
                return Writable::Err(bun_sys::Error::from_code(
                    bun_sys::E::ECANCELED,
                    bun_sys::Tag::write,
                ));
            }
            self.request_body_len_written.set(written);
        }
        let len = utf8_len as BlobSizeType;
        let mut stream_buffer = self.request_body_streaming_buffer.lock();

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
                self.async_http_id.get().unwrap(),
                http::http_thread::WriteMessageType::Data,
            );
        }

        // pause the stream if we hit the high water mark
        result
    }

    pub(crate) fn write_end_request(&self, err: Option<JSValue>) {
        bun_output::scoped_log!(FetchTasklet, "writeEndRequest hasError? {}", err.is_some());
        if self.request_body_mismatched.get() {
            // The pump ending on the `Writable::Err` the mismatch gave it; already reported.
            return;
        }
        if let Some(js_error) = err {
            if self.inbox.signal_store.aborted.load(Ordering::Relaxed)
                || self.abort_reason.is_some()
            {
                return;
            }
            if !js_error.is_undefined_or_null() {
                self.abort_reason
                    .set(VirtualMachine::get().global(), js_error);
            }
            self.abort_task();
        } else {
            if self.inbox.signal_store.aborted.load(Ordering::Relaxed) {
                return;
            }
            // Short of the announced length, the peer would wait for the rest forever.
            let written = self.request_body_len_written.get();
            if let Some(declared) = self.declared_request_body_len
                && written < declared
            {
                self.report_content_length_mismatch(written);
                return;
            }
            if !self.skip_chunked_framing() {
                // Using chunked transfer encoding, send the terminating chunk
                let _ = self
                    .request_body_streaming_buffer
                    .lock()
                    .write(http::END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY); // OOM/capacity: fire-and-forget
            }
            if let Some(id) = self.async_http_id.get() {
                http::HTTPThread::schedule_request_write(
                    id,
                    http::http_thread::WriteMessageType::End,
                );
            }
        }
    }

    fn abort_task(&self) {
        if self.abort_transport()
            && let Some(global_this) = self.global_this.get()
        {
            self.tracker.did_cancel(&global_this);
        }
    }

    /// Idempotent: an AbortSignal, VM teardown and `abandon_response_body` can all reach here for
    /// the same fetch. Only the first enqueues a shutdown. No JS.
    fn abort_transport(&self) -> bool {
        if self
            .inbox
            .signal_store
            .aborted
            .swap(true, Ordering::Relaxed)
        {
            return false;
        }
        if let Some(id) = self.async_http_id.get() {
            http::HTTPThread::schedule_shutdown(id);
        }
        true
    }

    /// Cancel an in-flight request-body sink: stores the abort reason, aborts
    /// the HTTP task, marks the sink ended/done, and fires the controller's
    /// onClose (which cancels the upstream ReadableStream reader).
    pub(crate) fn cancel_request_body_sink(&self, reason: JSValue) {
        let Some(sink) = self.sink() else {
            return;
        };
        if sink.ended.get() {
            return;
        }
        sink.ended.set(true);
        sink.done.set(true);
        let is_native = matches!(
            sink.source.get(),
            SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
        );
        if !reason.is_empty_or_undefined_or_null() && !self.abort_reason.is_some() {
            self.abort_reason
                .set(VirtualMachine::get().global(), reason);
        }
        self.abort_task();
        sink.pending.run_done();
        sink.source.get().close(None);
        if is_native {
            // No pump promise will settle.
            sink.task.set(None);
        }
    }

    /// Ends a request body sink that's wired to a native source. VM teardown drops the progress
    /// update without running it and destroys the source without ending its sink. A sink fed by
    /// a JS pump is finalized by its controller cell instead.
    fn detach_native_request_body_sink(&self) {
        let Some(sink) = self.sink() else { return };
        if sink.ended.get()
            || !matches!(
                sink.source.get(),
                SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
            )
        {
            return;
        }
        sink.ended.set(true);
        sink.done.set(true);
        sink.source.take().detach(VirtualMachine::get().global());
        sink.task.set(None);
    }
}

impl StoreResult for Received {
    fn store_result(
        &mut self,
        signal_store: &http::signals::Store,
        result: &mut HTTPClientResult<'_>,
    ) -> bool {
        bun_output::scoped_log!(
            FetchTasklet,
            "callback success={} receive_mode={:?} has_more={} bytes={}",
            result.is_success(),
            signal_store.body_receive_mode(),
            result.has_more,
            result.body.len()
        );

        self.body_size = result.body_size;
        self.is_http2 = result.is_http2;
        self.can_stream |= result.can_stream;
        if !result.has_more || result.metadata.is_some() || result.certificate_info.is_some() {
            // One-shot fields that the JS thread has not taken.
            if let Some(prev) = &mut self.result {
                if result.certificate_info.is_none() {
                    result.certificate_info = prev.certificate_info.take();
                }
                if prev.metadata.is_some() {
                    result.metadata = prev.metadata.take();
                }
            }
            self.result = Some(HTTPClientResult {
                body: &[],
                body_owned: Vec::new(),
                certificate_info: result.certificate_info.take(),
                metadata: result.metadata.take(),
                dns_hostname: result.dns_hostname.take(),
                proxy_connect_response: result.proxy_connect_response.take(),
                ..*result
            });
        }

        let success = result.is_success();
        let scheduled = &mut self.scheduled_response_buffer;

        if signal_store.body_receive_mode() == BodyReceiveMode::Abandoned {
            if scheduled.capacity() > 0 {
                *scheduled = Vec::new();
            }
            return !(success && result.has_more);
        }
        if success {
            if result.body.is_empty() && !result.body_owned.is_empty() && scheduled.is_empty() {
                core::mem::swap(scheduled, &mut result.body_owned);
            } else {
                // Grow to Content-Length once so the per-packet append below
                // doesn't leave the ~2x doubling over-capacity that the
                // ArrayBuffer would adopt. Only for a consumer that wants the whole body.
                if signal_store.body_receive_mode() == BodyReceiveMode::BufferAll
                    && let http::BodySize::ContentLength(n) = result.body_size
                    && n > scheduled.capacity()
                {
                    let additional = n
                        .min(SCHEDULED_PRERESERVE_MAX)
                        .saturating_sub(scheduled.len());
                    let _ = scheduled.try_reserve_exact(additional);
                }
                scheduled.extend_from_slice(result.body_bytes());
            }
            if result.has_more && scheduled.len() >= BODY_HIGH_WATER_MARK {
                signal_store.pause_receive();
            }
        }
        true
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
    pub(crate) fn on_response_finalize(&self) {
        bun_output::scoped_log!(FetchTasklet, "onResponseFinalize");
        let Some(response) = self.native_response() else {
            return;
        };
        if response.body().tag() != body::Tag::Locked {
            // The body arrived or failed; nothing is underway.
            return;
        }
        // What can outlive the Response and still take the body: its stream (whose own collection
        // is `on_body_stream_collected`), or the promise of `.text()` and friends.
        let outlived = self.response_stream.is_held() || response.body().has_promise();
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
    pub(crate) verbose: http::HTTPVerboseLevel,
    pub(crate) redirect_type: FetchRedirect,
    pub(crate) proxy: ProxyPolicy,
    pub(crate) proxy_headers: Option<Headers>,
    pub(crate) url_proxy_buffer: Box<[u8]>,
    pub(crate) url_len: usize,
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
    /// What follows the URL in `url_proxy_buffer`, for every hop `NO_PROXY` does not
    /// exempt when it is respected.
    Explicit { respect_no_proxy: bool },
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
        let prom = self.promise.get();
        let res = self.held.swap();
        res.ensure_still_alive();
        if self.success {
            prom.resolve(&self.global_object, res)
        } else {
            prom.reject_with_async_stack(&self.global_object, Ok(res))
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
