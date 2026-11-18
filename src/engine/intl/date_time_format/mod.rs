//! `Intl.DateTimeFormat`, and the `toLocaleString` methods of `Date` and `Temporal`.

mod cache;
mod components;
mod era;
mod formats;
mod layout;
mod locale_data;
mod options;
pub(crate) mod pattern;
mod range;
mod selection;
mod template;
mod text;
mod value;

use core::cell::{OnceCell, RefCell, RefMut};
use std::rc::Rc;

use bun_engine_date::TimeZone;
use bun_engine_temporal::{CalendarId, ZonedDateTime};
use bun_engine_text::StringRef;
use bun_icu::calendar::Calendar;
use bun_icu::date_format::DateFormat;
use bun_icu::date_interval_format::FormattedDateInterval;
use bun_icu::formatted_value::FormattedValue;

pub(crate) use cache::DateCache;
pub use components::{Component, ComponentStyle, ComponentValue, Components};
pub use options::{FormatMatcher, Options, Purpose, Style, parse_time_zone};
pub use value::DateTimeValue;

use crate::error::IcuResult;
use crate::parts::new_string;
use crate::{
    Cache, Error, HourCycle, LanguageTag, NumberingSystem, Part, PartKind, Parts, Result, Source,
};
use formats::Formats;
use layout::{FORMAT_FAILURE, Layout};
use locale_data::Calendars;
use range::RANGE_FAILURE;
use template::Template;
use text::{DateText, use_plain_spaces};
use value::Moment;

pub struct DateTimeFormat {
    formats: Rc<Formats>,
    time_zone: TimeZone,
    zoned_calendars: OnceCell<Rc<Calendars>>,
}

pub struct ResolvedOptions<'a> {
    pub locale: &'a LanguageTag,
    pub calendar: CalendarId,
    pub numbering_system: NumberingSystem,
    pub time_zone: TimeZone,
    pub hour_cycle: Option<HourCycle>,
    pub components: Components,
    pub date_style: Option<Style>,
    pub time_style: Option<Style>,
}

impl DateTimeFormat {
    /// CreateDateTimeFormat. `time_zone` is that of the system if the option is absent.
    pub fn new(
        cache: &Cache,
        requested: &[LanguageTag],
        options: &Options,
        time_zone: TimeZone,
        purpose: Purpose,
    ) -> Result<DateTimeFormat> {
        let formats = match cache.dates.find_formats(requested, options, purpose) {
            Some(formats) => formats,
            None => {
                let formats = Rc::new(Formats::new(cache, requested, options, purpose)?);
                (cache.dates).keep_formats(requested, options, purpose, &formats);
                formats
            }
        };
        Ok(DateTimeFormat {
            formats,
            time_zone,
            zoned_calendars: OnceCell::new(),
        })
    }

    pub fn format(&self, cache: &Cache, value: DateTimeValue) -> Result<StringRef> {
        let (layout, moment) = self.formats.handle(cache, value)?;
        if moment.time.is_nan() {
            return Err(Error::Range(
                "date value is not finite in DateTimeFormat format()",
            ));
        }
        self.string(layout, &moment)
    }

    pub fn format_to_parts(&self, cache: &Cache, value: DateTimeValue) -> Result<Parts> {
        let (layout, moment) = self.formats.handle(cache, value)?;
        if moment.time.is_nan() {
            return Err(Error::Range(
                "date value is not finite in DateTimeFormat formatToParts()",
            ));
        }
        self.parts(layout, &moment, None)
    }

    pub fn format_range(
        &self,
        cache: &Cache,
        start: DateTimeValue,
        end: DateTimeValue,
    ) -> Result<StringRef> {
        self.write_range(cache, [start, end], range::string, DateTimeFormat::string)
    }

    pub fn format_range_to_parts(
        &self,
        cache: &Cache,
        start: DateTimeValue,
        end: DateTimeValue,
    ) -> Result<Parts> {
        self.write_range(cache, [start, end], range::parts, |this, layout, moment| {
            this.parts(layout, moment, Some(Source::Shared))
        })
    }

    /// For a format that was made with `Purpose::ZonedDateTime` and the time zone of `value`.
    pub fn format_zoned_date_time(
        &self,
        cache: &Cache,
        value: &ZonedDateTime,
    ) -> Result<StringRef> {
        let calendar = value.calendar();
        if calendar != CalendarId::Iso8601 && calendar != self.formats.data.calendar()? {
            return Err(Error::Range(
                "ZonedDateTime calendar does not match locale calendar",
            ));
        }
        let time = value.instant().epoch_milliseconds();
        self.format(cache, DateTimeValue::Number(time as f64))
    }

    pub fn resolved_options(&self) -> Result<ResolvedOptions<'_>> {
        let formats = &*self.formats;
        let pattern = &formats.of_time_values.pattern;
        Ok(ResolvedOptions {
            locale: formats.locale.tag(),
            calendar: formats.data.calendar()?,
            numbering_system: formats.data.numbering_system()?,
            time_zone: self.time_zone,
            hour_cycle: pattern::hour_cycle(pattern),
            components: if formats.has_style() {
                Components::default()
            } else {
                pattern::components(pattern)
            },
            date_style: formats.date_style,
            time_style: formats.time_style,
        })
    }

    /// In milliseconds.
    fn local_time(&self, moment: &Moment) -> i64 {
        let time = moment.time as i64;
        let offset_seconds = match self.time_zone {
            _ if moment.is_plain() => 0,
            TimeZone::Named(id) => id.rules().offset_at(time.div_euclid(1000)),
            TimeZone::Offset { minutes } => i32::from(minutes) * 60,
        };
        time + i64::from(offset_seconds) * 1000
    }

    /// ICU needs to know the time zone only to name it.
    fn calendars(&self, layout: &Layout) -> bun_icu::Result<&Calendars> {
        let data = &self.formats.data;
        if !layout.shows_time_zone {
            return data.utc_calendars();
        }
        (self.zoned_calendars)
            .get_or_try_init(|| data.zoned_calendars(self.time_zone))
            .map(|calendars| &**calendars)
    }

    /// `calendar` is one of the `calendars` for `layout`.
    fn set_time<'a>(
        &self,
        calendar: &'a RefCell<Calendar>,
        layout: &Layout,
        moment: &Moment,
    ) -> bun_icu::Result<RefMut<'a, Calendar>> {
        let mut calendar = calendar.borrow_mut();
        calendar.set_millis(if layout.shows_time_zone {
            moment.time
        } else {
            self.local_time(moment) as f64
        })?;
        Ok(calendar)
    }

    /// `pattern` is that of `layout` or a part of it.
    fn prepare(
        &self,
        pattern: &[u16],
        layout: &Layout,
        moment: &Moment,
    ) -> Result<(RefMut<'_, DateFormat>, RefMut<'_, Calendar>)> {
        let prepared = self.calendars(layout).and_then(|calendars| {
            let calendar = self.set_time(&calendars.first, layout, moment)?;
            Ok((self.formats.data.format(pattern)?, calendar))
        });
        prepared.or_type_error(FORMAT_FAILURE)
    }

    fn fill<T>(
        &self,
        template: &Template,
        layout: &Layout,
        moment: &Moment,
        each_part: impl FnMut(PartKind, &[u16]) -> Result<()>,
        whole: impl FnOnce(&[u16]) -> Result<T>,
    ) -> Result<T> {
        let mut zone_name = DateText::new();
        if let Some(field) = template.time_zone_field() {
            let (format, mut calendar) = self.prepare(field, layout, moment)?;
            (format.format(&mut calendar, &mut zone_name)).or_type_error(FORMAT_FAILURE)?;
            use_plain_spaces(&mut zone_name);
        }
        template.write(self.local_time(moment), &zone_name, each_part, whole)
    }

    fn string(&self, layout: &Layout, moment: &Moment) -> Result<StringRef> {
        let Some(template) = layout.template(&self.formats.data)? else {
            let (format, mut calendar) = self.prepare(&layout.pattern, layout, moment)?;
            return layout.string(&format, &mut calendar);
        };
        self.fill(template, layout, moment, |_, _| Ok(()), new_string)
    }

    fn parts(&self, layout: &Layout, moment: &Moment, source: Option<Source>) -> Result<Parts> {
        let Some(template) = layout.template(&self.formats.data)? else {
            let (format, mut calendar) = self.prepare(&layout.pattern, layout, moment)?;
            return layout.parts(&format, &mut calendar, source);
        };
        let mut parts = Parts::default();
        let push = |kind, value: &[u16]| {
            let unit = None;
            parts.push(Part { kind, unit, source }, value)
        };
        self.fill(template, layout, moment, push, |_| Ok(()))?;
        Ok(parts)
    }

    fn range(
        &self,
        cache: &Cache,
        layout: &Layout,
        [start, end]: [&Moment; 2],
    ) -> Result<FormattedDateInterval> {
        let format = self.formats.range_format(cache, layout)?;
        let range = self.calendars(layout).and_then(|calendars| {
            let mut end = self.set_time(calendars.second()?, layout, end)?;
            let mut start = self.set_time(&calendars.first, layout, start)?;
            format.format(&mut start, &mut end)
        });
        range.or_type_error(RANGE_FAILURE)
    }

    /// PartitionDateTimeRangePattern
    fn write_range<T>(
        &self,
        cache: &Cache,
        [start, end]: [DateTimeValue; 2],
        write_range: impl FnOnce(FormattedValue<'_>) -> Result<T>,
        write_single: impl FnOnce(&DateTimeFormat, &Layout, &Moment) -> Result<T>,
    ) -> Result<T> {
        if !start.is_same_type(&end) {
            return Err(Error::Type(
                "formatRange requires both arguments to be the same Temporal type",
            ));
        }
        let (layout, start) = self.formats.handle(cache, start)?;
        let (_, end) = self.formats.handle(cache, end)?;
        if start.time.is_nan() || end.time.is_nan() {
            return Err(Error::Range("Passed date is out of range"));
        }
        let range = self.range(cache, layout, [&start, &end])?;
        let value = range.value().or_type_error(RANGE_FAILURE)?;
        if range::shows_both_ends(value)? {
            write_range(value)
        } else {
            write_single(self, layout, &start)
        }
    }
}
