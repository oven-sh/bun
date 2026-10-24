use super::resolver::{AliasSource, ExprState, HolderKind, ResolvedValue, Resolver};
use super::{BuiltinPath, ResolveInput};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingInitializer, BindingStability, Decl, SymbolId};
use bun_sema::hir::{
    ExprId, ExprKind, Flags, ImportEqualsId, ImportEqualsTarget, NodeData, PatId, PatKind,
};
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

pub(super) fn declared_names(
    input: &ResolveInput<'_, '_>,
) -> impl Iterator<Item = (PatId, SymbolId)> {
    let names = (0..input.hir.pats.len() as u32).map(PatId);
    names.filter_map(|name| {
        match input.hir[name].kind {
            PatKind::Ident(_) => {}
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => return None,
        }
        let symbol = input.bound.declared_symbol(Decl::Var(name));
        (!symbol.is_none()).then_some((name, symbol))
    })
}

impl Resolver<'_, '_> {
    fn is_stable(&self, symbol: SymbolId) -> bool {
        let input = self.input;
        let is_dead_store = |target: ExprId| input.decisions.is_dead_expr(target);
        matches!(
            input
                .bound
                .binding_stability_ignoring(symbol, &is_dead_store),
            BindingStability::Stable
        )
    }

    pub(super) fn find_alias_source(&self, symbol: SymbolId) -> Option<AliasSource> {
        let input = self.input;
        if !self.is_stable(symbol) {
            return None;
        }
        match input.bound.binding_initializer(input.hir, symbol) {
            BindingInitializer::Expression(initializer) => Some(AliasSource::Initializer {
                initializer,
                members: SmallVec::new(),
            }),
            BindingInitializer::PatternProperty { source, path } => {
                let members = path.iter().map(|&key| input.names.get(key));
                Some(AliasSource::Initializer {
                    initializer: source,
                    members: members.collect::<Option<_>>()?,
                })
            }
            _ => None,
        }
    }

    pub(super) fn collect_declared_aliases(&mut self) {
        let input = self.input;
        if let Some(facts) = self.facts {
            self.add_declared_aliases_of_part(facts);
            self.collect_entity_aliases();
            return;
        }
        for (name, symbol) in declared_names(input) {
            // Also of a binding that stands for nothing, because it is stored to: other files read what a store puts into it.
            let flags = input.bound.modifier_flags(input.hir, Decl::Var(name));
            if flags.contains(Flags::EXPORT) {
                self.exported_symbols.insert(symbol);
            }
            if !self.aliases.contains_key(&symbol)
                && let Some(source) = self.find_alias_source(symbol)
            {
                self.aliases.insert(symbol, source);
            }
        }
        self.collect_entity_aliases();
    }

    fn expose_entity_root(&mut self, root: Binding) {
        let id = match root {
            Binding::Symbol(symbol) => {
                self.exported_symbols.insert(symbol);
                match self.aliases.get(&symbol) {
                    Some(AliasSource::Known(value)) => value.path.id,
                    Some(AliasSource::Initializer { .. }) | None => return,
                }
            }
            Binding::CommonJs(variable) => match self.commonjs.get(variable) {
                Some(path) => path.id,
                None => return,
            },
            Binding::Arguments(_) | Binding::Free => return,
        };
        self.output.mentioned.push(id);
        self.expose(id);
    }

    fn collect_entity_aliases(&mut self) {
        let input = self.input;
        for import in (0..input.hir.import_equals.len() as u32).map(ImportEqualsId) {
            let names = match input.hir[import].target {
                ImportEqualsTarget::Entity(names) => names,
                ImportEqualsTarget::Require(_) => continue,
            };
            let symbol = input.bound.declared_symbol(Decl::ImportEquals(import));
            if symbol.is_none() || !input.bound.has_runtime_value(symbol) {
                continue;
            }
            let root = input.bound.entity_root_binding(import);
            match root {
                Binding::Free => {}
                Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) => {
                    self.expose_entity_root(root);
                    continue;
                }
            }
            let path: SmallVec<[Atom; 4]> = input.hir.texts(names).collect();
            let value = match self.resolve_global_path(&path) {
                ExprState::Builtin(value) => value,
                _ => continue,
            };
            let is_local = self.is_stable(symbol)
                && !input.hir[import].flags.contains(Flags::EXPORT)
                && !self.is_exported(symbol)
                && !input.bound.is_visible_to_eval(symbol);
            if is_local {
                self.aliases
                    .insert(symbol, AliasSource::Known(value.predicted()));
            } else {
                self.expose(value.path.id);
            }
        }
    }

    fn resolve_alias(&self, symbol: SymbolId) -> Option<ResolvedValue> {
        match self.aliases.get(&symbol)? {
            AliasSource::Known(value) => Some(*value),
            AliasSource::Initializer {
                initializer,
                members,
            } => {
                let mut value = self.value_of(*initializer)?;
                for &name in members {
                    value = ResolvedValue::object(self.find_member(value, name)?);
                }
                Some(value.predicted())
            }
        }
    }

    pub(super) fn compute_symbol_state(&mut self, expr: ExprId, symbol: SymbolId) -> ExprState {
        let value = self.resolve_alias(symbol);
        let held = self.held.get(&symbol).copied().flatten();
        let bound = self.input.bound;
        if bound.dynamic_lookup_scope(NodeData::Expr(expr)).is_some() {
            if let Some(value) = value.or(held) {
                self.expose(value.path.id);
            }
            return ExprState::Unresolved;
        }
        match (value, held) {
            (Some(value), _) => ExprState::Builtin(value),
            (None, Some(held)) => ExprState::Held(held),
            (None, None) => ExprState::Unresolved,
        }
    }

    // Every read of the binding is written in what is resolved of this file and is found by the binding.
    pub(super) fn can_hold_builtin(&self, symbol: SymbolId) -> bool {
        let bound = self.input.bound;
        let is_plain_binding = matches!(
            bound.binding_stability_ignoring(symbol, &|_| true),
            BindingStability::Stable | BindingStability::NotInitializedOnce
        );
        is_plain_binding
            && !self.is_exported(symbol)
            && !bound.is_visible_to_eval(symbol)
            && !self.is_named_outside(symbol)
    }

    pub(super) fn find_held_value(&self, name: ExprId) -> Option<ResolvedValue> {
        let name = self.input.hir.skip_type_assertions(name);
        match (self.input.hir[name].kind, self.input.bound.binding(name)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => self.held.get(&symbol).copied()?,
            _ => None,
        }
    }

    pub(super) fn collect_symbol_paths(&self) -> Vec<(SymbolId, BuiltinPath)> {
        let mut paths = Vec::new();
        for &symbol in self.aliases.keys() {
            match self.resolve_alias(symbol) {
                Some(ResolvedValue {
                    path,
                    kind: HolderKind::Object,
                }) => paths.push((symbol, path)),
                Some(ResolvedValue {
                    kind: HolderKind::ModuleNamespace,
                    ..
                })
                | None => {}
            }
        }
        paths.shared_sort_unstable_by_key(|entry| entry.0);
        paths
    }

    pub(super) fn is_local_alias(&self, name: PatId) -> bool {
        let bound = self.input.bound;
        let symbol = match bound.initialized_binding(name) {
            Binding::Symbol(symbol) => symbol,
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => return false,
        };
        matches!(
            self.aliases.get(&symbol),
            Some(AliasSource::Initializer { .. })
        ) && !self.is_exported(symbol)
            && !bound.is_visible_to_eval(symbol)
            && bound.dynamic_lookup_scope(NodeData::Pat(name)).is_none()
            && !self.is_named_outside(symbol)
    }
}
