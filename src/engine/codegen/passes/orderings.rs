//! How two values can be ordered.

use bun_engine_asm::{Cond, FloatCond};

use super::bounds::Bounds;

bitflags::bitflags! {
    /// Of two integers with and without sign, or of two floats.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(super) struct Orderings: u8 {
        const EQUAL = 1 << 0;
        const LESS_BELOW = 1 << 1;
        const LESS_ABOVE = 1 << 2;
        const GREATER_BELOW = 1 << 3;
        const GREATER_ABOVE = 1 << 4;
        const UNORDERED = 1 << 5;
        const LESS = Self::LESS_BELOW.bits() | Self::LESS_ABOVE.bits();
        const GREATER = Self::GREATER_BELOW.bits() | Self::GREATER_ABOVE.bits();
        const BELOW = Self::LESS_BELOW.bits() | Self::GREATER_BELOW.bits();
        const ABOVE = Self::LESS_ABOVE.bits() | Self::GREATER_ABOVE.bits();
    }
}

impl From<Cond> for Orderings {
    fn from(cond: Cond) -> Self {
        match cond {
            Cond::Eq => Self::EQUAL,
            Cond::Ne => Self::LESS | Self::GREATER,
            Cond::Lt => Self::LESS,
            Cond::Ge => Self::GREATER | Self::EQUAL,
            Cond::Le => Self::LESS | Self::EQUAL,
            Cond::Gt => Self::GREATER,
            Cond::Below => Self::BELOW,
            Cond::AboveEq => Self::ABOVE | Self::EQUAL,
            Cond::BelowEq => Self::BELOW | Self::EQUAL,
            Cond::Above => Self::ABOVE,
        }
    }
}

impl From<FloatCond> for Orderings {
    fn from(cond: FloatCond) -> Self {
        match cond {
            FloatCond::Eq => Self::EQUAL,
            FloatCond::Ne => Self::LESS | Self::GREATER,
            FloatCond::Lt => Self::LESS,
            FloatCond::Le => Self::LESS | Self::EQUAL,
            FloatCond::Gt => Self::GREATER,
            FloatCond::Ge => Self::GREATER | Self::EQUAL,
            FloatCond::Ordered => !Self::UNORDERED,
            _ => !Self::from(cond.inverted()),
        }
    }
}

impl Orderings {
    pub(super) fn commuted(self) -> Self {
        let pairs = [
            (Self::LESS_BELOW, Self::GREATER_ABOVE),
            (Self::LESS_ABOVE, Self::GREATER_BELOW),
        ];
        let mut result = self;
        for (a, b) in pairs {
            result.set(a, self.contains(b));
            result.set(b, self.contains(a));
        }
        result
    }

    pub(super) fn between(a: &Bounds, b: &Bounds) -> Self {
        let (less, greater) = (a.least < b.greatest, a.greatest > b.least);
        let below = a.least_unsigned < b.greatest_unsigned;
        let above = a.greatest_unsigned > b.least_unsigned;
        let same_sign = a.least < 0 && b.least < 0 || a.greatest >= 0 && b.greatest >= 0;
        let mut result = Self::empty();
        result.set(Self::EQUAL, !a.intersection(b).is_empty());
        result.set(Self::LESS_BELOW, less && below && same_sign);
        result.set(Self::GREATER_ABOVE, greater && above && same_sign);
        result.set(Self::LESS_ABOVE, a.least < 0 && b.greatest >= 0);
        result.set(Self::GREATER_BELOW, a.greatest >= 0 && b.least < 0);
        result
    }

    /// Whether the ordering, which is one of these, is among `wanted`.
    pub(super) fn decide(self, wanted: impl Into<Self>) -> Option<bool> {
        let wanted = wanted.into();
        if wanted.contains(self) {
            Some(true)
        } else if wanted.intersects(self) {
            None
        } else {
            Some(false)
        }
    }
}
