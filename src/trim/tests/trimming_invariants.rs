#![allow(clippy::disallowed_methods)]
#![allow(clippy::disallowed_types)]
#![allow(clippy::disallowed_macros)]

use bun_sema_standalone as _;

mod support;

use bun_exe_format::builtins::Image;
use bun_exe_format::image::{AddressRange, Architecture, ExecutableFormat, read_bytes_at};
use bun_options_types::trim::TrimRequest;
use bun_removable_features::{
    EnteredFrom, FEATURES_HASH, Feature, FeatureSet, RemovableFeatureState, Removal, RemovedRange,
    TrimFeature, find_removed_range,
};
use bun_trim::table::{TABLE_VERSION, TRIMMED_MAGIC};
use bun_trim::{
    ExecutableSettings, LocaleTag, TrimError, TrimInput, TrimInternalError, TrimPlan, TrimSummary,
    UnseenCodeCause, UnsupportedReason, UsedFeatures, UsedLocales,
};
use support::loaded_image::{LoadedImage, MemoryByte};
use support::toy_executable::{
    ALL_TARGETS, NEVER_REMOVED_BYTES, Target, ToyLayout, build_executable, layout_of, pattern_byte,
};
use support::toy_table::{
    ABORTING_GUARD, RECOVERABLE_GUARD, REFERENCE, ToyIcuPackage, ToyRange, ToyTable, encode_table,
    find_icu_item, icu_package,
};

const STATE_IS_TRIMMED_OFFSET: usize = 8;
const STATE_RANGE_COUNT_OFFSET: usize = 12;
const STATE_RANGES_OFFSET_OFFSET: usize = 16;
const STATE_REMOVAL_OFFSET: usize = 24;
const REMOVED_RANGES_HEADER_BYTES: usize = 16;
const REMOVED_RANGE_BYTES: usize = 16;
const ICU_ITEM_NAMES: [&str; 6] = ["a.res", "b.res", "c.res", "d.res", "e.res", "f.res"];
const ICU_ITEM_BYTES: usize = 0x2_0000;
const ICU_HEAD_BYTES: u64 = 128;
const ICU_PACKAGE_OFFSET: u64 = 0x2_0000;
const ICU_TOMBSTONE: [u8; 16] = *b"BUNICUREMOVED\0\0\0";
const ICU_LANGUAGES: [(&str, u16); 3] = [("de", 0), ("nb", 1), ("no", 1)];
const GERMAN_RUN_GROUP: u16 = 1;
const NORWEGIAN_RUN_GROUP: u16 = 2;
const ELF_SECTION_HEADER_BYTES: u64 = 64;
const LARGE_RANGE_BYTES: u64 = 0x10_0000;
const UNFILLABLE_RANGE_BYTES: u64 = 0x8_0000;
const ALLOWED_RANGE_BYTES: u64 = 0x8_0000;
const RAGGED_RANGE_OFFSET: u64 = 0x2_0010;
const RANDOM_CASES_PER_TARGET: u64 = 8;
const ELF_X86_64: Target = Target {
    format: ExecutableFormat::Elf,
    architecture: Architecture::X86_64,
};
const PE_X86_64: Target = Target {
    format: ExecutableFormat::Pe,
    architecture: Architecture::X86_64,
};
const ALWAYS_ENTERED: [Feature; 4] = [
    Feature::Bunfig,
    Feature::CliOptions,
    Feature::CrashReport,
    Feature::Profilers,
];

fn image_over(bytes: &[u8]) -> impl FnMut(usize, &mut [u8]) -> bool {
    move |offset, out| read_bytes_at(bytes, offset, out)
}

fn compute_plan(
    used: &UsedFeatures,
    request: &TrimRequest,
    file: &[u8],
) -> Result<TrimPlan, TrimError> {
    let mut read = image_over(file);
    let settings = ExecutableSettings::default();
    let input = TrimInput {
        used,
        settings: &settings,
        request,
    };
    bun_trim::plan(
        &input,
        &mut Image {
            len: file.len(),
            read: &mut read,
        },
    )
}

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

fn chosen_features() -> [Feature; 5] {
    let features: Vec<Feature> = Feature::ALL
        .iter()
        .copied()
        .filter(|feature| {
            feature.entered_from() == EnteredFrom::Program && !ALWAYS_ENTERED.contains(feature)
        })
        .take(5)
        .collect();
    features
        .try_into()
        .expect("the program enters five features that can be unused")
}

fn sets_of(f: [Feature; 5]) -> Vec<Vec<Feature>> {
    vec![
        vec![f[0]],
        vec![f[1]],
        vec![f[2]],
        vec![f[0], f[1]],
        vec![f[1], f[2], f[3]],
        vec![f[4]],
    ]
}

fn create_table(ranges: Vec<ToyRange>) -> ToyTable {
    ToyTable {
        features_hash: FEATURES_HASH,
        edges: Vec::new(),
        sets: sets_of(chosen_features()),
        ranges,
        icu_packages: Vec::new(),
        languages: Vec::new(),
    }
}

fn removing_unused() -> TrimRequest {
    TrimRequest {
        removes_unused: true,
        ..TrimRequest::default()
    }
}

fn removing(features: &[Feature]) -> TrimRequest {
    TrimRequest {
        remove_internal: features.to_vec(),
        ..TrimRequest::default()
    }
}

fn public_names_of(features: &[Feature]) -> Vec<TrimFeature> {
    features
        .iter()
        .filter_map(|feature| feature.narrowest_trim_feature())
        .collect()
}

fn nothing_used() -> UsedFeatures {
    UsedFeatures::from_features(&[])
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("four bytes"))
}

fn fill_byte(architecture: Architecture, is_code: bool, address: u64) -> u8 {
    match (is_code, architecture) {
        (false, _) => 0,
        (true, Architecture::X86_64) => 0xcc,
        (true, Architecture::Aarch64) => [0x00, 0x00, 0x20, 0xd4][(address & 3) as usize],
    }
}

struct Trimmed {
    before: Vec<u8>,
    after: Vec<u8>,
    plan: TrimPlan,
    summary: TrimSummary,
}

fn trim(label: &str, before: Vec<u8>, used: &UsedFeatures, request: &TrimRequest) -> Trimmed {
    let plan = compute_plan(used, request, &before)
        .unwrap_or_else(|error| panic!("{label}: plan failed on the toy executable: {error:?}"));
    let mut after = before.clone();
    let summary = bun_trim::apply(&mut after, &plan)
        .unwrap_or_else(|error| panic!("{label}: apply failed on the toy executable: {error:?}"));
    Trimmed {
        before,
        after,
        plan,
        summary,
    }
}

fn subtract_ranges(interval: AddressRange, excluded: &[AddressRange]) -> Vec<AddressRange> {
    let mut parts = Vec::new();
    let mut start = interval.start;
    for range in excluded {
        if range.end <= start || range.start >= interval.end {
            continue;
        }
        if start < range.start {
            parts.push(AddressRange {
                start,
                end: range.start,
            });
        }
        start = range.end;
    }
    if start < interval.end {
        parts.push(AddressRange {
            start,
            end: interval.end,
        });
    }
    parts
}

struct TrimmedCheck<'a> {
    label: &'a str,
    layout: &'a ToyLayout,
    table: &'a ToyTable,
    trimmed: &'a Trimmed,
    unwanted_run_groups: &'a [u16],
    removed: FeatureSet,
    old: LoadedImage,
    new: LoadedImage,
}

fn check_trimmed(
    label: &str,
    layout: &ToyLayout,
    table: &ToyTable,
    trimmed: &Trimmed,
    unwanted_run_groups: &[u16],
) {
    println!("{label}");
    let check = TrimmedCheck {
        label,
        layout,
        table,
        trimmed,
        unwanted_run_groups,
        removed: trimmed.plan.removed(),
        old: LoadedImage::load(&trimmed.before),
        new: LoadedImage::load(&trimmed.after),
    };
    check.check_stable_bytes();
    check.check_removed_bytes();
    check.check_image_identity();
    check.check_zero_filled_memory();
    let state = check.check_state();
    check.check_removed_range_list(&state);
    check.check_summary();
    check.check_second_runs();
}

impl TrimmedCheck<'_> {
    fn is_set_removed(&self, set: u16) -> bool {
        self.table.sets[set as usize]
            .iter()
            .all(|feature| self.removed.contains(*feature))
    }

    fn removed_ranges(&self) -> impl Iterator<Item = &ToyRange> {
        self.table
            .ranges
            .iter()
            .filter(|range| self.is_set_removed(range.set))
    }

    fn check_stable_bytes(&self) {
        let mut excluded: Vec<AddressRange> =
            self.removed_ranges().map(|range| range.range).collect();
        excluded.extend(self.table.icu_packages.iter().map(|package| package.range));
        excluded.sort_by_key(|range| range.start);
        for stable in &self.layout.stable {
            for interval in subtract_ranges(*stable, &excluded) {
                self.check_interval_unchanged(interval);
            }
        }
    }

    fn check_interval_unchanged(&self, interval: AddressRange) {
        let old_bytes = self.old.bytes(interval);
        if old_bytes.is_some() && old_bytes == self.new.bytes(interval) {
            return;
        }
        let address = (interval.start..interval.end)
            .find(|address| {
                let byte = self.new.byte_at(*address);
                byte != self.old.byte_at(*address) || !matches!(byte, MemoryByte::Mapped(_))
            })
            .unwrap_or(interval.start);
        panic!(
            "{}: retained address {address:#x} is {:?}, was {:?}",
            self.label,
            self.new.byte_at(address),
            self.old.byte_at(address)
        );
    }

    fn check_removed_bytes(&self) {
        for range in self.removed_ranges() {
            if range.can_be_filled {
                self.check_cut_or_filled(range);
            } else {
                self.check_cut_or_unchanged(range);
            }
        }
    }

    fn check_cut_or_filled(&self, range: &ToyRange) {
        let architecture = self.layout.target.architecture;
        let addresses = range.range.start..range.range.end;
        if let Some(bytes) = self.new.bytes(range.range) {
            for (address, byte) in addresses.zip(bytes) {
                let fill = fill_byte(architecture, range.is_code, address);
                assert!(
                    byte == fill,
                    "{}: {address:#x} holds {byte:#x}, not fill {fill:#x}",
                    self.label
                );
            }
            return;
        }
        for address in addresses {
            let byte = self.new.byte_at(address);
            let fill = fill_byte(architecture, range.is_code, address);
            assert!(
                matches!(byte, MemoryByte::Unmapped | MemoryByte::NoAccess)
                    || byte == MemoryByte::Mapped(fill),
                "{}: removed address {address:#x} is {byte:?}",
                self.label
            );
        }
    }

    fn check_cut_or_unchanged(&self, range: &ToyRange) {
        let new_bytes = self.new.bytes(range.range);
        if new_bytes.is_some() && new_bytes == self.old.bytes(range.range) {
            return;
        }
        for address in range.range.start..range.range.end {
            let byte = self.new.byte_at(address);
            let old_byte = self.old.byte_at(address);
            assert!(
                matches!(byte, MemoryByte::Unmapped | MemoryByte::NoAccess) || byte == old_byte,
                "{}: {address:#x} cannot be filled, but is {byte:?}, was {old_byte:?}",
                self.label
            );
        }
    }

    fn cut_or_filled_bytes(&self, range: &ToyRange) -> u64 {
        if range.can_be_filled {
            return range.range.len();
        }
        let is_cut = |address: &u64| !matches!(self.new.byte_at(*address), MemoryByte::Mapped(_));
        (range.range.start..range.range.end).filter(is_cut).count() as u64
    }

    fn check_image_identity(&self) {
        let label = self.label;
        assert!(
            self.new.entry_point == self.old.entry_point,
            "{label}: the entry point moved"
        );
        assert!(
            self.new.identity == self.old.identity,
            "{label}: the identity changed"
        );
    }

    fn check_zero_filled_memory(&self) {
        let label = self.label;
        let zero_filled = self
            .new
            .bytes(self.layout.zero_filled)
            .unwrap_or_else(|| panic!("{label}: zero-filled memory is not mapped"));
        let position = zero_filled.iter().position(|byte| *byte != 0);
        assert!(
            position.is_none(),
            "{label}: zero-filled memory is not zero at index {position:?}"
        );
    }

    fn check_state(&self) -> Vec<u8> {
        let label = self.label;
        let state = self
            .new
            .bytes(self.layout.state)
            .unwrap_or_else(|| panic!("{label}: the state is not mapped"));
        assert!(
            state[..8] == RemovableFeatureState::MAGIC,
            "{label}: the state lost its magic"
        );
        assert!(
            u32_at(&state, STATE_IS_TRIMMED_OFFSET) == 1,
            "{label}: the state is not trimmed"
        );
        let mut expected = vec![0u8; Feature::INDEX_LIMIT];
        for feature in Feature::ALL {
            expected[feature.index() as usize] = self.trimmed.plan.removal_of(*feature) as u8;
        }
        assert!(
            state[STATE_REMOVAL_OFFSET..] == expected[..],
            "{label}: wrong removal bytes"
        );
        state
    }

    fn check_removed_range_list(&self, state: &[u8]) {
        let label = self.label;
        let section = self
            .new
            .bytes(self.layout.table)
            .unwrap_or_else(|| panic!("{label}: the table section is not mapped"));
        assert!(
            section[..8] == TRIMMED_MAGIC,
            "{label}: the table section lost its magic"
        );
        assert!(
            u32_at(&section, 8) == TABLE_VERSION,
            "{label}: wrong version of the removed ranges"
        );
        let count = u32_at(&section, 12) as usize;
        let state_count = u32_at(state, STATE_RANGE_COUNT_OFFSET) as usize;
        assert!(
            count == state_count,
            "{label}: {count} removed ranges, the state says {state_count}"
        );
        let ranges_offset = i64::from_le_bytes(
            state[STATE_RANGES_OFFSET_OFFSET..STATE_RANGES_OFFSET_OFFSET + 8]
                .try_into()
                .expect("eight bytes"),
        );
        let expected_offset = (self.layout.table.start + REMOVED_RANGES_HEADER_BYTES as u64) as i64
            - self.layout.state.start as i64;
        assert!(
            count == 0 || ranges_offset == expected_offset,
            "{label}: wrong offset {ranges_offset:#x}"
        );
        let records = decode_removed_ranges(&section, count);
        for range in &self.table.ranges {
            self.check_range_lookup(range, &records);
        }
    }

    fn check_range_lookup(&self, range: &ToyRange, records: &[RemovedRange]) {
        let is_removed = self.is_set_removed(range.set);
        let set = &self.table.sets[range.set as usize];
        for address in [range.range.start, range.range.end - 1] {
            let found =
                find_removed_range(records, address as i64 - self.layout.state.start as i64);
            if is_removed {
                let feature = found.and_then(Feature::from_index);
                assert!(
                    feature.is_some_and(|feature| set.contains(&feature)),
                    "{}: {address:#x} is reported as {feature:?}, not a member of {set:?}",
                    self.label
                );
            } else {
                assert!(
                    found.is_none(),
                    "{}: {address:#x} is reported as removed",
                    self.label
                );
            }
        }
    }

    fn icu_dead_bytes(&self) -> u64 {
        let mut dead_bytes = 0;
        for package in &self.table.icu_packages {
            let mut tombstoned_end = None;
            for (first_item, item_count, set, group) in &package.runs {
                let run_bytes = u64::from(*item_count) * ICU_ITEM_BYTES as u64;
                if self.is_set_removed(*set) {
                    dead_bytes += run_bytes;
                } else if self.unwanted_run_groups.contains(group) {
                    let has_own_tombstone = tombstoned_end != Some(*first_item);
                    let retained_bytes = if has_own_tombstone {
                        ICU_TOMBSTONE.len() as u64
                    } else {
                        0
                    };
                    dead_bytes += run_bytes - retained_bytes;
                    tombstoned_end = Some(first_item + item_count);
                }
            }
        }
        dead_bytes
    }

    fn check_summary(&self) {
        let label = self.label;
        let summary = &self.trimmed.summary;
        let range_bytes: u64 = self
            .removed_ranges()
            .map(|range| self.cut_or_filled_bytes(range))
            .sum();
        let expected_bytes = range_bytes + self.icu_dead_bytes();
        assert!(
            summary.removed_bytes() == expected_bytes,
            "{label}: removed_bytes is {:#x}, not {expected_bytes:#x}",
            summary.removed_bytes()
        );
        assert!(
            summary.removed == self.removed,
            "{label}: the summary lists other features than the plan"
        );
        let saved = (self.trimmed.before.len() - self.trimmed.after.len()) as u64;
        assert!(
            summary.file_bytes_saved == saved,
            "{label}: the file shrank by {saved:#x}"
        );
        assert!(
            summary.format == Some(self.layout.target.format),
            "{label}: wrong format"
        );
    }

    fn check_second_runs(&self) {
        let label = self.label;
        let plan = &self.trimmed.plan;
        let again = bun_trim::apply(&mut self.trimmed.after.clone(), plan);
        assert!(
            matches!(
                again,
                Err(TrimError::Unsupported(UnsupportedReason::AlreadyTrimmed))
            ),
            "{label}: apply on its own output is {again:?}"
        );
        let planned = compute_plan(&nothing_used(), &removing_unused(), &self.trimmed.after);
        assert!(
            matches!(
                planned,
                Err(TrimError::Unsupported(UnsupportedReason::AlreadyTrimmed))
            ),
            "{label}: plan on a trimmed executable is {planned:?}"
        );
        let mut repeated = self.trimmed.before.clone();
        bun_trim::apply(&mut repeated, plan)
            .unwrap_or_else(|error| panic!("{label}: the second apply failed: {error:?}"));
        assert!(
            repeated == self.trimmed.after,
            "{label}: a second run gave other bytes"
        );
    }
}

fn decode_removed_ranges(section: &[u8], count: usize) -> Vec<RemovedRange> {
    section[REMOVED_RANGES_HEADER_BYTES..REMOVED_RANGES_HEADER_BYTES + count * REMOVED_RANGE_BYTES]
        .chunks_exact(REMOVED_RANGE_BYTES)
        .map(|record| RemovedRange {
            start: i64::from_le_bytes(record[..8].try_into().expect("eight bytes")),
            size: u32_at(record, 8),
            feature: u16::from_le_bytes([record[12], record[13]]),
            reserved: u16::from_le_bytes([record[14], record[15]]),
        })
        .collect()
}

fn close_over_followed_edges(table: &ToyTable, seed: FeatureSet) -> FeatureSet {
    let mut retained = seed;
    loop {
        let previous = retained;
        for (from, to, _, is_followed) in &table.edges {
            if *is_followed && retained.contains(*from) {
                retained.insert(*to);
            }
        }
        if retained == previous {
            return retained;
        }
    }
}

fn features_opened_by(cause: UnseenCodeCause) -> FeatureSet {
    use UnseenCodeCause::{
        EvaluatesText, FlowGaveUp, LoadsCodeByName, LoadsModuleByName, RunsUnseenCode,
    };

    let program_features = Feature::all_entered_from(EnteredFrom::Program);
    let outside_language = [Feature::WebAssembly, Feature::Inspector, Feature::Profilers];
    let only_when_named = bun_trim::features_kept_only_when_named();
    match cause {
        LoadsModuleByName => FeatureSet::from_features(&[Feature::DataFileLoaders]),
        LoadsCodeByName => {
            let mut features = features_opened_by(EvaluatesText);
            features.union_with(&FeatureSet::from_features(&[
                Feature::DataFileLoaders,
                Feature::RuntimeTranspiler,
                Feature::Interpreter,
                Feature::BuiltinSourceText,
            ]));
            features
        }
        FlowGaveUp | EvaluatesText | RunsUnseenCode => program_features
            .iter()
            .filter(|feature| {
                let is_added_for_cause = *feature == Feature::ProcessInformation
                    || (cause == RunsUnseenCode && *feature == Feature::NativeAddons);
                let has_to_be_named = cause != FlowGaveUp && only_when_named.contains(*feature);
                is_added_for_cause
                    || (feature.is_engine()
                        && !outside_language.contains(feature)
                        && !has_to_be_named)
            })
            .collect(),
        _ => program_features,
    }
}

fn check_plan(
    label: &str,
    table: &ToyTable,
    used: &UsedFeatures,
    request: &TrimRequest,
    plan: &TrimPlan,
) {
    let mut seed: FeatureSet = used
        .features
        .iter()
        .map(|used| used.feature)
        .chain(ALWAYS_ENTERED)
        .collect();
    for name in &request.allow {
        seed.union_with(&name.features());
    }
    for unseen in &used.causes {
        seed.union_with(&features_opened_by(unseen.cause));
    }
    if used.has_cause(UnseenCodeCause::ProgramNotCompiled) {
        seed.insert(Feature::Jit);
    }
    let is_compiled = !used.has_cause(UnseenCodeCause::ProgramNotCompiled);
    if !request.removes_unused {
        if seed.contains(Feature::Bundler) {
            seed.union_with(&FeatureSet::from_features(&[
                Feature::Check,
                Feature::AotCompiler,
                Feature::ImageCompiler,
                Feature::Jit,
            ]));
        }
        let mut entered_by_programs = FeatureSet::all();
        entered_by_programs.subtract(&Feature::all_outside_compiled_programs());
        seed.union_with(&entered_by_programs);
    }
    let retained = close_over_followed_edges(table, seed);
    for feature in Feature::ALL.iter().copied() {
        let is_forced = request.remove_internal.contains(&feature);
        let is_unused = (request.removes_unused || is_compiled) && !retained.contains(feature);
        let expected = if is_forced || is_unused {
            Removal::Unused
        } else {
            Removal::Present
        };
        let removal = plan.removal_of(feature);
        assert!(
            removal == expected,
            "{label}: {feature:?} is {removal:?}, not {expected:?}"
        );
    }
}

fn append_random_ranges(
    random: &mut Random,
    region: AddressRange,
    is_code: bool,
    ranges: &mut Vec<ToyRange>,
) {
    let mut start = region.start + NEVER_REMOVED_BYTES;
    while start < region.end {
        let length = match random.next() % 4 {
            0 => 16 * (1 + random.next() % 256),
            1 => 0x1000 * (1 + random.next() % 16),
            _ => 0x1_0000 * (2 + random.next() % 9),
        };
        let end = (start + length).min(region.end);
        if random.next() % 5 >= 2 {
            let set = (random.next() % 6) as u16;
            let can_be_cut = random.next() % 4 != 0;
            let can_be_filled = !can_be_cut || random.next() % 4 != 0;
            ranges.push(ToyRange {
                range: AddressRange { start, end },
                set,
                is_code,
                can_be_cut,
                can_be_filled,
            });
        }
        start = end;
    }
}

fn random_table(random: &mut Random, layout: &ToyLayout, f: [Feature; 5]) -> ToyTable {
    let mut ranges = Vec::new();
    append_random_ranges(random, layout.code, true, &mut ranges);
    append_random_ranges(random, layout.read_only_data, false, &mut ranges);
    ranges.sort_by_key(|range| range.range.start);
    let bits = random.next();
    let has_bit = |index: usize| (bits >> index) & 1 != 0;
    let edges = [
        (f[0], f[1], REFERENCE, true),
        (f[3], f[4], ABORTING_GUARD, has_bit(3)),
        (f[4], f[2], RECOVERABLE_GUARD, has_bit(4)),
    ]
    .into_iter()
    .enumerate()
    .filter(|(index, _)| has_bit(*index))
    .map(|(_, edge)| edge)
    .collect();
    ToyTable {
        edges,
        ..create_table(ranges)
    }
}

fn random_used(random: &mut Random, case: u64, f: [Feature; 5]) -> UsedFeatures {
    let bits = random.next();
    let features = f
        .iter()
        .enumerate()
        .filter(|(index, _)| (bits >> index) & 1 != 0)
        .map(|(_, feature)| *feature);
    let used = UsedFeatures::from_features(&features.collect::<Vec<Feature>>());
    if case % 4 != 3 {
        return used;
    }
    let cause = UnseenCodeCause::ALL[(bits >> f.len()) as usize % UnseenCodeCause::ALL.len()];
    UsedFeatures {
        features: used.features,
        ..UsedFeatures::with_cause(cause)
    }
}

fn random_request(case: u64, f: [Feature; 5]) -> TrimRequest {
    let allow = if case % 4 >= 2 {
        public_names_of(&[f[1], f[2]])
    } else {
        Vec::new()
    };
    let request = match case % 3 {
        0 => removing_unused(),
        1 => TrimRequest {
            remove_internal: vec![f[1]],
            ..removing_unused()
        },
        _ => removing(&[f[0], f[1]]),
    };
    TrimRequest { allow, ..request }
}

#[test]
fn random_tables_on_every_target() {
    let f = chosen_features();
    for (target_index, target) in ALL_TARGETS.iter().enumerate() {
        let layout = layout_of(*target);
        for case in 0..RANDOM_CASES_PER_TARGET {
            let label = format!("{target:?} case {case}");
            let mut random = Random(1 + target_index as u64 * 100 + case);
            let table = random_table(&mut random, &layout, f);
            let used = random_used(&mut random, case, f);
            let request = random_request(case, f);
            let before = build_executable(&layout, Some(&encode_table(&table)), &[]);
            let trimmed = trim(&label, before, &used, &request);
            check_plan(&label, &table, &used, &request, &trimmed.plan);
            check_trimmed(&label, &layout, &table, &trimmed, &[]);
        }
    }
}

fn removable_code(range: AddressRange, set: u16) -> ToyRange {
    ToyRange {
        range,
        set,
        is_code: true,
        can_be_cut: true,
        can_be_filled: true,
    }
}

#[test]
fn allowed_name_keeps_bytes_nothing_uses() {
    let f = chosen_features();
    let name = f[0]
        .narrowest_trim_feature()
        .expect("the first chosen feature has a public name");
    assert!(
        !name.features().contains(f[4]),
        "{} also names {:?}",
        name.name(),
        f[4]
    );
    let request = TrimRequest {
        allow: vec![name],
        ..removing_unused()
    };
    for target in ALL_TARGETS {
        let label = format!("{target:?} allowing {}", name.name());
        let layout = layout_of(target);
        let start = layout.code.start + RAGGED_RANGE_OFFSET;
        let allowed = AddressRange {
            start,
            end: start + ALLOWED_RANGE_BYTES,
        };
        let unused = AddressRange {
            start: allowed.end,
            end: allowed.end + ALLOWED_RANGE_BYTES,
        };
        let table = create_table(vec![removable_code(allowed, 0), removable_code(unused, 5)]);
        let before = build_executable(&layout, Some(&encode_table(&table)), &[]);
        let trimmed = trim(&label, before, &nothing_used(), &request);
        check_plan(&label, &table, &nothing_used(), &request, &trimmed.plan);
        check_trimmed(&label, &layout, &table, &trimmed, &[]);
        assert!(
            trimmed.plan.removal_of(f[0]) == Removal::Present,
            "{label}: {:?} was removed",
            f[0]
        );
        assert!(
            trimmed.plan.removal_of(f[4]) == Removal::Unused,
            "{label}: {:?} stayed",
            f[4]
        );
        assert!(
            trimmed.summary.removed_bytes() == unused.len(),
            "{label}: removed_bytes is {:#x}, the unused range has {:#x}",
            trimmed.summary.removed_bytes(),
            unused.len()
        );
    }
}

struct IcuToy {
    layout: ToyLayout,
    table: ToyTable,
    package: Vec<u8>,
    range: AddressRange,
}

fn create_icu_toy(
    target: Target,
    runs: Vec<(u32, u32, u16, u16)>,
    languages: Vec<(&'static str, u16)>,
) -> IcuToy {
    let layout = layout_of(target);
    let package = icu_package(&ICU_ITEM_NAMES.map(|name| (name, ICU_ITEM_BYTES)));
    let start = layout.read_only_data.start + ICU_PACKAGE_OFFSET;
    let range = AddressRange {
        start,
        end: start + package.len() as u64,
    };
    let icu_packages = vec![ToyIcuPackage { range, runs }];
    let table = ToyTable {
        icu_packages,
        languages,
        ..create_table(Vec::new())
    };
    IcuToy {
        layout,
        table,
        package,
        range,
    }
}

impl IcuToy {
    fn trim(
        &self,
        label: &str,
        used: &UsedFeatures,
        request: &TrimRequest,
        unwanted_run_groups: &[u16],
    ) -> Trimmed {
        let overlays = [(self.range.start, self.package.as_slice())];
        let before = build_executable(&self.layout, Some(&encode_table(&self.table)), &overlays);
        let trimmed = trim(label, before, used, request);
        check_trimmed(
            label,
            &self.layout,
            &self.table,
            &trimmed,
            unwanted_run_groups,
        );
        trimmed
    }
}

fn trim_icu_package(
    target: Target,
    forced: Feature,
) -> (ToyLayout, Vec<u8>, AddressRange, Trimmed) {
    let label = format!("{target:?} without {forced:?}");
    let toy = create_icu_toy(target, vec![(1, 2, 0, 0), (4, 1, 1, 0)], Vec::new());
    let trimmed = toy.trim(&label, &nothing_used(), &removing(&[forced]), &[]);
    (toy.layout, toy.package, toy.range, trimmed)
}

#[test]
fn icu_items_follow_feature_removal() {
    let f = chosen_features();
    for target in [ELF_X86_64, PE_X86_64] {
        let (layout, package, range, trimmed) = trim_icu_package(target, f[0]);
        let new = LoadedImage::load(&trimmed.after);
        let head_range = AddressRange {
            start: range.start,
            end: range.start + ICU_HEAD_BYTES,
        };
        let head = new
            .bytes(head_range)
            .unwrap_or_else(|| panic!("{target:?}: the table of contents is not mapped"));
        for (index, name) in ICU_ITEM_NAMES.iter().enumerate() {
            let old_offset = find_icu_item(&package, name).expect("the toy package has the item");
            let item_start = range.start + old_offset as u64;
            let item_end = item_start + ICU_ITEM_BYTES as u64;
            if index == 1 || index == 2 {
                assert!(
                    find_icu_item(&head, name).is_none(),
                    "{target:?}: {name} is still listed"
                );
                for address in item_start..item_end {
                    let byte = new.byte_at(address);
                    assert!(
                        !matches!(byte, MemoryByte::Mapped(value) if value != 0),
                        "{target:?}: {address:#x} of {name} is {byte:?}"
                    );
                }
                continue;
            }
            assert!(
                find_icu_item(&head, name) == Some(old_offset),
                "{target:?}: {name} moved"
            );
            let fill = MemoryByte::Mapped(0x40 + index as u8);
            assert!(
                new.byte_at(item_start) == fill,
                "{target:?}: first byte of {name} changed"
            );
            assert!(
                new.byte_at(item_end - 1) == fill,
                "{target:?}: last byte of {name} changed"
            );
        }
        let dead_bytes = 2 * ICU_ITEM_BYTES as u64;
        assert!(
            trimmed.summary.removed_bytes() == dead_bytes,
            "{target:?}: wrong removed_bytes"
        );
        assert!(
            trimmed.summary.file_bytes_saved >= dead_bytes - 2 * layout.cut_alignment,
            "{target:?}: the dead items stayed in the file"
        );

        let (_, package, range, trimmed) = trim_icu_package(target, f[2]);
        let head_range = AddressRange {
            start: range.start,
            end: range.start + ICU_HEAD_BYTES,
        };
        let head = LoadedImage::load(&trimmed.after)
            .bytes(head_range)
            .unwrap_or_else(|| panic!("{target:?}: the table of contents is not mapped"));
        for name in ICU_ITEM_NAMES {
            assert!(
                find_icu_item(&head, name) == find_icu_item(&package, name),
                "{target:?}: {name} moved"
            );
        }
        assert!(
            trimmed.summary.removed_bytes() == 0,
            "{target:?}: an unrelated feature removed items"
        );
    }
}

#[derive(Copy, Clone)]
enum IcuItem {
    Retained,
    Tombstoned,
    Removed,
}

fn check_dead_bytes(label: &str, image: &LoadedImage, range: AddressRange) {
    for address in range.start..range.end {
        let byte = image.byte_at(address);
        assert!(
            !matches!(byte, MemoryByte::Mapped(value) if value != 0),
            "{label}: dead {address:#x} is {byte:?}"
        );
    }
}

fn check_icu_items(label: &str, toy: &IcuToy, trimmed: &Trimmed, expected: [IcuItem; 6]) {
    let new = LoadedImage::load(&trimmed.after);
    let head_range = AddressRange {
        start: toy.range.start,
        end: toy.range.start + ICU_HEAD_BYTES,
    };
    let head = new
        .bytes(head_range)
        .unwrap_or_else(|| panic!("{label}: the table of contents is not mapped"));
    for (index, (name, item)) in ICU_ITEM_NAMES.iter().zip(expected).enumerate() {
        let old_offset = find_icu_item(&toy.package, name).expect("the toy package has the item");
        let start = toy.range.start + old_offset as u64;
        let end = start + ICU_ITEM_BYTES as u64;
        let listed_offset = find_icu_item(&head, name);
        match item {
            IcuItem::Retained => {
                let fill = MemoryByte::Mapped(0x40 + index as u8);
                assert!(listed_offset == Some(old_offset), "{label}: {name} moved");
                assert!(
                    new.byte_at(start) == fill,
                    "{label}: first byte of {name} changed"
                );
                assert!(
                    new.byte_at(end - 1) == fill,
                    "{label}: last byte of {name} changed"
                );
            }
            IcuItem::Tombstoned => {
                let tombstone_end = start + ICU_TOMBSTONE.len() as u64;
                let tombstone = new.bytes(AddressRange {
                    start,
                    end: tombstone_end,
                });
                assert!(
                    listed_offset == Some(old_offset),
                    "{label}: {name} is not listed at its tombstone"
                );
                assert!(
                    tombstone.as_deref() == Some(&ICU_TOMBSTONE[..]),
                    "{label}: {name} starts with {tombstone:x?}"
                );
                check_dead_bytes(
                    label,
                    &new,
                    AddressRange {
                        start: tombstone_end,
                        end,
                    },
                );
            }
            IcuItem::Removed => {
                assert!(listed_offset.is_none(), "{label}: {name} is still listed");
                check_dead_bytes(label, &new, AddressRange { start, end });
            }
        }
    }
}

#[test]
fn icu_items_follow_wanted_languages() {
    use IcuItem::{Removed, Retained, Tombstoned};

    let f = chosen_features();
    let runs = vec![
        (0, 1, 0, GERMAN_RUN_GROUP),
        (1, 1, 0, NORWEGIAN_RUN_GROUP),
        (2, 1, 0, 0),
        (3, 1, 1, GERMAN_RUN_GROUP),
        (4, 1, 2, NORWEGIAN_RUN_GROUP),
        (5, 1, 2, GERMAN_RUN_GROUP),
    ];
    let used = UsedFeatures::from_features(&[f[0], f[1]]);
    let norwegian = LocaleTag(Box::from(&b"no-NO"[..]));
    let used_in_norwegian = UsedFeatures {
        locales: UsedLocales::Listed(vec![norwegian]),
        ..used.clone()
    };
    let requesting_norwegian = TrimRequest {
        locales: Some(vec![Box::from(&b"nb"[..])]),
        ..removing_unused()
    };
    let without_german = [Tombstoned, Retained, Retained, Tombstoned, Removed, Removed];
    let every_language = [Retained, Retained, Retained, Retained, Removed, Removed];
    let cases: [(&str, &UsedFeatures, TrimRequest, &[u16], [IcuItem; 6]); 4] = [
        (
            "used in Norwegian",
            &used_in_norwegian,
            removing_unused(),
            &[GERMAN_RUN_GROUP],
            without_german,
        ),
        (
            "with Norwegian requested",
            &used,
            requesting_norwegian,
            &[GERMAN_RUN_GROUP],
            without_german,
        ),
        (
            "used in unknown locales",
            &used,
            removing_unused(),
            &[],
            every_language,
        ),
        (
            "without one feature only",
            &used_in_norwegian,
            removing(&[f[2]]),
            &[],
            every_language,
        ),
    ];
    for target in ALL_TARGETS {
        let toy = create_icu_toy(target, runs.clone(), ICU_LANGUAGES.to_vec());
        for (name, used, request, unwanted_run_groups, expected) in &cases {
            let label = format!("{target:?} {name}");
            let trimmed = toy.trim(&label, used, request, unwanted_run_groups);
            check_icu_items(&label, &toy, &trimmed, *expected);
            let summary = &trimmed.summary;
            assert!(
                summary.file_bytes_saved + 4 * toy.layout.cut_alignment >= summary.removed_bytes(),
                "{label}: the dead items stayed in the file"
            );
        }
    }
}

fn trim_one_range(layout: &ToyLayout, range: ToyRange) -> Trimmed {
    let label = format!("{:?} {range:x?}", layout.target);
    let f = chosen_features();
    let table = create_table(vec![range]);
    let before = build_executable(layout, Some(&encode_table(&table)), &[]);
    let trimmed = trim(&label, before, &nothing_used(), &removing(&[f[0]]));
    check_trimmed(&label, layout, &table, &trimmed, &[]);
    trimmed
}

fn trim_one_code_range(layout: &ToyLayout, range: AddressRange, can_be_cut: bool) -> Trimmed {
    trim_one_range(
        layout,
        ToyRange {
            range,
            set: 0,
            is_code: true,
            can_be_cut,
            can_be_filled: true,
        },
    )
}

fn trim_one_unfillable_range(layout: &ToyLayout, range: AddressRange) -> Trimmed {
    trim_one_range(
        layout,
        ToyRange {
            range,
            set: 0,
            is_code: false,
            can_be_cut: true,
            can_be_filled: false,
        },
    )
}

fn assert_all_filled(layout: &ToyLayout, trimmed: &Trimmed, range: AddressRange) {
    let target = layout.target;
    assert!(
        trimmed.summary.file_bytes_saved == 0,
        "{target:?}: a range was cut"
    );
    assert!(
        trimmed.after.len() == trimmed.before.len(),
        "{target:?}: the file changed size"
    );
    let bytes = LoadedImage::load(&trimmed.after)
        .bytes(range)
        .unwrap_or_else(|| panic!("{target:?}: a filled range is not mapped"));
    for (address, byte) in (range.start..range.end).zip(bytes) {
        let fill = fill_byte(target.architecture, true, address);
        assert!(
            byte == fill,
            "{target:?}: {address:#x} holds {byte:#x}, not fill {fill:#x}"
        );
    }
}

fn assert_all_cut(layout: &ToyLayout, trimmed: &Trimmed, range: AddressRange) {
    let target = layout.target;
    let summary = &trimmed.summary;
    assert!(
        summary.cut_bytes == range.len(),
        "{target:?}: {:#x} bytes were cut",
        summary.cut_bytes
    );
    assert!(
        summary.filled_bytes == 0,
        "{target:?}: {:#x} bytes were filled",
        summary.filled_bytes
    );
    assert!(
        summary.uncut.is_none(),
        "{target:?}: {:?} stayed in the file",
        summary.uncut
    );
    assert!(
        summary.file_bytes_saved + ELF_SECTION_HEADER_BYTES >= range.len(),
        "{target:?}: only {:#x} bytes left the file",
        summary.file_bytes_saved
    );
    let new = LoadedImage::load(&trimmed.after);
    for address in [range.start, range.end - 1] {
        let byte = new.byte_at(address);
        assert!(
            !matches!(byte, MemoryByte::Mapped(_)),
            "{target:?}: cut address {address:#x} is {byte:?}"
        );
    }
}

#[test]
fn aligned_range_is_cut_ragged_range_is_filled() {
    for target in ALL_TARGETS {
        let layout = layout_of(target);
        let start = layout.code.start + RAGGED_RANGE_OFFSET;
        let range = AddressRange {
            start,
            end: start + LARGE_RANGE_BYTES,
        };

        let trimmed = trim_one_code_range(&layout, range, true);
        assert!(
            trimmed.summary.file_bytes_saved >= LARGE_RANGE_BYTES - 2 * layout.cut_alignment,
            "{target:?}: only {:#x} bytes left the file",
            trimmed.summary.file_bytes_saved
        );
        let new = LoadedImage::load(&trimmed.after);
        let middle = new.byte_at(start + LARGE_RANGE_BYTES / 2);
        assert!(
            !matches!(middle, MemoryByte::Mapped(_)),
            "{target:?}: the middle is {middle:?}"
        );
        let fill = MemoryByte::Mapped(fill_byte(target.architecture, true, start));
        assert!(
            new.byte_at(start) == fill,
            "{target:?}: the ragged start is not filled"
        );

        let trimmed = trim_one_code_range(&layout, range, false);
        assert_all_filled(&layout, &trimmed, range);

        let start =
            (layout.code.start + NEVER_REMOVED_BYTES).next_multiple_of(layout.cut_alignment);
        let aligned = AddressRange {
            start,
            end: start + layout.cut_alignment,
        };
        let trimmed = trim_one_code_range(&layout, aligned, true);
        assert_all_cut(&layout, &trimmed, aligned);

        let ragged = AddressRange {
            start: aligned.start + 16,
            end: aligned.end + 16,
        };
        let trimmed = trim_one_code_range(&layout, ragged, true);
        assert_all_filled(&layout, &trimmed, ragged);
    }
}

fn assert_unchanged(layout: &ToyLayout, trimmed: &Trimmed, range: AddressRange) {
    let target = layout.target;
    let old_bytes = LoadedImage::load(&trimmed.before).bytes(range);
    let new_bytes = LoadedImage::load(&trimmed.after).bytes(range);
    assert!(
        old_bytes.is_some() && old_bytes == new_bytes,
        "{target:?}: {:#x}..{:#x} cannot be filled, but changed",
        range.start,
        range.end
    );
}

#[test]
fn unfillable_range_is_cut_or_left_unchanged() {
    for target in ALL_TARGETS {
        let layout = layout_of(target);
        let start = layout.read_only_data.start + RAGGED_RANGE_OFFSET;
        let end = start + UNFILLABLE_RANGE_BYTES;
        let cut_start = start.next_multiple_of(layout.cut_alignment);
        let cut_end = end - end % layout.cut_alignment;

        let trimmed = trim_one_unfillable_range(&layout, AddressRange { start, end });
        let middle = LoadedImage::load(&trimmed.after).byte_at(start + UNFILLABLE_RANGE_BYTES / 2);
        assert!(
            !matches!(middle, MemoryByte::Mapped(_)),
            "{target:?}: the middle is {middle:?}"
        );
        assert_unchanged(
            &layout,
            &trimmed,
            AddressRange {
                start,
                end: cut_start,
            },
        );
        assert_unchanged(
            &layout,
            &trimmed,
            AddressRange {
                start: cut_end,
                end,
            },
        );
        assert!(
            trimmed.summary.removed_bytes() == cut_end - cut_start,
            "{target:?}: removed_bytes is {:#x}, the cut has {:#x}",
            trimmed.summary.removed_bytes(),
            cut_end - cut_start
        );

        let start = (layout.read_only_data.start + NEVER_REMOVED_BYTES)
            .next_multiple_of(layout.cut_alignment);
        let aligned = AddressRange {
            start,
            end: start + layout.cut_alignment,
        };
        let trimmed = trim_one_unfillable_range(&layout, aligned);
        assert_all_cut(&layout, &trimmed, aligned);

        let ragged = AddressRange {
            start: aligned.start + 16,
            end: aligned.end + 16,
        };
        let trimmed = trim_one_unfillable_range(&layout, ragged);
        assert_unchanged(&layout, &trimmed, ragged);
        assert!(
            trimmed.summary.removed_bytes() == 0,
            "{target:?}: bytes that stay are counted as removed"
        );
        assert!(
            trimmed.summary.file_bytes_saved == 0,
            "{target:?}: a range without a whole page was cut"
        );
    }
}

fn panicking_read(_offset: usize, _out: &mut [u8]) -> bool {
    panic!("a request that is not enabled reads nothing");
}

fn assert_untouched(label: &str, file: &[u8]) {
    let mut read = panicking_read;
    let mut image = Image {
        len: file.len(),
        read: &mut read,
    };
    let used = UsedFeatures::with_cause(UnseenCodeCause::ProgramNotCompiled);
    let (settings, request) = (ExecutableSettings::default(), TrimRequest::default());
    let input = TrimInput {
        used: &used,
        settings: &settings,
        request: &request,
    };
    let plan = bun_trim::plan(&input, &mut image).unwrap_or_else(|error| {
        panic!("{label}: plan failed on a request that is not enabled: {error:?}")
    });
    assert!(
        plan.is_empty(),
        "{label}: a request that is not enabled removes something"
    );
    let mut after = file.to_vec();
    bun_trim::apply(&mut after, &plan)
        .unwrap_or_else(|error| panic!("{label}: apply failed on an empty plan: {error:?}"));
    assert!(after == file, "{label}: an empty plan changed the bytes");
}

#[test]
fn default_request_changes_nothing() {
    for target in ALL_TARGETS {
        let layout = layout_of(target);
        assert_untouched(
            &format!("{target:?}"),
            &build_executable(&layout, None, &[]),
        );
    }
    assert_untouched("hello", b"hello");
}

fn assert_message(error: &TrimError, expected: &str) {
    let mut bytes = Vec::new();
    error.write_message(&mut bytes);
    let message = String::from_utf8(bytes).expect("trim messages are UTF-8 here");
    assert!(
        message == expected,
        "{error:?} says {message:?}, not {expected:?}"
    );
    match error {
        TrimError::Unsupported(_) => assert!(!message.contains("bug"), "{message}"),
        TrimError::Internal(_) => assert!(!message.contains("doesn't support"), "{message}"),
        TrimError::Request(_) => panic!("{error:?} is not a failure of this test"),
    }
}

fn plan_error(label: &str, file: &[u8]) -> TrimError {
    compute_plan(&nothing_used(), &removing_unused(), file)
        .err()
        .unwrap_or_else(|| panic!("{label}: plan succeeded"))
}

fn apply_error(layout: &ToyLayout, range: ToyRange) -> TrimError {
    let target = layout.target;
    let mut file = build_executable(layout, Some(&encode_table(&create_table(vec![range]))), &[]);
    let plan = compute_plan(&nothing_used(), &removing_unused(), &file).unwrap_or_else(|error| {
        panic!("{target:?}: plan failed on a well-formed table: {error:?}")
    });
    bun_trim::apply(&mut file, &plan)
        .err()
        .unwrap_or_else(|| panic!("{target:?}: apply succeeded on {range:?}"))
}

#[test]
fn untrimmable_input_reports_reason() {
    const NO_TABLE: &str = "this build of Bun doesn't support --trim (NoTrimTable)";
    const MALFORMED: &str =
        "--trim failed (MalformedTable). This is a bug in Bun, please report it";
    const DIRECTORY_MIDDLE_BYTES: usize = 64;

    for target in ALL_TARGETS {
        let layout = layout_of(target);
        let label = format!("{target:?}");
        let error = plan_error(&label, &build_executable(&layout, None, &[]));
        assert!(
            matches!(
                error,
                TrimError::Unsupported(UnsupportedReason::NoTrimTable)
            ),
            "{label}: {error:?}"
        );
        assert_message(&error, NO_TABLE);

        let error = plan_error(&label, &build_executable(&layout, Some(&[]), &[]));
        assert!(
            matches!(
                error,
                TrimError::Unsupported(UnsupportedReason::NoTrimTable)
            ),
            "{label}: {error:?}"
        );
        assert_message(&error, NO_TABLE);
    }

    let layout = layout_of(ELF_X86_64);
    let other_list = ToyTable {
        features_hash: FEATURES_HASH ^ 1,
        ..create_table(Vec::new())
    };
    let error = plan_error(
        "another feature list",
        &build_executable(&layout, Some(&encode_table(&other_list)), &[]),
    );
    assert!(
        matches!(
            error,
            TrimError::Unsupported(UnsupportedReason::FeatureListMismatch)
        ),
        "{error:?}"
    );
    assert_message(
        &error,
        "this build of Bun doesn't support --trim (FeatureListMismatch)",
    );

    let error = plan_error("hello, world", b"hello, world");
    assert!(
        matches!(
            error,
            TrimError::Unsupported(UnsupportedReason::UnrecognizedExecutable)
        ),
        "{error:?}"
    );
    assert_message(
        &error,
        "this build of Bun doesn't support --trim (UnrecognizedExecutable)",
    );

    let mut cut_off = encode_table(&create_table(Vec::new()));
    cut_off.truncate(DIRECTORY_MIDDLE_BYTES);
    let error = plan_error(
        "a truncated table",
        &build_executable(&layout, Some(&cut_off), &[]),
    );
    assert!(
        matches!(
            error,
            TrimError::Internal(TrimInternalError::MalformedTable)
        ),
        "{error:?}"
    );
    assert_message(&error, MALFORMED);

    let past_code = AddressRange {
        start: layout.code.end - 0x1000,
        end: layout.code.end + 16,
    };
    let range = ToyRange {
        range: past_code,
        set: 0,
        is_code: true,
        can_be_cut: false,
        can_be_filled: true,
    };
    let error = apply_error(&layout, range);
    assert!(
        matches!(
            error,
            TrimError::Internal(TrimInternalError::RangeOutsideImage)
        ),
        "{error:?}"
    );
    assert_message(
        &error,
        "--trim failed (RangeOutsideImage). This is a bug in Bun, please report it",
    );

    let range = ToyRange {
        range: layout.state,
        set: 0,
        is_code: false,
        can_be_cut: false,
        can_be_filled: true,
    };
    let error = apply_error(&layout, range);
    assert!(
        matches!(
            error,
            TrimError::Internal(TrimInternalError::MalformedTable)
        ),
        "{error:?}"
    );
    assert_message(&error, MALFORMED);
}

fn image_edges(format: ExecutableFormat) -> (u64, MemoryByte, u64) {
    match format {
        ExecutableFormat::Elf => (0x1f_ffff, MemoryByte::Unmapped, 0x51_5000),
        ExecutableFormat::MachO => (0xffff_ffff, MemoryByte::NoAccess, 0x1_0032_0000),
        ExecutableFormat::Pe => (0xfff, MemoryByte::Unmapped, 0x30_e000),
    }
}

#[test]
fn toy_executables_load() {
    for target in ALL_TARGETS {
        let layout = layout_of(target);
        let image = LoadedImage::load(&build_executable(&layout, None, &[]));
        for range in [layout.code, layout.read_only_data] {
            for address in [range.start, range.end - 1] {
                let byte = image.byte_at(address);
                assert!(
                    byte == MemoryByte::Mapped(pattern_byte(address)),
                    "{target:?}: {address:#x} is {byte:?}"
                );
            }
        }
        assert!(
            image.entry_point == layout.code.start,
            "{target:?}: wrong entry point"
        );
        let identity: &[u8] = match target.format {
            ExecutableFormat::Elf => &[0xb1; 20],
            ExecutableFormat::MachO => &[0xd1; 16],
            ExecutableFormat::Pe => &[],
        };
        assert!(
            image.identity == identity,
            "{target:?}: wrong identity {:x?}",
            image.identity
        );
        let (below, below_byte, past) = image_edges(target.format);
        assert!(
            image.byte_at(below) == below_byte,
            "{target:?}: {below:#x} is {:?}",
            image.byte_at(below)
        );
        assert!(
            image.byte_at(past) == MemoryByte::Unmapped,
            "{target:?}: {past:#x} is mapped"
        );
    }
}

#[test]
#[should_panic(expected = "differ modulo the page size")]
fn segment_whose_offset_and_address_disagree_does_not_load() {
    const SECOND_LOAD_OFFSET_FIELD: usize = 0x40 + 3 * 56 + 8;

    let mut file = build_executable(&layout_of(ELF_X86_64), None, &[]);
    let field = SECOND_LOAD_OFFSET_FIELD..SECOND_LOAD_OFFSET_FIELD + 8;
    let offset = u64::from_le_bytes(file[field.clone()].try_into().expect("eight bytes"));
    file[field].copy_from_slice(&(offset + 8).to_le_bytes());
    LoadedImage::load(&file);
}
