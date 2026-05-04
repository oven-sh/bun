use core::ptr::NonNull;

use super::WebSocketProxyTunnel;

/// WebSocketProxy encapsulates proxy state for WebSocket connections through HTTP/HTTPS proxies.
/// This struct holds only the fields needed after the initial CONNECT request.
/// Fields like proxy_port, proxy_authorization, and proxy_headers are used
/// only during connect() and freed immediately after building the CONNECT request.
pub struct WebSocketProxy {
    /// Target hostname for SNI during TLS handshake
    target_host: Box<[u8]>,
    /// Whether target uses TLS (wss://)
    target_is_https: bool,
    /// WebSocket upgrade request to send after CONNECT succeeds
    websocket_request_buf: Box<[u8]>,
    /// TLS tunnel for wss:// through HTTP proxy
    // TODO(port): lifetime — intrusive refcount (Drop calls shutdown()+deref()); not in LIFETIMES.tsv
    tunnel: Option<NonNull<WebSocketProxyTunnel>>,
}

impl WebSocketProxy {
    /// Initialize a new WebSocketProxy
    // PORT NOTE: params are owned (Zig caller transfers allocator ownership; freed in deinit)
    pub fn init(
        target_host: Box<[u8]>,
        target_is_https: bool,
        websocket_request_buf: Box<[u8]>,
    ) -> WebSocketProxy {
        WebSocketProxy {
            target_host,
            target_is_https,
            websocket_request_buf,
            tunnel: None,
        }
    }

    /// Get the target hostname for SNI during TLS handshake
    pub fn get_target_host(&self) -> &[u8] {
        &self.target_host
    }

    /// Check if the target uses HTTPS (wss://)
    pub fn is_target_https(&self) -> bool {
        self.target_is_https
    }

    /// Get the TLS tunnel for wss:// through HTTP proxy
    pub fn get_tunnel(&self) -> Option<NonNull<WebSocketProxyTunnel>> {
        self.tunnel
    }

    /// Set the TLS tunnel
    pub fn set_tunnel(&mut self, new_tunnel: Option<NonNull<WebSocketProxyTunnel>>) {
        self.tunnel = new_tunnel;
    }

    /// Take ownership of the WebSocket request buffer, clearing the internal reference.
    /// The caller is responsible for freeing the returned buffer.
    pub fn take_websocket_request_buf(&mut self) -> Box<[u8]> {
        core::mem::take(&mut self.websocket_request_buf)
    }
}

/// Clean up all allocated resources
impl Drop for WebSocketProxy {
    fn drop(&mut self) {
        // target_host / websocket_request_buf: Box<[u8]> drops automatically.
        if let Some(tunnel) = self.tunnel.take() {
            // SAFETY: tunnel is a live intrusive-refcounted pointer; we hold one ref
            // until deref() below releases it.
            unsafe {
                (*tunnel.as_ptr()).shutdown();
                (*tunnel.as_ptr()).deref();
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/websocket_client/WebSocketProxy.zig (71 lines)
//   confidence: medium
//   todos:      1
//   notes:      tunnel field uses raw NonNull (intrusive refcount); revisit once WebSocketProxyTunnel ownership model is settled
// ──────────────────────────────────────────────────────────────────────────
