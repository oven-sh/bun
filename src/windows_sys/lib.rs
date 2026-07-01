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

/// A `&'static str` pipe name (or name prefix) proven at compile time to
/// start with `\\.\pipe\LOCAL\` — the only namespace an AppContainer may
/// create server pipes in; outside one the prefix is just part of the name.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct LocalPipeStr(&'static str);

impl LocalPipeStr {
    /// Const-panics on a missing prefix; build through [`local_pipe!`] so
    /// evaluation cannot slip to runtime.
    pub const fn new(s: &'static str) -> Self {
        const P: &[u8] = br"\\.\pipe\LOCAL\";
        let b = s.as_bytes();
        assert!(
            b.len() >= P.len(),
            "pipe name must start with \\\\.\\pipe\\LOCAL\\"
        );
        let mut i = 0;
        while i < P.len() {
            assert!(
                b[i] == P[i],
                "pipe name must start with \\\\.\\pipe\\LOCAL\\"
            );
            i += 1;
        }

        // The proof must survive DOS-to-NT normalization: forward slashes
        // become backslashes and dot segments collapse, so either could
        // rewrite the name out of LOCAL\ after the prefix check.
        while i < b.len() {
            assert!(b[i] != b'/', "pipe name must not contain forward slashes");
            assert!(
                !(b[i] == b'.' && b[i - 1] == P[0]),
                "pipe name must not contain dot segments"
            );
            i += 1;
        }
        Self(s)
    }

    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

/// Builds a [`LocalPipeStr`] in const context, so a name outside
/// `\\.\pipe\LOCAL\` is a compile error, never a runtime panic.
#[macro_export]
macro_rules! local_pipe {
    ($lit:expr) => {{
        const __BUN_LOCAL_PIPE: $crate::LocalPipeStr = $crate::LocalPipeStr::new($lit);
        __BUN_LOCAL_PIPE
    }};
}

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
