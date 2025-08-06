# HTTP/2 Implementation Status

## ✅ PARTIAL SUCCESS: ALPN Support Implemented, HTTP/2 Not Working

### What Actually Works
- **ALPN negotiation is implemented and functional**
- ALPN protocol lists are properly configured in SSL contexts
- Servers that support HTTP/2 successfully negotiate it via ALPN
- The infrastructure for protocol-specific SSL contexts exists

### Implementation Details

#### 1. Added ALPN Support to uSockets (C layer)
- Extended `us_bun_socket_context_options_t` structure with ALPN fields
- Modified `create_ssl_context_from_bun_options()` to call `SSL_CTX_set_alpn_protos()`
- ALPN data is properly passed from Zig to C layer

#### 2. Updated Zig Bindings
- Added ALPN fields to `BunSocketContextOptions` struct in Zig
- Created static ALPN protocol arrays for h2, http/1.1, and both
- Modified context initialization to pass ALPN based on protocol preference

#### 3. Protocol-Specific SSL Contexts
- Created three separate SSL contexts: h1-only, h2-only, and both
- Each context advertises different ALPN protocols
- Contexts are selected based on the `httpVersion` option

### What Doesn't Work
- **HTTP/2 requests fail completely** - We get "Malformed_HTTP_Response" errors
- **The `httpVersion` option has no practical effect** - Setting it to 2 doesn't give you HTTP/2
- **No HTTP/2 protocol implementation** - We can negotiate HTTP/2 but can't speak it
- **Tests all fail** - Every HTTP/2 test returns 403 or malformed response errors

### Test Results
When connecting to any HTTPS site:
```
error: Malformed_HTTP_Response fetching "https://www.google.com/robots.txt"
```
The server is sending HTTP/2 frames but Bun tries to parse them as HTTP/1.1, causing the error.

### What's Missing
The actual HTTP/2 protocol implementation:
1. HTTP/2 frame parsing
2. Connection preface handling  
3. Stream multiplexing
4. HPACK header compression
5. Flow control
6. Settings negotiation

### Code Changes Summary
- `packages/bun-usockets/src/libusockets.h`: Added ALPN fields to options struct
- `packages/bun-usockets/src/crypto/openssl.c`: Implemented ALPN configuration
- `packages/bun-uws/src/App.h`: Updated to match new struct size
- `src/deps/uws/SocketContext.zig`: Added ALPN fields to Zig bindings
- `src/http/HTTPContext.zig`: Implemented protocol-specific context creation

## Bottom Line
**HTTP/2 does not work in Bun.** I implemented ALPN negotiation which allows servers to know we want HTTP/2, but without an actual HTTP/2 protocol implementation, this just breaks HTTPS connections to servers that prefer HTTP/2. 

The feature is non-functional and should not be merged without completing the HTTP/2 protocol implementation.