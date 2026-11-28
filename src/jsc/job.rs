//! Work that leaves the JS thread and comes back.
//!
//! A [`Job`] is created on the JS thread, does its heavy part on the
//! [`WorkPool`], and completes on the JS thread again. It holds a
//! [`Ticket`](crate::Ticket) for the whole trip, so its VM is guaranteed to be
//! alive throughout and its completion is always delivered: `then` runs while
//! the VM may still run script, and a completion that lands after the VM began
//! stopping is dropped instead — on the JS thread, heap alive — like every
//! other queued task the teardown releases.
//!
//! The two halves are a convenience, not a safety mechanism:
//! [`JobContext::OffThread`] is what the pool body gets (`Send`);
//! [`JobContext::Js`] is the completion's JS-thread state (promise, callback,
//! wrapper refs, pins, protected buffers) and is only ever touched on the JS
//! thread. JS-backed memory the body reads in place is reachable through
//! [`JsPtr`], dereferenceable only with the job's ticket. An [`OwnedJob`] can
//! also leave the pool to wait, and shares with the JS thread what cancels it.
//!
//! Node's equivalent is `ThreadPoolWork` + `req_wrap`; WebCore's is
//! `WorkerRunLoop::postTask` with `ActiveDOMObject`-owned completions.

use core::convert::Infallible;
use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
#[cfg(windows)]
use std::sync::Arc;

use bun_core::{from_field_ptr, heap};
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, Taskable};
use bun_io::{JsKeepAlive, KeepAlive};
#[cfg(windows)]
use bun_iocp::blocking::CancelToken;
#[cfg(windows)]
use bun_threading::Guarded;
#[cfg(windows)]
use bun_threading::fifo_pool::FifoPool;
#[cfg(windows)]
use bun_threading::work_pool::{DEVICE_POOL, FilePool};
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

use crate::StopReason;
use crate::debugger::AsyncTaskTracker;
use crate::virtual_machine::VirtualMachine;
use crate::vm_handle::Ticket;
use crate::{JSGlobalObject, JsResult};

// ── tokens ────────────────────────────────────────────────────────────────

/// Proof that the holder is on `global`'s JS thread with its heap alive, and whose script it is
/// running for. Host functions and event-loop dispatch have one by construction
/// ([`JSGlobalObject::js_thread`]). Not `Send`.
pub struct JsThread<'a> {
    global: &'a JSGlobalObject,
    context: &'a crate::ScriptExecutionContext,
    _not_send: PhantomData<*mut ()>,
}

impl<'a> JsThread<'a> {
    #[inline]
    pub fn global(&self) -> &'a JSGlobalObject {
        self.global
    }
    #[inline]
    pub fn vm(&self) -> &'a VirtualMachine {
        self.global.bun_vm()
    }
    /// The context of the script this thread is running for: the host function's caller, or the
    /// one a completion entered.
    #[inline]
    pub fn context(&self) -> &'a crate::ScriptExecutionContext {
        self.context
    }
}

impl JSGlobalObject {
    /// A live `&JSGlobalObject` is only ever formed on its own thread (it is an
    /// opaque engine handle); debug builds check.
    #[inline]
    pub fn js_thread<'a>(&'a self, context: &'a crate::ScriptExecutionContext) -> JsThread<'a> {
        #[cfg(debug_assertions)]
        self.bun_vm().handle_ref().assert_js_thread();
        JsThread {
            global: self,
            context,
            _not_send: PhantomData,
        }
    }

    /// This global, and the context of the script that is calling (see
    /// [`VirtualMachine::context_of_caller`]).
    #[inline]
    pub fn js_thread_of_caller(&self) -> JsThread<'_> {
        self.js_thread(self.bun_vm().context_of_caller())
    }
}

// ── JsAffine ──────────────────────────────────────────────────────────────

/// A value that may only be used and dropped on its VM's JS thread: GC
/// handles, keep-alives, wrapper back-pointers, pins, GC protection, and
/// anything built from them. In a job it lives on the [`Js`](JobContext::Js)
/// side, which the carrier only touches there. Derive it
/// (`#[derive(bun_jsc::JsAffine)]`) for aggregates; the derive checks every
/// field.
///
/// # Safety
/// Implement only for types whose every use and whose `Drop` are sound on the
/// owning JS thread with the heap alive (and need not be sound elsewhere).
pub unsafe trait JsAffine {}

// SAFETY (each below): a GC/loop handle or plain data — used and dropped only
// on the owning JS thread by construction of `Job`.
// SAFETY: see the group note above.
unsafe impl JsAffine for crate::Strong {}
// SAFETY: see the group note above.
unsafe impl JsAffine for crate::StrongOptional {}
// SAFETY: see the group note above.
unsafe impl JsAffine for crate::JSPromiseStrong {}
// SAFETY: see the group note above.
unsafe impl<T> JsAffine for crate::Weak<T> {}
// SAFETY: see the group note above.
unsafe impl JsAffine for crate::JsRef {}
// SAFETY: see the group note above.
unsafe impl JsAffine for crate::JSValue {}
// SAFETY: see the group note above.
unsafe impl JsAffine for crate::GlobalRef {}
// SAFETY: see the group note above.
unsafe impl JsAffine for bun_ptr::BackRef<JSGlobalObject> {}
// SAFETY: see the group note above.
unsafe impl JsAffine for KeepAlive {}
// SAFETY: see the group note above.
unsafe impl JsAffine for AsyncTaskTracker {}
// SAFETY: see the group note above.
unsafe impl JsAffine for () {}
// SAFETY: see the group note above.
unsafe impl JsAffine for bool {}
// SAFETY: see the group note above.
unsafe impl<T: JsAffine> JsAffine for Option<T> {}
// SAFETY: see the group note above.
unsafe impl<T: JsAffine> JsAffine for Box<T> {}
// SAFETY: see the group note above.
unsafe impl<A: JsAffine, B: JsAffine> JsAffine for (A, B) {}
// SAFETY: see the group note above.
unsafe impl<A: JsAffine, B: JsAffine, C: JsAffine> JsAffine for (A, B, C) {}
// SAFETY: see the group note above.
unsafe impl<T: ?Sized> JsAffine for JsPtr<T> {}
// SAFETY: see the group note above.
unsafe impl JsAffine for crate::ProtectedJSValue {}

/// A pointer into JS-owned memory (an ArrayBuffer's bytes, a pinned cell, the
/// creating global) that a job carries off-thread. It can be *passed around*
/// anywhere but dereferenced only with proof the VM is alive: the job's
/// [`Ticket`].
#[repr(transparent)]
pub struct JsPtr<T: ?Sized>(NonNull<T>);
// SAFETY: dereferenceable only under a Ticket (see type doc).
unsafe impl<T: ?Sized> Send for JsPtr<T> {}
impl<T: ?Sized> Clone for JsPtr<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T: ?Sized> Copy for JsPtr<T> {}

impl<T: ?Sized> JsPtr<T> {
    /// # Safety
    /// `ptr` stays valid for as long as the VM is alive (the job keeps whatever
    /// owns it — an ArrayBuffer, a wrapper — alive from its `Js` side).
    #[inline]
    pub unsafe fn new(ptr: NonNull<T>) -> Self {
        Self(ptr)
    }
    #[inline]
    pub fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }
    #[inline]
    pub fn as_non_null(self) -> NonNull<T> {
        self.0
    }
    /// # Safety
    /// No other live reference aliases the pointee for `'b`.
    #[inline]
    #[allow(clippy::mut_from_ref)] // the `&Ticket` is a liveness witness, not the pointee
    pub unsafe fn under_ticket<'b>(self, _: &'b Ticket) -> &'b mut T {
        // SAFETY: ticket held ⇒ VM alive ⇒ pointee alive (type contract); aliasing per fn contract.
        unsafe { &mut *self.0.as_ptr() }
    }
}

// ── Job ───────────────────────────────────────────────────────────────────

/// What a particular kind of job does.
pub trait JobContext: Sized + 'static {
    type OffThread: Send;
    type Js: JsAffine;

    /// Whether the job is queued under `ContextId::NONE`: [`then`](Self::then) also runs after the scheduling context stops or `bun test --isolate` moves on.
    const OUTLIVES_SCRIPT: bool = false;

    /// Pool thread, VM not yet in its final wait when the pool reached the job
    /// (a job reached later is handed back unrun, as Node's environment
    /// cleanup `uv_cancel`s queued work). Return `done` to complete now; keep
    /// it (e.g. across async I/O that finishes on another thread) and call
    /// [`Completion::finish`] later to complete then. `done.ticket()` is the
    /// job's ticket: proof the VM is alive (for [`JsPtr::under_ticket`]), and
    /// `script_allowed()` on it says whether the result still has a consumer.
    /// `off` borrows the job, which the JS thread may free the moment
    /// [`Completion::finish`] queues it: do not touch it after finishing.
    fn run(off: &mut Self::OffThread, done: Completion<Self>) -> Option<Completion<Self>>;

    /// JS thread, VM still running script: the completion. Both halves are
    /// handed over to use and drop normally.
    fn then(off: Self::OffThread, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;
}

/// What a [`Job`] runs. Implement it for a job that moves between threads and can wait on
/// something external; [`JobContext`] is the short form for the others.
pub trait OwnedJob: Sized + 'static {
    type OffThread: Send;
    type Js: JsAffine;
    type Shared: Shared;
    /// What a job keeps while it is [`Suspended`].
    type Resume: Send;

    /// As [`JobContext::OUTLIVES_SCRIPT`].
    const OUTLIVES_SCRIPT: bool;
    /// Whether [`run`](Self::run) is also called during the VM's final wait.
    const SHOULD_RUN_DURING_TEARDOWN: bool = false;
    /// Whether the job runs on the `FilePool` on Windows.
    const IS_FILE_IO: bool = false;

    /// Pool thread, or the caller of `UnscheduledJob::run_inline`. See `SHOULD_RUN_DURING_TEARDOWN`.
    fn run(job: Running<Self>);
    /// Pool thread.
    fn resume(job: Running<Self>, with: Self::Resume);
    /// As [`JobContext::then`].
    fn then(off: Self::OffThread, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;
}

mod sealed {
    use crate::StopReason;

    /// What both sides of a job can see. Sealed: `cancel` must not complete a job, because the
    /// [`JobList`](super::JobList) is being walked.
    pub trait Shared: Send + Sync + Default {
        /// Whether `cancel` does anything. Only such jobs are tracked by the VM, so the answer must not change.
        fn is_cancellable(&self) -> bool;
        /// JS thread, when the job's VM or context stops (possibly more than once), wherever the
        /// job is: make it finish soon.
        fn cancel(&self, reason: StopReason);
    }

    impl Shared for () {
        fn is_cancellable(&self) -> bool {
            false
        }
        fn cancel(&self, _: StopReason) {}
    }

    #[cfg(not(windows))]
    impl<J: bun_io::fd_wait::Waiter> Shared for bun_io::fd_wait::Parking<J> {
        fn is_cancellable(&self) -> bool {
            true
        }
        fn cancel(&self, _: StopReason) {
            self.cancel();
        }
    }
}
use sealed::Shared;

/// Interrupts the blocking I/O of a job.
#[cfg(windows)]
#[derive(Default)]
pub struct CancelTokens {
    /// Cancelled when the job's context or VM stops.
    pub on_stop: Option<CancelToken>,
    /// Cancelled when the VM is torn down, after `VirtualMachine::on_exit` has waited for pending writes.
    pub on_teardown: Option<CancelToken>,
}

#[cfg(windows)]
impl Shared for CancelTokens {
    fn is_cancellable(&self) -> bool {
        self.on_stop.is_some() || self.on_teardown.is_some()
    }
    fn cancel(&self, reason: StopReason) {
        if let Some(token) = &self.on_stop {
            token.cancel();
        }
        if let Some(token) = &self.on_teardown
            && reason == StopReason::VmTeardown
        {
            token.cancel();
        }
    }
}

/// Filled by an inline `run` that leaves an uninterruptible call to another thread. `cancel` posts the job without the result.
#[cfg(windows)]
impl<C: OwnedJob> Shared for Arc<Guarded<Option<Running<C>>>> {
    fn is_cancellable(&self) -> bool {
        true
    }
    fn cancel(&self, _: StopReason) {
        let job = self.lock().take();
        if let Some(job) = job {
            job.finish();
        }
    }
}

impl<C: JobContext> OwnedJob for C {
    type OffThread = C::OffThread;
    type Js = C::Js;
    type Shared = ();
    type Resume = Infallible;
    const OUTLIVES_SCRIPT: bool = <C as JobContext>::OUTLIVES_SCRIPT;

    fn run(job: Running<Self>) {
        // SAFETY: live job, whose `off` is the pool's for this callback. A `Completion` does not reach it.
        let off = unsafe { &mut (*job.job.0).off };
        if let Some(done) = <C as JobContext>::run(off, Completion(job)) {
            done.finish();
        }
    }
    fn resume(_: Running<Self>, with: Infallible) {
        match with {}
    }
    fn then(off: C::OffThread, js: C::Js, cx: &JsThread<'_>) -> JsResult<()> {
        <C as JobContext>::then(off, js, cx)
    }
}

/// The type-erased head of every [`Job<C>`] (one task tag serves every `C`),
/// linked into its VM's [`JobList`] while the job is live.
#[repr(C)]
pub struct JobHeader {
    complete: unsafe fn(*mut JobHeader, &JsThread<'_>) -> JsResult<()>,
    release_unrun: unsafe fn(*mut JobHeader),
    cancel: unsafe fn(*mut JobHeader, StopReason),
    prev: *mut JobHeader,
    next: *mut JobHeader,
    /// The context whose script scheduled the job: once it stops, the
    /// completion is released without running. `NONE` with `OUTLIVES_SCRIPT`.
    context: crate::ContextId,
    /// `VirtualMachine::test_isolation_generation` when scheduled.
    generation: u32,
}

/// A VM's live [cancellable](Shared::is_cancellable) jobs (JS thread only;
/// empty by default), so its stop phase can [`cancel`](Shared::cancel) them.
#[derive(Default)]
pub struct JobList {
    head: *mut JobHeader,
}

impl JobList {
    fn push(&mut self, job: *mut JobHeader) {
        // SAFETY: `job` is a live, unlinked header; JS thread.
        unsafe {
            (*job).prev = core::ptr::null_mut();
            (*job).next = self.head;
            if !self.head.is_null() {
                (*self.head).prev = job;
            }
        }
        self.head = job;
    }
    fn unlink(&mut self, job: *mut JobHeader) {
        // SAFETY: `job` is linked in this list; JS thread.
        unsafe {
            let (prev, next) = ((*job).prev, (*job).next);
            if prev.is_null() {
                debug_assert!(core::ptr::eq(self.head, job));
                self.head = next;
            } else {
                (*prev).next = next;
            }
            if !next.is_null() {
                (*next).prev = prev;
            }
        }
    }
    /// A `Bun.ModuleGraph`'s context stopped (JS thread): ask its live jobs to finish soon.
    pub fn cancel_of_context(&self, context: crate::ContextId) {
        let mut job = self.head;
        while !job.is_null() {
            // SAFETY: as `cancel_all`.
            unsafe {
                if (*job).context == context {
                    ((*job).cancel)(job, StopReason::Disposed);
                }
                job = (*job).next;
            }
        }
    }

    /// The VM's stop phase (JS thread): ask every live job to finish soon.
    pub fn cancel_all(&self) {
        let mut job = self.head;
        while !job.is_null() {
            // SAFETY: linked ⇒ live (jobs unlink, on this thread, before they
            // are freed); `cancel` neither frees nor unlinks.
            unsafe {
                ((*job).cancel)(job, StopReason::VmTeardown);
                job = (*job).next;
            }
        }
    }
}

/// One pool-then-complete job. Heap-allocated by [`Job::create`]; freed on
/// the JS thread by its completion or by the teardown's release.
#[repr(C)]
pub struct Job<C: OwnedJob> {
    /// First (asserted at the bottom of the file): erased dispatch casts
    /// `*mut Job<C>` to `*mut JobHeader`.
    header: JobHeader,
    pooled: Pooled<C::Shared, C::Resume>,
    /// What [`Running::finish`] queues on the JS thread.
    concurrent_task: ConcurrentTask,
    _keep_alive: JsKeepAlive,
    off: C::OffThread,
    js: C::Js,
}

/// The part of a job that a [`Suspended`] reaches. `shared` follows the header.
#[repr(C)]
struct Pooled<S, R> {
    shared: S,
    /// Moved out when the pool picks the job up, and back in by
    /// [`Running::suspend`]. `None` when the job returns to the JS thread.
    next_turn: Option<(Ticket, Option<R>)>,
    task: WorkPoolTask,
}

impl<C: OwnedJob> Job<C> {
    /// JS thread: build the job, keep the loop alive for it, hand it to the pool.
    #[track_caller]
    pub fn schedule(cx: &JsThread<'_>, off: C::OffThread, js: C::Js) {
        Self::create(cx, off, js, Default::default()).schedule();
    }

    /// Like [`schedule`](Self::schedule), but the caller hands the job to the pool.
    #[track_caller]
    pub fn create(
        cx: &JsThread<'_>,
        off: C::OffThread,
        js: C::Js,
        shared: C::Shared,
    ) -> UnscheduledJob {
        let job = heap::into_raw(Box::new(Self {
            header: JobHeader {
                // SAFETY: (this and the entry below) the erased dispatchers are
                // only reached through this header, so `p` is this `Job<C>`.
                complete: |p, cx| unsafe { Self::complete(p.cast::<Self>(), cx) },
                // SAFETY: as above.
                release_unrun: |p| unsafe {
                    drop(Self::take(p.cast::<Self>(), VirtualMachine::get()))
                },
                // SAFETY: linked ⇒ live, and no thread borrows `shared` mutably.
                cancel: |p, reason| unsafe {
                    Shared::cancel(&(*p.cast::<Self>()).pooled.shared, reason)
                },
                prev: core::ptr::null_mut(),
                next: core::ptr::null_mut(),
                context: if C::OUTLIVES_SCRIPT {
                    crate::ContextId::NONE
                } else {
                    cx.context().id()
                },
                generation: cx.vm().test_isolation_generation.get(),
            },
            pooled: Pooled {
                shared,
                next_turn: Some((cx.vm().ticket(), None)),
                task: WorkPoolTask {
                    node: Default::default(),
                    callback: Self::run_on_pool,
                },
            },
            concurrent_task: ConcurrentTask::default(),
            _keep_alive: JsKeepAlive::active(),
            off,
            js,
        }));
        // SAFETY: live until completed/released on this thread, which requires scheduling or running it first.
        unsafe {
            if (*job).pooled.shared.is_cancellable() {
                cx.vm().jobs.with_mut(|j| j.push(&raw mut (*job).header));
            }
            UnscheduledJob {
                task: &raw mut (*job).pooled.task,
                #[cfg(windows)]
                pool: C::IS_FILE_IO.then(FilePool::get),
            }
        }
    }

    fn run_on_pool(task: *mut WorkPoolTask) {
        // SAFETY: only reachable through the `task.callback` slot wired in
        // `create`; the pool or `run_inline` passes exactly that field of a live job.
        let this: *mut Self = unsafe {
            let pooled = from_field_ptr!(Pooled<C::Shared, C::Resume>, task, task);
            from_field_ptr!(Self, pooled, pooled)
        };
        // SAFETY: live job, whose `next_turn` is the pool's for this callback.
        let (ticket, resume) = unsafe { (*this).pooled.next_turn.take().expect("job") };
        let job = Running {
            job: Unfinished(this),
            ticket,
        };
        match resume {
            None if !C::SHOULD_RUN_DURING_TEARDOWN && job.ticket.cancelled() => job.finish(),
            None => C::run(job),
            Some(with) => C::resume(job, with),
        }
    }

    /// JS thread: reclaim a posted job and drop its keep-alive; the two halves
    /// are the caller's to complete or drop.
    ///
    /// # Safety
    /// `this` is the job its `Running` posted; called once, on `vm`'s thread.
    unsafe fn take(this: *mut Self, vm: &VirtualMachine) -> (C::OffThread, C::Js) {
        // SAFETY: fn contract.
        let mut job = unsafe { heap::take(this) };
        if job.pooled.shared.is_cancellable() {
            vm.jobs.with_mut(|j| j.unlink(&raw mut job.header));
        }
        (job.off, job.js)
    }

    /// JS thread dispatch: run the completion and free the job.
    ///
    /// # Safety
    /// As [`take`](Self::take).
    unsafe fn complete(this: *mut Self, cx: &JsThread<'_>) -> JsResult<()> {
        // SAFETY: fn contract.
        let (off, js) = unsafe { Self::take(this, cx.vm()) };
        C::then(off, js, cx)
    }
}

/// A job that has not been handed to a pool. It already holds its [`Ticket`], so teardown waits for it.
#[must_use = "a job must be scheduled"]
pub struct UnscheduledJob {
    task: *mut WorkPoolTask,
    /// `None` selects the [`WorkPool`].
    #[cfg(windows)]
    pool: Option<&'static FifoPool>,
}
// SAFETY: a pool task can be scheduled from, and run on, any thread.
unsafe impl Send for UnscheduledJob {}
impl UnscheduledJob {
    #[inline]
    pub fn schedule(self) {
        #[cfg(windows)]
        if let Some(pool) = self.pool {
            return pool.schedule(self.task);
        }
        WorkPool::schedule(self.task);
    }

    /// See [`FifoPool::schedule_continuation`].
    #[cfg(windows)]
    pub fn schedule_as_continuation(self) {
        match self.pool {
            Some(pool) => pool.schedule_continuation(self.task),
            None => self.schedule(),
        }
    }

    #[cfg(windows)]
    pub fn run_inline(self) {
        // SAFETY: `task` belongs to a live job, and consuming `self` makes this its only run.
        unsafe { ((*self.task).callback)(self.task) };
    }

    #[cfg(windows)]
    pub fn use_device_pool(mut self, can_block: bool) -> Self {
        if can_block {
            self.pool = Some(&DEVICE_POOL);
        }
        self
    }
}

/// The obligation to complete a running job exactly once — and, being what
/// the other thread holds, the holder of the job's [`Ticket`]. Returned from
/// [`JobContext::run`] to complete immediately, or kept and
/// [`finish`](Self::finish)ed later from any thread.
#[must_use = "a job must be finished exactly once"]
pub struct Completion<C: JobContext>(Running<C>);
impl<C: JobContext> Completion<C> {
    pub fn finish(self) {
        self.0.finish();
    }
    /// The job's ticket: its VM is alive while this is held.
    #[inline]
    pub fn ticket(&self) -> &Ticket {
        &self.0.ticket
    }
}

/// A [`Completion`] that owns the off-thread half.
#[must_use = "a job must be finished exactly once"]
pub struct Running<C: OwnedJob> {
    job: Unfinished<Job<C>>,
    ticket: Ticket,
}
impl<C: OwnedJob> Running<C> {
    #[inline]
    pub fn off(&mut self) -> &mut C::OffThread {
        // SAFETY: see `Unfinished`.
        unsafe { &mut (*self.job.0).off }
    }
    #[inline]
    pub fn shared(&self) -> &C::Shared {
        // SAFETY: see `Unfinished`. No thread borrows `shared` mutably.
        unsafe { &(*self.job.0).pooled.shared }
    }
    /// The ticket stays in the job, so the VM waits for it.
    #[inline]
    pub fn suspend(self, with: C::Resume) -> Suspended<C::Shared, C::Resume> {
        let job = self.job.hand_on();
        // SAFETY: see `Unfinished`.
        let (job, next_turn) = unsafe { (&raw mut (*job).pooled, &mut (*job).pooled.next_turn) };
        let (_, resume) = next_turn.insert((self.ticket, None));
        let with = NonNull::from(resume.insert(with));
        Suspended {
            job: Unfinished(job),
            with,
        }
    }
    /// Post the job back to its VM. The ticket outlives the post (the JS
    /// thread may free the job the moment it is queued) and is dropped here.
    pub fn finish(self) {
        let job = self.job.hand_on();
        let task = Task::new::<FinishedJob>(FinishedJob(job.cast()));
        // SAFETY: nothing else touches the node of a job that is not finished, and `task` owns the job.
        let node = unsafe { ConcurrentTask::in_place(&raw mut (*job).concurrent_task, task) };
        self.ticket.post(node);
    }
}

/// A job that has left the pool and has to go back.
#[must_use = "a suspended job must be resumed exactly once"]
pub struct Suspended<S, R> {
    job: Unfinished<Pooled<S, R>>,
    /// In `next_turn`, which nothing else may read until `resume`.
    with: NonNull<R>,
}
// SAFETY: made of a `Running`, which is `Send`.
unsafe impl<S: Sync, R: Send> Send for Suspended<S, R> {}
impl<S, R> Suspended<S, R> {
    #[inline]
    pub fn shared(&self) -> &S {
        // SAFETY: as `Running::shared`.
        unsafe { &(*self.job.0).shared }
    }
    #[inline]
    pub fn with(&mut self) -> &mut R {
        // SAFETY: see `Unfinished`. The pool moves it out after `resume`.
        unsafe { self.with.as_mut() }
    }
    /// Any thread: the pool calls [`OwnedJob::resume`].
    #[inline]
    pub fn resume(self) {
        // SAFETY: the pool is done with the task of a job that it has called, and owns the job now.
        WorkPool::schedule(unsafe { &raw mut (*self.job.hand_on()).task });
    }
}

/// The one handle to a job, from the pool's call until the job is queued for the pool or the JS
/// thread again. The job is live, and the JS thread touches only `header` and `shared`.
struct Unfinished<T>(*mut T);
// SAFETY: `off` and `next_turn` are `Send`, `shared` is `Sync`, and the tasks go to thread-safe queues.
unsafe impl<C: OwnedJob> Send for Unfinished<Job<C>> {}
impl<T> Unfinished<T> {
    /// The caller passes the job on, so the Drop check must not run.
    #[inline]
    fn hand_on(self) -> *mut T {
        ManuallyDrop::new(self).0
    }
}
impl<T> Drop for Unfinished<T> {
    fn drop(&mut self) {
        debug_assert!(false, "job dropped without being finished");
    }
}

/// Owns a `Job<C>` of any `C` (one tag) that its [`Running`] has posted.
pub struct FinishedJob(*mut JobHeader);

impl Taskable for FinishedJob {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AnyTaskJob;
    type Payload = Self;
    fn release_unrun(job: Self) {
        // SAFETY: `job` owns it; JS thread with the heap alive.
        unsafe { ((*job.0).release_unrun)(job.0) }
    }
    fn context(job: &Self) -> crate::ContextId {
        // SAFETY: `job` owns it, and the field is not written after `create`.
        unsafe { (*job.0).context }
    }
}

impl FinishedJob {
    pub fn complete(self, global: &JSGlobalObject) -> JsResult<()> {
        let vm = global.bun_vm();
        // One scheduled by a file `bun test --isolate` has since retired: the swap was that file's
        // exit, and a `then` that calls back directly (node:crypto's callback forms) would run its
        // script under the next file.
        // SAFETY: `self` owns the job.
        let (generation, context) = unsafe { ((*self.0).generation, (*self.0).context) };
        if generation != vm.test_isolation_generation.get() && context != crate::ContextId::NONE {
            Self::release_unrun(self);
            return Ok(());
        }
        // The completion continues the script that scheduled the job, except with `OUTLIVES_SCRIPT`.
        let context = match context {
            crate::ContextId::NONE => vm.root_context(),
            context => vm.context_of(context),
        };
        // SAFETY: as above.
        unsafe { ((*self.0).complete)(self.0, &global.js_thread(context)) }
    }
}

// `Running::finish` casts `*mut Job<C>` to `*mut JobHeader`.
const _: () = assert!(core::mem::offset_of!(Job<Never>, header) == 0);

#[doc(hidden)]
pub enum Never {}
impl JobContext for Never {
    type OffThread = ();
    type Js = ();
    fn run(_: &mut (), done: Completion<Self>) -> Option<Completion<Self>> {
        Some(done)
    }
    fn then(_: (), _: (), _: &JsThread<'_>) -> JsResult<()> {
        Ok(())
    }
}
