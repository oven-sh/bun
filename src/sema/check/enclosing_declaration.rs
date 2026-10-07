//! `enclosingDeclaration` for the nodes `typeWriterWalker` visits: the innermost scope enclosing
//! `node.Parent`, including that of `node.Parent` itself if it has locals.

use super::*;
use crate::bind::{Decl, Parent, PatParent, ScopeId, ScopeKind};

/// `enclosingDeclaration`
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(super) struct Enclosing {
    pub(super) file: FileId,
    /// The scope name resolution starts from: its locals, or those of the innermost enclosing node
    /// that has locals.
    pub(super) scope: ScopeId,
    /// The enclosing declaration is this variable declaration.
    pub(super) variable: VarDeclId,
    /// The enclosing declaration is a synthetic block that `enterNewScope` created for the
    /// parameters or the type parameters of a signature, and the other fields describe what
    /// encloses it. The blocks are numbered from 1. 0: none.
    pub(super) fake_scope: u32,
}

impl Enclosing {
    /// `enclosingDeclaration == nil`: only the globals are in scope.
    pub(super) const NONE: Enclosing = Enclosing {
        file: super::explain::NOWHERE.0,
        scope: ScopeId::NONE,
        variable: VarDeclId::NONE,
        fake_scope: 0,
    };

    pub(super) fn is_none(self) -> bool {
        self.file == super::explain::NOWHERE.0
    }

    pub(super) fn at_scope(file: FileId, scope: ScopeId) -> Enclosing {
        Enclosing {
            file,
            scope,
            variable: VarDeclId::NONE,
            fake_scope: 0,
        }
    }
}

/// The file scope is the fallback for a scope the binder did not record.
pub(super) fn or_file_scope(scope: ScopeId) -> ScopeId {
    if scope.is_some() { scope } else { ScopeId(0) }
}

/// The scope of the enum that contains `m`. `NONE`: the binder did not reach it, so it has no
/// owner.
fn scope_of_enum_member(bound: &Bound, m: EnumMemberId) -> ScopeId {
    let scope = bound.enum_scope.get(bound.enum_member_owner[m.idx()].idx());
    scope.copied().unwrap_or(ScopeId::NONE)
}

impl Checker<'_, '_> {
    /// `IsFunctionLikeDeclaration(enclosingDeclaration)`
    pub(super) fn is_function_like_declaration(&self, at: Enclosing) -> bool {
        at.fake_scope == 0
            && at.variable.is_none()
            && at.scope.is_some()
            && matches!(self.bound(at.file).scopes[at.scope.idx()].kind, ScopeKind::Fn(f)
            if matches!(
                self.hir(at.file)[f].kind,
                FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Arrow
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor
            ))
    }

    fn enclosing_scope_of_function(&self, file: FileId, f: FnId) -> ScopeId {
        if f.is_none() {
            return ScopeId(0);
        }
        or_file_scope(self.bound(file).fns[f.idx()].scope)
    }

    /// For a child of the statement `s` that is not itself a statement.
    fn enclosing_scope_of_statement(&self, file: FileId, s: StmtId) -> ScopeId {
        // The loop header is in the scope the loop creates, like its body.
        let inside = match self.hir(file)[s].kind {
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
                if body.is_some() =>
            {
                body
            }
            _ => s,
        };
        or_file_scope(self.bound(file).stmt_scope[inside.idx()])
    }

    fn enclosing_scope_of_variable(&self, file: FileId, d: VarDeclId) -> ScopeId {
        let bound = self.bound(file);
        let s = bound.var_stmt[d.idx()];
        if s.is_none() {
            return ScopeId(0);
        }
        or_file_scope(match self.hir(file)[s].kind {
            // The variable of a `catch` clause is in the scope the clause creates, like its block.
            StmtKind::Try { param, handler, .. } if param == d && handler.is_some() => {
                bound.stmt_scope[handler.idx()]
            }
            _ => bound.stmt_scope[s.idx()],
        })
    }

    /// For the computed property name `[e]`.
    fn enclosing_scope_of_computed_name(&self, file: FileId, e: ExprId) -> ScopeId {
        // For a member of a class or an interface.
        if let Some(&computed_name) = self.bound(file).expr_scope.get(&e) {
            return computed_name;
        }
        match self.bound(file).expr_parent[e.idx()] {
            Parent::MemberKey(m) => self.enclosing_scope_of_member(file, m),
            Parent::PropKey(_, p) | Parent::MethodKey(p) => {
                self.enclosing_scope_of_property(file, p)
            }
            Parent::PatKey(p) => self.enclosing_scope_of_pat(file, self.hir(file)[p].value),
            _ => ScopeId(0),
        }
    }

    /// For the expression `e`, and for the name of a property access `e`.
    pub(super) fn enclosing_scope_of_expr(&self, file: FileId, e: ExprId) -> ScopeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            // The operand of `typeof` in a type.
            if bound.is_in_type_query(at)
                && let Some(&scope) = bound.expr_scope.get(&at)
            {
                return or_file_scope(scope);
            }
            match bound.expr_parent[at.idx()] {
                Parent::Expr(outer) | Parent::PropKey(outer, _) if outer.is_some() => at = outer,
                Parent::Prop(p) if bound.prop_owner[p.idx()].is_some() => {
                    at = bound.prop_owner[p.idx()];
                }
                Parent::Stmt(s) if s.is_some() => {
                    return self.enclosing_scope_of_statement(file, s);
                }
                Parent::VarInit(d) => return self.enclosing_scope_of_variable(file, d),
                Parent::ParamDefault(p) => {
                    return self.enclosing_scope_of_function(file, bound.param_fn[p.idx()]);
                }
                Parent::PatPropDefault(p) => {
                    return self.enclosing_scope_of_pat(file, hir[p].value);
                }
                Parent::PatElemDefault(p) => return self.enclosing_scope_of_pat(file, hir[p].pat),
                Parent::PropKey(..)
                | Parent::PatKey(_)
                | Parent::MemberKey(_)
                | Parent::MethodKey(_) => {
                    return self.enclosing_scope_of_computed_name(file, at);
                }
                Parent::MemberInit(m) => return self.enclosing_scope_of_member(file, m),
                Parent::FnBody(f) => return self.enclosing_scope_of_function(file, f),
                Parent::EnumInit(m) => {
                    return or_file_scope(scope_of_enum_member(bound, m));
                }
                Parent::Case(c) => {
                    let s = bound.case_stmt[c.idx()];
                    if s.is_none() {
                        return ScopeId(0);
                    }
                    // The clauses are in the scope the case block creates, like their statements.
                    if let StmtKind::Switch { cases, .. } = hir[s].kind
                        && let Some(first) = cases.iter().find_map(|c| hir.ids(hir[c].body).next())
                    {
                        return or_file_scope(bound.stmt_scope[first.idx()]);
                    }
                    return or_file_scope(bound.stmt_scope[s.idx()]);
                }
                // `node.Parent` of the expression itself is the `ExpressionWithTypeArguments`, which is not in the expression.
                Parent::ClassExtends(c) => {
                    return or_file_scope(match bound.expr_scope.get(&at) {
                        Some(&base_expression) if at != e => base_expression,
                        _ => bound.class_scope[c.idx()],
                    });
                }
                Parent::Decorator(c, owner) => {
                    return match owner {
                        DecoratorOwner::Class(_) => or_file_scope(bound.class_scope[c.idx()]),
                        DecoratorOwner::Member(m) => self.enclosing_scope_of_member(file, m),
                        DecoratorOwner::Param(p) => {
                            self.enclosing_scope_of_function(file, bound.param_fn[p.idx()])
                        }
                    };
                }
                Parent::Module(m) => return or_file_scope(bound.module_scope[m.idx()]),
                Parent::Expr(_)
                | Parent::Prop(_)
                | Parent::Stmt(_)
                | Parent::File
                | Parent::None => return ScopeId(0),
            }
        }
    }

    /// For the name `pat` of a variable, a parameter or a binding element.
    pub(super) fn enclosing_scope_of_pat(&self, file: FileId, pat: PatId) -> ScopeId {
        let bound = self.bound(file);
        let mut at = pat;
        loop {
            match bound.pat_parent[at.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => at = outer,
                PatParent::Var(d) => return self.enclosing_scope_of_variable(file, d),
                PatParent::Param(p) => {
                    return self.enclosing_scope_of_function(file, bound.param_fn[p.idx()]);
                }
                PatParent::None => return ScopeId(0),
            }
        }
    }

    /// For the name and the initializer of the member `m` of a class, an interface or a type
    /// literal.
    pub(super) fn enclosing_scope_of_member(&self, file: FileId, m: MemberId) -> ScopeId {
        let func = self.hir(file)[m].func;
        if func.is_some() {
            return self.enclosing_scope_of_function(file, func);
        }
        or_file_scope(self.bound(file).member_scope[m.idx()])
    }

    /// For the name of the property `p` of an object literal, or of the JSX attribute `p`.
    pub(super) fn enclosing_scope_of_property(&self, file: FileId, p: PropId) -> ScopeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let prop = hir[p];
        if matches!(
            prop.kind,
            PropKind::Method | PropKind::Getter | PropKind::Setter
        ) && prop.value.is_some()
            && let ExprKind::Fn(f) = hir[prop.value].kind
        {
            return self.enclosing_scope_of_function(file, f);
        }
        let owner = bound.prop_owner[p.idx()];
        if owner.is_none() {
            return ScopeId(0);
        }
        self.enclosing_scope_of_expr(file, owner)
    }

    /// For the name of the declaration `decl`.
    pub(super) fn enclosing_scope_of_declaration(&self, file: FileId, decl: Decl) -> ScopeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        or_file_scope(match decl {
            Decl::Class(c) => bound.class_scope[c.idx()],
            Decl::Fn(f) => bound.fns[f.idx()].scope,
            Decl::Alias(a) => bound.alias_scope[a.idx()],
            Decl::Interface(i) => bound.interface_scope[i.idx()],
            Decl::TypeParam(p) => bound.type_param_scope[p.idx()],
            Decl::Enum(e) => bound.enum_scope[e.idx()],
            Decl::EnumMember(m) => scope_of_enum_member(bound, m),
            Decl::Module(m) => bound.module_scope[m.idx()],
            Decl::ImportEquals(i) => bound.import_equals_scope[i.idx()],
            Decl::ExportSpec(spec) => bound.export_scope[hir[spec].export.idx()],
            Decl::ExportStarAs(s) | Decl::ExportExpr(s) | Decl::UmdGlobal(s) => {
                bound.stmt_scope[s.idx()]
            }
            Decl::ImportDefault(i) | Decl::ImportNamespace(i) => bound.import_scope[i.idx()],
            Decl::ImportSpec(spec) => bound.import_scope[hir[spec].import.idx()],
            _ => ScopeId::NONE,
        })
    }
}
