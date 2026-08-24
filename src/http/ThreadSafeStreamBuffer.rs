use std::sync::Arc;

use bun_io::StreamBuffer;
use bun_threading::{Guarded, GuardedLock, Mutex};

/// Told (on the HTTP thread, with the buffer lock held) that the buffer drained.
pub trait DrainHandler: Send + Sync {
    fn on_drain(&self);
}

/// What the lock protects: the bytes, and the JS side's drain hook.
pub struct StreamBufferState {
    pub buffer: StreamBuffer,
    /// Called by the http thread when the buffer drains.
    callback: Option<Arc<dyn DrainHandler>>,
}

impl core::ops::Deref for StreamBufferState {
    type Target = StreamBuffer;
    #[inline]
    fn deref(&self) -> &StreamBuffer {
        &self.buffer
    }
}

impl core::ops::DerefMut for StreamBufferState {
    #[inline]
    fn deref_mut(&mut self) -> &mut StreamBuffer {
        &mut self.buffer
    }
}

impl StreamBufferState {
    /// This is exclusively called from the http thread, with the lock held
    /// (which having `&mut self` proves).
    pub(crate) fn report_drain(&mut self) {
        if self.buffer.is_empty() {
            if let Some(callback) = &self.callback {
                callback.on_drain();
            }
        }
    }
}

/// A request-body byte buffer the JS thread fills and the HTTP thread drains,
/// each side holding one counted reference.
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct ThreadSafeStreamBuffer {
    state: Guarded<StreamBufferState>,
    pub(crate) ref_count: bun_ptr::ThreadSafeRefCount<ThreadSafeStreamBuffer>,
}

/// RAII guard returned by [`ThreadSafeStreamBuffer::lock`]. Derefs (twice) to
/// the protected `StreamBuffer` and releases the mutex on `Drop`.
pub type StreamBufferGuard<'a> = GuardedLock<'a, StreamBufferState, Mutex>;

impl ThreadSafeStreamBuffer {
    /// A new buffer with one reference (the caller's). The HTTP side takes its
    /// own through [`crate::http_request_body::Stream::attach`].
    pub fn create(drain_handler: Arc<dyn DrainHandler>) -> bun_ptr::RefPtr<Self> {
        bun_ptr::RefPtr::new(Self {
            state: Guarded::new(StreamBufferState {
                buffer: StreamBuffer::default(),
                callback: Some(drain_handler),
            }),
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
        })
    }

    /// Locks the buffer; the guard derefs to it and unlocks on `Drop`.
    #[inline]
    pub fn lock(&self) -> StreamBufferGuard<'_> {
        self.state.lock()
    }

    /// Main thread; the request may still be in flight on the http thread.
    pub fn clear_drain_callback(&self) {
        self.state.lock().callback = None;
    }
}
