use crate::SendFile;
use crate::ThreadSafeStreamBuffer;

/// A request body as the caller supplies it: bytes it keeps alive for `'a`
/// (the request's lifetime, see [`crate::AsyncHTTP`]), a file to send, or a
/// stream it feeds.
pub enum HTTPRequestBody<'a> {
    Bytes(&'a [u8]),
    Sendfile(SendFile),
    Stream(Stream),
}

impl Default for HTTPRequestBody<'_> {
    fn default() -> Self {
        HTTPRequestBody::Bytes(b"")
    }
}

impl HTTPRequestBody<'_> {
    /// This body with the caller's `'a` erased into the promise every queued
    /// request makes: the caller keeps the bytes alive until the terminal
    /// result.
    pub(crate) fn erase(self) -> Body {
        match self {
            HTTPRequestBody::Bytes(bytes) => Body::Bytes(bun_ptr::RawSlice::new(bytes)),
            HTTPRequestBody::Sendfile(sendfile) => Body::Sendfile(sendfile),
            HTTPRequestBody::Stream(stream) => Body::Stream(stream),
        }
    }
}

/// The HTTP thread's working copy of a request body (lifetime-erased: the
/// caller keeps `Bytes` alive until the terminal result).
pub(crate) enum Body {
    Bytes(bun_ptr::RawSlice<u8>),
    Sendfile(SendFile),
    Stream(Stream),
}

impl Default for Body {
    fn default() -> Self {
        Self::EMPTY
    }
}

/// The HTTP side's handle on a streamed request body: one counted reference
/// on the shared buffer, released on drop / [`Stream::detach`].
pub struct Stream {
    pub buffer: Option<bun_ptr::RefPtr<ThreadSafeStreamBuffer>>,
    pub ended: bool,
}

impl Stream {
    /// Another handle on `buffer`, holding its own reference.
    pub fn attach(buffer: &bun_ptr::RefPtr<ThreadSafeStreamBuffer>) -> Stream {
        Stream {
            buffer: Some(buffer.dupe_ref()),
            ended: false,
        }
    }

    #[inline]
    pub(crate) fn buffer(&self) -> Option<&ThreadSafeStreamBuffer> {
        self.buffer.as_deref()
    }

    pub(crate) fn detach(&mut self) {
        if let Some(buffer) = self.buffer.take() {
            buffer.deref();
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        self.detach();
    }
}

impl Body {
    pub(crate) const EMPTY: Self = Body::Bytes(bun_ptr::RawSlice::EMPTY);

    /// The HTTP thread's own handle on this body: the same bytes / file, or
    /// another reference on the stream buffer.
    pub(crate) fn clone_for_thread(&self) -> Self {
        match self {
            Body::Bytes(bytes) => Body::Bytes(*bytes),
            Body::Sendfile(sendfile) => Body::Sendfile(*sendfile),
            Body::Stream(stream) => Body::Stream(Stream {
                buffer: stream.buffer.as_ref().map(|b| b.dupe_ref()),
                ended: stream.ended,
            }),
        }
    }

    pub(crate) fn is_stream(&self) -> bool {
        matches!(self, Body::Stream(_))
    }

    /// Borrow the in-memory byte payload, if any. `Sendfile` / `Stream` have no
    /// contiguous slice and return `b""` (callers branch on the variant before
    /// reaching for this).
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            Body::Bytes(bytes) => bytes.slice(),
            _ => b"",
        }
    }

    pub(crate) fn len(&self) -> usize {
        match self {
            Body::Bytes(bytes) => bytes.len(),
            Body::Sendfile(sendfile) => sendfile.content_size,
            // unknown amounts
            Body::Stream(_) => usize::MAX,
        }
    }
}
