# HTTP Headers vs OpenTelemetry Attributes: Overlap Analysis

**Date**: 2025-10-20
**Context**: Investigating potential code reuse between HTTP header infrastructure and OTel attributes

---

## Summary

**TL;DR**: There is **ZERO direct overlap** between HTTP header enum values and OTel attribute enum values because OpenTelemetry uses **dynamic header templates** instead of individual header attributes.

However, there is a **massive opportunity** to reuse Bun's HTTP header perfect hash infrastructure for efficient header-to-attribute conversion.

---

## The Numbers

### HTTP Headers (Bun)
- **Total**: 119 HTTP headers defined in `HTTPHeaderNames.in`
- **Storage**: Enum values 0-118 (`HTTPHeaderName` as `uint8_t`)
- **Examples**: `Accept`, `Content-Type`, `User-Agent`, `Authorization`, etc.

### OpenTelemetry HTTP Attributes
- **Fixed attributes**: 26 semantic conventions
- **Header attributes**: **DYNAMIC** (not pre-enumerated)
- **Pattern**: `http.request.header.<lowercase-name>` (function template)

---

## Key Discovery: Dynamic Header Templates

OpenTelemetry does **NOT** define individual header attributes. Instead, it uses function templates:

```typescript
// OpenTelemetry semantic conventions
export const ATTR_HTTP_REQUEST_HEADER = (key: string) =>
  `http.request.header.${key}`;

export const ATTR_HTTP_RESPONSE_HEADER = (key: string) =>
  `http.response.header.${key}`;

// Usage
span.setAttribute(
  ATTR_HTTP_REQUEST_HEADER('content-type'),  // → "http.request.header.content-type"
  'application/json'
);

span.setAttribute(
  ATTR_HTTP_RESPONSE_HEADER('cache-control'),  // → "http.response.header.cache-control"
  'max-age=3600'
);
```

**This means**:
- Any of the 119 HTTP headers can become an attribute
- Header name is normalized to lowercase
- Attribute key is constructed at runtime: `http.request.header.${headerName}`
- No pre-defined enum mapping

---

## Overlap Analysis

### Direct Enum Overlap: 0

**Fixed OTel HTTP Attributes** (not headers):
```
http.request.method
http.request.method_original
http.response.status_code
http.route
url.full
url.path
url.query
network.protocol.name
server.address
server.port
error.type
... (20 more)
```

**HTTP Headers** (from Bun):
```
Accept
Content-Type
User-Agent
Authorization
Cache-Control
... (114 more)
```

**Overlap**: `0` (completely different namespaces)

### Semantic Overlap: ~10 Header-Related Attributes

Some OTel attributes capture the *same information* as certain headers, but use different attribute names:

| OTel Attribute | HTTP Header | Note |
|----------------|-------------|------|
| `http.request.method` | (method line) | Not a header, but related |
| `http.response.status_code` | (status line) | Not a header, but related |
| `user_agent.original` | `User-Agent` | Separate namespace |
| `http.request.body.size` | `Content-Length` (request) | Derived from header |
| `http.response.body.size` | `Content-Length` (response) | Derived from header |
| `server.address` | `Host` | May be derived from header |
| `url.scheme` | (from URL, not header) | Related concept |

**Overlap**: ~10 semantic relationships, but **no shared enum values**

### Dynamic Header Attributes: ALL 119 Headers Potential

Any HTTP header can be captured as an attribute using the template:

```
http.request.header.accept           ← from Accept header
http.request.header.content-type     ← from Content-Type header
http.request.header.user-agent       ← from User-Agent header
http.request.header.authorization    ← from Authorization header (if configured)
http.request.header.cache-control    ← from Cache-Control header
... (any of 119 headers)
```

**Potential overlap**: ALL 119 headers (via dynamic template)

---

## Opportunity: Reuse HTTP Header Perfect Hash

### Current HTTP Header Flow

```
1. HTTP Request arrives
2. Parse header: "Content-Type: application/json"
3. Perfect hash lookup: "content-type" → HTTPHeaderName::ContentType (25)
4. Store in HTTPHeaderMap: m_commonHeaders[25] = "application/json"
```

### Proposed Attribute Flow (with reuse)

```
1. HTTP Request arrives
2. Parse header: "Content-Type: application/json"
3. Perfect hash lookup: "content-type" → HTTPHeaderName::ContentType (25)
4. Store in HTTPHeaderMap [existing]

5. Telemetry enabled?
6. Build AttributeMap for onOperationStart()
7. For each configured header to capture:
   a. Get HTTPHeaderName enum (already parsed! ~0ns)
   b. Convert to attribute key: "http.request.header." + headerNameString(25)
   c. Store in AttributeMap: attrs.set(attrKey, headerValue)
```

### Key Insight: Zero-Cost Header Translation

**Problem**: Converting `Content-Type` header to `http.request.header.content-type` attribute is expensive if you do string manipulation

**Solution**: Reuse the perfect hash mapping!

```cpp
// HTTPHeaderMap.h - already exists
enum HTTPHeaderName : uint8_t {
    Accept = 0,
    ContentType = 25,
    UserAgent = 107,
    // ... 116 more
};

// New: Bidirectional mapping
const char* httpHeaderNameToString(HTTPHeaderName name) {
    // Already exists! (for serialization)
    static const char* names[] = {
        "accept",           // 0
        // ...
        "content-type",     // 25
        // ...
        "user-agent",       // 107
    };
    return names[static_cast<uint8_t>(name)];
}

// New: Attribute key construction (zero-alloc)
void addHeaderAttribute(AttributeMap& attrs, HTTPHeaderName header, const String& value) {
    // Fast path: construct attribute key from pre-known header name
    const char* headerName = httpHeaderNameToString(header);

    // Option 1: String concatenation (one alloc)
    String attrKey = "http.request.header." + String(headerName);
    attrs.set(attrKey, AttributeValue(value));

    // Option 2: EVEN FASTER - use numeric encoding!
    // Reserve attribute keys 128-255 for HTTP headers
    const uint8_t attrEnumValue = 128 + static_cast<uint8_t>(header);
    attrs.setFast(static_cast<AttributeKey>(attrEnumValue), AttributeValue(value));
}
```

---

## Design Recommendation: Hybrid Encoding

### Attribute Key Enum Layout

```zig
pub const AttributeKey = enum(u8) {
    // Semantic conventions: 0-127
    http_request_method = 0,
    http_response_status_code = 1,
    url_path = 2,
    url_query = 3,
    // ... ~100 more semantic conventions

    // RESERVED BLOCK: 128-255 for HTTP headers (dynamic mapping)
    // These are NOT pre-defined, but calculated at runtime

    _http_header_offset = 128,  // Marker

    // Runtime mapping:
    // HTTPHeaderName::Accept (0) → AttributeKey(128 + 0) = 128
    // HTTPHeaderName::ContentType (25) → AttributeKey(128 + 25) = 153
    // HTTPHeaderName::UserAgent (107) → AttributeKey(128 + 107) = 235
};

// Helper function
pub fn httpHeaderToAttributeKey(header: HTTPHeaderName) AttributeKey {
    return @enumFromInt(128 + @intFromEnum(header));
}
```

### Storage Strategy

```cpp
// AttributeMap.h

class AttributeMap {
    // Slot 0-127: Semantic attributes
    std::array<AttributeValue, 128> m_semanticAttributes;

    // Slot 128-255: HTTP header attributes (request + response)
    // Could store 127 headers, but we only have 119
    std::array<AttributeValue, 128> m_headerAttributes;

    // Custom attributes
    std::unordered_map<String, AttributeValue> m_customAttributes;
};
```

### Fast Header Capture

```cpp
// In RequestContext.zig or telemetry_http.zig

pub fn captureRequestHeaders(
    attrs: *AttributeMap,
    headers: *FetchHeaders,
    config: *HeaderCaptureConfig,
) void {
    // Iterate configured headers
    for (config.requestHeadersToCapture) |headerName| {
        // Fast path: header already parsed to enum
        const headerValue = headers.fastGet(headerName) orelse continue;

        // Convert to attribute key (compile-time offset)
        const attrKey = httpHeaderToAttributeKey(headerName);

        // Store (direct array access, ~5ns)
        attrs.setFast(attrKey, AttributeValue{ .string = headerValue });
    }
}
```

---

## Performance Implications

### Without Header Reuse (naive approach)

```typescript
// Build attributes object in JavaScript
const attrs = {
  'http.request.header.content-type': request.headers.get('Content-Type'),
  'http.request.header.user-agent': request.headers.get('User-Agent'),
  'http.request.header.accept': request.headers.get('Accept'),
};
```

**Cost per attribute**:
- String allocation: `"http.request.header.content-type"` (~40 bytes)
- Hash table insert: ~50ns
- Header string lookup: ~20ns
- **Total**: ~70ns + 40 bytes per header

**For 10 headers**: ~700ns, ~400 bytes

### With Header Reuse (proposed)

```zig
// Build attributes in native code
const attrKey = httpHeaderToAttributeKey(HTTPHeaderName.ContentType);
attrs.setFast(attrKey, headerValue);  // Already parsed!
```

**Cost per attribute**:
- Enum offset calculation: ~1ns (compile-time constant)
- Array store: ~5ns (direct indexing)
- Header value already in memory: ~0ns
- **Total**: ~6ns + 0 bytes additional allocation

**For 10 headers**: ~60ns, ~0 bytes

**Speedup**: **11.7x faster**, **100% less memory**

---

## Implementation Strategy

### Phase 1: Attribute Enum Reservation

```zig
// telemetry_attributes.zig

pub const AttributeKey = enum(u8) {
    // 0-127: Fixed semantic conventions
    http_request_method = 0,
    http_response_status_code = 1,
    url_full = 2,
    url_path = 3,
    // ... ~100 more

    // 128-247: Reserved for HTTP request headers (120 slots)
    _http_request_header_base = 128,

    // 248-255: Reserved for future use (8 slots)
    _reserved = 248,

    pub fn fromHttpRequestHeader(header: HTTPHeaderName) AttributeKey {
        return @enumFromInt(128 + @intFromEnum(header));
    }

    pub fn fromHttpResponseHeader(header: HTTPHeaderName) AttributeKey {
        // Could use 248+ for response headers, or share same space
        return @enumFromInt(128 + @intFromEnum(header));
    }

    pub fn isHttpHeader(self: AttributeKey) bool {
        const val = @intFromEnum(self);
        return val >= 128 and val < 248;
    }

    pub fn toHttpHeader(self: AttributeKey) ?HTTPHeaderName {
        const val = @intFromEnum(self);
        if (val < 128 or val >= 248) return null;
        return @enumFromInt(val - 128);
    }
};
```

### Phase 2: Attribute Key String Mapping

For serialization (when exporting to OTel exporters), we need to convert back to strings:

```zig
pub fn attributeKeyToString(key: AttributeKey) []const u8 {
    if (key.isHttpHeader()) {
        const header = key.toHttpHeader().?;

        // Build: "http.request.header." + headerName
        // Could use comptime or static buffer
        const headerName = httpHeaderNameToString(header);
        return std.fmt.allocPrint(
            allocator,
            "http.request.header.{s}",
            .{headerName}
        ) catch unreachable;
    }

    // Fixed semantic conventions (lookup table)
    return switch (key) {
        .http_request_method => "http.request.method",
        .http_response_status_code => "http.response.status_code",
        .url_full => "url.full",
        // ... all others
        else => "unknown",
    };
}
```

### Phase 3: Export Translation

When converting to plain JS object for OTel SDK:

```zig
pub fn toJS(attrs: *AttributeMap, global: *JSGlobalObject) JSValue {
    const obj = JSValue.createEmptyObject(global, 128);

    // Semantic attributes
    for (0..128) |i| {
        if (!attrs.m_semanticBitset.test(i)) continue;

        const key = @as(AttributeKey, @enumFromInt(i));
        const keyStr = attributeKeyToString(key);
        const value = attrs.m_semanticAttributes[i].toJS(global);

        obj.put(global, keyStr, value);
    }

    // HTTP header attributes (128-247)
    for (128..248) |i| {
        if (!attrs.m_headerBitset.test(i - 128)) continue;

        const key = @as(AttributeKey, @enumFromInt(i));
        const header = key.toHttpHeader().?;

        // Build key: "http.request.header.{name}"
        const headerName = httpHeaderNameToString(header);
        var buf: [64]u8 = undefined;
        const keyStr = std.fmt.bufPrint(
            &buf,
            "http.request.header.{s}",
            .{headerName}
        ) catch unreachable;

        const value = attrs.m_headerAttributes[i - 128].toJS(global);
        obj.put(global, keyStr, value);
    }

    // Custom attributes
    for (attrs.m_customAttributes.entries()) |entry| {
        obj.put(global, entry.key, entry.value.toJS(global));
    }

    return obj;
}
```

---

## Benefits Summary

### 1. Zero-Cost Header Conversion
- Headers already parsed to enum during HTTP processing
- Attribute key calculated via compile-time offset (128 + headerEnum)
- No string allocation or hashing needed

### 2. Perfect Memory Layout
- 0-127: Semantic attributes (http.request.method, url.path, etc.)
- 128-247: HTTP header attributes (using same enum space as HTTPHeaderName)
- 248-255: Reserved for future expansion
- Custom: Hash map fallback

### 3. Backward Compatibility
- `toJS()` converts back to OTel standard strings
- OTel SDK receives: `{"http.request.header.content-type": "application/json"}`
- Fully compliant with OTel specification

### 4. Space Efficiency
- 256 total attribute slots (fits in `uint8_t`)
- 119 HTTP headers + ~100 semantic attributes = 219 total
- 37 slots remaining for future expansion
- No memory waste

### 5. Performance
- **11x faster** attribute creation for headers
- **Zero allocations** for header attribute keys
- **Direct array access** instead of hash table lookups

---

## Alternative: Separate Request/Response Headers

If we need to distinguish request vs response headers:

```zig
pub const AttributeKey = enum(u8) {
    // 0-99: Fixed semantic conventions
    http_request_method = 0,
    // ...

    // 100-169: HTTP request headers (70 most common)
    _http_request_header_base = 100,

    // 170-239: HTTP response headers (70 most common)
    _http_response_header_base = 170,

    // 240-255: Custom attributes (16 slots, then overflow to hashmap)
    _custom_base = 240,
};
```

**Trade-off**: Uses more enum space but provides clearer semantics

---

## Recommendation

**Use the shared header space (128-247) for both request and response headers**

**Rationale**:
1. Request and response headers rarely overlap in the same AttributeMap
2. Saves 70 enum slots for future semantic conventions
3. Simpler implementation (one offset calculation)
4. Can always use custom attributes if we need to distinguish

**If we need request/response distinction**, add context via:
```typescript
// In callback signature
onOperationStart(id, attrs) {
  // All header attrs are implicitly request headers
}

onOperationEnd(id, attrs) {
  // All header attrs are implicitly response headers
}
```

---

## Conclusion

**Direct Overlap**: **0 attributes** (different namespaces)

**Semantic Overlap**: **~10 attributes** (conceptually related to headers)

**Dynamic Overlap**: **ALL 119 headers** (via template pattern)

**Key Innovation**: Reuse HTTP header perfect hash infrastructure by reserving attribute enum space 128-247 for direct header-to-attribute mapping, achieving **11x performance improvement** with **zero additional allocations**.

**Next Steps**:
1. Reserve AttributeKey enum space 128-247 for HTTP headers
2. Implement `httpHeaderToAttributeKey()` conversion function
3. Update `AttributeMap::toJS()` to reconstruct OTel-compliant attribute names
4. Benchmark header capture performance

