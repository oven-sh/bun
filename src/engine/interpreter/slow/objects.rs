use bun_engine_text::Identifier;
use bun_engine_vm::code::metadata::NewObject;
use bun_engine_vm::{
    Attributes, Cx, Gc, JsFinalObject, JsFunction, JsString, JsSymbol, Shape, ShapeId,
};

use super::{Frame, execute};

/// Of an object with these properties.
fn shape_for(
    cx: &Cx,
    f: Frame<'_>,
    entry: &NewObject,
    capacity: u32,
    names: &[Identifier],
) -> Gc<Shape> {
    if entry.shape.get() != ShapeId::NONE {
        // SAFETY: kept alive by the code block.
        return unsafe { entry.shape.get().decode() };
    }
    let capacity = JsFinalObject::optimal_inline_capacity(capacity as usize);
    let mut shape = Shape::for_empty_object(cx, cx.global(), cx.object_prototype(), capacity);
    for name in names {
        shape = shape
            .add_property_transition(cx, name.name(), Attributes::NONE)
            .0;
    }
    entry.shape.set(shape.id());
    entry.inline_capacity.set(capacity as u32);
    if names.len() <= capacity {
        let allocator = (cx.heap.cells).allocator_for(JsFinalObject::allocation_size(capacity));
        entry
            .allocator
            .set(allocator.map_or(core::ptr::null(), core::ptr::from_ref));
    }
    f.code_block.write_barrier_for_cell();
    shape
}

execute! {
    NewObject(op, cx, f) {
        let shape = shape_for(cx, f, f.entry(op.metadata), op.capacity, &[]);
        f.set(op.dst, JsFinalObject::create(cx, shape));
    }
    NewObjectLiteral(op, cx, f) {
        let names = &f.code_block.code().name_lists[op.names.index()];
        let values = f.collect(op.first, op.count);
        if names.len() > Shape::MAX_TRANSITIONS_BY_PUT_BY_ID {
            let object = cx.new_object();
            object.convert_to_dictionary(cx);
            for (name, &value) in names.iter().zip(values.iter()) {
                object.put_direct(cx, name.name(), value, Attributes::NONE);
            }
            f.set(op.dst, object);
        } else {
            let shape = shape_for(cx, f, f.entry(op.metadata), op.capacity.max(op.count), names);
            f.set(op.dst, JsFinalObject::create_with_values(cx, shape, &values));
        }
    }
    NewFunction(op, cx, f) {
        let executable = f.code_block.function(cx, op.function);
        // SAFETY: what the generator has arranged.
        f.set(op.dst, unsafe { JsFunction::create(cx, executable, f.cell(op.scope)) });
    }
    SetFunctionName(op, cx, f) {
        let mut name = f.get(op.name);
        if let Some(number) = name.as_number() {
            name = JsString::from_number(cx, number).into();
        }
        f.cell::<JsFunction>(op.function).set_function_name(cx, name)?;
    }
    CreatePrivateName(op, cx, f) {
        f.set(op.dst, JsSymbol::create_private(cx, f.name(op.description).string()));
    }
}
