//! References, structs and arrays.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, EffectFlags, Effects, Heap, Input, PatchpointData, Type, Value,
};
use bun_engine_wasm_format::{
    AbstractHeapType, DataIndex, ElemIndex, FuncIndex, HeapType, RefType, StorageType, TypeIndex,
    ValType, VisitReference,
};

use super::emit::Sites;
use super::translator::{NONE, Operand, Translator, Visited, ir_type};
use crate::abi::{INT32_TAG, NULL, Operation, Trap, object};

/// What holds for a value wherever it is used.
#[derive(Clone, Copy)]
pub(super) enum Fact {
    Function(FuncIndex),
    NewStruct(TypeIndex),
    NewArray { ty: TypeIndex, length: Value },
}

#[derive(Default)]
pub(super) struct Facts(Vec<(Value, Fact)>);

impl Facts {
    pub(super) fn clear(&mut self) {
        self.0.clear();
    }

    /// `value` is newer than those before.
    pub(super) fn add(&mut self, value: Value, fact: Fact) {
        debug_assert!(self.0.last().is_none_or(|&(last, _)| last < value));
        self.0.push((value, fact));
    }

    pub(super) fn of(&self, value: Value) -> Option<Fact> {
        let position = self.0.binary_search_by_key(&value, |&(known, _)| known);
        position.ok().map(|position| self.0[position].1)
    }
}

/// A field or an element.
#[derive(Clone, Copy)]
pub(super) struct Part {
    ty: StorageType,
    cell: Value,
    address: Value,
    offset: i32,
    access: Access,
}

/// The displacement that every target folds into an access: an unscaled one reaches 255 bytes. Up to here the address
/// of the access is the cell, and a register holds it; beyond, the sum may be materialized in its place.
const LEAST_REACH: i32 = 256;

impl Part {
    fn is_at_derived_address(&self) -> bool {
        self.address != self.cell || self.offset >= LEAST_REACH
    }
}

impl Operand {
    pub(super) fn reference_type(self) -> RefType {
        self.ty.as_ref().expect("the code was validated")
    }

    pub(super) fn non_null(self) -> Self {
        let ty = self.reference_type().heap_type().non_null().into();
        Self { ty, ..self }
    }
}

impl Translator<'_> {
    pub(super) fn type_of_reference_to(&self, func: FuncIndex) -> ValType {
        let ty = self.module.func_type_index(func);
        self.types.heap_type(ty).non_null().into()
    }

    /// From here on the value has the type of the operand.
    pub(super) fn refine(&mut self, operand: Operand) {
        if operand.local != NONE {
            (self.locals).refine(self.types, operand.local, operand.typed());
        }
    }

    /// On the way that `leave` takes it has, and from here on it has the type that it had.
    pub(super) fn refine_for<T>(
        &mut self,
        operand: Option<Operand>,
        leave: impl FnOnce(&mut Self) -> T,
    ) -> T {
        let Some(operand) = operand.filter(|it| it.local != NONE) else {
            return leave(self);
        };
        let before = (self.locals).refine(self.types, operand.local, operand.typed());
        let result = leave(self);
        if let Some(before) = before {
            self.locals.set(operand.local, before);
        }
        result
    }

    pub(super) fn is_null(&mut self, operand: Operand) -> Value {
        if operand.reference_type().is_nullable() {
            self.b.equal(operand.value, NULL)
        } else {
            self.b.const32(0)
        }
    }

    pub(super) fn check_not_null(&mut self, operand: Operand, trap: Trap) {
        let is_null = self.is_null(operand);
        self.trap_if(is_null, trap);
        self.refine(operand.non_null());
    }

    /// The flags for an access to an object that starts at `offset`.
    pub(super) fn flags_for_access(&mut self, object: Operand, offset: i32) -> AccessFlags {
        let faults = ((NULL + offset) as u32) < self.env.host.null_guard_size;
        let may_be_null = object.reference_type().is_nullable();
        if may_be_null && faults && !self.b.op(object.value).is_constant() {
            self.refine(object.non_null());
            return AccessFlags::TRAPS;
        }
        self.check_not_null(object, Trap::NullReference);
        AccessFlags::empty()
    }

    /// `known`, or what the operation gives if that is zero.
    pub(super) fn or_make(&mut self, known: Value, operation: Operation, args: &[Value]) -> Value {
        let (done, result) = self.skip_with(known, known);
        let made = self.call_operation(operation, args, Type::I64, self.named.tables);
        self.b.jump(done, &[made]);
        self.b.switch_to(done);
        result
    }

    // The collector

    pub(super) fn may_be_cell(&self, operand: Operand) -> bool {
        let is_cell_type = |ty: RefType| !ty.heap_type().is(AbstractHeapType::I31);
        operand.ty.as_ref().is_some_and(is_cell_type) && !self.b.op(operand.value).is_constant()
    }

    /// Up to here, and until `loaded` is. What an address is computed from need not point into the cell.
    pub(super) fn keep_alive(&mut self, cell: Value, loaded: Option<Value>) {
        let effects = Effects::with_flags(EffectFlags::KEPT);
        let data = PatchpointData::new(Action::Custom, Sites::NOTHING, effects);
        let operands = [cell, loaded.unwrap_or(cell)].map(|it| (it, Input::ColdAnywhere));
        let operands = &operands[..1 + usize::from(loaded.is_some())];
        let keeper = self.b.patchpoint(&data, operands, &[]);
        self.escapes.note_servant(keeper, cell);
    }

    pub(super) fn barrier_threshold(&mut self) -> Value {
        let address = (self.b).const64(self.env.host.barrier_threshold_address as i64);
        let access = Access::new(self.named.collector, AccessFlags::ALWAYS_READABLE);
        (self.b).load_narrow(Size::S8, Sign::Unsigned, address, 0, access)
    }

    /// Follows a store to the part of the cell that is in `heap`.
    pub(super) fn write_barrier(&mut self, cell: Value, stored: Operand, heap: Heap) {
        if !self.may_be_cell(stored) {
            return;
        }
        if cell == self.fresh_object {
            return self.finish_initialization(cell);
        }
        self.emit_write_barrier(cell, heap);
    }

    fn emit_write_barrier(&mut self, cell: Value, heap: Heap) {
        // The collector may get to it from here.
        self.fresh_object = Value::NONE;
        let threshold = self.barrier_threshold();
        let mut effects = Effects::with_flags(EffectFlags::KEPT | EffectFlags::CONTROL_DEPENDENT);
        effects.reads = heap;
        let mut data = PatchpointData::new(Action::Custom, Sites::WRITE_BARRIER, effects);
        data.scratch_gprs = 1;
        let operands = [(cell, Input::LateRegister), (threshold, Input::Register)];
        let barrier = self.b.patchpoint(&data, &operands, &[]);
        self.escapes.note_servant(barrier, cell);
    }

    // Fields and elements

    fn load_part(&mut self, part: Part, sign: Option<Sign>) -> Visited {
        let Part {
            ty,
            address,
            offset,
            access,
            ..
        } = part;
        let value = match ty.packed_size() {
            Some(size) => {
                let sign = sign.unwrap_or(Sign::Unsigned);
                self.b.load_narrow(size, sign, address, offset, access)
            }
            None => (self.b).load(ir_type(ty.unpacked()), address, offset, access),
        };
        // Also for the fresh object: other than a store, a load can be put off.
        if part.is_at_derived_address() {
            self.keep_alive(part.cell, Some(value));
        }
        self.push(value, ty.unpacked());
        Ok(())
    }

    pub(super) fn store_part(&mut self, part: Part, value: Value) {
        match part.ty.packed_size() {
            Some(size) => (self.b).store_sized(size, value, part.address, part.offset, part.access),
            None => self.b.store(value, part.address, part.offset, part.access),
        }
    }

    fn change_part(&mut self, part: Part, value: Operand) -> Visited {
        self.store_part(part, value.value);
        if part.is_at_derived_address() && part.cell != self.fresh_object {
            self.keep_alive(part.cell, None);
        }
        self.write_barrier(part.cell, value, part.access.heap());
        Ok(())
    }

    /// One below `ty` says more about fields and elements.
    fn least_type(&self, object: Operand, ty: TypeIndex) -> TypeIndex {
        let known = object.reference_type().heap_type();
        let is_below = |_: &TypeIndex| self.types.is_heap_subtype(known, self.types.heap_type(ty));
        known.index().filter(is_below).unwrap_or(ty)
    }

    pub(super) fn field(&mut self, ty: TypeIndex, object: Operand, field: u32) -> Part {
        let ty = self.least_type(object, ty);
        let data = self.types.struct_type(ty).fields[field as usize];
        let offset = object::FIELDS + data.offset as i32;
        let heap = self.heaps.field(self.b.function, self.types, ty, field);
        Part {
            ty: data.ty.storage,
            cell: object.value,
            address: object.value,
            offset,
            access: Access::new(heap, self.flags_for_access(object, offset)),
        }
    }

    pub(super) fn array_length(&mut self, array: Operand) -> Value {
        if let Some(Fact::NewArray { length, .. }) = self.facts.of(array.value) {
            return length;
        }
        let flags = self.flags_for_access(array, object::LENGTH) | AccessFlags::IMMUTABLE;
        let access = Access::new(Heap::NOTHING, flags);
        self.b.load(Type::I32, array.value, object::LENGTH, access)
    }

    /// `index` is within bounds.
    pub(super) fn element(&mut self, ty: TypeIndex, array: Value, index: Value) -> Part {
        self.b.indexes_objects = true;
        let storage = self.types.array_type(ty).element.storage;
        let index = self.b.zero_extend(index);
        let distance = self.b.shl(index, i32::from(storage.log2_size()));
        let first = object::elements(storage);
        let constant = (self.b.int_constant(distance))
            .and_then(|distance| i32::try_from(distance + i64::from(first)).ok());
        let (address, offset) = match constant {
            Some(offset) => (array, offset),
            None => (self.b.add(array, distance), first),
        };
        Part {
            ty: storage,
            cell: array,
            address,
            offset,
            access: (self.heaps.field(self.b.function, self.types, ty, 0)).into(),
        }
    }

    fn checked_element(&mut self, ty: TypeIndex, array: Operand, index: Value, trap: Trap) -> Part {
        let length = self.array_length(array);
        let is_outside = self.b.above_or_equal(index, length);
        self.trap_if(is_outside, trap);
        self.element(self.least_type(array, ty), array.value, index)
    }

    fn new_array_from_segment(
        &mut self,
        operation: Operation,
        ty: TypeIndex,
        segment: u32,
    ) -> Visited {
        let length = self.stack[self.stack.len() - 1].value;
        let (immediates, writes) = ([ty.0, segment], self.named.tables);
        let array = self.call_for_instruction::<2>(operation, &immediates, Type::I64, writes);
        self.push_new_array(array, ty, length);
        Ok(())
    }

    /// The address of the element at `start`.
    fn range_of_array(
        &mut self,
        ty: TypeIndex,
        [array, length]: [Value; 2],
        start: Value,
        count: Value,
        trap: Trap,
    ) -> Value {
        let [first, count, length] = [start, count, length].map(|it| self.b.zero_extend(it));
        let end = self.b.add(first, count);
        let is_outside = self.b.above(end, length);
        self.trap_if(is_outside, trap);
        let element = self.element(ty, array, start);
        self.b.add(element.address, element.offset)
    }

    fn size_of_elements(&mut self, storage: StorageType, count: Value) -> Value {
        let count = self.b.zero_extend(count);
        self.b.shl(count, i32::from(storage.log2_size()))
    }

    fn fill_array(&mut self, ty: TypeIndex) {
        let [dst, value, count] = self.pop_values();
        let array = self.pop();
        let storage = self.types.array_type(ty).element.storage;
        let heap = self.heaps.field(self.b.function, self.types, ty, 0);
        let is_zero = self.b.constant_bits(value) == Some(0);
        if storage != StorageType::I8 && !is_zero {
            let [low, high] = self.bits_of(value);
            let args = [array.value, dst, low, high, count];
            self.call_operation(Operation::ArrayFill, &args, Type::Void, heap);
            return;
        }
        let array = [array.value, self.array_length(array)];
        let to = self.range_of_array(ty, array, dst, count, Trap::ArrayFillOutOfBounds);
        let byte = if is_zero { self.b.const32(0) } else { value };
        let size = self.size_of_elements(storage, count);
        self.call_for_bytes(self.env.stubs.fill_bytes, [to, byte, size], heap);
        self.keep_alive(array[0], None);
    }

    fn copy_array(&mut self, dst_type: TypeIndex, src_type: TypeIndex) {
        let (count, src, from) = (self.pop_value(), self.pop_value(), self.pop());
        let (dst, to) = (self.pop_value(), self.pop());
        let storage = self.types.array_type(dst_type).element.storage;
        let heap = self.heaps.field(self.b.function, self.types, dst_type, 0);
        let lengths = [to, from].map(|array| self.array_length(array));
        let trap = Trap::ArrayCopyOutOfBounds;
        let target = self.range_of_array(dst_type, [to.value, lengths[0]], dst, count, trap);
        let source = self.range_of_array(src_type, [from.value, lengths[1]], src, count, trap);
        let args = [target, source, self.size_of_elements(storage, count)];
        let move_at_once = |this: &mut Self| {
            this.call_for_bytes(this.env.stubs.move_bytes, args, heap);
            this.keep_alive(to.value, None);
            this.keep_alive(from.value, None);
        };
        if !storage.is_ref() {
            return move_at_once(self);
        }
        let [at_once, singly, done] = [(); 3].map(|()| self.b.new_block());
        let is_collecting = self.barrier_threshold();
        self.b.branch(is_collecting, singly.rare(), at_once);
        self.b.switch_to(singly);
        let operands = [to.value, dst, from.value, src, count];
        self.call_operation(Operation::ArrayCopy, &operands, Type::Void, heap);
        self.b.jump(done, &[]);
        self.b.switch_to(at_once);
        move_at_once(self);
        self.emit_write_barrier(to.value, heap);
        self.b.jump(done, &[]);
        self.b.switch_to(done);
    }

    fn convert_reference(&mut self, value: Value, from: RefType, to: AbstractHeapType) -> Visited {
        self.push(value, RefType::new(HeapType::of(to), from.is_nullable()));
        Ok(())
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitReference for Translator<'_> {
    fn ref_null(&mut self, ty: HeapType) -> Visited {
        let null = self.default_value(ty.nullable().into());
        self.push(null.value, null.ty);
        Ok(())
    }

    fn ref_is_null(&mut self) -> Visited {
        let operand = self.pop();
        let result = self.is_null(operand);
        self.note_test(result, operand, operand.ty, operand.non_null().ty);
        self.push_comparison(result);
        Ok(())
    }

    fn ref_func(&mut self, func: FuncIndex) -> Visited {
        let offset = self.env.layout.function_reference(func);
        let heap = self.named.function_references;
        let known = self.load_readable(Type::I64, self.instance, offset, heap);
        let args = [self.b.const32(func.0 as i32)];
        let value = self.or_make(known, Operation::RefFunc, &args);
        self.facts.add(value, Fact::Function(func));
        self.push(value, self.type_of_reference_to(func));
        Ok(())
    }

    fn ref_eq(&mut self) -> Visited {
        let [lhs, rhs] = self.pop_values();
        let result = self.b.equal(lhs, rhs);
        self.push_comparison(result);
        Ok(())
    }

    fn ref_as_non_null(&mut self) -> Visited {
        let operand = self.pop();
        self.check_not_null(operand, Trap::NullAsNonNull);
        self.stack.push(operand.non_null());
        Ok(())
    }

    fn ref_test(&mut self, ty: RefType) -> Visited {
        self.test_type(ty);
        Ok(())
    }

    fn ref_cast(&mut self, ty: RefType) -> Visited {
        self.cast(ty);
        Ok(())
    }

    fn ref_i31(&mut self) -> Visited {
        let value = self.pop_value();
        let doubled = self.b.shl(value, 1);
        let extended = self.b.sar(doubled, 1);
        let wide = self.b.zero_extend(extended);
        let result = self.b.or(wide, INT32_TAG);
        self.push(result, HeapType::I31.non_null());
        Ok(())
    }

    fn i31_get(&mut self, sign: Sign) -> Visited {
        let operand = self.pop();
        self.check_not_null(operand, Trap::NullI31);
        let mut result = self.b.wrap(operand.value);
        if sign == Sign::Unsigned {
            result = self.b.and(result, i32::MAX);
        }
        self.push(result, ValType::I32);
        Ok(())
    }

    fn any_convert_extern(&mut self) -> Visited {
        let operand = self.pop();
        let tag = self.b.and(operand.value, INT32_TAG);
        let value = if self.b.is_int_constant(tag, 0) {
            operand.value
        } else {
            let is_no_number = self.b.is_zero(tag);
            let (done, result) = self.skip_with(is_no_number, operand.value);
            let (operation, args) = (Operation::AnyConvertExtern, [operand.value]);
            let converted = self.call_operation(operation, &args, Type::I64, Heap::NOTHING);
            self.b.jump(done, &[converted]);
            self.b.switch_to(done);
            result
        };
        self.convert_reference(value, operand.reference_type(), AbstractHeapType::Any)
    }

    fn extern_convert_any(&mut self) -> Visited {
        let operand = self.pop();
        let from = operand.reference_type();
        self.convert_reference(operand.value, from, AbstractHeapType::Extern)
    }

    fn struct_new(&mut self, ty: TypeIndex) -> Visited {
        let values = self.pop_many(self.types.struct_type(ty).fields.len());
        self.new_struct(ty, Some(values));
        Ok(())
    }

    fn struct_new_default(&mut self, ty: TypeIndex) -> Visited {
        self.new_struct(ty, None);
        Ok(())
    }

    fn struct_get(&mut self, ty: TypeIndex, field: u32, sign: Option<Sign>) -> Visited {
        let object = self.pop();
        let part = self.field(ty, object, field);
        self.load_part(part, sign)
    }

    fn struct_set(&mut self, ty: TypeIndex, field: u32) -> Visited {
        let (value, object) = (self.pop(), self.pop());
        let part = self.field(ty, object, field);
        self.change_part(part, value)
    }

    fn array_new(&mut self, ty: TypeIndex) -> Visited {
        let (length, value) = (self.pop_value(), self.pop());
        self.new_filled_array(ty, Some(value), length);
        Ok(())
    }

    fn array_new_default(&mut self, ty: TypeIndex) -> Visited {
        let length = self.pop_value();
        self.new_filled_array(ty, None, length);
        Ok(())
    }

    fn array_new_fixed(&mut self, ty: TypeIndex, length: u32) -> Visited {
        let values = self.pop_many(length as usize);
        self.new_array_of(ty, &values);
        Ok(())
    }

    fn array_new_data(&mut self, ty: TypeIndex, data: DataIndex) -> Visited {
        self.new_array_from_segment(Operation::ArrayNewData, ty, data.0)
    }

    fn array_new_elem(&mut self, ty: TypeIndex, elem: ElemIndex) -> Visited {
        self.new_array_from_segment(Operation::ArrayNewElem, ty, elem.0)
    }

    fn array_get(&mut self, ty: TypeIndex, sign: Option<Sign>) -> Visited {
        let (index, array) = (self.pop_value(), self.pop());
        let part = self.checked_element(ty, array, index, Trap::ArrayGetOutOfBounds);
        self.load_part(part, sign)
    }

    fn array_set(&mut self, ty: TypeIndex) -> Visited {
        let (value, index, array) = (self.pop(), self.pop_value(), self.pop());
        let part = self.checked_element(ty, array, index, Trap::ArraySetOutOfBounds);
        self.change_part(part, value)
    }

    fn array_len(&mut self) -> Visited {
        let array = self.pop();
        let length = self.array_length(array);
        self.push(length, ValType::I32);
        Ok(())
    }

    fn array_fill(&mut self, ty: TypeIndex) -> Visited {
        self.fill_array(ty);
        Ok(())
    }

    fn array_copy(&mut self, dst: TypeIndex, src: TypeIndex) -> Visited {
        self.copy_array(dst, src);
        Ok(())
    }

    fn array_init_data(&mut self, ty: TypeIndex, data: DataIndex) -> Visited {
        let writes = self.heaps.field(self.b.function, self.types, ty, 0);
        self.call_for_instruction::<4>(Operation::ArrayInitData, &[data.0], Type::Void, writes);
        Ok(())
    }

    fn array_init_elem(&mut self, _: TypeIndex, elem: ElemIndex) -> Visited {
        let writes = self.named.mutable;
        self.call_for_instruction::<4>(Operation::ArrayInitElem, &[elem.0], Type::Void, writes);
        Ok(())
    }
}
