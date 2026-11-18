//! Families of vector instructions that share a form.

use crate::family::family;
use crate::operand::{FloatWidth, Rounding, Size};

pub(super) const Q: u32 = 1 << 30;
const U: u32 = 1 << 29;
/// The upper bit of the size, which for floats is part of the opcode.
const A: u32 = 1 << 23;

family! {
    /// The size and number of lanes. A result of 8 bytes clears the rest of the register.
    Arrangement: u32 {
        B8 = 0,
        B16 = Q,
        H4 = 1 << 22,
        H8 = Q | 1 << 22,
        S2 = 2 << 22,
        S4 = Q | 2 << 22,
        D2 = Q | 3 << 22,
    }
}

impl Arrangement {
    /// 16 bytes.
    #[inline]
    pub const fn full(lanes: Size) -> Self {
        match lanes {
            Size::S8 => Self::B16,
            Size::S16 => Self::H8,
            Size::S32 => Self::S4,
            Size::S64 => Self::D2,
        }
    }

    /// 8 bytes.
    #[inline]
    pub const fn half(lanes: Size) -> Self {
        match lanes {
            Size::S8 => Self::B8,
            Size::S16 => Self::H4,
            Size::S32 => Self::S2,
            Size::S64 => panic!("one lane is no vector"),
        }
    }

    #[inline]
    pub const fn of_floats(lanes: FloatWidth) -> Self {
        Self::full(lanes.width().size())
    }

    #[inline]
    pub const fn lanes(self) -> Size {
        match self {
            Self::B8 | Self::B16 => Size::S8,
            Self::H4 | Self::H8 => Size::S16,
            Self::S2 | Self::S4 => Size::S32,
            Self::D2 => Size::S64,
        }
    }

    #[inline]
    pub const fn is_full(self) -> bool {
        self as u32 & Q != 0
    }
}

// The sizes of lanes that an instruction takes are where the destination goes.
pub(super) const SIZES: u32 = 15;
const B: u32 = 1;
const H: u32 = 2;
const S: u32 = 4;
const D: u32 = 8;
const HS: u32 = H | S;
const SD: u32 = S | D;
const BHS: u32 = B | H | S;
const BHSD: u32 = B | H | S | D;

macro_rules! sized_family {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $value:expr,)* }) => {
        family! { $(#[$meta])* $name: u32 { $($variant = $value,)* } }

        impl $name {
            #[inline]
            pub const fn takes(self, lanes: Size) -> bool {
                self as u32 >> lanes.log2_bytes() & 1 != 0
            }
        }
    };
}

sized_family! {
    /// `dst = f(lhs, rhs)`. `Mla`, `Mls`, `Saba` and `Uaba` add to or subtract from `dst`.
    NeonBinary {
        Shadd = BHS,
        Sqadd = 1 << 11 | BHSD,
        Srhadd = 2 << 11 | BHS,
        Shsub = 4 << 11 | BHS,
        Sqsub = 5 << 11 | BHSD,
        Cmgt = 6 << 11 | BHSD,
        Cmge = 7 << 11 | BHSD,
        Sshl = 8 << 11 | BHSD,
        Smax = 12 << 11 | BHS,
        Smin = 13 << 11 | BHS,
        Sabd = 14 << 11 | BHS,
        Saba = 15 << 11 | BHS,
        Add = 16 << 11 | BHSD,
        Cmtst = 17 << 11 | BHSD,
        Mla = 18 << 11 | BHS,
        Mul = 19 << 11 | BHS,
        Smaxp = 20 << 11 | BHS,
        Sminp = 21 << 11 | BHS,
        Sqdmulh = 22 << 11 | HS,
        Addp = 23 << 11 | BHSD,
        Uhadd = U | BHS,
        Uqadd = U | 1 << 11 | BHSD,
        Urhadd = U | 2 << 11 | BHS,
        Uhsub = U | 4 << 11 | BHS,
        Uqsub = U | 5 << 11 | BHSD,
        Cmhi = U | 6 << 11 | BHSD,
        Cmhs = U | 7 << 11 | BHSD,
        Ushl = U | 8 << 11 | BHSD,
        Umax = U | 12 << 11 | BHS,
        Umin = U | 13 << 11 | BHS,
        Uabd = U | 14 << 11 | BHS,
        Uaba = U | 15 << 11 | BHS,
        Sub = U | 16 << 11 | BHSD,
        Cmeq = U | 17 << 11 | BHSD,
        Mls = U | 18 << 11 | BHS,
        Umaxp = U | 20 << 11 | BHS,
        Uminp = U | 21 << 11 | BHS,
        Sqrdmulh = U | 22 << 11 | HS,
    }
}

family! {
    /// `dst = f(lhs, rhs)`. `Fmla` and `Fmls` add to or subtract from `dst` and round once.
    NeonFloatBinary: u32 {
        Fmaxnm = 24 << 11,
        Fmla = 25 << 11,
        Fadd = 26 << 11,
        Fcmeq = 28 << 11,
        Fmax = 30 << 11,
        Fminnm = A | 24 << 11,
        Fmls = A | 25 << 11,
        Fsub = A | 26 << 11,
        Fmin = A | 30 << 11,
        Faddp = U | 26 << 11,
        Fmul = U | 27 << 11,
        Fcmge = U | 28 << 11,
        Fmaxp = U | 30 << 11,
        Fdiv = U | 31 << 11,
        Fabd = U | A | 26 << 11,
        Fcmgt = U | A | 28 << 11,
        Fminp = U | A | 30 << 11,
    }
}

family! {
    /// `Bsl` selects by the bits of `dst`. `Bit` and `Bif` insert `lhs` where the bits of `rhs` are set or clear.
    NeonBitwise: u32 {
        And = 0,
        Bic = 1 << 22,
        Orr = 2 << 22,
        Orn = 3 << 22,
        Eor = U,
        Bsl = U | 1 << 22,
        Bit = U | 2 << 22,
        Bif = U | 3 << 22,
    }
}

family! {
    /// From halves of vectors to lanes of twice the size. In the `w` forms `lhs` has those already, and `abal`, `mlal`
    /// and `mlsl` add to or subtract from `dst`.
    NeonLong: u32 {
        Saddl = 0,
        Saddw = 1 << 12,
        Ssubl = 2 << 12,
        Ssubw = 3 << 12,
        Sabal = 5 << 12,
        Sabdl = 7 << 12,
        Smlal = 8 << 12,
        Smlsl = 10 << 12,
        Smull = 12 << 12,
        Uaddl = U,
        Uaddw = U | 1 << 12,
        Usubl = U | 2 << 12,
        Usubw = U | 3 << 12,
        Uabal = U | 5 << 12,
        Uabdl = U | 7 << 12,
        Umlal = U | 8 << 12,
        Umlsl = U | 10 << 12,
        Umull = U | 12 << 12,
    }
}

family! {
    /// The upper halves of the lanes of a sum or difference.
    NeonHighHalves: u32 {
        Addhn = 4 << 12,
        Subhn = 6 << 12,
        Raddhn = U | 4 << 12,
        Rsubhn = U | 6 << 12,
    }
}

sized_family! {
    /// `dst = f(src)`. The comparisons are with zero.
    NeonUnary {
        Rev64 = BHS,
        Rev16 = 1 << 12 | B,
        Cls = 4 << 12 | BHS,
        Cnt = 5 << 12 | B,
        Sqabs = 7 << 12 | BHSD,
        Cmgt = 8 << 12 | BHSD,
        Cmeq = 9 << 12 | BHSD,
        Cmlt = 10 << 12 | BHSD,
        Abs = 11 << 12 | BHSD,
        Rev32 = U | B | H,
        Clz = U | 4 << 12 | BHS,
        Not = U | 5 << 12 | B,
        Rbit = U | 1 << 22 | 5 << 12 | B,
        Sqneg = U | 7 << 12 | BHSD,
        Cmge = U | 8 << 12 | BHSD,
        Cmle = U | 9 << 12 | BHSD,
        Neg = U | 11 << 12 | BHSD,
    }
}

family! {
    /// Adds neighbours into lanes of twice the size. The `adalp` forms add to `dst`.
    NeonAddPairs: u32 {
        Saddlp = 2 << 12,
        Sadalp = 6 << 12,
        Uaddlp = U | 2 << 12,
        Uadalp = U | 6 << 12,
    }
}

family! {
    /// To lanes of half the size.
    NeonNarrow: u32 {
        Xtn = 18 << 12,
        Sqxtn = 20 << 12,
        Sqxtun = U | 18 << 12,
        Uqxtn = U | 20 << 12,
    }
}

family! {
    /// `dst = f(src)`. The comparisons are with zero.
    NeonFloatUnary: u32 {
        Frintn = 24 << 12,
        Frintm = 25 << 12,
        Scvtf = 29 << 12,
        Fcmgt = A | 12 << 12,
        Fcmeq = A | 13 << 12,
        Fcmlt = A | 14 << 12,
        Fabs = A | 15 << 12,
        Frintp = A | 24 << 12,
        Frintz = A | 25 << 12,
        Fcvtzs = A | 27 << 12,
        Ucvtf = U | 29 << 12,
        Fcmge = U | A | 12 << 12,
        Fcmle = U | A | 13 << 12,
        Fneg = U | A | 15 << 12,
        Fcvtzu = U | A | 27 << 12,
        Fsqrt = U | A | 31 << 12,
    }
}

impl From<Rounding> for NeonFloatUnary {
    #[inline]
    fn from(rounding: Rounding) -> Self {
        match rounding {
            Rounding::Down => Self::Frintm,
            Rounding::Up => Self::Frintp,
            Rounding::TowardZero => Self::Frintz,
            Rounding::Nearest => Self::Frintn,
        }
    }
}

family! {
    /// From at least four lanes to one, which for the `addlv` forms has twice the size.
    NeonAcross: u32 {
        Saddlv = 3 << 12,
        Smaxv = 10 << 12,
        Sminv = 26 << 12,
        Addv = 27 << 12,
        Uaddlv = U | 3 << 12,
        Umaxv = U | 10 << 12,
        Uminv = U | 26 << 12,
    }
}

family! {
    /// From four floats of 32 bits to one.
    NeonFloatAcross: u32 {
        Fmaxnmv = 12 << 12,
        Fmaxv = 15 << 12,
        Fminnmv = A | 12 << 12,
        Fminv = A | 15 << 12,
    }
}

family! {
    /// From the first two floats to one.
    NeonFloatPair: u32 {
        Fmaxnmp = 12 << 12,
        Faddp = 13 << 12,
        Fmaxp = 15 << 12,
        Fminnmp = A | 12 << 12,
        Fminp = A | 15 << 12,
    }
}

family! {
    /// The `sra` forms add to `dst`, and `Sri` keeps its bits where none are shifted in.
    NeonShiftRight: u32 {
        Sshr = 0,
        Ssra = 2 << 11,
        Srshr = 4 << 11,
        Ushr = U,
        Usra = U | 2 << 11,
        Urshr = U | 4 << 11,
        Sri = U | 8 << 11,
    }
}

family! {
    /// `Sli` keeps the bits of `dst` where none are shifted in.
    NeonShiftLeft: u32 {
        Shl = 10 << 11,
        Sqshl = 14 << 11,
        Sli = U | 10 << 11,
        Uqshl = U | 14 << 11,
    }
}

family! {
    /// Shifts right, to lanes of half the size.
    NeonShiftNarrow: u32 {
        Shrn = 16 << 11,
        Rshrn = 17 << 11,
        Sqshrn = 18 << 11,
        Sqrshrn = 19 << 11,
        Sqshrun = U | 16 << 11,
        Sqrshrun = U | 17 << 11,
        Uqshrn = U | 18 << 11,
        Uqrshrn = U | 19 << 11,
    }
}

family! {
    NeonPermute: u32 {
        Uzp1 = 1 << 12,
        Trn1 = 2 << 12,
        Zip1 = 3 << 12,
        Uzp2 = 5 << 12,
        Trn2 = 6 << 12,
        Zip2 = 7 << 12,
    }
}

family! {
    /// For an index past the table `Tbl` gives zero and `Tbx` keeps the byte of `dst`.
    NeonLookup: u32 {
        Tbl = 0,
        Tbx = 1 << 12,
    }
}

sized_family! {
    /// As in [`NeonBinary`], [`NeonFloatBinary`] and [`NeonLong`], with one lane of `rhs` for all of `lhs`.
    NeonByElement {
        Mul = 8 << 12 | HS,
        Mla = U | HS,
        Mls = U | 4 << 12 | HS,
        Sqdmulh = 12 << 12 | HS,
        Sqrdmulh = 13 << 12 | HS,
        Smull = 10 << 12 | HS,
        Smlal = 2 << 12 | HS,
        Umull = U | 10 << 12 | HS,
        Umlal = U | 2 << 12 | HS,
        Fmul = 9 << 12 | SD,
        Fmla = 1 << 12 | SD,
        Fmls = 5 << 12 | SD,
    }
}

family! {
    /// Sets or clears bits of `dst`.
    NeonBitwiseImm: u32 {
        Orr = 0,
        Bic = U,
    }
}

family! {
    /// `a ^ b ^ c` and `a ^ (b & !c)`.
    NeonBitwiseThree: u32 {
        Eor3 = 0,
        Bcax = 1 << 21,
    }
}
