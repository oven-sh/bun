use super::bits::has_bit;
use super::references::ReferencePass;
use super::stores::find_outermost_cast;
use super::{CommonJsVariable, ImplicitReference, ImplicitReferenceKind};
use crate::atom::{Atom, known};
use crate::bind::{Binding, BoundBuilder, Parent, ScopeId};
use crate::fold::{DefineRoot, PathInPlace};
use crate::hir::*;
use crate::util::FxHashMap;
use bun_core::identifier::is_identifier;

fn is_operand_of_delete(hir: &File<'_>, bound: &BoundBuilder, e: ExprId) -> bool {
    matches!(
        bound.parent_of_expr(find_outermost_cast(hir, bound, e)),
        Parent::Expr(parent) if parent.is_some()
            && matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. })
    )
}

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

    fn is_first_name_at_hand(&self, scope: ScopeId, in_place: &PathInPlace<'_>) -> bool {
        match self.lookup.find_binding(scope, in_place.first_name) {
            Binding::Free => false,
            Binding::CommonJs(CommonJsVariable::Require) => !in_place.is_in_bundle,
            Binding::CommonJs(CommonJsVariable::Module | CommonJsVariable::Exports) => {
                !in_place.is_in_bundle || in_place.members.is_empty()
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) => true,
        }
    }

    pub(super) fn resolve_defined_paths(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let names_in_place = self.names_in_place;
        if names_in_place.is_empty() {
            return;
        }
        let scopes_of_names: FxHashMap<ExprId, ScopeId> = self.idents.iter().copied().collect();
        for index in 0..hir.exprs.len() {
            let e = ExprId(index as u32);
            let last = match (hir[e].kind, hir.member_key(e)) {
                (ExprKind::Ident(_), _) if is_operand_of_delete(hir, bound, e) => continue,
                (ExprKind::Ident(_) | ExprKind::ImportMeta, _) => None,
                (_, Some((_, MemberKey::Name(last)))) => Some(last),
                _ => continue,
            };
            if hir.is_in_known_evaluation(hir[e].pos) {
                continue;
            }
            let ends_alike =
                |it: &(u32, &PathInPlace<'_>)| it.1.path.members.last().copied() == last;
            for (index, in_place) in (0..).zip(names_in_place).filter(ends_alike) {
                let Some(root) = self.find_root_of_written_path(e, in_place.path.members) else {
                    continue;
                };
                let scope = match (hir[root].kind, in_place.path.root) {
                    (ExprKind::ImportMeta, DefineRoot::ImportMeta) => bound.expr_scope.get(&root),
                    (ExprKind::Ident(name), DefineRoot::Global(written)) if name == written => {
                        scopes_of_names.get(&root)
                    }
                    _ => None,
                };
                let Some(&scope) = scope else {
                    continue;
                };
                let is_free = match hir[root].kind {
                    ExprKind::Ident(name) => {
                        has_bit(&self.references.evaluated_idents, root.idx())
                            && self.lookup.find_with_inside(scope, ScopeId::NONE).is_none()
                            && matches!(
                                self.lookup.find_binding(scope, name),
                                Binding::Free
                                    | Binding::CommonJs(
                                        CommonJsVariable::Require
                                            | CommonJsVariable::Filename
                                            | CommonJsVariable::Dirname
                                    )
                            )
                    }
                    _ => true,
                };
                if is_free
                    && !hir.is_written_by_define(root)
                    && bound.parent_of_expr(e) != Parent::None
                    && (last.is_none() || self.is_member_replaced(e, in_place))
                    && !self.is_inside_longer_path(e, in_place)
                    && self.is_first_name_at_hand(scope, in_place)
                    && hir.has_room_in_front(root, in_place.members.len())
                    && !(in_place.members.is_empty() && is_operand_of_delete(hir, bound, e))
                {
                    self.references.places_of_defined_paths.push((e, index));
                    break;
                }
            }
        }
    }

    fn is_member_replaced(&self, member: ExprId, in_place: &PathInPlace<'_>) -> bool {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let target = find_outermost_cast(hir, bound, member);
        (in_place.may_end_in_brackets || !hir.is_written_in_brackets(member))
            && bound.get_assignment_target(hir, target).is_none()
    }

    fn is_inside_longer_path(&self, path: ExprId, in_place: &PathInPlace<'_>) -> bool {
        let find =
            |longer: &&[Atom]| self.find_path_around(path, &longer[in_place.path.members.len()..]);
        let mut replaced = in_place.longer_paths.iter().filter_map(find);
        let mut dropped = in_place.longer_dropped_paths.iter().filter_map(find);
        replaced.any(|whole| self.is_member_replaced(whole, in_place))
            || dropped.any(|whole| self.leads_to_dropped_call(whole, in_place))
    }

    fn find_path_around(&self, path: ExprId, members: &[Atom]) -> Option<ExprId> {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let mut whole = path;
        for _ in members {
            match bound.parent_of_expr(find_outermost_cast(hir, bound, whole)) {
                Parent::Expr(parent) if parent.is_some() => whole = parent,
                _ => return None,
            }
        }
        (self.find_root_of_written_path(whole, members) == Some(path)).then_some(whole)
    }

    fn leads_to_dropped_call(&self, mut path: ExprId, in_place: &PathInPlace<'_>) -> bool {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        while in_place.may_end_in_brackets || !hir.is_written_in_brackets(path) {
            let inside = find_outermost_cast(hir, bound, path);
            let parent = match bound.parent_of_expr(inside) {
                Parent::Expr(parent) if parent.is_some() => parent,
                _ => return false,
            };
            match (hir[parent].kind, hir.member_key(parent)) {
                (ExprKind::Call(call), _) => return hir[call].callee == inside,
                (_, Some((object, MemberKey::Name(name))))
                    if object == inside && self.may_be_written_with_dot(parent, name) =>
                {
                    path = parent;
                }
                _ => return false,
            }
        }
        false
    }

    fn may_be_written_with_dot(&self, member: ExprId, name: Atom) -> bool {
        let (hir, name) = (self.lookup.hir, self.atoms.bytes(name));
        hir.is_name_resolved_by_transpiler(member, name)
            && (!hir.is_written_in_brackets(member) || is_identifier(name))
    }

    fn find_root_of_written_path(&self, path: ExprId, members: &[Atom]) -> Option<ExprId> {
        let hir = self.lookup.hir;
        let mut e = path;
        for &member in members.iter().rev() {
            match hir.member_key(e)? {
                (object, MemberKey::Name(name))
                    if name == member
                        && !hir.expr_flags(e).contains(ExprFlags::OPTIONAL_CHAIN_LINK)
                        && hir.is_name_resolved_by_transpiler(e, self.atoms.bytes(name)) =>
                {
                    e = hir.skip_type_assertions(object);
                }
                _ => return None,
            }
        }
        Some(e)
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
        let mut binding = self.lookup.find_binding(scope, name);
        let mut member = Atom::NONE;
        if binding == Binding::Free
            && let Some((variable, key)) = self.lookup.hir.find_name_of_loaded_import(name)
        {
            binding = self.lookup.find_binding(scope, variable);
            member = key;
        }
        self.references.implicit_references.push(ImplicitReference {
            node,
            kind,
            name,
            binding,
            member,
        });
    }
}
