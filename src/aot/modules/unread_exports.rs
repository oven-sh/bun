use super::ModuleRef;
use super::bindings::{ExportBinding, ImportBinding, ModuleExport};
use super::graph::{FileParts, StoredSiteAnswer};
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

struct ExportReads {
    index_by_file: FxHashMap<FileId, usize>,
    modules: Vec<DataModule>,
    read_symbols: FxHashSet<Sym>,
}

impl ExportReads {
    fn new(files: &[FileParts]) -> ExportReads {
        let mut reads = ExportReads {
            index_by_file: FxHashMap::default(),
            modules: Vec::new(),
            read_symbols: FxHashSet::default(),
        };
        for parts in files {
            if parts.interop.kind == ModuleKind::Data && !parts.exports.is_empty() {
                reads.index_by_file.insert(parts.file, reads.modules.len());
                reads.modules.push(DataModule {
                    is_required_as_namespace: parts.interop.require_result
                        == RequireResult::Namespace,
                    is_namespace_reached: parts.is_library,
                });
            }
        }
        reads
    }

    fn find(&mut self, module: ModuleRef) -> Option<&mut DataModule> {
        match module {
            ModuleRef::File(file) => {
                let index = *self.index_by_file.get(&file)?;
                Some(&mut self.modules[index])
            }
            _ => None,
        }
    }

    fn reach_namespace(&mut self, module: ModuleRef) {
        if let Some(data_module) = self.find(module) {
            data_module.is_namespace_reached = true;
        }
    }

    fn read_symbol(&mut self, symbol: Sym) {
        if self.index_by_file.contains_key(&symbol.file) {
            self.read_symbols.insert(symbol);
        }
    }

    fn load(&mut self, module: ModuleRef, value: LoadedValue) {
        if let Some(data_module) = self.find(module) {
            data_module.is_namespace_reached |= match value {
                LoadedValue::Namespace => true,
                LoadedValue::RequireResult => data_module.is_required_as_namespace,
                LoadedValue::Nothing => false,
            };
        }
    }

    fn load_any_module(&mut self, value: LoadedValue) {
        for data_module in &mut self.modules {
            data_module.is_namespace_reached |= match value {
                LoadedValue::Namespace => true,
                LoadedValue::RequireResult => data_module.is_required_as_namespace,
                LoadedValue::Nothing => false,
            };
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

    fn add_site(&mut self, parts: &FileParts, site: ImportSiteKind, answer: &StoredSiteAnswer) {
        let value = loaded_value(site);
        match answer {
            StoredSiteAnswer::Module(module) => self.load(*module, value),
            StoredSiteAnswer::AllModules => self.load_any_module(value),
            StoredSiteAnswer::Candidates(range) => {
                for spelled in &parts.spellings[range.start as usize..range.end as usize] {
                    self.load(spelled.module, value);
                }
            }
            StoredSiteAnswer::Failed(_) | StoredSiteAnswer::Erased => {}
        }
    }

    fn add_file(&mut self, parts: &FileParts) {
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

pub(super) fn remove_unread_data_exports(files: &mut [FileParts]) {
    let mut reads = ExportReads::new(files);
    if reads.modules.is_empty() {
        return;
    }
    for parts in files.iter() {
        reads.add_file(parts);
    }
    for parts in files {
        let Some(&index) = reads.index_by_file.get(&parts.file) else {
            continue;
        };
        if reads.modules[index].is_namespace_reached {
            continue;
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
        parts
            .exports
            .retain(|export| match reads.is_unread(module, export) {
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
