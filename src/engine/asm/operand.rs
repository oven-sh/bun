//! Operands and conditions, the same for every architecture.

use crate::label::Label;
use crate::register::Gpr;

/// The width of an integer operation. An operation of 32 bits clears the upper half of the register it writes.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Width {
    W32,
    W64,
}

/// The size of a memory access.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Size {
    S8,
    S16,
    S32,
    S64,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum FloatWidth {
    F32,
    F64,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Sign {
    Signed,
    Unsigned,
}

impl Width {
    #[inline]
    pub const fn bits(self) -> u8 {
        32 << self as u8
    }

    #[inline]
    pub const fn size(self) -> Size {
        match self {
            Self::W32 => Size::S32,
            Self::W64 => Size::S64,
        }
    }
}

impl Size {
    #[inline]
    pub const fn log2_bytes(self) -> u8 {
        self as u8
    }

    #[inline]
    pub const fn bytes(self) -> u8 {
        1 << self as u8
    }

    #[inline]
    pub const fn bits(self) -> u8 {
        8 << self as u8
    }

    /// The narrowest integer operation that holds a value of this size.
    #[inline]
    pub const fn width(self) -> Width {
        match self {
            Self::S64 => Width::W64,
            _ => Width::W32,
        }
    }
}

impl FloatWidth {
    #[inline]
    pub const fn width(self) -> Width {
        match self {
            Self::F32 => Width::W32,
            Self::F64 => Width::W64,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Scale {
    One,
    Two,
    Four,
    Eight,
}

impl Scale {
    #[inline]
    pub const fn from_log2(log2: u8) -> Option<Self> {
        match log2 {
            0 => Some(Self::One),
            1 => Some(Self::Two),
            2 => Some(Self::Four),
            3 => Some(Self::Eight),
            _ => None,
        }
    }

    #[inline]
    pub const fn log2(self) -> u8 {
        self as u8
    }
}

impl From<Size> for Scale {
    #[inline]
    fn from(size: Size) -> Self {
        match size {
            Size::S8 => Self::One,
            Size::S16 => Self::Two,
            Size::S32 => Self::Four,
            Size::S64 => Self::Eight,
        }
    }
}

/// `base + index * scale + offset`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Address {
    pub(crate) base: Gpr,
    pub(crate) index: Gpr,
    pub(crate) scale: Scale,
    pub(crate) offset: i32,
}

impl Address {
    // The low four bits of these three are what x86-64 encodes for them.
    pub(crate) const NO_INDEX: Gpr = Gpr(0x84);
    pub(crate) const NO_BASE: Gpr = Gpr(0x85);
    /// `offset` is the number of a label.
    pub(crate) const LABEL_BASE: Gpr = Gpr(0xc5);

    #[inline]
    pub const fn new(base: Gpr, offset: i32) -> Self {
        Self {
            base,
            index: Self::NO_INDEX,
            scale: Scale::One,
            offset,
        }
    }

    #[inline]
    pub const fn indexed(base: Gpr, index: Gpr, scale: Scale, offset: i32) -> Self {
        Self {
            base,
            index,
            scale,
            offset,
        }
    }

    #[inline]
    pub(crate) const fn at_label(label: Label) -> Self {
        Self::new(Self::LABEL_BASE, label.0 as i32)
    }

    #[inline]
    pub const fn base(self) -> Gpr {
        self.base
    }

    #[inline]
    pub const fn index(self) -> Option<(Gpr, Scale)> {
        if self.has_index() {
            Some((self.index, self.scale))
        } else {
            None
        }
    }

    #[inline]
    pub const fn offset(self) -> i32 {
        self.offset
    }

    #[inline]
    pub const fn plus(self, bytes: i32) -> Self {
        assert!(self.base.0 != Self::LABEL_BASE.0);
        Self {
            offset: self.offset.strict_add(bytes),
            ..self
        }
    }

    #[inline]
    pub fn uses(self, reg: Gpr) -> bool {
        self.base == reg || self.index == reg
    }

    #[inline]
    pub(crate) const fn has_index(self) -> bool {
        self.index.0 != Self::NO_INDEX.0
    }
}

/// An address in the process.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Absolute(pub usize);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Memory {
    Address(Address),
    Absolute(Absolute),
}

impl From<Address> for Memory {
    #[inline]
    fn from(address: Address) -> Self {
        Self::Address(address)
    }
}

impl From<Absolute> for Memory {
    #[inline]
    fn from(address: Absolute) -> Self {
        Self::Absolute(address)
    }
}

/// A constant that the program chose. The macro assembler may keep its bytes out of the code.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Untrusted<T>(pub T);

/// An operand that is read. An operation of 32 bits reads the low half of a constant.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Src {
    Reg(Gpr),
    Imm(i64),
    Untrusted(i64),
    Mem(Memory),
}

/// A register or a constant.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RegOrImm {
    Reg(Gpr),
    Imm(i64),
    Untrusted(i64),
}

/// A register or memory.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RegOrMem {
    Reg(Gpr),
    Mem(Memory),
}

/// The distance of a shift, or the number of a bit, modulo the width of the operation.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Amount {
    Reg(Gpr),
    Imm(u8),
}

macro_rules! conversions {
    ($target:ident { $($source:ty => |$value:ident| $body:expr,)* }) => {
        $(impl From<$source> for $target {
            #[inline]
            fn from($value: $source) -> Self {
                $body
            }
        })*
    };
}

macro_rules! constant_conversions {
    ($($target:ident),*) => {
        $(conversions!($target {
            Gpr => |reg| Self::Reg(reg),
            i32 => |value| Self::Imm(value.into()),
            u32 => |value| Self::Imm(value.into()),
            i64 => |value| Self::Imm(value),
            u64 => |value| Self::Imm(value as i64),
            usize => |value| Self::Imm(value as i64),
            Untrusted<i32> => |value| Self::Untrusted(value.0.into()),
            Untrusted<u32> => |value| Self::Untrusted(value.0.into()),
            Untrusted<i64> => |value| Self::Untrusted(value.0),
            Untrusted<u64> => |value| Self::Untrusted(value.0 as i64),
        });)*
    };
}

constant_conversions!(Src, RegOrImm);

conversions!(Src {
    Address => |address| Self::Mem(address.into()),
    Absolute => |address| Self::Mem(address.into()),
    Memory => |memory| Self::Mem(memory),
    RegOrImm => |operand| match operand {
        RegOrImm::Reg(reg) => Self::Reg(reg),
        RegOrImm::Imm(value) => Self::Imm(value),
        RegOrImm::Untrusted(value) => Self::Untrusted(value),
    },
    RegOrMem => |operand| match operand {
        RegOrMem::Reg(reg) => Self::Reg(reg),
        RegOrMem::Mem(memory) => Self::Mem(memory),
    },
});

conversions!(RegOrMem {
    Gpr => |reg| Self::Reg(reg),
    Address => |address| Self::Mem(address.into()),
    Absolute => |address| Self::Mem(address.into()),
    Memory => |memory| Self::Mem(memory),
});

conversions!(Amount {
    Gpr => |reg| Self::Reg(reg),
    u8 => |amount| Self::Imm(amount),
});

/// A comparison of integers. `Below` and `Above` are unsigned.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Cond {
    Eq,
    Ne,
    Lt,
    Ge,
    Le,
    Gt,
    Below,
    AboveEq,
    BelowEq,
    Above,
}

impl Cond {
    pub const ALL: [Self; 10] = [
        Self::Eq,
        Self::Ne,
        Self::Lt,
        Self::Ge,
        Self::Le,
        Self::Gt,
        Self::Below,
        Self::AboveEq,
        Self::BelowEq,
        Self::Above,
    ];

    /// Holds where `self` does not.
    #[inline]
    pub const fn inverted(self) -> Self {
        Self::ALL[self as usize ^ 1]
    }

    /// The same comparison with the operands exchanged.
    #[inline]
    pub const fn commuted(self) -> Self {
        match self {
            Self::Eq | Self::Ne => self,
            Self::Lt => Self::Gt,
            Self::Ge => Self::Le,
            Self::Le => Self::Ge,
            Self::Gt => Self::Lt,
            Self::Below => Self::Above,
            Self::AboveEq => Self::BelowEq,
            Self::BelowEq => Self::AboveEq,
            Self::Above => Self::Below,
        }
    }

    #[inline]
    pub const fn is_signed(self) -> bool {
        matches!(self, Self::Lt | Self::Ge | Self::Le | Self::Gt)
    }

    pub const fn holds32(self, lhs: i32, rhs: i32) -> bool {
        if self.is_signed() {
            self.holds64(lhs as i64, rhs as i64)
        } else {
            self.holds64(lhs as u32 as i64, rhs as u32 as i64)
        }
    }

    pub const fn holds64(self, lhs: i64, rhs: i64) -> bool {
        match self {
            Self::Eq => lhs == rhs,
            Self::Ne => lhs != rhs,
            Self::Lt => lhs < rhs,
            Self::Ge => lhs >= rhs,
            Self::Le => lhs <= rhs,
            Self::Gt => lhs > rhs,
            Self::Below => (lhs as u64) < rhs as u64,
            Self::AboveEq => lhs as u64 >= rhs as u64,
            Self::BelowEq => lhs as u64 <= rhs as u64,
            Self::Above => lhs as u64 > rhs as u64,
        }
    }
}

/// A property of `value & mask`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum TestCond {
    Zero,
    NonZero,
    Negative,
    NonNegative,
}

impl TestCond {
    pub const ALL: [Self; 4] = [Self::Zero, Self::NonZero, Self::Negative, Self::NonNegative];

    #[inline]
    pub const fn inverted(self) -> Self {
        Self::ALL[self as usize ^ 1]
    }
}

/// A property of the result of arithmetic.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum ResultCond {
    Zero,
    NonZero,
    Negative,
    NonNegative,
    /// The signed result does not fit.
    Overflow,
    NoOverflow,
    /// The unsigned result does not fit: a carry out of an addition, a borrow in a subtraction.
    Carry,
    NoCarry,
}

impl ResultCond {
    pub const ALL: [Self; 8] = [
        Self::Zero,
        Self::NonZero,
        Self::Negative,
        Self::NonNegative,
        Self::Overflow,
        Self::NoOverflow,
        Self::Carry,
        Self::NoCarry,
    ];

    #[inline]
    pub const fn inverted(self) -> Self {
        Self::ALL[self as usize ^ 1]
    }
}

/// A comparison of floats. With a NaN operand those named `Unordered` hold and the others do not.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum FloatCond {
    Eq,
    NeOrUnordered,
    Ne,
    EqOrUnordered,
    Lt,
    GeOrUnordered,
    Le,
    GtOrUnordered,
    Gt,
    LeOrUnordered,
    Ge,
    LtOrUnordered,
    Ordered,
    Unordered,
}

impl FloatCond {
    pub const ALL: [Self; 14] = [
        Self::Eq,
        Self::NeOrUnordered,
        Self::Ne,
        Self::EqOrUnordered,
        Self::Lt,
        Self::GeOrUnordered,
        Self::Le,
        Self::GtOrUnordered,
        Self::Gt,
        Self::LeOrUnordered,
        Self::Ge,
        Self::LtOrUnordered,
        Self::Ordered,
        Self::Unordered,
    ];

    #[inline]
    pub const fn inverted(self) -> Self {
        Self::ALL[self as usize ^ 1]
    }

    #[inline]
    pub const fn commuted(self) -> Self {
        match self {
            Self::Lt => Self::Gt,
            Self::Le => Self::Ge,
            Self::Gt => Self::Lt,
            Self::Ge => Self::Le,
            Self::LtOrUnordered => Self::GtOrUnordered,
            Self::LeOrUnordered => Self::GeOrUnordered,
            Self::GtOrUnordered => Self::LtOrUnordered,
            Self::GeOrUnordered => Self::LeOrUnordered,
            Self::Eq
            | Self::Ne
            | Self::EqOrUnordered
            | Self::NeOrUnordered
            | Self::Ordered
            | Self::Unordered => self,
        }
    }

    pub const fn holds(self, lhs: f64, rhs: f64) -> bool {
        let unordered = lhs.is_nan() || rhs.is_nan();
        match self {
            Self::Eq => lhs == rhs,
            Self::Ne => !unordered && lhs != rhs,
            Self::Lt => lhs < rhs,
            Self::Le => lhs <= rhs,
            Self::Gt => lhs > rhs,
            Self::Ge => lhs >= rhs,
            Self::Ordered => !unordered,
            _ => !self.inverted().holds(lhs, rhs),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Shift {
    Left,
    /// Fills with zeros.
    RightLogical,
    /// Fills with the sign.
    RightArithmetic,
    RotateLeft,
    RotateRight,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Rounding {
    Down,
    Up,
    TowardZero,
    /// Ties go to the even neighbour.
    Nearest,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum AtomicOp {
    Add,
    Sub,
    And,
    Or,
    Xor,
    Exchange,
}

/// Whether a conversion to an integer takes −0 for 0.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum NegativeZero {
    Accept,
    Reject,
}
