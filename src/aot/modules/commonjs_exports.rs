//! What the CommonJS modules of the program export.

mod faces;
mod own_text;
mod text;
#[cfg(test)]
mod tests;

use self::faces::collect_members_of_namespaces;
pub(super) use self::faces::collect_seen_namespaces;

use self::faces::Faces;
use self::own_text::{AliasTarget, Form, InnerBody, Marker, OwnText, ScanInput, scan_own_text};
use self::text::Text;
use super::bindings::{ModuleExport, SyntheticExportId};
use super::exports::{ExportTables, Resolution};
use super::failures::ModuleFailureId;
use super::imports::{FileImports, PendingBinding};
use super::interop::ModuleKind;
use super::module_set::ModuleSet;
use super::plan::{Member, Shape};
use super::requests::Scans;
use super::synthetic_exports::SyntheticExports;
use super::{BindInput, ModuleRef, find_library_files};
use crate::ir::for_each_mut;
use crate::load::SourceKind;
use crate::load::sources::parsed_source;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Parent, SymbolId};
use bun_sema::hir::{ExprId, FnId, StmtId};
use bun_sema::program::{FileId, Sym};
use bun_sema::util::FxHashMap;

/// The callback of `__commonJS(cb)` that is a module of its own, and the name that holds what the helper gives.
#[derive(Copy, Clone, Debug)]
pub(super) struct InnerCommonJs {
    pub holder: SymbolId,
    pub callback: FnId,
}

pub(super) struct CommonJsInput<'a, 'b, 's> {
    pub bind: &'a BindInput<'b, 's>,
    pub scans: &'a Scans,
    pub modules: &'a ModuleSet,
    pub inner_modules: &'a (dyn Fn(FileId) -> &'a [InnerCommonJs] + Sync),
    /// Somebody may look at the module while its body runs.
    pub half: &'a (dyn Fn(ModuleRef) -> bool + Sync),
    /// An ES module that something other than an import starts. Only such a module has a check.
    pub is_prefix_root: &'a (dyn Fn(FileId) -> bool + Sync),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum StoredValue {
    Undefined,
    /// A function that does not look at its `this`, or nothing that can be called.
    IgnoresThis,
    Unknown,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum AccessKind {
    Read,
    Store(StoredValue),
    /// `op=`, `++`, `--`: a read and a store of a number, a string or a big integer.
    Update,
    /// `||=`, `&&=`, `??=`: a read, and a store on some runs.
    Choice(StoredValue),
    /// The object would be `this`.
    Call,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct Access {
    pub node: ExprId,
    pub name: Atom,
    pub kind: AccessKind,
}

/// A name of a CommonJS module as the export tables take it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum OwnName {
    /// The module has a variable for it.
    Stored,
    Member { module: ModuleRef, name: Atom },
    Binding(Sym),
}

#[derive(Copy, Clone, Debug)]
pub(super) struct NameEntry {
    pub name: Atom,
    pub kind: OwnName,
    /// Where the body has created it for sure. `u32::MAX`: some run of the body may end without it.
    pub created_at: u32,
    pub is_enumerable: bool,
}

/// What the export tables read of a module.
pub(super) struct ModuleEntries {
    pub module: ModuleRef,
    pub has_names: bool,
    pub knows_all_names: bool,
    /// Somebody may look at the module while its body runs.
    pub is_half: bool,
    pub names: Vec<NameEntry>,
}

/// A name that an ES module imports of a CommonJS file.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct CommonJsImport {
    pub importer: FileId,
    /// The file that the import names.
    pub exporter: FileId,
    pub name: Atom,
}

/// What the text of each CommonJS module of the program says of its exports.
pub(super) struct CommonJsTexts {
    modules: Vec<OwnText>,
    index: FxHashMap<ModuleRef, u32>,
}

fn file_of(module: ModuleRef) -> Option<FileId> {
    match module {
        ModuleRef::File(file) | ModuleRef::Inner { file, .. } => Some(file),
        ModuleRef::Face(_) | ModuleRef::Check(_) | ModuleRef::Runtime(_) | ModuleRef::External { .. } => None,
    }
}

pub(super) fn scan_commonjs_modules(input: &CommonJsInput<'_, '_, '_>) -> CommonJsTexts {
    let CommonJsInput {
        bind,
        scans,
        modules,
        inner_modules,
        half,
        ..
    } = *input;
    let (files, sources, builtin_names) = (bind.files, bind.sources, bind.builtin_names);
    let is_library = find_library_files(bind);
    let mut is_entry_point = vec![false; files.modules.len()];
    for entry_point in sources.entry_points() {
        is_entry_point[entry_point.file.idx()] = true;
    }
    let compiled_files = modules.compiled_files.iter();
    let mut scanned: Vec<(FileId, Vec<OwnText>)> = compiled_files.map(|&file| (file, Vec::new())).collect();
    for_each_mut(&mut scanned, bind.in_parallel, &|(file, texts)| {
        let file = *file;
        let inner_modules = inner_modules(file);
        let is_file_a_module = modules.interop(ModuleRef::File(file)).kind == ModuleKind::CommonJs
            && sources.kind(file) == SourceKind::Program
            && !is_library[file.idx()];
        if !is_file_a_module && inner_modules.is_empty() {
            return;
        }
        let Some(source) = parsed_source(files, file) else {
            return;
        };
        let inner_bodies = inner_modules.iter().filter_map(|inner| {
            let written = modules.wrapped.of_callback(file, inner.callback)?;
            Some(InnerBody {
                holder: inner.holder,
                callback: inner.callback,
                exports_parameter: written.exports_parameter,
                module_parameter: written.module_parameter,
            })
        });
        let inner_bodies: Vec<InnerBody> = inner_bodies.collect();
        let text = Text::new(files, builtin_names, file, &source.builtins);
        *texts = scan_own_text(&ScanInput {
            text: &text,
            sites: &scans.of(file).sites,
            inner_modules: &inner_bodies,
            is_file_a_module,
            is_entry_point: is_entry_point[file.idx()],
            half,
            certain_helper: &|callee| {
                let known = bind.known_helpers.certain_callee(files, file, callee)?;
                Some(known.shape.helper())
            },
        });
    });
    let modules: Vec<OwnText> = scanned.into_iter().flat_map(|(_, texts)| texts).collect();
    let index = modules.iter().zip(0..).map(|(text, index)| (text.module, index)).collect();
    CommonJsTexts { modules, index }
}

impl CommonJsTexts {
    fn text_of(&self, module: ModuleRef) -> Option<&OwnText> {
        Some(&self.modules[*self.index.get(&module)? as usize])
    }

    /// What `__esModule` reads on the module, as far as its own text says it.
    pub(super) fn marker(&self, module: ModuleRef) -> Option<bool> {
        let text = self.text_of(module)?;
        match (text.form, text.marker) {
            (Form::Names, Marker::Absent) => Some(false),
            (Form::Names, Marker::True { .. }) => Some(true),
            (Form::Names, Marker::Unknown) | (Form::Value, _) => None,
        }
    }

    pub(super) fn entries(&self) -> Vec<ModuleEntries> {
        self.modules.iter().map(create_entries).collect()
    }

    /// The names that the text of a module itself reads, calls or updates.
    pub(super) fn names_read_by_own_text(&self) -> impl Iterator<Item = (ModuleRef, Atom)> + '_ {
        self.modules.iter().flat_map(|text| {
            let accesses = text.accesses.iter().filter(|access| !matches!(access.kind, AccessKind::Store(_)));
            let names = accesses.map(|access| access.name).filter(|_| text.has_names());
            names.map(|name| (text.module, name))
        })
    }
}

fn create_entries(text: &OwnText) -> ModuleEntries {
    let mut names: Vec<NameEntry> = Vec::new();
    for creation in &text.creations {
        let created_at = match creation.is_in_order {
            true => creation.end,
            false => u32::MAX,
        };
        match names.iter_mut().find(|entry| entry.name == creation.name) {
            Some(entry) => entry.created_at = entry.created_at.min(created_at),
            None => names.push(NameEntry {
                name: creation.name,
                kind: OwnName::Stored,
                created_at,
                is_enumerable: creation.is_enumerable,
            }),
        }
    }
    let file = file_of(text.module);
    for alias in &text.aliases {
        let kind = match (alias.target, file) {
            (AliasTarget::Member { module, name }, _) => OwnName::Member { module, name },
            (AliasTarget::Binding(id), Some(file)) => OwnName::Binding(Sym { file, id }),
            (AliasTarget::Binding(_), None) => continue,
        };
        names.push(NameEntry {
            name: alias.name,
            kind,
            created_at: alias.start,
            is_enumerable: alias.is_enumerable,
        });
    }
    names.sort_by_key(|entry| entry.created_at);
    ModuleEntries {
        module: text.module,
        has_names: text.form == Form::Names,
        knows_all_names: text.knows_all_names(),
        is_half: text.is_half,
        names,
    }
}

#[derive(Copy, Clone, Debug)]
struct OwnAccess {
    module: u32,
    name: Atom,
    is_store_only: bool,
    says_marker: bool,
}

#[derive(Default)]
struct FileTable {
    /// The member accesses on the exports of the modules that are written in the file, and the calls that are one store.
    accesses: Vec<(ExprId, OwnAccess)>,
    /// With the module that has to keep its names.
    erased: Vec<(StmtId, u32)>,
    exported_bindings: Vec<SymbolId>,
}

impl FileTable {
    fn sort(&mut self) {
        self.accesses.sort_unstable_by_key(|entry| entry.0);
        self.erased.sort_unstable();
        self.exported_bindings.sort_unstable();
        self.exported_bindings.dedup();
    }
}

/// What a name comes to that has no variable in its own module.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Target {
    Name(ModuleRef, Atom),
    Binding(Sym),
    Nothing,
}

#[derive(Default)]
pub struct CommonJsExports {
    modules: Vec<OwnText>,
    index: FxHashMap<ModuleRef, u32>,
    files: Vec<FileTable>,
    /// By module: somebody looks at its object, or a name of it leads to something that has no variable.
    has_object: Vec<bool>,
    /// By module: those with a name that stands for a name of it.
    dependents: FxHashMap<ModuleRef, Vec<ModuleRef>>,
    /// By module: those that a name of it stands for a name of.
    name_sources: Vec<Vec<ModuleRef>>,
    ids: FxHashMap<(ModuleRef, Atom), SyntheticExportId>,
    /// By number: the module that has the variable, and the name. Of CommonJS modules of the program alone.
    names_by_id: FxHashMap<SyntheticExportId, (ModuleRef, Atom)>,
    targets: FxHashMap<(ModuleRef, Atom), Target>,
    /// The names that other files store, and whether all that they store ignores `this`.
    stored_by_other_files: FxHashMap<(ModuleRef, Atom), bool>,
    faces: Faces,
}

fn find<K: Copy + Ord, V: Copy>(entries: &[(K, V)], key: K) -> Option<V> {
    let at = entries.binary_search_by_key(&key, |entry| entry.0).ok()?;
    Some(entries[at].1)
}

fn leans_on(text: &OwnText) -> impl Iterator<Item = ModuleRef> + '_ {
    text.aliases.iter().filter_map(|alias| match alias.target {
        AliasTarget::Member { module, .. } => Some(module),
        AliasTarget::Binding(_) => None,
    })
}

impl CommonJsExports {
    /// Called once the files are bound and the names have their numbers.
    pub(super) fn finish(
        input: &CommonJsInput<'_, '_, '_>,
        texts: CommonJsTexts,
        tables: &ExportTables,
        imports: &[FileImports],
        synthetic: &SyntheticExports,
    ) -> CommonJsExports {
        let CommonJsTexts { modules, index } = texts;
        let mut exports = CommonJsExports {
            has_object: vec![false; modules.len()],
            index,
            ..CommonJsExports::default()
        };
        exports.files.resize_with(input.bind.files.modules.len(), FileTable::default);
        for (id, export) in synthetic.iter() {
            if exports.index.contains_key(&export.module) {
                exports.ids.insert((export.module, export.name), id);
                exports.names_by_id.insert(id, (export.module, export.name));
            }
        }
        for (text, number) in modules.iter().zip(0..) {
            exports.add_module(number, text);
            exports.bind_names_of_module(input.modules, tables, text);
        }
        exports.modules = modules;
        exports.files.iter_mut().for_each(FileTable::sort);
        for &module in tables.refused_commonjs_modules() {
            exports.look_at(module);
        }
        exports.add_stores_of_other_files(input, imports);
        exports.look_at_modules_that_call_through_their_object();
        exports.look_at_modules_whose_object_importers_see(input, tables, imports);
        let mut faces = Faces::new(input, tables, imports);
        faces.decide(&exports);
        exports.faces = faces;
        exports
    }

    fn add_module(&mut self, module: u32, text: &OwnText) {
        let mut sources: Vec<ModuleRef> = Vec::new();
        for source in leans_on(text) {
            if !sources.contains(&source) {
                sources.push(source);
                self.dependents.entry(source).or_default().push(text.module);
            }
        }
        self.name_sources.push(sources);
        let Some(file) = file_of(text.module) else {
            return;
        };
        let table = &mut self.files[file.idx()];
        for access in &text.accesses {
            let entry = OwnAccess {
                module,
                name: access.name,
                is_store_only: matches!(access.kind, AccessKind::Store(_)),
                says_marker: false,
            };
            table.accesses.push((access.node, entry));
        }
        for &(call, name) in &text.defined_values {
            let entry = OwnAccess {
                module,
                name,
                is_store_only: true,
                says_marker: false,
            };
            table.accesses.push((call, entry));
        }
        for &node in &text.marker_nodes {
            let entry = OwnAccess {
                module,
                name: known::__esModule,
                is_store_only: true,
                says_marker: true,
            };
            table.accesses.push((node, entry));
        }
        table.erased.extend(text.erased.iter().map(|&statement| (statement, module)));
        table.exported_bindings.extend(text.aliases.iter().filter_map(|alias| match alias.target {
            AliasTarget::Binding(symbol) => Some(symbol),
            AliasTarget::Member { .. } => None,
        }));
    }

    fn bind_names_of_module(
        &mut self,
        modules: &ModuleSet,
        tables: &ExportTables,
        text: &OwnText,
    ) {
        let module = text.module;
        let target_of = |module: ModuleRef, name: Atom| match tables.resolve_in(modules, module, name).resolution {
            Resolution::Synthetic { module, name } => Target::Name(module, name),
            Resolution::Variable(symbol) => Target::Binding(symbol),
            _ => Target::Nothing,
        };
        for alias in &text.aliases {
            let target = target_of(module, alias.name);
            if target != Target::Name(module, alias.name) {
                self.targets.insert((module, alias.name), target);
            }
        }
    }

    // `R.N = v` in another file. The name is no longer stored by its own body alone, and what is stored may look at `this`.
    fn add_stores_of_other_files(&mut self, input: &CommonJsInput<'_, '_, '_>, imports: &[FileImports]) {
        let files = input.bind.files;
        let mut looked_at = Vec::new();
        for (&file, file_imports) in input.modules.compiled_files.iter().zip(imports) {
            let (hir, bound) = (files.hir(file), files.bound(file));
            let mut text = None;
            let members = file_imports.members.iter().zip(&file_imports.accessed);
            for (&(member, binding), &(_, accessed)) in members {
                let PendingBinding::Synthetic { module, name } = binding else {
                    continue;
                };
                if !self.index.contains_key(&module) {
                    continue;
                }
                let mut outermost = member;
                while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
                    && hir.type_assertion_operand(parent) == Some(outermost)
                {
                    outermost = parent;
                }
                if bound.get_assignment_target(hir, outermost).is_none() {
                    continue;
                }
                // A getter takes no store.
                if accessed.module != module {
                    looked_at.push(accessed.module);
                }
                // Nor does a definition that is not writable: the object refuses the store, or throws.
                let own_text = &self.modules[self.index[&module] as usize];
                if own_text.creations.iter().any(|creation| creation.name == name && creation.is_read_only) {
                    looked_at.push(module);
                }
                if text.is_none() {
                    let source = parsed_source(files, file);
                    text = source.map(|source| Text::new(files, input.bind.builtin_names, file, &source.builtins));
                }
                let stored = text.as_ref().and_then(|text| {
                    let (_, value) = text.find_assignment(member)?;
                    Some(text.classify_value(value))
                });
                let ignores_this = stored.is_some_and(|stored| stored != StoredValue::Unknown);
                *self.stored_by_other_files.entry((module, name)).or_insert(true) &= ignores_this;
            }
        }
        for module in looked_at {
            self.look_at(module);
        }
    }

    // `exports.f()` hands the object over as `this`.
    fn look_at_modules_that_call_through_their_object(&mut self) {
        let hands_object_over = |text: &&OwnText| {
            let mut calls = text.accesses.iter().filter(|access| access.kind == AccessKind::Call);
            text.form == Form::Names && calls.any(|call| !self.ignores_this(text.module, call.name))
        };
        let modules: Vec<ModuleRef> =
            self.modules.iter().filter(hands_object_over).map(|text| text.module).collect();
        for module in modules {
            self.look_at(module);
        }
    }

    pub(super) fn has_default_of_its_own(&self, module: ModuleRef) -> bool {
        let text = self.text_of(module);
        self.marker(module) == Some(true) && text.is_some_and(|text| text.always_creates(known::default))
    }

    // An ES module gets the object itself as `default`, unless the module has the marker and a `default` of its own.
    fn look_at_modules_whose_object_importers_see(
        &mut self,
        input: &CommonJsInput<'_, '_, '_>,
        tables: &ExportTables,
        imports: &[FileImports],
    ) {
        let written = tables.commonjs_imports().iter();
        let defaults = written.filter(|imported| imported.name == known::default);
        let mut modules: Vec<ModuleRef> = defaults
            .map(|imported| ModuleRef::File(imported.exporter))
            .filter(|&module| self.marker(module) != Some(false) && !self.has_default_of_its_own(module))
            .collect();
        // Only an import statement that names the file itself reads `module.exports` in place of the copy.
        let exported = tables.modules_whose_default_is_exported();
        modules.extend(exported.filter(|&module| !self.has_default_of_its_own(module)));
        // `ns.default` is the object itself unless the module has a `default` of its own.
        let members = collect_members_of_namespaces(input.modules, imports).into_iter();
        let defaults = members.filter(|member| member.name == known::default);
        modules.extend(defaults.map(|member| ModuleRef::File(member.exporter)).filter(|&module| !self.has_default_of_its_own(module)));
        let seen = collect_seen_namespaces(input.modules, tables, imports).into_iter();
        modules.extend(seen.map(ModuleRef::File).filter(|&module| !self.has_default_of_its_own(module)));
        // Whether the module has a name by the time the copy is taken: a variable cannot say that it is absent, the object can.
        for &(imported, _) in tables.absent_commonjs_names() {
            let exporter = ModuleRef::File(imported.exporter);
            modules.push(self.owner_of(exporter, imported.name).map_or(exporter, |owner| owner.0));
        }
        for module in modules {
            self.look_at(module);
        }
    }

    fn number_of(&self, module: ModuleRef) -> Option<usize> {
        self.index.get(&module).map(|&number| number as usize)
    }

    fn text_of(&self, module: ModuleRef) -> Option<&OwnText> {
        Some(&self.modules[self.number_of(module)?])
    }

    fn table(&self, file: FileId) -> Option<&FileTable> {
        self.files.get(file.idx())
    }

    fn has_object(&self, module: ModuleRef) -> bool {
        self.number_of(module).is_some_and(|number| self.has_object[number])
    }

    /// The object of the module is a value somewhere: the module is `Value`, and with it every module whose names stand for names of it.
    pub fn look_at(&mut self, module: ModuleRef) {
        let mut pending = vec![module];
        let mut fallen = Vec::new();
        while let Some(module) = pending.pop() {
            let Some(number) = self.number_of(module) else {
                continue;
            };
            if core::mem::replace(&mut self.has_object[number], true) {
                continue;
            }
            fallen.push(module);
            pending.extend_from_slice(self.dependents(module));
            // With an object of its own the module defines its getters, which read the objects of the others.
            pending.extend_from_slice(self.name_sources(module));
        }
        if fallen.is_empty() {
            return;
        }
        let mut faces = core::mem::take(&mut self.faces);
        for module in fallen {
            faces.decide_behind(self, module);
        }
        self.faces = faces;
    }

    /// `AsToday`: no CommonJS module of the program.
    pub fn shape(&self, module: ModuleRef) -> Shape {
        let Some(text) = self.text_of(module) else {
            return Shape::AsToday;
        };
        match text.form {
            Form::Names if !self.has_object(module) => Shape::Names,
            Form::Names | Form::Value => Shape::Value,
        }
    }

    /// The names of the module are variables: it has no object.
    pub fn has_names(&self, module: ModuleRef) -> bool {
        self.number_of(module).is_some_and(|number| self.keeps_names(number))
    }

    fn keeps_names(&self, number: usize) -> bool {
        let text = &self.modules[number];
        text.has_names() && !self.has_object[number]
    }

    /// The expression that makes the module keep its object, by its own text. No expression: the file as a whole.
    pub fn reason_for_value(&self, module: ModuleRef) -> Option<ExprId> {
        self.text_of(module)?.reason
    }

    /// The modules with a name that stands for a name of the module.
    pub fn dependents(&self, module: ModuleRef) -> &[ModuleRef] {
        self.dependents.get(&module).map_or(&[], |dependents| &dependents[..])
    }

    /// The modules that a name of the module stands for a name of.
    pub fn name_sources(&self, module: ModuleRef) -> &[ModuleRef] {
        self.number_of(module).map_or(&[], |number| &self.name_sources[number][..])
    }

    // The module that has the variable of a name, and the name that it has there.
    fn owner_of(&self, module: ModuleRef, name: Atom) -> Option<(ModuleRef, Atom)> {
        self.text_of(module)?;
        match self.targets.get(&(module, name)) {
            Some(&Target::Name(owner, owner_name)) => Some((owner, owner_name)),
            Some(Target::Binding(_) | Target::Nothing) => None,
            None => Some((module, name)),
        }
    }

    /// What the module has under a name, for whoever required it.
    pub fn member_named(&self, module: ModuleRef, name: Atom) -> Option<Member> {
        let number = self.number_of(module)?;
        if !self.keeps_names(number) {
            return Some(Member::OnObject);
        }
        if name == known::__esModule {
            match self.modules[number].marker {
                Marker::Absent if !self.stored_by_other_files.contains_key(&(module, name)) => {
                    return Some(Member::Marker(false));
                }
                Marker::True { .. } => return Some(Member::Marker(true)),
                Marker::Absent | Marker::Unknown => {}
            }
        }
        match self.targets.get(&(module, name)).copied().unwrap_or(Target::Name(module, name)) {
            Target::Name(owner, owner_name) => {
                self.ids.get(&(owner, owner_name)).map(|&id| Member::Variable(id))
            }
            Target::Binding(symbol) => Some(Member::Binding(symbol)),
            Target::Nothing => Some(Member::Undefined),
        }
    }

    /// `access` is a `Dot` or an `Index` on the exports of a module that is written in the file, a call of `Object.defineProperty` that is one store, or what says that the module has an `__esModule`.
    pub fn own_member(&self, file: FileId, access: ExprId) -> Option<Member> {
        let entry = find(&self.table(file)?.accesses, access)?;
        let number = entry.module as usize;
        let text = &self.modules[number];
        if !self.keeps_names(number) {
            return Some(Member::OnObject);
        }
        if entry.says_marker {
            return Some(Member::Marker(true));
        }
        // Nobody sees what is stored under a name that a getter is defined for behind the store.
        if entry.is_store_only && text.alias_of(entry.name).is_some() {
            return Some(Member::Undefined);
        }
        Some(self.member_named(text.module, entry.name).unwrap_or(Member::Undefined))
    }

    /// `R.N`, where the access is bound to a variable.
    pub fn required_member(&self, accessed: ModuleRef, variable: SyntheticExportId) -> Member {
        let Some(number) = self.number_of(accessed) else {
            return Member::OnObject;
        };
        match self.keeps_names(number) && self.names_by_id.contains_key(&variable) {
            true => Member::Variable(variable),
            false => Member::OnObject,
        }
    }

    /// `ns.N` and `import { N }`: what the module had when it was linked.
    pub fn imported_member(&self, _accessed: ModuleRef, variable: SyntheticExportId) -> Member {
        match self.names_by_id.get(&variable) {
            Some(&(owner, name)) if self.is_import_bound_to_variable(owner, name) => Member::Variable(variable),
            _ => Member::Copy(variable),
        }
    }

    // Without the marker `default` is the value of the module.
    fn is_import_bound_to_variable(&self, owner: ModuleRef, name: Atom) -> bool {
        (name != known::default || self.marker(owner) == Some(true)) && self.settled(owner, name)
    }

    /// The statement has no code.
    pub fn erased(&self, file: FileId, statement: StmtId) -> bool {
        let module = self.table(file).and_then(|table| find(&table.erased, statement));
        module.is_some_and(|module| !self.has_object[module as usize])
    }

    /// A binding of the top of a CommonJS file that a name of the module stands for. Other files read it, so it is a variable.
    pub fn is_exported_binding(&self, file: FileId, symbol: SymbolId) -> bool {
        let is_listed = |table: &FileTable| table.exported_bindings.binary_search(&symbol).is_ok();
        self.table(file).is_some_and(is_listed) && self.has_names(ModuleRef::File(file))
    }

    /// Every run of the body stores the name, nothing stores it once the body has ended, and nobody sees the module half evaluated: then what an importer took at the link and what the variable holds cannot be told apart.
    pub fn settled(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(text) = self.text_of(module) else {
            return false;
        };
        text.form == Form::Names
            && !text.is_half
            && !self.has_object(module)
            && !self.stored_by_other_files.contains_key(&(module, name))
            && text.creations_of(name).any(|creation| creation.is_in_order)
            && text.creations_of(name).all(|creation| creation.is_run_by_body_alone)
    }

    /// Every value that is stored under the name, by binding, ignores `this`.
    pub fn ignores_this(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(text) = self.text_of(module) else {
            return false;
        };
        if self.stored_by_other_files.get(&(module, name)) == Some(&false) {
            return false;
        }
        if let Some(alias) = text.alias_of(name)
            && matches!(alias.target, AliasTarget::Binding(_))
        {
            return alias.value != StoredValue::Unknown;
        }
        match self.targets.get(&(module, name)) {
            Some(&Target::Name(owner, owner_name)) => self.ignores_this(owner, owner_name),
            Some(Target::Binding(_)) => false,
            Some(Target::Nothing) => true,
            None => text.creations_of(name).all(|creation| creation.value != StoredValue::Unknown),
        }
    }

    /// What `__esModule` reads on the module. `None`: only the run knows.
    pub fn marker(&self, module: ModuleRef) -> Option<bool> {
        let text = self.text_of(module)?;
        if text.form != Form::Names || self.stored_by_other_files.contains_key(&(module, known::__esModule)) {
            return None;
        }
        match text.marker {
            Marker::Absent => Some(false),
            Marker::True { .. } => Some(true),
            Marker::Unknown => None,
        }
    }

    /// The text stores to one of the five names, names `arguments` at the top, or shows its scope to `eval` or `with`: the body only calls the function of five parameters that the text is.
    pub fn needs_wrapped_body(&self, module: ModuleRef) -> bool {
        self.text_of(module).is_some_and(|text| text.needs_wrapped_body)
    }

    /// `module` goes somewhere as a value.
    pub fn uses_module_object(&self, module: ModuleRef) -> bool {
        self.text_of(module).is_some_and(|text| text.uses_module_object)
    }

    /// What ES modules request in place of the file. `None`: they request the file itself.
    pub fn face(&self, module: ModuleRef) -> Option<ModuleRef> {
        match module {
            ModuleRef::File(file) if self.faces.has_face(file) => Some(ModuleRef::Face(file)),
            _ => None,
        }
    }

    /// The module that throws for the first name that the graph of imports below `root` imports and no CommonJS module has.
    pub fn check(&self, root: FileId) -> Option<ModuleRef> {
        (!self.faces.checked_copies(root).is_empty()).then_some(ModuleRef::Check(root))
    }

    /// The names whose copies the body of the face takes, behind the evaluation of the file.
    pub fn copies(&self, face: FileId) -> &[SyntheticExportId] {
        self.faces.copies(face)
    }

    /// The export table of the face, in the order of code units, with `default`.
    pub fn exports_of_face(&self, face: FileId) -> &[ModuleExport] {
        self.faces.exports(face)
    }

    /// The text of the file does not say what it exports, so the run time lists the names of the object when the face runs.
    pub fn face_captures(&self, face: FileId) -> bool {
        self.faces.captures(face)
    }

    /// In the order in which the link of the graph gets to them: the copy that may be empty, and what is thrown if it is.
    pub fn checked_copies(&self, check: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        self.faces.checked_copies(check)
    }

    /// The CommonJS files whose namespace object an ES module may look at: `ns` as a value, `import()`, `export *`.
    pub fn seen_namespaces(&self) -> &[FileId] {
        self.faces.seen_namespaces()
    }
}
