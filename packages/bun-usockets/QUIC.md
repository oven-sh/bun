# QUIC Implementation Design

## Overview

This document describes the design of QUIC support in uSockets, following established uSockets patterns while integrating with the lsquic library for QUIC protocol implementation.

## Core Architecture

### Type Hierarchy

The QUIC implementation uses three core types that mirror the TCP socket design:

```c
// Socket that handles UDP transport and QUIC connections
struct us_quic_socket_t {
    struct us_udp_socket_t udp_socket;      // Inline UDP socket
    us_quic_socket_context_t *context;      // Reference to context
    
    struct us_quic_socket_t *next;          // For deferred free list
    int is_closed;                           // Marked for cleanup
    
    // Extension data follows
};

// Individual QUIC connection (multiplexed over socket)
struct us_quic_connection_t {
    us_quic_socket_t *socket;               // Parent socket for I/O
    lsquic_conn_t *lsquic_conn;            // Opaque QUIC connection
    void *peer_ctx;                         // For lsquic callbacks
    
    struct us_quic_connection_t *next;      // For deferred free list
    int is_closed;                          // Marked for cleanup
    
    // Extension data follows
};

// Listen socket is just an alias - same structure
typedef struct us_quic_socket_t us_quic_listen_socket_t;
```

### Context Structure

The context holds configuration, engine, and manages deferred cleanup:

```c
struct us_quic_socket_context_s {
    struct us_loop_t *loop;
    lsquic_engine_t *engine;                // Single QUIC engine
    int is_server;                           // 0 = client, 1 = server
    
    // Deferred cleanup lists (swept each loop iteration)
    struct us_quic_connection_t *closing_connections;
    struct us_quic_socket_t *closing_sockets;
    
    // SSL/TLS configuration
    SSL_CTX *ssl_context;
    struct us_bun_socket_context_options_t options;
    
    // Connection callbacks
    void(*on_open)(us_quic_socket_t *s, int is_client);
    void(*on_close)(us_quic_socket_t *s);
    
    // Stream callbacks (for HTTP/3)
    void(*on_stream_open)(us_quic_stream_t *s, int is_client);
    void(*on_stream_close)(us_quic_stream_t *s);
    void(*on_stream_data)(us_quic_stream_t *s, char *data, int length);
    void(*on_stream_end)(us_quic_stream_t *s);
    void(*on_stream_writable)(us_quic_stream_t *s);
    void(*on_stream_headers)(us_quic_stream_t *s);
    
    // Extension data follows
};
```

## Key Design Principles

### 1. Connection Multiplexing

QUIC fundamentally differs from TCP - multiple QUIC connections share a single UDP socket:

- **Server**: One `us_quic_socket_t` accepts all connections on a port
- **Client**: One `us_quic_socket_t` can connect to multiple servers
- **Demultiplexing**: lsquic engine routes packets using Connection IDs

### 2. Memory Management

Following uSockets patterns for safe cleanup:

- **No immediate frees**: Never free memory in callbacks
- **Deferred cleanup**: Add to linked lists, sweep on next loop iteration
- **Reference management**: lsquic owns `lsquic_conn_t`, we own our structures

### 3. Lifecycle Management

```c
// Connection closed by lsquic
void on_conn_closed(lsquic_conn_t *c) {
    us_quic_connection_t *conn = lsquic_conn_get_ctx(c);
    
    // Mark as closed and clear lsquic pointer (no longer valid)
    conn->is_closed = 1;
    conn->lsquic_conn = NULL;
    
    // Add to deferred cleanup list
    conn->next = conn->socket->context->closing_connections;
    conn->socket->context->closing_connections = conn;
}

// Socket close requested
void us_quic_socket_close(us_quic_socket_t *socket) {
    socket->is_closed = 1;
    
    // Add to deferred cleanup list
    socket->next = socket->context->closing_sockets;
    socket->context->closing_sockets = socket;
    
    // Tell lsquic to close connections
    lsquic_engine_close_conns(socket->context->engine);
}

// Loop sweep function (called each iteration)
void us_internal_quic_sweep_closed(struct us_loop_t *loop) {
    // Process all contexts' cleanup lists
    
    // Free closed connections
    while (context->closing_connections) {
        us_quic_connection_t *conn = context->closing_connections;
        context->closing_connections = conn->next;
        free(conn);
    }
    
    // Free closed sockets  
    while (context->closing_sockets) {
        us_quic_socket_t *socket = context->closing_sockets;
        context->closing_sockets = socket->next;
        free(socket);
    }
}
```

## Usage Patterns

### Server Usage

```c
// 1. Create context (once per configuration)
us_quic_socket_context_t *context = us_create_quic_socket_context(loop, options, ext_size);

// 2. Create listen socket (binds UDP port)
us_quic_listen_socket_t *listen = us_quic_socket_context_listen(context, "0.0.0.0", 443, ext_size);

// 3. Connections arrive via callbacks
//    - lsquic creates lsquic_conn_t
//    - We create us_quic_connection_t in on_new_conn
//    - All connections share the listen socket's UDP socket
```

### Client Usage

```c
// 1. Create context
us_quic_socket_context_t *context = us_create_quic_socket_context(loop, options, ext_size);

// 2. Create client socket and connect
us_quic_socket_t *socket = us_quic_socket_context_connect(context, "example.com", 443, ext_size);

// 3. Can create multiple connections on same socket
//    - Each gets its own us_quic_connection_t
//    - All share the socket's UDP socket
```

## Integration with lsquic

### Engine Management

- One lsquic engine per context
- Engine mode (client/server) set at context creation
- Engine processes all connections for that context

### Packet Flow

**Incoming packets:**
1. UDP socket receives data in callback
2. Pass to `lsquic_engine_packet_in()`
3. lsquic routes to correct connection by Connection ID
4. lsquic calls our stream callbacks

**Outgoing packets:**
1. lsquic calls `send_packets_out` callback
2. We send via the appropriate UDP socket
3. Peer context provides destination address

### Peer Context

Each connection maintains a peer context for lsquic:

```c
struct quic_peer_ctx {
    struct us_udp_socket_t *udp_socket;    // Which socket to send through
    us_quic_socket_context_t *context;     // For accessing callbacks
    // lsquic stores peer address internally via lsquic_conn_get_sockaddr()
};
```

## Stream Management

Streams are the core abstraction for HTTP/3. Each HTTP request/response pair is a QUIC stream.

### Stream Structure

```c
// Streams are lsquic_stream_t pointers with extension data
typedef lsquic_stream_t us_quic_stream_t;

// Access extension data (for HTTP/3 response data)
void *us_quic_stream_ext(us_quic_stream_t *s);
```

### Stream Operations

```c
// Write data to stream
int us_quic_stream_write(us_quic_stream_t *s, char *data, int length);

// Shutdown stream (FIN)
int us_quic_stream_shutdown(us_quic_stream_t *s);

// Shutdown read side only
int us_quic_stream_shutdown_read(us_quic_stream_t *s);

// Close stream abruptly (RESET)
void us_quic_stream_close(us_quic_stream_t *s);

// Get parent socket
us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s);

// Check if client initiated
int us_quic_stream_is_client(us_quic_stream_t *s);

// Create new stream on connection
void us_quic_socket_create_stream(us_quic_socket_t *s, int ext_size);
```

### HTTP/3 Header Operations

```c
// Set header at index (for sending)
void us_quic_socket_context_set_header(
    us_quic_socket_context_t *context, 
    int index, 
    const char *key, int key_length, 
    const char *value, int value_length
);

// Get header at index (for receiving)
int us_quic_socket_context_get_header(
    us_quic_socket_context_t *context,
    int index,
    char **name, int *name_length,
    char **value, int *value_length
);

// Send accumulated headers
void us_quic_socket_context_send_headers(
    us_quic_socket_context_t *context,
    us_quic_stream_t *s,
    int num_headers,
    int has_body
);
```

## Callback Reference

### Connection Callbacks

```c
// Called when QUIC connection is established
void on_open(us_quic_socket_t *s, int is_client);

// Called when QUIC connection closes
void on_close(us_quic_socket_t *s);
```

### Stream Callbacks (HTTP/3 Request/Response)

```c
// New stream created (new HTTP request on server, response on client)
void on_stream_open(us_quic_stream_t *s, int is_client);

// Stream closed (HTTP exchange complete or aborted)
void on_stream_close(us_quic_stream_t *s);

// Headers received (HTTP request/response headers)
void on_stream_headers(us_quic_stream_t *s);

// Data received on stream (HTTP body data)
void on_stream_data(us_quic_stream_t *s, char *data, int length);

// End of stream data (FIN received)
void on_stream_end(us_quic_stream_t *s);

// Stream is writable (backpressure relief)
void on_stream_writable(us_quic_stream_t *s);
```

### Setting Callbacks

```c
// Connection callbacks
us_quic_socket_context_on_open(context, on_open);
us_quic_socket_context_on_close(context, on_close);

// Stream callbacks
us_quic_socket_context_on_stream_open(context, on_stream_open);
us_quic_socket_context_on_stream_close(context, on_stream_close);
us_quic_socket_context_on_stream_headers(context, on_stream_headers);
us_quic_socket_context_on_stream_data(context, on_stream_data);
us_quic_socket_context_on_stream_end(context, on_stream_end);
us_quic_socket_context_on_stream_writable(context, on_stream_writable);
```

## HTTP/3 Integration

The QUIC implementation is designed to seamlessly support HTTP/3:

### HTTP/3 Request Flow (Server)

1. Client connects → `on_open` callback
2. Client creates stream for request → `on_stream_open`
3. Request headers arrive → `on_stream_headers`
4. Request body data → `on_stream_data` (multiple calls)
5. Request complete → `on_stream_end`
6. Server writes response headers → `us_quic_socket_context_send_headers`
7. Server writes response body → `us_quic_stream_write`
8. Server ends response → `us_quic_stream_shutdown`
9. Stream closes → `on_stream_close`

### HTTP/3 Response (Http3Response compatibility)

The stream extension data can hold Http3ResponseData:

```c
struct Http3ResponseData {
    // Callbacks for async operations
    void (*onAborted)();
    void (*onData)(char *data, int length, bool fin);
    bool (*onWritable)(uint64_t offset);
    
    // Header management
    unsigned int headerOffset;
    
    // Write state
    uint64_t offset;
    
    // Backpressure buffer
    char *backpressure;
    int backpressure_length;
};
```

This allows the existing Http3Response class to work directly with QUIC streams.

## Error Handling

- Connection errors trigger `on_close` callback
- Stream errors trigger `on_stream_close` callback
- Engine errors can be queried via lsquic APIs
- Socket errors follow standard uSockets error patterns

## Performance Considerations

- Single UDP socket reduces port usage and improves NAT traversal
- Connection multiplexing reduces system resources
- Deferred cleanup prevents callback reentrancy issues
- Inline structures improve cache locality

## Complete API Reference

### Context Management

```c
// Create QUIC socket context
us_quic_socket_context_t *us_create_quic_socket_context(
    struct us_loop_t *loop,
    us_quic_socket_context_options_t options,
    int ext_size
);

// Get context extension data
void *us_quic_socket_context_ext(us_quic_socket_context_t *context);

// Get context from socket
us_quic_socket_context_t *us_quic_socket_context(us_quic_socket_t *s);
```

### Socket Operations

```c
// Create listen socket (server)
us_quic_listen_socket_t *us_quic_socket_context_listen(
    us_quic_socket_context_t *context,
    const char *host,
    int port,
    int ext_size
);

// Create client socket and connect
us_quic_socket_t *us_quic_socket_context_connect(
    us_quic_socket_context_t *context,
    const char *host,
    int port,
    int ext_size
);

// Close socket
void us_quic_socket_close(us_quic_socket_t *s);

// Get socket extension data
void *us_quic_socket_ext(us_quic_socket_t *s);
```

### Connection Operations

```c
// Get connection extension data
void *us_quic_connection_ext(us_quic_connection_t *c);

// Close connection
void us_quic_connection_close(us_quic_connection_t *c);

// Get connection socket
us_quic_socket_t *us_quic_connection_socket(us_quic_connection_t *c);
```

### Stream Operations

```c
// Create new stream on connection
void us_quic_socket_create_stream(us_quic_socket_t *s, int ext_size);

// Write data to stream
int us_quic_stream_write(us_quic_stream_t *s, char *data, int length);

// Shutdown stream (send FIN)
int us_quic_stream_shutdown(us_quic_stream_t *s);

// Shutdown read side only
int us_quic_stream_shutdown_read(us_quic_stream_t *s);

// Close stream abruptly (send RESET)
void us_quic_stream_close(us_quic_stream_t *s);

// Get stream extension data
void *us_quic_stream_ext(us_quic_stream_t *s);

// Get parent socket
us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s);

// Check if client-initiated stream
int us_quic_stream_is_client(us_quic_stream_t *s);
```

### HTTP/3 Specific Operations

**Important**: lsquic handles all QPACK encoding/decoding internally. We never deal with QPACK directly.

```c
// Header set callbacks (implemented by us, called by lsquic)
struct lsquic_hset_if {
    void *(*hsi_create_header_set)(void *ctx, lsquic_stream_t *stream, int is_push);
    void (*hsi_discard_header_set)(void *hdr_set);
    struct lsxpack_header *(*hsi_prepare_decode)(void *hdr_set, 
                                                  struct lsxpack_header *hdr, 
                                                  size_t space);
    int (*hsi_process_header)(void *hdr_set, struct lsxpack_header *hdr);
};

// Helper functions for working with headers:

// Set header for sending (we provide name/value, lsquic encodes to QPACK)
void us_quic_socket_context_set_header(
    us_quic_socket_context_t *context,
    int index,
    const char *key, int key_length,
    const char *value, int value_length
);

// Get received header (already decoded from QPACK by lsquic)  
int us_quic_socket_context_get_header(
    us_quic_socket_context_t *context,
    int index,
    char **name, int *name_length,
    char **value, int *value_length
);

// Send accumulated headers (lsquic encodes to QPACK and sends)
void us_quic_socket_context_send_headers(
    us_quic_socket_context_t *context,
    us_quic_stream_t *s,
    int num_headers,
    int has_body
);
```

## HTTP/3 App Integration

The QUIC implementation supports the same App pattern as HTTP/1.1 and HTTP/2:

### Http3Context Structure

```c
struct Http3Context {
    us_quic_socket_context_t *quicContext;
    HttpRouter<Http3ContextData::RouterData> router;
    
    // Create context
    static Http3Context *create(us_loop_t *loop, us_quic_socket_context_options_t options);
    
    // Listen on port
    us_quic_listen_socket_t *listen(const char *host, int port);
    
    // Register route handlers
    void onHttp(std::string_view method, std::string_view pattern, 
                MoveOnlyFunction<void(Http3Response *, Http3Request *)> handler);
    
    // Initialize callbacks
    void init();
};
```

### H3App Pattern (matching App/SSLApp)

```cpp
struct H3App {
    Http3Context *http3Context;
    
    // Constructor with SSL options
    H3App(SocketContextOptions options = {});
    
    // HTTP method handlers (same as App)
    H3App &&get(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&post(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&put(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&del(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&patch(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&head(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&options(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&connect(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&trace(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    H3App &&any(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler);
    
    // Listen methods (same interface as App)
    H3App &&listen(int port, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler);
    H3App &&listen(const std::string &host, int port, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler);
    
    // Run the event loop
    void run();
};
```

### Usage Example

```cpp
// HTTP/3 app usage - identical to HTTP/1.1 App
H3App app(sslOptions);

app.get("/*", [](Http3Response *res, Http3Request *req) {
    res->end("Hello HTTP/3!");
}).listen(443, [](auto *listen_socket) {
    if (listen_socket) {
        std::cout << "HTTP/3 server listening on port 443" << std::endl;
    }
}).run();
```

## Implementation Requirements

### For HTTP/3 Support

1. **Http3Context** needs to:
   - Create and manage `us_quic_socket_context_t`
   - Set up stream callbacks that route to HTTP handlers
   - Manage the router for path matching

2. **Stream Callbacks** must:
   - Parse HTTP/3 headers when `on_stream_headers` is called
   - Create Http3Request objects from headers
   - Route to appropriate handler based on method and path
   - Manage Http3Response lifecycle

3. **Http3Request** needs to:
   - Store headers received via lsquic callbacks (already decoded)
   - Provide getHeader(), getMethod(), getUrl() methods
   - Handle request body streaming

4. **Http3Response** needs to:
   - Build headers using us_quic_socket_context_set_header()
   - Let lsquic handle QPACK encoding when sending
   - Manage backpressure
   - Handle response streaming
   - Track header/body state

### Callback Flow for HTTP/3 Request

```
1. on_stream_open(stream)
   -> Allocate Http3ResponseData in stream extension
   -> Initialize response state

2. on_stream_headers(stream)
   -> Parse HTTP/3 headers via QPACK
   -> Create Http3Request from headers
   -> Look up route in router
   -> Call user handler(Http3Response*, Http3Request*)

3. on_stream_data(stream, data, length)
   -> If request has body, buffer or stream to handler
   -> Call request->onData() if set

4. on_stream_end(stream)
   -> Mark request as complete
   -> If response not sent, send error

5. on_stream_close(stream)
   -> Clean up Http3ResponseData
   -> Free any pending resources
```

## What lsquic Handles For Us

lsquic is a full-featured QUIC/HTTP/3 implementation that handles:

### Protocol Layer
- **QUIC transport** - Packet framing, encryption, connection IDs
- **TLS 1.3** - Full handshake, key derivation, 0-RTT support
- **HTTP/3 framing** - DATA, HEADERS, SETTINGS frames
- **QPACK** - Header compression/decompression (we never touch this)
- **Connection migration** - Automatic handling of client IP changes
- **Version negotiation** - Supports multiple QUIC versions

### Reliability & Performance
- **Loss detection & recovery** - Automatic retransmission
- **Congestion control** - BBR, Cubic, adaptive selection based on RTT
- **Flow control** - Per-stream and per-connection windows
- **Pacing** - Smooth packet transmission
- **ACK management** - Delayed ACKs, ACK frequency optimization

### HTTP/3 Features
- **Stream management** - Creation, prioritization, cancellation
- **GOAWAY handling** - Graceful connection shutdown
- **Server push** - HTTP/3 push promises (optional)
- **Datagram extension** - Unreliable delivery mode
- **Session resumption** - 0-RTT data on reconnect

### What We Handle
- **Socket I/O** - UDP packet send/receive
- **Event loop integration** - Timer management, I/O readiness
- **Memory management** - Our structures and extensions
- **Routing** - HTTP path matching and handler dispatch
- **Application callbacks** - Connection, stream, and data events

## Future Improvements

- WebSocket over HTTP/3 support
- Batch packet sending using sendmmsg
- Better connection pooling for clients
- Performance optimizations for packet I/O
- Integration with io_uring for better performance