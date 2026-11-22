//! Time zones and their IDs. ICU4C: timezone.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::bytes::{I32s, U16s};
use crate::common::memory::{Appendable, try_extend, try_with_capacity};
use crate::common::putil::query_host_time_zone;
use crate::common::slice_ext::{SliceExt, slices_equal, to_index};
use crate::common::uchar::u_char_digit_value;
use crate::common::udata::bundle_may_be_replaced;
use crate::common::uenum::{Item, StringEnumeration};
use crate::common::uinvchar::{invariant_prefix, uchar_to_char};
use crate::common::umutex::OnceBox;
use crate::common::unistr::UStr;
use crate::common::unistr::from_invariant;
use crate::common::uresdata::DataString;
use crate::common::uresimp::*;
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;
use crate::i18n::gregoimp::{U_MILLIS_PER_SECOND, UDate, grego};
use crate::i18n::olsontz::OlsonTimeZone;
use crate::i18n::tzrule::{TimeZoneRule, TimeZoneTransition};
use crate::i18n::zonemeta;
use std::borrow::Cow;
use std::cmp::Ordering;

const ZONEINFO: &[u8] = b"zoneinfo64";

const PLUS: u16 = b'+' as u16;
const MINUS: u16 = b'-' as u16;
const COLON: u16 = b':' as u16;

pub(crate) const UNKNOWN_ZONE_ID: [u16; 11] = from_latin1(b"Etc/Unknown");

pub(crate) const ZID_KEY_MAX: usize = 128;

pub(crate) enum ZoneId {
    Static(&'static [u16]),
    Inline([u16; ZoneId::INLINE_CAPACITY], u8),
    Heap(Vec<u16>),
}

impl ZoneId {
    /// The length of the longest ID of the tz database.
    const INLINE_CAPACITY: usize = 32;

    pub(crate) fn from_data(id: U16s) -> Result<Self, UErrorCode> {
        let mut units = [0; Self::INLINE_CAPACITY];
        let Some(used) = units.get_mut(..id.len()) else {
            return id.try_to_vec().map(Self::Heap);
        };
        id.copy_to(0, used);
        Ok(Self::Inline(units, id.len() as u8))
    }
}

impl std::ops::Deref for ZoneId {
    type Target = [u16];

    fn deref(&self) -> &[u16] {
        match self {
            Self::Static(units) => units,
            Self::Inline(units, length) => units.slice(..usize::from(*length)),
            Self::Heap(units) => units,
        }
    }
}

/// Whether a wall time that a transition skips or repeats gets the offsets after the transition.
#[derive(Clone, Copy)]
pub(crate) struct LocalOptions {
    pub(crate) skipped_is_latter: bool,
    pub(crate) repeated_is_latter: bool,
}

impl LocalOptions {
    pub(crate) const DEFAULT: Self = Self {
        skipped_is_latter: false,
        repeated_is_latter: true,
    };

    pub(crate) fn picks_latter(self, is_skipped: bool) -> bool {
        if is_skipped {
            self.skipped_is_latter
        } else {
            self.repeated_is_latter
        }
    }
}

pub(crate) enum TimeZone {
    Fixed { id: ZoneId, raw_offset: i32 },
    Olson(OlsonTimeZone),
}

use TimeZone::{Fixed, Olson};

impl TimeZone {
    /// Returns the raw offset and the DST savings at `date`, which is a wall time if `local`, else UTC.
    pub(crate) fn get_offset(&self, date: UDate, local: bool) -> Result<TimeZoneRule, UErrorCode> {
        match self {
            Fixed { raw_offset, .. } => {
                let shift = if local { 0 } else { *raw_offset };
                grego::time_to_day(date + f64::from(shift))
                    .map(|_| TimeZoneRule::standard_time(*raw_offset))
            }
            Olson(zone) => zone.get_offset(date, local),
        }
    }

    pub(crate) fn get_offset_from_local(
        &self,
        date: UDate,
        options: LocalOptions,
    ) -> Result<TimeZoneRule, UErrorCode> {
        match self {
            Fixed { raw_offset, .. } => {
                grego::time_to_day(date).map(|_| TimeZoneRule::standard_time(*raw_offset))
            }
            Olson(zone) => zone.get_offset_from_local(date, options),
        }
    }

    /// Returns the offset of standard time, or of daylight time if the zone observes it in the current year.
    pub(crate) fn current_offset(&self, is_daylight: bool) -> i32 {
        match self {
            Fixed { raw_offset, .. } => *raw_offset,
            Olson(zone) if is_daylight => zone
                .get_raw_offset()
                .wrapping_add(zone.current_dst_savings()),
            Olson(zone) => zone.get_raw_offset(),
        }
    }

    pub(crate) fn get_next_transition(&self, base: UDate) -> Option<TimeZoneTransition> {
        match self {
            Fixed { .. } => None,
            Olson(zone) => zone.get_next_transition(base),
        }
    }

    /// Returns the last transition before `base`, or at `base` if `inclusive`.
    pub(crate) fn get_previous_transition(
        &self,
        base: UDate,
        inclusive: bool,
    ) -> Option<TimeZoneTransition> {
        match self {
            Fixed { .. } => None,
            Olson(zone) => zone.get_previous_transition(base, inclusive),
        }
    }
}

/// Returns whether a string of the data equals `other`.
pub(crate) fn is_same(one: U16s, other: &[u16]) -> bool {
    one.iter().eq(other.iter().copied())
}

/// A resource key without its NUL.
pub(crate) type Key = ArrayVec<u8, { ZID_KEY_MAX + 1 }>;

/// Ends at the first unit that is not invariant.
pub(crate) fn invariant_c_string(s: impl IntoIterator<Item = u16>) -> Key {
    Key::from_iter_truncated(invariant_prefix(s))
}

/// Converts an ID to a resource key by replacing '/' with ':' from the index `first` on.
pub(crate) fn zone_key(id: impl IntoIterator<Item = u16>, first: usize) -> Key {
    let mut key = invariant_c_string(id);
    key.iter_mut()
        .skip(first)
        .filter(|byte| **byte == b'/')
        .for_each(|byte| *byte = b':');
    key
}

pub(crate) type Part = OnceBox<UResourceBundle>;

/// Returns the item at the path `keys` in `bundle`, and caches it in `cell`. A failure is not cached.
pub(crate) fn cached_part(
    cell: &'static Part,
    bundle: &[u8],
    keys: &[&[u8]],
) -> Result<&'static UResourceBundle, UErrorCode> {
    cell.get_or_try_init(|| {
        let top = ures_open_direct(None, bundle)?;
        keys.iter().try_fold(top, |item, key| item.get_by_key(key))
    })
}

fn names() -> Result<&'static UResourceBundle, UErrorCode> {
    static NAMES: Part = OnceBox::new();
    cached_part(&NAMES, ZONEINFO, &[b"Names"])
}

fn zones() -> Result<&'static UResourceBundle, UErrorCode> {
    static ZONES: Part = OnceBox::new();
    cached_part(&ZONES, ZONEINFO, &[b"Zones"])
}

/// An item that is not a string counts as empty.
fn name_at(index: usize) -> Result<DataString, UErrorCode> {
    Ok((names()?.get_data_string_by_index(index)?).unwrap_or(DataString::EMPTY))
}

fn region_at(index: usize) -> Result<U16s<'static>, UErrorCode> {
    static REGIONS: Part = OnceBox::new();
    let regions = cached_part(&REGIONS, ZONEINFO, &[b"Regions"])?;
    ures_get_string_by_index(regions, index)?.ok_or(U_RESOURCE_TYPE_MISMATCH)
}

/// Returns the index of `id` in Names, and the item. ICU4C: timezone.cpp, findInStringArray
fn find_name(id: &[u16]) -> Result<(usize, U16s<'static>), UErrorCode> {
    let names = names()?;
    let array = names.get_value().get_array().ok();
    let (mut start, mut limit, mut last) = (0, names.get_size(), usize::MAX);
    while last != (start + limit) / 2 {
        last = (start + limit) / 2;
        // Fast path: a string in an array.
        let name = match array.and_then(|array| array.get(last)?.get_string().ok()) {
            Some(name) => name,
            None => name_at(last)?.units(),
        };
        match id.iter().copied().cmp(name.iter()) {
            Ordering::Equal => return Ok((last, name)),
            Ordering::Less => limit = last,
            Ordering::Greater => start = last,
        }
    }
    Err(U_MISSING_RESOURCE_ERROR)
}

/// Reads the table of the zone, or of the target if the zone is a link.
fn create_system_time_zone(id: &[u16]) -> Result<OlsonTimeZone, UErrorCode> {
    let (index, zones) = (find_name(id)?.0, zones()?);
    let mut zone = zones.get_by_index(index)?;
    if let Ok(link) = zone.get_int() {
        zone = zones.get_by_index(to_index(link))?;
    }
    OlsonTimeZone::new(&zone, id, index)
}

impl TimeZone {
    pub(crate) fn unknown() -> Self {
        Fixed {
            id: ZoneId::Static(&UNKNOWN_ZONE_ID),
            raw_offset: 0,
        }
    }

    pub(crate) fn load_rule(rule_id: U16s) -> Result<I32s<'static>, UErrorCode> {
        static RULES: Part = OnceBox::new();
        let key = invariant_c_string(rule_id.iter().take(63));
        let rules = cached_part(&RULES, ZONEINFO, &[b"Rules"])?;
        rules.get_value_by_key(&key)?.get_int_vector()
    }

    /// Returns a system zone ("America/Los_Angeles"), a custom zone ("GMT-8:00"), or else the unknown zone.
    pub(crate) fn create_time_zone(id: &[u16]) -> Self {
        let custom = |(is_negative, seconds): (bool, i32)| Fixed {
            id: custom_id(is_negative, seconds),
            raw_offset: if is_negative { -seconds } else { seconds } * U_MILLIS_PER_SECOND,
        };
        create_system_time_zone(id).map_or_else(
            |_| parse_custom_id(id).map_or_else(Self::unknown, custom),
            Olson,
        )
    }

    pub(crate) fn append_id(&self, text: &mut Vec<u16>) {
        match self {
            Fixed { id, .. } => text.add_all(id),
            Olson(zone) => {
                let name = name_at(zone.index).map(DataString::units);
                text.add_each(name.unwrap_or_default().iter());
            }
        }
    }
}

#[inline(always)]
pub(crate) fn host_time_zone_id() -> Result<Vec<u16>, UErrorCode> {
    let id = query_host_time_zone()?;
    Ok(from_invariant(if id.is_empty() {
        b"Etc/Unknown"
    } else {
        &id
    }))
}

/// Returns the canonical ID of the host's zone at the first call, whose names are loaded first if data can come from files.
pub(crate) fn preloaded_zone_id() -> Result<Option<&'static [u16]>, UErrorCode> {
    static HOST_ID: OnceBox<Vec<u16>> = OnceBox::new();
    if !bundle_may_be_replaced(ZONEINFO)? {
        return Ok(None);
    }
    let id = HOST_ID.get_or_try_init(host_time_zone_id)?;
    Ok(zonemeta::get_canonical_cldr_id(id).ok())
}

pub(crate) struct TZEnumeration {
    /// Indexes into Names.
    map: Cow<'static, [u32]>,
    pos: usize,
}

impl StringEnumeration for TZEnumeration {
    fn count(&self) -> Result<usize, UErrorCode> {
        Ok(self.map.len())
    }

    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode> {
        let Some(&index) = self.map.get(self.pos) else {
            return Ok(None);
        };
        self.pos += 1;
        name_at(index as usize).map(|name| Some(Item::Resource(name)))
    }
}

type Indexes = OnceBox<Result<Vec<u32>, UErrorCode>>;

impl TZEnumeration {
    fn cached(
        cell: &'static Indexes,
        filter: &dyn Fn(&[u16]) -> Result<bool, UErrorCode>,
    ) -> Result<Self, UErrorCode> {
        let map = cell.get_or_init_caching_err(|| {
            let size = names()?.get_size();
            let (mut map, mut id) = (try_with_capacity(size)?, Vec::new());
            for index in 0..size {
                id.clear();
                try_extend(&mut id, name_at(index)?.units().iter())?;
                if id != UNKNOWN_ZONE_ID && filter(&id)? {
                    map.add(index as u32);
                }
            }
            Ok(map)
        })?;
        Ok(Self {
            map: Cow::Borrowed(map),
            pos: 0,
        })
    }

    pub(crate) fn all() -> Result<Self, UErrorCode> {
        static ALL: Indexes = OnceBox::new();
        Self::cached(&ALL, &|_| Ok(true))
    }

    pub(crate) fn canonical() -> Result<Self, UErrorCode> {
        static CANONICAL: Indexes = OnceBox::new();
        Self::cached(&CANONICAL, &|id| {
            Ok(slices_equal(zonemeta::get_canonical_cldr_id(id)?, id))
        })
    }

    pub(crate) fn in_region(self, region: &[u8]) -> Result<Self, UErrorCode> {
        // The linked names are sorted and unique, so a search for one finds its own index.
        let (searches, mut map) = (bundle_may_be_replaced(ZONEINFO)?, Vec::new());
        for &index in &*self.map {
            let found = if searches {
                TimeZone::get_region(&name_at(index as usize)?.units().try_to_vec()?)?
            } else {
                region_at(index as usize)?
            };
            if found.len() > 4 {
                return Err(U_BUFFER_OVERFLOW_ERROR);
            }
            if invariant_c_string(found.iter()).eq_ignore_ascii_case(region) {
                map.add(index);
            }
        }
        Ok(Self {
            map: Cow::Owned(map),
            pos: 0,
        })
    }
}

impl TimeZone {
    /// Returns the entry of Names that equals `id`.
    pub(crate) fn find_id(id: &[u16]) -> Option<U16s<'static>> {
        find_name(id).ok().map(|(_, name)| name)
    }

    /// Returns the entry of Names for the zone, or for the target if the zone is a link.
    pub(crate) fn derefer_olson_link(id: &[u16]) -> Option<U16s<'static>> {
        let (index, name) = find_name(id).ok()?;
        let target = || name_at(to_index(zones()?.get_by_index(index)?.get_int()?));
        Some(target().map_or(name, DataString::units))
    }

    pub(crate) fn get_region(id: &[u16]) -> Result<U16s<'static>, UErrorCode> {
        region_at(find_name(id)?.0)
    }
}

/// Returns "GMT", "GMT+hh:mm" or "GMT+hh:mm:ss". `seconds` is less than a day.
fn custom_id(is_negative: bool, seconds: i32) -> ZoneId {
    let digits = |value: i32| [value / 10, value % 10].map(|digit| b'0' + digit as u8);
    let ([h1, h2], [m1, m2], [s1, s2]) = (
        digits(seconds / 3600),
        digits(seconds / 60 % 60),
        digits(seconds % 60),
    );
    let sign = if is_negative { b'-' } else { b'+' };
    let length = match (seconds, seconds % 60) {
        (0, _) => 3,
        (_, 0) => 9,
        _ => 12,
    };
    let mut units = [0; _];
    units.copy_at(
        0,
        &[b'G', b'M', b'T', sign, h1, h2, b':', m1, m2, b':', s1, s2].map(u16::from),
    );
    ZoneId::Inline(units, length)
}

/// Parses a decimal number. Returns `None` and leaves `pos` unchanged if there is no digit or on overflow.
fn parse_number(text: &[u16], pos: &mut usize) -> Option<i32> {
    let mut n = 0i32;
    let mut p = *pos;
    // Advances by code units.
    while p < text.len()
        && let d @ 0.. = u_char_digit_value(text.char32_at(p))
    {
        n = n.checked_mul(10)?.checked_add(d)?;
        p += 1;
    }
    if p == *pos {
        return None;
    }
    *pos = p;
    Some(n)
}

/// Parses "GMT[+-]H[H][[:]mm[[:]ss]]". Returns whether the sign is '-', and the offset in seconds.
fn parse_custom_id(id: &[u16]) -> Option<(bool, i32)> {
    let [g, m, t, sign @ (PLUS | MINUS), ..] = *id else {
        return None;
    };
    if [g, m, t].map(|unit| unit | 0x20) != b"gmt".map(u16::from) {
        return None;
    }
    let mut pos = 4;
    let number = parse_number(id, &mut pos)?;
    let (is_at_end, length) = (pos == id.len(), pos - 4);
    let mut field = || {
        let start = pos + 1;
        id.get(pos).filter(|&&unit| unit == COLON)?;
        pos = start;
        let value = parse_number(id, &mut pos)?;
        (pos - start == 2).then_some((value, pos == id.len()))
    };
    let (hour, min, sec) = match (is_at_end, length) {
        (true, 1 | 2) => (number, 0, 0),
        (true, 3 | 4) => (number / 100, number % 100, 0),
        (true, 5 | 6) => (number / 10000, number / 100 % 100, number % 100),
        (false, 1 | 2) => match field()? {
            (min, true) => (number, min, 0),
            (min, false) => (number, min, field().filter(|&(_, is_last)| is_last)?.0),
        },
        _ => return None,
    };
    (hour <= 23 && min <= 59 && sec <= 59).then(|| (sign == MINUS, (hour * 60 + min) * 60 + sec))
}

impl TimeZone {
    /// The last byte is NUL.
    pub(crate) fn get_tz_data_version() -> Result<&'static [u8; 16], UErrorCode> {
        static VERSION: OnceBox<Result<[u8; 16], UErrorCode>> = OnceBox::new();
        VERSION.get_or_init_caching_err(|| {
            let bundle = ures_open_direct(None, ZONEINFO)?;
            let version = bundle.get_string_by_key(b"TZVersion")?;
            let mut bytes = [0; _];
            bytes
                .iter_mut()
                .zip(version.iter().take(15))
                .for_each(|(byte, unit)| *byte = uchar_to_char(unit));
            Ok(bytes)
        })
    }

    /// Returns the canonical system ID or the normalized custom ID.
    #[inline]
    pub(crate) fn get_canonical_id(id: &[u16]) -> Result<ZoneId, UErrorCode> {
        if id == UNKNOWN_ZONE_ID {
            return Ok(ZoneId::Static(&UNKNOWN_ZONE_ID));
        }
        if let Ok(canonical) = zonemeta::get_canonical_cldr_id(id) {
            return Ok(ZoneId::Static(canonical));
        }
        let (is_negative, seconds) = parse_custom_id(id).ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        Ok(custom_id(is_negative, seconds))
    }

    pub(crate) fn get_iana_id(id: &[u16]) -> Result<ZoneId, UErrorCode> {
        if id == UNKNOWN_ZONE_ID {
            Err(U_ILLEGAL_ARGUMENT_ERROR)
        } else {
            zonemeta::get_iana_id(id)
        }
    }
}
