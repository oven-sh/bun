use super::bits::{has_bit, insert_bit};
use super::declarations::is_var_scope;
use super::lookup::{is_appended_visible, is_global_of_script};
use super::queries::is_among_parameters;
use super::references::ReferencePass;
use super::stores::find_outermost_cast;
use super::type_only_code::TypeOnlyCode;
use super::{Binding, BindingKind, CodeUnit, EvalScope, RuntimeScopes};
use crate::atom::{Atom, Intern, known};
use crate::bind::{BoundBuilder, Parent, ScopeId, ScopeKind, SymbolId};
use crate::hir::*;
use crate::util::{FxHashMap, FxHashSet, SharedSort};
use bun_core::strings::contains;

#[derive(Copy, Clone)]
pub(super) struct DirectEval {
    call: ExprId,
    scope: ScopeId,
    pub is_sloppy: bool,
}

/// The string that the call evaluates, if the file spells it.
fn find_evaluated_literal(hir: &File<'_>, call: ExprId) -> Option<Atom> {
    let ExprKind::Call(site) = hir[call].kind else {
        return None;
    };
    let first = hir.ids(hir[site].args).next()?;
    match hir[hir.skip_type_assertions(first)].kind {
        ExprKind::String(text) => Some(text),
        _ => None,
    }
}

/// A nested eval declares variables too, and an escape spells a name in another way.
fn may_declare(text: &[u8], name: &[u8]) -> bool {
    contains(text, name) || contains(text, b"eval") || contains(text, b"\\")
}

pub(super) fn find_direct_evals(
    hir: &File<'_>,
    bound: &BoundBuilder,
    idents: &[(ExprId, ScopeId)],
    scopes: &RuntimeScopes,
    type_only: &TypeOnlyCode,
) -> Vec<DirectEval> {
    let mut direct_evals = Vec::new();
    for &(ident, scope) in idents {
        if !matches!(hir[ident].kind, ExprKind::Ident(name) if name == known::eval)
            || type_only.has_expr(ident, scope)
        {
            continue;
        }
        if let Some(call) = find_call_of_name(hir, bound, ident)
            && !matches!(hir[call].kind, ExprKind::Call(site) if hir.is_settled_eval(site))
        {
            direct_evals.push(DirectEval {
                call,
                scope,
                is_sloppy: !has_bit(&scopes.strict_scopes, scope.idx()),
            });
        }
    }
    direct_evals
}

pub(super) fn find_call_of_name(
    hir: &File<'_>,
    bound: &BoundBuilder,
    ident: ExprId,
) -> Option<ExprId> {
    let callee = find_outermost_cast(hir, bound, ident);
    let Parent::Expr(parent) = bound.parent_of_expr(callee) else {
        return None;
    };
    let ExprKind::Call(c) = hir[parent.some()?].kind else {
        return None;
    };
    let call = &hir[c];
    (call.callee == callee && call.chain == Chain::No).then_some(parent)
}

#[derive(Default)]
pub(super) struct DynamicScopes {
    pub scopes: Vec<u64>,
    pub parameter_eval_scopes: Vec<u64>,
    /// What the evals that declare variables in a scope evaluate, where the file spells all of it.
    literals: FxHashMap<ScopeId, Vec<Atom>>,
    /// The evals that run at most once in an activation, by the scope that they declare variables in.
    only_evals: FxHashMap<ScopeId, CallId>,
}

impl DynamicScopes {
    /// Whether the code at `pos` is in a known text of the only eval that declares variables in `scope`. The text is an
    /// expression, so that an activation has no variables of evals while the code runs.
    pub(super) fn is_in_only_eval(&self, hir: &File<'_>, scope: ScopeId, pos: u32) -> bool {
        let Some(&call) = self.only_evals.get(&scope) else {
            return false;
        };
        let mut known = hir.known_evaluations_of(call).iter();
        known.any(|it| !it.is_in_global_scope && (it.start..it.end).contains(&pos))
    }

    /// `scope` has sloppy direct evals.
    pub(super) fn may_declare(&self, atoms: &dyn Intern, scope: ScopeId, name: Atom) -> bool {
        let Some(literals) = self.literals.get(&scope) else {
            return true;
        };
        let mut literals = literals.iter();
        literals.any(|&text| may_declare(atoms.bytes(text), atoms.bytes(name)))
    }
}

/// Whether a statement of `function` runs what is at `pos` again.
fn is_in_loop(hir: &File<'_>, function: FnId, pos: u32) -> bool {
    hir.stmts.iter().any(|statement| {
        let is_loop = matches!(
            statement.kind,
            StmtKind::For { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::ForIn { .. }
        );
        is_loop
            && (statement.start..statement.loc.end).contains(&pos)
            && statement.start > hir[function].start
    })
}

pub(super) fn compute_dynamic_scopes(
    hir: &File<'_>,
    bound: &BoundBuilder,
    direct_evals: &[DirectEval],
) -> DynamicScopes {
    let mut dynamic = DynamicScopes::default();
    for (index, scope) in bound.scopes.iter().enumerate() {
        if matches!(scope.kind, ScopeKind::With(_)) {
            insert_bit(&mut dynamic.scopes, index);
        }
    }
    let mut unknown: FxHashSet<ScopeId> = FxHashSet::default();
    let mut evals_by_scope: FxHashMap<ScopeId, (CallId, usize)> = FxHashMap::default();
    for eval in direct_evals.iter().filter(|eval| eval.is_sloppy) {
        let (mut at, mut from) = (eval.scope, ScopeKind::Block);
        while at.is_some() && !is_var_scope(bound.scopes[at.idx()].kind) {
            from = bound.scopes[at.idx()].kind;
            at = bound.scopes[at.idx()].parent;
        }
        if at.is_none() {
            continue;
        }
        let is_among_parameters = matches!(bound.scopes[at.idx()].kind, ScopeKind::Fn(function)
            if is_among_parameters(hir, function, from, hir[eval.call].pos));
        if is_among_parameters {
            insert_bit(&mut dynamic.parameter_eval_scopes, at.idx());
        } else {
            insert_bit(&mut dynamic.scopes, at.idx());
        }
        if let ExprKind::Call(call) = hir[eval.call].kind {
            let entry = evals_by_scope.entry(at).or_insert((call, 0));
            entry.1 += 1;
        }
        match find_evaluated_literal(hir, eval.call) {
            Some(text) => dynamic.literals.entry(at).or_default().push(text),
            None => {
                unknown.insert(at);
            }
        }
    }
    dynamic.literals.retain(|scope, _| !unknown.contains(scope));
    for (scope, (call, count)) in evals_by_scope {
        if let ScopeKind::Fn(function) = bound.scopes[scope.idx()].kind
            && count == 1
            && !hir.known_evaluations_of(call).is_empty()
            && !is_in_loop(hir, function, hir[hir[call].callee].pos)
        {
            dynamic.only_evals.insert(scope, call);
        }
    }
    dynamic
}

impl ReferencePass<'_, '_> {
    pub(super) fn collect_eval_scopes(&mut self) {
        if self.direct_evals.is_empty() {
            return;
        }
        let bindings = self.lookup.scopes.appended_bindings.iter();
        let mut appended: Vec<_> = bindings.map(|(key, entry)| (key.0, entry.0)).collect();
        appended.shared_sort_unstable();
        let mut evals_in_scope: FxHashMap<ScopeId, usize> = FxHashMap::default();
        for eval in &self.direct_evals {
            *evals_in_scope.entry(eval.scope).or_default() += 1;
        }
        type Lists = (IdList<SymbolId>, IdList<SymbolId>);
        let mut symbol_lists: FxHashMap<ScopeId, Lists> = FxHashMap::default();
        let mut evals_that_hide: FxHashMap<Atom, usize> = FxHashMap::default();
        let bound = self.lookup.bound;
        let file_scope = self.find_file_scope(self.direct_evals[0].scope);
        let names_of_file = file_scope.some().map_or(&[][..], |file_scope| {
            bound.table(bound.scopes[file_scope.idx()].locals)
        });
        for index in 0..self.direct_evals.len() {
            let eval = self.direct_evals[index];
            symbol_lists.entry(eval.scope).or_insert_with(|| {
                let (symbols, names) = self.append_eval_symbols(eval, &appended);
                let eval_count = evals_in_scope[&eval.scope];
                let mut note = |name: Atom| *evals_that_hide.entry(name).or_default() += eval_count;
                if names.len() <= names_of_file.len() {
                    names.into_iter().for_each(note);
                } else {
                    let names_of_file = names_of_file.iter().map(|entry| entry.0);
                    names_of_file
                        .filter(|name| names.contains(name))
                        .for_each(&mut note);
                }
                (symbols, self.append_constructor_symbols(eval, &appended))
            });
        }
        let eval_count = self.direct_evals.len();
        evals_that_hide.retain(|_, count| *count == eval_count);
        let hidden_from_every_eval: FxHashSet<Atom> = evals_that_hide.into_keys().collect();
        let file_symbols = self.append_file_symbols(file_scope, &appended, hidden_from_every_eval);
        for index in 0..self.direct_evals.len() {
            let eval = self.direct_evals[index];
            let (symbols, constructor_symbols) = symbol_lists[&eval.scope];
            let is_in_global_code = self.is_in_global_code(eval.scope);
            let eval_scope = EvalScope {
                scope: eval.scope,
                symbols,
                file_symbols: match is_in_global_code {
                    true => IdList::EMPTY,
                    false => file_symbols,
                },
                constructor_symbols,
                is_sloppy: eval.is_sloppy,
                is_in_global_code,
            };
            self.references.eval_scopes.push((eval.call, eval_scope));
            self.note_eval_functions(eval.scope);
        }
    }

    fn append_eval_symbols(
        &mut self,
        eval: DirectEval,
        appended: &[(ScopeId, SymbolId)],
    ) -> (IdList<SymbolId>, FxHashSet<Atom>) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let first = self.eval_symbol_ids.len();
        let mut seen: FxHashSet<Atom> = FxHashSet::default();
        let (mut at, mut from) = (eval.scope, ScopeKind::Block);
        while at.is_some() && !matches!(bound.scopes[at.idx()].kind, ScopeKind::File) {
            self.list_names_of_scope(at, from, eval.is_sloppy, appended, &mut seen);
            from = bound.scopes[at.idx()].kind;
            if self.lookup.global_code_of(from).is_some() {
                break;
            }
            at = bound.runtime_parent_scope(hir, at);
        }
        let count = self.eval_symbol_ids.len() - first;
        let symbols = IdList::new(self.first_eval_id + first as u32, count as u32);
        (symbols, seen)
    }

    fn is_in_global_code(&self, start: ScopeId) -> bool {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let mut at = start;
        while at.is_some() {
            if self
                .lookup
                .global_code_of(bound.scopes[at.idx()].kind)
                .is_some()
            {
                return true;
            }
            at = bound.runtime_parent_scope(hir, at);
        }
        false
    }

    fn find_file_scope(&self, mut at: ScopeId) -> ScopeId {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        while at.is_some() && !matches!(bound.scopes[at.idx()].kind, ScopeKind::File) {
            at = bound.runtime_parent_scope(hir, at);
        }
        at
    }

    fn append_file_symbols(
        &mut self,
        file_scope: ScopeId,
        appended: &[(ScopeId, SymbolId)],
        mut hidden_from_every_eval: FxHashSet<Atom>,
    ) -> IdList<SymbolId> {
        let first = self.eval_symbol_ids.len();
        if file_scope.is_some() {
            let seen = &mut hidden_from_every_eval;
            self.list_names_of_scope(file_scope, ScopeKind::Block, false, appended, seen);
        }
        let count = self.eval_symbol_ids.len() - first;
        IdList::new(self.first_eval_id + first as u32, count as u32)
    }

    fn list_names_of_scope(
        &mut self,
        at: ScopeId,
        from: ScopeKind,
        is_sloppy: bool,
        appended: &[(ScopeId, SymbolId)],
        seen: &mut FxHashSet<Atom>,
    ) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let scope = &bound.scopes[at.idx()];
        let is_script = self.lookup.global_code_of(scope.kind) == Some(GlobalCode::Script);
        for &(name, local) in bound.table(scope.locals) {
            if is_script && is_global_of_script(hir, bound, local) {
                continue;
            }
            if let Some(binding) = self.lookup.local_binding(scope.kind, from, name, local)
                && !seen.contains(&name)
                && self.lookup.find_container(binding).is_none()
            {
                let is_passed_by_declarations =
                    is_sloppy && self.is_simple_catch_parameter(binding);
                if !is_passed_by_declarations {
                    seen.insert(name);
                }
                self.list_eval_binding(binding);
            }
        }
        let first_appended = appended.partition_point(|entry| entry.0 < at);
        for &(_, symbol) in appended[first_appended..].iter().take_while(|e| e.0 == at) {
            if is_appended_visible(from) && seen.insert(bound.symbols[symbol.idx()].name) {
                let own = bound.own_binding_of_decorated_class(symbol);
                self.list_eval_binding(Binding::Symbol(own.unwrap_or(symbol)));
            }
        }
    }

    fn append_constructor_symbols(
        &mut self,
        eval: DirectEval,
        appended: &[(ScopeId, SymbolId)],
    ) -> IdList<SymbolId> {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let first = self.eval_symbol_ids.len();
        let mut around = eval.scope;
        while around.is_some() {
            if let Some(constructor) = bound.constructor_of_field_value(hir, around) {
                let at = bound.fns[constructor.idx()].scope;
                let scope = &bound.scopes[at.idx()];
                for &(name, local) in bound.table(scope.locals) {
                    let from = ScopeKind::Block;
                    if let Some(binding) = self.lookup.local_binding(scope.kind, from, name, local)
                    {
                        self.list_eval_binding(binding);
                    }
                }
                let first_appended = appended.partition_point(|entry| entry.0 < at);
                for &(_, symbol) in appended[first_appended..].iter().take_while(|e| e.0 == at) {
                    self.list_eval_binding(Binding::Symbol(symbol));
                }
                self.has_direct_eval.push(constructor);
            }
            around = bound.runtime_parent_scope(hir, around);
        }
        let count = self.eval_symbol_ids.len() - first;
        IdList::new(self.first_eval_id + first as u32, count as u32)
    }

    fn is_simple_catch_parameter(&self, binding: Binding) -> bool {
        let Binding::Symbol(symbol) = binding else {
            return false;
        };
        let kinds = &self.lookup.bound.runtime.declarations.binding_kinds;
        kinds.get(symbol.idx()) == Some(&BindingKind::SimpleCatchParameter)
    }

    fn list_eval_binding(&mut self, binding: Binding) {
        let Binding::Symbol(symbol) = binding else {
            return;
        };
        if self.lookup.find_container(binding).is_some() {
            return;
        }
        self.eval_symbol_ids.push(symbol.0);
        insert_bit(&mut self.references.eval_visible_symbols, symbol.idx());
    }

    fn note_eval_functions(&mut self, start: ScopeId) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let mut at = start;
        while at.is_some() {
            let scope = &bound.scopes[at.idx()];
            match scope.kind {
                ScopeKind::Fn(f) => {
                    self.has_direct_eval.push(f);
                    if hir[f].kind != FnKind::Arrow {
                        if bound.has_arguments(hir, f) {
                            self.uses_arguments.push(CodeUnit::Function(f));
                        }
                        return;
                    }
                }
                ScopeKind::File => {
                    self.uses_arguments.push(CodeUnit::File);
                    return;
                }
                ScopeKind::FieldInitializer(_) => {
                    let around = bound.scopes[scope.parent.idx()].kind;
                    if !matches!(around, ScopeKind::ClassDecorators(_)) {
                        return;
                    }
                }
                ScopeKind::Module(_)
                | ScopeKind::Block
                | ScopeKind::Class(_)
                | ScopeKind::Interface(_)
                | ScopeKind::TypeAlias(_)
                | ScopeKind::TypeParams
                | ScopeKind::Enum(_)
                | ScopeKind::TypeParamList(_)
                | ScopeKind::Param(_)
                | ScopeKind::ReturnType(_)
                | ScopeKind::Extends
                | ScopeKind::InferConstraint
                | ScopeKind::StaticMember
                | ScopeKind::ComputedName
                | ScopeKind::BaseExpression
                | ScopeKind::FunctionName(_)
                | ScopeKind::PropertyDeclaration(..)
                | ScopeKind::PropertyType(..)
                | ScopeKind::With(_)
                | ScopeKind::ClassDecorators(_)
                | ScopeKind::ImplicitBlock(_) => {}
            }
            at = bound.runtime_parent_scope(hir, at);
        }
    }
}
