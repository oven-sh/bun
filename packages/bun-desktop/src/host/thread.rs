//! Unless `BUN_DESKTOP_THREADS=1`, windows and everything that they show are not on the thread that runs JavaScript.

use std::cell::{Cell, OnceCell};
use std::collections::VecDeque;
use std::ffi::{CStr, c_void};
use std::mem::MaybeUninit;
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use super::system;
use crate::remote::guest;
use crate::sync::{Condvar, Mutex};

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
        let (is_first, is_awaited) = (jobs.len() == 1, self.is_awaited.load(Ordering::Relaxed));
        drop(jobs);
        if is_awaited {
            self.posted.notify_one();
        }
        is_first && !is_awaited
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
    static HOLDS_JOBS: Cell<bool> = const { Cell::new(false) };
    static HAS_HELD_JOBS: Cell<bool> = const { Cell::new(false) };
    static HAS_ANSWERED: Cell<bool> = const { Cell::new(false) };
    static IS_ANSWERING: Cell<bool> = const { Cell::new(false) };
}

pub fn exists() -> bool {
    EXISTS.load(Ordering::Relaxed)
}

pub fn is_elsewhere() -> bool {
    exists() && !IS_CURRENT.get()
}

/// Not with `std::thread`, which allocates what only the end of the thread frees: the process may end first.
pub fn detach(stack_size: usize, run: fn()) -> bool {
    extern "C" fn start(run: *mut c_void) -> *mut c_void {
        // SAFETY: what `detach` has passed.
        unsafe { std::mem::transmute::<*mut c_void, fn()>(run)() };
        std::ptr::null_mut()
    }
    let (mut attributes, mut thread) = (MaybeUninit::uninit(), MaybeUninit::uninit());
    // SAFETY: the attributes are initialized first.
    unsafe {
        libc::pthread_attr_init(attributes.as_mut_ptr());
        libc::pthread_attr_setstacksize(attributes.as_mut_ptr(), stack_size);
        libc::pthread_attr_setdetachstate(attributes.as_mut_ptr(), libc::PTHREAD_CREATE_DETACHED);
        #[cfg(target_os = "macos")]
        libc::pthread_attr_set_qos_class_np(
            attributes.as_mut_ptr(),
            libc::qos_class_t::QOS_CLASS_USER_INITIATED,
            0,
        );
        let status = libc::pthread_create(
            thread.as_mut_ptr(),
            attributes.as_ptr(),
            start,
            run as *mut c_void,
        );
        libc::pthread_attr_destroy(attributes.as_mut_ptr());
        status == 0
    }
}

/// The current thread. One that waits for it does not lend its priority.
pub fn is_needed_for_frames() {
    #[cfg(target_os = "macos")]
    // SAFETY: it only takes numbers.
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE, 0)
    };
}

/// Of the current thread. Linux takes 15 bytes.
pub fn set_name(name: &CStr) {
    // SAFETY: it is a C string.
    unsafe {
        #[cfg(target_os = "linux")]
        libc::pthread_setname_np(libc::pthread_self(), name.as_ptr());
        #[cfg(target_os = "macos")]
        libc::pthread_setname_np(name.as_ptr());
    }
}

/// `run` calls `enter`.
pub fn spawn(run: fn()) {
    let is_wanted = std::env::var("BUN_DESKTOP_THREADS").as_deref() != Ok("1");
    if (system::RUNS_ON_ANY_THREAD && is_wanted || guest::is_on())
        && !EXISTS.swap(true, Ordering::Relaxed)
    {
        EXISTS.store(detach(8 << 20, run), Ordering::Relaxed);
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
    if JOBS.push(Box::new(job)) && !guest::is_on() {
        if HOLDS_JOBS.get() {
            HAS_HELD_JOBS.set(true)
        } else {
            system::wake_ui()
        }
    }
}

/// So that the UI thread wakes once for all that this one posts.
pub fn hold_jobs() {
    HOLDS_JOBS.set(true);
}

pub fn release_jobs() {
    HOLDS_JOBS.set(false);
    if HAS_HELD_JOBS.take() {
        system::wake_ui();
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
    release_jobs();
    let result = OnceCell::new();
    if is_for_javascript {
        REPLIES.run_until(|| receiver.try_recv().is_ok_and(|it| result.set(it).is_ok()));
    }
    let result = result
        .into_inner()
        .unwrap_or_else(|| receiver.recv().expect("the UI thread is gone"));
    result.unwrap_or_else(|panic| resume_unwind(panic))
}

/// Returns when what this thread has posted is done.
pub fn catch_up() {
    if !HAS_STOPPED.load(Ordering::Relaxed) {
        ask(|| ());
    }
}

pub fn has_jobs() -> bool {
    !JOBS.is_empty()
}

pub fn run_jobs() {
    // One question tends to be followed by another.
    const MAX_ROUNDS: usize = 32;
    for _ in 0..MAX_ROUNDS {
        while let Some(job) = JOBS.pop() {
            crate::guard("error", (), job);
        }
        if !HAS_ANSWERED.take() || !JOBS.wait(Some(Instant::now())) {
            return;
        }
    }
    system::wake_ui();
}

static IS_BUSY: AtomicBool = AtomicBool::new(false);

/// Where there are no windows.
pub fn only_run_jobs() {
    loop {
        JOBS.wait(None);
        IS_BUSY.store(true, Ordering::SeqCst);
        while let Some(job) = JOBS.pop() {
            crate::guard("error", (), job);
        }
        IS_BUSY.store(false, Ordering::SeqCst);
    }
}

/// That thread is not done with what this one has posted.
pub fn is_behind() -> bool {
    is_elsewhere() && (has_jobs() || IS_BUSY.load(Ordering::SeqCst))
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
        system::wake_ui();
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
