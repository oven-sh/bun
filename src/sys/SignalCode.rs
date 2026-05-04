use core::fmt;

use bun_core::output;

// PORT NOTE: Zig `enum(u8) { ..., _ }` is non-exhaustive — any u8 is a valid
// inhabitant. A Rust `#[repr(u8)] enum` with only the named variants would be
// UB for the `from()` path (which accepts arbitrary bytes), so this is ported
// as a transparent newtype with associated consts.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct SignalCode(pub u8);

impl SignalCode {
    pub const SIGHUP: Self = Self(1);
    pub const SIGINT: Self = Self(2);
    pub const SIGQUIT: Self = Self(3);
    pub const SIGILL: Self = Self(4);
    pub const SIGTRAP: Self = Self(5);
    pub const SIGABRT: Self = Self(6);
    pub const SIGBUS: Self = Self(7);
    pub const SIGFPE: Self = Self(8);
    pub const SIGKILL: Self = Self(9);
    pub const SIGUSR1: Self = Self(10);
    pub const SIGSEGV: Self = Self(11);
    pub const SIGUSR2: Self = Self(12);
    pub const SIGPIPE: Self = Self(13);
    pub const SIGALRM: Self = Self(14);
    pub const SIGTERM: Self = Self(15);
    pub const SIG16: Self = Self(16);
    pub const SIGCHLD: Self = Self(17);
    pub const SIGCONT: Self = Self(18);
    pub const SIGSTOP: Self = Self(19);
    pub const SIGTSTP: Self = Self(20);
    pub const SIGTTIN: Self = Self(21);
    pub const SIGTTOU: Self = Self(22);
    pub const SIGURG: Self = Self(23);
    pub const SIGXCPU: Self = Self(24);
    pub const SIGXFSZ: Self = Self(25);
    pub const SIGVTALRM: Self = Self(26);
    pub const SIGPROF: Self = Self(27);
    pub const SIGWINCH: Self = Self(28);
    pub const SIGIO: Self = Self(29);
    pub const SIGPWR: Self = Self(30);
    pub const SIGSYS: Self = Self(31);

    // The `subprocess.kill()` method sends a signal to the child process. If no
    // argument is given, the process will be sent the 'SIGTERM' signal.
    pub const DEFAULT: Self = Self::SIGTERM;

    pub fn name(self) -> Option<&'static str> {
        if self.0 <= Self::SIGSYS.0 {
            return Some(tag_name(self));
        }

        None
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

    pub fn from<T: Copy>(value: T) -> SignalCode {
        // SAFETY: reinterpret `value` as bytes and read the first byte, mirroring
        // Zig `std.mem.asBytes(&value)[0]`. Requires size_of::<T>() >= 1.
        let byte = unsafe {
            *(&value as *const T as *const u8)
        };
        SignalCode(byte)
    }

    pub fn fmt(self, enable_ansi_colors: bool) -> Fmt {
        Fmt { signal: self, enable_ansi_colors }
    }
}

/// `bun.ComptimeEnumMap(SignalCode)` — compile-time string → SignalCode lookup.
pub static MAP: phf::Map<&'static [u8], SignalCode> = phf::phf_map! {
    b"SIGHUP" => SignalCode::SIGHUP,
    b"SIGINT" => SignalCode::SIGINT,
    b"SIGQUIT" => SignalCode::SIGQUIT,
    b"SIGILL" => SignalCode::SIGILL,
    b"SIGTRAP" => SignalCode::SIGTRAP,
    b"SIGABRT" => SignalCode::SIGABRT,
    b"SIGBUS" => SignalCode::SIGBUS,
    b"SIGFPE" => SignalCode::SIGFPE,
    b"SIGKILL" => SignalCode::SIGKILL,
    b"SIGUSR1" => SignalCode::SIGUSR1,
    b"SIGSEGV" => SignalCode::SIGSEGV,
    b"SIGUSR2" => SignalCode::SIGUSR2,
    b"SIGPIPE" => SignalCode::SIGPIPE,
    b"SIGALRM" => SignalCode::SIGALRM,
    b"SIGTERM" => SignalCode::SIGTERM,
    b"SIG16" => SignalCode::SIG16,
    b"SIGCHLD" => SignalCode::SIGCHLD,
    b"SIGCONT" => SignalCode::SIGCONT,
    b"SIGSTOP" => SignalCode::SIGSTOP,
    b"SIGTSTP" => SignalCode::SIGTSTP,
    b"SIGTTIN" => SignalCode::SIGTTIN,
    b"SIGTTOU" => SignalCode::SIGTTOU,
    b"SIGURG" => SignalCode::SIGURG,
    b"SIGXCPU" => SignalCode::SIGXCPU,
    b"SIGXFSZ" => SignalCode::SIGXFSZ,
    b"SIGVTALRM" => SignalCode::SIGVTALRM,
    b"SIGPROF" => SignalCode::SIGPROF,
    b"SIGWINCH" => SignalCode::SIGWINCH,
    b"SIGIO" => SignalCode::SIGIO,
    b"SIGPWR" => SignalCode::SIGPWR,
    b"SIGSYS" => SignalCode::SIGSYS,
};

// Zig `@tagName` equivalent for the named range. Caller must ensure
// `value.0 <= SIGSYS.0` (asserted in `name()`).
fn tag_name(value: SignalCode) -> &'static str {
    match value {
        SignalCode::SIGHUP => "SIGHUP",
        SignalCode::SIGINT => "SIGINT",
        SignalCode::SIGQUIT => "SIGQUIT",
        SignalCode::SIGILL => "SIGILL",
        SignalCode::SIGTRAP => "SIGTRAP",
        SignalCode::SIGABRT => "SIGABRT",
        SignalCode::SIGBUS => "SIGBUS",
        SignalCode::SIGFPE => "SIGFPE",
        SignalCode::SIGKILL => "SIGKILL",
        SignalCode::SIGUSR1 => "SIGUSR1",
        SignalCode::SIGSEGV => "SIGSEGV",
        SignalCode::SIGUSR2 => "SIGUSR2",
        SignalCode::SIGPIPE => "SIGPIPE",
        SignalCode::SIGALRM => "SIGALRM",
        SignalCode::SIGTERM => "SIGTERM",
        SignalCode::SIG16 => "SIG16",
        SignalCode::SIGCHLD => "SIGCHLD",
        SignalCode::SIGCONT => "SIGCONT",
        SignalCode::SIGSTOP => "SIGSTOP",
        SignalCode::SIGTSTP => "SIGTSTP",
        SignalCode::SIGTTIN => "SIGTTIN",
        SignalCode::SIGTTOU => "SIGTTOU",
        SignalCode::SIGURG => "SIGURG",
        SignalCode::SIGXCPU => "SIGXCPU",
        SignalCode::SIGXFSZ => "SIGXFSZ",
        SignalCode::SIGVTALRM => "SIGVTALRM",
        SignalCode::SIGPROF => "SIGPROF",
        SignalCode::SIGWINCH => "SIGWINCH",
        SignalCode::SIGIO => "SIGIO",
        SignalCode::SIGPWR => "SIGPWR",
        SignalCode::SIGSYS => "SIGSYS",
        // value 0 falls through here too (Zig @tagName on 0 is UB; name() in Zig
        // would still hit this branch since 0 <= SIGSYS — preserving behavior).
        _ => unreachable!(),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/SignalCode.zig (132 lines)
//   confidence: medium
//   todos:      1
//   notes:      non-exhaustive enum(u8) ported as #[repr(transparent)] newtype; Output.prettyFmt ANSI consts need wiring in bun_core
// ──────────────────────────────────────────────────────────────────────────
