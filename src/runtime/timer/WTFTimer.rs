//! `WTFTimer` — a timer created by WTF (WebKit) code and invoked by Bun's
//! event loop. Backs `WTF::RunLoop::TimerBase` on the Bun runloop.
//!
//! WTF code updates and cancels a timer from whichever thread it is on, so a timer holds pointers
//! to the two `Sync` things it needs of its VM and never to the VM.

use core::ffi::c_void;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_core::{Timespec, TimespecMockMode};

use crate::jsc::virtual_machine::VirtualMachine;
use crate::webcore::script_execution_context::Identifier as ScriptExecutionContextIdentifier;

use super::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, InHeap, IntrusiveField,
    WtfTimers,
};

const NS_PER_S: i64 = bun_core::time::NS_PER_S as i64;

bun_opaque::opaque_ffi! {
    /// This is `WTF::RunLoop::TimerBase` from WebKit — opaque FFI handle.
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

/// A timer created by WTF code and invoked by Bun's event loop.
pub(crate) struct WTFTimer {
    /// `All.wtf_timers` of the VM this was created on. Freed with the VM, which
    /// `script_execution_context_id` tells.
    heap: NonNull<WtfTimers>,
    // FFI handle into WebKit's RunLoop::TimerBase; owned by C++.
    run_loop_timer: NonNull<RunLoopTimer>,
    pub(crate) event_loop_timer: EventLoopTimer,
    // Backref into `vm.eventLoop().shared.imminent_gc_timer`. Low tier stores
    // `AtomicPtr<()>` (PORTING.md §Dispatch); `self` is cast to `*mut ()` at
    // each compare_exchange (the hook in `dispatch.rs` casts back to
    // `*mut WTFTimer`).
    imminent: bun_ptr::BackRef<AtomicPtr<()>>,
    repeat: bool,
    script_execution_context_id: ScriptExecutionContextIdentifier,
}

bun_event_loop::impl_timer_owner!(WTFTimer; from_timer_ptr => event_loop_timer);

impl WTFTimer {
    /// Fire the underlying `RunLoop::TimerBase`,
    /// removing `self` from the timer heap first if it's currently scheduled.
    /// Reached from `bun_jsc::event_loop` via `__bun_run_wtf_timer`
    /// (definer in [`crate::dispatch`]).
    ///
    /// # Safety
    /// `this` was published by [`WTFTimer::update`] into
    /// `imminent_gc_timer` and remains live, and so does the VM it was created on.
    pub(crate) unsafe fn run(this: *mut Self) {
        // SAFETY: per fn contract — `this` is live; `ThisPtr` vends only fresh
        // short-lived `&Self` per Deref so no `&WTFTimer` spans the
        // `WtfTimers::disarm` raw write to `event_loop_timer`.
        let t = unsafe { bun_ptr::ThisPtr::new(this) };
        // SAFETY: the VM is live, so its heap is.
        unsafe {
            t.heap
                .as_ref()
                .disarm(ptr::addr_of_mut!((*this).event_loop_timer));
        }
        t.run_without_removing();
    }

    #[inline]
    fn run_without_removing(&self) {
        RunLoopTimer::fire(self.run_loop_timer);
    }

    #[bun_uws::uws_callback(export = "WTFTimer__isActive", no_catch)]
    pub(crate) fn is_active(&self) -> bool {
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            return true;
        }
        // `imminent` is a `BackRef` into the VM's event loop, which outlives this timer.
        let loaded = self.imminent.load(Ordering::SeqCst);
        // Null can never equal `this`, so a single pointer compare suffices.
        loaded.cast_const().cast::<WTFTimer>() == ptr::from_ref(self)
    }

    #[bun_uws::uws_callback(export = "WTFTimer__secondsUntilTimer", no_catch)]
    pub(crate) fn seconds_until_timer(&self) -> f64 {
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            let next = &self.event_loop_timer.next;
            // bun_event_loop carries a local `Timespec` stub; re-pack
            // into bun_core::Timespec to call `duration`.
            let until = Timespec {
                sec: next.sec,
                nsec: next.nsec,
            }
            .duration(&Timespec::now(TimespecMockMode::ForceRealTime));
            let sec = until.sec as f64;
            let nsec = until.nsec as f64;
            return sec + nsec / NS_PER_S as f64;
        }
        f64::INFINITY
    }

    /// # Safety
    /// `this` must point at a live heap-allocated `WTFTimer`.
    pub(crate) unsafe fn update(this: *mut Self, seconds: f64, repeat: bool) {
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

        // SAFETY: WTF code only updates a timer of a live VM, so the heap is live.
        let heap = unsafe { t.heap.as_ref() };
        // SAFETY: `this` is live until `deinit`, which disarms it.
        unsafe {
            heap.arm(ptr::addr_of_mut!((*this).event_loop_timer), &interval);
            (*this).repeat = repeat;
        }
        // Off the JS thread the `uv_timer_t` is out of reach: the JS thread re-arms it when it
        // next drains or inserts a timer.
        #[cfg(windows)]
        if heap.is_on_js_thread() {
            crate::jsc_hooks::timer_all().ensure_uv_timer();
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

            // SAFETY: the context is valid, so the VM and its heap are live. A no-op for a
            // node that is no longer linked.
            unsafe {
                t.heap
                    .as_ref()
                    .disarm(ptr::addr_of_mut!((*this).event_loop_timer));
            }
        }
    }

    /// `EventLoopTimer.fire` dispatch arm body for `Tag::WTFTimer`.
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

/// A `WTF::RunLoop` timer on this thread, backed by this thread's event loop. Null when the thread has no Bun
/// `VirtualMachine` (a `JSC::VM` on a bundler thread generating bytecode, say): the timer then never fires, which
/// `RunLoop::TimerBase` accepts.
///
/// # Safety
/// `run_loop_timer` must be a non-null, live `WTF::RunLoop::TimerBase` owned
/// by the caller for the lifetime of the returned `WTFTimer`.
#[unsafe(no_mangle)]
unsafe extern "C" fn WTFTimer__create(run_loop_timer: *mut RunLoopTimer) -> *mut c_void {
    let (Some(vm), Some(state)) = (
        VirtualMachine::get_or_null(),
        crate::jsc_hooks::try_runtime_state(),
    ) else {
        return ptr::null_mut();
    };

    let this = Box::new(WTFTimer {
        heap: NonNull::from(&state.timer.wtf_timers),
        imminent: bun_ptr::BackRef::new(&vm.event_loop().shared.imminent_gc_timer),
        event_loop_timer: EventLoopTimer {
            next: ElTimespec {
                sec: i64::MAX,
                nsec: 0,
            },
            tag: EventLoopTimerTag::WTFTimer,
            state: EventLoopTimerState::CANCELLED,
            heap: IntrusiveField::default(),
            in_heap: InHeap::None,
        },
        // SAFETY: non-null per caller contract.
        run_loop_timer: unsafe { NonNull::new_unchecked(run_loop_timer) },
        repeat: false,
        script_execution_context_id: ScriptExecutionContextIdentifier(
            vm.initial_script_execution_context_identifier.get() as u32,
        ),
    });

    bun_core::heap::into_raw(this).cast::<c_void>()
}

/// # Safety
/// `this` must point at a live `WTFTimer` produced by [`WTFTimer__create`].
#[unsafe(no_mangle)]
unsafe extern "C" fn WTFTimer__update(this: *mut WTFTimer, seconds: f64, repeat: bool) {
    // SAFETY: per fn contract.
    unsafe { WTFTimer::update(this, seconds, repeat) };
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
