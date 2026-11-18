//! From what ICU wrote to strings and parts.

use core::ops::Range;

use bun_icu::date_format::field;
use smallvec::SmallVec;

use crate::{Part, PartKind, Parts, Result, Source};

/// Has room for nearly every date, because one that does not fit is formatted twice.
pub(super) type DateText = SmallVec<[u16; 128]>;

/// Much code that parses dates knows no other space.
pub(super) fn use_plain_spaces(text: &mut [u16]) {
    const THIN_SPACE: u16 = 0x2009;
    const NARROW_NO_BREAK_SPACE: u16 = 0x202f;
    for unit in text {
        if matches!(*unit, THIN_SPACE | NARROW_NO_BREAK_SPACE) {
            *unit = b' '.into();
        }
    }
}

fn part_kind(date_field: i32) -> PartKind {
    match date_field {
        field::ERA => PartKind::Era,
        field::YEAR | field::EXTENDED_YEAR | field::YEAR_OF_WEEK => PartKind::Year,
        field::YEAR_NAME => PartKind::YearName,
        field::RELATED_YEAR => PartKind::RelatedYear,
        field::MONTH | field::STANDALONE_MONTH => PartKind::Month,
        field::DAY => PartKind::Day,
        field::WEEKDAY | field::LOCAL_WEEKDAY | field::STANDALONE_WEEKDAY => PartKind::Weekday,
        field::AM_PM | field::AM_PM_NOON | field::FLEXIBLE_DAY_PERIOD => PartKind::DayPeriod,
        field::HOUR_0_TO_11 | field::HOUR_1_TO_12 | field::HOUR_0_TO_23 | field::HOUR_1_TO_24 => {
            PartKind::Hour
        }
        field::MINUTE => PartKind::Minute,
        field::SECOND => PartKind::Second,
        field::FRACTIONAL_SECOND => PartKind::FractionalSecond,
        field::ZONE_SPECIFIC
        | field::ZONE_GENERIC
        | field::ZONE_LOCALIZED_OFFSET
        | field::ZONE_SPECIAL
        | field::ZONE_RFC
        | field::ZONE_ISO
        | field::ZONE_ISO_LOCAL => PartKind::TimeZoneName,
        _ => PartKind::Unknown,
    }
}

/// Takes the fields of `text` in order. What is between them is literal.
pub(super) struct PartSplitter<'a> {
    text: &'a [u16],
    done: usize,
    parts: Parts,
}

impl<'a> PartSplitter<'a> {
    pub(super) fn new(text: &'a [u16]) -> PartSplitter<'a> {
        PartSplitter {
            text,
            done: 0,
            parts: Parts::default(),
        }
    }

    /// Where the next part starts.
    pub(super) fn position(&self) -> usize {
        self.done
    }

    pub(super) fn push(
        &mut self,
        kind: PartKind,
        value: &[u16],
        source: Option<Source>,
    ) -> Result<()> {
        let unit = None;
        self.parts.push(Part { kind, unit, source }, value)
    }

    pub(super) fn push_literal_until(&mut self, end: usize, source: Option<Source>) -> Result<()> {
        let literal = self.text.get(self.done..end).unwrap_or_default();
        self.done += literal.len();
        self.push(PartKind::Literal, literal, source)
    }

    /// After the literal in front of it.
    pub(super) fn push_field(
        &mut self,
        date_field: i32,
        range: Range<usize>,
        replacement: Option<&[u16]>,
        source: Option<Source>,
    ) -> Result<()> {
        self.done = range.end;
        let value = replacement.or_else(|| self.text.get(range));
        self.push(part_kind(date_field), value.unwrap_or_default(), source)
    }

    pub(super) fn finish(self) -> Parts {
        self.parts
    }
}
