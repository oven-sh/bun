use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_io::StreamBuffer;
use bun_threading::Mutex;

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct ThreadSafeStreamBuffer {
    pub(crate) buffer: StreamBuffer,
    pub(crate) mutex: Mutex,
    /// Intrusive atomic refcount. Starts at 2: 1 for main thread and 1 for http thread.
    pub(crate) ref_count: bun_ptr::ThreadSafeRefCount<ThreadSafeStreamBuffer>,
    /// Called by the http thread when the buffer drains; guarded by `mutex`, like `buffer`.
    callback: Option<Callback>,
    /// The producer wrote its last byte. Set once, after that byte is in `buffer`.
    ended: AtomicBool,
    /// The producer's byte count missed the declared `Content-Length`. Set once.
    length_mismatch: AtomicBool,
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

impl Default for ThreadSafeStreamBuffer {
    fn default() -> Self {
        Self {
            buffer: StreamBuffer::default(),
            mutex: Mutex::default(),
            // .initExactRefs(2) — 1 for main thread and 1 for http thread
            ref_count: bun_ptr::ThreadSafeRefCount::init_exact_refs(2),
            callback: None,
            ended: AtomicBool::new(false),
            length_mismatch: AtomicBool::new(false),
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

    /// A buffer that only the http thread holds; the main thread takes its own ref when it is
    /// handed the buffer.
    pub(crate) fn new_for_http_thread() -> core::ptr::NonNull<Self> {
        let mut init = Self::default();
        init.ref_count = bun_ptr::ThreadSafeRefCount::init_exact_refs(1);
        core::ptr::NonNull::new(Self::new(init)).expect("Box::into_raw is never null")
    }

    /// Upgrade an attached intrusive-ref handle to `&mut Self`.
    ///
    /// INVARIANT: while `p` is held, the HTTP side owns one intrusive ref on
    /// the buffer (taken at attach, released in `Stream::detach`); the buffer
    /// is a separate heap allocation that outlives the returned borrow and is
    /// disjoint from any `&mut HTTPClient`/`&mut Stream`. HTTP-thread-only at
    /// every caller, so the `&mut` is the sole live borrow on this side of the
    /// internal lock. Centralises the SAFETY argument shared by
    /// `http_request_body::Stream::buffer_mut` and `HTTPClient::write_to_stream`.
    #[inline]
    pub(crate) fn from_attached<'a>(mut p: core::ptr::NonNull<Self>) -> &'a mut Self {
        // SAFETY: see INVARIANT above.
        unsafe { p.as_mut() }
    }

    pub fn deref(this: core::ptr::NonNull<Self>) {
        // SAFETY: `this` is a live heap allocation produced by `new`.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this.as_ptr()) };
    }

    /// Returns the buffer and whether the producer ended the body.
    pub(crate) fn acquire(&mut self) -> (&mut StreamBuffer, bool) {
        self.mutex.lock();
        // The mutex stays locked until `release()`. Prefer `lock()` (RAII
        // guard) for simple critical sections; this split form remains for
        // callers that interleave release with disjoint `self` access.
        (&mut self.buffer, self.ended.load(Ordering::Acquire))
    }

    pub(crate) fn release(&mut self) {
        self.mutex.unlock();
    }

    /// RAII spelling of `acquire()`/`release()` — locks the mutex and returns a
    /// guard that derefs to the inner `StreamBuffer` and unlocks on `Drop`.
    /// Use this instead of a bare `acquire`/`release` pair so the lock is
    /// released on every return path.
    #[inline]
    pub fn lock(&mut self) -> StreamBufferGuard<'_> {
        self.mutex.lock();
        StreamBufferGuard(self)
    }

    /// Should only be called in the main thread and before scheduling it to the http thread
    pub fn set_drain_callback<T>(&mut self, callback: fn(*mut T), context: *mut T) {
        self.callback = Some(Callback::init(callback, context));
    }

    /// Main thread, for a buffer that the http thread made and already uses.
    pub fn set_drain_callback_shared<T>(&mut self, callback: fn(*mut T), context: *mut T) {
        let _guard = self.mutex.lock_guard();
        self.callback = Some(Callback::init(callback, context));
    }

    /// Main thread; the request may still be in flight on the http thread.
    pub fn clear_drain_callback(&mut self) {
        let _guard = self.mutex.lock_guard();
        self.callback = None;
    }

    /// Main thread: the body is complete once `trailer` (a chunked terminator, or nothing) is sent.
    pub fn end(&mut self, trailer: &[u8]) {
        if !trailer.is_empty() {
            let _ = self.lock().write(trailer); // OOM/capacity: fire-and-forget
        }
        self.ended.store(true, Ordering::Release);
    }

    /// Main thread: the bytes written do not add up to the declared `Content-Length`.
    pub fn fail_length_mismatch(&self) {
        self.length_mismatch.store(true, Ordering::Release);
    }

    /// Http thread.
    pub(crate) fn has_length_mismatch(&self) -> bool {
        self.length_mismatch.load(Ordering::Acquire)
    }

    /// This is exclusively called from the http thread.
    /// Buffer must be acquired before calling this.
    pub(crate) fn report_drain(&self) {
        debug_assert!(self.mutex.is_held_by_current_thread());
        if self.buffer.is_empty() {
            if let Some(callback) = &self.callback {
                callback.call();
            }
        }
    }
}

/// RAII guard returned by [`ThreadSafeStreamBuffer::lock`]. Derefs to the
/// protected `StreamBuffer` and releases the mutex on `Drop`.
pub struct StreamBufferGuard<'a>(&'a mut ThreadSafeStreamBuffer);

impl core::ops::Deref for StreamBufferGuard<'_> {
    type Target = StreamBuffer;
    #[inline]
    fn deref(&self) -> &StreamBuffer {
        &self.0.buffer
    }
}

impl core::ops::DerefMut for StreamBufferGuard<'_> {
    #[inline]
    fn deref_mut(&mut self) -> &mut StreamBuffer {
        &mut self.0.buffer
    }
}

impl Drop for StreamBufferGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        self.0.mutex.unlock();
    }
}
