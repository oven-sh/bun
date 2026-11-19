use core::time::Duration;

use bun_threading::{Condvar, Guarded};

/// A thread that is there while it has work. Not the work pool, which the program's blocking calls can fill up.
pub struct OnDemandThread {
    state: Guarded<State>,
    woken: Condvar,
    work: fn(),
}

struct State {
    is_running: bool,
    is_wanted: bool,
}

impl OnDemandThread {
    const LINGERS: Duration = Duration::from_secs(2);

    pub const fn new(work: fn()) -> OnDemandThread {
        OnDemandThread {
            state: Guarded::new(State {
                is_running: false,
                is_wanted: false,
            }),
            woken: Condvar::new(),
            work,
        }
    }

    /// `work` begins once more after this call has begun.
    pub fn wake(&'static self) {
        let mut state = self.state.lock();
        state.is_wanted = true;
        if core::mem::replace(&mut state.is_running, true) {
            return self.woken.notify_one();
        }
        drop(state);
        let spawned = std::thread::Builder::new().spawn(|| {
            bun_core::Output::Source::configure_named_thread_no_js(bun_core::zstr!(
                "OpenTelemetry"
            ));
            self.run(Self::LINGERS);
        });
        if spawned.is_err() {
            self.run(Duration::ZERO);
        }
    }

    fn run(&self, lingers: Duration) {
        loop {
            let mut state = self.state.lock();
            if !state.is_wanted {
                let _ = (self.woken).timed_wait_guarded(&mut state, lingers.as_nanos() as u64);
            }
            if !core::mem::take(&mut state.is_wanted) {
                state.is_running = false;
                return;
            }
            drop(state);
            (self.work)();
        }
    }
}
