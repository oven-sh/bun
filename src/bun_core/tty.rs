use core::ffi::c_int;

/// Terminal size as reported by the tty (`struct winsize` on POSIX).
#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
pub struct Winsize {
    pub row: u16,
    pub col: u16,
    pub xpixel: u16,
    pub ypixel: u16,
}
crate::impl_zeroable!(Winsize);

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
    flags: c_int,
    caller_fd: c_int,
    #[cfg(unix)]
    orig_termios: libc::termios,
}
crate::impl_zeroable!(State);

/// `BunTTYState::OwnsDescriptor`.
const OWNS_DESCRIPTOR: c_int = 1 << 0;
/// `BunTTYState::HoldsResetSnapshot`.
const HOLDS_RESET_SNAPSHOT: c_int = 1 << 1;

impl State {
    #[inline]
    pub fn new() -> Self {
        crate::ffi::zeroed()
    }

    /// The owner made a descriptor of the terminal that it alone closes, after [`State::close`], and passes that one to [`State::set_mode`]. Only such a state takes the process-wide snapshot, as a `uv_tty_t` does. `caller_fd` is the descriptor that the owner stands for.
    #[inline]
    pub fn own_descriptor(&mut self, caller_fd: c_int) {
        self.flags |= OWNS_DESCRIPTOR;
        self.caller_fd = caller_fd;
    }

    /// Whether [`State::close`] writes to the terminal: this state took the process-wide snapshot and has not given it back.
    #[inline]
    pub fn holds_reset_snapshot(&self) -> bool {
        self.flags & HOLDS_RESET_SNAPSHOT != 0
    }

    #[inline]
    pub fn set_mode(&mut self, fd: c_int, mode: Mode, when: SetAttrWhen) -> c_int {
        // SAFETY: layout matches C++'s `BunTTYState`; `self` outlives the call.
        unsafe {
            Bun__ttySetMode(
                fd,
                mode as c_int,
                self,
                (when == SetAttrWhen::Drain) as c_int,
            )
        }
    }

    /// libuv's `uv__tty_close()`: the handle that took the process-wide snapshot of the terminal writes it back. No other handle writes. It ends the state: `mode` stays, so no `set_mode()` follows.
    #[inline]
    pub fn close(&mut self, fd: c_int) {
        // SAFETY: layout matches C++'s `BunTTYState`; `self` outlives the call.
        unsafe { Bun__ttyClose(fd, self) }
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
    unsafe fn Bun__ttySetMode(fd: c_int, mode: c_int, state: *mut State, drain: c_int) -> c_int;
    unsafe fn Bun__ttyClose(fd: c_int, state: *mut State);
}
