use crate::wire::{Frame, FrameError, Framed, Mode, advanced_frame, json_frame};
use bun_core::vec::drain_front;

/// Bytes that were read and not delivered.
pub struct Inbox {
    data: Vec<u8>,
    /// Kept here and not by the reader: a message handler can run the event loop, which reads on from it.
    start: usize,
    framing: Framing,
}

enum Framing {
    Advanced,
    Json { scanned: usize },
}

const RECLAIM_THRESHOLD: usize = 16 * 1024 * 1024;

impl Inbox {
    pub fn new(mode: Mode) -> Self {
        let framing = match mode {
            Mode::Advanced => Framing::Advanced,
            Mode::Json => Framing::Json { scanned: 0 },
        };
        Self {
            data: Vec::new(),
            start: 0,
            framing,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// The buffer to append what was read to.
    pub fn buffer(&mut self) -> &mut Vec<u8> {
        &mut self.data
    }

    /// Consumes the next frame, which `read` looks at. After an error the bytes mean nothing: drop `self`.
    pub fn next<R>(
        &mut self,
        max_string_len: usize,
        read: impl FnOnce(Frame<'_>) -> R,
    ) -> Result<Option<R>, FrameError> {
        let Some(frame) = self.peek(max_string_len)? else {
            if let Framing::Advanced = self.framing {
                self.compact();
            }
            return Ok(None);
        };
        let len = frame.len;
        let value = read(frame);
        self.consume(len);
        Ok(Some(value))
    }

    fn peek(&mut self, max_string_len: usize) -> Framed<'_> {
        let unread = &self.data[self.start..];
        match &mut self.framing {
            Framing::Advanced => advanced_frame(unread, max_string_len),
            Framing::Json { scanned } => json_frame(unread, scanned, max_string_len),
        }
    }

    fn consume(&mut self, len: usize) {
        self.start += len;
        if self.start == self.data.len() || self.start >= RECLAIM_THRESHOLD {
            self.compact();
        }
        if let Framing::Json { scanned } = &mut self.framing {
            *scanned = 0;
            if self.data.is_empty() && self.data.capacity() >= RECLAIM_THRESHOLD {
                self.data = Vec::new();
            }
        }
    }

    fn compact(&mut self) {
        drain_front(&mut self.data, core::mem::take(&mut self.start));
    }
}
