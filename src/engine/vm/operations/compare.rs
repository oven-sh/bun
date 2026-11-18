use core::cmp::Ordering;

use crate::{Cx, Gc, JsBigInt, JsCell, JsResult, JsString, Numeric, PreferredType, Value};

#[inline(always)]
fn cells_are_strictly_equal(cx: &Cx, a: Gc<JsCell>, b: Gc<JsCell>) -> JsResult<bool> {
    if a == b {
        return Ok(true);
    }
    if let (Some(a), Some(b)) = (a.downcast::<JsString>(), b.downcast::<JsString>()) {
        return a.equals(cx, &b);
    }
    if let (Some(a), Some(b)) = (a.downcast::<JsBigInt>(), b.downcast::<JsBigInt>()) {
        return Ok(a.value() == b.value());
    }
    Ok(false)
}

impl Value {
    /// IsStrictlyEqual
    #[inline(always)]
    pub fn strict_equals(self, cx: &Cx, other: Value) -> JsResult<bool> {
        if let (Some(a), Some(b)) = (self.as_cell(), other.as_cell()) {
            return cells_are_strictly_equal(cx, a, b);
        }
        if let (Some(a), Some(b)) = (self.as_number(), other.as_number()) {
            return Ok(a == b);
        }
        Ok(self == other)
    }

    #[inline]
    pub fn same_value(self, cx: &Cx, other: Value) -> JsResult<bool> {
        match (self.as_number(), other.as_number()) {
            (Some(a), Some(b)) => Ok(a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())),
            _ => self.strict_equals(cx, other),
        }
    }

    #[inline]
    pub fn same_value_zero(self, cx: &Cx, other: Value) -> JsResult<bool> {
        match (self.as_number(), other.as_number()) {
            (Some(a), Some(b)) => Ok(a == b || (a.is_nan() && b.is_nan())),
            _ => self.strict_equals(cx, other),
        }
    }

    /// IsLooselyEqual
    #[inline(always)]
    pub fn loose_equals(self, cx: &mut Cx, other: Value) -> JsResult<bool> {
        if self.is_int32() && other.is_int32() {
            return Ok(self == other);
        }
        self.loose_equals_slow(cx, other)
    }

    fn loose_equals_slow(self, cx: &mut Cx, other: Value) -> JsResult<bool> {
        let (mut a, mut b) = (self, other);
        if a.is_undefined_or_null() || b.is_undefined_or_null() {
            let is_nullish = |value: Value| match value.as_cell() {
                Some(cell) => cell.masquerades_as_undefined(cx),
                None => value.is_undefined_or_null(),
            };
            return Ok(is_nullish(a) && is_nullish(b));
        }
        match (a.as_object(), b.as_object()) {
            (Some(a), Some(b)) => return Ok(a == b),
            (Some(object), None) => a = object.to_primitive(cx, PreferredType::None)?,
            (None, Some(object)) => b = object.to_primitive(cx, PreferredType::None)?,
            (None, None) => {}
        }
        if a.is_undefined_or_null() || b.is_undefined_or_null() {
            return Ok(false);
        }
        if a.is_symbol() || b.is_symbol() {
            return Ok(a == b);
        }
        if let (Some(a), Some(b)) = (a.as_string(), b.as_string()) {
            return a.equals(cx, &b);
        }
        Ok(compare_mixed_primitives(cx, a, b)? == Some(Ordering::Equal))
    }

    /// For `<`, `<=`, `>` and `>=`. `None` if either is NaN. `self` is converted first.
    #[inline(always)]
    pub fn compare(self, cx: &mut Cx, other: Value) -> JsResult<Option<Ordering>> {
        if let (Some(a), Some(b)) = (self.as_number(), other.as_number()) {
            return Ok(a.partial_cmp(&b));
        }
        self.compare_slow(cx, other)
    }

    fn compare_slow(self, cx: &mut Cx, other: Value) -> JsResult<Option<Ordering>> {
        if let (Some(a), Some(b)) = (self.as_bigint(), other.as_bigint()) {
            return Ok(Some(a.value().cmp(&b.value())));
        }
        let a = self.to_primitive(cx, PreferredType::Number)?;
        let b = other.to_primitive(cx, PreferredType::Number)?;
        if let (Some(a), Some(b)) = (a.as_string(), b.as_string()) {
            return a.compare(cx, &b).map(Some);
        }
        compare_mixed_primitives(cx, a, b)
    }
}

/// They are not both strings.
fn compare_mixed_primitives(cx: &mut Cx, a: Value, b: Value) -> JsResult<Option<Ordering>> {
    if let (Some(a), Some(b)) = (a.as_bigint(), b.as_string()) {
        return a.compare_to_string(cx, &b);
    }
    if let (Some(a), Some(b)) = (a.as_string(), b.as_bigint()) {
        return Ok(b.compare_to_string(cx, &a)?.map(Ordering::reverse));
    }
    Ok(match (a.to_numeric(cx)?, b.to_numeric(cx)?) {
        (Numeric::Number(a), Numeric::Number(b)) => a.partial_cmp(&b),
        (Numeric::BigInt(a), Numeric::BigInt(b)) => Some(a.value().cmp(&b.value())),
        (Numeric::BigInt(a), Numeric::Number(b)) => a.value().cmp_number(b),
        (Numeric::Number(a), Numeric::BigInt(b)) => b.value().cmp_number(a).map(Ordering::reverse),
    })
}
