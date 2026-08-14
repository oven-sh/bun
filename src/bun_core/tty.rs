use core::ffi::{c_int, c_void};

// ─── MOVE-IN: Winsize (TYPE_ONLY from bun_sys → bun_core) ─────────────────
// Used by output.rs::TERMINAL_SIZE. Field names
// match the move-out forward-ref in output.rs (row/col, not ws_row/ws_col).
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
// SAFETY: `#[repr(C)]` over four `u16` — exactly 8 bytes, no padding.
crate::unsafe_impl_atom!(Winsize);

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
