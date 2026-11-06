mod builder;
mod literal;

use smallvec::SmallVec;

pub(in crate::lower) use self::builder::set_prototype;
pub(crate) use self::literal::lower_object_literal;
use super::FunctionLowering;
use crate::ir::{LayoutId, ValueId};

pub(crate) struct ObjectBuilder {
    layout: LayoutId,
    state: ObjectState,
    // `FinishObject` closes a `NewObject`: a dictionary and a copy have none to close.
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // Each object of a record of data has a layout, so a literal of constants that holds a dictionary is built by operations.
    pub(crate) fn begin_object(&mut self, layout: LayoutId) -> ObjectBuilder {
        ObjectBuilder {
            layout,
            state: ObjectState::Pending(InitialFields::default()),
            is_finished: false,
        }
    }

    // The layout has no field, so every member is defined by name.
    pub(crate) fn begin_dictionary(&mut self) -> ObjectBuilder {
        let head = self.builder.new_dictionary();
        ObjectBuilder {
            layout: self.file.untyped_layout(&[]),
            state: ObjectState::Open { head },
            is_finished: true,
        }
    }

    // The copy makes the object, with the layout of the source where that is a record. Every later member is defined by name.
    pub(crate) fn begin_copy(&mut self, source: ValueId) -> ObjectBuilder {
        let head = self.builder.copy_object(source, &[], &[]);
        ObjectBuilder {
            layout: self.file.untyped_layout(&[]),
            state: ObjectState::Open { head },
            is_finished: true,
        }
    }

    pub(crate) fn add_spread(&mut self, object: &mut ObjectBuilder, source: ValueId) {
        let head = self.open_head(object);
        self.builder.copy_data_properties(head, source, &[], &[]);
    }
}

pub(crate) fn finish_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    mut object: ObjectBuilder,
) -> ValueId {
    lowering.finish_head(&mut object);
    lowering.open_head(&mut object)
}
