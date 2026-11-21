//! Finds the pattern for a skeleton such as "yMMMd", or combines several patterns. ICU4C: dtptngen.cpp

use crate::common::cstring::split_once;
use crate::common::locid::Locale;
use crate::common::loclikely::ulocimp_get_region_for_supplemental_data;
use crate::common::locresdata::find_replacement;
use crate::common::maps::Map;
use crate::common::memory::{
    Appendable, try_box_uninit, try_concat, try_map_insert, try_map_reserve, try_push, try_to_vec,
    try_with_capacity,
};
use crate::common::resource::ResourceValue;
use crate::common::simpleformatter::SimpleFormatter;
use crate::common::slice_ext::{SliceExt, to_length};
use crate::common::umutex::OnceBox;
use crate::common::uresimp::*;
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;
use crate::i18n::calendar::CalendarType;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::timezone::{Part, cached_part};
use std::iter::repeat_n;
use std::mem::replace;

const QUOTE: u16 = b'\'' as u16;

/// One bit per `Field`: the hours, minutes or seconds get the requested length.
pub(crate) type UDateTimePatternMatchOptions = i32;
pub(crate) const UDATPG_MATCH_NO_OPTIONS: UDateTimePatternMatchOptions = 0;

/// `UDateTimePatternField`
#[derive(Clone, Copy, PartialEq)]
enum Field {
    Era = 0,
    Year = 1,
    Quarter = 2,
    Month = 3,
    WeekOfYear = 4,
    Weekday = 6,
    Day = 9,
    DayPeriod = 10,
    Hour = 11,
    Minute = 12,
    Second = 13,
    FractionalSecond = 14,
    Zone = 15,
}

type PerField<T> = [T; 16];

/// A set of fields: bit `1 << field` for each.
type Mask = u16;

const DATE_FIELDS: Mask = (1 << Field::DayPeriod as u16) - 1;
const SECOND: Mask = 1 << Field::Second as u16;
const FRACTIONAL_SECOND: Mask = 1 << Field::FractionalSecond as u16;

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
const DT_TYPES: [(u8, Field, KindsByLength); 23] = [
    (b'G', Field::Era, &[(1, SHORT), (4, LONG), (5, NARROW)]),
    (b'y', Field::Year, &[(1, NUMERIC)]),
    (b'Y', Field::Year, &[(1, NUMERIC + DELTA)]),
    (b'r', Field::Year, &[(1, NUMERIC + 3 * DELTA)]),
    (b'U', Field::Year, &[(1, SHORT), (4, LONG), (5, NARROW)]),
    (b'M', Field::Month, &[(1, NUMERIC), (3, SHORT), (4, LONG), (5, NARROW)]),
    (b'L', Field::Month, &[(1, NUMERIC + DELTA), (3, SHORT - DELTA), (4, LONG - DELTA), (5, NARROW - DELTA)]),
    (b'E', Field::Weekday, &[(1, SHORT), (4, LONG), (5, NARROW), (6, SHORTER)]),
    (b'c', Field::Weekday, &[
        (1, NUMERIC + 2 * DELTA), (3, SHORT - 2 * DELTA), (4, LONG - 2 * DELTA),
        (5, NARROW - 2 * DELTA), (6, SHORTER - 2 * DELTA),
    ]),
    (b'd', Field::Day, &[(1, NUMERIC), (3, SHORT)]),
    (b'a', Field::DayPeriod, &[(1, SHORT), (4, LONG), (5, NARROW)]),
    (b'B', Field::DayPeriod, &[(1, SHORT - 3 * DELTA), (4, LONG - 3 * DELTA), (5, NARROW - 3 * DELTA)]),
    (b'H', Field::Hour, &[(1, NUMERIC + 10 * DELTA)]),
    (b'k', Field::Hour, &[(1, NUMERIC + 11 * DELTA)]),
    (b'h', Field::Hour, &[(1, NUMERIC)]),
    (b'K', Field::Hour, &[(1, NUMERIC + DELTA)]),
    (b'm', Field::Minute, &[(1, NUMERIC)]),
    (b's', Field::Second, &[(1, NUMERIC)]),
    (b'S', Field::FractionalSecond, &[(1, NUMERIC)]),
    (b'v', Field::Zone, &[(1, SHORT - 2 * DELTA), (4, LONG - 2 * DELTA)]),
    (b'z', Field::Zone, &[(1, SHORT), (4, LONG)]),
    (b'Z', Field::Zone, &[(1, NARROW - DELTA), (4, LONG - DELTA), (5, SHORT - DELTA)]),
    (b'O', Field::Zone, &[(1, SHORT - DELTA), (4, LONG - DELTA)]),
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
    /// Parses a pattern or a skeleton. Fails for a letter that `DT_TYPES` lacks.
    fn parse(pattern: &[u16]) -> Result<Skeleton, UErrorCode> {
        let mut skeleton = Skeleton::default();
        Tokens(pattern).try_for_each(|(first, token)| skeleton.set(first, token.len()))?;
        skeleton.complete()?;
        Ok(skeleton)
    }

    /// Adds or removes the fields that depend on others, after the last `set`.
    fn complete(&mut self) -> Result<(), UErrorCode> {
        if self.has(Field::Minute) && self.has(Field::FractionalSecond) && !self.has(Field::Second)
        {
            self.set(u16::from(b's'), 1)?;
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
                self.set(u16::from(b'a'), 1)?;
                self.added_default_day_period = true;
            }
        }
        Ok(())
    }

    /// Ignores units that are not letters.
    fn set(&mut self, unit: u16, length: usize) -> Result<(), UErrorCode> {
        match FieldType::of(unit, length) {
            Some(field_type) => self.populate(unit as u8, field_type, length),
            None if matches!(unit, 0x41..=0x5a | 0x61..=0x7a) => return Err(U_UNSUPPORTED_ERROR),
            None => {}
        }
        Ok(())
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
    // Perf: `?` on the value would copy it twice.
    let mut parsed = Skeleton::parse(pattern);
    let skeleton = parsed.as_mut().map_err(|code| *code)?;
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

    /// `request` has all `wanted` fields. ICU4C: dtptngen.cpp, DateTimePatternGenerator::getBestRaw
    fn best_match(&self, request: &Skeleton, wanted: Mask) -> Result<&Entry, UErrorCode> {
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
        best.ok_or(U_UNSUPPORTED_ERROR)
    }
}

struct Request {
    skeleton: Skeleton,
    options: UDateTimePatternMatchOptions,
}

const CANONICAL_ITEMS: &[u8] = b"GyMEdaHmsSv";

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
    /// The replacement for `j`.
    preferred_hour: u8,
}

impl DateTimePatternGenerator {
    /// The name is empty if `field_of_display_name` does not know the field.
    pub(crate) fn field_display_name(&self, field: usize, width: usize) -> Option<&[u16]> {
        Some(self.0.field_display_names.get(field)?.get(width)?)
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
    fn get_best_pattern(
        &self,
        skeleton: &[u16],
        options: UDateTimePatternMatchOptions,
    ) -> Result<Vec<u16>, UErrorCode> {
        let request = &self.parse_request(skeleton, options)?;
        let needed = request.skeleton.fields;
        let (date_fields, time_fields) = (needed & DATE_FIELDS, needed & !DATE_FIELDS);
        if date_fields == 0 || time_fields == 0 {
            return self.get_best_appending(request, needed);
        }
        // Few patterns have both kinds of fields.
        if self
            .patterns
            .iter()
            .any(|entry| entry.skeleton.fields == needed)
        {
            let best = self.patterns.best_match(&request.skeleton, needed)?;
            if best.skeleton.fields == needed {
                return self.adjust_field_types(&best.pattern, request, best, false);
            }
        }
        let date = self.get_best_appending(request, date_fields)?;
        let time = self.get_best_appending(request, time_fields)?;
        let [full, long, medium, short] = &self.date_time_formats;
        let format = match request.skeleton.base_lengths.at(Field::Month as usize) {
            4 if request.skeleton.base_lengths.at(Field::Weekday as usize) > 0 => full,
            4 => long,
            3 => medium,
            _ => short,
        };
        join(format, &[&time, &date])
    }

    /// Parses `skeleton` with `j` replaced and quoted text removed.
    fn parse_request(
        &self,
        skeleton: &[u16],
        options: UDateTimePatternMatchOptions,
    ) -> Result<Request, UErrorCode> {
        const J: u16 = b'j' as u16;
        let mut parsed = Skeleton::default();
        // The last run of the mapped text, which the next piece may continue.
        let (mut run_unit, mut run_length) = (0, 0);
        let mut append = |unit: u16, count: usize| -> Result<(), UErrorCode> {
            if unit != run_unit {
                parsed.set(run_unit, run_length)?;
                (run_unit, run_length) = (unit, 0);
            }
            run_length += count;
            Ok(())
        };
        for (unit, token) in Tokens(skeleton) {
            match (unit, token.len()) {
                (QUOTE, _) => {}
                (J, length @ ..=2) => {
                    if !is_24_hour_letter(self.preferred_hour) {
                        append(u16::from(b'a'), 1)?;
                    }
                    append(u16::from(self.preferred_hour), length)?;
                }
                (_, length) => append(unit, length)?,
            }
        }
        parsed.set(run_unit, run_length)?;
        parsed.complete()?;
        Ok(Request {
            skeleton: parsed,
            options,
        })
    }

    fn adjust_field_types(
        &self,
        pattern: &[u16],
        request: &Request,
        matched: &Entry,
        fix_fractional_seconds: bool,
    ) -> Result<Vec<u16>, UErrorCode> {
        let mut adjusted = try_with_capacity(pattern.len() + USUAL_GROWTH)?;
        // Tokens that stay as they are, from `kept` on, are appended together.
        let (mut kept, mut end) = (0, 0);
        for (first, token) in Tokens(pattern) {
            let start = end;
            end += token.len();
            let mut append_kept =
                || adjusted.add_all(pattern.slice(replace(&mut kept, end)..start));
            match FieldType::of(first, token.len()) {
                Some(found) if fix_fractional_seconds && found.field == Field::Second => {
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
                && requested != b'c'
                && (matched.skeleton.lengths.at(field) == requested_length
                    || (found.kind > 0) != (request.skeleton.kinds.at(field) > 0)));
        let length = if keeps_length {
            found_length
        } else {
            to_length(i32::from(requested_length))
        };
        let preferred = self.preferred_hour;
        let letter = match found.field {
            Field::Hour
                if is_12_hour_letter(requested) && is_12_hour_letter(preferred)
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
        let best = self.patterns.best_match(&request.skeleton, wanted)?;
        let mut missing = wanted & !best.skeleton.fields;
        let mut result = self.adjust_field_types(&best.pattern, request, best, false)?;
        if missing & BOTH == FRACTIONAL_SECOND && wanted & BOTH == BOTH {
            result = self.adjust_field_types(&result, request, best, true)?;
            missing &= !FRACTIONAL_SECOND;
        }
        if missing == 0 {
            return Ok(result);
        }
        let best = self.patterns.best_match(&request.skeleton, missing)?;
        let top_field = (best.skeleton.fields | 1).ilog2() as usize;
        let (format, [name, ..]) = self
            .append_item_formats
            .iter()
            .zip(&self.field_display_names)
            .nth(top_field)
            .ok_or(U_INTERNAL_PROGRAM_ERROR)?;
        let format = if format.is_empty() {
            &DEFAULT_APPEND_ITEM_FORMAT
        } else {
            format.as_slice()
        };
        let item = self.adjust_field_types(&best.pattern, request, best, false)?;
        let name = if name.is_empty() {
            &FRACTIONAL_SECOND_NAME
        } else {
            name.as_slice()
        };
        let name = try_concat(&[&[QUOTE], name, &[QUOTE]])?;
        join(format, &[&result, &item, &name])
    }
}

fn field_of_append_item(key: &[u8]) -> Option<Field> {
    Some(match key {
        b"Era" => Field::Era,
        b"Year" => Field::Year,
        b"Month" => Field::Month,
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
        b"weekday" => Field::Weekday,
        b"day" => Field::Day,
        b"dayperiod" => Field::DayPeriod,
        b"hour" => Field::Hour,
        b"minute" => Field::Minute,
        b"second" => Field::Second,
        b"zone" => Field::Zone,
        _ => return None,
    })
}

/// "{0} ├{2}: {1}┤"
const DEFAULT_APPEND_ITEM_FORMAT: [u16; 14] = [
    0x7b, 0x30, 0x7d, 0x20, 0x251c, 0x7b, 0x32, 0x7d, 0x3a, 0x20, 0x7b, 0x31, 0x7d, 0x2524,
];

/// The one field of a request that has no name in the data.
const FRACTIONAL_SECOND_NAME: [u16; 3] = from_latin1(b"F14");

/// More than the `availableFormats` of a CLDR locale and its parents.
const USUAL_FORMAT_COUNT: usize = 100;

fn set_if_empty(target: &mut Vec<u16>, value: &ResourceValue) -> Result<(), UErrorCode> {
    if target.is_empty() {
        *target = value.get_string()?.try_to_vec()?;
    }
    Ok(())
}

/// Returns the key in the table `calendar` for the keyword of `locale`, or for the default of its bundle.
pub(crate) fn calendar_type_in_data(locale: &Locale) -> Result<Vec<u8>, UErrorCode> {
    ures_get_calendar_type(locale.get_name())
}

// ICU4C: dtptngen.cpp, DateTimePatternGenerator::getAllowedHourFormats
fn preferred_hour(locale: &Locale) -> Result<u8, UErrorCode> {
    static TIME_DATA: Part = OnceBox::new();
    // The keys are regions, or languages with regions.
    let time_data = cached_part(&TIME_DATA, b"supplementalData", &[b"timeData"])?
        .get_value()
        .get_table()?;
    let region = ulocimp_get_region_for_supplemental_data(locale.get_name(), false)?;
    let (mut language, mut country) = (locale.get_language(), &*region);
    let mut max_locale;
    if language.is_empty() || country.is_empty() {
        max_locale = locale.clone();
        if max_locale.add_likely_subtags().is_ok() {
            (language, country) = (max_locale.get_language(), max_locale.get_country());
        }
    }
    if country.is_empty() {
        country = b"001";
    }
    let find = |country: &[u8]| {
        try_concat(&[language, b"_", country])
            .map(|both| time_data.get(&both).or_else(|| time_data.get(country)))
    };
    let found = match find(country)? {
        None => find_replacement(b"territory", country).map_or(Ok(None), |region| find(&region))?,
        found => found,
    };
    match (&*locale.get_keyword_value(b"hours")?, found) {
        (b"h24", _) => Ok(b'k'),
        (b"h23", _) => Ok(b'H'),
        (b"h12", _) => Ok(b'h'),
        (b"h11", _) => Ok(b'K'),
        (hours, _) if hours.len() > 8 => Err(U_ILLEGAL_ARGUMENT_ERROR),
        (_, None) => Ok(b'H'),
        (_, Some(formats)) => {
            let preferred = formats.get_table()?.get(b"preferred");
            let preferred = preferred.ok_or(U_MISSING_RESOURCE_ERROR)?.get_string()?;
            b"hHKk"
                .iter()
                .copied()
                .find(|&letter| preferred.eq_bytes(&[letter]))
                .ok_or(U_INVALID_FORMAT_ERROR)
        }
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
        Ok(Box::write(
            try_box_uninit()?,
            Fields {
                patterns: PatternMap {
                    lists: [const { Vec::new() }; 58],
                },
                append_item_formats: Default::default(),
                field_display_names: Default::default(),
                date_time_formats: Default::default(),
                decimal: Vec::new(),
                preferred_hour: b'H',
            },
        ))
    }

    fn new(locale: &Locale, adds_style_patterns: bool) -> Result<Self, UErrorCode> {
        if locale.is_bogus() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let mut fields = Self::new_empty()?;
        for &item in CANONICAL_ITEMS {
            let item = [u16::from(item)];
            fields
                .patterns
                .add(&Skeleton::parse(&item)?, try_to_vec(&item)?, false)?;
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
        fields.preferred_hour = preferred_hour(locale)?;
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
        for i in 0..8 {
            // Index 0 of a string is the string itself.
            let pattern = ures_get_unicode_string_by_index(&patterns.get_by_index(i)?, 0)?;
            let skeleton = Skeleton::parse(&pattern)?;
            if self
                .patterns
                .find(&skeleton, MatchKind::BaseLengths)
                .is_none()
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
            // No request has the quarters and weeks of "yQQQ", "yw" and "MMMMW".
            let Ok(skeleton) = Skeleton::parse(&format_key) else {
                return Ok(());
            };
            if self
                .patterns
                .find(&skeleton, MatchKind::Lengths)
                .is_some_and(|entry| entry.skeleton_was_specified)
            {
                return Ok(());
            }
            self.patterns
                .add(&skeleton, value.get_string()?.try_to_vec()?, true)
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
            .and_then(|field| self.field_display_names.get_mut(field as usize));
        let Some([wide, abbreviated, narrow]) = names else {
            return Ok(());
        };
        let target = match width {
            Some(b"short") => abbreviated,
            Some(b"narrow") => narrow,
            _ => wide,
        };
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
        let calendar_type = CalendarType::for_locale(locale)?;
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
