//! `ArrayBuffer`, typed arrays, `DataView` and `Atomics`.

mod array_buffer;
mod atomics;
mod constructors;
mod copy;
mod data_view;
mod join;
mod private;
mod prototype;
mod search;
mod sort;
mod species;
mod uint8_array;

use bun_engine_vm::{CellType, ElementType, RealmSlot, RealmWatchpoint, shape_spec_of_view};

use crate::prelude::*;
use crate::watchpoints::Conditions;

/// An index that counts from the end if it is negative, clamped to `0..=length`.
#[inline(always)]
fn relative_index(cx: &mut Cx, value: Value, length: usize, default: usize) -> JsResult<usize> {
    if let Some(index) = value.as_index_int32() {
        return Ok(length.min(index as usize));
    }
    let index = value.to_relative_index(cx, length as u64, default as u64)?;
    Ok(index as usize)
}

/// For views on buffers of a fixed length, and for the others.
fn create_view_shapes(cx: &Cx, cell_type: CellType, prototype: Gc<JsObject>) -> [Gc<Shape>; 2] {
    [false, true].map(|is_resizable| {
        let spec = shape_spec_of_view(cell_type, is_resizable);
        Shape::create(cx, Some(cx.global()), prototype.into(), spec)
    })
}

pub(crate) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;
    match slot {
        array_buffer_prototype | array_buffer_constructor | array_buffer_shape => {
            array_buffer::initialize(cx);
        }
        shared_array_buffer_prototype
        | shared_array_buffer_constructor
        | shared_array_buffer_shape => array_buffer::initialize_shared(cx),
        atomics_object => atomics::initialize(cx),
        typed_array_prototype | typed_array_constructor => constructors::initialize_abstract(cx),
        typed_array_prototype_values => prototype::initialize_values(cx),
        decoding_result_shape => uint8_array::initialize_result_shape(cx),
        data_view_constructor | data_view_shape | resizable_data_view_shape => {
            data_view::initialize(cx);
        }
        _ => return constructors::initialize_slot(cx, slot) || private::initialize_slot(cx, slot),
    }
    true
}

pub(crate) fn add_conditions(
    cx: &Cx,
    which: RealmWatchpoint,
    conditions: &mut Conditions<'_>,
) -> bool {
    let (global, mut types) = (cx.global(), ElementType::ALL.into_iter());
    if which == RealmWatchpoint::ArrayBufferSpecies {
        conditions.pristine(&cx.array_buffer_prototype(), names::constructor);
        conditions.pristine(&cx.array_buffer_constructor(), symbols::species);
    } else if which == RealmWatchpoint::SharedArrayBufferSpecies {
        conditions.pristine(&cx.shared_array_buffer_prototype(), names::constructor);
        conditions.pristine(&cx.shared_array_buffer_constructor(), symbols::species);
    } else if let Some(of) = (types.clone()).find(|&it| which == RealmWatchpoint::species_of(it)) {
        let (constructor, parent) = (
            global.constructor_of_typed_array(cx, of),
            cx.typed_array_constructor(),
        );
        conditions.pristine(&global.prototype_of_typed_array(cx, of), names::constructor);
        conditions.absent(&constructor, symbols::species, parent.into());
        conditions.pristine(&parent, symbols::species);
    } else if let Some(of) = types.find(|&it| which == RealmWatchpoint::iterator_protocol_of(it)) {
        let (prototype, parent) = (
            global.prototype_of_typed_array(cx, of),
            cx.typed_array_prototype(),
        );
        conditions.absent(&prototype, symbols::iterator, parent.into());
        conditions.pristine(&parent, symbols::iterator);
        conditions.pristine_iterator(&cx.array_iterator_prototype());
    } else {
        return false;
    }
    true
}
