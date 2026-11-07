//! Where a result goes. Matches are copied from it, so all of it has to be initialized memory.

use crate::error::{Error, Result};

pub(crate) enum Output<'a> {
    Slice(&'a mut [u8]),
    /// What `vec` holds from `start` on, lengthened with zeros as the result grows (README.md says why).
    Vec {
        vec: &'a mut Vec<u8>,
        start: usize,
        max_len: usize,
    },
}

impl Output<'_> {
    const FIRST_STEP: usize = 512;
    const MAX_STEP: usize = 256 * 1024;

    pub(crate) fn bytes(&mut self) -> &mut [u8] {
        match self {
            Self::Slice(bytes) => bytes,
            Self::Vec { vec, start, .. } => vec.get_mut(*start..).unwrap_or_default(),
        }
    }

    fn len(&self) -> usize {
        match self {
            Self::Slice(bytes) => bytes.len(),
            Self::Vec { vec, start, .. } => vec.len() - start,
        }
    }

    /// How long `bytes()` can get without a reallocation.
    pub(crate) fn len_in_place(&self) -> usize {
        match self {
            Self::Slice(bytes) => bytes.len(),
            Self::Vec {
                vec,
                start,
                max_len,
            } => (vec.capacity() - start).min(*max_len),
        }
    }

    /// Makes `bytes()` as long as `len`, or as near to that as it gets in place.
    fn lengthen_in_place(&mut self, len: usize) {
        let len = len.min(self.len_in_place());
        if let Self::Vec { vec, start, .. } = self
            && *start + len > vec.len()
        {
            vec.resize(*start + len, 0);
        }
    }

    /// For a result whose size is known: makes `bytes()` at least `len` bytes long, hardly more, and never reallocates.
    pub(crate) fn grow_in_place_to(&mut self, len: usize) -> Result<()> {
        if len > self.len_in_place() {
            return Err(Error::InsufficientSpace);
        }
        // A few bytes more let the last bits be written a word at a time.
        self.lengthen_in_place(len + size_of::<u64>());
        Ok(())
    }

    /// For a result of unknown size: makes `bytes()` at least `len` bytes long, and a step longer than it was.
    pub(crate) fn grow_to(&mut self, len: usize) -> Result<()> {
        let current = self.len();
        if len <= current {
            return Ok(());
        }
        let wanted = len.max(current + current.clamp(Self::FIRST_STEP, Self::MAX_STEP));
        if len > self.len_in_place() {
            let Self::Vec {
                vec,
                start,
                max_len,
            } = self
            else {
                return Err(Error::InsufficientSpace);
            };
            if len > *max_len {
                return Err(Error::InsufficientSpace);
            }
            // A reallocation copies what was written so far, so the capacity at least doubles.
            let doubled = vec.capacity().saturating_mul(2) - *start;
            vec.try_reserve_exact(doubled.max(wanted).min(*max_len) - current)?;
        }
        self.lengthen_in_place(wanted);
        Ok(())
    }
}
