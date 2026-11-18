//! Register numbers and sets of them. The names are in `x64` and `arm64`.

use core::fmt;
use core::ops::{BitAnd, BitAndAssign, BitOr, BitOrAssign, Sub, SubAssign};

/// A general purpose register.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Gpr(pub(crate) u8);

/// A floating point and vector register.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Fpr(pub(crate) u8);

/// A register of either bank.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Reg(u8);

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Bank {
    Gpr,
    Fpr,
}

const BANK_SIZE: u8 = 32;

impl Gpr {
    #[inline]
    pub const fn new(number: u8) -> Self {
        assert!(number < BANK_SIZE);
        Self(number)
    }

    #[inline]
    pub const fn number(self) -> u8 {
        self.0
    }
}

impl Fpr {
    #[inline]
    pub const fn new(number: u8) -> Self {
        assert!(number < BANK_SIZE);
        Self(number)
    }

    #[inline]
    pub const fn number(self) -> u8 {
        self.0
    }
}

impl Reg {
    /// Indices run from zero up to this.
    pub const COUNT: usize = 2 * BANK_SIZE as usize;

    #[inline]
    pub const fn from_gpr(gpr: Gpr) -> Self {
        assert!(gpr.0 < BANK_SIZE);
        Self(gpr.0)
    }

    #[inline]
    pub const fn from_fpr(fpr: Fpr) -> Self {
        assert!(fpr.0 < BANK_SIZE);
        Self(BANK_SIZE + fpr.0)
    }

    #[inline]
    pub const fn from_index(index: usize) -> Self {
        assert!(index < Self::COUNT);
        Self(index as u8)
    }

    #[inline]
    pub const fn index(self) -> usize {
        (self.0 & (2 * BANK_SIZE - 1)) as usize
    }

    #[inline]
    pub const fn bank(self) -> Bank {
        if self.0 < BANK_SIZE {
            Bank::Gpr
        } else {
            Bank::Fpr
        }
    }

    #[inline]
    pub const fn gpr(self) -> Gpr {
        assert!(self.0 < BANK_SIZE);
        Gpr(self.0)
    }

    #[inline]
    pub const fn fpr(self) -> Fpr {
        assert!(self.0 >= BANK_SIZE);
        Fpr(self.0 - BANK_SIZE)
    }
}

impl From<Gpr> for Reg {
    #[inline]
    fn from(gpr: Gpr) -> Self {
        Self::from_gpr(gpr)
    }
}

impl From<Fpr> for Reg {
    #[inline]
    fn from(fpr: Fpr) -> Self {
        Self::from_fpr(fpr)
    }
}

impl fmt::Debug for Gpr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "r{}", self.0)
    }
}

impl fmt::Debug for Fpr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "f{}", self.0)
    }
}

impl fmt::Debug for Reg {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.bank() {
            Bank::Gpr => self.gpr().fmt(f),
            Bank::Fpr => self.fpr().fmt(f),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct RegisterSet(u64);

impl RegisterSet {
    pub const EMPTY: Self = Self(0);

    #[inline]
    pub const fn from_bits(bits: u64) -> Self {
        Self(bits)
    }

    /// Bit `n` stands for the register whose [`Reg::index`] is `n`.
    #[inline]
    pub const fn bits(self) -> u64 {
        self.0
    }

    pub const fn of(gprs: &[Gpr], fprs: &[Fpr]) -> Self {
        let mut set = Self::EMPTY;
        let mut i = 0;
        while i < gprs.len() {
            set = set.with(Reg::from_gpr(gprs[i]));
            i += 1;
        }
        i = 0;
        while i < fprs.len() {
            set = set.with(Reg::from_fpr(fprs[i]));
            i += 1;
        }
        set
    }

    /// The registers of a bank with the numbers `first..=last`.
    pub const fn range(bank: Bank, first: u8, last: u8) -> Self {
        assert!(first <= last && last < BANK_SIZE);
        let bits = (u64::MAX >> (63 - last)) & (u64::MAX << first);
        match bank {
            Bank::Gpr => Self(bits),
            Bank::Fpr => Self(bits << BANK_SIZE),
        }
    }

    #[inline]
    pub const fn with(self, reg: Reg) -> Self {
        Self(self.0 | 1 << reg.index())
    }

    #[inline]
    pub const fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    #[inline]
    pub const fn intersection(self, other: Self) -> Self {
        Self(self.0 & other.0)
    }

    #[inline]
    pub const fn difference(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }

    #[inline]
    pub const fn in_bank(self, bank: Bank) -> Self {
        match bank {
            Bank::Gpr => Self(self.0 & u32::MAX as u64),
            Bank::Fpr => Self(self.0 & !(u32::MAX as u64)),
        }
    }

    #[inline]
    pub fn insert(&mut self, reg: impl Into<Reg>) {
        self.0 |= 1 << reg.into().index();
    }

    #[inline]
    pub fn remove(&mut self, reg: impl Into<Reg>) {
        self.0 &= !(1 << reg.into().index());
    }

    #[inline]
    pub fn contains(self, reg: impl Into<Reg>) -> bool {
        self.0 >> reg.into().index() & 1 != 0
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    #[inline]
    pub const fn len(self) -> u32 {
        self.0.count_ones()
    }

    #[inline]
    pub const fn first(self) -> Option<Reg> {
        if self.0 == 0 {
            None
        } else {
            Some(Reg(self.0.trailing_zeros() as u8))
        }
    }

    #[inline]
    pub fn gprs(self) -> impl Iterator<Item = Gpr> {
        self.in_bank(Bank::Gpr).into_iter().map(Reg::gpr)
    }

    #[inline]
    pub fn fprs(self) -> impl Iterator<Item = Fpr> {
        self.in_bank(Bank::Fpr).into_iter().map(Reg::fpr)
    }
}

pub struct RegisterSetIter(RegisterSet);

impl Iterator for RegisterSetIter {
    type Item = Reg;

    #[inline]
    fn next(&mut self) -> Option<Reg> {
        let reg = self.0.first()?;
        self.0.0 &= self.0.0 - 1;
        Some(reg)
    }
}

impl IntoIterator for RegisterSet {
    type Item = Reg;
    type IntoIter = RegisterSetIter;

    #[inline]
    fn into_iter(self) -> RegisterSetIter {
        RegisterSetIter(self)
    }
}

impl<R: Into<Reg>> FromIterator<R> for RegisterSet {
    fn from_iter<I: IntoIterator<Item = R>>(registers: I) -> Self {
        let mut set = Self::EMPTY;
        for reg in registers {
            set.insert(reg);
        }
        set
    }
}

macro_rules! set_operator {
    ($trait:ident, $method:ident, $assign_trait:ident, $assign_method:ident, $function:ident) => {
        impl $trait for RegisterSet {
            type Output = Self;

            #[inline]
            fn $method(self, other: Self) -> Self {
                self.$function(other)
            }
        }

        impl $assign_trait for RegisterSet {
            #[inline]
            fn $assign_method(&mut self, other: Self) {
                *self = self.$function(other);
            }
        }
    };
}

set_operator!(BitOr, bitor, BitOrAssign, bitor_assign, union);
set_operator!(BitAnd, bitand, BitAndAssign, bitand_assign, intersection);
set_operator!(Sub, sub, SubAssign, sub_assign, difference);

impl fmt::Debug for RegisterSet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_set().entries(*self).finish()
    }
}
