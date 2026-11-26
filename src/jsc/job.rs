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

use bun_core::{from_field_ptr, heap};
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_io::{JsKeepAlive, KeepAlive};
use bun_threading::ThreadPool;
use bun_threading::work_pool::{Batch, Task as WorkPoolTask, WorkPool};

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

    /// The pool that calls [`run`](Self::run).
    fn pool() -> &'static ThreadPool {
        WorkPool::get()
    }

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

    /// As [`JobContext::pool`].
    fn pool() -> &'static ThreadPool {
        WorkPool::get()
    }

    /// Pool thread. Not called if the VM is in its final wait by then.
    fn run(job: Running<Self>);
    /// Pool thread.
    fn resume(job: Running<Self>, with: Self::Resume);
    /// As [`JobContext::then`].
    fn then(off: Self::OffThread, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;
}

mod sealed {
    /// What both sides of a job can see. Sealed: `cancel` must not complete a job, because the
    /// [`JobList`](super::JobList) is being walked.
    pub trait Shared: Send + Sync + Default {
        /// Whether `cancel` does anything. Only such jobs are tracked by the VM.
        const CANCELLABLE: bool;
        /// JS thread, when the job's VM or context stops (possibly more than once), wherever the
        /// job is: make it finish soon.
        fn cancel(&self);
    }

    impl Shared for () {
        const CANCELLABLE: bool = false;
        fn cancel(&self) {}
    }

    #[cfg(not(windows))]
    impl<J: bun_io::fd_wait::Waiter> Shared for bun_io::fd_wait::Parking<J> {
        const CANCELLABLE: bool = true;
        fn cancel(&self) {
            self.cancel();
        }
    }
}
use sealed::Shared;

impl<C: JobContext> OwnedJob for C {
    type OffThread = C::OffThread;
    type Js = C::Js;
    type Shared = ();
    type Resume = Infallible;
    const OUTLIVES_SCRIPT: bool = <C as JobContext>::OUTLIVES_SCRIPT;

    fn pool() -> &'static ThreadPool {
        <C as JobContext>::pool()
    }

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
    cancel: unsafe fn(*mut JobHeader),
    prev: *mut JobHeader,
    next: *mut JobHeader,
    /// The context whose script scheduled the job: once it stops, the
    /// completion is released without running. `NONE` with `OUTLIVES_SCRIPT`.
    context: crate::ContextId,
    /// `VirtualMachine::test_isolation_generation` when scheduled.
    generation: u32,
}

/// A VM's live [cancellable](Shared::CANCELLABLE) jobs (JS thread only;
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
                    ((*job).cancel)(job);
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
                ((*job).cancel)(job);
                job = (*job).next;
            }
        }
    }
}

/// One pool-then-complete job. Heap-allocated by [`Job::schedule`]; freed on
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

impl<C: OwnedJob> bun_event_loop::Taskable for Job<C> {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AnyTaskJob;
    /// Reached through the header (`release_unrun_erased`): the tag is shared.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; JS thread with the heap alive.
        drop(unsafe { Self::take(this, VirtualMachine::get()) })
    }
    /// `JobHeader::context`.
    unsafe fn context(this: *const Self) -> bun_event_loop::ContextId {
        // SAFETY: fn contract.
        unsafe { (*this).header.context }
    }
}

impl<C: OwnedJob> Job<C> {
    /// JS thread: build the job, keep the loop alive for it, hand it to the pool.
    #[track_caller]
    pub fn schedule(cx: &JsThread<'_>, off: C::OffThread, js: C::Js) {
        let job = heap::into_raw(Box::new(Self {
            header: JobHeader {
                // SAFETY: (this and the entry below) the erased dispatchers are
                // only reached through this header, so `p` is this `Job<C>`.
                complete: |p, cx| unsafe { Self::complete(p.cast::<Self>(), cx) },
                // SAFETY: as above.
                release_unrun: |p| unsafe {
                    <Self as bun_event_loop::Taskable>::release_unrun(p.cast::<Self>())
                },
                // SAFETY: linked ⇒ live, and no thread borrows `shared` mutably.
                cancel: |p| unsafe { Shared::cancel(&(*p.cast::<Self>()).pooled.shared) },
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
                shared: Default::default(),
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
        // SAFETY: live until completed/released on this thread; the pool owns it now.
        unsafe {
            if C::Shared::CANCELLABLE {
                cx.vm().jobs.with_mut(|j| j.push(&raw mut (*job).header));
            }
            C::pool().schedule(Batch::from(&raw mut (*job).pooled.task));
        }
    }

    fn run_on_pool(task: *mut WorkPoolTask) {
        // SAFETY: only reachable through the `task.callback` slot wired in
        // `schedule`; the pool calls back with exactly that field of a live job.
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
            None if job.ticket.cancelled() => job.finish(),
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
        if C::Shared::CANCELLABLE {
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
        // SAFETY: nothing else touches the node of a job that is not finished, and the job is
        // freed after its task left the queue.
        let node = unsafe { (*job).concurrent_task.from(job) };
        self.ticket.post_intrusive(NonNull::from(node));
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

/// Event-loop dispatch for every `Job<C>` (one tag): run its completion.
///
/// # Safety
/// `ptr` is a `Job<C>` posted by its `Running` (for some `C`).
pub unsafe fn complete_erased(ptr: *mut (), global: &JSGlobalObject) -> JsResult<()> {
    let header = ptr.cast::<JobHeader>();
    let vm = global.bun_vm();
    // One scheduled by a file `bun test --isolate` has since retired: the swap was that file's
    // exit, and a `then` that calls back directly (node:crypto's callback forms) would run its
    // script under the next file.
    // SAFETY: `Job<C>` is `#[repr(C)]` with the header first.
    let (generation, context) = unsafe { ((*header).generation, (*header).context) };
    if generation != vm.test_isolation_generation.get() && context != crate::ContextId::NONE {
        // SAFETY: as below; released exactly once, here.
        unsafe { ((*header).release_unrun)(header) };
        return Ok(());
    }
    // The completion continues the script that scheduled the job, except with `OUTLIVES_SCRIPT`.
    let context = match context {
        crate::ContextId::NONE => vm.root_context(),
        context => vm.context_of(context),
    };
    // SAFETY: as above.
    unsafe { ((*header).complete)(header, &global.js_thread(context)) }
}

/// Teardown's release for a queued, never-dispatched `Job<C>` completion
/// (JS thread, heap alive).
///
/// # Safety
/// As [`complete_erased`].
pub unsafe fn release_unrun_erased(ptr: *mut ()) {
    let header = ptr.cast::<JobHeader>();
    // SAFETY: as above.
    unsafe { ((*header).release_unrun)(header) }
}

// The erased dispatchers above cast `*mut Job<C>` to `*mut JobHeader`.
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
