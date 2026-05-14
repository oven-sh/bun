use crate::SendFile;
use crate::ThreadSafeStreamBuffer;

/// Request body payload. Parameterized over `'a` so callers can hand in
/// stack-/arena-borrowed bytes without the `&'static` lifetime erasure the
/// Phase-A port used at every `AsyncHTTP::init` call site.
// PORT NOTE: no `Owned(Vec<u8>)` variant — the body is bitwise-copied across
// threads via `core::ptr::read` in `start_queued_task`, so every arm must be
// trivially-droppable. Zig has only `bytes` / `sendfile` / `stream`.
pub enum HTTPRequestBody<'a> {
    /// Borrowed bytes — caller guarantees they outlive the request.
    Bytes(&'a [u8]),
    Sendfile(SendFile),
    Stream(Stream),
}

pub struct Stream {
    // PORT NOTE: ThreadSafeStreamBuffer carries an *intrusive* atomic refcount and
    // is round-tripped as a raw pointer between the main thread and the HTTP
    // thread, so per §Pointers we keep the intrusive form (raw `*mut T` + manual
    // ref/deref) instead of `Arc<T>`.
    pub buffer: Option<core::ptr::NonNull<ThreadSafeStreamBuffer>>,
    pub ended: bool,
}

impl Stream {
    /// Mutable access to the JS-side `ThreadSafeStreamBuffer` while attached.
    ///
    /// INVARIANT: while `buffer` is `Some`, this `Stream` holds an intrusive
    /// ref on the `ThreadSafeStreamBuffer` (taken on attach, released in
    /// `detach`); the buffer is a separate heap allocation that outlives the
    /// returned borrow. HTTP-thread-only at the call sites, so the `&mut` is
    /// the sole live borrow on this side of the lock.
    #[inline]
    pub fn buffer_mut(&mut self) -> Option<&mut ThreadSafeStreamBuffer> {
        // Route through the shared `from_attached` accessor (one centralised
        // unsafe); see INVARIANT above.
        self.buffer.map(ThreadSafeStreamBuffer::from_attached)
    }

    pub fn detach(&mut self) {
        if let Some(buffer) = self.buffer.take() {
            // matches Zig `buffer.deref()` — intrusive refcount decrement.
            ThreadSafeStreamBuffer::deref(buffer.as_ptr());
        }
    }
}

// No `Drop` for `Stream`: the body is bitwise-copied across threads
// (`core::ptr::read` in `start_queued_task`), so auto-dropping the
// JS-thread original would over-deref the shared buffer. Mirrors Zig,
// where `HTTPRequestBody.deinit()` is explicit.

impl<'a> HTTPRequestBody<'a> {
    pub const EMPTY: HTTPRequestBody<'static> = HTTPRequestBody::Bytes(b"");

    /// `HTTPRequestBody.deinit()` — only the `Stream` arm owns a ref.
    pub fn deinit(&mut self) {
        if let HTTPRequestBody::Stream(stream) = self {
            stream.detach();
        }
    }

    pub fn is_stream(&self) -> bool {
        matches!(self, HTTPRequestBody::Stream(_))
    }

    /// Borrow the in-memory byte payload, if any. `Sendfile` / `Stream` have no
    /// contiguous slice and return `b""` (callers branch on the variant before
    /// reaching for this).
    pub fn slice(&self) -> &[u8] {
        match self {
            HTTPRequestBody::Bytes(bytes) => bytes,
            _ => b"",
        }
    }

    pub fn len(&self) -> usize {
        match self {
            HTTPRequestBody::Bytes(bytes) => bytes.len(),
            HTTPRequestBody::Sendfile(sendfile) => sendfile.content_size,
            // unknown amounts
            HTTPRequestBody::Stream(_) => usize::MAX,
        }
    }
}

// ported from: src/http/HTTPRequestBody.zig
