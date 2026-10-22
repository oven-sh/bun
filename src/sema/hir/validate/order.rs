use super::super::{ExprId, ExprKind, File, NodeData, StmtId};
use super::{CheckResult, FileRule, invalid};
use crate::fold::{TreeNode, push_children};

// Whoever changes a tree can only append to it, so a cast that is put around an expression that stood there comes in front of its operand.
fn is_cast_without_text(file: &File<'_>, cast: ExprId, operand: ExprId) -> bool {
    let (cast, operand) = (&file[cast], &file[operand]);
    matches!(cast.kind, ExprKind::As { .. }) && (cast.pos, cast.end) == (operand.pos, operand.end)
}

pub(super) fn check_operand_order(file: &File<'_>) -> CheckResult {
    if file.is_js && !file.jsdoc_comments.is_empty() {
        return Ok(());
    }
    let mut stack = Vec::new();
    for index in 0..file.exprs.len() {
        let parent = ExprId(index as u32);
        push_children(file, TreeNode::Expr(parent), &mut stack);
        while let Some(child) = stack.pop() {
            match child {
                TreeNode::Expr(operand)
                    if operand >= parent && !is_cast_without_text(file, parent, operand) =>
                {
                    return invalid(FileRule::OperandAfterExpression, NodeData::Expr(parent));
                }
                TreeNode::Expr(_)
                | TreeNode::Stmt(_)
                | TreeNode::Function(_)
                | TreeNode::Class(_)
                | TreeNode::Pattern(_) => {}
            }
        }
    }
    for index in 0..file.stmts.len() {
        let parent = StmtId(index as u32);
        push_children(file, TreeNode::Stmt(parent), &mut stack);
        while let Some(child) = stack.pop() {
            match child {
                TreeNode::Stmt(operand) if operand >= parent => {
                    return invalid(FileRule::OperandAfterExpression, NodeData::Stmt(parent));
                }
                TreeNode::Stmt(_)
                | TreeNode::Expr(_)
                | TreeNode::Function(_)
                | TreeNode::Class(_)
                | TreeNode::Pattern(_) => {}
            }
        }
    }
    Ok(())
}

pub(super) fn check_side_table_order(file: &File<'_>) -> CheckResult {
    let is_sorted = file.parens.is_sorted_by_key(|entry| entry.0)
        && file.non_null_ends.is_sorted_by_key(|entry| entry.0)
        && file.far_names.is_sorted_by_key(|entry| entry.0)
        && file.tagged_templates.is_sorted_by_key(|entry| entry.0)
        && file.jsx_expressions.is_sorted_by_key(|entry| entry.0)
        && file.body_starts.is_sorted_by_key(|entry| entry.0)
        && file.modifiers_of_stmts.is_sorted_by_key(|entry| entry.0)
        && file.modifiers_of_props.is_sorted_by_key(|entry| entry.0)
        && file.jsdoc_modifiers.is_sorted_by_key(|entry| entry.0)
        && file.jsdoc_types.is_sorted_by_key(|entry| entry.0)
        && file.jsdoc_comments.is_sorted_by_key(|entry| entry.0)
        && file.jsdoc_hosts.is_sorted_by_key(|host| host.token)
        && file.import_attributes.is_sorted_by_key(|entry| entry.0)
        && (file.template_part_starts)
            .is_sorted_by(|left, right| left.0 < right.0 && left.1 <= right.1)
        && (file.jsx_attribute_texts).is_sorted_by(|left, right| left.0 < right.0)
        && (file.export_star_attributes).is_sorted_by(|left, right| left.0 < right.0)
        && (file.bigint_names).is_sorted_by(|left, right| left.0 < right.0);
    if is_sorted {
        return Ok(());
    }
    invalid(FileRule::UnsortedSideTable, NodeData::File)
}
