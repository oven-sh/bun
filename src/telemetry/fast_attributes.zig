//! Auto-generated fast attribute system with HTTPHeaderName alignment
//! DO NOT EDIT - run `bun run packages/bun-otel/scripts/generate-fast-attributes.ts`

const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;

/// Fast attribute key with HTTPHeaderName alignment and context namespacing
///
/// Bit layout (u16):
/// - Bits 0-6 (7 bits): Base ID (0-127)
///   - 0-92: HTTPHeaderName values from WebCore
///   - 93-127: OTel-specific HTTP headers (traceparent, etc.)
/// - Bit 7: OTel-specific header flag (when in HTTP context)
/// - Bits 8-11 (4 bits): Context namespace
///   - 0x000: Base OTel attributes
///   - 0x200: Server request headers
///   - 0x300: Server response headers
///   - 0x500: Fetch request headers
///   - 0x700: Fetch response headers
/// - Bit 15: Error flag (0x8000)
pub const AttributeKey = enum(u16) {
    // Base OTel attributes (context = 0x000)
    http_request_method = 0x0000,
    http_response_status_code = 0x0001,
    http_request_body_size = 0x0002,
    http_response_body_size = 0x0003,
    url_path = 0x0004,
    url_query = 0x0005,
    url_scheme = 0x0006,
    url_full = 0x0007,
    server_address = 0x0008,
    server_port = 0x0009,
    network_peer_address = 0x000A,
    network_peer_port = 0x000B,
    user_agent_original = 0x000C,
    error_type = 0x8000,
    error_message = 0x8001,
    operation_id = 0x000D,
    operation_timestamp = 0x000E,
    operation_duration = 0x000F,

    pub const COUNT = 18;

    // Context namespace constants
    pub const CONTEXT_BASE: u16 = 0x0000;
    pub const CONTEXT_SERVER_REQUEST: u16 = 0x0200;
    pub const CONTEXT_SERVER_RESPONSE: u16 = 0x0300;
    pub const CONTEXT_FETCH_REQUEST: u16 = 0x0500;
    pub const CONTEXT_FETCH_RESPONSE: u16 = 0x0700;
    pub const FLAG_OTEL_HEADER: u16 = 0x0080;
    pub const FLAG_ERROR: u16 = 0x8000;

    /// Extract base ID (bits 0-6)
    pub inline fn baseId(self: AttributeKey) u8 {
        return @intCast(@intFromEnum(self) & 0x7F);
    }

    /// Extract context (bits 8-11)
    pub inline fn context(self: AttributeKey) u16 {
        return @intFromEnum(self) & 0x0F00;
    }

    /// Check if this is an OTel-specific header (bit 7)
    pub inline fn isOTelHeader(self: AttributeKey) bool {
        return (@intFromEnum(self) & FLAG_OTEL_HEADER) != 0;
    }

    /// Check if this is an error attribute (bit 15)
    pub inline fn isError(self: AttributeKey) bool {
        return (@intFromEnum(self) & FLAG_ERROR) != 0;
    }
};

/// Convert attribute key to semantic convention string
/// For HTTP headers, returns the HTTP header name
pub fn fastAttributeNameToString(key: AttributeKey) []const u8 {
    // Check if this has a context (HTTP header)
    const ctx = key.context();
    if (ctx != 0) {
        const base_id = key.baseId();
        const is_otel_header = key.isOTelHeader();

        if (is_otel_header) {
            // OTel-specific HTTP headers (93-127)
            return switch (base_id) {
                93 => "traceparent",
                94 => "tracestate",
                95 => "baggage",
                else => "unknown-otel-header",
            };
        } else {
            // HTTPHeaderName (0-92)
            return switch (base_id) {
                0 => "accept",
                1 => "accept-charset",
                2 => "accept-encoding",
                3 => "accept-language",
                4 => "accept-ranges",
                5 => "access-control-allow-credentials",
                6 => "access-control-allow-headers",
                7 => "access-control-allow-methods",
                8 => "access-control-allow-origin",
                9 => "access-control-expose-headers",
                10 => "access-control-max-age",
                11 => "access-control-request-headers",
                12 => "access-control-request-method",
                13 => "age",
                14 => "authorization",
                15 => "cache-control",
                16 => "connection",
                17 => "content-disposition",
                18 => "content-encoding",
                19 => "content-language",
                20 => "content-length",
                21 => "content-location",
                22 => "content-range",
                23 => "content-security-policy",
                24 => "content-security-policy-report-only",
                25 => "content-type",
                26 => "cookie",
                27 => "cookie2",
                28 => "cross-origin-embedder-policy",
                29 => "cross-origin-embedder-policy-report-only",
                30 => "cross-origin-opener-policy",
                31 => "cross-origin-opener-policy-report-only",
                32 => "cross-origin-resource-policy",
                33 => "dnt",
                34 => "date",
                35 => "default-style",
                36 => "etag",
                37 => "expect",
                38 => "expires",
                39 => "host",
                40 => "icy-metaint",
                41 => "icy-metadata",
                42 => "if-match",
                43 => "if-modified-since",
                44 => "if-none-match",
                45 => "if-range",
                46 => "if-unmodified-since",
                47 => "keep-alive",
                48 => "last-event-id",
                49 => "last-modified",
                50 => "link",
                51 => "location",
                52 => "origin",
                53 => "ping-from",
                54 => "ping-to",
                55 => "pragma",
                56 => "proxy-authorization",
                57 => "purpose",
                58 => "range",
                59 => "referer",
                60 => "referrer-policy",
                61 => "refresh",
                62 => "report-to",
                63 => "sec-fetch-dest",
                64 => "sec-fetch-mode",
                65 => "sec-websocket-accept",
                66 => "sec-websocket-extensions",
                67 => "sec-websocket-key",
                68 => "sec-websocket-protocol",
                69 => "sec-websocket-version",
                70 => "server-timing",
                71 => "service-worker",
                72 => "service-worker-allowed",
                73 => "service-worker-navigation-preload",
                74 => "set-cookie",
                75 => "set-cookie2",
                76 => "sourcemap",
                77 => "strict-transport-security",
                78 => "te",
                79 => "timing-allow-origin",
                80 => "trailer",
                81 => "transfer-encoding",
                82 => "upgrade",
                83 => "upgrade-insecure-requests",
                84 => "user-agent",
                85 => "vary",
                86 => "via",
                87 => "x-content-type-options",
                88 => "x-dns-prefetch-control",
                89 => "x-frame-options",
                90 => "x-sourcemap",
                91 => "x-temp-tablet",
                92 => "x-xss-protection",
                else => "unknown-header",
            };
        }
    }

    // Base OTel attributes
    return switch (key) {
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
        .operation_id => "operation.id",
        .operation_timestamp => "operation.timestamp",
        .operation_duration => "operation.duration",
    };
}

/// Convert semantic convention string to attribute key
/// Returns null if not a recognized base attribute
/// Note: HTTP headers are looked up separately via context-specific functions
pub fn stringToFastAttributeKey(name: []const u8) ?AttributeKey {
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
    if (std.mem.startsWith(u8, name, "operation.")) {
        if (std.mem.eql(u8, name, "operation.id")) return .operation_id;
        if (std.mem.eql(u8, name, "operation.timestamp")) return .operation_timestamp;
        if (std.mem.eql(u8, name, "operation.duration")) return .operation_duration;
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
    if (std.mem.startsWith(u8, name, "user_agent.")) {
        if (std.mem.eql(u8, name, "user_agent.original")) return .user_agent_original;
        return null;
    }
    return null;
}

/// Pre-processed header name list for efficient header capture
/// Separates HTTPHeaderName (fast path) from OTel-specific headers (slow path)
pub const HeaderNameList = struct {
    /// HTTPHeaderName IDs (0-92) - can use fast FetchHeaders lookup
    fast_headers: std.ArrayList(u8),

    /// OTel-specific header names (traceparent, etc.) - need string lookup
    slow_header_names: std.ArrayList(bun.String),
    slow_header_ids: std.ArrayList(u8),

    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) HeaderNameList {
        return .{
            .fast_headers = std.ArrayList(u8).init(allocator),
            .slow_header_names = std.ArrayList(bun.String).init(allocator),
            .slow_header_ids = std.ArrayList(u8).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *HeaderNameList) void {
        self.fast_headers.deinit();
        for (self.slow_header_names.items) |str| {
            str.deref();
        }
        self.slow_header_names.deinit();
        self.slow_header_ids.deinit();
    }

    /// Parse a JS array of header name strings into fast/slow buckets
    pub fn fromJS(allocator: std.mem.Allocator, global: *JSGlobalObject, js_array: JSValue) !HeaderNameList {
        var list = HeaderNameList.init(allocator);
        errdefer list.deinit();

        const len = try js_array.getLength(global);
        var i: u32 = 0;
        while (i < len) : (i += 1) {
            const name_js = try js_array.getIndex(global, i);
            if (!name_js.isString()) continue;

            var name_zig: ZigString = ZigString.Empty;
            try name_js.toZigString(&name_zig, global);
            const name_slice = name_zig.toSlice(allocator);
            defer name_slice.deinit();

            // Try to match HTTPHeaderName first
            if (httpHeaderNameFromString(name_slice.slice())) |header_id| {
                try list.fast_headers.append(header_id);
            } else if (otelHeaderFromString(name_slice.slice())) |otel_header_id| {
                // OTel-specific header
                const name_str = bun.String.fromBytes(name_slice.slice());
                try list.slow_header_names.append(name_str);
                try list.slow_header_ids.append(otel_header_id);
            }
            // Unknown headers are silently ignored
        }

        return list;
    }

    /// Convert back to JS array for debugging/serialization
    pub fn toJS(self: *const HeaderNameList, global: *JSGlobalObject) JSValue {
        const total_len = self.fast_headers.items.len + self.slow_header_names.items.len;
        const array = JSValue.createEmptyArray(global, total_len);

        var idx: u32 = 0;

        // Add fast headers
        for (self.fast_headers.items) |header_id| {
            const name = httpHeaderNameToString(header_id);
            const name_js = ZigString.init(name).toJS(global);
            array.putIndex(global, idx, name_js);
            idx += 1;
        }

        // Add slow headers
        for (self.slow_header_names.items) |name_str| {
            const name_js = name_str.toJS(global);
            array.putIndex(global, idx, name_js);
            idx += 1;
        }

        return array;
    }
};

/// Look up HTTPHeaderName ID from string
fn httpHeaderNameFromString(name: []const u8) ?u8 {
    if (std.mem.eql(u8, name, "accept")) return 0;
    if (std.mem.eql(u8, name, "accept-charset")) return 1;
    if (std.mem.eql(u8, name, "accept-encoding")) return 2;
    if (std.mem.eql(u8, name, "accept-language")) return 3;
    if (std.mem.eql(u8, name, "accept-ranges")) return 4;
    if (std.mem.eql(u8, name, "access-control-allow-credentials")) return 5;
    if (std.mem.eql(u8, name, "access-control-allow-headers")) return 6;
    if (std.mem.eql(u8, name, "access-control-allow-methods")) return 7;
    if (std.mem.eql(u8, name, "access-control-allow-origin")) return 8;
    if (std.mem.eql(u8, name, "access-control-expose-headers")) return 9;
    if (std.mem.eql(u8, name, "access-control-max-age")) return 10;
    if (std.mem.eql(u8, name, "access-control-request-headers")) return 11;
    if (std.mem.eql(u8, name, "access-control-request-method")) return 12;
    if (std.mem.eql(u8, name, "age")) return 13;
    if (std.mem.eql(u8, name, "authorization")) return 14;
    if (std.mem.eql(u8, name, "cache-control")) return 15;
    if (std.mem.eql(u8, name, "connection")) return 16;
    if (std.mem.eql(u8, name, "content-disposition")) return 17;
    if (std.mem.eql(u8, name, "content-encoding")) return 18;
    if (std.mem.eql(u8, name, "content-language")) return 19;
    if (std.mem.eql(u8, name, "content-length")) return 20;
    if (std.mem.eql(u8, name, "content-location")) return 21;
    if (std.mem.eql(u8, name, "content-range")) return 22;
    if (std.mem.eql(u8, name, "content-security-policy")) return 23;
    if (std.mem.eql(u8, name, "content-security-policy-report-only")) return 24;
    if (std.mem.eql(u8, name, "content-type")) return 25;
    if (std.mem.eql(u8, name, "cookie")) return 26;
    if (std.mem.eql(u8, name, "cookie2")) return 27;
    if (std.mem.eql(u8, name, "cross-origin-embedder-policy")) return 28;
    if (std.mem.eql(u8, name, "cross-origin-embedder-policy-report-only")) return 29;
    if (std.mem.eql(u8, name, "cross-origin-opener-policy")) return 30;
    if (std.mem.eql(u8, name, "cross-origin-opener-policy-report-only")) return 31;
    if (std.mem.eql(u8, name, "cross-origin-resource-policy")) return 32;
    if (std.mem.eql(u8, name, "dnt")) return 33;
    if (std.mem.eql(u8, name, "date")) return 34;
    if (std.mem.eql(u8, name, "default-style")) return 35;
    if (std.mem.eql(u8, name, "etag")) return 36;
    if (std.mem.eql(u8, name, "expect")) return 37;
    if (std.mem.eql(u8, name, "expires")) return 38;
    if (std.mem.eql(u8, name, "host")) return 39;
    if (std.mem.eql(u8, name, "icy-metaint")) return 40;
    if (std.mem.eql(u8, name, "icy-metadata")) return 41;
    if (std.mem.eql(u8, name, "if-match")) return 42;
    if (std.mem.eql(u8, name, "if-modified-since")) return 43;
    if (std.mem.eql(u8, name, "if-none-match")) return 44;
    if (std.mem.eql(u8, name, "if-range")) return 45;
    if (std.mem.eql(u8, name, "if-unmodified-since")) return 46;
    if (std.mem.eql(u8, name, "keep-alive")) return 47;
    if (std.mem.eql(u8, name, "last-event-id")) return 48;
    if (std.mem.eql(u8, name, "last-modified")) return 49;
    if (std.mem.eql(u8, name, "link")) return 50;
    if (std.mem.eql(u8, name, "location")) return 51;
    if (std.mem.eql(u8, name, "origin")) return 52;
    if (std.mem.eql(u8, name, "ping-from")) return 53;
    if (std.mem.eql(u8, name, "ping-to")) return 54;
    if (std.mem.eql(u8, name, "pragma")) return 55;
    if (std.mem.eql(u8, name, "proxy-authorization")) return 56;
    if (std.mem.eql(u8, name, "purpose")) return 57;
    if (std.mem.eql(u8, name, "range")) return 58;
    if (std.mem.eql(u8, name, "referer")) return 59;
    if (std.mem.eql(u8, name, "referrer-policy")) return 60;
    if (std.mem.eql(u8, name, "refresh")) return 61;
    if (std.mem.eql(u8, name, "report-to")) return 62;
    if (std.mem.eql(u8, name, "sec-fetch-dest")) return 63;
    if (std.mem.eql(u8, name, "sec-fetch-mode")) return 64;
    if (std.mem.eql(u8, name, "sec-websocket-accept")) return 65;
    if (std.mem.eql(u8, name, "sec-websocket-extensions")) return 66;
    if (std.mem.eql(u8, name, "sec-websocket-key")) return 67;
    if (std.mem.eql(u8, name, "sec-websocket-protocol")) return 68;
    if (std.mem.eql(u8, name, "sec-websocket-version")) return 69;
    if (std.mem.eql(u8, name, "server-timing")) return 70;
    if (std.mem.eql(u8, name, "service-worker")) return 71;
    if (std.mem.eql(u8, name, "service-worker-allowed")) return 72;
    if (std.mem.eql(u8, name, "service-worker-navigation-preload")) return 73;
    if (std.mem.eql(u8, name, "set-cookie")) return 74;
    if (std.mem.eql(u8, name, "set-cookie2")) return 75;
    if (std.mem.eql(u8, name, "sourcemap")) return 76;
    if (std.mem.eql(u8, name, "strict-transport-security")) return 77;
    if (std.mem.eql(u8, name, "te")) return 78;
    if (std.mem.eql(u8, name, "timing-allow-origin")) return 79;
    if (std.mem.eql(u8, name, "trailer")) return 80;
    if (std.mem.eql(u8, name, "transfer-encoding")) return 81;
    if (std.mem.eql(u8, name, "upgrade")) return 82;
    if (std.mem.eql(u8, name, "upgrade-insecure-requests")) return 83;
    if (std.mem.eql(u8, name, "user-agent")) return 84;
    if (std.mem.eql(u8, name, "vary")) return 85;
    if (std.mem.eql(u8, name, "via")) return 86;
    if (std.mem.eql(u8, name, "x-content-type-options")) return 87;
    if (std.mem.eql(u8, name, "x-dns-prefetch-control")) return 88;
    if (std.mem.eql(u8, name, "x-frame-options")) return 89;
    if (std.mem.eql(u8, name, "x-sourcemap")) return 90;
    if (std.mem.eql(u8, name, "x-temp-tablet")) return 91;
    if (std.mem.eql(u8, name, "x-xss-protection")) return 92;
    return null;
}

/// Look up OTel-specific header ID from string
fn otelHeaderFromString(name: []const u8) ?u8 {
    if (std.mem.eql(u8, name, "traceparent")) return 93;
    if (std.mem.eql(u8, name, "tracestate")) return 94;
    if (std.mem.eql(u8, name, "baggage")) return 95;
    return null;
}

/// Convert HTTPHeaderName ID to string
fn httpHeaderNameToString(id: u8) []const u8 {
    return switch (id) {
        0 => "accept",
        1 => "accept-charset",
        2 => "accept-encoding",
        3 => "accept-language",
        4 => "accept-ranges",
        5 => "access-control-allow-credentials",
        6 => "access-control-allow-headers",
        7 => "access-control-allow-methods",
        8 => "access-control-allow-origin",
        9 => "access-control-expose-headers",
        10 => "access-control-max-age",
        11 => "access-control-request-headers",
        12 => "access-control-request-method",
        13 => "age",
        14 => "authorization",
        15 => "cache-control",
        16 => "connection",
        17 => "content-disposition",
        18 => "content-encoding",
        19 => "content-language",
        20 => "content-length",
        21 => "content-location",
        22 => "content-range",
        23 => "content-security-policy",
        24 => "content-security-policy-report-only",
        25 => "content-type",
        26 => "cookie",
        27 => "cookie2",
        28 => "cross-origin-embedder-policy",
        29 => "cross-origin-embedder-policy-report-only",
        30 => "cross-origin-opener-policy",
        31 => "cross-origin-opener-policy-report-only",
        32 => "cross-origin-resource-policy",
        33 => "dnt",
        34 => "date",
        35 => "default-style",
        36 => "etag",
        37 => "expect",
        38 => "expires",
        39 => "host",
        40 => "icy-metaint",
        41 => "icy-metadata",
        42 => "if-match",
        43 => "if-modified-since",
        44 => "if-none-match",
        45 => "if-range",
        46 => "if-unmodified-since",
        47 => "keep-alive",
        48 => "last-event-id",
        49 => "last-modified",
        50 => "link",
        51 => "location",
        52 => "origin",
        53 => "ping-from",
        54 => "ping-to",
        55 => "pragma",
        56 => "proxy-authorization",
        57 => "purpose",
        58 => "range",
        59 => "referer",
        60 => "referrer-policy",
        61 => "refresh",
        62 => "report-to",
        63 => "sec-fetch-dest",
        64 => "sec-fetch-mode",
        65 => "sec-websocket-accept",
        66 => "sec-websocket-extensions",
        67 => "sec-websocket-key",
        68 => "sec-websocket-protocol",
        69 => "sec-websocket-version",
        70 => "server-timing",
        71 => "service-worker",
        72 => "service-worker-allowed",
        73 => "service-worker-navigation-preload",
        74 => "set-cookie",
        75 => "set-cookie2",
        76 => "sourcemap",
        77 => "strict-transport-security",
        78 => "te",
        79 => "timing-allow-origin",
        80 => "trailer",
        81 => "transfer-encoding",
        82 => "upgrade",
        83 => "upgrade-insecure-requests",
        84 => "user-agent",
        85 => "vary",
        86 => "via",
        87 => "x-content-type-options",
        88 => "x-dns-prefetch-control",
        89 => "x-frame-options",
        90 => "x-sourcemap",
        91 => "x-temp-tablet",
        92 => "x-xss-protection",
        else => "unknown",
    };
}
