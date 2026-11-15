use super::resolver::Resolver;
use super::written_members::holder_of;
use crate::builtins::table::{self, BuiltinId, MemberLookup};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{BinOp, ExprId, ExprKind, MemberKey, NodeData, StmtId, StmtKind, UnOp};

#[derive(Copy, Clone)]
enum Node {
    Expr(ExprId),
    Stmt(StmtId),
}

impl Resolver<'_, '_> {
    fn find_member_under(&self, holder: ExprId, name: Atom) -> Option<BuiltinId> {
        let holder = holder_of(self.value_of(holder)?.path.id);
        match table::member(holder, self.input.names.get(name)?) {
            MemberLookup::Found(member) => Some(table::canonical_id(member)),
            MemberLookup::Unknown | MemberLookup::Absent => None,
        }
    }

    fn find_variable_named(&self, name: ExprId) -> Option<SymbolId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        match (hir[name].kind, bound.binding(name)) {
            (ExprKind::Ident(_), Binding::Symbol(variable))
                if bound.dynamic_lookup_scope(NodeData::Expr(name)).is_none() =>
            {
                Some(variable)
            }
            _ => None,
        }
    }

    fn reads_member(&self, value: ExprId, member: BuiltinId, filled: Option<SymbolId>) -> bool {
        let hir = self.input.hir;
        let mut value = hir.skip_type_assertions(value);
        while let ExprKind::Assign {
            op: None,
            value: stored,
            ..
        } = hir[value].kind
        {
            value = hir.skip_type_assertions(stored);
        }
        if let (ExprKind::Ident(_), Some(filled)) = (hir[value].kind, filled) {
            return self.find_variable_named(value) == Some(filled);
        }
        if let Some(exact) = self.value_of(value) {
            return table::canonical_id(exact.path.id) == member;
        }
        let Some((object, MemberKey::Name(name))) = hir.member_key(value) else {
            return false;
        };
        match hir[hir.skip_type_assertions(object)].kind {
            ExprKind::Assign {
                op: None,
                value: holder,
                ..
            } => self.find_member_under(holder, name) == Some(member),
            _ => false,
        }
    }

    fn find_variable_filled_with_member(
        &self,
        test: ExprId,
        member: BuiltinId,
    ) -> Option<SymbolId> {
        let hir = self.input.hir;
        let ExprKind::Binary { op, left, right } = hir[hir.skip_type_assertions(test)].kind else {
            return None;
        };
        let right_always_runs = !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish);
        let operands = [Some(left), right_always_runs.then_some(right)];
        operands.into_iter().flatten().find_map(|operand| {
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[hir.skip_type_assertions(operand)].kind
            else {
                return None;
            };
            self.find_variable_named(target)
                .filter(|_| self.reads_member(value, member, None))
        })
    }

    /// Nothing in `test` may give the variable another value: no other store into it, and nothing that runs code.
    fn leaves_variable_filled(&self, test: ExprId, member: BuiltinId, variable: SymbolId) -> bool {
        let hir = self.input.hir;
        let leaves = |part: ExprId| self.leaves_variable_filled(part, member, variable);
        let test = hir.skip_type_assertions(test);
        match hir[test].kind {
            ExprKind::Ident(_) => self.find_variable_named(test).is_some(),
            ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_) => true,
            ExprKind::Unary {
                op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                operand,
            } => leaves(operand),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::EqEqEq | BinOp::NotEqEq,
                left,
                right,
            } => leaves(left) && leaves(right),
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => match self.find_variable_named(target) {
                Some(stored) if stored == variable => self.reads_member(value, member, None),
                Some(_) => leaves(value),
                None => false,
            },
            _ => false,
        }
    }

    fn is_member_beside_what_says_missing(
        &self,
        value: ExprId,
        with: ExprId,
        member: BuiltinId,
        filled: Option<SymbolId>,
    ) -> bool {
        let (hir, decisions) = (self.input.hir, self.input.decisions);
        let value = hir.skip_type_assertions(value);
        let with = decisions.constant(hir, hir.skip_type_assertions(with));
        match (hir[value].kind, with) {
            (
                ExprKind::Unary {
                    op: UnOp::Typeof,
                    operand,
                },
                FoldedValue::Constant(Constant::String(text)),
            ) => text == known::undefined && self.reads_member(operand, member, filled),
            (_, FoldedValue::Constant(Constant::Undefined | Constant::Null)) => {
                self.reads_member(value, member, filled)
            }
            _ => false,
        }
    }

    fn find_answer_where_member_is_there(
        &self,
        test: ExprId,
        member: BuiltinId,
        filled: Option<SymbolId>,
    ) -> Option<bool> {
        let (hir, decisions) = (self.input.hir, self.input.decisions);
        let test = hir.skip_type_assertions(test);
        if self.reads_member(test, member, filled) {
            return Some(true);
        }
        let answer = |test: ExprId| self.find_answer_where_member_is_there(test, member, filled);
        let answer_behind = |left: ExprId, right: ExprId| {
            let filled = self
                .find_variable_filled_with_member(left, member)
                .or(filled)
                .filter(|&variable| self.leaves_variable_filled(left, member, variable));
            self.find_answer_where_member_is_there(right, member, filled)
        };
        match hir[test].kind {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => answer(operand).map(|it| !it),
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => match (answer(left), answer_behind(left, right)) {
                (Some(false), _) | (_, Some(false)) => Some(false),
                (Some(true), Some(true)) => Some(true),
                _ => None,
            },
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => match (answer(left), answer_behind(left, right)) {
                (Some(true), _) | (_, Some(true)) => Some(true),
                (Some(false), Some(false)) => Some(false),
                _ => None,
            },
            ExprKind::Binary {
                op: op @ (BinOp::EqEq | BinOp::EqEqEq | BinOp::NotEq | BinOp::NotEqEq),
                left,
                right,
            } => {
                let says_missing = self
                    .is_member_beside_what_says_missing(left, right, member, filled)
                    || self.is_member_beside_what_says_missing(right, left, member, filled);
                says_missing.then_some(matches!(op, BinOp::NotEq | BinOp::NotEqEq))
            }
            ExprKind::Binary {
                op: BinOp::In,
                left,
                right,
            } => match decisions.constant(hir, hir.skip_type_assertions(left)) {
                FoldedValue::Constant(Constant::String(name))
                | FoldedValue::ConstantOutsideDeadZone(Constant::String(name)) => {
                    (self.find_member_under(right, name)? == member).then_some(true)
                }
                _ => None,
            },
            _ => None,
        }
    }

    pub(super) fn is_behind_test_that_finds_member_missing(
        &self,
        write: ExprId,
        member: BuiltinId,
    ) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = Node::Expr(write);
        loop {
            let parent = match node {
                Node::Expr(expr) => bound.parent_of_expr(expr),
                Node::Stmt(stmt) => bound.parent_of_stmt(stmt),
            };
            let passed_over_by = match (parent, node) {
                (Parent::Expr(parent), Node::Expr(child)) => match hir[parent].kind {
                    ExprKind::Cond { test, branches } if child == hir.branches(branches).yes => {
                        Some((test, false))
                    }
                    ExprKind::Cond { test, branches } if child == hir.branches(branches).no => {
                        Some((test, true))
                    }
                    ExprKind::Binary {
                        op: BinOp::Or | BinOp::Nullish,
                        left,
                        right,
                    } if child == right => Some((left, true)),
                    ExprKind::Binary {
                        op: BinOp::And,
                        left,
                        right,
                    } if child == right => Some((left, false)),
                    _ => None,
                },
                (Parent::Stmt(parent), Node::Stmt(child)) => match hir[parent].kind {
                    StmtKind::If { test, yes, .. } if child == yes => Some((test, false)),
                    StmtKind::If { test, no, .. } if child == no => Some((test, true)),
                    _ => None,
                },
                _ => None,
            };
            if let Some((test, answer)) = passed_over_by
                && self.find_answer_where_member_is_there(test, member, None) == Some(answer)
            {
                return true;
            }
            node = match parent {
                Parent::Expr(parent) => Node::Expr(parent),
                Parent::Stmt(parent) => Node::Stmt(parent),
                _ => return false,
            };
        }
    }
}
