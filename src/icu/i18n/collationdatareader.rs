//! Reads binary collation data. ICU4C: collationdatareader.h

use crate::common::bytes::{I32s, U_IS_BIG_ENDIAN, U16s, U32s, U64s};
use crate::common::linked;
use crate::common::memory::{try_box, try_filled, try_make_mut, try_shared_result};
use crate::common::slice_ext::{to_index, to_length};
use crate::common::udata::{self, UDataInfo};
use crate::common::uniset::UnicodeSet;
use crate::common::uresdata::DataString;
use crate::common::uresimp::U_ICUDATA_COLL;
use crate::common::utypes::*;
use crate::i18n::collation;
use crate::i18n::collationdata::{self, CollationData, UnsafeSet};
use crate::i18n::collationfastlatin;
use crate::i18n::collationsettings::CollationSettings;
use crate::i18n::collationtrie::{self, BmpIndex, CollationTrie};
use crate::i18n::collunsafe::UNSAFE_SERIALIZED_DATA;
use crate::i18n::unicode::ucol::UCOL_REORDER_CODE_FIRST;
use bun_core::slice_as_bytes;
use bun_icu_format::collation::{
    DATA_FORMAT as PACKED_FORMAT, MAX_TRIES, Mappings, Root, Tailoring,
};
use std::sync::atomic::AtomicU16;
use std::sync::{Arc, OnceLock};

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

    fn options(&self) -> u32 {
        self.index(IX_OPTIONS) as u32
    }
}

fn numeric_primary(options: u32) -> u32 {
    options & 0xff00_0000
}

fn has_fast_latin_table(options: u32) -> bool {
    (options >> 16) & 0xff == u32::from(collationfastlatin::VERSION)
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
    check(numeric_primary(image.options()) == base.data.numeric_primary)?;

    let data = match image.part(TRIE)? {
        Some(trie) => read_data(
            CollationData::for_tailoring(&base.data, open(trie)?),
            &image,
        )?,
        None => Arc::clone(&base.data),
    };

    let options = image.index(IX_OPTIONS) & 0xffff;
    let reorder_codes = I32s::of(codes_and_ranges).slice(0..codes_length);
    tailor(base, data, options, reorder_codes, &|settings| {
        if let Some(table) = reorder_table {
            let ranges = U32s::of(codes_and_ranges).slice(codes_length..);
            settings.set_reorder_arrays(codes_length, ranges.try_to_vec()?, table);
        }
        Ok(())
    })
}

fn tailor(
    base: &CollationTailoring,
    data: Arc<CollationData>,
    options: i32,
    reorder_codes: I32s<'static>,
    reorder: &dyn Fn(&mut CollationSettings) -> Result<(), UErrorCode>,
) -> Result<CollationTailoring, UErrorCode> {
    let mut settings = Arc::clone(&base.settings);
    // The base settings have no reordering.
    if options != settings.options
        || !reorder_codes.is_empty()
        || !collationfastlatin::options_are_current(&data, &settings)
    {
        let settings = try_make_mut(&mut settings)?;
        set_options(settings, options, &data)?;
        reorder(settings)?;
        collationfastlatin::set_options(&data, settings);
    }
    Ok(CollationTailoring {
        data,
        settings,
        reorder_codes,
        ..*base
    })
}

fn linked_root() -> Result<(UDataInfo, Root<'static>), UErrorCode> {
    let item = linked::file(b"coll/ucadata.icu").and_then(UDataInfo::split_item);
    let (info, bytes) = item.ok_or(U_MISSING_RESOURCE_ERROR)?;
    Ok((info, Root::new(bytes)))
}

/// `bytes` is in the linked package.
pub(crate) fn read_packed_tailoring(
    base: &'static CollationTailoring,
    bytes: &'static [u8],
) -> Result<CollationTailoring, UErrorCode> {
    let (info, root) = linked_root()?;
    if base.uca_version != uca_version(&info) {
        return Err(U_COLLATOR_VERSION_MISMATCH);
    }
    check(numeric_primary(root.options) == base.data.numeric_primary)?;
    let tailoring = Tailoring::new(bytes, &root);
    let data = match tailoring.mappings {
        Some(mappings) => read_mappings(&base.data, &mappings, &root, tailoring.options)?,
        None => Arc::clone(&base.data),
    };
    let (options, codes) = (
        tailoring.options & 0xffff,
        I32s::of(tailoring.reorder_codes),
    );
    tailor(base, data, options as i32, codes, &|settings| {
        if codes.is_empty() {
            return Ok(());
        }
        settings.set_reordering(&base.data, &codes.try_to_vec()?)
    })
}

struct Expanded {
    index: BmpIndex,
    fast_latin_table: Vec<[u8; 2]>,
}

fn expand(mappings: &Mappings, root: &Root) -> Result<&'static Expanded, UErrorCode> {
    static EXPANDED: [OnceLock<Box<Expanded>>; MAX_TRIES] = [const { OnceLock::new() }; _];
    let cell = EXPANDED
        .get(mappings.number)
        .ok_or(U_INVALID_FORMAT_ERROR)?;
    if let Some(expanded) = cell.get() {
        return Ok(expanded);
    }
    let mut new = try_box(Expanded {
        index: [const { AtomicU16::new(0) }; _],
        fast_latin_table: try_filled([0; 2], mappings.fast_latin_units())?,
    })?;
    Ok(cell.get_or_init(|| {
        collationtrie::expand(mappings, root, &mut new.index);
        if !new.fast_latin_table.is_empty() {
            mappings.expand_fast_latin(root, &mut new.fast_latin_table);
        }
        new
    }))
}

/// The fast Latin table of the result is empty if it is that of the root.
fn open_packed(
    base: Option<&'static CollationData>,
    mappings: &Mappings<'static>,
    root: &Root<'static>,
) -> Result<CollationData, UErrorCode> {
    let expanded = expand(mappings, root)?;
    let trie = CollationTrie::open_packed(mappings, &expanded.index);
    let trie = trie.ok_or(U_INVALID_FORMAT_ERROR)?;
    let mut data = match base {
        Some(base) => CollationData::for_tailoring(base, trie),
        None => CollationData::new(trie),
    };
    (data.ces, data.ce32s) = (U64s::of(root.pool), U32s::of(root.pool));
    data.contexts = U16s::of(root.pool);
    if mappings.jamo != 0 {
        data.jamo_ce32s = data.ce32s.slice(mappings.jamo..);
    }
    data.fast_latin_table = U16s::from_chunks(&expanded.fast_latin_table);
    Ok(data)
}

fn read_mappings(
    base: &'static CollationData,
    mappings: &Mappings<'static>,
    root: &Root<'static>,
    options: u32,
) -> Result<Arc<CollationData>, UErrorCode> {
    let mut data = open_packed(Some(base), mappings, root)?;
    if !mappings.unsafe_backward.is_empty() {
        let own = U16s::of(mappings.unsafe_backward);
        data.unsafe_backward_set = unsafe_backward_set(data.base, own)?;
    }
    if has_fast_latin_table(options) && data.fast_latin_table.is_empty() {
        data.fast_latin_table = base.fast_latin_table;
    }
    try_shared_result(&mut Ok(data))
}

fn read_packed_root(root: &Root<'static>) -> Result<Arc<CollationData>, UErrorCode> {
    let mut data = open_packed(None, &root.mappings(), root)?;
    data.numeric_primary = numeric_primary(root.options);
    data.unsafe_backward_set = unsafe_backward_set(None, U16s::EMPTY)?;
    data.fast_latin_table = U16s::of(root.fast_latin);
    read_scripts(U16s::of(root.scripts), &mut data)?;
    try_shared_result(&mut Ok(data))
}

fn read_root(image: &Image) -> Result<Arc<CollationData>, UErrorCode> {
    let trie = image.part(TRIE)?.ok_or(U_INVALID_FORMAT_ERROR)?;
    check(image.index(IX_JAMO_CE32S_START) >= 0 && image.has(UNSAFE_BWD))?;
    let mut data = CollationData::new(open(trie)?);
    data.numeric_primary = numeric_primary(image.options());
    read_data(data, image)
}

pub(crate) fn load_root() -> Result<CollationTailoring, UErrorCode> {
    let item = udata::open_choice(Some(U_ICUDATA_COLL), b"icu", b"ucadata", |info| {
        is_acceptable(info) || info.data_format == PACKED_FORMAT
    })?;
    let (data, options) = if item.info.data_format == PACKED_FORMAT {
        let (_, root) = linked_root()?;
        (read_packed_root(&root)?, root.options)
    } else {
        let image = Image::new(item.memory)?;
        (read_root(&image)?, image.options())
    };
    let mut settings = CollationSettings::new();
    set_options(&mut settings, (options & 0xffff) as i32, &data)?;
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

fn open(trie: &'static [u8]) -> Result<CollationTrie, UErrorCode> {
    CollationTrie::open_from_serialized(trie).ok_or(U_INVALID_FORMAT_ERROR)
}

/// Overwrites the defaults in `data` with the parts that `image` has.
fn read_data(mut data: CollationData, image: &Image) -> Result<Arc<CollationData>, UErrorCode> {
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
    if has_fast_latin_table(image.options()) {
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
    let read = |units| UnicodeSet::from_serialized(units).ok_or(U_INVALID_FORMAT_ERROR);
    let mut set = match base {
        Some(base) => base.unsafe_backward_set.clone_as_thawed(),
        None => read(U16s::of(slice_as_bytes(&UNSAFE_SERIALIZED_DATA)))?,
    };
    if !own.is_empty() {
        set.add_all(&read(own)?);
    }
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
