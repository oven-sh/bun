use core::mem::offset_of;

use bun_io::{self as Async, KeepAlive};
use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask, Taskable, TaskTag};
use bun_threading::{work_pool::WorkPool, WorkPoolTask};

use crate::debugger::AsyncTaskTracker;
use crate::event_loop::EventLoop;
use crate::JSGlobalObject;
use bun_ptr::BackRef;

/// A generic task that runs work on a thread pool and executes a callback on the main JavaScript thread.
/// Unlike ConcurrentPromiseTask which automatically resolves a Promise, WorkTask provides more flexibility
/// by allowing the Context to handle the result however it wants (e.g., calling callbacks, emitting events, etc.).
///
/// The Context type must implement:
/// - `run(*mut Context, *mut WorkTask)` - performs the work on the thread pool
/// - `then(*mut Context, &JSGlobalObject)` - handles the result on the JS thread (no automatic Promise resolution)
///
/// Key differences from ConcurrentPromiseTask:
/// - No automatic Promise creation or resolution
/// - Includes async task tracking for debugging
/// - More flexible result handling via the `then` callback
/// - Context receives a reference to the WorkTask itself in the `run` method
pub trait WorkTaskContext: Sized {
    /// Tag this `WorkTask<Self>` carries when enqueued back onto the JS event
    /// loop's concurrent queue (`task_tag::*`). Mirrors Zig's per-instantiation
    /// `TaggedPointerUnion` membership (e.g. `GetAddrInfoRequestTask`).
    const TASK_TAG: TaskTag;

    /// Perform the work on the thread pool. `this`/`task` are raw pointers
    /// because the context is heap-allocated, crosses threads, and is mutated
    /// — the Zig signature is `fn run(this: *Context, task: *Task) void`.
    fn run(this: *mut Self, task: *mut WorkTask<Self>);
    fn then(this: *mut Self, global_this: &JSGlobalObject) -> Result<(), crate::JsTerminated>;
}

pub struct WorkTask<Context: WorkTaskContext> {
    pub ctx: *mut Context,
    pub task: WorkPoolTask,
    pub event_loop: *const EventLoop,
    // allocator field dropped — global mimalloc (see PORTING.md §Allocators)
    pub global_this: BackRef<JSGlobalObject>,
    pub concurrent_task: ConcurrentTask,
    pub async_task_tracker: AsyncTaskTracker,

    // This is a poll because we want it to enter the uSockets loop
    // PORT NOTE: `ref` is a Rust keyword; field renamed to `ref_`.
    pub ref_: KeepAlive,
}

// SAFETY: `WorkTask` is moved into the thread pool's queue (intrusive `task`
// node) and back via the concurrent task queue. All access to `ctx` /
// `global_this` is sequenced by the work-pool → on_finish → run_from_js
// hand-off; raw pointers are inert.
unsafe impl<C: WorkTaskContext> Send for WorkTask<C> {}

impl<Context: WorkTaskContext> Taskable for WorkTask<Context> {
    const TAG: TaskTag = Context::TASK_TAG;
}

impl<Context: WorkTaskContext> WorkTask<Context> {
    pub fn create_on_js_thread(global_this: &JSGlobalObject, value: *mut Context) -> *mut Self {
        // SAFETY: `bun_vm_ptr()` never returns null for a Bun-owned global; the
        // VirtualMachine outlives every WorkTask scheduled on it. Using the raw
        // `*mut` accessor (not `bun_vm() -> &VirtualMachine`) so the &mut borrow
        // for `next_async_task_id` carries write provenance.
        let vm = unsafe { &mut *global_this.bun_vm_ptr() };
        let event_loop = vm.event_loop();
        let mut this = Box::new(Self {
            event_loop,
            ctx: value,
            global_this: BackRef::new(global_this),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_from_thread_pool,
            },
            concurrent_task: ConcurrentTask::default(),
            async_task_tracker: AsyncTaskTracker::init(vm),
            ref_: KeepAlive::default(),
        });
        this.ref_.ref_(js_event_loop_ctx());

        // PORT NOTE: intrusive `task` field is recovered via container_of in
        // run_from_thread_pool, so this must live at a stable heap address as a
        // raw pointer. Paired with `heap::take` in `destroy`.
        bun_core::heap::into_raw(this)
    }

    // PORT NOTE: not `impl Drop` — `ref_.unref` is also called from `run_from_js`,
    // and `Self` is held as a raw pointer (intrusive task). Explicit destroy matches
    // the Zig `bun.destroy(this)` shape.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` was produced by heap::alloc in create_on_js_thread and
        // has not been freed.
        let mut this = unsafe { bun_core::heap::take(this) };
        this.ref_.unref(js_event_loop_ctx());
        // drop(this) — Box freed at scope exit
    }

    /// SAFETY: `task` points to the `task` field of a heap-allocated `Self`
    /// created in `create_on_js_thread`.
    pub unsafe fn run_from_thread_pool(task: *mut WorkPoolTask) {
        crate::mark_binding();
        // SAFETY: recover the parent via offset_of.
        let this: *mut Self = unsafe {
            bun_core::from_field_ptr!(Self, task, task)
        };
        // SAFETY: `this` is alive for the duration of the thread-pool callback.
        Context::run(unsafe { (*this).ctx }, this);
    }

    pub fn run_from_js(this: *mut Self) -> Result<(), crate::JsTerminated> {
        // SAFETY: `this` is the live heap allocation from create_on_js_thread,
        // exclusively owned by the JS thread at this point.
        let this = unsafe { &mut *this };
        let ctx = this.ctx;
        let tracker = this.async_task_tracker;
        let global_this = this.global_this.get();
        this.ref_.unref(js_event_loop_ctx());

        let _dispatch = tracker.dispatch(global_this);
        Context::then(ctx, global_this)
    }

    pub fn schedule(this: *mut Self) {
        // SAFETY: `this` is the live heap allocation from create_on_js_thread.
        let this = unsafe { &mut *this };
        this.ref_.ref_(js_event_loop_ctx());
        this.async_task_tracker.did_schedule(this.global_this.get());
        WorkPool::schedule(&raw mut this.task);
    }

    pub fn on_finish(this: *mut Self) {
        // SAFETY: `this` is alive (called from `Context::run` on the thread pool).
        let event_loop = unsafe { &*(*this).event_loop };
        // SAFETY: `concurrent_task` is an intrusive field of `*this`; `from`
        // re-initializes it in place and returns the same address.
        let task = std::ptr::from_mut(unsafe { (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit) });
        event_loop.enqueue_task_concurrent(task);
    }
}

/// Bridge to the aio-level `EventLoopCtx` used by `KeepAlive`. WorkTask always
/// runs on the JS event loop, so the global `Js` ctx is the correct erasure.
#[inline]
fn js_event_loop_ctx() -> Async::EventLoopCtx {
    Async::posix_event_loop::get_vm_ctx(Async::AllocatorType::Js)
}

// ported from: src/jsc/WorkTask.zig
