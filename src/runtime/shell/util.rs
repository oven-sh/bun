#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum OutKind {
    Stdout,
    Stderr,
}

// The user-facing stdio type from `crate::api::bun_spawn::stdio`, NOT the
// low-level `PosixStdio`/`WindowsStdio` spawn-option shape that the
// `bun_spawn` *crate* re-exports under the same name.
pub use crate::api::bun_spawn::stdio::Stdio;
