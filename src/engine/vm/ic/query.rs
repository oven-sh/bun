use bun_engine_text::{PropertyName, names};

use super::cases::{NoCase, Overflow};
use super::load::{Reach, case_for_proxy, lookup_beyond, place_of, prepare};
use super::{AccessCase, AccessCases, AccessKind, Key, PrototypeLookup, slot_at};
use crate::caches::{has_megamorphic, has_private_megamorphic};
use crate::{
    CellType, CodeBlock, Cx, DeleteKind, DeletePropertySlot, Gc, GlobalProxy, InternalMethod,
    JsObject, JsResult, PropertySlot, ProxyObject, Shape, ShapeFlags, Value, errors,
};

fn plan_has(
    cx: &Cx,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
    slot: &PropertySlot,
    reach: Reach,
) -> Result<AccessCase, NoCase> {
    if object.is::<ProxyObject>() && !name.is_private() {
        cx.private_proxy_has();
        return Ok(case_for_proxy(cx, AccessKind::ProxyHas, &object, name));
    }
    if name == names::length && object.cell_type() == CellType::Array {
        return Ok(AccessCase::new(AccessKind::HasOwn, object.shape_id()).with_answer(true));
    }
    if !slot.is_cacheable() || name.as_index().is_some() {
        return Err(NoCase::Uncacheable);
    }
    if let Some(proxy) = object.downcast::<GlobalProxy>()
        && reach == Reach::Chain
    {
        let case = plan_has(cx, proxy.target().upcast(), name, slot, reach)?;
        return Ok(case.through_global_proxy(proxy.shape_id()));
    }
    if slot.base() == Some(object) {
        prepare(cx, &object, !slot.cached_offset().is_valid())?;
        return Ok(AccessCase::new(AccessKind::HasOwn, object.shape_id()).with_answer(true));
    }
    let lookup = if reach == Reach::Own {
        prepare(cx, &object, true)?;
        PrototypeLookup::of_empty_chain(cx)
    } else {
        lookup_beyond(cx, object.into(), name, place_of(slot))?
    };
    let kind = if slot.is_unset() {
        AccessKind::HasNot
    } else {
        AccessKind::HasInherited
    };
    let case = AccessCase::new(kind, object.shape_id()).with_lookup(lookup);
    Ok(case.with_answer(!slot.is_unset()))
}

/// HasProperty or, for a private element, whether the object itself has it.
#[inline]
pub fn has_by_key(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
    key: Key,
) -> JsResult<bool> {
    let is_private_element = name.is_private_element();
    if cases.is_megamorphic() {
        if is_private_element {
            return Ok(has_private_megamorphic(cx, object, name));
        }
        return has_megamorphic(cx, object, name);
    }
    // SAFETY: not looked at after the call.
    if let Some(list) = unsafe { cases.list() }
        && let Some(case) = list.find_by_name(object.shape_id(), name, key)
    {
        if let Some(answer) = case.renewed_answer(cx) {
            return Ok(answer.is_true());
        }
        if case.kind() == AccessKind::ProxyHas {
            return object.has_property(cx, name);
        }
        if case.kind() == AccessKind::ThroughGlobalProxy
            && object.cast::<GlobalProxy>().target().shape_id() == case.new_shape()
            && let Some(answer) = case.for_target().answer()
        {
            return Ok(answer.is_true());
        }
    }
    let mut slot = PropertySlot::new(object.into(), InternalMethod::HasProperty);
    let (found, reach) = if is_private_element {
        let found = object.get_own_non_index_property_slot(cx, name, &mut slot)?;
        (found, Reach::Own)
    } else {
        (object.get_property_slot(cx, name, &mut slot)?, Reach::Chain)
    };
    if cases.should_cache_in_list() {
        let plan = plan_has(cx, object, name, &slot, reach);
        cases.apply_by_key(cx, owner, &plan, name, key);
    }
    Ok(found)
}

fn plan_delete(
    cx: &Cx,
    object: Gc<JsObject>,
    old: Gc<Shape>,
    name: PropertyName<'_>,
    slot: &DeletePropertySlot,
    is_strict: bool,
) -> Result<AccessCase, NoCase> {
    if old.is_dictionary()
        || cx.deletes_unconfigurable_properties()
        || !old.property_accesses_are_cacheable()
        || old.has_non_reified_static_properties()
        || old.has(ShapeFlags::HAS_FOREIGN_METHODS)
    {
        return Err(NoCase::Uncacheable);
    }
    let case = match slot.cacheable_kind() {
        DeleteKind::Hit
            if !old.may_be_prototype()
                && old.instance_header() == object.shape().instance_header()
                && old.existing_remove_transition(name) == Some(object.shape()) =>
        {
            let offset = slot.cached_offset();
            old.did_cache_property_replacement(cx, offset);
            let case = AccessCase::new(AccessKind::Delete, old.id()).with_offset(offset);
            return Ok(case.with_new_shape(object.shape_id()));
        }
        DeleteKind::Miss if old.absence_is_cacheable() => {
            AccessCase::new(AccessKind::DeleteMissing, old.id()).with_answer(true)
        }
        DeleteKind::NonConfigurable if !is_strict => {
            AccessCase::new(AccessKind::DeleteNonConfigurable, old.id())
        }
        _ => return Err(NoCase::Uncacheable),
    };
    if object.shape() != old {
        return Err(NoCase::Retry);
    }
    Ok(case)
}

/// The `delete` operator.
#[inline]
pub fn delete_by_key(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
    key: Key,
    is_strict: bool,
) -> JsResult<bool> {
    // SAFETY: nothing is called while it is looked at.
    if let Some(list) = unsafe { cases.list() }
        && let Some(case) = list.find_by_name(object.shape_id(), name, key)
    {
        if let Some(answer) = case.renewed_answer(cx) {
            return Ok(answer.is_true());
        }
        if case.kind() == AccessKind::Delete {
            // SAFETY: the shapes have the same slots, and nothing is no cell.
            unsafe {
                object.set_shape_id_directly(case.new_shape());
                slot_at(&object, case.byte_offset()).set_without_barrier(None);
            }
            object.write_barrier_for_cell();
            return Ok(true);
        }
        if case.kind() == AccessKind::DeleteNonConfigurable
            && !cx.deletes_unconfigurable_properties()
        {
            return Ok(false);
        }
    }
    let (old, mut slot) = (object.shape(), DeletePropertySlot::default());
    let did_delete = object.delete_property(cx, name, &mut slot)?;
    if cases.should_cache_in_list() {
        let plan = plan_delete(cx, object, old, name, &slot, is_strict);
        let variable_key = (key == Key::Variable).then_some(name);
        cases.apply(cx, owner, &plan, variable_key, Overflow::Generic);
    }
    if !did_delete && is_strict {
        return Err(cx.throw_type_error(errors::UNABLE_TO_DELETE_PROPERTY));
    }
    Ok(did_delete)
}

/// Whether `prototype` is on the prototype chain of `value`. A megamorphic site walks along it.
#[inline]
pub fn instance_of(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    value: Value,
    prototype: Value,
) -> JsResult<bool> {
    let (Some(object), Some(wanted)) = (value.as_object(), prototype.as_object()) else {
        return JsObject::default_has_instance(cx, value, prototype);
    };
    let shape = object.shape();
    // SAFETY: as above.
    let case = unsafe { cases.list() }.and_then(|it| it.find(shape.id(), wanted.address()));
    if let Some(answer) = case.and_then(|it| it.renewed_answer(cx)) {
        return Ok(answer.is_true());
    }
    let answer = JsObject::default_has_instance(cx, value, prototype)?;
    if cases.should_cache_in_list() && object.shape() == shape {
        let lookup = match shape.prototype_object() {
            _ if object.overrides_get_prototype() => Err(NoCase::Uncacheable),
            Some(first) => PrototypeLookup::for_instanceof(cx, first, wanted, answer)
                .ok_or(NoCase::Unwatchable),
            None => Ok(PrototypeLookup::of_empty_chain(cx)),
        };
        let plan = lookup.map(|lookup| {
            AccessCase::new(AccessKind::Instanceof, shape.id())
                .with_lookup(lookup)
                .with_prototype(&wanted)
                .with_answer(answer)
        });
        cases.apply(cx, owner, &plan, None, Overflow::Megamorphic(None));
    }
    Ok(answer)
}
