use core::time::Duration;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use super::Host;
use crate::{GcFree, Vm};

type Key = (Instant, u64);
type Callback = Box<dyn FnOnce(&Vm) + Send + GcFree>;

/// All share the one timer of the event loop.
#[derive(Default)]
pub(super) struct Timers {
    callbacks: BTreeMap<Key, Callback>,
    next_serial: u64,
    /// What the event loop has been told last.
    armed_for: Option<Instant>,
    is_closed: bool,
}

impl Timers {
    fn earliest(&self) -> Option<Instant> {
        self.callbacks.first_key_value().map(|(key, _)| key.0)
    }

    pub(super) fn rearm(&mut self, host: &Host) {
        self.armed_for = self.earliest();
        let now = Instant::now();
        let delay = self.armed_for.map(|it| it.saturating_duration_since(now));
        host.with_event_loop(|it| it.set_timer(delay));
    }

    /// The callbacks, to be dropped without the lock.
    pub(super) fn close(&mut self) -> impl Sized + use<> {
        self.is_closed = true;
        core::mem::take(&mut self.callbacks)
    }
}

/// Starts timers of a `Vm` from any thread.
#[derive(Clone)]
pub struct TimerQueue(Arc<Host>);

/// Dropping it does not cancel it.
pub struct Timer {
    host: Arc<Host>,
    key: Key,
}

impl TimerQueue {
    /// The callback is dropped without having run if the `Vm` goes first.
    pub fn start(
        &self,
        delay: Duration,
        callback: impl FnOnce(&Vm) + Send + GcFree + 'static,
    ) -> Timer {
        const LONGEST: Duration = Duration::from_secs(i32::MAX as u64);
        let time = Instant::now() + delay.min(LONGEST);
        let mut timers = self.0.timers.lock();
        let key = (time, timers.next_serial);
        timers.next_serial += 1;
        if !timers.is_closed {
            timers.callbacks.insert(key, Box::new(callback));
            if timers.armed_for.is_none_or(|armed_for| time < armed_for) {
                timers.rearm(&self.0);
            }
        }
        drop(timers);
        Timer {
            host: Arc::clone(&self.0),
            key,
        }
    }
}

impl Timer {
    pub fn time(&self) -> Instant {
        self.key.0
    }

    /// Whether it had yet to run.
    pub fn cancel(&self) -> bool {
        let callback = self.host.timers.lock().callbacks.remove(&self.key);
        callback.is_some()
    }
}

impl Vm {
    pub fn timer_queue(&self) -> TimerQueue {
        TimerQueue(Arc::clone(&self.services.deferred.host))
    }

    /// Those that they start wait for the next call.
    pub fn run_due_timers(&self) {
        let host = &self.services.deferred.host;
        let (now, first_new) = (Instant::now(), host.timers.lock().next_serial);
        loop {
            let mut timers = host.timers.lock();
            let Some(first) = timers.callbacks.first_entry() else {
                break timers.armed_for = None;
            };
            if first.key().0 > now || first.key().1 >= first_new {
                break timers.rearm(host);
            }
            let callback = first.remove();
            drop(timers);
            callback(self);
        }
    }
}
