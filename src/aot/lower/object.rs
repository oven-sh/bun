mod builder;
mod emitted_enum;
mod literal;

use smallvec::SmallVec;

pub(in crate::lower) use self::builder::set_prototype;
pub(in crate::lower) use self::emitted_enum::EnumsThatStayAsBorn;
pub(crate) use self::literal::lower_object_literal;
use super::FunctionLowering;
use crate::ir::{LayoutId, PropertyKeyId, ValueId};

pub(crate) struct ObjectBuilder {
    layout: LayoutId,
    state: ObjectState,
    is_finished: bool,
    waiting_elements: SmallVec<[WaitingElement; 2]>,
}

struct WaitingElement {
    key: PropertyKeyId,
    value: ValueId,
    position: u32,
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
    pub(crate) fn begin_object(&mut self, layout: LayoutId) -> ObjectBuilder {
        ObjectBuilder {
            layout,
            state: ObjectState::Pending(InitialFields::default()),
            is_finished: false,
            waiting_elements: SmallVec::new(),
        }
    }

    pub(crate) fn begin_dictionary(&mut self) -> ObjectBuilder {
        let head = self.builder.new_dictionary();
        ObjectBuilder {
            layout: self.file.untyped_layout(&[]),
            state: ObjectState::Open { head },
            is_finished: true,
            waiting_elements: SmallVec::new(),
        }
    }

    pub(crate) fn begin_copy(&mut self, source: ValueId) -> ObjectBuilder {
        let head = self.builder.copy_object(source, &[], &[], false);
        ObjectBuilder {
            layout: self.file.untyped_layout(&[]),
            state: ObjectState::Open { head },
            is_finished: true,
            waiting_elements: SmallVec::new(),
        }
    }

    pub(crate) fn add_spread(&mut self, object: &mut ObjectBuilder, source: ValueId) {
        self.define_waiting_elements(object);
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
