use super::Constant;
use super::evaluate::Value;
use super::folder::{Effects, Folder};
use super::inputs::DefineValue;
use super::known_sets::is_prototype_of_patterns_locked;
use crate::atom::{Atom, known};
use crate::bind::{CommonJsVariable, Parent};
use crate::hir::{BinOp, ExprId, ExprKind, MemberKey, UnOp};
use crate::import_sites::is_free_common_js;
use crate::util::PositionSet;

fn is_logical(op: BinOp) -> bool {
    matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
}

fn is_computed_only_among_constants(op: BinOp) -> bool {
    match op {
        BinOp::Add
        | BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::Pow
        | BinOp::Shl
        | BinOp::Shr
        | BinOp::UShr
        | BinOp::BitAnd
        | BinOp::BitOr
        | BinOp::BitXor
        | BinOp::Lt
        | BinOp::Le
        | BinOp::Gt
        | BinOp::Ge => true,
        BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq
        | BinOp::In
        | BinOp::Instanceof
        | BinOp::And
        | BinOp::Or
        | BinOp::Nullish
        | BinOp::Comma => false,
    }
}

#[derive(Copy, Clone)]
pub(super) struct ExcludedOperand {
    pub(super) operand: ExprId,
    pub(super) is_excluded_by_bun_run: bool,
    pub(super) is_excluded_under_minify_syntax: bool,
}

impl<'s> Folder<'_, 's> {
    #[inline]
    pub(super) fn mark_folded_by_build_alone(&mut self, e: ExprId) {
        self.folded_by_build_alone.insert(e.idx());
    }

    #[inline]
    pub(super) fn is_folded_by_bun_run(&self, e: ExprId) -> bool {
        !self.folded_by_build_alone.contains(e.idx())
            || (self.assumes_minify_syntax.get()
                && self.folded_under_minify_syntax.contains(e.idx()))
    }

    pub(super) fn minifies_syntax(&self) -> bool {
        self.inputs.minifies_syntax || self.assumes_minify_syntax.get()
    }

    pub(super) fn holds_under_minify_syntax<T>(&self, ask: impl FnOnce(&Self) -> T) -> T {
        let assumed_before = self.assumes_minify_syntax.replace(true);
        let holds = ask(self);
        self.assumes_minify_syntax.set(assumed_before);
        holds
    }

    pub(super) fn mark_folded_under_minify_syntax_if(
        &mut self,
        e: ExprId,
        is_folded: impl FnOnce(&Self) -> bool,
    ) {
        if !self.inputs.minifies_syntax && self.holds_under_minify_syntax(is_folded) {
            self.folded_under_minify_syntax.insert(e.idx());
        }
    }

    pub(super) fn mark_folded_under_minify_syntax_alone(&mut self, e: ExprId) {
        if !self.inputs.minifies_syntax {
            self.mark_folded_by_build_alone(e);
            self.folded_under_minify_syntax.insert(e.idx());
        }
    }

    pub(super) fn note_fold_under_minify_syntax(&mut self, e: ExprId, value: Value) {
        let is_addition = matches!(self.hir[e].kind, ExprKind::Binary { op: BinOp::Add, .. });
        let is_asked_about =
            is_addition || matches!(value, Value::Known(_)) || self.conditions.get(&e).is_some();
        if self.inputs.minifies_syntax || !is_asked_about {
            return;
        }
        if self.holds_under_minify_syntax(|folder| !folder.has_operand_folded_by_build_alone(e)) {
            self.folded_under_minify_syntax.insert(e.idx());
        } else if self.holds_under_minify_syntax(|folder| folder.tells_condition_by_shape(e)) {
            self.conditions_told_under_minify_syntax.insert(e.idx());
        }
    }

    fn is_condition_told_by_shape(&self, e: ExprId) -> bool {
        self.conditions_told_by_shape.contains(e.idx())
            || (self.assumes_minify_syntax.get()
                && self.conditions_told_under_minify_syntax.contains(e.idx()))
    }

    pub(super) fn computes_with_constants(&self, e: ExprId) -> bool {
        self.minifies_syntax() || self.find_places_always_computed().contains(e.idx())
    }

    fn find_places_always_computed(&self) -> &PositionSet {
        self.places_always_computed.get_or_init(|| {
            let count = self.hir.exprs.len();
            let mut places = PositionSet::new(count);
            for index in (0..count).rev() {
                let e = ExprId(index as u32);
                let is_computed = match self.bound.parent_of_expr(e) {
                    Parent::EnumInit(_) => true,
                    Parent::Expr(parent) if parent.is_some() => {
                        places.contains(parent.idx()) || self.is_operand_of_loader(parent, e)
                    }
                    _ => false,
                };
                if is_computed {
                    places.insert(index);
                }
            }
            self.add_places_behind_imports(&mut places);
            places
        })
    }

    fn add_places_behind_imports(&self, places: &mut PositionSet) {
        let (hir, bound) = (self.hir, self.bound);
        let mut switched_on_by: Option<usize> = None;
        for (index, expr) in hir.exprs.iter().enumerate() {
            let parent = || bound.parent_of_expr(ExprId(index as u32));
            let Some(import) = switched_on_by else {
                if matches!(expr.kind, ExprKind::ImportCall { .. }) && parent() != Parent::None {
                    switched_on_by = Some(index);
                }
                continue;
            };
            places.insert(index);
            let holds_import_in_arguments =
                matches!(expr.kind, ExprKind::Call(call) if hir[call].callee.idx() < import);
            let holds_import = expr.pos <= hir.exprs[import].pos;
            if holds_import_in_arguments
                || (holds_import && matches!(parent(), Parent::EnumInit(_)))
            {
                switched_on_by = None;
            }
        }
    }

    fn is_operand_of_loader(&self, call: ExprId, operand: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let is_require = |e: ExprId| is_free_common_js(hir, bound, e, CommonJsVariable::Require);
        match hir[call].kind {
            ExprKind::ImportCall { .. } => true,
            ExprKind::Call(call) if hir[call].callee != operand => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                match hir.member_key(callee) {
                    Some((object, MemberKey::Name(name))) => {
                        name == known::resolve && is_require(hir.skip_type_assertions(object))
                    }
                    _ => is_require(callee),
                }
            }
            _ => false,
        }
    }

    pub(super) fn can_be_const_value(&self, init: ExprId) -> bool {
        let folded = self.folded(init);
        let Value::Known(value) = folded.value else {
            return false;
        };
        if folded.effects == Effects::Unknown {
            return false;
        }
        match self.evaluator.to_constant(value) {
            Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::Number(_) => {
                true
            }
            Constant::BigInt(_) => false,
            Constant::String(text) => self.is_kept_in_one_piece(init, text),
        }
    }

    pub(super) fn is_kept_in_one_piece(&self, expression: ExprId, text: Atom) -> bool {
        let hir = self.hir;
        let mut e = expression;
        loop {
            e = hir.skip_type_assertions(e);
            let written = match hir[e].kind {
                ExprKind::String(_) | ExprKind::Ident(_) | ExprKind::Unary { .. } => return true,
                ExprKind::Template { exprs } => {
                    return exprs.is_empty() || self.atoms.bytes(text).is_ascii();
                }
                ExprKind::Dot { .. } | ExprKind::Index { .. } => match self.find_in_place(e) {
                    member if member != e => Some(member),
                    _ => return true,
                },
                ExprKind::Cond { test, branches } => {
                    let branches = hir.branches(branches);
                    self.condition(test).map(|is_truthy| match is_truthy {
                        true => branches.yes,
                        false => branches.no,
                    })
                }
                ExprKind::Binary { op, left, right } => {
                    let takes_right = match op {
                        BinOp::Comma => Some(true),
                        BinOp::And => self.condition(left),
                        BinOp::Or => self.condition(left).map(|is_truthy| !is_truthy),
                        BinOp::Nullish => self.is_nullish(left),
                        _ => None,
                    };
                    takes_right.map(|takes_right| if takes_right { right } else { left })
                }
                _ => None,
            };
            match written {
                Some(written) => e = written,
                None => return false,
            }
        }
    }

    pub(super) fn is_hot_of_import_meta(&self, e: ExprId) -> bool {
        let hir = self.hir;
        matches!(hir.member_key(e), Some((object, MemberKey::Name(known::hot)))
            if matches!(hir[hir.skip_type_assertions(object)].kind, ExprKind::ImportMeta))
    }

    pub(super) fn find_text_of_pattern(&self, e: ExprId) -> Option<Value> {
        let is_written_by_transpiler = self.inputs.is_held_to_minified_syntax();
        if let Some(text) = self.find_text_written_for_constructor(e) {
            let text = Value::from(Constant::String(self.atoms.intern(text)));
            return is_written_by_transpiler.then_some(text);
        }
        let ExprKind::Regex { pattern, flags } = self.hir[self.find_in_place(e)].kind else {
            return None;
        };
        let (pattern, flags) = (self.atoms.bytes(pattern), self.atoms.bytes(flags));
        let is_same_in_every_run =
            flags.is_sorted() && is_prototype_of_patterns_locked(self.inputs, self.atoms);
        if !is_written_by_transpiler && !is_same_in_every_run {
            return None;
        }
        let text = self.atoms.intern(&[b"/", pattern, b"/", flags].concat());
        Some(Value::from(Constant::String(text)))
    }

    pub(super) fn find_text_joined_with_nothing(
        &self,
        left: ExprId,
        right: ExprId,
    ) -> Option<ExprId> {
        let is_empty =
            |e: ExprId| matches!(self.hir[e].kind, ExprKind::String(it) if it == known::empty);
        let is_text = |e: ExprId| {
            self.is_always_string(e)
                || matches!(self.hir[e].kind, ExprKind::Binary { op: BinOp::Add, left, right }
                    if self.is_always_string(left) || self.is_always_string(right))
        };
        let operands = [(left, right), (right, left)];
        let found = operands.iter().find(|it| is_empty(it.1) && is_text(it.0));
        found.map(|it| it.0)
    }

    pub(super) fn find_text_written_for_constructor(&self, e: ExprId) -> Option<&'static [u8]> {
        let hir = self.hir;
        let e = hir.skip_type_assertions(e);
        let (ExprKind::Dot { .. }, Some((object, MemberKey::Name(known::constructor)))) =
            (hir[e].kind, hir.member_key(e))
        else {
            return None;
        };
        match hir[self.find_in_place(object)].kind {
            ExprKind::String(_) => Some(b"function String() { [native code] }"),
            ExprKind::Regex { .. } => Some(b"function RegExp() { [native code] }"),
            _ => None,
        }
    }

    fn is_text_in_pieces(&self, e: ExprId) -> bool {
        match self.folded(e).value {
            Value::Known(value) => match self.evaluator.to_constant(value) {
                Constant::String(text) => !self.is_kept_in_one_piece(e, text),
                _ => false,
            },
            Value::Unknown => false,
        }
    }

    pub(super) fn is_in_constant_prefix(&self, init: ExprId) -> bool {
        let Parent::VarInit(declaration) = self.bound.parent_of_expr(init) else {
            return false;
        };
        let statement = self.bound.var_stmt[declaration.idx()];
        let mut prefixes = self.constant_prefixes.borrow_mut();
        prefixes.contains(self.hir, self.bound, statement)
    }

    pub(super) fn is_in_enum_beside(&self, ident: ExprId, init: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::VarInit(declaration) = bound.parent_of_expr(init) else {
            return false;
        };
        if hir.enums.is_empty() {
            return false;
        }
        let mut e = ident;
        let member = loop {
            match bound.parent_of_expr(e) {
                Parent::Expr(parent) if parent.is_some() => e = parent,
                Parent::EnumInit(member) => break member,
                _ => return false,
            }
        };
        let enumeration = hir[bound.enum_member_owner[member.idx()]].stmt;
        let constant = bound.var_stmt[declaration.idx()];
        bound.parent_of_stmt(enumeration) == bound.parent_of_stmt(constant)
    }

    #[inline]
    pub(super) fn is_truthy_in_bun_run(&self, e: ExprId) -> Option<bool> {
        self.condition(e)
            .filter(|_| self.is_folded_by_bun_run(e) || self.is_condition_told_by_shape(e))
    }

    pub(super) fn is_test_truthy_in_bun_run(&self, test: ExprId) -> Option<bool> {
        let hir = self.hir;
        let mut e = test;
        let mut is_negated = false;
        loop {
            e = hir.skip_type_assertions(e);
            if let Some(is_truthy) = self.is_truthy_in_bun_run(e) {
                return Some(is_truthy != is_negated);
            }
            match hir[e].kind {
                ExprKind::Unary {
                    op: UnOp::Not,
                    operand,
                } => {
                    is_negated = !is_negated;
                    e = operand;
                }
                ExprKind::Binary {
                    op: op @ (BinOp::And | BinOp::Or),
                    left,
                    right,
                } if self.is_truthy_in_bun_run(right) == Some(op == BinOp::And)
                    && self.tells_condition_without_effects(right) =>
                {
                    e = left;
                }
                _ => return None,
            }
        }
    }

    pub(super) fn tells_condition_by_shape(&self, e: ExprId) -> bool {
        let is_known = |operand: ExprId| self.is_truthy_in_bun_run(operand).is_some();
        match self.hir[e].kind {
            ExprKind::Unary { op, operand } => match op {
                UnOp::Typeof | UnOp::Void => true,
                UnOp::Not => is_known(operand),
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
                    BinOp::Nullish => {
                        self.is_nullish_in_bun_run(left) == Some(true)
                            && self.is_literal_to_bun_run(left)
                            && is_known(right)
                    }
                    BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                        [left, right].iter().all(|&operand| {
                            self.is_literal_to_bun_run(operand)
                                && self.folded(operand).value.is_boolean_or_finite_number()
                        })
                    }
                    _ => false,
                }
            }
            ExprKind::Cond { test, branches } => {
                let branches = self.hir.branches(branches);
                match self.is_test_truthy_in_bun_run(test) {
                    Some(true) => is_known(branches.yes),
                    Some(false) => is_known(branches.no),
                    None => false,
                }
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => is_known(expr),
            _ => false,
        }
    }

    pub(super) fn is_nullish_in_bun_run(&self, e: ExprId) -> Option<bool> {
        let hir = self.hir;
        let mut e = e;
        loop {
            e = self.seen_by_bun_run(e);
            let kind = hir[e].kind;
            if let ExprKind::Binary { op, .. } = kind
                && is_logical(op)
            {
                return None;
            }
            if let Value::Known(value) = self.folded(e).value
                && self.is_folded_by_bun_run(e)
            {
                return Some(self.evaluator.is_nullish(value));
            }
            if let Some(DefineValue::Data(_)) = self.find_user_defined_value(e) {
                return Some(false);
            }
            return match kind {
                ExprKind::Regex { .. }
                | ExprKind::Fn(_)
                | ExprKind::Class(_)
                | ExprKind::Object(_)
                | ExprKind::Array(_)
                | ExprKind::BigInt(_) => Some(false),
                ExprKind::New(_) => self.is_truthy_in_bun_run(e).map(|_| false),
                ExprKind::Unary { op, .. } => Some(op == UnOp::Void),
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => {
                    e = right;
                    continue;
                }
                ExprKind::Binary { .. } => Some(false),
                ExprKind::Assign { op: Some(op), .. } => (!is_logical(op)).then_some(false),
                _ => None,
            };
        }
    }

    /// Whether the parser leaves nothing of the left side of a comma. It has the right side alone in place of a comma that
    /// stands there.
    pub(super) fn removes_left_of_comma(&self, left: ExprId) -> bool {
        let left = self.as_written(left);
        match self.hir[left].kind {
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.seen_by_bun_run(left) != left && self.removes_unused_value(right),
            _ => self.removes_unused_value(left),
        }
    }

    pub(super) fn is_literal_to_bun_run(&self, e: ExprId) -> bool {
        let folded = self.folded(e);
        matches!(folded.value, Value::Known(_))
            && folded.effects != Effects::Unknown
            && self.is_folded_by_bun_run(e)
    }

    pub(super) fn tells_condition_without_effects(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let mut e = self.seen_by_bun_run(e);
        loop {
            if self.is_literal_to_bun_run(e) {
                return true;
            }
            match hir[e].kind {
                ExprKind::Fn(_) | ExprKind::Regex { .. } => return true,
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    return self.is_condition_told_by_shape(e);
                }
                ExprKind::Unary {
                    op: UnOp::Not,
                    operand,
                } => e = self.seen_by_bun_run(operand),
                ExprKind::Binary {
                    op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge,
                    ..
                } => return self.is_condition_told_by_shape(e),
                _ => return false,
            }
        }
    }

    pub(super) fn leaves_out_known_test(&self, test: ExprId) -> bool {
        self.tells_condition_without_effects(test) || self.removes_unused_value(test)
    }

    pub(super) fn effects_where_unused(
        &self,
        operand: ExprId,
        is_left_out: impl FnOnce(&Self) -> bool,
    ) -> Effects {
        match self.folded(operand).effects {
            Effects::Unknown if is_left_out(self) => Effects::LeftOutByBunRun,
            effects => effects,
        }
    }

    pub(super) fn exclude_operand(
        &mut self,
        operand: ExprId,
        is_excluded_by_bun_run: impl Fn(&Self) -> bool,
    ) {
        let is_excluded_under_minify_syntax =
            self.holds_under_minify_syntax(&is_excluded_by_bun_run);
        let is_excluded_by_bun_run = is_excluded_by_bun_run(self);
        self.excluded_operands.push(ExcludedOperand {
            operand,
            is_excluded_by_bun_run,
            is_excluded_under_minify_syntax,
        });
    }

    #[inline]
    pub(super) fn has_operand_folded_by_build_alone(&self, e: ExprId) -> bool {
        match self.hir[e].kind {
            ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Template { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::BigInt(_) => self.has_operand_folded_by_build_alone_slow(e),
            _ => false,
        }
    }

    #[inline(never)]
    fn has_operand_folded_by_build_alone_slow(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let by_build_alone = |operand: ExprId| !self.is_folded_by_bun_run(operand);
        match hir[e].kind {
            ExprKind::Unary { op, operand } => {
                let require = CommonJsVariable::Require;
                let is_type_of_require =
                    op == UnOp::Typeof && is_free_common_js(hir, self.bound, operand, require);
                match op {
                    UnOp::Void => !self.is_removed_if_unused_by_bun_run(operand),
                    UnOp::Not => {
                        self.is_truthy_in_bun_run(operand).is_none()
                            || !(self.tells_condition_without_effects(operand)
                                || self.is_removed_if_unused_by_bun_run(operand))
                    }
                    UnOp::BitNot if !self.computes_with_constants(e) => true,
                    UnOp::Typeof if self.is_enum_member_written_in_place(operand) => true,
                    UnOp::Typeof if self.is_written_with_radix(operand) => false,
                    UnOp::Plus | UnOp::Minus | UnOp::BitNot if self.is_text_in_pieces(operand) => {
                        true
                    }
                    _ => !is_type_of_require && by_build_alone(operand),
                }
            }
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma => {
                    !self.minifies_syntax()
                        || by_build_alone(right)
                        || (self.condition(right).is_some() && !self.removes_unused_value(left))
                }
                _ if self.leaves_literals_alone(e, op, left, right) => true,
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
                    if [left, right]
                        .iter()
                        .any(|&it| self.is_written_with_radix(it)) =>
                {
                    !self.compares_bigint_written_with_radix(left, right)
                }
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
                    if [left, right]
                        .iter()
                        .any(|&operand| matches!(self.folded(operand).value, Value::Unknown)) =>
                {
                    true
                }
                BinOp::And | BinOp::Or
                    if self.is_truthy_in_bun_run(left) == Some(op == BinOp::And)
                        && !self.tells_condition_without_effects(left) =>
                {
                    true
                }
                _ if !by_build_alone(left) && !by_build_alone(right) => false,
                BinOp::And | BinOp::Or if self.tells_condition_without_effects(left) => {
                    let selects_right = self.is_truthy_in_bun_run(left) == Some(op == BinOp::And);
                    by_build_alone(if selects_right { right } else { left })
                }
                BinOp::And | BinOp::Or if self.is_truthy_in_bun_run(left).is_none() => true,
                BinOp::And | BinOp::Or => by_build_alone(left),
                BinOp::Nullish => by_build_alone(left) || self.is_nullish(left) != Some(false),
                _ => true,
            },
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let is_selected = |when: bool| self.condition(test) != Some(!when);
                self.is_test_truthy_in_bun_run(test).is_none()
                    || !self.leaves_out_known_test(test)
                    || (is_selected(true) && by_build_alone(branches.yes))
                    || (is_selected(false) && by_build_alone(branches.no))
            }
            ExprKind::Template { exprs } => {
                hir.ids(exprs).any(by_build_alone)
                    || (!exprs.is_empty()
                        && !(self.computes_with_constants(e) && self.joins_template(e)))
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => by_build_alone(expr),
            ExprKind::BigInt(_) => self.is_written_with_radix(e),
            _ => false,
        }
    }

    fn joins_template(&self, template: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Template { exprs } = hir[template].kind else {
            return false;
        };
        let mut texts = hir.ids(hir.template_texts(exprs));
        texts.all(|text| self.atoms.bytes(text).is_ascii())
            && hir.ids(exprs).all(|substitution| {
                matches!(self.folded(substitution).value, Value::Known(value) if self.evaluator.is_ascii(value))
            })
    }

    fn find_written_bigint(&self, e: ExprId) -> Option<&[u8]> {
        let hir = self.hir;
        let e = self.seen_by_bun_run(e);
        let ExprKind::BigInt(_) = hir[e].kind else {
            return None;
        };
        let written = hir.text.get(hir[e].pos as usize..)?;
        let end = bun_core::strings::index_of_char_usize(written, b'n')?;
        Some(&written[..end])
    }

    fn is_written_with_radix(&self, e: ExprId) -> bool {
        matches!(self.find_written_bigint(e), Some([b'0', _, ..]))
    }

    fn compares_bigint_written_with_radix(&self, left: ExprId, right: ExprId) -> bool {
        let is_nullish = |e: ExprId| self.is_nullish_in_bun_run(e) == Some(true);
        let is_digit = |byte: &&u8| **byte != b'_';
        let written = (
            self.find_written_bigint(left),
            self.find_written_bigint(right),
        );
        let is_same_text = match written {
            (Some(left), Some(right)) => {
                (left.iter().filter(is_digit)).eq(right.iter().filter(is_digit))
            }
            _ => false,
        };
        is_nullish(left) || is_nullish(right) || is_same_text
    }

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

    pub(super) fn is_computed_by_parser(&self, e: ExprId) -> bool {
        let is_number = |operand: ExprId| self.numbers_of_parser.contains(operand.idx());
        match self.hir[e].kind {
            ExprKind::Unary {
                op: UnOp::Plus | UnOp::Minus | UnOp::BitNot,
                operand,
            } => is_number(operand),
            ExprKind::Binary { op, left, right } => {
                let (Value::Known(left_value), Value::Known(right_value)) =
                    (self.folded(left).value, self.folded(right).value)
                else {
                    return false;
                };
                is_number(left)
                    && is_number(right)
                    && is_computed_only_among_constants(op)
                    && self
                        .evaluator
                        .is_computed_by_bun_run(op, left_value, right_value)
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => is_number(expr),
            _ => false,
        }
    }

    fn leaves_literals_alone(&self, e: ExprId, op: BinOp, left: ExprId, right: ExprId) -> bool {
        let value_of = |operand: ExprId| {
            let text_of_pattern = match op {
                BinOp::Add => self.find_text_of_pattern(operand),
                _ => None,
            };
            text_of_pattern.unwrap_or_else(|| self.folded(operand).value)
        };
        match (value_of(left), value_of(right)) {
            (Value::Known(left_value), Value::Known(right_value)) => {
                !(self.evaluator).is_computed_by_bun_run(op, left_value, right_value)
                    || (is_computed_only_among_constants(op) && !self.computes_with_constants(e))
                    || self.compares_with_member_of_other_kind(op, left, right)
            }
            _ => false,
        }
    }

    fn compares_with_member_of_other_kind(&self, op: BinOp, left: ExprId, right: ExprId) -> bool {
        let is_comparison = matches!(
            op,
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
        );
        let is_string = |e: ExprId| matches!(self.folded(e).value, Value::Known(value) if self.evaluator.is_string(value));
        let is_number = |e: ExprId| self.folded(e).value.is_number();
        is_comparison
            && self.is_enum_member_written_in_place(right)
            && !(is_number(left) && is_number(right))
            && !(is_string(left) && is_string(right))
    }

    pub(super) fn find_user_defined_value(&self, e: ExprId) -> Option<DefineValue<'s>> {
        let &state = self.path_states.get(&e)?;
        let value = self.inputs.value_of(state)?;
        let is_replaced = self.inputs.is_user_defined(state) && !self.is_assignment_target(e);
        is_replaced.then_some(value)
    }
}
