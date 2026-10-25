//! What ES modules see of a CommonJS file.

use super::{CommonJsExports, CommonJsImport, CommonJsInput, Target};
use crate::ir::parallel::for_each_mut;
use crate::modules::bindings::{ExportBinding, ImportBinding, ModuleExport, SyntheticExportId};
use crate::modules::compare_code_units;
use crate::modules::exports::ExportTables;
use crate::modules::failures::{ModuleFailureId, number_failures};
use crate::modules::imports::{FileImports, PendingBinding};
use crate::modules::interop::ModuleKind;
use crate::modules::module_set::ModuleSet;
use crate::modules::plan::Shape;
use crate::modules::reached_targets::ReachedTargets;
use crate::modules::requests::Scans;
use crate::modules::{ApplicationGraph, ModuleRef, collect_pending_failures};
use bun_sema::atom::{Atom, known};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
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
    let mut seen = tables.commonjs_namespace_loads.clone();
    for file_imports in imports {
        let bindings = file_imports.bindings.iter();
        let namespaces = bindings.filter_map(|&(_, binding)| match binding {
            PendingBinding::Bound(ImportBinding::Namespace { module, .. }) => {
                find_commonjs_file(modules, module)
            }
            _ => None,
        });
        let values = &file_imports.namespace_values;
        let is_value = |file: &FileId| values.contains(&ModuleRef::File(*file));
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
    let mut add = |binding: PendingBinding, exporter: ModuleRef| {
        if let PendingBinding::Synthetic { module, name } = binding
            && let Some(exporter) = find_commonjs_file(modules, exporter)
        {
            variables.push(ImportedVariable {
                exporter,
                owner: module,
                name,
            });
        }
    };
    for file_imports in imports {
        let members = file_imports.members.iter().zip(&file_imports.accessed);
        for (&(_, binding), &(_, accessed)) in members {
            if accessed.is_imported {
                add(binding, accessed.module);
            }
        }
        // What JSX imports without a statement.
        for (&(_, binding), &exporter) in file_imports.jsx.iter().zip(&file_imports.jsx_exporters) {
            if let Some(exporter) = exporter {
                add(binding, exporter);
            }
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
        let Some(scan) = scans.find(file).filter(|_| is_es_module(file)) else {
            continue;
        };
        let requests = scan.requests.iter();
        let imported = requests.filter_map(|request| match request.target {
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
            written_imports: tables.commonjs_imports.clone(),
            imported_variables: collect_members_of_namespaces(modules, imports),
            seen_namespaces: collect_seen_namespaces(modules, tables, imports),
            ..Faces::default()
        };
        if let Some(application) = input.bind.application {
            faces.adopt_imports(application);
        }
        let atoms = &input.bind.files.atoms;
        for &file in &faces.seen_namespaces {
            if let Some(mut names) = tables.commonjs.names_of(ModuleRef::File(file)) {
                names.shared_sort_unstable_by(|&a, &b| {
                    compare_code_units(atoms.bytes(a), atoms.bytes(b))
                });
                faces.names_of_namespaces.insert(file, names);
            }
        }
        if tables.absent_commonjs_names.is_empty() {
            return faces;
        }
        // The numbers that the failures of the program get.
        let pending = collect_pending_failures(scans, modules, tables, imports);
        let failures = number_failures(input.bind.files.modules.len(), pending);
        let absent_names = tables.absent_commonjs_names.iter();
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
        let in_parallel = input.bind.in_parallel;
        for_each_mut(&mut faces.linked_importers, in_parallel, &|(
            root,
            linked,
        )| {
            *linked = list_targets_in_link_order(*root, &es_imports, &importers_below);
        });
        faces.absent_names = absent_names;
        faces
    }

    fn adopt_imports(&mut self, application: &ApplicationGraph<'_>) {
        let theirs = &application.graph.commonjs().faces;
        let to_local = application.to_local;
        self.written_imports.clear();
        let imported_variables = theirs.imported_variables.iter();
        self.imported_variables = imported_variables
            .filter_map(|imported| {
                Some(ImportedVariable {
                    exporter: to_local(imported.exporter)?,
                    owner: application.local_module(imported.owner)?,
                    name: imported.name,
                })
            })
            .collect();
        let seen_namespaces = theirs.seen_namespaces.iter();
        self.seen_namespaces = seen_namespaces.filter_map(|&file| to_local(file)).collect();
        self.seen_namespaces.sort_unstable();
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
        let (exporter, owner, name) = (imported.exporter, imported.owner, imported.name);
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
        let names = self.names_of_namespaces.get(&file);
        let Some(names) = names.filter(|_| is_said_by_text).cloned() else {
            let face = self.faces.entry(file).or_default();
            face.captures = true;
            face.exports.clear();
            return;
        };
        let names = names.into_iter();
        let table = names.filter_map(|name| self.export_of(exports, file, name));
        let table: Vec<ModuleExport> = table.collect();
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
                let rest = names[start..].iter();
                let of_importer = rest.take_while(|absent| absent.imported.importer == importer);
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
            let positions = self.imports_by_owner.entry(imported.owner).or_default();
            positions.push(position as u32);
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
        let positions = self.imports_by_owner.get(&module).cloned();
        for position in positions.unwrap_or_default() {
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
    !exports.has_names(owner)
        && (!text.has_names
            // The face may run while the body of the file does.
            || text.is_half
            || match name == known::default {
                true => exports.marker(owner) != Some(false) && !exports.has_default_of_its_own(owner),
                false => !text.always_creates(name),
            })
}

impl CommonJsExports {
    /// What ES modules request in place of the file. `None`: they request the file itself.
    pub fn face(&self, module: ModuleRef) -> Option<ModuleRef> {
        match module {
            ModuleRef::File(file) if self.faces.faces.contains_key(&file) => {
                Some(ModuleRef::Face(file))
            }
            _ => None,
        }
    }

    /// The module that throws for the first name that the graph of imports below `root` imports and no CommonJS module has.
    pub fn check(&self, root: FileId) -> Option<ModuleRef> {
        (!self.checked_copies(root).is_empty()).then_some(ModuleRef::Check(root))
    }

    /// The names whose copies the body of the face takes, behind the evaluation of the file.
    pub fn copies(&self, face: FileId) -> &[SyntheticExportId] {
        let face = self.faces.faces.get(&face);
        face.map_or(&[], |face| &face.copies[..])
    }

    /// The export table of the face, in the order of code units, with `default`.
    pub fn exports_of_face(&self, face: FileId) -> &[ModuleExport] {
        let face = self.faces.faces.get(&face);
        face.map_or(&[], |face| &face.exports[..])
    }

    /// The text of the file does not say what it exports, so the run time lists the names of the object when the face runs.
    pub fn face_captures(&self, face: FileId) -> bool {
        let face = self.faces.faces.get(&face);
        face.is_some_and(|face| face.captures)
    }

    /// In the order in which the link of the graph gets to them: the copy that may be empty, and what is thrown if it is.
    pub fn checked_copies(&self, check: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        let copies = self.faces.checks.get(&check);
        copies.map_or(&[], |copies| &copies[..])
    }

    /// The CommonJS files whose namespace object an ES module may look at: `ns` as a value, `import()`, `export *`.
    pub fn seen_namespaces(&self) -> &[FileId] {
        &self.faces.seen_namespaces
    }
}
