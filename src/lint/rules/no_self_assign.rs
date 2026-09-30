//! Ported from ESLint lib/rules/no-self-assign.js, with its default: properties are checked.

use bun_ast::flags::Property as Flag;
use bun_ast::{E, Expr, ExprData, G, Loc, OpCode};

use crate::ast_utils::{self, is_same_reference};
use crate::context::Context;
use crate::rule::{Rule, RuleCategory};
use crate::rules::text;

static RULE: Rule = Rule {
    name: "no-self-assign",
    category: RuleCategory::Correctness,
};

/// `node` is an assignment expression: not the default of a pattern element.
pub(crate) fn e_binary(context: &mut Context<'_, '_>, node: &E::Binary) {
    if matches!(
        node.op,
        OpCode::BinAssign
            | OpCode::BinLogicalAndAssign
            | OpCode::BinLogicalOrAssign
            | OpCode::BinNullishCoalescingAssign
    ) {
        each_self_assignment(context, &node.left, &node.right);
    }
}

fn is_member(expr: &Expr) -> bool {
    matches!(expr.data, ExprData::EDot(_) | ExprData::EIndex(_))
}

/// `eachSelfAssignment`: `left` is a pattern, which Bun's tree writes as the literal it looks like.
fn each_self_assignment(context: &mut Context<'_, '_>, left: &Expr, right: &Expr) {
    if !context.stack_check.is_safe_to_recurse() {
        return;
    }
    match (&left.data, &right.data) {
        (ExprData::EMissing(_), _) | (_, ExprData::EMissing(_)) => {}
        (ExprData::EIdentifier(l), ExprData::EIdentifier(r)) => {
            if context.name_of(l.ref_) == context.name_of(r.ref_) {
                report(context, right);
            }
        }
        (ExprData::EArray(l), ExprData::EArray(r)) => {
            let (l, r) = (l.items.as_slice(), r.items.as_slice());
            for (index, (left, right)) in l.iter().zip(r).enumerate() {
                if matches!(left.data, ExprData::ESpread(_)) && index + 1 < r.len() {
                    break;
                }
                each_self_assignment(context, left, right);
                if matches!(right.data, ExprData::ESpread(_)) {
                    break;
                }
            }
        }
        (ExprData::ESpread(l), ExprData::ESpread(r)) => {
            each_self_assignment(context, &l.value, &r.value)
        }
        (ExprData::EObject(l), ExprData::EObject(r)) if !r.properties.as_slice().is_empty() => {
            let r = r.properties.as_slice();
            // What is written before the last spread of the right side may be overwritten by it.
            let after_spread = r
                .iter()
                .rposition(|property| matches!(property.kind, G::PropertyKind::Spread))
                .map_or(0, |index| index + 1);
            for left in l.properties.as_slice() {
                for right in r.get(after_spread..).unwrap_or(&[]) {
                    each_property(context, left, right);
                }
            }
        }
        _ => {
            if is_member(left) && is_member(right) && is_same_reference(context, left, right) {
                report(context, right);
            }
        }
    }
}

/// The `Property` branch of `eachSelfAssignment`; a `{a = 1}` on the left never matches there.
fn each_property(context: &mut Context<'_, '_>, left: &G::Property, right: &G::Property) {
    if !matches!(left.kind, G::PropertyKind::Normal)
        || !matches!(right.kind, G::PropertyKind::Normal)
        || right.flags.contains(Flag::IsMethod)
        || left.initializer.is_some()
    {
        return;
    }
    let (Some(left_key), Some(right_key), Some(left_value), Some(right_value)) =
        (&left.key, &right.key, &left.value, &right.value)
    else {
        return;
    };
    let same = match (
        ast_utils::get_static_string_value(left_key),
        ast_utils::get_static_string_value(right_key),
    ) {
        (Some(left), Some(right)) => left.bytes() == right.bytes(),
        _ => false,
    };
    if same {
        each_self_assignment(context, left_value, right_value);
    }
}

/// Where ESTree starts `node`, how many `(` of it were not found before that, and where it ends.
fn range_of(context: &Context<'_, '_>, node: &Expr) -> Option<(Loc, u32, u32)> {
    match &node.data {
        ExprData::EIdentifier(_) => Some((node.loc, 0, context.token_end(node.loc)?)),
        ExprData::EDot(dot) => {
            let (start, missing) = context.start_of(node.loc, dot.name_loc, &[&dot.target])?;
            Some((start, missing, context.token_end(dot.name_loc)?))
        }
        ExprData::EIndex(index) => {
            let (start, missing) = context.start_of(node.loc, index.index.loc, &[&index.target])?;
            let end = if matches!(index.index.data, ExprData::EPrivateIdentifier(_)) {
                context.token_end(index.index.loc)?
            } else {
                context.close_bracket(&index.index)?.checked_add(1)?
            };
            Some((start, missing, end))
        }
        _ => None,
    }
}

fn report(context: &mut Context<'_, '_>, node: &Expr) {
    // A node whose text does not read is not reported: its name is its text.
    let Some((start, missing, end)) = range_of(context, node) else {
        return;
    };
    let Some(source) = usize::try_from(start.start)
        .ok()
        .and_then(|from| context.text().get(from..end as usize))
    else {
        return;
    };
    // A `(` of the node that the look-back did not reach: the name has it all the same.
    let mut name = vec![b'('; missing as usize];
    without_white_space(source, &mut name);
    context.report(
        &RULE,
        start,
        text(&[b"'", &name, b"' is assigned to itself."]),
    );
}

/// `text.replace(/\s+/gu, "")`.
fn without_white_space(text: &[u8], out: &mut Vec<u8>) {
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        let (is_space, len) = match byte {
            b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ' => (true, 1),
            0xC2 => (text.get(at + 1) == Some(&0xA0), 2),
            0xE1 => (text.get(at + 1..at + 3) == Some(&[0x9A, 0x80]), 3),
            0xE2 => (
                matches!(
                    text.get(at + 1..at + 3),
                    Some([0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF] | [0x81, 0x9F])
                ),
                3,
            ),
            0xE3 => (text.get(at + 1..at + 3) == Some(&[0x80, 0x80]), 3),
            0xEF => (text.get(at + 1..at + 3) == Some(&[0xBB, 0xBF]), 3),
            0xF0..=0xF7 => (false, 4),
            0xC0..=0xDF => (false, 2),
            0xE0..=0xEE => (false, 3),
            _ => (false, 1),
        };
        let end = (at + len).min(text.len());
        if !is_space {
            out.extend_from_slice(text.get(at..end).unwrap_or(&[]));
        }
        at = end;
    }
}
