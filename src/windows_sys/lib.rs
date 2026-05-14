// Tier-0 leaf crate: pure Win32 typedefs/consts/externs over `core` only.
// `no_std` so the standalone `bun_shim_impl.exe` (which depends on nothing
// else from the workspace) links without the Rust runtime / CRT — matching
// Zig's freestanding `bun_shim_impl.zig` build (no libc, ~13 KiB).
#![no_std]
#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod externs;
// Surface the tier-0 typedefs/consts/externs at the crate root so
// `bun_sys::windows`'s `pub use bun_windows_sys::Foo;` re-exports resolve.
pub use externs::*;

// `bun.windows.libuv` is NOT re-exported here — this is the bottom-tier Win32
// externs crate and must stay leaf. The `bun.windows.libuv` alias lives in the
// higher-tier `bun_sys::windows` module (`pub use bun_libuv_sys as libuv`).

/// `std.os.windows.NTSTATUS` value namespace. The `NTSTATUS` newtype carries
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
    pub const RETRY: NTSTATUS = NTSTATUS::RETRY;
    pub const DIRECTORY_NOT_EMPTY: NTSTATUS = NTSTATUS::DIRECTORY_NOT_EMPTY;
    pub const FILE_TOO_LARGE: NTSTATUS = NTSTATUS::FILE_TOO_LARGE;
    pub const NOT_SAME_DEVICE: NTSTATUS = NTSTATUS::NOT_SAME_DEVICE;
    pub const DELETE_PENDING: NTSTATUS = NTSTATUS::DELETE_PENDING;
    pub const FILE_DELETED: NTSTATUS = NTSTATUS::FILE_DELETED;
    pub const SHARING_VIOLATION: NTSTATUS = NTSTATUS::SHARING_VIOLATION;
    pub const OBJECT_PATH_SYNTAX_BAD: NTSTATUS = NTSTATUS::OBJECT_PATH_SYNTAX_BAD;
    pub const NO_MORE_FILES: NTSTATUS = NTSTATUS::NO_MORE_FILES;
    pub const NO_SUCH_FILE: NTSTATUS = NTSTATUS::NO_SUCH_FILE;
}
