use super::ModuleRef;
use super::bindings::{ExportBinding, ImportBinding, ModuleExport};
use super::graph::{FileRow, StoredSiteAnswer};
use super::imports::NamedMember;
use super::interop::{ImportPhase, Interop, ModuleKind, RequireResult};
use bun_sema::atom::known;
use bun_sema::bind::SymbolId;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Sym};
use core::ops::Range;

struct DataModule {
    row: usize,
    marks: Range<usize>,
    keeps_every_name: bool,
}

struct ExportReads {
    place_by_file: Vec<Option<u32>>,
    modules: Vec<DataModule>,
    is_read: Vec<bool>,
    every_module_keeps_every_name: bool,
}

fn own_variable(file: FileId, export: &ModuleExport) -> Option<SymbolId> {
    match export.binding {
        ExportBinding::Variable(variable) if variable.file == file => Some(variable.id),
        _ => None,
    }
}

fn answers_require_with_namespace(interop: Interop) -> bool {
    interop.require_result != RequireResult::DefaultExport || interop.answers_loader_with_namespace
}

impl ExportReads {
    fn new(rows: &[FileRow]) -> ExportReads {
        let file_count = rows.iter().map(|row| row.file.idx() + 1).max().unwrap_or(0);
        let mut reads = ExportReads {
            place_by_file: vec![None; file_count],
            modules: Vec::new(),
            is_read: Vec::new(),
            every_module_keeps_every_name: false,
        };
        for (index, row) in rows.iter().enumerate() {
            if row.interop.kind != ModuleKind::Data || row.exports.is_empty() {
                continue;
            }
            let exports = row.exports.iter();
            let variables = exports.filter_map(|export| own_variable(row.file, export));
            let mark_count = variables.map(|it| it.0 as usize + 1).max().unwrap_or(0);
            let first_mark = reads.is_read.len();
            reads.is_read.resize(first_mark + mark_count, false);
            reads.place_by_file[row.file.idx()] = Some(reads.modules.len() as u32);
            reads.modules.push(DataModule {
                row: index,
                marks: first_mark..first_mark + mark_count,
                keeps_every_name: row.is_library
                    || row.is_left_to_loader
                    || row.has_dynamic_names
                    || row.reaches_mock
                    || answers_require_with_namespace(row.interop),
            });
        }
        reads
    }

    fn find(&self, file: FileId) -> Option<usize> {
        let place = self.place_by_file.get(file.idx()).copied().flatten();
        place.map(|place| place as usize)
    }

    fn read_variable(&mut self, variable: Sym) {
        let Some(place) = self.find(variable.file) else {
            return;
        };
        let marks = self.modules[place].marks.clone();
        if let Some(mark) = self.is_read[marks].get_mut(variable.id.0 as usize) {
            *mark = true;
        }
    }

    fn keep_every_name(&mut self, file: FileId) {
        if let Some(place) = self.find(file) {
            self.modules[place].keeps_every_name = true;
        }
    }

    fn ask_for_every_name(&mut self, module: ModuleRef) {
        match module {
            ModuleRef::File(file) => self.keep_every_name(file),
            ModuleRef::Inner { .. }
            | ModuleRef::Face(_)
            | ModuleRef::Check(_)
            | ModuleRef::Runtime(_)
            | ModuleRef::External { .. } => {}
        }
    }

    fn add_binding(&mut self, binding: ImportBinding) {
        match binding {
            ImportBinding::Variable(variable) => self.read_variable(variable),
            ImportBinding::Namespace {
                module,
                phase: ImportPhase::Defer,
            }
            | ImportBinding::NamespaceRead { module, .. }
            | ImportBinding::Exports { module } => self.ask_for_every_name(module),
            ImportBinding::Namespace {
                phase: ImportPhase::Evaluation,
                ..
            }
            | ImportBinding::Local
            | ImportBinding::Unused
            | ImportBinding::Unbound
            | ImportBinding::Builtin(_)
            | ImportBinding::CapturedBuiltin { .. }
            | ImportBinding::BuiltinMember { .. }
            | ImportBinding::Synthetic(_) => {}
        }
    }

    fn add_export(&mut self, exporter: FileId, export: &ModuleExport) {
        match export.binding {
            ExportBinding::Variable(variable) if variable.file != exporter => {
                self.read_variable(variable);
            }
            ExportBinding::Variable(_) | ExportBinding::Synthetic(_) => {}
            ExportBinding::Namespace { module, .. } | ExportBinding::Indirect { module, .. } => {
                self.ask_for_every_name(module);
            }
        }
    }

    fn add_site(&mut self, site: ImportSiteKind, answer: &StoredSiteAnswer) {
        match site {
            ImportSiteKind::ExportStar(_) => {
                if let StoredSiteAnswer::Module(module) = answer {
                    self.ask_for_every_name(*module);
                }
            }
            ImportSiteKind::ImportCall(_)
            | ImportSiteKind::MockModule(_)
            | ImportSiteKind::ImportByTestRunner(_)
            | ImportSiteKind::RequireByTestRunner(_) => match answer {
                StoredSiteAnswer::Module(module) => self.ask_for_every_name(*module),
                StoredSiteAnswer::AllModules | StoredSiteAnswer::Candidates(_) => {
                    self.every_module_keeps_every_name = true;
                }
                StoredSiteAnswer::Failed(_) | StoredSiteAnswer::Erased => {}
            },
            ImportSiteKind::JsxRuntime
            | ImportSiteKind::JsxPackage
            | ImportSiteKind::Import(_)
            | ImportSiteKind::ExportFrom(_)
            | ImportSiteKind::ImportEquals(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::RequireResolve(_)
            | ImportSiteKind::ImportMetaRequire(_)
            | ImportSiteKind::ImportMetaResolve(_)
            | ImportSiteKind::GetBuiltinModule(_) => {}
        }
    }

    fn add_row(&mut self, row: &FileRow) {
        for &(_, binding) in &row.imports {
            self.add_binding(binding);
        }
        for &(_, binding) in &row.members {
            self.add_binding(binding);
        }
        for &(_, member) in &row.named_members {
            match member {
                NamedMember::Binding(binding) => self.add_binding(binding),
                NamedMember::Fixed(_) => {}
            }
        }
        for &(_, binding) in &row.jsx {
            self.add_binding(binding);
            if let ImportBinding::Namespace { module, .. } = binding {
                self.ask_for_every_name(module);
            }
        }
        for &module in &row.namespace_values {
            self.ask_for_every_name(module);
        }
        for required in &row.required_names {
            self.ask_for_every_name(required.module);
        }
        for &(file, _) in &row.names_searched_behind_stars {
            self.keep_every_name(file);
        }
        for export in &row.exports {
            self.add_export(row.file, export);
        }
        for (site, answer) in &row.sites {
            self.add_site(*site, answer);
        }
    }
}

pub(super) fn remove_unread_data_exports(rows: &mut [FileRow]) {
    let mut reads = ExportReads::new(rows);
    if reads.modules.is_empty() {
        return;
    }
    for row in rows.iter() {
        reads.add_row(row);
        if reads.every_module_keeps_every_name {
            return;
        }
    }
    let ExportReads {
        modules,
        mut is_read,
        ..
    } = reads;
    for module in modules.iter().filter(|module| !module.keeps_every_name) {
        let row = &mut rows[module.row];
        let file = row.file;
        let is_read = &mut is_read[module.marks.clone()];
        let exports = row.exports.iter();
        let asked_of_every_namespace = [known::default, known::then, known::__esModule];
        let kept = exports.filter(|export| asked_of_every_namespace.contains(&export.name));
        for variable in kept.filter_map(|export| own_variable(file, export)) {
            is_read[variable.0 as usize] = true;
        }
        let mut unread_exports = Vec::new();
        let mut names_left_out = Vec::new();
        row.exports
            .retain(|export| match own_variable(file, export) {
                Some(variable) if !is_read[variable.0 as usize] => {
                    unread_exports.push(variable);
                    names_left_out.push(export.name);
                    false
                }
                Some(_) | None => true,
            });
        row.names_left_out = names_left_out;
        unread_exports.sort_unstable();
        unread_exports.dedup();
        row.unread_exports = unread_exports;
    }
}
