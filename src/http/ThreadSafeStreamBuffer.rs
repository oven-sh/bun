use core::ffi::c_void;

use bun_io::StreamBuffer;
use bun_threading::Mutex;

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct ThreadSafeStreamBuffer {
    pub buffer: StreamBuffer,
    pub mutex: Mutex,
    /// Intrusive atomic refcount. Starts at 2: 1 for main thread and 1 for http thread.
    pub ref_count: bun_ptr::ThreadSafeRefCount<ThreadSafeStreamBuffer>,
    /// callback will be called passing the context for the http callback
    /// this is used to report when the buffer is drained and only if end chunk was not sent/reported
    pub callback: Option<Callback>,
}

pub struct Callback {
    pub callback: fn(*mut c_void),
    pub context: *mut c_void,
}

impl Callback {
    pub fn init<T>(callback: fn(*mut T), context: *mut T) -> Self {
        Self {
            // SAFETY: fn(*mut T) and fn(*mut c_void) have identical ABI; the
            // Zig side uses @ptrCast on a comptime fn param. `context` is only
            // ever passed back to this callback, which knows its real type.
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
            buffer: StreamBuffer::default(),
            mutex: Mutex::default(),
            // .initExactRefs(2) — 1 for main thread and 1 for http thread
            ref_count: bun_ptr::ThreadSafeRefCount::init_exact_refs(2),
            callback: None,
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

    pub fn ref_(this: *mut Self) {
        // SAFETY: `this` is a live heap allocation produced by `new`.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::ref_(this) };
    }

    pub fn deref(this: *mut Self) {
        // SAFETY: `this` is a live heap allocation produced by `new`.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this) };
    }

    pub fn acquire(&mut self) -> &mut StreamBuffer {
        self.mutex.lock();
        // PORT NOTE: reshaped for borrowck — Zig returns &this.buffer while the
        // mutex stays locked until `release()`. Prefer `lock()` (RAII guard) for
        // simple critical sections; this split form remains for callers that
        // interleave release with disjoint `self` access.
        &mut self.buffer
    }

    pub fn release(&mut self) {
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

    pub fn clear_drain_callback(&mut self) {
        self.callback = None;
    }

    /// This is exclusively called from the http thread.
    /// Buffer should be acquired before calling this.
    pub fn report_drain(&self) {
        if self.buffer.is_empty() {
            if let Some(callback) = &self.callback {
                callback.call();
            }
        }
    }
}

/// RAII guard returned by [`ThreadSafeStreamBuffer::lock`]. Derefs to the
/// protected `StreamBuffer` and releases the mutex on `Drop` (Zig:
/// `const buf = sb.acquire(); defer sb.release();`).
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

// ported from: src/http/ThreadSafeStreamBuffer.zig
