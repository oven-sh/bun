//! JavaScriptCore's options for `Decimal`. An executable keeps those that it was built with.

use core::sync::atomic::{AtomicU8, Ordering};

use crate::env_var;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
#[repr(transparent)]
pub struct DecimalOptions(u8);

static OF_EXECUTABLE: AtomicU8 = AtomicU8::new(0);

impl DecimalOptions {
    // `JSCInitialize` reads these bits.
    const DECIMAL: u8 = 1 << 0;
    const STRUCTURED_CLONE: u8 = 1 << 1;
    const TO_JSON: u8 = 1 << 2;
    const OPERATORS: u8 = 1 << 3;
    const LITERALS: u8 = 1 << 4;

    pub const fn from_bits(bits: u8) -> Self {
        Self(bits)
    }

    pub const fn bits(self) -> u8 {
        self.0
    }

    /// A variable overrides what the executable has, as it does in the engine.
    pub fn of_process() -> Self {
        let mut bits = OF_EXECUTABLE.load(Ordering::Relaxed);
        let mut apply = |bit: u8, variable: Option<bool>| match variable {
            Some(true) => bits |= bit,
            Some(false) => bits &= !bit,
            None => {}
        };
        apply(Self::DECIMAL, env_var::BUN_JSC_useDecimal.get());
        apply(
            Self::STRUCTURED_CLONE,
            env_var::BUN_JSC_useDecimalStructuredClone.get(),
        );
        apply(Self::TO_JSON, env_var::BUN_JSC_useDecimalToJSON.get());
        apply(Self::OPERATORS, env_var::BUN_JSC_useDecimalOperators.get());
        apply(Self::LITERALS, env_var::BUN_JSC_useDecimalLiterals.get());
        Self(bits)
    }

    pub fn add_to_executable(self) {
        OF_EXECUTABLE.fetch_or(self.0, Ordering::Relaxed);
    }

    /// An extension does nothing without `Decimal`.
    const fn has(self, extension: u8) -> bool {
        self.0 & Self::DECIMAL != 0 && self.0 & extension != 0
    }

    pub const fn has_operators(self) -> bool {
        self.has(Self::OPERATORS)
    }

    pub const fn has_literals(self) -> bool {
        self.has(Self::LITERALS)
    }
}
