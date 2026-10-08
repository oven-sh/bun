//! Lists of nodes.

use super::{File, Handle};
use crate::span::Spanned;
use bun_sema::hir;
use std::marker::PhantomData;

/// The children of a node that come in a list: arguments, statements, members.
#[derive(Copy, Clone)]
pub struct List<'a, T> {
    file: &'a File<'a>,
    start: u32,
    len: u32,
    /// The elements are `Hir::ids[start..]`, not `start..` themselves.
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

    #[inline]
    pub fn iter(self) -> Iter<'a, T> {
        Iter {
            list: self,
            front: 0,
            back: self.len,
            hides: self.file.has_synthetic_nodes(),
        }
    }

    #[inline]
    pub fn len(self) -> usize {
        match self.file.has_synthetic_nodes() {
            true => self.count_written(),
            false => self.len as usize,
        }
    }

    #[inline(never)]
    fn count_written(self) -> usize {
        self.iter().count()
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn get(self, i: usize) -> Option<T> {
        match self.file.has_synthetic_nodes() {
            true => self.get_written(i),
            false => (i < self.len as usize).then(|| self.at(i as u32)),
        }
    }

    #[inline(never)]
    fn get_written(self, i: usize) -> Option<T> {
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

/// For a list whose elements are in the order of the source and do not overlap. Each takes the logarithm of its length.
impl<'a, T: Handle<'a> + Spanned> List<'a, T> {
    /// How many elements start at or before `offset`, those that lists leave out too.
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

    /// The whole list, or if it is long and `offset` is given, only the last element that starts at or before `offset`.
    pub(super) fn near(self, offset: Option<u32>) -> Iter<'a, T> {
        let mut all = self.iter();
        if let Some(offset) = offset
            && self.len > 8
            && !all.hides
        {
            all.back = self.count_until(offset);
            all.front = all.back.saturating_sub(1);
        }
        all
    }

    /// The element that `offset` is in.
    pub fn around(self, offset: u32) -> Option<T> {
        let it = self.at(self.count_until(offset).checked_sub(1)?);
        (offset < it.span().end && !it.is_synthetic()).then_some(it)
    }

    /// The index of the element that starts at `start`. It counts the elements before it in a file that has nodes which are
    /// synthesized from JSDoc comments.
    pub fn index_of_start(self, start: u32) -> Option<usize> {
        let at = self.count_until(start).checked_sub(1)?;
        let it = self.at(at);
        if it.span().start != start || it.is_synthetic() {
            return None;
        }
        let mut before = self.iter();
        before.back = at;
        Some(if before.hides {
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
    /// Whether some elements may be synthesized from JSDoc comments, which are left out.
    hides: bool,
}

impl<'a, T: Handle<'a>> Iterator for Iter<'a, T> {
    type Item = T;

    #[inline]
    fn next(&mut self) -> Option<T> {
        if self.hides {
            return self.next_written();
        }
        (self.front < self.back).then(|| {
            self.front += 1;
            self.list.at(self.front - 1)
        })
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let rest = (self.back - self.front) as usize;
        (if self.hides { 0 } else { rest }, Some(rest))
    }
}

impl<'a, T: Handle<'a>> DoubleEndedIterator for Iter<'a, T> {
    #[inline]
    fn next_back(&mut self) -> Option<T> {
        if self.hides {
            return self.next_back_written();
        }
        (self.front < self.back).then(|| {
            self.back -= 1;
            self.list.at(self.back)
        })
    }
}

/// In a file that has nodes which are synthesized from JSDoc comments.
impl<'a, T: Handle<'a>> Iter<'a, T> {
    #[inline(never)]
    fn next_written(&mut self) -> Option<T> {
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
    fn next_back_written(&mut self) -> Option<T> {
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
