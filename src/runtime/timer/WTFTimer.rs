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
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_core::{Timespec, TimespecMockMode};
use bun_threading::Mutex;

use crate::jsc::virtual_machine::{VirtualMachine, IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE};
use crate::webcore::script_execution_context::Identifier as ScriptExecutionContextIdentifier;

use super::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, InHeap, IntrusiveField,
};

const NS_PER_S: i64 = 1_000_000_000;

/// This is `WTF::RunLoop::TimerBase` from WebKit — opaque FFI handle.
#[repr(C)]
pub struct RunLoopTimer {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

impl RunLoopTimer {
    #[inline]
    pub fn fire(this: *mut RunLoopTimer) {
        // SAFETY: `this` is a valid `WTF::RunLoop::TimerBase*` handed to us by WebKit.
        unsafe { WTFTimer__fire(this) }
    }
}

/// A timer created by WTF code and invoked by Bun's event loop.
pub struct WTFTimer {
    // TODO(port): lifetime — backref to the owning VirtualMachine; never owned here.
    vm: NonNull<VirtualMachine>,
    // FFI handle into WebKit's RunLoop::TimerBase; owned by C++.
    run_loop_timer: NonNull<RunLoopTimer>,
    pub event_loop_timer: EventLoopTimer,
    // TODO(port): lifetime — backref into `vm.eventLoop().imminent_gc_timer`.
    // Low tier stores `AtomicPtr<()>` (PORTING.md §Dispatch); `self` is cast
    // to `*mut ()` at each compare_exchange (the hook in `dispatch.rs` casts
    // back to `*mut WTFTimer`).
    imminent: NonNull<AtomicPtr<()>>,
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
    /// Installed into [`bun_jsc::event_loop::RUN_WTF_TIMER_HOOK`] by
    /// [`crate::dispatch::install_dispatch_hooks`].
    ///
    /// # Safety
    /// `this` was published by [`WTFTimer::update`] into
    /// `imminent_gc_timer` and remains live; `_vm` is the live per-thread VM
    /// (unused at this tier — `vm.timer` resolved via `runtime_state()`).
    pub unsafe fn run(this: *mut Self, _vm: *mut VirtualMachine) {
        // SAFETY: per fn contract — `this` is live; per-field raw deref so we
        // don't hold `&mut *this` across `All::remove` (which `&mut`-derefs
        // `event_loop_timer`).
        if unsafe { (*this).event_loop_timer.state } == EventLoopTimerState::ACTIVE {
            let state = crate::jsc_hooks::runtime_state();
            // SAFETY: `state` is the live per-thread `RuntimeState`;
            // `event_loop_timer` is an embedded field of a live allocation.
            unsafe {
                (*state).timer.remove(ptr::addr_of_mut!((*this).event_loop_timer));
            }
        }
        // SAFETY: per fn contract — `this` is live.
        unsafe { (*this).run_without_removing() };
    }

    #[inline]
    fn run_without_removing(&self) {
        RunLoopTimer::fire(self.run_loop_timer.as_ptr());
    }

    /// # Safety
    /// `this` must point at a live heap-allocated `WTFTimer`.
    pub unsafe fn update(this: *mut Self, seconds: f64, repeat: bool) {
        let self_opaque = this.cast::<()>();
        // SAFETY: per fn contract.
        let imminent = unsafe { (*this).imminent.as_ref() };

        // There's only one of these per VM, and each VM has its own imminent_gc_timer.
        // Only set imminent if it's not already set to avoid overwriting another timer.
        if !(seconds > 0.0) {
            let _ = imminent.compare_exchange(
                ptr::null_mut(),
                self_opaque,
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
            return;
        }
        // Clear imminent if this timer was the one that set it.
        let _ = imminent.compare_exchange(
            self_opaque,
            ptr::null_mut(),
            Ordering::SeqCst,
            Ordering::SeqCst,
        );

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

        let state = crate::jsc_hooks::runtime_state();
        // SAFETY: `state` is the live per-thread `RuntimeState`; `event_loop_timer`
        // is an embedded field of a live allocation.
        unsafe {
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
            let self_opaque = this.cast::<()>();
            // SAFETY: `imminent` points into the VM's event loop, which outlives this timer.
            let _ = unsafe { (*this).imminent.as_ref() }.compare_exchange(
                self_opaque,
                ptr::null_mut(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            );

            // SAFETY: per fn contract.
            if unsafe { (*this).event_loop_timer.state } == EventLoopTimerState::ACTIVE {
                let state = crate::jsc_hooks::runtime_state();
                // SAFETY: `state` is the live per-thread `RuntimeState`.
                unsafe {
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
        let self_opaque = this.cast::<()>();
        // SAFETY: `imminent` points into the VM's event loop, which outlives this timer.
        let _ = unsafe { (*this).imminent.as_ref() }.compare_exchange(
            self_opaque,
            ptr::null_mut(),
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
        // SAFETY: per fn contract — `this` is live.
        unsafe { (*this).run_without_removing() };
    }

    /// # Safety
    /// `this` must be the unique owner of a `Box::into_raw`-produced `WTFTimer`.
    pub unsafe fn deinit(this: *mut Self) {
        // SAFETY: per fn contract.
        unsafe { Self::cancel(this) };
        // SAFETY: `bun.TrivialNew` ↔ `Box::into_raw`, so `Box::from_raw` is
        // the paired free.
        drop(unsafe { Box::from_raw(this) });
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
            imminent: NonNull::from(&el.imminent_gc_timer),
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
            // — Identifier is `#[repr(transparent)]` over u32.
            script_execution_context_id: core::mem::transmute::<u32, ScriptExecutionContextIdentifier>(
                vm_ref.initial_script_execution_context_identifier as u32,
            ),
            lock: Mutex::default(),
        })
    };

    Box::into_raw(this) as *mut c_void
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__update(this: *mut WTFTimer, seconds: f64, repeat: bool) {
    // SAFETY: `this` was produced by WTFTimer__create and is exclusively accessed here.
    unsafe { WTFTimer::update(this, seconds, repeat) };
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__deinit(this: *mut WTFTimer) {
    // SAFETY: `this` was produced by Box::into_raw in WTFTimer__create; reclaiming ownership.
    unsafe { WTFTimer::deinit(this) };
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__isActive(this: *const WTFTimer) -> bool {
    // SAFETY: `this` is a live WTFTimer per caller contract.
    let this_ref = unsafe { &*this };
    if this_ref.event_loop_timer.state == EventLoopTimerState::ACTIVE {
        return true;
    }
    // SAFETY: `imminent` points into the VM's event loop, which outlives this timer.
    let loaded = unsafe { this_ref.imminent.as_ref() }.load(Ordering::SeqCst);
    // Zig: `(load orelse return false) == this` — null can never equal `this`,
    // so a single pointer compare suffices.
    loaded.cast_const().cast::<WTFTimer>() == this
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__cancel(this: *mut WTFTimer) {
    // SAFETY: `this` is a live WTFTimer per caller contract.
    unsafe { WTFTimer::cancel(this) };
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__secondsUntilTimer(this: *mut WTFTimer) -> f64 {
    // SAFETY: `this` is a live WTFTimer per caller contract.
    let this_ref = unsafe { &*this };
    let _g = this_ref.lock.lock_guard();
    if this_ref.event_loop_timer.state == EventLoopTimerState::ACTIVE {
        let next = &this_ref.event_loop_timer.next;
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

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn WTFTimer__fire(this: *mut RunLoopTimer);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/WTFTimer.zig (151 lines)
//   confidence: medium
//   notes:      `vm.timer.{remove,update}` resolved via
//               `jsc_hooks::runtime_state()` (b2-cycle — `bun_jsc::
//               VirtualMachine.timer` is `()`); `imminent` is the low-tier
//               `AtomicPtr<()>` (PORTING.md §Dispatch) — `self` is cast to
//               `*mut ()` at each cmpxchg.
// ──────────────────────────────────────────────────────────────────────────
