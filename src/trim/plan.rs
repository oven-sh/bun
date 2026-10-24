use core::ops::Range;

use core::mem::offset_of;

use bun_exe_format::builtins::Image;
use bun_exe_format::image::KnownSection;
use bun_exe_format::section::find_known_section;
use bun_removable_features::{
    Feature, FeatureSet, RemovableFeatureState, Removal, RuntimeRequirement,
};

use crate::decide::decide;
use crate::error::{TrimError, TrimInternalError, TrimRequestError};
use crate::locales::resolve_wanted_groups;
use crate::model::{
    Decision, FeatureEdges, IcuPackage, ModuleText, OptionRequirement, PlannedIcuPackage,
    PlannedRange, SetIndex, TrimInput, TrimPlan, TrimTable, UsedFeatures, UsedLocales,
    WantedLocaleGroups,
};
use crate::table::read_trim_table;

pub fn plan(input: &TrimInput<'_>, executable: &mut Image<'_>) -> Result<TrimPlan, TrimError> {
    if !input.removes_anything() {
        return Ok(TrimPlan::empty());
    }
    let table = read_trim_table(executable)?;
    let decision = decide(input, &table.edges);
    let is_kept = |feature: &Feature| !decision.unused.contains(*feature);
    if let Some(missing) = read_removed_features(executable)?.iter().find(is_kept) {
        return Err(TrimRequestError::MissingFromTemplate(missing).into());
    }
    let is_template = input.request.is_template;
    let outside_programs = Feature::all_outside_compiled_programs();
    let is_of_programs = |feature: &Feature| !outside_programs.contains(*feature);
    if let Some(feature) = decision.unused.iter().find(is_of_programs)
        && is_template
    {
        return Err(TrimRequestError::TemplateWithoutProgramFeature(feature).into());
    }

    // Unseen code can ask for any locale, and `--trim-without` alone does not look at the program.
    let follows_used_locales =
        input.request.removes_unused && !can_run_unseen_code(input.used, &decision.requirements);
    let unknown_locales = UsedLocales::Unknown(None);
    let used_locales = if follows_used_locales {
        &input.used.locales
    } else {
        &unknown_locales
    };
    let wanted = resolve_wanted_groups(
        used_locales,
        input.request.locales.as_deref(),
        &table.icu_languages,
    )?;
    let runs_library_text = is_template || can_run_library_text(input.used, &decision.requirements);
    let plan = plan_table(&table, decision, &wanted, runs_library_text);
    if !is_template {
        return Ok(plan);
    }
    // The cut that follows edits each ICU package as a whole.
    Ok(TrimPlan {
        keeps_table: true,
        icu_packages: Vec::new(),
        ..plan
    })
}

/// What the cut that made a template took out of it.
fn read_removed_features(executable: &mut Image<'_>) -> Result<FeatureSet, TrimError> {
    let Ok(location) = find_known_section(executable, KnownSection::RemovableFeatureState) else {
        return Ok(FeatureSet::EMPTY);
    };
    let mut state = [0u8; size_of::<RemovableFeatureState>()];
    if location.size < state.len() as u64
        || !(executable.read)(location.file_offset as usize, &mut state)
    {
        return Err(TrimInternalError::MalformedTable.into());
    }
    let removal = &state[offset_of!(RemovableFeatureState, removal)..];
    let is_removed =
        |feature: &&Feature| removal[usize::from(feature.index())] != Removal::Present as u8;
    Ok(Feature::ALL.iter().filter(is_removed).copied().collect())
}

fn runs_unseen_code(option: &OptionRequirement) -> bool {
    match option.requirement {
        RuntimeRequirement::WholeRuntime | RuntimeRequirement::RuntimeCode => true,
        RuntimeRequirement::Nothing | RuntimeRequirement::Feature(_) => false,
    }
}

fn can_run_unseen_code(used: &UsedFeatures, requirements: &[OptionRequirement]) -> bool {
    used.causes
        .iter()
        .any(|unseen| unseen.cause.lets_unseen_code_run())
        || requirements.iter().any(runs_unseen_code)
}

// An image without ImageFlag::AdmitsLibraryText lets no realm run a built-in module from its text.
fn can_run_library_text(used: &UsedFeatures, requirements: &[OptionRequirement]) -> bool {
    used.causes
        .iter()
        .any(|unseen| unseen.cause.admits_library_text())
        || requirements.iter().any(runs_unseen_code)
}

pub fn read_feature_edges(executable: &mut Image<'_>) -> Result<FeatureEdges, TrimError> {
    read_trim_table(executable).map(|table| table.edges)
}

pub(crate) fn plan_table(
    table: &TrimTable,
    decision: Decision,
    wanted: &WantedLocaleGroups,
    runs_library_text: bool,
) -> TrimPlan {
    let removed = decision.removed();
    let removed_sets: Vec<bool> = table
        .sets
        .iter()
        .map(|set| set.is_subset_of(&removed))
        .collect();

    let module_texts = table
        .module_texts
        .iter()
        .filter(|text| is_module_text_removed(text, &removed_sets, runs_library_text))
        .filter_map(|text| {
            Some(PlannedRange {
                range: text.range,
                is_code: false,
                can_be_cut: text.can_be_cut,
                can_be_filled: text.can_be_filled,
                named_feature: find_named_feature(&table.sets[usize::from(text.set.0)])?,
            })
        });
    let ranges = table
        .ranges
        .iter()
        .filter(|range| is_set_removed(&removed_sets, range.set))
        .filter_map(|range| {
            Some(PlannedRange {
                range: range.range,
                is_code: range.is_code,
                can_be_cut: range.can_be_cut,
                can_be_filled: range.can_be_filled,
                named_feature: find_named_feature(&table.sets[usize::from(range.set.0)])?,
            })
        })
        .chain(module_texts)
        .collect();
    let icu_packages = table
        .icu_packages
        .iter()
        .filter_map(|package| plan_icu_package(package, &removed_sets, wanted))
        .collect();
    TrimPlan {
        decision,
        ranges,
        icu_packages,
        keeps_table: false,
    }
}

fn is_set_removed(removed_sets: &[bool], set: SetIndex) -> bool {
    removed_sets[usize::from(set.0)]
}

fn is_module_text_removed(
    text: &ModuleText,
    removed_sets: &[bool],
    runs_library_text: bool,
) -> bool {
    let has_reader = runs_library_text
        || text
            .readers
            .is_some_and(|readers| !is_set_removed(removed_sets, readers));
    !has_reader || is_set_removed(removed_sets, text.set)
}

fn find_named_feature(set: &FeatureSet) -> Option<Feature> {
    set.iter().next()
}

fn plan_icu_package(
    package: &IcuPackage,
    removed_sets: &[bool],
    wanted: &WantedLocaleGroups,
) -> Option<PlannedIcuPackage> {
    let mut removed_items: Vec<Range<u32>> = Vec::new();
    let mut tombstoned_items: Vec<Range<u32>> = Vec::new();
    for run in &package.runs {
        let items = if is_set_removed(removed_sets, run.set) {
            &mut removed_items
        } else if run
            .locale_group
            .is_some_and(|group| !wanted.contains(group))
        {
            &mut tombstoned_items
        } else {
            continue;
        };
        let end = run.first_item.saturating_add(run.item_count);
        match items.last_mut() {
            Some(previous) if previous.end == run.first_item => previous.end = end,
            Some(_) | None => items.push(run.first_item..end),
        }
    }
    if removed_items.is_empty() && tombstoned_items.is_empty() {
        return None;
    }
    Some(PlannedIcuPackage {
        range: package.range,
        removed_items,
        tombstoned_items,
    })
}

#[cfg(test)]
#[allow(clippy::single_range_in_vec_init)]
mod tests {
    use bun_exe_format::image::AddressRange;
    use bun_options_types::trim::TrimRequest;
    use bun_removable_features::{FEATURES_HASH, Removal, TrimFeature};

    use super::*;
    use crate::error::TrimRequestError;
    use crate::model::{
        ExecutableSettings, IcuItemRun, IcuLanguage, LocaleGroup, LocaleTag, RemovableRange,
        UnseenCode, UnseenCodeCause,
    };
    use crate::table::tests::encode_table;

    const BASE_ADDRESS: u64 = 0x1000;

    fn table_with_sets(sets: &[&[Feature]]) -> TrimTable {
        TrimTable {
            features_hash: FEATURES_HASH,
            base_address: BASE_ADDRESS,
            edges: FeatureEdges::default(),
            sets: sets
                .iter()
                .map(|set| FeatureSet::from_features(set))
                .collect(),
            ranges: Vec::new(),
            icu_packages: Vec::new(),
            icu_languages: Vec::new(),
            module_texts: Vec::new(),
        }
    }

    fn address_range(offset: u64, size: u64) -> AddressRange {
        AddressRange {
            start: BASE_ADDRESS + offset,
            end: BASE_ADDRESS + offset + size,
        }
    }

    fn code_range(offset: u64, size: u64, set: u16) -> RemovableRange {
        RemovableRange {
            range: address_range(offset, size),
            set: SetIndex(set),
            is_code: true,
            can_be_cut: true,
            can_be_filled: true,
        }
    }

    fn append_section_header(
        elf: &mut Vec<u8>,
        name: u32,
        section_type: u32,
        offset: u64,
        size: u64,
    ) {
        elf.extend_from_slice(&name.to_le_bytes());
        elf.extend_from_slice(&section_type.to_le_bytes());
        for word in [0, 0, offset, size, 0, 1, 0] {
            elf.extend_from_slice(&u64::to_le_bytes(word));
        }
    }

    fn create_elf(table: &[u8]) -> Vec<u8> {
        const SECTION_NAMES: &[u8] = b"\0.bun_trim\0.shstrtab\0";
        const HEADER_BYTES: u64 = 64;
        let names_offset = HEADER_BYTES + table.len() as u64;
        let headers_offset = (names_offset + SECTION_NAMES.len() as u64).next_multiple_of(8);

        let mut elf = vec![0u8; HEADER_BYTES as usize];
        elf[..7].copy_from_slice(b"\x7fELF\x02\x01\x01");
        elf[16..18].copy_from_slice(&2u16.to_le_bytes());
        elf[18..20].copy_from_slice(&62u16.to_le_bytes());
        elf[20..24].copy_from_slice(&1u32.to_le_bytes());
        elf[40..48].copy_from_slice(&headers_offset.to_le_bytes());
        elf[52..54].copy_from_slice(&64u16.to_le_bytes());
        elf[58..60].copy_from_slice(&64u16.to_le_bytes());
        elf[60..62].copy_from_slice(&3u16.to_le_bytes());
        elf[62..64].copy_from_slice(&2u16.to_le_bytes());
        elf.extend_from_slice(table);
        elf.extend_from_slice(SECTION_NAMES);
        elf.resize(headers_offset as usize, 0);
        append_section_header(&mut elf, 0, 0, 0, 0);
        append_section_header(&mut elf, 1, 1, HEADER_BYTES, table.len() as u64);
        append_section_header(&mut elf, 11, 3, names_offset, SECTION_NAMES.len() as u64);
        elf
    }

    fn try_plan_encoded_input(
        table: &TrimTable,
        input: &TrimInput<'_>,
    ) -> Result<TrimPlan, TrimError> {
        let elf = create_elf(&encode_table(table));
        let mut read = |offset: usize, out: &mut [u8]| match elf.get(offset..offset + out.len()) {
            Some(bytes) => {
                out.copy_from_slice(bytes);
                true
            }
            None => false,
        };
        let mut image = Image {
            len: elf.len(),
            read: &mut read,
        };
        plan(input, &mut image)
    }

    fn plan_encoded_input(table: &TrimTable, input: &TrimInput<'_>) -> TrimPlan {
        try_plan_encoded_input(table, input).unwrap()
    }

    fn plan_encoded_table(table: &TrimTable, request: &TrimRequest) -> TrimPlan {
        plan_encoded_input(
            table,
            &TrimInput {
                used: &UsedFeatures::default(),
                settings: &ExecutableSettings::default(),
                request,
            },
        )
    }

    fn removing_internal(features: &[Feature]) -> TrimRequest {
        TrimRequest {
            remove_internal: features.to_vec(),
            ..TrimRequest::default()
        }
    }

    fn removing_unused() -> TrimRequest {
        TrimRequest {
            removes_unused: true,
            ..TrimRequest::default()
        }
    }

    fn wanting(tags: &[&str], request: TrimRequest) -> TrimRequest {
        TrimRequest {
            locales: Some(tags.iter().map(|tag| Box::from(tag.as_bytes())).collect()),
            ..request
        }
    }

    const GERMAN: LocaleGroup = LocaleGroup(0);
    const ENGLISH: LocaleGroup = LocaleGroup(1);
    const FRENCH: LocaleGroup = LocaleGroup(2);
    const JIT_SET: SetIndex = SetIndex(0);
    const FFI_SET: SetIndex = SetIndex(1);

    fn table_with_icu_items(items: &[(SetIndex, Option<LocaleGroup>)]) -> TrimTable {
        let runs = (0u32..)
            .zip(items)
            .map(|(first_item, &(set, locale_group))| IcuItemRun {
                first_item,
                item_count: 1,
                set,
                locale_group,
            });
        let language = |name: &[u8; 4], group: LocaleGroup| IcuLanguage { name: *name, group };
        TrimTable {
            icu_packages: vec![IcuPackage {
                range: address_range(0x8000, 0x100),
                runs: runs.collect(),
            }],
            icu_languages: vec![
                language(b"de\0\0", GERMAN),
                language(b"en\0\0", ENGLISH),
                language(b"fr\0\0", FRENCH),
            ],
            ..table_with_sets(&[&[Feature::Jit], &[Feature::Ffi]])
        }
    }

    fn planned_icu_items(
        removed_items: Vec<Range<u32>>,
        tombstoned_items: Vec<Range<u32>>,
    ) -> Vec<PlannedIcuPackage> {
        vec![PlannedIcuPackage {
            range: address_range(0x8000, 0x100),
            removed_items,
            tombstoned_items,
        }]
    }

    fn table_with_three_languages() -> TrimTable {
        table_with_icu_items(&[
            (FFI_SET, Some(GERMAN)),
            (FFI_SET, Some(ENGLISH)),
            (FFI_SET, Some(FRENCH)),
        ])
    }

    fn using_ffi_in_english() -> UsedFeatures {
        UsedFeatures {
            locales: UsedLocales::Listed(vec![LocaleTag(Box::from(&b"en-US"[..]))]),
            ..UsedFeatures::from_features(&[Feature::Ffi])
        }
    }

    #[test]
    fn range_of_two_member_set_needs_both_removed() {
        let table = TrimTable {
            ranges: vec![code_range(0x10, 0x20, 0)],
            ..table_with_sets(&[&[Feature::Jit, Feature::Ffi]])
        };
        assert!(
            plan_encoded_table(&table, &removing_internal(&[Feature::Jit]))
                .ranges
                .is_empty()
        );

        let both = plan_encoded_table(&table, &removing_internal(&[Feature::Jit, Feature::Ffi]));
        let expected = PlannedRange {
            range: address_range(0x10, 0x20),
            is_code: true,
            can_be_cut: true,
            can_be_filled: true,
            named_feature: Feature::Jit,
        };
        assert_eq!(both.ranges, vec![expected]);
    }

    #[test]
    fn planned_range_copies_table_flags() {
        let flags = [
            (true, false, true),
            (false, true, true),
            (false, true, false),
        ];
        let ranges =
            flags
                .iter()
                .zip(0u64..)
                .map(
                    |(&(is_code, can_be_cut, can_be_filled), position)| RemovableRange {
                        is_code,
                        can_be_cut,
                        can_be_filled,
                        ..code_range(position * 0x10, 0x10, 0)
                    },
                );
        let table = TrimTable {
            ranges: ranges.collect(),
            ..table_with_sets(&[&[Feature::Jit]])
        };
        let planned = plan_encoded_table(&table, &removing_internal(&[Feature::Jit]));
        let flags_of =
            |range: &PlannedRange| (range.is_code, range.can_be_cut, range.can_be_filled);
        assert_eq!(
            planned.ranges.iter().map(flags_of).collect::<Vec<_>>(),
            flags
        );
    }

    #[test]
    fn named_feature_is_first_of_set() {
        let table = TrimTable {
            ranges: vec![code_range(0, 8, 0)],
            ..table_with_sets(&[&[Feature::Ffi, Feature::Jit]])
        };
        let planned = plan_encoded_table(&table, &removing_internal(&[Feature::Ffi, Feature::Jit]));
        assert_eq!(
            Some(planned.ranges[0].named_feature),
            table.sets[0].iter().next()
        );
        assert_eq!(planned.removal_of(Feature::Ffi), Removal::Unused);
        assert_eq!(planned.removal_of(Feature::Jit), Removal::Unused);
        assert_eq!(planned.removal_of(Feature::Sql), Removal::Present);
        assert!(!planned.is_empty());
    }

    #[test]
    fn allowed_feature_keeps_its_range() {
        let table = TrimTable {
            ranges: vec![code_range(0, 8, 0), code_range(8, 8, 1)],
            ..table_with_sets(&[&[Feature::Jit], &[Feature::Ffi]])
        };
        let named_features = |request: &TrimRequest| -> Vec<Feature> {
            let input = TrimInput {
                used: &UsedFeatures::from_features(&[]),
                settings: &ExecutableSettings::default(),
                request,
            };
            plan_encoded_input(&table, &input)
                .ranges
                .iter()
                .map(|range| range.named_feature)
                .collect()
        };
        assert_eq!(
            named_features(&removing_unused()),
            [Feature::Jit, Feature::Ffi]
        );
        assert_eq!(
            named_features(&TrimRequest {
                allow: vec![TrimFeature::Ffi],
                ..removing_unused()
            }),
            [Feature::Jit]
        );
    }

    #[test]
    fn icu_runs_merge() {
        let run = |first_item, item_count, set| IcuItemRun {
            first_item,
            item_count,
            set: SetIndex(set),
            locale_group: None,
        };
        let range = address_range(0x8000, 0x100);
        let table = TrimTable {
            icu_packages: vec![IcuPackage {
                range,
                runs: vec![run(0, 2, 0), run(2, 3, 0), run(5, 1, 1), run(6, 1, 0)],
            }],
            ..table_with_sets(&[&[Feature::Jit], &[Feature::Ffi]])
        };
        let planned = plan_encoded_table(&table, &removing_internal(&[Feature::Jit]));
        let expected = PlannedIcuPackage {
            range,
            removed_items: vec![0..5, 6..7],
            tombstoned_items: Vec::new(),
        };
        assert_eq!(planned.icu_packages, vec![expected]);

        assert!(
            plan_encoded_table(&table, &removing_internal(&[Feature::Sql]))
                .icu_packages
                .is_empty()
        );
    }

    #[test]
    fn unwanted_language_is_tombstoned_and_wanted_one_stays() {
        let table = table_with_icu_items(&[
            (FFI_SET, Some(GERMAN)),
            (FFI_SET, Some(FRENCH)),
            (FFI_SET, Some(ENGLISH)),
            (FFI_SET, Some(GERMAN)),
        ]);
        let planned = plan_encoded_table(
            &table,
            &wanting(&["en"], removing_internal(&[Feature::Jit])),
        );
        assert_eq!(
            planned.icu_packages,
            planned_icu_items(Vec::new(), vec![0..2, 3..4])
        );

        let every_language = wanting(&["fr", "de", "en"], removing_internal(&[Feature::Jit]));
        assert!(
            plan_encoded_table(&table, &every_language)
                .icu_packages
                .is_empty()
        );
    }

    #[test]
    fn removed_set_wins_over_language() {
        let table = table_with_icu_items(&[
            (JIT_SET, Some(GERMAN)),
            (JIT_SET, Some(ENGLISH)),
            (FFI_SET, Some(GERMAN)),
        ]);
        let planned = plan_encoded_table(
            &table,
            &wanting(&["en"], removing_internal(&[Feature::Jit])),
        );
        assert_eq!(
            planned.icu_packages,
            planned_icu_items(vec![0..2], vec![2..3])
        );
    }

    #[test]
    fn run_without_group_follows_its_set_only() {
        let table =
            table_with_icu_items(&[(FFI_SET, None), (JIT_SET, None), (FFI_SET, Some(GERMAN))]);
        let planned = plan_encoded_table(
            &table,
            &wanting(&["en"], removing_internal(&[Feature::Jit])),
        );
        assert_eq!(
            planned.icu_packages,
            planned_icu_items(vec![1..2], vec![2..3])
        );

        let nothing_wanted = wanting(&[], removing_internal(&[Feature::Sql]));
        assert_eq!(
            plan_encoded_table(&table, &nothing_wanted).icu_packages,
            planned_icu_items(Vec::new(), vec![2..3])
        );
    }

    #[test]
    fn closed_program_retains_used_languages() {
        let input = TrimInput {
            used: &using_ffi_in_english(),
            settings: &ExecutableSettings::default(),
            request: &removing_unused(),
        };
        let planned = plan_encoded_input(&table_with_three_languages(), &input);
        assert_eq!(
            planned.icu_packages,
            planned_icu_items(Vec::new(), vec![0..1, 2..3])
        );
    }

    #[test]
    fn unseen_code_retains_every_language() {
        for cause in UnseenCodeCause::ALL {
            let used = UsedFeatures {
                causes: vec![UnseenCode {
                    cause,
                    witness: None,
                }],
                ..using_ffi_in_english()
            };
            let input = TrimInput {
                used: &used,
                settings: &ExecutableSettings::default(),
                request: &removing_unused(),
            };
            let planned = plan_encoded_input(&table_with_three_languages(), &input);
            assert_eq!(
                planned.icu_packages.is_empty(),
                cause.lets_unseen_code_run(),
                "{cause:?}"
            );
        }
    }

    #[test]
    fn option_running_unseen_code_retains_every_language() {
        let requirements = [
            (RuntimeRequirement::WholeRuntime, true),
            (RuntimeRequirement::RuntimeCode, true),
            (RuntimeRequirement::Feature(Feature::Profilers), false),
        ];
        for (requirement, retains_every_language) in requirements {
            let option = OptionRequirement {
                requirement,
                label: Box::from(&b"--option"[..]),
            };
            let settings = ExecutableSettings {
                exec_argv: vec![option],
                ..ExecutableSettings::default()
            };
            let input = TrimInput {
                used: &using_ffi_in_english(),
                settings: &settings,
                request: &removing_unused(),
            };
            let planned = plan_encoded_input(&table_with_three_languages(), &input);
            assert_eq!(
                planned.icu_packages.is_empty(),
                retains_every_language,
                "{requirement:?}"
            );
        }
    }

    #[test]
    fn request_not_removing_unused_retains_every_language() {
        let input = TrimInput {
            used: &using_ffi_in_english(),
            settings: &ExecutableSettings::default(),
            request: &removing_internal(&[Feature::Sql]),
        };
        assert!(
            plan_encoded_input(&table_with_three_languages(), &input)
                .icu_packages
                .is_empty()
        );
    }

    #[test]
    fn requested_locales_stand_alone_when_use_is_not_followed() {
        let request = wanting(&["de"], removing_internal(&[Feature::Sql]));
        let input = TrimInput {
            used: &using_ffi_in_english(),
            settings: &ExecutableSettings::default(),
            request: &request,
        };
        let planned = plan_encoded_input(&table_with_three_languages(), &input);
        assert_eq!(
            planned.icu_packages,
            planned_icu_items(Vec::new(), vec![1..3])
        );
    }

    #[test]
    fn requested_locale_without_data_fails() {
        let request = wanting(&["xx"], removing_unused());
        let input = TrimInput {
            used: &UsedFeatures::default(),
            settings: &ExecutableSettings::default(),
            request: &request,
        };
        let result = try_plan_encoded_input(&table_with_three_languages(), &input);
        assert!(
            matches!(result, Err(TrimError::Request(TrimRequestError::UnknownLocale(tag))) if *tag == *b"xx")
        );
    }

    fn table_with_module_texts() -> TrimTable {
        let text = |offset, module, set, readers: Option<u16>| ModuleText {
            range: address_range(offset, 0x10),
            module,
            set: SetIndex(set),
            readers: readers.map(SetIndex),
            can_be_cut: true,
            can_be_filled: true,
        };
        TrimTable {
            ranges: vec![code_range(0x200, 0x10, 1)],
            module_texts: vec![text(0x100, 4, 0, Some(1)), text(0x110, 2, 2, None)],
            ..table_with_sets(&[
                &[Feature::Interpreter, Feature::Sql],
                &[Feature::Sql],
                &[Feature::Interpreter],
            ])
        }
    }

    fn planned_offsets(
        used: &UsedFeatures,
        settings: &ExecutableSettings,
        request: &TrimRequest,
    ) -> Vec<u64> {
        let planned = plan_encoded_input(
            &table_with_module_texts(),
            &TrimInput {
                used,
                settings,
                request,
            },
        );
        planned
            .ranges
            .iter()
            .map(|range| range.range.start - BASE_ADDRESS)
            .collect()
    }

    fn evaluating_text(features: &[Feature]) -> UsedFeatures {
        UsedFeatures {
            causes: vec![UnseenCode {
                cause: UnseenCodeCause::EvaluatesText,
                witness: None,
            }],
            ..UsedFeatures::from_features(features)
        }
    }

    #[test]
    fn module_text_leaves_with_its_set() {
        let offsets = |features: &[Feature]| {
            planned_offsets(
                &UsedFeatures::default(),
                &ExecutableSettings::default(),
                &removing_internal(features),
            )
        };
        assert_eq!(offsets(&[Feature::Sql]), [0x200]);
        assert_eq!(offsets(&[Feature::Interpreter]), [0x110]);
        assert_eq!(
            offsets(&[Feature::Interpreter, Feature::Sql]),
            [0x200, 0x100, 0x110]
        );
    }

    #[test]
    fn module_text_leaves_where_no_library_text_runs() {
        let offsets = planned_offsets(
            &evaluating_text(&[]),
            &ExecutableSettings::default(),
            &removing_unused(),
        );
        assert_eq!(offsets, [0x200, 0x100, 0x110]);
    }

    #[test]
    fn planned_module_text_is_data_named_after_its_set() {
        let input = TrimInput {
            used: &evaluating_text(&[]),
            settings: &ExecutableSettings::default(),
            request: &removing_unused(),
        };
        let planned = plan_encoded_input(&table_with_module_texts(), &input);
        assert_eq!(planned.removal_of(Feature::Interpreter), Removal::Present);
        let expected = PlannedRange {
            range: address_range(0x100, 0x10),
            is_code: false,
            can_be_cut: true,
            can_be_filled: true,
            named_feature: Feature::Interpreter,
        };
        assert_eq!(planned.ranges[1], expected);
    }

    #[test]
    fn retained_reader_keeps_module_text() {
        let offsets = planned_offsets(
            &evaluating_text(&[Feature::Sql]),
            &ExecutableSettings::default(),
            &removing_unused(),
        );
        assert_eq!(offsets, [0x110]);
    }

    #[test]
    fn library_text_that_can_run_keeps_module_texts() {
        for cause in UnseenCodeCause::ALL {
            let used = UsedFeatures {
                causes: vec![UnseenCode {
                    cause,
                    witness: None,
                }],
                ..UsedFeatures::from_features(&[Feature::Interpreter])
            };
            let offsets =
                planned_offsets(&used, &ExecutableSettings::default(), &removing_unused());
            let keeps_texts = !offsets.contains(&0x100) && !offsets.contains(&0x110);
            assert_eq!(keeps_texts, cause.admits_library_text(), "{cause:?}");
        }
    }

    #[test]
    fn option_running_unseen_code_keeps_module_texts() {
        let option = OptionRequirement {
            requirement: RuntimeRequirement::RuntimeCode,
            label: Box::from(&b"--option"[..]),
        };
        let settings = ExecutableSettings {
            exec_argv: vec![option],
            ..ExecutableSettings::default()
        };
        assert!(planned_offsets(&evaluating_text(&[]), &settings, &removing_unused()).is_empty());
    }

    #[test]
    fn compiled_program_reads_table_without_request() {
        let table = TrimTable {
            ranges: vec![code_range(0, 0x10, 0), code_range(0x10, 0x10, 1)],
            ..table_with_sets(&[&[Feature::Jit], &[Feature::Ffi]])
        };
        let used = UsedFeatures::from_features(&[]);
        let input = TrimInput {
            used: &used,
            settings: &ExecutableSettings::default(),
            request: &TrimRequest::default(),
        };
        let planned = plan_encoded_input(&table, &input);
        assert_eq!(planned.removed(), Feature::all_outside_compiled_programs());
        assert_eq!(planned.ranges.len(), 1);
        assert_eq!(planned.ranges[0].named_feature, Feature::Jit);
    }

    #[test]
    fn disabled_request_reads_nothing() {
        let not_compiled = UsedFeatures::with_cause(UnseenCodeCause::ProgramNotCompiled);
        let requests = [
            TrimRequest::default(),
            TrimRequest {
                allow: vec![TrimFeature::Ffi],
                ..TrimRequest::default()
            },
            TrimRequest {
                logs: true,
                ..TrimRequest::default()
            },
            wanting(&["de"], TrimRequest::default()),
        ];
        for request in &requests {
            let mut read = |_: usize, _: &mut [u8]| -> bool {
                panic!("a disabled request read the executable")
            };
            let mut image = Image {
                len: 0,
                read: &mut read,
            };
            let input = TrimInput {
                used: &not_compiled,
                settings: &ExecutableSettings::default(),
                request,
            };
            let planned = plan(&input, &mut image).unwrap();
            assert!(planned.is_empty());
            assert!(planned.removed().is_empty());
        }
    }
}
