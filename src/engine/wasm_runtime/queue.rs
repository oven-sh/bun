//! Threads that validate and compile in the background. They start on demand and end when they are idle.

use std::collections::VecDeque;

use bun_engine_wasm_format::Scratch;
use bun_threading::{Condition, Guarded};

use crate::code::Compilers;
use crate::resources::resources;

/// The most urgent first.
#[derive(Clone, Copy)]
pub(crate) enum Priority {
    Validation,
    LoopEntry,
    Optimization,
}

const PRIORITIES: usize = 3;
const STACK_SIZE: usize = 4 << 20;

/// How long a thread waits for a job, in nanoseconds.
#[derive(Clone, Copy)]
struct Patience {
    with_memory: u64,
    /// After that.
    without_memory: u64,
}

const PATIENCE: Patience = Patience {
    with_memory: 100_000_000,
    without_memory: 10_000_000_000,
};

/// Memory that one job leaves to the next.
#[derive(Default)]
pub(crate) struct Workspace {
    pub(crate) validation: Scratch,
    pub(crate) compilers: Compilers,
}

type Job = Box<dyn FnOnce(&mut Workspace) + Send>;

struct State {
    jobs: [VecDeque<Job>; PRIORITIES],
    threads: usize,
    /// Of those, how many run a job.
    busy: usize,
}

impl State {
    fn waiting_jobs(&self) -> usize {
        self.jobs.iter().map(VecDeque::len).sum()
    }
}

static STATE: Guarded<State> = Guarded::new(State {
    jobs: [const { VecDeque::new() }; PRIORITIES],
    threads: 0,
    busy: 0,
});
static JOB_ADDED: Condition = Condition::new();
static ALL_DONE: Condition = Condition::new();

pub(crate) fn max_threads() -> usize {
    resources().background_threads.max(1)
}

/// If there is no thread and none can be started, the job runs on this one.
pub(crate) fn schedule(priority: Priority, job: impl FnOnce(&mut Workspace) + Send + 'static) {
    let mut state = STATE.lock();
    state.jobs[priority as usize].push_back(Box::new(job));
    let needs_thread =
        state.threads < max_threads() && state.threads - state.busy < state.waiting_jobs();
    state.threads += usize::from(needs_thread);
    drop(state);
    JOB_ADDED.signal();
    if needs_thread {
        let thread = std::thread::Builder::new().name("Wasm Compiler".into());
        if thread
            .stack_size(STACK_SIZE)
            .spawn(|| work(PATIENCE))
            .is_err()
        {
            stand_in();
        }
    }
}

#[cold]
fn stand_in() {
    let mut state = STATE.lock();
    if state.threads > 1 {
        state.threads -= 1;
        return;
    }
    drop(state);
    work(Patience {
        with_memory: 0,
        without_memory: 0,
    });
}

fn work(patience: Patience) {
    let mut workspace = None;
    let mut state = STATE.lock();
    loop {
        let Some(job) = state.jobs.iter_mut().find_map(VecDeque::pop_front) else {
            let nanoseconds = match workspace {
                Some(_) => patience.with_memory,
                None => patience.without_memory,
            };
            let waited = JOB_ADDED.timed_wait_guarded(&mut state, nanoseconds);
            if waited.is_ok() || state.waiting_jobs() != 0 {
                continue;
            }
            if workspace.is_none() {
                state.threads -= 1;
                return;
            }
            drop(state);
            workspace = None;
            (resources().release_free_memory)();
            state = STATE.lock();
            continue;
        };
        state.busy += 1;
        drop(state);
        job(workspace.get_or_insert_default());
        state = STATE.lock();
        state.busy -= 1;
        if state.busy == 0 && state.waiting_jobs() == 0 {
            ALL_DONE.broadcast();
        }
    }
}

/// Returns when the threads in the background have nothing to do.
pub fn wait_for_background_work() {
    let mut state = STATE.lock();
    while state.busy != 0 || state.waiting_jobs() != 0 {
        ALL_DONE.wait_guarded(&mut state);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use super::{Patience, Priority, STATE, work};

    #[test]
    fn urgent_jobs_come_first_and_an_idle_thread_ends() {
        use Priority::{LoopEntry, Optimization, Validation};
        let (send, receive) = mpsc::channel();
        let mut state = STATE.lock();
        for (number, priority) in (0..).zip([Optimization, LoopEntry, Validation, LoopEntry]) {
            let send = send.clone();
            let job = move |_: &mut _| send.send(number).unwrap();
            state.jobs[priority as usize].push_back(Box::new(job));
        }
        state.threads += 1;
        drop(state);
        work(Patience {
            with_memory: 1000,
            without_memory: 1000,
        });
        assert_eq!(receive.try_iter().collect::<Vec<_>>(), [2, 1, 3, 0]);
        assert_eq!(STATE.lock().threads, 0);
    }
}
