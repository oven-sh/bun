use super::lookup::Found;
use super::references::ReferencePass;
use super::{DynamicLookup, ImplicitReference, ImplicitReferenceKind};
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
            let found = self.lookup.find(scope, factory, u32::MAX);
            self.add_implicit_reference(&found, factory, node, ImplicitReferenceKind::JsxFactory);
            if hir[j].tag.is_none() {
                let found = self.lookup.find(scope, fragment, u32::MAX);
                let kind = ImplicitReferenceKind::JsxFragment;
                self.add_implicit_reference(&found, fragment, node, kind);
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

    /// `found` is what `Lookup::find` answers for `name` where `node` reads it.
    pub(super) fn add_implicit_reference(
        &mut self,
        found: &Found,
        name: Atom,
        node: NodeData,
        kind: ImplicitReferenceKind,
    ) {
        let reference = ImplicitReference {
            node,
            kind,
            name,
            binding: found.binding,
        };
        self.references.implicit_references.push(reference);
        // Only the first name of a define is read through `Bound::dynamic_scope_of`. It is looked up as a name written at the root of the define.
        if let (ImplicitReferenceKind::DefineHead, NodeData::Expr(root)) = (kind, node)
            && let Some(lookup) = self.find_dynamic_lookup(found, self.lookup.hir[root].pos)
        {
            self.references
                .dynamic_implicit_lookups
                .push((reference, lookup));
        }
    }

    // What `resolve_idents` keeps of an identifier that is looked up at `pos`.
    fn find_dynamic_lookup(&self, found: &Found, pos: u32) -> Option<DynamicLookup> {
        let is_behind_eval_variables = self.lookup.is_behind_eval_variables(found, pos);
        let scope = match found.dynamic_scope.is_none() && is_behind_eval_variables {
            true => found.scope,
            false => found.dynamic_scope,
        };
        scope.is_some().then_some(DynamicLookup {
            scope,
            is_behind_eval_variables,
        })
    }
}
