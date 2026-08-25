use core::fmt;

use bun_core::output;

/// A platform signal number; any `u8` is valid (RT signals). Names live in `bun_core::SignalCode`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct SignalCode(pub u8);

impl SignalCode {
    pub const SIGINT: Self = Self::of(bun_core::SignalCode::SIGINT);

    // The `subprocess.kill()` method sends a signal to the child process. If no
    // argument is given, the process will be sent the 'SIGTERM' signal.
    pub const DEFAULT: Self = Self::of(bun_core::SignalCode::DEFAULT);

    /// For signals every platform has; anything else fails to compile.
    const fn of(code: bun_core::SignalCode) -> Self {
        match code.platform_number() {
            Some(number) => Self(number as u8),
            None => panic!("signal is not defined on this platform"),
        }
    }

    /// `None` when this platform has no such signal (SIGPWR on macOS, most signals on Windows).
    pub fn from_canonical(code: bun_core::SignalCode) -> Option<Self> {
        code.platform_number().map(|number| Self(number as u8))
    }

    /// `None` when the table has no entry for this number (RT signals, macOS SIGEMT, 0).
    pub fn canonical(self) -> Option<bun_core::SignalCode> {
        bun_core::SignalCode::from_platform_number(i32::from(self.0))
    }

    pub fn name(self) -> Option<&'static str> {
        self.canonical().map(bun_core::SignalCode::name)
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

fn description(code: bun_core::SignalCode) -> &'static str {
    use bun_core::SignalCode as S;
    // Copied from https://github.com/fish-shell/fish-shell/blob/00ffc397b493f67e28f18640d3de808af29b1434/fish-rust/src/signal.rs#L420
    match code {
        S::SIGHUP => "Terminal hung up",
        S::SIGINT => "Quit request",
        S::SIGQUIT => "Quit request",
        S::SIGILL => "Illegal instruction",
        S::SIGTRAP => "Trace or breakpoint trap",
        S::SIGABRT => "Abort",
        S::SIGBUS => "Misaligned address error",
        S::SIGFPE => "Floating point exception",
        S::SIGKILL => "Forced quit",
        S::SIGUSR1 => "User defined signal 1",
        S::SIGUSR2 => "User defined signal 2",
        S::SIGSEGV => "Address boundary error",
        S::SIGPIPE => "Broken pipe",
        S::SIGALRM => "Timer expired",
        S::SIGTERM => "Polite quit request",
        S::SIGSTKFLT => "Stack fault",
        S::SIGCHLD => "Child process status changed",
        S::SIGCONT => "Continue previously stopped process",
        S::SIGSTOP => "Forced stop",
        S::SIGTSTP => "Stop request from job control (^Z)",
        S::SIGTTIN => "Stop from terminal input",
        S::SIGTTOU => "Stop from terminal output",
        S::SIGURG => "Urgent socket condition",
        S::SIGXCPU => "CPU time limit exceeded",
        S::SIGXFSZ => "File size limit exceeded",
        S::SIGVTALRM => "Virtual timer expired",
        S::SIGPROF => "Profiling timer expired",
        S::SIGWINCH => "Window size change",
        S::SIGIO => "I/O on asynchronous file descriptor is possible",
        S::SIGPWR => "Power failure",
        S::SIGSYS => "Bad system call",
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
        let Some(code) = signal.canonical() else {
            return write!(f, "code {}", signal.0);
        };
        let (name, desc) = (code.name(), description(code));
        if self.enable_ansi_colors {
            write!(f, "{} {}({}){}", name, output::DIM, desc, output::RESET)
        } else {
            write!(f, "{} ({})", name, desc)
        }
    }
}

// NOTE: `from_js` lives as an extension-trait method in the `bun_sys_jsc` crate.
