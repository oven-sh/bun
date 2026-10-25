use bstr::BString;

use super::*;
use crate::engine::SourceLocation;
use crate::engine::testing::ResultRecords;
use crate::ir::generated::{KnowledgeLevel, Witness};
use crate::ir::ids::{ABSENT_WORD, Id};
use crate::report::testing::{LINE_2_COLUMN_14, ReportFixture};
use crate::report::wording::IllTypedWording;
use crate::report::{CostCounts, LevelCounts, SiteTotals};

const PROGRAM: u32 = 0;
const DEPENDENCY: u32 = 1;
const RUNTIME: u32 = 2;
const ORIGINS: [ModuleOrigin; 3] = [
    ModuleOrigin::Program,
    ModuleOrigin::Dependency,
    ModuleOrigin::Runtime,
];
const NO_LOCATION: SourceLocation = SourceLocation {
    module: ABSENT_WORD,
    position: 0,
};
const EVERY_FAMILY: ExplainSet = ExplainSet::empty();
const ESTIMATE: &str =
    "of the time in untyped operations, by how often the compiler expects each to run";

fn access(
    module: u32,
    offset: u32,
    level: KnowledgeLevel,
    cause: UnprovenCause,
    witness_offset: u32,
) -> AccessRecord {
    AccessRecord {
        location: SourceLocation {
            module,
            position: offset,
        },
        kind: AccessKind::Read,
        level,
        cause,
        limit: LimitId::None,
        layout: ABSENT_WORD,
        copies: 1,
        distance: 0,
        witness: Witness {
            function: ABSENT_WORD,
            value: ABSENT_WORD,
            location: SourceLocation {
                module: PROGRAM,
                position: witness_offset,
            },
        },
        function: ABSENT_WORD,
        ill_typed_cause: IllTypedCause::None,
        cost: match level {
            KnowledgeLevel::Unknown => AccessCost::ByName,
            KnowledgeLevel::Expected => AccessCost::TestsReceiver,
            KnowledgeLevel::Proven => AccessCost::Free,
        },
        has_other_roots: 0,
        reserved: 0,
        heat: 0.0,
    }
}

fn unknown_object(module: u32, offset: u32, witness_offset: u32) -> AccessRecord {
    let (level, cause) = (KnowledgeLevel::Unknown, UnprovenCause::UnknownObject);
    access(module, offset, level, cause, witness_offset)
}

fn with_witness_location(record: AccessRecord, location: SourceLocation) -> AccessRecord {
    AccessRecord {
        witness: Witness {
            location,
            ..record.witness
        },
        ..record
    }
}

fn with_witness_function(record: AccessRecord, function: u32) -> AccessRecord {
    AccessRecord {
        witness: Witness {
            function,
            ..record.witness
        },
        ..record
    }
}

fn at(module: u32, offset: u32) -> Option<Position> {
    Some(Position {
        module: ModuleId::from_word(module),
        offset,
    })
}

fn origin_of(module: ModuleId) -> ModuleOrigin {
    ORIGINS[module.index()]
}

fn collect(records: &[AccessRecord]) -> Vec<Cause> {
    collect_causes(records, &origin_of, EVERY_FAMILY)
}

fn collected_kinds(records: &[AccessRecord], families: ExplainSet) -> Vec<UnprovenCause> {
    let causes = collect_causes(records, &origin_of, families);
    causes.iter().map(|cause| cause.cause).collect()
}

fn is_property_access(kind: AccessKind) -> bool {
    operation_class(kind) == Some(OperationClass::PropertyAccess)
}

fn counts(program: u64, dependencies: u64) -> OriginCounts {
    OriginCounts {
        program,
        dependencies,
    }
}

const INSTRUCTIONS_OF_ACCESS_BY_NAME: f64 = 28.0;

fn cause(kind: UnprovenCause, position: Option<Position>, accesses: OriginCounts) -> Cause {
    Cause {
        cause: kind,
        ill_typed_cause: IllTypedCause::None,
        limit: LimitId::None,
        position,
        function: None,
        layouts: Vec::new(),
        accesses,
        calls: OriginCounts::default(),
        operators: OriginCounts::default(),
        alone: accesses.total(),
        cost: EstimatedCost {
            program: accesses.program as f64 * INSTRUCTIONS_OF_ACCESS_BY_NAME,
            dependencies: accesses.dependencies as f64 * INSTRUCTIONS_OF_ACCESS_BY_NAME,
        },
        is_in_runtime: false,
    }
}

fn totals(program: [u32; 3], dependencies: [u32; 3]) -> ProgramTotals {
    let with_accesses = |words: [u32; 3]| SiteTotals {
        accesses: LevelCounts::from_words(words),
        access_costs: CostCounts::from_words([words[0], words[1], 0, words[2]]),
        ..SiteTotals::default()
    };
    ProgramTotals {
        program: with_accesses(program),
        dependencies: with_accesses(dependencies),
    }
}

fn why(cause: IllTypedCause) -> IllTypedWording {
    ill_typed_cause_wording(cause).expect("every cause but None has a wording")
}

fn names() -> ProgramNames {
    ProgramNames::from_lists(
        &[(&b"render"[..], Some(ModuleId::from_word(PROGRAM)))],
        &[&b"Item"[..], b"", b"Order", b"Item"],
        &[
            (&b"/p/a.ts"[..], ModuleOrigin::Program),
            (&b"/p/node_modules/b/b.js"[..], ModuleOrigin::Dependency),
            (&b"node:http"[..], ModuleOrigin::Runtime),
        ],
    )
}

fn layouts(words: &[u32]) -> Vec<LayoutId> {
    words
        .iter()
        .map(|&word| LayoutId::from_word(word))
        .collect()
}

fn written(write: impl FnOnce(&mut Vec<u8>)) -> BString {
    let mut out = Vec::new();
    write(&mut out);
    BString::from(out)
}

fn text_of(entry: &ReportEntry) -> BString {
    BString::from(&entry.text[..])
}

fn note_texts(entry: &ReportEntry) -> Vec<BString> {
    let notes = entry.notes.iter();
    notes.map(|note| BString::from(&note.text[..])).collect()
}

fn list_and_json_entries(ill_typed_cause: IllTypedCause) -> (String, String) {
    let (level, kind) = (
        KnowledgeLevel::Unknown,
        UnprovenCause::ReachesUnknownJavaScript,
    );
    let records = [AccessRecord {
        ill_typed_cause,
        ..access(PROGRAM, 0, level, kind, LINE_2_COLUMN_14)
    }];
    let fixture = ReportFixture::new(ResultRecords {
        accesses: &records,
        ..ResultRecords::default()
    });
    let (mut list, mut json) = (Vec::new(), Vec::new());
    fixture.with_input(|input| {
        collect_list(input, ExplainSet::ONLY_UNKNOWN_CODE, &mut list);
        collect_json(input, EVERY_FAMILY, &mut json);
    });
    assert_eq!((list.len(), json.len()), (1, 2));
    (text_of(&list[0]).to_string(), text_of(&json[1]).to_string())
}

fn text_entries(cause_count: u32) -> Vec<ReportEntry> {
    let causes: Vec<Cause> = (0..cause_count)
        .map(|offset| {
            cause(
                UnprovenCause::UnknownObject,
                at(PROGRAM, offset),
                counts(1, 0),
            )
        })
        .collect();
    let totals = totals([cause_count, 0, 0], [0; 3]);
    let mut entries = Vec::new();
    collect_text_entries(&causes, &totals, &names(), |_| 0, &mut entries);
    entries
}

#[test]
fn one_access_has_one_cause() {
    let records = [
        unknown_object(PROGRAM, 0, 100),
        access(
            PROGRAM,
            4,
            KnowledgeLevel::Expected,
            UnprovenCause::UnknownObject,
            100,
        ),
        access(
            PROGRAM,
            8,
            KnowledgeLevel::Expected,
            UnprovenCause::FieldDeleted,
            200,
        ),
        access(
            DEPENDENCY,
            0,
            KnowledgeLevel::Unknown,
            UnprovenCause::UnknownCallee,
            300,
        ),
        access(
            PROGRAM,
            12,
            KnowledgeLevel::Proven,
            UnprovenCause::Unknown,
            0,
        ),
    ];
    let mut accesses = LevelCounts::default();
    for record in &records {
        accesses.add(record.level, 1);
    }
    let causes = collect(&records);
    let explained: u64 = causes.iter().map(|cause| cause.accesses.total()).sum();
    assert_eq!(explained, accesses.untyped());
    assert_eq!(explained, 4);
    assert_eq!(causes.len(), 3);
}

#[test]
fn accesses_with_one_witness_share_cause() {
    let records = [
        unknown_object(PROGRAM, 0, 100),
        unknown_object(PROGRAM, 40, 100),
        unknown_object(DEPENDENCY, 8, 100),
    ];
    let shared = cause(UnprovenCause::UnknownObject, at(PROGRAM, 100), counts(2, 1));
    assert_eq!(collect(&records), [shared]);
}

#[test]
fn witness_separates_causes() {
    let records = [
        unknown_object(PROGRAM, 0, 100),
        unknown_object(PROGRAM, 4, 200),
    ];
    let expected = [100, 200].map(|offset| {
        cause(
            UnprovenCause::UnknownObject,
            at(PROGRAM, offset),
            counts(1, 0),
        )
    });
    assert_eq!(collect(&records), expected);
}

#[test]
fn limit_separates_causes() {
    let reached = |offset, limit| AccessRecord {
        limit,
        ..access(
            PROGRAM,
            offset,
            KnowledgeLevel::Unknown,
            UnprovenCause::LimitReached,
            100,
        )
    };
    let records = [
        reached(0, LimitId::MaxTypeNodes),
        reached(4, LimitId::MaxValueFlowEdgesLogged),
        reached(8, LimitId::MaxTypeNodes),
    ];
    let found: Vec<(LimitId, u64)> = collect(&records)
        .iter()
        .map(|cause| (cause.limit, cause.accesses.program))
        .collect();
    assert_eq!(
        found,
        [
            (LimitId::MaxTypeNodes, 2),
            (LimitId::MaxValueFlowEdgesLogged, 1)
        ]
    );
}

#[test]
fn ill_typed_cause_separates_causes() {
    let ill_typed = |offset, ill_typed_cause| AccessRecord {
        ill_typed_cause,
        ..unknown_object(PROGRAM, offset, 100)
    };
    let records = [
        ill_typed(0, IllTypedCause::OutsideData),
        ill_typed(4, IllTypedCause::Assertion),
        ill_typed(8, IllTypedCause::OutsideData),
        ill_typed(12, IllTypedCause::None),
    ];
    let found: Vec<(IllTypedCause, u64)> = collect(&records)
        .iter()
        .map(|cause| (cause.ill_typed_cause, cause.accesses.program))
        .collect();
    assert_eq!(
        found,
        [
            (IllTypedCause::OutsideData, 2),
            (IllTypedCause::None, 1),
            (IllTypedCause::Assertion, 1),
        ]
    );
}

#[test]
fn free_access_has_no_cause() {
    for cost in AccessCost::ALL {
        let record = AccessRecord {
            cost,
            ..unknown_object(PROGRAM, 0, 100)
        };
        let is_untyped = cost != AccessCost::Free;
        assert_eq!(
            collect(&[record]).len(),
            usize::from(is_untyped),
            "{cost:?}"
        );
    }
}

#[test]
fn every_kind_of_operation_counts_in_one_column() {
    for kind in AccessKind::ALL {
        let record = AccessRecord {
            kind,
            ..unknown_object(PROGRAM, 0, 100)
        };
        let causes = collect(&[record]);
        let Some(class) = operation_class(kind) else {
            assert!(causes.is_empty(), "{kind:?}");
            continue;
        };
        let columns = [causes[0].accesses, causes[0].calls, causes[0].operators];
        let expected = match class {
            OperationClass::PropertyAccess => [1, 0, 0],
            OperationClass::Call => [0, 1, 0],
            OperationClass::Operator => [0, 0, 1],
        };
        assert_eq!(columns.map(OriginCounts::total), expected, "{kind:?}");
        assert_eq!(is_property_access(kind), expected[0] == 1, "{kind:?}");
    }
}

#[test]
fn a_call_that_is_tested_or_direct_has_no_cause() {
    for cost in [
        AccessCost::TestsReceiver,
        AccessCost::TestsSlot,
        AccessCost::Free,
    ] {
        let record = AccessRecord {
            kind: AccessKind::Call,
            cost,
            ..unknown_object(PROGRAM, 0, 100)
        };
        assert!(collect(&[record]).is_empty(), "{cost:?}");
    }
}

#[test]
fn a_few_hot_operations_outrank_many_cold_ones() {
    let mut records: Vec<AccessRecord> = (0..1200)
        .map(|offset| unknown_object(PROGRAM, offset, 100))
        .collect();
    records.extend((0..5).map(|offset| AccessRecord {
        heat: 1e6,
        ..unknown_object(PROGRAM, 5000 + offset, 200)
    }));
    let causes = collect(&records);
    let counts: Vec<u64> = causes.iter().map(|cause| cause.accesses.program).collect();
    assert_eq!(counts, [5, 1200]);
}

#[test]
fn what_only_the_compiler_can_fix_ranks_last() {
    let left_by_passes = AccessRecord {
        heat: 1e9,
        ..access(
            PROGRAM,
            0,
            KnowledgeLevel::Unknown,
            UnprovenCause::LeftByPasses,
            100,
        )
    };
    let kinds = collected_kinds(
        &[left_by_passes, unknown_object(PROGRAM, 4, 200)],
        EVERY_FAMILY,
    );
    assert_eq!(
        kinds,
        [UnprovenCause::UnknownObject, UnprovenCause::LeftByPasses]
    );
}

#[test]
fn operations_with_another_root_are_told_apart() {
    let shared = AccessRecord {
        has_other_roots: 1,
        ..unknown_object(PROGRAM, 4, 100)
    };
    let causes = collect(&[unknown_object(PROGRAM, 0, 100), shared]);
    assert_eq!((causes[0].accesses.program, causes[0].alone), (2, 1));
    let entry = text_entry(
        &causes[0],
        1,
        &totals([2, 0, 0], [0; 3]),
        &names(),
        0,
        causes[0].cost.total(),
    );
    assert!(
        note_texts(&entry).contains(&BString::from(
            "1 of these stay untyped until other entries are fixed too"
        )),
        "{:?}",
        note_texts(&entry)
    );
}

#[test]
fn runtime_accesses_are_not_counted() {
    let records = [
        unknown_object(RUNTIME, 0, 100),
        unknown_object(PROGRAM, 0, 100),
    ];
    let counted = cause(UnprovenCause::UnknownObject, at(PROGRAM, 100), counts(1, 0));
    assert_eq!(collect(&records), [counted]);
}

#[test]
fn cause_seen_only_from_runtime_modules_is_absent() {
    let records = [
        unknown_object(RUNTIME, 0, 100),
        unknown_object(RUNTIME, 4, 100),
    ];
    assert!(collect(&records).is_empty());
}

#[test]
fn witness_in_runtime_module_does_not_hide_cause() {
    let location = SourceLocation {
        module: RUNTIME,
        position: 7,
    };
    let record = with_witness_location(unknown_object(PROGRAM, 0, 100), location);
    let counted = Cause {
        is_in_runtime: true,
        ..cause(UnprovenCause::UnknownObject, at(RUNTIME, 7), counts(1, 0))
    };
    assert_eq!(collect(&[record]), [counted]);
}

#[test]
fn access_without_location_counts_as_program() {
    let record = AccessRecord {
        location: NO_LOCATION,
        ..unknown_object(PROGRAM, 0, 100)
    };
    let counted = cause(UnprovenCause::UnknownObject, at(PROGRAM, 100), counts(1, 0));
    assert_eq!(collect(&[record]), [counted]);
}

#[test]
fn copies_count_once() {
    let record = AccessRecord {
        copies: 5,
        ..unknown_object(PROGRAM, 0, 100)
    };
    assert_eq!(collect(&[record])[0].accesses, counts(1, 0));
}

#[test]
fn family_bits_are_distinct() {
    let expected = [
        (
            UnprovenCauseFamily::UnprovenType,
            ExplainSet::ONLY_UNPROVEN_TYPE,
        ),
        (
            UnprovenCauseFamily::UnknownCode,
            ExplainSet::ONLY_UNKNOWN_CODE,
        ),
        (UnprovenCauseFamily::Mutation, ExplainSet::ONLY_MUTATION),
        (UnprovenCauseFamily::Limit, ExplainSet::ONLY_LIMIT),
    ];
    assert_eq!(expected.map(|(family, _)| family), UnprovenCauseFamily::ALL);
    for (family, bit) in expected {
        assert_eq!(family_bit(family), bit, "{family:?}");
    }
}

#[test]
fn families_filter() {
    let kinds = [
        UnprovenCause::UnprovenContents,
        UnprovenCause::UnknownObject,
        UnprovenCause::FieldDeleted,
        UnprovenCause::LimitReached,
    ];
    assert_eq!(kinds.map(UnprovenCause::family), UnprovenCauseFamily::ALL);
    let records = [0, 1, 2, 3].map(|index| {
        access(
            PROGRAM,
            0,
            KnowledgeLevel::Unknown,
            kinds[index],
            index as u32,
        )
    });

    assert_eq!(collected_kinds(&records, EVERY_FAMILY), kinds);
    for kind in kinds {
        let only = family_bit(kind.family());
        assert_eq!(collected_kinds(&records, only), [kind], "{kind:?}");
    }
    let two_families = ExplainSet::ONLY_MUTATION | ExplainSet::ONLY_LIMIT;
    assert_eq!(collected_kinds(&records, two_families), kinds[2..]);
}

#[test]
fn rank_prefers_program_accesses() {
    let mut records = vec![unknown_object(PROGRAM, 0, 300)];
    records.extend((0..5).map(|offset| unknown_object(DEPENDENCY, offset, 100)));
    records.extend((0..2).map(|offset| unknown_object(PROGRAM, 8 + offset, 400)));
    records.extend((0..6).map(|offset| unknown_object(DEPENDENCY, 8 + offset, 200)));
    let ranked: Vec<(Option<Position>, OriginCounts)> = collect(&records)
        .iter()
        .map(|cause| (cause.position, cause.accesses))
        .collect();
    assert_eq!(
        ranked,
        [
            (at(PROGRAM, 400), counts(2, 0)),
            (at(PROGRAM, 300), counts(1, 0)),
            (at(PROGRAM, 200), counts(0, 6)),
            (at(PROGRAM, 100), counts(0, 5)),
        ]
    );
}

#[test]
fn dependency_accesses_break_ties_of_program_accesses() {
    let records = [
        unknown_object(PROGRAM, 0, 100),
        unknown_object(PROGRAM, 4, 200),
        unknown_object(DEPENDENCY, 0, 200),
    ];
    let ranked: Vec<Option<Position>> = collect(&records).iter().map(|it| it.position).collect();
    assert_eq!(ranked, [at(PROGRAM, 200), at(PROGRAM, 100)]);
}

#[test]
fn rank_is_total() {
    type Rank = (Option<Position>, UnprovenCause, LimitId, IllTypedCause);
    let one = |cause, limit, witness_offset| AccessRecord {
        limit,
        ..access(PROGRAM, 0, KnowledgeLevel::Unknown, cause, witness_offset)
    };
    let mut records = [
        one(UnprovenCause::FieldDeleted, LimitId::None, 10),
        one(
            UnprovenCause::LimitReached,
            LimitId::MaxValueFlowEdgesLogged,
            10,
        ),
        one(UnprovenCause::UnknownObject, LimitId::None, 10),
        one(UnprovenCause::LimitReached, LimitId::MaxTypeNodes, 10),
        one(UnprovenCause::UnknownObject, LimitId::None, 5),
        AccessRecord {
            ill_typed_cause: IllTypedCause::Assertion,
            ..one(UnprovenCause::UnknownObject, LimitId::None, 10)
        },
    ];
    let rank = |records: &[AccessRecord]| -> Vec<Rank> {
        let causes = collect(records);
        let ranks = causes.iter();
        ranks
            .map(|it| (it.position, it.cause, it.limit, it.ill_typed_cause))
            .collect()
    };
    let ranked = rank(&records);
    let mut ascending = ranked.clone();
    ascending.sort_unstable();
    assert_eq!(ranked.len(), records.len());
    assert_eq!(ranked, ascending);
    records.reverse();
    assert_eq!(rank(&records), ranked);
}

#[test]
fn absent_witness_sorts_last() {
    let records = [
        with_witness_location(unknown_object(PROGRAM, 0, 0), NO_LOCATION),
        unknown_object(PROGRAM, 4, 900),
    ];
    let ranked: Vec<Option<Position>> = collect(&records).iter().map(|it| it.position).collect();
    assert_eq!(ranked, [at(PROGRAM, 900), None]);
}

#[test]
fn layouts_are_unique_and_sorted() {
    let records = [7, 2, ABSENT_WORD, 7, 5].map(|layout| AccessRecord {
        layout,
        ..unknown_object(PROGRAM, 0, 100)
    });
    let causes = collect(&records);
    assert_eq!(causes.len(), 1);
    assert_eq!(causes[0].layouts, layouts(&[2, 5, 7]));
}

#[test]
fn first_record_names_function() {
    let records = [
        with_witness_function(unknown_object(PROGRAM, 0, 100), 4),
        with_witness_function(unknown_object(PROGRAM, 4, 100), 9),
        unknown_object(PROGRAM, 8, 200),
    ];
    let causes = collect(&records);
    let functions: Vec<Option<FunctionId>> = causes.iter().map(|it| it.function).collect();
    assert_eq!(functions, [Some(FunctionId::from_word(4)), None]);
}

#[test]
fn share_has_three_forms() {
    let totals = totals([1000, 204, 9], [30, 10, 9]);
    let share = |accesses| {
        let cause = cause(UnprovenCause::UnknownObject, None, accesses);
        written(|out| write_share(out, &cause, &totals))
    };
    assert_eq!(share(counts(2, 0)), "2 of 1,204 untyped accesses");
    assert_eq!(
        share(counts(0, 3)),
        "3 of 40 untyped accesses in dependencies"
    );
    assert_eq!(
        share(counts(2, 3)),
        "2 of 1,204 untyped accesses, and 3 of 40 in dependencies"
    );
}

#[test]
fn share_of_one_access_is_singular() {
    let cause = cause(UnprovenCause::UnknownObject, None, counts(1, 0));
    let totals = totals([1, 0, 5], [0; 3]);
    assert_eq!(
        written(|out| write_share(out, &cause, &totals)),
        "1 of 1 untyped access"
    );
}

#[test]
fn text_entry_orders_notes() {
    let limit = LimitId::MaxValueFlowEdgesLogged;
    let cause = Cause {
        ill_typed_cause: IllTypedCause::Assertion,
        limit,
        function: Some(FunctionId::from_word(0)),
        layouts: layouts(&[0, 2]),
        ..cause(UnprovenCause::LimitReached, at(PROGRAM, 12), counts(2, 0))
    };
    let whole_cost = 8.0 * INSTRUCTIONS_OF_ACCESS_BY_NAME;
    let totals = totals([10, 0, 0], [0; 3]);
    let entry = text_entry(&cause, 3, &totals, &names(), 4096, whole_cost);
    let wording = cause_wording(UnprovenCause::LimitReached);

    assert_eq!(entry.kind, ExplainSet::TEXT);
    assert_eq!(entry.position, at(PROGRAM, 12));
    assert_eq!(
        text_of(&entry),
        format!("3. limit-reached: {}", wording.message)
    );
    assert_eq!(
        note_texts(&entry),
        [
            "2 of 10 untyped accesses".to_owned(),
            format!("about 25% {ESTIMATE}"),
            "in function 'render'".to_owned(),
            "types: 'Item', 'Order'".to_owned(),
            format!(
                "limit {} = 4,096 (limits {})",
                limit.name(),
                limit.purpose()
            ),
            format!(
                "why (unsound-cast): {}",
                why(IllTypedCause::Assertion).message
            ),
            format!("fix: {}", wording.fix),
            "https://bun.com/docs/bundler/aot-explain#limit-reached".to_owned(),
        ]
    );
    assert!(entry.notes.iter().all(|note| note.position.is_none()));
}

#[test]
fn absent_notes_are_omitted() {
    let cause = cause(UnprovenCause::FieldDeleted, at(PROGRAM, 12), counts(1, 0));
    let whole_cost = cause.cost.total();
    let totals = totals([1, 0, 0], [0; 3]);
    let entry = text_entry(&cause, 1, &totals, &names(), 4096, whole_cost);
    assert_eq!(
        note_texts(&entry),
        [
            "1 of 1 untyped access".to_owned(),
            format!("about 100% {ESTIMATE}"),
            format!("fix: {}", cause_wording(UnprovenCause::FieldDeleted).fix),
            "https://bun.com/docs/bundler/aot-explain#field-deleted".to_owned(),
        ]
    );
}

#[test]
fn text_entry_prints_code_of_wording() {
    for kind in UnprovenCause::ALL {
        let cause = cause(kind, at(PROGRAM, 12), counts(1, 0));
        let entry = text_entry(&cause, 1, &totals([1, 0, 0], [0; 3]), &names(), 0, 1.0);
        let code = cause_code(kind);
        assert!(
            entry.text.starts_with(format!("1. {code}: ").as_bytes()),
            "{kind:?}"
        );
        let url = note_texts(&entry).pop().expect("the link is the last note");
        assert_eq!(
            url,
            format!("https://bun.com/docs/bundler/aot-explain#{code}"),
            "{kind:?}"
        );
    }
    let untyped_code = cause(UnprovenCause::ReachesUnknownJavaScript, None, counts(1, 0));
    let entry = text_entry(
        &untyped_code,
        2,
        &totals([1, 0, 0], [0; 3]),
        &names(),
        0,
        1.0,
    );
    assert!(entry.text.starts_with(b"2. passed-to-untyped-code: "));
}

#[test]
fn list_and_json_entries_print_code_of_wording() {
    let (list, json) = list_and_json_entries(IllTypedCause::None);
    assert_eq!(
        list,
        "unknown-code: passed-to-untyped-code at src/a.ts:2:14, 1 access"
    );

    let url = r#""url":"https://bun.com/docs/bundler/aot-explain#passed-to-untyped-code""#;
    assert!(
        json.starts_with(r#"{"rank":1,"reason":"passed-to-untyped-code","#),
        "{json}"
    );
    assert!(json.contains(url), "{json}");
    assert!(
        json.ends_with(r#""family":"unknown-code","why":null}"#),
        "{json}"
    );
}

#[test]
fn list_and_json_entries_end_with_ill_typed_cause() {
    let (list, json) = list_and_json_entries(IllTypedCause::OutsideData);
    assert!(list.ends_with(", 1 access, why external-data"), "{list}");

    let IllTypedWording { message, fix, .. } = why(IllTypedCause::OutsideData);
    let fix = fix.replace('"', "\\\"");
    let url = "https://bun.com/docs/bundler/aot-explain#external-data";
    let member = format!(
        r#""why":{{"reason":"external-data","message":"{message}","fix":"{fix}","url":"{url}"}}}}"#
    );
    assert!(json.ends_with(&member), "{json}");
}

#[test]
fn unnamed_and_repeated_types_are_listed_once() {
    let cause = Cause {
        layouts: layouts(&[0, 1, 2, 3, 9]),
        ..cause(UnprovenCause::UnknownObject, None, counts(1, 0))
    };
    let names = names();
    assert_eq!(type_names(&cause, &names), [&b"Item"[..], b"Order"]);
}

#[test]
fn named_types_are_capped() {
    let type_names: [&[u8]; 10] = [b"A", b"B", b"C", b"D", b"E", b"F", b"G", b"H", b"I", b"J"];
    let list =
        |count: usize| written(|out| write_type_names(out, b"types: ", &type_names[..count]));
    assert_eq!(list(0), "");
    assert_eq!(list(1), "types: 'A'");
    assert_eq!(list(8), "types: 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'");
    assert_eq!(
        list(10),
        "types: 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H' and 2 more"
    );
}

#[test]
fn twenty_causes_are_shown() {
    let entries = text_entries(20);
    assert_eq!(entries.len(), 21);
    assert_eq!(
        text_of(&entries[0]),
        "Untyped code works, but runs slower. 20 causes:"
    );
    assert!(entries[1].text.starts_with(b"1. unknown-object: "));
    assert!(entries[20].text.starts_with(b"20. unknown-object: "));

    let entries = text_entries(22);
    assert_eq!(entries.len(), 22);
    assert_eq!(
        text_of(&entries[0]),
        "Untyped code works, but runs slower. 22 causes:"
    );
    assert!(entries[20].text.starts_with(b"20. unknown-object: "));
    assert_eq!(
        text_of(&entries[21]),
        "2 more causes not shown. Use --explain=json to print all of them, one JSON object per line."
    );
    assert!(entries.iter().all(|entry| entry.kind == ExplainSet::TEXT));
}

#[test]
fn heading_and_footer_count_one_cause_in_singular() {
    assert_eq!(
        text_of(&text_entries(1)[0]),
        "Untyped code works, but runs slower. 1 cause:"
    );
    let footer = text_entries(21).pop().expect("a footer");
    assert!(footer.text.starts_with(b"1 more cause not shown."));
}

#[test]
fn limit_value_is_asked_per_cause() {
    let reached = |limit, offset| Cause {
        limit,
        ..cause(
            UnprovenCause::LimitReached,
            at(PROGRAM, offset),
            counts(1, 0),
        )
    };
    let causes = [
        reached(LimitId::MaxTypeNodes, 0),
        reached(LimitId::MaxValueFlowEdgesLogged, 4),
    ];
    let value_of = |limit| {
        if limit == LimitId::MaxTypeNodes {
            3
        } else {
            70
        }
    };
    let mut entries = Vec::new();
    let totals = totals([2, 0, 0], [0; 3]);
    collect_text_entries(&causes, &totals, &names(), value_of, &mut entries);
    let limit_note = |entry: &ReportEntry| {
        let mut notes = note_texts(entry).into_iter();
        notes.find(|note| note.starts_with(b"limit ")).unwrap()
    };
    assert!(limit_note(&entries[1]).starts_with(b"limit MaxTypeNodes = 3 (limits "));
    assert!(limit_note(&entries[2]).starts_with(b"limit MaxValueFlowEdgesLogged = 70 (limits "));
}

#[test]
fn numbers_list_columns_levels_and_cause_count() {
    let mut totals = totals([1, 2, 3], [4, 5, 6]);
    totals.program.access_costs = CostCounts::from_words([1, 0, 1, 4]);
    totals.dependencies.access_costs = CostCounts::from_words([4, 3, 0, 8]);
    totals.program.calls = LevelCounts::from_words([7, 8, 9]);
    totals.dependencies.calls = LevelCounts::from_words([99; 3]);
    let entry = numbers_entry(&totals, 7);
    assert_eq!(entry.kind, ExplainSet::JSON);
    assert_eq!(entry.position, None);
    assert_eq!(
        text_of(&entry),
        concat!(
            r#"{"accesses":{"byName":1,"tested":1,"free":4,"#,
            r#""testedSlotOnly":1,"provenWithoutAnyTest":3},"#,
            r#""dependencyAccesses":{"byName":4,"tested":3,"free":8,"#,
            r#""testedSlotOnly":0,"provenWithoutAnyTest":6},"#,
            r#""calls":{"unknown":7,"guarded":8,"proven":9},"causes":7}"#,
        )
    );
}

#[test]
fn ranked_entries_are_created_by_position_and_listed_by_rank() {
    let causes = [at(DEPENDENCY, 0), None, at(PROGRAM, 9), at(PROGRAM, 2)]
        .map(|position| cause(UnprovenCause::UnknownObject, position, counts(1, 0)));
    let mut created = Vec::new();
    let mut entries = Vec::new();
    collect_ranked_entries(&causes, &mut entries, |cause, rank| {
        created.push(cause.position);
        ReportEntry::line(ExplainSet::JSON, rank.to_string().into_bytes())
    });
    assert_eq!(
        created,
        [None, at(PROGRAM, 2), at(PROGRAM, 9), at(DEPENDENCY, 0)]
    );
    let ranks: Vec<BString> = entries.iter().map(text_of).collect();
    assert_eq!(ranks, ["1", "2", "3", "4"]);
}

#[test]
fn no_cause_sentences() {
    let sentence = |totals, families| BString::from(no_cause_sentence(totals, families));
    let typed = totals([0, 0, 7], [0, 0, 2]);
    let untyped_dependency = totals([0, 0, 7], [0, 1, 0]);
    assert_eq!(
        sentence(&typed, EVERY_FAMILY),
        "Every property access is typed. Nothing to fix."
    );
    assert_eq!(
        sentence(&untyped_dependency, EVERY_FAMILY),
        "The compiler recorded no cause for the untyped property accesses."
    );
    for totals in [&typed, &untyped_dependency] {
        assert_eq!(
            sentence(totals, ExplainSet::ONLY_MUTATION),
            "No causes of this kind."
        );
    }
}
