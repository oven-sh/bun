//! The type at every expression and declaration name of a file: what TypeScript's test harness writes into `.types` baselines
//! (`typeWriterWalker`, `GetTypeAtLocation`).

use super::*;

/// `typeWriterResult`
pub struct TypeAtLocation {
    pub start: u32,
    pub end: u32,
    pub type_text: String,
}

impl Checker<'_> {
    /// `typeWriterWalker.getTypes`, in no particular order. The file must have been checked, as in the harness.
    pub fn types_at_locations(&mut self, file: FileId) -> Vec<TypeAtLocation> {
        let hir = self.hir(file);
        let mut results = Vec::with_capacity(hir.exprs.len() * 2);
        let mut text_of_expr: Vec<Option<String>> = vec![None; hir.exprs.len()];
        // `IsExpressionWithTypeArgumentsInClassExtendsClause`: the harness writes the base type there, not the type of the expression.
        let extended: Vec<ExprId> = hir.classes.iter().map(|class| class.extends).collect();
        for index in 0..hir.exprs.len() {
            let e = ExprId(index as u32);
            let expr = hir[e];
            // `checkSpreadExpression` gives a spread element the type of what is iterated over, which `type_of_expr` does not.
            if matches!(expr.kind, ExprKind::Missing | ExprKind::Spread(_)) || extended.contains(&e)
            {
                continue;
            }
            // `getRegularTypeOfExpression`
            let ty = self.type_of_expr(file, e);
            let ty = self.regular(ty);
            let type_text = self.type_to_string_for_baseline(ty);
            // `isRightSideOfQualifiedNameOrPropertyAccess`: the name has the type of the whole access.
            if let ExprKind::Dot { name, name_pos, .. } = expr.kind {
                results.push(TypeAtLocation {
                    start: name_pos,
                    end: name_pos + self.atom_text(name).len() as u32,
                    type_text: type_text.clone(),
                });
            }
            results.push(TypeAtLocation {
                start: self.start_inside_parentheses(file, e),
                end: self.end_inside_parentheses(file, e),
                type_text: type_text.clone(),
            });
            text_of_expr[index] = Some(type_text);
        }
        for &(e, open) in &hir.parens {
            if let Some(type_text) = &text_of_expr[e.idx()] {
                results.push(TypeAtLocation {
                    start: open,
                    end: self.end_of_expr_from(file, e, open),
                    type_text: type_text.clone(),
                });
            }
        }
        for index in 0..hir.pats.len() {
            let pat = PatId(index as u32);
            let PatKind::Ident(name) = hir[pat].kind else {
                continue;
            };
            let ty = self.type_of_pat(file, pat);
            results.push(TypeAtLocation {
                start: hir[pat].pos,
                end: hir[pat].pos + self.atom_text(name).len() as u32,
                type_text: self.type_to_string_for_baseline(ty),
            });
        }
        results
    }
}
