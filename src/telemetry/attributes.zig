//! Optimized attribute storage for OpenTelemetry telemetry
//!
//! Design goals:
//! - Zero-allocation lookup for semantic conventions (via enum)
//! - Fast header attribute storage with bitpacking
//! - Lazy JS<->Native conversion (cache both forms)
//! - Memory-efficient storage (no duplicate strings)
//! - Compatible with JSValue objects for TypeScript hooks

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const ZigString = jsc.ZigString;

/// Import generated semantic conventions with fast attribute system
const semconv = @import("semconv.zig");
pub const AttributeKey = semconv.AttributeKey;
pub const HeaderNameList = semconv.HeaderNameList;

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
            val.toZigString(&zig_str, global) catch return .{ .native = null, .js = val };
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

    /// Header attributes (bitpacked u16 keys: context | header_id)
    /// Separate from semantic for efficient storage of dynamic headers
    headers: std.AutoHashMap(u16, AttributeValue),

    /// Custom attribute keys (not in semantic conventions or headers)
    custom_keys: std.ArrayList(bun.String),

    /// Custom attribute values (parallel to custom_keys)
    custom_values: std.ArrayList(AttributeValue),

    /// Map from custom key string to index in custom_keys/custom_values
    custom_map: std.StringHashMap(u32),

    allocator: std.mem.Allocator,
    global: *JSGlobalObject,

    /// Initialize empty attribute map
    pub fn init(global: *JSGlobalObject) AttributeMap {
        return .{
            .semantic = [_]?AttributeValue{null} ** AttributeKey.COUNT,
            .headers = std.AutoHashMap(u16, AttributeValue).init(bun.default_allocator),
            .custom_keys = std.ArrayList(bun.String).init(bun.default_allocator),
            .custom_values = std.ArrayList(AttributeValue).init(bun.default_allocator),
            .custom_map = std.StringHashMap(u32).init(bun.default_allocator),
            .allocator = bun.default_allocator,
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

        // Clean up header attributes
        var header_iter = self.headers.valueIterator();
        while (header_iter.next()) |val_ptr| {
            val_ptr.deinit();
        }
        self.headers.deinit();

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
    pub fn fastSet(self: *AttributeMap, key: AttributeKey, value: JSValue) void {
        const index = @intFromEnum(key);
        // Clean up old value if present
        if (self.semantic[index]) |*old_val| {
            old_val.deinit();
        }
        self.semantic[index] = AttributeValue.fromJS(self.global, value);
    }

    /// Fast path: get semantic attribute by enum key (zero allocation)
    pub fn getFast(self: *const AttributeMap, key: AttributeKey) ?AttributeValue {
        return self.semantic[@intFromEnum(key)];
    }

    /// Set header attribute using bitpacked key (context | header_id)
    pub fn setHeader(self: *AttributeMap, header_key: u16, value: JSValue) !void {
        const attr_val = AttributeValue.fromJS(self.global, value);
        // Clean up old value if present
        if (self.headers.fetchRemove(header_key)) |kv| {
            var old_val = kv.value;
            old_val.deinit();
        }
        try self.headers.put(header_key, attr_val);
    }

    /// Get header attribute by bitpacked key
    pub fn getHeader(self: *const AttributeMap, header_key: u16) ?AttributeValue {
        return self.headers.get(header_key);
    }

    /// Slow path: set attribute by string key (may allocate for custom attributes)
    pub fn set(self: *AttributeMap, key: []const u8, value: JSValue) void {
        // Try semantic lookup first (zero allocation)
        if (semconv.stringToFastAttributeKey(key)) |semantic_key| {
            self.fastSet(semantic_key, value);
            return;
        }

        // Try header lookup (http.request.header.*, http.response.header.*)
        // This is less common, so it's ok if it's slower
        // For now, fall through to custom attributes

        // Custom attribute - need to store the key string
        const key_string = bun.String.fromBytes(key);
        const key_slice = key_string.toUTF8(self.allocator);
        defer key_slice.deinit();

        if (self.custom_map.get(key_slice.slice())) |index| {
            // Update existing custom attribute
            self.custom_values.items[index].deinit();
            self.custom_values.items[index] = AttributeValue.fromJS(self.global, value);
        } else {
            // Add new custom attribute
            const index = @as(u32, @intCast(self.custom_values.items.len));
            self.custom_keys.append(key_string) catch return;
            self.custom_values.append(AttributeValue.fromJS(self.global, value)) catch return;
            self.custom_map.put(key_slice.slice(), index) catch return;
        }
    }

    /// Convert entire attribute map to JavaScript object
    /// This is called when passing attributes to TypeScript instrumentation hooks
    pub fn toJS(self: *AttributeMap) JSValue {
        const total_count = blk: {
            var count: usize = 0;
            // Count semantic attributes
            for (self.semantic) |maybe_val| {
                if (maybe_val != null) count += 1;
            }
            // Count headers
            count += self.headers.count();
            // Count custom
            count += self.custom_keys.items.len;
            break :blk count;
        };

        const obj = JSValue.createEmptyObject(self.global, @intCast(total_count));

        // Add semantic attributes (only iterate over valid array indices)
        inline for (@typeInfo(AttributeKey).@"enum".fields) |field| {
            const key_enum = @as(AttributeKey, @enumFromInt(field.value));
            const index = @intFromEnum(key_enum);
            // Only access semantic array for base attributes (index < COUNT)
            if (index < AttributeKey.COUNT) {
                if (self.semantic[index]) |*attr_val| {
                    const key_str = comptime semconv.fastAttributeNameToString(key_enum);
                    obj.put(self.global, key_str, attr_val.toJS(self.global));
                }
            }
        }

        // Add header attributes
        var header_iter = self.headers.iterator();
        while (header_iter.next()) |entry| {
            const header_key_u16 = entry.key_ptr.*;
            // Build header attribute name from bitpacked key
            // Use a fake AttributeKey with the u16 value to get the string representation
            const fake_key = @as(AttributeKey, @enumFromInt(header_key_u16));
            const key_str = semconv.fastAttributeNameToString(fake_key);
            var attr_val = entry.value_ptr;
            obj.put(self.global, key_str, attr_val.toJS(self.global));
        }

        // Add custom attributes
        for (self.custom_keys.items, 0..) |key, i| {
            const key_slice = key.toUTF8(self.allocator);
            defer key_slice.deinit();
            var attr_val = &self.custom_values.items[i];
            obj.put(self.global, key_slice.slice(), attr_val.toJS(self.global));
        }

        return obj;
    }

    /// Extract headers from FetchHeaders object using HeaderNameList configuration
    /// This is the fast path using FetchHeaders.get() method
    pub fn extractHeadersFromFetchHeaders(
        self: *AttributeMap,
        headers_obj: JSValue,
        header_list: *const HeaderNameList,
        globalObject: *JSGlobalObject,
    ) void {
        // Set up exception handling
        var catch_scope: jsc.CatchScope = undefined;
        catch_scope.init(globalObject, @src());
        defer catch_scope.deinit();

        // Get the headers.get method
        const get_method = headers_obj.get(globalObject, "get") catch {
            _ = catch_scope.clearException();
            return;
        };
        if (get_method == null or !get_method.?.isCallable()) return;

        // Fast path: Extract HTTPHeaderName headers via direct ID lookup
        for (header_list.fast_headers.items) |header_id| {
            const header_name = semconv.httpHeaderNameToString(header_id);
            const header_name_js = ZigString.init(header_name).toJS(globalObject);
            const args = [_]JSValue{header_name_js};

            const header_value_js = get_method.?.callWithGlobalThis(globalObject, &args) catch {
                _ = catch_scope.clearException();
                continue;
            };

            if (header_value_js.isNull() or header_value_js.isUndefined()) continue;
            if (!header_value_js.isString()) continue;

            // Build bitpacked key: context | header_id
            const header_key = header_list.context | @as(u16, header_id);
            self.setHeader(header_key, header_value_js) catch continue;
        }

        // Slow path: Extract OTel-specific headers (traceparent, etc.)
        for (header_list.slow_header_names.items, 0..) |header_name_str, i| {
            const header_id = header_list.slow_header_ids.items[i];
            const header_name_js = header_name_str.toJS(globalObject);
            const args = [_]JSValue{header_name_js};

            const header_value_js = get_method.?.callWithGlobalThis(globalObject, &args) catch {
                _ = catch_scope.clearException();
                continue;
            };

            if (header_value_js.isNull() or header_value_js.isUndefined()) continue;
            if (!header_value_js.isString()) continue;

            // Build bitpacked key: context | FLAG_OTEL_HEADER | header_id
            const header_key = header_list.context | AttributeKey.FLAG_OTEL_HEADER | @as(u16, header_id);
            self.setHeader(header_key, header_value_js) catch continue;
        }
    }

    /// Extract headers from plain JavaScript object using HeaderNameList configuration
    /// This is the slow path using property access
    pub fn extractHeadersFromPlainObject(
        self: *AttributeMap,
        headers_obj: JSValue,
        header_list: *const HeaderNameList,
        globalObject: *JSGlobalObject,
    ) void {
        // Set up exception handling
        var catch_scope: jsc.CatchScope = undefined;
        catch_scope.init(globalObject, @src());
        defer catch_scope.deinit();

        // Fast path: Extract HTTPHeaderName headers
        for (header_list.fast_headers.items) |header_id| {
            const header_name = semconv.httpHeaderNameToString(header_id);

            const header_value_js = headers_obj.get(globalObject, header_name) catch {
                _ = catch_scope.clearException();
                continue;
            };
            if (header_value_js == null) continue;
            if (header_value_js.?.isNull() or header_value_js.?.isUndefined()) continue;
            if (!header_value_js.?.isString()) continue;

            // Build bitpacked key: context | header_id
            const header_key = header_list.context | @as(u16, header_id);
            self.setHeader(header_key, header_value_js.?) catch continue;
        }

        // Slow path: Extract OTel-specific headers
        for (header_list.slow_header_names.items, 0..) |header_name_str, i| {
            const header_id = header_list.slow_header_ids.items[i];
            const header_name_slice = header_name_str.toUTF8(self.allocator);
            defer header_name_slice.deinit();

            const header_value_js = headers_obj.get(globalObject, header_name_slice.slice()) catch {
                _ = catch_scope.clearException();
                continue;
            };
            if (header_value_js == null) continue;
            if (header_value_js.?.isNull() or header_value_js.?.isUndefined()) continue;
            if (!header_value_js.?.isString()) continue;

            // Build bitpacked key: context | FLAG_OTEL_HEADER | header_id
            const header_key = header_list.context | AttributeKey.FLAG_OTEL_HEADER | @as(u16, header_id);
            self.setHeader(header_key, header_value_js.?) catch continue;
        }
    }
};
