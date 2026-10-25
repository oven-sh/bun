//! `is-parenthesized.mjs`

use crate::ast::{Node, StmtKind};
use crate::tokens::{skip_trivia, skip_trivia_back};
use crate::utils::estree_compat::estree_span;

/// eslint-utils' `isParenthesized(node, sourceCode)`: true if `node` is directly in parentheses
/// that aren't part of its parent's syntax, unlike those of `f(a)`, `if (a)`, `import(a)` and
/// `catch (e)`.
///
/// Like upstream, it counts a parameter list's parentheses. It's true for the only parameter of
/// `(a) => a` and of `function f(a: T) {}`, whether that's passed as the `Param` or as its `Pat`.
#[inline]
pub fn is_parenthesized<'a>(node: impl Into<Node<'a>>) -> bool {
    is_parenthesized_times(1, node)
}

/// eslint-utils' `isParenthesized(times, node, sourceCode)`: true if `node` is in at least `times`
/// pairs of parentheses. False for `times == 0`, where upstream throws.
pub fn is_parenthesized_times<'a>(times: usize, node: impl Into<Node<'a>>) -> bool {
    let mut node = node.into();
    if times == 0 {
        return false;
    }
    // For a function or class expression, use the expression.
    if let Node::Func(_) | Node::Class(_) = node
        && let owner @ Node::Expr(_) = node.parent()
    {
        node = owner;
    }
    match node {
        // The HIR only records parentheses that are expressions in their own right.
        Node::Expr(e) => return e.parens().len() >= times,
        Node::File(_) => return false,
        Node::Pat(_) | Node::VarDecl(_) if is_catch_parameter(node) => return false,
        _ => {}
    }
    let text = node.file().text();
    let mut span = estree_span(node);
    for _ in 0..times {
        let before = skip_trivia_back(text, span.start);
        let after = skip_trivia(text, span.end);
        let open = before.checked_sub(1).and_then(|at| text.get(at as usize));
        if open != Some(&b'(') || text.get(after as usize) != Some(&b')') {
            return false;
        }
        span.start = before - 1;
        span.end = after + 1;
    }
    true
}

fn is_catch_parameter(node: Node<'_>) -> bool {
    let declaration = match node {
        Node::Pat(pat) => pat.parent(),
        _ => node,
    };
    matches!(declaration, Node::VarDecl(_))
        && matches!(
            declaration.parent().as_stmt().map(|it| it.kind()),
            Some(StmtKind::Try { .. })
        )
}
