use bstr::BString;
use bun_options_types::aot_options::ExplainSet;

use super::{collect_json, collect_text};
use crate::engine::testing::ResultRecords;
use crate::engine::{Position, SourceLocation, TypeTestRecord};
use crate::ir::generated::TypeTestFailure;
use crate::ir::ids::{ABSENT_WORD, ModuleId};
use crate::report::ReportEntry;
use crate::report::testing::{DEPENDENCY, LINE_2_COLUMN_14, PROGRAM, RUNTIME, ReportFixture};
use crate::report::wording::{GUARD_FIX, GUARD_HEADLINE, failure_code, failure_sentence};

const NO_LOCATION: SourceLocation = SourceLocation {
    module: ABSENT_WORD,
    position: 0,
};
const PROGRAM_FUNCTION: u32 = 0;
const RUNTIME_FUNCTION: u32 = 1;
const UNNAMED_FUNCTION: u32 = 9;
const ITEM: u32 = 0;
const UNNAMED_LAYOUT: u32 = 9;

const MAX_SHOWN: usize = 200;
const NO_GUARD: &str = "No type guard can fail at run time.";
const NOT_SHOWN: &str =
    " not shown. Use --explain=guards-json to print all of them, one JSON object per line.";

fn at(module: u32, offset: u32) -> Option<Position> {
    Some(Position {
        module: ModuleId::from_word(module),
        offset,
    })
}

fn guard(module: u32, position: u32) -> TypeTestRecord {
    TypeTestRecord {
        location: SourceLocation { module, position },
        function: ABSENT_WORD,
        failure: TypeTestFailure::ExitsToSlowVersion,
        copies: 1,
        layout: ABSENT_WORD,
    }
}

fn unlocated(function: u32) -> TypeTestRecord {
    TypeTestRecord {
        location: NO_LOCATION,
        function,
        ..guard(PROGRAM, 0)
    }
}

fn in_function(function: u32, record: TypeTestRecord) -> TypeTestRecord {
    TypeTestRecord { function, ..record }
}

fn property_read() -> TypeTestRecord {
    TypeTestRecord {
        function: PROGRAM_FUNCTION,
        copies: 3,
        layout: ITEM,
        ..guard(PROGRAM, LINE_2_COLUMN_14)
    }
}

fn fixture(records: &[TypeTestRecord]) -> ReportFixture<'_> {
    ReportFixture::new(ResultRecords {
        type_tests: records,
        ..ResultRecords::default()
    })
}

fn text_report(records: &[TypeTestRecord]) -> Vec<ReportEntry> {
    let mut entries = Vec::new();
    fixture(records).with_input(|input| collect_text(input, &mut entries));
    for entry in &entries {
        assert_eq!(entry.kind, ExplainSet::CHECKS);
    }
    entries
}

fn only_entry(record: TypeTestRecord) -> ReportEntry {
    let mut report = text_report(&[record]);
    assert_eq!(report.len(), 2);
    report.pop().expect("the entry of the guard")
}

fn json_lines(records: &[TypeTestRecord]) -> Vec<String> {
    let mut entries = Vec::new();
    fixture(records).with_input(|input| collect_json(input, &mut entries));
    entries
        .into_iter()
        .map(|entry| {
            assert_eq!(entry.kind, ExplainSet::CHECKS_JSON);
            assert!(entry.notes.is_empty());
            String::from_utf8(entry.text).expect("a line of JSON is UTF-8")
        })
        .collect()
}

fn copies_of(line: &str) -> u32 {
    let (_, rest) = line
        .split_once(r#""copies":"#)
        .expect("every guard has its number of copies");
    let end = rest.find(|character: char| !character.is_ascii_digit());
    rest[..end.unwrap_or(rest.len())]
        .parse()
        .expect("a number of copies")
}

fn listed_places(records: &[TypeTestRecord]) -> Vec<u32> {
    let numbered: Vec<TypeTestRecord> = (1..)
        .zip(records)
        .map(|(copies, &record)| TypeTestRecord { copies, ..record })
        .collect();
    let lines = json_lines(&numbered);
    lines.iter().map(|line| copies_of(line)).collect()
}

fn text_of(entry: &ReportEntry) -> BString {
    BString::from(&entry.text[..])
}

fn texts_of(entries: &[ReportEntry]) -> Vec<BString> {
    entries.iter().map(text_of).collect()
}

fn note_texts(entry: &ReportEntry) -> Vec<BString> {
    let notes = entry.notes.iter();
    notes.map(|note| BString::from(&note[..])).collect()
}

fn positions_of(report: &[ReportEntry]) -> Vec<Option<Position>> {
    report[1..].iter().map(|entry| entry.position).collect()
}

fn last_line(report: &[ReportEntry]) -> BString {
    text_of(report.last().expect("a report has a heading"))
}

fn notes_without_names(failure: TypeTestFailure) -> [String; 2] {
    [
        failure_sentence(failure).to_owned(),
        format!("fix: {GUARD_FIX}"),
    ]
}

fn assert_heading(report: &[ReportEntry], counted: &str) {
    let heading = &report[0];
    let start = format!("{counted} can fail at run time.");
    assert!(
        heading.text.starts_with(start.as_bytes()),
        "{}",
        text_of(heading)
    );
    assert_eq!((heading.position, heading.notes.len()), (None, 0));
}

#[test]
fn report_without_guard_is_one_heading() {
    assert_eq!(texts_of(&text_report(&[])), [NO_GUARD]);
    assert!(json_lines(&[]).is_empty());
}

#[test]
fn single_guard_is_singular() {
    assert_heading(&text_report(&[guard(PROGRAM, 0)]), "1 type guard");
}

#[test]
fn counts_have_digit_groups() {
    let report = text_report(&vec![guard(PROGRAM, 0); 1204]);
    assert_heading(&report, "1,204 type guards");
    assert_eq!(last_line(&report), format!("1,004 more guards{NOT_SHOWN}"));
}

#[test]
fn guards_in_modules_of_bun_are_left_out() {
    let records = [guard(RUNTIME, 0), guard(PROGRAM, 10), guard(DEPENDENCY, 10)];
    assert_eq!(listed_places(&records), [2, 3]);
    let report = text_report(&records);
    assert_heading(&report, "2 type guards");
    let listed = [at(PROGRAM, 10), at(DEPENDENCY, 10)];
    assert_eq!(positions_of(&report), listed);
    assert_eq!(texts_of(&text_report(&records[..1])), [NO_GUARD]);
}

#[test]
fn guard_without_location_is_in_module_of_function() {
    let records = [
        unlocated(RUNTIME_FUNCTION),
        unlocated(PROGRAM_FUNCTION),
        unlocated(UNNAMED_FUNCTION),
    ];
    assert_eq!(listed_places(&records), [2, 3]);
    assert_eq!(listed_places(&[unlocated(ABSENT_WORD)]), [1]);
}

#[test]
fn location_decides_before_function() {
    let inlined_into_bun = in_function(PROGRAM_FUNCTION, guard(RUNTIME, 0));
    let inlined_from_bun = in_function(RUNTIME_FUNCTION, guard(PROGRAM, 10));
    assert_eq!(listed_places(&[inlined_into_bun, inlined_from_bun]), [2]);
}

#[test]
fn guards_sort_by_position_then_function() {
    let records = [
        unlocated(PROGRAM_FUNCTION),
        guard(DEPENDENCY, 0),
        in_function(RUNTIME_FUNCTION, guard(PROGRAM, 20)),
        in_function(PROGRAM_FUNCTION, guard(PROGRAM, 20)),
        guard(PROGRAM, 3),
    ];
    assert_eq!(listed_places(&records), [5, 4, 3, 2, 1]);
    assert_eq!(
        positions_of(&text_report(&records)),
        [
            at(PROGRAM, 3),
            at(PROGRAM, 20),
            at(PROGRAM, 20),
            at(DEPENDENCY, 0),
            None,
        ]
    );
}

#[test]
fn text_entry_names_function_type_and_cost() {
    let text = format!("1. {GUARD_HEADLINE}").into_bytes();
    let mut expected = ReportEntry::at(ExplainSet::CHECKS, text, at(PROGRAM, LINE_2_COLUMN_14));
    expected.add_note(b"in function 'double'".to_vec());
    expected.add_note(b"type 'Item'".to_vec());
    for note in notes_without_names(TypeTestFailure::ExitsToSlowVersion) {
        expected.add_note(note.into_bytes());
    }
    assert_eq!(only_entry(property_read()), expected);
}

#[test]
fn text_entry_omits_absent_names() {
    let unnamed = TypeTestRecord {
        layout: UNNAMED_LAYOUT,
        ..unlocated(UNNAMED_FUNCTION)
    };
    for record in [unlocated(ABSENT_WORD), unnamed] {
        let entry = only_entry(record);
        assert_eq!(entry.position, None);
        assert_eq!(text_of(&entry), format!("1. {GUARD_HEADLINE}"));
        assert_eq!(
            note_texts(&entry),
            notes_without_names(TypeTestFailure::ExitsToSlowVersion)
        );
    }
}

#[test]
fn only_the_201st_guard_is_hidden() {
    let records = vec![guard(PROGRAM, 0); MAX_SHOWN + 1];
    let all_shown = text_report(&records[..MAX_SHOWN]);
    assert_eq!(all_shown.len(), 1 + MAX_SHOWN);
    assert!(last_line(&all_shown).starts_with(b"200. "));

    let one_hidden = text_report(&records);
    assert_eq!(one_hidden.len(), 1 + MAX_SHOWN + 1);
    assert_eq!(last_line(&one_hidden), format!("1 more guard{NOT_SHOWN}"));
}

#[test]
fn json_lists_every_guard() {
    let records = vec![guard(PROGRAM, 0); MAX_SHOWN + 5];
    assert_eq!(json_lines(&records).len(), MAX_SHOWN + 5);
}

#[test]
fn json_entry_orders_members() {
    let members = concat!(
        r#"{"aot":"type-check","file":"src/a.ts","line":2,"col":14,"function":"double","#,
        r#""failure":"leaves","copies":3,"type":"Item"}"#,
    );
    assert_eq!(json_lines(&[property_read()]), [members]);
}

#[test]
fn json_entry_without_location() {
    let members = concat!(
        r#"{"aot":"type-check","file":"","line":0,"col":0,"function":"","#,
        r#""failure":"leaves","copies":1,"type":""}"#,
    );
    assert_eq!(json_lines(&[unlocated(ABSENT_WORD)]), [members]);
}

#[test]
fn every_failure_has_its_sentence_and_code() {
    for failure in TypeTestFailure::ALL {
        let record = TypeTestRecord {
            failure,
            ..guard(PROGRAM, 0)
        };
        assert_eq!(
            note_texts(&only_entry(record)),
            notes_without_names(failure)
        );
        let lines = json_lines(&[record]);
        let member = format!(r#","failure":"{}","#, failure_code(failure));
        assert!(lines[0].contains(&member), "{}", lines[0]);
    }
}
