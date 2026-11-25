//! The names of eras, months, days, quarters, day periods and cyclic years of a locale and a calendar. ICU4C: dtfmtsym.cpp

use crate::common::bytes::U16s;
use crate::common::cstring::until_nul;
use crate::common::locid::Locale;
use crate::common::maps::{Map, Set};
use crate::common::memory::{
    Appendable, try_collect, try_filled, try_map_insert, try_set_insert, try_to_vec,
    try_with_capacity,
};
use crate::common::resource::{ResourceArray, ResourceSink, ResourceTable, ResourceValue};
use crate::common::slice_ext::{SliceExt, to_index};
use crate::common::udata::searches_files;
use crate::common::uinvchar::invariant_chars;
use crate::common::unicode::ures::{URES_ALIAS, URES_ARRAY, URES_STRING, URES_TABLE};
use crate::common::uresdata::{DataString, strtol};
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::calendar::CalendarType;
use crate::i18n::erarules::EraRules;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::standardplural::{self, PluralForm};
use std::fmt::NumBuffer;
use std::iter::once;
use std::sync::Arc;

/// A range of `DateFormatSymbols::names`. The default is an absent list, not an empty one.
#[derive(Clone, Copy)]
pub(crate) struct List {
    start: u32,
    len: u32,
}

impl Default for List {
    fn default() -> Self {
        Self {
            start: u32::MAX,
            len: 0,
        }
    }
}

impl List {
    pub(crate) fn exists(self) -> bool {
        self.start != u32::MAX
    }

    pub(crate) fn len(self) -> usize {
        self.len as usize
    }

    fn or(self, other: Self) -> Self {
        if self.exists() { self } else { other }
    }
}

/// An index into `DateFormatSymbols::names`. The default is an absent name.
#[derive(Clone, Copy)]
pub(crate) struct Name(u32);

impl Default for Name {
    fn default() -> Self {
        Self(u32::MAX)
    }
}

#[derive(Default)]
pub(crate) struct Widths<T> {
    pub(crate) wide: T,
    pub(crate) abbreviated: T,
    pub(crate) narrow: T,
}

#[derive(Default)]
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

/// Names for the pattern field `ddd`. An empty name is an absent name.
#[derive(Default)]
pub(crate) struct DayOfMonthNames {
    /// Patterns with `{0}` for the number, indexed by ordinal plural form.
    pub(crate) ordinal: List,
    /// Indexed by day, 1 to 32.
    pub(crate) cardinal: List,
}

#[derive(Default)]
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
    pub(crate) short_weekdays: Contexts<List>,
    pub(crate) quarters: Contexts<Widths<List>>,
    pub(crate) day_of_month_names: DayOfMonthNames,
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
        if index < list.len() {
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

const MAX_DEPTH: usize = 32;
/// After so many calendar types none may come twice. Where an alias is below the top level, a row can end at a repeat.
const UNCHECKED_TYPES: usize = 64;

/// `rest` is a path without the prefix `cyclicNameSets`. An alias can lead from the years to the other sets.
fn is_used_cyclic_name_set(rest: &[u8]) -> bool {
    let sets: [&[u8]; 3] = [b"/years", b"/zodiacs", b"/dayParts"];
    (sets.iter().find_map(|set| rest.strip_prefix(*set))).is_some_and(|rest| {
        rest.is_empty()
            || rest
                .strip_prefix(b"/format")
                .is_some_and(|rest| rest.is_empty() || rest.starts_with(b"/abbreviated"))
    })
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
        let items = items.filter(|(key, _)| !key.ends_with(VARIANT));
        Some(items.filter_map(|(key, value)| value.get_string().ok().map(|string| (key, string))))
    }

    fn put_array(&mut self, path: &[u8], array: ResourceArray) -> Result<(), UErrorCode> {
        (array.iter()).try_for_each(|item| item.get_data_string().map(drop))?;
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

    /// Copies each target to the path of its alias. An alias whose target has not been loaded stays pending.
    fn resolve_aliases(&mut self) -> Result<(), UErrorCode> {
        loop {
            let pending = std::mem::take(&mut self.pending_aliases);
            let before = pending.len();
            for (target, path) in pending {
                if let Some(&array) = self.arrays.get(&target) {
                    if !self.arrays.contains_key(&path) {
                        try_map_insert(&mut self.arrays, path, array)?;
                    }
                } else if let Some(&table) = self.tables.get(&target) {
                    if !self.tables.contains_key(&path) {
                        try_map_insert(&mut self.tables, path, table)?;
                    }
                } else {
                    self.pending_aliases.add((target, path));
                }
            }
            if [0, before].contains(&self.pending_aliases.len()) {
                return Ok(());
            }
        }
    }

    /// Loads `first`, the types that aliases name, and finally the Gregorian calendar, each from the locale up to root.
    fn load_calendars(
        &mut self,
        first: &[u8],
        calendars: &UResourceBundle,
    ) -> Result<(), UErrorCode> {
        let (mut loaded, mut seen) = (0, Set::default());
        self.calendar_type = try_to_vec(first)?;
        loop {
            let key = until_nul(&self.calendar_type);
            let is_last = key == GREGORIAN;
            match calendars.get_by_key_with_fallback(key) {
                Err(U_MISSING_RESOURCE_ERROR) if !is_last => {}
                bundle => {
                    self.pending_aliases.clear();
                    ures_get_all_items_with_fallback(&bundle?, b"", self)?;
                }
            }
            if is_last {
                return Ok(());
            }
            if let Some(next) = self.next_calendar_type.take() {
                loaded += 1;
                if loaded >= UNCHECKED_TYPES && !try_set_insert(&mut seen, next.as_bytes())? {
                    return Err(U_INTERNAL_PROGRAM_ERROR);
                }
                self.calendar_type = invariant_chars(next.iter())?;
            } else {
                self.calendar_type = try_to_vec(GREGORIAN)?;
                self.resources_to_visit.clear();
            }
        }
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
                    | b"cyclicNameSets" | b"quarters" | b"dayOfMonthNames" => {
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
    /// Set by a missing list. No list is loaded until `load_or` clears it.
    is_missing: bool,
}

fn append(all: &mut Vec<U16s<'static>>, names: impl Iterator<Item = U16s<'static>>) -> List {
    let start = all.len() as u32;
    all.add_each(names);
    List {
        start,
        len: all.len() as u32 - start,
    }
}

impl Builder {
    fn add_name(&mut self, name: U16s<'static>) -> Name {
        Name(append(&mut self.names, once(name)).start)
    }

    fn load_optional(&mut self, path: &[u8]) -> List {
        let Some(array) = self.data.arrays.get(path) else {
            return List::default();
        };
        let names = array
            .iter()
            .map(|item| item.get_string().unwrap_or_default());
        append(&mut self.names, names)
    }

    fn load_required(&mut self, path: &[u8]) -> List {
        if self.is_missing {
            return List::default();
        }
        let list = self.load_optional(path);
        self.is_missing = !list.exists();
        list
    }

    fn load_or(&mut self, path: &[u8], other: List) -> List {
        let list = self.load_required(path);
        self.is_missing = false;
        list.or(other)
    }

    fn months(&mut self) -> Contexts<Widths<List>> {
        let wide = self.load_required(b"monthNames/format/wide");
        let abbreviated = self.load_required(b"monthNames/format/abbreviated");
        let standalone_wide = self.load_or(b"monthNames/stand-alone/wide", wide);
        let standalone_abbreviated =
            self.load_or(b"monthNames/stand-alone/abbreviated", abbreviated);
        // The second path is empty if the first list is missing.
        let narrow = self.load_optional(b"monthNames/format/narrow");
        let standalone_narrow = self.load_optional(if narrow.exists() {
            b"monthNames/stand-alone/narrow"
        } else {
            b""
        });
        let narrow = narrow.or(standalone_narrow).or(abbreviated);
        Contexts {
            format: Widths {
                wide,
                abbreviated,
                narrow,
            },
            standalone: Widths {
                wide: standalone_wide,
                abbreviated: standalone_abbreviated,
                narrow: standalone_narrow.or(narrow),
            },
        }
    }

    fn quarters(&mut self) -> Contexts<Widths<List>> {
        let wide = self.load_required(b"quarters/format/wide");
        let abbreviated = self.load_or(b"quarters/format/abbreviated", wide);
        let standalone = Widths {
            wide: self.load_or(b"quarters/stand-alone/wide", wide),
            abbreviated: self.load_or(b"quarters/stand-alone/abbreviated", abbreviated),
            narrow: self.load_required(b"quarters/stand-alone/narrow"),
        };
        Contexts {
            format: Widths {
                wide,
                abbreviated,
                narrow: self.load_or(b"quarters/format/narrow", standalone.narrow),
            },
            standalone,
        }
    }

    /// Also returns the short names.
    fn weekdays(&mut self) -> (Contexts<Widths<List>>, Contexts<List>) {
        let wide = self.load_required(b"dayNames/format/wide");
        let abbreviated = self.load_required(b"dayNames/format/abbreviated");
        let format = self.load_or(b"dayNames/format/short", abbreviated);
        let standalone = self.load_or(b"dayNames/stand-alone/short", format);
        let narrow = self.load_optional(b"dayNames/format/narrow");
        let standalone_narrow = self.load_optional(b"dayNames/stand-alone/narrow");
        let narrow = narrow.or(standalone_narrow).or(abbreviated);
        let names = Contexts {
            format: Widths {
                wide,
                abbreviated,
                narrow,
            },
            standalone: Widths {
                wide: self.load_or(b"dayNames/stand-alone/wide", wide),
                abbreviated: self.load_or(b"dayNames/stand-alone/abbreviated", abbreviated),
                narrow: standalone_narrow.or(narrow),
            },
        };
        (names, Contexts { format, standalone })
    }

    /// All seven tables must exist. A missing or empty pattern is taken from another.
    fn leap_month_patterns(&mut self) -> Option<LeapMonthPatterns> {
        let pattern = |path: &[u8]| {
            let leap = self.data.strings(path)?.find(|&(key, _)| key == b"leap");
            Some(leap.unwrap_or_default().1)
        };
        let or = |pattern: U16s<'static>, other| if pattern.is_empty() { other } else { pattern };
        let wide = pattern(b"monthPatterns/format/wide")?;
        let abbreviated = or(pattern(b"monthPatterns/format/abbreviated")?, wide);
        let narrow = pattern(b"monthPatterns/stand-alone/narrow")?;
        let [format, standalone] = [
            [
                wide,
                abbreviated,
                or(pattern(b"monthPatterns/format/narrow")?, narrow),
            ],
            [
                or(pattern(b"monthPatterns/stand-alone/wide")?, wide),
                or(
                    pattern(b"monthPatterns/stand-alone/abbreviated")?,
                    abbreviated,
                ),
                narrow,
            ],
        ];
        let numeric = pattern(b"monthPatterns/numeric/all")?;
        let mut widths = |[wide, abbreviated, narrow]: [_; 3]| Widths {
            wide: self.add_name(wide),
            abbreviated: self.add_name(abbreviated),
            narrow: self.add_name(narrow),
        };
        Some(LeapMonthPatterns {
            names: Contexts {
                format: widths(format),
                standalone: widths(standalone),
            },
            numeric: self.add_name(numeric),
        })
    }

    fn day_of_month_names(&mut self) -> DayOfMonthNames {
        let (mut ordinal, mut cardinal) = ([U16s::EMPTY; standardplural::COUNT], [U16s::EMPTY; 33]);
        let names = self.data.strings(b"dayOfMonthNames/format/abbreviated");
        for (key, name) in names.into_iter().flatten() {
            match strtol(key) {
                _ if !key.first().is_some_and(u8::is_ascii_digit) => {
                    let form = PluralForm::from_keyword(key).unwrap_or(PluralForm::Other);
                    ordinal.set(form.index(), name);
                }
                (day @ 1..=32, true) if key.len() < 4 => cardinal.set(to_index(day), name),
                _ => {}
            }
        }
        DayOfMonthNames {
            ordinal: append(&mut self.names, ordinal.into_iter()),
            cardinal: append(&mut self.names, cardinal.into_iter()),
        }
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

    /// An era that the table at `path` lacks is looked up with locale fallback. The last type that has its code wins.
    fn eras_of_width(
        &mut self,
        path: &[u8],
        calendars: &UResourceBundle,
        rules: &EraRules,
    ) -> Result<List, UErrorCode> {
        let Some(names) = self.data.strings(path) else {
            return Ok(List::default());
        };
        let mut eras = try_filled((U16s::EMPTY, false), rules.code_count())?;
        for (key, name) in names {
            let code = to_index(strtol(key).0);
            if let Some(era) = eras.get_mut(code)
                && code.format_into(&mut NumBuffer::new()).as_bytes() == key
            {
                *era = (name, true);
            }
        }
        for (calendar_type, mut codes) in rules.calendar_types() {
            // The linked data have no names for lower codes.
            if searches_files()? {
                codes.start = 0;
            }
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
        let rules = match EraRules::load(calendar_type, false) {
            Err(U_MISSING_RESOURCE_ERROR) => EraRules::load(GREGORIAN, false),
            rules => rules,
        };
        let rules = match rules {
            Err(U_MISSING_RESOURCE_ERROR) => return Ok(Widths::default()),
            rules => rules?,
        };
        let abbreviated = self.eras_of_width(b"eras/abbreviated", calendars, &rules)?;
        if !abbreviated.exists() {
            return Ok(Widths::default());
        }
        let mut or_abbreviated = |path: &[u8]| {
            self.eras_of_width(path, calendars, &rules)
                .map(|list| list.or(abbreviated))
        };
        Ok(Widths {
            wide: or_abbreviated(b"eras/wide")?,
            abbreviated,
            narrow: or_abbreviated(b"eras/narrow")?,
        })
    }
}

impl DateFormatSymbols {
    // ICU4C: dtfmtsym.cpp, DateFormatSymbols::initializeData
    pub(crate) fn load(locale: &Locale, calendar_type: CalendarType) -> Result<Self, UErrorCode> {
        let calendar_type = calendar_type.name().to_bytes();
        let bundle = ures_open(None, locale.get_base_name())?;
        let calendars = bundle.get_by_key(b"calendar")?;
        let mut builder = Builder {
            data: CalendarData::default(),
            names: Vec::new(),
            is_missing: false,
        };
        builder.data.load_calendars(calendar_type, &calendars)?;

        let am_pm = builder.load_optional(b"AmPmMarkersAbbr");
        let day_periods =
            builder.day_periods(b"dayPeriod/format/abbreviated", DayPeriodNames::default());
        let (weekdays, short_weekdays) = builder.weekdays();
        let mut symbols = Self {
            eras: builder.eras(calendar_type, &calendars)?,
            months: builder.months(),
            weekdays,
            short_weekdays,
            am_pm: Widths {
                wide: builder.load_optional(b"AmPmMarkers").or(am_pm),
                abbreviated: am_pm,
                narrow: builder.load_optional(b"AmPmMarkersNarrow").or(am_pm),
            },
            day_periods: Widths {
                wide: builder.day_periods(b"dayPeriod/format/wide", day_periods),
                abbreviated: day_periods,
                narrow: builder.day_periods(b"dayPeriod/format/narrow", day_periods),
            },
            leap_month_patterns: builder.leap_month_patterns(),
            year_names: builder.load_optional(b"cyclicNameSets/years/format/abbreviated"),
            quarters: builder.quarters(),
            day_of_month_names: builder.day_of_month_names(),
            ..Self::default()
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
