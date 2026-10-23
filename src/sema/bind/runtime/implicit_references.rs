use super::references::ReferencePass;
use super::{ImplicitReference, ImplicitReferenceKind};
use crate::atom::{Atom, known};
use crate::bind::{Parent, ScopeId};
use crate::hir::*;

impl ReferencePass<'_, '_> {
    pub(super) fn resolve_classic_jsx(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let pragmas = hir.jsx_pragmas;
        let options = self.options;
        let is_classic = pragmas
            .classic
            .unwrap_or_else(|| options.jsx_factory_root.is_some());
        if !is_classic || hir.jsx.is_empty() {
            return;
        }
        let factory = self.jsx_root(pragmas.factory, options.jsx_factory_root);
        let fragment = self.jsx_root(pragmas.fragment_factory, options.jsx_fragment_root);
        for (index, expr) in hir.exprs.iter().enumerate() {
            let ExprKind::Jsx(j) = expr.kind else {
                continue;
            };
            let e = ExprId(index as u32);
            let scope = bound.expr_scope.get(&e).copied().unwrap_or(ScopeId::NONE);
            let is_reached = bound.parent_of_expr(e) != Parent::None && scope.is_some();
            if !is_reached || self.type_only.has_expr(e, scope) {
                continue;
            }
            let node = NodeData::Expr(e);
            self.add_implicit_reference(scope, factory, node, ImplicitReferenceKind::JsxFactory);
            if hir[j].tag.is_none() {
                let kind = ImplicitReferenceKind::JsxFragment;
                self.add_implicit_reference(scope, fragment, node, kind);
            }
        }
    }

    fn jsx_root(&self, pragma: Atom, option: Option<Atom>) -> Atom {
        if pragma.is_none() {
            return option.unwrap_or(known::React);
        }
        let text = self.atoms.bytes(pragma);
        let end = bun_core::strings::index_of_char_usize(text, b'.');
        self.atoms.intern(&text[..end.unwrap_or(text.len())])
    }

    pub(super) fn add_implicit_reference(
        &mut self,
        scope: ScopeId,
        name: Atom,
        node: NodeData,
        kind: ImplicitReferenceKind,
    ) {
        let binding = self.lookup.find(scope, name).binding;
        self.references.implicit_references.push(ImplicitReference {
            node,
            kind,
            name,
            binding,
        });
    }
}
