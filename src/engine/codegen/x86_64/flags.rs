//! What the flags tell, so that a comparison need not be repeated.

use bun_engine_asm::x64::Cc;
use bun_engine_asm::{Gpr, Size, Width};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Compared {
    Reg(Gpr),
    Imm(i32),
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Flags {
    /// The zero and sign flags are those of this register.
    result: Option<(Gpr, Size)>,
    /// All flags are as if the two had been compared.
    comparison: Option<(Size, Gpr, Compared)>,
}

fn commuted(cc: Cc) -> Option<Cc> {
    Some(match cc {
        Cc::E | Cc::Ne => cc,
        Cc::B => Cc::A,
        Cc::A => Cc::B,
        Cc::Ae => Cc::Be,
        Cc::Be => Cc::Ae,
        Cc::L => Cc::G,
        Cc::G => Cc::L,
        Cc::Ge => Cc::Le,
        Cc::Le => Cc::Ge,
        Cc::O | Cc::No | Cc::S | Cc::Ns | Cc::P | Cc::Np => return None,
    })
}

impl Flags {
    pub(super) fn of_arithmetic(dst: Gpr, width: Width) -> Self {
        Self {
            result: Some((dst, width.size())),
            comparison: None,
        }
    }

    /// Clears the carry and overflow flags.
    pub(super) fn of_logic(dst: Gpr, size: Size) -> Self {
        Self::of_comparison(size, dst, Compared::Imm(0))
    }

    pub(super) fn of_comparison(size: Size, lhs: Gpr, rhs: Compared) -> Self {
        Self {
            result: None,
            comparison: Some((size, lhs, rhs)),
        }
    }

    /// `dst` has been set to `lhs - rhs`.
    pub(super) fn of_subtraction(width: Width, dst: Gpr, lhs: Gpr, rhs: Compared) -> Self {
        Self {
            result: Some((dst, width.size())),
            ..Self::of_comparison(width.size(), lhs, rhs).after_writing(dst)
        }
    }

    #[inline]
    pub(super) fn after_writing(self, reg: Gpr) -> Self {
        Self {
            result: self.result.filter(|&(known, _)| known != reg),
            comparison: (self.comparison)
                .filter(|&(_, lhs, rhs)| lhs != reg && rhs != Compared::Reg(reg)),
        }
    }

    /// The condition that holds now if `cc` would after comparing.
    pub(super) fn condition(self, size: Size, cc: Cc, lhs: Gpr, rhs: Compared) -> Option<Cc> {
        if self.comparison == Some((size, lhs, rhs)) {
            return Some(cc);
        }
        match rhs {
            Compared::Reg(rhs) if self.comparison == Some((size, rhs, Compared::Reg(lhs))) => {
                commuted(cc)
            }
            Compared::Imm(0) if self.result == Some((lhs, size)) => {
                matches!(cc, Cc::E | Cc::Ne | Cc::S | Cc::Ns).then_some(cc)
            }
            _ => None,
        }
    }
}
