//! What an ES module sees of a CommonJS file: the face that it requests in place of the file, and the check that throws for a name that is missing.

use super::{CommonJsExports, CommonJsImport, CommonJsInput, Target};
use crate::ir::for_each_mut;
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

const NO_FACE: u32 = u32::MAX;

struct Face {
    file: FileId,
    copies: Vec<SyntheticExportId>,
    /// The rank of each of `copies`, ascending.
    ranks: Vec<u32>,
    exports: Vec<ModuleExport>,
    captures: bool,
}

type CheckedCopies = Vec<(SyntheticExportId, ModuleFailureId)>;

/// A name that an ES module imports and that the CommonJS module may end without.
#[derive(Copy, Clone)]
struct AbsentName {
    imported: CommonJsImport,
    /// The place of what is thrown among the failures of the importer.
    order: FailureOrder,
}

/// A copy that may be empty, and what is thrown if it is: a failure of `importer`, which has no number until every failure of the program is known.
#[derive(Copy, Clone)]
struct UnnumberedCheck {
    copy: SyntheticExportId,
    importer: FileId,
    order: FailureOrder,
}

/// A name of a CommonJS module that an ES module is bound to.
#[derive(Copy, Clone)]
struct RequestedName {
    importer: FileId,
    /// The file that shows the name to the importer, whose face takes the copy.
    exporter: FileId,
    /// The module that has the variable, and the name there.
    owner: ModuleRef,
    name: Atom,
}

/// A requested name whose variable has a number.
#[derive(Copy, Clone)]
struct ImportedName {
    exporter: FileId,
    owner: FileId,
    name: Atom,
    copy: SyntheticExportId,
}

struct SeenNamespace {
    file: FileId,
    /// In the order of code units, with `default`. `None`: the text of the file does not say all of them.
    names: Option<Vec<Atom>>,
}

/// What `Faces::decide` reads once.
#[derive(Default)]
struct DecisionInputs {
    /// What import statements and `export { .. } from` name.
    written_imports: Vec<CommonJsImport>,
    /// `ns.name`, and what JSX imports.
    names_read: Vec<RequestedName>,
    /// The CommonJS files that an import statement of an ES module loads.
    imported_files: Vec<FileId>,
    /// By importer, and for each importer in the order in which a link looks for them.
    absent_names: Vec<AbsentName>,
    /// By root: the ES modules that are linked with it and import a name that may be absent, in link order.
    linked_importers: Vec<(FileId, Vec<FileId>)>,
    /// `ExportTables::dropped_commonjs_names`
    dropped_names: Vec<CommonJsImport>,
}

#[derive(Default)]
pub(super) struct Faces {
    inputs: DecisionInputs,
    /// By (importer, site), each pair of exporter and copy once. The place of a name is the rank of its copy.
    imported_names: Vec<ImportedName>,
    /// Sorted: the file that has the variable, and the place in `imported_names`.
    places_by_owner: Vec<(FileId, u32)>,
    /// By file.
    seen_namespaces: Vec<SeenNamespace>,
    /// Sorted. Such a copy, where it is empty after the link, stands for an export that nobody sees.
    copies_that_stay_empty: Vec<SyntheticExportId>,
    /// By file: the place in `faces`, or `NO_FACE`.
    face_of: Vec<u32>,
    faces: Vec<Face>,
    /// By root. `number_checks` takes them.
    unnumbered_checks: Vec<(FileId, Vec<UnnumberedCheck>)>,
    /// By root.
    checks: Vec<(FileId, CheckedCopies)>,
}

/// The CommonJS files whose namespace object something may look at: `ns` as a value, `import()`, `export *`, an exported namespace, a mock.
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

// `ns.name`, where `ns` is the namespace of a CommonJS file or of an ES module that hands its names on, and the names that JSX imports without a statement.
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

// The importer and the imported module of each import between ES modules: by importer, and for each importer in the order of its text.
fn collect_imports_between_es_modules(scans: &Scans, modules: &ModuleSet) -> Vec<(FileId, FileId)> {
    let mut imports = Vec::new();
    for &importer in &modules.compiled_files {
        let Some(scan) = find_es_module(scans, importer) else {
            continue;
        };
        let imported = scan
            .requests
            .iter()
            .filter_map(|request| match request.target {
                ModuleRef::File(target) if find_es_module(scans, target).is_some() => Some(target),
                _ => None,
            });
        imports.extend(imported.map(|imported| (importer, imported)));
    }
    debug_assert!(imports.is_sorted_by_key(|import| import.0));
    imports
}

// By file: the imports lead from it to one of `targets`, or it is one.
fn find_modules_that_lead_to(
    targets: Vec<FileId>,
    imports: &[(FileId, FileId)],
    file_count: usize,
) -> Vec<bool> {
    let importers = imports.iter();
    let mut importers: Vec<(FileId, FileId)> = importers
        .map(|&(importer, imported)| (imported, importer))
        .collect();
    importers.sort_unstable();
    let mut leads_there = vec![false; file_count];
    let mut pending = targets;
    while let Some(file) = pending.pop() {
        if core::mem::replace(&mut leads_there[file.idx()], true) {
            continue;
        }
        let first = importers.partition_point(|entry| entry.0 < file);
        let of_file = importers[first..].iter();
        let of_file = of_file.take_while(|entry| entry.0 == file);
        pending.extend(of_file.map(|entry| entry.1));
    }
    leads_there
}

// A module is linked after everything that it imports. `imports` is sorted by importer.
fn list_importers_in_link_order(
    root: FileId,
    imports: &[(FileId, FileId)],
    is_importer: &[bool],
) -> Vec<FileId> {
    let first_import_of = |file: FileId| imports.partition_point(|import| import.0 < file);
    let mut order = Vec::new();
    let mut is_visited = vec![false; is_importer.len()];
    is_visited[root.idx()] = true;
    let mut path = vec![(root, first_import_of(root))];
    while let Some((file, next)) = path.last_mut() {
        let file = *file;
        match imports.get(*next) {
            Some(&(importer, imported)) if importer == file => {
                *next += 1;
                if !core::mem::replace(&mut is_visited[imported.idx()], true) {
                    path.push((imported, first_import_of(imported)));
                }
            }
            _ => {
                if is_importer[file.idx()] {
                    order.push(file);
                }
                path.pop();
            }
        }
    }
    order
}

impl DecisionInputs {
    fn find_names_to_check(&mut self, input: &CommonJsInput<'_, '_, '_>, tables: &ExportTables) {
        if tables.absent_commonjs_names.is_empty() {
            return;
        }
        let (scans, modules) = (input.scans, input.modules);
        let file_count = input.bind.files.modules.len();
        let absent_names = tables.absent_commonjs_names.iter();
        self.absent_names = absent_names
            .map(|&(imported, order)| AbsentName { imported, order })
            .collect();
        let importers = self.absent_names.iter();
        let importers: Vec<FileId> = importers.map(|absent| absent.imported.importer).collect();
        let mut is_importer = vec![false; file_count];
        for importer in &importers {
            is_importer[importer.idx()] = true;
        }
        let mut links = collect_imports_between_es_modules(scans, modules);
        let leads_to_importer = find_modules_that_lead_to(importers, &links, file_count);
        links.retain(|link| leads_to_importer[link.1.idx()]);
        let roots = modules.compiled_files.iter().copied();
        let roots = roots.filter(|&root| leads_to_importer[root.idx()]);
        let roots = roots.filter(|&root| (input.is_prefix_root)(root));
        self.linked_importers = roots.map(|root| (root, Vec::new())).collect();
        let in_parallel = input.bind.in_parallel;
        for_each_mut(&mut self.linked_importers, in_parallel, &|(
            root,
            linked,
        )| {
            *linked = list_importers_in_link_order(*root, &links, &is_importer);
        });
    }
}

// The text of the file does not say whether an import statement finds the name when the face runs.
fn is_known_only_at_run_time(exports: &CommonJsExports, owner: ModuleRef, name: Atom) -> bool {
    let Some(text) = exports.text_of(owner) else {
        return false;
    };
    !exports.has_names(owner)
        && (!text.has_names
            // The face may run while the body of the file does.
            || text.is_half
            || match name == known::default {
                true => {
                    exports.marker_for_imports(owner) != Some(false)
                        && !exports.has_default_of_its_own(owner)
                }
                false => !text.is_always_found_by_statements(name),
            })
}

impl Faces {
    pub(super) fn new(
        input: &CommonJsInput<'_, '_, '_>,
        tables: &ExportTables,
        imports: &[FileImports],
    ) -> Faces {
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
        let mut inputs = DecisionInputs {
            written_imports: tables.commonjs_imports.clone(),
            names_read: collect_names_read(input, tables, imports),
            imported_files: collect_imported_files(scans, modules),
            dropped_names: tables.dropped_commonjs_names.clone(),
            ..DecisionInputs::default()
        };
        inputs.find_names_to_check(input, tables);
        Faces {
            inputs,
            seen_namespaces: seen_namespaces.collect(),
            face_of: vec![NO_FACE; files.modules.len()],
            ..Faces::default()
        }
    }

    fn find(&self, file: FileId) -> Option<&Face> {
        let place = *self.face_of.get(file.idx())?;
        self.faces.get(place as usize)
    }

    fn ensure_face(&mut self, file: FileId) -> &mut Face {
        let place = &mut self.face_of[file.idx()];
        if *place == NO_FACE {
            *place = self.faces.len() as u32;
            self.faces.push(Face {
                file,
                copies: Vec::new(),
                ranks: Vec::new(),
                exports: Vec::new(),
                captures: false,
            });
        }
        &mut self.faces[*place as usize]
    }

    fn find_seen_namespace(&self, file: FileId) -> Result<usize, usize> {
        let seen = &self.seen_namespaces;
        seen.binary_search_by_key(&file, |namespace| namespace.file)
    }

    // The copies of a face are kept in rank order, whatever the order in which the modules lose their names.
    fn add_copy(&mut self, exporter: FileId, owner: FileId, copy: SyntheticExportId, rank: u32) {
        let face = self.ensure_face(exporter);
        if !face.copies.contains(&copy) {
            let place = face.ranks.partition_point(|&earlier| earlier < rank);
            face.copies.insert(place, copy);
            face.ranks.insert(place, rank);
        }
        // The copy is a variable of the face of the file that has the name.
        self.ensure_face(owner);
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
        // A link binds what the statements of a module name before the body of the module reads anything.
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
        // The run time fills the copies of a face from the object of the file behind it.
        if is_known_only_at_run_time(exports, module, name) {
            self.ensure_face(owner).captures = true;
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
        // A name that only the export table asks for gets a rank above every name that an importer asks for.
        let first_rank = self.imported_names.len() as u32;
        let table = names.as_ref().filter(|_| is_said_by_text).map(|names| {
            let mut table = Vec::with_capacity(names.len());
            for (&name, rank) in names.iter().zip(first_rank..) {
                table.extend(self.export_of(exports, file, name, rank));
            }
            table
        });
        self.seen_namespaces[place].names = names;
        let face = self.ensure_face(file);
        match table {
            Some(table) => face.exports = table,
            None => {
                face.captures = true;
                face.exports.clear();
            }
        }
    }

    // `bun run` copies the exports of an imported CommonJS file into a namespace even if the importer names none of them, and the copy runs their getters.
    // A file whose text only stores to its exports has no getter to run.
    fn add_imported_file(&mut self, exports: &CommonJsExports, file: FileId) {
        let text = exports.text_of(ModuleRef::File(file));
        if text.is_none_or(|text| !text.has_names) {
            self.ensure_face(file).captures = true;
        }
    }

    fn decide_checks(
        &mut self,
        exports: &CommonJsExports,
        absent_names: &[AbsentName],
        linked_importers: Vec<(FileId, Vec<FileId>)>,
        dropped_names: Vec<CommonJsImport>,
    ) {
        let copy_of = |imported: CommonJsImport| {
            let owner = exports.owner_of(ModuleRef::File(imported.exporter), imported.name)?;
            exports.ids.get(&owner).copied()
        };
        for (root, importers) in linked_importers {
            let mut checks = Vec::new();
            for importer in importers {
                let first = absent_names.partition_point(|it| it.imported.importer < importer);
                let rest = absent_names[first..].iter();
                for absent in rest.take_while(|it| it.imported.importer == importer) {
                    if let Some(copy) = copy_of(absent.imported) {
                        checks.push(UnnumberedCheck {
                            copy,
                            importer,
                            order: absent.order,
                        });
                    }
                }
            }
            if !checks.is_empty() {
                self.unnumbered_checks.push((root, checks));
            }
        }
        debug_assert!(self.unnumbered_checks.is_sorted_by(|a, b| a.0 < b.0));
        self.copies_that_stay_empty = dropped_names.into_iter().filter_map(copy_of).collect();
        self.copies_that_stay_empty.sort_unstable();
        self.copies_that_stay_empty.dedup();
    }

    /// Which files have a face, what it copies, and which graphs of imports have a check.
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
        self.decide_checks(
            exports,
            &inputs.absent_names,
            inputs.linked_importers,
            inputs.dropped_names,
        );
    }

    /// Something looks at the namespace object of the file, which has lost its names.
    pub(super) fn see_namespace(&mut self, exports: &CommonJsExports, file: FileId) {
        if let Err(place) = self.find_seen_namespace(file) {
            let namespace = SeenNamespace { file, names: None };
            self.seen_namespaces.insert(place, namespace);
            self.add_seen_namespace(exports, place);
        }
    }

    /// The module has lost its names, so no import is bound to a variable of it any more.
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
    /// What ES modules request in place of the file. `None`: they request the file itself.
    pub fn face(&self, module: ModuleRef) -> Option<ModuleRef> {
        match module {
            ModuleRef::File(file) if self.faces.find(file).is_some() => Some(ModuleRef::Face(file)),
            _ => None,
        }
    }

    /// The module that throws for the first name that the graph of imports below `root` imports and no CommonJS module has.
    #[cfg(test)]
    pub fn check(&self, root: FileId) -> Option<ModuleRef> {
        (!self.checked_copies(root).is_empty()).then_some(ModuleRef::Check(root))
    }

    /// The names whose copies the body of the face takes, after the evaluation of the file. In the order in which the importers ask for them.
    pub fn copies(&self, face: FileId) -> &[SyntheticExportId] {
        let face = self.faces.find(face);
        face.map_or(&[], |face| &face.copies[..])
    }

    /// The export table of the face, in the order of code units, with `default`.
    pub fn exports_of_face(&self, face: FileId) -> &[ModuleExport] {
        let face = self.faces.find(face);
        face.map_or(&[], |face| &face.exports[..])
    }

    pub(in crate::modules) fn limit_exports_of_faces(&mut self, find_use: FindExportUse<'_>) {
        for face in &mut self.faces.faces {
            retain_used_exports(&mut face.exports, face.file, find_use);
        }
    }

    /// The text of the file does not say what it exports, so the run time lists the names of the object when the face runs.
    pub fn face_captures(&self, face: FileId) -> bool {
        let face = self.faces.find(face);
        face.is_some_and(|face| face.captures)
    }

    /// Called once, with the final numbering of the failures. No earlier one will do: an error of the build that is turned into a failure that throws takes a number, and every later number moves up.
    pub(in crate::modules) fn number_checks(&mut self, failures: &NumberedFailures) {
        let number =
            |check: UnnumberedCheck| (check.copy, failures.id_of(check.importer, check.order));
        let unnumbered = core::mem::take(&mut self.faces.unnumbered_checks).into_iter();
        let numbered =
            unnumbered.map(|(root, checks)| (root, checks.into_iter().map(number).collect()));
        self.faces.checks = numbered.collect();
    }

    /// In the order in which the link of the graph gets to them: the copy that may be empty, and what is thrown if it is.
    pub fn checked_copies(&self, check: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        debug_assert!(
            self.faces.unnumbered_checks.is_empty(),
            "the checks have no numbers yet"
        );
        let checks = &self.faces.checks;
        let found = checks.binary_search_by_key(&check, |entry| entry.0);
        found.map_or(&[], |place| &checks[place].1[..])
    }

    /// No link throws for the name alone: a TypeScript module exports it, and is linked without the export where the file lacks the name.
    pub fn may_stay_empty(&self, copy: SyntheticExportId) -> bool {
        let copies = &self.faces.copies_that_stay_empty;
        copies.binary_search(&copy).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::testing::{file_named, with_test_run_graph};

    fn link_order(root: u32, pairs: &[(u32, u32)], importers: &[u32]) -> Vec<u32> {
        const FILE_COUNT: usize = 8;
        let pairs = pairs.iter();
        let mut imports: Vec<(FileId, FileId)> = pairs
            .map(|&(importer, imported)| (FileId(importer), FileId(imported)))
            .collect();
        let importers: Vec<FileId> = importers.iter().map(|&file| FileId(file)).collect();
        let mut is_importer = vec![false; FILE_COUNT];
        for importer in &importers {
            is_importer[importer.idx()] = true;
        }
        let leads_there = find_modules_that_lead_to(importers, &imports, FILE_COUNT);
        imports.retain(|import| leads_there[import.1.idx()]);
        let order = list_importers_in_link_order(FileId(root), &imports, &is_importer);
        order.into_iter().map(|file| file.0).collect()
    }

    #[test]
    fn a_module_is_linked_after_what_it_imports() {
        let pairs = [(0, 1), (0, 2), (1, 3), (2, 3)];
        assert_eq!(link_order(0, &pairs, &[0, 2, 3]), [3, 2, 0]);
        assert_eq!(link_order(2, &pairs, &[0, 2, 3]), [3, 2]);
        assert_eq!(link_order(0, &[(0, 2), (0, 1)], &[1, 2]), [2, 1]);
    }

    #[test]
    fn a_cycle_of_imports_is_walked_once() {
        let pairs = [(0, 1), (1, 2), (2, 0), (2, 3)];
        assert_eq!(link_order(0, &pairs, &[1, 3]), [3, 1]);
        assert_eq!(link_order(2, &pairs, &[1, 3]), [1, 3]);
    }

    #[test]
    fn imports_that_lead_to_no_importer_change_nothing() {
        let pairs = [(0, 1), (0, 2), (1, 4), (2, 3), (5, 4)];
        assert_eq!(link_order(0, &pairs, &[3]), [3]);
        assert!(link_order(5, &pairs, &[3]).is_empty());
    }

    #[test]
    fn copies_are_ordered_by_rank_in_any_insertion_order() {
        let mut faces = Faces {
            face_of: vec![NO_FACE; 3],
            ..Faces::default()
        };
        let [exporter, owner] = [FileId(0), FileId(2)];
        for (copy, rank) in [(7, 5), (3, 2), (7, 9), (4, 3)] {
            faces.add_copy(exporter, owner, SyntheticExportId(copy), rank);
        }
        let face = faces.find(exporter).expect("the exporter has a face");
        assert_eq!(face.copies, [3, 4, 7].map(SyntheticExportId));
        assert!(faces.find(owner).is_some());
        assert!(faces.find(FileId(1)).is_none());
    }

    #[test]
    fn a_check_throws_the_failure_of_its_own_name() {
        // In a test run the name that `fine.mjs` lacks is thrown where the file loads, so it takes the number in front of `nope`.
        let above = "import { absent } from './fine.mjs'; import { nope } from './lib.cjs';\n\
                     console.log(absent, nope);";
        let files = [
            ("main.test.mjs", "import './above.mjs';"),
            ("above.mjs", above),
            ("fine.mjs", "export {};"),
            ("lib.cjs", "exports.a = 1;"),
        ];
        with_test_run_graph(&files, |graph, input| {
            let [root, lib] = ["main.test.mjs", "lib.cjs"].map(|name| file_named(input, name));
            let checked = graph.commonjs().checked_copies(root);
            let [(_, failure)] = checked else {
                panic!("{checked:?}");
            };
            assert_eq!(graph.failures().len(), 2);
            let exporter = graph.failure(*failure).exporter();
            assert_eq!(exporter, Some(ModuleRef::File(lib)));
        });
    }
}
