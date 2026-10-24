mod leaf_test;
mod tested_field;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::SymbolId;
use bun_sema::hir::{BinOp, ExprId, ExprKind, UnOp};
use smallvec::SmallVec;

use self::leaf_test::{LeafTest, TypeofName};
use super::expression::{AssignmentTarget, Evaluation, Tail};
use super::{FileLowering, FunctionLowering, operator, scope};
use crate::ir::{BlockId, Edge, TypeId, TypeTable, ValueId};

pub(in crate::lower) use self::tested_field::TestedField;

#[derive(Copy, Clone, Debug)]
pub(crate) struct Split {
    pub(crate) taken: BlockId,
    pub(crate) taken_value: ValueId,
    pub(crate) not_taken: BlockId,
    pub(crate) not_taken_value: ValueId,
}

#[derive(Copy, Clone)]
enum TestedOperand {
    Local(SymbolId),
    Field(TestedField),
}

fn order_targets(is_negated: bool, if_true: BlockId, if_false: BlockId) -> (BlockId, BlockId) {
    if is_negated {
        (if_false, if_true)
    } else {
        (if_true, if_false)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_condition(
        &mut self,
        expression: ExprId,
        if_true: BlockId,
        if_false: BlockId,
    ) {
        let position = self.file.hir[expression].pos;
        if !self.enter_nesting(position) {
            self.jump(if_false);
            return;
        }
        self.set_position(position);
        if self.file.decisions().is_truthy_without_effects(expression) {
            // `if (module)`: nothing is read, so that the test makes no module object.
            let value = self.builder.boolean(true);
            self.branch_on_truthiness(None, value, if_true, if_false);
        } else if self.file.is_statically_resolved(expression) {
            self.lower_truthiness(expression, if_true, if_false);
        } else {
            self.lower_condition_by_kind(expression, if_true, if_false);
        }
        self.leave_nesting();
    }

    pub(crate) fn split_on_type(&mut self, value: ValueId, tested: TypeId) -> Split {
        let test = self.builder.type_test(value, tested);
        self.split_on_test(test)
    }

    pub(crate) fn split_on_truthiness(&mut self, value: ValueId) -> Split {
        let test = self.builder.to_boolean(value);
        self.split_on_test(test)
    }

    pub(crate) fn branch_if_nullish(&mut self, value: ValueId, if_nullish: BlockId) -> ValueId {
        let split = self.split_on_type(value, TypeTable::NULLISH);
        self.jump_if_taken(split, if_nullish)
    }

    pub(crate) fn branch_if_undefined(&mut self, value: ValueId, if_undefined: BlockId) -> ValueId {
        let split = self.split_on_type(value, TypeTable::UNDEFINED);
        self.jump_if_taken(split, if_undefined)
    }

    pub(in crate::lower) fn split_expression_on_type(
        &mut self,
        tested: Option<ExprId>,
        value: ValueId,
        tested_type: TypeId,
    ) -> Split {
        let subject = tested.and_then(|expression| self.find_subject(expression, value));
        let split = self.split_on_type(value, tested_type);
        self.rebind_on_edges(subject, split);
        split
    }

    pub(in crate::lower) fn split_expression_on_truthiness(
        &mut self,
        tested: Option<ExprId>,
        value: ValueId,
    ) -> Split {
        let subject = tested.and_then(|expression| self.find_subject(expression, value));
        let split = self.split_on_truthiness(value);
        self.rebind_on_edges(subject, split);
        split
    }

    pub(in crate::lower) fn branch_if_expression_nullish(
        &mut self,
        tested: ExprId,
        value: ValueId,
        if_nullish: BlockId,
    ) -> ValueId {
        let split = self.split_expression_on_type(Some(tested), value, TypeTable::NULLISH);
        self.jump_if_taken(split, if_nullish)
    }

    pub(in crate::lower) fn try_lower_test_value(&mut self, expression: ExprId) -> Option<ValueId> {
        match self.classify_test(expression) {
            LeafTest::Type {
                operand,
                is_typeof,
                tested,
                is_negated,
            } => {
                let value = self.lower_tested_operand(operand, is_typeof);
                self.set_position(self.file.hir[expression].pos);
                let test = self.builder.type_test(value, tested);
                Some(match is_negated {
                    true => self.builder.logical_not(test),
                    false => test,
                })
            }
            LeafTest::TypeofObject { .. } => Some(self.lower_condition_as_value(expression)),
            LeafTest::Truthiness
            | LeafTest::NumberQuestion { .. }
            | LeafTest::Comparison { .. } => None,
        }
    }

    fn split_on_test(&mut self, test: ValueId) -> Split {
        let taken = self.create_block();
        let not_taken = self.create_block();
        let taken_value = self.builder.add_edge_result(taken);
        let not_taken_value = self.builder.add_edge_result(not_taken);
        self.builder.branch(
            test,
            Edge::with_proofs(taken, &[0]),
            Edge::with_proofs(not_taken, &[0]),
        );
        self.builder.seal(taken);
        self.builder.seal(not_taken);
        Split {
            taken,
            taken_value,
            not_taken,
            not_taken_value,
        }
    }

    fn jump_if_taken(&mut self, split: Split, on_taken: BlockId) -> ValueId {
        self.builder.switch_to(split.taken);
        self.jump(on_taken);
        self.builder.switch_to(split.not_taken);
        split.not_taken_value
    }

    fn finish_split(&mut self, split: Split, on_taken: BlockId, on_not_taken: BlockId) {
        self.jump_if_taken(split, on_taken);
        self.jump(on_not_taken);
    }

    fn find_subject(&mut self, expression: ExprId, value: ValueId) -> Option<SymbolId> {
        let identifier = self.file.tested_identifier(expression)?;
        let symbol = scope::find_tested_local(self, identifier)?;
        (self.lower_identifier(identifier) == value).then_some(symbol)
    }

    fn rebind_on_edges(&mut self, subject: Option<SymbolId>, split: Split) {
        let Some(symbol) = subject else {
            return;
        };
        self.builder.switch_to(split.taken);
        self.rebind_local(symbol, split.taken_value);
        self.builder.switch_to(split.not_taken);
        self.rebind_local(symbol, split.not_taken_value);
    }

    fn lower_condition_by_kind(&mut self, expression: ExprId, if_true: BlockId, if_false: BlockId) {
        let hir = self.file.hir;
        match hir[expression].kind {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => self.lower_condition(operand, if_false, if_true),
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or),
                ..
            } => {
                let operands = self.file.collect_logical_operands(expression, op);
                let Some((&last, leading)) = operands.split_last() else {
                    unreachable!("a logical condition has a left operand");
                };
                for &operand in leading {
                    let next = self.create_block();
                    let (on_true, on_false) = if op == BinOp::And {
                        (next, if_false)
                    } else {
                        (if_true, next)
                    };
                    self.lower_condition(operand, on_true, on_false);
                    self.continue_in(next);
                }
                self.lower_condition(last, if_true, if_false);
            }
            ExprKind::Binary {
                op: BinOp::Nullish,
                left,
                right,
            } => {
                if self.file.decisions().is_dead_expr(right) {
                    return self.lower_truthiness(expression, if_true, if_false);
                }
                let value = self.lower_expression(left);
                self.set_position(hir[expression].pos);
                let right_block = self.create_block();
                let present = self.branch_if_expression_nullish(left, value, right_block);
                self.branch_on_truthiness(Some(left), present, if_true, if_false);
                self.continue_in(right_block);
                self.lower_condition(right, if_true, if_false);
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } => {
                self.lower_expression_for_effect(left);
                self.lower_condition(right, if_true, if_false);
            }
            ExprKind::Cond { .. } => {
                self.lower_conditional_arms(expression, false, &mut |lowering, arm| {
                    lowering.lower_condition(arm, if_true, if_false);
                });
            }
            ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Instantiation { expr: operand, .. } => {
                self.lower_condition(operand, if_true, if_false);
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_)
                if self.file.is_chain_root(expression) =>
            {
                let exit = self.create_block();
                let evaluation = Evaluation::in_chain(exit, Tail::No);
                let value = self.lower_expression_in(expression, evaluation);
                self.set_position(hir[expression].pos);
                self.branch_on_truthiness(None, value, if_true, if_false);
                self.continue_in(exit);
                self.jump(if_false);
            }
            _ => self.lower_leaf_test(expression, if_true, if_false),
        }
    }

    fn lower_truthiness(&mut self, expression: ExprId, if_true: BlockId, if_false: BlockId) {
        let value = self.lower_expression(expression);
        self.set_position(self.file.hir[expression].pos);
        self.branch_on_truthiness(Some(expression), value, if_true, if_false);
    }

    fn branch_on_truthiness(
        &mut self,
        tested: Option<ExprId>,
        value: ValueId,
        if_true: BlockId,
        if_false: BlockId,
    ) {
        let split = self.split_expression_on_truthiness(tested, value);
        self.finish_split(split, if_true, if_false);
    }

    fn lower_leaf_test(&mut self, expression: ExprId, if_true: BlockId, if_false: BlockId) {
        match self.classify_test(expression) {
            LeafTest::Truthiness => self.lower_truthiness(expression, if_true, if_false),
            LeafTest::Type {
                operand,
                is_typeof,
                tested,
                is_negated,
            } => {
                let value = self.lower_tested_operand(operand, is_typeof);
                self.set_position(self.file.hir[expression].pos);
                let split = self.split_expression_on_type(Some(operand), value, tested);
                let (passed, failed) = order_targets(is_negated, if_true, if_false);
                self.finish_split(split, passed, failed);
            }
            LeafTest::TypeofObject {
                operand,
                is_negated,
            } => {
                let (passed, failed) = order_targets(is_negated, if_true, if_false);
                let value = self.lower_typeof_operand(operand);
                self.set_position(self.file.hir[expression].pos);
                self.jump_by_typeof(operand, value, &[(known::object, passed)], failed);
            }
            LeafTest::NumberQuestion { question, operand } => {
                let value = self.lower_operand_of_question(expression, operand);
                self.set_position(self.file.hir[expression].pos);
                let split = self.split_expression_on_type(Some(operand), value, TypeTable::NUMBER);
                self.builder.switch_to(split.not_taken);
                self.jump(if_false);
                self.builder.switch_to(split.taken);
                let number = split.taken_value;
                let answer = self.emit_number_question(expression, question, number);
                self.branch_on_truthiness(None, answer, if_true, if_false);
            }
            LeafTest::Comparison { op, left, right } => {
                self.lower_comparison(expression, op, left, right, if_true, if_false);
            }
        }
    }

    fn lower_tested_operand(&mut self, operand: ExprId, is_typeof: bool) -> ValueId {
        if is_typeof {
            self.lower_typeof_operand(operand)
        } else {
            self.lower_expression(operand)
        }
    }

    /// `switch (typeof operand)` over written names, and `typeof operand === "object"`.
    pub(in crate::lower) fn jump_by_typeof(
        &mut self,
        operand: ExprId,
        value: ValueId,
        cases: &[(Atom, BlockId)],
        otherwise: BlockId,
    ) {
        let find_target = |name: Atom| cases.iter().find(|case| case.0 == name).map(|case| case.1);
        let mut remaining = value;
        if let Some(on_object) = find_target(known::object) {
            let on_function = find_target(known::function).unwrap_or(otherwise);
            let split =
                self.split_expression_on_type(Some(operand), remaining, TypeTable::FUNCTION);
            remaining = self.jump_if_taken(split, on_function);
            let types = &mut self.file.fragment.types;
            let object_or_null = types.union(TypeTable::OBJECT, TypeTable::NULL);
            let split = self.split_expression_on_type(Some(operand), remaining, object_or_null);
            remaining = self.jump_if_taken(split, on_object);
        }
        let mut seen: SmallVec<[Atom; 8]> = SmallVec::new();
        for &(name, target) in cases {
            let Some(TypeofName::Type(tested)) = leaf_test::typeof_name(name) else {
                continue;
            };
            let is_tested_above = name == known::function && find_target(known::object).is_some();
            if is_tested_above || seen.contains(&name) {
                continue;
            }
            seen.push(name);
            let split = self.split_expression_on_type(Some(operand), remaining, tested);
            remaining = self.jump_if_taken(split, target);
        }
        self.jump(otherwise);
    }

    fn lower_comparison(
        &mut self,
        expression: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        if_true: BlockId,
        if_false: BlockId,
    ) {
        let left_value = self.lower_expression(left);
        let left_field = self.find_compared_field(op, left, right);
        let right_value = self.lower_expression(right);
        let left_field = left_field.filter(|&field| self.is_holder_unchanged(field));
        let right_field = self.find_compared_field(op, right, left);
        self.set_position(self.file.hir[expression].pos);
        let left_subject = self.find_subject(left, left_value);
        let right_subject = self.find_subject(right, right_value);
        let right_subject = right_subject.filter(|&symbol| Some(symbol) != left_subject);
        let select = |local: Option<SymbolId>, field: Option<TestedField>| {
            let local = local.map(TestedOperand::Local);
            local.or_else(|| field.map(TestedOperand::Field))
        };
        let subjects = [
            select(left_subject, left_field),
            select(right_subject, right_field),
        ];
        let (test, is_negated) = operator::emit_comparison(self, op, left_value, right_value);
        let (on_taken, on_not_taken) = order_targets(is_negated, if_true, if_false);
        if let [None, None] = subjects {
            let (taken, not_taken) = (Edge::to(on_taken), Edge::to(on_not_taken));
            self.builder.branch(test, taken, not_taken);
            return;
        }
        let [taken, not_taken] = self.split_on_comparison(test, subjects);
        self.builder.switch_to(taken);
        self.jump(on_taken);
        self.builder.switch_to(not_taken);
        self.jump(on_not_taken);
    }

    fn find_compared_field(
        &mut self,
        op: BinOp,
        tested: ExprId,
        other: ExprId,
    ) -> Option<TestedField> {
        if !matches!(op, BinOp::EqEqEq | BinOp::NotEqEq) {
            return None;
        }
        self.find_tested_field(tested)
            .filter(|_| self.file.has_unit_type(other))
    }

    fn split_on_comparison(
        &mut self,
        test: ValueId,
        subjects: [Option<TestedOperand>; 2],
    ) -> [BlockId; 2] {
        let taken = self.create_block();
        let not_taken = self.create_block();
        let mut proofs: SmallVec<[u32; 2]> = SmallVec::new();
        let mut narrowed: SmallVec<[(TestedOperand, [ValueId; 2]); 2]> = SmallVec::new();
        for (operand, subject) in (0u32..).zip(subjects) {
            let Some(subject) = subject else {
                continue;
            };
            let taken_value = self.builder.add_edge_result(taken);
            let not_taken_value = self.builder.add_edge_result(not_taken);
            proofs.push(operand);
            narrowed.push((subject, [taken_value, not_taken_value]));
        }
        self.builder.branch(
            test,
            Edge::with_proofs(taken, &proofs),
            Edge::with_proofs(not_taken, &proofs),
        );
        self.builder.seal(taken);
        self.builder.seal(not_taken);
        let mut ends = [taken, not_taken];
        for (edge, end) in ends.iter_mut().enumerate() {
            self.builder.switch_to(*end);
            for &(subject, values) in &narrowed {
                match subject {
                    TestedOperand::Local(symbol) => self.rebind_local(symbol, values[edge]),
                    TestedOperand::Field(field) => {
                        self.narrow_holder(field, values[edge]);
                    }
                }
            }
            *end = self.builder.current_block();
        }
        ends
    }

    fn lower_condition_as_value(&mut self, expression: ExprId) -> ValueId {
        let passed = self.create_block();
        let failed = self.create_block();
        let join = self.create_block();
        let result = self.builder.create_variable(None);
        self.lower_condition(expression, passed, failed);
        for (block, outcome) in [(passed, true), (failed, false)] {
            self.continue_in(block);
            let value = self.builder.boolean(outcome);
            self.builder.write_variable(result, value);
            self.jump(join);
        }
        self.continue_in(join);
        self.builder.read_variable(result)
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn tested_identifier(&self, expression: ExprId) -> Option<ExprId> {
        let inner = self.skip_type_syntax(expression);
        match self.hir[inner].kind {
            ExprKind::Ident(_) => Some(inner),
            ExprKind::Assign {
                op: None, target, ..
            } => match self.classify_assignment_target(target) {
                AssignmentTarget::Identifier { identifier, .. } => Some(identifier),
                _ => None,
            },
            _ => None,
        }
    }

    fn collect_logical_operands(&self, expression: ExprId, op: BinOp) -> SmallVec<[ExprId; 8]> {
        let mut operands = SmallVec::new();
        let mut current = expression;
        while let ExprKind::Binary {
            op: current_op,
            left,
            right,
        } = self.hir[current].kind
        {
            if current_op != op || (current != expression && self.is_statically_resolved(current)) {
                break;
            }
            if !self.decisions().is_dead_expr(right) {
                operands.push(right);
            }
            current = left;
        }
        operands.push(current);
        operands.reverse();
        operands
    }
}
