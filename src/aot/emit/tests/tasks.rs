use super::{
    create_full_program, create_numbered_functions, create_program_with_variables, create_tasks,
    write_task,
};
use crate::builtins::RuntimeFunction;
use crate::emit::functions::{self, create_function_tasks};
use crate::emit::layout::{Source, Task};
use crate::emit::tables::{create_table_tasks, write_strings};
use crate::ir::generated::String as StringRecord;
use crate::ir::generated::{
    Function, ModuleFailure, ProgramList, RuntimeFunctionEntry, TypeSite, Variable,
};
use crate::ir::{ListCounts, Program, SectionWriter, StringTable};

fn measure(task: &Task<'_, '_>) -> ListCounts {
    let mut counts = [0; ProgramList::COUNT];
    match &task.source {
        Source::Strings(strings) => {
            counts[ProgramList::Strings as usize] = strings.len() as u64;
            counts[ProgramList::Bytes as usize] = strings.byte_len() as u64;
        }
        Source::Table(table) => table.measure(&mut counts),
        Source::Functions(slice) => functions::measure(slice.iter(), &mut counts),
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

fn function_slices<'t>(tasks: &'t [Task<'_, '_>]) -> Vec<&'t [Function]> {
    let slices = tasks.iter().map(|task| match &task.source {
        Source::Functions(slice) => slice.as_slice(),
        Source::Strings(_) | Source::Table(_) | Source::SharedFunctions(_) => {
            panic!("a function task holds functions")
        }
    });
    slices.collect()
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
    assert!(create_function_tasks(Vec::new()).is_empty());
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
fn slices_hold_256_functions() {
    let tasks = create_function_tasks(create_numbered_functions(600));
    let lengths: Vec<usize> = function_slices(&tasks)
        .into_iter()
        .map(<[Function]>::len)
        .collect();
    assert_eq!(lengths, [256, 256, 88]);
}

#[test]
fn function_ids_follow_slice_order() {
    let tasks = create_function_tasks(create_numbered_functions(600));
    let functions = function_slices(&tasks).into_iter().flatten();
    assert!(functions.map(|function| function.position).eq(0..600));
}

#[test]
fn measure_equals_write() {
    let mut program = create_full_program();
    let tasks = create_tasks(&mut program);
    assert_eq!(tasks.len(), 15);
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

    write_strings(&strings, &mut sections);

    let words = sections.words_of(ProgramList::Strings);
    let ranges: Vec<(u32, u32)> = words
        .chunks_exact(StringRecord::WORDS)
        .map(|words| StringRecord::from_words(words).expect("the words are a string record"))
        .map(|record| (record.offset, record.length))
        .collect();
    assert_eq!(ranges, [(100, 2), (102, 3)]);
    assert_eq!(sections.blobs().concat(), b"abcde");
}
