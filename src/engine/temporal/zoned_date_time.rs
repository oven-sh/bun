use bun_engine_date::TimeZone;
use bun_engine_text::Text;

use crate::format::IsoText;
use crate::relative_rounding::Span;
use crate::settings::DifferenceSettings;
use crate::time_zone::{LocalInstant, TimeZoneRules};
use crate::unit::{NANOSECONDS_PER_SECOND, UnitGroup};
use crate::{
    CalendarId, DateDuration, DifferenceOperation, DifferenceOptions, Direction, Disambiguation,
    Duration, Error, Fields, InputError, Instant, InternalDuration, IsoDateTime, OffsetOption,
    Overflow, PlainDate, PlainDateTime, PlainTime, Precision, PrecisionOptions, Result,
    RoundOptions, RoundingMode, ShowCalendar, ShowOffset, ShowTimeZone, TextError, Unit,
    UnresolvedZonedDateTime, parse,
};

/// What a `Temporal.ZonedDateTime` holds.
#[derive(Clone, Copy, Debug)]
pub struct ZonedDateTime {
    instant: Instant,
    time_zone: TimeZone,
    calendar: CalendarId,
    /// In seconds. It follows from the others.
    known_offset: Option<i32>,
}

/// Unlike `equals`, this tells the names of a time zone apart.
impl PartialEq for ZonedDateTime {
    fn eq(&self, other: &ZonedDateTime) -> bool {
        (self.instant, self.time_zone, self.calendar)
            == (other.instant, other.time_zone, other.calendar)
    }
}

impl Eq for ZonedDateTime {}

/// Of `from` and `with`, in the order they are read.
#[derive(Clone, Copy, Debug)]
pub struct ZonedOptions {
    pub disambiguation: Disambiguation,
    pub offset: OffsetOption,
    pub overflow: Overflow,
}

impl ZonedOptions {
    pub const DEFAULT_FOR_FROM: ZonedOptions = ZonedOptions {
        disambiguation: Disambiguation::Compatible,
        offset: OffsetOption::Reject,
        overflow: Overflow::Constrain,
    };
    pub const DEFAULT_FOR_WITH: ZonedOptions = ZonedOptions {
        offset: OffsetOption::Prefer,
        ..ZonedOptions::DEFAULT_FOR_FROM
    };
}

/// What `toString` writes after the time.
#[derive(Clone, Copy, Debug)]
pub struct ZonedDisplay {
    pub calendar: ShowCalendar,
    pub offset: ShowOffset,
    pub time_zone: ShowTimeZone,
}

impl ZonedDisplay {
    pub const AUTO: ZonedDisplay = ZonedDisplay {
        calendar: ShowCalendar::Auto,
        offset: ShowOffset::Auto,
        time_zone: ShowTimeZone::Auto,
    };
}

impl ZonedDateTime {
    #[inline]
    pub fn new(instant: Instant, time_zone: TimeZone, calendar: CalendarId) -> ZonedDateTime {
        ZonedDateTime {
            instant,
            time_zone,
            calendar,
            known_offset: None,
        }
    }

    #[inline]
    pub(crate) fn from_local(
        local: LocalInstant,
        time_zone: TimeZone,
        calendar: CalendarId,
    ) -> ZonedDateTime {
        ZonedDateTime {
            instant: local.instant,
            time_zone,
            calendar,
            known_offset: Some(local.offset_seconds),
        }
    }

    #[inline]
    pub(crate) fn knows_offset(&self) -> bool {
        self.known_offset.is_some()
    }

    /// The same value, which does not look its offset up again.
    #[inline]
    pub(crate) fn with_known_offset(&self) -> ZonedDateTime {
        ZonedDateTime {
            known_offset: Some(self.offset_seconds()),
            ..*self
        }
    }

    #[inline]
    fn offset_seconds(&self) -> i32 {
        (self.known_offset).unwrap_or_else(|| self.time_zone.offset_seconds_at(self.instant))
    }

    /// For `FieldSet::Zoned`.
    pub fn from_fields(fields: &Fields, options: ZonedOptions) -> Result<ZonedDateTime> {
        UnresolvedZonedDateTime::with_exact_offset(
            fields.date_time(options.overflow)?,
            fields.offset_nanoseconds,
            fields.time_zone.ok_or(Error::MissingTimeZone)?,
            fields.calendar,
        )
        .finish(options.disambiguation, options.offset)
    }

    #[inline]
    pub fn parse(text: Text<'_>) -> Result<UnresolvedZonedDateTime, InputError<'_>> {
        let parsed =
            parse::zoned_date_time(text).ok_or(InputError::Text(TextError::ZonedDateTime, text))?;
        let time_zone = (parsed.annotations.time_zone)
            .and_then(parse::ZoneIdentifier::resolve)
            .ok_or(InputError::Text(TextError::ZonedDateTimeTimeZone, text))?;
        let calendar = CalendarId::from_annotation(parsed.annotations.calendar)?;
        Ok(UnresolvedZonedDateTime::parsed(
            &parsed, time_zone, calendar,
        ))
    }

    #[inline]
    pub fn instant(&self) -> Instant {
        self.instant
    }

    #[inline]
    pub fn time_zone(&self) -> TimeZone {
        self.time_zone
    }

    #[inline]
    pub fn calendar(&self) -> CalendarId {
        self.calendar
    }

    /// GetISODateTimeFor
    #[inline]
    pub fn iso_date_time(&self) -> IsoDateTime {
        self.instant.at_offset(self.offset_seconds())
    }

    #[inline]
    pub fn offset_nanoseconds(&self) -> i64 {
        i64::from(self.offset_seconds()) * NANOSECONDS_PER_SECOND
    }

    #[inline(always)]
    pub fn offset_text(&self) -> IsoText {
        let mut text = IsoText::new();
        text.push_offset(self.offset_seconds());
        text
    }

    #[inline]
    fn at(&self, instant: Instant) -> ZonedDateTime {
        ZonedDateTime::new(instant, self.time_zone, self.calendar)
    }

    #[inline]
    fn at_local(&self, local: LocalInstant) -> ZonedDateTime {
        ZonedDateTime::from_local(local, self.time_zone, self.calendar)
    }

    /// The start of the day, and that of the next.
    fn day(&self) -> Result<[LocalInstant; 2]> {
        let today = self.iso_date_time().date;
        Ok([
            self.time_zone.start_of_day(today)?,
            self.time_zone.start_of_day(today.add_few_days(1))?,
        ])
    }

    pub fn hours_in_day(&self) -> Result<f64> {
        let [start, end] = self.day()?;
        Ok(start.instant.until(end.instant).total(Unit::Hour))
    }

    /// For `FieldSet::PartialZoned` in the calendar of `self`.
    pub fn with(&self, fields: &Fields, options: ZonedOptions) -> Result<ZonedDateTime> {
        let offset = (fields.offset_nanoseconds).unwrap_or_else(|| self.offset_nanoseconds());
        UnresolvedZonedDateTime::with_exact_offset(
            fields.date_time_over(self.iso_date_time(), options.overflow)?,
            Some(offset),
            self.time_zone,
            self.calendar,
        )
        .finish(options.disambiguation, options.offset)
    }

    pub fn with_calendar(&self, calendar: CalendarId) -> ZonedDateTime {
        ZonedDateTime { calendar, ..*self }
    }

    /// At the start of the day if there is no time.
    pub fn with_plain_time(&self, time: Option<PlainTime>) -> Result<ZonedDateTime> {
        let Some(time) = time else {
            return self.start_of_day();
        };
        let date_time = IsoDateTime {
            time,
            ..self.iso_date_time()
        };
        let local = (self.time_zone).instant_for(date_time, Disambiguation::Compatible)?;
        Ok(self.at_local(local))
    }

    pub fn with_time_zone(&self, time_zone: TimeZone) -> ZonedDateTime {
        ZonedDateTime::new(self.instant, time_zone, self.calendar)
    }

    pub fn start_of_day(&self) -> Result<ZonedDateTime> {
        let local = self.time_zone.start_of_day(self.iso_date_time().date)?;
        Ok(self.at_local(local))
    }

    pub fn time_zone_transition(&self, direction: Direction) -> Option<ZonedDateTime> {
        let instant = self.time_zone.transition(self.instant, direction)?;
        Some(self.at(instant))
    }

    /// AddZonedDateTime
    pub fn add(&self, duration: &Duration, overflow: Overflow) -> Result<ZonedDateTime> {
        let InternalDuration { date, time } = duration.to_internal();
        let mut result = *self;
        if date != DateDuration::ZERO {
            let mut date_time = self.iso_date_time();
            date_time.date = self.calendar.add(date_time.date, date, overflow)?;
            if !date_time.is_within_limits() {
                return Err(Error::IntermediateDateTimeOutOfRange);
            }
            let local = (self.time_zone).instant_for(date_time, Disambiguation::Compatible)?;
            result = self.at_local(local);
        }
        if time.sign() != 0 {
            let instant = result.instant.checked_add(time);
            result = self.at(instant.ok_or(Error::ZonedSumOutOfRange)?);
        }
        Ok(result)
    }

    pub fn subtract(&self, duration: &Duration, overflow: Overflow) -> Result<ZonedDateTime> {
        self.add(&duration.negated(), overflow)
    }

    /// Comes before the options of `difference` are read.
    pub fn check_same_calendar(&self, other: &ZonedDateTime) -> Result<()> {
        if self.calendar != other.calendar {
            return Err(Error::ZonedDateTimesInDifferentCalendars);
        }
        Ok(())
    }

    /// DifferenceTemporalZonedDateTime
    pub fn difference(
        &self,
        operation: DifferenceOperation,
        other: &ZonedDateTime,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        let settings =
            options.resolve(operation, UnitGroup::DateTime, Unit::Nanosecond, Unit::Hour)?;
        if settings.largest_unit.is_date_unit() {
            if !self.time_zone.is_same_zone(other.time_zone) {
                return Err(Error::DifferentTimeZones);
            }
            if self.instant == other.instant {
                return Ok(Duration::ZERO);
            }
        }
        let other = if other.time_zone == self.time_zone {
            other
        } else {
            &self.at(other.instant)
        };
        let duration = self.rounded_difference(other, settings)?;
        Duration::from_difference(operation, duration, settings.largest_unit.min(Unit::Hour))
    }

    /// DifferenceZonedDateTimeWithRounding
    pub(crate) fn rounded_difference(
        &self,
        other: &ZonedDateTime,
        settings: DifferenceSettings,
    ) -> Result<InternalDuration> {
        if !settings.largest_unit.is_date_unit() {
            let time = self.instant.until(other.instant);
            return Ok(time.round(settings.rounding)?.into());
        }
        let duration = self.exact_difference(other, settings.largest_unit)?;
        if settings.rounding.is_to_one(Unit::Nanosecond) {
            return Ok(duration);
        }
        self.span_to(other).round(&duration, settings)
    }

    /// DifferenceZonedDateTimeWithTotal
    pub(crate) fn total_difference(&self, other: &ZonedDateTime, unit: Unit) -> Result<f64> {
        if !unit.is_date_unit() {
            return Ok(self.instant.until(other.instant).total(unit));
        }
        let duration = self.exact_difference(other, unit)?;
        self.span_to(other).total(&duration, unit)
    }

    fn span_to(&self, other: &ZonedDateTime) -> Span {
        Span {
            start: self.iso_date_time(),
            start_nanoseconds: self.instant.epoch_nanoseconds(),
            end_nanoseconds: other.instant.epoch_nanoseconds(),
            time_zone: Some(self.time_zone),
            calendar: self.calendar,
        }
    }

    /// DifferenceZonedDateTime. `other` is in the same zone, and `largest_unit` is a day or longer.
    fn exact_difference(
        &self,
        other: &ZonedDateTime,
        largest_unit: Unit,
    ) -> Result<InternalDuration> {
        let (start, end) = (self.iso_date_time(), other.iso_date_time());
        let elapsed = self.instant.until(other.instant);
        let backwards = -elapsed.sign();
        // Clocks that are set back across midnight can give the later instant the earlier date.
        if start.date == end.date || start.date.cmp(&end.date) as i8 != backwards {
            return Ok(elapsed.into());
        }
        let mut date = end.date;
        if start.time.until(end.time).sign() == backwards {
            date = date.add_few_days(backwards);
        }
        loop {
            let intermediate = (self.time_zone)
                .instant_for(IsoDateTime { date, ..start }, Disambiguation::Compatible)?;
            let time = intermediate.instant.until(other.instant);
            if time.sign() != backwards {
                let date = self.calendar.until(start.date, date, largest_unit)?;
                return Ok(InternalDuration { date, time });
            }
            if date == start.date {
                return Ok(elapsed.into());
            }
            date = date.add_few_days(backwards);
        }
    }

    pub fn round(&self, options: RoundOptions) -> Result<ZonedDateTime> {
        let rounding = options.resolve_up_to_day()?;
        if rounding.is_to_one(Unit::Nanosecond) {
            return Ok(*self);
        }
        if rounding.unit == Unit::Day {
            return self.round_to_day(rounding.mode);
        }
        UnresolvedZonedDateTime::with_exact_offset(
            self.iso_date_time().round(rounding),
            Some(self.offset_nanoseconds()),
            self.time_zone,
            self.calendar,
        )
        .finish(Disambiguation::Compatible, OffsetOption::Prefer)
    }

    fn round_to_day(&self, mode: RoundingMode) -> Result<ZonedDateTime> {
        let [start, end] = self.day()?;
        let length = start.instant.until(end.instant).nanoseconds();
        let progress = start.instant.until(self.instant).nanoseconds();
        if length <= 0 || progress < 0 {
            return Err(Error::RoundedZonedOutOfRange);
        }
        // Clocks that are set back across midnight show the day again after the next one has started.
        let progress = progress.min(length - 1);
        let rounds_up =
            progress != 0 && mode.rounds_up(false, (2 * progress).cmp(&length), || false);
        Ok(self.at_local(if rounds_up { end } else { start }))
    }

    pub fn equals(&self, other: &ZonedDateTime) -> bool {
        self.instant == other.instant
            && self.time_zone.is_same_zone(other.time_zone)
            && self.calendar == other.calendar
    }

    pub fn to_plain_date(&self) -> PlainDate {
        PlainDate::from_valid(self.iso_date_time().date, self.calendar)
    }

    pub fn to_plain_date_time(&self) -> PlainDateTime {
        PlainDateTime::from_valid(self.iso_date_time(), self.calendar)
    }

    #[inline]
    pub fn precision(options: PrecisionOptions) -> Result<Precision> {
        options.resolve(Unit::Minute, Error::HourInZonedDateTimeText)
    }

    /// TemporalZonedDateTimeToString
    #[inline(always)]
    pub fn to_text(&self, precision: Precision, display: ZonedDisplay) -> IsoText {
        let instant = self.instant.rounded(precision.rounding);
        let offset_seconds = if instant == self.instant {
            self.offset_seconds()
        } else {
            self.time_zone.offset_seconds_at(instant)
        };
        let mut text = IsoText::new();
        text.push_date_time(instant.at_offset(offset_seconds), precision.format);
        if display.offset != ShowOffset::Never {
            text.push_rounded_offset(offset_seconds);
        }
        if display.time_zone != ShowTimeZone::Never {
            text.push_time_zone(self.time_zone, display.time_zone == ShowTimeZone::Critical);
        }
        text.push_calendar(self.calendar, display.calendar);
        text
    }
}
