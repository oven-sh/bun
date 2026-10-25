use core::ffi::{c_int, c_void};

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

/// RAII guard for a blocking read of one typed line from stdin. Create it before the question is written (#5267).
#[must_use]
pub struct LineModeGuard {
    #[cfg(unix)]
    saved: Option<libc::termios>,
    #[cfg(windows)]
    saved: Option<crate::windows_sys::DWORD>,
}

impl LineModeGuard {
    pub fn stdin() -> Self {
        Self {
            saved: if crate::output::is_stdin_tty() {
                stdin_line_mode::enter()
            } else {
                None
            },
        }
    }
}

impl Drop for LineModeGuard {
    fn drop(&mut self) {
        if let Some(saved) = &self.saved {
            stdin_line_mode::leave(saved);
        }
    }
}

#[cfg(unix)]
mod stdin_line_mode {
    pub(super) fn enter() -> Option<libc::termios> {
        let mut saved = core::mem::MaybeUninit::<libc::termios>::zeroed();
        // SAFETY: `saved` is valid for one `termios`, and all-zero is a valid one.
        unsafe {
            (Bun__ttyEnterStdinLineMode(saved.as_mut_ptr()) != 0).then(|| saved.assume_init())
        }
    }

    pub(super) fn leave(saved: &libc::termios) {
        // SAFETY: `saved` is valid for one `termios`.
        unsafe { Bun__ttyLeaveStdinLineMode(saved) }
    }

    unsafe extern "C" {
        fn Bun__ttyEnterStdinLineMode(saved: *mut libc::termios) -> core::ffi::c_int;
        fn Bun__ttyLeaveStdinLineMode(saved: *const libc::termios);
    }
}

#[cfg(windows)]
mod stdin_line_mode {
    use crate::windows_sys as w;

    pub(super) fn enter() -> Option<w::DWORD> {
        let stdin = crate::Fd::stdin().native();
        let mut found: w::DWORD = 0;
        if w::GetConsoleMode(stdin, &mut found) == 0 {
            return None;
        }
        // With `ENABLE_VIRTUAL_TERMINAL_INPUT`, backspace deletes the entire line.
        let mut line = found & !w::ENABLE_VIRTUAL_TERMINAL_INPUT;
        if found & w::ENABLE_LINE_INPUT == 0 {
            line |= w::ENABLE_LINE_INPUT | w::ENABLE_ECHO_INPUT;
            // Ctrl+C signals every process of the console, so it stays a key on a console that was raw at startup.
            line |= crate::output::windows_stdio::startup_stdin_mode().unwrap_or(0)
                & w::ENABLE_PROCESSED_INPUT;
        }
        (line != found && w::SetConsoleMode(stdin, line) != 0).then_some(found)
    }

    pub(super) fn leave(saved: &w::DWORD) {
        let _ = w::SetConsoleMode(crate::Fd::stdin().native(), *saved);
    }
}

unsafe extern "C" {
    unsafe fn Bun__ttySetMode(fd: c_int, mode: c_int, state: *mut c_void, drain: c_int) -> c_int;
}
