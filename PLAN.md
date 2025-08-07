# HTTP/2 Implementation Fix Plan

## Progress Status
- ✅ **Phase 1: Fix Response Completion** - COMPLETED
- ✅ **CONTINUATION Frame Support** - COMPLETED
- ✅ **Enhanced Error Reporting** - COMPLETED  
- 🔧 **HPACK/lshpack Compatibility** - IN PROGRESS (Node.js interop issue)
- ⏳ **Phase 2: Streaming Decompression** - PENDING
- ⏳ **Phase 3: Flow Control** - PENDING
- ⏳ **Phase 4: Protocol Compliance** - PENDING
- ⏳ **Phase 5: Testing & Validation** - PENDING

## Current State Summary

### Completed Fixes ✅
1. **Response callback invocation** - HTTP/2 responses now properly call the result callback when complete
2. **State management** - All state fields (`stage`, `response_stage`, `request_stage`) properly transition to `.done`
3. **CONTINUATION frame support** - Added full support for header blocks spanning multiple frames
4. **Enhanced error reporting** - HPACK errors now provide specific error codes instead of generic failures
5. **Header block accumulation** - Properly accumulates and processes header data across frames

### Remaining Issues 🔧
1. **HPACK/lshpack compatibility** - The lshpack library is failing to decode headers from Node.js HTTP/2 servers (error at offset 10)
2. **No decompression support** - Compressed responses aren't handled correctly with HTTP/2's frame-based protocol
3. **No flow control** - Missing WINDOW_UPDATE frames for flow control
4. **Limited testing** - Need comprehensive tests beyond Node.js interop

## Root Cause Analysis

### Primary Issue: Missing Callback
When an HTTP/2 response completes (END_STREAM flag received), the code:
- Sets `state.response_stage = .done` 
- Calls `handleResponseMetadata()` which returns a status
- **Never calls the result callback** to notify fetch that the response is complete

### Secondary Issues
1. **State Management**: `state.stage` is never set to `.done`, only `response_stage`
2. **Body Assembly**: Response body is processed but not properly assembled for the callback
3. **Decompression**: Each DATA frame is processed independently, breaking decompression state

## Implementation Phases

### Phase 1: Fix Response Completion [COMPLETED ✅]
**Goal**: Make basic HTTP/2 GET requests work end-to-end

#### 1.1 Fix Callback Invocation ✅
- **Status**: COMPLETED
- **Location**: `src/http.zig` lines 790-811 and 952-972
- **Implementation**: Added callback invocation when END_STREAM flag is received:
  ```zig
  // Set all state flags
  this.state.response_stage = .done;
  this.state.request_stage = .done;
  this.state.stage = .done;
  
  // Invoke the callback
  const callback = this.result_callback;
  const result = this.toResult();
  callback.run(@fieldParentPtr("client", this), result);
  ```

#### 1.2 Fix Response Body Assembly ✅
- **Status**: COMPLETED
- **Implementation**: Response body is properly assembled via `toResult()` method

#### 1.3 Fix State Transitions ✅
- **Status**: COMPLETED
- **Implementation**: Both `stage` and `response_stage` are now properly set to `.done`
- All three state fields are updated: `response_stage`, `request_stage`, and `stage`

### HPACK Decoder & CONTINUATION Frames [COMPLETED ✅]
**Discovery**: During Phase 1 testing, found critical issues with HPACK decoder

#### Issues Fixed
1. **Missing CONTINUATION Frame Support** ✅
   - **Root Cause**: HTTP/2 implementation was missing support for CONTINUATION frames
   - **Impact**: Headers spanning multiple frames couldn't be processed
   - **Fix**: Added full CONTINUATION frame support with header block accumulation

2. **Poor Error Reporting** ✅
   - **Issue**: Generic `UnableToDecode` errors made debugging difficult
   - **Fix**: Added specific error types: `BadHPACKData`, `HPACKHeaderTooLarge`, `HPACKNeedMoreBuffer`

3. **Improper Header Block Processing** ✅
   - **Issue**: Headers were decoded immediately instead of waiting for complete block
   - **Fix**: Now accumulates header data until END_HEADERS flag is received

#### Implementation Details
- **New State Fields**: Added `http2_header_block_buffer`, `http2_header_block_len`, `http2_expecting_continuation`
- **New Methods**: `accumulateHeaderBlock()`, `getCompleteHeaderBlock()`, `clearHeaderBlock()`
- **Frame Type 0x09**: Full CONTINUATION frame handling implemented
- **Files Modified**: 
  - `src/http.zig` - Added CONTINUATION support and header accumulation
  - `src/bun.js/api/bun/lshpack.zig` - Enhanced error reporting
  - `src/bun.js/bindings/c-bindings.cpp` - Fixed error code handling

### Phase 2: Fix Streaming Decompression [HIGH PRIORITY]
**Goal**: Support gzip, deflate, brotli, and zstd with HTTP/2

#### 2.1 Initialize Decompression State
```zig
// In HEADERS frame processing
if (strings.eqlComptime(header.name, "content-encoding")) {
    if (strings.eqlComptime(header.value, "gzip")) {
        this.state.encoding = .gzip;
        // Initialize decompressor for streaming
        this.state.decompressor = .{ .gzip = ... };
    } else if (strings.eqlComptime(header.value, "deflate")) {
        // ... similar for other encodings
    }
}
```

#### 2.2 Accumulate Compressed Data
```zig
// In DATA frame processing
if (this.state.encoding.isCompressed()) {
    // Accumulate compressed data across frames
    try this.state.compressed_body.appendSlice(data_payload);
    
    const should_decompress = end_stream or 
        this.state.compressed_body.list.items.len > 32 * 1024; // 32KB threshold
    
    if (should_decompress) {
        try this.state.decompressBytes(
            this.state.compressed_body.list.items,
            this.state.body_out_str.?,
            end_stream // is_final_chunk
        );
        if (!end_stream) {
            this.state.compressed_body.reset();
        }
    }
} else {
    // Uncompressed - append directly
    try this.state.body_out_str.?.appendSlice(data_payload);
}
```

#### 2.3 Maintain Decompressor State
- Keep decompressor alive between DATA frames
- Only reset decompressor when stream ends
- Handle partial decompression for streaming responses

### Phase 3: Add Flow Control [MEDIUM PRIORITY]
**Goal**: Handle large responses and backpressure

#### 3.1 Track Flow Control Windows
```zig
// Add to HTTPClient
http2_stream_window: i32 = 65535,  // Per-stream window
http2_connection_window: i32 = 65535,  // Connection window
```

#### 3.2 Send WINDOW_UPDATE Frames
```zig
// After consuming DATA frame
fn sendWindowUpdate(this: *HTTPClient, stream_id: u32, increment: u32) !void {
    var frame: [13]u8 = undefined;
    // Frame header (9 bytes)
    frame[0..3] = @bitCast([3]u8, @as(u24, 4)); // Length = 4
    frame[3] = 0x08; // Type = WINDOW_UPDATE
    frame[4] = 0x00; // Flags = 0
    frame[5..9] = @bitCast([4]u8, stream_id);
    // Window increment (4 bytes)
    frame[9..13] = @bitCast([4]u8, increment);
    
    _ = try socket.write(frame);
}

// In DATA frame processing
if (data_payload.len > 0) {
    // Send WINDOW_UPDATE for consumed bytes
    try this.sendWindowUpdate(stream_id, @intCast(data_payload.len));
    try this.sendWindowUpdate(0, @intCast(data_payload.len)); // Connection window
}
```

#### 3.3 Handle Flow Control Errors
- Check if DATA frame exceeds window
- Send FLOW_CONTROL_ERROR if violated
- Block sending if window exhausted

### Phase 4: Protocol Compliance [LOW PRIORITY]
**Goal**: Full HTTP/2 specification compliance

#### 4.1 PING/PONG Frames
```zig
0x06 => { // PING frame
    if ((frame_flags & 0x01) == 0) { // Not ACK
        // Send PONG with same payload
        try this.sendPong(frame_payload);
    }
}
```

#### 4.2 GOAWAY Frame
```zig
0x07 => { // GOAWAY frame
    const last_stream_id = @bitCast(u32, frame_payload[0..4].*);
    const error_code = @bitCast(u32, frame_payload[4..8].*);
    log("Received GOAWAY: last_stream={}, error={}", .{last_stream_id, error_code});
    this.closeAndFail(error.HTTP2GoAway, is_ssl, socket);
}
```

#### 4.3 RST_STREAM Frame
```zig
0x03 => { // RST_STREAM frame
    const error_code = @bitCast(u32, frame_payload[0..4].*);
    log("Stream {} reset with error {}", .{stream_id, error_code});
    this.state.response_stage = .fail;
    this.closeAndFail(error.HTTP2StreamReset, is_ssl, socket);
}
```

### Phase 5: Testing & Validation
**Goal**: Ensure reliability and correctness

#### 5.1 Basic Tests
- GET request to HTTP/2 server
- POST request with body
- Large response (>1MB)
- Compressed response (gzip, brotli)

#### 5.2 Error Tests
- Server sends RST_STREAM
- Server sends GOAWAY
- Invalid HEADERS
- Flow control violation

#### 5.3 Performance Tests
- Concurrent streams
- Large file downloads
- Streaming responses

## Success Criteria

1. **Basic Functionality**: `fetch()` with HTTP/2 returns response without hanging
2. **Decompression**: Compressed responses are properly decompressed
3. **Flow Control**: Large responses (>64KB) work correctly
4. **Error Handling**: Protocol errors are properly reported
5. **Tests Pass**: All HTTP/2 tests in test suite pass

## Implementation Order

1. ✅ **Fix callback invocation** (Phase 1.1) - COMPLETED
2. ✅ **Fix body assembly** (Phase 1.2) - COMPLETED
3. ✅ **Fix state management** (Phase 1.3) - COMPLETED
4. ✅ **Add CONTINUATION frame support** - COMPLETED
5. 🔧 **Fix HPACK/lshpack compatibility** - IN PROGRESS
6. ⏳ **Add decompression** (Phase 2) - PENDING
7. ⏳ **Add flow control** (Phase 3) - PENDING
8. ⏳ **Add protocol compliance** (Phase 4) - PENDING

## Files Modified

### Already Changed ✅
1. **src/http.zig**
   - ✅ Added callback invocation in `handleHTTP2Data()` for END_STREAM
   - ✅ Fixed state transitions to set all state fields to `.done`
   - ✅ Added CONTINUATION frame support (frame type 0x09)
   - ✅ Added header block accumulation methods
   - ✅ Enhanced debug logging for HTTP/2 frames

2. **src/bun.js/api/bun/lshpack.zig**
   - ✅ Added specific error types for HPACK failures
   - ✅ Enhanced error reporting from C++ wrapper

3. **src/bun.js/bindings/c-bindings.cpp**
   - ✅ Modified to return specific error codes for HPACK failures

### Still Need Changes 🔧
1. **src/http.zig**
   - Fix HPACK/lshpack compatibility issue
   - Add `sendWindowUpdate()` for flow control
   - Add decompression state management for HTTP/2

2. **src/http/InternalState.zig**
   - Add HTTP/2-specific decompression handling
   - Fix decompression for frame-based protocol

## Risks and Mitigations

1. **Risk**: Breaking HTTP/1.1 functionality
   - **Mitigation**: Keep HTTP/2 code paths separate, test HTTP/1.1 thoroughly

2. **Risk**: Memory leaks from incomplete streams
   - **Mitigation**: Proper cleanup in error paths, test with valgrind

3. **Risk**: Decompression state corruption
   - **Mitigation**: Reset decompressor on stream errors, validate compressed data

## Timeline Estimate

- Phase 1: 2-3 hours (critical path)
- Phase 2: 3-4 hours (decompression complexity)
- Phase 3: 2-3 hours (flow control)
- Phase 4: 2-3 hours (protocol details)
- Phase 5: 2-3 hours (testing)

**Total: 11-16 hours of focused development**

## Next Steps

1. Start with Phase 1.1 - Fix callback invocation
2. Test with simple HTTP/2 server
3. Iterate through phases based on test results
4. Create regression tests for each fix