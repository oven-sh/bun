use bstr::BString;
use bun_options_types::aot_options::ExplainSet;

use super::{collect_json, collect_text};
use crate::engine::testing::ResultRecords;
use crate::engine::{Position, SourceLocation, TypeTestRecord, Witness};
use crate::ir::generated::{IllTypedCause, TypeTestFailure, UnprovenCause};
use crate::ir::ids::{ABSENT_WORD, ModuleId};
use crate::report::testing::{
    DEPENDENCY, LINE_1_COLUMN_5, LINE_2_COLUMN_14, PROGRAM, RUNTIME, ReportFixture,
};
use crate::report::wording::{
    GuardClass, failure_code, failure_sentence, guard_cause_code, guard_class, guard_wording,
    ill_typed_cause_wording,
};
use crate::report::{EntryNote, ReportEntry};

const NO_LOCATION: SourceLocation = SourceLocation {
    module: ABSENT_WORD,
    position: 0,
};
const PROGRAM_FUNCTION: u32 = 0;
const RUNTIME_FUNCTION: u32 = 1;
const UNNAMED_FUNCTION: u32 = 9;
const ITEM: u32 = 0;
const UNNAMED_LAYOUT: u32 = 9;
const MODULE_WITHOUT_TEXT: u32 = 9;

const FROM_UNTYPED_CODE: UnprovenCause = UnprovenCause::UnknownObject;
const HEADINGS: usize = 2;
const NAME_NOTES: usize = 2;
const MAX_SHOWN: usize = 200;
const NO_GUARD: &str = "No type guard can fail at run time.";
const NOT_SHOWN: &str =
    " not shown. Use --explain=guards-json to print all of them, one JSON object per line.";
const PROPERTY_READ_MEMBERS: &str = concat!(
    r#"{"aot":"type-check","cause":"untyped-value","#,
    r#""file":"src/a.ts","line":2,"col":14,"function":"double","#,
    r#""failure":"leaves","copies":3,"type":"Item""#,
);

fn location(module: u32, position: u32) -> SourceLocation {
    SourceLocation { module, position }
}

fn at(module: u32, offset: u32) -> Option<Position> {
    Some(Position {
        module: ModuleId::from_word(module),
        offset,
    })
}

fn witness_at(location: SourceLocation) -> Witness {
    Witness {
        function: ABSENT_WORD,
        value: ABSENT_WORD,
        location,
    }
}

fn guard(module: u32, position: u32, cause: UnprovenCause) -> TypeTestRecord {
    TypeTestRecord {
        location: location(module, position),
        function: ABSENT_WORD,
        failure: TypeTestFailure::Leaves,
        copies: 1,
        cause,
        ill_typed_cause: IllTypedCause::None,
        layout: ABSENT_WORD,
        witness: witness_at(NO_LOCATION),
    }
}

fn unlocated(function: u32) -> TypeTestRecord {
    TypeTestRecord {
        location: NO_LOCATION,
        function,
        ..guard(PROGRAM, 0, FROM_UNTYPED_CODE)
    }
}

fn in_function(function: u32, record: TypeTestRecord) -> TypeTestRecord {
    TypeTestRecord { function, ..record }
}

fn with_ill_typed_cause(ill_typed_cause: IllTypedCause, record: TypeTestRecord) -> TypeTestRecord {
    TypeTestRecord {
        ill_typed_cause,
        ..record
    }
}

fn property_read_from(source: SourceLocation) -> TypeTestRecord {
    TypeTestRecord {
        function: PROGRAM_FUNCTION,
        copies: 3,
        layout: ITEM,
        witness: witness_at(source),
        ..guard(PROGRAM, LINE_2_COLUMN_14, UnprovenCause::DataFromOutside)
    }
}

fn cause_of(class: GuardClass) -> UnprovenCause {
    let mut causes = UnprovenCause::ALL.into_iter();
    causes
        .find(|&cause| guard_class(cause) == class)
        .expect("every class but ReadBeforeInitialized has a cause")
}

fn guard_of_class(class: GuardClass, position: u32) -> TypeTestRecord {
    if class == GuardClass::ReadBeforeInitialized {
        let record = guard(PROGRAM, position, UnprovenCause::Unknown);
        return with_ill_typed_cause(IllTypedCause::ReadBeforeInitialized, record);
    }
    guard(PROGRAM, position, cause_of(class))
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
    assert_eq!(report.len(), HEADINGS + 1);
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
    notes.map(|note| BString::from(&note.text[..])).collect()
}

fn positions_of(report: &[ReportEntry]) -> Vec<Option<Position>> {
    let guards = report[HEADINGS..].iter();
    guards.map(|entry| entry.position).collect()
}

fn last_line(report: &[ReportEntry]) -> BString {
    text_of(report.last().expect("a report has a heading"))
}

fn notes_without_names(failure: TypeTestFailure, class: GuardClass) -> [String; 2] {
    [
        failure_sentence(failure).to_owned(),
        format!("fix: {}", guard_wording(class).fix),
    ]
}

fn property_read_entry(source: Option<Position>) -> ReportEntry {
    let wording = guard_wording(GuardClass::UnknownObject);
    let text = format!("1. {}", wording.headline).into_bytes();
    let mut entry = ReportEntry::at(ExplainSet::CHECKS, text, at(PROGRAM, LINE_2_COLUMN_14));
    if source.is_some() {
        entry.notes.push(EntryNote {
            text: b"The value comes from here.".to_vec(),
            position: source,
        });
    }
    entry.add_note(b"in function 'double'".to_vec());
    entry.add_note(b"type 'Item'".to_vec());
    for note in notes_without_names(TypeTestFailure::Leaves, GuardClass::UnknownObject) {
        entry.add_note(note.into_bytes());
    }
    entry
}

fn why_note(cause: IllTypedCause) -> EntryNote {
    let why = ill_typed_cause_wording(cause).expect("every cause but None has a wording");
    EntryNote {
        text: format!("why ({}): {}", why.code, why.message).into_bytes(),
        position: None,
    }
}

fn assert_json_cause(record: TypeTestRecord, class: GuardClass) {
    let lines = json_lines(&[record]);
    let code = guard_cause_code(class);
    let start = format!(r#"{{"aot":"type-check","cause":"{code}","#);
    assert!(lines[0].starts_with(&start), "{}", lines[0]);
}

fn assert_headings(report: &[ReportEntry], counted: &str, by_cause: &str) {
    let (total, classes) = (&report[0], &report[1]);
    let start = format!("{counted} can fail at run time.");
    assert!(
        total.text.starts_with(start.as_bytes()),
        "{}",
        text_of(total)
    );
    assert_eq!(text_of(classes), format!("By cause: {by_cause}."));
    for heading in [total, classes] {
        assert_eq!((heading.position, heading.notes.len()), (None, 0));
    }
}

#[test]
fn report_without_guard_is_one_heading() {
    assert_eq!(texts_of(&text_report(&[])), [NO_GUARD]);
    assert!(json_lines(&[]).is_empty());
}

#[test]
fn headings_count_classes_in_their_order() {
    let records = [
        guard(PROGRAM, 0, UnprovenCause::DataFromOutside),
        guard(PROGRAM, 1, UnprovenCause::Unknown),
        guard(PROGRAM, 2, UnprovenCause::UnknownObject),
    ];
    assert_headings(
        &text_report(&records),
        "3 type guards",
        "2 on a value whose type isn't proven, 1 with no recorded reason",
    );
}

#[test]
fn single_guard_is_singular() {
    let records = [guard(PROGRAM, 0, UnprovenCause::ResultOfUnknownCallee)];
    assert_headings(
        &text_report(&records),
        "1 type guard",
        "1 on the result of an unknown callee",
    );
}

#[test]
fn counts_have_digit_groups() {
    let report = text_report(&vec![guard(PROGRAM, 0, FROM_UNTYPED_CODE); 1204]);
    assert_headings(
        &report,
        "1,204 type guards",
        "1,204 on a value whose type isn't proven",
    );
    assert_eq!(last_line(&report), format!("1,004 more guards{NOT_SHOWN}"));
}

#[test]
fn every_class_has_its_count_headline_and_fix() {
    let records: Vec<TypeTestRecord> = (0..)
        .zip(GuardClass::ALL)
        .map(|(position, class)| guard_of_class(class, position))
        .collect();
    let report = text_report(&records);
    let counted = GuardClass::ALL.map(|class| format!("1 {}", guard_wording(class).counted_as));
    assert_headings(
        &report,
        &format!("{} type guards", GuardClass::COUNT),
        &counted.join(", "),
    );
    assert_eq!(report.len(), HEADINGS + GuardClass::COUNT);
    for ((number, class), entry) in (1..).zip(GuardClass::ALL).zip(&report[HEADINGS..]) {
        let headline = guard_wording(class).headline;
        assert_eq!(text_of(entry), format!("{number}. {headline}"));
        assert_eq!(
            note_texts(entry),
            notes_without_names(TypeTestFailure::Leaves, class)
        );
    }
}

#[test]
fn every_failure_has_its_sentence_and_code() {
    for failure in TypeTestFailure::ALL {
        let record = TypeTestRecord {
            failure,
            ..guard(PROGRAM, 0, FROM_UNTYPED_CODE)
        };
        assert_eq!(
            note_texts(&only_entry(record)),
            notes_without_names(failure, GuardClass::UnknownObject)
        );
        let lines = json_lines(&[record]);
        let member = format!(r#","failure":"{}","#, failure_code(failure));
        assert!(lines[0].contains(&member), "{}", lines[0]);
    }
}

#[test]
fn guards_in_modules_of_bun_are_left_out() {
    let records = [
        guard(RUNTIME, 0, FROM_UNTYPED_CODE),
        guard(PROGRAM, 10, FROM_UNTYPED_CODE),
        guard(DEPENDENCY, 10, FROM_UNTYPED_CODE),
    ];
    assert_eq!(listed_places(&records), [2, 3]);
    let report = text_report(&records);
    assert_headings(
        &report,
        "2 type guards",
        "2 on a value whose type isn't proven",
    );
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
    let inlined_into_bun = in_function(PROGRAM_FUNCTION, guard(RUNTIME, 0, FROM_UNTYPED_CODE));
    let inlined_from_bun = in_function(RUNTIME_FUNCTION, guard(PROGRAM, 10, FROM_UNTYPED_CODE));
    assert_eq!(listed_places(&[inlined_into_bun, inlined_from_bun]), [2]);
}

#[test]
fn guards_sort_by_position_then_function() {
    let records = [
        unlocated(PROGRAM_FUNCTION),
        guard(DEPENDENCY, 0, FROM_UNTYPED_CODE),
        in_function(RUNTIME_FUNCTION, guard(PROGRAM, 20, FROM_UNTYPED_CODE)),
        in_function(PROGRAM_FUNCTION, guard(PROGRAM, 20, UnprovenCause::Unknown)),
        guard(PROGRAM, 3, FROM_UNTYPED_CODE),
    ];
    assert_eq!(listed_places(&records), [5, 4, 3, 2, 1]);

    let report = text_report(&records);
    assert_eq!(
        positions_of(&report),
        [
            at(PROGRAM, 3),
            at(PROGRAM, 20),
            at(PROGRAM, 20),
            at(DEPENDENCY, 0),
            None,
        ]
    );
    let headline = guard_wording(GuardClass::NotRecorded).headline;
    assert_eq!(text_of(&report[HEADINGS + 1]), format!("2. {headline}"));
}

#[test]
fn text_entry_names_source_function_type_and_cost() {
    assert_eq!(
        only_entry(property_read_from(location(PROGRAM, LINE_1_COLUMN_5))),
        property_read_entry(at(PROGRAM, LINE_1_COLUMN_5))
    );
}

#[test]
fn witness_equal_to_location_gives_no_note() {
    assert_eq!(
        only_entry(property_read_from(location(PROGRAM, LINE_2_COLUMN_14))),
        property_read_entry(None)
    );
}

#[test]
fn witness_without_location_or_text_gives_no_note() {
    for source in [NO_LOCATION, location(MODULE_WITHOUT_TEXT, 0)] {
        assert_eq!(
            only_entry(property_read_from(source)),
            property_read_entry(None)
        );
    }
}

#[test]
fn why_note_stands_between_type_and_failure() {
    let record = with_ill_typed_cause(IllTypedCause::OutsideData, property_read_from(NO_LOCATION));
    let mut expected = property_read_entry(None);
    let why = why_note(IllTypedCause::OutsideData);
    expected.notes.insert(NAME_NOTES, why);
    assert_eq!(only_entry(record), expected);
}

#[test]
fn why_note_with_code_of_class_is_left_out() {
    let repeated = [
        (UnprovenCause::UnknownCallee, IllTypedCause::UnprovenCallee),
        (
            UnprovenCause::UnprovenContents,
            IllTypedCause::ContainerWriterUnseen,
        ),
    ];
    for (cause, ill_typed_cause) in repeated {
        let record = with_ill_typed_cause(ill_typed_cause, guard(PROGRAM, 0, cause));
        assert_eq!(
            note_texts(&only_entry(record)),
            notes_without_names(TypeTestFailure::Leaves, guard_class(cause))
        );
    }
}

#[test]
fn text_entry_omits_absent_names() {
    let unnamed = TypeTestRecord {
        layout: UNNAMED_LAYOUT,
        ..unlocated(UNNAMED_FUNCTION)
    };
    let headline = guard_wording(GuardClass::UnknownObject).headline;
    for record in [unlocated(ABSENT_WORD), unnamed] {
        let entry = only_entry(record);
        assert_eq!(entry.position, None);
        assert_eq!(text_of(&entry), format!("1. {headline}"));
        assert_eq!(
            note_texts(&entry),
            notes_without_names(TypeTestFailure::Leaves, GuardClass::UnknownObject)
        );
    }
}

#[test]
fn text_shows_at_most_200_guards_of_a_class() {
    let mut records = vec![guard(PROGRAM, 0, UnprovenCause::Unknown); MAX_SHOWN + 5];
    records.extend([guard(PROGRAM, 1, FROM_UNTYPED_CODE); 3]);
    let report = text_report(&records);
    assert_headings(
        &report,
        "208 type guards",
        "3 on a value whose type isn't proven, 205 with no recorded reason",
    );
    assert_eq!(report.len(), HEADINGS + MAX_SHOWN + 3 + 1);
    for (number, entry) in (1..=MAX_SHOWN + 3).zip(&report[HEADINGS..]) {
        let class = if number <= MAX_SHOWN {
            GuardClass::NotRecorded
        } else {
            GuardClass::UnknownObject
        };
        let headline = guard_wording(class).headline;
        assert_eq!(text_of(entry), format!("{number}. {headline}"));
    }
    assert_eq!(last_line(&report), format!("5 more guards{NOT_SHOWN}"));
}

#[test]
fn causes_of_one_class_share_its_200() {
    let mut records = vec![guard(PROGRAM, 0, UnprovenCause::UnknownObject); 150];
    records.extend([guard(PROGRAM, 1, UnprovenCause::DataFromOutside); 100]);
    let report = text_report(&records);
    assert_eq!(report.len(), HEADINGS + MAX_SHOWN + 1);
    assert_eq!(last_line(&report), format!("50 more guards{NOT_SHOWN}"));
}

#[test]
fn only_the_201st_guard_of_a_class_is_hidden() {
    let records = vec![guard(PROGRAM, 0, FROM_UNTYPED_CODE); MAX_SHOWN + 1];
    let all_shown = text_report(&records[..MAX_SHOWN]);
    assert_eq!(all_shown.len(), HEADINGS + MAX_SHOWN);
    assert!(last_line(&all_shown).starts_with(b"200. "));

    let one_hidden = text_report(&records);
    assert_eq!(one_hidden.len(), HEADINGS + MAX_SHOWN + 1);
    assert_eq!(last_line(&one_hidden), format!("1 more guard{NOT_SHOWN}"));
}

#[test]
fn json_lists_every_guard() {
    let records = vec![guard(PROGRAM, 0, FROM_UNTYPED_CODE); MAX_SHOWN + 5];
    assert_eq!(json_lines(&records).len(), MAX_SHOWN + 5);
}

#[test]
fn json_entry_orders_members() {
    let sources = [
        (
            location(PROGRAM, LINE_1_COLUMN_5),
            r#","from":{"file":"src/a.ts","line":1,"col":5}}"#,
        ),
        (
            location(DEPENDENCY, 0),
            r#","from":{"file":"node_modules/b/b.js","line":1,"col":1}}"#,
        ),
    ];
    for (source, members) in sources {
        assert_eq!(
            json_lines(&[property_read_from(source)]),
            [[PROPERTY_READ_MEMBERS, members].concat()]
        );
    }
}

#[test]
fn json_entry_without_witness_names_no_source() {
    for source in [NO_LOCATION, location(MODULE_WITHOUT_TEXT, 0)] {
        assert_eq!(
            json_lines(&[property_read_from(source)]),
            [[PROPERTY_READ_MEMBERS, "}"].concat()]
        );
    }
}

#[test]
fn json_entry_without_location() {
    let lines = json_lines(&[unlocated(ABSENT_WORD)]);
    let start = concat!(
        r#"{"aot":"type-check","cause":"untyped-value","#,
        r#""file":"","line":0,"col":0,"function":"","#,
        r#""failure":"leaves","copies":1"#,
    );
    assert!(lines[0].starts_with(start), "{}", lines[0]);
    assert!(!lines[0].contains(r#""from""#), "{}", lines[0]);
}

#[test]
fn json_cause_is_code_of_class() {
    for cause in UnprovenCause::ALL {
        assert_json_cause(guard(PROGRAM, 0, cause), guard_class(cause));
    }
}

#[test]
fn read_before_initialization_decides_class_before_cause() {
    for cause in UnprovenCause::ALL {
        let record = with_ill_typed_cause(
            IllTypedCause::ReadBeforeInitialized,
            guard(PROGRAM, 0, cause),
        );
        assert_json_cause(record, GuardClass::ReadBeforeInitialized);
    }
}
