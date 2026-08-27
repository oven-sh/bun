//! `WTFTimer` — a timer created by WTF (WebKit) code and invoked by Bun's
//! event loop. Backs `WTF::RunLoop::TimerBase` on the Bun runloop.
//!
//! jsc/runtime crate cycle: the low-tier `bun_jsc::VirtualMachine.timer` is a
//! `()` placeholder, so this module resolves the timer heap through
//! [`crate::jsc_hooks::timer_all`] instead.

use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_core::{Timespec, TimespecMockMode};
use bun_ptr::{BackRef, JsCell};

use crate::jsc::virtual_machine::VirtualMachine;
use crate::webcore::script_execution_context::Identifier as ScriptExecutionContextIdentifier;

use super::{All, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, TimerRef};

const NS_PER_S: i64 = bun_core::time::NS_PER_S as i64;

bun_opaque::opaque_ffi! {
    /// This is `WTF::RunLoop::TimerBase` from WebKit — opaque FFI handle.
    pub struct RunLoopTimer;
}

impl RunLoopTimer {
    /// Run the C++ timer. Its `fired()` may destroy the `TimerBase` — and with
    /// it the `WTFTimer` this handle was read from — so callers hold no
    /// `&WTFTimer` across this call.
    #[inline]
    pub(crate) fn fire(this: NonNull<RunLoopTimer>) {
        WTFTimer__fire(this)
    }
}

/// A timer created by WTF code and invoked by Bun's event loop. Owned (boxed)
/// by the C++ `RunLoop::TimerBase` that `WTFTimer__create`d it; `update` /
/// `cancel` may arrive from any thread.
pub struct WTFTimer {
    /// `Timer::All` of the VM whose JS thread created this timer. Live while
    /// `script_execution_context_id` is valid; a C++ `RunLoop::TimerBase` can
    /// outlive `RuntimeState` (which holds `All`) on Worker teardown, so
    /// `cancel`/`Drop` only follow this after that check. Off the JS thread
    /// only `wtf_arm`/`wtf_disarm`/the `wtf_timers` lock may be used through it.
    timers: BackRef<All>,
    // FFI handle into WebKit's RunLoop::TimerBase; owned by C++.
    run_loop_timer: NonNull<RunLoopTimer>,
    /// Linked into `All.wtf_timers`. Unlike every other `JsCell`, this one is
    /// shared across threads: it is only read or written under that heap's lock.
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    /// `vm.eventLoop().imminent_gc_timer`. Low tier stores `AtomicPtr<()>`
    /// (§Dispatch); `self` is published as `*mut ()` and `__bun_run_wtf_timer`
    /// (in `dispatch.rs`) recovers the `&WTFTimer`.
    imminent: BackRef<AtomicPtr<()>>,
    script_execution_context_id: ScriptExecutionContextIdentifier,
}

bun_event_loop::impl_timer_owner!(WTFTimer; from_timer_ptr => event_loop_timer);

impl WTFTimer {
    #[inline]
    fn timer_ref(&self) -> TimerRef {
        TimerRef::new(self, |t| &t.event_loop_timer)
    }

    /// The identity `imminent_gc_timer` knows this timer by.
    #[inline]
    fn as_opaque(&self) -> *mut () {
        ptr::from_ref(self).cast_mut().cast()
    }

    /// `imminent_gc_timer` named this timer (see `update`): unlink it and hand
    /// back the C++ timer for the caller (`__bun_run_wtf_timer` in
    /// [`crate::dispatch`]) to [`RunLoopTimer::fire`] once no `&self` is live.
    pub(crate) fn take_for_run(&self) -> NonNull<RunLoopTimer> {
        self.timers.wtf_disarm(self.timer_ref());
        self.run_loop_timer
    }

    #[bun_uws::uws_callback(export = "WTFTimer__isActive", no_catch)]
    pub(crate) fn is_active(&self) -> bool {
        let state = {
            let _lock = self.timers.wtf_timers.lock();
            self.event_loop_timer.get().state
        };
        if state == EventLoopTimerState::ACTIVE {
            return true;
        }
        // Null can never equal `self`, so a single pointer compare suffices.
        self.imminent.load(Ordering::SeqCst) == self.as_opaque()
    }

    #[bun_uws::uws_callback(export = "WTFTimer__secondsUntilTimer", no_catch)]
    pub(crate) fn seconds_until_timer(&self) -> f64 {
        let (state, next) = {
            let _lock = self.timers.wtf_timers.lock();
            let timer = self.event_loop_timer.get();
            (timer.state, timer.next)
        };
        if state == EventLoopTimerState::ACTIVE {
            let until = next.duration(&Timespec::now(TimespecMockMode::ForceRealTime));
            let sec = until.sec as f64;
            let nsec = until.nsec as f64;
            return sec + nsec / NS_PER_S as f64;
        }
        f64::INFINITY
    }

    pub(crate) fn update(&self, seconds: f64, _repeat: bool) {
        // There's only one of these per VM, and each VM has its own imminent_gc_timer.
        // Only set imminent if it's not already set to avoid overwriting another timer.
        if seconds.partial_cmp(&0.0) != Some(core::cmp::Ordering::Greater) {
            let _ = self.imminent.compare_exchange(
                ptr::null_mut(),
                self.as_opaque(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
            return;
        }
        // Clear imminent if this timer was the one that set it.
        let _ = self.imminent.compare_exchange(
            self.as_opaque(),
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

        self.timers.wtf_arm(self.timer_ref(), interval);
    }

    pub(crate) fn cancel(&self) {
        if self.script_execution_context_id.valid() {
            // Only clear imminent if this timer was the one that set it.
            let _ = self.imminent.compare_exchange(
                self.as_opaque(),
                ptr::null_mut(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            );

            // No-op for a slot that is no longer linked. Not reached once the
            // context is gone: `timers` may already be freed by then (see the
            // field), and nothing walks `wtf_timers` after that point.
            self.timers.wtf_disarm(self.timer_ref());
        }
    }

    /// Timer-heap dispatch arm for `Tag::WTFTimer`: `self`'s slot was just
    /// popped from `All.wtf_timers`. Hands back the C++ timer for the caller to
    /// [`RunLoopTimer::fire`] once no `&self` is live.
    pub(crate) fn take_for_fire(&self) -> NonNull<RunLoopTimer> {
        // Only clear imminent if this timer was the one that set it.
        let _ = self.imminent.compare_exchange(
            self.as_opaque(),
            ptr::null_mut(),
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
        self.run_loop_timer
    }
}

impl Drop for WTFTimer {
    fn drop(&mut self) {
        self.cancel();
    }
}

/// A `WTF::RunLoop` timer on this thread, backed by this thread's event loop. `None` when the thread has no Bun
/// `VirtualMachine` (a `JSC::VM` on a bundler thread generating bytecode, say): the timer then never fires, which
/// `RunLoop::TimerBase` accepts.
// HOST_EXPORT(WTFTimer__create, c)
pub fn create(
    run_loop_timer: core::ptr::NonNull<crate::timer::wtf_timer::RunLoopTimer>,
) -> Option<Box<crate::timer::WTFTimer>> {
    if !VirtualMachine::is_loaded() {
        return None;
    }

    let vm = VirtualMachine::get();
    Some(Box::new(WTFTimer {
        timers: BackRef::new(crate::jsc_hooks::timer_all()),
        imminent: BackRef::new(&vm.event_loop_mut().imminent_gc_timer),
        event_loop_timer: JsCell::new(EventLoopTimer::new(
            EventLoopTimerTag::WTFTimer,
            EventLoopTimerState::CANCELLED,
            Timespec {
                sec: i64::MAX,
                nsec: 0,
            },
        )),
        run_loop_timer,
        script_execution_context_id: ScriptExecutionContextIdentifier(
            vm.initial_script_execution_context_identifier as u32,
        ),
    }))
}

// HOST_EXPORT(WTFTimer__update, c)
pub fn update(this: &crate::timer::WTFTimer, seconds: f64, repeat: bool) {
    this.update(seconds, repeat);
}

/// Frees `this`.
// HOST_EXPORT(WTFTimer__deinit, c)
pub fn deinit(this: Box<crate::timer::WTFTimer>) {
    drop(this);
}

// HOST_EXPORT(WTFTimer__cancel, c)
pub fn cancel(this: &crate::timer::WTFTimer) {
    this.cancel();
}

unsafe extern "C" {
    safe fn WTFTimer__fire(this: NonNull<RunLoopTimer>);
}
