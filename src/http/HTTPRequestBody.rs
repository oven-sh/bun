use crate::SendFile;
use crate::ThreadSafeStreamBuffer;

pub enum HTTPRequestBody {
    // TODO(port): lifetime — Zig `[]const u8` is borrowed (deinit does not free it);
    // using &'static for Phase A per PORTING.md (no struct lifetime params).
    Bytes(&'static [u8]),
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

// Zig `deinit` calls `stream.detach()` to deref the intrusive count. The field
// is `NonNull<T>`, not `Arc<T>`, so this MUST be explicit — no auto-Drop covers it.
impl Drop for Stream {
    fn drop(&mut self) {
        self.detach();
    }
}

impl HTTPRequestBody {
    pub fn is_stream(&self) -> bool {
        matches!(self, HTTPRequestBody::Stream(_))
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/HTTPRequestBody.zig (38 lines)
//   confidence: high
//   todos:      1
//   notes:      Bytes payload borrowed (not freed in Zig deinit); revisit lifetime in Phase B.
// ──────────────────────────────────────────────────────────────────────────
