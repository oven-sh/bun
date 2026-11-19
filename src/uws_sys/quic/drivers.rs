use core::cell::RefCell;
use std::rc::Rc;

use bun_quic::Instant;

use super::io::now;
use crate::Loop;

/// What a loop runs around its I/O, so that the writes of a turn leave in one batch.
pub trait Driver {
    /// Before and after the loop polls.
    fn process(&self);
    /// After the microtasks have run.
    fn flush(&self);
    /// When [`Self::process`] has to be called at the latest.
    fn timeout(&self) -> Option<Instant>;
}

#[derive(Default)]
struct Drivers(RefCell<Vec<Rc<dyn Driver>>>);

impl Drivers {
    #[inline]
    fn of(loop_: &Loop) -> Option<Rc<Self>> {
        let raw = loop_.internal_loop_data.quic_drivers.get().cast::<Self>();
        // SAFETY: the loop has the reference that `register` gave it.
        (!raw.is_null()).then(|| unsafe {
            Rc::increment_strong_count(raw);
            Rc::from_raw(raw)
        })
    }

    /// `f` may register and unregister.
    fn run(&self, loop_: &Loop, f: impl Fn(&dyn Driver)) {
        for at in 0.. {
            let Some(driver) = self.0.borrow().get(at).cloned() else {
                break;
            };
            f(&*driver);
        }
        let timeout = self.0.borrow().iter().filter_map(|it| it.timeout()).min();
        let micros = timeout.map(|it| (it - now()).as_micros() as i64);
        (loop_.internal_loop_data.quic_next_tick_us).set(micros.unwrap_or(-1));
        #[cfg(windows)]
        if let Some(micros) = micros {
            unsafe extern "C" {
                safe fn us_quic_loop_set_timer(loop_: &Loop, ms: core::ffi::c_int);
            }
            let ms = (micros as u64).div_ceil(1000).clamp(1, i32::MAX as u64);
            us_quic_loop_set_timer(loop_, ms as i32);
        }
    }
}

pub fn register(loop_: &Loop, driver: Rc<dyn Driver>) {
    let drivers = Drivers::of(loop_).unwrap_or_else(|| {
        let drivers = Rc::<Drivers>::default();
        let raw = Rc::into_raw(Rc::clone(&drivers));
        loop_.internal_loop_data.quic_drivers.set(raw.cast());
        drivers
    });
    drivers.0.borrow_mut().push(driver);
}

pub fn unregister(loop_: &Loop, driver: &dyn Driver) {
    let Some(drivers) = Drivers::of(loop_) else {
        return;
    };
    let mut list = drivers.0.borrow_mut();
    list.retain(|it| !core::ptr::addr_eq(Rc::as_ptr(it), driver));
    if list.is_empty() {
        let data = &loop_.internal_loop_data;
        let raw = data.quic_drivers.replace(core::ptr::null());
        // SAFETY: it is the reference that `register` gave to the loop.
        drop(unsafe { Rc::from_raw(raw.cast::<Drivers>()) });
    }
}

#[inline]
pub(crate) fn flush(loop_: &Loop) {
    if let Some(drivers) = Drivers::of(loop_) {
        drivers.run(loop_, |it| it.flush());
    }
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_loop_process(loop_: &Loop) {
    if let Some(drivers) = Drivers::of(loop_) {
        drivers.run(loop_, |it| it.process());
    }
}
