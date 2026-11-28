//! A thread pool that starts tasks in FIFO order.

use core::cell::Cell;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::collections::VecDeque;
use std::thread::JoinHandle;

use bun_core::{Timespec, TimespecMockMode};

use crate::spin::AdaptiveSpin;
use crate::thread_pool::{Task, exit_spawn_failed};
use crate::{Condition, Guarded};

struct QueuedTask(*mut Task);

// SAFETY: a `Task` is scheduled in order to run on another thread.
unsafe impl Send for QueuedTask {}

struct State {
    tasks: VecDeque<QueuedTask>,
    thread_count: usize,
    /// Threads that are waiting or starting.
    idle_count: usize,
    /// An idle thread is spinning, and takes the next task without a notification.
    is_spinning: bool,
    spin: AdaptiveSpin,
    /// Tasks started since the last `spin.record_wait`.
    started_count: u64,
    /// When a thread last ran out of tasks.
    idle_since_ns: Option<u64>,
}

pub struct Config {
    pub name: &'static str,
    pub max_threads: usize,
    pub stack_size: usize,
    pub on_thread_start: fn(),
    /// See [`try_during_warmup`].
    pub has_warmup: bool,
    /// Otherwise they exit after a timeout, except the last one. Windows cancels the pending I/O of a thread that exits.
    pub keeps_idle_threads: bool,
}

pub struct FifoPool {
    config: Config,
    state: Guarded<State>,
    task_available: Condition,
    /// Polled by the spinning thread.
    has_task: AtomicBool,
}

fn now_ns() -> u64 {
    Timespec::now(TimespecMockMode::ForceRealTime).ns()
}

static WARMING_THREAD_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Across all pools.
pub fn has_warming_thread() -> bool {
    WARMING_THREAD_COUNT.load(Ordering::SeqCst) > 0
}

const MAX_WARMUP_SUCCESSES: u8 = 2;

/// Warm-up ends after `MAX_WARMUP_SUCCESSES`, at the first sleep after a success, or at the idle timeout.
pub fn try_during_warmup(attempt: impl FnOnce() -> bool) -> bool {
    let has_succeeded = REMAINING_WARMUP_SUCCESSES.get() > 0 && attempt();
    if has_succeeded {
        match REMAINING_WARMUP_SUCCESSES.get() {
            ..=1 => end_warmup(),
            remaining => REMAINING_WARMUP_SUCCESSES.set(remaining - 1),
        }
    }
    has_succeeded
}

fn end_warmup() {
    if REMAINING_WARMUP_SUCCESSES.take() > 0 {
        WARMING_THREAD_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

thread_local! {
    static REMAINING_WARMUP_SUCCESSES: Cell<u8> = const { Cell::new(0) };
    static CURRENT_POOL: Cell<*const FifoPool> = const { Cell::new(ptr::null()) };
    static CONTINUATION: Cell<*mut Task> = const { Cell::new(ptr::null_mut()) };
}

impl FifoPool {
    pub const fn new(config: Config) -> FifoPool {
        FifoPool {
            config,
            state: Guarded::new(State {
                tasks: VecDeque::new(),
                thread_count: 0,
                idle_count: 0,
                is_spinning: false,
                spin: AdaptiveSpin::new(),
                started_count: 0,
                idle_since_ns: None,
            }),
            task_available: Condition::new(),
            has_task: AtomicBool::new(false),
        }
    }

    pub fn schedule(&'static self, task: *mut Task) {
        let mut state = self.state.lock();
        state.tasks.push_back(QueuedTask(task));
        if state.is_spinning && state.tasks.len() == 1 {
            return self.has_task.store(true, Ordering::SeqCst);
        }
        let should_add_threads = state.idle_count < state.tasks.len();
        drop(state);
        self.task_available.notify_one();
        if should_add_threads {
            self.add_threads();
        }
    }

    /// If spawning fails, tasks wait for the existing threads.
    fn add_threads(&'static self) {
        loop {
            let mut state = self.state.lock();
            if state.idle_count >= state.tasks.len()
                || state.thread_count == self.config.max_threads
            {
                return;
            }
            state.thread_count += 1;
            state.idle_count += 1;
            WARMING_THREAD_COUNT.fetch_add(self.config.has_warmup.into(), Ordering::SeqCst);
            drop(state);
            let Err(err) = self.spawn() else {
                continue;
            };
            WARMING_THREAD_COUNT.fetch_sub(self.config.has_warmup.into(), Ordering::SeqCst);
            let mut state = self.state.lock();
            state.thread_count -= 1;
            state.idle_count -= 1;
            if state.thread_count == 0 {
                drop(state);
                exit_spawn_failed(&err);
            }
            return;
        }
    }

    fn spawn(&'static self) -> std::io::Result<JoinHandle<()>> {
        std::thread::Builder::new()
            .name(self.config.name.into())
            .stack_size(self.config.stack_size)
            .spawn(|| self.run())
    }

    pub fn max_threads(&self) -> usize {
        self.config.max_threads
    }

    pub fn has_current_thread(&self) -> bool {
        ptr::eq(CURRENT_POOL.get(), self)
    }

    /// Queues `task` when the current task returns, so that no other thread has to be woken for it.
    pub fn schedule_continuation(&'static self, task: *mut Task) {
        if self.has_current_thread() && CONTINUATION.get().is_null() {
            CONTINUATION.set(task);
        } else {
            self.schedule(task);
        }
    }

    pub fn go(&'static self, job: impl FnOnce() + Send + 'static) {
        self.schedule(crate::work_pool::task_from_fn(job));
    }

    fn run(&self) {
        const IDLE_TIMEOUT_NS: u64 = 10_000_000_000;

        (self.config.on_thread_start)();
        CURRENT_POOL.set(self);
        if self.config.has_warmup {
            REMAINING_WARMUP_SUCCESSES.set(MAX_WARMUP_SUCCESSES);
        }
        let mut state = self.state.lock();
        loop {
            while let Some(QueuedTask(task)) = state.tasks.pop_front() {
                state.idle_count -= 1;
                state.started_count += 1;
                drop(state);
                // SAFETY: a scheduled task is live until its callback runs, and it is dequeued once.
                unsafe { ((*task).callback)(task) };
                state = self.state.lock();
                state.idle_count += 1;
                let continuation = CONTINUATION.replace(ptr::null_mut());
                if !continuation.is_null() {
                    state.tasks.push_back(QueuedTask(continuation));
                }
            }
            let idle_start_ns = now_ns();
            let spin_limit_ns = state.spin.limit_ns();
            state.idle_since_ns = Some(idle_start_ns);
            if spin_limit_ns > 0 && !state.is_spinning {
                state.is_spinning = true;
                self.has_task.store(false, Ordering::SeqCst);
                drop(state);
                while !self.has_task.load(Ordering::SeqCst)
                    && now_ns() < idle_start_ns + spin_limit_ns
                {
                    core::hint::spin_loop();
                }
                state = self.state.lock();
                state.is_spinning = false;
            }
            if state.tasks.is_empty() && REMAINING_WARMUP_SUCCESSES.get() < MAX_WARMUP_SUCCESSES {
                end_warmup();
            }
            let can_exit = state.idle_count > 1 && !self.config.keeps_idle_threads;
            let should_persist = !can_exit && REMAINING_WARMUP_SUCCESSES.get() == 0;
            if state.tasks.is_empty() && should_persist {
                self.task_available.wait_guarded(&mut state);
            } else if state.tasks.is_empty()
                && self
                    .task_available
                    .timed_wait_guarded(&mut state, IDLE_TIMEOUT_NS)
                    .is_err()
                && state.tasks.is_empty()
            {
                end_warmup();
                if state.idle_count > 1 && !self.config.keeps_idle_threads {
                    state.thread_count -= 1;
                    state.idle_count -= 1;
                    return;
                }
            }
            if let Some(idle_since_ns) = state.idle_since_ns.take() {
                let started_count = core::mem::take(&mut state.started_count);
                state
                    .spin
                    .record_wait(idle_since_ns, now_ns(), spin_limit_ns, started_count);
            }
        }
    }
}
