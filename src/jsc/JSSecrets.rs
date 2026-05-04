use core::mem::offset_of;

use bun_aio::KeepAlive;
use bun_jsc::{AnyTask, ConcurrentTask, JSGlobalObject, JSValue, Strong, VirtualMachine};
use bun_threading::{WorkPool, WorkPoolTask};

pub struct SecretsJob {
    vm: &'static VirtualMachine,
    task: WorkPoolTask,
    any_task: AnyTask,
    poll: KeepAlive,
    promise: Strong,

    ctx: *mut SecretsJobOptions,
}

// Opaque pointer to C++ SecretsJobOptions struct
#[repr(C)]
pub struct SecretsJobOptions {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Bun__SecretsJobOptions__runTask(ctx: *mut SecretsJobOptions, global: *mut JSGlobalObject);
    fn Bun__SecretsJobOptions__runFromJS(
        ctx: *mut SecretsJobOptions,
        global: *mut JSGlobalObject,
        promise: JSValue,
    );
    fn Bun__SecretsJobOptions__deinit(ctx: *mut SecretsJobOptions);
}

impl SecretsJob {
    pub fn create(
        global: &JSGlobalObject,
        ctx: *mut SecretsJobOptions,
        promise: JSValue,
    ) -> *mut SecretsJob {
        let vm = global.bun_vm();
        let job = Box::into_raw(Box::new(SecretsJob {
            vm,
            task: WorkPoolTask {
                callback: Self::run_task,
            },
            // SAFETY: any_task is overwritten immediately below before any use.
            any_task: unsafe { core::mem::zeroed() },
            poll: KeepAlive::default(),
            ctx,
            promise: Strong::create(promise, global),
        }));
        // TODO(port): AnyTask::New(T, &cb).init(ptr) is a comptime type-generator in Zig;
        // assumed Rust shape is AnyTask::new::<T>(cb, ptr).
        // SAFETY: job was just allocated above and is non-null.
        unsafe {
            (*job).any_task = AnyTask::new::<SecretsJob>(Self::run_from_js, job);
        }
        job
    }

    pub fn run_task(task: *mut WorkPoolTask) {
        // SAFETY: task points to SecretsJob.task; SecretsJob was allocated via
        // Box::into_raw in `create` and is alive until run_from_js drops it.
        let job: &mut SecretsJob = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(SecretsJob, task))
                .cast::<SecretsJob>()
        };
        let vm = job.vm;
        // PORT NOTE: reshaped for borrowck — Zig used `defer vm.enqueueTaskConcurrent(...)`;
        // moved after the FFI call since there is no early return between them.
        // SAFETY: ctx is a valid C++ SecretsJobOptions* held alive until Drop.
        unsafe {
            Bun__SecretsJobOptions__runTask(job.ctx, vm.global as *const _ as *mut _);
        }
        vm.enqueue_task_concurrent(ConcurrentTask::create(job.any_task.task()));
    }

    pub fn run_from_js(this: *mut SecretsJob) {
        // `defer this.deinit()` — take ownership; Drop runs at scope exit on all paths.
        // SAFETY: `this` was produced by Box::into_raw in `create` and is uniquely owned here.
        let this = unsafe { Box::from_raw(this) };
        let vm = this.vm;

        if vm.is_shutting_down() {
            return;
        }

        let promise = this.promise.get();
        if promise.is_empty() {
            return;
        }

        // SAFETY: ctx is a valid C++ SecretsJobOptions* held alive until Drop.
        unsafe {
            Bun__SecretsJobOptions__runFromJS(this.ctx, vm.global as *const _ as *mut _, promise);
        }
    }

    pub fn schedule(&mut self) {
        self.poll.ref_(self.vm);
        WorkPool::schedule(&mut self.task);
    }
}

impl Drop for SecretsJob {
    fn drop(&mut self) {
        // SAFETY: ctx is the C++ SecretsJobOptions* passed to `create`; C++ side owns cleanup.
        unsafe {
            Bun__SecretsJobOptions__deinit(self.ctx);
        }
        self.poll.unref(self.vm);
        // self.promise: Strong drops automatically.
        // bun.destroy(this): handled by Box drop in run_from_js.
    }
}

// Helper function for C++ to call with opaque pointer
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Secrets__scheduleJob(
    global: *mut JSGlobalObject,
    options: *mut SecretsJobOptions,
    promise: JSValue,
) {
    // SAFETY: global is a valid &JSGlobalObject for the duration of this call (C++ caller contract).
    let global = unsafe { &*global };
    let job = SecretsJob::create(global, options, promise);
    // SAFETY: job is non-null, freshly allocated, uniquely owned.
    unsafe { (*job).schedule() };
}

// Zig `fixDeadCodeElimination` + `comptime { _ = ... }` dropped:
// #[unsafe(no_mangle)] already prevents DCE of Bun__Secrets__scheduleJob in Rust.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSSecrets.zig (86 lines)
//   confidence: medium
//   todos:      2
//   notes:      intrusive WorkPoolTask via offset_of!; AnyTask::new<T> shape assumed; vm.global field access assumed
// ──────────────────────────────────────────────────────────────────────────
