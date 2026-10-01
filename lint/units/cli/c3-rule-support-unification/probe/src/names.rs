//! The name a property key or a member access has without running the program (ESLint: getStaticPropertyName).
use bun_ast::{E, Expr, ExprData};

/// Writes the name into `out` and answers true; false when the key has no static name.
/// `computed`: the key stands in brackets.
pub(crate) fn static_key_name(key: &Expr, computed: bool, arena: &bun_alloc::Arena, out: &mut Vec<u8>) -> bool {
    out.clear();
    match &key.data {
        // An identifier key and a string key are both a string here.
        ExprData::EString(string) => string_name(string, arena, out),
        ExprData::ENumber(number) => {
            let mut buffer = [0u8; 124];
            out.extend_from_slice(bun_core::fmt::FormatDouble::dtoa(&mut buffer, number.value()));
            true
        }
        ExprData::EBigInt(big) => big_int_name(&big.value, out),
        ExprData::ENull(_) if computed => {
            out.extend_from_slice(b"null");
            true
        }
        ExprData::EBoolean(boolean) if computed => {
            out.extend_from_slice(if boolean.value { b"true" } else { b"false" });
            true
        }
        ExprData::ERegExp(regexp) if computed => reg_exp_name(&regexp.value, out),
        ExprData::ETemplate(template) if computed && template.tag.is_none() && template.parts.slice().is_empty() => {
            match &template.head {
                E::TemplateContents::Cooked(string) => string_name(string, arena, out),
                E::TemplateContents::Raw(_) => false,
            }
        }
        _ => false,
    }
}

/// The text of a string as UTF-8. A string with half of a surrogate pair has no UTF-8: its code units stand
/// for it behind a byte that no UTF-8 text has, so that two such strings are equal only when they are the same.
fn string_name(string: &E::EString, arena: &bun_alloc::Arena, out: &mut Vec<u8>) -> bool {
    if !string.is_utf8() {
        let units = string.slice16();
        if char::decode_utf16(units.iter().copied()).any(|unit| unit.is_err()) {
            out.push(0xFF);
            for unit in units {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            return true;
        }
    }
    match string.string(arena) {
        Ok(bytes) => {
            out.extend_from_slice(bytes);
            true
        }
        Err(_) => false,
    }
}

/// The decimal digits of a BigInt literal as written without its `n`: `0x10` is `16`.
fn big_int_name(raw: &[u8], out: &mut Vec<u8>) -> bool {
    let digits: Vec<u8> = raw.iter().copied().filter(|&byte| byte != b'_' && byte != b'n').collect();
    let radix: u64 = match digits.get(..2) {
        Some(b"0x" | b"0X") => 16,
        Some(b"0o" | b"0O") => 8,
        Some(b"0b" | b"0B") => 2,
        _ => {
            out.extend_from_slice(&digits);
            return true;
        }
    };
    // The value in limbs of nine decimal digits, lowest first.
    let mut limbs: Vec<u64> = vec![0];
    for &digit in &digits[2..] {
        let Some(digit) = (digit as char).to_digit(radix as u32) else { return false };
        let mut carry = digit as u64;
        for limb in limbs.iter_mut() {
            let value = *limb * radix + carry;
            *limb = value % 1_000_000_000;
            carry = value / 1_000_000_000;
        }
        if carry > 0 {
            limbs.push(carry);
        }
    }
    let mut text = String::new();
    for (index, limb) in limbs.iter().rev().enumerate() {
        if index == 0 {
            text.push_str(&limb.to_string());
        } else {
            text.push_str(&format!("{limb:09}"));
        }
    }
    out.extend_from_slice(text.as_bytes());
    true
}

/// `/pattern/flags` with the flags in the order a RegExp prints them.
fn reg_exp_name(raw: &[u8], out: &mut Vec<u8>) -> bool {
    let Some(slash) = raw.iter().rposition(|&byte| byte == b'/') else { return false };
    out.extend_from_slice(&raw[..=slash]);
    for flag in b"dgimsuvy" {
        if raw[slash + 1..].contains(flag) {
            out.push(*flag);
        }
    }
    true
}

/// The property name of `a.b` or of `a[key]` with a static key.
pub(crate) fn static_member_name(expr: &Expr, arena: &bun_alloc::Arena, out: &mut Vec<u8>) -> bool {
    match &expr.data {
        ExprData::EDot(dot) => {
            out.clear();
            out.extend_from_slice(&dot.name);
            true
        }
        ExprData::EIndex(index) => static_key_name(&index.index, true, arena, out),
        _ => false,
    }
}

/// A name for a message: one that stands for code units is decoded, half pairs as U+FFFD.
pub(crate) fn display(name: &[u8]) -> String {
    match name.split_first() {
        Some((0xFF, units)) => {
            let units: Vec<u16> = units.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
            String::from_utf16_lossy(&units)
        }
        _ => String::from_utf8_lossy(name).into_owned(),
    }
}
