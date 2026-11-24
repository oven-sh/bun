//! Destinations for text. After a failed allocation a text is shorter than the sum of the appends.

use crate::common::memory::{
    Appendable, try_extend_from_slice, try_resize, try_with_capacity, try_zeroed,
};
use crate::common::slice_ext::SliceExt;
use crate::common::utf16;
use crate::common::utypes::{U_MEMORY_ALLOCATION_ERROR, UErrorCode};
use std::mem::take;
use std::ops::Range;

/// The length up to which a text needs no allocation.
pub(crate) const US_STACKBUF_SIZE: usize = 31 - size_of::<usize>() / 2;

/// A text on the heap that outgrows this length becomes bogus.
pub(crate) const MAX_STRING_CAPACITY: usize = 0x7fff_fff5;

/// An append-only text.
pub(crate) trait TextSink<T: Copy>: Appendable<T> {
    /// Ignores a value above U+10FFFF. A surrogate is written like any other code point.
    #[inline(always)]
    fn add_code_point(&mut self, c: u32)
    where
        T: From<u16>,
    {
        match c {
            ..=0xffff => self.add((c as u16).into()),
            0x1_0000..=0x10_ffff => self.add_all(&[utf16::lead(c).into(), utf16::trail(c).into()]),
            _ => {}
        }
    }
}

/// A UTF-16 text that can be read and changed.
pub(crate) trait TextBuf: TextSink<u16> {
    fn len(&self) -> usize;
    fn as_slice(&self) -> &[u16];
    fn truncate(&mut self, len: usize);

    fn assign(&mut self, text: &[u16]) {
        self.truncate(0);
        self.add_all(text);
    }
}

/// A text whose storage can be borrowed for direct writes.
pub(crate) trait BufferAccess: TextBuf {
    /// Returns the buffer and an empty `Vec` if the text and `count` more units fit in it, else `[]` and the heap text.
    fn get_buffer(&mut self, count: usize) -> Result<(&mut [u16], Vec<u16>), UErrorCode>;
    /// Takes the new length and the `Vec`, unallocated if the text is still in the buffer. `None`: it could not grow.
    fn release_buffer(&mut self, text: Option<(usize, Vec<u16>)>);
}

impl BufferAccess for Vec<u16> {
    fn get_buffer(&mut self, count: usize) -> Result<(&mut [u16], Vec<u16>), UErrorCode> {
        self.reserve_append(count)?;
        Ok((&mut [], take(self)))
    }

    fn release_buffer(&mut self, text: Option<(usize, Vec<u16>)>) {
        *self = text.unwrap_or_default().1;
    }
}

impl<T: Copy> TextSink<T> for Vec<T> {}

impl TextBuf for Vec<u16> {
    #[inline(always)]
    fn len(&self) -> usize {
        Vec::len(self)
    }

    #[inline(always)]
    fn as_slice(&self) -> &[u16] {
        self
    }

    #[inline(always)]
    fn truncate(&mut self, len: usize) {
        Vec::truncate(self, len);
    }
}

/// A text in a buffer, which moves to the heap when it outgrows that. If it cannot grow it is bogus: empty and unchangeable.
pub(crate) struct WritableAlias<'a> {
    buffer: &'a mut [u16],
    len: usize,
    /// The text in state `Heap`, else empty.
    heap: Vec<u16>,
    state: State,
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    Buffer,
    Heap,
    Bogus,
}

/// The final state of a `WritableAlias`.
pub(crate) enum AliasEnd {
    /// Holds the length of the text.
    InBuffer(usize),
    Spilled(Vec<u16>),
    Bogus,
}

impl<'a> WritableAlias<'a> {
    /// The first `len` units of `buffer` are the text.
    pub(crate) fn new(buffer: &'a mut [u16], len: usize) -> Self {
        Self {
            len: len.min(buffer.len()),
            buffer,
            heap: Vec::new(),
            state: State::Buffer,
        }
    }

    pub(crate) fn is_bogus(&self) -> bool {
        self.state == State::Bogus
    }

    #[cold]
    fn set_to_bogus(&mut self) {
        (self.len, self.heap, self.state) = (0, Vec::new(), State::Bogus);
    }

    /// Ends the borrow of the buffer.
    #[inline]
    pub(crate) fn end(self) -> AliasEnd {
        match self.state {
            State::Buffer => AliasEnd::InBuffer(self.len),
            State::Heap => AliasEnd::Spilled(self.heap),
            State::Bogus => AliasEnd::Bogus,
        }
    }

    /// Returns the text, or `None` if it is stored in the buffer. A bogus text is empty.
    pub(crate) fn into_heap(self) -> Option<Vec<u16>> {
        (self.state != State::Buffer).then_some(self.heap)
    }

    #[inline(always)]
    pub(crate) fn as_mut_slice(&mut self) -> &mut [u16] {
        if self.state == State::Buffer {
            self.buffer.slice_mut(..self.len)
        } else {
            &mut self.heap
        }
    }

    /// Moves `[at, len)` up by `count` units. The contents of the gap are unspecified.
    pub(crate) fn open_gap(&mut self, at: usize, count: usize) -> Result<(), UErrorCode> {
        if self.spare(count).is_none() {
            return self.grow_on_heap(count, |heap| {
                let len = heap.len();
                try_resize(heap, len.saturating_add(count), 0)?;
                heap.move_within(at.min(len)..len, at.min(len) + count);
                Ok(())
            });
        }
        let at = at.min(self.len);
        self.buffer.move_within(at..self.len, at + count);
        self.len += count;
        Ok(())
    }

    /// Moves the text to the heap if the buffer cannot take `count` more units.
    fn reserve_capacity(&mut self, count: usize) -> Result<(), UErrorCode> {
        if self.spare(count).is_some() {
            Ok(())
        } else {
            self.grow_on_heap(count, |_| Ok(()))
        }
    }

    /// Returns the next `count` units of the buffer, or `None` if the text is not stored there or they do not fit.
    #[inline(always)]
    fn spare(&mut self, count: usize) -> Option<&mut [u16]> {
        let in_buffer = self.state == State::Buffer;
        self.buffer
            .get_mut(self.len..)
            .and_then(|rest| rest.get_mut(..count))
            .filter(|_| in_buffer)
    }

    /// Moves the text to the heap if necessary, then calls `grow`, which adds up to `count` units.
    #[inline(always)]
    fn grow_on_heap(
        &mut self,
        count: usize,
        grow: impl FnOnce(&mut Vec<u16>) -> Result<(), UErrorCode>,
    ) -> Result<(), UErrorCode> {
        let needed = self.len.saturating_add(count);
        let moved = if self.state == State::Heap && needed <= MAX_STRING_CAPACITY {
            Ok(())
        } else {
            self.spill(needed)
        };
        let grown = moved.and_then(|()| grow(&mut self.heap));
        self.len = self.heap.len();
        grown.inspect_err(|_| self.set_to_bogus())
    }

    #[cold]
    fn spill(&mut self, needed: usize) -> Result<(), UErrorCode> {
        if self.is_bogus() || needed > MAX_STRING_CAPACITY {
            return Err(U_MEMORY_ALLOCATION_ERROR);
        }
        (self.heap, self.state) = (try_with_capacity(needed.max(256))?, State::Heap);
        try_extend_from_slice(&mut self.heap, self.buffer.slice(..self.len))
    }

    #[inline(never)]
    fn append_on_heap(&mut self, text: &[u16]) {
        _ = self.grow_on_heap(text.len(), |heap| try_extend_from_slice(heap, text));
    }
}

impl TextSink<u16> for WritableAlias<'_> {}

impl Appendable<u16> for WritableAlias<'_> {
    #[inline(always)]
    fn add(&mut self, unit: u16) {
        self.add_all(&[unit]);
    }

    #[inline(always)]
    fn add_all(&mut self, text: &[u16]) {
        let Some(spare) = self.spare(text.len()) else {
            return self.append_on_heap(text);
        };
        spare.copy_from_slice(text);
        self.len += text.len();
    }
}

impl TextBuf for WritableAlias<'_> {
    #[inline(always)]
    fn len(&self) -> usize {
        self.len
    }

    #[inline(always)]
    fn as_slice(&self) -> &[u16] {
        if self.state == State::Buffer {
            self.buffer.slice(..self.len)
        } else {
            &self.heap
        }
    }

    #[inline(always)]
    fn truncate(&mut self, len: usize) {
        self.len = self.len.min(len);
        self.heap.truncate(len);
    }
}

impl BufferAccess for WritableAlias<'_> {
    #[inline]
    fn get_buffer(&mut self, count: usize) -> Result<(&mut [u16], Vec<u16>), UErrorCode> {
        self.reserve_capacity(count)?;
        Ok(if self.state == State::Buffer {
            (self.buffer, Vec::new())
        } else {
            (&mut [], take(&mut self.heap))
        })
    }

    #[inline]
    fn release_buffer(&mut self, text: Option<(usize, Vec<u16>)>) {
        let Some((len, heap)) = text else {
            return self.set_to_bogus();
        };
        debug_assert!(heap.capacity() != 0 || len <= self.buffer.len());
        self.len = len;
        if heap.capacity() != 0 {
            (self.heap, self.state) = (heap, State::Heap);
        }
    }
}

/// Returns `stack` if it holds `count` units, else allocates `count` zeros in `heap` and returns them.
pub(crate) fn stack_or_heap<'a>(
    count: usize,
    stack: &'a mut [u16],
    heap: &'a mut Vec<u16>,
) -> Result<&'a mut [u16], UErrorCode> {
    if count <= stack.len() {
        return Ok(stack);
    }
    if count > MAX_STRING_CAPACITY {
        return Err(U_MEMORY_ALLOCATION_ERROR);
    }
    *heap = try_zeroed(count)?;
    Ok(heap)
}

pub(crate) fn replace(
    text: &mut WritableAlias,
    range: Range<usize>,
    new: &[u16],
) -> Result<(), UErrorCode> {
    let len = text.len();
    let start = range.start.min(len);
    let end = range.end.clamp(start, len);
    let new_end = start + new.len();
    if new_end > end {
        text.open_gap(end, new_end - end)?;
    } else if new_end < end {
        text.as_mut_slice().move_within(end..len, new_end);
        text.truncate(len - (end - new_end));
    }
    text.as_mut_slice().copy_at(start, new);
    Ok(())
}

/// A buffer that stores as many units as fit, and counts all units.
pub(crate) struct CheckedArraySink<'a, T> {
    buffer: &'a mut [T],
    length: usize,
}

impl<'a, T: Copy> CheckedArraySink<'a, T> {
    pub(crate) fn new(buffer: &'a mut [T]) -> Self {
        Self { buffer, length: 0 }
    }

    /// The length of the whole text, whether or not it fits.
    pub(crate) fn length(&self) -> usize {
        self.length
    }

    /// Call `advance` after writing to the result.
    #[inline]
    pub(crate) fn unwritten(&mut self) -> &mut [T] {
        self.buffer
            .split_at_mut(self.length.min(self.buffer.len()))
            .1
    }

    pub(crate) fn advance(&mut self, units: usize) {
        self.length = self.length.saturating_add(units);
    }

    /// Stores nothing unless all of `piece` fits.
    #[inline]
    pub(crate) fn add_exact_iter(&mut self, piece: impl ExactSizeIterator<Item = T>) {
        let units = piece.len();
        if let Some(slots) = self.unwritten().get_mut(..units) {
            slots
                .iter_mut()
                .zip(piece)
                .for_each(|(slot, unit)| *slot = unit);
        }
        self.advance(units);
    }
}

impl<T: Copy> TextSink<T> for CheckedArraySink<'_, T> {}

impl<T: Copy> Appendable<T> for CheckedArraySink<'_, T> {
    #[inline]
    fn add(&mut self, unit: T) {
        if let Some(slot) = self.buffer.get_mut(self.length) {
            *slot = unit;
        }
        self.advance(1);
    }

    #[inline]
    fn add_all(&mut self, text: &[T]) {
        let spare = self.unwritten();
        let fits = text.len().min(spare.len());
        spare.copy_at(0, text.slice(..fits));
        self.advance(text.len());
    }
}
