//! Lists of nodes.

use super::{File, Handle};
use crate::span::Spanned;
use bun_sema::hir;
use std::marker::PhantomData;

/// A node's list of children: arguments, statements, members.
#[derive(Copy, Clone)]
pub struct List<'a, T> {
    file: &'a File<'a>,
    start: u32,
    len: u32,
    /// True if the elements are `Hir::ids[start..]` rather than the ids `start..` themselves.
    is_indirect: bool,
    of: PhantomData<T>,
}

impl<'a, T: Handle<'a>> List<'a, T> {
    #[inline]
    pub(crate) fn ids<I>(file: &'a File<'a>, list: hir::IdList<I>) -> Self {
        List {
            file,
            start: list.start,
            len: list.len,
            is_indirect: true,
            of: PhantomData,
        }
    }

    #[inline]
    pub(crate) fn run<I>(file: &'a File<'a>, span: hir::Span<I>) -> Self {
        List {
            file,
            start: span.start,
            len: span.len,
            is_indirect: false,
            of: PhantomData,
        }
    }

    #[inline]
    pub(crate) fn empty(file: &'a File<'a>) -> Self {
        List {
            file,
            start: 0,
            len: 0,
            is_indirect: false,
            of: PhantomData,
        }
    }

    #[inline]
    fn at(self, i: u32) -> T {
        let id = match self.is_indirect {
            true => (self.file.hir.ids.get((self.start + i) as usize)).map_or(u32::MAX, |&id| id),
            false => self.start + i,
        };
        T::from_raw(self.file, id)
    }

    /// The elements' ids, if they're stored in `Hir::ids` and none of them is skipped.
    #[inline]
    pub(crate) fn listed_ids(self) -> Option<&'a [u32]> {
        match self.is_indirect && !self.file.has_synthetic_nodes() {
            true => (self.file.hir.ids).get(self.start as usize..(self.start + self.len) as usize),
            false => None,
        }
    }

    #[inline]
    pub fn iter(self) -> Iter<'a, T> {
        Iter {
            list: self,
            front: 0,
            back: self.len,
            skips_synthetic: self.file.has_synthetic_nodes(),
        }
    }

    #[inline]
    pub fn len(self) -> usize {
        match self.file.has_synthetic_nodes() {
            true => self.count_non_synthetic(),
            false => self.len as usize,
        }
    }

    #[inline(never)]
    fn count_non_synthetic(self) -> usize {
        self.iter().count()
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn get(self, i: usize) -> Option<T> {
        match self.file.has_synthetic_nodes() {
            true => self.get_non_synthetic(i),
            false => (i < self.len as usize).then(|| self.at(i as u32)),
        }
    }

    #[inline(never)]
    fn get_non_synthetic(self, i: usize) -> Option<T> {
        self.iter().nth(i)
    }

    #[inline]
    pub fn first(self) -> Option<T> {
        self.get(0)
    }

    #[inline]
    pub fn last(self) -> Option<T> {
        self.iter().next_back()
    }
}

/// For a list whose elements are in source order and don't overlap. Each lookup is O(log n).
impl<'a, T: Handle<'a> + Spanned> List<'a, T> {
    /// The number of elements that start at or before `offset`, including the synthetic ones that iteration skips.
    fn count_until(self, offset: u32) -> u32 {
        let (mut from, mut to) = (0, self.len);
        while from < to {
            let middle = from + (to - from) / 2;
            match self.at(middle).span().start <= offset {
                true => from = middle + 1,
                false => to = middle,
            }
        }
        from
    }

    /// The whole list, or if it's long and `offset` is given, only the last element that starts at or before `offset`.
    #[inline]
    pub(super) fn near(self, offset: Option<u32>) -> Iter<'a, T> {
        match offset {
            Some(offset) if self.len > 8 => self.near_in_long_list(offset),
            _ => self.iter(),
        }
    }

    #[inline(never)]
    fn near_in_long_list(self, offset: u32) -> Iter<'a, T> {
        let mut all = self.iter();
        if !all.skips_synthetic {
            all.back = self.count_until(offset);
            all.front = all.back.saturating_sub(1);
        }
        all
    }

    /// The element that contains `offset`.
    pub fn around(self, offset: u32) -> Option<T> {
        let it = self.at(self.count_until(offset).checked_sub(1)?);
        (offset < it.span().end && !it.is_synthetic()).then_some(it)
    }

    /// [`List::around`], plus the element before it, as [`List::before`] would return for its start.
    pub fn around_with_previous(self, offset: u32) -> Option<(T, Option<T>)> {
        let at = self.count_until(offset).checked_sub(1)?;
        let it = self.at(at);
        if offset >= it.span().end || it.is_synthetic() {
            return None;
        }
        let mut before = self.iter();
        before.back = at;
        Some((it, before.next_back()))
    }

    /// The index of the element that starts at `start`. In a file with nodes synthesized from JSDoc comments, it has to
    /// count the preceding elements one by one.
    pub fn index_of_start(self, start: u32) -> Option<usize> {
        let at = self.count_until(start).checked_sub(1)?;
        let it = self.at(at);
        if it.span().start != start || it.is_synthetic() {
            return None;
        }
        let mut before = self.iter();
        before.back = at;
        Some(if before.skips_synthetic {
            before.count()
        } else {
            at as usize
        })
    }

    /// The element before the one that starts at `start`.
    pub fn before(self, start: u32) -> Option<T> {
        let mut rest = self.iter();
        rest.back = self.count_until(start).checked_sub(1)?;
        rest.next_back()
    }

    /// The element after the one that starts at `start`.
    pub fn after(self, start: u32) -> Option<T> {
        let mut rest = self.iter();
        rest.front = self.count_until(start);
        rest.next()
    }
}

impl<'a, T: Handle<'a> + std::fmt::Debug> std::fmt::Debug for List<'a, T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}

impl<'a, T: Handle<'a>> IntoIterator for List<'a, T> {
    type Item = T;
    type IntoIter = Iter<'a, T>;
    #[inline]
    fn into_iter(self) -> Iter<'a, T> {
        self.iter()
    }
}

#[derive(Copy, Clone)]
pub struct Iter<'a, T> {
    list: List<'a, T>,
    front: u32,
    back: u32,
    /// True if some elements may be synthesized from JSDoc comments. Those are skipped.
    skips_synthetic: bool,
}

impl<'a, T: Handle<'a>> Iterator for Iter<'a, T> {
    type Item = T;

    #[inline]
    fn next(&mut self) -> Option<T> {
        if self.skips_synthetic {
            return self.next_non_synthetic();
        }
        (self.front < self.back).then(|| {
            self.front += 1;
            self.list.at(self.front - 1)
        })
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let rest = (self.back - self.front) as usize;
        (if self.skips_synthetic { 0 } else { rest }, Some(rest))
    }
}

impl<'a, T: Handle<'a>> DoubleEndedIterator for Iter<'a, T> {
    #[inline]
    fn next_back(&mut self) -> Option<T> {
        if self.skips_synthetic {
            return self.next_back_non_synthetic();
        }
        (self.front < self.back).then(|| {
            self.back -= 1;
            self.list.at(self.back)
        })
    }
}

/// The slow path for a file with nodes synthesized from JSDoc comments.
impl<'a, T: Handle<'a>> Iter<'a, T> {
    #[inline(never)]
    fn next_non_synthetic(&mut self) -> Option<T> {
        while self.front < self.back {
            let it = self.list.at(self.front);
            self.front += 1;
            if !it.is_synthetic() {
                return Some(it);
            }
        }
        None
    }

    #[inline(never)]
    fn next_back_non_synthetic(&mut self) -> Option<T> {
        while self.front < self.back {
            self.back -= 1;
            let it = self.list.at(self.back);
            if !it.is_synthetic() {
                return Some(it);
            }
        }
        None
    }
}
