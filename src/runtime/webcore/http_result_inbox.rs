//! Where the HTTP thread leaves the results of a request for the JS thread.

use core::cell::{Cell, UnsafeCell};
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::IntrusiveField;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, Taskable};
use bun_http::signals::Store;
use bun_http::{AsyncHTTP, FinishedRequest, HTTPClientResult, HTTPClientResultCallback};
use bun_jsc::script_execution_context::AbortHandleOwner;
use bun_jsc::{AbortHandle, JsThread, Ticket};
use bun_ptr::{AliasableBox, RefCounted, RefPtr};
use bun_threading::Guarded;
use bun_threading::guarded::GuardedLock;

/// What the JS thread has not taken yet. The HTTP thread calls the method, under the lock.
pub(crate) trait StoreResult: Send + 'static {
    /// Returns whether to post the owner's task. The last result always does.
    fn store_result(&mut self, signal_store: &Store, result: &mut HTTPClientResult<'_>) -> bool;
}

/// The only part of its owner that the callbacks reach.
pub(crate) struct HttpResultInbox<R> {
    pub(crate) signal_store: Store,
    state: Guarded<State<R>>,
    /// Only the HTTP thread uses it once the request is scheduled.
    ticket: UnsafeCell<Option<Ticket>>,
    /// Not written once the request is scheduled, except for its atomic link.
    concurrent_task: ConcurrentTask,
    /// As `concurrent_task`, for when the buffer of the request body has drained.
    drain_task: ConcurrentTask,
    /// `drain_task` is posted, or about to be, and `take_drain` has not run for it.
    is_drain_posted: AtomicBool,
    /// JS thread. The last `take` left the request's ref to the posted `drain_task`.
    drain_owns_ref: Cell<bool>,
}

struct State<R> {
    received: R,
    /// `concurrent_task` is posted, or about to be, and `take` has not run for it.
    is_posted: bool,
    /// The HTTP thread is done with the inbox, except for the post.
    is_done: bool,
}

pub(crate) struct ReceivedGuard<'a, R>(GuardedLock<'a, State<R>>);

impl<R> Deref for ReceivedGuard<'_, R> {
    type Target = R;
    fn deref(&self) -> &R {
        &self.0.received
    }
}

impl<R> DerefMut for ReceivedGuard<'_, R> {
    fn deref_mut(&mut self) -> &mut R {
        &mut self.0.received
    }
}

impl<R: StoreResult> HttpResultInbox<R> {
    pub(crate) fn new(signal_store: Store, received: R) -> Self {
        Self {
            signal_store,
            state: Guarded::new(State {
                received,
                is_posted: false,
                is_done: false,
            }),
            ticket: UnsafeCell::new(None),
            concurrent_task: ConcurrentTask::default(),
            drain_task: ConcurrentTask::default(),
            is_drain_posted: AtomicBool::new(false),
            drain_owns_ref: Cell::new(false),
        }
    }

    pub(crate) fn lock(&self) -> ReceivedGuard<'_, R> {
        ReceivedGuard(self.state.lock())
    }

    /// The request owns the first ref; the last `take` or `take_drain` adopts it.
    #[track_caller]
    pub(crate) fn schedule<T>(
        cx: &JsThread<'_>,
        owner: Box<T>,
        drain_task: Option<fn(*mut T) -> Task>,
        build: impl for<'a> FnOnce(&'a RefPtr<T>) -> Box<AsyncHTTP<'a>>,
    ) where
        T: RefCounted + Taskable + AbortHandleOwner + IntrusiveField<Self> + 'static,
    {
        let owner = RefPtr::from(AliasableBox::from(owner));
        // SAFETY: it came in a `Box`, so nothing else uses the field.
        let this = unsafe {
            let this = <T as IntrusiveField<Self>>::field_of(owner.as_ptr());
            (*this).concurrent_task.from(owner.as_ptr());
            if let Some(drain_task) = drain_task {
                (*this).drain_task.task = drain_task(owner.as_ptr());
            }
            this
        };
        let request = build(&owner);
        let mut callback = HTTPClientResultCallback::new_with_release(
            this,
            Self::on_result,
            Self::release_at_shutdown,
        );
        if drain_task.is_some() {
            callback = callback.with_drain(Self::on_drain);
        }
        // SAFETY: `*owner` is on the heap and drops its handle with itself. The request borrows from
        // it at most, and the ref leaked below keeps it alive until `is_done`, which is set after the
        // request is dropped. The callbacks touch only `state` (locked), the atomics, `ticket` and the
        // two queue nodes.
        unsafe {
            // The context aborts the request when it stops, and the VM waits for the ticket.
            *(*this).ticket.get() = Some(cx.vm().ticket());
            AbortHandle::arm_owner(owner.as_ptr(), cx.context());
            AsyncHTTP::schedule(request, callback);
        }
        owner.into_raw();
    }

    /// Passes `f` a ref on `owner` and what the inbox has received, locked.
    ///
    /// # Safety
    /// `owner` is the pointer of the task that the inbox of a scheduled `T` posted for a result, and
    /// that left the queue. Called once per post.
    pub(crate) unsafe fn take<T, U>(
        owner: *mut T,
        f: impl for<'a> FnOnce(&'a RefPtr<T>, ReceivedGuard<'a, R>) -> U,
    ) -> U
    where
        T: RefCounted + IntrusiveField<Self>,
    {
        // SAFETY: the request's ref is held until the last task adopts it. The guard does not outlive
        // the call of `f`.
        let this = unsafe { &*<T as IntrusiveField<Self>>::field_of(owner) };
        let mut state = this.state.lock();
        state.is_posted = false;
        if state.is_done {
            let is_drain_posted = this.is_drain_posted.load(Ordering::Relaxed);
            this.drain_owns_ref.set(is_drain_posted);
        }
        // SAFETY: as above. Nothing is posted after the task that sees `is_done`.
        let owner = unsafe {
            if state.is_done && !this.drain_owns_ref.get() {
                RefPtr::from_raw(owner)
            } else {
                RefPtr::init_ref(owner)
            }
        };
        f(&owner, ReceivedGuard(state))
    }

    /// # Safety
    /// As [`Self::take`], for a drain.
    pub(crate) unsafe fn take_drain<T>(owner: *mut T) -> RefPtr<T>
    where
        T: RefCounted + IntrusiveField<Self>,
    {
        // SAFETY: the last `take` has not run, or it left the request's ref to this task.
        unsafe {
            let this = &*<T as IntrusiveField<Self>>::field_of(owner);
            this.is_drain_posted.store(false, Ordering::Release);
            if this.drain_owns_ref.get() {
                RefPtr::from_raw(owner)
            } else {
                RefPtr::init_ref(owner)
            }
        }
    }

    /// # Safety
    /// HTTP thread. `this` is the inbox of a scheduled request that has not had its last result. The
    /// last result comes with the request, or after it was dropped.
    unsafe fn on_result(
        this: *mut Self,
        finished: Option<FinishedRequest>,
        mut result: HTTPClientResult<'_>,
    ) {
        drop(finished);
        let is_done = !result.has_more;
        // SAFETY: `this` is live until a task sees `is_done`, under the lock. If one was posted, the
        // unlock is the last access. If not, the post is, and the ticket has left by then.
        unsafe {
            let ticket = UnsafeCell::raw_get(&raw const (*this).ticket);
            let last_ticket = if is_done { (*ticket).take() } else { None };
            let should_post = Guarded::with_lock_raw(&raw const (*this).state, |state| {
                let wants_post =
                    (state.received).store_result(&(*this).signal_store, &mut result) || is_done;
                state.is_done = is_done;
                wants_post && !core::mem::replace(&mut state.is_posted, true)
            });
            if should_post {
                let ticket = if is_done { &last_ticket } else { &*ticket };
                (ticket.as_ref())
                    .expect("held until the last result")
                    .post_intrusive(NonNull::new_unchecked(&raw mut (*this).concurrent_task));
            }
        }
    }

    /// # Safety
    /// As [`Self::on_result`].
    unsafe fn on_drain(this: *mut ()) {
        let this = this.cast::<Self>();
        // SAFETY: fn contract; `this` is live until the last result.
        unsafe {
            if !(*this).is_drain_posted.swap(true, Ordering::Acquire) {
                ((*(*this).ticket.get()).as_ref())
                    .expect("held until the last result")
                    .post_intrusive(NonNull::new_unchecked(&raw mut (*this).drain_task));
            }
        }
    }

    /// # Safety
    /// As [`Self::on_result`]. The request was dropped.
    unsafe fn release_at_shutdown(this: *mut ()) {
        let result = HTTPClientResult {
            fail: Some(bun_http::Error::Aborted),
            ..Default::default()
        };
        // SAFETY: fn contract.
        unsafe { Self::on_result(this.cast(), None, result) };
    }
}
