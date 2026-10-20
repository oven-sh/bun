//! `TimerObjectInternals` — fields shared by `TimeoutObject` / `ImmediateObject`.
//!
//! Struct + `Flags` packed-u32 state machine. `run_immediate_task()` +
//! helpers (`event_loop_timer`/`ref_`/`deref_`/
//! `set_enable_keeping_event_loop_alive`/`run`) drive the
//! `__bun_run_immediate_task` dispatch path. `fire()` + `reschedule()`/
//! `should_reschedule_timer()`/`convert_to_interval()` drive the
//! `FIRE_TIMER` dispatch path (Timeout/Immediate arms). `init()` backs the
//! `TimeoutObject::init` / `ImmediateObject::init` constructors.

use bun_core::{Timespec, TimespecMockMode};

use crate::generated_bindgen::timer::{ImmediateInternalFields as _, TimeoutInternalFields as _};
use crate::jsc::bindgen::{JsHeap, JsLocal, JsScope, JsWrapper};
use crate::jsc::{Debugger, JSGlobalObject, JSObject, JSValue, ScriptExecutionStatus};
use bun_ptr::RefPtr;
use core::cell::Cell;
// Note: `bun_jsc::VirtualMachine` is a *module* alias; the struct lives at
// `virtual_machine::VirtualMachine`.
use crate::jsc::virtual_machine::VirtualMachine;

use super::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, ID, ImmediateObject, Kind, KindBig,
    TimeoutObject,
};

/// Data that TimerObject and ImmediateObject have in common.
#[repr(C)]
pub(crate) struct TimerObjectInternals {
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`).
    pub(crate) id: i32,
    pub(crate) interval: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
    /// The context whose script created the timer.
    pub(crate) context: bun_jsc::ContextId,
    /// `VirtualMachine::test_isolation_generation` when it did.
    pub(crate) generation: u32,
}

impl TimerObjectInternals {
    /// Read-modify-write `self.flags` through the `Cell` (R-2: `flags` is
    /// `Cell<Flags>` so the write is interior-mutable, callable from
    /// `&self` host-fns that re-enter JS).
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut fl = self.flags.get();
        f(&mut fl);
        self.flags.set(fl);
    }
}

// LAYERING: `Flags` (the packed-u32 state machine) was MOVED DOWN to
// `bun_event_loop::EventLoopTimer::TimerFlags` so `bun_jsc::abort_signal::Timeout`
// can name it without a forward dep on this crate. Re-exported here so existing
// `TimerObjectInternals`/`All::update` callers see the same nominal type.
pub(crate) use bun_event_loop::EventLoopTimer::TimerFlags as Flags;

// ──────────────────────────────────────────────────────────────────────────
// `runImmediateTask` path for `__bun_run_immediate_task` (dispatch.rs).
// ──────────────────────────────────────────────────────────────────────────

// C++ symbol emitted from ImmediateList.cpp / setTimeout.cpp; already linked.
unsafe extern "C" {
    safe fn Bun__JSTimeout__call(
        global_object: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
    ) -> bool;
}

/// Typed result of `@fieldParentPtr("internals", self)` discriminated by
/// `flags.kind()`. Raw `*mut` (NOT `&mut`) so callers may hold it across
/// re-entrant JS calls without minting an aliased `&mut` (PORTING.md
/// §Forbidden — the callback can reach the same field via `cancel()`/
/// `refresh()`). Provenance is `&self`-derived (read-only); the `*mut` is a
/// type-only cast — writes must go through `Cell`/`UnsafeCell` fields.
enum TimerParent {
    Immediate(*mut ImmediateObject),
    Timeout(*mut TimeoutObject),
}

/// The JS object of a timer.
#[derive(Clone, Copy)]
pub(crate) enum TimerWrapper<'a> {
    Immediate(JsWrapper<'a, RefPtr<ImmediateObject>>),
    Timeout(JsWrapper<'a, RefPtr<TimeoutObject>>),
}

impl<'a> From<JsWrapper<'a, RefPtr<ImmediateObject>>> for TimerWrapper<'a> {
    fn from(wrapper: JsWrapper<'a, RefPtr<ImmediateObject>>) -> Self {
        Self::Immediate(wrapper)
    }
}

impl<'a> From<JsWrapper<'a, RefPtr<TimeoutObject>>> for TimerWrapper<'a> {
    fn from(wrapper: JsWrapper<'a, RefPtr<TimeoutObject>>) -> Self {
        Self::Timeout(wrapper)
    }
}

impl<'a> TimerWrapper<'a> {
    fn as_value(self) -> JsLocal<'a, JSObject> {
        match self {
            Self::Immediate(wrapper) => wrapper.as_value(),
            Self::Timeout(wrapper) => wrapper.as_value(),
        }
    }

    fn callback_field(self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        match self {
            Self::Immediate(wrapper) => wrapper.callback_field(heap),
            Self::Timeout(wrapper) => wrapper.callback_field(heap),
        }
    }

    fn arguments_field(self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        match self {
            Self::Immediate(wrapper) => wrapper.arguments_field(heap),
            Self::Timeout(wrapper) => wrapper.arguments_field(heap),
        }
    }
}

impl TimerObjectInternals {
    /// `@fieldParentPtr("internals", self)` — the single `container_of` site.
    /// Every other helper (`event_loop_timer`, `ref_`, `deref`, `this_wrapper`,
    /// `event_loop_timer_state`) routes through this so the `from_field_ptr!`
    /// invariant — `flags.kind()` ⇔ container type, established in `init()` —
    /// lives in exactly one place.
    #[inline]
    fn parent_ptr(&self) -> TimerParent {
        bun_core::assert_not_freeze!(TimerObjectInternals, TimerParent);
        let this = std::ptr::from_ref::<Self>(self).cast_mut();
        match self.flags.get().kind() {
            // SAFETY: `kind == SetImmediate` ⇒ `self` is the `internals` field
            // of a live `ImmediateObject` (set in `init()`).
            Kind::SetImmediate => TimerParent::Immediate(unsafe {
                bun_core::from_field_ptr!(ImmediateObject, internals, this)
            }),
            // SAFETY: `kind ∈ {SetTimeout, SetInterval}` ⇒ `self` is the
            // `internals` field of a live `TimeoutObject`.
            Kind::SetTimeout | Kind::SetInterval => TimerParent::Timeout(unsafe {
                bun_core::from_field_ptr!(TimeoutObject, internals, this)
            }),
        }
    }

    /// `@fieldParentPtr("internals", self).event_loop_timer`. Returns a raw
    /// pointer (NOT `&mut`) so callers can hold it across re-entrant JS calls
    /// without minting aliased `&mut` (PORTING.md §Forbidden — the callback
    /// may reach this same field via `cancel()`/`refresh()`).
    fn event_loop_timer(&self) -> *mut EventLoopTimer {
        match self.parent_ptr() {
            // SAFETY: `p` points into a live container per `parent_ptr()`.
            TimerParent::Immediate(p) => unsafe { core::ptr::addr_of_mut!((*p).event_loop_timer) },
            // SAFETY: as above.
            TimerParent::Timeout(p) => unsafe { core::ptr::addr_of_mut!((*p).event_loop_timer) },
        }
    }

    /// `None`: collected.
    fn this_wrapper<'a>(&self, heap: &JsHeap<'a>) -> Option<TimerWrapper<'a>> {
        match self.parent_ptr() {
            // SAFETY: `p` is a live container per `parent_ptr()`.
            TimerParent::Immediate(p) => unsafe { (*p).this_value.get() }
                .get(heap)
                .map(TimerWrapper::Immediate),
            // SAFETY: as above.
            TimerParent::Timeout(p) => unsafe { (*p).this_value.get() }
                .get(heap)
                .map(TimerWrapper::Timeout),
        }
    }

    /// Lets the GC collect the JS object.
    fn downgrade_this_value(&self) {
        match self.parent_ptr() {
            // SAFETY: `p` is a live container per `parent_ptr()`.
            TimerParent::Immediate(p) => unsafe { (*p).this_value.with_mut(|r| r.downgrade()) },
            // SAFETY: as above.
            TimerParent::Timeout(p) => unsafe { (*p).this_value.with_mut(|r| r.downgrade()) },
        }
    }

    /// Increment the parent container's intrusive refcount.
    fn ref_(&self) {
        match self.parent_ptr() {
            // SAFETY: `p` is a live container per `parent_ptr()`.
            TimerParent::Immediate(p) => unsafe { ImmediateObject::ref_(p) },
            // SAFETY: as above.
            TimerParent::Timeout(p) => unsafe { TimeoutObject::ref_(p) },
        }
    }

    /// Release a `TimeoutObject`/`ImmediateObject` that was unlinked from a
    /// timer heap by something other than [`Self::cancel`] (e.g.
    /// `FakeTimers::clear`'s `delete_min` drain). Downgrades the `Strong` JS
    /// pin and releases the `+1` taken by `reschedule()`, so GC can collect
    /// the wrapper and the box frees on the final deref.
    ///
    /// `cancel()` skips its own `remove`/`deref` because `state` is already
    /// `CANCELLED`, which is why the explicit `deref` follows.
    ///
    /// `vm` is the live per-thread VM; no borrow of `All` may be live across
    /// this call (`cancel()` reaches `All::remove`, which forms its own
    /// `&mut All`).
    pub(crate) fn release_heap_pin(this: core::ptr::NonNull<Self>, vm: *mut VirtualMachine) {
        // SAFETY: caller guarantees the parent box is live (refcount ≥ 1).
        let internals = unsafe { this.as_ref() };
        internals.cancel(vm);
        internals.deref();
    }

    /// Decrement the parent container's intrusive refcount; frees on 0.
    /// After this returns, `self` may be dangling — do not touch.
    fn deref(&self) {
        match self.parent_ptr() {
            // SAFETY: `p` is a live container per `parent_ptr()`.
            TimerParent::Immediate(p) => unsafe { ImmediateObject::deref(p) },
            // SAFETY: as above.
            TimerParent::Timeout(p) => unsafe { TimeoutObject::deref(p) },
        }
    }

    #[inline]
    pub(crate) fn async_id(&self) -> u64 {
        ID {
            id: self.id,
            kind: self.flags.get().kind().into(),
        }
        .async_id()
    }

    /// Note (jsc/runtime crate cycle): the low-tier
    /// `bun_jsc::VirtualMachine.timer` is `()`,
    /// so resolve `Timer::All` via the per-thread `RuntimeState` instead.
    fn set_enable_keeping_event_loop_alive(&self, vm: *mut VirtualMachine, enable: bool) {
        if self.flags.get().is_keeping_event_loop_alive() == enable {
            return;
        }
        self.update_flags(|f| f.set_is_keeping_event_loop_alive(enable));

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `vm` is the live per-thread VM (hook contract); field read only.
        let uws_loop = unsafe { (*vm).uws_loop() };
        let delta = if enable { 1 } else { -1 };
        match self.flags.get().kind() {
            // SAFETY: `state` points at the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer`.
            Kind::SetTimeout | Kind::SetInterval => unsafe {
                (*state).timer.increment_timer_ref(delta, uws_loop)
            },
            // setImmediate has slightly different event loop logic
            // SAFETY: as above.
            Kind::SetImmediate => unsafe {
                (*state).timer.increment_immediate_ref(delta, uws_loop)
            },
        }
    }

    /// Invoke the JS callback via the
    /// C++ `Bun__JSTimeout__call` thunk (which handles exceptions internally).
    /// Returns `true` if an exception was thrown.
    ///
    /// Note (noalias re-entrancy): takes `*mut Self`, NOT `&mut self`.
    /// The JS callback can re-enter `cancel()`/`do_refresh()` on this same
    /// object via a fresh `&mut Self` derived from the JS wrapper's `m_ptr`.
    /// With `&mut self` here, LLVM's `noalias` lets it keep `self.flags` in a
    /// register across the FFI call, so `set_in_callback(false)`'s RMW
    /// clobbers the `has_cleared_timer` bit that `cancel()` set — the interval
    /// re-fires forever. A raw pointer carries no aliasing guarantee, so use
    /// one here.
    ///
    /// # Safety
    /// `this` points at a live `TimerObjectInternals` embedded in its parent
    /// container, pinned for the duration of the call by the caller's `ref_()`.
    /// Both callers (`fire`, `run_immediate_task`) also take `*mut Self`, so
    /// no `noalias` `&mut Self` is live anywhere in the call chain across
    /// `Bun__JSTimeout__call` — inlining is safe.
    unsafe fn run<'a>(
        this: *mut Self,
        cx: &mut JsScope<'a>,
        timer: TimerWrapper<'a>,
        callback: JsLocal<'a>,
        arguments: JsLocal<'a>,
        async_id: u64,
        vm: *mut VirtualMachine,
    ) -> bool {
        // SAFETY: `this` live per fn contract; pinned by caller's `ref_()`.
        // `&Self` (NOT `&mut`) — fields are `Cell`/`JsCell` so re-entrant JS
        // touching this object via another `&Self` is sound (no `noalias`).
        let s = unsafe { &*this };
        let global = cx.global();
        // SAFETY: `vm` is the live per-thread VM (hook contract).
        if unsafe { (*vm).is_inspector_enabled() } {
            Debugger::will_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        // Bun__JSTimeout__call handles exceptions.
        // `Cell<Flags>` RMW so the `in_callback` write reaches memory before JS
        // runs (re-entrant `_destroyed` getter reads it via a different pointer).
        s.update_flags(|f| f.set_in_callback(true));
        let result = Bun__JSTimeout__call(
            global,
            timer.as_value().to_js(),
            callback.to_js(),
            arguments.to_js(),
        );
        // No early returns between the `in_callback` set and this clear.
        // `Cell<Flags>` RMW: must reload `flags` from memory — re-entrant
        // `cancel()` may have set `has_cleared_timer` / cleared
        // `is_keeping_event_loop_alive`.
        s.update_flags(|f| f.set_in_callback(false));

        // SAFETY: as above.
        if unsafe { (*vm).is_inspector_enabled() } {
            Debugger::did_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        result
    }

    /// Note (jsc/runtime crate cycle): `vm.timer.epoch` resolved via `runtime_state()`
    /// (low-tier `VirtualMachine.timer` is `()`).
    pub(crate) fn new(cx: &bun_jsc::JsThread<'_>, id: i32, kind: Kind, interval: u32) -> Self {
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        Self {
            id,
            flags: {
                let mut f = Flags::default();
                f.set_kind(kind);
                // SAFETY: `state` is the boxed per-thread `RuntimeState`.
                f.set_epoch(unsafe { (*state).timer.epoch });
                Cell::new(f)
            },
            interval: Cell::new(interval),
            context: cx.context().id(),
            generation: cx.vm().test_isolation_generation,
        }
    }

    /// Fills `timer` and schedules it. `self` is the `internals` of what `timer` wraps.
    pub(crate) fn init<'a>(
        &self,
        scope: &JsScope<'a>,
        timer: TimerWrapper<'a>,
        cx: &bun_jsc::JsThread<'_>,
        callback: JsLocal<'a>,
        arguments: JsLocal<'a>,
    ) {
        let heap = &scope.heap;
        let vm = VirtualMachine::get_mut_ptr();

        // Only a graph's context keeps a list of its timers.
        // SAFETY: `vm` is the live per-thread VM.
        if let Some(context) = unsafe { (*vm).as_graph_context(cx.context()) } {
            context.track_timer(
                core::ptr::from_ref(self).cast_mut().cast(),
                bun_jsc::ContextTimer::Object,
            );
        }

        match timer {
            TimerWrapper::Immediate(timer) => {
                timer.set_arguments_field(heap, arguments);
                timer.set_callback_field(heap, callback);
                let parent = timer.with(&scope.payloads, RefPtr::as_ptr);
                // SAFETY: `vm` is the live per-thread VM. Low tier stores `*mut ()`
                // (PORTING.md §Dispatch); `__bun_run_immediate_task` casts it back
                // to `*mut ImmediateObject`.
                unsafe { (*vm).enqueue_immediate_task(parent.cast()) };
                self.set_enable_keeping_event_loop_alive(vm, true);
                // ref'd by event loop
                self.ref_();
            }
            TimerWrapper::Timeout(timer) => {
                let interval =
                    JsLocal::new(heap, JSValue::js_number(f64::from(self.interval.get())));
                timer.set_arguments_field(heap, arguments);
                timer.set_callback_field(heap, callback);
                timer.set_idle_timeout_field(heap, interval);
                timer.set_repeat_field(
                    heap,
                    if self.flags.get().kind() == Kind::SetInterval {
                        interval
                    } else {
                        JsLocal::new(heap, JSValue::NULL)
                    },
                );

                // this increments the refcount and sets _idleStart
                self.reschedule(heap, timer, vm);
            }
        }
    }

    /// Returns `true` if an
    /// exception was thrown.
    ///
    /// Note (noalias re-entrancy): takes `*mut Self`, NOT `&mut self`.
    /// `Self::run` re-enters JS which can `cancel()`/`do_refresh()` this same
    /// object via the JS wrapper's `m_ptr`. With `&mut self` LLVM may cache
    /// `self.flags`/`event_loop_timer().state` across the call and clobber the
    /// re-entrant write (see `run()` doc). Use a raw
    /// pointer; helper calls `(*this).foo()` materialise short-lived `&mut`
    /// scoped to each statement only — none span the JS call.
    ///
    /// Also takes `*mut VirtualMachine` (NOT `&mut`) — the body calls
    /// `vm.event_loop().enter()` then re-enters JS which may itself touch the
    /// VM/EventLoop; aliased `&mut` would be UB.
    ///
    /// # Safety
    /// `this` points at a live `TimerObjectInternals` embedded in its
    /// `ImmediateObject` parent (FIRE_TIMER hook contract); `vm` is the live
    /// per-thread VM.
    pub(crate) unsafe fn run_immediate_task(this: *mut Self, vm: *mut VirtualMachine) -> bool {
        // SAFETY: the event loop runs an immediate on the JS thread, with no other scope in use.
        unsafe {
            JsScope::with((*vm).global, |cx| {
                Self::run_immediate_task_with_scope(this, vm, cx)
            })
        }
    }

    /// # Safety: as [`Self::run_immediate_task`].
    unsafe fn run_immediate_task_with_scope(
        this: *mut Self,
        vm: *mut VirtualMachine,
        cx: &mut JsScope<'_>,
    ) -> bool {
        // SAFETY: per fn contract — `this` live. `&Self` (NOT `&mut`) — fields
        // are `Cell`/`JsCell` so re-entrant JS touching this object via another
        // `&Self` is sound (no `noalias`). Last use of `s` is the final
        // `s.deref()` below; `*this` may be freed only after that point.
        let s = unsafe { &*this };
        let cleared = s.flags.get().has_cleared_timer()
            // The VM's stop was requested: nothing more enters script (as `fire`).
            // SAFETY: `vm` is the live per-thread VM (hook contract).
            || unsafe { (*vm).script_execution_status() } != ScriptExecutionStatus::Running
            // SAFETY: as above.
            || unsafe { (*vm).has_outlived_its_script(s.context, s.generation) }
            // unref'd setImmediate callbacks should only run if there are things
            // keeping the event loop alive other than setImmediates
            || (!s.flags.get().is_keeping_event_loop_alive()
                // SAFETY: `vm` live per hook contract.
                && !unsafe { (*vm).is_event_loop_alive_excluding_immediates() });
        if cleared {
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.downgrade_this_value();
            s.deref();
            return false;
        }

        let Some(timer) = s.this_wrapper(&cx.heap) else {
            #[cfg(debug_assertions)]
            panic!("TimerObjectInternals.runImmediateTask: this_object is null");
            #[cfg(not(debug_assertions))]
            {
                s.set_enable_keeping_event_loop_alive(vm, false);
                s.deref();
                return false;
            }
        };
        s.downgrade_this_value();
        s.set_event_loop_timer_state(EventLoopTimerState::FIRED);
        s.set_enable_keeping_event_loop_alive(vm, false);
        timer.as_value().to_js().ensure_still_alive();

        // SAFETY: `vm` is live; `event_loop()` returns `*mut` to the embedded
        // EventLoop. Re-entrancy is permitted by the raw-ptr contract above.
        unsafe { (*(*vm).event_loop()).enter() };
        let callback = timer.callback_field(&cx.heap);
        let arguments = timer.arguments_field(&cx.heap);

        let exception_thrown = {
            s.ref_();
            let async_id = s.async_id();
            // SAFETY: `this` is the live `internals` per fn contract; `ref_()`
            // above pins the parent across re-entrancy.
            let result = unsafe { Self::run(this, cx, timer, callback, arguments, async_id, vm) };
            // `Self::run` has no early return so the deref ordering below is
            // preserved. After the second `deref()` `*this` may be
            // freed; do not touch it past this block.
            // Fresh read: re-entrant `cancel()`/`refresh()` may have changed
            // `state` (`ref_()` above pins the parent).
            if s.event_loop_timer_state() == EventLoopTimerState::FIRED {
                s.deref();
            }
            s.deref();
            result
        };
        // --- after this point, the timer is no longer guaranteed to be alive ---

        // SAFETY: `vm` is live; see `enter()` note above.
        if unsafe { (*(*vm).event_loop()).exit_maybe_drain_microtasks(!exception_thrown) }.is_err()
        {
            return true;
        }

        exception_thrown
    }

    /// # Safety
    /// `this` must be the live `internals` of a queued `ImmediateObject`.
    pub(crate) unsafe fn cancel_pending_immediate(this: *mut Self, vm: *mut VirtualMachine) {
        // SAFETY: per fn contract.
        let s = unsafe { &*this };
        s.set_enable_keeping_event_loop_alive(vm, false);
        s.downgrade_this_value();
        s.deref();
    }

    /// `EventLoopTimer.fire` dispatch
    /// arm body for `Tag::TimeoutObject`/`Tag::ImmediateObject`. Pops the JS
    /// timer, invokes its callback via `run()`, then either reschedules
    /// (setInterval / `t._repeat`) or releases the heap ref.
    ///
    /// Note: takes `*mut VirtualMachine` (NOT `&mut`) — the body calls
    /// `vm.event_loop().enter()` then re-enters JS which may itself touch the
    /// VM/EventLoop (and `(*runtime_state()).timer` via `cancel()`/`refresh()`);
    /// aliased `&mut` would be UB. Dereference per-use under `// SAFETY:`.
    ///
    /// Note (noalias re-entrancy): takes `*mut Self`, NOT `&mut self`.
    /// `Self::run` re-enters JS which can `cancel()`/`do_refresh()` this same
    /// object via the JS wrapper's `m_ptr`. With `&mut self` LLVM may cache
    /// `self.flags`/`event_loop_timer().state` across the call and dead-store
    /// the post-call reloads in `should_reschedule_timer`/`is_timer_done` —
    /// the interval re-fires forever. Use a raw pointer;
    /// helper calls `(*this).foo()` materialise short-lived `&mut` scoped to
    /// each statement only — none span the JS call.
    ///
    /// Note (jsc/runtime crate cycle): `vm.timer` resolved via
    /// `crate::jsc_hooks::runtime_state()` — low-tier `VirtualMachine.timer`
    /// is `()` (see `set_enable_keeping_event_loop_alive`).
    ///
    /// # Safety
    /// `this` points at a live `TimerObjectInternals` embedded in its
    /// `TimeoutObject`/`ImmediateObject` parent (FIRE_TIMER hook contract);
    /// `vm` is the live per-thread VM.
    pub(crate) unsafe fn fire(this: *mut Self, _now: &ElTimespec, vm: *mut VirtualMachine) {
        // SAFETY: the event loop runs a timer on the JS thread, with no other scope in use.
        unsafe { JsScope::with((*vm).global, |cx| Self::fire_with_scope(this, vm, cx)) }
    }

    /// # Safety: as [`Self::fire`].
    unsafe fn fire_with_scope(this: *mut Self, vm: *mut VirtualMachine, cx: &mut JsScope<'_>) {
        // SAFETY: per fn contract — `this` live. `&Self` (NOT `&mut`) — fields
        // are `Cell`/`JsCell` so re-entrant JS touching this object via another
        // `&Self` is sound (no `noalias`; LLVM cannot cache `Cell` reads across
        // `Self::run`). Last use of `s` is the final `s.deref()` at the end of
        // the pinned block; `*this` may be freed only after that point.
        let s = unsafe { &*this };
        let id = s.id;
        let kind: KindBig = s.flags.get().kind().into();
        let async_id = ID { id, kind };
        let has_been_cleared = s.event_loop_timer_state() == EventLoopTimerState::CANCELLED
            || s.flags.get().has_cleared_timer()
            // SAFETY: `vm` is the live per-thread VM (hook contract).
            || unsafe { (*vm).script_execution_status() } != ScriptExecutionStatus::Running
            // SAFETY: `vm` live per hook contract.
            || unsafe { (*vm).has_outlived_its_script(s.context, s.generation) };

        s.set_event_loop_timer_state(EventLoopTimerState::FIRED);

        let Some(this_object) = s.this_wrapper(&cx.heap) else {
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.downgrade_this_value();
            s.deref();
            return;
        };

        let callback = this_object.callback_field(&cx.heap);
        let arguments = this_object.arguments_field(&cx.heap);

        if has_been_cleared || !callback.to_js().to_boolean() {
            // SAFETY: `vm` live per hook contract.
            if unsafe { (*vm).is_inspector_enabled() } {
                Debugger::did_cancel_async_call(
                    cx.global(),
                    Debugger::AsyncCallType::DOMTimer,
                    async_id.async_id(),
                );
            }
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.downgrade_this_value();
            s.deref();
            return;
        }

        // Only read on the .setInterval path where it is written below.
        let mut time_before_call = Timespec::EPOCH;

        if kind != KindBig::SetInterval {
            s.downgrade_this_value();
        } else {
            time_before_call = Timespec::ms_from_now(
                TimespecMockMode::AllowMockedTime,
                i64::from(s.interval.get()),
            );
        }
        this_object.as_value().to_js().ensure_still_alive();

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        // SAFETY: `vm` is live; `event_loop()` returns `*mut` to the embedded
        // EventLoop. Re-entrancy is permitted by the raw-ptr contract above.
        unsafe { (*(*vm).event_loop()).enter() };
        {
            // Ensure it stays alive for this scope.
            s.ref_();
            // The matching `deref()` is at the end of this
            // block. Every path through the labelled-block + `is_timer_done`
            // tail reaches it (no `return` between here and the deref).

            // SAFETY: `this` is the live `internals` per fn contract; `ref_()`
            // above pins the parent across re-entrancy.
            let _ = unsafe {
                Self::run(
                    this,
                    cx,
                    this_object,
                    callback,
                    arguments,
                    async_id.async_id(),
                    vm,
                )
            };

            let (idle_timeout, repeat) = match this_object {
                TimerWrapper::Timeout(timer) => (
                    timer.idle_timeout_field(&cx.heap).to_js(),
                    timer.repeat_field(&cx.heap).to_js(),
                ),
                TimerWrapper::Immediate(_) => (JSValue::UNDEFINED, JSValue::UNDEFINED),
            };

            // Every `s.flags.get()` below is a fresh `Cell` read — re-entrant
            // `cancel()`/`refresh()` writes during `Self::run` above are
            // observed (no `noalias` on `Cell` contents).
            let is_timer_done = 'is_timer_done: {
                // Node doesn't drain microtasks after each timer callback.
                if kind == KindBig::SetInterval {
                    if !s.should_reschedule_timer(repeat, idle_timeout) {
                        break 'is_timer_done true;
                    }
                    // `ref_()` above pins the parent across the deref.
                    match s.event_loop_timer_state() {
                        EventLoopTimerState::FIRED => {
                            // If we didn't clear the setInterval, reschedule it starting from
                            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
                            // single-threaded JS heap so no concurrent `&mut` to
                            // `.timer`. `event_loop_timer()` derives a fresh raw
                            // ptr (no `&mut` aliasing across `update`).
                            unsafe {
                                (*state)
                                    .timer
                                    .update(s.event_loop_timer(), &time_before_call)
                            };

                            if s.flags.get().has_js_ref() {
                                s.set_enable_keeping_event_loop_alive(vm, true);
                            }

                            // The ref count doesn't change. It wasn't decremented.
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback.
                            // SAFETY: as above.
                            unsafe {
                                (*state)
                                    .timer
                                    .update(s.event_loop_timer(), &time_before_call)
                            };

                            // Balance out the ref count.
                            // the transition from "FIRED" -> "ACTIVE" caused it to increment.
                            s.deref();
                        }
                        _ => {
                            break 'is_timer_done true;
                        }
                    }
                } else {
                    if let TimerWrapper::Timeout(timer) = this_object
                        && !repeat.is_null()
                    {
                        if let Some(num) = idle_timeout.get_number() {
                            if num != -1.0 {
                                // reschedule() inside convertToInterval will see state == .FIRED
                                // and add a ref; fall through to the switch below so the .ACTIVE
                                // arm can balance it.
                                timer.with(&cx.payloads, |timeout| {
                                    Self::convert_to_interval(timeout, &cx.heap, timer, vm)
                                });
                            }
                        }
                    }

                    // `ref_()` above pins the parent across the deref.
                    match s.event_loop_timer_state() {
                        EventLoopTimerState::FIRED => {
                            break 'is_timer_done true;
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback,
                            // or the timer was converted to an interval via t._repeat. Balance out
                            // the ref count: the transition from "FIRED" -> "ACTIVE" via
                            // reschedule() caused it to increment.
                            s.deref();
                        }
                        _ => {
                            // The developer called clearTimeout() synchronously in the callback.
                            // cancel() saw state == .FIRED and skipped its deref, so release the
                            // heap ref here.
                            break 'is_timer_done true;
                        }
                    }
                }

                break 'is_timer_done false;
            };

            if is_timer_done {
                s.set_enable_keeping_event_loop_alive(vm, false);
                // The timer will not be re-entered into the event loop at this point.
                s.deref();
            }

            // End of pinned scope. After
            // this `*this` may be freed; do not touch past this block.
            s.deref();
        }
        // --- after this point, the timer is no longer guaranteed to be alive ---

        // SAFETY: `vm` is live; see `enter()` note above.
        unsafe { (*(*vm).event_loop()).exit() };
    }

    /// A `setTimeout` whose
    /// `t._repeat` was assigned promotes itself to a `setInterval` after its
    /// first fire (Node `lib/internal/timers.js:613`).
    ///
    /// Note: takes `vm` explicitly instead of `global.bun_vm()` so the
    /// raw-ptr contract from `fire()` is preserved (no fresh `&mut VM`).
    fn convert_to_interval<'a>(
        timeout: &TimeoutObject,
        heap: &JsHeap<'a>,
        timer: JsWrapper<'a, RefPtr<TimeoutObject>>,
        vm: *mut VirtualMachine,
    ) {
        let this = &timeout.internals;
        debug_assert!(this.flags.get().kind() == Kind::SetTimeout);

        let repeat = timer.repeat_field(heap);
        let new_interval: u32 = if let Some(num) = repeat.to_js().get_number() {
            if num < 1.0 || num > f64::from(u32::MAX >> 1) {
                1
            } else {
                num as u32
            }
        } else {
            1
        };

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L613
        timer.set_idle_timeout_field(heap, repeat);
        timeout.this_value.with_mut(|r| r.set_strong(heap, timer));
        this.update_flags(|f| f.set_kind(Kind::SetInterval));
        this.interval.set(new_interval);
        this.reschedule(heap, timer, vm);
    }

    fn should_reschedule_timer(&self, repeat: JSValue, idle_timeout: JSValue) -> bool {
        if self.flags.get().kind() == Kind::SetInterval && repeat.is_null() {
            return false;
        }
        if let Some(num) = idle_timeout.get_number() {
            if num == -1.0 {
                return false;
            }
        }
        true
    }

    /// Re-insert the parent's
    /// `EventLoopTimer` into the heap at `now + interval`. Called from
    /// `init()`, `do_refresh()`, and `convert_to_interval()` above.
    ///
    /// Note (jsc/runtime crate cycle): `vm.timer` resolved via `runtime_state()`.
    pub(crate) fn reschedule<'a>(
        &self,
        heap: &JsHeap<'a>,
        timer: JsWrapper<'a, RefPtr<TimeoutObject>>,
        vm: *mut VirtualMachine,
    ) {
        if self.flags.get().kind() == Kind::SetImmediate {
            return;
        }

        let idle_timeout = timer.idle_timeout_field(heap).to_js();
        let repeat = timer.repeat_field(heap).to_js();

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if !self.should_reschedule_timer(repeat, idle_timeout) {
            return;
        }

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        let now = Timespec::now(TimespecMockMode::AllowMockedTime);
        // Only `Bun.sleep()` has an `interval` below 1.
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; field read only.
        let min_delay = unsafe { (*state).timer.fake_timers.min_delay_ms() };
        let scheduled_time = now.add_ms(i64::from(self.interval.get().max(min_delay)));
        let was_active = self.event_loop_timer_state() == EventLoopTimerState::ACTIVE;
        if was_active {
            // SAFETY: `state` is the boxed per-thread `RuntimeState`; fresh
            // `&mut` to `.timer` for this call only.
            unsafe { (*state).timer.remove(self.event_loop_timer()) };
        } else {
            self.ref_();
        }

        // SAFETY: as above — `event_loop_timer()` derives a fresh raw ptr (no
        // `&mut` aliasing across `update`).
        unsafe {
            (*state)
                .timer
                .update(self.event_loop_timer(), &scheduled_time)
        };
        self.update_flags(|f| f.set_has_cleared_timer(false));

        // Set _idleStart to the current monotonic timestamp in milliseconds
        // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
        timer.set_idle_start_field(
            heap,
            JsLocal::new(heap, JSValue::js_number(now.ms_unsigned() as f64)),
        );

        if self.flags.get().has_js_ref() {
            self.set_enable_keeping_event_loop_alive(vm, true);
        }
    }

    /// Final teardown, invoked from the parent container's `Drop` (count hit
    /// zero). Unlinks the parent from every `Timer::All` data structure it may
    /// still be reachable from so the free cannot leave a dangling
    /// `*mut EventLoopTimer` in the heap or a leaked keep-alive count.
    /// `this_value` is released by `JsRef: Drop` right after.
    ///
    /// # Safety
    /// `self` is the `internals` field of a live heap-allocated
    /// `TimeoutObject`/`ImmediateObject` whose refcount has just reached zero.
    /// The per-thread `RuntimeState` and `VirtualMachine` are installed (always
    /// true on the JS thread by the time a timer can be dropped).
    pub(crate) unsafe fn deinit(&mut self) {
        let vm = VirtualMachine::get_mut_ptr();
        let kind = self.flags.get().kind();

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        // (b) `vm.timer.remove(eventLoopTimer())` if state == .ACTIVE — without
        //     this the freed parent stays linked into `All.timers` and the next
        //     `delete_min`/`drain_timers` dereferences freed memory.
        if self.event_loop_timer_state() == EventLoopTimerState::ACTIVE {
            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer`.
            unsafe { (*state).timer.remove(self.event_loop_timer()) };
        }

        // (c) `vm.timer.maps.get(kind).swapRemove(id)` if
        //     `has_accessed_primitive` — drops the i32→*mut EventLoopTimer
        //     entry minted by `to_primitive`. Swap-remove: the id map is only
        //     ever keyed into, never iterated in order, and `deinit` runs for
        //     every id-accessed timer a GC sweep collects, so the ordered
        //     remove's O(n) shift + index rebuild here was O(n²) across a
        //     sweep.
        if self.flags.get().has_accessed_primitive() {
            // SAFETY: as above — fresh `&mut` to `.timer.maps` for this call.
            let map = unsafe { (*state).timer.maps.get(kind) };
            if map.swap_remove(&self.id) {
                // If this map got
                // large, shrink it back down. Keys are i32, values are one
                // pointer (~12 bytes per entry), so 21,000 timers accessed by
                // ID ≈ 252 KiB; reclaim once the slack exceeds 256 KiB.
                const ENTRY_SIZE: usize =
                    core::mem::size_of::<i32>() + core::mem::size_of::<*mut EventLoopTimer>();
                let allocated_bytes = map.capacity() * ENTRY_SIZE;
                let used_bytes = map.count() * ENTRY_SIZE;
                if allocated_bytes - used_bytes > 256 * 1024 {
                    map.shrink_and_free(map.count() + 8);
                }
            } else if kind == Kind::SetInterval {
                // A `setTimeout` promoted to a `setInterval` by
                // `convert_to_interval()` keeps the entry minted by
                // `to_primitive` in `maps.set_timeout`. Remove it from there
                // too, or `remove_timer_by_id` would hand out a dangling
                // `*mut EventLoopTimer` after the parent is freed.
                // SAFETY: as above.
                unsafe { (*state).timer.maps.set_timeout.swap_remove(&self.id) };
            }
        }

        // SAFETY: `vm` is the live per-thread VM.
        if let Some(context) = unsafe { (*vm).timer_context(self.context) } {
            context.untrack_timer(core::ptr::from_mut(self).cast());
        }

        // (d) `setEnableKeepingEventLoopAlive(vm, false)` — without this a
        //     dropped-while-ref'd timer leaks `active_timer_count` /
        //     `immediate_ref_count` and the process hangs at exit.
        self.set_enable_keeping_event_loop_alive(vm, false);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JS-host-method facade — `do_ref`/`do_unref`/`do_refresh`/`has_ref`/
// `to_primitive`/`get_destroyed`/`cancel`, called from
// `TimeoutObject.rs` / `ImmediateObject.rs` host-fn shims.
// ──────────────────────────────────────────────────────────────────────────
impl TimerObjectInternals {
    /// Read-only `container_of` to the owning `EventLoopTimer.state`.
    ///
    /// Single back-ref deref site for the read path: every former
    /// `unsafe { (*self.event_loop_timer()).state }` routes through here.
    fn event_loop_timer_state(&self) -> EventLoopTimerState {
        // SAFETY: ptr into the live parent per `parent_ptr()`; read-only deref.
        unsafe { (*self.event_loop_timer()).state }
    }

    /// Write the owning `EventLoopTimer.state`. Paired write-side accessor for
    /// [`event_loop_timer_state`]; centralises the back-ref deref so call sites
    /// stay safe.
    fn set_event_loop_timer_state(&self, state: EventLoopTimerState) {
        // SAFETY: ptr into the live parent per `parent_ptr()`. `state` is a
        // plain `Copy` enum; writes happen on the single JS thread, and
        // `event_loop_timer()` returns a raw `*mut` precisely so re-entrant
        // `cancel()`/`refresh()` cannot alias a `&mut` (see its doc comment).
        unsafe { (*self.event_loop_timer()).state = state };
    }

    pub(crate) fn do_ref(&self) {
        let did_have_js_ref = self.flags.get().has_js_ref();
        self.update_flags(|f| f.set_has_js_ref(true));

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L256
        // and
        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L685-L687
        // Node only re-enables the keep-alive ref when `!this._destroyed`. Checking
        // `has_cleared_timer` alone is not sufficient: a one-shot timer that has already fired
        // has `has_cleared_timer == false` but is still destroyed. Calling `.unref(); .ref()`
        // on such a timer would otherwise leak an event-loop ref and hang the process.
        if !did_have_js_ref && !self.get_destroyed() {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get_mut_ptr(), true);
        }
    }

    pub(crate) fn do_unref(&self) {
        let did_have_js_ref = self.flags.get().has_js_ref();
        self.update_flags(|f| f.set_has_js_ref(false));

        if did_have_js_ref {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get_mut_ptr(), false);
        }
    }

    /// Node's deadline is `_idleStart + _idleTimeout`; writing `_idleStart`
    /// must move the heap entry so `t2._idleStart = t1._idleStart` works.
    pub(crate) fn set_idle_start(&self, idle_start_ms: f64) {
        if self.flags.get().kind() == Kind::SetImmediate
            || self.flags.get().has_cleared_timer()
            || self.event_loop_timer_state() != EventLoopTimerState::ACTIVE
            || !idle_start_ms.is_finite()
        {
            return;
        }

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        let ms = (idle_start_ms as i64)
            .saturating_add(i64::from(self.interval.get()))
            .max(0);
        let scheduled_time = Timespec::EPOCH.add_ms(ms);
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; fresh
        // `&mut` to `.timer` for this call only. The timer is ACTIVE so
        // `update()` removes then re-inserts with no refcount change.
        unsafe {
            (*state)
                .timer
                .update(self.event_loop_timer(), &scheduled_time)
        };
    }

    pub(crate) fn do_refresh<'a>(
        timeout: &TimeoutObject,
        heap: &JsHeap<'a>,
        this_value: JsWrapper<'a, RefPtr<TimeoutObject>>,
    ) {
        let this = &timeout.internals;
        // Immediates do not have a refresh function, and our binding generator should not let this
        // function be reached even if you override the `this` value calling a Timeout object's
        // `refresh` method
        debug_assert!(this.flags.get().kind() != Kind::SetImmediate);

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if this.id == -1
            || this.flags.get().kind() == Kind::SetImmediate
            || this.flags.get().has_cleared_timer()
        {
            return;
        }

        timeout
            .this_value
            .with_mut(|r| r.set_strong(heap, this_value));
        this.reschedule(heap, this_value, VirtualMachine::get_mut_ptr());
    }

    pub(crate) fn has_ref(&self) -> bool {
        self.flags.get().is_keeping_event_loop_alive()
    }

    /// First access mints an
    /// `id → *mut EventLoopTimer` entry in `All.maps` so `clearTimeout(+t)` /
    /// `clearImmediate(+t)` (numeric-id form) can resolve it.
    ///
    /// Note (jsc/runtime crate cycle): `vm.timer.maps` resolved via `runtime_state()`.
    pub(crate) fn to_primitive(&self) -> Result<i32, bun_alloc::AllocError> {
        if !self.flags.get().has_accessed_primitive() {
            self.update_flags(|f| f.set_has_accessed_primitive(true));
            let state = crate::jsc_hooks::runtime_state();
            debug_assert!(!state.is_null(), "RuntimeState not installed");
            // Note: reshaped for borrowck — capture `event_loop_timer` ptr
            // before borrowing `(*state).timer.maps`.
            let elt = self.event_loop_timer();
            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer.maps`.
            unsafe {
                (*state)
                    .timer
                    .maps
                    .get(self.flags.get().kind())
                    .put(self.id, elt)
            }?;
        }
        Ok(self.id)
    }

    /// Getter for `_destroyed`
    /// on JS Timeout and Immediate objects.
    pub(crate) fn get_destroyed(&self) -> bool {
        if self.flags.get().has_cleared_timer() {
            return true;
        }
        if self.flags.get().in_callback() {
            return false;
        }
        match self.event_loop_timer_state() {
            EventLoopTimerState::ACTIVE | EventLoopTimerState::PENDING => false,
            EventLoopTimerState::FIRED | EventLoopTimerState::CANCELLED => true,
        }
    }

    /// `clearTimeout`/`clearInterval`
    /// / `clearImmediate` / `Timeout#[Symbol.dispose]` body.
    ///
    /// Note: takes `*mut VirtualMachine` (NOT `&mut`) — callers hand over
    /// `global.bun_vm()` (raw ptr) and the body forwards to
    /// `set_enable_keeping_event_loop_alive` which already uses the raw-ptr
    /// contract. `vm.timer` resolved via `runtime_state()` (jsc/runtime crate cycle).
    pub(crate) fn cancel(&self, vm: *mut VirtualMachine) {
        self.set_enable_keeping_event_loop_alive(vm, false);
        self.update_flags(|f| f.set_has_cleared_timer(true));

        if self.flags.get().kind() == Kind::SetImmediate {
            // Release the strong reference so the GC can collect the JS object.
            // The immediate task is still in the event loop queue and will be skipped
            // by runImmediateTask when it sees has_cleared_timer == true.
            self.downgrade_this_value();
            return;
        }

        let was_active = self.event_loop_timer_state() == EventLoopTimerState::ACTIVE;
        self.set_event_loop_timer_state(EventLoopTimerState::CANCELLED);
        self.downgrade_this_value();

        if was_active {
            let state = crate::jsc_hooks::runtime_state();
            debug_assert!(!state.is_null(), "RuntimeState not installed");
            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer`.
            unsafe { (*state).timer.remove(self.event_loop_timer()) };
            self.deref();
        }
    }
}
