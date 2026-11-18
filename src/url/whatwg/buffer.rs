use core::ops::{Deref, DerefMut};

use bun_engine_text::{AllocError, MAX_LENGTH};

/// Bytes on the stack while they are few, and never more than a string can have. It costs nothing until it is written to.
pub(crate) struct Buffer {
    length: usize,
    inline: Option<[u8; Buffer::INLINE_CAPACITY]>,
    /// In use once `inline` is outgrown. Its length is the capacity.
    heap: Vec<u8>,
}

impl Buffer {
    const INLINE_CAPACITY: usize = 256;

    #[inline]
    pub(crate) fn new() -> Buffer {
        Buffer {
            length: 0,
            inline: None,
            heap: Vec::new(),
        }
    }

    #[inline(always)]
    fn storage(&mut self) -> &mut [u8] {
        match &mut self.inline {
            Some(inline) => inline,
            None => &mut self.heap,
        }
    }

    #[inline(never)]
    fn grow(&mut self, additional: usize) -> Result<(), AllocError> {
        let needed = self.length.saturating_add(additional);
        if needed <= Buffer::INLINE_CAPACITY {
            self.inline = Some([0; Buffer::INLINE_CAPACITY]);
            return Ok(());
        }
        let capacity = needed.max(self.storage().len() * 2).min(MAX_LENGTH);
        if needed > capacity
            || self
                .heap
                .try_reserve_exact(capacity - self.heap.len())
                .is_err()
        {
            return Err(AllocError);
        }
        if let Some(inline) = &self.inline {
            self.heap.extend_from_slice(inline);
            self.inline = None;
        }
        self.heap.resize(capacity, 0);
        Ok(())
    }

    /// The next `count` bytes, for the caller to write.
    #[inline(always)]
    pub(crate) fn append(&mut self, count: usize) -> Result<&mut [u8], AllocError> {
        let start = self.length;
        if count > self.storage().len() - start {
            self.grow(count)?;
        }
        self.length += count;
        Ok(&mut self.storage()[start..][..count])
    }

    #[inline(always)]
    pub(crate) fn push(&mut self, byte: u8) -> Result<(), AllocError> {
        self.extend(&[byte])
    }

    #[inline(always)]
    pub(crate) fn extend(&mut self, bytes: &[u8]) -> Result<(), AllocError> {
        self.append(bytes.len())?.copy_from_slice(bytes);
        Ok(())
    }

    pub(crate) fn insert(&mut self, index: usize, bytes: &[u8]) -> Result<(), AllocError> {
        let end = self.length;
        self.append(bytes.len())?;
        self.copy_within(index..end, index + bytes.len());
        self[index..][..bytes.len()].copy_from_slice(bytes);
        Ok(())
    }

    pub(crate) fn remove(&mut self, index: usize, count: usize) {
        self.copy_within(index + count.., index);
        self.length -= count;
    }

    #[inline]
    pub(crate) fn truncate(&mut self, length: usize) {
        self.length = self.length.min(length);
    }

    #[inline(always)]
    pub(crate) fn len(&self) -> usize {
        self.length
    }

    #[inline(always)]
    pub(crate) fn is_empty(&self) -> bool {
        self.length == 0
    }
}

impl Deref for Buffer {
    type Target = [u8];

    #[inline(always)]
    fn deref(&self) -> &[u8] {
        let storage = match &self.inline {
            Some(inline) => inline,
            None => &self.heap[..],
        };
        &storage[..self.length]
    }
}

impl DerefMut for Buffer {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut [u8] {
        let length = self.length;
        &mut self.storage()[..length]
    }
}
