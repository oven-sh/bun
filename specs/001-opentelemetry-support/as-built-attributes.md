# AttributeMap Implementation

High-performance attribute storage for OpenTelemetry telemetry with zero-allocation semantic convention lookups.

## Design Goals

1. **Zero-allocation lookups** for semantic conventions (via enum)
2. **Lazy JS↔Native conversion** (cache both forms)
3. **Memory-efficient storage** (no duplicate strings)
4. **Compatible with JSValue** objects for TypeScript hooks

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AttributeMap                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Semantic Attributes (Fixed Array)                   │   │
│  │   [0: http_request_method] → {native, js}           │   │
│  │   [1: http_response_status_code] → {native, js}     │   │
│  │   [20: url_path] → {native, js}                     │   │
│  │   ...                                                │   │
│  │   Fast path: O(1) array indexing, zero allocation   │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Custom Attributes (HashMap + Parallel Arrays)       │   │
│  │   custom_keys: ["custom.metric", "cache.hit_rate"]  │   │
│  │   custom_values: [{native, js}, {native, js}]       │   │
│  │   custom_map: {"custom.metric" → 0, ...}            │   │
│  │   Slow path: O(1) hash lookup, allocates on insert  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## AttributeValue Lazy Conversion

```zig
pub const AttributeValue = struct {
    native: ?NativeValue,  // bool | int32 | int64 | double | bun.String
    js: ?JSValue,          // Cached JS representation

    // Set from Zig: stores native, js=null
    pub fn fromNative(val: NativeValue) AttributeValue;

    // Set from JS: stores both (extracts native for primitives)
    pub fn fromJS(global: *JSGlobalObject, val: JSValue) AttributeValue;

    // Lazy convert native→JS on first call, then cache
    pub fn toJS(self: *AttributeValue, global: *JSGlobalObject) JSValue;
};
```

## Performance Characteristics

### Semantic Attributes (Fast Path)

```zig
// Zero allocations - direct array indexing
attrs.setFast(.http_request_method, AttributeValue.fromNative(.{ .string = "GET" }));
const method = attrs.getFast(.http_request_method);
```

- **Lookup**: O(1) array index, ~5ns
- **Storage**: Fixed-size array, ~16 bytes/attribute
- **Allocation**: ZERO for set/get operations

### String Key Fallback

```zig
// Checks semantic first, then custom (may allocate for custom)
try attrs.set("http.request.method", value);  // Fast: becomes setFast()
try attrs.set("custom.metric", value);        // Slow: allocates HashMap entry
```

- **Semantic lookup**: Prefix-grouped linear scan, ~15-30ns
- **Custom lookup**: HashMap, ~50ns
- **Allocation**: Only for new custom attribute keys

### Memory Footprint

**Semantic attributes**: 0 allocations (compile-time strings)
**Custom attributes**: 1 allocation per unique key

Compare to plain JS objects: **2-5x memory reduction**

## Code Generation

Semantic conventions are auto-generated from actual usage:

```bash
# Scan src/telemetry/*.zig for AttributeKey.* usage
bun run packages/bun-otel/scripts/generate-semconv.ts

# Generates: src/telemetry/fast_semconv.zig
#   - Enum with only used attributes
#   - Optimized fromString() with prefix grouping
#   - toString() with compile-time strings
```

### Prefix Grouping Optimization

The generator groups attributes by common prefixes:

```zig
// Generated code example:
if (std.mem.startsWith(u8, name, "http.")) {
    if (std.mem.eql(u8, name, "http.request.method")) return .http_request_method;
    if (std.mem.eql(u8, name, "http.response.status_code")) return .http_response_status_code;
    return null;  // Early exit if no match
}
if (std.mem.startsWith(u8, name, "url.")) {
    // ... only check url.* attributes
}
```

This reduces average comparisons from N to ~N/K where K is group count.

## Usage Examples

### From Native Zig Code

```zig
var attrs = AttributeMap.init(allocator, global);
defer attrs.deinit();

// Fast path: semantic attributes (zero allocation)
attrs.setFast(.http_request_method, .{ .native = .{ .string = bun.String.static("GET") } });
attrs.setFast(.http_response_status_code, .{ .native = .{ .int32 = 200 } });

// Slow path: custom attributes (allocates on first set)
try attrs.set("custom.request_id", .{ .native = .{ .string = request_id } });

// Convert to JS for TypeScript hooks
const js_obj = attrs.toJS();
```

### From TypeScript Hooks

```typescript
const instrument: NativeInstrument = {
  type: InstrumentKind.HTTP,
  onOperationStart(id: number, attributes: Record<string, any>) {
    // Attributes received as plain JS object
    const method = attributes['http.request.method'];
    const path = attributes['url.path'];

    // Lazy conversion happened in native layer
  },
};
```

## Memory Allocation Points

Per FR-024, all allocations are documented:

### Hot Path (Per Request)

```zig
// AttributeMap.set() for custom attributes:
// OTEL_MALLOC - required to convert JSValue string to native for HashMap lookup
const key_slice = key_string.toUTF8(self.allocator);

// OTEL_MALLOC - custom attributes only, semantic attributes use enum (zero allocation)
try self.custom_keys.append(key_string);
try self.custom_values.append(value);
```

### Conversion Path (Lazy)

```zig
// AttributeMap.toJS() for custom attributes:
// OTEL_MALLOC - required to convert bun.String to slice for JSValue.put()
const key_slice = key.toUTF8(self.allocator);
```

**Total allocations per request**: 0-2 (only if custom attributes used)

## Integration with Existing Telemetry

Replace current `AttributeMap.init()` pattern in http.zig and fetch.zig:

```zig
// OLD (current implementation):
var attrs = AttributeMap.init(globalObject);
attrs.set("operation.id", telemetry.jsRequestId(request_id));
attrs.fastSet(.http_request_method, ZigString.init(method).toJS(globalObject));

// NEW (with attributes.zig):
var attrs = AttributeMap.init(allocator, globalObject);
defer attrs.deinit();
attrs.set("operation.id", .{ .native = .{ .int64 = request_id } });
attrs.setFast(.http_request_method, .{ .native = .{ .string = bun.String.fromBytes(method) } });

// Pass to instrumentation
telemetry_inst.notifyOperationStart(.http, request_id, attrs.toJS());
```

## Testing

Tests are located in `src/telemetry/attributes.zig`.

Run via Bun build system (requires `bun` module):

```bash
bun bd test telemetry
```

## Future Optimizations

1. **Arena allocator** for per-request attributes (single malloc/free pair)
2. **String interning** for common values ("GET", "POST", "200", "404")
3. **Stack-allocated AttributeMap** for small attribute counts (<16)
4. **Perfect hash** instead of prefix grouping (if attribute count grows >100)

## References

- Design doc: `specs/todo/attributes-api-research.md`
- Semantic conventions: `src/telemetry/semconv.zig` (auto-generated constants)
- Headers implementation: `src/bun.js/webcore/FetchHeaders.zig` (similar architecture)
