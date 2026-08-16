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

// `bun.windows.libuv` is NOT re-exported here — this is the bottom-tier Win32
// externs crate and must stay leaf. The `bun.windows.libuv` alias lives in the
// higher-tier `bun_sys::windows` module (`pub use bun_libuv_sys as libuv`).

/// `NTSTATUS` value namespace (`ntstatus.h`). The `NTSTATUS` newtype carries
/// these as associated consts, but `bun_sys::windows` glob-imports them as
/// bare match patterns (`use bun_windows_sys::ntstatus::*`); associated consts
/// can't be glob-re-exported, so mirror them as free consts here.
pub mod ntstatus {
    use super::externs::NTSTATUS;
    pub const SUCCESS: NTSTATUS = NTSTATUS::SUCCESS;
    pub const ACCESS_DENIED: NTSTATUS = NTSTATUS::ACCESS_DENIED;
    pub const INVALID_PARAMETER: NTSTATUS = NTSTATUS::INVALID_PARAMETER;
    pub const OBJECT_NAME_INVALID: NTSTATUS = NTSTATUS::OBJECT_NAME_INVALID;
    pub const FILE_DELETED: NTSTATUS = NTSTATUS::FILE_DELETED;
    pub const DELETE_PENDING: NTSTATUS = NTSTATUS::DELETE_PENDING;
    pub const SHARING_VIOLATION: NTSTATUS = NTSTATUS::SHARING_VIOLATION;
}
