use super::layout::{Source, Task};
use super::tables::create_task;
use crate::ir::generated::{Function, ProgramList};
use crate::ir::{ListCounts, SectionWriter};
use crate::link::FunctionsOfUnit;
use std::sync::Arc;

const FUNCTIONS_PER_SLICE: usize = 256;

// The lists, concatenated in order, hold the functions in program id order. `ExternalBodies::take_from` lays out the bodies
// in the same order, and the engine pairs record i with body i.
pub(super) fn create_tasks_for_shared_functions<'p, 'o>(
    lists: Vec<FunctionsOfUnit>,
) -> Vec<Task<'p, 'o>> {
    let mut functions = lists.into_iter().flat_map(|list| list.functions);
    let mut tasks = Vec::new();
    loop {
        let slice: Vec<Arc<Function>> = functions.by_ref().take(FUNCTIONS_PER_SLICE).collect();
        if slice.is_empty() {
            return tasks;
        }
        tasks.push(create_task(Source::SharedFunctions(slice)));
    }
}

pub(super) fn measure<'a>(
    functions: impl ExactSizeIterator<Item = &'a Function>,
    counts: &mut ListCounts,
) {
    counts[ProgramList::Functions as usize] += functions.len() as u64;
    for function in functions {
        function.count_records(counts);
    }
}

// Ids are written as the record holds them. Where the link left them local to a unit's tables, the engine maps them to
// program ids through the `unit_index` of the function's body.
pub(super) fn write<'a>(
    functions: impl ExactSizeIterator<Item = &'a Function>,
    sections: &mut SectionWriter<'a>,
) {
    let count = functions.len();
    let words_per_function = ProgramList::Functions.element_size() / 4;
    let mut words = Vec::with_capacity(count * words_per_function);
    for function in functions {
        function.write_record(sections, &mut words);
    }
    sections.push_records(ProgramList::Functions, &words, count);
}
