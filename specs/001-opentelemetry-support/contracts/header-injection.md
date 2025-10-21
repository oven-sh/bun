# Contract: Header Injection for Context Propagation

**Feature**: OpenTelemetry Support for Bun
**Component**: Distributed Tracing - Context Propagation via HTTP Headers
**Scope**: W3C Trace Context and vendor-specific header injection
**Audience**: Bun runtime implementers

**Related Contracts**:
- [bun-telemetry-api.md](./bun-telemetry-api.md) - Core attach/detach API
- [hook-lifecycle.md](./hook-lifecycle.md) - Hook specifications and attributes

---

## Problem Statement

**Context**: Distributed tracing requires propagating trace context across service boundaries via HTTP headers (W3C traceparent, tracestate, vendor-specific headers).

**Current Gap**:
- `onOperationInject` hook exists and returns `Record<string, string>`
- `notifyInject()` collects and merges results from all instruments
- **BUT**: No mechanism to actually SET these headers on HTTP responses or fetch requests
- **AND**: No way to configure WHICH header keys to inject per instrument kind

**Requirements**:
1. Instruments must declare which header keys they will inject (e.g., `["traceparent", "tracestate"]`)
2. Runtime must cache this list when instruments are attached/detached (avoid per-request overhead)
3. HTTP server must inject returned headers into responses
4. Fetch client must inject returned headers into requests
5. Header injection must be O(1) check when disabled, <50ns overhead when enabled

---

## Header Configuration: Linear Concatenation (Simplified)

### Multiple Instruments Declaring Same Header Key

**Problem**: When multiple instruments declare the same header key in `injectHeaders` (e.g., both declare `["traceparent"]`), we need a simple strategy.

**Policy**: **Linear Concatenation - Duplicates Allowed**

**Implementation**:
```zig
// In rebuildInjectConfig() - ALLOW duplicates
for (self.instrument_table[kind_index].items) |*record| {
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
```

**Result**: Header name array may contain duplicates:
```
Keys: ["traceparent", "x-custom", "traceparent", "tracestate"]
```

**At Injection Time**:
```zig
// In server.zig or fetch.zig
for (config.response_headers.items) |header_key| {
    const header_value = injected.get(global, header_key) orelse continue;

    // Call headers.set() or headers.append() for EACH key (even duplicates)
    response.headers.set(header_key, header_value);
}
```

**Behavior with Duplicates**:
- If key appears twice: `headers.set()` called twice
- HTTP Headers implementation decides:
  - `set()`: Last call wins (overwrites previous)
  - `append()`: Creates multiple header instances (HTTP spec allows for some headers)

**Example**:
```typescript
// Instrument 1: declares ["traceparent", "x-custom"]
const id1 = Bun.telemetry.attach({
  type: InstrumentKind.HTTP,
  injectHeaders: { response: ["traceparent", "x-custom"] },
  onOperationInject: () => ({ traceparent: "trace-1", "x-custom": "value-1" }),
});

// Instrument 2: declares ["traceparent", "tracestate"] (traceparent duplicated!)
const id2 = Bun.telemetry.attach({
  type: InstrumentKind.HTTP,
  injectHeaders: { response: ["traceparent", "tracestate"] },
  onOperationInject: () => ({ traceparent: "trace-2", tracestate: "state-2" }),
});

// Config arrays after attach:
// Keys: ["traceparent", "x-custom", "traceparent", "tracestate"]

// At request time:
// headers.set("traceparent", "trace-1")  // From instrument 1
// headers.set("x-custom", "value-1")      // From instrument 1
// headers.set("traceparent", "trace-2")  // From instrument 2 - OVERWRITES trace-1
// headers.set("tracestate", "state-2")    // From instrument 2

// Final result: traceparent="trace-2" (last set() wins)
```

**Rationale**:
1. **Simplest Implementation**: No deduplication logic needed at config build time
2. **Defers Merge Logic**: Let Headers API handle duplicates per HTTP spec
3. **Edge Case**: Multiple instruments declaring same header is rare in practice
4. **Future Optimization**: Can add deduplication later if needed (profile first)

**Limitations**:
- Config arrays may have duplicate keys (minor memory overhead)
- Multiple `set()` calls at injection time (minor performance overhead)
- Both overheads negligible for typical case (2-5 headers total)

**Future Enhancement** (if profiling shows it matters):
- Deduplicate keys during `rebuildInjectConfig()` using a set
- For now: YAGNI - duplicates are fine

---

## API Surface

### 1. Instrument Configuration Extension

**Add to `NativeInstrument` interface**:

```typescript
interface NativeInstrument {
  type: InstrumentKind;
  name: string;
  version: string;

  // NEW: Declare header keys this instrument will inject
  injectHeaders?: {
    request?: string[];  // Headers to inject into outgoing requests (fetch)
    response?: string[]; // Headers to inject into outgoing responses (HTTP server)
  };

  // Existing hooks...
  onOperationInject?: (id: number, data?: unknown) => Record<string, string> | void;
}
```

**Example Usage**:
```typescript
const instrument = {
  type: InstrumentKind.HTTP,
  name: "@opentelemetry/instrumentation-http",
  version: "0.1.0",

  // Declare which headers this instrument will inject
  injectHeaders: {
    response: ["traceparent", "tracestate"], // HTTP server responses
  },

  onOperationInject(id, data) {
    // Return header values to inject
    return {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor1=value1,vendor2=value2"
    };
  },
};
```

**Validation Rules**:
1. `injectHeaders.request` must be array of lowercase strings (max 20 headers)
2. `injectHeaders.response` must be array of lowercase strings (max 20 headers)
3. Header names must match `/^[a-z0-9-]+$/` (lowercase alphanumeric + hyphens)
4. Blocked headers rejected at attach time: `authorization`, `cookie`, `set-cookie`, `www-authenticate`
5. Keys in `onOperationInject` return value MUST match declared `injectHeaders` (extra keys ignored)

---

### 2. Cached Header Configuration

**Internal Data Structure** (Zig `telemetry.zig`):

```zig
/// Cached list of header keys to inject for a specific instrument kind
pub const InjectConfig = struct {
    /// Request headers (for fetch client)
    request_headers: []const []const u8,  // e.g., ["traceparent", "tracestate"]

    /// Response headers (for HTTP server)
    response_headers: []const []const u8,  // e.g., ["traceparent", "tracestate"]

    /// Total number of instruments that inject headers for this kind
    instrument_count: u32,

    pub fn init(allocator: std.mem.Allocator) InjectConfig {
        return .{
            .request_headers = &.{},
            .response_headers = &.{},
            .instrument_count = 0,
        };
    }

    pub fn deinit(self: *InjectConfig, allocator: std.mem.Allocator) void {
        // Free allocated string slices
        for (self.request_headers) |header| allocator.free(header);
        for (self.response_headers) |header| allocator.free(header);
        allocator.free(self.request_headers);
        allocator.free(self.response_headers);
    }
};
```

**Add to `Telemetry` struct**:

```zig
pub const Telemetry = struct {
    // Existing fields...
    instrument_table: [InstrumentKind.COUNT]std.ArrayList(InstrumentRecord),

    // NEW: Cached inject configuration per instrument kind
    inject_configs: [InstrumentKind.COUNT]InjectConfig,

    // ...
};
```

**Rebuild Configuration on Attach/Detach**:

```zig
/// Rebuild inject configuration for a specific kind
fn rebuildInjectConfig(self: *Telemetry, kind: InstrumentKind) !void {
    const kind_index = @intFromEnum(kind);
    var config = &self.inject_configs[kind_index];

    // Clear existing configuration
    config.deinit(self.allocator);
    config.* = InjectConfig.init(self.allocator);

    // Collect unique header keys from all instruments
    var request_set = std.StringHashMap(void).init(self.allocator);
    defer request_set.deinit();
    var response_set = std.StringHashMap(void).init(self.allocator);
    defer response_set.deinit();

    for (self.instrument_table[kind_index].items) |*record| {
        // Extract request headers from instrument config
        const req_headers = try record.getRequestHeaders(self.global);
        for (req_headers) |header| {
            try request_set.put(header, {});
        }

        // Extract response headers from instrument config
        const resp_headers = try record.getResponseHeaders(self.global);
        for (resp_headers) |header| {
            try response_set.put(header, {});
        }
    }

    // Convert sets to arrays
    config.request_headers = try self.allocator.alloc([]const u8, request_set.count());
    var req_idx: usize = 0;
    var req_iter = request_set.keyIterator();
    while (req_iter.next()) |key| {
        config.request_headers[req_idx] = try self.allocator.dupe(u8, key.*);
        req_idx += 1;
    }

    config.response_headers = try self.allocator.alloc([]const u8, response_set.count());
    var resp_idx: usize = 0;
    var resp_iter = response_set.keyIterator();
    while (resp_iter.next()) |key| {
        config.response_headers[resp_idx] = try self.allocator.dupe(u8, key.*);
        resp_idx += 1;
    }

    config.instrument_count = @intCast(self.instrument_table[kind_index].items.len);
}
```

**Call on Attach/Detach**:

```zig
pub fn attach(self: *Telemetry, instrument: JSValue) !u32 {
    // ... existing attach logic ...

    // Rebuild inject config for this kind
    try self.rebuildInjectConfig(kind);

    return instrument_id;
}

pub fn detach(self: *Telemetry, id: u32) !void {
    // ... existing detach logic ...

    // Rebuild inject config for this kind
    try self.rebuildInjectConfig(kind);
}
```

---

### 3. Runtime Integration Points

#### A. HTTP Server Response Injection (`src/bun.js/api/server.zig`)

**Location**: After response is created, before sending to client

```zig
// In handleResponse() or similar
if (telemetry.getInjectConfig(.http)) |config| {
    if (config.response_headers.len > 0) {
        // Call notifyInject to get header values
        const injected = telemetry.notifyInject(.http, request_id, .js_undefined);
        if (injected.isObject()) {
            // Iterate over configured header keys
            for (config.response_headers) |header_key| {
                const header_value = injected.get(global, header_key) orelse continue;
                if (!header_value.isString()) continue;

                // Set response header
                response.headers.set(header_key, header_value.toString(global));
            }
        }
    }
}
```

**Performance**:
- Early return if no instruments inject headers (`config.response_headers.len == 0`)
- Header keys pre-parsed at attach time (no per-request string allocation)
- Only configured headers extracted from injected object (ignore extras)

#### B. Fetch Client Request Injection (`src/bun.js/webcore/fetch.zig`)

**Location**: Before sending HTTP request (in `queue()` or similar)

```zig
// In FetchTasklet.queue() before scheduling HTTP request
if (telemetry.getInjectConfig(.fetch)) |config| {
    if (config.request_headers.len > 0) {
        // Call notifyInject to get header values
        const injected = telemetry.notifyInject(.fetch, request_id, .js_undefined);
        if (injected.isObject()) {
            // Iterate over configured header keys
            for (config.request_headers) |header_key| {
                const header_value = injected.get(global, header_key) orelse continue;
                if (!header_value.isString()) continue;

                // Set request header (or add to existing headers object)
                this.request_headers.set(header_key, header_value.toString(global));
            }
        }
    }
}
```

**Performance**:
- Early return if no instruments inject headers
- Headers injected BEFORE network I/O (no latency impact)
- Only configured headers extracted (security: prevent header injection attacks)

---

### 4. Configuration Query API

**Add to `Bun.telemetry.nativeHooks`**:

```typescript
// Internal API (not exposed to users, used by runtime)
Bun.telemetry.nativeHooks.getInjectHeaders(kind: InstrumentKind): {
  request: string[],
  response: string[]
} | null
```

**Zig Implementation**:

```zig
pub fn jsGetInjectHeaders(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(JSC.conv) JSValue {
    const args = callframe.arguments(1);
    const kind_value = args.ptr[0];

    if (!kind_value.isNumber()) return .js_null;

    const kind_int = kind_value.coerce(i32, global);
    if (kind_int < 0 or kind_int >= InstrumentKind.COUNT) return .js_null;

    const kind: InstrumentKind = @enumFromInt(@as(u8, @intCast(kind_int)));
    const telemetry = getGlobalTelemetry() orelse return .js_null;

    const config = &telemetry.inject_configs[@intFromEnum(kind)];
    if (config.instrument_count == 0) return .js_null;

    // Build return object: { request: string[], response: string[] }
    const result = JSValue.createEmptyObject(global, 2);

    const request_array = JSValue.createEmptyArray(global, config.request_headers.len);
    for (config.request_headers, 0..) |header, idx| {
        request_array.putIndex(global, @intCast(idx), JSValue.createString(global, header));
    }
    result.put(global, "request", request_array);

    const response_array = JSValue.createEmptyArray(global, config.response_headers.len);
    for (config.response_headers, 0..) |header, idx| {
        response_array.putIndex(global, @intCast(idx), JSValue.createString(global, header));
    }
    result.put(global, "response", response_array);

    return result;
}
```

---

## Performance Characteristics

### When No Instruments Inject Headers (Typical Case)
- **Check cost**: Single integer comparison (`config.response_headers.len == 0`)
- **Overhead**: <5ns per request
- **Memory**: ~40 bytes per InstrumentKind for empty InjectConfig

### When Headers Injected (Distributed Tracing Active)
- **Config lookup**: O(1) array index
- **Hook invocation**: O(k) where k = number of instruments (typically 1-3)
- **Header extraction**: O(h) where h = number of configured headers (typically 2-5)
- **Total overhead**: ~100-200ns per request
- **Memory**: ~100 bytes per unique header key (amortized across all requests)

### Configuration Rebuild (Attach/Detach)
- **Frequency**: Only when instruments added/removed (rare)
- **Cost**: O(n × h) where n = instruments, h = headers per instrument
- **Typical**: <1μs for 10 instruments with 5 headers each

---

## Security Considerations

### Blocked Headers
**Policy**: Sensitive headers must NEVER be injectable, even if declared

**Blocklist** (enforced at attach time):
```typescript
const BLOCKED_INJECT_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "www-authenticate",
  "proxy-authorization",
  "proxy-authenticate",
];
```

**Validation**:
```zig
fn validateInjectHeaders(headers: []const []const u8) !void {
    const blocked = &[_][]const u8{
        "authorization", "cookie", "set-cookie",
        "www-authenticate", "proxy-authorization", "proxy-authenticate",
    };

    for (headers) |header| {
        for (blocked) |blocked_header| {
            if (std.mem.eql(u8, header, blocked_header)) {
                return error.BlockedHeaderInjection;
            }
        }
    }
}
```

### Header Value Validation
**Policy**: Only string values allowed (prevent header injection attacks)

```zig
// In injection code
if (!header_value.isString()) continue; // Skip non-string values

// NO: header_value.coerce(string) - could allow object injection
// YES: header_value.isString() strict check
```

### Header Count Limits
**Policy**: Prevent excessive header injection (DOS attack)

- Max 20 headers per instrument (enforced at attach time)
- Max 100 headers total per kind (enforced at rebuild time)
- Header values truncated at 8KB (enforced at injection time)

---

## Testing Contract

### Unit Tests (`test/js/bun/telemetry/`)

**Test: Header Configuration Caching**
```typescript
test("inject config rebuilt on attach/detach", () => {
  const id1 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "instrument-1",
    version: "1.0.0",
    injectHeaders: { response: ["traceparent"] },
    onOperationInject: () => ({ traceparent: "value" }),
  });

  const config1 = Bun.telemetry.nativeHooks.getInjectHeaders(InstrumentKind.HTTP);
  expect(config1.response).toEqual(["traceparent"]);

  const id2 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "instrument-2",
    version: "1.0.0",
    injectHeaders: { response: ["tracestate"] },
    onOperationInject: () => ({ tracestate: "value" }),
  });

  const config2 = Bun.telemetry.nativeHooks.getInjectHeaders(InstrumentKind.HTTP);
  expect(config2.response).toContain("traceparent");
  expect(config2.response).toContain("tracestate");

  Bun.telemetry.detach(id1);

  const config3 = Bun.telemetry.nativeHooks.getInjectHeaders(InstrumentKind.HTTP);
  expect(config3.response).toEqual(["tracestate"]);
  expect(config3.response).not.toContain("traceparent");
});
```

**Test: HTTP Server Header Injection**
```typescript
test("HTTP server injects response headers from instrument", async () => {
  const instrument = {
    type: InstrumentKind.HTTP,
    name: "test-inject",
    version: "1.0.0",
    injectHeaders: { response: ["traceparent", "tracestate"] },
    onOperationInject(id, data) {
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
```

**Test: Fetch Client Header Injection**
```typescript
test("fetch client injects request headers from instrument", async () => {
  let capturedHeaders: Record<string, string> = {};

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      capturedHeaders = Object.fromEntries(req.headers.entries());
      return new Response("ok");
    },
  });

  const instrument = {
    type: InstrumentKind.Fetch,
    name: "test-inject",
    version: "1.0.0",
    injectHeaders: { request: ["traceparent"] },
    onOperationInject(id, data) {
      return { traceparent: "00-fetch-trace-id-span-id-01" };
    },
  };

  const id = Bun.telemetry.attach(instrument);

  await fetch(`http://localhost:${server.port}`);

  expect(capturedHeaders.traceparent).toBe("00-fetch-trace-id-span-id-01");

  Bun.telemetry.detach(id);
});
```

**Test: Security - Blocked Headers**
```typescript
test("attach rejects blocked header injection", () => {
  expect(() => {
    Bun.telemetry.attach({
      type: InstrumentKind.HTTP,
      name: "malicious",
      version: "1.0.0",
      injectHeaders: { response: ["authorization"] }, // Blocked
      onOperationInject: () => ({ authorization: "Bearer hacked" }),
    });
  }).toThrow(/blocked.*header/i);
});
```

**Test: Header Merge - Last Wins**
```typescript
test("multiple instruments - last wins for duplicate headers", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response("ok"),
  });

  // First instrument attached
  const id1 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "instrument-1",
    version: "1.0.0",
    injectHeaders: { response: ["traceparent", "x-custom"] },
    onOperationInject: () => ({
      traceparent: "value-from-first",
      "x-custom": "first-only",
    }),
  });

  // Second instrument attached (later) - duplicates traceparent
  const id2 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "instrument-2",
    version: "1.0.0",
    injectHeaders: { response: ["traceparent", "tracestate"] },
    onOperationInject: () => ({
      traceparent: "value-from-second", // Duplicate - should win
      tracestate: "second-only",
    }),
  });

  const response = await fetch(`http://localhost:${server.port}`);

  // Last instrument wins for traceparent
  expect(response.headers.get("traceparent")).toBe("value-from-second");

  // Non-conflicting headers present
  expect(response.headers.get("x-custom")).toBe("first-only");
  expect(response.headers.get("tracestate")).toBe("second-only");

  Bun.telemetry.detach(id1);
  Bun.telemetry.detach(id2);
});
```

---

## Implementation Phases

### Phase 1: Configuration Infrastructure
1. Add `InjectConfig` struct to `telemetry.zig`
2. Add `inject_configs` array to `Telemetry` struct
3. Implement `rebuildInjectConfig()` function
4. Hook into `attach()` and `detach()` to rebuild config
5. Add `jsGetInjectHeaders()` native function
6. Write tests for config caching

### Phase 2: HTTP Server Integration
1. Add header injection code to `server.zig`
2. Extract configured headers from `notifyInject()` result
3. Set response headers before sending to client
4. Write tests for HTTP server header injection
5. Verify W3C trace context propagation works end-to-end

### Phase 3: Fetch Client Integration
1. Add header injection code to `fetch.zig`
2. Extract configured headers from `notifyInject()` result
3. Set request headers before sending HTTP request
4. Write tests for fetch client header injection
5. Verify distributed tracing across fetch() calls

### Phase 4: Security Hardening
1. Add blocked header validation to attach()
2. Add header count limits
3. Add header value size limits
4. Write security tests (blocked headers, injection attacks)
5. Document security model in contracts

---

## Future Extensions

### Planned
- Support for `baggage` header (W3C Baggage Propagation)
- Support for `b3` header (Zipkin B3 propagation)
- Custom header extraction (read headers from incoming requests)

### Non-Goals
- Dynamic header configuration (runtime changes without attach/detach)
- Per-request header configuration (would require per-request allocation)
- Header transformation/encoding (instruments control format)
