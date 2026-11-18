//! The years before the first, in calendars for which ICU does not name their era.

use bun_engine_date::{MS_PER_DAY, days_from_civil};
use bun_engine_temporal::CalendarId;
use bun_icu::Buffer;
use bun_icu::calendar::{Calendar, Field};
use bun_icu::date_format::{DateFormat, field};

use super::text::DateText;

#[derive(Clone, Copy)]
pub(super) enum EarlyEra {
    /// ICU counts the years down through zero, in the later era.
    Islamic,
    /// ICU counts the years backwards, in an era without a name.
    Coptic,
}

impl EarlyEra {
    pub(super) fn of(calendar: CalendarId) -> Option<EarlyEra> {
        match calendar {
            CalendarId::IslamicCivil | CalendarId::IslamicTbla | CalendarId::IslamicUmalqura => {
                Some(EarlyEra::Islamic)
            }
            CalendarId::Coptic => Some(EarlyEra::Coptic),
            _ => None,
        }
    }

    /// What to show for the date that `calendar` is set to, if it is in this era.
    pub(super) fn text(
        self,
        format: &DateFormat,
        calendar: &mut Calendar,
    ) -> bun_icu::Result<Option<EarlyEraText>> {
        let year = calendar.get(Field::ExtendedYear)?;
        if year > 0 {
            return Ok(None);
        }
        let (era, year) = match self {
            EarlyEra::Islamic => (
                "Before Hijra",
                islamic_year_text(format, calendar, 1 - year)?,
            ),
            EarlyEra::Coptic => ("Anno Martyrum", None),
        };
        let era = era.encode_utf16().collect();
        Ok(Some(EarlyEraText { era, year }))
    }
}

pub(super) struct EarlyEraText {
    pub(super) era: Buffer<u16>,
    year: Option<Buffer<u16>>,
}

impl EarlyEraText {
    pub(super) fn replacement(&self, date_field: i32) -> Option<&[u16]> {
        match date_field {
            field::ERA => Some(&self.era),
            field::YEAR => self.year.as_deref(),
            _ => None,
        }
    }
}

/// With the digits and the width that `format` gives a year.
fn islamic_year_text(
    format: &DateFormat,
    calendar: &Calendar,
    year: i32,
) -> bun_icu::Result<Option<Buffer<u16>>> {
    const EPOCH_DAYS: f64 = days_from_civil(622, 7, 19) as f64;
    /// Thirty years have 10631 days.
    const MEAN_YEAR_DAYS: f64 = 10631.0 / 30.0;

    let middle_of_year = EPOCH_DAYS + (f64::from(year) - 0.5) * MEAN_YEAR_DAYS;
    let mut calendar = calendar.try_clone()?;
    calendar.set_millis(middle_of_year * MS_PER_DAY)?;
    let mut text = DateText::new();
    let mut fields = format.format_fields(&mut calendar, &mut text)?;
    let year_field = fields.find(|&(date_field, _)| date_field == field::YEAR);
    Ok(year_field.and_then(|(_, range)| text.get(range).map(Buffer::from_slice)))
}
