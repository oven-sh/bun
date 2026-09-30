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
//! [`JsPtr`], dereferenceable only with the job's ticket.
//!
//! Node's equivalent is `ThreadPoolWork` + `req_wrap`; WebCore's is
//! `WorkerRunLoop::postTask` with `ActiveDOMObject`-owned completions.

use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_collections::HashMap;
use bun_core::Fd;
use bun_io::KeepAlive;
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

    /// What a host function starts with: this global, and the context of the script that called it.
    #[inline]
    pub fn js_thread_of_caller<'a>(&'a self, frame: &crate::CallFrame) -> JsThread<'a> {
        self.js_thread(self.bun_vm().context_of_caller(frame))
    }

    /// As [`js_thread_of_caller`](Self::js_thread_of_caller) where no `CallFrame` reaches Rust
    /// (see [`VirtualMachine::context_of_caller_no_frame`]).
    #[inline]
    pub fn js_thread_of_caller_no_frame(&self) -> JsThread<'_> {
        self.js_thread(self.bun_vm().context_of_caller_no_frame())
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

    /// Whether [`cancel`](Self::cancel) does anything, i.e. whether the job
    /// can wait on something external. Only such jobs are tracked by the VM.
    const CANCELLABLE: bool = false;

    /// [`run`](Self::run) gives back something of the process's, which is to
    /// happen also when the VM that asked for it is on its way out.
    const RUNS_CANCELLED: bool = false;

    /// [`run`](Self::run) writes what script takes for written when the call
    /// that made the job returns: `process.exit()` waits for it
    /// ([`WorkPool::owe_write`]), unless it [`waits`](Self::waits).
    const OWED_AT_EXIT: bool = false;

    /// [`waits`](Self::waits) is true whatever the job was given: nothing has
    /// to be asked, and it goes to those threads directly.
    const ALWAYS_WAITS: bool = false;

    /// Pool thread, before [`run`](Self::run): whether that may wait, for as
    /// long as it takes, on something outside the process. It then runs on
    /// [`WorkPool::schedule_wait`]'s threads.
    fn waits(off: &Self::OffThread) -> bool {
        let _ = off;
        false
    }

    /// Pool thread, VM not yet in its final wait when the pool reached the job
    /// (a job reached later is handed back unrun, as Node's environment
    /// cleanup `uv_cancel`s queued work, unless it
    /// [`RUNS_CANCELLED`](Self::RUNS_CANCELLED)). Return `done` to complete now; keep
    /// it (e.g. across async I/O that finishes on another thread) and call
    /// [`Completion::finish`] later to complete then. `done.ticket()` is the
    /// job's ticket: proof the VM is alive (for [`JsPtr::under_ticket`]), and
    /// `script_allowed()` on it says whether the result still has a consumer.
    /// `off` borrows the job, which the JS thread may free the moment
    /// [`Completion::finish`] queues it: do not touch it after finishing.
    fn run(off: &mut Self::OffThread, done: Completion<Self>) -> Option<Completion<Self>>;

    /// JS thread, in place of [`run`](Self::run): the descriptor the job was
    /// given ([`Job::schedule_on_fd`]) is closed as far as it goes. What `run`
    /// would have found, without going near the number.
    fn closed(off: &mut Self::OffThread) {
        let _ = off;
        unreachable!("not a job on a descriptor");
    }

    /// JS thread: the job is back, whether or not [`then`](Self::then) follows.
    fn back(off: &Self::OffThread, vm: &VirtualMachine) {
        let _ = (off, vm);
    }

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
    /// The context whose script scheduled the job: once it stops, the
    /// completion is released without running.
    context: crate::ContextId,
    /// `VirtualMachine::test_isolation_generation` when scheduled.
    generation: u32,
}

/// A VM's live [cancellable](JobContext::CANCELLABLE) jobs (JS thread only;
/// zero-valid), so its stop phase can [`cancel`](JobContext::cancel) them.
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

/// What a job does with a file descriptor that script handed it.
#[derive(Clone, Copy)]
pub enum FdUse {
    Uses(Fd),
    /// Writes at the descriptor's position, so what it writes is to come
    /// after what the jobs of this kind that were given the descriptor before
    /// it write: it goes to the pool when the last of them is done.
    Appends(Fd),
    /// Goes to the pool once every job that was given the descriptor before it
    /// is back. The pool starts jobs in no particular order, and a number that
    /// is closed early is the next file's: what was still to be written would
    /// land there.
    Closes(Fd),
}

impl FdUse {
    pub fn fd(self) -> Fd {
        match self {
            Self::Uses(fd) | Self::Appends(fd) | Self::Closes(fd) => fd,
        }
    }

    /// Whether jobs are out on the descriptor: what the JS thread did to it
    /// now would be ahead of them.
    pub fn is_behind_jobs(self, vm: &VirtualMachine) -> bool {
        vm.fd_jobs
            .with_mut(|jobs| jobs.lines.contains_key(&self.fd()))
    }

    /// The JS thread is about to do this itself, at once. A close does not
    /// wait for what is out on the descriptor, which then is not counted
    /// against the next file to get the number.
    pub fn on_js_thread(self, vm: &VirtualMachine) {
        if let Self::Closes(fd) = self {
            vm.fd_jobs.with_mut(|jobs| jobs.end(fd));
        }
    }
}

/// Where a job that uses a descriptor is counted.
#[derive(Clone, Copy)]
struct FdPlace {
    fd: Fd,
    line: u64,
}

/// The jobs that are out on a descriptor.
struct FdLine {
    /// Tells it from the lines the number had before.
    id: u64,
    /// Handed to the pool and not back yet; never 0.
    running: u32,
    /// Goes to the pool when they are back.
    close: Option<*mut WorkPoolTask>,
    /// [`Job::next_append`] of the last [`FdUse::Appends`] job, while it is out.
    last_append: *const AtomicPtr<WorkPoolTask>,
}

/// In [`Job::next_append`]: the job is done, and nothing can be put behind it.
const APPENDED: *mut WorkPoolTask = core::ptr::without_provenance_mut(1);

/// What is to become of a job that was given a descriptor.
enum Entered {
    /// The pool's now.
    Goes(Option<FdPlace>),
    /// Behind the job whose [`Job::next_append`] this is: that one gives it to
    /// the pool when it is done, if it is told of it before then.
    Follows(FdPlace, *const AtomicPtr<WorkPoolTask>),
    /// A close: the pool's when the jobs of this line are back.
    Waits(u64),
    /// Given the descriptor behind a close that is waiting. The number is
    /// still open, so it is not another file's yet: this is the descriptor
    /// that is being closed.
    Closed,
}

/// A VM's live jobs on file descriptors (JS thread only, and without a system
/// call: one on a network file system can take as long as the server likes).
///
/// Once a close is the pool's, its number can be the next file's at any moment,
/// and nothing that is given the number is held up or turned away.
#[derive(Default)]
pub struct FdJobs {
    lines: HashMap<Fd, FdLine>,
    ids: u64,
}

impl FdJobs {
    /// `next_append` is the job's own.
    fn enter(
        &mut self,
        task: *mut WorkPoolTask,
        next_append: *const AtomicPtr<WorkPoolTask>,
        fd_use: FdUse,
    ) -> Entered {
        let fd = fd_use.fd();
        if matches!(fd_use, FdUse::Closes(_)) {
            return match self.lines.get_mut(&fd) {
                None => Entered::Goes(None),
                Some(FdLine { close: Some(_), .. }) => Entered::Closed,
                Some(line) => {
                    line.close = Some(task);
                    Entered::Waits(line.id)
                }
            };
        }
        let line = self.lines.entry(fd).or_insert_with(|| {
            self.ids += 1;
            FdLine {
                id: self.ids,
                running: 0,
                close: None,
                last_append: core::ptr::null(),
            }
        });
        if line.close.is_some() {
            return Entered::Closed;
        }
        line.running += 1;
        let place = FdPlace { fd, line: line.id };
        if matches!(fd_use, FdUse::Appends(_)) {
            let last = core::mem::replace(&mut line.last_append, next_append);
            if !last.is_null() {
                return Entered::Follows(place, last);
            }
        }
        Entered::Goes(Some(place))
    }

    /// A job that was counted is back from the pool.
    fn leave(&mut self, place: FdPlace, next_append: *const AtomicPtr<WorkPoolTask>) {
        // A close went ahead of it otherwise.
        if let Some(line) = self.lines.get_mut(&place.fd)
            && line.id == place.line
        {
            if line.last_append == next_append {
                line.last_append = core::ptr::null();
            }
            line.running -= 1;
            if line.running == 0 {
                self.end(place.fd);
            }
        }
    }

    /// The close that waits for the jobs of `line` goes ahead of them. They
    /// are not counted any more: they can outlive the descriptor, into the life
    /// of the next file to get the number.
    fn stop_waiting(&mut self, place: FdPlace) {
        if self
            .lines
            .get(&place.fd)
            .is_some_and(|line| line.id == place.line)
        {
            self.end(place.fd);
        }
    }

    fn end(&mut self, fd: Fd) {
        if let Some(FdLine {
            close: Some(task), ..
        }) = self.lines.remove(&fd)
        {
            WorkPool::schedule(task);
        }
    }
}

#[cfg(windows)]
fn is_on_disk(fd: Fd) -> bool {
    bun_sys::windows::fs::is_disk_file(fd)
}

#[cfg(unix)]
fn is_on_disk(fd: Fd) -> bool {
    bun_sys::fstat(fd).is_ok_and(|stat| {
        matches!(
            bun_sys::kind_from_mode(stat.st_mode as _),
            bun_sys::FileKind::File | bun_sys::FileKind::Directory
        )
    })
}

/// Whether a close has to wait for the jobs that are out on its descriptor.
/// Those on a file or a directory come back by themselves. On a pipe, a
/// console or a device one can be out for as long as the other end likes.
enum FdKind {}

struct FdKindQuery {
    place: FdPlace,
    on_disk: bool,
}

impl JobContext for FdKind {
    type OffThread = FdKindQuery;
    type Js = ();
    fn run(query: &mut FdKindQuery, done: Completion<Self>) -> Option<Completion<Self>> {
        query.on_disk = is_on_disk(query.place.fd);
        Some(done)
    }
    /// Not `then`: the close is on its way also when the script that asked for
    /// it is not there to hear of it any more.
    fn back(query: &FdKindQuery, vm: &VirtualMachine) {
        if !query.on_disk {
            vm.fd_jobs.with_mut(|jobs| jobs.stop_waiting(query.place));
        }
    }
    fn then(_: FdKindQuery, _: (), _: &JsThread<'_>) -> JsResult<()> {
        Ok(())
    }
}

/// One pool-then-complete job. Heap-allocated by [`Job::schedule`]; freed on
/// the JS thread by its completion or by the teardown's release.
#[repr(C)]
pub struct Job<C: JobContext> {
    /// First (asserted at the bottom of the file): erased dispatch casts
    /// `*mut Job<C>` to `*mut JobHeader`.
    header: JobHeader,
    /// Moved into the [`Completion`] when the pool picks the job up; `None`
    /// from then on (never touched on the JS side).
    ticket: Option<Ticket>,
    task: WorkPoolTask,
    keep_alive: KeepAlive,
    /// Its places in the VM's [`FdJobs`].
    places: [Option<FdPlace>; 2],
    /// Counted by [`WorkPool::owe_write`]. The pool's with the job.
    owed: bool,
    /// The [`FdUse::Appends`] job that goes to the pool when this one is done,
    /// or [`APPENDED`].
    next_append: AtomicPtr<WorkPoolTask>,
    off: C::OffThread,
    js: C::Js,
}

impl<C: JobContext> bun_event_loop::Taskable for Job<C> {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AnyTaskJob;
    /// Reached through the header (`release_unrun_erased`): the tag is shared.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; JS thread with the heap alive.
        drop(unsafe { Self::take(this, VirtualMachine::get()) })
    }
    /// The context whose script scheduled the job.
    unsafe fn context(this: *const Self) -> bun_event_loop::ContextId {
        // SAFETY: fn contract.
        unsafe { (*this).header.context }
    }
}

impl<C: JobContext> Job<C> {
    /// JS thread: build the job, keep the loop alive for it, hand it to the pool.
    #[track_caller]
    pub fn schedule(cx: &JsThread<'_>, off: C::OffThread, js: C::Js) {
        Self::schedule_on_fds(cx, off, js, [None, None]);
    }

    /// [`schedule`](Self::schedule) for a job that may be working on a file
    /// descriptor of script's.
    #[track_caller]
    pub fn schedule_on_fd(cx: &JsThread<'_>, off: C::OffThread, js: C::Js, fd_use: Option<FdUse>) {
        Self::schedule_on_fds(cx, off, js, [fd_use, None]);
    }

    /// [`schedule_on_fd`](Self::schedule_on_fd) for one that may be working on
    /// two. A close has no other, and [`FdUse::Appends`] comes last: a job
    /// that was put behind another is that one's to start.
    #[track_caller]
    pub fn schedule_on_fds(
        cx: &JsThread<'_>,
        off: C::OffThread,
        js: C::Js,
        fd_uses: [Option<FdUse>; 2],
    ) {
        let mut keep_alive = KeepAlive::default();
        keep_alive.ref_(bun_io::js_vm_ctx());
        let job = bun_core::heap::into_raw(Box::new(Self {
            header: JobHeader {
                // SAFETY: (this and the entry below) the erased dispatchers are
                // only reached through this header, so `p` is this `Job<C>`.
                complete: |p, cx| unsafe { Self::complete(p.cast::<Self>(), cx) },
                // SAFETY: as above.
                release_unrun: |p| unsafe {
                    <Self as bun_event_loop::Taskable>::release_unrun(p.cast::<Self>())
                },
                // SAFETY: linked ⇒ live; see `JobContext::cancel`.
                cancel: |p| unsafe { C::cancel(&raw mut (*p.cast::<Self>()).off) },
                prev: core::ptr::null_mut(),
                next: core::ptr::null_mut(),
                context: cx.context().id(),
                generation: cx.vm().test_isolation_generation,
            },
            ticket: Some(cx.vm().ticket()),
            task: WorkPoolTask {
                node: Default::default(),
                callback: if C::ALWAYS_WAITS {
                    Self::run
                } else {
                    Self::run_on_pool
                },
            },
            keep_alive,
            places: [None, None],
            owed: false,
            next_append: AtomicPtr::new(core::ptr::null_mut()),
            off,
            js,
        }));
        // SAFETY: live until completed/released on this thread; the pool's from
        // here, or from its turn on the descriptor.
        unsafe {
            if C::CANCELLABLE {
                cx.vm().jobs.with_mut(|j| j.push(&raw mut (*job).header));
            }
            let task = &raw mut (*job).task;
            let next_append = &raw const (*job).next_append;
            let mut follows = core::ptr::null();
            for (index, fd_use) in fd_uses.into_iter().enumerate() {
                let Some(fd_use) = fd_use else { continue };
                let entered = cx
                    .vm()
                    .fd_jobs
                    .with_mut(|jobs| jobs.enter(task, next_append, fd_use));
                match entered {
                    Entered::Goes(place) => (*job).places[index] = place,
                    Entered::Follows(place, last) => {
                        (*job).places[index] = Some(place);
                        follows = last;
                    }
                    Entered::Waits(line) => {
                        let place = FdPlace {
                            fd: fd_use.fd(),
                            line,
                        };
                        let query = FdKindQuery {
                            place,
                            on_disk: true,
                        };
                        return Job::<FdKind>::schedule(cx, query, ());
                    }
                    Entered::Closed => {
                        C::closed(&mut (*job).off);
                        return Completion {
                            job: NonNull::new(job).expect("job"),
                            ticket: (*job).ticket.take().expect("job"),
                        }
                        .finish();
                    }
                }
            }
            if C::ALWAYS_WAITS {
                return WorkPool::schedule_wait(task);
            }
            // Last: told of it, the job ahead can have given it to the pool, and
            // the pool can be done with it, before this returns. That job takes
            // itself out of `last_append` on this thread before it is freed.
            if let Some(last) = follows.as_ref() {
                (*task).callback = Self::run_handed_over;
                if last
                    .compare_exchange(
                        core::ptr::null_mut(),
                        task,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    )
                    .is_ok()
                {
                    return;
                }
                (*task).callback = Self::run_on_pool;
            }
            if C::OWED_AT_EXIT {
                (*job).owed = true;
                WorkPool::owe_write();
            }
            WorkPool::schedule(task);
        }
    }

    /// The pool's from the job ahead of it, which counted it
    /// ([`Completion::finish`]). Not counted while it was behind that one,
    /// which can be a write to a pipe that nobody reads.
    fn run_handed_over(task: *mut WorkPoolTask) {
        #[cfg(windows)]
        if C::OWED_AT_EXIT {
            // SAFETY: as in `run`.
            unsafe { (*bun_core::from_field_ptr!(Self, task, task)).owed = true };
        } else {
            WorkPool::write_settled();
        }
        Self::run_on_pool(task);
    }

    fn run_on_pool(task: *mut WorkPoolTask) {
        // SAFETY: as in `run`; the job is exclusively the pool's for this callback.
        unsafe {
            let this: *mut Self = bun_core::from_field_ptr!(Self, task, task);
            // A job that `run` hands back unrun has nothing to ask about.
            let cancelled = (*this).ticket.as_ref().expect("job").cancelled();
            if !cancelled && C::waits(&(*this).off) {
                if core::mem::take(&mut (*this).owed) {
                    WorkPool::write_settled();
                }
                (*task).callback = Self::run;
                return WorkPool::schedule_wait(task);
            }
        }
        Self::run(task);
    }

    fn run(task: *mut WorkPoolTask) {
        // SAFETY: only reachable through the `task.callback` slot wired in
        // `schedule`; the pool calls back with exactly that field of a live job.
        let this: *mut Self = unsafe { bun_core::from_field_ptr!(Self, task, task) };
        // SAFETY: live job, exclusively the pool's for this callback; the
        // ticket leaves the job here, for good.
        let (off, ticket) = unsafe { (&mut (*this).off, (*this).ticket.take().expect("job")) };
        let done = Completion {
            job: NonNull::new(this).expect("job"),
            ticket,
        };
        if !C::RUNS_CANCELLED && done.ticket().cancelled() {
            return done.finish();
        }
        if let Some(done) = C::run(off, done) {
            done.finish();
        }
    }

    /// JS thread: reclaim a posted job and drop its keep-alive; the two halves
    /// are the caller's to complete or drop.
    ///
    /// # Safety
    /// `this` is the job its `Completion` posted; called once, on `vm`'s thread.
    unsafe fn take(this: *mut Self, vm: &VirtualMachine) -> (C::OffThread, C::Js) {
        if C::CANCELLABLE {
            // SAFETY: fn contract.
            vm.jobs
                .with_mut(|j| j.unlink(unsafe { &raw mut (*this).header }));
        }
        // SAFETY: fn contract. Compared below, not followed.
        let next_append = unsafe { &raw const (*this).next_append };
        // SAFETY: fn contract.
        let Job {
            mut keep_alive,
            places,
            off,
            js,
            ..
        } = unsafe { *Box::from_raw(this) };
        for place in places.into_iter().flatten() {
            vm.fd_jobs.with_mut(|jobs| jobs.leave(place, next_append));
        }
        C::back(&off, vm);
        keep_alive.unref(bun_io::js_vm_ctx());
        (off, js)
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
pub struct Completion<C: JobContext> {
    job: NonNull<Job<C>>,
    ticket: Ticket,
}
// SAFETY: `finish` only posts the job through its (thread-safe) ticket.
unsafe impl<C: JobContext> Send for Completion<C> {}
impl<C: JobContext> Completion<C> {
    /// Post the job back to its VM. The ticket outlives the post (the JS
    /// thread may free the job the moment it is queued) and is dropped here.
    pub fn finish(self) {
        // Consumed: the obligation is met here, so its Drop check must not run.
        let me = ManuallyDrop::new(self);
        // SAFETY: the job is this thread's until it is posted below.
        let job = unsafe { &mut *me.job.as_ptr() };
        let next = job.next_append.swap(APPENDED, Ordering::AcqRel);
        if !next.is_null() {
            // Before this one is settled: an exit that waits for it goes on to
            // wait for what was written behind it.
            #[cfg(windows)]
            WorkPool::owe_write();
            WorkPool::schedule(next);
        }
        if C::OWED_AT_EXIT && core::mem::take(&mut job.owed) {
            WorkPool::write_settled();
        }
        // SAFETY: moving the field out of a value that is never dropped.
        let ticket = unsafe { core::ptr::read(&raw const me.ticket) };
        ticket.post(bun_event_loop::ConcurrentTask::ConcurrentTask::create_from(
            me.job.as_ptr(),
        ));
    }
    /// The job found that it may wait on something outside the process, which
    /// [`JobContext::waits`] could not tell: an exit does not wait for it
    /// ([`JobContext::OWED_AT_EXIT`]).
    pub fn not_owed_at_exit(&self) {
        // SAFETY: the job is the holder's until it is finished.
        if unsafe { core::mem::take(&mut (*self.job.as_ptr()).owed) } {
            WorkPool::write_settled();
        }
    }

    /// The job's ticket: its VM is alive while this is held.
    #[inline]
    pub fn ticket(&self) -> &Ticket {
        &self.ticket
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
pub unsafe fn complete_erased(ptr: *mut (), global: &JSGlobalObject) -> JsResult<()> {
    let header = ptr.cast::<JobHeader>();
    let vm = global.bun_vm();
    // One scheduled by a file `bun test --isolate` has since retired: the swap was that file's
    // exit, and a `then` that calls back directly (node:crypto's callback forms) would run its
    // script under the next file.
    // SAFETY: `Job<C>` is `#[repr(C)]` with the header first.
    if unsafe { (*header).generation } != vm.test_isolation_generation {
        // SAFETY: as below; released exactly once, here.
        unsafe { ((*header).release_unrun)(header) };
        return Ok(());
    }
    // The completion continues the script that scheduled the job.
    // SAFETY: as above.
    let context = vm.context_of(unsafe { (*header).context });
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
