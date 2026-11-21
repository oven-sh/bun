//! Threads that start tasks in the order of their arrival, and end when there is nothing to do.

use core::cell::Cell;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use core::time::Duration;
use std::collections::VecDeque;
use std::thread::JoinHandle;

use bun_core::{Timespec, TimespecMockMode};

use crate::spin::Spin;
use crate::thread_pool::Task;
use crate::{Condition, Guarded};

struct Queued(*mut Task);

// SAFETY: a task is made to be run by another thread.
unsafe impl Send for Queued {}

struct State {
    tasks: VecDeque<Queued>,
    threads: usize,
    /// Those that are waiting or starting.
    idle_threads: usize,
    /// One of them is awake, and takes the next task without a signal.
    is_spinning: bool,
    spin: Spin,
    /// When a thread last ran out of tasks.
    idle_since: Option<u64>,
}

pub struct Config {
    pub name: &'static str,
    pub max_threads: usize,
    pub stack_size: usize,
    pub on_thread_start: fn(),
    /// See [`on_new_thread`].
    pub has_new_threads: bool,
}

pub struct FifoPool {
    config: Config,
    state: Guarded<State>,
    queued: Condition,
    /// For the one that is spinning.
    has_task: AtomicBool,
}

fn now_ns() -> u64 {
    Timespec::now(TimespecMockMode::ForceRealTime).ns()
}

static NEW_THREADS: AtomicUsize = AtomicUsize::new(0);

/// In any pool.
pub fn has_new_thread() -> bool {
    NEW_THREADS.load(Ordering::SeqCst) > 0
}

const MAX_SUCCESSES: u8 = 2;

/// A thread is new until it sleeps after `attempt` has succeeded on it, or until `MAX_SUCCESSES`.
pub fn on_new_thread(attempt: impl FnOnce() -> bool) -> bool {
    let has_succeeded = SUCCESSES_LEFT.get() > 0 && attempt();
    match (has_succeeded, SUCCESSES_LEFT.get()) {
        (false, _) => {}
        (true, ..=1) => stop_being_new(),
        (true, left) => SUCCESSES_LEFT.set(left - 1),
    }
    has_succeeded
}

fn stop_being_new() {
    if SUCCESSES_LEFT.take() > 0 {
        NEW_THREADS.fetch_sub(1, Ordering::SeqCst);
    }
}

thread_local! {
    static SUCCESSES_LEFT: Cell<u8> = const { Cell::new(0) };
    static POOL: Cell<*const FifoPool> = const { Cell::new(ptr::null()) };
    static AFTER: Cell<*mut Task> = const { Cell::new(ptr::null_mut()) };
}

impl FifoPool {
    pub const fn new(config: Config) -> FifoPool {
        FifoPool {
            config,
            state: Guarded::new(State {
                tasks: VecDeque::new(),
                threads: 0,
                idle_threads: 0,
                is_spinning: false,
                spin: Spin::new(),
                idle_since: None,
            }),
            queued: Condition::new(),
            has_task: AtomicBool::new(false),
        }
    }

    pub fn schedule(&'static self, task: *mut Task) {
        let mut state = self.state.lock();
        state.tasks.push_back(Queued(task));
        if state.is_spinning && state.tasks.len() == 1 {
            return self.has_task.store(true, Ordering::SeqCst);
        }
        let is_short = state.idle_threads < state.tasks.len();
        drop(state);
        self.queued.notify_one();
        if is_short {
            self.add_threads();
        }
    }

    /// If the system has none to give, tasks wait for the threads that there are.
    fn add_threads(&'static self) {
        loop {
            let mut state = self.state.lock();
            if state.idle_threads >= state.tasks.len() || state.threads == self.config.max_threads {
                return;
            }
            state.threads += 1;
            state.idle_threads += 1;
            NEW_THREADS.fetch_add(self.config.has_new_threads.into(), Ordering::SeqCst);
            drop(state);
            if self.spawn().is_ok() {
                continue;
            }
            NEW_THREADS.fetch_sub(self.config.has_new_threads.into(), Ordering::SeqCst);
            let mut state = self.state.lock();
            state.threads -= 1;
            state.idle_threads -= 1;
            if state.threads > 0 {
                return;
            }
            drop(state);
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn spawn(&'static self) -> std::io::Result<JoinHandle<()>> {
        std::thread::Builder::new()
            .name(self.config.name.into())
            .stack_size(self.config.stack_size)
            .spawn(|| self.run())
    }

    pub fn has_this_thread(&self) -> bool {
        ptr::eq(POOL.get(), self)
    }

    /// For the end of a task: the thread that it frees saves waking another one.
    pub fn schedule_after_this_task(&'static self, task: *mut Task) {
        match self.has_this_thread() && AFTER.get().is_null() {
            true => AFTER.set(task),
            false => self.schedule(task),
        }
    }

    pub fn go(&'static self, run: impl FnOnce() + Send + 'static) {
        self.schedule(crate::work_pool::task_from_fn(run));
    }

    fn run(&self) {
        const IDLE_NS: u64 = 10_000_000_000;

        (self.config.on_thread_start)();
        POOL.set(self);
        SUCCESSES_LEFT.set(MAX_SUCCESSES * u8::from(self.config.has_new_threads));
        let mut state = self.state.lock();
        loop {
            while let Some(Queued(task)) = state.tasks.pop_front() {
                state.idle_threads -= 1;
                drop(state);
                // SAFETY: what `schedule` was given, once.
                unsafe { ((*task).callback)(task) };
                state = self.state.lock();
                state.idle_threads += 1;
                let after = AFTER.replace(ptr::null_mut());
                if !after.is_null() {
                    state.tasks.push_back(Queued(after));
                }
            }
            let (start, limit) = (now_ns(), state.spin.limit_ns());
            state.idle_since = Some(start);
            if limit > 0 && !state.is_spinning {
                state.is_spinning = true;
                self.has_task.store(false, Ordering::SeqCst);
                drop(state);
                while !self.has_task.load(Ordering::SeqCst) && now_ns() < start + limit {
                    core::hint::spin_loop();
                }
                state = self.state.lock();
                state.is_spinning = false;
            }
            if state.tasks.is_empty() && SUCCESSES_LEFT.get() < MAX_SUCCESSES {
                stop_being_new();
            }
            if state.tasks.is_empty()
                && self.queued.timed_wait_guarded(&mut state, IDLE_NS).is_err()
                && state.tasks.is_empty()
            {
                state.threads -= 1;
                state.idle_threads -= 1;
                return stop_being_new();
            }
            if let Some(since) = state.idle_since.take() {
                state.spin.waited(since, now_ns(), limit);
            }
        }
    }
}
