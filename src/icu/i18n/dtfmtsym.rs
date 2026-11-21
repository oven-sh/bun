//! The names of eras, months, weekdays, day periods and cyclic years of a locale and a calendar. ICU4C: dtfmtsym.cpp

use crate::common::bytes::U16s;
use crate::common::locid::Locale;
use crate::common::maps::Map;
use crate::common::memory::{
    Appendable, try_collect, try_filled, try_map_insert, try_to_vec, try_with_capacity,
};
use crate::common::resource::{ResourceArray, ResourceSink, ResourceTable, ResourceValue};
use crate::common::slice_ext::{SliceExt, to_index};
use crate::common::uinvchar::append_invariant_chars;
use crate::common::unicode::ures::{URES_ALIAS, URES_ARRAY, URES_STRING, URES_TABLE};
use crate::common::uresdata::{DataString, strtol};
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::calendar::CalendarType;
use crate::i18n::erarules::EraRules;
use crate::i18n::locale_cache::LocaleCache;
use std::fmt::NumBuffer;
use std::iter::once;
use std::sync::Arc;

/// A range of `DateFormatSymbols::names`.
#[derive(Clone, Copy, Default)]
pub(crate) struct List {
    start: u32,
    end: u32,
}

/// An index into `DateFormatSymbols::names`. The default is an absent name.
#[derive(Clone, Copy)]
pub(crate) struct Name(u32);

impl Default for Name {
    fn default() -> Self {
        Self(u32::MAX)
    }
}

pub(crate) struct Widths<T> {
    pub(crate) wide: T,
    pub(crate) abbreviated: T,
    pub(crate) narrow: T,
}

pub(crate) struct Contexts<T> {
    pub(crate) format: T,
    pub(crate) standalone: T,
}

impl<T> Contexts<T> {
    pub(crate) fn get(&self, is_standalone: bool) -> &T {
        if is_standalone {
            &self.standalone
        } else {
            &self.format
        }
    }
}

type DayPeriodNames = [Name; DAY_PERIOD_KEYS.len()];

pub(crate) const DAY_PERIOD_KEYS: [&[u8]; 10] = [
    b"midnight",
    b"noon",
    b"morning1",
    b"afternoon1",
    b"evening1",
    b"night1",
    b"morning2",
    b"afternoon2",
    b"evening2",
    b"night2",
];

/// Patterns with `{0}` for the month.
pub(crate) struct LeapMonthPatterns {
    pub(crate) names: Contexts<Widths<Name>>,
    pub(crate) numeric: Name,
}

pub(crate) struct DateFormatSymbols {
    /// Ranges of `units`.
    names: Vec<(u32, u32)>,
    units: Vec<u16>,
    pub(crate) eras: Widths<List>,
    pub(crate) months: Contexts<Widths<List>>,
    /// Each list begins with Sunday.
    pub(crate) weekdays: Contexts<Widths<List>>,
    pub(crate) am_pm: Widths<List>,
    pub(crate) day_periods: Widths<DayPeriodNames>,
    pub(crate) leap_month_patterns: Option<LeapMonthPatterns>,
    pub(crate) year_names: List,
}

impl DateFormatSymbols {
    /// `calendar_type` is the type for `locale`.
    pub(crate) fn shared(
        locale: &Locale,
        calendar_type: CalendarType,
    ) -> Result<Arc<Self>, UErrorCode> {
        static CACHE: LocaleCache<DateFormatSymbols> = LocaleCache::new();
        CACHE.get_or_create(locale.get_name(), || Self::load(locale, calendar_type))
    }

    pub(crate) fn name(&self, name: Name) -> Option<&[u16]> {
        let &(start, end) = self.names.get(name.0 as usize)?;
        Some(self.units.slice(start as usize..end as usize))
    }

    pub(crate) fn name_in(&self, list: List, index: usize) -> Option<&[u16]> {
        if index < (list.end - list.start) as usize {
            self.name(Name(list.start + index as u32))
        } else {
            None
        }
    }
}

/// The target of an alias in `calendar/<type>`.
enum Alias {
    None,
    /// The path of another resource of the current calendar.
    SameCalendar(Vec<u8>),
    /// The same path in `CalendarData::next_calendar_type`.
    DifferentCalendar,
    Gregorian,
}

/// The first resource at a path wins, and tables are not merged. ICU4C: dtfmtsym.cpp, CalendarDataSink
#[derive(Default)]
struct CalendarData {
    /// Keyed by path, such as `monthNames/format/wide`.
    arrays: Map<Vec<u8>, ResourceArray>,
    /// The tables that contain at least one string, keyed by path.
    tables: Map<Vec<u8>, ResourceTable>,
    /// Pairs of target path and alias path.
    pending_aliases: Vec<(Vec<u8>, Vec<u8>)>,
    calendar_type: Vec<u8>,
    next_calendar_type: Option<U16s<'static>>,
    /// The top-level keys to read, which were aliases in a previous table. If empty, all keys are read.
    resources_to_visit: Vec<&'static [u8]>,
}

const ALIAS_PREFIX: &[u8] = b"/LOCALE/calendar/";
const GREGORIAN: &[u8] = b"gregorian";
const VARIANT: &[u8] = b"%variant";

// The data have a depth of 3 and fewer than 20 calendar types.
const MAX_DEPTH: usize = 32;
const MAX_TYPES: usize = 64;

/// `rest` is a path without the prefix `cyclicNameSets`.
fn is_used_cyclic_name_set(rest: &[u8]) -> bool {
    matches!(
        rest,
        b"/years" | b"/years/format" | b"/years/format/abbreviated"
    )
}

impl CalendarData {
    fn contains(&self, path: &[u8]) -> bool {
        self.arrays.contains_key(path) || self.tables.contains_key(path)
    }

    /// Returns the keys and strings of the table at `path`.
    fn strings(
        &self,
        path: &[u8],
    ) -> Option<impl Iterator<Item = (&'static [u8], U16s<'static>)> + use<>> {
        let items = self.tables.get(path)?.iter();
        Some(items.filter_map(|(key, value)| value.get_string().ok().map(|string| (key, string))))
    }

    fn put_array(&mut self, path: &[u8], array: ResourceArray) -> Result<(), UErrorCode> {
        try_map_insert(&mut self.arrays, try_to_vec(path)?, array).map(drop)
    }

    fn process_alias(&mut self, path: &[u8], value: ResourceValue) -> Result<Alias, UErrorCode> {
        if value.get_type() != URES_ALIAS {
            return Ok(Alias::None);
        }
        let alias = value.get_alias_string()?;
        let rest = alias.slice_clamped(ALIAS_PREFIX.len()..alias.len());
        if alias
            .slice_clamped(0..ALIAS_PREFIX.len())
            .eq_bytes(ALIAS_PREFIX)
            && let Some(slash @ 1..) = rest.iter().position(|unit| unit == u16::from(b'/'))
        {
            let (calendar_type, target) = (rest.slice(0..slash), rest.slice(slash + 1..));
            match (
                calendar_type.eq_bytes(&self.calendar_type),
                target.eq_bytes(path),
            ) {
                // A unit above 0xff becomes NUL, which no key contains, so the path matches nothing.
                (true, false) => {
                    return try_collect(target.iter().map(|unit| u8::try_from(unit).unwrap_or(0)))
                        .map(Alias::SameCalendar);
                }
                (false, true) if calendar_type.eq_bytes(GREGORIAN) => return Ok(Alias::Gregorian),
                (false, true)
                    if self
                        .next_calendar_type
                        .get_or_insert(calendar_type)
                        .as_bytes()
                        == calendar_type.as_bytes() =>
                {
                    return Ok(Alias::DifferentCalendar);
                }
                _ => {}
            }
        }
        Err(U_INTERNAL_PROGRAM_ERROR)
    }

    fn process_resource(
        &mut self,
        path: &mut Vec<u8>,
        value: ResourceValue,
        depth: usize,
    ) -> Result<(), UErrorCode> {
        if depth > MAX_DEPTH {
            return Err(U_INTERNAL_PROGRAM_ERROR);
        }
        let (table, path_length) = (value.get_table()?, path.len());
        let mut has_strings = false;
        for (key, value) in table.iter() {
            if key.ends_with(VARIANT) {
                continue;
            }
            if value.get_type() == URES_STRING {
                has_strings = true;
                continue;
            }
            path.add(b'/');
            path.add_all(key);
            if path
                .strip_prefix(b"cyclicNameSets")
                .is_none_or(is_used_cyclic_name_set)
                && !self.contains(path)
            {
                match (self.process_alias(path, value)?, value.get_type()) {
                    (Alias::SameCalendar(target), _) => {
                        self.pending_aliases.add((target, try_to_vec(path)?))
                    }
                    (_, URES_ARRAY) => self.put_array(path, value.get_array()?)?,
                    (_, URES_TABLE) => self.process_resource(path, value, depth + 1)?,
                    _ => {}
                }
            }
            path.truncate(path_length);
        }
        if has_strings {
            try_map_insert(&mut self.tables, try_to_vec(path)?, table)?;
        }
        Ok(())
    }

    /// Copies each target, which must have been loaded, to the path of its alias.
    fn resolve_aliases(&mut self) -> Result<(), UErrorCode> {
        for (target, path) in std::mem::take(&mut self.pending_aliases) {
            if self.contains(&path) {
                continue;
            }
            if let Some(&array) = self.arrays.get(&target) {
                try_map_insert(&mut self.arrays, path, array)?;
            } else {
                let table = *self.tables.get(&target).ok_or(U_MISSING_RESOURCE_ERROR)?;
                try_map_insert(&mut self.tables, path, table)?;
            }
        }
        Ok(())
    }

    /// Loads `first`, the types that aliases name, and finally the Gregorian calendar, each from the locale up to root.
    fn load_calendars(
        &mut self,
        first: &[u8],
        calendars: &UResourceBundle,
    ) -> Result<(), UErrorCode> {
        self.calendar_type = try_to_vec(first)?;
        for _ in 0..MAX_TYPES {
            let bundle = calendars.get_by_key_with_fallback(&self.calendar_type)?;
            _ = ures_get_all_items_with_fallback(&bundle, b"", self)?;
            if self.calendar_type == GREGORIAN {
                return Ok(());
            }
            self.calendar_type.clear();
            if let Some(next) = self.next_calendar_type.take() {
                append_invariant_chars(&mut self.calendar_type, next.iter())?;
            } else {
                self.calendar_type.add_all(GREGORIAN);
                self.resources_to_visit.clear();
            }
        }
        Err(U_INTERNAL_PROGRAM_ERROR)
    }
}

impl ResourceSink for CalendarData {
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        let mut resources_to_visit_next = Vec::new();
        for (key, value) in value.get_table()?.iter() {
            match self.process_alias(key, value)? {
                Alias::Gregorian => {}
                Alias::DifferentCalendar => resources_to_visit_next.add(key),
                Alias::SameCalendar(target) => {
                    if !self.contains(&target) {
                        self.pending_aliases.add((target, try_to_vec(key)?));
                    }
                }
                Alias::None
                    if !self.resources_to_visit.is_empty()
                        && !self.resources_to_visit.contains(&key)
                        && key != b"AmPmMarkersAbbr" => {}
                Alias::None => match key {
                    b"AmPmMarkers" | b"AmPmMarkersAbbr" | b"AmPmMarkersNarrow"
                        if !self.arrays.contains_key(key) =>
                    {
                        self.put_array(key, value.get_array()?)?;
                    }
                    b"eras" | b"dayNames" | b"monthNames" | b"dayPeriod" | b"monthPatterns"
                    | b"cyclicNameSets" => {
                        self.process_resource(&mut try_to_vec(key)?, value, 1)?
                    }
                    _ => {}
                },
            }
        }
        self.resolve_aliases()?;
        if !resources_to_visit_next.is_empty() {
            self.resources_to_visit = resources_to_visit_next;
        }
        Ok(())
    }
}

struct Builder {
    data: CalendarData,
    names: Vec<U16s<'static>>,
}

fn append(all: &mut Vec<U16s<'static>>, names: impl Iterator<Item = U16s<'static>>) -> List {
    let start = all.len() as u32;
    all.add_each(names);
    List {
        start,
        end: all.len() as u32,
    }
}

impl Builder {
    fn add_name(&mut self, name: U16s<'static>) -> Name {
        Name(append(&mut self.names, once(name)).start)
    }

    fn list(&mut self, path: &[u8]) -> Result<List, UErrorCode> {
        let array = self.data.arrays.get(path).ok_or(U_MISSING_RESOURCE_ERROR)?;
        let names = array
            .iter()
            .map(|item| item.get_string().unwrap_or_default());
        Ok(append(&mut self.names, names))
    }

    /// `paths` are in the order wide, abbreviated, narrow.
    fn widths(
        &mut self,
        [wide, abbreviated, narrow]: [&[u8]; 3],
    ) -> Result<Widths<List>, UErrorCode> {
        Ok(Widths {
            wide: self.list(wide)?,
            abbreviated: self.list(abbreviated)?,
            narrow: self.list(narrow)?,
        })
    }

    fn leap_month_patterns(&mut self) -> Option<LeapMonthPatterns> {
        let mut pattern = |path: &[u8]| {
            let (_, pattern) = self.data.strings(path)?.find(|&(key, _)| key == b"leap")?;
            Some(self.add_name(pattern))
        };
        Some(LeapMonthPatterns {
            names: Contexts {
                format: Widths {
                    wide: pattern(b"monthPatterns/format/wide")?,
                    abbreviated: pattern(b"monthPatterns/format/abbreviated")?,
                    narrow: pattern(b"monthPatterns/format/narrow")?,
                },
                standalone: Widths {
                    wide: pattern(b"monthPatterns/stand-alone/wide")?,
                    abbreviated: pattern(b"monthPatterns/stand-alone/abbreviated")?,
                    narrow: pattern(b"monthPatterns/stand-alone/narrow")?,
                },
            },
            numeric: pattern(b"monthPatterns/numeric/all")?,
        })
    }

    /// Missing names are taken from `fallback`.
    fn day_periods(&mut self, path: &[u8], fallback: DayPeriodNames) -> DayPeriodNames {
        let mut names = fallback;
        for (key, name) in self.data.strings(path).into_iter().flatten() {
            if let Some(period) = DAY_PERIOD_KEYS.iter().position(|&period| period == key) {
                names.set(period, self.add_name(name));
            }
        }
        names
    }

    /// An era that the table at `path` lacks is looked up with locale fallback in the type that defines it.
    fn eras_of_width(
        &mut self,
        path: &[u8],
        calendars: &UResourceBundle,
        rules: &EraRules,
    ) -> Result<List, UErrorCode> {
        let names = self.data.strings(path).ok_or(U_MISSING_RESOURCE_ERROR)?;
        let mut eras = try_filled((U16s::EMPTY, false), rules.code_count())?;
        for (key, name) in names {
            if let (code, true) = strtol(key)
                && let Some(era) = eras.get_mut(to_index(code))
            {
                *era = (name, true);
            }
        }
        for (calendar_type, codes) in rules.calendar_types() {
            let find =
                |table: &UResourceBundle, key: &[u8]| table.get_by_key_with_fallback(key).ok();
            let of_width = find(calendars, calendar_type)
                .and_then(|calendar| find(&calendar, b"eras"))
                .and_then(|eras| find(&eras, path.slice(b"eras/".len()..)));
            for code in codes {
                if let Some((era, false)) = eras.get_mut(code) {
                    let mut digits = NumBuffer::new();
                    let key = code.format_into(&mut digits).as_bytes();
                    let name = of_width.as_ref().and_then(|names| find(names, key));
                    *era = name
                        .and_then(|name| name.get_data_string().ok())
                        .map_or(U16s::EMPTY, DataString::units);
                }
            }
        }
        Ok(append(
            &mut self.names,
            eras.into_iter().map(|(era, _)| era),
        ))
    }

    fn eras(
        &mut self,
        calendar_type: &[u8],
        calendars: &UResourceBundle,
    ) -> Result<Widths<List>, UErrorCode> {
        let rules = match EraRules::load(calendar_type) {
            Err(U_MISSING_RESOURCE_ERROR) => EraRules::load(GREGORIAN),
            rules => rules,
        }?;
        Ok(Widths {
            wide: self.eras_of_width(b"eras/wide", calendars, &rules)?,
            abbreviated: self.eras_of_width(b"eras/abbreviated", calendars, &rules)?,
            narrow: self.eras_of_width(b"eras/narrow", calendars, &rules)?,
        })
    }
}

impl DateFormatSymbols {
    // ICU4C: dtfmtsym.cpp, DateFormatSymbols::initializeData
    #[cfg_attr(mordant, allow(defaulted_failure))] // Most calendars have no names for years.
    fn load(locale: &Locale, calendar_type: CalendarType) -> Result<Self, UErrorCode> {
        let calendar_type = calendar_type.name().to_bytes();
        let bundle = ures_open(None, locale.get_base_name())?;
        let calendars = bundle.get_by_key(b"calendar")?;
        let mut builder = Builder {
            data: CalendarData::default(),
            names: Vec::new(),
        };
        builder.data.load_calendars(calendar_type, &calendars)?;

        let am_pm = builder.list(b"AmPmMarkersAbbr")?;
        let day_periods =
            builder.day_periods(b"dayPeriod/format/abbreviated", DayPeriodNames::default());
        let mut symbols = Self {
            names: Vec::new(),
            units: Vec::new(),
            eras: builder.eras(calendar_type, &calendars)?,
            months: Contexts {
                format: builder.widths([
                    b"monthNames/format/wide",
                    b"monthNames/format/abbreviated",
                    b"monthNames/format/narrow",
                ])?,
                standalone: builder.widths([
                    b"monthNames/stand-alone/wide",
                    b"monthNames/stand-alone/abbreviated",
                    b"monthNames/stand-alone/narrow",
                ])?,
            },
            weekdays: Contexts {
                format: builder.widths([
                    b"dayNames/format/wide",
                    b"dayNames/format/abbreviated",
                    b"dayNames/format/narrow",
                ])?,
                standalone: builder.widths([
                    b"dayNames/stand-alone/wide",
                    b"dayNames/stand-alone/abbreviated",
                    b"dayNames/stand-alone/narrow",
                ])?,
            },
            am_pm: Widths {
                wide: builder.list(b"AmPmMarkers").unwrap_or(am_pm),
                abbreviated: am_pm,
                narrow: builder.list(b"AmPmMarkersNarrow").unwrap_or(am_pm),
            },
            day_periods: Widths {
                wide: builder.day_periods(b"dayPeriod/format/wide", day_periods),
                abbreviated: day_periods,
                narrow: builder.day_periods(b"dayPeriod/format/narrow", day_periods),
            },
            leap_month_patterns: builder.leap_month_patterns(),
            year_names: builder
                .list(b"cyclicNameSets/years/format/abbreviated")
                .unwrap_or_default(),
        };

        let length = builder.names.iter().map(|name| name.len());
        symbols.units = try_with_capacity(length.fold(0, usize::saturating_add))?;
        symbols.names = try_collect(builder.names.iter().map(|name| {
            let start = symbols.units.len() as u32;
            symbols.units.add_each(name.iter());
            (start, symbols.units.len() as u32)
        }))?;
        Ok(symbols)
    }
}
