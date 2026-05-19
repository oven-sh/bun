#![deny(unsafe_op_in_unsafe_fn)]

use core::ptr::NonNull;

static mut ALL: Option<NonNull<All>> = None;

struct All {
    ticks: u32,
}

impl All {
    fn drain_timers_like(&mut self) {
        // Mirrors current source: receiver is still `&mut self`, but the body
        // immediately converts to raw and only makes short-lived inner borrows
        // before firing the re-entrant callback.
        let this: *mut Self = self;

        {
            let all = unsafe { &mut *this };
            all.ticks += 1;
        }

        fire_reentrant_callback();
    }

    fn update_like(&mut self) {
        self.ticks += 1;
    }
}

fn fire_reentrant_callback() {
    let this = unsafe { ALL.unwrap().as_ptr() };
    unsafe { (*this).update_like() };
}

fn main() {
    let mut all = All { ticks: 0 };
    unsafe {
        ALL = NonNull::new(&raw mut all);
    }
    all.drain_timers_like();
    core::hint::black_box(all.ticks);
}
