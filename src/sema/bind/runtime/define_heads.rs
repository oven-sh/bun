use super::bits::has_bit;
use super::queries::find_entry;
use super::references::ReferencePass;
use super::stores::find_outermost_cast;
use super::{Binding, CodeUnit, CommonJsVariable, ImplicitReferenceKind};
use crate::atom::Atom;
use crate::bind::{Parent, ScopeId};
use crate::fold::DefineRoot;
use crate::hir::*;
use smallvec::SmallVec;

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

    // Whether the accesses above `root` spell `members`, the names behind the root in the key of a define. The fold applies the define nowhere else.
    fn is_root_of_key(&self, root: ExprId, members: &[Atom]) -> bool {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let mut path = root;
        members.iter().all(|&member| {
            let object = find_outermost_cast(hir, bound, path);
            let Parent::Expr(access) = bound.parent_of_expr(object) else {
                return false;
            };
            path = access;
            // An access whose key is a name has no operand but its object, so the path is that object.
            matches!(hir.member_key(access), Some((_, MemberKey::Name(name))) if name == member)
        })
    }

    fn look_up_define_heads(&mut self, named: DefineRoot, root: ExprId, scope: ScopeId) {
        let position = self.lookup.hir[root].pos;
        let heads = self.define_heads;
        let mut looked_up: SmallVec<[Atom; 4]> = SmallVec::new();
        for entry in heads.iter().filter(|entry| entry.root == named) {
            // Two keys below one root may have values that begin with one name, and one record says what the name is there.
            if looked_up.contains(&entry.head) || !self.is_root_of_key(root, entry.members) {
                continue;
            }
            looked_up.push(entry.head);
            let found = self.lookup.find_variable(scope, entry.head, position);
            // Free, and neither a `with` object nor evaluated text may declare it: the path begins at the global object, which needs no record.
            if found.binding == Binding::Free && found.dynamic_scope.is_none() {
                continue;
            }
            if let Binding::Arguments(unit) = found.binding {
                self.uses_arguments.push(unit);
            }
            let kind = ImplicitReferenceKind::DefineHead;
            self.add_implicit_reference(&found, entry.head, NodeData::Expr(root), kind);
        }
    }
}
