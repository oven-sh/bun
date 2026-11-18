//! Operations on 128-bit vectors, as WebAssembly names and defines them.

mod evaluate;
pub mod lanes;
pub(crate) mod pattern;

use crate::operand::{FloatWidth, Shift, Size};

macro_rules! operations {
    ($(#[$meta:meta])* $name:ident { $($variant:ident),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum $name {
            $($variant),*
        }

        impl $name {
            /// In the order of the discriminants.
            pub const ALL: &'static [Self] = &[$(Self::$variant),*];
        }
    };
}

operations! {
    VectorUnary {
        Not,
        I8x16Abs, I8x16Neg, I8x16Popcnt,
        I16x8Abs, I16x8Neg,
        I32x4Abs, I32x4Neg,
        I64x2Abs, I64x2Neg,
        F32x4Abs, F32x4Neg, F32x4Sqrt, F32x4Ceil, F32x4Floor, F32x4Trunc, F32x4Nearest,
        F64x2Abs, F64x2Neg, F64x2Sqrt, F64x2Ceil, F64x2Floor, F64x2Trunc, F64x2Nearest,
        I16x8ExtendLowI8x16S, I16x8ExtendHighI8x16S, I16x8ExtendLowI8x16U, I16x8ExtendHighI8x16U,
        I32x4ExtendLowI16x8S, I32x4ExtendHighI16x8S, I32x4ExtendLowI16x8U, I32x4ExtendHighI16x8U,
        I64x2ExtendLowI32x4S, I64x2ExtendHighI32x4S, I64x2ExtendLowI32x4U, I64x2ExtendHighI32x4U,
        I16x8ExtAddPairwiseI8x16S, I16x8ExtAddPairwiseI8x16U,
        I32x4ExtAddPairwiseI16x8S, I32x4ExtAddPairwiseI16x8U,
        I32x4TruncSatF32x4S, I32x4TruncSatF32x4U, I32x4TruncSatF64x2SZero, I32x4TruncSatF64x2UZero,
        F32x4ConvertI32x4S, F32x4ConvertI32x4U, F64x2ConvertLowI32x4S, F64x2ConvertLowI32x4U,
        F32x4DemoteF64x2Zero, F64x2PromoteLowF32x4,
        I32x4RelaxedTruncF32x4S, I32x4RelaxedTruncF32x4U,
        I32x4RelaxedTruncF64x2SZero, I32x4RelaxedTruncF64x2UZero,
    }
}

operations! {
    VectorBinary {
        And, AndNot, Or, Xor,
        I8x16Swizzle,
        I8x16Eq, I8x16Ne, I8x16LtS, I8x16LtU, I8x16GtS, I8x16GtU, I8x16LeS, I8x16LeU, I8x16GeS, I8x16GeU,
        I16x8Eq, I16x8Ne, I16x8LtS, I16x8LtU, I16x8GtS, I16x8GtU, I16x8LeS, I16x8LeU, I16x8GeS, I16x8GeU,
        I32x4Eq, I32x4Ne, I32x4LtS, I32x4LtU, I32x4GtS, I32x4GtU, I32x4LeS, I32x4LeU, I32x4GeS, I32x4GeU,
        I64x2Eq, I64x2Ne, I64x2LtS, I64x2GtS, I64x2LeS, I64x2GeS,
        F32x4Eq, F32x4Ne, F32x4Lt, F32x4Gt, F32x4Le, F32x4Ge,
        F64x2Eq, F64x2Ne, F64x2Lt, F64x2Gt, F64x2Le, F64x2Ge,
        I8x16NarrowI16x8S, I8x16NarrowI16x8U,
        I8x16Add, I8x16AddSatS, I8x16AddSatU, I8x16Sub, I8x16SubSatS, I8x16SubSatU,
        I8x16MinS, I8x16MinU, I8x16MaxS, I8x16MaxU, I8x16AvgrU,
        I16x8NarrowI32x4S, I16x8NarrowI32x4U,
        I16x8Add, I16x8AddSatS, I16x8AddSatU, I16x8Sub, I16x8SubSatS, I16x8SubSatU, I16x8Mul,
        I16x8MinS, I16x8MinU, I16x8MaxS, I16x8MaxU, I16x8AvgrU, I16x8Q15MulrSatS,
        I16x8ExtMulLowI8x16S, I16x8ExtMulHighI8x16S, I16x8ExtMulLowI8x16U, I16x8ExtMulHighI8x16U,
        I32x4Add, I32x4Sub, I32x4Mul, I32x4MinS, I32x4MinU, I32x4MaxS, I32x4MaxU, I32x4DotI16x8S,
        I32x4ExtMulLowI16x8S, I32x4ExtMulHighI16x8S, I32x4ExtMulLowI16x8U, I32x4ExtMulHighI16x8U,
        I64x2Add, I64x2Sub, I64x2Mul,
        I64x2ExtMulLowI32x4S, I64x2ExtMulHighI32x4S, I64x2ExtMulLowI32x4U, I64x2ExtMulHighI32x4U,
        F32x4Add, F32x4Sub, F32x4Mul, F32x4Div, F32x4Min, F32x4Max, F32x4Pmin, F32x4Pmax,
        F64x2Add, F64x2Sub, F64x2Mul, F64x2Div, F64x2Min, F64x2Max, F64x2Pmin, F64x2Pmax,
        I8x16RelaxedSwizzle,
        F32x4RelaxedMin, F32x4RelaxedMax, F64x2RelaxedMin, F64x2RelaxedMax,
        I16x8RelaxedQ15MulrS, I16x8RelaxedDotI8x16I7x16S,
    }
}

operations! {
    VectorTernary {
        Bitselect,
        F32x4RelaxedMadd, F32x4RelaxedNmadd, F64x2RelaxedMadd, F64x2RelaxedNmadd,
        I8x16RelaxedLaneselect, I16x8RelaxedLaneselect, I32x4RelaxedLaneselect, I64x2RelaxedLaneselect,
        I32x4RelaxedDotI8x16I7x16AddS,
    }
}

operations! {
    VectorShift {
        I8x16Shl, I8x16ShrS, I8x16ShrU,
        I16x8Shl, I16x8ShrS, I16x8ShrU,
        I32x4Shl, I32x4ShrS, I32x4ShrU,
        I64x2Shl, I64x2ShrS, I64x2ShrU,
    }
}

operations! {
    /// From a vector to an integer of 32 bits.
    VectorReduce {
        AnyTrue,
        I8x16AllTrue, I16x8AllTrue, I32x4AllTrue, I64x2AllTrue,
        I8x16Bitmask, I16x8Bitmask, I32x4Bitmask, I64x2Bitmask,
    }
}

bitflags::bitflags! {
    /// What WebAssembly leaves to the implementation, which has to choose once. None is the deterministic profile.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
    pub struct Relaxed: u8 {
        /// `madd` and `nmadd` round once.
        const FUSED_MADD = 1 << 0;
        /// `min` and `max` give the second operand if either is NaN or both are zero.
        const SECOND_OPERAND_MIN_MAX = 1 << 1;
        const WRAPPING_Q15 = 1 << 2;
        /// For NaN and what does not fit, `trunc` gives what is left by the shortest code for x86-64.
        const UNSATURATED_TRUNC = 1 << 3;
        /// `swizzle` takes an index below 128 modulo 16.
        const WRAPPING_SWIZZLE = 1 << 4;
        /// The second operand of `dot` and `dot_add` is unsigned, and sums of 16 bits saturate.
        const UNSIGNED_DOT = 1 << 5;
        /// `dot_add` has no sums of 16 bits.
        const WIDE_DOT_ADD = 1 << 6;
        /// `laneselect` goes by the top bit of each lane of the mask.
        const TOP_BIT_LANESELECT = 1 << 7;
    }
}

impl VectorUnary {
    pub const fn is_relaxed(self) -> bool {
        matches!(
            self,
            Self::I32x4RelaxedTruncF32x4S
                | Self::I32x4RelaxedTruncF32x4U
                | Self::I32x4RelaxedTruncF64x2SZero
                | Self::I32x4RelaxedTruncF64x2UZero
        )
    }

    /// The lanes of a result in which the sign and payload of a NaN are not determined.
    pub const fn nan_lanes(self) -> Option<FloatWidth> {
        use VectorUnary::*;
        match self {
            F32x4Sqrt | F32x4Ceil | F32x4Floor | F32x4Trunc | F32x4Nearest
            | F32x4DemoteF64x2Zero => Some(FloatWidth::F32),
            F64x2Sqrt | F64x2Ceil | F64x2Floor | F64x2Trunc | F64x2Nearest
            | F64x2PromoteLowF32x4 => Some(FloatWidth::F64),
            _ => None,
        }
    }
}

impl VectorBinary {
    pub const fn is_relaxed(self) -> bool {
        use VectorBinary::*;
        matches!(
            self,
            I8x16RelaxedSwizzle
                | F32x4RelaxedMin
                | F32x4RelaxedMax
                | F64x2RelaxedMin
                | F64x2RelaxedMax
                | I16x8RelaxedQ15MulrS
                | I16x8RelaxedDotI8x16I7x16S
        )
    }

    /// Whatever is chosen for a relaxed operation, and apart from which NaN results.
    #[rustfmt::skip]
    pub const fn is_commutative(self) -> bool {
        use VectorBinary::*;
        matches!(
            self,
            And | Or | Xor
                | I8x16Eq | I8x16Ne | I16x8Eq | I16x8Ne | I32x4Eq | I32x4Ne | I64x2Eq | I64x2Ne
                | F32x4Eq | F32x4Ne | F64x2Eq | F64x2Ne
                | I8x16Add | I8x16AddSatS | I8x16AddSatU
                | I8x16MinS | I8x16MinU | I8x16MaxS | I8x16MaxU | I8x16AvgrU
                | I16x8Add | I16x8AddSatS | I16x8AddSatU | I16x8Mul
                | I16x8MinS | I16x8MinU | I16x8MaxS | I16x8MaxU | I16x8AvgrU
                | I16x8Q15MulrSatS | I16x8RelaxedQ15MulrS
                | I16x8ExtMulLowI8x16S | I16x8ExtMulHighI8x16S | I16x8ExtMulLowI8x16U | I16x8ExtMulHighI8x16U
                | I32x4Add | I32x4Mul | I32x4MinS | I32x4MinU | I32x4MaxS | I32x4MaxU | I32x4DotI16x8S
                | I32x4ExtMulLowI16x8S | I32x4ExtMulHighI16x8S | I32x4ExtMulLowI16x8U | I32x4ExtMulHighI16x8U
                | I64x2Add | I64x2Mul
                | I64x2ExtMulLowI32x4S | I64x2ExtMulHighI32x4S | I64x2ExtMulLowI32x4U | I64x2ExtMulHighI32x4U
                | F32x4Add | F32x4Mul | F32x4Min | F32x4Max
                | F64x2Add | F64x2Mul | F64x2Min | F64x2Max
        )
    }

    /// The lanes of a result in which the sign and payload of a NaN are not determined.
    pub const fn nan_lanes(self) -> Option<FloatWidth> {
        use VectorBinary::*;
        match self {
            F32x4Add | F32x4Sub | F32x4Mul | F32x4Div | F32x4Min | F32x4Max | F32x4RelaxedMin
            | F32x4RelaxedMax => Some(FloatWidth::F32),
            F64x2Add | F64x2Sub | F64x2Mul | F64x2Div | F64x2Min | F64x2Max | F64x2RelaxedMin
            | F64x2RelaxedMax => Some(FloatWidth::F64),
            _ => None,
        }
    }

    /// The lanes of the result of a comparison, each of which is all ones or all zeros.
    #[rustfmt::skip]
    pub const fn mask_lanes(self) -> Option<Size> {
        use VectorBinary::*;
        match self {
            I8x16Eq | I8x16Ne | I8x16LtS | I8x16LtU | I8x16GtS | I8x16GtU
            | I8x16LeS | I8x16LeU | I8x16GeS | I8x16GeU => Some(Size::S8),
            I16x8Eq | I16x8Ne | I16x8LtS | I16x8LtU | I16x8GtS | I16x8GtU
            | I16x8LeS | I16x8LeU | I16x8GeS | I16x8GeU => Some(Size::S16),
            I32x4Eq | I32x4Ne | I32x4LtS | I32x4LtU | I32x4GtS | I32x4GtU
            | I32x4LeS | I32x4LeU | I32x4GeS | I32x4GeU
            | F32x4Eq | F32x4Ne | F32x4Lt | F32x4Gt | F32x4Le | F32x4Ge => Some(Size::S32),
            I64x2Eq | I64x2Ne | I64x2LtS | I64x2GtS | I64x2LeS | I64x2GeS
            | F64x2Eq | F64x2Ne | F64x2Lt | F64x2Gt | F64x2Le | F64x2Ge => Some(Size::S64),
            _ => None,
        }
    }
}

impl VectorTernary {
    pub const fn is_relaxed(self) -> bool {
        !matches!(self, Self::Bitselect)
    }

    /// The lanes of a result in which the sign and payload of a NaN are not determined.
    pub const fn nan_lanes(self) -> Option<FloatWidth> {
        match self {
            Self::F32x4RelaxedMadd | Self::F32x4RelaxedNmadd => Some(FloatWidth::F32),
            Self::F64x2RelaxedMadd | Self::F64x2RelaxedNmadd => Some(FloatWidth::F64),
            _ => None,
        }
    }
}

impl VectorShift {
    pub const fn lanes(self) -> Size {
        match self {
            Self::I8x16Shl | Self::I8x16ShrS | Self::I8x16ShrU => Size::S8,
            Self::I16x8Shl | Self::I16x8ShrS | Self::I16x8ShrU => Size::S16,
            Self::I32x4Shl | Self::I32x4ShrS | Self::I32x4ShrU => Size::S32,
            Self::I64x2Shl | Self::I64x2ShrS | Self::I64x2ShrU => Size::S64,
        }
    }

    pub const fn kind(self) -> Shift {
        match self {
            Self::I8x16Shl | Self::I16x8Shl | Self::I32x4Shl | Self::I64x2Shl => Shift::Left,
            Self::I8x16ShrS | Self::I16x8ShrS | Self::I32x4ShrS | Self::I64x2ShrS => {
                Shift::RightArithmetic
            }
            Self::I8x16ShrU | Self::I16x8ShrU | Self::I32x4ShrU | Self::I64x2ShrU => {
                Shift::RightLogical
            }
        }
    }
}
