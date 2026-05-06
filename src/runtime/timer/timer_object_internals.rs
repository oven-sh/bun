//! `TimerObjectInternals` — fields shared by `TimeoutObject` / `ImmediateObject`.
//!
//! B-2 un-gate: struct + `Flags` packed-u32 state machine are real;
//! `run_immediate_task()` + helpers (`event_loop_timer`/`ref_`/`deref_`/
//! `set_enable_keeping_event_loop_alive`/`run`) un-gated for the
//! `RUN_IMMEDIATE_HOOK` dispatch path. `fire()` + `reschedule()`/
//! `should_reschedule_timer()`/`convert_to_interval()` un-gated for the
//! `FIRE_TIMER` dispatch path (Timeout/Immediate arms). `init()` un-gated for
//! the `TimeoutObject::init` / `ImmediateObject::init` constructors.
//! `cancel()`/`do_ref`/`do_unref`/`do_refresh`/`to_primitive` stay in the
//! gated draft (`TimerObjectInternals.rs`).

use core::mem::offset_of;

use bun_core::{Timespec, TimespecMockMode};

use crate::jsc::{
    generated::{JSImmediate, JSTimeout},
    Debugger, JSGlobalObject, JSValue, JsRef, JsResult, ScriptExecutionStatus,
};
// PORT NOTE: `bun_jsc::VirtualMachine` is a *module* alias; the struct lives at
// `virtual_machine::VirtualMachine`.
use crate::jsc::virtual_machine::VirtualMachine;

use super::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, ImmediateObject, Kind, KindBig,
    TimeoutObject, ID,
};

/// Data that TimerObject and ImmediateObject have in common.
#[repr(C)]
pub struct TimerObjectInternals {
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`).
    pub id: i32,
    pub interval: u32, // Zig: u31
    pub this_value: JsRef,
    pub flags: Flags,
    /// `bun test --isolate` generation this timer was created in.
    pub generation: u32,
}

impl Default for TimerObjectInternals {
    fn default() -> Self {
        Self {
            id: -1,
            interval: 0,
            this_value: JsRef::empty(),
            flags: Flags::default(),
            generation: 0,
        }
    }
}

/// Zig: `packed struct(u32)` with mixed-width fields. Layout (LSB→MSB):
///   epoch:u25, kind:u2, has_cleared_timer:1, is_keeping_event_loop_alive:1,
///   has_accessed_primitive:1, has_js_ref:1, in_callback:1
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct Flags(u32);

impl Default for Flags {
    fn default() -> Self {
        // has_js_ref=true, everything else 0
        Self(1 << 30)
    }
}

impl Flags {
    const EPOCH_MASK: u32 = (1 << 25) - 1;
    const KIND_SHIFT: u32 = 25;
    const KIND_MASK: u32 = 0b11 << Self::KIND_SHIFT;
    const HAS_CLEARED_TIMER: u32 = 1 << 27;
    const IS_KEEPING_EVENT_LOOP_ALIVE: u32 = 1 << 28;
    const HAS_ACCESSED_PRIMITIVE: u32 = 1 << 29;
    const HAS_JS_REF: u32 = 1 << 30;
    const IN_CALLBACK: u32 = 1 << 31;

    #[inline] pub fn epoch(self) -> u32 { self.0 & Self::EPOCH_MASK }
    #[inline] pub fn set_epoch(&mut self, v: u32) {
        self.0 = (self.0 & !Self::EPOCH_MASK) | (v & Self::EPOCH_MASK);
    }
    #[inline] pub fn kind(self) -> Kind {
        // SAFETY: stored value always written via set_kind (range 0..=2)
        unsafe { core::mem::transmute::<u8, Kind>(((self.0 & Self::KIND_MASK) >> Self::KIND_SHIFT) as u8) }
    }
    #[inline] pub fn set_kind(&mut self, k: Kind) {
        self.0 = (self.0 & !Self::KIND_MASK) | ((k as u32) << Self::KIND_SHIFT);
    }
    #[inline] pub fn has_cleared_timer(self) -> bool { self.0 & Self::HAS_CLEARED_TIMER != 0 }
    #[inline] pub fn set_has_cleared_timer(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_CLEARED_TIMER } else { self.0 &= !Self::HAS_CLEARED_TIMER }
    }
    #[inline] pub fn is_keeping_event_loop_alive(self) -> bool { self.0 & Self::IS_KEEPING_EVENT_LOOP_ALIVE != 0 }
    #[inline] pub fn set_is_keeping_event_loop_alive(&mut self, v: bool) {
        if v { self.0 |= Self::IS_KEEPING_EVENT_LOOP_ALIVE } else { self.0 &= !Self::IS_KEEPING_EVENT_LOOP_ALIVE }
    }
    #[inline] pub fn has_accessed_primitive(self) -> bool { self.0 & Self::HAS_ACCESSED_PRIMITIVE != 0 }
    #[inline] pub fn set_has_accessed_primitive(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_ACCESSED_PRIMITIVE } else { self.0 &= !Self::HAS_ACCESSED_PRIMITIVE }
    }
    #[inline] pub fn has_js_ref(self) -> bool { self.0 & Self::HAS_JS_REF != 0 }
    #[inline] pub fn set_has_js_ref(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_JS_REF } else { self.0 &= !Self::HAS_JS_REF }
    }
    #[inline] pub fn in_callback(self) -> bool { self.0 & Self::IN_CALLBACK != 0 }
    #[inline] pub fn set_in_callback(&mut self, v: bool) {
        if v { self.0 |= Self::IN_CALLBACK } else { self.0 &= !Self::IN_CALLBACK }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `runImmediateTask` path — un-gated for `RUN_IMMEDIATE_HOOK` (dispatch.rs).
// ──────────────────────────────────────────────────────────────────────────

// C++ symbol emitted from ImmediateList.cpp / setTimeout.cpp; already linked.
unsafe extern "C" {
    fn Bun__JSTimeout__call(
        global_object: *mut JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
    ) -> bool;
}

impl TimerObjectInternals {
    /// `@fieldParentPtr("internals", self).event_loop_timer`. Returns a raw
    /// pointer (NOT `&mut`) so callers can hold it across re-entrant JS calls
    /// without minting aliased `&mut` (PORTING.md §Forbidden — the callback
    /// may reach this same field via `cancel()`/`refresh()`).
    fn event_loop_timer(&mut self) -> *mut EventLoopTimer {
        match self.flags.kind() {
            Kind::SetImmediate => {
                // SAFETY: `kind == SetImmediate` ⇒ `self` is the `internals`
                // field of a live `ImmediateObject` (set in `init()`).
                let parent = unsafe {
                    (self as *mut Self as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>()
                };
                // SAFETY: `parent` derived from a live container per above.
                unsafe { core::ptr::addr_of_mut!((*parent).event_loop_timer) }
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: `kind ∈ {SetTimeout, SetInterval}` ⇒ `self` is the
                // `internals` field of a live `TimeoutObject`.
                let parent = unsafe {
                    (self as *mut Self as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>()
                };
                // SAFETY: `parent` derived from a live container per above.
                unsafe { core::ptr::addr_of_mut!((*parent).event_loop_timer) }
            }
        }
    }

    /// Increment the parent container's intrusive refcount.
    fn ref_(&mut self) {
        match self.flags.kind() {
            // SAFETY: see `event_loop_timer` — same `@fieldParentPtr` invariant.
            Kind::SetImmediate => unsafe {
                ImmediateObject::ref_(
                    (self as *mut Self as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>(),
                )
            },
            // SAFETY: see `event_loop_timer`.
            Kind::SetTimeout | Kind::SetInterval => unsafe {
                TimeoutObject::ref_(
                    (self as *mut Self as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>(),
                )
            },
        }
    }

    /// Decrement the parent container's intrusive refcount; frees on 0.
    /// After this returns, `self` may be dangling — do not touch.
    fn deref(&mut self) {
        match self.flags.kind() {
            // SAFETY: see `event_loop_timer`.
            Kind::SetImmediate => unsafe {
                ImmediateObject::deref(
                    (self as *mut Self as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>(),
                )
            },
            // SAFETY: see `event_loop_timer`.
            Kind::SetTimeout | Kind::SetInterval => unsafe {
                TimeoutObject::deref(
                    (self as *mut Self as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>(),
                )
            },
        }
    }

    #[inline]
    pub fn async_id(&self) -> u64 {
        ID { id: self.id, kind: self.flags.kind().big() }.async_id()
    }

    /// Spec TimerObjectInternals.zig `setEnableKeepingEventLoopAlive`.
    ///
    /// PORT NOTE (b2-cycle): Zig reaches `vm.timer` (a value field of
    /// `VirtualMachine`); the low-tier `bun_jsc::VirtualMachine.timer` is `()`,
    /// so resolve `Timer::All` via the per-thread `RuntimeState` instead.
    fn set_enable_keeping_event_loop_alive(&mut self, vm: *mut VirtualMachine, enable: bool) {
        if self.flags.is_keeping_event_loop_alive() == enable {
            return;
        }
        self.flags.set_is_keeping_event_loop_alive(enable);

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `vm` is the live per-thread VM (hook contract); field read only.
        let uws_loop = unsafe { (*vm).uws_loop() };
        let delta = if enable { 1 } else { -1 };
        match self.flags.kind() {
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
    fn run(
        &mut self,
        global_this: *mut JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        async_id: u64,
        vm: *mut VirtualMachine,
    ) -> bool {
        // SAFETY: `vm` is the live per-thread VM (hook contract).
        if unsafe { (*vm).is_inspector_enabled() } {
            // SAFETY: `global_this` is `vm.global`, live for the call.
            Debugger::will_dispatch_async_call(
                unsafe { &*global_this },
                Debugger::AsyncCallType::DOMTimer,
                async_id,
            );
        }

        // Bun__JSTimeout__call handles exceptions.
        self.flags.set_in_callback(true);
        // SAFETY: FFI into C++ on the JS thread; all JSValue args are live GC
        // cells (`timer.ensure_still_alive()` was called by the caller).
        let result = unsafe { Bun__JSTimeout__call(global_this, timer, callback, arguments) };
        // PORT NOTE: reshaped for borrowck — Zig `defer this.flags.in_callback = false`
        // moved to tail; no early returns between set and clear.
        self.flags.set_in_callback(false);

        // PORT NOTE: Zig `defer { if isInspectorEnabled() didDispatch }` —
        // moved to tail (no early returns above).
        // SAFETY: as above.
        if unsafe { (*vm).is_inspector_enabled() } {
            // SAFETY: as above.
            Debugger::did_dispatch_async_call(
                unsafe { &*global_this },
                Debugger::AsyncCallType::DOMTimer,
                async_id,
            );
        }

        result
    }

    /// Spec TimerObjectInternals.zig `init` — out-param constructor; `self` is
    /// the embedded `internals` field of a freshly `Box::into_raw`'d
    /// `ImmediateObject`/`TimeoutObject` (Zig: `@fieldParentPtr`). Cannot be
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
        let vm = VirtualMachine::get();
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
                f
            },
            interval,
            // SAFETY: `vm` is the live per-thread VM; field read only.
            generation: unsafe { (*vm).test_isolation_generation },
            this_value: JsRef::empty(),
        };

        if kind == Kind::SetImmediate {
            JSImmediate::arguments_set_cached(timer, global, arguments);
            JSImmediate::callback_set_cached(timer, global, callback);
            // SAFETY: `kind == SetImmediate` ⇒ `self` is the `internals` field
            // of a live `ImmediateObject` (caller contract — see
            // `ImmediateObject::init`).
            let parent = unsafe {
                (self as *mut Self as *mut u8)
                    .sub(offset_of!(ImmediateObject, internals))
                    .cast::<ImmediateObject>()
            };
            // SAFETY: `vm` is the live per-thread VM. The low-tier
            // `bun_jsc::event_loop::ImmediateObject` is an opaque forward-decl
            // for this crate's `ImmediateObject`; `.cast()` is the identity
            // (consumed by `run_immediate_task_hook` which casts it back).
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

        self.this_value.set_strong(timer, global);
    }

    /// Spec TimerObjectInternals.zig `runImmediateTask`. Returns `true` if an
    /// exception was thrown.
    ///
    /// PORT NOTE: takes `*mut VirtualMachine` (NOT `&mut`) — the body calls
    /// `vm.event_loop().enter()` then re-enters JS which may itself touch the
    /// VM/EventLoop; aliased `&mut` would be UB. Dereference per-use under
    /// `// SAFETY:` instead, mirroring `jsc_hooks::auto_tick`.
    pub fn run_immediate_task(&mut self, vm: *mut VirtualMachine) -> bool {
        // SAFETY: `vm` is the live per-thread VM (hook contract).
        let cleared = self.flags.has_cleared_timer()
            || self.generation != unsafe { (*vm).test_isolation_generation }
            // unref'd setImmediate callbacks should only run if there are things
            // keeping the event loop alive other than setImmediates
            || (!self.flags.is_keeping_event_loop_alive()
                && !unsafe { (*vm).is_event_loop_alive_excluding_immediates() });
        if cleared {
            self.set_enable_keeping_event_loop_alive(vm, false);
            self.this_value.downgrade();
            self.deref();
            return false;
        }

        let Some(timer) = self.this_value.try_get() else {
            #[cfg(debug_assertions)]
            panic!("TimerObjectInternals.runImmediateTask: this_object is null");
            #[allow(unreachable_code)]
            {
                self.set_enable_keeping_event_loop_alive(vm, false);
                self.deref();
                return false;
            }
        };
        // SAFETY: `vm` is live; `global` is the per-VM JSGlobalObject pointer.
        let global_this = unsafe { (*vm).global };
        self.this_value.downgrade();
        // SAFETY: `event_loop_timer()` derives a pointer into the live parent.
        unsafe { (*self.event_loop_timer()).state = EventLoopTimerState::FIRED };
        self.set_enable_keeping_event_loop_alive(vm, false);
        timer.ensure_still_alive();

        // SAFETY: `vm` is live; `event_loop()` returns `*mut` to the embedded
        // EventLoop. Re-entrancy is permitted by the raw-ptr contract above.
        unsafe { (*(*vm).event_loop()).enter() };
        let callback = JSImmediate::callback_get_cached(timer)
            .expect("ImmediateObject callback slot");
        let arguments = JSImmediate::arguments_get_cached(timer)
            .expect("ImmediateObject arguments slot");

        let exception_thrown = {
            self.ref_();
            let async_id = self.async_id();
            let result = self.run(global_this, timer, callback, arguments, async_id, vm);
            // PORT NOTE: Zig `defer { if state == .FIRED deref(); deref(); }` —
            // moved to tail of this block; `self.run` has no early return so
            // ordering is preserved. After the second `deref()` `self` may be
            // freed; do not touch it past this block.
            // SAFETY: `event_loop_timer()` still valid — `ref_()` above pins.
            if unsafe { (*self.event_loop_timer()).state } == EventLoopTimerState::FIRED {
                self.deref();
            }
            self.deref();
            result
        };
        // --- after this point, the timer is no longer guaranteed to be alive ---

        // SAFETY: `vm` is live; see `enter()` note above.
        if unsafe { (*(*vm).event_loop()).exit_maybe_drain_microtasks(!exception_thrown) }.is_err() {
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
    /// PORT NOTE (b2-cycle): `vm.timer` resolved via
    /// `crate::jsc_hooks::runtime_state()` — low-tier `VirtualMachine.timer`
    /// is `()` (see `set_enable_keeping_event_loop_alive`).
    pub fn fire(&mut self, _now: &ElTimespec, vm: *mut VirtualMachine) {
        let id = self.id;
        let kind = self.flags.kind().big();
        let async_id = ID { id, kind };
        // SAFETY: `vm` is the live per-thread VM (FIRE_TIMER hook contract);
        // `event_loop_timer()` derives a pointer into the live parent.
        let has_been_cleared = unsafe { (*self.event_loop_timer()).state }
            == EventLoopTimerState::CANCELLED
            || self.flags.has_cleared_timer()
            || unsafe { (*vm).script_execution_status() } != ScriptExecutionStatus::Running
            || self.generation != unsafe { (*vm).test_isolation_generation };

        // SAFETY: `event_loop_timer()` derives a pointer into the live parent.
        unsafe { (*self.event_loop_timer()).state = EventLoopTimerState::FIRED };

        // SAFETY: `vm` is live; `global` is the per-VM JSGlobalObject pointer.
        let global_this = unsafe { (*vm).global };
        let Some(this_object) = self.this_value.try_get() else {
            self.set_enable_keeping_event_loop_alive(vm, false);
            self.flags.set_has_cleared_timer(true);
            self.this_value.downgrade();
            self.deref();
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
                JSTimeout::callback_get_cached(this_object)
                    .expect("TimeoutObject callback slot"),
                JSTimeout::arguments_get_cached(this_object)
                    .expect("TimeoutObject arguments slot"),
                JSTimeout::idle_timeout_get_cached(this_object)
                    .expect("TimeoutObject idleTimeout slot"),
                JSTimeout::repeat_get_cached(this_object)
                    .expect("TimeoutObject repeat slot"),
            ),
        };

        if has_been_cleared || !callback.to_boolean() {
            // SAFETY: `vm`/`global_this` live per hook contract.
            if unsafe { (*vm).is_inspector_enabled() } {
                Debugger::did_cancel_async_call(
                    // SAFETY: `global_this` is `vm.global`, live for the call.
                    unsafe { &*global_this },
                    Debugger::AsyncCallType::DOMTimer,
                    async_id.async_id(),
                );
            }
            self.set_enable_keeping_event_loop_alive(vm, false);
            self.flags.set_has_cleared_timer(true);
            self.this_value.downgrade();
            self.deref();
            return;
        }

        // SAFETY: only read on the .setInterval path where it is written below.
        let mut time_before_call: Timespec = unsafe { core::mem::zeroed() };

        if kind != KindBig::SetInterval {
            self.this_value.downgrade();
        } else {
            time_before_call =
                Timespec::ms_from_now(TimespecMockMode::AllowMockedTime, i64::from(self.interval));
        }
        this_object.ensure_still_alive();

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        // SAFETY: `vm` is live; `event_loop()` returns `*mut` to the embedded
        // EventLoop. Re-entrancy is permitted by the raw-ptr contract above.
        unsafe { (*(*vm).event_loop()).enter() };
        {
            // Ensure it stays alive for this scope.
            self.ref_();
            // PORT NOTE: Zig `defer this.deref()` — moved to the end of this
            // block. Every path through the labelled-block + `is_timer_done`
            // tail reaches it (no `return` between here and the deref).

            let _ = self.run(
                global_this,
                this_object,
                callback,
                arguments,
                async_id.async_id(),
                vm,
            );

            match kind {
                KindBig::SetTimeout | KindBig::SetInterval => {
                    idle_timeout = JSTimeout::idle_timeout_get_cached(this_object)
                        .expect("TimeoutObject idleTimeout slot");
                    repeat = JSTimeout::repeat_get_cached(this_object)
                        .expect("TimeoutObject repeat slot");
                }
                KindBig::SetImmediate => {}
            }

            let is_timer_done = 'is_timer_done: {
                // Node doesn't drain microtasks after each timer callback.
                if kind == KindBig::SetInterval {
                    if !self.should_reschedule_timer(repeat, idle_timeout) {
                        break 'is_timer_done true;
                    }
                    // SAFETY: `event_loop_timer()` still valid — `ref_()` above pins.
                    match unsafe { (*self.event_loop_timer()).state } {
                        EventLoopTimerState::FIRED => {
                            // If we didn't clear the setInterval, reschedule it starting from
                            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
                            // single-threaded JS heap so no concurrent `&mut` to
                            // `.timer`. `event_loop_timer()` derives a fresh raw
                            // ptr (no `&mut` aliasing across `update`).
                            unsafe {
                                (*state)
                                    .timer
                                    .update(self.event_loop_timer(), &time_before_call)
                            };

                            if self.flags.has_js_ref() {
                                self.set_enable_keeping_event_loop_alive(vm, true);
                            }

                            // The ref count doesn't change. It wasn't decremented.
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback.
                            // SAFETY: as above.
                            unsafe {
                                (*state)
                                    .timer
                                    .update(self.event_loop_timer(), &time_before_call)
                            };

                            // Balance out the ref count.
                            // the transition from "FIRED" -> "ACTIVE" caused it to increment.
                            self.deref();
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
                                self.convert_to_interval(global_this, this_object, repeat, vm);
                            }
                        }
                    }

                    // SAFETY: `event_loop_timer()` still valid — `ref_()` above pins.
                    match unsafe { (*self.event_loop_timer()).state } {
                        EventLoopTimerState::FIRED => {
                            break 'is_timer_done true;
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback,
                            // or the timer was converted to an interval via t._repeat. Balance out
                            // the ref count: the transition from "FIRED" -> "ACTIVE" via
                            // reschedule() caused it to increment.
                            self.deref();
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
                self.set_enable_keeping_event_loop_alive(vm, false);
                // The timer will not be re-entered into the event loop at this point.
                self.deref();
            }

            // PORT NOTE: Zig `defer this.deref()` — end of pinned scope. After
            // this `self` may be freed; do not touch past this block.
            self.deref();
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
    fn convert_to_interval(
        &mut self,
        global: *mut JSGlobalObject,
        timer: JSValue,
        repeat: JSValue,
        vm: *mut VirtualMachine,
    ) {
        debug_assert!(self.flags.kind() == Kind::SetTimeout);

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
        // SAFETY: `global` is `vm.global`, live for the call.
        JSTimeout::idle_timeout_set_cached(timer, unsafe { &*global }, repeat);
        // SAFETY: as above.
        self.this_value.set_strong(timer, unsafe { &*global });
        self.flags.set_kind(Kind::SetInterval);
        self.interval = new_interval;
        self.reschedule(timer, vm, global);
    }

    /// Spec TimerObjectInternals.zig `shouldRescheduleTimer`.
    fn should_reschedule_timer(&self, repeat: JSValue, idle_timeout: JSValue) -> bool {
        if self.flags.kind() == Kind::SetInterval && repeat.is_null() {
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
        &mut self,
        timer: JSValue,
        vm: *mut VirtualMachine,
        global_this: *mut JSGlobalObject,
    ) {
        if self.flags.kind() == Kind::SetImmediate {
            return;
        }

        let idle_timeout = JSTimeout::idle_timeout_get_cached(timer)
            .expect("TimeoutObject idleTimeout slot");
        let repeat = JSTimeout::repeat_get_cached(timer)
            .expect("TimeoutObject repeat slot");

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if !self.should_reschedule_timer(repeat, idle_timeout) {
            return;
        }

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        let now = Timespec::now(TimespecMockMode::AllowMockedTime);
        let scheduled_time = now.add_ms(i64::from(self.interval));
        // SAFETY: `event_loop_timer()` derives a pointer into the live parent.
        let was_active =
            unsafe { (*self.event_loop_timer()).state } == EventLoopTimerState::ACTIVE;
        if was_active {
            // SAFETY: `state` is the boxed per-thread `RuntimeState`; fresh
            // `&mut` to `.timer` for this call only.
            unsafe { (*state).timer.remove(self.event_loop_timer()) };
        } else {
            self.ref_();
        }

        // SAFETY: as above — `event_loop_timer()` derives a fresh raw ptr (no
        // `&mut` aliasing across `update`).
        unsafe { (*state).timer.update(self.event_loop_timer(), &scheduled_time) };
        self.flags.set_has_cleared_timer(false);

        // Set _idleStart to the current monotonic timestamp in milliseconds
        // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
        JSTimeout::idle_start_set_cached(
            timer,
            // SAFETY: `global_this` is `vm.global`, live for the call.
            unsafe { &*global_this },
            JSValue::js_number(now.ms_unsigned() as f64),
        );

        if self.flags.has_js_ref() {
            self.set_enable_keeping_event_loop_alive(vm, true);
        }
    }

    /// Spec TimerObjectInternals.zig `deinit` — final teardown invoked by the
    /// parent container's intrusive-refcount destructor (`{Timeout,Immediate}
    /// Object::deref` when the count hits zero). Unlinks the parent from every
    /// `Timer::All` data structure it may still be reachable from so the
    /// imminent `Box::from_raw` free cannot leave a dangling
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
        let vm = VirtualMachine::get();
        let kind = self.flags.kind();

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        // (b) `vm.timer.remove(eventLoopTimer())` if state == .ACTIVE — without
        //     this the freed parent stays linked into `All.timers` and the next
        //     `delete_min`/`drain_timers` dereferences freed memory.
        let elt = self.event_loop_timer();
        // SAFETY: `elt` derived from the live parent (see fn contract).
        if unsafe { (*elt).state } == EventLoopTimerState::ACTIVE {
            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer`.
            unsafe { (*state).timer.remove(elt) };
        }

        // (c) `vm.timer.maps.get(kind).orderedRemove(id)` if
        //     `has_accessed_primitive` — drops the i32→*mut EventLoopTimer
        //     entry minted by `toPrimitive`.
        if self.flags.has_accessed_primitive() {
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
    /// Read-only `@fieldParentPtr` to the owning `EventLoopTimer.state`.
    /// Mirror of [`Self::event_loop_timer`] for `&self` callers (`get_destroyed`).
    fn event_loop_timer_state(&self) -> EventLoopTimerState {
        match self.flags.kind() {
            // SAFETY: `kind == SetImmediate` ⇒ `self` is the `internals` field
            // of a live `ImmediateObject` (set in `init()`); read-only deref.
            Kind::SetImmediate => unsafe {
                (*(self as *const Self as *const u8)
                    .sub(offset_of!(ImmediateObject, internals))
                    .cast::<ImmediateObject>())
                .event_loop_timer
                .state
            },
            // SAFETY: as above for `TimeoutObject`.
            Kind::SetTimeout | Kind::SetInterval => unsafe {
                (*(self as *const Self as *const u8)
                    .sub(offset_of!(TimeoutObject, internals))
                    .cast::<TimeoutObject>())
                .event_loop_timer
                .state
            },
        }
    }

    /// Spec TimerObjectInternals.zig `doRef`.
    pub fn do_ref(&mut self, _global: &JSGlobalObject, this_value: JSValue) -> JsResult<JSValue> {
        this_value.ensure_still_alive();

        let did_have_js_ref = self.flags.has_js_ref();
        self.flags.set_has_js_ref(true);

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L256
        // and
        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L685-L687
        // Node only re-enables the keep-alive ref when `!this._destroyed`. Checking
        // `has_cleared_timer` alone is not sufficient: a one-shot timer that has already fired
        // has `has_cleared_timer == false` but is still destroyed. Calling `.unref(); .ref()`
        // on such a timer would otherwise leak an event-loop ref and hang the process.
        if !did_have_js_ref && !self.get_destroyed() {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get(), true);
        }

        Ok(this_value)
    }

    /// Spec TimerObjectInternals.zig `doUnref`.
    pub fn do_unref(&mut self, _global: &JSGlobalObject, this_value: JSValue) -> JsResult<JSValue> {
        this_value.ensure_still_alive();

        let did_have_js_ref = self.flags.has_js_ref();
        self.flags.set_has_js_ref(false);

        if did_have_js_ref {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get(), false);
        }

        Ok(this_value)
    }

    /// Spec TimerObjectInternals.zig `doRefresh`.
    pub fn do_refresh(
        &mut self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        // Immediates do not have a refresh function, and our binding generator should not let this
        // function be reached even if you override the `this` value calling a Timeout object's
        // `refresh` method
        debug_assert!(self.flags.kind() != Kind::SetImmediate);

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if self.id == -1
            || self.flags.kind() == Kind::SetImmediate
            || self.flags.has_cleared_timer()
        {
            return Ok(this_value);
        }

        self.this_value.set_strong(this_value, global_object);
        self.reschedule(this_value, VirtualMachine::get(), global_object.as_ptr());

        Ok(this_value)
    }

    /// Spec TimerObjectInternals.zig `hasRef`.
    pub fn has_ref(&self) -> JsResult<JSValue> {
        Ok(JSValue::from(self.flags.is_keeping_event_loop_alive()))
    }

    /// Spec TimerObjectInternals.zig `toPrimitive` — first access mints an
    /// `id → *mut EventLoopTimer` entry in `All.maps` so `clearTimeout(+t)` /
    /// `clearImmediate(+t)` (numeric-id form) can resolve it.
    ///
    /// PORT NOTE (b2-cycle): `vm.timer.maps` resolved via `runtime_state()`.
    pub fn to_primitive(&mut self) -> JsResult<JSValue> {
        if !self.flags.has_accessed_primitive() {
            self.flags.set_has_accessed_primitive(true);
            let state = crate::jsc_hooks::runtime_state();
            debug_assert!(!state.is_null(), "RuntimeState not installed");
            // PORT NOTE: reshaped for borrowck — capture `event_loop_timer` ptr
            // before borrowing `(*state).timer.maps`.
            let elt = self.event_loop_timer();
            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer.maps`.
            unsafe { (*state).timer.maps.get(self.flags.kind()).put(self.id, elt) }?;
        }
        Ok(JSValue::js_number(f64::from(self.id)))
    }

    /// Spec TimerObjectInternals.zig `getDestroyed` — getter for `_destroyed`
    /// on JS Timeout and Immediate objects.
    pub fn get_destroyed(&self) -> bool {
        if self.flags.has_cleared_timer() {
            return true;
        }
        if self.flags.in_callback() {
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
    pub fn finalize(&mut self) {
        self.this_value.finalize();
        self.deref();
    }

    /// Spec TimerObjectInternals.zig `cancel` — `clearTimeout`/`clearInterval`
    /// / `clearImmediate` / `Timeout#[Symbol.dispose]` body.
    ///
    /// PORT NOTE: takes `*mut VirtualMachine` (NOT `&mut`) — callers hand over
    /// `global.bun_vm()` (raw ptr) and the body forwards to
    /// `set_enable_keeping_event_loop_alive` which already uses the raw-ptr
    /// contract. `vm.timer` resolved via `runtime_state()` (b2-cycle).
    pub fn cancel(&mut self, vm: *mut VirtualMachine) {
        self.set_enable_keeping_event_loop_alive(vm, false);
        self.flags.set_has_cleared_timer(true);

        if self.flags.kind() == Kind::SetImmediate {
            // Release the strong reference so the GC can collect the JS object.
            // The immediate task is still in the event loop queue and will be skipped
            // by runImmediateTask when it sees has_cleared_timer == true.
            self.this_value.downgrade();
            return;
        }

        let elt = self.event_loop_timer();
        // SAFETY: `elt` derived from the live parent (see `event_loop_timer`).
        let was_active = unsafe { (*elt).state } == EventLoopTimerState::ACTIVE;
        // SAFETY: as above.
        unsafe { (*elt).state = EventLoopTimerState::CANCELLED };
        self.this_value.downgrade();

        if was_active {
            let state = crate::jsc_hooks::runtime_state();
            debug_assert!(!state.is_null(), "RuntimeState not installed");
            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer`.
            unsafe { (*state).timer.remove(elt) };
            self.deref();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/TimerObjectInternals.zig
//   confidence: medium — struct/flags + runImmediateTask + fire + reschedule
//               + deinit real; init/cancel/do_{ref,unref,refresh}/to_primitive
//               remain in gated draft.
//   notes:      `vm.timer` resolved via `jsc_hooks::runtime_state()` (b2-cycle
//               — low-tier VirtualMachine.timer is `()`). `defer` in
//               fire()/run() linearized — verified no early-return paths skip
//               deref.
// ──────────────────────────────────────────────────────────────────────────
