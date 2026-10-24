use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use super::inputs::RuntimeValueKind;
use super::{Constant, Decision, literal_constant};
use crate::atom::{Atom, known};
use crate::bind::CommonJsVariable;
use crate::hir::{BinOp, Branches, ExprId, ExprKind, IdList, UnOp};
use crate::import_sites::is_free_common_js;

#[derive(Copy, Clone)]
enum LogicalOperator {
    And,
    Or,
    Nullish,
}

impl<'s> Folder<'_, 's> {
    pub(super) fn fold_expr(&mut self, e: ExprId) -> Folded {
        let hir = self.hir;
        let kind = hir[e].kind;
        match kind {
            ExprKind::Unary { op, operand } => self.fold_unary(op, operand),
            ExprKind::Binary { op, left, right } => self.fold_binary(e, op, left, right),
            ExprKind::Cond { test, branches } => {
                self.fold_conditional(e, test, hir.branches(branches))
            }
            ExprKind::Template { exprs } => self.fold_template(exprs),
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.fold_cast(e, expr),
            ExprKind::Ident(name) => self.fold_ident(e, name),
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                match self.fold_short_circuit(e, obj, chain) {
                    Some(folded) => folded,
                    None => self.fold_member(e, chain),
                }
            }
            ExprKind::ImportMeta => self.fold_import_meta(e),
            ExprKind::This => self.fold_this(e),
            ExprKind::Call(call) => self.fold_call(e, hir[call]),
            ExprKind::ImportCall { args } => self.fold_import_call(args),
            ExprKind::Array(items) => {
                self.note_array_literal(e, items);
                self.conditions.insert(e, true);
                Folded::UNKNOWN
            }
            ExprKind::Object(props) => {
                self.note_object_literal(e, props);
                self.conditions.insert(e, true);
                Folded::UNKNOWN
            }
            ExprKind::Regex { .. } | ExprKind::Fn(_) | ExprKind::Class(_) => {
                self.conditions.insert(e, true);
                Folded::UNKNOWN
            }
            _ => literal_constant(hir, kind).map_or(Folded::UNKNOWN, Folded::constant),
        }
    }

    pub(super) fn collect_addends(&self, outermost: ExprId) -> Vec<ExprId> {
        let mut addends = Vec::new();
        let mut leftmost = outermost;
        while let ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } = self.hir[leftmost].kind
        {
            addends.push(right);
            leftmost = left;
        }
        addends.push(leftmost);
        addends.reverse();
        addends
    }

    fn fold_unary(&self, op: UnOp, operand: ExprId) -> Folded {
        if op == UnOp::Typeof
            && is_free_common_js(self.hir, self.bound, operand, CommonJsVariable::Require)
        {
            return Folded::constant(Constant::String(known::function));
        }
        if op == UnOp::Typeof
            && let Some(type_name) = self.find_type_of_loader_value(operand)
        {
            return Folded::constant(Constant::String(type_name));
        }
        if op == UnOp::Typeof
            && let Some(kind) = self.find_runtime_value_kind(operand)
        {
            return Folded::constant(Constant::String(match kind {
                RuntimeValueKind::Function => known::function,
                RuntimeValueKind::Object => known::object,
                RuntimeValueKind::Symbol => known::symbol,
            }));
        }
        if op == UnOp::Not
            && let Some(&is_truthy) = self.conditions.get(&operand)
        {
            let effects = self.folded(operand).effects;
            return Folded::new(Value::from(Constant::Boolean(!is_truthy)), effects);
        }
        let operand = self.folded(operand);
        Folded::new(self.evaluator.unary(op, operand.value), operand.effects)
    }

    fn fold_binary(&mut self, e: ExprId, op: BinOp, left: ExprId, right: ExprId) -> Folded {
        match op {
            BinOp::Add => self.fold_addition(e),
            BinOp::And => self.fold_logical(e, LogicalOperator::And, left, right),
            BinOp::Or => self.fold_logical(e, LogicalOperator::Or, left, right),
            BinOp::Nullish => self.fold_logical(e, LogicalOperator::Nullish, left, right),
            BinOp::Comma => {
                self.copy_condition(e, right);
                let (left, right) = (self.folded(left), self.folded(right));
                Folded::new(right.value, left.effects.min(right.effects))
            }
            BinOp::EqEq | BinOp::EqEqEq => match self.find_main_module_equality(e) {
                Some(is_equal) => self.decide(e, Decision::Constant(Constant::Boolean(is_equal))),
                None => self.fold_equality(op, left, right, true),
            },
            BinOp::NotEq | BinOp::NotEqEq => match self.find_main_module_equality(e) {
                Some(is_equal) => self.decide(e, Decision::Constant(Constant::Boolean(!is_equal))),
                None => self.fold_equality(op, left, right, false),
            },
            BinOp::In => self.fold_membership(left, right),
            _ => self.fold_operands(op, left, right),
        }
    }

    fn fold_membership(&self, name: ExprId, object: ExprId) -> Folded {
        let Folded { value, effects } = self.folded(name);
        let is_member = match value {
            Value::Known(name) => match self.evaluator.to_constant(name) {
                Constant::String(name) => self.has_member_in_every_run(object, name),
                _ => false,
            },
            Value::Unknown => false,
        };
        match is_member {
            true => Folded::new(Value::from(Constant::Boolean(true)), effects),
            false => self.fold_operands(BinOp::In, name, object),
        }
    }

    fn fold_operands(&self, op: BinOp, left: ExprId, right: ExprId) -> Folded {
        let (left, right) = (self.folded(left), self.folded(right));
        let value = self.evaluator.binary(op, left.value, right.value);
        Folded::new(value, left.effects.min(right.effects))
    }

    fn fold_equality(
        &self,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        answer_when_equal: bool,
    ) -> Folded {
        let is_only_one_nullish = matches!(
            (self.is_nullish(left), self.is_nullish(right)),
            (Some(true), Some(false)) | (Some(false), Some(true))
        );
        if !is_only_one_nullish {
            return self.fold_operands(op, left, right);
        }
        let effects = self.folded(left).effects.min(self.folded(right).effects);
        Folded::new(Value::from(Constant::Boolean(!answer_when_equal)), effects)
    }

    fn is_nullish(&self, e: ExprId) -> Option<bool> {
        match self.folded(e).value {
            Value::Known(value) => Some(self.evaluator.is_nullish(value)),
            Value::Unknown => self
                .conditions
                .get(&e)
                .is_some_and(|&it| it)
                .then_some(false),
        }
    }

    fn fold_logical(
        &mut self,
        e: ExprId,
        op: LogicalOperator,
        left: ExprId,
        right: ExprId,
    ) -> Folded {
        let is_decided_by_left = match op {
            LogicalOperator::And => self.condition(left).map(|is_truthy| !is_truthy),
            LogicalOperator::Or => self.condition(left),
            LogicalOperator::Nullish => self.is_nullish(left).map(|is_nullish| !is_nullish),
        };
        match is_decided_by_left {
            Some(true) => {
                self.excluded_operands.push(right);
                self.copy_condition(e, left);
                self.folded(left)
            }
            Some(false) => {
                self.copy_condition(e, right);
                let (left, right) = (self.folded(left), self.folded(right));
                Folded::new(right.value, left.effects.min(right.effects))
            }
            None => {
                let condition_where_left_is_result = match op {
                    LogicalOperator::And => Some(false),
                    LogicalOperator::Or => Some(true),
                    LogicalOperator::Nullish => None,
                };
                if let Some(is_truthy) = condition_where_left_is_result
                    && self.condition(right) == Some(is_truthy)
                {
                    self.conditions.insert(e, is_truthy);
                }
                Folded::UNKNOWN
            }
        }
    }

    fn is_left_addend(&self, e: ExprId) -> bool {
        let parent = self.parent_expr(e).map(|parent| self.hir[parent].kind);
        matches!(parent, Some(ExprKind::Binary { op: BinOp::Add, left, .. }) if left == e)
    }

    fn fold_addition(&self, outermost: ExprId) -> Folded {
        if self.is_left_addend(outermost) {
            return Folded::UNKNOWN;
        }
        let addends = self.collect_addends(outermost);
        let addends = addends.iter().map(|&addend| self.folded(addend));
        let effects = addends.clone().map(|addend| addend.effects).min();
        let sum = self.evaluator.add_all(addends.map(|addend| addend.value));
        Folded::new(sum, effects.unwrap_or(Effects::Unknown))
    }

    fn fold_conditional(&mut self, e: ExprId, test: ExprId, branches: Branches) -> Folded {
        let Some(is_true) = self.condition(test) else {
            return Folded::UNKNOWN;
        };
        let Branches { yes, no } = branches;
        let (selected, excluded) = if is_true { (yes, no) } else { (no, yes) };
        self.excluded_operands.push(excluded);
        self.copy_condition(e, selected);
        let (test, selected) = (self.folded(test), self.folded(selected));
        Folded::new(selected.value, test.effects.min(selected.effects))
    }

    fn fold_template(&self, exprs: IdList<ExprId>) -> Folded {
        let hir = self.hir;
        let mut values = Vec::with_capacity(exprs.len());
        let mut effects = Effects::None;
        for substitution in hir.ids(exprs) {
            let substitution = self.folded(substitution);
            if let Value::Unknown = substitution.value {
                return Folded::UNKNOWN;
            }
            values.push(substitution.value);
            effects = effects.min(substitution.effects);
        }
        let texts: Vec<Atom> = hir.ids(hir.template_texts(exprs)).collect();
        Folded::new(self.evaluator.concatenate(&texts, &values), effects)
    }

    fn fold_cast(&mut self, e: ExprId, operand: ExprId) -> Folded {
        if let Some(&state) = self.path_states.get(&operand) {
            self.path_states.insert(e, state);
        }
        self.copy_condition(e, operand);
        let folded = self.folded(operand);
        let is_type_test = !self.hir.is_js && matches!(self.hir[e].kind, ExprKind::As { .. });
        if is_type_test {
            return Folded::new(folded.value, Effects::Unknown);
        }
        self.copy_loader_value(e, operand);
        if self.data_literals.contains(operand.idx()) {
            self.data_literals.insert(e.idx());
        }
        folded
    }
}
