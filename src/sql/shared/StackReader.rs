use core::cell::Cell;

use bun_core::strings;

use super::data::Data;

/// Supplies the protocol error enum's "buffer exhausted" variant for
/// [`StackReader`]'s fallible reads.
pub trait ShortRead {
    const SHORT_READ: Self;
}

/// Wraps a [`StackReader`] in the protocol's reader type ([`StackReader::init`]).
pub trait WrapReader<'a>: Sized {
    fn wrap(reader: StackReader<'a>) -> Self;
}

/// Accepts either `&Cell<usize>` or `&mut usize` as a cursor slot in
/// [`StackReader::init`].
pub trait IntoCursor<'a> {
    fn into_cursor(self) -> &'a Cell<usize>;
}

impl<'a> IntoCursor<'a> for &'a Cell<usize> {
    fn into_cursor(self) -> &'a Cell<usize> {
        self
    }
}

impl<'a> IntoCursor<'a> for &'a mut usize {
    fn into_cursor(self) -> &'a Cell<usize> {
        Cell::from_mut(self)
    }
}

/// Cursor over a borrowed wire buffer. `Cell`-based so copies share the
/// offset and callers can read the cursor back after a short read.
#[derive(Clone, Copy)]
pub struct StackReader<'a> {
    pub buffer: &'a [u8],
    pub offset: &'a Cell<usize>,
    pub message_start: &'a Cell<usize>,
    /// Absolute offset one past the current packet's last body byte; reads at
    /// or past it are a protocol error, not a short read. `usize::MAX` means
    /// "no packet framed yet" (header decode, or a protocol that tracks its
    /// own message lengths like Postgres).
    pub packet_end: &'a Cell<usize>,
}

impl<'a> StackReader<'a> {
    pub fn init<R: WrapReader<'a>>(
        buffer: &'a [u8],
        offset: impl IntoCursor<'a>,
        message_start: impl IntoCursor<'a>,
        packet_end: impl IntoCursor<'a>,
    ) -> R {
        R::wrap(StackReader {
            buffer,
            offset: offset.into_cursor(),
            message_start: message_start.into_cursor(),
            packet_end: packet_end.into_cursor(),
        })
    }

    pub fn mark_message_start(&self) {
        self.message_start.set(self.offset.get());
        self.packet_end.set(usize::MAX);
    }

    pub fn set_packet_end_from_start(&self, packet_length: usize) {
        self.packet_end
            .set(self.message_start.get().saturating_add(packet_length));
    }

    pub fn clear_packet_end(&self) {
        self.packet_end.set(usize::MAX);
    }

    pub fn packet_remaining(&self) -> usize {
        let end = self.packet_end.get();
        if end == usize::MAX {
            return usize::MAX;
        }
        end.saturating_sub(self.offset.get())
    }

    pub fn set_offset_from_start(&self, offset: usize) {
        self.offset.set(self.message_start.get() + offset);
    }

    pub fn ensure_capacity(&self, length: usize) -> bool {
        self.offset
            .get()
            .checked_add(length)
            .is_some_and(|end| self.buffer.len() >= end)
    }

    pub fn peek(&self) -> &'a [u8] {
        &self.buffer[self.offset.get()..]
    }

    /// Clamps to `[0, buffer.len()]` in both directions.
    pub fn skip(&self, count: isize) {
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

    pub fn read<E: ShortRead>(&self, count: usize) -> Result<Data, E> {
        let offset = self.offset.get();
        if !self.ensure_capacity(count) {
            return Err(E::SHORT_READ);
        }

        self.offset.set(offset + count);
        Ok(Data::Temporary(bun_ptr::RawSlice::new(
            &self.buffer[offset..offset + count],
        )))
    }

    pub fn read_z<E: ShortRead>(&self) -> Result<Data, E> {
        let remaining = self.peek();
        if let Some(zero) = strings::index_of_char(remaining, 0) {
            let zero = zero as usize;
            self.skip(isize::try_from(zero + 1).expect("int cast"));
            return Ok(Data::Temporary(bun_ptr::RawSlice::new(&remaining[0..zero])));
        }

        Err(E::SHORT_READ)
    }
}
