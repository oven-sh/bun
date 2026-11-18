use bun_engine_asm::{
    Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary,
};

use super::{Checked, Validator, is};
use crate::error::Missing;
use crate::ops::{LaneType, MemArg, VectorLoadOp};
use crate::types::ValType;
use crate::visitor::VisitVector;

const V128: ValType = ValType::V128;

impl Validator<'_> {
    pub(super) fn pop_stored_vector(&mut self) -> Checked {
        let value = self.pop_early("val")?;
        ensure!(is(value, V128), validation, "store vector must be v128");
        Ok(())
    }

    pub(super) fn pop_lane_vector(&mut self, name: &'static str) -> Checked {
        let vector = self.pop_early("vector")?;
        ensure!(
            is(vector, V128),
            validation,
            "{name} input must be a vector"
        );
        Ok(())
    }

    #[inline]
    pub(super) fn pop_vector_address(&mut self, arg: MemArg) -> Checked {
        let pointer = self.pop("simd memory op pointer")?;
        ensure!(
            is(pointer, self.address_type(arg.memory)),
            validation,
            "pointer type mismatch"
        );
        Ok(())
    }

    /// It is missed before the lane is read.
    fn pop_lane_address(&mut self, arg: MemArg) -> Checked {
        let is_missing = !self.has(1);
        self.pop_vector_address(arg).map_err(|error| {
            if is_missing {
                error.lacking(Missing::OffsetOfLastByte)
            } else {
                error
            }
        })
    }

    /// `numbers` are those that messages give the operands, in the order of the stack.
    #[inline(always)]
    fn pop_vectors<const N: usize>(&mut self, numbers: [u8; N]) -> Checked {
        let values = self.pop_array::<N>("vector argument")?;
        for (value, number) in values.into_iter().zip(numbers) {
            ensure!(
                is(value, V128),
                validation,
                "type mismatch for argument {number}"
            );
        }
        Ok(())
    }
}

fn is_extended_multiplication(op: VectorBinary) -> bool {
    use VectorBinary::*;
    matches!(
        op,
        I16x8ExtMulLowI8x16S
            | I16x8ExtMulHighI8x16S
            | I16x8ExtMulLowI8x16U
            | I16x8ExtMulHighI8x16U
            | I32x4ExtMulLowI16x8S
            | I32x4ExtMulHighI16x8S
            | I32x4ExtMulLowI16x8U
            | I32x4ExtMulHighI16x8U
            | I64x2ExtMulLowI32x4S
            | I64x2ExtMulHighI32x4S
            | I64x2ExtMulLowI32x4U
            | I64x2ExtMulHighI32x4U
    )
}

fn is_select(op: VectorTernary) -> bool {
    use VectorTernary::*;
    matches!(
        op,
        Bitselect
            | I8x16RelaxedLaneselect
            | I16x8RelaxedLaneselect
            | I32x4RelaxedLaneselect
            | I64x2RelaxedLaneselect
    )
}

#[deny(clippy::missing_trait_methods)]
impl VisitVector for Validator<'_> {
    fn v128_const(&mut self, _: u128) -> Checked {
        self.push(V128)
    }

    fn vector_load(&mut self, _: VectorLoadOp, arg: MemArg) -> Checked {
        self.pop_vector_address(arg)?;
        self.push(V128)
    }

    fn vector_store(&mut self, arg: MemArg) -> Checked {
        self.pop_stored_vector()?;
        self.pop_vector_address(arg)
    }

    fn vector_load_lane(&mut self, _: Size, _: u8, arg: MemArg) -> Checked {
        self.pop_lane_vector("load_lane")?;
        self.pop_lane_address(arg)?;
        self.push(V128)
    }

    fn vector_store_lane(&mut self, _: Size, _: u8, arg: MemArg) -> Checked {
        self.pop_lane_vector("store_lane")?;
        self.pop_lane_address(arg)
    }

    fn vector_splat(&mut self, ty: LaneType) -> Checked {
        let scalar = self.pop("select condition")?;
        ensure!(
            is(scalar, ty.value_type()),
            validation,
            "Wrong type to SIMD splat"
        );
        self.push(V128)
    }

    fn vector_extract_lane(&mut self, ty: LaneType, _: Sign, _: u8) -> Checked {
        self.pop_vectors([0])?;
        self.push(ty.value_type())
    }

    fn vector_replace_lane(&mut self, ty: LaneType, _: u8) -> Checked {
        let scalar = self.pop("scalar argument")?;
        self.pop_vectors([1])?;
        ensure!(
            is(scalar, ty.value_type()),
            validation,
            "type mismatch for argument 0"
        );
        self.push(V128)
    }

    fn vector_shuffle(&mut self, _: [u8; 16]) -> Checked {
        for _ in 0..2 {
            let vector = self.pop("vector argument")?;
            ensure!(
                is(vector, V128),
                validation,
                "shuffle input must be a vector"
            );
        }
        self.push(V128)
    }

    fn vector_unary(&mut self, _: VectorUnary) -> Checked {
        self.pop_vectors([0])?;
        self.push(V128)
    }

    fn vector_binary(&mut self, op: VectorBinary) -> Checked {
        if let Some(&mut [V128, V128]) = self.top() {
            self.height -= 1;
            return Ok(());
        }
        if is_extended_multiplication(op) {
            let rhs = self.pop("rhs")?;
            let lhs = self.pop("lhs")?;
            ensure!(is(lhs, V128), validation, "extmul lhs vector must be v128");
            ensure!(is(rhs, V128), validation, "extmul rhs vector must be v128");
        } else {
            self.pop_vectors([1, 0])?;
        }
        self.push(V128)
    }

    fn vector_ternary(&mut self, op: VectorTernary) -> Checked {
        self.pop_vectors(if is_select(op) { [2, 1, 0] } else { [0, 1, 2] })?;
        self.push(V128)
    }

    fn vector_shift(&mut self, _: VectorShift) -> Checked {
        let amount = self.pop("shift i32")?;
        let vector = self.pop("shift vector")?;
        ensure!(is(vector, V128), validation, "Shift vector must be v128");
        ensure!(
            is(amount, ValType::I32),
            validation,
            "Shift amount must be i32"
        );
        self.push(V128)
    }

    fn vector_reduce(&mut self, _: VectorReduce) -> Checked {
        self.pop_vectors([0])?;
        self.push(ValType::I32)
    }
}
