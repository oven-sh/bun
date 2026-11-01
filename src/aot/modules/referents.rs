#[cfg(test)]
mod named_value_tests;
#[cfg(test)]
mod tests;

use super::ModuleRef;
use super::bindings::{ExportBinding, ExportLookup, ImportBinding, SiteAnswer};
use super::graph::ModuleGraph;
use super::interop::{ImportPhase, RequireResult};
use crate::builtins::table::MemberLookup;
use crate::builtins::{
    BuiltinId, BuiltinNames, Intrinsic, ModuleExport, Platforms, Resolved, RuntimeModule,
    find_module_export, named_value_of, prototype_operation_of, table,
};
use crate::load::Sources;
use crate::load::sources::parsed_source;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, CommonJsVariable, LinkedBinding, LoadedValue, MemberStores,
    NamespaceReferent, ReferentContext, StaticReferent, SymbolId, export_referent,
    index_member_stores, static_referent,
};
use bun_sema::check::aot::{
    ClassDeclaration, FunctionRef, NamedValue, NamedValues, PrototypeOperation,
};
use bun_sema::hir::{BinOp, ExprId, ExprKind, File, MemberKey, StmtKind};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Files};

#[derive(Copy, Clone)]
pub struct LinkedProject<'a, 's> {
    pub files: &'a Files<'s>,
    pub graph: &'a ModuleGraph,
    pub builtin_names: &'a BuiltinNames,
    pub platform: Platforms,
    // `None`: this is the project of Bun's own modules.
    pub library: Option<&'a Library<'a, 's>>,
}

// Bun's own modules, as the application sees them.
pub struct Library<'a, 's> {
    pub project: LinkedProject<'a, 's>,
    pub sources: &'a Sources,
}

type Linked = LinkedBinding<BuiltinId, ModuleRef>;

fn namespace_binding(module: ModuleRef, phase: ImportPhase) -> Linked {
    match phase {
        ImportPhase::Evaluation => LinkedBinding::Namespace(module),
        ImportPhase::Defer => LinkedBinding::Unknown,
    }
}

fn find_module_of_object(object: BuiltinId) -> Option<RuntimeModule> {
    let module = table::entry(object).module?;
    let module_object = table::canonical_id(table::namespace_of(module));
    (module_object == table::canonical_id(object)).then_some(module)
}

/// `module.exports = name` among the statements of a CommonJS file, where it is the only such store there. Later stores and stores in functions are not looked for: whoever asks expects the value and does not rely on it.
pub fn find_name_stored_as_module_exports(files: &Files<'_>, file: FileId) -> Option<SymbolId> {
    let (hir, bound) = (files.hir(file), files.bound(file));
    let mut stored = None;
    for statement in hir.ids(hir.body) {
        let StmtKind::Expr(mut rest) = hir[statement].kind else {
            continue;
        };
        loop {
            let (earlier, last) = match hir[hir.skip_type_assertions(rest)].kind {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    right,
                } => (Some(left), right),
                _ => (None, rest),
            };
            if let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[hir.skip_type_assertions(last)].kind
                && let Some((object, MemberKey::Name(known::exports))) = hir.member_key(target)
                && bound.binding(object) == Binding::CommonJs(CommonJsVariable::Module)
            {
                let Binding::Symbol(symbol) = bound.binding(hir.skip_type_assertions(value)) else {
                    return None;
                };
                if stored.replace(symbol).is_some() {
                    return None;
                }
            }
            match earlier {
                Some(earlier) => rest = earlier,
                None => break,
            }
        }
    }
    stored
}

impl LinkedProject<'_, '_> {
    // `import name from K`: the function that the CommonJS file K stores as its value. A file that Babel wrote stores its value as its own `default` too.
    fn find_function_exported_whole(
        &self,
        file: FileId,
        expression: ExprId,
    ) -> Option<FunctionRef> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let Binding::Symbol(import) = bound.binding(hir.skip_type_assertions(expression)) else {
            return None;
        };
        let module = match self.graph.import_binding(file, import) {
            ImportBinding::Exports { module } => module,
            ImportBinding::Synthetic(export) => {
                let export = self.graph.synthetic_export(export);
                (export.name == known::default).then_some(export.module)?
            }
            _ => return None,
        };
        let ModuleRef::File(module) = module else {
            return None;
        };
        let stored = find_name_stored_as_module_exports(self.files, module)?;
        let (hir, bound) = (self.files.hir(module), self.files.bound(module));
        match bound.binding_initializer(hir, stored) {
            BindingInitializer::Function(function) if bound.is_stable_binding(stored) => {
                Some(FunctionRef {
                    file: module,
                    function,
                })
            }
            _ => None,
        }
    }

    fn find_private_global(&self, file: FileId, reference: ExprId) -> Option<BuiltinId> {
        let ExprKind::Ident(spelling) = self.files.hir(file)[reference].kind else {
            return None;
        };
        let name = self.builtin_names.get_private(spelling)?;
        let global = table::own_member(BuiltinId::PrivateGlobals, name)?;
        table::exists_on(global, self.platform).then_some(global)
    }

    fn runtime_module_export(&self, module: RuntimeModule, name: Atom) -> Linked {
        // Its export table belongs to the project of Bun's own modules.
        if table::is_es_module(module) {
            return LinkedBinding::Unknown;
        }
        match find_module_export(self.builtin_names, module, name, self.platform) {
            ModuleExport::Found(builtin) => LinkedBinding::Builtin(table::canonical_id(builtin)),
            _ => LinkedBinding::Unknown,
        }
    }
}

impl Library<'_, '_> {
    // What the text of the module stores as its value, or as the member `member` of that value.
    fn find_declaration(
        &self,
        module: RuntimeModule,
        member: Option<Atom>,
    ) -> Option<ClassDeclaration> {
        // Its export table has the names. No program extends one of them so far.
        if table::is_es_module(module) {
            return None;
        }
        let file = self.sources.runtime_module_file(module)?;
        match export_referent(&self.project, file, known::default, member).referent {
            StaticReferent::Class(class) => Some(ClassDeclaration::Class(class)),
            StaticReferent::Function(function) => Some(ClassDeclaration::Function(function)),
            _ => None,
        }
    }

    fn find_declaration_of_builtin(
        &self,
        builtin: BuiltinId,
        names: &BuiltinNames,
    ) -> Option<ClassDeclaration> {
        let builtin = table::canonical_id(builtin);
        if let Some(module) = find_module_of_object(builtin) {
            return self.find_declaration(module, None);
        }
        let entry = table::entry(builtin);
        let module = find_module_of_object(entry.holder?)?;
        self.find_declaration(module, Some(names.atom_of(entry.name)?))
    }
}

impl NamedValues for LinkedProject<'_, '_> {
    fn find_named_value(&self, file: FileId, expression: ExprId) -> Option<NamedValue> {
        named_value_of(static_referent(self, file, expression).referent).or_else(|| {
            self.find_function_exported_whole(file, expression)
                .map(NamedValue::Function)
        })
    }

    fn find_library_declaration(
        &self,
        file: FileId,
        expression: ExprId,
    ) -> Option<ClassDeclaration> {
        let library = self.library?;
        match static_referent(self, file, expression).referent {
            StaticReferent::Builtin(builtin) => {
                library.find_declaration_of_builtin(builtin, self.builtin_names)
            }
            StaticReferent::Namespace(NamespaceReferent::Module(ModuleRef::Runtime(module))) => {
                library.find_declaration(module, None)
            }
            _ => None,
        }
    }

    fn find_library_export(&self, specifier: Atom, name: Atom) -> Option<ClassDeclaration> {
        let module = table::module_by_specifier(self.files.atoms.bytes(specifier))?;
        self.library?.find_declaration(module, Some(name))
    }
}

impl<'s> ReferentContext<'s> for LinkedProject<'_, 's> {
    type Builtin = BuiltinId;
    type Module = ModuleRef;

    fn hir(&self, file: FileId) -> &File<'s> {
        self.files.hir(file)
    }

    fn bound(&self, file: FileId) -> &Bound<'s> {
        self.files.bound(file)
    }

    fn builtin_of_expression(&self, file: FileId, expr: ExprId) -> Option<BuiltinId> {
        let source = parsed_source(self.files, file)?;
        let is_member = || self.files.hir(file).member_key(expr).is_some();
        match source.builtins.of_expr(expr)? {
            Resolved::Builtin(path) => Some(path.id),
            Resolved::Intrinsic(Intrinsic::Builtin(builtin)) => Some(builtin),
            Resolved::Intrinsic(Intrinsic::Call { .. }) if is_member() => {
                Some(BuiltinId::FunctionPrototypeCall)
            }
            Resolved::Intrinsic(Intrinsic::Apply) if is_member() => {
                Some(BuiltinId::FunctionPrototypeApply)
            }
            Resolved::Intrinsic(Intrinsic::PrivateGlobal) => self.find_private_global(file, expr),
            Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_) => None,
        }
    }

    fn builtin_member(&self, holder: BuiltinId, name: Atom) -> Option<BuiltinId> {
        if let Some(module) = find_module_of_object(holder) {
            return match self.runtime_module_export(module, name) {
                LinkedBinding::Builtin(member) => Some(member),
                _ => None,
            };
        }
        let name = self.builtin_names.get(name)?;
        match table::member(holder, name) {
            MemberLookup::Found(member) if table::exists_on(member, self.platform) => {
                Some(table::canonical_id(member))
            }
            MemberLookup::Found(_) | MemberLookup::Unknown | MemberLookup::Absent => None,
        }
    }

    fn linked_binding(&self, file: FileId, import: SymbolId) -> Linked {
        match self.graph.import_binding(file, import) {
            ImportBinding::Variable(symbol) => LinkedBinding::Binding(symbol),
            ImportBinding::Namespace { module, phase } => namespace_binding(module, phase),
            ImportBinding::Builtin(builtin)
            | ImportBinding::CapturedBuiltin {
                member: builtin, ..
            } => LinkedBinding::Builtin(table::canonical_id(builtin)),
            ImportBinding::Exports {
                module: ModuleRef::File(file),
            } => LinkedBinding::ExportOfCommonJs { file, name: None },
            ImportBinding::Synthetic(export) => {
                let export = self.graph.synthetic_export(export);
                match export.module {
                    ModuleRef::File(file) => LinkedBinding::ExportOfCommonJs {
                        file,
                        name: Some(export.name),
                    },
                    _ => LinkedBinding::Unknown,
                }
            }
            _ => LinkedBinding::Unknown,
        }
    }

    fn module_export(&self, module: ModuleRef, name: Atom) -> Linked {
        if let ModuleRef::Runtime(module) = module {
            return self.runtime_module_export(module, name);
        }
        match self.graph.find_export(module, name, &self.files.atoms) {
            ExportLookup::Found(ExportBinding::Variable(symbol)) => LinkedBinding::Binding(symbol),
            ExportLookup::Found(ExportBinding::Namespace { module, phase }) => {
                namespace_binding(module, phase)
            }
            ExportLookup::Found(ExportBinding::Synthetic(_) | ExportBinding::Indirect { .. })
            | ExportLookup::Absent
            | ExportLookup::Unknown => LinkedBinding::Unknown,
        }
    }

    fn loaded_value(&self, file: FileId, call: ExprId) -> Option<LoadedValue<ModuleRef>> {
        let analysis = &self.files.compiled(file)?.analysis;
        let site = analysis.import_sites[analysis.import_site_of_call(call)?].kind;
        match site {
            ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_)
            | ImportSiteKind::GetBuiltinModule(_) => {}
            _ => return None,
        }
        let SiteAnswer::Module(module) = self.graph.find_site_answer(file, site)? else {
            return None;
        };
        match (self.graph.interop(module).require_result, module) {
            // The value of a built-in module is an object. The table of built-ins lists its members as the exports of the module.
            (RequireResult::Namespace, _)
            | (RequireResult::DefaultExport, ModuleRef::Runtime(_)) => {
                Some(LoadedValue::Namespace(module))
            }
            (RequireResult::DefaultExport, ModuleRef::File(loaded)) => {
                Some(LoadedValue::DefaultExport(loaded))
            }
            (RequireResult::ModuleExports, ModuleRef::File(loaded)) => {
                Some(LoadedValue::ModuleExports(loaded))
            }
            (RequireResult::NamespaceIfImported, _) => None,
            (
                RequireResult::DefaultExport,
                ModuleRef::Inner { .. }
                | ModuleRef::Face(_)
                | ModuleRef::Check(_)
                | ModuleRef::External { .. },
            )
            | (
                RequireResult::ModuleExports,
                ModuleRef::Inner { .. }
                | ModuleRef::Face(_)
                | ModuleRef::Check(_)
                | ModuleRef::Runtime(_)
                | ModuleRef::External { .. },
            ) => None,
        }
    }

    fn is_dead_store(&self, file: FileId, target: ExprId) -> bool {
        self.files.analysis(file).decisions.is_dead_expr(target)
    }

    fn find_target_of_copied_properties(&self, builtin: BuiltinId) -> Option<u32> {
        match prototype_operation_of(builtin)? {
            PrototypeOperation::CopyProperties { target } => Some(target),
            _ => None,
        }
    }

    fn member_stores(&self, file: FileId) -> Option<&MemberStores> {
        let stores = self.graph.member_stores.get(file.idx())?;
        Some(stores.get_or_init(|| index_member_stores(self, file)))
    }
}
