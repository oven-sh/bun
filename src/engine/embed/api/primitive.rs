use bun_engine_bigint::LiteralRadix;
use bun_engine_macros::export;
use bun_engine_text::{PropertyName, StringImpl, StringRef, Text};
use bun_engine_vm::{
    BooleanObject, Cx, Gc, JsBigInt, JsResult, JsRopeString, JsString, JsSymbol, PropertyKey,
    Shape, Value, Vm,
};

#[export]
fn string_create(vm: &Vm, string: StringRef) -> Gc<JsString> {
    if string.is_symbol() {
        return JsString::from_impl_cached(vm, &string);
    }
    JsString::new(vm, string)
}

#[export]
fn string_create_retaining(vm: &Vm, string: &StringImpl) -> Gc<JsString> {
    string_create(vm, StringRef::retain(string))
}

#[export]
fn string_create_cached(vm: &Vm, string: &StringImpl) -> Gc<JsString> {
    JsString::from_impl_cached(vm, string)
}

#[export]
fn string_of_static_atom(vm: &Vm, index: u32) -> Gc<JsString> {
    vm.small_strings.of_static_atom(vm, index as usize)
}

#[export]
fn string_concat(cx: &Cx, a: Gc<JsString>, b: Gc<JsString>) -> JsResult<Gc<JsString>> {
    JsString::concat(cx, a, b)
}

#[export]
fn string_concat3(
    cx: &Cx,
    a: Gc<JsString>,
    b: Gc<JsString>,
    c: Gc<JsString>,
) -> JsResult<Gc<JsString>> {
    JsString::concat3(cx, a, b, c)
}

#[export]
fn string_substring(string: &JsString, cx: &Cx, start: u32, length: u32) -> JsResult<Gc<JsString>> {
    string.substring(cx, start, start + length)
}

#[export]
fn string_substring_of_resolved(
    string: Gc<JsString>,
    vm: &Vm,
    start: u32,
    length: u32,
) -> Gc<JsString> {
    match string.try_view() {
        Some(view) => view.substring(vm, start as usize..start as usize + length as usize),
        None => JsRopeString::substring_of_resolved(vm, string, start, length),
    }
}

#[export]
fn string_resolve(string: &JsString, cx: &Cx) -> JsResult<bool> {
    string.resolve(cx).map(|_| true)
}

#[export]
fn string_try_resolve(string: &JsString, vm: &Vm) -> bool {
    string.try_resolve(vm).is_ok()
}

#[export]
fn string_without_resolving(string: &JsString) -> StringRef {
    string.to_string_without_resolving()
}

#[export]
fn string_equals(a: &JsString, cx: &Cx, b: &JsString) -> JsResult<bool> {
    a.equals(cx, b)
}

fn name_held_by_string<'a>(key: &PropertyKey) -> PropertyName<'a> {
    // SAFETY: the string holds it, and C++ keeps the string alive for as long as it uses the name.
    unsafe { PropertyName::from_raw(key.name().as_ptr()) }
}

#[export]
fn string_to_atom<'a>(string: &'a JsString, cx: &Cx) -> JsResult<PropertyName<'a>> {
    Ok(name_held_by_string(&string.to_property_key(cx)?))
}

#[export]
fn string_to_existing_atom<'a>(
    string: &'a JsString,
    cx: &Cx,
) -> JsResult<Option<PropertyName<'a>>> {
    let key = string.to_existing_property_key(cx)?;
    Ok(key.as_ref().map(name_held_by_string))
}

#[export]
fn symbol_create(vm: &Vm, description: Option<&StringImpl>) -> Gc<JsSymbol> {
    JsSymbol::create(vm, description)
}

#[export]
fn symbol_descriptive_string(symbol: &JsSymbol) -> Option<StringRef> {
    symbol.descriptive_string().ok()
}

#[export]
fn bigint_from_i64(vm: &Vm, value: i64) -> Gc<JsBigInt> {
    JsBigInt::from_small(vm, value)
}

#[export]
fn bigint_from_u64(vm: &Vm, value: u64) -> Gc<JsBigInt> {
    JsBigInt::from_small(vm, value)
}

#[export]
fn bigint_from_digits(cx: &Cx, digits: &[u64], is_negative: bool) -> JsResult<Gc<JsBigInt>> {
    JsBigInt::from_words(cx, is_negative, digits)
}

#[export]
fn bigint_try_from_digits(vm: &Vm, digits: &[u64], is_negative: bool) -> Option<Gc<JsBigInt>> {
    JsBigInt::try_from_words(vm, is_negative, digits).ok()
}

#[export]
fn bigint_from_hexadecimal(cx: &Cx, text: Text<'_>) -> JsResult<Option<Value>> {
    let parsed = JsBigInt::from_characters(cx, text, LiteralRadix::Hexadecimal, false)?;
    Ok(parsed.map(Into::into))
}

#[export]
fn bigint_from_text(cx: &Cx, text: Text<'_>) -> JsResult<Option<Value>> {
    Ok(JsBigInt::from_string(cx, text)?.map(Into::into))
}

#[export]
fn bigint_to_number(value: &JsBigInt) -> f64 {
    value.value().to_number()
}

#[export]
fn bigint_to_string(value: &JsBigInt, cx: &Cx, radix: u32) -> JsResult<StringRef> {
    value.to_string_ref(cx, radix)
}

/// `number` is not NaN.
#[export]
fn bigint_compare_to_number(value: &JsBigInt, number: f64) -> i32 {
    value.value().cmp_number(number).map_or(0, |it| it as i32)
}

#[export]
fn boolean_object_create(vm: &Vm, shape: Gc<Shape>) -> Gc<BooleanObject> {
    BooleanObject::create(vm, shape, Value::FALSE)
}
