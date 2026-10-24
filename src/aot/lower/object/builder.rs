use bun_sema::hir::ExprId;
use smallvec::SmallVec;

use super::{ObjectBuilder, ObjectState};
use crate::ir::{LayoutId, PropertyKeyId, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::{FunctionLowering, convert};

fn define_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    name: PropertyName,
    value: ValueId,
) {
    let head = lowering.open_head(object);
    lowering.emit_define(head, name, value);
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn open_head(&mut self, object: &mut ObjectBuilder) -> ValueId {
        let initial = match &object.state {
            ObjectState::Pending(initial) => initial,
            ObjectState::Open { head } => return *head,
        };
        self.file.fragment.note_allocation(object.layout);
        let head = self
            .builder
            .new_object(object.layout, &initial.fields, None, &initial.values);
        if let Some(prototype) = initial.prototype {
            self.builder.set_literal_prototype(head, prototype);
        }
        object.state = ObjectState::Open { head };
        head
    }

    pub(super) fn finish_head(&mut self, object: &mut ObjectBuilder) {
        let head = self.open_head(object);
        if object.is_dictionary || object.is_finished {
            return;
        }
        let head = self.builder.finish_object(head);
        object.state = ObjectState::Open { head };
        object.is_finished = true;
    }

    pub(crate) fn emit_object_rest(
        &mut self,
        source: ValueId,
        excluded: &[PropertyName],
        layout: Option<LayoutId>,
    ) -> ValueId {
        let layout = layout.unwrap_or_else(|| self.file.untyped_layout(&[]));
        self.file.fragment.note_allocation(layout);
        let head = self.builder.new_object(layout, &[], None, &[]);
        let mut excluded_keys: SmallVec<[PropertyKeyId; 4]> = SmallVec::new();
        let mut excluded_values: SmallVec<[ValueId; 4]> = SmallVec::new();
        for &name in excluded {
            match name {
                PropertyName::Constant(key) => excluded_keys.push(key),
                PropertyName::Computed(value) => excluded_values.push(value),
            }
        }
        self.builder
            .copy_data_properties(head, source, &excluded_keys, &excluded_values);
        self.builder.finish_object(head)
    }
}

pub(in crate::lower) fn set_prototype(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    prototype: ValueId,
) {
    if let ObjectState::Pending(initial) = &mut object.state {
        if initial.prototype.is_none() {
            initial.prototype = Some(prototype);
            return;
        }
    }
    let head = lowering.open_head(object);
    lowering.builder.set_literal_prototype(head, prototype);
}

pub(super) fn add_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    name: PropertyName,
    value: ValueId,
    source: Option<ExprId>,
) {
    let field = match name {
        PropertyName::Constant(key) => {
            lowering.file.fragment.note_write(key);
            lowering.file.find_field(object.layout, key)
        }
        PropertyName::Computed(_) => None,
    };
    let Some(field) = field else {
        define_member(lowering, object, name, value);
        return;
    };
    let position = lowering.file.field_position(object.layout, field);
    let subject = convert::Int32Subject::LiteralProperty;
    lowering.describe_int32_flow(position, subject, source);
    let value = lowering.convert_initializer(value, position, source);
    if let ObjectState::Pending(initial) = &mut object.state {
        if convert::establishes_type(position) && !initial.contains(field) {
            initial.add(field, value);
            return;
        }
    }
    define_member(lowering, object, name, value);
}
