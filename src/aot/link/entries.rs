use super::module_records::RecordInput;
use super::program_keys::ProgramModule;
use crate::builtins::table::{self, HostReadContext, HostReadUse};
use crate::ir::StringTable;
use crate::ir::generated::{Entry, HostRead};
use crate::load::{EntryPointKind, ProgramFile, ProjectId};

pub(super) fn host_reads_of(
    kind: EntryPointKind,
) -> impl Iterator<Item = &'static table::HostRead> {
    let contexts: &'static [HostReadContext] = match kind {
        EntryPointKind::Main => &[HostReadContext::EntryPoint],
        EntryPointKind::Additional => &[HostReadContext::EntryPoint, HostReadContext::Worker],
        _ => &[],
    };
    contexts
        .iter()
        .flat_map(|&context| table::host_reads(context))
}

fn build_host_read(read: &table::HostRead, strings: &mut StringTable) -> HostRead {
    let (builtin, parameter) = match read.read_use {
        HostReadUse::PassedTo { builtin, argument } => (Some(builtin), u32::from(argument)),
        HostReadUse::Inspected | HostReadUse::Called => (None, 0),
    };
    HostRead {
        export_name: strings.intern(table::text_of_name(read.export_name)),
        builtin,
        parameter,
    }
}

pub(super) fn build_entries(input: &RecordInput<'_, '_>, strings: &mut StringTable) -> Vec<Entry> {
    let mut entries = Vec::new();
    for entry_point in input.projects.application.sources.entry_points() {
        match entry_point.kind {
            EntryPointKind::Main | EntryPointKind::Additional => {}
            _ => continue,
        }
        let file = ProgramFile {
            project: ProjectId::Application,
            file: entry_point.file,
        };
        let index = input.modules.index_of(ProgramModule::File(file));
        let module = input.numbering.modules[index as usize];
        let host_reads = host_reads_of(entry_point.kind);
        entries.push(Entry {
            module: module.expect("the mark evaluates every entry point"),
            host_reads: host_reads
                .map(|read| build_host_read(read, strings))
                .collect(),
        });
    }
    entries
}
