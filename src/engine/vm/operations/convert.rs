use bun_engine_text::{PropertyName, StringRef, names};

use crate::{
    CallData, CellKind, CellType, Cx, DateInstance, Gc, JsBigInt, JsCell, JsObject, JsResult,
    JsString, JsSymbol, JsWrapperObject, PropertyKey, RealmSlot, SpecialProperty, StringObject,
    StringView, TypeFlags, Value, Vm, errors,
};

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PreferredType {
    None,
    Number,
    String,
}

#[derive(Clone, Copy)]
pub enum Numeric {
    Number(f64),
    BigInt(Gc<JsBigInt>),
}

pub const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

impl Value {
    #[inline(always)]
    pub fn as_object(self) -> Option<Gc<JsObject>> {
        self.downcast()
    }

    #[inline(always)]
    pub fn as_string(self) -> Option<Gc<JsString>> {
        self.downcast()
    }

    #[inline(always)]
    pub fn as_symbol(self) -> Option<Gc<JsSymbol>> {
        self.downcast()
    }

    #[inline(always)]
    pub fn as_bigint(self) -> Option<Gc<JsBigInt>> {
        self.downcast()
    }

    /// Panics if it is not a `T`.
    #[inline(always)]
    #[track_caller]
    pub fn cast<T: CellKind>(self) -> Gc<T> {
        self.as_cell().expect("a cell").cast()
    }

    #[inline(always)]
    pub fn is_object(self) -> bool {
        self.is::<JsObject>()
    }

    #[inline(always)]
    pub fn is_string(self) -> bool {
        self.is::<JsString>()
    }

    #[inline(always)]
    pub fn is_symbol(self) -> bool {
        self.is::<JsSymbol>()
    }

    #[inline(always)]
    pub fn is_bigint(self) -> bool {
        self.is::<JsBigInt>()
    }

    #[inline(always)]
    pub fn is_primitive(self) -> bool {
        !self.is_object()
    }

    pub(crate) fn is_accessor_cell(self) -> bool {
        self.as_cell().is_some_and(|cell| {
            matches!(
                cell.cell_type(),
                CellType::GetterSetter | CellType::CustomGetterSetter
            )
        })
    }

    #[inline(always)]
    pub fn is_callable(self) -> bool {
        self.as_object().is_some_and(|object| object.is_callable())
    }

    pub fn is_constructor(self) -> bool {
        !CallData::for_construct(self).is_none()
    }

    #[inline(always)]
    pub fn to_boolean(self, cx: &Cx) -> bool {
        if let Some(cell) = self.as_cell() {
            return cell.to_boolean(cx);
        }
        if let Some(integer) = self.as_int32() {
            return integer != 0;
        }
        match self.as_double() {
            Some(number) => number != 0.0 && !number.is_nan(),
            None => self.is_true(),
        }
    }

    #[inline(always)]
    pub fn to_primitive(self, cx: &mut Cx, preferred: PreferredType) -> JsResult<Value> {
        match self.as_object() {
            Some(object) => object.to_primitive(cx, preferred),
            None => Ok(self),
        }
    }

    #[inline(always)]
    pub fn to_number(self, cx: &mut Cx) -> JsResult<f64> {
        match self.as_number() {
            Some(number) => Ok(number),
            None => self.to_number_slow(cx),
        }
    }

    #[inline(never)]
    fn to_number_slow(self, cx: &mut Cx) -> JsResult<f64> {
        (self.to_primitive(cx, PreferredType::Number)?).primitive_to_number(cx)
    }

    /// `self` is no object.
    #[inline]
    pub(crate) fn primitive_to_number(self, cx: &Cx) -> JsResult<f64> {
        let Some(cell) = self.as_cell() else {
            return Ok(match self {
                Value::UNDEFINED => f64::NAN,
                Value::TRUE => 1.0,
                _ => self.as_number().unwrap_or(0.0),
            });
        };
        if let Some(string) = cell.downcast::<JsString>() {
            return string.to_number(cx);
        }
        Err(cx.throw_type_error(if cell.is_symbol() {
            "Cannot convert a symbol to a number"
        } else {
            "Conversion from 'BigInt' to 'number' is not allowed."
        }))
    }

    #[inline(always)]
    pub fn to_numeric(self, cx: &mut Cx) -> JsResult<Numeric> {
        if let Some(number) = self.as_number() {
            return Ok(Numeric::Number(number));
        }
        let primitive = self.to_primitive(cx, PreferredType::Number)?;
        match primitive.as_bigint() {
            Some(bigint) => Ok(Numeric::BigInt(bigint)),
            None => primitive.to_number(cx).map(Numeric::Number),
        }
    }

    #[inline(always)]
    pub fn to_int32(self, cx: &mut Cx) -> JsResult<i32> {
        match self.as_int32() {
            Some(integer) => Ok(integer),
            None => self.to_number(cx).map(bun_engine_number::to_int32),
        }
    }

    #[inline(always)]
    pub fn to_uint32(self, cx: &mut Cx) -> JsResult<u32> {
        self.to_int32(cx).map(|integer| integer as u32)
    }

    #[inline(always)]
    pub fn to_integer_or_infinity(self, cx: &mut Cx) -> JsResult<f64> {
        if let Some(integer) = self.as_int32() {
            return Ok(integer.into());
        }
        let number = self.to_number(cx)?;
        Ok(if number.is_nan() {
            0.0
        } else {
            number.trunc() + 0.0
        })
    }

    #[inline(always)]
    pub fn to_length(self, cx: &mut Cx) -> JsResult<u64> {
        if let Some(integer) = self.as_int32() {
            return Ok(integer.max(0) as u64);
        }
        Ok((self.to_number(cx)? as u64).min(MAX_SAFE_INTEGER as u64))
    }

    /// ToIndex. `name` is what the error calls the value.
    pub fn to_index(self, cx: &mut Cx, name: &str) -> JsResult<u64> {
        if let Some(index) = self.as_index_int32() {
            return Ok(index.into());
        }
        let number = self.to_integer_or_infinity(cx)?;
        if number < 0.0 {
            return Err(cx.throw_range_error(format_args!("{name} cannot be negative")));
        }
        if number > MAX_SAFE_INTEGER {
            return Err(cx.throw_range_error(format_args!("{name} larger than (2 ** 53) - 1")));
        }
        Ok(number as u64)
    }

    /// An index that counts from the end if it is negative, clamped to `0..=length`.
    #[inline(always)]
    pub fn to_relative_index(self, cx: &mut Cx, length: u64, default: u64) -> JsResult<u64> {
        match self.as_int32() {
            Some(index @ 0..) => Ok(length.min(index as u64)),
            Some(index) => Ok(length.saturating_sub(index.unsigned_abs().into())),
            None if self.is_undefined() => Ok(default),
            None => self.to_relative_index_slow(cx, length),
        }
    }

    #[inline(never)]
    fn to_relative_index_slow(self, cx: &mut Cx, length: u64) -> JsResult<u64> {
        let relative = self.to_integer_or_infinity(cx)?;
        Ok(if relative < 0.0 {
            (relative + length as f64).max(0.0) as u64
        } else {
            relative.min(length as f64) as u64
        })
    }

    #[inline(always)]
    pub fn to_bigint(self, cx: &mut Cx) -> JsResult<Gc<JsBigInt>> {
        match self.as_bigint() {
            Some(bigint) => Ok(bigint),
            None => self.to_bigint_slow(cx),
        }
    }

    #[inline(never)]
    fn to_bigint_slow(self, cx: &mut Cx) -> JsResult<Gc<JsBigInt>> {
        let primitive = self.to_primitive(cx, PreferredType::Number)?;
        if let Some(bigint) = primitive.as_bigint() {
            return Ok(bigint);
        }
        if let Some(boolean) = primitive.as_boolean() {
            return Ok(JsBigInt::from_small(cx, boolean));
        }
        if let Some(string) = primitive.as_string() {
            return JsBigInt::parse(cx, string.view(cx)?.text());
        }
        Err(cx.throw_type_error("Invalid argument type in ToBigInt operation"))
    }

    #[inline]
    pub fn to_bigint64(self, cx: &mut Cx) -> JsResult<i64> {
        Ok(self.to_bigint(cx)?.value().to_i64_wrapping())
    }

    #[inline]
    pub fn to_biguint64(self, cx: &mut Cx) -> JsResult<u64> {
        Ok(self.to_bigint(cx)?.value().to_u64_wrapping())
    }

    #[inline(always)]
    pub fn to_string(self, cx: &mut Cx) -> JsResult<Gc<JsString>> {
        match self.as_string() {
            Some(string) => Ok(string),
            None => self.to_string_slow(cx),
        }
    }

    #[inline(never)]
    fn to_string_slow(self, cx: &mut Cx) -> JsResult<Gc<JsString>> {
        let primitive = self.to_primitive(cx, PreferredType::String)?;
        primitive.primitive_to_string(cx)
    }

    /// `self` is no object.
    pub fn primitive_to_string(self, cx: &Cx) -> JsResult<Gc<JsString>> {
        let Some(cell) = self.as_cell() else {
            return Ok(JsString::from_immediate(cx, self));
        };
        if let Some(string) = cell.downcast::<JsString>() {
            return Ok(string);
        }
        match cell.downcast::<JsBigInt>() {
            Some(bigint) => bigint.to_js_string(cx, 10),
            None => Err(cx.throw_type_error(errors::SYMBOL_TO_STRING)),
        }
    }

    #[inline(always)]
    pub fn to_string_view(self, cx: &mut Cx) -> JsResult<StringView> {
        self.to_string(cx)?.view(cx)
    }

    pub fn to_string_ref(self, cx: &mut Cx) -> JsResult<StringRef> {
        self.to_string(cx)?.to_string_ref(cx)
    }

    #[inline(always)]
    pub fn to_property_key(self, cx: &mut Cx) -> JsResult<PropertyKey> {
        match self.as_string() {
            Some(string) => string.to_property_key(cx),
            None => self.to_property_key_slow(cx),
        }
    }

    #[inline(never)]
    fn to_property_key_slow(self, cx: &mut Cx) -> JsResult<PropertyKey> {
        let primitive = self.to_primitive(cx, PreferredType::String)?;
        match primitive.as_symbol() {
            Some(symbol) => Ok(PropertyKey::from_symbol(symbol)),
            None => primitive.primitive_to_string(cx)?.to_property_key(cx),
        }
    }

    /// ToPropertyKey, without making an atom of a string.
    pub fn to_property_key_value(self, cx: &mut Cx) -> JsResult<Value> {
        let primitive = self.to_primitive(cx, PreferredType::String)?;
        if primitive.is_symbol() {
            return Ok(primitive);
        }
        primitive.primitive_to_string(cx).map(Into::into)
    }

    #[inline(always)]
    pub fn to_object(self, cx: &Cx) -> JsResult<Gc<JsObject>> {
        match self.as_object() {
            Some(object) => Ok(object),
            None => self.to_object_slow(cx),
        }
    }

    #[inline(never)]
    fn to_object_slow(self, cx: &Cx) -> JsResult<Gc<JsObject>> {
        if let Some(string) = self.as_string() {
            return Ok(StringObject::create(cx, cx.string_object_shape(), string).upcast());
        }
        match JsWrapperObject::wrap(cx, self) {
            Some(object) => Ok(object.upcast()),
            None => Err(errors::throw_not_an_object(cx, self)),
        }
    }

    /// `message` is the text of the error, unless it is empty.
    #[inline]
    pub fn to_object_or_throw(self, cx: &Cx, message: PropertyName<'_>) -> JsResult<Gc<JsObject>> {
        if self.is_undefined_or_null() && !message.text().is_empty() {
            return Err(cx.throw_type_error(message.to_identifier().into_string()));
        }
        self.to_object(cx)
    }

    /// RequireObjectCoercible
    #[inline]
    pub fn require_object_coercible(self, cx: &Cx, message: &'static str) -> JsResult<Value> {
        if self.is_undefined_or_null() {
            return Err(cx.throw_type_error(message));
        }
        Ok(self)
    }

    /// OrdinaryCallBindThis, for a function that is not strict.
    pub fn to_sloppy_this(self, cx: &Cx) -> Gc<JsObject> {
        match self.to_object_if_coercible(cx) {
            Some(object) if object.cell_type() != CellType::GlobalObject => object,
            _ => cx.global_this().upcast(),
        }
    }

    fn to_object_if_coercible(self, cx: &Cx) -> Option<Gc<JsObject>> {
        if self.is_undefined_or_null() {
            return None;
        }
        self.to_object(cx).ok()
    }

    pub fn type_of(self, cx: &Cx) -> Gc<JsString> {
        let name = match self.as_cell() {
            None if self.is_number() => names::number,
            None if self.is_boolean() => names::boolean,
            None if self.is_null() => names::object,
            None => names::undefined,
            Some(cell) => match cell.cell_type() {
                CellType::String => names::string,
                CellType::Symbol => names::symbol,
                CellType::BigInt => names::bigint,
                _ if cell.masquerades_as_undefined(cx) => names::undefined,
                _ if self.is_callable() => names::function,
                _ => names::object,
            },
        };
        JsString::from_name(cx, name)
    }
}

impl JsString {
    /// Of what is no cell.
    #[inline(always)]
    pub fn from_immediate(vm: &Vm, value: Value) -> Gc<JsString> {
        if let Some(integer) = value.as_int32() {
            return JsString::from_int32(vm, integer);
        }
        if let Some(number) = value.as_double() {
            return JsString::from_number(vm, number);
        }
        let name = match value {
            Value::TRUE => names::r#true,
            Value::FALSE => names::r#false,
            Value::NULL => names::null,
            _ => names::undefined,
        };
        JsString::from_name(vm, name)
    }
}

impl JsCell {
    #[inline(always)]
    pub fn masquerades_as_undefined(&self, cx: &Cx) -> bool {
        self.inline_flags()
            .contains(TypeFlags::MASQUERADES_AS_UNDEFINED)
            && self.shape().global() == Some(cx.global())
    }

    #[inline(always)]
    pub fn to_boolean(&self, cx: &Cx) -> bool {
        if let Some(string) = self.downcast::<JsString>() {
            return !string.is_empty();
        }
        if let Some(bigint) = self.downcast::<JsBigInt>() {
            return !bigint.is_zero();
        }
        !self.masquerades_as_undefined(cx)
    }
}

impl From<Numeric> for Value {
    #[inline]
    fn from(numeric: Numeric) -> Value {
        match numeric {
            Numeric::Number(number) => number.into(),
            Numeric::BigInt(bigint) => bigint.into(),
        }
    }
}

impl JsObject {
    pub fn to_primitive(&self, cx: &mut Cx, preferred: PreferredType) -> JsResult<Value> {
        let exotic = self.get_special_property(cx, SpecialProperty::ToPrimitive)?;
        if exotic.is_undefined_or_null() {
            return self.ordinary_to_primitive(cx, preferred);
        }
        if let Some(date) = self.as_value().downcast::<DateInstance>()
            && date.has_pristine_conversions(cx)
        {
            return Ok(match preferred {
                PreferredType::Number => date.time().into(),
                _ => date.to_date_string(cx).into(),
            });
        }
        if !exotic.is_callable() {
            let message = "Symbol.toPrimitive is not a function, undefined, or null";
            return Err(cx.throw_type_error(message));
        }
        let hint = match preferred {
            PreferredType::None => names::default,
            PreferredType::Number => names::number,
            PreferredType::String => names::string,
        };
        let hint = JsString::from_name(cx, hint);
        let result = cx.call(exotic, self.as_value(), &[hint.into()])?;
        if result.is_object() {
            return Err(cx.throw_type_error("Symbol.toPrimitive returned an object"));
        }
        Ok(result)
    }

    pub fn ordinary_to_primitive(&self, cx: &mut Cx, preferred: PreferredType) -> JsResult<Value> {
        let mut order = [SpecialProperty::ValueOf, SpecialProperty::ToString];
        if preferred == PreferredType::String {
            order.reverse();
        }
        for property in order {
            let method = self.get_special_property(cx, property)?;
            let is = |slot| method.as_cell() == cx.global().slot_if_initialized(slot);
            if !method.is_cell() || is(RealmSlot::object_prototype_value_of) {
                continue;
            }
            if is(RealmSlot::object_prototype_to_string) {
                return self.to_tagged_string(cx).map(Into::into);
            }
            if is(RealmSlot::array_prototype_to_string)
                && let Some(array) = self.as_exact_array()
                && array.has_default_join(cx)
            {
                return array.join_with_commas(cx).map(Into::into);
            }
            if method.is_callable() {
                let result = cx.call(method, self.as_value(), &[])?;
                if !result.is_object() {
                    return Ok(result);
                }
            }
        }
        Err(cx.throw_type_error("No default value"))
    }
}
