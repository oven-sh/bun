//! `NODE_EXTRA_CA_CERTS` for the native CA loader in `packages/bun-usockets/src/crypto/root_certs.cpp`.
//!
//! The variable can come from a `.env` file, which Bun loads into its own env map and not into the C environment, so
//! the loader asks here instead of `getenv`. As in Node, the value is read once per process: the first [`load_env`]
//! wins (the runtime VM calls it at boot, before any TLS context exists), and a later `process.env` write changes
//! nothing. A command that never calls it, such as `bun install`, reads the process environment only.

use core::ffi::c_char;
use std::sync::OnceLock;

use bun_core::{ZBox, env_var};

static EXTRA_CA_CERTS: OnceLock<Option<ZBox>> = OnceLock::new();

fn path_of(value: Option<&[u8]>) -> Option<ZBox> {
    value.filter(|path| !path.is_empty()).map(ZBox::from_bytes)
}

/// Takes the process-wide snapshot of `NODE_EXTRA_CA_CERTS` from an env map that already has the `.env` files in it.
/// Only the first call counts.
pub fn load_env(extra_ca_certs: Option<&[u8]>) {
    let _ = EXTRA_CA_CERTS.set(path_of(extra_ca_certs));
}

/// The path as a NUL-terminated string that lives for the process, or null when the variable is unset or empty.
#[unsafe(no_mangle)]
extern "C" fn Bun__Node__extraCACertsPath() -> *const c_char {
    match EXTRA_CA_CERTS.get_or_init(|| path_of(env_var::NODE_EXTRA_CA_CERTS::get())) {
        Some(path) => path.as_ptr(),
        None => core::ptr::null(),
    }
}
