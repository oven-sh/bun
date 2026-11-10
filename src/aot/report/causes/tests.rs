use bstr::BString;

use super::*;
use crate::engine::testing::ResultRecords;
use crate::engine::{AccessCountRecord, SourceLocation};
use crate::ir::generated::KnowledgeLevel;
use crate::ir::ids::ABSENT_WORD;
use crate::report::testing::{
    DEPENDENCY, LINE_1_COLUMN_5, LINE_2_COLUMN_14, PROGRAM, RUNTIME, ReportFixture,
};

const NO_LOCATION: SourceLocation = SourceLocation {
    module: ABSENT_WORD,
    position: 0,
};
const COST_BY_NAME: u64 = 28;
const COST_TESTED: u64 = 2;
const DOUBLE: u32 = 0;
const ITEM: u32 = 0;
const ORDER: u32 = 1;
const UNNAMED_LAYOUT: u32 = 9;

type Collector = fn(&ReportInput<'_>, &mut Vec<ReportEntry>);

fn location(module: u32, position: u32) -> SourceLocation {
    SourceLocation { module, position }
}

fn at(module: u32, offset: u32) -> Option<Position> {
    Some(Position {
        module: ModuleId::from_word(module),
        offset,
    })
}

fn access(module: u32, offset: u32, level: KnowledgeLevel, cause: UnprovenCause) -> AccessRecord {
    AccessRecord {
        location: location(module, offset),
        kind: AccessKind::Read,
        level,
        cause,
        layout: ABSENT_WORD,
        copies: 1,
        function: ABSENT_WORD,
        cost: match level {
            KnowledgeLevel::Unknown => AccessCost::ByName,
            KnowledgeLevel::Expected => AccessCost::TestsReceiver,
            KnowledgeLevel::Proven => AccessCost::Free,
        },
        loop_depth: 0,
    }
}

fn by_name(module: u32, offset: u32, cause: UnprovenCause) -> AccessRecord {
    access(module, offset, KnowledgeLevel::Unknown, cause)
}

fn unknown_object(module: u32, offset: u32) -> AccessRecord {
    by_name(module, offset, UnprovenCause::UnknownObject)
}

fn unknown_objects(module: u32, count: usize, offset: u32) -> Vec<AccessRecord> {
    vec![unknown_object(module, offset); count]
}

fn in_loop(record: AccessRecord) -> AccessRecord {
    AccessRecord {
        loop_depth: 1,
        ..record
    }
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
    collect_causes(records, &origin_of)
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
        position,
        function: None,
        layouts: Vec::new(),
        accesses,
        calls: OriginCounts::default(),
        operators: OriginCounts::default(),
        in_loops: 0,
        cost: counts(
            accesses.program * COST_BY_NAME,
            accesses.dependencies * COST_BY_NAME,
        ),
        cost_in_loops: OriginCounts::default(),
    }
}

struct FullCause {
    accesses: [AccessRecord; 4],
    access_counts: [AccessCountRecord; 3],
}

impl FullCause {
    fn new() -> FullCause {
        let operation = |kind, layout| AccessRecord {
            kind,
            layout,
            function: DOUBLE,
            ..by_name(PROGRAM, LINE_2_COLUMN_14, UnprovenCause::UnknownCallee)
        };
        FullCause {
            accesses: [
                in_loop(operation(AccessKind::Read, ORDER)),
                operation(AccessKind::Store, ITEM),
                in_loop(operation(AccessKind::Call, ABSENT_WORD)),
                operation(AccessKind::Arithmetic, UNNAMED_LAYOUT),
            ],
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

fn entries_of(collect: Collector, records: ResultRecords<'_>) -> Vec<ReportEntry> {
    let mut entries = Vec::new();
    ReportFixture::new(records).with_input(|input| collect(input, &mut entries));
    entries
}

fn text_entries(records: ResultRecords<'_>) -> Vec<ReportEntry> {
    let entries = entries_of(collect_text, records);
    assert!(entries.iter().all(|entry| entry.kind == ExplainSet::TEXT));
    entries
}

fn json_lines(records: ResultRecords<'_>) -> Vec<String> {
    let entries = entries_of(collect_json, records);
    assert!(entries.iter().all(|entry| entry.kind == ExplainSet::JSON));
    let lines = entries.iter();
    lines.map(|entry| text_of(entry).to_string()).collect()
}

fn text_of(entry: &ReportEntry) -> BString {
    BString::from(&entry.text[..])
}

fn note_texts(entry: &ReportEntry) -> Vec<BString> {
    let notes = entry.notes.iter();
    notes.map(|note| BString::from(&note[..])).collect()
}

#[test]
fn accesses_at_one_place_share_cause() {
    let read = unknown_object(PROGRAM, 100);
    let store = AccessRecord {
        kind: AccessKind::Store,
        ..read
    };
    let records = [read, store, unknown_object(DEPENDENCY, 100)];
    assert_eq!(
        collect(&records),
        [
            expected_cause(at(PROGRAM, 100), counts(2, 0)),
            expected_cause(at(DEPENDENCY, 100), counts(0, 1)),
        ]
    );
}

#[test]
fn only_slow_operations_have_a_cause() {
    for cost in AccessCost::ALL {
        let count_causes = |kind| {
            let record = AccessRecord {
                kind,
                cost,
                ..unknown_object(PROGRAM, 100)
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
            ..unknown_object(PROGRAM, 100)
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
    let record = unknown_object(PROGRAM, 100);
    let copied = AccessRecord {
        copies: 5,
        ..record
    };
    let unlocated = AccessRecord {
        location: NO_LOCATION,
        ..record
    };
    for (record, position) in [(copied, at(PROGRAM, 100)), (unlocated, None)] {
        let counted = expected_cause(position, counts(1, 0));
        assert_eq!(collect(&[record]), [counted]);
    }
}

#[test]
fn operations_in_runtime_modules_are_not_counted() {
    let records = [
        unknown_object(RUNTIME, 0),
        unknown_object(RUNTIME, 4),
        unknown_object(PROGRAM, LINE_1_COLUMN_5),
    ];
    let counted = expected_cause(at(PROGRAM, LINE_1_COLUMN_5), counts(1, 0));
    assert_eq!(collect(&records), [counted]);
    assert!(collect(&records[..2]).is_empty());
}

#[test]
fn cost_sums_every_operation_and_separately_those_in_loops() {
    let (tested, cause) = (KnowledgeLevel::Expected, UnprovenCause::UnknownObject);
    let deep_in_loops = AccessRecord {
        loop_depth: 9,
        ..unknown_object(PROGRAM, 100)
    };
    let records = [
        unknown_object(PROGRAM, 100),
        deep_in_loops,
        in_loop(access(PROGRAM, 100, tested, cause)),
    ];
    let expected = Cause {
        in_loops: 2,
        cost: counts(2 * COST_BY_NAME + COST_TESTED, 0),
        cost_in_loops: counts(COST_BY_NAME + COST_TESTED, 0),
        ..expected_cause(at(PROGRAM, 100), counts(3, 0))
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
        vec![in_loop(unknown_object(DEPENDENCY, 500))],
    ]
    .concat();
    assert_eq!(
        ranked(&records),
        [
            (at(PROGRAM, 400), counts(2, 0)),
            (at(PROGRAM, 300), counts(1, 0)),
            (at(DEPENDENCY, 500), counts(0, 1)),
            (at(DEPENDENCY, 200), counts(0, 6)),
            (at(DEPENDENCY, 100), counts(0, 5)),
        ]
    );
}

#[test]
fn ties_are_broken_by_position_then_cause() {
    type Rank = (Option<Position>, UnprovenCause);
    let mut records = [
        by_name(PROGRAM, 10, UnprovenCause::Untracked),
        by_name(PROGRAM, 10, UnprovenCause::UnknownCallee),
        unknown_object(PROGRAM, 10),
        unknown_object(PROGRAM, 5),
    ];
    let rank = |records: &[AccessRecord]| -> Vec<Rank> {
        let causes = collect(records);
        let ranks = causes.iter();
        ranks.map(|it| (it.position, it.cause)).collect()
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
    let records = [
        in_loop(by_name(PROGRAM, 100, UnprovenCause::Unknown)),
        unknown_object(PROGRAM, 200),
    ];
    let found: Vec<(UnprovenCause, Option<Position>)> = collect(&records)
        .iter()
        .map(|it| (it.cause, it.position))
        .collect();
    assert_eq!(
        found,
        [
            (UnprovenCause::UnknownObject, at(PROGRAM, 200)),
            (UnprovenCause::Unknown, at(PROGRAM, 100)),
        ]
    );
}

#[test]
fn text_matches_the_example_in_the_documentation() {
    let records = [in_loop(AccessRecord {
        layout: ITEM,
        ..unknown_object(PROGRAM, LINE_2_COLUMN_14)
    })];
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
            "1. unknown-object: The compiler doesn't know the shape of this object, ",
            "so the access is a lookup or needs a shape check.",
        )
    );
    assert_eq!(
        note_texts(&entries[1]),
        [
            "1 of 1 untyped access",
            "1 of these runs in a loop",
            "types: 'Item'",
            "fix: that depends on where the object comes from. See the table at the link below.",
            "https://bun.com/docs/compiler/explain#unknown-object",
        ]
    );
}

#[test]
fn text_entry_orders_notes() {
    let entries = text_entries(FullCause::new().records());
    let wording = cause_wording(UnprovenCause::UnknownCallee);
    assert_eq!(entries.len(), 2);
    let entry = &entries[1];

    assert_eq!(entry.position, at(PROGRAM, LINE_2_COLUMN_14));
    assert_eq!(
        text_of(entry),
        format!("1. unknown-callee: {}", wording.message)
    );
    assert_eq!(
        note_texts(entry),
        [
            "2 of 11 untyped accesses".to_owned(),
            "1 indirect call, 1 untyped operator".to_owned(),
            "2 of these run in a loop".to_owned(),
            "in function 'double'".to_owned(),
            "types: 'Item', 'Order'".to_owned(),
            format!("fix: {}", wording.fix),
            "https://bun.com/docs/compiler/explain#unknown-callee".to_owned(),
        ]
    );
}

#[test]
fn one_operation_in_a_loop_is_singular() {
    let records = [
        in_loop(unknown_object(PROGRAM, LINE_2_COLUMN_14)),
        unknown_object(PROGRAM, LINE_2_COLUMN_14),
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
            "fix: that depends on where the object comes from. See the table at the link below.",
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
            .map(|offset| unknown_object(PROGRAM, offset))
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
    let sentence = |costs_in_dependency| {
        let access_counts = [
            module_counts(PROGRAM, [0, 0, 0, 7]),
            module_counts(DEPENDENCY, costs_in_dependency),
        ];
        let records = ResultRecords {
            access_counts: &access_counts,
            ..ResultRecords::default()
        };
        let entries = entries_of(collect_text, records);
        assert_eq!(entries.len(), 1);
        text_of(&entries[0])
    };
    assert_eq!(
        sentence([0, 0, 0, 2]),
        "Every property access is typed. Nothing to fix."
    );
    assert_eq!(
        sentence([0, 1, 0, 0]),
        "The compiler recorded no cause for the untyped property accesses."
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

    let wording = cause_wording(UnprovenCause::UnknownCallee);
    let members = [
        r#""rank":1,"reason":"unknown-callee","file":"src/a.ts","line":2,"column":14"#,
        r#""inDependency":false,"source":"let second = first.size;""#,
        &format!(r#""message":"{}","fix":"{}""#, wording.message, wording.fix),
        r#""url":"https://bun.com/docs/compiler/explain#unknown-callee""#,
        r#""accesses":2,"dependencyAccesses":0,"calls":1,"operators":1,"inLoops":2"#,
        r#""function":"double","types":["Item","Order"]"#,
    ]
    .join(",");
    assert_eq!(json[1], format!("{{{members}}}"));
}

#[test]
fn json_lists_causes_by_rank() {
    let records = [
        unknown_object(PROGRAM, LINE_1_COLUMN_5),
        in_loop(unknown_object(PROGRAM, LINE_2_COLUMN_14)),
        unknown_object(DEPENDENCY, 0),
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
    }
}
