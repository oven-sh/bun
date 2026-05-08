use core::mem::offset_of;

use bun_aio::KeepAlive;
use bun_event_loop::AnyTask::AnyTask;
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};
use crate::event_loop::ConcurrentTask;
use crate::{JSGlobalObject, JSValue, Strong, VirtualMachineRef as VirtualMachine};

pub struct SecretsJob {
    vm: *mut VirtualMachine,
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
        let vm = global.bun_vm_ptr();
        let job = bun_core::heap::into_raw(Box::new(SecretsJob {
            vm,
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_task,
            },
            any_task: AnyTask::default(),
            poll: KeepAlive::default(),
            ctx,
            promise: Strong::create(promise, global),
        }));
        // TODO(port): AnyTask::New(T, &cb).init(ptr) is a comptime type-generator in Zig.
        // SAFETY: job was just allocated above and is non-null.
        unsafe {
            (*job).any_task = AnyTask {
                ctx: core::ptr::NonNull::new(job.cast()),
                callback: Self::run_from_js_erased,
            };
        }
        job
    }

    pub unsafe fn run_task(task: *mut WorkPoolTask) {
        // SAFETY: task points to SecretsJob.task; SecretsJob was allocated via
        // heap::alloc in `create` and is alive until run_from_js drops it.
        let job: &mut SecretsJob = unsafe {
            &mut *bun_core::from_field_ptr!(SecretsJob, task, task)
        };
        let vm = job.vm;
        // PORT NOTE: reshaped for borrowck — Zig used `defer vm.enqueueTaskConcurrent(...)`;
        // moved after the FFI call since there is no early return between them.
        // SAFETY: ctx is a valid C++ SecretsJobOptions* held alive until Drop.
        // vm.global is already *mut JSGlobalObject (Zig `*JSGlobalObject` freely aliases).
        unsafe {
            Bun__SecretsJobOptions__runTask(job.ctx, (*vm).global);
            (*(*vm).event_loop()).enqueue_task_concurrent(ConcurrentTask::create(job.any_task.task()));
        }
    }

    fn run_from_js_erased(this: *mut core::ffi::c_void) -> bun_event_loop::JsResult<()> {
        Self::run_from_js(this.cast::<SecretsJob>());
        Ok(())
    }

    pub fn run_from_js(this: *mut SecretsJob) {
        // `defer this.deinit()` — take ownership; Drop runs at scope exit on all paths.
        // SAFETY: `this` was produced by heap::alloc in `create` and is uniquely owned here.
        let this = unsafe { bun_core::heap::take(this) };
        let vm = this.vm;

        // SAFETY: `vm` is process-lifetime.
        if unsafe { (*vm).is_shutting_down() } {
            return;
        }

        let promise = this.promise.get();
        if promise.is_empty() {
            return;
        }

        // SAFETY: ctx is a valid C++ SecretsJobOptions* held alive until Drop.
        // vm.global is already *mut JSGlobalObject (Zig `*JSGlobalObject` freely aliases).
        unsafe {
            Bun__SecretsJobOptions__runFromJS(this.ctx, (*vm).global, promise);
        }
    }

    pub fn schedule(&mut self) {
        // TODO(port): KeepAlive::ref_ takes an `EventLoopCtx` vtable, not `*mut VM`.
        // Phase-D: route through `bun_aio::get_vm_ctx` once the JSC vtable is wired.
        // self.poll.ref_(self.vm);
        let _ = &mut self.poll;
        WorkPool::schedule(&raw mut self.task);
    }
}

impl Drop for SecretsJob {
    fn drop(&mut self) {
        // SAFETY: ctx is the C++ SecretsJobOptions* passed to `create`; C++ side owns cleanup.
        unsafe {
            Bun__SecretsJobOptions__deinit(self.ctx);
        }
        // TODO(port): self.poll.unref(self.vm) — see schedule() note.
        // self.promise: Strong drops automatically.
        // bun.destroy(this): handled by Box drop in run_from_js.
    }
}

// Helper function for C++ to call with opaque pointer
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Secrets__scheduleJob(
    global: &JSGlobalObject,
    options: *mut SecretsJobOptions,
    promise: JSValue,
) {
    let job = SecretsJob::create(global, options, promise);
    // SAFETY: job is non-null, freshly allocated, uniquely owned.
    unsafe { (*job).schedule() };
}

// Zig `fixDeadCodeElimination` + `comptime { _ = ... }` dropped:
// #[unsafe(no_mangle)] already prevents DCE of Bun__Secrets__scheduleJob in Rust.

// ported from: src/jsc/JSSecrets.zig
