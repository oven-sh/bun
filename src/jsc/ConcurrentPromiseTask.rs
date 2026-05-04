use core::mem::offset_of;

use bun_aio::KeepAlive;
use bun_jsc::{ConcurrentTask, EventLoop, JSGlobalObject, JSPromise, VirtualMachine};
// TODO(port): exact path for `jsc.JSPromise.Strong` — assuming `bun_jsc::JSPromiseStrong`
use bun_jsc::JSPromiseStrong;
use bun_threading::{WorkPool, WorkPoolTask};

/// The `Context` type parameter for [`ConcurrentPromiseTask`] must implement this trait:
/// - `run(&mut self)` — performs the work on the thread pool
/// - `then(&mut self, JSPromise)` — resolves the promise with the result on the JS thread
pub trait ConcurrentPromiseTaskContext {
    fn run(&mut self);
    // TODO(port): narrow error set — Zig is `bun.JSTerminated!void`
    fn then(&mut self, promise: JSPromise) -> Result<(), bun_jsc::JsTerminated>;
}

/// A generic task that runs work on a thread pool and resolves a JavaScript Promise with the result.
/// This allows CPU-intensive operations to be performed off the main JavaScript thread while
/// maintaining a Promise-based API for JavaScript consumers.
///
/// The Context type must implement:
/// - `run(*Context)` - performs the work on the thread pool
/// - `then(*Context, jsc.JSPromise)` - resolves the promise with the result on the JS thread
pub struct ConcurrentPromiseTask<'a, Context: ConcurrentPromiseTaskContext> {
    pub ctx: &'a mut Context,
    pub task: WorkPoolTask,
    pub event_loop: &'static EventLoop,
    // PORT NOTE: `allocator: std.mem.Allocator` field dropped — global mimalloc (non-AST crate)
    pub promise: JSPromiseStrong,
    pub global_this: &'a JSGlobalObject,
    pub concurrent_task: ConcurrentTask,

    // This is a poll because we want it to enter the uSockets loop
    pub r#ref: KeepAlive,
}

impl<'a, Context: ConcurrentPromiseTaskContext> ConcurrentPromiseTask<'a, Context> {
    // Zig: `pub const new = bun.TrivialNew(@This());` — folded into `Box::new` below.

    pub fn create_on_js_thread(
        global_this: &'a JSGlobalObject,
        value: &'a mut Context,
    ) -> Box<Self> {
        let mut this = Box::new(Self {
            ctx: value,
            task: WorkPoolTask {
                callback: Self::run_from_thread_pool,
                ..Default::default()
            },
            event_loop: VirtualMachine::get().event_loop,
            promise: JSPromiseStrong::default(),
            global_this,
            concurrent_task: ConcurrentTask::default(),
            r#ref: KeepAlive::default(),
        });
        let promise = JSPromise::create(global_this);
        this.promise.strong.set(global_this, promise.to_js());
        this.r#ref.r#ref(this.event_loop.virtual_machine);
        this
    }

    pub fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: `task` points to the `task` field of a `ConcurrentPromiseTask<Context>`;
        // it was registered via `schedule()` below from a `Box<Self>` that outlives this call.
        let this: &mut Self = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(Self, task))
                .cast::<Self>()
        };
        this.ctx.run();
        this.on_finish();
    }

    // TODO(port): narrow error set — Zig is `bun.JSTerminated!void`
    pub fn run_from_js(&mut self) -> Result<(), bun_jsc::JsTerminated> {
        let promise = self.promise.swap();
        self.r#ref.unref(self.event_loop.virtual_machine);

        let ctx = &mut *self.ctx;

        ctx.then(promise)
    }

    pub fn schedule(&mut self) {
        WorkPool::schedule(&mut self.task);
    }

    pub fn on_finish(&mut self) {
        // TODO(port): `ConcurrentTask::from(self, .manual_deinit)` — verify enum variant name
        self.event_loop.enqueue_task_concurrent(
            self.concurrent_task
                .from(self as *mut Self, ConcurrentTask::AutoDeinit::ManualDeinit),
        );
    }

    /// Frees the heap allocation backing this task.
    ///
    /// # Safety
    /// `this` must have been produced by `Box::into_raw` (via `create_on_js_thread` /
    /// the `.manual_deinit` concurrent-task path) and must not be used afterwards.
    pub unsafe fn destroy(this: *mut Self) {
        // `promise.deinit()` is handled by `JSPromiseStrong: Drop`.
        // SAFETY: caller contract above.
        drop(unsafe { Box::from_raw(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ConcurrentPromiseTask.zig (76 lines)
//   confidence: medium
//   todos:      4
//   notes:      Box<Self> + intrusive @fieldParentPtr + &'a mut Context borrow won't survive borrowck across thread-pool hop; Phase B likely needs raw *mut Context and *mut Self ownership semantics. `bun.JSTerminated` mapped to `bun_jsc::JsTerminated` (not in type table).
// ──────────────────────────────────────────────────────────────────────────
