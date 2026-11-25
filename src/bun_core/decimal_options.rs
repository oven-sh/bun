//! JavaScriptCore's options for `Decimal`. An executable keeps those that it was built with.

use core::ffi::CStr;
use core::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;

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
    /// The program was compiled ahead of time for these options, and takes no variable.
    const ARE_FIXED: u8 = 1 << 7;

    const NAMES: &[(u8, &[u8])] = &[
        (Self::DECIMAL, b"useDecimal="),
        (Self::STRUCTURED_CLONE, b"useDecimalStructuredClone="),
        (Self::TO_JSON, b"useDecimalToJSON="),
        (Self::OPERATORS, b"useDecimalOperators="),
        (Self::LITERALS, b"useDecimalLiterals="),
    ];

    pub const fn from_bits(bits: u8) -> Self {
        Self(bits)
    }

    pub const fn bits(self) -> u8 {
        self.0
    }

    /// What the engine gets. A variable overrides what the executable has, unless that is fixed.
    pub fn of_process() -> Self {
        let bits = OF_EXECUTABLE.load(Ordering::Relaxed);
        if bits & Self::ARE_FIXED != 0 {
            return Self(bits & !Self::ARE_FIXED);
        }
        static VARIABLES: OnceLock<(u8, u8)> = OnceLock::new();
        let &(named, on) = VARIABLES.get_or_init(Self::read_variables);
        Self(bits & !named | on)
    }

    /// Not by `env_var`: as in `JSCInitialize`, what follows `BUN_JSC_` counts in any case, and the first entry wins.
    fn read_variables() -> (u8, u8) {
        let (mut named, mut on) = (0, 0);
        #[cfg(unix)]
        let mut entry = crate::c_environ();
        #[cfg(windows)]
        let mut entry = crate::os::environ().as_ptr();
        #[cfg(not(any(unix, windows)))]
        let mut entry = core::ptr::null::<*const core::ffi::c_char>();
        // SAFETY: the block ends with a null pointer.
        while let Some(&text) = unsafe { entry.as_ref() }.filter(|text| !text.is_null()) {
            // SAFETY: the null pointer has not been met.
            entry = unsafe { entry.add(1) };
            // SAFETY: an entry ends with a NUL.
            if unsafe { *text.cast::<u8>() } != b'B' {
                continue;
            }
            // SAFETY: see above.
            let text = unsafe { CStr::from_ptr(text) }.to_bytes();
            let Some(option) = text.strip_prefix(b"BUN_JSC_") else {
                continue;
            };
            for &(bit, name) in Self::NAMES {
                if named & bit == 0
                    && let Some((written, value)) = option.split_at_checked(name.len())
                    && written.eq_ignore_ascii_case(name)
                {
                    named |= bit;
                    if env_var::string_is_truthy(value) {
                        on |= bit;
                    }
                }
            }
        }
        (named, on)
    }

    pub fn add_to_executable(self, runs_compiled_code: bool) {
        let fixed = match runs_compiled_code {
            true => Self::ARE_FIXED,
            false => 0,
        };
        OF_EXECUTABLE.fetch_or(self.0 | fixed, Ordering::Relaxed);
    }

    pub const fn has_decimal(self) -> bool {
        self.0 & Self::DECIMAL != 0
    }

    /// An extension does nothing without `Decimal`.
    const fn has(self, extension: u8) -> bool {
        self.has_decimal() && self.0 & extension != 0
    }

    pub const fn has_operators(self) -> bool {
        self.has(Self::OPERATORS)
    }

    pub const fn has_literals(self) -> bool {
        self.has(Self::LITERALS)
    }
}
