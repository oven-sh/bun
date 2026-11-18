use bun_engine_text::Text;

use crate::{
    CalendarId, Disambiguation, Fields, InputError, OffsetOption, Overflow, PlainDate, Result,
    TextError, UnresolvedZonedDateTime, ZonedDateTime, parse,
};

/// The value of the `relativeTo` option.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RelativeTo {
    Plain(PlainDate),
    Zoned(ZonedDateTime),
}

impl RelativeTo {
    /// For `FieldSet::RelativeTo`.
    pub fn from_fields(fields: &Fields) -> Result<RelativeTo> {
        let (date_time, calendar) = (fields.date_time(Overflow::Constrain)?, fields.calendar);
        let Some(time_zone) = fields.time_zone else {
            let date = PlainDate::from_valid(date_time.date, calendar);
            return Ok(RelativeTo::Plain(date));
        };
        RelativeTo::zoned(UnresolvedZonedDateTime::with_exact_offset(
            date_time,
            fields.offset_nanoseconds,
            time_zone,
            calendar,
        ))
    }

    pub fn parse(text: Text<'_>) -> Result<RelativeTo, InputError<'_>> {
        let error = |error| InputError::Text(error, text);
        let parsed = parse::relative_to(text).ok_or_else(|| error(TextError::RelativeTo))?;
        let time_zone = (parsed.annotations.time_zone)
            .map(|it| {
                it.resolve()
                    .ok_or_else(|| error(TextError::RelativeToTimeZone))
            })
            .transpose()?;
        let calendar = CalendarId::from_annotation(parsed.annotations.calendar)?;
        let Some(time_zone) = time_zone else {
            return PlainDate::new(parsed.date, calendar)
                .map(RelativeTo::Plain)
                .map_err(|_| error(TextError::RelativeToOutOfRange));
        };
        let unresolved = UnresolvedZonedDateTime::parsed(&parsed, time_zone, calendar);
        Ok(RelativeTo::zoned(unresolved)?)
    }

    fn zoned(unresolved: UnresolvedZonedDateTime) -> Result<RelativeTo> {
        unresolved
            .finish(Disambiguation::Compatible, OffsetOption::Reject)
            .map(RelativeTo::Zoned)
    }
}
