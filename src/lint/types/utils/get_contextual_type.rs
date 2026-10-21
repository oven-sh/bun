//! `getContextualType.ts`

use super::Located;
use crate::ast::{ExprKind, Node};
use crate::types::{SyntaxKind, TsNode, Type};

/// `getContextualType(checker, node)`: the type of the place the expression flows into. That's the parameter's type for
/// an argument, the annotation for an initializer, and the target's type for an assigned value. `None` for any position
/// outside the handful it knows.
///
/// As upstream, a parenthesized expression has none, because its parent is the `ParenthesizedExpression`.
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
        // `checker.getContextualType(parent)`: as an attribute's value the container has a contextual type, and its
        // content has the same one. As an element's child it has none.
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
