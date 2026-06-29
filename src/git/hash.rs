//! SHA-1 helpers.
//!
//! These are the ONLY functions in the crate that reach BoringSSL's `SHA1_*`
//! C symbols, which are provided solely by the final CMake link of the bun
//! binary. They must never be called (directly or transitively) from a
//! `#[test]` — the standalone test binary cannot resolve them. Status
//! injection (`hash_object`) and the pure `Index::parse` exist precisely so
//! tests never need them.

use crate::error::GitError;
use crate::oid::{OID_RAW_LEN, Oid};
use crate::util::format_decimal;
use bun_sha_hmac::sha::hashers::SHA1;

/// `sha1("blob <len>\0" + contents)` — the id git would give a worktree
/// file's raw bytes (no content filters; see the `status` module docs).
pub fn hash_blob(contents: &[u8]) -> Oid {
    let mut hasher = SHA1::init();
    hasher.update(b"blob ");
    let mut buf = [0u8; 20];
    hasher.update(format_decimal(contents.len() as u64, &mut buf));
    hasher.update(b"\0");
    hasher.update(contents);
    let mut out = [0u8; OID_RAW_LEN];
    hasher.r#final(&mut out);
    Oid(out)
}

/// Verify the SHA-1 trailer that closes a `.git/index` file
/// (`gitformat-index.txt`: "Hash checksum over the content of the index
/// file before this checksum").
pub(crate) fn verify_trailing_sha1(data: &[u8], what: &'static str) -> Result<(), GitError> {
    if data.len() < OID_RAW_LEN {
        return Err(GitError::Corrupt(what));
    }
    let (body, trailer) = data.split_at(data.len() - OID_RAW_LEN);
    let mut digest = [0u8; OID_RAW_LEN];
    SHA1::hash(body, &mut digest);
    if digest != trailer {
        return Err(GitError::Corrupt(what));
    }
    Ok(())
}
