//! Where batches go: a collector over OTLP/HTTP, stderr, or a function.

use core::fmt;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bun_http::async_http::Options as HttpOptions;
use bun_http::compress_body::{CompressEncoding, CompressOption};
use bun_http::{
    AsyncHTTP, FetchRedirect, FinishedRequest, HTTPClientResult, HTTPClientResultCallback,
    HTTPResponseMetadata, HTTPThread, HeaderBuilder, Method,
};
use bun_jsc::bindgen::{JsHeap, JsLocal};
use bun_jsc::js_promise::Status;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSPromise, JSValue, JsResult, Strong, VmHandle, bun_string_jsc};
use bun_telemetry::MonoInstant;
use bun_telemetry::processor::{
    self, Backoff, ExportAttempt, ExportPayload, ExportResult, Exporter, OwnerKey,
};
use bun_telemetry_cold::config::{Compression, ExporterConfig, OtlpExporterConfig};
use bun_threading::{Condvar, Guarded};
use bun_url::URL;

use crate::context::Context;
use crate::engine::{self, Entered};
use crate::generated_bindgen::telemetry_internals::{
    Bun__Telemetry__onExportReject, Bun__Telemetry__onExportResolve,
};
use crate::span::global_of;
use crate::state::{VmState, VmTask};

struct OtlpHttpExporter {
    url: Box<[u8]>,
    headers: HeaderBuilder,
    compression: Compression,
    timeout: Duration,
    has_warned: AtomicBool,
    /// The client's idle timeout starts again at every read, so a response that trickles in needs a deadline.
    in_flight: Guarded<Vec<Deadline>>,
    proxy: Box<[u8]>,
    reject_unauthorized: bool,
}

// SAFETY: `headers` owns its bytes and is not written after `new`.
unsafe impl Send for OtlpHttpExporter {}
// SAFETY: as above.
unsafe impl Sync for OtlpHttpExporter {}

struct Deadline {
    async_http_id: u32,
    aborted: Arc<AtomicBool>,
    at: MonoInstant,
}

const MAX_ATTEMPTS: u32 = 5;
/// Retries, and the batches of VMs that leave, do not wait for their turn.
const MAX_IN_FLIGHT: usize = 8;

enum SendError {
    Transport(bun_http::Error),
    Status {
        code: u32,
        retry_after_seconds: Option<u32>,
    },
    OutOfTime,
}

impl SendError {
    /// https://opentelemetry.io/docs/specs/otlp/#retryable-response-codes
    fn is_retryable(&self) -> bool {
        match self {
            SendError::Transport(_) | SendError::OutOfTime => true,
            SendError::Status { code, .. } => matches!(code, 408 | 429 | 502 | 503 | 504),
        }
    }

    /// At exit there is no later.
    fn is_worth_a_try_at_once(&self) -> bool {
        match self {
            SendError::Transport(_) => true,
            SendError::Status {
                code,
                retry_after_seconds,
            } => matches!(code, 502..=504) && retry_after_seconds.is_none(),
            SendError::OutOfTime => false,
        }
    }
}

impl fmt::Display for SendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SendError::Transport(e) => write!(f, "{e}"),
            SendError::Status { code, .. } => write!(f, "HTTP {code}"),
            SendError::OutOfTime => f.write_str("no response in time"),
        }
    }
}

fn check_response(response: &HTTPResponseMetadata, body: &[u8]) -> Result<(), SendError> {
    let code = response.status_code();
    if !(200..300).contains(&code) {
        return Err(SendError::Status {
            code,
            retry_after_seconds: (response.header(b"retry-after"))
                .and_then(|v| bun_core::fmt::parse_unsigned::<u32>(v.trim_ascii(), 10).ok()),
        });
    }
    match bun_telemetry_cold::decode::partial_success(body) {
        Some((rejected, message)) if rejected > 0 => warn(format_args!(
            "collector rejected {rejected} span(s): {}",
            bstr::BStr::new(&message)
        )),
        Some((_, message)) if !message.is_empty() => {
            warn(format_args!("collector: {}", bstr::BStr::new(&message)))
        }
        _ => {}
    }
    Ok(())
}

pub(crate) fn warn(message: fmt::Arguments<'_>) {
    bun_core::warn!("[otel] {}", message);
    bun_core::Output::flush();
}

/// The userinfo and the query may hold a credential.
fn display_url(url: &[u8]) -> Vec<u8> {
    let path_end = bun_core::strings::index_of_any(url, b"?#").unwrap_or(url.len());
    bun_telemetry::otlp::redact_url(&url[..path_end]).into_owned()
}

pub(crate) enum InvalidExporter {
    Url(Vec<u8>),
    Header(String),
}

impl fmt::Display for InvalidExporter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InvalidExporter::Url(url) => write!(
                f,
                "invalid OTLP endpoint URL {:?} (expected http:// or https://)",
                bstr::BStr::new(url)
            ),
            InvalidExporter::Header(name) => {
                write!(f, "invalid OTLP header {name:?} (it has a line break)")
            }
        }
    }
}

#[optimize(size)]
pub(crate) fn build(
    vm: &VirtualMachine,
    configs: &[ExporterConfig],
) -> Result<Vec<Arc<dyn Exporter>>, InvalidExporter> {
    configs
        .iter()
        .map(|config| {
            Ok(match config {
                ExporterConfig::Otlp(config) => {
                    Arc::new(OtlpHttpExporter::new(vm, config)?) as Arc<dyn Exporter>
                }
                ExporterConfig::Console => Arc::new(ConsoleExporter),
            })
        })
        .collect()
}

impl OtlpHttpExporter {
    #[optimize(size)]
    fn new(vm: &VirtualMachine, config: &OtlpExporterConfig) -> Result<Self, InvalidExporter> {
        let url = URL::parse(config.url.as_bytes());
        if url.hostname.is_empty() || !(url.is_http() || url.is_https()) {
            return Err(InvalidExporter::Url(display_url(config.url.as_bytes())));
        }
        let mut headers: Vec<(&[u8], &[u8])> = vec![(b"content-type", b"application/x-protobuf")];
        if config.compression == Compression::Gzip {
            headers.push((b"content-encoding", b"gzip"));
        }
        let credentials = bun_http::async_http::basic_authorization(&url);
        if let Some(credentials) = &credentials
            && !(config.headers.iter()).any(|(name, _)| name.eq_ignore_ascii_case("authorization"))
        {
            headers.push((b"authorization", credentials));
        }
        for (name, value) in &config.headers {
            let pair = (name.as_bytes(), value.as_bytes());
            if [pair.0, pair.1]
                .into_iter()
                .any(bun_http::async_http::breaks_header_line)
            {
                return Err(InvalidExporter::Header(name.clone()));
            }
            headers.push(pair);
        }
        Ok(OtlpHttpExporter {
            headers: bun_core::handle_oom(HeaderBuilder::from_pairs(&headers)),
            compression: config.compression,
            timeout: Duration::from_millis(match config.timeout_ms {
                0 => u32::MAX.into(),
                ms => ms.into(),
            }),
            has_warned: AtomicBool::new(false),
            in_flight: Guarded::new(Vec::new()),
            proxy: (vm.env_loader().get_http_proxy_for(&url))
                .map(|proxy| Box::from(proxy.href))
                .unwrap_or_default(),
            reject_unauthorized: vm.get_tls_reject_unauthorized(),
            url: config.url.as_bytes().into(),
        })
    }

    fn send(self: Arc<Self>, payload: Arc<ExportPayload>, receiver: Receiver) {
        let aborted = Arc::new(AtomicBool::new(false));
        let request = bun_core::heap::into_raw(Box::new(Request {
            exporter: self,
            payload,
            receiver,
            aborted: Arc::clone(&aborted),
            async_http_id: 0,
        }));
        // SAFETY: `Request::finish` frees it, once the client that borrows from it is gone.
        let borrowed: &'static mut Request = unsafe { &mut *request };
        let exporter = &*borrowed.exporter;
        let mut http = AsyncHTTP::init(
            Method::POST,
            URL::parse(&exporter.url),
            bun_core::handle_oom(exporter.headers.entries.clone()),
            exporter.headers.content.written_slice(),
            &borrowed.payload.body,
            HTTPClientResultCallback::new_with_release(
                request,
                Request::on_result,
                Request::release_at_shutdown,
            ),
            // Following a redirect would send the credentials in `headers` to whoever it names.
            FetchRedirect::Error,
            HttpOptions {
                http_proxy: (!exporter.proxy.is_empty()).then(|| URL::parse(&exporter.proxy)),
                reject_unauthorized: Some(exporter.reject_unauthorized),
                idle_timeout_seconds: Some(exporter.timeout.as_secs() as u32 + 1),
                signals: Some(bun_http::Signals {
                    aborted: Some(NonNull::from_ref(Arc::as_ref(&borrowed.aborted))),
                    ..Default::default()
                }),
                compress: (exporter.compression == Compression::Gzip).then_some(CompressOption {
                    encoding: CompressEncoding::Gzip,
                    level: None,
                }),
                ..Default::default()
            },
        );
        http.client.flags.ignores_request_limit = true;
        borrowed.async_http_id = http.async_http_id;
        exporter.in_flight.lock().push(Deadline {
            async_http_id: http.async_http_id,
            aborted,
            at: MonoInstant::now() + exporter.timeout,
        });
        bun_http::http_thread::init(&Default::default());
        HTTPThread::schedule([http]);
    }

    fn send_blocking(
        self: &Arc<Self>,
        payload: &Arc<ExportPayload>,
        deadline: MonoInstant,
    ) -> Result<(), SendError> {
        let deadline = deadline.min(MonoInstant::now() + self.timeout);
        let outcome = Arc::new(Outcome {
            result: Guarded::new(None),
            arrived: Condvar::new(),
        });
        let receiver = Receiver::BlockedThread(Arc::clone(&outcome));
        Arc::clone(self).send(Arc::clone(payload), receiver);
        let mut result = outcome.result.lock();
        while result.is_none() && !deadline.remaining().is_zero() && !is_http_thread_stuck() {
            let slice = deadline.remaining().min(Duration::from_millis(100));
            let _ = (outcome.arrived).timed_wait_guarded(&mut result, slice.as_nanos() as u64);
        }
        result.take().unwrap_or(Err(SendError::OutOfTime))
    }

    fn failed(self: Arc<Self>, attempt: ExportAttempt, error: &SendError) {
        if !error.is_retryable() || attempt.attempt() + 1 >= MAX_ATTEMPTS {
            self.warn_once(attempt.payload(), "", error);
            return attempt.done(ExportResult::Failure);
        }
        let backoff = match error {
            SendError::Status {
                retry_after_seconds: Some(seconds),
                ..
            } => Backoff::AskedByServer(Duration::from_secs(u64::from(*seconds).clamp(1, 120))),
            _ => Backoff::Own(Duration::from_secs(1 << attempt.attempt())),
        };
        attempt.retry_later(self, backoff);
    }

    fn warn_once(&self, payload: &ExportPayload, when: &str, error: &SendError) {
        if !self.has_warned.swap(true, Ordering::Relaxed) {
            warn(format_args!(
                "exporting {} span(s) to {}{when} failed: {error} (further export errors from this exporter are silenced; see Bun.otel.stats())",
                payload.span_count,
                bstr::BStr::new(&display_url(&self.url)),
            ));
        }
    }
}

/// For a thread that waits for it. `fetch()` runs some callbacks under a lock that the HTTP thread takes, and one
/// of them may be what ends the process.
pub(crate) fn is_http_thread_stuck() -> bool {
    struct Watch {
        turn: u32,
        since: MonoInstant,
        asked_at: MonoInstant,
    }
    static WATCH: Guarded<Option<Watch>> = Guarded::new(None);
    let (turn, now) = (HTTPThread::poke(), MonoInstant::now());
    let mut watch = WATCH.lock();
    match &mut *watch {
        // Unless it has been asked all along, it was asleep.
        Some(w) if w.turn == turn && now.since(w.asked_at) < Duration::from_millis(500) => {
            w.asked_at = now;
            now.since(w.since) > Duration::from_secs(2)
        }
        _ => {
            *watch = Some(Watch {
                turn,
                since: now,
                asked_at: now,
            });
            false
        }
    }
}

struct Outcome {
    result: Guarded<Option<Result<(), SendError>>>,
    arrived: Condvar,
}

enum Receiver {
    Processor(ExportAttempt),
    BlockedThread(Arc<Outcome>),
}

struct Request {
    exporter: Arc<OtlpHttpExporter>,
    payload: Arc<ExportPayload>,
    receiver: Receiver,
    aborted: Arc<AtomicBool>,
    async_http_id: u32,
}

impl Request {
    fn on_result(
        this: *mut Self,
        finished: Option<FinishedRequest>,
        mut result: HTTPClientResult<'_>,
    ) {
        if result.has_more {
            return;
        }
        drop(finished);
        let mut body = Vec::new();
        result.body_into(&mut body);
        let result = (result.into_metadata().map_err(SendError::Transport))
            .and_then(|response| check_response(&response, &body));
        // SAFETY: the box of `send`, and this is its last result.
        unsafe { bun_core::heap::take(this) }.finish(result);
    }

    unsafe fn release_at_shutdown(this: *mut ()) {
        // SAFETY: the box of `send`, which gets no result any more.
        let this = unsafe { bun_core::heap::take(this.cast::<Self>()) };
        match this.receiver {
            Receiver::Processor(attempt) => attempt.abandoned(),
            Receiver::BlockedThread(_) => {}
        }
    }

    fn finish(self, result: Result<(), SendError>) {
        (self.exporter.in_flight.lock()).retain(|d| d.async_http_id != self.async_http_id);
        match (self.receiver, result) {
            (Receiver::Processor(attempt), Ok(())) => attempt.done(ExportResult::Success),
            (Receiver::Processor(attempt), Err(error)) => self.exporter.failed(attempt, &error),
            (Receiver::BlockedThread(outcome), result) => {
                *outcome.result.lock() = Some(result);
                outcome.arrived.notify_one();
            }
        }
    }
}

impl Exporter for OtlpHttpExporter {
    fn export(self: Arc<Self>, attempt: ExportAttempt) {
        if self.in_flight.lock().len() >= MAX_IN_FLIGHT {
            return self.failed(attempt, &SendError::OutOfTime);
        }
        self.send(Arc::clone(attempt.payload()), Receiver::Processor(attempt));
    }

    fn tick(&self, now: MonoInstant) {
        for overdue in self.in_flight.lock().extract_if(.., |d| now >= d.at) {
            overdue.aborted.store(true, Ordering::Relaxed);
            HTTPThread::schedule_shutdown(overdue.async_http_id);
        }
    }

    fn export_blocking(
        self: Arc<Self>,
        payload: &Arc<ExportPayload>,
        deadline: MonoInstant,
    ) -> ExportResult {
        let result = match self.send_blocking(payload, deadline) {
            Err(error) if error.is_worth_a_try_at_once() && !payload.is_parked() => {
                self.send_blocking(payload, deadline)
            }
            result => result,
        };
        match result {
            Ok(()) => ExportResult::Success,
            Err(error) => {
                self.warn_once(payload, " at exit", &error);
                ExportResult::Failure
            }
        }
    }
}

/// One OTLP/JSON document per batch on stderr.
struct ConsoleExporter;

impl Exporter for ConsoleExporter {
    fn export(self: Arc<Self>, _: ExportAttempt) {
        unreachable!("synchronous");
    }

    fn is_synchronous(&self) -> bool {
        true
    }

    fn export_blocking(
        self: Arc<Self>,
        payload: &Arc<ExportPayload>,
        _: MonoInstant,
    ) -> ExportResult {
        let mut json = bun_telemetry_cold::otlp_json::to_json(&payload.body);
        json.push(b'\n');
        bun_core::Output::print_error(bstr::BStr::new(&json));
        bun_core::Output::flush();
        ExportResult::Success
    }
}

#[derive(Clone, Copy)]
pub(crate) enum JsFormat {
    Objects,
    Protobuf,
    Json,
}

struct JsAttempt {
    ticket: u64,
    deadline: MonoInstant,
    has_started: bool,
    attempt: ExportAttempt,
}

pub(crate) struct JsExporter {
    format: JsFormat,
    vm: VmHandle,
    owner: OwnerKey,
    /// From the moment it is posted to `vm` until the function has returned, or its promise has settled.
    attempts: Guarded<Vec<JsAttempt>>,
    /// Replaced by a later `start()`. It finishes its attempts.
    is_retired: AtomicBool,
}

/// What the VM that made the exporter keeps.
pub(crate) struct OwnedJsExporter {
    pub(crate) shared: Arc<JsExporter>,
    function: Strong,
    this: Strong,
}

pub struct QueuedExport {
    exporter: Arc<JsExporter>,
    ticket: u64,
}

impl Drop for QueuedExport {
    fn drop(&mut self) {
        let unrun = |a: &JsAttempt| a.ticket == self.ticket && !a.has_started;
        (self.exporter.take(unrun)).for_each(ExportAttempt::abandoned);
    }
}

impl QueuedExport {
    pub(crate) fn run(self, state: &VmState) -> JsResult<()> {
        let global = state.global();
        if let Some(promise) = self.exporter.run(state, self.ticket)? {
            promise.then_with_value(
                global,
                JSValue::js_number(self.ticket as f64),
                Bun__Telemetry__onExportResolve,
                Bun__Telemetry__onExportReject,
            );
        }
        // It enforces the export timeout, and lets go of the retired.
        state.arm_timer();
        Ok(())
    }
}

enum Delivery {
    Settled(ExportResult),
    Pending(JSValue),
}

/// A warning: an exporter that fails must not take the program down.
fn report_failure(global: &JSGlobalObject, error: JSValue) {
    let description = engine::describe_passing_error(global, error);
    warn(format_args!(
        "exporter callback failed: {}",
        description.message
    ));
}

fn warn_of_pending_export() {
    warn(format_args!(
        "an async exporter was still pending at process exit; its batch may be lost\nnote: await Bun.otel.shutdown() before exiting"
    ));
}

impl JsExporter {
    pub(crate) fn create(
        state: &VmState,
        function: JSValue,
        this: JSValue,
        format: JsFormat,
    ) -> OwnedJsExporter {
        let global = state.global();
        OwnedJsExporter {
            shared: Arc::new(JsExporter {
                format,
                vm: global.bun_vm().handle(),
                owner: state.owner_key(),
                attempts: Guarded::new(Vec::new()),
                is_retired: AtomicBool::new(false),
            }),
            function: Strong::create(function, global),
            this: Strong::create(this, global),
        }
    }

    fn all_of(state: &VmState) -> Vec<Arc<JsExporter>> {
        let owned = state.js_exporters.borrow();
        owned.iter().map(|e| Arc::clone(&e.shared)).collect()
    }

    fn owner_state(&self) -> Option<&'static VmState> {
        VmState::current().filter(|state| state.owner_key() == self.owner)
    }

    fn take(&self, which: impl Fn(&JsAttempt) -> bool) -> impl Iterator<Item = ExportAttempt> {
        let taken: Vec<_> = self.attempts.lock().extract_if(.., |a| which(a)).collect();
        taken.into_iter().map(|a| a.attempt)
    }

    /// Does nothing for an attempt that has timed out.
    fn settle(&self, ticket: u64, result: ExportResult) {
        (self.take(|a| a.ticket == ticket)).for_each(|attempt| attempt.done(result));
    }

    pub(crate) fn retire_all(state: &VmState) {
        for exporter in state.js_exporters.borrow().iter() {
            exporter.shared.is_retired.store(true, Ordering::Relaxed);
        }
    }

    pub(crate) fn release_retired(state: &VmState) {
        state.js_exporters.borrow_mut().retain(|e| {
            !e.shared.is_retired.load(Ordering::Relaxed) || !e.shared.attempts.lock().is_empty()
        });
    }

    pub(crate) fn detach_all(state: &VmState) {
        for OwnedJsExporter { shared, .. } in state.js_exporters.take() {
            processor::global().remove_exporter(&(Arc::clone(&shared) as Arc<dyn Exporter>));
            shared.take(|_| true).for_each(ExportAttempt::abandoned);
        }
    }

    /// The promise that the attempt waits for. Only a termination fails.
    fn run(&self, state: &VmState, ticket: u64) -> JsResult<Option<JSValue>> {
        // It stays in the list: the function may call `process.exit()`.
        let payload = (self.attempts.lock().iter_mut())
            .find(|a| a.ticket == ticket && !a.has_started)
            .map(|a| {
                a.has_started = true;
                Arc::clone(a.attempt.payload())
            });
        let Some(payload) = payload else {
            return Ok(None);
        };
        match self.deliver(state, &payload)? {
            Delivery::Settled(result) => self.settle(ticket, result),
            Delivery::Pending(promise) => return Ok(Some(promise)),
        }
        Ok(None)
    }

    /// Only a termination fails.
    fn deliver(&self, state: &VmState, payload: &ExportPayload) -> JsResult<Delivery> {
        let global = state.global();
        let Some((function, this)) = (state.js_exporters.borrow().iter())
            .find(|e| core::ptr::eq(Arc::as_ptr(&e.shared), self))
            .map(|e| (e.function.get(), e.this.get()))
        else {
            return Ok(Delivery::Settled(ExportResult::Abandoned));
        };
        // An exporter that calls fetch() would trace its own export, batch after batch.
        let suppressed = Entered::new(global, Some(Context::create_suppressing(global)));
        let result = match self.format {
            JsFormat::Objects => crate::decode::decode_to_js(global, &payload.body),
            JsFormat::Protobuf => bun_jsc::JSUint8Array::from_bytes_copy(global, &payload.body),
            JsFormat::Json => bun_string_jsc::owned_utf8_into_js(
                global,
                bun_telemetry_cold::otlp_json::to_json(&payload.body),
            ),
        }
        .and_then(|batch| function.call(global, this, &[batch]))
        .and_then(|result| engine::adopt_thenable(global, result));
        drop(suppressed);
        let error = match result {
            Ok(result) if result.is_undefined() && function.call_may_have_been_dropped(global) => {
                return Ok(Delivery::Settled(ExportResult::Abandoned));
            }
            Ok(result) => match result.as_promise().map(JSPromise::opaque_mut) {
                Some(promise) if promise.status() == Status::Pending => {
                    return Ok(Delivery::Pending(result));
                }
                Some(promise) if promise.status() == Status::Rejected => {
                    promise.set_handled();
                    promise.result(global.vm())
                }
                _ => return Ok(Delivery::Settled(ExportResult::Success)),
            },
            Err(thrown) => {
                let error = global.take_error(thrown);
                if error.is_termination_exception() {
                    return Err(thrown);
                }
                error
            }
        };
        report_failure(global, error);
        Ok(Delivery::Settled(ExportResult::Failure))
    }
}

fn settle_export(ticket: f64, result: ExportResult) {
    if let Some(state) = VmState::current() {
        (JsExporter::all_of(state).iter()).for_each(|e| e.settle(ticket as u64, result));
    }
}

pub(crate) fn on_export_resolve(_: JsLocal<'_>, ticket: f64) {
    settle_export(ticket, ExportResult::Success);
}

pub(crate) fn on_export_reject<'a>(heap: &JsHeap<'a>, error: JsLocal<'a>, ticket: f64) {
    report_failure(global_of(heap), error.to_js());
    settle_export(ticket, ExportResult::Failure);
}

impl Exporter for JsExporter {
    /// In a task even on the owner's thread: the caller is in the middle of ending a span.
    fn export(self: Arc<Self>, attempt: ExportAttempt) {
        static NEXT_TICKET: AtomicU64 = AtomicU64::new(1);
        let ticket = NEXT_TICKET.fetch_add(1, Ordering::Relaxed);
        let timeout = processor::global().config().export_timeout_ms;
        self.attempts.lock().push(JsAttempt {
            ticket,
            deadline: MonoInstant::now() + Duration::from_millis(timeout.into()),
            has_started: false,
            attempt,
        });
        let vm = self.vm.clone();
        VmTask::Export(QueuedExport {
            exporter: self,
            ticket,
        })
        .post(&vm);
    }

    /// No microtask runs: the queue also holds the program's, which `process.exit()` has cut off.
    fn export_blocking(
        self: Arc<Self>,
        payload: &Arc<ExportPayload>,
        _: MonoInstant,
    ) -> ExportResult {
        match (self.owner_state()).map(|state| self.deliver(state, payload)) {
            Some(Ok(Delivery::Settled(result))) => result,
            Some(Ok(Delivery::Pending(_))) => {
                warn_of_pending_export();
                ExportResult::Failure
            }
            Some(Err(_)) | None => ExportResult::Abandoned,
        }
    }

    fn owner(&self) -> Option<OwnerKey> {
        Some(self.owner)
    }

    fn tick(&self, now: MonoInstant) {
        for overdue in self.take(|a| now >= a.deadline) {
            warn(format_args!(
                "an async exporter did not settle within the export timeout; counting the batch as failed"
            ));
            overdue.done(ExportResult::Failure);
        }
    }

    fn finish_for_exit(&self) {
        if let Some(state) = self.owner_state() {
            let tickets: Vec<_> = self.attempts.lock().iter().map(|a| a.ticket).collect();
            for ticket in tickets {
                match self.run(state, ticket) {
                    Ok(Some(_)) => warn_of_pending_export(),
                    Ok(None) => {}
                    Err(_terminated) => break,
                }
            }
        }
        self.take(|_| true).for_each(ExportAttempt::abandoned);
    }
}
