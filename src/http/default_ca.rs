//! Process-wide override of the default CA certificate set, installed by
//! `tls.setDefaultCACertificates()`. Written on the JS thread (through
//! [`set`]), consumed on the HTTP client thread, which rebuilds the default
//! HTTPS `SSL_CTX` whenever [`generation`] moves (see `HttpThread::connect`).
//!
//! `node:tls`/`node:https` sockets do not read this store: their JS layer
//! applies the same override when building each secure context
//! (`_defaultCACertificatesOverride` in `src/js/node/tls.ts`). This bridge
//! exists solely for `fetch()`/`Bun.fetch`, whose TLS contexts live on the
//! HTTP client thread.

use std::ffi::CString;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use bun_threading::Guarded;

static OVERRIDE: Guarded<Option<Arc<Vec<CString>>>> = Guarded::new(None);
/// 0 = never set. Bumped after the new store is published, so a reader that
/// observes generation N under Acquire sees at least the store published for
/// N when it takes the lock.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Replaces the default CA set. An empty `certs` means an explicitly empty
/// trust store (every verification fails), matching Node's
/// `tls.setDefaultCACertificates([])`.
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
