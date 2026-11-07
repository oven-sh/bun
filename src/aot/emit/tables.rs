use super::layout::{Source, Task};
use crate::ir::generated::String as StringRecord;
use crate::ir::generated::{
    AmbiguousExport, BuiltinUsedAtStart, Data, Entry, EvalScope, ExpectedResult, Layout, Module,
    ModuleFailure, OpenedName, ProgramList, PropertyKey, ReplaceableBuiltin, RuntimeFunctionEntry,
    SourceStamp, TypeSite, Variable, WebAssemblyModule,
};
use crate::ir::{Id, ListCounts, Program, SectionWriter, StringId, StringTable, Types};
use core::ops::Range;

const RECORDS_PER_TASK: usize = 4096;
const STRINGS_PER_TASK: usize = if cfg!(test) { 64 } else { 1 << 14 };

pub(super) struct StringsOfTask<'p> {
    table: &'p StringTable,
    indexes: Range<usize>,
}

impl<'p> StringsOfTask<'p> {
    #[cfg(test)]
    pub(super) fn all_of(table: &'p StringTable) -> StringsOfTask<'p> {
        StringsOfTask {
            table,
            indexes: 0..table.len(),
        }
    }

    pub(super) fn len(&self) -> usize {
        self.indexes.len()
    }

    fn bytes(&self) -> &'p [u8] {
        self.table.bytes_of(self.indexes.clone())
    }

    pub(super) fn byte_len(&self) -> usize {
        self.bytes().len()
    }
}

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

impl RecordTable for Types<'_> {
    fn measure(&self, counts: &mut ListCounts) {
        counts[ProgramList::Types as usize] += self.len() as u64;
        for record in self.iter() {
            record.count_records(counts);
        }
    }

    fn write<'a>(&'a self, sections: &mut SectionWriter<'a>) {
        let word_count = self.len() * ProgramList::Types.element_size() / 4;
        let mut words = Vec::with_capacity(word_count);
        for record in self.iter() {
            record.write_record(sections, &mut words);
        }
        sections.push_records(ProgramList::Types, &words, self.len());
    }
}

record_table!(
    PropertyKey,
    TypeSite,
    ExpectedResult,
    Layout,
    Variable,
    Module,
    ModuleFailure,
    AmbiguousExport,
    SourceStamp,
    EvalScope,
    Data,
    Entry,
    RuntimeFunctionEntry,
    WebAssemblyModule,
    ReplaceableBuiltin,
    OpenedName,
    BuiltinUsedAtStart,
);

pub(super) fn create_table_tasks<'p, 'o>(program: &'p Program) -> Vec<Task<'p, 'o>> {
    let mut tasks = Vec::new();
    for list in ProgramList::ALL {
        match list {
            ProgramList::Strings => add_strings(&mut tasks, &program.strings),
            ProgramList::PropertyKeys => {
                add_table(&mut tasks, list, program.property_keys.as_slice());
            }
            ProgramList::Types => {
                let chunks = program.types.types().chunks(RECORDS_PER_TASK);
                tasks.extend(chunks.map(|types| create_task(Source::Table(Box::new(types)))));
            }
            ProgramList::TypeSites => add_table(&mut tasks, list, &program.type_sites),
            ProgramList::ExpectedResults => add_table(&mut tasks, list, &program.expected_results),
            ProgramList::Layouts => add_table(&mut tasks, list, &program.layouts),
            ProgramList::Variables => add_table(&mut tasks, list, &program.variables),
            ProgramList::Modules => add_table(&mut tasks, list, &program.modules),
            ProgramList::ModuleFailures => add_table(&mut tasks, list, &program.module_failures),
            ProgramList::AmbiguousExports => {
                add_table(&mut tasks, list, &program.ambiguous_exports);
            }
            ProgramList::SourceStamps => add_table(&mut tasks, list, &program.source_stamps),
            ProgramList::EvalScopes => add_table(&mut tasks, list, &program.eval_scopes),
            ProgramList::Data => add_table(&mut tasks, list, &program.data),
            ProgramList::Entries => add_table(&mut tasks, list, &program.entries),
            ProgramList::RuntimeFunctions => {
                add_table(&mut tasks, list, &program.runtime_functions);
            }
            ProgramList::WebAssemblyModules => {
                add_table(&mut tasks, list, &program.web_assembly_modules);
            }
            ProgramList::ReplaceableBuiltins => {
                add_table(&mut tasks, list, &program.replaceable_builtins);
            }
            ProgramList::OpenedNames => {
                add_table(&mut tasks, list, &program.opened_names);
            }
            ProgramList::BuiltinsUsedAtStart => {
                add_table(&mut tasks, list, &program.builtins_used_at_start);
            }
            ProgramList::Functions
            | ProgramList::Bytes
            | ProgramList::Words
            | ProgramList::ClassParts
            | ProgramList::DeclaredTypes
            | ProgramList::DeclaredCaptures
            | ProgramList::Fields
            | ProgramList::StaticFields
            | ProgramList::ModuleRequests
            | ProgramList::ModuleExports
            | ProgramList::SyntheticExports
            | ProgramList::RequiredNames
            | ProgramList::ColumnAdjustments
            | ProgramList::QuotedTexts
            | ProgramList::EvalBindings
            | ProgramList::Code
            | ProgramList::DataNodes
            | ProgramList::DataMembers
            | ProgramList::HostReads => {}
        }
    }
    tasks
}

fn add_strings<'p>(tasks: &mut Vec<Task<'p, '_>>, table: &'p StringTable) {
    for start in (0..table.len().max(1)).step_by(STRINGS_PER_TASK) {
        let indexes = start..table.len().min(start + STRINGS_PER_TASK);
        tasks.push(create_task(Source::Strings(StringsOfTask {
            table,
            indexes,
        })));
    }
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

struct PushedWords<'a>(&'a mut Vec<u32>);

impl Extend<u32> for PushedWords<'_> {
    #[inline]
    fn extend<I: IntoIterator<Item = u32>>(&mut self, words: I) {
        for word in words {
            self.0.push(word);
        }
    }
}

pub(super) fn write_strings<'a>(strings: &StringsOfTask<'a>, sections: &mut SectionWriter<'a>) {
    let span = sections.push_bytes(strings.bytes());
    let mut offset = span.first;
    let mut words: Vec<u32> = Vec::with_capacity(strings.len() * StringRecord::WORDS);
    let table = strings.table;
    for id in strings.indexes.clone().map(StringId::new) {
        let length = table.get(id).len() as u32;
        let record = StringRecord {
            offset,
            length,
            name_class: table.name_class(id),
            builtin_name: table.builtin_name(id),
        };
        record.append_to(&mut PushedWords(&mut words));
        offset += length;
    }
    assert!(
        offset == sections.next_index(ProgramList::Bytes),
        "the strings fill exactly their bytes of the string table"
    );
    sections.push_records(ProgramList::Strings, &words, strings.len());
}
