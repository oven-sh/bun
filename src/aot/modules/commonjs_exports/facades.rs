use super::{CommonJsExports, CommonJsImport, CommonJsInput, Target};
use crate::modules::bindings::{ExportBinding, ImportBinding, ModuleExport, SyntheticExportId};
use crate::modules::exports::ExportTables;
use crate::modules::failures::{FailureOrder, ModuleFailureId, NumberedFailures};
use crate::modules::graph::{FindExportUse, retain_used_exports};
use crate::modules::imports::{FileImports, PendingBinding};
use crate::modules::interop::{ImportPhase, ModuleKind};
use crate::modules::module_set::ModuleSet;
use crate::modules::plan::Shape;
use crate::modules::requests::{FileScan, Scans};
use crate::modules::{ModuleRef, compare_code_units};
use bun_sema::atom::{Atom, known};
use bun_sema::hir::MemberKey;
use bun_sema::program::FileId;
use bun_sema::util::{FxHashSet, SharedSort};

const NO_FACADE: u32 = u32::MAX;

struct Facade {
    file: FileId,
    copies: Vec<SyntheticExportId>,
    ranks: Vec<u32>,
    exports: Vec<ModuleExport>,
    captures: bool,
}

type CheckedCopies = Vec<(SyntheticExportId, ModuleFailureId)>;

#[derive(Copy, Clone)]
struct UnnumberedCheck {
    copy: SyntheticExportId,
    importer: FileId,
    order: FailureOrder,
}

#[derive(Copy, Clone)]
struct RequestedName {
    importer: FileId,
    exporter: FileId,
    owner: ModuleRef,
    name: Atom,
}

#[derive(Copy, Clone)]
struct ImportedName {
    exporter: FileId,
    owner: FileId,
    name: Atom,
    copy: SyntheticExportId,
}

struct SeenNamespace {
    file: FileId,
    names: Option<Vec<Atom>>,
}

#[derive(Default)]
struct DecisionInputs {
    written_imports: Vec<CommonJsImport>,
    names_read: Vec<RequestedName>,
    imported_files: Vec<FileId>,
    absent_names: Vec<(CommonJsImport, FailureOrder)>,
    dropped_names: Vec<CommonJsImport>,
}

#[derive(Default)]
pub(super) struct Facades {
    inputs: DecisionInputs,
    imported_names: Vec<ImportedName>,
    places_by_owner: Vec<(FileId, u32)>,
    seen_namespaces: Vec<SeenNamespace>,
    copies_that_stay_empty: Vec<SyntheticExportId>,
    facade_indices: Vec<u32>,
    facades: Vec<Facade>,
    unnumbered_checks: Vec<UnnumberedCheck>,
    checks: Vec<(FileId, CheckedCopies)>,
}

pub(in crate::modules) fn collect_seen_namespaces(
    modules: &ModuleSet,
    tables: &ExportTables,
    imports: &[FileImports],
) -> Vec<FileId> {
    let mut seen = tables.commonjs_namespace_loads.clone();
    for file_imports in imports {
        let bindings = file_imports.bindings.iter();
        let namespaces = bindings.filter_map(|&(_, binding)| match binding {
            PendingBinding::Bound(ImportBinding::Namespace { module, .. }) => {
                modules.find_commonjs_file(module)
            }
            _ => None,
        });
        let values = &file_imports.namespace_values;
        seen.extend(namespaces.filter(|&file| values.contains(&ModuleRef::File(file))));
        let mocked = file_imports.mocked_modules.iter();
        seen.extend(mocked.filter_map(|&module| modules.find_commonjs_file(module)));
    }
    seen.sort_unstable();
    seen.dedup();
    seen
}

fn find_es_module(scans: &Scans, file: FileId) -> Option<&FileScan> {
    let scan = scans.find(file)?;
    (scan.interop.kind == ModuleKind::SourceText).then_some(scan)
}

fn collect_imported_files(scans: &Scans, modules: &ModuleSet) -> Vec<FileId> {
    let mut imported = Vec::new();
    for &importer in &modules.compiled_files {
        let Some(scan) = find_es_module(scans, importer) else {
            continue;
        };
        let requests = scan.requests.iter();
        let evaluated = requests.filter(|request| request.phase == ImportPhase::Evaluation);
        imported.extend(evaluated.filter_map(|it| modules.find_commonjs_file(it.target)));
    }
    imported.sort_unstable();
    imported.dedup();
    imported
}

fn collect_names_read(
    input: &CommonJsInput<'_, '_, '_>,
    tables: &ExportTables,
    imports: &[FileImports],
) -> Vec<RequestedName> {
    let (files, modules) = (input.bind.files, input.modules);
    let mut names = Vec::new();
    for (&importer, file_imports) in modules.compiled_files.iter().zip(imports) {
        let mut add = |binding: PendingBinding, named: ModuleRef, written_name: Atom| {
            if let PendingBinding::Synthetic { module, name } = binding
                && let Some(exporter) = tables.find_commonjs_exporter(modules, named, written_name)
            {
                names.push(RequestedName {
                    importer,
                    exporter,
                    owner: module,
                    name,
                });
            }
        };
        let hir = files.hir(importer);
        let members = file_imports.members.iter().zip(&file_imports.accessed);
        for (&(member, binding), &(_, accessed)) in members {
            if accessed.is_imported
                && let Some((_, MemberKey::Name(name))) = hir.member_key(member)
            {
                add(binding, accessed.module, name);
            }
        }
        for jsx in &file_imports.jsx {
            if let Some(exporter) = jsx.exporter {
                let name = files.atoms.intern(jsx.import.export_name());
                add(jsx.binding, exporter, name);
            }
        }
    }
    names
}

fn is_known_only_at_run_time(exports: &CommonJsExports, owner: ModuleRef, name: Atom) -> bool {
    let Some(text) = exports.text_of(owner) else {
        return false;
    };
    !exports.has_names(owner)
        && (!text.has_names
            || text.is_half
            || match name == known::default {
                true => {
                    exports.marker_for_imports(owner) != Some(false)
                        && !exports.has_default_of_its_own(owner)
                }
                false => !text.is_always_found_by_statements(name),
            })
}

impl Facades {
    pub(super) fn new(
        input: &CommonJsInput<'_, '_, '_>,
        tables: &ExportTables,
        imports: &[FileImports],
    ) -> Facades {
        let (files, scans, modules) = (input.bind.files, input.scans, input.modules);
        let seen = collect_seen_namespaces(modules, tables, imports).into_iter();
        let seen_namespaces = seen.map(|file| {
            let mut names = tables.commonjs.names_of(ModuleRef::File(file));
            if let Some(names) = &mut names {
                let bytes = |name: Atom| files.atoms.bytes(name);
                names.shared_sort_unstable_by(|&a, &b| compare_code_units(bytes(a), bytes(b)));
            }
            SeenNamespace { file, names }
        });
        let inputs = DecisionInputs {
            written_imports: tables.commonjs_imports.clone(),
            names_read: collect_names_read(input, tables, imports),
            imported_files: collect_imported_files(scans, modules),
            absent_names: tables.absent_commonjs_names.clone(),
            dropped_names: tables.dropped_commonjs_names.clone(),
        };
        Facades {
            inputs,
            seen_namespaces: seen_namespaces.collect(),
            facade_indices: vec![NO_FACADE; files.modules.len()],
            ..Facades::default()
        }
    }

    fn find(&self, file: FileId) -> Option<&Facade> {
        let place = *self.facade_indices.get(file.idx())?;
        self.facades.get(place as usize)
    }

    fn ensure_facade(&mut self, file: FileId) -> &mut Facade {
        let place = &mut self.facade_indices[file.idx()];
        if *place == NO_FACADE {
            *place = self.facades.len() as u32;
            self.facades.push(Facade {
                file,
                copies: Vec::new(),
                ranks: Vec::new(),
                exports: Vec::new(),
                captures: false,
            });
        }
        &mut self.facades[*place as usize]
    }

    fn find_seen_namespace(&self, file: FileId) -> Result<usize, usize> {
        let seen = &self.seen_namespaces;
        seen.binary_search_by_key(&file, |namespace| namespace.file)
    }

    fn add_copy(&mut self, exporter: FileId, owner: FileId, copy: SyntheticExportId, rank: u32) {
        let facade = self.ensure_facade(exporter);
        if !facade.copies.contains(&copy) {
            let place = facade.ranks.partition_point(|&earlier| earlier < rank);
            facade.copies.insert(place, copy);
            facade.ranks.insert(place, rank);
        }
        self.ensure_facade(owner);
    }

    fn list_imported_names(
        &mut self,
        exports: &CommonJsExports,
        written: Vec<CommonJsImport>,
        read: Vec<RequestedName>,
    ) {
        let written = written.into_iter().filter_map(|imported| {
            let CommonJsImport {
                importer,
                exporter,
                name,
            } = imported;
            let (owner, name) = exports.owner_of(ModuleRef::File(exporter), name)?;
            Some(RequestedName {
                importer,
                exporter,
                owner,
                name,
            })
        });
        let mut requested: Vec<(RequestedName, u32)> = written.chain(read).zip(0..).collect();
        requested.shared_sort_unstable_by_key(|&(requested, site)| (requested.importer, site));
        let mut listed = FxHashSet::default();
        let imported = requested.into_iter().filter_map(|(requested, _)| {
            let RequestedName { exporter, name, .. } = requested;
            let ModuleRef::File(owner) = requested.owner else {
                return None;
            };
            let copy = *exports.ids.get(&(requested.owner, name))?;
            listed.insert((exporter, copy)).then_some(ImportedName {
                exporter,
                owner,
                name,
                copy,
            })
        });
        self.imported_names = imported.collect();
        let owners = self.imported_names.iter().map(|imported| imported.owner);
        self.places_by_owner = owners.zip(0..).collect();
        self.places_by_owner.sort_unstable();
    }

    fn add_imported_name(&mut self, exports: &CommonJsExports, place: u32) {
        let ImportedName {
            exporter,
            owner,
            name,
            copy,
        } = self.imported_names[place as usize];
        let module = ModuleRef::File(owner);
        if exports.is_import_bound_to_variable(module, name) {
            return;
        }
        self.add_copy(exporter, owner, copy, place);
        if is_known_only_at_run_time(exports, module, name) {
            self.ensure_facade(owner).captures = true;
        }
    }

    fn export_of(
        &mut self,
        exports: &CommonJsExports,
        file: FileId,
        name: Atom,
        rank: u32,
    ) -> Option<ModuleExport> {
        let binding = match exports.imported_target(ModuleRef::File(file), name) {
            Target::Binding(symbol) => ExportBinding::Variable(symbol),
            Target::Nothing => return None,
            Target::Name(owner, owner_name) => {
                let copy = *exports.ids.get(&(owner, owner_name))?;
                if let ModuleRef::File(owner_file) = owner
                    && !exports.is_import_bound_to_variable(owner, owner_name)
                {
                    self.add_copy(file, owner_file, copy, rank);
                }
                ExportBinding::Synthetic(copy)
            }
        };
        Some(ModuleExport {
            name,
            binding,
            is_from_star_export: false,
            can_be_ambiguous: false,
            is_read_from_object: true,
        })
    }

    fn add_seen_namespace(&mut self, exports: &CommonJsExports, place: usize) {
        let file = self.seen_namespaces[place].file;
        let module = ModuleRef::File(file);
        let is_said_by_text =
            exports.shape(module) == Shape::Names && exports.marker(module).is_some();
        let names = self.seen_namespaces[place].names.take();
        let first_rank = self.imported_names.len() as u32;
        let table = names.as_ref().filter(|_| is_said_by_text).map(|names| {
            let mut table = Vec::with_capacity(names.len());
            for (&name, rank) in names.iter().zip(first_rank..) {
                table.extend(self.export_of(exports, file, name, rank));
            }
            table
        });
        self.seen_namespaces[place].names = names;
        let facade = self.ensure_facade(file);
        match table {
            Some(table) => facade.exports = table,
            None => {
                facade.captures = true;
                facade.exports.clear();
            }
        }
    }

    fn add_imported_file(&mut self, exports: &CommonJsExports, file: FileId) {
        let text = exports.text_of(ModuleRef::File(file));
        if text.is_none_or(|text| !text.has_names || exports.has_getter_for_unknown_name(text)) {
            self.ensure_facade(file).captures = true;
        }
    }

    fn decide_checks(
        &mut self,
        exports: &CommonJsExports,
        absent_names: Vec<(CommonJsImport, FailureOrder)>,
        dropped_names: Vec<CommonJsImport>,
    ) {
        let copy_of = |imported: CommonJsImport| {
            let owner = exports.owner_of(ModuleRef::File(imported.exporter), imported.name)?;
            exports.ids.get(&owner).copied()
        };
        let checks = absent_names.into_iter().filter_map(|(imported, order)| {
            Some(UnnumberedCheck {
                copy: copy_of(imported)?,
                importer: imported.importer,
                order,
            })
        });
        self.unnumbered_checks = checks.collect();
        debug_assert!(self.unnumbered_checks.is_sorted_by_key(|it| it.importer));
        self.copies_that_stay_empty = dropped_names.into_iter().filter_map(copy_of).collect();
        self.copies_that_stay_empty.sort_unstable();
        self.copies_that_stay_empty.dedup();
    }

    pub(super) fn decide(&mut self, exports: &CommonJsExports) {
        let inputs = core::mem::take(&mut self.inputs);
        self.list_imported_names(exports, inputs.written_imports, inputs.names_read);
        for place in 0..self.imported_names.len() as u32 {
            self.add_imported_name(exports, place);
        }
        for place in 0..self.seen_namespaces.len() {
            self.add_seen_namespace(exports, place);
        }
        for file in inputs.imported_files {
            self.add_imported_file(exports, file);
        }
        self.decide_checks(exports, inputs.absent_names, inputs.dropped_names);
    }

    pub(super) fn see_namespace(&mut self, exports: &CommonJsExports, file: FileId) {
        if let Err(place) = self.find_seen_namespace(file) {
            let namespace = SeenNamespace { file, names: None };
            self.seen_namespaces.insert(place, namespace);
            self.add_seen_namespace(exports, place);
        }
    }

    pub(super) fn decide_behind(&mut self, exports: &CommonJsExports, module: ModuleRef) {
        let ModuleRef::File(file) = module else {
            return;
        };
        let first = self.places_by_owner.partition_point(|entry| entry.0 < file);
        let count = self.places_by_owner[first..].partition_point(|entry| entry.0 == file);
        for at in first..first + count {
            self.add_imported_name(exports, self.places_by_owner[at].1);
        }
        if let Ok(place) = self.find_seen_namespace(file) {
            self.add_seen_namespace(exports, place);
        }
    }
}

impl CommonJsExports {
    pub fn facade(&self, module: ModuleRef) -> Option<ModuleRef> {
        match module {
            ModuleRef::File(file) if self.facades.find(file).is_some() => {
                Some(ModuleRef::Facade(file))
            }
            _ => None,
        }
    }

    pub fn copies(&self, facade: FileId) -> &[SyntheticExportId] {
        let facade = self.facades.find(facade);
        facade.map_or(&[], |facade| &facade.copies[..])
    }

    pub fn facade_exports(&self, facade: FileId) -> &[ModuleExport] {
        let facade = self.facades.find(facade);
        facade.map_or(&[], |facade| &facade.exports[..])
    }

    pub(in crate::modules) fn retain_used_facade_exports(&mut self, find_use: FindExportUse<'_>) {
        for facade in &mut self.facades.facades {
            retain_used_exports(&mut facade.exports, facade.file, find_use);
        }
    }

    pub fn has_capturing_facade(&self, facade: FileId) -> bool {
        let facade = self.facades.find(facade);
        facade.is_some_and(|facade| facade.captures)
    }

    pub(in crate::modules) fn number_checks(&mut self, failures: &NumberedFailures) {
        let number =
            |check: &UnnumberedCheck| (check.copy, failures.id_of(check.importer, check.order));
        let unnumbered = core::mem::take(&mut self.facades.unnumbered_checks);
        let by_importer = unnumbered.chunk_by(|a, b| a.importer == b.importer);
        let numbered =
            by_importer.map(|checks| (checks[0].importer, checks.iter().map(number).collect()));
        self.facades.checks = numbered.collect();
    }

    pub fn checked_copies(&self, importer: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        debug_assert!(
            self.facades.unnumbered_checks.is_empty(),
            "the checks have no numbers yet"
        );
        let checks = &self.facades.checks;
        let found = checks.binary_search_by_key(&importer, |entry| entry.0);
        found.map_or(&[], |place| &checks[place].1[..])
    }

    pub fn may_stay_empty(&self, copy: SyntheticExportId) -> bool {
        let copies = &self.facades.copies_that_stay_empty;
        copies.binary_search(&copy).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::testing::{file_named, with_test_run_graph};

    #[test]
    fn copies_are_ordered_by_rank_in_any_insertion_order() {
        let mut facades = Facades {
            facade_indices: vec![NO_FACADE; 3],
            ..Facades::default()
        };
        let [exporter, owner] = [FileId(0), FileId(2)];
        for (copy, rank) in [(7, 5), (3, 2), (7, 9), (4, 3)] {
            facades.add_copy(exporter, owner, SyntheticExportId(copy), rank);
        }
        let facade = facades.find(exporter).expect("the exporter has a facade");
        assert_eq!(facade.copies, [3, 4, 7].map(SyntheticExportId));
        assert!(facades.find(owner).is_some());
        assert!(facades.find(FileId(1)).is_none());
    }

    #[test]
    fn a_check_throws_the_failure_of_its_own_name() {
        let above = "import { absent } from './fine.mjs'; import { nope } from './lib.cjs';\n\
                     console.log(absent, nope);";
        let files = [
            ("main.test.mjs", "import './above.mjs';"),
            ("above.mjs", above),
            ("fine.mjs", "export {};"),
            ("lib.cjs", "exports.a = 1;"),
        ];
        with_test_run_graph(&files, |graph, input| {
            let [above, lib] = ["above.mjs", "lib.cjs"].map(|name| file_named(input, name));
            let checked = graph.commonjs().checked_copies(above);
            let [(_, failure)] = checked else {
                panic!("{checked:?}");
            };
            assert_eq!(graph.failures().len(), 2);
            let exporter = graph.failure(*failure).exporter();
            assert_eq!(exporter, Some(ModuleRef::File(lib)));
        });
    }
}
