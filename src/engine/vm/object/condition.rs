//! Facts about particular objects that a cache of a lookup along a prototype chain depends on.

use core::cell::Cell;

use bun_engine_text::{Identifier, PropertyName};
use smallvec::{SmallVec, smallvec};

use crate::heap::Survivors;
use crate::{
    Attributes, CellType, DeferredFire, Gc, GcFree, JsCell, JsObject, PropertyOffset, ShapeFlags,
    ShapeId, TypeFlags, Value, Vm, Watcher, Watchpoint,
};

/// A value is kept as its bits.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConditionKind {
    Presence(PropertyOffset, Attributes),
    /// And code can replace the value without telling anybody.
    Replacement(PropertyOffset, Attributes),
    Absence {
        prototype: u64,
    },
    /// A store to an object that inherits from this one passes it by.
    AbsenceOfSetEffect {
        prototype: u64,
    },
    AbsenceOfElements {
        prototype: u64,
    },
    Equivalence {
        value: u64,
    },
    HasStaticProperty,
    HasPrototype {
        prototype: u64,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Watchability {
    MakeNoChanges,
    Ensure,
}

/// Does not keep the cells that it names alive. Whoever stores it drops it when `is_live` says so.
#[derive(Clone, PartialEq, Eq)]
pub struct PropertyCondition {
    object: usize,
    name: Identifier,
    kind: ConditionKind,
}

impl PropertyCondition {
    /// `None` if it does not hold.
    fn new(object: &JsObject, name: PropertyName<'_>, kind: ConditionKind) -> Option<Self> {
        let condition = PropertyCondition {
            object: object.address(),
            name: name.to_identifier(),
            kind,
        };
        condition.holds_for(object).then_some(condition)
    }

    pub fn presence(object: &JsObject, name: PropertyName<'_>) -> Option<PropertyCondition> {
        let (offset, attributes) = object.shape().get(name)?;
        Self::new(object, name, ConditionKind::Presence(offset, attributes))
    }

    /// Of a value that is being replaced like that already.
    pub(crate) fn replacement(object: &JsObject, name: PropertyName<'_>) -> Option<Self> {
        let shape = object.shape();
        let (offset, attributes) =
            (shape.get(name)).filter(|it| shape.is_replaced_silently(it.0))?;
        Self::new(object, name, ConditionKind::Replacement(offset, attributes))
    }

    pub fn absence(object: &JsObject, name: PropertyName<'_>) -> Option<PropertyCondition> {
        let prototype = object.prototype_direct().to_bits();
        Self::new(object, name, ConditionKind::Absence { prototype })
    }

    pub fn absence_of_set_effect(object: &JsObject, name: PropertyName<'_>) -> Option<Self> {
        let prototype = object.prototype_direct().to_bits();
        Self::new(
            object,
            name,
            ConditionKind::AbsenceOfSetEffect { prototype },
        )
    }

    pub fn absence_of_elements(object: &JsObject) -> Option<PropertyCondition> {
        let prototype = object.prototype_direct().to_bits();
        let kind = ConditionKind::AbsenceOfElements { prototype };
        Self::new(object, PropertyName::EMPTY, kind)
    }

    pub fn equivalence(object: &JsObject, name: PropertyName<'_>) -> Option<PropertyCondition> {
        let value = object.get_direct(name)?.to_bits();
        Self::new(object, name, ConditionKind::Equivalence { value })
    }

    pub fn has_static_property(object: &JsObject, name: PropertyName<'_>) -> Option<Self> {
        Self::new(object, name, ConditionKind::HasStaticProperty)
    }

    pub fn has_prototype(object: &JsObject) -> Option<PropertyCondition> {
        let prototype = object.prototype_direct().to_bits();
        let kind = ConditionKind::HasPrototype { prototype };
        Self::new(object, PropertyName::EMPTY, kind)
    }

    pub fn kind(&self) -> ConditionKind {
        self.kind
    }

    pub fn name(&self) -> PropertyName<'_> {
        self.name.name()
    }

    /// # Safety
    /// No collection has ended since the condition was made, except with `is_live` true. So for all that follow.
    pub unsafe fn object(&self) -> Gc<JsObject> {
        // SAFETY: the caller's.
        unsafe { Gc::from_address(self.object) }
    }

    pub fn is_live(&self, survivors: &Survivors) -> bool {
        let value = match self.kind {
            ConditionKind::Absence { prototype }
            | ConditionKind::AbsenceOfSetEffect { prototype }
            | ConditionKind::AbsenceOfElements { prototype }
            | ConditionKind::HasPrototype { prototype } => prototype,
            ConditionKind::Equivalence { value } => value,
            _ => Value::NULL.to_bits(),
        };
        // SAFETY: nothing has been swept yet, and only the addresses are looked at.
        unsafe {
            survivors.contains(self.object()) && survivors.contains_value(Value::from_bits(value))
        }
    }

    fn holds_for(&self, object: &JsObject) -> bool {
        let (shape, name) = (object.shape(), self.name());
        let has_prototype = |prototype| shape.prototype().to_bits() == prototype;
        if let ConditionKind::HasPrototype { prototype } = self.kind {
            return has_prototype(prototype)
                && !shape.type_flags().intersects(
                    TypeFlags::PROHIBITS_PROPERTY_CACHING | TypeFlags::OVERRIDES_GET_PROTOTYPE,
                );
        }
        if !shape.property_accesses_are_cacheable() {
            return false;
        }
        let static_property = || {
            shape
                .has_non_reified_static_properties()
                .then(|| shape.find_static_property(name))
                .flatten()
        };
        match self.kind {
            ConditionKind::Presence(offset, attributes)
            | ConditionKind::Replacement(offset, attributes) => {
                shape.get(name) == Some((offset, attributes))
            }
            ConditionKind::Absence { prototype } => {
                shape.absence_is_cacheable()
                    && has_prototype(prototype)
                    && shape.get(name).is_none()
                    && static_property().is_none()
            }
            ConditionKind::AbsenceOfSetEffect { prototype } => {
                let attributes = match shape.get(name) {
                    Some((_, attributes)) => attributes,
                    None => static_property().map_or_default(|(_, entry)| entry.attributes()),
                };
                !shape.is_dictionary()
                    && has_prototype(prototype)
                    && shape.stores_ordinarily(name)
                    && !attributes.intersects(Attributes::READ_ONLY | Attributes::ANY_ACCESSOR)
            }
            ConditionKind::AbsenceOfElements { prototype } => {
                has_prototype(prototype)
                    && !shape.instance_indexing_mode().has_elements()
                    && !shape.may_intercept_indexed_access()
            }
            ConditionKind::Equivalence { value } => object
                .get_direct(name)
                .is_some_and(|current| current.to_bits() == value),
            ConditionKind::HasStaticProperty => {
                !shape.is_dictionary() && shape.get(name).is_none() && static_property().is_some()
            }
            ConditionKind::HasPrototype { .. } => unreachable!(),
        }
    }

    /// # Safety
    /// See `object`.
    pub unsafe fn holds(&self) -> bool {
        // SAFETY: the caller's.
        self.holds_for(&*unsafe { self.object() })
    }

    /// Whether it holds and cannot stop doing so unnoticed.
    ///
    /// # Safety
    /// See `object`.
    pub unsafe fn is_watchable(&self, effort: Watchability) -> bool {
        // SAFETY: the caller's.
        let object = unsafe { self.object() };
        let shape = object.shape();
        if !shape.transition_watchpoints().is_still_valid() || !self.holds_for(&object) {
            return false;
        }
        match (self.kind, effort) {
            (ConditionKind::Equivalence { .. }, _) => {
                let set = shape.get(self.name()).and_then(|(offset, _)| match effort {
                    Watchability::MakeNoChanges => shape.replacement_watchpoints(offset),
                    Watchability::Ensure => shape.ensure_replacement_watchpoints(offset),
                });
                set.is_some_and(|set| set.is_still_valid())
            }
            (ConditionKind::Replacement(offset, _), Watchability::MakeNoChanges) => {
                shape.is_replaced_silently(offset)
            }
            (ConditionKind::Replacement(offset, _), Watchability::Ensure) => {
                shape.try_to_cache_property_replacement(offset)
            }
            _ => true,
        }
    }

    /// # Safety
    /// See `object`. It is watchable.
    unsafe fn install(&self, watchpoint: &Watchpoint) -> ShapeId {
        // SAFETY: the caller's.
        let shape = unsafe { self.object() }.shape();
        shape.transition_watchpoints().add(watchpoint);
        if let ConditionKind::Equivalence { .. } = self.kind
            && let Some((offset, _)) = shape.get(self.name())
            && let Some(set) = shape.replacement_watchpoints(offset)
        {
            set.add(watchpoint);
        }
        shape.id()
    }
}

/// Follows the object from shape to shape for as long as the condition stays watchable.
struct AdaptiveWatcher<F> {
    condition: PropertyCondition,
    /// None once it has given up.
    installed_on: Cell<ShapeId>,
    on_broken: F,
}

impl<F: Fn(&Vm, Gc<JsCell>) + GcFree> Watcher for AdaptiveWatcher<F> {
    fn fire(&self, vm: &Vm, owner: Gc<JsCell>, this: &Watchpoint) {
        if self.installed_on.get().is_none() {
            return;
        }
        // SAFETY: promised to `watch_condition`.
        unsafe {
            if !self.condition.is_watchable(Watchability::Ensure) {
                self.installed_on.set(ShapeId::NONE);
                (self.on_broken)(vm, owner);
            } else if self.condition.object().shape_id() != self.installed_on.get() {
                self.installed_on.set(self.condition.install(this));
            }
        }
    }
}

/// `None` if the condition is not watchable.
///
/// # Safety
/// The watchpoint is dropped no later than when `owner` is destroyed or a collection ends with `is_live` false.
pub unsafe fn watch_condition(
    owner: &JsCell,
    condition: &PropertyCondition,
    on_broken: impl Fn(&Vm, Gc<JsCell>) + GcFree + 'static,
) -> Option<Watchpoint> {
    // SAFETY: the caller's.
    unsafe {
        if !condition.is_watchable(Watchability::Ensure) {
            return None;
        }
        let watcher = AdaptiveWatcher {
            condition: condition.clone(),
            installed_on: Cell::new(condition.object().shape_id()),
            on_broken,
        };
        let watchpoint = Watchpoint::new(owner, watcher);
        condition.install(&watchpoint);
        Some(watchpoint)
    }
}

/// One condition for each prototype that a lookup passes. The shape of the receiver is for the cache to check.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct ConditionSet(SmallVec<[PropertyCondition; 2]>);

impl core::ops::Deref for ConditionSet {
    type Target = [PropertyCondition];

    fn deref(&self) -> &[PropertyCondition] {
        &self.0
    }
}

impl From<PropertyCondition> for ConditionSet {
    fn from(condition: PropertyCondition) -> ConditionSet {
        ConditionSet(smallvec![condition])
    }
}

impl ConditionSet {
    /// Up to `holder`, or to the end of the chain. Flattens dictionaries on the way, once each.
    fn generate(
        vm: &Vm,
        first: Option<Gc<JsObject>>,
        holder: Option<Gc<JsObject>>,
        condition: impl Fn(&JsObject) -> Option<PropertyCondition>,
    ) -> Option<ConditionSet> {
        let mut conditions = SmallVec::new();
        for object in first.into_iter().flat_map(|first| first.chain_direct()) {
            if matches!(
                object.cell_type(),
                CellType::Proxy | CellType::GlobalProxy | CellType::GlobalObject
            ) || object.overrides_get_prototype()
                || !object.try_flatten_for_caching(vm)
            {
                return None;
            }
            object.ensure_watchable_shape(vm);
            conditions.push(condition(&object)?);
            if Some(object) == holder {
                return Some(ConditionSet(conditions));
            }
        }
        holder.is_none().then_some(ConditionSet(conditions))
    }

    pub fn for_hit(
        vm: &Vm,
        first: Option<Gc<JsObject>>,
        holder: Gc<JsObject>,
        name: PropertyName<'_>,
    ) -> Option<ConditionSet> {
        Self::generate(vm, first, Some(holder), |object| {
            if !holder.is_same(object) {
                PropertyCondition::absence(object, name)
            } else {
                PropertyCondition::presence(object, name)
                    .or_else(|| PropertyCondition::has_static_property(object, name))
            }
        })
    }

    pub fn for_equivalent_hit(
        vm: &Vm,
        first: Option<Gc<JsObject>>,
        holder: Gc<JsObject>,
        name: PropertyName<'_>,
    ) -> Option<ConditionSet> {
        Self::generate(vm, first, Some(holder), |object| {
            if holder.is_same(object) {
                PropertyCondition::equivalence(object, name)
            } else {
                PropertyCondition::absence(object, name)
            }
        })
    }

    pub fn for_miss(
        vm: &Vm,
        first: Option<Gc<JsObject>>,
        name: PropertyName<'_>,
    ) -> Option<ConditionSet> {
        Self::generate(vm, first, None, |object| {
            PropertyCondition::absence(object, name)
        })
    }

    pub fn for_setter_miss(
        vm: &Vm,
        first: Option<Gc<JsObject>>,
        name: PropertyName<'_>,
    ) -> Option<ConditionSet> {
        Self::generate(vm, first, None, |object| {
            PropertyCondition::absence_of_set_effect(object, name)
        })
    }

    /// The links of the chain before `prototype`, or all of them if it is not on it.
    pub fn for_instanceof(vm: &Vm, first: Gc<JsObject>, prototype: Gc<JsObject>) -> Option<Self> {
        if first == prototype {
            return Some(ConditionSet::default());
        }
        let last = first
            .chain_direct()
            .find(|it| it.prototype_object_direct() == Some(prototype));
        Self::generate(vm, Some(first), last, PropertyCondition::has_prototype)
    }

    pub fn is_live(&self, survivors: &Survivors) -> bool {
        self.iter().all(|condition| condition.is_live(survivors))
    }

    /// # Safety
    /// See `PropertyCondition::object`.
    pub unsafe fn is_watchable(&self, effort: Watchability) -> bool {
        // SAFETY: the caller's.
        self.iter().all(|it| unsafe { it.is_watchable(effort) })
    }

    /// # Safety
    /// As for `watch_condition`.
    pub unsafe fn watch(
        &self,
        owner: &JsCell,
        on_broken: impl Fn(&Vm, Gc<JsCell>) + GcFree + Clone + 'static,
    ) -> Option<SmallVec<[Watchpoint; 2]>> {
        self.iter()
            // SAFETY: the caller's.
            .map(|it| unsafe { watch_condition(owner, it, on_broken.clone()) })
            .collect()
    }
}

impl JsObject {
    /// Gives the object a shape of its own if other objects have left the one that it has. It is no dictionary.
    pub fn ensure_watchable_shape(&self, vm: &Vm) {
        let shape = self.shape();
        if !shape.transition_watchpoints().is_still_valid() {
            let mut deferred = DeferredFire::new(vm);
            // SAFETY: the same slots and elements.
            unsafe { self.set_shape(&shape.clone_for_watching(vm, &mut deferred)) };
        }
    }

    /// Makes the caches miss that go by the shape.
    pub(crate) fn change_shape_id(&self, vm: &Vm) {
        let (shape, mut deferred) = (self.shape(), DeferredFire::new(vm));
        let new = if shape.is_dictionary() {
            shape.to_dictionary(vm, shape.flags() & ShapeFlags::DICTIONARY, &mut deferred)
        } else {
            shape.clone_for_watching(vm, &mut deferred)
        };
        // SAFETY: the same slots and elements.
        unsafe { self.set_shape(&new) };
    }

    /// From now on no other object has its shape.
    pub(crate) fn claim_shape(&self, vm: &Vm) {
        if !self.shape().has(ShapeFlags::IS_CLAIMED) {
            self.change_shape_id(vm);
            self.shape().set_flags(ShapeFlags::IS_CLAIMED);
        }
    }

    /// False if it stays a dictionary, having gone back to being one before.
    pub fn try_flatten_for_caching(&self, vm: &Vm) -> bool {
        let shape = self.shape();
        if !shape.is_dictionary() {
            return true;
        }
        if shape.has(ShapeFlags::HAS_BEEN_FLATTENED) {
            return false;
        }
        self.flatten_dictionary(vm);
        true
    }
}
