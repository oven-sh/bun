use crate::SendFile;
use crate::ThreadSafeStreamBuffer;

/// Request body payload. Parameterized over `'a` so callers can hand in
/// stack-/arena-borrowed bytes without the `&'static` transmute that the
/// Phase-A port used at every `AsyncHTTP::init` call site.
pub enum HTTPRequestBody<'a> {
    /// Borrowed bytes — caller guarantees they outlive the request.
    Bytes(&'a [u8]),
    /// Owned bytes — the request takes ownership (e.g. a serialized JSON body
    /// built on the fly). Freed when the body is dropped.
    Owned(Vec<u8>),
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
            HTTPRequestBody::Owned(bytes) => bytes.as_slice(),
            _ => b"",
        }
    }

    pub fn len(&self) -> usize {
        match self {
            HTTPRequestBody::Bytes(bytes) => bytes.len(),
            HTTPRequestBody::Owned(bytes) => bytes.len(),
            HTTPRequestBody::Sendfile(sendfile) => sendfile.content_size,
            // unknown amounts
            HTTPRequestBody::Stream(_) => usize::MAX,
        }
    }
}

// ported from: src/http/HTTPRequestBody.zig
