//! The replacement templates of GetSubstitution of ECMA-262.

use core::ops::Range;

use bun_engine_text::{AllocError, CodeUnit, StringBuilder, Text};
use smallvec::SmallVec;

use crate::GroupNames;

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Part {
    /// Of the template.
    Literal(Range<usize>),
    Match,
    Before,
    After,
    /// From 1 up to the number of groups.
    Group(usize),
    /// Where the name is in the template.
    Name(Range<usize>),
}

struct Parts<'a> {
    text: Text<'a>,
    at: usize,
    group_count: usize,
    /// Cleared once no `>` is left.
    may_have_name: bool,
    pending: Option<Part>,
}

impl Parts<'_> {
    #[inline(always)]
    fn find_dollar(&self, from: usize) -> Option<usize> {
        const SHORT: usize = 16;
        if self.text.len() - from > SHORT {
            return self.text.find_unit(b'$'.into(), from);
        }
        (from..self.text.len()).find(|&at| self.text.at(at).is(b'$'))
    }

    /// What the `$` at `dollar` starts, and where that ends.
    #[inline(always)]
    fn reference(&mut self, dollar: usize) -> Option<(Part, usize)> {
        let unit = self.text.get(dollar + 1)?;
        let part = match u8::try_from(unit).ok()? {
            b'$' => Part::Literal(dollar..dollar + 1),
            b'&' => Part::Match,
            b'`' => Part::Before,
            b'\'' => Part::After,
            b'<' if self.may_have_name => {
                let end = self.text.find_unit(b'>'.into(), dollar + 2);
                self.may_have_name = end.is_some();
                return end.map(|end| (Part::Name(dollar + 2..end), end + 1));
            }
            digit @ b'0'..=b'9' => {
                let first = usize::from(digit - b'0');
                let second = self.text.get(dollar + 2).and_then(|it| it.digit_value(10));
                let both = second.map(|second| first * 10 + second as usize);
                let (group, end) = match both.filter(|&both| both <= self.group_count) {
                    Some(both) => (both, dollar + 3),
                    None => (first, dollar + 2),
                };
                let exists = (1..=self.group_count).contains(&group);
                return exists.then_some((Part::Group(group), end));
            }
            _ => return None,
        };
        Some((part, dollar + 2))
    }
}

impl Iterator for Parts<'_> {
    type Item = Part;

    #[inline(always)]
    fn next(&mut self) -> Option<Part> {
        if let Some(part) = self.pending.take() {
            return Some(part);
        }
        let start = self.at;
        let mut from = start;
        while let Some(dollar) = self.find_dollar(from) {
            let Some((part, end)) = self.reference(dollar) else {
                from = dollar + 1;
                continue;
            };
            self.at = end;
            return Some(match part {
                Part::Literal(dollar) => Part::Literal(start..dollar.end),
                part if start == dollar => part,
                part => {
                    self.pending = Some(part);
                    Part::Literal(start..dollar)
                }
            });
        }
        self.at = self.text.len();
        (start < self.at).then_some(Part::Literal(start..self.at))
    }
}

enum Piece<'a> {
    Literal(Text<'a>),
    Match,
    Before,
    After,
    Group(u16),
    OneOfGroups(&'a [u16]),
}

impl<'a> Piece<'a> {
    #[inline(always)]
    fn new(part: Part, template: Text<'a>, names: &'a GroupNames) -> Piece<'a> {
        match part {
            Part::Literal(range) => Piece::Literal(template.slice(range)),
            Part::Match => Piece::Match,
            Part::Before => Piece::Before,
            Part::After => Piece::After,
            Part::Group(group) => Piece::Group(group as u16),
            Part::Name(range) => {
                Piece::OneOfGroups(names.find(template.slice(range)).unwrap_or_default())
            }
        }
    }

    #[inline(always)]
    fn append(
        &self,
        result: &mut StringBuilder,
        subject: Text<'_>,
        matched: &Range<usize>,
        captures: &[u32],
    ) {
        let capture = |group: u16| {
            let index = (usize::from(group) - 1) * 2;
            let (start, end) = (captures[index], captures[index + 1]);
            (start != u32::MAX).then_some(start as usize..end as usize)
        };
        let (source, range) = match *self {
            Piece::Literal(text) => (text, Some(0..text.len())),
            Piece::Match => (subject, Some(matched.clone())),
            Piece::Before => (subject, Some(0..matched.start)),
            Piece::After => (subject, Some(matched.end..subject.len())),
            Piece::Group(group) => (subject, capture(group)),
            Piece::OneOfGroups(groups) => (subject, groups.iter().find_map(|&it| capture(it))),
        };
        if let Some(range) = range {
            result.push_text(source.slice(range));
        }
    }
}

/// A template that is taken apart once for all the matches of a pattern. The default is empty.
#[derive(Default)]
pub struct Template<'a> {
    pieces: SmallVec<[Piece<'a>; 8]>,
}

impl<'a> Template<'a> {
    /// `has_names`: whether the match has an object for `groups`.
    #[inline(always)]
    pub fn parts(
        text: Text<'a>,
        group_count: usize,
        has_names: bool,
    ) -> impl Iterator<Item = Part> {
        Parts {
            text,
            at: 0,
            group_count,
            may_have_name: has_names,
            pending: None,
        }
    }

    /// Adds to it where it is, because it is large.
    pub fn parse(
        &mut self,
        text: Text<'a>,
        group_count: u16,
        names: &'a GroupNames,
    ) -> Result<(), AllocError> {
        for part in Template::parts(text, group_count.into(), !names.is_empty()) {
            self.pieces.try_reserve(1).map_err(|_| AllocError)?;
            self.pieces.push(Piece::new(part, text, names));
        }
        Ok(())
    }

    /// `matched` and `captures` are what a match of the pattern in `subject` has left.
    pub fn append(
        &self,
        result: &mut StringBuilder,
        subject: Text<'_>,
        matched: Range<usize>,
        captures: &[u32],
    ) {
        for piece in &self.pieces {
            piece.append(result, subject, &matched, captures);
        }
    }

    /// `parse` and `append` for a single match.
    pub fn expand(
        text: Text<'_>,
        names: &GroupNames,
        result: &mut StringBuilder,
        subject: Text<'_>,
        matched: Range<usize>,
        captures: &[u32],
    ) {
        for part in Template::parts(text, captures.len() / 2, !names.is_empty()) {
            Piece::new(part, text, names).append(result, subject, &matched, captures);
        }
    }
}
