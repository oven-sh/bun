use core::cell::RefCell;
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

/// Raw-mode state for one terminal handle, mirroring libuv's `uv_tty_t`: the
/// mode this handle last applied plus the termios snapshot it captured on the
/// way out of [`Mode::Normal`]. Opaque bytes; the C side copies them in and
/// out, so a handle restoring cooked mode never clobbers another handle's.
pub struct State {
    bytes: RefCell<Box<[u8]>>,
}

impl State {
    pub fn new() -> Self {
        Self {
            bytes: RefCell::new(vec![0u8; Bun__ttyStateSize()].into_boxed_slice()),
        }
    }

    pub fn set_mode(&self, fd: c_int, mode: Mode) -> c_int {
        let mut bytes = self.bytes.borrow_mut();
        // SAFETY: `bytes` is exactly the `Bun__ttyStateSize()` bytes the C side
        // reads and writes, and the borrow keeps it alive across the call.
        unsafe { Bun__ttySetMode(fd, mode as c_int, bytes.as_mut_ptr().cast::<c_void>()) }
    }
}

impl Default for State {
    fn default() -> Self {
        Self::new()
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
        let state = State::new();
        let _ = state.set_mode(fd, Mode::Raw);
        Self { fd, state }
    }
}

impl Drop for RawModeGuard {
    #[inline]
    fn drop(&mut self) {
        let _ = self.state.set_mode(self.fd, Mode::Normal);
    }
}

unsafe extern "C" {
    safe fn Bun__ttyStateSize() -> usize;
    unsafe fn Bun__ttySetMode(fd: c_int, mode: c_int, state: *mut c_void) -> c_int;
}
