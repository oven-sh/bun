//! `blocking(..).await`: run a closure on a thread pool.
//!
//! The closure owns what it uses (`Send + 'static`), because the future that
//! awaits it can be dropped at any time and the pool cannot be interrupted: an
//! abandoned closure that has not started is skipped, one that has runs to its
//! end and its result is dropped.

use core::cell::UnsafeCell;
use core::future::Future;
use core::marker::PhantomData;
use core::pin::Pin;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU8, Ordering};
use core::task::{Context, Poll, Waker};

use bun_threading::work_pool::Task as PoolTask;

/// Held from [`blocking`] until the pool thread's last touch of the operation,
/// wake included. What keeps the loop that is woken alive: a `bun_jsc::Ticket`
/// for a JS loop, nothing for a loop that outlives its work.
pub trait InFlight: Send + 'static {
    /// The loop no longer wants work it has not started.
    fn is_cancelled(&self) -> bool {
        false
    }
    /// The pool thread, about to hand the operation back.
    fn before_finish(&self) {}
}
impl InFlight for () {}

/// `waker` is set, and is the pool thread's to take.
const WAITING: u8 = 1 << 0;
/// `value` is written, and is the future's to take.
const FINISHED: u8 = 1 << 1;
/// Whoever sets the second of these two frees the operation.
const FUTURE_GONE: u8 = 1 << 2;
const POOL_GONE: u8 = 1 << 3;

#[repr(C)]
struct Shared<T> {
    state: AtomicU8,
    waker: UnsafeCell<Option<Waker>>,
    /// Stays `None` if the closure was skipped.
    value: UnsafeCell<Option<T>>,
    dealloc: unsafe fn(NonNull<Shared<T>>),
}

#[repr(C)]
struct Operation<T, F, G> {
    shared: Shared<T>,
    task: PoolTask,
    work: UnsafeCell<Option<(F, G)>>,
}

/// The result of a closure that is running on the work pool.
#[must_use = "dropping it abandons the work"]
pub struct Blocking<T> {
    shared: NonNull<Shared<T>>,
    /// Polled and dropped on one thread: `waker` is written without a lock.
    _not_send: PhantomData<*mut T>,
}

/// Hand `work` to the pool now, through `submit` (`WorkPool::schedule`).
/// Awaiting is only how its result is collected, so several started in a row
/// run side by side.
pub fn blocking<T, F, G>(submit: impl FnOnce(*mut PoolTask), in_flight: G, work: F) -> Blocking<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
    G: InFlight,
{
    let operation = bun_core::heap::alloc_nn(Operation {
        shared: Shared {
            state: AtomicU8::new(0),
            waker: UnsafeCell::new(None),
            value: UnsafeCell::new(None),
            dealloc: Operation::<T, F, G>::dealloc,
        },
        task: PoolTask {
            node: Default::default(),
            callback: Operation::<T, F, G>::run,
        },
        work: UnsafeCell::new(Some((work, in_flight))),
    });
    // SAFETY: live until both sides have let go of it; the pool has `task` and `work` from here.
    submit(unsafe { &raw mut (*operation.as_ptr()).task });
    Blocking {
        // `shared` is at offset 0.
        shared: operation.cast(),
        _not_send: PhantomData,
    }
}

impl<T, F, G> Operation<T, F, G>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
    G: InFlight,
{
    /// # Safety
    /// The pool's callback for the `task` of a live `Operation<T, F, G>`, once.
    unsafe fn run(task: *mut PoolTask) {
        // SAFETY: fn contract.
        let this: *mut Self = unsafe { bun_core::from_field_ptr!(Self, task, task) };
        // SAFETY: fn contract; `work` is the pool thread's.
        let (work, in_flight) = unsafe { (*(*this).work.get()).take() }.expect("runs once");
        // SAFETY: fn contract.
        let shared = unsafe { &(*this).shared };
        if shared.state.load(Ordering::Acquire) & FUTURE_GONE == 0 && !in_flight.is_cancelled() {
            let value = work();
            // SAFETY: the future reads `value` only after it sees `FINISHED`.
            unsafe { *shared.value.get() = Some(value) };
        } else {
            drop(work);
        }
        in_flight.before_finish();
        let state = shared.state.fetch_or(FINISHED, Ordering::AcqRel);
        if state & WAITING != 0 {
            // SAFETY: the future leaves `waker` alone between setting `WAITING` and seeing it clear.
            if let Some(waker) = unsafe { (*shared.waker.get()).take() } {
                waker.wake();
            }
        }
        // SAFETY: fn contract; nothing of `this` is used afterwards. From `this`, not
        // `shared`: whoever frees needs the provenance of the whole allocation.
        unsafe { let_go::<T>(NonNull::new_unchecked(this).cast(), POOL_GONE) };
        drop(in_flight);
    }

    /// # Safety
    /// `shared` heads an `Operation<T, F, G>` that both sides have let go of.
    unsafe fn dealloc(shared: NonNull<Shared<T>>) {
        // SAFETY: fn contract; allocated by `blocking`.
        unsafe { bun_core::heap::destroy(shared.cast::<Self>().as_ptr()) };
    }
}

/// # Safety
/// `side` is the caller's own flag, set once, and it does not use `shared` afterwards.
unsafe fn let_go<T>(shared: NonNull<Shared<T>>, side: u8) {
    // SAFETY: fn contract.
    let state = unsafe { shared.as_ref() }
        .state
        .fetch_or(side, Ordering::AcqRel);
    if (state | side) & (FUTURE_GONE | POOL_GONE) == FUTURE_GONE | POOL_GONE {
        // SAFETY: the other side let go first.
        unsafe { (shared.as_ref().dealloc)(shared) };
    }
}

impl<T> Future for Blocking<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        // SAFETY: live until `drop` lets go.
        let shared = unsafe { self.shared.as_ref() };
        // Takes `waker` back from the pool thread, unless it has finished.
        let state = shared.state.fetch_and(!WAITING, Ordering::AcqRel);
        if state & FINISHED == 0 {
            // SAFETY: `WAITING` is clear and this is the only thread that sets it.
            let waker = unsafe { &mut *shared.waker.get() };
            if !waker.as_ref().is_some_and(|w| w.will_wake(cx.waker())) {
                *waker = Some(cx.waker().clone());
            }
            if shared.state.fetch_or(WAITING, Ordering::AcqRel) & FINISHED == 0 {
                return Poll::Pending;
            }
        }
        // SAFETY: `FINISHED`: the pool thread has written `value` and is done with it.
        match unsafe { (*shared.value.get()).take() } {
            Some(value) => Poll::Ready(value),
            // Skipped (its loop is going away, and takes this future with it) or polled after it finished.
            None => Poll::Pending,
        }
    }
}

impl<T> Drop for Blocking<T> {
    fn drop(&mut self) {
        // SAFETY: the future's side, once.
        unsafe { let_go(self.shared, FUTURE_GONE) };
    }
}
