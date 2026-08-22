//! Native OpenTelemetry runtime layer: process/VM state, `Bun.otel` host
//! functions, exporters, and the small helpers integrations call.
//!
//! The core (ids, encoding, batching) is `bun_telemetry`; this module owns
//! everything that needs a VM, the HTTP thread, or JS values.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::sync::Arc;

use bun_core::{OwnedString, String as BunString};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSArrayIterator, JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_telemetry::config::{self, Compression, OtlpExporterConfig};
use bun_telemetry::processor::{self, Processor};
use bun_telemetry::{Instrument, Limits, Sampler, SpanContext, propagation};

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

pub use bun_telemetry::pool::{self, NativeSpan};
pub use span::{
    ContextScope, Entered, active, active_context, active_js, active_native, create_native_cell,
    discard_native, end_native, end_native_with, native_context_value, with_active_propagation,
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
}

/// Replaced wholesale by `configure()`; the previous value is intentionally
/// leaked (a few hundred bytes per `Bun.otel.start()` call) so `state()` can
/// hand out `&'static` without locking on hot paths.
static STATE: core::sync::atomic::AtomicPtr<State> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());
static RETIRED_STATES: bun_threading::Guarded<Vec<usize>> = bun_threading::Guarded::new(Vec::new());
static DEFAULT_STATE: State = State {
    sampler: Sampler::ParentBasedAlwaysOn,
    limits: bun_telemetry::data::DEFAULT_LIMITS,
    propagate_trace_context: true,
    propagate_baggage: true,
    capture_db_statement: true,
    capture_request_headers: Vec::new(),
};

#[inline]
pub fn state() -> &'static State {
    let p = STATE.load(core::sync::atomic::Ordering::Acquire);
    if p.is_null() {
        &DEFAULT_STATE
    } else {
        // SAFETY: non-null values come from `Box::into_raw` in `configure` and are never freed.
        unsafe { &*p }
    }
}

#[inline]
fn configured() -> bool {
    !STATE.load(core::sync::atomic::Ordering::Acquire).is_null()
}

#[inline]
pub fn processor() -> &'static Processor {
    processor::global_or_init()
}

/// Per-VM (per JS thread) state, stored erased in `RareData::telemetry`.
pub struct VmState {
    /// Rebound when `bun test --isolate` swaps the global.
    global: Cell<*const JSGlobalObject>,
    pub(crate) local: RefCell<bun_telemetry::Local>,
    pub(crate) event_loop_timer: bun_ptr::JsCell<EventLoopTimer>,
    timer_armed: Cell<bool>,
    /// JS function exporters registered from this VM.
    js_exporters: RefCell<Vec<Arc<exporter::JsExporter>>>,
    /// Promises from `forceFlush()` waiting for in-flight exports to drain.
    flush_waiters: RefCell<Vec<bun_jsc::JSPromiseStrong>>,
    flush_hook_installed: Cell<bool>,
    api_installed: Cell<bool>,
}

bun_event_loop::impl_timer_owner!(VmState; from_timer_ptr => event_loop_timer);

fn vm_state_of(vm: &VirtualMachine) -> Option<&'static VmState> {
    let p = vm.rare_data.as_ref()?.telemetry?;
    // SAFETY: the slot only ever holds the `VmState` leaked by `vm_state_or_init`; cleared before free.
    Some(unsafe { &*p.as_ptr().cast::<VmState>() })
}

#[inline]
pub(crate) fn vm_state(global: &JSGlobalObject) -> Option<&'static VmState> {
    vm_state_of(global.bun_vm())
}

/// For event-loop tasks that run without a global in hand.
pub(crate) fn current_vm_state() -> Option<&'static VmState> {
    vm_state_of(VirtualMachine::get())
}

fn vm_state_or_init(global: &JSGlobalObject) -> &'static VmState {
    if let Some(s) = vm_state(global) {
        s.rebind_global(global);
        return s;
    }
    let s = Box::leak(Box::new(VmState {
        global: Cell::new(core::ptr::from_ref(global)),
        local: RefCell::new(bun_telemetry::Local::new()),
        event_loop_timer: bun_ptr::JsCell::new(EventLoopTimer::init_paused(
            EventLoopTimerTag::TelemetryFlush,
        )),
        timer_armed: Cell::new(false),
        js_exporters: RefCell::new(Vec::new()),
        flush_waiters: RefCell::new(Vec::new()),
        flush_hook_installed: Cell::new(false),
        api_installed: Cell::new(false),
    }));
    let rare = global.bun_vm().as_mut().rare_data();
    rare.telemetry = Some(core::ptr::NonNull::from(&mut *s).cast());
    // Flush this VM's spans (and, on the main thread, drain exporters) at exit.
    rare.push_cleanup_hook(
        global,
        core::ptr::from_mut::<VmState>(s).cast::<c_void>(),
        on_vm_exit,
    );
    s
}

/// `global`'s per-VM telemetry state (span pool, batch, scratch). `None`
/// once the VM has run its exit hooks. Hold the borrow only around pure-Rust
/// telemetry work; never across JS.
#[inline]
pub fn local(global: &JSGlobalObject) -> Option<core::cell::RefMut<'static, bun_telemetry::Local>> {
    local_cell(global).map(RefCell::borrow_mut)
}

fn local_cell(global: &JSGlobalObject) -> Option<&'static RefCell<bun_telemetry::Local>> {
    let s = match vm_state(global) {
        Some(s) => s,
        None if global.bun_vm().has_run_cleanup_hooks() => return None,
        None => vm_state_or_init(global),
    };
    Some(&s.local)
}

fn local_hook(global: *mut c_void) -> *const RefCell<bun_telemetry::Local> {
    match local_cell(JSGlobalObject::opaque_ref(global.cast::<JSGlobalObject>())) {
        Some(c) => c,
        None => core::ptr::null(),
    }
}

impl VmState {
    #[inline]
    fn global(&self) -> &JSGlobalObject {
        // SAFETY: the VmState belongs to one VM; `rebind_global` keeps this the live global.
        unsafe { &*self.global.get() }
    }

    fn rebind_global(&self, global: &JSGlobalObject) {
        if !core::ptr::eq(self.global.get(), global) {
            self.global.set(core::ptr::from_ref(global));
            self.api_installed.set(false);
            // JS exporters hold callbacks from the previous realm.
            exporter::JsExporter::detach_all_for_vm(self);
        }
    }

    fn arm_timer(&self) {
        if self.timer_armed.get() {
            return;
        }
        let delay = processor().config.read().scheduled_delay_ms.max(50);
        let next =
            bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).add_ms(delay as i64);
        self.event_loop_timer.with_mut(|t| {
            t.next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            }
        });
        // SAFETY: JS thread only; the timer heap holds the pointer until `disarm_timer`/fire, and `self` is leaked.
        unsafe { (*crate::jsc_hooks::timer_all()).insert(self.event_loop_timer.as_ptr()) };
        self.timer_armed.set(true);
    }

    fn disarm_timer(&self) {
        if self.timer_armed.replace(false) {
            // SAFETY: JS thread only; inserted by `arm_timer`.
            unsafe { (*crate::jsc_hooks::timer_all()).remove(self.event_loop_timer.as_ptr()) };
        }
    }

    /// Timer callback (unref'd; never keeps the loop alive).
    pub(crate) fn on_timer(&self) {
        self.timer_armed.set(false);
        bun_telemetry::batch::flush_local(&mut self.local.borrow_mut().batch);
        processor().tick();
        if bun_telemetry::any_enabled() || processor().pending_count() > 0 {
            self.arm_timer();
        }
    }
}

extern "C" fn on_vm_exit(ctx: *mut c_void) {
    // SAFETY: `ctx` is the leaked VmState registered in `vm_state_or_init`.
    let s = unsafe { &*ctx.cast::<VmState>() };
    s.disarm_timer();
    bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
    let global = s.global();
    // JS exporters belonging to this VM get their final batch synchronously.
    if global.bun_vm().worker_ref().is_none() {
        processor().shutdown_blocking();
    } else {
        // Workers: push to the shared processor; the main thread exports.
        processor().tick();
    }
    exporter::JsExporter::detach_all_for_vm(s);
    if global.bun_vm().worker_ref().is_some() {
        // The worker thread is going away; nothing can reach this VmState again.
        global.bun_vm().as_mut().rare_data().telemetry = None;
        // SAFETY: allocated by `vm_state_or_init` via Box::leak; the RareData
        // slot that published it was just cleared.
        drop(unsafe { Box::from_raw(ctx.cast::<VmState>()) });
    }
}

/// After a span was recorded on `global`'s VM: make sure a flush is scheduled.
#[inline]
pub(crate) fn after_record(global: &JSGlobalObject) {
    if let Some(s) = vm_state(global) {
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
    if let Some(s) = vm_state(global) {
        s.rebind_global(global);
    }
    if configured() {
        // Already configured by another thread (worker inherits): just attach.
        if bun_telemetry::any_enabled() {
            let s = vm_state_or_init(global);
            s.arm_timer();
            install_api_global(global);
        }
        return;
    }
    let loader = vm.env_loader();
    if loader.get(b"BUN_OTEL").is_none()
        && loader.get(b"OTEL_BUN").is_none()
        && !bun_telemetry::config::bunfig().is_some_and(|b| b.enabled == Some(true))
    {
        return;
    }
    let env = read_env_config(vm);
    for w in &env.warnings {
        bun_core::warn!("[otel] {}", w);
    }
    if !env.enabled {
        return;
    }
    if let Err(e) = configure(global, &env.config) {
        bun_core::warn!("[otel] {}", bstr::BStr::new(&e));
    }
}

/// Apply `cfg`: state, resource, exporters, enable mask. Exporters are
/// additive; `start()` clears them first when it is given an explicit list.
/// The enable mask replaces the previous one.
pub fn configure(global: &JSGlobalObject, cfg: &bun_telemetry::Config) -> Result<(), Vec<u8>> {
    let vm = global.bun_vm();
    let p = processor();
    let mut otlp_exporters = Vec::with_capacity(cfg.otlp_exporters.len());
    for x in &cfg.otlp_exporters {
        otlp_exporters.push(Arc::new(exporter::OtlpHttpExporter::new(x)?));
    }
    let new_state = Box::into_raw(Box::new(State {
        sampler: cfg.sampler,
        limits: cfg.limits,
        propagate_trace_context: cfg.propagate_trace_context,
        propagate_baggage: cfg.propagate_baggage,
        capture_db_statement: cfg.capture_db_statement,
        capture_request_headers: cfg
            .capture_request_headers
            .iter()
            .map(|s| s.as_bytes().into())
            .collect(),
    }));
    let old = STATE.swap(new_state, core::sync::atomic::Ordering::AcqRel);
    if !old.is_null() {
        // Other threads may still hold a `&'static State` from `state()`;
        // retire instead of freeing (reconfiguration is rare).
        RETIRED_STATES.lock().push(old as usize);
    }
    *p.config.write() = cfg.batch;
    let script = bun_paths::basename(vm.main());
    let resource = bun_telemetry::resource::encode(&bun_telemetry::resource::ResourceInfo {
        service_name: cfg.service_name.as_deref(),
        extra: &cfg.resource_attributes,
        runtime_version: bun_core::Environment::VERSION_STRING,
        pid: std::process::id(),
        script: core::str::from_utf8(script).ok(),
    });
    p.set_resource(resource);
    for x in otlp_exporters {
        p.add_exporter(x);
    }
    if cfg.console_exporter {
        p.add_exporter(Arc::new(exporter::ConsoleExporter));
    }
    bun_telemetry::rt::install(bun_telemetry::rt::Hooks {
        active_span: |g| span::active_ptr(g),
        local: local_hook,
        after_record: |g| after_record(JSGlobalObject::opaque_ref(g.cast::<JSGlobalObject>())),
        release_cell: span::release_cell,
        sampler: || state().sampler,
        limits: || state().limits,
        capture_db_statement: || state().capture_db_statement,
    });
    bun_telemetry::set_enabled_mask(cfg.instruments, cfg.roots);
    let s = vm_state_or_init(global);
    s.arm_timer();
    install_api_global(global);
    Ok(())
}

/// Pre-populate `globalThis[Symbol.for("opentelemetry.js.api.1")]` so any
/// copy of `@opentelemetry/api` resolves to the native provider.
fn install_api_global(global: &JSGlobalObject) {
    let Some(s) = vm_state(global) else { return };
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

/// End a leaf span started with [`start_leaf`]; `write` adds attributes.
#[inline]
pub fn end_leaf(
    global: &JSGlobalObject,
    i: Instrument,
    stub: &bun_telemetry::SpanStub,
    name: &[u8],
    kind: bun_telemetry::SpanKind,
    write: impl FnMut(&mut bun_telemetry::SpanWriter<'_>),
) {
    bun_telemetry::rt::end_leaf(global.as_ptr().cast(), i, stub, name, kind, write)
}

pub use propagation::{format_traceparent, parse_traceparent};

// ─────────────────────────── host functions (`$newRustFunction("telemetry.rs", …)`) ───────────────────────────

fn arg_string(global: &JSGlobalObject, v: JSValue) -> JsResult<Option<String>> {
    if !v.is_string() {
        return Ok(None);
    }
    let s = OwnedString::new(BunString::from_js(v, global)?);
    Ok(Some(
        bstr::ByteSlice::to_str_lossy(s.to_utf8().slice()).into_owned(),
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
    let mut replaces_exporters = false;

    if opts.is_object() {
        if let Some(v) = opts.get(global, "serviceName")? {
            cfg.service_name = arg_string(global, v)?;
        }
        if let Some(v) = opts.get(global, "resourceAttributes")? {
            span::for_each_attribute(global, v, |k, val| {
                let vs = match val {
                    bun_telemetry::Value::Str(s) => bstr::ByteSlice::to_str_lossy(*s).into_owned(),
                    bun_telemetry::Value::Int(i) => i.to_string(),
                    bun_telemetry::Value::Double(d) => d.to_string(),
                    bun_telemetry::Value::Bool(b) => b.to_string(),
                    _ => return,
                };
                let k = bstr::ByteSlice::to_str_lossy(k).into_owned();
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
            replaces_exporters = true;
        }
        if let Some(url) = endpoint {
            let mut x = OtlpExporterConfig::new(normalize_traces_url(&url));
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
                        cfg.otlp_exporters
                            .push(OtlpExporterConfig::new(normalize_traces_url(&s)));
                    }
                    continue;
                }
                if !item.is_object() {
                    return Err(global.throw_invalid_arguments(format_args!("each exporter must be a URL string, {{ url, headers }} or {{ export(spans) }}")));
                }
                // Function exporters: { export(spans) } | { exportProtobuf(bytes) } | { exportJSON(string) }.
                let mut js_fn = None;
                for (key, format) in [
                    ("export", exporter::JsFormat::Objects),
                    ("exportProtobuf", exporter::JsFormat::Protobuf),
                    ("exportJSON", exporter::JsFormat::Json),
                ] {
                    if let Some(f) = item.get(global, key)? {
                        if !f.is_callable() {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "exporter.{key} must be a function"
                            )));
                        }
                        if js_fn.is_some() {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "exporter must have only one of export(), exportProtobuf() or exportJSON()"
                            )));
                        }
                        js_fn = Some((f, format));
                    }
                }
                if let Some((f, format)) = js_fn {
                    js_exporters.push(exporter::JsExporter::new(global, f, item, format));
                    continue;
                }
                // Vendor preset: { type: "datadog" | "honeycomb" | …, apiKey?, site?, id?, endpoint? }
                if let Some(t) = item.get(global, "type")? {
                    let name = arg_string(global, t)?.unwrap_or_default();
                    let field = |k: &str| -> JsResult<Option<String>> {
                        match item.get(global, k)? {
                            Some(v) if !v.is_undefined_or_null() => arg_string(global, v),
                            _ => Ok(None),
                        }
                    };
                    let input = bun_telemetry::presets::PresetInput {
                        name: &name,
                        api_key: field("apiKey")?,
                        site: field("site")?.or(field("region")?),
                        id: field("id")?.or(field("dataset")?).or(field("instanceId")?),
                        endpoint: field("endpoint")?.or(field("url")?),
                    };
                    let loader = vm.env_loader();
                    let mut x = match bun_telemetry::presets::resolve(&input, &|k| {
                        loader
                            .get(k.as_bytes())
                            .map(|v| bstr::ByteSlice::to_str_lossy(v).into_owned())
                    }) {
                        Ok(x) => x,
                        Err(e) => return Err(global.throw_invalid_arguments(format_args!("{e}"))),
                    };
                    read_exporter_extras(global, item, &mut x)?;
                    cfg.otlp_exporters.push(x);
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
                        "exporter needs a url, a type, or an export() function"
                    )));
                };
                let mut x = OtlpExporterConfig::new(normalize_traces_url(&url));
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
                cfg.batch.max_export_batch_size = cfg
                    .batch
                    .max_export_batch_size
                    .min(cfg.batch.max_queue_size);
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

    // An explicit exporter list replaces whatever was configured before
    // (env or an earlier start()), so repeated start() calls don't fan out
    // to duplicate destinations.
    if replaces_exporters {
        processor().clear_exporters();
        if let Some(s) = vm_state(global) {
            exporter::JsExporter::detach_all_for_vm(s);
        }
    }
    if let Err(e) = configure(global, &cfg) {
        return Err(global.throw_invalid_arguments(format_args!("{}", bstr::BStr::new(&e))));
    }
    if !js_exporters.is_empty() {
        let s = vm_state_or_init(global);
        for e in js_exporters {
            s.js_exporters.borrow_mut().push(Arc::clone(&e));
            processor().add_exporter(e);
        }
    }
    Ok(JSValue::UNDEFINED)
}

fn normalize_traces_url(url: &str) -> String {
    // A bare collector base URL gets the traces path; anything with a path is used as-is.
    let trimmed = url.trim_end_matches('/');
    let after_scheme = bun_core::strings::split_once(trimmed.as_bytes(), b"://")
        .map(|(_, r)| r)
        .unwrap_or(trimmed.as_bytes());
    if bun_core::strings::contains_char(after_scheme, b'/') {
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
                        bstr::ByteSlice::to_str_lossy(name.to_utf8().slice()).into_owned(),
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

/// `activeSpan()` → TelemetrySpan | undefined
#[bun_jsc::host_fn]
pub fn active_span(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    match active(global) {
        Some(s) if s.ctx.is_valid() => Ok(active_js(global)),
        _ => Ok(JSValue::UNDEFINED),
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
    if span::is_span(value) {
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
    bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
    processor().export();
    processor().retry_now();
    if processor().inflight() == 0 && processor().pending_retries() == 0 {
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
    let Some(s) = current_vm_state() else { return };
    if processor().pending_retries() != 0 {
        // A flush is waiting on a payload that got parked: retry it now
        // rather than after its backoff.
        processor().retry_now();
        return;
    }
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
    if let Some(s) = vm_state(global) {
        bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
    }
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

/// `httpClientEnabled()` — node:http client fast check: is a CLIENT span
/// wanted right now (instrumentation on, and a parent is active or roots are
/// allowed)?
#[bun_jsc::host_fn]
pub fn http_client_enabled(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    if !bun_telemetry::enabled(Instrument::HttpClient) {
        return Ok(JSValue::FALSE);
    }
    Ok(JSValue::from(
        bun_telemetry::allows_root(Instrument::HttpClient) || active_context(global).is_some(),
    ))
}

/// `instrumentId(name)` → index of a built-in instrumentation (its
/// `bun_telemetry::Instrument` discriminant), for `startInstrumentSpan`.
#[bun_jsc::host_fn]
pub fn instrument_id(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let name = arg_string(global, frame.argument(0))?.unwrap_or_default();
    match Instrument::from_name(name.as_bytes()) {
        Some(i) => Ok(JSValue::js_number_from_int32(i as i32)),
        None => {
            Err(global.throw_invalid_arguments(format_args!("unknown instrumentation \"{name}\"")))
        }
    }
}

/// `propagationFlags()` → bit 0: W3C trace context, bit 1: baggage.
#[bun_jsc::host_fn]
pub fn propagation_flags(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let st = state();
    Ok(JSValue::js_number_from_int32(
        (st.propagate_trace_context as i32) | ((st.propagate_baggage as i32) << 1),
    ))
}
