//! Native OpenTelemetry runtime layer: process/VM state, `Bun.otel` host
//! functions, exporters, and the small helpers integrations call.
//!
//! The core (ids, encoding, batching) is `bun_telemetry`; this module owns
//! everything that needs a VM, the HTTP thread, or JS values.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::sync::{Arc, OnceLock};

use bun_core::{OwnedString, String as BunString};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSArrayIterator, JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_telemetry::config::{self, Compression, OtlpExporterConfig};
use bun_telemetry::processor::{self, Processor};
use bun_telemetry::{Instrument, Limits, Sampler, ScopeId, SpanContext, propagation};

use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerTag};

pub mod exporter;
pub mod fetch;
pub mod fs;
pub mod http;
pub mod server;
pub mod span;
pub mod spawn;
pub mod sqlite;
pub mod websocket;

pub use span::{
    ContextScope, Entered, TelemetrySpan, active, active_context, active_js, active_ref, end_span,
};

/// Process-wide, immutable after `configure()`. Read on hot paths without
/// locking via `state()`.
pub struct State {
    pub sampler: Sampler,
    pub limits: Limits,
    pub propagate_trace_context: bool,
    pub propagate_baggage: bool,
    pub capture_db_statement: bool,
    pub capture_request_headers: Vec<Box<[u8]>>,
    pub capture_response_headers: Vec<Box<[u8]>>,
}

static STATE: OnceLock<State> = OnceLock::new();
static DEFAULT_STATE: State = State {
    sampler: Sampler::ParentBasedAlwaysOn,
    limits: bun_telemetry::data::DEFAULT_LIMITS,
    propagate_trace_context: true,
    propagate_baggage: true,
    capture_db_statement: true,
    capture_request_headers: Vec::new(),
    capture_response_headers: Vec::new(),
};

#[inline]
pub fn state() -> &'static State {
    STATE.get().unwrap_or(&DEFAULT_STATE)
}

#[inline]
pub fn processor() -> &'static Processor {
    processor::global_or_init()
}

/// Per-VM (per JS thread) state.
pub struct VmState {
    global: *const JSGlobalObject,
    pub(crate) event_loop_timer: EventLoopTimer,
    timer_armed: Cell<bool>,
    /// JS function exporters registered from this VM.
    js_exporters: RefCell<Vec<Arc<exporter::JsExporter>>>,
    /// Promises from `forceFlush()` waiting for in-flight exports to drain.
    flush_waiters: RefCell<Vec<bun_jsc::JSPromiseStrong>>,
    flush_hook_installed: Cell<bool>,
    api_installed: Cell<bool>,
}

bun_event_loop::impl_timer_owner!(VmState; from_timer_ptr => event_loop_timer);

thread_local! {
    static VM_STATE: Cell<*mut VmState> = const { Cell::new(core::ptr::null_mut()) };
}

pub(crate) fn vm_state() -> Option<&'static VmState> {
    let p = VM_STATE.with(|c| c.get());
    if p.is_null() {
        None
    } else {
        Some(unsafe { &*p })
    }
}

fn vm_state_or_init(global: &JSGlobalObject) -> &'static VmState {
    if let Some(s) = vm_state() {
        return s;
    }
    let s = Box::leak(Box::new(VmState {
        global: global as *const JSGlobalObject,
        event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::TelemetryFlush),
        timer_armed: Cell::new(false),
        js_exporters: RefCell::new(Vec::new()),
        flush_waiters: RefCell::new(Vec::new()),
        flush_hook_installed: Cell::new(false),
        api_installed: Cell::new(false),
    }));
    VM_STATE.with(|c| c.set(s));
    // Flush this VM's spans (and, on the main thread, drain exporters) at exit.
    global.bun_vm().as_mut().rare_data().push_cleanup_hook(
        global,
        s as *mut VmState as *mut c_void,
        on_vm_exit,
    );
    s
}

impl VmState {
    #[inline]
    fn global(&self) -> &JSGlobalObject {
        unsafe { &*self.global }
    }

    fn arm_timer(&self) {
        let delay = processor()
            .config
            .read()
            .unwrap()
            .scheduled_delay_ms
            .max(50);
        let next =
            bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).add_ms(delay as i64);
        let elt = &self.event_loop_timer as *const EventLoopTimer as *mut EventLoopTimer;
        unsafe {
            (*elt).next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            };
            (*crate::jsc_hooks::timer_all()).insert(elt);
        }
        self.timer_armed.set(true);
    }

    fn disarm_timer(&self) {
        if self.timer_armed.replace(false) {
            let elt = &self.event_loop_timer as *const EventLoopTimer as *mut EventLoopTimer;
            unsafe { (*crate::jsc_hooks::timer_all()).remove(elt) };
        }
    }

    /// Timer callback (unref'd; never keeps the loop alive).
    pub(crate) fn on_timer(&self) {
        self.timer_armed.set(false);
        processor().tick();
        if bun_telemetry::any_enabled() || processor().pending_count() > 0 {
            self.arm_timer();
        }
    }
}

extern "C" fn on_vm_exit(ctx: *mut c_void) {
    let s = unsafe { &*(ctx as *mut VmState) };
    s.disarm_timer();
    bun_telemetry::batch::flush_local();
    let global = s.global();
    // JS exporters belonging to this VM get their final batch synchronously.
    if global.bun_vm().worker_ref().is_none() {
        processor().shutdown_blocking();
    } else {
        // Workers: push to the shared processor; the main thread exports.
        processor().tick();
    }
    exporter::JsExporter::detach_all_for_vm(s);
}

/// After a span was recorded on this thread: make sure a flush is scheduled.
#[inline]
pub(crate) fn after_record() {
    if let Some(s) = vm_state() {
        if !s.timer_armed.get() {
            s.arm_timer();
        }
    }
}

// ─────────────────────────── configuration ───────────────────────────

fn read_env_config(vm: &VirtualMachine) -> config::EnvConfig {
    let loader = vm.env_loader();
    config::from_env(&|k: &str| loader.get(k.as_bytes()).map(|v| v.to_vec()))
}

/// Called once per VM during startup (main and workers). Cheap when
/// telemetry is not enabled: one env lookup.
pub fn init_for_vm(global: &JSGlobalObject) {
    let vm = global.bun_vm();
    if STATE.get().is_some() {
        // Already configured by another thread (worker inherits): just attach.
        if bun_telemetry::any_enabled() {
            let s = vm_state_or_init(global);
            s.arm_timer();
            install_api_global(global);
        }
        return;
    }
    let loader = vm.env_loader();
    if loader.get(b"BUN_OTEL").is_none() && loader.get(b"OTEL_BUN").is_none() {
        return;
    }
    let env = read_env_config(vm);
    for w in &env.warnings {
        bun_core::Output::warn(format_args!("[otel] {w}"));
    }
    if !env.enabled {
        return;
    }
    if let Err(e) = configure(global, env.config) {
        bun_core::Output::warn(format_args!("[otel] {}", bstr::BStr::new(&e)));
    }
}

/// Apply `cfg`: build resource, exporters, enable mask. First call wins for
/// the immutable `State`; exporters and the enable mask can be extended by
/// later calls (`Bun.otel.start()` after env init adds exporters).
pub fn configure(global: &JSGlobalObject, cfg: bun_telemetry::Config) -> Result<(), Vec<u8>> {
    let vm = global.bun_vm();
    let p = processor();
    let first = STATE
        .set(State {
            sampler: cfg.sampler,
            limits: cfg.limits.clone(),
            propagate_trace_context: cfg.propagate_trace_context,
            propagate_baggage: cfg.propagate_baggage,
            capture_db_statement: cfg.capture_db_statement,
            capture_request_headers: cfg
                .capture_request_headers
                .iter()
                .map(|s| s.as_bytes().into())
                .collect(),
            capture_response_headers: cfg
                .capture_response_headers
                .iter()
                .map(|s| s.as_bytes().into())
                .collect(),
        })
        .is_ok();
    if first {
        *p.config.write().unwrap() = cfg.batch;
        let script = vm
            .main()
            .rsplit(|&c| c == b'/' || c == b'\\')
            .next()
            .and_then(|s| core::str::from_utf8(s).ok());
        let resource = bun_telemetry::resource::encode(&bun_telemetry::resource::ResourceInfo {
            service_name: cfg.service_name.as_deref(),
            extra: &cfg.resource_attributes,
            runtime_version: bun_core::Environment::VERSION_STRING,
            pid: std::process::id(),
            script,
        });
        p.set_resource(resource);
    }
    for x in &cfg.otlp_exporters {
        match exporter::OtlpHttpExporter::new(x) {
            Ok(e) => p.add_exporter(Arc::new(e)),
            Err(e) => return Err(e),
        }
    }
    if cfg.console_exporter {
        p.add_exporter(Arc::new(exporter::ConsoleExporter));
    }
    bun_telemetry::rt::install(bun_telemetry::rt::Hooks {
        active_span: |g| span::active_ptr(g),
        after_record,
        sampler: || state().sampler,
        capture_db_statement: || state().capture_db_statement,
    });
    bun_telemetry::set_enabled_mask(cfg.instruments | bun_telemetry::enabled_mask(), cfg.roots);
    let s = vm_state_or_init(global);
    s.arm_timer();
    install_api_global(global);
    Ok(())
}

/// Pre-populate `globalThis[Symbol.for("opentelemetry.js.api.1")]` so any
/// copy of `@opentelemetry/api` resolves to the native provider.
fn install_api_global(global: &JSGlobalObject) {
    let Some(s) = vm_state() else { return };
    if s.api_installed.replace(true) {
        return;
    }
    unsafe extern "C" {
        safe fn Bun__Telemetry__installApiGlobal(global: &JSGlobalObject);
    }
    Bun__Telemetry__installApiGlobal(global);
}

// ─────────────────────────── span helpers for integrations ───────────────────────────

/// Parent for a new native span: the active span's context, if any.
#[inline]
pub fn current_parent(global: &JSGlobalObject) -> Option<SpanContext> {
    active_context(global)
}

/// Should instrumentation `i` record a span given `parent`?
#[inline]
pub fn should_start(i: Instrument, parent: Option<&SpanContext>) -> bool {
    bun_telemetry::enabled(i) && (parent.is_some() || bun_telemetry::allows_root(i))
}

/// Start a leaf `SpanStub` for instrumentation `i` under the active span.
/// Returns `SpanStub::NONE` when disabled / parent-required-but-absent.
#[inline]
pub fn start_leaf(global: &JSGlobalObject, i: Instrument) -> bun_telemetry::SpanStub {
    bun_telemetry::rt::start_leaf(global.as_ptr().cast(), i)
}

pub use bun_telemetry::rt::end_leaf;

pub use propagation::{format_traceparent, parse_traceparent};

// ─────────────────────────── host functions (`$newRustFunction("telemetry.rs", …)`) ───────────────────────────

fn arg_string(global: &JSGlobalObject, v: JSValue) -> JsResult<Option<String>> {
    if !v.is_string() {
        return Ok(None);
    }
    let s = OwnedString::new(BunString::from_js(v, global)?);
    Ok(Some(
        String::from_utf8_lossy(s.to_utf8().slice()).into_owned(),
    ))
}

/// `start(options?)` — configure and enable. Options mirror the env vars:
/// `{ serviceName, resourceAttributes, endpoint, headers, exporters: [{url, headers, compression} | {export(spans), format, }],
///    sampler: number | "always_on" | …, instrumentations: { fetch: false, fs: "always" }, batch: { delayMs, maxQueue, maxBatch, timeoutMs },
///    captureDbStatement, propagators: ["tracecontext","baggage"] }`
#[bun_jsc::host_fn]
pub fn start(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let opts = frame.argument(0);
    let vm = global.bun_vm();
    let env = read_env_config(vm);
    let mut cfg = env.config;
    let mut js_exporters: Vec<Arc<exporter::JsExporter>> = Vec::new();

    if opts.is_object() {
        if let Some(v) = opts.get(global, "serviceName")? {
            cfg.service_name = arg_string(global, v)?;
        }
        if let Some(v) = opts.get(global, "resourceAttributes")? {
            span::for_each_attribute(global, v, |k, val| {
                let vs = match val {
                    bun_telemetry::Value::Str(s) => String::from_utf8_lossy(s).into_owned(),
                    bun_telemetry::Value::Int(i) => i.to_string(),
                    bun_telemetry::Value::Double(d) => d.to_string(),
                    bun_telemetry::Value::Bool(b) => b.to_string(),
                    _ => return,
                };
                let k = String::from_utf8_lossy(k).into_owned();
                if k == "service.name" {
                    cfg.service_name = Some(vs);
                } else {
                    cfg.resource_attributes.retain(|(ek, _)| *ek != k);
                    cfg.resource_attributes.push((k, vs));
                }
            })?;
        }
        // `endpoint` / `url` + `headers` is shorthand for one OTLP exporter.
        let endpoint = match opts.get(global, "endpoint")? {
            Some(v) => arg_string(global, v)?,
            None => match opts.get(global, "url")? {
                Some(v) => arg_string(global, v)?,
                None => None,
            },
        };
        let explicit_exporters = opts.get(global, "exporters")?;
        if endpoint.is_some() || explicit_exporters.is_some() {
            cfg.otlp_exporters.clear();
            cfg.console_exporter = false;
        }
        if let Some(url) = endpoint {
            let mut x = OtlpExporterConfig {
                url: normalize_traces_url(&url),
                headers: Vec::new(),
                protocol: config::Protocol::HttpProtobuf,
                compression: Compression::None,
                timeout_ms: 10000,
            };
            read_exporter_extras(global, opts, &mut x)?;
            cfg.otlp_exporters.push(x);
        }
        if let Some(list) = explicit_exporters {
            if !list.is_array() {
                return Err(
                    global.throw_invalid_arguments(format_args!("exporters must be an array"))
                );
            }
            let mut it = JSArrayIterator::init(list, global)?;
            while let Some(item) = it.next()? {
                if item.is_string() {
                    let s = arg_string(global, item)?.unwrap_or_default();
                    if s == "console" {
                        cfg.console_exporter = true;
                    } else {
                        cfg.otlp_exporters.push(OtlpExporterConfig {
                            url: normalize_traces_url(&s),
                            headers: Vec::new(),
                            protocol: config::Protocol::HttpProtobuf,
                            compression: Compression::None,
                            timeout_ms: 10000,
                        });
                    }
                    continue;
                }
                if !item.is_object() {
                    return Err(global.throw_invalid_arguments(format_args!("each exporter must be a URL string, {{ url, headers }} or {{ export(batch) }}")));
                }
                if let Some(f) = item.get(global, "export")? {
                    if !f.is_callable() {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "exporter.export must be a function"
                        )));
                    }
                    let format = match item.get(global, "format")? {
                        Some(v) => match arg_string(global, v)?.as_deref() {
                            None | Some("objects") | Some("spans") => exporter::JsFormat::Objects,
                            Some("protobuf") | Some("proto") | Some("binary") => exporter::JsFormat::Protobuf,
                            Some("json") => exporter::JsFormat::Json,
                            Some(other) => return Err(global.throw_invalid_arguments(format_args!("unknown exporter format \"{other}\" (expected \"objects\", \"protobuf\" or \"json\")"))),
                        },
                        None => exporter::JsFormat::Objects,
                    };
                    js_exporters.push(exporter::JsExporter::new(global, f, item, format));
                    continue;
                }
                let url = match item.get(global, "url")? {
                    Some(v) => arg_string(global, v)?,
                    None => match item.get(global, "endpoint")? {
                        Some(v) => arg_string(global, v)?,
                        None => None,
                    },
                };
                let Some(url) = url else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "exporter needs a url or an export() function"
                    )));
                };
                let mut x = OtlpExporterConfig {
                    url: normalize_traces_url(&url),
                    headers: Vec::new(),
                    protocol: config::Protocol::HttpProtobuf,
                    compression: Compression::None,
                    timeout_ms: 10000,
                };
                read_exporter_extras(global, item, &mut x)?;
                cfg.otlp_exporters.push(x);
            }
        }
        if let Some(v) = opts.get(global, "sampler")? {
            cfg.sampler = sampler_from_js(global, v, opts.get(global, "samplerArg")?)?;
        } else if let Some(v) = opts.get(global, "sampleRate")? {
            if v.is_number() {
                cfg.sampler =
                    Sampler::ParentBasedTraceIdRatio(Sampler::ratio_threshold(v.as_number()));
            }
        }
        if let Some(v) = opts.get(global, "instrumentations")? {
            read_instrumentations(global, v, &mut cfg)?;
        }
        if let Some(b) = opts.get(global, "batch")? {
            if b.is_object() {
                if let Some(v) = b
                    .get(global, "delayMs")?
                    .or(b.get(global, "scheduledDelayMillis")?)
                {
                    cfg.batch.scheduled_delay_ms = v.to_number(global)?.max(0.0) as u32;
                }
                if let Some(v) = b
                    .get(global, "timeoutMs")?
                    .or(b.get(global, "exportTimeoutMillis")?)
                {
                    cfg.batch.export_timeout_ms = v.to_number(global)?.max(0.0) as u32;
                }
                if let Some(v) = b.get(global, "maxQueueSize")? {
                    cfg.batch.max_queue_size = (v.to_number(global)?.max(1.0)) as u32;
                }
                if let Some(v) = b.get(global, "maxExportBatchSize")? {
                    cfg.batch.max_export_batch_size = (v.to_number(global)?.max(1.0)) as u32;
                }
            }
        }
        if let Some(v) = opts.get(global, "captureDbStatement")? {
            cfg.capture_db_statement = v.to_boolean();
        }
        if let Some(v) = opts.get(global, "propagators")? {
            if v.is_array() {
                cfg.propagate_trace_context = false;
                cfg.propagate_baggage = false;
                let mut it = JSArrayIterator::init(v, global)?;
                while let Some(item) = it.next()? {
                    match arg_string(global, item)?.as_deref() {
                        Some("tracecontext") => cfg.propagate_trace_context = true,
                        Some("baggage") => cfg.propagate_baggage = true,
                        _ => {}
                    }
                }
            }
        }
        if let Some(l) = opts.get(global, "limits")? {
            if l.is_object() {
                if let Some(v) = l.get(global, "attributeCountLimit")? {
                    cfg.limits.attributes = v.to_number(global)?.clamp(0.0, 65535.0) as u16;
                }
                if let Some(v) = l.get(global, "eventCountLimit")? {
                    cfg.limits.events = v.to_number(global)?.clamp(0.0, 65535.0) as u16;
                }
                if let Some(v) = l.get(global, "linkCountLimit")? {
                    cfg.limits.links = v.to_number(global)?.clamp(0.0, 65535.0) as u16;
                }
                if let Some(v) = l.get(global, "attributeValueLengthLimit")? {
                    cfg.limits.attribute_value_length = v.to_number(global)?.max(0.0) as u32;
                }
            }
        }
    }

    if let Err(e) = configure(global, cfg) {
        return Err(global.throw_invalid_arguments(format_args!("{}", bstr::BStr::new(&e))));
    }
    if !js_exporters.is_empty() {
        let s = vm_state_or_init(global);
        for e in js_exporters {
            s.js_exporters.borrow_mut().push(e.clone());
            processor().add_exporter(e);
        }
    }
    Ok(JSValue::UNDEFINED)
}

fn normalize_traces_url(url: &str) -> String {
    // A bare collector base URL gets the traces path; anything with a path is used as-is.
    let trimmed = url.trim_end_matches('/');
    let after_scheme = trimmed.split_once("://").map(|(_, r)| r).unwrap_or(trimmed);
    if after_scheme.contains('/') {
        url.to_string()
    } else {
        format!("{trimmed}/v1/traces")
    }
}

fn read_exporter_extras(
    global: &JSGlobalObject,
    obj: JSValue,
    x: &mut OtlpExporterConfig,
) -> JsResult<()> {
    if let Some(h) = obj.get(global, "headers")? {
        if h.is_object() {
            let Some(o) = h.get_object() else {
                return Ok(());
            };
            let mut iter = bun_jsc::JSPropertyIterator::init(
                global,
                o,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: true,
                    include_value: true,
                    ..Default::default()
                },
            )?;
            while let Some(name) = iter.next()? {
                let v = iter.value;
                if let Some(vs) = arg_string(global, v)? {
                    x.headers.push((
                        String::from_utf8_lossy(name.to_utf8().slice()).into_owned(),
                        vs,
                    ));
                }
            }
        }
    }
    if let Some(c) = obj.get(global, "compression")? {
        x.compression = match arg_string(global, c)?.as_deref() {
            Some("gzip") => Compression::Gzip,
            _ => Compression::None,
        };
    }
    if let Some(t) = obj.get(global, "timeoutMs")? {
        if t.is_number() {
            x.timeout_ms = t.as_number().max(0.0) as u32;
        }
    }
    Ok(())
}

fn sampler_from_js(global: &JSGlobalObject, v: JSValue, arg: Option<JSValue>) -> JsResult<Sampler> {
    if v.is_number() {
        return Ok(Sampler::ParentBasedTraceIdRatio(Sampler::ratio_threshold(
            v.as_number(),
        )));
    }
    if let Some(name) = arg_string(global, v)? {
        let arg_s = match arg {
            Some(a) if a.is_number() => Some(a.as_number().to_string()),
            Some(a) => arg_string(global, a)?,
            None => None,
        };
        if let Some(s) = Sampler::from_env(name.as_bytes(), arg_s.as_deref().map(str::as_bytes)) {
            return Ok(s);
        }
        return Err(global.throw_invalid_arguments(format_args!("unknown sampler \"{name}\"")));
    }
    Ok(Sampler::default())
}

fn read_instrumentations(
    global: &JSGlobalObject,
    v: JSValue,
    cfg: &mut bun_telemetry::Config,
) -> JsResult<()> {
    if v.is_array() {
        // Allow-list form: ["http", "fetch"].
        let mut mask = Instrument::User.bit();
        let mut it = JSArrayIterator::init(v, global)?;
        while let Some(item) = it.next()? {
            if let Some(n) = arg_string(global, item)? {
                match Instrument::from_name(n.as_bytes()) {
                    Some(i) => mask |= i.bit(),
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "unknown instrumentation \"{n}\""
                        )));
                    }
                }
            }
        }
        cfg.instruments = mask;
        return Ok(());
    }
    if !v.is_object() {
        return Ok(());
    }
    let Some(o) = v.get_object() else {
        return Ok(());
    };
    let mut iter = bun_jsc::JSPropertyIterator::init(
        global,
        o,
        bun_jsc::JSPropertyIteratorOptions {
            skip_empty_name: true,
            include_value: true,
            ..Default::default()
        },
    )?;
    while let Some(name) = iter.next()? {
        let val = iter.value;
        let key = name.to_utf8();
        let Some(i) = Instrument::from_name(key.slice()) else {
            return Err(global.throw_invalid_arguments(format_args!(
                "unknown instrumentation \"{}\"",
                bstr::BStr::new(key.slice())
            )));
        };
        // false → off; true → on (default root policy); "always" → on + roots; "nested" → on, parent required.
        if val.is_boolean() {
            if val.as_boolean() {
                cfg.instruments |= i.bit();
            } else {
                cfg.instruments &= !i.bit();
            }
        } else if let Some(s) = arg_string(global, val)? {
            match s.as_str() {
                "always" | "root" => {
                    cfg.instruments |= i.bit();
                    cfg.roots |= i.bit();
                }
                "nested" | "child" | "parent" => {
                    cfg.instruments |= i.bit();
                    cfg.roots &= !i.bit();
                }
                "off" | "false" | "none" => cfg.instruments &= !i.bit(),
                other => return Err(global.throw_invalid_arguments(format_args!("instrumentations.{}: expected boolean, \"always\" or \"nested\", got \"{other}\"", i.name()))),
            }
        }
    }
    Ok(())
}

#[bun_jsc::host_fn]
pub fn is_enabled(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::from(bun_telemetry::any_enabled()))
}

/// `createScope(name, version?)` → scope id (number) for a JS tracer.
#[bun_jsc::host_fn]
pub fn create_scope(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let name = arg_string(global, frame.argument(0))?.unwrap_or_default();
    let version = arg_string(global, frame.argument(1))?.unwrap_or_default();
    if name.is_empty() {
        return Ok(JSValue::js_number_from_int32(Instrument::User as i32));
    }
    let id = processor().register_scope(name.as_bytes(), version.as_bytes());
    Ok(JSValue::js_number_from_int32(id.0 as i32))
}

/// `startSpan(scopeId, name, kind, parent, startTime, root)` → TelemetrySpan.
/// `parent`: undefined = active span; null = none (root); Span or SpanContext object = that.
#[bun_jsc::host_fn]
pub fn start_span(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let scope_v = frame.argument(0);
    let scope = if scope_v.is_number() {
        ScopeId(scope_v.as_number() as u16)
    } else {
        ScopeId::from(Instrument::User)
    };
    let name_v = frame.argument(1);
    let name = if name_v.is_string() {
        Some(name_v.to_slice(global)?)
    } else {
        None
    };
    let kind = span::kind_from_js(frame.argument(2));
    let parent_v = frame.argument(3);
    let parent = if parent_v.is_undefined() {
        active_context(global)
    } else if parent_v.is_null() {
        None
    } else {
        span::span_context_from_js(global, parent_v)?
    };
    let start_ns = span::time_from_js(global, frame.argument(4))?;
    let (span, js) = TelemetrySpan::start(
        global,
        scope,
        name.as_ref().map(|s| s.slice()).unwrap_or(b""),
        kind,
        parent.as_ref(),
        start_ns,
    );
    if parent.is_some() {
        let source = if parent_v.is_undefined() {
            active(global)
        } else {
            span::js::from_js(parent_v).map(|p| unsafe { p.as_ref() }.data())
        };
        if let Some(src) = source {
            src.with_propagation(|ts, bg| {
                if !ts.is_empty() {
                    span.set_trace_state(ts);
                }
                if !bg.is_empty() {
                    span.set_baggage(bg);
                }
            });
        }
    }
    Ok(js)
}

/// `activeSpan()` → TelemetrySpan | undefined
#[bun_jsc::host_fn]
pub fn active_span(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    match active(global) {
        Some(s) if s.context().is_valid() => Ok(active_js(global)),
        _ => Ok(JSValue::UNDEFINED),
    }
}

/// `wrapSpanContext({traceId, spanId, traceFlags, isRemote})` → non-recording TelemetrySpan
#[bun_jsc::host_fn]
pub fn wrap_span_context(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arg = frame.argument(0);
    if arg.is_null() {
        // Placeholder header for an api Context with values but no span.
        return Ok(TelemetrySpan::non_recording(global, SpanContext::default()));
    }
    match span::span_context_from_js(global, arg)? {
        Some(ctx) => {
            let js = TelemetrySpan::non_recording(global, ctx);
            if let Some(ts) = arg.get(global, "traceState")? {
                if ts.is_string() {
                    let ts = ts.to_slice(global)?;
                    if let Some(span) = span::js::from_js(js) {
                        unsafe { span.as_ref() }.data().set_trace_state(ts.slice());
                    }
                }
            }
            Ok(js)
        }
        None => Ok(JSValue::UNDEFINED),
    }
}

/// `with(spanOrContextValue, fn, thisArg, ...args)` — run `fn` with the slot
/// set to `spanOrContextValue` (a TelemetrySpan, or a raw captured slot value).
#[bun_jsc::host_fn]
pub fn with_context(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    let f = frame.argument(1);
    let this = frame.argument(2);
    if !f.is_callable() {
        return Err(global.throw_invalid_arguments(format_args!("expected a function")));
    }
    let n = frame.arguments_count() as usize;
    let mut args: Vec<JSValue> = Vec::with_capacity(n.saturating_sub(3));
    for i in 3..n {
        args.push(frame.argument(i));
    }
    if span::js::from_js(value).is_some() {
        let _g = Entered::new(global, value);
        return f.call(global, this, &args);
    }
    let _g = ContextScope::enter(global, value);
    f.call(global, this, &args)
}

/// `currentContext()` — opaque slot snapshot (for context.active()/bind()).
#[bun_jsc::host_fn]
pub fn current_context(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(ContextScope::current(global))
}

/// `forceFlush()` → Promise<void> that resolves when everything queued so far
/// has been handed to every exporter (or dropped).
#[bun_jsc::host_fn]
pub fn force_flush(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let s = vm_state_or_init(global);
    processor().export();
    if processor().inflight() == 0 {
        return Ok(bun_jsc::JSPromise::resolved_promise_value(
            global,
            JSValue::UNDEFINED,
        ));
    }
    let strong = bun_jsc::JSPromiseStrong::init(global);
    let value = strong.value();
    s.flush_waiters.borrow_mut().push(strong);
    if !s.flush_hook_installed.replace(true) {
        let handle = global.bun_vm().handle();
        processor().on_idle(Box::new(move || {
            exporter::post_flush_wake(&handle);
        }));
    }
    // The idle edge may have already passed between the check and the hook.
    if processor().inflight() == 0 {
        resolve_flush_waiters();
    }
    Ok(value)
}

pub(crate) fn resolve_flush_waiters() {
    let Some(s) = vm_state() else { return };
    if processor().inflight() != 0 {
        return;
    }
    let waiters = core::mem::take(&mut *s.flush_waiters.borrow_mut());
    let global = s.global();
    for mut w in waiters {
        let _ = w.resolve(global, JSValue::UNDEFINED);
    }
}

/// `stats()` → { spansExported, spansDropped, exportsOk, exportsFailed, pending, inflight }
#[bun_jsc::host_fn]
pub fn stats(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    use core::sync::atomic::Ordering::Relaxed;
    bun_telemetry::batch::flush_local();
    let p = processor();
    let o = JSValue::create_empty_object(global, 6);
    o.put(
        global,
        b"spansExported",
        JSValue::js_number(p.stats.spans_exported.load(Relaxed) as f64),
    );
    o.put(
        global,
        b"spansDropped",
        JSValue::js_number(p.stats.spans_dropped.load(Relaxed) as f64),
    );
    o.put(
        global,
        b"exportsSucceeded",
        JSValue::js_number(p.stats.exports_ok.load(Relaxed) as f64),
    );
    o.put(
        global,
        b"exportsFailed",
        JSValue::js_number(p.stats.exports_failed.load(Relaxed) as f64),
    );
    o.put(
        global,
        b"spansPending",
        JSValue::js_number(p.pending_count() as f64),
    );
    o.put(
        global,
        b"exportsInflight",
        JSValue::js_number(p.inflight() as f64),
    );
    Ok(o)
}

/// `decode(bytes)` → array of span objects (see exporter::decode_to_js).
#[bun_jsc::host_fn]
pub fn decode(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let v = frame.argument(0);
    let Some(buf) = v.as_array_buffer(global) else {
        return Err(global.throw_invalid_arguments(format_args!("expected a Uint8Array")));
    };
    exporter::decode_to_js(global, buf.byte_slice())
}

/// `setEnabled(mask, roots)` — testing hook / `Bun.otel.disable()`.
#[bun_jsc::host_fn]
pub fn set_enabled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let m = frame.argument(0);
    let r = frame.argument(1);
    if m.is_number() {
        let roots = if r.is_number() {
            r.as_number() as u32
        } else {
            m.as_number() as u32
        };
        bun_telemetry::set_enabled_mask(m.as_number() as u32, roots);
        if m.as_number() != 0.0 {
            vm_state_or_init(global).arm_timer();
        }
    }
    Ok(JSValue::UNDEFINED)
}
