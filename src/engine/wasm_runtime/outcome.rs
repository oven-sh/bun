//! What functions of the run time return to generated code.

use core::num::NonZeroUsize;

use bun_engine_wasm_compiler::abi::Trap;

use crate::host::Thrown;
use crate::value::HostCell;

/// In a word that is not zero.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub struct Failure(usize);

impl Failure {
    pub(crate) const THROWN: Self = Self(Trap::COUNT + 1);
    pub(crate) const SUSPENDED: Self = Self(Trap::COUNT + 2);
    pub(crate) const TERMINATED: Self = Self(Trap::COUNT + 3);
    /// See [`crate::interpreted::Frame::hand_over`].
    pub const REPLACED: Self = Self(Trap::COUNT + 4);
    /// An interpreter has found its code to be inconsistent.
    pub const BROKEN: Self = Self(Trap::COUNT + 5);

    #[inline(always)]
    pub const fn trap(trap: Trap) -> Self {
        Self(trap as usize + 1)
    }

    pub(crate) const fn word(self) -> usize {
        self.0
    }

    /// For an `exnref` that is to be thrown.
    pub fn exception(exception: HostCell) -> Self {
        Self(exception.address())
    }

    /// The `exnref`, if that is what it is for.
    #[inline]
    pub fn as_exception(self) -> Option<HostCell> {
        NonZeroUsize::new(self.0)
            .filter(|_| self.0 > Self::BROKEN.0)
            .map(HostCell)
    }

    pub(crate) fn decode(self) -> Decoded {
        if let Some(&trap) = Trap::ALL.get(self.0 - 1) {
            return Decoded::Trap(trap);
        }
        match self {
            Self::THROWN => Decoded::Pending,
            Self::SUSPENDED => Decoded::Suspended,
            Self::TERMINATED => Decoded::Terminated,
            Self::REPLACED | Self::BROKEN => unreachable!("nothing is to go on"),
            Self(address) => Decoded::Exception(HostCell(NonZeroUsize::new(address).unwrap())),
        }
    }
}

pub(crate) enum Decoded {
    Trap(Trap),
    Exception(HostCell),
    /// The host has it.
    Pending,
    Suspended,
    Terminated,
}

impl From<Trap> for Failure {
    #[inline]
    fn from(trap: Trap) -> Self {
        Self::trap(trap)
    }
}

impl From<Thrown> for Failure {
    #[inline]
    fn from(_: Thrown) -> Self {
        Self::THROWN
    }
}

/// Comes back in two registers.
#[repr(C)]
pub struct Outcome {
    value: u64,
    /// Zero, or a [`Failure`].
    failure: usize,
}

impl Outcome {
    #[inline(always)]
    pub fn into_result(self) -> Result<u64, Failure> {
        match self.failure {
            0 => Ok(self.value),
            failure => Err(Failure(failure)),
        }
    }

    #[inline(always)]
    pub fn value(value: u64) -> Self {
        Self { value, failure: 0 }
    }

    #[inline(always)]
    pub fn failure(failure: impl Into<Failure>) -> Self {
        Self {
            value: 0,
            failure: failure.into().word(),
        }
    }
}

impl<E: Into<Failure>> From<Result<u64, E>> for Outcome {
    #[inline]
    fn from(result: Result<u64, E>) -> Self {
        result.map_or_else(Self::failure, Self::value)
    }
}

impl<E: Into<Failure>> From<Result<(), E>> for Outcome {
    #[inline]
    fn from(result: Result<(), E>) -> Self {
        result.map(|()| 0).into()
    }
}
