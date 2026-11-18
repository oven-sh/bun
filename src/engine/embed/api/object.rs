use core::ffi::c_void;

use bun_engine_bytecode::Visibility;
use bun_engine_macros::export;
use bun_engine_text::{Identifier, PropertyName, StringRef};
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::{
    Attributes, CellType, Class, CustomGetter, CustomGetterSetter, CustomSetter, Cx, DontEnumMode,
    Gc, GetterSetter, GlobalObject, IndexingMode, IntegrityLevel, InternalFieldTuple,
    InternalMethod, Intrinsic, JsArray, JsFinalObject, JsFunction, JsObject, JsObjectInit,
    JsResult, JsString, NativeFunction, Properties, PropertyDescriptor, PropertyEntry,
    PropertyNameList, PropertyNameMode, PropertyOffset, PropertySlot, PutDirectIndexMode,
    PutPropertySlot, Shape, ShapeSpec, StaticProperty, StaticTable, Storage, TypeFlags, Value, Vm,
    function_name,
};

use crate::abi::{or_undefined, returned_by_value};

returned_by_value! {
    PropertyOffset = PropertyOffset::INVALID,
    Storage = Storage::NONE,
}

/// For the functions that C++ calls without a realm.
pub(super) fn realm_of<'a>(object: &JsObject) -> &'a mut Cx {
    let global = object.realm().expect("an object of a realm");
    // SAFETY: C++ has the right to use the heap, and lends it for the call.
    unsafe { Cx::from_global(global) }
}

#[export]
unsafe fn shape_create(
    vm: &Vm,
    global: Option<Gc<GlobalObject>>,
    prototype: Option<Value>,
    cell_type: CellType,
    flags: TypeFlags,
    class: &'static Class,
    indexing_mode: u8,
    inline_capacity: u32,
) -> Gc<Shape> {
    assert!(inline_capacity as usize <= JsFinalObject::MAX_INLINE_CAPACITY);
    let mode = IndexingMode::from_bits(indexing_mode);
    // SAFETY: what the class says of itself.
    let spec =
        unsafe { ShapeSpec::from_parts(class, cell_type, flags, mode, inline_capacity as u8) };
    let prototype = prototype.filter(|it| it.is_object()).unwrap_or(Value::NULL);
    Shape::create(vm, global, prototype, spec)
}

/// One for all who ask for the same.
#[export]
unsafe fn shape_for_class(
    cx: &Cx,
    prototype: Gc<JsObject>,
    cell_type: CellType,
    flags: TypeFlags,
    class: &'static Class,
) -> Gc<Shape> {
    // SAFETY: as above.
    let spec =
        unsafe { ShapeSpec::from_parts(class, cell_type, flags, IndexingMode::NON_ARRAY, 0) };
    Shape::cached(cx, cx.global(), prototype, spec)
}

#[export]
fn shape_for_empty_object(cx: &Cx, prototype: Gc<JsObject>, inline_capacity: u32) -> Gc<Shape> {
    Shape::for_empty_object(cx, cx.global(), prototype, inline_capacity as usize)
}

#[export]
fn shape_add_property_transition(
    shape: &Shape,
    vm: &Vm,
    name: PropertyName<'_>,
    attributes: Attributes,
    offset: &mut PropertyOffset,
) -> Gc<Shape> {
    let target;
    (target, *offset) = shape.add_property_transition(vm, name, attributes.for_shape());
    target
}

#[export]
fn shape_get(shape: &Shape, name: PropertyName<'_>, attributes: &mut Attributes) -> PropertyOffset {
    let Some((offset, found)) = shape.get(name) else {
        return PropertyOffset::INVALID;
    };
    *attributes = found;
    offset
}

/// The result goes to `release_properties`.
#[export]
fn shape_retain_properties(
    shape: &Shape,
    first: &mut *const PropertyEntry,
    count: &mut usize,
) -> *const c_void {
    let properties = shape.properties();
    (*first, *count) = (properties.entries().as_ptr(), properties.entries().len());
    // SAFETY: a counted reference or null.
    unsafe { core::mem::transmute::<Properties, *const c_void>(properties) }
}

#[export]
unsafe fn release_properties(properties: *const c_void) {
    // SAFETY: from `shape_retain_properties`.
    drop(unsafe { core::mem::transmute::<*const c_void, Properties>(properties) });
}

#[export]
fn shape_did_replace_property(shape: &Shape, vm: &Vm, offset: PropertyOffset) {
    shape.did_replace_property(vm, offset);
}

#[export]
fn static_table_find(
    table: &StaticTable,
    name: PropertyName<'_>,
) -> Option<&'static StaticProperty> {
    table.find(name)
}

#[export]
fn slot_value(slot: &PropertySlot, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
    or_undefined(slot.value(cx, name))
}

#[export]
fn slot_value_at_index(slot: &PropertySlot, cx: &mut Cx, index: u64) -> JsResult<Value> {
    let name = Identifier::new(bun_engine_number::NumberText::from(index as f64).text());
    or_undefined(slot.value(cx, name.name()))
}

#[export]
fn getter_setter_create(
    vm: &Vm,
    getter: Option<Gc<JsObject>>,
    setter: Option<Gc<JsObject>>,
) -> Gc<GetterSetter> {
    GetterSetter::create(vm, getter, setter)
}

#[export]
fn getter_setter_call_getter(accessor: &GetterSetter, cx: &mut Cx, this: Value) -> JsResult<Value> {
    or_undefined(accessor.call_getter(cx, this))
}

#[export]
fn custom_getter_setter_create(
    vm: &Vm,
    getter: Option<CustomGetter>,
    setter: Option<CustomSetter>,
    required_class: Option<&'static Class>,
) -> Gc<CustomGetterSetter> {
    CustomGetterSetter::create(vm, getter, setter, required_class)
}

#[export]
fn descriptor_of_stored(descriptor: &mut PropertyDescriptor, value: Value, attributes: Attributes) {
    *descriptor = PropertyDescriptor::stored(value, attributes);
}

#[export]
fn descriptor_from_value(
    descriptor: &mut PropertyDescriptor,
    cx: &mut Cx,
    value: Value,
) -> JsResult<bool> {
    *descriptor = PropertyDescriptor::from_value(cx, value)?;
    Ok(true)
}

#[export]
fn descriptor_to_object(descriptor: &PropertyDescriptor, cx: &Cx) -> Gc<JsObject> {
    descriptor.to_object(cx)
}

#[export]
unsafe fn name_list_construct(
    place: *mut PropertyNameList,
    mode: PropertyNameMode,
    includes_private_names: bool,
) {
    let mut list = PropertyNameList::new(mode);
    if includes_private_names {
        list = list.including_private_names();
    }
    // SAFETY: room for one.
    unsafe { place.write(list) }
}

#[export]
unsafe fn name_list_take(place: *mut PropertyNameList, other: &mut PropertyNameList) {
    let empty = other.new_like();
    // SAFETY: room for one.
    unsafe { place.write(core::mem::replace(other, empty)) }
}

#[export]
unsafe fn name_list_destroy(list: *mut PropertyNameList) {
    // SAFETY: constructed, and not used again.
    unsafe { list.drop_in_place() }
}

#[export]
fn name_list_add(list: &mut PropertyNameList, name: PropertyName<'_>) {
    list.add(name);
}

#[export]
fn name_list_clear(list: &mut PropertyNameList) {
    list.clear();
}

#[export]
fn name_list_first(list: &PropertyNameList) -> *mut c_void {
    list.as_ptr().cast_mut().cast()
}

#[export]
fn name_list_length(list: &PropertyNameList) -> usize {
    list.len()
}

#[export]
fn storage_create(vm: &Vm, shape: Gc<Shape>) -> Storage {
    JsObjectInit::new(vm, shape).storage()
}

#[export]
fn final_object_create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsFinalObject> {
    JsFinalObject::create(vm, shape)
}

#[export]
fn final_object_with_prototype(
    cx: &Cx,
    prototype: Gc<JsObject>,
    inline_capacity: u32,
) -> Gc<JsFinalObject> {
    JsFinalObject::create(cx, shape_for_empty_object(cx, prototype, inline_capacity))
}

#[export]
fn internal_field_tuple_create(
    vm: &Vm,
    shape: Gc<Shape>,
    first: Value,
    second: Value,
) -> Gc<InternalFieldTuple> {
    InternalFieldTuple::create_with_shape(vm, shape, first, second)
}

#[export]
fn object_calculated_class_name(object: &JsObject) -> StringRef {
    match object.realm() {
        Some(_) => object.calculated_class_name(realm_of(object)),
        None => StringRef::from_literal(object.class().name()),
    }
}

#[export]
fn object_get_prototype_of(object: &JsObject, cx: &mut Cx) -> JsResult<Value> {
    object.get_prototype_of(cx)
}

#[export]
fn object_set_prototype_of(
    object: &JsObject,
    cx: &mut Cx,
    prototype: Value,
    should_throw: bool,
) -> JsResult<bool> {
    object.set_prototype_of(cx, prototype, should_throw)
}

#[export]
fn object_set_prototype_direct(object: &JsObject, vm: &Vm, prototype: Value) {
    object.set_prototype_direct(vm, prototype);
}

#[export]
fn object_did_become_prototype(object: &JsObject, vm: &Vm) {
    object.did_become_prototype(vm);
}

#[export]
fn object_get(object: &JsObject, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
    or_undefined(object.get(cx, name))
}

#[export]
fn object_get_index(object: &JsObject, cx: &mut Cx, index: u64) -> JsResult<Value> {
    or_undefined(object.get_index(cx, index))
}

#[export]
fn object_get_if_has_property(
    object: &JsObject,
    cx: &mut Cx,
    name: PropertyName<'_>,
) -> JsResult<Option<Value>> {
    object.get_if_has_property(cx, name)
}

#[export]
fn object_get_own_index(object: &JsObject, cx: &mut Cx, index: u32) -> JsResult<Option<Value>> {
    let mut slot = PropertySlot::new(object.into(), InternalMethod::Get);
    if !object.get_own_property_slot_by_index(cx, index, &mut slot)? {
        return Ok(None);
    }
    slot.value_at_index(cx, index).map(Some)
}

#[export]
fn object_try_get_index_quickly(object: &JsObject, index: u64) -> Option<Value> {
    let index = u32::try_from(index).ok()?;
    object.try_get_index_quickly(index).or_else(|| {
        let entry = object.sparse_elements()?.get(index)?;
        let flags = object.shape().type_flags();
        (!entry.attributes.contains(Attributes::ACCESSOR)
            && !flags.contains(TypeFlags::INTERCEPTS_INDEXED_ACCESS))
        .then_some(entry.value)
    })
}

#[export]
fn object_get_property_slot(
    object: &JsObject,
    cx: &mut Cx,
    name: PropertyName<'_>,
    slot: &mut PropertySlot,
) -> JsResult<bool> {
    object.get_property_slot(cx, name, slot)
}

#[export]
fn object_get_property_slot_by_index(
    object: &JsObject,
    cx: &mut Cx,
    index: u32,
    slot: &mut PropertySlot,
) -> JsResult<bool> {
    object.get_property_slot_by_index(cx, index, slot)
}

#[export]
fn object_get_non_index_property_slot(
    object: &JsObject,
    cx: &mut Cx,
    name: PropertyName<'_>,
    slot: &mut PropertySlot,
) -> JsResult<bool> {
    object.get_non_index_property_slot(cx, name, slot)
}

#[export]
fn object_get_own_property_slot(
    object: &JsObject,
    cx: &mut Cx,
    name: PropertyName<'_>,
    slot: &mut PropertySlot,
) -> JsResult<bool> {
    object.get_own_property_slot(cx, name, slot)
}

#[export]
fn object_get_own_non_index_property_slot(
    object: &JsObject,
    name: PropertyName<'_>,
    slot: &mut PropertySlot,
) -> JsResult<bool> {
    if !object.cell_type().has_storage() {
        return Ok(false);
    }
    object.get_own_non_index_property_slot(realm_of(object), name, slot)
}

#[export]
fn object_get_own_property_descriptor(
    object: &JsObject,
    cx: &mut Cx,
    name: PropertyName<'_>,
    descriptor: &mut PropertyDescriptor,
) -> JsResult<bool> {
    let found = object.get_own_property_descriptor(cx, name)?;
    Ok(found.map(|found| *descriptor = found).is_some())
}

#[export]
fn object_has_property(object: &JsObject, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
    object.has_property(cx, name)
}

#[export]
fn object_has_index(object: &JsObject, cx: &mut Cx, index: u64) -> JsResult<bool> {
    object.has_index(cx, index)
}

#[export]
fn object_has_own_property(
    object: &JsObject,
    cx: &mut Cx,
    name: PropertyName<'_>,
) -> JsResult<bool> {
    object.has_own_property(cx, name)
}

#[export]
fn object_property_names(
    object: &JsObject,
    cx: &mut Cx,
    list: &mut PropertyNameList,
    mode: DontEnumMode,
) -> JsResult<()> {
    object.property_names(cx, list, mode)
}

#[export]
fn object_own_non_index_property_names(
    object: &JsObject,
    cx: &mut Cx,
    list: &mut PropertyNameList,
    mode: DontEnumMode,
) -> JsResult<()> {
    object.own_non_index_property_names(cx, list, mode)
}

#[export]
fn object_delete(object: &JsObject, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
    object.delete(cx, name)
}

#[export]
fn object_create_data_property(
    object: &JsObject,
    cx: &mut Cx,
    name: PropertyName<'_>,
    value: Value,
    should_throw: bool,
) -> JsResult<bool> {
    object.create_data_property(cx, name, value, should_throw)
}

#[export]
fn define_property_on_receiver(
    cx: &mut Cx,
    name: PropertyName<'_>,
    value: Value,
    slot: &mut PutPropertySlot,
) -> JsResult<bool> {
    JsObject::define_property_on_receiver(cx, name, value, slot)
}

#[export]
fn object_freeze_ordinary(object: &JsObject, vm: &Vm) {
    object.restrict_ordinary(vm, IntegrityLevel::Frozen);
}

#[export]
fn object_freeze(object: Gc<JsObject>, cx: &mut Cx) -> JsResult<Gc<JsObject>> {
    if !object.set_integrity_level(cx, IntegrityLevel::Frozen)? {
        return Err(cx.throw_type_error("Unable to prevent extension in Object.freeze"));
    }
    Ok(object)
}

#[export]
fn object_seal(object: Gc<JsObject>, cx: &mut Cx) -> JsResult<Gc<JsObject>> {
    if !object.set_integrity_level(cx, IntegrityLevel::Sealed)? {
        return Err(cx.throw_type_error("Unable to prevent extension in Object.seal"));
    }
    Ok(object)
}

#[export]
fn object_convert_to_dictionary(object: &JsObject, vm: &Vm) {
    object.convert_to_dictionary(vm);
}

#[export]
fn object_has_instance(object: &JsObject, cx: &mut Cx, value: Value) -> JsResult<bool> {
    object.has_instance(cx, value)
}

#[export]
fn default_has_instance(cx: &mut Cx, value: Value, prototype: Value) -> JsResult<bool> {
    JsObject::default_has_instance(cx, value, prototype)
}

#[export]
fn object_length_of_array_like(object: &JsObject, cx: &mut Cx) -> JsResult<u64> {
    object.length_of_array_like(cx)
}

#[export]
fn object_reify_all_static_properties(object: &JsObject, cx: &mut Cx) -> JsResult<()> {
    object.reify_all_static_properties(cx)
}

/// The object is complete even if it is made while an exception is pending.
#[export]
fn object_reify_entries(
    object: &JsObject,
    class_for_this: Option<&'static Class>,
    entries: &[StaticProperty],
) {
    if !object.cell_type().has_storage() {
        return;
    }
    let cx = realm_of(object);
    object.convert_to_dictionary(cx);
    for entry in entries.iter().filter(|entry| entry.is_entry()) {
        let _ = object.reify_entry(cx, class_for_this, entry, entry.name().name());
    }
}

#[export]
unsafe fn object_set_shape(object: &JsObject, shape: &Shape) {
    // SAFETY: C++ has seen to it that the object has the slots.
    unsafe { object.set_shape(shape) }
}

#[export]
fn object_put_direct(
    object: &JsObject,
    vm: &Vm,
    name: PropertyName<'_>,
    value: Value,
    attributes: Attributes,
) {
    match name.as_index() {
        Some(index) => put_direct_at_index(object, index, value, attributes),
        None => object.put_direct_any(vm, name, value, attributes),
    }
}

#[cold]
fn put_direct_at_index(object: &JsObject, index: u32, value: Value, attributes: Attributes) {
    if !object.cell_type().has_storage() {
        return;
    }
    let (attributes, mode) = (
        attributes.for_stored(value),
        PutDirectIndexMode::LikePutDirect,
    );
    // What it throws stays pending.
    let _ = object.put_direct_index_with(realm_of(object), index, value, attributes, mode);
}

#[export]
fn object_put_direct_with_slot(
    object: &JsObject,
    vm: &Vm,
    name: PropertyName<'_>,
    value: Value,
    attributes: Attributes,
    slot: &mut PutPropertySlot,
) {
    object.put_direct_with_slot(vm, name, value, attributes.for_stored(value), slot);
}

#[export]
unsafe fn object_put_direct_without_transition(
    object: &JsObject,
    vm: &Vm,
    name: PropertyName<'_>,
    value: Value,
    attributes: Attributes,
) {
    if name.as_index().is_some() || object.shape().get(name).is_some() {
        return object_put_direct(object, vm, name, value, attributes);
    }
    // SAFETY: C++ knows the object to be the only one with the shape.
    unsafe { object.put_direct_without_transition(vm, name, value, attributes.for_stored(value)) };
}

#[export]
fn object_put_direct_native_function(
    object: &JsObject,
    cx: &Cx,
    name: PropertyName<'_>,
    length: u32,
    function: NativeFunction,
    visibility: Visibility,
    intrinsic: Intrinsic,
    attributes: Attributes,
) {
    let text = if name.is_symbol() {
        StringRef::from_literal("anonymous")
    } else {
        StringRef::retain(name.string())
    };
    let constructor = native_not_a_constructor;
    let function = JsFunction::native_with(
        cx,
        length,
        &text,
        function,
        constructor,
        intrinsic,
        visibility,
    );
    object_put_direct(object, cx, name, function.into(), attributes);
}

#[export]
fn object_put_direct_native_getter(
    object: &JsObject,
    cx: &Cx,
    name: PropertyName<'_>,
    getter: NativeFunction,
    intrinsic: Intrinsic,
    attributes: Attributes,
) {
    let text = function_name("get ", name);
    let getter = JsFunction::native_with_intrinsic(cx, 0, &text, getter, intrinsic);
    let accessor = GetterSetter::create(cx, Some(getter.upcast()), None);
    object_put_direct(object, cx, name, accessor.into(), attributes);
}

#[export]
fn object_put_direct_index(
    object: &JsObject,
    cx: &mut Cx,
    index: u32,
    value: Value,
    attributes: Attributes,
    mode: PutDirectIndexMode,
) -> JsResult<bool> {
    object.put_direct_index_with(cx, index, value, attributes, mode)
}

#[export]
fn object_set_index(
    object: &JsObject,
    cx: &mut Cx,
    index: u32,
    value: Value,
    should_throw: bool,
) -> JsResult<bool> {
    object.set_index(cx, index.into(), value, should_throw)
}

#[export]
fn object_store_element(object: &JsObject, vm: &Vm, index: u32, value: Value) {
    if !object.try_set_dense(vm, index, value) && object.store_element(vm, index, value).is_err() {
        bun_alloc::out_of_memory();
    }
}

#[export]
fn object_holes_must_forward_to_prototype(object: &JsObject) -> bool {
    object.holes_must_forward_to_prototype()
}

#[export]
fn object_values(cx: &mut Cx, value: Value) -> JsResult<Value> {
    Ok(value.to_object(cx)?.enumerable_own_values(cx)?.into())
}

#[export]
fn object_own_keys(
    object: &JsObject,
    cx: &mut Cx,
    kinds: PropertyNameMode,
    mode: DontEnumMode,
) -> JsResult<Gc<JsArray>> {
    object.own_keys_array(cx, kinds, mode)
}

#[export]
fn value_to_tagged_string(value: Value, cx: &mut Cx) -> JsResult<Gc<JsString>> {
    value.to_tagged_string(cx)
}

#[export]
fn object_builtin_tagged_string(object: &JsObject, cx: &Cx) -> JsResult<Gc<JsString>> {
    Ok(JsString::from_name(cx, object.builtin_tagged_string(cx)?))
}
