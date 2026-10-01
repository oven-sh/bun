//! PROTOTYPE of src/lint/eslint_utils.rs. Ported from @eslint-community/eslint-utils 4.10.1, `getStaticValue` and `getStringIfConstant`: the value of an expression that is known without running it.
//! The values are the primitives and the object of a regular expression literal; an array, an object, a function, a call and `new` have no static value here.

use core::cmp::Ordering;

use bun_ast::{E, Expr, ExprData, OpCode, OptionalChain};

use crate::dupe::Ctx;

#[derive(Clone, Debug, PartialEq)]
pub enum StaticValue {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    BigInt(i128),
    /// The UTF-16 code units of the string.
    String(Vec<u16>),
    /// The object of a regular expression literal: its pattern and its flags as they are written.
    RegExp { pattern: Vec<u8>, flags: Vec<u8> },
}

/// A number or a BigInt: what `ToNumeric` gives.
enum Numeric {
    Number(f64),
    BigInt(i128),
}

/// `getStaticValue(node, scope)`.
pub fn get_static_value(ctx: &Ctx<'_, '_>, node: &Expr) -> Option<StaticValue> {
    get_static_value_r(ctx, node).map(|(value, _)| value)
}

/// `getStringIfConstant(node, scope)`.
pub fn get_string_if_constant(ctx: &Ctx<'_, '_>, node: &Expr) -> Option<Vec<u16>> {
    get_static_value(ctx, node).map(|value| to_string(&value))
}

/// `getStaticValueR` of what is no link of the optional chain of the caller: a chain ends here, as at a `ChainExpression`.
fn value_of(ctx: &Ctx<'_, '_>, node: &Expr) -> Option<StaticValue> {
    get_static_value_r(ctx, node).map(|(value, _)| value)
}

/// `getStaticValueR`: the value, and whether an optional chain was cut short to give it.
fn get_static_value_r(ctx: &Ctx<'_, '_>, node: &Expr) -> Option<(StaticValue, bool)> {
    if !ctx.stack_check.is_safe_to_recurse() {
        return None;
    }
    let plain = |value: StaticValue| Some((value, false));
    match &node.data {
        // `Literal`.
        ExprData::ENull(_) => plain(StaticValue::Null),
        ExprData::EBoolean(boolean) => plain(StaticValue::Boolean(boolean.value)),
        ExprData::ENumber(number) => plain(StaticValue::Number(number.value())),
        ExprData::EBigInt(big) => plain(StaticValue::BigInt(parse_big_int_literal(big.value.slice())?)),
        // A string, and a template without a substitution.
        ExprData::EString(string) => plain(StaticValue::String(units_of(string)?)),
        ExprData::ERegExp(reg_exp) => {
            let raw = reg_exp.value.slice();
            let slash = raw.iter().rposition(|&byte| byte == b'/')?;
            plain(StaticValue::RegExp { pattern: raw.get(1..slash)?.to_vec(), flags: raw.get(slash + 1..)?.to_vec() })
        }
        ExprData::EIdentifier(identifier) => {
            // A builtin global whose value is a primitive. A name that the file declares waits for the resolution of names.
            let name = ctx.parsed.name_of(identifier.ref_);
            if !ctx.is_global(name) {
                return None;
            }
            match name {
                b"undefined" => plain(StaticValue::Undefined),
                b"NaN" => plain(StaticValue::Number(f64::NAN)),
                b"Infinity" => plain(StaticValue::Number(f64::INFINITY)),
                _ => None,
            }
        }
        ExprData::ETemplate(template) => plain(template_value(ctx, template)?),
        ExprData::EUnary(unary) => plain(unary_value(ctx, unary)?),
        ExprData::EBinary(binary) => plain(binary_value(ctx, binary)?),
        ExprData::EIf(conditional) => {
            let test = value_of(ctx, &conditional.test)?;
            plain(value_of(ctx, if to_boolean(&test) { &conditional.yes } else { &conditional.no })?)
        }
        ExprData::EDot(dot) => {
            let name: Vec<u16> = core::str::from_utf8(dot.name.slice()).ok()?.encode_utf16().collect();
            member_value(ctx, &dot.target, dot.optional_chain, |_| Some(name))
        }
        ExprData::EIndex(index) => {
            if matches!(index.index.data, ExprData::EPrivateIdentifier(_)) {
                return None;
            }
            member_value(ctx, &index.target, index.optional_chain, |ctx| value_of(ctx, &index.index).map(|key| to_string(&key)))
        }
        _ => None,
    }
}

/// `MemberExpression`: the properties of a string and of a regular expression that are no function.
fn member_value(
    ctx: &Ctx<'_, '_>,
    target: &Expr,
    chain: Option<OptionalChain>,
    property: impl FnOnce(&Ctx<'_, '_>) -> Option<Vec<u16>>,
) -> Option<(StaticValue, bool)> {
    // A number that is a property of the global `Math` or `Number`: the objects themselves are no value here.
    if let ExprData::EIdentifier(identifier) = &target.data {
        let object = ctx.parsed.name_of(identifier.ref_);
        if matches!(object, b"Math" | b"Number") && ctx.is_global(object) {
            let property = property(ctx)?;
            let name: Vec<u8> = property.iter().map(|&unit| u8::try_from(unit).ok()).collect::<Option<_>>()?;
            return builtin_number(object, &name).map(|number| (StaticValue::Number(number), false));
        }
    }
    // The object of a link that continues a chain is a link of the same chain; any other object is a chain of its own.
    let (object, object_optional) = match chain {
        Some(OptionalChain::Continuation) => get_static_value_r(ctx, target)?,
        _ => (value_of(ctx, target)?, false),
    };
    if matches!(object, StaticValue::Undefined | StaticValue::Null) {
        // Reading a property of `null` throws where no `?.` stands before it.
        return (object_optional || chain == Some(OptionalChain::Start)).then_some((StaticValue::Undefined, true));
    }
    let property = property(ctx)?;
    let is = |name: &str| property.iter().copied().eq(name.encode_utf16());
    let value = match &object {
        StaticValue::String(units) => {
            if is("length") {
                StaticValue::Number(units.len() as f64)
            } else {
                match array_index(&property)? {
                    index if index < units.len() => StaticValue::String(vec![*units.get(index)?]),
                    _ => StaticValue::Undefined,
                }
            }
        }
        StaticValue::RegExp { pattern, flags } => {
            let has = |flag: u8| StaticValue::Boolean(flags.contains(&flag));
            if is("source") {
                StaticValue::String(core::str::from_utf8(pattern).ok()?.encode_utf16().collect())
            } else if is("flags") {
                StaticValue::String(sorted(flags).iter().map(|&flag| u16::from(flag)).collect())
            } else if is("global") {
                has(b'g')
            } else if is("ignoreCase") {
                has(b'i')
            } else if is("multiline") {
                has(b'm')
            } else if is("dotAll") {
                has(b's')
            } else if is("unicode") {
                has(b'u')
            } else if is("sticky") {
                has(b'y')
            } else if is("hasIndices") {
                has(b'd')
            } else if is("lastIndex") {
                StaticValue::Number(0.0)
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some((value, false))
}

/// The properties of `Math` and of `Number` that are numbers.
fn builtin_number(object: &[u8], name: &[u8]) -> Option<f64> {
    use core::f64::consts;
    Some(match (object, name) {
        (b"Math", b"E") => consts::E,
        (b"Math", b"LN10") => consts::LN_10,
        (b"Math", b"LN2") => consts::LN_2,
        (b"Math", b"LOG10E") => consts::LOG10_E,
        (b"Math", b"LOG2E") => consts::LOG2_E,
        (b"Math", b"PI") => consts::PI,
        (b"Math", b"SQRT1_2") => consts::FRAC_1_SQRT_2,
        (b"Math", b"SQRT2") => consts::SQRT_2,
        (b"Number", b"EPSILON") => f64::EPSILON,
        (b"Number", b"MAX_SAFE_INTEGER") => 9_007_199_254_740_991.0,
        (b"Number", b"MAX_VALUE") => f64::MAX,
        (b"Number", b"MIN_SAFE_INTEGER") => -9_007_199_254_740_991.0,
        (b"Number", b"MIN_VALUE") => 5e-324,
        (b"Number", b"NaN") => f64::NAN,
        (b"Number", b"NEGATIVE_INFINITY") => f64::NEG_INFINITY,
        (b"Number", b"POSITIVE_INFINITY") => f64::INFINITY,
        _ => return None,
    })
}

/// The index that `key` names as a property of a string: the digits of an integer below 2^32 - 1, written as `ToString` writes it.
fn array_index(key: &[u16]) -> Option<usize> {
    if key.is_empty() || key.len() > 10 || (key.len() > 1 && key.first() == Some(&u16::from(b'0'))) {
        return None;
    }
    let mut index: u64 = 0;
    for &unit in key {
        let digit = char::from_u32(u32::from(unit))?.to_digit(10)?;
        index = index * 10 + u64::from(digit);
    }
    (index < u64::from(u32::MAX)).then_some(index as usize)
}

fn sorted(flags: &[u8]) -> Vec<u8> {
    let mut flags = flags.to_vec();
    flags.sort_unstable();
    flags
}

/// `TemplateLiteral`, and `TaggedTemplateExpression` where the tag is `String.raw` of the global `String`.
fn template_value(ctx: &Ctx<'_, '_>, template: &E::Template) -> Option<StaticValue> {
    let mut out: Vec<u16>;
    match &template.tag {
        None => {
            let E::TemplateContents::Cooked(head) = &template.head else {
                return None;
            };
            out = units_of(head)?;
            // `getElementValues`: every substitution has a value before any is joined.
            let mut values = Vec::with_capacity(template.parts().len());
            for part in template.parts() {
                values.push(value_of(ctx, &part.value)?);
            }
            for (part, value) in template.parts().iter().zip(&values) {
                let E::TemplateContents::Cooked(tail) = &part.tail else {
                    return None;
                };
                out.extend(to_string(value));
                out.extend(units_of(tail)?);
            }
        }
        Some(tag) => {
            if !is_string_raw(ctx, tag) {
                return None;
            }
            let E::TemplateContents::Raw(head) = &template.head else {
                return None;
            };
            out = raw_units(head.slice())?;
            let mut values = Vec::with_capacity(template.parts().len());
            for part in template.parts() {
                values.push(value_of(ctx, &part.value)?);
            }
            for (part, value) in template.parts().iter().zip(&values) {
                let E::TemplateContents::Raw(tail) = &part.tail else {
                    return None;
                };
                out.extend(to_string(value));
                out.extend(raw_units(tail.slice())?);
            }
        }
    }
    Some(StaticValue::String(out))
}

/// `String.raw` and `String["raw"]`, where `String` is the global.
fn is_string_raw(ctx: &Ctx<'_, '_>, tag: &Expr) -> bool {
    let target = match &tag.data {
        ExprData::EDot(dot) if dot.optional_chain.is_none() && dot.name.slice() == b"raw" => &dot.target,
        ExprData::EIndex(index) if index.optional_chain.is_none() => {
            match value_of(ctx, &index.index) {
                Some(StaticValue::String(key)) if key.iter().copied().eq("raw".encode_utf16()) => &index.target,
                _ => return false,
            }
        }
        _ => return false,
    };
    matches!(&target.data, ExprData::EIdentifier(identifier) if ctx.parsed.name_of(identifier.ref_) == b"String" && ctx.is_global(b"String"))
}

/// The raw text of a template piece: a line break in it is one line feed.
fn raw_units(raw: &[u8]) -> Option<Vec<u16>> {
    let text = core::str::from_utf8(raw).ok()?;
    let mut out = Vec::with_capacity(text.len());
    let mut units = text.encode_utf16().peekable();
    while let Some(unit) = units.next() {
        if unit == 0x0d {
            units.next_if_eq(&0x0a);
            out.push(0x0a);
        } else {
            out.push(unit);
        }
    }
    Some(out)
}

/// The code units of a string of the tree.
fn units_of(string: &E::EString) -> Option<Vec<u16>> {
    if string.next.is_some() {
        return None;
    }
    if string.is_utf8() {
        return Some(core::str::from_utf8(string.slice8()).ok()?.encode_utf16().collect());
    }
    Some(string.slice16().to_vec())
}

/// `UnaryExpression`.
fn unary_value(ctx: &Ctx<'_, '_>, unary: &E::Unary) -> Option<StaticValue> {
    match unary.op {
        // `delete` is not supported; `++` and `--` are an `UpdateExpression`.
        OpCode::UnVoid => return Some(StaticValue::Undefined),
        OpCode::UnNeg | OpCode::UnPos | OpCode::UnNot | OpCode::UnCpl | OpCode::UnTypeof => {}
        _ => return None,
    }
    let arg = value_of(ctx, &unary.value)?;
    Some(match unary.op {
        OpCode::UnNeg => match to_numeric(&arg) {
            Numeric::Number(number) => StaticValue::Number(-number),
            Numeric::BigInt(big) => StaticValue::BigInt(big.checked_neg()?),
        },
        // `+1n` throws.
        OpCode::UnPos => StaticValue::Number(to_number(&arg)?),
        OpCode::UnNot => StaticValue::Boolean(!to_boolean(&arg)),
        OpCode::UnCpl => match to_numeric(&arg) {
            Numeric::Number(number) => StaticValue::Number(f64::from(!to_int32(number))),
            Numeric::BigInt(big) => StaticValue::BigInt(!big),
        },
        OpCode::UnTypeof => StaticValue::String(
            match arg {
                StaticValue::Undefined => "undefined",
                StaticValue::Null | StaticValue::RegExp { .. } => "object",
                StaticValue::Boolean(_) => "boolean",
                StaticValue::Number(_) => "number",
                StaticValue::BigInt(_) => "bigint",
                StaticValue::String(_) => "string",
            }
            .encode_utf16()
            .collect(),
        ),
        _ => return None,
    })
}

/// `BinaryExpression`, `LogicalExpression`, `SequenceExpression` and `AssignmentExpression`.
fn binary_value(ctx: &Ctx<'_, '_>, binary: &E::Binary) -> Option<StaticValue> {
    match binary.op {
        OpCode::BinComma | OpCode::BinAssign => return value_of(ctx, &binary.right),
        OpCode::BinLogicalOr | OpCode::BinLogicalAnd | OpCode::BinNullishCoalescing => {
            let left = value_of(ctx, &binary.left)?;
            let keeps_left = match binary.op {
                OpCode::BinLogicalOr => to_boolean(&left),
                OpCode::BinLogicalAnd => !to_boolean(&left),
                _ => !matches!(left, StaticValue::Undefined | StaticValue::Null),
            };
            return if keeps_left { Some(left) } else { value_of(ctx, &binary.right) };
        }
        // Not supported.
        OpCode::BinIn | OpCode::BinInstanceof => return None,
        op if (op as u8) > (OpCode::BinAssign as u8) => return None,
        _ => {}
    }
    let left = value_of(ctx, &binary.left)?;
    let right = value_of(ctx, &binary.right)?;
    let boolean = |value: bool| Some(StaticValue::Boolean(value));
    match binary.op {
        OpCode::BinLooseEq => boolean(loose_equals(&left, &right)?),
        OpCode::BinLooseNe => boolean(!loose_equals(&left, &right)?),
        OpCode::BinStrictEq => boolean(strict_equals(&left, &right)),
        OpCode::BinStrictNe => boolean(!strict_equals(&left, &right)),
        // An undefined answer of the comparison is `false` for each of the four.
        OpCode::BinLt => boolean(less_than(&left, &right)? == Some(true)),
        OpCode::BinGt => boolean(less_than(&right, &left)? == Some(true)),
        OpCode::BinLe => boolean(less_than(&right, &left)? == Some(false)),
        OpCode::BinGe => boolean(less_than(&left, &right)? == Some(false)),
        OpCode::BinAdd => {
            let (left, right) = (to_primitive(left), to_primitive(right));
            if matches!(left, StaticValue::String(_)) || matches!(right, StaticValue::String(_)) {
                let mut out = to_string(&left);
                out.extend(to_string(&right));
                return Some(StaticValue::String(out));
            }
            arithmetic(binary.op, &left, &right)
        }
        _ => arithmetic(binary.op, &left, &right),
    }
}

/// The operators that take two numbers or two BigInts: one of each throws.
fn arithmetic(op: OpCode, left: &StaticValue, right: &StaticValue) -> Option<StaticValue> {
    match (to_numeric(left), to_numeric(right)) {
        (Numeric::Number(l), Numeric::Number(r)) => Some(StaticValue::Number(match op {
            OpCode::BinAdd => l + r,
            OpCode::BinSub => l - r,
            OpCode::BinMul => l * r,
            OpCode::BinDiv => l / r,
            OpCode::BinRem => l % r,
            OpCode::BinPow => pow(l, r),
            OpCode::BinShl => f64::from(to_int32(l).wrapping_shl(to_uint32(r) & 31)),
            OpCode::BinShr => f64::from(to_int32(l).wrapping_shr(to_uint32(r) & 31)),
            OpCode::BinUShr => f64::from(to_uint32(l).wrapping_shr(to_uint32(r) & 31)),
            OpCode::BinBitwiseOr => f64::from(to_int32(l) | to_int32(r)),
            OpCode::BinBitwiseXor => f64::from(to_int32(l) ^ to_int32(r)),
            OpCode::BinBitwiseAnd => f64::from(to_int32(l) & to_int32(r)),
            _ => return None,
        })),
        (Numeric::BigInt(l), Numeric::BigInt(r)) => Some(StaticValue::BigInt(match op {
            OpCode::BinAdd => l.checked_add(r)?,
            OpCode::BinSub => l.checked_sub(r)?,
            OpCode::BinMul => l.checked_mul(r)?,
            // A division by zero throws.
            OpCode::BinDiv => l.checked_div(r)?,
            OpCode::BinRem => l.checked_rem(r)?,
            // A negative exponent throws.
            OpCode::BinPow => match (l, r) {
                (_, 0) | (1, _) => 1,
                (_, r) if r < 0 => return None,
                (0, _) => 0,
                (-1, r) => {
                    if r % 2 == 0 {
                        1
                    } else {
                        -1
                    }
                }
                (l, r) => l.checked_pow(u32::try_from(r).ok()?)?,
            },
            OpCode::BinShl => shift_left(l, r)?,
            OpCode::BinShr => shift_left(l, r.checked_neg()?)?,
            OpCode::BinBitwiseOr => l | r,
            OpCode::BinBitwiseXor => l ^ r,
            OpCode::BinBitwiseAnd => l & r,
            // `>>>` of a BigInt throws.
            _ => return None,
        })),
        _ => None,
    }
}

/// `l << r` of two BigInts: to the right, rounding down, where `r` is negative.
fn shift_left(l: i128, r: i128) -> Option<i128> {
    if r >= 0 {
        if l == 0 {
            return Some(0);
        }
        let by = u32::try_from(r).ok().filter(|&by| by < 127)?;
        return l.checked_mul(1i128 << by);
    }
    match u32::try_from(r.checked_neg()?) {
        Ok(by) if by < 128 => Some(l >> by),
        _ => Some(if l < 0 { -1 } else { 0 }),
    }
}

/// `Number::exponentiate`: `powf` answers 1 where the exponent is NaN or the base is 1 or -1 and the exponent is infinite.
fn pow(base: f64, exponent: f64) -> f64 {
    if exponent.is_nan() || (base.abs() == 1.0 && exponent.is_infinite()) {
        return f64::NAN;
    }
    base.powf(exponent)
}

/// `ToPrimitive`: a regular expression is its text.
fn to_primitive(value: StaticValue) -> StaticValue {
    match value {
        StaticValue::RegExp { .. } => StaticValue::String(to_string(&value)),
        value => value,
    }
}

/// `ToBoolean`.
pub fn to_boolean(value: &StaticValue) -> bool {
    match value {
        StaticValue::Undefined | StaticValue::Null => false,
        StaticValue::Boolean(boolean) => *boolean,
        StaticValue::Number(number) => *number != 0.0 && !number.is_nan(),
        StaticValue::BigInt(big) => *big != 0,
        StaticValue::String(units) => !units.is_empty(),
        StaticValue::RegExp { .. } => true,
    }
}

/// `ToNumeric`.
fn to_numeric(value: &StaticValue) -> Numeric {
    match value {
        StaticValue::BigInt(big) => Numeric::BigInt(*big),
        StaticValue::Undefined => Numeric::Number(f64::NAN),
        StaticValue::Null => Numeric::Number(0.0),
        StaticValue::Boolean(boolean) => Numeric::Number(f64::from(u8::from(*boolean))),
        StaticValue::Number(number) => Numeric::Number(*number),
        StaticValue::String(units) => Numeric::Number(string_to_number(units)),
        // Its text starts with `/`, which is no number.
        StaticValue::RegExp { .. } => Numeric::Number(f64::NAN),
    }
}

/// `ToNumber`: it throws for a BigInt.
fn to_number(value: &StaticValue) -> Option<f64> {
    match to_numeric(value) {
        Numeric::Number(number) => Some(number),
        Numeric::BigInt(_) => None,
    }
}

/// `ToString`.
pub fn to_string(value: &StaticValue) -> Vec<u16> {
    let ascii = |text: &[u8]| text.iter().map(|&byte| u16::from(byte)).collect::<Vec<u16>>();
    match value {
        StaticValue::Undefined => ascii(b"undefined"),
        StaticValue::Null => ascii(b"null"),
        StaticValue::Boolean(true) => ascii(b"true"),
        StaticValue::Boolean(false) => ascii(b"false"),
        StaticValue::Number(number) => {
            let mut buffer = [0u8; 124];
            ascii(bun_core::fmt::FormatDouble::dtoa(&mut buffer, *number))
        }
        StaticValue::BigInt(big) => ascii(bun_core::fmt::ItoaBuf::new().format(*big).as_bytes()),
        StaticValue::String(units) => units.clone(),
        // `RegExp.prototype.toString`: the flags in the order of `RegExp.prototype.flags`.
        StaticValue::RegExp { pattern, flags } => {
            let mut out = vec![u16::from(b'/')];
            out.extend(String::from_utf8_lossy(pattern).encode_utf16());
            out.push(u16::from(b'/'));
            out.extend(sorted(flags).iter().map(|&flag| u16::from(flag)));
            out
        }
    }
}

/// `ToInt32`.
fn to_int32(number: f64) -> i32 {
    to_uint32(number) as i32
}

/// `ToUint32`.
fn to_uint32(number: f64) -> u32 {
    if !number.is_finite() {
        return 0;
    }
    let modulo = number.trunc() % 4_294_967_296.0;
    (if modulo < 0.0 { modulo + 4_294_967_296.0 } else { modulo }) as u32
}

/// `IsStrictlyEqual`. Two regular expressions are two objects.
fn strict_equals(left: &StaticValue, right: &StaticValue) -> bool {
    match (left, right) {
        (StaticValue::Undefined, StaticValue::Undefined) | (StaticValue::Null, StaticValue::Null) => true,
        (StaticValue::Boolean(l), StaticValue::Boolean(r)) => l == r,
        (StaticValue::Number(l), StaticValue::Number(r)) => l == r,
        (StaticValue::BigInt(l), StaticValue::BigInt(r)) => l == r,
        (StaticValue::String(l), StaticValue::String(r)) => l == r,
        _ => false,
    }
}

/// `IsLooselyEqual`. `None`: a BigInt in a string is too long to compare.
fn loose_equals(left: &StaticValue, right: &StaticValue) -> Option<bool> {
    use StaticValue::{BigInt, Boolean, Null, Number, RegExp, String, Undefined};
    Some(match (left, right) {
        (Undefined | Null, Undefined | Null) => true,
        (Undefined | Null, _) | (_, Undefined | Null) => false,
        (RegExp { .. }, RegExp { .. }) => false,
        (Boolean(_), Boolean(_)) | (Number(_), Number(_)) | (BigInt(_), BigInt(_)) | (String(_), String(_)) => strict_equals(left, right),
        (Boolean(boolean), other) | (other, Boolean(boolean)) => {
            return loose_equals(&Number(f64::from(u8::from(*boolean))), other);
        }
        (RegExp { .. }, other) | (other, RegExp { .. }) => {
            let text = if matches!(left, RegExp { .. }) { to_string(left) } else { to_string(right) };
            return loose_equals(&String(text), other);
        }
        (Number(number), String(units)) | (String(units), Number(number)) => *number == string_to_number(units),
        (BigInt(big), String(units)) | (String(units), BigInt(big)) => match string_to_big_int(units) {
            Parsed::Value(value) => *big == value,
            Parsed::NotANumber => false,
            Parsed::TooLong => return None,
        },
        (BigInt(big), Number(number)) | (Number(number), BigInt(big)) => compare_big_int_number(*big, *number) == Some(Ordering::Equal),
    })
}

/// `IsLessThan(left, right)`. `Some(None)`: undefined, one of the two is NaN. `None`: a BigInt in a string is too long to compare.
fn less_than(left: &StaticValue, right: &StaticValue) -> Option<Option<bool>> {
    let (left, right) = (to_primitive(left.clone()), to_primitive(right.clone()));
    let ordering = match (&left, &right) {
        (StaticValue::String(l), StaticValue::String(r)) => Some(l.cmp(r)),
        (StaticValue::BigInt(big), StaticValue::String(units)) => match string_to_big_int(units) {
            Parsed::Value(value) => Some(big.cmp(&value)),
            Parsed::NotANumber => None,
            Parsed::TooLong => return None,
        },
        (StaticValue::String(units), StaticValue::BigInt(big)) => match string_to_big_int(units) {
            Parsed::Value(value) => Some(value.cmp(big)),
            Parsed::NotANumber => None,
            Parsed::TooLong => return None,
        },
        _ => match (to_numeric(&left), to_numeric(&right)) {
            (Numeric::Number(l), Numeric::Number(r)) => l.partial_cmp(&r),
            (Numeric::BigInt(l), Numeric::BigInt(r)) => Some(l.cmp(&r)),
            (Numeric::BigInt(l), Numeric::Number(r)) => compare_big_int_number(l, r),
            (Numeric::Number(l), Numeric::BigInt(r)) => compare_big_int_number(r, l).map(Ordering::reverse),
        },
    };
    Some(ordering.map(|ordering| ordering == Ordering::Less))
}

/// A BigInt against a number, as mathematical values. `None` for NaN.
fn compare_big_int_number(big: i128, number: f64) -> Option<Ordering> {
    if number.is_nan() {
        return None;
    }
    let floor = number.floor();
    // 2^127 as a double.
    const LIMIT: f64 = 170_141_183_460_469_231_731_687_303_715_884_105_728.0;
    if floor >= LIMIT {
        return Some(Ordering::Less);
    }
    if floor < -LIMIT {
        return Some(Ordering::Greater);
    }
    Some(match big.cmp(&(floor as i128)) {
        Ordering::Equal if number > floor => Ordering::Less,
        ordering => ordering,
    })
}

/// The digits of a BigInt literal of the tree, which has no `n` and no `_`. `None`: beyond 127 bits.
fn parse_big_int_literal(digits: &[u8]) -> Option<i128> {
    let (radix, digits) = match digits {
        [b'0', b'x' | b'X', rest @ ..] => (16, rest),
        [b'0', b'o' | b'O', rest @ ..] => (8, rest),
        [b'0', b'b' | b'B', rest @ ..] => (2, rest),
        _ => (10, digits),
    };
    parse_digits(digits, radix)
}

fn parse_digits(digits: &[u8], radix: u32) -> Option<i128> {
    let mut value: i128 = 0;
    for &digit in digits {
        let digit = char::from(digit).to_digit(radix)?;
        value = value.checked_mul(i128::from(radix))?.checked_add(i128::from(digit))?;
    }
    Some(value)
}

enum Parsed {
    Value(i128),
    NotANumber,
    TooLong,
}

/// `StrWhiteSpaceChar`: the white space and the line terminators of the language.
fn is_str_white_space(unit: u16) -> bool {
    matches!(unit, 0x09..=0x0d | 0x20 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}

/// The text between the white space around it, when it is ASCII.
fn trimmed_ascii(units: &[u16]) -> Option<Vec<u8>> {
    let start = units.iter().position(|&unit| !is_str_white_space(unit)).unwrap_or(units.len());
    let end = units.iter().rposition(|&unit| !is_str_white_space(unit)).map_or(start, |last| last + 1);
    units.get(start..end)?.iter().map(|&unit| u8::try_from(unit).ok().filter(u8::is_ascii)).collect()
}

/// `StringToBigInt`.
fn string_to_big_int(units: &[u16]) -> Parsed {
    let Some(text) = trimmed_ascii(units) else {
        return Parsed::NotANumber;
    };
    let (negative, radix, digits): (bool, u32, &[u8]) = match text.as_slice() {
        [] => return Parsed::Value(0),
        [b'0', b'x' | b'X', rest @ ..] => (false, 16, rest),
        [b'0', b'o' | b'O', rest @ ..] => (false, 8, rest),
        [b'0', b'b' | b'B', rest @ ..] => (false, 2, rest),
        [b'-', rest @ ..] => (true, 10, rest),
        [b'+', rest @ ..] => (false, 10, rest),
        rest => (false, 10, rest),
    };
    if digits.is_empty() || !digits.iter().all(|&digit| char::from(digit).is_digit(radix)) {
        return Parsed::NotANumber;
    }
    match parse_digits(digits, radix) {
        Some(value) => Parsed::Value(if negative { -value } else { value }),
        None => Parsed::TooLong,
    }
}

/// `StringToNumber`.
fn string_to_number(units: &[u16]) -> f64 {
    let Some(text) = trimmed_ascii(units) else {
        return f64::NAN;
    };
    let (radix, digits): (u32, &[u8]) = match text.as_slice() {
        [] => return 0.0,
        b"Infinity" | b"+Infinity" => return f64::INFINITY,
        b"-Infinity" => return f64::NEG_INFINITY,
        [b'0', b'x' | b'X', rest @ ..] => (16, rest),
        [b'0', b'o' | b'O', rest @ ..] => (8, rest),
        [b'0', b'b' | b'B', rest @ ..] => (2, rest),
        _ => return decimal_to_number(&text),
    };
    if digits.is_empty() || !digits.iter().all(|&digit| char::from(digit).is_digit(radix)) {
        return f64::NAN;
    }
    radix_to_number(digits, radix)
}

/// The value of the digits of a power-of-two radix, rounded once to the nearest double, ties to even.
fn radix_to_number(digits: &[u8], radix: u32) -> f64 {
    let bits_per_digit = radix.trailing_zeros();
    // The first 53 bits, then how many bits follow them, the first of those, and whether a later one is set.
    let mut mantissa: u64 = 0;
    let mut dropped: i32 = 0;
    let mut round = false;
    let mut sticky = false;
    for &digit in digits {
        let digit = char::from(digit).to_digit(radix).unwrap_or(0);
        for at in (0..bits_per_digit).rev() {
            let bit = (digit >> at) & 1 == 1;
            if mantissa >> 52 == 0 {
                mantissa = (mantissa << 1) | u64::from(bit);
            } else {
                if dropped == 0 {
                    round = bit;
                } else {
                    sticky |= bit;
                }
                dropped = dropped.saturating_add(1);
            }
        }
    }
    if round && (sticky || mantissa & 1 == 1) {
        mantissa += 1;
    }
    (mantissa as f64) * 2f64.powi(dropped)
}

/// `StrDecimalLiteral` with a sign, else NaN.
fn decimal_to_number(text: &[u8]) -> f64 {
    let mut rest = text;
    if let [b'+' | b'-', tail @ ..] = rest {
        rest = tail;
    }
    let digits = |rest: &mut &[u8]| {
        let count = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
        *rest = rest.get(count..).unwrap_or(&[]);
        count
    };
    let whole = digits(&mut rest);
    let mut fraction = 0;
    if let [b'.', tail @ ..] = rest {
        rest = tail;
        fraction = digits(&mut rest);
    }
    if whole + fraction == 0 {
        return f64::NAN;
    }
    if let [b'e' | b'E', tail @ ..] = rest {
        rest = tail;
        if let [b'+' | b'-', tail @ ..] = rest {
            rest = tail;
        }
        if digits(&mut rest) == 0 {
            return f64::NAN;
        }
    }
    if !rest.is_empty() {
        return f64::NAN;
    }
    core::str::from_utf8(text).ok().and_then(|text| text.parse::<f64>().ok()).unwrap_or(f64::NAN)
}
