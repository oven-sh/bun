use super::bits::has_bit;
use super::declaration_kinds::declaration_symbol;
use super::storage::{RuntimeDeclarationsIn, implicit_reference_order};
use super::{
    AnnexBFunction, Binding, BindingInitializer, BindingKind, BindingStability, CodeUnit,
    CommonJsVariable, DynamicLookup, EarlyRedeclaration, EvalScope, FunctionFlags,
    ImplicitReference, ImplicitReferenceKind, InitialState, ParameterVarCopy, PrivateName,
    PrivateNameId, RuntimeBindings, RuntimeBindingsIn, StoreKind, SymbolStore, stability,
};
use crate::atom::Atom;
use crate::bind::{
    Bound, BoundBuilder, BoundIn, Decl, FnOwner, MemberOwner, Parent, ScopeId, ScopeKind, SymbolId,
    TableId,
};
use crate::hir::*;

#[inline]
pub(super) fn find_entry<K: Ord + Copy, V>(list: &[(K, V)], key: K) -> Option<&V> {
    let index = list.binary_search_by_key(&key, |entry| entry.0).ok()?;
    Some(&list[index].1)
}

/// `RuntimeReferencesIn::ident_binding_runs`
pub(super) const IDENTS_IN_RUN: usize = 16;

#[inline]
pub(super) fn find_symbol<K: Ord + Copy>(list: &[(K, SymbolId)], key: K) -> Option<SymbolId> {
    find_entry(list, key).copied()
}

/// The entry of `reference` in `RuntimeReferencesIn::dynamic_implicit_lookups`. What the name is bound to is no part of what tells two references apart.
pub(super) fn find_reference_lookup(
    lookups: &[(ImplicitReference, DynamicLookup)],
    reference: &ImplicitReference,
) -> Option<DynamicLookup> {
    if lookups.is_empty() {
        return None;
    }
    let order = implicit_reference_order(reference);
    let first = lookups.partition_point(|entry| implicit_reference_order(&entry.0) < order);
    let mut in_place = lookups[first..]
        .iter()
        .take_while(|entry| implicit_reference_order(&entry.0) == order);
    let found = in_place.find(|entry| entry.0.name == reference.name)?;
    Some(found.1)
}

/// Whether `heads` has the root and the name of the define head `reference`. `heads` is in the order of the roots, as `RuntimeReferencesIn::define_heads_behind_members` is.
fn has_define_head(heads: &[(ExprId, Atom)], reference: &ImplicitReference) -> bool {
    let (ImplicitReferenceKind::DefineHead, NodeData::Expr(root)) =
        (reference.kind, reference.node)
    else {
        return false;
    };
    let first = heads.partition_point(|entry| entry.0 < root);
    let mut at_root = heads[first..].iter().take_while(|entry| entry.0 == root);
    at_root.any(|entry| entry.1 == reference.name)
}

#[inline]
fn symbol_at(column: &[SymbolId], index: usize) -> SymbolId {
    column.get(index).copied().unwrap_or(SymbolId::NONE)
}

/// Whether code at `pos`, whose chain of scopes enters the scope of `function` from a scope of kind `from`, stands among the parameters.
pub fn is_among_parameters(hir: &File<'_>, function: FnId, from: ScopeKind, pos: u32) -> bool {
    match hir[function].body {
        // A function whose body is an expression has one scope for its parameters and its body.
        FnBody::Expr(body) => pos < hir[body].pos,
        FnBody::Block(_) | FnBody::None => matches!(from, ScopeKind::Param(_)),
    }
}

impl BoundBuilder {
    pub(super) fn find_in_table(&self, table: TableId, name: Atom) -> Option<SymbolId> {
        let entries = self.table(table);
        if entries.len() <= Self::SCANNED {
            let entry = entries.iter().find(|entry| entry.0 == name);
            return entry.map(|entry| entry.1);
        }
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
    pub fn binding_kind(&self, symbol: SymbolId) -> BindingKind {
        let kind = self.runtime.declarations.binding_kinds.get(symbol.idx());
        kind.copied().unwrap_or(BindingKind::NoBinding)
    }

    pub fn symbol_scope(&self, symbol: SymbolId) -> ScopeId {
        let scope = self.runtime.declarations.symbol_scopes.get(symbol.idx());
        scope.copied().unwrap_or(ScopeId::NONE)
    }

    pub fn function_flags(&self, function: FnId) -> FunctionFlags {
        let flags = self.runtime.function_flags.get(function.idx());
        flags.copied().unwrap_or_default()
    }

    /// Unless each of its parameters is a plain name, a function keeps what text evaluated in its body declares in an environment of its own, inside the environment of its parameters and `arguments`. With expressions among the parameters the variables of the body's own code are kept there too; without, they are the parameters of their names.
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
        if hir[class].name.is_some() {
            self.scopes[around_class.idx()].parent
        } else {
            around_class
        }
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

    pub(super) fn declared_pattern_symbol(&self, pattern: PatId) -> SymbolId {
        let declared = &self.runtime.declarations.declared_symbols;
        find_symbol(declared, Decl::Var(pattern))
            .unwrap_or_else(|| self.file_binding(self.pat_symbol[pattern.idx()]))
    }

    /// `var v` beside `export var v` in a file declares the exported binding again.
    fn file_binding(&self, declared: SymbolId) -> SymbolId {
        if declared.is_none() {
            return declared;
        }
        let exported = self.export_symbol_of_value_symbol_if_exported(declared);
        match self.symbol(exported).parent == self.file_symbol {
            true => exported,
            false => declared,
        }
    }

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
                .unwrap_or_else(|| declaration_symbol(self, decl)),
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

    pub fn annex_b_functions(&self) -> &[AnnexBFunction] {
        &self.declarations.annex_b_functions
    }

    pub fn parameter_var_copies(&self) -> &[ParameterVarCopy] {
        &self.declarations.parameter_var_copies
    }

    pub fn implicit_references(&self) -> &[ImplicitReference] {
        &self.references.implicit_references
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
        let references = &self.runtime.references;
        let run = ident.idx() / IDENTS_IN_RUN;
        let entries = match references.ident_binding_runs.get(run..run + 2) {
            Some(&[start, end]) => &references.ident_bindings[start as usize..end as usize],
            _ => &[],
        };
        match entries.iter().find(|entry| entry.0 == ident) {
            Some(&(_, binding)) => self.binding_under_goal(binding),
            None => self.default_binding(ident),
        }
    }

    /// The record of `head` at `root`. `None`: `root` is not evaluated, or `head` is free and no `with` object or evaluated text may declare it.
    pub fn define_head(&self, root: ExprId, head: Atom) -> Option<&ImplicitReference> {
        let references = self.runtime.implicit_references();
        let root_of = |reference: &ImplicitReference| match (reference.kind, reference.node) {
            (ImplicitReferenceKind::DefineHead, NodeData::Expr(recorded)) => Some(recorded),
            _ => None,
        };
        // The define heads are the first records, in the order of their roots.
        let first = references.partition_point(|reference| {
            root_of(reference).is_some_and(|recorded| recorded < root)
        });
        let mut at_root = references[first..]
            .iter()
            .take_while(|&reference| root_of(reference) == Some(root));
        at_root.find(|reference| reference.name == head)
    }

    /// The records that `define_head` answers with, whether or not the fold applies a define where each is recorded. `Decisions::applied_define_heads` answers with those it applied.
    pub(crate) fn define_heads(&self) -> &[ImplicitReference] {
        let references = self.runtime.implicit_references();
        let is_define_head =
            |reference: &ImplicitReference| reference.kind == ImplicitReferenceKind::DefineHead;
        // The define heads are the first records, so a file without one is known by its first record and searches nothing.
        if !references.first().is_some_and(is_define_head) {
            return &[];
        }
        &references[..references.partition_point(is_define_head)]
    }

    /// Whether the lookup of `reference` stepped over a namespace or enum member or the import of a macro: `bun run` counts the use for that.
    pub fn is_define_head_behind_member(&self, reference: &ImplicitReference) -> bool {
        let behind = &self.runtime.references.define_heads_behind_members;
        has_define_head(behind, reference)
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

    /// False for `export default Name` where `Name` is only a type: the statement has no code, and it gives the file no export.
    pub fn exports_value(&self, statement: StmtId) -> bool {
        let declared = &self.runtime.declarations.declared_symbols;
        find_symbol(declared, Decl::ExportExpr(statement)) != Some(SymbolId::NONE)
    }

    pub fn has_runtime_value(&self, symbol: SymbolId) -> bool {
        !has_bit(&self.runtime.declarations.valueless_symbols, symbol.idx())
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
                let has_dead_zone = scope.is_none_or(|scope| {
                    let ScopeKind::Fn(function) = scope.kind else {
                        return true;
                    };
                    let flags = self.function_flags(function);
                    flags.contains(FunctionFlags::HAS_PARAMETER_EXPRESSIONS)
                });
                match has_dead_zone {
                    true => InitialState::Uninitialized,
                    false => InitialState::Initialized,
                }
            }
            _ => InitialState::Uninitialized,
        }
    }

    pub fn initialized_binding(&self, name: PatId) -> Binding {
        self.binding_under_goal(self.initialized_pattern_binding(name))
    }

    pub fn dynamic_lookup_scope(&self, node: NodeData) -> Option<ScopeId> {
        let references = &self.runtime.references;
        if references.dynamic_ident_lookups.is_empty()
            && references.dynamic_declarator_lookups.is_empty()
        {
            return None;
        }
        match node {
            NodeData::Expr(ident) => find_entry(&references.dynamic_ident_lookups, ident).copied(),
            NodeData::Pat(name) => {
                find_entry(&references.dynamic_declarator_lookups, name).copied()
            }
            _ => None,
        }
    }

    /// The first scope that a dynamic lookup of `ident`, whose binding is declared in `declaring_scope`, does not search.
    pub fn dynamic_lookup_end(&self, ident: ExprId, declaring_scope: ScopeId) -> ScopeId {
        let behind_variables = &self.runtime.references.idents_behind_eval_variables;
        match has_bit(behind_variables, ident.idx()) {
            true => self.scopes[declaring_scope.idx()].parent,
            false => declaring_scope,
        }
    }

    /// Where the name of a define head is looked for when the program runs. `None`: no `with` object or evaluated text may declare it there.
    pub fn dynamic_scope_of(&self, reference: &ImplicitReference) -> Option<DynamicLookup> {
        find_reference_lookup(&self.runtime.references.dynamic_implicit_lookups, reference)
    }

    pub fn own_scope(&self, stmt: StmtId) -> ScopeId {
        self.runtime.declarations.created_scope(stmt)
    }

    pub fn field_initializer_scope(&self, member: MemberId) -> Option<ScopeId> {
        find_entry(&self.runtime.field_initializer_scopes, member).copied()
    }

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

    pub fn import_meta_may_be_modified(&self) -> bool {
        self.runtime.import_meta_may_be_modified
    }

    /// The file writes `import.meta`, or a `require`, a `module` or a `__filename` that is the file's own. Without one of them no expression in it
    /// is the file's `require`, one made for the file, or `import.meta.require`.
    pub fn may_name_own_require(&self) -> bool {
        self.runtime.may_name_own_require
    }

    pub fn stores_to(&self, symbol: SymbolId) -> &[SymbolStore] {
        let stores = &self.runtime.references.stores[..];
        let start = stores.partition_point(|store| store.symbol < symbol);
        let len = stores[start..].partition_point(|store| store.symbol == symbol);
        &stores[start..start + len]
    }

    pub fn is_store_target(&self, ident: ExprId) -> bool {
        has_bit(&self.runtime.references.store_targets, ident.idx())
    }

    pub fn is_visible_to_eval(&self, symbol: SymbolId) -> bool {
        has_bit(&self.runtime.references.eval_visible_symbols, symbol.idx())
    }

    pub fn eval_scope(&self, call: ExprId) -> Option<&EvalScope> {
        find_entry(&self.runtime.references.eval_scopes, call)
    }

    pub fn binding_stability_ignoring(
        &self,
        symbol: SymbolId,
        is_dead_store: &dyn Fn(ExprId) -> bool,
    ) -> BindingStability {
        let recorded = self.runtime.stability.stabilities.get(symbol.idx());
        let recorded = recorded.copied().unwrap_or_default();
        if recorded != BindingStability::Stable || self.binding_kind(symbol).is_immutable() {
            return recorded;
        }
        let mut stores = self.stores_to(symbol).iter();
        match stores.any(|store| !is_dead_store(store.target)) {
            true => BindingStability::Stored,
            false => BindingStability::Stable,
        }
    }

    pub fn binding_stability(&self, symbol: SymbolId) -> BindingStability {
        self.binding_stability_ignoring(symbol, &|_| false)
    }

    pub fn is_stable_binding(&self, symbol: SymbolId) -> bool {
        self.binding_stability(symbol) == BindingStability::Stable
    }

    pub fn binding_initializer(&self, hir: &File<'_>, symbol: SymbolId) -> BindingInitializer {
        stability::find_binding_initializer(hir, self, symbol)
    }

    /// `None` if several declarations initialize the binding, or none does.
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
        // A define whose value begins with the name reads it where no identifier spells it.
        let mut define_heads = self.define_heads().iter();
        let mut idents = (0..hir.exprs.len() as u32).map(ExprId);
        define_heads.any(|head| head.binding == own_name)
            || idents.any(|ident| self.is_evaluated_ident(ident) && self.binding(ident) == own_name)
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

#[cfg(test)]
mod tests {
    use super::super::{Binding, ImplicitReference, ImplicitReferenceKind, RuntimeTablesIn};
    use super::has_define_head;
    use crate::atom::known;
    use crate::hir::*;

    #[test]
    fn define_head_behind_a_member_is_found_by_its_root_and_name() {
        let reference = |root, kind, name| ImplicitReference {
            node: NodeData::Expr(ExprId(root)),
            kind,
            name,
            binding: Binding::Free,
        };
        let define_head = |root, name| reference(root, ImplicitReferenceKind::DefineHead, name);
        let mut tables = RuntimeTablesIn::<Growable>::default();
        // The binder looks at every `import.meta` after the identifiers, so it does not add the roots in their order.
        tables.references.define_heads_behind_members = vec![
            (ExprId(9), known::Object),
            (ExprId(6), known::React),
            (ExprId(6), known::Object),
        ];
        assert!(!tables.is_sorted());
        tables.sort();
        assert!(tables.is_sorted());
        let behind = &tables.references.define_heads_behind_members[..];
        let is_behind = |wanted: ImplicitReference| has_define_head(behind, &wanted);
        assert!(is_behind(define_head(9, known::Object)));
        assert!(is_behind(define_head(6, known::React)));
        assert!(is_behind(define_head(6, known::Object)));
        assert!(!is_behind(define_head(9, known::React)));
        assert!(!is_behind(define_head(7, known::Object)));
        let factory = reference(6, ImplicitReferenceKind::JsxFactory, known::React);
        assert!(!is_behind(factory));
    }
}
