use core::ffi::c_void;

use bun_io::StreamBuffer;
use bun_threading::guarded::GuardedLock;
use bun_threading::{Guarded, Mutex};

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct ThreadSafeStreamBuffer {
    state: Guarded<State>,
    /// Intrusive atomic refcount. Starts at 2: 1 for main thread and 1 for http thread.
    pub(crate) ref_count: bun_ptr::ThreadSafeRefCount<ThreadSafeStreamBuffer>,
}

/// What the main thread and the http thread share, reached through [`ThreadSafeStreamBuffer::lock`].
pub struct State {
    pub buffer: StreamBuffer,
    /// Called by the http thread when the buffer drains.
    callback: Option<Callback>,
}

pub struct Callback {
    pub(crate) callback: fn(*mut c_void),
    pub(crate) context: *mut c_void,
}

impl Callback {
    pub(crate) fn init<T>(callback: fn(*mut T), context: *mut T) -> Self {
        Self {
            // SAFETY: fn(*mut T) and fn(*mut c_void) have identical ABI;
            // `context` is only ever passed back to this callback, which
            // knows its real type.
            callback: unsafe { bun_ptr::cast_fn_ptr::<fn(*mut T), fn(*mut c_void)>(callback) },
            context: context.cast::<c_void>(),
        }
    }

    pub(crate) fn call(&self) {
        (self.callback)(self.context);
    }
}

impl ThreadSafeStreamBuffer {
    /// The http thread calls `callback(context)` when the buffer drains.
    /// The raw pointer carries both initial refs: the main thread adopts one into a
    /// `RefPtr`, the http thread keeps the other in `Stream::buffer` until `detach()`.
    pub fn new<T>(callback: fn(*mut T), context: *mut T) -> *mut Self {
        bun_core::heap::into_raw(Box::new(Self {
            state: Guarded::new(State {
                buffer: StreamBuffer::default(),
                callback: Some(Callback::init(callback, context)),
            }),
            // .initExactRefs(2) — 1 for main thread and 1 for http thread
            ref_count: bun_ptr::ThreadSafeRefCount::init_exact_refs(2),
        }))
    }

    /// Upgrade an attached intrusive-ref handle to `&Self`.
    ///
    /// INVARIANT: while `p` is held, the HTTP side owns one intrusive ref on
    /// the buffer (taken at attach, released in `Stream::detach`); the buffer
    /// is a separate heap allocation that outlives the returned borrow. The
    /// main thread holds a `&Self` too; all that either thread changes is
    /// inside the `Guarded` or atomic. Centralises the SAFETY argument shared by
    /// `http_request_body::Stream::buffer_ref` and `HTTPClient::write_to_stream`.
    #[inline]
    pub(crate) fn from_attached<'a>(p: core::ptr::NonNull<Self>) -> &'a Self {
        // SAFETY: see INVARIANT above.
        unsafe { p.as_ref() }
    }

    pub fn deref(this: core::ptr::NonNull<Self>) {
        // SAFETY: `this` is a live heap allocation produced by `new`.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this.as_ptr()) };
    }

    /// Locks the mutex; the guard unlocks it on `Drop`.
    #[inline]
    pub fn lock(&self) -> GuardedLock<'_, State, Mutex> {
        self.state.lock()
    }

    /// Main thread; the request may still be in flight on the http thread.
    pub fn clear_drain_callback(&self) {
        self.lock().callback = None;
    }
}

impl State {
    /// This is exclusively called from the http thread.
    pub(crate) fn report_drain(&self) {
        if self.buffer.is_empty() {
            if let Some(callback) = &self.callback {
                callback.call();
            }
        }
    }
}
