use core::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use bun_quic::Instant;

use super::io::now;
use crate::Loop;

const AT_ONCE: u64 = 0;
const NEVER: u64 = u64::MAX;
/// Peers have a say in the deadlines, and the system calls do not take just any.
const MAX_WAIT_MICROS: u64 = 3600 * 1_000_000;

/// What a loop runs around its I/O, so that the writes of a turn leave in one batch.
pub trait Driver {
    /// Before and after the loop polls, if it is time.
    fn process(&self);
    /// After the microtasks have run, if it has been woken.
    fn flush(&self);
    /// When [`Self::process`] has to be called. It is asked after both.
    fn timeout(&self) -> Option<Instant>;
}

#[derive(Default)]
struct Drivers {
    list: RefCell<Vec<Option<Weak<dyn Driver>>>>,
    /// In microseconds, for each entry of `list`.
    deadlines: RefCell<Vec<u64>>,
    is_any_awake: Cell<bool>,
}

impl Drivers {
    #[inline]
    fn of(loop_: &Loop) -> Option<Rc<Self>> {
        let raw = loop_.internal_loop_data.quic_drivers.get().cast::<Self>();
        // SAFETY: the loop has the reference that `Registration::new` gave it.
        (!raw.is_null()).then(|| unsafe {
            Rc::increment_strong_count(raw);
            Rc::from_raw(raw)
        })
    }

    fn get(&self, at: usize) -> Option<Rc<dyn Driver>> {
        self.list.borrow().get(at)?.as_ref()?.upgrade()
    }

    fn earliest(&self) -> u64 {
        self.deadlines
            .borrow()
            .iter()
            .copied()
            .fold(NEVER, u64::min)
    }

    /// `f` may register and unregister.
    fn run(&self, now: u64, f: impl Fn(&dyn Driver)) {
        let mut from = 0;
        while let Some(at) = self.next_due(from, now) {
            self.get(at).inspect(|driver| f(&**driver));
            let timeout = self.get(at).and_then(|it| it.timeout());
            if let Some(deadline) = self.deadlines.borrow_mut().get_mut(at) {
                *deadline = timeout.map_or(NEVER, Instant::as_micros);
            }
            from = at + 1;
        }
    }

    fn next_due(&self, from: usize, now: u64) -> Option<usize> {
        let deadlines = self.deadlines.borrow();
        Some(from + deadlines.get(from..)?.iter().position(|&it| it <= now)?)
    }
}

/// The loop runs the driver for as long as this is kept.
pub struct Registration {
    loop_: &'static Loop,
    drivers: Rc<Drivers>,
    at: usize,
}

impl Registration {
    pub fn new(loop_: &'static Loop, driver: Weak<dyn Driver>) -> Self {
        let drivers = Drivers::of(loop_).unwrap_or_else(|| {
            let drivers = Rc::<Drivers>::default();
            let raw = Rc::into_raw(Rc::clone(&drivers));
            loop_.internal_loop_data.quic_drivers.set(raw.cast());
            drivers
        });
        let mut list = drivers.list.borrow_mut();
        let at = list.iter().position(Option::is_none).unwrap_or_else(|| {
            list.push(None);
            drivers.deadlines.borrow_mut().push(NEVER);
            list.len() - 1
        });
        list[at] = Some(driver);
        drop(list);
        Self { loop_, drivers, at }
    }

    /// For when there is something to flush.
    #[inline]
    pub fn wake(&self) {
        self.forget_timeout();
        self.drivers.is_any_awake.set(true);
    }

    /// For when it may have changed.
    #[inline]
    pub fn forget_timeout(&self) {
        self.drivers.deadlines.borrow_mut()[self.at] = AT_ONCE;
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        let mut list = self.drivers.list.borrow_mut();
        let mut deadlines = self.drivers.deadlines.borrow_mut();
        (list[self.at], deadlines[self.at]) = (None, NEVER);
        while list.pop_if(|it| it.is_none()).is_some() {}
        deadlines.truncate(list.len());
        if list.is_empty() {
            let data = &self.loop_.internal_loop_data;
            let raw = data.quic_drivers.replace(core::ptr::null());
            // SAFETY: it is the reference that `new` gave to the loop.
            drop(unsafe { Rc::from_raw(raw.cast::<Drivers>()) });
        }
    }
}

#[inline]
pub(crate) fn flush(loop_: &Loop) {
    if let Some(drivers) = Drivers::of(loop_).filter(|it| it.is_any_awake.take()) {
        drivers.run(AT_ONCE, |it| it.flush());
    }
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_loop_process(loop_: &Loop) {
    if let Some(drivers) = Drivers::of(loop_) {
        drivers.run(now().as_micros(), |it| it.process());
    }
    let micros = match Drivers::of(loop_).map_or(NEVER, |it| it.earliest()) {
        NEVER => None,
        AT_ONCE => Some(0),
        time => Some(time.saturating_sub(now().as_micros()).min(MAX_WAIT_MICROS)),
    };
    (loop_.internal_loop_data.quic_next_tick_us).set(micros.map_or(-1, |it| it as i64));
    #[cfg(windows)]
    {
        unsafe extern "C" {
            safe fn us_quic_loop_set_timer(loop_: &Loop, ms: core::ffi::c_int);
        }
        match micros {
            None => {}
            // The shortest timer can take 15 milliseconds.
            Some(0) => loop_.wakeup(),
            Some(micros) => us_quic_loop_set_timer(loop_, micros.div_ceil(1000) as i32),
        }
    }
}
