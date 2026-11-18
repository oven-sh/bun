//! The methods of `Set.prototype` that take another set.

use bun_engine_vm::{HashedKey, IterationMode, IteratorRecord, JsSet, errors};

use super::set::this_set;
use crate::prelude::*;

struct SetRecord {
    object: Gc<JsObject>,
    size: f64,
    has: Value,
    keys: Value,
    method: &'static str,
}

impl SetRecord {
    /// GetSetRecord
    fn get(cx: &mut Cx, value: Value, method: &'static str) -> JsResult<SetRecord> {
        let Some(object) = value.as_object() else {
            return Err(cx.throw_type_error("Set operation expects first argument to be an object"));
        };
        let size = object.get(cx, names::size)?.to_number(cx)?.trunc();
        if size.is_nan() {
            let message = "Set operation expects first argument to have non-NaN 'size' property";
            return Err(cx.throw_type_error(message));
        }
        if size < 0.0 {
            let message =
                "Set operation expects first argument to have non-negative 'size' property";
            return Err(cx.throw_range_error(message));
        }
        let mut callable = |name| {
            let function = object.get(cx, name)?;
            if !function.is_callable() {
                return Err(cx.throw_type_error(format_args!(
                    "Set.prototype.{method} expects other.{name} to be callable"
                )));
            }
            Ok(function)
        };
        Ok(SetRecord {
            object,
            size,
            has: callable(names::has)?,
            keys: callable(names::keys)?,
            method,
        })
    }

    fn has(&self, cx: &mut Cx, key: Value) -> JsResult<bool> {
        Ok(cx
            .call(self.has, self.object.into(), &[key])?
            .to_boolean(cx))
    }

    fn is_smaller_than(&self, set: &JsSet) -> bool {
        self.size < f64::from(set.size())
    }

    fn keys(&self, cx: &mut Cx) -> JsResult<IteratorRecord> {
        let iterator = cx.call(self.keys, self.object.into(), &[])?;
        if iterator.is_undefined_or_null() {
            return Err(errors::throw_not_an_object(cx, iterator));
        }
        if iterator.is_object() {
            let record = IteratorRecord::direct(cx, iterator)?;
            let [_, next, _] = record.parts();
            if record.mode() != IterationMode::Generic || next.is_callable() {
                return Ok(record);
            }
        }
        Err(match self.method {
            "union" | "intersection" => cx.throw_type_error(errors::TYPE_ERROR),
            method => cx.throw_type_error(format_args!(
                "Set.prototype.{method} expects other.keys().next to be callable"
            )),
        })
    }

    /// Whether `has` answers `wanted` for any key of `set`.
    fn has_is_ever(&self, cx: &mut Cx, set: &JsSet, wanted: bool) -> JsResult<bool> {
        for key in set.cursor() {
            if self.has(cx, key)? == wanted {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Whether it is `wanted`, for any key of the record, that `set` has it.
    fn contains_is_ever(&self, cx: &mut Cx, set: &JsSet, wanted: bool) -> JsResult<bool> {
        let mut keys = self.keys(cx)?;
        while let Some(key) = keys.step_value(cx)? {
            if set.has(cx, key)? == wanted {
                keys.close(cx)?;
                return Ok(true);
            }
        }
        Ok(false)
    }
}

#[inline(always)]
fn pristine_set(cx: &Cx, value: Value) -> Option<Gc<JsSet>> {
    value
        .downcast::<JsSet>()
        .filter(|set| set.is_set_record_pristine(cx))
}

#[native_abi]
pub(super) fn union(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, other) = (this_set(cx, frame)?, frame.argument(0));
    if let Some(other) = pristine_set(cx, other) {
        return this.union(cx, &other).map(Into::into);
    }
    let mut keys = SetRecord::get(cx, other, "union")?.keys(cx)?;
    let result = this.clone_with_shape(cx, cx.set_shape())?;
    while let Some(key) = keys.step_value(cx)? {
        result.add(cx, key)?;
    }
    Ok(result.into())
}

#[native_abi]
pub(super) fn intersection(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, other) = (this_set(cx, frame)?, frame.argument(0));
    if let Some(other) = pristine_set(cx, other) {
        return this.intersection(cx, &other).map(Into::into);
    }
    let other = SetRecord::get(cx, other, "intersection")?;
    let result = JsSet::create(cx);
    if other.is_smaller_than(&this) {
        let mut keys = other.keys(cx)?;
        while let Some(key) = keys.step_value(cx)? {
            let key = HashedKey::new(cx, key)?;
            if this.has_hashed(key) {
                result.add_hashed(cx, key)?;
            }
        }
    } else {
        let mut keys = this.cursor();
        while let Some(key) = keys.next_key() {
            if other.has(cx, key.value())? {
                result.add_hashed(cx, key)?;
            }
        }
    }
    Ok(result.into())
}

#[native_abi]
pub(super) fn difference(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, other) = (this_set(cx, frame)?, frame.argument(0));
    if let Some(other) = pristine_set(cx, other) {
        return this.difference(cx, &other).map(Into::into);
    }
    let other = SetRecord::get(cx, other, "difference")?;
    let result = this.clone_with_shape(cx, cx.set_shape())?;
    if other.is_smaller_than(&this) {
        let mut keys = other.keys(cx)?;
        while let Some(key) = keys.step_value(cx)? {
            result.remove(cx, key)?;
        }
    } else {
        let mut keys = result.cursor();
        while let Some(key) = keys.next_key() {
            if other.has(cx, key.value())? {
                result.remove_hashed(cx, key);
            }
        }
    }
    Ok(result.into())
}

#[native_abi]
pub(super) fn symmetric_difference(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, other) = (this_set(cx, frame)?, frame.argument(0));
    if let Some(other) = pristine_set(cx, other) {
        return this.symmetric_difference(cx, &other).map(Into::into);
    }
    let mut keys = SetRecord::get(cx, other, "symmetricDifference")?.keys(cx)?;
    let result = this.clone_with_shape(cx, cx.set_shape())?;
    while let Some(key) = keys.step_value(cx)? {
        let key = HashedKey::new(cx, key)?;
        if this.has_hashed(key) {
            result.remove_hashed(cx, key);
        } else {
            result.add_hashed(cx, key)?;
        }
    }
    Ok(result.into())
}

#[native_abi]
pub(super) fn is_subset_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, other) = (this_set(cx, frame)?, frame.argument(0));
    if let Some(other) = pristine_set(cx, other) {
        return Ok(this.is_subset_of(&other).into());
    }
    let other = SetRecord::get(cx, other, "isSubsetOf")?;
    Ok((!other.is_smaller_than(&this) && !other.has_is_ever(cx, &this, false)?).into())
}

#[native_abi]
pub(super) fn is_superset_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, other) = (this_set(cx, frame)?, frame.argument(0));
    if let Some(other) = pristine_set(cx, other) {
        return Ok(other.is_subset_of(&this).into());
    }
    let other = SetRecord::get(cx, other, "isSupersetOf")?;
    Ok((f64::from(this.size()) >= other.size && !other.contains_is_ever(cx, &this, false)?).into())
}

#[native_abi]
pub(super) fn is_disjoint_from(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, other) = (this_set(cx, frame)?, frame.argument(0));
    if let Some(other) = pristine_set(cx, other) {
        return Ok(this.is_disjoint_from(&other).into());
    }
    let other = SetRecord::get(cx, other, "isDisjointFrom")?;
    let overlaps = if other.is_smaller_than(&this) {
        other.contains_is_ever(cx, &this, true)?
    } else {
        other.has_is_ever(cx, &this, true)?
    };
    Ok((!overlaps).into())
}
