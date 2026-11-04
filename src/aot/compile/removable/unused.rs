use bun_sema::bind::Parent;
use bun_sema::fold::is_removed_where_never_run;
use bun_sema::util::SharedSort;

use super::*;

#[derive(Default)]
struct Simplified {
    // The expressions of which only parts are evaluated, each for what it does.
    in_part: Vec<ExprId>,
    // The regular expression literals of which nothing is left.
    regexp_literals: Vec<ExprId>,
}

fn sort_and_dedup(mut expressions: Vec<ExprId>) -> Vec<ExprId> {
    expressions.shared_sort_unstable();
    expressions.dedup();
    expressions
}

// `simplify_unused_expr` of src/js_parser/scan/scan_side_effects.rs: what `bun build` and `bun run` leave of an expression whose value nothing uses.
impl Removable<'_, '_> {
    // The head of a `for` holds statements which the parser does not visit as statements.
    fn is_in_loop_head(&self, statement: StmtId) -> bool {
        let Parent::Stmt(parent) = self.bound.parent_of_stmt(statement) else {
            return false;
        };
        match self.hir[parent].kind {
            StmtKind::For { init, .. } => init == statement,
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left == statement,
            _ => false,
        }
    }

    fn simplify_unused_expressions(&self) -> Simplified {
        let hir = self.hir;
        let decisions = &self.analysis.decisions;
        let mut simplified = Simplified::default();
        for statement in (0..hir.stmts.len() as u32).map(StmtId) {
            if let StmtKind::Expr(expression) = hir[statement].kind
                && !self.never_runs(statement)
                && !self.is_in_loop_head(statement)
            {
                self.simplify_unused(expression, &mut simplified);
            }
        }
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            if let ExprKind::Cond { test, branches } = hir[expression].kind
                && !decisions.is_dead_expr(expression)
            {
                let branches = hir.branches(branches);
                if decisions.is_dead_expr(branches.yes) || decisions.is_dead_expr(branches.no) {
                    self.simplify_unused(test, &mut simplified);
                }
            }
        }
        simplified
    }

    // The expressions of the file of which only parts are evaluated, each for what it does, ascending.
    pub(crate) fn find_simplified_expressions(&self) -> Vec<ExprId> {
        let hir = self.hir;
        let has_marks = !self.options.ignores_pure_annotations
            && (hir.calls.iter().any(|call| call.is_pure)
                || (!self.options.jsx_has_side_effects && !hir.jsx.is_empty()));
        if !has_marks {
            return Vec::new();
        }
        sort_and_dedup(self.simplify_unused_expressions().in_part)
    }

    // `a || b` is `a` where `b` never runs.
    fn skip_operands_that_never_run(&self, expression: ExprId) -> ExprId {
        let hir = self.hir;
        let mut current = hir.skip_type_assertions(expression);
        while let ExprKind::Binary {
            op: BinOp::Or | BinOp::Nullish,
            left,
            right,
        } = hir[current].kind
            && self.analysis.decisions.is_dead_expr(right)
        {
            current = hir.skip_type_assertions(left);
        }
        current
    }

    fn find_regexp_literal(&self, expression: ExprId) -> Option<ExprId> {
        let value = self.skip_operands_that_never_run(expression);
        matches!(self.hir[value].kind, ExprKind::Regex { .. }).then_some(value)
    }

    // `to_boolean` knows the answer, whatever making the object does.
    fn is_written_as_object(&self, expression: ExprId) -> bool {
        matches!(
            self.hir[self.skip_operands_that_never_run(expression)].kind,
            ExprKind::Regex { .. } | ExprKind::Fn(_) | ExprKind::Array(_) | ExprKind::Object(_)
        )
    }

    // An expression of which something is left is printed as it is written.
    fn simplify_unused_if_nothing_is_left(&self, expression: ExprId, simplified: &mut Simplified) {
        let found_before = simplified.regexp_literals.len();
        if !self.simplify_unused(expression, simplified) {
            simplified.regexp_literals.truncate(found_before);
        }
    }

    // The regular expression literals of the file that `bun run` does not print, so that the engine never reads their patterns, ascending.
    // Besides the values that nothing uses, it leaves out what it folds: `s_if`, `s_while`, `s_for`, `e_unary` and `visit_binary` of src/js_parser/visit.
    pub(crate) fn find_regexp_literals_left_out(&self) -> Vec<ExprId> {
        let hir = self.hir;
        let mut simplified = self.simplify_unused_expressions();
        for statement in hir.stmts.iter() {
            match statement.kind {
                // The test stays with an `else` that stays.
                StmtKind::If { test, no, .. }
                    if self.is_written_as_object(test)
                        && (no.is_none() || is_removed_where_never_run(hir, no)) =>
                {
                    self.simplify_unused(test, &mut simplified);
                }
                StmtKind::While { test, .. } | StmtKind::For { test, .. } if test.is_some() => {
                    let literal = self.find_regexp_literal(test);
                    simplified.regexp_literals.extend(literal);
                }
                _ => {}
            }
        }
        for expression in hir.exprs.iter() {
            match expression.kind {
                ExprKind::Unary { op, operand } => match op {
                    UnOp::Void => self.simplify_unused_if_nothing_is_left(operand, &mut simplified),
                    UnOp::Not if self.is_written_as_object(operand) => {
                        self.simplify_unused_if_nothing_is_left(operand, &mut simplified);
                    }
                    UnOp::Typeof => {
                        let literal = self.find_regexp_literal(operand);
                        simplified.regexp_literals.extend(literal);
                    }
                    _ => {}
                },
                ExprKind::Binary { op, left, .. } => match op {
                    BinOp::And => {
                        let literal = self.find_regexp_literal(left);
                        simplified.regexp_literals.extend(literal);
                    }
                    BinOp::Comma => {
                        // A comma on the left has a turn of its own for its left operand.
                        let unused = match hir[left].kind {
                            ExprKind::Binary {
                                op: BinOp::Comma,
                                right,
                                ..
                            } => right,
                            _ => left,
                        };
                        self.simplify_unused(unused, &mut simplified);
                    }
                    _ => {}
                },
                _ => {}
            }
        }
        sort_and_dedup(simplified.regexp_literals)
    }

    #[allow(clippy::unnecessary_fold)] // every expression is simplified, also behind one that stays
    fn simplify_all_unused(
        &self,
        expressions: impl Iterator<Item = ExprId>,
        simplified: &mut Simplified,
    ) -> bool {
        expressions.fold(true, |is_nothing_left, expression| {
            self.simplify_unused(expression, simplified) && is_nothing_left
        })
    }

    // `true`: nothing is left of the expression.
    fn simplify_unused(&self, expression: ExprId, simplified: &mut Simplified) -> bool {
        let hir = self.hir;
        let decisions = &self.analysis.decisions;
        if expression.is_none() || decisions.is_dead_expr(expression) {
            return true;
        }
        match decisions.decision(expression) {
            Decision::Constant(_) | Decision::Data(_) => return true,
            Decision::GlobalPath(_) | Decision::DeferredData => return false,
            Decision::Unknown => {}
        }
        if !decisions.reads_member(expression) && self.find_constant(expression).is_some() {
            return true;
        }
        if !self.stack.is_safe_to_recurse() {
            return false;
        }
        match hir[expression].kind {
            ExprKind::Missing
            | ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Fn(_)
            | ExprKind::ImportMeta
            | ExprKind::JsxText(_) => true,
            ExprKind::Regex { .. } => {
                simplified.regexp_literals.push(expression);
                true
            }
            ExprKind::Ident(_) => self.identifier(expression),
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self.member_read(expression),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let is_nothing_left =
                    self.simplify_all_unused([branches.yes, branches.no].into_iter(), simplified);
                if !is_nothing_left {
                    return false;
                }
                simplified.in_part.push(expression);
                self.simplify_unused(test, simplified)
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Void | UnOp::Not => self.simplify_unused(operand, simplified),
                UnOp::Typeof => {
                    let name = hir.skip_type_assertions(operand);
                    if matches!(hir[name].kind, ExprKind::Ident(_)) {
                        return self.is_name_initialized(name);
                    }
                    if matches!(decisions.decision(name), Decision::GlobalPath(&[_])) {
                        return false;
                    }
                    simplified.in_part.push(expression);
                    self.simplify_unused(operand, simplified)
                }
                _ => false,
            },
            ExprKind::Call(call) | ExprKind::New(call) => {
                let call = &hir[call];
                // The bundler prints the spread of an argument as a statement, which is no program.
                let is_spread =
                    |argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_));
                if !call.is_pure
                    || self.options.ignores_pure_annotations
                    || self.analysis.import_site_of_call(expression).is_some()
                    || hir.ids(call.args).any(is_spread)
                {
                    return false;
                }
                simplified.in_part.push(expression);
                self.simplify_all_unused(hir.ids(call.args), simplified)
            }
            ExprKind::Jsx(element) => self.simplify_unused_element(expression, element, simplified),
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma => self.simplify_all_unused([left, right].into_iter(), simplified),
                BinOp::EqEqEq | BinOp::NotEqEq => {
                    simplified.in_part.push(expression);
                    self.simplify_all_unused([left, right].into_iter(), simplified)
                }
                BinOp::EqEq | BinOp::NotEq | BinOp::Lt | BinOp::Gt | BinOp::Le | BinOp::Ge => {
                    if !self.is_primitive_whatever_it_does(left)
                        || !self.is_primitive_whatever_it_does(right)
                    {
                        return false;
                    }
                    simplified.in_part.push(expression);
                    self.simplify_all_unused([left, right].into_iter(), simplified)
                }
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    if !self.simplify_unused(right, simplified) {
                        return false;
                    }
                    simplified.in_part.push(expression);
                    self.simplify_unused(left, simplified)
                }
                _ => false,
            },
            ExprKind::Array(items) => {
                let is_spread = |item: ExprId| matches!(hir[item].kind, ExprKind::Spread(_));
                if hir.ids(items).any(is_spread) {
                    return false;
                }
                simplified.in_part.push(expression);
                self.simplify_all_unused(hir.ids(items), simplified)
            }
            // The bundler also trims the properties beside a spread. Here such an object is made as it is written.
            ExprKind::Object(properties) => {
                let is_spread = |property: &PropId| hir[*property].kind == PropKind::Spread;
                if properties.iter().any(|property| is_spread(&property)) {
                    let in_part_before = simplified.in_part.len();
                    let beside = properties.iter().filter(|property| !is_spread(property));
                    let values = beside.map(|property| hir[property].value);
                    self.simplify_all_unused(values, simplified);
                    simplified.in_part.truncate(in_part_before);
                    return false;
                }
                simplified.in_part.push(expression);
                let values = properties.iter().map(|property| hir[property].value);
                let is_computed =
                    |property: PropId| matches!(hir[property].key, PropKey::Computed(_));
                self.simplify_all_unused(values, simplified) && !properties.iter().any(is_computed)
            }
            ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.simplify_unused(expr, simplified),
            // A cast may test the value of its operand. An operand of which a part is left out has none.
            ExprKind::As { expr, .. } => {
                let (listed, literals) =
                    (simplified.in_part.len(), simplified.regexp_literals.len());
                let is_nothing_left = self.simplify_unused(expr, simplified);
                if simplified.in_part.len() == listed {
                    simplified.regexp_literals.truncate(literals);
                    return false;
                }
                simplified.in_part.push(expression);
                is_nothing_left
            }
            _ => false,
        }
    }

    // An element is a marked call: of the tag, an object of the attributes, and the children.
    fn simplify_unused_element(
        &self,
        expression: ExprId,
        element: JsxId,
        simplified: &mut Simplified,
    ) -> bool {
        let hir = self.hir;
        let node = &hir[element];
        let has_spread = |attribute: PropId| hir[attribute].kind == PropKind::Spread;
        if self.options.ignores_pure_annotations
            || self.options.jsx_has_side_effects
            || node.attrs.iter().any(has_spread)
        {
            return false;
        }
        simplified.in_part.push(expression);
        let values = node.attrs.iter().map(|attribute| hir[attribute].value);
        let parts = core::iter::once(node.tag)
            .chain(values)
            .chain(hir.ids(node.children));
        self.simplify_all_unused(parts, simplified)
    }

    // `is_primitive_with_side_effects`
    fn is_primitive_whatever_it_does(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let expression = hir.skip_type_assertions(expression);
        if self.literal(expression).is_some() {
            return true;
        }
        if !self.stack.is_safe_to_recurse() {
            return false;
        }
        match hir[expression].kind {
            ExprKind::Unary { .. } => true,
            ExprKind::Binary { op, left, right } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    self.is_primitive_whatever_it_does(left)
                        && self.is_primitive_whatever_it_does(right)
                }
                BinOp::Comma => self.is_primitive_whatever_it_does(right),
                _ => true,
            },
            ExprKind::Assign { op, target, value } => match op {
                None => false,
                Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                    self.is_primitive_whatever_it_does(target)
                        && self.is_primitive_whatever_it_does(value)
                }
                Some(_) => true,
            },
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                self.is_primitive_whatever_it_does(branches.yes)
                    && self.is_primitive_whatever_it_does(branches.no)
            }
            _ => false,
        }
    }
}
