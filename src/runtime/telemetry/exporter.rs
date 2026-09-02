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
use bun_telemetry::MonoInstant;
use bun_telemetry::processor::{ExportAttempt, ExportPayload, ExportResult, Exporter, OwnerKey};
use bun_telemetry_cold::config::{Compression, ExporterConfig, OtlpExporterConfig};
use bun_telemetry_cold::decode::{self, AnyValue, KeyValue, Repeated, Scope, Span, TraceRequest};
use bun_threading::thread_pool;
use bun_url::URL;

// ─────────────────────────── OTLP/HTTP ───────────────────────────

pub struct OtlpHttpExporter {
    url: Box<[u8]>,
    headers: HeaderBuilder,
    compression: Compression,
    timeout_ms: u32,
    /// `timeout_ms` rounded up: the HTTP client's idle timeout is in seconds
    /// and must not undercut the configured budget.
    timeout_seconds: u32,
    warned: core::sync::atomic::AtomicBool,
    /// The idle timeout re-arms on every body read, so a collector trickling
    /// its response could otherwise hold the one export slot indefinitely.
    inflight: bun_threading::Guarded<Vec<InflightRequest>>,
    /// `HTTP(S)_PROXY` / `NO_PROXY` and `NODE_TLS_REJECT_UNAUTHORIZED` as they
    /// were when the exporter was configured, applied to every export the way
    /// fetch() applies them.
    proxy: Option<Box<bun_http::ProxySettings>>,
    reject_unauthorized: bool,
}

struct InflightRequest {
    async_http_id: u32,
    abort: Arc<bun_http::signals::Store>,
    deadline: MonoInstant,
}

const MAX_ATTEMPTS: u32 = 5;

enum SendError {
    Transport(bun_http::Error),
    /// (status, Retry-After seconds if the server sent one)
    Status(u32, Option<u32>),
    NoResponse,
}

impl SendError {
    fn retryable(&self) -> bool {
        match self {
            SendError::Transport(_) | SendError::NoResponse => true,
            SendError::Status(s, _) => matches!(s, 408 | 429 | 502 | 503 | 504),
        }
    }
}

impl fmt::Display for SendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SendError::Transport(e) => write!(f, "{e}"),
            SendError::Status(s, _) => write!(f, "HTTP {s}"),
            SendError::NoResponse => f.write_str("no response"),
        }
    }
}

fn check_response(res: &bun_picohttp::Response<'_>, body: &[u8]) -> Result<(), SendError> {
    if (200..300).contains(&res.status_code) {
        // OTLP partial success: the server took the request but rejected some
        // spans; it says how many and why (ExportTraceServiceResponse field 1).
        if !body.is_empty() {
            match bun_telemetry_cold::decode::partial_success(body) {
                Some((rejected, message)) if rejected > 0 => {
                    bun_core::warn!(
                        "[otel] collector rejected {} span(s): {}",
                        rejected,
                        bstr::BStr::new(&message)
                    );
                }
                // OTLP: a message with nothing rejected is a warning to pass on.
                Some((_, message)) if !message.is_empty() => {
                    bun_core::warn!("[otel] collector: {}", bstr::BStr::new(&message));
                }
                _ => {}
            }
        }
        Ok(())
    } else {
        // Retry-After (429/503): seconds form only; an HTTP-date is ignored.
        let retry_after = res
            .headers
            .get(b"retry-after")
            .and_then(|v| core::str::from_utf8(v).ok())
            .and_then(|v| v.trim().parse::<u32>().ok());
        Err(SendError::Status(res.status_code, retry_after))
    }
}

// SAFETY: VM-free: only owned byte buffers and an atomic; nothing here
// references a VirtualMachine or JS heap.
unsafe impl Send for OtlpHttpExporter {}
// SAFETY: see `Send` above.
unsafe impl Sync for OtlpHttpExporter {}

/// An endpoint for messages: userinfo redacted, query dropped (either may
/// carry the credential).
fn display_url(url: &[u8]) -> Vec<u8> {
    let scheme_end = bun_core::strings::index_of(url, b"://").map_or(0, |i| i + 3);
    let authority_end = bun_core::strings::index_of_any(&url[scheme_end..], b"/?#")
        .map_or(url.len(), |i| i + scheme_end);
    let path_end = bun_core::strings::index_of_any(&url[scheme_end..], b"?#")
        .map_or(url.len(), |i| i + scheme_end);
    let mut out = Vec::with_capacity(url.len());
    out.extend_from_slice(&url[..scheme_end]);
    match bun_core::strings::last_index_of_char(&url[scheme_end..authority_end], b'@') {
        Some(at) => {
            out.extend_from_slice(b"REDACTED:REDACTED");
            out.extend_from_slice(&url[scheme_end + at..path_end]);
        }
        None => out.extend_from_slice(&url[scheme_end..path_end]),
    }
    out
}

/// An OTLP exporter URL that is not `http(s)://host…`.
#[derive(Debug)]
pub struct InvalidEndpoint {
    /// As [`display_url`] renders it (userinfo redacted, query dropped).
    pub url: Vec<u8>,
}

impl fmt::Display for InvalidEndpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid OTLP endpoint URL {:?} (expected http:// or https://)",
            bstr::BStr::new(&self.url)
        )
    }
}

/// Construct the configured exporters (`console` included). OTLP exporters
/// take the proxy and TLS-verification environment from `global`'s VM.
#[optimize(size)]
pub fn build(
    global: &JSGlobalObject,
    cfgs: &[ExporterConfig],
) -> Result<Vec<Arc<dyn Exporter>>, InvalidEndpoint> {
    let vm = global.bun_vm();
    let proxy = bun_http::ProxySettings::from_env(vm.as_mut().transpiler.env_mut());
    let reject_unauthorized = vm.get_tls_reject_unauthorized();
    cfgs.iter()
        .map(|c| {
            Ok(match c {
                ExporterConfig::Otlp(c) => Arc::new(OtlpHttpExporter::new(
                    c,
                    proxy.clone(),
                    reject_unauthorized,
                )?) as Arc<dyn Exporter>,
                ExporterConfig::Console => Arc::new(ConsoleExporter),
            })
        })
        .collect()
}

impl OtlpHttpExporter {
    pub fn new(
        cfg: &OtlpExporterConfig,
        proxy: Option<Box<bun_http::ProxySettings>>,
        reject_unauthorized: bool,
    ) -> Result<OtlpHttpExporter, InvalidEndpoint> {
        let url = URL::parse(cfg.url.as_bytes());
        if url.hostname.is_empty() || !(url.is_http() || url.is_https()) {
            return Err(InvalidEndpoint {
                url: display_url(cfg.url.as_bytes()),
            });
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
        bun_core::handle_oom(headers.allocate());
        for (k, v) in all() {
            headers.append(k, v);
        }
        Ok(OtlpHttpExporter {
            url: cfg.url.as_bytes().into(),
            headers,
            compression: cfg.compression,
            timeout_ms: cfg.timeout_ms,
            timeout_seconds: cfg.timeout_ms.div_ceil(1000).max(1),
            warned: core::sync::atomic::AtomicBool::new(false),
            inflight: bun_threading::Guarded::new(Vec::new()),
            proxy,
            reject_unauthorized,
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
        let url = URL::parse(&self.url);
        // As fetch(): the request borrows the hop-0 proxy URL out of its own
        // boxed copy of the settings, which it then owns.
        let proxy_settings = self.proxy.clone();
        let http_proxy = proxy_settings.as_deref().and_then(|s| {
            let href: *const [u8] = s.resolve(&url)?;
            // SAFETY: `href` points into `proxy_settings`' heap box, moved into
            // the request below and kept for its lifetime.
            Some(URL::parse(unsafe { &*href }))
        });
        AsyncHTTP::init(
            Method::POST,
            url,
            bun_core::handle_oom(self.headers.entries.clone()),
            self.headers.content.written_slice(),
            body,
            callback,
            // A 3xx is a failed export (as in the SDK): following it would resend
            // the credentials in `headers` to whatever origin it names.
            FetchRedirect::Error,
            HttpOptions {
                http_proxy,
                proxy_settings,
                reject_unauthorized: Some(self.reject_unauthorized),
                ..self.options(timeout_seconds, signals)
            },
        )
    }

    /// Abort in-flight exports that have run past the export timeout; they
    /// then complete with an error and take the retry path.
    fn abort_overdue(&self, now: MonoInstant) {
        let overdue: Vec<InflightRequest> = self
            .inflight
            .lock()
            .extract_if(.., |r| now >= r.deadline)
            .collect();
        for r in overdue {
            // The abort tracker only knows requests whose `aborted` signal is
            // wired; set it, then have the HTTP thread act on it.
            r.abort
                .aborted
                .store(true, core::sync::atomic::Ordering::Relaxed);
            bun_http::http_thread().schedule_shutdown_by_id(r.async_http_id);
        }
    }

    fn finished(&self, async_http_id: u32) {
        self.inflight
            .lock()
            .retain(|r| r.async_http_id != async_http_id);
    }

    fn send_blocking(
        &self,
        payload: &ExportPayload,
        deadline: MonoInstant,
    ) -> Result<(), SendError> {
        // Bound the request by whichever is sooner: the exporter timeout or the deadline.
        let left_secs = u32::try_from(deadline.remaining().as_secs()).unwrap_or(u32::MAX);
        let timeout = self.timeout_seconds.min(left_secs.max(1));
        let mut req = self.request(
            &payload.body,
            HTTPClientResultCallback::new::<()>(core::ptr::null_mut(), |_, _, _| {}),
            timeout,
            None,
        );
        let mut response = MutableString::default();
        let meta = req.send_sync(&mut response).map_err(SendError::Transport)?;
        check_response(&meta.response, response.list.as_slice())
    }

    fn failed(self: Arc<Self>, attempt: ExportAttempt, err: &SendError) {
        if err.retryable() && attempt.attempt() + 1 < MAX_ATTEMPTS {
            let mut backoff = Duration::from_secs(1u64 << attempt.attempt().min(4));
            if let SendError::Status(_, Some(secs)) = err {
                backoff = Duration::from_secs(u64::from(*secs).clamp(1, 120));
            }
            attempt.retry_later(self, backoff);
        } else {
            self.warn_once(attempt.payload(), "", err);
            attempt.done(ExportResult::Failure);
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
                bstr::BStr::new(&display_url(&self.url)),
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
    attempt: ExportAttempt,
    /// Backs the request's `Signals.aborted` (export timeout).
    signals: Arc<bun_http::signals::Store>,
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
        mut result: HTTPClientResult<'_>,
    ) {
        if result.has_more {
            return;
        }
        // Take over the HTTP thread's bitwise copy of the client so its owned
        // buffers are dropped exactly once (see S3HttpSimpleTask::stage_http_result).
        // SAFETY: HTTP thread exclusively owns `this` during the callback.
        unsafe { core::ptr::write((*this).http.0.as_mut_ptr(), core::ptr::read(async_http)) };
        let mut body = Vec::new();
        result.body_into(&mut body);
        let outcome = match (result.fail, &result.metadata) {
            (Some(err), _) => Err(SendError::Transport(err)),
            (None, Some(meta)) => check_response(&meta.response, &body),
            (None, None) => Err(SendError::NoResponse),
        };
        // SAFETY: allocated in `export`; the HTTP thread is done with it.
        let InflightExport {
            http,
            exporter,
            attempt,
            signals,
        } = *unsafe { Box::from_raw(this) };
        // SAFETY: initialized in `export` before scheduling.
        exporter.finished(unsafe { http.0.assume_init_ref() }.async_http_id);
        drop(http);
        drop(signals);
        match outcome {
            Ok(()) => attempt.done(ExportResult::Success),
            Err(err) => exporter.failed(attempt, &err),
        }
    }

    /// HTTP thread parked at process exit; the request will never complete.
    unsafe fn release_at_shutdown(this: *mut ()) {
        // SAFETY: allocated in `export`; the HTTP thread hands ownership back exactly once.
        let InflightExport { attempt, .. } = *unsafe { Box::from_raw(this.cast::<Self>()) };
        attempt.done(ExportResult::Failure);
    }
}

impl Exporter for OtlpHttpExporter {
    fn export(self: Arc<Self>, attempt: ExportAttempt) {
        // SAFETY: the request borrows `self` and the payload body; `self` and
        // `attempt` (which owns the payload Arc) are moved into `task`, a heap
        // allocation freed only in `InflightExport::callback`/
        // `release_at_shutdown` after the HTTP thread's final use of the request.
        unsafe {
            let me: &'static OtlpHttpExporter = bun_ptr::detach_lifetime_ref(&*self);
            let body: &'static [u8] = bun_ptr::detach_lifetime(attempt.payload().body.as_slice());
            let signals: Arc<bun_http::signals::Store> = Arc::new(Default::default());
            let task = Box::into_raw(Box::new(InflightExport {
                http: RequestSlot(MaybeUninit::uninit()),
                exporter: self,
                attempt,
                signals: Arc::clone(&signals),
            }));
            let http = me.request(
                body,
                HTTPClientResultCallback::new_with_release::<InflightExport>(
                    task,
                    InflightExport::callback,
                    InflightExport::release_at_shutdown,
                ),
                me.timeout_seconds,
                // (`Store::to` wants `&mut`; the Arc is shared with `inflight`.)
                Some(bun_http::Signals {
                    aborted: Some(core::ptr::NonNull::from(&signals.aborted)),
                    ..Default::default()
                }),
            );
            let now = MonoInstant::now();
            me.abort_overdue(now);
            me.inflight.lock().push(InflightRequest {
                async_http_id: http.async_http_id,
                abort: signals,
                deadline: now + Duration::from_millis(u64::from(me.timeout_ms)),
            });
            (*task).http.0.write(http);
            bun_http::http_thread::init(&Default::default());
            let mut batch = thread_pool::Batch::default();
            (*task).http.0.assume_init_mut().schedule(&mut batch);
            bun_http::HTTPThread::schedule(batch);
        }
    }

    fn tick(&self, now: MonoInstant) {
        self.abort_overdue(now);
    }

    fn export_blocking(&self, payload: &ExportPayload, deadline: MonoInstant) -> ExportResult {
        if deadline.remaining().is_zero() {
            return ExportResult::Failure;
        }
        match self.send_blocking(payload, deadline) {
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
    fn export(self: Arc<Self>, attempt: ExportAttempt) {
        let result = self.export_blocking(attempt.payload(), MonoInstant::FAR_FUTURE);
        attempt.done(result);
    }

    fn export_blocking(&self, payload: &ExportPayload, _deadline: MonoInstant) -> ExportResult {
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
        AnyValue::Bytes(b) => bun_jsc::JSUint8Array::from_bytes_copy(global, b)?,
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
        obj.put(
            global,
            bun_core::EncodedSlice::utf8(kv.key),
            any_value_to_js(global, kv.value)?,
        );
    }
    Ok(obj)
}

/// The fixed property names of a decoded span, atomized once per
/// [`decode_to_js`] so each `put` is an atom ref, not a `StringImpl` copy.
struct Keys {
    trace_id: bun_core::String,
    span_id: bun_core::String,
    parent_span_id: bun_core::String,
    name: bun_core::String,
    kind: bun_core::String,
    start_time: bun_core::String,
    end_time: bun_core::String,
    attributes: bun_core::String,
    events: bun_core::String,
    links: bun_core::String,
    status: bun_core::String,
    trace_flags: bun_core::String,
    trace_state: bun_core::String,
    dropped_attributes_count: bun_core::String,
    dropped_events_count: bun_core::String,
    dropped_links_count: bun_core::String,
    scope: bun_core::String,
    resource: bun_core::String,
    time: bun_core::String,
    flags: bun_core::String,
    code: bun_core::String,
    message: bun_core::String,
    version: bun_core::String,
}

impl Keys {
    fn new() -> Self {
        let atom = bun_core::String::create_atom;
        Keys {
            trace_id: atom(b"traceId"),
            span_id: atom(b"spanId"),
            parent_span_id: atom(b"parentSpanId"),
            name: atom(b"name"),
            kind: atom(b"kind"),
            start_time: atom(b"startTime"),
            end_time: atom(b"endTime"),
            attributes: atom(b"attributes"),
            events: atom(b"events"),
            links: atom(b"links"),
            status: atom(b"status"),
            trace_flags: atom(b"traceFlags"),
            trace_state: atom(b"traceState"),
            dropped_attributes_count: atom(b"droppedAttributesCount"),
            dropped_events_count: atom(b"droppedEventsCount"),
            dropped_links_count: atom(b"droppedLinksCount"),
            scope: atom(b"scope"),
            resource: atom(b"resource"),
            time: atom(b"time"),
            flags: atom(b"flags"),
            code: atom(b"code"),
            message: atom(b"message"),
            version: atom(b"version"),
        }
    }
}

fn scope_to_js(global: &JSGlobalObject, k: &Keys, scope: Option<&Scope<'_>>) -> JsResult<JSValue> {
    let o = JSValue::create_empty_object(global, 2);
    let (name, version) = scope.map_or((&b""[..], &b""[..]), |s| (s.name, s.version));
    o.put(global, &k.name, str_js(global, name)?);
    if !version.is_empty() {
        o.put(global, &k.version, str_js(global, version)?);
    }
    Ok(o)
}

fn span_to_js(
    global: &JSGlobalObject,
    k: &Keys,
    span: &Span<'_>,
    scope: JSValue,
    resource: JSValue,
) -> JsResult<JSValue> {
    let o = JSValue::create_empty_object(global, 14);
    o.put(global, &k.trace_id, hex_js(global, span.trace_id)?);
    o.put(global, &k.span_id, hex_js(global, span.span_id)?);
    o.put(
        global,
        &k.parent_span_id,
        if span.parent_span_id.is_empty() {
            JSValue::UNDEFINED
        } else {
            hex_js(global, span.parent_span_id)?
        },
    );
    o.put(global, &k.name, str_js(global, span.name)?);
    let kind = bun_telemetry::SpanKind::from_otlp(u8::try_from(span.kind).unwrap_or(0));
    o.put(
        global,
        &k.kind,
        JSValue::js_number_from_int32(kind.to_api() as i32),
    );
    o.put(global, &k.start_time, ns_to_ms_js(span.start_time_ns));
    o.put(global, &k.end_time, ns_to_ms_js(span.end_time_ns));
    o.put(
        global,
        &k.attributes,
        attributes_to_js(global, span.attributes())?,
    );

    let events = JSValue::create_empty_array(global, 0)?;
    for ev in span.events() {
        let e = JSValue::create_empty_object(global, 3);
        e.put(global, &k.time, ns_to_ms_js(ev.time_ns));
        e.put(global, &k.name, str_js(global, ev.name)?);
        e.put(
            global,
            &k.attributes,
            attributes_to_js(global, ev.attributes())?,
        );
        events.push(global, e)?;
    }
    o.put(global, &k.events, events);

    let links = JSValue::create_empty_array(global, 0)?;
    for link in span.links() {
        let l = JSValue::create_empty_object(global, 5);
        l.put(global, &k.trace_id, hex_js(global, link.trace_id)?);
        l.put(global, &k.span_id, hex_js(global, link.span_id)?);
        l.put(global, &k.flags, JSValue::js_number(link.flags as f64));
        if !link.trace_state.is_empty() {
            l.put(global, &k.trace_state, str_js(global, link.trace_state)?);
        }
        l.put(
            global,
            &k.attributes,
            attributes_to_js(global, link.attributes())?,
        );
        links.push(global, l)?;
    }
    o.put(global, &k.links, links);

    let status = JSValue::create_empty_object(global, 2);
    status.put(
        global,
        &k.code,
        JSValue::js_number_from_int32(span.status.code as i32),
    );
    if !span.status.message.is_empty() {
        status.put(global, &k.message, str_js(global, span.status.message)?);
    }
    o.put(global, &k.status, status);
    o.put(
        global,
        &k.trace_flags,
        JSValue::js_number_from_int32((span.flags & 0xff) as i32),
    );
    if !span.trace_state.is_empty() {
        o.put(global, &k.trace_state, str_js(global, span.trace_state)?);
    }
    for (key, count) in [
        (&k.dropped_attributes_count, span.dropped_attributes_count),
        (&k.dropped_events_count, span.dropped_events_count),
        (&k.dropped_links_count, span.dropped_links_count),
    ] {
        if count != 0 {
            o.put(global, key, JSValue::js_number_from_int32(count as i32));
        }
    }
    o.put(global, &k.scope, scope);
    o.put(global, &k.resource, resource);
    Ok(o)
}

/// Decode an `ExportTraceServiceRequest` into an array of plain span objects:
/// `{ traceId, spanId, parentSpanId, name, kind, startTime, endTime (epoch ms),
///    attributes, events, links, status, traceFlags, scope, resource }`.
/// `kind` uses @opentelemetry/api numbering; `status.code` matches it already.
#[optimize(size)]
pub fn decode_to_js(global: &JSGlobalObject, request: &[u8]) -> JsResult<JSValue> {
    let k = Keys::new();
    let out = JSValue::create_empty_array(global, 0)?;
    for rs in TraceRequest::new(request).resource_spans() {
        let resource = match &rs.resource {
            Some(r) => {
                let o = JSValue::create_empty_object(global, 1);
                o.put(
                    global,
                    &k.attributes,
                    attributes_to_js(global, r.attributes())?,
                );
                o
            }
            None => JSValue::UNDEFINED,
        };
        for ss in rs.scope_spans() {
            let scope = scope_to_js(global, &k, ss.scope.as_ref())?;
            for span in ss.spans() {
                out.push(global, span_to_js(global, &k, &span, scope, resource)?)?;
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
            JsFormat::Protobuf => bun_jsc::JSUint8Array::from_bytes_copy(global, &payload.body),
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
    owner_key: OwnerKey,
    /// Payloads posted to the owner's event loop and not yet delivered. At
    /// VM exit those tasks can never run (the loop is gone), so they are
    /// settled as abandoned instead of letting shutdown wait for them.
    queued: bun_threading::Guarded<Vec<ExportAttempt>>,
    /// Payloads whose `export()` returned a still-pending promise (owner
    /// thread only); settled by `export_settled`, failed by `tick` past the
    /// export timeout, or abandoned at VM exit.
    awaiting: RefCell<Vec<AwaitingExport>>,
    next_ticket: core::cell::Cell<u64>,
    /// Identity for `exportSettled` (never an address: exporters come and go).
    pub(crate) id: u64,
}

struct AwaitingExport {
    ticket: u64,
    deadline: MonoInstant,
    attempt: ExportAttempt,
}

static NEXT_JS_EXPORTER_ID: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(1);

// SAFETY: `vm` is a `VmHandle` (holds the VM's Ticket while tasks are in
// flight); `callback` is only touched on the owner VM's thread (checked
// against `owner` before every use).
unsafe impl Send for JsExporter {}
// SAFETY: see `Send` above.
unsafe impl Sync for JsExporter {}

struct JsExportTask {
    exporter: Arc<JsExporter>,
    /// Identity for `take_queued`.
    payload: Arc<ExportPayload>,
}

/// A task released unrun (its VM tore down between `post` and the tick)
/// settles its payload as abandoned instead of leaving it in flight.
impl Drop for JsExportTask {
    fn drop(&mut self) {
        if let Some(attempt) = self.exporter.take_queued(&self.payload) {
            attempt.abandoned();
        }
    }
}

/// What running a JS exporter callback came to.
enum Delivery {
    Exported,
    /// The exporter's promise, still pending.
    Pending(JSValue),
    Failed,
}

impl JsExporter {
    pub fn new(
        global: &JSGlobalObject,
        function: JSValue,
        this: JSValue,
        format: JsFormat,
    ) -> Arc<JsExporter> {
        let state = super::vm_state_or_init(global);
        Arc::new(JsExporter {
            callback: RefCell::new(Some(JsCallback {
                function: Strong::create(function, global),
                this: Strong::create(this, global),
            })),
            format,
            vm: global.bun_vm().handle(),
            owner: core::ptr::from_ref(state),
            owner_key: state.owner_key(),
            queued: bun_threading::Guarded::new(Vec::new()),
            awaiting: RefCell::new(Vec::new()),
            next_ticket: core::cell::Cell::new(1),
            id: NEXT_JS_EXPORTER_ID.fetch_add(1, core::sync::atomic::Ordering::Relaxed),
        })
    }

    /// Settle every still-queued payload as abandoned.
    fn abandon_queued(&self) {
        let queued = core::mem::take(&mut *self.queued.lock());
        for attempt in queued {
            attempt.abandoned();
        }
        // (owner thread: settle_stranded_for_vm / detach_all_for_vm run there)
        let awaiting = core::mem::take(&mut *self.awaiting.borrow_mut());
        for w in awaiting {
            w.attempt.abandoned();
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
    /// the retry/backoff path like a failed OTLP request).
    fn deliver(&self, payload: &ExportPayload) -> Delivery {
        let Some(s) = super::current_vm_state().filter(|s| core::ptr::eq(*s, self.owner)) else {
            return Delivery::Failed;
        };
        let global = s.global();
        let (function, this) = match &*self.callback.borrow() {
            Some(cb) => (cb.function.get(), cb.this.get()),
            None => return Delivery::Failed,
        };
        // Under suppression: an exporter that fetch()es the collector must not
        // trace its own export (one span per batch, forever).
        let suppressed = s.enter_suppressed();
        let result = self
            .format
            .payload_to_js(global, payload)
            .and_then(|arg| function.call(global, this, &[arg]));
        drop(suppressed);
        // An object result goes through Promise.resolve(): a thenable that is
        // not a Promise (a query builder) is adopted so its `then` runs, as
        // wrap()/span() do; anything else resolves on the spot.
        let result = result.map(|v| {
            if v.as_any_promise().is_none() && v.is_object() {
                bun_jsc::JSPromise::resolved_promise_value(global, v)
            } else {
                v
            }
        });
        match result {
            Ok(v) => match v.as_any_promise() {
                Some(p) => match p.status() {
                    bun_jsc::js_promise::Status::Pending => Delivery::Pending(v),
                    bun_jsc::js_promise::Status::Fulfilled => Delivery::Exported,
                    bun_jsc::js_promise::Status::Rejected => {
                        p.set_handled(global.vm());
                        Self::report_failure(global, p.result(global.vm()));
                        Delivery::Failed
                    }
                },
                None => Delivery::Exported,
            },
            Err(e) => {
                let err = global.take_error(e);
                Self::report_failure(global, err);
                Delivery::Failed
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
        // SAFETY: allocated in `export`; `ManagedTask::run` hands ownership to
        // the callback (only `release` of an unrun task drops it itself).
        let task = unsafe { Box::from_raw(task) };
        // Already settled (abandoned at VM exit) if no longer queued.
        if let Some(attempt) = task.exporter.take_queued(&task.payload) {
            match task.exporter.deliver(attempt.payload()) {
                Delivery::Exported => attempt.done(ExportResult::Success),
                Delivery::Failed => attempt.done(ExportResult::Failure),
                Delivery::Pending(promise) => task.exporter.await_settlement(promise, attempt),
            }
        }
        Ok(())
    }

    /// Keep `attempt` in flight until the exporter's promise settles
    /// (`export_settled`), via internal/telemetry's `awaitExport`.
    fn await_settlement(self: &Arc<Self>, promise: JSValue, attempt: ExportAttempt) {
        let Some(s) = super::current_vm_state() else {
            attempt.done(ExportResult::Failure);
            return;
        };
        let global = s.global();
        let ticket = self.next_ticket.get();
        self.next_ticket.set(ticket + 1);
        let deadline = MonoInstant::now()
            + Duration::from_millis(u64::from(super::processor().config().export_timeout_ms));
        self.awaiting.borrow_mut().push(AwaitingExport {
            ticket,
            deadline,
            attempt,
        });
        // Both ids ride as f64 (counters, well inside 53 bits).
        if Bun__Telemetry__awaitExport(global, promise, self.id as f64, ticket as f64) {
            return;
        }
        // Could not attach (exception building the reaction): settle now.
        self.export_settled(ticket, false);
    }

    /// `awaitExport`'s continuation: the async exporter's promise settled.
    /// A ticket already failed by `tick` (timeout) is ignored.
    pub(crate) fn export_settled(&self, ticket: u64, ok: bool) {
        let attempt = {
            let mut a = self.awaiting.borrow_mut();
            match a.iter().position(|w| w.ticket == ticket) {
                Some(i) => a.swap_remove(i).attempt,
                None => return,
            }
        };
        attempt.done(if ok {
            ExportResult::Success
        } else {
            ExportResult::Failure
        });
    }

    /// Fail exports whose promise outlived the export timeout (owner thread),
    /// so one exporter that never settles cannot hold the pipeline.
    fn fail_overdue(&self, now: MonoInstant) {
        if !super::current_vm_state().is_some_and(|s| core::ptr::eq(s, self.owner)) {
            return;
        }
        let overdue: Vec<AwaitingExport> = self
            .awaiting
            .borrow_mut()
            .extract_if(.., |w| now >= w.deadline)
            .collect();
        for w in overdue {
            bun_core::warn!(
                "[otel] an async exporter did not settle within the export timeout; counting the batch as failed"
            );
            w.attempt.done(ExportResult::Failure);
        }
    }

    /// Claim `payload`'s queued attempt; `None` if it was already settled.
    fn take_queued(&self, payload: &Arc<ExportPayload>) -> Option<ExportAttempt> {
        let mut q = self.queued.lock();
        let i = q.iter().position(|a| Arc::ptr_eq(a.payload(), payload))?;
        Some(q.swap_remove(i))
    }
}

impl Exporter for JsExporter {
    fn export(self: Arc<Self>, attempt: ExportAttempt) {
        // Even on the owner thread, defer to a task so exporters never run
        // re-entrantly inside whatever ended the span.
        let vm = self.vm.clone();
        let payload = Arc::clone(attempt.payload());
        self.queued.lock().push(attempt);
        let task = Box::into_raw(Box::new(JsExportTask {
            exporter: self,
            payload,
        }));
        let ct = ConcurrentTask::create(ManagedTask::new_owned(task, JsExporter::run_task));
        if let bun_jsc::Posted::Refused(ct) = vm.post(bun_jsc::LoopKind::Regular, ct) {
            // SAFETY: VM gone; `ct` was refused unqueued. Releasing it drops
            // the task, which abandons the attempt (see Drop for JsExportTask).
            unsafe { ConcurrentTask::release_refused(ct) };
        }
    }

    fn export_blocking(&self, payload: &ExportPayload, deadline: MonoInstant) -> ExportResult {
        match self.deliver(payload) {
            Delivery::Exported => ExportResult::Success,
            Delivery::Failed => ExportResult::Failure,
            Delivery::Pending(promise) => {
                // Exit-time flush of an async exporter. Like Node after 'exit',
                // nothing asynchronous runs any more: microtasks are drained
                // (an `async export()` that only awaits already-settled work
                // completes), but sockets and timers are not serviced. An
                // exporter that needs I/O here should be flushed with
                // `await Bun.otel.shutdown()` before exiting.
                let _ = deadline;
                let Some(s) = super::current_vm_state() else {
                    return ExportResult::Failure;
                };
                let global = s.global();
                if !global.vm().execution_forbidden() {
                    global.vm().drain_microtasks();
                }
                match promise.as_any_promise().map(|p| p.status()) {
                    Some(bun_jsc::js_promise::Status::Fulfilled) => ExportResult::Success,
                    Some(bun_jsc::js_promise::Status::Rejected) => {
                        if let Some(p) = promise.as_any_promise() {
                            p.set_handled(global.vm());
                            Self::report_failure(global, p.result(global.vm()));
                        }
                        ExportResult::Failure
                    }
                    _ => {
                        bun_core::warn!(
                            "[otel] an async exporter was still pending at process exit; its batch was not exported (await Bun.otel.shutdown() before exiting)"
                        );
                        ExportResult::Failure
                    }
                }
            }
        }
    }

    fn owner(&self) -> Option<OwnerKey> {
        Some(self.owner_key)
    }

    fn tick(&self, now: MonoInstant) {
        self.fail_overdue(now);
    }
}
