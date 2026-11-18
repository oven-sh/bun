//! Numbers of seven bits a byte, and what is made of them.

use core::ops::{Deref, DerefMut};

use crate::code::TooLarge;

/// A list that remembers that it could not grow.
pub(crate) struct Sink<T> {
    items: Vec<T>,
    has_failed: bool,
}

impl<T> Default for Sink<T> {
    fn default() -> Sink<T> {
        Sink {
            items: Vec::new(),
            has_failed: false,
        }
    }
}

impl<T> Deref for Sink<T> {
    type Target = [T];

    #[inline]
    fn deref(&self) -> &[T] {
        &self.items
    }
}

impl<T> DerefMut for Sink<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.items
    }
}

impl<T> Sink<T> {
    const MAX_LEN: usize = i32::MAX as usize;

    #[inline]
    pub(crate) fn has_room(&mut self, more: usize) -> bool {
        self.items.capacity() - self.items.len() >= more || self.grow(more)
    }

    #[cold]
    fn grow(&mut self, more: usize) -> bool {
        self.has_failed |=
            self.items.len() + more > Self::MAX_LEN || self.items.try_reserve(more).is_err();
        !self.has_failed
    }

    #[inline]
    pub(crate) fn push(&mut self, item: T) {
        if self.has_room(1) {
            self.items.push(item);
        }
    }

    #[inline]
    pub(crate) fn extend(
        &mut self,
        items: impl IntoIterator<Item = T, IntoIter: ExactSizeIterator>,
    ) {
        let items = items.into_iter();
        if self.has_room(items.len()) {
            self.items.extend(items);
        }
    }

    pub(crate) fn pop(&mut self) -> Option<T> {
        self.items.pop()
    }

    pub(crate) fn truncate(&mut self, len: usize) {
        self.items.truncate(len);
    }

    /// To when it had that many, which was before it failed.
    pub(crate) fn go_back(&mut self, len: usize) {
        self.items.truncate(len);
        self.has_failed = false;
    }

    /// Whether it has all that it was given.
    pub(crate) fn check(&self) -> Result<(), TooLarge> {
        (!self.has_failed).ok_or(TooLarge)
    }

    pub(crate) fn finish(self) -> Result<Vec<T>, TooLarge> {
        self.check()?;
        Ok(self.items)
    }
}

impl Sink<u8> {
    #[inline]
    pub(crate) fn put(&mut self, bytes: &[u8]) {
        self.extend(bytes.iter().copied());
    }

    #[inline]
    pub(crate) fn long(&mut self, mut value: u64) {
        while value >= 0x80 {
            self.push(value as u8 | 0x80);
            value >>= 7;
        }
        self.push(value as u8);
    }

    #[inline]
    pub(crate) fn fixed(&mut self, value: u32) {
        self.put(&value.to_le_bytes());
    }

    #[inline]
    pub(crate) fn number(&mut self, value: u32) {
        self.long(u64::from(value));
    }

    #[inline]
    pub(crate) fn count(&mut self, value: usize) {
        self.long(value as u64);
    }

    /// Short if it is near `base`, on either side.
    #[inline]
    pub(crate) fn near(&mut self, base: u32, value: u32) {
        self.number(fold_sign(value.wrapping_sub(base) as i32));
    }

    /// Of exactly that many bytes.
    pub(crate) fn with_size(size: usize) -> Result<Sink<u8>, TooLarge> {
        let mut sink = Sink::default();
        (size <= Self::MAX_LEN && sink.items.try_reserve_exact(size).is_ok()).ok_or(TooLarge)?;
        Ok(sink)
    }
}

pub(crate) fn size_of_count(value: usize) -> usize {
    (value | 1).ilog2() as usize / 7 + 1
}

#[inline]
pub(crate) fn fold_sign(value: i32) -> u32 {
    (value << 1 ^ value >> 31) as u32
}

#[inline]
pub(crate) fn unfold_sign(value: u32) -> i32 {
    (value >> 1 ^ (value & 1).wrapping_neg()) as i32
}

pub(crate) struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    #[inline]
    pub(crate) fn new(bytes: &'a [u8]) -> Reader<'a> {
        Reader(bytes)
    }

    #[inline]
    pub(crate) fn rest(&self) -> &'a [u8] {
        self.0
    }

    #[inline]
    pub(crate) fn byte(&mut self) -> Option<u8> {
        self.array().map(|[byte]| byte)
    }

    #[inline]
    pub(crate) fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        let (array, rest) = self.0.split_first_chunk()?;
        self.0 = rest;
        Some(*array)
    }

    #[inline]
    pub(crate) fn fixed(&mut self) -> Option<u32> {
        self.array().map(u32::from_le_bytes)
    }

    #[inline(always)]
    pub(crate) fn long(&mut self) -> Option<u64> {
        match *self.0 {
            [first @ ..0x80, ref rest @ ..] => {
                self.0 = rest;
                Some(u64::from(first))
            }
            [first, second @ ..0x80, ref rest @ ..] => {
                self.0 = rest;
                Some(u64::from(first & 0x7f) | u64::from(second) << 7)
            }
            _ => self.long_of_many_bytes(),
        }
    }

    fn long_of_many_bytes(&mut self) -> Option<u64> {
        let mut value = 0;
        for shift in (0..63).step_by(7) {
            let byte = self.byte()?;
            value |= u64::from(byte & 0x7f) << shift;
            if byte < 0x80 {
                return Some(value);
            }
        }
        None
    }

    #[inline(always)]
    pub(crate) fn number(&mut self) -> Option<u32> {
        u32::try_from(self.long()?).ok()
    }

    #[inline(always)]
    pub(crate) fn near(&mut self, base: u32) -> Option<u32> {
        Some(base.wrapping_add_signed(unfold_sign(self.number()?)))
    }

    /// Of elements that take a byte at least.
    #[inline]
    pub(crate) fn count(&mut self) -> Option<usize> {
        let count = self.number()? as usize;
        (count <= self.0.len()).then_some(count)
    }

    #[inline]
    pub(crate) fn blob(&mut self) -> Option<&'a [u8]> {
        let size = self.count()?;
        let (blob, rest) = self.0.split_at(size);
        self.0 = rest;
        Some(blob)
    }

    /// After its size in four bytes.
    pub(crate) fn section(&mut self) -> Option<Reader<'a>> {
        let size = self.fixed()? as usize;
        let (section, rest) = self.0.split_at_checked(size)?;
        self.0 = rest;
        Some(Reader(section))
    }

    #[inline]
    pub(crate) fn list<T>(
        &mut self,
        mut element: impl FnMut(&mut Reader<'a>) -> Option<T>,
    ) -> Option<Box<[T]>> {
        let count = self.count()?;
        let mut list = Vec::new();
        list.try_reserve_exact(count).ok()?;
        for _ in 0..count {
            list.push(element(self)?);
        }
        Some(list.into())
    }
}
