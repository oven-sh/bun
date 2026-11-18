use core::io::{BorrowedBuf, BorrowedCursor};
use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::ptr::NonNull;
use core::slice;

use bun_alloc::AllocError;

use crate::{CodeUnit, StringImpl, StringRef, Text, builder, copy, with_text};

/// Room for units, written from the front. A push that does not fit panics. A cursor is only ever lent, so whoever
/// lends it knows that what it has left behind is written.
pub struct Cursor<'a, T> {
    end: NonNull<MaybeUninit<T>>,
    /// From the end, so that a push changes nothing else.
    at: isize,
    room: PhantomData<(&'a mut [T], Brand<'a>)>,
}

/// No two cursors have the same lifetime, and it cannot be shortened.
type Brand<'a> = fn(&'a ()) -> &'a ();

/// Where a cursor has been.
#[derive(Clone, Copy)]
pub struct Mark<'a> {
    at: isize,
    cursor: PhantomData<Brand<'a>>,
}

impl<'a, T: CodeUnit> Cursor<'a, T> {
    /// Returns what `write` has written.
    #[inline(always)]
    pub fn fill_uninit(
        target: &mut [MaybeUninit<T>],
        write: impl FnOnce(&mut Cursor<'_, T>),
    ) -> &mut [T] {
        let capacity = target.len();
        let mut cursor = Cursor {
            // SAFETY: the end of the slice.
            end: unsafe { NonNull::from_mut(target).cast().add(capacity) },
            at: -(capacity as isize),
            room: PhantomData,
        };
        write(&mut cursor);
        let written = capacity - cursor.remaining();
        // SAFETY: the cursor has written what it has left behind.
        unsafe { target.get_unchecked_mut(..written).assume_init_mut() }
    }

    /// Returns how many units `write` has written.
    #[inline(always)]
    pub fn fill(target: &mut [T], write: impl FnOnce(&mut Cursor<'_, T>)) -> usize {
        // SAFETY: the layouts are the same, and a cursor writes only initialized units.
        let target = unsafe { &mut *(core::ptr::from_mut(target) as *mut [MaybeUninit<T>]) };
        Self::fill_uninit(target, write).len()
    }

    /// Appends what `write` writes, `additional` units at most.
    #[inline(always)]
    pub fn extend_vec(
        target: &mut Vec<T>,
        additional: usize,
        write: impl FnOnce(&mut Cursor<'_, T>),
    ) -> Result<(), AllocError> {
        target
            .try_reserve_exact(additional)
            .map_err(|_| AllocError)?;
        let written =
            Self::fill_uninit(&mut target.spare_capacity_mut()[..additional], write).len();
        // SAFETY: that many units behind the length are written.
        unsafe { target.set_len(target.len() + written) };
        Ok(())
    }

    #[inline(always)]
    pub fn remaining(&self) -> usize {
        -self.at as usize
    }

    /// In this form the compiler finds the check redundant where it is.
    #[inline(always)]
    pub fn has_room(&self, count: usize) -> bool {
        isize::try_from(count).is_ok_and(|count| self.at <= -count)
    }

    /// The next `count` units.
    #[inline(always)]
    fn ahead(&mut self, count: usize) -> &mut [MaybeUninit<T>] {
        assert!(self.has_room(count));
        // SAFETY: inside of what the cursor was lent.
        unsafe { NonNull::slice_from_raw_parts(self.end.offset(self.at), count).as_mut() }
    }

    /// The same, all of which the caller writes.
    #[inline(always)]
    fn take(&mut self, count: usize) -> &'a mut [MaybeUninit<T>] {
        let taken = core::ptr::from_mut(self.ahead(count));
        self.at += count as isize;
        // SAFETY: left behind.
        unsafe { &mut *taken }
    }

    /// The next `count` units, to be written in any order.
    ///
    /// # Safety
    /// The caller writes all of them, and only initialized units, before the cursor is used again or given back.
    #[inline(always)]
    pub unsafe fn take_uninit(&mut self, count: usize) -> &'a mut [MaybeUninit<T>] {
        self.take(count)
    }

    /// For memory that has not been used for a while. It does not matter whether the room goes that far.
    #[inline(always)]
    pub fn prefetch(&self, ahead: isize) {
        let address = self.end.as_ptr().wrapping_offset(self.at + ahead);
        core::hint::prefetch_write(address, core::hint::Locality::L1);
    }

    #[inline(always)]
    pub fn mark(&self) -> Mark<'a> {
        Mark {
            at: self.at,
            cursor: PhantomData,
        }
    }

    /// What has been pushed since. Panics if the cursor is further back.
    #[inline(always)]
    pub fn since(&self, mark: Mark<'a>) -> &[T] {
        let count = usize::try_from(self.at - mark.at).expect("a mark that is behind");
        // SAFETY: left behind, so written.
        unsafe { NonNull::slice_from_raw_parts(self.end.offset(mark.at).cast(), count).as_ref() }
    }

    /// Drops what has been pushed since.
    #[inline(always)]
    pub fn rewind(&mut self, mark: Mark<'a>) {
        self.at = mark.at;
    }

    /// Lends the cursor itself, for functions that hand it on in registers.
    #[inline(always)]
    pub fn by_value(&mut self, write: impl FnOnce(Cursor<'a, T>) -> Cursor<'a, T>) {
        self.at = write(Cursor { ..*self }).at;
    }

    /// `write(self)`, but the compiler knows that the end has not moved.
    #[inline(always)]
    pub fn hand_on(self, write: impl FnOnce(Self) -> Option<Self>) -> Option<Self> {
        let end = self.end;
        write(self).map(|it| Cursor { end, ..it })
    }

    /// For a call that is not inlined: it gets a cursor of its own, so that this one stays in registers.
    #[inline(always)]
    pub fn apart<R>(&mut self, write: impl FnOnce(&mut Cursor<'_, T>) -> R) -> R {
        let mut lent = Cursor { ..*self };
        let result = write(&mut lent);
        self.at = lent.at;
        result
    }

    #[inline(always)]
    pub fn push(&mut self, unit: T) {
        self.take(1)[0].write(unit);
    }

    /// `code_point` is at most 0x10FFFF. Of a unit that is too wide, the low byte is kept.
    #[inline(always)]
    pub fn push_code_point(&mut self, code_point: u32) {
        match code_point.checked_sub(0x10000) {
            None => self.push(T::from_u16_truncating(code_point as u16)),
            Some(offset) => self.push_array([
                T::from_u16_truncating(0xd800 | (offset >> 10) as u16),
                T::from_u16_truncating(0xdc00 | (offset & 0x3ff) as u16),
            ]),
        }
    }

    #[inline(always)]
    pub fn push_array<const N: usize>(&mut self, units: [T; N]) {
        self.take(N).write_copy_of_slice(&units);
    }

    /// Takes room for all `N` units and keeps the first `count`: what follows may be overwritten.
    #[inline(always)]
    pub fn push_prefix<const N: usize>(&mut self, units: &[T; N], count: usize) {
        assert!(count <= N);
        self.ahead(N).write_copy_of_slice(units);
        self.take(count);
    }

    /// [`Self::push_prefix`] of characters.
    #[inline(always)]
    pub fn push_latin1_prefix<const N: usize>(&mut self, characters: &[u8; N], count: usize) {
        match T::units(Text::Latin1(characters)).and_then(<[T]>::first_chunk::<N>) {
            Some(units) => self.push_prefix(units, count),
            None => self.push_prefix(&characters.map(T::from), count),
        }
    }

    /// [`Self::push_prefix`] with `first` in place of the first unit.
    #[inline(always)]
    pub(crate) fn push_prefix_starting_with<const N: usize>(
        &mut self,
        first: T,
        units: &[T; N],
        count: usize,
    ) {
        assert!(count <= N);
        self.ahead(N).write_copy_of_slice(units)[0] = first;
        self.take(count);
    }

    /// The same for the characters that `write` puts at the start of a buffer. It returns their number.
    #[inline(always)]
    pub fn push_written<const N: usize>(&mut self, write: impl FnOnce(&mut [u8; N]) -> usize) {
        if !T::IS_LATIN1 {
            let mut buffer = [0; N];
            let count = write(&mut buffer);
            return self.push_prefix(&buffer.map(T::from), count);
        }
        let room = self.ahead(N).write_filled(T::from(0));
        // SAFETY: so many units, which are bytes.
        let count = write(unsafe { &mut *room.as_mut_ptr().cast() });
        assert!(count <= N);
        self.take(count);
    }

    #[inline(always)]
    pub fn push_slice(&mut self, units: &[T]) {
        copy::copy(self.take(units.len()), units);
    }

    /// Of a unit that is too wide, the low byte is kept.
    #[inline(always)]
    pub fn push_text(&mut self, text: Text<'_>) {
        text.copy_to(self.take(text.len()));
    }

    /// `map` has no branch, or this is slow.
    #[inline(always)]
    pub fn push_mapped<S: Copy>(&mut self, source: &[S], map: impl Fn(S) -> T + Copy) {
        copy::map(self.take(source.len()), source, map);
    }

    /// [`Self::push_prefix`] of what `map` makes of `source`.
    #[inline(always)]
    pub(crate) fn push_mapped_prefix<S: Copy, const N: usize>(
        &mut self,
        source: &[S; N],
        count: usize,
        map: impl Fn(S) -> T + Copy,
    ) {
        assert!(count <= N);
        for (to, &from) in self.ahead(N).iter_mut().zip(source) {
            to.write(map(from));
        }
        self.take(count);
    }

    /// Returns false if a unit passes `stop`. Then nothing is pushed, but the room may be overwritten.
    #[inline(always)]
    pub(crate) fn push_mapped_unless<S: Copy>(
        &mut self,
        source: &[S],
        map: impl Fn(S) -> T + Copy,
        stop: impl Fn(S) -> bool + Copy,
    ) -> bool {
        if copy::map_unless(self.ahead(source.len()), source, map, stop) {
            return false;
        }
        self.take(source.len());
        true
    }

    /// [`Self::push_mapped_unless`] of the units themselves, between `before` and `after`.
    #[inline(always)]
    pub(crate) fn push_between_unless<S: CodeUnit, const N: usize>(
        &mut self,
        source: &[S],
        before: [u8; N],
        after: [u8; N],
        stop: impl Fn(S) -> bool + Copy,
    ) -> bool {
        let (start, rest) = self.ahead(source.len() + 2 * N).split_at_mut(N);
        let (middle, end) = rest.split_at_mut(source.len());
        for index in 0..N {
            start[index].write(T::from(before[index]));
            end[index].write(T::from(after[index]));
        }
        if copy::map_unless(
            middle,
            source,
            |it| T::from_u16_truncating(it.to_u16()),
            stop,
        ) {
            return false;
        }
        self.take(source.len() + 2 * N);
        true
    }

    #[inline(always)]
    pub fn push_repeated(&mut self, unit: T, count: usize) {
        self.take(count).write_filled(unit);
    }

    /// `length` units of `pattern`, which is not empty, again and again.
    #[inline(always)]
    pub fn push_pattern(&mut self, pattern: Text<'_>, length: usize) {
        assert!(!pattern.is_empty());
        copy::fill(self.take(length), pattern);
    }

    /// Returns how many units of `source` it has read. See [`bun_highway::text::escape_json`].
    #[inline(always)]
    pub(crate) fn push_short_json_escapes<S: CodeUnit>(&mut self, source: &[S]) -> usize {
        let (read, written) = bun_highway::text::escape_json(source, self.ahead(self.remaining()));
        self.take(written);
        read
    }

    #[inline(always)]
    pub(crate) fn lend<R>(&mut self, write: impl FnOnce(BorrowedCursor<'_, T>) -> R) -> R {
        let mut buffer = BorrowedBuf::from(self.ahead(self.remaining()));
        let result = write(buffer.unfilled());
        let written = buffer.len();
        self.take(written);
        result
    }
}

impl Cursor<'_, u8> {
    /// Two bytes for each of `source`.
    #[inline(always)]
    pub(crate) fn push_mapped_pairs(&mut self, source: &[u8], map: impl Fn(u8) -> [u8; 2] + Copy) {
        let target = self.take(2 * source.len());
        // SAFETY: the same memory, and the alignment is one.
        let pairs = unsafe { slice::from_raw_parts_mut(target.as_mut_ptr().cast(), source.len()) };
        copy::map(pairs, source, map);
    }
}

impl Cursor<'_, u16> {
    /// Returns how many bytes it has read. See [`bun_highway::utf8::decode`].
    #[inline(always)]
    pub(crate) fn push_start_of_utf8(&mut self, source: &[u8]) -> usize {
        let (read, written) = bun_highway::utf8::decode(source, self.ahead(self.remaining()));
        self.take(written);
        read
    }
}

impl StringRef {
    /// The string that `write` writes, of `capacity` units at most.
    #[inline(always)]
    pub fn try_write<T: CodeUnit>(
        capacity: usize,
        write: impl FnOnce(&mut Cursor<'_, T>),
    ) -> Result<StringRef, AllocError> {
        let string = StringImpl::allocate::<T>(capacity)?;
        // SAFETY: takes over the one count that the allocation was made with.
        let owner = unsafe { StringRef::from_raw(string) };
        // SAFETY: allocated for `T`, and nothing else has the string yet.
        let units = unsafe { &mut StringImpl::tail::<T>(string)[..capacity] };
        let length = Cursor::fill_uninit(units, write).len();
        if length == capacity && length != 0 {
            return Ok(owner);
        }
        // SAFETY: as above, and `length` units are written.
        Ok(unsafe { builder::shorten::<T>(owner, length) })
    }

    /// For `length` units and stores that go beyond them. The memory has room for those even if the string could not be
    /// any longer.
    #[inline(always)]
    pub fn try_write_with_slack<T: CodeUnit, const SLACK: usize>(
        length: usize,
        write: impl FnOnce(&mut Cursor<'_, T>),
    ) -> Result<StringRef, AllocError> {
        if length == 0 {
            return Ok(StringRef::empty());
        }
        let string = StringImpl::allocate_with_slack::<T, SLACK>(length)?;
        // SAFETY: takes over the one count that the allocation was made with.
        let owner = unsafe { StringRef::from_raw(string) };
        // SAFETY: allocated for so many, and nothing else has the string yet.
        let units = unsafe {
            let first = string.byte_add(StringImpl::TAIL).cast();
            NonNull::slice_from_raw_parts(first, length + SLACK).as_mut()
        };
        assert!(Cursor::fill_uninit(units, write).len() == length);
        Ok(owner)
    }

    #[inline]
    pub(crate) fn try_copy(text: Text<'_>) -> Result<StringRef, AllocError> {
        with_text!(text, |units| Self::try_write(units.len(), |cursor| cursor
            .push_slice(units)))
    }
}
