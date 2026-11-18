//! Which pattern a format uses for which type of value.

use bun_icu::date_format;
use bun_icu::date_pattern::Pattern;
use bun_icu::{Buffer, CText};

use super::cache::DateCache;
use super::components::{Component, ComponentSet, ComponentStyle, ComponentValue, Components};
use super::value::TemporalType;
use super::{Purpose, Style, pattern};
use crate::HourCycle;

/// The arguments `required`, `defaults` and `inherit` of GetDateTimeFormat.
#[derive(Clone, Copy)]
pub(super) struct Selection {
    required: ComponentSet,
    defaults: ComponentSet,
    inherited: ComponentSet,
}

impl Selection {
    pub(super) fn for_type(temporal_type: TemporalType) -> Selection {
        use ComponentSet as Set;
        let (required, defaults, inherited) = match temporal_type {
            TemporalType::Instant => (Set::DATE_AND_TIME, Set::YEAR_TO_SECOND, Set::ALL),
            TemporalType::PlainDate => (Set::DATE, Set::YEAR_MONTH_DAY, Set::ERA),
            TemporalType::PlainDateTime => (Set::DATE_AND_TIME, Set::YEAR_TO_SECOND, Set::ERA),
            TemporalType::PlainMonthDay => (Set::MONTH_DAY, Set::MONTH_DAY, Set::EMPTY),
            TemporalType::PlainTime => (Set::TIME, Set::HOUR_MINUTE_SECOND, Set::EMPTY),
            TemporalType::PlainYearMonth => (Set::YEAR_MONTH, Set::YEAR_MONTH, Set::ERA),
        };
        Selection {
            required,
            defaults,
            inherited,
        }
    }

    /// The components that values of the type have.
    fn allowed(self) -> ComponentSet {
        self.required.with(self.inherited)
    }

    /// `None` if `options` ask only for components that values of the type lack.
    pub(super) fn apply(self, options: Components) -> Option<Components> {
        let mut selected = options.only(self.allowed());
        if !options.has_any(self.required) {
            if options.has_any(ComponentSet::DATE_AND_TIME) {
                return None;
            }
            selected.set_numeric(self.defaults);
        }
        Some(selected)
    }
}

impl Purpose {
    /// What the format of time values shows.
    pub(super) fn add_defaults(self, mut options: Components) -> Components {
        use ComponentSet as Set;
        let (required, defaults) = match self {
            Purpose::Constructor => (Set::DATE_AND_TIME, Set::YEAR_MONTH_DAY),
            Purpose::DateAndTime | Purpose::ZonedDateTime => {
                (Set::DATE_AND_TIME, Set::YEAR_TO_SECOND)
            }
            Purpose::Date => (Set::DATE, Set::YEAR_MONTH_DAY),
            Purpose::Time => (Set::TIME, Set::HOUR_MINUTE_SECOND),
        };
        if !options.has_any(required) {
            options.set_numeric(defaults);
            if self == Purpose::ZonedDateTime && !options.has(Component::TimeZoneName) {
                let short = ComponentValue::Style(ComponentStyle::Short);
                options.set(Component::TimeZoneName, short);
            }
        }
        options
    }
}

/// How the options and the tag of the locale ask for hours to be counted.
#[derive(Clone, Copy)]
pub(super) enum Clock {
    OfLocale,
    Hour12(bool),
    Cycle(HourCycle),
}

impl Clock {
    fn is_twelve_hour(self) -> Option<bool> {
        match self {
            Clock::OfLocale => None,
            Clock::Hour12(hour12) => Some(hour12),
            Clock::Cycle(cycle) => Some(cycle.is_twelve_hour()),
        }
    }

    /// In a skeleton, which leaves it to the locale where the count starts.
    fn letter(self) -> u8 {
        match self.is_twelve_hour() {
            None => b'j',
            Some(true) => b'h',
            Some(false) => b'H',
        }
    }
}

impl HourCycle {
    pub fn is_twelve_hour(self) -> bool {
        matches!(self, HourCycle::H11 | HourCycle::H12)
    }
}

pub(super) struct Patterns<'a> {
    pub(super) cache: &'a DateCache,
    pub(super) locale: &'a CText,
    pub(super) clock: Clock,
}

impl Patterns<'_> {
    fn finish(&self, mut pattern: Pattern) -> Pattern {
        if let Clock::Cycle(cycle) = self.clock {
            pattern::set_hour_cycle(&mut pattern, cycle);
        }
        pattern::use_calendar_year(&mut pattern);
        pattern
    }

    /// BestFitFormatMatcher
    pub(super) fn for_components(&self, components: &Components) -> bun_icu::Result<Pattern> {
        let mut skeleton: Buffer<u16> = components.skeleton().map(u16::from).collect();
        pattern::set_hour_letter(&mut skeleton, self.clock.letter());
        Ok(self.finish(self.cache.best_pattern(self.locale, &skeleton)?))
    }

    /// DateTimeStyleFormat
    pub(super) fn for_styles(
        &self,
        date: Option<Style>,
        time: Option<Style>,
    ) -> bun_icu::Result<Pattern> {
        let icu_style = |style| match style {
            Style::Full => date_format::Style::Full,
            Style::Long => date_format::Style::Long,
            Style::Medium => date_format::Style::Medium,
            Style::Short => date_format::Style::Short,
        };
        let mut pattern =
            date_format::style_pattern(self.locale, date.map(icu_style), time.map(icu_style))?;
        // A day period comes and goes with the twelve-hour clock.
        if let Some(wanted) = self.clock.is_twelve_hour()
            && pattern::hour_cycle(&pattern).is_some_and(|it| it.is_twelve_hour() != wanted)
        {
            let mut skeleton = pattern::skeleton(&pattern)?;
            pattern::set_hour_letter(&mut skeleton, self.clock.letter());
            pattern = self.cache.best_pattern(self.locale, &skeleton)?;
        }
        Ok(self.finish(pattern))
    }

    /// AdjustDateTimeStyleFormat. `None` if `base` shows only components that values of the type lack.
    pub(super) fn adjust_style(
        &self,
        base: &Pattern,
        selection: Selection,
    ) -> bun_icu::Result<Option<Pattern>> {
        let is_allowed = |field: &pattern::Field| {
            (field.component()).is_some_and(|it| selection.allowed().contains(it))
        };
        if pattern::fields(base).all(|field| is_allowed(&field)) {
            return Ok(Some(base.clone()));
        }
        let base_skeleton = pattern::skeleton(base)?;
        let mut skeleton = Buffer::new();
        for field in pattern::fields(&base_skeleton).filter(is_allowed) {
            match field.letter {
                // One half of what a cyclic calendar shows for the year.
                b'U' | b'r' => skeleton.push(b'y'.into()),
                _ => skeleton.extend_from_slice(&base_skeleton[field.range]),
            }
        }
        if skeleton.is_empty() {
            return Ok(None);
        }
        Ok(Some(
            self.finish(self.cache.best_pattern(self.locale, &skeleton)?),
        ))
    }
}
