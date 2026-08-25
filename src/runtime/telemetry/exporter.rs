//! Exporters: OTLP/HTTP (protobuf) via Bun's HTTP thread, `console`
//! (OTLP/JSON on stderr), and JS callbacks. Plus the protobuf → JS object
//! builder used by `Bun.otel.decode` and `{ export(spans) }` exporters.

use core::cell::RefCell;
use core::fmt;
use core::mem::MaybeUninit;
use std::sync::Arc;
use std::time::Duration;

use bun_core::MutableString;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::ManagedTask::ManagedTask;
use bun_http::async_http::Options as HttpOptions;
use bun_http::{
    AsyncHTTP, FetchRedirect, HTTPClientResult, HTTPClientResultCallback, HeaderBuilder, Method,
};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, Strong, VmHandle, bun_string_jsc};
use bun_telemetry::processor::{ExportPayload, ExportResult, Exporter, Processor};
use bun_telemetry_cold::config::{Compression, OtlpExporterConfig};
use bun_telemetry_cold::decode::{self, AnyValue, KeyValue, Repeated, Scope, Span, TraceRequest};
use bun_threading::thread_pool;
use bun_url::URL;

// ─────────────────────────── OTLP/HTTP ───────────────────────────

pub struct OtlpHttpExporter {
    url: Box<[u8]>,
    headers: HeaderBuilder,
    compression: Compression,
    timeout_seconds: u32,
    warned: core::sync::atomic::AtomicBool,
    /// In-flight requests (`async_http_id`) and when each must be done by:
    /// the idle timeout re-arms on every body read, so a collector trickling
    /// its response could otherwise hold the one export slot indefinitely.
    inflight: bun_threading::Guarded<Vec<(u32, u64)>>,
}

const MAX_ATTEMPTS: u32 = 5;

enum SendError {
    Transport(bun_http::Error),
    Status(u32),
    NoResponse,
}

impl SendError {
    fn retryable(&self) -> bool {
        match self {
            SendError::Transport(_) | SendError::NoResponse => true,
            SendError::Status(s) => matches!(s, 408 | 429 | 502 | 503 | 504),
        }
    }
}

impl fmt::Display for SendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SendError::Transport(e) => write!(f, "{e}"),
            SendError::Status(s) => write!(f, "HTTP {s}"),
            SendError::NoResponse => f.write_str("no response"),
        }
    }
}

fn check_status(status: u32) -> Result<(), SendError> {
    if (200..300).contains(&status) {
        Ok(())
    } else {
        Err(SendError::Status(status))
    }
}

// SAFETY: VM-free: only owned byte buffers and an atomic; nothing here
// references a VirtualMachine or JS heap.
unsafe impl Send for OtlpHttpExporter {}
// SAFETY: see `Send` above.
unsafe impl Sync for OtlpHttpExporter {}

impl OtlpHttpExporter {
    #[optimize(size)]
    pub fn from_configs(
        cfgs: &[OtlpExporterConfig],
    ) -> Result<Vec<Arc<OtlpHttpExporter>>, Vec<u8>> {
        cfgs.iter().map(|c| Self::new(c).map(Arc::new)).collect()
    }

    pub fn new(cfg: &OtlpExporterConfig) -> Result<OtlpHttpExporter, Vec<u8>> {
        let url = URL::parse(cfg.url.as_bytes());
        if url.hostname.is_empty() || !(url.is_http() || url.is_https()) {
            return Err(format!(
                "invalid OTLP endpoint URL {:?} (expected http:// or https://)",
                cfg.url
            )
            .into_bytes());
        }
        // The HTTP client adds Bun's User-Agent itself.
        let fixed: [(&[u8], &[u8]); 2] = [
            (b"content-type", b"application/x-protobuf"),
            (b"content-encoding", b"gzip"),
        ];
        let fixed = match cfg.compression {
            Compression::Gzip => &fixed[..],
            Compression::None => &fixed[..1],
        };
        let all = || {
            fixed.iter().copied().chain(
                cfg.headers
                    .iter()
                    .map(|(k, v)| (k.as_bytes(), v.as_bytes())),
            )
        };
        let mut headers = HeaderBuilder::default();
        for (k, v) in all() {
            headers.count(k, v);
        }
        headers.allocate().map_err(|_| b"out of memory".to_vec())?;
        for (k, v) in all() {
            headers.append(k, v);
        }
        Ok(OtlpHttpExporter {
            url: cfg.url.as_bytes().into(),
            headers,
            compression: cfg.compression,
            timeout_seconds: (cfg.timeout_ms / 1000).max(1),
            warned: core::sync::atomic::AtomicBool::new(false),
            inflight: bun_threading::Guarded::new(Vec::new()),
        })
    }

    fn options(
        &self,
        timeout_seconds: u32,
        signals: Option<bun_http::Signals>,
    ) -> HttpOptions<'static> {
        HttpOptions {
            idle_timeout_seconds: Some(timeout_seconds),
            signals,
            compress: match self.compression {
                Compression::Gzip => Some(bun_http::compress_body::CompressOption {
                    encoding: bun_http::compress_body::CompressEncoding::Gzip,
                    level: None,
                }),
                Compression::None => None,
            },
            disable_keepalive: Some(false),
            ..Default::default()
        }
    }

    /// `timeout_seconds`: per-request idle timeout (the configured
    /// `OTEL_EXPORTER_OTLP_TIMEOUT`, or what is left of an exit deadline).
    fn request<'a>(
        &'a self,
        body: &'a [u8],
        callback: HTTPClientResultCallback,
        timeout_seconds: u32,
        signals: Option<bun_http::Signals>,
    ) -> AsyncHTTP<'a> {
        AsyncHTTP::init(
            Method::POST,
            URL::parse(&self.url),
            bun_core::handle_oom(self.headers.entries.clone()),
            self.headers.content.written_slice(),
            body,
            callback,
            FetchRedirect::Follow,
            self.options(timeout_seconds, signals),
        )
    }

    /// Abort in-flight exports that have run past the export timeout; they
    /// then complete with an error and take the retry path.
    fn abort_overdue(&self, now_ns: u64) {
        let overdue: Vec<u32> = {
            let mut list = self.inflight.lock();
            let mut out = Vec::new();
            list.retain(|(id, deadline)| {
                if now_ns >= *deadline {
                    out.push(*id);
                    false
                } else {
                    true
                }
            });
            out
        };
        for id in overdue {
            bun_http::http_thread().schedule_shutdown_by_id(id);
        }
    }

    fn finished(&self, async_http_id: u32) {
        self.inflight.lock().retain(|(id, _)| *id != async_http_id);
    }

    fn send_blocking(&self, payload: &ExportPayload, deadline_ns: u64) -> Result<(), SendError> {
        // Bound the request by whichever is sooner: the exporter timeout or the deadline.
        let left =
            deadline_ns.saturating_sub(bun_telemetry::clock::now_unix_nanos()) / 1_000_000_000;
        let timeout = self.timeout_seconds.min((left as u32).max(1));
        let mut req = self.request(
            &payload.body,
            HTTPClientResultCallback::new::<()>(core::ptr::null_mut(), |_, _, _| {}),
            timeout,
            None,
        );
        let mut response = MutableString::default();
        let meta = req.send_sync(&mut response).map_err(SendError::Transport)?;
        check_status(meta.response.status_code)
    }

    fn failed(
        self: Arc<Self>,
        processor: &'static Processor,
        payload: Arc<ExportPayload>,
        attempt: u32,
        err: &SendError,
    ) {
        if err.retryable() && attempt + 1 < MAX_ATTEMPTS {
            let backoff = Duration::from_secs(1u64 << attempt.min(4));
            processor.retry_later(self, payload, attempt + 1, backoff);
        } else {
            self.warn_once(&payload, "", err);
            processor.export_done(&payload, ExportResult::Failure);
        }
    }

    fn warn_once(&self, payload: &ExportPayload, when: &str, err: &SendError) {
        if !self
            .warned
            .swap(true, core::sync::atomic::Ordering::Relaxed)
        {
            bun_core::warn!(
                "[otel] exporting {} span(s) to {}{} failed: {} (further export errors from this exporter are silenced; see Bun.otel.stats())",
                payload.span_count,
                bstr::BStr::new(&self.url),
                when,
                err
            );
            bun_core::Output::flush();
        }
    }
}

/// One request on the HTTP thread. Heap-allocated in `export`, freed in the
/// terminal callback (or `release_at_shutdown`).
struct InflightExport {
    http: RequestSlot,
    exporter: Arc<OtlpHttpExporter>,
    processor: &'static Processor,
    payload: Arc<ExportPayload>,
    attempt: u32,
}

/// The HTTP thread works on a bitwise copy of this client, so only its owned
/// buffers are released here rather than running the full `AsyncHTTP`
/// destructor (mirrors S3HttpSimpleTask).
struct RequestSlot(MaybeUninit<AsyncHTTP<'static>>);

impl Drop for RequestSlot {
    fn drop(&mut self) {
        // SAFETY: written in `export` before the task is reachable.
        let http = unsafe { self.0.assume_init_mut() };
        http.clear_data();
        http.request_headers = Default::default();
        http.client.header_entries = Default::default();
    }
}

impl InflightExport {
    #[allow(clippy::needless_pass_by_value)] // signature fixed by HTTPClientResultCallback
    fn callback(
        this: *mut Self,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult<'_>,
    ) {
        if result.has_more {
            return;
        }
        // Take over the HTTP thread's bitwise copy of the client so its owned
        // buffers are dropped exactly once (see S3HttpSimpleTask::stage_http_result).
        // SAFETY: HTTP thread exclusively owns `this` during the callback.
        unsafe { core::ptr::write((*this).http.0.as_mut_ptr(), core::ptr::read(async_http)) };
        let outcome = match (result.fail, &result.metadata) {
            (Some(err), _) => Err(SendError::Transport(err)),
            (None, Some(meta)) => check_status(meta.response.status_code),
            (None, None) => Err(SendError::NoResponse),
        };
        // SAFETY: allocated in `export`; the HTTP thread is done with it.
        let InflightExport {
            http,
            exporter,
            processor,
            payload,
            attempt,
        } = *unsafe { Box::from_raw(this) };
        // SAFETY: initialized in `export` before scheduling.
        exporter.finished(unsafe { http.0.assume_init_ref() }.async_http_id);
        drop(http);
        match outcome {
            Ok(()) => processor.export_done(&payload, ExportResult::Success),
            Err(err) => exporter.failed(processor, payload, attempt, &err),
        }
    }

    /// HTTP thread parked at process exit; the request will never complete.
    unsafe fn release_at_shutdown(this: *mut ()) {
        // SAFETY: allocated in `export`; the HTTP thread hands ownership back exactly once.
        let me = unsafe { Box::from_raw(this.cast::<Self>()) };
        me.processor.export_done(&me.payload, ExportResult::Failure);
    }
}

impl Exporter for OtlpHttpExporter {
    fn export(
        self: Arc<Self>,
        processor: &'static Processor,
        payload: Arc<ExportPayload>,
        attempt: u32,
    ) {
        // SAFETY: the request borrows `self` and `payload.body`; both Arcs are
        // moved into `task`, a heap allocation freed only in
        // `InflightExport::callback`/`release_at_shutdown` after the HTTP
        // thread's final use of the request.
        unsafe {
            let me: &'static OtlpHttpExporter = bun_ptr::detach_lifetime_ref(&*self);
            let body: &'static [u8] = bun_ptr::detach_lifetime(payload.body.as_slice());
            let task = Box::into_raw(Box::new(InflightExport {
                http: RequestSlot(MaybeUninit::uninit()),
                exporter: self,
                processor,
                payload,
                attempt,
            }));
            let http = me.request(
                body,
                HTTPClientResultCallback::new_with_release::<InflightExport>(
                    task,
                    InflightExport::callback,
                    InflightExport::release_at_shutdown,
                ),
                me.timeout_seconds,
                None,
            );
            let now = bun_telemetry::clock::now_unix_nanos();
            me.abort_overdue(now);
            me.inflight.lock().push((
                http.async_http_id,
                now + u64::from(me.timeout_seconds) * 1_000_000_000,
            ));
            (*task).http.0.write(http);
            bun_http::http_thread::init(&Default::default());
            let mut batch = thread_pool::Batch::default();
            (*task).http.0.assume_init_mut().schedule(&mut batch);
            bun_http::HTTPThread::schedule(batch);
        }
    }

    fn tick(&self, now_ns: u64) {
        self.abort_overdue(now_ns);
    }

    fn export_blocking(&self, payload: &ExportPayload, deadline_ns: u64) -> ExportResult {
        if bun_telemetry::clock::now_unix_nanos() >= deadline_ns {
            return ExportResult::Failure;
        }
        match self.send_blocking(payload, deadline_ns) {
            Ok(()) => ExportResult::Success,
            Err(err) => {
                self.warn_once(payload, " at exit", &err);
                ExportResult::Failure
            }
        }
    }
}

// ─────────────────────────── console ───────────────────────────

/// One OTLP/JSON `ExportTraceServiceRequest` per batch on stderr — the same
/// document a collector would receive, so it can be piped into tooling.
pub struct ConsoleExporter;

impl Exporter for ConsoleExporter {
    fn export(
        self: Arc<Self>,
        processor: &'static Processor,
        payload: Arc<ExportPayload>,
        _attempt: u32,
    ) {
        let result = self.export_blocking(&payload, u64::MAX);
        processor.export_done(&payload, result);
    }

    fn export_blocking(&self, payload: &ExportPayload, _deadline_ns: u64) -> ExportResult {
        let mut json = bun_telemetry_cold::otlp_json::to_json(&payload.body);
        json.push(b'\n');
        bun_core::Output::print_error(bstr::BStr::new(&json));
        bun_core::Output::flush();
        ExportResult::Success
    }
}

// ─────────────────────────── protobuf → JS objects ───────────────────────────

fn str_js(global: &JSGlobalObject, s: &[u8]) -> JsResult<JSValue> {
    bun_string_jsc::create_utf8_for_js(global, s)
}

fn hex_js(global: &JSGlobalObject, id: &[u8]) -> JsResult<JSValue> {
    let mut buf = [0u8; 64];
    str_js(global, decode::hex_id(id, &mut buf))
}

/// Epoch milliseconds, split to keep sub-microsecond precision in the f64.
fn ns_to_ms_js(ns: u64) -> JSValue {
    JSValue::js_number((ns / 1_000_000) as f64 + (ns % 1_000_000) as f64 / 1_000_000.0)
}

fn any_value_to_js(global: &JSGlobalObject, v: AnyValue<'_>) -> JsResult<JSValue> {
    Ok(match v {
        AnyValue::Empty => JSValue::UNDEFINED,
        AnyValue::String(s) => str_js(global, s)?,
        AnyValue::Bool(b) => JSValue::from(b),
        AnyValue::Int(i) => JSValue::js_number(i as f64),
        AnyValue::Double(d) => JSValue::js_number(d),
        AnyValue::Bytes(b) => bun_jsc::host_fn::from_js_host_call(global, || {
            bun_jsc::JSUint8Array::from_bytes_copy(global, b)
        })?,
        AnyValue::Array(items) => {
            let arr = JSValue::create_empty_array(global, 0)?;
            for item in items {
                arr.push(global, any_value_to_js(global, item)?)?;
            }
            arr
        }
        AnyValue::KvList(items) => attributes_to_js(global, items)?,
    })
}

fn attributes_to_js<'a>(
    global: &JSGlobalObject,
    attrs: Repeated<'a, KeyValue<'a>>,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 0);
    for kv in attrs {
        obj.put(global, kv.key, any_value_to_js(global, kv.value)?);
    }
    Ok(obj)
}

fn scope_to_js(global: &JSGlobalObject, scope: Option<&Scope<'_>>) -> JsResult<JSValue> {
    let o = JSValue::create_empty_object(global, 2);
    let (name, version) = scope.map_or((&b""[..], &b""[..]), |s| (s.name, s.version));
    o.put(global, b"name", str_js(global, name)?);
    if !version.is_empty() {
        o.put(global, b"version", str_js(global, version)?);
    }
    Ok(o)
}

fn span_to_js(
    global: &JSGlobalObject,
    span: &Span<'_>,
    scope: JSValue,
    resource: JSValue,
) -> JsResult<JSValue> {
    let o = JSValue::create_empty_object(global, 14);
    o.put(global, b"traceId", hex_js(global, span.trace_id)?);
    o.put(global, b"spanId", hex_js(global, span.span_id)?);
    o.put(
        global,
        b"parentSpanId",
        if span.parent_span_id.is_empty() {
            JSValue::UNDEFINED
        } else {
            hex_js(global, span.parent_span_id)?
        },
    );
    o.put(global, b"name", str_js(global, span.name)?);
    let kind = bun_telemetry::SpanKind::from_otlp(u8::try_from(span.kind).unwrap_or(0));
    o.put(
        global,
        b"kind",
        JSValue::js_number_from_int32(kind.to_api() as i32),
    );
    o.put(global, b"startTime", ns_to_ms_js(span.start_time_ns));
    o.put(global, b"endTime", ns_to_ms_js(span.end_time_ns));
    o.put(
        global,
        b"attributes",
        attributes_to_js(global, span.attributes())?,
    );

    let events = JSValue::create_empty_array(global, 0)?;
    for ev in span.events() {
        let e = JSValue::create_empty_object(global, 3);
        e.put(global, b"time", ns_to_ms_js(ev.time_ns));
        e.put(global, b"name", str_js(global, ev.name)?);
        e.put(
            global,
            b"attributes",
            attributes_to_js(global, ev.attributes())?,
        );
        events.push(global, e)?;
    }
    o.put(global, b"events", events);

    let links = JSValue::create_empty_array(global, 0)?;
    for link in span.links() {
        let l = JSValue::create_empty_object(global, 5);
        l.put(global, b"traceId", hex_js(global, link.trace_id)?);
        l.put(global, b"spanId", hex_js(global, link.span_id)?);
        l.put(global, b"flags", JSValue::js_number(link.flags as f64));
        if !link.trace_state.is_empty() {
            l.put(global, b"traceState", str_js(global, link.trace_state)?);
        }
        l.put(
            global,
            b"attributes",
            attributes_to_js(global, link.attributes())?,
        );
        links.push(global, l)?;
    }
    o.put(global, b"links", links);

    let status = JSValue::create_empty_object(global, 2);
    status.put(
        global,
        b"code",
        JSValue::js_number_from_int32(span.status.code as i32),
    );
    if !span.status.message.is_empty() {
        status.put(global, b"message", str_js(global, span.status.message)?);
    }
    o.put(global, b"status", status);
    o.put(
        global,
        b"traceFlags",
        JSValue::js_number_from_int32((span.flags & 0xff) as i32),
    );
    if !span.trace_state.is_empty() {
        o.put(global, b"traceState", str_js(global, span.trace_state)?);
    }
    for (key, count) in [
        (
            &b"droppedAttributesCount"[..],
            span.dropped_attributes_count,
        ),
        (b"droppedEventsCount", span.dropped_events_count),
        (b"droppedLinksCount", span.dropped_links_count),
    ] {
        if count != 0 {
            o.put(global, key, JSValue::js_number_from_int32(count as i32));
        }
    }
    o.put(global, b"scope", scope);
    o.put(global, b"resource", resource);
    Ok(o)
}

/// Decode an `ExportTraceServiceRequest` into an array of plain span objects:
/// `{ traceId, spanId, parentSpanId, name, kind, startTime, endTime (epoch ms),
///    attributes, events, links, status, traceFlags, scope, resource }`.
/// `kind` uses @opentelemetry/api numbering; `status.code` matches it already.
#[optimize(size)]
pub fn decode_to_js(global: &JSGlobalObject, request: &[u8]) -> JsResult<JSValue> {
    let out = JSValue::create_empty_array(global, 0)?;
    for rs in TraceRequest::new(request).resource_spans() {
        let resource = match &rs.resource {
            Some(r) => {
                let o = JSValue::create_empty_object(global, 1);
                o.put(
                    global,
                    b"attributes",
                    attributes_to_js(global, r.attributes())?,
                );
                o
            }
            None => JSValue::UNDEFINED,
        };
        for ss in rs.scope_spans() {
            let scope = scope_to_js(global, ss.scope.as_ref())?;
            for span in ss.spans() {
                out.push(global, span_to_js(global, &span, scope, resource)?)?;
            }
        }
    }
    Ok(out)
}

// ─────────────────────────── JS callback exporter ───────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum JsFormat {
    Objects,
    Protobuf,
    Json,
}

impl JsFormat {
    fn payload_to_js(self, global: &JSGlobalObject, payload: &ExportPayload) -> JsResult<JSValue> {
        match self {
            JsFormat::Objects => decode_to_js(global, &payload.body),
            JsFormat::Protobuf => bun_jsc::host_fn::from_js_host_call(global, || {
                bun_jsc::JSUint8Array::from_bytes_copy(global, &payload.body)
            }),
            JsFormat::Json => str_js(
                global,
                &bun_telemetry_cold::otlp_json::to_json(&payload.body),
            ),
        }
    }
}

/// The `export*` function and the options object it came from (`this`).
struct JsCallback {
    function: Strong,
    this: Strong,
}

unsafe extern "C" {
    /// internal/telemetry `awaitExport(promise, exporterId, payloadId)`; false if it threw.
    safe fn Bun__Telemetry__awaitExport(
        global: &JSGlobalObject,
        promise: JSValue,
        exporter_id: f64,
        payload_id: f64,
    ) -> bool;
}

pub struct JsExporter {
    /// Dropped (set to None) on the owning thread at VM exit / realm change.
    callback: RefCell<Option<JsCallback>>,
    format: JsFormat,
    vm: VmHandle,
    /// Identity of the owning `VmState`: `callback` is only touched while
    /// that is the current thread's state.
    owner: *const super::VmState,
    /// Payloads posted to the owner's event loop and not yet delivered. At
    /// VM exit those tasks can never run (the loop is gone), so they are
    /// settled as abandoned instead of letting shutdown wait for them.
    queued: bun_threading::Guarded<Vec<Arc<ExportPayload>>>,
    /// Payloads whose `export()` returned a still-pending promise (owner
    /// thread only); settled by `export_settled` or abandoned at VM exit.
    awaiting: RefCell<Vec<Arc<ExportPayload>>>,
}

// SAFETY: `vm` is a `VmHandle` (holds the VM's Ticket while tasks are in
// flight); `callback` is only touched on the owner VM's thread (checked
// against `owner` before every use).
unsafe impl Send for JsExporter {}
// SAFETY: see `Send` above.
unsafe impl Sync for JsExporter {}

struct JsExportTask {
    exporter: Arc<JsExporter>,
    processor: &'static Processor,
    payload: Arc<ExportPayload>,
}

impl JsExporter {
    pub fn new(
        global: &JSGlobalObject,
        function: JSValue,
        this: JSValue,
        format: JsFormat,
    ) -> Arc<JsExporter> {
        Arc::new(JsExporter {
            callback: RefCell::new(Some(JsCallback {
                function: Strong::create(function, global),
                this: Strong::create(this, global),
            })),
            format,
            vm: global.bun_vm().handle(),
            owner: core::ptr::from_ref(super::vm_state_or_init(global)),
            queued: bun_threading::Guarded::new(Vec::new()),
            awaiting: RefCell::new(Vec::new()),
        })
    }

    /// Settle every still-queued payload as abandoned.
    fn abandon_queued(&self) {
        let queued = core::mem::take(&mut *self.queued.lock());
        for p in queued {
            super::processor().export_abandoned(&p);
        }
        // (owner thread: settle_stranded_for_vm / detach_all_for_vm run there)
        for p in core::mem::take(&mut *self.awaiting.borrow_mut()) {
            super::processor().export_abandoned(&p);
        }
    }

    /// At VM exit: export tasks still queued on this loop will never run;
    /// settle them so shutdown does not wait for them.
    pub(crate) fn settle_stranded_for_vm(s: &super::VmState) {
        for e in s.js_exporters.borrow().iter() {
            e.abandon_queued();
        }
    }

    pub(crate) fn detach_all_for_vm(s: &super::VmState) {
        let list = core::mem::take(&mut *s.js_exporters.borrow_mut());
        for e in list {
            *e.callback.borrow_mut() = None;
            e.abandon_queued();
            let e: Arc<dyn Exporter> = e;
            super::processor().remove_exporter(&e);
        }
    }

    /// Run the callback if the current thread is the owner VM's. A throw is
    /// reported as a warning and counts as a failed export (the batch moves to
    /// the retry/backoff path like a failed OTLP request). `Ok(Some(promise))`
    /// when an async exporter returned a still-pending promise.
    fn deliver(&self, payload: &ExportPayload) -> Result<Option<JSValue>, ()> {
        let Some(s) = super::current_vm_state().filter(|s| core::ptr::eq(*s, self.owner)) else {
            return Err(());
        };
        let global = s.global();
        let (function, this) = match &*self.callback.borrow() {
            Some(cb) => (cb.function.get(), cb.this.get()),
            None => return Err(()),
        };
        let result = self
            .format
            .payload_to_js(global, payload)
            .and_then(|arg| function.call(global, this, &[arg]));
        match result {
            Ok(v) => match v.as_any_promise() {
                Some(p) => match p.status() {
                    bun_jsc::js_promise::Status::Pending => Ok(Some(v)),
                    bun_jsc::js_promise::Status::Fulfilled => Ok(None),
                    bun_jsc::js_promise::Status::Rejected => {
                        p.set_handled(global.vm());
                        Self::report_failure(global, p.result(global.vm()));
                        Err(())
                    }
                },
                None => Ok(None),
            },
            Err(e) => {
                let err = global.take_error(e);
                Self::report_failure(global, err);
                Err(())
            }
        }
    }

    /// An exporter callback's throw/rejection: a warning naming the error,
    /// not an uncaught exception (a flaky exporter must not take the app down).
    fn report_failure(global: &JSGlobalObject, error: JSValue) {
        if error.is_termination_exception() {
            return;
        }
        // JSC::Exception → the thrown value; then its `.message` if it is an Error.
        let value = error.to_error().unwrap_or(error);
        let msg = value
            .get(global, "message")
            .ok()
            .flatten()
            .filter(|m| m.is_string())
            .unwrap_or(value)
            .to_bun_string(global)
            .map(|s| s.to_owned_slice())
            .unwrap_or_default();
        let _ = global.clear_exception_except_termination();
        bun_core::warn!("[otel] exporter callback failed: {}", bstr::BStr::new(&msg));
    }

    fn run_task(task: *mut JsExportTask) -> JsResult<()> {
        // SAFETY: allocated in `export`; consumed here.
        let task = unsafe { Box::from_raw(task) };
        // Already settled (abandoned at VM exit) if no longer queued.
        if task.exporter.take_queued(&task.payload) {
            match task.exporter.deliver(&task.payload) {
                Ok(None) => task
                    .processor
                    .export_done(&task.payload, ExportResult::Success),
                Err(()) => task
                    .processor
                    .export_done(&task.payload, ExportResult::Failure),
                Ok(Some(promise)) => task
                    .exporter
                    .await_settlement(promise, Arc::clone(&task.payload)),
            }
        }
        Ok(())
    }

    /// Keep `payload` in flight until the exporter's promise settles
    /// (`export_settled`), via internal/telemetry's `awaitExport`.
    fn await_settlement(self: &Arc<Self>, promise: JSValue, payload: Arc<ExportPayload>) {
        let Some(s) = super::current_vm_state() else {
            return;
        };
        let global = s.global();
        let payload_id = Arc::as_ptr(&payload) as usize;
        let exporter_id = Arc::as_ptr(self) as usize;
        self.awaiting.borrow_mut().push(payload);
        // Both ids ride as f64 (pointers fit 53 bits on every supported target).
        if Bun__Telemetry__awaitExport(global, promise, exporter_id as f64, payload_id as f64) {
            return;
        }
        // Could not attach (exception building the reaction): settle now.
        self.export_settled(payload_id, false);
    }

    /// `awaitExport`'s continuation: the async exporter's promise settled.
    pub(crate) fn export_settled(&self, payload_id: usize, ok: bool) {
        let payload = {
            let mut a = self.awaiting.borrow_mut();
            match a.iter().position(|p| Arc::as_ptr(p) as usize == payload_id) {
                Some(i) => a.swap_remove(i),
                None => return,
            }
        };
        super::processor().export_done(
            &payload,
            if ok {
                ExportResult::Success
            } else {
                ExportResult::Failure
            },
        );
    }

    /// Claim `payload`'s queued entry; false if it was already settled.
    fn take_queued(&self, payload: &Arc<ExportPayload>) -> bool {
        let mut q = self.queued.lock();
        match q.iter().position(|p| Arc::ptr_eq(p, payload)) {
            Some(i) => {
                q.swap_remove(i);
                true
            }
            None => false,
        }
    }
}

impl Exporter for JsExporter {
    fn export(
        self: Arc<Self>,
        processor: &'static Processor,
        payload: Arc<ExportPayload>,
        _attempt: u32,
    ) {
        // Even on the owner thread, defer to a task so exporters never run
        // re-entrantly inside whatever ended the span.
        let vm = self.vm.clone();
        self.queued.lock().push(Arc::clone(&payload));
        let task = Box::into_raw(Box::new(JsExportTask {
            exporter: self,
            processor,
            payload,
        }));
        let ct = ConcurrentTask::create(ManagedTask::new(task, JsExporter::run_task));
        if let bun_jsc::Posted::Refused(ct) = vm.post(bun_jsc::LoopKind::Regular, ct) {
            // SAFETY: VM gone; `ct` was refused unqueued and `task` was never shared.
            let task = unsafe {
                ConcurrentTask::release_refused(ct);
                Box::from_raw(task)
            };
            // The owner VM is gone; like a task stranded at exit, not a failure.
            if task.exporter.take_queued(&task.payload) {
                processor.export_abandoned(&task.payload);
            }
        }
    }

    fn export_blocking(&self, payload: &ExportPayload, deadline_ns: u64) -> ExportResult {
        match self.deliver(payload) {
            Ok(None) => ExportResult::Success,
            Err(()) => ExportResult::Failure,
            Ok(Some(promise)) => {
                // Exit-time flush of an async exporter: drive the event loop
                // until its promise settles or the export timeout passes.
                let Some(s) = super::current_vm_state() else {
                    return ExportResult::Failure;
                };
                let global = s.global();
                let vm = global.bun_vm().as_mut();
                loop {
                    match promise.as_any_promise().map(|p| p.status()) {
                        Some(bun_jsc::js_promise::Status::Fulfilled) => {
                            return ExportResult::Success;
                        }
                        Some(bun_jsc::js_promise::Status::Rejected) => {
                            if let Some(p) = promise.as_any_promise() {
                                p.set_handled(global.vm());
                                Self::report_failure(global, p.result(global.vm()));
                            }
                            return ExportResult::Failure;
                        }
                        Some(bun_jsc::js_promise::Status::Pending) => {}
                        None => return ExportResult::Failure,
                    }
                    if bun_telemetry::clock::now_unix_nanos() >= deadline_ns {
                        bun_core::warn!(
                            "[otel] an async exporter did not settle before the export timeout at exit"
                        );
                        return ExportResult::Failure;
                    }
                    vm.tick();
                    if promise.as_any_promise().map(|p| p.status())
                        == Some(bun_jsc::js_promise::Status::Pending)
                    {
                        vm.auto_tick_active();
                    }
                }
            }
        }
    }

    fn owner(&self) -> Option<usize> {
        Some(self.owner as usize)
    }
}

/// Idle hook target: wake the VM that has `forceFlush()` waiters.
pub(crate) fn post_flush_wake(handle: &VmHandle) {
    post_to_vm(handle, |_| {
        super::resolve_flush_waiters();
        Ok(())
    });
}

/// Run `f` on `handle`'s event loop (dropped if that loop is gone).
pub(crate) fn post_to_vm(handle: &VmHandle, f: fn(*mut u8) -> JsResult<()>) {
    let managed = ManagedTask::new(core::ptr::NonNull::<u8>::dangling().as_ptr(), f);
    let ct = ConcurrentTask::create(managed);
    if let bun_jsc::Posted::Refused(ct) = handle.post(bun_jsc::LoopKind::Regular, ct) {
        // SAFETY: `ct` was refused unqueued; we still own it.
        unsafe { ConcurrentTask::release_refused(ct) };
    }
}
