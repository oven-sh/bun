use bun_sema::bind::Parent;
use bun_sema::util::SharedSort;

use super::*;

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

    // The expressions of the file of which only parts are evaluated, each for what it does, ascending.
    pub(crate) fn find_simplified_expressions(&self) -> Vec<ExprId> {
        let hir = self.hir;
        let decisions = &self.analysis.decisions;
        let mut simplified = Vec::new();
        let has_marks = !self.options.ignores_pure_annotations
            && (hir.calls.iter().any(|call| call.is_pure)
                || (!self.options.jsx_has_side_effects && !hir.jsx.is_empty()));
        if !has_marks {
            return simplified;
        }
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
        simplified.shared_sort_unstable();
        simplified.dedup();
        simplified
    }

    #[allow(clippy::unnecessary_fold)] // every expression is simplified, also behind one that stays
    fn simplify_all_unused(
        &self,
        expressions: impl Iterator<Item = ExprId>,
        simplified: &mut Vec<ExprId>,
    ) -> bool {
        expressions.fold(true, |is_nothing_left, expression| {
            self.simplify_unused(expression, simplified) && is_nothing_left
        })
    }

    // `true`: nothing is left of the expression.
    fn simplify_unused(&self, expression: ExprId, simplified: &mut Vec<ExprId>) -> bool {
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
        if self.find_constant(expression).is_some() {
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
            | ExprKind::Regex { .. }
            | ExprKind::Fn(_)
            | ExprKind::ImportMeta
            | ExprKind::JsxText(_) => true,
            ExprKind::Ident(_) => self.identifier(expression),
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self.member_read(expression),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let is_nothing_left =
                    self.simplify_all_unused([branches.yes, branches.no].into_iter(), simplified);
                if !is_nothing_left {
                    return false;
                }
                simplified.push(expression);
                self.simplify_unused(test, simplified)
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Void | UnOp::Not => self.simplify_unused(operand, simplified),
                UnOp::Typeof => {
                    if matches!(
                        hir[hir.skip_type_assertions(operand)].kind,
                        ExprKind::Ident(_)
                    ) {
                        return true;
                    }
                    simplified.push(expression);
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
                    || self.analysis.import_site_of_call(expression).is_some()
                    || hir.ids(call.args).any(is_spread)
                {
                    return false;
                }
                simplified.push(expression);
                self.simplify_all_unused(hir.ids(call.args), simplified)
            }
            ExprKind::Jsx(element) => self.simplify_unused_element(expression, element, simplified),
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma => self.simplify_all_unused([left, right].into_iter(), simplified),
                BinOp::EqEqEq | BinOp::NotEqEq => {
                    simplified.push(expression);
                    self.simplify_all_unused([left, right].into_iter(), simplified)
                }
                BinOp::EqEq | BinOp::NotEq | BinOp::Lt | BinOp::Gt | BinOp::Le | BinOp::Ge => {
                    if !self.is_primitive_whatever_it_does(left)
                        || !self.is_primitive_whatever_it_does(right)
                    {
                        return false;
                    }
                    simplified.push(expression);
                    self.simplify_all_unused([left, right].into_iter(), simplified)
                }
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    if !self.simplify_unused(right, simplified) {
                        return false;
                    }
                    simplified.push(expression);
                    self.simplify_unused(left, simplified)
                }
                _ => false,
            },
            ExprKind::Array(items) => {
                let is_spread = |item: ExprId| matches!(hir[item].kind, ExprKind::Spread(_));
                if hir.ids(items).any(is_spread) {
                    return false;
                }
                simplified.push(expression);
                self.simplify_all_unused(hir.ids(items), simplified)
            }
            // The bundler also trims the properties beside a spread. Here such an object is made as it is written.
            ExprKind::Object(properties) => {
                if properties
                    .iter()
                    .any(|property| hir[property].kind == PropKind::Spread)
                {
                    return false;
                }
                simplified.push(expression);
                let values = properties.iter().map(|property| hir[property].value);
                let is_computed =
                    |property: PropId| matches!(hir[property].key, PropKey::Computed(_));
                self.simplify_all_unused(values, simplified) && !properties.iter().any(is_computed)
            }
            ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.simplify_unused(expr, simplified),
            // A cast may test its operand.
            _ => false,
        }
    }

    // An element is a marked call: of the tag, an object of the attributes, and the children.
    fn simplify_unused_element(
        &self,
        expression: ExprId,
        element: JsxId,
        simplified: &mut Vec<ExprId>,
    ) -> bool {
        let hir = self.hir;
        let node = &hir[element];
        let has_spread = |attribute: PropId| hir[attribute].kind == PropKind::Spread;
        if self.options.jsx_has_side_effects || node.attrs.iter().any(has_spread) {
            return false;
        }
        simplified.push(expression);
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
