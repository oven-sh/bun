# QUIC Implementation TODO

## Current State
The QUIC implementation is partially working but has critical architectural issues that need fixing. Basic connections work, but the design doesn't follow uSockets patterns properly.

## Design Document
See `QUIC.md` for the complete architectural design. This follows uSockets patterns and provides a clean API for HTTP/3.

## Critical Issues to Fix

### 1. Remove global_listen_socket (HIGH PRIORITY)
**File**: `packages/bun-usockets/src/quic.c`
**Problem**: Using a global variable `global_listen_socket` instead of proper socket structures
**Solution**: 
- Implement proper `us_quic_listen_socket_t` structure as defined in QUIC.md
- Each server connection should reference its parent listen socket, not a global
- Follow the TCP socket pattern in uSockets

### 2. Fix Connection/Socket Structure
**Current broken structure**:
```c
// Currently all server connections share one global UDP socket (WRONG)
socket->udp_socket = global_listen_socket;
```

**Should be**:
```c
struct us_quic_socket_t {
    struct us_udp_socket_t udp_socket;  // Inline, not pointer
    us_quic_socket_context_t *context;
    struct us_quic_socket_t *next;      // For deferred cleanup
    int is_closed;
};

struct us_quic_connection_t {
    us_quic_socket_t *socket;           // Reference to parent
    lsquic_conn_t *lsquic_conn;
    void *peer_ctx;
    struct us_quic_connection_t *next;  // For deferred cleanup
    int is_closed;
};
```

### 3. Implement Deferred Cleanup
**Problem**: Memory is freed immediately in callbacks, causing use-after-free
**Solution**:
- Add linked lists to context for closing connections/sockets
- Implement `us_internal_quic_sweep_closed()` called each loop iteration
- Never free memory in lsquic callbacks - always defer

### 4. Fix Peer Context Management
**Problem**: Creating new peer_ctx for each packet instead of per-connection
**Solution**:
- Each connection should have one persistent peer_ctx
- Store peer address in the peer_ctx for server connections
- Reuse peer_ctx across all packets for a connection

### 5. Fix Stream Management
**Problem**: Global/shared stream state instead of per-stream
**Solution**:
- Each stream's extension data should hold its own state
- Remove any global stream variables
- Use `us_quic_stream_ext()` to access per-stream data

### 6. Fix Server Write Issues
**Problem**: Server cannot write to clients (likely peer_ctx issue)
**Solution**:
- Ensure each server connection has proper peer_ctx with UDP socket reference
- Verify `send_packets_out` gets correct peer_ctx for server connections
- Test with `quic-server-client.test.ts` line 30 (currently commented out)

## Implementation Order

1. **First**: Fix the core architecture (items 1-4 above)
   - This is foundational - everything else depends on getting this right
   
2. **Second**: Fix stream management (item 5)
   - Needed for proper HTTP/3 request/response handling
   
3. **Third**: Fix server writes (item 6)
   - Should work once peer contexts are fixed
   
4. **Fourth**: Run tests and fix issues
   - `bun bd test test/js/bun/quic/quic-server-client.test.ts`
   - `bun bd test test/js/bun/quic/quic-performance.test.ts`

## Key Files

- **Design**: `/home/claude/bun2/packages/bun-usockets/QUIC.md`
- **Implementation**: `/home/claude/bun2/packages/bun-usockets/src/quic.c`
- **Header**: `/home/claude/bun2/packages/bun-usockets/src/quic.h`
- **Tests**: `/home/claude/bun2/test/js/bun/quic/*.test.ts`

## Testing

Always use `bun bd` to build and test:
```bash
# Build debug version (takes ~5 minutes, be patient)
bun bd

# Run specific test
bun bd test test/js/bun/quic/quic-server-client.test.ts

# Run with filter
bun bd test quic -t "server and client"
```

## Important Notes

1. **lsquic handles all QUIC protocol complexity** - We just do UDP I/O and callbacks
2. **Follow uSockets patterns exactly** - Look at TCP implementation for guidance
3. **Never free memory in callbacks** - Always defer to next loop iteration
4. **Test incrementally** - Fix one issue, test, then move to next
5. **The design in QUIC.md is complete** - Follow it closely

## Success Criteria

- [ ] No global variables (especially no `global_listen_socket`)
- [ ] Server can write to clients successfully
- [ ] All tests in `quic-server-client.test.ts` pass
- [ ] No segfaults in `quic-performance.test.ts`
- [ ] Clean shutdown without memory leaks
- [ ] Follows uSockets patterns consistently