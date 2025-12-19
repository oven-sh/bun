# WebSocket Proxy Support Implementation

## Overview

This document describes the implementation of HTTP proxy support for WebSocket connections in Bun, including both `ws://` and `wss://` protocols.

## JavaScript API

```javascript
// String format
new WebSocket("wss://example.com", { proxy: "http://proxy:8080" });

// Object format with custom headers
new WebSocket("wss://example.com", {
  proxy: {
    url: "http://proxy:8080",
    headers: { "Proxy-Authorization": "Bearer token" },
  },
});

// Proxy URL with credentials (Basic auth)
new WebSocket("wss://example.com", { proxy: "http://user:pass@proxy:8080" });

// HTTPS proxy (TLS connection to proxy)
new WebSocket("ws://example.com", {
  proxy: "https://proxy:8443",
  tls: { rejectUnauthorized: false }, // For self-signed proxy certs
});

// Combined with other options
new WebSocket("wss://example.com", {
  proxy: "http://proxy:8080",
  headers: { "Authorization": "Bearer token" },
  protocols: ["graphql-ws"],
  tls: { rejectUnauthorized: true },
});
```

## Architecture

### Connection Flow for ws:// Through HTTP Proxy

```
Client                         HTTP Proxy                    WebSocket Server
   |                               |                               |
   |-- CONNECT host:80 ----------->|                               |
   |<--------- 200 OK -------------|                               |
   |                               |                               |
   |-- GET / HTTP/1.1 ------------>|------------------------------>|
   |   Upgrade: websocket          |                               |
   |<------ 101 Switching ---------|<------------------------------|
   |                               |                               |
   |========= WebSocket frames ====|==============================>|
```

### Connection Flow for wss:// Through HTTP Proxy

```
Client                         HTTP Proxy                    WebSocket Server
   |                               |                               |
   |-- CONNECT host:443 --------->|                               |
   |<--------- 200 OK ------------|                               |
   |                               |                               |
   |== TLS Handshake (via SSLWrapper) =========================>|
   |                               |                               |
   |-- GET / HTTP/1.1 (encrypted) --------------------------->|
   |   Upgrade: websocket          |                               |
   |<------ 101 Switching (encrypted) -------------------------|
   |                               |                               |
   |========= WebSocket frames (encrypted) ===================>|
```

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        WebSocket Client                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │  JSWebSocket.cpp │───>│      WebSocket.cpp               │  │
│  │  (JS Bindings)   │    │  (Parse proxy options)           │  │
│  └──────────────────┘    └──────────────────────────────────┘  │
│           │                              │                       │
│           v                              v                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              WebSocketUpgradeClient.zig                  │   │
│  │  - Connect to proxy or target                           │   │
│  │  - Send CONNECT request (if proxy)                      │   │
│  │  - Handle proxy 200 response                            │   │
│  │  - Start TLS tunnel (if wss://)                         │   │
│  │  - Send WebSocket upgrade request                       │   │
│  │  - Process 101 response                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│           │                                                      │
│           v (for wss:// through proxy)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              WebSocketProxyTunnel.zig                    │   │
│  │  - SSLWrapper for TLS inside tunnel                     │   │
│  │  - SNI hostname configuration                           │   │
│  │  - Certificate verification                             │   │
│  │  - Encrypt/decrypt data flow                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│           │                                                      │
│           v                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              websocket_client.zig                        │   │
│  │  - WebSocket frame handling                             │   │
│  │  - Message send/receive                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Files Modified

### C++ Files

| File                                               | Changes                                          |
| -------------------------------------------------- | ------------------------------------------------ |
| `src/bun.js/bindings/webcore/JSWebSocket.cpp`      | Parse `proxy` option (string or object format)   |
| `src/bun.js/bindings/webcore/WebSocket.h`          | Add proxy member fields                          |
| `src/bun.js/bindings/webcore/WebSocket.cpp`        | New `create()` overloads with proxy, pass to Zig |
| `src/bun.js/bindings/webcore/WebSocketErrorCode.h` | Add proxy error codes                            |
| `src/bun.js/bindings/headers.h`                    | Update function signatures with proxy params     |

### Zig Files

| File                                                   | Changes                                     |
| ------------------------------------------------------ | ------------------------------------------- |
| `src/http/websocket_client.zig`                        | Add proxy error codes to `ErrorCode` enum   |
| `src/http/websocket_client/WebSocketUpgradeClient.zig` | Proxy state machine, TLS tunnel integration |
| `src/http/websocket_client/WebSocketProxyTunnel.zig`   | **New file** - TLS inside CONNECT tunnel    |

## Implementation Details

### WebSocketProxyTunnel.zig

This module handles TLS encryption/decryption inside an HTTP CONNECT tunnel using `SSLWrapper`:

```zig
const WebSocketProxyTunnel = @This();

// SSLWrapper callbacks
fn onOpen(this: *WebSocketProxyTunnel) void {
    // Configure SNI with target hostname
}

fn onData(this: *WebSocketProxyTunnel, decrypted_data: []const u8) void {
    // Forward decrypted data to WebSocketUpgradeClient
}

fn onHandshake(this: *WebSocketProxyTunnel, success: bool, ssl_error: ...) void {
    // Verify certificate, then send WebSocket upgrade
}

fn writeEncrypted(this: *WebSocketProxyTunnel, encrypted_data: []const u8) void {
    // Write encrypted data to proxy socket
}
```

### State Machine

The upgrade client uses these states for proxy connections:

```zig
const State = enum {
    initializing,
    reading,
    failed,
    proxy_handshake,      // Sent CONNECT, waiting for 200
    proxy_tls_handshake,  // TLS handshake inside tunnel (wss://)
};
```

### Proxy Authentication

Basic authentication is computed from proxy URL credentials:

```cpp
// In WebSocket.cpp
if (!socket->m_proxyUrl.user().isEmpty()) {
    auto credentials = makeString(m_proxyUrl.user(), ':', m_proxyUrl.password());
    auto encoded = base64EncodeToString(credentials.utf8());
    socket->m_proxyAuthorization = makeString("Basic "_s, encoded);
}
```

## Error Codes

New error codes added for proxy-related failures:

| Code | Name                            | Description                   |
| ---- | ------------------------------- | ----------------------------- |
| 33   | `proxy_connect_failed`          | Proxy returned non-200 status |
| 34   | `proxy_authentication_required` | Proxy returned 407            |
| 35   | `proxy_connection_refused`      | Could not connect to proxy    |
| 36   | `proxy_tunnel_failed`           | TLS tunnel setup failed       |

## Supported Scenarios

| Scenario                          | Status                                        |
| --------------------------------- | --------------------------------------------- |
| ws:// through HTTP proxy          | ✅ Working                                    |
| wss:// through HTTP proxy         | ✅ Working (TLS tunnel)                       |
| ws:// through HTTPS proxy         | ✅ Working (with `rejectUnauthorized: false`) |
| wss:// through HTTPS proxy        | ✅ Working (with `rejectUnauthorized: false`) |
| Proxy authentication (Basic)      | ✅ Working                                    |
| Custom proxy headers              | ✅ Working                                    |
| Certificate verification (target) | ✅ Working                                    |
| Custom CA for HTTPS proxy         | ⚠️ Not yet implemented                        |

**Note:** HTTPS proxy support works with `tls: { rejectUnauthorized: false }`. Custom CA certificates for HTTPS proxy connections (e.g., self-signed proxy certs) require applying `SSLConfig` to the proxy socket context, which is not yet implemented. The `tls.ca` option currently only applies to the target connection (wss://) or TLS tunnel, not the initial TLS connection to an HTTPS proxy.

## Testing

Test file: `test/js/web/websocket/websocket-proxy.test.ts`

The tests create a local HTTP CONNECT proxy server using Node's `net` module and a WebSocket echo server using `Bun.serve`. Tests cover:

- **API Tests**: Verify the proxy option is accepted in various formats
- **Functional Tests**: Actual WebSocket connections through the proxy
- **Auth Tests**: Proxy authentication with Basic auth
- **Error Tests**: Auth failures, wrong credentials

```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import net from "net";

// Create HTTP CONNECT proxy server
function createConnectProxy(options: { requireAuth?: boolean } = {}) {
  return net.createServer(clientSocket => {
    // Handle CONNECT request and establish tunnel
    // ...
  });
}

describe("WebSocket through HTTP CONNECT proxy", () => {
  test("ws:// through HTTP proxy", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${proxyPort}`,
    });
    // Verify connection and echo
  });

  test("ws:// through HTTP proxy with auth", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://proxy_user:proxy_pass@127.0.0.1:${authProxyPort}`,
    });
    // Verify authenticated connection
  });
});
```

## Environment Variables

The CLI respects standard proxy environment variables:

| Variable      | Description                                   |
| ------------- | --------------------------------------------- |
| `HTTP_PROXY`  | Proxy for HTTP requests                       |
| `HTTPS_PROXY` | Proxy for HTTPS requests                      |
| `NO_PROXY`    | Comma-separated list of hosts to bypass proxy |

## Future Improvements

1. **Custom CA for HTTPS Proxy**: Apply `tls.ca` option to the initial TLS connection to HTTPS proxies (not just the target/tunnel)
2. **SOCKS Proxy**: Support for SOCKS4/SOCKS5 proxies
3. **Proxy Auto-Config (PAC)**: Support for PAC files
