use bun_core::strings;
use bun_http_types::ETag::StringPointer;

use crate::Headers;
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
    /// `Some`: `Content-Length` framing, `buffer` gets exactly this many raw bytes.
    pub content_length: Option<u64>,
    /// Caller value (in the client's `header_buf`) to send instead of plain `chunked`.
    pub transfer_encoding: Option<StringPointer>,
}

/// Decided by the producer before the request is queued; the HTTP thread only prints it.
#[derive(Clone, Copy, Default)]
pub struct StreamFraming {
    pub content_length: Option<u64>,
    pub transfer_encoding: Option<StringPointer>,
}

pub enum InvalidStreamFraming<'a> {
    ContentLength(&'a [u8]),
    TransferEncoding(&'a [u8]),
}

impl StreamFraming {
    /// `Transfer-Encoding` ending in `chunked` wins, else `Content-Length`, else plain `chunked`.
    pub fn for_body(headers: &Headers) -> Result<StreamFraming, InvalidStreamFraming<'_>> {
        let content_length = match headers.get(b"content-length") {
            Some(value) => Some(
                content_length_for_framing(value)
                    .ok_or(InvalidStreamFraming::ContentLength(value))?,
            ),
            None => None,
        };
        if let Some(transfer_encoding) = headers.get_pointer(b"transfer-encoding") {
            let value = headers.as_str(transfer_encoding);
            if !transfer_encoding_ends_in_chunked(value) {
                return Err(InvalidStreamFraming::TransferEncoding(value));
            }
            return Ok(StreamFraming {
                content_length: None,
                transfer_encoding: Some(transfer_encoding),
            });
        }
        Ok(StreamFraming {
            content_length,
            transfer_encoding: None,
        })
    }

    /// An upgrade request's stream is the tunnel, not a body: nothing is validated.
    pub fn for_upgrade(headers: &Headers) -> StreamFraming {
        StreamFraming {
            content_length: headers
                .get(b"content-length")
                .and_then(content_length_for_framing),
            transfer_encoding: None,
        }
    }
}

/// `FetchHeaders` already trimmed OWS and joined duplicate rows (`5, 7`).
fn content_length_for_framing(value: &[u8]) -> Option<u64> {
    if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bun_core::parse_unsigned::<u64>(value, 10).ok()
}

/// A list of bare tokens whose final, and only the final, coding is `chunked` (RFC 9112 6.1).
fn transfer_encoding_ends_in_chunked(value: &[u8]) -> bool {
    let mut last_is_chunked = false;
    for element in strings::split(value, b",") {
        if last_is_chunked {
            return false;
        }
        let coding = strings::trim(element, b" \t");
        if coding.is_empty() || !coding.iter().copied().all(is_tchar) {
            return false;
        }
        last_is_chunked = strings::eql_case_insensitive_ascii(coding, b"chunked", true);
    }
    last_is_chunked
}

/// RFC 9110 5.6.2
fn is_tchar(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || strings::contains_char(b"!#$%&'*+-.^_`|~", byte)
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
