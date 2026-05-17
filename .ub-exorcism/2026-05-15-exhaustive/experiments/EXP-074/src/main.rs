#![allow(dead_code)]

// Mirrors src/runtime/timer/timer_object_internals.rs:
// - TimerObjectInternals::parent_ptr(&self) starts from `std::ptr::from_ref(self).cast_mut()`.
// - event_loop_timer(&self) recovers the parent and returns a raw `*mut EventLoopTimer`.
// - set_event_loop_timer_state(&self) writes a plain field through that pointer.
//
// The important shape is not the timer logic; it is the shared reference:
// `&Internals -> *mut Internals -> *mut Parent -> *mut Timer -> write`.

#[repr(C)]
struct EventLoopTimer {
    state: u8,
}

#[repr(C)]
struct TimerObjectInternals {
    kind: u8,
}

#[repr(C)]
struct TimeoutObject {
    event_loop_timer: EventLoopTimer,
    internals: TimerObjectInternals,
}

impl TimerObjectInternals {
    fn parent_ptr(&self) -> *mut TimeoutObject {
        let this = core::ptr::from_ref::<Self>(self).cast_mut();
        let offset = core::mem::offset_of!(TimeoutObject, internals);
        this.cast::<u8>().wrapping_sub(offset).cast::<TimeoutObject>()
    }

    fn event_loop_timer(&self) -> *mut EventLoopTimer {
        unsafe { core::ptr::addr_of_mut!((*self.parent_ptr()).event_loop_timer) }
    }

    fn set_event_loop_timer_state(&self, state: u8) {
        unsafe { (*self.event_loop_timer()).state = state };
    }
}

fn main() {
    let parent = TimeoutObject {
        event_loop_timer: EventLoopTimer { state: 0 },
        internals: TimerObjectInternals { kind: 1 },
    };

    let internals: &TimerObjectInternals = &parent.internals;
    internals.set_event_loop_timer_state(7);

    // Keep the write observable for non-Miri builds.
    assert_eq!(parent.event_loop_timer.state, 7);
}
