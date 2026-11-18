//! Accesses whose key is a value.

use bun_engine_text::{PropertyName, names};

use super::{
    AccessCases, Key, StoreMode, delete_by_key, get_by_key, has_by_key, put_by_key,
    shape_for_lookup,
};
use crate::code::metadata::ArrayAccess;
use crate::{
    ArrayModes, ArrayProfile, Attributes, CodeBlock, Cx, ElementKind, Gc, JsObject, JsResult,
    JsTypedArray, MappedArguments, ProxyObject, RealmWatchpoint, TypeFlags, Value, Vm, errors,
};

/// For a key that is no array index.
#[inline(always)]
fn typed_element(
    profile: &ArrayProfile,
    base: Value,
    key: Value,
) -> Option<(Gc<JsTypedArray>, usize)> {
    let number = key.as_number()?;
    let Some(array) = base.downcast::<JsTypedArray>() else {
        if key.is_int32() {
            profile.record_negative_index(base);
        }
        return None;
    };
    let index = JsTypedArray::index_for_number(number);
    profile.record_base(base);
    profile.record_typed_index(&array, index);
    Some((array, index))
}

/// What ToPropertyKey makes of the primitives that are frequent as keys.
pub const STATIC_KEYS: [(Value, PropertyName<'static>); 5] = [
    (Value::UNDEFINED, names::undefined),
    (Value::NULL, names::null),
    (Value::TRUE, names::r#true),
    (Value::FALSE, names::r#false),
    (Value::int32(-1), names::minusOne),
];

#[inline(always)]
pub fn static_name_for_key(key: Value) -> Option<PropertyName<'static>> {
    (STATIC_KEYS.into_iter().find(|it| it.0 == key)).map(|it| it.1)
}

/// `access`, by a name that is no index. `key` is an atom, a symbol or one of `STATIC_KEYS`.
#[inline(always)]
fn by_name<T>(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    base: Value,
    key: (Value, PropertyName<'_>),
    access: impl FnOnce(&mut Cx) -> JsResult<T>,
) -> JsResult<T> {
    let shape = shape_for_lookup(base);
    cases.will_use_key(cx, shape, key);
    let result = access(cx)?;
    cases.did_use_key(cx, owner, shape, key.0);
    Ok(result)
}

/// Of an object whose dense elements do not have the index.
#[inline(always)]
fn is_absent(vm: &Vm, profile: &ArrayProfile, object: &JsObject, index: u32) -> bool {
    if object.element_kind() == ElementKind::Sparse {
        return false;
    }
    if object.element_kind().is_dense() {
        profile.record(if index < object.public_length() {
            ArrayModes::HOLE
        } else {
            ArrayModes::OUT_OF_BOUNDS
        });
    } else if (object.downcast::<MappedArguments>()).is_some_and(|it| index >= it.plain_length()) {
        profile.record(ArrayModes::OUT_OF_BOUNDS);
    }
    object.has_only_own_elements(vm)
}

/// The value of an own data property of an object that has more than dense elements, or `Some(None)` if no object on
/// the chain has the index.
#[inline(always)]
fn find_irregular_element(vm: &Vm, object: &JsObject, index: u32) -> Option<Option<Value>> {
    if let Some(arguments) = object.downcast::<MappedArguments>() {
        if let found @ Some(_) = arguments.try_get(index) {
            return Some(found);
        }
        if object.indexing_mode().has_elements() {
            return None;
        }
    } else if (object.shape().type_flags()).contains(TypeFlags::INTERCEPTS_INDEXED_ACCESS) {
        return None;
    } else if let Some(entry) = object.sparse_elements()?.get(index) {
        object.prefer_dense_elements(vm);
        return (!entry.attributes.contains(Attributes::ACCESSOR)).then_some(Some(entry.value));
    }
    object.inherits_no_elements(vm).then_some(None)
}

#[inline(always)]
fn get_element(
    cx: &mut Cx,
    owner: &CodeBlock,
    entry: &ArrayAccess,
    base: Value,
    index: u32,
) -> JsResult<Value> {
    let profile = &entry.array;
    profile.record_base(base);
    let Some(object) = base.as_object() else {
        if base.as_string().is_some_and(|it| index >= it.len()) {
            profile.record(ArrayModes::OUT_OF_BOUNDS);
            if cx.holds(RealmWatchpoint::StringPrototypeChainIsSane) {
                return Ok(Value::UNDEFINED);
            }
        }
        return base.get_index(cx, index);
    };
    if let Some(value) = object.try_get_dense(index) {
        return Ok(value);
    }
    if let Some(array) = object.downcast::<JsTypedArray>() {
        profile.record_typed_index(&array, index as usize);
        return Ok(array.get_element(cx, index as usize).unwrap_or_default());
    }
    if is_absent(cx, profile, &object, index) {
        return Ok(Value::UNDEFINED);
    }
    if let Some(found) = find_irregular_element(cx, &object, index) {
        return Ok(found.unwrap_or_default());
    }
    if object.is::<ProxyObject>() {
        let key = Value::from(index).to_property_key(cx)?;
        return get_by_key(
            cx,
            owner,
            &entry.cases,
            base,
            None,
            key.name(),
            Key::Variable,
        );
    }
    object.get_index(cx, index.into())
}

/// `base[key]`
#[inline(always)]
pub fn get_by_value(
    cx: &mut Cx,
    owner: &CodeBlock,
    entry: &ArrayAccess,
    base: Value,
    key: Value,
) -> JsResult<Value> {
    if let Some(index) = key.as_array_index() {
        return get_element(cx, owner, entry, base, index);
    }
    if let Some((array, index)) = typed_element(&entry.array, base, key) {
        return Ok(array.get_element(cx, index).unwrap_or_default());
    }
    if base.is_undefined_or_null() {
        return Err(errors::throw_not_an_object(cx, base));
    }
    let get = |cx: &mut Cx, key, name| {
        by_name(cx, owner, &entry.cases, base, (key, name), |cx| {
            get_by_key(cx, owner, &entry.cases, base, None, name, Key::Variable)
        })
    };
    if let Some(name) = static_name_for_key(key) {
        return get(cx, key, name);
    }
    let key = key.to_property_key(cx)?;
    if let Some(index) = key.name().as_index() {
        return base.get_index(cx, index);
    }
    get(cx, key.value(), key.name())
}

#[inline(always)]
pub fn get_by_value_with_this(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    base: Value,
    this: Value,
    key: Value,
) -> JsResult<Value> {
    if base.is_undefined_or_null() {
        return Err(errors::throw_not_an_object(cx, base));
    }
    let key = key.to_property_key(cx)?;
    get_by_key(
        cx,
        owner,
        cases,
        base,
        Some(this),
        key.name(),
        Key::Variable,
    )
}

#[inline(always)]
fn put_index(cx: &mut Cx, base: Value, index: u32, value: Value, mode: StoreMode) -> JsResult<()> {
    match mode {
        StoreMode::Set { is_strict } => base.put_index(cx, index, value, is_strict),
        StoreMode::Define { is_strict } => {
            (base.cast::<JsObject>()).create_data_index(cx, index.into(), value, is_strict)
        }
    }
    .map(|_| ())
}

#[inline(always)]
fn put_element(
    cx: &mut Cx,
    owner: &CodeBlock,
    entry: &ArrayAccess,
    base: Value,
    index: u32,
    value: Value,
    mode: StoreMode,
) -> JsResult<()> {
    let profile = &entry.array;
    profile.record_base(base);
    if let Some(object) = base.as_object() {
        profile.record_index(&object, index, true);
        // What is about to change is not going to be seen again.
        if !object.has_plain_writable_elements()
            || object.element_kind() < ElementKind::for_value(value)
        {
            profile.update();
        }
        if let StoreMode::Set { .. } = mode {
            if object.has_unrestricted_elements() && object.has_ordinary_store_by_index() {
                return cx.or_out_of_memory(object.set_unrestricted_element(cx, index, value));
            }
            if let Some(array) = object.downcast::<JsTypedArray>() {
                return array.set_element(cx, index as usize, value);
            }
            if object.has_ordinary_store_by_index() && object.try_replace_element(cx, index, value)
            {
                return Ok(());
            }
            if (object.downcast::<MappedArguments>()).is_some_and(|it| it.try_set(index, value)) {
                return Ok(());
            }
            if object.is::<ProxyObject>() {
                let key = Value::from(index).to_property_key(cx)?;
                return put_by_key(cx, owner, &entry.cases, base, key.name(), value, mode);
            }
        }
    }
    put_index(cx, base, index, value, mode)
}

/// `base[key] = value`
#[inline(always)]
pub fn put_by_value(
    cx: &mut Cx,
    owner: &CodeBlock,
    entry: &ArrayAccess,
    base: Value,
    key: Value,
    value: Value,
    mode: StoreMode,
) -> JsResult<()> {
    if let Some(index) = key.as_array_index() {
        return put_element(cx, owner, entry, base, index, value, mode);
    }
    if let StoreMode::Set { .. } = mode
        && let Some((array, index)) = typed_element(&entry.array, base, key)
    {
        return array.set_element(cx, index, value);
    }
    if base.is_undefined_or_null() {
        return Err(errors::throw_not_an_object(cx, base));
    }
    let key = key.to_property_key(cx)?;
    if let Some(index) = key.name().as_index() {
        return put_index(cx, base, index, value, mode);
    }
    by_name(
        cx,
        owner,
        &entry.cases,
        base,
        (key.value(), key.name()),
        |cx| put_by_key(cx, owner, &entry.cases, base, key.name(), value, mode),
    )
}

/// `key in object`
#[inline(always)]
pub fn has_by_value(
    cx: &mut Cx,
    owner: &CodeBlock,
    entry: &ArrayAccess,
    object: Gc<JsObject>,
    key: Value,
) -> JsResult<bool> {
    if let Some(index) = key.as_array_index() {
        entry.array.record_base(object.into());
        if object.try_get_dense(index).is_some() {
            return Ok(true);
        }
        if let Some(array) = object.downcast::<JsTypedArray>() {
            entry.array.record_typed_index(&array, index as usize);
            return Ok(array.is_valid_index(index as usize));
        }
        if is_absent(cx, &entry.array, &object, index) {
            return Ok(false);
        }
        if let Some(found) = find_irregular_element(cx, &object, index) {
            return Ok(found.is_some());
        }
        if object.is::<ProxyObject>() {
            let key = key.to_property_key(cx)?;
            return has_by_key(cx, owner, &entry.cases, object, key.name(), Key::Variable);
        }
        return object.has_index(cx, index.into());
    }
    if let Some((array, index)) = typed_element(&entry.array, object.into(), key) {
        return Ok(array.is_valid_index(index));
    }
    let key = key.to_property_key(cx)?;
    if let Some(index) = key.name().as_index() {
        return object.has_index(cx, index.into());
    }
    by_name(
        cx,
        owner,
        &entry.cases,
        object.into(),
        (key.value(), key.name()),
        |cx| has_by_key(cx, owner, &entry.cases, object, key.name(), Key::Variable),
    )
}

/// `delete object[key]`
#[inline(always)]
pub fn delete_by_value(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    object: Gc<JsObject>,
    key: Value,
    is_strict: bool,
) -> JsResult<bool> {
    let Some(index) = key.as_array_index() else {
        let key = key.to_property_key(cx)?;
        return delete_by_key(
            cx,
            owner,
            cases,
            object,
            key.name(),
            Key::Variable,
            is_strict,
        );
    };
    let did_delete = object.delete_property_by_index(cx, index)?;
    if !did_delete && is_strict {
        return Err(cx.throw_type_error(errors::UNABLE_TO_DELETE_PROPERTY));
    }
    Ok(did_delete)
}
