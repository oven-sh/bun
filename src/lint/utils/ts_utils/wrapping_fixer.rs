//! `getWrappingFixer.ts`.

use super::precedence::parenthesize;
use crate::ast::{
    BinOp, Expr, ExprKind, ExprTag, FnBody, FnKind, Node, Stmt, StmtTag, TypeKind, UnOp,
};
use crate::context::IntoText;
use crate::fix::{Fix, Fixer};
use crate::utils::ast_utils::is_member_expression;
use smallvec::SmallVec;
use std::borrow::Cow;

/// The parameters of [`get_wrapping_fixer`].
pub struct WrappingFixerParams<'a, 'i, W> {
    /// The expression to replace.
    pub node: Expr<'a>,
    /// Upstream's `innerNode`: the descendants of `node` to keep. Empty means `node` itself.
    pub inner_nodes: &'i [Expr<'a>],
    /// Receives each inner node's code, parenthesized where necessary, and returns the code that replaces `node`.
    pub wrap: W,
}

/// The code of a wrapping fixer's inner nodes. With `is_in_chain_expression`, `node` is the call or member access
/// inside the `ChainExpression` that has the same range.
fn inner_codes<'a>(
    node: Expr<'a>,
    inner_nodes: &[Expr<'a>],
    is_in_chain_expression: bool,
) -> SmallVec<[Cow<'a, [u8]>; 2]> {
    let itself = [node];
    let inner_nodes: &[Expr<'a>] = if inner_nodes.is_empty() {
        &itself
    } else {
        inner_nodes
    };
    inner_nodes
        .iter()
        .map(|&inner| {
            let needs_parentheses = match is_in_chain_expression {
                true if inner == node => matches!(inner.tag(), ExprTag::NonNull),
                true => !is_strong_precedence_node(inner),
                false => {
                    !is_strong_precedence_node(inner)
                        || is_object_expression_in_one_line_return(node, inner)
                }
            };
            match needs_parentheses {
                true => Cow::Owned(parenthesize(inner.text())),
                false => Cow::Borrowed(inner.text()),
            }
        })
        .collect()
}

fn wrapping_fix<'a, 't, W, T>(
    fixer: Fixer<'a>,
    params: WrappingFixerParams<'a, '_, W>,
    is_chain_element: bool,
) -> Fix
where
    W: FnOnce(&[&[u8]]) -> T,
    T: IntoText<'t>,
{
    let WrappingFixerParams {
        node,
        inner_nodes,
        wrap,
    } = params;
    // Its parent is the `ChainExpression`, which isn't an arrow function, a weak parent or an expression statement, and
    // has no left side.
    let is_in_chain_expression = is_chain_element && node.is_chain_root();
    let codes = inner_codes(node, inner_nodes, is_in_chain_expression);
    let codes: SmallVec<[&[u8]; 2]> = codes.iter().map(|code| &**code).collect();
    let mut code = wrap(&codes).into_text();
    if !is_in_chain_expression && is_weak_precedence_parent(node) && !node.is_parenthesized() {
        code = Cow::Owned(parenthesize(&code));
    }
    if matches!(code.first(), Some(b'`' | b'(' | b'['))
        && !is_in_chain_expression
        && is_missing_semicolon_before(node)
    {
        code.to_mut().insert(0, b';');
    }
    fixer.replace(node, code)
}

/// typescript-eslint's `getWrappingFixer`: replaces `node` with what `wrap` returns for the inner nodes' code, and adds
/// parentheses, and a `;` before, where the result needs them.
///
/// ```ignore
/// cx.report(node, MESSAGE).fix(|fixer| {
///     get_wrapping_fixer(fixer, WrappingFixerParams {
///         node,
///         inner_nodes: &[],
///         wrap: |code| [b"Boolean(".as_slice(), code[0], b")"].concat(),
///     })
/// });
/// ```
///
/// A `node` that's a whole optional chain represents the `ChainExpression`. Where upstream passes the `CallExpression`
/// or `MemberExpression` inside it, which is what a listener for those receives, use
/// [`get_wrapping_fixer_for_chain_element`]. Without `wrap`, use [`get_wrapping_fixer_without_wrap`].
pub fn get_wrapping_fixer<'a, 't, W, T>(
    fixer: Fixer<'a>,
    params: WrappingFixerParams<'a, '_, W>,
) -> Fix
where
    W: FnOnce(&[&[u8]]) -> T,
    T: IntoText<'t>,
{
    wrapping_fix(fixer, params, false)
}

/// typescript-eslint's `getWrappingFixer` for a `node` that upstream gets from a listener for `CallExpression` or
/// `MemberExpression`, or from `skipChainExpression`. If it's a whole optional chain, its ESTree parent is the
/// `ChainExpression`, so nothing is added around the result of `wrap`.
pub fn get_wrapping_fixer_for_chain_element<'a, 't, W, T>(
    fixer: Fixer<'a>,
    params: WrappingFixerParams<'a, '_, W>,
) -> Fix
where
    W: FnOnce(&[&[u8]]) -> T,
    T: IntoText<'t>,
{
    wrapping_fix(fixer, params, true)
}

/// typescript-eslint's `getWrappingFixer` without `wrap`: replaces `node` with the inner nodes' code, each
/// parenthesized unless it's a [strong precedence node](is_strong_precedence_node).
pub fn get_wrapping_fixer_without_wrap<'a>(
    fixer: Fixer<'a>,
    node: Expr<'a>,
    inner_nodes: &[Expr<'a>],
) -> Fix {
    let mut code = Vec::new();
    for inner in inner_codes(node, inner_nodes, false) {
        code.extend_from_slice(&inner);
    }
    fixer.replace(node, code)
}

/// typescript-eslint's `getMovedNodeCode`: `node_to_move`'s code, parenthesized if it may need that in
/// `destination_node`'s position. Each is an expression or a type.
pub fn get_moved_node_code<'a>(
    destination_node: impl Into<Node<'a>>,
    node_to_move: impl Into<Node<'a>>,
) -> Cow<'a, [u8]> {
    let node_to_move = node_to_move.into();
    let code = node_to_move.text();
    match is_strong_precedence_node(node_to_move) || !is_weak_precedence_parent(destination_node) {
        true => Cow::Borrowed(code),
        false => Cow::Owned(parenthesize(code)),
    }
}

/// typescript-eslint's `isStrongPrecedenceNode`: true if the node keeps its meaning no matter what surrounds it. It's a
/// literal, an identifier, an array, an object, a member access, a call, a `new`, a tagged template, `f<T>`, or a type
/// reference.
///
/// A whole optional chain is a `ChainExpression`, which doesn't qualify. Neither do `this` and a template.
#[inline]
pub fn is_strong_precedence_node<'a>(node: impl Into<Node<'a>>) -> bool {
    has_strong_precedence(node.into())
}

fn has_strong_precedence(node: Node<'_>) -> bool {
    match node {
        Node::Expr(e) => match e.tag() {
            ExprTag::Null
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Number
            | ExprTag::String
            | ExprTag::BigInt
            | ExprTag::Regex
            | ExprTag::Ident
            | ExprTag::Array
            | ExprTag::Object
            | ExprTag::New
            | ExprTag::TaggedTemplate
            | ExprTag::Instantiation => true,
            ExprTag::Call => !e.is_chain_root(),
            ExprTag::Dot | ExprTag::Index => !e.is_chain_root() && is_member_expression(e),
            _ => false,
        },
        Node::Type(ty) => matches!(ty.kind(), TypeKind::Ref { .. }),
        Node::Pat(pat) => pat.as_ident().is_some(),
        _ => false,
    }
}

/// typescript-eslint's `isWeakPrecedenceParent`: true if the node's parent could split up whatever replaces the node.
/// The parent is a unary, binary, logical or conditional expression or an `await`, or the node is the object of a
/// member access, the callee of a call or a `new`, or the tag of a template.
///
/// An expression that's a whole optional chain represents the `ChainExpression`. That's the parent of the
/// `CallExpression` or `MemberExpression` inside it, and it isn't weak, so for such a node upstream returns `false`.
pub fn is_weak_precedence_parent<'a>(node: impl Into<Node<'a>>) -> bool {
    let Node::Expr(node) = node.into() else {
        return false;
    };
    let Node::Expr(parent) = node.parent() else {
        return false;
    };
    match parent.kind() {
        ExprKind::Binary { op, .. } => op != BinOp::Comma,
        ExprKind::Unary { .. } | ExprKind::Cond { .. } | ExprKind::Await(_) => true,
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
            obj == node && is_member_expression(parent)
        }
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
            call.callee() == node
        }
        _ => false,
    }
}

/// typescript-eslint's `isMissingSemicolonBefore`: true if `node` is at the start of an expression statement in a
/// block, and the previous statement doesn't end with a `;`.
pub fn is_missing_semicolon_before(node: Expr<'_>) -> bool {
    let mut node = node;
    loop {
        let parent = match node.parent() {
            Node::Stmt(statement) => {
                return matches!(statement.tag(), StmtTag::Expr)
                    && previous_statement_in_block(statement)
                        .is_some_and(|previous| !previous.text().ends_with(b";"));
            }
            Node::Expr(parent) => parent,
            _ => return false,
        };
        // `parent`'s parent is a `ChainExpression`, and `parent` isn't its left side.
        if !is_left_hand_side(node) || parent.is_chain_root() {
            return false;
        }
        node = parent;
    }
}

/// The statement before `statement` in the `Program` or `BlockStatement` that directly contains it.
fn previous_statement_in_block(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    let siblings = match statement.parent() {
        Node::File(file) => file.body(),
        Node::Func(func) if func.kind() != FnKind::StaticBlock => func.body_statements()?,
        Node::Stmt(block) => match block.as_block() {
            Some(statements) => statements,
            _ => return None,
        },
        _ => return None,
    };
    let mut previous = None;
    for sibling in siblings {
        if sibling == statement {
            return previous;
        }
        previous = Some(sibling);
    }
    None
}

/// typescript-eslint's `isLeftHandSide`: true if `node` is the operand of `++` or `--`, the left side of a binary,
/// logical or assignment expression, the test of a conditional expression, the callee of a call or the tag of a
/// template.
pub fn is_left_hand_side(node: Expr<'_>) -> bool {
    let Node::Expr(parent) = node.parent() else {
        return false;
    };
    match parent.kind() {
        ExprKind::Unary { op, .. } => {
            matches!(
                op,
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
            )
        }
        ExprKind::Binary { op, left, .. } => op != BinOp::Comma && left == node,
        ExprKind::Assign { target, .. } => target == node,
        ExprKind::Cond { test, .. } => test == node,
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => call.callee() == node,
        _ => false,
    }
}

/// typescript-eslint's `isObjectExpressionInOneLineReturn`: `node` is an arrow function's body and `inner_node` is an
/// object literal, which would parse as a block there.
fn is_object_expression_in_one_line_return(node: Expr<'_>, inner_node: Expr<'_>) -> bool {
    matches!(inner_node.tag(), ExprTag::Object)
        && matches!(
            node.parent(),
            Node::Func(func) if matches!(func.body(), FnBody::Expr(body) if body == node)
        )
}
