mod builder;
mod literal;

use bun_sema::hir::ExprId;
use smallvec::SmallVec;

pub(crate) use self::builder::emit_object_rest;
pub(in crate::lower) use self::builder::set_prototype;
pub(crate) use self::literal::{holds_dictionary_literal, lower_object_literal};
use super::member::PropertyName;
use super::{FunctionLowering, layouts};
use crate::ir::{LayoutId, ValueId};

pub(crate) struct ObjectBuilder {
    layout: LayoutId,
    state: ObjectState,
    is_dictionary: bool,
    is_finished: bool,
}

enum ObjectState {
    Pending(InitialFields),
    Open { head: ValueId },
}

#[derive(Default)]
struct InitialFields {
    fields: SmallVec<[u32; 8]>,
    values: SmallVec<[ValueId; 8]>,
    present: SmallVec<[u64; 2]>,
    /// Nothing can reach the object before the literal is complete, so its prototype is set right after the allocation.
    prototype: Option<ValueId>,
}

impl InitialFields {
    fn contains(&self, field: u32) -> bool {
        let word = self.present.get(field as usize / 64).copied().unwrap_or(0);
        word & (1 << (field % 64)) != 0
    }

    fn add(&mut self, field: u32, value: ValueId) {
        debug_assert!(!self.contains(field), "an allocation sets a field once");
        let word = field as usize / 64;
        if self.present.len() <= word {
            self.present.resize(word + 1, 0);
        }
        self.present[word] |= 1 << (field % 64);
        self.fields.push(field);
        self.values.push(value);
    }
}

// Each object of a record of data has a layout, so a literal of constants that holds a dictionary is built by operations.
pub(crate) fn begin_object(
    _lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    layout: LayoutId,
) -> ObjectBuilder {
    ObjectBuilder {
        layout,
        state: ObjectState::Pending(InitialFields::default()),
        is_dictionary: false,
        is_finished: false,
    }
}

// The layout has no field, so every member is defined by name.
pub(crate) fn begin_dictionary(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> ObjectBuilder {
    let head = lowering.builder.new_dictionary();
    ObjectBuilder {
        layout: layouts::untyped_layout(lowering.file, &[]),
        state: ObjectState::Open { head },
        is_dictionary: true,
        is_finished: false,
    }
}

// The copy makes the object, with the layout of the source where that is a record. Every later member is defined by name.
pub(crate) fn begin_copy(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    source: ValueId,
) -> ObjectBuilder {
    let head = lowering.builder.copy_object(source, &[], &[]);
    ObjectBuilder {
        layout: layouts::untyped_layout(lowering.file, &[]),
        state: ObjectState::Open { head },
        is_dictionary: true,
        is_finished: false,
    }
}

pub(crate) fn add_property(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    name: PropertyName,
    value: ValueId,
) {
    builder::add_member(lowering, object, name, value, None);
}

pub(in crate::lower) fn add_property_with_source(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    name: PropertyName,
    value: ValueId,
    source: ExprId,
) {
    builder::add_member(lowering, object, name, value, Some(source));
}

pub(crate) fn add_spread(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    source: ValueId,
) {
    let head = builder::open_head(lowering, object);
    lowering
        .builder
        .copy_data_properties(head, source, &[], &[]);
}

pub(crate) fn finish_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    mut object: ObjectBuilder,
) -> ValueId {
    let head = builder::open_head(lowering, &mut object);
    // `FinishObject` closes a `NewObject`.
    if object.is_dictionary || object.is_finished {
        return head;
    }
    lowering.builder.finish_object(head)
}
