use crate::ir::generated::NameClass;
use crate::ir::{Id, StringId, StringTable};
use crate::link::LinkUnit;
use crate::link::state::{MergedStrings, UnitMarks};
use crate::link::strings::merge_strings;
use crate::link::testing::{
    Projects, finish_unit, forward, mark_everything, reverse, with_test_files,
};
use crate::lower::FragmentBuilder;
use bun_sema::program::FileId;

fn create_unit(projects: &Projects<'_, '_>, file: u32, texts: &[&[u8]]) -> LinkUnit {
    let mut fragment = FragmentBuilder::new(FileId(file));
    for text in texts {
        fragment.strings.intern(text);
    }
    finish_unit(projects, fragment)
}

fn mark_all(units: &[LinkUnit]) -> Vec<UnitMarks> {
    units.iter().map(mark_everything).collect()
}

fn find_local_id(units: &[LinkUnit], unit: usize, text: &[u8]) -> StringId {
    units[unit]
        .strings
        .find(text)
        .expect("the unit has no such string")
}

fn clear_mark(marks: &mut [UnitMarks], units: &[LinkUnit], unit: usize, text: &[u8]) {
    marks[unit].strings[find_local_id(units, unit, text).index()] = false;
}

fn find_program_id(
    merged: &MergedStrings,
    units: &[LinkUnit],
    unit: usize,
    text: &[u8],
) -> Option<StringId> {
    merged.local_to_program[unit][find_local_id(units, unit, text).index()]
}

fn table_texts(table: &StringTable) -> Vec<&[u8]> {
    table.ids().map(|id| table.get(id)).collect()
}

fn table_contents(table: &StringTable) -> Vec<(u64, NameClass, &[u8])> {
    let ids = table.ids();
    ids.map(|id| (table.hash(id), table.name_class(id), table.get(id)))
        .collect()
}

fn assert_contents_match(units: &[LinkUnit], merged: &MergedStrings) {
    assert_eq!(merged.local_to_program.len(), units.len());
    for (unit, program_ids) in units.iter().zip(&merged.local_to_program) {
        assert_eq!(program_ids.len(), unit.strings.len());
        for (local, program_id) in unit.strings.ids().zip(program_ids) {
            let Some(program_id) = *program_id else {
                continue;
            };
            let (table, strings) = (&merged.table, &unit.strings);
            assert_eq!(table.get(program_id), strings.get(local));
            assert_eq!(table.hash(program_id), strings.hash(local));
            assert_eq!(table.name_class(program_id), strings.name_class(local));
            assert_eq!(table.builtin_name(program_id), strings.builtin_name(local));
        }
    }
}

#[test]
fn shared_string_has_one_program_id() {
    with_test_files(|projects, _| {
        let units = [
            create_unit(projects, 0, &[b"a", b"b"]),
            create_unit(projects, 1, &[b"c", b"a"]),
            create_unit(projects, 2, &[b"a"]),
        ];
        let merged = merge_strings(&units, &mark_all(&units), &forward);
        assert_contents_match(&units, &merged);
        assert_eq!(merged.table.len(), 3);
        let a = merged.table.find(b"a");
        assert!(a.is_some());
        for unit in 0..units.len() {
            assert_eq!(find_program_id(&merged, &units, unit, b"a"), a);
        }
    });
}

fn in_text_order<'a>(texts: &[&'a [u8]]) -> Vec<&'a [u8]> {
    let mut texts = texts.to_vec();
    texts.sort_unstable();
    texts
}

#[test]
fn order_of_interning_in_a_unit_does_not_change_ids() {
    with_test_files(|projects, _| {
        let first = [create_unit(projects, 0, &[b"b", b"c", b"a"])];
        let second = [create_unit(projects, 0, &[b"a", b"b", b"c"])];
        let first = merge_strings(&first, &mark_all(&first), &forward);
        let second = merge_strings(&second, &mark_all(&second), &forward);
        assert_eq!(table_texts(&first.table), table_texts(&second.table));
    });
}

#[test]
fn strings_are_numbered_by_first_retaining_unit_and_then_by_text() {
    with_test_files(|projects, _| {
        let texts: Vec<String> = (0..100).map(|number| format!("string {number}")).collect();
        let texts: Vec<&[u8]> = texts.iter().map(|text| text.as_bytes()).collect();
        let units = [
            create_unit(projects, 0, &texts[50..]),
            create_unit(projects, 1, &texts),
        ];
        let mut marks = mark_all(&units);
        let merged = merge_strings(&units, &marks, &forward);
        let expected_texts = [in_text_order(&texts[50..]), in_text_order(&texts[..50])].concat();
        assert_eq!(table_texts(&merged.table), expected_texts);

        clear_mark(&mut marks, &units, 0, texts[50]);
        let merged = merge_strings(&units, &marks, &forward);
        let expected_texts = [in_text_order(&texts[51..]), in_text_order(&texts[..51])].concat();
        assert_eq!(table_texts(&merged.table), expected_texts);
    });
}

#[test]
fn unmarked_string_is_dropped() {
    with_test_files(|projects, _| {
        let units = [
            create_unit(projects, 0, &[b"retained", b"dropped", b"shared"]),
            create_unit(projects, 1, &[b"shared"]),
        ];
        let mut marks = mark_all(&units);
        clear_mark(&mut marks, &units, 0, b"dropped");
        clear_mark(&mut marks, &units, 0, b"shared");
        let merged = merge_strings(&units, &marks, &forward);
        assert_contents_match(&units, &merged);
        assert_eq!(merged.table.len(), 2);
        assert_eq!(merged.table.find(b"dropped"), None);
        assert_eq!(find_program_id(&merged, &units, 0, b"dropped"), None);
        assert_eq!(find_program_id(&merged, &units, 0, b"shared"), None);
        assert!(find_program_id(&merged, &units, 0, b"retained").is_some());
        assert!(find_program_id(&merged, &units, 1, b"shared").is_some());
    });
}

#[test]
fn name_class_and_builtin_name_carry_over() {
    with_test_files(|projects, _| {
        let units = [create_unit(
            projects,
            0,
            &[b"7", b"length", b"ordinary text"],
        )];
        let merged = merge_strings(&units, &mark_all(&units), &forward);
        assert_contents_match(&units, &merged);
        let index = merged.table.find(b"7").expect("the string is retained");
        assert_eq!(merged.table.name_class(index), NameClass::Index);
        let length = merged
            .table
            .find(b"length")
            .expect("the string is retained");
        assert!(merged.table.builtin_name(length).is_some());
        let text = merged.table.find(b"ordinary text");
        let text = text.expect("the string is retained");
        assert_eq!(merged.table.name_class(text), NameClass::Ordinary);
        assert_eq!(merged.table.builtin_name(text), None);
    });
}

#[test]
fn merges_strings_without_decoding() {
    with_test_files(|projects, _| {
        let texts: [&[u8]; 3] = [b"", b"\xED\xA0\x80", b"\xFF"];
        let units = [
            create_unit(projects, 0, &texts),
            create_unit(projects, 1, &[texts[2], texts[1], texts[0]]),
        ];
        let merged = merge_strings(&units, &mark_all(&units), &forward);
        assert_contents_match(&units, &merged);
        assert_eq!(merged.table.len(), texts.len());
        for text in texts {
            let program_id = merged.table.find(text);
            assert!(program_id.is_some());
            assert_eq!(find_program_id(&merged, &units, 0, text), program_id);
            assert_eq!(find_program_id(&merged, &units, 1, text), program_id);
        }
    });
}

#[test]
fn task_order_does_not_change_table() {
    with_test_files(|projects, _| {
        let mut fragments: Vec<FragmentBuilder> = (0..8)
            .map(|file| FragmentBuilder::new(FileId(file)))
            .collect();
        for number in 0..5000usize {
            let text = format!("string {number}");
            fragments[number % 8].strings.intern(text.as_bytes());
            fragments[number / 5 % 8].strings.intern(text.as_bytes());
        }
        let units: Vec<LinkUnit> = fragments
            .into_iter()
            .map(|fragment| finish_unit(projects, fragment))
            .collect();
        let marks = mark_all(&units);
        let in_order = merge_strings(&units, &marks, &forward);
        let in_reverse = merge_strings(&units, &marks, &reverse);
        assert_contents_match(&units, &in_order);
        assert_eq!(in_order.table.len(), 5000);
        assert_eq!(
            table_contents(&in_order.table),
            table_contents(&in_reverse.table)
        );
        assert_eq!(in_order.local_to_program, in_reverse.local_to_program);
    });
}

#[test]
fn no_units_merge_to_empty_table() {
    let merged = merge_strings(&[], &[], &forward);
    assert!(merged.table.is_empty());
    assert!(merged.local_to_program.is_empty());
}
