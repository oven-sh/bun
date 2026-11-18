use core::ops::{Deref, DerefMut};

use bun_alloc::AllocError;

use super::{RootVec, root_vec};
use crate::Value;

const INLINE_CAPACITY: usize = 8;

/// A list of values for a local variable. A short one allocates nothing.
pub struct ValueVec {
    inline_length: usize,
    inline: [Value; INLINE_CAPACITY],
    /// Has everything once it has any capacity.
    spilled: RootVec<Value>,
}

impl Default for ValueVec {
    fn default() -> ValueVec {
        ValueVec::new()
    }
}

impl ValueVec {
    #[inline]
    pub fn new() -> ValueVec {
        ValueVec {
            inline_length: 0,
            inline: [Value::UNDEFINED; INLINE_CAPACITY],
            spilled: root_vec(),
        }
    }

    #[inline(always)]
    fn is_spilled(&self) -> bool {
        self.spilled.capacity() != 0
    }

    #[inline(always)]
    pub fn try_reserve(&mut self, additional: usize) -> Result<(), AllocError> {
        if additional <= INLINE_CAPACITY - self.inline_length && !self.is_spilled() {
            return Ok(());
        }
        self.try_reserve_more(additional)
    }

    #[inline(never)]
    fn try_reserve_more(&mut self, additional: usize) -> Result<(), AllocError> {
        if self.is_spilled() {
            return self.spilled.try_reserve(additional).map_err(|_| AllocError);
        }
        let total = self.inline_length.saturating_add(additional);
        if total > INLINE_CAPACITY {
            self.spilled
                .try_reserve(total.max(INLINE_CAPACITY * 2))
                .map_err(|_| AllocError)?;
            self.spilled
                .extend_from_slice(&self.inline[..self.inline_length]);
        }
        Ok(())
    }

    /// For a list whose length a script picks.
    #[inline]
    pub fn try_push(&mut self, value: Value) -> Result<(), AllocError> {
        if !self.is_spilled() && self.inline_length < INLINE_CAPACITY {
            self.inline[self.inline_length] = value;
            self.inline_length += 1;
            return Ok(());
        }
        self.try_reserve(1)?;
        self.spilled.push(value);
        Ok(())
    }

    #[inline]
    pub fn push(&mut self, value: Value) {
        if self.try_push(value).is_err() {
            bun_alloc::out_of_memory();
        }
    }

    pub fn try_extend_from_slice(&mut self, values: &[Value]) -> Result<(), AllocError> {
        self.try_reserve(values.len())?;
        if self.is_spilled() {
            self.spilled.extend_from_slice(values);
        } else {
            self.inline[self.inline_length..][..values.len()].copy_from_slice(values);
            self.inline_length += values.len();
        }
        Ok(())
    }

    pub fn pop(&mut self) -> Option<Value> {
        let last = *self.last()?;
        self.truncate(self.len() - 1);
        Some(last)
    }

    pub fn truncate(&mut self, length: usize) {
        self.spilled.truncate(length);
        self.inline_length = self.inline_length.min(length);
    }

    pub fn clear(&mut self) {
        self.truncate(0);
    }
}

impl Deref for ValueVec {
    type Target = [Value];

    #[inline]
    fn deref(&self) -> &[Value] {
        if self.is_spilled() {
            &self.spilled
        } else {
            &self.inline[..self.inline_length]
        }
    }
}

impl DerefMut for ValueVec {
    #[inline]
    fn deref_mut(&mut self) -> &mut [Value] {
        if self.is_spilled() {
            &mut self.spilled
        } else {
            &mut self.inline[..self.inline_length]
        }
    }
}
