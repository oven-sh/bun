//! Prettier's `isSimpleCallArgument`.

use crate::prelude::*;

/// An argument of a call, to ask whether it is "simple": a literal, a name, or something small
/// that is made of those. A chain of calls with simple arguments is more likely to stay on one
/// line.
#[derive(Debug, Copy, Clone)]
pub(crate) struct SimpleArgument<'a>(Expr<'a>);

impl<'a> SimpleArgument<'a> {
    pub(crate) fn new(argument: Expr<'a>) -> Self {
        Self(argument)
    }

    pub(crate) fn is_simple(self) -> bool {
        is_simple(self.0, 0)
    }

    pub(crate) fn is_simple_with_depth(self, depth: u8) -> bool {
        is_simple(self.0, depth)
    }
}

fn is_simple(e: Expr<'_>, depth: u8) -> bool {
    if depth >= 2 {
        return false;
    }
    match e.kind() {
        ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::String(_)
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::This
        | ExprKind::Ident(_)
        | ExprKind::Super => true,
        ExprKind::Regex(regex) => regex.pattern().len() <= 5,
        ExprKind::Template(template) => is_simple_template_literal(template, depth + 1),
        ExprKind::Object(props) => props.iter().all(|prop| match prop.kind() {
            PropKind::Shorthand => true,
            PropKind::Init => {
                !prop.key().is_some_and(Key::is_computed) && prop.value().is_some_and(|value| is_simple(value, depth + 1))
            }
            _ => false,
        }),
        ExprKind::Array(elements) => elements.iter().all(|element| match element.kind() {
            ExprKind::Missing => true,
            ExprKind::Spread(_) => false,
            _ => is_simple(element, depth + 1),
        }),
        ExprKind::Unary {
            op: UnOp::Not | UnOp::Minus | UnOp::Plus | UnOp::BitNot,
            operand,
        } => is_simple(operand, depth),
        ExprKind::Unary { op, operand } if op.is_update() => matches!(operand.kind(), ExprKind::Ident(_)),
        ExprKind::NonNull(expression) => is_simple(expression, depth),
        ExprKind::Dot { obj, .. } => is_simple(obj, depth),
        ExprKind::Index { obj, index, .. } => is_simple(index, depth) && is_simple(obj, depth),
        ExprKind::New(call) | ExprKind::Call(call) => {
            is_simple(call.callee(), depth)
                && call.args().len() + usize::from(depth) <= 2
                && call.args().iter().all(|argument| is_simple(argument, depth + 1))
        }
        ExprKind::ImportCall { args } => args.len() <= 1,
        _ => false,
    }
}

/// No text of the template has a line break, and all substitutions are simple.
pub(crate) fn is_simple_template_literal(template: Template<'_>, depth: u8) -> bool {
    (0..template.quasi_count()).all(|i| !bun_core::strings::contains_char(template.raw(i), b'\n'))
        && template.exprs().iter().all(|e| is_simple(e, depth))
}
