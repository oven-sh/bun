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
    IcuItemRun, IcuLanguage, IcuPackage, Library, LocaleGroup, ModuleText, RemovableRange,
    SetIndex, TrimTable,
};

pub const TABLE_MAGIC: [u8; 8] = *b"BUNTRIM\0";
pub const TABLE_VERSION: u32 = 3;
pub const TABLE_HEADER_BYTES: usize = 120;
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

const EDGE_RECORD_BYTES: usize = 6;
const FEATURE_SET_RECORD_BYTES: usize = 8;
const SET_MEMBER_RECORD_BYTES: usize = 2;
const RANGE_RECORD_BYTES: usize = 12;
const ICU_PACKAGE_RECORD_BYTES: usize = 16;
const ICU_RUN_RECORD_BYTES: usize = 12;
const ICU_LANGUAGE_RECORD_BYTES: usize = 8;
const LIBRARY_RECORD_BYTES: usize = 28;
const LIBRARY_SET_RECORD_BYTES: usize = 2;
const TEXT_RECORD_BYTES: usize = 1;
const MODULE_TEXT_RECORD_BYTES: usize = 16;

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
    Libraries,
    LibrarySets,
    Text,
    ModuleTexts,
    TrailingBytes,
}

pub struct EncodedRemovedRanges {
    pub bytes: Vec<u8>,
    pub count: u32,
    pub dropped: u32,
}

struct Sections<'a> {
    edges: &'a [u8],
    feature_sets: &'a [u8],
    set_members: &'a [u8],
    ranges: &'a [u8],
    icu_packages: &'a [u8],
    icu_runs: &'a [u8],
    icu_languages: &'a [u8],
    libraries: &'a [u8],
    library_sets: &'a [u8],
    text: &'a [u8],
    module_texts: &'a [u8],
}

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

fn read_text<'a>(
    text: &mut Tiling<'a>,
    start: u32,
    byte_count: u32,
) -> Result<&'a str, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::Text);
    let bytes = text.take(start, byte_count).ok_or(MALFORMED)?;
    core::str::from_utf8(bytes).map_err(|_| MALFORMED)
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

fn parse_sections(table: &[u8]) -> Result<Sections<'_>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::Directory);
    let directory = &table[DIRECTORY_OFFSET..TABLE_HEADER_BYTES];
    let mut entries = directory.as_chunks::<DIRECTORY_ENTRY_BYTES>().0.iter();
    let mut previous_end = TABLE_HEADER_BYTES as u64;
    let mut next_section = |record_bytes: usize| -> Result<&[u8], TableError> {
        let entry = entries.next().ok_or(MALFORMED)?;
        let offset = u64::from(read_u32(entry, 0));
        let end = offset + u64::from(read_u32(entry, 4)) * record_bytes as u64;
        if offset % SECTION_ALIGNMENT != 0 || offset < previous_end || end > table.len() as u64 {
            return Err(MALFORMED);
        }
        previous_end = end;
        Ok(&table[offset as usize..end as usize])
    };
    Ok(Sections {
        edges: next_section(EDGE_RECORD_BYTES)?,
        feature_sets: next_section(FEATURE_SET_RECORD_BYTES)?,
        set_members: next_section(SET_MEMBER_RECORD_BYTES)?,
        ranges: next_section(RANGE_RECORD_BYTES)?,
        icu_packages: next_section(ICU_PACKAGE_RECORD_BYTES)?,
        icu_runs: next_section(ICU_RUN_RECORD_BYTES)?,
        icu_languages: next_section(ICU_LANGUAGE_RECORD_BYTES)?,
        libraries: next_section(LIBRARY_RECORD_BYTES)?,
        library_sets: next_section(LIBRARY_SET_RECORD_BYTES)?,
        text: next_section(TEXT_RECORD_BYTES)?,
        module_texts: next_section(MODULE_TEXT_RECORD_BYTES)?,
    })
}

fn parse_edges(sections: &Sections<'_>) -> Result<FeatureEdges, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::Edges);
    let mut edges = Vec::with_capacity(sections.edges.len() / EDGE_RECORD_BYTES);
    let mut previous: Option<(u16, u16)> = None;
    for record in sections.edges.as_chunks::<EDGE_RECORD_BYTES>().0 {
        let pair = (read_u16(record, 0), read_u16(record, 2));
        if pair.0 == pair.1 || previous.is_some_and(|previous| previous >= pair) {
            return Err(MALFORMED);
        }
        let strength = EdgeStrength::from_byte(record[4]).ok_or(MALFORMED)?;
        let is_followed = read_flag(u32::from(record[5])).ok_or(MALFORMED)?;
        if strength == EdgeStrength::Reference && !is_followed {
            return Err(MALFORMED);
        }
        edges.push(FeatureEdge {
            from: read_feature(pair.0, MALFORMED)?,
            to: read_feature(pair.1, MALFORMED)?,
            strength,
            is_followed,
        });
        previous = Some(pair);
    }
    Ok(FeatureEdges::new(edges))
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

fn parse_ranges(
    sections: &Sections<'_>,
    base_address: u64,
    set_count: usize,
) -> Result<Vec<RemovableRange>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::Ranges);
    let mut ranges = Vec::with_capacity(sections.ranges.len() / RANGE_RECORD_BYTES);
    let mut previous = None;
    for record in sections.ranges.as_chunks::<RANGE_RECORD_BYTES>().0 {
        let range = read_address_range(base_address, record, previous).ok_or(MALFORMED)?;
        let methods = read_removal_methods(record[11]).ok_or(MALFORMED)?;
        ranges.push(RemovableRange {
            range,
            set: read_set_index(read_u16(record, 8), set_count).ok_or(MALFORMED)?,
            is_code: read_flag(u32::from(record[10])).ok_or(MALFORMED)?,
            can_be_cut: methods.can_be_cut,
            can_be_filled: methods.can_be_filled,
        });
        previous = Some(range);
    }
    Ok(ranges)
}

fn parse_icu_languages(sections: &Sections<'_>) -> Result<Vec<IcuLanguage>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::IcuLanguages);
    let language_count = sections.icu_languages.len() / ICU_LANGUAGE_RECORD_BYTES;
    let mut languages = Vec::with_capacity(language_count);
    let mut previous: Option<[u8; 4]> = None;
    for record in sections
        .icu_languages
        .as_chunks::<ICU_LANGUAGE_RECORD_BYTES>()
        .0
    {
        let name = read_language_name(record).ok_or(MALFORMED)?;
        let group = read_u16(record, 4);
        let is_ascending = previous.is_none_or(|previous| previous < name);
        if !is_ascending || u32::from(group) >= LOCALE_GROUP_LIMIT || read_u16(record, 6) != 0 {
            return Err(MALFORMED);
        }
        languages.push(IcuLanguage {
            name,
            group: LocaleGroup(group),
        });
        previous = Some(name);
    }
    Ok(languages)
}

fn parse_icu_runs(
    package_runs: &[u8],
    set_count: usize,
    languages: &[IcuLanguage],
) -> Result<Vec<IcuItemRun>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::IcuRuns);
    let mut runs = Vec::with_capacity(package_runs.len() / ICU_RUN_RECORD_BYTES);
    let mut previous_end = 0u64;
    for record in package_runs.as_chunks::<ICU_RUN_RECORD_BYTES>().0 {
        let first_item = read_u32(record, 0);
        let item_count = read_u32(record, 4);
        let locale_group = read_u16(record, 10).checked_sub(1).map(LocaleGroup);
        let has_known_group = locale_group
            .is_none_or(|group| languages.iter().any(|language| language.group == group));
        if u64::from(first_item) < previous_end || item_count == 0 || !has_known_group {
            return Err(MALFORMED);
        }
        runs.push(IcuItemRun {
            first_item,
            item_count,
            set: read_set_index(read_u16(record, 8), set_count).ok_or(MALFORMED)?,
            locale_group,
        });
        previous_end = u64::from(first_item) + u64::from(item_count);
    }
    Ok(runs)
}

fn parse_icu_packages(
    sections: &Sections<'_>,
    base_address: u64,
    set_count: usize,
    languages: &[IcuLanguage],
) -> Result<Vec<IcuPackage>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::IcuPackages);
    let mut runs = Tiling::new(sections.icu_runs, ICU_RUN_RECORD_BYTES);
    let mut packages = Vec::with_capacity(sections.icu_packages.len() / ICU_PACKAGE_RECORD_BYTES);
    let mut previous = None;
    for record in sections
        .icu_packages
        .as_chunks::<ICU_PACKAGE_RECORD_BYTES>()
        .0
    {
        let range = read_address_range(base_address, record, previous).ok_or(MALFORMED)?;
        let package_runs = runs
            .take(read_u32(record, 8), read_u32(record, 12))
            .ok_or(MALFORMED)?;
        packages.push(IcuPackage {
            range,
            runs: parse_icu_runs(package_runs, set_count, languages)?,
        });
        previous = Some(range);
    }
    if !runs.is_complete() {
        return Err(MALFORMED);
    }
    Ok(packages)
}

fn parse_library_sets(library_sets: &[u8], set_count: usize) -> Result<Vec<SetIndex>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::LibrarySets);
    let mut sets = Vec::with_capacity(library_sets.len() / LIBRARY_SET_RECORD_BYTES);
    let mut previous: Option<SetIndex> = None;
    for record in library_sets.as_chunks::<LIBRARY_SET_RECORD_BYTES>().0 {
        let set = read_set_index(read_u16(record, 0), set_count).ok_or(MALFORMED)?;
        if previous.is_some_and(|previous| previous >= set) {
            return Err(MALFORMED);
        }
        sets.push(set);
        previous = Some(set);
    }
    Ok(sets)
}

fn parse_libraries(sections: &Sections<'_>, set_count: usize) -> Result<Vec<Library>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::Libraries);
    let mut text = Tiling::new(sections.text, TEXT_RECORD_BYTES);
    let mut library_sets = Tiling::new(sections.library_sets, LIBRARY_SET_RECORD_BYTES);
    let mut libraries = Vec::with_capacity(sections.libraries.len() / LIBRARY_RECORD_BYTES);
    let mut previous_name: Option<&str> = None;
    for record in sections.libraries.as_chunks::<LIBRARY_RECORD_BYTES>().0 {
        let name = read_text(&mut text, read_u32(record, 0), read_u32(record, 4))?;
        let version = read_text(&mut text, read_u32(record, 8), read_u32(record, 12))?;
        let sets = library_sets
            .take(read_u32(record, 16), read_u32(record, 20))
            .ok_or(MALFORMED)?;
        if previous_name.is_some_and(|previous| previous >= name) {
            return Err(MALFORMED);
        }
        libraries.push(Library {
            name: Box::from(name),
            version: Box::from(version),
            has_retained_bytes: read_flag(read_u32(record, 24)).ok_or(MALFORMED)?,
            sets: parse_library_sets(sets, set_count)?,
        });
        previous_name = Some(name);
    }
    if !library_sets.is_complete() {
        return Err(MALFORMED);
    }
    if !text.is_complete() {
        return Err(TableError::Malformed(MalformedTable::Text));
    }
    Ok(libraries)
}

fn are_some_of_set(readers: SetIndex, set: SetIndex, sets: &[FeatureSet]) -> bool {
    readers != set && sets[usize::from(readers.0)].is_subset_of(&sets[usize::from(set.0)])
}

fn parse_module_texts(
    sections: &Sections<'_>,
    base_address: u64,
    sets: &[FeatureSet],
) -> Result<Vec<ModuleText>, TableError> {
    const MALFORMED: TableError = TableError::Malformed(MalformedTable::ModuleTexts);
    let text_count = sections.module_texts.len() / MODULE_TEXT_RECORD_BYTES;
    let mut texts = Vec::with_capacity(text_count);
    let mut modules = Vec::with_capacity(text_count);
    let mut previous = None;
    for record in sections
        .module_texts
        .as_chunks::<MODULE_TEXT_RECORD_BYTES>()
        .0
    {
        let range = read_address_range(base_address, record, previous).ok_or(MALFORMED)?;
        let module = read_u16(record, 8);
        let set = read_set_index(read_u16(record, 10), sets.len()).ok_or(MALFORMED)?;
        let readers = match read_u16(record, 12).checked_sub(1) {
            Some(index) => Some(read_set_index(index, sets.len()).ok_or(MALFORMED)?),
            None => None,
        };
        let methods = read_removal_methods(record[14]).ok_or(MALFORMED)?;
        if readers.is_some_and(|readers| !are_some_of_set(readers, set, sets)) || record[15] != 0 {
            return Err(MALFORMED);
        }
        texts.push(ModuleText {
            range,
            module,
            set,
            readers,
            can_be_cut: methods.can_be_cut,
            can_be_filled: methods.can_be_filled,
        });
        modules.push(module);
        previous = Some(range);
    }
    modules.sort_unstable();
    if !modules.is_sorted_by(|left, right| left < right) {
        return Err(MALFORMED);
    }
    Ok(texts)
}

pub fn parse_trim_table(section: &[u8]) -> Result<TrimTable, TableError> {
    let table = check_header(section)?;
    let sections = parse_sections(table)?;
    let base_address = read_u64(table, BASE_ADDRESS_OFFSET);
    let sets = parse_feature_sets(&sections)?;
    let set_count = sets.len();
    let icu_languages = parse_icu_languages(&sections)?;
    let edges = parse_edges(&sections)?;
    let ranges = parse_ranges(&sections, base_address, set_count)?;
    let icu_packages = parse_icu_packages(&sections, base_address, set_count, &icu_languages)?;
    let libraries = parse_libraries(&sections, set_count)?;
    let module_texts = parse_module_texts(&sections, base_address, &sets)?;
    Ok(TrimTable {
        features_hash: read_u64(table, FEATURES_HASH_OFFSET),
        base_address,
        edges,
        sets,
        ranges,
        icu_packages,
        icu_languages,
        libraries,
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
