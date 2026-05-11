//! `WTFTimer` — a timer created by WTF (WebKit) code and invoked by Bun's
//! event loop. Backs `WTF::RunLoop::TimerBase` on the Bun runloop.
//!
//! PORT NOTE (b2-cycle): Zig stores `vm: *VirtualMachine` and reaches the
//! timer heap via `vm.timer.{remove,update}`. The low-tier
//! `bun_jsc::VirtualMachine.timer` is a `()` placeholder, so this port
//! resolves the heap through [`crate::jsc_hooks::runtime_state`] instead —
//! the same pattern `TimerObjectInternals` uses.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::{self, NonNull};
use bun_core::{Timespec, TimespecMockMode};
use bun_runtime_types::timer::{ImminentWtfTimer, WtfTimerHandle};
use bun_threading::Mutex;

use crate::jsc::virtual_machine::{VirtualMachine, IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE};
use crate::webcore::script_execution_context::Identifier as ScriptExecutionContextIdentifier;

use super::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, InHeap, IntrusiveField,
};

const NS_PER_S: i64 = 1_000_000_000;

bun_opaque::opaque_ffi! {
    /// This is `WTF::RunLoop::TimerBase` from WebKit — opaque FFI handle.
    pub struct RunLoopTimer;
}

impl RunLoopTimer {
    /// Takes `NonNull` (not `&self`) so callers holding the raw FFI handle
    /// don't need an `unsafe { as_ref() }` just to forward it — `NonNull<T>`
    /// is ABI-identical to `*mut T` and the extern is `safe fn`.
    #[inline]
    pub fn fire(this: NonNull<RunLoopTimer>) {
        WTFTimer__fire(this)
    }
}

/// A timer created by WTF code and invoked by Bun's event loop.
pub struct WTFTimer {
    // TODO(port): lifetime — backref to the owning VirtualMachine; never owned here.
    vm: NonNull<VirtualMachine>,
    // FFI handle into WebKit's RunLoop::TimerBase; owned by C++.
    run_loop_timer: NonNull<RunLoopTimer>,
    pub event_loop_timer: EventLoopTimer,
    // Backref into `vm.eventLoop().imminent_gc_timer`. Low tier stores a typed
    // sidecar handle, while timer effects remain in this crate.
    imminent: bun_ptr::BackRef<ImminentWtfTimer>,
    repeat: bool,
    lock: Mutex,
    script_execution_context_id: ScriptExecutionContextIdentifier,
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__runIfImminent(vm: *mut VirtualMachine) {
    // SAFETY: caller (C++) guarantees `vm` is the live VirtualMachine for this thread.
    let el = unsafe { (*vm).event_loop() };
    // SAFETY: `event_loop()` returns the VM's owned EventLoop pointer.
    unsafe { (*el).run_imminent_gc_timer() };
}

impl WTFTimer {
    /// Spec WTFTimer.zig `run` — fire the underlying `RunLoop::TimerBase`,
    /// removing `self` from the timer heap first if it's currently scheduled.
    /// Reached from `bun_jsc::event_loop` via `__bun_run_wtf_timer`
    /// (definer in [`crate::dispatch`]).
    ///
    /// # Safety
    /// `this` was published by [`WTFTimer::update`] into
    /// `imminent_gc_timer` and remains live; `vm` is the live VM that owns
    /// this timer.
    pub unsafe fn run(this: *mut Self, vm: *mut VirtualMachine) {
        // SAFETY: per fn contract — `this` is live; per-field raw deref so we
        // don't hold `&mut *this` across `All::remove` (which `&mut`-derefs
        // `event_loop_timer`).
        if unsafe { (*this).event_loop_timer.state } == EventLoopTimerState::ACTIVE {
            // SAFETY: `vm` is the live VM that owns this timer's heap;
            // `event_loop_timer` is an embedded field of a live allocation.
            unsafe {
                let state = crate::jsc_hooks::runtime_state_of(vm);
                (*state).timer.remove(ptr::addr_of_mut!((*this).event_loop_timer));
            }
        }
        // SAFETY: per fn contract — `this` is live.
        unsafe { (*this).run_without_removing() };
    }

    #[inline]
    fn run_without_removing(&self) {
        RunLoopTimer::fire(self.run_loop_timer);
    }

    #[bun_uws::uws_callback(export = "WTFTimer__isActive", no_catch)]
    pub fn is_active(&self) -> bool {
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            return true;
        }
        // `imminent` is a `BackRef` into the VM's event loop, which outlives this timer.
        self.imminent.load() == Some(WtfTimerHandle::from_ref(self))
    }

    #[bun_uws::uws_callback(export = "WTFTimer__secondsUntilTimer", no_catch)]
    pub fn seconds_until_timer(&self) -> f64 {
        let _g = self.lock.lock_guard();
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            let next = &self.event_loop_timer.next;
            // PORT NOTE: bun_event_loop carries a local `Timespec` stub; re-pack
            // into bun_core::Timespec to call `duration`.
            let until = Timespec { sec: next.sec, nsec: next.nsec }
                .duration(&Timespec::now(TimespecMockMode::ForceRealTime));
            let sec = until.sec as f64;
            let nsec = until.nsec as f64;
            return sec + nsec / NS_PER_S as f64;
        }
        f64::INFINITY
    }

    /// # Safety
    /// `this` must point at a live heap-allocated `WTFTimer`.
    pub unsafe fn update(this: *mut Self, seconds: f64, repeat: bool) {
        let handle = WtfTimerHandle::from_ptr(this).expect("WTFTimer pointer is non-null");
        // SAFETY: per fn contract — `this` is live; copy the `BackRef` out so the
        // subsequent atomic borrow is detached from `*this`.
        let imminent_br = unsafe { (*this).imminent };
        let imminent = imminent_br.get();

        // There's only one of these per VM, and each VM has its own imminent_gc_timer.
        // Only set imminent if it's not already set to avoid overwriting another timer.
        if !(seconds > 0.0) {
            let _ = imminent.try_set_if_empty(handle);
            return;
        }
        // Clear imminent if this timer was the one that set it.
        let _ = imminent.clear_if_current(handle);

        // seconds can be +inf: JSC's GC scheduler divides by gcTimeSlice, which is 0 whenever
        // bytes*deathRate truncates to 0. Other WTF::RunLoop backends saturate Seconds→int;
        // do the same so the float→int cast below can't overflow.
        let clamped = seconds.min(i32::MAX as f64);

        let ipart = clamped.trunc();
        let fpart = clamped - ipart;
        let mut interval = Timespec::now(TimespecMockMode::ForceRealTime);
        interval.sec += ipart as i64;
        interval.nsec += (fpart * NS_PER_S as f64) as i64;
        if interval.nsec >= NS_PER_S {
            interval.sec += 1;
            interval.nsec -= NS_PER_S;
        }

        // SAFETY: `(*this).vm` is the VM that owns this timer's heap (captured
        // at `WTFTimer__create`); `event_loop_timer` is an embedded field of a
        // live allocation. May be called off the JS thread — `All::update`
        // takes its own lock.
        unsafe {
            let state = crate::jsc_hooks::runtime_state_of((*this).vm.as_ptr());
            (*state)
                .timer
                .update(ptr::addr_of_mut!((*this).event_loop_timer), &interval);
        }
        // SAFETY: per fn contract.
        unsafe { (*this).repeat = repeat };
    }

    /// # Safety
    /// `this` must point at a live heap-allocated `WTFTimer`.
    pub unsafe fn cancel(this: *mut Self) {
        // SAFETY: per fn contract — `this` outlives this scope. `lock_guard`
        // stores `*const Mutex` (no borrow of `*this` is held), so the
        // `addr_of_mut!` below remains legal.
        let _g = unsafe { (*this).lock.lock_guard() };

        // SAFETY: per fn contract.
        if unsafe { (*this).script_execution_context_id }.valid() {
            // Only clear imminent if this timer was the one that set it.
            let handle = WtfTimerHandle::from_ptr(this).expect("WTFTimer pointer is non-null");
            // SAFETY: per fn contract — `this` is live. `imminent` is a `BackRef`
            // into the VM's event loop, which outlives this timer.
            let imminent_br = unsafe { (*this).imminent };
            let _ = imminent_br.clear_if_current(handle);

            // SAFETY: per fn contract.
            if unsafe { (*this).event_loop_timer.state } == EventLoopTimerState::ACTIVE {
                // SAFETY: `(*this).vm` is the VM that owns this timer's heap;
                // may be called off the JS thread — `All::remove` locks.
                unsafe {
                    let state = crate::jsc_hooks::runtime_state_of((*this).vm.as_ptr());
                    (*state)
                        .timer
                        .remove(ptr::addr_of_mut!((*this).event_loop_timer));
                }
            }
        }
    }

    /// Spec WTFTimer.zig `fire` — `EventLoopTimer.fire` dispatch arm body for
    /// `Tag::WTFTimer`.
    ///
    /// # Safety
    /// `this` is the container of an `EventLoopTimer` just popped from
    /// `All.timers`; `_vm` is the live per-thread VM.
    pub unsafe fn fire(this: *mut Self, _now: &ElTimespec, _vm: *mut VirtualMachine) {
        // SAFETY: per fn contract — `this` is live.
        unsafe { (*this).event_loop_timer.state = EventLoopTimerState::FIRED };
        // Only clear imminent if this timer was the one that set it.
        let handle = WtfTimerHandle::from_ptr(this).expect("WTFTimer pointer is non-null");
        // SAFETY: per fn contract — `this` is live. `imminent` is a `BackRef`
        // into the VM's event loop, which outlives this timer.
        let imminent_br = unsafe { (*this).imminent };
        let _ = imminent_br.clear_if_current(handle);
        // SAFETY: per fn contract — `this` is live.
        unsafe { (*this).run_without_removing() };
    }

    /// # Safety
    /// `this` must be the unique owner of a `heap::alloc`-produced `WTFTimer`.
    pub unsafe fn deinit(this: *mut Self) {
        // SAFETY: per fn contract.
        unsafe { Self::cancel(this) };
        // SAFETY: `bun.TrivialNew` ↔ `heap::alloc`, so `heap::take` is
        // the paired free.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__create(run_loop_timer: *mut RunLoopTimer) -> *mut c_void {
    if IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE.with(Cell::get) {
        return ptr::null_mut();
    }

    let vm = VirtualMachine::get_mut_ptr();

    // SAFETY: `vm` is the thread-local VirtualMachine; `run_loop_timer` is
    // non-null per caller contract; `event_loop().imminent_gc_timer` lives as
    // long as the VM.
    let this = unsafe {
        let vm_ref = &*vm;
        let el = &*vm_ref.event_loop();
        Box::new(WTFTimer {
            vm: NonNull::new_unchecked(vm),
            imminent: bun_ptr::BackRef::new(&el.imminent_gc_timer),
            event_loop_timer: EventLoopTimer {
                next: ElTimespec { sec: i64::MAX, nsec: 0 },
                tag: EventLoopTimerTag::WTFTimer,
                state: EventLoopTimerState::CANCELLED,
                heap: IntrusiveField::default(),
                in_heap: InHeap::None,
            },
            run_loop_timer: NonNull::new_unchecked(run_loop_timer),
            repeat: false,
            // Zig: `@enumFromInt(vm.initial_script_execution_context_identifier)`
            script_execution_context_id: ScriptExecutionContextIdentifier(
                vm_ref.initial_script_execution_context_identifier as u32,
            ),
            lock: Mutex::default(),
        })
    };

    bun_core::heap::into_raw(this).cast::<c_void>()
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__update(this: *mut WTFTimer, seconds: f64, repeat: bool) {
    // SAFETY: `this` was produced by WTFTimer__create and is exclusively accessed here.
    unsafe { WTFTimer::update(this, seconds, repeat) };
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__deinit(this: *mut WTFTimer) {
    // SAFETY: `this` was produced by heap::alloc in WTFTimer__create; reclaiming ownership.
    unsafe { WTFTimer::deinit(this) };
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__cancel(this: *mut WTFTimer) {
    // SAFETY: `this` is a live WTFTimer per caller contract.
    unsafe { WTFTimer::cancel(this) };
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    safe fn WTFTimer__fire(this: NonNull<RunLoopTimer>);
}

// ported from: src/runtime/timer/WTFTimer.zig
