//! `@typescript-eslint/utils`' `ast-utils/predicates.ts`.

use crate::ast::{
    BinOp, Expr, ExprKind, Flags, FnKind, Func, MemberKind, Node, PatKind, PropKind, StmtKind,
    TypeKind,
};
use crate::tokens::{Token, TokenKind};
use crate::utils::ast_utils::is_function;

/// The function that `node` is in ESTree: a `Func`, the `Expr`, the `Stmt` or the `TypeNode` that
/// owns one, or a signature of an interface or a type literal.
fn func_of(node: Node<'_>) -> Option<Func<'_>> {
    match node {
        Node::Func(func) => Some(func),
        Node::Expr(e) => e.as_fn(),
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Fn(func) => Some(func),
            _ => None,
        },
        Node::Type(ty) => match ty.kind() {
            TypeKind::Fn(func) => Some(func),
            _ => None,
        },
        Node::Member(member) if !matches!(member.parent(), Node::Class(_)) => member.func(),
        _ => None,
    }
}

/// typescript-eslint's `isOptionalChainPunctuator`.
#[inline]
pub fn is_optional_chain_punctuator(token: &Token<'_>) -> bool {
    token.is_punctuator("?.")
}

/// typescript-eslint's `isNotOptionalChainPunctuator`.
#[inline]
pub fn is_not_optional_chain_punctuator(token: &Token<'_>) -> bool {
    !is_optional_chain_punctuator(token)
}

/// typescript-eslint's `isNonNullAssertionPunctuator`.
#[inline]
pub fn is_non_null_assertion_punctuator(token: &Token<'_>) -> bool {
    token.is_punctuator("!")
}

/// typescript-eslint's `isNotNonNullAssertionPunctuator`.
#[inline]
pub fn is_not_non_null_assertion_punctuator(token: &Token<'_>) -> bool {
    !is_non_null_assertion_punctuator(token)
}

/// typescript-eslint's `isOptionalCallExpression`: `foo?.()`, `foo.bar?.()`, not `foo?.bar()`.
#[inline]
pub fn is_optional_call_expression(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Call(call) if call.is_optional())
}

/// typescript-eslint's `isLogicalOrOperator`.
#[inline]
pub fn is_logical_or_operator(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Binary { op: BinOp::Or, .. })
}

/// typescript-eslint's `isTypeAssertion`: `x as T`, `<T>x`, also with `const` for `T`. Not
/// `x satisfies T`.
#[inline]
pub fn is_type_assertion(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::As { .. } | ExprKind::AsConst(_))
}

/// typescript-eslint's `isVariableDeclarator`. The parameter of a `catch`, which is a `VarDecl`
/// here, is not one.
pub fn is_variable_declarator<'a>(node: impl Into<Node<'a>>) -> bool {
    match node.into() {
        Node::VarDecl(declaration) => {
            matches!(declaration.parent(), Node::Stmt(it) if matches!(it.kind(), StmtKind::Var(_)))
        }
        _ => false,
    }
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
        FnKind::Decl
        | FnKind::Method
        | FnKind::Getter
        | FnKind::Setter
        | FnKind::Constructor => !func.has_body(),
        FnKind::Expr | FnKind::Arrow | FnKind::StaticBlock | FnKind::IndexSignature => false,
    })
}

/// typescript-eslint's `isFunctionOrFunctionType`.
pub fn is_function_or_function_type<'a>(node: impl Into<Node<'a>>) -> bool {
    let node = node.into();
    is_function(node) || is_function_type(node)
}

/// typescript-eslint's `isTSFunctionType`: `(a: A) => R`.
pub fn is_ts_function_type<'a>(node: impl Into<Node<'a>>) -> bool {
    func_of(node.into()).is_some_and(|func| func.kind() == FnKind::FunctionType)
}

/// typescript-eslint's `isTSConstructorType`: `new (a: A) => R`.
pub fn is_ts_constructor_type<'a>(node: impl Into<Node<'a>>) -> bool {
    func_of(node.into()).is_some_and(|func| func.kind() == FnKind::ConstructorType)
}

/// typescript-eslint's `isClassOrTypeElement`: a `Member` other than a static block and an
/// `accessor` property, or a `FunctionExpression` or a `TSEmptyBodyFunctionExpression`.
pub fn is_class_or_type_element<'a>(node: impl Into<Node<'a>>) -> bool {
    match node.into() {
        Node::Member(member) => match member.kind() {
            MemberKind::StaticBlock => false,
            MemberKind::Property => !member.flags().contains(Flags::ACCESSOR),
            _ => true,
        },
        node => func_of(node).is_some_and(|func| {
            matches!(
                func.kind(),
                FnKind::Expr
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor
                    | FnKind::CallSignature
                    | FnKind::ConstructSignature
                    | FnKind::IndexSignature
            )
        }),
    }
}

/// typescript-eslint's `isConstructor`: the `Member` that is a constructor of a class, with or
/// without a body. `static constructor() {}` is a method. For upstream's
/// `isConstructor(node.parent)` pass `func.parent()`.
pub fn is_constructor<'a>(node: impl Into<Node<'a>>) -> bool {
    matches!(
        node.into(),
        Node::Member(member) if member.kind() == MemberKind::Constructor && !member.is_static()
    )
}

/// typescript-eslint's `isSetter`: a `set` accessor of a class that is not abstract, or of an
/// object literal.
pub fn is_setter<'a>(node: impl Into<Node<'a>>) -> bool {
    match node.into() {
        Node::Member(member) => {
            member.kind() == MemberKind::Setter
                && !member.flags().contains(Flags::ABSTRACT)
                && matches!(member.parent(), Node::Class(_))
        }
        Node::Prop(prop) => prop.kind() == PropKind::Setter,
        _ => false,
    }
}

/// typescript-eslint's `isIdentifier`: an identifier that is an expression or a binding. The other
/// `Identifier`s of ESTree are [`Ident`](crate::ast::Ident)s, which are not nodes.
pub fn is_identifier<'a>(node: impl Into<Node<'a>>) -> bool {
    match node.into() {
        Node::Expr(e) => matches!(e.kind(), ExprKind::Ident(_)),
        Node::Pat(pat) => matches!(pat.kind(), PatKind::Ident(_)),
        _ => false,
    }
}

/// typescript-eslint's `isAwaitExpression`.
#[inline]
pub fn is_await_expression(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Await(_))
}

/// typescript-eslint's `isAwaitKeyword`.
#[inline]
pub fn is_await_keyword(token: &Token<'_>) -> bool {
    token.kind() == TokenKind::Identifier && token.is("await")
}

/// typescript-eslint's `isTypeKeyword`.
#[inline]
pub fn is_type_keyword(token: &Token<'_>) -> bool {
    token.kind() == TokenKind::Identifier && token.is("type")
}

/// typescript-eslint's `isImportKeyword`.
#[inline]
pub fn is_import_keyword(token: &Token<'_>) -> bool {
    token.is_keyword("import")
}
