//! Conversions, in code that has the registers pinned that scripts pin.

#![forbid(unsafe_code)]

use core::ops::{Deref, DerefMut};

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code, Features, Options};
use bun_engine_vm::heap::{Allocator, Heap, Space, optimal_size};
use bun_engine_vm::{CellKind, CellType, JsBigInt, JsCell, Shape, Value, Vm};
use bun_engine_wasm_compiler::abi::{
    ARGUMENT_FPRS, HostLayout, INSTANCE, InstanceLayout, MEMORY_BASE, frame, object,
};

use super::helpers;
use super::kind::{Kind, Referent};
use crate::function::WasmFunction;
use crate::object_shape::ObjectShape;

pub(super) const FP: Gpr = abi::FRAME_POINTER;
pub(super) const SP: Gpr = abi::STACK_POINTER;
pub(super) const RESULT: Gpr = abi::RETURN_GPRS[0];
/// These carry no arguments.
pub(super) const VALUE: Gpr = abi::SAVED_GPRS[0];
pub(super) const TEMP: Gpr = abi::SAVED_GPRS[1];
pub(super) const FLOAT: Fpr = Fpr::new(ARGUMENT_FPRS.len() as u8);

pub(super) const WORD: i32 = 8;

pub(super) fn field(base: Gpr, offset: usize) -> Address {
    Address::new(base, offset as i32)
}

/// Code that comes after the usual path.
type Detour = Box<dyn FnOnce(&mut MacroAssembler)>;

pub(super) struct Writer<'a> {
    masm: MacroAssembler,
    pub(super) host: &'a HostLayout,
    /// Where it is while values are on their way in, and a register that is free for it.
    instance: (Address, Gpr),
    detours: Vec<Detour>,
}

impl Deref for Writer<'_> {
    type Target = MacroAssembler;

    fn deref(&self) -> &MacroAssembler {
        &self.masm
    }
}

impl DerefMut for Writer<'_> {
    fn deref_mut(&mut self) -> &mut MacroAssembler {
        &mut self.masm
    }
}

impl<'a> Writer<'a> {
    pub(super) fn new(host: &'a HostLayout, instance: (Address, Gpr)) -> Self {
        let masm = MacroAssembler::new(Options {
            features: Features::host(),
            shorten_jumps: true,
            seed: 0,
        });
        Self {
            masm,
            host,
            instance,
            detours: Vec::new(),
        }
    }

    pub(super) fn finish(mut self) -> Code {
        for detour in self.detours {
            detour(&mut self.masm);
        }
        (self.masm.finish()).expect("a few instructions for each value")
    }

    /// Returns where it starts.
    fn dead_end(&mut self, emit: impl FnOnce(&mut MacroAssembler) + 'static) -> Label {
        let start = self.new_label();
        self.detours.push(Box::new(move |masm| {
            masm.bind(start);
            emit(masm);
        }));
        start
    }

    /// Returns where it starts and where it goes back to, which the caller binds.
    pub(super) fn detour(
        &mut self,
        emit: impl FnOnce(&mut MacroAssembler, Label) + 'static,
    ) -> (Label, Label) {
        let back = self.new_label();
        let start = self.dead_end(move |masm| {
            emit(masm, back);
            masm.jump(back);
        });
        (start, back)
    }

    pub(super) fn fill_in_header(&mut self, callee: u32) {
        self.store64(Address::new(FP, frame::INSTANCE), INSTANCE);
        self.store64(Address::new(FP, frame::CALLEE), callee);
    }

    pub(super) fn load_memory_base(&mut self) {
        let base = Address::new(INSTANCE, InstanceLayout::memory_base(self.host));
        self.load64(MEMORY_BASE, base);
    }

    /// From any instance in its register.
    pub(super) fn pin_for_scripts(&mut self) {
        let vm = Address::new(INSTANCE, InstanceLayout::vm(self.host));
        self.load64(abi::VM, vm);
        self.load_tags();
    }

    fn unbox_i32(&mut self, value: Gpr, slow: Label) {
        let (other, done) = self.detour(move |masm, done| {
            let not_number = masm.new_label();
            masm.branch_if_not_number(value, not_number);
            masm.unbox_double(FLOAT, value, TEMP);
            masm.truncate_f64_to_int32_modular(TEMP, FLOAT, slow);
            masm.move32(value, TEMP);
            masm.jump(done);
            masm.bind(not_number);
            masm.branch_if_cell(value, slow);
            masm.compare64(Cond::Eq, value, value, Value::TRUE.to_bits());
        });
        self.branch_if_not_int32(value, other);
        self.zero_extend32(value, value);
        self.bind(done);
    }

    fn unbox_i64(&mut self, value: Gpr, slow: Label) {
        let (zero, done) = self.detour(move |masm, _| masm.move32(value, 0));
        self.branch_unless_type(value, CellType::BigInt, slow);
        self.branch_if_zero32(field(value, JsBigInt::OFFSET_OF_LENGTH), zero);
        self.load8(TEMP, field(value, JsBigInt::OFFSET_OF_SIGN));
        self.load64(value, field(value, JsBigInt::OFFSET_OF_DIGITS));
        self.neg64(TEMP, TEMP);
        self.xor64(value, value, TEMP);
        self.sub64(value, value, TEMP);
        self.bind(done);
    }

    /// Below `any` an int32 has 31 bits, and a double does not. Goes on with what is no number.
    fn pass_small_integer(&mut self, value: Gpr, done: Label, slow: Label) {
        let number = self.dead_end(move |masm| {
            masm.branch_if_not_int32(value, slow);
            masm.branch_add32(ResultCond::Overflow, TEMP, value, value, slow);
            masm.jump(done);
        });
        self.branch_if_number(value, number);
    }

    fn branch_unless_type(&mut self, value: Gpr, expected: CellType, target: Label) {
        self.branch_if_not_cell(value, target);
        let actual = field(value, JsCell::OFFSET_OF_TYPE);
        self.branch8(Cond::Ne, actual, expected.0.into(), target);
    }

    fn load_shape(&mut self, dst: Gpr, cell: Gpr) {
        self.load32(dst, field(cell, JsCell::OFFSET_OF_SHAPE_ID));
        self.add64(dst, dst, field(abi::VM, Vm::OFFSET_OF_SHAPE_BASE));
    }

    /// With the number in `TEMP`.
    fn branch_unless_number_of(&mut self, header: i32, target: Label) {
        let (place, instance) = self.instance;
        self.load64(instance, place);
        self.branch32(Cond::Ne, TEMP, Address::new(instance, header), target);
    }

    fn check_reference(&mut self, is_nullable: bool, to: Referent, value: Gpr, slow: Label) {
        let done = self.new_label();
        match (is_nullable, to) {
            (true, Referent::Extern | Referent::Any) => {}
            (true, _) => self.branch_if_null(value, done),
            (false, Referent::Extern | Referent::Any) => self.branch_if_null(value, slow),
            (false, _) => {}
        }
        match to {
            Referent::Extern => {}
            Referent::Any => self.pass_small_integer(value, done, slow),
            Referent::Eq => {
                self.pass_small_integer(value, done, slow);
                self.branch_unless_type(value, CellType::WasmGcObject, slow);
            }
            Referent::I31 => {
                self.branch_if_not_int32(value, slow);
                self.branch_add32(ResultCond::Overflow, TEMP, value, value, slow);
            }
            Referent::Func => {
                self.branch_unless_type(value, CellType::Function, slow);
                self.load_shape(TEMP, value);
                // Else the test of its range becomes an offset that is too large for a relocation.
                let class = core::hint::black_box(core::ptr::from_ref(WasmFunction::CLASS)).addr();
                self.branch64(Cond::Ne, field(TEMP, Shape::OFFSET_OF_CLASS), class, slow);
            }
            Referent::OfFinalType { header } => {
                self.branch_if_not_cell(value, slow);
                self.load32(TEMP, Address::new(value, object::TYPE_NUMBER));
                self.branch_unless_number_of(header, slow);
            }
            Referent::OfOpenType { header, entry } => {
                self.branch_unless_type(value, CellType::WasmGcObject, slow);
                self.load_shape(TEMP, value);
                self.load32(TEMP, field(TEMP, ObjectShape::OFFSET_OF_TYPE).plus(entry));
                self.branch_unless_number_of(header, slow);
            }
            Referent::Other => self.jump(slow),
        }
        self.bind(done);
    }

    /// In place, for a kind that goes in a general register. Goes to `slow` with the value as it was.
    pub(super) fn unbox(&mut self, kind: Kind, value: Gpr, slow: Label) {
        match kind {
            Kind::I32 => self.unbox_i32(value, slow),
            Kind::I64 => self.unbox_i64(value, slow),
            Kind::Reference { is_nullable, to } => {
                self.check_reference(is_nullable, to, value, slow);
            }
            Kind::F32 | Kind::F64 => unreachable!(),
        }
    }

    /// Goes to `slow` with the value as it was.
    pub(super) fn unbox_float(&mut self, kind: Kind, dst: Fpr, value: Gpr, slow: Label) {
        let (integer, done) = self.detour(move |masm, _| masm.convert_i32_to_f64(dst, value));
        self.branch_if_int32(value, integer);
        self.branch_if_not_number(value, slow);
        self.unbox_double(dst, value, TEMP);
        self.bind(done);
        if kind == Kind::F32 {
            self.convert_f64_to_f32(dst, dst);
        }
    }

    /// Overwrites `src`.
    pub(super) fn box_float(&mut self, kind: Kind, dst: Gpr, src: Fpr) {
        if kind == Kind::F32 {
            self.convert_f32_to_f64(src, src);
        }
        let (nan, done) = self.detour(move |masm, _| masm.move64(dst, Value::NAN.to_bits()));
        self.branch_f64(FloatCond::Unordered, src, src, nan);
        self.box_double(dst, src);
        self.bind(done);
    }

    /// From `VALUE` to `RESULT`. May collect, and overwrites what a C function does.
    pub(super) fn box_i64(&mut self) {
        const SIZE: usize = JsBigInt::allocation_size(1);
        const ALLOCATOR: usize = Vm::OFFSET_OF_HEAP
            + Heap::offset_of_field("cells")
            + Space::offset_of_allocator_for(SIZE);
        let (slow, done) = self.detour(|masm, _| {
            masm.store64(field(abi::VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
            masm.move_arguments(&[abi::VM.into(), VALUE.into()]);
            masm.call_address(helpers::box_i64 as *const () as usize);
        });
        let start = field(abi::VM, ALLOCATOR + Allocator::OFFSET_OF_START);
        let end = field(abi::VM, ALLOCATOR + Allocator::OFFSET_OF_END);
        self.branch_if_zero64(VALUE, slow);
        self.load64(RESULT, start);
        self.branch64(Cond::AboveEq, RESULT, end, slow);
        self.add64(TEMP, RESULT, optimal_size(SIZE));
        self.store64(start, TEMP);
        self.load64(TEMP, field(abi::VM, Vm::OFFSET_OF_BIGINT_HEADER));
        self.store64(field(RESULT, 0), TEMP);
        self.store32(field(RESULT, JsBigInt::OFFSET_OF_LENGTH), 1);
        self.shr64(TEMP, VALUE, 63);
        self.store32(field(RESULT, JsBigInt::OFFSET_OF_SIGN), TEMP);
        self.neg64(TEMP, TEMP);
        self.xor64(VALUE, VALUE, TEMP);
        self.sub64(VALUE, VALUE, TEMP);
        self.store64(field(RESULT, JsBigInt::OFFSET_OF_DIGITS), VALUE);
        if cfg!(target_arch = "aarch64") {
            let threshold = Absolute(self.host.barrier_threshold_address);
            self.branch_test8(TestCond::Zero, threshold, -1, done);
            self.store_fence();
        }
        self.bind(done);
    }
}
