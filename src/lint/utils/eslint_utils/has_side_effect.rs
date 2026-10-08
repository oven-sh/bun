//! `has-side-effect.mjs`

use crate::ast::{BinOp, Expr, ExprKind, File, FnKind, Key, KeyKind, Node, UnOp};
use crate::tokens::skip_trivia;
use crate::utils::estree_compat::is_assignment_target;

/// eslint-utils' `HasSideEffectOptions`.
#[derive(Copy, Clone, Default, Debug)]
pub struct HasSideEffectOptions {
    /// Any member access may run a getter.
    pub consider_getters: bool,
    /// An operator whose operands are not all literals may run `valueOf`, `toString` or
    /// `[Symbol.toPrimitive]`, and so may a computed key.
    pub consider_implicit_type_conversion: bool,
}

/// eslint-utils' `hasSideEffect`: whether evaluating `node` may have a side effect. An assignment,
/// `await`, a call, `new`, `import()`, `delete`, `++`, `--` and `yield` have one. What is in a
/// function expression or an arrow function is not evaluated.
///
/// Types are not looked into.
pub fn has_side_effect<'a>(node: impl Into<Node<'a>>, options: HasSideEffectOptions) -> bool {
    visit(node.into(), options)
}

fn visit_children(node: Node<'_>, options: HasSideEffectOptions) -> bool {
    let mut found = false;
    node.for_each_child(|child| found = found || visit(child, options));
    found
}

/// ESTree's `Literal`.
fn is_literal(e: Expr<'_>) -> bool {
    matches!(
        e.kind(),
        ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
    )
}

/// Whether `key` is computed and not a `Literal`.
fn converts_key<'a>(key: Option<Key<'a>>, file: &'a File<'a>, options: HasSideEffectOptions) -> bool {
    if !options.consider_implicit_type_conversion {
        return false;
    }
    match key.map(Key::kind) {
        Some(KeyKind::Computed(e)) => !is_literal(e),
        // Also a template without substitutions, and a number with a sign.
        Some(KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_)) => {
            let start = key.map_or(0, |key| key.span(file).start);
            let mut at = skip_trivia(file.text(), start + 1);
            while file.text().get(at as usize) == Some(&b'(') {
                at = skip_trivia(file.text(), at + 1);
            }
            !matches!(file.text().get(at as usize), Some(b'"' | b'\'' | b'.' | b'0'..=b'9'))
        }
        _ => false,
    }
}

fn visit(node: Node<'_>, options: HasSideEffectOptions) -> bool {
    let converts = options.consider_implicit_type_conversion;
    match node {
        Node::Type(_) | Node::TypeParam(_) | Node::TupleElem(_) => false,
        Node::Func(func) => {
            matches!(func.kind(), FnKind::Decl | FnKind::StaticBlock) && visit_children(node, options)
        }
        Node::Member(member) => converts_key(member.key(), node.file(), options) || visit_children(node, options),
        Node::Prop(prop) => converts_key(prop.key(), node.file(), options) || visit_children(node, options),
        Node::PatProp(prop) => converts_key(prop.key(), node.file(), options) || visit_children(node, options),
        Node::Expr(e) => match e.kind() {
            // ESTree's `AssignmentPattern`
            ExprKind::Assign { .. } if is_assignment_target(e) => visit_children(node, options),
            ExprKind::Assign { .. }
            | ExprKind::Await(_)
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::Yield { .. }
            | ExprKind::Unary {
                op: UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => true,
            ExprKind::Unary {
                op: UnOp::Minus | UnOp::Plus | UnOp::Not | UnOp::BitNot,
                operand,
            } if converts && !is_literal(operand) => true,
            ExprKind::Binary { op, left, right }
                if converts
                    && !matches!(
                        op,
                        BinOp::EqEqEq
                            | BinOp::NotEqEq
                            | BinOp::Pow
                            | BinOp::Instanceof
                            | BinOp::And
                            | BinOp::Or
                            | BinOp::Nullish
                            | BinOp::Comma
                    )
                    && !(is_literal(left) && is_literal(right)) =>
            {
                true
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } if options.consider_getters => true,
            ExprKind::Index { index, .. } if converts && !is_literal(index) => true,
            _ => visit_children(node, options),
        },
        _ => visit_children(node, options),
    }
}
