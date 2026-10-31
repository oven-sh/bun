use super::bits::has_bit;
use super::queries::find_entry;
use super::references::ReferencePass;
use super::{Binding, CodeUnit, CommonJsVariable, ImplicitReferenceKind};
use crate::atom::Atom;
use crate::bind::ScopeId;
use crate::fold::DefineRoot;
use crate::hir::*;

#[inline]
fn filter_bit(name: Atom) -> u64 {
    1 << (name.0 & 63)
}

impl ReferencePass<'_, '_> {
    // `bun build` writes the path of a define in place of what the define names, and looks the first name of the path up there.
    pub(super) fn resolve_define_heads(&mut self) {
        let heads = self.define_heads;
        if heads.is_empty() {
            return;
        }
        let hir = self.lookup.hir;
        let names = heads.iter().fold(0, |names, entry| match entry.root {
            DefineRoot::Global(name) => names | filter_bit(name),
            DefineRoot::ImportMeta => names,
        });
        for &(root, scope) in self.idents {
            let ExprKind::Ident(name) = hir[root].kind else {
                continue;
            };
            if names & filter_bit(name) != 0 && self.may_be_define_root(root) {
                self.look_up_define_heads(DefineRoot::Global(name), root, scope);
            }
        }
        for &(root, scope) in self.import_metas {
            // The fold applies a define wherever `import.meta` is written. Code that is not evaluated reads nothing, so a root there gets no record.
            if self.type_only.has_expr(root, scope) {
                continue;
            }
            self.look_up_define_heads(DefineRoot::ImportMeta, root, scope);
        }
    }

    // The fold applies a define to no other identifier. The `arguments` of the file is a free name under the module goal.
    fn may_be_define_root(&self, ident: ExprId) -> bool {
        if !has_bit(&self.references.evaluated_idents, ident.idx()) {
            return false;
        }
        let own = find_entry(&self.references.ident_bindings, ident).copied();
        let own = own.unwrap_or_else(|| self.lookup.bound.default_binding(ident));
        matches!(
            own,
            Binding::Free
                | Binding::Arguments(CodeUnit::File)
                | Binding::CommonJs(
                    CommonJsVariable::Require
                        | CommonJsVariable::Filename
                        | CommonJsVariable::Dirname
                )
        )
    }

    fn look_up_define_heads(&mut self, named: DefineRoot, root: ExprId, scope: ScopeId) {
        let position = self.lookup.hir[root].pos;
        let heads = self.define_heads;
        for entry in heads.iter().filter(|entry| entry.root == named) {
            let (found, is_behind_member) = self.lookup.find_variable(scope, entry.head, position);
            // Free, and neither a `with` object nor evaluated text may declare it: the path begins at the global object, which needs no record.
            if found.binding == Binding::Free && found.dynamic_scope.is_none() {
                continue;
            }
            if let Binding::Arguments(unit) = found.binding {
                self.uses_arguments.push(unit);
            }
            if is_behind_member {
                let behind = &mut self.references.define_heads_behind_members;
                behind.push((root, entry.head));
            }
            let kind = ImplicitReferenceKind::DefineHead;
            self.add_implicit_reference(&found, entry.head, NodeData::Expr(root), kind);
        }
    }
}
