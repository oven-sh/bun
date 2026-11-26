//! Reads binary collation data. ICU4C: collationdatareader.h

use crate::common::bytes::{I32s, U_IS_BIG_ENDIAN, U16s, U32s, U64s};
use crate::common::memory::{try_make_mut, try_shared_result};
use crate::common::slice_ext::{to_index, to_length};
use crate::common::udata::{self, UDataInfo};
use crate::common::uniset::UnicodeSet;
use crate::common::uresdata::DataString;
use crate::common::uresimp::U_ICUDATA_COLL;
use crate::common::utrie2::{UTrie2, UTrie2ValueBits};
use crate::common::utypes::*;
use crate::i18n::collation;
use crate::i18n::collationdata::{self, CollationData, UnsafeSet};
use crate::i18n::collationfastlatin;
use crate::i18n::collationsettings::CollationSettings;
use crate::i18n::collunsafe::UNSAFE_SERIALIZED_DATA;
use crate::i18n::unicode::ucol::UCOL_REORDER_CODE_FIRST;
use std::sync::Arc;

pub(crate) struct CollationTailoring {
    pub(crate) data: Arc<CollationData>,
    pub(crate) settings: Arc<CollationSettings>,
    pub(crate) rules: DataString,
    pub(crate) reorder_codes: I32s<'static>,
    uca_version: u16,
}

fn uca_version(info: &UDataInfo) -> u16 {
    let [_, v1, v2, _] = info.data_version;
    (u16::from(v1) << 4) | u16::from(v2 >> 6)
}

// The data starts with `int32_t` indexes.
const IX_INDEXES_LENGTH: usize = 0;
/// Bits 31..24: numeric primary; 23..16: version of the fast Latin table, 0 for none; 15..0: options.
const IX_OPTIONS: usize = 1;
/// Index of the Jamo CE32s in the CE32 array, or negative if there are none.
const IX_JAMO_CE32S_START: usize = 4;

/// The index of the byte offset of a part, which ends at the next offset, and the length below which it is absent.
type Part = (usize, i32);

const REORDER_CODES: Part = (5, 4);
const REORDER_TABLE: Part = (6, 256);
const TRIE: Part = (7, 8);
const CES: Part = (9, 8);
const CE32S: Part = (11, 4);
const CONTEXTS: Part = (13, 2);
const UNSAFE_BWD: Part = (14, 2);
const FAST_LATIN_TABLE: Part = (15, 2);
const SCRIPTS: Part = (16, 2);

fn check(is_valid: bool) -> Result<(), UErrorCode> {
    if is_valid {
        Ok(())
    } else {
        Err(U_INVALID_FORMAT_ERROR)
    }
}

/// The data after the header.
struct Image {
    bytes: &'static [u8],
    indexes: I32s<'static>,
}

impl Image {
    fn new(bytes: &'static [u8]) -> Result<Self, UErrorCode> {
        let count = I32s::of(bytes).get(IX_INDEXES_LENGTH).map_or(0, to_length);
        check(count > IX_OPTIONS)?;
        let indexes = I32s::from_offset(bytes, 0, count)?;
        Ok(Self { bytes, indexes })
    }

    fn index(&self, i: usize) -> i32 {
        self.indexes.get(i).unwrap_or(-1)
    }

    fn has(&self, (index, min_length): Part) -> bool {
        self.index(index + 1).wrapping_sub(self.index(index)) >= min_length
    }

    fn part(&self, part: Part) -> Result<Option<&'static [u8]>, UErrorCode> {
        if !self.has(part) {
            return Ok(None);
        }
        let (offset, limit) = (
            to_index(self.index(part.0)),
            to_index(self.index(part.0 + 1)),
        );
        self.bytes
            .get(offset..limit)
            .map(Some)
            .ok_or(U_INVALID_FORMAT_ERROR)
    }

    fn numeric_primary(&self) -> u32 {
        self.index(IX_OPTIONS) as u32 & 0xff00_0000
    }
}

/// `bytes` includes the header.
pub(crate) fn read_tailoring(
    base: &'static CollationTailoring,
    bytes: &'static [u8],
) -> Result<CollationTailoring, UErrorCode> {
    let header = UDataInfo::with_header_size(bytes).filter(|(info, _)| is_acceptable(info));
    let (info, header_size) = header.ok_or(U_INVALID_FORMAT_ERROR)?;
    if base.uca_version != uca_version(&info) {
        return Err(U_COLLATOR_VERSION_MISMATCH);
    }
    let image = Image::new(bytes.get(header_size..).ok_or(U_INVALID_FORMAT_ERROR)?)?;

    // The ranges follow the codes. The upper 16 bits of a range are its limit, which is never 0.
    let codes_and_ranges = image.part(REORDER_CODES)?.unwrap_or_default();
    let is_range = |entry: &&[u8; 4]| u32::from_ne_bytes(**entry) > 0xffff;
    let ranges_length = codes_and_ranges
        .as_chunks()
        .0
        .iter()
        .rev()
        .take_while(is_range)
        .count();
    let codes_length = codes_and_ranges.len() / 4 - ranges_length;
    let reorder_table = image.part(REORDER_TABLE)?.and_then(<[u8]>::first_chunk);
    check((codes_length != 0) == reorder_table.is_some())?;
    check(image.numeric_primary() == base.data.numeric_primary)?;

    let data = match image.part(TRIE)? {
        Some(trie) => read_data(CollationData::for_tailoring(&base.data), trie, &image)?,
        None => Arc::clone(&base.data),
    };

    let mut settings = Arc::clone(&base.settings);
    let options = image.index(IX_OPTIONS) & 0xffff;
    // The base settings have no reordering.
    if options != settings.options
        || reorder_table.is_some()
        || !collationfastlatin::options_are_current(&data, &settings)
    {
        let settings = try_make_mut(&mut settings)?;
        set_options(settings, options, &data)?;
        if let Some(table) = reorder_table {
            let ranges = U32s::of(codes_and_ranges).slice(codes_length..);
            settings.set_reorder_arrays(codes_length, ranges.try_to_vec()?, table);
        }
        collationfastlatin::set_options(&data, settings);
    }
    Ok(CollationTailoring {
        data,
        settings,
        reorder_codes: I32s::of(codes_and_ranges).slice(0..codes_length),
        ..*base
    })
}

pub(crate) fn load_root() -> Result<CollationTailoring, UErrorCode> {
    let item = udata::open_choice(Some(U_ICUDATA_COLL), b"icu", b"ucadata", is_acceptable)?;
    let image = Image::new(item.memory)?;
    let trie = image.part(TRIE)?.ok_or(U_INVALID_FORMAT_ERROR)?;
    check(image.index(IX_JAMO_CE32S_START) >= 0 && image.has(UNSAFE_BWD))?;
    let mut data = CollationData::empty();
    data.numeric_primary = image.numeric_primary();
    let data = read_data(data, trie, &image)?;
    let mut settings = CollationSettings::new();
    set_options(&mut settings, image.index(IX_OPTIONS) & 0xffff, &data)?;
    collationfastlatin::set_options(&data, &mut settings);
    Ok(CollationTailoring {
        data,
        settings: try_shared_result(&mut Ok(settings))?,
        rules: DataString::EMPTY,
        reorder_codes: I32s::EMPTY,
        uca_version: uca_version(&item.info),
    })
}

fn set_options(
    settings: &mut CollationSettings,
    options: i32,
    data: &CollationData,
) -> Result<(), UErrorCode> {
    settings.options = options;
    settings.variable_top =
        data.last_primary_for_group(UCOL_REORDER_CODE_FIRST + settings.max_variable());
    check(settings.variable_top != 0)
}

/// Overwrites the defaults in `data` with the parts that `image` has.
fn read_data(
    mut data: CollationData,
    trie: &'static [u8],
    image: &Image,
) -> Result<Arc<CollationData>, UErrorCode> {
    data.trie = UTrie2::open_from_serialized(UTrie2ValueBits::Bits32, trie)
        .ok_or(U_INVALID_FORMAT_ERROR)?;
    data.ces = U64s::of(image.part(CES)?.unwrap_or_default());
    data.ce32s = U32s::of(image.part(CE32S)?.unwrap_or_default());
    if let Ok(start) = usize::try_from(image.index(IX_JAMO_CE32S_START)) {
        check(start + collationdata::JAMO_CE32S_LENGTH <= data.ce32s.len())?;
        data.jamo_ce32s = data.ce32s.slice(start..);
    }
    data.contexts = U16s::of(image.part(CONTEXTS)?.unwrap_or_default());
    if let Some(bytes) = image.part(UNSAFE_BWD)? {
        data.unsafe_backward_set = unsafe_backward_set(data.base, U16s::of(bytes))?;
    }
    if (image.index(IX_OPTIONS) >> 16) & 0xff == i32::from(collationfastlatin::VERSION) {
        data.fast_latin_table = match image.part(FAST_LATIN_TABLE)? {
            Some(bytes) => fast_latin_table(U16s::of(bytes))?,
            None => data.base.map_or(U16s::EMPTY, |base| base.fast_latin_table),
        };
    }
    if let Some(bytes) = image.part(SCRIPTS)? {
        read_scripts(U16s::of(bytes), &mut data)?;
    }
    try_shared_result(&mut Ok(data))
}

fn unsafe_backward_set(base: Option<&CollationData>, own: U16s) -> Result<UnsafeSet, UErrorCode> {
    let mut set = match base {
        Some(base) => base.unsafe_backward_set.clone_as_thawed(),
        None => {
            let mut set = UnicodeSet::new();
            set.add_serialized(UNSAFE_SERIALIZED_DATA.iter().copied());
            set
        }
    };
    check(set.add_serialized(own.iter()).is_some())?;
    UnsafeSet::new(set)
}

fn fast_latin_table(table: U16s<'static>) -> Result<U16s<'static>, UErrorCode> {
    let header = table.at(0);
    check(
        header >> 8 == collationfastlatin::VERSION
            && table.len() >= usize::from(header & 0xff) + collationfastlatin::NUM_FAST_CHARS,
    )?;
    Ok(table)
}

fn read_scripts(scripts: U16s<'static>, data: &mut CollationData) -> Result<(), UErrorCode> {
    let num_scripts = scripts.at(0);
    let starts_begin = 1 + usize::from(num_scripts) + 16;
    let starts_length = scripts.len().saturating_sub(starts_begin);
    check((3..=collationdata::MAX_NUM_SCRIPT_RANGES).contains(&starts_length))?;
    data.num_scripts = num_scripts.into();
    data.scripts_index = scripts.slice(1..starts_begin);
    data.script_starts = scripts.slice(starts_begin..);
    check(
        data.script_starts.at(0) == 0
            && data.script_starts.at(1) == (u16::from(collation::MERGE_SEPARATOR_BYTE) + 1) << 8
            && data.script_starts.at(starts_length - 1)
                == u16::from(collation::TRAIL_WEIGHT_BYTE) << 8
            && data
                .scripts_index
                .iter()
                .all(|index| usize::from(index) + 1 < starts_length),
    )
}

fn is_acceptable(info: &UDataInfo) -> bool {
    info.size >= 20
        && info.is_big_endian == U_IS_BIG_ENDIAN
        && info.charset_family == 0
        && &info.data_format == b"UCol"
        && info.format_version.first() == Some(&5)
}
