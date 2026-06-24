//! EXP-039: Mirrors `src/jsc/any_task_job.rs::AnyTaskJob::run_task`
//! (`:141-153`). The WorkPool entry point invokes
//!
//! ```ignore
//! fn run_task(task: *mut WorkPoolTask) {
//!     let job = unsafe { &mut *Self::from_task_ptr(task) };
//!     let vm = job.vm;
//!     job.ctx.run(vm.global);           // <-- no catch_unwind
//!     vm.event_loop_shared()
//!         .enqueue_task_concurrent(
//!             ConcurrentTask::create(job.any_task.task()),
//!         );
//! }
//! ```
//!
//! If `C::run` panics, the trailing `enqueue_task_concurrent` is skipped:
//!
//!   (a) The heap-allocated job (handed off via `bun_core::heap::into_raw`
//!       in `Self::create`) is never reclaimed by `run_from_js` and leaks
//!       (`Drop for AnyTaskJob` / `KeepAlive::ref_` is never released).
//!   (b) `Drop for C` never runs on the JS thread, violating any
//!       JS-thread-only invariants assumed by `Drop for C`.
//!   (c) The unwind continues into the WorkPool dispatcher. If that frame
//!       (FFI into C++) lacks its own `catch_unwind`, the panic crosses an
//!       FFI boundary -- UB per the Rustonomicon ("Unwinding into Rust from
//!       foreign code is undefined behavior").
//!
//! Falsifiability: the standalone repro models only the panic-safety leak
//! (point (a)); the FFI-cross UB (point (c)) is contractual since the
//! WorkPool dispatcher is C++ in the real codebase and cannot be modeled
//! standalone. Per instructions: CONFIRMED panic-safety bug;
//! CONTRACTUAL-BUT-DEFENSIBLE for strict-Rustonomicon UB.

use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Tracks live `AnyTaskJob` allocations (proxy for `KeepAlive::ref_`).
static LIVE_JOBS: AtomicUsize = AtomicUsize::new(0);
/// Tracks how many times the teardown enqueue actually fires.
static TEARDOWN_ENQUEUES: AtomicUsize = AtomicUsize::new(0);

/// Stand-in for `C` (the `AnyTaskJobCtx` trait object).
struct PanickyCtx;
impl PanickyCtx {
    fn run(&mut self) {
        panic!("simulated panic inside C::run on WorkPool thread");
    }
}

/// Stand-in for `AnyTaskJob<C>`. Holds a callback (analogue of
/// `KeepAlive::ref_` keeping the JS-side promise alive) and a teardown
/// closure (analogue of `enqueue_task_concurrent`).
struct AnyTaskJob {
    ctx: PanickyCtx,
    // Boxed to make the leak observable through `LIVE_JOBS`.
    _keep_alive: Box<()>,
}

impl AnyTaskJob {
    fn new() -> *mut Self {
        LIVE_JOBS.fetch_add(1, Ordering::SeqCst);
        // Mirrors `bun_core::heap::into_raw(Box::new(...))`.
        Box::into_raw(Box::new(AnyTaskJob {
            ctx: PanickyCtx,
            _keep_alive: Box::new(()),
        }))
    }
}

impl Drop for AnyTaskJob {
    fn drop(&mut self) {
        LIVE_JOBS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Mirrors `AnyTaskJob::run_task` -- no `catch_unwind` barrier.
fn run_task(task: *mut AnyTaskJob) {
    // SAFETY (mirrored): only reachable via the `WorkPoolTask::callback`
    // slot; `task` points to a live `AnyTaskJob`.
    let job = unsafe { &mut *task };
    job.ctx.run(); // <-- panics
    // Never reached: completion enqueue. In the real code this is:
    //   vm.event_loop_shared().enqueue_task_concurrent(...)
    // which on the JS thread would `heap::take(this)` and drop the job.
    TEARDOWN_ENQUEUES.fetch_add(1, Ordering::SeqCst);
    // Simulate `run_from_js` reclaiming and dropping the job:
    let _ = unsafe { Box::from_raw(task) };
}

fn main() {
    // Stage 1: hand off a heap-allocated job (mirrors `Self::create`).
    let task: *mut AnyTaskJob = AnyTaskJob::new();
    assert_eq!(LIVE_JOBS.load(Ordering::SeqCst), 1, "job should be live");

    // Stage 2: simulate WorkPool thread dispatch. The dispatcher itself
    // *does* `catch_unwind` in this harness (to keep the test process
    // alive and observable); the bug under test is the **absence** of
    // `catch_unwind` *inside* `run_task` around the body and the trailing
    // enqueue. In the real code, the equivalent of this outer
    // `catch_unwind` is the WorkPool dispatcher (C++) -- which is exactly
    // where the FFI-cross UB lives.
    //
    // `*mut AnyTaskJob` isn't `Send`, but the real WorkPool dispatcher
    // hands raw heap pointers across threads all the time -- mirror that
    // by smuggling the pointer through `usize` (matches what the FFI
    // boundary effectively does).
    let task_addr = task as usize;
    let join = std::thread::spawn(move || {
        panic::catch_unwind(AssertUnwindSafe(move || {
            run_task(task_addr as *mut AnyTaskJob);
        }))
    });
    let res = join.join().expect("thread itself should not propagate");

    // Stage 3: assert the panic-safety bug:
    //
    //   1. `run_task` body panicked (the inner catch returns Err).
    //   2. The teardown enqueue was skipped.
    //   3. The job is LEAKED -- `LIVE_JOBS` is still 1, and the
    //      `KeepAlive::ref_` analogue (the `_keep_alive: Box<()>`) is
    //      still held.
    assert!(res.is_err(), "run_task should have panicked");
    assert_eq!(
        TEARDOWN_ENQUEUES.load(Ordering::SeqCst),
        0,
        "teardown enqueue must NOT have fired (this is the bug)"
    );
    assert_eq!(
        LIVE_JOBS.load(Ordering::SeqCst),
        1,
        "AnyTaskJob is leaked: KeepAlive::ref_ analogue never released"
    );

    println!("EXP-039 CONFIRMED: panic in C::run skipped enqueue_task_concurrent;");
    println!("  - teardown_enqueues = {}", TEARDOWN_ENQUEUES.load(Ordering::SeqCst));
    println!("  - leaked AnyTaskJob count = {}", LIVE_JOBS.load(Ordering::SeqCst));
    println!("FFI-cross UB (panic into C++ WorkPool dispatcher) is CONTRACTUAL");
    println!("  and cannot be witnessed in a standalone Rust repro.");
}
