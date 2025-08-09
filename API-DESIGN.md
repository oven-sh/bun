# QUIC API Design for Bun

## Overview

Bun's QUIC implementation provides a pure QUIC API for low-level stream multiplexing over encrypted connections. This is separate from HTTP/3, which is built on top of QUIC but not covered here.

## Core Concepts

### Two Object Types

1. **QuicSocket** - Represents a QUIC connection
2. **QuicStream** - Represents an individual stream within a connection

### Key Design Principles

- **All callbacks passed upfront** - Supports hot reloading by avoiding runtime callback assignment
- **Stream-centric API** - All data flows through streams, not the socket directly
- **No HTTP/3 concepts** - Pure QUIC only (no headers, no HTTP semantics)

## Client API

### Creating a Connection

```javascript
const socket = await Bun.quic("example.com:443", {
  // TLS configuration
  tls: {
    cert: Buffer,  // Client certificate (optional)
    key: Buffer,   // Client private key (optional)
    ca: Buffer,    // CA certificate for verification
  },
  
  // Stream lifecycle callbacks (apply to ALL streams)
  open(stream) {
    // Called when a new stream is opened (by either side)
    console.log("Stream opened:", stream.id);
    console.log("Stream data:", stream.data);  // Optional data attached to stream
  },
  
  data(stream, buffer) {
    // Called when data is received on a stream
    console.log("Received:", buffer);
    stream.write(responseBuffer);  // Can write back on same stream
  },
  
  drain(stream) {
    // Called when a stream is writable again after backpressure
    stream.write(moreData);
  },
  
  close(stream) {
    // Called when a stream is closed
    console.log("Stream closed:", stream.id);
  },
  
  error(stream, error) {
    // Called on stream-level errors
    console.error("Stream error:", error);
  }
});
```

### Creating Streams

```javascript
// Create a new stream with optional associated data
const stream = socket.stream({ 
  userId: 123,
  requestId: "abc"
});

// The optional data becomes accessible via stream.data
console.log(stream.data);  // { userId: 123, requestId: "abc" }

// Write data to the stream
stream.write(Buffer.from("Hello QUIC"));

// Close the stream when done
stream.end();  // or stream.close()
```

### QuicSocket Methods

```javascript
socket.stream(optionalData)  // Create a new stream, returns QuicStream
socket.close()               // Close the entire connection
socket.address               // Remote address info
socket.localAddress          // Local address info
```

### QuicStream Properties & Methods

```javascript
stream.write(buffer)         // Write data to stream
stream.end()                 // Close stream gracefully
stream.close()               // Close stream immediately
stream.data                  // Access optional data passed to socket.stream()
stream.id                    // Unique stream identifier
stream.socket                // Reference to parent QuicSocket
```

## Server API

### Creating a Server

```javascript
const server = Bun.listen({
  port: 443,
  hostname: "0.0.0.0",
  
  // QUIC configuration
  quic: {
    cert: Buffer,  // Server certificate (required)
    key: Buffer,   // Server private key (required)
    ca: Buffer,    // CA for client verification (optional)
    passphrase: string,  // Key passphrase (optional)
  },
  
  // Connection lifecycle (optional)
  open(socket) {
    // Called when a new QUIC connection is established
    console.log("New connection from:", socket.address);
  },
  
  // Stream lifecycle callbacks (same as client)
  stream: {
    open(stream) {
      // New stream opened by client
      console.log("Client opened stream:", stream.id);
      console.log("Stream data:", stream.data);
    },
    
    data(stream, buffer) {
      // Data received from client
      const request = buffer.toString();
      
      // Echo back or process
      stream.write(Buffer.from(`Echo: ${request}`));
      
      // Server can also create new streams to the client
      const pushStream = stream.socket.stream({ type: "push" });
      pushStream.write(Buffer.from("Server-initiated data"));
    },
    
    drain(stream) {
      // Stream writable again
    },
    
    close(stream) {
      // Stream closed
    },
    
    error(stream, error) {
      // Stream error
    }
  },
  
  close(socket) {
    // Connection closed
    console.log("Connection closed");
  },
  
  error(socket, error) {
    // Connection-level error
    console.error("Connection error:", error);
  }
});

// Stop the server
server.stop();
```

## Stream Lifecycle

### Stream Creation

1. **Client-initiated**: 
   - Client calls `socket.stream(data)`
   - Stream ID assigned (0, 4, 8, 12...)
   - `open(stream)` callback fires on both client and server

2. **Server-initiated**:
   - Server calls `socket.stream(data)` 
   - Stream ID assigned (1, 5, 9, 13...)
   - `open(stream)` callback fires on both sides

### Data Flow

1. Either side calls `stream.write(buffer)`
2. Other side receives `data(stream, buffer)` callback
3. Streams are bidirectional by default

### Stream Closure

1. `stream.end()` - Graceful closure (FIN)
2. `stream.close()` - Immediate closure (RESET)
3. `close(stream)` callback fires on both sides

## Important Notes

### No Direct Socket Writing

You cannot write directly to a QuicSocket:
```javascript
// ❌ WRONG - No socket.write() method
socket.write(data);  

// ✅ CORRECT - Create a stream first
const stream = socket.stream();
stream.write(data);
```

### All Callbacks Upfront

For hot reloading support, ALL callbacks must be passed in the initial options:
```javascript
// ❌ WRONG - Cannot set callbacks after creation
const socket = await Bun.quic(url, {});
socket.onData = () => {};  // Not supported!

// ✅ CORRECT - Pass all callbacks upfront
const socket = await Bun.quic(url, {
  data(stream, buffer) { ... },
  open(stream) { ... }
});
```

### Stream vs Connection Events

- **Connection-level**: `open(socket)`, `close(socket)`, `error(socket, error)`
- **Stream-level**: `stream.open(stream)`, `stream.data(stream, buffer)`, etc.
- Most events are stream-level since QUIC is stream-oriented

### Pure QUIC, Not HTTP/3

This API is for pure QUIC only:
- No HTTP headers
- No request/response semantics
- No status codes
- Just bidirectional byte streams

HTTP/3 will be a separate API built on top of this.

## Error Handling

### Connection Errors
```javascript
error(socket, error) {
  // Connection-level errors
  // - TLS handshake failures
  // - Network errors
  // - Protocol violations
}
```

### Stream Errors
```javascript
stream: {
  error(stream, error) {
    // Stream-level errors
    // - Stream reset by peer
    // - Flow control violation
    // - Stream-specific protocol errors
  }
}
```

## Example: Echo Server

```javascript
// Server
const server = Bun.listen({
  port: 4433,
  quic: { cert, key },
  stream: {
    data(stream, buffer) {
      // Echo back on the same stream
      stream.write(buffer);
    }
  }
});

// Client
const socket = await Bun.quic("localhost:4433", {
  tls: { ca },
  stream: {
    data(stream, buffer) {
      console.log("Received echo:", buffer.toString());
    }
  }
});

// Send data
const stream = socket.stream();
stream.write(Buffer.from("Hello QUIC!"));
```

## Example: Multi-Stream Chat

```javascript
// Client
const socket = await Bun.quic("chat.example.com:443", {
  tls: { ca },
  stream: {
    open(stream) {
      if (stream.data?.type === "notification") {
        console.log("Server notification stream opened");
      }
    },
    data(stream, buffer) {
      const message = JSON.parse(buffer.toString());
      if (stream.data?.type === "notification") {
        console.log("Notification:", message);
      } else {
        console.log("Chat message:", message);
      }
    }
  }
});

// Send a chat message
const chatStream = socket.stream({ type: "chat", room: "general" });
chatStream.write(JSON.stringify({ 
  user: "alice", 
  message: "Hello everyone!" 
}));

// Server can push notifications on a separate stream
// (in server code)
const notificationStream = socket.stream({ type: "notification" });
notificationStream.write(JSON.stringify({
  event: "user_joined",
  user: "bob"
}));
```

## Implementation Status

⚠️ **WARNING**: As of now, this API design is documented but **NOT IMPLEMENTED**. The current implementation:
- Uses wrong callback structure (connection-level instead of stream-level)
- Lacks QuicStream objects
- Cannot actually transfer data between client and server
- Mixes HTTP/3 concepts with pure QUIC

See STATUS.md for current implementation state.