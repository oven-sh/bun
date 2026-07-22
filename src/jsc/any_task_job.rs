//! `AnyTaskJob<C>` — the canonical "{WorkPool offload → AnyTask re-queue →
//! JS-thread completion}" boilerplate. Each call site supplies only a `Ctx` impl of
//! [`AnyTaskJobCtx`]; the heap allocation, intrusive `WorkPoolTask`/`AnyTask`
//! wiring, `KeepAlive` ref/unref, and `is_shutting_down` guard live here.
//!
//! NOT for `Taskable`-tagged jobs (`AsyncFSTask`, `ConcurrentPromiseTask`,
//! `WorkTask`) — those go through the central `TaskTag` dispatch table, not
//! the type-erased `AnyTask` path, and would need a per-instantiation tag.

use core::ffi::c_void;
use core::ptr::NonNull;
use std::sync::Arc;

use bun_event_loop::AnyTask::AnyTask;
use bun_io::KeepAlive;
use bun_threading::RwLock;
use bun_threading::work_pool::{IntrusiveWorkTask as _, Task as WorkPoolTask, WorkPool};

use crate::event_loop::{ConcurrentTask, ConcurrentTaskItem, EventLoop};
use crate::{JSGlobalObject, JsResult, VirtualMachineRef as VirtualMachine};

/// Close-once fence between a VM and every [`AnyTaskJob`] it schedules, so a
/// pool-thread completion that lands after `worker.terminate()` frees the VM
/// observes the free instead of pushing into the freed event loop.
///
/// Each VM owns one `Arc` clone; each in-flight job holds another (so the gate
/// itself outlives both). The pool-thread completion takes a read lock across
/// its `enqueue_task_concurrent` push. [`crate::web_worker::WebWorker`]'s
/// shutdown calls [`Self::close`] before draining the concurrent queue and
/// deallocating the VM: taking the write lock waits out every in-flight reader
/// (so their push is visible to the drain), and once `closed` is set any later
/// completion returns without touching the VM. Same fence-then-drain shape as
/// `ScriptExecutionContext::markTerminating` for the C++ `postTaskTo` path.
pub struct AnyTaskGate {
    closed: RwLock<bool>,
}

impl AnyTaskGate {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            closed: RwLock::new(false),
        })
    }

    /// Mark the owning VM as going away. Takes the write lock, so it returns
    /// only after every concurrent [`Self::enqueue`] reader has released.
    pub fn close(&self) {
        *self.closed.write() = true;
    }

    /// Push `task` onto `event_loop` if the gate is still open. The read lock
    /// held across the push orders it before [`Self::close`] returns. Returns
    /// `false` (caller retains `task`) when closed.
    ///
    /// # Safety
    /// `event_loop` must be the `EventLoop` of the VM that owns this gate, and
    /// [`Self::close`] must be called on it before that VM is freed.
    unsafe fn enqueue(
        &self,
        event_loop: *const EventLoop,
        task: NonNull<ConcurrentTaskItem>,
    ) -> bool {
        let guard = self.closed.read();
        if *guard {
            return false;
        }
        // SAFETY: caller contract — gate open ⇒ `close()` hasn't returned ⇒
        // worker shutdown hasn't progressed past it ⇒ the VM (and its embedded
        // event loop) is still live.
        unsafe { (*event_loop).enqueue_task_concurrent(task) };
        drop(guard);
        true
    }
}

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
    /// the `AnyTask` callback's result (i.e. propagated to the tick loop).
    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()>;
}

/// Heap-allocated `{WorkPoolTask, AnyTask, KeepAlive, ctx}` bundle. Created
/// via [`Self::create`] / [`Self::create_and_schedule`]; freed in
/// `run_from_js` (or on `init` failure). `ctx` is `pub` so callers can read
/// e.g. a `JSPromiseStrong` field after scheduling.
pub struct AnyTaskJob<C> {
    vm: bun_ptr::BackRef<VirtualMachine>,
    /// Snapshot of `vm.global` / `vm.event_loop()` at `create` time, plus the
    /// VM's gate, so the pool-thread [`Self::run_task`] never reads a field of
    /// `vm` (which may be a worker freed by terminate() while the task ran).
    /// `vm` itself is only dereferenced on the JS thread ([`Self::run_from_js`]).
    gate: Arc<AnyTaskGate>,
    global: *mut JSGlobalObject,
    event_loop: *const EventLoop,
    task: WorkPoolTask,
    any_task: AnyTask,
    poll: KeepAlive,
    pub ctx: C,
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
    /// Heap-allocate, wire the intrusive `WorkPoolTask`/`AnyTask`, and run
    /// [`AnyTaskJobCtx::init`]. On `init` error the allocation is freed
    /// (running `Drop for C`). The returned pointer is owned by the caller
    /// until handed to [`Self::schedule`].
    pub fn create(global: &JSGlobalObject, ctx: C) -> JsResult<*mut Self> {
        let vm_ref = global.bun_vm();
        let vm = bun_ptr::BackRef::new(vm_ref);
        let job = bun_core::heap::into_raw(Box::new(Self {
            vm,
            gate: Arc::clone(vm_ref.any_task_gate()),
            global: core::ptr::from_ref(global).cast_mut(),
            event_loop: vm_ref.event_loop(),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_task,
            },
            // Overwritten immediately below; `Default` provides a non-null
            // sentinel callback (zeroed() is UB for the `fn` field).
            any_task: AnyTask::default(),
            poll: KeepAlive::default(),
            ctx,
        }));
        // SAFETY: `job` was just allocated and is exclusively owned here.
        // Build the erased AnyTask directly with a non-capturing shim.
        unsafe {
            (*job).any_task = AnyTask {
                ctx: NonNull::new(job.cast::<c_void>()),
                callback: |p: *mut c_void| Self::run_from_js(p.cast::<Self>()).map_err(Into::into),
            };
        }
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
        // SAFETY: caller contract.
        let this = unsafe { &mut *this };
        this.poll.ref_(bun_io::js_vm_ctx());
        WorkPool::schedule(&raw mut this.task);
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
        // `run_from_js` reclaims it (or is leaked below).
        let this = unsafe { Self::from_task_ptr(task) };
        let enqueued = {
            // SAFETY: as above; exclusively owned on this thread until enqueue.
            let job = unsafe { &mut *this };
            job.ctx.run(job.global);
            // `ConcurrentTask::create` heap-allocates a fresh node; the queue
            // takes ownership of it when the push succeeds.
            let node = ConcurrentTask::create(job.any_task.task());
            // SAFETY: `job.event_loop` is the owning VM's loop; worker shutdown
            // closes the gate before freeing it (see `AnyTaskGate`).
            if unsafe { job.gate.enqueue(job.event_loop, node) } {
                true
            } else {
                // SAFETY: `node` came from `ConcurrentTask::create`
                // (heap-owned) and was not handed to the queue.
                unsafe { bun_core::heap::destroy(node.as_ptr()) };
                false
            }
        };
        if enqueued {
            return;
        }
        // VM is gone (worker terminated mid-run). Drop our gate ref so the
        // shared `Arc` can release once every in-flight job has observed the
        // close.
        // SAFETY: `this` is the sole owner (the `&mut` above has ended);
        // `gate` was written in `create` and is never read again past this
        // point (the box is leaked below).
        unsafe { core::ptr::drop_in_place(core::ptr::addr_of_mut!((*this).gate)) };
        // The remainder of the box (`poll`, `ctx`) is intentionally leaked:
        // `ctx` holds `Strong` JSC handles into the dead VM's heap and
        // `poll.unref` would touch the freed event loop. This matches the fate
        // of tasks already queued on a terminated worker's never-drained
        // concurrent queue.
    }

    /// `AnyTask` callback — runs ON the JS thread. Reclaims the heap
    /// allocation; `Drop for Self` (poll.unref) and `Drop for C` run on every
    /// path.
    fn run_from_js(this: *mut Self) -> JsResult<()> {
        // SAFETY: `this` was produced by `heap::into_raw` in `create` and is
        // uniquely owned here (the `AnyTask` fires exactly once).
        let mut this = unsafe { bun_core::heap::take(this) };
        let vm = this.vm;
        if vm.is_shutting_down() {
            return Ok(());
        }
        this.ctx.then(vm.global())
    }
}
