use core::ffi::c_int;

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
