use super::bits::has_bit;
use super::declaration_kinds::{DeclarationKind, declaration_kind};
use super::direct_evals::DynamicScopes;
use super::namespace_exports::is_block_binding;
use super::queries::{find_symbol, is_among_parameters};
use super::{Binding, CodeUnit, CommonJsVariable, RuntimeScopes};
use crate::atom::{Atom, known};
use crate::bind::{BoundBuilder, Scope, ScopeId, ScopeKind, SymFlags, SymbolId};
use crate::hir::*;
use crate::module_format::{ModuleFormat, find_marked_format};

pub(super) const COMMONJS_VARIABLES: [CommonJsVariable; 5] = [
    CommonJsVariable::Module,
    CommonJsVariable::Exports,
    CommonJsVariable::Require,
    CommonJsVariable::Filename,
    CommonJsVariable::Dirname,
];

pub(super) struct Lookup<'a, 's> {
    pub hir: &'a File<'s>,
    pub bound: &'a BoundBuilder,
    pub scopes: &'a RuntimeScopes,
    pub dynamic: DynamicScopes,
}

pub(super) struct Found {
    pub binding: Binding,
    pub scope: ScopeId,
    pub entered_from: ScopeKind,
    pub dynamic_scope: ScopeId,
}

impl Lookup<'_, '_> {
    pub(super) fn find_binding(&self, start: ScopeId, name: Atom) -> Binding {
        self.find(start, name, u32::MAX).binding
    }

    /// `pos` is the position of the mention of `name`.
    pub(super) fn find(&self, start: ScopeId, name: Atom, pos: u32) -> Found {
        let (mut at, mut from, mut dynamic_scope) = (start, ScopeKind::Block, ScopeId::NONE);
        let mut inner = ScopeId::NONE;
        while at.is_some() {
            let scope = &self.bound.scopes[at.idx()];
            if matches!(scope.kind, ScopeKind::With(_)) && dynamic_scope.is_none() {
                dynamic_scope = at;
            }
            if let Some(binding) = self.find_in_scope(at, from, name) {
                return Found {
                    binding,
                    scope: at,
                    entered_from: from,
                    dynamic_scope,
                };
            }
            if dynamic_scope.is_none() && self.has_visible_eval_variables(at, from, pos) {
                // The scope of a parameter says on which side the lookup enters the function.
                dynamic_scope = match from {
                    ScopeKind::Param(_) => inner,
                    _ => at,
                };
            }
            from = scope.kind;
            inner = at;
            at = self.bound.runtime_parent_scope(self.hir, at);
        }
        Found {
            binding: Binding::Free,
            scope: ScopeId::NONE,
            entered_from: from,
            dynamic_scope,
        }
    }

    // Code among the parameters of a function does not see the variables of text evaluated in the body. Code in the body sees the variables of both texts.
    fn has_visible_eval_variables(&self, at: ScopeId, from: ScopeKind, pos: u32) -> bool {
        if has_bit(&self.dynamic.parameter_eval_scopes, at.idx()) {
            return true;
        }
        has_bit(&self.dynamic.scopes, at.idx())
            && !matches!(self.bound.scopes[at.idx()].kind, ScopeKind::Fn(function)
                if is_among_parameters(self.hir, function, from, pos))
    }

    // Text evaluated in the body of a function declares its variables in the environment of the body's variables.
    pub(super) fn is_behind_eval_variables(&self, found: &Found, pos: u32) -> bool {
        if !has_bit(&self.dynamic.scopes, found.scope.idx()) {
            return false;
        }
        let ScopeKind::Fn(function) = self.bound.scopes[found.scope.idx()].kind else {
            return false;
        };
        self.bound.is_outside_body_variables(found.binding)
            && !is_among_parameters(self.hir, function, found.entered_from, pos)
    }

    fn find_in_scope(&self, at: ScopeId, from: ScopeKind, name: Atom) -> Option<Binding> {
        let bound = self.bound;
        let scope = &bound.scopes[at.idx()];
        if let Some(local) = bound.find_in_table(scope.locals, name)
            && let Some(binding) = self.local_binding(scope.kind, from, name, local)
        {
            return Some(binding);
        }
        if is_appended_visible(from)
            && let Some(&(appended, _)) = self.scopes.appended_bindings.get(&(at, name))
        {
            return Some(Binding::Symbol(appended));
        }
        if let Some(member) = self.find_exported_member(at, scope, name) {
            return Some(Binding::Symbol(member));
        }
        if name == known::arguments
            && let Some(binding) = self.find_arguments_object(scope.kind)
        {
            return Some(binding);
        }
        if scope.kind != ScopeKind::File {
            return None;
        }
        let mut variables = COMMONJS_VARIABLES.into_iter();
        let variable = variables.find(|variable| variable.name() == name)?;
        // Bun's transpiler gives an ES module what it reads of the five. A module that the engine gets as written has none.
        let is_written_module = find_marked_format(&self.hir.text) == Some(ModuleFormat::Esm);
        (!is_written_module).then_some(Binding::CommonJs(variable))
    }

    pub(super) fn local_binding(
        &self,
        kind: ScopeKind,
        from: ScopeKind,
        name: Atom,
        local: SymbolId,
    ) -> Option<Binding> {
        let bound = self.bound;
        let flags = bound.symbols[local.idx()].flags;
        let is_from_parameters = matches!(from, ScopeKind::Param(_));
        let is_class_type_parameter = flags.contains(SymFlags::TYPE_PARAMETER)
            && matches!(kind, ScopeKind::Class(_) | ScopeKind::Interface(_));
        if !self.scopes.is_scope_binding(bound, local)
            || is_class_type_parameter
            || (is_from_parameters && !flags.contains(SymFlags::PARAMETER))
        {
            return None;
        }
        let symbol = if is_block_binding(bound, kind, local) {
            local
        } else {
            bound.export_symbol_of_value_symbol_if_exported(local)
        };
        if !is_from_parameters
            && name == known::arguments
            && self.is_var(local)
            && let Some(arguments @ Binding::Arguments(_)) = self.find_arguments_object(kind)
        {
            return Some(arguments);
        }
        if is_from_parameters || !matches!(kind, ScopeKind::Fn(_)) {
            return Some(Binding::Symbol(symbol));
        }
        let variable = find_symbol(&self.scopes.body_variables, symbol);
        Some(Binding::Symbol(variable.unwrap_or(symbol)))
    }

    pub(super) fn is_var(&self, local: SymbolId) -> bool {
        let decls = &self.bound.symbols[local.idx()].decls[..];
        decls.iter().all(|&decl| {
            matches!(
                declaration_kind(self.hir, self.bound, decl),
                DeclarationKind::NoBinding
                    | DeclarationKind::ImplicitBlockFunction
                    | DeclarationKind::BlockScopedRequire
                    | DeclarationKind::Var
            )
        })
    }

    fn find_exported_member(&self, at: ScopeId, scope: &Scope, name: Atom) -> Option<SymbolId> {
        let bound = self.bound;
        if scope.symbol.is_none() || name == known::default {
            return None;
        }
        let member = bound.find_in_table(bound.symbols[scope.symbol.idx()].exports, name)?;
        let flags = bound.symbols[member.idx()].flags;
        let visible_flags = if matches!(scope.kind, ScopeKind::Enum(_)) {
            SymFlags::ENUM_MEMBER
        } else {
            (SymFlags::VALUE | SymFlags::ALIAS) & SymFlags::MODULE_MEMBER
        };
        let is_variable_of_namespace =
            matches!(scope.kind, ScopeKind::Module(_)) && flags.intersects(SymFlags::VARIABLE);
        let has_value = !has_bit(&bound.runtime.declarations.valueless_symbols, member.idx());
        let is_visible = (has_value || is_variable_of_namespace)
            && !(flags.contains(SymFlags::EXPORT_ONLY) && bound.is_external_module(self.hir, at))
            && !(scope.kind == ScopeKind::File && bound.commonjs_indicator.is_some())
            && flags.intersects(visible_flags);
        is_visible.then_some(member)
    }

    fn find_arguments_object(&self, kind: ScopeKind) -> Option<Binding> {
        match kind {
            ScopeKind::Fn(f) if self.bound.has_arguments(self.hir, f) => {
                Some(Binding::Arguments(CodeUnit::Function(f)))
            }
            ScopeKind::File => Some(Binding::Arguments(CodeUnit::File)),
            ScopeKind::Fn(f) if self.hir[f].kind == FnKind::StaticBlock => Some(Binding::Free),
            ScopeKind::FieldInitializer(_) => Some(Binding::Free),
            _ => None,
        }
    }
}

pub(super) fn is_appended_visible(from: ScopeKind) -> bool {
    !matches!(from, ScopeKind::Param(_))
}
