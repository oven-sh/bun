use core::fmt;

use bun_core::output;

/// A platform signal number; any `u8` is valid (RT signals). Names live in `bun_core::SignalCode`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct SignalCode(pub u8);

impl SignalCode {
    pub const SIGINT: Self = Self::of(bun_core::SignalCode::SIGINT);
    pub const SIGKILL: Self = Self::of(bun_core::SignalCode::SIGKILL);

    // The `subprocess.kill()` method sends a signal to the child process. If no
    // argument is given, the process will be sent the 'SIGTERM' signal.
    pub const DEFAULT: Self = Self::of(bun_core::SignalCode::DEFAULT);

    pub const fn of(code: bun_core::SignalCode) -> Self {
        Self(code as u8)
    }

    /// `None` when this platform has no name for this number (RT signals, macOS SIGEMT, 0).
    pub fn named(self) -> Option<bun_core::SignalCode> {
        bun_core::SignalCode::from_number(i32::from(self.0))
    }

    pub fn name(self) -> Option<&'static str> {
        self.named().map(bun_core::SignalCode::name)
    }

    /// The shell convention for a signal death: https://tldp.org/LDP/abs/html/exitcodes.html
    pub fn to_exit_code(self) -> u8 {
        128u8.wrapping_add(self.0)
    }

    pub fn from<T: bytemuck::NoUninit>(value: T) -> SignalCode {
        // View `value` as bytes and read the
        // first one. `NoUninit` guarantees `T` is `Copy` with no padding/uninit
        // bytes, so `bytemuck::bytes_of` is the safe equivalent of the raw
        // `*(&raw const value).cast::<u8>()` reinterpret. A ZST `T` panics on
        // the `[0]` index; all callers pass integer types.
        SignalCode(bytemuck::bytes_of(&value)[0])
    }

    pub fn fmt(self, enable_ansi_colors: bool) -> Fmt {
        Fmt {
            signal: self,
            enable_ansi_colors,
        }
    }
}

// This wrapper struct is lame, what if bun's color formatter was more versatile
pub struct Fmt {
    signal: SignalCode,
    enable_ansi_colors: bool,
}

impl fmt::Display for Fmt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let signal = self.signal;
        let Some(code) = signal.named() else {
            return write!(f, "code {}", signal.0);
        };
        let (name, desc) = (code.name(), code.description());
        if self.enable_ansi_colors {
            write!(f, "{} {}({}){}", name, output::DIM, desc, output::RESET)
        } else {
            write!(f, "{} ({})", name, desc)
        }
    }
}

// NOTE: `from_js` lives as an extension-trait method in the `bun_sys_jsc` crate.
