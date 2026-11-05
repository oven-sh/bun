use super::{create_full_program, create_program_with_variables, create_tasks, write_task};
use crate::builtins::RuntimeFunction;
use crate::emit::functions::{self, create_tasks_for_shared_functions};
use crate::emit::layout::{Source, Task};
use crate::emit::tables::{StringsOfTask, create_table_tasks, write_strings};
use crate::ir::generated::String as StringRecord;
use crate::ir::generated::{ModuleFailure, ProgramList, RuntimeFunctionEntry, TypeSite, Variable};
use crate::ir::{ListCounts, Program, SectionWriter, StringTable};

fn measure(task: &Task<'_, '_>) -> ListCounts {
    let mut counts = [0; ProgramList::COUNT];
    match &task.source {
        Source::Strings(strings) => {
            counts[ProgramList::Strings as usize] = strings.len() as u64;
            counts[ProgramList::Bytes as usize] = strings.byte_len() as u64;
        }
        Source::Table(table) => table.measure(&mut counts),
        Source::SharedFunctions(slice) => {
            functions::measure(slice.iter().map(|function| &**function), &mut counts);
        }
    }
    counts
}

fn measured_lists(task: &Task<'_, '_>) -> Vec<ProgramList> {
    let counts = measure(task);
    let lists = ProgramList::ALL.into_iter();
    lists.filter(|&list| counts[list as usize] > 0).collect()
}

#[test]
fn tasks_follow_list_order() {
    let program = Program {
        type_sites: vec![TypeSite::default()],
        variables: vec![Variable::default()],
        module_failures: vec![ModuleFailure::default()],
        runtime_functions: vec![RuntimeFunctionEntry {
            id: RuntimeFunction(1),
            ..RuntimeFunctionEntry::default()
        }],
        ..Program::new()
    };
    let tasks = create_table_tasks(&program);
    let lists: Vec<Vec<ProgramList>> = tasks.iter().map(measured_lists).collect();
    let types = vec![
        ProgramList::Words,
        ProgramList::Types,
        ProgramList::ClassParts,
    ];
    let expected_lists = [
        Vec::new(),
        types,
        vec![ProgramList::TypeSites],
        vec![ProgramList::Variables],
        vec![ProgramList::ModuleFailures],
        vec![ProgramList::RuntimeFunctions],
    ];
    assert_eq!(lists, expected_lists);
}

#[test]
fn empty_tables_have_no_task() {
    let program = Program::new();
    let tasks = create_table_tasks(&program);
    let [strings, types] = tasks.as_slice() else {
        panic!("{} tasks", tasks.len());
    };
    assert!(matches!(strings.source, Source::Strings(_)));
    assert!(measured_lists(types).contains(&ProgramList::Types));
    assert!(create_tasks_for_shared_functions(Vec::new()).is_empty());
}

#[test]
fn large_table_is_chunked() {
    let program = create_program_with_variables(10_000);
    let tasks = create_table_tasks(&program);
    let counts = tasks
        .iter()
        .map(|task| measure(task)[ProgramList::Variables as usize]);
    let counts: Vec<u64> = counts.filter(|&count| count > 0).collect();
    assert_eq!(counts, [4096, 4096, 1808]);
}

#[test]
fn strings_are_chunked_and_lie_in_the_program_as_in_the_table() {
    let mut program = Program::new();
    for length in 0..130 {
        program.strings.intern("x".repeat(length).as_bytes());
    }
    let tasks = create_table_tasks(&program);
    let counts = tasks.iter().map(measure);
    let counts = counts
        .map(|counts| [ProgramList::Strings, ProgramList::Bytes].map(|list| counts[list as usize]));
    let counts: Vec<[u64; 2]> = counts.filter(|counts| counts[0] > 0).collect();
    assert_eq!(counts, [[64, 2016], [64, 6112], [2, 257]]);

    let mut sections = SectionWriter::new([0; ProgramList::COUNT]);
    for task in &tasks {
        write_task(task, &mut sections);
    }
    assert_eq!(sections.blobs().concat(), program.strings.bytes());
    let words = sections.words_of(ProgramList::Strings);
    let ranges: Vec<(u32, u32)> = words
        .chunks_exact(StringRecord::WORDS)
        .map(|words| StringRecord::from_words(words).expect("the words are a string record"))
        .map(|record| (record.offset, record.length))
        .collect();
    let expected: Vec<(u32, u32)> = (0..130).map(|length| ((0..length).sum(), length)).collect();
    assert_eq!(ranges, expected);
}

#[test]
fn measure_equals_write() {
    let mut program = create_full_program();
    let tasks = create_tasks(&mut program);
    assert_eq!(tasks.len(), 19);
    for task in &tasks {
        let mut sections = SectionWriter::new([0; ProgramList::COUNT]);
        write_task(task, &mut sections);
        let written = ProgramList::ALL.map(|list| sections.count_of(list));
        assert_eq!(measure(task), written);
    }
}

#[test]
fn string_offsets_are_program_wide() {
    let mut strings = StringTable::default();
    strings.intern(b"ab");
    strings.intern(b"cde");
    let mut first_indices = [0; ProgramList::COUNT];
    first_indices[ProgramList::Bytes as usize] = 100;
    let mut sections = SectionWriter::new(first_indices);

    write_strings(&StringsOfTask::all_of(&strings), &mut sections);

    let words = sections.words_of(ProgramList::Strings);
    let ranges: Vec<(u32, u32)> = words
        .chunks_exact(StringRecord::WORDS)
        .map(|words| StringRecord::from_words(words).expect("the words are a string record"))
        .map(|record| (record.offset, record.length))
        .collect();
    assert_eq!(ranges, [(100, 2), (102, 3)]);
    assert_eq!(sections.blobs().concat(), b"abcde");
}
