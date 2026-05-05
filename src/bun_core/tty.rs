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

#[repr(C)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Mode {
    Normal = 0,
    Raw = 1,
    Io = 2,
}

pub fn set_mode(fd: c_int, mode: Mode) -> c_int {
    // SAFETY: Bun__ttySetMode is a C++ FFI fn that takes plain ints; no invariants beyond ABI.
    unsafe { Bun__ttySetMode(fd, mode as c_int) }
}

// TODO(port): move to bun_core_sys (or appropriate *_sys crate)
unsafe extern "C" {
    fn Bun__ttySetMode(fd: c_int, mode: c_int) -> c_int;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/tty.zig (11 lines)
//   confidence: high
//   todos:      1
//   notes:      #[repr(C)] enum gives c_int discriminant matching Zig's enum(c_int)
// ──────────────────────────────────────────────────────────────────────────
