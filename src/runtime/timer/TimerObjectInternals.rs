use core::mem::offset_of;

use crate::jsc::{Debugger, JSGlobalObject, JSValue, JsRef, JsResult, ScriptExecutionStatus};
use crate::jsc::generated::{JSImmediate, JSTimeout};
// `bun_jsc::VirtualMachine` is a module re-export (`pub use self::virtual_machine as VirtualMachine`);
// the struct lives at `bun_jsc::virtual_machine::VirtualMachine`.
use crate::jsc::virtual_machine::VirtualMachine;
// `bun.timespec` is `bun_core::Timespec` (lowercase `timespec` is a type alias, not a module)
use bun_core::{Timespec, TimespecMockMode};

use super::{
    EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, ImmediateObject, Kind, KindBig,
    TimeoutObject, ID,
};

/// Data that TimerObject and ImmediateObject have in common
#[repr(C)]
pub struct TimerObjectInternals {
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`)
    pub id: i32,
    pub interval: u32, // Zig: u31
    pub this_value: JsRef,
    pub flags: Flags,
    /// `bun test --isolate` generation this timer was created in. If it no
    /// longer matches `vm.test_isolation_generation` at fire time, the timer
    /// is dropped without invoking its callback.
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

/// Used by:
/// - setTimeout
/// - setInterval
/// - setImmediate
/// - AbortSignal.Timeout
///
/// Zig: `packed struct(u32)` with mixed-width fields. Layout (LSB→MSB):
///   epoch:u25, kind:u2, has_cleared_timer:1, is_keeping_event_loop_alive:1,
///   has_accessed_primitive:1, has_js_ref:1, in_callback:1
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct Flags(u32);

impl Default for Flags {
    fn default() -> Self {
        // epoch=0, kind=.setTimeout(0), has_cleared_timer=false,
        // is_keeping_event_loop_alive=false, has_accessed_primitive=false,
        // has_js_ref=true, in_callback=false
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

    /// Whenever a timer is inserted into the heap (which happen on creation or refresh), the global
    /// epoch is incremented and the new epoch is set on the timer. For timers created by
    /// JavaScript, the epoch is used to break ties between timers scheduled for the same
    /// millisecond. This ensures that if you set two timers for the same amount of time, and
    /// refresh the first one, the first one will fire last. This mimics Node.js's behavior where
    /// the refreshed timer will be inserted at the end of a list, which makes it fire later.
    #[inline]
    pub fn epoch(self) -> u32 {
        self.0 & Self::EPOCH_MASK
    }
    #[inline]
    pub fn set_epoch(&mut self, v: u32) {
        self.0 = (self.0 & !Self::EPOCH_MASK) | (v & Self::EPOCH_MASK);
    }

    /// Kind does not include AbortSignal's timeout since it has no corresponding ID callback.
    #[inline]
    pub fn kind(self) -> Kind {
        // SAFETY: Kind is #[repr(u2)] with 3 variants; stored value always written via set_kind.
        unsafe { core::mem::transmute::<u8, Kind>(((self.0 & Self::KIND_MASK) >> Self::KIND_SHIFT) as u8) }
    }
    #[inline]
    pub fn set_kind(&mut self, k: Kind) {
        self.0 = (self.0 & !Self::KIND_MASK) | ((k as u32) << Self::KIND_SHIFT);
    }

    // we do not allow the timer to be refreshed after we call clearInterval/clearTimeout
    #[inline]
    pub fn has_cleared_timer(self) -> bool {
        self.0 & Self::HAS_CLEARED_TIMER != 0
    }
    #[inline]
    pub fn set_has_cleared_timer(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_CLEARED_TIMER } else { self.0 &= !Self::HAS_CLEARED_TIMER }
    }

    #[inline]
    pub fn is_keeping_event_loop_alive(self) -> bool {
        self.0 & Self::IS_KEEPING_EVENT_LOOP_ALIVE != 0
    }
    #[inline]
    pub fn set_is_keeping_event_loop_alive(&mut self, v: bool) {
        if v { self.0 |= Self::IS_KEEPING_EVENT_LOOP_ALIVE } else { self.0 &= !Self::IS_KEEPING_EVENT_LOOP_ALIVE }
    }

    // if they never access the timer by integer, don't create a hashmap entry.
    #[inline]
    pub fn has_accessed_primitive(self) -> bool {
        self.0 & Self::HAS_ACCESSED_PRIMITIVE != 0
    }
    #[inline]
    pub fn set_has_accessed_primitive(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_ACCESSED_PRIMITIVE } else { self.0 &= !Self::HAS_ACCESSED_PRIMITIVE }
    }

    #[inline]
    pub fn has_js_ref(self) -> bool {
        self.0 & Self::HAS_JS_REF != 0
    }
    #[inline]
    pub fn set_has_js_ref(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_JS_REF } else { self.0 &= !Self::HAS_JS_REF }
    }

    /// Set to `true` only during execution of the JavaScript function so that `_destroyed` can be
    /// false during the callback, even though the `state` will be `FIRED`.
    #[inline]
    pub fn in_callback(self) -> bool {
        self.0 & Self::IN_CALLBACK != 0
    }
    #[inline]
    pub fn set_in_callback(&mut self, v: bool) {
        if v { self.0 |= Self::IN_CALLBACK } else { self.0 &= !Self::IN_CALLBACK }
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Bun__JSTimeout__call(
        global_object: *mut JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
    ) -> bool;
}

impl TimerObjectInternals {
    /// PORT NOTE (b2-cycle): `vm.timer` is `()` on the low-tier `VirtualMachine`;
    /// the real `timer::All` lives in `RuntimeState`. Recover it as a raw ptr.
    #[inline]
    fn timer_all() -> *mut super::All {
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`.
        unsafe { core::ptr::addr_of_mut!((*state).timer) }
    }

    fn event_loop_timer(&mut self) -> &mut EventLoopTimer {
        match self.flags.kind() {
            Kind::SetImmediate => {
                // SAFETY: self points to ImmediateObject.internals
                let parent = unsafe {
                    &mut *(self as *mut Self as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>()
                };
                debug_assert!(parent.event_loop_timer.tag == EventLoopTimerTag::ImmediateObject);
                &mut parent.event_loop_timer
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: self points to TimeoutObject.internals
                let parent = unsafe {
                    &mut *(self as *mut Self as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>()
                };
                debug_assert!(parent.event_loop_timer.tag == EventLoopTimerTag::TimeoutObject);
                &mut parent.event_loop_timer
            }
        }
    }

    fn ref_(&mut self) {
        match self.flags.kind() {
            Kind::SetImmediate => {
                // SAFETY: self points to ImmediateObject.internals; ref_ contract
                // requires a live heap allocation, which holds for any path that
                // reaches here.
                unsafe {
                    ImmediateObject::ref_(
                        (self as *mut Self as *mut u8)
                            .sub(offset_of!(ImmediateObject, internals))
                            .cast::<ImmediateObject>(),
                    )
                }
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: self points to TimeoutObject.internals
                unsafe {
                    TimeoutObject::ref_(
                        (self as *mut Self as *mut u8)
                            .sub(offset_of!(TimeoutObject, internals))
                            .cast::<TimeoutObject>(),
                    )
                }
            }
        }
    }

    fn deref(&mut self) {
        match self.flags.kind() {
            Kind::SetImmediate => {
                // SAFETY: self points to ImmediateObject.internals; deref may free
                // the parent — caller must not touch `self` after a final deref.
                unsafe {
                    ImmediateObject::deref(
                        (self as *mut Self as *mut u8)
                            .sub(offset_of!(ImmediateObject, internals))
                            .cast::<ImmediateObject>(),
                    )
                }
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: self points to TimeoutObject.internals
                unsafe {
                    TimeoutObject::deref(
                        (self as *mut Self as *mut u8)
                            .sub(offset_of!(TimeoutObject, internals))
                            .cast::<TimeoutObject>(),
                    )
                }
            }
        }
    }

    /// returns true if an exception was thrown
    ///
    /// PORT NOTE: takes `*mut VirtualMachine` (NOT `&mut`) — the body calls
    /// `vm.event_loop().enter()` then re-enters JS which may itself touch the
    /// VM/EventLoop; aliased `&mut` would be UB.
    pub fn run_immediate_task(&mut self, vm: *mut VirtualMachine) -> bool {
        // SAFETY: `vm` is the live per-thread VM (hook contract).
        let cleared = self.flags.has_cleared_timer()
            || self.generation != unsafe { (*vm).test_isolation_generation }
            // unref'd setImmediate callbacks should only run if there are things keeping the event
            // loop alive other than setImmediates
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
        self.event_loop_timer().state = EventLoopTimerState::FIRED;
        self.set_enable_keeping_event_loop_alive(vm, false);
        timer.ensure_still_alive();

        // SAFETY: `vm` is live; `event_loop()` returns `*mut` to the embedded EventLoop.
        unsafe { (*(*vm).event_loop()).enter() };
        let callback = JSImmediate::callback_get_cached(timer).unwrap();
        let arguments = JSImmediate::arguments_get_cached(timer).unwrap();

        let exception_thrown = {
            self.ref_();
            let result = self.run(global_this, timer, callback, arguments, self.async_id(), vm);
            // defer:
            if self.event_loop_timer().state == EventLoopTimerState::FIRED {
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

    pub fn async_id(&self) -> u64 {
        // LAYERING: `Kind` lives in `bun_event_loop`; `KindBig` here. Zig's
        // `Kind.big()` is the `From<Kind> for KindBig` impl in `super`.
        ID { id: self.id, kind: self.flags.kind().into() }.async_id()
    }

    pub fn fire(&mut self, _now: &Timespec, vm: *mut VirtualMachine) {
        let id = self.id;
        let kind: KindBig = self.flags.kind().into();
        let async_id = ID { id, kind };
        // SAFETY: `vm` is the live per-thread VM (FIRE_TIMER hook contract).
        let has_been_cleared = self.event_loop_timer().state == EventLoopTimerState::CANCELLED
            || self.flags.has_cleared_timer()
            || unsafe { (*vm).script_execution_status() } != ScriptExecutionStatus::Running
            || self.generation != unsafe { (*vm).test_isolation_generation };

        self.event_loop_timer().state = EventLoopTimerState::FIRED;

        // SAFETY: `vm` is live; `global` is the per-VM JSGlobalObject pointer.
        let global_this = unsafe { (*vm).global };
        let Some(this_object) = self.this_value.try_get() else {
            self.set_enable_keeping_event_loop_alive(vm, false);
            self.flags.set_has_cleared_timer(true);
            self.this_value.downgrade();
            self.deref();
            return;
        };

        let (callback, arguments, mut idle_timeout, mut repeat): (JSValue, JSValue, JSValue, JSValue) = match kind {
            KindBig::SetImmediate => (
                JSImmediate::callback_get_cached(this_object).unwrap(),
                JSImmediate::arguments_get_cached(this_object).unwrap(),
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
            ),
            KindBig::SetTimeout | KindBig::SetInterval => (
                JSTimeout::callback_get_cached(this_object).unwrap(),
                JSTimeout::arguments_get_cached(this_object).unwrap(),
                JSTimeout::idle_timeout_get_cached(this_object).unwrap(),
                JSTimeout::repeat_get_cached(this_object).unwrap(),
            ),
        };

        if has_been_cleared || !callback.to_boolean() {
            // SAFETY: `vm` is live.
            if unsafe { (*vm).is_inspector_enabled() } {
                // SAFETY: `global_this` is `vm.global`, live for the call.
                Debugger::did_cancel_async_call(
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
            time_before_call = Timespec::ms_from_now(TimespecMockMode::AllowMockedTime, i64::from(self.interval));
        }
        this_object.ensure_still_alive();

        let timer_all = Self::timer_all();

        // SAFETY: `vm` is live; `event_loop()` returns `*mut` to the embedded EventLoop.
        unsafe { (*(*vm).event_loop()).enter() };
        {
            // Ensure it stays alive for this scope.
            self.ref_();
            // defer self.deref(); — emulated at end of block

            let _ = self.run(global_this, this_object, callback, arguments, async_id.async_id(), vm);

            match kind {
                KindBig::SetTimeout | KindBig::SetInterval => {
                    idle_timeout = JSTimeout::idle_timeout_get_cached(this_object).unwrap();
                    repeat = JSTimeout::repeat_get_cached(this_object).unwrap();
                }
                _ => {}
            }

            let is_timer_done = 'is_timer_done: {
                // Node doesn't drain microtasks after each timer callback.
                if kind == KindBig::SetInterval {
                    if !self.should_reschedule_timer(repeat, idle_timeout) {
                        break 'is_timer_done true;
                    }
                    match self.event_loop_timer().state {
                        EventLoopTimerState::FIRED => {
                            // If we didn't clear the setInterval, reschedule it starting from
                            let elt: *mut EventLoopTimer = self.event_loop_timer();
                            // SAFETY: `timer_all` is the boxed per-thread `RuntimeState.timer`;
                            // single-threaded JS heap so no concurrent `&mut`.
                            unsafe { (*timer_all).update(elt, &time_before_call) };

                            if self.flags.has_js_ref() {
                                self.set_enable_keeping_event_loop_alive(vm, true);
                            }

                            // The ref count doesn't change. It wasn't decremented.
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback.
                            let elt: *mut EventLoopTimer = self.event_loop_timer();
                            // SAFETY: as above.
                            unsafe { (*timer_all).update(elt, &time_before_call) };

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
                                // SAFETY: `global_this` is `vm.global`, live for the call.
                                self.convert_to_interval(unsafe { &*global_this }, this_object, repeat);
                            }
                        }
                    }

                    match self.event_loop_timer().state {
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

            // defer self.deref();
            self.deref();
        }
        // SAFETY: `vm` is live; see `enter()` note above.
        unsafe { (*(*vm).event_loop()).exit() };
    }

    fn convert_to_interval(&mut self, global: &JSGlobalObject, timer: JSValue, repeat: JSValue) {
        debug_assert!(self.flags.kind() == Kind::SetTimeout);

        let vm = VirtualMachine::get_mut_ptr();

        let new_interval: u32 = if let Some(num) = repeat.get_number() {
            if num < 1.0 || num > (u32::MAX >> 1) as f64 {
                1
            } else {
                num as u32
            }
        } else {
            1
        };

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L613
        JSTimeout::idle_timeout_set_cached(timer, global, repeat);
        self.this_value.set_strong(timer, global);
        self.flags.set_kind(Kind::SetInterval);
        self.interval = new_interval;
        self.reschedule(timer, vm, global);
    }

    pub fn run(
        &mut self,
        // Zig spec: `globalThis: *jsc.JSGlobalObject` — keep as raw *mut so we
        // forward provenance to C++ without a `&T as *const T as *mut T` cast
        // (UB when C++ mutates VM/exception state through it).
        global_this: *mut JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        async_id: u64,
        vm: *mut VirtualMachine,
    ) -> bool {
        // SAFETY: `vm` is the live per-thread VM.
        if unsafe { (*vm).is_inspector_enabled() } {
            // SAFETY: `global_this` is `vm.global`, live for the duration of the call.
            Debugger::will_dispatch_async_call(unsafe { &*global_this }, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        // Bun__JSTimeout__call handles exceptions.
        self.flags.set_in_callback(true);
        // SAFETY: FFI call into C++ on the JS thread; `global_this` is the live
        // per-thread global and all JSValue args are GC-rooted by the caller.
        let result = unsafe {
            Bun__JSTimeout__call(global_this, timer, callback, arguments)
        };
        // defer self.flags.in_callback = false;
        self.flags.set_in_callback(false);

        // defer { if vm.isInspectorEnabled() ... }
        // SAFETY: `vm` is the live per-thread VM.
        if unsafe { (*vm).is_inspector_enabled() } {
            // SAFETY: as above.
            Debugger::did_dispatch_async_call(unsafe { &*global_this }, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        result
    }

    // TODO(port): in-place init — `self` is an embedded field of ImmediateObject/TimeoutObject;
    // cannot reshape to `-> Self` because the body uses @fieldParentPtr to reach the container.
    pub fn init(
        &mut self,
        timer: JSValue,
        global: &JSGlobalObject,
        id: i32,
        kind: Kind,
        interval: u32,
        callback: JSValue,
        arguments: JSValue,
    ) {
        let vm = VirtualMachine::get_mut_ptr();
        let timer_all = Self::timer_all();
        *self = Self {
            id,
            flags: {
                let mut f = Flags::default();
                f.set_kind(kind);
                // SAFETY: `timer_all` is the boxed per-thread `RuntimeState.timer`.
                f.set_epoch(unsafe { (*timer_all).epoch });
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
            // SAFETY: self points to ImmediateObject.internals
            let parent = unsafe {
                (self as *mut Self as *mut u8)
                    .sub(offset_of!(ImmediateObject, internals))
                    .cast::<ImmediateObject>()
            };
            // SAFETY: `vm` is the live per-thread VM. Low tier stores `*mut ()`
            // (PORTING.md §Dispatch); `run_immediate_task_hook` casts it back
            // to `*mut ImmediateObject`.
            unsafe { (*vm).enqueue_immediate_task(parent.cast()) };
            self.set_enable_keeping_event_loop_alive(vm, true);
            // ref'd by event loop
            // SAFETY: `parent` is a live heap allocation (see above).
            unsafe { ImmediateObject::ref_(parent) };
        } else {
            JSTimeout::arguments_set_cached(timer, global, arguments);
            JSTimeout::callback_set_cached(timer, global, callback);
            JSTimeout::idle_timeout_set_cached(timer, global, JSValue::js_number(f64::from(interval)));
            JSTimeout::repeat_set_cached(
                timer,
                global,
                if kind == Kind::SetInterval { JSValue::js_number(f64::from(interval)) } else { JSValue::NULL },
            );

            // this increments the refcount and sets _idleStart
            self.reschedule(timer, vm, global);
        }

        self.this_value.set_strong(timer, global);
    }

    pub fn do_ref(&mut self, _global: &JSGlobalObject, this_value: JSValue) -> JSValue {
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
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get_mut_ptr(), true);
        }

        this_value
    }

    pub fn do_refresh(&mut self, global_object: &JSGlobalObject, this_value: JSValue) -> JSValue {
        // Immediates do not have a refresh function, and our binding generator should not let this
        // function be reached even if you override the `this` value calling a Timeout object's
        // `refresh` method
        debug_assert!(self.flags.kind() != Kind::SetImmediate);

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if self.id == -1 || self.flags.kind() == Kind::SetImmediate || self.flags.has_cleared_timer() {
            return this_value;
        }

        self.this_value.set_strong(this_value, global_object);
        self.reschedule(this_value, VirtualMachine::get_mut_ptr(), global_object);

        this_value
    }

    pub fn do_unref(&mut self, _global: &JSGlobalObject, this_value: JSValue) -> JSValue {
        this_value.ensure_still_alive();

        let did_have_js_ref = self.flags.has_js_ref();
        self.flags.set_has_js_ref(false);

        if did_have_js_ref {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get_mut_ptr(), false);
        }

        this_value
    }

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

        let was_active = self.event_loop_timer().state == EventLoopTimerState::ACTIVE;

        self.event_loop_timer().state = EventLoopTimerState::CANCELLED;
        self.this_value.downgrade();

        if was_active {
            let elt: *mut EventLoopTimer = self.event_loop_timer();
            // SAFETY: per-thread `RuntimeState.timer`; single-threaded JS heap.
            unsafe { (*Self::timer_all()).remove(elt) };
            self.deref();
        }
    }

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

    pub fn reschedule(&mut self, timer: JSValue, vm: *mut VirtualMachine, global_this: &JSGlobalObject) {
        if self.flags.kind() == Kind::SetImmediate {
            return;
        }

        let idle_timeout = JSTimeout::idle_timeout_get_cached(timer).unwrap();
        let repeat = JSTimeout::repeat_get_cached(timer).unwrap();

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if !self.should_reschedule_timer(repeat, idle_timeout) {
            return;
        }

        let timer_all = Self::timer_all();

        let now = Timespec::now(TimespecMockMode::AllowMockedTime);
        let scheduled_time = now.add_ms(i64::from(self.interval));
        let was_active = self.event_loop_timer().state == EventLoopTimerState::ACTIVE;
        if was_active {
            let elt: *mut EventLoopTimer = self.event_loop_timer();
            // SAFETY: per-thread `RuntimeState.timer`; single-threaded JS heap.
            unsafe { (*timer_all).remove(elt) };
        } else {
            self.ref_();
        }

        let elt: *mut EventLoopTimer = self.event_loop_timer();
        // SAFETY: as above.
        unsafe { (*timer_all).update(elt, &scheduled_time) };
        self.flags.set_has_cleared_timer(false);

        // Set _idleStart to the current monotonic timestamp in milliseconds
        // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
        JSTimeout::idle_start_set_cached(timer, global_this, JSValue::js_number(now.ms_unsigned() as f64));

        if self.flags.has_js_ref() {
            self.set_enable_keeping_event_loop_alive(vm, true);
        }
    }

    fn set_enable_keeping_event_loop_alive(&mut self, vm: *mut VirtualMachine, enable: bool) {
        if self.flags.is_keeping_event_loop_alive() == enable {
            return;
        }
        self.flags.set_is_keeping_event_loop_alive(enable);
        let timer_all = Self::timer_all();
        // SAFETY: `vm` is the live per-thread VM (hook contract); field read only.
        let uws_loop = unsafe { (*vm).uws_loop() };
        let delta = if enable { 1 } else { -1 };
        match self.flags.kind() {
            // SAFETY: `timer_all` is the boxed per-thread `RuntimeState.timer`;
            // single-threaded JS heap so no concurrent `&mut`.
            Kind::SetTimeout | Kind::SetInterval => unsafe {
                (*timer_all).increment_timer_ref(delta, uws_loop)
            },
            // setImmediate has slightly different event loop logic
            // SAFETY: as above.
            Kind::SetImmediate => unsafe {
                (*timer_all).increment_immediate_ref(delta, uws_loop)
            },
        }
    }

    pub fn has_ref(&self) -> JSValue {
        JSValue::js_boolean(self.flags.is_keeping_event_loop_alive())
    }

    pub fn to_primitive(&mut self) -> JsResult<JSValue> {
        if !self.flags.has_accessed_primitive() {
            self.flags.set_has_accessed_primitive(true);
            // PORT NOTE: reshaped for borrowck — capture event_loop_timer ptr before borrowing maps
            let elt = self.event_loop_timer() as *mut EventLoopTimer;
            let kind = self.flags.kind();
            let id = self.id;
            // SAFETY: per-thread `RuntimeState.timer`; single-threaded JS heap.
            let map = unsafe { (*Self::timer_all()).maps.get(kind) };
            // PORT NOTE: Zig `try map.put(allocator, id, elt)` — `ArrayHashMap::put`
            // returns `Result<(), AllocError>`; OOM is unrecoverable here.
            map.put(id, elt).expect("OOM in TimeoutMap::put");
        }
        Ok(JSValue::js_number(f64::from(self.id)))
    }

    /// This is the getter for `_destroyed` on JS Timeout and Immediate objects
    pub fn get_destroyed(&mut self) -> bool {
        if self.flags.has_cleared_timer() {
            return true;
        }
        if self.flags.in_callback() {
            return false;
        }
        match self.event_loop_timer().state {
            EventLoopTimerState::ACTIVE | EventLoopTimerState::PENDING => false,
            EventLoopTimerState::FIRED | EventLoopTimerState::CANCELLED => true,
        }
    }

    pub fn finalize(&mut self) {
        self.this_value.finalize();
        self.deref();
    }

    // PORT NOTE: not `impl Drop` — `self` is an embedded field of ImmediateObject/TimeoutObject
    // whose intrusive-refcount destroy hook calls this explicitly and then frees the parent Box.
    // An `impl Drop` would (a) run a second time when the parent `Box::from_raw` drops its fields,
    // and (b) fire on the `*self = Self { ... }` whole-struct assignment in `init()`. Follows the
    // PORTING.md FFI/.classes.ts exception: explicit `unsafe fn destroy(*mut Self)` instead of `Drop`.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller is the parent's IntrusiveRc destroy hook; `this` is valid and uniquely owned.
        let s = unsafe { &mut *this };
        // PORT NOTE: Zig `this_value.deinit()` is handled by `JsRef: Drop` when the
        // parent `Box::from_raw` reclaims fields immediately after this returns.
        let vm = VirtualMachine::get_mut_ptr();
        let kind = s.flags.kind();
        let timer_all = Self::timer_all();

        if s.event_loop_timer().state == EventLoopTimerState::ACTIVE {
            let elt: *mut EventLoopTimer = s.event_loop_timer();
            // SAFETY: per-thread `RuntimeState.timer`; single-threaded JS heap.
            unsafe { (*timer_all).remove(elt) };
        }

        if s.flags.has_accessed_primitive() {
            // SAFETY: as above.
            let map = unsafe { (*timer_all).maps.get(kind) };
            if map.remove(&s.id).is_some() {
                // If this array gets large, let's shrink it down
                // Array keys are i32
                // Values are 1 ptr
                // Therefore, 12 bytes per entry
                // So if you created 21,000 timers and accessed them by ID, you'd be using 252KB
                // PORT NOTE: `bun_collections::ArrayHashMap` does not expose `capacity()`;
                // shrink-and-free heuristic omitted. Correctness is unaffected — only the
                // high-watermark capacity lingers.
                // TODO(port): plumb a `capacity()` once `ArrayHashMap` grows one and
                // restore the >256 KiB slack ⇒ `shrink_and_free(count() + 8)` heuristic.
                let _ = map;
            }
        }

        s.set_enable_keeping_event_loop_alive(vm, false);
        match kind {
            Kind::SetImmediate => {
                // SAFETY: `this` points to ImmediateObject.internals
                let rc = unsafe {
                    &(*(this as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>())
                    .ref_count
                };
                debug_assert_eq!(rc.get(), 0, "ImmediateObject ref_count not zero at destroy");
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: `this` points to TimeoutObject.internals
                let rc = unsafe {
                    &(*(this as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>())
                    .ref_count
                };
                debug_assert_eq!(rc.get(), 0, "TimeoutObject ref_count not zero at destroy");
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/TimerObjectInternals.zig (549 lines)
//   confidence: medium
//   todos:      6
//   notes:      packed Flags(u32) hand-coded; heavy @fieldParentPtr usage kept raw; defer in fire()/run() linearized — verify no early-return paths skip deref; deinit() reshaped to unsafe fn destroy(*mut Self) (parent IntrusiveRc owns teardown — callers in {Timeout,Immediate}Object.rs need s/deinit/destroy/); KindBig and codegen JSTimeout/JSImmediate accessors resolved via crate::jsc::generated; vm.timer resolved via jsc_hooks::runtime_state() (b2-cycle)
// ──────────────────────────────────────────────────────────────────────────
