use super::mentions::mentioned_id;
use super::resolver::{AliasSource, ExprState, HolderKind, ResolvedValue, Resolver};
use super::{BuiltinPath, ModuleExport, SourceDialect};
use crate::builtins::names::BuiltinNames;
use crate::builtins::table::{
    self, BuiltinId, BuiltinName, ExportLookup, ModuleFlags, Mutability, Platforms, RuntimeModule,
};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Decl, Parent};
use bun_sema::hir::{ExprId, ExprKind, Flags, ImportId};
use bun_sema::import_sites::ImportSiteKind;

pub(super) fn has_source(module: RuntimeModule) -> bool {
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
        has_side_effects: false,
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
                | ImportSiteKind::GetBuiltinModule(_) | ImportSiteKind::MockModule(_)
                | ImportSiteKind::ImportByTestRunner(_) | ImportSiteKind::RequireByTestRunner(_) => {}
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
            let is_replaced = self.input.replaced.binary_search(&(object as u32)).is_ok();
            return Some(BuiltinPath {
                id: object,
                mutability: match is_replaced {
                    true => Mutability::ConstantUnlessWritten,
                    false => Mutability::AlwaysLocked,
                },
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
            HolderKind::ModuleNamespace => self.mention(value.path.id),
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
        let callee = match input.hir[expr].kind {
            ExprKind::Call(call) => Some(input.hir.skip_type_assertions(input.hir[call].callee)),
            _ => None,
        };
        let function = callee.and_then(|callee| mentioned_id(self.state(callee)));
        if let (Some(callee), Some(function)) = (callee, function) {
            if let Some(runner) = self.find_runner_that_stub_answers(callee, function) {
                let runner = ResolvedValue::object(BuiltinPath {
                    id: runner,
                    mutability: Mutability::ConstantUnlessWritten,
                });
                return ExprState::Builtin(runner.with_side_effects());
            }
            if table::canonical_id(function) == table::canonical_id(BuiltinId::BunJest) {
                let runner = imported_namespace_value(RuntimeModule::BunTest);
                return ExprState::Held(runner.with_side_effects());
            }
        }
        if input.dialect == SourceDialect::Runtime {
            return self.compute_native_call_state(expr);
        }
        ExprState::Unresolved
    }

    pub(super) fn compute_state_of_awaited_import(&self, promise: ExprId) -> ExprState {
        let call = self.input.hir.skip_type_assertions(promise);
        let module = self
            .input
            .targets
            .module_at(ImportSiteKind::ImportCall(call));
        match module.filter(|&module| !has_source(module)) {
            Some(module) => {
                ExprState::of_value(Some(imported_namespace_value(module).with_side_effects()))
            }
            None => ExprState::Unresolved,
        }
    }

    pub(super) fn is_import_awaited_at_once(&self, call: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut promise = call;
        while let Parent::Expr(parent) = bound.parent_of_expr(promise) {
            if hir.type_assertion_operand(parent) != Some(promise) {
                return matches!(hir[parent].kind, ExprKind::Await(_));
            }
            promise = parent;
        }
        false
    }

    fn find_runner_that_stub_answers(&self, callee: ExprId, stub: BuiltinId) -> Option<BuiltinId> {
        if !table::stubs_global(stub) {
            return None;
        }
        let (receiver, _) = self.input.hir.member_key(callee)?;
        let receiver = table::canonical_id(self.value_of(receiver)?.path.id);
        (table::entry(table::canonical_id(stub)).holder == Some(receiver)).then_some(receiver)
    }

    #[rustfmt::skip]
    pub(super) fn visit_import_sites(&mut self) {
        let input = self.input;
        for (site, module) in input.targets.iter() {
            let namespace = table::namespace_of(module);
            self.mention(namespace);
            self.output.loaded.push(namespace);
            if has_source(module) {
                continue;
            }
            match site {
                ImportSiteKind::ImportCall(call) if self.is_import_awaited_at_once(call) => {}
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
                            self.mention(path.id);
                            self.expose(path.id);
                        }
                    }
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage | ImportSiteKind::Import(_)
                | ImportSiteKind::ImportEquals(_) | ImportSiteKind::Require(_)
                | ImportSiteKind::RequireResolve(_) | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::ImportMetaResolve(_) | ImportSiteKind::GetBuiltinModule(_)
                | ImportSiteKind::MockModule(_) | ImportSiteKind::ImportByTestRunner(_)
                | ImportSiteKind::RequireByTestRunner(_) => {}
            }
        }
    }
}
