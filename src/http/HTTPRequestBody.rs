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
    /// `Some` frames the body with this `Content-Length` and the producer fills
    /// `buffer` with exactly that many raw bytes. `None` frames it with
    /// `Transfer-Encoding` and the producer writes chunk-encoded bytes. See
    /// [`StreamFraming`].
    pub content_length: Option<u64>,
    /// The `Transfer-Encoding` value to announce when `content_length` is `None`:
    /// the caller's own (final coding `chunked`), as a slice of the client's
    /// header buffer, or `None` for plain `chunked`.
    pub transfer_encoding: Option<StringPointer>,
}

/// How a [`Stream`] body is framed on the wire. The producer decides this once,
/// from the caller's `Content-Length` and `Transfer-Encoding`, before the
/// request is queued, fills the stream buffer to match, and hands the decision
/// to the HTTP thread in the [`Stream`]. The HTTP thread only prints it: it never
/// reads a framing header of a stream body out of the caller's headers, so the
/// request head and the body bytes cannot disagree.
#[derive(Clone, Copy, Default)]
pub struct StreamFraming {
    pub content_length: Option<u64>,
    pub transfer_encoding: Option<StringPointer>,
}

/// A caller framing header no stream body can be sent under. The slice is the
/// offending value.
pub enum InvalidStreamFraming<'a> {
    ContentLength(&'a [u8]),
    TransferEncoding(&'a [u8]),
}

impl StreamFraming {
    /// The framing of a stream body sent as an HTTP message body.
    ///
    /// - A `Transfer-Encoding` whose final coding is `chunked` is announced as
    ///   written, over the chunk-encoded bytes the producer writes. A
    ///   `Content-Length` next to it is neither sent nor counted.
    /// - Otherwise a `Content-Length` frames the raw bytes, and the producer
    ///   counts them against it.
    /// - With neither header the body goes out as plain `chunked`.
    ///
    /// Every other value describes framing the producer does not apply, so it is
    /// an error, not something to relabel: a `Content-Length` that is not a
    /// `u64` in ASCII digits, or a `Transfer-Encoding` that does not end in
    /// `chunked` (`gzip` alone would tell the peer the chunk-encoded bytes are a
    /// gzip stream).
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

    /// The framing of a stream that is the tunnel of an upgrade request, not a
    /// message body: nothing frames or counts its bytes, so nothing is
    /// validated. A `Content-Length` that parses is still announced.
    pub fn for_upgrade(headers: &Headers) -> StreamFraming {
        StreamFraming {
            content_length: headers
                .get(b"content-length")
                .and_then(content_length_for_framing),
            transfer_encoding: None,
        }
    }
}

/// A `Content-Length` value a [`Stream`] body can be framed with: one non-empty
/// run of ASCII digits that fits a `u64`. `FetchHeaders` has already trimmed OWS
/// and joined two caller rows into `5, 7`, so every other form (`5, 7`, `+5`,
/// `0x5`, `5.0`, `-1`, `abc`, a count wider than `u64`) is not a count.
fn content_length_for_framing(value: &[u8]) -> Option<u64> {
    if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bun_core::parse_unsigned::<u64>(value, 10).ok()
}

/// Whether `value` is a `Transfer-Encoding` list (RFC 9110 section 5.6.1:
/// comma-separated, OWS around each element) of bare transfer-coding tokens
/// whose final, and only the final, coding is `chunked` (RFC 9112 section 6.1).
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

/// RFC 9110 section 5.6.2 `tchar`.
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
