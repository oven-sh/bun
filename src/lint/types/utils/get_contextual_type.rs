//! `getContextualType.ts`

use super::Located;
use crate::ast::{ExprKind, Node};
use crate::types::{SyntaxKind, TsNode, Type};

/// `getContextualType(checker, node)`: the type of what the expression goes into, which is the type
/// of the parameter for an argument, the annotation for an initializer, the type of the target for
/// what is assigned. `None` for any position that is not one of a few that are known.
///
/// As upstream, an expression in parentheses has none: its parent is the `ParenthesizedExpression`.
pub fn get_contextual_type<'a>(node: impl Located<'a>) -> Option<Type<'a>> {
    let node = node.to_ts_node();
    let parent = node.parent()?;
    match parent.kind() {
        SyntaxKind::CallExpression | SyntaxKind::NewExpression => {
            if parent.expression() == Some(node) {
                return None;
            }
        }
        SyntaxKind::VariableDeclaration
        | SyntaxKind::PropertyDeclaration
        | SyntaxKind::Parameter => {
            return Some(parent.type_node()?.get_type_from_type_node());
        }
        // `checker.getContextualType(parent)`: the container has one as the value of an attribute,
        // which is that of its content, and none as a child of an element.
        SyntaxKind::JsxExpression => {
            if parent.parent()?.kind() != SyntaxKind::JsxAttribute {
                return None;
            }
        }
        SyntaxKind::PropertyAssignment | SyntaxKind::ShorthandPropertyAssignment
            if node.kind() == SyntaxKind::Identifier => {}
        SyntaxKind::BinaryExpression => {
            return Some(assignment_target_of(parent, node)?.get_type_at_location());
        }
        SyntaxKind::TemplateSpan => {}
        _ => return None,
    }
    node.get_contextual_type()
}

/// `parent.left`, if `parent` is `left = node`.
fn assignment_target_of<'a>(parent: TsNode<'a>, node: TsNode<'a>) -> Option<TsNode<'a>> {
    let Node::Expr(assignment) = parent.to_ast()? else {
        return None;
    };
    let ExprKind::Assign {
        op: None,
        target,
        value,
    } = assignment.kind()
    else {
        return None;
    };
    (value.ts_node() == node).then(|| target.ts_node_with_parentheses())
}
