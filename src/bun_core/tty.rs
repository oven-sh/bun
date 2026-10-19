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

/// The control sequence of a key (ECMA-48, 5.4), as a terminal in raw mode sends it after the
/// introducer `ESC [`: parameter bytes, intermediate bytes, and the final byte that names the key.
/// Up is `ESC [ A`, Ctrl+Right is `ESC [ 1 ; 5 C`, F5 is `ESC [ 1 5 ~`.
///
/// A reader of keys has to consume the whole sequence, also when it binds nothing to the key.
/// What it leaves behind is read as typed text.
pub struct ControlSequence {
    params: [u8; ControlSequence::MAX_PARAMS],
    params_len: u8,
    /// `0x40..=0x7E`, or 0 for a sequence that no key has: one with intermediate bytes or with
    /// too many parameter bytes, and the function keys of the Linux console (`ESC [ [ A`).
    pub final_byte: u8,
}

impl ControlSequence {
    /// The longest key sequence in use has six parameter bytes (`ESC [ 2 4 ; 1 0 ~`). A mouse
    /// report (`ESC [ < 65 ; 120 ; 40 M`) has more.
    const MAX_PARAMS: usize = 24;

    /// Reads the sequence that follows `ESC [` from `next`, which returns `None` at the end of
    /// input. `Err(None)`: the input ended inside the sequence. `Err(Some(byte))`: `byte`
    /// cannot be part of a sequence, so the sequence is broken and `byte` starts something else.
    pub fn read(mut next: impl FnMut() -> Option<u8>) -> Result<ControlSequence, Option<u8>> {
        let mut sequence = ControlSequence {
            params: [0; Self::MAX_PARAMS],
            params_len: 0,
            final_byte: 0,
        };
        let mut is_key = true;
        let mut byte = next().ok_or(None)?;
        if byte == b'[' {
            // The Linux console sends F1 to F5 as `ESC [ [ A` to `ESC [ [ E`.
            is_key = false;
            byte = next().ok_or(None)?;
        }
        while matches!(byte, 0x30..=0x3F) {
            match sequence.params.get_mut(usize::from(sequence.params_len)) {
                Some(slot) => {
                    *slot = byte;
                    sequence.params_len += 1;
                }
                None => is_key = false,
            }
            byte = next().ok_or(None)?;
        }
        // rxvt ends a key that has Shift with `$`, which the standard has as an intermediate byte.
        if byte != b'$' || sequence.params_len == 0 {
            while matches!(byte, 0x20..=0x2F) {
                is_key = false;
                byte = next().ok_or(None)?;
            }
            if !matches!(byte, 0x40..=0x7E) {
                return Err(Some(byte));
            }
        }
        if is_key {
            sequence.final_byte = byte;
        }
        Ok(sequence)
    }

    /// The parameter bytes: digits, `;`, and the private markers `<`, `=`, `>`, `?`.
    #[inline]
    pub fn params(&self) -> &[u8] {
        &self.params[..usize::from(self.params_len)]
    }
}

unsafe extern "C" {
    unsafe fn Bun__ttySetMode(fd: c_int, mode: c_int, state: *mut c_void, drain: c_int) -> c_int;
}
