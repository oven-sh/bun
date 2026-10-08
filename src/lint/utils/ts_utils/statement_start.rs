//! `isStartOfExpressionStatementNeedingParentheses.ts`,
//! `isStartOfArrowFunctionBodyNeedingParentheses.ts`, `needsPrecedingSemiColon.ts`.

use crate::ast::{ExprKind, FnBody, FnKind, Node, StmtKind};
use crate::tokens::{Token, TokenKind};
use crate::utils::ast_utils::is_start_of_expression_statement;
use crate::utils::estree_compat::{estree_span, get_node_by_range_index};

/// typescript-eslint's `isStartOfExpressionStatementNeedingParentheses`: whether code that starts
/// with `first_token` would, in the place of the node, be taken for a block, a class declaration or
/// a function declaration.
pub fn is_start_of_expression_statement_needing_parentheses<'a>(
    node: impl Into<Node<'a>>,
    first_token: &Token<'_>,
) -> bool {
    matches!(first_token.text(), b"{" | b"class" | b"function")
        && is_start_of_expression_statement(node)
}

/// typescript-eslint's `isStartOfArrowFunctionBodyNeedingParentheses`: whether code that starts
/// with `first_token` would, in the place of the node, be taken for the block of an arrow function.
pub fn is_start_of_arrow_function_body_needing_parentheses<'a>(
    node: impl Into<Node<'a>>,
    first_token: &Token<'_>,
) -> bool {
    first_token.is_punctuator("{") && is_start_of_arrow_function_body(node.into())
}

/// Whether `node` is what the expression that is the body of an arrow function starts with,
/// outside of any parentheses.
fn is_start_of_arrow_function_body(node: Node<'_>) -> bool {
    let mut current = node;
    loop {
        let Node::Expr(e) = current else {
            return false;
        };
        if e.is_parenthesized() {
            return false;
        }
        let parent = e.parent();
        if let Node::Func(func) = parent {
            return matches!(func.body(), FnBody::Expr(body) if body == e);
        }
        if parent.span().start != e.span().start {
            return false;
        }
        current = parent;
    }
}

/// typescript-eslint's `needsPrecedingSemicolon`: whether a `(`, a `[` or a `` ` `` put where the
/// node starts needs a `;` before it. The node is at the start of an expression statement, of a
/// member of a class, or of the body of an arrow function.
///
/// It is a copy of an earlier version of ESLint's, which `ast_utils::needs_preceding_semicolon` is
/// the current one of: that knows about type syntax and class fields.
pub fn needs_preceding_semicolon<'a>(node: impl Into<Node<'a>>) -> bool {
    let node = node.into();
    let file = node.file();
    let Some(previous) = file.token_before(estree_span(node)) else {
        return false;
    };
    let is_punctuator = previous.kind() == TokenKind::Punctuator;
    if is_punctuator && matches!(previous.text(), b"--" | b";" | b":" | b"{" | b"++" | b"=>") {
        return false;
    }
    let mut previous_node = get_node_by_range_index(file, previous.start());
    // In `@d export class C {}` the `ExportNamedDeclaration` starts at the `export`, so nothing
    // in it is found for a position in the decorator.
    let exported = previous_node
        .ancestors()
        .filter_map(Node::as_stmt)
        .find(|statement| {
            statement
                .export_span()
                .is_some_and(|export| previous.start() < export.start)
        });
    if let Some(statement) = exported {
        previous_node = statement.parent();
    }
    let previous_statement = previous_node.as_stmt().map(|it| it.kind());
    if is_punctuator && previous.is(")") {
        return !matches!(
            previous_statement,
            Some(
                StmtKind::DoWhile { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::ForOf { .. }
                    | StmtKind::For { .. }
                    | StmtKind::If { .. }
                    | StmtKind::While { .. }
                    | StmtKind::With { .. }
            )
        );
    }
    if is_punctuator && previous.is("}") {
        return match previous_node {
            // The `BlockStatement` of a `FunctionExpression` that is not the value of a
            // `MethodDefinition`.
            Node::Func(func) => {
                func.body_span()
                    .is_some_and(|body| body.end == previous.end())
                    && match func.kind() {
                        FnKind::Expr => true,
                        FnKind::Method | FnKind::Getter | FnKind::Setter => {
                            matches!(func.owner(), Node::Expr(_))
                        }
                        _ => false,
                    }
            }
            // The `ClassBody` of a `ClassExpression`.
            Node::Class(class) => {
                class.span().end == previous.end() && matches!(class.owner(), Node::Expr(_))
            }
            Node::Expr(e) => matches!(e.kind(), ExprKind::Object(_)),
            _ => false,
        };
    }
    if matches!(previous_node, Node::File(_)) {
        return false;
    }
    if matches!(previous.kind(), TokenKind::Identifier | TokenKind::Keyword) {
        return match (previous.text(), previous_node) {
            // The keyword, or the label.
            _ if matches!(
                previous_statement,
                Some(StmtKind::Break(_) | StmtKind::Continue(_))
            ) =>
            {
                false
            }
            (b"debugger", _) => !matches!(previous_statement, Some(StmtKind::Debugger)),
            (b"do", _) => !matches!(previous_statement, Some(StmtKind::DoWhile { .. })),
            (b"else", _) => !matches!(previous_statement, Some(StmtKind::If { .. })),
            (b"return", _) => !matches!(previous_statement, Some(StmtKind::Return(_))),
            (b"yield", Node::Expr(e)) => !matches!(e.kind(), ExprKind::Yield { .. }),
            _ => true,
        };
    }
    if previous.kind() == TokenKind::String {
        // The module specifier, which is not a node here.
        return !matches!(
            previous_statement,
            Some(StmtKind::ExportStar { .. } | StmtKind::ExportNamed(_) | StmtKind::Import(_))
        );
    }
    true
}
