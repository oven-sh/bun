//! Where one call puts its output.

use bun_core::vec::{BorrowedBuf, append_with};

use crate::checksum::Checksum;
use crate::error::Result;

pub(super) trait Target {
    fn filled(&self) -> &[u8];
    fn room(&self) -> usize;
    fn append(&mut self, bytes: &[u8], checksum: &mut Checksum);
    /// `false` if it is as large as it may get.
    fn grow(&mut self) -> Result<bool>;
    /// When it is nearly full: if that is cheap, or what `input_len` bytes stand for is unlikely to fit.
    fn grow_early(&mut self, input_len: usize);
    /// One that ends with `filled()`, and that nobody else writes to or looks behind the end of.
    fn vec(&mut self) -> Option<&mut Vec<u8>>;
}

impl Target for &mut BorrowedBuf<'_, u8> {
    #[inline]
    fn filled(&self) -> &[u8] {
        BorrowedBuf::filled(self)
    }

    #[inline]
    fn room(&self) -> usize {
        self.capacity() - self.len()
    }

    #[inline(always)]
    fn append(&mut self, bytes: &[u8], checksum: &mut Checksum) {
        checksum.copy(bytes, self.unfilled());
    }

    #[inline]
    fn grow(&mut self) -> Result<bool> {
        Ok(false)
    }

    #[inline]
    fn grow_early(&mut self, _: usize) {}

    #[inline]
    fn vec(&mut self) -> Option<&mut Vec<u8>> {
        None
    }
}

const MIN_GROWTH: usize = 4096;

pub(super) struct Growing<'a> {
    vec: &'a mut Vec<u8>,
    start: usize,
    max_len: usize,
    /// The caller did not know how long the output is.
    has_grown: bool,
}

impl<'a> Growing<'a> {
    pub(super) fn new(vec: &'a mut Vec<u8>, max: usize) -> Self {
        Self {
            start: vec.len(),
            max_len: vec.len().saturating_add(max),
            has_grown: false,
            vec,
        }
    }
}

impl Target for Growing<'_> {
    #[inline]
    fn filled(&self) -> &[u8] {
        self.vec.get(self.start..).unwrap_or_default()
    }

    #[inline]
    fn room(&self) -> usize {
        self.vec.capacity().min(self.max_len) - self.vec.len()
    }

    #[inline(always)]
    fn append(&mut self, bytes: &[u8], checksum: &mut Checksum) {
        append_with(self.vec, bytes.len(), |out| checksum.copy(bytes, out));
    }

    fn grow(&mut self) -> Result<bool> {
        let spare = self.vec.capacity() - self.vec.len();
        let left = self.max_len.saturating_sub(self.vec.capacity());
        if left != 0 && self.vec.try_reserve(spare + left.min(MIN_GROWTH)).is_err() {
            let growth = left.min(MIN_GROWTH + self.vec.len() / 8);
            self.vec.try_reserve_exact(spare + growth)?;
        }
        self.has_grown = true;
        Ok(left != 0)
    }

    fn grow_early(&mut self, input_len: usize) {
        const LONG_INPUT: usize = 1024;
        if self.has_grown || input_len >= LONG_INPUT || self.vec.capacity() < MIN_GROWTH {
            // What is left may do after all.
            _ = self.grow();
        }
    }

    #[inline]
    fn vec(&mut self) -> Option<&mut Vec<u8>> {
        Some(self.vec)
    }
}

pub(super) struct Output<T> {
    pub(super) target: T,
    /// So many bytes at its end did not come from the window.
    pub(super) unrecorded: usize,
    /// So many of those are not in the checksum yet.
    pub(super) unchecked: usize,
}

impl<T: Target> Output<T> {
    #[inline]
    pub(super) fn len(&self) -> usize {
        self.target.filled().len()
    }

    #[inline]
    pub(super) fn room(&self) -> usize {
        self.target.room()
    }

    #[inline(always)]
    pub(super) fn check(&mut self, checksum: &mut Checksum) {
        if let Some(vec) = self.target.vec()
            && let len @ 1.. = core::mem::take(&mut self.unchecked)
        {
            checksum.add(vec.split_at(vec.len() - len).1);
        }
    }
}
