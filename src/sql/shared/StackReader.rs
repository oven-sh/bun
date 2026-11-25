use core::cell::Cell;

use bun_core::strings;

/// Supplies the protocol error enum's "buffer exhausted" variant for
/// [`StackReader`]'s fallible reads.
pub(crate) trait ShortRead {
    const SHORT_READ: Self;
}

/// Cursor over a borrowed wire buffer. `Cell`-based so copies share the
/// offset and callers can read the cursor back after a short read.
#[derive(Clone, Copy)]
pub(crate) struct StackReader<'a> {
    pub(crate) buffer: &'a [u8],
    pub(crate) offset: &'a Cell<usize>,
    pub(crate) message_start: &'a Cell<usize>,
}

impl<'a> StackReader<'a> {
    pub(crate) fn mark_message_start(&self) {
        self.message_start.set(self.offset.get());
    }

    pub(crate) fn ensure_capacity(&self, length: usize) -> bool {
        self.offset
            .get()
            .checked_add(length)
            .is_some_and(|end| self.buffer.len() >= end)
    }

    pub(crate) fn peek(&self) -> &'a [u8] {
        &self.buffer[self.offset.get()..]
    }

    /// Clamps to `[0, buffer.len()]` in both directions.
    pub(crate) fn skip(&self, count: isize) {
        let offset = self.offset.get();
        if count < 0 {
            self.offset.set(offset.saturating_sub(count.unsigned_abs()));
            return;
        }

        let ucount = count.unsigned_abs();
        if offset + ucount > self.buffer.len() {
            self.offset.set(self.buffer.len());
            return;
        }

        self.offset.set(offset + ucount);
    }

    pub(crate) fn read<E: ShortRead>(&self, count: usize) -> Result<&'a [u8], E> {
        let offset = self.offset.get();
        if !self.ensure_capacity(count) {
            return Err(E::SHORT_READ);
        }

        self.offset.set(offset + count);
        Ok(&self.buffer[offset..offset + count])
    }

    pub(crate) fn read_z<E: ShortRead>(&self) -> Result<&'a [u8], E> {
        let remaining = self.peek();
        if let Some(zero) = strings::index_of_char(remaining, 0) {
            let zero = zero as usize;
            self.skip(isize::try_from(zero + 1).expect("int cast"));
            return Ok(&remaining[0..zero]);
        }

        Err(E::SHORT_READ)
    }
}
