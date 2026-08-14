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
//! [`JsPtr`], dereferenceable only with the job's ticket or a [`JsThread`].
//!
//! Node's equivalent is `ThreadPoolWork` + `req_wrap`; WebCore's is
//! `WorkerRunLoop::postTask` with `ActiveDOMObject`-owned completions.

use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use bun_io::KeepAlive;
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

use crate::debugger::AsyncTaskTracker;
use crate::virtual_machine::VirtualMachine;
use crate::vm_handle::Ticket;
use crate::{JSGlobalObject, JsResult};

// ── tokens ────────────────────────────────────────────────────────────────

/// Proof that the holder is on `global`'s JS thread with its heap alive: what
/// it takes to dereference a [`JsPtr`] outside a pool body. Host functions and
/// event-loop dispatch have one by construction ([`JSGlobalObject::js_thread`]).
/// Not `Send`.
pub struct JsThread<'a> {
    global: &'a JSGlobalObject,
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
}

impl JSGlobalObject {
    /// A live `&JSGlobalObject` is only ever formed on its own thread (it is an
    /// opaque engine handle); debug builds check.
    #[inline]
    pub fn js_thread(&self) -> JsThread<'_> {
        #[cfg(debug_assertions)]
        self.bun_vm().handle_ref().assert_js_thread();
        JsThread {
            global: self,
            _not_send: PhantomData,
        }
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
unsafe impl JsAffine for Protected {}

/// A GC-protected value a job's completion needs (Node: a `Global<Value>` on
/// the req_wrap). Unprotected on drop.
pub struct Protected(crate::JSValue);
impl Protected {
    pub fn new(value: crate::JSValue) -> Self {
        value.protect();
        Self(value)
    }
    #[inline]
    pub fn value(&self) -> crate::JSValue {
        self.0
    }
}
impl Drop for Protected {
    fn drop(&mut self) {
        self.0.unprotect();
    }
}

/// A pointer into JS-owned memory (an ArrayBuffer's bytes, a pinned cell, the
/// creating global) that a job carries off-thread. It can be *passed around*
/// anywhere but dereferenced only with proof the VM is alive: the job's
/// [`Ticket`] or a [`JsThread`].
#[repr(transparent)]
pub struct JsPtr<T: ?Sized>(NonNull<T>);
// SAFETY: dereferenceable only under a Ticket/JsThread (see type doc).
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
    /// # Safety
    /// No other live reference aliases the pointee for `'b`.
    #[inline]
    #[allow(clippy::mut_from_ref)] // the `&Ticket` is a liveness witness, not the pointee
    pub unsafe fn under_ticket<'b>(self, _: &'b Ticket) -> &'b mut T {
        // SAFETY: ticket held ⇒ VM alive ⇒ pointee alive (type contract); aliasing per fn contract.
        unsafe { &mut *self.0.as_ptr() }
    }
    /// # Safety
    /// No other live reference aliases the pointee for `'b`.
    #[inline]
    #[allow(clippy::mut_from_ref)] // the `&JsThread` is a thread witness, not the pointee
    pub unsafe fn on_js_thread<'b>(self, _: &'b JsThread<'_>) -> &'b mut T {
        // SAFETY: JS thread with heap alive; aliasing per fn contract.
        unsafe { &mut *self.0.as_ptr() }
    }
}

// ── Job ───────────────────────────────────────────────────────────────────

/// What a particular kind of job does.
pub trait JobContext: Sized + 'static {
    type OffThread: Send;
    type Js: JsAffine;

    /// Pool thread, VM still running script when the pool reached the job (a
    /// job reached later is handed back unrun, as Node's environment cleanup
    /// `uv_cancel`s queued work). Return `done` to complete now; keep it (e.g.
    /// across async I/O that finishes on another thread) and call
    /// [`Completion::finish`] later to complete then. `vm` is the job's ticket:
    /// proof the VM is alive (for [`JsPtr::under_ticket`]) and
    /// `vm.script_allowed()` says whether the result still has a consumer.
    /// `off` and `vm` borrow the job, which the JS thread may free the moment
    /// [`Completion::finish`] queues it: touch neither after finishing (work
    /// that continues past `run` reaches its state through
    /// [`Completion::off_thread`]).
    fn run(
        off: &mut Self::OffThread,
        vm: &Ticket,
        done: Completion<Self>,
    ) -> Option<Completion<Self>>;

    /// JS thread, VM still running script: the completion. Both halves are
    /// handed over to use and drop normally.
    fn then(off: Self::OffThread, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;

    /// JS thread, the VM's stop phase (possibly more than once): make a job
    /// that is waiting on something *external* — not computing — finish soon,
    /// so the VM's wait for it is short. Runs concurrently with wherever the
    /// job is (queued, in `run`, parked on another thread's loop): touch only
    /// what that tolerates (atomics, thread-safe queues). The default, for
    /// jobs that only compute, does nothing.
    ///
    /// # Safety
    /// `off` points at the live job's off-thread half.
    unsafe fn cancel(off: *mut Self::OffThread) {
        let _ = off;
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
}

/// A VM's live jobs (JS thread only; zero-valid), so its stop phase can
/// [`cancel`](JobContext::cancel) the ones waiting on something external.
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
pub struct Job<C: JobContext> {
    /// Must stay first: erased dispatch casts `*mut Job<C>` to `*mut JobHeader`.
    header: JobHeader,
    /// Moved out by [`Completion::finish`] to post through (the JS thread may
    /// free the job the moment it is queued); never touched on the JS side.
    ticket: ManuallyDrop<Ticket>,
    task: WorkPoolTask,
    keep_alive: KeepAlive,
    off: C::OffThread,
    js: C::Js,
}

impl<C: JobContext> bun_event_loop::Taskable for Job<C> {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AnyTaskJob;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; JS thread with the heap alive.
        drop(unsafe { Self::take(this) })
    }
}

impl<C: JobContext> Job<C> {
    /// JS thread: build the job, keep the loop alive for it, hand it to the pool.
    #[track_caller]
    pub fn schedule(cx: &JsThread<'_>, off: C::OffThread, js: C::Js) {
        let mut keep_alive = KeepAlive::default();
        keep_alive.ref_(bun_io::js_vm_ctx());
        let job = bun_core::heap::into_raw(Box::new(Self {
            header: JobHeader {
                // SAFETY: (this and the entry below) the erased dispatchers are
                // only reached through this header, so `p` is this `Job<C>`.
                complete: |p, cx| unsafe { Self::complete(p.cast::<Self>(), cx) },
                // SAFETY: as above.
                release_unrun: |p| drop(unsafe { Self::take(p.cast::<Self>()) }),
                // SAFETY: linked ⇒ live; see `JobContext::cancel`.
                cancel: |p| unsafe { C::cancel(core::ptr::addr_of_mut!((*p.cast::<Self>()).off)) },
                prev: core::ptr::null_mut(),
                next: core::ptr::null_mut(),
            },
            ticket: ManuallyDrop::new(cx.vm().ticket()),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_on_pool,
            },
            keep_alive,
            off,
            js,
        }));
        // SAFETY: live until completed/released on this thread; the pool owns it now.
        unsafe {
            cx.vm().jobs().push(&raw mut (*job).header);
            WorkPool::schedule(&raw mut (*job).task);
        }
    }

    fn run_on_pool(task: *mut WorkPoolTask) {
        // SAFETY: only reachable through the `task.callback` slot wired in
        // `schedule`; the pool calls back with exactly that field of a live job.
        let this: *mut Self = unsafe { bun_core::from_field_ptr!(Self, task, task) };
        let done = Completion(NonNull::new(this).expect("job"));
        // SAFETY: live job, exclusively the pool's for this callback; `ticket`
        // and `off` are disjoint fields.
        let (off, ticket) = unsafe { (&mut (*this).off, &*(*this).ticket) };
        if !ticket.script_allowed() {
            return done.finish();
        }
        if let Some(done) = C::run(off, ticket, done) {
            done.finish();
        }
    }

    /// JS thread: reclaim a posted job and drop its keep-alive; the two halves
    /// are the caller's to complete or drop.
    ///
    /// # Safety
    /// `this` is the job its `Completion` posted; called once.
    unsafe fn take(this: *mut Self) -> (C::OffThread, C::Js) {
        // SAFETY: fn contract; JS thread.
        unsafe { VirtualMachine::get().jobs().unlink(&raw mut (*this).header) };
        // SAFETY: fn contract.
        let Job {
            mut keep_alive,
            off,
            js,
            ..
        } = unsafe { *Box::from_raw(this) };
        keep_alive.unref(bun_io::js_vm_ctx());
        (off, js)
    }

    /// JS thread dispatch: run the completion and free the job.
    ///
    /// # Safety
    /// As [`take`](Self::take).
    unsafe fn complete(this: *mut Self, cx: &JsThread<'_>) -> JsResult<()> {
        // SAFETY: fn contract.
        let (off, js) = unsafe { Self::take(this) };
        C::then(off, js, cx)
    }
}

/// The obligation to complete a running job exactly once: returned from
/// [`JobContext::run`] to complete immediately, or kept and
/// [`finish`](Self::finish)ed later from any thread.
#[must_use = "a job must be finished exactly once"]
pub struct Completion<C: JobContext>(NonNull<Job<C>>);
// SAFETY: `finish` only posts the job through its (thread-safe) ticket.
unsafe impl<C: JobContext> Send for Completion<C> {}
impl<C: JobContext> Completion<C> {
    pub fn finish(self) {
        // Consumed: the obligation is met here, so its Drop check must not run.
        let job = ManuallyDrop::new(self).0.as_ptr();
        // SAFETY: the live heap job this token was created for. The ticket is
        // moved out first: once the task is queued the JS thread owns (and may
        // free) the job, and the ticket must outlive the post.
        unsafe {
            let ticket = ManuallyDrop::take(&mut (*job).ticket);
            ticket.post(bun_event_loop::ConcurrentTask::ConcurrentTask::create_from(
                job,
            ));
        }
    }
    /// The job's off-thread part, for work that continues after `run` returned.
    ///
    /// # Safety
    /// No other reference to it is live (the pool callback has returned).
    pub unsafe fn off_thread(&self) -> *mut C::OffThread {
        // SAFETY: live job.
        unsafe { &raw mut (*self.0.as_ptr()).off }
    }
}
impl<C: JobContext> Drop for Completion<C> {
    fn drop(&mut self) {
        debug_assert!(false, "job dropped without being finished");
    }
}

/// Event-loop dispatch for every `Job<C>` (one tag): run its completion.
///
/// # Safety
/// `ptr` is a `Job<C>` posted by its `Completion` (for some `C`).
pub unsafe fn complete_erased(ptr: *mut (), cx: &JsThread<'_>) -> JsResult<()> {
    let header = ptr.cast::<JobHeader>();
    // A completion dispatched after the VM was asked to stop (a parent's
    // terminate() lands while the worker still ticks): its `then` would only
    // build script-facing values under a pending termination. Release it as
    // teardown would — Node's threadpool `after` callbacks bail the same way
    // on `!can_call_into_js()`.
    if !cx.vm().script_allowed() {
        // SAFETY: as below; released exactly once, here.
        unsafe { ((*header).release_unrun)(header) };
        return Ok(());
    }
    // SAFETY: `Job<C>` is `#[repr(C)]` with the header first.
    unsafe { ((*header).complete)(header, cx) }
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
