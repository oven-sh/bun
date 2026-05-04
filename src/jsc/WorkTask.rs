use core::mem::offset_of;

use bun_aio::KeepAlive;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::{ConcurrentTask, EventLoop, JSGlobalObject};
use bun_threading::{WorkPool, WorkPoolTask};

/// A generic task that runs work on a thread pool and executes a callback on the main JavaScript thread.
/// Unlike ConcurrentPromiseTask which automatically resolves a Promise, WorkTask provides more flexibility
/// by allowing the Context to handle the result however it wants (e.g., calling callbacks, emitting events, etc.).
///
/// The Context type must implement:
/// - `run(&Context, &mut WorkTask)` - performs the work on the thread pool
/// - `then(&JSGlobalObject)` - handles the result on the JS thread (no automatic Promise resolution)
///
/// Key differences from ConcurrentPromiseTask:
/// - No automatic Promise creation or resolution
/// - Includes async task tracking for debugging
/// - More flexible result handling via the `then` callback
/// - Context receives a reference to the WorkTask itself in the `run` method
// TODO(port): trait bound synthesized from body call sites (`Context.run` / `ctx.then`).
// Phase B: confirm whether an existing trait already covers this.
pub trait WorkTaskContext: Sized {
    fn run(this: &Self, task: &mut WorkTask<'_, Self>);
    fn then(this: &Self, global_this: &JSGlobalObject) -> Result<(), bun_jsc::JsTerminated>;
}

pub struct WorkTask<'a, Context: WorkTaskContext> {
    pub ctx: &'a Context,
    pub task: WorkPoolTask,
    pub event_loop: &'static EventLoop,
    // allocator field dropped — global mimalloc (see PORTING.md §Allocators)
    pub global_this: &'a JSGlobalObject,
    pub concurrent_task: ConcurrentTask,
    pub async_task_tracker: AsyncTaskTracker,

    // This is a poll because we want it to enter the uSockets loop
    // PORT NOTE: `ref` is a Rust keyword; field renamed to `ref_`.
    pub ref_: KeepAlive,
}

impl<'a, Context: WorkTaskContext> WorkTask<'a, Context> {
    type TaskType = WorkPoolTask;

    pub fn create_on_js_thread(global_this: &'a JSGlobalObject, value: &'a Context) -> *mut Self {
        let vm = global_this.bun_vm();
        let mut this = Box::new(Self {
            event_loop: vm.event_loop(),
            ctx: value,
            global_this,
            task: WorkPoolTask {
                callback: Self::run_from_thread_pool,
                ..Default::default()
            },
            concurrent_task: ConcurrentTask::default(),
            async_task_tracker: AsyncTaskTracker::init(vm),
            ref_: KeepAlive::default(),
        });
        this.ref_.ref_(this.event_loop.virtual_machine);

        // PORT NOTE: intrusive `task` field is recovered via container_of in
        // run_from_thread_pool, so this must live at a stable heap address as a
        // raw pointer. Paired with `Box::from_raw` in `destroy`.
        Box::into_raw(this)
    }

    // PORT NOTE: not `impl Drop` — `ref_.unref` is also called from `run_from_js`,
    // and `Self` is held as a raw pointer (intrusive task). Explicit destroy matches
    // the Zig `bun.destroy(this)` shape.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` was produced by Box::into_raw in create_on_js_thread and
        // has not been freed.
        let this = unsafe { Box::from_raw(this) };
        this.ref_.unref(this.event_loop.virtual_machine);
        // drop(this) — Box freed at scope exit
    }

    pub fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // TODO(port): jsc.markBinding(@src()) — debug-only binding marker
        bun_jsc::mark_binding(core::panic::Location::caller());
        // SAFETY: `task` points to the `task` field of a heap-allocated `Self`
        // created in `create_on_js_thread`; recover the parent via offset_of.
        let this: *mut Self = unsafe {
            (task as *mut u8)
                .sub(offset_of!(Self, task))
                .cast::<Self>()
        };
        // SAFETY: `this` is alive for the duration of the thread-pool callback.
        let this = unsafe { &mut *this };
        Context::run(this.ctx, this);
    }

    pub fn run_from_js(this: &mut Self) -> Result<(), bun_jsc::JsTerminated> {
        // TODO(port): narrow error set — Zig is `bun.JSTerminated!void`
        let ctx = this.ctx;
        let tracker = this.async_task_tracker;
        let vm = this.event_loop.virtual_machine;
        let global_this = this.global_this;
        this.ref_.unref(vm);

        tracker.will_dispatch(global_this);
        let _guard = scopeguard::guard((), |_| tracker.did_dispatch(global_this));
        Context::then(ctx, global_this)
    }

    pub fn schedule(this: &mut Self) {
        let vm = this.event_loop.virtual_machine;
        this.ref_.ref_(vm);
        this.async_task_tracker.did_schedule(this.global_this);
        WorkPool::schedule(&mut this.task);
    }

    pub fn on_finish(this: &mut Self) {
        this.event_loop
            .enqueue_task_concurrent(this.concurrent_task.from(this, .manual_deinit));
        // TODO(port): `.manual_deinit` is a Zig enum literal on ConcurrentTask;
        // replace with the Rust variant once ConcurrentTask is ported.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/WorkTask.zig (88 lines)
//   confidence: medium
//   todos:      4
//   notes:      intrusive task + raw-ptr ownership; `&'a Context` per LIFETIMES.tsv but crosses threads — Phase B may need *mut/NonNull instead
// ──────────────────────────────────────────────────────────────────────────
