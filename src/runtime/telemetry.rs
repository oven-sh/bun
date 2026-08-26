//! Native OpenTelemetry runtime layer: process/VM state, `Bun.otel` host
//! functions, exporters, and the small helpers integrations call.
//!
//! The core (ids, encoding, batching) is `bun_telemetry`; this module owns
//! everything that needs a VM, the HTTP thread, or JS values.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::sync::Arc;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSArrayIterator, JSGlobalObject, JSValue, JsResult};
use bun_telemetry::processor::{self, Processor};
use bun_telemetry::{Instrument, Limits, Sampler, SpanContext, propagation};
use bun_telemetry_cold::config::{self, Compression, OtlpExporterConfig};

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
    Entered, active, active_context, active_js, active_native, create_native_cell, discard_native,
    end_native, end_native_with, native_context_value, with_active_propagation,
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
/// Serializes "is anything configured yet → configure" across threads (main
/// and workers starting at once), so exporters are not added twice.
static CONFIGURE_LOCK: bun_threading::Guarded<()> = bun_threading::Guarded::new(());
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
pub(crate) fn configured() -> bool {
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
    /// `forceFlush()` promises and the payload sequence number each waits
    /// for (everything taken before it must have settled).
    flush_waiters: RefCell<Vec<(u64, bun_jsc::JSPromiseStrong)>>,
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
        exporter::post_to_vm(&global.bun_vm().handle(), |_| {
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
    fn idle_hook_key(&self) -> usize {
        core::ptr::from_ref(self) as usize
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

/// `VirtualMachine::on_exit` (every exit path, incl. process.exit() and fatal
/// errors): flush this VM's spans; on the main thread also drain every
/// exporter synchronously — even when only a worker configured tracing.
#[optimize(size)]
fn flush_at_exit(vm: Option<&mut bun_jsc::VirtualMachineRef>, reload: bool) {
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
                processor().flush_for_owner(s.idle_hook_key());
            }
            exporter::JsExporter::detach_all_for_vm(s);
            processor().remove_idle_hooks(s.idle_hook_key());
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
    if !env.enabled {
        return;
    }
    if let Err(e) = configure(global, &env.config) {
        bun_core::warn!("[otel] {}", bstr::BStr::new(&e));
    }
    drop(configuring);
    install_api_global(global);
}

/// Apply `cfg`: state, resource, exporters, enable mask. Exporters are
/// additive; `start()` clears them first when it is given an explicit list.
/// The enable mask replaces the previous one.
#[optimize(size)]
pub fn configure(global: &JSGlobalObject, cfg: &bun_telemetry_cold::Config) -> Result<(), Vec<u8>> {
    let otlp_exporters = exporter::OtlpHttpExporter::from_configs(&cfg.otlp_exporters)?;
    configure_with(
        global,
        cfg,
        otlp_exporters
            .into_iter()
            .map(|e| e as Arc<dyn bun_telemetry::processor::Exporter>)
            .collect(),
        None,
    );
    Ok(())
}

/// Apply `cfg` with already-constructed OTLP exporters (infallible part).
#[optimize(size)]
fn configure_with(
    global: &JSGlobalObject,
    cfg: &bun_telemetry_cold::Config,
    mut exporters: Vec<Arc<dyn bun_telemetry::processor::Exporter>>,
    replace_owner: Option<usize>,
) {
    let vm = global.bun_vm();
    let p = processor();
    if configured() {
        // Spans recorded under the previous configuration go out with the
        // resource they were recorded under.
        if let Some(s) = vm_state(global) {
            bun_telemetry::batch::flush_local(&mut s.local.borrow_mut().batch);
        }
        while p.pending_count() != 0 && p.exporter_count() != 0 {
            if !p.export() {
                break;
            }
        }
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
    if cfg.console_exporter {
        exporters.push(Arc::new(exporter::ConsoleExporter));
    }
    p.install_exporters(replace_owner, exporters);
    bun_telemetry::rt::install(bun_telemetry::rt::Hooks {
        active_span: |g| span::active_ptr(g),
        local: local_hook,
        after_record: |g| after_record(JSGlobalObject::opaque_ref(g.cast::<JSGlobalObject>())),
        release_cell: span::release_cell,
        sampler: || state().sampler,
        limits: || state().limits,
        capture_db_statement: || state().capture_db_statement,
        active_trace_state: |g, f| {
            span::with_active_trace_state(JSGlobalObject::opaque_ref(g.cast::<JSGlobalObject>()), f)
        },
    });
    bun_telemetry::set_enabled_mask(cfg.instruments, cfg.roots);
    bun_telemetry::set_shut_down(false);
    let _ = bun_jsc::virtual_machine::TELEMETRY_EXIT_HOOK.set(flush_at_exit);
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

pub use propagation::{format_traceparent, parse_traceparent};

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
/// `{ serviceName, resourceAttributes, endpoint, headers, exporters: [{url, headers, compression} | {export(spans), format, }],
///    sampler: number | "always_on" | …, instrumentations: { fetch: false, fs: "always" }, batch: { delayMs, maxQueue, maxBatch, timeoutMs },
///    captureDbStatement, propagators: ["tracecontext","baggage"] }`
#[bun_jsc::host_fn]
#[optimize(size)]
pub fn start(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let opts = frame.argument(0);
    let vm = global.bun_vm();
    let env = read_env_config(vm);
    if env.sdk_disabled {
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
            span::for_each_attribute(global, v, |k, val| {
                use bun_telemetry_cold::config::ResourceValue as R;
                let vs = match val {
                    bun_telemetry::Value::Str(s) => {
                        R::Str(bstr::ByteSlice::to_str_lossy(*s).into_owned())
                    }
                    bun_telemetry::Value::Int(i) => R::Int(*i),
                    bun_telemetry::Value::Double(d) => R::Double(*d),
                    bun_telemetry::Value::Bool(b) => R::Bool(*b),
                    _ => return,
                };
                let k = bstr::ByteSlice::to_str_lossy(k).into_owned();
                if k == "service.name" {
                    // an explicit serviceName wins (SDK: OTEL_SERVICE_NAME > resource attrs)
                    if !has_service_name {
                        cfg.service_name = Some(vs.to_string());
                    }
                } else {
                    cfg.resource_attributes.retain(|(ek, _)| *ek != k);
                    cfg.resource_attributes.push((k, vs));
                }
            })?;
        }
        // `endpoint` + `headers` is shorthand for one OTLP exporter.
        let endpoint = opt_str(global, opts, "endpoint")?;
        let explicit_exporters = opts.get(global, "exporters")?;
        if endpoint.is_some() || explicit_exporters.is_some() {
            cfg.otlp_exporters.clear();
            cfg.console_exporter = false;
            replaces_exporters = true;
        }
        if let Some(url) = endpoint {
            let mut x = OtlpExporterConfig::new(normalize_traces_url(&url));
            read_exporter_headers(global, opts, &mut x)?;
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
                let mut x = OtlpExporterConfig::new(normalize_traces_url(&url));
                read_exporter_extras(global, item, &mut x)?;
                cfg.otlp_exporters.push(x);
            }
        }
        if let Some(v) = opts.get(global, "sampler")? {
            // samplerArg falls back to OTEL_TRACES_SAMPLER_ARG like every other option.
            let arg = match opts.get(global, "samplerArg")? {
                Some(a) => Some(a),
                None => vm
                    .env_loader()
                    .get(b"OTEL_TRACES_SAMPLER_ARG")
                    .map(|v| bun_jsc::bun_string_jsc::create_utf8_for_js(global, v))
                    .transpose()?,
            };
            cfg.sampler = sampler_from_js(global, v, arg)?;
        }
        if let Some(v) = opts.get(global, "instrumentations")? {
            read_instrumentations(global, v, &mut cfg)?;
        }
        if let Some(b) = opts.get(global, "batch")? {
            if b.is_object() {
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
                    cfg.batch.max_queue_size = v.max(1);
                }
                if let Some(v) = b.get_optional_int::<u32>(global, "maxExportBatchSize")? {
                    cfg.batch.max_export_batch_size = v.max(1);
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
                        other => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "unknown propagator {:?} (expected \"tracecontext\" or \"baggage\")",
                                other.unwrap_or("")
                            )));
                        }
                    }
                }
            }
        }
        if let Some(l) = opts.get(global, "limits")? {
            if l.is_object() {
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
    }

    // (options are parsed; no user JS runs past this point)
    let configuring = CONFIGURE_LOCK.lock();
    // `Bun.otel.start()` with no exporter anywhere (options, env, bunfig, an
    // earlier start) behaves like BUN_OTEL=1: the local collector default.
    if !replaces_exporters
        && !configured()
        && !cfg.exporters_from_env
        && cfg.otlp_exporters.is_empty()
        && !cfg.console_exporter
        && js_exporters.is_empty()
    {
        cfg.otlp_exporters
            .push(OtlpExporterConfig::new(config::traces_endpoint(
                "http://localhost:4318",
            )));
    }
    // An explicit exporter list replaces whatever was configured before
    // (env or an earlier start()), so repeated start() calls don't fan out
    // to duplicate destinations.
    // Validate (construct) the new exporters before dropping the old ones, so
    // a bad URL leaves the previous pipeline intact.
    let otlp = match exporter::OtlpHttpExporter::from_configs(&cfg.otlp_exporters) {
        Ok(v) => v,
        Err(e) => {
            return Err(global.throw_invalid_arguments(format_args!("{}", bstr::BStr::new(&e))));
        }
    };
    let mut new_exporters: Vec<Arc<dyn bun_telemetry::processor::Exporter>> = Vec::new();
    if replaces_exporters || !configured() {
        new_exporters.extend(
            otlp.into_iter()
                .map(|e| e as Arc<dyn bun_telemetry::processor::Exporter>),
        );
    }
    let replace_owner = if replaces_exporters {
        if let Some(s) = vm_state(global) {
            exporter::JsExporter::detach_all_for_vm(s);
        }
        Some(core::ptr::from_ref(vm_state_or_init(global)) as usize)
    } else {
        if configured() {
            // No exporters given: keep the pipeline that env/bunfig/an earlier
            // start() already set up rather than adding the env-derived ones again.
            cfg.console_exporter = false;
        }
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

fn normalize_traces_url(url: &str) -> String {
    config::normalize_traces_url(url)
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
        return Ok(Sampler::ParentBasedTraceIdRatio(Sampler::ratio_threshold(
            ratio_of(v.as_number())?,
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
    Ok(Sampler::default())
}

#[optimize(size)]
fn read_instrumentations(
    global: &JSGlobalObject,
    v: JSValue,
    cfg: &mut bun_telemetry_cold::Config,
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
                cfg.instruments |= i.bit();
            } else {
                cfg.instruments &= !i.bit();
            }
        } else if let Some(s) = arg_string(global, val)? {
            match s.as_str() {
                "always" => {
                    cfg.instruments |= i.bit();
                    cfg.roots |= i.bit();
                }
                "nested" => {
                    cfg.instruments |= i.bit();
                    cfg.roots &= !i.bit();
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
    // Everything recorded so far goes out now (looping past the batch-size
    // cap); the promise resolves when those payloads — and anything older,
    // in flight or parked — have settled, not when the pipeline is idle.
    while processor().pending_count() != 0 && processor().exporter_count() != 0 {
        if !processor().export() {
            break;
        }
    }
    let target = processor().next_seq();
    processor().retry_older_than(target);
    if processor().oldest_outstanding().is_none_or(|o| o >= target) {
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
        processor().on_idle(
            s.idle_hook_key(),
            Box::new(move || {
                exporter::post_flush_wake(&handle);
            }),
        );
    }
    // A settlement may have already happened between the check and the hook.
    resolve_flush_waiters();
    Ok(value)
}

pub(crate) fn resolve_flush_waiters() {
    let Some(s) = current_vm_state() else { return };
    if s.flush_waiters.borrow().is_empty() {
        return;
    }
    // Payloads a flush is waiting on skip their backoff: a live collector gets
    // the retry now, a dead one exhausts its attempts quickly instead of
    // holding the flush (and process exit) for the whole backoff schedule.
    if let Some(newest) = s.flush_waiters.borrow().iter().map(|(t, _)| *t).max() {
        processor().retry_older_than(newest);
    }
    let oldest = processor().oldest_outstanding();
    let ready: Vec<bun_jsc::JSPromiseStrong> = {
        let mut waiters = s.flush_waiters.borrow_mut();
        let mut ready = Vec::new();
        let mut i = 0;
        while i < waiters.len() {
            if oldest.is_none_or(|o| o >= waiters[i].0) {
                ready.push(waiters.swap_remove(i).1);
            } else {
                i += 1;
            }
        }
        if waiters.is_empty() && !ready.is_empty() {
            s.flush_keep_alive.borrow_mut().unref(bun_io::js_vm_ctx());
        }
        ready
    };
    let global = s.global();
    for mut w in ready {
        let _ = w.resolve(global, JSValue::UNDEFINED);
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
#[optimize(size)]
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
        } else if r.is_undefined_or_null() {
            // `shutdown()`: beyond masking instrumentations, stop recording
            // and delivering altogether until a later start().
            bun_telemetry::set_shut_down(true);
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

/// `propagationFlags()` → bit 0: W3C trace context, bit 1: baggage.
#[bun_jsc::host_fn]
pub fn propagation_flags(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let st = state();
    Ok(JSValue::js_number_from_int32(
        (st.propagate_trace_context as i32) | ((st.propagate_baggage as i32) << 1),
    ))
}
