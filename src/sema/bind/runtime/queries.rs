use super::bits::has_bit;
use super::declaration_kinds::declaration_symbol;
use super::storage::RuntimeDeclarationsIn;
use super::{
    AnnexBFunction, Binding, BindingInitializer, BindingKind, BindingStability, CodeUnit,
    CommonJsVariable, EarlyRedeclaration, EvalScope, FunctionFlags, ImplicitReference,
    ImplicitReferenceKind, InitialState, ParameterVarCopy, PrivateName, PrivateNameId,
    RuntimeBindings, RuntimeBindingsIn, StoreKind, SymbolStore, has_mapped_arguments, stability,
};
use crate::atom::Atom;
use crate::bind::{
    Bound, BoundBuilder, BoundIn, ClassOwner, Decl, FnOwner, MemberOwner, Parent, ScopeId,
    ScopeKind, SymFlags, SymbolId, TableId,
};
use crate::hir::*;

#[inline]
pub(super) fn find_entry<K: Ord + Copy, V>(list: &[(K, V)], key: K) -> Option<&V> {
    let index = list.binary_search_by_key(&key, |entry| entry.0).ok()?;
    Some(&list[index].1)
}

pub(super) const IDENTS_IN_RUN: usize = 16;

#[inline]
pub(super) fn find_symbol<K: Ord + Copy>(list: &[(K, SymbolId)], key: K) -> Option<SymbolId> {
    find_entry(list, key).copied()
}

#[inline]
fn symbol_at(column: &[SymbolId], index: usize) -> SymbolId {
    column.get(index).copied().unwrap_or(SymbolId::NONE)
}

pub fn is_among_parameters(hir: &File<'_>, function: FnId, from: ScopeKind, pos: u32) -> bool {
    match hir[function].body {
        FnBody::Expr(body) => pos < hir[body].pos,
        FnBody::Block(_) | FnBody::None => matches!(from, ScopeKind::Param(_)),
    }
}

impl BoundBuilder {
    pub(super) fn find_in_table(&self, table: TableId, name: Atom) -> Option<SymbolId> {
        let Some(entries) = self.entries_to_scan(table) else {
            return self.find_in_large_table(table, name);
        };
        let entry = entries.iter().find(|entry| entry.0 == name);
        entry.map(|entry| entry.1)
    }

    #[inline(never)]
    fn find_in_large_table(&self, table: TableId, name: Atom) -> Option<SymbolId> {
        let entry_index = *self.large_tables.get(&(table, name))?;
        Some(self.entries[entry_index as usize].1)
    }
}

impl<S: Storage> RuntimeDeclarationsIn<S> {
    pub(super) fn created_scope(&self, stmt: StmtId) -> ScopeId {
        find_entry(&self.own_scopes, stmt)
            .copied()
            .unwrap_or(ScopeId::NONE)
    }
}

impl<S: Storage> BoundIn<S> {
    #[inline]
    pub fn binding_kind(&self, symbol: SymbolId) -> BindingKind {
        let kind = self.runtime.declarations.binding_kinds.get(symbol.idx());
        kind.copied().unwrap_or(BindingKind::NoBinding)
    }

    #[inline]
    pub fn symbol_scope(&self, symbol: SymbolId) -> ScopeId {
        let scope = self.runtime.declarations.symbol_scopes.get(symbol.idx());
        scope.copied().unwrap_or(ScopeId::NONE)
    }

    pub fn own_binding_of_decorated_class(&self, inner: SymbolId) -> Option<SymbolId> {
        let own_bindings = &self.runtime.declarations.own_bindings_of_decorated_classes;
        find_symbol(own_bindings, inner)
    }

    pub fn function_flags(&self, function: FnId) -> FunctionFlags {
        let flags = self.runtime.function_flags.get(function.idx());
        flags.copied().unwrap_or_default()
    }

    pub fn is_mapped_argument(
        &self,
        hir: &File,
        symbol: SymbolId,
        names_lie_on_object_prototype: bool,
    ) -> bool {
        let scope = self.scopes.get(self.symbol_scope(symbol).idx());
        let Some(ScopeKind::Fn(function)) = scope.map(|scope| scope.kind) else {
            return false;
        };
        let flags = self.function_flags(function);
        if !flags.contains(FunctionFlags::USES_ARGUMENTS)
            || !has_mapped_arguments(hir, CodeUnit::Function(function))
        {
            return false;
        }
        let mut other_ways = FunctionFlags::HANDS_ARGUMENTS_ON
            | FunctionFlags::HAS_ARGUMENTS_VARIABLE
            | FunctionFlags::HAS_DIRECT_EVAL;
        if names_lie_on_object_prototype {
            other_ways |= FunctionFlags::MAY_READ_ABOVE_ARGUMENTS;
        }
        let references = &self.runtime.references;
        if !flags.intersects(other_ways | FunctionFlags::READS_ELEMENTS_OF_ARGUMENTS)
            && !has_bit(&references.eval_visible_symbols, symbol.idx())
        {
            return false;
        }
        let stores = &references.stores[..];
        let first_store = stores.partition_point(|store| store.symbol < symbol);
        let mut declared = self.runtime.declarations.declared_symbols.iter();
        let mut own_declarations = self.symbol(symbol).decls.iter();
        declared
            .any(|&(declaration, target)| target == symbol && matches!(declaration, Decl::Fn(_)))
            || own_declarations.any(|declaration| matches!(declaration, Decl::Var(_)))
            || flags.intersects(other_ways)
            || has_bit(&references.eval_visible_symbols, symbol.idx())
            || (stores.get(first_store)).is_some_and(|store| store.symbol == symbol)
    }

    pub fn is_outside_body_variables(&self, binding: Binding) -> bool {
        let function = match binding {
            Binding::Symbol(symbol) if self.binding_kind(symbol) == BindingKind::Parameter => {
                match self.scopes[self.symbol_scope(symbol).idx()].kind {
                    ScopeKind::Fn(function) => function,
                    _ => return false,
                }
            }
            Binding::Arguments(CodeUnit::Function(function)) => function,
            _ => return false,
        };
        let flags = self.function_flags(function);
        flags.contains(FunctionFlags::HAS_REST_PATTERN_OR_DEFAULT)
            && match binding {
                Binding::Symbol(symbol) => {
                    let mut declarations = self.symbol(symbol).decls.iter();
                    let with_function = &self.runtime.declarations.parameters_with_function_of_body;
                    flags.contains(FunctionFlags::HAS_PARAMETER_EXPRESSIONS)
                        || (!has_bit(with_function, symbol.idx())
                            && declarations.all(|decl| matches!(decl, Decl::Param(_))))
                }
                _ => !flags.contains(FunctionFlags::HAS_ARGUMENTS_VARIABLE),
            }
    }

    pub fn variable_kind(&self, hir: &File, declaration: VarDeclId) -> VarKind {
        let written = hir[declaration].kind;
        let statement = self.var_stmt[declaration.idx()];
        let is_hoisted = self.runtime.hoists_top_level_variables
            && matches!(written, VarKind::Let | VarKind::Const)
            && self.parent_of_stmt(statement) == Parent::File;
        match is_hoisted {
            true => VarKind::Var,
            false => written,
        }
    }

    pub fn runtime_parent_scope(&self, hir: &File, scope: ScopeId) -> ScopeId {
        let ScopeKind::ClassDecorators(class) = self.scopes[scope.idx()].kind else {
            return self.scopes[scope.idx()].parent;
        };
        let around_class = self.scopes[self.class_scope[class.idx()].idx()].parent;
        match self.class_owner[class.idx()] {
            ClassOwner::Expr(_) if hir[class].name.is_some() => {
                self.scopes[around_class.idx()].parent
            }
            ClassOwner::Expr(_) | ClassOwner::Stmt(_) => around_class,
        }
    }

    pub fn constructor_of_field_value(&self, hir: &File, scope: ScopeId) -> Option<FnId> {
        let ScopeKind::FieldInitializer(field) = self.scopes[scope.idx()].kind else {
            return None;
        };
        if !hir.has_typescript_semantics() || hir[field].flags.contains(Flags::STATIC) {
            return None;
        }
        let mut members = hir[self.member_class(field)?].members.iter();
        let constructor = members.find(|&member| {
            hir.runtime_member_kind(member) == MemberKind::Constructor
                && has_runtime_member(hir, member)
        });
        Some(hir[constructor?].func)
    }

    pub fn member_class(&self, member: MemberId) -> Option<ClassId> {
        match self.member_owner[member.idx()] {
            MemberOwner::Class(class) => Some(class),
            MemberOwner::None | MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_) => None,
        }
    }

    pub fn function_class(&self, function: FnId) -> Option<ClassId> {
        match self.fns[function.idx()].owner {
            FnOwner::Member(member) => self.member_class(member),
            FnOwner::None | FnOwner::Expr(_) | FnOwner::Stmt(_) | FnOwner::Type(_) => None,
        }
    }

    #[inline]
    pub(super) fn default_binding(&self, ident: ExprId) -> Binding {
        Binding::from_symbol(self.symbol_of_expr(ident))
    }

    #[inline]
    pub(super) fn is_default_binding(&self, ident: ExprId, binding: Binding) -> bool {
        let symbol = self.symbol_of_expr(ident);
        match binding {
            Binding::Symbol(found) => found == symbol && symbol.is_some(),
            Binding::Free => symbol.is_none(),
            Binding::Arguments(_) | Binding::CommonJs(_) => false,
        }
    }

    #[inline]
    pub(super) fn declared_pattern_symbol(&self, pattern: PatId) -> SymbolId {
        let declared = &self.runtime.declarations.declared_symbols;
        find_symbol(declared, Decl::Var(pattern))
            .unwrap_or_else(|| self.file_binding(self.pat_symbol[pattern.idx()]))
    }

    #[inline]
    pub fn file_binding(&self, declared: SymbolId) -> SymbolId {
        if declared.is_none() || !self.symbol_flags(declared).contains(SymFlags::EXPORT_VALUE) {
            return declared;
        }
        self.file_binding_of_exported_value(declared)
    }

    #[inline(never)]
    fn file_binding_of_exported_value(&self, declared: SymbolId) -> SymbolId {
        let exported = self.export_symbol_of_value_symbol_if_exported(declared);
        match self.symbol(exported).parent == self.file_symbol {
            true => exported,
            false => declared,
        }
    }

    #[inline]
    pub(super) fn declared_binding_symbol(&self, decl: Decl) -> Option<SymbolId> {
        let declarations = &self.runtime.declarations;
        Some(match decl {
            Decl::Var(pattern) | Decl::Param(pattern) | Decl::Require(pattern) => {
                self.declared_pattern_symbol(pattern)
            }
            Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Enum(_)
            | Decl::Module(_)
            | Decl::ExportExpr(_) => find_symbol(&declarations.declared_symbols, decl)
                .unwrap_or_else(|| self.file_binding(declaration_symbol(self, decl))),
            Decl::ImportDefault(import) => {
                symbol_at(&declarations.import_default_symbols, import.idx())
            }
            Decl::ImportNamespace(import) => {
                symbol_at(&declarations.import_namespace_symbols, import.idx())
            }
            Decl::ImportSpec(spec) => symbol_at(&declarations.import_spec_symbols, spec.idx()),
            Decl::ImportEquals(import) => {
                symbol_at(&declarations.import_equals_symbols, import.idx())
            }
            _ => return None,
        })
    }

    #[inline]
    pub(super) fn initialized_pattern_binding(&self, name: PatId) -> Binding {
        match find_entry(&self.runtime.references.initialized_bindings, name) {
            Some(&binding) => binding,
            None => Binding::from_symbol(self.declared_pattern_symbol(name)),
        }
    }
}

impl<S: Storage> RuntimeBindingsIn<S> {
    #[inline]
    pub fn is_computed(&self) -> bool {
        self.tables.is_some()
    }
}

impl RuntimeBindings<'_> {
    pub fn depends_on_sloppy_mode(&self) -> bool {
        self.depends_on_sloppy_mode
    }

    pub fn set_module_goal(&mut self, is_module: bool) {
        self.is_module = is_module;
    }

    pub fn stores(&self) -> &[SymbolStore] {
        &self.references.stores
    }

    pub fn unbound_name_stores(&self) -> &[(ExprId, StoreKind)] {
        &self.references.unbound_name_stores
    }

    pub fn jsx_paths(&self) -> [Option<Atom>; 2] {
        self.jsx_paths
    }

    pub fn is_stored_by_function_of_block(&self, variable: SymbolId) -> bool {
        has_bit(
            &self.variables_stored_by_functions_of_blocks,
            variable.idx(),
        )
    }

    pub fn annex_b_functions(&self) -> &[AnnexBFunction] {
        &self.declarations.annex_b_functions
    }

    pub fn parameter_var_copies(&self) -> &[ParameterVarCopy] {
        &self.declarations.parameter_var_copies
    }

    pub fn implicit_references(&self) -> &[ImplicitReference] {
        &self.references.implicit_references
    }

    pub fn binding_of_defined_path(&self, path: ExprId) -> Binding {
        let mut references = self.implicit_references().iter();
        let found = references.find(|it| {
            it.kind == ImplicitReferenceKind::DefinedPath
                && matches!(it.node, NodeData::Expr(at) if at == path)
        });
        found.map_or(Binding::Free, |it| it.binding)
    }

    pub fn is_named_implicitly(&self, symbol: SymbolId) -> bool {
        let mut references = self.implicit_references().iter();
        references.any(|reference| reference.binding == Binding::Symbol(symbol))
    }

    pub fn redeclared_commonjs_variables(&self) -> &[(SymbolId, CommonJsVariable)] {
        &self.references.redeclared_commonjs_variables
    }

    pub fn eval_scopes(&self) -> &[(ExprId, EvalScope)] {
        &self.references.eval_scopes
    }

    pub fn early_redeclarations(&self) -> &[EarlyRedeclaration] {
        let declarations = &self.declarations;
        let redeclarations = &declarations.early_redeclarations[..];
        match self.is_module {
            true => redeclarations,
            false => &redeclarations[..declarations.goal_independent_redeclaration_count as usize],
        }
    }

    #[cfg(any(test, feature = "test_support"))]
    pub fn private_names(&self) -> &[PrivateName] {
        &self.private_names.names
    }

    pub fn private_class(&self, reference: ExprId) -> Option<ClassId> {
        let name = *find_entry(&self.private_names.references, reference)?;
        Some(self.private_names.names[name.idx()].class)
    }

    #[cfg(test)]
    pub fn field_initializer_scopes(&self) -> &[(MemberId, ScopeId)] {
        &self.field_initializer_scopes
    }
}

impl Bound<'_> {
    fn binding_under_goal(&self, binding: Binding) -> Binding {
        match binding {
            Binding::Arguments(CodeUnit::File) if self.runtime.is_module => Binding::Free,
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                binding
            }
        }
    }

    pub fn binding(&self, ident: ExprId) -> Binding {
        let run = ident.idx() / IDENTS_IN_RUN;
        match self.runtime.references.ident_binding_runs.get(run..run + 2) {
            Some(&[start, end]) if start != end => self.binding_in_run(ident, start, end),
            _ => self.default_binding(ident),
        }
    }

    #[inline(never)]
    fn binding_in_run(&self, ident: ExprId, start: u32, end: u32) -> Binding {
        let entries = &self.runtime.references.ident_bindings[start as usize..end as usize];
        match entries.iter().find(|entry| entry.0 == ident) {
            Some(&(_, binding)) => self.binding_under_goal(binding),
            None => self.default_binding(ident),
        }
    }

    pub fn declared_symbol(&self, decl: Decl) -> SymbolId {
        self.declared_binding_symbol(decl)
            .unwrap_or_else(|| self.symbol_of_declaration(decl))
    }

    pub fn exported_binding(&self, spec: ExportSpecId) -> Binding {
        let binding = find_entry(&self.runtime.references.exported_bindings, spec);
        binding.map_or(Binding::Free, |&binding| self.binding_under_goal(binding))
    }

    pub fn entity_root_binding(&self, import: ImportEqualsId) -> Binding {
        let binding = find_entry(&self.runtime.references.entity_root_bindings, import);
        binding.map_or(Binding::Free, |&binding| self.binding_under_goal(binding))
    }

    pub fn exports_value(&self, statement: StmtId) -> bool {
        let declared = &self.runtime.declarations.declared_symbols;
        find_symbol(declared, Decl::ExportExpr(statement)) != Some(SymbolId::NONE)
    }

    pub fn has_runtime_value(&self, symbol: SymbolId) -> bool {
        !has_bit(&self.runtime.declarations.valueless_symbols, symbol.idx())
    }

    pub fn last_made_enum_member(&self, member: EnumMemberId) -> Option<EnumMemberId> {
        let symbol = self.declared_symbol(Decl::EnumMember(member));
        let is_made = |written: Decl| self.has_runtime_value(self.declared_symbol(written));
        let mut written_again = self.redeclarations.iter().rev();
        let last = written_again.find_map(|it| match it.decl {
            Decl::EnumMember(later) if it.symbol == symbol && is_made(it.decl) => Some(later),
            _ => None,
        });
        last.or_else(|| self.has_runtime_value(symbol).then_some(member))
    }

    pub fn exported_variable(&self, declaration: Decl) -> Option<SymbolId> {
        let local = self.declared_symbol(declaration).some()?;
        let is_shown = !has_bit(&self.runtime.declarations.bound_without_export, local.idx());
        (is_shown && self.has_runtime_value(local)).then_some(local)
    }

    pub fn initial_state(&self, symbol: SymbolId) -> InitialState {
        match self.binding_kind(symbol) {
            BindingKind::Var => InitialState::Undefined,
            BindingKind::TypeScriptContainer => {
                let scope = self.scopes.get(self.symbol_scope(symbol).idx());
                match scope.is_none_or(|scope| matches!(scope.kind, ScopeKind::File)) {
                    true => InitialState::Undefined,
                    false => InitialState::Uninitialized,
                }
            }
            BindingKind::Function
            | BindingKind::FunctionName
            | BindingKind::SimpleCatchParameter => InitialState::Initialized,
            BindingKind::Parameter => {
                let scope = self.scopes.get(self.symbol_scope(symbol).idx());
                let has_dead_zone = scope.is_none_or(|scope| match scope.kind {
                    ScopeKind::Fn(function) => {
                        let flags = self.function_flags(function);
                        flags.contains(FunctionFlags::HAS_PARAMETER_EXPRESSIONS)
                    }
                    ScopeKind::Module(_) | ScopeKind::Enum(_) => false,
                    _ => true,
                });
                match has_dead_zone {
                    true => InitialState::Uninitialized,
                    false => InitialState::Initialized,
                }
            }
            BindingKind::ClassInnerName
                if self.own_binding_of_decorated_class(symbol).is_some() =>
            {
                InitialState::Undefined
            }
            _ => InitialState::Uninitialized,
        }
    }

    pub fn initialized_binding(&self, name: PatId) -> Binding {
        self.binding_under_goal(self.initialized_pattern_binding(name))
    }

    #[inline]
    pub fn dynamic_lookup_scope(&self, node: NodeData) -> Option<ScopeId> {
        let references = &self.runtime.references;
        if references.dynamic_ident_lookups.is_empty()
            && references.dynamic_declarator_lookups.is_empty()
        {
            return None;
        }
        self.find_dynamic_lookup_scope(node)
    }

    #[cold]
    #[inline(never)]
    fn find_dynamic_lookup_scope(&self, node: NodeData) -> Option<ScopeId> {
        let references = &self.runtime.references;
        match node {
            NodeData::Expr(ident) => find_entry(&references.dynamic_ident_lookups, ident).copied(),
            NodeData::Pat(name) => {
                find_entry(&references.dynamic_declarator_lookups, name).copied()
            }
            _ => None,
        }
    }

    pub fn dynamic_lookup_end(&self, ident: ExprId, declaring_scope: ScopeId) -> ScopeId {
        let behind_variables = &self.runtime.references.idents_behind_eval_variables;
        match has_bit(behind_variables, ident.idx()) {
            true => self.scopes[declaring_scope.idx()].parent,
            false => declaring_scope,
        }
    }

    pub fn own_scope(&self, stmt: StmtId) -> ScopeId {
        self.runtime.declarations.created_scope(stmt)
    }

    pub fn field_initializer_scope(&self, member: MemberId) -> Option<ScopeId> {
        find_entry(&self.runtime.field_initializer_scopes, member).copied()
    }

    pub fn is_field_assigned_behind_class(&self, member: MemberId) -> bool {
        self.field_initializer_scope(member).is_some_and(|scope| {
            let around = self.scopes[scope.idx()].parent;
            matches!(
                self.scopes[around.idx()].kind,
                ScopeKind::ClassDecorators(_)
            )
        })
    }

    #[inline]
    pub fn code_unit(&self, scope: ScopeId) -> CodeUnit {
        let unit = self.runtime.declarations.scope_units.get(scope.idx());
        unit.copied().unwrap_or(CodeUnit::File)
    }

    pub fn top_scope(&self, hir: &File<'_>, unit: CodeUnit) -> ScopeId {
        match unit {
            CodeUnit::File => self.scope_of_declaration(hir, Decl::File),
            CodeUnit::Function(function) => self.fns[function.idx()].scope,
            CodeUnit::FieldInitializer(member) => self
                .field_initializer_scope(member)
                .unwrap_or(ScopeId::NONE),
        }
    }

    pub fn is_strict_scope(&self, scope: ScopeId) -> bool {
        self.runtime.is_module || has_bit(&self.runtime.strict_scopes, scope.idx())
    }

    pub fn file_uses_arguments(&self) -> bool {
        self.runtime.file_uses_arguments
    }

    pub fn may_require_get_members(&self, compute: impl FnOnce() -> bool) -> bool {
        *self.runtime.may_require_get_members.get_or_init(compute)
    }

    pub fn import_meta_may_be_modified(&self) -> bool {
        self.runtime.import_meta_may_be_modified
    }

    #[inline]
    pub fn may_name_own_path(&self) -> bool {
        self.runtime.may_name_own_path
    }

    #[inline]
    pub fn may_name_own_require(&self) -> bool {
        self.runtime.may_name_own_require
    }

    pub fn stores_to(&self, symbol: SymbolId) -> &[SymbolStore] {
        let stores = &self.runtime.references.stores[..];
        let start = stores.partition_point(|store| store.symbol < symbol);
        let len = stores[start..].partition_point(|store| store.symbol == symbol);
        &stores[start..start + len]
    }

    #[inline]
    pub fn is_store_target(&self, ident: ExprId) -> bool {
        has_bit(&self.runtime.references.store_targets, ident.idx())
    }

    pub fn is_visible_to_eval(&self, symbol: SymbolId) -> bool {
        has_bit(&self.runtime.references.eval_visible_symbols, symbol.idx())
    }

    pub fn eval_scope(&self, call: ExprId) -> Option<&EvalScope> {
        find_entry(&self.runtime.references.eval_scopes, call)
    }

    #[inline]
    pub fn binding_stability_ignoring(
        &self,
        symbol: SymbolId,
        is_dead_store: &dyn Fn(ExprId) -> bool,
    ) -> BindingStability {
        match self.binding_stability(symbol) {
            BindingStability::Stored => self.stability_of_stored_binding(symbol, is_dead_store),
            recorded => recorded,
        }
    }

    #[inline(never)]
    fn stability_of_stored_binding(
        &self,
        symbol: SymbolId,
        is_dead_store: &dyn Fn(ExprId) -> bool,
    ) -> BindingStability {
        let stores = &self.runtime.references.stores[..];
        let start = stores.partition_point(|store| store.symbol < symbol);
        for store in &stores[start..] {
            if store.symbol != symbol {
                break;
            }
            if !is_dead_store(store.target) {
                return BindingStability::Stored;
            }
        }
        BindingStability::Stable
    }

    #[inline]
    pub fn binding_stability(&self, symbol: SymbolId) -> BindingStability {
        let recorded = self.runtime.stability.stabilities.get(symbol.idx());
        recorded.copied().unwrap_or_default()
    }

    #[inline]
    pub fn is_stable_binding(&self, symbol: SymbolId) -> bool {
        self.binding_stability(symbol) == BindingStability::Stable
    }

    #[inline]
    pub fn binding_initializer(&self, hir: &File<'_>, symbol: SymbolId) -> BindingInitializer {
        stability::find_binding_initializer(hir, self, symbol)
    }

    #[inline]
    pub fn initializing_declaration(&self, symbol: SymbolId) -> Option<Decl> {
        let recorded = self.runtime.stability.initializers.get(symbol.idx());
        recorded.copied().flatten()
    }

    pub fn private_name(&self, name: PrivateNameId) -> &PrivateName {
        &self.runtime.private_names.names[name.idx()]
    }

    pub fn private_name_of_reference(&self, reference: ExprId) -> Option<PrivateNameId> {
        find_entry(&self.runtime.private_names.references, reference).copied()
    }

    pub fn private_name_of_member(&self, member: MemberId) -> Option<PrivateNameId> {
        find_entry(&self.runtime.private_names.members, member).copied()
    }

    pub fn private_names_of_class(
        &self,
        class: ClassId,
    ) -> impl ExactSizeIterator<Item = (PrivateNameId, &PrivateName)> {
        let names = &self.runtime.private_names.names[..];
        let start = names.partition_point(|name| name.class < class);
        let len = names[start..].partition_point(|name| name.class == class);
        let ids = (start as u32..(start + len) as u32).map(PrivateNameId);
        ids.zip(&names[start..start + len])
    }

    pub fn inner_class_symbol(&self, class: ClassId) -> SymbolId {
        let symbols = &self.runtime.declarations.inner_class_symbols;
        find_symbol(symbols, class).unwrap_or(SymbolId::NONE)
    }

    pub fn container_parameter(&self, scope: ScopeId) -> SymbolId {
        let parameters = &self.runtime.declarations.container_parameters;
        find_symbol(parameters, scope).unwrap_or(SymbolId::NONE)
    }

    pub fn jump_target(&self, jump: StmtId) -> Option<StmtId> {
        find_entry(&self.runtime.references.jump_targets, jump).copied()
    }

    pub fn is_appended_symbol(&self, symbol: SymbolId) -> bool {
        let runtime = &self.runtime;
        (runtime.first_appended_symbol..runtime.appended_symbol_end).contains(&symbol.0)
    }

    pub fn is_early_error_redeclaration(&self, redeclaration: usize) -> bool {
        self.runtime.is_computed() && {
            let indexes = &self.runtime.early_error_redeclarations;
            indexes.binary_search(&(redeclaration as u32)).is_ok()
        }
    }

    pub fn names_taken_from_imports(&self) -> &[(SymbolId, SymbolId)] {
        match self.runtime.is_computed() {
            true => &self.runtime.declarations.names_taken_from_imports,
            false => &[],
        }
    }

    #[inline]
    pub fn is_evaluated_ident(&self, e: ExprId) -> bool {
        has_bit(&self.runtime.references.evaluated_idents, e.idx())
    }

    pub fn finds_itself(&self, hir: &File, function: FnId) -> bool {
        if hir[function].kind == FnKind::Arrow {
            return false;
        }
        let ways = FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL;
        if self.function_flags(function).intersects(ways) {
            return true;
        }
        if hir[function].name == Atom::NONE {
            return false;
        }
        let own_name = Binding::Symbol(self.declared_symbol(Decl::Fn(function)));
        let mut idents = (0..hir.exprs.len() as u32).map(ExprId);
        idents.any(|ident| self.is_evaluated_ident(ident) && self.binding(ident) == own_name)
    }

    pub fn is_called_only_where_written(&self, hir: &File, function: FnId) -> bool {
        self.get_immediately_invoked_function_expression(hir, function)
            .is_some()
            && !self.finds_itself(hir, function)
    }

    pub fn ident_bindings(&self) -> &[(ExprId, Binding)] {
        &self.runtime.references.ident_bindings
    }
}
