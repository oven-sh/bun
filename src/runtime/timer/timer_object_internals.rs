//! `TimerObjectInternals` — fields shared by `TimeoutObject` / `ImmediateObject`.
//!
//! B-2 un-gate: struct + `Flags` packed-u32 state machine are real;
//! `run_immediate_task()` + helpers (`event_loop_timer`/`ref_`/`deref_`/
//! `set_enable_keeping_event_loop_alive`/`run`) un-gated for the
//! `__bun_run_immediate_task` dispatch path. `fire()` + `reschedule()`/
//! `should_reschedule_timer()`/`convert_to_interval()` un-gated for the
//! `FIRE_TIMER` dispatch path (Timeout/Immediate arms). `init()` un-gated for
//! the `TimeoutObject::init` / `ImmediateObject::init` constructors.
//! `cancel()`/`do_ref`/`do_unref`/`do_refresh`/`to_primitive` stay in the
//! gated draft (`TimerObjectInternals.rs`).

use core::mem::offset_of;

use bun_core::{Timespec, TimespecMockMode};

use crate::jsc::JsCell;
use crate::jsc::{
    Debugger, JSGlobalObject, JSValue, JsRef, JsResult, ScriptExecutionStatus,
    generated::{JSImmediate, JSTimeout},
};
use core::cell::Cell;
// PORT NOTE: `bun_jsc::VirtualMachine` is a *module* alias; the struct lives at
// `virtual_machine::VirtualMachine`.
use crate::jsc::virtual_machine::VirtualMachine;

use super::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, ID, ImmediateObject, Kind, KindBig,
    TimeoutObject,
};

/// Data that TimerObject and ImmediateObject have in common.
#[repr(C)]
pub struct TimerObjectInternals {
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`).
    pub id: i32,
    pub interval: Cell<u32>, // Zig: u31
    pub this_value: JsCell<JsRef>,
    pub flags: Cell<Flags>,
    /// `bun test --isolate` generation this timer was created in.
    pub generation: u32,
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

impl Default for TimerObjectInternals {
    fn default() -> Self {
        Self {
            id: -1,
            interval: Cell::new(0),
            this_value: JsCell::new(JsRef::empty()),
            flags: Cell::new(Flags::default()),
            generation: 0,
        }
    }
}

// LAYERING: `Flags` (the packed-u32 state machine) was MOVED DOWN to
// `bun_event_loop::EventLoopTimer::TimerFlags` so `bun_jsc::abort_signal::Timeout`
// can name it without a forward dep on this crate. Re-exported here so existing
// `TimerObjectInternals`/`All::update` callers see the same nominal type.
pub use bun_event_loop::EventLoopTimer::TimerFlags as Flags;

// ──────────────────────────────────────────────────────────────────────────
// `runImmediateTask` path — un-gated for `__bun_run_immediate_task` (dispatch.rs).
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

impl TimerObjectInternals {
    /// `@fieldParentPtr("internals", self)` — the single `container_of` site.
    /// Every other helper (`event_loop_timer`, `ref_`, `deref`, `init`,
    /// `event_loop_timer_state`) routes through this so the `from_field_ptr!`
    /// invariant — `flags.kind()` ⇔ container type, established in `init()` —
    /// lives in exactly one place.
    #[inline]
    fn parent_ptr(&self) -> TimerParent {
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

    /// Increment the parent container's intrusive refcount.
    fn ref_(&self) {
        match self.parent_ptr() {
            // SAFETY: `p` is a live container per `parent_ptr()`.
            TimerParent::Immediate(p) => unsafe { ImmediateObject::ref_(p) },
            // SAFETY: as above.
            TimerParent::Timeout(p) => unsafe { TimeoutObject::ref_(p) },
        }
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
    pub fn async_id(&self) -> u64 {
        ID {
            id: self.id,
            kind: self.flags.get().kind().into(),
        }
        .async_id()
    }

    /// Spec TimerObjectInternals.zig `setEnableKeepingEventLoopAlive`.
    ///
    /// PORT NOTE (b2-cycle): Zig reaches `vm.timer` (a value field of
    /// `VirtualMachine`); the low-tier `bun_jsc::VirtualMachine.timer` is `()`,
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

    /// Spec TimerObjectInternals.zig `run` — invoke the JS callback via the
    /// C++ `Bun__JSTimeout__call` thunk (which handles exceptions internally).
    /// Returns `true` if an exception was thrown.
    ///
    /// PORT NOTE (noalias re-entrancy): takes `*mut Self`, NOT `&mut self`.
    /// The JS callback can re-enter `cancel()`/`do_refresh()` on this same
    /// object via a fresh `&mut Self` derived from the JS wrapper's `m_ptr`.
    /// With `&mut self` here, LLVM's `noalias` lets it keep `self.flags` in a
    /// register across the FFI call, so `set_in_callback(false)`'s RMW
    /// clobbers the `has_cleared_timer` bit that `cancel()` set — the interval
    /// re-fires forever. Zig's `*TimerObjectInternals` has no aliasing
    /// guarantee; mirror that with a raw pointer.
    ///
    /// # Safety
    /// `this` points at a live `TimerObjectInternals` embedded in its parent
    /// container, pinned for the duration of the call by the caller's `ref_()`.
    /// Both callers (`fire`, `run_immediate_task`) also take `*mut Self`, so
    /// no `noalias` `&mut Self` is live anywhere in the call chain across
    /// `Bun__JSTimeout__call` — inlining is safe.
    unsafe fn run(
        this: *mut Self,
        global_this: *mut JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        async_id: u64,
        vm: *mut VirtualMachine,
    ) -> bool {
        // SAFETY: `this` live per fn contract; pinned by caller's `ref_()`.
        // `&Self` (NOT `&mut`) — fields are `Cell`/`JsCell` so re-entrant JS
        // touching this object via another `&Self` is sound (no `noalias`).
        let s = unsafe { &*this };
        // `JSGlobalObject` is an `opaque_ffi!` ZST — `opaque_ref` is the safe
        // deref (panics on null; `vm.global` is never null).
        let global = JSGlobalObject::opaque_ref(global_this);
        // SAFETY: `vm` is the live per-thread VM (hook contract).
        if unsafe { (*vm).is_inspector_enabled() } {
            Debugger::will_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        // Bun__JSTimeout__call handles exceptions.
        // `Cell<Flags>` RMW so the `in_callback` write reaches memory before JS
        // runs (re-entrant `_destroyed` getter reads it via a different pointer).
        s.update_flags(|f| f.set_in_callback(true));
        let result = Bun__JSTimeout__call(global, timer, callback, arguments);
        // PORT NOTE: reshaped for borrowck — Zig `defer this.flags.in_callback = false`
        // moved to tail; no early returns between set and clear.
        // `Cell<Flags>` RMW: must reload `flags` from memory — re-entrant
        // `cancel()` may have set `has_cleared_timer` / cleared
        // `is_keeping_event_loop_alive`.
        s.update_flags(|f| f.set_in_callback(false));

        // PORT NOTE: Zig `defer { if isInspectorEnabled() didDispatch }` —
        // moved to tail (no early returns above).
        // SAFETY: as above.
        if unsafe { (*vm).is_inspector_enabled() } {
            Debugger::did_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        result
    }

    /// Spec TimerObjectInternals.zig `init` — out-param constructor; `self` is
    /// the embedded `internals` field of a freshly `heap::alloc`'d
    /// `ImmediateObject`/`TimeoutObject`. Cannot be
    /// reshaped to `-> Self` because the body needs the parent pointer to
    /// enqueue/reschedule before returning.
    ///
    /// PORT NOTE (b2-cycle): `vm.timer.epoch` resolved via `runtime_state()`
    /// (low-tier `VirtualMachine.timer` is `()`).
    // TODO(port): in-place init — see ImmediateObject::init / TimeoutObject::init.
    pub fn init(
        &mut self,
        timer: JSValue,
        global: &JSGlobalObject,
        id: i32,
        kind: Kind,
        interval: u32, // Zig: u31
        callback: JSValue,
        arguments: JSValue,
    ) {
        let vm = VirtualMachine::get_mut_ptr();
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        *self = Self {
            id,
            flags: {
                let mut f = Flags::default();
                f.set_kind(kind);
                // SAFETY: `state` is the boxed per-thread `RuntimeState`;
                // single-threaded JS heap so no concurrent `&mut` to `.timer`.
                f.set_epoch(unsafe { (*state).timer.epoch });
                Cell::new(f)
            },
            interval: Cell::new(interval),
            // SAFETY: `vm` is the live per-thread VM; field read only.
            generation: unsafe { (*vm).test_isolation_generation },
            this_value: JsCell::new(JsRef::empty()),
        };

        if kind == Kind::SetImmediate {
            JSImmediate::arguments_set_cached(timer, global, arguments);
            JSImmediate::callback_set_cached(timer, global, callback);
            // `flags.kind` was just set to `SetImmediate` above.
            let TimerParent::Immediate(parent) = self.parent_ptr() else {
                unreachable!()
            };
            // SAFETY: `vm` is the live per-thread VM. Low tier stores `*mut ()`
            // (PORTING.md §Dispatch); `run_immediate_task_hook` casts it back
            // to `*mut ImmediateObject`.
            unsafe { (*vm).enqueue_immediate_task(parent.cast()) };
            self.set_enable_keeping_event_loop_alive(vm, true);
            // ref'd by event loop
            self.ref_();
        } else {
            JSTimeout::arguments_set_cached(timer, global, arguments);
            JSTimeout::callback_set_cached(timer, global, callback);
            JSTimeout::idle_timeout_set_cached(
                timer,
                global,
                JSValue::js_number(f64::from(interval)),
            );
            JSTimeout::repeat_set_cached(
                timer,
                global,
                if kind == Kind::SetInterval {
                    JSValue::js_number(f64::from(interval))
                } else {
                    JSValue::NULL
                },
            );

            // this increments the refcount and sets _idleStart
            self.reschedule(timer, vm, global.as_ptr());
        }

        self.this_value.with_mut(|r| r.set_strong(timer, global));
    }

    /// Spec TimerObjectInternals.zig `runImmediateTask`. Returns `true` if an
    /// exception was thrown.
    ///
    /// PORT NOTE (noalias re-entrancy): takes `*mut Self`, NOT `&mut self`.
    /// `Self::run` re-enters JS which can `cancel()`/`do_refresh()` this same
    /// object via the JS wrapper's `m_ptr`. With `&mut self` LLVM may cache
    /// `self.flags`/`event_loop_timer().state` across the call and clobber the
    /// re-entrant write (see `run()` doc). Mirror Zig's `*Self` with a raw
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
    pub unsafe fn run_immediate_task(this: *mut Self, vm: *mut VirtualMachine) -> bool {
        // SAFETY: per fn contract — `this` live. `&Self` (NOT `&mut`) — fields
        // are `Cell`/`JsCell` so re-entrant JS touching this object via another
        // `&Self` is sound (no `noalias`). Last use of `s` is the final
        // `s.deref()` below; `*this` may be freed only after that point.
        let s = unsafe { &*this };
        let cleared = s.flags.get().has_cleared_timer()
            // SAFETY: `vm` is the live per-thread VM (hook contract).
            || s.generation != unsafe { (*vm).test_isolation_generation }
            // unref'd setImmediate callbacks should only run if there are things
            // keeping the event loop alive other than setImmediates
            || (!s.flags.get().is_keeping_event_loop_alive()
                // SAFETY: `vm` live per hook contract.
                && !unsafe { (*vm).is_event_loop_alive_excluding_immediates() });
        if cleared {
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.this_value.with_mut(|r| r.downgrade());
            s.deref();
            return false;
        }

        let Some(timer) = s.this_value.get().try_get() else {
            #[cfg(debug_assertions)]
            panic!("TimerObjectInternals.runImmediateTask: this_object is null");
            #[allow(unreachable_code)]
            {
                s.set_enable_keeping_event_loop_alive(vm, false);
                s.deref();
                return false;
            }
        };
        // SAFETY: `vm` is live; `global` is the per-VM JSGlobalObject pointer.
        let global_this = unsafe { (*vm).global };
        s.this_value.with_mut(|r| r.downgrade());
        s.set_event_loop_timer_state(EventLoopTimerState::FIRED);
        s.set_enable_keeping_event_loop_alive(vm, false);
        timer.ensure_still_alive();

        // SAFETY: `vm` is live; `event_loop()` returns `*mut` to the embedded
        // EventLoop. Re-entrancy is permitted by the raw-ptr contract above.
        unsafe { (*(*vm).event_loop()).enter() };
        let callback =
            JSImmediate::callback_get_cached(timer).expect("ImmediateObject callback slot");
        let arguments =
            JSImmediate::arguments_get_cached(timer).expect("ImmediateObject arguments slot");

        let exception_thrown = {
            s.ref_();
            let async_id = s.async_id();
            // SAFETY: `this` is the live `internals` per fn contract; `ref_()`
            // above pins the parent across re-entrancy.
            let result =
                unsafe { Self::run(this, global_this, timer, callback, arguments, async_id, vm) };
            // PORT NOTE: Zig `defer { if state == .FIRED deref(); deref(); }` —
            // moved to tail of this block; `Self::run` has no early return so
            // ordering is preserved. After the second `deref()` `*this` may be
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

    /// Spec TimerObjectInternals.zig `fire` — `EventLoopTimer.fire` dispatch
    /// arm body for `Tag::TimeoutObject`/`Tag::ImmediateObject`. Pops the JS
    /// timer, invokes its callback via `run()`, then either reschedules
    /// (setInterval / `t._repeat`) or releases the heap ref.
    ///
    /// PORT NOTE: takes `*mut VirtualMachine` (NOT `&mut`) — the body calls
    /// `vm.event_loop().enter()` then re-enters JS which may itself touch the
    /// VM/EventLoop (and `(*runtime_state()).timer` via `cancel()`/`refresh()`);
    /// aliased `&mut` would be UB. Dereference per-use under `// SAFETY:`.
    /// Spec Timer.zig:346 takes `*All`/`*VirtualMachine` for the same reason.
    ///
    /// PORT NOTE (noalias re-entrancy): takes `*mut Self`, NOT `&mut self`.
    /// `Self::run` re-enters JS which can `cancel()`/`do_refresh()` this same
    /// object via the JS wrapper's `m_ptr`. With `&mut self` LLVM may cache
    /// `self.flags`/`event_loop_timer().state` across the call and dead-store
    /// the post-call reloads in `should_reschedule_timer`/`is_timer_done` —
    /// the interval re-fires forever. Mirror Zig's `*Self` with a raw pointer;
    /// helper calls `(*this).foo()` materialise short-lived `&mut` scoped to
    /// each statement only — none span the JS call.
    ///
    /// PORT NOTE (b2-cycle): `vm.timer` resolved via
    /// `crate::jsc_hooks::runtime_state()` — low-tier `VirtualMachine.timer`
    /// is `()` (see `set_enable_keeping_event_loop_alive`).
    ///
    /// # Safety
    /// `this` points at a live `TimerObjectInternals` embedded in its
    /// `TimeoutObject`/`ImmediateObject` parent (FIRE_TIMER hook contract);
    /// `vm` is the live per-thread VM.
    pub unsafe fn fire(this: *mut Self, _now: &ElTimespec, vm: *mut VirtualMachine) {
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
            || s.generation != unsafe { (*vm).test_isolation_generation };

        s.set_event_loop_timer_state(EventLoopTimerState::FIRED);

        // SAFETY: `vm` is live; `global` is the per-VM JSGlobalObject pointer.
        let global_this = unsafe { (*vm).global };
        let Some(this_object) = s.this_value.get().try_get() else {
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.this_value.with_mut(|r| r.downgrade());
            s.deref();
            return;
        };

        #[allow(unused_assignments)]
        let (callback, arguments, mut idle_timeout, mut repeat): (
            JSValue,
            JSValue,
            JSValue,
            JSValue,
        ) = match kind {
            KindBig::SetImmediate => (
                JSImmediate::callback_get_cached(this_object)
                    .expect("ImmediateObject callback slot"),
                JSImmediate::arguments_get_cached(this_object)
                    .expect("ImmediateObject arguments slot"),
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
            ),
            KindBig::SetTimeout | KindBig::SetInterval => (
                JSTimeout::callback_get_cached(this_object).expect("TimeoutObject callback slot"),
                JSTimeout::arguments_get_cached(this_object).expect("TimeoutObject arguments slot"),
                JSTimeout::idle_timeout_get_cached(this_object)
                    .expect("TimeoutObject idleTimeout slot"),
                JSTimeout::repeat_get_cached(this_object).expect("TimeoutObject repeat slot"),
            ),
        };

        if has_been_cleared || !callback.to_boolean() {
            // SAFETY: `vm`/`global_this` live per hook contract.
            if unsafe { (*vm).is_inspector_enabled() } {
                Debugger::did_cancel_async_call(
                    // `opaque_ffi!` ZST — safe deref; `vm.global` never null.
                    JSGlobalObject::opaque_ref(global_this),
                    Debugger::AsyncCallType::DOMTimer,
                    async_id.async_id(),
                );
            }
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.this_value.with_mut(|r| r.downgrade());
            s.deref();
            return;
        }

        // Only read on the .setInterval path where it is written below.
        let mut time_before_call = Timespec::EPOCH;

        if kind != KindBig::SetInterval {
            s.this_value.with_mut(|r| r.downgrade());
        } else {
            time_before_call = Timespec::ms_from_now(
                TimespecMockMode::AllowMockedTime,
                i64::from(s.interval.get()),
            );
        }
        this_object.ensure_still_alive();

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        // SAFETY: `vm` is live; `event_loop()` returns `*mut` to the embedded
        // EventLoop. Re-entrancy is permitted by the raw-ptr contract above.
        unsafe { (*(*vm).event_loop()).enter() };
        {
            // Ensure it stays alive for this scope.
            s.ref_();
            // PORT NOTE: Zig `defer this.deref()` — moved to the end of this
            // block. Every path through the labelled-block + `is_timer_done`
            // tail reaches it (no `return` between here and the deref).

            // SAFETY: `this` is the live `internals` per fn contract; `ref_()`
            // above pins the parent across re-entrancy.
            let _ = unsafe {
                Self::run(
                    this,
                    global_this,
                    this_object,
                    callback,
                    arguments,
                    async_id.async_id(),
                    vm,
                )
            };

            match kind {
                KindBig::SetTimeout | KindBig::SetInterval => {
                    idle_timeout = JSTimeout::idle_timeout_get_cached(this_object)
                        .expect("TimeoutObject idleTimeout slot");
                    repeat = JSTimeout::repeat_get_cached(this_object)
                        .expect("TimeoutObject repeat slot");
                }
                KindBig::SetImmediate => {}
            }

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
                    if kind == KindBig::SetTimeout && !repeat.is_null() {
                        if let Some(num) = idle_timeout.get_number() {
                            if num != -1.0 {
                                // reschedule() inside convertToInterval will see state == .FIRED
                                // and add a ref; fall through to the switch below so the .ACTIVE
                                // arm can balance it.
                                s.convert_to_interval(global_this, this_object, repeat, vm);
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

            // PORT NOTE: Zig `defer this.deref()` — end of pinned scope. After
            // this `*this` may be freed; do not touch past this block.
            s.deref();
        }
        // --- after this point, the timer is no longer guaranteed to be alive ---

        // SAFETY: `vm` is live; see `enter()` note above.
        unsafe { (*(*vm).event_loop()).exit() };
    }

    /// Spec TimerObjectInternals.zig `convertToInterval` — a `setTimeout` whose
    /// `t._repeat` was assigned promotes itself to a `setInterval` after its
    /// first fire (Node `lib/internal/timers.js:613`).
    ///
    /// PORT NOTE: takes `vm` explicitly instead of `global.bun_vm()` so the
    /// raw-ptr contract from `fire()` is preserved (no fresh `&mut VM`).
    /// `&self` (not `&mut`) — all writes go through `Cell`/`JsCell`; the sole
    /// caller (`fire()`) holds only a `&Self`.
    fn convert_to_interval(
        &self,
        global: *mut JSGlobalObject,
        timer: JSValue,
        repeat: JSValue,
        vm: *mut VirtualMachine,
    ) {
        debug_assert!(self.flags.get().kind() == Kind::SetTimeout);

        let new_interval: u32 = if let Some(num) = repeat.get_number() {
            // Zig: `if (num < 1 or num > maxInt(u31)) 1 else @intFromFloat(num)`
            if num < 1.0 || num > f64::from(u32::MAX >> 1) {
                1
            } else {
                num as u32
            }
        } else {
            1
        };

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L613
        // `opaque_ffi!` ZST — safe deref; `vm.global` never null.
        let global_ref = JSGlobalObject::opaque_ref(global);
        JSTimeout::idle_timeout_set_cached(timer, global_ref, repeat);
        self.this_value
            .with_mut(|r| r.set_strong(timer, global_ref));
        self.update_flags(|f| f.set_kind(Kind::SetInterval));
        self.interval.set(new_interval);
        self.reschedule(timer, vm, global);
    }

    /// Spec TimerObjectInternals.zig `shouldRescheduleTimer`.
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

    /// Spec TimerObjectInternals.zig `reschedule` — re-insert the parent's
    /// `EventLoopTimer` into the heap at `now + interval`. Called from
    /// `init()` (gated draft), `do_refresh()` (gated draft), and
    /// `convert_to_interval()` above.
    ///
    /// PORT NOTE (b2-cycle): `vm.timer` resolved via `runtime_state()`.
    pub fn reschedule(
        &self,
        timer: JSValue,
        vm: *mut VirtualMachine,
        global_this: *mut JSGlobalObject,
    ) {
        if self.flags.get().kind() == Kind::SetImmediate {
            return;
        }

        let idle_timeout =
            JSTimeout::idle_timeout_get_cached(timer).expect("TimeoutObject idleTimeout slot");
        let repeat = JSTimeout::repeat_get_cached(timer).expect("TimeoutObject repeat slot");

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if !self.should_reschedule_timer(repeat, idle_timeout) {
            return;
        }

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        let now = Timespec::now(TimespecMockMode::AllowMockedTime);
        let scheduled_time = now.add_ms(i64::from(self.interval.get()));
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
        JSTimeout::idle_start_set_cached(
            timer,
            // `opaque_ffi!` ZST — safe deref; `vm.global` never null.
            JSGlobalObject::opaque_ref(global_this),
            JSValue::js_number(now.ms_unsigned() as f64),
        );

        if self.flags.get().has_js_ref() {
            self.set_enable_keeping_event_loop_alive(vm, true);
        }
    }

    /// Spec TimerObjectInternals.zig `deinit` — final teardown invoked by the
    /// parent container's intrusive-refcount destructor (`{Timeout,Immediate}
    /// Object::deref` when the count hits zero). Unlinks the parent from every
    /// `Timer::All` data structure it may still be reachable from so the
    /// imminent `heap::take` free cannot leave a dangling
    /// `*mut EventLoopTimer` in the heap or a leaked keep-alive count.
    ///
    /// PORT NOTE: `this_value.deinit()` (Zig line 499) is intentionally NOT
    /// called here — `JsRef: Drop` runs when the parent `Box` is reclaimed
    /// immediately after this returns, performing the same release.
    /// `ref_count.assertNoRefs()` is likewise omitted: the only caller is the
    /// `n == 1` branch of `deref`, so the count is provably zero.
    ///
    /// # Safety
    /// `self` is the `internals` field of a live heap-allocated
    /// `TimeoutObject`/`ImmediateObject` whose refcount has just reached zero.
    /// The per-thread `RuntimeState` and `VirtualMachine` are installed (always
    /// true on the JS thread by the time a timer can be dropped).
    pub unsafe fn deinit(&mut self) {
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

        // (c) `vm.timer.maps.get(kind).orderedRemove(id)` if
        //     `has_accessed_primitive` — drops the i32→*mut EventLoopTimer
        //     entry minted by `toPrimitive`.
        if self.flags.get().has_accessed_primitive() {
            // SAFETY: as above — fresh `&mut` to `.timer.maps` for this call.
            let map = unsafe { (*state).timer.maps.get(kind) };
            // PORT NOTE: Zig follows up with a shrink-and-free heuristic
            // (>256 KiB slack ⇒ `shrinkAndFree`); `bun_collections::ArrayHashMap`
            // exposes neither `capacity()` nor `shrink_and_free()`, so the
            // reclamation is omitted. Correctness is unaffected — the entry is
            // gone — only the high-watermark capacity lingers.
            // TODO(port): plumb a `shrink_to_fit` once `ArrayHashMap` grows one.
            let _ = map.remove(&self.id);
        }

        // (d) `setEnableKeepingEventLoopAlive(vm, false)` — without this a
        //     dropped-while-ref'd timer leaks `active_timer_count` /
        //     `immediate_ref_count` and the process hangs at exit.
        self.set_enable_keeping_event_loop_alive(vm, false);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JS-host-method facade — `do_ref`/`do_unref`/`do_refresh`/`has_ref`/
// `to_primitive`/`get_destroyed`/`finalize`/`cancel`. Un-gated for
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

    /// Spec TimerObjectInternals.zig `doRef`.
    pub fn do_ref(&self, _global: &JSGlobalObject, this_value: JSValue) -> JsResult<JSValue> {
        this_value.ensure_still_alive();

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

        Ok(this_value)
    }

    /// Spec TimerObjectInternals.zig `doUnref`.
    pub fn do_unref(&self, _global: &JSGlobalObject, this_value: JSValue) -> JsResult<JSValue> {
        this_value.ensure_still_alive();

        let did_have_js_ref = self.flags.get().has_js_ref();
        self.update_flags(|f| f.set_has_js_ref(false));

        if did_have_js_ref {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get_mut_ptr(), false);
        }

        Ok(this_value)
    }

    /// Spec TimerObjectInternals.zig `doRefresh`.
    pub fn do_refresh(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        // Immediates do not have a refresh function, and our binding generator should not let this
        // function be reached even if you override the `this` value calling a Timeout object's
        // `refresh` method
        debug_assert!(self.flags.get().kind() != Kind::SetImmediate);

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if self.id == -1
            || self.flags.get().kind() == Kind::SetImmediate
            || self.flags.get().has_cleared_timer()
        {
            return Ok(this_value);
        }

        self.this_value
            .with_mut(|r| r.set_strong(this_value, global_object));
        self.reschedule(
            this_value,
            VirtualMachine::get_mut_ptr(),
            global_object.as_ptr(),
        );

        Ok(this_value)
    }

    /// Spec TimerObjectInternals.zig `hasRef`.
    pub fn has_ref(&self) -> JsResult<JSValue> {
        Ok(JSValue::from(
            self.flags.get().is_keeping_event_loop_alive(),
        ))
    }

    /// Spec TimerObjectInternals.zig `toPrimitive` — first access mints an
    /// `id → *mut EventLoopTimer` entry in `All.maps` so `clearTimeout(+t)` /
    /// `clearImmediate(+t)` (numeric-id form) can resolve it.
    ///
    /// PORT NOTE (b2-cycle): `vm.timer.maps` resolved via `runtime_state()`.
    pub fn to_primitive(&self) -> JsResult<JSValue> {
        if !self.flags.get().has_accessed_primitive() {
            self.update_flags(|f| f.set_has_accessed_primitive(true));
            let state = crate::jsc_hooks::runtime_state();
            debug_assert!(!state.is_null(), "RuntimeState not installed");
            // PORT NOTE: reshaped for borrowck — capture `event_loop_timer` ptr
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
        Ok(JSValue::js_number(f64::from(self.id)))
    }

    /// Spec TimerObjectInternals.zig `getDestroyed` — getter for `_destroyed`
    /// on JS Timeout and Immediate objects.
    pub fn get_destroyed(&self) -> bool {
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

    /// Spec TimerObjectInternals.zig `finalize` — `.classes.ts` finalizer hook.
    /// Runs on the mutator thread during lazy sweep; do not touch any
    /// `JSValue`/`Strong` content here.
    pub fn finalize(&self) {
        self.this_value.with_mut(|r| r.finalize());
        self.deref();
    }

    /// Spec TimerObjectInternals.zig `cancel` — `clearTimeout`/`clearInterval`
    /// / `clearImmediate` / `Timeout#[Symbol.dispose]` body.
    ///
    /// PORT NOTE: takes `*mut VirtualMachine` (NOT `&mut`) — callers hand over
    /// `global.bun_vm()` (raw ptr) and the body forwards to
    /// `set_enable_keeping_event_loop_alive` which already uses the raw-ptr
    /// contract. `vm.timer` resolved via `runtime_state()` (b2-cycle).
    pub fn cancel(&self, vm: *mut VirtualMachine) {
        self.set_enable_keeping_event_loop_alive(vm, false);
        self.update_flags(|f| f.set_has_cleared_timer(true));

        if self.flags.get().kind() == Kind::SetImmediate {
            // Release the strong reference so the GC can collect the JS object.
            // The immediate task is still in the event loop queue and will be skipped
            // by runImmediateTask when it sees has_cleared_timer == true.
            self.this_value.with_mut(|r| r.downgrade());
            return;
        }

        let was_active = self.event_loop_timer_state() == EventLoopTimerState::ACTIVE;
        self.set_event_loop_timer_state(EventLoopTimerState::CANCELLED);
        self.this_value.with_mut(|r| r.downgrade());

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

// ported from: src/runtime/timer/TimerObjectInternals.zig
