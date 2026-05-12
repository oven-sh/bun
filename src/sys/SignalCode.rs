use core::fmt;

use bun_core::output;

// PORT NOTE: Zig `enum(u8) { ..., _ }` is non-exhaustive — any u8 is a valid
// inhabitant. A Rust `#[repr(u8)] enum` with only the named variants would be
// UB for the `from()` path (which accepts arbitrary bytes), so this is ported
// as a transparent newtype with associated consts.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct SignalCode(pub u8);

// Associated-const generator fed by the canonical X-macro in `bun_core`.
macro_rules! __sys_signal_consts {
    ($($name:ident = $n:literal),* $(,)?) => { $(pub const $name: Self = Self($n);)* };
}

impl SignalCode {
    bun_core::for_each_signal!(__sys_signal_consts);

    // The `subprocess.kill()` method sends a signal to the child process. If no
    // argument is given, the process will be sent the 'SIGTERM' signal.
    pub const DEFAULT: Self = Self::SIGTERM;

    pub fn name(self) -> Option<&'static str> {
        match self.0 {
            1..=31 => Some(bun_core::SIGNAL_NAMES[self.0 as usize]),
            _ => None,
        }
    }

    pub fn valid(self) -> bool {
        self.0 <= Self::SIGSYS.0 && self.0 >= Self::SIGHUP.0
    }

    /// Shell scripts use exit codes 128 + signal number
    /// https://tldp.org/LDP/abs/html/exitcodes.html
    pub fn to_exit_code(self) -> Option<u8> {
        match self.0 {
            1..=31 => Some(128u8.wrapping_add(self.0)),
            _ => None,
        }
    }

    pub fn description(self) -> Option<&'static str> {
        // Description names copied from fish
        // https://github.com/fish-shell/fish-shell/blob/00ffc397b493f67e28f18640d3de808af29b1434/fish-rust/src/signal.rs#L420
        match self {
            Self::SIGHUP => Some("Terminal hung up"),
            Self::SIGINT => Some("Quit request"),
            Self::SIGQUIT => Some("Quit request"),
            Self::SIGILL => Some("Illegal instruction"),
            Self::SIGTRAP => Some("Trace or breakpoint trap"),
            Self::SIGABRT => Some("Abort"),
            Self::SIGBUS => Some("Misaligned address error"),
            Self::SIGFPE => Some("Floating point exception"),
            Self::SIGKILL => Some("Forced quit"),
            Self::SIGUSR1 => Some("User defined signal 1"),
            Self::SIGUSR2 => Some("User defined signal 2"),
            Self::SIGSEGV => Some("Address boundary error"),
            Self::SIGPIPE => Some("Broken pipe"),
            Self::SIGALRM => Some("Timer expired"),
            Self::SIGTERM => Some("Polite quit request"),
            Self::SIGCHLD => Some("Child process status changed"),
            Self::SIGCONT => Some("Continue previously stopped process"),
            Self::SIGSTOP => Some("Forced stop"),
            Self::SIGTSTP => Some("Stop request from job control (^Z)"),
            Self::SIGTTIN => Some("Stop from terminal input"),
            Self::SIGTTOU => Some("Stop from terminal output"),
            Self::SIGURG => Some("Urgent socket condition"),
            Self::SIGXCPU => Some("CPU time limit exceeded"),
            Self::SIGXFSZ => Some("File size limit exceeded"),
            Self::SIGVTALRM => Some("Virtual timefr expired"),
            Self::SIGPROF => Some("Profiling timer expired"),
            Self::SIGWINCH => Some("Window size change"),
            Self::SIGIO => Some("I/O on asynchronous file descriptor is possible"),
            Self::SIGSYS => Some("Bad system call"),
            Self::SIGPWR => Some("Power failure"),
            _ => None,
        }
    }

    pub fn from<T: bytemuck::NoUninit>(value: T) -> SignalCode {
        // Zig `std.mem.asBytes(&value)[0]` — view `value` as bytes and read the
        // first one. `NoUninit` guarantees `T` is `Copy` with no padding/uninit
        // bytes, so `bytemuck::bytes_of` is the safe equivalent of the raw
        // `*(&raw const value).cast::<u8>()` reinterpret. A ZST `T` panics on
        // the `[0]` index (was UB before); all callers pass integer types.
        SignalCode(bytemuck::bytes_of(&value)[0])
    }

    pub fn fmt(self, enable_ansi_colors: bool) -> Fmt {
        Fmt {
            signal: self,
            enable_ansi_colors,
        }
    }
}

/// `bun.ComptimeEnumMap(SignalCode)` — name-bytes → open newtype.
#[inline]
pub fn from_name(s: &[u8]) -> Option<SignalCode> {
    bun_core::SignalCode::from_name(s).map(|c| SignalCode(c as u8))
}

// This wrapper struct is lame, what if bun's color formatter was more versatile
pub struct Fmt {
    signal: SignalCode,
    enable_ansi_colors: bool,
}

impl fmt::Display for Fmt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let signal = self.signal;
        // PERF(port): was comptime bool dispatch (`switch inline else`) — profile in Phase B
        if let Some(str_) = signal.name() {
            if let Some(desc) = signal.description() {
                // TODO(port): Output.prettyFmt("{s} <d>({s})<r>", enable_ansi_colors) —
                // use bun_core::output's pretty-fmt helper once available.
                if self.enable_ansi_colors {
                    return write!(f, "{} {}({}){}", str_, output::DIM, desc, output::RESET);
                } else {
                    return write!(f, "{} ({})", str_, desc);
                }
            }
        }
        write!(f, "code {}", signal.0)
    }
}

// NOTE: `pub const fromJS = @import("../sys_jsc/signal_code_jsc.zig").fromJS;`
// deleted per porting guide — `from_js` lives as an extension-trait method in
// the `bun_sys_jsc` crate.

// ported from: src/sys/SignalCode.zig
