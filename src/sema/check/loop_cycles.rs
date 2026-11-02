//! Decides which cycles through a loop's back edge also occur in TypeScript.

use super::*;
use crate::bind::{Decl, Parent, PatParent};

impl<'p, 's> Checker<'p, 's> {
    /// True if every query from `stack[i]` up is one TypeScript also makes, regardless of query order:
    /// - the type of a variable, parameter, class property or pattern element inferred from an
    ///   initializer (`checkDeclarationInitializer`)
    /// - the type of a variable inferred from what a `for` statement iterates (`checkRightHandSideOfForOf`)
    /// - the type of a property inferred from assignments to it (`getWidenedTypeForAssignmentDeclaration`)
    /// - the type of an expression, whose operands `checkExpression` checks
    /// - a function's return type
    /// - a call that's being resolved
    ///
    /// What TypeScript defers (a class expression's members) is behind another query.
    pub(super) fn is_cycle_of_initializers(&self, i: usize) -> bool {
        // An annotation is resolved where it's requested, while the loop is in progress, and `typeof x` checks
        // `x` uncached. So a cycle through an annotation that closes at a type resolution also occurs in tsgo.
        let closes_at_resolution = self.is_resolution(self.stack[i]);
        self.stack[i..].iter().all(|&q| match q {
            Query::Expr(..)
            | Query::LiteralProp(..)
            | Query::Call(..)
            | Query::Return(..)
            | Query::ReturnOfSignature(_)
            | Query::ReturnAtFirstLook(..)
            | Query::InitializerIsUndefined(..) => true,
            Query::Symbol(sym) => {
                let flags = self.files().flags(sym);
                flags.intersects(SymFlags::VARIABLE)
                    || flags.intersects(SymFlags::ACCESSOR) && self.is_typed_by_getter_body(sym)
                    || match self.files().value_declaration(sym) {
                        // Without an initializer, the type comes from the assignments in the constructor.
                        Some((file, Decl::Member(m))) => {
                            let member = &self.hir(file)[m];
                            member.kind == MemberKind::Property
                                && (member.ty.is_none() || closes_at_resolution)
                        }
                        Some((_, Decl::Expando(_) | Decl::ThisProperty(_))) => true,
                        _ => false,
                    }
            }
            Query::Pat(file, pat) | Query::ParameterSymbol(file, pat) => {
                let (hir, bound) = (self.hir(file), self.bound(file));
                match root_declaration(bound, pat) {
                    PatParent::Var(d) => {
                        hir[d].ty.is_some() && closes_at_resolution
                            || hir[d].ty.is_none() && hir[d].init.is_some()
                            || self.is_variable_of_for_in_or_of(file, d)
                    }
                    PatParent::Param(p) => match hir[p].ty.is_some() {
                        true => closes_at_resolution,
                        false => hir[p].default.is_some(),
                    },
                    _ => false,
                }
            }
            // What tsgo defers (members, conditional types) is behind another query.
            Query::TypeNode(file, node) => {
                closes_at_resolution
                    && matches!(
                        self.hir(file)[node].kind,
                        TypeNodeKind::Typeof { .. }
                            | TypeNodeKind::Ref { .. }
                            | TypeNodeKind::Array(_)
                            | TypeNodeKind::Tuple(_)
                            | TypeNodeKind::Union(_)
                    )
            }
            // `getDeclaredTypeOfTypeAlias`
            Query::Declared(sym) => {
                closes_at_resolution && self.files().flags(sym).contains(SymFlags::TYPE_ALIAS)
            }
            _ => false,
        })
    }

    /// True if `getTypeOfAccessors` infers the type of the accessor property `sym` from its
    /// getter's body (`getReturnTypeFromBody`), that is, neither accessor has an annotation.
    fn is_typed_by_getter_body(&self, sym: Sym) -> bool {
        let mut has_getter = false;
        for (file, decl) in self.files().decls_of(sym) {
            let Decl::Member(m) = decl else { return false };
            let hir = self.hir(file);
            let member = &hir[m];
            match member.kind {
                MemberKind::Getter if hir[member.func].ret.is_none() => has_getter = true,
                MemberKind::Setter
                    if hir[member.func]
                        .effective_set_accessor_type_annotation_node(hir)
                        .is_none() => {}
                // `accessor x = e` is a property with an initializer and has no function.
                MemberKind::Property if member.ty.is_none() && member.init.is_some() => {
                    has_getter = true;
                }
                _ => return false,
            }
        }
        has_getter
    }

    /// True if `d` is declared in the head of a `for (.. in ..)` or `for (.. of ..)`. Its type then
    /// comes from the statement's expression, regardless of any annotation or initializer.
    fn is_variable_of_for_in_or_of(&self, file: FileId, d: VarDeclId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let stmt = bound.var_stmt[d.idx()];
        stmt.is_some()
            && matches!(bound.parent_of_stmt(stmt), Parent::Stmt(parent)
                if matches!(hir[parent].kind,
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt))
    }
}
