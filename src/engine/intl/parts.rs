use bun_engine_text::{StringRef, Text};
use bun_icu::Buffer;
use smallvec::SmallVec;

use crate::{Error, Result};

named_enum! {
    pub enum PartKind {
        ApproximatelySign = "approximatelySign",
        Compact = "compact",
        Currency = "currency",
        Day = "day",
        DayPeriod = "dayPeriod",
        Decimal = "decimal",
        Element = "element",
        Era = "era",
        ExponentInteger = "exponentInteger",
        ExponentMinusSign = "exponentMinusSign",
        ExponentSeparator = "exponentSeparator",
        Fraction = "fraction",
        FractionalSecond = "fractionalSecond",
        Group = "group",
        Hour = "hour",
        Infinity = "infinity",
        Integer = "integer",
        Literal = "literal",
        MinusSign = "minusSign",
        Minute = "minute",
        Month = "month",
        Nan = "nan",
        PercentSign = "percentSign",
        PlusSign = "plusSign",
        RelatedYear = "relatedYear",
        Second = "second",
        TimeZoneName = "timeZoneName",
        Unit = "unit",
        Unknown = "unknown",
        Weekday = "weekday",
        Year = "year",
        YearName = "yearName",
    }
}

named_enum! {
    pub enum Source {
        StartRange = "startRange",
        EndRange = "endRange",
        Shared = "shared",
    }
}

named_enum! {
    pub enum TimeUnit {
        Year = "year",
        Quarter = "quarter",
        Month = "month",
        Week = "week",
        Day = "day",
        Hour = "hour",
        Minute = "minute",
        Second = "second",
        Millisecond = "millisecond",
        Microsecond = "microsecond",
        Nanosecond = "nanosecond",
    }
}

/// The properties of an element of the result of `formatToParts` but its value.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Part {
    pub kind: PartKind,
    pub unit: Option<TimeUnit>,
    pub source: Option<Source>,
}

impl From<PartKind> for Part {
    fn from(kind: PartKind) -> Part {
        Part {
            kind,
            unit: None,
            source: None,
        }
    }
}

#[derive(Default)]
pub struct Parts {
    text: Buffer<u16>,
    /// Each with the index in `text` that it ends at.
    parts: SmallVec<[(Part, u32); 8]>,
}

impl Parts {
    /// Does nothing if `value` is empty.
    pub(crate) fn push(&mut self, part: impl Into<Part>, value: &[u16]) -> Result<()> {
        if value.is_empty() {
            return Ok(());
        }
        let end = u32::try_from(self.text.len() + value.len()).map_err(|_| Error::OutOfMemory)?;
        self.text.try_reserve(value.len())?;
        self.parts.try_reserve(1)?;
        self.text.extend_from_slice(value);
        self.parts.push((part.into(), end));
        Ok(())
    }

    /// The values of all parts, joined.
    pub(crate) fn text(&self) -> &[u16] {
        &self.text
    }

    pub(crate) fn slices(&self) -> impl ExactSizeIterator<Item = (Part, &[u16])> {
        let mut start = 0;
        self.parts.iter().map(move |&(part, end)| {
            let value = &self.text[start..end as usize];
            start = end as usize;
            (part, value)
        })
    }

    pub fn iter(&self) -> impl ExactSizeIterator<Item = Result<(Part, StringRef)>> {
        (self.slices()).map(|(part, value)| Ok((part, new_string(value)?)))
    }
}

pub(crate) fn new_string(units: &[u16]) -> Result<StringRef> {
    match *units {
        [unit @ ..=0xff] => Ok(StringRef::single_character(unit as u8)),
        _ => Ok(StringRef::try_narrowed(Text::Utf16(units))?),
    }
}
