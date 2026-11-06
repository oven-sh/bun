//! Prettier's `isSimpleCallArgument`.

use crate::js::utils::typecast::is_cast_target_that_hides_its_kind;
use crate::options::Flavor;
use crate::prelude::*;
use smallvec::SmallVec;

/// A call argument that can be checked for being "simple": a literal, a name, or something small made of those. A chain
/// of calls with simple arguments is more likely to stay on one line.
#[derive(Copy, Clone)]
pub(crate) struct SimpleArgument<'a, 'f>(Expr<'a>, &'f Formatter<'a>);

impl<'a, 'f> SimpleArgument<'a, 'f> {
    pub(crate) fn new(argument: Expr<'a>, f: &'f Formatter<'a>) -> Self {
        Self(argument, f)
    }

    pub(crate) fn is_simple(self) -> bool {
        is_simple(self.0, 0, false, self.1)
    }

    pub(crate) fn is_simple_with_depth(self, depth: u8) -> bool {
        is_simple(self.0, depth, false, self.1)
    }

    /// What is in the parentheses of `/** @type {A} */ (b)` is simple, or the argument itself if it is no type cast.
    pub(crate) fn is_simple_in_cast_parentheses(self) -> bool {
        is_simple(self.0, 0, true, self.1)
    }
}

/// Up to five characters. oxfmt counts bytes, so to it `/[“”]/` is long.
fn is_short_pattern(pattern: &[u8], flavor: Flavor) -> bool {
    match flavor.is_oxfmt() {
        true => pattern.len() <= 5,
        false => crate::ir::width::string_width(pattern) <= 5,
    }
}

/// `is_unwrapped`: the parentheses around `e` itself don't count.
fn is_simple<'a>(e: Expr<'a>, depth: u8, mut is_unwrapped: bool, f: &Formatter<'a>) -> bool {
    if depth >= 2 {
        return false;
    }
    let flavor = f.options().flavor;
    // The expressions still to check. All of them are at the same depth as `e`: a chain of accesses and calls can be
    // long, and so can `a[b[c[..]]]`.
    let mut pending = SmallVec::<[Expr<'a>; 4]>::new();
    let mut next = Some(e);
    while let Some(mut e) = next {
        loop {
            // `/** @type {A} */ (b)` is a `ParenthesizedExpression`.
            if !std::mem::take(&mut is_unwrapped) && is_cast_target_that_hides_its_kind(e, f) {
                return false;
            }
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
                    if is_simple_template_literal(template, depth + 1, f) =>
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
                                    .is_some_and(|value| is_simple(value, depth + 1, false, f))
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
                        _ => is_simple(element, depth + 1, false, f),
                    }) =>
                {
                    break;
                }
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Minus | UnOp::Plus | UnOp::BitNot,
                    operand,
                } => operand,
                // In oxfmt `a++` is simple and `a.b++` isn't.
                ExprKind::Unary { op, operand }
                    if op.is_update()
                        && (!flavor.is_oxfmt() || matches!(operand.kind(), ExprKind::Ident(_))) =>
                {
                    operand
                }
                ExprKind::NonNull(expression) => expression,
                ExprKind::Dot { obj, .. } => obj,
                ExprKind::Index { obj, index, .. } => {
                    pending.push(obj);
                    index
                }
                ExprKind::New(call) | ExprKind::Call(call) if are_simple(call.args(), depth, f) => {
                    call.callee()
                }
                ExprKind::ImportCall { args } if are_simple(args, depth, f) => break,
                _ => return false,
            };
        }
        next = pending.pop();
    }
    true
}

/// A call's arguments: the deeper the call, the fewer it may have.
fn are_simple<'a>(arguments: List<'a, Expr<'a>>, depth: u8, f: &Formatter<'a>) -> bool {
    arguments.len() + usize::from(depth) <= 2
        && arguments
            .iter()
            .all(|argument| is_simple(argument, depth + 1, false, f))
}

/// No text of the template has a line break, and all substitutions are simple.
fn is_simple_template_literal<'a>(template: Template<'a>, depth: u8, f: &Formatter<'a>) -> bool {
    (0..template.quasi_count()).all(|i| !bun_core::strings::contains_char(template.raw(i), b'\n'))
        && template
            .exprs()
            .iter()
            .all(|e| is_simple(e, depth, false, f))
}
