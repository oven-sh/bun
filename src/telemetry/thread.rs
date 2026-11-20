use core::time::Duration;

use bun_threading::{Condvar, Guarded, WorkPool};

/// A thread that is there while it has work. Not the work pool, which the program's blocking calls can fill up.
pub struct OnDemandThread {
    state: Guarded<State>,
    woken: Condvar,
    work: fn(),
}

struct State {
    is_running: bool,
    is_wanted: bool,
    is_working: bool,
}

impl OnDemandThread {
    const LINGERS: Duration = Duration::from_secs(2);

    pub const fn new(work: fn()) -> OnDemandThread {
        OnDemandThread {
            state: Guarded::new(State {
                is_running: false,
                is_wanted: false,
                is_working: false,
            }),
            woken: Condvar::new(),
            work,
        }
    }

    /// `work` begins once more after this call has begun. False if there is no thread to be had now.
    pub fn wake(&'static self) -> bool {
        let mut state = self.state.lock();
        state.is_wanted = true;
        if core::mem::replace(&mut state.is_running, true) {
            self.woken.notify_one();
            return true;
        }
        drop(state);
        let spawned = std::thread::Builder::new().spawn(|| {
            bun_core::Output::Source::configure_named_thread_no_js(bun_core::zstr!(
                "OpenTelemetry"
            ));
            self.run(Self::LINGERS);
        });
        if spawned.is_ok() {
            return true;
        }
        if WorkPool::get().has_workers() {
            bun_core::handle_oom(WorkPool::go(self, |this| this.run(Duration::ZERO)));
            return true;
        }
        self.state.lock().is_running = false;
        false
    }

    pub fn is_idle(&self) -> bool {
        let state = self.state.lock();
        !state.is_wanted && !state.is_working
    }

    fn run(&self, lingers: Duration) {
        loop {
            let mut state = self.state.lock();
            state.is_working = false;
            if !state.is_wanted {
                let _ = (self.woken).timed_wait_guarded(&mut state, lingers.as_nanos() as u64);
            }
            if !core::mem::take(&mut state.is_wanted) {
                state.is_running = false;
                return;
            }
            state.is_working = true;
            drop(state);
            (self.work)();
        }
    }
}
