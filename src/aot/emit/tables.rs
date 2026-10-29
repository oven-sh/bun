use super::layout::{Source, Task};
use crate::ir::generated::String as StringRecord;
use crate::ir::generated::{
    Data, Entry, EvalScope, ExpectedResult, Layout, Module, ModuleFailure, ProgramList,
    PropertyKey, RuntimeFunctionEntry, Type, TypeSite, Variable, WebAssemblyModule,
};
use crate::ir::{ListCounts, Program, SectionWriter, StringTable};

const RECORDS_PER_TASK: usize = 4096;

pub(super) trait RecordTable: Send + Sync {
    fn measure(&self, counts: &mut ListCounts);
    fn write<'a>(&'a self, sections: &mut SectionWriter<'a>);
}

struct Table<'p, R> {
    list: ProgramList,
    records: &'p [R],
}

macro_rules! record_table {
    ($($record:ty),+ $(,)?) => {
        $(impl RecordTable for Table<'_, $record> {
            fn measure(&self, counts: &mut ListCounts) {
                counts[self.list as usize] += self.records.len() as u64;
                for record in self.records {
                    record.count_records(counts);
                }
            }

            fn write<'a>(&'a self, sections: &mut SectionWriter<'a>) {
                let word_count = self.records.len() * self.list.element_size() / 4;
                let mut words = Vec::with_capacity(word_count);
                for record in self.records {
                    record.write_record(sections, &mut words);
                }
                sections.push_records(self.list, &words, self.records.len());
            }
        })+
    };
}

record_table!(
    PropertyKey,
    Type,
    TypeSite,
    ExpectedResult,
    Layout,
    Variable,
    Module,
    ModuleFailure,
    EvalScope,
    Data,
    Entry,
    RuntimeFunctionEntry,
    WebAssemblyModule,
);

pub(super) fn create_table_tasks<'p, 'o>(program: &'p Program) -> Vec<Task<'p, 'o>> {
    let mut tasks = Vec::new();
    for list in ProgramList::ALL {
        match list {
            ProgramList::Strings => tasks.push(create_task(Source::Strings(&program.strings))),
            ProgramList::PropertyKeys => {
                add_table(&mut tasks, list, program.property_keys.as_slice());
            }
            ProgramList::Types => add_table(&mut tasks, list, program.types.types()),
            ProgramList::TypeSites => add_table(&mut tasks, list, &program.type_sites),
            ProgramList::ExpectedResults => add_table(&mut tasks, list, &program.expected_results),
            ProgramList::Layouts => add_table(&mut tasks, list, &program.layouts),
            ProgramList::Variables => add_table(&mut tasks, list, &program.variables),
            ProgramList::Modules => add_table(&mut tasks, list, &program.modules),
            ProgramList::ModuleFailures => add_table(&mut tasks, list, &program.module_failures),
            ProgramList::EvalScopes => add_table(&mut tasks, list, &program.eval_scopes),
            ProgramList::Data => add_table(&mut tasks, list, &program.data),
            ProgramList::Entries => add_table(&mut tasks, list, &program.entries),
            ProgramList::RuntimeFunctions => {
                add_table(&mut tasks, list, &program.runtime_functions);
            }
            ProgramList::WebAssemblyModules => {
                add_table(&mut tasks, list, &program.web_assembly_modules);
            }
            ProgramList::Functions
            | ProgramList::Bytes
            | ProgramList::Words
            | ProgramList::ClassParts
            | ProgramList::DeclaredTypes
            | ProgramList::Fields
            | ProgramList::StaticFields
            | ProgramList::ModuleRequests
            | ProgramList::ModuleExports
            | ProgramList::SyntheticExports
            | ProgramList::RequiredNames
            | ProgramList::ColumnAdjustments
            | ProgramList::EvalBindings
            | ProgramList::Code
            | ProgramList::DataNodes
            | ProgramList::DataMembers
            | ProgramList::HostReads => {}
        }
    }
    tasks
}

fn add_table<'p, R>(tasks: &mut Vec<Task<'p, '_>>, list: ProgramList, records: &'p [R])
where
    Table<'p, R>: RecordTable,
{
    for records in records.chunks(RECORDS_PER_TASK) {
        tasks.push(create_task(Source::Table(Box::new(Table {
            list,
            records,
        }))));
    }
}

pub(super) fn create_task<'p, 'o>(source: Source<'p>) -> Task<'p, 'o> {
    Task {
        source,
        counts: [0; ProgramList::COUNT],
        first_indices: [0; ProgramList::COUNT],
        outputs: Vec::new(),
    }
}

pub(super) fn write_strings<'a>(strings: &'a StringTable, sections: &mut SectionWriter<'a>) {
    let span = sections.push_bytes(strings.bytes());
    let mut offset = span.first;
    let mut words: Vec<u32> = Vec::with_capacity(strings.len() * StringRecord::WORDS);
    for id in strings.ids() {
        let length = strings.get(id).len() as u32;
        let record = StringRecord {
            offset,
            length,
            name_class: strings.name_class(id),
            builtin_name: strings.builtin_name(id),
        };
        record.append_to(&mut words);
        offset += length;
    }
    assert!(
        offset == sections.next_index(ProgramList::Bytes),
        "the strings fill exactly the bytes of the string table"
    );
    sections.push_records(ProgramList::Strings, &words, strings.len());
}
