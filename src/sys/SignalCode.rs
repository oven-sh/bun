use core::fmt;

use bun_core::output;

/// A signal number as the current platform numbers it: the byte `waitpid`
/// reports and the value `kill(2)` takes. Any u8 is a valid inhabitant (Linux
/// real-time signals, macOS-only signals), so this is an open newtype rather
/// than an enum. The platform-independent name is `bun_core::SignalCode`; the
/// two numberings differ on macOS/BSD, so convert with [`Self::canonical`] and
/// [`Self::from_canonical`] instead of casting.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct SignalCode(pub u8);

impl SignalCode {
    pub const SIGINT: Self = Self::of(bun_core::SignalCode::SIGINT);

    // The `subprocess.kill()` method sends a signal to the child process. If no
    // argument is given, the process will be sent the 'SIGTERM' signal.
    pub const DEFAULT: Self = Self::of(bun_core::SignalCode::DEFAULT);

    /// `from_canonical` for signals every supported platform has; a missing
    /// one is a compile-time error.
    const fn of(code: bun_core::SignalCode) -> Self {
        match code.platform_number() {
            Some(number) => Self(number as u8),
            None => panic!("signal is not defined on this platform"),
        }
    }

    /// `None` when the current platform has no number for `code`
    /// (`SIGPWR` on macOS, most signals on Windows).
    pub fn from_canonical(code: bun_core::SignalCode) -> Option<Self> {
        code.platform_number().map(|number| Self(number as u8))
    }

    /// `None` for a number this platform's table has no name for (real-time
    /// signals, macOS `SIGEMT`/`SIGINFO`, `0`).
    pub fn canonical(self) -> Option<bun_core::SignalCode> {
        bun_core::SignalCode::from_platform_number(i32::from(self.0))
    }

    pub fn name(self) -> Option<&'static str> {
        self.canonical().map(bun_core::SignalCode::name)
    }

    /// Shell scripts use exit codes 128 + signal number
    /// https://tldp.org/LDP/abs/html/exitcodes.html
    pub fn to_exit_code(self) -> Option<u8> {
        match self.0 {
            1..=31 => Some(128u8.wrapping_add(self.0)),
            _ => None,
        }
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

fn description(code: bun_core::SignalCode) -> Option<&'static str> {
    use bun_core::SignalCode as S;
    // Description names copied from fish
    // https://github.com/fish-shell/fish-shell/blob/00ffc397b493f67e28f18640d3de808af29b1434/fish-rust/src/signal.rs#L420
    match code {
        S::SIGHUP => Some("Terminal hung up"),
        S::SIGINT => Some("Quit request"),
        S::SIGQUIT => Some("Quit request"),
        S::SIGILL => Some("Illegal instruction"),
        S::SIGTRAP => Some("Trace or breakpoint trap"),
        S::SIGABRT => Some("Abort"),
        S::SIGBUS => Some("Misaligned address error"),
        S::SIGFPE => Some("Floating point exception"),
        S::SIGKILL => Some("Forced quit"),
        S::SIGUSR1 => Some("User defined signal 1"),
        S::SIGUSR2 => Some("User defined signal 2"),
        S::SIGSEGV => Some("Address boundary error"),
        S::SIGPIPE => Some("Broken pipe"),
        S::SIGALRM => Some("Timer expired"),
        S::SIGTERM => Some("Polite quit request"),
        S::SIGCHLD => Some("Child process status changed"),
        S::SIGCONT => Some("Continue previously stopped process"),
        S::SIGSTOP => Some("Forced stop"),
        S::SIGTSTP => Some("Stop request from job control (^Z)"),
        S::SIGTTIN => Some("Stop from terminal input"),
        S::SIGTTOU => Some("Stop from terminal output"),
        S::SIGURG => Some("Urgent socket condition"),
        S::SIGXCPU => Some("CPU time limit exceeded"),
        S::SIGXFSZ => Some("File size limit exceeded"),
        S::SIGVTALRM => Some("Virtual timefr expired"),
        S::SIGPROF => Some("Profiling timer expired"),
        S::SIGWINCH => Some("Window size change"),
        S::SIGIO => Some("I/O on asynchronous file descriptor is possible"),
        S::SIGSYS => Some("Bad system call"),
        S::SIGPWR => Some("Power failure"),
        S::SIGSTKFLT => None,
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
        if let Some(code) = signal.canonical() {
            if let Some(desc) = description(code) {
                let name = code.name();
                if self.enable_ansi_colors {
                    return write!(f, "{} {}({}){}", name, output::DIM, desc, output::RESET);
                } else {
                    return write!(f, "{} ({})", name, desc);
                }
            }
        }
        write!(f, "code {}", signal.0)
    }
}

// NOTE: `from_js` lives as an extension-trait method in the `bun_sys_jsc` crate.
