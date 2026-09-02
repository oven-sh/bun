//! Native OpenTelemetry runtime layer: process/VM state, `Bun.otel` host
//! functions, exporters, and the small helpers integrations call.
//!
//! The core (ids, encoding, batching) is `bun_telemetry`; this module owns
//! everything that needs a VM, the HTTP thread, or JS values.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::sync::Arc;

use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::ManagedTask::ManagedTask;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSArrayIterator, JSGlobalObject, JSValue, JsResult, VmHandle};
use bun_telemetry::processor::{self, Processor};
use bun_telemetry::{Instrument, InstrumentSet, RootSampler, Sampler};
use bun_telemetry_cold::config::{self, Compression, ExporterConfig, OtlpExporterConfig};

use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerTag};

pub mod exporter;
pub mod fetch;
pub mod fs;
pub mod server;
pub mod span;
pub mod spawn;
pub mod sqlite;
pub mod websocket;

pub use bun_telemetry::pool::{self, NativeSpan};
pub use span::{
    Entered, active, active_context, active_js, active_native, discard_native, end_native,
    native_context_value, with_active_propagation,
};

pub use bun_telemetry::{State, configured, state};

/// Serializes "is anything configured yet → configure" across threads (main
/// and workers starting at once), so exporters are not added twice.
static CONFIGURE_LOCK: bun_threading::Guarded<()> = bun_threading::Guarded::new(());
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
    /// `forceFlush()` promises and the target each waits for (every payload
    /// taken before it must have settled).
    flush_waiters: RefCell<Vec<(bun_telemetry::FlushTarget, bun_jsc::JSPromiseStrong)>>,
    /// Keeps this event loop alive while `flush_waiters` is non-empty (the
    /// export completes on the HTTP thread; nothing else holds a worker open).
    flush_keep_alive: RefCell<bun_io::KeepAlive>,
    flush_hook_installed: Cell<bool>,
    api_installed: Cell<bool>,
    /// `flush_at_exit` ran (it can be reached from both on_exit and the cleanup hook).
    flushed_at_exit: Cell<bool>,
    /// Carrier span cell that suppresses tracing while active (exporter
    /// callbacks run under it, like the SDK's suppressTracing()).
    suppressor: RefCell<Option<bun_jsc::Strong>>,
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
    // None off the JS thread (the --watch flush runs on the watcher thread).
    // SAFETY: the thread-local VM pointer is valid for the thread's lifetime.
    VirtualMachine::get_or_null().and_then(|vm| vm_state_of(unsafe { &*vm }))
}

fn vm_state_or_init(global: &JSGlobalObject) -> &'static VmState {
    if let Some(s) = vm_state(global) {
        s.rebind_global(global);
        return s;
    }
    let s = vm_state_create(global);
    // A VM that first touches telemetry after another thread configured it
    // (a worker spawned before main's `start()`): give it the api global too —
    // on the next tick, since this can be reached from inside an integration.
    if configured() && !s.api_installed.get() {
        post_to_vm(&global.bun_vm().handle(), |_| {
            if let Some(s) = current_vm_state() {
                install_api_global(s.global());
            }
            Ok(())
        });
    }
    s
}

fn vm_state_create(global: &JSGlobalObject) -> &'static VmState {
    let s = Box::leak(Box::new(VmState {
        global: Cell::new(core::ptr::from_ref(global)),
        local: RefCell::new(bun_telemetry::Local::new()),
        event_loop_timer: bun_ptr::JsCell::new(EventLoopTimer::init_paused(
            EventLoopTimerTag::TelemetryFlush,
        )),
        timer_armed: Cell::new(false),
        js_exporters: RefCell::new(Vec::new()),
        flush_waiters: RefCell::new(Vec::new()),
        flush_keep_alive: RefCell::new(bun_io::KeepAlive::init()),
        flush_hook_installed: Cell::new(false),
        api_installed: Cell::new(false),
        flushed_at_exit: Cell::new(false),
        suppressor: RefCell::new(None),
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
    pub(crate) fn owner_key(&self) -> bun_telemetry::OwnerKey {
        bun_telemetry::OwnerKey::of(self)
    }

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
        let delay = processor().config().scheduled_delay_ms.max(50);
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

/// `VirtualMachine::on_exit` (every exit path, incl. process.exit() and fatal
/// errors): flush this VM's spans; on the main thread also drain every
/// exporter synchronously — even when only a worker configured tracing.
#[optimize(size)]
pub(crate) fn flush_at_exit(vm: Option<&mut bun_jsc::VirtualMachineRef>, reload: bool) {
    if reload {
        // --watch is about to execve (possibly from the watcher thread): push
        // out what is buffered, but never stall the dev loop on a collector.
        if let Some(s) = vm.as_deref().and_then(|vm| vm_state(vm.global())) {
            bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
        }
        if configured() {
            processor().shutdown_blocking_bounded(core::time::Duration::from_secs(1));
        }
        return;
    }
    let Some(vm) = vm else { return };
    let is_main = vm.worker_ref().is_none();
    match vm_state(vm.global()) {
        Some(s) => {
            if s.flushed_at_exit.replace(true) {
                return;
            }
            s.disarm_timer();
            bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
            exporter::JsExporter::settle_stranded_for_vm(s);
            if is_main {
                // JS exporters belonging to this VM get their final batch synchronously.
                processor().shutdown_blocking();
            } else {
                // Workers: this VM's own function exporters get the batch now
                // (their loop is going away); everything else exports async /
                // from the main thread at process exit.
                processor().flush_for_owner(s.owner_key());
            }
            exporter::JsExporter::detach_all_for_vm(s);
            processor().remove_settle_hooks(s.owner_key());
            // A JS exporter callback above may have recorded spans and re-armed the timer.
            s.disarm_timer();
        }
        None if is_main
            && configured()
            && !MAIN_FLUSHED.swap(true, core::sync::atomic::Ordering::Relaxed) =>
        {
            // Main thread never touched telemetry (a worker did): still the one
            // place the process can block for the final export.
            processor().shutdown_blocking();
        }
        None => {}
    }
}

/// `flush_at_exit` ran its main-thread drain without a VmState.
static MAIN_FLUSHED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

impl VmState {
    /// Enter a context under which no span starts (see `suppressor`).
    pub(crate) fn enter_suppressed(&self) -> Entered {
        let global = self.global();
        let cell = {
            let mut s = self.suppressor.borrow_mut();
            s.get_or_insert_with(|| {
                bun_jsc::Strong::create(span::suppressed_carrier_cell(global), global)
            })
            .get()
        };
        Entered::new(global, cell)
    }
}

/// RareData cleanup hook (VM teardown): flush if `on_exit` did not, then free.
#[optimize(size)]
extern "C" fn on_vm_exit(ctx: *mut c_void) {
    // SAFETY: `ctx` is the leaked VmState registered in `vm_state_or_init`.
    let s = unsafe { &*ctx.cast::<VmState>() };
    let global = s.global();
    flush_at_exit(Some(global.bun_vm().as_mut()), false);
    // Nothing can reach this VmState past the cleanup hook (`local()` returns
    // None once the slot is cleared).
    global.bun_vm().as_mut().rare_data().telemetry = None;
    // SAFETY: allocated by `vm_state_or_init` via Box::leak; the RareData
    // slot that published it was just cleared.
    drop(unsafe { Box::from_raw(ctx.cast::<VmState>()) });
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

#[optimize(size)]
fn read_env_config(vm: &VirtualMachine) -> config::EnvConfig {
    let loader = vm.env_loader();
    config::from_env(&|k: &str| loader.get(k.as_bytes()).map(|v| v.to_vec()))
}

/// [`read_env_config`] over `process.env` as it is now rather than the
/// process's startup environment, so `process.env.OTEL_* = …` assigned from
/// JS (a dotenv loader, a test) before `Bun.otel.start()` counts, as it does
/// for the SDK's `NodeSDK`.
#[optimize(size)]
fn read_live_env_config(global: &JSGlobalObject) -> JsResult<config::EnvConfig> {
    let env = bun_jsc::from_js_host_call(global, || Bun__Telemetry__processEnv(global))?;
    if !env.is_object() {
        return Ok(config::from_env(&|_| None));
    }
    let failed: core::cell::Cell<Option<bun_jsc::JsError>> = core::cell::Cell::new(None);
    let cfg = config::from_env(&|k: &str| {
        // After a getter threw, stop reading: the exception is pending.
        if let Some(e) = failed.take() {
            failed.set(Some(e));
            return None;
        }
        let v = match env.get(global, k) {
            Ok(Some(v)) if v.is_string() => v.to_utf8(global),
            Ok(_) => return None,
            Err(e) => {
                failed.set(Some(e));
                return None;
            }
        };
        match v {
            Ok(s) => Some(s.to_vec()),
            Err(e) => {
                failed.set(Some(e));
                None
            }
        }
    });
    match failed.take() {
        Some(e) => Err(e),
        None => Ok(cfg),
    }
}

/// Called once per VM during startup (main and workers). Cheap when
/// telemetry is not enabled: one env lookup.
#[optimize(size)]
pub fn init_for_vm(global: &JSGlobalObject) {
    let vm = global.bun_vm();
    if let Some(s) = vm_state(global) {
        s.rebind_global(global);
    }
    let configuring = CONFIGURE_LOCK.lock();
    if configured() {
        drop(configuring);
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
        && !bun_telemetry_cold::config::bunfig().is_some_and(|b| b.enabled == Some(true))
    {
        return;
    }
    let env = read_env_config(vm);
    for w in &env.warnings {
        bun_core::warn!("[otel] {}", w);
    }
    if env.activation != config::Activation::On {
        return;
    }
    if let Err(e) = configure(global, &env.config) {
        bun_core::warn!("[otel] {}", e);
    }
    drop(configuring);
    install_api_global(global);
}

/// Apply `cfg`: state, resource, exporters, enable mask. Exporters are
/// additive; `start()` clears them first when it is given an explicit list.
/// The enable mask replaces the previous one.
#[optimize(size)]
pub fn configure(
    global: &JSGlobalObject,
    cfg: &bun_telemetry_cold::Config,
) -> Result<(), exporter::InvalidEndpoint> {
    let exporters = exporter::build(global, &cfg.exporters)?;
    configure_with(global, cfg, exporters, None);
    Ok(())
}

/// Apply `cfg` with already-constructed exporters (infallible part).
#[optimize(size)]
fn configure_with(
    global: &JSGlobalObject,
    cfg: &bun_telemetry_cold::Config,
    exporters: Vec<Arc<dyn bun_telemetry::processor::Exporter>>,
    replace_owner: Option<bun_telemetry::OwnerKey>,
) {
    let vm = global.bun_vm();
    let p = processor();
    if configured() {
        // Spans recorded under the previous configuration go out with the
        // resource they were recorded under.
        if let Some(s) = vm_state(global) {
            bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
        }
        p.export_all();
    }
    bun_telemetry::set_state(cfg.state());
    p.set_config(cfg.batch);
    let host_name = crate::node::node_os::hostname_string();
    let os_version = crate::node::node_os::release();
    let resource =
        bun_telemetry_cold::resource::encode(&bun_telemetry_cold::resource::ResourceInfo {
            service_name: cfg.service_name.as_deref(),
            extra: &cfg.resource_attributes,
            runtime_version: bun_core::Environment::VERSION_STRING,
            pid: std::process::id(),
            command: vm.main(),
            executable_path: bun_core::self_exe_path()
                .map(|p| p.as_bytes())
                .unwrap_or(b""),
            host_name: host_name.to_utf8().slice(),
            // semconv enum values
            host_arch: match bun_core::Environment::ARCH {
                bun_core::Environment::Architecture::X64 => "amd64",
                bun_core::Environment::Architecture::Arm64 => "arm64",
                bun_core::Environment::Architecture::Wasm => "wasm32",
            },
            os_type: bun_core::Environment::OS.npm_name(),
            os_version: os_version.to_utf8().slice(),
        });
    p.set_resource(resource);
    p.install_exporters(replace_owner, exporters);
    bun_telemetry::activate(cfg.instruments, cfg.roots);
    let s = vm_state_or_init(global);
    s.arm_timer();
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

unsafe extern "C" {
    /// `process.env` as it is now (JSTelemetryTracer.cpp); empty ⟺ threw.
    safe fn Bun__Telemetry__processEnv(global: &JSGlobalObject) -> JSValue;
}

/// The one instance of [`bun_telemetry::rt::Hooks`] (resolved at link time by
/// the lower-tier crates that record spans without depending on this one).
#[unsafe(no_mangle)]
static __BUN_TELEMETRY_HOOKS: bun_telemetry::rt::Hooks = bun_telemetry::rt::Hooks {
    active_span: span::active_hook,
    local: local_hook,
    after_record: |g| after_record(JSGlobalObject::opaque_ref(g.cast::<JSGlobalObject>())),
    release_cell: span::release_cell,
    active_trace_state: |g, f| {
        span::with_active_trace_state(JSGlobalObject::opaque_ref(g.cast::<JSGlobalObject>()), f)
    },
    active_propagation: |g, f| {
        span::with_active_propagation(
            JSGlobalObject::opaque_ref(g.cast::<JSGlobalObject>()),
            |ts, bg| f(ts, bg),
        )
    },
};

// ─────────────────────────── span helpers for integrations ───────────────────────────

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

/// [`end_leaf`] with the end time stamped elsewhere (0 = now).
pub fn end_leaf_at(
    global: &JSGlobalObject,
    i: Instrument,
    stub: &bun_telemetry::SpanStub,
    name: &[u8],
    kind: bun_telemetry::SpanKind,
    end_ns: u64,
    mut write: impl FnMut(&mut bun_telemetry::SpanWriter<'_>),
) {
    bun_telemetry::rt::end_leaf_at(
        global.as_ptr().cast(),
        i,
        stub,
        name,
        kind,
        end_ns,
        &mut write,
    )
}

// ─────────────────────────── host functions (`$newRustFunction("telemetry.rs", …)`) ───────────────────────────

/// `obj[key]` as an owned string; `undefined`/`null` → None, non-string throws.
fn opt_str(global: &JSGlobalObject, obj: JSValue, key: &str) -> JsResult<Option<String>> {
    Ok(obj
        .get_optional_slice(global, key)?
        .map(|s| bstr::ByteSlice::to_str_lossy(s.slice()).into_owned()))
}

/// A string argument as an owned string; anything else → None.
fn arg_string(global: &JSGlobalObject, v: JSValue) -> JsResult<Option<String>> {
    if !v.is_string() {
        return Ok(None);
    }
    Ok(Some(
        bstr::ByteSlice::to_str_lossy(v.to_utf8(global)?.slice()).into_owned(),
    ))
}

/// `start(options?)` — configure and enable. Options mirror the env vars:
/// `{ serviceName, resourceAttributes, endpoint, headers,
///    exporters: [{ url, headers?, compression?, timeoutMs? } | "console" | { export(spans) } | { exportProtobuf(bytes) } | { exportJSON(string) }],
///    sampler: number | "always_on" | …, samplerArg, instrumentations: ["http", …] | { fetch: false, fs: "always" },
///    batch: { delayMs, timeoutMs, maxQueueSize, maxExportBatchSize }, limits: { attributeCountLimit, … },
///    captureDbStatement, propagators: ["tracecontext", "baggage"] }`
#[bun_jsc::host_fn]
#[optimize(size)]
pub fn start(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let opts = frame.argument(0);
    let env = read_live_env_config(global)?;
    if env.activation == config::Activation::SdkDisabled {
        // OTEL_SDK_DISABLED wins over code, as with the SDK's NodeSDK.start().
        static WARNED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
        if !WARNED.swap(true, core::sync::atomic::Ordering::Relaxed) {
            bun_core::warn!("[otel] Bun.otel.start() ignored: OTEL_SDK_DISABLED is set");
        }
        return Ok(JSValue::UNDEFINED);
    }
    if !configured() {
        // (the BUN_OTEL=1 startup path printed them already otherwise)
        for w in &env.warnings {
            bun_core::warn!("[otel] {}", w);
        }
    }
    // Base: the environment/bunfig configuration. A repeat start() (from any
    // thread) is a reconfiguration: options it omits go back to these
    // defaults process-wide; only the exporter list is kept unless given.
    let exporters_chosen_by_env = env.exporters_chosen_by_env;
    let mut cfg = env.config;
    let mut js_exporters: Vec<Arc<exporter::JsExporter>> = Vec::new();
    let mut replaces_exporters = false;

    if opts.is_object() {
        let explicit_service_name = opt_str(global, opts, "serviceName")?;
        let has_service_name = explicit_service_name.is_some();
        if let Some(v) = explicit_service_name {
            cfg.service_name = Some(v);
        }
        if let Some(v) = opts.get(global, "resourceAttributes")? {
            let Some(o) = v.get_object() else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "resourceAttributes must be an object"
                )));
            };
            use bun_telemetry_cold::config::ResourceValue as R;
            let iter = bun_jsc::JSPropertyIterator::init(
                global,
                o,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: true,
                    include_value: true,
                    ..Default::default()
                },
            )?;
            while let Some((name, val)) = iter.next()? {
                let vs = if val.is_string() {
                    R::Str(bstr::ByteSlice::to_str_lossy(val.to_utf8(global)?.slice()).into_owned())
                } else if val.is_number() {
                    let n = val.as_number();
                    if n.is_finite()
                        && n == n.trunc()
                        && n.abs() <= bun_jsc::MAX_SAFE_INTEGER as f64
                    {
                        R::Int(n as i64)
                    } else {
                        R::Double(n)
                    }
                } else if val.is_boolean() {
                    R::Bool(val.as_boolean())
                } else {
                    continue;
                };
                let k = bstr::ByteSlice::to_str_lossy(name.to_utf8().slice()).into_owned();
                if k == "service.name" {
                    // an explicit serviceName wins (SDK: OTEL_SERVICE_NAME > resource attrs)
                    if !has_service_name {
                        cfg.service_name = Some(vs.to_string());
                    }
                } else {
                    cfg.resource_attributes.retain(|(ek, _)| *ek != k);
                    cfg.resource_attributes.push((k, vs));
                }
            }
        }
        // `endpoint` + `headers` is shorthand for one OTLP exporter.
        let endpoint = opt_str(global, opts, "endpoint")?;
        let explicit_exporters = opts.get(global, "exporters")?;
        if endpoint.is_some() || explicit_exporters.is_some() {
            cfg.exporters.clear();
            replaces_exporters = true;
        }
        if let Some(url) = endpoint {
            let mut x = OtlpExporterConfig::new(config::normalize_traces_url(&url));
            read_exporter_headers(global, opts, &mut x)?;
            cfg.exporters.push(ExporterConfig::Otlp(x));
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
                        cfg.add_console();
                    } else {
                        cfg.exporters
                            .push(ExporterConfig::Otlp(OtlpExporterConfig::new(
                                config::normalize_traces_url(&s),
                            )));
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
                    if let Some(f) = item.get_function(global, key)? {
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
                if let Some(ty) = opt_str(global, item, "type")? {
                    if ty != "otlp" {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "unknown exporter type {ty:?} (expected \"otlp\", or an export() function)"
                        )));
                    }
                }
                let url = opt_str(global, item, "url")?;
                let Some(url) = url else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "exporter needs a url or an export() function"
                    )));
                };
                let mut x = OtlpExporterConfig::new(config::normalize_traces_url(&url));
                read_exporter_extras(global, item, &mut x)?;
                cfg.exporters.push(ExporterConfig::Otlp(x));
            }
        }
        if let Some(v) = opts.get(global, "sampler")? {
            // samplerArg falls back to OTEL_TRACES_SAMPLER_ARG like every other option.
            let arg = match opts.get(global, "samplerArg")? {
                Some(a) => Some(a),
                None => {
                    let env =
                        bun_jsc::from_js_host_call(global, || Bun__Telemetry__processEnv(global))?;
                    if env.is_object() {
                        env.get(global, "OTEL_TRACES_SAMPLER_ARG")?
                            .filter(|v| v.is_string())
                    } else {
                        None
                    }
                }
            };
            cfg.sampler = sampler_from_js(global, v, arg)?;
        }
        if let Some(v) = opts.get(global, "instrumentations")? {
            read_instrumentations(global, v, &mut cfg)?;
        }
        if let Some(b) = opts.get(global, "batch")? {
            if !b.is_object() {
                return Err(global.throw_invalid_arguments(format_args!("batch must be an object")));
            }
            if let Some(v) = match b.get_optional_int::<u32>(global, "delayMs")? {
                Some(v) => Some(v),
                None => b.get_optional_int::<u32>(global, "scheduledDelayMillis")?,
            } {
                cfg.batch.scheduled_delay_ms = v;
            }
            if let Some(v) = match b.get_optional_int::<u32>(global, "timeoutMs")? {
                Some(v) => Some(v),
                None => b.get_optional_int::<u32>(global, "exportTimeoutMillis")?,
            } {
                cfg.batch.export_timeout_ms = v;
            }
            if let Some(v) = b.get_optional_int::<u32>(global, "maxQueueSize")? {
                cfg.batch.max_queue_size = v;
            }
            if let Some(v) = b.get_optional_int::<u32>(global, "maxExportBatchSize")? {
                cfg.batch.max_export_batch_size = v;
            }
        }
        if let Some(v) = opts.get(global, "captureDbStatement")? {
            cfg.capture_db_statement = v.to_boolean();
        }
        if let Some(v) = opts.get(global, "propagators")? {
            if !v.is_array() {
                return Err(
                    global.throw_invalid_arguments(format_args!("propagators must be an array"))
                );
            }
            cfg.propagate_trace_context = false;
            cfg.propagate_baggage = false;
            let mut it = JSArrayIterator::init(v, global)?;
            while let Some(item) = it.next()? {
                match arg_string(global, item)?.as_deref() {
                    Some("tracecontext") => cfg.propagate_trace_context = true,
                    Some("baggage") => cfg.propagate_baggage = true,
                    other => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "unknown propagator {:?} (expected \"tracecontext\" or \"baggage\")",
                            other.unwrap_or("")
                        )));
                    }
                }
            }
        }
        if let Some(l) = opts.get(global, "limits")? {
            if !l.is_object() {
                return Err(
                    global.throw_invalid_arguments(format_args!("limits must be an object"))
                );
            }
            if let Some(v) = l.get_optional_int::<u16>(global, "attributeCountLimit")? {
                cfg.limits.attributes = v;
            }
            if let Some(v) = l.get_optional_int::<u16>(global, "eventCountLimit")? {
                cfg.limits.events = v;
            }
            if let Some(v) = l.get_optional_int::<u16>(global, "linkCountLimit")? {
                cfg.limits.links = v;
            }
            if let Some(v) = l.get_optional_int::<u32>(global, "attributeValueLengthLimit")? {
                cfg.limits.attribute_value_length = v;
            }
        }
    }

    // (options are parsed; no user JS runs past this point)
    let configuring = CONFIGURE_LOCK.lock();
    // `Bun.otel.start()` with no exporter anywhere (options, env, bunfig, an
    // earlier start) behaves like BUN_OTEL=1: the local collector default.
    if !replaces_exporters
        && !configured()
        && !exporters_chosen_by_env
        && cfg.exporters.is_empty()
        && js_exporters.is_empty()
    {
        cfg.exporters
            .push(ExporterConfig::Otlp(OtlpExporterConfig::new(
                config::traces_endpoint(config::DEFAULT_COLLECTOR),
            )));
    }
    // An explicit exporter list replaces whatever was configured before
    // (env or an earlier start()), so repeated start() calls don't fan out
    // to duplicate destinations.
    // Validate (construct) the new exporters before dropping the old ones, so
    // a bad URL leaves the previous pipeline intact.
    let built = match exporter::build(global, &cfg.exporters) {
        Ok(v) => v,
        Err(e) => return Err(global.throw_invalid_arguments(format_args!("{e}"))),
    };
    let mut new_exporters: Vec<Arc<dyn bun_telemetry::processor::Exporter>> = Vec::new();
    // No exporters given to a repeat start(): keep the pipeline env/bunfig/an
    // earlier start() already set up rather than adding the env-derived ones again.
    if replaces_exporters || !configured() {
        new_exporters.extend(built);
    }
    let replace_owner = if replaces_exporters {
        if let Some(s) = vm_state(global) {
            exporter::JsExporter::detach_all_for_vm(s);
        }
        Some(vm_state_or_init(global).owner_key())
    } else {
        None
    };
    if !js_exporters.is_empty() {
        let s = vm_state_or_init(global);
        for e in &js_exporters {
            s.js_exporters.borrow_mut().push(Arc::clone(e));
        }
        new_exporters.extend(
            js_exporters
                .into_iter()
                .map(|e| e as Arc<dyn bun_telemetry::processor::Exporter>),
        );
    }
    configure_with(global, &cfg, new_exporters, replace_owner);
    drop(configuring);
    install_api_global(global);
    Ok(JSValue::UNDEFINED)
}

#[optimize(size)]
fn read_exporter_extras(
    global: &JSGlobalObject,
    obj: JSValue,
    x: &mut OtlpExporterConfig,
) -> JsResult<()> {
    read_exporter_headers(global, obj, x)?;
    match opt_str(global, obj, "compression")?.as_deref() {
        None => {}
        Some("none") => x.compression = Compression::None,
        Some("gzip") => x.compression = Compression::Gzip,
        Some(other) => {
            return Err(global.throw_invalid_arguments(format_args!(
                "unknown compression \"{other}\" (expected \"gzip\" or \"none\")"
            )));
        }
    }
    if let Some(t) = obj.get_optional_int::<u32>(global, "timeoutMs")? {
        x.timeout_ms = t;
    }
    Ok(())
}

/// `headers` in the shapes `fetch` accepts: a Headers, a record, or [name, value] pairs.
#[optimize(size)]
fn read_exporter_headers(
    global: &JSGlobalObject,
    obj: JSValue,
    x: &mut OtlpExporterConfig,
) -> JsResult<()> {
    if let Some(h) = obj.get(global, "headers")? {
        if let Some(fh) = bun_jsc::FetchHeaders::create_from_js(global, h)? {
            // SAFETY: `create_from_js` returned a +1 owned FetchHeaders.
            let fh = unsafe { &mut *fh.as_ptr() };
            let headers = bun_http_jsc::headers_jsc::from_fetch_headers(Some(fh), None);
            fh.deref();
            use bun_http_types::ETag::HeaderEntryColumns;
            let entries = headers.entries.slice();
            for (name, value) in entries.items_name().iter().zip(entries.items_value()) {
                let name = bstr::ByteSlice::to_str_lossy(headers.as_str(*name)).into_owned();
                x.headers.retain(|(k, _)| !k.eq_ignore_ascii_case(&name));
                x.headers.push((
                    name,
                    bstr::ByteSlice::to_str_lossy(headers.as_str(*value)).into_owned(),
                ));
            }
        }
    }
    Ok(())
}

fn sampler_from_js(global: &JSGlobalObject, v: JSValue, arg: Option<JSValue>) -> JsResult<Sampler> {
    let ratio_of = |r: f64| {
        if (0.0..=1.0).contains(&r) {
            Ok(r)
        } else {
            Err(global.throw_range_error(
                r,
                bun_core::fmt::OutOfRangeOptions {
                    min: 0,
                    max: 1,
                    field_name: b"sampler ratio",
                    ..Default::default()
                },
            ))
        }
    };
    if v.is_number() {
        return Ok(Sampler::ParentBased(RootSampler::TraceIdRatio(
            Sampler::ratio_threshold(ratio_of(v.as_number())?),
        )));
    }
    if let Some(name) = arg_string(global, v)? {
        let ratio = match arg {
            Some(a) if a.is_number() => Some(ratio_of(a.as_number())?),
            Some(a) => match arg_string(global, a)? {
                Some(s) => match Sampler::parse_ratio_arg(Some(s.as_bytes())) {
                    Ok(r) => r,
                    Err(()) => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "samplerArg \"{s}\" is not a number in 0..=1"
                        )));
                    }
                },
                None => None,
            },
            None => None,
        };
        if let Some(s) = Sampler::from_env(name.as_bytes(), ratio) {
            return Ok(s);
        }
        return Err(global.throw_invalid_arguments(format_args!("unknown sampler \"{name}\"")));
    }
    if v.is_undefined_or_null() {
        return Ok(Sampler::default());
    }
    Err(global.throw_invalid_arguments(format_args!(
        "sampler must be a ratio (number) or a sampler name (string)"
    )))
}

#[optimize(size)]
fn read_instrumentations(
    global: &JSGlobalObject,
    v: JSValue,
    cfg: &mut bun_telemetry_cold::Config,
) -> JsResult<()> {
    if v.is_array() {
        // Allow-list form: ["http", "fetch"].
        let mut mask = InstrumentSet::of(Instrument::User);
        let mut it = JSArrayIterator::init(v, global)?;
        while let Some(item) = it.next()? {
            if let Some(n) = arg_string(global, item)? {
                match Instrument::from_name(n.as_bytes()) {
                    Some(i) => mask.insert(i),
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
    let Some(o) = v.get_object() else {
        return Err(global.throw_invalid_arguments(format_args!(
            "instrumentations must be an array or an object"
        )));
    };
    let iter = bun_jsc::JSPropertyIterator::init(
        global,
        o,
        bun_jsc::JSPropertyIteratorOptions {
            skip_empty_name: true,
            include_value: true,
            ..Default::default()
        },
    )?;
    while let Some((name, val)) = iter.next()? {
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
                cfg.instruments.insert(i);
            } else {
                cfg.instruments.remove(i);
            }
        } else if let Some(s) = arg_string(global, val)? {
            match s.as_str() {
                "always" => {
                    cfg.instruments.insert(i);
                    cfg.roots.insert(i);
                }
                "nested" => {
                    cfg.instruments.insert(i);
                    cfg.roots.remove(i);
                }
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
    if (name.is_empty() || name == "bun") && version.is_empty() {
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

/// `with(span, fn, thisArg, ...args)` — run `fn` with `span` active.
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
    if !span::is_span(value) {
        return Err(global.throw_invalid_arguments(format_args!("expected a Span")));
    }
    let _g = Entered::new(global, value);
    f.call(global, this, &args)
}

/// `forceFlush()` → Promise<void> that resolves when everything queued so far
/// has been handed to every exporter (or dropped).
#[bun_jsc::host_fn]
pub fn force_flush(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let s = vm_state_or_init(global);
    bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
    // Everything recorded so far goes out now (`export_all`); the promise
    // resolves once those payloads and anything older, in flight or parked,
    // have settled (`settled_before`), not when the pipeline is idle.
    let target = processor().export_all();
    processor().hurry_retries_before(target);
    if processor().settled_before(target) {
        return Ok(bun_jsc::JSPromise::resolved_promise_value(
            global,
            JSValue::UNDEFINED,
        ));
    }
    let strong = bun_jsc::JSPromiseStrong::init(global);
    let value = strong.value();
    s.flush_waiters.borrow_mut().push((target, strong));
    s.flush_keep_alive.borrow_mut().ref_(bun_io::js_vm_ctx());
    if !s.flush_hook_installed.replace(true) {
        let handle = global.bun_vm().handle();
        processor().on_settle(s.owner_key(), Box::new(move || post_flush_wake(&handle)));
    }
    // A settlement may have already happened between the check and the hook.
    resolve_flush_waiters()?;
    Ok(value)
}

pub(crate) fn resolve_flush_waiters() -> JsResult<()> {
    let Some(s) = current_vm_state() else {
        return Ok(());
    };
    let Some(newest) = s.flush_waiters.borrow().iter().map(|w| w.0).max() else {
        return Ok(());
    };
    // Parked retries the waiters depend on go out now instead of after their backoff.
    processor().hurry_retries_before(newest);
    let ready: Vec<bun_jsc::JSPromiseStrong> = {
        let mut waiters = s.flush_waiters.borrow_mut();
        let ready: Vec<_> = waiters
            .extract_if(.., |w| processor().settled_before(w.0))
            .map(|w| w.1)
            .collect();
        if waiters.is_empty() && !ready.is_empty() {
            s.flush_keep_alive.borrow_mut().unref(bun_io::js_vm_ctx());
        }
        ready
    };
    let global = s.global();
    for mut w in ready {
        w.resolve(global, JSValue::UNDEFINED)?;
    }
    Ok(())
}

/// Settle hook target: wake the VM that has `forceFlush()` waiters.
fn post_flush_wake(handle: &VmHandle) {
    post_to_vm(handle, |_| resolve_flush_waiters());
}

/// Run `f` on `handle`'s event loop (dropped if that loop is gone).
fn post_to_vm(handle: &VmHandle, f: fn(*mut u8) -> JsResult<()>) {
    let managed = ManagedTask::new(core::ptr::NonNull::<u8>::dangling().as_ptr(), f);
    let ct = ConcurrentTask::create(managed);
    if let bun_jsc::Posted::Refused(ct) = handle.post(bun_jsc::LoopKind::Regular, ct) {
        // SAFETY: `ct` was refused unqueued; we still own it.
        unsafe { ConcurrentTask::release_refused(ct) };
    }
}

/// internal: `exportSettled(exporterId, payloadId, ok)` — an async function
/// exporter's promise settled (see JsExporter::await_settlement).
#[bun_jsc::host_fn]
pub fn export_settled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let exporter_id = frame.argument(0).as_number() as u64;
    let ticket = frame.argument(1).as_number() as u64;
    let ok = frame.argument(2).to_boolean();
    if let Some(s) = vm_state(global) {
        let found = s
            .js_exporters
            .borrow()
            .iter()
            .find(|e| e.id == exporter_id)
            .cloned();
        if let Some(e) = found {
            e.export_settled(ticket, ok);
        }
    }
    Ok(JSValue::UNDEFINED)
}

/// `stats()` → { spansExported, spansDropped, exportsSucceeded, exportsFailed, spansPending, exportsInflight }
#[bun_jsc::host_fn]
pub fn stats(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    use core::sync::atomic::Ordering::Relaxed;
    if let Some(s) = vm_state(global) {
        bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
    }
    let p = processor();
    let st = &p.stats;
    let o = JSValue::create_empty_object(global, 6);
    for (key, value) in [
        ("spansExported", st.spans_exported.load(Relaxed) as f64),
        ("spansDropped", st.spans_dropped.load(Relaxed) as f64),
        ("exportsSucceeded", st.exports_ok.load(Relaxed) as f64),
        ("exportsFailed", st.exports_failed.load(Relaxed) as f64),
        ("spansPending", p.pending_count() as f64),
        ("exportsInflight", p.inflight() as f64),
    ] {
        o.put(global, key, JSValue::js_number(value));
    }
    Ok(o)
}

/// `decode(bytes)` → array of span objects (see exporter::decode_to_js).
#[bun_jsc::host_fn]
#[optimize(size)]
pub fn decode(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let v = frame.argument(0);
    let Some(buf) = v.as_array_buffer(global) else {
        return Err(global.throw_invalid_arguments(format_args!("expected a Uint8Array")));
    };
    exporter::decode_to_js(global, buf.byte_slice())
}

/// internal `shutdown()` (after forceFlush): nothing records or is delivered
/// until the next start().
#[bun_jsc::host_fn]
pub fn shutdown(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    bun_telemetry::shut_down();
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

/// internal (node:http client): see telemetry/fetch.rs.
#[bun_jsc::host_fn]
pub fn http_client_begin(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    fetch::http_client_begin(global, frame)
}

/// internal (node:http client): see telemetry/fetch.rs.
#[bun_jsc::host_fn]
pub fn http_client_end(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    fetch::http_client_end(global, frame)
}

/// `propagationFlags()` → internal/telemetry.ts `Propagator` bits: bit 0 W3C trace context, bit 1 baggage.
#[bun_jsc::host_fn]
pub fn propagation_flags(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let st = state();
    Ok(JSValue::js_number_from_int32(
        (st.propagate_trace_context as i32) | ((st.propagate_baggage as i32) << 1),
    ))
}
