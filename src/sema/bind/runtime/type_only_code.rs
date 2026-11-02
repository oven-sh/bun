use super::bits::{has_bit, insert_bit};
use crate::bind::{BoundBuilder, MemberOwner, ScopeId, ScopeKind};
use crate::fold::{TreeNode, push_children};
use crate::hir::*;

pub(super) struct TypeOnlyCode {
    scopes: Vec<u64>,
    member_keys: Vec<u64>,
}

impl TypeOnlyCode {
    pub(super) fn new(hir: &File<'_>, bound: &BoundBuilder) -> TypeOnlyCode {
        TypeOnlyCode {
            scopes: compute_type_scopes(hir, bound),
            member_keys: compute_type_only_member_keys(hir, bound),
        }
    }

    pub(super) fn has_scope(&self, scope: ScopeId) -> bool {
        has_bit(&self.scopes, scope.idx())
    }

    pub(super) fn has_expr(&self, e: ExprId, scope: ScopeId) -> bool {
        self.has_scope(scope) || has_bit(&self.member_keys, e.idx())
    }
}

fn compute_type_scopes(hir: &File<'_>, bound: &BoundBuilder) -> Vec<u64> {
    let mut type_scopes = Vec::new();
    for (index, scope) in bound.scopes.iter().enumerate() {
        let is_type_scope = match scope.kind {
            ScopeKind::Fn(f) => matches!(hir[f].body, FnBody::None),
            ScopeKind::Module(m) => hir[m].flags.contains(Flags::AMBIENT),
            ScopeKind::Class(c) => hir[c].flags.contains(Flags::AMBIENT),
            ScopeKind::Enum(e) => hir[e].flags.contains(Flags::AMBIENT),
            ScopeKind::Interface(_)
            | ScopeKind::TypeAlias(_)
            | ScopeKind::TypeParams
            | ScopeKind::TypeParamList(_)
            | ScopeKind::ReturnType(_)
            | ScopeKind::Extends
            | ScopeKind::InferConstraint
            | ScopeKind::PropertyType(..) => true,
            _ => false,
        };
        if is_type_scope || (scope.parent.is_some() && has_bit(&type_scopes, scope.parent.idx())) {
            insert_bit(&mut type_scopes, index);
        }
    }
    type_scopes
}

fn compute_type_only_member_keys(hir: &File<'_>, bound: &BoundBuilder) -> Vec<u64> {
    let mut keys = Vec::new();
    let mut stack = Vec::new();
    for (index, member) in hir.members.iter().enumerate() {
        let PropKey::Computed(key) = member.key else {
            continue;
        };
        if has_evaluated_key(hir, bound.member_owner[index], MemberId(index as u32)) {
            continue;
        }
        stack.push(TreeNode::Expr(key));
        while let Some(node) = stack.pop() {
            let is_new = match node {
                TreeNode::Expr(e) => insert_bit(&mut keys, e.idx()),
                _ => true,
            };
            if is_new {
                push_children(hir, node, &mut stack);
            }
        }
    }
    keys
}

fn has_evaluated_key(hir: &File<'_>, owner: MemberOwner, member: MemberId) -> bool {
    match owner {
        MemberOwner::None => true,
        MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_) => false,
        MemberOwner::Class(_) => has_runtime_member(hir, member),
    }
}
