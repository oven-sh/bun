//! Ported from ESLint lib/rules/utils/ast-utils.js: the helpers that the rules share, on Bun's nodes.

use bun_ast::{E, Expr, ExprData};

use crate::context::Context;

/// The name of a property as the program would see it, in UTF-8.
pub(crate) enum Name<'a> {
    Borrowed(&'a [u8]),
    Owned(Vec<u8>),
}

impl Name<'_> {
    #[inline]
    pub(crate) fn bytes(&self) -> &[u8] {
        match self {
            Name::Borrowed(bytes) => bytes,
            Name::Owned(bytes) => bytes,
        }
    }
}

/// `getStaticStringValue`, and `getStaticPropertyName` of a property: a plain name is a string in Bun's tree. A TypeScript wrapper around `key` is a node without a static value.
pub(crate) fn get_static_string_value<'e>(
    context: &Context<'_, '_>,
    key: &'e Expr,
) -> Option<Name<'e>> {
    if context.ts_wrapper(key).is_some() {
        return None;
    }
    static_string_value(key)
}

/// The static value of a node that is a literal for ESLint.
fn static_string_value(key: &Expr) -> Option<Name<'_>> {
    match &key.data {
        ExprData::EString(string) => of_string(string),
        ExprData::ENumber(number) => {
            let mut buffer = [0u8; 124];
            Some(Name::Owned(
                bun_core::fmt::FormatDouble::dtoa(&mut buffer, number.value()).to_vec(),
            ))
        }
        ExprData::EBigInt(big) => of_big_int(big.value.slice()),
        ExprData::EBoolean(boolean) => Some(Name::Borrowed(if boolean.value {
            b"true"
        } else {
            b"false"
        })),
        ExprData::ENull(_) => Some(Name::Borrowed(b"null")),
        ExprData::ERegExp(reg_exp) => Some(of_reg_exp(reg_exp)),
        _ => None,
    }
}

/// `getStaticPropertyName` of a member expression.
pub(crate) fn get_static_property_name<'e>(
    context: &Context<'_, '_>,
    member: &'e Expr,
) -> Option<Name<'e>> {
    match &member.data {
        ExprData::EDot(dot) => Some(Name::Borrowed(dot.name.slice())),
        ExprData::EIndex(index) => get_static_string_value(context, &index.index),
        _ => None,
    }
}

fn of_string(string: &E::EString) -> Option<Name<'_>> {
    if string.next.is_some() {
        return None;
    }
    if string.is_utf8() {
        return Some(Name::Borrowed(string.slice8()));
    }
    let mut out = Vec::with_capacity(string.slice16().len());
    for unit in char::decode_utf16(string.slice16().iter().copied()) {
        // Two lone surrogates are two names: neither is compared.
        let unit = unit.ok()?;
        let mut utf8 = [0u8; 4];
        out.extend_from_slice(unit.encode_utf8(&mut utf8).as_bytes());
    }
    Some(Name::Owned(out))
}

/// ESLint compares the decimal digits of the value: `0x10n` is `16`. The lexer leaves no `_` and no `n` in `digits`.
fn of_big_int(digits: &[u8]) -> Option<Name<'_>> {
    let (radix, digits) = match digits {
        [b'0', b'x' | b'X', rest @ ..] => (16, rest),
        [b'0', b'o' | b'O', rest @ ..] => (8, rest),
        [b'0', b'b' | b'B', rest @ ..] => (2, rest),
        _ => return Some(Name::Borrowed(digits)),
    };
    // The conversion is quadratic: a literal longer than this is not compared.
    if digits.len() > 4096 {
        return None;
    }
    // Base 1_000_000_000, the lowest limb first.
    let mut limbs: Vec<u32> = vec![0];
    for &digit in digits {
        let mut carry = u64::from(char::from(digit).to_digit(radix)?);
        for limb in &mut limbs {
            let value = u64::from(*limb) * u64::from(radix) + carry;
            *limb = (value % 1_000_000_000) as u32;
            carry = value / 1_000_000_000;
        }
        if carry > 0 {
            limbs.push(carry as u32);
        }
    }
    let mut out = Vec::with_capacity(limbs.len() * 9);
    let mut buffer = bun_core::fmt::ItoaBuf::new();
    for (index, limb) in limbs.iter().rev().enumerate() {
        let text = buffer.format(*limb).as_bytes();
        if index > 0 {
            out.extend_from_slice(b"000000000".get(text.len()..).unwrap_or(b""));
        }
        out.extend_from_slice(text);
    }
    Some(Name::Owned(out))
}

/// `String(/a/ig)` is `/a/gi`: the flags in the order of `RegExp.prototype.flags`.
fn of_reg_exp(reg_exp: &E::RegExp) -> Name<'_> {
    let raw = reg_exp.value.slice();
    // `flags_offset` is a `u16` and wraps in a long literal: the flags are what follows the last `/`.
    let flags_at =
        bun_core::strings::last_index_of_char(raw, b'/').map_or(raw.len(), |slash| slash + 1);
    let Some(flags) = raw.get(flags_at..) else {
        return Name::Borrowed(raw);
    };
    if flags.is_sorted() {
        return Name::Borrowed(raw);
    }
    let mut out = raw.to_vec();
    if let Some(flags) = out.get_mut(flags_at..) {
        flags.sort_unstable();
    }
    Name::Owned(out)
}

/// `isSameReference`: `a?.b` and `a.b` are one reference.
pub(crate) fn is_same_reference(context: &Context<'_, '_>, left: &Expr, right: &Expr) -> bool {
    if !context.stack_check.is_safe_to_recurse() {
        return false;
    }
    // A TypeScript wrapper is a node of a kind that is the same reference as nothing.
    if context.ts_wrapper(left).is_some() || context.ts_wrapper(right).is_some() {
        return false;
    }
    match (&left.data, &right.data) {
        (ExprData::EThis(_), ExprData::EThis(_)) | (ExprData::ESuper(_), ExprData::ESuper(_)) => {
            true
        }
        (ExprData::EIdentifier(l), ExprData::EIdentifier(r)) => {
            context.name_of(l.ref_) == context.name_of(r.ref_)
        }
        (ExprData::EPrivateIdentifier(l), ExprData::EPrivateIdentifier(r)) => {
            context.name_of(l.ref_) == context.name_of(r.ref_)
        }
        (ExprData::EDot(_) | ExprData::EIndex(_), ExprData::EDot(_) | ExprData::EIndex(_)) => {
            let (Some(left_target), Some(right_target)) = (target_of(left), target_of(right))
            else {
                return false;
            };
            if let Some(name) = get_static_property_name(context, left) {
                return get_static_property_name(context, right)
                    .is_some_and(|other| other.bytes() == name.bytes())
                    && is_same_reference(context, left_target, right_target);
            }
            let (ExprData::EIndex(l), ExprData::EIndex(r)) = (&left.data, &right.data) else {
                return false;
            };
            // `a.#b` is not computed, `a[b]` is.
            let is_private = |index: &Expr| matches!(index.data, ExprData::EPrivateIdentifier(_));
            is_private(&l.index) == is_private(&r.index)
                && is_same_reference(context, left_target, right_target)
                && is_same_reference(context, &l.index, &r.index)
        }
        _ => equal_literal_value(left, right),
    }
}

fn target_of(member: &Expr) -> Option<&Expr> {
    match &member.data {
        ExprData::EDot(dot) => Some(&dot.target),
        ExprData::EIndex(index) => Some(&index.target),
        _ => None,
    }
}

/// `equalLiteralValue`, for two nodes that ESTree calls `Literal`.
fn equal_literal_value(left: &Expr, right: &Expr) -> bool {
    match (&left.data, &right.data) {
        (ExprData::ERegExp(l), ExprData::ERegExp(r)) => l.value.slice() == r.value.slice(),
        (ExprData::EBigInt(l), ExprData::EBigInt(r)) => {
            match (static_string_value(left), static_string_value(right)) {
                (Some(l), Some(r)) => l.bytes() == r.bytes(),
                _ => l.value.slice() == r.value.slice(),
            }
        }
        (ExprData::ENull(_), ExprData::ENull(_)) => true,
        (ExprData::EBoolean(l), ExprData::EBoolean(r)) => l.value == r.value,
        (ExprData::ENumber(l), ExprData::ENumber(r)) => l.value() == r.value(),
        (ExprData::EString(l), ExprData::EString(r))
            if !l.prefer_template && !r.prefer_template =>
        {
            match (static_string_value(left), static_string_value(right)) {
                (Some(l), Some(r)) => l.bytes() == r.bytes(),
                _ => false,
            }
        }
        _ => false,
    }
}
