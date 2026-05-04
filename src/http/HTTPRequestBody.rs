use std::sync::Arc;

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
    pub buffer: Option<Arc<ThreadSafeStreamBuffer>>,
    pub ended: bool,
}

impl Stream {
    pub fn detach(&mut self) {
        if let Some(buffer) = self.buffer.take() {
            // Arc::drop decrements the refcount (matches `buffer.deref()`).
            drop(buffer);
        }
    }
}

impl HTTPRequestBody {
    pub fn is_stream(&self) -> bool {
        matches!(self, HTTPRequestBody::Stream(_))
    }

    // PORT NOTE: Zig `deinit` only called `stream.detach()` (drops the Arc) and was a
    // no-op for `.bytes` / `.sendfile`. Rust drops `Option<Arc<_>>` automatically, so
    // no explicit `Drop` impl is needed.

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
