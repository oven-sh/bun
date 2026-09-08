use crate::SendFile;
use crate::ThreadSafeStreamBuffer;

/// Request body payload. Parameterized over `'a` so callers can hand in
/// stack-/arena-borrowed bytes without erasing the lifetime to `&'static`
/// at every `AsyncHTTP::init` call site.
// No `Owned(Vec<u8>)` variant — the body is bitwise-copied across threads via
// `core::ptr::read` in `start_queued_task`, so every arm must be
// trivially-droppable.
pub enum HTTPRequestBody<'a> {
    /// Borrowed bytes — caller guarantees they outlive the request.
    Bytes(&'a [u8]),
    Sendfile(SendFile),
    Stream(Stream),
}

pub struct Stream {
    // ThreadSafeStreamBuffer carries an *intrusive* atomic refcount and is
    // round-tripped as a raw pointer between the main thread and the HTTP
    // thread, so we keep the intrusive form (raw pointer + manual ref/deref)
    // instead of `Arc<T>`.
    pub buffer: Option<core::ptr::NonNull<ThreadSafeStreamBuffer>>,
    pub ended: bool,
    /// The length the caller declared for this body (see
    /// [`content_length_for_framing`]). `Some` frames the body with
    /// `Content-Length` and the producer fills `buffer` with exactly this many
    /// raw bytes; `None` frames it with `Transfer-Encoding: chunked` and the
    /// producer writes chunk-encoded bytes. Decided once by the producer so the
    /// request head and the body bytes never disagree.
    pub content_length: Option<u64>,
}

/// Parses a caller `Content-Length` value that a [`Stream`] body can be framed
/// with: one non-empty run of ASCII digits that fits a `u64`. The body goes on
/// the wire unframed behind this count, so it has to be a count the producer can
/// honor byte for byte. `FetchHeaders` trims OWS and joins two caller rows into
/// `5, 7`, so every other form (`5, 7`, `+5`, `0x5`, `5.0`, `-1`, `abc`, a
/// count wider than `u64`) is a value no body can match and yields `None`.
pub fn content_length_for_framing(value: &[u8]) -> Option<u64> {
    if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bun_core::parse_unsigned::<u64>(value, 10).ok()
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
    pub(crate) fn buffer_mut(&mut self) -> Option<&mut ThreadSafeStreamBuffer> {
        // Route through the shared `from_attached` accessor (one centralised
        // unsafe); see INVARIANT above.
        self.buffer.map(ThreadSafeStreamBuffer::from_attached)
    }

    pub(crate) fn detach(&mut self) {
        if let Some(buffer) = self.buffer.take() {
            // Intrusive refcount decrement.
            // `buffer` is a live `ThreadSafeStreamBuffer::new` heap allocation;
            // this side holds the intrusive ref taken at attach, released here.
            ThreadSafeStreamBuffer::deref(buffer);
        }
    }
}

// No `Drop` for `Stream`: the body is bitwise-copied across threads
// (`core::ptr::read` in `start_queued_task`), so auto-dropping the
// JS-thread original would over-deref the shared buffer;
// `HTTPRequestBody::deinit()` is explicit instead.

impl<'a> HTTPRequestBody<'a> {
    /// `HTTPRequestBody.deinit()` — only the `Stream` arm owns a ref.
    pub(crate) fn deinit(&mut self) {
        if let HTTPRequestBody::Stream(stream) = self {
            stream.detach();
        }
    }

    pub(crate) fn is_stream(&self) -> bool {
        matches!(self, HTTPRequestBody::Stream(_))
    }

    /// Borrow the in-memory byte payload, if any. `Sendfile` / `Stream` have no
    /// contiguous slice and return `b""` (callers branch on the variant before
    /// reaching for this).
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            HTTPRequestBody::Bytes(bytes) => bytes,
            _ => b"",
        }
    }

    pub(crate) fn len(&self) -> usize {
        match self {
            HTTPRequestBody::Bytes(bytes) => bytes.len(),
            HTTPRequestBody::Sendfile(sendfile) => sendfile.content_size,
            // unknown amounts
            HTTPRequestBody::Stream(_) => usize::MAX,
        }
    }
}
