//! Unless `BUN_DESKTOP_THREADS=1`, GPUI and everything that it shows is not on the thread that runs JavaScript.

use std::cell::{Cell, OnceCell};
use std::collections::VecDeque;
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use parking_lot::{Condvar, Mutex};

use super::platform;

type Job = Box<dyn FnOnce() + Send>;

struct Queue {
    jobs: Mutex<VecDeque<Job>>,
    posted: Condvar,
    length: AtomicUsize,
    is_awaited: AtomicBool,
}

impl Queue {
    const fn new() -> Queue {
        Queue {
            jobs: Mutex::new(VecDeque::new()),
            posted: Condvar::new(),
            length: AtomicUsize::new(0),
            is_awaited: AtomicBool::new(false),
        }
    }

    /// Returns whether the thread that it is for has to be woken.
    fn push(&self, job: Job) -> bool {
        let mut jobs = self.jobs.lock();
        jobs.push_back(job);
        self.length.store(jobs.len(), Ordering::Release);
        let must_wake = jobs.len() == 1 && !self.is_awaited.load(Ordering::Relaxed);
        drop(jobs);
        self.posted.notify_one();
        must_wake
    }

    fn pop(&self) -> Option<Job> {
        let mut jobs = self.jobs.lock();
        let job = jobs.pop_front();
        self.length.store(jobs.len(), Ordering::Release);
        job
    }

    fn is_empty(&self) -> bool {
        self.length.load(Ordering::Acquire) == 0
    }

    /// The caller has to run what there is.
    fn wait(&self, until: Option<Instant>) -> bool {
        // An answer often takes less time than going to sleep.
        const AWAKE_FOR: Duration = Duration::from_micros(40);
        self.is_awaited.store(true, Ordering::Relaxed);
        let start = Instant::now();
        while self.is_empty() && start.elapsed() < AWAKE_FOR {
            std::hint::spin_loop();
        }
        let mut jobs = self.jobs.lock();
        while jobs.is_empty() {
            match until {
                Some(until) if self.posted.wait_until(&mut jobs, until).timed_out() => break,
                Some(_) => {}
                None => self.posted.wait(&mut jobs),
            }
        }
        self.is_awaited.store(false, Ordering::Relaxed);
        !jobs.is_empty()
    }

    fn run_until(&self, is_done: impl Fn() -> bool) {
        while !is_done() {
            self.wait(None);
            self.pop().into_iter().for_each(|job| job());
        }
    }
}

static EXISTS: AtomicBool = AtomicBool::new(false);
static HAS_STOPPED: AtomicBool = AtomicBool::new(false);
static JOBS: Queue = Queue::new();
/// For JavaScript's thread while it waits for an answer.
static REPLIES: Queue = Queue::new();
/// For its event loop.
static CALLS: Queue = Queue::new();

thread_local! {
    static IS_CURRENT: Cell<bool> = const { Cell::new(false) };
    static IS_JAVASCRIPT: Cell<bool> = const { Cell::new(false) };
    static HAS_ANSWERED: Cell<bool> = const { Cell::new(false) };
    static IS_ANSWERING: Cell<bool> = const { Cell::new(false) };
}

pub fn exists() -> bool {
    EXISTS.load(Ordering::Relaxed)
}

pub fn is_elsewhere() -> bool {
    exists() && !IS_CURRENT.get()
}

pub fn spawn(run: fn()) {
    let is_wanted = std::env::var("BUN_DESKTOP_THREADS").as_deref() != Ok("1");
    if platform::RUNS_ON_ANY_THREAD && is_wanted && !EXISTS.swap(true, Ordering::Relaxed) {
        let thread = std::thread::Builder::new()
            .name("UI".into())
            .stack_size(8 << 20)
            .spawn(move || {
                IS_CURRENT.set(true);
                run();
            });
        EXISTS.store(thread.is_ok(), Ordering::Relaxed);
    }
}

/// The thread is one that exists, and calls `enter`.
pub fn expect() {
    EXISTS.store(true, Ordering::Relaxed);
}

pub fn enter() {
    IS_CURRENT.set(true);
}

pub fn post(job: impl FnOnce() + Send + 'static) {
    if !is_elsewhere() {
        return job();
    }
    if JOBS.push(Box::new(job)) {
        platform::wake_ui();
    }
}

pub fn ask<R: Send + 'static>(job: impl FnOnce() -> R + Send + 'static) -> R {
    if !is_elsewhere() {
        return job();
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    let is_for_javascript = IS_JAVASCRIPT.get();
    post(move || {
        let was_answering = IS_ANSWERING.get();
        IS_ANSWERING.set(was_answering || is_for_javascript);
        let result = catch_unwind(AssertUnwindSafe(job));
        IS_ANSWERING.set(was_answering);
        HAS_ANSWERED.set(is_for_javascript);
        match is_for_javascript {
            true => drop(REPLIES.push(Box::new(move || drop(sender.send(result))))),
            false => drop(sender.send(result)),
        }
    });
    let result = OnceCell::new();
    if is_for_javascript {
        REPLIES.run_until(|| receiver.try_recv().is_ok_and(|it| result.set(it).is_ok()));
    }
    let result = result
        .into_inner()
        .unwrap_or_else(|| receiver.recv().expect("the UI thread is gone"));
    result.unwrap_or_else(|panic| resume_unwind(panic))
}

pub fn has_jobs() -> bool {
    !JOBS.is_empty()
}

pub fn run_jobs() {
    // One question tends to be followed by another.
    const MAX_ROUNDS: usize = 32;
    for _ in 0..MAX_ROUNDS {
        while let Some(job) = JOBS.pop() {
            job();
        }
        if !HAS_ANSWERED.take() || !JOBS.wait(Some(Instant::now())) {
            return;
        }
    }
    platform::wake_ui();
}

/// JavaScript is waiting for this thread.
pub fn is_answering() -> bool {
    IS_ANSWERING.get()
}

pub fn wait_for_jobs(until: Instant) -> bool {
    JOBS.wait(Some(until))
}

pub fn stop() -> ! {
    loop {
        std::thread::park();
    }
}

pub fn will_stop() {
    HAS_STOPPED.store(true, Ordering::Relaxed);
}

pub fn runs_javascript() {
    IS_JAVASCRIPT.set(true);
}

pub type Function = unsafe extern "C" fn(*mut c_void);

/// # Safety
/// It can be called on that thread.
pub unsafe fn call_on_ui_thread(function: Function, context: *mut c_void) {
    let context = context as usize;
    // SAFETY: the caller's contract.
    let call = move || unsafe { function(context as *mut c_void) };
    if HAS_STOPPED.load(Ordering::Relaxed) {
        call()
    } else {
        ask(call)
    }
}

/// # Safety
/// As above.
pub unsafe fn call_on_javascript_thread(function: Function, context: *mut c_void) {
    let (context, is_done) = (context as usize, Arc::new(AtomicBool::new(false)));
    let (done, was_answering) = (is_done.clone(), IS_ANSWERING.get());
    let call = Box::new(move || {
        // SAFETY: the caller's contract.
        unsafe { function(context as *mut c_void) };
        post(move || done.store(true, Ordering::Relaxed));
    });
    if was_answering {
        REPLIES.push(call);
    } else if CALLS.push(call) {
        super::wake();
    }
    JOBS.run_until(|| is_done.load(Ordering::Relaxed));
    if has_jobs() {
        platform::wake_ui();
    }
}

pub fn has_calls() -> bool {
    !CALLS.is_empty()
}

pub fn run_calls() {
    // One rarely comes alone.
    const PATIENCE: Duration = Duration::from_micros(200);
    while has_calls() {
        CALLS.pop().into_iter().for_each(|call| call());
        CALLS.wait(Some(Instant::now() + PATIENCE));
    }
}
