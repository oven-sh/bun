//! Patterns that a plain search matches, without a program.

mod recognize;
mod scan;

use core::ops::{ControlFlow, Range};

use bun_engine_text::{Text, with_text};

use scan::{Members, Unit};

/// Has no groups, is not sticky and never matches the empty string.
pub struct Form(Kind);

enum Kind {
    Atom(Atom),
    /// `\r\n|x`, where `x` matches `\r`
    LineBreak(Members),
    /// `\r?\n`
    LineFeed,
    /// `x` or `x+`
    Anywhere(Repetition),
    /// `^x`, `x$` or `^x|x$`, or the same with `x+`
    AtEdges {
        repetition: Repetition,
        at_start: bool,
        at_end: bool,
    },
}

struct Atom {
    /// Nothing if a character is wider.
    latin1: Option<Box<[u8]>>,
    utf16: Box<[u16]>,
    /// A start between the halves of a pair counts as the start of the pair.
    starts_with_pair: bool,
}

struct Repetition {
    members: Members,
    is_run: bool,
}

impl Form {
    /// Up to this length it matters more how quickly a search starts than how quickly it goes on.
    pub const SHORT: usize = 512;

    /// The only text that matches.
    pub fn atom(&self) -> Option<Text<'_>> {
        match &self.0 {
            Kind::Atom(atom) => Some(match &atom.latin1 {
                Some(latin1) => Text::Latin1(latin1),
                None => Text::Utf16(&atom.utf16),
            }),
            _ => None,
        }
    }

    /// Whether machine code is better for a short subject.
    pub fn suits_machine_code(&self) -> bool {
        const MAX_LENGTH: usize = 32;
        match &self.0 {
            Kind::Atom(atom) => atom.utf16.len() <= MAX_LENGTH,
            Kind::LineBreak(_) | Kind::LineFeed | Kind::Anywhere(_) => true,
            Kind::AtEdges {
                at_start, at_end, ..
            } => at_start != at_end,
        }
    }

    /// Whether it finds all matches in a subject of that length more quickly than machine code does.
    #[inline]
    pub fn finds_all_quickly(&self, length: usize) -> bool {
        match &self.0 {
            _ if length > Form::SHORT => true,
            Kind::Anywhere(it) => it.members.are_several_and_common(),
            _ => false,
        }
    }

    /// The first match from `start` on.
    #[inline]
    pub fn find(&self, subject: Text<'_>, start: usize) -> Option<Range<usize>> {
        with_text!(subject, |units| self.find_in(units, start))
    }

    /// All matches from `start` on, each after the one before.
    pub fn for_each(
        &self,
        subject: Text<'_>,
        start: usize,
        mut each: impl FnMut(Range<usize>) -> ControlFlow<()>,
    ) {
        with_text!(subject, |units| {
            let mut start = start;
            while let Some(found) = self.find_in(units, start) {
                start = found.end;
                if each(found).is_break() {
                    break;
                }
            }
        })
    }

    /// The number of matches from `start` on, and the last one.
    pub fn count(&self, subject: Text<'_>, start: usize) -> (usize, Option<Range<usize>>) {
        if let Kind::Atom(atom) = &self.0
            && let [unit] = *atom.utf16
            && start <= subject.len()
        {
            let rest = subject.slice_from(start);
            let last = rest.rfind_unit(unit, rest.len());
            let before_last = rest.slice(0..last.unwrap_or(0));
            let count = with_text!(before_last, |units| Unit::count(units, unit));
            let last = last.map(|last| start + last..start + last + 1);
            return (count + usize::from(last.is_some()), last);
        }
        let (mut count, mut last) = (0, None);
        self.for_each(subject, start, |found| {
            (count, last) = (count + 1, Some(found));
            ControlFlow::Continue(())
        });
        (count, last)
    }

    #[inline(always)]
    fn find_in<C: Unit>(&self, units: &[C], start: usize) -> Option<Range<usize>> {
        let rest = units.get(start..)?;
        match &self.0 {
            Kind::Atom(atom) => atom.find(units, start),
            Kind::LineBreak(members) => {
                let at = start + members.find(rest)?;
                let is_pair =
                    units[at].is(b'\r') && units.get(at + 1).is_some_and(|it| it.is(b'\n'));
                Some(at..at + 1 + usize::from(is_pair))
            }
            Kind::LineFeed => {
                let at = C::find_unit(rest, b'\n'.into())?;
                let is_pair = at > 0 && rest[at - 1].is(b'\r');
                Some(start + at - usize::from(is_pair)..start + at + 1)
            }
            Kind::Anywhere(repetition) => {
                let at = start + repetition.members.find(rest)?;
                let more = match repetition.is_run {
                    true => repetition.members.leading(&units[at + 1..]),
                    false => 0,
                };
                Some(at..at + 1 + more)
            }
            Kind::AtEdges {
                repetition: Repetition { members, is_run },
                at_start,
                at_end,
            } => {
                let reach = if *is_run {
                    rest.len()
                } else {
                    rest.len().min(1)
                };
                if *at_start && start == 0 {
                    let length = members.leading(&rest[..reach]);
                    if length > 0 {
                        return Some(0..length);
                    }
                }
                let reach = if *at_end { reach } else { 0 };
                let length = members.trailing(&rest[rest.len() - reach..]);
                (length > 0).then(|| units.len() - length..units.len())
            }
        }
    }
}

impl Atom {
    #[inline(always)]
    fn find<C: Unit>(&self, units: &[C], mut start: usize) -> Option<Range<usize>> {
        let needle = C::select(self.latin1.as_deref(), &self.utf16)?;
        if self.starts_with_pair && start > 0 && units[start - 1..].starts_with(needle) {
            start -= 1;
        }
        let at = match *needle {
            [unit] => C::find_unit(&units[start..], unit.to_u16()),
            _ => C::find_units(&units[start..], needle),
        };
        at.map(|at| start + at..start + at + needle.len())
    }
}
