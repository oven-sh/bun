use super::Constant;
use super::evaluate::Value;
use super::folder::Folder;
use super::folder_operators::LogicalOperator;
use super::inputs::DefineValue;
use crate::bind::CommonJsVariable;
use crate::check::aot::has_export_from;
use crate::hir::{
    BinOp, ExprId, ExprKind, File, FnBody, IdList, PatKind, StmtId, StmtKind, UnOp, VarKind,
};
use crate::import_sites::is_free_common_js;
use smallvec::SmallVec;

fn is_logical(op: BinOp) -> bool {
    matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
}

/// `E::BigInt::has_radix`: `0x10n` has one, and `0n` has none.
fn has_radix(hir: &File<'_>, big_int: ExprId) -> bool {
    let written = hir
        .text
        .get(hir[big_int].pos as usize..)
        .unwrap_or_default();
    matches!(written, [b'0', next, ..] if *next != b'n')
}

pub(super) enum NullishByShape {
    Known(bool),
    SameAs(ExprId),
    Unknown,
}

/// What `to_null_or_undefined` answers by the kind of a node alone.
#[inline]
pub(super) fn nullish_by_shape(kind: ExprKind) -> NullishByShape {
    match kind {
        ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Object(_)
        | ExprKind::Array(_) => NullishByShape::Known(false),
        ExprKind::Unary { op, .. } => NullishByShape::Known(op == UnOp::Void),
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => NullishByShape::SameAs(right),
        ExprKind::Binary { op, .. } if is_logical(op) => NullishByShape::Unknown,
        ExprKind::Binary { .. } => NullishByShape::Known(false),
        ExprKind::Assign { op: Some(op), .. } if !is_logical(op) => NullishByShape::Known(false),
        _ => NullishByShape::Unknown,
    }
}

#[derive(Copy, Clone)]
pub(super) struct ExcludedOperand {
    pub(super) operand: ExprId,
    pub(super) is_excluded_by_bun_run: bool,
}

/// A build folds what `bun run` leaves alone: the defines that `bun build` adds by itself, what every executable has, variables that are stored once.
/// Whether a file is CommonJS goes by what `bun run` folds with the same `--define`, so each folded expression remembers who can fold it.
impl<'s> Folder<'_, 's> {
    pub(super) fn mark_folded_by_build_alone(&mut self, e: ExprId) {
        self.folded_by_build_alone.insert(e.idx());
    }

    pub(super) fn is_folded_by_bun_run(&self, e: ExprId) -> bool {
        !self.folded_by_build_alone.contains(e.idx())
    }

    /// `canBeConstValue`: `"a" + "b"` is kept in two pieces, and a BigInt is not among them.
    pub(super) fn can_be_const_value(&self, init: ExprId) -> bool {
        let Value::Known(value) = self.folded(init).value else {
            return false;
        };
        let text = match self.evaluator.to_constant(value) {
            Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::Number(_) => {
                return true;
            }
            Constant::BigInt(_) => return false,
            Constant::String(text) => text,
        };
        let held = self.skip_to_item_in_place(self.hir.skip_type_assertions(init));
        match self.hir[held].kind {
            ExprKind::String(_)
            | ExprKind::Ident(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. } => true,
            ExprKind::Template { exprs } => exprs.is_empty() || self.atoms.bytes(text).is_ascii(),
            _ => false,
        }
    }

    /// `bun run` puts the value of a constant in place of its reads only where nothing but declarations of constants
    /// stands in front of it in its list of statements, and at the top of a file only where the file has no `export { a } from`.
    pub(super) fn is_in_constant_prefix(&self, init: ExprId) -> bool {
        let initializers = self.initializers_in_constant_prefixes.get_or_init(|| {
            let hir = self.hir;
            let mut initializers = Vec::new();
            if !has_export_from(hir) {
                self.push_constant_prefix(hir.body, &mut initializers);
            }
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

    /// `to_boolean`
    pub(super) fn is_truthy_in_bun_run(&self, e: ExprId) -> Option<bool> {
        self.condition(e).filter(|_| {
            self.is_folded_by_bun_run(e) || self.conditions_told_by_shape.contains(e.idx())
        })
    }

    /// `to_boolean` of what `simplify_boolean` leaves of a test, of the operand of `!` and of the test of `a ? b : c`: `a && b` is `a` there where `b` is true and does nothing, and `a || b` is `a` where `b` is false and does nothing.
    #[inline]
    pub(super) fn is_truthy_as_test_in_bun_run(&self, test: ExprId) -> Option<bool> {
        // A build knows each condition that `bun run` knows.
        let is_truthy = self.condition(test)?;
        match self.is_folded_by_bun_run(test) || self.conditions_told_by_shape.contains(test.idx())
        {
            true => Some(is_truthy),
            false => self.is_truthy_where_right_sides_are_dropped(test),
        }
    }

    #[cold]
    #[inline(never)]
    fn is_truthy_where_right_sides_are_dropped(&self, test: ExprId) -> Option<bool> {
        let hir = self.hir;
        let mut e = test;
        loop {
            let kind = hir[self.skip_to_item_in_place(hir.skip_type_assertions(e))].kind;
            let ExprKind::Binary {
                op: BinOp::And | BinOp::Or,
                left,
                right,
            } = kind
            else {
                return None;
            };
            // The right side does not decide: `to_boolean` would have said so.
            if !self.does_nothing_in_bun_run(right) {
                return None;
            }
            if let Some(is_truthy) = self.is_truthy_in_bun_run(left) {
                return Some(is_truthy);
            }
            e = left;
        }
    }

    /// As a condition, `void x` is false and `typeof x` is true whatever `x` is, so `bun run` knows them where the build alone knows `x`.
    pub(super) fn tells_condition_by_shape(&self, e: ExprId) -> bool {
        let is_known = |operand: ExprId| self.is_truthy_in_bun_run(operand).is_some();
        match self.hir[e].kind {
            ExprKind::Unary { op, operand } => match op {
                UnOp::Typeof | UnOp::Void => true,
                UnOp::Not => self.is_truthy_as_test_in_bun_run(operand).is_some(),
                _ => false,
            },
            ExprKind::Binary { op, left, right } => {
                let is_either = |condition: bool| {
                    [left, right]
                        .map(|operand| self.is_truthy_in_bun_run(operand))
                        .contains(&Some(condition))
                };
                match op {
                    BinOp::Comma => is_known(right),
                    BinOp::And => is_either(false),
                    BinOp::Or => is_either(true),
                    // `to_finite_number`
                    BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                        [left, right].iter().all(|&operand| {
                            self.is_literal_to_bun_run(operand)
                                && self.folded(operand).value.is_boolean_or_finite_number()
                        })
                    }
                    _ => false,
                }
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => is_known(expr),
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Cond { .. } => {
                self.tells_condition_by_what_is_in_place(e)
            }
            _ => false,
        }
    }

    /// `(a(), 0) ? b : c` is `(a(), c)` to `bun run`, and `[a][0]` is `a`.
    #[inline(never)]
    fn tells_condition_by_what_is_in_place(&self, e: ExprId) -> bool {
        let in_place = match self.hir[e].kind {
            ExprKind::Cond { test, branches } => {
                let branches = self.hir.branches(branches);
                self.is_truthy_as_test_in_bun_run(test).map(|is_truthy| {
                    if is_truthy { branches.yes } else { branches.no }
                })
            }
            _ => self.find_item_in_place(e),
        };
        in_place.is_some_and(|operand| self.is_truthy_in_bun_run(operand).is_some())
    }

    /// `to_null_or_undefined`: an operator that always answers a number, a string or a boolean answers neither, whatever its operands are.
    pub(super) fn is_nullish_in_bun_run(&self, e: ExprId) -> Option<bool> {
        let hir = self.hir;
        let mut e = e;
        loop {
            e = self.skip_to_item_in_place(hir.skip_type_assertions(e));
            let kind = hir[e].kind;
            if let ExprKind::Binary { op, .. } = kind
                && is_logical(op)
            {
                return self.nullish_logical_results.get(&e).copied();
            }
            if let Value::Known(value) = self.folded(e).value
                && self.is_folded_by_bun_run(e)
            {
                return Some(self.evaluator.is_nullish(value));
            }
            if let Some(DefineValue::Data(_)) = self.find_user_defined_value(e) {
                return Some(false);
            }
            if let ExprKind::Cond { test, branches } = kind {
                let branches = hir.branches(branches);
                e = match self.is_truthy_as_test_in_bun_run(test)? {
                    true => branches.yes,
                    false => branches.no,
                };
                continue;
            }
            // `to_null_or_undefined` asks what the parser has in place of an operator.
            let by_shape = match kind {
                ExprKind::Unary {
                    op: UnOp::Not,
                    operand,
                } => self.nullish_by_shape_of_not(operand),
                ExprKind::Binary { op: BinOp::Add, .. } => self.nullish_by_shape_of_sum(e),
                _ => nullish_by_shape(kind),
            };
            match by_shape {
                NullishByShape::Known(is_nullish) => return Some(is_nullish),
                NullishByShape::SameAs(operand) => e = operand,
                NullishByShape::Unknown => return None,
            }
        }
    }

    /// `maybe_simplify_not` has `x` in place of `!!x` where `x` is a boolean by its shape.
    #[inline(never)]
    fn nullish_by_shape_of_not(&self, operand: ExprId) -> NullishByShape {
        let ExprKind::Unary {
            op: UnOp::Not,
            operand: twice,
        } = self.hir[self.operand_in_place(operand)].kind
        else {
            return NullishByShape::Known(false);
        };
        let twice = self.operand_in_place(twice);
        match self.may_stand_for_its_operator(twice) {
            true => NullishByShape::SameAs(twice),
            false => NullishByShape::Known(false),
        }
    }

    /// `fold_string_addition` has one template in place of templates and literals, and the other addend in place of a sum with `""`.
    #[inline(never)]
    fn nullish_by_shape_of_sum(&self, sum: ExprId) -> NullishByShape {
        let hir = self.hir;
        let mut pending: SmallVec<[ExprId; 4]> = SmallVec::from_slice(&[sum]);
        let mut not_empty: SmallVec<[ExprId; 4]> = SmallVec::new();
        let (mut has_template, mut is_joined) = (false, true);
        while let Some(addend) = pending.pop() {
            let addend = self.operand_in_place(addend);
            if let ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } = hir[addend].kind
            {
                pending.extend([left, right]);
                continue;
            }
            let is_literal = self.is_literal_to_bun_run(addend);
            let is_template = matches!(hir[addend].kind, ExprKind::Template { .. });
            has_template |= is_template && !is_literal;
            is_joined &= is_template || is_literal;
            let is_empty_text = matches!(self.folded(addend).value, Value::Known(text) if self.evaluator.is_string(text) && !self.evaluator.to_boolean(text));
            if !is_empty_text {
                not_empty.push(addend);
            }
        }
        match not_empty[..] {
            _ if has_template && is_joined => NullishByShape::Unknown,
            [only] if self.may_stand_for_its_operator(only) => NullishByShape::SameAs(only),
            _ => NullishByShape::Known(false),
        }
    }

    /// The parser has such an operand in place of `"" + x` or `!!x` where it knows by the shape of `x` that it is a text or a boolean. `to_null_or_undefined` knows nothing of these.
    fn may_stand_for_its_operator(&self, operand: ExprId) -> bool {
        matches!(
            self.hir[operand].kind,
            ExprKind::Cond { .. }
                | ExprKind::Assign { .. }
                | ExprKind::Binary {
                    op: BinOp::And | BinOp::Or,
                    ..
                }
        )
    }

    /// What `bun run` may have in place of an operand: the right side of a comma, and what a condition that it knows selects. It asks nothing that asks `is_nullish_in_bun_run`.
    fn operand_in_place(&self, e: ExprId) -> ExprId {
        let hir = self.hir;
        let mut e = e;
        loop {
            e = self.skip_to_item_in_place(hir.skip_type_assertions(e));
            let selected = |is_truthy: Option<bool>, yes: ExprId, no: ExprId| {
                is_truthy.map(|is_truthy| if is_truthy { yes } else { no })
            };
            let next = match hir[e].kind {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => Some(right),
                ExprKind::Binary {
                    op: BinOp::And,
                    left,
                    right,
                } => selected(self.is_truthy_in_bun_run(left), right, left),
                ExprKind::Binary {
                    op: BinOp::Or,
                    left,
                    right,
                } => selected(self.is_truthy_in_bun_run(left), left, right),
                ExprKind::Binary {
                    op: BinOp::Nullish,
                    left,
                    right,
                } => Some(match self.is_nullish(left) {
                    Some(true) => right,
                    Some(false) | None => left,
                }),
                ExprKind::Cond { test, branches } => {
                    let branches = hir.branches(branches);
                    let is_truthy = self.is_truthy_as_test_in_bun_run(test);
                    selected(is_truthy, branches.yes, branches.no)
                }
                _ => None,
            };
            match next {
                Some(next) => e = next,
                None => return e,
            }
        }
    }

    /// `bun run` puts one operand in place of `left op right` where the left one decides, and knows of the whole what it knows of that operand.
    pub(super) fn note_nullish_logical_result(
        &mut self,
        e: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) {
        let Some(result) = self.find_operand_in_place_of_logical(op, left, right) else {
            return;
        };
        if let Some(is_nullish) = self.is_nullish_in_bun_run(result) {
            self.nullish_logical_results.insert(e, is_nullish);
        }
    }

    /// `visit_right_and_finish`: the operand that `bun run` puts in place of `left op right`. The right one stands there only where the left one does nothing.
    pub(super) fn find_operand_in_place_of_logical(
        &self,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> Option<ExprId> {
        let is_left_in_place = match op {
            BinOp::And => self.is_truthy_in_bun_run(left).map(|is_truthy| !is_truthy),
            BinOp::Or => self.is_truthy_in_bun_run(left),
            _ => self
                .is_nullish_in_bun_run(left)
                .map(|is_nullish| !is_nullish),
        };
        match is_left_in_place? {
            true => Some(left),
            false => self.does_nothing_in_bun_run(left).then_some(right),
        }
    }

    /// `to_boolean` and `to_null_or_undefined` find no side effect: in a literal that is no object, a function or a pattern.
    fn does_nothing_in_bun_run(&self, e: ExprId) -> bool {
        let held = self.skip_to_item_in_place(self.hir.skip_type_assertions(e));
        matches!(
            self.hir[held].kind,
            ExprKind::Regex { .. } | ExprKind::Fn(_)
        ) || self.is_literal_to_bun_run(held)
    }

    /// `bun run` keeps what runs in `(a(), 0)`, `[] && 1` and `[a()] ? 1 : 2`, so it has no literal there. It still knows each as a condition.
    pub(super) fn note_kept_by_bun_run(&mut self, e: ExprId) {
        if self.find_operand_in_place(e).is_some() {
            return;
        }
        self.mark_folded_by_build_alone(e);
        if self.tells_condition_by_shape(e) {
            self.conditions_told_by_shape.insert(e.idx());
        }
    }

    #[inline]
    pub(super) fn is_folded_by_bun_run_alone(&self, e: ExprId) -> bool {
        !self.folded_by_bun_run_alone.is_empty() && self.folded_by_bun_run_alone.contains(&e)
    }

    /// Nearly no file has a member read that `bun run` alone folds, so this stays out of the loop over the expressions.
    #[cold]
    #[inline(never)]
    pub(super) fn note_value_of_bun_run_alone(&mut self, e: ExprId) {
        if self.takes_value_of_bun_run_alone(e) {
            self.folded_by_bun_run_alone.insert(e);
        }
    }

    /// The value of `e` is the value of a member read that `bun run` alone folds, or is computed from one.
    fn takes_value_of_bun_run_alone(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let of = |operand: ExprId| self.folded_by_bun_run_alone.contains(&operand);
        match hir[e].kind {
            ExprKind::Unary { operand, .. } => of(operand),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => of(right),
            ExprKind::Binary { op, left, right } => match LogicalOperator::of(op) {
                Some(operator) => match self.is_decided_by_left(operator, left) {
                    Some(true) => of(left),
                    Some(false) | None => of(right),
                },
                None => of(left) || of(right),
            },
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                match self.condition(test) {
                    Some(true) => of(branches.yes),
                    Some(false) => of(branches.no),
                    None => false,
                }
            }
            ExprKind::Template { exprs } => hir.ids(exprs).any(of),
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => of(expr),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => of(obj),
            _ => false,
        }
    }

    pub(super) fn is_literal_to_bun_run(&self, e: ExprId) -> bool {
        matches!(self.folded(e).value, Value::Known(_)) && self.is_folded_by_bun_run(e)
    }

    pub(super) fn exclude_operand(&mut self, operand: ExprId, is_excluded_by_bun_run: bool) {
        self.excluded_operands.push(ExcludedOperand {
            operand,
            is_excluded_by_bun_run,
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
                match op {
                    // `bun run` writes `undefined` or a boolean in its place where the operand does nothing.
                    UnOp::Void => !self.is_removed_if_unused_by_bun_run(operand),
                    UnOp::Not => {
                        self.is_truthy_as_test_in_bun_run(operand).is_none()
                            || !(self.is_literal_to_bun_run(operand)
                                || self.is_removed_if_unused_by_bun_run(operand))
                    }
                    // `to_number` reads no text that `bun run` holds in pieces: `-("a" + "b")` stays.
                    UnOp::Plus | UnOp::Minus | UnOp::BitNot if self.is_text_in_pieces(operand) => {
                        true
                    }
                    // The type of a BigInt needs none of its digits.
                    UnOp::Typeof if self.is_big_int_literal(operand) => false,
                    _ => !is_type_of_require && by_build_alone(operand),
                }
            }
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma => by_build_alone(right),
                _ if self.leaves_literals_alone(op, left, right) => true,
                // `bun run` compares literals.
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
                    if [left, right]
                        .iter()
                        .any(|&operand| matches!(self.folded(operand).value, Value::Unknown)) =>
                {
                    true
                }
                // A BigInt is not null, however it is written.
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
                    if self.compares_big_int_literal_with_null(left, right) =>
                {
                    false
                }
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
            // `Template::fold` joins what it holds in 8 bits: `é${1}` stays as it is written.
            ExprKind::Template { exprs } => {
                hir.ids(exprs).any(by_build_alone) || self.is_template_joined_by_build_alone(exprs)
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => by_build_alone(expr),
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.find_item_in_place(e).is_some_and(by_build_alone)
            }
            // `check_equality` and `to_string_expr_without_side_effects` read no digits of a BigInt that is written with a radix. `bun run` knows of such a literal that it is a BigInt and not null.
            ExprKind::BigInt(_) => has_radix(hir, e),
            _ => false,
        }
    }

    fn is_big_int_literal(&self, e: ExprId) -> bool {
        matches!(self.hir[self.held_by_bun_run(e)].kind, ExprKind::BigInt(_))
    }

    fn compares_big_int_literal_with_null(&self, left: ExprId, right: ExprId) -> bool {
        [(left, right), (right, left)]
            .iter()
            .any(|&(big_int, null)| {
                self.is_big_int_literal(big_int)
                    && self.is_literal_to_bun_run(null)
                    && self.is_nullish(null) == Some(true)
            })
    }

    fn is_text_in_pieces(&self, e: ExprId) -> bool {
        let held = self.held_by_bun_run(e);
        let is_sum = matches!(self.hir[held].kind, ExprKind::Binary { op: BinOp::Add, .. });
        is_sum
            && matches!(self.folded(held).value, Value::Known(sum) if self.evaluator.is_string(sum))
    }

    /// A build has one text for a template whose parts it knows. `Template::fold` has one where it holds every piece in 8 bits.
    fn is_template_joined_by_build_alone(&self, exprs: IdList<ExprId>) -> bool {
        let hir = self.hir;
        let is_known = |part: ExprId| matches!(self.folded(part).value, Value::Known(_));
        let is_joined = |part: ExprId| matches!(self.folded(part).value, Value::Known(value) if self.evaluator.is_joined_to_text_by_bun_run(value));
        let mut texts = hir.ids(hir.template_texts(exprs));
        hir.ids(exprs).all(is_known)
            && !(texts.all(|text| self.atoms.bytes(text).is_ascii())
                && hir.ids(exprs).all(is_joined))
    }

    /// `fold_string_addition` joins `a + b + c` one `+` at a time. Where it stops, `bun run` has no literal.
    pub(super) fn is_sum_joined_by_bun_run(&self, addends: &[ExprId]) -> bool {
        let values = addends.iter().map(|&addend| self.folded(addend).value);
        let literals = values.map_while(|value| match value {
            Value::Known(literal) => Some(literal),
            Value::Unknown => None,
        });
        self.evaluator.is_sum_computed_by_bun_run(literals)
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

    fn leaves_literals_alone(&self, op: BinOp, left: ExprId, right: ExprId) -> bool {
        match (self.folded(left).value, self.folded(right).value) {
            (Value::Known(left), Value::Known(right)) => {
                !self.evaluator.is_computed_by_bun_run(op, left, right)
            }
            _ => false,
        }
    }

    /// What `--define` or bunfig.toml gives for `e`. `bun run` has that in its place.
    pub(super) fn find_user_defined_value(&self, e: ExprId) -> Option<DefineValue<'s>> {
        let &state = self.path_states.get(&e)?;
        let value = self.inputs.value_of(state)?;
        let is_replaced = self.inputs.is_user_defined(state) && !self.is_assignment_target(e);
        is_replaced.then_some(value)
    }
}
