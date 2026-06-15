//! From-scratch git client focused on fast clones over the standard smart-HTTP
//! transport (no GitHub-specific APIs — works against any
//! `git-http-backend`/upload-pack endpoint, including GitHub).
//!
//! Runs entirely on bun's infrastructure: HTTP via `bun_http` (uSockets event
//! loop, BoringSSL, H1/H2), file I/O via `bun_sys`, parallelism via
//! `bun_threading::WorkPool`, hashes via `bun_boringssl_sys`/libdeflate.
//!
//! Speed comes from three things git either doesn't do or doesn't do by
//! default:
//!
//! * **libdeflate** for every zlib stream in the pack. The pack is held as one
//!   contiguous buffer, so each object is a single
//!   `libdeflate_zlib_decompress_ex` call (≈2–3× faster than zlib-ng's
//!   streaming inflate).
//! * **Parallel delta resolution** — each independent delta-chain root is one
//!   `WorkPool` task; bases are inflated once per chain.
//! * **Parallel checkout** — every blob write is a `WorkPool` task.
//! * **Two-wave blob dispatch** — wave-1 fires from already-indexed skeleton
//!   slices the moment the last skeleton fetch lands; wave-2 adds only the
//!   final batch's delta, so blob streams start before skeleton indexing ends.

mod checkout;
mod clone;
mod delta;
mod fs;
mod hash;
mod index;
mod odb;
mod oid;
mod pack;
mod pktline;
mod protocol;
mod transport;

pub use clone::{CloneOptions, clone, index_pack_file};
pub use oid::Oid;
pub use pack::{ObjKind, PackIndex, Timings};

/// Errors surfaced by the clone pipeline. Every variant is reachable from
/// untrusted server input or filesystem state — none are internal-invariant
/// panics.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Sys(bun_sys::Error),
    #[error("malformed pkt-line: {0}")]
    PktLine(&'static str),
    #[error("git protocol error: {0}")]
    Protocol(String),
    #[error("malformed packfile: {0}")]
    Pack(String),
    #[error("server error (side-band 3): {0}")]
    Remote(String),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("unsafe path in tree object: {0:?}")]
    UnsafePath(Vec<u8>),
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Error::Sys(e)
    }
}

pub(crate) type Result<T> = core::result::Result<T, Error>;
