use core::cell::UnsafeCell;
use std::sync::Arc;

use bun_io::StreamBuffer;
use bun_threading::Mutex;

/// Told (on the HTTP thread, with the buffer lock held) that the buffer drained.
pub trait DrainHandler: Send + Sync {
    fn on_drain(&self);
}

/// A request-body byte buffer the JS thread fills and the HTTP thread drains,
/// each side holding one counted reference.
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct ThreadSafeStreamBuffer {
    /// Guarded by `mutex`.
    buffer: UnsafeCell<StreamBuffer>,
    pub(crate) mutex: Mutex,
    pub(crate) ref_count: bun_ptr::ThreadSafeRefCount<ThreadSafeStreamBuffer>,
    /// Called by the http thread when the buffer drains; guarded by `mutex`, like `buffer`.
    callback: UnsafeCell<Option<Arc<dyn DrainHandler>>>,
}

// SAFETY: `buffer` and `callback` are only reached with `mutex` held (the
// guard types below, and the HTTP thread's `acquire`/`release` bracket).
unsafe impl Sync for ThreadSafeStreamBuffer {}
// SAFETY: owned fields are `Send`; the handler is `Send + Sync`.
unsafe impl Send for ThreadSafeStreamBuffer {}

impl ThreadSafeStreamBuffer {
    /// A new buffer with one reference (the caller's). The HTTP side takes its
    /// own through [`crate::http_request_body::Stream::attach`].
    pub fn create(drain_handler: Arc<dyn DrainHandler>) -> bun_ptr::RefPtr<Self> {
        bun_ptr::RefPtr::new(Self {
            buffer: UnsafeCell::new(StreamBuffer::default()),
            mutex: Mutex::default(),
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            callback: UnsafeCell::new(Some(drain_handler)),
        })
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
        // SAFETY: `this` is a live heap allocation produced by `create`.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this.as_ptr()) };
    }

    pub(crate) fn acquire(&mut self) -> &mut StreamBuffer {
        self.mutex.lock();
        // The mutex stays locked until `release()`. Prefer `lock()` (RAII
        // guard) for simple critical sections; this split form remains for
        // callers that interleave release with disjoint `self` access.
        self.buffer.get_mut()
    }

    /// The buffer, for a caller between [`acquire`](Self::acquire) and
    /// [`release`](Self::release).
    pub(crate) fn buffer_held(&mut self) -> &mut StreamBuffer {
        debug_assert!(self.mutex.is_held_by_current_thread());
        self.buffer.get_mut()
    }

    pub(crate) fn release(&mut self) {
        self.mutex.unlock();
    }

    /// Locks the buffer; the guard derefs to it and unlocks on `Drop`.
    #[inline]
    pub fn lock(&self) -> StreamBufferGuard<'_> {
        self.mutex.lock();
        StreamBufferGuard(self)
    }

    /// Main thread; the request may still be in flight on the http thread.
    pub fn clear_drain_callback(&self) {
        let _guard = self.mutex.lock_guard();
        // SAFETY: `callback` is guarded by `mutex`, which we hold.
        unsafe { *self.callback.get() = None };
    }

    /// This is exclusively called from the http thread.
    /// Buffer must be acquired before calling this.
    pub(crate) fn report_drain(&mut self) {
        debug_assert!(self.mutex.is_held_by_current_thread());
        if self.buffer.get_mut().is_empty() {
            if let Some(callback) = self.callback.get_mut() {
                callback.on_drain();
            }
        }
    }
}

/// RAII guard returned by [`ThreadSafeStreamBuffer::lock`]. Derefs to the
/// protected `StreamBuffer` and releases the mutex on `Drop`.
pub struct StreamBufferGuard<'a>(&'a ThreadSafeStreamBuffer);

impl core::ops::Deref for StreamBufferGuard<'_> {
    type Target = StreamBuffer;
    #[inline]
    fn deref(&self) -> &StreamBuffer {
        // SAFETY: the guard holds `mutex`, which guards `buffer`.
        unsafe { &*self.0.buffer.get() }
    }
}

impl core::ops::DerefMut for StreamBufferGuard<'_> {
    #[inline]
    fn deref_mut(&mut self) -> &mut StreamBuffer {
        // SAFETY: the guard holds `mutex`, which guards `buffer`.
        unsafe { &mut *self.0.buffer.get() }
    }
}

impl Drop for StreamBufferGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        self.0.mutex.unlock();
    }
}
