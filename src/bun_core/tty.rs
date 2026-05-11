use core::ffi::c_int;

// ─── MOVE-IN: Winsize (TYPE_ONLY from bun_sys → bun_core) ─────────────────
// Zig: `std.posix.winsize` — used by output.rs::TERMINAL_SIZE. Field names
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

pub fn set_mode(fd: c_int, mode: Mode) -> c_int {
    Bun__ttySetMode(fd, mode as c_int)
}

/// RAII guard: sets `fd` to [`Mode::Raw`] on construction and restores
/// [`Mode::Normal`] on `Drop`. Replaces the Zig
/// `defer { _ = bun.tty.set_mode(0, .Normal); }` pattern at call sites.
pub struct RawModeGuard {
    fd: c_int,
}

impl RawModeGuard {
    #[inline]
    pub fn new(fd: c_int) -> Self {
        let _ = set_mode(fd, Mode::Raw);
        Self { fd }
    }
}

impl Drop for RawModeGuard {
    #[inline]
    fn drop(&mut self) {
        let _ = set_mode(self.fd, Mode::Normal);
    }
}

// TODO(port): move to bun_core_sys (or appropriate *_sys crate)
unsafe extern "C" {
    safe fn Bun__ttySetMode(fd: c_int, mode: c_int) -> c_int;
}

// ported from: src/bun_core/tty.zig
