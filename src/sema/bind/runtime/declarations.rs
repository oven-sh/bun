use super::binding_kinds::record_declared_binding_kinds;
use super::bits::{has_bit, insert_bit};
use super::declaration_kinds::{
    Declaration, DeclarationKind, creates_binding, declaration_kind, declaration_symbol,
    has_parameter_expressions,
};
use super::duplicate_names::find_duplicate_names;
use super::{
    BindingKind, CodeUnit, EarlyRedeclaration, FunctionFlags, RuntimeInput, RuntimeScopes,
};
use crate::atom::{Atom, known};
use crate::bind::{
    BoundBuilder, Decl, GrowingDecls, GrowingSymbol, ScopeId, ScopeKind, SymFlags, SymbolId,
    TableId,
};
use crate::hir::*;
use crate::util::{FxHashMap, FxHashSet, SharedSort};

impl RuntimeScopes {
    pub(super) fn is_scope_binding(&self, bound: &BoundBuilder, symbol: SymbolId) -> bool {
        let flags = bound.symbols[symbol.idx()].flags;
        !has_bit(&bound.runtime.declarations.valueless_symbols, symbol.idx())
            && !has_bit(&self.hidden_symbols, symbol.idx())
            && !flags.contains(SymFlags::MODULE_EXPORTS)
            && flags.intersects(SymFlags::VALUE | SymFlags::EXPORT_VALUE | SymFlags::ALIAS)
    }
}

enum StatementEntry {
    OwnScope(ScopeId),
    ExportExpression(Atom),
    None,
}

pub(super) fn compute_declarations(input: &mut RuntimeInput<'_, '_>) -> RuntimeScopes {
    let mut declarations = Declarations {
        hir: input.hir,
        bound: &mut *input.bound,
        scopes: RuntimeScopes::default(),
        body_variable_symbols: FxHashMap::default(),
        parameters_with_body_function: FxHashSet::default(),
        redeclarations: Vec::new(),
        module_only_redeclarations: Vec::new(),
    };
    declarations.compute_scope_tables();
    declarations.compute_symbol_tables();
    declarations.compute_statement_tables();
    declarations.compute_import_symbols();
    declarations.compute_parameter_expressions();
    declarations.merge_declarations();
    declarations.check_hoisted_vars();
    declarations.check_catch_parameters();
    declarations.create_body_variables();
    declarations.hoist_block_functions();
    declarations.create_class_bindings();
    declarations.check_duplicate_names();
    declarations.finish()
}

pub(super) fn append_symbol(
    bound: &mut BoundBuilder,
    name: Atom,
    flags: SymFlags,
    kind: BindingKind,
    decl: Decl,
    scope: ScopeId,
) -> SymbolId {
    let symbol = SymbolId(bound.symbols.len() as u32);
    bound.symbols.push(GrowingSymbol {
        name,
        flags,
        decls: GrowingDecls::One(decl),
        value_declaration: 0,
        parent: SymbolId::NONE,
        exports: TableId::NONE,
        members: TableId::NONE,
        export_symbol: SymbolId::NONE,
    });
    bound.runtime.declarations.symbol_scopes.push(scope);
    bound.runtime.declarations.binding_kinds.push(kind);
    symbol
}

pub(super) fn is_var_scope(kind: ScopeKind) -> bool {
    matches!(
        kind,
        ScopeKind::File | ScopeKind::Fn(_) | ScopeKind::Module(_)
    )
}

pub(super) fn scope_boundary(hir: &File<'_>, kind: ScopeKind) -> (Option<CodeUnit>, Option<bool>) {
    match kind {
        ScopeKind::File => (Some(CodeUnit::File), Some(hir.is_strict)),
        ScopeKind::Fn(f) => (Some(CodeUnit::Function(f)), Some(hir[f].is_strict)),
        ScopeKind::FieldInitializer(m) => (Some(CodeUnit::FieldInitializer(m)), None),
        ScopeKind::Class(_) => (None, Some(true)),
        _ => (None, None),
    }
}

fn has_local_value(hir: &File<'_>, bound: &BoundBuilder, symbol: SymbolId) -> bool {
    bound.symbols[symbol.idx()].decls.iter().any(|&decl| {
        let kind = declaration_kind(hir, bound, decl);
        kind.binds_in_table_scope() && kind != DeclarationKind::Import
    })
}

fn find_import_equals_symbols(hir: &File<'_>, bound: &BoundBuilder) -> Vec<SymbolId> {
    let mut symbols = vec![SymbolId::NONE; hir.import_equals.len()];
    if symbols.is_empty() {
        return symbols;
    }
    for (index, symbol) in bound.symbols.iter().enumerate() {
        for &decl in symbol.decls.iter() {
            if let Decl::ImportEquals(import) = decl {
                symbols[import.idx()] = SymbolId(index as u32);
            }
        }
    }
    symbols
}

pub(super) struct Declarations<'a, 's> {
    pub(super) hir: &'a File<'s>,
    pub(super) bound: &'a mut BoundBuilder,
    pub(super) scopes: RuntimeScopes,
    pub(super) body_variable_symbols: FxHashMap<SymbolId, SymbolId>,
    pub(super) parameters_with_body_function: FxHashSet<SymbolId>,
    pub(super) redeclarations: Vec<EarlyRedeclaration>,
    pub(super) module_only_redeclarations: Vec<EarlyRedeclaration>,
}

impl Declarations<'_, '_> {
    fn compute_scope_tables(&mut self) {
        let hir = self.hir;
        let mut units: Vec<CodeUnit> = Vec::with_capacity(self.bound.scopes.len());
        let mut strict_scopes = Vec::new();
        let mut field_initializer_scopes = Vec::new();
        for (index, scope) in self.bound.scopes.iter().enumerate() {
            let (unit, is_strict) = scope_boundary(hir, scope.kind);
            if let Some(CodeUnit::FieldInitializer(member)) = unit {
                field_initializer_scopes.push((member, ScopeId(index as u32)));
            }
            let parent = self
                .bound
                .runtime_parent_scope(hir, ScopeId(index as u32))
                .some();
            let inherited = parent.map_or(CodeUnit::File, |parent| units[parent.idx()]);
            units.push(unit.unwrap_or(inherited));
            let is_strict = is_strict.unwrap_or_else(|| {
                parent.is_some_and(|parent| has_bit(&strict_scopes, parent.idx()))
            });
            if is_strict {
                insert_bit(&mut strict_scopes, index);
            }
        }
        self.bound.runtime.declarations.scope_units = units;
        self.bound.runtime.field_initializer_scopes = field_initializer_scopes;
        self.scopes.strict_scopes = strict_scopes;
    }

    pub(super) fn is_sloppy(&mut self, scope: ScopeId) -> bool {
        let is_sloppy = !has_bit(&self.scopes.strict_scopes, scope.idx());
        self.bound.runtime.depends_on_sloppy_mode |= is_sloppy;
        is_sloppy
    }

    fn compute_symbol_tables(&mut self) {
        let hir = self.hir;
        let bound = &*self.bound;
        let mut valueless_symbols = Vec::new();
        for (index, symbol) in bound.symbols.iter().enumerate() {
            let decls = &symbol.decls[..];
            if !decls.is_empty() && !decls.iter().any(|&d| creates_binding(hir, bound, d)) {
                insert_bit(&mut valueless_symbols, index);
            }
        }
        for this_param in hir.fns.iter().filter_map(|func| func.this_param.some()) {
            if let Some(symbol) = bound.pat_symbol[hir[this_param].pat.idx()].some() {
                insert_bit(&mut valueless_symbols, symbol.idx());
            }
        }
        let mut symbol_scopes = vec![ScopeId::NONE; bound.symbols.len()];
        for (index, scope) in bound.scopes.iter().enumerate() {
            for &(_, symbol) in bound.table(scope.locals) {
                for owner in [symbol, bound.symbols[symbol.idx()].export_symbol] {
                    if let Some(entry) = symbol_scopes.get_mut(owner.idx())
                        && entry.is_none()
                    {
                        *entry = ScopeId(index as u32);
                    }
                }
            }
        }
        for redeclaration in bound.redeclarations.iter() {
            let rejected = declaration_symbol(bound, redeclaration.decl);
            if rejected.is_some() {
                symbol_scopes[rejected.idx()] = symbol_scopes[redeclaration.symbol.idx()];
            }
        }
        let binding_kinds = vec![BindingKind::NoBinding; bound.symbols.len()];
        let declarations = &mut self.bound.runtime.declarations;
        declarations.valueless_symbols = valueless_symbols;
        declarations.symbol_scopes = symbol_scopes;
        declarations.binding_kinds = binding_kinds;
    }

    pub(super) fn implicit_block_scope(&self, function: FnId) -> ScopeId {
        let scopes = &self.bound.scopes;
        let top = scopes.get(self.bound.fns[function.idx()].scope.idx());
        let around = top.map_or(ScopeId::NONE, |top| top.parent);
        let kind = scopes.get(around.idx()).map(|scope| scope.kind);
        match kind == Some(ScopeKind::ImplicitBlock(function)) {
            true => around,
            false => ScopeId::NONE,
        }
    }

    fn statement_entry(&self, statement: StmtId) -> StatementEntry {
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::Fn(function) => StatementEntry::OwnScope(self.implicit_block_scope(function)),
            StmtKind::Block(list) if list.is_empty() => StatementEntry::None,
            StmtKind::Block(list) => {
                StatementEntry::OwnScope(self.bound.scope_of_stmt(hir.id_at(list, 0)))
            }
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::With { body, .. } => {
                StatementEntry::OwnScope(self.bound.scope_of_stmt(body))
            }
            StmtKind::Try { handler, .. } => {
                StatementEntry::OwnScope(self.bound.scope_of_stmt(handler))
            }
            StmtKind::Switch { cases, .. } => {
                let clause = cases.iter().find(|&case| !hir[case].body.is_empty());
                clause.map_or(StatementEntry::None, |case| {
                    StatementEntry::OwnScope(self.bound.scope_of_stmt(hir.id_at(hir[case].body, 0)))
                })
            }
            StmtKind::ExportDefault(_) => StatementEntry::ExportExpression(known::default),
            StmtKind::ExportAssign(_) => StatementEntry::ExportExpression(known::export_equals),
            _ => StatementEntry::None,
        }
    }

    fn container_export(&self, scope: ScopeId, name: Atom) -> Option<SymbolId> {
        let bound = &*self.bound;
        let container = bound.scopes[bound.container_scope(scope).idx()]
            .symbol
            .some()?;
        bound.find_in_table(bound.symbols[container.idx()].exports, name)
    }

    fn compute_statement_tables(&mut self) {
        let mut own_scopes = Vec::new();
        let mut declared_symbols = Vec::new();
        for (index, &scope) in self.bound.stmt_scope.iter().enumerate() {
            if scope.is_none() {
                continue;
            }
            let statement = StmtId(index as u32);
            match self.statement_entry(statement) {
                StatementEntry::OwnScope(created) if created.is_some() => {
                    own_scopes.push((statement, created));
                }
                StatementEntry::ExportExpression(name) => {
                    let symbol = self.container_export(scope, name);
                    let decl = Decl::ExportExpr(statement);
                    declared_symbols.extend(symbol.map(|symbol| (decl, symbol)));
                }
                StatementEntry::OwnScope(_) | StatementEntry::None => {}
            }
        }
        let declarations = &mut self.bound.runtime.declarations;
        declarations.own_scopes = own_scopes;
        declarations.declared_symbols = declared_symbols;
    }

    fn compute_import_symbols(&mut self) {
        let hir = self.hir;
        let bound = &*self.bound;
        let mut defaults = vec![SymbolId::NONE; hir.imports.len()];
        let mut namespaces = vec![SymbolId::NONE; hir.imports.len()];
        let mut specifiers = vec![SymbolId::NONE; hir.import_specs.len()];
        for (index, &scope) in bound.import_scope.iter().enumerate() {
            if scope.is_none() {
                continue;
            }
            let import = &hir[ImportId(index as u32)];
            let locals = bound.scopes[bound.container_scope(scope).idx()].locals;
            let find = |name: Atom| {
                let symbol = name
                    .is_some()
                    .then(|| bound.find_in_table(locals, name))
                    .flatten();
                let symbol = symbol.filter(|&it| hir.is_js || !has_local_value(hir, bound, it));
                symbol.unwrap_or(SymbolId::NONE)
            };
            defaults[index] = find(import.default);
            namespaces[index] = find(import.namespace);
            for specifier in import.named.iter() {
                specifiers[specifier.idx()] = find(hir[specifier].local);
            }
        }
        let import_equals = find_import_equals_symbols(hir, bound);
        let declarations = &mut self.bound.runtime.declarations;
        declarations.import_default_symbols = defaults;
        declarations.import_namespace_symbols = namespaces;
        declarations.import_spec_symbols = specifiers;
        declarations.import_equals_symbols = import_equals;
    }

    fn compute_parameter_expressions(&mut self) {
        let hir = self.hir;
        let mut pending = Vec::new();
        let mut flags = vec![FunctionFlags::empty(); hir.fns.len()];
        for (index, func) in hir.fns.iter().enumerate() {
            if !matches!(func.body, FnBody::None)
                && has_parameter_expressions(hir, func, &mut pending)
            {
                flags[index] = FunctionFlags::HAS_PARAMETER_EXPRESSIONS;
            }
        }
        self.bound.runtime.function_flags = flags;
    }

    fn visible_symbol(&self, scope: ScopeId, name: Atom) -> Option<SymbolId> {
        let bound = &*self.bound;
        let symbol = bound.find_in_table(bound.scopes[scope.idx()].locals, name)?;
        self.scopes
            .is_scope_binding(bound, symbol)
            .then_some(symbol)
    }

    pub(super) fn first_table_scope_binding(&self, symbol: SymbolId) -> Option<Declaration> {
        let (hir, bound) = (self.hir, &*self.bound);
        let decls = bound.symbols[symbol.idx()].decls.iter();
        let mut declarations = decls.map(|&decl| Declaration::new(hir, bound, decl));
        declarations.find(|declaration| declaration.kind.binds_in_table_scope())
    }

    pub(super) fn visible_binding(
        &self,
        scope: ScopeId,
        name: Atom,
    ) -> Option<(SymbolId, Declaration)> {
        if let Some(symbol) = self.visible_symbol(scope, name)
            && let Some(first) = self.first_table_scope_binding(symbol)
        {
            return Some((symbol, first));
        }
        self.scopes.appended_bindings.get(&(scope, name)).copied()
    }

    pub(super) fn append_binding(
        &mut self,
        scope: ScopeId,
        name: Atom,
        flags: SymFlags,
        kind: BindingKind,
        declaration: Declaration,
    ) -> SymbolId {
        let symbol = append_symbol(self.bound, name, flags, kind, declaration.decl, scope);
        self.scopes
            .appended_bindings
            .insert((scope, name), (symbol, declaration));
        symbol
    }

    fn check_duplicate_names(&mut self) {
        self.redeclarations
            .extend(find_duplicate_names(self.hir, self.bound));
    }

    fn finish(mut self) -> RuntimeScopes {
        self.scopes
            .body_variables
            .shared_sort_by_key(|entry| entry.0);
        let declarations = &mut self.bound.runtime.declarations;
        declarations.goal_independent_redeclaration_count = self.redeclarations.len() as u32;
        self.redeclarations
            .append(&mut self.module_only_redeclarations);
        declarations.early_redeclarations = self.redeclarations;
        self.bound.runtime.sort();
        record_declared_binding_kinds(self.hir, self.bound);
        self.scopes
    }
}
