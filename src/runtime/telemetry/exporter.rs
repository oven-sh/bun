//! Exporters: OTLP/HTTP (protobuf) via Bun's HTTP thread, `console`, and JS
//! callback exporters. Plus the protobuf → JS object decoder they share.

use bun_threading::Guarded;
use core::cell::RefCell;
use core::mem::MaybeUninit;
use std::sync::Arc;

use bun_core::MutableString;
use bun_event_loop::ManagedTask::ManagedTask;
use bun_http::async_http::Options as HttpOptions;
use bun_http::{
    AsyncHTTP, FetchRedirect, HTTPClientResult, HTTPClientResultCallback, HeaderBuilder, Method,
};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, Strong, VmHandle, bun_string_jsc};
use bun_telemetry::config::{Compression, OtlpExporterConfig};
use bun_telemetry::otlp::field as f;
use bun_telemetry::processor::{ExportPayload, ExportResult, Exporter, Processor};
use bun_telemetry::proto::Reader;
use bun_threading::thread_pool;
use bun_url::URL;

// ─────────────────────────── OTLP/HTTP ───────────────────────────

pub struct OtlpHttpExporter {
    url: Box<[u8]>,
    headers: HeaderBuilder,
    compression: Compression,
    timeout_seconds: u32,
    /// Payloads waiting for a retry, with the attempt count and the
    /// `clock::now_unix_nanos()` after which to try again.
    retry: Guarded<Vec<Retry>>,
    warned: core::sync::atomic::AtomicBool,
}

struct Retry {
    payload: Arc<ExportPayload>,
    attempt: u32,
    due_ns: u64,
    processor: &'static Processor,
}

const MAX_ATTEMPTS: u32 = 5;

// SAFETY: VM-free: only owned byte buffers and the mutex-guarded retry
// list; nothing here references a VirtualMachine or JS heap.
unsafe impl Send for OtlpHttpExporter {}
// SAFETY: see `Send` above; shared state is behind `Guarded`/atomics.
unsafe impl Sync for OtlpHttpExporter {}

impl OtlpHttpExporter {
    pub fn new(cfg: &OtlpExporterConfig) -> Result<OtlpHttpExporter, Vec<u8>> {
        let url = URL::parse(cfg.url.as_bytes());
        if url.hostname.is_empty() || !(url.is_http() || url.is_https()) {
            return Err(format!(
                "invalid OTLP endpoint URL {:?} (expected http:// or https://)",
                cfg.url
            )
            .into_bytes());
        }
        let mut headers = HeaderBuilder::default();
        let ct: &[u8] = b"application/x-protobuf";
        let gzip = cfg.compression == Compression::Gzip;
        headers.count(b"content-type", ct);
        headers.count(b"user-agent", USER_AGENT.as_bytes());
        if gzip {
            headers.count(b"content-encoding", b"gzip");
        }
        for (k, v) in &cfg.headers {
            headers.count(k.as_bytes(), v.as_bytes());
        }
        headers.allocate().map_err(|_| b"out of memory".to_vec())?;
        headers.append(b"content-type", ct);
        headers.append(b"user-agent", USER_AGENT.as_bytes());
        if gzip {
            headers.append(b"content-encoding", b"gzip");
        }
        for (k, v) in &cfg.headers {
            headers.append(k.as_bytes(), v.as_bytes());
        }
        Ok(OtlpHttpExporter {
            url: cfg.url.as_bytes().into(),
            headers,
            compression: cfg.compression,
            timeout_seconds: (cfg.timeout_ms / 1000).max(1),
            retry: Guarded::new(Vec::new()),
            warned: core::sync::atomic::AtomicBool::new(false),
        })
    }

    fn options(&self) -> HttpOptions<'static> {
        HttpOptions {
            idle_timeout_seconds: Some(self.timeout_seconds),
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

    fn send(
        self: &Arc<Self>,
        processor: &'static Processor,
        payload: Arc<ExportPayload>,
        attempt: u32,
    ) {
        let task = Box::into_raw(Box::new(InflightExport {
            http: MaybeUninit::uninit(),
            exporter: Arc::clone(self),
            processor,
            payload,
            attempt,
        }));
        // SAFETY: `task` is a fresh heap allocation that outlives the request:
        // it is freed only in `InflightExport::finish`, after the HTTP thread's
        // final callback. `url`/`headers`/`body` borrow from `self` (kept
        // alive by `task.exporter`) and `task.payload`.
        unsafe {
            let t = &*task;
            let url = URL::parse(bun_ptr::detach_lifetime(&*self.url));
            let headers_buf: &'static [u8] =
                bun_ptr::detach_lifetime(self.headers.content.written_slice());
            let body: &'static [u8] = bun_ptr::detach_lifetime(t.payload.body.as_slice());
            let http = AsyncHTTP::init(
                Method::POST,
                url,
                bun_core::handle_oom(self.headers.entries.clone()),
                headers_buf,
                body,
                HTTPClientResultCallback::new_with_release::<InflightExport>(
                    task,
                    InflightExport::callback,
                    InflightExport::release_at_shutdown,
                ),
                FetchRedirect::Follow,
                self.options(),
            );
            (*task).http.write(http);
            bun_http::http_thread::init(&Default::default());
            let mut batch = thread_pool::Batch::default();
            (*task).http.assume_init_mut().schedule(&mut batch);
            bun_http::HTTPThread::schedule(batch);
        }
    }

    fn send_blocking(&self, p: &Arc<ExportPayload>, deadline_ns: u64) -> ExportResult {
        if bun_telemetry::clock::now_unix_nanos() >= deadline_ns {
            return ExportResult::Failure;
        }
        let url = URL::parse(&self.url);
        let mut req = AsyncHTTP::init(
            Method::POST,
            url,
            bun_core::handle_oom(self.headers.entries.clone()),
            self.headers.content.written_slice(),
            &p.body,
            HTTPClientResultCallback::new::<()>(core::ptr::null_mut(), noop_result_callback),
            FetchRedirect::Follow,
            self.options(),
        );
        let mut response = MutableString::default();
        match req.send_sync(&mut response) {
            Ok(meta) if (200..300).contains(&meta.response.status_code) => ExportResult::Success,
            Ok(meta) => {
                self.warn_once(format_args!(
                    "exporting {} span(s) to {} at exit failed: HTTP {}",
                    p.span_count,
                    bstr::BStr::new(&self.url),
                    meta.response.status_code
                ));
                ExportResult::Failure
            }
            Err(e) => {
                self.warn_once(format_args!(
                    "exporting {} span(s) to {} at exit failed: {}",
                    p.span_count,
                    bstr::BStr::new(&self.url),
                    bstr::BStr::new(e.name())
                ));
                ExportResult::Failure
            }
        }
    }

    fn send_retries(&self, processor: &'static Processor, all: bool) {
        let due: Vec<Retry> = {
            let mut q = self.retry.lock();
            if q.is_empty() {
                return;
            }
            let now = bun_telemetry::clock::now_unix_nanos();
            let (due, later): (Vec<_>, Vec<_>) = q.drain(..).partition(|r| all || r.due_ns <= now);
            *q = later;
            due
        };
        let me = self.arc();
        for r in due {
            processor.unpark();
            me.send(processor, r.payload, r.attempt);
        }
    }

    fn warn_once(&self, args: core::fmt::Arguments<'_>) {
        if !self
            .warned
            .swap(true, core::sync::atomic::Ordering::Relaxed)
        {
            bun_core::warn!(
                "[otel] {} (further export errors from this exporter are silenced; see Bun.otel.stats())",
                args
            );
            bun_core::Output::flush();
        }
    }
}

fn noop_result_callback(_: *mut (), _: *mut AsyncHTTP<'static>, _: HTTPClientResult<'_>) {}

const USER_AGENT: &str = const_format::concatcp!(
    "Bun/",
    bun_core::Environment::VERSION_STRING,
    " OTLP-Exporter"
);

fn retryable_status(status: u32) -> bool {
    matches!(status, 408 | 429 | 502 | 503 | 504)
}

struct InflightExport {
    http: MaybeUninit<AsyncHTTP<'static>>,
    exporter: Arc<OtlpHttpExporter>,
    processor: &'static Processor,
    payload: Arc<ExportPayload>,
    attempt: u32,
}

impl Drop for InflightExport {
    fn drop(&mut self) {
        // Mirrors S3HttpSimpleTask: release the client's owned buffers without
        // running the full AsyncHTTP destructor (the HTTP thread's bitwise
        // copy shares them until the final callback).
        // SAFETY: `http` is initialised in `send` before the task is visible.
        let http = unsafe { self.http.assume_init_mut() };
        http.clear_data();
        http.request_headers = Default::default();
        http.client.header_entries = Default::default();
    }
}

impl InflightExport {
    /// HTTP-thread callback.
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
        unsafe { core::ptr::write((*this).http.as_mut_ptr(), core::ptr::read(async_http)) };
        let outcome = match (&result.fail, &result.metadata) {
            (Some(err), _) => Err((true, format!("{}", bstr::BStr::new(err.name())))),
            (None, Some(meta)) => {
                let status = meta.response.status_code;
                if (200..300).contains(&status) {
                    Ok(())
                } else {
                    Err((retryable_status(status), format!("HTTP {status}")))
                }
            }
            (None, None) => Err((true, "no response".to_string())),
        };
        // SAFETY: HTTP thread exclusively owns `this` during the callback.
        let me = unsafe { &*this };
        let exporter = Arc::clone(&me.exporter);
        let processor = me.processor;
        let payload = Arc::clone(&me.payload);
        let attempt = me.attempt;
        // SAFETY: allocated in `send`; the HTTP thread is done with it.
        drop(unsafe { Box::from_raw(this) });
        match outcome {
            Ok(()) => processor.export_done(&payload, ExportResult::Success),
            Err((retryable, msg)) if retryable && attempt + 1 < MAX_ATTEMPTS => {
                let backoff_ms = 1000u64 << attempt.min(4);
                let due_ns = bun_telemetry::clock::now_unix_nanos() + backoff_ms * 1_000_000;
                exporter.retry.lock().push(Retry {
                    payload,
                    attempt: attempt + 1,
                    due_ns,
                    processor,
                });
                processor.park();
                let _ = msg;
            }
            Err((_, msg)) => {
                exporter.warn_once(format_args!(
                    "exporting {} span(s) to {} failed: {msg}",
                    payload.span_count,
                    bstr::BStr::new(&exporter.url)
                ));
                processor.export_done(&payload, ExportResult::Failure);
            }
        }
    }

    /// HTTP thread parked at process exit; the request will never complete.
    unsafe fn release_at_shutdown(this: *mut ()) {
        let this = this.cast::<Self>();
        // SAFETY: allocated in `send`; the HTTP thread hands ownership back exactly once.
        let me = unsafe { Box::from_raw(this) };
        me.processor.export_done(&me.payload, ExportResult::Failure);
    }
}

impl Exporter for OtlpHttpExporter {
    fn export(&self, processor: &'static Processor, payload: Arc<ExportPayload>) {
        // `Arc<Self>` receiver isn't available through `dyn Exporter`; recover it.
        let me = self.arc();
        me.send(processor, payload, 0);
    }

    fn tick(&self, processor: &'static Processor) {
        self.send_retries(processor, false);
    }

    fn retry_now(&self, processor: &'static Processor) {
        self.send_retries(processor, true);
    }

    fn export_blocking(&self, payload: Arc<ExportPayload>, deadline_ns: u64) -> ExportResult {
        // Retries still queued get this one last synchronous attempt too.
        self.flush_parked_blocking(deadline_ns);
        self.send_blocking(&payload, deadline_ns)
    }

    fn flush_parked_blocking(&self, deadline_ns: u64) {
        let parked: Vec<Retry> = self.retry.lock().drain(..).collect();
        for r in parked {
            let result = self.send_blocking(&r.payload, deadline_ns);
            r.processor.record_result(&r.payload, result);
        }
    }

    fn pending_retries(&self) -> usize {
        self.retry.lock().len()
    }

    fn name(&self) -> &str {
        "otlp-http"
    }
}

// `dyn Exporter` → `Arc<Self>`: exporters are only ever constructed inside an
// `Arc` (see `configure`), so keep a weak self-reference set at registration.
impl OtlpHttpExporter {
    fn arc(&self) -> Arc<Self> {
        // SAFETY: every OtlpHttpExporter lives in an Arc created by
        // `telemetry::configure`; incrementing the strong count from `&self`
        // is the documented `Arc::increment_strong_count` pattern.
        unsafe {
            let ptr = core::ptr::from_ref(self);
            Arc::increment_strong_count(ptr);
            Arc::from_raw(ptr)
        }
    }
}

// ─────────────────────────── console ───────────────────────────

pub struct ConsoleExporter;

impl Exporter for ConsoleExporter {
    fn export(&self, processor: &'static Processor, payload: Arc<ExportPayload>) {
        self.print(&payload);
        processor.export_done(&payload, ExportResult::Success);
    }
    fn export_blocking(&self, payload: Arc<ExportPayload>, _deadline_ns: u64) -> ExportResult {
        self.print(&payload);
        ExportResult::Success
    }
    fn name(&self) -> &str {
        "console"
    }
}

impl ConsoleExporter {
    /// One OTLP/JSON `ExportTraceServiceRequest` per batch on stderr — the same
    /// document a collector would receive, so it can be piped into tooling.
    fn print(&self, payload: &ExportPayload) {
        let mut json = bun_telemetry::otlp_json::to_json(&payload.body);
        json.push(b'\n');
        bun_core::Output::print_error(bstr::BStr::new(&json));
        bun_core::Output::flush();
    }
}

// ─────────────────────────── decoding ───────────────────────────

pub struct DecodedScope<'a> {
    pub name: &'a [u8],
    pub version: &'a [u8],
}

#[derive(Default)]
pub struct DecodedSpan<'a> {
    pub trace_id: &'a [u8],
    pub span_id: &'a [u8],
    pub parent_span_id: &'a [u8],
    pub trace_state: &'a [u8],
    pub name: &'a [u8],
    pub kind: u32,
    pub start_ns: u64,
    pub end_ns: u64,
    /// (key, encoded AnyValue body)
    pub attributes: Vec<(&'a [u8], &'a [u8])>,
    /// encoded Event bodies
    pub events: Vec<&'a [u8]>,
    /// encoded Link bodies
    pub links: Vec<&'a [u8]>,
    pub status_code: u32,
    pub status_message: &'a [u8],
    pub flags: u32,
    pub dropped_attributes: u32,
    pub dropped_events: u32,
    pub dropped_links: u32,
}

fn hex(bytes: &[u8], out: &mut [u8]) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for (i, b) in bytes.iter().enumerate().take(out.len() / 2) {
        out[i * 2] = HEX[(b >> 4) as usize];
        out[i * 2 + 1] = HEX[(b & 0xf) as usize];
    }
}

fn parse_kv(body: &[u8]) -> (&[u8], &[u8]) {
    let mut key: &[u8] = b"";
    let mut value: &[u8] = b"";
    let mut r = Reader::new(body);
    while let Ok(Some((field, v))) = r.next() {
        match field {
            f::KV_KEY => key = v.as_bytes(),
            f::KV_VALUE => value = v.as_bytes(),
            _ => {}
        }
    }
    (key, value)
}

fn parse_span(body: &[u8]) -> DecodedSpan<'_> {
    let mut s = DecodedSpan::default();
    let mut r = Reader::new(body);
    while let Ok(Some((field, v))) = r.next() {
        match field {
            f::TRACE_ID => s.trace_id = v.as_bytes(),
            f::SPAN_ID => s.span_id = v.as_bytes(),
            f::TRACE_STATE => s.trace_state = v.as_bytes(),
            f::PARENT_SPAN_ID => s.parent_span_id = v.as_bytes(),
            f::NAME => s.name = v.as_bytes(),
            f::KIND => s.kind = v.as_u64() as u32,
            f::START_TIME => s.start_ns = v.as_u64(),
            f::END_TIME => s.end_ns = v.as_u64(),
            f::ATTRIBUTES => s.attributes.push(parse_kv(v.as_bytes())),
            f::EVENTS => s.events.push(v.as_bytes()),
            f::LINKS => s.links.push(v.as_bytes()),
            f::STATUS => {
                let mut sr = Reader::new(v.as_bytes());
                while let Ok(Some((sf, sv))) = sr.next() {
                    match sf {
                        f::STATUS_CODE => s.status_code = sv.as_u64() as u32,
                        f::STATUS_MESSAGE => s.status_message = sv.as_bytes(),
                        _ => {}
                    }
                }
            }
            f::FLAGS => s.flags = v.as_u64() as u32,
            f::DROPPED_ATTRIBUTES => s.dropped_attributes = v.as_u64() as u32,
            f::DROPPED_EVENTS => s.dropped_events = v.as_u64() as u32,
            f::DROPPED_LINKS => s.dropped_links = v.as_u64() as u32,
            _ => {}
        }
    }
    s
}

/// Walk every span in an encoded `ExportTraceServiceRequest`.
#[inline(never)]
pub fn for_each_span<'a>(
    request: &'a [u8],
    each: &mut dyn FnMut(&DecodedScope<'a>, &DecodedSpan<'a>),
) {
    let mut r = Reader::new(request);
    while let Ok(Some((field, rs))) = r.next() {
        if field != f::RESOURCE_SPANS {
            continue;
        }
        let mut rr = Reader::new(rs.as_bytes());
        while let Ok(Some((field, ss))) = rr.next() {
            if field != f::RS_SCOPE_SPANS {
                continue;
            }
            let mut scope = DecodedScope {
                name: b"",
                version: b"",
            };
            let mut sr = Reader::new(ss.as_bytes());
            // Scope precedes spans in our encoding; tolerate either order by two passes.
            while let Ok(Some((field, v))) = sr.next() {
                if field == f::SS_SCOPE {
                    let mut ir = Reader::new(v.as_bytes());
                    while let Ok(Some((f2, v2))) = ir.next() {
                        match f2 {
                            f::SCOPE_NAME => scope.name = v2.as_bytes(),
                            f::SCOPE_VERSION => scope.version = v2.as_bytes(),
                            _ => {}
                        }
                    }
                }
            }
            let mut sr = Reader::new(ss.as_bytes());
            while let Ok(Some((field, v))) = sr.next() {
                if field == f::SS_SPANS {
                    let span = parse_span(v.as_bytes());
                    each(&scope, &span);
                }
            }
        }
    }
}

fn any_value_to_js(global: &JSGlobalObject, body: &[u8]) -> JsResult<JSValue> {
    let mut r = Reader::new(body);
    let mut result = JSValue::UNDEFINED;
    while let Ok(Some((field, v))) = r.next() {
        result = match field {
            f::AV_STRING => bun_string_jsc::create_utf8_for_js(global, v.as_bytes())?,
            f::AV_BOOL => JSValue::from(v.as_u64() != 0),
            f::AV_INT => {
                let i = v.as_u64() as i64;
                JSValue::js_number(i as f64)
            }
            f::AV_DOUBLE => JSValue::js_number(v.as_f64()),
            f::AV_BYTES => bun_jsc::JSUint8Array::from_bytes_copy(global, v.as_bytes()),
            f::AV_ARRAY => {
                let arr = JSValue::create_empty_array(global, 0)?;
                let mut ar = Reader::new(v.as_bytes());
                while let Ok(Some((af, item))) = ar.next() {
                    if af == f::ARR_VALUES {
                        arr.push(global, any_value_to_js(global, item.as_bytes())?)?;
                    }
                }
                arr
            }
            f::AV_KVLIST => {
                let obj = JSValue::create_empty_object(global, 0);
                let mut kr = Reader::new(v.as_bytes());
                while let Ok(Some((kf, item))) = kr.next() {
                    if kf == 1 {
                        let (k, val) = parse_kv(item.as_bytes());
                        obj.put(global, k, any_value_to_js(global, val)?);
                    }
                }
                obj
            }
            _ => continue,
        };
    }
    Ok(result)
}

fn attributes_to_js(global: &JSGlobalObject, attrs: &[(&[u8], &[u8])]) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, attrs.len());
    for (k, v) in attrs {
        obj.put(global, *k, any_value_to_js(global, v)?);
    }
    Ok(obj)
}

fn attributes_field_to_js(
    global: &JSGlobalObject,
    body: &[u8],
    attr_field: u32,
) -> JsResult<JSValue> {
    let mut attrs = Vec::new();
    let mut r = Reader::new(body);
    while let Ok(Some((field, v))) = r.next() {
        if field == attr_field {
            attrs.push(parse_kv(v.as_bytes()));
        }
    }
    attributes_to_js(global, &attrs)
}

fn hex_js(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
    let mut buf = [0u8; 64];
    let n = bytes.len().min(32);
    hex(&bytes[..n], &mut buf[..n * 2]);
    bun_string_jsc::create_utf8_for_js(global, &buf[..n * 2])
}

#[inline]
fn ns_to_ms(ns: u64) -> f64 {
    // Split to keep sub-microsecond precision in the f64.
    (ns / 1_000_000) as f64 + (ns % 1_000_000) as f64 / 1_000_000.0
}

/// Decode an `ExportTraceServiceRequest` into an array of plain span objects:
/// `{ traceId, spanId, parentSpanId, name, kind, startTime, endTime (epoch ms),
///    attributes, events, links, status, traceFlags, scope, resource }`.
/// `kind` and `status.code` use @opentelemetry/api numbering.
pub fn decode_to_js(global: &JSGlobalObject, request: &[u8]) -> JsResult<JSValue> {
    let out = JSValue::create_empty_array(global, 0)?;
    // Resource (one per request in our encoding).
    let mut resource = JSValue::UNDEFINED;
    {
        let mut r = Reader::new(request);
        while let Ok(Some((field, rs))) = r.next() {
            if field != f::RESOURCE_SPANS {
                continue;
            }
            let mut rr = Reader::new(rs.as_bytes());
            while let Ok(Some((field, v))) = rr.next() {
                if field == f::RS_RESOURCE {
                    let o = JSValue::create_empty_object(global, 1);
                    o.put(
                        global,
                        b"attributes",
                        attributes_field_to_js(global, v.as_bytes(), f::RES_ATTRIBUTES)?,
                    );
                    resource = o;
                }
            }
        }
    }
    let mut err: Option<bun_jsc::JsError> = None;
    let mut last_scope: (usize, JSValue) = (usize::MAX, JSValue::UNDEFINED);
    for_each_span(request, &mut |scope, span| {
        if err.is_some() {
            return;
        }
        let r = (|| -> JsResult<()> {
            let scope_key = scope.name.as_ptr() as usize;
            if last_scope.0 != scope_key {
                let so = JSValue::create_empty_object(global, 2);
                so.put(
                    global,
                    b"name",
                    bun_string_jsc::create_utf8_for_js(global, scope.name)?,
                );
                if !scope.version.is_empty() {
                    so.put(
                        global,
                        b"version",
                        bun_string_jsc::create_utf8_for_js(global, scope.version)?,
                    );
                }
                last_scope = (scope_key, so);
            }
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
            o.put(
                global,
                b"name",
                bun_string_jsc::create_utf8_for_js(global, span.name)?,
            );
            // OTLP kind (1..5) → API kind (0..4)
            o.put(
                global,
                b"kind",
                JSValue::js_number_from_int32(span.kind.saturating_sub(1) as i32),
            );
            o.put(
                global,
                b"startTime",
                JSValue::js_number(ns_to_ms(span.start_ns)),
            );
            o.put(
                global,
                b"endTime",
                JSValue::js_number(ns_to_ms(span.end_ns)),
            );
            o.put(
                global,
                b"attributes",
                attributes_to_js(global, &span.attributes)?,
            );
            let events = JSValue::create_empty_array(global, 0)?;
            for ev in &span.events {
                let e = JSValue::create_empty_object(global, 3);
                let mut er = Reader::new(ev);
                let mut attrs = Vec::new();
                while let Ok(Some((field, v))) = er.next() {
                    match field {
                        f::EV_TIME => {
                            e.put(global, b"time", JSValue::js_number(ns_to_ms(v.as_u64())))
                        }
                        f::EV_NAME => e.put(
                            global,
                            b"name",
                            bun_string_jsc::create_utf8_for_js(global, v.as_bytes())?,
                        ),
                        f::EV_ATTRIBUTES => attrs.push(parse_kv(v.as_bytes())),
                        _ => {}
                    }
                }
                e.put(global, b"attributes", attributes_to_js(global, &attrs)?);
                events.push(global, e)?;
            }
            o.put(global, b"events", events);
            let links = JSValue::create_empty_array(global, 0)?;
            for l in &span.links {
                let lo = JSValue::create_empty_object(global, 3);
                let mut lr = Reader::new(l);
                let mut attrs = Vec::new();
                while let Ok(Some((field, v))) = lr.next() {
                    match field {
                        f::LINK_TRACE_ID => {
                            lo.put(global, b"traceId", hex_js(global, v.as_bytes())?)
                        }
                        f::LINK_SPAN_ID => lo.put(global, b"spanId", hex_js(global, v.as_bytes())?),
                        f::LINK_TRACE_STATE => lo.put(
                            global,
                            b"traceState",
                            bun_string_jsc::create_utf8_for_js(global, v.as_bytes())?,
                        ),
                        f::LINK_ATTRIBUTES => attrs.push(parse_kv(v.as_bytes())),
                        _ => {}
                    }
                }
                lo.put(global, b"attributes", attributes_to_js(global, &attrs)?);
                links.push(global, lo)?;
            }
            o.put(global, b"links", links);
            let st = JSValue::create_empty_object(global, 2);
            st.put(
                global,
                b"code",
                JSValue::js_number_from_int32(span.status_code as i32),
            );
            if !span.status_message.is_empty() {
                st.put(
                    global,
                    b"message",
                    bun_string_jsc::create_utf8_for_js(global, span.status_message)?,
                );
            }
            o.put(global, b"status", st);
            o.put(
                global,
                b"traceFlags",
                JSValue::js_number_from_int32((span.flags & 0xff) as i32),
            );
            if !span.trace_state.is_empty() {
                o.put(
                    global,
                    b"traceState",
                    bun_string_jsc::create_utf8_for_js(global, span.trace_state)?,
                );
            }
            if span.dropped_attributes != 0 {
                o.put(
                    global,
                    b"droppedAttributesCount",
                    JSValue::js_number_from_int32(span.dropped_attributes as i32),
                );
            }
            if span.dropped_events != 0 {
                o.put(
                    global,
                    b"droppedEventsCount",
                    JSValue::js_number_from_int32(span.dropped_events as i32),
                );
            }
            if span.dropped_links != 0 {
                o.put(
                    global,
                    b"droppedLinksCount",
                    JSValue::js_number_from_int32(span.dropped_links as i32),
                );
            }
            o.put(global, b"scope", last_scope.1);
            o.put(global, b"resource", resource);
            out.push(global, o)?;
            Ok(())
        })();
        if let Err(e) = r {
            err = Some(e);
        }
    });
    match err {
        Some(e) => Err(e),
        None => Ok(out),
    }
}

// ─────────────────────────── JS callback exporter ───────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum JsFormat {
    Objects,
    Protobuf,
    Json,
}

pub struct JsExporter {
    /// The `export` function and the options object it came from (`this`).
    /// Dropped (set to None) on the owning thread at VM exit.
    callback: RefCell<Option<(Strong, Strong)>>,
    format: JsFormat,
    vm: VmHandle,
    /// Identity of the owning `VmState`, for `detach_all_for_vm`.
    owner: *const super::VmState,
    thread: std::thread::ThreadId,
}

// SAFETY: `vm` is a `VmHandle` (holds the VM's Ticket while tasks are in
// flight); `callback` is only touched on `thread` (checked).
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
        f: JSValue,
        this: JSValue,
        format: JsFormat,
    ) -> Arc<JsExporter> {
        let owner = core::ptr::from_ref(super::vm_state_or_init(global));
        Arc::new(JsExporter {
            callback: RefCell::new(Some((
                Strong::create(f, global),
                Strong::create(this, global),
            ))),
            format,
            vm: global.bun_vm().handle(),
            owner,
            thread: std::thread::current().id(),
        })
    }

    pub(crate) fn detach_all_for_vm(s: &super::VmState) {
        let list = core::mem::take(&mut *s.js_exporters.borrow_mut());
        for e in list {
            *e.callback.borrow_mut() = None;
        }
    }

    fn call(&self, global: &JSGlobalObject, payload: &ExportPayload) -> ExportResult {
        let cb = self.callback.borrow();
        let Some((f, this)) = cb.as_ref() else {
            return ExportResult::Failure;
        };
        let (f, this) = (f.get(), this.get());
        drop(cb);
        let arg = match self.format {
            JsFormat::Objects => match decode_to_js(global, &payload.body) {
                Ok(v) => v,
                Err(_) => {
                    global.clear_exception();
                    return ExportResult::Failure;
                }
            },
            JsFormat::Protobuf => {
                match bun_jsc::host_fn::from_js_host_call(global, || {
                    bun_jsc::JSUint8Array::from_bytes_copy(global, &payload.body)
                }) {
                    Ok(v) => v,
                    Err(e) => {
                        let ex = global.take_exception(e);
                        global.bun_vm().as_mut().run_error_handler(ex, None);
                        return ExportResult::Failure;
                    }
                }
            }
            JsFormat::Json => {
                let json = bun_telemetry::otlp_json::to_json(&payload.body);
                match bun_string_jsc::create_utf8_for_js(global, &json) {
                    Ok(v) => v,
                    Err(e) => {
                        let ex = global.take_exception(e);
                        global.bun_vm().as_mut().run_error_handler(ex, None);
                        return ExportResult::Failure;
                    }
                }
            }
        };
        match f.call(global, this, &[arg]) {
            Ok(_) => ExportResult::Success,
            Err(_) => {
                let ex = global.take_exception(bun_jsc::JsError::Thrown);
                global.bun_vm().as_mut().run_error_handler(ex, None);
                ExportResult::Failure
            }
        }
    }
}

fn run_js_export_task(task: *mut JsExportTask) -> JsResult<()> {
    // SAFETY: allocated in `export`; consumed here.
    let task = unsafe { Box::from_raw(task) };
    let result = match super::vm_state() {
        Some(s) if core::ptr::eq(s, task.exporter.owner) => {
            task.exporter.call(s_global(s), &task.payload)
        }
        _ => ExportResult::Failure,
    };
    task.processor.export_done(&task.payload, result);
    Ok(())
}

fn s_global(s: &super::VmState) -> &JSGlobalObject {
    // SAFETY: a live VmState's global outlives it (thread-local to the VM's thread).
    unsafe { &*s.global.get() }
}

impl Exporter for JsExporter {
    fn export(&self, processor: &'static Processor, payload: Arc<ExportPayload>) {
        // SAFETY: every JsExporter lives in an Arc created by `JsExporter::new`.
        let me = unsafe {
            let ptr = core::ptr::from_ref(self);
            Arc::increment_strong_count(ptr);
            Arc::from_raw(ptr)
        };
        // Even on `self.thread`, defer to a task so exporters never run
        // re-entrantly inside whatever ended the span.
        let task = Box::into_raw(Box::new(JsExportTask {
            exporter: me,
            processor,
            payload,
        }));
        let managed = ManagedTask::new(task, run_js_export_task);
        let ct = bun_event_loop::ConcurrentTask::ConcurrentTask::create(managed);
        match self.vm.post(bun_jsc::LoopKind::Regular, ct) {
            bun_jsc::Posted::Queued => {}
            bun_jsc::Posted::Refused(ct) => {
                // SAFETY: VM gone; `ct` was refused unqueued and `task` was allocated above and never shared.
                unsafe {
                    bun_event_loop::ConcurrentTask::ConcurrentTask::release_refused(ct);
                    let t = Box::from_raw(task);
                    processor.export_done(&t.payload, ExportResult::Failure);
                }
            }
        }
    }

    fn export_blocking(&self, payload: Arc<ExportPayload>, _deadline_ns: u64) -> ExportResult {
        if std::thread::current().id() != self.thread {
            return ExportResult::Failure;
        }
        match super::vm_state() {
            Some(s) if core::ptr::eq(s, self.owner) => self.call(s_global(s), &payload),
            _ => ExportResult::Failure,
        }
    }

    fn name(&self) -> &str {
        "function"
    }
}

/// Idle hook target: wake the VM that has `forceFlush()` waiters.
pub(crate) fn post_flush_wake(handle: &VmHandle) {
    fn run(_: *mut u8) -> JsResult<()> {
        super::resolve_flush_waiters();
        Ok(())
    }
    let managed = ManagedTask::new(core::ptr::NonNull::<u8>::dangling().as_ptr(), run);
    let ct = bun_event_loop::ConcurrentTask::ConcurrentTask::create(managed);
    if let bun_jsc::Posted::Refused(ct) = handle.post(bun_jsc::LoopKind::Regular, ct) {
        // SAFETY: `ct` was refused unqueued; we still own it.
        unsafe { bun_event_loop::ConcurrentTask::ConcurrentTask::release_refused(ct) };
    }
}
