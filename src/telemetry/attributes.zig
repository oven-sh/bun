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

/// Import generated semantic conventions (string constants only)
const semconv = @import("semconv.zig");

// ============================================================================
// Header Direction - Shared enum for request/response classification
// ============================================================================

/// Header direction for HTTP header attributes
/// Used to distinguish between request and response headers in both
/// AttributeKey.httpDirection() and HeaderNameList.fromJS()
pub const HeaderDirection = enum { request, response };

// ============================================================================
// External C Function - HTTP Header Name Lookup
// ============================================================================

/// Fast HTTP header name lookup using gperf-generated perfect hash table
/// Returns HTTPHeaderName enum value (0-92) or 255 if not found
/// Source: src/bun.js/bindings/webcore/HTTPHeaderNames.cpp:658
extern "C" fn Bun__HTTPHeaderName__fromString(str: [*]const u8, len: usize) u8;

/// Look up HTTPHeaderName ID from string (case-insensitive)
/// Uses the existing WebCore::findHTTPHeaderName C++ function with gperf perfect hash
/// Returns null if the header is not in the predefined list of 93 headers
pub fn httpHeaderNameFromString(name: []const u8) ?u8 {
    const result = Bun__HTTPHeaderName__fromString(name.ptr, name.len);
    if (result == 255) return null; // Not found
    return result;
}

// ============================================================================
// AttributeKey - Pointer-based struct system per contract
// ============================================================================

/// AttributeKey represents a semantic convention attribute key.
/// Each key has a unique ID for O(1) operations in attribute lists/maps.
pub const AttributeKey = struct {
    id: u16, // Position in global list (0-1023)
    semconv_name: []const u8, // e.g. "http.request.header.content-type"
    fast_header: ?u8, // HTTPHeaderNames enum (0-92) if applicable
    http_header: ?[]const u8, // Naked header string e.g. "content-type"

    pub fn isHttpHeader(self: *const AttributeKey) bool {
        return self.http_header != null;
    }

    /// Get HTTP direction by checking semconv_name prefix
    pub fn httpDirection(self: *const AttributeKey) ?HeaderDirection {
        if (self.semconv_name.len < 8) return null;
        if (!std.mem.startsWith(u8, self.semconv_name, "http.")) return null;
        if (self.semconv_name[7] == 'q') return .request; // "http.request."
        if (self.semconv_name[7] == 's') return .response; // "http.response."
        return null;
    }
};

/// AttributeKeys singleton - global registry of all AttributeKey pointers
pub const AttributeKeys = struct {
    // Well-known semconv attributes (core attributes used in http.zig and fetch.zig)
    http_request_method: *AttributeKey,
    http_response_status_code: *AttributeKey,
    http_response_body_size: *AttributeKey,
    http_route: *AttributeKey,
    url_path: *AttributeKey,
    url_query: *AttributeKey,
    url_scheme: *AttributeKey,
    url_full: *AttributeKey,
    server_address: *AttributeKey,
    server_port: *AttributeKey,
    client_address: *AttributeKey,
    client_port: *AttributeKey,
    network_peer_address: *AttributeKey,
    network_peer_port: *AttributeKey,
    network_protocol_name: *AttributeKey,
    network_protocol_version: *AttributeKey,
    user_agent_original: *AttributeKey,
    error_type: *AttributeKey,
    error_message: *AttributeKey,
    exception_type: *AttributeKey,
    exception_message: *AttributeKey,
    exception_stacktrace: *AttributeKey,

    // Operation-level attributes (not in OTel semconv but used internally)
    operation_id: *AttributeKey,
    operation_timestamp: *AttributeKey,
    operation_duration: *AttributeKey,

    // Distributed tracing attributes (W3C Trace Context)
    trace_parent_trace_id: *AttributeKey,
    trace_parent_span_id: *AttributeKey,
    trace_parent_trace_flags: *AttributeKey,

    // Error attributes
    error_stack_trace: *AttributeKey,

    // Database/SQL attributes
    db_system_name: *AttributeKey,
    db_namespace: *AttributeKey,
    db_collection_name: *AttributeKey,
    db_operation_name: *AttributeKey,
    db_query_summary: *AttributeKey,
    db_query_text: *AttributeKey,
    db_response_status_code: *AttributeKey,
    db_response_returned_rows: *AttributeKey,

    // Global list of all AttributeKeys (well-known + dynamically allocated)
    all: [1024]*AttributeKey,
    len: u16,
    allocator: std.mem.Allocator,

    /// Initialize the singleton with well-known attributes
    pub fn init(allocator: std.mem.Allocator) !AttributeKeys {
        var keys: AttributeKeys = undefined;
        keys.allocator = allocator;
        keys.len = 0;

        // Allocate well-known semconv attributes using allocateAttribute helper
        keys.http_request_method = try keys.allocateAttribute(semconv.ATTR_HTTP_REQUEST_METHOD);
        keys.http_response_status_code = try keys.allocateAttribute(semconv.ATTR_HTTP_RESPONSE_STATUS_CODE);
        keys.http_response_body_size = try keys.allocateAttribute("http.response.body.size");
        keys.http_route = try keys.allocateAttribute(semconv.ATTR_HTTP_ROUTE);
        keys.url_path = try keys.allocateAttribute(semconv.ATTR_URL_PATH);
        keys.url_query = try keys.allocateAttribute(semconv.ATTR_URL_QUERY);
        keys.url_scheme = try keys.allocateAttribute(semconv.ATTR_URL_SCHEME);
        keys.url_full = try keys.allocateAttribute(semconv.ATTR_URL_FULL);
        keys.server_address = try keys.allocateAttribute(semconv.ATTR_SERVER_ADDRESS);
        keys.server_port = try keys.allocateAttribute(semconv.ATTR_SERVER_PORT);
        keys.client_address = try keys.allocateAttribute(semconv.ATTR_CLIENT_ADDRESS);
        keys.client_port = try keys.allocateAttribute(semconv.ATTR_CLIENT_PORT);
        keys.network_peer_address = try keys.allocateAttribute(semconv.ATTR_NETWORK_PEER_ADDRESS);
        keys.network_peer_port = try keys.allocateAttribute(semconv.ATTR_NETWORK_PEER_PORT);
        keys.network_protocol_name = try keys.allocateAttribute(semconv.ATTR_NETWORK_PROTOCOL_NAME);
        keys.network_protocol_version = try keys.allocateAttribute(semconv.ATTR_NETWORK_PROTOCOL_VERSION);
        keys.user_agent_original = try keys.allocateAttribute(semconv.ATTR_USER_AGENT_ORIGINAL);
        keys.error_type = try keys.allocateAttribute(semconv.ATTR_ERROR_TYPE);
        keys.error_message = try keys.allocateAttribute("error.message");
        keys.exception_type = try keys.allocateAttribute(semconv.ATTR_EXCEPTION_TYPE);
        keys.exception_message = try keys.allocateAttribute(semconv.ATTR_EXCEPTION_MESSAGE);
        keys.exception_stacktrace = try keys.allocateAttribute(semconv.ATTR_EXCEPTION_STACKTRACE);

        // Operation-level attributes (internal, not in OTel semconv)
        keys.operation_id = try keys.allocateAttribute("operation.id");
        keys.operation_timestamp = try keys.allocateAttribute("operation.timestamp");
        keys.operation_duration = try keys.allocateAttribute("operation.duration");

        // Database/SQL attributes
        keys.db_system_name = try keys.allocateAttribute(semconv.ATTR_DB_SYSTEM_NAME);
        keys.db_namespace = try keys.allocateAttribute(semconv.ATTR_DB_NAMESPACE);
        keys.db_collection_name = try keys.allocateAttribute(semconv.ATTR_DB_COLLECTION_NAME);
        keys.db_operation_name = try keys.allocateAttribute(semconv.ATTR_DB_OPERATION_NAME);
        keys.db_query_summary = try keys.allocateAttribute(semconv.ATTR_DB_QUERY_SUMMARY);
        keys.db_query_text = try keys.allocateAttribute(semconv.ATTR_DB_QUERY_TEXT);
        keys.db_response_status_code = try keys.allocateAttribute(semconv.ATTR_DB_RESPONSE_STATUS_CODE);
        keys.db_response_returned_rows = try keys.allocateAttribute("db.response.returned_rows");

        // Distributed tracing attributes (W3C Trace Context)
        keys.trace_parent_trace_id = try keys.allocateAttribute("trace.parent.trace_id");
        keys.trace_parent_span_id = try keys.allocateAttribute("trace.parent.span_id");
        keys.trace_parent_trace_flags = try keys.allocateAttribute("trace.parent.trace_flags");

        // Error attributes
        keys.error_stack_trace = try keys.allocateAttribute("error.stack_trace");

        return keys;
    }

    /// Clean up all allocated AttributeKeys
    pub fn deinit(self: *AttributeKeys) void {
        for (self.all[0..self.len]) |key| {
            self.allocator.destroy(key);
        }
    }

    /// Look up an AttributeKey by semconv name (linear search, infrequent use)
    pub fn lookupSemconv(self: *AttributeKeys, name: []const u8) ?*AttributeKey {
        for (self.all[0..self.len]) |key| {
            if (std.mem.eql(u8, key.semconv_name, name)) {
                return key;
            }
        }
        return null;
    }

    /// Look up an HTTP header AttributeKey by direction and header name
    pub fn lookupHeader(
        self: *AttributeKeys,
        direction: HeaderDirection,
        header: []const u8,
    ) ?*AttributeKey {
        // Search for header attribute matching direction and name
        for (self.all[0..self.len]) |key| {
            if (key.http_header) |key_header| {
                if (std.mem.eql(u8, key_header, header)) {
                    // Check direction matches
                    if (key.httpDirection() == direction) {
                        return key;
                    }
                }
            }
        }
        return null;
    }

    /// Allocate a new uncommon AttributeKey (internal helper)
    /// Auto-detects HTTP headers and populates fast_header/http_header from semconv_name
    fn allocateAttribute(
        self: *AttributeKeys,
        semconv_name: []const u8,
    ) !*AttributeKey {
        if (self.len >= 1024) return error.AttributePoolExhausted;

        // Auto-detect HTTP headers and populate fast_header/http_header
        var fast_header_opt: ?u8 = null;
        var http_header_opt: ?[]const u8 = null;

        if (std.mem.startsWith(u8, semconv_name, "http.request.header.") or
            std.mem.startsWith(u8, semconv_name, "http.response.header."))
        {
            const header_start = if (std.mem.startsWith(u8, semconv_name, "http.request.header."))
                "http.request.header.".len
            else
                "http.response.header.".len;

            const header_name = semconv_name[header_start..];

            // Try to match against HTTPHeaderName (0-92)
            if (httpHeaderNameFromString(header_name)) |header_id| {
                fast_header_opt = header_id;
            }

            // Store naked header name
            http_header_opt = header_name;
        }

        const key = try self.allocator.create(AttributeKey);
        key.* = .{
            .id = self.len,
            .semconv_name = semconv_name,
            .fast_header = fast_header_opt,
            .http_header = http_header_opt,
        };
        self.all[self.len] = key;
        self.len += 1;
        return key;
    }

    /// Create or retrieve an AttributeKey from a JavaScript string value
    /// Validates semconv name format per FR03a and allocates from pool if needed
    pub fn fromJS(self: *AttributeKeys, js_val: JSValue, global: *JSGlobalObject) ?*AttributeKey {
        // Extract string from JSValue
        if (!js_val.isString()) return null;

        var zig_str: ZigString = ZigString.Empty;
        js_val.toZigString(&zig_str, global) catch return null;
        const name_slice = zig_str.toSlice(self.allocator);
        defer name_slice.deinit();
        const name = name_slice.slice();

        // Validate semconv name format (FR03a):
        // - Max 1024 characters
        // - Lowercase letters and numbers only
        // - Dots allowed (not at start/end)
        // - Format: [a-z0-9]+([.][a-z0-9]+)*
        if (name.len == 0 or name.len > 1024) return null;
        if (name[0] == '.' or name[name.len - 1] == '.') return null;

        var prev_was_dot = false;
        for (name) |c| {
            if (c == '.') {
                if (prev_was_dot) return null; // consecutive dots not allowed
                prev_was_dot = true;
            } else if ((c >= 'a' and c <= 'z') or (c >= '0' and c <= '9')) {
                prev_was_dot = false;
            } else {
                return null; // invalid character
            }
        }

        // Check if this key already exists
        if (self.lookupSemconv(name)) |existing_key| {
            return existing_key;
        }

        // Allocate new key - need to copy the string to allocator memory
        const name_copy = self.allocator.dupe(u8, name) catch return null;
        errdefer self.allocator.free(name_copy);

        // Allocate the new attribute (allocateAttribute auto-detects HTTP headers)
        const new_key = self.allocateAttribute(name_copy) catch return null;

        return new_key;
    }

    /// Get or create an HTTP header AttributeKey
    /// This is the primary API for HeaderNameList to convert header names to AttributeKeys
    ///
    /// Builds the semconv name as "http.{direction}.header.{header_name}"
    /// Auto-detects fast_header (HTTPHeaderName ID) if the header is in the standard list
    ///
    /// Examples:
    ///   getOrCreateHeaderKey(.request, "content-type") → "http.request.header.content-type"
    ///   getOrCreateHeaderKey(.response, "content-length") → "http.response.header.content-length"
    pub fn getOrCreateHeaderKey(
        self: *AttributeKeys,
        direction: HeaderDirection,
        header_name: []const u8,
    ) !*AttributeKey {
        // Build semconv name
        const prefix = if (direction == .request)
            "http.request.header."
        else
            "http.response.header.";

        var buf: [256]u8 = undefined;
        const semconv_name = try std.fmt.bufPrint(&buf, "{s}{s}", .{ prefix, header_name });

        // Look up existing
        if (self.lookupSemconv(semconv_name)) |existing| {
            return existing;
        }

        // Allocate new - need to copy string to allocator memory
        const name_copy = try self.allocator.dupe(u8, semconv_name);
        return try self.allocateAttribute(name_copy);
    }
};

/// Convert value to JSValue based on type
fn convertToJSValue(global: *JSGlobalObject, val: anytype) JSValue {
    const T = @TypeOf(val);
    const type_info = @typeInfo(T);

    // Handle different type categories
    if (type_info == .pointer) {
        const ptr_info = type_info.pointer;
        if (ptr_info.size == .slice) {
            if (ptr_info.child == u8) {
                // []const u8 or []u8 - string slice
                return ZigString.init(val).toJS(global);
            }
            @compileError("Unsupported slice type: " ++ @typeName(T));
        } else if (ptr_info.size == .one) {
            // Check if it's a pointer to an array of u8 (e.g., *const [N]u8)
            const child_type_info = @typeInfo(ptr_info.child);
            if (child_type_info == .array and child_type_info.array.child == u8) {
                // *const [N]u8 - pointer to fixed-size array of bytes (string)
                return ZigString.init(val).toJS(global);
            }
            @compileError("Unsupported pointer type: " ++ @typeName(T));
        }
        @compileError("Unsupported pointer type: " ++ @typeName(T));
    }

    // Try direct type matching
    if (T == JSValue) return val;
    if (T == ZigString) return val.toJS(global);
    if (T == bun.String) return val.toJS(global);

    // Numeric types
    if (T == u64 or T == i64 or T == u32 or T == i32 or T == u16 or T == i16 or T == u8 or T == i8 or T == i128 or T == u128) {
        return JSValue.jsNumber(@as(f64, @floatFromInt(val)));
    }
    if (T == f64 or T == f32) {
        return JSValue.jsNumber(@as(f64, val));
    }

    // Boolean
    if (T == bool) return JSValue.jsBoolean(val);

    @compileError("Unsupported attribute value type: " ++ @typeName(T));
}

/// Optimized attribute map with single JSValue storage
/// Contract: specs/001-opentelemetry-support/contracts/attributes.md (lines 196-232)
pub const AttributeMap = struct {
    js_map: JSValue, // Internal JS object storage
    global: *JSGlobalObject,

    /// Initialize empty attribute map
    pub fn init(global: *JSGlobalObject) AttributeMap {
        return .{
            .js_map = JSValue.createEmptyObject(global, 16), // Hint: typical ~16 attributes
            .global = global,
        };
    }

    /// No explicit deinit needed - JSValue is GC-managed
    pub fn deinit(self: *AttributeMap) void {
        _ = self;
    }

    /// Set an attribute value
    /// Accepts AttributeKey pointer and various value types
    /// Automatically converts non-JSValue types to JSValue
    pub fn set(self: *AttributeMap, key: *const AttributeKey, val: anytype) void {
        const js_val = convertToJSValue(self.global, val);
        self.js_map.put(self.global, key.semconv_name, js_val);
    }

    /// INTERNAL IMPLEMENTATION DETAIL - DO NOT CALL FROM APPLICATION CODE
    /// This method is called internally by TelemetryContext.notifyOperation* methods
    /// Application code should pass AttributeMap by pointer (&attrs), never call toJS() directly
    pub fn toJS(self: *AttributeMap) JSValue {
        return self.js_map;
    }

    /// Extract headers from FetchHeaders object using configured header list
    /// Note: Header extraction is currently disabled - headers are not captured
    /// This is a placeholder for future implementation when header capture is re-enabled
    /// When implemented, use std.ArrayList(*const AttributeKey) for header_list
    pub fn extractHeadersFromFetchHeaders(
        self: *AttributeMap,
        headers_obj: JSValue,
        header_list: anytype,
        globalObject: *JSGlobalObject,
    ) void {
        _ = self;
        _ = headers_obj;
        _ = header_list;
        _ = globalObject;
        // Header extraction temporarily disabled during refactoring
    }

    /// Extract headers from plain JavaScript object
    /// Note: Header extraction is currently disabled - headers are not captured
    /// This is a placeholder for future implementation when header capture is re-enabled
    /// When implemented, use std.ArrayList(*const AttributeKey) for header_list
    pub fn extractHeadersFromPlainObject(
        self: *AttributeMap,
        headers_obj: JSValue,
        header_list: anytype,
        globalObject: *JSGlobalObject,
    ) void {
        _ = self;
        _ = headers_obj;
        _ = header_list;
        _ = globalObject;
        // Header extraction temporarily disabled during refactoring
    }

    /// Extract headers from native FetchHeaders object using configured header list
    /// This is the most efficient header extraction path - uses AttributeKey pointers with fast_header optimization
    /// Expects header_list to be *const HeaderNameList with .items: ArrayList(*const AttributeKey)
    pub fn extractHeadersFromNativeFetchHeaders(
        self: *AttributeMap,
        fetch_headers: *bun.webcore.FetchHeaders,
        header_list: anytype,
        globalObject: *JSGlobalObject,
    ) void {
        // header_list.items is ArrayList, need to access .items to get the slice
        for (header_list.items.items) |attr_key| {
            // Fast path: use pre-computed fast_header ID for O(1) lookup
            if (attr_key.fast_header) |fast_id| {
                const header_enum = @as(bun.webcore.FetchHeaders.HTTPHeaderName, @enumFromInt(fast_id));
                if (fetch_headers.fastGet(header_enum)) |zig_str| {
                    if (zig_str.len > 0) {
                        // Set using AttributeKey pointer (no string conversion needed!)
                        self.set(attr_key, zig_str.slice());
                    }
                }
            } else if (attr_key.http_header) |header_name| {
                // Slow path: string lookup for non-fast headers
                if (fetch_headers.get(header_name, globalObject)) |header_value| {
                    if (header_value.len > 0) {
                        self.set(attr_key, header_value);
                    }
                }
            }
        }
    }
};
