//! What each VM keeps, and when it hands its spans on.

use core::cell::{Cell, OnceCell, RefCell, RefMut};
use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;
use std::sync::Arc;

use bun_event_loop::EventLoopTimer::{OwnedTimer, State as TimerState, Tag as TimerTag};
use bun_event_loop::{BoxedTask, ContextId, TaskTag, task_tag};
use bun_jsc::virtual_machine::{TelemetryFlush as Flush, VirtualMachine};
use bun_jsc::{JSGlobalObject, JSPromiseStrong, JSValue, JsResult, LoopKind, Strong, VmHandle};
use bun_telemetry::{FlushTarget, Local, OwnerKey, Record, ScopeId, processor};

use crate::exporter::{
    JsExporter, OwnedJsExporter, QueuedExport, is_http_thread_stuck, wait_for_warnings,
};
use crate::{configure, engine};

/// The `createContextKey()` symbols that mean something to tracing.
pub(crate) struct ContextKeys {
    pub(crate) span: Strong,
    pub(crate) baggage: Strong,
    pub(crate) suppress_tracing: Strong,
}

/// What belongs to the VM's global object, which `bun test --isolate` replaces.
#[derive(Default)]
struct Realm {
    root_context: Option<Strong>,
    tracers: Vec<(ScopeId, Strong)>,
    is_registered_with_api: bool,
    has_called_start: bool,
}

pub struct VmState {
    vm: &'static VirtualMachine,
    local: RefCell<Local>,
    timer: OwnedTimer,
    has_recorded_since_timer: Cell<bool>,
    is_exiting: Cell<bool>,
    has_exited: Cell<bool>,
    keys: OnceCell<ContextKeys>,
    realm: RefCell<Option<Realm>>,
    pub(crate) js_exporters: RefCell<Vec<OwnedJsExporter>>,
    flush_waiters: RefCell<Vec<(FlushTarget, JSPromiseStrong)>>,
    /// While there are `flush_waiters`: an export on the HTTP thread holds no event loop open.
    flush_keep_alive: bun_io::JsKeepAlive,
    hears_of_settled_exports: Cell<bool>,
}

bun_event_loop::impl_timer_owner!(VmState; from_timer_ptr => timer);

impl VmState {
    #[inline]
    #[allow(clippy::cast_ptr_alignment, reason = "it points to a VmState")]
    pub(crate) fn existing(vm: &'static VirtualMachine) -> Option<&'static VmState> {
        let state: *const dyn core::any::Any = &**vm.rare_data.get()?.telemetry.get()?;
        // SAFETY: only `create` fills the cell, and the box lives as long as `vm`.
        Some(unsafe { &*state.cast::<VmState>() })
    }

    /// `None` once the VM has handed on its last spans.
    #[inline]
    pub(crate) fn get(global: &JSGlobalObject) -> Option<&'static VmState> {
        let vm = global.bun_vm();
        match Self::existing(vm) {
            Some(state) => (!state.has_exited.get()).then_some(state),
            None => Self::create(vm),
        }
    }

    #[cold]
    #[inline(never)]
    fn create(vm: &'static VirtualMachine) -> Option<&'static VmState> {
        // The debugger, whose URL is its password, macros and the like.
        let runs_the_program = vm.is_main_thread.get() || vm.worker_ref().is_some();
        if vm.is_shutting_down() || !runs_the_program {
            return None;
        }
        let mut seed = [0u64; 4];
        bun_boringssl_sys::rand_bytes(bun_core::cast_slice_mut(&mut seed));
        let _ = vm.rare_data().telemetry.set(Box::new(VmState {
            vm,
            local: RefCell::new(Local::new(seed)),
            timer: OwnedTimer::init_paused(TimerTag::TelemetryFlush),
            has_recorded_since_timer: Cell::new(false),
            is_exiting: Cell::new(false),
            has_exited: Cell::new(false),
            keys: OnceCell::new(),
            realm: RefCell::new(None),
            js_exporters: RefCell::default(),
            flush_waiters: RefCell::default(),
            flush_keep_alive: Default::default(),
            hears_of_settled_exports: Cell::new(false),
        }));
        // Another thread turned tracing on after this one started. The caller may be in no place to run script.
        if bun_telemetry::any_enabled() {
            VmTask::RegisterWithApi.post(&vm.handle());
        }
        Self::existing(vm)
    }

    pub(crate) fn global(&self) -> &'static JSGlobalObject {
        self.vm.global()
    }

    pub(crate) fn owner_key(&self) -> OwnerKey {
        OwnerKey::of(self)
    }

    /// Never held across JavaScript.
    #[inline]
    pub(crate) fn local(&self) -> RefMut<'_, Local> {
        self.local.borrow_mut()
    }

    /// Of this thread's VM, if it has started a span.
    #[inline]
    pub(crate) fn current() -> Option<&'static VmState> {
        (VirtualMachine::get_or_null().and_then(Self::existing)).filter(|s| !s.has_exited.get())
    }

    #[inline]
    pub(crate) fn take_record() -> Option<Box<Record>> {
        Some(Self::current()?.local().records.take())
    }

    pub(crate) fn keys(&self) -> &ContextKeys {
        self.keys.get_or_init(|| {
            let global = self.global();
            let key = |name| Strong::create(JSValue::symbol_for(global, name), global);
            ContextKeys {
                span: key(b"OpenTelemetry Context Key SPAN"),
                baggage: key(b"OpenTelemetry Baggage Key"),
                suppress_tracing: key(b"OpenTelemetry SDK Context Key SUPPRESS_TRACING"),
            }
        })
    }

    fn realm(&'static self) -> RefMut<'static, Realm> {
        RefMut::map(self.realm.borrow_mut(), |realm| {
            realm.get_or_insert_with(|| {
                if self.vm.test_isolation_enabled.get() {
                    self.vm.release_at_retirement(Box::new(|| {
                        if self
                            .realm
                            .take()
                            .is_some_and(|realm| realm.has_called_start)
                        {
                            configure::undo_start(self);
                        }
                        JsExporter::detach_all(self);
                        self.flush_waiters.take();
                        self.stop_waiting_for_exports();
                    }));
                }
                Realm::default()
            })
        })
    }

    fn is_of_realm(&self, global: &JSGlobalObject) -> bool {
        core::ptr::eq(global, self.global())
    }

    pub(crate) fn root_context(&'static self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if !self.is_of_realm(global) {
            return engine::root_context(global);
        }
        if let Some(root) = &self.realm().root_context {
            return Ok(root.get());
        }
        let root = engine::root_context(global)?;
        self.realm().root_context = Some(Strong::create(root, global));
        Ok(root)
    }

    pub(crate) fn tracer(
        &'static self,
        global: &JSGlobalObject,
        scope: ScopeId,
        create: impl FnOnce() -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        if !self.is_of_realm(global) {
            return create();
        }
        let tracers = &mut self.realm().tracers;
        if let Some((_, tracer)) = tracers.iter().find(|(known, _)| *known == scope) {
            return Ok(tracer.get());
        }
        let tracer = create()?;
        tracers.push((scope, Strong::create(tracer, global)));
        Ok(tracer)
    }

    pub(crate) fn did_call_start(&'static self, exporters: Vec<OwnedJsExporter>) {
        self.realm().has_called_start = true;
        self.js_exporters.borrow_mut().extend(exporters);
    }

    pub(crate) fn register_with_api(&'static self) -> JsResult<()> {
        if core::mem::replace(&mut self.realm().is_registered_with_api, true) {
            return Ok(());
        }
        engine::register_with_api(self.global())
    }

    #[inline]
    pub(crate) fn did_record(&self) {
        if !self.has_recorded_since_timer.replace(true) {
            self.arm_timer();
        }
    }

    pub(crate) fn arm_timer(&self) {
        if self.timer.state.get() == TimerState::ACTIVE || self.has_exited.get() {
            return;
        }
        let delay = processor::global().time_to_tick();
        self.timer.next.set(bun_core::Timespec::ms_from_now(
            bun_core::TimespecMockMode::ForceRealTime,
            delay.as_millis() as i64 + 1,
        ));
        // SAFETY: the timer is not linked, and `self` is boxed until it drops, which unlinks it.
        unsafe {
            self.vm
                .timer_insert(OwnedTimer::node(&raw const self.timer))
        };
    }

    /// The delay has changed.
    pub(crate) fn rearm_timer(&self) {
        if self.timer.state.get() == TimerState::ACTIVE {
            self.timer.disarm();
            self.arm_timer();
        }
    }

    /// An idle VM has no timer and keeps no buffers.
    pub fn on_timer(&self) {
        self.timer.state.set(TimerState::FIRED);
        let was_busy = self.has_recorded_since_timer.replace(false);
        let processor = processor::global();
        processor.tick();
        JsExporter::release_retired(self);
        if was_busy || processor.has_work() {
            self.arm_timer();
        } else {
            self.local().release_idle_memory();
            processor.release_idle_memory();
        }
    }

    /// A promise for the moment when every span that has ended by now is exported or given up on.
    pub(crate) fn force_flush(&'static self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let processor = processor::global();
        let target = processor.flush();
        let promise = JSPromiseStrong::init(global);
        let value = promise.value();
        self.flush_waiters.borrow_mut().push((target, promise));
        self.flush_keep_alive.ref_(bun_io::js_vm_ctx());
        if !self.hears_of_settled_exports.replace(true) {
            // Its retirement lets go of the promises.
            drop(self.realm());
            let vm = self.vm.handle();
            // A thread that is blocked gets no more than one.
            let is_posted = Arc::new(AtomicBool::new(false));
            let wake = move || {
                if !is_posted.swap(true, Ordering::AcqRel) {
                    VmTask::ResolveFlushWaiters(Arc::clone(&is_posted)).post(&vm);
                }
            };
            processor.on_settle(self.owner_key(), Box::new(wake));
        }
        // It enforces the export timeout.
        self.arm_timer();
        self.resolve_flush_waiters()?;
        Ok(value)
    }

    fn resolve_flush_waiters(&self) -> JsResult<()> {
        let Some(newest) = self.flush_waiters.borrow().iter().map(|w| w.0).max() else {
            return Ok(());
        };
        let processor = processor::global();
        processor.hurry_retries_before(newest);
        let ready: Vec<_> = (self.flush_waiters.borrow_mut())
            .extract_if(.., |w| processor.settled_before(w.0))
            .collect();
        if self.flush_waiters.borrow().is_empty() {
            self.stop_waiting_for_exports();
        }
        for (_, mut promise) in ready {
            promise.resolve(self.global(), JSValue::UNDEFINED)?;
        }
        Ok(())
    }

    fn stop_waiting_for_exports(&self) {
        self.flush_keep_alive.unref(bun_io::js_vm_ctx());
        if self.hears_of_settled_exports.replace(false) {
            processor::global().remove_settle_hooks(self.owner_key());
        }
    }

    fn exit(&self) {
        // An exporter may call `process.exit()`.
        if self.is_exiting.replace(true) {
            return;
        }
        let processor = processor::global();
        if self.vm.is_main_thread.get() {
            processor.close(&is_http_thread_stuck);
            wait_for_warnings();
        } else if !self.js_exporters.borrow().is_empty() {
            processor.flush_for_owner(self.owner_key());
        }
        JsExporter::detach_all(self);
        self.has_exited.set(true);
        self.timer.disarm();
        // The loop is freed before `self`.
        self.stop_waiting_for_exports();
        if processor.has_work()
            && !self.vm.is_main_thread.get()
            && let Some(main) = VirtualMachine::main_thread_handle()
        {
            VmTask::TakeOverTimer.post(&main);
        }
    }
}

pub enum VmTask {
    Export(QueuedExport),
    ResolveFlushWaiters(Arc<AtomicBool>),
    RegisterWithApi,
    /// From a worker that leaves retries and deadlines behind.
    TakeOverTimer,
}

impl BoxedTask for VmTask {
    const TAG: TaskTag = task_tag::Telemetry;
    fn release_unrun(self: Box<Self>) {}
    fn context(&self) -> ContextId {
        ContextId::NONE
    }
}

impl VmTask {
    /// Dropped if the VM is gone.
    pub(crate) fn post(self, vm: &VmHandle) {
        let _ = vm.post::<Self>(LoopKind::Regular, Box::new(self));
    }

    pub fn run(self) -> JsResult<()> {
        let Some(state) = VmState::get(VirtualMachine::get().global()) else {
            return Ok(());
        };
        match self {
            VmTask::Export(export) => export.run(state),
            VmTask::ResolveFlushWaiters(is_posted) => {
                is_posted.swap(false, Ordering::AcqRel);
                state.resolve_flush_waiters()
            }
            VmTask::RegisterWithApi => state.register_with_api(),
            VmTask::TakeOverTimer => {
                state.arm_timer();
                Ok(())
            }
        }
    }
}

pub fn flush(when: Flush) {
    if bun_telemetry::configured() {
        bun_removable_features::removable_body_behind_value!(Telemetry, { flush_configured(when) });
    }
}

fn flush_configured(when: Flush) {
    static HAS_MAIN_THREAD_EXITED: AtomicBool = AtomicBool::new(false);
    let vm = VirtualMachine::get_or_null();
    let state = vm.and_then(VmState::existing);
    match (when, state) {
        (Flush::WithoutExit, _) => {
            processor::global().flush_blocking(Duration::from_secs(1), &is_http_thread_stuck);
            wait_for_warnings();
        }
        (Flush::AtEndOfTestFile, Some(state)) if !state.js_exporters.borrow().is_empty() => {
            processor::global().flush_for_owner(state.owner_key());
        }
        (Flush::AtEndOfTestFile, _) => {}
        (Flush::AtExit, Some(state)) => state.exit(),
        // Only workers have traced.
        (Flush::AtExit, None) => {
            if vm.is_some_and(|vm| vm.is_main_thread.get())
                && !HAS_MAIN_THREAD_EXITED.swap(true, Ordering::Relaxed)
            {
                processor::global().close(&is_http_thread_stuck);
                wait_for_warnings();
            }
        }
    }
}
