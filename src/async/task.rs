//! A future, boxed together with what an event loop needs to run it. See `README.md`.
//!
//! Only the thread that spawned a task polls, cancels or drops its future, so
//! the future needs to be neither `Send` nor `Sync`. Any thread may clone, drop
//! or wake a `Waker`: those touch the header's atomic word and the scheduler.

use core::cell::{Cell, UnsafeCell};
use core::future::Future;
use core::mem::ManuallyDrop;
use core::pin::Pin;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};
use core::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

/// Where a task's wake-ups go. It is stored in the task's allocation, so it can
/// embed the queue node its loop links tasks with: a task is in at most one
/// queue at a time.
///
/// # Safety
/// [`schedule`](Self::schedule) delivers the `Runnable` to the thread that
/// spawned the task, or drops it.
pub unsafe trait Schedule: Send + Sync + Sized + 'static {
    /// What the futures of this loop resolve to. [`Runnable::run`] hands it back.
    type Output;

    /// Any thread. The scheduler is [`task.scheduler()`](Runnable::scheduler),
    /// not `&self`: the task's thread may run and free the task the moment it
    /// is queued, so nothing of it is touched after it is handed over.
    fn schedule(task: Runnable<Self>);

    /// The task's thread: its future was just dropped, having finished or been
    /// cancelled. Called once.
    fn finished(&self) {}
}

/// In its loop's queue.
const SCHEDULED: u32 = 1 << 0;
/// The future is gone. There is nothing left to poll.
const DONE: u32 = 1 << 1;
/// The last `Waker` went away while the future was pending, so nothing can
/// resume it. It is queued once more for its thread to drop it.
const ORPHANED: u32 = 1 << 2;
const REFERENCE: u32 = 1 << 3;
const REFERENCES: u32 = !(REFERENCE - 1);

#[repr(C)]
struct Header<S: Schedule> {
    /// The flags above, and how many `Waker`s and `Runnable`s point here.
    state: AtomicU32,
    /// The three below are the task's thread's alone.
    polling: Cell<bool>,
    /// [`Runnable::run`] was entered again from inside the poll (a nested tick of the loop).
    run_again: Cell<bool>,
    /// [`cancel`] was called from inside the poll.
    cancel_after_poll: Cell<bool>,
    vtable: &'static VTable<S>,
    scheduler: S,
}

struct VTable<S: Schedule> {
    poll: unsafe fn(NonNull<Header<S>>, &mut Context<'_>) -> Poll<S::Output>,
    drop_future: unsafe fn(NonNull<Header<S>>),
    dealloc: unsafe fn(NonNull<Header<S>>),
}

#[repr(C)]
struct Task<F, S: Schedule> {
    header: Header<S>,
    future: UnsafeCell<ManuallyDrop<F>>,
}

impl<F, S> Task<F, S>
where
    F: Future<Output = S::Output> + 'static,
    S: Schedule,
{
    const VTABLE: VTable<S> = VTable {
        poll: Self::poll,
        drop_future: Self::drop_future,
        dealloc: Self::dealloc,
    };

    /// # Safety
    /// `header` heads a live `Task<F, S>` whose future has not been dropped;
    /// the task's thread; not already inside `poll` or `drop_future`.
    unsafe fn poll(header: NonNull<Header<S>>, cx: &mut Context<'_>) -> Poll<S::Output> {
        // SAFETY: fn contract. The future never moves: it is dropped in place.
        let future =
            unsafe { Pin::new_unchecked(&mut **(*header.cast::<Self>().as_ptr()).future.get()) };
        future.poll(cx)
    }

    /// # Safety
    /// As [`poll`](Self::poll). The future is not used afterwards.
    unsafe fn drop_future(header: NonNull<Header<S>>) {
        // SAFETY: fn contract.
        unsafe { ManuallyDrop::drop(&mut *(*header.cast::<Self>().as_ptr()).future.get()) }
    }

    /// # Safety
    /// `header` heads a `Task<F, S>` that nothing else points to and whose
    /// future has been dropped.
    unsafe fn dealloc(header: NonNull<Header<S>>) {
        // SAFETY: fn contract; allocated by `spawn`.
        unsafe { bun_core::heap::destroy(header.cast::<Self>().as_ptr()) };
    }
}

/// Box `future`. Nothing has polled it yet: the caller runs the `Runnable` now
/// (the future starts inside the call that spawned it, as an `async function`
/// does in JavaScript) or queues it.
pub fn spawn<F, S>(future: F, scheduler: S) -> Runnable<S>
where
    F: Future<Output = S::Output> + 'static,
    S: Schedule,
{
    let task = bun_core::heap::alloc_nn(Task {
        header: Header {
            state: AtomicU32::new(SCHEDULED | REFERENCE),
            polling: Cell::new(false),
            run_again: Cell::new(false),
            cancel_after_poll: Cell::new(false),
            vtable: &Task::<F, S>::VTABLE,
            scheduler,
        },
        future: UnsafeCell::new(ManuallyDrop::new(future)),
    });
    Runnable(task.cast())
}

/// A task that was woken, on its way through its loop's queue. Dropping it
/// instead of running it only gives the reference up, which is all a thread
/// other than the task's can do.
#[must_use = "a woken task is run by its loop"]
pub struct Runnable<S: Schedule>(NonNull<Header<S>>);

// SAFETY: `Schedule::schedule` receives it on the waking thread and moves it to
// the task's. Off that thread only `into_raw`, `scheduler` and `drop` are safe
// to call, and they touch the atomic word and `S: Sync`.
unsafe impl<S: Schedule> Send for Runnable<S> {}

impl<S: Schedule> Runnable<S> {
    /// For a queue that stores an erased pointer.
    #[inline]
    pub fn into_raw(self) -> NonNull<()> {
        ManuallyDrop::new(self).0.cast()
    }

    /// # Safety
    /// `ptr` came from [`into_raw`](Self::into_raw) of a `Runnable<S>`, once.
    #[inline]
    pub unsafe fn from_raw(ptr: NonNull<()>) -> Self {
        Self(ptr.cast())
    }

    #[inline]
    pub fn scheduler(&self) -> &S {
        // SAFETY: a `Runnable` points at a live header.
        unsafe { &(*self.0.as_ptr()).scheduler }
    }

    /// [`scheduler`](Self::scheduler) with the provenance of the whole task,
    /// for [`cancel`] and for a queue node embedded in `S`.
    #[inline]
    pub fn scheduler_ptr(&self) -> NonNull<S> {
        // SAFETY: a `Runnable` points at a live header.
        unsafe { NonNull::new_unchecked(&raw mut (*self.0.as_ptr()).scheduler) }
    }

    /// Poll the future. `Some` once it has finished.
    ///
    /// # Safety
    /// The thread that spawned the task.
    pub unsafe fn run(self) -> Option<S::Output> {
        let task = ManuallyDrop::new(self).0;
        // SAFETY: the `Runnable` just consumed keeps the task alive until `release` below.
        let header = unsafe { task.as_ref() };
        // Cleared before the poll: a wake that arrives during it queues the task again.
        let state = header.state.fetch_and(!SCHEDULED, Ordering::AcqRel);
        let mut output = None;
        if state & DONE != 0 {
            // Cancelled while it was queued.
        } else if state & ORPHANED != 0 {
            // SAFETY: fn contract; not `DONE`, and an orphan is not being polled.
            unsafe { finish(task) };
        } else if header.polling.get() {
            header.run_again.set(true);
        } else {
            header.polling.set(true);
            // SAFETY: borrows this function's reference, which outlives it.
            let waker = ManuallyDrop::new(unsafe { Waker::from_raw(raw_waker(task)) });
            // SAFETY: fn contract; not `DONE`; `polling` was clear.
            let poll = unsafe { (header.vtable.poll)(task, &mut Context::from_waker(&waker)) };
            header.polling.set(false);
            let run_again = header.run_again.take();
            match poll {
                Poll::Ready(value) => {
                    output = Some(value);
                    // SAFETY: as above.
                    unsafe { finish(task) };
                }
                // SAFETY: as above.
                Poll::Pending if header.cancel_after_poll.get() => unsafe { finish(task) },
                // SAFETY: live, see above.
                Poll::Pending if run_again => unsafe { wake_by_ref::<S>(task.as_ptr().cast()) },
                Poll::Pending => {}
            }
        }
        // SAFETY: the reference taken from `self`.
        unsafe { release(task) };
        output
    }

    /// Drop the future without polling it: the loop is going away.
    ///
    /// # Safety
    /// The thread that spawned the task.
    pub unsafe fn cancel(self) {
        // SAFETY: fn contract; `self` keeps the task alive.
        unsafe { cancel(self.scheduler_ptr()) };
    }
}

impl<S: Schedule> Drop for Runnable<S> {
    fn drop(&mut self) {
        // SAFETY: a `Runnable` owns one reference.
        unsafe { release(self.0) };
    }
}

/// Drop a task's future now, wherever the task is: suspended, queued, or (from
/// inside its own poll) as soon as that poll returns. Its `Waker`s stay valid
/// and do nothing. A no-op once the future is gone.
///
/// # Safety
/// `scheduler` came from [`Runnable::scheduler_ptr`] of a task that is still
/// allocated, as one is until [`Schedule::finished`]; the thread that spawned it.
pub unsafe fn cancel<S: Schedule>(scheduler: NonNull<S>) {
    // SAFETY: fn contract: `scheduler` is the field of a live `Header<S>` and
    // carries the provenance of the whole task.
    let task: NonNull<Header<S>> = unsafe {
        NonNull::new_unchecked(bun_core::from_field_ptr!(
            Header<S>,
            scheduler,
            scheduler.as_ptr()
        ))
    };
    // SAFETY: fn contract.
    let header = unsafe { task.as_ref() };
    if header.state.load(Ordering::Acquire) & DONE != 0 {
        return;
    }
    if header.polling.get() {
        header.cancel_after_poll.set(true);
        return;
    }
    // The future may hold the only `Waker`s.
    header.state.fetch_add(REFERENCE, Ordering::Relaxed);
    // SAFETY: fn contract; not `DONE`, not polling.
    unsafe {
        finish(task);
        release(task);
    }
}

/// # Safety
/// The task's thread; the caller holds a reference; the future has not been
/// dropped and is not being polled.
unsafe fn finish<S: Schedule>(task: NonNull<Header<S>>) {
    // SAFETY: fn contract.
    let header = unsafe { task.as_ref() };
    // First, so that the `Waker`s the future drops do not find an orphan.
    header.state.fetch_or(DONE, Ordering::AcqRel);
    // SAFETY: fn contract.
    unsafe { (header.vtable.drop_future)(task) };
    header.scheduler.finished();
}

/// [`cancel`] reaches a pending task without a reference, so the last reference of one is never
/// counted down and then looked at: in one step it becomes the reference of the orphan's `Runnable`.
/// If the loop drops that too, the task stays allocated for `cancel`, with no reference.
///
/// # Safety
/// The caller owns one reference to `task` and does not use it afterwards.
unsafe fn release<S: Schedule>(task: NonNull<Header<S>>) {
    // SAFETY: fn contract.
    let header = unsafe { task.as_ref() };
    let mut state = header.state.load(Ordering::Relaxed);
    loop {
        let orphans = state & (REFERENCES | DONE | ORPHANED) == REFERENCE;
        let next = if orphans {
            state | SCHEDULED | ORPHANED
        } else {
            state - REFERENCE
        };
        match header
            .state
            .compare_exchange_weak(state, next, Ordering::AcqRel, Ordering::Relaxed)
        {
            Err(actual) => state = actual,
            Ok(_) if orphans => return S::schedule(Runnable(task)),
            Ok(_) => {
                if next & (REFERENCES | DONE) == DONE {
                    // SAFETY: that was the last reference, and the future is gone.
                    unsafe { (header.vtable.dealloc)(task) };
                }
                return;
            }
        }
    }
}

struct WakerVTable<S>(core::marker::PhantomData<S>);
impl<S: Schedule> WakerVTable<S> {
    const VTABLE: RawWakerVTable =
        RawWakerVTable::new(clone::<S>, wake::<S>, wake_by_ref::<S>, drop_waker::<S>);
}

#[inline]
fn raw_waker<S: Schedule>(task: NonNull<Header<S>>) -> RawWaker {
    RawWaker::new(task.as_ptr().cast(), &WakerVTable::<S>::VTABLE)
}

/// # Safety
/// (This and the three below.) `data` is the `Header<S>` of a `Waker` made by
/// [`raw_waker`], which owns a reference.
unsafe fn clone<S: Schedule>(data: *const ()) -> RawWaker {
    // SAFETY: fn contract.
    let task = unsafe { NonNull::new_unchecked(data.cast_mut().cast::<Header<S>>()) };
    // SAFETY: fn contract.
    let state = unsafe { task.as_ref() }
        .state
        .fetch_add(REFERENCE, Ordering::Relaxed);
    assert!(state < u32::MAX / 2, "too many Wakers for one task");
    raw_waker(task)
}

unsafe fn wake<S: Schedule>(data: *const ()) {
    // SAFETY: fn contract.
    let task = unsafe { NonNull::new_unchecked(data.cast_mut().cast::<Header<S>>()) };
    // SAFETY: fn contract.
    let header = unsafe { task.as_ref() };
    let state = header.state.fetch_or(SCHEDULED, Ordering::AcqRel);
    // The `Waker`'s reference becomes the queue's, or is given up.
    let runnable = Runnable(task);
    if state & (SCHEDULED | DONE) == 0 {
        S::schedule(runnable);
    }
}

unsafe fn wake_by_ref<S: Schedule>(data: *const ()) {
    // SAFETY: fn contract.
    let task = unsafe { NonNull::new_unchecked(data.cast_mut().cast::<Header<S>>()) };
    // SAFETY: fn contract.
    let header = unsafe { task.as_ref() };
    let state = header.state.fetch_or(SCHEDULED, Ordering::AcqRel);
    if state & (SCHEDULED | DONE) == 0 {
        header.state.fetch_add(REFERENCE, Ordering::Relaxed);
        S::schedule(Runnable(task));
    }
}

unsafe fn drop_waker<S: Schedule>(data: *const ()) {
    // SAFETY: fn contract.
    unsafe { release(NonNull::new_unchecked(data.cast_mut().cast::<Header<S>>())) };
}
