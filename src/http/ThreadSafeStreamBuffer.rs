use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_io::StreamBuffer;
use bun_threading::{Guarded, GuardedLock, Mutex};

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct ThreadSafeStreamBuffer {
    /// The shared byte buffer lives INSIDE the lock: both the JS thread and
    /// the HTTP thread reach it through `&self` + `lock()`, so neither side
    /// ever forms a `&mut ThreadSafeStreamBuffer` that the other's writes
    /// would alias.
    pub buffer: Guarded<StreamBuffer>,
    /// Intrusive atomic refcount. Starts at 2: 1 for main thread and 1 for http thread.
    pub ref_count: bun_ptr::ThreadSafeRefCount<ThreadSafeStreamBuffer>,
    /// callback will be called passing the context for the http callback
    /// this is used to report when the buffer is drained and only if end chunk was not sent/reported
    /// Set on the JS thread before the buffer is published to the HTTP thread
    /// (`set_drain_callback`); cleared only after the HTTP side detached.
    pub callback: Option<Callback>,
    /// Sticky end-of-body flag, set by the JS thread before it schedules the
    /// End wake-up. Senders latch it via `Stream::sync_ended` so an End that
    /// arrives while the request has no live stream/socket is never lost.
    ended: AtomicBool,
}

pub struct Callback {
    pub callback: fn(*mut c_void),
    pub context: *mut c_void,
}

impl Callback {
    pub fn init<T>(callback: fn(*mut T), context: *mut T) -> Self {
        Self {
            // SAFETY: fn(*mut T) and fn(*mut c_void) have identical ABI;
            // `context` is only ever passed back to this callback, which
            // knows its real type.
            callback: unsafe { bun_ptr::cast_fn_ptr::<fn(*mut T), fn(*mut c_void)>(callback) },
            context: context.cast::<c_void>(),
        }
    }

    pub fn call(&self) {
        (self.callback)(self.context);
    }
}

impl Default for ThreadSafeStreamBuffer {
    fn default() -> Self {
        Self {
            buffer: Guarded::new(StreamBuffer::default()),
            // .initExactRefs(2) — 1 for main thread and 1 for http thread
            ref_count: bun_ptr::ThreadSafeRefCount::init_exact_refs(2),
            callback: None,
            ended: AtomicBool::new(false),
        }
    }
}

impl ThreadSafeStreamBuffer {
    /// `bun.TrivialNew(@This())` — heap-allocate with the given field values.
    /// Callers on both threads hold raw `*mut ThreadSafeStreamBuffer` and
    /// release via `deref()`, so return a raw pointer (heap::alloc).
    pub fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    /// Upgrade an attached intrusive-ref handle to `&Self`.
    ///
    /// INVARIANT: while `p` is held, the HTTP side owns one intrusive ref on
    /// the buffer (taken at attach, released in `Stream::detach`); the buffer
    /// is a separate heap allocation that outlives the returned borrow.
    /// Shared (never `&mut`): the JS thread holds concurrent `&Self` borrows
    /// of the same allocation — all mutation goes through `lock()`/atomics.
    #[inline]
    pub(crate) fn from_attached<'a>(p: core::ptr::NonNull<Self>) -> &'a Self {
        // SAFETY: see INVARIANT above.
        unsafe { p.as_ref() }
    }

    pub fn ref_(this: core::ptr::NonNull<Self>) {
        // SAFETY: `this` is a live heap allocation produced by `new`.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::ref_(this.as_ptr()) };
    }

    pub fn deref(this: core::ptr::NonNull<Self>) {
        // SAFETY: `this` is a live heap allocation produced by `new`.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this.as_ptr()) };
    }

    /// Lock the shared buffer. The returned guard derefs to the inner
    /// `StreamBuffer` and unlocks on `Drop`.
    #[inline]
    pub fn lock(&self) -> GuardedLock<'_, StreamBuffer, Mutex> {
        self.buffer.lock()
    }

    /// JS thread: mark end-of-body. Release pairs with the Acquire in
    /// `is_ended` so the final buffered bytes are visible with the flag.
    pub fn mark_ended(&self) {
        self.ended.store(true, Ordering::Release);
    }

    /// HTTP thread: read the sticky end-of-body flag (see `mark_ended`).
    pub fn is_ended(&self) -> bool {
        self.ended.load(Ordering::Acquire)
    }

    /// Should only be called in the main thread and before scheduling it to the http thread
    pub fn set_drain_callback<T>(&mut self, callback: fn(*mut T), context: *mut T) {
        self.callback = Some(Callback::init(callback, context));
    }

    /// Main thread only, and only after the HTTP side detached (its ref was
    /// released in `Stream::detach`), so no concurrent `report_drain` reads.
    pub fn clear_drain_callback(&mut self) {
        self.callback = None;
    }

    /// This is exclusively called from the http thread. `buffer` must be the
    /// view of this buffer's own `lock()` guard — the drain check has to
    /// happen while the lock is still held.
    pub fn report_drain(&self, buffer: &StreamBuffer) {
        if buffer.is_empty() {
            if let Some(callback) = &self.callback {
                callback.call();
            }
        }
    }
}
