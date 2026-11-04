use bstr::BString;

use super::*;
use crate::engine::testing::ResultRecords;
use crate::engine::{AccessCountRecord, SourceLocation};
use crate::ir::generated::{KnowledgeLevel, Witness};
use crate::ir::ids::ABSENT_WORD;
use crate::report::testing::{
    DEPENDENCY, LINE_1_COLUMN_5, LINE_2_COLUMN_14, PROGRAM, RUNTIME, ReportFixture,
};
use crate::report::wording::IllTypedWording;

const NO_LOCATION: SourceLocation = SourceLocation {
    module: ABSENT_WORD,
    position: 0,
};
const EVERY_FAMILY: ExplainSet = ExplainSet::empty();
const COST_BY_NAME: u64 = 28;
const COST_TESTED: u64 = 2;
// The fixture names function 0 and layouts 0 and 1.
const DOUBLE: u32 = 0;
const ITEM: u32 = 0;
const ORDER: u32 = 1;
const UNNAMED_LAYOUT: u32 = 9;

type Collector = fn(&ReportInput<'_>, ExplainSet, &mut Vec<ReportEntry>);

fn location(module: u32, position: u32) -> SourceLocation {
    SourceLocation { module, position }
}

fn at(module: u32, offset: u32) -> Option<Position> {
    Some(Position {
        module: ModuleId::from_word(module),
        offset,
    })
}

fn access(
    module: u32,
    offset: u32,
    level: KnowledgeLevel,
    cause: UnprovenCause,
    witness_offset: u32,
) -> AccessRecord {
    AccessRecord {
        location: location(module, offset),
        kind: AccessKind::Read,
        level,
        cause,
        layout: ABSENT_WORD,
        copies: 1,
        distance: 0,
        witness: Witness {
            function: ABSENT_WORD,
            value: ABSENT_WORD,
            location: location(PROGRAM, witness_offset),
        },
        function: ABSENT_WORD,
        ill_typed_cause: IllTypedCause::None,
        cost: match level {
            KnowledgeLevel::Unknown => AccessCost::ByName,
            KnowledgeLevel::Expected => AccessCost::TestsReceiver,
            KnowledgeLevel::Proven => AccessCost::Free,
        },
        has_other_roots: 0,
        other_origins: 0,
        loop_depth: 0,
    }
}

fn by_name(module: u32, offset: u32, cause: UnprovenCause, witness_offset: u32) -> AccessRecord {
    let level = KnowledgeLevel::Unknown;
    access(module, offset, level, cause, witness_offset)
}

fn unknown_object(module: u32, offset: u32, witness_offset: u32) -> AccessRecord {
    by_name(module, offset, UnprovenCause::UnknownObject, witness_offset)
}

fn unknown_objects(module: u32, count: u32, witness_offset: u32) -> Vec<AccessRecord> {
    (0..count)
        .map(|offset| unknown_object(module, offset, witness_offset))
        .collect()
}

fn passed_to_untyped_code(module: u32, offset: u32) -> AccessRecord {
    let cause = UnprovenCause::ReachesUnknownJavaScript;
    by_name(module, offset, cause, LINE_2_COLUMN_14)
}

fn in_loop(record: AccessRecord) -> AccessRecord {
    AccessRecord {
        loop_depth: 1,
        ..record
    }
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

fn with_other_origins(record: AccessRecord, other_origins: u32) -> AccessRecord {
    AccessRecord {
        has_other_roots: 1,
        other_origins,
        ..record
    }
}

fn origins_in_program(offsets: &[u32]) -> OtherOriginsRecord {
    let mut locations = [NO_LOCATION; 3];
    for (slot, &offset) in locations.iter_mut().zip(offsets) {
        *slot = location(PROGRAM, offset);
    }
    OtherOriginsRecord { locations }
}

fn module_counts(module: u32, access_costs: [u32; 4]) -> AccessCountRecord {
    let [looked_up, tests_receiver, tests_slot, free] = access_costs;
    AccessCountRecord {
        module,
        accesses: [looked_up, tests_receiver + tests_slot, free],
        calls: [0; 3],
        type_tests: 0,
        access_costs,
    }
}

fn origin_of(module: ModuleId) -> ModuleOrigin {
    match module.to_word() {
        PROGRAM => ModuleOrigin::Program,
        DEPENDENCY => ModuleOrigin::Dependency,
        _ => ModuleOrigin::Runtime,
    }
}

fn collect(records: &[AccessRecord]) -> Vec<Cause> {
    collect_causes(records, &[], &origin_of, EVERY_FAMILY)
}

fn ranked(records: &[AccessRecord]) -> Vec<(Option<Position>, OriginCounts)> {
    let causes = collect(records);
    let ranked = causes.iter();
    ranked
        .map(|cause| (cause.position, cause.accesses))
        .collect()
}

fn counts(program: u64, dependencies: u64) -> OriginCounts {
    OriginCounts {
        program,
        dependencies,
    }
}

fn expected_cause(position: Option<Position>, accesses: OriginCounts) -> Cause {
    Cause {
        cause: UnprovenCause::UnknownObject,
        ill_typed_cause: IllTypedCause::None,
        position,
        function: None,
        layouts: Vec::new(),
        accesses,
        calls: OriginCounts::default(),
        operators: OriginCounts::default(),
        alone: accesses.total(),
        in_loops: 0,
        other_origins: Vec::new(),
        cost: counts(
            accesses.program * COST_BY_NAME,
            accesses.dependencies * COST_BY_NAME,
        ),
        cost_in_loops: OriginCounts::default(),
        is_in_runtime: false,
    }
}

struct FullCause {
    accesses: [AccessRecord; 5],
    other_origins: [OtherOriginsRecord; 1],
    access_counts: [AccessCountRecord; 3],
}

impl FullCause {
    fn new() -> FullCause {
        let operation = |module, offset, kind, layout| {
            let record = passed_to_untyped_code(module, offset);
            AccessRecord {
                kind,
                layout,
                witness: Witness {
                    function: DOUBLE,
                    ..record.witness
                },
                ill_typed_cause: IllTypedCause::OutsideData,
                ..record
            }
        };
        FullCause {
            accesses: [
                in_loop(operation(PROGRAM, 0, AccessKind::Read, ORDER)),
                with_other_origins(operation(PROGRAM, 4, AccessKind::Store, ITEM), 1),
                in_loop(operation(PROGRAM, 8, AccessKind::Call, ABSENT_WORD)),
                operation(PROGRAM, 12, AccessKind::Arithmetic, UNNAMED_LAYOUT),
                operation(DEPENDENCY, 0, AccessKind::Read, ITEM),
            ],
            other_origins: [origins_in_program(&[LINE_1_COLUMN_5])],
            access_counts: [
                AccessCountRecord {
                    calls: [1, 0, 2],
                    ..module_counts(PROGRAM, [10, 0, 1, 5])
                },
                module_counts(DEPENDENCY, [4, 0, 0, 0]),
                module_counts(RUNTIME, [50; 4]),
            ],
        }
    }

    fn records(&self) -> ResultRecords<'_> {
        ResultRecords {
            accesses: &self.accesses,
            other_origins: &self.other_origins,
            access_counts: &self.access_counts,
            ..ResultRecords::default()
        }
    }
}

fn accesses(records: &[AccessRecord]) -> ResultRecords<'_> {
    ResultRecords {
        accesses: records,
        ..ResultRecords::default()
    }
}

fn entries_of(
    collect: Collector,
    records: ResultRecords<'_>,
    families: ExplainSet,
) -> Vec<ReportEntry> {
    let mut entries = Vec::new();
    ReportFixture::new(records).with_input(|input| collect(input, families, &mut entries));
    entries
}

fn text_entries(records: ResultRecords<'_>) -> Vec<ReportEntry> {
    let entries = entries_of(collect_text, records, EVERY_FAMILY);
    assert!(entries.iter().all(|entry| entry.kind == ExplainSet::TEXT));
    entries
}

fn json_lines(records: ResultRecords<'_>) -> Vec<String> {
    let entries = entries_of(collect_json, records, EVERY_FAMILY);
    assert!(entries.iter().all(|entry| entry.kind == ExplainSet::JSON));
    let lines = entries.iter();
    lines.map(|entry| text_of(entry).to_string()).collect()
}

fn text_of(entry: &ReportEntry) -> BString {
    BString::from(&entry.text[..])
}

fn note_texts(entry: &ReportEntry) -> Vec<BString> {
    let notes = entry.notes.iter();
    notes.map(|note| BString::from(&note.text[..])).collect()
}

fn located_notes(entry: &ReportEntry) -> Vec<Option<Position>> {
    let positions = entry.notes.iter().map(|note| note.position);
    positions.filter(Option::is_some).collect()
}

fn why(cause: IllTypedCause) -> IllTypedWording {
    ill_typed_cause_wording(cause).expect("every cause but None has a wording")
}

#[test]
fn accesses_with_one_witness_share_cause() {
    let records = [
        unknown_object(PROGRAM, 0, 100),
        unknown_object(PROGRAM, 40, 100),
        unknown_object(DEPENDENCY, 8, 100),
    ];
    let shared = expected_cause(at(PROGRAM, 100), counts(2, 1));
    assert_eq!(collect(&records), [shared]);
}

#[test]
fn only_slow_operations_have_a_cause() {
    for cost in AccessCost::ALL {
        let count_causes = |kind| {
            let record = AccessRecord {
                kind,
                cost,
                ..unknown_object(PROGRAM, 0, 100)
            };
            collect(&[record]).len()
        };
        let found = [AccessKind::Read, AccessKind::Call].map(count_causes);
        let expected = [cost != AccessCost::Free, cost == AccessCost::ByName].map(usize::from);
        assert_eq!(found, expected, "{cost:?}");
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
    }
}

#[test]
fn copies_count_once_and_an_access_without_location_counts_as_program() {
    let record = unknown_object(PROGRAM, 0, 100);
    let records = [
        AccessRecord {
            copies: 5,
            ..record
        },
        AccessRecord {
            location: NO_LOCATION,
            ..record
        },
    ];
    for record in records {
        let counted = expected_cause(at(PROGRAM, 100), counts(1, 0));
        assert_eq!(collect(&[record]), [counted]);
    }
}

#[test]
fn operations_in_runtime_modules_are_not_counted() {
    let records = [
        unknown_object(RUNTIME, 0, LINE_1_COLUMN_5),
        unknown_object(RUNTIME, 4, LINE_1_COLUMN_5),
        unknown_object(PROGRAM, 0, LINE_1_COLUMN_5),
    ];
    let counted = expected_cause(at(PROGRAM, LINE_1_COLUMN_5), counts(1, 0));
    assert_eq!(collect(&records), [counted]);
    assert!(collect(&records[..2]).is_empty());

    let only = ExplainSet::ONLY_UNKNOWN_CODE;
    let list = entries_of(collect_list, accesses(&records[..2]), only);
    assert!(list.is_empty(), "{list:?}");
}

#[test]
fn cost_sums_every_operation_and_separately_those_in_loops() {
    let (tested, cause) = (KnowledgeLevel::Expected, UnprovenCause::UnknownObject);
    let deep_in_loops = AccessRecord {
        loop_depth: 9,
        ..unknown_object(PROGRAM, 4, 100)
    };
    let records = [
        unknown_object(PROGRAM, 0, 100),
        deep_in_loops,
        in_loop(access(DEPENDENCY, 0, tested, cause, 100)),
    ];
    let expected = Cause {
        in_loops: 2,
        cost: counts(2 * COST_BY_NAME, COST_TESTED),
        cost_in_loops: counts(COST_BY_NAME, COST_TESTED),
        ..expected_cause(at(PROGRAM, 100), counts(2, 1))
    };
    assert_eq!(collect(&records), [expected]);
}

#[test]
fn cause_in_a_loop_outranks_a_larger_one_outside_loops() {
    let mut records = unknown_objects(PROGRAM, 1200, 100);
    records.extend(unknown_objects(PROGRAM, 5, 200).into_iter().map(in_loop));
    assert_eq!(
        ranked(&records),
        [
            (at(PROGRAM, 200), counts(5, 0)),
            (at(PROGRAM, 100), counts(1200, 0)),
        ]
    );
}

#[test]
fn rank_prefers_the_program() {
    let records = [
        unknown_objects(PROGRAM, 1, 300),
        unknown_objects(DEPENDENCY, 5, 100),
        unknown_objects(PROGRAM, 2, 400),
        unknown_objects(DEPENDENCY, 6, 200),
        unknown_objects(PROGRAM, 1, 350),
        unknown_objects(DEPENDENCY, 1, 350),
        vec![in_loop(unknown_object(DEPENDENCY, 9, 500))],
    ]
    .concat();
    assert_eq!(
        ranked(&records),
        [
            (at(PROGRAM, 400), counts(2, 0)),
            (at(PROGRAM, 350), counts(1, 1)),
            (at(PROGRAM, 300), counts(1, 0)),
            (at(PROGRAM, 500), counts(0, 1)),
            (at(PROGRAM, 200), counts(0, 6)),
            (at(PROGRAM, 100), counts(0, 5)),
        ]
    );
}

#[test]
fn ties_are_broken_by_position_then_cause() {
    type Rank = (Option<Position>, UnprovenCause, IllTypedCause);
    let mut records = [
        by_name(PROGRAM, 0, UnprovenCause::FieldDeleted, 10),
        by_name(PROGRAM, 0, UnprovenCause::PropertyAdded, 10),
        unknown_object(PROGRAM, 0, 10),
        unknown_object(PROGRAM, 0, 5),
        AccessRecord {
            ill_typed_cause: IllTypedCause::Assertion,
            ..unknown_object(PROGRAM, 0, 10)
        },
    ];
    let rank = |records: &[AccessRecord]| -> Vec<Rank> {
        let causes = collect(records);
        let ranks = causes.iter();
        ranks
            .map(|it| (it.position, it.cause, it.ill_typed_cause))
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
fn what_the_program_cannot_fix_ranks_last() {
    let from_runtime = unknown_object(PROGRAM, 8, 0);
    let records = [
        in_loop(by_name(PROGRAM, 0, UnprovenCause::Unknown, 100)),
        in_loop(by_name(PROGRAM, 4, UnprovenCause::ResultDisabled, 100)),
        in_loop(with_witness_location(from_runtime, location(RUNTIME, 7))),
        unknown_object(PROGRAM, 12, 200),
    ];
    let found: Vec<(UnprovenCause, Option<Position>, bool)> = collect(&records)
        .iter()
        .map(|it| (it.cause, it.position, it.is_in_runtime))
        .collect();
    assert_eq!(
        found,
        [
            (UnprovenCause::UnknownObject, at(PROGRAM, 200), false),
            (UnprovenCause::Unknown, at(PROGRAM, 100), false),
            (UnprovenCause::ResultDisabled, at(PROGRAM, 100), false),
            (UnprovenCause::UnknownObject, at(RUNTIME, 7), true),
        ]
    );
}

#[test]
fn families_filter() {
    let families = [
        (
            UnprovenCause::UnprovenContents,
            ExplainSet::ONLY_UNPROVEN_TYPE,
        ),
        (UnprovenCause::UnknownObject, ExplainSet::ONLY_UNKNOWN_CODE),
        (UnprovenCause::FieldDeleted, ExplainSet::ONLY_MUTATION),
    ];
    let kinds = families.map(|(kind, _)| kind);
    assert_eq!(kinds.map(UnprovenCause::family), UnprovenCauseFamily::ALL);
    let records = [0, 1, 2].map(|index| by_name(PROGRAM, 0, kinds[index], index as u32));
    let collected = |families| -> Vec<UnprovenCause> {
        let causes = collect_causes(&records, &[], &origin_of, families);
        causes.iter().map(|cause| cause.cause).collect()
    };

    assert_eq!(collected(EVERY_FAMILY), kinds);
    for (kind, only) in families {
        assert_eq!(collected(only), [kind], "{kind:?}");
    }
    let two_families = ExplainSet::ONLY_UNKNOWN_CODE | ExplainSet::ONLY_MUTATION;
    assert_eq!(collected(two_families), kinds[1..]);
}

#[test]
fn other_origins_are_listed_once_without_the_entry_itself_and_the_runtime() {
    let mut lists = [
        origins_in_program(&[300, 200]),
        origins_in_program(&[200, 100]),
    ];
    lists[1].locations[2] = location(RUNTIME, 400);
    let records = [
        with_other_origins(unknown_object(PROGRAM, 0, 100), 1),
        with_other_origins(unknown_object(PROGRAM, 4, 100), 2),
        unknown_object(PROGRAM, 8, 100),
    ];
    let others = [at(PROGRAM, 200), at(PROGRAM, 300)].map(Option::unwrap);
    let expected = Cause {
        alone: 1,
        other_origins: others.to_vec(),
        ..expected_cause(at(PROGRAM, 100), counts(3, 0))
    };
    let causes = collect_causes(&records, &lists, &origin_of, EVERY_FAMILY);
    assert_eq!(causes, [expected]);
}

#[test]
fn text_shows_three_other_origins_and_json_all() {
    let lists = [
        origins_in_program(&[0, 4, 8]),
        origins_in_program(&[15, 19]),
    ];
    let records = [
        with_other_origins(unknown_object(PROGRAM, 0, LINE_2_COLUMN_14), 1),
        with_other_origins(unknown_object(PROGRAM, 4, LINE_2_COLUMN_14), 2),
    ];
    let records = ResultRecords {
        other_origins: &lists,
        ..accesses(&records)
    };

    let shown = located_notes(&text_entries(records)[1]);
    assert_eq!(shown, [at(PROGRAM, 0), at(PROGRAM, 4), at(PROGRAM, 8)]);

    let all = [(1, 1), (1, 5), (1, 9), (2, 1), (2, 5)]
        .map(|(line, column)| format!(r#"{{"file":"src/a.ts","line":{line},"column":{column}}}"#))
        .join(",");
    let member = format!(r#""fixedByThisAlone":0,"otherOrigins":[{all}],"#);
    let json = json_lines(records);
    assert!(json[1].contains(&member), "{}", json[1]);
}

#[test]
fn text_matches_the_example_in_the_documentation() {
    let cause = UnprovenCause::DataFromOutside;
    let from_json = |offset, kind, layout| AccessRecord {
        kind,
        layout,
        ill_typed_cause: IllTypedCause::OutsideData,
        ..in_loop(by_name(PROGRAM, offset, cause, LINE_2_COLUMN_14))
    };
    let records = [
        from_json(30, AccessKind::Arithmetic, ABSENT_WORD),
        from_json(36, AccessKind::Read, ITEM),
    ];
    let access_counts = [module_counts(PROGRAM, [1, 0, 0, 0])];
    let entries = text_entries(ResultRecords {
        access_counts: &access_counts,
        ..accesses(&records)
    });

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[1].position, at(PROGRAM, LINE_2_COLUMN_14));
    assert_eq!(
        text_of(&entries[1]),
        concat!(
            "1. external-data: The value comes from outside the program ",
            "(JSON.parse, response.json(), a file loaded at run time).",
        )
    );
    assert_eq!(
        note_texts(&entries[1]),
        [
            "1 of 1 untyped access",
            "1 untyped operator",
            "2 of these run in a loop",
            "types: 'Item'",
            "fix: check its fields, and build a new object of this type from them.",
            "https://bun.com/docs/compiler/explain#external-data",
        ]
    );
}

#[test]
fn text_entry_orders_notes() {
    let entries = text_entries(FullCause::new().records());
    let wording = cause_wording(UnprovenCause::ReachesUnknownJavaScript);
    assert_eq!(entries.len(), 2);
    let entry = &entries[1];

    assert_eq!(entry.position, at(PROGRAM, LINE_2_COLUMN_14));
    assert_eq!(
        text_of(entry),
        format!("1. passed-to-untyped-code: {}", wording.message)
    );
    assert_eq!(
        note_texts(entry),
        [
            "2 of 11 untyped accesses, and 1 of 4 in dependencies".to_owned(),
            "1 indirect call, 1 untyped operator".to_owned(),
            "2 of these run in a loop".to_owned(),
            "1 of these stays untyped until other entries are fixed too".to_owned(),
            "fix this too: the same operations also start here".to_owned(),
            "in function 'double'".to_owned(),
            "types: 'Item', 'Order'".to_owned(),
            format!(
                "why (external-data): {}",
                why(IllTypedCause::OutsideData).message
            ),
            format!("fix: {}", wording.fix),
            "https://bun.com/docs/compiler/explain#passed-to-untyped-code".to_owned(),
        ]
    );
    assert_eq!(located_notes(entry), [at(PROGRAM, LINE_1_COLUMN_5)]);
}

#[test]
fn one_operation_in_a_loop_is_singular() {
    let records = [
        in_loop(unknown_object(PROGRAM, 0, LINE_2_COLUMN_14)),
        unknown_object(PROGRAM, 4, LINE_2_COLUMN_14),
    ];
    let notes = note_texts(&text_entries(accesses(&records))[1]);
    assert_eq!(notes[1], "1 of these runs in a loop");
}

#[test]
fn absent_notes_are_omitted_and_share_can_cover_only_dependencies() {
    let records = unknown_objects(DEPENDENCY, 3, 100);
    let access_counts = [
        module_counts(PROGRAM, [1000, 204, 0, 9]),
        module_counts(DEPENDENCY, [30, 10, 0, 9]),
    ];
    let entries = text_entries(ResultRecords {
        access_counts: &access_counts,
        ..accesses(&records)
    });
    assert_eq!(
        note_texts(&entries[1]),
        [
            "3 of 40 untyped accesses in dependencies",
            "fix: build a new object of this type from it where it enters typed code.",
            "https://bun.com/docs/compiler/explain#unknown-object",
        ]
    );
}

#[test]
fn named_types_are_capped() {
    let type_names: [&[u8]; 10] = [b"A", b"B", b"C", b"D", b"E", b"F", b"G", b"H", b"I", b"J"];
    let list = |count: usize| {
        let mut out = Vec::new();
        write_type_names(&mut out, b"types: ", &type_names[..count]);
        BString::from(out)
    };
    assert_eq!(list(0), "");
    assert_eq!(list(8), "types: 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'");
    assert_eq!(
        list(10),
        "types: 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H' and 2 more"
    );
}

#[test]
fn twenty_causes_are_shown() {
    let heading = "Untyped code works, but runs slower.";
    let footer = "not shown. Use --explain=json to print all of them, one JSON object per line.";
    let lines = |count: u32| -> Vec<BString> {
        let records: Vec<AccessRecord> = (0..count)
            .map(|offset| unknown_object(PROGRAM, offset, offset))
            .collect();
        let entries = text_entries(accesses(&records));
        entries.iter().map(text_of).collect()
    };

    assert_eq!(lines(1)[0], format!("{heading} 1 cause:"));
    let twenty = lines(20);
    assert_eq!(twenty.len(), 21);
    assert_eq!(twenty[0], format!("{heading} 20 causes:"));
    assert!(twenty[1].starts_with(b"1. unknown-object: "));
    assert!(twenty[20].starts_with(b"20. unknown-object: "));
    assert_eq!(lines(21)[21], format!("1 more cause {footer}"));
    let more = lines(22);
    assert_eq!(more.len(), 22);
    assert!(more[20].starts_with(b"20. unknown-object: "));
    assert_eq!(more[21], format!("2 more causes {footer}"));
}

#[test]
fn no_cause_sentences() {
    let sentence = |costs_in_dependency, families| {
        let access_counts = [
            module_counts(PROGRAM, [0, 0, 0, 7]),
            module_counts(DEPENDENCY, costs_in_dependency),
        ];
        let records = ResultRecords {
            access_counts: &access_counts,
            ..ResultRecords::default()
        };
        let entries = entries_of(collect_text, records, families);
        assert_eq!(entries.len(), 1);
        text_of(&entries[0])
    };
    let (typed, untyped) = ([0, 0, 0, 2], [0, 1, 0, 0]);
    assert_eq!(
        sentence(typed, EVERY_FAMILY),
        "Every property access is typed. Nothing to fix."
    );
    assert_eq!(
        sentence(untyped, EVERY_FAMILY),
        "The compiler recorded no cause for the untyped property accesses."
    );
    for costs in [typed, untyped] {
        let only = ExplainSet::ONLY_MUTATION;
        assert_eq!(sentence(costs, only), "No causes of this kind.");
    }
}

#[test]
fn list_has_one_line_per_cause() {
    let only = ExplainSet::ONLY_UNKNOWN_CODE;
    let list = entries_of(collect_list, FullCause::new().records(), only);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].kind, only);
    assert_eq!(list[0].position, at(PROGRAM, LINE_2_COLUMN_14));
    assert!(list[0].notes.is_empty());
    assert_eq!(
        text_of(&list[0]),
        concat!(
            "unknown-code: passed-to-untyped-code at src/a.ts:2:14, 3 accesses, ",
            "1 indirect call, 1 untyped operator, types 'Item', 'Order', why external-data",
        )
    );
}

#[test]
fn list_is_labeled_by_family_and_ends_with_the_cause_without_position() {
    let records = [
        with_witness_location(unknown_object(PROGRAM, 0, 0), NO_LOCATION),
        passed_to_untyped_code(PROGRAM, 4),
        by_name(PROGRAM, 8, UnprovenCause::FieldDeleted, LINE_1_COLUMN_5),
    ];
    let (mutation, unknown_code) = (ExplainSet::ONLY_MUTATION, ExplainSet::ONLY_UNKNOWN_CODE);
    let list = entries_of(collect_list, accesses(&records), mutation | unknown_code);
    let kinds: Vec<ExplainSet> = list.iter().map(|entry| entry.kind).collect();
    let lines: Vec<BString> = list.iter().map(text_of).collect();
    assert_eq!(kinds, [mutation, unknown_code, unknown_code]);
    assert_eq!(
        lines,
        [
            "mutation: field-deleted at src/a.ts:1:5, 1 access",
            "unknown-code: passed-to-untyped-code at src/a.ts:2:14, 1 access",
            "unknown-code: unknown-object at (no location), 1 access",
        ]
    );
}

#[test]
fn json_has_numbers_then_every_member_of_a_cause() {
    let json = json_lines(FullCause::new().records());
    assert_eq!(json.len(), 2);
    assert_eq!(
        json[0],
        concat!(
            r#"{"accesses":{"byName":10,"tested":1,"free":5,"#,
            r#""testedSlotOnly":1,"provenWithoutAnyTest":5},"#,
            r#""dependencyAccesses":{"byName":4,"tested":0,"free":0,"#,
            r#""testedSlotOnly":0,"provenWithoutAnyTest":0},"#,
            r#""calls":{"unknown":1,"guarded":0,"proven":2},"causes":1}"#,
        )
    );

    let wording = cause_wording(UnprovenCause::ReachesUnknownJavaScript);
    let IllTypedWording { message, fix, .. } = why(IllTypedCause::OutsideData);
    let members_of_why = [
        r#""reason":"external-data""#,
        &format!(r#""message":"{message}""#),
        &format!(r#""fix":"{fix}""#),
        r#""url":"https://bun.com/docs/compiler/explain#external-data""#,
    ]
    .join(",");
    let members = [
        r#""rank":1,"reason":"passed-to-untyped-code","file":"src/a.ts","line":2,"column":14"#,
        r#""inDependency":false,"source":"let second = first.size;""#,
        &format!(r#""message":"{}","fix":"{}""#, wording.message, wording.fix),
        r#""url":"https://bun.com/docs/compiler/explain#passed-to-untyped-code""#,
        r#""accesses":2,"dependencyAccesses":1,"calls":1,"operators":1,"fixedByThisAlone":4"#,
        r#""otherOrigins":[{"file":"src/a.ts","line":1,"column":5}],"inLoops":2"#,
        r#""function":"double","types":["Item","Order"],"family":"unknown-code""#,
        &format!(r#""why":{{{members_of_why}}}"#),
    ]
    .join(",");
    assert_eq!(json[1], format!("{{{members}}}"));
}

#[test]
fn json_lists_causes_by_rank() {
    let in_dependency = unknown_object(DEPENDENCY, 0, 0);
    let records = [
        unknown_object(PROGRAM, 0, LINE_1_COLUMN_5),
        in_loop(unknown_object(PROGRAM, 4, LINE_2_COLUMN_14)),
        with_witness_location(in_dependency, location(DEPENDENCY, 0)),
    ];
    let json = json_lines(accesses(&records));
    let expected = [
        r#""file":"src/a.ts","line":2,"column":14,"inDependency":false,"#,
        r#""file":"src/a.ts","line":1,"column":5,"inDependency":false,"#,
        r#""file":"node_modules/b/b.js","line":1,"column":1,"inDependency":true,"#,
    ];
    assert_eq!(json.len(), 1 + expected.len());
    assert!(json[0].ends_with(r#","causes":3}"#), "{}", json[0]);
    for (index, members) in expected.into_iter().enumerate() {
        let rank = index + 1;
        let start = format!(r#"{{"rank":{rank},"reason":"unknown-object",{members}"#);
        assert!(json[rank].starts_with(&start), "{}", json[rank]);
        assert!(json[rank].ends_with(r#","why":null}"#), "{}", json[rank]);
    }
}

#[test]
fn why_with_the_same_code_as_the_entry_is_omitted() {
    let shown = |ill_typed_cause| {
        let cause = UnprovenCause::DataFromOutside;
        let records = [AccessRecord {
            ill_typed_cause,
            ..by_name(PROGRAM, 0, cause, LINE_2_COLUMN_14)
        }];
        let records = accesses(&records);
        let mut notes = note_texts(&text_entries(records)[1]);
        notes.retain(|note| note.starts_with(b"why ("));
        let list = entries_of(collect_list, records, ExplainSet::ONLY_UNKNOWN_CODE);
        (notes, json_lines(records).remove(1), text_of(&list[0]))
    };
    let list_without_why = "unknown-code: external-data at src/a.ts:2:14, 1 access";

    let (notes, json, list) = shown(IllTypedCause::OutsideData);
    assert!(notes.is_empty(), "{notes:?}");
    assert!(json.ends_with(r#","why":null}"#), "{json}");
    assert_eq!(list, list_without_why);

    let (notes, json, list) = shown(IllTypedCause::Assertion);
    let message = why(IllTypedCause::Assertion).message;
    let member = r#","why":{"reason":"unsound-cast","#;
    assert_eq!(notes, [format!("why (unsound-cast): {message}")]);
    assert!(json.contains(member), "{json}");
    assert_eq!(list, format!("{list_without_why}, why unsound-cast"));
}
