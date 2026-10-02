//! Names that what is emitted needs for itself: 18027.
//!
//! Follows `recordPotentialCollisionWithWeakMapSetInGeneratedCode`, `needCollisionCheckForIdentifier`, `checkWeakMapSetCollision` and
//! `setNodeLinksForPrivateIdentifierScope` of TypeScript 7.0.2's checker.go. What is imported is not looked at.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Decl, MemberOwner, Parent, PatParent};
use crate::resolve::ScriptTarget;

impl Checker<'_> {
    pub(super) fn check_x_collisions(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let options = &files.options;
        // `errorSkippedOnNoEmit`. `GetEmitScriptTarget`: no target is the latest.
        if options.no_emit_is_set
            || options.target == ScriptTarget::None
            || options.target > ScriptTarget::ES2021
            || hir.kind == FileKind::Declaration
        {
            return;
        }
        // `setNodeLinksForPrivateIdentifierScope`
        let mut with_private_names: Vec<Parent> = Vec::new();
        for (m, member) in hir.members.iter().enumerate() {
            if matches!(member.key, PropKey::Private(_))
                && matches!(bound.member_owner[m], MemberOwner::Class(_))
                && matches!(
                    member.kind,
                    MemberKind::Property
                        | MemberKind::Method
                        | MemberKind::Getter
                        | MemberKind::Setter
                )
            {
                let class = self.outward(file, Parent::MemberInit(MemberId(m as u32)));
                for scope in self.block_scopes_around(file, class) {
                    if !with_private_names.contains(&scope) {
                        with_private_names.push(scope);
                    }
                }
            }
        }
        if with_private_names.is_empty() {
            return;
        }
        let names = [
            files.atoms.lookup(b"WeakMap"),
            files.atoms.lookup(b"WeakSet"),
        ];
        for symbol in &bound.symbols {
            if !names.contains(&Some(symbol.name)) {
                continue;
            }
            for &decl in &symbol.decls {
                // `needCollisionCheckForIdentifier`: whether nothing is emitted for it. The node it is, or is directly in.
                // `GetErrorRangeForNode`: its name, but a parameter as a whole.
                let (is_erased, around, start, end) = match decl {
                    Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                        let (name, name_end) = (hir[pat].pos, self.end_of_pat(file, pat));
                        let mut root = pat;
                        loop {
                            match bound.pat_parent[root.idx()] {
                                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => {
                                    root = outer;
                                }
                                PatParent::Var(d) => {
                                    break (
                                        hir[d].flags.contains(Flags::AMBIENT),
                                        Parent::Stmt(bound.var_stmt[d.idx()]),
                                        name,
                                        name_end,
                                    );
                                }
                                PatParent::Param(p) => {
                                    let f = bound.param_fn[p.idx()];
                                    // An overload.
                                    let is_erased =
                                        f.is_none() || matches!(hir[f].body, FnBody::None);
                                    break if root == pat {
                                        (
                                            is_erased,
                                            Parent::ParamDefault(p),
                                            hir[p].pos,
                                            self.end_of_param(file, p),
                                        )
                                    } else {
                                        (is_erased, Parent::ParamDefault(p), name, name_end)
                                    };
                                }
                                PatParent::None => break (true, Parent::None, name, name_end),
                            }
                        }
                    }
                    Decl::Fn(f) if matches!(hir[f].kind, FnKind::Decl | FnKind::Expr) => (
                        hir[f].flags.contains(Flags::AMBIENT),
                        self.outward(file, Parent::FnBody(f)),
                        hir[f].name_pos,
                        self.end_of_token_at(file, hir[f].name_pos),
                    ),
                    Decl::Class(c) => (
                        hir[c].flags.contains(Flags::AMBIENT),
                        match bound.class_owner[c.idx()] {
                            ClassOwner::Expr(e) => Parent::Expr(e),
                            ClassOwner::Stmt(s) => Parent::Stmt(s),
                        },
                        hir[c].name_pos,
                        self.end_of_token_at(file, hir[c].name_pos),
                    ),
                    Decl::Enum(e) => (
                        hir[e].flags.contains(Flags::AMBIENT),
                        Parent::Stmt(hir[e].stmt),
                        hir[e].name_pos,
                        self.end_of_token_at(file, hir[e].name_pos),
                    ),
                    Decl::Module(m) => (
                        hir[m].flags.contains(Flags::AMBIENT),
                        Parent::Stmt(hir[m].stmt),
                        hir[m].name_pos,
                        self.end_of_token_at(file, hir[m].name_pos),
                    ),
                    _ => continue,
                };
                if is_erased {
                    continue;
                }
                let scopes = self.block_scopes_around(file, around);
                let is_in_ambient_namespace = scopes.iter().any(
                    |scope| matches!(*scope, Parent::Module(m) if hir[m].flags.contains(Flags::AMBIENT)),
                );
                // `checkWeakMapSetCollision`
                if !is_in_ambient_namespace
                    && scopes
                        .first()
                        .is_some_and(|enclosing| with_private_names.contains(enclosing))
                {
                    out.push(Diagnostic { start, code: 18027 });
                    self.note(start, end, 18027, vec![self.atom_text(symbol.name)]);
                }
            }
        }
    }

    /// `GetEnclosingBlockScopeContainer`, over and over: the block scopes (`IsBlockScope`) around the node `parent` stands for, from the
    /// inside out. Each is given as what is directly in it has for a parent. The list ends early where the way out is not kept
    /// track of.
    fn block_scopes_around(&self, file: FileId, mut parent: Parent) -> Vec<Parent> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut scopes = Vec::new();
        let mut below = Parent::None;
        loop {
            match parent {
                Parent::None => return scopes,
                Parent::Expr(x) if x.is_none() => return scopes,
                Parent::Stmt(s) if s.is_none() => return scopes,
                Parent::File => {
                    scopes.push(parent);
                    return scopes;
                }
                Parent::FnBody(_) | Parent::MemberInit(_) | Parent::Module(_) => {
                    scopes.push(parent);
                }
                Parent::ParamDefault(p) => scopes.push(Parent::FnBody(bound.param_fn[p.idx()])),
                Parent::Stmt(s) => match hir[s].kind {
                    StmtKind::Block(_)
                    | StmtKind::For { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::ForOf { .. } => scopes.push(parent),
                    // The block of its cases.
                    StmtKind::Switch { .. } if matches!(below, Parent::Case(_)) => {
                        scopes.push(parent);
                    }
                    // Its `catch`.
                    StmtKind::Try {
                        block, finalizer, ..
                    } if below != Parent::Stmt(block) && below != Parent::Stmt(finalizer) => {
                        scopes.push(parent);
                    }
                    _ => {}
                },
                _ => {}
            }
            below = parent;
            parent = match parent {
                // The way out of a namespace is that of the statement that declares it.
                Parent::Module(m) => bound
                    .stmt_parent
                    .get(hir[m].stmt.idx())
                    .map_or(Parent::None, |&parent| parent),
                _ => self.outward(file, parent),
            };
        }
    }
}
