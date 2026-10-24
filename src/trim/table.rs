use core::cmp::Reverse;
use std::borrow::Cow;

use bun_exe_format::builtins::Image;
use bun_exe_format::image::{AddressRange, KnownSection, SectionLocation};
use bun_exe_format::section::{SectionError, find_known_section};
use bun_removable_features::{
    FEATURES_HASH, Feature, FeatureSet, MAX_REMOVED_RANGES, RemovedRange,
};

use crate::error::{TrimError, TrimInternalError, UnsupportedReason};
use crate::model::{EdgeStrength, FeatureEdge, FeatureEdges};

pub use crate::model::{
    IcuItemRun, IcuLanguage, IcuPackage, LocaleGroup, ModuleText, RemovableRange, SetIndex,
    TrimTable,
};

pub const TABLE_MAGIC: [u8; 8] = *b"BUNTRIM\0";
pub const TABLE_VERSION: u32 = 4;
pub const TRIMMED_MAGIC: [u8; 8] = *b"BUNTRMD\0";
pub const REMOVED_RANGES_HEADER_BYTES: usize = 16;
pub const MAX_TABLE_BYTES: u64 = 16 << 20;

const MAX_FEATURE_SETS: usize = 1 << 16;
const LOCALE_GROUP_LIMIT: u32 = 65535;
const MAGIC_BYTES: usize = 8;
const MINIMUM_SECTION_BYTES: usize = 16;
const VERSION_OFFSET: usize = 8;
const BYTE_LENGTH_OFFSET: usize = 12;
const FEATURES_HASH_OFFSET: usize = 16;
const BASE_ADDRESS_OFFSET: usize = 24;
const DIRECTORY_OFFSET: usize = 32;
const DIRECTORY_ENTRY_BYTES: usize = 8;
const SECTION_ALIGNMENT: u64 = 4;

const FILL_ONLY: u8 = 0;
const CUT_OR_FILL: u8 = 1;
const CUT_ONLY: u8 = 2;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TableError {
    Empty,
    AlreadyTrimmed,
    UnsupportedVersion,
    FeatureListMismatch,
    Malformed(MalformedTable),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MalformedTable {
    Magic,
    Length,
    Directory,
    Edges,
    FeatureSets,
    Ranges,
    IcuPackages,
    IcuRuns,
    IcuLanguages,
    ModuleTexts,
    TrailingBytes,
}

pub struct EncodedRemovedRanges {
    pub bytes: Vec<u8>,
    pub count: u32,
    pub dropped: u32,
}

struct Context<'a> {
    sections: &'a Sections<'a>,
    base_address: u64,
    sets: &'a [FeatureSet],
    languages: &'a [IcuLanguage],
}

bun_removable_features::trim_table_decoders!();

struct Tiling<'a> {
    remaining: &'a [u8],
    record_bytes: usize,
    next_record: u64,
}

impl<'a> Tiling<'a> {
    fn new(records: &'a [u8], record_bytes: usize) -> Tiling<'a> {
        Tiling {
            remaining: records,
            record_bytes,
            next_record: 0,
        }
    }

    fn take(&mut self, first_record: u32, record_count: u32) -> Option<&'a [u8]> {
        if u64::from(first_record) != self.next_record {
            return None;
        }
        let tile_bytes =
            usize::try_from(u64::from(record_count) * self.record_bytes as u64).ok()?;
        let (tile, remaining) = self.remaining.split_at_checked(tile_bytes)?;
        self.remaining = remaining;
        self.next_record += u64::from(record_count);
        Some(tile)
    }

    fn is_complete(&self) -> bool {
        self.remaining.is_empty()
    }
}

fn read_array<const N: usize>(bytes: &[u8], offset: usize) -> [u8; N] {
    let mut array = [0; N];
    array.copy_from_slice(&bytes[offset..][..N]);
    array
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(read_array(bytes, offset))
}

pub(crate) fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(read_array(bytes, offset))
}

fn read_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(read_array(bytes, offset))
}

fn read_flag(value: u32) -> Option<bool> {
    (value <= 1).then_some(value == 1)
}

struct RemovalMethods {
    can_be_cut: bool,
    can_be_filled: bool,
}

fn read_removal_methods(value: u8) -> Option<RemovalMethods> {
    let (can_be_cut, can_be_filled) = match value {
        FILL_ONLY => (false, true),
        CUT_OR_FILL => (true, true),
        CUT_ONLY => (true, false),
        _ => return None,
    };
    Some(RemovalMethods {
        can_be_cut,
        can_be_filled,
    })
}

fn read_feature(index: u16, malformed: TableError) -> Result<Feature, TableError> {
    Feature::from_index(index).ok_or(malformed)
}

fn read_set_index(index: u16, set_count: usize) -> Option<SetIndex> {
    (usize::from(index) < set_count).then_some(SetIndex(index))
}

fn read_language_name(record: &[u8]) -> Option<[u8; 4]> {
    let name: [u8; 4] = read_array(record, 0);
    let [first, second, third, padding] = name;
    let is_valid = first.is_ascii_lowercase()
        && second.is_ascii_lowercase()
        && (third.is_ascii_lowercase() || third == 0)
        && padding == 0;
    is_valid.then_some(name)
}

fn read_address_range(
    base_address: u64,
    record: &[u8],
    previous: Option<AddressRange>,
) -> Option<AddressRange> {
    let size = read_u32(record, 4);
    if size == 0 {
        return None;
    }
    let start = base_address.checked_add(u64::from(read_u32(record, 0)))?;
    let end = start.checked_add(u64::from(size))?;
    if previous.is_some_and(|range| start < range.end) {
        return None;
    }
    Some(AddressRange { start, end })
}

fn check_header(section: &[u8]) -> Result<&[u8], TableError> {
    if section.len() < MINIMUM_SECTION_BYTES || section[..MAGIC_BYTES] == [0; MAGIC_BYTES] {
        return Err(TableError::Empty);
    }
    if section[..MAGIC_BYTES] == TRIMMED_MAGIC {
        return Err(TableError::AlreadyTrimmed);
    }
    if section[..MAGIC_BYTES] != TABLE_MAGIC {
        return Err(TableError::Malformed(MalformedTable::Magic));
    }
    if read_u32(section, VERSION_OFFSET) != TABLE_VERSION {
        return Err(TableError::UnsupportedVersion);
    }
    let byte_length = read_u32(section, BYTE_LENGTH_OFFSET) as usize;
    if byte_length < TABLE_HEADER_BYTES || byte_length > section.len() {
        return Err(TableError::Malformed(MalformedTable::Length));
    }
    let (table, trailing) = section.split_at(byte_length);
    if read_u64(table, FEATURES_HASH_OFFSET) != FEATURES_HASH {
        return Err(TableError::FeatureListMismatch);
    }
    if trailing.iter().any(|&byte| byte != 0) {
        return Err(TableError::Malformed(MalformedTable::TrailingBytes));
    }
    Ok(table)
}

struct Directory<'a> {
    table: &'a [u8],
    entries: core::slice::Iter<'a, [u8; DIRECTORY_ENTRY_BYTES]>,
    previous_end: u64,
}

impl<'a> Directory<'a> {
    fn new(table: &'a [u8]) -> Directory<'a> {
        Directory {
            table,
            entries: table[DIRECTORY_OFFSET..TABLE_HEADER_BYTES]
                .as_chunks()
                .0
                .iter(),
            previous_end: TABLE_HEADER_BYTES as u64,
        }
    }

    fn next_section(&mut self, record_bytes: usize) -> Result<&'a [u8], TableError> {
        const MALFORMED: TableError = TableError::Malformed(MalformedTable::Directory);
        let entry = self.entries.next().ok_or(MALFORMED)?;
        let offset = u64::from(read_u32(entry, 0));
        let end = offset + u64::from(read_u32(entry, 4)) * record_bytes as u64;
        if offset % SECTION_ALIGNMENT != 0
            || offset < self.previous_end
            || end > self.table.len() as u64
        {
            return Err(MALFORMED);
        }
        self.previous_end = end;
        Ok(&self.table[offset as usize..end as usize])
    }
}

impl FeatureEdge {
    fn may_follow(self, previous: Option<&FeatureEdge>, _: &Context<'_>) -> bool {
        self.from != self.to
            && previous.is_none_or(|previous| (previous.from, previous.to) < (self.from, self.to))
            && (self.is_followed || self.strength != EdgeStrength::Reference)
    }
}

impl IcuLanguage {
    fn may_follow(self, previous: Option<&IcuLanguage>, _: &Context<'_>) -> bool {
        previous.is_none_or(|previous| previous.name < self.name)
            && u32::from(self.group.0) < LOCALE_GROUP_LIMIT
    }
}

impl IcuItemRun {
    fn may_follow(&self, previous: Option<&IcuItemRun>, context: &Context<'_>) -> bool {
        let previous_end = previous.map_or(0, |run| {
            u64::from(run.first_item) + u64::from(run.item_count)
        });
        let is_known = |group| {
            context
                .languages
                .iter()
                .any(|language| language.group == group)
        };
        u64::from(self.first_item) >= previous_end
            && self.item_count != 0
            && self.locale_group.is_none_or(is_known)
    }
}

impl ModuleText {
    fn may_follow(&self, _: Option<&ModuleText>, context: &Context<'_>) -> bool {
        self.readers
            .is_none_or(|readers| are_some_of_set(readers, self.set, context.sets))
    }
}

fn parse_set_members(members: &[u8]) -> Result<FeatureSet, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::FeatureSets);
    let mut set = FeatureSet::EMPTY;
    let mut previous: Option<u16> = None;
    for record in members.as_chunks::<SET_MEMBER_RECORD_BYTES>().0 {
        let index = read_u16(record, 0);
        if previous.is_some_and(|previous| previous >= index) {
            return Err(MALFORMED);
        }
        set.insert(read_feature(index, MALFORMED)?);
        previous = Some(index);
    }
    Ok(set)
}

fn parse_feature_sets(sections: &Sections<'_>) -> Result<Vec<FeatureSet>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::FeatureSets);
    let set_count = sections.feature_sets.len() / FEATURE_SET_RECORD_BYTES;
    if set_count > MAX_FEATURE_SETS {
        return Err(MALFORMED);
    }
    let mut members = Tiling::new(sections.set_members, SET_MEMBER_RECORD_BYTES);
    let mut member_lists: Vec<&[u8]> = Vec::with_capacity(set_count);
    let mut sets = Vec::with_capacity(set_count);
    for record in sections
        .feature_sets
        .as_chunks::<FEATURE_SET_RECORD_BYTES>()
        .0
    {
        let member_list = members
            .take(read_u32(record, 0), read_u32(record, 4))
            .ok_or(MALFORMED)?;
        if member_list.is_empty() {
            return Err(MALFORMED);
        }
        sets.push(parse_set_members(member_list)?);
        member_lists.push(member_list);
    }
    member_lists.sort_unstable();
    let are_sets_distinct = member_lists.is_sorted_by(|left, right| left < right);
    if !members.is_complete() || !are_sets_distinct {
        return Err(MALFORMED);
    }
    Ok(sets)
}

fn are_some_of_set(readers: SetIndex, set: SetIndex, sets: &[FeatureSet]) -> bool {
    readers != set && sets[usize::from(readers.0)].is_subset_of(&sets[usize::from(set.0)])
}

fn have_distinct_modules(texts: &[ModuleText]) -> bool {
    let mut modules: Vec<u16> = texts.iter().map(|text| text.module).collect();
    modules.sort_unstable();
    modules.is_sorted_by(|left, right| left < right)
}

pub fn parse_trim_table(section: &[u8]) -> Result<TrimTable, TableError> {
    let table = check_header(section)?;
    let sections = parse_sections(table)?;
    let sets = parse_feature_sets(&sections)?;
    let without_languages = Context {
        sections: &sections,
        base_address: read_u64(table, BASE_ADDRESS_OFFSET),
        sets: &sets,
        languages: &[],
    };
    let icu_languages = parse_icu_languages(sections.icu_languages, &without_languages)?;
    let context = Context {
        languages: &icu_languages,
        ..without_languages
    };
    let edges = FeatureEdges::new(parse_edges(sections.edges, &context)?);
    let ranges = parse_ranges(sections.ranges, &context)?;
    let icu_packages = parse_icu_packages(sections.icu_packages, &context)?;
    let module_texts = parse_module_texts(sections.module_texts, &context)?;
    if !have_distinct_modules(&module_texts) {
        return Err(TableError::Malformed(MalformedTable::ModuleTexts));
    }
    Ok(TrimTable {
        features_hash: read_u64(table, FEATURES_HASH_OFFSET),
        base_address: context.base_address,
        edges,
        sets,
        ranges,
        icu_packages,
        icu_languages,
        module_texts,
    })
}

fn convert_section_error(error: SectionError) -> TrimError {
    match error {
        SectionError::UnrecognizedExecutable | SectionError::Invalid => {
            UnsupportedReason::UnrecognizedExecutable.into()
        }
        SectionError::MissingSection => UnsupportedReason::NoTrimTable.into(),
    }
}

fn convert_table_error(error: TableError) -> TrimError {
    match error {
        TableError::Empty => UnsupportedReason::NoTrimTable.into(),
        TableError::AlreadyTrimmed => UnsupportedReason::AlreadyTrimmed.into(),
        TableError::UnsupportedVersion | TableError::FeatureListMismatch => {
            UnsupportedReason::FeatureListMismatch.into()
        }
        TableError::Malformed(_) => TrimInternalError::MalformedTable.into(),
    }
}

fn read_section(
    executable: &mut Image<'_>,
    location: SectionLocation,
) -> Result<Vec<u8>, TrimError> {
    let end = location.file_offset.checked_add(location.size);
    if location.size > MAX_TABLE_BYTES || end.is_none_or(|end| end > executable.len as u64) {
        return Err(TrimInternalError::MalformedTable.into());
    }
    let mut section = vec![0u8; location.size as usize];
    if !(executable.read)(location.file_offset as usize, &mut section) {
        return Err(TrimInternalError::MalformedTable.into());
    }
    Ok(section)
}

pub fn read_trim_table(executable: &mut Image<'_>) -> Result<TrimTable, TrimError> {
    let location =
        find_known_section(executable, KnownSection::TrimTable).map_err(convert_section_error)?;
    let section = read_section(executable, location)?;
    parse_trim_table(&section).map_err(convert_table_error)
}

fn select_largest_ranges(ranges: &[RemovedRange], room: usize) -> Cow<'_, [RemovedRange]> {
    if ranges.len() <= room {
        return Cow::Borrowed(ranges);
    }
    let mut largest = ranges.to_vec();
    largest.sort_unstable_by_key(|range| (Reverse(range.size), range.start));
    largest.truncate(room);
    largest.sort_unstable_by_key(|range| range.start);
    Cow::Owned(largest)
}

fn encode_header_and_records(ranges: &[RemovedRange]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(REMOVED_RANGES_HEADER_BYTES + size_of_val(ranges));
    bytes.extend_from_slice(&TRIMMED_MAGIC);
    bytes.extend_from_slice(&TABLE_VERSION.to_le_bytes());
    bytes.extend_from_slice(&(ranges.len() as u32).to_le_bytes());
    for range in ranges {
        bytes.extend_from_slice(&range.start.to_le_bytes());
        bytes.extend_from_slice(&range.size.to_le_bytes());
        bytes.extend_from_slice(&range.feature.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
    }
    bytes
}

pub fn encode_removed_ranges(ranges: &[RemovedRange], capacity: usize) -> EncodedRemovedRanges {
    let room = capacity.saturating_sub(REMOVED_RANGES_HEADER_BYTES) / size_of::<RemovedRange>();
    let retained = select_largest_ranges(ranges, room.min(MAX_REMOVED_RANGES as usize));
    let bytes = if capacity < REMOVED_RANGES_HEADER_BYTES {
        Vec::new()
    } else {
        encode_header_and_records(&retained)
    };
    EncodedRemovedRanges {
        bytes,
        count: retained.len() as u32,
        dropped: u32::try_from(ranges.len() - retained.len()).unwrap_or(u32::MAX),
    }
}

#[cfg(test)]
pub(crate) mod tests;
