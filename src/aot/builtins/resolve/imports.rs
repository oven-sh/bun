use super::mentions::mentioned_id;
use super::resolver::{AliasSource, ExprState, HolderKind, ResolvedValue, Resolver};
use super::{BuiltinPath, ModuleExport, SourceDialect};
use crate::builtins::names::BuiltinNames;
use crate::builtins::table::{
    self, BuiltinId, BuiltinName, ExportLookup, ModuleFlags, Mutability, Platforms, Prototype,
    RuntimeModule,
};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::Decl;
use bun_sema::hir::{ExprId, ExprKind, Flags, ImportId};
use bun_sema::import_sites::ImportSiteKind;

fn has_source(module: RuntimeModule) -> bool {
    table::module_data(module)
        .flags
        .contains(ModuleFlags::HAS_SOURCE)
}

fn namespace_value(namespace: BuiltinId) -> ResolvedValue {
    ResolvedValue {
        path: BuiltinPath {
            id: table::canonical_id(namespace),
            mutability: Mutability::AlwaysLocked,
        },
        kind: HolderKind::ModuleNamespace,
    }
}

fn imported_namespace_value(module: RuntimeModule) -> ResolvedValue {
    match table::object_replacing_namespace(module) {
        Some(object) => ResolvedValue::object(namespace_value(object).path),
        None => namespace_value(table::namespace_of(module)),
    }
}

pub fn find_module_export(
    names: &BuiltinNames,
    module: RuntimeModule,
    name: Atom,
    platform: Platforms,
) -> ModuleExport {
    let data = table::module_data(module);
    let export = match names.get(name) {
        Some(name) => table::find_export(data.namespace, name),
        None => ExportLookup::Unlisted,
    };
    match export {
        ExportLookup::Found(export) if table::exists_on(export, platform) => {
            return ModuleExport::Found(export);
        }
        ExportLookup::HeldByNamespace => return ModuleExport::HeldByNamespace,
        ExportLookup::Found(_) | ExportLookup::Unlisted => {}
    }
    if data.flags.contains(ModuleFlags::HAS_OPEN_NAMESPACE) {
        return ModuleExport::PropertyOfNamespace(table::canonical_id(data.namespace));
    }
    if data.flags.contains(ModuleFlags::LISTS_ALL_EXPORTS) {
        return ModuleExport::Absent;
    }
    ModuleExport::Unknown
}

impl Resolver<'_, '_> {
    #[rustfmt::skip]
    pub(super) fn collect_import_aliases(&mut self) {
        let input = self.input;
        for (site, module) in input.targets.iter() {
            if has_source(module) {
                continue;
            }
            let namespace = table::namespace_of(module);
            match site {
                ImportSiteKind::Import(import) => {
                    self.add_import_aliases(import, imported_namespace_value(module));
                }
                ImportSiteKind::ImportEquals(import) => {
                    let value = ResolvedValue::object(namespace_value(namespace).path);
                    self.add_import_alias(Decl::ImportEquals(import), value);
                    if input.hir[import].flags.contains(Flags::EXPORT) {
                        self.expose(value.path.id);
                    }
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_) | ImportSiteKind::ImportCall(_)
                | ImportSiteKind::Require(_) | ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaRequire(_) | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_) => {}
            }
        }
        if !table::exists_on(BuiltinId::BunBundle, input.platform) {
            return;
        }
        for import in (0..input.hir.imports.len() as u32).map(ImportId) {
            let is_bundle_import = input.hir[import].spec == known::bun_bundle;
            if is_bundle_import && !input.hir.is_type_only_import(import) {
                self.add_import_aliases(import, namespace_value(BuiltinId::BunBundle));
            }
        }
    }

    fn find_named_export(&self, namespace: BuiltinId, name: Atom) -> Option<BuiltinPath> {
        self.find_export(namespace, self.input.names.get(name)?)
    }

    pub(super) fn find_export(
        &self,
        namespace: BuiltinId,
        name: BuiltinName,
    ) -> Option<BuiltinPath> {
        let object = table::canonical_id(namespace);
        let found = match table::find_export(object, name) {
            ExportLookup::Found(found) => found,
            ExportLookup::Unlisted | ExportLookup::HeldByNamespace => return None,
        };
        if found == object {
            return Some(BuiltinPath {
                id: object,
                mutability: Mutability::AlwaysLocked,
            });
        }
        self.path_of_member(object, Mutability::AlwaysLocked, found)
    }

    fn add_import_aliases(&mut self, import: ImportId, namespace_value: ResolvedValue) {
        let input = self.input;
        let namespace = namespace_value.path.id;
        self.add_import_alias(Decl::ImportNamespace(import), namespace_value);
        if let Some(path) = self.find_named_export(namespace, known::default) {
            self.add_import_alias(Decl::ImportDefault(import), ResolvedValue::object(path));
        }
        for spec in input.hir[import].named.iter() {
            let import_spec = &input.hir[spec];
            if import_spec.type_only {
                continue;
            }
            let Some(path) = self.find_named_export(namespace, import_spec.imported) else {
                continue;
            };
            self.add_import_alias(Decl::ImportSpec(spec), ResolvedValue::object(path));
        }
    }

    fn add_import_alias(&mut self, decl: Decl, value: ResolvedValue) {
        let bound = self.input.bound;
        let symbol = bound.declared_symbol(decl);
        if symbol.is_none() {
            return;
        }
        self.aliases.insert(symbol, AliasSource::Known(value));
        match value.kind {
            HolderKind::ModuleNamespace => self.output.mentioned.push(value.path.id),
            // `finish` mentions the path of every symbol it publishes.
            HolderKind::Object => {}
        }
        if self.is_exported(symbol)
            || bound.is_visible_to_eval(symbol)
            || self.is_named_outside(symbol)
        {
            self.expose(value.path.id);
        }
    }

    pub(super) fn compute_call_state(&self, expr: ExprId) -> ExprState {
        let input = self.input;
        let sites = [
            ImportSiteKind::Require(expr),
            ImportSiteKind::ImportMetaRequire(expr),
            ImportSiteKind::GetBuiltinModule(expr),
        ];
        let module = sites
            .into_iter()
            .find_map(|site| input.targets.module_at(site));
        if let Some(module) = module.filter(|&module| !has_source(module)) {
            return ExprState::of_path(Some(BuiltinPath {
                id: table::canonical_id(table::namespace_of(module)),
                mutability: Mutability::ConstantUnlessWritten,
            }));
        }
        if let Some(prototype) = self.find_prototype_asked_for(expr) {
            return ExprState::Held(ResolvedValue::object(BuiltinPath {
                id: prototype,
                mutability: Mutability::ConstantUnlessWritten,
            }));
        }
        if input.dialect == SourceDialect::Runtime {
            return self.compute_native_call_state(expr);
        }
        ExprState::Unresolved
    }

    fn find_prototype_asked_for(&self, expr: ExprId) -> Option<BuiltinId> {
        let hir = self.input.hir;
        let ExprKind::Call(call) = hir[expr].kind else {
            return None;
        };
        let callee = mentioned_id(self.state(hir.skip_type_assertions(hir[call].callee)))?;
        let asks_for_prototype = matches!(
            table::canonical_id(callee),
            BuiltinId::ObjectGetPrototypeOf | BuiltinId::ReflectGetPrototypeOf
        );
        let operand = hir
            .ids(hir[call].args)
            .next()
            .filter(|_| asks_for_prototype)?;
        let object = self
            .value_of(operand)
            .or_else(|| self.held_value_of(operand))?;
        match table::entry(table::canonical_id(object.path.id)).prototype {
            Prototype::Builtin(prototype) => Some(prototype),
            Prototype::Unknown | Prototype::Null => None,
        }
    }

    #[rustfmt::skip]
    pub(super) fn visit_import_sites(&mut self) {
        let input = self.input;
        for (site, module) in input.targets.iter() {
            let namespace = table::namespace_of(module);
            self.output.mentioned.push(namespace);
            self.output.loaded.push(namespace);
            if has_source(module) {
                continue;
            }
            match site {
                ImportSiteKind::ImportCall(_) | ImportSiteKind::ExportStar(_) => {
                    self.expose(table::canonical_id(namespace));
                }
                ImportSiteKind::ExportFrom(export) => {
                    for item in input.hir[export].items.iter() {
                        let item = &input.hir[item];
                        if item.type_only {
                            continue;
                        }
                        if let Some(path) = self.find_named_export(namespace, item.local) {
                            self.output.mentioned.push(path.id);
                            self.expose(path.id);
                        }
                    }
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage | ImportSiteKind::Import(_)
                | ImportSiteKind::ImportEquals(_) | ImportSiteKind::Require(_)
                | ImportSiteKind::RequireResolve(_) | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::ImportMetaResolve(_) | ImportSiteKind::GetBuiltinModule(_) => {}
            }
        }
    }
}
