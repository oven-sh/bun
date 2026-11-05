use super::declaration_kinds::{DeclarationKind, declaration_kind};
use super::declarations::{Declarations, append_symbol};
use super::storage::RuntimeDeclarationsIn;
use super::{BindingKind, RuntimeScopes};
use crate::bind::{BoundBuilder, Decl, ScopeId, ScopeKind, SymFlags, SymbolId};
use crate::hir::*;

pub(super) fn is_block_binding(bound: &BoundBuilder, kind: ScopeKind, local: SymbolId) -> bool {
    let mut decls = bound.symbols[local.idx()].decls.iter();
    matches!(kind, ScopeKind::Module(_))
        && decls.all(|decl| !matches!(decl, Decl::Var(_) | Decl::Require(_)))
}

impl Declarations<'_, '_> {
    pub(super) fn create_container_parameters(&mut self) {
        let hir = self.hir;
        for index in 0..self.bound.scopes.len() {
            let (decl, name) = match self.bound.scopes[index].kind {
                ScopeKind::Module(it) => match hir[it].name {
                    ModuleName::Ident(name) => (Decl::Module(it), name),
                    ModuleName::String(_) | ModuleName::Global => continue,
                },
                ScopeKind::Enum(it) => (Decl::Enum(it), hir[it].name),
                _ => continue,
            };
            if !self.bound.makes_container_object(hir, decl) {
                continue;
            }
            let (scope, flags) = (ScopeId(index as u32), SymFlags::FUNCTION_SCOPED_VARIABLE);
            let kind = BindingKind::Parameter;
            let parameter = append_symbol(self.bound, name, flags, kind, decl, scope);
            let declarations = &mut self.bound.runtime.declarations;
            declarations.container_parameters.push((scope, parameter));
        }
    }
}

#[derive(Default)]
pub(super) struct ExportedBlockBindings {
    symbols: Vec<(Decl, SymbolId)>,
    kinds: Vec<(SymbolId, BindingKind)>,
}

impl ExportedBlockBindings {
    pub(super) fn collect(
        hir: &File<'_>,
        bound: &BoundBuilder,
        scopes: &RuntimeScopes,
    ) -> ExportedBlockBindings {
        let mut bindings = ExportedBlockBindings::default();
        for scope in bound.scopes.iter() {
            if !matches!(scope.kind, ScopeKind::Module(_)) {
                continue;
            }
            for &(_, local) in bound.table(scope.locals) {
                if bound.export_symbol_of_value_symbol_if_exported(local) != local
                    && scopes.is_scope_binding(bound, local)
                    && is_block_binding(bound, scope.kind, local)
                {
                    bindings.add(hir, bound, local);
                }
            }
        }
        bindings
    }

    fn add(&mut self, hir: &File<'_>, bound: &BoundBuilder, local: SymbolId) {
        let mut kind = BindingKind::NoBinding;
        for &decl in bound.symbols[local.idx()].decls.iter() {
            let declared = match decl {
                Decl::Fn(_) => BindingKind::Function,
                Decl::Class(_) => BindingKind::Class,
                Decl::Enum(_) | Decl::Module(_) => BindingKind::TypeScriptContainer,
                _ => continue,
            };
            self.symbols.push((decl, local));
            if declaration_kind(hir, bound, decl) != DeclarationKind::NoBinding {
                kind = kind.max(declared);
            }
        }
        self.kinds.push((local, kind));
    }

    pub(super) fn record(self, declarations: &mut RuntimeDeclarationsIn<Growable>) {
        declarations.declared_symbols.extend(self.symbols);
        declarations.sort();
        for (local, kind) in self.kinds {
            declarations.binding_kinds[local.idx()] = kind;
        }
    }
}
