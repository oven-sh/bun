//! The frame for a call of a function with a short list of values.

use bun_engine_asm::prelude::*;
use bun_engine_bytecode::Specialization;
use bun_engine_vm::{
    CallFrame, CellType, ElementKind, Executable, ImmutableArray, IndexingMode, JsCell, JsFunction,
    JsObject, Storage, Value, Vm,
};

use super::{Emitter, OPERANDS, RESULTS};
use crate::graph::Lists;
use crate::runtime::registers::*;
use crate::runtime::varargs::{Form, Operands};

const MAX_LENGTH: i32 = 256;
const WORD: i32 = size_of::<u64>() as i32;
/// None of them is the form.
const ELEMENTS: Gpr = abi::ARGUMENT_GPRS[0];
const LENGTH: Gpr = abi::ARGUMENT_GPRS[1];
const SKIP: Gpr = abi::ARGUMENT_GPRS[2];
const SINGLE: Gpr = abi::ARGUMENT_GPRS[4];
const FUNCTION: Gpr = abi::ARGUMENT_GPRS[5];
const TEMP: Gpr = abi::NON_ARGUMENT_GPRS[0];
const OTHER: Gpr = abi::NON_ARGUMENT_GPRS[1];

impl Emitter {
    fn find_elements(&mut self, slow: Label) {
        let m = &mut self.m;
        let [own, array, has_storage, done] = core::array::from_fn(|_| m.new_label());
        m.load64(ELEMENTS, at(OPERANDS, size_of::<Operands>()));
        m.branch_if_zero64(ELEMENTS, own);
        m.branch_if_not_cell(ELEMENTS, slow);
        let (int32, contiguous) = (ElementKind::Int32 as i32, ElementKind::Contiguous as i32);
        m.load8(TEMP, at(ELEMENTS, JsCell::OFFSET_OF_INDEXING_MODE));
        m.sub32(TEMP, TEMP, int32);
        let other_kind = i32::from(IndexingMode::KIND_MASK) & !(contiguous - int32);
        m.branch_test32(TestCond::NonZero, TEMP, other_kind, slow);
        m.load8(TEMP, at(ELEMENTS, JsCell::OFFSET_OF_TYPE));
        m.branch32(Cond::Eq, TEMP, i32::from(CellType::Array.0), array);
        m.branch32(Cond::Ne, TEMP, i32::from(CellType::ImmutableArray.0), slow);
        m.add64(ELEMENTS, ELEMENTS, ImmutableArray::OFFSET_OF_ELEMENTS);
        m.jump(has_storage);
        m.bind(own);
        m.shr64(SKIP, FORM, Form::LISTS_SHIFT);
        m.and32(SKIP, SKIP, (1 << Lists::FRAME_BITS) - 1);
        m.load32(LENGTH, at(FP, CallFrame::OFFSET_OF_ARGUMENT_COUNT));
        m.sub32(LENGTH, LENGTH, 1);
        m.compute_address(ELEMENTS, at(FP, CallFrame::OFFSET_OF_ARGUMENTS));
        m.jump(done);
        m.bind(array);
        m.load64(ELEMENTS, at(ELEMENTS, JsObject::OFFSET_OF_STORAGE));
        m.bind(has_storage);
        let length = Storage::OFFSET_OF_PUBLIC_LENGTH as i32;
        m.load32(LENGTH, Address::new(ELEMENTS, length));
        m.bind(done);
        m.branch32(Cond::Above, LENGTH, MAX_LENGTH, slow);
    }

    /// As `fill_varargs_frame`. Goes to `slow` with nothing changed but registers that are free.
    pub(super) fn fill_usual_varargs_frame(&mut self, slow: Label) {
        (self.m).shr64(SKIP, FORM, Form::LISTS_SHIFT + Lists::FRAME_BITS as u8);
        (self.m).branch32(Cond::Eq, SKIP, Lists::SPREAD as i32, slow);
        self.find_elements(slow);
        let m = &mut self.m;
        m.load64(FUNCTION, at(OPERANDS, Operands::OFFSET_OF_CALLEE));
        m.branch_if_not_cell(FUNCTION, slow);
        let (first, last) = (CellType::FUNCTIONS.first.0, CellType::FUNCTIONS.last.0);
        m.load8(TEMP, at(FUNCTION, JsCell::OFFSET_OF_TYPE));
        m.sub32(TEMP, TEMP, i32::from(first));
        m.branch32(Cond::Above, TEMP, i32::from(last - first), slow);

        m.select32(Cond::Below, SKIP, LENGTH, SKIP, LENGTH, SKIP);
        m.sub32(LENGTH, LENGTH, SKIP);
        m.compute_address(ELEMENTS, Address::indexed(ELEMENTS, SKIP, Scale::Eight, 0));
        m.shr32(SINGLE, FORM, Form::PARTS_SHIFT);
        let (count, target) = (SKIP, SKIP);
        m.add32(count, SINGLE, LENGTH);
        m.add32(TEMP, count, CallFrame::HEADER_WORDS as i32 + 1);
        m.and32(TEMP, TEMP, -2);
        m.shl32(TEMP, TEMP, WORD.ilog2() as u8);
        m.sub64(TEMP, OPERANDS, TEMP);
        m.branch64(Cond::Lt, TEMP, at(VM, Vm::OFFSET_OF_REAL_STACK_LIMIT), slow);
        m.move64(SP, TEMP);

        // The list counts for `this`.
        m.load64(OTHER, at(OPERANDS, Operands::OFFSET_OF_THIS));
        m.store64(at(TEMP, CallFrame::OFFSET_OF_CALLEE), FUNCTION);
        m.store64(at(TEMP, CallFrame::OFFSET_OF_ARGUMENT_COUNT), count);
        m.store64(at(TEMP, CallFrame::OFFSET_OF_THIS), OTHER);
        m.compute_address(target, at(TEMP, CallFrame::OFFSET_OF_ARGUMENTS));
        let [singles_done, list_done, is_value] = core::array::from_fn(|_| m.new_label());
        let next = m.here();
        m.branch_sub32(ResultCond::Zero, SINGLE, SINGLE, 1, singles_done);
        let parts = size_of::<Operands>() as i32;
        m.load64(
            OTHER,
            Address::indexed(OPERANDS, SINGLE, Scale::Eight, parts),
        );
        m.store64(at(target, 0), OTHER);
        m.add64(target, target, WORD);
        m.jump(next);
        m.bind(singles_done);
        m.branch_if_zero32(LENGTH, list_done);
        let next = m.here();
        m.sub32(LENGTH, LENGTH, 1);
        m.load64(OTHER, Address::indexed(ELEMENTS, LENGTH, Scale::Eight, 0));
        m.branch_if_not_zero64(OTHER, is_value);
        m.move32(OTHER, Value::UNDEFINED.to_bits() as i32);
        m.bind(is_value);
        m.store64(Address::indexed(target, LENGTH, Scale::Eight, 0), OTHER);
        m.branch_if_not_zero32(LENGTH, next);
        m.bind(list_done);

        let (calls, found) = (m.new_label(), m.new_label());
        m.load64(FUNCTION, at(FUNCTION, JsFunction::OFFSET_OF_EXECUTABLE));
        m.branch_test32(TestCond::Zero, FORM, Form::CONSTRUCTS, calls);
        for specialization in [Specialization::Construct, Specialization::Call] {
            let code_block = Executable::offset_of_code_block(specialization);
            m.load64(OTHER, at(FUNCTION, code_block));
            m.store64(at(TEMP, CallFrame::OFFSET_OF_CODE_BLOCK), OTHER);
            let entry = Executable::offset_of_entry(specialization);
            m.load64(RESULTS[0], at(FUNCTION, entry));
            if specialization == Specialization::Construct {
                m.jump(found);
                m.bind(calls);
            }
        }
        m.bind(found);
        m.move64(RESULTS[1], FUNCTION);
    }
}
