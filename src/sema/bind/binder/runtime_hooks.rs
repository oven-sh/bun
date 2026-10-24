use super::*;
use crate::bind::runtime::{self, PrivateReference, RuntimeInput};

#[derive(Default)]
pub(super) struct State {
    private_environments: Vec<ClassId>,
    private_references: Vec<PrivateReference>,
}

impl Binder<'_, '_> {
    pub(super) fn declaration_scope(&self) -> ScopeId {
        self.declaration_scope_at(self.scope)
    }

    pub(super) fn declaration_scope_at(&self, mut scope: ScopeId) -> ScopeId {
        if self.options.runtime.is_none() {
            return scope;
        }
        loop {
            let s = &self.b.scopes[scope.idx()];
            match s.kind {
                ScopeKind::With(_)
                | ScopeKind::FieldInitializer(_)
                | ScopeKind::ClassDecorators(_)
                | ScopeKind::ImplicitBlock(_) => scope = s.parent,
                _ => return scope,
            }
        }
    }

    pub(super) fn push_runtime_scope(&mut self, kind: ScopeKind) -> bool {
        let is_pushed = self.options.runtime.is_some();
        if is_pushed {
            self.push_scope(kind, SymbolId::NONE);
        }
        is_pushed
    }

    pub(super) fn push_implicit_block_scope(&mut self, statement: StmtId, function: FnId) -> bool {
        self.options.runtime.is_some()
            && runtime::has_implicit_block(self.f, &self.b, statement, function)
            && self.push_runtime_scope(ScopeKind::ImplicitBlock(function))
    }

    pub(super) fn pop_runtime_scope(&mut self, is_pushed: bool) {
        if is_pushed {
            self.pop_scope();
        }
    }

    pub(super) fn enter_private_environment(&mut self, class: ClassId) {
        if self.options.runtime.is_some() {
            self.runtime_hooks.private_environments.push(class);
        }
    }

    pub(super) fn leave_private_environment(&mut self) {
        self.runtime_hooks.private_environments.pop();
    }

    #[inline(always)]
    pub(super) fn note_private_reference(&mut self, reference: ExprId) {
        if self.options.runtime.is_some() {
            self.note_private_reference_for_runtime(reference);
        }
    }

    fn note_private_reference_for_runtime(&mut self, reference: ExprId) {
        let f = self.f;
        if !f.expr_flags(reference).contains(ExprFlags::PRIVATE_NAME) {
            return;
        }
        let (ExprKind::PrivateIdentifier(name) | ExprKind::Dot { name, .. }) = f[reference].kind
        else {
            return;
        };
        let declares = |class: &&ClassId| {
            let mut members = f[**class].members.iter();
            members.any(|member| f[member].key == PropKey::Private(name))
        };
        let environments = self.runtime_hooks.private_environments.iter();
        let class = environments.rev().find(declares).copied();
        self.runtime_hooks
            .private_references
            .push(PrivateReference {
                reference,
                name,
                class,
            });
    }

    pub(super) fn finish_runtime_bindings(&mut self) {
        let Some(options) = self.options.runtime else {
            return;
        };
        let idents = std::mem::take(&mut self.idents);
        let private_references = std::mem::take(&mut self.runtime_hooks.private_references);
        let input = RuntimeInput {
            hir: self.f,
            bound: &mut self.b,
            idents: &idents,
            options,
            atoms: self.atoms,
        };
        runtime::compute(input, private_references);
        self.idents = idents;
    }
}
