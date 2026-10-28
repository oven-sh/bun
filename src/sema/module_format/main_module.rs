use crate::atom::known;
use crate::bind::{Bound, CommonJsVariable, Parent};
use crate::hir::{BinOp, ExprId, ExprKind, File, MemberKey};
use crate::import_sites::is_free_common_js;

pub(super) fn find_main_module_comparison(
    hir: &File<'_>,
    bound: &Bound<'_>,
    module: ExprId,
) -> Option<ExprId> {
    let mut operand = module;
    loop {
        let Parent::Expr(parent) = bound.parent_of_expr(operand) else {
            return None;
        };
        let parent = parent.some()?;
        if hir.type_assertion_operand(parent).is_none() {
            let is_operand = main_module_operand(hir, bound, parent) == Some(module);
            return is_operand.then_some(parent);
        }
        operand = parent;
    }
}

pub fn main_module_operand(
    hir: &File<'_>,
    bound: &Bound<'_>,
    comparison: ExprId,
) -> Option<ExprId> {
    let ExprKind::Binary { op, left, right } = hir[comparison].kind else {
        return None;
    };
    if !matches!(
        op,
        BinOp::EqEq | BinOp::EqEqEq | BinOp::NotEq | BinOp::NotEqEq
    ) {
        return None;
    }
    let (left, right) = (
        hir.skip_type_assertions(left),
        hir.skip_type_assertions(right),
    );
    [(left, right), (right, left)]
        .into_iter()
        .find_map(|(module, main)| {
            let is_match = is_free_common_js(hir, bound, module, CommonJsVariable::Module)
                && is_require_main(hir, bound, main);
            is_match.then_some(module)
        })
}

fn is_require_main(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    match hir.member_key(e) {
        Some((object, MemberKey::Name(name))) => {
            let object = hir.skip_type_assertions(object);
            name == known::main && is_free_common_js(hir, bound, object, CommonJsVariable::Require)
        }
        Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => false,
    }
}
