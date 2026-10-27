use super::evaluate::Value;
use super::folder::Folder;
use crate::bind::CommonJsVariable;
use crate::hir::{
    BinOp, ExprId, ExprKind, FnBody, IdList, PatKind, StmtId, StmtKind, UnOp, VarKind,
};
use crate::import_sites::is_free_common_js;

#[derive(Copy, Clone)]
pub(super) struct ExcludedOperand {
    pub(super) operand: ExprId,
    pub(super) is_excluded_by_bun_run: bool,
}

/// A build folds what `bun run` leaves alone: defines, what every executable has, variables that are stored once.
/// Whether a file is CommonJS goes by what `bun run` folds, so each folded expression remembers who can fold it.
impl Folder<'_, '_> {
    pub(super) fn mark_folded_by_build_alone(&mut self, e: ExprId) {
        self.folded_by_build_alone.insert(e.idx());
    }

    pub(super) fn is_folded_by_bun_run(&self, e: ExprId) -> bool {
        !self.folded_by_build_alone.contains(e.idx())
    }

    /// `bun run` puts the value of a constant in place of its reads only where nothing but declarations of constants
    /// stands in front of it in its list of statements.
    pub(super) fn is_in_constant_prefix(&self, init: ExprId) -> bool {
        let initializers = self.initializers_in_constant_prefixes.get_or_init(|| {
            let hir = self.hir;
            let mut initializers = Vec::new();
            self.push_constant_prefix(hir.body, &mut initializers);
            for function in hir.fns.iter() {
                if let FnBody::Block(statements) = function.body {
                    self.push_constant_prefix(statements, &mut initializers);
                }
            }
            for statement in hir.stmts.iter() {
                if let StmtKind::Block(statements) = statement.kind {
                    self.push_constant_prefix(statements, &mut initializers);
                }
            }
            initializers.sort_unstable();
            initializers
        });
        initializers.binary_search(&init).is_ok()
    }

    fn push_constant_prefix(&self, statements: IdList<StmtId>, initializers: &mut Vec<ExprId>) {
        let hir = self.hir;
        for statement in hir.ids(statements) {
            match hir[statement].kind {
                StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Directive { .. }
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_) => {}
                StmtKind::Var(declarations) => {
                    for declaration in declarations.iter() {
                        let declaration = &hir[declaration];
                        if !matches!(hir[declaration.pat].kind, PatKind::Ident(_)) {
                            continue;
                        }
                        if declaration.kind != VarKind::Const {
                            return;
                        }
                        initializers.extend(declaration.init.some());
                    }
                }
                _ => return,
            }
        }
    }

    pub(super) fn condition_in_bun_run(&self, e: ExprId) -> Option<bool> {
        self.condition(e).filter(|_| self.is_folded_by_bun_run(e))
    }

    /// As a condition, `void x` is false and `typeof x` is true whatever `x` is.
    pub(super) fn is_truthy_in_bun_run(&self, e: ExprId) -> Option<bool> {
        let (mut e, mut is_negated) = (e, false);
        let is_truthy = loop {
            match self.hir[e].kind {
                ExprKind::Unary {
                    op: UnOp::Not,
                    operand,
                } => {
                    (e, is_negated) = (operand, !is_negated);
                }
                ExprKind::Unary { op: UnOp::Void, .. } => break Some(false),
                ExprKind::Unary {
                    op: UnOp::Typeof, ..
                } => break Some(true),
                _ => break self.condition_in_bun_run(e),
            }
        };
        is_truthy.map(|is_truthy| is_truthy != is_negated)
    }

    pub(super) fn exclude_operand(&mut self, operand: ExprId, decided_by: ExprId) {
        self.excluded_operands.push(ExcludedOperand {
            operand,
            is_excluded_by_bun_run: self.is_folded_by_bun_run(decided_by),
        });
    }

    pub(super) fn has_operand_folded_by_build_alone(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let by_build_alone = |operand: ExprId| !self.is_folded_by_bun_run(operand);
        match hir[e].kind {
            ExprKind::Unary { op, operand } => {
                let require = CommonJsVariable::Require;
                let is_type_of_require =
                    op == UnOp::Typeof && is_free_common_js(hir, self.bound, operand, require);
                !is_type_of_require && by_build_alone(operand)
            }
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma => by_build_alone(right),
                BinOp::EqEq | BinOp::NotEq if self.converts_an_operand(left, right) => true,
                _ if !by_build_alone(left) && !by_build_alone(right) => false,
                BinOp::And => !self.is_logical_result_known_to_bun_run(left, right, false),
                BinOp::Or => !self.is_logical_result_known_to_bun_run(left, right, true),
                BinOp::Nullish => by_build_alone(left) || self.is_nullish(left) != Some(false),
                _ => true,
            },
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let is_selected = |when: bool| self.condition(test) != Some(!when);
                by_build_alone(test)
                    || (is_selected(true) && by_build_alone(branches.yes))
                    || (is_selected(false) && by_build_alone(branches.no))
            }
            ExprKind::Template { exprs } => hir.ids(exprs).any(by_build_alone),
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => by_build_alone(expr),
            _ => false,
        }
    }

    /// `x && false` is false and `x || true` is true whatever `x` is.
    fn is_logical_result_known_to_bun_run(
        &self,
        left: ExprId,
        right: ExprId,
        deciding_condition: bool,
    ) -> bool {
        let (left, right) = (
            self.condition_in_bun_run(left),
            self.condition_in_bun_run(right),
        );
        let is_decided_by_one = [left, right].contains(&Some(deciding_condition));
        is_decided_by_one || (left.is_some() && right.is_some())
    }

    /// `bun run` computes with two numbers and leaves `undefined + 1` alone.
    pub(super) fn converts_an_operand_to_a_number(&self, e: ExprId) -> bool {
        let ExprKind::Binary { op, left, right } = self.hir[e].kind else {
            return false;
        };
        let is_arithmetic = matches!(
            op,
            BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow
        );
        let is_number = |operand: ExprId| self.folded(operand).value.is_number();
        is_arithmetic && !(is_number(left) && is_number(right))
    }

    fn converts_an_operand(&self, left: ExprId, right: ExprId) -> bool {
        let (Value::Known(left), Value::Known(right)) =
            (self.folded(left).value, self.folded(right).value)
        else {
            return false;
        };
        let evaluator = &self.evaluator;
        let (is_left_nullish, is_right_nullish) =
            (evaluator.is_nullish(left), evaluator.is_nullish(right));
        let (left, right) = (evaluator.to_constant(left), evaluator.to_constant(right));
        !(is_left_nullish && is_right_nullish)
            && std::mem::discriminant(&left) != std::mem::discriminant(&right)
    }
}
