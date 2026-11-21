//! A vector with inline storage. Elements beyond the capacity are dropped. Invariant: `length <= N <= 255`.

use crate::common::slice_ext::SliceExt;
use std::ops::{Deref, DerefMut};

#[derive(Clone, Copy)]
pub(crate) struct ArrayVec<T, const N: usize> {
    /// The storage. `new` fills it with `T::default()`.
    pub units: [T; N],
    length: u8,
}

impl<T: Copy + Default, const N: usize> Default for ArrayVec<T, N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T, const N: usize> Deref for ArrayVec<T, N> {
    type Target = [T];

    #[inline]
    fn deref(&self) -> &[T] {
        self.units.slice(..self.length.into())
    }
}

impl<T, const N: usize> DerefMut for ArrayVec<T, N> {
    fn deref_mut(&mut self) -> &mut [T] {
        self.units.slice_mut(..self.length.into())
    }
}

impl<T: PartialEq, const N: usize> PartialEq for ArrayVec<T, N> {
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}

impl<T: Copy + Default, const N: usize> ArrayVec<T, N> {
    pub(crate) fn new() -> Self {
        const { assert!(N <= u8::MAX as usize) };
        Self {
            units: [T::default(); N],
            length: 0,
        }
    }

    /// Uses `units` as the storage. Requires `length <= N`.
    pub(crate) const fn from_array(units: [T; N], length: u8) -> Self {
        Self { units, length }
    }

    pub(crate) fn from_slice(units: &[T]) -> Self {
        let mut new = Self::new();
        new.extend(units);
        new
    }

    /// Consumes at most `N` elements of `units`.
    pub(crate) fn from_iter_truncated(units: impl IntoIterator<Item = T>) -> Self {
        let mut new = Self::new();
        for (slot, unit) in new.units.iter_mut().zip(units) {
            *slot = unit;
            new.length += 1;
        }
        new
    }

    #[inline]
    pub(crate) fn len(&self) -> usize {
        usize::from(self.length)
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.length == 0
    }

    #[inline]
    pub(crate) fn as_slice(&self) -> &[T] {
        self
    }

    /// Returns false if the vector is full.
    #[inline]
    pub(crate) fn push(&mut self, unit: T) -> bool {
        let Some(slot) = self.units.get_mut(usize::from(self.length)) else {
            return false;
        };
        *slot = unit;
        self.length += 1;
        true
    }

    pub(crate) fn extend(&mut self, units: &[T]) {
        let free = self.units.slice_mut(usize::from(self.length)..);
        self.length += free.len().min(units.len()) as u8;
        free.iter_mut()
            .zip(units)
            .for_each(|(slot, &unit)| *slot = unit);
    }
}
