use core::cell::{OnceCell, RefCell, RefMut};
use core::ffi::CStr;
use std::rc::Rc;

use bun_engine_date::TimeZone;
use bun_engine_temporal::CalendarId;
use bun_icu::calendar::Calendar;
use bun_icu::date_format::DateFormat;
use bun_icu::date_pattern::Pattern;
use bun_icu::{Buffer, CText};
use smallvec::SmallVec;

use super::text::use_plain_spaces;
use crate::language_tag::Key;
use crate::locale_resolver::ResolvedLocale;
use crate::recent::Recent;
use crate::{HourCycle, Named, NumberingSystem, Result, calendar};

/// What was asked for in place of the defaults of a locale.
#[derive(Clone, Copy)]
pub(super) struct Keywords {
    pub(super) calendar: Option<CalendarId>,
    pub(super) numbering_system: Option<NumberingSystem>,
}

impl Keywords {
    pub(super) fn icu_locale(
        &self,
        locale: &ResolvedLocale,
        hour_cycle: Option<HourCycle>,
    ) -> Result<CText> {
        let keywords: SmallVec<[_; 3]> = [
            (self.calendar).map(|it| (Key::CALENDAR, it.identifier().as_bytes())),
            hour_cycle.map(|it| (Key::HOUR_CYCLE, it.as_str().as_bytes())),
            (self.numbering_system.as_ref()).map(|it| (Key::NUMBERING_SYSTEM, it.as_bytes())),
        ]
        .into_iter()
        .flatten()
        .collect();
        locale.icu_locale(&keywords)
    }
}

/// The text of a field for each of its values.
pub(super) type Names = Rc<[Box<[u16]>]>;

/// What all formats of a locale, calendar and numbering system share.
pub(super) struct LocaleData {
    icu_locale: CText,
    calendar: OnceCell<CalendarId>,
    numbering_system: OnceCell<NumberingSystem>,
    /// With the pattern that it is set to.
    format: OnceCell<RefCell<(DateFormat, Pattern)>>,
    utc_calendars: OnceCell<Calendars>,
    zoned_calendars: Recent<TimeZone, Rc<Calendars>, 4>,
    /// By the pattern of the field.
    names: RefCell<Vec<(Box<[u16]>, Names)>>,
}

/// In one time zone.
pub(super) struct Calendars {
    pub(super) first: RefCell<Calendar>,
    second: OnceCell<RefCell<Calendar>>,
}

impl Calendars {
    fn new(first: Calendar) -> Calendars {
        Calendars {
            first: first.into(),
            second: OnceCell::new(),
        }
    }

    /// For the end of a range.
    pub(super) fn second(&self) -> bun_icu::Result<&RefCell<Calendar>> {
        (self.second).get_or_try_init(|| self.first.borrow().try_clone().map(RefCell::new))
    }
}

fn open_utc_calendar(locale: &CStr) -> bun_icu::Result<Calendar> {
    /// Earlier than any date of Temporal.
    const GREGORIAN_CHANGE: f64 = -((1u64 << 53) as f64);

    let mut calendar = Calendar::open(&b"GMT".map(u16::from), locale)?;
    match calendar.set_gregorian_change(GREGORIAN_CHANGE) {
        Ok(()) | Err(bun_icu::Error::UNSUPPORTED) => Ok(calendar),
        Err(error) => Err(error),
    }
}

impl LocaleData {
    /// Once it has been used.
    pub(super) const ESTIMATED_SIZE: usize = 32 * 1024;

    pub(super) fn new(icu_locale: CText, keywords: Keywords) -> LocaleData {
        LocaleData {
            icu_locale,
            calendar: keywords.calendar.map_or_else(OnceCell::new, OnceCell::from),
            numbering_system: (keywords.numbering_system)
                .map_or_else(OnceCell::new, OnceCell::from),
            format: OnceCell::new(),
            utc_calendars: OnceCell::new(),
            zoned_calendars: Recent::default(),
            names: RefCell::default(),
        }
    }

    pub(super) fn icu_locale(&self) -> &CText {
        &self.icu_locale
    }

    pub(super) fn calendar(&self) -> Result<CalendarId> {
        (self.calendar)
            .get_or_try_init(|| calendar::default_for(&self.icu_locale))
            .copied()
    }

    pub(super) fn numbering_system(&self) -> Result<NumberingSystem> {
        (self.numbering_system)
            .get_or_try_init(|| NumberingSystem::default_for(&self.icu_locale))
            .copied()
    }

    pub(super) fn format(&self, pattern: &[u16]) -> bun_icu::Result<RefMut<'_, DateFormat>> {
        let format = self.format.get_or_try_init(|| {
            DateFormat::open(&self.icu_locale, pattern).map(|it| (it, pattern.into()).into())
        })?;
        let (mut format, mut current) =
            RefMut::map_split(format.borrow_mut(), |(format, current)| (format, current));
        if **current != *pattern {
            format.set_pattern(pattern)?;
            *current = pattern.into();
        }
        Ok(format)
    }

    pub(super) fn utc_calendars(&self) -> bun_icu::Result<&Calendars> {
        (self.utc_calendars)
            .get_or_try_init(|| open_utc_calendar(&self.icu_locale).map(Calendars::new))
    }

    pub(super) fn zoned_calendars(&self, time_zone: TimeZone) -> bun_icu::Result<Rc<Calendars>> {
        self.zoned_calendars.find_or_make(&time_zone, || {
            let mut calendar = self.utc_calendars()?.first.borrow().try_clone()?;
            calendar.set_time_zone(&time_zone.icu_id())?;
            Ok(Rc::new(Calendars::new(calendar)))
        })
    }

    pub(super) fn text_in_utc(&self, pattern: &[u16], time: f64) -> bun_icu::Result<Buffer<u16>> {
        let mut calendar = self.utc_calendars()?.first.borrow_mut();
        calendar.set_millis(time)?;
        let mut text = Buffer::new();
        self.format(pattern)?.format(&mut calendar, &mut text)?;
        use_plain_spaces(&mut text);
        Ok(text)
    }

    /// What `field` reads at each of `times`, which are the same in each call for a field.
    pub(super) fn names(
        &self,
        field: &[u16],
        times: impl Iterator<Item = f64>,
    ) -> bun_icu::Result<Names> {
        let mut known = self.names.borrow_mut();
        if let Some((_, names)) = known.iter().find(|(it, _)| **it == *field) {
            return Ok(Rc::clone(names));
        }
        let names: Names = times
            .map(|time| self.text_in_utc(field, time).map(|name| name[..].into()))
            .collect::<bun_icu::Result<_>>()?;
        known.push((field.into(), Rc::clone(&names)));
        Ok(names)
    }
}
