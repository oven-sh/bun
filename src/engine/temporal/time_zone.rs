use core::cmp::Ordering;

use bun_engine_date::{LocalOffsets, TimeZone, TimeZoneId};
use bun_engine_text::Text;

use crate::parse::{self, Offset, ZoneIdentifier};
use crate::unit::{NANOSECONDS_PER_MINUTE, NANOSECONDS_PER_SECOND};
use crate::{
    Direction, Disambiguation, Error, InputError, Instant, IsoDate, IsoDateTime, Result, TextError,
};

impl ZoneIdentifier<'_> {
    pub(crate) fn resolve(self) -> Option<TimeZone> {
        match self {
            ZoneIdentifier::Name(name) => TimeZoneId::find(name).map(TimeZone::Named),
            ZoneIdentifier::OffsetMinutes(minutes) => Some(TimeZone::Offset { minutes }),
        }
    }
}

/// By an identifier: an offset in whole minutes or an available name.
pub fn find_time_zone(identifier: Text<'_>) -> Option<TimeZone> {
    parse::time_zone_identifier(identifier)?.resolve()
}

/// ToTemporalTimeZoneIdentifier of a string.
pub fn parse_time_zone(text: Text<'_>) -> Result<TimeZone, InputError<'_>> {
    match parse::time_zone_identifier(text) {
        Some(identifier) => identifier.resolve(),
        None => parse::any_date_or_time(text).and_then(|parsed| time_zone_of(&parsed)),
    }
    .ok_or(InputError::Text(TextError::TimeZone, text))
}

/// The last steps of ParseTemporalTimeZoneString.
fn time_zone_of(parsed: &parse::DateTime<'_>) -> Option<TimeZone> {
    if let Some(identifier) = parsed.annotations.time_zone {
        return identifier.resolve();
    }
    match parsed.offset {
        Offset::Utc => Some(TimeZone::Named(TimeZoneId::UTC)),
        Offset::Numeric {
            nanoseconds,
            has_seconds: false,
        } => Some(TimeZone::Offset {
            minutes: (nanoseconds / NANOSECONDS_PER_MINUTE) as i16,
        }),
        _ => None,
    }
}

/// An instant, and what the clocks of a zone are ahead of UTC at it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct LocalInstant {
    pub(crate) instant: Instant,
    pub(crate) offset_seconds: i32,
}

/// The result of GetPossibleEpochNanoseconds.
#[derive(Clone, Copy)]
pub(crate) enum PossibleInstants {
    One(LocalInstant),
    Two(LocalInstant, LocalInstant),
    None { gap_seconds: i32 },
}

/// The reading of a clock, counted as if it were that of UTC.
#[derive(Clone, Copy)]
pub(crate) struct LocalTime {
    seconds: i64,
    nanoseconds: u32,
}

impl From<IsoDateTime> for LocalTime {
    #[inline]
    fn from(date_time: IsoDateTime) -> LocalTime {
        LocalTime {
            seconds: date_time.utc_epoch_seconds(),
            nanoseconds: date_time.time.nanosecond_of_second(),
        }
    }
}

impl LocalTime {
    #[inline]
    fn at_offset(self, offset_seconds: i32) -> Result<LocalInstant> {
        let seconds = i128::from(self.seconds - i64::from(offset_seconds));
        Instant::new(seconds * i128::from(NANOSECONDS_PER_SECOND) + i128::from(self.nanoseconds))
            .map(|instant| LocalInstant {
                instant,
                offset_seconds,
            })
            .ok_or(Error::LocalTimeOutOfRange)
    }
}

pub(crate) trait TimeZoneRules: Copy {
    /// GetOffsetNanosecondsFor
    fn offset_seconds_at(self, instant: Instant) -> i32;

    fn offsets_at_local(self, seconds: i64) -> LocalOffsets;

    /// GetNamedTimeZoneNextTransition and GetNamedTimeZonePreviousTransition
    fn transition(self, instant: Instant, direction: Direction) -> Option<Instant>;

    #[inline]
    fn localize(self, instant: Instant) -> LocalInstant {
        LocalInstant {
            instant,
            offset_seconds: self.offset_seconds_at(instant),
        }
    }

    /// GetPossibleEpochNanoseconds
    #[inline]
    fn possible_instants(self, time: LocalTime) -> Result<PossibleInstants> {
        let LocalOffsets { before, after } = self.offsets_at_local(time.seconds);
        Ok(match after.cmp(&before) {
            Ordering::Equal => PossibleInstants::One(time.at_offset(before)?),
            Ordering::Less => {
                PossibleInstants::Two(time.at_offset(before)?, time.at_offset(after)?)
            }
            Ordering::Greater => PossibleInstants::None {
                gap_seconds: after - before,
            },
        })
    }

    /// DisambiguatePossibleEpochNanoseconds
    #[inline]
    fn disambiguate(
        self,
        possible: &PossibleInstants,
        time: LocalTime,
        disambiguation: Disambiguation,
    ) -> Result<LocalInstant> {
        let shift = match (*possible, disambiguation) {
            (PossibleInstants::One(only), _) => return Ok(only),
            (PossibleInstants::Two(..), Disambiguation::Reject) => {
                return Err(Error::LocalTimeRepeated);
            }
            (PossibleInstants::Two(_, later), Disambiguation::Later) => return Ok(later),
            (PossibleInstants::Two(earlier, _), _) => return Ok(earlier),
            (PossibleInstants::None { .. }, Disambiguation::Reject) => {
                return Err(Error::LocalTimeSkipped);
            }
            (PossibleInstants::None { gap_seconds }, Disambiguation::Earlier) => -gap_seconds,
            (PossibleInstants::None { gap_seconds }, _) => gap_seconds,
        };
        let shifted = LocalTime {
            seconds: time.seconds + i64::from(shift),
            ..time
        };
        match self.possible_instants(shifted)? {
            PossibleInstants::One(only) => Ok(only),
            PossibleInstants::Two(earlier, later) => Ok(if shift < 0 { earlier } else { later }),
            PossibleInstants::None { .. } => Err(Error::LocalTimeSkipped),
        }
    }

    /// GetEpochNanosecondsFor
    #[inline]
    fn instant_for(
        self,
        date_time: IsoDateTime,
        disambiguation: Disambiguation,
    ) -> Result<LocalInstant> {
        let time = LocalTime::from(date_time);
        self.disambiguate(&self.possible_instants(time)?, time, disambiguation)
    }

    /// GetStartOfDay
    fn start_of_day(self, date: IsoDate) -> Result<LocalInstant> {
        let midnight = LocalTime::from(IsoDateTime::at_midnight(date));
        match self.possible_instants(midnight)? {
            PossibleInstants::One(first) | PossibleInstants::Two(first, _) => Ok(first),
            gap => {
                let before = self.disambiguate(&gap, midnight, Disambiguation::Earlier)?;
                self.transition(before.instant, Direction::Next)
                    .map(|instant| self.localize(instant))
                    .ok_or(Error::NoStartOfDay)
            }
        }
    }
}

impl TimeZoneRules for TimeZone {
    #[inline]
    fn offset_seconds_at(self, instant: Instant) -> i32 {
        match self {
            TimeZone::Named(id) => id.rules().offset_at(instant.epoch_seconds()),
            TimeZone::Offset { minutes } => i32::from(minutes) * 60,
        }
    }

    #[inline]
    fn offsets_at_local(self, seconds: i64) -> LocalOffsets {
        match self {
            TimeZone::Named(id) => id.rules().offsets_at_local(seconds),
            TimeZone::Offset { minutes } => LocalOffsets {
                before: i32::from(minutes) * 60,
                after: i32::from(minutes) * 60,
            },
        }
    }

    fn transition(self, instant: Instant, direction: Direction) -> Option<Instant> {
        let TimeZone::Named(id) = self else {
            return None;
        };
        let seconds = instant.epoch_seconds();
        let transition = match direction {
            Direction::Next => id.rules().next_transition(seconds),
            Direction::Previous => {
                let is_whole = Instant::from_epoch_seconds(seconds) == Some(instant);
                (id.rules()).previous_transition(seconds + i64::from(!is_whole))
            }
        };
        Instant::from_epoch_seconds(transition?)
    }
}
