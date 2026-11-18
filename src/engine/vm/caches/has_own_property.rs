use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_text::PropertyName;

use super::{CachedName, primary_hash};
use crate::{CellType, Cx, InternalMethod, JsObject, JsResult, PropertySlot, ShapeId, Value, Vm};

/// At the `primary_hash`.
#[repr(C)]
pub struct HasOwnPropertyEntry {
    name: CachedName,
    shape: Cell<ShapeId>,
    /// The epoch shifted left by one, and the answer.
    epoch_and_result: Cell<u32>,
}

impl HasOwnPropertyEntry {
    pub const COUNT: usize = 1024;
    pub const OFFSET_OF_NAME: usize = offset_of!(Self, name);
    pub const OFFSET_OF_SHAPE: usize = offset_of!(Self, shape);
    pub const OFFSET_OF_EPOCH_AND_RESULT: usize = offset_of!(Self, epoch_and_result);

    pub(super) fn clear(&self) {
        // SAFETY: what that goes by changes only while it is clear.
        unsafe { self.name.clear(self.counts_name()) };
    }

    fn counts_name(&self) -> bool {
        self.epoch_and_result.get() & 1 == 0
    }
}

#[inline(always)]
fn look_up(vm: &Vm, shape: ShapeId, name: PropertyName<'_>) -> Option<bool> {
    let entry = (vm.lookup_tables().has_own_property).at(primary_hash(shape, name));
    let result = entry.epoch_and_result.get() ^ vm.prototype_chain_epoch() << 1;
    (entry.shape.get() == shape && entry.name.is(name) && result <= 1).then_some(result != 0)
}

/// HasOwnProperty
#[inline]
pub fn has_own_property(cx: &mut Cx, object: &JsObject, name: PropertyName<'_>) -> JsResult<bool> {
    match look_up(cx, object.shape_id(), name) {
        Some(result) => Ok(result),
        None => has_own_property_slow(cx, object, name),
    }
}

/// The same, if neither has to be converted and the cache has the answer. It has none for what is no object.
#[inline(always)]
pub fn known_own_property(vm: &Vm, object: Value, key: Value) -> Option<bool> {
    let key = key.as_string().filter(|it| it.is_atom())?;
    let name = PropertyName::from_string(key.try_impl()?)?;
    look_up(vm, object.as_cell()?.shape_id(), name)
}

/// The same for any key, unless finding out could run a script or change a shape.
pub fn try_has_own_property(cx: &mut Cx, object: &JsObject, key: Value) -> Option<bool> {
    if let Some(index) = key.as_index_int32() {
        return object.try_has_own_index(index);
    }
    if key.is_object() {
        return None;
    }
    let answer = key.to_property_key(cx).and_then(|key| {
        let (name, shape) = (key.name(), object.shape());
        if let Some(index) = name.as_index() {
            return Ok(object.try_has_own_index(index));
        }
        let is_plain = super::is_looked_up_in_shape(object, name)
            && !(shape.has_non_reified_static_properties()
                && shape.find_static_property(name).is_some());
        is_plain
            .then(|| has_own_property(cx, object, name))
            .transpose()
    });
    answer
        .map_err(|it| cx.discard_unless_termination(it))
        .ok()?
}

#[inline(never)]
fn has_own_property_slow(cx: &mut Cx, object: &JsObject, name: PropertyName<'_>) -> JsResult<bool> {
    let mut slot = PropertySlot::new(object.as_value(), InternalMethod::GetOwnProperty);
    let result = object.get_own_property_slot(cx, name, &mut slot)?;
    let shape = object.shape();
    let follows_from_shape = if name.as_index().is_some() {
        object.cell_type() == CellType::FinalObject && !object.indexing_mode().has_elements()
    } else {
        super::is_looked_up_in_shape(object, name)
    };
    if follows_from_shape
        && shape.property_accesses_are_cacheable()
        && shape.absence_is_cacheable()
        && result == slot.cached_offset().is_valid()
    {
        let table = &cx.services.caches.tables_to_fill().has_own_property;
        let entry = table.at(primary_hash(shape.id(), name));
        entry.clear();
        entry.shape.set(shape.id());
        (entry.epoch_and_result).set(cx.prototype_chain_epoch() << 1 | u32::from(result));
        entry.name.set(name, entry.counts_name());
    }
    Ok(result)
}
