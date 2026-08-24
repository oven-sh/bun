//! Placeholder registered while a fresh TLS connect is in flight so that
//! concurrent h2-capable requests to the same origin coalesce onto its
//! eventual session instead of each opening a separate socket.

use core::cell::RefCell;
use core::ptr::NonNull;

use bun_core::strings;

use crate::RequestRef;
use crate::ssl_config::SSLConfig;

#[derive(Default)]
pub struct PendingConnect {
    pub(crate) hostname: Box<[u8]>,
    pub(crate) port: u16,
    // Compared by pointer identity only, never derefed/freed here.
    pub(crate) ssl_config: Option<NonNull<SSLConfig>>,
    /// Whether the client that initiated this in-flight TLS connect requested
    /// `rejectUnauthorized`. The eventual `ClientSession` records this as
    /// `established_with_reject_unauthorized`; mirroring it here lets the
    /// coalescing path apply the same strictness guard *before* the session
    /// exists, so a strict caller never waits on a connect started by a lax one.
    pub(crate) reject_unauthorized: bool,
    pub(crate) host_header_hash: u64,
    /// Requests waiting on this connect; each removes itself (or is resolved)
    /// before its terminal callback.
    pub(crate) waiters: RefCell<Vec<RequestRef>>,
}

impl PendingConnect {
    pub(crate) fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<NonNull<SSLConfig>>,
        host_header_hash: u64,
    ) -> bool {
        self.port == port
            && self.ssl_config == ssl_config
            && self.host_header_hash == host_header_hash
            && strings::eql_long(&self.hostname, hostname, true)
    }
}
