use bun_collections::{ByteVecExt, VecExt};
use bun_core::strings;

/// Buffer for newline-delimited data that tracks scan positions to avoid O(n²) scanning.
/// Each byte is scanned exactly once. We track:
/// - newline_pos: position of first known newline (if any)
/// - scanned_pos: how far we've scanned (bytes before this have been checked)
/// - head: offset into the buffer where unconsumed data starts (avoids copying on each consume)
/// - held: length of the complete lines at head that are kept for later; the scan goes on behind them
///
/// When data arrives, we only scan the NEW bytes.
/// When we consume a message, we just advance `head` instead of copying.
/// Compaction only happens when head exceeds a threshold.
#[derive(Default)]
pub(crate) struct JSONLineBuffer {
    pub(crate) data: Vec<u8>,
    /// Offset into data where unconsumed content starts.
    head: u32,
    /// Length of the complete lines at `head` that are kept. The two positions below are relative to their end.
    held: u32,
    /// Position of a known upcoming newline, if any.
    newline_pos: Option<u32>,
    /// How far we've scanned for newlines.
    scanned_pos: u32,
    /// Maximum line length, not counting the newline. Capped so a line plus its newline fits in a `u32`.
    max_line: u32,
    /// True once a line exceeds `max_line`. The buffer is freed and later bytes are dropped.
    too_long: bool,
}

impl JSONLineBuffer {
    /// Compact the buffer when head exceeds this threshold.
    const COMPACTION_THRESHOLD: u32 = 16 * 1024 * 1024; // 16 MB

    pub(crate) fn new(max_line: usize) -> Self {
        Self {
            // Consuming a line also consumes its newline, so `max_line + 1` must not overflow.
            max_line: max_line.min(u32::MAX as usize - 1) as u32,
            ..Self::default()
        }
    }

    /// Get the active portion of the buffer: the unconsumed bytes behind the held lines.
    fn active_slice(&self) -> &[u8] {
        &self.data.slice()[(self.head + self.held) as usize..]
    }

    pub(crate) fn held_len(&self) -> usize {
        self.held as usize
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// True if a line exceeded `max_line`. `next` returns `None` from then on.
    pub(crate) fn is_too_long(&self) -> bool {
        self.too_long
    }

    /// Scan the unscanned bytes for a newline, and reject the line if it's longer than `max_line`.
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
        // Without a newline, all the unconsumed bytes are one unfinished line.
        let line_len = newline.unwrap_or(slice.len());
        if line_len > self.max_line as usize {
            *self = Self::new(self.max_line as usize);
            self.too_long = true;
            return;
        }
        // `line_len <= max_line <= u32::MAX - 1`, so neither cast truncates.
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
        let _ = self.data.write(bytes);
        self.scan_for_newline();
    }

    /// Returns the next complete message (up to and including newline) if available.
    pub(crate) fn next(&self) -> Option<&[u8]> {
        let pos = self.newline_pos?;
        Some(&self.active_slice()[0..(pos as usize) + 1])
    }

    /// The scan positions are relative to the start of the next line, which moved `bytes` ahead.
    fn skip_scanned(&mut self, bytes: u32) {
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
    }

    /// Reset once everything is consumed, and compact once head exceeds the threshold.
    fn reclaim(&mut self) {
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

    /// Remove the line that `next` returned, after processing it.
    /// With no held lines this just advances head offset - no copying until compaction threshold is reached.
    pub(crate) fn remove(&mut self, bytes: u32) {
        if self.held == 0 {
            self.head = self.head.saturating_add(bytes);
        } else {
            let at = (self.head + self.held) as usize;
            self.data.drain(at..at + bytes as usize);
        }
        self.skip_scanned(bytes);
        self.reclaim();
    }

    /// Keep the line that `next` returned. The scan goes on behind it.
    pub(crate) fn hold(&mut self, bytes: u32) {
        self.held += bytes;
        self.skip_scanned(bytes);
    }

    /// The first held line, up to and including its newline.
    pub(crate) fn first_held(&self) -> Option<&[u8]> {
        let held = &self.data.slice()[self.head as usize..][..self.held as usize];
        let newline = strings::index_of_char_usize(held, b'\n')?;
        Some(&held[..=newline])
    }

    /// Consume the line that `first_held` returned.
    pub(crate) fn release(&mut self, bytes: u32) {
        self.head += bytes;
        self.held -= bytes;
        self.reclaim();
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
