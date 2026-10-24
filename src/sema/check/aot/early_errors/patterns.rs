use super::expressions::is_reached;
use crate::bind::PatParent;
use crate::check::errors_operators::{
    check_grammar_rest_element, start_of_dots_before, start_of_equals_before,
};
use crate::check::*;
use smallvec::SmallVec;

type PatternWorklist = SmallVec<[ExprId; 8]>;

fn is_pattern(hir: &File, e: ExprId) -> bool {
    matches!(hir[e].kind, ExprKind::Object(_) | ExprKind::Array(_)) && !is_parenthesized(hir, e)
}

fn is_lexical_declaration(hir: &File, bound: &Bound<'_>, declaration: VarDeclId) -> bool {
    let is_lexical = match hir[declaration].kind {
        VarKind::Var => false,
        VarKind::Let | VarKind::Const | VarKind::Using | VarKind::AwaitUsing => true,
    };
    let statement = bound.var_stmt[declaration.idx()].some();
    is_lexical && statement.is_some_and(|s| matches!(hir[s].kind, StmtKind::Var(_)))
}

impl Checker<'_, '_> {
    pub(super) fn check_binding_pattern_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        for (i, pat) in hir.pats.iter().enumerate() {
            match bound.pat_parent[i] {
                PatParent::None => continue,
                PatParent::Var(declaration) => {
                    if is_lexical_declaration(hir, bound, declaration) {
                        let name = PatId(i as u32);
                        self.check_grammar_name_in_let_or_const_declarations(file, name);
                    }
                }
                PatParent::Param(_) | PatParent::Prop(..) | PatParent::Elem(..) => {}
            }
            match pat.kind {
                PatKind::Object(props) => {
                    for (index, p) in props.iter().enumerate() {
                        let prop = &hir[p];
                        if prop.is_rest {
                            let is_last = index + 1 == props.len();
                            let has_key = prop.key != PropKey::None;
                            check_grammar_rest_element(
                                self,
                                file,
                                prop.value,
                                is_last,
                                has_key,
                                prop.default,
                            );
                        }
                    }
                }
                PatKind::Array(elems) => {
                    for (index, e) in elems.iter().enumerate() {
                        let elem = &hir[e];
                        if elem.is_rest {
                            let is_last = index + 1 == elems.len();
                            check_grammar_rest_element(
                                self,
                                file,
                                elem.pat,
                                is_last,
                                false,
                                elem.default,
                            );
                        }
                    }
                }
                PatKind::Ident(_) | PatKind::Missing => {}
            }
        }
    }

    pub(super) fn check_loop_target_early_errors(
        &mut self,
        file: FileId,
        target: ExprId,
        is_for_in: bool,
    ) {
        if is_pattern(self.hir(file), target) {
            self.check_assignment_pattern_early_errors(file, target);
        } else if is_for_in {
            self.check_reference_expression(file, target, 2406, 2780);
        } else {
            self.check_reference_expression(file, target, 2487, 2781);
        }
    }

    pub(super) fn check_target_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.rare_syntax & rare::ODD_TARGET == 0 {
            return;
        }
        let index = self.exprs_by_kind(file);
        let reached = |e: &&ExprId| is_reached(bound, **e);
        for &e in index.of(ExprTag::Assign).iter().filter(reached) {
            let ExprKind::Assign { op, target, .. } = hir[e].kind else {
                continue;
            };
            if op.is_none() && is_pattern(hir, target) {
                self.check_assignment_pattern_early_errors(file, target);
            } else {
                self.check_reference_expression(file, target, 2364, 2779);
            }
        }
        for &e in index.of(ExprTag::Unary).iter().filter(reached) {
            if let ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } = hir[e].kind
            {
                self.check_reference_expression(file, operand, 2357, 2777);
            }
        }
    }

    fn check_assignment_pattern_early_errors(&mut self, file: FileId, root: ExprId) {
        let hir = self.hir(file);
        let mut worklist = PatternWorklist::new();
        worklist.push(root);
        while let Some(e) = worklist.pop() {
            let is_unparenthesized = !is_parenthesized(hir, e);
            match hir[e].kind {
                ExprKind::Object(props) if is_unparenthesized => {
                    self.check_object_assignment_pattern(file, props, &mut worklist);
                }
                ExprKind::Array(elements) if is_unparenthesized => {
                    self.check_array_assignment_pattern(file, elements, &mut worklist);
                }
                ExprKind::Assign { op: None, .. } if is_unparenthesized => {}
                _ => {
                    self.check_reference_expression(file, e, 2364, 2779);
                }
            }
        }
    }

    fn check_object_assignment_pattern(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        worklist: &mut PatternWorklist,
    ) {
        let hir = self.hir(file);
        for (i, p) in props.iter().enumerate() {
            let value = hir[p].value;
            if value.is_none() {
                continue;
            }
            match hir[p].kind {
                PropKind::Init | PropKind::Shorthand => worklist.push(value),
                PropKind::Method | PropKind::Getter | PropKind::Setter => {
                    self.early_error_on_node(file, p, 1136, &[]);
                }
                PropKind::Spread if i + 1 < props.len() => {
                    let start = start_of_dots_before(self, file, value).unwrap_or(hir[p].pos);
                    self.early_error_at((file, start, self.end_of_prop(file, p)), 2462, &[]);
                }
                PropKind::Spread => {
                    let end = self.end_of_prop(file, p);
                    self.early_grammar_error_on_token_after(file, end, b',', 1013);
                    if !matches!(hir[value].kind, ExprKind::Object(_) | ExprKind::Array(_)) {
                        self.check_reference_expression(file, value, 2701, 2778);
                    }
                }
            }
        }
    }

    fn check_array_assignment_pattern(
        &mut self,
        file: FileId,
        elements: IdList<ExprId>,
        worklist: &mut PatternWorklist,
    ) {
        let hir = self.hir(file);
        for (i, element) in hir.ids(elements).enumerate() {
            let ExprKind::Spread(rest) = hir[element].kind else {
                if !matches!(hir[element].kind, ExprKind::Missing) {
                    worklist.push(element);
                }
                continue;
            };
            let end = self.end_of_expr(file, element);
            if i + 1 < elements.len() {
                self.early_error_at((file, hir[element].pos, end), 2462, &[]);
            } else if let ExprKind::Assign {
                op: None, value, ..
            } = hir[rest].kind
                && !is_parenthesized(hir, rest)
            {
                if let Some(start) = start_of_equals_before(self, file, value) {
                    self.early_error_at((file, start, start + 1), 1186, &[]);
                }
            } else {
                self.early_grammar_error_on_token_after(file, end, b',', 1013);
                worklist.push(rest);
            }
        }
    }
}
