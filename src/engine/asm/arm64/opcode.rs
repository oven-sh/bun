//! Families of instructions that share a form.

use crate::family::family;
use crate::operand::{Cond, FloatWidth, ResultCond, Rounding, TestCond};

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Cc {
    Eq,
    Ne,
    Hs,
    Lo,
    Mi,
    Pl,
    Vs,
    Vc,
    Hi,
    Ls,
    Ge,
    Lt,
    Gt,
    Le,
}

impl Cc {
    pub const ALL: [Self; 14] = [
        Self::Eq,
        Self::Ne,
        Self::Hs,
        Self::Lo,
        Self::Mi,
        Self::Pl,
        Self::Vs,
        Self::Vc,
        Self::Hi,
        Self::Ls,
        Self::Ge,
        Self::Lt,
        Self::Gt,
        Self::Le,
    ];

    #[inline]
    pub const fn inverted(self) -> Self {
        Self::ALL[self as usize ^ 1]
    }
}

impl From<Cond> for Cc {
    #[inline]
    fn from(cond: Cond) -> Self {
        match cond {
            Cond::Eq => Self::Eq,
            Cond::Ne => Self::Ne,
            Cond::Lt => Self::Lt,
            Cond::Ge => Self::Ge,
            Cond::Le => Self::Le,
            Cond::Gt => Self::Gt,
            Cond::Below => Self::Lo,
            Cond::AboveEq => Self::Hs,
            Cond::BelowEq => Self::Ls,
            Cond::Above => Self::Hi,
        }
    }
}

impl From<TestCond> for Cc {
    #[inline]
    fn from(cond: TestCond) -> Self {
        match cond {
            TestCond::Zero => Self::Eq,
            TestCond::NonZero => Self::Ne,
            TestCond::Negative => Self::Mi,
            TestCond::NonNegative => Self::Pl,
        }
    }
}

impl Cc {
    #[inline]
    pub const fn after_addition(cond: ResultCond) -> Self {
        match cond {
            ResultCond::Zero => Self::Eq,
            ResultCond::NonZero => Self::Ne,
            ResultCond::Negative => Self::Mi,
            ResultCond::NonNegative => Self::Pl,
            ResultCond::Overflow => Self::Vs,
            ResultCond::NoOverflow => Self::Vc,
            ResultCond::Carry => Self::Hs,
            ResultCond::NoCarry => Self::Lo,
        }
    }

    /// A subtraction sets the carry flag when it does not borrow.
    #[inline]
    pub const fn after_subtraction(cond: ResultCond) -> Self {
        match cond {
            ResultCond::Carry | ResultCond::NoCarry => Self::after_addition(cond).inverted(),
            _ => Self::after_addition(cond),
        }
    }
}

bitflags::bitflags! {
    /// What a conditional comparison sets the flags to when its condition does not hold.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
    pub struct Nzcv: u8 {
        const N = 8;
        const Z = 4;
        const C = 2;
        const V = 1;
    }
}

const SETS_FLAGS: u32 = 1 << 29;
const SUBTRACTS: u32 = 1 << 30;

family! {
    AddSub: u32 {
        Add = 0,
        Adds = SETS_FLAGS,
        Sub = SUBTRACTS,
        Subs = SUBTRACTS | SETS_FLAGS,
    }
}

impl AddSub {
    #[inline]
    pub const fn sets_flags(self) -> bool {
        self as u32 & SETS_FLAGS != 0
    }

    /// With the negative of a constant other than zero it gives the same result and flags.
    #[inline]
    pub const fn opposite(self) -> Self {
        match self {
            Self::Add => Self::Sub,
            Self::Adds => Self::Subs,
            Self::Sub => Self::Add,
            Self::Subs => Self::Adds,
        }
    }
}

family! {
    WithCarry: u32 {
        Adc = 0,
        Adcs = SETS_FLAGS,
        Sbc = SUBTRACTS,
        Sbcs = SUBTRACTS | SETS_FLAGS,
    }
}

const INVERTS: u32 = 1 << 21;

family! {
    /// The last four invert the second source.
    Logical: u32 {
        And = 0,
        Orr = 1 << 29,
        Eor = 2 << 29,
        Ands = 3 << 29,
        Bic = INVERTS,
        Orn = 1 << 29 | INVERTS,
        Eon = 2 << 29 | INVERTS,
        Bics = 3 << 29 | INVERTS,
    }
}

impl Logical {
    #[inline]
    pub const fn has_immediate_form(self) -> bool {
        self as u32 & INVERTS == 0
    }
}

family! {
    ShiftOp: u8 {
        Lsl = 0,
        Lsr = 1,
        Asr = 2,
        Ror = 3,
    }
}

family! {
    Extend: u8 {
        Uxtb = 0,
        Uxth = 1,
        Uxtw = 2,
        Uxtx = 3,
        Sxtb = 4,
        Sxth = 5,
        Sxtw = 6,
        Sxtx = 7,
    }
}

family! {
    /// How much of the index register of an address counts. `Lsl` takes all of it.
    IndexExtend: u8 {
        Uxtw = 2,
        Lsl = 3,
        Sxtw = 6,
    }
}

family! {
    MoveWide: u32 {
        Movn = 0,
        Movz = 2 << 29,
        Movk = 3 << 29,
    }
}

family! {
    /// What is outside the field is filled with its sign, kept, or cleared.
    Bitfield: u32 {
        Sbfm = 0,
        Bfm = 1 << 29,
        Ubfm = 2 << 29,
    }
}

family! {
    /// `Rev32` is for 64 bits only.
    Unary: u8 {
        Rbit = 0,
        Rev16 = 1,
        Rev32 = 2,
        Rev = 3,
        Clz = 4,
        Cls = 5,
    }
}

const SUBTRACTS_PRODUCT: u32 = 1 << 15;

family! {
    /// `dst = addend ± lhs * rhs`.
    MultiplyAdd: u32 {
        Madd = 0,
        Msub = SUBTRACTS_PRODUCT,
    }
}

family! {
    /// `dst = addend ± lhs * rhs`, with factors of 32 bits and the rest of 64.
    MultiplyAddLong: u32 {
        Smaddl = 1 << 21,
        Smsubl = 1 << 21 | SUBTRACTS_PRODUCT,
        Umaddl = 5 << 21,
        Umsubl = 5 << 21 | SUBTRACTS_PRODUCT,
    }
}

family! {
    /// The second source is taken as it is, incremented, inverted or negated.
    Select: u32 {
        Csel = 0,
        Csinc = 1 << 10,
        Csinv = 1 << 30,
        Csneg = 1 << 30 | 1 << 10,
    }
}

family! {
    ConditionalCompare: u32 {
        Ccmn = 0,
        Ccmp = SUBTRACTS,
    }
}

family! {
    /// With acquire and release semantics. `Ldclral` clears the bits that are set in its operand.
    AtomicUpdate: u32 {
        Ldaddal = 0,
        Ldclral = 1 << 12,
        Ldeoral = 2 << 12,
        Ldsetal = 3 << 12,
        Swpal = 8 << 12,
    }
}

family! {
    Barrier: u8 {
        Ishld = 9,
        Ishst = 10,
        Ish = 11,
    }
}

family! {
    FloatFormat: u8 {
        Single = 0,
        Double = 1,
        Half = 3,
    }
}

impl From<FloatWidth> for FloatFormat {
    #[inline]
    fn from(width: FloatWidth) -> Self {
        match width {
            FloatWidth::F32 => Self::Single,
            FloatWidth::F64 => Self::Double,
        }
    }
}

family! {
    FloatUnary: u8 {
        Fmov = 0,
        Fabs = 1,
        Fneg = 2,
        Fsqrt = 3,
        Frintn = 8,
        Frintp = 9,
        Frintm = 10,
        Frintz = 11,
        Frinta = 12,
        Frintx = 14,
        Frinti = 15,
        Frint32z = 16,
        Frint64z = 18,
    }
}

impl From<Rounding> for FloatUnary {
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
    FloatBinary: u8 {
        Fmul = 0,
        Fdiv = 1,
        Fadd = 2,
        Fsub = 3,
        Fmax = 4,
        Fmin = 5,
        Fmaxnm = 6,
        Fminnm = 7,
        Fnmul = 8,
    }
}

family! {
    /// `addend + lhs * rhs`, `addend - lhs * rhs`, `-addend - lhs * rhs` and `-addend + lhs * rhs`, rounded once.
    FloatMultiplyAdd: u32 {
        Fmadd = 0,
        Fmsub = 1 << 15,
        Fnmadd = 1 << 21,
        Fnmsub = 1 << 21 | 1 << 15,
    }
}
