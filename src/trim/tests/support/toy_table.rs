use super::toy_executable::TABLE_ROOM;
use bun_exe_format::image::AddressRange;
use bun_icu_format::package::{MAGIC, Package};
use bun_removable_features::Feature;

pub(crate) const REFERENCE: u8 = 0;
pub(crate) const ABORTING_GUARD: u8 = 1;
pub(crate) const RECOVERABLE_GUARD: u8 = 2;

const TABLE_HEADER_BYTES: usize = 104;
const TABLE_DIRECTORY_OFFSET: usize = 32;

#[derive(Copy, Clone, Debug)]
pub(crate) struct ToyRange {
    pub(crate) range: AddressRange,
    pub(crate) set: u16,
    pub(crate) is_code: bool,
    pub(crate) can_be_cut: bool,
    pub(crate) can_be_filled: bool,
}

pub(crate) struct ToyIcuPackage {
    pub(crate) range: AddressRange,
    pub(crate) runs: Vec<(u32, u32, u16, u16)>,
}

pub(crate) struct ToyTable {
    pub(crate) features_hash: u64,
    pub(crate) edges: Vec<(Feature, Feature, u8, bool)>,
    pub(crate) sets: Vec<Vec<Feature>>,
    pub(crate) ranges: Vec<ToyRange>,
    pub(crate) icu_packages: Vec<ToyIcuPackage>,
    pub(crate) languages: Vec<(&'static str, u16)>,
}

#[derive(Default)]
struct Records {
    bytes: Vec<u8>,
    count: u32,
}

impl Records {
    fn add(&mut self, record: &[u8]) {
        self.bytes.extend_from_slice(record);
        self.count += 1;
    }
}

pub(crate) fn encode_table(table: &ToyTable) -> Vec<u8> {
    let base_address = compute_base_address(table);
    let (sets, members) = encode_sets(table);
    let (packages, runs) = encode_icu_packages(table, base_address);
    let sections = [
        encode_edges(table),
        sets,
        members,
        encode_ranges(table, base_address),
        packages,
        runs,
        encode_icu_languages(table),
        Records::default(),
        Records::default(),
    ];

    let mut bytes = vec![0u8; TABLE_HEADER_BYTES];
    bytes[..8].copy_from_slice(b"BUNTRIM\0");
    bytes[8..12].copy_from_slice(&5u32.to_le_bytes());
    bytes[16..24].copy_from_slice(&table.features_hash.to_le_bytes());
    bytes[24..32].copy_from_slice(&base_address.to_le_bytes());
    for (index, section) in sections.iter().enumerate() {
        bytes.resize(bytes.len().next_multiple_of(4), 0);
        let entry = TABLE_DIRECTORY_OFFSET + 8 * index;
        let offset = bytes.len() as u32;
        bytes[entry..entry + 4].copy_from_slice(&offset.to_le_bytes());
        bytes[entry + 4..entry + 8].copy_from_slice(&section.count.to_le_bytes());
        bytes.extend_from_slice(&section.bytes);
    }
    bytes.resize(bytes.len().next_multiple_of(4), 0);
    let byte_length = bytes.len() as u32;
    bytes[12..16].copy_from_slice(&byte_length.to_le_bytes());
    assert!(
        bytes.len() as u64 <= TABLE_ROOM,
        "the toy table does not fit its room"
    );
    bytes
}

fn compute_base_address(table: &ToyTable) -> u64 {
    let range_starts = table.ranges.iter().map(|range| range.range.start);
    let package_starts = table.icu_packages.iter().map(|package| package.range.start);
    let lowest = range_starts.chain(package_starts).min().unwrap_or(0);
    lowest - lowest % 0x1_0000
}

fn encode_edges(table: &ToyTable) -> Records {
    let mut records = Records::default();
    for (from, to, strength, is_followed) in &table.edges {
        let mut record = Vec::with_capacity(6);
        record.extend_from_slice(&from.index().to_le_bytes());
        record.extend_from_slice(&to.index().to_le_bytes());
        record.extend_from_slice(&[*strength, u8::from(*is_followed)]);
        records.add(&record);
    }
    records
}

fn encode_sets(table: &ToyTable) -> (Records, Records) {
    let mut sets = Records::default();
    let mut members = Records::default();
    for set in &table.sets {
        let first_member = members.count;
        for feature in set {
            members.add(&feature.index().to_le_bytes());
        }
        sets.add(&[first_member.to_le_bytes(), (set.len() as u32).to_le_bytes()].concat());
    }
    (sets, members)
}

fn encode_ranges(table: &ToyTable, base_address: u64) -> Records {
    let mut records = Records::default();
    for range in &table.ranges {
        let mut record = Vec::with_capacity(12);
        record.extend_from_slice(&((range.range.start - base_address) as u32).to_le_bytes());
        record.extend_from_slice(&(range.range.len() as u32).to_le_bytes());
        record.extend_from_slice(&range.set.to_le_bytes());
        record.extend_from_slice(&[u8::from(range.is_code), encode_removal_methods(range)]);
        records.add(&record);
    }
    records
}

fn encode_removal_methods(range: &ToyRange) -> u8 {
    match (range.can_be_cut, range.can_be_filled) {
        (false, true) => 0,
        (true, true) => 1,
        (true, false) => 2,
        (false, false) => panic!("{range:?} can be neither cut nor filled, which has no encoding"),
    }
}

fn encode_icu_packages(table: &ToyTable, base_address: u64) -> (Records, Records) {
    let mut packages = Records::default();
    let mut runs = Records::default();
    for package in &table.icu_packages {
        let first_run = runs.count;
        for (first_item, item_count, set, locale_group) in &package.runs {
            let mut record = Vec::with_capacity(12);
            record.extend_from_slice(&first_item.to_le_bytes());
            record.extend_from_slice(&item_count.to_le_bytes());
            record.extend_from_slice(&set.to_le_bytes());
            record.extend_from_slice(&locale_group.to_le_bytes());
            runs.add(&record);
        }
        let start = (package.range.start - base_address) as u32;
        let size = package.range.len() as u32;
        let run_count = package.runs.len() as u32;
        packages.add(
            &[start, size, first_run, run_count]
                .map(u32::to_le_bytes)
                .concat(),
        );
    }
    (packages, runs)
}

fn encode_icu_languages(table: &ToyTable) -> Records {
    let mut records = Records::default();
    for (name, group) in &table.languages {
        let mut record = [0u8; 8];
        record[..name.len()].copy_from_slice(name.as_bytes());
        record[4..6].copy_from_slice(&group.to_le_bytes());
        records.add(&record);
    }
    records
}

/// All bytes of the item at `index` are `0x40 + index`.
pub(crate) fn icu_package(items: usize, item_bytes: usize) -> Vec<u8> {
    let mut package = MAGIC.to_vec();
    package.extend([0, items as u32].map(u32::to_le_bytes).as_flattened());
    let first = Package::offset_field(items + 1);
    package.extend((0..=items).flat_map(|it| ((first + it * item_bytes) as u32).to_le_bytes()));
    for index in 0..items {
        package.resize(package.len() + item_bytes, 0x40 + index as u8);
    }
    package
}
