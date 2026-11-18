//! Threads that compile in the background. They start on demand and end when they are idle.

use std::collections::VecDeque;

use bun_engine_codegen::passes::Level;
use bun_threading::{Condition, Guarded};

use super::plan::Compiler;

const STACK_SIZE: usize = 2 << 20;
const IDLE_NANOSECONDS: u64 = 10_000_000_000;

type Job = Box<dyn FnOnce(&mut Compiler) + Send>;

struct State {
    /// By level. Those that are done quickly go first.
    jobs: [VecDeque<Job>; 2],
    threads: usize,
    idle: usize,
}

static STATE: Guarded<State> = Guarded::new(State {
    jobs: [const { VecDeque::new() }; 2],
    threads: 0,
    idle: 0,
});
static JOB_ADDED: Condition = Condition::new();

fn max_threads() -> usize {
    (bun_engine_platform::machine::processor_count() as usize - 1).clamp(1, 7)
}

/// If there is no thread and none can be started, the job runs on this one.
pub(super) fn schedule(level: Level, job: Job) {
    let mut state = STATE.lock();
    state.jobs[level as usize].push_back(job);
    let waiting: usize = state.jobs.iter().map(VecDeque::len).sum();
    let needs_thread = state.threads < max_threads() && state.idle < waiting;
    state.threads += usize::from(needs_thread);
    drop(state);
    JOB_ADDED.signal();
    if needs_thread {
        let thread = std::thread::Builder::new().name("JS Compiler".into());
        let thread = thread.stack_size(STACK_SIZE);
        if thread.spawn(|| work(IDLE_NANOSECONDS)).is_err() {
            work(0);
        }
    }
}

fn work(idle_nanoseconds: u64) {
    let mut compiler = Compiler::default();
    let mut state = STATE.lock();
    loop {
        if let Some(job) = state.jobs.iter_mut().find_map(VecDeque::pop_front) {
            drop(state);
            job(&mut compiler);
            state = STATE.lock();
            continue;
        }
        state.idle += 1;
        let waited = JOB_ADDED.timed_wait_guarded(&mut state, idle_nanoseconds);
        state.idle -= 1;
        if waited.is_err() && state.jobs.iter().all(VecDeque::is_empty) {
            state.threads -= 1;
            return;
        }
    }
}
