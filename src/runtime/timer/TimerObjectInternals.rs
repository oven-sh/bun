use core::mem::offset_of;

use bun_jsc::{Debugger, JSGlobalObject, JSValue, JsRef, JsResult, VirtualMachine};
// TODO(port): verify crate location for `timespec` (bun.timespec)
use bun_core::timespec::Timespec;

use super::{EventLoopTimer, ImmediateObject, Kind, TimeoutMap, TimeoutObject, ID};

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
    fn event_loop_timer(&mut self) -> &mut EventLoopTimer {
        match self.flags.kind() {
            Kind::SetImmediate => {
                // SAFETY: self points to ImmediateObject.internals
                let parent = unsafe {
                    &mut *(self as *mut Self as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>()
                };
                debug_assert!(parent.event_loop_timer.tag == EventLoopTimer::Tag::ImmediateObject);
                &mut parent.event_loop_timer
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: self points to TimeoutObject.internals
                let parent = unsafe {
                    &mut *(self as *mut Self as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>()
                };
                debug_assert!(parent.event_loop_timer.tag == EventLoopTimer::Tag::TimeoutObject);
                &mut parent.event_loop_timer
            }
        }
    }

    fn ref_(&mut self) {
        match self.flags.kind() {
            Kind::SetImmediate => {
                // SAFETY: self points to ImmediateObject.internals
                unsafe {
                    (*(self as *mut Self as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>())
                    .ref_()
                }
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: self points to TimeoutObject.internals
                unsafe {
                    (*(self as *mut Self as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>())
                    .ref_()
                }
            }
        }
    }

    fn deref(&mut self) {
        match self.flags.kind() {
            Kind::SetImmediate => {
                // SAFETY: self points to ImmediateObject.internals
                unsafe {
                    (*(self as *mut Self as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>())
                    .deref()
                }
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: self points to TimeoutObject.internals
                unsafe {
                    (*(self as *mut Self as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>())
                    .deref()
                }
            }
        }
    }

    /// returns true if an exception was thrown
    pub fn run_immediate_task(&mut self, vm: &mut VirtualMachine) -> bool {
        if self.flags.has_cleared_timer()
            || self.generation != vm.test_isolation_generation
            // unref'd setImmediate callbacks should only run if there are things keeping the event
            // loop alive other than setImmediates
            || (!self.flags.is_keeping_event_loop_alive() && !vm.is_event_loop_alive_excluding_immediates())
        {
            self.set_enable_keeping_event_loop_alive(vm, false);
            self.this_value.downgrade();
            self.deref();
            return false;
        }

        let Some(timer) = self.this_value.try_get() else {
            if cfg!(debug_assertions) {
                panic!("TimerObjectInternals.runImmediateTask: this_object is null");
            }
            self.set_enable_keeping_event_loop_alive(vm, false);
            self.deref();
            return false;
        };
        let global_this = vm.global;
        self.this_value.downgrade();
        self.event_loop_timer().state = EventLoopTimer::State::FIRED;
        self.set_enable_keeping_event_loop_alive(vm, false);
        timer.ensure_still_alive();

        vm.event_loop().enter();
        let callback = ImmediateObject::js::callback_get_cached(timer).unwrap();
        let arguments = ImmediateObject::js::arguments_get_cached(timer).unwrap();

        let exception_thrown = {
            self.ref_();
            let result = self.run(global_this, timer, callback, arguments, self.async_id(), vm);
            // defer:
            if self.event_loop_timer().state == EventLoopTimer::State::FIRED {
                self.deref();
            }
            self.deref();
            result
        };
        // --- after this point, the timer is no longer guaranteed to be alive ---

        if vm.event_loop().exit_maybe_drain_microtasks(!exception_thrown).is_err() {
            return true;
        }

        exception_thrown
    }

    pub fn async_id(&self) -> u64 {
        ID::async_id(ID { id: self.id, kind: self.flags.kind().big() })
    }

    pub fn fire(&mut self, _now: &Timespec, vm: &mut VirtualMachine) {
        let id = self.id;
        let kind = self.flags.kind().big();
        let async_id = ID { id, kind };
        let has_been_cleared = self.event_loop_timer().state == EventLoopTimer::State::CANCELLED
            || self.flags.has_cleared_timer()
            || vm.script_execution_status() != ScriptExecutionStatus::Running
            || self.generation != vm.test_isolation_generation;

        self.event_loop_timer().state = EventLoopTimer::State::FIRED;

        let global_this = vm.global;
        let Some(this_object) = self.this_value.try_get() else {
            self.set_enable_keeping_event_loop_alive(vm, false);
            self.flags.set_has_cleared_timer(true);
            self.this_value.downgrade();
            self.deref();
            return;
        };

        let (callback, arguments, mut idle_timeout, mut repeat): (JSValue, JSValue, JSValue, JSValue) = match kind {
            Kind::Big::SetImmediate => (
                ImmediateObject::js::callback_get_cached(this_object).unwrap(),
                ImmediateObject::js::arguments_get_cached(this_object).unwrap(),
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
            ),
            Kind::Big::SetTimeout | Kind::Big::SetInterval => (
                TimeoutObject::js::callback_get_cached(this_object).unwrap(),
                TimeoutObject::js::arguments_get_cached(this_object).unwrap(),
                TimeoutObject::js::idle_timeout_get_cached(this_object).unwrap(),
                TimeoutObject::js::repeat_get_cached(this_object).unwrap(),
            ),
        };

        if has_been_cleared || !callback.to_boolean() {
            if vm.is_inspector_enabled() {
                Debugger::did_cancel_async_call(global_this, Debugger::AsyncCallType::DOMTimer, ID::async_id(async_id));
            }
            self.set_enable_keeping_event_loop_alive(vm, false);
            self.flags.set_has_cleared_timer(true);
            self.this_value.downgrade();
            self.deref();

            return;
        }

        // SAFETY: only read on the .setInterval path where it is written below.
        let mut time_before_call: Timespec = unsafe { core::mem::zeroed() };

        if kind != Kind::Big::SetInterval {
            self.this_value.downgrade();
        } else {
            time_before_call = Timespec::ms_from_now(Timespec::AllowMockedTime, self.interval);
        }
        this_object.ensure_still_alive();

        vm.event_loop().enter();
        {
            // Ensure it stays alive for this scope.
            self.ref_();
            // defer self.deref(); — emulated at end of block
            let _guard = scopeguard::guard((), |_| {
                // TODO(port): errdefer/defer — borrowck prevents capturing &mut self here; deref moved to end of block instead
            });

            let _ = self.run(global_this, this_object, callback, arguments, ID::async_id(async_id), vm);

            match kind {
                Kind::Big::SetTimeout | Kind::Big::SetInterval => {
                    idle_timeout = TimeoutObject::js::idle_timeout_get_cached(this_object).unwrap();
                    repeat = TimeoutObject::js::repeat_get_cached(this_object).unwrap();
                }
                _ => {}
            }

            let is_timer_done = 'is_timer_done: {
                // Node doesn't drain microtasks after each timer callback.
                if kind == Kind::Big::SetInterval {
                    if !self.should_reschedule_timer(repeat, idle_timeout) {
                        break 'is_timer_done true;
                    }
                    match self.event_loop_timer().state {
                        EventLoopTimer::State::FIRED => {
                            // If we didn't clear the setInterval, reschedule it starting from
                            vm.timer.update(self.event_loop_timer(), &time_before_call);

                            if self.flags.has_js_ref() {
                                self.set_enable_keeping_event_loop_alive(vm, true);
                            }

                            // The ref count doesn't change. It wasn't decremented.
                        }
                        EventLoopTimer::State::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback.
                            vm.timer.update(self.event_loop_timer(), &time_before_call);

                            // Balance out the ref count.
                            // the transition from "FIRED" -> "ACTIVE" caused it to increment.
                            self.deref();
                        }
                        _ => {
                            break 'is_timer_done true;
                        }
                    }
                } else {
                    if kind == Kind::Big::SetTimeout && !repeat.is_null() {
                        if let Some(num) = idle_timeout.get_number() {
                            if num != -1.0 {
                                // reschedule() inside convertToInterval will see state == .FIRED
                                // and add a ref; fall through to the switch below so the .ACTIVE
                                // arm can balance it.
                                self.convert_to_interval(global_this, this_object, repeat);
                            }
                        }
                    }

                    match self.event_loop_timer().state {
                        EventLoopTimer::State::FIRED => {
                            break 'is_timer_done true;
                        }
                        EventLoopTimer::State::ACTIVE => {
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
        vm.event_loop().exit();
    }

    fn convert_to_interval(&mut self, global: &JSGlobalObject, timer: JSValue, repeat: JSValue) {
        debug_assert!(self.flags.kind() == Kind::SetTimeout);

        let vm = global.bun_vm();

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
        TimeoutObject::js::idle_timeout_set_cached(timer, global, repeat);
        self.this_value.set_strong(timer, global);
        self.flags.set_kind(Kind::SetInterval);
        self.interval = new_interval;
        self.reschedule(timer, vm, global);
    }

    pub fn run(
        &mut self,
        global_this: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        async_id: u64,
        vm: &mut VirtualMachine,
    ) -> bool {
        if vm.is_inspector_enabled() {
            Debugger::will_dispatch_async_call(global_this, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        // Bun__JSTimeout__call handles exceptions.
        self.flags.set_in_callback(true);
        // SAFETY: FFI call into C++; arguments are valid JSC handles on the JS thread.
        let result = unsafe {
            Bun__JSTimeout__call(global_this as *const _ as *mut _, timer, callback, arguments)
        };
        // defer self.flags.in_callback = false;
        self.flags.set_in_callback(false);

        // defer { if vm.isInspectorEnabled() ... }
        if vm.is_inspector_enabled() {
            Debugger::did_dispatch_async_call(global_this, Debugger::AsyncCallType::DOMTimer, async_id);
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
        let vm = global.bun_vm();
        *self = Self {
            id,
            flags: {
                let mut f = Flags::default();
                f.set_kind(kind);
                f.set_epoch(vm.timer.epoch);
                f
            },
            interval,
            generation: vm.test_isolation_generation,
            this_value: JsRef::empty(),
        };

        if kind == Kind::SetImmediate {
            ImmediateObject::js::arguments_set_cached(timer, global, arguments);
            ImmediateObject::js::callback_set_cached(timer, global, callback);
            // SAFETY: self points to ImmediateObject.internals
            let parent = unsafe {
                &mut *(self as *mut Self as *mut u8)
                    .sub(offset_of!(ImmediateObject, internals))
                    .cast::<ImmediateObject>()
            };
            vm.enqueue_immediate_task(parent);
            self.set_enable_keeping_event_loop_alive(vm, true);
            // ref'd by event loop
            parent.ref_();
        } else {
            TimeoutObject::js::arguments_set_cached(timer, global, arguments);
            TimeoutObject::js::callback_set_cached(timer, global, callback);
            TimeoutObject::js::idle_timeout_set_cached(timer, global, JSValue::js_number(interval));
            TimeoutObject::js::repeat_set_cached(
                timer,
                global,
                if kind == Kind::SetInterval { JSValue::js_number(interval) } else { JSValue::NULL },
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
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get(), true);
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
        self.reschedule(this_value, VirtualMachine::get(), global_object);

        this_value
    }

    pub fn do_unref(&mut self, _global: &JSGlobalObject, this_value: JSValue) -> JSValue {
        this_value.ensure_still_alive();

        let did_have_js_ref = self.flags.has_js_ref();
        self.flags.set_has_js_ref(false);

        if did_have_js_ref {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get(), false);
        }

        this_value
    }

    pub fn cancel(&mut self, vm: &mut VirtualMachine) {
        self.set_enable_keeping_event_loop_alive(vm, false);
        self.flags.set_has_cleared_timer(true);

        if self.flags.kind() == Kind::SetImmediate {
            // Release the strong reference so the GC can collect the JS object.
            // The immediate task is still in the event loop queue and will be skipped
            // by runImmediateTask when it sees has_cleared_timer == true.
            self.this_value.downgrade();
            return;
        }

        let was_active = self.event_loop_timer().state == EventLoopTimer::State::ACTIVE;

        self.event_loop_timer().state = EventLoopTimer::State::CANCELLED;
        self.this_value.downgrade();

        if was_active {
            vm.timer.remove(self.event_loop_timer());
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

    pub fn reschedule(&mut self, timer: JSValue, vm: &mut VirtualMachine, global_this: &JSGlobalObject) {
        if self.flags.kind() == Kind::SetImmediate {
            return;
        }

        let idle_timeout = TimeoutObject::js::idle_timeout_get_cached(timer).unwrap();
        let repeat = TimeoutObject::js::repeat_get_cached(timer).unwrap();

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if !self.should_reschedule_timer(repeat, idle_timeout) {
            return;
        }

        let now = Timespec::now(Timespec::AllowMockedTime);
        let scheduled_time = now.add_ms(self.interval);
        let was_active = self.event_loop_timer().state == EventLoopTimer::State::ACTIVE;
        if was_active {
            vm.timer.remove(self.event_loop_timer());
        } else {
            self.ref_();
        }

        vm.timer.update(self.event_loop_timer(), &scheduled_time);
        self.flags.set_has_cleared_timer(false);

        // Set _idleStart to the current monotonic timestamp in milliseconds
        // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
        TimeoutObject::js::idle_start_set_cached(timer, global_this, JSValue::js_number(now.ms_unsigned()));

        if self.flags.has_js_ref() {
            self.set_enable_keeping_event_loop_alive(vm, true);
        }
    }

    fn set_enable_keeping_event_loop_alive(&mut self, vm: &mut VirtualMachine, enable: bool) {
        if self.flags.is_keeping_event_loop_alive() == enable {
            return;
        }
        self.flags.set_is_keeping_event_loop_alive(enable);
        match self.flags.kind() {
            Kind::SetTimeout | Kind::SetInterval => {
                vm.timer.increment_timer_ref(if enable { 1 } else { -1 })
            }
            // setImmediate has slightly different event loop logic
            Kind::SetImmediate => {
                vm.timer.increment_immediate_ref(if enable { 1 } else { -1 })
            }
        }
    }

    pub fn has_ref(&self) -> JSValue {
        JSValue::from(self.flags.is_keeping_event_loop_alive())
    }

    pub fn to_primitive(&mut self) -> JsResult<JSValue> {
        if !self.flags.has_accessed_primitive() {
            self.flags.set_has_accessed_primitive(true);
            let vm = VirtualMachine::get();
            // PORT NOTE: reshaped for borrowck — capture event_loop_timer ptr before borrowing vm.timer.maps
            let elt = self.event_loop_timer() as *mut EventLoopTimer;
            vm.timer.maps.get(self.flags.kind()).put(self.id, elt)?;
        }
        Ok(JSValue::js_number(self.id))
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
            EventLoopTimer::State::ACTIVE | EventLoopTimer::State::PENDING => false,
            EventLoopTimer::State::FIRED | EventLoopTimer::State::CANCELLED => true,
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
        // TODO(port): redundant once JsRef has Drop — parent's `drop(Box::from_raw)` runs field Drops
        s.this_value.deinit();
        let vm = VirtualMachine::get();
        let kind = s.flags.kind();

        if s.event_loop_timer().state == EventLoopTimer::State::ACTIVE {
            vm.timer.remove(s.event_loop_timer());
        }

        if s.flags.has_accessed_primitive() {
            let map = vm.timer.maps.get(kind);
            if map.ordered_remove(s.id) {
                // If this array gets large, let's shrink it down
                // Array keys are i32
                // Values are 1 ptr
                // Therefore, 12 bytes per entry
                // So if you created 21,000 timers and accessed them by ID, you'd be using 252KB
                let allocated_bytes = map.capacity() * core::mem::size_of::<<TimeoutMap as super::TimeoutMapExt>::Data>();
                let used_bytes = map.count() * core::mem::size_of::<<TimeoutMap as super::TimeoutMapExt>::Data>();
                // TODO(port): TimeoutMap.Data sizeof — verify Rust-side entry layout
                if allocated_bytes - used_bytes > 256 * 1024 {
                    map.shrink_and_free(map.count() + 8);
                }
            }
        }

        s.set_enable_keeping_event_loop_alive(vm, false);
        match kind {
            Kind::SetImmediate => {
                // SAFETY: `this` points to ImmediateObject.internals
                unsafe {
                    (*(this as *mut u8)
                        .sub(offset_of!(ImmediateObject, internals))
                        .cast::<ImmediateObject>())
                    .ref_count
                    .assert_no_refs()
                }
            }
            Kind::SetTimeout | Kind::SetInterval => {
                // SAFETY: `this` points to TimeoutObject.internals
                unsafe {
                    (*(this as *mut u8)
                        .sub(offset_of!(TimeoutObject, internals))
                        .cast::<TimeoutObject>())
                    .ref_count
                    .assert_no_refs()
                }
            }
        }
    }
}

// TODO(port): ScriptExecutionStatus enum location (bun_jsc)
use bun_jsc::ScriptExecutionStatus;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/TimerObjectInternals.zig (549 lines)
//   confidence: medium
//   todos:      7
//   notes:      packed Flags(u32) hand-coded; heavy @fieldParentPtr usage kept raw; defer in fire()/run() linearized — verify no early-return paths skip deref; deinit() reshaped to unsafe fn destroy(*mut Self) (parent IntrusiveRc owns teardown — callers in {Timeout,Immediate}Object.rs need s/deinit/destroy/); Kind::Big and codegen js:: accessors assumed from sibling modules
// ──────────────────────────────────────────────────────────────────────────
