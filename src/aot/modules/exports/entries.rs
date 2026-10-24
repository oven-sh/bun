use crate::ir::for_each_mut;
use crate::modules::commonjs_exports::CommonJsImport;
use crate::modules::failures::{SitePart, WrittenPart};
use crate::modules::imports::{
    ImportedItem, find_imported_value_site, imported_items, may_name_value,
};
use crate::modules::interop::{ImportPhase, ModuleKind};
use crate::modules::module_set::ModuleSet;
use crate::modules::requests::{FileScan, ScannedSite, Scans, import_phase};
use crate::modules::{BindInput, ModuleRef, find_library_files};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, Decl, SymbolId};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::hir::{self, ExportSpecId, ImportId, StmtId};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, FileRole, Files, Sym};

#[derive(Copy, Clone, Debug)]
pub(in crate::modules) enum ExportEntry {
    Local(SymbolId),
    ImportedNamespace {
        site: u32,
        phase: ImportPhase,
    },
    Namespace {
        site: u32,
    },
    Indirect {
        site: u32,
        name: Atom,
        written: Option<WrittenPart>,
    },
}

pub(in crate::modules) struct ExportEntries {
    pub file: FileId,
    pub own: Vec<(Atom, ExportEntry)>,
    pub stars: Vec<u32>,
    /// The names that the file imports, or exports again, of CommonJS files.
    pub commonjs_imports: Vec<WrittenImport>,
}

/// A name of a CommonJS file, where an ES module writes it.
#[derive(Copy, Clone, Debug)]
pub(in crate::modules) struct WrittenImport {
    pub imported: CommonJsImport,
    /// `false`: the name may be a type, which no module has at run time.
    pub must_be_there: bool,
    pub written: WrittenPart,
}

pub(in crate::modules) struct CollectedEntries {
    /// Of the modules that have an export table, in the order of the files.
    pub tables: Vec<ExportEntries>,
    pub commonjs_imports: Vec<WrittenImport>,
    /// The CommonJS files that `import()` or `export *` name.
    pub commonjs_namespace_loads: Vec<FileId>,
}

fn find_commonjs_file(modules: &ModuleSet, module: ModuleRef) -> Option<FileId> {
    match module {
        ModuleRef::File(file) if modules.interop(module).kind == ModuleKind::CommonJs => Some(file),
        _ => None,
    }
}

fn collect_namespace_loads(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> Vec<FileId> {
    let mut loads = Vec::new();
    for &file in &modules.compiled_files {
        let scan = scans.of(file);
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, scanned) in sites.zip(&scan.sites) {
            match site.kind {
                ImportSiteKind::ImportCall(_) | ImportSiteKind::ExportStar(_) => {}
                _ => continue,
            }
            match scanned {
                ScannedSite::Module(module) => loads.extend(find_commonjs_file(modules, *module)),
                ScannedSite::Candidates(range) => {
                    let spelled = &scan.spellings[range.start as usize..range.end as usize];
                    let candidates = spelled.iter().map(|spelled| spelled.module);
                    loads.extend(candidates.filter_map(|it| find_commonjs_file(modules, it)));
                }
                ScannedSite::Unresolved | ScannedSite::AllModules | ScannedSite::Erased => {}
            }
        }
    }
    loads
}

pub(in crate::modules) fn collect_export_entries(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> CollectedEntries {
    let files = input.files;
    let is_library = find_library_files(input);
    let create_entries = |&file: &FileId| {
        Some(ExportEntries {
            file: modules.table_file(ModuleRef::File(file))?,
            own: Vec::new(),
            stars: Vec::new(),
            commonjs_imports: Vec::new(),
        })
    };
    let record_files = modules.record_files.iter();
    let mut entries: Vec<ExportEntries> = record_files.filter_map(create_entries).collect();
    for_each_mut(&mut entries, input.in_parallel, &|module| {
        let file = module.file;
        if files.role(file) == FileRole::TypesOnly || is_library[file.idx()] {
            return;
        }
        let collector = EntryCollector {
            files,
            file,
            hir: files.hir(file),
            bound: files.bound(file),
            analysis: files.analysis(file),
            scan: scans.of(file),
            modules,
        };
        module.own = collector.collect_own_entries();
        module.stars = collector.collect_stars();
        module.commonjs_imports = collector.collect_commonjs_imports(&module.own);
    });
    let tables = entries.iter_mut();
    let commonjs_imports = tables.flat_map(|module| module.commonjs_imports.drain(..));
    CollectedEntries {
        commonjs_imports: commonjs_imports.collect(),
        tables: entries,
        commonjs_namespace_loads: collect_namespace_loads(input, scans, modules),
    }
}

pub(super) enum ImportedName {
    Name(Atom),
    Namespace,
}

struct EntryCollector<'a, 's> {
    files: &'a Files<'s>,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    scan: &'a FileScan,
    modules: &'a ModuleSet,
}

impl EntryCollector<'_, '_> {
    fn commonjs_file_at(&self, site: usize) -> Option<FileId> {
        match &self.scan.sites[site] {
            ScannedSite::Module(module) => find_commonjs_file(self.modules, *module),
            _ => None,
        }
    }

    fn add_names_of_import(&self, id: ImportId, imports: &mut Vec<WrittenImport>) {
        let site_kind = ImportSiteKind::Import(id);
        let Some(site) = self.analysis.import_site_index(site_kind) else {
            return;
        };
        let Some(exporter) = self.commonjs_file_at(site) else {
            return;
        };
        for (declaration, item) in imported_items(self.files, self.hir, id) {
            let (name, part, range) = match item {
                ImportedItem::Name { name, part, range } => (name, part, range),
                ImportedItem::Namespace(_) => continue,
            };
            let symbol = self.bound.declared_symbol(declaration);
            let is_value = symbol.is_some()
                && find_imported_value_site(self.files, self.file, self.scan, id, symbol).is_some();
            if is_value {
                imports.push(WrittenImport {
                    imported: CommonJsImport {
                        importer: self.file,
                        exporter,
                        name,
                    },
                    must_be_there: true,
                    written: WrittenPart::new(site, part, site_kind, range),
                });
            }
        }
    }

    fn collect_commonjs_imports(&self, own: &[(Atom, ExportEntry)]) -> Vec<WrittenImport> {
        let mut imports = Vec::new();
        for index in 0..self.hir.imports.len() as u32 {
            self.add_names_of_import(ImportId(index), &mut imports);
        }
        for &(_, entry) in own {
            let ExportEntry::Indirect {
                site,
                name,
                written: Some(written),
            } = entry
            else {
                continue;
            };
            let exporter = self.commonjs_file_at(site as usize);
            imports.extend(exporter.map(|exporter| WrittenImport {
                imported: CommonJsImport {
                    importer: self.file,
                    exporter,
                    name,
                },
                must_be_there: !self.hir.has_typescript_semantics(),
                written,
            }));
        }
        imports
    }

    fn collect_own_entries(&self) -> Vec<(Atom, ExportEntry)> {
        let bound = self.bound;
        let entry_of = |&(name, symbol): &(Atom, SymbolId)| {
            let mut declarations = bound.symbol(symbol).decls.iter();
            let entry = declarations.find_map(|&decl| self.declaration_entry(symbol, decl))?;
            (name != known::export_equals).then_some((name, entry))
        };
        let table = bound.table(bound.symbol(bound.file_symbol).exports);
        table.iter().filter_map(entry_of).collect()
    }

    fn collect_stars(&self) -> Vec<u32> {
        let site_of = |&(container, statement): &(SymbolId, StmtId)| {
            let kind = ImportSiteKind::ExportStar(statement);
            let site = self.analysis.import_site_index(kind)?;
            let is_loaded = matches!(self.scan.sites[site], ScannedSite::Module(_));
            (is_loaded && container == self.bound.file_symbol).then_some(site as u32)
        };
        let stars = self.bound.export_stars.iter();
        stars.filter_map(site_of).collect()
    }

    fn declaration_entry(&self, symbol: SymbolId, declaration: Decl) -> Option<ExportEntry> {
        match declaration {
            Decl::ExportSpec(specifier) => self.specifier_entry(symbol, specifier),
            Decl::ExportStarAs(statement) => {
                let site = self.find_value_site(ImportSiteKind::ExportStar(statement), symbol)?;
                Some(ExportEntry::Namespace { site })
            }
            Decl::Var(_)
            | Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Enum(_)
            | Decl::Module(_)
            | Decl::ImportEquals(_)
            | Decl::ExportExpr(_) => {
                let local = self.bound.declared_symbol(declaration);
                let has_value = local.is_some() && self.bound.has_runtime_value(local);
                has_value.then_some(ExportEntry::Local(local))
            }
            _ => None,
        }
    }

    fn specifier_entry(&self, alias: SymbolId, specifier: ExportSpecId) -> Option<ExportEntry> {
        let item = self.hir[specifier];
        let export = self.hir[item.export];
        if item.type_only || export.type_only {
            return None;
        }
        if !export.has_module_specifier {
            return match self.bound.exported_binding(specifier) {
                Binding::Symbol(local) => self.local_entry(local),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
            };
        }
        let site_kind = ImportSiteKind::ExportFrom(item.export);
        let site = self.find_value_site(site_kind, alias)?;
        let part = SitePart::Name(specifier.0 - export.items.start);
        let written = WrittenPart::new(site as usize, part, site_kind, item.start..item.end);
        Some(ExportEntry::Indirect {
            site,
            name: item.local,
            written: Some(written),
        })
    }

    fn find_import_declaration(&self, local: SymbolId) -> Option<(ImportId, ImportedName)> {
        let mut declarations = self.bound.symbol(local).decls.iter();
        declarations.find_map(|&declaration| {
            let import = match declaration {
                Decl::ImportDefault(import) => (import, ImportedName::Name(known::default)),
                Decl::ImportNamespace(import) => (import, ImportedName::Namespace),
                Decl::ImportSpec(specifier) => {
                    let specifier = self.hir[specifier];
                    (specifier.import, ImportedName::Name(specifier.imported))
                }
                _ => return None,
            };
            (self.bound.declared_symbol(declaration) == local).then_some(import)
        })
    }

    fn local_entry(&self, local: SymbolId) -> Option<ExportEntry> {
        let Some((import, imported)) = self.find_import_declaration(local) else {
            let has_value = self.bound.has_runtime_value(local);
            return has_value.then_some(ExportEntry::Local(local));
        };
        let site = find_imported_value_site(self.files, self.file, self.scan, import, local)?;
        let site = site as u32;
        Some(match imported {
            ImportedName::Namespace => ExportEntry::ImportedNamespace {
                site,
                phase: import_phase(self.hir, import),
            },
            ImportedName::Name(name) => ExportEntry::Indirect {
                site,
                name,
                written: None,
            },
        })
    }

    fn find_value_site(&self, kind: ImportSiteKind, alias: SymbolId) -> Option<u32> {
        let site = self.analysis.import_site_index(kind)?;
        let (file, id) = (self.file, alias);
        let has_value = || may_name_value(self.files, Sym { file, id });
        let is_type = self.files.role(file) == FileRole::Checked && !has_value();
        let is_erased = is_type || self.scan.sites[site] == ScannedSite::Erased;
        (!is_erased).then_some(site as u32)
    }
}

#[cfg(test)]
mod tests {
    use crate::modules::ExportBinding;
    use crate::modules::testing::{file_named, with_graph};

    fn assert_exported_variables(files: &[(&str, &str)], expected: &[(&str, &str)]) {
        with_graph(files, |graph, input| {
            for &(exporter, declaring_file) in expected {
                let [export] = graph.exports(file_named(input, exporter)) else {
                    panic!("{exporter} does not have exactly one export");
                };
                let ExportBinding::Variable(symbol) = export.binding else {
                    panic!("{exporter}: {:?}", export.binding);
                };
                assert_eq!(symbol.file, file_named(input, declaring_file), "{exporter}");
            }
        });
    }

    #[test]
    fn local_value_replaces_import() {
        let files = [
            ("main.ts", "import './type_only'; import './named'"),
            ("types.ts", "export interface A {}"),
            (
                "type_only.ts",
                "import type { A } from './types'; function A() {} export { A }",
            ),
            (
                "named.ts",
                "import { A } from './types'; const A = 1; export { A }",
            ),
        ];
        let expected = [("type_only.ts", "type_only.ts"), ("named.ts", "named.ts")];
        assert_exported_variables(&files, &expected);
    }

    #[test]
    fn import_after_interface_is_indirect() {
        let files = [
            ("main.ts", "import './merged'"),
            ("values.ts", "export const b = 1"),
            (
                "merged.ts",
                "interface b {} import { b } from './values'; export { b }",
            ),
        ];
        assert_exported_variables(&files, &[("merged.ts", "values.ts")]);
    }
}
