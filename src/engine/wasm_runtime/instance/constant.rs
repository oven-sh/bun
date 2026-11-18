//! Constant expressions.

use bun_engine_asm::Width;
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_compiler::abi::object::FIELDS;
use bun_engine_wasm_format::{
    ConstExpr, Flow, FuncIndex, GlobalIndex, HeapType, IntBinaryOp, OutOfMemory, TypeIndex, Visit,
    VisitControl, VisitMemory, VisitNumeric, VisitReference, VisitVariable, VisitVector,
};

use super::Instance;
use crate::alloc::try_push;
use crate::objects::{self, Array};
use crate::value::{Bits, HostCell, Reference};

/// Why a constant expression has no value.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ConstantError {
    pub trap: Trap,
    /// In the module, behind the instruction. Zero if it is not known.
    pub offset: u32,
}

impl From<Trap> for ConstantError {
    fn from(trap: Trap) -> Self {
        Self { trap, offset: 0 }
    }
}

impl Instance {
    pub(super) fn evaluate(&self, expr: ConstExpr) -> Result<Bits, ConstantError> {
        Ok(match expr {
            ConstExpr::I32(value) => (value as u32).into(),
            ConstExpr::I64(value) => (value as u64).into(),
            ConstExpr::F32(bits) => bits.into(),
            ConstExpr::F64(bits) => bits.into(),
            ConstExpr::RefNull => Reference::NULL.into(),
            ConstExpr::RefFunc(func) => self.function_reference(func)?.into(),
            ConstExpr::GlobalGet(global) => self.global_value(global),
            ConstExpr::Code(code) => {
                let mut evaluation = Evaluation {
                    instance: self,
                    operands: Vec::new(),
                };
                let mut driver = self.module.const_expr_driver(code);
                let outcome = driver.run(&mut evaluation);
                self.traced.lock().temporaries = Vec::new();
                outcome.map_err(|trap| ConstantError {
                    trap,
                    offset: code.offset() + driver.offset(),
                })?;
                evaluation.pop()
            }
        })
    }
}

struct Evaluation<'a> {
    instance: &'a Instance,
    /// The cells in here can be reached from the instance.
    operands: Vec<Bits>,
}

impl Evaluation<'_> {
    fn push(&mut self, value: impl Into<Bits>) -> Result<(), Trap> {
        try_push(&mut self.operands, value.into()).map_err(|OutOfMemory| Trap::OutOfMemory)
    }

    fn push_new(&mut self, object: HostCell) -> Result<(), Trap> {
        self.instance.engine().publish_fence();
        try_push(&mut self.instance.traced.lock().temporaries, object)
            .map_err(|OutOfMemory| Trap::OutOfMemory)?;
        self.instance.write_barrier();
        self.push(Reference::from(object))
    }

    fn pop(&mut self) -> Bits {
        self.operands.pop().expect("the expression was validated")
    }
}

impl Visit for Evaluation<'_> {
    type Error = Trap;

    fn unhandled(&mut self) -> Result<(), Trap> {
        unreachable!("the expression was validated")
    }
}

impl VisitControl for Evaluation<'_> {
    fn end(&mut self, _: Flow) -> Result<(), Trap> {
        Ok(())
    }
}

impl VisitVariable for Evaluation<'_> {
    fn global_get(&mut self, global: GlobalIndex) -> Result<(), Trap> {
        self.push(self.instance.global_value(global))
    }
}

impl VisitNumeric for Evaluation<'_> {
    fn i32_const(&mut self, value: i32) -> Result<(), Trap> {
        self.push(value as u32)
    }

    fn i64_const(&mut self, value: i64) -> Result<(), Trap> {
        self.push(value as u64)
    }

    fn f32_const(&mut self, bits: u32) -> Result<(), Trap> {
        self.push(bits)
    }

    fn f64_const(&mut self, bits: u64) -> Result<(), Trap> {
        self.push(bits)
    }

    fn int_binary(&mut self, width: Width, op: IntBinaryOp) -> Result<(), Trap> {
        let (rhs, lhs) = (self.pop() as u64, self.pop() as u64);
        let result = match op {
            IntBinaryOp::Add => lhs.wrapping_add(rhs),
            IntBinaryOp::Sub => lhs.wrapping_sub(rhs),
            IntBinaryOp::Mul => lhs.wrapping_mul(rhs),
            IntBinaryOp::And | IntBinaryOp::Or | IntBinaryOp::Xor => return self.unhandled(),
        };
        match width {
            Width::W32 => self.push(result as u32),
            Width::W64 => self.push(result),
        }
    }
}

impl VisitMemory for Evaluation<'_> {}

impl VisitReference for Evaluation<'_> {
    fn ref_null(&mut self, _: HeapType) -> Result<(), Trap> {
        self.push(Reference::NULL)
    }

    fn ref_func(&mut self, func: FuncIndex) -> Result<(), Trap> {
        self.push(self.instance.function_reference(func)?)
    }

    fn ref_i31(&mut self) -> Result<(), Trap> {
        let value = self.pop() as i32;
        self.push(Reference::from_i31(value))
    }

    fn any_convert_extern(&mut self) -> Result<(), Trap> {
        let value = Reference(self.pop() as u64);
        self.push(value.internalized())
    }

    fn extern_convert_any(&mut self) -> Result<(), Trap> {
        Ok(())
    }

    fn struct_new(&mut self, ty: TypeIndex) -> Result<(), Trap> {
        let object = objects::new_struct(self.instance, ty)?;
        for field in self
            .instance
            .module
            .types()
            .struct_type(ty)
            .fields
            .iter()
            .rev()
        {
            let place = object.field(FIELDS + field.offset as i32);
            // SAFETY: the object has the field, and the operand its type.
            unsafe { objects::write(place, field.ty.storage.log2_size(), self.pop()) };
        }
        self.push_new(object)
    }

    fn struct_new_default(&mut self, ty: TypeIndex) -> Result<(), Trap> {
        self.push_new(objects::new_struct(self.instance, ty)?)
    }

    fn array_new(&mut self, ty: TypeIndex) -> Result<(), Trap> {
        let (length, value) = (self.pop() as u32, self.pop());
        // SAFETY: the operand has the type of the elements.
        let array = unsafe { Array::new_filled(self.instance, ty, length, value) };
        self.push_new(array.ok_or(Trap::ArrayNewFailure)?.cell())
    }

    fn array_new_default(&mut self, ty: TypeIndex) -> Result<(), Trap> {
        let length = self.pop() as u32;
        let array = Array::new_default(self.instance, ty, length);
        self.push_new(array.ok_or(Trap::ArrayNewFailure)?.cell())
    }

    fn array_new_fixed(&mut self, ty: TypeIndex, length: u32) -> Result<(), Trap> {
        let array = Array::new_default(self.instance, ty, length);
        let array = array.ok_or(Trap::ArrayNewFailure)?;
        for index in (0..length).rev() {
            // SAFETY: in bounds, and the operand has the type of the elements.
            unsafe { array.fill(index, self.pop(), 1) };
        }
        self.push_new(array.cell())
    }
}

impl VisitVector for Evaluation<'_> {
    fn v128_const(&mut self, bits: u128) -> Result<(), Trap> {
        self.push(bits)
    }
}
