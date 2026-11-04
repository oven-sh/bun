use bun_sema::hir::ExprId;
use smallvec::SmallVec;

use super::{ObjectBuilder, ObjectState, WaitingElement};
use crate::ir::{LayoutId, PropertyKeyId, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::{FunctionLowering, convert};

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
            self.builder.set_literal_prototype(head, prototype, false);
        }
        object.state = ObjectState::Open { head };
        head
    }

    /// In front of whatever may define a member under one of their keys, where the later definition holds, and of whatever ends the run of code that the literal began in.
    pub(super) fn define_waiting_elements(&mut self, object: &mut ObjectBuilder) {
        if object.waiting_elements.is_empty() {
            return;
        }
        let head = self.open_head(object);
        let position = self.position();
        for element in std::mem::take(&mut object.waiting_elements) {
            self.set_position(element.position);
            self.emit_define(head, PropertyName::Constant(element.key), element.value);
        }
        self.set_position(position);
    }

    pub(super) fn finish_head(&mut self, object: &mut ObjectBuilder) {
        self.define_waiting_elements(object);
        let head = self.open_head(object);
        if object.is_finished {
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
        let mut excluded_keys: SmallVec<[PropertyKeyId; 4]> = SmallVec::new();
        let mut excluded_values: SmallVec<[ValueId; 4]> = SmallVec::new();
        for &name in excluded {
            match name {
                PropertyName::Constant(key) => excluded_keys.push(key),
                PropertyName::Computed(value) => excluded_values.push(value),
            }
        }
        // In an object of a layout every property that the layout does not list lies beside the fields.
        let Some(layout) = layout.filter(|&layout| self.file.lists_some_field(layout)) else {
            let (keys, values) = (&excluded_keys, &excluded_values);
            return self.builder.copy_object(source, keys, values, false);
        };
        self.file.fragment.note_allocation(layout);
        let head = self.builder.new_object(layout, &[], None, &[]);
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
    lowering
        .builder
        .set_literal_prototype(head, prototype, false);
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn add_property(
        &mut self,
        object: &mut ObjectBuilder,
        name: PropertyName,
        mut value: ValueId,
        source: Option<ExprId>,
    ) {
        let field = match name {
            PropertyName::Constant(key) if self.file.find_element_index(key).is_some() => {
                self.file.fragment.note_write(key);
                let position = self.position();
                object.waiting_elements.push(WaitingElement {
                    key,
                    value,
                    position,
                });
                if !self.may_wait_with(object.waiting_elements.len()) {
                    self.define_waiting_elements(object);
                }
                return;
            }
            PropertyName::Constant(key) => {
                self.file.fragment.note_write(key);
                self.file.find_field(object.layout, key)
            }
            PropertyName::Computed(_) => {
                self.define_waiting_elements(object);
                None
            }
        };
        if let Some(field) = field {
            let position = self.file.field_position(object.layout, field);
            value = self.convert_initializer(value, position, source);
            if let ObjectState::Pending(initial) = &mut object.state {
                if convert::establishes_type(position)
                    && !initial.contains(field)
                    && self.may_wait_with(initial.values.len())
                {
                    initial.add(field, value);
                    return;
                }
            }
        }
        let head = self.open_head(object);
        self.emit_define(head, name, value);
    }
}
