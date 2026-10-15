use bun_http_types::ETag::StringPointer;
use bun_http_types::parse_content_length_strict;

use crate::Encoding;
use crate::Headers;
use crate::SendFile;
use crate::ThreadSafeStreamBuffer;
use crate::fold_transfer_encoding;

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
    pub framing: StreamFraming,
}

/// Decided by the producer before the request is queued; the HTTP thread only prints it.
#[derive(Clone, Copy, Default)]
pub struct StreamFraming {
    /// `Some`: `Content-Length` framing, the buffer gets exactly this many raw bytes.
    pub content_length: Option<u64>,
    /// Caller value (in the client's `header_buf`) to send instead of plain `chunked`.
    pub transfer_encoding: Option<StringPointer>,
}

pub struct InvalidFramingHeader<'a> {
    pub name: &'static str,
    pub value: &'a [u8],
}

impl StreamFraming {
    /// `Transfer-Encoding` ending in `chunked` wins, else `Content-Length`, else plain `chunked`.
    pub fn for_body(headers: &Headers) -> Result<StreamFraming, InvalidFramingHeader<'_>> {
        let content_length = headers
            .get(b"content-length")
            .map(|value| {
                parse_content_length_strict(value).ok_or(InvalidFramingHeader {
                    name: "Content-Length",
                    value,
                })
            })
            .transpose()?;
        let Some(transfer_encoding) = headers.get_pointer(b"transfer-encoding") else {
            return Ok(StreamFraming {
                content_length,
                transfer_encoding: None,
            });
        };
        let value = headers.as_str(transfer_encoding);
        let mut coding = Encoding::Identity;
        if fold_transfer_encoding(value, &mut coding).is_err() || coding != Encoding::Chunked {
            return Err(InvalidFramingHeader {
                name: "Transfer-Encoding",
                value,
            });
        }
        Ok(StreamFraming {
            content_length: None,
            transfer_encoding: Some(transfer_encoding),
        })
    }

    /// An upgrade request's stream is the tunnel, not a body: nothing is validated.
    pub fn for_upgrade(headers: &Headers) -> StreamFraming {
        StreamFraming {
            content_length: headers
                .get(b"content-length")
                .and_then(parse_content_length_strict),
            transfer_encoding: None,
        }
    }
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
