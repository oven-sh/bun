//! What ES modules see of a CommonJS file.

use super::own_text::Form;
use super::{CommonJsExports, CommonJsImport, CommonJsInput, Target};
use crate::ir::parallel::for_each_mut;
use crate::modules::bindings::{ExportBinding, ImportBinding, ModuleExport, SyntheticExportId};
use crate::modules::code_unit_order::compare_code_units;
use crate::modules::exports::ExportTables;
use crate::modules::failures::{ModuleFailureId, number_failures};
use crate::modules::imports::{FileImports, PendingBinding};
use crate::modules::interop::ModuleKind;
use crate::modules::module_set::ModuleSet;
use crate::modules::plan::Shape;
use crate::modules::reached_targets::ReachedTargets;
use crate::modules::requests::Scans;
use crate::modules::{ModuleRef, collect_pending_failures};
use bun_sema::atom::{Atom, known};
use bun_sema::program::FileId;
use bun_sema::util::{FxHashMap, FxHashSet};

#[derive(Default)]
struct Face {
    copies: Vec<SyntheticExportId>,
    exports: Vec<ModuleExport>,
    captures: bool,
}

type CheckedCopies = Vec<(SyntheticExportId, ModuleFailureId)>;

// A name that an ES module imports and that the CommonJS module may end without.
#[derive(Copy, Clone)]
struct AbsentName {
    imported: CommonJsImport,
    failure: ModuleFailureId,
}

// A variable of a CommonJS module that an ES module imports.
#[derive(Copy, Clone)]
pub(in crate::modules) struct ImportedVariable {
    /// The file that the import names, whose face takes the copy.
    pub(in crate::modules) exporter: FileId,
    /// The module that has the variable, and its name there.
    owner: ModuleRef,
    pub(in crate::modules) name: Atom,
}

#[derive(Default)]
pub(super) struct Faces {
    /// What import statements and `export { .. } from` name.
    written_imports: Vec<CommonJsImport>,
    imported_variables: Vec<ImportedVariable>,
    /// By the module that has the variable: the positions in `imported_variables`.
    imports_by_owner: FxHashMap<ModuleRef, Vec<u32>>,
    seen_namespaces: Vec<FileId>,
    /// By file, in the order of code units, where the text of the file says all of them.
    names_of_namespaces: FxHashMap<FileId, Vec<Atom>>,
    /// In the order of the importers, and in each in the order of its text.
    absent_names: Vec<AbsentName>,
    /// By root: the ES modules that are linked with it and import a name that may be absent, in the order of the link.
    linked_importers: Vec<(FileId, Vec<FileId>)>,
    faces: FxHashMap<FileId, Face>,
    checks: FxHashMap<FileId, CheckedCopies>,
    is_decided: bool,
}

fn find_commonjs_file(modules: &ModuleSet, module: ModuleRef) -> Option<FileId> {
    match module {
        ModuleRef::File(file) if modules.interop(module).kind == ModuleKind::CommonJs => Some(file),
        _ => None,
    }
}

/// The CommonJS files whose namespace object something may look at: `ns` as a value, `import()`, `export *`.
pub(in crate::modules) fn collect_seen_namespaces(
    modules: &ModuleSet,
    tables: &ExportTables,
    imports: &[FileImports],
) -> Vec<FileId> {
    let mut seen = tables.commonjs_namespace_loads().to_vec();
    for file_imports in imports {
        let bindings = file_imports.bindings.iter();
        let namespaces = bindings.filter_map(|&(_, binding)| match binding {
            PendingBinding::Bound(ImportBinding::Namespace { module, .. }) => {
                find_commonjs_file(modules, module)
            }
            _ => None,
        });
        let is_value = |file: &FileId| {
            file_imports
                .namespace_values
                .contains(&ModuleRef::File(*file))
        };
        seen.extend(namespaces.filter(is_value));
    }
    seen.sort_unstable();
    seen.dedup();
    seen
}

// `ns.name`, where `ns` is the namespace of a CommonJS file, and the names that JSX imports.
pub(in crate::modules) fn collect_members_of_namespaces(
    modules: &ModuleSet,
    imports: &[FileImports],
) -> Vec<ImportedVariable> {
    let mut variables = Vec::new();
    for file_imports in imports {
        let members = file_imports.members.iter().zip(&file_imports.accessed);
        for (&(_, binding), &(_, accessed)) in members {
            let PendingBinding::Synthetic { module, name } = binding else {
                continue;
            };
            if !accessed.is_imported {
                continue;
            }
            let exporter = find_commonjs_file(modules, accessed.module);
            variables.extend(exporter.map(|exporter| ImportedVariable {
                exporter,
                owner: module,
                name,
            }));
        }
        // What JSX imports without a statement.
        for (&(_, binding), &exporter) in file_imports.jsx.iter().zip(&file_imports.jsx_exporters) {
            let (PendingBinding::Synthetic { module, name }, Some(exporter)) = (binding, exporter)
            else {
                continue;
            };
            let exporter = find_commonjs_file(modules, exporter);
            variables.extend(exporter.map(|exporter| ImportedVariable {
                exporter,
                owner: module,
                name,
            }));
        }
    }
    variables
}

// By ES module: the ES modules that it imports, in the order of its text.
fn collect_imports_between_es_modules(
    scans: &Scans,
    modules: &ModuleSet,
    file_count: usize,
) -> Vec<Vec<FileId>> {
    let is_es_module = |file: FileId| {
        scans
            .find(file)
            .is_some_and(|scan| scan.interop.kind == ModuleKind::SourceText)
    };
    let mut imports = Vec::new();
    imports.resize_with(file_count, Vec::new);
    for &file in &modules.compiled_files {
        if !is_es_module(file) {
            continue;
        }
        let requests = scans.find(file).map_or(&[][..], |scan| &scan.requests[..]);
        let imported = requests.iter().filter_map(|request| match request.target {
            ModuleRef::File(target) if is_es_module(target) => Some(target),
            _ => None,
        });
        imports[file.idx()] = imported.collect();
    }
    imports
}

// A module is linked behind everything that it imports. Of the modules that are linked with `root`, the targets.
fn list_targets_in_link_order(
    root: FileId,
    imports: &[Vec<FileId>],
    below: &ReachedTargets,
) -> Vec<FileId> {
    let mut order = Vec::new();
    let mut remaining = below.start_walk(root);
    remaining.take(below, root);
    let mut visited = FxHashSet::default();
    visited.insert(root);
    let mut calls = vec![(root, 0)];
    while let Some((file, next)) = calls.last_mut() {
        let Some(&imported) = imports[file.idx()].get(*next) else {
            if below.is_target(*file) {
                order.push(*file);
            }
            calls.pop();
            continue;
        };
        *next += 1;
        if remaining.has_some_below(below, imported) && visited.insert(imported) {
            remaining.take(below, imported);
            calls.push((imported, 0));
        }
    }
    order
}

impl Faces {
    pub(super) fn new(
        input: &CommonJsInput<'_, '_, '_>,
        tables: &ExportTables,
        imports: &[FileImports],
    ) -> Faces {
        let (scans, modules) = (input.scans, input.modules);
        let mut faces = Faces {
            written_imports: tables.commonjs_imports().to_vec(),
            imported_variables: collect_members_of_namespaces(modules, imports),
            seen_namespaces: collect_seen_namespaces(modules, tables, imports),
            ..Faces::default()
        };
        let atoms = &input.bind.files.atoms;
        for &file in &faces.seen_namespaces {
            if let Some(mut names) = tables.names_of_commonjs_module(ModuleRef::File(file)) {
                names.sort_unstable_by(|&a, &b| compare_code_units(atoms.bytes(a), atoms.bytes(b)));
                faces.names_of_namespaces.insert(file, names);
            }
        }
        if tables.absent_commonjs_names().is_empty() {
            return faces;
        }
        // The numbers that the failures of the program get.
        let pending = collect_pending_failures(scans, modules, tables, imports);
        let failures = number_failures(input.bind.files.modules.len(), pending);
        let absent_names = tables.absent_commonjs_names().iter();
        let absent_names: Vec<AbsentName> = absent_names
            .map(|&(imported, order)| AbsentName {
                imported,
                failure: failures.id_of(imported.importer, order),
            })
            .collect();
        let file_count = input.bind.files.modules.len();
        let es_imports = collect_imports_between_es_modules(scans, modules, file_count);
        let importers = absent_names.iter().map(|absent| absent.imported.importer);
        let importers_below = ReachedTargets::compute(importers, &es_imports);
        let mut roots: Vec<FileId> = modules.compiled_files.clone();
        roots.retain(|&root| importers_below.leads_to_target(root) && (input.is_prefix_root)(root));
        roots.sort_unstable();
        faces.linked_importers = roots.into_iter().map(|root| (root, Vec::new())).collect();
        for_each_mut(
            &mut faces.linked_importers,
            input.bind.in_parallel,
            &|(root, linked)| {
                *linked = list_targets_in_link_order(*root, &es_imports, &importers_below);
            },
        );
        faces.absent_names = absent_names;
        faces
    }

    pub(super) fn has_face(&self, file: FileId) -> bool {
        self.faces.contains_key(&file)
    }

    pub(super) fn seen_namespaces(&self) -> &[FileId] {
        &self.seen_namespaces
    }

    pub(super) fn copies(&self, file: FileId) -> &[SyntheticExportId] {
        self.faces.get(&file).map_or(&[], |face| &face.copies[..])
    }

    pub(super) fn exports(&self, file: FileId) -> &[ModuleExport] {
        self.faces.get(&file).map_or(&[], |face| &face.exports[..])
    }

    pub(super) fn captures(&self, file: FileId) -> bool {
        self.faces.get(&file).is_some_and(|face| face.captures)
    }

    pub(super) fn checked_copies(&self, root: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        self.checks.get(&root).map_or(&[], |copies| &copies[..])
    }

    fn add_copy(&mut self, exporter: FileId, owner: ModuleRef, id: SyntheticExportId) {
        let copies = &mut self.faces.entry(exporter).or_default().copies;
        if !copies.contains(&id) {
            copies.push(id);
        }
        // The copy is a variable of the face of the file that has the name.
        if let ModuleRef::File(owner) = owner {
            self.faces.entry(owner).or_default();
        }
    }

    fn add_imported_variable(&mut self, exports: &CommonJsExports, imported: ImportedVariable) {
        let ImportedVariable {
            exporter,
            owner,
            name,
        } = imported;
        let Some(&id) = exports.ids.get(&(owner, name)) else {
            return;
        };
        if exports.is_import_bound_to_variable(owner, name) {
            return;
        }
        self.add_copy(exporter, owner, id);
        // The run time fills the copies of a face from the object of the file behind it.
        if is_only_known_to_run(exports, owner, name) {
            let capturing = match owner {
                ModuleRef::File(owner) => owner,
                _ => exporter,
            };
            self.faces.entry(capturing).or_default().captures = true;
        }
    }

    fn export_of(
        &mut self,
        exports: &CommonJsExports,
        file: FileId,
        name: Atom,
    ) -> Option<ModuleExport> {
        let module = ModuleRef::File(file);
        let target = exports.targets.get(&(module, name)).copied();
        let binding = match target.unwrap_or(Target::Name(module, name)) {
            Target::Binding(symbol) => ExportBinding::Variable(symbol),
            Target::Nothing => return None,
            Target::Name(owner, owner_name) => {
                let id = *exports.ids.get(&(owner, owner_name))?;
                if !exports.is_import_bound_to_variable(owner, owner_name) {
                    self.add_copy(file, owner, id);
                }
                ExportBinding::Synthetic(id)
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

    fn add_seen_namespace(&mut self, exports: &CommonJsExports, file: FileId) {
        let module = ModuleRef::File(file);
        let is_said_by_text =
            exports.shape(module) == Shape::Names && exports.marker(module).is_some();
        let names = self
            .names_of_namespaces
            .get(&file)
            .filter(|_| is_said_by_text)
            .cloned();
        let Some(names) = names else {
            let face = self.faces.entry(file).or_default();
            face.captures = true;
            face.exports.clear();
            return;
        };
        let table: Vec<ModuleExport> = names
            .into_iter()
            .filter_map(|name| self.export_of(exports, file, name))
            .collect();
        self.faces.entry(file).or_default().exports = table;
    }

    fn decide_checks(&mut self, exports: &CommonJsExports) {
        let id_of = |absent: &AbsentName| {
            let exporter = ModuleRef::File(absent.imported.exporter);
            let owner = exports.owner_of(exporter, absent.imported.name)?;
            Some((*exports.ids.get(&owner)?, absent.failure))
        };
        for (root, importers) in &self.linked_importers {
            let mut copies = Vec::new();
            for &importer in importers {
                let names = &self.absent_names;
                let start = names.partition_point(|absent| absent.imported.importer < importer);
                let of_importer = names[start..]
                    .iter()
                    .take_while(|absent| absent.imported.importer == importer);
                copies.extend(of_importer.filter_map(id_of));
            }
            if !copies.is_empty() {
                self.checks.insert(*root, copies);
            }
        }
    }

    /// Which files have a face, what it copies, and which graphs of imports have a check.
    pub(super) fn decide(&mut self, exports: &CommonJsExports) {
        let written = self.written_imports.iter().filter_map(|imported| {
            let (owner, name) =
                exports.owner_of(ModuleRef::File(imported.exporter), imported.name)?;
            Some(ImportedVariable {
                exporter: imported.exporter,
                owner,
                name,
            })
        });
        self.imported_variables.extend(written);
        for position in 0..self.imported_variables.len() {
            let imported = self.imported_variables[position];
            self.imports_by_owner
                .entry(imported.owner)
                .or_default()
                .push(position as u32);
            self.add_imported_variable(exports, imported);
        }
        for position in 0..self.seen_namespaces.len() {
            self.add_seen_namespace(exports, self.seen_namespaces[position]);
        }
        self.decide_checks(exports);
        self.is_decided = true;
    }

    /// The module has lost its names, so no import is bound to a variable of it any more.
    pub(super) fn decide_behind(&mut self, exports: &CommonJsExports, module: ModuleRef) {
        if !self.is_decided {
            return;
        }
        let positions = self
            .imports_by_owner
            .get(&module)
            .cloned()
            .unwrap_or_default();
        for position in positions {
            self.add_imported_variable(exports, self.imported_variables[position as usize]);
        }
        if let ModuleRef::File(file) = module
            && self.seen_namespaces.binary_search(&file).is_ok()
        {
            self.add_seen_namespace(exports, file);
        }
    }
}

// The text of the file does not say whether the object has the name when the face runs.
fn is_only_known_to_run(exports: &CommonJsExports, owner: ModuleRef, name: Atom) -> bool {
    let Some(text) = exports.text_of(owner) else {
        return false;
    };
    let has_object_only = exports.shape(owner) == Shape::Value && !exports.has_names(owner);
    has_object_only
        && (text.form != Form::Names
            // The face may run while the body of the file does.
            || text.is_half
            || match name == known::default {
                true => exports.marker(owner) != Some(false) && !exports.has_default_of_its_own(owner),
                false => !text.always_creates(name),
            })
}
