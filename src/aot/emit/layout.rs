#[cfg(test)]
mod tests;

use std::mem::MaybeUninit;
use std::sync::Arc;

use super::functions;
use super::output::OutputSlice;
use super::tables::{RecordTable, create_table_tasks, write_strings};
use super::{EmitError, ProgramBytes};
use crate::ir::generated::{Function, Header, MAGIC, ProgramList, SCHEMA_HASH, Section};
use crate::ir::{InParallel, ListCounts, Program, SectionWriter, StringTable, for_each_mut};

const HEADER_SIZE_IN_BYTES: usize = Header::WORDS * 4;

pub(super) struct Task<'p, 'o> {
    pub(super) source: Source<'p>,
    pub(super) counts: ListCounts,
    pub(super) first_indices: ListCounts,
    pub(super) outputs: Vec<OutputSlice<'o>>,
}

pub(super) enum Source<'p> {
    Strings(&'p StringTable),
    Table(Box<dyn RecordTable + 'p>),
    Functions(Vec<Function>),
    SharedFunctions(Vec<Arc<Function>>),
}

pub(super) fn emit_program<'p>(
    program: &'p Program,
    function_tasks: Vec<Task<'p, '_>>,
    in_parallel: InParallel<'_>,
) -> Result<ProgramBytes, EmitError> {
    let mut tasks = create_table_tasks(program);
    tasks.extend(function_tasks);
    for_each_mut(&mut tasks, in_parallel, &|task| task.measure());
    let totals = set_first_indices(&mut tasks);
    let plan = plan_sections(&totals)?;
    let size_in_bytes = plan.size_in_bytes as usize;
    let mut storage = Vec::<u64>::with_capacity(size_in_bytes / 8);
    let output = OutputSlice::new(uninitialized_bytes(&mut storage, size_in_bytes));
    carve(output, &plan, &mut tasks);
    for_each_mut(&mut tasks, in_parallel, &|task| task.write());
    assert!(
        tasks.iter().all(Task::is_written),
        "every task has filled the space reserved for it"
    );
    drop(tasks);
    // SAFETY: the header, the paddings and the outputs of the tasks are all of the first
    // `size_in_bytes` bytes, and each has been written.
    unsafe { storage.set_len(size_in_bytes / 8) };
    Ok(ProgramBytes::new(storage, size_in_bytes))
}

impl Task<'_, '_> {
    fn measure(&mut self) {
        match &self.source {
            Source::Strings(strings) => {
                self.counts[ProgramList::Strings as usize] = strings.len() as u64;
                self.counts[ProgramList::Bytes as usize] = strings.byte_len() as u64;
            }
            Source::Table(table) => table.measure(&mut self.counts),
            Source::Functions(slice) => functions::measure(slice.iter(), &mut self.counts),
            Source::SharedFunctions(slice) => {
                functions::measure(slice.iter().map(|function| &**function), &mut self.counts);
            }
        }
    }

    fn write(&mut self) {
        let mut sections = SectionWriter::new(self.first_indices);
        for list in ProgramList::ALL {
            if list != ProgramList::Bytes {
                sections.reserve(list, byte_count(list, self.counts[list as usize]) / 4);
            }
        }
        match &self.source {
            Source::Strings(strings) => write_strings(strings, &mut sections),
            Source::Table(table) => table.write(&mut sections),
            Source::Functions(slice) => functions::write(slice.iter(), &mut sections),
            Source::SharedFunctions(slice) => {
                functions::write(slice.iter().map(|function| &**function), &mut sections);
            }
        }
        for (list, output) in ProgramList::ALL.into_iter().zip(&mut self.outputs) {
            assert_eq!(
                sections.count_of(list),
                self.counts[list as usize],
                "the task writes as many records of {} as it measured",
                list.name()
            );
            if list == ProgramList::Bytes {
                for blob in sections.blobs() {
                    output.put_bytes(blob);
                }
            } else {
                output.put_words(sections.words_of(list));
            }
            assert!(
                output.is_empty(),
                "the task fills exactly the space reserved for it in {}",
                list.name()
            );
        }
        drop(sections);
        match &mut self.source {
            Source::Functions(slice) => *slice = Vec::new(),
            Source::SharedFunctions(slice) => *slice = Vec::new(),
            Source::Strings(_) | Source::Table(_) => {}
        }
    }

    fn is_written(&self) -> bool {
        self.outputs.iter().all(OutputSlice::is_empty)
    }
}

fn set_first_indices(tasks: &mut [Task<'_, '_>]) -> ListCounts {
    let mut running = [0; ProgramList::COUNT];
    for task in tasks {
        task.first_indices = running;
        for (total, count) in running.iter_mut().zip(task.counts) {
            *total += count;
        }
    }
    running
}

struct SectionPlan {
    sections: [Section; ProgramList::COUNT],
    size_in_bytes: u32,
}

fn plan_sections(totals: &ListCounts) -> Result<SectionPlan, EmitError> {
    let mut offset = HEADER_SIZE_IN_BYTES as u64;
    let sections = ProgramList::ALL.map(|list| {
        let count = totals[list as usize];
        let section = Section {
            offset_in_bytes: offset as u32,
            count: count as u32,
        };
        let size = count.saturating_mul(list.element_size() as u64);
        offset = round_up(offset.saturating_add(size), 4);
        section
    });
    offset = round_up(offset, 8);
    let Ok(size_in_bytes) = u32::try_from(offset) else {
        return Err(EmitError::ProgramTooLarge { bytes: offset });
    };
    Ok(SectionPlan {
        sections,
        size_in_bytes,
    })
}

fn round_up(offset: u64, alignment: u64) -> u64 {
    offset.saturating_add(alignment - 1) / alignment * alignment
}

fn byte_count(list: ProgramList, record_count: u64) -> usize {
    record_count as usize * list.element_size()
}

fn uninitialized_bytes(storage: &mut Vec<u64>, size_in_bytes: usize) -> &mut [MaybeUninit<u8>] {
    let spare = storage.spare_capacity_mut();
    assert!(size_in_bytes <= size_of_val(spare));
    let first_byte = spare.as_mut_ptr().cast::<MaybeUninit<u8>>();
    // SAFETY: a `MaybeUninit<u8>` has no validity or alignment requirement, and the range is
    // inside the allocation.
    unsafe { std::slice::from_raw_parts_mut(first_byte, size_in_bytes) }
}

fn carve<'o>(mut output: OutputSlice<'o>, plan: &SectionPlan, tasks: &mut [Task<'_, 'o>]) {
    write_header(output.take(HEADER_SIZE_IN_BYTES), plan);
    let mut outputs = Vec::with_capacity(ProgramList::COUNT);
    let mut end = HEADER_SIZE_IN_BYTES;
    for (list, section) in ProgramList::ALL.into_iter().zip(plan.sections) {
        let start = section.offset_in_bytes as usize;
        output.take(start - end).fill_with_zeros();
        let size = byte_count(list, u64::from(section.count));
        outputs.push(output.take(size));
        end = start + size;
    }
    output
        .take(plan.size_in_bytes as usize - end)
        .fill_with_zeros();
    assert!(output.is_empty());
    for task in tasks {
        let counts = &task.counts;
        let lists = ProgramList::ALL.into_iter();
        task.outputs = lists
            .map(|list| outputs[list as usize].take(byte_count(list, counts[list as usize])))
            .collect();
    }
    assert!(
        outputs.iter().all(OutputSlice::is_empty),
        "the tasks fill exactly the sections planned for them"
    );
}

fn write_header(mut output: OutputSlice<'_>, plan: &SectionPlan) {
    let mut words = Vec::<u32>::with_capacity(Header::WORDS);
    let header = Header {
        magic: MAGIC,
        schema_hash: SCHEMA_HASH,
        size_in_bytes: plan.size_in_bytes,
        sections: plan.sections,
    };
    header.append_to(&mut words);
    output.put_words(&words);
    assert!(
        output.is_empty(),
        "the header fills exactly the space reserved for it"
    );
}
