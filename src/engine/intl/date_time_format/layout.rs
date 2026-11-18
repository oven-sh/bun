use core::cell::OnceCell;

use bun_engine_text::StringRef;
use bun_icu::calendar::Calendar;
use bun_icu::date_format::{DateFormat, field};
use bun_icu::date_interval_format::DateIntervalFormat;
use bun_icu::date_pattern::Pattern;

use super::components::Component;
use super::era::{EarlyEra, EarlyEraText};
use super::locale_data::LocaleData;
use super::pattern;
use super::template::Template;
use super::text::{DateText, PartSplitter, use_plain_spaces};
use crate::error::IcuResult;
use crate::parts::new_string;
use crate::{PartKind, Parts, Result, Source};

pub(super) const FORMAT_FAILURE: &str = "failed to format date value";

/// A DateTime Format Record.
pub(super) struct Layout {
    pub(super) pattern: Pattern,
    pub(super) shows_time_zone: bool,
    /// Only if the pattern shows the era.
    early_era: Option<EarlyEra>,
    template: OnceCell<Option<Template>>,
    pub(super) range_format: OnceCell<DateIntervalFormat>,
}

impl Layout {
    pub(super) fn new(pattern: Pattern, locale: &LocaleData) -> Result<Layout> {
        let shows =
            |component| pattern::fields(&pattern).any(|it| it.component() == Some(component));
        Ok(Layout {
            shows_time_zone: shows(Component::TimeZoneName),
            early_era: if shows(Component::Era) {
                EarlyEra::of(locale.calendar()?)
            } else {
                None
            },
            pattern,
            template: OnceCell::new(),
            range_format: OnceCell::new(),
        })
    }

    pub(super) fn template(&self, locale: &LocaleData) -> Result<Option<&Template>> {
        (self.template)
            .get_or_try_init(|| Template::new(&self.pattern, locale))
            .map(Option::as_ref)
    }

    fn early_era_text(
        &self,
        format: &DateFormat,
        calendar: &mut Calendar,
    ) -> Result<Option<EarlyEraText>> {
        match self.early_era {
            Some(era) => era.text(format, calendar).or_type_error(FORMAT_FAILURE),
            None => Ok(None),
        }
    }

    /// `format` is set to the pattern, and `calendar` to the time.
    pub(super) fn string(&self, format: &DateFormat, calendar: &mut Calendar) -> Result<StringRef> {
        if let Some(early) = self.early_era_text(format, calendar)? {
            return new_string(split(format, calendar, Some(&early), None)?.text());
        }
        let mut text = DateText::new();
        (format.format(calendar, &mut text)).or_type_error(FORMAT_FAILURE)?;
        use_plain_spaces(&mut text);
        new_string(&text)
    }

    /// As in `string`.
    pub(super) fn parts(
        &self,
        format: &DateFormat,
        calendar: &mut Calendar,
        source: Option<Source>,
    ) -> Result<Parts> {
        let early = self.early_era_text(format, calendar)?;
        split(format, calendar, early.as_ref(), source)
    }
}

fn split(
    format: &DateFormat,
    calendar: &mut Calendar,
    early: Option<&EarlyEraText>,
    source: Option<Source>,
) -> Result<Parts> {
    let mut text = DateText::new();
    let fields = (format.format_fields(calendar, &mut text)).or_type_error(FORMAT_FAILURE)?;
    use_plain_spaces(&mut text);

    let mut splitter = PartSplitter::new(&text);
    let mut has_era = false;
    for (date_field, range) in fields {
        has_era |= date_field == field::ERA;
        let replacement = early.and_then(|it| it.replacement(date_field));
        splitter.push_literal_until(range.start, source)?;
        splitter.push_field(date_field, range, replacement, source)?;
    }
    splitter.push_literal_until(text.len(), source)?;

    if let Some(early) = early
        && !has_era
    {
        let last = text.last().and_then(|&unit| char::from_u32(unit.into()));
        if !last.is_some_and(char::is_whitespace) {
            splitter.push(PartKind::Literal, &[b' '.into()], source)?;
        }
        splitter.push(PartKind::Era, &early.era, source)?;
    }
    Ok(splitter.finish())
}
