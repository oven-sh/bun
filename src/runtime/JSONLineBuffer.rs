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
pub(crate) struct JSONLineBuffer {
    pub(crate) data: Vec<u8>,
    /// Offset into data where unconsumed content starts.
    pub(crate) head: u32,
    /// Position of a known upcoming newline relative to head, if any.
    pub(crate) newline_pos: Option<u32>,
    /// How far we've scanned for newlines relative to head.
    pub(crate) scanned_pos: u32,
    /// Longest line handed out, newline excluded. Capped so a line and its newline fit `u32`.
    max_line: u32,
    /// Sticky: a line passed `max_line`. The storage is freed and later bytes are dropped.
    too_long: bool,
}

/// Return type of [`JSONLineBuffer::next`]: a complete message slice plus its newline offset.
pub(crate) struct Next<'a> {
    pub(crate) data: &'a [u8],
    pub(crate) newline_pos: u32,
}

impl JSONLineBuffer {
    /// Compact the buffer when head exceeds this threshold.
    const COMPACTION_THRESHOLD: u32 = 16 * 1024 * 1024; // 16 MB

    pub(crate) fn new(max_line: usize) -> Self {
        Self {
            // One more byte would make the consumed count of a line at the limit overflow.
            max_line: max_line.min(u32::MAX as usize - 1) as u32,
            ..Self::default()
        }
    }

    /// Get the active (unconsumed) portion of the buffer.
    fn active_slice(&self) -> &[u8] {
        &self.data.slice()[self.head as usize..]
    }

    /// Whether a line passed `max_line`. The buffer hands out nothing after that.
    pub(crate) fn is_too_long(&self) -> bool {
        self.too_long
    }

    /// Refuse the over-long line and free the storage. `#[cold]` keeps the caller's scan inlined.
    #[cold]
    #[inline(never)]
    fn refuse(&mut self) {
        *self = Self::new(self.max_line as usize);
        self.too_long = true;
    }

    /// Scan the unscanned bytes for a newline, and refuse the line if it passed `max_line`.
    #[inline]
    fn scan_for_newline(&mut self) {
        if self.too_long || self.newline_pos.is_some() {
            return;
        }
        let slice = self.active_slice();
        if self.scanned_pos as usize >= slice.len() {
            return;
        }

        let unscanned = &slice[self.scanned_pos as usize..];
        let newline = strings::index_of_char_usize(unscanned, b'\n')
            .map(|local_idx| self.scanned_pos as usize + local_idx);
        // With no newline, the whole unconsumed part is one unfinished line.
        let line_len = newline.unwrap_or(slice.len());
        if line_len > self.max_line as usize {
            self.refuse();
            return;
        }
        // `line_len <= max_line <= u32::MAX - 1`, so both narrowings are exact.
        match newline {
            Some(pos) => {
                self.newline_pos = Some(pos as u32);
                self.scanned_pos = pos as u32 + 1; // Only scanned up to (and including) the newline
            }
            None => self.scanned_pos = line_len as u32, // No newline, scanned everything
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
    pub(crate) fn append(&mut self, bytes: &[u8]) {
        if self.too_long {
            return;
        }
        // Only a read that can cross `max_line` is judged before the copy, and pays a scan.
        if self.newline_pos.is_none() {
            // With no newline, every unconsumed byte is scanned and belongs to one line.
            let pending = self.scanned_pos as usize;
            debug_assert_eq!(pending, self.data.len() - self.head as usize);
            if pending + bytes.len() > self.max_line as usize {
                let line_len = strings::index_of_char_usize(bytes, b'\n')
                    .map_or(pending + bytes.len(), |local_idx| pending + local_idx);
                if line_len > self.max_line as usize {
                    self.refuse();
                    return;
                }
            }
        }
        let _ = self.data.write(bytes);
        self.scan_for_newline();
    }

    /// Returns the next complete message (up to and including newline) if available.
    pub(crate) fn next(&self) -> Option<Next<'_>> {
        let pos = self.newline_pos?;
        Some(Next {
            data: &self.active_slice()[0..(pos as usize) + 1],
            newline_pos: pos,
        })
    }

    /// Consume bytes from the front of the buffer after processing a message.
    /// Just advances head offset - no copying until compaction threshold is reached.
    pub(crate) fn consume(&mut self, bytes: u32) {
        self.head = self.head.saturating_add(bytes);

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

    /// Notify the buffer that `nread` bytes were written directly into the
    /// tail of `data` (via `data.uv_alloc_spare_u8()`).
    ///
    /// Takes a length, not a `&[u8]`, because the only caller's slice would
    /// alias `&mut self.data` — and only the length is used here. Passing the
    /// slice through would re-introduce the Stacked-Borrows hazard the
    /// `on_read` refactor removed.
    #[cfg(windows)]
    pub(crate) fn notify_written(&mut self, nread: usize) {
        // SAFETY: caller (libuv on_read) wrote `nread` bytes into the uv_alloc_spare* slice.
        unsafe { self.data.uv_commit(nread) };
        self.scan_for_newline();
    }
}

// `pub fn deinit` dropped: Vec<u8>'s Drop frees the backing allocation (global mimalloc).
