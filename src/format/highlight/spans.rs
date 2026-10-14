//! Collects the spans that a language's highlighter finds.

use super::Token;

/// `token` covers the bytes from `start` to `end`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Span {
    pub start: u32,
    pub end: u32,
    pub token: Token,
}

/// Spans can be added in any order and can nest. An inner span wins over the one around it, so an escape sequence goes
/// on top of its string. If two spans have the same range, the one added last wins. [`Spans::finish`] cuts them into
/// pieces that don't overlap.
#[derive(Default)]
pub struct Spans {
    list: Vec<Span>,
    flat: Vec<Span>,
    open: Vec<Span>,
    /// Where the code being highlighted starts in the whole text. Added to every offset.
    pub(super) base: u32,
    /// Where that code ends in the whole text.
    pub(super) limit: u32,
    /// A bit for the language being highlighted and for each language around it.
    pub(super) once: u32,
    /// A bit for each of them that is there twice.
    pub(super) twice: u32,
    needs_sort: bool,
    needs_flattening: bool,
}

impl Spans {
    pub(super) fn reset(&mut self, len: u32) {
        self.list.clear();
        self.flat.clear();
        (self.base, self.limit, self.once, self.twice) = (0, len, 0, 0);
        (self.needs_sort, self.needs_flattening) = (false, false);
    }

    /// Offsets are relative to the code that the highlighter was called with.
    #[inline]
    pub(crate) fn add(&mut self, start: u32, end: u32, token: Token) {
        let start = self.base.saturating_add(start);
        let end = self.base.saturating_add(end).min(self.limit);
        if start >= end {
            return;
        }
        if let Some(last) = self.list.last_mut() {
            // `</` is two tokens to the parser, and so is `))`.
            if last.end == start && last.token == token && !self.needs_flattening {
                last.end = end;
                return;
            }
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

    /// Returns the spans sorted by `start`, without overlaps.
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
        // `open` is the stack of spans around the current position. Each one's `start` moves past the inner spans.
        let mut emit = |span: Span| match flat.last_mut() {
            _ if span.start >= span.end => {}
            Some(last) if last.end == span.start && last.token == span.token => last.end = span.end,
            _ => flat.push(span),
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
