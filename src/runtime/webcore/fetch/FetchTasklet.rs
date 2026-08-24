use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::Arc;

use bun_cares_sys::c_ares_draft as c_ares;
use bun_core::{MutableString, String as BunString};
use bun_event_loop::task_tag;
use bun_event_loop::{ConcurrentTask::ConcurrentTask, ReusableConcurrentTask, Task, TaskHop};
use bun_http as http;
use bun_http::Method;
use bun_http::{
    AsyncHTTP, CertificateInfo, FetchRedirect, HTTPClientResult, HTTPResponseMetadata, Headers,
    InFlight, OwnedRequest, ThreadSafeStreamBuffer,
};
use bun_io::KeepAlive;
use bun_jsc::bun_string_jsc;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::{
    self as jsc, AbortListenerRegistration, AbortSignalRef, GlobalRef, JSGlobalObject, JSValue,
    JsCell, JsResult, StrongOptional,
};
use bun_ptr::{BackRef, OwnedThis, RefPtr, SelfRoot, ThisPtr};
use bun_sys::FdExt;
use bun_threading::Guarded;
use bun_url::URL as ZigURL;

use crate::api::bun_x509 as X509;
use crate::webcore::blob::{Any as AnyBlob, Blob, SizeType as BlobSizeType, Store as BlobStore};
use crate::webcore::body::{self, Body, Value as BodyValue, ValueError as BodyValueError};
use crate::webcore::byte_stream::{AfterDelivery, ProducerHold};
use crate::webcore::fetch::fetch_request_body_sink::{FetchRequestBodySink, RequestBodyChunk};
use crate::webcore::readable_stream::{ReadableStream, Strong as ReadableStreamStrong};
use crate::webcore::response::{HeadersRef, ResponseRef};
use crate::webcore::sink::JSSink;
use crate::webcore::streams::{SourceHandle, StreamError, StreamResult, Writable};
use crate::webcore::{ByteStream, DrainResult, InternalBlob, Response, SinkHandle};

bun_output::declare_scope!(FetchTasklet, visible);

/// Upper bound on the Content-Length-driven `reserve_exact` in `on_result()`.
const SCHEDULED_PRERESERVE_MAX: usize = 256 * 1024 * 1024;

use http::signals::{BODY_HIGH_WATER_MARK, BodyReceiveMode};

/// What the request out on the HTTP thread borrows: kept, untouched, until the
/// HTTP thread hands the request back (`InFlight`).
pub(crate) struct FetchRequestStorage {
    /// url + proxy href, back to back.
    url_proxy_buffer: Box<[u8]>,
    url_len: usize,
    headers_buf: Vec<u8>,
    unix_socket_path: Box<[u8]>,
    /// The in-memory request body (`HTTPRequestBody::AnyBlob`); empty otherwise.
    body: AnyBlob,
}

impl FetchRequestStorage {
    fn url(&self) -> ZigURL<'_> {
        ZigURL::parse(&self.url_proxy_buffer[..self.url_len])
    }
}

/// Response-side state the HTTP thread writes (`FetchShared::on_result`) and the
/// JS thread consumes (`FetchTasklet::on_progress_update`).
#[derive(Default)]
pub(crate) struct SharedState {
    pub(crate) result: HTTPClientResult<'static>,
    pub(crate) metadata: Option<HTTPResponseMetadata>,
    /// buffer used to stream response to JS
    pub(crate) scheduled_response_buffer: MutableString,
    /// The HTTP thread is done with the fetch (terminal result delivered): the
    /// next progress hop to be consumed (run, or released unrun at teardown)
    /// releases `http_ref` too. Fetches with a streaming request body post a
    /// `HandBackHop` instead (see `on_result`).
    handed_back: bool,
    /// `process.exit()` interrupted the request on the HTTP thread
    /// (`release_at_shutdown`): nothing more will arrive, so the next progress
    /// update only releases the tasklet.
    released_at_shutdown: bool,
}

/// The part of a fetch shared with the HTTP thread. `bun_http` holds it (as the
/// request's result handler) until the terminal result; the tasklet for its
/// whole life.
pub(crate) struct FetchShared {
    pub(crate) state: Guarded<SharedState>,
    pub(crate) signal_store: http::signals::Store,
    /// A progress update is queued on the JS thread and has not run yet;
    /// `on_result` sets it (compare-exchange) and `on_progress_update` clears it
    /// under `state`'s lock.
    has_schedule_callback: AtomicBool,
    /// The latest result's `is_http2` (the streaming request body goes out
    /// unframed): read by `write_request_data` for every request-body chunk
    /// without taking `state`'s lock, which `on_progress_update` may be holding
    /// on the same thread while it pumps that body.
    is_http2: AtomicBool,
    /// The tasklet's address, which the JS-thread hops carry; set once in
    /// `queue`. The tasklet keeps itself alive for them through `progress_ref`
    /// / `http_ref`.
    tasklet: AtomicPtr<FetchTasklet>,
    /// The progress-update hop's queue node (at most one is queued at a time:
    /// `has_schedule_callback`).
    progress_task: ReusableConcurrentTask,
    /// The hand-back hop's queue node (posted once, if `posts_drain_hops`).
    hand_back_task: ReusableConcurrentTask,
    /// Request-body drain hops are posted (a streaming request body), so the
    /// hand-back must be its own hop, queued after them.
    posts_drain_hops: bool,
    /// How the HTTP thread posts to the JS thread, and what makes the VM wait
    /// for it; handed back at the terminal result / `release_at_shutdown`.
    ticket: jsc::InFlightTicket,
}

impl FetchShared {
    fn hop(&self, tag: bun_event_loop::TaskTag) -> Task {
        Task::new(tag, self.tasklet.load(Ordering::Relaxed).cast::<()>())
    }

    /// Post the progress-update hop unless one is queued already.
    fn post_progress_update(&self) {
        if self
            .has_schedule_callback
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            return;
        }
        let task = self.hop(task_tag::FetchTasklet);
        // `has_schedule_callback` was clear, so the previous hop has run and its
        // node was consumed; the heap node is only a fallback.
        let node = self
            .progress_task
            .arm(task)
            .unwrap_or_else(|| ConcurrentTask::create(task));
        self.ticket.post(node);
    }
}

impl http::HTTPClientResultHandler for FetchShared {
    /// HTTP thread: fold `result` into the shared state and, unless one is
    /// already queued, post a progress update to the JS thread. The terminal
    /// result also hands the tasklet back: through `handed_back`, which the
    /// progress update that sees it acts on, or — when request-body drain hops
    /// may be queued — as a `HandBackHop` queued after them and after that update.
    fn on_result(&self, mut result: HTTPClientResult<'_>) {
        let is_done = !result.has_more;
        let mut state = self.state.lock();

        bun_output::scoped_log!(
            FetchTasklet,
            "callback success={} receive_mode={:?} has_more={} bytes={}",
            result.is_success(),
            self.signal_store.body_receive_mode(),
            result.has_more,
            result.body.len()
        );

        let prev_metadata = state.result.metadata.take();
        let prev_cert_info = state.result.certificate_info.take();
        let prev_can_stream = state.result.can_stream;
        // `result.body` borrows the HTTP thread's scratch buffer on non-terminal
        // callbacks; the terminal callback carries the bytes in `body_owned`
        // instead. Capture both before `into_owned` drops the borrowed view.
        let body: &[u8] = result.body;
        let body_owned: Vec<u8> = core::mem::take(&mut result.body_owned);
        state.result = result.into_owned();
        // can_stream is a one-shot signal to start the request body stream; don't let a
        // later coalesced result clobber it before the JS thread sees it.
        state.result.can_stream = state.result.can_stream || prev_can_stream;
        self.is_http2
            .store(state.result.is_http2, Ordering::Relaxed);

        // Preserve pending certificate info if it was provided in the previous update.
        if state.result.certificate_info.is_none() {
            if let Some(cert_info) = prev_cert_info {
                state.result.certificate_info = Some(cert_info);
            }
        }

        // metadata should be provided only once
        if let Some(metadata) = state.result.metadata.take().or(prev_metadata) {
            bun_output::scoped_log!(FetchTasklet, "added callback metadata");
            if state.metadata.is_none() {
                state.metadata = Some(metadata);
            }

            state.result.metadata = None;
        }

        let success = state.result.is_success();

        if self.signal_store.body_receive_mode() == BodyReceiveMode::Abandoned {
            if state.scheduled_response_buffer.list.capacity() > 0 {
                state.scheduled_response_buffer = MutableString::default();
            }
            if success && state.result.has_more {
                return;
            }
        } else if success {
            let has_more = state.result.has_more;
            let body_size = state.result.body_size;
            let scheduled = &mut state.scheduled_response_buffer;
            if body.is_empty() && !body_owned.is_empty() && scheduled.list.is_empty() {
                scheduled.list = body_owned;
            } else {
                // Grow to Content-Length once so the per-packet append below
                // doesn't leave the ~2x doubling over-capacity that the
                // ArrayBuffer would adopt. Only for a consumer that wants the whole body.
                if self.signal_store.body_receive_mode() == BodyReceiveMode::BufferAll {
                    if let http::BodySize::ContentLength(n) = body_size {
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
            // The other half of this rule is `FetchTasklet::after_body_chunk_delivered`.
            if has_more && scheduled.list.len() >= BODY_HIGH_WATER_MARK {
                self.signal_store.pause_receive();
            }
        }

        self.post_progress_update();
        if is_done {
            self.hand_back(&mut state);
        }
        drop(state);
        if is_done {
            // The HTTP thread is done with this fetch.
            self.ticket.hand_back();
        }
    }

    /// Called from `dealloc_in_flight_for_exit` on the HTTP thread for each
    /// request still in flight when `process.exit()` interrupts it. The
    /// terminal `on_result` will never run, so post what it would have: unless
    /// one is already queued, a last progress update — which
    /// `released_at_shutdown` turns into just the release of the JS side's
    /// reference — and then the hand-back. A queued update's VM releases it
    /// from its queue if it never runs.
    ///
    /// Only reachable for a request whose VM has *not* torn down (a worker
    /// still running when the main thread exits): a VM's teardown waits for its
    /// fetches' tickets — i.e. for their terminal result — before the exiting
    /// main thread parks the HTTP thread.
    fn release_at_shutdown(&self) {
        {
            let mut state = self.state.lock();
            // No JS-thread drain will reclaim it.
            state.scheduled_response_buffer = MutableString::default();
            state.released_at_shutdown = true;
            self.post_progress_update();
            self.hand_back(&mut state);
        }
        // The HTTP thread is done with this fetch.
        self.ticket.hand_back();
    }
}

impl FetchShared {
    /// HTTP thread, `state` locked, nothing more to deliver and the last progress
    /// update posted: let the JS thread release `http_ref`.
    fn hand_back(&self, state: &mut SharedState) {
        if self.posts_drain_hops {
            // Its own hop, the last one to name the tasklet: FIFO after every
            // `RequestBodyDrainHop` and progress hop this thread posted, which
            // is what keeps the tasklet alive for those.
            let task = self.hop(task_tag::FetchTaskletHandBack);
            let node = self
                .hand_back_task
                .arm(task)
                .unwrap_or_else(|| ConcurrentTask::create(task));
            self.ticket.post(node);
        } else {
            state.handed_back = true;
        }
    }
}

impl http::DrainHandler for FetchShared {
    /// HTTP thread, with the request body buffer locked: it drained. Hop to the
    /// JS thread to resume the request body stream. Carries no reference of its
    /// own: the later `HandBackHop` from this thread is what releases `http_ref`.
    fn on_drain(&self) {
        self.ticket.post(ConcurrentTask::create(
            self.hop(task_tag::FetchTaskletRequestDataDrain),
        ));
    }
}

/// `task_tag::FetchTasklet`: a progress update the HTTP thread posted.
pub struct ProgressHop;
impl TaskHop for ProgressHop {
    type Target = FetchTasklet;
    const TAG: bun_event_loop::TaskTag = task_tag::FetchTasklet;
    fn run(this: ThisPtr<FetchTasklet>) -> JsResult<()> {
        FetchTasklet::on_progress_update(this)
    }
    /// The VM is tearing down: release what the update would have. Consumes the
    /// hop like `on_progress_update` does, so a terminal result still on its way
    /// posts a fresh one (released here in turn) that carries the hand-back.
    fn release_unrun(this: ThisPtr<FetchTasklet>) {
        let _guard = RefPtr::from_this(this);
        let handed_back = {
            let state = this.shared.state.lock();
            this.shared
                .has_schedule_callback
                .store(false, Ordering::Relaxed);
            state.handed_back
        };
        FetchTasklet::release(this, |t| &t.progress_ref);
        if handed_back {
            FetchTasklet::release(this, |t| &t.http_ref);
        }
    }
}

/// `task_tag::FetchTaskletHandBack`: the HTTP thread is done with a fetch that
/// streamed its request body (posted after its last touch of anything the
/// tasklet can reach).
pub struct HandBackHop;
impl TaskHop for HandBackHop {
    type Target = FetchTasklet;
    const TAG: bun_event_loop::TaskTag = task_tag::FetchTaskletHandBack;
    fn run(this: ThisPtr<FetchTasklet>) -> JsResult<()> {
        FetchTasklet::release(this, |t| &t.http_ref);
        Ok(())
    }
    fn release_unrun(this: ThisPtr<FetchTasklet>) {
        FetchTasklet::release(this, |t| &t.http_ref);
    }
}

/// `task_tag::FetchTaskletRequestDataDrain`: the streaming request body buffer
/// drained; resume the stream feeding it.
pub struct RequestBodyDrainHop;
impl TaskHop for RequestBodyDrainHop {
    type Target = FetchTasklet;
    const TAG: bun_event_loop::TaskTag = task_tag::FetchTaskletRequestDataDrain;
    fn run(this: ThisPtr<FetchTasklet>) -> JsResult<()> {
        FetchTasklet::resume_request_data_stream(this);
        Ok(())
    }
    /// Nothing held: the tasklet outlives this hop through `http_ref`.
    fn release_unrun(_this: ThisPtr<FetchTasklet>) {}
}

/// The per-`fetch()` state machine. Lives on the JS thread; the HTTP thread
/// only sees [`FetchShared`]. Reference-counted: `progress_ref` (released by
/// the terminal progress update), `http_ref` (released when the HTTP thread
/// hands the request back) and `request_stream_ref` (held while a request body
/// stream is wired to the sink) are the references queued work holds on it.
#[derive(bun_ptr::CellRefCounted)]
pub struct FetchTasklet {
    ref_count: Cell<u32>,
    /// `&self` paths reach the `ThisPtr`-taking ones through this.
    self_ref: SelfRoot<FetchTasklet>,
    pub(crate) shared: Arc<FetchShared>,
    /// The request out on (or back from) the HTTP thread; taken back on drop.
    request: JsCell<Option<InFlight<FetchRequestStorage>>>,
    method: Method,
    /// The request-body `JSSink`, from `start_request_stream` until
    /// `clear_sink`; the JS controller holds only a detachable pointer into it.
    pub(crate) sink: JsCell<Option<OwnedThis<FetchRequestBodySink>>>,
    pub global_this: GlobalRef,
    /// `Sendfile` / `ReadableStream` request bodies (an in-memory body lives in
    /// the request storage).
    pub(crate) request_body: JsCell<HTTPRequestBody>,
    /// Our reference on the request-body buffer shared with the HTTP thread;
    /// released in `clear_sink`.
    request_body_streaming_buffer: JsCell<Option<RefPtr<ThreadSafeStreamBuffer>>>,
    /// response weak ref we need this to track the response JS lifetime
    pub(crate) response: JsCell<jsc::Weak<FetchTasklet>>,
    /// native response ref if we still need it when JS is discarted
    pub(crate) native_response: JsCell<Option<ResponseRef>>,
    /// The response body stream while this tasklet is its producer.
    pub(crate) response_stream: ProducerHold,
    pub(crate) promise: JsCell<jsc::JSPromiseStrong>,
    pub poll_ref: JsCell<KeepAlive>,
    /// Our `abort` listener on the request's signal (and our handle on the
    /// signal); dropped once the abort has been consumed or at teardown.
    pub(crate) signal: JsCell<Option<AbortListenerRegistration>>,
    // must be stored because AbortSignal stores reason weakly
    pub(crate) abort_reason: JsCell<StrongOptional>,
    // custom checkServerIdentity
    pub(crate) check_server_identity: JsCell<StrongOptional>,
    pub(crate) reject_unauthorized: bool,
    pub(crate) upgraded_connection: bool,
    /// The user set Content-Length without Transfer-Encoding: a streamed
    /// request body goes out unframed (`skip_chunked_framing`).
    unframed_by_headers: bool,
    pub(crate) is_waiting_body: Cell<bool>,
    pub(crate) is_waiting_abort: Cell<bool>,
    pub(crate) is_waiting_request_stream_start: Cell<bool>,
    pub(crate) tracker: AsyncTaskTracker,
    /// The JS side's reference: released by the terminal progress update (or
    /// by its VM releasing that update unrun).
    progress_ref: JsCell<Option<RefPtr<FetchTasklet>>>,
    /// The `fetch()` promise's settlement, run from its own event-loop task
    /// (`PromiseSettleHop`, which holds `settle_ref`).
    pending_settle: JsCell<Option<FetchTaskletPromiseSettle>>,
    settle_ref: JsCell<Option<RefPtr<FetchTasklet>>>,
    /// The reference held while the request is out on the HTTP thread:
    /// released once it hands the request back (`SharedState::handed_back`,
    /// or `HandBackHop` when the request body is streamed).
    http_ref: JsCell<Option<RefPtr<FetchTasklet>>>,
    /// Held while a request body stream is wired to `sink` (`start_request_stream`);
    /// released by `write_end_request`, or by the sink's `finalize` if that never ran.
    request_stream_ref: JsCell<Option<RefPtr<FetchTasklet>>>,
}

// Boxing `AnyBlob` is not viable: the `AnyBlob` arm is constructed/matched in
// `fetch.rs` (e.g. `HTTPRequestBodyExt::any_blob`) and would require changes
// across files. The enum is also short-lived per-request, so the size cost is bounded.
#[allow(clippy::large_enum_variant)]
pub enum HTTPRequestBody {
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

    pub(crate) fn detach(&mut self) {
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
            || (matches!(&body_value, BodyValue::Locked(l) if !l.action.is_none() || l.is_disturbed2(global_this)))
        {
            return Err(global_this
                .err(
                    jsc::ErrorCode::BODY_ALREADY_USED,
                    format_args!("body already used"),
                )
                .throw());
        }
        if let BodyValue::Locked(locked) = &mut body_value {
            if locked.readable.has() {
                // `BodyValue` now has `Drop` (H3), so we cannot move
                // `l.readable` out by value (E0509). `mem::take` leaves a default
                // readable; `Value::drop` on the residual `Locked` then runs
                // `readable.deinit()` on that default — a no-op.
                return Ok(HTTPRequestBody::ReadableStream(core::mem::take(
                    &mut locked.readable,
                )));
            }
        }
        if matches!(&body_value, BodyValue::Locked(_)) {
            let readable = body_value.to_readable_stream(global_this)?;
            if !readable.is_empty_or_undefined_or_null() {
                if let BodyValue::Locked(l) = &mut body_value {
                    if l.readable.has() {
                        // See note above re: E0509 and `Value::drop`.
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

/// What `on_progress_update` does once the shared state is unlocked.
enum AfterProgress {
    /// Nothing (a later update finishes the fetch).
    Pending,
    /// The fetch is over: release the JS side's reference.
    Release,
    /// The fetch is over: cancel a still-running request body stream, release
    /// the event loop, and release the JS side's reference.
    Finish,
}

impl FetchTasklet {
    fn this_ptr(&self) -> ThisPtr<FetchTasklet> {
        self.self_ref.this_ptr(self)
    }

    /// Wrap a borrowed body chunk in a `StreamResult::Temporary*` for
    /// synchronous delivery to `ByteStream::on_data`.
    ///
    /// INVARIANT (module): `chunk` borrows `scheduled_response_buffer` (or
    /// another tasklet-owned buffer) which strictly outlives the synchronous
    /// `on_data` call per the `StreamResult::Temporary*` contract — `on_data`
    /// copies/consumes before returning and never retains the slice.
    #[inline]
    fn temporary_chunk(chunk: &[u8], done: bool) -> StreamResult {
        // See INVARIANT above. `RawSlice` is non-owning; backing buffer
        // outlives the synchronous `on_data` call.
        let v = bun_ptr::RawSlice::new(chunk);
        if done {
            StreamResult::TemporaryAndDone(v)
        } else {
            StreamResult::Temporary(v)
        }
    }

    /// True iff an attached AbortSignal has fired.
    #[inline]
    pub(crate) fn signal_aborted(&self) -> bool {
        self.signal
            .get()
            .as_ref()
            .is_some_and(|s| s.signal().aborted())
    }

    /// The request-body sink while attached (`start_request_stream` until `clear_sink`).
    #[inline]
    pub(crate) fn sink(&self) -> Option<&FetchRequestBodySink> {
        self.sink.get().as_deref()
    }

    /// The request-body buffer shared with the HTTP thread, while attached.
    #[inline]
    pub(crate) fn request_body_buffer(&self) -> Option<&ThreadSafeStreamBuffer> {
        self.request_body_streaming_buffer.get().as_deref()
    }

    fn async_http_id(&self) -> Option<u32> {
        self.request.get().as_ref().map(InFlight::async_http_id)
    }

    fn request_storage(&self) -> Option<&FetchRequestStorage> {
        self.request.get().as_ref().map(InFlight::storage)
    }

    fn clear_sink(&self) {
        if let Some(sink) = self.sink.replace(None) {
            // `write_end_request` is the canonical release of `request_stream_ref`;
            // keep the sink's `finalize()` from repeating it.
            sink.task.set(None);
            // `detach` may fire the controller's onClose; every terminal path
            // here has already cleared it, so this just nulls m_sinkPtr.
            let mut source = sink.source.replace(SourceHandle::None);
            JSSink::<FetchRequestBodySink>::detach(&mut source, &self.global_this);
            drop(sink);
        }
        if let Some(buffer) = self.request_body_streaming_buffer.replace(None) {
            // The HTTP thread may still be using its ref; `clear_drain_callback`
            // synchronises with it through the buffer's mutex.
            buffer.clear_drain_callback();
        }
    }

    fn clear_data(&self) {
        bun_output::scoped_log!(FetchTasklet, "clearData ");
        {
            let mut state = self.shared.state.lock();
            if let Some(certificate) = state.result.certificate_info.take() {
                drop(certificate);
            }
            if let Some(metadata) = state.metadata.take() {
                drop(metadata);
            }
            state.scheduled_response_buffer = MutableString::default();
        }

        self.detach_response_body_producer();
        self.response.get().clear();
        self.native_response.set(None);

        self.clear_stream_handlers();

        // Always detach request_body regardless of type.
        // When request_body is a ReadableStream, startRequestStream() hands
        // the stream off to `assign_to_stream`, so FetchTasklet's reference
        // becomes redundant and must be released to avoid leaks.
        self.request_body.with_mut(HTTPRequestBody::detach);
        // The HTTP thread handed the request back before `http_ref` was released.
        if let Some(Ok(request)) = self.request.replace(None).map(InFlight::reclaim) {
            let mut storage = request.into_storage();
            storage.body.detach();
        }

        self.abort_reason.with_mut(StrongOptional::deinit);
        self.check_server_identity.with_mut(StrongOptional::deinit);
        self.clear_abort_signal();
        // Clear the sink only after the requested ended otherwise we would potentialy lose the last chunk
        self.clear_sink();
    }

    /// VM teardown's stop phase (JS thread): abort the transport. The HTTP
    /// thread then fails the request promptly — started or still queued — and
    /// hands the tasklet back, which teardown waits for before the handle closes.
    pub(crate) fn stop_for_vm_teardown(this: ThisPtr<FetchTasklet>) {
        this.abort_task();
    }

    /// The response's native `Response`, while we still hold it or its JS wrapper is alive.
    fn current_response(&self) -> Option<&Response> {
        // we need a body to resolve the promise when buffering
        if let Some(response) = self.native_response.get().as_deref() {
            return Some(response);
        }

        // if we did not have a direct reference we check if the Weak ref is still alive
        if let Some(response_js) = self.response.get().get() {
            if let Some(response) = response_js.as_class_ref::<Response>() {
                return Some(response);
            }
        }

        None
    }

    fn start_request_stream(&self) -> JsResult<()> {
        self.is_waiting_request_stream_start.set(false);
        debug_assert!(matches!(
            self.request_body.get(),
            HTTPRequestBody::ReadableStream(_)
        ));
        let HTTPRequestBody::ReadableStream(stream_ref) = self.request_body.get() else {
            return Ok(());
        };
        let Some(stream) = stream_ref.get() else {
            return Ok(());
        };
        if self.signal_aborted() {
            return stream.abort(&self.global_this);
        }

        let global_this = self.global_this;
        // Balanced exactly once by `write_end_request` on the
        // assign_to_stream-result side (on_resolve/on_reject or the synchronous
        // Fulfilled/Rejected/undefined branches below), or by the sink's
        // `finalize` as a fallback if that path never runs.
        self.request_stream_ref
            .set(Some(RefPtr::from_this(self.this_ptr())));

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
            self.write_end_request_impl(Some(err_instance));
            return Ok(());
        }

        let sink_owner = OwnedThis::new(FetchRequestBodySink {
            task: Cell::new(Some(self.self_ref.backref(self))),
            high_water_mark: Cell::new(16384),
            ..Default::default()
        });
        let sink_this = sink_owner.this_ptr();
        let sink_handle = SinkHandle::FetchRequestBody(sink_this.backref_mut());
        self.sink.set(Some(sink_owner));
        let sink: &FetchRequestBodySink = sink_this.get();

        // Native ByteStream/FileReader fast-path: wire the SinkHandle
        // directly, skipping the JS pump.
        match stream.wire_native_sink(&global_this, sink_handle, JSValue::UNDEFINED, |src| {
            sink.source.set(src);
        }) {
            crate::webcore::readable_stream::NativeWireResult::Wired => return Ok(()),
            crate::webcore::readable_stream::NativeWireResult::EndedInline(err) => {
                // The source finished inside the wire attempt, so leave the
                // sink in the state `end_from_stream` leaves it: ended, with
                // the source and task detached. `write_end_request` below is
                // the single balancing release of `request_stream_ref`; a
                // sink left `ended == false` here would make the terminal
                // `cancel_request_body_sink` treat it as a live native sink
                // and release it a second time.
                sink.ended.set(true);
                sink.source.set(SourceHandle::None);
                sink.task.set(None);
                let err_js = err.map(|err| {
                    let err_js = err.to_js(&global_this);
                    err_js.ensure_still_alive();
                    err_js
                });
                self.write_end_request_impl(err_js);
                return Ok(());
            }
            crate::webcore::readable_stream::NativeWireResult::NotNative => {}
        }

        let assignment_result = JSSink::<FetchRequestBodySink>::assign_to_stream(
            &global_this,
            stream.value,
            NonNull::from(sink_this),
        );
        assignment_result.ensure_still_alive();

        if let Some(err) = assignment_result.to_error() {
            self.write_end_request_impl(Some(err));
            self.clear_sink();
            return Ok(());
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    bun_jsc::js_promise::Status::Pending => {
                        assignment_result.then(
                            &global_this,
                            self.this_ptr().as_ptr(),
                            crate::generated_host_exports::Bun__FetchTasklet__onResolveRequestStream,
                            crate::generated_host_exports::Bun__FetchTasklet__onRejectRequestStream,
                        );
                    }
                    bun_jsc::js_promise::Status::Fulfilled => {
                        sink.task.set(None);
                        self.write_end_request_impl(None);
                    }
                    bun_jsc::js_promise::Status::Rejected => {
                        promise.set_handled(global_this.vm());
                        let result = promise.result(global_this.vm());
                        sink.task.set(None);
                        self.write_end_request_impl(Some(result));
                    }
                }
                return Ok(());
            }
        }

        // undefined/null: the stream drained synchronously inside
        // assignToStream. `end()` no longer calls `write_end_request`, so this
        // path always releases `request_stream_ref` itself.
        sink.task.set(None);
        self.write_end_request_impl(None);
        Ok(())
    }

    fn on_body_received(&self, state: &mut SharedState) -> JsResult<()> {
        let success = state.result.is_success();
        let global_this = self.global_this;
        bun_output::scoped_log!(
            FetchTasklet,
            "onBodyReceived success={} has_more={}",
            success,
            state.result.has_more
        );
        // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
        // (on every exit, `?` failures included)
        let mut buffer_reset = true;
        let r = self.on_body_received_inner(state, success, global_this, &mut buffer_reset);
        if buffer_reset {
            let list = &mut state.scheduled_response_buffer.list;
            if list.capacity() > http::DECODED_BODY_RETAIN_CAP {
                *list = Vec::new();
            } else {
                list.clear();
            }
        }
        r
    }

    fn on_body_received_inner(
        &self,
        state: &mut SharedState,
        success: bool,
        global_this: GlobalRef,
        buffer_reset: &mut bool,
    ) -> JsResult<()> {
        if !success {
            // `ValueError`
            // has no `Drop` (it's reset-in-place, see Body.rs), so the Strong installed by
            // `to_js` would leak on the sink-cancel / no-response / `?` exits. Hold it in a
            // scopeguard and defuse via `into_inner` when ownership is transferred to
            // `to_error_instance`.
            let mut err = scopeguard::guard(self.on_reject(state), |mut e| e.reset());
            let mut js_err = JSValue::ZERO;
            // if we are streaming update with error
            if let Some(bytes) = self.response_stream.take() {
                js_err = err.to_js(&global_this);
                js_err.ensure_still_alive();
                bytes.on_data(StreamResult::Err(StreamError::JSValue(
                    bun_jsc::strong::Optional::create(js_err, &global_this),
                )));
            }
            // A failure result is terminal (`to_result` forces `has_more =
            // false` once `fail` is set), so everything pending must settle
            // here: a still-streaming request-body sink does not exempt the
            // response body. Returning right after `sink.cancel()` used to
            // leave a buffered `arrayBuffer()`/`text()` promise pending
            // forever when a fetch with an in-flight streaming request body
            // was aborted mid-response.
            if self.sink().is_some() && js_err.is_empty() {
                js_err = err.to_js(&global_this);
                js_err.ensure_still_alive();
            }
            // if we are buffering resolve the promise
            if let Some(response) = self.current_response() {
                // body value now owns the error
                let err = scopeguard::ScopeGuard::into_inner(err);
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
        if !state.result.has_more {
            // Unhook before the final delivery so it cannot signal a producer that is done;
            // release after it so the bytes land in memory we still pin.
            if let Some(bytes) = self.response_stream.take() {
                bun_output::scoped_log!(FetchTasklet, "onBodyReceived response_stream done");
                bytes.size_hint.set(Self::get_size_hint(state));
                *buffer_reset = false;
                let chunk = state.scheduled_response_buffer.list.as_slice();
                bytes.on_data(Self::temporary_chunk(chunk, true));
                return Ok(());
            }
        } else if let Some(bytes) = self.response_stream.bytes() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived response_stream");
            bytes.size_hint.set(Self::get_size_hint(state));
            let chunk = state.scheduled_response_buffer.list.as_slice();
            bytes.on_data(Self::temporary_chunk(chunk, false));
            if self.response_stream.is_held() {
                self.after_body_chunk_delivered(&bytes);
            }
            return Ok(());
        }

        if let Some(response) = self.current_response() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived Current Response");
            let size_hint = Self::get_size_hint(state);
            response.set_size_hint(size_hint);
            if let Some(readable) = response.get_body_readable_stream() {
                bun_output::scoped_log!(
                    FetchTasklet,
                    "onBodyReceived CurrentResponse BodyReadableStream"
                );
                if let Some(bytes) = readable.ptr.bytes() {
                    let chunk = state.scheduled_response_buffer.list.as_slice();

                    if state.result.has_more {
                        bytes.on_data(Self::temporary_chunk(chunk, false));
                    } else {
                        readable.value.ensure_still_alive();
                        response.detach_readable_stream(&global_this);
                        bytes.on_data(Self::temporary_chunk(chunk, true));
                    }

                    return Ok(());
                }
            }

            // `BodyAbortListener::on_abort` may have set `Error` while this
            // callback was queued; checked before `buffer_reset = false` so
            // the bytes are still dropped.
            if !matches!(response.get_body_value(), BodyValue::Locked(_)) {
                return Ok(());
            }
            // we will reach here when not streaming, this is also the only case we dont wanna to reset the buffer
            *buffer_reset = false;
            if !state.result.has_more {
                let scheduled_response_buffer =
                    core::mem::take(&mut state.scheduled_response_buffer.list);
                let body = response.get_body_value();
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
                    match &*body {
                        BodyValue::InternalBlob(b) => b.bytes.len(),
                        _ => 0,
                    }
                );

                state.scheduled_response_buffer = MutableString::default();

                if matches!(old, BodyValue::Locked(_)) {
                    bun_output::scoped_log!(FetchTasklet, "onBodyReceived old.resolve");
                    let mut old = old;
                    let headers = response.get_fetch_headers().map(NonNull::from);
                    BodyValue::resolve(&mut old, body, &self.global_this, headers)?;
                }
            }
        }
        Ok(())
    }

    /// A progress update the HTTP thread posted (`FetchShared::on_result`).
    pub(crate) fn on_progress_update(this: ThisPtr<FetchTasklet>) -> JsResult<()> {
        jsc::mark_binding!();
        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate");
        // The references released below are never the last while this runs.
        let _guard = RefPtr::from_this(this);
        let mut state = this.shared.state.lock();
        this.shared
            .has_schedule_callback
            .store(false, Ordering::Relaxed);
        let handed_back = state.handed_back;
        let (after, result) = if state.released_at_shutdown {
            // `process.exit()` took the request off the HTTP thread: nothing
            // more arrives and there is nothing to deliver; just let go.
            (AfterProgress::Release, Ok(()))
        } else {
            let is_done = !state.result.has_more;
            this.progress_update_locked(&mut state, is_done)
        };
        drop(state);
        match after {
            AfterProgress::Pending => {}
            AfterProgress::Release => Self::release(this, |t| &t.progress_ref),
            AfterProgress::Finish => {
                // The HTTP response has been fully received. If the request body
                // is still being uploaded, the HTTP layer will never drain/resume
                // it again — cancel the sink so the JS side releases the reader;
                // the pump-promise settlement drops `request_stream_ref`.
                this.cancel_request_body_sink(JSValue::UNDEFINED);
                this.poll_ref
                    .with_mut(|poll_ref| poll_ref.unref(bun_io::js_vm_ctx()));
                Self::release(this, |t| &t.progress_ref);
            }
        }
        if handed_back {
            Self::release(this, |t| &t.http_ref);
        }
        result
    }

    /// Release the reference in `slot`, if held. May free the tasklet.
    fn release(
        this: ThisPtr<FetchTasklet>,
        slot: fn(&FetchTasklet) -> &JsCell<Option<RefPtr<FetchTasklet>>>,
    ) {
        drop(slot(this.get()).replace(None));
    }

    fn progress_update_locked(
        &self,
        state: &mut SharedState,
        is_done: bool,
    ) -> (AfterProgress, JsResult<()>) {
        let done_or = |after: AfterProgress| {
            if is_done {
                after
            } else {
                AfterProgress::Pending
            }
        };
        let vm = self.global_this.bun_vm();
        // teardown forbade script: we cannot touch JS
        if !vm.script_allowed() {
            // The certificate will never be checked; release the parked
            // HTTP-thread socket instead of leaving it occupying an active
            // request slot until the idle timeout.
            if state.result.certificate_info.take().is_some() {
                if let Some(id) = self.async_http_id() {
                    http::http_thread().schedule_shutdown_by_id(id);
                }
            }
            return (done_or(AfterProgress::Release), Ok(()));
        }

        let global_this = self.global_this;

        if self.is_waiting_request_stream_start.get() && state.result.can_stream {
            // start streaming
            if let Err(err) = self.start_request_stream() {
                // The VM is being stopped: leave like the `!script_allowed()` gate above does.
                return (done_or(AfterProgress::Release), Err(err));
            }
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
            // `on_progress_update` is itself running inside `tick_queue_with_count`,
            // which already holds `&mut EventLoop`. Re-entering via
            // `(*vm.event_loop()).drain_microtasks()` was an aliased `&mut EventLoop`
            // (UB) and additionally ran `release_weak_refs` + `deferred_tasks.run()`,
            // which is observable in `fetch-leak-test-fixture-5.js`'s post-batch
            // `heapStats().Promise` count for the streaming-body cases when a fast
            // loopback coalesces `can_stream` and `metadata` into one callback —
            // pushed the count over its 35-object threshold (#53208/#53214 flaky).
            // The JSC-only drain is `&self`, runs just promise reactions (sufficient
            // for the queued `endSink(err)` to land in `write_end_request` →
            // `abort_reason`), and leaves the Bun event loop untouched.
            if state.metadata.is_some() && !self.is_waiting_body.get() {
                vm.jsc_vm().drain_microtasks();
            }
        }
        // if we already respond the metadata and still need to process the body
        if self.is_waiting_body.get() {
            // `scheduled_response_buffer` has two readers that both drain-and-reset:
            // this path (onBodyReceived) and `on_start_streaming_http_response_body`,
            // which runs once when JS first touches `res.body` and hands any already-
            // buffered bytes to the new ByteStream synchronously.
            //
            // That creates a stale-task race:
            //   1. HTTP thread `on_result()` writes N bytes to the buffer and enqueues
            //      this onProgressUpdate task (under the `state` lock).
            //   2. Main thread: JS touches `res.body` -> `onStartStreaming` drains those
            //      N bytes and resets the buffer (under the `state` lock).
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
            if state.scheduled_response_buffer.list.is_empty()
                && state.result.has_more
                && state.result.is_success()
            {
                return (done_or(AfterProgress::Finish), Ok(()));
            }
            let r = self.on_body_received(state);
            return (done_or(AfterProgress::Finish), r);
        }
        // Run the user-supplied `checkServerIdentity` callback as soon as the
        // certificate arrives. The HTTP thread parks the connection after the
        // TLS handshake (`is_waiting_for_cert_check`) and does not transmit
        // the request until this check passes, so this block must run BEFORE
        // the metadata-less early return below — the parked connection's
        // first progress update carries only the certificate (no metadata, no
        // failure) and would otherwise be dropped, leaving the socket parked
        // until the idle timeout.
        if let Some(certificate_info) = state.result.certificate_info.take() {
            // we receive some error
            if self.reject_unauthorized && !self.check_server_identity(state, &certificate_info) {
                bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: aborted due certError");
                drop(certificate_info);
                // `check_server_identity` already set abort_reason / aborted /
                // result.fail and scheduled the shutdown of the parked
                // socket; all that is left is rejecting the promise.
                let promise_value = self.promise.get().value_or_empty();
                if promise_value.is_empty_or_undefined_or_null() {
                    bun_output::scoped_log!(
                        FetchTasklet,
                        "onProgressUpdate: promise_value is null"
                    );
                    self.promise.set(jsc::JSPromiseStrong::empty());
                    return (done_or(AfterProgress::Finish), Ok(()));
                }
                // we need to abort the request
                let promise = promise_value.as_any_promise().unwrap();
                let tracker = self.tracker;
                let mut result = self.on_reject(state);

                promise_value.ensure_still_alive();
                let r = promise.reject_with_async_stack(&global_this, result.to_js(&global_this));
                result.reset();

                tracker.did_dispatch(&global_this);
                self.promise.set(jsc::JSPromiseStrong::empty());
                return (done_or(AfterProgress::Finish), r);
            }
            drop(certificate_info);
            // checkServerIdentity passed: un-park the HTTP-thread connection
            // so the request is finally written to the now-verified peer. If
            // the connection already closed/failed the resume is a no-op
            // (keyed through the abort tracker).
            if let Some(id) = self.async_http_id() {
                http::http_thread().schedule_cert_check_resume(id);
            }
            // Fall through. The common case (certificate-only update) returns
            // at the metadata-less early return below; the #27275 coalesced
            // case — the connection failed after the handshake but before
            // response headers arrived, so the certificate_info from the
            // first progress update was merged into the later failure result
            // — falls through to the reject logic with `result.fail` set.
        }

        if state.metadata.is_none() && state.result.is_success() {
            return (done_or(AfterProgress::Finish), Ok(()));
        }

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit
        if self.is_waiting_abort.get() {
            return (done_or(AfterProgress::Finish), Ok(()));
        }
        let promise_value = self.promise.get().value_or_empty();

        if promise_value.is_empty_or_undefined_or_null() {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is null");
            self.promise.set(jsc::JSPromiseStrong::empty());
            return (done_or(AfterProgress::Finish), Ok(()));
        }

        // WHATWG fetch: once the response head is available the promise
        // resolves; post-head failures (body decompression etc.) surface on
        // the body reader regardless of whether head+body arrived in one read.
        let success = state.result.is_success() || state.metadata.is_some();

        // Paired with the microtask drain after
        // startRequestStream above: the request-body sink may have set `abort_reason`
        // via writeEndRequest while the HTTP result is still a success — server HEADERS
        // raced ahead of the scheduled shutdown. Reject with that reason instead of
        // resolving a 200 Response. Makes wpt-h2 number-chunk test deterministic.
        if success && self.abort_reason.get().has() {
            let promise = promise_value.as_any_promise().unwrap();
            let tracker = self.tracker;
            // get_abort_error consumes abort_reason and clears the signal handler.
            let mut err = self.get_abort_error().unwrap();
            promise_value.ensure_still_alive();
            let r = promise.reject_with_async_stack(&global_this, err.to_js(&global_this));
            err.reset();
            tracker.did_dispatch(&global_this);
            self.promise.set(jsc::JSPromiseStrong::empty());
            return (done_or(AfterProgress::Finish), r);
        }

        let tracker = self.tracker;
        tracker.will_dispatch(&global_this);

        let result = if success {
            let resolved = self.on_resolve(state);
            // Cancel the request-body sink last (as on_body_received does):
            // closing the sink signal runs the user's cancel callback
            // synchronously, so the body error must already be stored.
            if state.result.fail.is_some() && self.sink().is_some() {
                let mut err = self.on_reject(state);
                let err_js = err.to_js(&global_this);
                err_js.ensure_still_alive();
                self.cancel_request_body_sink(err_js);
                err.reset();
            }
            StrongOptional::create(resolved, &global_this)
        } else {
            // in this case we wanna a jsc.Strong.Optional so we just convert it
            let mut value = self.on_reject(state);
            let err_js = value.to_js(&global_this);
            self.cancel_request_body_sink(err_js);
            // `to_js` leaves `value` in the `JSValue(Strong)` state (Body.rs:547). Move
            // that Strong out instead of allocating a
            // second one — `ValueError` has no `Drop`, so the inner Strong would leak.
            let BodyValueError::JSValue(strong) = value else {
                unreachable!("ValueError::to_js leaves self in JSValue state");
            };
            strong
        };

        promise_value.ensure_still_alive();

        self.pending_settle.set(Some(FetchTaskletPromiseSettle {
            held: result,
            // we need the promise to be alive until the task is done
            promise: self.promise.with_mut(jsc::JSPromiseStrong::take),
            global_object: global_this,
            success,
        }));
        self.settle_ref
            .set(Some(RefPtr::from_this(self.this_ptr())));
        vm.event_loop_mut()
            .enqueue_task(PromiseSettleHop::task(self.this_ptr()));

        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is not null");
        tracker.did_dispatch(&global_this);
        (done_or(AfterProgress::Finish), Ok(()))
    }

    fn check_server_identity(
        &self,
        state: &mut SharedState,
        certificate_info: &CertificateInfo,
    ) -> bool {
        if let Some(check_server_identity) = self.check_server_identity.get().get() {
            check_server_identity.ensure_still_alive();
            if !certificate_info.cert.is_empty() {
                if let Some(mut x509) =
                    bun_boringssl_sys::OwnedX509::from_der(&certificate_info.cert)
                {
                    let global_object = self.global_this;
                    let js_cert = match X509::to_js(x509.as_mut(), &global_object) {
                        Ok(v) => v,
                        Err(e) => {
                            let check_result = global_object.take_exception(e);
                            // mark to wait until deinit
                            self.is_waiting_abort.set(state.result.has_more);
                            self.abort_reason
                                .with_mut(|r| r.set(&global_object, check_result));
                            self.abort_task();
                            state.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
                            return false;
                        }
                    };
                    let js_hostname: JSValue = match bun_string_jsc::create_utf8_for_js(
                        &global_object,
                        &certificate_info.hostname,
                    ) {
                        Ok(v) => v,
                        Err(e) => {
                            let hostname_err_result = global_object.take_exception(e);
                            self.is_waiting_abort.set(state.result.has_more);
                            self.abort_reason
                                .with_mut(|r| r.set(&global_object, hostname_err_result));
                            self.abort_task();
                            state.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
                            return false;
                        }
                    };
                    js_hostname.ensure_still_alive();
                    js_cert.ensure_still_alive();
                    let check_result = match check_server_identity.call(
                        &global_object,
                        JSValue::UNDEFINED,
                        &[js_hostname, js_cert],
                    ) {
                        Ok(v) => v,
                        Err(e) => global_object.take_exception(e),
                    };

                    // > Returns <Error> object [...] on failure
                    if check_result.is_any_error() {
                        // mark to wait until deinit
                        self.is_waiting_abort.set(state.result.has_more);
                        self.abort_reason
                            .with_mut(|r| r.set(&global_object, check_result));
                        self.abort_task();
                        state.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
                        return false;
                    }

                    // > On success, returns <undefined>
                    // We treat any non-error value as a success.
                    return true;
                }
            }
        }
        // Empty or unparseable certificate bytes: every false return must have
        // scheduled the parked socket's shutdown, like the paths above.
        if let Some(id) = self.async_http_id() {
            http::http_thread().schedule_shutdown_by_id(id);
        }
        state.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
        false
    }

    fn get_abort_error(&self) -> Option<BodyValueError> {
        if self.abort_reason.get().has() {
            let out = self.abort_reason.replace(StrongOptional::empty());
            self.clear_abort_signal();
            return Some(BodyValueError::JSValue(out));
        }

        let reason = self
            .signal
            .get()
            .as_ref()
            .and_then(|s| s.signal().reason_if_aborted(&self.global_this));
        if let Some(reason) = reason {
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

        None
    }

    /// Drop our listener (and with it our reference on the signal and its pending activity).
    fn clear_abort_signal(&self) {
        self.signal.set(None);
    }

    fn on_reject(&self, state: &SharedState) -> BodyValueError {
        debug_assert!(state.result.fail.is_some());
        bun_output::scoped_log!(FetchTasklet, "onReject");

        if let Some(err) = self.get_abort_error() {
            return err;
        }

        if let Some(reason) = state.result.abort_reason() {
            return BodyValueError::AbortReason(reason);
        }

        let fail = state.result.fail.unwrap();

        if fail == http::Error::RequestBodyNotReusable {
            return BodyValueError::TypeError(BunString::static_(
                "Request body is a ReadableStream and cannot be replayed for this redirect",
            ));
        }

        // some times we don't have metadata so we also check the request's url
        let path = if let Some(metadata) = &state.metadata {
            BunString::clone_utf8(metadata.url())
        } else if let Some(storage) = self.request_storage() {
            BunString::clone_utf8(storage.url().href)
        } else {
            BunString::EMPTY
        };

        // The hostname never resolved: report the resolver error (`ENOTFOUND`,
        // ...) with `syscall`/`hostname`, the same shape `node:dns` produces,
        // rather than a generic connect-failure message. `dns_error` is the
        // raw getaddrinfo(3) code and is nonzero on this path, so `init_eai`
        // is always `Some`.
        if fail == http::Error::DNSResolveFailed {
            if let Some(dns_err) = c_ares::Error::init_eai(state.result.dns_error) {
                // `dns_hostname` is the owned copy of the exact name the
                // connect resolved (proxy or post-redirect target), captured
                // on the HTTP thread.
                let hostname: &[u8] = state.result.dns_hostname.as_deref().unwrap_or(b"");
                let mut err = crate::dns_jsc::cares_jsc::system_error_with_syscall_and_hostname(
                    dns_err,
                    b"getaddrinfo",
                    hostname,
                );
                err.path = path;
                return BodyValueError::SystemTypeError(err);
            }
        }

        let code = if fail == http::Error::ConnectionClosed {
            BunString::static_("ECONNRESET")
        } else {
            BunString::static_(fail.name())
        };

        let message = match fail {
            http::Error::ConnectionClosed => BunString::static_(
                "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
            ),
            http::Error::FailedToOpenSocket => {
                BunString::static_("Was there a typo in the url or port?")
            }
            http::Error::TooManyRedirects => BunString::static_(
                "The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()",
            ),
            http::Error::ConnectionRefused => {
                BunString::static_("Unable to connect. Is the computer able to access the url?")
            }
            http::Error::RedirectURLInvalid => {
                BunString::static_("Redirect URL in Location header is invalid.")
            }

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
            http::Error::Cert(http::CertError::HOSTNAME_MISMATCH) => {
                BunString::static_("Hostname mismatch")
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

        BodyValueError::SystemTypeError(fetch_error)
    }

    /// The response body's `ByteStream` now exists: become its producer.
    pub(crate) fn on_readable_stream_available(
        &self,
        _global_this: &JSGlobalObject,
        readable: &ReadableStream,
    ) {
        self.response_stream.hold(readable);
    }

    /// The response body is being realised as a `ByteStream`: hand over what is
    /// already buffered and start streaming the rest.
    pub(crate) fn on_start_streaming_http_response_body(&self) -> DrainResult {
        if self.shared.signal_store.aborted.load(Ordering::Relaxed) {
            return DrainResult::Aborted;
        }

        // A body consumer is attaching; keep the process alive until the
        // body finishes (undone in `on_progress_update` when `is_done`), or
        // until the stream parks unread (`park_body_stream`).
        self.poll_ref
            .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));

        let (size_hint, drained) = {
            let mut state = self.shared.state.lock();
            let size_hint = Self::get_size_hint(&state) as usize;
            let drained = core::mem::take(&mut state.scheduled_response_buffer.list);
            (size_hint, drained)
        };

        // After the take, not before: a chunk the HTTP thread appends (and pauses for) in
        // between would otherwise reach the stream with its task finding the buffer empty, and
        // nothing left to undo that pause. Unconditional: also flushes body bytes the client
        // holds that arrived with no follow-up read (`drain_response_body`).
        self.shared.signal_store.unpause_receive();
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

    fn get_size_hint(state: &SharedState) -> BlobSizeType {
        match state.result.body_size {
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
    /// abort too). A failed sink write reaches here from inside `on_body_received`.
    pub(crate) fn on_stream_cancelled(&self) {
        self.abort_task();
        self.abandon_response_body();
    }

    /// `SourceHandle::consumer_collected`: the parked stream's wrapper was swept, so nothing
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
        if self.shared.signal_store.unpause_receive() {
            self.schedule_receive_resume();
        }
    }

    /// A native sink was wired to the stream: something waits for bytes again.
    pub(crate) fn on_consumer_attached(&self) {
        self.unpark_body_stream();
    }

    /// The other half of this rule is in `FetchShared::on_result` (HTTP thread).
    fn after_body_chunk_delivered(&self, bytes: &ByteStream) {
        bun_output::scoped_log!(
            FetchTasklet,
            "afterBodyChunkDelivered buffered={}",
            bytes.buffered_len()
        );
        match ProducerHold::after_delivery(bytes) {
            AfterDelivery::Resume => self.resume_receive(),
            AfterDelivery::Pause => self.shared.signal_store.pause_receive(),
            AfterDelivery::Park => {
                self.shared.signal_store.pause_receive();
                self.park_body_stream();
            }
        }
    }

    fn park_body_stream(&self) {
        if self.response_stream.park() {
            bun_output::scoped_log!(FetchTasklet, "parkBodyStream");
            self.poll_ref
                .with_mut(|poll_ref| poll_ref.unref(bun_io::js_vm_ctx()));
        }
    }

    fn unpark_body_stream(&self) {
        if self.response_stream.unpark() {
            bun_output::scoped_log!(FetchTasklet, "unparkBodyStream");
            self.poll_ref
                .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));
        }
    }

    /// A consumer wants the whole response body buffered.
    pub(crate) fn on_start_buffering(&self) {
        self.poll_ref
            .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));
        if self.shared.signal_store.receive_all() {
            self.schedule_receive_resume();
        }
    }

    fn schedule_receive_resume(&self) {
        if let Some(id) = self.async_http_id() {
            http::http_thread().schedule_receive_resume(id);
        }
    }

    fn to_body_value(&self, state: &mut SharedState) -> BodyValue {
        if let Some(err) = self.get_abort_error() {
            return BodyValue::Error(err);
        }
        if state.result.fail.is_some() {
            // Head received but body failed in the same callback; surface on
            // the body so this matches the split-read `on_body_received` path.
            return BodyValue::Error(self.on_reject(state));
        }
        if self.is_waiting_body.get() {
            let mut pending = body::PendingValue::new(&self.global_this);
            pending.size_hint = Self::get_size_hint(state);
            pending.producer = SourceHandle::FetchResponseBody(BackRef::new(self));
            return BodyValue::Locked(pending);
        }

        let scheduled_response_buffer = core::mem::take(&mut state.scheduled_response_buffer);
        let response = BodyValue::InternalBlob(InternalBlob {
            bytes: scheduled_response_buffer.list,
            was_string: false,
        });
        state.scheduled_response_buffer = MutableString::default();

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
    fn null_body_value(&self, state: &mut SharedState) -> BodyValue {
        state.scheduled_response_buffer = MutableString::default();
        if state.result.has_more {
            self.abandon_response_body();
        }
        BodyValue::Null
    }

    fn to_response(&self, state: &mut SharedState) -> Response {
        bun_output::scoped_log!(FetchTasklet, "toResponse");
        debug_assert!(state.metadata.is_some());
        // at this point we always should have metadata
        let metadata = state.metadata.as_ref().unwrap();
        let http_response = &metadata.response();
        // reshaped for borrowck — capture metadata fields before to_body_value() takes &mut state
        let headers = HeadersRef::create_from_pico_headers(http_response.headers.list);
        let status_code = http_response.status_code as u16;
        // Fast path: when the wire reason phrase matches the canonical text for
        // this status code, store a StaticEncodedSlice and skip the WTF allocation.
        let status_text = match crate::server::http_status_text::get(status_code)
            .map(|t| &t[4..])
            .filter(|canon| *canon == http_response.status)
        {
            Some(canon) => BunString::static_(canon),
            None => BunString::clone_utf8(http_response.status),
        };
        let url = BunString::clone_utf8(metadata.url());
        let redirected = state.result.redirected;
        let body = if self.response_body_is_null(status_code) {
            self.null_body_value(state)
        } else {
            self.is_waiting_body.set(state.result.has_more);
            self.to_body_value(state)
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

    /// Stop being the producer of a Response body that was never realised as a
    /// stream, so nothing signals this tasklet through it afterwards.
    fn detach_response_body_producer(&self) {
        if let Some(response) = self.current_response() {
            if let BodyValue::Locked(locked) = response.get_body_value() {
                if matches!(locked.producer, SourceHandle::FetchResponseBody(_)) {
                    locked.producer = SourceHandle::None;
                }
            }
        }
    }

    /// Nothing will read the rest of the body: abort the transport, let go of the loop and of the
    /// response; `FetchShared::on_result` drops whatever still arrives. Safe inside a GC sweep
    /// (`on_response_finalize`, `on_body_stream_collected`): no JS cell is touched; the
    /// request-body sink is left for `clear_sink()` at teardown.
    fn abandon_response_body(&self) {
        bun_output::scoped_log!(FetchTasklet, "abandonResponseBody");
        self.shared.signal_store.abandon();
        self.abort_transport();
        self.poll_ref
            .with_mut(|poll_ref| poll_ref.unref(bun_io::js_vm_ctx()));
        self.clear_stream_handlers();
        self.detach_response_body_producer();
        self.response.get().clear();
        self.native_response.set(None);
    }

    fn on_resolve(&self, state: &mut SharedState) -> JSValue {
        bun_output::scoped_log!(FetchTasklet, "onResolve");
        let response = self.to_response(state);
        // The fetch() promise is about to resolve; from here the paused
        // transport should not by itself keep the event loop alive. The body
        // consumer hooks (`on_start_streaming_http_response_body`,
        // `on_start_buffering`) re-ref if the caller reads the body.
        if self.is_waiting_body.get() {
            self.poll_ref
                .with_mut(|poll_ref| poll_ref.unref(bun_io::js_vm_ctx()));
        }
        let global_this = self.global_this;
        // The JS wrapper owns the allocation; `native_response` is our reference, so
        // the body can still be settled if JS drops the Response.
        let (response_js, native_response) = response.to_js_retained(&global_this);
        response_js.ensure_still_alive();
        self.response.set(jsc::Weak::<FetchTasklet>::create(
            response_js,
            &global_this,
            jsc::WeakRefType::FetchResponse,
            BackRef::new(self),
        ));
        // Response-owned listener so abort still errors the body after this tasklet detaches its own.
        if let Some(signal) = self.signal.get().as_ref() {
            native_response.attach_abort_signal(&global_this, signal.signal());
        }
        self.native_response.set(Some(native_response));
        response_js
    }

    /// Build the tasklet and its request, start the request on the HTTP thread.
    pub(crate) fn queue(
        global_this: &JSGlobalObject,
        fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> crate::Result<()> {
        http::http_thread::init(&http::http_thread::InitOpts::default());
        jsc::mark_binding!();

        let FetchOptions {
            method,
            headers,
            body,
            disable_timeout,
            idle_timeout_seconds,
            disable_keepalive,
            disable_decompression,
            max_redirects,
            reject_unauthorized,
            url_proxy_buffer,
            url_len,
            has_proxy,
            verbose,
            redirect_type,
            proxy_headers,
            signal,
            check_server_identity,
            unix_socket_path,
            ssl_config,
            upgraded_connection,
            forced_protocol,
            is_node_http_client,
            compress,
        } = fetch_options;

        let is_stream = matches!(body, HTTPRequestBody::ReadableStream(_));
        // Out on the HTTP thread from `start` below until it hands the request
        // back: the VM waits for it (the ticket) and aborts it at teardown (registry).
        let shared = Arc::new(FetchShared {
            state: Guarded::new(SharedState::default()),
            signal_store: http::signals::Store::default(),
            has_schedule_callback: AtomicBool::new(false),
            is_http2: AtomicBool::new(false),
            tasklet: AtomicPtr::new(core::ptr::null_mut()),
            progress_task: ReusableConcurrentTask::default(),
            hand_back_task: ReusableConcurrentTask::default(),
            posts_drain_hops: is_stream,
            ticket: global_this.bun_vm().ticket().in_flight(),
        });
        let mut signals = shared.signal_store.to_with_backpressure();
        if check_server_identity.has() && reject_unauthorized {
            shared
                .signal_store
                .cert_errors
                .store(true, Ordering::Relaxed);
        } else {
            signals.cert_errors = None;
        }
        // we want to return after headers are received
        shared
            .signal_store
            .header_progress
            .store(true, Ordering::Relaxed);

        let (in_memory_body, request_body) = match body {
            HTTPRequestBody::AnyBlob(blob) => (blob, HTTPRequestBody::default()),
            other => (AnyBlob::Blob(Blob::default()), other),
        };
        // `body` was *moved* through `FetchOptions` (no shallow alias, no
        // post-queue detach), so the `RefPtr<Store>` already carries the caller's +1;
        // `clear_data()` releases it with the request storage.

        let env = global_this.bun_vm().as_mut().transpiler.env_mut();
        // Capture the proxy env so the HTTP thread can re-resolve per redirect
        // hop (`HTTPClient::reevaluate_proxy_for_redirect`). `ProxySettings`
        // owns copies of the env values, so a later `process.env.HTTP_PROXY =
        // ...` on the JS thread cannot invalidate them mid-request.
        let proxy_settings: Option<std::sync::Arc<http::ProxySettings>> = if has_proxy {
            let proxy = ZigURL::parse(&url_proxy_buffer[url_len..]);
            if !proxy.is_empty() {
                http::ProxySettings::from_explicit(proxy.href, env)
            } else {
                // proxy: "" means explicitly no proxy (direct connection)
                None
            }
        } else {
            http::ProxySettings::from_env(env)
        };
        let unframed_by_headers =
            headers.get(b"content-length").is_some() && headers.get(b"transfer-encoding").is_none();
        let Headers {
            entries: header_entries,
            buf: headers_buf,
        } = headers;
        let storage = FetchRequestStorage {
            url_proxy_buffer,
            url_len,
            headers_buf,
            unix_socket_path,
            body: in_memory_body,
        };

        let this = RefPtr::new_cyclic(|self_ref| FetchTasklet {
            ref_count: Cell::new(1),
            self_ref,
            shared: Arc::clone(&shared),
            request: JsCell::new(None),
            method,
            sink: JsCell::new(None),
            global_this: GlobalRef::from(global_this),
            request_body: JsCell::new(request_body),
            request_body_streaming_buffer: JsCell::new(None),
            response: JsCell::new(jsc::Weak::default()),
            native_response: JsCell::new(None),
            response_stream: ProducerHold::default(),
            promise: JsCell::new(promise),
            poll_ref: JsCell::new(KeepAlive::default()),
            signal: JsCell::new(None),
            abort_reason: JsCell::new(StrongOptional::empty()),
            check_server_identity: JsCell::new(check_server_identity),
            reject_unauthorized,
            upgraded_connection,
            unframed_by_headers,
            is_waiting_body: Cell::new(false),
            is_waiting_abort: Cell::new(false),
            is_waiting_request_stream_start: Cell::new(is_stream),
            tracker: AsyncTaskTracker::init(global_this.bun_vm().as_mut()),
            progress_ref: JsCell::new(None),
            pending_settle: JsCell::new(None),
            settle_ref: JsCell::new(None),
            http_ref: JsCell::new(None),
            request_stream_ref: JsCell::new(None),
        });
        let this_ptr = this.this_ptr();
        // The reference `RefPtr::new_cyclic` created is the JS side's.
        this_ptr.progress_ref.set(Some(this));
        let this = this_ptr;
        shared.tasklet.store(this.as_ptr(), Ordering::Relaxed);

        this.tracker.did_schedule(global_this);

        let request_body_buffer = if is_stream {
            let handler: Arc<dyn http::DrainHandler> = Arc::<FetchShared>::clone(&shared);
            let buffer = ThreadSafeStreamBuffer::create(handler);
            let attached = http::http_request_body::Stream::attach(&buffer);
            this.request_body_streaming_buffer.set(Some(buffer));
            Some(attached)
        } else {
            None
        };
        let sendfile = match this.request_body.get() {
            HTTPRequestBody::Sendfile(sendfile) => {
                debug_assert!(!has_proxy);
                Some(*sendfile)
            }
            _ => None,
        };

        let handler_arc: Arc<FetchShared> = Arc::clone(&shared);
        let mut request = OwnedRequest::new(storage, |storage| {
            let url = storage.url();
            debug_assert!(sendfile.is_none() || url.is_http());
            AsyncHTTP::init(
                method,
                url,
                header_entries,
                storage.headers_buf.as_slice(),
                storage.body.slice(),
                // handles response events (on headers, on body, etc.)
                http::HTTPClientResultCallback::from_handler(handler_arc),
                redirect_type,
                http::async_http::Options {
                    // Hop 0's proxy is resolved from `proxy_settings` too.
                    http_proxy: None,
                    proxy_settings,
                    proxy_headers,
                    signals: Some(signals),
                    unix_socket_path: Some(&storage.unix_socket_path),
                    disable_timeout: Some(disable_timeout),
                    idle_timeout_seconds,
                    disable_keepalive: Some(disable_keepalive),
                    disable_decompression: Some(disable_decompression),
                    max_redirects,
                    reject_unauthorized: Some(reject_unauthorized),
                    verbose: Some(verbose),
                    tls_props: ssl_config,
                    compress,
                },
            )
        });
        request.with_http_mut(|http_client| {
            http_client.client.flags.is_streaming_request_body = is_stream;
            http_client.client.flags.forced_protocol = forced_protocol;
            http_client.client.flags.is_node_http_client = is_node_http_client;
            if let Some(stream) = request_body_buffer {
                http_client.set_request_body(http::HTTPRequestBody::Stream(stream));
            }
            // TODO is this necessary? the http client already sets the redirect type,
            // so manually setting it here seems redundant
            if redirect_type != FetchRedirect::Follow {
                http_client.client.remaining_redirect_count = 0;
            }
            if let Some(sendfile) = sendfile {
                http_client.set_request_body(http::HTTPRequestBody::Sendfile(sendfile));
            }
        });

        if let Some(signal) = signal {
            this.signal.set(Some(
                signal.listen_native(this.self_ref.backref(this.get())),
            ));
        }

        this.poll_ref
            .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));
        // The HTTP thread's reference, from `start` until it hands the request back.
        this.http_ref.set(Some(RefPtr::from_this(this)));
        crate::jsc_hooks::ActiveHandle::Fetch(NonNull::from(this)).register();
        let mut batch = bun_threading::thread_pool::Batch::default();
        this.request.set(Some(request.start(&mut batch)));
        http::HTTPThread::schedule(batch);

        Ok(())
    }

    /// This is ALWAYS called from the main thread: the HTTP thread drained the
    /// request body buffer (`FetchShared::on_drain`).
    pub(crate) fn resume_request_data_stream(this: ThisPtr<FetchTasklet>) {
        bun_output::scoped_log!(FetchTasklet, "resumeRequestDataStream");
        // The stream this resumes may end and release `request_stream_ref`.
        let _guard = RefPtr::from_this(this);
        if !this.signal_aborted() {
            let global_this = this.global_this;
            if let Some(sink) = this.sink() {
                sink.on_drain(&global_this);
            }
        }
    }

    /// Whether the request body should skip chunked transfer encoding framing.
    /// True for upgraded connections (e.g. WebSocket) or when the user explicitly
    /// set Content-Length without setting Transfer-Encoding.
    pub(crate) fn skip_chunked_framing(&self) -> bool {
        self.upgraded_connection
            || self.shared.is_http2.load(Ordering::Relaxed)
            || self.unframed_by_headers
    }

    /// Called from `FetchRequestBodySink::write_*`; `high_water_mark` is the
    /// sink's configured HWM so the backpressure threshold tracks
    /// `start({ highWaterMark })`.
    pub(crate) fn write_request_data(
        &self,
        data: RequestBodyChunk<'_>,
        high_water_mark: usize,
    ) -> Writable {
        if self.signal_aborted() {
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
        let len = utf8_len as BlobSizeType;
        let Some(thread_safe_stream_buffer) = self.request_body_buffer() else {
            return Writable::Done;
        };
        // Mutex guards `buffer` against the HTTP thread; released when
        // `stream_buffer` drops.
        let mut stream_buffer = thread_safe_stream_buffer.lock();

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
        drop(stream_buffer);

        if needs_schedule {
            // wakeup the http thread to write the data
            if let Some(id) = self.async_http_id() {
                http::http_thread()
                    .schedule_request_write(id, http::http_thread::WriteMessageType::Data);
            }
        }

        // pause the stream if we hit the high water mark
        result
    }

    /// The request body stream is done (`err`: why, if it failed): flush the
    /// terminator and release `request_stream_ref`. May free the tasklet.
    pub(crate) fn write_end_request(this: ThisPtr<FetchTasklet>, err: Option<JSValue>) {
        let _guard = RefPtr::from_this(this);
        this.write_end_request_impl(err);
    }

    /// [`write_end_request`](Self::write_end_request) for callers that already
    /// hold a reference across the call.
    fn write_end_request_impl(&self, err: Option<JSValue>) {
        bun_output::scoped_log!(FetchTasklet, "writeEndRequest hasError? {}", err.is_some());
        self.end_request(err);
        drop(self.request_stream_ref.replace(None));
    }

    fn end_request(&self, err: Option<JSValue>) {
        if let Some(js_error) = err {
            if self.shared.signal_store.aborted.load(Ordering::Relaxed)
                || self.abort_reason.get().has()
            {
                return;
            }
            if !js_error.is_undefined_or_null() {
                self.abort_reason
                    .with_mut(|r| r.set(&self.global_this, js_error));
            }
            self.abort_task();
        } else {
            if self.shared.signal_store.aborted.load(Ordering::Relaxed) {
                return;
            }
            if !self.skip_chunked_framing() {
                // Using chunked transfer encoding, send the terminating chunk
                let Some(thread_safe_stream_buffer) = self.request_body_buffer() else {
                    return;
                };
                // Mutex guards `buffer` against the HTTP thread; released when
                // the lock guard drops.
                let _ = thread_safe_stream_buffer
                    .lock()
                    .write(http::END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY); // OOM/capacity: fire-and-forget
            }
            if let Some(id) = self.async_http_id() {
                http::http_thread()
                    .schedule_request_write(id, http::http_thread::WriteMessageType::End);
            }
        }
    }

    /// The sink's fallback release of `request_stream_ref` (its `finalize`).
    /// May free the tasklet.
    pub(crate) fn release_request_stream_ref(this: ThisPtr<FetchTasklet>) {
        Self::release(this, |t| &t.request_stream_ref);
    }

    fn abort_task(&self) {
        if self.abort_transport() {
            self.tracker.did_cancel(&self.global_this);
        }
    }

    /// Idempotent: an AbortSignal, VM teardown and `abandon_response_body` can all reach here for
    /// the same fetch. Only the first enqueues a shutdown. No JS.
    fn abort_transport(&self) -> bool {
        if self
            .shared
            .signal_store
            .aborted
            .swap(true, Ordering::Relaxed)
        {
            return false;
        }
        if let Some(id) = self.async_http_id() {
            http::http_thread().schedule_shutdown_by_id(id);
        }
        true
    }

    /// Cancel an in-flight request-body sink: stores the abort reason, aborts
    /// the HTTP task, marks the sink ended/done, and fires the controller's
    /// onClose (which cancels the upstream ReadableStream reader). On the JS
    /// pump path the single balancing `write_end_request` is left to the
    /// `assign_to_stream` pump-promise settlement (on_resolve/on_reject); on
    /// the native ByteStream path there is no pump promise, so balance it
    /// here. No-op when no sink or already ended.
    pub(crate) fn cancel_request_body_sink(&self, reason: JSValue) {
        let Some(sink) = self.sink() else {
            return;
        };
        if sink.ended.get() {
            return;
        }
        sink.ended.set(true);
        sink.done.set(true);
        let is_native = sink.is_native_source();
        if !reason.is_empty_or_undefined_or_null() && !self.abort_reason.get().has() {
            let global_this = self.global_this;
            self.abort_reason.with_mut(|r| r.set(&global_this, reason));
        }
        self.abort_task();
        if let Some(sink) = self.sink() {
            sink.cancel();
            if is_native {
                sink.task.set(None);
            }
        }
        if is_native {
            // No pump promise exists to release `request_stream_ref`; `aborted`
            // is set above so this is just that release.
            self.write_end_request_impl(Some(reason));
        }
    }
}

/// `WeakRefType::FetchResponse`'s finalize callback: the Response's JS wrapper
/// (`response`) was collected. Inside a GC sweep: decide from native state only.
// HOST_EXPORT(Bun__FetchResponse_finalize, c)
pub fn on_response_finalize(this: &crate::webcore::fetch::FetchTasklet) {
    bun_output::scoped_log!(FetchTasklet, "onResponseFinalize");
    let Some(response) = this.native_response.get().as_deref() else {
        return;
    };
    let BodyValue::Locked(locked) = response.get_body_value() else {
        // The body arrived or failed; nothing is underway.
        return;
    };
    // What can outlive the Response and still take the body: its stream (whose own collection
    // is `on_body_stream_collected`), or a whole-body consumer (`.text()` and friends hold a
    // promise, `Bun.write` an `on_receive_value`).
    let outlived = this.response_stream.is_held()
        || locked.on_receive_value.is_some()
        || locked
            .promise
            .is_some_and(|promise| !promise.is_empty_or_undefined_or_null());
    if !outlived {
        this.abandon_response_body();
    }
}

impl jsc::NativeAbortListener for FetchTasklet {
    fn on_abort(this: ThisPtr<Self>, reason: JSValue) {
        bun_output::scoped_log!(FetchTasklet, "abortListener");
        // Cancelling the sink may release `request_stream_ref`.
        let _guard = RefPtr::from_this(this);
        reason.ensure_still_alive();
        this.abort_reason
            .with_mut(|r| r.set(&this.global_this, reason));
        this.abort_task();
        if this.sink().is_some() {
            this.cancel_request_body_sink(reason);
            return;
        }
        // Abort fired before the HTTP thread asked for the body, so the
        // ReadableStream was never wired into a sink. Cancel it directly so
        // the underlying source's cancel(reason) callback still observes the
        // signal's reason (https://fetch.spec.whatwg.org/#abort-fetch step 5).
        if this.is_waiting_request_stream_start.get() {
            if let HTTPRequestBody::ReadableStream(stream_ref) = this.request_body.get() {
                this.is_waiting_request_stream_start.set(false);
                if let Some(stream) = stream_ref.get() {
                    crate::dispatch::fold(stream.cancel_with_reason(&this.global_this, reason));
                }
            }
        }
    }
}

impl Drop for FetchTasklet {
    fn drop(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "deinit");
        // JS thread: no longer something the VM must abort at teardown.
        crate::jsc_hooks::ActiveHandle::Fetch(NonNull::from(&*self)).unregister();
        self.clear_data();
    }
}

/// The `assign_to_stream` pump settled: the request body stream is done.
// HOST_EXPORT(Bun__FetchTasklet__onResolveRequestStream)
pub fn on_resolve_request_stream(
    this: ThisPtr<FetchTasklet>,
    _global_this: &JSGlobalObject,
    _callframe: &bun_jsc::CallFrame,
) -> JsResult<JSValue> {
    let _guard = RefPtr::from_this(this);
    // Clear `sink.task` first so the sink's `finalize()` fallback does not
    // release a second time.
    if let Some(sink) = this.sink() {
        sink.task.set(None);
    }
    this.write_end_request_impl(None);
    Ok(JSValue::UNDEFINED)
}

/// The `assign_to_stream` pump rejected: the request body stream failed.
// HOST_EXPORT(Bun__FetchTasklet__onRejectRequestStream)
pub fn on_reject_request_stream(
    this: ThisPtr<FetchTasklet>,
    _global_this: &JSGlobalObject,
    callframe: &bun_jsc::CallFrame,
) -> JsResult<JSValue> {
    let err = callframe.argument(0);
    let _guard = RefPtr::from_this(this);
    if let Some(sink) = this.sink() {
        sink.task.set(None);
    }
    this.write_end_request_impl(Some(err));
    Ok(JSValue::UNDEFINED)
}

pub struct FetchOptions {
    pub method: Method,
    pub(crate) headers: Headers,
    pub(crate) body: HTTPRequestBody,
    pub(crate) disable_timeout: bool,
    /// Per-request idle-timeout override, from `fetch(url, { timeout: <ms> })`.
    pub(crate) idle_timeout_seconds: Option<core::ffi::c_uint>,
    pub(crate) disable_keepalive: bool,
    pub(crate) disable_decompression: bool,
    pub(crate) max_redirects: Option<u8>,
    pub(crate) reject_unauthorized: bool,
    /// url + proxy href, back to back; `url_len` splits them.
    pub(crate) url_proxy_buffer: Box<[u8]>,
    pub(crate) url_len: usize,
    pub(crate) has_proxy: bool,
    pub(crate) verbose: http::HTTPVerboseLevel,
    pub(crate) redirect_type: FetchRedirect,
    pub(crate) proxy_headers: Option<Headers>,
    pub(crate) signal: Option<AbortSignalRef>,
    pub(crate) check_server_identity: StrongOptional,
    pub(crate) unix_socket_path: Box<[u8]>,
    pub(crate) ssl_config: Option<http::ssl_config::SharedPtr>,
    pub(crate) upgraded_connection: bool,
    pub(crate) forced_protocol: Option<http::Protocol>,
    pub(crate) is_node_http_client: bool,
    pub(crate) compress: Option<http::compress_body::CompressOption>,
}

/// Settles the `fetch()` promise from its own event-loop task.
pub(crate) struct FetchTaskletPromiseSettle {
    held: StrongOptional,
    promise: jsc::JSPromiseStrong,
    global_object: GlobalRef,
    success: bool,
}

/// `task_tag::FetchTaskletPromiseSettle`: settle the `fetch()` promise
/// (`FetchTasklet::pending_settle`).
pub struct PromiseSettleHop;
impl TaskHop for PromiseSettleHop {
    type Target = FetchTasklet;
    const TAG: bun_event_loop::TaskTag = task_tag::FetchTaskletPromiseSettle;
    fn run(this: ThisPtr<FetchTasklet>) -> JsResult<()> {
        let settle = this.pending_settle.replace(None);
        let result = match settle {
            Some(settle) => settle.run(),
            None => Ok(()),
        };
        FetchTasklet::release(this, |t| &t.settle_ref);
        result
    }
    /// Drop the held value and promise handle without settling.
    fn release_unrun(this: ThisPtr<FetchTasklet>) {
        this.pending_settle.set(None);
        FetchTasklet::release(this, |t| &t.settle_ref);
    }
}

impl FetchTaskletPromiseSettle {
    fn run(mut self) -> JsResult<()> {
        let prom = self.promise.value_or_empty().as_any_promise().unwrap();
        let res = self.held.swap();
        res.ensure_still_alive();
        let r = if self.success {
            prom.resolve(&self.global_object, res)
        } else {
            prom.reject_with_async_stack(&self.global_object, res)
        };
        self.held.deinit();
        self.promise = jsc::JSPromiseStrong::empty();
        r
    }
}
