//! The case for a shape that a site has not seen, or does not remember. Finding it changes no object and fires nothing.

use bun_engine_text::{PropertyName, names};

use super::{AccessCase, AccessKind, PrototypeLookup, StoreMode};
use crate::{Attributes, CellType, Gc, GetterSetter, Intrinsic, JsFunction, JsObject, Shape};
use crate::{TypeFlags, Vm};

fn tells_about(shape: &Shape, name: PropertyName<'_>) -> bool {
    let is_in_static_table =
        || shape.has_non_reified_static_properties() && shape.find_static_property(name).is_some();
    !shape.is_dictionary()
        && shape.property_accesses_are_cacheable()
        && (!(shape.type_flags()).contains(TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT)
            || shape.is_ordinary_name(name))
        && (shape.get(name).is_some() || !is_in_static_table())
}

fn passes_on(shape: &Shape) -> bool {
    shape.absence_is_cacheable()
        && !(shape.type_flags()).contains(TypeFlags::OVERRIDES_GET_PROTOTYPE)
}

fn can_be_watched(object: &JsObject) -> bool {
    let shape = object.shape();
    !shape.is_dictionary() && shape.transition_watchpoints().is_still_valid()
}

/// The inner `None` stands for a property that is not there.
fn find_inherited(
    first: Option<Gc<JsObject>>,
    name: PropertyName<'_>,
) -> Option<Option<(Gc<JsObject>, Attributes)>> {
    for object in first.into_iter().flat_map(|first| first.chain_direct()) {
        let shape = object.shape();
        if !can_be_watched(&object) || !tells_about(&shape, name) {
            return None;
        }
        if let Some((_, attributes)) = shape.get(name) {
            return Some(Some((object, attributes)));
        }
    }
    Some(None)
}

/// What the library does in a getter can have a case of its own, which depends on the object.
fn has_ordinary_getter(lookup: &PrototypeLookup) -> bool {
    let accessor = lookup
        .constant()
        .and_then(|it| it.downcast::<GetterSetter>());
    let getter = accessor.and_then(|it| it.getter()?.downcast::<JsFunction>());
    getter.is_some_and(|it| it.intrinsic() == Intrinsic::None)
}

impl AccessCase {
    /// `[[Get]]` of an object, which is the receiver too.
    pub fn for_load(vm: &Vm, shape: Gc<Shape>, name: PropertyName<'_>) -> Option<AccessCase> {
        if !shape.instance_type().is_object()
            || name.as_index().is_some()
            || name.is_private()
            || !tells_about(&shape, name)
        {
            return None;
        }
        let case = |kind| AccessCase::new(kind, shape.id());
        if let Some((offset, attributes)) = shape.get(name) {
            let kind = if attributes.contains(Attributes::ACCESSOR) {
                AccessKind::CallOwnGetter
            } else {
                AccessKind::LoadOwn
            };
            return (!attributes.intersects(Attributes::CUSTOM))
                .then(|| case(kind).with_offset(offset));
        }
        let first = shape.prototype_object();
        let found = find_inherited(first, name).filter(|_| passes_on(&shape))?;
        let lookup = match found {
            Some((holder, _)) => PrototypeLookup::for_hit(vm, first?, holder, name),
            None => PrototypeLookup::for_miss(vm, first, name),
        }?;
        let attributes = found.map_or_default(|it| it.1);
        let case = match lookup.constant() {
            _ if attributes.intersects(Attributes::CUSTOM) => return None,
            _ if attributes.contains(Attributes::ACCESSOR) => {
                has_ordinary_getter(&lookup).then(|| case(AccessKind::CallInheritedGetter))?
            }
            Some(value) => case(AccessKind::LoadConstant).with_answer(value),
            None => case(AccessKind::LoadInherited),
        };
        Some(case.with_lookup(lookup))
    }

    /// Only for plain objects. `TransitionAndGrow` comes without an allocator.
    pub fn for_store(
        vm: &Vm,
        shape: Gc<Shape>,
        name: PropertyName<'_>,
        mode: StoreMode,
    ) -> Option<AccessCase> {
        if shape.instance_type() != CellType::FinalObject
            || name.as_index().is_some()
            || name.is_private()
            || name == names::__proto__
            || !tells_about(&shape, name)
        {
            return None;
        }
        let case = |kind| AccessCase::new(kind, shape.id());
        let is_set = matches!(mode, StoreMode::Set { .. });
        if let Some((offset, attributes)) = shape.get(name) {
            let is_plain = if is_set {
                !attributes.intersects(Attributes::READ_ONLY | Attributes::ANY_ACCESSOR)
            } else {
                attributes.is_empty()
            };
            let watchpoints = shape.replacement_watchpoints(offset);
            if !is_plain || watchpoints.is_some_and(|it| it.is_still_valid()) {
                return None;
            }
            shape.did_cache_property_replacement(vm, offset);
            return Some(case(AccessKind::Replace).with_offset(offset));
        }
        let first = shape.prototype_object().filter(|_| is_set);
        let chain = || first.into_iter().flat_map(|it| it.chain_direct());
        if !chain().all(|it| can_be_watched(&it) && it.shape().stores_ordinarily(name)) {
            return None;
        }
        if let Some((holder, attributes)) = find_inherited(first, name)?
            && attributes.contains(Attributes::ACCESSOR)
        {
            let lookup = PrototypeLookup::for_hit(vm, first?, holder, name)?;
            return Some(case(AccessKind::CallInheritedSetter).with_lookup(lookup));
        }
        let new = shape.existing_add_transition(name, Attributes::NONE)?;
        if new.is_dictionary()
            || !shape.is_extensible()
            || shape.may_be_prototype()
            || shape.instance_header() != new.instance_header()
        {
            return None;
        }
        let lookup = PrototypeLookup::for_setter_miss(vm, first, name)?;
        let capacity = shape.out_of_line_capacity();
        let case = if capacity == new.out_of_line_capacity() {
            case(AccessKind::Transition).with_offset(new.transition_offset())
        } else {
            case(AccessKind::TransitionAndGrow).with_growth(capacity.try_into().ok()?, None)
        };
        Some(case.with_new_shape(new.id()).with_lookup(lookup))
    }
}
