use bun_event_loop::Task;
use bun_io::KeepAlive;
use bun_threading::work_pool::{IntrusiveWorkTask as _, Task as WorkPoolTask, WorkPool};

use crate::event_loop::ConcurrentTask;
use crate::{JSGlobalObject, JsResult, VirtualMachineRef as VirtualMachine};

/// Per-job payload trait. Implementors own the off-thread work body and the
/// JS-thread completion; the surrounding heap/queue/keep-alive plumbing is
/// supplied by [`AnyTaskJob`].
///
/// `Drop` on the implementor is the deinit path — it runs on the JS thread
/// (from `run_from_js`'s `heap::take`) on every exit, including the
/// `is_shutting_down` early-out and `init` failure.
pub trait AnyTaskJobCtx: Sized {
    /// Optional fallible JS-thread setup, run after heap allocation but before
    /// `schedule`. On error the job is freed (running `Drop`). Default: no-op.
    #[inline]
    fn init(&mut self, _global: &JSGlobalObject) -> JsResult<()> {
        Ok(())
    }

    /// Work-pool body — runs OFF the JS thread. `global` is the creating VM's
    /// `*mut JSGlobalObject` (raw, not `&` — most impls ignore it; the two
    /// C++-backed ctxs forward it through FFI without dereferencing).
    fn run(&mut self, global: *mut JSGlobalObject);

    /// JS-thread completion. Called once after `run` re-queues onto the event
    /// loop, unless the VM is already shutting down. Any `Err` is surfaced as
    /// the completion callback's result (i.e. propagated to the tick loop).
    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()>;
}

/// Heap-allocated offload job; created via [`AnyTaskJob::create`] and freed in
/// `run_from_js` (or on `init` failure). `ctx` is `pub` so callers can read
/// e.g. a `JSPromiseStrong` field after scheduling.
#[repr(C)]
pub struct AnyTaskJob<C> {
    run_from_js_erased: fn(*mut ()) -> JsResult<()>,
    release_erased: fn(*mut ()),
    vm: bun_ptr::BackRef<VirtualMachine>,
    task: WorkPoolTask,
    poll: KeepAlive,
    pub ctx: C,
}

/// `task_tag::AnyTaskJob` dispatch entry: read the erased completion at the
/// head of the allocation and call it with the whole-job pointer.
///
/// # Safety
/// `ptr` must be a live `*mut AnyTaskJob<C>` (for some `C`) produced by
/// [`AnyTaskJob::create`]; ownership transfers (the entry frees the job).
pub unsafe fn dispatch_erased(ptr: *mut ()) -> JsResult<()> {
    // SAFETY: `AnyTaskJob<C>` is `#[repr(C)]` with `run_from_js_erased`
    // first; caller contract that `ptr` is such an allocation.
    let entry = unsafe { *ptr.cast::<fn(*mut ()) -> JsResult<()>>() };
    entry(ptr)
}

/// Free a queued job at VM shutdown without running its completion; the ctx
/// `Drop` needs the still-live VM to release its JSC handles and resources.
///
/// # Safety
/// `ptr` must be a live `*mut AnyTaskJob<C>` from [`AnyTaskJob::create`],
/// popped from the event-loop queue (so it held exclusive ownership); frees it.
pub unsafe fn release_erased(ptr: *mut ()) {
    // SAFETY: `AnyTaskJob<C>` is `#[repr(C)]` with `release_erased` second;
    // caller contract that `ptr` is such an allocation.
    let entry = unsafe { *ptr.cast::<fn(*mut ())>().add(1) };
    entry(ptr)
}

const _: () = assert!(core::mem::offset_of!(AnyTaskJob<()>, run_from_js_erased) == 0);
const _: () = assert!(
    core::mem::offset_of!(AnyTaskJob<()>, release_erased)
        == core::mem::size_of::<fn(*mut ()) -> JsResult<()>>()
);

impl<C> bun_event_loop::Taskable for AnyTaskJob<C> {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AnyTaskJob;
}

bun_threading::intrusive_work_task!([C] AnyTaskJob<C>, task);

impl<C> Drop for AnyTaskJob<C> {
    #[inline]
    fn drop(&mut self) {
        // No-op while inactive (init-failure path never `ref_`ed).
        self.poll.unref(bun_io::js_vm_ctx());
        // `ctx: C` drops after this via field drop glue.
    }
}

impl<C: AnyTaskJobCtx> AnyTaskJob<C> {
    /// Heap-allocate, wire the intrusive `WorkPoolTask`, and run
    /// [`AnyTaskJobCtx::init`]. On `init` error the allocation is freed
    /// (running `Drop for C`). The returned pointer is owned by the caller
    /// until handed to [`Self::schedule`].
    pub fn create(global: &JSGlobalObject, ctx: C) -> JsResult<*mut Self> {
        let vm = bun_ptr::BackRef::new(global.bun_vm());
        let job = bun_core::heap::into_raw(Box::new(Self {
            run_from_js_erased: |p| Self::run_from_js(p.cast::<Self>()),
            release_erased: |p| Self::release(p.cast::<Self>()),
            vm,
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_task,
            },
            poll: KeepAlive::default(),
            ctx,
        }));
        // `ctx.init` may throw (e.g. CryptoJob<Scrypt>); on error, reclaim the
        // box so `Drop for C` releases any resources `ctx` already owns.
        let mut guard = scopeguard::guard(job, |job| {
            // SAFETY: `job` came from `heap::into_raw` above and was not consumed.
            drop(unsafe { bun_core::heap::take(job) });
        });
        // SAFETY: `job` is exclusively owned here.
        unsafe { (**guard).ctx.init(global)? };
        Ok(scopeguard::ScopeGuard::into_inner(guard))
    }

    /// `KeepAlive::ref_` the JS event loop and hand the intrusive task to the
    /// work pool. Ownership transfers to the pool → `run_task` →
    /// `run_from_js`.
    ///
    /// # Safety
    /// `this` must be a live pointer returned by [`Self::create`] that has not
    /// yet been scheduled.
    pub unsafe fn schedule(this: *mut Self) {
        // SAFETY: caller contract. `schedule` is a cross-thread handoff — a
        // worker may run and free the job as soon as it's queued — so the
        // pointer handed to the pool is derived from the raw `this` and nothing
        // touches the job afterwards.
        unsafe { (*this).poll.ref_(bun_io::js_vm_ctx()) };
        // SAFETY: `this` is live; the pointer handed to the pool is derived
        // from the raw `this` and nothing touches the job after the schedule.
        WorkPool::schedule(unsafe { &raw mut (*this).task });
    }

    /// [`Self::create`] + [`Self::schedule`]. For callers that don't need to
    /// read back from `ctx` after scheduling.
    pub fn create_and_schedule(global: &JSGlobalObject, ctx: C) -> JsResult<()> {
        let job = Self::create(global, ctx)?;
        // SAFETY: `job` is a freshly-created live pointer.
        unsafe { Self::schedule(job) };
        Ok(())
    }

    /// `WorkPoolTask` callback — runs OFF the JS thread.
    ///
    /// Reachable only via the `WorkPoolTask::callback` fn-ptr slot (safe fn
    /// coerces into it) for the `task` field initialised in [`Self::create`]; the
    /// WorkPool calls back with exactly that field, so `from_task_ptr`
    /// recovers the live heap `Self` parent (owned until `run_from_js`
    /// reclaims it). Mirrors [`crate::WorkTask::run_from_thread_pool`].
    fn run_task(task: *mut WorkPoolTask) {
        // SAFETY: only reachable via the `WorkPoolTask::callback` slot wired
        // in `create`; `task` points to `Self.task` and the job is live until
        // `run_from_js` reclaims it.
        let job = unsafe { &mut *Self::from_task_ptr(task) };
        let vm = job.vm;
        job.ctx.run(vm.global);
        // `ConcurrentTask::create` heap-allocates a fresh task; the queue takes
        // ownership of it.
        vm.event_loop_shared()
            .enqueue_task_concurrent(ConcurrentTask::create(Task::init(std::ptr::from_mut(job))));
    }

    fn run_from_js(this: *mut Self) -> JsResult<()> {
        // SAFETY: `this` was produced by `heap::into_raw` in `create` and is
        // uniquely owned here (the task fires exactly once).
        let mut this = unsafe { bun_core::heap::take(this) };
        let vm = this.vm;
        if vm.is_shutting_down() {
            return Ok(());
        }
        this.ctx.then(vm.global())
    }

    /// [`release_erased`]'s monomorphic body.
    fn release(this: *mut Self) {
        // SAFETY: `this` was produced by `heap::into_raw` in `create`; the
        // caller (the popped queue entry) held exclusive ownership.
        drop(unsafe { bun_core::heap::take(this) });
    }
}
