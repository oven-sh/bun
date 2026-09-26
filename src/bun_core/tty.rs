use core::ffi::{c_int, c_void};
use core::sync::atomic::{AtomicU8, Ordering};

/// Terminal size as reported by the tty (`struct winsize` on POSIX).
#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
pub struct Winsize {
    pub row: u16,
    pub col: u16,
    pub xpixel: u16,
    pub ypixel: u16,
}
// SAFETY: four `u16` fields; all-zero is a valid `Winsize`.
unsafe impl crate::ffi::Zeroable for Winsize {}

#[repr(C)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Mode {
    Normal = 0,
    Raw = 1,
    Io = 2,
}

/// `tcsetattr` timing for [`State::set_mode`]. `Drain` (`TCSADRAIN`, libuv's
/// behavior) waits for pending output before applying, which is right for a
/// real tty. A PTY master must use `Now` (`TCSANOW`): draining waits on the
/// slave's write lock, and a child blocked in `write()` holds that lock
/// until the master's owner (the very thread calling `set_mode`) reads the
/// master, deadlocking both.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum SetAttrWhen {
    Drain,
    Now,
}

/// Per-handle raw-mode state (libuv's `uv_tty_t` fields): the mode this handle
/// last applied plus the termios it captured when leaving [`Mode::Normal`].
/// `#[repr(C)]` layout matches C++ `BunTTYState`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct State {
    mode: c_int,
    #[cfg(unix)]
    orig_termios: libc::termios,
}
// SAFETY: `c_int` + `libc::termios` (C POD). All-zero is mode Normal, and the
// termios is only read after the first non-Normal transition has written it.
unsafe impl crate::ffi::Zeroable for State {}

impl State {
    #[inline]
    pub fn new() -> Self {
        crate::ffi::zeroed()
    }

    #[inline]
    pub fn set_mode(&mut self, fd: c_int, mode: Mode, when: SetAttrWhen) -> c_int {
        // SAFETY: layout matches C++'s `BunTTYState`; `self` outlives the call.
        unsafe {
            Bun__ttySetMode(
                fd,
                mode as c_int,
                core::ptr::from_mut(self).cast(),
                (when == SetAttrWhen::Drain) as c_int,
            )
        }
    }
}

/// RAII guard: sets `fd` to [`Mode::Raw`] on construction and restores
/// [`Mode::Normal`] on `Drop`.
pub struct RawModeGuard {
    fd: c_int,
    state: State,
}

impl RawModeGuard {
    #[inline]
    pub fn new(fd: c_int) -> Self {
        let mut state = State::new();
        let _ = state.set_mode(fd, Mode::Raw, SetAttrWhen::Drain);
        Self { fd, state }
    }
}

impl Drop for RawModeGuard {
    #[inline]
    fn drop(&mut self) {
        let _ = self
            .state
            .set_mode(self.fd, Mode::Normal, SetAttrWhen::Drain);
    }
}

unsafe extern "C" {
    unsafe fn Bun__ttySetMode(fd: c_int, mode: c_int, state: *mut c_void, drain: c_int) -> c_int;
}

/// DEC private modes (`CSI ? Pm h` / `CSI ? Pm l`) that a CLI widget flips on
/// stdout's terminal for its lifetime. They are terminal-emulator state, not
/// termios, so writing the startup termios back at exit does not undo them:
/// each one needs its inverse sequence written to the terminal.
pub mod dec {
    /// `?25`: text cursor hidden.
    pub const HIDDEN_CURSOR: u8 = 1 << 0;
    /// `?1000` + `?1006`: mouse button and wheel reporting, SGR-encoded.
    pub const MOUSE_REPORTING: u8 = 1 << 1;
    /// `?2026`: synchronized output (the terminal defers rendering).
    pub const SYNCHRONIZED_OUTPUT: u8 = 1 << 2;
}

/// `(mode bit, set sequence, reset sequence)` for every [`dec`] mode.
const DEC_MODES: [(u8, &[u8], &[u8]); 3] = [
    (dec::HIDDEN_CURSOR, b"\x1b[?25l", b"\x1b[?25h"),
    (
        dec::MOUSE_REPORTING,
        b"\x1b[?1000h\x1b[?1006h",
        b"\x1b[?1000l\x1b[?1006l",
    ),
    (dec::SYNCHRONIZED_OUTPUT, b"\x1b[?2026h", b"\x1b[?2026l"),
];

/// The [`dec`] modes currently set on stdout's terminal. Atomic because
/// [`reset_active_dec_modes`] reads it from signal context.
static ACTIVE_DEC_MODES: AtomicU8 = AtomicU8::new(0);

/// RAII guard over a set of [`dec`] modes on stdout's terminal. `set` writes
/// the set sequences through the buffered stdout writer; `Drop` writes the
/// reset sequences and flushes. In between, the modes are recorded in
/// [`ACTIVE_DEC_MODES`], so an exit that never runs `Drop` (SIGINT/SIGTERM,
/// a crash, `Global::exit`, console Ctrl+C on Windows) still resets them: see
/// [`reset_active_dec_modes`].
#[must_use = "the modes are reset when the guard drops"]
pub struct DecModesGuard(u8);

impl DecModesGuard {
    pub fn set(modes: u8) -> Self {
        ACTIVE_DEC_MODES.fetch_or(modes, Ordering::Relaxed);
        for (bit, set, _) in DEC_MODES {
            if modes & bit != 0 {
                crate::output::print_bytes(set);
            }
        }
        Self(modes)
    }
}

impl Drop for DecModesGuard {
    fn drop(&mut self) {
        for (bit, _, reset) in DEC_MODES {
            if self.0 & bit != 0 {
                crate::output::print_bytes(reset);
            }
        }
        // Flush before clearing the bits: until the reset bytes reach the
        // terminal, a signal must still find the modes marked active.
        crate::output::flush();
        ACTIVE_DEC_MODES.fetch_and(!self.0, Ordering::Relaxed);
    }
}

/// Writes the reset sequence of every mode in [`ACTIVE_DEC_MODES`] directly
/// to stdout (when it is a terminal) and clears the set. Every exit path that
/// writes the startup termios back calls this (`bun_restore_stdio()` on POSIX,
/// `windows_stdio::restore()` on Windows). Some of those run inside a signal
/// handler, so this is async-signal-safe: an atomic swap, a stack buffer, and
/// `write(2)`.
pub fn reset_active_dec_modes() {
    let active = ACTIVE_DEC_MODES.swap(0, Ordering::Relaxed);
    if active == 0 || !crate::output::is_stdout_tty() {
        return;
    }
    let mut buf = [0u8; 64];
    let mut len = 0;
    for (bit, _, reset) in DEC_MODES {
        if active & bit != 0 {
            buf[len..len + reset.len()].copy_from_slice(reset);
            len += reset.len();
        }
    }
    write_stdout_raw(&buf[..len]);
}

#[unsafe(no_mangle)]
extern "C" fn Bun__ttyResetActiveDecModes() {
    reset_active_dec_modes();
}

#[cfg(unix)]
fn write_stdout_raw(mut bytes: &[u8]) {
    // SAFETY: plain libc calls on stack-local, fully initialized values.
    unsafe {
        // A background job writing to a TOSTOP terminal gets SIGTTOU, whose
        // default action stops the process mid-exit. With it blocked the
        // write fails with EIO instead.
        let mut ttou: libc::sigset_t = crate::ffi::zeroed();
        let mut old: libc::sigset_t = crate::ffi::zeroed();
        libc::sigemptyset(&raw mut ttou);
        libc::sigaddset(&raw mut ttou, libc::SIGTTOU);
        libc::pthread_sigmask(libc::SIG_BLOCK, &raw const ttou, &raw mut old);
        while !bytes.is_empty() {
            let rc = libc::write(libc::STDOUT_FILENO, bytes.as_ptr().cast(), bytes.len());
            if rc < 0 {
                if crate::ffi::errno() == libc::EINTR {
                    continue;
                }
                break;
            }
            bytes = &bytes[rc as usize..];
        }
        libc::pthread_sigmask(libc::SIG_SETMASK, &raw const old, core::ptr::null_mut());
    }
}

#[cfg(windows)]
fn write_stdout_raw(bytes: &[u8]) {
    use crate::windows_sys as w;
    let Some(handle) = w::GetStdHandle(w::STD_OUTPUT_HANDLE) else {
        return;
    };
    let mut written: w::DWORD = 0;
    // SAFETY: `bytes` outlives the synchronous call; `lpOverlapped` may be
    // null for a non-OVERLAPPED handle.
    unsafe {
        let _ = w::kernel32::WriteFile(
            handle,
            bytes.as_ptr(),
            bytes.len() as w::DWORD,
            &raw mut written,
            core::ptr::null_mut(),
        );
    }
}
