use super::{FloatAssembly, ScratchNeeds};
use crate::label::Label;
use crate::operand::{Address, Amount, FloatWidth, Sign, Size, TestCond};
use crate::register::{Fpr, Gpr};
use crate::vector::{Relaxed, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary};

bitflags::bitflags! {
    /// Vector operands, any of which saves a move if its register is also the destination.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct Reuse: u8 {
        const FIRST = 1 << 0;
        const SECOND = 1 << 1;
        const THIRD = 1 << 2;
    }
}

/// A `Size` is that of an integer lane, a `FloatWidth` that of a float lane. The methods up to `replace_float_lane`
/// need no scratch register other than for an address.
pub trait VectorAssembly: FloatAssembly {
    fn move_vector_constant(&mut self, dst: Fpr, bits: u128);
    /// Reads 8 bytes and doubles the size of each lane.
    fn load_vector_extend(&mut self, from: Size, sign: Sign, dst: Fpr, src: Address);
    fn load_vector_splat(&mut self, lanes: Size, dst: Fpr, src: Address);
    fn load_vector_lane(&mut self, lanes: Size, dst: Fpr, vector: Fpr, lane: u8, src: Address);
    fn store_vector_lane(&mut self, lanes: Size, dst: Address, vector: Fpr, lane: u8);
    fn splat_int(&mut self, lanes: Size, dst: Fpr, src: Gpr);
    fn splat_float(&mut self, lanes: FloatWidth, dst: Fpr, src: Fpr);
    /// Lanes of 8 and 16 bits are extended to 32.
    fn extract_int_lane(&mut self, lanes: Size, sign: Sign, dst: Gpr, vector: Fpr, lane: u8);
    fn extract_float_lane(&mut self, lanes: FloatWidth, dst: Fpr, vector: Fpr, lane: u8);
    fn replace_int_lane(&mut self, lanes: Size, dst: Fpr, vector: Fpr, lane: u8, value: Gpr);
    fn replace_float_lane(
        &mut self,
        lanes: FloatWidth,
        dst: Fpr,
        vector: Fpr,
        lane: u8,
        value: Fpr,
    );
    fn vector_unary(&mut self, op: VectorUnary, dst: Fpr, src: Fpr);
    fn vector_binary(&mut self, op: VectorBinary, dst: Fpr, lhs: Fpr, rhs: Fpr);
    fn vector_ternary(&mut self, op: VectorTernary, dst: Fpr, a: Fpr, b: Fpr, c: Fpr);
    fn vector_shift(&mut self, op: VectorShift, dst: Fpr, src: Fpr, amount: impl Into<Amount>);
    fn vector_reduce(&mut self, op: VectorReduce, dst: Gpr, src: Fpr);
    /// Byte `i` of `dst` is byte `lanes[i]` of the 32 bytes of `lhs` and `rhs`, or zero if there is none.
    fn vector_shuffle(&mut self, dst: Fpr, lhs: Fpr, rhs: Fpr, lanes: [u8; 16]);
    /// `cond` is `Zero` or `NonZero`.
    fn branch_test_vector(&mut self, cond: TestCond, vector: Fpr, target: Label);

    // For searching text. These need no scratch register but the first for vectors.

    /// `move_byte_mask` has `1 << BYTE_MASK_SHIFT` bits for each byte.
    const BYTE_MASK_SHIFT: u8;

    /// Each byte of `mask` is all ones or all zeros, and so are its bits in the 64 of `dst`, from the lowest up.
    fn move_byte_mask(&mut self, dst: Gpr, mask: Fpr);
    /// The number of the first byte that is set in a result of `move_byte_mask`, which is not zero.
    fn first_in_byte_mask(&mut self, dst: Gpr, mask: Gpr);
    /// The low bytes of the lanes of 16 bits of `lhs` and then `rhs`, whose values fit in bytes of that sign.
    fn narrow_to_bytes(&mut self, sign: Sign, dst: Fpr, lhs: Fpr, rhs: Fpr);
    /// All ones in the bytes in which `value` has the bit that `bit` has. Each byte of `bit` has one.
    fn test_bit_in_bytes(&mut self, dst: Fpr, value: Fpr, bit: Fpr);

    /// What the relaxed operations do.
    fn relaxed(features: Self::Features) -> Relaxed;

    // What the operations above take from the scratch registers, however their operands coincide.

    fn scratch_for_unary(features: Self::Features, op: VectorUnary) -> ScratchNeeds;
    fn scratch_for_binary(features: Self::Features, op: VectorBinary) -> ScratchNeeds;
    fn scratch_for_ternary(features: Self::Features, op: VectorTernary) -> ScratchNeeds;
    fn scratch_for_shift(
        features: Self::Features,
        op: VectorShift,
        by_constant: bool,
    ) -> ScratchNeeds;
    fn scratch_for_reduce(features: Self::Features, op: VectorReduce) -> ScratchNeeds;
    fn scratch_for_shuffle(features: Self::Features, lanes: [u8; 16]) -> ScratchNeeds;
    fn scratch_for_branch_test(features: Self::Features) -> ScratchNeeds;

    // Where their destination is best.

    fn reuse_for_unary(features: Self::Features, op: VectorUnary) -> Reuse;
    fn reuse_for_binary(features: Self::Features, op: VectorBinary) -> Reuse;
    fn reuse_for_ternary(features: Self::Features, op: VectorTernary) -> Reuse;
    fn reuse_for_shift(features: Self::Features) -> Reuse;
    fn reuse_for_shuffle(features: Self::Features, lanes: [u8; 16]) -> Reuse;
    /// For `load_vector_lane`, `replace_int_lane` and `replace_float_lane`.
    fn reuse_for_replace_lane(features: Self::Features) -> Reuse;
}
