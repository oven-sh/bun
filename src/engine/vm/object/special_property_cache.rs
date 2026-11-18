//! What the instances of a shape inherit for the properties that conversions look up.

use core::cell::{Cell, RefCell};

use bun_engine_text::{PropertyName, names, symbols};
use smallvec::SmallVec;

use crate::heap::Survivors;
use crate::{
    ConditionSet, Cx, Gc, InternalMethod, JsObject, JsResult, JsString, PropertySlot, Shape, Value,
    Vm, Watchpoint,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SpecialProperty {
    ToStringTag,
    ToString,
    ValueOf,
    ToPrimitive,
    ToJson,
}

impl SpecialProperty {
    const COUNT: usize = 5;

    pub fn name(self) -> PropertyName<'static> {
        match self {
            SpecialProperty::ToStringTag => symbols::toStringTag,
            SpecialProperty::ToString => names::toString,
            SpecialProperty::ValueOf => names::valueOf,
            SpecialProperty::ToPrimitive => symbols::toPrimitive,
            SpecialProperty::ToJson => names::toJSON,
        }
    }
}

const NOT_CACHED: u64 = 0;
const GAVE_UP: u64 = 4;

type Guards = (ConditionSet, SmallVec<[Watchpoint; 2]>);

#[derive(Default)]
pub(crate) struct SpecialPropertyCache {
    /// The holder keeps the value alive for as long as the conditions hold.
    values: [Cell<u64>; SpecialProperty::COUNT],
    guards: RefCell<[Option<Box<Guards>>; SpecialProperty::COUNT]>,
}

impl SpecialPropertyCache {
    pub(super) fn reconcile(&self, survivors: &Survivors) {
        for (value, guards) in self.values.iter().zip(&mut *self.guards.borrow_mut()) {
            if guards.take_if(|it| !it.0.is_live(survivors)).is_some() {
                value.set(NOT_CACHED);
            }
        }
    }
}

impl Shape {
    #[inline(always)]
    pub fn cached_special_property(&self, property: SpecialProperty) -> Option<Value> {
        let bits = self.rare_data()?.special_properties.values[property as usize].get();
        // SAFETY: cleared when the holder lets go of it or dies.
        (bits > GAVE_UP || bits == Value::NULL.to_bits()).then(|| unsafe { Value::from_bits(bits) })
    }

    #[inline]
    pub fn cached_tagged_string(&self) -> Option<Gc<JsString>> {
        self.cached_special_property(SpecialProperty::ToStringTag)?;
        self.rare_data()?.tagged_string.get()
    }

    pub(crate) fn cache_tagged_string(&self, tag: Value, string: Gc<JsString>) {
        if self.cached_special_property(SpecialProperty::ToStringTag) == Some(tag) {
            // SAFETY: the shape traces its rare data.
            unsafe { (self.ensure_rare_data().tagged_string).set(self, Some(string)) };
        }
    }

    fn cache_special_property(&self, vm: &Vm, property: SpecialProperty, slot: &PropertySlot) {
        let this = crate::anchor!(self);
        let cache = &this.ensure_rare_data().special_properties;
        let cached = &cache.values[property as usize];
        if cached.get() != NOT_CACHED {
            return;
        }
        cached.set(GAVE_UP);
        let (first, name) = (self.prototype_object(), property.name());
        let (conditions, value) = match (slot.base(), slot.plain_value()) {
            (Some(holder), Some(value)) if slot.is_cacheable() => (
                ConditionSet::for_equivalent_hit(vm, first, holder, name),
                value,
            ),
            _ if slot.is_unset() && !slot.is_tainted_by_opaque_object() => {
                (ConditionSet::for_miss(vm, first, name), Value::UNDEFINED)
            }
            _ => return,
        };
        let Some(conditions) = conditions else { return };
        let clear = move |_: &Vm, owner: crate::Gc<crate::JsCell>| {
            if let Some(rare_data) = owner.cast::<Shape>().rare_data() {
                rare_data.special_properties.values[property as usize].set(NOT_CACHED);
            }
        };
        // SAFETY: the shape owns them, and `reconcile` drops them.
        let Some(watchpoints) = (unsafe { conditions.watch(self, clear) }) else {
            return;
        };
        cache.guards.borrow_mut()[property as usize] = Some(Box::new((conditions, watchpoints)));
        cached.set(value.to_bits());
        if property == SpecialProperty::ToStringTag {
            // SAFETY: no cell.
            unsafe { (self.ensure_rare_data().tagged_string).set_without_barrier(None) };
        }
        self.write_barrier_for_cell();
    }
}

impl JsObject {
    #[inline(always)]
    pub fn get_special_property(&self, cx: &mut Cx, property: SpecialProperty) -> JsResult<Value> {
        match self.shape().cached_special_property(property) {
            Some(value) => Ok(value),
            None => self.get_special_property_slow(cx, property),
        }
    }

    #[inline(never)]
    fn get_special_property_slow(&self, cx: &mut Cx, property: SpecialProperty) -> JsResult<Value> {
        let name = property.name();
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::Get);
        let found = self.get_non_index_property_slot(cx, name, &mut slot)?;
        let shape = self.shape();
        if shape.property_accesses_are_cacheable()
            && shape.absence_is_cacheable()
            && !self.overrides_get_prototype()
            && slot.base() != Some(self.as_object())
        {
            shape.cache_special_property(cx, property, &slot);
        }
        if found {
            slot.value(cx, name)
        } else {
            Ok(Value::UNDEFINED)
        }
    }
}
