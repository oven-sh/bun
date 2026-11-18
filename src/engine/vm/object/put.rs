use bun_engine_text::{PropertyName, names};

use super::accessor::as_seen_by_scripts;
use super::get::{as_array_index, identifier_for_integer};
use super::static_table::StaticValue;
use crate::{
    Attributes, CellType, CustomGetterSetter, CustomSetter, Cx, DeferredFire, DeleteKind,
    DeletePropertySlot, Gc, GetterSetter, GlobalProxy, InternalMethod, JsObject, JsResult,
    PropertyDescriptor, PropertyOffset, PropertySlot, ProxyObject, PutContext, PutKind,
    PutPropertySlot, Shape, ShapeFlags, TransitionKind, TypeFlags, Value, Vm, errors,
};

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
enum PutMode {
    /// Respects what is read-only or not extensible, and keeps the attributes of an existing property.
    Put,
    Define,
}

fn call_custom_setter(
    cx: &mut Cx,
    setter: CustomSetter,
    holder: &JsObject,
    this: Value,
    value: Value,
    name: PropertyName<'_>,
) -> JsResult<bool> {
    let cx = cx.in_realm_of(holder);
    let result = setter(cx, this, value, name);
    cx.check_exception()?;
    Ok(result)
}

impl JsObject {
    #[inline(always)]
    pub fn ordinary_put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        if let Some(index) = name.as_index() {
            if !slot.is_receiver(self) {
                let (receiver, is_strict) = (slot.this_value(), slot.is_strict());
                return self.ordinary_set_slow(cx, name, value, receiver, is_strict);
            }
            return self.put_by_index(cx, index, value, slot.is_strict());
        }
        if !self.nothing_intercepts_put(name) {
            return self.put_slow(cx, name, value, slot);
        }
        if !slot.is_receiver(self) {
            return Self::define_property_on_receiver(cx, name, value, slot);
        }
        if self.shape().has_non_reified_static_properties() {
            return self.put_replacing_static_property(cx, name, value, slot);
        }
        self.put_fast(cx, name, value, slot)
    }

    #[inline(always)]
    pub(crate) fn nothing_intercepts_put(&self, name: PropertyName<'_>) -> bool {
        name != names::__proto__ && self.nothing_intercepts_put_except_to_proto()
    }

    #[inline(always)]
    pub(crate) fn nothing_intercepts_put_except_to_proto(&self) -> bool {
        let mut shape = self.shape();
        let mut intercepting = TypeFlags::OVERRIDES_GET_PROTOTYPE;
        loop {
            if shape.has(ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO)
                || shape.type_flags().intersects(intercepting)
            {
                return false;
            }
            match shape.prototype_object() {
                Some(prototype) => shape = prototype.shape(),
                None => return true,
            }
            intercepting |= TypeFlags::OVERRIDES_PUT;
        }
    }

    #[inline(always)]
    fn put_fast(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        match self.put_direct_internal::<{ PutMode::Put }>(cx, name, value, Attributes::NONE, slot)
        {
            Ok(()) => Ok(true),
            Err(message) => cx.reject(slot.is_strict(), message),
        }
    }

    #[inline(never)]
    fn put_slow(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        cx.check_stack()?;
        let mut holder = self.as_object();
        loop {
            let shape = holder.shape();
            if !holder.is_same(self) && shape.type_flags().contains(TypeFlags::OVERRIDES_PUT) {
                return holder.put(cx, name, value, slot);
            }
            if let Some((offset, attributes, setter)) = holder.find_for_put(cx, name)? {
                if attributes.contains(Attributes::READ_ONLY) {
                    return cx.reject(slot.is_strict(), errors::READ_ONLY_PROPERTY_WRITE);
                }
                if attributes.contains(Attributes::ACCESSOR) {
                    if !self.shape().is_uncacheable_dictionary() {
                        slot.set(PutKind::Setter, &holder, offset);
                    }
                    let accessor = holder.get_direct_at(offset).cast::<GetterSetter>();
                    return accessor.call_setter(cx, slot.this_value(), value, slot.is_strict());
                }
                if attributes.contains(Attributes::CUSTOM_ACCESSOR) {
                    let Some(setter) = setter else {
                        return Ok(false);
                    };
                    slot.set_custom(PutKind::CustomAccessor, &holder, offset, setter);
                    call_custom_setter(cx, setter, &holder, slot.this_value(), value, name)?;
                    return Ok(true);
                }
                if attributes.intersects(Attributes::CUSTOM_VALUE | Attributes::LAZY_VALUE)
                    && slot.is_receiver(&holder)
                {
                    if let Some(setter) = setter {
                        slot.set_custom(PutKind::CustomValue, &holder, offset, setter);
                        return call_custom_setter(cx, setter, &holder, holder.into(), value, name);
                    }
                    let attributes = attributes.for_shape() - Attributes::CUSTOM_VALUE;
                    holder.put_direct_with_slot(cx, name, value, attributes, slot);
                    return Ok(true);
                }
                break;
            }
            match holder.get_prototype_of(cx)?.as_object() {
                Some(prototype) => holder = prototype,
                None => break,
            }
        }
        if !slot.is_receiver(self) {
            return Self::define_property_on_receiver(cx, name, value, slot);
        }
        self.put_fast(cx, name, value, slot)
    }

    /// The offset is invalid for a property that is only in a static table.
    fn find_for_put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<Option<(PropertyOffset, Attributes, Option<CustomSetter>)>> {
        let shape = self.shape();
        if let Some((offset, attributes)) = shape.get(name) {
            let setter = if attributes.intersects(Attributes::CUSTOM) {
                let custom = self.get_direct_at(offset).downcast::<CustomGetterSetter>();
                custom.and_then(|custom| custom.setter())
            } else {
                None
            };
            return Ok(Some((offset, attributes, setter)));
        }
        if !shape.has_non_reified_static_properties() {
            return Ok(None);
        }
        let Some((table, entry)) = shape.find_static_property(name) else {
            return Ok(None);
        };
        if entry.attributes().contains(Attributes::ACCESSOR) {
            self.reify_static_property(cx, table, entry, name)?;
            let found = self.shape().get(name);
            return Ok(found.map(|(offset, attributes)| (offset, attributes, None)));
        }
        let setter = match entry.value() {
            StaticValue::Custom { setter, .. } => setter,
            _ => None,
        };
        Ok(Some((PropertyOffset::INVALID, entry.attributes(), setter)))
    }

    #[inline(never)]
    fn put_replacing_static_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        let shape = self.shape();
        if shape.get(name).is_none()
            && let Some((_, entry)) = shape.find_static_property(name)
        {
            let attributes = entry.attributes();
            if attributes.intersects(Attributes::REJECTS_PLAIN_STORE) {
                return cx.reject(slot.is_strict(), errors::READ_ONLY_PROPERTY_WRITE);
            }
            if let StaticValue::Custom {
                setter: Some(setter),
                ..
            } = entry.value()
            {
                return call_custom_setter(cx, setter, self, self.as_value(), value, name);
            }
            let attributes = attributes.for_shape() - Attributes::CUSTOM_VALUE;
            self.put_direct_with_slot(cx, name, value, attributes, slot);
            return Ok(true);
        }
        self.put_fast(cx, name, value, slot)
    }

    /// The end of OrdinarySetWithOwnDescriptor, for a receiver that is not where the lookup began. The name is no index.
    #[inline(never)]
    pub fn define_property_on_receiver(
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        let Some(original) = slot.this_value().as_object() else {
            return cx.reject(slot.is_strict(), errors::READ_ONLY_PROPERTY_WRITE);
        };
        let (receiver, is_proxy) = (
            original.where_definitions_go(cx),
            original.is::<ProxyObject>(),
        );
        let shape = receiver.shape();
        let takes_plain_stores = receiver.cell_type() == CellType::FinalObject
            && !shape.has(ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO);
        let may_be_exotic = is_proxy
            || slot.is_tainted_by_opaque_object()
            || !shape.class().has_ordinary_define_own_property();
        let is_well_known = matches!(
            receiver.cell_type(),
            CellType::Array | CellType::DerivedArray | CellType::Function | CellType::ErrorInstance
        );
        let is_custom = |found: (_, Attributes)| found.1.contains(Attributes::CUSTOM_VALUE);
        if takes_plain_stores
            || !((may_be_exotic && !(is_well_known && shape.is_ordinary_name(name)))
                || (shape.has(ShapeFlags::HAS_ANY_ACCESSOR)
                    && shape.get(name).is_some_and(is_custom)))
        {
            if !shape.has_non_reified_static_properties() {
                return receiver.put_fast(cx, name, value, slot);
            }
            if !is_proxy {
                return receiver.put_replacing_static_property(cx, name, value, slot);
            }
        }
        let should_throw = slot.is_strict();
        let mut own = PropertySlot::new(receiver.into(), InternalMethod::GetOwnProperty);
        let found = receiver.get_own_property_slot(cx, name, &mut own)?;
        let definer = if original.where_definitions_go(cx) == receiver {
            receiver
        } else {
            original
        };
        if !found {
            return definer.create_data_property(cx, name, value, should_throw);
        }
        if own.attributes().intersects(Attributes::REJECTS_PLAIN_STORE) {
            return cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE);
        }
        if let Some(setter) = own.custom_setter().filter(|_| !is_proxy) {
            return call_custom_setter(cx, setter, &receiver, receiver.into(), value, name);
        }
        let descriptor = PropertyDescriptor::value_only(value);
        definer.define_own_property(cx, name, &descriptor, should_throw)
    }

    /// Behind the proxies that have no say in it, until a script runs.
    fn where_definitions_go(&self, vm: &Vm) -> Gc<JsObject> {
        let mut object = self.as_object();
        while let Some(proxy) = object.downcast::<ProxyObject>()
            && proxy.forwards_definitions(vm)
        {
            object = proxy.target();
        }
        match object.downcast::<GlobalProxy>() {
            Some(proxy) => proxy.target().upcast(),
            None => object,
        }
    }

    /// OrdinarySet, to the letter.
    pub fn ordinary_set_slow(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        receiver: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        let own = if self.cell_type() == CellType::Proxy {
            None
        } else {
            self.get_own_property_descriptor(cx, name)?
        };
        self.ordinary_set_with_own_descriptor(cx, name, value, receiver, own, should_throw)
    }

    pub fn ordinary_set_with_own_descriptor(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        receiver: Value,
        mut own: Option<PropertyDescriptor>,
        should_throw: bool,
    ) -> JsResult<bool> {
        let mut current = self.as_object();
        let descriptor = loop {
            let is_first = current.is_same(self);
            let cell_type = current.cell_type();
            if cell_type == CellType::Proxy
                || (!is_first
                    && (CellType::TYPED_ARRAYS.contains(cell_type)
                        || cell_type == CellType::ModuleNamespaceObject))
            {
                let mut slot = PutPropertySlot::new(receiver, should_throw);
                return current.put(cx, name, value, &mut slot);
            }
            if !is_first {
                own = current.get_own_property_descriptor(cx, name)?;
            }
            if let Some(descriptor) = own {
                break descriptor;
            }
            match current.get_prototype_of(cx)?.as_object() {
                Some(prototype) => current = prototype,
                None => break PropertyDescriptor::data(Value::UNDEFINED, Attributes::NONE),
            }
        };
        if descriptor.is_accessor() {
            return match descriptor.setter_object() {
                Some(setter) => {
                    (cx.call(setter.into(), as_seen_by_scripts(receiver), &[value])).map(|_| true)
                }
                None => cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE),
            };
        }
        let (true, Some(receiver)) = (descriptor.writable(), receiver.as_object()) else {
            return cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE);
        };
        let descriptor = match receiver.get_own_property_descriptor(cx, name)? {
            Some(existing) if !existing.writable() => {
                return cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE);
            }
            Some(_) => PropertyDescriptor::value_only(value),
            None => PropertyDescriptor::data(value, Attributes::NONE),
        };
        receiver.define_own_property(cx, name, &descriptor, should_throw)
    }

    /// The name is no index.
    #[inline(always)]
    fn put_direct_internal<const MODE: PutMode>(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
        slot: &mut PutPropertySlot,
    ) -> Result<(), &'static str> {
        debug_assert!(name.as_index().is_none());
        self.ensure_writable_elements(vm);
        let shape = self.shape();
        if (MODE == PutMode::Define || shape.is_extensible())
            && let Some(target) = shape.existing_add_transition(name, attributes)
        {
            self.add_with_transition(vm, &shape, &target, target.transition_offset(), value);
            slot.set(PutKind::NewProperty, self, target.transition_offset());
            return Ok(());
        }
        let Some((offset, current)) = shape.get(name) else {
            if !shape.is_extensible() && (MODE == PutMode::Put || !self.cell_type().has_storage()) {
                return Err(errors::NON_EXTENSIBLE_DEFINE);
            }
            let offset = self.add_new_property(vm, name, value, attributes, slot.context());
            slot.set(PutKind::NewProperty, self, offset);
            return Ok(());
        };
        if MODE == PutMode::Put && current.intersects(Attributes::REJECTS_PLAIN_STORE) {
            return Err(errors::READ_ONLY_PROPERTY_CHANGE);
        }
        shape.did_replace_property(vm, offset);
        if MODE == PutMode::Define
            && (attributes != current || attributes.intersects(Attributes::ANY_ACCESSOR))
        {
            self.change_attributes(vm, name, offset, value, attributes);
        } else {
            // SAFETY: from the shape.
            unsafe { self.put_direct_unchecked(offset, value) };
            slot.set(PutKind::ExistingProperty, self, offset);
        }
        Ok(())
    }

    #[inline(always)]
    fn add_with_transition(
        &self,
        vm: &Vm,
        old: &Shape,
        new: &Shape,
        offset: PropertyOffset,
        value: Value,
    ) {
        let (old_capacity, new_capacity) = (old.out_of_line_capacity(), new.out_of_line_capacity());
        // SAFETY: there is room for the slot that `new` adds, and `set_shape` has the barrier.
        unsafe {
            if old_capacity != new_capacity {
                let storage = self.storage_with_more_slots(vm, old_capacity, new_capacity);
                self.nuke_shape_and_set_storage(storage, false);
            }
            self.slot_unchecked(offset).set_without_barrier(Some(value));
            self.set_shape(new);
        }
        self.did_change_as_prototype(vm, new);
    }

    #[inline(never)]
    fn add_new_property(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
        context: PutContext,
    ) -> PropertyOffset {
        let shape = self.shape();
        if shape.is_dictionary() {
            // SAFETY: a dictionary has one instance.
            return unsafe { self.put_direct_without_transition(vm, name, value, attributes) };
        }
        let mut deferred = DeferredFire::new(vm);
        let (target, offset) =
            shape.add_new_property_transition(vm, name, attributes, context, &mut deferred);
        self.add_with_transition(vm, &shape, &target, offset, value);
        offset
    }

    #[inline(never)]
    fn change_attributes(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        offset: PropertyOffset,
        value: Value,
        attributes: Attributes,
    ) {
        let mut deferred = DeferredFire::new(vm);
        let shape = self.shape();
        let shape = shape.change_attributes_transition(vm, name, attributes, &mut deferred);
        // SAFETY: the same slots.
        unsafe {
            self.put_direct_unchecked(offset, value);
            self.set_shape(&shape);
        }
        self.did_change_as_prototype(vm, &shape);
    }

    /// # Safety
    /// No other object has the shape, no cache relies on its not having the property, and it does not have it.
    pub unsafe fn put_direct_without_transition(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
    ) -> PropertyOffset {
        if !self.cell_type().has_storage() {
            return PropertyOffset::INVALID;
        }
        // SAFETY: the caller's.
        let offset = unsafe { self.add_property_in_place(vm, name, value, attributes) };
        self.did_change_as_prototype(vm, &self.shape());
        offset
    }

    /// # Safety
    /// As above, and that goes for the caches of lookups along prototype chains too.
    pub(super) unsafe fn add_property_in_place(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
    ) -> PropertyOffset {
        let shape = self.shape();
        let (old, offset) = (shape.max_offset(), shape.next_offset());
        let new = old.max(offset);
        let (old_capacity, new_capacity) = (old.out_of_line_capacity(), new.out_of_line_capacity());
        // First, because what runs at the end of a collection may look the name up.
        let storage = (old_capacity != new_capacity)
            .then(|| self.storage_with_more_slots(vm, old_capacity, new_capacity));
        shape.add_property_in_place(name, attributes);
        // SAFETY: the storage grows with the shape.
        unsafe {
            if let Some(storage) = storage {
                self.nuke_shape_and_set_storage(storage, false);
                shape.set_max_offset(new);
                self.set_shape(&shape);
                self.did_change_as_prototype(vm, &shape);
            } else {
                shape.set_max_offset(new);
            }
            self.put_direct_unchecked(offset, value);
        }
        offset
    }

    /// Defines an own data property whatever is there, if there is storage. Panics if the name is an index.
    #[inline]
    pub fn put_direct(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
    ) {
        let mut slot = PutPropertySlot::new(self.as_value(), false);
        self.put_direct_with_slot(vm, name, value, attributes, &mut slot);
    }

    #[inline(always)]
    pub fn put_direct_with_slot(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
        slot: &mut PutPropertySlot,
    ) {
        assert!(name.as_index().is_none() && !attributes.intersects(Attributes::ANY_ACCESSOR));
        let result =
            self.put_direct_internal::<{ PutMode::Define }>(vm, name, value, attributes, slot);
        debug_assert!(result.is_ok() || !self.cell_type().has_storage());
    }

    /// `value` is a `GetterSetter` or a `CustomGetterSetter` if the attributes say so.
    pub(crate) fn put_direct_stored(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
    ) {
        assert!(name.as_index().is_none());
        let slot = &mut PutPropertySlot::new(self.as_value(), false);
        let result =
            self.put_direct_internal::<{ PutMode::Define }>(vm, name, value, attributes, slot);
        debug_assert!(result.is_ok() || !self.cell_type().has_storage());
    }

    /// The kind of the property follows from what `value` is. Panics if the name is an index.
    pub fn put_direct_any(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
    ) {
        self.put_direct_stored(vm, name, value, attributes.for_stored(value));
    }

    /// Panics if the name is an index.
    pub fn put_direct_accessor(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        accessor: Gc<GetterSetter>,
        attributes: Attributes,
    ) {
        let attributes =
            (attributes | Attributes::ACCESSOR) - Attributes::READ_ONLY - Attributes::CUSTOM;
        self.put_direct_stored(vm, name, accessor.into(), attributes);
    }

    /// Panics if the name is an index.
    pub fn put_direct_custom(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        custom: Gc<CustomGetterSetter>,
        attributes: Attributes,
    ) {
        let mut attributes = attributes - Attributes::ACCESSOR;
        if !attributes.contains(Attributes::CUSTOM_ACCESSOR) {
            attributes |= Attributes::CUSTOM_VALUE;
        }
        self.put_direct_stored(vm, name, custom.into(), attributes);
    }

    /// Defines an own data property with default attributes whatever is there.
    pub fn put_direct_may_be_index(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
    ) -> JsResult<()> {
        match name.as_index() {
            Some(index) => self.put_direct_index(cx, index, value).map(|_| ()),
            None => {
                self.put_direct(cx, name, value, Attributes::NONE);
                Ok(())
            }
        }
    }

    /// Set(O, P, V, Throw)
    #[inline]
    pub fn set(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        let mut slot = PutPropertySlot::new(self.as_value(), should_throw);
        self.put(cx, name, value, &mut slot)
    }

    /// Set(O, ToString(index), V, Throw)
    #[inline(always)]
    pub fn set_index(
        &self,
        cx: &mut Cx,
        index: u64,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        let Some(index) = as_array_index(index) else {
            return self.set(
                cx,
                identifier_for_integer(index).name(),
                value,
                should_throw,
            );
        };
        if self.try_set_dense(cx, index, value) {
            return Ok(true);
        }
        self.put_by_index(cx, index, value, should_throw)
    }

    pub fn ordinary_delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        if let Some(index) = name.as_index() {
            return self.delete_property_by_index(cx, index);
        }
        let respects_configurable = !cx.deletes_unconfigurable_properties();
        if self.shape().has_non_reified_static_properties()
            && let Some(entry) = (self.class().ancestry())
                .find_map(|class| class.static_table()?.find_entry_or_position(name))
        {
            if !entry.attributes().is_configurable() && respects_configurable {
                return Ok(false);
            }
            self.reify_all_static_properties(cx)?;
        }
        let Some((offset, attributes)) = self.shape().get(name) else {
            slot.set(DeleteKind::Miss, PropertyOffset::INVALID);
            return Ok(true);
        };
        if !attributes.is_configurable() && respects_configurable {
            slot.set(DeleteKind::NonConfigurable, PropertyOffset::INVALID);
            return Ok(false);
        }
        let shape = self.shape();
        let mut deferred = DeferredFire::new(cx);
        // SAFETY: the shapes have the same slots, and nothing is no cell.
        unsafe {
            if shape.is_uncacheable_dictionary() {
                shape.remove_property_in_place(name);
            } else {
                self.set_shape(&shape.remove_property_transition(cx, name, &mut deferred));
                slot.set(DeleteKind::Hit, offset);
            }
            self.slot_unchecked(offset).set_without_barrier(None);
        }
        self.did_change_as_prototype(cx, &shape);
        Ok(true)
    }

    /// `[[Delete]]`
    pub fn delete(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
        self.delete_property(cx, name, &mut DeletePropertySlot::default())
    }

    pub fn delete_index(&self, cx: &mut Cx, index: u64) -> JsResult<bool> {
        match as_array_index(index) {
            Some(index) => self.delete_property_by_index(cx, index),
            None => self.delete(cx, identifier_for_integer(index).name()),
        }
    }

    /// DeletePropertyOrThrow
    pub fn delete_index_or_throw(&self, cx: &mut Cx, index: u64) -> JsResult<()> {
        if self.delete_index(cx, index)? {
            return Ok(());
        }
        Err(cx.throw_type_error(errors::UNABLE_TO_DELETE_PROPERTY))
    }

    /// Without any check. Does nothing unless `prototype` is an object or null.
    pub fn set_prototype_direct(&self, vm: &Vm, prototype: Value) {
        if !self.cell_type().has_storage() {
            return;
        }
        if let Some(object) = prototype.as_object() {
            object.did_become_prototype(vm);
            if self.indexing_mode().has_elements() || self.may_have_heirs_with_elements() {
                object.will_have_heirs_with_elements();
            }
        } else if !prototype.is_null() {
            return;
        }
        let did_intercept = self.chain_may_intercept_indexed_access();
        {
            let mut deferred = DeferredFire::new(vm);
            let shape = self.shape();
            let shape = shape.change_prototype_transition(vm, prototype, &mut deferred);
            // SAFETY: the same slots.
            unsafe { self.set_shape(&shape) };
            if shape.may_be_prototype() || self.cell_type() == CellType::GlobalObject {
                vm.invalidate_prototype_chain_caches();
            }
        }
        if !self.chain_may_intercept_indexed_access() {
            return;
        }
        if !did_intercept && self.may_have_heirs_with_elements() {
            self.intercept_indexed_access_of_heirs(vm);
        }
        let mode = self.indexing_mode();
        if mode.has_elements() && !mode.is_slow_put() {
            self.non_property_transition(vm, TransitionKind::SwitchToSlowPut);
        }
    }

    pub fn ordinary_set_prototype_of(
        &self,
        cx: &mut Cx,
        prototype: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        if self
            .shape()
            .type_flags()
            .contains(TypeFlags::IS_IMMUTABLE_PROTOTYPE_EXOTIC_OBJECT)
        {
            if self.get_prototype_of(cx)? == prototype {
                return Ok(true);
            }
            let message = "Cannot set prototype of immutable prototype object";
            return cx.reject(should_throw, message);
        }
        if self.prototype_direct() == prototype {
            return Ok(true);
        }
        if !self.is_extensible(cx)? {
            return cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE);
        }
        if !prototype.is_object() && !prototype.is_null() {
            return cx.reject(should_throw, errors::PROTOTYPE_NOT_OBJECT_OR_NULL);
        }
        let mut next = prototype.as_object();
        while let Some(mut object) = next.filter(|it| it.cell_type() != CellType::Proxy) {
            if let Some(proxy) = object.downcast::<GlobalProxy>() {
                object = proxy.target().upcast();
            }
            if object.is_same(self) {
                return cx.reject(should_throw, "cyclic __proto__ value");
            }
            next = object.prototype_object_direct();
        }
        self.set_prototype_direct(cx, prototype);
        Ok(true)
    }
}
