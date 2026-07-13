use bun_collections::{ByteVecExt, VecExt};
use bun_core::strings;

/// Buffer for newline-delimited data that tracks scan positions to avoid O(n²) scanning.
/// Each byte is scanned exactly once. We track:
/// - newline_pos: position of first known newline (if any)
/// - scanned_pos: how far we've scanned (bytes before this have been checked)
/// - head: offset into the buffer where unconsumed data starts (avoids copying on each consume)
///
/// When data arrives, we only scan the NEW bytes.
/// When we consume a message, we just advance `head` instead of copying.
/// Compaction only happens when head exceeds a threshold.
#[derive(Default)]
pub struct JSONLineBuffer {
    pub data: Vec<u8>,
    /// Offset into data where unconsumed content starts.
    pub head: u32,
    /// Position of a known upcoming newline relative to head, if any.
    pub newline_pos: Option<u32>,
    /// How far we've scanned for newlines relative to head.
    pub scanned_pos: u32,
    /// Sticky: a position exceeded the u32 design limit (peer buffered a
    /// >4 GiB line). The buffer is unusable; callers treat it as too-long.
    overflow: bool,
}

/// Return type of [`JSONLineBuffer::next`]: a complete message slice plus its newline offset.
pub struct Next<'a> {
    pub data: &'a [u8],
    pub newline_pos: u32,
}

impl JSONLineBuffer {
    /// Compact the buffer when head exceeds this threshold.
    const COMPACTION_THRESHOLD: u32 = 16 * 1024 * 1024; // 16 MB

    /// Get the active (unconsumed) portion of the buffer.
    fn active_slice(&self) -> &[u8] {
        &self.data.slice()[self.head as usize..]
    }

    /// Scan for newline in unscanned portion of the buffer.
    fn scan_for_newline(&mut self) {
        if self.overflow || self.newline_pos.is_some() {
            return;
        }
        let slice = self.active_slice();
        if self.scanned_pos as usize >= slice.len() {
            return;
        }

        let unscanned = &slice[self.scanned_pos as usize..];
        if let Some(local_idx) = strings::index_of_char_usize(unscanned, b'\n') {
            // `pos == u32::MAX` would overflow the `idx + 1` consumers downstream.
            match u32::try_from(self.scanned_pos as usize + local_idx) {
                Ok(pos) if pos < u32::MAX => {
                    self.newline_pos = Some(pos);
                    self.scanned_pos = pos + 1; // Only scanned up to (and including) the newline
                }
                _ => self.overflow = true,
            }
        } else {
            match u32::try_from(slice.len()) {
                Ok(n) => self.scanned_pos = n, // No newline, scanned everything
                Err(_) => self.overflow = true,
            }
        }
    }

    /// Compact the buffer by moving data to the front. Called when head exceeds threshold.
    fn compact(&mut self) {
        if self.head == 0 {
            return;
        }
        self.data.drain_front(self.head as usize);
        self.head = 0;
    }

    /// Append bytes to the buffer, scanning only new data for newline.
    pub fn append(&mut self, bytes: &[u8]) {
        let _ = self.data.write(bytes);
        self.scan_for_newline();
    }

    /// True once buffered positions exceeded the u32 design limit (a >4 GiB
    /// line); the pending message can never be decoded.
    pub fn overflowed(&self) -> bool {
        self.overflow
    }

    /// Returns the next complete message (up to and including newline) if available.
    pub fn next(&self) -> Option<Next<'_>> {
        if self.overflow {
            return None;
        }
        let pos = self.newline_pos?;
        Some(Next {
            data: &self.active_slice()[0..(pos as usize) + 1],
            newline_pos: pos,
        })
    }

    /// Consume bytes from the front of the buffer after processing a message.
    /// Just advances head offset - no copying until compaction threshold is reached.
    pub fn consume(&mut self, bytes: u32) {
        self.head = match self.head.checked_add(bytes) {
            Some(h) => h,
            None => {
                self.overflow = true;
                return;
            }
        };

        // Adjust scanned_pos (subtract consumed bytes, but don't go negative)
        self.scanned_pos = self.scanned_pos.saturating_sub(bytes);

        // Adjust newline_pos
        if let Some(pos) = self.newline_pos {
            if bytes > pos {
                // Consumed past the known newline - clear it and scan for next
                self.newline_pos = None;
                self.scan_for_newline();
            } else {
                self.newline_pos = Some(pos - bytes);
            }
        }

        // Check if we've consumed everything
        if self.head as usize >= self.data.len() {
            // Free memory if capacity exceeds threshold, otherwise just reset
            if self.data.capacity() as u32 >= Self::COMPACTION_THRESHOLD {
                self.data = Vec::<u8>::default();
            } else {
                self.data.clear();
            }
            self.head = 0;
            self.scanned_pos = 0;
            self.newline_pos = None;
            return;
        }

        // Compact if head exceeds threshold to avoid unbounded memory growth
        if self.head >= Self::COMPACTION_THRESHOLD {
            self.compact();
        }
    }

    pub fn is_empty(&self) -> bool {
        self.head as usize >= self.data.len()
    }

    /// Notify the buffer that `nread` bytes were written directly into the
    /// tail of `data` (via `data.uv_alloc_spare_u8()`).
    ///
    /// Takes a length, not a `&[u8]`, because the only caller's slice would
    /// alias `&mut self.data` — and only the length is used here. Passing the
    /// slice through would re-introduce the Stacked-Borrows hazard the
    /// `on_read` refactor removed.
    pub fn notify_written(&mut self, nread: usize) {
        // SAFETY: caller (libuv on_read) wrote `nread` bytes into the uv_alloc_spare* slice.
        unsafe { self.data.uv_commit(nread) };
        self.scan_for_newline();
    }
}

// `pub fn deinit` dropped: Vec<u8>'s Drop frees the backing allocation (global mimalloc).
