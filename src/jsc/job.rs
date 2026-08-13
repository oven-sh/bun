//! Work that leaves the JS thread and comes back.
//!
//! A [`Job`] is created on the JS thread, does its heavy part on the
//! [`WorkPool`], and completes on the JS thread again — unless its VM went away
//! meanwhile. Which thread may touch which part of it is in the types:
//!
//! * [`JobContext::OffThread`] is what the pool body sees. It is `Send`, and it
//!   runs under a VM [`Borrow`] the carrier takes for it, so the VM's teardown
//!   waits for a body that is mid-flight and a body never starts against a VM
//!   that is already closed. JS-backed memory it needs is reachable only through
//!   [`JsPtr`], i.e. only while that borrow (or a [`JsThread`]) is in hand.
//! * [`JobContext::Js`] is the completion's JS-thread state (promise, callback,
//!   wrapper refs, pins, protected buffers). It is [`JsAffine`] and lives in a
//!   [`JsSide`], which opens only with a [`JsThread`] token and is never dropped
//!   implicitly. Every VM keeps the list of its live jobs ([`JobList`]) and
//!   releases their JS sides itself at teardown, on its own thread with the
//!   heap alive; a job the pool finishes after that frees only its off-thread
//!   part. So there is no per-job "the VM is gone" code, and a JS side is
//!   never touched off its thread.
//!
//! Node's equivalent is `ThreadPoolWork` + `req_wrap` (with the environment
//! cancelling/settling its reqs at cleanup); WebCore's is
//! `WorkerRunLoop::postTask` with `ActiveDOMObject`-owned completions.

use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use bun_io::KeepAlive;
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

use crate::debugger::AsyncTaskTracker;
use crate::virtual_machine::VirtualMachine;
use crate::vm_handle::{Borrow, LoopHandle};
use crate::{JSGlobalObject, JsResult};

// ── tokens ────────────────────────────────────────────────────────────────

/// Proof that the holder is on `global`'s JS thread with its heap alive: what
/// it takes to open a [`JsSide`] or dereference a [`JsPtr`] outside a pool
/// borrow. Host functions and event-loop dispatch have one by construction
/// ([`JSGlobalObject::js_thread`]). Not `Send`.
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
        self.bun_vm().handle().assert_js_thread();
        JsThread {
            global: self,
            _not_send: PhantomData,
        }
    }
}

// ── JsAffine / JsSide ─────────────────────────────────────────────────────

/// A value that may only be used and dropped on its VM's JS thread: GC
/// handles, keep-alives, wrapper back-pointers, pins, GC protection, and
/// anything built from them. In a job it lives on the [`Js`](JobContext::Js)
/// side, which the carrier guarantees is opened and dropped only there.
/// Derive it (`#[derive(bun_jsc::JsAffine)]`) for aggregates; the derive
/// checks every field.
///
/// # Safety
/// Implement only for types whose every use and whose `Drop` are sound on the
/// owning JS thread with the heap alive (and need not be sound elsewhere).
pub unsafe trait JsAffine {}

// SAFETY (each below): a GC/loop handle or plain data — used and dropped only
// on the owning JS thread by construction of `JsSide`.
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

/// The JS-thread partition of a job. Opens only with a [`JsThread`] and has
/// no implicit `Drop`: its contents are released by [`take`](Self::take) on the
/// JS thread (completion, or the VM's teardown), which is what makes it sound
/// to carry across threads inside a job.
#[repr(transparent)]
pub struct JsSide<J: JsAffine>(ManuallyDrop<J>);

// SAFETY: the contents are unreachable without a `JsThread`, which exists only
// on the owning JS thread; off that thread a `JsSide` is inert bytes.
unsafe impl<J: JsAffine> Send for JsSide<J> {}

impl<J: JsAffine> JsSide<J> {
    #[inline]
    pub fn new(js: J, _: &JsThread<'_>) -> Self {
        Self(ManuallyDrop::new(js))
    }
    #[inline]
    pub fn get(&self, _: &JsThread<'_>) -> &J {
        &self.0
    }
    #[inline]
    pub fn get_mut(&mut self, _: &JsThread<'_>) -> &mut J {
        &mut self.0
    }
    /// Move the contents out to use and drop them normally (JS thread).
    #[inline]
    pub fn take(self, _: &JsThread<'_>) -> J {
        ManuallyDrop::into_inner(self.0)
    }
    /// Drop the contents in place (JS thread), leaving `self` logically empty.
    ///
    /// # Safety
    /// `self` is not opened or taken afterwards.
    #[inline]
    unsafe fn release_in_place(&mut self, _: &JsThread<'_>) {
        // SAFETY: fn contract.
        unsafe { ManuallyDrop::drop(&mut self.0) }
    }
}

/// A pointer into JS-owned memory (an ArrayBuffer's bytes, a pinned cell, the
/// creating global) that a job carries off-thread. It can be *passed around*
/// anywhere but dereferenced only with proof the VM is alive: a pool
/// [`Borrow`] or a [`JsThread`].
#[repr(transparent)]
pub struct JsPtr<T: ?Sized>(NonNull<T>);
// SAFETY: dereferenceable only under a Borrow/JsThread (see type doc).
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
    #[allow(clippy::mut_from_ref)] // the `&Borrow` is a liveness witness, not the pointee
    pub unsafe fn under_borrow<'b>(self, _: &'b Borrow) -> &'b mut T {
        // SAFETY: borrow held ⇒ VM alive ⇒ pointee alive (type contract); aliasing per fn contract.
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

/// What a particular kind of job does. See the module doc for the partition.
pub trait JobContext: Sized + 'static {
    type OffThread: Send;
    type Js: JsAffine;

    /// Pool thread, under a VM borrow the carrier holds for the whole call.
    /// Return `done` to complete now; keep it (e.g. across async I/O that
    /// finishes on another thread) and call [`Completion::finish`] later to
    /// complete then. Work that outlives this call runs under no borrow and
    /// must touch only `off`.
    fn run(
        off: &mut Self::OffThread,
        vm: &Borrow,
        done: Completion<Self>,
    ) -> Option<Completion<Self>>;

    /// JS thread: the completion. Both partitions are handed over to use and
    /// drop normally.
    fn then(off: Self::OffThread, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;
}

/// The type-erased head of every [`Job<C>`]: dispatch entries (one task tag
/// serves every `C`) and the VM's live-job links.
#[repr(C)]
pub struct JobHeader {
    complete: unsafe fn(*mut JobHeader, &JsThread<'_>) -> JsResult<()>,
    release_unrun: unsafe fn(*mut JobHeader, &JsThread<'_>),
    release_js: unsafe fn(*mut JobHeader, &JsThread<'_>),
    prev: *mut JobHeader,
    next: *mut JobHeader,
    /// The VM already released this job's JS side (teardown); JS thread only.
    js_released: bool,
}

/// A VM's live jobs (intrusive through [`JobHeader`]); JS thread only, and
/// zero-valid (empty). The pool never touches the links: a job joins at
/// `schedule` and leaves at its completion / release, all on the JS thread.
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
            (*job).prev = core::ptr::null_mut();
            (*job).next = core::ptr::null_mut();
        }
    }
    /// VM teardown (JS thread, heap alive, script forbidden, before the handle
    /// closes): release the JS side of every live job. Whatever the pool still
    /// holds afterwards frees only its off-thread part.
    pub fn release_all_js(&mut self, cx: &JsThread<'_>) {
        let mut job = core::mem::replace(&mut self.head, core::ptr::null_mut());
        while !job.is_null() {
            // SAFETY: linked ⇒ live (jobs unlink before they are freed on this
            // thread; the pool frees only after the handle closed, i.e. later).
            unsafe {
                let next = (*job).next;
                ((*job).release_js)(job, cx);
                (*job).prev = core::ptr::null_mut();
                (*job).next = core::ptr::null_mut();
                job = next;
            }
        }
    }
}

/// One pool-then-complete job. Heap-allocated by [`Job::schedule`]; freed by
/// exactly one of: its completion on the JS thread, the queue's release at VM
/// teardown (JS thread, heap alive), or — once the VM is gone — the pool
/// thread, which by then has only the off-thread part left to drop.
#[repr(C)]
pub struct Job<C: JobContext> {
    header: JobHeader,
    loop_handle: LoopHandle,
    task: WorkPoolTask,
    keep_alive: JsSide<KeepAlive>,
    off: C::OffThread,
    js: JsSide<C::Js>,
}

impl<C: JobContext> bun_event_loop::Taskable for Job<C> {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AnyTaskJob;
    /// A completion the pool posted whose `then` will not run. (Dispatch goes
    /// through the erased header — [`release_unrun_erased`] — since the queue
    /// only knows the shared tag; this is the same thing for a known `C`.)
    unsafe fn release_unrun(this: *mut Self) {
        let vm = VirtualMachine::get();
        // SAFETY: fn contract; JS thread with the heap alive.
        unsafe { Self::release_unrun_on(this, &vm.global().js_thread()) }
    }
}

impl<C: JobContext> Job<C> {
    /// JS thread: build the job, keep the loop alive for it, hand it to the pool.
    pub fn schedule(cx: &JsThread<'_>, off: C::OffThread, js: C::Js) {
        let mut keep_alive = KeepAlive::default();
        keep_alive.ref_(bun_io::js_vm_ctx());
        let job = bun_core::heap::into_raw(Box::new(Self {
            header: JobHeader {
                // SAFETY: (this and the two entries below) the erased dispatchers
                // are only reached through this header, so `p` is this `Job<C>`.
                complete: |p, cx| unsafe { Self::complete(p.cast::<Self>(), cx) },
                // SAFETY: as above.
                release_unrun: |p, cx| unsafe { Self::release_unrun_on(p.cast::<Self>(), cx) },
                // SAFETY: as above.
                release_js: |p, cx| unsafe { Self::release_js(p.cast::<Self>(), cx) },
                prev: core::ptr::null_mut(),
                next: core::ptr::null_mut(),
                js_released: false,
            },
            loop_handle: cx.vm().loop_handle(),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_on_pool,
            },
            keep_alive: JsSide::new(keep_alive, cx),
            off,
            js: JsSide::new(js, cx),
        }));
        cx.vm().jobs().push(job.cast());
        // SAFETY: live until one of the three releases; the pool owns it now.
        WorkPool::schedule(unsafe { &raw mut (*job).task });
    }

    fn run_on_pool(task: *mut WorkPoolTask) {
        // SAFETY: only reachable through the `task.callback` slot wired in
        // `schedule`; the pool calls back with exactly that field of a live job.
        let this: *mut Self = unsafe { bun_core::from_field_ptr!(Self, task, task) };
        // SAFETY: live job, exclusively the pool's for this callback.
        let handle = unsafe { (*this).loop_handle.clone() };
        let done = Completion(NonNull::new(this).expect("job"));
        let Some(vm) = handle.borrow() else {
            // VM already gone: nothing ran; `finish` releases.
            return done.finish();
        };
        // SAFETY: as above; the borrow keeps the VM (and any JsPtr target) alive.
        if let Some(done) = C::run(unsafe { &mut (*this).off }, &vm, done) {
            drop(vm);
            done.finish();
        }
    }

    /// JS thread dispatch: run the completion and free the job.
    ///
    /// # Safety
    /// `this` is the job its `Completion` posted; called once.
    unsafe fn complete(this: *mut Self, cx: &JsThread<'_>) -> JsResult<()> {
        // SAFETY: fn contract.
        unsafe {
            debug_assert!(
                !(*this).header.js_released,
                "job dispatched after its VM released it"
            );
            cx.vm().jobs().unlink(this.cast());
            let Job {
                keep_alive,
                off,
                js,
                ..
            } = *Box::from_raw(this);
            keep_alive.take(cx).unref(bun_io::js_vm_ctx());
            C::then(off, js.take(cx), cx)
        }
    }

    /// JS thread, VM tearing down with the heap alive: a completion that was
    /// queued but will never dispatch. Everything left is dropped normally.
    ///
    /// # Safety
    /// As [`complete`](Self::complete).
    unsafe fn release_unrun_on(this: *mut Self, cx: &JsThread<'_>) {
        // SAFETY: fn contract.
        unsafe {
            if !(*this).header.js_released {
                cx.vm().jobs().unlink(this.cast());
                Self::release_js(this, cx);
            }
            core::ptr::drop_in_place(&raw mut (*this).off);
            core::ptr::drop_in_place(&raw mut (*this).loop_handle);
            drop(Box::from_raw(this.cast::<ManuallyDrop<Self>>()));
        }
    }

    /// JS thread: drop the JS side (and keep-alive) in place; the job stays
    /// allocated for whoever frees the rest.
    ///
    /// # Safety
    /// `this` is live and already unlinked; called at most once.
    unsafe fn release_js(this: *mut Self, cx: &JsThread<'_>) {
        // SAFETY: fn contract.
        unsafe {
            debug_assert!(!(*this).header.js_released);
            (*this).header.js_released = true;
            (*this).js.release_in_place(cx);
            let mut keep_alive = core::ptr::read(&raw const (*this).keep_alive).take(cx);
            keep_alive.unref(bun_io::js_vm_ctx());
        }
    }
}

impl<C: JobContext> crate::Postable for Job<C> {
    unsafe fn loop_handle(this: *mut Self) -> *const LoopHandle {
        // SAFETY: fn contract.
        unsafe { &raw const (*this).loop_handle }
    }
    /// VM gone, pool thread: its teardown already released the JS side and
    /// keep-alive on its own thread ([`JobList::release_all_js`]); drop the
    /// off-thread part and the handle and free the storage.
    unsafe fn release_refused(this: *mut Self) {
        // SAFETY: fn contract; refused ⇒ handle closed ⇒ teardown's release ran.
        unsafe {
            debug_assert!(
                (*this).header.js_released,
                "VM closed without releasing its jobs"
            );
            core::ptr::drop_in_place(&raw mut (*this).off);
            core::ptr::drop_in_place(&raw mut (*this).loop_handle);
            drop(Box::from_raw(this.cast::<ManuallyDrop<Self>>()));
        }
    }
}

/// The obligation to complete a running job exactly once: returned from
/// [`JobContext::run`] to complete immediately, or kept and
/// [`finish`](Self::finish)ed later from any thread. Completing delivers the
/// job to its VM (or, if that is gone, releases it).
#[must_use = "a job must be finished exactly once"]
pub struct Completion<C: JobContext>(NonNull<Job<C>>);
// SAFETY: `finish` only posts the job through its (thread-safe) LoopHandle.
unsafe impl<C: JobContext> Send for Completion<C> {}
impl<C: JobContext> Completion<C> {
    pub fn finish(self) {
        // Consumed: the obligation is met here, so its Drop check must not run.
        let job = core::mem::ManuallyDrop::new(self).0.as_ptr();
        // SAFETY: the live heap job this token was created for; consumed once.
        unsafe { crate::post_job(job) };
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
        unsafe { ((*header).release_unrun)(header, cx) };
        return Ok(());
    }
    // SAFETY: `Job<C>` is `#[repr(C)]` with the header first.
    unsafe { ((*header).complete)(header, cx) }
}

/// Teardown's release for a queued, never-dispatched `Job<C>` completion.
///
/// # Safety
/// As [`complete_erased`].
pub unsafe fn release_unrun_erased(ptr: *mut (), cx: &JsThread<'_>) {
    let header = ptr.cast::<JobHeader>();
    // SAFETY: as above.
    unsafe { ((*header).release_unrun)(header, cx) }
}

const _: () = assert!(core::mem::offset_of!(Job<Never>, header) == 0);

#[doc(hidden)]
pub enum Never {}
impl JobContext for Never {
    type OffThread = ();
    type Js = ();
    fn run(_: &mut (), _: &Borrow, done: Completion<Self>) -> Option<Completion<Self>> {
        Some(done)
    }
    fn then(_: (), _: (), _: &JsThread<'_>) -> JsResult<()> {
        Ok(())
    }
}
