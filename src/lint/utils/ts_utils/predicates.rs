//! `@typescript-eslint/utils`' `ast-utils/predicates.ts`.

use crate::ast::{BinOp, Expr, FnKind, Func, Node, TypeKind};
use crate::tokens::{Token, TokenKind};
use crate::utils::ast_utils::is_function;

/// The function that `node` is in ESTree: a `Func`, the `Expr`, the `Stmt` or the `TypeNode` that
/// owns one, or a signature of an interface or a type literal.
fn func_of(node: Node<'_>) -> Option<Func<'_>> {
    match node {
        Node::Func(func) => Some(func),
        Node::Expr(e) => e.as_fn(),
        Node::Stmt(statement) => statement.as_fn(),
        Node::Type(ty) => match ty.kind() {
            TypeKind::Fn(func) => Some(func),
            _ => None,
        },
        Node::Member(member) if !matches!(member.parent(), Node::Class(_)) => member.func(),
        _ => None,
    }
}

/// typescript-eslint's `isLogicalOrOperator`.
#[inline]
pub fn is_logical_or_operator(e: Expr<'_>) -> bool {
    matches!(e.as_binary(), Some((BinOp::Or, _, _)))
}

/// typescript-eslint's `isFunctionType`: a `TSCallSignatureDeclaration`, a `TSConstructorType`, a
/// `TSConstructSignatureDeclaration`, a `TSDeclareFunction`, a `TSEmptyBodyFunctionExpression`, a
/// `TSFunctionType` or a `TSMethodSignature`. Takes a `Func`, what owns one, or the `Member` of an
/// interface or a type literal.
pub fn is_function_type<'a>(node: impl Into<Node<'a>>) -> bool {
    func_of(node.into()).is_some_and(|func| match func.kind() {
        FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType => true,
        FnKind::Decl | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
            !func.has_body()
        }
        FnKind::Expr | FnKind::Arrow | FnKind::StaticBlock | FnKind::IndexSignature => false,
    })
}

/// typescript-eslint's `isFunctionOrFunctionType`.
pub fn is_function_or_function_type<'a>(node: impl Into<Node<'a>>) -> bool {
    let node = node.into();
    is_function(node) || is_function_type(node)
}

/// typescript-eslint's `isAwaitKeyword`.
#[inline]
pub fn is_await_keyword(token: &Token<'_>) -> bool {
    token.kind() == TokenKind::Identifier && token.is("await")
}
