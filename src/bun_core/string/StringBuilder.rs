use core::fmt;

use crate::io::Write as _;
use crate::string::StringPointer;
use crate::vec::BorrowedCursor;

/// Two-phase string builder: callers first `count()` every slice they will
/// append, then `allocate()` once, then `append()` each slice. Returned slices
/// point into the single backing buffer.
///
// Note: the `append*` methods return `&[u8]` borrowing the buffer while also
// taking `&mut self`, so callers cannot hold two returned slices at once.
// Callers that need to interleave appends
// use `StringPointer` offsets or the unsafe `append_raw` escape hatch below.
pub struct StringBuilder<State = Allocated>(State);

/// The state before `allocate()`.
pub struct Counting(usize);

/// The state after `allocate()`. Never reallocated: appending past the capacity panics.
pub struct Allocated(Vec<u8>);

impl Default for StringBuilder<Counting> {
    fn default() -> Self {
        Self(Counting(0))
    }
}

impl StringBuilder<Counting> {
    pub fn count_z(&mut self, slice: &[u8]) {
        self.count_len(slice.len() + 1);
    }

    pub fn count(&mut self, slice: &[u8]) {
        self.count_len(slice.len());
    }

    pub fn count_len(&mut self, len: usize) {
        self.0.0 += len;
    }

    pub fn fmt_count(&mut self, args: fmt::Arguments<'_>) {
        self.count_len(bun_alloc::fmt_count(args));
    }

    pub fn allocate(self) -> StringBuilder {
        StringBuilder(Allocated(Vec::with_capacity(self.0.0)))
    }
}

impl StringBuilder {
    /// The number of bytes counted.
    pub fn capacity(&self) -> usize {
        self.0.0.capacity()
    }

    /// The number of bytes appended so far.
    pub fn len(&self) -> usize {
        self.0.0.len()
    }

    /// Appends what `write` writes to a cursor over the unused capacity.
    pub fn append_with<R>(&mut self, write: impl FnOnce(BorrowedCursor<'_, u8>) -> R) -> R {
        crate::vec::append_with(&mut self.0.0, usize::MAX, write)
    }

    pub fn append(&mut self, slice: &[u8]) -> &[u8] {
        let start = self.len();
        self.append_with(|mut cursor| cursor.append(slice));
        &self.written_slice()[start..]
    }

    pub fn append_zeros(&mut self, count: usize) {
        assert!(count <= self.capacity() - self.len()); // didn't count everything
        self.0.0.resize(self.len() + count, 0);
    }

    /// Copy `slice` into the reserved buffer and return a borrow of the copied
    /// bytes with an *unbound* lifetime, so callers may interleave appends and
    /// stash both slices (e.g. `picohttp::Header::clone`).
    ///
    /// # Safety
    /// The returned slice aliases the buffer. Caller must keep the builder (or the
    /// moved-out buffer) alive, and those bytes unchanged, while the slice is in use.
    pub unsafe fn append_raw<'a>(&mut self, slice: &[u8]) -> &'a [u8] {
        let start = self.len();
        self.append_with(|mut cursor| cursor.append(slice));
        // SAFETY: `append_with` initialized these bytes, and the buffer is never reallocated. The
        // unbound `'a` lifetime is the documented caller contract of `append_raw`.
        unsafe { core::slice::from_raw_parts(self.0.0.as_ptr().add(start), slice.len()) }
    }

    pub fn add_concat(&mut self, slices: &[&[u8]]) -> StringPointer {
        let start = self.len();
        for slice in slices {
            self.append(slice);
        }
        self.pointer_since(start)
    }

    fn pointer_since(&self, start: usize) -> StringPointer {
        StringPointer {
            offset: start as u32,
            length: (self.len() - start) as u32,
        }
    }

    pub fn append_count(&mut self, slice: &[u8]) -> StringPointer {
        let start = self.len();
        self.append(slice);
        self.pointer_since(start)
    }

    pub fn append_count_z(&mut self, slice: &[u8]) -> StringPointer {
        let pointer = self.append_count(slice);
        self.append(b"\0");
        pointer
    }

    pub fn fmt(&mut self, args: fmt::Arguments<'_>) -> &[u8] {
        let start = self.len();
        self.append_with(|mut cursor| cursor.write_fmt(args))
            .expect("unreachable");
        &self.written_slice()[start..]
    }

    pub fn fmt_append_count_z(&mut self, args: fmt::Arguments<'_>) -> StringPointer {
        let start = self.len();
        self.fmt(args);
        let pointer = self.pointer_since(start);
        self.append(b"\0");
        pointer
    }

    /// The bytes appended so far.
    #[inline]
    pub fn written_slice(&self) -> &[u8] {
        &self.0.0
    }

    /// The bytes appended so far, without copying.
    pub fn into_vec(self) -> Vec<u8> {
        self.0.0
    }

    /// Takes the buffer without copying. The unused capacity is filled with zeros.
    pub fn into_boxed_slice(self) -> Box<[u8]> {
        let mut buf = self.into_vec();
        buf.resize(buf.capacity(), 0);
        buf.into_boxed_slice()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn views_are_empty_after_allocate_with_nothing_counted() {
        let mut builder = StringBuilder::default();
        builder.count(b"");
        let mut builder = builder.allocate();
        assert!(builder.append(b"").is_empty());
        assert!(builder.written_slice().is_empty());
        assert!(builder.into_boxed_slice().is_empty());
    }

    #[test]
    fn into_boxed_slice_does_not_reallocate_and_zeroes_unused_capacity() {
        let mut builder = StringBuilder::default();
        builder.count(b"abcd");
        let mut builder = builder.allocate();
        let address = builder.append(b"ab").as_ptr();
        let boxed = builder.into_boxed_slice();
        assert_eq!((boxed.as_ptr(), &*boxed), (address, &b"ab\0\0"[..]));
    }

    #[test]
    #[should_panic]
    fn append_panics_past_the_capacity() {
        let mut builder = StringBuilder::default();
        builder.count(b"a");
        let mut builder = builder.allocate();
        builder.append(b"ab");
    }
}
