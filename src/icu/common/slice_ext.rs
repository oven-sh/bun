//! Indexing for an index that is never out of bounds in sound data. If it is, reads give the default and writes do nothing.

use crate::common::memory::checked_copy_within;
use crate::common::soft_assert::soft_unreachable;
use std::ops::Range;
use std::slice::SliceIndex;

pub(crate) trait SliceExt<T> {
    #[cfg_attr(debug_assertions, track_caller)]
    fn at(&self, index: usize) -> T
    where
        T: Copy + Default;
    #[cfg_attr(debug_assertions, track_caller)]
    fn set(&mut self, index: usize, value: T);
    /// Returns `[range]`, or `[]` if `range` is out of bounds. `bytes::View::slice` clamps the range instead.
    #[cfg_attr(debug_assertions, track_caller)]
    fn slice(&self, range: impl SliceIndex<[T], Output = [T]>) -> &[T];
    #[cfg_attr(debug_assertions, track_caller)]
    fn slice_mut(&mut self, range: impl SliceIndex<[T], Output = [T]>) -> &mut [T];
    /// Like `get`, for an element that has no default or is changed in place.
    #[cfg_attr(debug_assertions, track_caller)]
    fn soft_get(&self, index: usize) -> Option<&T>;
    #[cfg_attr(debug_assertions, track_caller)]
    fn soft_get_mut(&mut self, index: usize) -> Option<&mut T>;
    /// Copies as much of `source` as fits to `[at..]`.
    #[cfg_attr(debug_assertions, track_caller)]
    fn copy_at(&mut self, at: usize, source: &[T])
    where
        T: Copy;
    /// Like `copy_within`.
    #[cfg_attr(debug_assertions, track_caller)]
    fn move_within(&mut self, source: Range<usize>, to: usize)
    where
        T: Copy;
    /// Like `split_at`. Both parts are empty if `mid` is out of bounds.
    #[cfg_attr(debug_assertions, track_caller)]
    fn split_soft(&self, mid: usize) -> (&[T], &[T]);
    #[cfg_attr(debug_assertions, track_caller)]
    fn split_soft_mut(&mut self, mid: usize) -> (&mut [T], &mut [T]);
    /// Splits before the first element for which `predicate` is false.
    fn split_while(&self, predicate: impl FnMut(&T) -> bool) -> (&[T], &[T]);
    /// Like `swap`.
    #[cfg_attr(debug_assertions, track_caller)]
    fn swap_soft(&mut self, a: usize, b: usize);
    /// Like `rotate_left`. Clamps `mid`.
    #[cfg_attr(debug_assertions, track_caller)]
    fn rotate_at(&mut self, mid: usize);
    /// Like `chunk_by`, whose bounds checks the compiler keeps.
    fn runs_by<'a>(
        &'a self,
        is_same: impl FnMut(&T, &T) -> bool + Clone,
    ) -> impl Iterator<Item = &'a [T]> + Clone
    where
        T: 'a;
}

impl<T> SliceExt<T> for [T] {
    #[inline]
    fn at(&self, index: usize) -> T
    where
        T: Copy + Default,
    {
        self.get(index).copied().soft_unwrap()
    }

    #[inline]
    fn set(&mut self, index: usize, value: T) {
        match self.get_mut(index) {
            Some(slot) => *slot = value,
            None => soft_unreachable(),
        }
    }

    #[inline]
    fn slice(&self, range: impl SliceIndex<[T], Output = [T]>) -> &[T] {
        self.get(range).soft_unwrap()
    }

    #[inline]
    fn slice_mut(&mut self, range: impl SliceIndex<[T], Output = [T]>) -> &mut [T] {
        self.get_mut(range).soft_unwrap()
    }

    #[inline]
    fn soft_get(&self, index: usize) -> Option<&T> {
        self.get(index).soft_some()
    }

    #[inline]
    fn soft_get_mut(&mut self, index: usize) -> Option<&mut T> {
        self.get_mut(index).soft_some()
    }

    #[inline]
    fn copy_at(&mut self, at: usize, source: &[T])
    where
        T: Copy,
    {
        let dest = self.slice_mut(at..);
        crate::common::soft_assert!(source.len() <= dest.len());
        let fits = source.len().min(dest.len());
        dest.split_at_mut(fits)
            .0
            .copy_from_slice(source.split_at(fits).0);
    }

    #[inline]
    fn move_within(&mut self, source: Range<usize>, to: usize)
    where
        T: Copy,
    {
        checked_copy_within(self, source, to).soft_unwrap();
    }

    #[inline]
    fn split_soft(&self, mid: usize) -> (&[T], &[T]) {
        self.split_at_checked(mid).soft_unwrap()
    }

    #[inline]
    fn split_soft_mut(&mut self, mid: usize) -> (&mut [T], &mut [T]) {
        self.split_at_mut_checked(mid).soft_unwrap()
    }

    #[inline]
    fn split_while(&self, mut predicate: impl FnMut(&T) -> bool) -> (&[T], &[T]) {
        self.split_soft(self.iter().take_while(|item| predicate(item)).count())
    }

    fn swap_soft(&mut self, a: usize, b: usize) {
        if let Some(part) = self.get_mut(..=a.max(b)).soft_some() {
            part.swap(a, b);
        }
    }

    // Not inlined, so that std's function has one caller and is inlined here.
    #[inline(never)]
    fn rotate_at(&mut self, mid: usize) {
        crate::common::soft_assert!(mid <= self.len());
        self.rotate_left(mid.min(self.len()));
    }

    #[inline]
    fn runs_by<'a>(
        &'a self,
        mut is_same: impl FnMut(&T, &T) -> bool + Clone,
    ) -> impl Iterator<Item = &'a [T]> + Clone
    where
        T: 'a,
    {
        let mut rest = self;
        std::iter::from_fn(move || {
            let run;
            (run, rest) = rest.split_at_checked(
                1 + rest
                    .array_windows()
                    .take_while(|[a, b]| is_same(a, b))
                    .count(),
            )?;
            Some(run)
        })
    }
}

/// Like `vec.drain(range)` with the result dropped. Clamps the range. Inlined, it keeps some of std's checks.
#[inline(never)]
#[cfg_attr(debug_assertions, track_caller)]
pub(crate) fn remove_range<T>(vec: &mut Vec<T>, range: Range<usize>) {
    crate::common::soft_assert!(vec.get(range.clone()).is_some());
    let end = range.end.min(vec.len());
    vec.drain(range.start.min(end)..end);
}

/// Unwrapping of an `Option` that is never `None` in sound data.
pub(crate) trait SoftUnwrap<T> {
    /// Returns the value, or the default for `None`.
    #[cfg_attr(debug_assertions, track_caller)]
    fn soft_unwrap(self) -> T
    where
        T: Default;
    /// Returns `self`, for an `if let` or `?` on a value that has no default.
    #[cfg_attr(debug_assertions, track_caller)]
    fn soft_some(self) -> Self;
}

impl<T> SoftUnwrap<T> for Option<T> {
    #[inline]
    fn soft_some(self) -> Self {
        crate::common::soft_assert!(self.is_some());
        self
    }

    #[inline]
    fn soft_unwrap(self) -> T
    where
        T: Default,
    {
        match self {
            Some(value) => value,
            None => {
                soft_unreachable();
                T::default()
            }
        }
    }
}

/// Converts an `int32_t` to an index. A negative value is out of bounds of every slice.
#[inline]
pub(crate) fn to_index(i: i32) -> usize {
    i as usize
}

/// Converts an `int32_t` to a length. A negative value becomes 0.
#[inline]
pub(crate) fn to_length(i: i32) -> usize {
    i.max(0) as usize
}

/// Converts an index or a length to an `int32_t`, saturating at `INT32_MAX`.
#[inline]
pub(crate) fn to_int32(n: usize) -> i32 {
    n.min(i32::MAX as usize) as i32
}

/// Returns `a == b`. Empty slices do not reach `bcmp`: some processors stall on their dangling pointers.
#[inline]
pub(crate) fn slices_equal<T: PartialEq>(a: &[T], b: &[T]) -> bool {
    a.len() == b.len() && (a.is_empty() || a == b)
}
