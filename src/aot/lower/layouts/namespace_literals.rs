use bun_sema::atom::known;
use bun_sema::bind::{Binding, Decl, Parent, PropertyPlace, find_property_place};
use bun_sema::hir::{BinOp, ExprId, ExprKind, PatKind, StmtId, StmtKind, UnOp};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use crate::lower::FileLowering;

struct StoredLiteral {
    place: PropertyPlace,
    is_guarded: bool,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn find_first_namespace_literal(&mut self, literal: ExprId) -> ExprId {
        if !self.hir.is_js || !self.is_empty_literal(literal) {
            return literal;
        }
        let stored = self.find_stored_literal(literal);
        if !stored.is_some_and(|stored| stored.is_guarded) {
            return literal;
        }
        if self.layouts.first_namespace_literals.is_none() {
            self.layouts.first_namespace_literals = Some(self.compute_first_namespace_literals());
        }
        let first = self.layouts.first_namespace_literals.as_ref();
        first
            .and_then(|first| first.get(&literal))
            .copied()
            .unwrap_or(literal)
    }

    fn is_empty_literal(&self, literal: ExprId) -> bool {
        matches!(self.hir[literal].kind, ExprKind::Object(properties) if properties.is_empty())
    }

    fn compute_first_namespace_literals(&self) -> FxHashMap<ExprId, ExprId> {
        let mut first_at_place: FxHashMap<PropertyPlace, ExprId> = FxHashMap::default();
        let mut first_literals = FxHashMap::default();
        for literal in (0..self.hir.exprs.len() as u32).map(ExprId) {
            if self.is_empty_literal(literal)
                && let Some(stored) = self.find_stored_literal(literal)
            {
                let first = *first_at_place.entry(stored.place).or_insert(literal);
                if stored.is_guarded && first != literal {
                    first_literals.insert(literal, first);
                }
            }
        }
        first_literals
    }

    fn find_stored_literal(&self, literal: ExprId) -> Option<StoredLiteral> {
        let (hir, bound) = (self.hir, self.bound);
        let mut value = bound.outermost_type_assertion(hir, literal);
        let mut asked: SmallVec<[ExprId; 2]> = SmallVec::new();
        if let Parent::Expr(parent) = bound.parent_of_expr(value)
            && let ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } = hir[parent.some()?].kind
            && right == value
        {
            asked.push(left);
            value = bound.outermost_type_assertion(hir, parent);
        }
        let mut is_guarded = false;
        let (place, statement) = match bound.parent_of_expr(value) {
            Parent::VarInit(declaration) => {
                let pattern = hir[declaration].pat;
                if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
                    return None;
                }
                let place = PropertyPlace {
                    root: bound.declared_symbol(Decl::Var(pattern)).some()?,
                    names: SmallVec::new(),
                };
                (place, bound.var_stmt[declaration.idx()].some())
            }
            Parent::Expr(assign) => {
                let ExprKind::Assign {
                    op: op @ (None | Some(BinOp::Or | BinOp::Nullish)),
                    target,
                    value: stored,
                } = hir[assign.some()?].kind
                else {
                    return None;
                };
                if stored != value {
                    return None;
                }
                is_guarded = op.is_some();
                let place = find_property_place(hir, bound, target)?;
                let statement = match bound.parent_of_expr(assign) {
                    Parent::Stmt(statement) => statement.some(),
                    Parent::Expr(around) => match hir[around.some()?].kind {
                        ExprKind::Binary {
                            op: BinOp::Or | BinOp::Nullish,
                            left,
                            right,
                        } if right == assign => {
                            asked.push(left);
                            None
                        }
                        _ => None,
                    },
                    _ => None,
                };
                (place, statement)
            }
            _ => return None,
        };
        let test = statement.and_then(|statement| self.find_test_around(statement));
        is_guarded |= test.is_some_and(|test| self.tests_absence(test, &place))
            || asked
                .iter()
                .any(|&asked| find_property_place(hir, bound, asked).as_ref() == Some(&place));
        Some(StoredLiteral { place, is_guarded })
    }

    fn find_test_around(&self, statement: StmtId) -> Option<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut branch = statement;
        loop {
            let Parent::Stmt(around) = bound.parent_of_stmt(branch) else {
                return None;
            };
            match hir[around.some()?].kind {
                StmtKind::If { test, yes, .. } => return (yes == branch).then_some(test),
                StmtKind::Block(_) => branch = around,
                _ => return None,
            }
        }
    }

    fn tests_absence(&self, test: ExprId, place: &PropertyPlace) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let is_place =
            |operand: ExprId| find_property_place(hir, bound, operand).as_ref() == Some(place);
        let is_nothing = |operand: ExprId| match hir[operand].kind {
            ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => true,
            ExprKind::Ident(known::undefined) => bound.binding(operand) == Binding::Free,
            _ => false,
        };
        let names_undefined = |operand: ExprId| matches!(hir[operand].kind, ExprKind::String(text) if text == known::undefined);
        match hir[test].kind {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => is_place(operand),
            ExprKind::Binary {
                op: BinOp::EqEq | BinOp::EqEqEq,
                left,
                right,
            } => [(left, right), (right, left)]
                .iter()
                .any(|&(asked, other)| match hir[asked].kind {
                    ExprKind::Unary {
                        op: UnOp::Typeof,
                        operand,
                    } => names_undefined(other) && is_place(operand),
                    _ => is_nothing(other) && is_place(asked),
                }),
            _ => false,
        }
    }
}
