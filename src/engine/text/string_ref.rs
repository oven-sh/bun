use core::ffi::c_void;
use core::marker::PhantomData;
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ops::{Deref, Range};
use core::ptr::NonNull;

use bun_alloc::AllocError;

use crate::static_names::ATOMS;
use crate::string_impl::{Buffer, EMPTY, SubstringImpl};
use crate::{CodeUnit, FreeExternalBuffer, StaticString, StringImpl, Text, with_text};

/// A counted reference to a string of this thread.
#[repr(transparent)]
pub struct StringRef(NonNull<StringImpl>);

impl StringRef {
    #[inline(always)]
    pub const fn empty() -> StringRef {
        StringRef(EMPTY.as_ptr())
    }

    #[inline(always)]
    pub const fn from_static(string: &'static StaticString) -> StringRef {
        StringRef(string.as_ptr())
    }

    #[inline(always)]
    pub fn single_character(character: u8) -> StringRef {
        Self::from_static(&ATOMS[usize::from(character)])
    }

    /// Panics unless the index is below `STATIC_ATOM_COUNT`.
    pub fn static_atom(index: usize) -> StringRef {
        Self::from_static(&ATOMS[index])
    }

    /// Does not copy.
    pub fn from_literal(ascii: &'static str) -> StringRef {
        debug_assert!(ascii.is_ascii());
        Self::from_static_units(ascii.as_bytes())
    }

    /// Does not copy.
    pub fn from_static_units<T: CodeUnit>(units: &'static [T]) -> StringRef {
        if units.is_empty() {
            return Self::empty();
        }
        assert!(units.len() <= crate::MAX_LENGTH);
        StringRef(StringImpl::boxed(StringImpl::header(
            units.as_ptr(),
            units.len(),
            Buffer::Internal as u32,
        )))
    }

    /// The same, for what is long enough to matter to the collector, which is not charged.
    pub fn from_lasting_units<T: CodeUnit>(units: &'static [T]) -> StringRef {
        // SAFETY: static.
        unsafe { Self::external(units, core::ptr::null_mut(), None) }
    }

    /// # Safety
    /// `units` stay valid and unchanged until `free` is called, from whichever thread drops the last reference.
    pub unsafe fn external<T: CodeUnit>(
        units: &[T],
        context: *mut c_void,
        free: Option<FreeExternalBuffer>,
    ) -> StringRef {
        // SAFETY: the caller's.
        StringRef(unsafe { StringImpl::external(units, context, free) })
    }

    /// # Safety
    /// The caller writes all units through `characters()` before anything reads them.
    #[inline]
    pub unsafe fn try_uninitialized<T: CodeUnit>(length: usize) -> Result<StringRef, AllocError> {
        StringWriter::<T>::try_new(length).map(|writer| writer.string)
    }

    /// For a string that has no hash yet: `hash` is what `hash()` would compute.
    pub fn with_hash(self, hash: u32) -> StringRef {
        self.set_hash(hash);
        self
    }

    /// Takes the allocation over.
    pub fn from_vec<T: CodeUnit>(units: Vec<T>) -> Result<StringRef, AllocError> {
        if units.is_empty() {
            return Ok(Self::empty());
        }
        if units.len() > crate::MAX_LENGTH {
            return Err(AllocError);
        }
        let units = units.leak();
        Ok(StringRef(StringImpl::boxed(StringImpl::header(
            units.as_ptr(),
            units.len(),
            Buffer::Owned as u32,
        ))))
    }

    #[inline]
    pub fn try_from_units<T: CodeUnit>(units: &[T]) -> Result<StringRef, AllocError> {
        Self::try_write(units.len(), |to| to.push_slice(units))
    }

    /// The first `length` units, in an allocation for all of them. Panics unless `length` is from 1 to `N`.
    #[inline(always)]
    pub fn try_from_prefix<T: CodeUnit, const N: usize>(
        units: &[T; N],
        length: usize,
    ) -> Result<StringRef, AllocError> {
        assert!((1..=N).contains(&length));
        let string = StringImpl::allocate::<T>(N)?;
        // SAFETY: new, with room for `N` units, and aligned for them.
        unsafe {
            string.byte_add(StringImpl::TAIL).cast().write(*units);
            let field = string.byte_add(StringImpl::OFFSET_OF_LENGTH);
            field.cast::<u32>().write(length as u32);
        }
        Ok(StringRef(string))
    }

    /// A copy of the same width.
    #[inline]
    pub fn try_from_text(text: Text<'_>) -> Result<StringRef, AllocError> {
        with_text!(text, |units| Self::try_from_units(units))
    }

    /// A copy that is Latin-1 if the characters allow it.
    pub fn try_narrowed(text: Text<'_>) -> Result<StringRef, AllocError> {
        match text {
            Text::Utf16(units) if text.fits_latin1() => {
                let mut writer = StringWriter::<u8>::try_new(units.len())?;
                writer.push_narrowed(units);
                Ok(writer.finish())
            }
            _ => Self::try_from_text(text),
        }
    }

    /// For text whose size no script picks: ends the process if there is no memory.
    #[inline]
    pub fn from_text(text: Text<'_>) -> StringRef {
        Self::try_from_text(text).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    #[inline]
    pub fn from_latin1(characters: &[u8]) -> StringRef {
        Self::from_text(Text::Latin1(characters))
    }

    pub fn try_concat(parts: &[Text<'_>]) -> Result<StringRef, AllocError> {
        let length = parts
            .iter()
            .try_fold(0usize, |length, part| length.checked_add(part.len()))
            .ok_or(AllocError)?;
        if parts.iter().all(|part| part.is_latin1()) {
            return Self::try_write::<u8>(length, |to| {
                for &part in parts {
                    to.push_slice(u8::units(part).unwrap_or_default());
                }
            });
        }
        Self::try_write::<u16>(length, |to| {
            parts.iter().for_each(|&part| to.push_text(part))
        })
    }

    /// Shares the characters of `string` unless a copy is no larger. Panics if the range is not inside it.
    pub fn substring(string: &StringImpl, range: Range<usize>) -> StringRef {
        const COPY_LIMIT: usize = size_of::<SubstringImpl>() - StringImpl::TAIL;
        let text = string.text().slice(range);
        if text.len() == string.len() && !string.is_symbol() {
            return StringRef::retain(string);
        }
        match text {
            Text::Latin1([]) | Text::Utf16([]) => return Self::empty(),
            Text::Latin1(&[character]) => return Self::single_character(character),
            _ if text.len() <= COPY_LIMIT && text.fits_latin1() => {
                return Self::try_narrowed(text).unwrap_or_else(|_| bun_alloc::out_of_memory());
            }
            _ if text.len() * 2 <= COPY_LIMIT => return Self::from_text(text),
            _ => {}
        }
        let owner = StringRef::retain(string.owner());
        let header = with_text!(text, |units| StringImpl::header(
            units.as_ptr(),
            units.len(),
            Buffer::Substring as u32
        ));
        StringRef(
            StringImpl::boxed(SubstringImpl {
                string: header,
                owner: owner.into_raw(),
            })
            .cast(),
        )
    }

    #[inline(always)]
    pub fn retain(string: &StringImpl) -> StringRef {
        string.retain();
        // SAFETY: a `StringImpl` exists only at the head of an allocation whose provenance was exposed, or in a static.
        StringRef(unsafe {
            NonNull::new_unchecked(core::ptr::with_exposed_provenance_mut(
                core::ptr::from_ref(string).expose_provenance(),
            ))
        })
    }

    /// # Safety
    /// The caller hands over a reference that it holds.
    #[inline(always)]
    pub const unsafe fn from_raw(string: NonNull<StringImpl>) -> StringRef {
        StringRef(string)
    }

    #[inline(always)]
    pub fn into_raw(self) -> NonNull<StringImpl> {
        ManuallyDrop::new(self).0
    }

    #[inline(always)]
    pub fn as_ptr(&self) -> NonNull<StringImpl> {
        self.0
    }

    #[inline(always)]
    pub fn ptr_eq(&self, other: &StringImpl) -> bool {
        self.address() == other.address()
    }

    /// A string that shares nothing with those of this thread.
    pub fn isolated_copy(string: &StringImpl) -> IsolatedString {
        if string.is_static() && !string.is_symbol() {
            return IsolatedString(StringRef::retain(string));
        }
        IsolatedString(Self::from_text(string.text()))
    }

    /// A string that any number of threads may hold.
    pub fn to_shared(string: &StringImpl) -> SharedString {
        let shared = if string.is_static() && !string.is_symbol() {
            return SharedString(StringRef::retain(string));
        } else if string.is_atom() || string.is_symbol() || string.is_substring() {
            Self::from_text(string.text())
        } else {
            StringRef::retain(string)
        };
        shared.set_never_atomize();
        SharedString(shared)
    }
}

impl Deref for StringRef {
    type Target = StringImpl;

    #[inline(always)]
    fn deref(&self) -> &StringImpl {
        // SAFETY: the reference that `self` holds keeps the string alive.
        unsafe { self.0.as_ref() }
    }
}

impl Clone for StringRef {
    #[inline(always)]
    fn clone(&self) -> StringRef {
        StringImpl::retain(self);
        StringRef(self.0)
    }
}

impl Drop for StringRef {
    #[inline(always)]
    fn drop(&mut self) {
        // SAFETY: gives up the reference that `self` holds.
        unsafe { StringImpl::release(self.0) }
    }
}

impl Default for StringRef {
    fn default() -> StringRef {
        StringRef::empty()
    }
}

impl PartialEq for StringRef {
    #[inline]
    fn eq(&self, other: &StringRef) -> bool {
        **self == **other
    }
}

impl Eq for StringRef {}

impl PartialEq for StringImpl {
    /// By content.
    #[inline]
    fn eq(&self, other: &StringImpl) -> bool {
        if self.address() == other.address() {
            return true;
        }
        if self.len() != other.len() || (self.is_atom() && other.is_atom()) {
            return false;
        }
        let (a, b) = (self.existing_hash(), other.existing_hash());
        (a == b || a == 0 || b == 0) && self.text() == other.text()
    }
}

impl Eq for StringImpl {}

impl core::hash::Hash for StringRef {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        state.write_u32(StringImpl::hash(self));
    }
}

impl core::fmt::Display for StringRef {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        (**self).fmt(formatter)
    }
}

impl core::fmt::Debug for StringRef {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        (**self).fmt(formatter)
    }
}

/// The only reference to a string, on its way to another thread.
pub struct IsolatedString(StringRef);

// SAFETY: not an atom of any thread's table, and no other reference to it or to its buffer exists.
unsafe impl Send for IsolatedString {}

impl IsolatedString {
    pub fn into_string(self) -> StringRef {
        self.0
    }
}

/// A string whose header nothing but the reference count changes any more.
#[derive(Clone)]
pub struct SharedString(StringRef);

// SAFETY: the count is atomic, the hash is computed, and no table takes the string for an atom.
unsafe impl Send for SharedString {}
// SAFETY: as above.
unsafe impl Sync for SharedString {}

impl SharedString {
    pub fn to_string_ref(&self) -> StringRef {
        self.0.clone()
    }

    pub fn into_string(self) -> StringRef {
        self.0
    }
}

impl Deref for SharedString {
    type Target = StringImpl;

    fn deref(&self) -> &StringImpl {
        &self.0
    }
}

/// Fills a new string of a known length from the front.
pub struct StringWriter<T: CodeUnit> {
    string: StringRef,
    written: usize,
    unit: PhantomData<T>,
}

impl<T: CodeUnit> StringWriter<T> {
    #[inline]
    pub fn try_new(length: usize) -> Result<StringWriter<T>, AllocError> {
        let string = match length {
            0 => StringRef::empty(),
            _ => StringRef(StringImpl::allocate::<T>(length)?),
        };
        Ok(StringWriter {
            string,
            written: 0,
            unit: PhantomData,
        })
    }

    #[inline(always)]
    fn units(&mut self) -> &mut [MaybeUninit<T>] {
        // SAFETY: allocated for `T` (the empty string has no units), and nothing else has the string before `finish`.
        unsafe { StringImpl::tail(self.string.0) }
    }

    /// The next `count` units, which the caller writes. Panics if they do not fit.
    #[inline(always)]
    fn reserve(&mut self, count: usize) -> &mut [MaybeUninit<T>] {
        let start = self.written;
        self.written += count;
        &mut self.units()[start..][..count]
    }

    #[inline]
    pub fn remaining(&self) -> usize {
        self.string.len() - self.written
    }

    #[inline]
    pub fn push(&mut self, unit: T) {
        self.reserve(1)[0].write(unit);
    }

    #[inline(always)]
    pub fn push_slice(&mut self, units: &[T]) {
        crate::copy::copy(self.reserve(units.len()), units);
    }

    #[inline]
    pub fn push_mapped<S: Copy>(&mut self, source: &[S], mut map: impl FnMut(S) -> T) {
        for (target, &unit) in self.reserve(source.len()).iter_mut().zip(source) {
            target.write(map(unit));
        }
    }

    /// The next `count` units, set to `unit`.
    #[inline]
    pub fn push_repeated(&mut self, unit: T, count: usize) -> &mut [T] {
        self.reserve(count).write_filled(unit)
    }

    /// Appends a copy of the first `count` units written.
    pub fn push_own_prefix(&mut self, count: usize) {
        let start = self.written;
        assert!(count <= start);
        self.written += count;
        let (written, rest) = self.units().split_at_mut(start);
        rest[..count].copy_from_slice(&written[..count]);
    }

    /// Panics if units are left to write.
    #[inline]
    pub fn finish(self) -> StringRef {
        assert!(self.written == self.string.len());
        self.string
    }

    /// Ends the string after what has been written.
    pub fn finish_truncated(self) -> StringRef {
        if self.written == self.string.len() {
            return self.string;
        }
        if self.written == 0 {
            return StringRef::empty();
        }
        // SAFETY: allocated for `T`, and this is the only reference.
        match unsafe { StringImpl::reallocate::<T>(self.string.into_raw(), self.written) } {
            Ok(string) => StringRef(string),
            Err(AllocError) => bun_alloc::out_of_memory(),
        }
    }
}

impl StringWriter<u8> {
    /// Keeps the low byte of each unit.
    #[inline]
    pub fn push_narrowed(&mut self, units: &[u16]) {
        self.push_mapped(units, |unit| unit as u8);
    }
}

impl StringWriter<u16> {
    #[inline]
    pub fn push_text(&mut self, text: Text<'_>) {
        match text {
            Text::Latin1(characters) => self.push_mapped(characters, u16::from),
            Text::Utf16(units) => self.push_slice(units),
        }
    }
}
