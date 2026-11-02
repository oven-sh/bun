#[cfg(test)]
mod tests;

use super::bindings::{
    AccessedModule, AnswerMember, ExportStatement, Holder, ImportBinding, RequiredName,
};
use super::deferred_exports::mirrors_an_object;
use super::evicted::{EvictedModules, LibraryModulesStoredInCache};
use super::exports::{ExportTables, Resolution, ResolvedName};
use super::failures::{ModuleFailureKind, PendingFailure, SitePart, WrittenPart};
use super::interop::{ImportPhase, ModuleKind, SyntheticExportRule};
use super::module_set::ModuleSet;
use super::order::{EvaluationOrder, PlannedSites};
use super::plan::Member;
use super::requests::{FileScan, ScannedSite, Scans, import_phase, phase_towards};
use super::synthetic_exports::{KnownMembers, SyntheticExports};
use super::{BindInput, DeferredExports, ModuleRef, ReplacedModules};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::ExportLookup;
use crate::builtins::{
    BuiltinNames, ModuleExport, Mutability, Platforms, RuntimeModule, find_module_export, table,
};
use crate::ir::for_each_mut;
use crate::known_helpers::KnownHelpers;
use crate::load::replaced_modules::SpiesOnUnknownObjects;
use crate::load::runtime_modules::find_module_named;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{BindingKind, Bound, Decl, SymFlags, SymbolId};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::hir::{self, ExprId, ImportId};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, JsxImport};
use bun_sema::program::{FileId, FileRole, Files, Sym};
use bun_sema::util::{FxHashSet, SharedSort};
use core::ops::Range;

#[derive(Copy, Clone, Debug)]
pub(super) enum PendingBinding {
    Bound(ImportBinding),
    Synthetic {
        module: ModuleRef,
        name: Atom,
    },
    CapturedBuiltin {
        module: ModuleRef,
        name: Atom,
        member: BuiltinId,
    },
}

/// What a name of a module comes to where no expression spells the access: a key of `const { n } = require(K)`.
#[derive(Copy, Clone, Debug)]
pub(super) enum NamedMember<B = PendingBinding> {
    Binding(B),
    Fixed(Member),
}

pub(super) struct PendingJsxImport {
    pub import: JsxImport,
    pub binding: PendingBinding,
    /// The module that the import names.
    pub exporter: Option<ModuleRef>,
}

#[derive(Default)]
pub(super) struct FileImports {
    pub bindings: Vec<(SymbolId, PendingBinding)>,
    /// Reads, stores and callees.
    pub members: Vec<(ExprId, PendingBinding)>,
    /// For each of `members`, in the same order.
    pub accessed: Vec<(ExprId, AccessedModule)>,
    /// Accesses that have no variable: a name that an ES module lacks, and `__esModule`.
    pub fixed_members: Vec<(ExprId, (ModuleRef, Member))>,
    /// The modules that the file stores `__esModule` on.
    pub stored_markers: Vec<ModuleRef>,
    pub named_members: Vec<((ModuleRef, Atom), NamedMember)>,
    /// The module that the access is written on, the module that has the variable, and its name there.
    pub called_members: Vec<(ModuleRef, ModuleRef, Atom)>,
    /// `ns.name()`: the CommonJS module whose namespace `ns` is, and the name.
    pub called_namespace_members: Vec<(ModuleRef, Atom)>,
    pub jsx: Vec<PendingJsxImport>,
    pub namespace_values: Vec<ModuleRef>,
    /// The targets of `import * as`.
    pub imported_namespaces: Vec<ModuleRef>,
    /// The CommonJS modules whose `module.exports` something in the file looks at.
    pub exports_values: Vec<ModuleRef>,
    pub holders: Vec<Holder>,
    /// `a.default` and `a.n`, where `a` holds the copy that a helper makes: `default` may be what `require` answered, and the getter of a name reads the name there.
    pub answer_members: Vec<(ExprId, AnswerMember)>,
    /// The names that hold such a copy and stand in front of the dot of a callee.
    pub copies_called_through: Vec<SymbolId>,
    /// The calls of `require` of which only this counts: the module has run. `true`: whatever becomes of the names of the module.
    pub unread_sites: Vec<(ExprId, bool)>,
    pub required_names: Vec<RequiredName>,
    /// Of the required names that only a mock takes away and that come through `export *`: the files behind the module that a link looks into, with the name.
    pub names_searched_behind_stars: Vec<(FileId, Atom)>,
    /// The variables behind the exports that `spyOn(ns, "name")` names.
    pub replaced_variables: Vec<Sym>,
    /// The same for a name that the loader fills: of a module of the library, or of a CommonJS file.
    pub replaced_names: Vec<(ModuleRef, Atom)>,
    /// The modules whose namespace object goes somewhere as a value.
    pub namespaces_handed_out: Vec<ModuleRef>,
    /// The modules whose namespace object goes to `spyOn` with a name that the build does not know.
    pub namespaces_spied_on_whole: Vec<ModuleRef>,
    /// A spy takes an object that is no namespace and no built-in, which may have come from anywhere.
    pub spies_on_unknown_objects: SpiesOnUnknownObjects,
    /// `import()` or `require` of a path that the build can't know, which answers with the object of any module.
    pub loads_by_unknown_path: bool,
    /// The modules that `mock.module(specifier, ..)` names.
    pub mocked_modules: Vec<ModuleRef>,
    /// `mock.module` is called with a specifier that the build does not know.
    pub mocks_any_module: bool,
    pub failures: Vec<PendingFailure>,
}

/// Whether a CommonJS module has `__esModule`, as far as its text says it.
pub(super) type FindMarker<'a> = &'a (dyn Fn(ModuleRef) -> Option<bool> + Sync);

pub(super) fn bind_imports(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    tables: &ExportTables,
    order: &EvaluationOrder,
    sites: &PlannedSites,
    marker: FindMarker<'_>,
    evicted: &EvictedModules,
    stored_in_cache: &LibraryModulesStoredInCache,
) -> Vec<FileImports> {
    let context = BindContext {
        files: input.files,
        builtin_names: input.builtin_names,
        known_helpers: input.known_helpers,
        deferred_exports: input.deferred_exports,
        known_members: KnownMembers::new(input),
        platform: input.platform,
        unlocked: input.replaced_builtins,
        scans,
        modules,
        tables,
        order,
        sites,
        marker,
        runs_tests: input.runs_tests,
        typescript_drops_absent_exports: input.typescript_drops_absent_exports,
        evicted,
        mocks_any_module: input.mocks_any_module,
        stored_in_cache,
        mocked: find_mocked_modules(input, scans, modules),
    };
    let compiled_files = modules.compiled_files.iter();
    let mut slots: Vec<(FileId, Option<FileImports>)> =
        compiled_files.map(|&file| (file, None)).collect();
    for_each_mut(&mut slots, input.in_parallel, &|(file, imports)| {
        *imports = Some(FileBinder::new(&context, *file).bind_file());
    });
    slots
        .into_iter()
        .map(|(_, imports)| imports.expect("a compiled file was not bound"))
        .collect()
}

/// Whether an alias of a checked file may name a value.
pub(super) fn may_name_value(files: &Files<'_>, alias: Sym) -> bool {
    files.symbol_flags(alias).intersects(SymFlags::VALUE) || files.has_symbol_to_combine(alias)
}

pub(super) fn find_imported_value_site(
    files: &Files<'_>,
    file: FileId,
    scan: &FileScan,
    import: ImportId,
    symbol: SymbolId,
) -> Option<usize> {
    let analysis = files.analysis(file);
    let site = analysis.import_site_index(ImportSiteKind::Import(import))?;
    // A name that code reads is bound, or its module cannot be linked, whatever the name means to the checker.
    let is_read = || (analysis.imports_used_without_a_read.binary_search(&symbol)).is_err();
    let has_value_meaning = || is_read() || may_name_value(files, Sym { file, id: symbol });
    let unused = analysis.unused_import_symbols;
    let is_elided = unused.binary_search(&symbol).is_ok()
        || !files.bound(file).has_runtime_value(symbol)
        || scan.sites[site] == ScannedSite::Erased
        || (files.role(file) == FileRole::Checked && !has_value_meaning());
    (!is_elided).then_some(site)
}

pub(super) fn finish_named_members(
    members: Vec<((ModuleRef, Atom), NamedMember)>,
    synthetic: &SyntheticExports,
) -> Vec<((ModuleRef, Atom), NamedMember<ImportBinding>)> {
    let finish = |member| match member {
        NamedMember::Binding(binding) => NamedMember::Binding(finish_binding(binding, synthetic)),
        NamedMember::Fixed(member) => NamedMember::Fixed(member),
    };
    let members = members.into_iter();
    members.map(|(key, member)| (key, finish(member))).collect()
}

fn finish_binding(binding: PendingBinding, synthetic: &SyntheticExports) -> ImportBinding {
    match binding {
        PendingBinding::Bound(binding) => binding,
        PendingBinding::Synthetic { module, name } => {
            ImportBinding::Synthetic(synthetic.id_of(module, name))
        }
        PendingBinding::CapturedBuiltin {
            module,
            name,
            member,
        } => {
            let export = synthetic.id_of(module, name);
            ImportBinding::CapturedBuiltin { member, export }
        }
    }
}

pub(super) fn finish_bindings<K>(
    bindings: Vec<(K, PendingBinding)>,
    synthetic: &SyntheticExports,
) -> Vec<(K, ImportBinding)> {
    let bindings = bindings.into_iter();
    bindings
        .map(|(key, binding)| (key, finish_binding(binding, synthetic)))
        .collect()
}

const UNUSED: PendingBinding = PendingBinding::Bound(ImportBinding::Unused);
const UNBOUND: PendingBinding = PendingBinding::Bound(ImportBinding::Unbound);

pub(super) struct BindContext<'a, 's> {
    pub(super) files: &'a Files<'s>,
    pub(super) builtin_names: &'a BuiltinNames,
    pub(super) known_helpers: &'a KnownHelpers,
    deferred_exports: &'a DeferredExports,
    known_members: KnownMembers<'a>,
    platform: Platforms,
    /// `LoadOptions::replaced_builtins`
    unlocked: &'a [u32],
    scans: &'a Scans,
    pub(super) modules: &'a ModuleSet,
    tables: &'a ExportTables,
    pub(super) order: &'a EvaluationOrder,
    pub(super) sites: &'a PlannedSites,
    pub(super) marker: FindMarker<'a>,
    pub(super) runs_tests: bool,
    /// `BindInput::typescript_drops_absent_exports`
    typescript_drops_absent_exports: bool,
    pub(super) evicted: &'a EvictedModules,
    pub(super) stored_in_cache: &'a LibraryModulesStoredInCache,
    /// `LoadOptions::mocks_any_module`
    pub(super) mocks_any_module: bool,
    pub(super) mocked: MockedModules,
}

#[derive(Default)]
pub(super) struct MockedModules {
    modules: FxHashSet<ModuleRef>,
    /// `BindInput::mocked_modules`, in every form.
    pub(super) out_of_sight: Vec<ModuleRef>,
    is_every_module: bool,
}

impl MockedModules {
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        self.is_every_module || self.modules.contains(&module)
    }

    fn is_empty(&self) -> bool {
        !self.is_every_module && self.modules.is_empty()
    }
}

// A file is bound without a look at the others, any of which may hold the mock.
fn find_mocked_modules(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> MockedModules {
    let mut mocked = MockedModules {
        is_every_module: input.mocks_any_module,
        ..MockedModules::default()
    };
    let replaced_modules = ReplacedModules::new(input, modules);
    for module in (input.mocked_modules.iter()).filter_map(|module| replaced_modules.find(module)) {
        mocked.out_of_sight.push(module);
        mocked.out_of_sight.extend(modules.forms_of(module));
    }
    mocked.modules.extend(mocked.out_of_sight.iter().copied());
    for &file in &modules.compiled_files {
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scans.of(file).sites) {
            match (site.kind, answer) {
                (ImportSiteKind::MockModule(_), &ScannedSite::Module(module)) => {
                    mocked.modules.insert(module);
                    mocked.modules.extend(modules.forms_of(module));
                }
                (
                    ImportSiteKind::MockModule(_),
                    ScannedSite::AllModules | ScannedSite::Candidates(_),
                ) => mocked.is_every_module = true,
                _ => {}
            }
        }
    }
    mocked
}

pub(super) enum ImportedItem {
    Namespace(ImportPhase),
    Name {
        name: Atom,
        part: SitePart,
        range: Range<u32>,
    },
}

/// What an import statement declares, in the order of its text.
pub(super) fn imported_items(
    files: &Files<'_>,
    hir: &hir::File<'_>,
    id: ImportId,
) -> impl Iterator<Item = (Decl, ImportedItem)> {
    let import = hir[id];
    let default = import.default.is_some().then(|| {
        let start = import.default_pos;
        let item = ImportedItem::Name {
            name: known::default,
            part: SitePart::Name(0),
            range: start..start + files.atoms.bytes(import.default).len() as u32,
        };
        (Decl::ImportDefault(id), item)
    });
    let namespace = import.namespace.is_some().then(|| {
        let item = ImportedItem::Namespace(import_phase(hir, id));
        (Decl::ImportNamespace(id), item)
    });
    let named = (1..).zip(import.named.iter());
    let named = named.map(move |(position, specifier_id)| {
        let specifier = hir[specifier_id];
        let item = ImportedItem::Name {
            name: specifier.imported,
            part: SitePart::Name(position),
            range: specifier.start..specifier.end,
        };
        (Decl::ImportSpec(specifier_id), item)
    });
    default.into_iter().chain(namespace).chain(named)
}

pub(super) struct FileBinder<'a, 's> {
    pub(super) context: &'a BindContext<'a, 's>,
    pub(super) file: FileId,
    pub(super) hir: &'a hir::File<'s>,
    pub(super) bound: &'a Bound<'s>,
    pub(super) analysis: &'a FileAnalysis<'s>,
    pub(super) scan: &'a FileScan,
    pub(super) imports: FileImports,
    pub(super) required_name_set: FxHashSet<(ModuleRef, Atom)>,
    /// What `imports.namespace_values` and `imports.exports_values` hold. A file that loads modules by name looks at all of them.
    pub(super) namespace_value_set: FxHashSet<ModuleRef>,
    pub(super) exports_value_set: FxHashSet<ModuleRef>,
}

impl<'a, 's> FileBinder<'a, 's> {
    fn new(context: &'a BindContext<'a, 's>, file: FileId) -> FileBinder<'a, 's> {
        let hir = context.files.hir(file);
        FileBinder {
            context,
            file,
            hir,
            bound: context.files.bound(file),
            analysis: context.files.analysis(file),
            scan: context.scans.of(file),
            imports: FileImports {
                bindings: Vec::with_capacity(hir.imports.len() + hir.import_specs.len()),
                ..FileImports::default()
            },
            required_name_set: FxHashSet::default(),
            namespace_value_set: FxHashSet::default(),
            exports_value_set: FxHashSet::default(),
        }
    }

    fn bind_file(mut self) -> FileImports {
        // A link looks for the names that the module exports ahead of those that it imports.
        self.add_required_export_names();
        for id in (0..self.hir.imports.len() as u32).map(ImportId) {
            for (declaration, item) in imported_items(self.context.files, self.hir, id) {
                self.bind_symbol(declaration, id, item);
            }
        }
        self.bind_jsx_imports();
        self.bind_namespace_members();
        self.note_what_a_spy_may_reach();
        if self.context.runs_tests {
            self.note_loads_handed_out();
        }
        self.collect_mocked_modules();
        let bindings = &mut self.imports.bindings;
        bindings.shared_sort_by_key(|&(symbol, _)| symbol);
        bindings.dedup_by_key(|&mut (symbol, _)| symbol);
        let members = &mut self.imports.members;
        members.shared_sort_unstable_by_key(|&(member, _)| member);
        self.imports
    }

    fn bind_symbol(&mut self, declaration: Decl, import: ImportId, item: ImportedItem) {
        let symbol = self.bound.declared_symbol(declaration);
        if symbol.is_none() {
            return;
        }
        // An import of a type shares its name with a class, a function or a variable of the file: the name holds what that one declares.
        if self.bound.binding_kind(symbol) > BindingKind::Import {
            return;
        }
        let (files, file, scan) = (self.context.files, self.file, self.scan);
        let binding = match find_imported_value_site(files, file, scan, import, symbol) {
            Some(site) => self.bind_item(site, item, symbol),
            None => UNUSED,
        };
        self.imports.bindings.push((symbol, binding));
    }

    fn bind_item(&mut self, site: usize, item: ImportedItem, symbol: SymbolId) -> PendingBinding {
        let scan = self.scan;
        if let (&ScannedSite::Module(exporter), &ImportedItem::Name { name, .. }) =
            (&scan.sites[site], &item)
            && let Some(binding) = self.bind_copied_member(exporter, name, symbol)
        {
            return PendingBinding::Bound(binding);
        }
        match (&scan.sites[site], item) {
            (&ScannedSite::Module(module), ImportedItem::Namespace(phase)) => {
                let phase = phase_towards(self.context.modules.interop(module).kind, phase);
                if phase == ImportPhase::Evaluation {
                    self.imports.imported_namespaces.push(module);
                }
                PendingBinding::Bound(imported_namespace_binding(module, phase))
            }
            (&ScannedSite::Module(exporter), ImportedItem::Name { name, .. })
                if name == known::default && self.is_default_whole_exports(exporter) =>
            {
                PendingBinding::Bound(ImportBinding::Exports { module: exporter })
            }
            (&ScannedSite::Module(exporter), ImportedItem::Name { name, part, range }) => {
                let kind = self.analysis.import_sites[site].kind;
                let written = WrittenPart::new(site, part, kind, range);
                self.bind_name(exporter, name, written)
            }
            (ScannedSite::Unresolved, _) => UNBOUND,
            (ScannedSite::AllModules | ScannedSite::Candidates(_) | ScannedSite::Erased, _) => {
                debug_assert!(false, "an imported value has a module or a load failure");
                UNUSED
            }
        }
    }

    /// `import b, { a } from "bun"` runs as `var b = Bun, { a } = Bun` where the statement stands. It loads no module, so a mock of "bun" changes none of the names.
    fn bind_copied_member(
        &self,
        exporter: ModuleRef,
        name: Atom,
        symbol: SymbolId,
    ) -> Option<ImportBinding> {
        let ModuleRef::Runtime(module) = exporter else {
            return None;
        };
        let holder = table::canonical_id(table::object_replacing_namespace(module)?);
        let (names, platform) = (self.context.builtin_names, self.context.platform);
        match find_module_export(names, module, name, platform) {
            ModuleExport::Found(member) => {
                let is_copied = name != known::default
                    && (is_property_that_a_store_replaces(member, self.context.unlocked)
                        || self.is_exported(symbol));
                Some(match is_copied {
                    true => ImportBinding::BuiltinMember { holder, name },
                    false => ImportBinding::Builtin(member),
                })
            }
            ModuleExport::PropertyOfNamespace(_) => {
                Some(ImportBinding::BuiltinMember { holder, name })
            }
            ModuleExport::Absent | ModuleExport::Unknown | ModuleExport::HeldByNamespace => None,
        }
    }

    // The default import of a CommonJS module of the program that has no `__esModule`, or whose package says that it counts for nothing, is `module.exports`.
    // The link takes what `module.exports` holds then, which is something else where the body still runs or where a later store replaces it.
    fn is_default_whole_exports(&self, exporter: ModuleRef) -> bool {
        let context = self.context;
        let interop = context.modules.interop(exporter);
        let names = &context.tables.commonjs;
        let is_half_at_link = names.is_half(exporter) && context.order.half_at_link(exporter);
        // A mock replaces `module.exports`, and leaves the default import what it was. So does the next load of a file that was taken out of `require.cache`.
        interop.kind == ModuleKind::CommonJs
            && !context.mocked.contains(exporter)
            && !context.evicted.contains(exporter)
            && context.order.is_code_of_program(exporter)
            && match (context.marker)(exporter) {
                Some(false) => true,
                Some(true) | None => {
                    interop.export_rule == SyntheticExportRule::CommonJsIgnoringAnnotation
                        && !is_half_at_link
                        && !names.is_replaced_late(exporter)
                }
            }
    }

    pub(super) fn is_exported(&self, symbol: SymbolId) -> bool {
        let (file, id) = (self.file, symbol);
        let variable = Resolution::Variable(Sym { file, id });
        let mut names = self.context.tables.names(self.file).iter();
        names.any(|(_, resolved)| resolved.resolution == variable)
    }

    /// What an import of the name is bound to.
    pub(super) fn resolve_name(
        &self,
        exporter: ModuleRef,
        name: Atom,
    ) -> Result<(PendingBinding, Option<RequiredName>), ModuleFailureKind> {
        let context = self.context;
        let resolved = context.tables.resolve_in(context.modules, exporter, name);
        self.bind_resolved_name(exporter, name, resolved)
    }

    /// The namespace object of the module lacks the name, whatever an import statement is bound to.
    pub(super) fn is_hidden_from_namespace(&self, module: ModuleRef, name: Atom) -> bool {
        let context = self.context;
        (context.tables).is_hidden_from_namespace(context.modules, module, name)
    }

    /// What `require(K).name` reads.
    /// Whoever gets `module.exports` of the CommonJS module once its body has run finds the name on it.
    pub(super) fn has_name_once_run(&self, exporter: ModuleRef, name: Atom) -> bool {
        self.context
            .tables
            .commonjs
            .has_name_once_run(exporter, name)
    }

    /// What `require` of the CommonJS module answers is an object on which no trap runs.
    pub(super) fn exports_ordinary_object(&self, exporter: ModuleRef) -> bool {
        let names = &self.context.tables.commonjs;
        names.exports_ordinary_object(exporter)
    }

    /// What `require` of the module of the run time answers has the name from the start.
    pub(super) fn is_member_of_runtime_module(&self, module: RuntimeModule, name: Atom) -> bool {
        let context = self.context;
        let Some(name) = context.builtin_names.get(name) else {
            return false;
        };
        let object = table::canonical_id(table::namespace_of(module));
        match table::find_export(object, name) {
            ExportLookup::Found(member) => {
                member != object
                    && !table::entry(member).is_added_at_first_read
                    && table::exists_on(member, context.platform)
            }
            ExportLookup::Unlisted | ExportLookup::HeldByNamespace => false,
        }
    }

    pub(super) fn resolve_required_name(
        &self,
        exporter: ModuleRef,
        name: Atom,
    ) -> Result<(PendingBinding, Option<RequiredName>), ModuleFailureKind> {
        let context = self.context;
        let resolved = (context.tables).resolve_required(context.modules, exporter, name);
        self.bind_resolved_name(exporter, name, resolved)
    }

    fn bind_resolved_name(
        &self,
        exporter: ModuleRef,
        name: Atom,
        resolved: ResolvedName,
    ) -> Result<(PendingBinding, Option<RequiredName>), ModuleFailureKind> {
        let context = self.context;
        let not_found = ModuleFailureKind::ExportNotFound { exporter, name };
        let binding = match resolved.resolution {
            Resolution::Variable(symbol) => {
                PendingBinding::Bound(match self.find_object_imported_as(symbol) {
                    Some(object) => ImportBinding::Builtin(object),
                    None => ImportBinding::Variable(symbol),
                })
            }
            Resolution::Namespace { module, phase } => {
                PendingBinding::Bound(ImportBinding::Namespace { module, phase })
            }
            Resolution::RuntimeMember { module, name } => {
                let (names, platform) = (context.builtin_names, context.platform);
                let import = if context.mocked.contains(ModuleRef::Runtime(module)) {
                    Import::OfMocked
                } else if exporter == ModuleRef::Runtime(module) {
                    Import::Direct
                } else {
                    Import::ThroughAnotherModule
                };
                bind_runtime_member(names, module, name, platform, import, context.unlocked)
                    .map_err(|()| not_found)?
            }
            Resolution::Synthetic { module, name } => PendingBinding::Synthetic { module, name },
            Resolution::LiveName { module, name } => {
                PendingBinding::Bound(ImportBinding::NamespaceRead { module, name })
            }
            Resolution::DynamicStar { module, name } => {
                let module = ModuleRef::File(module);
                PendingBinding::Bound(ImportBinding::NamespaceRead { module, name })
            }
            Resolution::Unloadable { .. } => UNBOUND,
            Resolution::NotFound => return Err(not_found),
            Resolution::Ambiguous => {
                return Err(ModuleFailureKind::ExportAmbiguous { exporter, name });
            }
        };
        let is_own_name = |module| {
            let mut own_names = context.tables.own_names(module).iter();
            own_names.any(|&(own_name, _)| own_name == name)
        };
        let required_name = match self.find_deferred_export(resolved.resolution) {
            Some(deferred) if is_filled_by_loader(binding) => Some(deferred),
            Some(_) | None => resolved.required_name.map(|resolved_name| match exporter {
                ModuleRef::File(file) if !is_own_name(file) => RequiredName::new(exporter, name),
                _ => resolved_name,
            }),
        };
        Ok((binding, required_name))
    }

    /// `import * as a from "bun"; export { a };`: an importer of `a` names `Bun`.
    fn find_object_imported_as(&self, variable: Sym) -> Option<BuiltinId> {
        let context = self.context;
        let bound = context.files.bound(variable.file);
        if bound.binding_kind(variable.id) != BindingKind::Import {
            return None;
        }
        let hir = context.files.hir(variable.file);
        let mut declarations = bound.symbol(variable.id).decls.iter();
        let import = declarations.find_map(|&declaration| match declaration {
            Decl::ImportDefault(import) | Decl::ImportNamespace(import) => Some(import),
            Decl::ImportSpec(specifier) if hir[specifier].imported == known::default => {
                Some(hir[specifier].import)
            }
            _ => None,
        })?;
        let analysis = context.files.analysis(variable.file);
        let site = analysis.import_site_index(ImportSiteKind::Import(import))?;
        match context.scans.of(variable.file).sites[site] {
            ScannedSite::Module(ModuleRef::Runtime(module)) => {
                table::object_replacing_namespace(module)
            }
            _ => None,
        }
    }

    // The loader fills the variable of such a name when it links a module that says that it binds the name.
    fn find_deferred_export(&self, resolution: Resolution) -> Option<RequiredName> {
        let Resolution::RuntimeMember { module, name } = resolution else {
            return None;
        };
        let context = self.context;
        let name_bytes = context.files.atoms.bytes(name);
        let is_deferred = context.deferred_exports.contains(module, name_bytes);
        is_deferred.then(|| RequiredName::new(ModuleRef::Runtime(module), name))
    }

    // Only the run knows whether a module of the library has a name that its table does not list. The link of each module that binds the name looks for it, and fails alone.
    // A mock that stands in place of the module has its own names alone.
    fn find_unlisted_name(&self, module: ModuleRef, name: Atom) -> Option<RequiredName> {
        let context = self.context;
        if context.modules.interop(module).export_rule != SyntheticExportRule::RuntimeModule {
            return None;
        }
        let is_listed = context.known_members.has(context.modules, module, name);
        (!is_listed || context.mocked.contains(module)).then(|| RequiredName {
            is_found_unless_mocked: is_listed,
            ..RequiredName::new(module, name)
        })
    }

    // A mock that comes before a CommonJS file is loaded stands for the whole file, whatever its text stores: the link of a module that asks for a name that the mock leaves out fails.
    // Without a `default` of its own a file exports its value under that name.
    fn find_name_that_a_mock_of_a_file_may_leave_out(
        &self,
        exporter: ModuleRef,
        name: Atom,
        owner: ModuleRef,
    ) -> Option<RequiredName> {
        let context = self.context;
        let is_file = |module| context.modules.interop(module).kind == ModuleKind::CommonJs;
        let is_mocked_file = |module| is_file(module) && context.mocked.contains(module);
        if name == known::default || !(is_mocked_file(owner) || is_mocked_file(exporter)) {
            return None;
        }
        let is_own_name_of = |file| {
            let mut own_names = context.tables.own_names(file).iter();
            own_names.any(|&(own_name, _)| own_name == name)
        };
        match exporter {
            // The link of the module that hands the name on fails first.
            ModuleRef::File(file) if !is_file(exporter) && is_own_name_of(file) => None,
            // The name comes through `export *`: a link looks behind the stars, as where several of them may have the name.
            _ if !is_file(exporter) => Some(RequiredName::new(exporter, name)),
            _ => Some(RequiredName {
                is_found_unless_mocked: true,
                ..RequiredName::new(exporter, name)
            }),
        }
    }

    // The same for an ES module: the build binds the import to the variable, and the mock leaves the name out. It may come through `export *` from the module that is mocked.
    fn find_name_that_a_mock_of_an_es_module_may_leave_out(
        &mut self,
        exporter: ModuleRef,
        name: Atom,
    ) -> Option<RequiredName> {
        let context = self.context;
        if context.mocked.is_empty() {
            return None;
        }
        let file = context.modules.table_file(exporter)?;
        let searched = context.tables.files_searched_for(file, name);
        let mut files = searched.iter();
        if !files.any(|&file| context.mocked.contains(ModuleRef::File(file))) {
            return None;
        }
        if !self.required_name_set.contains(&(exporter, name)) {
            let behind_stars = searched[1..].iter().map(|&file| (file, name));
            self.imports
                .names_searched_behind_stars
                .extend(behind_stars);
        }
        Some(RequiredName {
            is_found_unless_mocked: true,
            ..RequiredName::new(exporter, name)
        })
    }

    fn find_name_that_an_export_statement_asks_for(
        &self,
        position: usize,
    ) -> Option<(ModuleRef, Atom)> {
        let (site, name) = (self.context.tables).find_indirect_name(self.file, position)?;
        match self.scan.sites[site as usize] {
            ScannedSite::Module(exporter) => Some((exporter, name)),
            _ => None,
        }
    }

    fn find_exported_name_that_a_mock_of_an_es_module_may_leave_out(
        &mut self,
        position: usize,
    ) -> Option<RequiredName> {
        let (exporter, name) = self.find_name_that_an_export_statement_asks_for(position)?;
        self.find_name_that_a_mock_of_an_es_module_may_leave_out(exporter, name)
    }

    fn bind_name(
        &mut self,
        exporter: ModuleRef,
        name: Atom,
        written: WrittenPart,
    ) -> PendingBinding {
        match self.resolve_name(exporter, name) {
            Ok((binding, required_name)) => {
                let unlisted_name = match binding {
                    PendingBinding::Synthetic { module, name } => {
                        self.find_unlisted_name(module, name)
                    }
                    PendingBinding::Bound(_) | PendingBinding::CapturedBuiltin { .. } => None,
                };
                let name_of_file = match binding {
                    PendingBinding::Synthetic { module, .. } => {
                        self.find_name_that_a_mock_of_a_file_may_leave_out(exporter, name, module)
                    }
                    PendingBinding::Bound(_) | PendingBinding::CapturedBuiltin { .. } => None,
                };
                let name_of_es_module =
                    self.find_name_that_a_mock_of_an_es_module_may_leave_out(exporter, name);
                let required_names = [
                    required_name,
                    unlisted_name,
                    name_of_file,
                    name_of_es_module,
                ];
                for required_name in required_names.into_iter().flatten() {
                    self.add_required_name(required_name);
                }
                binding
            }
            // `import { A } from "./a"; export { A }`: the link takes `A` for a type that `./a` no longer has. A read finds `undefined`.
            Err(ModuleFailureKind::ExportNotFound { .. })
                if self.drops_absent_exports()
                    && name != known::default
                    && (self.context.tables).exports_imported_name(
                        self.file,
                        written.order.site,
                        name,
                    ) =>
            {
                UNBOUND
            }
            Err(kind) => {
                self.imports.failures.push(written.fail(self.file, kind));
                UNBOUND
            }
        }
    }

    /// `ExportEntries::drops_absent_exports`
    fn drops_absent_exports(&self) -> bool {
        self.context.typescript_drops_absent_exports && !self.hir.is_js
    }

    fn add_required_name(&mut self, required_name: RequiredName) {
        if (self.required_name_set).insert((required_name.module, required_name.name)) {
            self.imports.required_names.push(required_name);
        }
    }

    fn bind_jsx_imports(&mut self) {
        let (analysis, scan) = (self.analysis, self.scan);
        for import in analysis.jsx_imports.iter() {
            let site_kind = import.site_kind();
            let site = analysis.import_site_index(site_kind);
            let site = site.expect("the loader records the site of every JSX import in use");
            let (exporter, binding) = match &scan.sites[site] {
                &ScannedSite::Module(exporter) => {
                    let name = self.context.files.atoms.intern(import.export_name());
                    let part = SitePart::Name(import as u32);
                    let written = WrittenPart::new(site, part, site_kind, 0..0);
                    (Some(exporter), self.bind_name(exporter, name, written))
                }
                ScannedSite::Unresolved
                | ScannedSite::AllModules
                | ScannedSite::Candidates(_)
                | ScannedSite::Erased => (None, UNBOUND),
            };
            if let Some(exporter) = exporter {
                self.look_at_required_jsx_module(exporter);
            }
            self.imports.jsx.push(PendingJsxImport {
                import,
                binding,
                exporter,
            });
        }
    }

    fn find_export_statement(&self, position: usize, export_name: Atom) -> Option<ExportStatement> {
        let site = self
            .context
            .tables
            .find_indirect_site(self.file, position)? as usize;
        let atoms = &self.context.files.atoms;
        let module_of_bun = match self.scan.sites[site] {
            ScannedSite::Module(ModuleRef::Runtime(module)) => Some(module),
            ScannedSite::Module(ModuleRef::External { specifier, .. }) => {
                find_module_named(atoms.bytes(specifier))
            }
            _ => None,
        };
        let specifier = match (module_of_bun, self.analysis.import_sites[site].specifier) {
            // Bun's transpiler prints "fs" as "node:fs".
            (Some(module), _) => atoms.intern(table::specifier_of(module)),
            (None, ImportSpecifier::Constant(specifier)) => specifier,
            _ => return None,
        };
        Some(ExportStatement {
            export_name,
            specifier,
        })
    }

    fn add_required_export_names(&mut self) {
        let own_names = self.context.tables.own_names(self.file).iter();
        for (position, &(export_name, resolved)) in own_names.enumerate() {
            let name_of_file = match resolved.resolution {
                Resolution::Synthetic {
                    module: owner,
                    name,
                } => {
                    let asked_for = self.find_name_that_an_export_statement_asks_for(position);
                    let (exporter, name) = asked_for.unwrap_or((owner, name));
                    self.find_name_that_a_mock_of_a_file_may_leave_out(exporter, name, owner)
                }
                _ => None,
            };
            let name_of_es_module =
                self.find_exported_name_that_a_mock_of_an_es_module_may_leave_out(position);
            let required_name = resolved.required_name.or(name_of_file);
            for required_name in [required_name, name_of_es_module].into_iter().flatten() {
                self.add_name_required_by_export(position, export_name, required_name);
            }
        }
        // The export table names the variable.
        let names = self.context.tables.names(self.file).iter();
        for (position, &(export_name, resolved)) in names.enumerate() {
            let unlisted_name = match resolved.resolution {
                Resolution::RuntimeMember { module, name } => {
                    self.find_unlisted_name(ModuleRef::Runtime(module), name)
                }
                Resolution::Synthetic { module, name } => self.find_unlisted_name(module, name),
                _ => None,
            };
            let deferred = match resolved.resolution {
                Resolution::RuntimeMember { module, .. } if mirrors_an_object(module) => None,
                resolution => self.find_deferred_export(resolution),
            };
            for required_name in [deferred, unlisted_name].into_iter().flatten() {
                self.add_name_required_by_export(position, export_name, required_name);
            }
        }
    }

    fn add_name_required_by_export(
        &mut self,
        position: usize,
        export_name: Atom,
        required_name: RequiredName,
    ) {
        let asked_by = self.find_export_statement(position, export_name);
        self.add_required_name(RequiredName {
            asked_by,
            drops_export_if_absent: asked_by.is_some()
                && required_name.name != known::default
                && self.drops_absent_exports(),
            ..required_name
        });
    }
}

fn is_filled_by_loader(binding: PendingBinding) -> bool {
    match binding {
        PendingBinding::Synthetic { .. } | PendingBinding::CapturedBuiltin { .. } => true,
        PendingBinding::Bound(_) => false,
    }
}

fn imported_namespace_binding(module: ModuleRef, phase: ImportPhase) -> ImportBinding {
    let replacement = match module {
        ModuleRef::Runtime(runtime_module) => table::object_replacing_namespace(runtime_module),
        _ => None,
    };
    match replacement {
        Some(object) => ImportBinding::Builtin(object),
        None => ImportBinding::Namespace { module, phase },
    }
}

/// A property of the object of a built-in module holds what the module has put there until a store replaces it, whether the body of the module or native code makes the object.
/// `unlocked`: `LoadOptions::replaced_builtins`.
fn is_property_that_a_store_replaces(member: BuiltinId, unlocked: &[u32]) -> bool {
    let entry = table::entry(member);
    let is_locked = entry.mutability == Mutability::AlwaysLocked
        && unlocked.binary_search(&(member as u32)).is_err();
    entry.module.is_none() && entry.holder.is_some() && !is_locked
}

#[derive(Copy, Clone, PartialEq)]
enum Import {
    Direct,
    ThroughAnotherModule,
    /// A mock may stand under any name of the module, so each is read from a variable that the loader fills.
    OfMocked,
}

fn bind_runtime_member(
    names: &BuiltinNames,
    module: RuntimeModule,
    name: Atom,
    platform: Platforms,
    import: Import,
    unlocked: &[u32],
) -> Result<PendingBinding, ()> {
    let binding = match find_module_export(names, module, name, platform) {
        ModuleExport::Absent => return Err(()),
        _ if import == Import::OfMocked => {
            let module = ModuleRef::Runtime(module);
            return Ok(PendingBinding::Synthetic { module, name });
        }
        ModuleExport::Found(member) if is_property_that_a_store_replaces(member, unlocked) => {
            let module = ModuleRef::Runtime(module);
            return Ok(PendingBinding::CapturedBuiltin {
                module,
                name,
                member,
            });
        }
        ModuleExport::Found(member) => ImportBinding::Builtin(member),
        ModuleExport::PropertyOfNamespace(holder) if import == Import::Direct => {
            ImportBinding::BuiltinMember { holder, name }
        }
        ModuleExport::PropertyOfNamespace(_)
        | ModuleExport::Unknown
        | ModuleExport::HeldByNamespace => {
            let module = ModuleRef::Runtime(module);
            return Ok(PendingBinding::Synthetic { module, name });
        }
    };
    Ok(PendingBinding::Bound(binding))
}
