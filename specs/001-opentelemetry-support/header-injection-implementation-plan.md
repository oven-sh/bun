# Implementation Plan: Header Injection for Context Propagation

**Related Spec**: [contracts/header-injection.md](./contracts/header-injection.md)
**Status**: Ready for Implementation
**Estimated Effort**: 2-3 days

---

## Executive Summary

Currently, `onOperationInject` hooks return header values, but these are **never actually set** on HTTP responses or fetch requests. This plan implements the missing infrastructure to:

1. Cache header configuration when instruments attach/detach
2. Inject response headers in HTTP server (`server.zig`)
3. Inject request headers in fetch client (`fetch.zig`)
4. Validate security constraints (blocked headers, value limits)

**Performance Target**: <5ns overhead when disabled, <200ns when enabled

---

## Implementation Phases

### Phase 1: Configuration Infrastructure (Day 1)

#### Task 1.1: Add InjectConfig Struct

**File**: `src/telemetry/main.zig`

**Add struct definition**:
```zig
/// Cached list of header keys to inject for a specific instrument kind
pub const InjectConfig = struct {
    /// Request headers (for fetch client)
    request_headers: std.ArrayList([]const u8),

    /// Response headers (for HTTP server)
    response_headers: std.ArrayList([]const u8),

    /// Allocator for header string storage
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) InjectConfig {
        return .{
            .request_headers = std.ArrayList([]const u8).init(allocator),
            .response_headers = std.ArrayList([]const u8).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *InjectConfig) void {
        // Free all header strings
        for (self.request_headers.items) |header| {
            self.allocator.free(header);
        }
        for (self.response_headers.items) |header| {
            self.allocator.free(header);
        }
        self.request_headers.deinit();
        self.response_headers.deinit();
    }

    pub fn clear(self: *InjectConfig) void {
        for (self.request_headers.items) |header| {
            self.allocator.free(header);
        }
        for (self.response_headers.items) |header| {
            self.allocator.free(header);
        }
        self.request_headers.clearRetainingCapacity();
        self.response_headers.clearRetainingCapacity();
    }
};
```

#### Task 1.2: Add Configuration Array to Telemetry

**File**: `src/telemetry/main.zig`

**Modify `Telemetry` struct**:
```zig
pub const Telemetry = struct {
    // Existing fields
    instrument_table: [InstrumentKind.COUNT]std.ArrayList(InstrumentRecord),
    next_instrument_id: std.atomic.Value(u32),
    next_request_id: std.atomic.Value(u64),
    allocator: std.mem.Allocator,
    global: *JSGlobalObject,

    // NEW: Cached inject configuration per kind
    inject_configs: [InstrumentKind.COUNT]InjectConfig,

    // ...
};
```

**Update `init()` and `deinit()`**:
```zig
pub fn init(allocator: std.mem.Allocator, global: *JSGlobalObject) !*Telemetry {
    const self = try allocator.create(Telemetry);

    var instrument_table: [InstrumentKind.COUNT]std.ArrayList(InstrumentRecord) = undefined;
    for (&instrument_table) |*list| {
        list.* = std.ArrayList(InstrumentRecord).init(allocator);
    }

    // NEW: Initialize inject configs
    var inject_configs: [InstrumentKind.COUNT]InjectConfig = undefined;
    for (&inject_configs) |*config| {
        config.* = InjectConfig.init(allocator);
    }

    self.* = Telemetry{
        .instrument_table = instrument_table,
        .inject_configs = inject_configs,
        .next_instrument_id = std.atomic.Value(u32).init(1),
        .next_request_id = std.atomic.Value(u64).init(1),
        .allocator = allocator,
        .global = global,
    };

    return self;
}

pub fn deinit(self: *Telemetry) void {
    for (&self.instrument_table) |*list| {
        for (list.items) |*record| {
            record.dispose();
        }
        list.deinit();
    }

    // NEW: Clean up inject configs
    for (&self.inject_configs) |*config| {
        config.deinit();
    }

    self.allocator.destroy(self);
}
```

#### Task 1.3: Add InjectHeaders Fields to InstrumentRecord

**File**: `src/telemetry/main.zig`

**Modify `InstrumentRecord` struct**:
```zig
pub const InstrumentRecord = struct {
    id: u32,
    kind: InstrumentKind,
    native_instrument_object: JSValue,
    on_op_start_fn: JSValue,
    on_op_progress_fn: JSValue,
    on_op_end_fn: JSValue,
    on_op_error_fn: JSValue,
    on_op_inject_fn: JSValue,

    // NEW: Cached inject header configuration
    inject_request_headers: ?JSValue,  // Array of header names or null
    inject_response_headers: ?JSValue, // Array of header names or null

    pub fn init(
        id: u32,
        kind: InstrumentKind,
        instrument_obj: JSValue,
        global: *JSGlobalObject,
    ) !InstrumentRecord {
        // Existing validation...
        const on_op_start = try instrument_obj.get(global, "onOperationStart") orelse .js_undefined;
        // ... other hooks ...

        // NEW: Extract inject header configuration
        const inject_headers = try instrument_obj.get(global, "injectHeaders") orelse .js_undefined;
        var inject_request_headers: ?JSValue = null;
        var inject_response_headers: ?JSValue = null;

        if (inject_headers.isObject()) {
            const request = try inject_headers.get(global, "request") orelse .js_undefined;
            if (request.isArray(global)) {
                inject_request_headers = request;
                inject_request_headers.?.protect();
            }

            const response = try inject_headers.get(global, "response") orelse .js_undefined;
            if (response.isArray(global)) {
                inject_response_headers = response;
                inject_response_headers.?.protect();
            }
        }

        instrument_obj.protect();

        return InstrumentRecord{
            .id = id,
            .kind = kind,
            .native_instrument_object = instrument_obj,
            .on_op_start_fn = on_op_start,
            .on_op_progress_fn = on_op_progress,
            .on_op_end_fn = on_op_end,
            .on_op_error_fn = on_op_error,
            .on_op_inject_fn = on_op_inject,
            .inject_request_headers = inject_request_headers,
            .inject_response_headers = inject_response_headers,
        };
    }

    pub fn dispose(self: *InstrumentRecord) void {
        self.native_instrument_object.unprotect();

        // NEW: Unprotect inject header arrays
        if (self.inject_request_headers) |headers| {
            headers.unprotect();
        }
        if (self.inject_response_headers) |headers| {
            headers.unprotect();
        }
    }
};
```

#### Task 1.4: Implement rebuildInjectConfig()

**File**: `src/telemetry/main.zig`

**Add to `Telemetry` impl**:
```zig
/// Rebuild inject configuration for a specific kind
/// Called after attach/detach to update cached header list
/// NOTE: Allows duplicates - simpler implementation, defers merge to Headers API
fn rebuildInjectConfig(self: *Telemetry, kind: InstrumentKind) !void {
    const kind_index = @intFromEnum(kind);
    var config = &self.inject_configs[kind_index];

    // Clear existing configuration
    config.clear();

    // Linearly concatenate headers from all instruments
    // DUPLICATES ALLOWED - edge case, will be handled by Headers.set()
    for (self.instrument_table[kind_index].items) |*record| {
        // Process request headers (for fetch client)
        if (record.inject_request_headers) |headers| {
            const len = headers.getLength(self.global);
            var i: u32 = 0;
            while (i < len) : (i += 1) {
                const header = headers.getIndex(self.global, i);
                if (!header.isString()) continue;

                const header_str = header.toString(self.global).toSlice(self.global);
                const owned = try self.allocator.dupe(u8, header_str);

                // APPEND even if duplicate exists
                try config.request_headers.append(owned);
            }
        }

        // Process response headers (for HTTP server)
        if (record.inject_response_headers) |headers| {
            const len = headers.getLength(self.global);
            var i: u32 = 0;
            while (i < len) : (i += 1) {
                const header = headers.getIndex(self.global, i);
                if (!header.isString()) continue;

                const header_str = header.toString(self.global).toSlice(self.global);
                const owned = try self.allocator.dupe(u8, header_str);

                // APPEND even if duplicate exists
                try config.response_headers.append(owned);
            }
        }
    }

    // Result: Arrays may contain duplicate keys (e.g., ["traceparent", "x-custom", "traceparent"])
    // This is OK - Headers.set() will be called multiple times, last call wins
}
```

#### Task 1.5: Call rebuildInjectConfig() on Attach/Detach

**File**: `src/telemetry/main.zig`

**Update `attach()`**:
```zig
pub fn attach(self: *Telemetry, instrument_obj: JSValue) !u32 {
    // ... existing attach logic ...

    // Add instrument to table
    try instruments.append(record);

    // NEW: Rebuild inject configuration
    try self.rebuildInjectConfig(kind);

    return instrument_id;
}
```

**Update `detach()`**:
```zig
pub fn detach(self: *Telemetry, instrument_id: u32) !void {
    // ... existing detach logic ...

    // Remove instrument from table
    _ = instruments.swapRemove(found_index);

    // NEW: Rebuild inject configuration
    try self.rebuildInjectConfig(kind);
}
```

#### Task 1.6: Add Test for Configuration Caching

**File**: `test/js/bun/telemetry/header-injection-config.test.ts`

```typescript
import { describe, expect, test } from "bun:test";

describe("header injection configuration", () => {
  test("inject config rebuilt on attach/detach", () => {
    const id1 = Bun.telemetry.attach({
      type: 1, // HTTP
      name: "instrument-1",
      version: "1.0.0",
      injectHeaders: { response: ["traceparent"] },
      onOperationInject: () => ({ traceparent: "value" }),
    });

    const config1 = Bun.telemetry.nativeHooks.getInjectHeaders(1); // HTTP
    expect(config1).not.toBeNull();
    expect(config1.response).toContain("traceparent");

    const id2 = Bun.telemetry.attach({
      type: 1, // HTTP
      name: "instrument-2",
      version: "1.0.0",
      injectHeaders: { response: ["tracestate"] },
      onOperationInject: () => ({ tracestate: "value" }),
    });

    const config2 = Bun.telemetry.nativeHooks.getInjectHeaders(1);
    expect(config2.response).toContain("traceparent");
    expect(config2.response).toContain("tracestate");

    Bun.telemetry.detach(id1);

    const config3 = Bun.telemetry.nativeHooks.getInjectHeaders(1);
    expect(config3.response).toContain("tracestate");
    expect(config3.response).not.toContain("traceparent");

    Bun.telemetry.detach(id2);
  });
});
```

**Run tests**:
```bash
bun bd test test/js/bun/telemetry/header-injection-config.test.ts
```

---

### Phase 2: HTTP Server Integration (Day 2)

#### Task 2.1: Add Helper to Get Inject Config

**File**: `src/telemetry/main.zig`

```zig
/// Get inject configuration for a specific kind
/// Returns null if no instruments inject headers for this kind
pub fn getInjectConfig(self: *Telemetry, kind: InstrumentKind) ?*const InjectConfig {
    const kind_index = @intFromEnum(kind);
    const config = &self.inject_configs[kind_index];

    if (config.request_headers.items.len == 0 and config.response_headers.items.len == 0) {
        return null;
    }

    return config;
}
```

#### Task 2.2: Inject Headers in server.zig

**File**: `src/bun.js/api/server.zig`

**Find response finalization point** (where headers are set before sending):

```zig
// In handleResponse() or finalizeResponse() or similar
// AFTER response is created, BEFORE sending to client

const telemetry = Telemetry.getGlobalTelemetry() orelse {
    // No telemetry, continue normal flow
    return;
};

if (telemetry.getInjectConfig(.http)) |config| {
    if (config.response_headers.items.len > 0 and this.telemetry_request_id != 0) {
        // Call notifyInject to get header values
        const injected = telemetry.notifyInject(.http, this.telemetry_request_id, .js_undefined);

        if (injected.isObject()) {
            // Inject configured headers into response
            for (config.response_headers.items) |header_key| {
                const header_value = injected.get(globalThis, header_key) orelse continue;
                if (!header_value.isString()) continue;

                // Convert header key/value to proper format
                const key_str = bun.String.createUTF8(header_key);
                const value_str = header_value.toBunString(globalThis);

                // Set response header (specific method depends on response object)
                response.headers.append(key_str, value_str);
            }
        }
    }
}
```

**Note**: Exact integration point depends on server.zig structure. Need to find where response headers are set.

#### Task 2.3: Add Test for HTTP Server Header Injection

**File**: `test/js/bun/telemetry/http-server-header-injection.test.ts`

```typescript
import { describe, expect, test } from "bun:test";

describe("HTTP server header injection", () => {
  test("injects response headers from instrument", async () => {
    const instrument = {
      type: 1, // HTTP
      name: "test-inject",
      version: "1.0.0",
      injectHeaders: { response: ["traceparent", "tracestate"] },
      onOperationStart() {},
      onOperationInject(id: number, data: any) {
        return {
          traceparent: "00-trace-id-span-id-01",
          tracestate: "vendor=value",
        };
      },
    };

    const id = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });

    const response = await fetch(`http://localhost:${server.port}`);

    expect(response.headers.get("traceparent")).toBe("00-trace-id-span-id-01");
    expect(response.headers.get("tracestate")).toBe("vendor=value");

    Bun.telemetry.detach(id);
  });

  test("only injects declared headers", async () => {
    const instrument = {
      type: 1, // HTTP
      name: "test-inject",
      version: "1.0.0",
      injectHeaders: { response: ["traceparent"] }, // Only traceparent
      onOperationStart() {},
      onOperationInject(id: number) {
        return {
          traceparent: "00-trace-id-span-id-01",
          tracestate: "should-be-ignored", // Not in injectHeaders
        };
      },
    };

    const id = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });

    const response = await fetch(`http://localhost:${server.port}`);

    expect(response.headers.get("traceparent")).toBe("00-trace-id-span-id-01");
    expect(response.headers.has("tracestate")).toBe(false); // Should not be injected

    Bun.telemetry.detach(id);
  });
});
```

---

### Phase 3: Fetch Client Integration (Day 2-3)

#### Task 3.1: Find Fetch Request Preparation Point

**File**: `src/bun.js/webcore/fetch.zig`

**Locate**: FetchTasklet.queue() or similar - where request headers are set before HTTP request

#### Task 3.2: Inject Headers Before Fetch Request

**File**: `src/bun.js/webcore/fetch.zig`

```zig
// In FetchTasklet.queue() or similar
// BEFORE scheduling HTTP request

const telemetry = Telemetry.getGlobalTelemetry() orelse {
    // No telemetry, continue normal flow
    return;
};

if (telemetry.getInjectConfig(.fetch)) |config| {
    if (config.request_headers.items.len > 0 and this.telemetry_request_id != 0) {
        // Call notifyInject to get header values
        const injected = telemetry.notifyInject(.fetch, this.telemetry_request_id, .js_undefined);

        if (injected.isObject()) {
            // Inject configured headers into request
            for (config.request_headers.items) |header_key| {
                const header_value = injected.get(globalThis, header_key) orelse continue;
                if (!header_value.isString()) continue;

                // Convert to appropriate format for fetch headers
                const key_str = bun.String.createUTF8(header_key);
                const value_str = header_value.toBunString(globalThis);

                // Set request header (method depends on fetch implementation)
                this.request_headers.append(key_str, value_str);
            }
        }
    }
}
```

#### Task 3.3: Add Test for Fetch Client Header Injection

**File**: `test/js/bun/telemetry/fetch-client-header-injection.test.ts`

```typescript
import { describe, expect, test } from "bun:test";

describe("fetch client header injection", () => {
  test("injects request headers from instrument", async () => {
    let capturedHeaders: Record<string, string> = {};

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        capturedHeaders = {};
        req.headers.forEach((value, key) => {
          capturedHeaders[key] = value;
        });
        return new Response("ok");
      },
    });

    const instrument = {
      type: 2, // Fetch
      name: "test-inject",
      version: "1.0.0",
      injectHeaders: { request: ["traceparent", "tracestate"] },
      onOperationStart() {},
      onOperationInject(id: number) {
        return {
          traceparent: "00-fetch-trace-id-span-id-01",
          tracestate: "vendor=fetch",
        };
      },
    };

    const id = Bun.telemetry.attach(instrument);

    await fetch(`http://localhost:${server.port}`);

    expect(capturedHeaders.traceparent).toBe("00-fetch-trace-id-span-id-01");
    expect(capturedHeaders.tracestate).toBe("vendor=fetch");

    Bun.telemetry.detach(id);
  });
});
```

---

### Phase 4: Security Validation (Day 3)

#### Task 4.1: Add Blocked Header Validation

**File**: `src/telemetry/main.zig`

```zig
const BLOCKED_INJECT_HEADERS = [_][]const u8{
    "authorization",
    "cookie",
    "set-cookie",
    "www-authenticate",
    "proxy-authorization",
    "proxy-authenticate",
};

fn validateInjectHeaders(global: *JSGlobalObject, headers: JSValue) !void {
    if (!headers.isArray(global)) return;

    const len = headers.getLength(global);
    var i: u32 = 0;
    while (i < len) : (i += 1) {
        const header = headers.getIndex(global, i);
        if (!header.isString()) continue;

        const header_str = header.toString(global).toSlice(global);

        // Check against blocklist
        for (BLOCKED_INJECT_HEADERS) |blocked| {
            if (std.mem.eql(u8, header_str, blocked)) {
                return error.BlockedHeaderInjection;
            }
        }

        // Validate format: lowercase alphanumeric + hyphens
        for (header_str) |c| {
            if (!std.ascii.isAlphanumeric(c) and c != '-') {
                return error.InvalidHeaderName;
            }
        }
    }

    // Check count limit
    if (len > 20) {
        return error.TooManyInjectHeaders;
    }
}
```

**Call in `InstrumentRecord.init()`**:
```zig
if (inject_headers.isObject()) {
    const request = try inject_headers.get(global, "request") orelse .js_undefined;
    if (request.isArray(global)) {
        try validateInjectHeaders(global, request); // NEW
        inject_request_headers = request;
        inject_request_headers.?.protect();
    }

    const response = try inject_headers.get(global, "response") orelse .js_undefined;
    if (response.isArray(global)) {
        try validateInjectHeaders(global, response); // NEW
        inject_response_headers = response;
        inject_response_headers.?.protect();
    }
}
```

#### Task 4.2: Add Security Tests

**File**: `test/js/bun/telemetry/header-injection-security.test.ts`

```typescript
import { describe, expect, test } from "bun:test";

describe("header injection security", () => {
  test("rejects blocked header: authorization", () => {
    expect(() => {
      Bun.telemetry.attach({
        type: 1,
        name: "malicious",
        version: "1.0.0",
        injectHeaders: { response: ["authorization"] },
        onOperationInject: () => ({ authorization: "Bearer hacked" }),
      });
    }).toThrow(/blocked/i);
  });

  test("rejects blocked header: cookie", () => {
    expect(() => {
      Bun.telemetry.attach({
        type: 1,
        name: "malicious",
        version: "1.0.0",
        injectHeaders: { response: ["cookie"] },
        onOperationInject: () => ({ cookie: "session=hacked" }),
      });
    }).toThrow(/blocked/i);
  });

  test("rejects too many headers", () => {
    const headers = Array.from({ length: 21 }, (_, i) => `header-${i}`);

    expect(() => {
      Bun.telemetry.attach({
        type: 1,
        name: "excessive",
        version: "1.0.0",
        injectHeaders: { response: headers },
        onOperationInject: () => ({}),
      });
    }).toThrow(/too many/i);
  });

  test("rejects invalid header names", () => {
    expect(() => {
      Bun.telemetry.attach({
        type: 1,
        name: "invalid",
        version: "1.0.0",
        injectHeaders: { response: ["Invalid-Header-Name"] }, // Uppercase invalid
        onOperationInject: () => ({}),
      });
    }).toThrow(/invalid/i);
  });
});
```

---

## Testing Strategy

### Unit Tests
- ✅ Configuration caching (rebuild on attach/detach)
- ✅ HTTP server header injection
- ✅ Fetch client header injection
- ✅ Security validation (blocked headers, limits)
- ✅ Header value filtering (only declared headers injected)

### Integration Tests
- End-to-end distributed tracing (HTTP server → fetch → HTTP server)
- W3C trace context propagation
- Multiple instruments with overlapping headers

### Performance Tests
- Benchmark overhead when disabled (<5ns)
- Benchmark overhead when enabled (<200ns)
- Memory usage with many instruments

---

## Completion Criteria

### Must Have
- ✅ Configuration rebuilt on attach/detach
- ✅ HTTP server injects response headers
- ✅ Fetch client injects request headers
- ✅ Blocked headers rejected at attach time
- ✅ All tests passing

### Should Have
- ✅ Header count limits enforced
- ✅ Header name validation (lowercase, alphanumeric + hyphens)
- ✅ Documentation updated

### Could Have (Future)
- ⏭ Support for baggage header
- ⏭ Support for B3 propagation format
- ⏭ Custom header extraction from incoming requests

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Integration point unclear in server.zig | High | Review existing server code, find response finalization |
| Integration point unclear in fetch.zig | High | Review fetch implementation, find request header setting |
| Header injection breaks existing tests | Medium | Run full test suite after each phase |
| Performance regression | Medium | Benchmark before/after, ensure <5ns when disabled |

---

## Timeline

- **Day 1**: Phase 1 (Configuration Infrastructure)
- **Day 2**: Phase 2 (HTTP Server) + start Phase 3 (Fetch Client)
- **Day 3**: Complete Phase 3 + Phase 4 (Security)

**Total**: 2-3 days
