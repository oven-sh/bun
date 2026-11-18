//! `WebAssembly.Exception` (js-api "Exceptions"), which is also what an `exnref` refers to.

use core::mem::offset_of;
use core::sync::atomic::{AtomicU64, Ordering};

use bun_engine_text::private_names;
use bun_engine_vm::{
    Attributes, ErrorInstance, GcFree, Visitor, capture_stack_trace, errors as vm_errors, root_vec,
    stack_trace_text,
};
use bun_engine_wasm_format::ValKind;
use bun_engine_wasm_runtime::{Bits, Reference, Tag};

use crate::define::read_only_attribute;
use crate::namespace::{Namespace, Slot, shape_for_new_target};
use crate::owned::visit_with;
use crate::prelude::*;
use crate::tag::{WasmTag, script_tag};
use crate::values;

static_table!(static PROTOTYPE_PROPERTIES = [
    member(StaticProperty::function(names::getArg, get_arg, 2)),
    member(StaticProperty::function(names::is, is, 1)),
    read_only_attribute(names::stack, stack),
    StaticProperty::string(symbols::toStringTag, names::wasmException),
    StaticProperty::made(names::constructor, |cx, _| {
        Namespace::of(cx).get(cx, Slot::ExceptionConstructor).as_value()
    }),
]);

define_object!(Prototype, "WebAssembly.Exception", PROTOTYPE_PROPERTIES);

static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
]);

define_constructor!(Constructor, CONSTRUCTOR_PROPERTIES, call, construct);

#[repr(transparent)]
struct TagAddress(*const Tag);

// SAFETY: a tag refers to no cell.
unsafe impl GcFree for TagAddress {}

/// The payload follows.
#[cell(name = "WebAssembly.Exception", visit_children)]
pub(crate) struct WasmException {
    base: JsObject,
    tag: TagAddress,
    /// Keeps the tag, unless that is there for good.
    tag_owner: Option<Gc<WasmTag>>,
}

impl WasmException {
    pub(crate) const OFFSET_OF_TAG: usize = offset_of!(WasmException, tag);
    pub(crate) const OFFSET_OF_PAYLOAD: usize = size_of::<WasmException>();

    /// `None` for want of memory.
    ///
    /// # Safety
    /// `tag_owner` keeps the tag, or nothing has to. Values of its types are in the payload before the next allocation.
    pub(crate) unsafe fn try_allocate(
        cx: &Cx,
        shape: Gc<Shape>,
        tag: &Tag,
        tag_owner: Option<Gc<WasmTag>>,
    ) -> Option<Gc<WasmException>> {
        let init = WasmExceptionInit {
            base: JsObjectInit::new(cx, shape),
            tag: TagAddress(tag),
            tag_owner,
        };
        let size = Self::OFFSET_OF_PAYLOAD + tag.payload_size() as usize;
        // SAFETY: a new cell of that size, and the caller's.
        unsafe {
            let address = cx.heap.cells.try_allocate_uninitialized(&cx.heap, size);
            (address != 0).then(|| {
                WasmException::initialize(core::ptr::with_exposed_provenance_mut(address), init);
                Gc::from_address(address)
            })
        }
    }

    /// What WebAssembly catches of a value that has been thrown.
    pub(crate) fn of_thrown_value(cx: &Cx, value: Value) -> Gc<WasmException> {
        value.downcast().unwrap_or_else(|| {
            let shape = Namespace::of(cx).shape(cx, Slot::ExceptionShape);
            // SAFETY: the tag is a static, and takes one `externref`.
            unsafe {
                let exception = Self::try_allocate(cx, shape, script_tag(), None);
                let exception = exception.unwrap_or_else(|| bun_alloc::out_of_memory());
                exception.payload_at(0).write(value.to_bits());
                exception
            }
        })
    }

    /// What a script catches of it.
    pub(crate) fn thrown_value(&self) -> Value {
        if !core::ptr::eq(self.tag(), &raw const **script_tag()) {
            return self.as_value();
        }
        // SAFETY: the tag takes one `externref`.
        values::from_reference(Reference(unsafe { self.payload_at(0).read() }))
    }

    fn tag(&self) -> &Tag {
        // SAFETY: the promise of the maker.
        unsafe { &*self.tag.0 }
    }

    fn payload_at(&self, offset: u32) -> *mut u64 {
        let address = self.address() + Self::OFFSET_OF_PAYLOAD + offset as usize;
        core::ptr::with_exposed_provenance_mut(address)
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        let mut visit = visit_with(visitor);
        for (_, offset) in self.tag().payload().filter(|(ty, _)| ty.is_ref()) {
            // SAFETY: an aligned word of the payload, which does not change.
            let word = unsafe { AtomicU64::from_ptr(self.payload_at(offset)) };
            let cell = Reference(word.load(Ordering::Relaxed)).cell();
            cell.into_iter().for_each(&mut visit);
        }
    }
}

/// `None` for what WebAssembly does not catch.
pub(crate) fn tag_of_thrown_value(value: &Value) -> Option<&Tag> {
    if let Some(exception) = value.downcast::<WasmException>() {
        // SAFETY: the value keeps the exception alive, and that the tag.
        return Some(unsafe { &*exception.tag.0 });
    }
    let error = value.downcast::<ErrorInstance>();
    (error.is_none_or(|it| it.is_catchable_from_wasm())).then(|| &**script_tag())
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let prototype = Prototype::create(cx, cx.object_prototype().into());
    let spec = ShapeSpec::of::<WasmException>();
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::ExceptionShape, shape);
    let parent = cx.function_prototype();
    let constructor = Constructor::create(cx, parent, 2, names::Exception, &prototype);
    namespace.put(Slot::ExceptionConstructor, constructor);
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(vm_errors::throw_called_without_new(
        cx,
        "WebAssembly.Exception",
    ))
}

fn traces_stack(cx: &mut Cx, options: Value) -> JsResult<bool> {
    if options.is_undefined_or_null() {
        return Ok(false);
    }
    let Some(options) = options.as_object() else {
        let message = "WebAssembly.Exception expects its third argument to be an object";
        return Err(cx.throw_type_error(message));
    };
    Ok(options.get(cx, names::traceStack)?.to_boolean(cx))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(tag_object) = frame.argument(0).downcast::<WasmTag>() else {
        return Err(cx.throw_type_error(
            "WebAssembly.Exception constructor expects the first argument to be a WebAssembly.Tag",
        ));
    };
    let tag = tag_object.anchor().tag();
    if core::ptr::eq(tag, &raw const **script_tag()) {
        let message = "WebAssembly.Exception constructor does not accept WebAssembly.JSTag";
        return Err(cx.throw_type_error(message));
    }
    let Some(given) = values::list_of_length(cx, frame.argument(1), tag.ty().params().len())?
    else {
        return Err(cx.throw_type_error(
            "WebAssembly.Exception constructor expects the number of paremeters in WebAssembly.Tag to match the tags \
             parameter count.",
        ));
    };
    let mut payload = root_vec();
    for (ty, &value) in tag.ty().params().zip(given.iter()) {
        if !values::can_cross(ty.erased()) {
            return Err(cx.throw_type_error(
                "WebAssembly.Exception constructor expects payload includes neither v128 nor exnref.",
            ));
        }
        payload.push(values::to_bits(cx, value, (&ty).into())? as u64);
    }
    let traces_stack = traces_stack(cx, frame.argument(2))?;
    let shape = shape_for_new_target(cx, frame, Slot::ExceptionShape)?;
    // SAFETY: the object has the tag, and there is a word for each value.
    let exception = unsafe {
        let exception = WasmException::try_allocate(cx, shape, tag, Some(tag_object));
        exception.inspect(|it| (it.payload_at(0)).copy_from(payload.as_ptr(), payload.len()))
    };
    let exception = exception.ok_or_else(|| cx.throw_out_of_memory())?;
    if traces_stack {
        let limit = cx.global().stack_trace_limit().unwrap_or(0);
        let text = stack_trace_text(cx, &capture_stack_trace(cx, 1, limit as usize, None));
        let text = JsString::new(cx, text).into();
        exception.put_direct(cx, private_names::stack, text, Attributes::CONSTANT);
    }
    Ok(exception.into())
}

fn this_exception(cx: &Cx, this: Value) -> JsResult<Gc<WasmException>> {
    this.downcast().ok_or_else(|| match this.is_cell() {
        true => {
            cx.throw_type_error("WebAssembly.Exception operation called on non-Exception object")
        }
        false => vm_errors::throw_not_an_object(cx, this),
    })
}

#[native_abi]
fn get_arg(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let exception = this_exception(cx, frame.this_value())?;
    if frame.argument_count() < 2 {
        return Err(cx.throw_type_error(vm_errors::NOT_ENOUGH_ARGUMENTS));
    }
    let Some(tag) = frame.argument(0).downcast::<WasmTag>() else {
        let message = "WebAssembly.Exception.getArg(): First argument must be a WebAssembly.Tag";
        return Err(cx.throw_type_error(message));
    };
    let index = frame.argument(1).to_number(cx)?.trunc();
    if !(0.0..=f64::from(u32::MAX)).contains(&index) {
        let message = "Expect an integer argument in the range: [0, 2^32 - 1]";
        return Err(cx.throw_range_error(message));
    }
    if !core::ptr::eq(exception.tag(), tag.tag()) {
        let message =
            "WebAssembly.Exception.getArg(): First argument does not match the exception tag";
        return Err(cx.throw_type_error(message));
    }
    let Some((ty, offset)) = exception.tag().payload().nth(index as usize) else {
        return Err(cx.throw_range_error("WebAssembly.Exception.getArg(): Index out of range"));
    };
    if !values::can_cross(ty) {
        return Err(cx.throw_type_error("argument type cannot be a V128 or exnref"));
    }
    // SAFETY: the tag says what is there.
    let word = unsafe { exception.payload_at(offset).read() };
    let bits = match ty.kind() {
        ValKind::I32 | ValKind::F32 => Bits::from(word as u32),
        _ => Bits::from(word),
    };
    values::from_bits(cx, bits, ty)
}

#[native_abi]
fn is(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let exception = this_exception(cx, frame.this_value())?;
    if frame.argument_count() < 1 {
        return Err(cx.throw_type_error(vm_errors::NOT_ENOUGH_ARGUMENTS));
    }
    let Some(tag) = frame.argument(0).downcast::<WasmTag>() else {
        let message = "WebAssembly.Exception.is(): First argument must be a WebAssembly.Tag";
        return Err(cx.throw_type_error(message));
    };
    Ok(core::ptr::eq(exception.tag(), tag.tag()).into())
}

#[native_abi]
fn stack(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let exception = this_exception(cx, this)?;
    Ok((exception.get_direct(private_names::stack)).unwrap_or_default())
}
