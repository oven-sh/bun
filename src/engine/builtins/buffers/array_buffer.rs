use bun_engine_vm::{
    ArrayBufferContents, ArrayBufferRef, GlobalObject, JsArrayBuffer, JsArrayBufferView, RealmSlot,
    RealmWatchpoint, WASM_PAGE_SIZE, errors,
};

use super::relative_index;
use crate::define::species_getter;
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::slice, slice::<false>, 2),
    StaticProperty::getter(names::byteLength, byte_length::<false>),
    StaticProperty::function(names::resize, resize, 1),
    StaticProperty::function(names::transfer, transfer::<true>, 0),
    StaticProperty::function(names::transferToFixedLength, transfer::<false>, 0),
    StaticProperty::getter(names::resizable, is_resizable_or_growable::<false>),
    StaticProperty::getter(names::maxByteLength, max_byte_length::<false>),
    StaticProperty::getter(names::detached, detached),
    StaticProperty::realm_slot(names::constructor, RealmSlot::array_buffer_constructor),
    StaticProperty::string(symbols::toStringTag, names::ArrayBuffer),
]);

define_object!(ArrayBufferPrototype, "ArrayBuffer", PROTOTYPE_PROPERTIES);

static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
    StaticProperty::function(names::isView, is_view, 1).with_intrinsic(Intrinsic::ArrayBufferIsView),
    StaticProperty::getter(symbols::species, species_getter).with_intrinsic(Intrinsic::SpeciesGetter),
]);

define_constructor!(
    ArrayBufferConstructor,
    CONSTRUCTOR_PROPERTIES,
    call,
    construct::<false>
);

static_table!(static SHARED_PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::slice, slice::<true>, 2),
    StaticProperty::getter(names::byteLength, byte_length::<true>),
    StaticProperty::function(names::grow, grow, 1),
    StaticProperty::getter(names::growable, is_resizable_or_growable::<true>),
    StaticProperty::getter(names::maxByteLength, max_byte_length::<true>),
    StaticProperty::realm_slot(names::constructor, RealmSlot::shared_array_buffer_constructor),
    StaticProperty::string(symbols::toStringTag, names::SharedArrayBuffer),
]);

define_object!(
    SharedArrayBufferPrototype,
    "ArrayBuffer",
    SHARED_PROTOTYPE_PROPERTIES
);

static_table!(static SHARED_CONSTRUCTOR_PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
    StaticProperty::getter(symbols::species, species_getter).with_intrinsic(Intrinsic::SpeciesGetter),
]);

define_constructor!(
    SharedArrayBufferConstructor,
    SHARED_CONSTRUCTOR_PROPERTIES,
    call,
    construct::<true>
);

fn instance_shape(cx: &Cx, prototype: Gc<JsObject>) -> Gc<Shape> {
    let spec = ShapeSpec::of::<JsArrayBuffer>();
    Shape::create(cx, Some(cx.global()), prototype.into(), spec)
}

pub(super) fn initialize(cx: &Cx) {
    let (global, parent) = (cx.global(), cx.function_prototype());
    let prototype = ArrayBufferPrototype::create(cx, cx.object_prototype().into());
    let constructor = ArrayBufferConstructor::create(cx, parent, 1, names::ArrayBuffer, &prototype);
    global.init_array_buffer_shape(instance_shape(cx, prototype));
    global.init_array_buffer_prototype(prototype);
    global.init_array_buffer_constructor(constructor);
}

pub(super) fn initialize_shared(cx: &Cx) {
    let (global, parent, name) = (
        cx.global(),
        cx.function_prototype(),
        names::SharedArrayBuffer,
    );
    let prototype = SharedArrayBufferPrototype::create(cx, cx.object_prototype().into());
    let constructor = SharedArrayBufferConstructor::create(cx, parent, 1, name, &prototype);
    global.init_shared_array_buffer_shape(instance_shape(cx, prototype));
    global.init_shared_array_buffer_prototype(prototype);
    global.init_shared_array_buffer_constructor(constructor);
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "ArrayBuffer"))
}

/// GetArrayBufferMaxByteLengthOption
fn max_byte_length_option(cx: &mut Cx, options: Value) -> JsResult<Option<u64>> {
    let Some(options) = options.as_object() else {
        return Ok(None);
    };
    match options.get(cx, names::maxByteLength)? {
        Value::UNDEFINED => Ok(None),
        max => max.to_index(cx, "maxByteLength").map(Some),
    }
}

#[native_abi]
fn construct<const IS_SHARED: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let length = frame.argument(0).to_index(cx, "length")?;
    let max = max_byte_length_option(cx, frame.argument(1))?;
    if max.is_some_and(|max| max < length) {
        return Err(cx.throw_range_error("ArrayBuffer length exceeds maxByteLength option"));
    }
    let shape = cx.shape_from_new_target(frame.new_target(), &frame.callee(), |global, vm| {
        GlobalObject::array_buffer_shape_for(global, vm, IS_SHARED)
    })?;
    JsArrayBuffer::allocate(cx, shape, length, max, IS_SHARED).map(Into::into)
}

#[native_abi]
fn is_view(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.argument(0).is::<JsArrayBufferView>().into())
}

#[inline(always)]
fn this_buffer<const IS_SHARED: bool>(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<JsArrayBuffer>> {
    match frame.this_value().downcast::<JsArrayBuffer>() {
        Some(buffer) if buffer.is_shared() == IS_SHARED => Ok(buffer),
        _ if IS_SHARED => Err(cx.throw_type_error("Receiver must be SharedArrayBuffer")),
        _ => Err(cx.throw_type_error("Receiver must be ArrayBuffer")),
    }
}

fn check_attached(cx: &Cx, this: &JsArrayBuffer) -> JsResult<()> {
    if this.is_detached() {
        return Err(cx.throw_type_error("Receiver is detached"));
    }
    Ok(())
}

#[native_abi]
fn byte_length<const IS_SHARED: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(this_buffer::<IS_SHARED>(cx, frame)?.byte_length().into())
}

#[native_abi]
fn max_byte_length<const IS_SHARED: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let buffer = this_buffer::<IS_SHARED>(cx, frame)?.buffer();
    let max = buffer.max_byte_length();
    Ok(max.unwrap_or_else(|| buffer.byte_length()).into())
}

#[native_abi]
fn is_resizable_or_growable<const IS_SHARED: bool>(
    cx: &mut Cx,
    frame: &CallFrame,
) -> JsResult<Value> {
    let this = this_buffer::<IS_SHARED>(cx, frame)?;
    Ok(this.is_resizable_or_growable().into())
}

#[native_abi]
fn detached(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(this_buffer::<false>(cx, frame)?.is_detached().into())
}

/// SpeciesConstructor. `None` stands for the default.
fn species_constructor<const IS_SHARED: bool>(
    cx: &mut Cx,
    this: &JsArrayBuffer,
) -> JsResult<Option<Value>> {
    let (which, default) = if IS_SHARED {
        let constructor = cx.shared_array_buffer_constructor();
        (RealmWatchpoint::SharedArrayBufferSpecies, constructor)
    } else {
        let constructor = cx.array_buffer_constructor();
        (RealmWatchpoint::ArrayBufferSpecies, constructor)
    };
    if this.shape() == cx.global().array_buffer_shape_for(cx, IS_SHARED) && cx.holds(which) {
        return Ok(None);
    }
    let constructor = this.get(cx, names::constructor)?;
    if constructor.is_undefined() {
        return Ok(None);
    }
    if !constructor.is_object() {
        return Err(cx.throw_type_error("constructor property should not be null"));
    }
    let species = constructor.get(cx, symbols::species)?;
    if species.is_undefined_or_null() || species == default.into() {
        return Ok(None);
    }
    if !species.is_constructor() {
        let message = "Species construction did not get a valid constructor";
        return Err(cx.throw_type_error(message));
    }
    Ok(Some(species))
}

fn construct_for_slice<const IS_SHARED: bool>(
    cx: &mut Cx,
    constructor: Value,
    this: &JsArrayBuffer,
    length: usize,
) -> JsResult<Gc<JsArrayBuffer>> {
    let new = cx.construct(constructor, &[length.into()], constructor)?;
    let message = match new.downcast::<JsArrayBuffer>() {
        None => "Species construction does not create ArrayBuffer",
        Some(new) if new.is_shared() && !IS_SHARED => {
            "ArrayBuffer.prototype.slice creates SharedArrayBuffer"
        }
        Some(new) if !new.is_shared() && IS_SHARED => {
            "SharedArrayBuffer.prototype.slice creates non-shared ArrayBuffer"
        }
        Some(new) if new.is_detached() => "Created ArrayBuffer is detached",
        Some(new) if new.is_same(this) || new.buffer().shares_memory_with(&this.buffer()) => {
            "Species construction returns same ArrayBuffer to a receiver"
        }
        Some(new) if new.byte_length() < length => {
            "Species construction returns ArrayBuffer which byteLength is less than requested"
        }
        Some(new) => return Ok(new),
    };
    Err(cx.throw_type_error(message))
}

#[native_abi]
fn slice<const IS_SHARED: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_buffer::<IS_SHARED>(cx, frame)?;
    check_attached(cx, &this)?;
    let length = this.byte_length();
    let start = relative_index(cx, frame.argument(0), length, 0)?;
    let end = relative_index(cx, frame.argument(1), length, length)?.max(start);
    let new = match species_constructor::<IS_SHARED>(cx, &this)? {
        Some(species) => Some(construct_for_slice::<IS_SHARED>(
            cx,
            species,
            &this,
            end - start,
        )?),
        None => None,
    };
    check_attached(cx, &this)?;
    let no_gc = cx.no_gc();
    let source = this.bytes(&no_gc).clamped(start..end);
    if let Some(new) = new {
        new.bytes(&no_gc).slice(0..source.len()).copy_from(source);
        return Ok(new.into());
    }
    let contents = ArrayBufferContents::try_copy_of(source, end - start);
    let mut contents = cx.or_out_of_memory(contents)?;
    if IS_SHARED {
        contents = contents.into_shared();
    }
    let shape = cx.global().array_buffer_shape_for(cx, IS_SHARED);
    JsArrayBuffer::from_contents(cx, shape, contents).map(Into::into)
}

/// HostResizeArrayBuffer, as the JavaScript interface of WebAssembly defines it. Returns whether it has grown.
fn grow_wasm_memory(cx: &mut Cx, memory: Gc<JsObject>, old: usize, new: usize) -> JsResult<bool> {
    if new < old {
        return Err(cx.throw_range_error("Cannot shrink WebAssembly memory"));
    }
    if !new.is_multiple_of(WASM_PAGE_SIZE) {
        return Err(cx.throw_range_error(format_args!(
            "WebAssembly memory cannot be resized to new byte length {new} because it is not a multiple of {WASM_PAGE_SIZE}"
        )));
    }
    Ok(new == old || (cx.hooks().grow_wasm_memory)(cx, memory, (new - old) / WASM_PAGE_SIZE))
}

#[native_abi]
fn resize(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_buffer::<false>(cx, frame)?;
    if !this.is_resizable_or_growable() {
        return Err(cx.throw_type_error("ArrayBuffer is not resizable"));
    }
    let length = frame.argument(0).to_index(cx, "newLength")? as usize;
    check_attached(cx, &this)?;
    let did_resize = match this.wasm_memory() {
        Some(memory) => grow_wasm_memory(cx, memory, this.byte_length(), length)?,
        None => this.buffer().resize(cx, length).is_ok(),
    };
    if !did_resize {
        return Err(cx.throw_range_error(format_args!(
            "ArrayBuffer resize failed with new byte length {length}"
        )));
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn grow(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_buffer::<true>(cx, frame)?;
    if !this.is_resizable_or_growable() {
        return Err(cx.throw_type_error("SharedArrayBuffer is not growable"));
    }
    let length = frame.argument(0).to_index(cx, "newLength")? as usize;
    if this.buffer().grow(cx, length).is_err() {
        return Err(cx.throw_range_error(format_args!("grow failed with new byte length {length}")));
    }
    Ok(Value::UNDEFINED)
}

/// ArrayBufferCopyAndDetach
#[native_abi]
fn transfer<const PRESERVES_RESIZABILITY: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_buffer::<false>(cx, frame)?;
    let buffer = this.buffer();
    if buffer.is_wasm_memory() {
        let message = "Receiver cannot be detached because it is WebAssembly.Memory";
        return Err(cx.throw_type_error(message));
    }
    let length = match frame.argument(0) {
        Value::UNDEFINED => buffer.byte_length(),
        length => length.to_index(cx, "newLength")? as usize,
    };
    check_attached(cx, &this)?;
    let max = buffer.max_byte_length().filter(|_| PRESERVES_RESIZABILITY);
    if max.is_some_and(|max| length > max) {
        return Err(cx.throw_range_error(format_args!(
            "ArrayBuffer transfer failed with new byte length {length}"
        )));
    }
    let (data, old_length) = (buffer.data(), buffer.byte_length());
    let contents = match max {
        Some(_) => buffer.transfer_resized(cx, length),
        None => buffer.transfer_to_fixed_length(cx, length),
    };
    let new = cx.or_out_of_memory(contents.and_then(ArrayBufferRef::try_new))?;
    let moved = if new.data() == data { old_length } else { 0 };
    let shape = cx.array_buffer_shape();
    Ok(JsArrayBuffer::create_with_reported_bytes(cx, shape, &new, moved).into())
}
