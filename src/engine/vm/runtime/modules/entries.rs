//! What a module imports and exports.

use bun_engine_bytecode::{self as bytecode, ImportPhase};
use bun_engine_text::{Identifier, PropertyName, StringRef, names, private_names};
use hashbrown::HashTable;

use crate::{FastHashMap, FastHashSet, FetchParameters, ModuleKey, ModuleRequest};

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ImportKind {
    Single,
    /// The same, but it may name a type, which nothing exports.
    SingleTypeScript,
    Namespace,
}

#[derive(Clone)]
#[repr(C)]
pub struct ImportEntry {
    pub kind: ImportKind,
    pub phase: ImportPhase,
    pub module: ModuleKey,
    /// `@starNamespace` for a namespace.
    pub imported: Identifier,
    pub local: Identifier,
}

#[derive(Clone)]
pub enum ExportSource {
    /// `@starDefault` names what `export default` declares without a name.
    Local(Identifier),
    Indirect {
        module: ModuleKey,
        imported: Identifier,
    },
    Namespace(ModuleKey),
}

#[derive(Clone)]
pub struct ExportEntry {
    pub exported: Identifier,
    pub source: ExportSource,
}

#[derive(Clone, Default)]
pub struct ModuleEntries {
    requests: Vec<ModuleRequest>,
    imports: Vec<ImportEntry>,
    exports: Vec<ExportEntry>,
    /// Positions in `exports`.
    exports_by_name: HashTable<u32>,
    star_exports: Vec<ModuleKey>,
}

fn spread(name: PropertyName<'_>) -> u64 {
    u64::from(name.hash()).wrapping_mul(0x9e37_79b9_7f4a_7c15)
}

impl ModuleEntries {
    /// In the order in which they are loaded and evaluated.
    pub fn requests(&self) -> &[ModuleRequest] {
        &self.requests
    }

    pub fn imports(&self) -> &[ImportEntry] {
        &self.imports
    }

    pub fn exports(&self) -> &[ExportEntry] {
        &self.exports
    }

    pub fn star_exports(&self) -> &[ModuleKey] {
        &self.star_exports
    }

    pub fn find_export(&self, name: PropertyName<'_>) -> Option<&ExportEntry> {
        let has_name = |&index: &u32| self.exports[index as usize].exported == name;
        let &index = self.exports_by_name.find(spread(name), has_name)?;
        Some(&self.exports[index as usize])
    }

    pub fn reserve(&mut self, requests: usize, imports: usize, exports: usize) {
        self.requests.reserve_exact(requests);
        self.imports.reserve_exact(imports);
        self.exports.reserve_exact(exports);
        let hash = |&index: &u32| spread(self.exports[index as usize].exported.name());
        self.exports_by_name.reserve(exports, hash);
    }

    pub fn add_request(&mut self, request: ModuleRequest) {
        self.requests.push(request);
    }

    pub fn add_import(&mut self, entry: ImportEntry) {
        self.imports.push(entry);
    }

    /// The first of a name counts.
    pub fn add_export(&mut self, exported: Identifier, source: ExportSource) {
        if self.find_export(exported.name()).is_some() {
            return;
        }
        let (hash, index) = (spread(exported.name()), self.exports.len() as u32);
        self.exports.push(ExportEntry { exported, source });
        let rehash = |&index: &u32| spread(self.exports[index as usize].exported.name());
        self.exports_by_name.insert_unique(hash, index, rehash);
    }

    pub fn add_star_export(&mut self, module: ModuleKey) {
        if !self.star_exports.contains(&module) {
            self.star_exports.push(module);
        }
    }

    pub(super) fn size(&self) -> usize {
        self.requests.capacity() * size_of::<ModuleRequest>()
            + self.imports.capacity() * size_of::<ImportEntry>()
            + self.exports.capacity() * size_of::<ExportEntry>()
            + self.exports_by_name.allocation_size()
            + self.star_exports.capacity() * size_of::<ModuleKey>()
    }

    /// The part of ParseModule that follows parsing. The error is the message of a TypeError.
    pub fn of_module(
        module: &bytecode::Module,
        is_typescript: bool,
    ) -> Result<ModuleEntries, StringRef> {
        let mut entries = ModuleEntries::default();
        let (imports, exports) = (&module.imports, &module.exports);
        entries.reserve(module.requests.len(), imports.len(), exports.len());
        let mut keys = Vec::with_capacity(module.requests.len());
        let mut seen = FastHashSet::default();
        for request in &module.requests {
            let attribute = (request.attributes.iter()).find(|(key, _)| *key == names::r#type);
            let parameters = attribute.map(|it| FetchParameters::for_declaration(it.1.string()));
            let request = ModuleRequest {
                specifier: request.specifier.clone().into(),
                parameters: parameters.transpose()?,
                phase: request.phase,
            };
            keys.push(request.key().to_key());
            if seen.insert((request.key().to_key(), request.phase as u8)) {
                entries.add_request(request);
            }
        }
        for import in imports {
            let (kind, imported) = match &import.imported {
                Some(name) => (ImportKind::Single, name.clone().into()),
                None => (
                    ImportKind::Namespace,
                    private_names::starNamespace.to_identifier(),
                ),
            };
            entries.add_import(ImportEntry {
                kind,
                phase: module.requests[import.request as usize].phase,
                module: keys[import.request as usize].clone(),
                imported,
                local: import.local.clone().into(),
            });
        }
        let imports_by_slot: FastHashMap<u32, usize> = (imports.iter().enumerate())
            .map(|(index, import)| (import.slot, index))
            .collect();
        for export in exports {
            match export {
                bytecode::ExportEntry::Star { request } => {
                    entries.add_star_export(keys[*request as usize].clone());
                }
                bytecode::ExportEntry::Indirect {
                    exported,
                    request,
                    imported,
                } => {
                    let module = keys[*request as usize].clone();
                    let source = match imported {
                        Some(imported) => ExportSource::Indirect {
                            module,
                            imported: imported.clone().into(),
                        },
                        None => ExportSource::Namespace(module),
                    };
                    entries.add_export(exported.clone().into(), source);
                }
                bytecode::ExportEntry::Local { exported, slot } => {
                    let source = match imports_by_slot.get(slot) {
                        Some(&index) => entries.imports[index].as_export(),
                        None => ExportSource::Local(local_name(&module.scope, *slot)),
                    };
                    entries.add_export(exported.clone().into(), source);
                }
            }
        }
        if is_typescript {
            entries.allow_for_types();
        }
        Ok(entries)
    }

    /// What is imported and exported again may be one.
    fn allow_for_types(&mut self) {
        let reexported = self.exports.iter().filter_map(|it| match &it.source {
            ExportSource::Indirect { module, imported } => Some((module, imported)),
            _ => None,
        });
        let reexported: FastHashSet<_> = reexported.collect();
        for import in &mut self.imports {
            if reexported.contains(&(&import.module, &import.imported)) {
                import.kind = ImportKind::SingleTypeScript;
            }
        }
    }
}

impl ImportEntry {
    fn as_export(&self) -> ExportSource {
        match (self.kind, self.phase) {
            (ImportKind::Namespace, ImportPhase::Defer) => ExportSource::Local(self.local.clone()),
            (ImportKind::Namespace, ImportPhase::Evaluation) => {
                ExportSource::Namespace(self.module.clone())
            }
            _ => ExportSource::Indirect {
                module: self.module.clone(),
                imported: self.imported.clone(),
            },
        }
    }
}

fn local_name(scope: &bytecode::StaticScope, slot: u32) -> Identifier {
    let slot = scope.slot_at(slot).expect("what is exported has a slot");
    let name = scope.name_of(slot);
    if name == names::starDefaultText {
        return private_names::starDefault.to_identifier();
    }
    name
}
