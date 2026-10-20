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

/// DEC private modes (`CSI ? Pm h/l`) that a caller records here when it sets them on stdout's terminal. A mode outlives the process, so an exit writes the reset of each recorded one.
pub mod dec {
    /// `?2004`: bracketed paste (the terminal marks where a paste starts and ends).
    pub const BRACKETED_PASTE: u8 = 1 << 0;
}

/// `(mode bit, reset sequence)` for every [`dec`] mode.
const DEC_MODES: [(u8, &[u8]); 1] = [(dec::BRACKETED_PASTE, b"\x1b[?2004l")];

/// The [`dec`] modes that are set now. Atomic: [`reset_active_dec_modes`] reads it in a signal handler.
static ACTIVE_DEC_MODES: AtomicU8 = AtomicU8::new(0);

/// Call before writing the set sequences of `modes`, so that an exit from then on resets them.
pub fn mark_dec_modes_set(modes: u8) {
    ACTIVE_DEC_MODES.fetch_or(modes, Ordering::Relaxed);
}

/// Call after writing the reset sequences of `modes`.
pub fn mark_dec_modes_reset(modes: u8) {
    ACTIVE_DEC_MODES.fetch_and(!modes, Ordering::Relaxed);
}

/// Writes the reset of each mode still set. Async-signal-safe: every exit that goes through `bun_restore_stdio` calls it, its signal handler included.
pub fn reset_active_dec_modes() {
    let active = ACTIVE_DEC_MODES.swap(0, Ordering::Relaxed);
    if active == 0 || !crate::output::is_stdout_tty() {
        return;
    }
    for (bit, reset) in DEC_MODES {
        if active & bit != 0 {
            write_stdout_raw(reset);
        }
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__ttyResetActiveDecModes() {
    reset_active_dec_modes();
}

#[cfg(unix)]
fn write_stdout_raw(mut bytes: &[u8]) {
    // SAFETY: plain libc calls on stack-local, fully initialized values.
    unsafe {
        // With SIGTTOU blocked, the write does not stop a background job on a TOSTOP terminal in the middle of its exit.
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
    // SAFETY: `bytes` outlives the synchronous call; `lpOverlapped` may be null for a non-OVERLAPPED handle.
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
