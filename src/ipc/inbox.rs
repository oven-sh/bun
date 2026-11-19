use crate::wire::{Body, Frame, FrameError, Framed, Mode, advanced_frame, json_frame};
use bun_core::vec::drain_front;

/// Bytes that were read and not delivered.
pub struct Inbox {
    data: Vec<u8>,
    /// Kept here and not by the reader: a message handler can run the event loop, which reads on from it.
    start: usize,
    framing: Framing,
}

enum Framing {
    /// `keep`: the capacity that messages split over reads needed.
    Advanced {
        keep: usize,
    },
    Json {
        scanned: usize,
    },
}

const RECLAIM_THRESHOLD: usize = 16 * 1024 * 1024;

impl Inbox {
    pub fn new(mode: Mode) -> Self {
        let framing = match mode {
            Mode::Advanced => Framing::Advanced { keep: 0 },
            Mode::Json => Framing::Json { scanned: 0 },
        };
        Self {
            data: Vec::new(),
            start: 0,
            framing,
        }
    }

    /// The buffer for a transport that reads into it.
    #[cfg(any(windows, test))]
    pub fn buffer(&mut self) -> &mut Vec<u8> {
        &mut self.data
    }

    /// Keeps a copy of `bytes` for [`Self::next`], except of a first frame that `read` can look at in place.
    #[inline]
    pub fn receive<R>(
        &mut self,
        bytes: &[u8],
        max_string_len: usize,
        read: impl FnOnce(Frame<Body<'_>>) -> R,
    ) -> Result<Option<R>, FrameError> {
        match &mut self.framing {
            Framing::Advanced { keep } => {
                if self.data.is_empty()
                    && let Some((frame, len)) = advanced_frame(bytes, max_string_len)?
                {
                    let value = read(frame);
                    self.data.extend_from_slice(&bytes[len..]);
                    return Ok(Some(value));
                }
                // No bytes: the transport read into the buffer.
                let unread = &self.data[self.start..];
                let is_nested_in_a_burst = !bytes.is_empty()
                    && matches!(advanced_frame(unread, max_string_len), Ok(Some(_)));
                self.data.extend_from_slice(bytes);
                if !is_nested_in_a_burst {
                    *keep = self.data.capacity();
                }
            }
            Framing::Json { .. } => self.data.extend_from_slice(bytes),
        }
        Ok(None)
    }

    /// Consumes the next frame, which `read` looks at.
    #[inline]
    pub fn next<R>(
        &mut self,
        max_string_len: usize,
        read: impl FnOnce(Frame<Body<'_>>) -> R,
    ) -> Result<Option<R>, FrameError> {
        let Some((frame, len)) = self.peek(max_string_len)? else {
            self.shrink();
            return Ok(None);
        };
        let value = read(frame);
        self.consume(len);
        Ok(Some(value))
    }

    #[inline(never)]
    fn shrink(&mut self) {
        match self.framing {
            Framing::Advanced { keep } => {
                self.compact();
                self.data.shrink_to(keep);
            }
            Framing::Json { .. } => {}
        }
    }

    #[inline]
    fn peek(&mut self, max_string_len: usize) -> Framed<'_> {
        let unread = &self.data[self.start..];
        match &mut self.framing {
            Framing::Advanced { .. } => advanced_frame(unread, max_string_len),
            Framing::Json { scanned } => json_frame(unread, scanned, max_string_len),
        }
    }

    #[inline]
    fn consume(&mut self, len: usize) {
        self.start += len;
        if self.start == self.data.len() || self.start >= RECLAIM_THRESHOLD {
            self.compact();
        }
        match &mut self.framing {
            Framing::Advanced { .. } => {}
            Framing::Json { scanned } => {
                *scanned = 0;
                if self.data.is_empty() && self.data.capacity() >= RECLAIM_THRESHOLD {
                    self.data = Vec::new();
                }
            }
        }
    }

    #[inline]
    fn compact(&mut self) {
        drain_front(&mut self.data, core::mem::take(&mut self.start));
    }
}
