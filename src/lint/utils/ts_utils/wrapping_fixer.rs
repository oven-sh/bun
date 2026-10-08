//! `getWrappingFixer.ts`.

use super::estree::is_expression_statement;
use super::precedence::parenthesize;
use crate::ast::{BinOp, Expr, ExprKind, FnBody, FnKind, Node, Stmt, StmtKind, TypeKind, UnOp};
use crate::context::IntoText;
use crate::fix::{Fix, Fixer};
use smallvec::SmallVec;
use std::borrow::Cow;

/// The parameters of [`get_wrapping_fixer`].
pub struct WrappingFixerParams<'a, 'i, W> {
    /// The expression to replace.
    pub node: Expr<'a>,
    /// Upstream's `innerNode`: the descendants of `node` to keep. Empty stands for `node` itself.
    pub inner_nodes: &'i [Expr<'a>],
    /// Given the code of each of the inner nodes, in parentheses where it needs them, returns the
    /// code to put in the place of `node`.
    pub wrap: W,
}

/// The code of the inner nodes of a wrapping fixer. With `is_chain_element`, a `node` that is all of
/// an optional chain is the call or the member access, not the `ChainExpression`.
fn inner_codes<'a>(
    node: Expr<'a>,
    inner_nodes: &[Expr<'a>],
    is_chain_element: bool,
) -> SmallVec<[Cow<'a, [u8]>; 2]> {
    let itself = [node];
    let inner_nodes: &[Expr<'a>] = if inner_nodes.is_empty() { &itself } else { inner_nodes };
    inner_nodes
        .iter()
        .map(|&inner| {
            let is_strong = is_strong_precedence_node(inner)
                || (is_chain_element
                    && inner == node
                    && matches!(
                        inner.kind(),
                        ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_)
                    ));
            match is_strong && !is_object_expression_in_one_line_return(node, inner) {
                true => Cow::Borrowed(inner.text()),
                false => Cow::Owned(parenthesize(inner.text())),
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
    let codes = inner_codes(node, inner_nodes, is_chain_element);
    let codes: SmallVec<[&[u8]; 2]> = codes.iter().map(|code| &**code).collect();
    let mut code = wrap(&codes).into_text();
    // A `ChainExpression` is neither a weak parent nor the left of anything.
    let is_in_chain_expression = is_chain_element && node.is_chain_root();
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

/// typescript-eslint's `getWrappingFixer`: replaces `node` by what `wrap` makes of the code of the
/// inner nodes, and adds parentheses, and a `;` before, where the result needs them.
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
/// A `node` that is all of an optional chain stands for the `ChainExpression`. Where upstream
/// passes the `CallExpression` or the `MemberExpression` in it, which is what a listener for those
/// gets, use [`get_wrapping_fixer_for_chain_element`]. Without `wrap`:
/// [`get_wrapping_fixer_without_wrap`].
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

/// typescript-eslint's `getWrappingFixer` for a `node` that upstream gets from a listener for
/// `CallExpression` or `MemberExpression`, or by `skipChainExpression`. If it is all of an optional
/// chain, its parent in ESTree is the `ChainExpression`, and nothing is added around the result of
/// `wrap`.
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

/// typescript-eslint's `getWrappingFixer` without `wrap`: replaces `node` by the code of the inner
/// nodes, each in parentheses unless it is a [strong precedence node](is_strong_precedence_node).
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

/// typescript-eslint's `getMovedNodeCode`: the code of `node_to_move`, in parentheses if it may
/// need them in the place of `destination_node`. Each is an expression or a type.
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

/// typescript-eslint's `isStrongPrecedenceNode`: whether the node keeps its meaning whatever is
/// written around it. A literal, an identifier, an array, an object, a member access, a call, a
/// `new`, a tagged template, `f<T>`, or a type reference.
///
/// All of an optional chain is a `ChainExpression`, which is not one. Nor are `this` and a
/// template.
pub fn is_strong_precedence_node<'a>(node: impl Into<Node<'a>>) -> bool {
    match node.into() {
        Node::Expr(e) => match e.kind() {
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::Ident(_)
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::New(_)
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Instantiation { .. } => true,
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => {
                !e.is_chain_root()
            }
            _ => false,
        },
        Node::Type(ty) => matches!(ty.kind(), TypeKind::Ref { .. }),
        Node::Pat(pat) => pat.as_ident().is_some(),
        _ => false,
    }
}

/// typescript-eslint's `isWeakPrecedenceParent`: whether the parent of the node could take what
/// replaces the node apart. The parent is a unary, a binary, a logical or a conditional expression
/// or an `await`, or the node is the object of a member access, the callee of a call or of a `new`,
/// or the tag of a template.
///
/// An expression that is all of an optional chain stands for the `ChainExpression`. The parent of
/// the `CallExpression` or the `MemberExpression` in it is that, which is not weak: for such a
/// node, upstream's answer is `false`.
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
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj == node,
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
            call.callee() == node
        }
        _ => false,
    }
}

/// typescript-eslint's `isMissingSemicolonBefore`: whether `node` is at the start of an expression
/// statement in a block, and the statement before that does not end with a `;`.
pub fn is_missing_semicolon_before(node: Expr<'_>) -> bool {
    let mut node = node;
    loop {
        let parent = match node.parent() {
            Node::Stmt(statement) => {
                return is_expression_statement(statement)
                    && previous_statement_in_block(statement)
                        .is_some_and(|previous| !previous.text().ends_with(b";"));
            }
            Node::Expr(parent) => parent,
            _ => return false,
        };
        // The parent of `parent` is a `ChainExpression`, which `parent` is not the left of.
        if !is_left_hand_side(node) || parent.is_chain_root() {
            return false;
        }
        node = parent;
    }
}

/// The statement before `statement` in the `Program` or the `BlockStatement` it is directly in.
fn previous_statement_in_block(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    let siblings = match statement.parent() {
        Node::File(file) => file.body(),
        Node::Func(func) if func.kind() != FnKind::StaticBlock => func.body_statements()?,
        Node::Stmt(block) => match block.kind() {
            StmtKind::Block(statements) => statements,
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

/// typescript-eslint's `isLeftHandSide`: whether `node` is the operand of `++` or `--`, the left of
/// a binary, a logical or an assignment expression, the test of a conditional expression, the
/// callee of a call or the tag of a template.
pub fn is_left_hand_side(node: Expr<'_>) -> bool {
    let Node::Expr(parent) = node.parent() else {
        return false;
    };
    match parent.kind() {
        ExprKind::Unary { op, .. } => {
            matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec)
        }
        ExprKind::Binary { op, left, .. } => op != BinOp::Comma && left == node,
        ExprKind::Assign { target, .. } => target == node,
        ExprKind::Cond { test, .. } => test == node,
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => call.callee() == node,
        _ => false,
    }
}

/// typescript-eslint's `isObjectExpressionInOneLineReturn`: `node` is the body of an arrow function
/// and `inner_node` is an object literal, which would be taken for a block there.
fn is_object_expression_in_one_line_return(node: Expr<'_>, inner_node: Expr<'_>) -> bool {
    matches!(inner_node.kind(), ExprKind::Object(_))
        && matches!(
            node.parent(),
            Node::Func(func) if matches!(func.body(), FnBody::Expr(body) if body == node)
        )
}
