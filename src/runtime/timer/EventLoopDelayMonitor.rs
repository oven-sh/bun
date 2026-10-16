//! The interval timer behind one `perf_hooks.monitorEventLoopDelay()` histogram.

use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::AbortHandle;
use bun_jsc::virtual_machine::VirtualMachine;

use super::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use crate::jsc_hooks::timer_all_mut;

bun_opaque::opaque_ffi! {
    /// C++ `Bun::EventLoopDelayHistogramData`: the samples of one histogram.
    /// They are malloc memory, not a GC cell.
    pub(crate) struct Samples;
}

unsafe extern "C" {
    /// Adds the time since the previous call as one sample.
    fn EventLoopDelayHistogramData__recordDelta(samples: NonNull<Samples>);
}

/// `samples` owns this box: C++ creates it at the first `enable()` and frees
/// it before it frees the samples, when the GC sweeps the histogram.
pub(crate) struct EventLoopDelayMonitor {
    pub(crate) event_loop_timer: EventLoopTimer,
    /// Armed while enabled: the context whose script enabled the monitor stops it.
    abort_handle: AbortHandle,
    samples: NonNull<Samples>,
    resolution_ms: i32,
    enabled: bool,
}

bun_jsc::impl_abort_handle_owner!(EventLoopDelayMonitor, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live.
    unsafe { (*this).stop() }
});

impl EventLoopDelayMonitor {
    /// # Safety
    /// `this` is a live box from [`EventLoopDelayMonitor__create`]. JS thread.
    unsafe fn enable(this: *mut Self) -> bool {
        // SAFETY: fn contract. The box does not move, and `stop` leaves the
        // context before the box can be freed.
        unsafe {
            if (*this).enabled {
                return false;
            }
            (*this).enabled = true;
            AbortHandle::arm_owner(this, VirtualMachine::get().context_of_caller_no_frame());
            (*this).schedule();
        }
        true
    }

    fn disable(&mut self) -> bool {
        if !self.enabled {
            return false;
        }
        self.stop();
        true
    }

    /// Nothing is freed here: the histogram's destructor does that.
    fn stop(&mut self) {
        self.enabled = false;
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            timer_all_mut().remove(&raw mut self.event_loop_timer);
        }
        self.abort_handle.leave();
    }

    /// The next tick is one resolution after this call. node counts from
    /// libuv's cached loop time (`uv_timer_again`), which can be a resolution
    /// behind a late tick: the next tick then comes at once and adds a sample
    /// near 0.
    fn schedule(&mut self) {
        let next = Timespec::ms_from_now(
            TimespecMockMode::ForceRealTime,
            i64::from(self.resolution_ms),
        );
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        timer_all_mut().insert(&raw mut self.event_loop_timer);
    }

    pub(crate) fn on_fire(&mut self) {
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        // SAFETY: the samples outlive this box (struct docs).
        unsafe { EventLoopDelayHistogramData__recordDelta(self.samples) };
        self.schedule();
    }
}

#[unsafe(no_mangle)]
extern "C" fn EventLoopDelayMonitor__create(
    samples: NonNull<Samples>,
    resolution_ms: i32,
) -> *mut EventLoopDelayMonitor {
    bun_core::heap::into_raw(Box::new(EventLoopDelayMonitor {
        event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::EventLoopDelayMonitor),
        abort_handle: AbortHandle::for_owner::<EventLoopDelayMonitor>(),
        samples,
        resolution_ms,
        enabled: false,
    }))
}

/// # Safety
/// `this` came from [`EventLoopDelayMonitor__create`] and was not destroyed. JS thread.
#[unsafe(no_mangle)]
unsafe extern "C" fn EventLoopDelayMonitor__enable(this: *mut EventLoopDelayMonitor) -> bool {
    // SAFETY: fn contract.
    unsafe { EventLoopDelayMonitor::enable(this) }
}

/// # Safety
/// As [`EventLoopDelayMonitor__enable`].
#[unsafe(no_mangle)]
unsafe extern "C" fn EventLoopDelayMonitor__disable(this: *mut EventLoopDelayMonitor) -> bool {
    // SAFETY: fn contract.
    unsafe { (*this).disable() }
}

/// # Safety
/// As [`EventLoopDelayMonitor__enable`]. `this` is not used again.
#[unsafe(no_mangle)]
unsafe extern "C" fn EventLoopDelayMonitor__destroy(this: *mut EventLoopDelayMonitor) {
    // SAFETY: fn contract.
    unsafe {
        (*this).stop();
        bun_core::heap::destroy(this);
    }
}
