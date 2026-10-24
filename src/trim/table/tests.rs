use bun_removable_features::find_removed_range;

use super::*;

const EDGES: usize = 0;
const FEATURE_SETS: usize = 1;
const SET_MEMBERS: usize = 2;
const RANGES: usize = 3;
const ICU_PACKAGES: usize = 4;
const ICU_RUNS: usize = 5;
const ICU_LANGUAGES: usize = 6;
const MODULE_TEXTS: usize = 7;
const RECORD_BYTES: [usize; 8] = [6, 8, 2, 12, 16, 12, 8, 16];
const BASE_ADDRESS: u64 = 0x1_0000;

#[derive(Default)]
struct SectionBytes([Vec<u8>; 8]);

impl SectionBytes {
    fn push_u16s(&mut self, section: usize, values: &[u16]) {
        self.0[section].extend(values.iter().flat_map(|value| value.to_le_bytes()));
    }

    fn push_u32s(&mut self, section: usize, values: &[u32]) {
        self.0[section].extend(values.iter().flat_map(|value| value.to_le_bytes()));
    }

    fn record_count(&self, section: usize) -> u32 {
        (self.0[section].len() / RECORD_BYTES[section]) as u32
    }
}

fn write_bytes(table: &mut [u8], offset: usize, value: &[u8]) {
    table[offset..][..value.len()].copy_from_slice(value);
}

fn encode_removal_methods(can_be_cut: bool, can_be_filled: bool) -> u8 {
    match (can_be_cut, can_be_filled) {
        (false, true) => 0,
        (true, true) => 1,
        (true, false) => 2,
        (false, false) => panic!("a range that can be neither cut nor filled has no encoding"),
    }
}

pub(crate) fn encode_table(table: &TrimTable) -> Vec<u8> {
    let base = table.base_address;
    let mut sections = SectionBytes::default();
    for edge in table.edges.as_slice() {
        sections.push_u16s(EDGES, &[edge.from.index(), edge.to.index()]);
        sections.0[EDGES].extend([edge.strength as u8, u8::from(edge.is_followed)]);
    }
    for set in &table.sets {
        let first_member = sections.record_count(SET_MEMBERS);
        sections.push_u32s(FEATURE_SETS, &[first_member, set.len() as u32]);
        for feature in set.iter() {
            sections.push_u16s(SET_MEMBERS, &[feature.index()]);
        }
    }
    for range in &table.ranges {
        let AddressRange { start, end } = range.range;
        sections.push_u32s(RANGES, &[(start - base) as u32, (end - start) as u32]);
        sections.push_u16s(RANGES, &[range.set.0]);
        let methods = encode_removal_methods(range.can_be_cut, range.can_be_filled);
        sections.0[RANGES].extend([u8::from(range.is_code), methods]);
    }
    for package in &table.icu_packages {
        let AddressRange { start, end } = package.range;
        let first_run = sections.record_count(ICU_RUNS);
        sections.push_u32s(ICU_PACKAGES, &[(start - base) as u32, (end - start) as u32]);
        sections.push_u32s(ICU_PACKAGES, &[first_run, package.runs.len() as u32]);
        for run in &package.runs {
            sections.push_u32s(ICU_RUNS, &[run.first_item, run.item_count]);
            let locale_group = run.locale_group.map_or(0, |group| group.0 + 1);
            sections.push_u16s(ICU_RUNS, &[run.set.0, locale_group]);
        }
    }
    for language in &table.icu_languages {
        sections.0[ICU_LANGUAGES].extend_from_slice(&language.name);
        sections.push_u16s(ICU_LANGUAGES, &[language.group.0, 0]);
    }
    for text in &table.module_texts {
        let AddressRange { start, end } = text.range;
        let readers = text.readers.map_or(0, |readers| readers.0 + 1);
        sections.push_u32s(MODULE_TEXTS, &[(start - base) as u32, (end - start) as u32]);
        sections.push_u16s(MODULE_TEXTS, &[text.module, text.set.0, readers]);
        let methods = encode_removal_methods(text.can_be_cut, text.can_be_filled);
        sections.0[MODULE_TEXTS].extend([methods, 0]);
    }
    let mut bytes = vec![0u8; TABLE_HEADER_BYTES];
    for (section, records) in sections.0.iter().enumerate() {
        let offset = bytes.len() as u32;
        let count = sections.record_count(section);
        write_bytes(&mut bytes, 32 + 8 * section, &offset.to_le_bytes());
        write_bytes(&mut bytes, 36 + 8 * section, &count.to_le_bytes());
        bytes.extend_from_slice(records);
        bytes.resize(bytes.len().next_multiple_of(4), 0);
    }
    let byte_length = bytes.len() as u32;
    write_bytes(&mut bytes, 0, b"BUNTRIM\0");
    write_bytes(&mut bytes, 8, &TABLE_VERSION.to_le_bytes());
    write_bytes(&mut bytes, 12, &byte_length.to_le_bytes());
    write_bytes(&mut bytes, 16, &table.features_hash.to_le_bytes());
    write_bytes(&mut bytes, 24, &table.base_address.to_le_bytes());
    bytes
}

fn feature(position: usize) -> Feature {
    Feature::ALL[position]
}

fn empty_table() -> TrimTable {
    TrimTable {
        features_hash: FEATURES_HASH,
        base_address: 0,
        edges: FeatureEdges::default(),
        sets: Vec::new(),
        ranges: Vec::new(),
        icu_packages: Vec::new(),
        icu_languages: Vec::new(),
        module_texts: Vec::new(),
    }
}

fn sample_table() -> TrimTable {
    let address_range = |start: u64, end: u64| AddressRange {
        start: BASE_ADDRESS + start,
        end: BASE_ADDRESS + end,
    };
    let range = |start, end, set, is_code, can_be_cut, can_be_filled| RemovableRange {
        range: address_range(start, end),
        set: SetIndex(set),
        is_code,
        can_be_cut,
        can_be_filled,
    };
    let edge = |from, to, strength, is_followed| FeatureEdge {
        from: feature(from),
        to: feature(to),
        strength,
        is_followed,
    };
    let run = |first_item, item_count, set, locale_group: Option<u16>| IcuItemRun {
        first_item,
        item_count,
        set: SetIndex(set),
        locale_group: locale_group.map(LocaleGroup),
    };
    let language = |name: &[u8; 4], group| IcuLanguage {
        name: *name,
        group: LocaleGroup(group),
    };
    let module_text = |start, end, module, set, readers: Option<u16>, can_be_cut| ModuleText {
        range: address_range(start, end),
        module,
        set: SetIndex(set),
        readers: readers.map(SetIndex),
        can_be_cut,
        can_be_filled: true,
    };
    TrimTable {
        features_hash: FEATURES_HASH,
        base_address: BASE_ADDRESS,
        edges: FeatureEdges::new(vec![
            edge(0, 1, EdgeStrength::Reference, true),
            edge(0, 2, EdgeStrength::RecoverableGuard, false),
        ]),
        sets: vec![
            FeatureSet::from_features(&[feature(0)]),
            FeatureSet::from_features(&[feature(0), feature(1)]),
            FeatureSet::from_features(&[feature(2)]),
        ],
        ranges: vec![
            range(0x100, 0x200, 0, true, false, true),
            range(0x200, 0x240, 1, false, true, true),
            range(0x240, 0x280, 2, false, true, false),
        ],
        icu_packages: vec![
            IcuPackage {
                range: address_range(0x1000, 0x1100),
                runs: vec![run(0, 4, 1, None), run(4, 2, 2, Some(1))],
            },
            IcuPackage {
                range: address_range(0x1100, 0x1200),
                runs: vec![run(0, 1, 0, None)],
            },
        ],
        icu_languages: vec![
            language(b"de\0\0", 0),
            language(b"nb\0\0", 1),
            language(b"no\0\0", 1),
        ],
        module_texts: vec![
            module_text(0x2000, 0x2020, 7, 1, Some(0), true),
            module_text(0x2020, 0x2030, 3, 2, None, false),
        ],
    }
}

fn directory_entry(section: usize) -> usize {
    DIRECTORY_OFFSET + DIRECTORY_ENTRY_BYTES * section
}

fn record_field(section: usize, record: usize, field: usize) -> usize {
    let table = encode_table(&sample_table());
    let section_offset = read_u32(&table, directory_entry(section)) as usize;
    section_offset + RECORD_BYTES[section] * record + field
}

fn parse_patched_table(offset: usize, value: &[u8]) -> Result<TrimTable, TableError> {
    let mut bytes = encode_table(&sample_table());
    write_bytes(&mut bytes, offset, value);
    parse_trim_table(&bytes)
}

#[track_caller]
fn assert_malformed(result: Result<TrimTable, TableError>, rule: MalformedTable) {
    assert_eq!(result.unwrap_err(), TableError::Malformed(rule));
}

macro_rules! malformed_table_tests {
    ($($name:ident: $offset:expr, $value:expr => $rule:ident;)*) => {$(
        #[test]
        fn $name() {
            let result = parse_patched_table($offset, &$value.to_le_bytes());
            assert_malformed(result, MalformedTable::$rule);
        }
    )*};
}

malformed_table_tests! {
    wrong_magic: 0, b'X' => Magic;
    byte_length_below_header: BYTE_LENGTH_OFFSET, 84u32 => Length;
    unaligned_section_offset: directory_entry(EDGES), 90u32 => Directory;
    section_offset_inside_header: directory_entry(EDGES), 84u32 => Directory;
    descending_section_offsets: directory_entry(FEATURE_SETS), 88u32 => Directory;
    overlapping_sections: directory_entry(EDGES) + 4, 3u32 => Directory;
    maximum_record_count: directory_entry(EDGES) + 4, u32::MAX => Directory;
    section_size_wrapping_u32: directory_entry(EDGES) + 4, (1u32 << 31) + 2 => Directory;
    module_texts_past_byte_length: directory_entry(MODULE_TEXTS) + 4, 3u32 => Directory;
    unsorted_edges: record_field(EDGES, 0, 0), feature(2).index() => Edges;
    repeated_edge: record_field(EDGES, 1, 2), feature(1).index() => Edges;
    edge_to_itself: record_field(EDGES, 0, 2), feature(0).index() => Edges;
    undeclared_edge_source: record_field(EDGES, 1, 0), 511u16 => Edges;
    undeclared_edge_target: record_field(EDGES, 1, 2), 511u16 => Edges;
    edge_target_past_limit: record_field(EDGES, 1, 2), 600u16 => Edges;
    invalid_edge_strength: record_field(EDGES, 1, 4), 3u8 => Edges;
    invalid_followed_flag: record_field(EDGES, 1, 5), 2u8 => Edges;
    unfollowed_reference: record_field(EDGES, 0, 5), 0u8 => Edges;
    empty_feature_set: record_field(FEATURE_SETS, 2, 4), 0u32 => FeatureSets;
    skipped_set_member: record_field(FEATURE_SETS, 1, 0), 2u32 => FeatureSets;
    shared_set_member: record_field(FEATURE_SETS, 1, 0), 0u32 => FeatureSets;
    set_members_past_end: record_field(FEATURE_SETS, 2, 4), 2u32 => FeatureSets;
    set_members_without_set: directory_entry(FEATURE_SETS) + 4, 2u32 => FeatureSets;
    unsorted_set_members: record_field(SET_MEMBERS, 1, 0), feature(2).index() => FeatureSets;
    repeated_set_member: record_field(SET_MEMBERS, 2, 0), feature(0).index() => FeatureSets;
    equal_feature_sets: record_field(SET_MEMBERS, 3, 0), feature(0).index() => FeatureSets;
    undeclared_set_member: record_field(SET_MEMBERS, 3, 0), 511u16 => FeatureSets;
    set_member_past_limit: record_field(SET_MEMBERS, 3, 0), 600u16 => FeatureSets;
    overlapping_ranges: record_field(RANGES, 1, 0), 0x1ffu32 => Ranges;
    empty_range: record_field(RANGES, 0, 4), 0u32 => Ranges;
    invalid_range_set: record_field(RANGES, 0, 8), 3u16 => Ranges;
    invalid_code_flag: record_field(RANGES, 0, 10), 2u8 => Ranges;
    invalid_removal_methods: record_field(RANGES, 0, 11), 3u8 => Ranges;
    range_start_overflow: BASE_ADDRESS_OFFSET, u64::MAX => Ranges;
    range_end_overflow: BASE_ADDRESS_OFFSET, u64::MAX - 0x100 => Ranges;
    overlapping_icu_packages: record_field(ICU_PACKAGES, 1, 0), 0x10ffu32 => IcuPackages;
    empty_icu_package: record_field(ICU_PACKAGES, 0, 4), 0u32 => IcuPackages;
    skipped_icu_run: record_field(ICU_PACKAGES, 1, 8), 3u32 => IcuPackages;
    icu_runs_past_end: record_field(ICU_PACKAGES, 1, 12), 2u32 => IcuPackages;
    icu_run_without_package: record_field(ICU_PACKAGES, 1, 12), 0u32 => IcuPackages;
    overlapping_icu_runs: record_field(ICU_RUNS, 1, 0), 3u32 => IcuRuns;
    empty_icu_run: record_field(ICU_RUNS, 1, 4), 0u32 => IcuRuns;
    invalid_icu_run_set: record_field(ICU_RUNS, 1, 8), 3u16 => IcuRuns;
    icu_run_group_without_language: record_field(ICU_RUNS, 1, 10), 3u16 => IcuRuns;
    unsorted_languages: record_field(ICU_LANGUAGES, 1, 0), b'a' => IcuLanguages;
    repeated_language: record_field(ICU_LANGUAGES, 2, 1), b'b' => IcuLanguages;
    uppercase_language: record_field(ICU_LANGUAGES, 0, 0), b'D' => IcuLanguages;
    one_letter_language: record_field(ICU_LANGUAGES, 0, 1), 0u8 => IcuLanguages;
    language_after_padding: record_field(ICU_LANGUAGES, 0, 3), b'x' => IcuLanguages;
    language_group_at_limit: record_field(ICU_LANGUAGES, 0, 4), 65535u16 => IcuLanguages;
    nonzero_reserved_language_field: record_field(ICU_LANGUAGES, 0, 6), 1u16 => IcuLanguages;
    overlapping_module_texts: record_field(MODULE_TEXTS, 1, 0), 0x201fu32 => ModuleTexts;
    empty_module_text: record_field(MODULE_TEXTS, 0, 4), 0u32 => ModuleTexts;
    two_texts_of_one_module: record_field(MODULE_TEXTS, 1, 8), 7u16 => ModuleTexts;
    invalid_module_text_set: record_field(MODULE_TEXTS, 0, 10), 3u16 => ModuleTexts;
    invalid_module_text_readers: record_field(MODULE_TEXTS, 0, 12), 4u16 => ModuleTexts;
    readers_equal_to_set: record_field(MODULE_TEXTS, 0, 12), 2u16 => ModuleTexts;
    readers_outside_set: record_field(MODULE_TEXTS, 0, 12), 3u16 => ModuleTexts;
    invalid_module_text_removal_methods: record_field(MODULE_TEXTS, 0, 14), 3u8 => ModuleTexts;
    nonzero_reserved_module_text_field: record_field(MODULE_TEXTS, 0, 15), 1u8 => ModuleTexts;
}

#[test]
fn four_letter_language() {
    let result = parse_patched_table(record_field(ICU_LANGUAGES, 0, 2), b"ux");
    assert_malformed(result, MalformedTable::IcuLanguages);
}

#[test]
fn tables_round_trip() {
    assert_eq!(encode_table(&empty_table()).len(), 96);
    for table in [empty_table(), sample_table()] {
        assert_eq!(parse_trim_table(&encode_table(&table)), Ok(table));
    }
}

#[test]
fn removal_methods_values() {
    let flags_of = |value: u8| {
        let table = parse_patched_table(record_field(RANGES, 0, 11), &[value]).unwrap();
        (table.ranges[0].can_be_cut, table.ranges[0].can_be_filled)
    };
    assert_eq!(flags_of(0), (false, true));
    assert_eq!(flags_of(1), (true, true));
    assert_eq!(flags_of(2), (true, false));
}

#[test]
fn module_text_readers_values() {
    let readers_of = |value: u16| {
        let field = record_field(MODULE_TEXTS, 0, 12);
        let table = parse_patched_table(field, &value.to_le_bytes()).unwrap();
        table.module_texts[0].readers
    };
    assert_eq!(readers_of(0), None);
    assert_eq!(readers_of(1), Some(SetIndex(0)));
}

#[test]
fn edge_strength_values() {
    let strength_of = |value: u8| {
        let table = parse_patched_table(record_field(EDGES, 0, 4), &[value]).unwrap();
        table.edges.as_slice()[0].strength
    };
    assert_eq!(strength_of(0), EdgeStrength::Reference);
    assert_eq!(strength_of(1), EdgeStrength::AbortingGuard);
    assert_eq!(strength_of(2), EdgeStrength::RecoverableGuard);
}

#[test]
fn guard_edge_is_followed_or_not() {
    let is_followed = |strength: u8, flag: u8| {
        let table = parse_patched_table(record_field(EDGES, 1, 4), &[strength, flag]).unwrap();
        table.edges.as_slice()[1].is_followed
    };
    for strength in [1, 2] {
        assert!(!is_followed(strength, 0));
        assert!(is_followed(strength, 1));
    }
}

#[test]
fn locale_group_values() {
    let group_of = |value: u16| {
        let field = record_field(ICU_RUNS, 1, 10);
        let table = parse_patched_table(field, &value.to_le_bytes()).unwrap();
        table.icu_packages[0].runs[1].locale_group
    };
    assert_eq!(group_of(0), None);
    assert_eq!(group_of(1), Some(LocaleGroup(0)));
    assert_eq!(group_of(2), Some(LocaleGroup(1)));
}

#[test]
fn three_letter_language_is_read() {
    let table = parse_patched_table(record_field(ICU_LANGUAGES, 2, 2), b"b").unwrap();
    assert_eq!(table.icu_languages[2].name, *b"nob\0");
    assert_eq!(table.icu_languages[2].group, LocaleGroup(1));
}

#[test]
fn trailing_bytes() {
    let mut bytes = encode_table(&sample_table());
    bytes.resize(bytes.len() + 64, 0);
    assert_eq!(parse_trim_table(&bytes), Ok(sample_table()));
    bytes.push(1);
    assert_malformed(parse_trim_table(&bytes), MalformedTable::TrailingBytes);
}

#[test]
fn first_checks() {
    assert_eq!(parse_trim_table(&[]), Err(TableError::Empty));
    assert_eq!(parse_trim_table(&TABLE_MAGIC), Err(TableError::Empty));
    assert_eq!(parse_trim_table(&[0; 256]), Err(TableError::Empty));
    let trimmed = encode_removed_ranges(&[], 64).bytes;
    assert_eq!(parse_trim_table(&trimmed), Err(TableError::AlreadyTrimmed));
    for version in [TABLE_VERSION - 1, TABLE_VERSION + 1] {
        let result = parse_patched_table(VERSION_OFFSET, &version.to_le_bytes());
        assert_eq!(result, Err(TableError::UnsupportedVersion));
    }
    let other_hash = (FEATURES_HASH ^ 1).to_le_bytes();
    let result = parse_patched_table(FEATURES_HASH_OFFSET, &other_hash);
    assert_eq!(result, Err(TableError::FeatureListMismatch));
}

#[test]
fn version_and_feature_list_errors_share_reason() {
    for error in [
        TableError::UnsupportedVersion,
        TableError::FeatureListMismatch,
    ] {
        assert!(matches!(
            convert_table_error(error),
            TrimError::Unsupported(UnsupportedReason::FeatureListMismatch)
        ));
    }
}

#[test]
fn truncated_table_is_rejected() {
    let bytes = encode_table(&sample_table());
    for length in (0..16).step_by(4) {
        assert_eq!(parse_trim_table(&bytes[..length]), Err(TableError::Empty));
    }
    for length in (16..bytes.len()).step_by(4) {
        assert_malformed(parse_trim_table(&bytes[..length]), MalformedTable::Length);
    }
    for length in (96..bytes.len()).step_by(4) {
        let mut truncated = bytes[..length].to_vec();
        let byte_length = (length as u32).to_le_bytes();
        write_bytes(&mut truncated, BYTE_LENGTH_OFFSET, &byte_length);
        assert_malformed(parse_trim_table(&truncated), MalformedTable::Directory);
    }
}

#[test]
fn damaged_byte_never_panics() {
    let bytes = encode_table(&sample_table());
    for offset in 0..bytes.len() {
        for value in [0x00, 0x01, 0x7f, 0x80, 0xff] {
            let mut damaged = bytes.clone();
            damaged[offset] = value;
            let _ = parse_trim_table(&damaged);
        }
    }
}

#[test]
fn feature_set_limit() {
    let create_set = |bits: usize| -> FeatureSet {
        let positions = (0..17usize).filter(|position| (bits >> position) & 1 != 0);
        positions.map(feature).collect()
    };
    let mut table = empty_table();
    table.sets = (1..=1 << 16).map(create_set).collect();
    assert!(parse_trim_table(&encode_table(&table)).is_ok());
    table.sets.push(create_set((1 << 16) + 1));
    let result = parse_trim_table(&encode_table(&table));
    assert_malformed(result, MalformedTable::FeatureSets);
}

fn read_section_at(file_offset: u64, size: u64, can_read: bool) -> Result<Vec<u8>, TrimError> {
    const FILE: [u8; 4] = [1, 2, 3, 4];
    let mut read = |offset: usize, buffer: &mut [u8]| {
        buffer.copy_from_slice(&FILE[offset..][..buffer.len()]);
        can_read
    };
    let mut executable = Image {
        len: FILE.len(),
        read: &mut read,
    };
    let location = SectionLocation {
        address: 0,
        file_offset,
        size,
    };
    read_section(&mut executable, location)
}

#[test]
fn section_bounds() {
    assert_eq!(read_section_at(1, 2, true).unwrap(), [2, 3]);
    let unreadable = [
        read_section_at(3, 2, true),
        read_section_at(u64::MAX, 2, true),
        read_section_at(0, MAX_TABLE_BYTES + 1, true),
        read_section_at(0, 4, false),
    ];
    for result in unreadable {
        assert!(matches!(
            result,
            Err(TrimError::Internal(TrimInternalError::MalformedTable))
        ));
    }
}

fn removed_range(start: i64, size: u32, feature: u16) -> RemovedRange {
    RemovedRange {
        start,
        size,
        feature,
        reserved: 0,
    }
}

fn decode_records(bytes: &[u8]) -> Vec<RemovedRange> {
    bytes[16..]
        .chunks_exact(16)
        .map(|record| RemovedRange {
            start: i64::from_le_bytes(read_array(record, 0)),
            size: read_u32(record, 8),
            feature: read_u16(record, 12),
            reserved: read_u16(record, 14),
        })
        .collect()
}

#[test]
fn encoded_ranges_fit() {
    let ranges = [removed_range(-64, 16, 1), removed_range(100, 10, 2)];
    let encoded = encode_removed_ranges(&ranges, 64);
    assert_eq!((encoded.count, encoded.dropped), (2, 0));
    assert_eq!(encoded.bytes.len(), 48);
    assert_eq!(encoded.bytes[..8], *b"BUNTRMD\0");
    assert_eq!(read_u32(&encoded.bytes, 8), TABLE_VERSION);
    assert_eq!(read_u32(&encoded.bytes, 12), 2);
    let records = decode_records(&encoded.bytes);
    assert_eq!(records, ranges);
    assert_eq!(find_removed_range(&records, -64), Some(1));
    assert_eq!(find_removed_range(&records, 109), Some(2));
    assert_eq!(find_removed_range(&records, 110), None);
}

#[test]
fn smallest_range_is_dropped() {
    let ranges = [
        removed_range(0, 32, 1),
        removed_range(100, 8, 2),
        removed_range(200, 16, 3),
    ];
    let encoded = encode_removed_ranges(&ranges, 63);
    assert_eq!((encoded.count, encoded.dropped), (2, 1));
    assert_eq!(decode_records(&encoded.bytes), [ranges[0], ranges[2]]);
}

#[test]
fn lower_start_wins_ties() {
    let ranges = [removed_range(0, 8, 1), removed_range(100, 8, 2)];
    let encoded = encode_removed_ranges(&ranges, 32);
    assert_eq!((encoded.count, encoded.dropped), (1, 1));
    assert_eq!(decode_records(&encoded.bytes), [ranges[0]]);
}

#[test]
fn small_capacities() {
    let ranges = [removed_range(0, 8, 1), removed_range(100, 8, 2)];
    for (capacity, byte_count) in [(0, 0), (15, 0), (16, 16)] {
        let encoded = encode_removed_ranges(&ranges, capacity);
        assert_eq!(encoded.bytes.len(), byte_count);
        assert_eq!((encoded.count, encoded.dropped), (0, 2));
    }
}

#[test]
fn range_count_limit() {
    let ranges: Vec<RemovedRange> = (0..=i64::from(MAX_REMOVED_RANGES))
        .map(|position| removed_range(position * 16, 8, 1))
        .collect();
    let encoded = encode_removed_ranges(&ranges, usize::MAX);
    assert_eq!((encoded.count, encoded.dropped), (MAX_REMOVED_RANGES, 1));
}
