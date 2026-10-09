//! Prettier's `isSimpleCallArgument`.

use crate::options::Flavor;
use crate::prelude::*;
use smallvec::SmallVec;

/// An argument of a call, to ask whether it is "simple": a literal, a name, or something small
/// that is made of those. A chain of calls with simple arguments is more likely to stay on one
/// line.
#[derive(Debug, Copy, Clone)]
pub(crate) struct SimpleArgument<'a>(Expr<'a>, Flavor);

impl<'a> SimpleArgument<'a> {
    pub(crate) fn new(argument: Expr<'a>, f: &Formatter<'a>) -> Self {
        Self(argument, f.options().flavor)
    }

    pub(crate) fn is_simple(self) -> bool {
        is_simple(self.0, 0, self.1)
    }

    pub(crate) fn is_simple_with_depth(self, depth: u8) -> bool {
        is_simple(self.0, depth, self.1)
    }
}

/// Up to five characters. oxfmt counts bytes: for it `/[“”]/` is long.
fn is_short_pattern(pattern: &[u8], flavor: Flavor) -> bool {
    match flavor.is_oxfmt() {
        true => pattern.len() <= 5,
        false => crate::ir::width::string_width(pattern) <= 5,
    }
}

fn is_simple(e: Expr<'_>, depth: u8, flavor: Flavor) -> bool {
    if depth >= 2 {
        return false;
    }
    // What is left to look at. All of it is as deep as `e`: a chain of accesses and calls can be
    // long, and so can `a[b[c[..]]]`.
    let mut pending = SmallVec::<[Expr<'_>; 4]>::new();
    let mut next = Some(e);
    while let Some(mut e) = next {
        loop {
            e = match e.kind() {
                ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::String(_)
                | ExprKind::Number(_)
                | ExprKind::BigInt(_)
                | ExprKind::This
                | ExprKind::Ident(_)
                | ExprKind::PrivateIdentifier(_)
                | ExprKind::Super => break,
                ExprKind::Regex(regex) if is_short_pattern(regex.pattern(), flavor) => break,
                ExprKind::Template(template)
                    if is_simple_template_literal(template, depth + 1, flavor) =>
                {
                    break;
                }
                ExprKind::Object(props)
                    if props.iter().all(|prop| match prop.kind() {
                        PropKind::Shorthand => true,
                        PropKind::Init => {
                            !prop.key().is_some_and(Key::is_computed)
                                && prop
                                    .value()
                                    .is_some_and(|value| is_simple(value, depth + 1, flavor))
                        }
                        _ => false,
                    }) =>
                {
                    break;
                }
                ExprKind::Array(elements)
                    if elements.iter().all(|element| match element.kind() {
                        ExprKind::Missing => true,
                        ExprKind::Spread(_) => false,
                        _ => is_simple(element, depth + 1, flavor),
                    }) =>
                {
                    break;
                }
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Minus | UnOp::Plus | UnOp::BitNot,
                    operand,
                } => operand,
                ExprKind::Unary { op, operand } if op.is_update() => operand,
                ExprKind::NonNull(expression) => expression,
                ExprKind::Dot { obj, .. } => obj,
                ExprKind::Index { obj, index, .. } => {
                    pending.push(obj);
                    index
                }
                ExprKind::New(call) | ExprKind::Call(call)
                    if are_simple(call.args(), depth, flavor) =>
                {
                    call.callee()
                }
                ExprKind::ImportCall { args } if are_simple(args, depth, flavor) => break,
                _ => return false,
            };
        }
        next = pending.pop();
    }
    true
}

/// The arguments of a call: the deeper it is, the fewer it may have.
fn are_simple<'a>(arguments: List<'a, Expr<'a>>, depth: u8, flavor: Flavor) -> bool {
    arguments.len() + usize::from(depth) <= 2
        && arguments
            .iter()
            .all(|argument| is_simple(argument, depth + 1, flavor))
}

/// No text of the template has a line break, and all substitutions are simple.
fn is_simple_template_literal(template: Template<'_>, depth: u8, flavor: Flavor) -> bool {
    (0..template.quasi_count()).all(|i| !bun_core::strings::contains_char(template.raw(i), b'\n'))
        && template.exprs().iter().all(|e| is_simple(e, depth, flavor))
}
