use super::layout::{Source, Task};
use super::tables::create_task;
use crate::ir::generated::{Function, ProgramList};
use crate::ir::{InParallel, ListCounts, SectionWriter, for_each_mut};
use std::sync::Arc;

const FUNCTIONS_PER_SLICE: usize = 256;

#[cfg(test)]
pub(super) fn create_function_tasks<'p, 'o>(functions: Vec<Function>) -> Vec<Task<'p, 'o>> {
    create_function_tasks_in_parallel(functions, &crate::ir::run_serially)
}

// Each slice is a list of its own, which its task frees. A function is a large record, so the threads share the copying.
pub(super) fn create_function_tasks_in_parallel<'p, 'o>(
    mut functions: Vec<Function>,
    in_parallel: InParallel<'_>,
) -> Vec<Task<'p, 'o>> {
    let mut slices: Vec<(&mut [Function], Vec<Function>)> = functions
        .chunks_mut(FUNCTIONS_PER_SLICE)
        .map(|slice| (slice, Vec::new()))
        .collect();
    for_each_mut(&mut slices, in_parallel, &|(slice, taken)| {
        *taken = slice.iter_mut().map(core::mem::take).collect();
    });
    let tasks = slices
        .into_iter()
        .map(|(_, functions)| create_task(Source::Functions(functions)))
        .collect();
    drop(functions);
    tasks
}

// Only pointers move.
pub(super) fn create_tasks_for_shared_functions<'p, 'o>(
    functions_by_unit: Vec<Vec<Arc<Function>>>,
) -> Vec<Task<'p, 'o>> {
    let mut functions = functions_by_unit.into_iter().flatten();
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
