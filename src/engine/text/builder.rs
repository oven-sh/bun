use core::mem::MaybeUninit;
use core::ops::Range;
use core::ptr::NonNull;

use bun_alloc::AllocError;

use crate::{CodeUnit, Cursor, MAX_LENGTH, StringImpl, StringRef, Text, ascii, copy};

/// A string that grows in the allocation it ends up in. It is Latin-1 until a wider character arrives. Once it has
/// run out of memory or of length it takes nothing more, and `finish` fails.
///
/// C++ pushes in place (`embed/include/engine/text/StringBuilder.h`). It also points `units` at a string that it
/// holds, with no room to spare.
#[repr(C)]
pub struct StringBuilder {
    /// Aligned for `u16`.
    units: NonNull<u8>,
    length: usize,
    /// The one for the other width is zero, so a push finds out about width and room in one comparison.
    latin1_capacity: usize,
    utf16_capacity: usize,
    is_latin1: bool,
    has_overflowed: bool,
    /// `units` are the tail of a string to which the builder holds the only reference.
    is_allocated: bool,
    /// What `on_stack` lent, whether or not `units` are there.
    scratch: NonNull<u8>,
    scratch_size: usize,
}

#[repr(align(2))]
struct Scratch<const BYTES: usize>([MaybeUninit<u8>; BYTES]);

impl Default for StringBuilder {
    fn default() -> StringBuilder {
        StringBuilder::new()
    }
}

impl Drop for StringBuilder {
    #[inline]
    fn drop(&mut self) {
        drop(self.take_allocation());
    }
}

impl StringBuilder {
    /// The allocator would not move a string of any length out of a block for so many characters.
    const MINIMUM_CAPACITY: usize = 28;

    #[inline]
    pub const fn new() -> StringBuilder {
        Self::in_scratch(NonNull::<u16>::dangling().cast(), 0)
    }

    #[inline(always)]
    const fn in_scratch(scratch: NonNull<u8>, scratch_size: usize) -> StringBuilder {
        StringBuilder {
            units: scratch,
            length: 0,
            latin1_capacity: scratch_size,
            utf16_capacity: 0,
            is_latin1: true,
            has_overflowed: false,
            is_allocated: false,
            scratch,
            scratch_size,
        }
    }

    pub fn with_capacity(capacity: usize) -> StringBuilder {
        let mut builder = StringBuilder::new();
        builder.reserve(capacity);
        builder
    }

    /// Lends a builder that allocates nothing while its text fits in `BYTES`. Ends the process if `build` puts
    /// another one in its place.
    #[inline(always)]
    pub fn on_stack<const BYTES: usize, R>(build: impl FnOnce(&mut StringBuilder) -> R) -> R {
        struct Lent {
            builder: StringBuilder,
            scratch: NonNull<u8>,
        }
        impl Drop for Lent {
            #[inline(always)]
            fn drop(&mut self) {
                if self.builder.scratch != self.scratch {
                    std::process::abort();
                }
            }
        }
        const { assert!(BYTES > 0 && BYTES <= MAX_LENGTH) };
        let mut scratch = Scratch([MaybeUninit::uninit(); BYTES]);
        let scratch = NonNull::from_mut(&mut scratch.0).cast();
        let mut lent = Lent {
            builder: Self::in_scratch(scratch, BYTES),
            scratch,
        };
        build(&mut lent.builder)
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.length
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.length == 0
    }

    #[inline]
    pub fn is_latin1(&self) -> bool {
        self.is_latin1
    }

    #[inline]
    pub fn has_overflowed(&self) -> bool {
        self.has_overflowed
    }

    #[inline]
    pub fn text(&self) -> Text<'_> {
        // SAFETY: the first `length` units are written, in the width that the flag names.
        unsafe {
            if self.is_latin1 {
                Text::Latin1(NonNull::slice_from_raw_parts(self.units, self.length).as_ref())
            } else {
                Text::Utf16(NonNull::slice_from_raw_parts(self.units.cast(), self.length).as_ref())
            }
        }
    }

    #[inline]
    pub fn clear(&mut self) {
        *self = Self::in_scratch(self.scratch, self.scratch_size);
    }

    pub fn truncate(&mut self, length: usize) {
        self.length = self.length.min(length);
    }

    /// Room for exactly so many more units of the present width, unless there is more already.
    #[inline]
    pub fn reserve(&mut self, additional: usize) {
        if additional > self.spare() {
            self.resize(self.length.saturating_add(additional));
        }
    }

    /// `reserve`, as far as a string can be that long. Nothing is lost if there is no memory.
    pub fn reserve_if_possible(&mut self, additional: usize) {
        let capacity = (self.length.saturating_add(additional)).min(longest(self.is_latin1));
        if capacity > self.capacity() && !self.has_overflowed {
            _ = self.try_resize_as_it_is(capacity);
        }
    }

    #[inline(always)]
    pub fn capacity(&self) -> usize {
        self.latin1_capacity | self.utf16_capacity
    }

    /// For how many more units of the present width there is room.
    #[inline(always)]
    pub fn spare(&self) -> usize {
        self.capacity() - self.length
    }

    /// Whether the units are of type `T` and `count` more fit, or else there are and will be none.
    #[inline(always)]
    pub(crate) fn has_room<T: CodeUnit>(&self, count: usize) -> bool {
        let capacity = if T::IS_LATIN1 {
            self.latin1_capacity
        } else {
            self.utf16_capacity
        };
        count <= MAX_LENGTH && self.length + count <= capacity
    }

    /// Lends `count` units if they are there and of type `T`.
    #[inline(always)]
    pub fn write_in_room<T: CodeUnit>(
        &mut self,
        count: usize,
        write: impl FnOnce(&mut Cursor<'_, T>),
    ) -> bool {
        if !self.has_room::<T>(count) {
            return false;
        }
        let length = self.length;
        // SAFETY: inside the capacity, which is in units of `T`, and only the builder has the memory.
        let room = unsafe {
            let start = self.units.cast::<MaybeUninit<T>>().add(length);
            NonNull::slice_from_raw_parts(start, count).as_mut()
        };
        self.length = length + Cursor::fill_uninit(room, write).len();
        true
    }

    /// Unless `is_done`, runs `slow`, which is not inlined and returns the length. So both ways store it in one
    /// place, from which the next push gets it in a register.
    #[inline(always)]
    pub(crate) fn or_else(&mut self, is_done: bool, slow: impl FnOnce(&mut Self) -> usize) {
        self.length = if is_done {
            self.length
        } else {
            core::hint::cold_path();
            slow(self)
        };
    }

    /// Lends all the room that there is, if the units are of type `T`.
    #[inline(always)]
    pub(crate) fn write_in_spare<T: CodeUnit>(&mut self, write: impl FnOnce(&mut Cursor<'_, T>)) {
        self.write_in_room(self.spare(), write);
    }

    /// Appends what `write` writes, `count` characters at most. Does not call it after an overflow.
    #[inline(always)]
    pub fn write_latin1(&mut self, count: usize, write: impl FnOnce(&mut Cursor<'_, u8>)) {
        let offset = if self.has_room::<u8>(count) {
            self.length
        } else if let Some(offset) = self.make_room_for_latin1(count) {
            offset
        } else {
            return;
        };
        let (length, is_latin1) = (self.length, self.is_latin1);
        // SAFETY: inside the capacity, behind what is written, and only the builder has the memory.
        let room = unsafe {
            let start = self.units.cast::<MaybeUninit<u8>>().add(offset);
            NonNull::slice_from_raw_parts(start, count).as_mut()
        };
        let written = Cursor::fill_uninit(room, write).len();
        if !is_latin1 {
            // SAFETY: as `make_room_for_latin1` has arranged it.
            unsafe { self.widen_from(offset, written) };
        }
        self.length = length + written;
    }

    /// The offset in bytes of room for `count` bytes: for wide units, the second half of the room for as many.
    #[inline(never)]
    fn make_room_for_latin1(&mut self, count: usize) -> Option<usize> {
        self.grow(count);
        if self.has_overflowed {
            None
        } else if self.is_latin1 {
            Some(self.length)
        } else {
            Some(2 * self.length + count)
        }
    }

    /// # Safety
    /// The units are wide. `count` bytes at `offset` are written, in the room and `count` bytes or more into it.
    #[inline(never)]
    unsafe fn widen_from(&mut self, offset: usize, count: usize) {
        for index in 0..count {
            // SAFETY: the caller's. A unit covers no byte that is still to be read.
            unsafe {
                let character = self.units.add(offset + index).read();
                let unit = self.units.cast::<u16>().add(self.length + index);
                unit.write(u16::from(character));
            }
        }
    }

    /// Appends what `write` writes, `count` units at most, and makes the string wide. Does not call it after an
    /// overflow.
    #[inline(always)]
    pub fn write_utf16(&mut self, count: usize, write: impl FnOnce(&mut Cursor<'_, u16>)) {
        if !self.has_room::<u16>(count) {
            self.widen(count);
            if self.has_overflowed {
                return;
            }
        }
        self.write_in_room(count, write);
    }

    /// Drops the text and takes nothing more.
    #[cold]
    pub fn overflow(&mut self) {
        self.clear();
        self.latin1_capacity = 0;
        self.has_overflowed = true;
    }

    /// `units` dangle afterwards.
    #[inline(always)]
    fn take_allocation(&mut self) -> Option<StringRef> {
        core::mem::take(&mut self.is_allocated).then(|| {
            // SAFETY: takes over the count that the builder holds.
            unsafe { StringRef::from_raw(self.units.byte_sub(StringImpl::TAIL).cast()) }
        })
    }

    /// The old allocation, if any, is taken.
    fn adopt<T: CodeUnit>(&mut self, string: NonNull<StringImpl>, capacity: usize) {
        // SAFETY: the tail is inside the allocation.
        self.units = unsafe { string.byte_add(StringImpl::TAIL).cast() };
        self.is_allocated = true;
        self.set_capacity::<T>(capacity);
    }

    fn set_capacity<T: CodeUnit>(&mut self, capacity: usize) {
        self.is_latin1 = T::IS_LATIN1;
        (self.latin1_capacity, self.utf16_capacity) = if T::IS_LATIN1 {
            (capacity, 0)
        } else {
            (0, capacity)
        };
    }

    #[inline(never)]
    fn resize(&mut self, capacity: usize) {
        if self.has_overflowed {
            return;
        }
        if self.try_resize_as_it_is(capacity).is_err() {
            self.overflow();
        }
    }

    fn try_resize_as_it_is(&mut self, capacity: usize) -> Result<(), AllocError> {
        if self.is_latin1 {
            self.try_resize::<u8>(capacity)
        } else {
            self.try_resize::<u16>(capacity)
        }
    }

    fn try_resize<T: CodeUnit>(&mut self, capacity: usize) -> Result<(), AllocError> {
        if !self.is_allocated {
            return self.try_move::<T>(capacity);
        }
        // SAFETY: allocated for `T`, and the builder holds the only reference.
        let string = unsafe {
            StringImpl::reallocate::<T>(self.units.byte_sub(StringImpl::TAIL).cast(), capacity)?
        };
        self.adopt::<T>(string, capacity);
        Ok(())
    }

    /// To a new allocation.
    fn try_move<T: CodeUnit>(&mut self, capacity: usize) -> Result<(), AllocError> {
        let string = StringImpl::allocate::<T>(capacity)?;
        // SAFETY: a new allocation for `T` that nothing else has.
        let units = unsafe { StringImpl::tail::<T>(string) };
        self.text().copy_to(&mut units[..self.length]);
        drop(self.take_allocation());
        self.adopt::<T>(string, capacity);
        Ok(())
    }

    /// Twice the bytes, which keeps to the sizes of the allocator's blocks, or what is required if that is more.
    fn grown_capacity<T: CodeUnit>(&self, additional: usize) -> usize {
        let doubled = 2 * self.capacity() + StringImpl::TAIL / size_of::<T>();
        (self.length.saturating_add(additional))
            .max(doubled.min(longest(T::IS_LATIN1)))
            .max(Self::MINIMUM_CAPACITY)
    }

    /// `grow`, and by `slack` more as far as a string can be that long.
    #[inline]
    pub(crate) fn grow_with_slack(&mut self, additional: usize, slack: usize) {
        let possible = longest(self.is_latin1) - self.length;
        self.grow(additional.max(additional.saturating_add(slack).min(possible)));
    }

    /// Room for so many more units of the present width.
    #[inline]
    pub fn grow(&mut self, additional: usize) {
        if additional > self.spare() {
            self.resize(if self.is_latin1 {
                self.grown_capacity::<u8>(additional)
            } else {
                self.grown_capacity::<u16>(additional)
            });
        }
    }

    /// Room for so many more wide units.
    #[inline(never)]
    pub fn widen(&mut self, additional: usize) {
        if !self.is_latin1 || self.has_overflowed {
            return self.grow(additional);
        }
        let required = self.length.saturating_add(additional);
        if self.units == self.scratch && required <= self.latin1_capacity / 2 {
            return self.widen_in_place();
        }
        let capacity = if required <= self.latin1_capacity {
            self.latin1_capacity
        } else {
            self.grown_capacity::<u16>(additional)
        };
        if self.try_move::<u16>(capacity).is_err() && self.try_move::<u16>(required).is_err() {
            self.overflow();
        }
    }

    /// For a builder that has been widened in advance. Returns whether it is Latin-1 now.
    #[inline]
    pub fn narrow_if_possible(&mut self) -> bool {
        if !self.is_latin1 && self.text().fits_latin1() {
            self.narrow();
        }
        self.is_latin1
    }

    #[inline(never)]
    fn narrow(&mut self) {
        if self.units != self.scratch {
            _ = self.try_move::<u8>(self.utf16_capacity);
            return;
        }
        for index in 0..self.length {
            // SAFETY: written, and a character covers no unit that is still to be read.
            unsafe {
                let unit = self.units.cast::<u16>().add(index).read();
                self.units.add(index).write(unit as u8);
            }
        }
        self.set_capacity::<u8>(self.scratch_size);
    }

    /// The text takes half of the scratch at most.
    fn widen_in_place(&mut self) {
        let mut end = self.length;
        while end > 0 {
            let start = end.div_ceil(2).min(end - 1);
            // SAFETY: inside the capacity. What is read is written, and is apart from what is written over unless it
            // is the first character, which is copied.
            unsafe {
                let first = [self.units.read()];
                let source = match start {
                    0 => &first,
                    _ => NonNull::slice_from_raw_parts(self.units.add(start), end - start).as_ref(),
                };
                let target = self.units.cast::<MaybeUninit<u16>>().add(start);
                let mut target = NonNull::slice_from_raw_parts(target, end - start);
                copy::widen(target.as_mut(), source);
            }
            end = start;
        }
        self.set_capacity::<u16>(self.latin1_capacity / 2);
    }

    #[inline]
    pub fn push_latin1(&mut self, character: u8) {
        let is_done = self.write_in_room(1, |cursor| cursor.push(character))
            || self.write_in_room(1, |cursor| cursor.push(u16::from(character)));
        self.or_else(is_done, |it| it.push_unit_slow(u16::from(character)));
    }

    #[inline]
    pub fn push_unit(&mut self, unit: u16) {
        let is_done = self.write_in_room(1, |cursor| cursor.push(unit))
            || (unit.is_latin1() && self.write_in_room(1, |cursor| cursor.push(unit as u8)));
        self.or_else(is_done, |it| it.push_unit_slow(unit));
    }

    #[inline(never)]
    fn push_unit_slow(&mut self, unit: u16) -> usize {
        if self.is_latin1 && unit.is_latin1() {
            self.write_latin1(1, |cursor| cursor.push(unit as u8));
        } else {
            self.write_utf16(1, |cursor| cursor.push(unit));
        }
        self.length
    }

    /// `code_point` is at most 0x10FFFF.
    #[inline]
    pub fn push_code_point(&mut self, code_point: u32) {
        match u16::try_from(code_point) {
            Ok(unit) => self.push_unit(unit),
            Err(_) => self.write_utf16(2, |cursor| cursor.push_code_point(code_point)),
        }
    }

    #[inline]
    pub fn push_latin1_slice(&mut self, characters: &[u8]) {
        let is_done = self.write_in_room(characters.len(), |cursor| cursor.push_slice(characters));
        self.or_else(is_done, |it| it.push_latin1_slice_slow(characters));
    }

    #[inline(never)]
    fn push_latin1_slice_slow(&mut self, characters: &[u8]) -> usize {
        self.grow(characters.len());
        let text = Text::Latin1(characters);
        _ = self.write_in_room::<u16>(text.len(), |cursor| cursor.push_text(text))
            || self.write_in_room::<u8>(text.len(), |cursor| cursor.push_text(text));
        self.length
    }

    #[inline]
    pub fn push_ascii(&mut self, ascii: &str) {
        debug_assert!(ascii.is_ascii());
        self.push_latin1_slice(ascii.as_bytes());
    }

    #[inline]
    pub fn push_utf16(&mut self, units: &[u16]) {
        let is_done = self.write_in_room(units.len(), |cursor| cursor.push_slice(units));
        self.or_else(is_done, |it| it.push_utf16_slow(units));
    }

    #[inline(never)]
    fn push_utf16_slow(&mut self, units: &[u16]) -> usize {
        if self.is_latin1 && ascii::fits_latin1(units) {
            self.write_latin1(units.len(), |cursor| cursor.push_text(Text::Utf16(units)));
        } else {
            self.write_utf16(units.len(), |cursor| cursor.push_slice(units));
        }
        self.length
    }

    #[inline]
    pub fn push_text(&mut self, text: Text<'_>) {
        match text {
            Text::Latin1(characters) => self.push_latin1_slice(characters),
            Text::Utf16(units) => self.push_utf16(units),
        }
    }

    #[inline]
    pub fn push_units<T: CodeUnit>(&mut self, units: &[T]) {
        self.push_text(T::text(units));
    }

    pub fn push_repeated(&mut self, character: u8, count: usize) {
        if self.is_latin1 {
            self.write_latin1(count, |cursor| cursor.push_repeated(character, count));
        } else {
            let unit = u16::from(character);
            self.write_utf16(count, |cursor| cursor.push_repeated(unit, count));
        }
    }

    /// Appends a copy of a part of the text. Panics if that is not inside it, unless after an overflow.
    #[inline]
    pub fn push_from_within(&mut self, range: Range<usize>) {
        #[inline(always)]
        fn push<T: CodeUnit>(builder: &mut StringBuilder, range: Range<usize>) {
            // SAFETY: the first `length` units are written as `T`, and the room that is lent is behind them.
            let text = unsafe {
                NonNull::slice_from_raw_parts(builder.units.cast::<T>(), builder.length).as_ref()
            };
            builder.write_in_room(range.len(), |cursor| cursor.push_slice(&text[range]));
        }
        self.grow(range.len());
        if self.has_overflowed {
            return;
        }
        if self.is_latin1 {
            push::<u8>(self, range);
        } else {
            push::<u16>(self, range);
        }
    }

    #[inline]
    pub fn finish(mut self) -> Result<StringRef, AllocError> {
        self.take_string()
    }

    /// `finish` for a builder that is lent or used again. It is empty afterwards.
    #[inline]
    pub fn take(&mut self) -> Result<StringRef, AllocError> {
        let string = self.take_string();
        self.clear();
        string
    }

    /// `units` may dangle afterwards.
    #[inline(always)]
    fn take_string(&mut self) -> Result<StringRef, AllocError> {
        match self.text() {
            Text::Latin1(characters @ [_, _, ..]) if !self.is_allocated => {
                StringRef::try_write(characters.len(), |cursor| cursor.push_slice(characters))
            }
            _ => self.take_other_string(),
        }
    }

    #[inline(never)]
    fn take_other_string(&mut self) -> Result<StringRef, AllocError> {
        if self.has_overflowed {
            return Err(AllocError);
        }
        if let Text::Latin1(&[character]) = self.text() {
            drop(self.take_allocation());
            return Ok(StringRef::single_character(character));
        }
        let Some(string) = self.take_allocation() else {
            return StringRef::try_copy(self.text());
        };
        // SAFETY: allocated for the width that the flag names, the only reference, and so many units are written.
        Ok(unsafe {
            if self.is_latin1 {
                shorten::<u8>(string, self.length)
            } else {
                shorten::<u16>(string, self.length)
            }
        })
    }
}

const fn longest(is_latin1: bool) -> usize {
    if is_latin1 {
        MAX_LENGTH
    } else {
        (u32::MAX as usize - size_of::<StringImpl>()) / 2
    }
}

/// Ends `string` after `length` units. It moves only if that leaves more than half of the memory unused.
///
/// # Safety
/// `string` is the only reference to what `StringImpl::allocate::<T>` made. It has `length` units or more, and so
/// many are written.
#[inline]
pub(crate) unsafe fn shorten<T: CodeUnit>(string: StringRef, length: usize) -> StringRef {
    if length == 0 {
        return StringRef::empty();
    }
    let size = |length: usize| StringImpl::TAIL + length * size_of::<T>();
    let is_wasteful = 2 * size(length) < size(string.len());
    let string = string.into_raw();
    // SAFETY: the caller's. The count moves to the result.
    unsafe {
        if is_wasteful && let Ok(moved) = StringImpl::reallocate::<T>(string, length) {
            return StringRef::from_raw(moved);
        }
        let field = string.byte_add(StringImpl::OFFSET_OF_LENGTH);
        field.cast::<u32>().write(length as u32);
        StringRef::from_raw(string)
    }
}

impl core::fmt::Write for StringBuilder {
    fn write_str(&mut self, text: &str) -> core::fmt::Result {
        self.push_utf8_lossy(text.as_bytes());
        Ok(())
    }
}
