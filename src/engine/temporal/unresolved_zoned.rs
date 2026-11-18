use bun_engine_date::TimeZone;

use crate::parse::{self, Offset};
use crate::time_zone::{LocalInstant, LocalTime, PossibleInstants, TimeZoneRules};
use crate::unit::{NANOSECONDS_PER_MINUTE, NANOSECONDS_PER_SECOND};
use crate::{
    CalendarId, Disambiguation, Error, Instant, IsoDate, IsoDateTime, OffsetOption, PlainTime,
    Result, RoundingMode, ZonedDateTime,
};

/// A local date and time in a zone, and what was said about its offset.
#[derive(Clone, Copy)]
pub struct UnresolvedZonedDateTime {
    pub(crate) date: IsoDate,
    /// The start of the day if there is none.
    pub(crate) time: Option<PlainTime>,
    pub(crate) offset: Offset,
    pub(crate) time_zone: TimeZone,
    pub(crate) calendar: CalendarId,
}

impl UnresolvedZonedDateTime {
    pub(crate) fn parsed(
        parsed: &parse::DateTime<'_>,
        time_zone: TimeZone,
        calendar: CalendarId,
    ) -> UnresolvedZonedDateTime {
        UnresolvedZonedDateTime {
            date: parsed.date,
            time: parsed.time,
            offset: parsed.offset,
            time_zone,
            calendar,
        }
    }

    /// An offset that does not come from a date and time string has to match exactly.
    pub(crate) fn with_exact_offset(
        date_time: IsoDateTime,
        offset_nanoseconds: Option<i64>,
        time_zone: TimeZone,
        calendar: CalendarId,
    ) -> UnresolvedZonedDateTime {
        UnresolvedZonedDateTime {
            date: date_time.date,
            time: Some(date_time.time),
            offset: offset_nanoseconds.map_or(Offset::Absent, |nanoseconds| Offset::Numeric {
                nanoseconds,
                has_seconds: true,
            }),
            time_zone,
            calendar,
        }
    }

    /// InterpretISODateTimeOffset
    pub fn finish(
        self,
        disambiguation: Disambiguation,
        offset_option: OffsetOption,
    ) -> Result<ZonedDateTime> {
        let local = self.interpret(disambiguation, offset_option)?;
        Ok(ZonedDateTime::from_local(
            local,
            self.time_zone,
            self.calendar,
        ))
    }

    fn interpret(
        &self,
        disambiguation: Disambiguation,
        offset_option: OffsetOption,
    ) -> Result<LocalInstant> {
        let (date, time_zone) = (self.date, self.time_zone);
        let Some(time) = self.time else {
            return time_zone.start_of_day(date);
        };
        let date_time = IsoDateTime { date, time };
        let at_given_offset = |nanoseconds: i64| {
            Instant::new(date_time.utc_epoch_nanoseconds() - i128::from(nanoseconds))
                .map(|instant| time_zone.localize(instant))
                .ok_or(Error::OffsetDateTimeOutOfRange)
        };
        let (given, is_exact) = match (self.offset, offset_option) {
            (Offset::Utc, _) => return at_given_offset(0),
            (Offset::Absent, _) | (_, OffsetOption::Ignore) => {
                return time_zone.instant_for(date_time, disambiguation);
            }
            (Offset::Numeric { nanoseconds, .. }, OffsetOption::Use) => {
                return at_given_offset(nanoseconds);
            }
            (
                Offset::Numeric {
                    nanoseconds,
                    has_seconds,
                },
                _,
            ) => (nanoseconds, has_seconds),
        };
        if !date.is_within_days_range() {
            return Err(Error::WallClockDateOutOfRange);
        }

        let matches = |candidate: LocalInstant| {
            let actual = i64::from(candidate.offset_seconds) * NANOSECONDS_PER_SECOND;
            actual == given
                || (!is_exact
                    && RoundingMode::HalfExpand.round(actual.into(), NANOSECONDS_PER_MINUTE.into())
                        == i128::from(given))
        };
        let local_time = LocalTime::from(date_time);
        match time_zone.possible_instants(local_time)? {
            PossibleInstants::One(first) | PossibleInstants::Two(first, _) if matches(first) => {
                Ok(first)
            }
            PossibleInstants::Two(_, second) if matches(second) => Ok(second),
            _ if offset_option == OffsetOption::Reject => Err(Error::OffsetContradictsTimeZone),
            possible => time_zone.disambiguate(&possible, local_time, disambiguation),
        }
    }
}
