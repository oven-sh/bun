//! Threads that wait for a notification at an address, in the order of their arrival.

use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use bun_engine_wasm_runtime::{Expected, Thrown, Waited};

#[derive(Clone, Copy, PartialEq, Default)]
enum State {
    #[default]
    Idle,
    Woken,
    Interrupted,
}

/// Blocks a thread.
#[derive(Default)]
pub(crate) struct Parker {
    state: Mutex<State>,
    changed: Condvar,
}

static WAITERS: Mutex<Vec<(usize, Arc<Parker>)>> = Mutex::new(Vec::new());

pub(crate) fn notify(address: usize, count: u32) -> u32 {
    let mut woken = 0;
    WAITERS.lock().unwrap().retain(|(waits_at, parker)| {
        let wakes = *waits_at == address && woken < count;
        if wakes {
            parker.change(State::Woken);
            woken += 1;
        }
        !wakes
    });
    woken
}

impl Parker {
    /// Once the last change has been seen.
    fn change(&self, state: State) {
        let old = self.state.lock().unwrap();
        *(self.changed.wait_while(old, |it| *it != State::Idle)).unwrap() = state;
        self.changed.notify_all();
    }

    /// Ends this wait or the next.
    pub(crate) fn interrupt(&self) {
        self.change(State::Interrupted);
    }

    /// # Safety
    /// As for [`Expected::is_at`].
    pub(crate) unsafe fn wait(
        self: &Arc<Self>,
        address: usize,
        expected: Expected,
        timeout: Option<Duration>,
    ) -> Result<Waited, Thrown> {
        let mut waiters = WAITERS.lock().unwrap();
        // SAFETY: the caller's.
        if !unsafe { expected.is_at(address) } {
            return Ok(Waited::NotEqual);
        }
        waiters.push((address, Arc::clone(self)));
        drop(waiters);
        let (state, is_idle) = (self.state.lock().unwrap(), |it: &mut _| *it == State::Idle);
        let timeout = timeout.unwrap_or(Duration::from_secs(1 << 30));
        drop(self.changed.wait_timeout_while(state, timeout, is_idle));
        (WAITERS.lock().unwrap()).retain(|(_, parker)| !Arc::ptr_eq(parker, self));
        let state = std::mem::take(&mut *self.state.lock().unwrap());
        self.changed.notify_all();
        match state {
            State::Idle => Ok(Waited::TimedOut),
            State::Woken => Ok(Waited::Woken),
            State::Interrupted => Err(Thrown),
        }
    }
}
