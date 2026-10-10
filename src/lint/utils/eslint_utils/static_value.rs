//! The values that [`get_static_value`](super::get_static_value) computes, and the conversions and
//! comparisons that ECMAScript defines on them.

use super::builtins::Builtin;
use crate::utils::text::number_to_string;
use bun_core::strings;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Why an expression has no static value.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Stop {
    /// Upstream's `null`: the value of this expression is not known.
    NotStatic,
    /// Evaluating it throws, which upstream catches around the whole evaluation, or the value
    /// cannot be computed or represented here.
    Abort,
}

pub(super) type Eval<T> = Result<T, Stop>;

/// No string or array that is computed is longer.
pub(super) const MAX_LEN: usize = 1 << 20;

/// A symbol whose identity is known.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum StaticSymbol<'a> {
    /// `Symbol.iterator` is `WellKnown("iterator")`.
    WellKnown(&'static str),
    /// `Symbol.for(key)`
    Registered(Cow<'a, [u8]>),
}

impl StaticSymbol<'_> {
    /// `symbol.description`
    pub fn description(&self) -> Cow<'_, [u8]> {
        match self {
            StaticSymbol::WellKnown(name) => Cow::Owned([b"Symbol.", name.as_bytes()].concat()),
            StaticSymbol::Registered(key) => Cow::Borrowed(key),
        }
    }
}

/// The name of a property.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PropertyKey<'a> {
    String(Cow<'a, [u8]>),
    Symbol(StaticSymbol<'a>),
}

impl PropertyKey<'_> {
    #[inline]
    pub fn as_str(&self) -> Option<&[u8]> {
        match self {
            PropertyKey::String(name) => Some(name),
            PropertyKey::Symbol(_) => None,
        }
    }

    /// The index, if it is the name of an element of an array: `"0"`, `"1"`, ..
    pub(super) fn as_index(&self) -> Option<usize> {
        let digits = self.as_str()?;
        let is_canonical = matches!(digits, [b'0'] | [b'1'..=b'9', ..]) && digits.len() <= 10;
        if !is_canonical || !digits.iter().all(u8::is_ascii_digit) {
            return None;
        }
        let index = digits
            .iter()
            .fold(0u64, |index, digit| index * 10 + u64::from(digit - b'0'));
        (index < u64::from(u32::MAX)).then_some(index as usize)
    }
}

/// What made an iterator.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum IteratorKind {
    Array,
    Map,
    Set,
}

/// eslint-utils' `StaticValue["value"]`: the value of an expression that is known without running
/// the program.
///
/// `==` compares the structure, and is not JavaScript's `===`: two arrays with equal elements are
/// equal, `NaN` is not equal to itself.
#[derive(Clone, PartialEq, Debug)]
pub enum StaticValue<'a> {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    /// UTF-8. Half a surrogate pair is the three bytes that its code point would have.
    String(Cow<'a, [u8]>),
    /// One that does not fit has no static value.
    BigInt(i128),
    Symbol(StaticSymbol<'a>),
    /// `value instanceof RegExp`. `pattern` is `value.source`, `flags` is `value.flags`, in the
    /// order of that property: `dgimsuvy`.
    Regex {
        pattern: Cow<'a, [u8]>,
        flags: Cow<'a, [u8]>,
    },
    Array(Vec<StaticValue<'a>>),
    /// What is missing from a sparse array: the first element of `[, 1]`. It is only ever an
    /// element of an `Array`, and reads as `undefined`.
    Hole,
    /// A plain object: its own properties, in the order of `Reflect.ownKeys`.
    Object(Vec<(PropertyKey<'a>, StaticValue<'a>)>),
    Map(Vec<(StaticValue<'a>, StaticValue<'a>)>),
    Set(Vec<StaticValue<'a>>),
    /// `array.values()`, `map.entries()`, ..: what it yields.
    Iterator(IteratorKind, Vec<StaticValue<'a>>),
    /// An object around a primitive value: `new String("a")`, `new Number(1)`, `Object(1n)`.
    Wrapper(Box<StaticValue<'a>>),
    /// A function or an object of the standard library: `Math`, `Math.max`, `String`,
    /// `"".trim`.
    Builtin(Builtin),
}

impl<'a> StaticValue<'a> {
    #[inline]
    pub fn string(text: impl Into<Cow<'a, [u8]>>) -> Self {
        StaticValue::String(text.into())
    }

    /// The text, if `typeof value === "string"`.
    #[inline]
    pub fn as_str(&self) -> Option<&[u8]> {
        match self {
            StaticValue::String(text) => Some(text),
            _ => None,
        }
    }

    /// The number, if `typeof value === "number"`.
    #[inline]
    pub fn as_number(&self) -> Option<f64> {
        match *self {
            StaticValue::Number(n) => Some(n),
            _ => None,
        }
    }

    /// `(value.source, value.flags)`, if `value instanceof RegExp`.
    #[inline]
    pub fn as_regex(&self) -> Option<(&[u8], &[u8])> {
        match self {
            StaticValue::Regex { pattern, flags } => Some((pattern, flags)),
            _ => None,
        }
    }

    /// The symbol, if `typeof value === "symbol"`.
    #[inline]
    pub fn as_symbol(&self) -> Option<&StaticSymbol<'a>> {
        match self {
            StaticValue::Symbol(symbol) => Some(symbol),
            _ => None,
        }
    }

    /// `value == null`
    #[inline]
    pub fn is_nullish(&self) -> bool {
        matches!(
            self,
            StaticValue::Undefined | StaticValue::Null | StaticValue::Hole
        )
    }

    /// `Boolean(value)`
    pub fn is_truthy(&self) -> bool {
        match self {
            StaticValue::Undefined | StaticValue::Null | StaticValue::Hole => false,
            StaticValue::Bool(b) => *b,
            StaticValue::Number(n) => *n != 0.0 && !n.is_nan(),
            StaticValue::String(text) => !text.is_empty(),
            StaticValue::BigInt(n) => *n != 0,
            _ => true,
        }
    }

    /// `typeof value`
    pub fn type_of(&self) -> &'static str {
        match self {
            StaticValue::Undefined | StaticValue::Hole => "undefined",
            StaticValue::Bool(_) => "boolean",
            StaticValue::Number(_) => "number",
            StaticValue::String(_) => "string",
            StaticValue::BigInt(_) => "bigint",
            StaticValue::Symbol(_) => "symbol",
            StaticValue::Builtin(builtin) if builtin.is_callable() => "function",
            _ => "object",
        }
    }

    /// Whether it is an object or a function, as opposed to a primitive value.
    pub fn is_object(&self) -> bool {
        matches!(
            self,
            StaticValue::Regex { .. }
                | StaticValue::Array(_)
                | StaticValue::Object(_)
                | StaticValue::Map(_)
                | StaticValue::Set(_)
                | StaticValue::Iterator(..)
                | StaticValue::Wrapper(_)
                | StaticValue::Builtin(_)
        )
    }

    /// `String(value)`. `None` if that throws.
    pub fn to_js_string(&self) -> Option<Cow<'a, [u8]>> {
        match self {
            StaticValue::Symbol(symbol) => Some(Cow::Owned(
                [b"Symbol(", &*symbol.description(), b")"].concat(),
            )),
            _ => self.to_string().ok(),
        }
    }

    /// `Number(value)`. `None` if that throws.
    pub fn to_js_number(&self) -> Option<f64> {
        match self.to_primitive().ok()? {
            StaticValue::BigInt(n) => Some(n as f64),
            primitive => primitive.to_number().ok(),
        }
    }

    /// `a === b`. `None` if that cannot be told: two objects that are written the same.
    #[inline]
    pub fn js_strict_equals(&self, other: &StaticValue<'a>) -> Option<bool> {
        self.strict_equals(other).ok()
    }

    /// `a == b`. `None` if a conversion throws, or if it cannot be told.
    #[inline]
    pub fn js_loose_equals(&self, other: &StaticValue<'a>) -> Option<bool> {
        self.loose_equals(other).ok()
    }

    /// How `a` compares with `b` for `<`, `<=`, `>` and `>=`. `Some(None)` if one is `NaN`, so that
    /// all four are false. `None` if a conversion throws.
    #[inline]
    pub fn js_compare(&self, other: &StaticValue<'a>) -> Option<Option<Ordering>> {
        self.compare(other).ok()
    }

    /// `ToPrimitive`. The objects here have no `valueOf` that returns a primitive value, so the
    /// hint makes no difference.
    pub(super) fn to_primitive(&self) -> Eval<StaticValue<'a>> {
        let text: &[u8] = match self {
            StaticValue::Hole => return Ok(StaticValue::Undefined),
            StaticValue::Wrapper(primitive) => return Ok((**primitive).clone()),
            StaticValue::Array(items) => return Ok(StaticValue::string(join(items, b",")?)),
            StaticValue::Regex { pattern, flags } => {
                return Ok(StaticValue::string(
                    [b"/", &**pattern, b"/", &**flags].concat(),
                ));
            }
            StaticValue::Object(properties) => {
                let changes_conversion = |key: &PropertyKey| match key {
                    PropertyKey::String(name) => matches!(&**name, b"toString" | b"valueOf"),
                    PropertyKey::Symbol(symbol) => {
                        matches!(
                            symbol,
                            StaticSymbol::WellKnown("toPrimitive" | "toStringTag")
                        )
                    }
                };
                if properties.iter().any(|(key, _)| changes_conversion(key)) {
                    return Err(Stop::Abort);
                }
                b"[object Object]"
            }
            StaticValue::Map(_) => b"[object Map]",
            StaticValue::Set(_) => b"[object Set]",
            StaticValue::Iterator(IteratorKind::Array, _) => b"[object Array Iterator]",
            StaticValue::Iterator(IteratorKind::Map, _) => b"[object Map Iterator]",
            StaticValue::Iterator(IteratorKind::Set, _) => b"[object Set Iterator]",
            // As V8 prints it.
            StaticValue::Builtin(builtin) if builtin.is_callable() => {
                let name = builtin.name().as_bytes();
                let name =
                    strings::last_index_of_char(name, b'.').map_or(name, |dot| &name[dot + 1..]);
                return Ok(StaticValue::string(
                    [b"function ", name, b"() { [native code] }"].concat(),
                ));
            }
            StaticValue::Builtin(builtin) if builtin.is_prototype() => return Err(Stop::Abort),
            StaticValue::Builtin(builtin) => {
                return Ok(StaticValue::string(
                    [b"[object ", builtin.name().as_bytes(), b"]"].concat(),
                ));
            }
            primitive => return Ok(primitive.clone()),
        };
        Ok(StaticValue::string(text))
    }

    /// `ToString`, which throws for a symbol.
    pub(super) fn to_string(&self) -> Eval<Cow<'a, [u8]>> {
        let text: &[u8] = match self {
            StaticValue::Undefined | StaticValue::Hole => b"undefined",
            StaticValue::Null => b"null",
            StaticValue::Bool(true) => b"true",
            StaticValue::Bool(false) => b"false",
            StaticValue::Number(n) => return Ok(Cow::Owned(number_to_string(*n))),
            StaticValue::String(text) => return Ok(text.clone()),
            StaticValue::BigInt(n) => return Ok(Cow::Owned(n.to_string().into_bytes())),
            StaticValue::Symbol(_) => return Err(Stop::Abort),
            object => return object.to_primitive()?.to_string(),
        };
        Ok(Cow::Borrowed(text))
    }

    /// `ToNumber`, which throws for a symbol and for a `bigint`.
    pub(super) fn to_number(&self) -> Eval<f64> {
        match self {
            StaticValue::Undefined | StaticValue::Hole => Ok(f64::NAN),
            StaticValue::Null => Ok(0.0),
            StaticValue::Bool(b) => Ok(f64::from(u8::from(*b))),
            StaticValue::Number(n) => Ok(*n),
            StaticValue::String(text) => Ok(bun_core::fmt::js_string_to_number(text)),
            StaticValue::BigInt(_) | StaticValue::Symbol(_) => Err(Stop::Abort),
            object => object.to_primitive()?.to_number(),
        }
    }

    /// `ToIntegerOrInfinity`
    pub(super) fn to_integer(&self) -> Eval<f64> {
        let n = self.to_number()?;
        Ok(if n.is_nan() { 0.0 } else { n.trunc() + 0.0 })
    }

    /// `ToPropertyKey`
    pub(super) fn to_property_key(&self) -> Eval<PropertyKey<'a>> {
        match self.to_primitive()? {
            StaticValue::Symbol(symbol) => Ok(PropertyKey::Symbol(symbol)),
            primitive => Ok(PropertyKey::String(primitive.to_string()?)),
        }
    }

    /// `a === b`
    pub(super) fn strict_equals(&self, other: &StaticValue<'a>) -> Eval<bool> {
        use StaticValue::*;
        Ok(match (self, other) {
            (Undefined | Hole, Undefined | Hole) | (Null, Null) => true,
            (Bool(a), Bool(b)) => a == b,
            (Number(a), Number(b)) => a == b,
            (String(a), String(b)) => a == b,
            (BigInt(a), BigInt(b)) => a == b,
            (Symbol(a), Symbol(b)) => a == b,
            (Builtin(a), Builtin(b)) => a == b,
            // Both may be the value of the same literal, which is one object.
            (Regex { .. }, Regex { .. }) if self == other => return Err(Stop::Abort),
            // Any other object is made anew each time its expression is evaluated.
            _ => false,
        })
    }

    /// `SameValueZero`
    pub(super) fn same_value_zero(&self, other: &StaticValue<'a>) -> Eval<bool> {
        match (self, other) {
            (StaticValue::Number(a), StaticValue::Number(b)) if a.is_nan() && b.is_nan() => {
                Ok(true)
            }
            _ => self.strict_equals(other),
        }
    }

    /// `Object.is(a, b)`
    pub(super) fn same_value(&self, other: &StaticValue<'a>) -> Eval<bool> {
        match (self, other) {
            (StaticValue::Number(a), StaticValue::Number(b)) if *a == 0.0 && *b == 0.0 => {
                Ok(a.is_sign_negative() == b.is_sign_negative())
            }
            _ => self.same_value_zero(other),
        }
    }

    /// `a == b`
    pub(super) fn loose_equals(&self, other: &StaticValue<'a>) -> Eval<bool> {
        use StaticValue::*;
        match (self, other) {
            (a, b) if a.is_nullish() || b.is_nullish() => Ok(a.is_nullish() && b.is_nullish()),
            (Number(a), String(_)) => Ok(*a == other.to_number()?),
            (String(_), Number(b)) => Ok(self.to_number()? == *b),
            (BigInt(a), String(b)) | (String(b), BigInt(a)) => Ok(string_to_bigint(b)? == Some(*a)),
            (Bool(_), _) => Number(self.to_number()?).loose_equals(other),
            (_, Bool(_)) => self.loose_equals(&Number(other.to_number()?)),
            (BigInt(a), Number(b)) | (Number(b), BigInt(a)) => {
                Ok(compare_bigint_with_number(*a, *b) == Some(Ordering::Equal))
            }
            (a, b) if a.is_object() && !b.is_object() => a.to_primitive()?.loose_equals(b),
            (a, b) if !a.is_object() && b.is_object() => a.loose_equals(&b.to_primitive()?),
            _ => self.strict_equals(other),
        }
    }

    /// `IsLessThan`, both ways at once: how `a` compares with `b`. `None` if one is `NaN`, so that
    /// `<`, `<=`, `>` and `>=` are all false.
    pub(super) fn compare(&self, other: &StaticValue<'a>) -> Eval<Option<Ordering>> {
        use StaticValue::*;
        Ok(match (self.to_primitive()?, other.to_primitive()?) {
            (String(a), String(b)) => Some(bun_core::strings::order_utf16(&a, &b)),
            (BigInt(a), String(b)) => string_to_bigint(&b)?.map(|b| a.cmp(&b)),
            (String(a), BigInt(b)) => string_to_bigint(&a)?.map(|a| a.cmp(&b)),
            (BigInt(a), BigInt(b)) => Some(a.cmp(&b)),
            (BigInt(a), b) => compare_bigint_with_number(a, b.to_number()?),
            (a, BigInt(b)) => compare_bigint_with_number(b, a.to_number()?).map(Ordering::reverse),
            (a, b) => a.to_number()?.partial_cmp(&b.to_number()?),
        })
    }
}

/// How the mathematical values of `a` and `b` compare.
fn compare_bigint_with_number(a: i128, b: f64) -> Option<Ordering> {
    if b.is_nan() {
        return None;
    }
    // Every `i128` is between these.
    if b >= 1.8e38 {
        return Some(Ordering::Less);
    }
    if b <= -1.8e38 {
        return Some(Ordering::Greater);
    }
    let floor = b.floor();
    Some(a.cmp(&(floor as i128)).then(if b > floor {
        Ordering::Less
    } else {
        Ordering::Equal
    }))
}

/// The value of the digits of a `bigint` literal, or of what `BigInt(text)` takes, without a sign.
/// `Ok(None)` if they are not digits.
pub(super) fn parse_bigint_digits(text: &[u8]) -> Eval<Option<i128>> {
    let (radix, digits) = match text {
        [b'0', b'x' | b'X', digits @ ..] => (16, digits),
        [b'0', b'o' | b'O', digits @ ..] => (8, digits),
        [b'0', b'b' | b'B', digits @ ..] => (2, digits),
        _ => (10, text),
    };
    if digits.is_empty() {
        return Ok(None);
    }
    let mut value: i128 = 0;
    for &digit in digits {
        let Some(digit) = char::from(digit).to_digit(radix) else {
            return Ok(None);
        };
        value = (value.checked_mul(i128::from(radix)))
            .and_then(|value| value.checked_add(i128::from(digit)))
            .ok_or(Stop::Abort)?;
    }
    Ok(Some(value))
}

/// `StringToBigInt`. `Ok(None)` is its `undefined`.
pub(super) fn string_to_bigint(text: &[u8]) -> Eval<Option<i128>> {
    match strings::trim_js_whitespace(text) {
        [] => Ok(Some(0)),
        [b'-', digits @ ..]
            if digits.first().is_some_and(u8::is_ascii_digit) && !is_prefixed(digits) =>
        {
            Ok(parse_bigint_digits(digits)?.map(|value| -value))
        }
        [b'+', digits @ ..] if !is_prefixed(digits) => parse_bigint_digits(digits),
        digits => parse_bigint_digits(digits),
    }
}

/// `0x..`, `0o..`, `0b..`, which take no sign.
fn is_prefixed(digits: &[u8]) -> bool {
    matches!(digits, [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', ..])
}

/// `items.join(separator)`
pub(super) fn join<'a>(items: &[StaticValue<'a>], separator: &[u8]) -> Eval<Cow<'a, [u8]>> {
    if let [only] = items {
        return if only.is_nullish() {
            Ok(Cow::Borrowed(b""))
        } else {
            only.to_string()
        };
    }
    let mut text = Vec::new();
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            strings::push_wtf8(&mut text, separator);
        }
        if !item.is_nullish() {
            strings::push_wtf8(&mut text, &item.to_string()?);
        }
        if text.len() > MAX_LEN {
            return Err(Stop::Abort);
        }
    }
    Ok(Cow::Owned(text))
}
