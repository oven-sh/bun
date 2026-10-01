//! ESLint: lib/rules/no-self-assign.js (props: true)
use crate::context::Context;
use crate::names::{static_key_name, static_member_name};
use bun_ast::expr::Data as ExprData;
use bun_ast::flags::Property as Flag;
use bun_ast::{E, Expr, G, OpCode};

const NAME: &str = "no-self-assign";

pub(crate) fn e_binary(cx: &mut Context<'_, '_>, node: &E::Binary, is_default: bool) {
    // `[a = a] = b`: the inner `=` gives a default.
    if is_default {
        return;
    }
    if matches!(
        node.op,
        OpCode::BinAssign | OpCode::BinLogicalAndAssign | OpCode::BinLogicalOrAssign | OpCode::BinNullishCoalescingAssign
    ) {
        each_self_assignment(cx, &node.left, &node.right, bun_core::StackCheck::init());
    }
}

fn is_member(expr: &Expr) -> bool {
    matches!(expr.data, ExprData::EDot(_) | ExprData::EIndex(_))
}

/// `left` is what is written to, an expression all the same: an array or object literal in it is a pattern.
fn each_self_assignment(cx: &mut Context<'_, '_>, left: &Expr, right: &Expr, stack: bun_core::StackCheck) {
    if !stack.is_safe_to_recurse() {
        return;
    }
    match (&left.data, &right.data) {
        (ExprData::EMissing(_), _) | (_, ExprData::EMissing(_)) => {}
        (ExprData::EIdentifier(a), ExprData::EIdentifier(b)) => {
            if cx.name(a.ref_) == cx.name(b.ref_) {
                report(cx, right);
            }
        }
        (ExprData::EArray(pattern), ExprData::EArray(array)) => {
            let end = pattern.items.len().min(array.items.len());
            for index in 0..end {
                let (left_element, right_element) = (&pattern.items[index], &array.items[index]);
                // A rest element takes what is left: it pairs with a spread only when that is the last element.
                if matches!(left_element.data, ExprData::ESpread(_)) && index < array.items.len() - 1 {
                    break;
                }
                each_self_assignment(cx, left_element, right_element, stack);
                if matches!(right_element.data, ExprData::ESpread(_)) {
                    break;
                }
            }
        }
        (ExprData::ESpread(rest), ExprData::ESpread(spread)) => each_self_assignment(cx, &rest.value, &spread.value, stack),
        (ExprData::EObject(pattern), ExprData::EObject(object)) if !object.properties.is_empty() => {
            // A property before a spread may be overwritten by it.
            let start = object.properties.iter().rposition(|property| property.kind == G::PropertyKind::Spread).map_or(0, |index| index + 1);
            let (mut left_name, mut right_name) = (Vec::new(), Vec::new());
            for left_property in pattern.properties.iter() {
                for right_property in &object.properties[start..] {
                    if left_property.kind != G::PropertyKind::Normal
                        || right_property.kind != G::PropertyKind::Normal
                        || right_property.flags.contains(Flag::IsMethod)
                    {
                        continue;
                    }
                    // `{a = 1}`: a default.
                    if left_property.initializer.is_some() {
                        continue;
                    }
                    let (Some(left_key), Some(right_key)) = (&left_property.key, &right_property.key) else { continue };
                    let (Some(left_value), Some(right_value)) = (&left_property.value, &right_property.value) else { continue };
                    if static_key_name(left_key, left_property.flags.contains(Flag::IsComputed), cx.arena(), &mut left_name)
                        && static_key_name(right_key, right_property.flags.contains(Flag::IsComputed), cx.arena(), &mut right_name)
                        && left_name == right_name
                    {
                        each_self_assignment(cx, left_value, right_value, stack);
                    }
                }
            }
        }
        _ => {
            if is_member(left) && is_member(right) && is_same_reference(cx, left, right, stack) {
                report(cx, right);
            }
        }
    }
}

/// ESLint: astUtils.isSameReference. An optional chain is the access it guards.
fn is_same_reference(cx: &Context<'_, '_>, left: &Expr, right: &Expr, stack: bun_core::StackCheck) -> bool {
    if !stack.is_safe_to_recurse() {
        return false;
    }
    match (&left.data, &right.data) {
        (ExprData::EThis(_), ExprData::EThis(_)) | (ExprData::ESuper(_), ExprData::ESuper(_)) => true,
        (ExprData::EIdentifier(a), ExprData::EIdentifier(b)) => cx.name(a.ref_) == cx.name(b.ref_),
        (ExprData::EPrivateIdentifier(a), ExprData::EPrivateIdentifier(b)) => cx.name(a.ref_) == cx.name(b.ref_),
        // ESLint: equalLiteralValue. A template is no literal.
        (ExprData::EString(a), ExprData::EString(b)) => !a.prefer_template && !b.prefer_template && a.eql_string(b),
        (ExprData::ENumber(a), ExprData::ENumber(b)) => a.value() == b.value(),
        (ExprData::EBigInt(_), ExprData::EBigInt(_)) => {
            let (mut a, mut b) = (Vec::new(), Vec::new());
            static_key_name(left, false, cx.arena(), &mut a) && static_key_name(right, false, cx.arena(), &mut b) && a == b
        }
        (ExprData::ENull(_), ExprData::ENull(_)) => true,
        (ExprData::EBoolean(a), ExprData::EBoolean(b)) => a.value == b.value,
        (ExprData::ERegExp(a), ExprData::ERegExp(b)) => *a.value == *b.value,
        _ if is_member(left) && is_member(right) => {
            let (left_target, right_target) = (member_target(left), member_target(right));
            let (mut left_name, mut right_name) = (Vec::new(), Vec::new());
            if static_member_name(left, cx.arena(), &mut left_name) {
                // `x.y = x["y"]`
                return is_same_reference(cx, left_target, right_target, stack)
                    && static_member_name(right, cx.arena(), &mut right_name)
                    && left_name == right_name;
            }
            // `x[y] = x[y]`, `x.#y = x.#y`: the left one is an index without a static name.
            let (ExprData::EIndex(left_index), ExprData::EIndex(right_index)) = (&left.data, &right.data) else { return false };
            is_private(&left_index.index) == is_private(&right_index.index)
                && is_same_reference(cx, left_target, right_target, stack)
                && is_same_reference(cx, &left_index.index, &right_index.index, stack)
        }
        _ => false,
    }
}

fn is_private(expr: &Expr) -> bool {
    matches!(expr.data, ExprData::EPrivateIdentifier(_))
}

fn member_target(expr: &Expr) -> &Expr {
    match &expr.data {
        ExprData::EDot(dot) => &dot.target,
        ExprData::EIndex(index) => &index.target,
        _ => expr,
    }
}

/// Where a reference ends: an identifier, `this`, `super`, a literal key, or an access on one of them.
fn reference_end(cx: &Context<'_, '_>, expr: &Expr, stack: bun_core::StackCheck) -> Option<u32> {
    if !stack.is_safe_to_recurse() {
        return None;
    }
    let at = u32::try_from(expr.loc.start).ok()?;
    match &expr.data {
        ExprData::ERegExp(regexp) => Some(at + regexp.value.len() as u32),
        ExprData::EDot(dot) => Some(cx.token_at(u32::try_from(dot.name_loc.start).ok()?)?.end),
        ExprData::EIndex(index) => {
            let inner = reference_end(cx, &index.index, stack)?;
            if is_private(&index.index) {
                return Some(inner);
            }
            cx.closing_bracket_after(inner)
        }
        ExprData::EIdentifier(_)
        | ExprData::EPrivateIdentifier(_)
        | ExprData::EThis(_)
        | ExprData::ESuper(_)
        | ExprData::EString(_)
        | ExprData::ENumber(_)
        | ExprData::EBigInt(_)
        | ExprData::ENull(_)
        | ExprData::EBoolean(_) => Some(cx.token_at(at)?.end),
        _ => None,
    }
}

fn report(cx: &mut Context<'_, '_>, right: &Expr) {
    let Ok(own) = u32::try_from(right.loc.start) else { return };
    let Some(end) = reference_end(cx, right, bun_core::StackCheck::init()) else { return };
    // A `(` of the reference itself stands before its first own token: `(a).b`.
    let unmatched = cx.between(own, end, &[right]).map_or(0, |between| between.unmatched);
    let start = cx.open_parens_before(own, unmatched);
    let mut name = Vec::new();
    if start.is_none() {
        name.resize(unmatched as usize, b'(');
    }
    let start = start.unwrap_or(own);
    let Some(text) = cx.text().get(start as usize..end as usize) else { return };
    for c in String::from_utf8_lossy(text).chars() {
        // ESLint removes `\s`.
        let blank = matches!(c, '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}');
        if !blank {
            let mut buffer = [0u8; 4];
            name.extend_from_slice(c.encode_utf8(&mut buffer).as_bytes());
        }
    }
    cx.report(NAME, bun_ast::Loc { start: start as i32 }, format_args!("'{}' is assigned to itself.", String::from_utf8_lossy(&name)));
}
