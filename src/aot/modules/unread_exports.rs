use super::ModuleRef;
use super::bindings::{ExportBinding, ImportBinding, ModuleExport};
use super::graph::{FileRow, StoredSiteAnswer};
use super::interop::{ImportPhase, ModuleKind, RequireResult};
use bun_sema::atom::known;
use bun_sema::bind::SymbolId;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Sym};
use bun_sema::util::{FxHashMap, FxHashSet};

#[derive(Copy, Clone, PartialEq, Eq)]
enum LoadedValue {
    Namespace,
    RequireResult,
    Nothing,
}

fn loaded_value(site: ImportSiteKind) -> LoadedValue {
    match site {
        ImportSiteKind::ImportCall(_) => LoadedValue::Namespace,
        ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_)
        | ImportSiteKind::GetBuiltinModule(_) => LoadedValue::RequireResult,
        _ => LoadedValue::Nothing,
    }
}

struct DataModule {
    is_required_as_namespace: bool,
    is_namespace_reached: bool,
}

impl DataModule {
    fn load(&mut self, value: LoadedValue) {
        self.is_namespace_reached |= match value {
            LoadedValue::Namespace => true,
            LoadedValue::RequireResult => self.is_required_as_namespace,
            LoadedValue::Nothing => false,
        };
    }
}

struct ExportReads {
    modules: FxHashMap<FileId, DataModule>,
    read_symbols: FxHashSet<Sym>,
}

impl ExportReads {
    fn new(files: &[FileRow]) -> ExportReads {
        let mut modules = FxHashMap::default();
        for parts in files {
            if parts.interop.kind == ModuleKind::Data && !parts.exports.is_empty() {
                let is_required_as_namespace =
                    parts.interop.require_result == RequireResult::Namespace;
                let data_module = DataModule {
                    is_required_as_namespace,
                    is_namespace_reached: parts.is_library,
                };
                modules.insert(parts.file, data_module);
            }
        }
        ExportReads {
            modules,
            read_symbols: FxHashSet::default(),
        }
    }

    fn read_symbol(&mut self, symbol: Sym) {
        if self.modules.contains_key(&symbol.file) {
            self.read_symbols.insert(symbol);
        }
    }

    fn load(&mut self, module: ModuleRef, value: LoadedValue) {
        let data_module = match module {
            ModuleRef::File(file) => self.modules.get_mut(&file),
            _ => None,
        };
        if let Some(data_module) = data_module {
            data_module.load(value);
        }
    }

    fn reach_namespace(&mut self, module: ModuleRef) {
        self.load(module, LoadedValue::Namespace);
    }

    fn add_import(&mut self, binding: ImportBinding) {
        match binding {
            ImportBinding::Variable(symbol) => self.read_symbol(symbol),
            ImportBinding::Namespace {
                module,
                phase: ImportPhase::Defer,
            }
            | ImportBinding::NamespaceRead { module, .. } => self.reach_namespace(module),
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
            | ImportBinding::Exports { .. }
            | ImportBinding::Synthetic(_) => {}
        }
    }

    fn add_export(&mut self, exporter: FileId, export: &ModuleExport) {
        match export.binding {
            ExportBinding::Variable(symbol) if symbol.file != exporter => self.read_symbol(symbol),
            ExportBinding::Variable(_) | ExportBinding::Synthetic(_) => {}
            ExportBinding::Namespace { module, .. } | ExportBinding::Indirect { module, .. } => {
                self.reach_namespace(module);
            }
        }
    }

    fn add_site(&mut self, parts: &FileRow, site: ImportSiteKind, answer: &StoredSiteAnswer) {
        let value = loaded_value(site);
        match answer {
            StoredSiteAnswer::Module(module) => self.load(*module, value),
            StoredSiteAnswer::AllModules => {
                self.modules.values_mut().for_each(|it| it.load(value));
            }
            StoredSiteAnswer::Candidates(range) => {
                for spelled in &parts.spellings[range.start as usize..range.end as usize] {
                    self.load(spelled.module, value);
                }
            }
            StoredSiteAnswer::Failed(_) | StoredSiteAnswer::Erased => {}
        }
    }

    fn add_file(&mut self, parts: &FileRow) {
        for &(_, binding) in &parts.imports {
            self.add_import(binding);
        }
        for &(_, binding) in &parts.members {
            self.add_import(binding);
        }
        for &(_, binding) in &parts.jsx {
            self.add_import(binding);
            if let ImportBinding::Namespace { module, .. } = binding {
                self.reach_namespace(module);
            }
        }
        for &module in &parts.namespace_values {
            self.reach_namespace(module);
        }
        for export in &parts.exports {
            self.add_export(parts.file, export);
        }
        for (site, answer) in &parts.sites {
            self.add_site(parts, *site, answer);
        }
    }

    fn is_unread(&self, module: FileId, export: &ModuleExport) -> Option<SymbolId> {
        match export.binding {
            ExportBinding::Variable(symbol)
                if export.name != known::default
                    && symbol.file == module
                    && !self.read_symbols.contains(&symbol) =>
            {
                Some(symbol.id)
            }
            _ => None,
        }
    }
}

pub(super) fn remove_unread_data_exports(files: &mut [FileRow]) {
    let mut reads = ExportReads::new(files);
    if reads.modules.is_empty() {
        return;
    }
    for parts in files.iter() {
        reads.add_file(parts);
    }
    for parts in files {
        match reads.modules.get(&parts.file) {
            Some(data_module) if !data_module.is_namespace_reached => {}
            Some(_) | None => continue,
        }
        let module = parts.file;
        let kept_symbols: FxHashSet<SymbolId> = parts
            .exports
            .iter()
            .filter(|export| reads.is_unread(module, export).is_none())
            .filter_map(|export| match export.binding {
                ExportBinding::Variable(symbol) if symbol.file == module => Some(symbol.id),
                _ => None,
            })
            .collect();
        let mut unread_exports = Vec::new();
        let exports = &mut parts.exports;
        exports.retain(|export| match reads.is_unread(module, export) {
            Some(symbol) if !kept_symbols.contains(&symbol) => {
                unread_exports.push(symbol);
                false
            }
            Some(_) | None => true,
        });
        unread_exports.sort_unstable();
        unread_exports.dedup();
        parts.unread_exports = unread_exports;
    }
}
