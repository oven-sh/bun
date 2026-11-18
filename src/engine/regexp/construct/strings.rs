//! The members of a class that are not single characters.

use crate::Error;

const MAX_CHARACTERS: usize = 1 << 22;

#[derive(Clone, Copy)]
pub(super) struct StringSpan {
    start: u32,
    end: u32,
}

#[derive(Default)]
pub(super) struct StringPool {
    characters: Vec<u32>,
    string_start: usize,
}

impl StringPool {
    #[inline]
    pub(super) fn push(&mut self, c: u32) -> Result<(), Error> {
        if self.characters.len() == MAX_CHARACTERS {
            return Err(Error::PatternTooLarge);
        }
        self.characters
            .try_reserve(1)
            .map_err(|_| Error::OutOfMemory)?;
        self.characters.push(c);
        Ok(())
    }

    pub(super) fn end_string(&mut self) -> StringSpan {
        let end = self.characters.len();
        StringSpan {
            start: core::mem::replace(&mut self.string_start, end) as u32,
            end: end as u32,
        }
    }

    /// If that is all that the string has.
    pub(super) fn take_single_character(&mut self) -> Option<u32> {
        let is_single = self.characters.len() == self.string_start + 1;
        self.characters.pop_if(|_| is_single)
    }

    #[inline]
    fn get(&self, span: StringSpan) -> &[u32] {
        &self.characters[span.start as usize..span.end as usize]
    }
}

#[derive(Default)]
pub(super) struct StringList {
    spans: Vec<StringSpan>,
    is_sorted: bool,
}

impl StringList {
    #[inline]
    pub(super) fn len(&self) -> usize {
        self.spans.len()
    }

    pub(super) fn push(&mut self, span: StringSpan) -> Result<(), Error> {
        self.spans.try_reserve(1).map_err(|_| Error::OutOfMemory)?;
        self.spans.push(span);
        self.is_sorted = false;
        Ok(())
    }

    pub(super) fn append(&mut self, mut other: StringList) -> Result<(), Error> {
        if self.spans.is_empty() {
            *self = other;
        } else if !other.spans.is_empty() {
            self.spans
                .try_reserve(other.len())
                .map_err(|_| Error::OutOfMemory)?;
            self.spans.append(&mut other.spans);
            self.is_sorted = false;
        }
        Ok(())
    }

    fn sort(&mut self, pool: &StringPool) {
        if !core::mem::replace(&mut self.is_sorted, true) {
            self.spans
                .sort_unstable_by(|&a, &b| pool.get(a).cmp(pool.get(b)));
            self.spans.dedup_by(|a, b| pool.get(*a) == pool.get(*b));
        }
    }

    /// Keeps those that `other` has too, or those that it does not have. Returns about the number of steps.
    pub(super) fn filter(
        &mut self,
        mut other: StringList,
        keeps_common: bool,
        pool: &StringPool,
    ) -> usize {
        if self.spans.is_empty() || other.spans.is_empty() {
            if keeps_common {
                self.spans.clear();
            }
            return 0;
        }
        self.sort(pool);
        other.sort(pool);
        let mut steps = other.len();
        let mut rest = &other.spans[..];
        self.spans.retain(|&span| {
            let string = pool.get(span);
            steps += string.len() + 1;
            let smaller = rest.iter().take_while(|&&it| pool.get(it) < string);
            rest = &rest[smaller.count()..];
            rest.first().is_some_and(|&it| pool.get(it) == string) == keeps_common
        });
        steps
    }
}

pub(super) struct Strings {
    pool: StringPool,
    list: StringList,
}

impl Strings {
    pub(super) fn new(pool: StringPool, list: StringList) -> Strings {
        Strings { pool, list }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.list.spans.is_empty()
    }

    /// Ascending, each once, and read from the end if `reversed`.
    pub(super) fn sorted(&mut self, reversed: bool) -> impl Iterator<Item = &[u32]> {
        if reversed {
            for span in &self.list.spans {
                self.pool.characters[span.start as usize..span.end as usize].reverse();
            }
            self.list.is_sorted = false;
        }
        self.list.sort(&self.pool);
        self.list.spans.iter().map(|&span| self.pool.get(span))
    }
}
