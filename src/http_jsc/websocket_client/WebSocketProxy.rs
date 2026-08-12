use core::ptr::NonNull;

use bun_ptr::OwnedRef;

use super::WebSocketProxyTunnel;

/// WebSocketProxy encapsulates proxy state for WebSocket connections through HTTP/HTTPS proxies.
/// This struct holds only the fields needed after the initial CONNECT request.
/// Fields like proxy_port, proxy_authorization, and proxy_headers are used
/// only during connect() and freed immediately after building the CONNECT request.
pub(crate) struct WebSocketProxy {
    /// Target hostname for SNI during TLS handshake
    target_host: Box<[u8]>,
    /// Whether target uses TLS (wss://)
    target_is_https: bool,
    /// WebSocket upgrade request to send after CONNECT succeeds
    websocket_request_buf: Box<[u8]>,
    /// TLS tunnel for wss:// through HTTP proxy; `Drop` shuts it down before
    /// the ref is released.
    tunnel: Option<OwnedRef<WebSocketProxyTunnel>>,
}

impl WebSocketProxy {
    /// Initialize a new WebSocketProxy
    // params are owned (caller transfers ownership; freed in deinit)
    pub(crate) fn init(
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
    pub(crate) fn get_target_host(&self) -> &[u8] {
        &self.target_host
    }

    /// Check if the target uses HTTPS (wss://)
    pub(crate) fn is_target_https(&self) -> bool {
        self.target_is_https
    }

    /// Get the TLS tunnel for wss:// through HTTP proxy
    pub(crate) fn get_tunnel(&self) -> Option<NonNull<WebSocketProxyTunnel>> {
        self.tunnel.as_ref().map(OwnedRef::as_non_null)
    }

    /// Store the TLS tunnel; the proxy now holds the ref until it is dropped.
    pub(crate) fn set_tunnel(&mut self, new_tunnel: OwnedRef<WebSocketProxyTunnel>) {
        debug_assert!(self.tunnel.is_none(), "a connection creates one tunnel");
        self.tunnel = Some(new_tunnel);
    }

    /// Take ownership of the WebSocket request buffer, clearing the internal reference.
    /// The caller is responsible for freeing the returned buffer.
    pub(crate) fn take_websocket_request_buf(&mut self) -> Box<[u8]> {
        core::mem::take(&mut self.websocket_request_buf)
    }
}

/// Clean up all allocated resources
impl Drop for WebSocketProxy {
    fn drop(&mut self) {
        // target_host / websocket_request_buf: Box<[u8]> drops automatically.
        if let Some(tunnel) = self.tunnel.take() {
            // SAFETY: `tunnel` holds a ref, so the tunnel is live.
            unsafe { WebSocketProxyTunnel::shutdown(tunnel.as_ptr()) };
            // `tunnel` drops here and releases the ref.
        }
    }
}
