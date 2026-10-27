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

// An import or export statement links names to variables of the module. Every other site asks a loader, which answers with a value or with a path that a loader takes.
fn links_names_alone(site: ImportSiteKind) -> bool {
    match site {
        ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_) => true,
        ImportSiteKind::JsxRuntime
        | ImportSiteKind::JsxPackage
        | ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::ImportCall(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaRequire(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::GetBuiltinModule(_) => false,
    }
}

struct DataModule {
    is_required_as_namespace: bool,
    is_namespace_reached: bool,
    // Whatever names the module in the files of the program is a statement that links names to its variables.
    is_linked_by_names_alone: bool,
}

impl DataModule {
    fn load(&mut self, site: ImportSiteKind) {
        self.is_linked_by_names_alone &= links_names_alone(site);
        self.is_namespace_reached |= match loaded_value(site) {
            LoadedValue::Namespace => true,
            LoadedValue::RequireResult => self.is_required_as_namespace,
            LoadedValue::Nothing => false,
        };
    }

    fn reach_namespace(&mut self) {
        self.is_linked_by_names_alone = false;
        self.is_namespace_reached = true;
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
                    is_linked_by_names_alone: !parts.is_library,
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

    fn find(&mut self, module: ModuleRef) -> Option<&mut DataModule> {
        match module {
            ModuleRef::File(file) => self.modules.get_mut(&file),
            _ => None,
        }
    }

    fn load(&mut self, module: ModuleRef, site: ImportSiteKind) {
        if let Some(data_module) = self.find(module) {
            data_module.load(site);
        }
    }

    fn reach_namespace(&mut self, module: ModuleRef) {
        if let Some(data_module) = self.find(module) {
            data_module.reach_namespace();
        }
    }

    fn add_import(&mut self, binding: ImportBinding) {
        match binding {
            ImportBinding::Variable(symbol) => self.read_symbol(symbol),
            ImportBinding::Namespace {
                module,
                phase: ImportPhase::Defer,
            }
            | ImportBinding::NamespaceRead { module, .. } => self.reach_namespace(module),
            ImportBinding::Exports { module } => {
                if let Some(data_module) = self.find(module) {
                    data_module.is_linked_by_names_alone = false;
                }
            }
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
            ExportBinding::Variable(symbol) if symbol.file != exporter => self.read_symbol(symbol),
            ExportBinding::Variable(_) | ExportBinding::Synthetic(_) => {}
            ExportBinding::Namespace { module, .. } | ExportBinding::Indirect { module, .. } => {
                self.reach_namespace(module);
            }
        }
    }

    fn add_site(&mut self, parts: &FileRow, site: ImportSiteKind, answer: &StoredSiteAnswer) {
        match answer {
            StoredSiteAnswer::Module(module) => self.load(*module, site),
            StoredSiteAnswer::AllModules => {
                self.modules.values_mut().for_each(|it| it.load(site));
            }
            StoredSiteAnswer::Candidates(range) => {
                for spelled in &parts.spellings[range.start as usize..range.end as usize] {
                    self.load(spelled.module, site);
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
            Some(data_module) => {
                parts.is_data_linked_by_names_alone = data_module.is_linked_by_names_alone;
                if data_module.is_namespace_reached {
                    continue;
                }
            }
            None => continue,
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
