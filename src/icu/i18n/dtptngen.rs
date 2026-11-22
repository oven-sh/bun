//! Finds the pattern for a skeleton such as "yMMMd", or combines several patterns. ICU4C: dtptngen.cpp

use crate::common::bytes::U16s;
use crate::common::cstring::split_once;
use crate::common::locid::Locale;
use crate::common::loclikely::ulocimp_get_region_for_supplemental_data;
use crate::common::maps::Map;
use crate::common::memory::{
    Appendable, try_box_uninit, try_concat, try_map_insert, try_map_reserve, try_push, try_to_vec,
    try_with_capacity,
};
use crate::common::resource::{ResourceTable, ResourceValue};
use crate::common::simpleformatter::SimpleFormatter;
use crate::common::slice_ext::{SliceExt, to_length};
use crate::common::udata::searches_files;
use crate::common::umutex::OnceBox;
use crate::common::unicode::ures::{URES_ARRAY, URES_STRING};
use crate::common::uresimp::*;
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;
use crate::i18n::calendar::CalendarType;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::region::get_region;
use std::iter::repeat_n;
use std::mem::replace;

const QUOTE: u16 = b'\'' as u16;
const DOT: u16 = b'.' as u16;

/// One bit per `Field`: the hours, minutes or seconds get the requested length.
pub(crate) type UDateTimePatternMatchOptions = i32;
pub(crate) const UDATPG_MATCH_NO_OPTIONS: UDateTimePatternMatchOptions = 0;

/// `UDateTimePatternField`
#[derive(Clone, Copy, PartialEq)]
enum Field {
    Era,
    Year,
    Quarter,
    Month,
    WeekOfYear,
    WeekOfMonth,
    Weekday,
    DayOfYear,
    DayOfWeekInMonth,
    Day,
    DayPeriod,
    Hour,
    Minute,
    Second,
    FractionalSecond,
    Zone,
}

type PerField<T> = [T; 16];

/// A set of fields: bit `1 << field` for each.
type Mask = u16;

const DATE_FIELDS: Mask = (1 << Field::DayPeriod as u16) - 1;
const SECOND: Mask = 1 << Field::Second as u16;
const FRACTIONAL_SECOND: Mask = 1 << Field::FractionalSecond as u16;
/// Only a pattern from a file can bring these into a request.
const RARE_FIELDS: Mask = 1 << Field::Quarter as u16 | 1 << Field::WeekOfYear as u16 | RARE_NAMES;
/// The rare fields whose names are needed only for append items.
const RARE_NAMES: Mask = 1 << Field::WeekOfMonth as u16
    | 1 << Field::DayOfYear as u16
    | 1 << Field::DayOfWeekInMonth as u16;

#[derive(Clone, Copy)]
struct FieldType {
    field: Field,
    min_length: u8,
    /// Distances are measured on this number. Positive for a numeric field.
    kind: i16,
}

const NARROW: i16 = -0x101;
const SHORTER: i16 = -0x102;
const SHORT: i16 = -0x103;
const LONG: i16 = -0x104;
const NUMERIC: i16 = 0x100;
const DELTA: i16 = 0x10;

/// The distance for a field that only the request has.
const MISSING_FIELD: u32 = 0x1000;
const MAX_DISTANCE: u32 = 0xffff;

/// Pairs of minimum length and kind.
type KindsByLength = &'static [(u8, i16)];

// ICU4C: dtptngen.cpp, dtTypes
#[rustfmt::skip]
const DT_TYPES: [(u8, Field, KindsByLength); 41] = [
    (b'G', Field::Era, &[(1, SHORT), (4, LONG), (5, NARROW)]),
    (b'y', Field::Year, &[(1, NUMERIC)]),
    (b'Y', Field::Year, &[(1, NUMERIC + DELTA)]),
    (b'u', Field::Year, &[(1, NUMERIC + 2 * DELTA)]),
    (b'r', Field::Year, &[(1, NUMERIC + 3 * DELTA)]),
    (b'U', Field::Year, &[(1, SHORT), (4, LONG), (5, NARROW)]),
    (b'Q', Field::Quarter, &[(1, NUMERIC), (3, SHORT), (4, LONG), (5, NARROW)]),
    (b'q', Field::Quarter, &[(1, NUMERIC + DELTA), (3, SHORT - DELTA), (4, LONG - DELTA), (5, NARROW - DELTA)]),
    (b'M', Field::Month, &[(1, NUMERIC), (3, SHORT), (4, LONG), (5, NARROW)]),
    (b'L', Field::Month, &[(1, NUMERIC + DELTA), (3, SHORT - DELTA), (4, LONG - DELTA), (5, NARROW - DELTA)]),
    (b'l', Field::Month, &[(1, NUMERIC + DELTA)]),
    (b'w', Field::WeekOfYear, &[(1, NUMERIC)]),
    (b'W', Field::WeekOfMonth, &[(1, NUMERIC)]),
    (b'E', Field::Weekday, &[(1, SHORT), (4, LONG), (5, NARROW), (6, SHORTER)]),
    (b'c', Field::Weekday, &[
        (1, NUMERIC + 2 * DELTA), (3, SHORT - 2 * DELTA), (4, LONG - 2 * DELTA),
        (5, NARROW - 2 * DELTA), (6, SHORTER - 2 * DELTA),
    ]),
    (b'e', Field::Weekday, &[
        (1, NUMERIC + DELTA), (3, SHORT - DELTA), (4, LONG - DELTA), (5, NARROW - DELTA), (6, SHORTER - DELTA),
    ]),
    (b'd', Field::Day, &[(1, NUMERIC), (3, SHORT)]),
    (b'g', Field::Day, &[(1, NUMERIC + DELTA)]),
    (b'D', Field::DayOfYear, &[(1, NUMERIC)]),
    (b'F', Field::DayOfWeekInMonth, &[(1, NUMERIC)]),
    (b'a', Field::DayPeriod, &[(1, SHORT), (4, LONG), (5, NARROW)]),
    (b'b', Field::DayPeriod, &[(1, SHORT - DELTA), (4, LONG - DELTA), (5, NARROW - DELTA)]),
    (b'B', Field::DayPeriod, &[(1, SHORT - 3 * DELTA), (4, LONG - 3 * DELTA), (5, NARROW - 3 * DELTA)]),
    (b'H', Field::Hour, &[(1, NUMERIC + 10 * DELTA)]),
    (b'k', Field::Hour, &[(1, NUMERIC + 11 * DELTA)]),
    (b'h', Field::Hour, &[(1, NUMERIC)]),
    (b'K', Field::Hour, &[(1, NUMERIC + DELTA)]),
    (b'J', Field::Hour, &[(1, NUMERIC + 5 * DELTA)]),
    (b'j', Field::Hour, &[(1, NUMERIC + 6 * DELTA)]),
    (b'C', Field::Hour, &[(1, NUMERIC + 7 * DELTA)]),
    (b'm', Field::Minute, &[(1, NUMERIC)]),
    (b's', Field::Second, &[(1, NUMERIC)]),
    (b'A', Field::Second, &[(1, NUMERIC + DELTA)]),
    (b'S', Field::FractionalSecond, &[(1, NUMERIC)]),
    (b'v', Field::Zone, &[(1, SHORT - 2 * DELTA), (4, LONG - 2 * DELTA)]),
    (b'z', Field::Zone, &[(1, SHORT), (4, LONG)]),
    (b'Z', Field::Zone, &[(1, NARROW - DELTA), (4, LONG - DELTA), (5, SHORT - DELTA)]),
    (b'O', Field::Zone, &[(1, SHORT - DELTA), (4, LONG - DELTA)]),
    (b'V', Field::Zone, &[(1, SHORT - DELTA), (2, LONG - DELTA), (3, LONG - 1 - DELTA), (4, LONG - 2 - DELTA)]),
    (b'X', Field::Zone, &[(1, NARROW - DELTA), (2, SHORT - DELTA), (4, LONG - DELTA)]),
    (b'x', Field::Zone, &[(1, NARROW - DELTA), (2, SHORT - DELTA), (4, LONG - DELTA)]),
];

/// `DT_TYPES` indexed by letter (A to z) and by length (1 to 6, which stands for all greater lengths).
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static FIELD_TYPES: [[Option<FieldType>; 6]; 58] = {
    let (mut types, mut row) = ([[None; 6]; 58], 0);
    while row < DT_TYPES.len() {
        let ((letter, field, kinds), mut length, mut next) = (DT_TYPES[row], 1, 0);
        while length <= 6 {
            if next < kinds.len() && kinds[next].0 == length {
                next += 1;
            }
            let (min_length, kind) = kinds[next - 1];
            types[(letter - b'A') as usize][length as usize - 1] = Some(FieldType {
                field,
                min_length,
                kind,
            });
            length += 1;
        }
        row += 1;
    }
    types
};

fn index_of_letter(letter: u16) -> usize {
    usize::from(letter.wrapping_sub(u16::from(b'A')))
}

impl FieldType {
    fn of(letter: u16, length: usize) -> Option<FieldType> {
        FIELD_TYPES
            .get(index_of_letter(letter))?
            .at(length.clamp(1, 6) - 1)
    }
}

/// Iterator over the runs of one code unit and the quoted literals of a pattern, each with its first unit.
struct Tokens<'a>(&'a [u16]);

impl<'a> Iterator for Tokens<'a> {
    type Item = (u16, &'a [u16]);

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        let &first = self.0.first()?;
        let length = if first == QUOTE {
            literal_length(self.0)
        } else {
            self.0
                .iter()
                .position(|&unit| unit != first)
                .unwrap_or(self.0.len())
        };
        let token = self.0.slice(..length);
        self.0 = self.0.slice(length..);
        Some((first, token))
    }
}

/// Returns the length of the quoted literal at the start of `text`, including its quotes and escaped quotes.
fn literal_length(text: &[u16]) -> usize {
    let mut rest = text;
    while let [QUOTE, after @ ..] = rest {
        rest = after
            .iter()
            .position(|&unit| unit == QUOTE)
            .map_or(&[], |closing| after.slice(closing + 1..));
    }
    text.len() - rest.len()
}

fn is_12_hour_letter(letter: u8) -> bool {
    matches!(letter, b'h' | b'K')
}

fn is_24_hour_letter(letter: u8) -> bool {
    matches!(letter, b'H' | b'k')
}

/// All arrays have 0 for an absent field.
#[derive(Clone, Copy, Default)]
struct Skeleton {
    letters: PerField<u8>,
    /// Truncated to `i8`.
    lengths: PerField<i16>,
    base_lengths: PerField<i16>,
    /// `FieldType::kind`, plus the length for a numeric field.
    kinds: PerField<i16>,
    /// The fields whose kind is not 0.
    fields: Mask,
    added_default_day_period: bool,
}

/// The array that is compared along with the letters when skeletons are matched.
#[derive(Clone, Copy)]
enum MatchKind {
    Lengths,
    BaseLengths,
    Kinds,
}

impl Skeleton {
    /// Parses a pattern or a skeleton.
    fn parse(pattern: &[u16]) -> Skeleton {
        let mut skeleton = Skeleton::default();
        Tokens(pattern).for_each(|(first, token)| skeleton.set(first, token.len()));
        skeleton.complete();
        skeleton
    }

    /// Adds or removes the fields that depend on others, after the last `set`.
    fn complete(&mut self) {
        if self.has(Field::Minute) && self.has(Field::FractionalSecond) && !self.has(Field::Second)
        {
            self.set(u16::from(b's'), 1);
        }
        if self.has(Field::Hour) {
            if !is_12_hour_letter(self.letters.at(Field::Hour as usize)) {
                self.populate(
                    0,
                    FieldType {
                        field: Field::DayPeriod,
                        min_length: 0,
                        kind: 0,
                    },
                    0,
                );
            } else if !self.has(Field::DayPeriod) {
                self.set(u16::from(b'a'), 1);
                self.added_default_day_period = true;
            }
        }
    }

    /// Ignores units that `DT_TYPES` lacks.
    fn set(&mut self, unit: u16, length: usize) {
        if let Some(field_type) = FieldType::of(unit, length) {
            self.populate(unit as u8, field_type, length);
        }
    }

    fn populate(
        &mut self,
        letter: u8,
        FieldType {
            field,
            min_length,
            kind,
        }: FieldType,
        length: usize,
    ) {
        let field = field as usize;
        self.letters.set(field, letter);
        self.lengths.set(field, i16::from(length as i8));
        self.base_lengths.set(field, i16::from(min_length));
        let kind = if kind > 0 {
            kind.wrapping_add(length as i16)
        } else {
            kind
        };
        self.kinds.set(field, kind);
        self.fields = self.fields & !(1 << field) | Mask::from(kind != 0) << field;
    }

    fn has(&self, field: Field) -> bool {
        self.lengths.at(field as usize) != 0
    }

    fn key(&self, match_kind: MatchKind) -> (&PerField<u8>, &PerField<i16>) {
        let numbers = match match_kind {
            MatchKind::Lengths => &self.lengths,
            MatchKind::BaseLengths => &self.base_lengths,
            MatchKind::Kinds => &self.kinds,
        };
        (&self.letters, numbers)
    }

    fn first_letter(&self) -> u16 {
        self.letters
            .iter()
            .find(|&&letter| letter != 0)
            .map_or(0, |&letter| u16::from(letter))
    }

    /// A pattern with a two-digit year ("MMM d, ’yy") matches only a request for a two-digit year.
    fn year_length_is_compatible(&self, trial: &Skeleton) -> bool {
        let year = Field::Year as usize;
        self.kinds.at(year) <= 0
            || trial.kinds.at(year) <= 0
            || trial.lengths.at(year) != 2
            || self.lengths.at(year) == 2
    }

    /// Returns `None` if `other` has unwanted fields, or lacks too many for `limit`. `self` has all `wanted` fields.
    fn distance(&self, other: &Skeleton, wanted: Mask, limit: u32) -> Option<u32> {
        if other.fields & !wanted != 0 {
            return None;
        }
        let mut distance = (wanted & !other.fields).count_ones() * MISSING_FIELD;
        if distance > limit {
            return None;
        }
        let mut both = wanted & other.fields;
        while both != 0 {
            let field = both.trailing_zeros() as usize;
            distance += u32::from(self.kinds.at(field).abs_diff(other.kinds.at(field)));
            both &= both - 1;
        }
        Some(distance)
    }
}

pub(crate) fn get_skeleton(pattern: &[u16]) -> Result<Vec<u16>, UErrorCode> {
    let mut skeleton = Skeleton::parse(pattern);
    if skeleton.added_default_day_period {
        skeleton.lengths.set(Field::DayPeriod as usize, 0);
    }
    let mut text = try_with_capacity(pattern.len())?;
    for (&letter, &length) in skeleton.letters.iter().zip(&skeleton.lengths) {
        if length > 0 {
            text.add_each(repeat_n(u16::from(letter), length as usize));
        }
    }
    Ok(text)
}

struct Entry {
    skeleton: Skeleton,
    pattern: Vec<u16>,
    /// The skeleton is a key of `availableFormats`, not derived from the pattern.
    skeleton_was_specified: bool,
}

struct PatternMap {
    /// Indexed by the first letter of the base skeleton, A to z. Candidates are compared in this order.
    lists: [Vec<Entry>; 58],
    /// Whether two entries can have lengths that differ by 256, and so look the same.
    has_long_fields: bool,
}

impl PatternMap {
    fn iter(&self) -> impl Iterator<Item = &Entry> {
        self.lists.iter().flatten()
    }

    fn find(&self, skeleton: &Skeleton, match_kind: MatchKind) -> Option<&Entry> {
        let key = skeleton.key(match_kind);
        self.lists
            .get(index_of_letter(skeleton.first_letter()))?
            .iter()
            .find(|entry| entry.skeleton.key(match_kind) == key)
    }

    fn add(
        &mut self,
        skeleton: &Skeleton,
        pattern: Vec<u16>,
        skeleton_was_specified: bool,
    ) -> Result<(), UErrorCode> {
        let entries = self
            .lists
            .get_mut(index_of_letter(skeleton.first_letter()))
            .ok_or(U_ILLEGAL_CHARACTER)?;
        let key = skeleton.key(MatchKind::Kinds);
        if let Some(entry) = entries
            .iter_mut()
            .find(|entry| entry.skeleton.key(MatchKind::Kinds) == key)
        {
            // The entry keeps its skeleton, whose lengths may differ ("E", "EEE").
            entry.pattern = pattern;
            entry.skeleton_was_specified = skeleton_was_specified;
            return Ok(());
        }
        try_push(
            entries,
            Entry {
                skeleton: *skeleton,
                pattern,
                skeleton_was_specified,
            },
        )
    }

    /// `request` has all `wanted` fields. Each field has an entry. ICU4C: dtptngen.cpp, DateTimePatternGenerator::getBestRaw
    fn best_match(&self, request: &Skeleton, wanted: Mask) -> Option<&Entry> {
        let (mut best, mut best_distance, mut best_missing) = (None, MAX_DISTANCE, 0);
        for entry in self.iter() {
            let skeleton = &entry.skeleton;
            let Some(distance) = request.distance(skeleton, wanted, best_distance) else {
                continue;
            };
            let missing = wanted & !skeleton.fields;
            if (distance < best_distance || (distance == best_distance && best_missing < missing))
                && request.year_length_is_compatible(skeleton)
            {
                (best, best_distance, best_missing) = (Some(entry), distance, missing);
                if distance == 0 {
                    break;
                }
            }
        }
        best
    }

    /// Returns the entry whose pattern is used if `best` is the best match.
    #[inline]
    fn first_like<'a>(&'a self, best: &'a Entry) -> &'a Entry {
        if self.has_long_fields {
            return self
                .find(&best.skeleton, MatchKind::Lengths)
                .unwrap_or(best);
        }
        best
    }
}

/// A value of `timeData`: "h", "hB", ...
#[derive(Clone, Copy)]
struct HourFormat {
    hour: u8,
    /// `a` if the format has no day period letter.
    day_period: u8,
}

#[derive(Clone, Copy)]
struct HourFormats {
    /// The replacement for `j`.
    preferred: u8,
    /// The replacement for `C`: the first allowed format, or `None` if it is unknown.
    allowed: Option<HourFormat>,
}

struct Request {
    skeleton: Skeleton,
    uses_cap_j: bool,
    options: UDateTimePatternMatchOptions,
}

/// The most fields of seconds that get a fraction. Each repeats the decimal separator, which has any length.
const MAX_FRACTIONS: usize = 50;

const CANONICAL_ITEMS: PerField<u8> = *b"GyQMwWEDFdaHmsSv";

/// Capacities that save most reallocations: for fields that get longer, and for patterns that are combined.
const USUAL_GROWTH: usize = 16;
const USUAL_JOINED_LENGTH: usize = 64;

/// Fills in a format with two arguments or more.
fn join(format: &[u16], values: &[&[u16]]) -> Result<Vec<u16>, UErrorCode> {
    let formatter = SimpleFormatter::with_pattern_min_max_arguments(format, 2, values.len())?;
    let mut joined = try_with_capacity(USUAL_JOINED_LENGTH)?;
    formatter.format(values, &mut joined);
    Ok(joined)
}

/// Boxed because `Fields` is too large to move on a small stack.
pub(crate) struct DateTimePatternGenerator(Box<Fields>);

struct Fields {
    patterns: PatternMap,
    /// {0} is the pattern so far, {1} the pattern of the field, {2} the name of the field.
    append_item_formats: PerField<Vec<u16>>,
    /// Indexed by `UDateTimePGDisplayWidth`. The wide name is the name in an append item.
    field_display_names: PerField<[Vec<u16>; 3]>,
    /// Indexed by style, `UDAT_FULL` to `UDAT_SHORT`. {0} is the time, {1} the date.
    date_time_formats: [Vec<u16>; 4],
    decimal: Vec<u16>,
    hour_formats: HourFormats,
    /// `RARE_FIELDS` unless data can come from files.
    skipped_fields: Mask,
}

impl DateTimePatternGenerator {
    pub(crate) fn field_display_name(&self, field: usize, width: usize) -> Option<&[u16]> {
        self.0.field_display_name(field, width)
    }

    pub(crate) fn get_best_pattern(
        &self,
        skeleton: &[u16],
        options: UDateTimePatternMatchOptions,
    ) -> Result<Vec<u16>, UErrorCode> {
        self.0.get_best_pattern(skeleton, options)
    }
}

impl Fields {
    /// Falls back to the wider names, then to "F0" to "F15".
    fn field_display_name(&self, field: usize, width: usize) -> Option<&[u16]> {
        static DEFAULTS: [u16; 38] = from_latin1(b"F0F1F2F3F4F5F6F7F8F9F10F11F12F13F14F15");
        let start_of = |field: usize| 2 * field + field.saturating_sub(10);
        let names = self.field_display_names.get(field)?.get(..=width)?;
        match names.iter().rfind(|name| !name.is_empty()) {
            Some(name) => Some(name),
            None => DEFAULTS.get(start_of(field)..start_of(field + 1)),
        }
    }

    fn get_best_pattern(
        &self,
        skeleton: &[u16],
        options: UDateTimePatternMatchOptions,
    ) -> Result<Vec<u16>, UErrorCode> {
        let request = &self.parse_request(skeleton, options)?;
        let needed = request.skeleton.fields;
        if needed & self.skipped_fields != 0 {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let (date_fields, time_fields) = (needed & DATE_FIELDS, needed & !DATE_FIELDS);
        if date_fields == 0 || time_fields == 0 {
            return self.get_best_appending(request, needed);
        }
        // Few patterns have both kinds of fields.
        if self
            .patterns
            .iter()
            .any(|entry| entry.skeleton.fields == needed)
            && let Some(best) = self.patterns.best_match(&request.skeleton, needed)
            && best.skeleton.fields == needed
        {
            let entry = self.patterns.first_like(best);
            return self.adjust_field_types::<false>(&entry.pattern, request, entry);
        }
        let date = self.get_best_appending(request, date_fields)?;
        let time = self.get_best_appending(request, time_fields)?;
        if time.is_empty() {
            return Ok(date);
        }
        if date.is_empty() {
            return Ok(time);
        }
        let [full, long, medium, short] = &self.date_time_formats;
        let format = match request.skeleton.base_lengths.at(Field::Month as usize) {
            4 if request.skeleton.base_lengths.at(Field::Weekday as usize) > 0 => full,
            4 => long,
            3 => medium,
            _ => short,
        };
        join(format, &[&time, &date])
    }

    /// Parses `skeleton` with `j`, `J` and `C` replaced and quoted text removed.
    fn parse_request(
        &self,
        skeleton: &[u16],
        options: UDateTimePatternMatchOptions,
    ) -> Result<Request, UErrorCode> {
        const LOW_J: u16 = b'j' as u16;
        const CAP_J: u16 = b'J' as u16;
        const CAP_C: u16 = b'C' as u16;
        let (mut parsed, mut uses_cap_j) = (Skeleton::default(), false);
        // The last run of the mapped text, which the next piece may continue.
        let (mut run_unit, mut run_length) = (0, 0);
        let mut append = |unit: u16, count: usize| {
            if unit != run_unit {
                parsed.set(run_unit, run_length);
                (run_unit, run_length) = (unit, 0);
            }
            run_length += count;
        };
        for (unit, token) in Tokens(skeleton) {
            match unit {
                QUOTE => {}
                LOW_J | CAP_C => {
                    let HourFormat { hour, day_period } = if unit == LOW_J {
                        HourFormat {
                            hour: self.hour_formats.preferred,
                            day_period: b'a',
                        }
                    } else {
                        self.hour_formats.allowed.ok_or(U_INVALID_FORMAT_ERROR)?
                    };
                    let extra = token.len() - 1;
                    if !is_24_hour_letter(hour) {
                        let length = if extra < 2 { 1 } else { 3 + extra / 2 };
                        append(u16::from(day_period), length);
                    }
                    append(u16::from(hour), 1 + extra % 2);
                }
                CAP_J => {
                    append(u16::from(b'H'), token.len());
                    uses_cap_j = true;
                }
                _ => append(unit, token.len()),
            }
        }
        parsed.set(run_unit, run_length);
        parsed.complete();
        Ok(Request {
            skeleton: parsed,
            uses_cap_j,
            options,
        })
    }

    fn adjust_field_types<const ADDS_FRACTION: bool>(
        &self,
        pattern: &[u16],
        request: &Request,
        matched: &Entry,
    ) -> Result<Vec<u16>, UErrorCode> {
        // A field of n letters is not adjusted if the pattern starts with n dots.
        let leading_dots = pattern.iter().take_while(|&&unit| unit == DOT).count();
        let mut adjusted = try_with_capacity(pattern.len() + USUAL_GROWTH)?;
        // Tokens that stay as they are, from `kept` on, are appended together.
        let (mut kept, mut end, mut fraction_count) = (0, 0, 0);
        for (first, token) in Tokens(pattern) {
            let start = end;
            end += token.len();
            let mut append_kept =
                || adjusted.add_all(pattern.slice(replace(&mut kept, end)..start));
            match FieldType::of(first, token.len()).filter(|_| token.len() > leading_dots) {
                Some(found) if ADDS_FRACTION && found.field == Field::Second => {
                    fraction_count += 1;
                    if fraction_count > MAX_FRACTIONS {
                        return Err(U_ILLEGAL_ARGUMENT_ERROR);
                    }
                    append_kept();
                    let fraction = to_length(
                        request
                            .skeleton
                            .lengths
                            .at(Field::FractionalSecond as usize)
                            .into(),
                    );
                    adjusted.add_all(token);
                    adjusted.add_all(&self.decimal);
                    adjusted.add_each(repeat_n(u16::from(b'S'), fraction));
                }
                Some(found) if request.skeleton.kinds.at(found.field as usize) != 0 => {
                    let field = (first as u8, token.len());
                    let (letter, length) = self.adjust_field(found, field, request, matched);
                    if (letter, length) != field {
                        append_kept();
                        adjusted.add_each(repeat_n(u16::from(letter), length));
                    }
                }
                _ => {}
            }
        }
        adjusted.add_all(pattern.slice(kept..end));
        Ok(adjusted)
    }

    /// Returns the letter and the length for a field of both the pattern and the request.
    #[inline(always)]
    fn adjust_field(
        &self,
        found: FieldType,
        (found_letter, found_length): (u8, usize),
        request: &Request,
        matched: &Entry,
    ) -> (u8, usize) {
        let field = found.field as usize;
        let requested = request.skeleton.letters.at(field);
        let mut requested_length = request.skeleton.lengths.at(field);
        if requested == b'E' {
            requested_length = requested_length.max(3);
        }
        let is_time = matches!(found.field, Field::Hour | Field::Minute | Field::Second);
        let keeps_length = (is_time && request.options & 1 << field == 0)
            || (matched.skeleton_was_specified
                && !matches!(requested, b'c' | b'e')
                && (matched.skeleton.lengths.at(field) == requested_length
                    || (found.kind > 0) != (request.skeleton.kinds.at(field) > 0)));
        let length = if keeps_length {
            found_length
        } else {
            to_length(i32::from(requested_length))
        };
        let preferred = self.hour_formats.preferred;
        let letter = match found.field {
            Field::Hour
                if request.uses_cap_j
                    || is_12_hour_letter(requested) && is_12_hour_letter(preferred)
                    || is_24_hour_letter(requested) && is_24_hour_letter(preferred) =>
            {
                preferred
            }
            Field::Weekday if found_letter == b'E' && length < 3 => b'e',
            Field::Hour | Field::Month | Field::Weekday => found_letter,
            Field::Year if requested != b'Y' => found_letter,
            _ => requested,
        };
        (letter, length)
    }

    /// Returns the best pattern, with the best pattern for its missing fields appended.
    fn get_best_appending(&self, request: &Request, wanted: Mask) -> Result<Vec<u16>, UErrorCode> {
        const BOTH: Mask = SECOND | FRACTIONAL_SECOND;
        let Some(best) = self.patterns.best_match(&request.skeleton, wanted) else {
            return Ok(Vec::new());
        };
        let (entry, mut missing) = (
            self.patterns.first_like(best),
            wanted & !best.skeleton.fields,
        );
        let mut result = self.adjust_field_types::<false>(&entry.pattern, request, entry)?;
        if missing & BOTH == FRACTIONAL_SECOND && wanted & BOTH == BOTH {
            result = self.adjust_field_types::<true>(&result, request, entry)?;
            missing &= !FRACTIONAL_SECOND;
        }
        if missing == 0 {
            return Ok(result);
        }
        let best = self.patterns.best_match(&request.skeleton, missing);
        let best = best.ok_or(U_INTERNAL_PROGRAM_ERROR)?;
        let entry = self.patterns.first_like(best);
        let top_field = (best.skeleton.fields | 1).ilog2() as usize;
        let format = match self.append_item_formats.get(top_field) {
            Some(format) if !format.is_empty() => format.as_slice(),
            _ => &DEFAULT_APPEND_ITEM_FORMAT,
        };
        let item = self.adjust_field_types::<false>(&entry.pattern, request, entry)?;
        let name = self.field_display_name(top_field, 0).unwrap_or_default();
        let name = try_concat(&[&[QUOTE], name, &[QUOTE]])?;
        join(format, &[&result, &item, &name])
    }
}

fn field_of_append_item(key: &[u8]) -> Option<Field> {
    Some(match key {
        b"Era" => Field::Era,
        b"Year" => Field::Year,
        b"Quarter" => Field::Quarter,
        b"Month" => Field::Month,
        b"Week" => Field::WeekOfYear,
        b"*" => Field::WeekOfMonth,
        b"Day-Of-Week" => Field::Weekday,
        b"Day" => Field::Day,
        b"Hour" => Field::Hour,
        b"Minute" => Field::Minute,
        b"Second" => Field::Second,
        b"Timezone" => Field::Zone,
        _ => return None,
    })
}

/// Returns the field for a key of `fields`, without its width.
fn field_of_display_name(key: &[u8]) -> Option<Field> {
    Some(match key {
        b"era" => Field::Era,
        b"year" => Field::Year,
        b"quarter" => Field::Quarter,
        b"month" => Field::Month,
        b"week" => Field::WeekOfYear,
        b"weekOfMonth" => Field::WeekOfMonth,
        b"weekday" => Field::Weekday,
        b"dayOfYear" => Field::DayOfYear,
        b"weekdayOfMonth" => Field::DayOfWeekInMonth,
        b"day" => Field::Day,
        b"dayperiod" => Field::DayPeriod,
        b"hour" => Field::Hour,
        b"minute" => Field::Minute,
        b"second" => Field::Second,
        b"*" => Field::FractionalSecond,
        b"zone" => Field::Zone,
        _ => return None,
    })
}

/// "{0} ├{2}: {1}┤"
const DEFAULT_APPEND_ITEM_FORMAT: [u16; 14] = [
    0x7b, 0x30, 0x7d, 0x20, 0x251c, 0x7b, 0x32, 0x7d, 0x3a, 0x20, 0x7b, 0x31, 0x7d, 0x2524,
];

/// More than the `availableFormats` of a CLDR locale and its parents.
const USUAL_FORMAT_COUNT: usize = 100;

/// Fails if `value` is not a string, even if `target` is not empty.
fn set_if_empty(target: &mut Vec<u16>, value: &ResourceValue) -> Result<(), UErrorCode> {
    if target.is_empty() {
        *target = value.get_string()?.try_to_vec()?;
    } else if value.get_type() != URES_STRING {
        return Err(U_RESOURCE_TYPE_MISMATCH);
    }
    Ok(())
}

/// Returns the key in the table `calendar` for the keyword of `locale`, or for the default of its bundle.
pub(crate) fn calendar_type_in_data(locale: &Locale) -> Result<Vec<u8>, UErrorCode> {
    ures_get_calendar_type(locale.get_name())
}

impl HourFormat {
    const H: HourFormat = HourFormat {
        hour: b'H',
        day_period: b'a',
    };

    fn parse(text: U16s) -> Option<HourFormat> {
        let mut letters = text.iter().map(|unit| u8::try_from(unit).unwrap_or(0));
        let (hour, day_period) = match [letters.next(), letters.next(), letters.next()] {
            [Some(hour @ (b'h' | b'H' | b'K' | b'k')), None, _] => (hour, b'a'),
            [
                Some(hour @ (b'h' | b'H' | b'K')),
                Some(day_period @ (b'b' | b'B')),
                None,
            ] => (hour, day_period),
            _ => return None,
        };
        Some(HourFormat { hour, day_period })
    }
}

/// Returns the tables from the child bundle up. The keys are regions, or languages with regions.
fn load_time_data() -> Result<Vec<ResourceTable>, UErrorCode> {
    let mut tables = Vec::new();
    let bundle = ures_open_direct(None, b"supplementalData")?;
    ures_get_all_items_with_fallback(&bundle, b"timeData", &mut |table: &ResourceValue| {
        try_push(&mut tables, table.get_table()?)
    })?;
    Ok(tables)
}

impl HourFormats {
    const DEFAULT: HourFormats = HourFormats {
        preferred: b'H',
        allowed: Some(HourFormat::H),
    };

    fn from_table(value: ResourceValue) -> Result<HourFormats, UErrorCode> {
        let table = value.get_table()?;
        // The first allowed format. The outer `None` means that the list is missing or empty.
        let mut allowed = None;
        if let Some(value) = table.get(b"allowed") {
            if let Ok(format) = value.get_string() {
                allowed = Some(HourFormat::parse(format));
            } else {
                for format in value.get_array()?.iter() {
                    allowed.get_or_insert(HourFormat::parse(format.get_string()?));
                }
            }
        }
        let preferred = match table.get(b"preferred") {
            Some(format) => HourFormat::parse(format.get_string()?),
            None => None,
        };
        let allowed = allowed.unwrap_or_else(|| preferred.or(Some(HourFormat::H)));
        let preferred = preferred
            .or(allowed)
            .filter(|format| format.day_period == b'a');
        Ok(HourFormats {
            preferred: preferred.unwrap_or(HourFormat::H).hour,
            allowed,
        })
    }

    // ICU4C: dtptngen.cpp, DateTimePatternGenerator::getAllowedHourFormats
    fn for_locale(locale: &Locale) -> Result<HourFormats, UErrorCode> {
        static TIME_DATA: OnceBox<Result<Vec<ResourceTable>, UErrorCode>> = OnceBox::new();
        let time_data = TIME_DATA.get_or_init_caching_err(load_time_data)?;
        let region = ulocimp_get_region_for_supplemental_data(locale.get_name(), false)?;
        let (mut language, mut country) = (locale.get_language(), &*region);
        let mut max_locale;
        if language.is_empty() || country.is_empty() {
            max_locale = locale.clone();
            if max_locale.add_likely_subtags().is_ok() {
                (language, country) = (max_locale.get_language(), max_locale.get_country());
            }
        }
        if language.is_empty() {
            language = b"und";
        }
        if country.is_empty() {
            country = b"001";
        }
        // The entry of a parent bundle replaces the entry of its child.
        let get = |key: &[u8]| time_data.iter().rev().find_map(|table| table.get(key));
        let find = |country: &[u8]| {
            try_concat(&[language, b"_", country]).map(|both| get(&both).or_else(|| get(country)))
        };
        let found = match find(country)? {
            None => get_region(country).map_or(Ok(None), |region| find(&region))?,
            found => found,
        };
        let mut formats = found.map_or(Ok(HourFormats::DEFAULT), HourFormats::from_table)?;
        match &*locale.get_keyword_value(b"hours")? {
            b"h24" => formats.preferred = b'k',
            b"h23" => formats.preferred = b'H',
            b"h12" => formats.preferred = b'h',
            b"h11" => formats.preferred = b'K',
            hours if hours.len() > 8 => return Err(U_ILLEGAL_ARGUMENT_ERROR),
            _ => {}
        }
        Ok(formats)
    }
}

impl DateTimePatternGenerator {
    pub(crate) fn create_instance(locale: &Locale) -> Result<Self, UErrorCode> {
        Self::new(locale, true)
    }

    /// The patterns of the date and time styles are no candidates.
    pub(crate) fn create_instance_no_std_pat(locale: &Locale) -> Result<Self, UErrorCode> {
        Self::new(locale, false)
    }

    // Not inlined: `Fields` may be built on the stack.
    #[inline(never)]
    fn new_empty() -> Result<Box<Fields>, UErrorCode> {
        let has_files = searches_files()?;
        Ok(Box::write(
            try_box_uninit()?,
            Fields {
                patterns: PatternMap {
                    lists: [const { Vec::new() }; 58],
                    has_long_fields: has_files,
                },
                append_item_formats: Default::default(),
                field_display_names: Default::default(),
                date_time_formats: Default::default(),
                decimal: Vec::new(),
                hour_formats: HourFormats::DEFAULT,
                skipped_fields: if has_files { 0 } else { RARE_FIELDS },
            },
        ))
    }

    fn new(locale: &Locale, adds_style_patterns: bool) -> Result<Self, UErrorCode> {
        if locale.is_bogus() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let mut fields = Self::new_empty()?;
        for (field, item) in CANONICAL_ITEMS.into_iter().enumerate() {
            if fields.skipped_fields >> field & 1 == 0 {
                let item = [u16::from(item)];
                fields
                    .patterns
                    .add(&Skeleton::parse(&item), try_to_vec(&item)?, false)?;
            }
        }
        let base_bundle = ures_open(None, locale.get_base_name())?;
        let calendar_type = match calendar_type_in_data(locale) {
            // Neither `locale` nor the default locale has a bundle.
            Err(U_MISSING_RESOURCE_ERROR) => try_to_vec(b"gregorian"),
            found => found,
        }?;
        if adds_style_patterns {
            fields.add_style_patterns(&base_bundle, locale, &calendar_type)?;
        }
        // The bundles can differ: "x-hans" opens root, "x-hans@hours=h12" falls back to the default locale.
        fields.add_cldr_data(&ures_open(None, locale.get_name())?, &calendar_type)?;
        fields.set_date_time_from_calendar(&base_bundle, locale)?;
        let symbols = DecimalFormatSymbols::new(locale)?;
        fields.decimal = try_to_vec(symbols.get_const_symbol(Symbol::DecimalSeparator))?;
        fields.hour_formats = HourFormats::for_locale(locale)?;
        Ok(Self(fields))
    }
}

impl Fields {
    fn add_style_patterns(
        &mut self,
        bundle: &UResourceBundle,
        locale: &Locale,
        calendar_type: &[u8],
    ) -> Result<(), UErrorCode> {
        let calendar_type = if locale.get_base_name() == b"ja_JP_TRADITIONAL" {
            b"gregorian"
        } else {
            calendar_type
        };
        let path = try_concat(&[b"calendar/", calendar_type, b"/DateTimePatterns"])?;
        let patterns = bundle
            .get_by_key_with_fallback(&path)
            .or(Err(U_INVALID_FORMAT_ERROR))?;
        if patterns.get_type() != URES_ARRAY {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        for i in 0..8 {
            let item = patterns.get_by_index(i)?;
            if !matches!(item.get_type(), URES_STRING | URES_ARRAY) {
                return Err(U_INVALID_FORMAT_ERROR);
            }
            // Index 0 of a string is the string itself.
            let pattern = ures_get_unicode_string_by_index(&item, 0)?;
            let skeleton = Skeleton::parse(&pattern);
            let has_same = |match_kind| self.patterns.find(&skeleton, match_kind).is_some();
            if !has_same(MatchKind::BaseLengths)
                && !(self.patterns.has_long_fields && has_same(MatchKind::Lengths))
            {
                self.patterns.add(&skeleton, pattern, false)?;
            }
        }
        Ok(())
    }

    /// Ignores errors in the three tables.
    fn add_cldr_data(
        &mut self,
        bundle: &UResourceBundle,
        calendar_type: &[u8],
    ) -> Result<(), UErrorCode> {
        let path = |table: &[u8]| try_concat(&[b"calendar/", calendar_type, b"/", table]);

        let mut put_format = |key: &[u8], value: &ResourceValue| {
            field_of_append_item(key)
                .filter(|&field| self.skipped_fields >> field as u16 & 1 == 0)
                .and_then(|field| self.append_item_formats.get_mut(field as usize))
                .map_or(Ok(()), |format| set_if_empty(format, value))
        };
        _ = ures_get_all_children_with_fallback(bundle, &path(b"appendItems")?, &mut put_format);

        let mut put_name =
            |key: &[u8], value: &ResourceValue| self.put_field_display_name(key, value);
        _ = ures_get_all_children_with_fallback(bundle, b"fields", &mut put_name);

        let (mut keys, mut format_key) = (Map::default(), Vec::new());
        try_map_reserve(&mut keys, USUAL_FORMAT_COUNT)?;
        let mut put_available = |key: &'static [u8], value: &ResourceValue| {
            if try_map_insert(&mut keys, key, ())?.is_some() {
                return Ok(());
            }
            format_key.clear();
            format_key.add_each(key.iter().copied().map(u16::from));
            let skeleton = Skeleton::parse(&format_key);
            if skeleton.fields & self.skipped_fields != 0 {
                return Ok(());
            }
            let text = value.get_string();
            if self
                .patterns
                .find(&skeleton, MatchKind::Lengths)
                .is_some_and(|entry| entry.skeleton_was_specified)
            {
                return text.map(drop);
            }
            // A table, as under "MMMMW" and "yw", gives an empty pattern.
            self.patterns
                .add(&skeleton, text.unwrap_or_default().try_to_vec()?, true)
        };
        _ = ures_get_all_children_with_fallback(
            bundle,
            &path(b"availableFormats")?,
            &mut put_available,
        );
        Ok(())
    }

    fn put_field_display_name(
        &mut self,
        key: &[u8],
        value: &ResourceValue,
    ) -> Result<(), UErrorCode> {
        let (field, width) = split_once(key, b'-');
        let names = field_of_display_name(field)
            .filter(|&field| (self.skipped_fields & RARE_NAMES) >> field as u16 & 1 == 0)
            .and_then(|field| self.field_display_names.get_mut(field as usize));
        let Some([wide, abbreviated, narrow]) = names else {
            return Ok(());
        };
        let target = match width {
            Some(b"short") => abbreviated,
            Some(b"narrow") => narrow,
            _ => wide,
        };
        // The linked data have no errors that would end the walk.
        if self.skipped_fields != 0 && !target.is_empty() {
            return Ok(());
        }
        value
            .get_table()?
            .get(b"dn")
            .map_or(Ok(()), |name| set_if_empty(target, &name))
    }

    fn set_date_time_from_calendar(
        &mut self,
        bundle: &UResourceBundle,
        locale: &Locale,
    ) -> Result<(), UErrorCode> {
        let calendars = bundle.get_by_key(b"calendar")?;
        let calendar_type = CalendarType::for_locale(locale).unwrap_or(CalendarType::Gregorian);
        let find_in = |calendar_type: CalendarType, tag: &[u8]| {
            calendars
                .get_by_key_with_fallback(calendar_type.name().to_bytes())?
                .get_by_key_with_fallback(tag)
        };
        let find = |tag: &[u8]| match find_in(calendar_type, tag) {
            Err(_) if calendar_type != CalendarType::Gregorian => {
                find_in(CalendarType::Gregorian, tag)
            }
            found => found,
        };
        let (patterns, offset) = match find(b"DateTimePatterns%atTime") {
            Err(U_MISSING_RESOURCE_ERROR) => (find(b"DateTimePatterns")?, 9),
            at_time => (at_time?, 0),
        };
        for (i, format) in self.date_time_formats.iter_mut().enumerate() {
            *format = ures_get_unicode_string_by_index(&patterns, offset + i)?;
        }
        Ok(())
    }
}
