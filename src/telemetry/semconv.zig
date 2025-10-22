//! OpenTelemetry Semantic Conventions - Complete
//!
//! This file is auto-generated and contains:
//! 1. Fast attribute system with HTTPHeaderName alignment
//! 2. String constants from @opentelemetry/semantic-conventions
//! 3. HeaderNameList for configuration preprocessing
//! 4. Helper functions for attribute lookups
//!
//! DO NOT EDIT - run `bun run packages/bun-otel/scripts/generate-semconv-complete.ts`

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;

// ============================================================================
// Fast Attribute System with HTTPHeaderName Alignment
// ============================================================================

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
    http_route = 0x0002,
    url_path = 0x0003,
    url_query = 0x0004,
    url_scheme = 0x0005,
    url_full = 0x0006,
    url_fragment = 0x0007,
    server_address = 0x0008,
    server_port = 0x0009,
    client_address = 0x000A,
    client_port = 0x000B,
    network_peer_address = 0x000C,
    network_peer_port = 0x000D,
    network_local_address = 0x000E,
    network_local_port = 0x000F,
    network_protocol_name = 0x0010,
    network_protocol_version = 0x0011,
    network_transport = 0x0012,
    network_type = 0x0013,
    user_agent_original = 0x0014,
    service_name = 0x0015,
    service_version = 0x0016,
    telemetry_sdk_name = 0x0017,
    telemetry_sdk_version = 0x0018,
    telemetry_sdk_language = 0x0019,
    otel_status_code = 0x001A,
    otel_status_description = 0x001B,
    otel_scope_name = 0x001C,
    otel_scope_version = 0x001D,
    error_type = 0x8000,
    exception_type = 0x8001,
    exception_message = 0x8002,
    exception_stacktrace = 0x8003,
    exception_escaped = 0x8004,

    pub const COUNT = 30;

    // Context namespace constants
    pub const CONTEXT_BASE: u16 = 0x0000;
    pub const CONTEXT_SERVER_REQUEST: u16 = 0x0200;
    pub const CONTEXT_SERVER_RESPONSE: u16 = 0x0300;
    pub const CONTEXT_FETCH_REQUEST: u16 = 0x0500;
    pub const CONTEXT_FETCH_RESPONSE: u16 = 0x0700;
    pub const FLAG_OTEL_HEADER: u16 = 0x0080;
    pub const FLAG_ERROR: u16 = 0x8000;

    /// Create header attribute key from context and HTTPHeaderName ID
    pub inline fn fromHeader(context: u16, header_id: u8) u16 {
        return context | @as(u16, header_id);
    }

    /// Create OTel header attribute key from context and header ID
    pub inline fn fromOTelHeader(context: u16, header_id: u8) u16 {
        return context | FLAG_OTEL_HEADER | @as(u16, header_id);
    }

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
/// For HTTP headers, builds the full attribute name
pub fn fastAttributeNameToString(key: AttributeKey) []const u8 {
    // Check if this has a context (HTTP header)
    const ctx = key.context();
    if (ctx != 0) {
        const base_id = key.baseId();
        const is_otel_header = key.isOTelHeader();

        if (is_otel_header) {
            // OTel-specific HTTP headers (93-127)
            return switch (base_id) {
                93 => switch (ctx) {
                    AttributeKey.CONTEXT_SERVER_REQUEST, AttributeKey.CONTEXT_FETCH_REQUEST => "http.request.header.traceparent",
                    AttributeKey.CONTEXT_SERVER_RESPONSE, AttributeKey.CONTEXT_FETCH_RESPONSE => "http.response.header.traceparent",
                    else => "traceparent",
                },
                94 => switch (ctx) {
                    AttributeKey.CONTEXT_SERVER_REQUEST, AttributeKey.CONTEXT_FETCH_REQUEST => "http.request.header.tracestate",
                    AttributeKey.CONTEXT_SERVER_RESPONSE, AttributeKey.CONTEXT_FETCH_RESPONSE => "http.response.header.tracestate",
                    else => "tracestate",
                },
                95 => switch (ctx) {
                    AttributeKey.CONTEXT_SERVER_REQUEST, AttributeKey.CONTEXT_FETCH_REQUEST => "http.request.header.baggage",
                    AttributeKey.CONTEXT_SERVER_RESPONSE, AttributeKey.CONTEXT_FETCH_RESPONSE => "http.response.header.baggage",
                    else => "baggage",
                },
                else => "unknown-otel-header",
            };
        } else {
            // HTTPHeaderName (0-92)
            const header_name = switch (base_id) {
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

            // Build full attribute name based on context
            return switch (ctx) {
                AttributeKey.CONTEXT_SERVER_REQUEST, AttributeKey.CONTEXT_FETCH_REQUEST => "http.request.header." ++ header_name,
                AttributeKey.CONTEXT_SERVER_RESPONSE, AttributeKey.CONTEXT_FETCH_RESPONSE => "http.response.header." ++ header_name,
                else => header_name,
            };
        }
    }

    // Base OTel attributes - use the actual semconv values
    return switch (key) {
        .http_request_method => ATTR_HTTP_REQUEST_METHOD,
        .http_response_status_code => ATTR_HTTP_RESPONSE_STATUS_CODE,
        .http_route => ATTR_HTTP_ROUTE,
        .url_path => ATTR_URL_PATH,
        .url_query => ATTR_URL_QUERY,
        .url_scheme => ATTR_URL_SCHEME,
        .url_full => ATTR_URL_FULL,
        .url_fragment => ATTR_URL_FRAGMENT,
        .server_address => ATTR_SERVER_ADDRESS,
        .server_port => ATTR_SERVER_PORT,
        .client_address => ATTR_CLIENT_ADDRESS,
        .client_port => ATTR_CLIENT_PORT,
        .network_peer_address => ATTR_NETWORK_PEER_ADDRESS,
        .network_peer_port => ATTR_NETWORK_PEER_PORT,
        .network_local_address => ATTR_NETWORK_LOCAL_ADDRESS,
        .network_local_port => ATTR_NETWORK_LOCAL_PORT,
        .network_protocol_name => ATTR_NETWORK_PROTOCOL_NAME,
        .network_protocol_version => ATTR_NETWORK_PROTOCOL_VERSION,
        .network_transport => ATTR_NETWORK_TRANSPORT,
        .network_type => ATTR_NETWORK_TYPE,
        .user_agent_original => ATTR_USER_AGENT_ORIGINAL,
        .service_name => ATTR_SERVICE_NAME,
        .service_version => ATTR_SERVICE_VERSION,
        .telemetry_sdk_name => ATTR_TELEMETRY_SDK_NAME,
        .telemetry_sdk_version => ATTR_TELEMETRY_SDK_VERSION,
        .telemetry_sdk_language => ATTR_TELEMETRY_SDK_LANGUAGE,
        .otel_status_code => ATTR_OTEL_STATUS_CODE,
        .otel_status_description => ATTR_OTEL_STATUS_DESCRIPTION,
        .otel_scope_name => ATTR_OTEL_SCOPE_NAME,
        .otel_scope_version => ATTR_OTEL_SCOPE_VERSION,
        .error_type => ATTR_ERROR_TYPE,
        .exception_type => ATTR_EXCEPTION_TYPE,
        .exception_message => ATTR_EXCEPTION_MESSAGE,
        .exception_stacktrace => ATTR_EXCEPTION_STACKTRACE,
        .exception_escaped => ATTR_EXCEPTION_ESCAPED,
    };
}

/// Convert semantic convention string to attribute key
/// Returns null if not a recognized base attribute
/// Note: HTTP headers are looked up separately via context-specific functions
pub fn stringToFastAttributeKey(name: []const u8) ?AttributeKey {
    if (std.mem.startsWith(u8, name, "network.")) {
        if (std.mem.eql(u8, name, ATTR_NETWORK_PEER_ADDRESS)) return .network_peer_address;
        if (std.mem.eql(u8, name, ATTR_NETWORK_PEER_PORT)) return .network_peer_port;
        if (std.mem.eql(u8, name, ATTR_NETWORK_LOCAL_ADDRESS)) return .network_local_address;
        if (std.mem.eql(u8, name, ATTR_NETWORK_LOCAL_PORT)) return .network_local_port;
        if (std.mem.eql(u8, name, ATTR_NETWORK_PROTOCOL_NAME)) return .network_protocol_name;
        if (std.mem.eql(u8, name, ATTR_NETWORK_PROTOCOL_VERSION)) return .network_protocol_version;
        if (std.mem.eql(u8, name, ATTR_NETWORK_TRANSPORT)) return .network_transport;
        if (std.mem.eql(u8, name, ATTR_NETWORK_TYPE)) return .network_type;
        return null;
    }
    if (std.mem.startsWith(u8, name, "url.")) {
        if (std.mem.eql(u8, name, ATTR_URL_PATH)) return .url_path;
        if (std.mem.eql(u8, name, ATTR_URL_QUERY)) return .url_query;
        if (std.mem.eql(u8, name, ATTR_URL_SCHEME)) return .url_scheme;
        if (std.mem.eql(u8, name, ATTR_URL_FULL)) return .url_full;
        if (std.mem.eql(u8, name, ATTR_URL_FRAGMENT)) return .url_fragment;
        return null;
    }
    if (std.mem.startsWith(u8, name, "otel.")) {
        if (std.mem.eql(u8, name, ATTR_OTEL_STATUS_CODE)) return .otel_status_code;
        if (std.mem.eql(u8, name, ATTR_OTEL_STATUS_DESCRIPTION)) return .otel_status_description;
        if (std.mem.eql(u8, name, ATTR_OTEL_SCOPE_NAME)) return .otel_scope_name;
        if (std.mem.eql(u8, name, ATTR_OTEL_SCOPE_VERSION)) return .otel_scope_version;
        return null;
    }
    if (std.mem.startsWith(u8, name, "exception.")) {
        if (std.mem.eql(u8, name, ATTR_EXCEPTION_TYPE)) return .exception_type;
        if (std.mem.eql(u8, name, ATTR_EXCEPTION_MESSAGE)) return .exception_message;
        if (std.mem.eql(u8, name, ATTR_EXCEPTION_STACKTRACE)) return .exception_stacktrace;
        if (std.mem.eql(u8, name, ATTR_EXCEPTION_ESCAPED)) return .exception_escaped;
        return null;
    }
    if (std.mem.startsWith(u8, name, "http.")) {
        if (std.mem.eql(u8, name, ATTR_HTTP_REQUEST_METHOD)) return .http_request_method;
        if (std.mem.eql(u8, name, ATTR_HTTP_RESPONSE_STATUS_CODE)) return .http_response_status_code;
        if (std.mem.eql(u8, name, ATTR_HTTP_ROUTE)) return .http_route;
        return null;
    }
    if (std.mem.startsWith(u8, name, "telemetry.")) {
        if (std.mem.eql(u8, name, ATTR_TELEMETRY_SDK_NAME)) return .telemetry_sdk_name;
        if (std.mem.eql(u8, name, ATTR_TELEMETRY_SDK_VERSION)) return .telemetry_sdk_version;
        if (std.mem.eql(u8, name, ATTR_TELEMETRY_SDK_LANGUAGE)) return .telemetry_sdk_language;
        return null;
    }
    if (std.mem.startsWith(u8, name, "server.")) {
        if (std.mem.eql(u8, name, ATTR_SERVER_ADDRESS)) return .server_address;
        if (std.mem.eql(u8, name, ATTR_SERVER_PORT)) return .server_port;
        return null;
    }
    if (std.mem.startsWith(u8, name, "client.")) {
        if (std.mem.eql(u8, name, ATTR_CLIENT_ADDRESS)) return .client_address;
        if (std.mem.eql(u8, name, ATTR_CLIENT_PORT)) return .client_port;
        return null;
    }
    if (std.mem.startsWith(u8, name, "service.")) {
        if (std.mem.eql(u8, name, ATTR_SERVICE_NAME)) return .service_name;
        if (std.mem.eql(u8, name, ATTR_SERVICE_VERSION)) return .service_version;
        return null;
    }
    if (std.mem.startsWith(u8, name, "user_agent.")) {
        if (std.mem.eql(u8, name, ATTR_USER_AGENT_ORIGINAL)) return .user_agent_original;
        return null;
    }
    if (std.mem.startsWith(u8, name, "error.")) {
        if (std.mem.eql(u8, name, ATTR_ERROR_TYPE)) return .error_type;
        return null;
    }
    return null;
}

/// Look up HTTPHeaderName ID from string
pub fn httpHeaderNameFromString(name: []const u8) ?u8 {
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
pub fn otelHeaderFromString(name: []const u8) ?u8 {
    if (std.mem.eql(u8, name, "traceparent")) return 93;
    if (std.mem.eql(u8, name, "tracestate")) return 94;
    if (std.mem.eql(u8, name, "baggage")) return 95;
    return null;
}

/// Convert HTTPHeaderName ID to string
pub fn httpHeaderNameToString(id: u8) []const u8 {
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

// ============================================================================
// HeaderNameList - Pre-processed configuration for efficient header capture
// ============================================================================

/// Pre-processed header name list for efficient header capture
/// Separates HTTPHeaderName (fast path) from OTel-specific headers (slow path)
pub const HeaderNameList = struct {
    /// HTTPHeaderName IDs (0-92) - can use fast FetchHeaders lookup
    fast_headers: std.ArrayList(u8),

    /// OTel-specific header names (traceparent, etc.) - need string lookup
    slow_header_names: std.ArrayList(bun.String),
    slow_header_ids: std.ArrayList(u8),

    /// Context for building full attribute names
    context: u16,

    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, context: u16) HeaderNameList {
        return .{
            .fast_headers = std.ArrayList(u8).init(allocator),
            .slow_header_names = std.ArrayList(bun.String).init(allocator),
            .slow_header_ids = std.ArrayList(u8).init(allocator),
            .context = context,
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
    pub fn fromJS(allocator: std.mem.Allocator, global: *JSGlobalObject, js_array: JSValue, context: u16) !HeaderNameList {
        var list = HeaderNameList.init(allocator, context);
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

// ============================================================================
// OpenTelemetry Semantic Convention String Constants
// ============================================================================

// Generated from @opentelemetry/semantic-conventions npm package

pub const ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_ABORTED = "aborted";
pub const ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_HANDLED = "handled";
pub const ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_SKIPPED = "skipped";
pub const ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_UNHANDLED = "unhandled";
pub const ASPNETCORE_RATE_LIMITING_RESULT_VALUE_ACQUIRED = "acquired";
pub const ASPNETCORE_RATE_LIMITING_RESULT_VALUE_ENDPOINT_LIMITER = "endpoint_limiter";
pub const ASPNETCORE_RATE_LIMITING_RESULT_VALUE_GLOBAL_LIMITER = "global_limiter";
pub const ASPNETCORE_RATE_LIMITING_RESULT_VALUE_REQUEST_CANCELED = "request_canceled";
pub const ASPNETCORE_ROUTING_MATCH_STATUS_VALUE_FAILURE = "failure";
pub const ASPNETCORE_ROUTING_MATCH_STATUS_VALUE_SUCCESS = "success";
pub const ATTR_ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT = "aspnetcore.diagnostics.exception.result";
pub const ATTR_ASPNETCORE_DIAGNOSTICS_HANDLER_TYPE = "aspnetcore.diagnostics.handler.type";
pub const ATTR_ASPNETCORE_RATE_LIMITING_POLICY = "aspnetcore.rate_limiting.policy";
pub const ATTR_ASPNETCORE_RATE_LIMITING_RESULT = "aspnetcore.rate_limiting.result";
pub const ATTR_ASPNETCORE_REQUEST_IS_UNHANDLED = "aspnetcore.request.is_unhandled";
pub const ATTR_ASPNETCORE_ROUTING_IS_FALLBACK = "aspnetcore.routing.is_fallback";
pub const ATTR_ASPNETCORE_ROUTING_MATCH_STATUS = "aspnetcore.routing.match_status";
pub const ATTR_ASPNETCORE_USER_IS_AUTHENTICATED = "aspnetcore.user.is_authenticated";
pub const ATTR_CLIENT_ADDRESS = "client.address";
pub const ATTR_CLIENT_PORT = "client.port";
pub const ATTR_CODE_COLUMN_NUMBER = "code.column.number";
pub const ATTR_CODE_FILE_PATH = "code.file.path";
pub const ATTR_CODE_FUNCTION_NAME = "code.function.name";
pub const ATTR_CODE_LINE_NUMBER = "code.line.number";
pub const ATTR_CODE_STACKTRACE = "code.stacktrace";
pub const ATTR_DB_COLLECTION_NAME = "db.collection.name";
pub const ATTR_DB_NAMESPACE = "db.namespace";
pub const ATTR_DB_OPERATION_BATCH_SIZE = "db.operation.batch.size";
pub const ATTR_DB_OPERATION_NAME = "db.operation.name";
pub const ATTR_DB_QUERY_SUMMARY = "db.query.summary";
pub const ATTR_DB_QUERY_TEXT = "db.query.text";
pub const ATTR_DB_RESPONSE_STATUS_CODE = "db.response.status_code";
pub const ATTR_DB_STORED_PROCEDURE_NAME = "db.stored_procedure.name";
pub const ATTR_DB_SYSTEM_NAME = "db.system.name";
pub const ATTR_DOTNET_GC_HEAP_GENERATION = "dotnet.gc.heap.generation";
pub const ATTR_ERROR_TYPE = "error.type";
pub const ATTR_EXCEPTION_ESCAPED = "exception.escaped";
pub const ATTR_EXCEPTION_MESSAGE = "exception.message";
pub const ATTR_EXCEPTION_STACKTRACE = "exception.stacktrace";
pub const ATTR_EXCEPTION_TYPE = "exception.type";
pub const ATTR_HTTP_REQUEST_METHOD = "http.request.method";
pub const ATTR_HTTP_REQUEST_METHOD_ORIGINAL = "http.request.method_original";
pub const ATTR_HTTP_REQUEST_RESEND_COUNT = "http.request.resend_count";
pub const ATTR_HTTP_RESPONSE_STATUS_CODE = "http.response.status_code";
pub const ATTR_HTTP_ROUTE = "http.route";
pub const ATTR_JVM_GC_ACTION = "jvm.gc.action";
pub const ATTR_JVM_GC_NAME = "jvm.gc.name";
pub const ATTR_JVM_MEMORY_POOL_NAME = "jvm.memory.pool.name";
pub const ATTR_JVM_MEMORY_TYPE = "jvm.memory.type";
pub const ATTR_JVM_THREAD_DAEMON = "jvm.thread.daemon";
pub const ATTR_JVM_THREAD_STATE = "jvm.thread.state";
pub const ATTR_NETWORK_LOCAL_ADDRESS = "network.local.address";
pub const ATTR_NETWORK_LOCAL_PORT = "network.local.port";
pub const ATTR_NETWORK_PEER_ADDRESS = "network.peer.address";
pub const ATTR_NETWORK_PEER_PORT = "network.peer.port";
pub const ATTR_NETWORK_PROTOCOL_NAME = "network.protocol.name";
pub const ATTR_NETWORK_PROTOCOL_VERSION = "network.protocol.version";
pub const ATTR_NETWORK_TRANSPORT = "network.transport";
pub const ATTR_NETWORK_TYPE = "network.type";
pub const ATTR_OTEL_SCOPE_NAME = "otel.scope.name";
pub const ATTR_OTEL_SCOPE_VERSION = "otel.scope.version";
pub const ATTR_OTEL_STATUS_CODE = "otel.status_code";
pub const ATTR_OTEL_STATUS_DESCRIPTION = "otel.status_description";
pub const ATTR_SERVER_ADDRESS = "server.address";
pub const ATTR_SERVER_PORT = "server.port";
pub const ATTR_SERVICE_NAME = "service.name";
pub const ATTR_SERVICE_VERSION = "service.version";
pub const ATTR_SIGNALR_CONNECTION_STATUS = "signalr.connection.status";
pub const ATTR_SIGNALR_TRANSPORT = "signalr.transport";
pub const ATTR_TELEMETRY_SDK_LANGUAGE = "telemetry.sdk.language";
pub const ATTR_TELEMETRY_SDK_NAME = "telemetry.sdk.name";
pub const ATTR_TELEMETRY_SDK_VERSION = "telemetry.sdk.version";
pub const ATTR_URL_FRAGMENT = "url.fragment";
pub const ATTR_URL_FULL = "url.full";
pub const ATTR_URL_PATH = "url.path";
pub const ATTR_URL_QUERY = "url.query";
pub const ATTR_URL_SCHEME = "url.scheme";
pub const ATTR_USER_AGENT_ORIGINAL = "user_agent.original";
pub const AWSECSLAUNCHTYPEVALUES_EC2 = "ec2";
pub const AWSECSLAUNCHTYPEVALUES_FARGATE = "fargate";
pub const CLOUDPLATFORMVALUES_ALIBABA_CLOUD_ECS = "alibaba_cloud_ecs";
pub const CLOUDPLATFORMVALUES_ALIBABA_CLOUD_FC = "alibaba_cloud_fc";
pub const CLOUDPLATFORMVALUES_AWS_EC2 = "aws_ec2";
pub const CLOUDPLATFORMVALUES_AWS_ECS = "aws_ecs";
pub const CLOUDPLATFORMVALUES_AWS_EKS = "aws_eks";
pub const CLOUDPLATFORMVALUES_AWS_ELASTIC_BEANSTALK = "aws_elastic_beanstalk";
pub const CLOUDPLATFORMVALUES_AWS_LAMBDA = "aws_lambda";
pub const CLOUDPLATFORMVALUES_AZURE_AKS = "azure_aks";
pub const CLOUDPLATFORMVALUES_AZURE_APP_SERVICE = "azure_app_service";
pub const CLOUDPLATFORMVALUES_AZURE_CONTAINER_INSTANCES = "azure_container_instances";
pub const CLOUDPLATFORMVALUES_AZURE_FUNCTIONS = "azure_functions";
pub const CLOUDPLATFORMVALUES_AZURE_VM = "azure_vm";
pub const CLOUDPLATFORMVALUES_GCP_APP_ENGINE = "gcp_app_engine";
pub const CLOUDPLATFORMVALUES_GCP_CLOUD_FUNCTIONS = "gcp_cloud_functions";
pub const CLOUDPLATFORMVALUES_GCP_CLOUD_RUN = "gcp_cloud_run";
pub const CLOUDPLATFORMVALUES_GCP_COMPUTE_ENGINE = "gcp_compute_engine";
pub const CLOUDPLATFORMVALUES_GCP_KUBERNETES_ENGINE = "gcp_kubernetes_engine";
pub const CLOUDPROVIDERVALUES_ALIBABA_CLOUD = "alibaba_cloud";
pub const CLOUDPROVIDERVALUES_AWS = "aws";
pub const CLOUDPROVIDERVALUES_AZURE = "azure";
pub const CLOUDPROVIDERVALUES_GCP = "gcp";
pub const DB_SYSTEM_NAME_VALUE_MARIADB = "mariadb";
pub const DB_SYSTEM_NAME_VALUE_MICROSOFT_SQL_SERVER = "microsoft.sql_server";
pub const DB_SYSTEM_NAME_VALUE_MYSQL = "mysql";
pub const DB_SYSTEM_NAME_VALUE_POSTGRESQL = "postgresql";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_ALL = "all";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_ANY = "any";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_EACH_QUORUM = "each_quorum";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_ONE = "local_one";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_QUORUM = "local_quorum";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_SERIAL = "local_serial";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_ONE = "one";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_QUORUM = "quorum";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_SERIAL = "serial";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_THREE = "three";
pub const DBCASSANDRACONSISTENCYLEVELVALUES_TWO = "two";
pub const DBSYSTEMVALUES_ADABAS = "adabas";
pub const DBSYSTEMVALUES_CACHE = "cache";
pub const DBSYSTEMVALUES_CASSANDRA = "cassandra";
pub const DBSYSTEMVALUES_CLOUDSCAPE = "cloudscape";
pub const DBSYSTEMVALUES_COCKROACHDB = "cockroachdb";
pub const DBSYSTEMVALUES_COLDFUSION = "coldfusion";
pub const DBSYSTEMVALUES_COSMOSDB = "cosmosdb";
pub const DBSYSTEMVALUES_COUCHBASE = "couchbase";
pub const DBSYSTEMVALUES_COUCHDB = "couchdb";
pub const DBSYSTEMVALUES_DB2 = "db2";
pub const DBSYSTEMVALUES_DERBY = "derby";
pub const DBSYSTEMVALUES_DYNAMODB = "dynamodb";
pub const DBSYSTEMVALUES_EDB = "edb";
pub const DBSYSTEMVALUES_ELASTICSEARCH = "elasticsearch";
pub const DBSYSTEMVALUES_FILEMAKER = "filemaker";
pub const DBSYSTEMVALUES_FIREBIRD = "firebird";
pub const DBSYSTEMVALUES_FIRSTSQL = "firstsql";
pub const DBSYSTEMVALUES_GEODE = "geode";
pub const DBSYSTEMVALUES_H2 = "h2";
pub const DBSYSTEMVALUES_HANADB = "hanadb";
pub const DBSYSTEMVALUES_HBASE = "hbase";
pub const DBSYSTEMVALUES_HIVE = "hive";
pub const DBSYSTEMVALUES_HSQLDB = "hsqldb";
pub const DBSYSTEMVALUES_INFORMIX = "informix";
pub const DBSYSTEMVALUES_INGRES = "ingres";
pub const DBSYSTEMVALUES_INSTANTDB = "instantdb";
pub const DBSYSTEMVALUES_INTERBASE = "interbase";
pub const DBSYSTEMVALUES_MARIADB = "mariadb";
pub const DBSYSTEMVALUES_MAXDB = "maxdb";
pub const DBSYSTEMVALUES_MEMCACHED = "memcached";
pub const DBSYSTEMVALUES_MONGODB = "mongodb";
pub const DBSYSTEMVALUES_MSSQL = "mssql";
pub const DBSYSTEMVALUES_MYSQL = "mysql";
pub const DBSYSTEMVALUES_NEO4J = "neo4j";
pub const DBSYSTEMVALUES_NETEZZA = "netezza";
pub const DBSYSTEMVALUES_ORACLE = "oracle";
pub const DBSYSTEMVALUES_OTHER_SQL = "other_sql";
pub const DBSYSTEMVALUES_PERVASIVE = "pervasive";
pub const DBSYSTEMVALUES_POINTBASE = "pointbase";
pub const DBSYSTEMVALUES_POSTGRESQL = "postgresql";
pub const DBSYSTEMVALUES_PROGRESS = "progress";
pub const DBSYSTEMVALUES_REDIS = "redis";
pub const DBSYSTEMVALUES_REDSHIFT = "redshift";
pub const DBSYSTEMVALUES_SQLITE = "sqlite";
pub const DBSYSTEMVALUES_SYBASE = "sybase";
pub const DBSYSTEMVALUES_TERADATA = "teradata";
pub const DBSYSTEMVALUES_VERTICA = "vertica";
pub const DOTNET_GC_HEAP_GENERATION_VALUE_GEN0 = "gen0";
pub const DOTNET_GC_HEAP_GENERATION_VALUE_GEN1 = "gen1";
pub const DOTNET_GC_HEAP_GENERATION_VALUE_GEN2 = "gen2";
pub const DOTNET_GC_HEAP_GENERATION_VALUE_LOH = "loh";
pub const DOTNET_GC_HEAP_GENERATION_VALUE_POH = "poh";
pub const ERROR_TYPE_VALUE_OTHER = "_OTHER";
pub const EVENT_EXCEPTION = "exception";
pub const FAASDOCUMENTOPERATIONVALUES_DELETE = "delete";
pub const FAASDOCUMENTOPERATIONVALUES_EDIT = "edit";
pub const FAASDOCUMENTOPERATIONVALUES_INSERT = "insert";
pub const FAASINVOKEDPROVIDERVALUES_ALIBABA_CLOUD = "alibaba_cloud";
pub const FAASINVOKEDPROVIDERVALUES_AWS = "aws";
pub const FAASINVOKEDPROVIDERVALUES_AZURE = "azure";
pub const FAASINVOKEDPROVIDERVALUES_GCP = "gcp";
pub const FAASTRIGGERVALUES_DATASOURCE = "datasource";
pub const FAASTRIGGERVALUES_HTTP = "http";
pub const FAASTRIGGERVALUES_OTHER = "other";
pub const FAASTRIGGERVALUES_PUBSUB = "pubsub";
pub const FAASTRIGGERVALUES_TIMER = "timer";
pub const HOSTARCHVALUES_AMD64 = "amd64";
pub const HOSTARCHVALUES_ARM32 = "arm32";
pub const HOSTARCHVALUES_ARM64 = "arm64";
pub const HOSTARCHVALUES_IA64 = "ia64";
pub const HOSTARCHVALUES_PPC32 = "ppc32";
pub const HOSTARCHVALUES_PPC64 = "ppc64";
pub const HOSTARCHVALUES_X86 = "x86";
pub const HTTP_REQUEST_METHOD_VALUE_CONNECT = "CONNECT";
pub const HTTP_REQUEST_METHOD_VALUE_DELETE = "DELETE";
pub const HTTP_REQUEST_METHOD_VALUE_GET = "GET";
pub const HTTP_REQUEST_METHOD_VALUE_HEAD = "HEAD";
pub const HTTP_REQUEST_METHOD_VALUE_OPTIONS = "OPTIONS";
pub const HTTP_REQUEST_METHOD_VALUE_OTHER = "_OTHER";
pub const HTTP_REQUEST_METHOD_VALUE_PATCH = "PATCH";
pub const HTTP_REQUEST_METHOD_VALUE_POST = "POST";
pub const HTTP_REQUEST_METHOD_VALUE_PUT = "PUT";
pub const HTTP_REQUEST_METHOD_VALUE_TRACE = "TRACE";
pub const HTTPFLAVORVALUES_HTTP_1_0 = "1.0";
pub const HTTPFLAVORVALUES_HTTP_1_1 = "1.1";
pub const HTTPFLAVORVALUES_HTTP_2_0 = "2.0";
pub const HTTPFLAVORVALUES_QUIC = "QUIC";
pub const HTTPFLAVORVALUES_SPDY = "SPDY";
pub const JVM_MEMORY_TYPE_VALUE_HEAP = "heap";
pub const JVM_MEMORY_TYPE_VALUE_NON_HEAP = "non_heap";
pub const JVM_THREAD_STATE_VALUE_BLOCKED = "blocked";
pub const JVM_THREAD_STATE_VALUE_NEW = "new";
pub const JVM_THREAD_STATE_VALUE_RUNNABLE = "runnable";
pub const JVM_THREAD_STATE_VALUE_TERMINATED = "terminated";
pub const JVM_THREAD_STATE_VALUE_TIMED_WAITING = "timed_waiting";
pub const JVM_THREAD_STATE_VALUE_WAITING = "waiting";
pub const MESSAGETYPEVALUES_RECEIVED = "RECEIVED";
pub const MESSAGETYPEVALUES_SENT = "SENT";
pub const MESSAGINGDESTINATIONKINDVALUES_QUEUE = "queue";
pub const MESSAGINGDESTINATIONKINDVALUES_TOPIC = "topic";
pub const MESSAGINGOPERATIONVALUES_PROCESS = "process";
pub const MESSAGINGOPERATIONVALUES_RECEIVE = "receive";
pub const METRIC_ASPNETCORE_DIAGNOSTICS_EXCEPTIONS = "aspnetcore.diagnostics.exceptions";
pub const METRIC_ASPNETCORE_RATE_LIMITING_ACTIVE_REQUEST_LEASES = "aspnetcore.rate_limiting.active_request_leases";
pub const METRIC_ASPNETCORE_RATE_LIMITING_QUEUED_REQUESTS = "aspnetcore.rate_limiting.queued_requests";
pub const METRIC_ASPNETCORE_RATE_LIMITING_REQUEST_LEASE_DURATION = "aspnetcore.rate_limiting.request_lease.duration";
pub const METRIC_ASPNETCORE_RATE_LIMITING_REQUEST_TIME_IN_QUEUE = "aspnetcore.rate_limiting.request.time_in_queue";
pub const METRIC_ASPNETCORE_RATE_LIMITING_REQUESTS = "aspnetcore.rate_limiting.requests";
pub const METRIC_ASPNETCORE_ROUTING_MATCH_ATTEMPTS = "aspnetcore.routing.match_attempts";
pub const METRIC_DB_CLIENT_OPERATION_DURATION = "db.client.operation.duration";
pub const METRIC_DOTNET_ASSEMBLY_COUNT = "dotnet.assembly.count";
pub const METRIC_DOTNET_EXCEPTIONS = "dotnet.exceptions";
pub const METRIC_DOTNET_GC_COLLECTIONS = "dotnet.gc.collections";
pub const METRIC_DOTNET_GC_HEAP_TOTAL_ALLOCATED = "dotnet.gc.heap.total_allocated";
pub const METRIC_DOTNET_GC_LAST_COLLECTION_HEAP_FRAGMENTATION_SIZE = "dotnet.gc.last_collection.heap.fragmentation.size";
pub const METRIC_DOTNET_GC_LAST_COLLECTION_HEAP_SIZE = "dotnet.gc.last_collection.heap.size";
pub const METRIC_DOTNET_GC_LAST_COLLECTION_MEMORY_COMMITTED_SIZE = "dotnet.gc.last_collection.memory.committed_size";
pub const METRIC_DOTNET_GC_PAUSE_TIME = "dotnet.gc.pause.time";
pub const METRIC_DOTNET_JIT_COMPILATION_TIME = "dotnet.jit.compilation.time";
pub const METRIC_DOTNET_JIT_COMPILED_IL_SIZE = "dotnet.jit.compiled_il.size";
pub const METRIC_DOTNET_JIT_COMPILED_METHODS = "dotnet.jit.compiled_methods";
pub const METRIC_DOTNET_MONITOR_LOCK_CONTENTIONS = "dotnet.monitor.lock_contentions";
pub const METRIC_DOTNET_PROCESS_CPU_COUNT = "dotnet.process.cpu.count";
pub const METRIC_DOTNET_PROCESS_CPU_TIME = "dotnet.process.cpu.time";
pub const METRIC_DOTNET_PROCESS_MEMORY_WORKING_SET = "dotnet.process.memory.working_set";
pub const METRIC_DOTNET_THREAD_POOL_QUEUE_LENGTH = "dotnet.thread_pool.queue.length";
pub const METRIC_DOTNET_THREAD_POOL_THREAD_COUNT = "dotnet.thread_pool.thread.count";
pub const METRIC_DOTNET_THREAD_POOL_WORK_ITEM_COUNT = "dotnet.thread_pool.work_item.count";
pub const METRIC_DOTNET_TIMER_COUNT = "dotnet.timer.count";
pub const METRIC_HTTP_CLIENT_REQUEST_DURATION = "http.client.request.duration";
pub const METRIC_HTTP_SERVER_REQUEST_DURATION = "http.server.request.duration";
pub const METRIC_JVM_CLASS_COUNT = "jvm.class.count";
pub const METRIC_JVM_CLASS_LOADED = "jvm.class.loaded";
pub const METRIC_JVM_CLASS_UNLOADED = "jvm.class.unloaded";
pub const METRIC_JVM_CPU_COUNT = "jvm.cpu.count";
pub const METRIC_JVM_CPU_RECENT_UTILIZATION = "jvm.cpu.recent_utilization";
pub const METRIC_JVM_CPU_TIME = "jvm.cpu.time";
pub const METRIC_JVM_GC_DURATION = "jvm.gc.duration";
pub const METRIC_JVM_MEMORY_COMMITTED = "jvm.memory.committed";
pub const METRIC_JVM_MEMORY_LIMIT = "jvm.memory.limit";
pub const METRIC_JVM_MEMORY_USED = "jvm.memory.used";
pub const METRIC_JVM_MEMORY_USED_AFTER_LAST_GC = "jvm.memory.used_after_last_gc";
pub const METRIC_JVM_THREAD_COUNT = "jvm.thread.count";
pub const METRIC_KESTREL_ACTIVE_CONNECTIONS = "kestrel.active_connections";
pub const METRIC_KESTREL_ACTIVE_TLS_HANDSHAKES = "kestrel.active_tls_handshakes";
pub const METRIC_KESTREL_CONNECTION_DURATION = "kestrel.connection.duration";
pub const METRIC_KESTREL_QUEUED_CONNECTIONS = "kestrel.queued_connections";
pub const METRIC_KESTREL_QUEUED_REQUESTS = "kestrel.queued_requests";
pub const METRIC_KESTREL_REJECTED_CONNECTIONS = "kestrel.rejected_connections";
pub const METRIC_KESTREL_TLS_HANDSHAKE_DURATION = "kestrel.tls_handshake.duration";
pub const METRIC_KESTREL_UPGRADED_CONNECTIONS = "kestrel.upgraded_connections";
pub const METRIC_SIGNALR_SERVER_ACTIVE_CONNECTIONS = "signalr.server.active_connections";
pub const METRIC_SIGNALR_SERVER_CONNECTION_DURATION = "signalr.server.connection.duration";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_CDMA = "cdma";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_CDMA2000_1XRTT = "cdma2000_1xrtt";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_EDGE = "edge";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_EHRPD = "ehrpd";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_0 = "evdo_0";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_A = "evdo_a";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_B = "evdo_b";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_GPRS = "gprs";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_GSM = "gsm";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_HSDPA = "hsdpa";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_HSPA = "hspa";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_HSPAP = "hspap";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_HSUPA = "hsupa";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_IDEN = "iden";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_IWLAN = "iwlan";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_LTE = "lte";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_LTE_CA = "lte_ca";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_NR = "nr";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_NRNSA = "nrnsa";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_TD_SCDMA = "td_scdma";
pub const NETHOSTCONNECTIONSUBTYPEVALUES_UMTS = "umts";
pub const NETHOSTCONNECTIONTYPEVALUES_CELL = "cell";
pub const NETHOSTCONNECTIONTYPEVALUES_UNAVAILABLE = "unavailable";
pub const NETHOSTCONNECTIONTYPEVALUES_UNKNOWN = "unknown";
pub const NETHOSTCONNECTIONTYPEVALUES_WIFI = "wifi";
pub const NETHOSTCONNECTIONTYPEVALUES_WIRED = "wired";
pub const NETTRANSPORTVALUES_INPROC = "inproc";
pub const NETTRANSPORTVALUES_IP = "ip";
pub const NETTRANSPORTVALUES_IP_TCP = "ip_tcp";
pub const NETTRANSPORTVALUES_IP_UDP = "ip_udp";
pub const NETTRANSPORTVALUES_OTHER = "other";
pub const NETTRANSPORTVALUES_PIPE = "pipe";
pub const NETTRANSPORTVALUES_UNIX = "unix";
pub const NETWORK_TRANSPORT_VALUE_PIPE = "pipe";
pub const NETWORK_TRANSPORT_VALUE_QUIC = "quic";
pub const NETWORK_TRANSPORT_VALUE_TCP = "tcp";
pub const NETWORK_TRANSPORT_VALUE_UDP = "udp";
pub const NETWORK_TRANSPORT_VALUE_UNIX = "unix";
pub const NETWORK_TYPE_VALUE_IPV4 = "ipv4";
pub const NETWORK_TYPE_VALUE_IPV6 = "ipv6";
pub const OSTYPEVALUES_AIX = "aix";
pub const OSTYPEVALUES_DARWIN = "darwin";
pub const OSTYPEVALUES_DRAGONFLYBSD = "dragonflybsd";
pub const OSTYPEVALUES_FREEBSD = "freebsd";
pub const OSTYPEVALUES_HPUX = "hpux";
pub const OSTYPEVALUES_LINUX = "linux";
pub const OSTYPEVALUES_NETBSD = "netbsd";
pub const OSTYPEVALUES_OPENBSD = "openbsd";
pub const OSTYPEVALUES_SOLARIS = "solaris";
pub const OSTYPEVALUES_WINDOWS = "windows";
pub const OSTYPEVALUES_Z_OS = "z_os";
pub const OTEL_STATUS_CODE_VALUE_ERROR = "ERROR";
pub const OTEL_STATUS_CODE_VALUE_OK = "OK";
pub const SEMATTRS_AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS = "aws.dynamodb.attribute_definitions";
pub const SEMATTRS_AWS_DYNAMODB_ATTRIBUTES_TO_GET = "aws.dynamodb.attributes_to_get";
pub const SEMATTRS_AWS_DYNAMODB_CONSISTENT_READ = "aws.dynamodb.consistent_read";
pub const SEMATTRS_AWS_DYNAMODB_CONSUMED_CAPACITY = "aws.dynamodb.consumed_capacity";
pub const SEMATTRS_AWS_DYNAMODB_COUNT = "aws.dynamodb.count";
pub const SEMATTRS_AWS_DYNAMODB_EXCLUSIVE_START_TABLE = "aws.dynamodb.exclusive_start_table";
pub const SEMATTRS_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES = "aws.dynamodb.global_secondary_index_updates";
pub const SEMATTRS_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES = "aws.dynamodb.global_secondary_indexes";
pub const SEMATTRS_AWS_DYNAMODB_INDEX_NAME = "aws.dynamodb.index_name";
pub const SEMATTRS_AWS_DYNAMODB_ITEM_COLLECTION_METRICS = "aws.dynamodb.item_collection_metrics";
pub const SEMATTRS_AWS_DYNAMODB_LIMIT = "aws.dynamodb.limit";
pub const SEMATTRS_AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES = "aws.dynamodb.local_secondary_indexes";
pub const SEMATTRS_AWS_DYNAMODB_PROJECTION = "aws.dynamodb.projection";
pub const SEMATTRS_AWS_DYNAMODB_PROVISIONED_READ_CAPACITY = "aws.dynamodb.provisioned_read_capacity";
pub const SEMATTRS_AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY = "aws.dynamodb.provisioned_write_capacity";
pub const SEMATTRS_AWS_DYNAMODB_SCAN_FORWARD = "aws.dynamodb.scan_forward";
pub const SEMATTRS_AWS_DYNAMODB_SCANNED_COUNT = "aws.dynamodb.scanned_count";
pub const SEMATTRS_AWS_DYNAMODB_SEGMENT = "aws.dynamodb.segment";
pub const SEMATTRS_AWS_DYNAMODB_SELECT = "aws.dynamodb.select";
pub const SEMATTRS_AWS_DYNAMODB_TABLE_COUNT = "aws.dynamodb.table_count";
pub const SEMATTRS_AWS_DYNAMODB_TABLE_NAMES = "aws.dynamodb.table_names";
pub const SEMATTRS_AWS_DYNAMODB_TOTAL_SEGMENTS = "aws.dynamodb.total_segments";
pub const SEMATTRS_AWS_LAMBDA_INVOKED_ARN = "aws.lambda.invoked_arn";
pub const SEMATTRS_CODE_FILEPATH = "code.filepath";
pub const SEMATTRS_CODE_FUNCTION = "code.function";
pub const SEMATTRS_CODE_LINENO = "code.lineno";
pub const SEMATTRS_CODE_NAMESPACE = "code.namespace";
pub const SEMATTRS_DB_CASSANDRA_CONSISTENCY_LEVEL = "db.cassandra.consistency_level";
pub const SEMATTRS_DB_CASSANDRA_COORDINATOR_DC = "db.cassandra.coordinator.dc";
pub const SEMATTRS_DB_CASSANDRA_COORDINATOR_ID = "db.cassandra.coordinator.id";
pub const SEMATTRS_DB_CASSANDRA_IDEMPOTENCE = "db.cassandra.idempotence";
pub const SEMATTRS_DB_CASSANDRA_KEYSPACE = "db.cassandra.keyspace";
pub const SEMATTRS_DB_CASSANDRA_PAGE_SIZE = "db.cassandra.page_size";
pub const SEMATTRS_DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT = "db.cassandra.speculative_execution_count";
pub const SEMATTRS_DB_CASSANDRA_TABLE = "db.cassandra.table";
pub const SEMATTRS_DB_CONNECTION_STRING = "db.connection_string";
pub const SEMATTRS_DB_HBASE_NAMESPACE = "db.hbase.namespace";
pub const SEMATTRS_DB_JDBC_DRIVER_CLASSNAME = "db.jdbc.driver_classname";
pub const SEMATTRS_DB_MONGODB_COLLECTION = "db.mongodb.collection";
pub const SEMATTRS_DB_MSSQL_INSTANCE_NAME = "db.mssql.instance_name";
pub const SEMATTRS_DB_NAME = "db.name";
pub const SEMATTRS_DB_OPERATION = "db.operation";
pub const SEMATTRS_DB_REDIS_DATABASE_INDEX = "db.redis.database_index";
pub const SEMATTRS_DB_SQL_TABLE = "db.sql.table";
pub const SEMATTRS_DB_STATEMENT = "db.statement";
pub const SEMATTRS_DB_SYSTEM = "db.system";
pub const SEMATTRS_DB_USER = "db.user";
pub const SEMATTRS_ENDUSER_ID = "enduser.id";
pub const SEMATTRS_ENDUSER_ROLE = "enduser.role";
pub const SEMATTRS_ENDUSER_SCOPE = "enduser.scope";
pub const SEMATTRS_EXCEPTION_ESCAPED = "exception.escaped";
pub const SEMATTRS_EXCEPTION_MESSAGE = "exception.message";
pub const SEMATTRS_EXCEPTION_STACKTRACE = "exception.stacktrace";
pub const SEMATTRS_EXCEPTION_TYPE = "exception.type";
pub const SEMATTRS_FAAS_COLDSTART = "faas.coldstart";
pub const SEMATTRS_FAAS_CRON = "faas.cron";
pub const SEMATTRS_FAAS_DOCUMENT_COLLECTION = "faas.document.collection";
pub const SEMATTRS_FAAS_DOCUMENT_NAME = "faas.document.name";
pub const SEMATTRS_FAAS_DOCUMENT_OPERATION = "faas.document.operation";
pub const SEMATTRS_FAAS_DOCUMENT_TIME = "faas.document.time";
pub const SEMATTRS_FAAS_EXECUTION = "faas.execution";
pub const SEMATTRS_FAAS_INVOKED_NAME = "faas.invoked_name";
pub const SEMATTRS_FAAS_INVOKED_PROVIDER = "faas.invoked_provider";
pub const SEMATTRS_FAAS_INVOKED_REGION = "faas.invoked_region";
pub const SEMATTRS_FAAS_TIME = "faas.time";
pub const SEMATTRS_FAAS_TRIGGER = "faas.trigger";
pub const SEMATTRS_HTTP_CLIENT_IP = "http.client_ip";
pub const SEMATTRS_HTTP_FLAVOR = "http.flavor";
pub const SEMATTRS_HTTP_HOST = "http.host";
pub const SEMATTRS_HTTP_METHOD = "http.method";
pub const SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH = "http.request_content_length";
pub const SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED = "http.request_content_length_uncompressed";
pub const SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH = "http.response_content_length";
pub const SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED = "http.response_content_length_uncompressed";
pub const SEMATTRS_HTTP_ROUTE = "http.route";
pub const SEMATTRS_HTTP_SCHEME = "http.scheme";
pub const SEMATTRS_HTTP_SERVER_NAME = "http.server_name";
pub const SEMATTRS_HTTP_STATUS_CODE = "http.status_code";
pub const SEMATTRS_HTTP_TARGET = "http.target";
pub const SEMATTRS_HTTP_URL = "http.url";
pub const SEMATTRS_HTTP_USER_AGENT = "http.user_agent";
pub const SEMATTRS_MESSAGE_COMPRESSED_SIZE = "message.compressed_size";
pub const SEMATTRS_MESSAGE_ID = "message.id";
pub const SEMATTRS_MESSAGE_TYPE = "message.type";
pub const SEMATTRS_MESSAGE_UNCOMPRESSED_SIZE = "message.uncompressed_size";
pub const SEMATTRS_MESSAGING_CONSUMER_ID = "messaging.consumer_id";
pub const SEMATTRS_MESSAGING_CONVERSATION_ID = "messaging.conversation_id";
pub const SEMATTRS_MESSAGING_DESTINATION = "messaging.destination";
pub const SEMATTRS_MESSAGING_DESTINATION_KIND = "messaging.destination_kind";
pub const SEMATTRS_MESSAGING_KAFKA_CLIENT_ID = "messaging.kafka.client_id";
pub const SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP = "messaging.kafka.consumer_group";
pub const SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY = "messaging.kafka.message_key";
pub const SEMATTRS_MESSAGING_KAFKA_PARTITION = "messaging.kafka.partition";
pub const SEMATTRS_MESSAGING_KAFKA_TOMBSTONE = "messaging.kafka.tombstone";
pub const SEMATTRS_MESSAGING_MESSAGE_ID = "messaging.message_id";
pub const SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES = "messaging.message_payload_compressed_size_bytes";
pub const SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES = "messaging.message_payload_size_bytes";
pub const SEMATTRS_MESSAGING_OPERATION = "messaging.operation";
pub const SEMATTRS_MESSAGING_PROTOCOL = "messaging.protocol";
pub const SEMATTRS_MESSAGING_PROTOCOL_VERSION = "messaging.protocol_version";
pub const SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY = "messaging.rabbitmq.routing_key";
pub const SEMATTRS_MESSAGING_SYSTEM = "messaging.system";
pub const SEMATTRS_MESSAGING_TEMP_DESTINATION = "messaging.temp_destination";
pub const SEMATTRS_MESSAGING_URL = "messaging.url";
pub const SEMATTRS_NET_HOST_CARRIER_ICC = "net.host.carrier.icc";
pub const SEMATTRS_NET_HOST_CARRIER_MCC = "net.host.carrier.mcc";
pub const SEMATTRS_NET_HOST_CARRIER_MNC = "net.host.carrier.mnc";
pub const SEMATTRS_NET_HOST_CARRIER_NAME = "net.host.carrier.name";
pub const SEMATTRS_NET_HOST_CONNECTION_SUBTYPE = "net.host.connection.subtype";
pub const SEMATTRS_NET_HOST_CONNECTION_TYPE = "net.host.connection.type";
pub const SEMATTRS_NET_HOST_IP = "net.host.ip";
pub const SEMATTRS_NET_HOST_NAME = "net.host.name";
pub const SEMATTRS_NET_HOST_PORT = "net.host.port";
pub const SEMATTRS_NET_PEER_IP = "net.peer.ip";
pub const SEMATTRS_NET_PEER_NAME = "net.peer.name";
pub const SEMATTRS_NET_PEER_PORT = "net.peer.port";
pub const SEMATTRS_NET_TRANSPORT = "net.transport";
pub const SEMATTRS_PEER_SERVICE = "peer.service";
pub const SEMATTRS_RPC_GRPC_STATUS_CODE = "rpc.grpc.status_code";
pub const SEMATTRS_RPC_JSONRPC_ERROR_CODE = "rpc.jsonrpc.error_code";
pub const SEMATTRS_RPC_JSONRPC_ERROR_MESSAGE = "rpc.jsonrpc.error_message";
pub const SEMATTRS_RPC_JSONRPC_REQUEST_ID = "rpc.jsonrpc.request_id";
pub const SEMATTRS_RPC_JSONRPC_VERSION = "rpc.jsonrpc.version";
pub const SEMATTRS_RPC_METHOD = "rpc.method";
pub const SEMATTRS_RPC_SERVICE = "rpc.service";
pub const SEMATTRS_RPC_SYSTEM = "rpc.system";
pub const SEMATTRS_THREAD_ID = "thread.id";
pub const SEMATTRS_THREAD_NAME = "thread.name";
pub const SEMRESATTRS_AWS_ECS_CLUSTER_ARN = "aws.ecs.cluster.arn";
pub const SEMRESATTRS_AWS_ECS_CONTAINER_ARN = "aws.ecs.container.arn";
pub const SEMRESATTRS_AWS_ECS_LAUNCHTYPE = "aws.ecs.launchtype";
pub const SEMRESATTRS_AWS_ECS_TASK_ARN = "aws.ecs.task.arn";
pub const SEMRESATTRS_AWS_ECS_TASK_FAMILY = "aws.ecs.task.family";
pub const SEMRESATTRS_AWS_ECS_TASK_REVISION = "aws.ecs.task.revision";
pub const SEMRESATTRS_AWS_EKS_CLUSTER_ARN = "aws.eks.cluster.arn";
pub const SEMRESATTRS_AWS_LOG_GROUP_ARNS = "aws.log.group.arns";
pub const SEMRESATTRS_AWS_LOG_GROUP_NAMES = "aws.log.group.names";
pub const SEMRESATTRS_AWS_LOG_STREAM_ARNS = "aws.log.stream.arns";
pub const SEMRESATTRS_AWS_LOG_STREAM_NAMES = "aws.log.stream.names";
pub const SEMRESATTRS_CLOUD_ACCOUNT_ID = "cloud.account.id";
pub const SEMRESATTRS_CLOUD_AVAILABILITY_ZONE = "cloud.availability_zone";
pub const SEMRESATTRS_CLOUD_PLATFORM = "cloud.platform";
pub const SEMRESATTRS_CLOUD_PROVIDER = "cloud.provider";
pub const SEMRESATTRS_CLOUD_REGION = "cloud.region";
pub const SEMRESATTRS_CONTAINER_ID = "container.id";
pub const SEMRESATTRS_CONTAINER_IMAGE_NAME = "container.image.name";
pub const SEMRESATTRS_CONTAINER_IMAGE_TAG = "container.image.tag";
pub const SEMRESATTRS_CONTAINER_NAME = "container.name";
pub const SEMRESATTRS_CONTAINER_RUNTIME = "container.runtime";
pub const SEMRESATTRS_DEPLOYMENT_ENVIRONMENT = "deployment.environment";
pub const SEMRESATTRS_DEVICE_ID = "device.id";
pub const SEMRESATTRS_DEVICE_MODEL_IDENTIFIER = "device.model.identifier";
pub const SEMRESATTRS_DEVICE_MODEL_NAME = "device.model.name";
pub const SEMRESATTRS_FAAS_ID = "faas.id";
pub const SEMRESATTRS_FAAS_INSTANCE = "faas.instance";
pub const SEMRESATTRS_FAAS_MAX_MEMORY = "faas.max_memory";
pub const SEMRESATTRS_FAAS_NAME = "faas.name";
pub const SEMRESATTRS_FAAS_VERSION = "faas.version";
pub const SEMRESATTRS_HOST_ARCH = "host.arch";
pub const SEMRESATTRS_HOST_ID = "host.id";
pub const SEMRESATTRS_HOST_IMAGE_ID = "host.image.id";
pub const SEMRESATTRS_HOST_IMAGE_NAME = "host.image.name";
pub const SEMRESATTRS_HOST_IMAGE_VERSION = "host.image.version";
pub const SEMRESATTRS_HOST_NAME = "host.name";
pub const SEMRESATTRS_HOST_TYPE = "host.type";
pub const SEMRESATTRS_K8S_CLUSTER_NAME = "k8s.cluster.name";
pub const SEMRESATTRS_K8S_CONTAINER_NAME = "k8s.container.name";
pub const SEMRESATTRS_K8S_CRONJOB_NAME = "k8s.cronjob.name";
pub const SEMRESATTRS_K8S_CRONJOB_UID = "k8s.cronjob.uid";
pub const SEMRESATTRS_K8S_DAEMONSET_NAME = "k8s.daemonset.name";
pub const SEMRESATTRS_K8S_DAEMONSET_UID = "k8s.daemonset.uid";
pub const SEMRESATTRS_K8S_DEPLOYMENT_NAME = "k8s.deployment.name";
pub const SEMRESATTRS_K8S_DEPLOYMENT_UID = "k8s.deployment.uid";
pub const SEMRESATTRS_K8S_JOB_NAME = "k8s.job.name";
pub const SEMRESATTRS_K8S_JOB_UID = "k8s.job.uid";
pub const SEMRESATTRS_K8S_NAMESPACE_NAME = "k8s.namespace.name";
pub const SEMRESATTRS_K8S_NODE_NAME = "k8s.node.name";
pub const SEMRESATTRS_K8S_NODE_UID = "k8s.node.uid";
pub const SEMRESATTRS_K8S_POD_NAME = "k8s.pod.name";
pub const SEMRESATTRS_K8S_POD_UID = "k8s.pod.uid";
pub const SEMRESATTRS_K8S_REPLICASET_NAME = "k8s.replicaset.name";
pub const SEMRESATTRS_K8S_REPLICASET_UID = "k8s.replicaset.uid";
pub const SEMRESATTRS_K8S_STATEFULSET_NAME = "k8s.statefulset.name";
pub const SEMRESATTRS_K8S_STATEFULSET_UID = "k8s.statefulset.uid";
pub const SEMRESATTRS_OS_DESCRIPTION = "os.description";
pub const SEMRESATTRS_OS_NAME = "os.name";
pub const SEMRESATTRS_OS_TYPE = "os.type";
pub const SEMRESATTRS_OS_VERSION = "os.version";
pub const SEMRESATTRS_PROCESS_COMMAND = "process.command";
pub const SEMRESATTRS_PROCESS_COMMAND_ARGS = "process.command_args";
pub const SEMRESATTRS_PROCESS_COMMAND_LINE = "process.command_line";
pub const SEMRESATTRS_PROCESS_EXECUTABLE_NAME = "process.executable.name";
pub const SEMRESATTRS_PROCESS_EXECUTABLE_PATH = "process.executable.path";
pub const SEMRESATTRS_PROCESS_OWNER = "process.owner";
pub const SEMRESATTRS_PROCESS_PID = "process.pid";
pub const SEMRESATTRS_PROCESS_RUNTIME_DESCRIPTION = "process.runtime.description";
pub const SEMRESATTRS_PROCESS_RUNTIME_NAME = "process.runtime.name";
pub const SEMRESATTRS_PROCESS_RUNTIME_VERSION = "process.runtime.version";
pub const SEMRESATTRS_SERVICE_INSTANCE_ID = "service.instance.id";
pub const SEMRESATTRS_SERVICE_NAME = "service.name";
pub const SEMRESATTRS_SERVICE_NAMESPACE = "service.namespace";
pub const SEMRESATTRS_SERVICE_VERSION = "service.version";
pub const SEMRESATTRS_TELEMETRY_AUTO_VERSION = "telemetry.auto.version";
pub const SEMRESATTRS_TELEMETRY_SDK_LANGUAGE = "telemetry.sdk.language";
pub const SEMRESATTRS_TELEMETRY_SDK_NAME = "telemetry.sdk.name";
pub const SEMRESATTRS_TELEMETRY_SDK_VERSION = "telemetry.sdk.version";
pub const SEMRESATTRS_WEBENGINE_DESCRIPTION = "webengine.description";
pub const SEMRESATTRS_WEBENGINE_NAME = "webengine.name";
pub const SEMRESATTRS_WEBENGINE_VERSION = "webengine.version";
pub const SIGNALR_CONNECTION_STATUS_VALUE_APP_SHUTDOWN = "app_shutdown";
pub const SIGNALR_CONNECTION_STATUS_VALUE_NORMAL_CLOSURE = "normal_closure";
pub const SIGNALR_CONNECTION_STATUS_VALUE_TIMEOUT = "timeout";
pub const SIGNALR_TRANSPORT_VALUE_LONG_POLLING = "long_polling";
pub const SIGNALR_TRANSPORT_VALUE_SERVER_SENT_EVENTS = "server_sent_events";
pub const SIGNALR_TRANSPORT_VALUE_WEB_SOCKETS = "web_sockets";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_CPP = "cpp";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_DOTNET = "dotnet";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_ERLANG = "erlang";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_GO = "go";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_JAVA = "java";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS = "nodejs";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_PHP = "php";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_PYTHON = "python";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_RUBY = "ruby";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_RUST = "rust";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_SWIFT = "swift";
pub const TELEMETRY_SDK_LANGUAGE_VALUE_WEBJS = "webjs";
pub const TELEMETRYSDKLANGUAGEVALUES_CPP = "cpp";
pub const TELEMETRYSDKLANGUAGEVALUES_DOTNET = "dotnet";
pub const TELEMETRYSDKLANGUAGEVALUES_ERLANG = "erlang";
pub const TELEMETRYSDKLANGUAGEVALUES_GO = "go";
pub const TELEMETRYSDKLANGUAGEVALUES_JAVA = "java";
pub const TELEMETRYSDKLANGUAGEVALUES_NODEJS = "nodejs";
pub const TELEMETRYSDKLANGUAGEVALUES_PHP = "php";
pub const TELEMETRYSDKLANGUAGEVALUES_PYTHON = "python";
pub const TELEMETRYSDKLANGUAGEVALUES_RUBY = "ruby";
pub const TELEMETRYSDKLANGUAGEVALUES_WEBJS = "webjs";
