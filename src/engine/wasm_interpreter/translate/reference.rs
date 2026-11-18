//! References, structs and arrays.

use bun_engine_asm::{Cond, Sign, Width};
use bun_engine_wasm_compiler::abi::NULL;
use bun_engine_wasm_compiler::abi::object::FIELDS;
use bun_engine_wasm_format::{
    DataIndex, ElemIndex, FuncIndex, HeapType, RefType, StorageType, TypeIndex, TypeKind, ValKind,
    VisitReference,
};

use super::condition::Relation;
use super::emit::Register;
use super::memory::index;
use super::operands::{Effect, Operand, Place};
use super::{Done, Translator};
use crate::machine::Handler;
use crate::run::object::{self, Part};
use crate::run::{operation, reference};

const REF: Option<ValKind> = Some(ValKind::Ref);

impl Translator<'_> {
    /// It stays on the stack.
    pub(super) fn top_in_slot(&mut self) -> Done<u16> {
        let operand = *self.top();
        self.in_slot(operand, 0)
    }

    /// The record that stands for it.
    pub(super) fn record_for(&self, ty: RefType) -> u64 {
        let types = self.module.types();
        let of_objects = (ty.heap_type().index()).filter(|&it| types.kind(it) != TypeKind::Func);
        let header = of_objects.map_or(0, |it| self.module.layout().object_header(it));
        header as u64 | index(ty.value_type().to_bits())
    }

    fn field(&self, ty: TypeIndex, field: u32) -> (StorageType, u32) {
        let field = self.module.types().struct_type(ty).fields[field as usize];
        (field.ty.storage, FIELDS as u32 + field.offset)
    }

    fn element(&self, ty: TypeIndex) -> StorageType {
        self.module.types().array_type(ty).element.storage
    }

    fn for_elements(&self, ty: TypeIndex, scalars: Handler, vectors: Handler) -> Handler {
        match self.element(ty).unpacked().kind() {
            ValKind::V128 => vectors,
            _ => scalars,
        }
    }

    /// Of so many operands at the top.
    fn slots_of_top(&self, count: usize) -> u32 {
        self.free_slot() - self.slot_at(self.operands.len() - count)
    }

    fn did_write_part(&mut self, part: Part) {
        if part == Part::Reference {
            self.forget_last_results();
        }
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitReference for Translator<'_> {
    fn ref_null(&mut self, _: HeapType) -> Done {
        self.push_constant(ValKind::Ref, NULL as u64)
    }

    fn ref_is_null(&mut self) -> Done {
        let (value, place) = (self.pop(), Place::Constant(NULL as u64));
        let relation = Relation::Int(Width::W64, Cond::Eq);
        self.compare(relation, value, Operand { place, ..value })
    }

    fn ref_func(&mut self, func: FuncIndex) -> Done {
        self.operate(operation::ref_func, 0, func.0, None, REF)
    }

    fn ref_eq(&mut self) -> Done {
        let (rhs, lhs) = (self.pop(), self.pop());
        self.compare(Relation::Int(Width::W64, Cond::Eq), lhs, rhs)
    }

    fn ref_as_non_null(&mut self) -> Done {
        let value = self.top_in_slot()?;
        self.emit(reference::as_non_null, value, 0, 0)
    }

    fn ref_test(&mut self, ty: RefType) -> Done {
        let (value, _) = self.pop_in_slot()?;
        let result = (ValKind::I32, Effect::Forgets);
        self.produce_with(result, reference::test, value, 0, &[self.record_for(ty)])
    }

    fn ref_cast(&mut self, ty: RefType) -> Done {
        let value = self.top_in_slot()?;
        self.emit(reference::cast, value, 0, 0)?;
        self.forget_last_results();
        self.extend_wide(self.record_for(ty))
    }

    fn ref_i31(&mut self) -> Done {
        let (value, _) = self.pop_in_slot()?;
        self.produce(ValKind::Ref, reference::new_i31, value, 0)
    }

    fn i31_get(&mut self, sign: Sign) -> Done {
        let mask = match sign {
            Sign::Signed => u32::MAX,
            Sign::Unsigned => u32::MAX >> 1,
        };
        let (value, _) = self.pop_in_slot()?;
        self.produce(ValKind::I32, reference::i31_get, value, mask)
    }

    fn any_convert_extern(&mut self) -> Done {
        let ((value, _), result) = (self.pop_in_slot()?, (ValKind::Ref, Effect::Forgets));
        self.produce_with(result, reference::any_convert_extern, value, 0, &[])
    }

    fn extern_convert_any(&mut self) -> Done {
        Ok(())
    }

    fn struct_new(&mut self, ty: TypeIndex) -> Done {
        let count = self.module.types().struct_type(ty).fields.len();
        let slots = index(self.slots_of_top(count));
        self.operate(operation::struct_new, count, ty.0, Some(slots), REF)
    }

    fn struct_new_default(&mut self, ty: TypeIndex) -> Done {
        self.operate(operation::struct_new_default, 0, ty.0, None, REF)
    }

    fn struct_get(&mut self, ty: TypeIndex, field: u32, sign: Option<Sign>) -> Done {
        let ((storage, offset), (object, is_last)) = (self.field(ty, field), self.pop_in_slot()?);
        let handler = object::for_struct_get(Part::to_read(storage, sign), is_last);
        self.produce(storage.unpacked().kind(), handler, object, offset)
    }

    fn struct_set(&mut self, ty: TypeIndex, field: u32) -> Done {
        let ((storage, offset), [object, value]) = (self.field(ty, field), self.pop_in_slots()?);
        let part = Part::to_write(storage);
        self.did_write_part(part);
        self.emit(object::for_struct_set(part), object, value, offset)
    }

    fn array_new(&mut self, ty: TypeIndex) -> Done {
        let handler = self.for_elements(ty, operation::array_new, operation::array_of_vectors_new);
        self.operate(handler, 2, ty.0, None, REF)
    }

    fn array_new_default(&mut self, ty: TypeIndex) -> Done {
        self.operate(operation::array_new_default, 1, ty.0, None, REF)
    }

    fn array_new_fixed(&mut self, ty: TypeIndex, length: u32) -> Done {
        let counts = u64::from(length) | index(self.slots_of_top(length as usize));
        self.operate(
            operation::array_new_fixed,
            length as usize,
            ty.0,
            Some(counts),
            REF,
        )
    }

    fn array_new_data(&mut self, ty: TypeIndex, data: DataIndex) -> Done {
        self.operate(operation::array_new_data, 2, ty.0, Some(index(data.0)), REF)
    }

    fn array_new_elem(&mut self, ty: TypeIndex, elem: ElemIndex) -> Done {
        self.operate(operation::array_new_elem, 2, ty.0, Some(index(elem.0)), REF)
    }

    fn array_get(&mut self, ty: TypeIndex, sign: Option<Sign>) -> Done {
        let (storage, [array, index]) = (self.element(ty), self.pop_in_slots()?);
        let is_last = self.is_last(Register::Int, index);
        let handler = object::for_array_get(Part::to_read(storage, sign), is_last);
        self.produce(storage.unpacked().kind(), handler, array, index.into())
    }

    fn array_set(&mut self, ty: TypeIndex) -> Done {
        let (part, [array, index, value]) =
            (Part::to_write(self.element(ty)), self.pop_in_slots()?);
        self.did_write_part(part);
        self.emit(object::for_array_set(part), array, index, value.into())
    }

    fn array_len(&mut self) -> Done {
        let (array, is_last) = self.pop_in_slot()?;
        self.produce(ValKind::I32, object::for_array_len(is_last), array, 0)
    }

    fn array_fill(&mut self, ty: TypeIndex) -> Done {
        let handler =
            self.for_elements(ty, operation::array_fill, operation::array_of_vectors_fill);
        self.operate(handler, 4, 0, None, None)
    }

    fn array_copy(&mut self, _: TypeIndex, _: TypeIndex) -> Done {
        self.operate(operation::array_copy, 5, 0, None, None)
    }

    fn array_init_data(&mut self, _: TypeIndex, data: DataIndex) -> Done {
        self.operate(operation::array_init_data, 4, data.0, None, None)
    }

    fn array_init_elem(&mut self, _: TypeIndex, elem: ElemIndex) -> Done {
        self.operate(operation::array_init_elem, 4, elem.0, None, None)
    }
}
