// Tier-0 leaf crate: pure Win32 typedefs/consts/externs over `core` only.
// `no_std` so the standalone `bun_shim_impl.exe` (which depends on nothing
// else from the workspace) links without the Rust runtime / CRT (no libc).
#![no_std]
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod externs;
// Surface the tier-0 typedefs/consts/externs at the crate root so
// `bun_sys::windows`'s `pub use bun_windows_sys::Foo;` re-exports resolve.
pub use externs::*;

/// `PVOID` (`winnt.h`). Distinct from [`externs::LPVOID`] only in spelling;
/// the ntdll prototypes use `PVOID`, the Win32 ones `LPVOID`.
pub type PVOID = *mut core::ffi::c_void;

/// `ENABLE_VIRTUAL_TERMINAL_PROCESSING` (`consoleapi.h`) — `SetConsoleMode`
/// output-mode flag enabling VT100/ANSI escape sequence interpretation.
pub const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;

// libuv bindings are NOT re-exported here — this is the bottom-tier Win32
// externs crate and must stay leaf. Callers use `bun_libuv_sys` directly.

/// `NTSTATUS` value namespace (`ntstatus.h`). The `NTSTATUS` newtype carries
/// these as associated consts, but `bun_sys::windows` glob-imports them as
/// bare match patterns (`use bun_windows_sys::ntstatus::*`); associated consts
/// can't be glob-re-exported, so mirror them as free consts here.
pub mod ntstatus {
    use super::externs::NTSTATUS;
    pub const SUCCESS: NTSTATUS = NTSTATUS::SUCCESS;
    pub const ACCESS_DENIED: NTSTATUS = NTSTATUS::ACCESS_DENIED;
    pub const INVALID_HANDLE: NTSTATUS = NTSTATUS::INVALID_HANDLE;
    pub const INVALID_PARAMETER: NTSTATUS = NTSTATUS::INVALID_PARAMETER;
    pub const OBJECT_NAME_COLLISION: NTSTATUS = NTSTATUS::OBJECT_NAME_COLLISION;
    pub const FILE_IS_A_DIRECTORY: NTSTATUS = NTSTATUS::FILE_IS_A_DIRECTORY;
    pub const OBJECT_PATH_NOT_FOUND: NTSTATUS = NTSTATUS::OBJECT_PATH_NOT_FOUND;
    pub const OBJECT_NAME_NOT_FOUND: NTSTATUS = NTSTATUS::OBJECT_NAME_NOT_FOUND;
    pub const OBJECT_NAME_INVALID: NTSTATUS = NTSTATUS::OBJECT_NAME_INVALID;
    pub const NOT_A_DIRECTORY: NTSTATUS = NTSTATUS::NOT_A_DIRECTORY;
    pub const DIRECTORY_NOT_EMPTY: NTSTATUS = NTSTATUS::DIRECTORY_NOT_EMPTY;
    pub const FILE_TOO_LARGE: NTSTATUS = NTSTATUS::FILE_TOO_LARGE;
    pub const NOT_SAME_DEVICE: NTSTATUS = NTSTATUS::NOT_SAME_DEVICE;
    pub const FILE_DELETED: NTSTATUS = NTSTATUS::FILE_DELETED;
    pub const OBJECT_PATH_SYNTAX_BAD: NTSTATUS = NTSTATUS::OBJECT_PATH_SYNTAX_BAD;
    pub const NO_MORE_FILES: NTSTATUS = NTSTATUS::NO_MORE_FILES;
    pub const NO_SUCH_FILE: NTSTATUS = NTSTATUS::NO_SUCH_FILE;
    pub const RETRY: NTSTATUS = NTSTATUS::RETRY;
    pub const DELETE_PENDING: NTSTATUS = NTSTATUS::DELETE_PENDING;
    pub const SHARING_VIOLATION: NTSTATUS = NTSTATUS::SHARING_VIOLATION;
    pub const CANNOT_DELETE: NTSTATUS = NTSTATUS::CANNOT_DELETE;
}

/// `bun.O.*` — the POSIX-shaped (Linux-octal) open-flag values Bun normalises
/// to internally on Windows. NOT MSVCRT `_O_*`. Single source of truth shared
/// by `bun_sys::O` (windows branch) and `bun_libuv_sys::O::from_bun_o`.
pub mod bun_o {
    pub const WRONLY: i32 = 0o1;
    pub const RDWR: i32 = 0o2;
    pub const CREAT: i32 = 0o100;
    pub const EXCL: i32 = 0o200;
    pub const TRUNC: i32 = 0o1000;
    pub const APPEND: i32 = 0o2000;
    pub const NONBLOCK: i32 = 0o4000;
    pub const DSYNC: i32 = 0o10000;
    pub const DIRECT: i32 = 0o40000;
    pub const NOFOLLOW: i32 = 0o400000;
    pub const SYNC: i32 = 0o4010000;
}
