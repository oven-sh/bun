use core::ops::Range;

use bstr::BString;

use super::*;
use crate::engine::SourceLocation;
use crate::engine::testing::ResultRecords;
use crate::ir::generated::TypeSiteKind;
use crate::ir::ids::ABSENT_WORD;
use crate::report::testing::{
    DEPENDENCY, LINE_1_COLUMN_5, LINE_2_COLUMN_14, NO_LOCATION, PROGRAM, PROGRAM_FUNCTION, RUNTIME,
    RUNTIME_FUNCTION, ReportFixture, at, location, names, witness,
};

const CAN_FAIL: &str =
    " can fail at run time. When one fails, the function falls back to its slow path.";
const NOT_SHOWN: &str =
    " not shown. Use --explain=guards-json to print all of them, one JSON object per line.";

fn check(id: u64, module: u32, position: u32, cause: CheckCause) -> RemainingCheckRecord {
    RemainingCheckRecord {
        id,
        witness: witness(ABSENT_WORD, location(module, position)),
        origin: NO_LOCATION,
        cause,
        site_kind: TypeSiteKind::Unknown,
    }
}

fn unlocated(id: u64, function: u32) -> RemainingCheckRecord {
    RemainingCheckRecord {
        witness: witness(function, NO_LOCATION),
        ..check(id, PROGRAM, 0, CheckCause::AddedByPass)
    }
}

fn checks(positions: Range<u32>, cause: CheckCause) -> Vec<RemainingCheckRecord> {
    positions
        .map(|position| check(u64::from(position), PROGRAM, position, cause))
        .collect()
}

fn property_read() -> RemainingCheckRecord {
    RemainingCheckRecord {
        id: 0xD29C_4CCC_BB35,
        witness: witness(PROGRAM_FUNCTION, location(PROGRAM, LINE_2_COLUMN_14)),
        origin: location(PROGRAM, LINE_1_COLUMN_5),
        cause: CheckCause::MayFail,
        site_kind: TypeSiteKind::PropertyRead,
    }
}

fn fixture(records: &[RemainingCheckRecord]) -> ReportFixture<'_> {
    ReportFixture::new(ResultRecords {
        remaining_checks: records,
        ..ResultRecords::default()
    })
}

fn text_report(fixture: &ReportFixture<'_>) -> Vec<ReportEntry> {
    let mut entries = Vec::new();
    fixture.with_input(|input| collect_text(input, &mut entries));
    entries
}

fn json_report(fixture: &ReportFixture<'_>) -> Vec<ReportEntry> {
    let mut entries = Vec::new();
    fixture.with_input(|input| collect_json(input, &mut entries));
    entries
}

fn texts_of(entries: &[ReportEntry]) -> Vec<BString> {
    let texts = entries.iter().map(|entry| &entry.text[..]);
    texts.map(BString::from).collect()
}

fn listed_ids(records: &[RemainingCheckRecord]) -> Vec<u64> {
    let checks = listed_checks(records, &names());
    checks.iter().map(|check| check.id).collect()
}

fn headings(causes: &[CheckCause]) -> Vec<BString> {
    let records: Vec<RemainingCheckRecord> = causes
        .iter()
        .zip(0..)
        .map(|(&cause, id)| check(id, PROGRAM, 0, cause))
        .collect();
    let checks: Vec<&RemainingCheckRecord> = records.iter().collect();
    let mut out = Vec::new();
    write_headings(&count_by_cause(&checks), &mut out);
    out.into_iter().map(BString::from).collect()
}

fn json_position(position: Option<&SourcePosition>) -> BString {
    let mut json = JsonWriter::object();
    write_position_members(&mut json, position, "col");
    BString::from(json.finish())
}

#[test]
fn runtime_checks_are_dropped() {
    let records = [
        check(1, RUNTIME, 10, CheckCause::MayFail),
        check(2, PROGRAM, 10, CheckCause::MayFail),
        check(3, DEPENDENCY, 10, CheckCause::MayFail),
    ];
    assert_eq!(listed_ids(&records), [2, 3]);
}

#[test]
fn check_without_location_is_in_module_of_function() {
    let records = [
        unlocated(1, RUNTIME_FUNCTION),
        unlocated(2, PROGRAM_FUNCTION),
        unlocated(3, ABSENT_WORD),
    ];
    assert_eq!(listed_ids(&records), [2, 3]);
}

#[test]
fn location_decides_before_function() {
    let inlined_from_runtime = RemainingCheckRecord {
        witness: witness(RUNTIME_FUNCTION, location(PROGRAM, 10)),
        ..check(1, PROGRAM, 10, CheckCause::MayFail)
    };
    assert_eq!(listed_ids(&[inlined_from_runtime]), [1]);
}

#[test]
fn checks_sort_by_position_then_id() {
    let records = [
        unlocated(1, ABSENT_WORD),
        check(2, DEPENDENCY, 0, CheckCause::MayFail),
        check(5, PROGRAM, 20, CheckCause::MayFail),
        check(4, PROGRAM, 20, CheckCause::UnknownObject),
        check(9, PROGRAM, 3, CheckCause::MayFail),
        unlocated(0, ABSENT_WORD),
    ];
    assert_eq!(listed_ids(&records), [9, 4, 5, 2, 0, 1]);
}

#[test]
fn checks_at_one_position_are_not_merged() {
    let records = [
        check(1, PROGRAM, 10, CheckCause::MayFail),
        check(2, PROGRAM, 10, CheckCause::MayFail),
    ];
    assert_eq!(listed_ids(&records), [1, 2]);
}

#[test]
fn id_is_twelve_hex_digits() {
    let id = |id| BString::from(id_text(id));
    assert_eq!(id(0), "000000000000");
    assert_eq!(id(0xABC), "000000000abc");
    assert_eq!(id(0xD29C_4CCC_BB35), "d29c4cccbb35");
}

#[test]
fn headings_count_causes_in_order() {
    let causes = [
        CheckCause::MayFail,
        CheckCause::UnknownObject,
        CheckCause::MayFail,
    ];
    assert_eq!(
        headings(&causes),
        [
            format!("3 type guards{CAN_FAIL}"),
            "By cause: 1 on a value from untyped code, 2 on a value of the wrong type.".to_owned(),
        ]
    );
}

#[test]
fn single_check_is_singular() {
    assert_eq!(
        headings(&[CheckCause::UnknownCallee]),
        [
            format!("1 type guard{CAN_FAIL}"),
            "By cause: 1 on the result of an unknown callee.".to_owned(),
        ]
    );
}

#[test]
fn no_check_has_one_heading() {
    assert_eq!(headings(&[]), ["No type guard can fail at run time."]);
}

#[test]
fn headings_name_every_cause() {
    let counted: Vec<String> = CheckCause::ALL
        .iter()
        .map(|&cause| format!("1 {}", check_wording(cause).counted_as))
        .collect();
    assert_eq!(
        headings(&CheckCause::ALL),
        [
            format!("{} type guards{CAN_FAIL}", CheckCause::COUNT),
            format!("By cause: {}.", counted.join(", ")),
        ]
    );
}

#[test]
fn heading_counts_have_digit_groups() {
    let mut counts = [0; CheckCause::COUNT];
    counts[CheckCause::MayFail as usize] = 1204;
    let mut out = Vec::new();
    write_headings(&counts, &mut out);
    let lines: Vec<BString> = out.into_iter().map(BString::from).collect();
    assert_eq!(
        lines,
        [
            format!("1,204 type guards{CAN_FAIL}"),
            "By cause: 1,204 on a value of the wrong type.".to_owned(),
        ]
    );
}

#[test]
fn json_position_has_three_members() {
    let position = SourcePosition {
        path: b"src/a.ts".to_vec(),
        line: 6,
        column: 20,
    };
    assert_eq!(
        json_position(Some(&position)),
        r#"{"file":"src/a.ts","line":6,"col":20}"#
    );
}

#[test]
fn absent_json_position_is_empty() {
    assert_eq!(json_position(None), r#"{"file":"","line":0,"col":0}"#);
}

#[test]
fn report_without_check_is_one_heading() {
    let report = text_report(&fixture(&[]));
    assert_eq!(texts_of(&report), ["No type guard can fail at run time."]);
    assert!(json_report(&fixture(&[])).is_empty());
}

#[test]
fn text_entry_names_type_and_function() {
    let note = |text: String, position| EntryNote {
        text: text.into_bytes(),
        position,
    };
    let wording = check_wording(CheckCause::MayFail);
    let expected = ReportEntry {
        kind: ExplainSet::CHECKS,
        text: format!("1. {}", wording.headline).into_bytes(),
        position: at(PROGRAM, LINE_2_COLUMN_14),
        notes: vec![
            note(
                "The type is declared here.".to_owned(),
                at(PROGRAM, LINE_1_COLUMN_5),
            ),
            note("in function 'double'".to_owned(), None),
            note(format!("fix: {}", wording.fix), None),
            note("id d29c4cccbb35 (property)".to_owned(), None),
        ],
    };
    let report = text_report(&fixture(&[property_read()]));
    assert_eq!(report.len(), 3);
    assert_eq!(report[2], expected);
}

#[test]
fn text_entry_omits_absent_notes() {
    let report = text_report(&fixture(&[unlocated(7, ABSENT_WORD)]));
    let entry = &report[2];
    let wording = check_wording(CheckCause::AddedByPass);
    assert_eq!(entry.position, None);
    assert_eq!(
        BString::from(&entry.text[..]),
        format!("1. {}", wording.headline)
    );
    let notes = entry.notes.iter().map(|note| BString::from(&note.text[..]));
    let notes: Vec<BString> = notes.collect();
    assert_eq!(
        notes,
        [
            format!("fix: {}", wording.fix),
            "id 000000000007 (unknown)".to_owned(),
        ]
    );
}

#[test]
fn type_note_points_at_origin() {
    let type_note_position = |origin: SourceLocation| {
        let records = [RemainingCheckRecord {
            origin,
            ..property_read()
        }];
        let report = text_report(&fixture(&records));
        let mut notes = report[2].notes.iter();
        let note = notes.find(|note| note.text == b"The type is declared here.");
        note.map(|note| note.position)
    };
    assert_eq!(
        type_note_position(location(PROGRAM, LINE_1_COLUMN_5)),
        Some(at(PROGRAM, LINE_1_COLUMN_5))
    );
    assert_eq!(
        type_note_position(location(DEPENDENCY, 0)),
        Some(at(DEPENDENCY, 0))
    );
    assert_eq!(type_note_position(NO_LOCATION), None);
    assert_eq!(
        type_note_position(location(PROGRAM, LINE_2_COLUMN_14)),
        None
    );
    assert_eq!(type_note_position(location(RUNTIME, 0)), None);
}

#[test]
fn text_caps_checks_per_cause() {
    let mut records = checks(0..205, CheckCause::MayFail);
    records.extend(checks(205..208, CheckCause::UnknownObject));
    let report = texts_of(&text_report(&fixture(&records)));
    assert_eq!(report.len(), 2 + 203 + 1);
    assert_eq!(report[0], format!("208 type guards{CAN_FAIL}"));
    for (number, entry) in (1..=203).zip(&report[2..]) {
        assert!(
            entry.starts_with(format!("{number}. ").as_bytes()),
            "{entry}"
        );
    }
    assert!(report[201].starts_with(b"200. a value of the wrong type reaches this guard"));
    assert!(report[202].starts_with(b"201. the value may come from untyped code"));
    assert_eq!(report[205], format!("5 more guards{NOT_SHOWN}"));
}

#[test]
fn two_hundred_checks_of_one_cause_are_all_shown() {
    let report = text_report(&fixture(&checks(0..200, CheckCause::MayFail)));
    assert_eq!(report.len(), 2 + 200);
    assert!(report[201].text.starts_with(b"200. "));
}

#[test]
fn single_skipped_check_is_singular() {
    let report = texts_of(&text_report(&fixture(&checks(0..201, CheckCause::MayFail))));
    assert_eq!(report[202], format!("1 more guard{NOT_SHOWN}"));
}

#[test]
fn json_lists_every_check() {
    let records: Vec<RemainingCheckRecord> = (0..205)
        .map(|id| check(id, PROGRAM, 0, CheckCause::MayFail))
        .collect();
    let report = json_report(&fixture(&records));
    assert_eq!(report.len(), 205);
    assert!(
        report
            .iter()
            .all(|entry| entry.kind == ExplainSet::CHECKS_JSON)
    );
}

#[test]
fn logging_build_lists_no_check() {
    let records = [property_read()];
    let mut fixture = fixture(&records);
    fixture.options.reports_type_mismatches = true;
    let report = text_report(&fixture);
    assert_eq!(
        report,
        [ReportEntry::line(
            ExplainSet::CHECKS,
            LOGGING_BUILD_NOTE.to_vec()
        )]
    );
    assert!(LOGGING_BUILD_NOTE.starts_with(b"A build with --aot-log-type-mismatches doesn't rely"));
    assert!(json_report(&fixture).is_empty());
}

#[test]
fn json_entry_orders_members() {
    let records = [RemainingCheckRecord {
        cause: CheckCause::UnknownObject,
        ..property_read()
    }];
    let report = json_report(&fixture(&records));
    assert_eq!(
        texts_of(&report),
        [concat!(
            r#"{"aot":"type-check","cause":"untyped-value","#,
            r#""file":"src/a.ts","line":2,"col":14,"function":"double","#,
            r#""kind":"property","id":"d29c4cccbb35","#,
            r#""type":{"file":"src/a.ts","line":1,"col":5}}"#,
        )]
    );
    assert_eq!(report[0].kind, ExplainSet::CHECKS_JSON);
    assert_eq!(report[0].position, at(PROGRAM, LINE_2_COLUMN_14));
    assert!(report[0].notes.is_empty());
}

#[test]
fn json_entry_without_location() {
    let report = json_report(&fixture(&[unlocated(7, ABSENT_WORD)]));
    assert_eq!(
        texts_of(&report),
        [concat!(
            r#"{"aot":"type-check","cause":"added-by-compiler","#,
            r#""file":"","line":0,"col":0,"function":"","#,
            r#""kind":"unknown","id":"000000000007"}"#,
        )]
    );
    assert_eq!(report[0].position, None);
}

#[test]
fn json_cause_is_code_of_wording() {
    for cause in CheckCause::ALL {
        let report = texts_of(&json_report(&fixture(&[check(1, PROGRAM, 0, cause)])));
        let start = format!(
            r#"{{"aot":"type-check","cause":"{}","#,
            guard_cause_code(cause)
        );
        assert!(report[0].starts_with(start.as_bytes()), "{}", report[0]);
    }
}

#[test]
fn json_type_needs_text_of_origin() {
    let records = [RemainingCheckRecord {
        origin: location(RUNTIME, 0),
        ..property_read()
    }];
    let report = texts_of(&json_report(&fixture(&records)));
    assert!(
        report[0].ends_with(br#""id":"d29c4cccbb35"}"#),
        "{}",
        report[0]
    );
}
