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
//! [`JobContext::OffThread`] is what the pool body gets (`Send`);
//! [`JobContext::Js`] is the completion's JS-thread state (promise, callback,
//! wrapper refs, pins, protected buffers) and is only ever touched on the JS
//! thread. JS-backed memory the body reads in place is reachable through
//! [`JsPtr`], dereferenceable only with the job's ticket.
//!
//! Node's equivalent is `ThreadPoolWork` + `req_wrap`; WebCore's is
//! `WorkerRunLoop::postTask` with `ActiveDOMObject`-owned completions.

use core::cell::Cell;
use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_io::{JsKeepAlive, KeepAlive};
use bun_ptr::OwnedPtr;
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

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

/// A job that is complete when `run` returns.
pub trait JobContext: Sized + 'static {
    type OffThread: Send;
    type Js: JsAffine;

    /// Whether the job is queued under `ContextId::NONE`: [`then`](Self::then) also runs after the scheduling context stops or `bun test --isolate` moves on.
    const OUTLIVES_SCRIPT: bool = false;

    /// Pool thread, VM not yet in its final wait when the pool reached the job
    /// (a job reached later is handed back unrun, as Node's environment
    /// cleanup `uv_cancel`s queued work). `ticket` proves that the VM is alive (for [`JsPtr::under_ticket`]), and
    /// `script_allowed()` on it says whether the result still has a consumer.
    fn run(off: &mut Self::OffThread, ticket: &Ticket);

    /// JS thread, VM still running script: the completion. Both halves are
    /// handed over to use and drop normally.
    fn then(off: Self::OffThread, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;
}

/// As [`JobContext`], for a job that continues after `run` returns. `run` owns it.
pub trait OwnedJobContext: Sized + 'static {
    type OffThread: Send;
    type Js: JsAffine;
    /// What threads other than the owner of the [`Completion`] use.
    type Shared: Default + Send + Sync;

    /// Whether the job can wait on something external. The VM tracks only such jobs, to [`cancel`](Self::cancel) them.
    const CANCELLABLE: bool = false;

    const OUTLIVES_SCRIPT: bool = false;

    /// Whichever thread has `job` last calls [`Completion::finish`].
    fn run(job: Completion<Self>);

    fn then(off: Self::OffThread, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;

    /// JS thread, the VM's stop phase (possibly more than once): make a job
    /// that is waiting on something *external* — not computing — finish soon,
    /// so the VM's wait for it is short. Runs concurrently with wherever the
    /// job is (queued, in `run`, parked on another thread's loop).
    fn cancel(shared: &Self::Shared) {
        let _ = shared;
    }
}

impl<C: JobContext> OwnedJobContext for C {
    type OffThread = C::OffThread;
    type Js = C::Js;
    type Shared = ();

    const OUTLIVES_SCRIPT: bool = <C as JobContext>::OUTLIVES_SCRIPT;

    fn run(mut job: Completion<Self>) {
        let (off, ticket) = job.off_and_ticket();
        <C as JobContext>::run(off, ticket);
        job.finish();
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

/// A VM's live [cancellable](OwnedJobContext::CANCELLABLE) jobs (JS thread only), for its stop phase.
#[derive(Default)]
pub struct JobList {
    head: Cell<*mut JobHeader>,
}

impl JobList {
    fn push(&self, job: *mut JobHeader) {
        let head = self.head.replace(job);
        // SAFETY: `job` is a live, unlinked header; JS thread.
        unsafe {
            (*job).prev = core::ptr::null_mut();
            (*job).next = head;
            if !head.is_null() {
                (*head).prev = job;
            }
        }
    }
    fn unlink(&self, job: *mut JobHeader) {
        // SAFETY: `job` is linked in this list; JS thread.
        unsafe {
            let (prev, next) = ((*job).prev, (*job).next);
            if prev.is_null() {
                debug_assert!(core::ptr::eq(self.head.get(), job));
                self.head.set(next);
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
        let mut job = self.head.get();
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
        let mut job = self.head.get();
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
pub struct Job<C: OwnedJobContext> {
    /// First (asserted at the bottom of the file): erased dispatch casts
    /// `*mut Job<C>` to `*mut JobHeader`.
    header: JobHeader,
    /// Moved out by [`Completion::finish`] (never touched on the JS side).
    ticket: ManuallyDrop<Ticket>,
    task: WorkPoolTask,
    /// What [`Completion::finish`] queues on the JS thread.
    concurrent_task: ConcurrentTask,
    _keep_alive: JsKeepAlive,
    shared: C::Shared,
    off: C::OffThread,
    js: C::Js,
}

impl<C: OwnedJobContext> bun_event_loop::Taskable for Job<C> {
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

impl<C: OwnedJobContext> Job<C> {
    /// JS thread: build the job, keep the loop alive for it, hand it to the pool.
    #[track_caller]
    pub fn schedule(cx: &JsThread<'_>, off: C::OffThread, js: C::Js) {
        let job = bun_core::heap::into_raw(Box::new(Self {
            header: JobHeader {
                // SAFETY: (this and the entry below) the erased dispatchers are
                // only reached through this header, so `p` is this `Job<C>`.
                complete: |p, cx| unsafe { Self::complete(p.cast::<Self>(), cx) },
                // SAFETY: as above.
                release_unrun: |p| unsafe {
                    <Self as bun_event_loop::Taskable>::release_unrun(p.cast::<Self>())
                },
                // SAFETY: linked ⇒ live, and `shared` is never borrowed mutably.
                cancel: |p| C::cancel(unsafe { &(*p.cast::<Self>()).shared }),
                prev: core::ptr::null_mut(),
                next: core::ptr::null_mut(),
                context: if C::OUTLIVES_SCRIPT {
                    crate::ContextId::NONE
                } else {
                    cx.context().id()
                },
                generation: cx.vm().test_isolation_generation.get(),
            },
            ticket: ManuallyDrop::new(cx.vm().ticket()),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_on_pool,
            },
            concurrent_task: ConcurrentTask::default(),
            _keep_alive: JsKeepAlive::active(),
            shared: C::Shared::default(),
            off,
            js,
        }));
        // SAFETY: live until completed/released on this thread; the pool owns it now.
        unsafe {
            if C::CANCELLABLE {
                cx.vm().jobs.push(&raw mut (*job).header);
            }
            WorkPool::schedule(&raw mut (*job).task);
        }
    }

    fn run_on_pool(task: *mut WorkPoolTask) {
        // SAFETY: only reachable through the `task.callback` slot wired in
        // `schedule`; the pool calls back once, with exactly that field of a live job.
        let job = unsafe { bun_core::from_field_ptr!(Self, task, task) };
        let job = Completion(NonNull::new(job).expect("job"));
        if job.ticket().cancelled() {
            return job.finish();
        }
        C::run(job);
    }

    /// JS thread: reclaim a posted job and drop its keep-alive; the two halves
    /// are the caller's to complete or drop.
    ///
    /// # Safety
    /// `this` is the job its `Completion` posted; called once, on `vm`'s thread.
    unsafe fn take(this: *mut Self, vm: &VirtualMachine) -> (C::OffThread, C::Js) {
        // SAFETY: fn contract.
        let mut job = unsafe { Box::from_raw(this) };
        if C::CANCELLABLE {
            vm.jobs.unlink(&raw mut job.header);
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

/// Owns the off-thread half and the [`Ticket`] of a running job, and has to finish it exactly once.
#[must_use = "a job must be finished exactly once"]
pub struct Completion<C: OwnedJobContext>(
    /// Never borrowed as a whole: the JS thread uses the other fields meanwhile.
    NonNull<Job<C>>,
);
// SAFETY: it reaches `off`, which is `Send`, `shared`, which is `Sync`, and the (thread-safe) ticket.
unsafe impl<C: OwnedJobContext> Send for Completion<C> {}
impl<C: OwnedJobContext> Completion<C> {
    /// Post the job back to its VM. The ticket outlives the post (the JS
    /// thread may free the job the moment it is queued) and is dropped here.
    pub fn finish(self) {
        // Consumed: the obligation is met here, so its Drop check must not run.
        let job = ManuallyDrop::new(self).0.as_ptr();
        // SAFETY: the ticket is not used again. Nothing else touches the node of a job that is not
        // finished, and the job is freed after its task left the queue.
        let (ticket, node) = unsafe {
            (
                ManuallyDrop::take(&mut (*job).ticket),
                (*job).concurrent_task.from(job),
            )
        };
        ticket.post_intrusive(NonNull::from(node));
    }

    pub fn shared(&self) -> &C::Shared {
        // SAFETY: the job is freed after `finish`, and `shared` is never borrowed mutably.
        unsafe { &(*self.0.as_ptr()).shared }
    }

    fn ticket(&self) -> &Ticket {
        // SAFETY: the job is freed after `finish`, which alone writes `ticket`.
        unsafe { &(*self.0.as_ptr()).ticket }
    }

    fn off_and_ticket(&mut self) -> (&mut C::OffThread, &Ticket) {
        let job = self.0.as_ptr();
        // SAFETY: as `deref` and `ticket`.
        unsafe { (&mut (*job).off, &(*job).ticket) }
    }
}
impl<C: OwnedJobContext> Deref for Completion<C> {
    type Target = C::OffThread;
    fn deref(&self) -> &C::OffThread {
        // SAFETY: the job is freed after `finish`, and until then only `self` reaches `off`.
        unsafe { &(*self.0.as_ptr()).off }
    }
}
impl<C: OwnedJobContext> DerefMut for Completion<C> {
    fn deref_mut(&mut self) -> &mut C::OffThread {
        self.off_and_ticket().0
    }
}
// SAFETY: a job that is not finished is not freed, and only its `Completion` reaches `off`.
unsafe impl<C: OwnedJobContext> OwnedPtr for Completion<C> {
    fn into_raw(this: Self) -> NonNull<C::OffThread> {
        let job = ManuallyDrop::new(this).0;
        // SAFETY: a field of a live job.
        unsafe { job.byte_add(core::mem::offset_of!(Job<C>, off)).cast() }
    }

    unsafe fn from_raw(ptr: NonNull<C::OffThread>) -> Self {
        // SAFETY: fn contract; `into_raw` keeps the provenance of the whole job.
        Self(unsafe { ptr.byte_sub(core::mem::offset_of!(Job<C>, off)).cast() })
    }
}
impl<C: OwnedJobContext> Drop for Completion<C> {
    fn drop(&mut self) {
        debug_assert!(false, "job dropped without being finished");
    }
}

/// The [`Shared`](OwnedJobContext::Shared) part of a job that fans out: how many [`SharedCompletion`]s it has.
#[derive(Default)]
pub struct SharedCompletionCount(AtomicUsize);

/// As an `Arc<Completion<C>>`, with the count in the job.
#[must_use = "the job is finished by whoever `into_inner` returns it to"]
pub struct SharedCompletion<C: OwnedJobContext<Shared = SharedCompletionCount>> {
    job: Completion<C>,
    /// `Send` only if the off-thread half is `Sync`.
    _off: PhantomData<&'static C::OffThread>,
}

impl<C: OwnedJobContext<Shared = SharedCompletionCount>> SharedCompletion<C> {
    pub fn new(job: Completion<C>) -> Self {
        // Relaxed: no other thread uses the count yet.
        job.shared().0.store(1, Ordering::Relaxed);
        Self {
            job,
            _off: PhantomData,
        }
    }

    /// As `Arc::into_inner`.
    pub fn into_inner(this: Self) -> Option<Completion<C>> {
        let job = ManuallyDrop::new(this.job);
        // AcqRel: the last one sees what the others wrote.
        let is_last = job.shared().0.fetch_sub(1, Ordering::AcqRel) == 1;
        is_last.then(|| ManuallyDrop::into_inner(job))
    }
}
impl<C: OwnedJobContext<Shared = SharedCompletionCount>> Clone for SharedCompletion<C> {
    fn clone(&self) -> Self {
        // Relaxed: `self` keeps the count above zero.
        self.job.shared().0.fetch_add(1, Ordering::Relaxed);
        Self {
            job: Completion(self.job.0),
            _off: PhantomData,
        }
    }
}
impl<C: OwnedJobContext<Shared = SharedCompletionCount>> Deref for SharedCompletion<C> {
    type Target = C::OffThread;
    fn deref(&self) -> &C::OffThread {
        &self.job
    }
}

/// Event-loop dispatch for every `Job<C>` (one tag): run its completion.
///
/// # Safety
/// `ptr` is a `Job<C>` posted by its `Completion` (for some `C`).
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
    fn run(_: &mut (), _: &Ticket) {}
    fn then(_: (), _: (), _: &JsThread<'_>) -> JsResult<()> {
        Ok(())
    }
}
