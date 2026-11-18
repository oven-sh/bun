//! New structs and arrays.

use bun_engine_asm::Bank;
use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::{StorageType, TypeIndex};

use super::calls::Parameter;
use super::{Compiled, Function};
use crate::abi::object::{self, FIELDS};
use crate::abi::{NULL, Operation, RESULT_GPRS};
use crate::allocation::{self, LARGEST_CLEARED_IN_LINE};

/// What the fields of a struct start with.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Values {
    OnStack,
    Defaults,
}

struct NewObject {
    cell: Gpr,
    /// Otherwise the fields or elements hold anything.
    has_defaults: bool,
}

impl Function<'_> {
    /// What an operation has made.
    pub(super) fn push_new(&mut self, ty: TypeIndex) {
        self.push_operation_result(self.module.types().heap_type(ty).non_null().into());
    }

    /// `length` is for an array.
    fn allocate(&mut self, ty: TypeIndex, size: u64, length: Option<u32>) -> NewObject {
        let operation = length.map_or(Operation::StructNew, |_| Operation::ArrayNewDefault);
        let (allocators, immediates) = (&self.env.host.allocators, [ty.0, length.unwrap_or(0)]);
        let class = (u32::try_from(size).ok()).and_then(|size| allocators.for_size(size));
        let Some(class) = class else {
            let parameters = immediates.map(|it| Parameter::Immediate(it.into()));
            self.call_operation(operation, &parameters);
            return NewObject {
                cell: RESULT_GPRS[0],
                has_defaults: true,
            };
        };
        let [cell, first, temp] = [(); 3].map(|()| self.take_gpr());
        let slow = self.masm.new_label();
        allocation::take_cell(&mut self.masm, self.env, class, cell, [first, temp], slow);
        let length = length.map(Into::into);
        allocation::write_header(&mut self.masm, self.env, ty, cell, temp, length);
        self.call_operation_at(slow, operation, &immediates.map(Into::into), Some(cell));
        NewObject {
            cell,
            has_defaults: false,
        }
    }

    fn publish(&mut self, ty: TypeIndex, cell: Gpr) {
        if cfg!(target_arch = "aarch64") {
            let threshold = Absolute(self.env.host.barrier_threshold_address);
            let done = self.masm.new_label();
            self.masm.branch_test8(TestCond::Zero, threshold, -1, done);
            self.masm.store_fence();
            self.masm.bind(done);
        }
        self.push_register(self.module.types().heap_type(ty).non_null().into(), cell);
    }

    /// Pops a value for each place in the object, the last first, and pushes the object.
    fn initialize(
        &mut self,
        ty: TypeIndex,
        new: &NewObject,
        places: impl Iterator<Item = (StorageType, i32)>,
    ) -> Compiled {
        for (storage, offset) in places {
            self.registers.locked = RegisterSet::of(&[new.cell], &[]);
            let value = self.pop();
            let default = if storage.is_ref() { NULL as u64 } else { 0 };
            if !new.has_defaults || value.constant() != Some(default) {
                self.store_field(storage, Address::new(new.cell, offset), value);
            }
        }
        self.publish(ty, new.cell);
        self.check_size()
    }

    pub(super) fn new_struct(&mut self, ty: TypeIndex, values: Values) -> Compiled {
        let data = self.module.types().struct_type(ty);
        if values == Values::Defaults && data.size > LARGEST_CLEARED_IN_LINE {
            self.call_operation(Operation::StructNew, &[Parameter::Immediate(ty.0.into())]);
            self.push_new(ty);
            return Ok(());
        }
        let new = self.allocate(ty, (FIELDS as u32 + data.size).into(), None);
        if values == Values::OnStack {
            let fields = data.fields.iter().rev();
            let places = fields.map(|field| (field.ty.storage, FIELDS + field.offset as i32));
            return self.initialize(ty, &new, places);
        }
        if !new.has_defaults {
            let references = self.module.types().rtt(ty).reference_offsets();
            for offset in (0..data.size).step_by(8) {
                let word = if references.contains(&offset) {
                    NULL
                } else {
                    0
                };
                (self.masm).store64(Address::new(new.cell, FIELDS + offset as i32), word);
            }
        }
        self.publish(ty, new.cell);
        Ok(())
    }

    pub(super) fn new_array_of_operands(&mut self, ty: TypeIndex, length: u32) -> Compiled {
        let storage = self.element_type(ty);
        let start = object::elements(storage);
        let size = start as u64 + (u64::from(length) << storage.log2_size());
        let new = self.allocate(ty, size, Some(length));
        let place = |index| (storage, start + (index << storage.log2_size()));
        self.initialize(ty, &new, (0..length as i32).rev().map(place))
    }

    pub(super) fn new_default_array(&mut self, ty: TypeIndex) {
        let length = self.pop_gpr();
        let [cell, temps @ ..] = [(); 4].map(|()| self.take_gpr());
        let pattern = self.take(Bank::Fpr).fpr();
        let word = if self.element_type(ty).is_ref() {
            NULL as u128
        } else {
            0
        };
        self.masm.move_vector_constant(pattern, word << 64 | word);
        let (slow, operands) = (self.masm.new_label(), (length, pattern));
        allocation::new_filled_array(&mut self.masm, self.env, ty, cell, operands, temps, slow);
        let arguments = [ty.0.into(), length.into()];
        self.call_operation_at(slow, Operation::ArrayNewDefault, &arguments, Some(cell));
        self.publish(ty, cell);
    }
}
