
//! `tls.setDefaultCACertificates()` override for `fetch()`'s HTTP-thread TLS
//! contexts (node:tls applies it in JS instead — src/js/node/tls.ts).
//! <https://github.com/nodejs/node/blob/main/lib/tls.js>
use std::ffi::CString;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use bun_threading::Guarded;

static OVERRIDE: Guarded<Option<Arc<Vec<CString>>>> = Guarded::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn set(certs: Vec<CString>) {
    *OVERRIDE.lock() = Some(Arc::new(certs));
    GENERATION.fetch_add(1, Ordering::Release);
}

pub fn generation() -> u64 {
    GENERATION.load(Ordering::Acquire)
}

pub fn snapshot() -> Option<Arc<Vec<CString>>> {
    OVERRIDE.lock().clone()
}
