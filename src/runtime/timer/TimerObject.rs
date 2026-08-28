//! `TimerObject<K>` — the `m_ctx` payload behind the JS `Timeout`
//! (`setTimeout` / `setInterval`) and `Immediate` (`setImmediate`) classes.

use core::cell::Cell;
use core::marker::PhantomData;

use bun_core::{Timespec, TimespecMockMode};
use bun_ptr::{AsCtxPtr as _, RefCount, RefPtr};

use crate::generated_classes::{js_Immediate, js_Timeout};
use crate::jsc::virtual_machine::VirtualMachine;
use crate::jsc::{
    CallFrame, Debugger, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, ScriptExecutionStatus,
};

use super::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, ID, Kind, KindBig,
};

// LAYERING: `Flags` (the packed-u32 state machine) lives in
// `bun_event_loop::EventLoopTimer::TimerFlags` so `bun_jsc::abort_signal::Timeout`
// can name it without a forward dep on this crate.
pub use bun_event_loop::EventLoopTimer::TimerFlags as Flags;

// C++ symbol emitted from NodeTimerObject.cpp.
unsafe extern "C" {
    safe fn Bun__JSTimeout__call(
        global_object: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
    ) -> bool;
}

/// Per-JS-class hooks for [`TimerObject`]: the timer-heap tag and the
/// codegen'd `JSTimeout` / `JSImmediate` wrapper accessors.
pub trait TimerKind: Sized + 'static {
    const TAG: EventLoopTimerTag;
    const JS_NAME: &'static str;

    /// `${JS_NAME}__create` — transfer ownership of `ptr` to a new JS wrapper.
    fn create(ptr: *mut TimerObject<Self>, global: &JSGlobalObject) -> JSValue;
    fn from_js(value: JSValue) -> Option<*mut TimerObject<Self>>;
    fn from_js_direct(value: JSValue) -> Option<*mut TimerObject<Self>>;
    fn get_constructor(global: &JSGlobalObject) -> JSValue;
    fn callback_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn callback_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
    fn arguments_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn arguments_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
}

macro_rules! impl_timer_kind {
    ($K:ident, $tag:ident, $js_name:literal, $gen:ident) => {
        pub struct $K;
        impl TimerKind for $K {
            const TAG: EventLoopTimerTag = EventLoopTimerTag::$tag;
            const JS_NAME: &'static str = $js_name;
            #[inline]
            fn create(ptr: *mut TimerObject<Self>, global: &JSGlobalObject) -> JSValue {
                $gen::to_js(ptr, global)
            }
            #[inline]
            fn from_js(value: JSValue) -> Option<*mut TimerObject<Self>> {
                $gen::from_js(value).map(|p| p.as_ptr())
            }
            #[inline]
            fn from_js_direct(value: JSValue) -> Option<*mut TimerObject<Self>> {
                $gen::from_js_direct(value).map(|p| p.as_ptr())
            }
            #[inline]
            fn get_constructor(global: &JSGlobalObject) -> JSValue {
                $gen::get_constructor(global)
            }
            #[inline]
            fn callback_get_cached(this_value: JSValue) -> Option<JSValue> {
                $gen::callback_get_cached(this_value)
            }
            #[inline]
            fn callback_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
                $gen::callback_set_cached(this_value, global, value)
            }
            #[inline]
            fn arguments_get_cached(this_value: JSValue) -> Option<JSValue> {
                $gen::arguments_get_cached(this_value)
            }
            #[inline]
            fn arguments_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
                $gen::arguments_set_cached(this_value, global, value)
            }
        }
    };
}
impl_timer_kind!(Timeout, TimeoutObject, "Timeout", js_Timeout);
impl_timer_kind!(Immediate, ImmediateObject, "Immediate", js_Immediate);

#[derive(bun_ptr::RefCounted)]
pub struct TimerObject<K: TimerKind> {
    ref_count: RefCount<Self>,
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`).
    pub(crate) id: i32,
    interval: Cell<u32>,
    this_value: JsCell<JsRef>,
    pub(crate) flags: Cell<Flags>,
    /// `bun test --isolate` generation this timer was created in.
    generation: u32,
    _kind: PhantomData<K>,
}

pub type TimeoutObject = TimerObject<Timeout>;
pub type ImmediateObject = TimerObject<Immediate>;

impl<K: TimerKind> bun_jsc::JsClass for TimerObject<K> {
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        // Ownership of the box transfers to the C++ wrapper (released via
        // `${JS_NAME}Class__finalize`).
        K::create(bun_core::heap::into_raw(Box::new(self)), global)
    }
    fn from_js(value: JSValue) -> Option<*mut Self> {
        K::from_js(value)
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        K::from_js_direct(value)
    }
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        K::get_constructor(global)
    }
}

impl<K: TimerKind> Drop for TimerObject<K> {
    /// Unlinks `self` from every `Timer::All` data structure it may still be
    /// reachable from so the free cannot leave a dangling `*mut EventLoopTimer`
    /// in the heap or a leaked keep-alive count. `this_value` is released by
    /// `JsRef: Drop` right after.
    fn drop(&mut self) {
        let vm = VirtualMachine::get_mut_ptr();
        let kind = self.flags.get().kind();

        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        if self.event_loop_timer_state() == EventLoopTimerState::ACTIVE {
            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer`.
            unsafe { (*state).timer.remove(self.event_loop_timer.as_ptr()) };
        }

        // Drop the i32→*mut EventLoopTimer entry minted by `to_primitive`.
        // Swap-remove: the id map is only ever keyed into, never iterated in
        // order, and this runs for every id-accessed timer a GC sweep collects,
        // so the ordered remove's O(n) shift + index rebuild here was O(n²)
        // across a sweep.
        if self.flags.get().has_accessed_primitive() {
            // SAFETY: as above — fresh `&mut` to `.timer.maps` for this call.
            let map = unsafe { (*state).timer.maps.get(kind) };
            if map.swap_remove(&self.id) {
                // If this map got large, shrink it back down. Keys are i32,
                // values are one pointer (~12 bytes per entry), so 21,000
                // timers accessed by ID ≈ 252 KiB; reclaim once the slack
                // exceeds 256 KiB.
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
                // `*mut EventLoopTimer` after `self` is freed.
                // SAFETY: as above.
                unsafe { (*state).timer.maps.set_timeout.swap_remove(&self.id) };
            }
        }

        // Without this a dropped-while-ref'd timer leaks `active_timer_count` /
        // `immediate_ref_count` and the process hangs at exit.
        self.set_enable_keeping_event_loop_alive(vm, false);
    }
}

impl<K: TimerKind> TimerObject<K> {
    /// Recover `*mut Self` from a pointer to its `event_loop_timer` slot.
    ///
    /// # Safety
    /// `t` must point at the `event_loop_timer` field of a live `Self`.
    #[inline]
    pub unsafe fn from_timer_ptr(t: *const EventLoopTimer) -> *mut Self {
        // SAFETY: caller contract — `t` addresses `Self.event_loop_timer`
        // with whole-`Self` provenance.
        unsafe { bun_core::from_field_ptr!(Self, event_loop_timer, t) }
    }

    #[inline]
    fn ref_(&self) {
        // SAFETY: `self` is live; only the interior-mutable count is touched.
        unsafe { RefCount::<Self>::ref_(self.as_ctx_ptr()) };
    }

    /// After this returns, `self` may be dangling — do not touch.
    #[inline]
    fn deref(&self) {
        // SAFETY: `self` is the live heap allocation; every mutated field is
        // `Cell`/`JsCell`, so `Drop` writes only through interior-mutable
        // storage. Callers do not touch `self` after this when it was the last ref.
        unsafe { RefCount::<Self>::deref(self.as_ctx_ptr()) };
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant JS).
    #[inline]
    fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    #[inline]
    fn event_loop_timer_state(&self) -> EventLoopTimerState {
        self.event_loop_timer.get().state
    }

    #[inline]
    fn set_event_loop_timer_state(&self, state: EventLoopTimerState) {
        self.event_loop_timer.with_mut(|t| t.state = state);
    }

    /// Read-modify-write `self.flags` through the `Cell` (interior-mutable so
    /// `&self` host-fns that re-enter JS can call it).
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut fl = self.flags.get();
        f(&mut fl);
        self.flags.set(fl);
    }

    #[inline]
    pub(crate) fn async_id(&self) -> u64 {
        ID {
            id: self.id,
            kind: self.flags.get().kind().into(),
        }
        .async_id()
    }

    /// Release a timer that was unlinked from a timer heap by something other
    /// than [`Self::cancel`] (e.g. `FakeTimers::clear`'s `delete_min` drain).
    /// Downgrades the `Strong` JS pin and releases the `+1` taken by
    /// `reschedule()`, so GC can collect the wrapper and the box frees on the
    /// final deref.
    ///
    /// `cancel()` skips its own `remove`/`deref` because `state` is already
    /// `CANCELLED`, which is why the explicit `deref` follows.
    ///
    /// `vm` is the live per-thread VM; no borrow of `All` may be live across
    /// this call (`cancel()` reaches `All::remove`, which forms its own
    /// `&mut All`).
    pub(crate) fn release_heap_pin(this: core::ptr::NonNull<Self>, vm: *mut VirtualMachine) {
        // SAFETY: caller guarantees the box is live (refcount ≥ 1).
        let s = unsafe { this.as_ref() };
        s.cancel(vm);
        s.deref();
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
    /// object via a fresh `&Self` derived from the JS wrapper's `m_ptr`.
    /// With `&mut self` here, LLVM's `noalias` lets it keep `self.flags` in a
    /// register across the FFI call, so `set_in_callback(false)`'s RMW
    /// clobbers the `has_cleared_timer` bit that `cancel()` set — the interval
    /// re-fires forever. A raw pointer carries no aliasing guarantee, so use
    /// one here.
    ///
    /// # Safety
    /// `this` points at a live `Self`, pinned for the duration of the call by
    /// the caller's `ref_guard()`. Both callers (`fire`, `run_immediate_task`)
    /// also take `*mut Self`, so no `noalias` `&mut Self` is live anywhere in
    /// the call chain across `Bun__JSTimeout__call` — inlining is safe.
    unsafe fn run(
        this: *mut Self,
        global_this: *mut JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        async_id: u64,
        vm: *mut VirtualMachine,
    ) -> bool {
        // SAFETY: `this` live per fn contract; pinned by caller's `ref_guard()`.
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

    /// Heap-allocate a timer, wrap it in its JS object (which adopts the
    /// initial ref), and enqueue (`setImmediate`) or schedule (`setTimeout` /
    /// `setInterval`) it.
    ///
    /// Note (jsc/runtime crate cycle): `vm.timer.epoch` resolved via `runtime_state()`
    /// (low-tier `VirtualMachine.timer` is `()`).
    pub(crate) fn init(
        global: &JSGlobalObject,
        id: i32,
        kind: Kind,
        interval: u32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        let vm = VirtualMachine::get_mut_ptr();
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");

        let this: *mut Self = bun_core::heap::into_raw(Box::new(Self {
            ref_count: RefCount::init(),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(K::TAG)),
            id,
            flags: {
                let mut f = Flags::default();
                f.set_kind(kind);
                // SAFETY: `state` is the boxed per-thread `RuntimeState`.
                f.set_epoch(unsafe { (*state).timer.epoch });
                Cell::new(f)
            },
            interval: Cell::new(interval),
            // SAFETY: `vm` is the live per-thread VM; field read only.
            generation: unsafe { (*vm).test_isolation_generation },
            this_value: JsCell::new(JsRef::empty()),
            _kind: PhantomData,
        }));
        let timer = K::create(this, global);
        debug_assert!(
            K::from_js(timer) == Some(this),
            "{}__create ABI mismatch",
            K::JS_NAME,
        );
        let _keep = bun_jsc::EnsureStillAlive(timer);
        // SAFETY: `this` was just allocated above; the wrapper holds its only ref.
        let s = unsafe { &*this };

        K::arguments_set_cached(timer, global, arguments);
        K::callback_set_cached(timer, global, callback);
        if kind == Kind::SetImmediate {
            // SAFETY: `vm` is the live per-thread VM. Low tier stores `*mut ()`
            // (PORTING.md §Dispatch); `__bun_run_immediate_task` casts it back
            // to `*mut ImmediateObject`.
            unsafe { (*vm).enqueue_immediate_task(this.cast()) };
            s.set_enable_keeping_event_loop_alive(vm, true);
            // ref'd by event loop
            s.ref_();
        } else {
            js_Timeout::idle_timeout_set_cached(
                timer,
                global,
                JSValue::js_number(f64::from(interval)),
            );
            js_Timeout::repeat_set_cached(
                timer,
                global,
                if kind == Kind::SetInterval {
                    JSValue::js_number(f64::from(interval))
                } else {
                    JSValue::NULL
                },
            );

            // this increments the refcount and sets _idleStart
            s.reschedule(timer, vm, global.as_ptr());
        }

        s.this_value.with_mut(|r| r.set_strong(timer, global));

        if global.bun_vm().as_mut().is_inspector_enabled() {
            Debugger::did_schedule_async_call(
                global,
                Debugger::AsyncCallType::DOMTimer,
                ID {
                    id,
                    kind: kind.big(),
                }
                .async_id(),
                kind != Kind::SetInterval,
            );
        }
        timer
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
    /// `self.flags`/`event_loop_timer.state` across the call and dead-store
    /// the post-call reloads in `should_reschedule_timer`/`is_timer_done` —
    /// the interval re-fires forever. Use a raw pointer;
    /// helper calls `(*this).foo()` materialise short-lived borrows scoped to
    /// each statement only — none span the JS call.
    ///
    /// Note (jsc/runtime crate cycle): `vm.timer` resolved via
    /// `crate::jsc_hooks::runtime_state()` — low-tier `VirtualMachine.timer`
    /// is `()` (see `set_enable_keeping_event_loop_alive`).
    ///
    /// # Safety
    /// `this` points at a live `Self` (FIRE_TIMER hook contract); `vm` is the
    /// live per-thread VM.
    pub(crate) unsafe fn fire(this: *mut Self, _now: &ElTimespec, vm: *mut VirtualMachine) {
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

        let callback = K::callback_get_cached(this_object).expect("timer callback slot");
        let arguments = K::arguments_get_cached(this_object).expect("timer arguments slot");
        let (mut idle_timeout, mut repeat): (JSValue, JSValue) = match kind {
            KindBig::SetImmediate => (JSValue::UNDEFINED, JSValue::UNDEFINED),
            KindBig::SetTimeout | KindBig::SetInterval => (
                js_Timeout::idle_timeout_get_cached(this_object)
                    .expect("TimeoutObject idleTimeout slot"),
                js_Timeout::repeat_get_cached(this_object).expect("TimeoutObject repeat slot"),
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
            let _pin = s.ref_guard();

            // SAFETY: `this` is live per fn contract; `_pin` keeps it across
            // re-entrancy.
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
                    idle_timeout = js_Timeout::idle_timeout_get_cached(this_object)
                        .expect("TimeoutObject idleTimeout slot");
                    repeat = js_Timeout::repeat_get_cached(this_object)
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
                    // `_pin` above keeps `self` across the deref.
                    match s.event_loop_timer_state() {
                        EventLoopTimerState::FIRED => {
                            // If we didn't clear the setInterval, reschedule it starting from
                            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
                            // single-threaded JS heap so no concurrent `&mut` to
                            // `.timer`.
                            unsafe {
                                (*state)
                                    .timer
                                    .update(s.event_loop_timer.as_ptr(), &time_before_call)
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
                                    .update(s.event_loop_timer.as_ptr(), &time_before_call)
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

                    // `_pin` above keeps `self` across the deref.
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

            // End of pinned scope. After this `*this` may be freed; do not
            // touch past this block.
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
        js_Timeout::idle_timeout_set_cached(timer, global_ref, repeat);
        self.this_value
            .with_mut(|r| r.set_strong(timer, global_ref));
        self.update_flags(|f| f.set_kind(Kind::SetInterval));
        self.interval.set(new_interval);
        self.reschedule(timer, vm, global);
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

    /// Re-insert `event_loop_timer` into the heap at `now + interval`. Called
    /// from `init()`, `do_refresh()`, and `convert_to_interval()`.
    ///
    /// Note (jsc/runtime crate cycle): `vm.timer` resolved via `runtime_state()`.
    pub(crate) fn reschedule(
        &self,
        timer: JSValue,
        vm: *mut VirtualMachine,
        global_this: *mut JSGlobalObject,
    ) {
        if self.flags.get().kind() == Kind::SetImmediate {
            return;
        }

        let idle_timeout =
            js_Timeout::idle_timeout_get_cached(timer).expect("TimeoutObject idleTimeout slot");
        let repeat = js_Timeout::repeat_get_cached(timer).expect("TimeoutObject repeat slot");

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
            unsafe { (*state).timer.remove(self.event_loop_timer.as_ptr()) };
        } else {
            self.ref_();
        }

        // SAFETY: as above.
        unsafe {
            (*state)
                .timer
                .update(self.event_loop_timer.as_ptr(), &scheduled_time)
        };
        self.update_flags(|f| f.set_has_cleared_timer(false));

        // Set _idleStart to the current monotonic timestamp in milliseconds
        // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
        js_Timeout::idle_start_set_cached(
            timer,
            // `opaque_ffi!` ZST — safe deref; `vm.global` never null.
            JSGlobalObject::opaque_ref(global_this),
            JSValue::js_number(now.ms_unsigned() as f64),
        );

        if self.flags.get().has_js_ref() {
            self.set_enable_keeping_event_loop_alive(vm, true);
        }
    }

    /// Getter for `_destroyed`
    /// on JS Timeout and Immediate objects.
    pub(crate) fn is_destroyed(&self) -> bool {
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
            unsafe { (*state).timer.remove(self.event_loop_timer.as_ptr()) };
            self.deref();
        }
    }

    // ── `.classes.ts` host fns shared by `Timeout` and `Immediate` ─────────

    // C-ABI shim (`${name}Class__construct`) is emitted by codegen via
    // `host_fn_construct`; do not also annotate with `#[host_fn]` here.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        Err(global.throw(format_args!("{} is not constructible", K::JS_NAME)))
    }

    /// `.classes.ts` finalizer hook.
    /// Runs on the mutator thread during lazy sweep; do not touch any
    /// `JSValue`/`Strong` content here.
    pub fn finalize(&self) {
        self.this_value.with_mut(|r| r.finalize());
    }

    /// First access mints an
    /// `id → *mut EventLoopTimer` entry in `All.maps` so `clearTimeout(+t)` /
    /// `clearImmediate(+t)` (numeric-id form) can resolve it.
    ///
    /// Note (jsc/runtime crate cycle): `vm.timer.maps` resolved via `runtime_state()`.
    #[bun_jsc::host_fn(method)]
    pub fn to_primitive(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !this.flags.get().has_accessed_primitive() {
            this.update_flags(|f| f.set_has_accessed_primitive(true));
            let state = crate::jsc_hooks::runtime_state();
            debug_assert!(!state.is_null(), "RuntimeState not installed");
            // SAFETY: `state` is the boxed per-thread `RuntimeState`;
            // single-threaded JS heap so no concurrent `&mut` to `.timer.maps`.
            unsafe {
                (*state)
                    .timer
                    .maps
                    .get(this.flags.get().kind())
                    .put(this.id, this.event_loop_timer.as_ptr())
            }?;
        }
        Ok(JSValue::js_number(f64::from(this.id)))
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(this: &Self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this_value = frame.this();
        this_value.ensure_still_alive();

        let did_have_js_ref = this.flags.get().has_js_ref();
        this.update_flags(|f| f.set_has_js_ref(true));

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L256
        // and
        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L685-L687
        // Node only re-enables the keep-alive ref when `!this._destroyed`. Checking
        // `has_cleared_timer` alone is not sufficient: a one-shot timer that has already fired
        // has `has_cleared_timer == false` but is still destroyed. Calling `.unref(); .ref()`
        // on such a timer would otherwise leak an event-loop ref and hang the process.
        if !did_have_js_ref && !this.is_destroyed() {
            this.set_enable_keeping_event_loop_alive(VirtualMachine::get_mut_ptr(), true);
        }

        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(this: &Self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this_value = frame.this();
        this_value.ensure_still_alive();

        let did_have_js_ref = this.flags.get().has_js_ref();
        this.update_flags(|f| f.set_has_js_ref(false));

        if did_have_js_ref {
            this.set_enable_keeping_event_loop_alive(VirtualMachine::get_mut_ptr(), false);
        }

        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn has_ref(this: &Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::from(
            this.flags.get().is_keeping_event_loop_alive(),
        ))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_destroyed(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::from(this.is_destroyed()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispose(this: &Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.cancel(global.bun_vm_ptr());
        Ok(JSValue::UNDEFINED)
    }
}

// ── `Timeout`-only surface ──────────────────────────────────────────────────
impl TimerObject<Timeout> {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_refresh(
        this: &Self,
        global_object: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = frame.this();

        // Immediates do not have a refresh function, and our binding generator should not let this
        // function be reached even if you override the `this` value calling a Timeout object's
        // `refresh` method
        debug_assert!(this.flags.get().kind() != Kind::SetImmediate);

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if this.id == -1
            || this.flags.get().kind() == Kind::SetImmediate
            || this.flags.get().has_cleared_timer()
        {
            return Ok(this_value);
        }

        this.this_value
            .with_mut(|r| r.set_strong(this_value, global_object));
        this.reschedule(
            this_value,
            VirtualMachine::get_mut_ptr(),
            global_object.as_ptr(),
        );

        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.cancel(global.bun_vm_ptr());
        Ok(frame.this())
    }

    /// Node's deadline is `_idleStart + _idleTimeout`; writing `_idleStart`
    /// must move the heap entry so `t2._idleStart = t1._idleStart` works.
    fn reschedule_from_idle_start(&self, idle_start_ms: f64) {
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
                .update(self.event_loop_timer.as_ptr(), &scheduled_time)
        };
    }

    // Cached-property getters/setters — codegen passes `this_value` (the JS
    // wrapper) so the cached `WriteBarrier` slot on the C++ side can be read/written.
    // Signature does not match the standard `host_fn(getter/setter)` shape; the
    // codegen'd thunks call these directly.

    pub(crate) fn get_on_timeout(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js_Timeout::callback_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_on_timeout(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js_Timeout::callback_set_cached(this_value, global, value);
    }

    pub(crate) fn get_idle_timeout(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js_Timeout::idle_timeout_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_idle_timeout(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js_Timeout::idle_timeout_set_cached(this_value, global, value);
    }

    pub(crate) fn get_repeat(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js_Timeout::repeat_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_repeat(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js_Timeout::repeat_set_cached(this_value, global, value);
    }

    pub(crate) fn get_idle_start(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js_Timeout::idle_start_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_idle_start(
        this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        if let Some(ms) = value.get_number() {
            this.reschedule_from_idle_start(ms);
        }
        js_Timeout::idle_start_set_cached(this_value, global, value);
    }
}

// ── `Immediate`-only surface ────────────────────────────────────────────────
impl TimerObject<Immediate> {
    /// Reached from `bun_jsc::event_loop` via `__bun_run_immediate_task`
    /// (definer in [`crate::dispatch`]). Returns `true` if an exception was
    /// thrown.
    ///
    /// Note (noalias re-entrancy): takes `*mut Self`, NOT `&mut self` — see
    /// [`Self::fire`]. Also takes `*mut VirtualMachine` (NOT `&mut`) — the
    /// body calls `vm.event_loop().enter()` then re-enters JS which may itself
    /// touch the VM/EventLoop; aliased `&mut` would be UB.
    ///
    /// # Safety
    /// `this` was produced by `enqueue_immediate_task` from a live
    /// heap-allocated `Self`; `vm` is the live per-thread VM.
    pub(crate) unsafe fn run_immediate_task(this: *mut Self, vm: *mut VirtualMachine) -> bool {
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
            panic!("Immediate.runImmediateTask: this_object is null");
            #[cfg(not(debug_assertions))]
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
        let callback = js_Immediate::callback_get_cached(timer).expect("Immediate callback slot");
        let arguments =
            js_Immediate::arguments_get_cached(timer).expect("Immediate arguments slot");

        let exception_thrown = {
            let _pin = s.ref_guard();
            let async_id = s.async_id();
            // SAFETY: `this` is live per fn contract; `_pin` keeps it across
            // re-entrancy.
            let result =
                unsafe { Self::run(this, global_this, timer, callback, arguments, async_id, vm) };
            // Fresh read: re-entrant `cancel()`/`refresh()` may have changed
            // `state`. After `_pin` drops `*this` may be freed; do not touch
            // it past this block.
            if s.event_loop_timer_state() == EventLoopTimerState::FIRED {
                s.deref();
            }
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

    /// VM-teardown release of the event loop's `+1` ref on a still-queued
    /// immediate; does not run the callback.
    ///
    /// # Safety
    /// `this` must be a live heap-allocated, still-queued `Self`.
    pub(crate) unsafe fn cancel_pending(this: *mut Self, vm: *mut VirtualMachine) {
        // SAFETY: per fn contract. Do not form `&mut *this` — the body derefs
        // and may free `*this`.
        let s = unsafe { &*this };
        s.set_enable_keeping_event_loop_alive(vm, false);
        s.this_value.with_mut(|r| r.downgrade());
        s.deref();
    }
}
