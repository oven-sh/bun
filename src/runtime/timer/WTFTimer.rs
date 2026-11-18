//! `WTFTimer` — the one timer of a `JSC::VM`, invoked by Bun's event loop.
//! `Bun::JSCTaskScheduler` owns it.
//!
//! jsc/runtime crate cycle: the low-tier `bun_jsc::VirtualMachine.timer` is a
//! `()` placeholder, so this module resolves the timer heap through
//! [`crate::jsc_hooks::runtime_state_ptr_of`] instead.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_core::{Timespec, TimespecMockMode};

use crate::jsc::virtual_machine::VirtualMachine;
use crate::webcore::script_execution_context::Identifier as ScriptExecutionContextIdentifier;

use super::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

const NS_PER_S: i64 = bun_core::time::NS_PER_S as i64;

bun_opaque::opaque_ffi! {
    /// What `WTFTimer__fire` gets.
    pub(crate) struct RunLoopTimer;
}

impl RunLoopTimer {
    /// Takes `NonNull` (not `&self`) so callers holding the raw FFI handle
    /// don't need an `unsafe { as_ref() }` just to forward it — `NonNull<T>`
    /// is ABI-identical to `*mut T` and the extern is `safe fn`.
    #[inline]
    fn fire(this: NonNull<RunLoopTimer>) {
        WTFTimer__fire(this)
    }
}

pub(crate) struct WTFTimer {
    // Backref to the owning VirtualMachine (captured from the thread-local VM
    // in `WTFTimer__create`); never owned here. It outlives the timer.
    vm: NonNull<VirtualMachine>,
    run_loop_timer: NonNull<RunLoopTimer>,
    pub(crate) event_loop_timer: EventLoopTimer,
    // Backref into `vm.eventLoop().imminent_gc_timer`. Low tier stores
    // `AtomicPtr<()>` (PORTING.md §Dispatch); `self` is cast to `*mut ()` at
    // each compare_exchange (the hook in `dispatch.rs` casts back to
    // `*mut WTFTimer`).
    imminent: bun_ptr::BackRef<AtomicPtr<()>>,
    script_execution_context_id: ScriptExecutionContextIdentifier,
}

bun_event_loop::impl_timer_owner!(WTFTimer; from_timer_ptr => event_loop_timer);

impl WTFTimer {
    /// Fires, removing `self` from the timer heap first if it's currently scheduled.
    /// Reached from `bun_jsc::event_loop` via `__bun_run_wtf_timer`
    /// (definer in [`crate::dispatch`]).
    ///
    /// # Safety
    /// `this` was published by [`WTFTimer::update`] into
    /// `imminent_gc_timer` and remains live; `vm` owns this timer.
    pub(crate) unsafe fn run(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: per fn contract — `this` is live.
        let t = unsafe { bun_ptr::ThisPtr::new(this) };
        crate::jsc_hooks::timer_all_of(vm).wtf_disarm(&t.event_loop_timer);
        t.run_without_removing();
    }

    #[inline]
    fn run_without_removing(&self) {
        RunLoopTimer::fire(self.run_loop_timer);
    }

    /// # Safety
    /// `this` must point at a live heap-allocated `WTFTimer`.
    pub(crate) unsafe fn update(this: *mut Self, seconds: f64) {
        let self_opaque = this.cast::<()>();
        // SAFETY: per fn contract — `this` is live; `ThisPtr` vends only fresh
        // short-lived `&Self` per Deref. Copy the `BackRef` out so the
        // subsequent `&AtomicPtr` borrow is detached from `*this`.
        let t = unsafe { bun_ptr::ThisPtr::new(this) };
        let imminent_br = t.imminent;
        let imminent = imminent_br.get();

        // There's only one of these per VM, and each VM has its own imminent_gc_timer.
        // Only set imminent if it's not already set to avoid overwriting another timer.
        if seconds.partial_cmp(&0.0) != Some(core::cmp::Ordering::Greater) {
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

        // SAFETY: `t.vm` owns this timer's heap; `wtf_arm` is safe from any thread.
        unsafe {
            let state = crate::jsc_hooks::runtime_state_ptr_of(t.vm.as_ptr());
            (*state)
                .timer
                .wtf_arm(ptr::addr_of_mut!((*this).event_loop_timer), &interval);
        }
    }

    /// # Safety
    /// `this` must point at a live heap-allocated `WTFTimer`.
    pub(crate) unsafe fn cancel(this: *mut Self) {
        // SAFETY: per fn contract — `this` outlives this scope. `ThisPtr` vends
        // only fresh short-lived `&Self` per Deref.
        let t = unsafe { bun_ptr::ThisPtr::new(this) };

        if t.script_execution_context_id.valid() {
            // Only clear imminent if this timer was the one that set it.
            let self_opaque = this.cast::<()>();
            // `imminent` is a `BackRef` into the VM's event loop, which
            // outlives this timer.
            let imminent_br = t.imminent;
            let _ = imminent_br.compare_exchange(
                self_opaque,
                ptr::null_mut(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            );

            // SAFETY: `t.vm` owns this timer's heap; `wtf_disarm` is safe from
            // any thread and is a no-op for a node that is no longer linked.
            unsafe {
                let state = crate::jsc_hooks::runtime_state_ptr_of(t.vm.as_ptr());
                (*state).timer.wtf_disarm(&t.event_loop_timer);
            }
        }
    }

    /// `dispatch::fire_timer` arm body for `Tag::WTFTimer`.
    ///
    /// # Safety
    /// `this` is the container of an `EventLoopTimer` just popped from
    /// `All.wtf_timers`.
    pub(crate) unsafe fn fire(this: *mut Self) {
        // SAFETY: per fn contract — `this` is live; `ThisPtr` vends only fresh
        // short-lived `&Self` per Deref.
        let t = unsafe { bun_ptr::ThisPtr::new(this) };
        // Only clear imminent if this timer was the one that set it.
        let self_opaque = this.cast::<()>();
        // `imminent` is a `BackRef` into the VM's event loop, which outlives
        // this timer.
        let imminent_br = t.imminent;
        let _ = imminent_br.compare_exchange(
            self_opaque,
            ptr::null_mut(),
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
        t.run_without_removing();
    }

    /// # Safety
    /// `this` must be the unique owner of a `WTFTimer` produced by `WTFTimer__create`.
    pub(crate) unsafe fn deinit(this: *mut Self) {
        // SAFETY: per fn contract.
        unsafe { Self::cancel(this) };
        // SAFETY: `WTFTimer__create` handed its `Box` over via `heap::into_raw`,
        // so `heap::take` is the paired reclaim.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

/// Backed by this thread's event loop. Null when the thread has no Bun `VirtualMachine`.
///
/// # Safety
/// `run_loop_timer` must be non-null and outlive the returned `WTFTimer`.
#[unsafe(no_mangle)]
unsafe extern "C" fn WTFTimer__create(run_loop_timer: *mut RunLoopTimer) -> *mut c_void {
    let Some(vm) = VirtualMachine::get_or_null() else {
        return ptr::null_mut();
    };

    // SAFETY: `run_loop_timer` is non-null per caller contract.
    let this = unsafe {
        let el = vm.event_loop();
        Box::new(WTFTimer {
            vm: NonNull::from(vm),
            imminent: bun_ptr::BackRef::new(&el.imminent_gc_timer),
            event_loop_timer: EventLoopTimer {
                next: Cell::new(ElTimespec {
                    sec: i64::MAX,
                    nsec: 0,
                }),
                state: Cell::new(EventLoopTimerState::CANCELLED),
                ..EventLoopTimer::init_paused(EventLoopTimerTag::WTFTimer)
            },
            run_loop_timer: NonNull::new_unchecked(run_loop_timer),
            script_execution_context_id: ScriptExecutionContextIdentifier(
                vm.initial_script_execution_context_identifier as u32,
            ),
        })
    };

    bun_core::heap::into_raw(this).cast::<c_void>()
}

/// # Safety
/// `this` must point at a live `WTFTimer` produced by [`WTFTimer__create`].
#[unsafe(no_mangle)]
unsafe extern "C" fn WTFTimer__update(this: *mut WTFTimer, seconds: f64) {
    // SAFETY: per fn contract.
    unsafe { WTFTimer::update(this, seconds) };
}

/// # Safety
/// `this` must be the unique owner of a `WTFTimer` produced by
/// [`WTFTimer__create`]; it is freed by this call.
#[unsafe(no_mangle)]
unsafe extern "C" fn WTFTimer__deinit(this: *mut WTFTimer) {
    // SAFETY: per fn contract.
    unsafe { WTFTimer::deinit(this) };
}

/// # Safety
/// `this` must point at a live `WTFTimer` produced by [`WTFTimer__create`].
#[unsafe(no_mangle)]
unsafe extern "C" fn WTFTimer__cancel(this: *mut WTFTimer) {
    // SAFETY: per fn contract.
    unsafe { WTFTimer::cancel(this) };
}

unsafe extern "C" {
    safe fn WTFTimer__fire(this: NonNull<RunLoopTimer>);
}
