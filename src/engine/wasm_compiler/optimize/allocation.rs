//! New structs and arrays.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{
    Action, EffectFlags, Effects, Heap, Input, Lanes, Output, PatchpointData, Type, Value,
};
use bun_engine_wasm_format::{StorageType, TypeIndex};

use super::emit::{Site, Sites};
use super::references::{Fact, Part};
use super::translator::{Operand, Operands, Translator};
use crate::abi::{AllocatorLayout, Operation, object};
use crate::allocation::LARGEST_CLEARED_IN_LINE;

const MOST_ELEMENTS_STORED_SINGLY: u64 = 8;

impl Translator<'_> {
    fn emit_allocation(
        &mut self,
        site: Site,
        operands: &[(Value, Input)],
        scratch_gprs: u8,
    ) -> Value {
        let effects = Effects {
            reads: Heap::EVERYTHING,
            writes: self.named.collector,
            flags: EffectFlags::EXITS | EffectFlags::CONTROL_DEPENDENT,
        };
        let mut data = PatchpointData::new(Action::Custom, self.sites.add(site), effects);
        data.scratch_gprs = scratch_gprs;
        (self.b).patchpoint(&data, operands, &[(Type::I64, Output::EarlyRegister)])
    }

    /// Fields and elements hold anything. `None` if the object is too large for the allocators.
    fn allocate(&mut self, ty: TypeIndex, size: u64, length: Option<u32>) -> Option<Value> {
        let allocators = &self.env.host.allocators;
        let (allocator, cell_size) = allocators.for_size(u32::try_from(size).ok()?)?;
        let site = Site::New {
            ty,
            allocator,
            cell_size,
            length,
        };
        Some(self.emit_allocation(site, &[], 2))
    }

    fn push_new(&mut self, object: Value, ty: TypeIndex, fact: Fact) {
        self.facts.add(object, fact);
        self.fresh_object = object;
        self.push(object, self.types.heap_type(ty).non_null());
    }

    pub(super) fn push_new_array(&mut self, array: Value, ty: TypeIndex, length: Value) {
        self.push_new(array, ty, Fact::NewArray { ty, length });
    }

    fn is_default(&mut self, operand: Operand) -> bool {
        self.default_value(operand.ty).value == operand.value
    }

    /// For the object on top of the stack, which has just been made.
    fn initialize(
        &mut self,
        values: &[Operand],
        has_defaults: bool,
        part: impl Fn(&mut Self, Operand, u32) -> Part,
    ) {
        let object = self.stack[self.stack.len() - 1];
        for (index, &value) in (0..).zip(values) {
            if !has_defaults || !self.is_default(value) {
                let part = part(self, object, index);
                self.store_part(part, value.value);
            }
        }
        if !has_defaults || values.iter().any(|&value| self.may_be_cell(value)) {
            self.finish_initialization(object.value);
        }
    }

    fn defaults(&mut self, types: impl Iterator<Item = StorageType>) -> Operands {
        let default = |ty: StorageType| {
            let default = self.default_value(ty.unpacked());
            Operand::new(default.value, default.ty)
        };
        types.map(default).collect()
    }

    /// Without `values` the fields get their defaults.
    pub(super) fn new_struct(&mut self, ty: TypeIndex, values: Option<Operands>) {
        let data = self.types.struct_type(ty);
        let size = object::FIELDS as u32 + data.size;
        let is_inline = values.is_some() || data.size <= LARGEST_CLEARED_IN_LINE;
        let allocated = is_inline.then(|| self.allocate(ty, size.into(), None));
        let allocated = allocated.flatten();
        let object = allocated.unwrap_or_else(|| {
            let (operation, writes) = (Operation::StructNew, self.named.collector);
            self.call_for_instruction::<0>(operation, &[ty.0], Type::I64, writes)
        });
        self.escapes.watch(allocated);
        self.push_new(object, ty, Fact::NewStruct(ty));
        if values.is_none() && allocated.is_none() {
            return;
        }
        let fields = data.fields.iter().map(|field| field.ty.storage);
        let values = values.unwrap_or_else(|| self.defaults(fields));
        self.initialize(&values, allocated.is_none(), |this, object, index| {
            this.field(ty, object, index)
        });
    }

    pub(super) fn new_array_of(&mut self, ty: TypeIndex, values: &[Operand]) {
        let storage = self.types.array_type(ty).element.storage;
        let count = values.len() as u32;
        let size = object::elements(storage) as u64 + (u64::from(count) << storage.log2_size());
        let length = self.b.const32(count as i32);
        let allocated = self.allocate(ty, size, Some(count));
        let array = allocated.unwrap_or_else(|| {
            let (args, writes) = ([self.b.const32(ty.0 as i32), length], self.named.collector);
            self.call_operation(Operation::ArrayNewDefault, &args, Type::I64, writes)
        });
        self.escapes.watch(allocated);
        self.push_new_array(array, ty, length);
        self.initialize(values, allocated.is_none(), |this, array, index| {
            let index = this.b.const32(index as i32);
            this.element(ty, array.value, index)
        });
    }

    /// Without `value` the elements get their default.
    pub(super) fn new_filled_array(
        &mut self,
        ty: TypeIndex,
        value: Option<Operand>,
        length: Value,
    ) {
        let storage = self.types.array_type(ty).element.storage;
        let value = value.unwrap_or_else(|| self.defaults([storage].into_iter())[0]);
        if let Some(count @ ..=MOST_ELEMENTS_STORED_SINGLY) = self.b.constant_bits(length) {
            return self.new_array_of(ty, &Operands::from_elem(value, count as usize));
        }
        let is_default = self.is_default(value);
        let [low, high] = self.bits_of(value.value);
        let step = 1 << AllocatorLayout::STEP_LOG2;
        let array = if storage.size_in_bytes() == step && !is_default {
            let args = [self.b.const32(ty.0 as i32), low, high, length];
            self.call_operation(Operation::ArrayNew, &args, Type::I64, self.named.collector)
        } else {
            let pattern = self.repeated(storage, low);
            let operands = [length, pattern, low].map(|value| (value, Input::LateRegister));
            let operands = &operands[..if is_default { 2 } else { 3 }];
            self.emit_allocation(Site::NewFilled(ty), operands, 3)
        };
        self.push_new_array(array, ty, length);
        self.finish_initialization(array);
    }

    /// `low` has the bits of an element, or of the low half of one that is zero.
    fn repeated(&mut self, storage: StorageType, low: Value) -> Value {
        let lanes = [Size::S8, Size::S16, Size::S32, Size::S64, Size::S64];
        let lanes = lanes[usize::from(storage.log2_size())];
        let Some(bits) = self.b.constant_bits(low) else {
            return self.b.splat(Lanes::Int(lanes), low);
        };
        let greatest = u128::MAX >> (128 - lanes.bits());
        (self.b).const_v128((u128::from(bits) & greatest) * (u128::MAX / greatest))
    }

    /// The low and the high half.
    pub(super) fn bits_of(&mut self, value: Value) -> [Value; 2] {
        match self.b.type_of(value) {
            Type::V128 => [0, 1].map(|lane| {
                (self.b).extract_lane(Lanes::Int(Size::S64), Sign::Unsigned, value, lane)
            }),
            Type::F32 | Type::F64 => [self.b.bitcast(value), self.b.const64(0)],
            _ => [value, self.b.const64(0)],
        }
    }

    /// Keeps the stores to a new object ahead of those that let the collector see it.
    pub(super) fn finish_initialization(&mut self, object: Value) {
        if cfg!(target_arch = "x86_64") {
            self.b.fence(Heap::EVERYTHING, Heap::NOTHING);
        } else {
            let threshold = self.barrier_threshold();
            let mut effects = Effects::with_flags(EffectFlags::KEPT);
            effects.reads = Heap::EVERYTHING;
            let data = PatchpointData::new(Action::Custom, Sites::PUBLISH, effects);
            (self.b).patchpoint(&data, &[(threshold, Input::Register)], &[]);
        }
        let fence = self.b.last(self.b.block());
        self.escapes.note_servant(fence, object);
    }
}
