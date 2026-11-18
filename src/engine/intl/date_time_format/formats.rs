use core::cell::OnceCell;
use std::rc::Rc;

use bun_engine_text::Text;
use bun_icu::date_interval_format::DateIntervalFormat;

use super::layout::Layout;
use super::locale_data::{Keywords, LocaleData};
use super::selection::{Clock, Patterns, Selection};
use super::value::{Moment, TemporalType};
use super::{Components, DateTimeValue, Options, Purpose, Style, pattern};
use crate::error::IcuResult;
use crate::language_tag::Key;
use crate::locale_resolver::{LocaleResolver, ResolvedLocale};
use crate::{
    AvailableLocales, Cache, Error, HourCycle, LanguageTag, Named, NumberingSystem, Result,
    calendar,
};

const INITIALIZE_FAILURE: &str = "failed to initialize DateTimeFormat";

/// All of a `DateTimeFormat` that does not depend on the time zone.
pub(super) struct Formats {
    pub(super) locale: ResolvedLocale,
    keywords: Keywords,
    pub(super) data: Rc<LocaleData>,
    clock: Clock,
    /// As in the options.
    components: Components,
    pub(super) date_style: Option<Style>,
    pub(super) time_style: Option<Style>,
    pub(super) of_time_values: Layout,
    of_temporal_values: [OnceCell<TemporalLayout>; TemporalType::COUNT],
}

enum TemporalLayout {
    OfTimeValues,
    Own(Box<Layout>),
    Inapplicable,
}

fn resolve_locale(
    cache: &Cache,
    requested: &[LanguageTag],
    options: &Options,
) -> Result<(ResolvedLocale, Keywords, Clock)> {
    let mut resolver = LocaleResolver::new(cache, AvailableLocales::general(), requested);
    let calendar = calendar::resolve(&mut resolver, options.calendar.as_ref());
    let clock = match options.hour12 {
        Some(hour12) => Clock::Hour12(hour12),
        None => resolver
            .keyword(
                Key::HOUR_CYCLE,
                options.hour_cycle.map(|it| it.as_str().as_bytes()),
                |name| HourCycle::from_name(Text::Latin1(name)),
            )
            .map_or(Clock::OfLocale, Clock::Cycle),
    };
    let keywords = Keywords {
        calendar,
        numbering_system: NumberingSystem::resolve(
            &mut resolver,
            options.numbering_system.as_ref(),
        ),
    };
    Ok((resolver.finish()?, keywords, clock))
}

fn check_styles(options: &Options, purpose: Purpose) -> Result<()> {
    if options.components != Components::default() {
        return Err(Error::Type(
            "dateStyle and timeStyle may not be used with other DateTimeFormat options",
        ));
    }
    if purpose == Purpose::Date && options.time_style.is_some() {
        return Err(Error::Type(
            "timeStyle is specified while formatting date is requested",
        ));
    }
    if purpose == Purpose::Time && options.date_style.is_some() {
        return Err(Error::Type(
            "dateStyle is specified while formatting time is requested",
        ));
    }
    Ok(())
}

impl Formats {
    pub(super) fn new(
        cache: &Cache,
        requested: &[LanguageTag],
        options: &Options,
        purpose: Purpose,
    ) -> Result<Formats> {
        let (locale, keywords, clock) = resolve_locale(cache, requested, options)?;
        let icu_locale = keywords.icu_locale(&locale, None)?;
        let data = (cache.dates.find_locale_data(&icu_locale)).unwrap_or_else(|| {
            cache.note_allocation(LocaleData::ESTIMATED_SIZE);
            Rc::new(LocaleData::new(icu_locale, keywords))
        });
        let patterns = Patterns {
            cache: &cache.dates,
            locale: data.icu_locale(),
            clock,
        };
        let pattern = match (options.date_style, options.time_style) {
            (None, None) => patterns.for_components(&purpose.add_defaults(options.components)),
            (date_style, time_style) => {
                check_styles(options, purpose)?;
                patterns.for_styles(date_style, time_style)
            }
        };
        Ok(Formats {
            of_time_values: Layout::new(pattern.or_type_error(INITIALIZE_FAILURE)?, &data)?,
            of_temporal_values: Default::default(),
            locale,
            keywords,
            data,
            clock,
            components: options.components,
            date_style: options.date_style,
            time_style: options.time_style,
        })
    }

    pub(super) fn has_style(&self) -> bool {
        self.date_style.is_some() || self.time_style.is_some()
    }

    fn make_layout(&self, cache: &Cache, temporal_type: TemporalType) -> Result<TemporalLayout> {
        let patterns = Patterns {
            cache: &cache.dates,
            locale: self.data.icu_locale(),
            clock: self.clock,
        };
        let base = &self.of_time_values.pattern;
        let selection = Selection::for_type(temporal_type);
        let pattern = if self.has_style() {
            patterns.adjust_style(base, selection)
        } else {
            (selection.apply(self.components))
                .map(|components| patterns.for_components(&components))
                .transpose()
        };
        Ok(match pattern.or_type_error(INITIALIZE_FAILURE)? {
            Some(pattern) if pattern == *base => TemporalLayout::OfTimeValues,
            Some(pattern) => TemporalLayout::Own(Box::new(Layout::new(pattern, &self.data)?)),
            None => TemporalLayout::Inapplicable,
        })
    }

    /// HandleDateTimeValue, but for the check that a number is a time value.
    #[inline]
    pub(super) fn handle(&self, cache: &Cache, value: DateTimeValue) -> Result<(&Layout, Moment)> {
        let moment = value.moment()?;
        if let Some(calendar) = moment.calendar
            && calendar != self.data.calendar()?
        {
            return Err(Error::Range(
                "Temporal object's calendar does not match DateTimeFormat calendar",
            ));
        }
        let Some(temporal_type) = moment.temporal_type else {
            return Ok((&self.of_time_values, moment));
        };
        let layout = self.of_temporal_values[temporal_type as usize]
            .get_or_try_init(|| self.make_layout(cache, temporal_type))?;
        match layout {
            TemporalLayout::OfTimeValues => Ok((&self.of_time_values, moment)),
            TemporalLayout::Own(layout) => Ok((layout, moment)),
            TemporalLayout::Inapplicable => Err(Error::Type(
                "DateTimeFormat has no fields applicable to this Temporal type",
            )),
        }
    }

    pub(super) fn range_format<'a>(
        &self,
        cache: &Cache,
        layout: &'a Layout,
    ) -> Result<&'a DateIntervalFormat> {
        const ESTIMATED_SIZE: usize = 56 * 1024;

        layout.range_format.get_or_try_init(|| {
            cache.note_allocation(ESTIMATED_SIZE);
            // ICU takes from the skeleton only whether the clock has twelve hours.
            let hour_cycle = pattern::hour_cycle(&layout.pattern);
            let locale = self.keywords.icu_locale(&self.locale, hour_cycle)?;
            pattern::skeleton(&layout.pattern)
                .and_then(|skeleton| DateIntervalFormat::open(&locale, &skeleton))
                .or_type_error("failed to initialize DateIntervalFormat")
        })
    }
}
