//! Where the highlighter of a language puts what it finds.

use super::Token;

/// `token` covers the bytes from `start` to `end`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Span {
    pub start: u32,
    pub end: u32,
    pub token: Token,
}

/// Collects spans in any order. A span inside another one wins over it, so an escape sequence is
/// added on top of its string and embedded code on top of the text it is in. Of two spans with the
/// same range the one added last wins. [`Spans::finish`] cuts them into pieces that don't overlap.
#[derive(Default)]
pub struct Spans {
    list: Vec<Span>,
    flat: Vec<Span>,
    open: Vec<Span>,
    /// Added to every offset: where the code being highlighted starts in the whole text.
    pub(super) base: u32,
    /// Where that code ends in the whole text.
    pub(super) limit: u32,
    needs_sort: bool,
    needs_flattening: bool,
}

impl Spans {
    pub(super) fn reset(&mut self, len: u32) {
        self.list.clear();
        self.flat.clear();
        (self.base, self.limit) = (0, len);
        (self.needs_sort, self.needs_flattening) = (false, false);
    }

    /// Offsets are relative to the code that the highlighter was given.
    #[inline]
    pub(crate) fn add(&mut self, start: u32, end: u32, token: Token) {
        let start = self.base.saturating_add(start);
        let end = self.base.saturating_add(end).min(self.limit);
        if start >= end {
            return;
        }
        if let Some(last) = self.list.last() {
            self.needs_flattening |= start < last.end;
            self.needs_sort |= start < last.start || start == last.start && end > last.end;
        }
        self.list.push(Span { start, end, token });
    }

    /// [`Spans::add`] for a parser that counts in `usize`.
    #[inline]
    pub(crate) fn add_range(&mut self, range: std::ops::Range<usize>, token: Token) {
        let limit = u32::MAX as usize;
        self.add(
            range.start.min(limit) as u32,
            range.end.min(limit) as u32,
            token,
        );
    }

    /// Sorted by `start`, and no two overlap.
    pub(super) fn finish(&mut self) -> &[Span] {
        if !self.needs_flattening {
            return &self.list;
        }
        if self.needs_sort {
            crate::sort::sort_by(&mut self.list, |a, b| {
                a.start.cmp(&b.start).then(b.end.cmp(&a.end))
            });
        }
        let Spans {
            list, flat, open, ..
        } = self;
        flat.reserve(list.len());
        open.clear();
        // In `open`, `start` is where the part of the span begins that nothing inside it has covered.
        let mut emit = |span: Span| {
            if span.start < span.end {
                flat.push(span);
            }
        };
        for &(mut span) in list.iter() {
            while let Some(&outer) = open.last()
                && outer.end <= span.start
            {
                emit(outer);
                open.pop();
            }
            if let Some(outer) = open.last_mut() {
                span.end = span.end.min(outer.end);
                emit(Span {
                    end: span.start,
                    ..*outer
                });
                outer.start = span.end;
            }
            open.push(span);
        }
        while let Some(outer) = open.pop() {
            emit(outer);
        }
        flat
    }
}
