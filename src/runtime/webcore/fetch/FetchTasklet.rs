use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use bun_aio::KeepAlive;
use bun_boringssl as boringssl;
use bun_core::{err, Error as BunError};
use bun_http as http;
use bun_http::{AsyncHTTP, CertificateInfo, FetchRedirect, HTTPClientResult, HTTPResponseMetadata, Headers, Signals, ThreadSafeStreamBuffer};
use bun_http_types::Method;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::{self as jsc, AnyTask, ConcurrentTask, JSGlobalObject, JSPromise, JSValue, JsResult, Strong, Task, VirtualMachine, ZigString};
use bun_str::{self as strings, MutableString, String as BunString};
use bun_threading::{Mutex, ThreadPool};
use bun_url::URL as ZigURL;

use crate::api::bun::x509 as X509;
use crate::api::server::ServerConfig::SSLConfig;
use crate::webcore::blob::{AnyBlob, Blob, BlobSizeType, BlobStore};
use crate::webcore::body::{self, Body, BodyValue, BodyValueError};
use crate::webcore::readable_stream::{self, ReadableStream, ReadableStreamStrong};
use crate::webcore::{AbortSignal, DrainResult, FetchHeaders, Response, ResumableFetchSink, ResumableSinkBackpressure};

bun_output::declare_scope!(FetchTasklet, visible);

pub type ResumableSink = ResumableFetchSink;

pub struct FetchTasklet {
    pub sink: Option<Arc<ResumableFetchSink>>,
    pub http: Option<Box<AsyncHTTP>>,
    pub result: HTTPClientResult,
    pub metadata: Option<HTTPResponseMetadata>,
    pub javascript_vm: &'static VirtualMachine,
    pub global_this: &'static JSGlobalObject, // TODO(port): JSC_BORROW lifetime; using 'static to match javascript_vm
    pub request_body: HTTPRequestBody,
    pub request_body_streaming_buffer: Option<Arc<ThreadSafeStreamBuffer>>,

    /// buffer being used by AsyncHTTP
    pub response_buffer: MutableString,
    /// buffer used to stream response to JS
    pub scheduled_response_buffer: MutableString,
    /// response weak ref we need this to track the response JS lifetime
    pub response: jsc::Weak<FetchTasklet>,
    /// native response ref if we still need it when JS is discarted
    pub native_response: Option<Arc<Response>>,
    pub ignore_data: bool,
    /// stream strong ref if any is available
    pub readable_stream_ref: ReadableStreamStrong,
    pub request_headers: Headers,
    pub promise: jsc::JSPromiseStrong,
    pub concurrent_task: ConcurrentTask,
    pub poll_ref: KeepAlive,
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    pub body_size: http::BodySize,

    /// This is url + proxy memory buffer and is owned by FetchTasklet
    /// We always clone url and proxy (if informed)
    pub url_proxy_buffer: Box<[u8]>,

    pub signal: Option<Arc<AbortSignal>>,
    pub signals: Signals,
    pub signal_store: http::SignalsStore,
    pub has_schedule_callback: AtomicBool,

    // must be stored because AbortSignal stores reason weakly
    pub abort_reason: Strong,

    // custom checkServerIdentity
    pub check_server_identity: Strong,
    pub reject_unauthorized: bool,
    pub upgraded_connection: bool,
    // Custom Hostname
    pub hostname: Option<Box<[u8]>>,
    pub is_waiting_body: bool,
    pub is_waiting_abort: bool,
    pub is_waiting_request_stream_start: bool,
    pub mutex: Mutex,

    pub tracker: AsyncTaskTracker,

    pub ref_count: AtomicU32,
}

pub enum HTTPRequestBody {
    AnyBlob(AnyBlob),
    Sendfile(http::SendFile),
    ReadableStream(ReadableStreamStrong),
}

impl HTTPRequestBody {
    pub const EMPTY: HTTPRequestBody = HTTPRequestBody::AnyBlob(AnyBlob::Blob(Blob::EMPTY));

    pub fn store(&mut self) -> Option<&mut BlobStore> {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.store(),
            _ => None,
        }
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.slice(),
            _ => b"",
        }
    }

    pub fn detach(&mut self) {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.detach(),
            HTTPRequestBody::ReadableStream(stream) => {
                stream.deinit();
            }
            HTTPRequestBody::Sendfile(sendfile) => {
                if sendfile.offset.max(sendfile.remain) > 0 {
                    sendfile.fd.close();
                }
                sendfile.offset = 0;
                sendfile.remain = 0;
            }
        }
    }

    pub fn from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<HTTPRequestBody> {
        let mut body_value = BodyValue::from_js(global_this, value)?;
        if matches!(body_value, BodyValue::Used)
            || (matches!(&body_value, BodyValue::Locked(l) if l.action != body::Action::None || l.is_disturbed2(global_this)))
        {
            return Err(global_this.ERR(jsc::ErrorCode::BODY_ALREADY_USED, "body already used").throw());
        }
        if let BodyValue::Locked(locked) = &body_value {
            if locked.readable.has() {
                // just grab the ref
                // TODO(port): partial move out of body_value.Locked.readable
                if let BodyValue::Locked(l) = body_value {
                    return Ok(HTTPRequestBody::ReadableStream(l.readable));
                }
                unreachable!();
            }
        }
        if matches!(&body_value, BodyValue::Locked(_)) {
            let readable = body_value.to_readable_stream(global_this)?;
            if !readable.is_empty_or_undefined_or_null() {
                if let BodyValue::Locked(l) = &body_value {
                    if l.readable.has() {
                        if let BodyValue::Locked(l) = body_value {
                            return Ok(HTTPRequestBody::ReadableStream(l.readable));
                        }
                        unreachable!();
                    }
                }
            }
        }
        Ok(HTTPRequestBody::AnyBlob(body_value.use_as_any_blob()))
    }

    pub fn needs_to_read_file(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.needs_to_read_file(),
            _ => false,
        }
    }

    pub fn is_s3(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.is_s3(),
            _ => false,
        }
    }

    pub fn has_content_type_from_user(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.has_content_type_from_user(),
            _ => false,
        }
    }

    pub fn get_any_blob(&mut self) -> Option<&mut AnyBlob> {
        match self {
            HTTPRequestBody::AnyBlob(blob) => Some(blob),
            _ => None,
        }
    }

    pub fn has_body(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.size() > 0,
            HTTPRequestBody::ReadableStream(stream) => stream.has(),
            HTTPRequestBody::Sendfile(_) => true,
        }
    }
}

impl FetchTasklet {
    pub fn ref_(&self) {
        let count = self.ref_count.fetch_add(1, Ordering::Relaxed);
        debug_assert!(count > 0);
    }

    pub fn deref(this: *mut FetchTasklet) {
        // SAFETY: caller holds a ref; ref_count > 0
        let count = unsafe { (*this).ref_count.fetch_sub(1, Ordering::Relaxed) };
        debug_assert!(count > 0);

        if count == 1 {
            // SAFETY: last ref; exclusive access
            unsafe { FetchTasklet::deinit(this) };
        }
    }

    pub fn deref_from_thread(this: *mut FetchTasklet) {
        // SAFETY: caller holds a ref; ref_count > 0
        let self_ = unsafe { &*this };
        let count = self_.ref_count.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(count > 0);

        if count == 1 {
            if self_.javascript_vm.is_shutting_down() {
                // SAFETY: last ref; exclusive access
                unsafe { FetchTasklet::deinit(this) };
                return;
            }
            // this is really unlikely to happen, but can happen
            // lets make sure that we always call deinit from main thread
            self_
                .javascript_vm
                .event_loop()
                .enqueue_task_concurrent(ConcurrentTask::from_callback(this, FetchTasklet::deinit_callback));
        }
    }

    // TODO(port): wrapper to match ConcurrentTask callback signature (was `error{}!void` coercion)
    fn deinit_callback(this: *mut FetchTasklet) {
        // SAFETY: enqueued with last ref; exclusive access on main thread
        unsafe { FetchTasklet::deinit(this) };
    }

    pub fn init() -> Result<FetchTasklet, BunError> {
        // TODO(port): Zig returned a default-initialized struct; in Rust most fields lack defaults.
        // This fn appears unused; callers use `get()` directly.
        unimplemented!("FetchTasklet::init - use FetchTasklet::get() instead")
    }

    fn clear_sink(&mut self) {
        if let Some(sink) = self.sink.take() {
            drop(sink); // Arc deref
        }
        if let Some(buffer) = self.request_body_streaming_buffer.take() {
            buffer.clear_drain_callback();
            drop(buffer); // Arc deref
        }
    }

    fn clear_data(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "clearData ");
        if !self.url_proxy_buffer.is_empty() {
            self.url_proxy_buffer = Box::default();
        }

        if let Some(_hostname) = self.hostname.take() {
            // dropped by Box
        }

        if let Some(certificate) = self.result.certificate_info.take() {
            drop(certificate); // TODO(port): CertificateInfo::deinit(allocator) -> Drop
        }

        self.request_headers.entries.clear();
        self.request_headers.buf.clear();
        self.request_headers = Headers::default();

        if let Some(http_) = self.http.as_mut() {
            http_.clear_data();
        }

        if let Some(metadata) = self.metadata.take() {
            drop(metadata); // TODO(port): HTTPResponseMetadata::deinit(allocator) -> Drop
        }

        self.response_buffer = MutableString::default();
        self.response.deinit();
        if let Some(response) = self.native_response.take() {
            drop(response); // Arc unref
        }

        self.clear_stream_cancel_handler();
        self.readable_stream_ref.deinit();

        self.scheduled_response_buffer = MutableString::default();
        // Always detach request_body regardless of type.
        // When request_body is a ReadableStream, startRequestStream() creates
        // an independent Strong reference in ResumableSink, so FetchTasklet's
        // reference becomes redundant and must be released to avoid leaks.
        self.request_body.detach();

        self.abort_reason.deinit();
        self.check_server_identity.deinit();
        self.clear_abort_signal();
        // Clear the sink only after the requested ended otherwise we would potentialy lose the last chunk
        self.clear_sink();
    }

    // XXX: in Zig 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    /// SAFETY: `this` must be the last reference (ref_count == 0) and have been allocated via Box::into_raw.
    unsafe fn deinit(this: *mut FetchTasklet) {
        bun_output::scoped_log!(FetchTasklet, "deinit");

        debug_assert!(unsafe { (*this).ref_count.load(Ordering::Relaxed) } == 0);

        // SAFETY: this was allocated via Box::into_raw in `get()`; ref_count == 0 so exclusive
        let mut boxed = unsafe { Box::from_raw(this) };
        boxed.clear_data();
        // self.http: Option<Box<AsyncHTTP>> dropped here automatically
        drop(boxed);
    }

    fn get_current_response(&self) -> Option<&Response> {
        // we need a body to resolve the promise when buffering
        if let Some(response) = self.native_response.as_deref() {
            return Some(response);
        }

        // if we did not have a direct reference we check if the Weak ref is still alive
        if let Some(response_js) = self.response.get() {
            if let Some(response) = response_js.as_::<Response>() {
                return Some(response);
            }
        }

        None
    }

    pub fn start_request_stream(&mut self) {
        self.is_waiting_request_stream_start = false;
        debug_assert!(matches!(self.request_body, HTTPRequestBody::ReadableStream(_)));
        let HTTPRequestBody::ReadableStream(ref stream_ref) = self.request_body else {
            return;
        };
        if let Some(stream) = stream_ref.get(self.global_this) {
            if let Some(signal) = self.signal.as_ref() {
                if signal.aborted() {
                    stream.abort(self.global_this);
                    return;
                }
            }

            let global_this = self.global_this;
            self.ref_(); // lets only unref when sink is done
            // +1 because the task refs the sink
            let sink = ResumableSink::init_exact_refs(global_this, stream, self as *mut _, 2);
            self.sink = Some(sink);
        }
    }

    pub fn on_body_received(&mut self) -> bun_jsc::JsTerminatedResult<()> {
        let success = self.result.is_success();
        let global_this = self.global_this;
        // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
        let buffer_reset = core::cell::Cell::new(true);
        bun_output::scoped_log!(FetchTasklet, "onBodyReceived success={} has_more={}", success, self.result.has_more);
        // PORT NOTE: Zig `defer { if (buffer_reset) ...reset() }` runs on `try` failure paths too.
        // Capture a raw ptr so the guard can reset on every exit (incl. `?`) without holding a
        // long-lived &mut borrow of self.
        let scheduled_buf: *mut MutableString = &mut self.scheduled_response_buffer;
        let _reset_guard = scopeguard::guard((), |()| {
            if buffer_reset.get() {
                // SAFETY: `self` outlives this guard (guard is a local in this fn) and no other
                // borrow of scheduled_response_buffer is live at scope exit / `?` unwind.
                unsafe { (*scheduled_buf).reset() };
            }
        });

        if !success {
            // PORT NOTE: `defer err.deinit()` handled by Drop — `err` is dropped at scope exit
            // or moved into `to_error_instance`; explicit need_deinit bookkeeping removed.
            let mut err = self.on_reject();
            let mut js_err = JSValue::ZERO;
            // if we are streaming update with error
            if let Some(readable) = self.readable_stream_ref.get(global_this) {
                if let readable_stream::Ptr::Bytes(bytes) = &readable.ptr {
                    js_err = err.to_js(global_this);
                    js_err.ensure_still_alive();
                    bytes.on_data(readable_stream::StreamResult::Err(BodyValueError::JSValue(js_err)))?;
                }
            }
            if let Some(sink) = self.sink.as_ref() {
                if js_err.is_empty() {
                    js_err = err.to_js(global_this);
                    js_err.ensure_still_alive();
                }
                sink.cancel(js_err);
                return Ok(());
            }
            // if we are buffering resolve the promise
            if let Some(response) = self.get_current_response() {
                let body = response.get_body_value();
                body.to_error_instance(err, global_this)?;
            }
            return Ok(());
        }

        if let Some(readable) = self.readable_stream_ref.get(global_this) {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived readable_stream_ref");
            if let readable_stream::Ptr::Bytes(bytes) = &readable.ptr {
                bytes.set_size_hint(self.get_size_hint());
                // body can be marked as used but we still need to pipe the data
                let chunk = self.scheduled_response_buffer.list.as_slice();

                if self.result.has_more {
                    bytes.on_data(readable_stream::StreamResult::Temporary(
                        bun_collections::ByteList::from_borrowed_slice_dangerous(chunk),
                    ))?;
                } else {
                    self.clear_stream_cancel_handler();
                    let prev = core::mem::take(&mut self.readable_stream_ref);
                    buffer_reset.set(false);

                    bytes.on_data(readable_stream::StreamResult::TemporaryAndDone(
                        bun_collections::ByteList::from_borrowed_slice_dangerous(chunk),
                    ))?;
                    drop(prev);
                }
                return Ok(());
            }
        }

        if let Some(response) = self.get_current_response() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived Current Response");
            let size_hint = self.get_size_hint();
            response.set_size_hint(size_hint);
            if let Some(readable) = response.get_body_readable_stream(global_this) {
                bun_output::scoped_log!(FetchTasklet, "onBodyReceived CurrentResponse BodyReadableStream");
                if let readable_stream::Ptr::Bytes(bytes) = &readable.ptr {
                    let chunk = self.scheduled_response_buffer.list.as_slice();

                    if self.result.has_more {
                        bytes.on_data(readable_stream::StreamResult::Temporary(
                            bun_collections::ByteList::from_borrowed_slice_dangerous(chunk),
                        ))?;
                    } else {
                        readable.value.ensure_still_alive();
                        response.detach_readable_stream(global_this);
                        bytes.on_data(readable_stream::StreamResult::TemporaryAndDone(
                            bun_collections::ByteList::from_borrowed_slice_dangerous(chunk),
                        ))?;
                    }

                    return Ok(());
                }
            }

            // we will reach here when not streaming, this is also the only case we dont wanna to reset the buffer
            buffer_reset.set(false);
            if !self.result.has_more {
                let scheduled_response_buffer = core::mem::take(&mut self.scheduled_response_buffer.list);
                let body = response.get_body_value();
                // done resolve body
                let old = core::mem::replace(
                    body,
                    BodyValue::InternalBlob(body::InternalBlob {
                        bytes: scheduled_response_buffer,
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
                    old.resolve(body, self.global_this, response.get_fetch_headers())?;
                }
            }
        }
        Ok(())
    }

    pub fn on_progress_update(&mut self) -> bun_jsc::JsTerminatedResult<()> {
        jsc::mark_binding!();
        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate");
        self.mutex.lock();
        self.has_schedule_callback.store(false, Ordering::Relaxed);
        let is_done = !self.result.has_more;

        let vm = self.javascript_vm;
        // vm is shutting down we cannot touch JS
        if vm.is_shutting_down() {
            self.mutex.unlock();
            if is_done {
                FetchTasklet::deref(self as *mut _);
            }
            return Ok(());
        }

        let global_this = self.global_this;
        // PORT NOTE: reshaped for borrowck — Zig defer block split into explicit cleanup at each return
        let cleanup = |this: &mut FetchTasklet| {
            this.mutex.unlock();
            // if we are not done we wait until the next call
            if is_done {
                let mut poll_ref = core::mem::take(&mut this.poll_ref);
                poll_ref.unref(vm);
                FetchTasklet::deref(this as *mut _);
            }
        };

        if self.is_waiting_request_stream_start && self.result.can_stream {
            // start streaming
            self.start_request_stream();
        }
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
                cleanup(self);
                return Ok(());
            }
            let r = self.on_body_received();
            cleanup(self);
            return r;
        }
        if self.metadata.is_none() && self.result.is_success() {
            cleanup(self);
            return Ok(());
        }

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit
        if self.is_waiting_abort {
            cleanup(self);
            return Ok(());
        }
        let promise_value = self.promise.value_or_empty();

        if promise_value.is_empty_or_undefined_or_null() {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is null");
            self.promise.deinit();
            cleanup(self);
            return Ok(());
        }

        if let Some(certificate_info) = self.result.certificate_info.take() {
            // we receive some error
            if self.reject_unauthorized && !self.check_server_identity(&certificate_info) {
                bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: aborted due certError");
                drop(certificate_info);
                // we need to abort the request
                let promise = promise_value.as_any_promise().unwrap();
                let tracker = self.tracker;
                let mut result = self.on_reject();

                promise_value.ensure_still_alive();
                let r = promise.reject_with_async_stack(global_this, result.to_js(global_this));
                result.deinit();

                tracker.did_dispatch(global_this);
                self.promise.deinit();
                cleanup(self);
                return r;
            }
            drop(certificate_info);
            // checkServerIdentity passed. Fall through to resolve/reject below.
            //
            // We can reach this point with `metadata == null` when the
            // connection failed after the TLS handshake but before response
            // headers arrived (e.g. an mTLS server closing the socket because
            // the client didn't present a certificate) — the certificate_info
            // from the first progress update is coalesced into the later
            // failure result. The `metadata == null && isSuccess()` case is
            // already handled by the early return above, so the fall-through
            // here always has either metadata to resolve with or a failure to
            // reject with.
        }

        let tracker = self.tracker;
        tracker.will_dispatch(global_this);
        // defer block:
        let dispatch_cleanup = |this: &mut FetchTasklet| {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is not null");
            tracker.did_dispatch(global_this);
            this.promise.deinit();
        };

        let success = self.result.is_success();
        let result = if success {
            Strong::create(self.on_resolve(), global_this)
        } else {
            // in this case we wanna a jsc.Strong.Optional so we just convert it
            let mut value = self.on_reject();
            let err_js = value.to_js(global_this);
            if let Some(sink) = self.sink.as_ref() {
                sink.cancel(err_js);
            }
            // TODO(port): Zig accessed value.JSValue (the Strong inside the union) directly
            value.into_strong()
        };

        promise_value.ensure_still_alive();

        struct Holder {
            held: Strong,
            promise: Strong,
            global_object: &'static JSGlobalObject,
            task: AnyTask,
        }

        impl Holder {
            fn resolve(self_: *mut Holder) -> bun_jsc::JsTerminatedResult<()> {
                // SAFETY: allocated via Box::into_raw below; consumed once
                let mut self_ = unsafe { Box::from_raw(self_) };
                // resolve the promise
                let prom = self_.promise.swap().as_any_promise().unwrap();
                let res = self_.held.swap();
                res.ensure_still_alive();
                let r = prom.resolve(self_.global_object, res);
                self_.held.deinit();
                self_.promise.deinit();
                drop(self_);
                r
            }

            fn reject(self_: *mut Holder) -> bun_jsc::JsTerminatedResult<()> {
                // SAFETY: allocated via Box::into_raw below; consumed once
                let mut self_ = unsafe { Box::from_raw(self_) };
                // reject the promise
                let prom = self_.promise.swap().as_any_promise().unwrap();
                let res = self_.held.swap();
                res.ensure_still_alive();
                let r = prom.reject_with_async_stack(self_.global_object, res);
                self_.held.deinit();
                self_.promise.deinit();
                drop(self_);
                r
            }
        }

        let holder = Box::into_raw(Box::new(Holder {
            held: result,
            // we need the promise to be alive until the task is done
            promise: core::mem::replace(&mut self.promise.strong, Strong::EMPTY),
            global_object: global_this,
            task: AnyTask::default(),
        }));
        // SAFETY: holder is valid until consumed by resolve/reject
        unsafe {
            (*holder).task = if success {
                AnyTask::new::<Holder>(Holder::resolve, holder)
            } else {
                AnyTask::new::<Holder>(Holder::reject, holder)
            };
            vm.enqueue_task(Task::init(&mut (*holder).task));
        }

        dispatch_cleanup(self);
        cleanup(self);
        Ok(())
    }

    pub fn check_server_identity(&mut self, certificate_info: &CertificateInfo) -> bool {
        if let Some(check_server_identity) = self.check_server_identity.get() {
            check_server_identity.ensure_still_alive();
            if !certificate_info.cert.is_empty() {
                let cert = &certificate_info.cert;
                let mut cert_ptr = cert.as_ptr();
                // SAFETY: cert is a valid DER buffer; d2i_X509 reads up to cert.len() bytes
                if let Some(x509) = unsafe {
                    boringssl::d2i_X509(core::ptr::null_mut(), &mut cert_ptr, i64::try_from(cert.len()).unwrap())
                } {
                    let global_object = self.global_this;
                    let _x509_guard = scopeguard::guard(x509, |x| x.free());
                    let js_cert = match X509::to_js(x509, global_object) {
                        Ok(v) => v,
                        Err(e) => {
                            match e {
                                jsc::JsError::Thrown => {}
                                jsc::JsError::OutOfMemory => {
                                    let _ = global_object.throw_out_of_memory();
                                }
                                jsc::JsError::Terminated => {}
                            }
                            let check_result = global_object.try_take_exception().unwrap();
                            // mark to wait until deinit
                            self.is_waiting_abort = self.result.has_more;
                            self.abort_reason.set(global_object, check_result);
                            self.signal_store.aborted.store(true, Ordering::Relaxed);
                            self.tracker.did_cancel(self.global_this);
                            // we need to abort the request
                            if let Some(http_) = self.http.as_mut() {
                                http::http_thread().schedule_shutdown(http_);
                            }
                            self.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
                            return false;
                        }
                    };
                    let hostname = BunString::clone_utf8(&certificate_info.hostname);
                    let _hostname_guard = scopeguard::guard((), |_| hostname.deref_());
                    let js_hostname = match hostname.to_js(global_object) {
                        Ok(v) => v,
                        Err(e) => {
                            match e {
                                jsc::JsError::Thrown => {}
                                jsc::JsError::OutOfMemory => {
                                    let _ = global_object.throw_out_of_memory();
                                }
                                jsc::JsError::Terminated => {}
                            }
                            let hostname_err_result = global_object.try_take_exception().unwrap();
                            self.is_waiting_abort = self.result.has_more;
                            self.abort_reason.set(global_object, hostname_err_result);
                            self.signal_store.aborted.store(true, Ordering::Relaxed);
                            self.tracker.did_cancel(self.global_this);
                            if let Some(http_) = self.http.as_mut() {
                                http::http_thread().schedule_shutdown(http_);
                            }
                            self.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
                            return false;
                        }
                    };
                    js_hostname.ensure_still_alive();
                    js_cert.ensure_still_alive();
                    let check_result = match check_server_identity.call(
                        global_object,
                        JSValue::UNDEFINED,
                        &[js_hostname, js_cert],
                    ) {
                        Ok(v) => v,
                        Err(e) => global_object.take_exception(e),
                    };

                    // > Returns <Error> object [...] on failure
                    if check_result.is_any_error() {
                        // mark to wait until deinit
                        self.is_waiting_abort = self.result.has_more;
                        self.abort_reason.set(global_object, check_result);
                        self.signal_store.aborted.store(true, Ordering::Relaxed);
                        self.tracker.did_cancel(self.global_this);

                        // we need to abort the request
                        if let Some(http_) = self.http.as_mut() {
                            http::http_thread().schedule_shutdown(http_);
                        }
                        self.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
                        return false;
                    }

                    // > On success, returns <undefined>
                    // We treat any non-error value as a success.
                    return true;
                }
            }
        }
        self.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
        false
    }

    fn get_abort_error(&mut self) -> Option<BodyValueError> {
        if self.abort_reason.has() {
            let out = core::mem::replace(&mut self.abort_reason, Strong::EMPTY);
            self.clear_abort_signal();
            return Some(BodyValueError::JSValue(out));
        }

        if let Some(signal) = self.signal.as_ref() {
            if let Some(reason) = signal.reason_if_aborted(self.global_this) {
                let result = reason.to_body_value_error(self.global_this);
                self.clear_abort_signal();
                return Some(result);
            }
        }

        None
    }

    fn clear_abort_signal(&mut self) {
        let Some(signal) = self.signal.take() else {
            return;
        };
        signal.clean_native_bindings(self as *mut _ as *mut c_void);
        signal.pending_activity_unref();
        drop(signal); // Arc unref
    }

    pub fn on_reject(&mut self) -> BodyValueError {
        debug_assert!(self.result.fail.is_some());
        bun_output::scoped_log!(FetchTasklet, "onReject");

        if let Some(err) = self.get_abort_error() {
            return err;
        }

        if let Some(reason) = self.result.abort_reason() {
            return BodyValueError::AbortReason(reason);
        }

        let fail = self.result.fail.unwrap();

        // Fetch-spec "network error" cases that callers feature-detect via
        // `instanceof TypeError`. Keep this list narrow; the catch-all
        // SystemError below is still a plain Error for backwards compat.
        if fail == err!("RequestBodyNotReusable") {
            return BodyValueError::TypeError(BunString::static_(
                "Request body is a ReadableStream and cannot be replayed for this redirect",
            ));
        }

        // some times we don't have metadata so we also check http.url
        let path = if let Some(metadata) = &self.metadata {
            BunString::clone_utf8(&metadata.url)
        } else if let Some(http_) = &self.http {
            BunString::clone_utf8(http_.url.href.as_ref())
        } else {
            BunString::EMPTY
        };

        let code = if fail == err!("ConnectionClosed") {
            BunString::static_("ECONNRESET")
        } else {
            BunString::static_(fail.name())
        };

        let message = match fail {
            e if e == err!("ConnectionClosed") => BunString::static_("The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"),
            e if e == err!("FailedToOpenSocket") => BunString::static_("Was there a typo in the url or port?"),
            e if e == err!("TooManyRedirects") => BunString::static_("The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()"),
            e if e == err!("ConnectionRefused") => BunString::static_("Unable to connect. Is the computer able to access the url?"),
            e if e == err!("RedirectURLInvalid") => BunString::static_("Redirect URL in Location header is invalid."),

            e if e == err!("UNABLE_TO_GET_ISSUER_CERT") => BunString::static_("unable to get issuer certificate"),
            e if e == err!("UNABLE_TO_GET_CRL") => BunString::static_("unable to get certificate CRL"),
            e if e == err!("UNABLE_TO_DECRYPT_CERT_SIGNATURE") => BunString::static_("unable to decrypt certificate's signature"),
            e if e == err!("UNABLE_TO_DECRYPT_CRL_SIGNATURE") => BunString::static_("unable to decrypt CRL's signature"),
            e if e == err!("UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY") => BunString::static_("unable to decode issuer public key"),
            e if e == err!("CERT_SIGNATURE_FAILURE") => BunString::static_("certificate signature failure"),
            e if e == err!("CRL_SIGNATURE_FAILURE") => BunString::static_("CRL signature failure"),
            e if e == err!("CERT_NOT_YET_VALID") => BunString::static_("certificate is not yet valid"),
            e if e == err!("CRL_NOT_YET_VALID") => BunString::static_("CRL is not yet valid"),
            e if e == err!("CERT_HAS_EXPIRED") => BunString::static_("certificate has expired"),
            e if e == err!("CRL_HAS_EXPIRED") => BunString::static_("CRL has expired"),
            e if e == err!("ERROR_IN_CERT_NOT_BEFORE_FIELD") => BunString::static_("format error in certificate's notBefore field"),
            e if e == err!("ERROR_IN_CERT_NOT_AFTER_FIELD") => BunString::static_("format error in certificate's notAfter field"),
            e if e == err!("ERROR_IN_CRL_LAST_UPDATE_FIELD") => BunString::static_("format error in CRL's lastUpdate field"),
            e if e == err!("ERROR_IN_CRL_NEXT_UPDATE_FIELD") => BunString::static_("format error in CRL's nextUpdate field"),
            e if e == err!("OUT_OF_MEM") => BunString::static_("out of memory"),
            e if e == err!("DEPTH_ZERO_SELF_SIGNED_CERT") => BunString::static_("self signed certificate"),
            e if e == err!("SELF_SIGNED_CERT_IN_CHAIN") => BunString::static_("self signed certificate in certificate chain"),
            e if e == err!("UNABLE_TO_GET_ISSUER_CERT_LOCALLY") => BunString::static_("unable to get local issuer certificate"),
            e if e == err!("UNABLE_TO_VERIFY_LEAF_SIGNATURE") => BunString::static_("unable to verify the first certificate"),
            e if e == err!("CERT_CHAIN_TOO_LONG") => BunString::static_("certificate chain too long"),
            e if e == err!("CERT_REVOKED") => BunString::static_("certificate revoked"),
            e if e == err!("INVALID_CA") => BunString::static_("invalid CA certificate"),
            e if e == err!("INVALID_NON_CA") => BunString::static_("invalid non-CA certificate (has CA markings)"),
            e if e == err!("PATH_LENGTH_EXCEEDED") => BunString::static_("path length constraint exceeded"),
            e if e == err!("PROXY_PATH_LENGTH_EXCEEDED") => BunString::static_("proxy path length constraint exceeded"),
            e if e == err!("PROXY_CERTIFICATES_NOT_ALLOWED") => BunString::static_("proxy certificates not allowed, please set the appropriate flag"),
            e if e == err!("INVALID_PURPOSE") => BunString::static_("unsupported certificate purpose"),
            e if e == err!("CERT_UNTRUSTED") => BunString::static_("certificate not trusted"),
            e if e == err!("CERT_REJECTED") => BunString::static_("certificate rejected"),
            e if e == err!("APPLICATION_VERIFICATION") => BunString::static_("application verification failure"),
            e if e == err!("SUBJECT_ISSUER_MISMATCH") => BunString::static_("subject issuer mismatch"),
            e if e == err!("AKID_SKID_MISMATCH") => BunString::static_("authority and subject key identifier mismatch"),
            e if e == err!("AKID_ISSUER_SERIAL_MISMATCH") => BunString::static_("authority and issuer serial number mismatch"),
            e if e == err!("KEYUSAGE_NO_CERTSIGN") => BunString::static_("key usage does not include certificate signing"),
            e if e == err!("UNABLE_TO_GET_CRL_ISSUER") => BunString::static_("unable to get CRL issuer certificate"),
            e if e == err!("UNHANDLED_CRITICAL_EXTENSION") => BunString::static_("unhandled critical extension"),
            e if e == err!("KEYUSAGE_NO_CRL_SIGN") => BunString::static_("key usage does not include CRL signing"),
            e if e == err!("KEYUSAGE_NO_DIGITAL_SIGNATURE") => BunString::static_("key usage does not include digital signature"),
            e if e == err!("UNHANDLED_CRITICAL_CRL_EXTENSION") => BunString::static_("unhandled critical CRL extension"),
            e if e == err!("INVALID_EXTENSION") => BunString::static_("invalid or inconsistent certificate extension"),
            e if e == err!("INVALID_POLICY_EXTENSION") => BunString::static_("invalid or inconsistent certificate policy extension"),
            e if e == err!("NO_EXPLICIT_POLICY") => BunString::static_("no explicit policy"),
            e if e == err!("DIFFERENT_CRL_SCOPE") => BunString::static_("Different CRL scope"),
            e if e == err!("UNSUPPORTED_EXTENSION_FEATURE") => BunString::static_("Unsupported extension feature"),
            e if e == err!("UNNESTED_RESOURCE") => BunString::static_("RFC 3779 resource not subset of parent's resources"),
            e if e == err!("PERMITTED_VIOLATION") => BunString::static_("permitted subtree violation"),
            e if e == err!("EXCLUDED_VIOLATION") => BunString::static_("excluded subtree violation"),
            e if e == err!("SUBTREE_MINMAX") => BunString::static_("name constraints minimum and maximum not supported"),
            e if e == err!("UNSUPPORTED_CONSTRAINT_TYPE") => BunString::static_("unsupported name constraint type"),
            e if e == err!("UNSUPPORTED_CONSTRAINT_SYNTAX") => BunString::static_("unsupported or invalid name constraint syntax"),
            e if e == err!("UNSUPPORTED_NAME_SYNTAX") => BunString::static_("unsupported or invalid name syntax"),
            e if e == err!("CRL_PATH_VALIDATION_ERROR") => BunString::static_("CRL path validation error"),
            e if e == err!("SUITE_B_INVALID_VERSION") => BunString::static_("Suite B: certificate version invalid"),
            e if e == err!("SUITE_B_INVALID_ALGORITHM") => BunString::static_("Suite B: invalid public key algorithm"),
            e if e == err!("SUITE_B_INVALID_CURVE") => BunString::static_("Suite B: invalid ECC curve"),
            e if e == err!("SUITE_B_INVALID_SIGNATURE_ALGORITHM") => BunString::static_("Suite B: invalid signature algorithm"),
            e if e == err!("SUITE_B_LOS_NOT_ALLOWED") => BunString::static_("Suite B: curve not allowed for this LOS"),
            e if e == err!("SUITE_B_CANNOT_SIGN_P_384_WITH_P_256") => BunString::static_("Suite B: cannot sign P-384 with P-256"),
            e if e == err!("HOSTNAME_MISMATCH") => BunString::static_("Hostname mismatch"),
            e if e == err!("EMAIL_MISMATCH") => BunString::static_("Email address mismatch"),
            e if e == err!("IP_ADDRESS_MISMATCH") => BunString::static_("IP address mismatch"),
            e if e == err!("INVALID_CALL") => BunString::static_("Invalid certificate verification context"),
            e if e == err!("STORE_LOOKUP") => BunString::static_("Issuer certificate lookup error"),
            e if e == err!("NAME_CONSTRAINTS_WITHOUT_SANS") => BunString::static_("Issuer has name constraints but leaf has no SANs"),
            e if e == err!("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR") => BunString::static_("unknown certificate verification error"),

            e => BunString::create_format(format_args!(
                "{} fetching \"{}\". For more information, pass `verbose: true` in the second argument to fetch()",
                e.name(),
                path,
            )),
        };

        let fetch_error = jsc::SystemError {
            code,
            message,
            path,
            ..Default::default()
        };

        BodyValueError::SystemError(fetch_error)
    }

    pub fn on_readable_stream_available(ctx: *mut c_void, global_this: &JSGlobalObject, readable: ReadableStream) {
        // SAFETY: ctx is a *mut FetchTasklet stored by the caller
        let this = unsafe { &mut *(ctx as *mut FetchTasklet) };
        this.readable_stream_ref = ReadableStreamStrong::init(readable, global_this);
    }

    pub fn on_start_streaming_http_response_body_callback(ctx: *mut c_void) -> DrainResult {
        // SAFETY: ctx is a *mut FetchTasklet stored by the caller
        let this = unsafe { &mut *(ctx as *mut FetchTasklet) };
        if this.signal_store.aborted.load(Ordering::Relaxed) {
            return DrainResult::Aborted;
        }

        if let Some(http_) = this.http.as_mut() {
            http_.enable_response_body_streaming();

            // If the server sent the headers and the response body in two separate socket writes
            // and if the server doesn't close the connection by itself
            // and doesn't send any follow-up data
            // then we must make sure the HTTP thread flushes.
            http::http_thread().schedule_response_body_drain(http_.async_http_id);
        }

        this.mutex.lock();
        // PORT NOTE: Zig `defer this.mutex.unlock()` — reshaped to explicit unlock at each return
        // (no `?` paths between lock and unlock, so a guard is unnecessary).
        let size_hint = this.get_size_hint();

        // This means we have received part of the body but not the whole thing
        if !this.scheduled_response_buffer.list.is_empty() {
            let scheduled_response_buffer = core::mem::take(&mut this.scheduled_response_buffer);
            this.mutex.unlock();

            return DrainResult::Owned {
                list: scheduled_response_buffer.list,
                size_hint,
            };
        }

        this.mutex.unlock();
        DrainResult::EstimatedSize(size_hint)
    }

    fn get_size_hint(&self) -> BlobSizeType {
        match self.body_size {
            http::BodySize::ContentLength(n) => n as BlobSizeType,
            http::BodySize::TotalReceived(n) => n as BlobSizeType,
            http::BodySize::Unknown => 0,
        }
    }

    /// Clear the cancel_handler on the ByteStream.Source to prevent use-after-free.
    /// Must be called before releasing readable_stream_ref, while the Strong ref
    /// still keeps the ReadableStream (and thus the ByteStream.Source) alive.
    fn clear_stream_cancel_handler(&mut self) {
        if let Some(readable) = self.readable_stream_ref.get(self.global_this) {
            if let readable_stream::Ptr::Bytes(bytes) = &readable.ptr {
                let source = bytes.parent();
                source.cancel_handler = None;
                source.cancel_ctx = None;
            }
        }
    }

    fn on_stream_cancelled_callback(ctx: *mut c_void) {
        // SAFETY: ctx is a *mut FetchTasklet stored by the caller (non-null)
        let this = unsafe { &mut *(ctx as *mut FetchTasklet) };
        if this.ignore_data {
            return;
        }
        this.ignore_remaining_response_body();
    }

    fn to_body_value(&mut self) -> BodyValue {
        if let Some(err) = self.get_abort_error() {
            return BodyValue::Error(err);
        }
        if self.is_waiting_body {
            return BodyValue::Locked(body::Locked {
                size_hint: self.get_size_hint(),
                task: self as *mut _ as *mut c_void,
                global: self.global_this,
                on_start_streaming: Some(FetchTasklet::on_start_streaming_http_response_body_callback),
                on_readable_stream_available: Some(FetchTasklet::on_readable_stream_available),
                on_stream_cancelled: Some(FetchTasklet::on_stream_cancelled_callback),
                ..Default::default()
            });
        }

        let scheduled_response_buffer = core::mem::take(&mut self.scheduled_response_buffer);
        let response = BodyValue::InternalBlob(body::InternalBlob {
            bytes: scheduled_response_buffer.list,
        });
        self.scheduled_response_buffer = MutableString::default();

        response
    }

    fn to_response(&mut self) -> Response {
        bun_output::scoped_log!(FetchTasklet, "toResponse");
        debug_assert!(self.metadata.is_some());
        // at this point we always should have metadata
        let metadata = self.metadata.as_ref().unwrap();
        let http_response = &metadata.response;
        self.is_waiting_body = self.result.has_more;
        // PORT NOTE: reshaped for borrowck — capture metadata fields before to_body_value() takes &mut self
        let headers = FetchHeaders::create_from_pico_headers(&http_response.headers);
        let status_code = http_response.status_code as u16;
        let status_text = BunString::create_atom_if_possible(&http_response.status);
        let url = BunString::create_atom_if_possible(&metadata.url);
        let redirected = self.result.redirected;
        Response::init(
            crate::webcore::ResponseInit {
                headers,
                status_code,
                status_text,
            },
            Body {
                value: self.to_body_value(),
            },
            url,
            redirected,
        )
    }

    fn ignore_remaining_response_body(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "ignoreRemainingResponseBody");
        // enabling streaming will make the http thread to drain into the main thread (aka stop buffering)
        // without a stream ref, response body or response instance alive it will just ignore the result
        if let Some(http_) = self.http.as_mut() {
            http_.enable_response_body_streaming();
        }
        // we should not keep the process alive if we are ignoring the body
        let vm = self.javascript_vm;
        self.poll_ref.unref(vm);
        // clean any remaining references
        self.clear_stream_cancel_handler();
        self.readable_stream_ref.deinit();
        self.response.deinit();

        if let Some(response) = self.native_response.take() {
            drop(response); // Arc unref
        }

        self.ignore_data = true;
    }

    pub fn on_resolve(&mut self) -> JSValue {
        bun_output::scoped_log!(FetchTasklet, "onResolve");
        let response = Box::into_raw(Box::new(self.to_response()));
        // SAFETY: response is a freshly allocated Response; makeMaybePooled takes ownership semantics on the JS side
        let response_js = Response::make_maybe_pooled(self.global_this, unsafe { &mut *response });
        response_js.ensure_still_alive();
        self.response = jsc::Weak::<FetchTasklet>::create(
            response_js,
            self.global_this,
            jsc::WeakRefType::FetchResponse,
            self as *mut _,
        );
        // SAFETY: response is valid; ref() returns Arc-like ref
        // TODO(port): native_response is Option<Arc<Response>> per LIFETIMES.tsv but Zig uses intrusive ref();
        // Response is intrusively refcounted so this should be IntrusiveRc/raw ptr in Phase B.
        self.native_response = Some(unsafe { (*response).ref_() });
        response_js
    }

    pub fn get(
        global_this: &'static JSGlobalObject,
        fetch_options: &FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> Result<*mut FetchTasklet, BunError> {
        // TODO(port): narrow error set
        let jsc_vm = global_this.bun_vm();
        let mut fetch_tasklet = Box::new(FetchTasklet {
            sink: None,
            http: Some(Box::new(AsyncHTTP::default())), // TODO(port): Zig used uninitialized create; init() called below
            result: HTTPClientResult::default(),
            metadata: None,
            javascript_vm: jsc_vm,
            global_this,
            request_body: fetch_options.body, // TODO(port): move semantics; FetchOptions consumed
            request_body_streaming_buffer: None,
            response_buffer: MutableString::default(),
            scheduled_response_buffer: MutableString::default(),
            response: jsc::Weak::default(),
            native_response: None,
            ignore_data: false,
            readable_stream_ref: ReadableStreamStrong::default(),
            request_headers: fetch_options.headers,
            promise,
            concurrent_task: ConcurrentTask::default(),
            poll_ref: KeepAlive::default(),
            body_size: http::BodySize::Unknown,
            url_proxy_buffer: fetch_options.url_proxy_buffer,
            signal: fetch_options.signal,
            signals: Signals::default(),
            signal_store: http::SignalsStore::default(),
            has_schedule_callback: AtomicBool::new(false),
            abort_reason: Strong::EMPTY,
            check_server_identity: fetch_options.check_server_identity,
            reject_unauthorized: fetch_options.reject_unauthorized,
            upgraded_connection: fetch_options.upgraded_connection,
            hostname: fetch_options.hostname,
            is_waiting_body: false,
            is_waiting_abort: false,
            is_waiting_request_stream_start: false,
            mutex: Mutex::new(),
            tracker: AsyncTaskTracker::init(jsc_vm),
            ref_count: AtomicU32::new(1),
        });

        fetch_tasklet.signals = fetch_tasklet.signal_store.to();

        fetch_tasklet.tracker.did_schedule(global_this);

        if let Some(store) = fetch_tasklet.request_body.store() {
            store.ref_();
        }

        let mut url = fetch_options.url;
        let mut proxy: Option<ZigURL> = None;
        if let Some(proxy_opt) = &fetch_options.proxy {
            if !proxy_opt.is_empty() {
                //if is empty just ignore proxy
                // Check NO_PROXY even for explicitly-provided proxies
                if !jsc_vm.transpiler.env.is_no_proxy(url.hostname, url.host) {
                    proxy = Some(proxy_opt.clone());
                }
            }
            // else: proxy: "" means explicitly no proxy (direct connection)
        } else {
            // no proxy provided, use default proxy resolution
            if let Some(env_proxy) = jsc_vm.transpiler.env.get_http_proxy_for(&url) {
                // env_proxy.href may be a slice into a RefCountedEnvValue's bytes which can
                // be freed by a subsequent `process.env.HTTP_PROXY = "..."` assignment while
                // this fetch is in flight on the HTTP thread. Clone it into url_proxy_buffer
                // alongside the request URL — the same pattern fetch.zig uses for the explicit
                // `fetch(url, { proxy: "..." })` option.
                if !env_proxy.href.is_empty() {
                    let old_url_len = url.href.len();
                    let mut new_buffer = Vec::with_capacity(fetch_tasklet.url_proxy_buffer.len() + env_proxy.href.len());
                    new_buffer.extend_from_slice(&fetch_tasklet.url_proxy_buffer);
                    new_buffer.extend_from_slice(env_proxy.href.as_ref());
                    let new_buffer = new_buffer.into_boxed_slice();
                    fetch_tasklet.url_proxy_buffer = new_buffer;
                    // SAFETY: url_proxy_buffer outlives url/proxy for the lifetime of fetch_tasklet
                    let buf_ptr = fetch_tasklet.url_proxy_buffer.as_ref();
                    url = ZigURL::parse(&buf_ptr[0..old_url_len]);
                    proxy = Some(ZigURL::parse(&buf_ptr[old_url_len..]));
                    // TODO(port): self-referential borrow into url_proxy_buffer; Phase B needs raw ptr or owned URL
                } else {
                    proxy = Some(env_proxy);
                }
            }
        }

        if fetch_tasklet.check_server_identity.has() && fetch_tasklet.reject_unauthorized {
            fetch_tasklet.signal_store.cert_errors.store(true, Ordering::Relaxed);
        } else {
            fetch_tasklet.signals.cert_errors = None;
        }

        let fetch_tasklet_ptr = Box::into_raw(fetch_tasklet);
        // SAFETY: just allocated; exclusive access until returned
        let fetch_tasklet = unsafe { &mut *fetch_tasklet_ptr };

        // This task gets queued on the HTTP thread.
        *fetch_tasklet.http.as_mut().unwrap().as_mut() = AsyncHTTP::init(
            fetch_options.method,
            url,
            &fetch_options.headers.entries,
            fetch_options.headers.buf.as_slice(),
            &mut fetch_tasklet.response_buffer,
            fetch_tasklet.request_body.slice(),
            http::HTTPClientResultCallback::new::<FetchTasklet>(
                // handles response events (on headers, on body, etc.)
                FetchTasklet::callback,
                fetch_tasklet_ptr,
            ),
            fetch_options.redirect_type,
            http::AsyncHTTPOptions {
                http_proxy: proxy,
                proxy_headers: fetch_options.proxy_headers,
                hostname: fetch_options.hostname.as_deref(),
                signals: fetch_tasklet.signals,
                unix_socket_path: fetch_options.unix_socket_path,
                disable_timeout: fetch_options.disable_timeout,
                disable_keepalive: fetch_options.disable_keepalive,
                disable_decompression: fetch_options.disable_decompression,
                reject_unauthorized: fetch_options.reject_unauthorized,
                verbose: fetch_options.verbose,
                tls_props: fetch_options.ssl_config,
                ..Default::default()
            },
        );
        // enable streaming the write side
        let is_stream = matches!(fetch_tasklet.request_body, HTTPRequestBody::ReadableStream(_));
        let http_client = fetch_tasklet.http.as_mut().unwrap();
        http_client.client.flags.is_streaming_request_body = is_stream;
        http_client.client.flags.force_http2 = fetch_options.force_http2;
        http_client.client.flags.force_http3 = fetch_options.force_http3;
        http_client.client.flags.force_http1 = fetch_options.force_http1;
        fetch_tasklet.is_waiting_request_stream_start = is_stream;
        if is_stream {
            let buffer = Arc::new(ThreadSafeStreamBuffer::default());
            buffer.set_drain_callback::<FetchTasklet>(FetchTasklet::on_write_request_data_drain, fetch_tasklet_ptr);
            fetch_tasklet.request_body_streaming_buffer = Some(buffer.clone());
            fetch_tasklet.http.as_mut().unwrap().request_body = http::RequestBody::Stream {
                buffer,
                ended: false,
            };
        }
        // TODO is this necessary? the http client already sets the redirect type,
        // so manually setting it here seems redundant
        if fetch_options.redirect_type != FetchRedirect::Follow {
            fetch_tasklet.http.as_mut().unwrap().client.remaining_redirect_count = 0;
        }

        // we want to return after headers are received
        fetch_tasklet.signal_store.header_progress.store(true, Ordering::Relaxed);

        if let HTTPRequestBody::Sendfile(sendfile) = &fetch_tasklet.request_body {
            debug_assert!(url.is_http());
            debug_assert!(fetch_options.proxy.is_none());
            fetch_tasklet.http.as_mut().unwrap().request_body = http::RequestBody::Sendfile(*sendfile);
        }

        if let Some(signal) = fetch_tasklet.signal.as_ref() {
            signal.pending_activity_ref();
            fetch_tasklet.signal = Some(signal.listen::<FetchTasklet>(fetch_tasklet_ptr, FetchTasklet::abort_listener));
        }
        Ok(fetch_tasklet_ptr)
    }

    pub fn abort_listener(this: *mut FetchTasklet, reason: JSValue) {
        bun_output::scoped_log!(FetchTasklet, "abortListener");
        // SAFETY: callback context; this is alive while signal listener is registered
        let this = unsafe { &mut *this };
        reason.ensure_still_alive();
        this.abort_reason.set(this.global_this, reason);
        this.abort_task();
        if let Some(sink) = this.sink.as_ref() {
            sink.cancel(reason);
            return;
        }
        // Abort fired before the HTTP thread asked for the body, so the
        // ReadableStream was never wired into a sink. Cancel it directly so
        // the underlying source's cancel(reason) callback still observes the
        // signal's reason (https://fetch.spec.whatwg.org/#abort-fetch step 5).
        if this.is_waiting_request_stream_start {
            if let HTTPRequestBody::ReadableStream(stream_ref) = &this.request_body {
                this.is_waiting_request_stream_start = false;
                if let Some(stream) = stream_ref.get(this.global_this) {
                    stream.cancel_with_reason(this.global_this, reason);
                }
            }
        }
    }

    /// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
    pub fn on_write_request_data_drain(this: *mut FetchTasklet) {
        // SAFETY: callback context; ref held by stream buffer drain callback
        let this_ref = unsafe { &*this };
        if this_ref.javascript_vm.is_shutting_down() {
            return;
        }
        // ref until the main thread callback is called
        this_ref.ref_();
        this_ref
            .javascript_vm
            .event_loop()
            .enqueue_task_concurrent(ConcurrentTask::from_callback(this, FetchTasklet::resume_request_data_stream));
    }

    /// This is ALWAYS called from the main thread
    // XXX: in Zig 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    pub fn resume_request_data_stream(this: *mut FetchTasklet) {
        // SAFETY: ref held from on_write_request_data_drain
        let this_ref = unsafe { &mut *this };
        bun_output::scoped_log!(FetchTasklet, "resumeRequestDataStream");
        let result = (|| {
            if let Some(sink) = this_ref.sink.as_ref() {
                if let Some(signal) = this_ref.signal.as_ref() {
                    if signal.aborted() {
                        // already aborted; nothing to drain
                        return;
                    }
                }
                sink.drain();
            }
        })();
        // deref when done because we ref inside onWriteRequestDataDrain
        FetchTasklet::deref(this);
        result
    }

    /// Whether the request body should skip chunked transfer encoding framing.
    /// True for upgraded connections (e.g. WebSocket) or when the user explicitly
    /// set Content-Length without setting Transfer-Encoding.
    fn skip_chunked_framing(&self) -> bool {
        self.upgraded_connection
            || self.result.is_http2
            || (self.request_headers.get(b"content-length").is_some()
                && self.request_headers.get(b"transfer-encoding").is_none())
    }

    pub fn write_request_data(&mut self, data: &[u8]) -> ResumableSinkBackpressure {
        bun_output::scoped_log!(FetchTasklet, "writeRequestData {}", data.len());
        if let Some(signal) = self.signal.as_ref() {
            if signal.aborted() {
                return ResumableSinkBackpressure::Done;
            }
        }
        let Some(thread_safe_stream_buffer) = self.request_body_streaming_buffer.as_ref() else {
            return ResumableSinkBackpressure::Done;
        };
        let stream_buffer = thread_safe_stream_buffer.acquire();
        let _release = scopeguard::guard((), |_| thread_safe_stream_buffer.release());
        let high_water_mark = if let Some(sink) = self.sink.as_ref() {
            sink.high_water_mark()
        } else {
            16384
        };

        let mut needs_schedule = false;

        // dont have backpressure so we will schedule the data to be written
        // if we have backpressure the onWritable will drain the buffer
        needs_schedule = stream_buffer.is_empty();
        if self.skip_chunked_framing() {
            stream_buffer.write(data);
        } else {
            //16 is the max size of a hex number size that represents 64 bits + 2 for the \r\n
            let mut formated_size_buffer = [0u8; 18];
            use std::io::Write;
            let formated_size = {
                let mut cursor = &mut formated_size_buffer[..];
                write!(cursor, "{:x}\r\n", data.len()).expect("unreachable");
                let written = 18 - cursor.len();
                &formated_size_buffer[..written]
            };
            stream_buffer.ensure_unused_capacity(formated_size.len() + data.len() + 2);
            // PERF(port): was assume_capacity
            stream_buffer.write_assume_capacity(formated_size);
            stream_buffer.write_assume_capacity(data);
            stream_buffer.write_assume_capacity(b"\r\n");
        }

        let result = if stream_buffer.size() >= high_water_mark {
            ResumableSinkBackpressure::Backpressure
        } else {
            ResumableSinkBackpressure::WantMore
        };

        if needs_schedule {
            // wakeup the http thread to write the data
            http::http_thread().schedule_request_write(self.http.as_mut().unwrap(), http::RequestWriteKind::Data);
        }

        // pause the stream if we hit the high water mark
        result
    }

    pub fn write_end_request(&mut self, err: Option<JSValue>) {
        bun_output::scoped_log!(FetchTasklet, "writeEndRequest hasError? {}", err.is_some());
        let this_ptr = self as *mut _;
        if let Some(js_error) = err {
            if self.signal_store.aborted.load(Ordering::Relaxed) || self.abort_reason.has() {
                FetchTasklet::deref(this_ptr);
                return;
            }
            if !js_error.is_undefined_or_null() {
                self.abort_reason.set(self.global_this, js_error);
            }
            self.abort_task();
        } else {
            if !self.skip_chunked_framing() {
                // Using chunked transfer encoding, send the terminating chunk
                let Some(thread_safe_stream_buffer) = self.request_body_streaming_buffer.as_ref() else {
                    FetchTasklet::deref(this_ptr);
                    return;
                };
                let stream_buffer = thread_safe_stream_buffer.acquire();
                stream_buffer.write(http::END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY);
                thread_safe_stream_buffer.release();
            }
            if let Some(http_) = self.http.as_mut() {
                http::http_thread().schedule_request_write(http_, http::RequestWriteKind::End);
            }
        }
        FetchTasklet::deref(this_ptr);
    }

    pub fn abort_task(&mut self) {
        self.signal_store.aborted.store(true, Ordering::Relaxed);
        self.tracker.did_cancel(self.global_this);

        if let Some(http_) = self.http.as_mut() {
            http::http_thread().schedule_shutdown(http_);
        }
    }

    pub fn queue(
        global: &'static JSGlobalObject,
        fetch_options: &FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> Result<*mut FetchTasklet, BunError> {
        // TODO(port): narrow error set
        http::HTTPThread::init(&http::HTTPThreadInitOptions::default());
        let node = Self::get(global, fetch_options, promise)?;

        // SAFETY: node freshly allocated, exclusive access
        let node_ref = unsafe { &mut *node };
        let mut batch = ThreadPool::Batch::default();
        node_ref.http.as_mut().unwrap().schedule(&mut batch);
        node_ref.poll_ref.ref_(global.bun_vm());

        // increment ref so we can keep it alive until the http client is done
        node_ref.ref_();
        http::http_thread().schedule(batch);

        Ok(node)
    }

    /// Called from HTTP thread. Handles HTTP events received from socket.
    pub fn callback(task: *mut FetchTasklet, async_http: &mut AsyncHTTP, result: HTTPClientResult) {
        // at this point only this thread is accessing result to is no race condition
        let is_done = !result.has_more;
        // SAFETY: task ref held by HTTP thread callback registration
        let task_ref = unsafe { &mut *task };

        task_ref.mutex.lock();
        // we need to unlock before task.deref();
        // PORT NOTE: reshaped for borrowck — explicit unlock + deref at end instead of nested defers
        // SAFETY: http is Some after get(); copy AsyncHTTP state from thread-local
        *task_ref.http.as_mut().unwrap().as_mut() = async_http.clone(); // TODO(port): Zig did struct copy; AsyncHTTP may not be Clone
        task_ref.http.as_mut().unwrap().response_buffer = async_http.response_buffer;

        bun_output::scoped_log!(
            FetchTasklet,
            "callback success={} ignore_data={} has_more={} bytes={}",
            result.is_success(),
            task_ref.ignore_data,
            result.has_more,
            result.body.as_ref().unwrap().list.len()
        );

        let prev_metadata = task_ref.result.metadata.take();
        let prev_cert_info = task_ref.result.certificate_info.take();
        let prev_can_stream = task_ref.result.can_stream;
        task_ref.result = result;
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
        // TODO(port): Zig copied result.body.?.* (MutableString) by value; clone semantics needed
        task_ref.response_buffer = task_ref.result.body.as_ref().unwrap().clone();

        if task_ref.ignore_data {
            task_ref.response_buffer.reset();

            if task_ref.scheduled_response_buffer.list.capacity() > 0 {
                task_ref.scheduled_response_buffer = MutableString::default();
            }
            if success && task_ref.result.has_more {
                // we are ignoring the body so we should not receive more data, so will only signal when result.has_more = true
                task_ref.mutex.unlock();
                if is_done {
                    FetchTasklet::deref_from_thread(task);
                }
                return;
            }
        } else {
            if success {
                let _ = task_ref
                    .scheduled_response_buffer
                    .write(task_ref.response_buffer.list.as_slice());
            }
            // reset for reuse
            task_ref.response_buffer.reset();
        }

        if let Err(has_schedule_callback) = task_ref.has_schedule_callback.compare_exchange(
            false,
            true,
            Ordering::Acquire,
            Ordering::Relaxed,
        ) {
            if has_schedule_callback {
                task_ref.mutex.unlock();
                if is_done {
                    FetchTasklet::deref_from_thread(task);
                }
                return;
            }
        }
        // will deinit when done with the http client (when is_done = true)
        if task_ref.javascript_vm.is_shutting_down() {
            task_ref.mutex.unlock();
            if is_done {
                FetchTasklet::deref_from_thread(task);
            }
            return;
        }
        task_ref
            .javascript_vm
            .event_loop()
            .enqueue_task_concurrent(task_ref.concurrent_task.from(task, jsc::ConcurrentTaskDeinit::Manual));

        task_ref.mutex.unlock();
        // we are done with the http client so we can deref our side
        // this is a atomic operation and will enqueue a task to deinit on the main thread
        if is_done {
            FetchTasklet::deref_from_thread(task);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__FetchResponse_finalize(this: *mut FetchTasklet) {
    bun_output::scoped_log!(FetchTasklet, "onResponseFinalize");
    // SAFETY: called from JSC finalizer with valid FetchTasklet ctx
    let this = unsafe { &mut *this };
    if let Some(response) = this.native_response.as_ref() {
        let body = response.get_body_value();
        // Three scenarios:
        //
        // 1. We are streaming, in which case we should not ignore the body.
        // 2. We were buffering, in which case
        //    2a. if we have no promise, we should ignore the body.
        //    2b. if we have a promise, we should keep loading the body.
        // 3. We never started buffering, in which case we should ignore the body.
        //
        // Note: We cannot call .get() on the ReadableStreamRef. This is called inside a finalizer.
        if !matches!(body, BodyValue::Locked(_)) || this.readable_stream_ref.held.has() {
            // Scenario 1 or 3.
            return;
        }

        if let BodyValue::Locked(locked) = body {
            if let Some(promise) = locked.promise {
                if promise.is_empty_or_undefined_or_null() {
                    // Scenario 2b.
                    this.ignore_remaining_response_body();
                }
            } else {
                // Scenario 3.
                this.ignore_remaining_response_body();
            }
        }
    }
}

pub struct FetchOptions {
    pub method: Method,
    pub headers: Headers,
    pub body: HTTPRequestBody,
    pub disable_timeout: bool,
    pub disable_keepalive: bool,
    pub disable_decompression: bool,
    pub reject_unauthorized: bool,
    pub url: ZigURL,
    pub verbose: http::HTTPVerboseLevel,
    pub redirect_type: FetchRedirect,
    pub proxy: Option<ZigURL>,
    pub proxy_headers: Option<Headers>,
    pub url_proxy_buffer: Box<[u8]>,
    pub signal: Option<Arc<AbortSignal>>,
    pub global_this: Option<&'static JSGlobalObject>,
    // Custom Hostname
    pub hostname: Option<Box<[u8]>>,
    pub check_server_identity: Strong,
    pub unix_socket_path: ZigString::Slice,
    pub ssl_config: Option<SSLConfig::SharedPtr>,
    pub upgraded_connection: bool,
    pub force_http2: bool,
    pub force_http3: bool,
    pub force_http1: bool,
}

impl Default for FetchOptions {
    fn default() -> Self {
        // TODO(port): Zig had per-field defaults; only the optional/defaulted ones matter at callsites
        unimplemented!("FetchOptions::default - construct explicitly")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/fetch/FetchTasklet.zig (1512 lines)
//   confidence: medium
//   todos:      16
//   notes:      Intrusive atomic refcount kept manual (raw *mut + Box::from_raw); on_body_received buffer-reset defer now a raw-ptr scopeguard (covers `?` paths); defer→explicit-cleanup reshaping in on_progress_update/callback; self-referential url_proxy_buffer borrow in get(); native_response Arc<Response> vs intrusive ref mismatch; FetchOptions consumed-by-move despite &FetchOptions param.
// ──────────────────────────────────────────────────────────────────────────
