//! Placeholder registered while a fresh TLS connect is in flight so that
//! concurrent h2-capable requests to the same origin coalesce onto its
//! eventual session instead of each opening a separate socket.

use core::ptr::NonNull;

use bun_str::strings;

use crate::HTTPClient;
use crate::NewHTTPContext;
// TODO(port): verify path — Zig: bun.api.server.ServerConfig.SSLConfig
use bun_runtime::api::server::server_config::SSLConfig;

pub struct PendingConnect {
    pub hostname: Box<[u8]>,
    pub port: u16,
    // TODO(port): lifetime — compared by pointer identity only, never derefed/freed here
    pub ssl_config: Option<NonNull<SSLConfig>>,
    // TODO(port): lifetime — waiters are borrowed HTTP clients owned elsewhere
    pub waiters: Vec<NonNull<HTTPClient>>,
}

impl Default for PendingConnect {
    fn default() -> Self {
        Self {
            hostname: Box::default(),
            port: 0,
            ssl_config: None,
            waiters: Vec::new(),
        }
    }
}

impl PendingConnect {
    /// Zig: `pub const new = bun.TrivialNew(@This());`
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<NonNull<SSLConfig>>,
    ) -> bool {
        self.port == port
            && self.ssl_config == ssl_config
            && strings::eql_long(&self.hostname, hostname, true)
    }

    pub fn unregister_from(&mut self, ctx: &mut NewHTTPContext<true>) {
        let list = &mut ctx.pending_h2_connects;
        let this_ptr: *const Self = self;
        // PORT NOTE: reshaped for borrowck (was `for + swapRemove + return`)
        // TODO(port): assumes `pending_h2_connects: Vec<NonNull<PendingConnect>>`
        if let Some(i) = list
            .iter()
            .position(|p| core::ptr::eq(p.as_ptr(), this_ptr))
        {
            list.swap_remove(i);
        }
    }

    // Zig `deinit` freed `hostname`, deinited `waiters`, and `bun.destroy(this)`.
    // In Rust all three are handled by dropping `Box<PendingConnect>` — `Box<[u8]>`
    // and `Vec<_>` fields free themselves, and the Box frees the allocation.
    // No explicit `Drop` impl needed.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h2_client/PendingConnect.zig (39 lines)
//   confidence: medium
//   todos:      4
//   notes:      ssl_config/waiters kept as NonNull (borrowed); deinit folded into Drop of Box<Self>
// ──────────────────────────────────────────────────────────────────────────
