#[cfg(test)]
mod tests;

use super::bindings::{AccessedModule, Holder, ImportBinding, RequiredName};
use super::exports::{ExportTables, Resolution};
use super::failures::{ModuleFailureKind, PendingFailure, SitePart, WrittenPart};
use super::interop::{ImportPhase, ModuleKind, SyntheticExportRule};
use super::module_set::ModuleSet;
use super::order::{EvaluationOrder, PlannedSites};
use super::plan::Member;
use super::requests::{FileScan, ScannedSite, Scans, import_phase, phase_towards};
use super::synthetic_exports::SyntheticExports;
use super::{BindInput, DeferredExports, ModuleRef};
use crate::builtins::id::BuiltinId;
use crate::builtins::{
    BuiltinNames, ModuleExport, Mutability, Platforms, RuntimeModule, find_module_export, table,
};
use crate::ir::for_each_mut;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{BindingKind, Bound, Decl, SymFlags, SymbolId};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::hir::{self, ExprId, ImportId};
use bun_sema::import_sites::{ImportSiteKind, JsxImport};
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

#[derive(Default)]
pub(super) struct FileImports {
    pub bindings: Vec<(SymbolId, PendingBinding)>,
    /// Reads, stores and callees.
    pub members: Vec<(ExprId, PendingBinding)>,
    /// For each of `members`, in the same order.
    pub accessed: Vec<(ExprId, AccessedModule)>,
    /// Accesses that have no variable: a name that an ES module lacks, and `__esModule`.
    pub fixed_members: Vec<(ExprId, (ModuleRef, Member))>,
    pub named_members: Vec<((ModuleRef, Atom), NamedMember)>,
    /// The module that the access is written on, the module that has the variable, and its name there.
    pub called_members: Vec<(ModuleRef, ModuleRef, Atom)>,
    pub jsx: Vec<(JsxImport, PendingBinding)>,
    /// For each of `jsx`, in the same order: the module that the import names.
    pub jsx_exporters: Vec<Option<ModuleRef>>,
    pub namespace_values: Vec<ModuleRef>,
    /// The CommonJS modules whose `module.exports` something in the file looks at.
    pub exports_values: Vec<ModuleRef>,
    pub holders: Vec<Holder>,
    /// The calls of `require` of which only this counts: the module has run. `true`: whatever becomes of the names of the module.
    pub unread_sites: Vec<(ExprId, bool)>,
    pub required_names: Vec<RequiredName>,
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
) -> Vec<FileImports> {
    let context = BindContext {
        files: input.files,
        builtin_names: input.builtin_names,
        deferred_exports: input.deferred_exports,
        platform: input.platform,
        scans,
        modules,
        tables,
        order,
        sites,
        marker,
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
    let has_value_meaning = || may_name_value(files, Sym { file, id: symbol });
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
    deferred_exports: &'a DeferredExports,
    platform: Platforms,
    scans: &'a Scans,
    pub(super) modules: &'a ModuleSet,
    tables: &'a ExportTables,
    pub(super) order: &'a EvaluationOrder,
    pub(super) sites: &'a PlannedSites,
    pub(super) marker: FindMarker<'a>,
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
    pub(super) required_name_set: FxHashSet<RequiredName>,
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
        }
    }

    fn bind_file(mut self) -> FileImports {
        for id in (0..self.hir.imports.len() as u32).map(ImportId) {
            for (declaration, item) in imported_items(self.context.files, self.hir, id) {
                self.bind_symbol(declaration, id, item);
            }
        }
        self.bind_jsx_imports();
        self.bind_namespace_members();
        self.add_required_export_names();
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
            Some(site) => self.bind_item(site, item),
            None => UNUSED,
        };
        self.imports.bindings.push((symbol, binding));
    }

    fn bind_item(&mut self, site: usize, item: ImportedItem) -> PendingBinding {
        let scan = self.scan;
        match (&scan.sites[site], item) {
            (&ScannedSite::Module(module), ImportedItem::Namespace(phase)) => {
                let phase = phase_towards(self.context.modules.interop(module).kind, phase);
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

    // The default import of a CommonJS module of the program that has no `__esModule`, or whose package says that it counts for nothing, is `module.exports`.
    fn is_default_whole_exports(&self, exporter: ModuleRef) -> bool {
        let context = self.context;
        let interop = context.modules.interop(exporter);
        interop.kind == ModuleKind::CommonJs
            && context.order.is_code_of_program(exporter)
            && (interop.export_rule == SyntheticExportRule::CommonJsIgnoringAnnotation
                || (context.marker)(exporter) == Some(false))
    }

    pub(super) fn is_exported(&self, symbol: SymbolId) -> bool {
        let (file, id) = (self.file, symbol);
        let variable = Resolution::Variable(Sym { file, id });
        let mut names = self.context.tables.names(self.file).iter();
        names.any(|(_, resolved)| resolved.resolution == variable)
    }

    pub(super) fn resolve_name(
        &self,
        exporter: ModuleRef,
        name: Atom,
    ) -> Result<(PendingBinding, Option<RequiredName>), ModuleFailureKind> {
        let context = self.context;
        let not_found = ModuleFailureKind::ExportNotFound { exporter, name };
        let resolved = context.tables.resolve_in(context.modules, exporter, name);
        let binding = match resolved.resolution {
            Resolution::Variable(symbol) => PendingBinding::Bound(ImportBinding::Variable(symbol)),
            Resolution::Namespace { module, phase } => {
                PendingBinding::Bound(ImportBinding::Namespace { module, phase })
            }
            Resolution::RuntimeMember { module, name } => {
                let (names, platform) = (context.builtin_names, context.platform);
                bind_runtime_member(names, module, name, platform).map_err(|()| not_found)?
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

    fn bind_name(
        &mut self,
        exporter: ModuleRef,
        name: Atom,
        written: WrittenPart,
    ) -> PendingBinding {
        match self.resolve_name(exporter, name) {
            Ok((binding, required_name)) => {
                if let Some(required_name) = required_name {
                    self.add_required_name(required_name);
                }
                binding
            }
            Err(kind) => {
                self.imports.failures.push(written.fail(self.file, kind));
                UNBOUND
            }
        }
    }

    fn add_required_name(&mut self, required_name: RequiredName) {
        if self.required_name_set.insert(required_name) {
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
                ScannedSite::Unresolved => (None, UNBOUND),
                ScannedSite::AllModules | ScannedSite::Candidates(_) | ScannedSite::Erased => {
                    debug_assert!(false, "a JSX import in use has a module or a load failure");
                    (None, UNBOUND)
                }
            };
            self.imports.jsx_exporters.push(exporter);
            self.imports.jsx.push((import, binding));
        }
    }

    fn add_required_export_names(&mut self) {
        // A name that a TypeScript module re-exports may be a type, which no module has at run time.
        let may_be_absent = self.hir.has_typescript_semantics();
        for &(_, resolved) in self.context.tables.own_names(self.file) {
            if let Some(required_name) = resolved.required_name {
                self.add_required_name(RequiredName {
                    may_be_absent,
                    ..required_name
                });
            }
        }
        // The export table names the variable.
        for &(_, resolved) in self.context.tables.names(self.file) {
            if let Some(deferred) = self.find_deferred_export(resolved.resolution) {
                self.add_required_name(deferred);
            }
        }
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
fn is_property_that_a_store_replaces(member: BuiltinId) -> bool {
    let entry = table::entry(member);
    entry.module.is_none() && entry.holder.is_some() && entry.mutability != Mutability::AlwaysLocked
}

fn bind_runtime_member(
    names: &BuiltinNames,
    module: RuntimeModule,
    name: Atom,
    platform: Platforms,
) -> Result<PendingBinding, ()> {
    let binding = match find_module_export(names, module, name, platform) {
        ModuleExport::Found(member)
            if name != known::default && is_property_that_a_store_replaces(member) =>
        {
            let module = ModuleRef::Runtime(module);
            return Ok(PendingBinding::CapturedBuiltin {
                module,
                name,
                member,
            });
        }
        ModuleExport::Found(member) => ImportBinding::Builtin(member),
        ModuleExport::PropertyOfNamespace(holder) => ImportBinding::BuiltinMember { holder, name },
        ModuleExport::Absent => return Err(()),
        ModuleExport::Unknown | ModuleExport::HeldByNamespace => {
            let module = ModuleRef::Runtime(module);
            return Ok(PendingBinding::Synthetic { module, name });
        }
    };
    Ok(PendingBinding::Bound(binding))
}
