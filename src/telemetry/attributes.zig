//! Optimized attribute storage for OpenTelemetry telemetry
//!
//! Design goals:
//! - Zero-allocation lookup for semantic conventions (via enum)
//! - Lazy JS<->Native conversion (cache both forms)
//! - Memory-efficient storage (no duplicate strings)
//! - Compatible with JSValue objects for TypeScript hooks

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const ZigString = jsc.ZigString;

/// Import generated semantic conventions (will be created by codegen)
/// For now, we define a minimal set manually
pub const AttributeKey = enum(u8) {
    // HTTP attributes (0-19)
    http_request_method = 0,
    http_response_status_code = 1,
    http_request_body_size = 2,
    http_response_body_size = 3,

    // URL attributes (20-29)
    url_path = 20,
    url_query = 21,
    url_scheme = 22,
    url_full = 23,

    // Server attributes (30-39)
    server_address = 30,
    server_port = 31,

    // Network attributes (40-49)
    network_peer_address = 40,
    network_peer_port = 41,

    // User agent (50-59)
    user_agent_original = 50,

    // Error attributes (60-69)
    error_type = 60,
    error_message = 61,

    pub const COUNT = @typeInfo(AttributeKey).@"enum".fields.len;

    /// Convert attribute key to OpenTelemetry semantic convention string
    pub fn toString(self: AttributeKey) []const u8 {
        return switch (self) {
            .http_request_method => "http.request.method",
            .http_response_status_code => "http.response.status_code",
            .http_request_body_size => "http.request.body.size",
            .http_response_body_size => "http.response.body.size",
            .url_path => "url.path",
            .url_query => "url.query",
            .url_scheme => "url.scheme",
            .url_full => "url.full",
            .server_address => "server.address",
            .server_port => "server.port",
            .network_peer_address => "network.peer.address",
            .network_peer_port => "network.peer.port",
            .user_agent_original => "user_agent.original",
            .error_type => "error.type",
            .error_message => "error.message",
        };
    }

    /// Optimized string->enum lookup with prefix grouping
    /// This will be code-generated to include prefix optimization
    pub fn fromString(name: []const u8) ?AttributeKey {
        // Fast path: check length first
        if (name.len < 9 or name.len > 32) return null;

        // Prefix-based grouping (will be generated)
        // For now, simple linear scan with early exit
        if (std.mem.startsWith(u8, name, "http.")) {
            if (std.mem.eql(u8, name, "http.request.method")) return .http_request_method;
            if (std.mem.eql(u8, name, "http.response.status_code")) return .http_response_status_code;
            if (std.mem.eql(u8, name, "http.request.body.size")) return .http_request_body_size;
            if (std.mem.eql(u8, name, "http.response.body.size")) return .http_response_body_size;
            return null;
        }

        if (std.mem.startsWith(u8, name, "url.")) {
            if (std.mem.eql(u8, name, "url.path")) return .url_path;
            if (std.mem.eql(u8, name, "url.query")) return .url_query;
            if (std.mem.eql(u8, name, "url.scheme")) return .url_scheme;
            if (std.mem.eql(u8, name, "url.full")) return .url_full;
            return null;
        }

        if (std.mem.startsWith(u8, name, "server.")) {
            if (std.mem.eql(u8, name, "server.address")) return .server_address;
            if (std.mem.eql(u8, name, "server.port")) return .server_port;
            return null;
        }

        if (std.mem.startsWith(u8, name, "network.")) {
            if (std.mem.eql(u8, name, "network.peer.address")) return .network_peer_address;
            if (std.mem.eql(u8, name, "network.peer.port")) return .network_peer_port;
            return null;
        }

        if (std.mem.startsWith(u8, name, "error.")) {
            if (std.mem.eql(u8, name, "error.type")) return .error_type;
            if (std.mem.eql(u8, name, "error.message")) return .error_message;
            return null;
        }

        if (std.mem.eql(u8, name, "user_agent.original")) return .user_agent_original;

        return null;
    }
};

/// Native attribute value types
pub const NativeValue = union(enum) {
    bool: bool,
    int32: i32,
    int64: i64,
    double: f64,
    string: bun.String,

    pub fn deinit(self: *NativeValue) void {
        switch (self.*) {
            .string => |str| str.deref(),
            else => {},
        }
    }
};

/// Attribute value with lazy JS<->Native conversion
/// Stores both native and JS representations, converting lazily as needed
pub const AttributeValue = struct {
    native: ?NativeValue = null,
    js: ?JSValue = null,

    /// Create from native Zig value
    pub fn fromNative(val: NativeValue) AttributeValue {
        return .{ .native = val, .js = null };
    }

    /// Create from JavaScript value, extracting native representation if possible
    pub fn fromJS(global: *JSGlobalObject, val: JSValue) AttributeValue {
        // Try to extract native value for common types
        if (val.isBoolean()) {
            return .{ .native = .{ .bool = val.asBoolean() }, .js = val };
        }

        if (val.isNumber()) {
            const num = val.asNumber();
            // Store as int32 if it fits
            if (@floor(num) == num and num >= std.math.minInt(i32) and num <= std.math.maxInt(i32)) {
                return .{ .native = .{ .int32 = @intFromFloat(num) }, .js = val };
            }
            return .{ .native = .{ .double = num }, .js = val };
        }

        if (val.isString()) {
            var zig_str: ZigString = ZigString.Empty;
            val.toZigString(&zig_str, global);
            const bun_str = bun.String.init(zig_str);
            return .{ .native = .{ .string = bun_str }, .js = val };
        }

        // Other types (arrays, objects): just store JS
        return .{ .native = null, .js = val };
    }

    /// Convert to JavaScript value, caching the result
    pub fn toJS(self: *AttributeValue, global: *JSGlobalObject) JSValue {
        // Return cached JS value if available
        if (self.js) |js_val| return js_val;

        // Convert native to JS and cache
        if (self.native) |native_val| {
            const js_val = switch (native_val) {
                .bool => |v| JSValue.jsBoolean(v),
                .int32 => |v| JSValue.jsNumber(@as(f64, @floatFromInt(v))),
                .int64 => |v| JSValue.jsNumber(@as(f64, @floatFromInt(v))),
                .double => |v| JSValue.jsNumber(v),
                .string => |v| v.toJS(global),
            };
            self.js = js_val;
            return js_val;
        }

        return .js_undefined;
    }

    /// Clean up resources
    pub fn deinit(self: *AttributeValue) void {
        if (self.native) |*native_val| {
            native_val.deinit();
        }
    }
};

/// Optimized attribute map with semantic convention fast path
pub const AttributeMap = struct {
    /// Semantic attributes (fixed-size array, indexed by AttributeKey enum)
    /// null means not set
    semantic: [AttributeKey.COUNT]?AttributeValue,

    /// Custom attribute keys (not in semantic conventions)
    custom_keys: std.ArrayList(bun.String),

    /// Custom attribute values (parallel to custom_keys)
    custom_values: std.ArrayList(AttributeValue),

    /// Map from custom key string to index in custom_keys/custom_values
    custom_map: std.StringHashMap(u32),

    allocator: std.mem.Allocator,
    global: *JSGlobalObject,

    /// Initialize empty attribute map
    pub fn init(allocator: std.mem.Allocator, global: *JSGlobalObject) AttributeMap {
        return .{
            .semantic = [_]?AttributeValue{null} ** AttributeKey.COUNT,
            .custom_keys = std.ArrayList(bun.String).init(allocator),
            .custom_values = std.ArrayList(AttributeValue).init(allocator),
            .custom_map = std.StringHashMap(u32).init(allocator),
            .allocator = allocator,
            .global = global,
        };
    }

    /// Clean up all resources
    pub fn deinit(self: *AttributeMap) void {
        // Clean up semantic attributes
        for (&self.semantic) |*maybe_val| {
            if (maybe_val.*) |*val| {
                val.deinit();
            }
        }

        // Clean up custom keys
        for (self.custom_keys.items) |key| {
            key.deref();
        }
        self.custom_keys.deinit();

        // Clean up custom values
        for (self.custom_values.items) |*val| {
            val.deinit();
        }
        self.custom_values.deinit();

        self.custom_map.deinit();
    }

    /// Fast path: set semantic attribute by enum key (zero allocation)
    pub fn setFast(self: *AttributeMap, key: AttributeKey, value: AttributeValue) void {
        const index = @intFromEnum(key);
        // Clean up old value if present
        if (self.semantic[index]) |*old_val| {
            old_val.deinit();
        }
        self.semantic[index] = value;
    }

    /// Fast path: get semantic attribute by enum key (zero allocation)
    pub fn getFast(self: *const AttributeMap, key: AttributeKey) ?AttributeValue {
        return self.semantic[@intFromEnum(key)];
    }

    /// Slow path: set attribute by string key (may allocate for custom attributes)
    pub fn set(self: *AttributeMap, key: []const u8, value: AttributeValue) !void {
        // Try semantic lookup first (zero allocation)
        if (AttributeKey.fromString(key)) |semantic_key| {
            self.setFast(semantic_key, value);
            return;
        }

        // Custom attribute - need to store the key string
        const key_string = bun.String.fromBytes(key);
        // OTEL_MALLOC - required to convert JSValue string to native for HashMap lookup
        const key_slice = key_string.toUTF8(self.allocator);
        defer key_slice.deinit();

        if (self.custom_map.get(key_slice.slice())) |index| {
            // Update existing custom attribute
            self.custom_values.items[index].deinit();
            self.custom_values.items[index] = value;
        } else {
            // Add new custom attribute
            const index = @as(u32, @intCast(self.custom_values.items.len));
            // OTEL_MALLOC - custom attributes only, semantic attributes use enum (zero allocation)
            try self.custom_keys.append(key_string);
            try self.custom_values.append(value);
            try self.custom_map.put(key_slice.slice(), index);
        }
    }

    /// Get attribute by string key
    pub fn get(self: *const AttributeMap, key: []const u8) ?AttributeValue {
        // Try semantic lookup first
        if (AttributeKey.fromString(key)) |semantic_key| {
            return self.getFast(semantic_key);
        }

        // Try custom attributes
        if (self.custom_map.get(key)) |index| {
            return self.custom_values.items[index];
        }

        return null;
    }

    /// Convert entire attribute map to JavaScript object
    /// This is called when passing attributes to TypeScript instrumentation hooks
    pub fn toJS(self: *AttributeMap) JSValue {
        const obj = JSValue.createEmptyObject(self.global, 16);

        // Add semantic attributes
        inline for (@typeInfo(AttributeKey).@"enum".fields) |field| {
            const key_enum = @as(AttributeKey, @enumFromInt(field.value));
            const index = @intFromEnum(key_enum);
            if (self.semantic[index]) |*attr_val| {
                const key_str = comptime key_enum.toString();
                obj.put(self.global, key_str, attr_val.toJS(self.global));
            }
        }

        // Add custom attributes
        for (self.custom_keys.items, 0..) |key, i| {
            // OTEL_MALLOC - required to convert bun.String to slice for JSValue.put()
            const key_slice = key.toUTF8(self.allocator);
            defer key_slice.deinit();
            var attr_val = &self.custom_values.items[i];
            obj.put(self.global, key_slice.slice(), attr_val.toJS(self.global));
        }

        return obj;
    }
};

// ============================================================================
// Tests
// NOTE: These tests require the bun module, run via: bun bd test telemetry
// ============================================================================

test "AttributeKey: toString round-trip" {
    try std.testing.expectEqualStrings("http.request.method", AttributeKey.http_request_method.toString());
    try std.testing.expectEqualStrings("url.path", AttributeKey.url_path.toString());
    try std.testing.expectEqualStrings("error.type", AttributeKey.error_type.toString());
}

test "AttributeKey: fromString with prefix optimization" {
    try std.testing.expectEqual(AttributeKey.http_request_method, AttributeKey.fromString("http.request.method"));
    try std.testing.expectEqual(AttributeKey.url_path, AttributeKey.fromString("url.path"));
    try std.testing.expectEqual(AttributeKey.server_port, AttributeKey.fromString("server.port"));
    try std.testing.expectEqual(@as(?AttributeKey, null), AttributeKey.fromString("unknown.attribute"));
}

test "AttributeKey: fromString rejects invalid lengths" {
    try std.testing.expectEqual(@as(?AttributeKey, null), AttributeKey.fromString("short"));
    try std.testing.expectEqual(@as(?AttributeKey, null), AttributeKey.fromString("this.is.a.very.long.attribute.name.that.exceeds.maximum"));
}

test "AttributeValue: fromNative stores native only" {
    const val = AttributeValue.fromNative(.{ .int32 = 42 });
    try std.testing.expect(val.native != null);
    try std.testing.expect(val.js == null);
    try std.testing.expectEqual(@as(i32, 42), val.native.?.int32);
}

test "AttributeValue: lazy toJS conversion" {
    // This test would need a JSGlobalObject, skipping for now
    // In real usage, toJS() would create and cache the JSValue
}

test "AttributeMap: setFast and getFast" {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Mock global object (in real tests, we'd use actual JSGlobalObject)
    var global_obj: JSGlobalObject = undefined;
    var attrs = AttributeMap.init(allocator, &global_obj);
    defer attrs.deinit();

    // Set semantic attribute
    attrs.setFast(.http_request_method, AttributeValue.fromNative(.{ .string = bun.String.static("GET") }));
    attrs.setFast(.http_response_status_code, AttributeValue.fromNative(.{ .int32 = 200 }));

    // Get semantic attribute
    const method = attrs.getFast(.http_request_method);
    try std.testing.expect(method != null);
    try std.testing.expect(method.?.native != null);

    const status = attrs.getFast(.http_response_status_code);
    try std.testing.expect(status != null);
    try std.testing.expectEqual(@as(i32, 200), status.?.native.?.int32);
}

test "AttributeMap: set with string key (semantic)" {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var global_obj: JSGlobalObject = undefined;
    var attrs = AttributeMap.init(allocator, &global_obj);
    defer attrs.deinit();

    // Set using string key that maps to semantic
    try attrs.set("http.request.method", AttributeValue.fromNative(.{ .string = bun.String.static("POST") }));

    // Verify it was stored in semantic array
    const method = attrs.getFast(.http_request_method);
    try std.testing.expect(method != null);
}

test "AttributeMap: set custom attribute" {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var global_obj: JSGlobalObject = undefined;
    var attrs = AttributeMap.init(allocator, &global_obj);
    defer attrs.deinit();

    // Set custom attribute (not in semantic conventions)
    try attrs.set("custom.metric", AttributeValue.fromNative(.{ .int64 = 12345 }));

    // Verify it was stored in custom storage
    const custom = attrs.get("custom.metric");
    try std.testing.expect(custom != null);
    try std.testing.expectEqual(@as(i64, 12345), custom.?.native.?.int64);
}

test "AttributeMap: update existing custom attribute" {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var global_obj: JSGlobalObject = undefined;
    var attrs = AttributeMap.init(allocator, &global_obj);
    defer attrs.deinit();

    // Set custom attribute
    try attrs.set("custom.counter", AttributeValue.fromNative(.{ .int32 = 1 }));

    // Update same attribute
    try attrs.set("custom.counter", AttributeValue.fromNative(.{ .int32 = 2 }));

    // Verify only one entry exists with updated value
    try std.testing.expectEqual(@as(usize, 1), attrs.custom_keys.items.len);
    const counter = attrs.get("custom.counter");
    try std.testing.expectEqual(@as(i32, 2), counter.?.native.?.int32);
}
