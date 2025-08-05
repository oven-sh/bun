const HTTP2Client = @This();

const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const Environment = bun.Environment;
const assert = bun.assert;
const strings = bun.strings;

const NewHTTPContext = bun.http.NewHTTPContext;
const HTTPThread = bun.http.http_thread;
const Headers = bun.http.Headers;
const Method = bun.http.Method;
const URL = bun.URL;
const BoringSSL = bun.BoringSSL.c;
const MutableString = bun.MutableString;
const HTTPRequestBody = @import("HTTPRequestBody.zig").HTTPRequestBody;
const HTTPClientResult = @import("../http.zig").HTTPClientResult;
const Signals = @import("Signals.zig");
const FetchRedirect = @import("../http.zig").FetchRedirect;
const Flags = @import("../http.zig").Flags;
const HTTPVerboseLevel = @import("../http.zig").HTTPVerboseLevel;
const InternalState = @import("InternalState.zig");
const HTTPClient = @import("../http.zig");

// Import HTTP/2 frame parsing and HPACK
const h2_frame_parser = @import("../bun.js/api/bun/h2_frame_parser.zig");
const lshpack = @import("../bun.js/api/bun/lshpack.zig");
const HPACK = lshpack.HPACK;

// HTTP/2 frame types and constants from h2_frame_parser
const FrameType = h2_frame_parser.FrameType;
const FrameHeader = h2_frame_parser.FrameHeader;
const FullSettingsPayload = h2_frame_parser.FullSettingsPayload;
const SettingsType = h2_frame_parser.SettingsType;
const SettingsPayloadUnit = h2_frame_parser.SettingsPayloadUnit;
const HeadersFrameFlags = h2_frame_parser.HeadersFrameFlags;
const DataFrameFlags = h2_frame_parser.DataFrameFlags;
const SettingsFlags = h2_frame_parser.SettingsFlags;
const PingFrameFlags = h2_frame_parser.PingFrameFlags;
const ErrorCode = h2_frame_parser.ErrorCode;

const log = Output.scoped(.HTTP2Client, false);

// Header field structure for HTTP/2
const HeaderField = struct {
    name: []const u8,
    value: []const u8,
    never_index: bool = false,
    hpack_index: u16 = 255,
};

// HTTP/2 Connection Preface (RFC 7540, Section 3.5)
const HTTP2_CONNECTION_PREFACE = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

// HTTP/2 Settings (RFC 7540, Section 6.5)
const DEFAULT_SETTINGS = FullSettingsPayload{
    .headerTableSize = 4096,
    .enablePush = 0, // Disable server push for client
    .maxConcurrentStreams = 100,
    .initialWindowSize = 65535,
    .maxFrameSize = 16384,
    .maxHeaderListSize = 8192,
};

// Stream states (RFC 7540, Section 5.1)
const StreamState = enum {
    idle,
    reserved_local,
    reserved_remote,
    open,
    half_closed_local,
    half_closed_remote,
    closed,
};

// Connection states for lifecycle management
const ConnectionState = enum {
    idle,
    connecting,
    active,
    closing,
    connection_closed,
    failed,
};

// HTTP/2 Stream
const Stream = struct {
    id: u32,
    state: StreamState = .idle,
    window_size: i32 = DEFAULT_SETTINGS.initialWindowSize,
    headers_received: bool = false,
    end_stream_received: bool = false,
    end_headers_received: bool = false,
    request_body: HTTPRequestBody = .{ .bytes = "" },
    response_headers: std.ArrayList(HeaderField) = undefined,
    response_data: std.ArrayList(u8) = undefined,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, stream_id: u32) Stream {
        return Stream{
            .id = stream_id,
            .allocator = allocator,
            .response_headers = std.ArrayList(HeaderField).init(allocator),
            .response_data = std.ArrayList(u8).init(allocator),
        };
    }

    pub fn deinit(self: *Stream) void {
        for (self.response_headers.items) |header| {
            self.allocator.free(header.name);
            self.allocator.free(header.value);
        }
        self.response_headers.deinit();
        self.response_data.deinit();
    }

    pub fn setState(self: *Stream, new_state: StreamState) void {
        log("Stream {d}: {s} -> {s}", .{ self.id, @tagName(self.state), @tagName(new_state) });
        self.state = new_state;
    }

    pub fn isValidTransition(self: *Stream, new_state: StreamState) bool {
        return switch (self.state) {
            .idle => new_state == .reserved_local or new_state == .reserved_remote or new_state == .open,
            .reserved_local => new_state == .half_closed_remote or new_state == .closed,
            .reserved_remote => new_state == .half_closed_local or new_state == .closed,
            .open => new_state == .half_closed_local or new_state == .half_closed_remote or new_state == .closed,
            .half_closed_local => new_state == .closed,
            .half_closed_remote => new_state == .closed,
            .closed => false,
        };
    }
};

// HTTP/2 Connection
const Connection = struct {
    allocator: std.mem.Allocator,
    hpack_decoder: *HPACK,
    hpack_encoder: *HPACK,
    streams: std.AutoHashMap(u32, *Stream),
    next_stream_id: u32 = 1, // Client streams use odd numbers
    connection_window_size: i32 = DEFAULT_SETTINGS.initialWindowSize,
    peer_settings: FullSettingsPayload = DEFAULT_SETTINGS,
    local_settings: FullSettingsPayload = DEFAULT_SETTINGS,
    settings_ack_pending: bool = false,
    goaway_received: bool = false,
    last_stream_id: u32 = 0,
    socket: ?NewHTTPContext(true).HTTPSocket = null,
    state: ConnectionState = .idle,
    error_code: ?ErrorCode = null,

    pub fn init(allocator: std.mem.Allocator) !Connection {
        return Connection{
            .allocator = allocator,
            .hpack_decoder = HPACK.init(4096),
            .hpack_encoder = HPACK.init(4096),
            .streams = std.AutoHashMap(u32, *Stream).init(allocator),
        };
    }

    pub fn deinit(self: *Connection) void {
        var iterator = self.streams.iterator();
        while (iterator.next()) |entry| {
            entry.value_ptr.*.deinit();
            self.allocator.destroy(entry.value_ptr.*);
        }
        self.streams.deinit();
        self.hpack_decoder.deinit();
        self.hpack_encoder.deinit();
    }

    pub fn createStream(self: *Connection) !*Stream {
        const stream_id = self.next_stream_id;
        self.next_stream_id += 2; // Client streams are odd numbers

        const stream = try self.allocator.create(Stream);
        stream.* = Stream.init(self.allocator, stream_id);

        try self.streams.put(stream_id, stream);
        return stream;
    }

    pub fn getStream(self: *Connection, stream_id: u32) ?*Stream {
        return self.streams.get(stream_id);
    }

    pub fn removeStream(self: *Connection, stream_id: u32) void {
        if (self.streams.fetchRemove(stream_id)) |entry| {
            entry.value.deinit();
            self.allocator.destroy(entry.value);
        }
    }

    pub fn updatePeerSettings(self: *Connection, settings: FullSettingsPayload) void {
        self.peer_settings = settings;

        // Update HPACK table size if changed
        if (settings.headerTableSize != self.peer_settings.headerTableSize) {
            // Update encoder table size
            log("Updating HPACK table size to {d}", .{settings.headerTableSize});
        }
    }

    pub fn canSendData(self: *Connection, stream_id: u32, data_size: usize) bool {
        // Check connection-level flow control
        if (self.connection_window_size < data_size) {
            return false;
        }

        // Check stream-level flow control
        if (self.getStream(stream_id)) |stream| {
            return stream.window_size >= data_size;
        }

        return false;
    }

    pub fn consumeConnectionWindow(self: *Connection, size: usize) void {
        self.connection_window_size -= @intCast(size);
        log("Connection window: {d} bytes remaining", .{self.connection_window_size});
    }

    pub fn sendWindowUpdate(self: *Connection, stream_id: u32, increment: u32) !void {
        if (self.socket) |socket| {
            const window_frame = FrameHeader{
                .length = 4,
                .type = @intFromEnum(FrameType.HTTP_FRAME_WINDOW_UPDATE),
                .flags = 0,
                .streamIdentifier = stream_id,
            };

            var header_bytes: [9]u8 = undefined;
            std.mem.writeInt(u24, header_bytes[0..3], window_frame.length, .big);
            header_bytes[3] = window_frame.type;
            header_bytes[4] = window_frame.flags;
            std.mem.writeInt(u32, header_bytes[5..9], window_frame.streamIdentifier, .big);

            var payload_bytes: [4]u8 = undefined;
            std.mem.writeInt(u32, &payload_bytes, increment, .big);

            var bytes_written = socket.write(&header_bytes);
            if (bytes_written != header_bytes.len) {
                return error.WindowUpdateHeaderFailed;
            }

            bytes_written = socket.write(&payload_bytes);
            if (bytes_written != payload_bytes.len) {
                return error.WindowUpdatePayloadFailed;
            }

            log("Sent WINDOW_UPDATE for stream {d}: +{d}", .{ stream_id, increment });
        }
    }

    pub fn sendRstStream(self: *Connection, stream_id: u32, error_code: ErrorCode) !void {
        if (self.socket) |socket| {
            const rst_frame = FrameHeader{
                .length = 4,
                .type = @intFromEnum(FrameType.HTTP_FRAME_RST_STREAM),
                .flags = 0,
                .streamIdentifier = stream_id,
            };

            var header_bytes: [9]u8 = undefined;
            std.mem.writeInt(u24, header_bytes[0..3], rst_frame.length, .big);
            header_bytes[3] = rst_frame.type;
            header_bytes[4] = rst_frame.flags;
            std.mem.writeInt(u32, header_bytes[5..9], rst_frame.streamIdentifier, .big);

            var payload_bytes: [4]u8 = undefined;
            std.mem.writeInt(u32, &payload_bytes, @intFromEnum(error_code), .big);

            var bytes_written = socket.write(&header_bytes);
            if (bytes_written != header_bytes.len) {
                return error.RstStreamHeaderFailed;
            }

            bytes_written = socket.write(&payload_bytes);
            if (bytes_written != payload_bytes.len) {
                return error.RstStreamPayloadFailed;
            }

            log("Sent RST_STREAM for stream {d}: error_code={d}", .{ stream_id, @intFromEnum(error_code) });
        }
    }
};

// Main HTTP/2 Client structure
allocator: std.mem.Allocator,
connection: ?Connection = null,
url: URL,
method: Method = Method.GET,
headers: Headers.Entry.List = .empty,
header_buf: []const u8 = "",
request_body: HTTPRequestBody = .{ .bytes = "" },
response_buffer: *MutableString,
result_callback: HTTPClientResult.Callback = undefined,
http_proxy: ?URL = null,
signals: Signals = .{},
flags: Flags = .{},
verbose: HTTPVerboseLevel = .none,
redirect_type: FetchRedirect = .follow,
state: InternalState = .{},
connection_state: ConnectionState = .idle,
connected_url: URL = undefined,
tls_props: ?*bun.api.server.ServerConfig.SSLConfig = null,
async_http_id: u32 = 0,

pub fn init(
    allocator: std.mem.Allocator,
    method: Method,
    url: URL,
    headers: Headers.Entry.List,
    header_buf: []const u8,
    body: HTTPRequestBody,
    response_buffer: *MutableString,
    callback: HTTPClientResult.Callback,
    redirect_type: FetchRedirect,
) !HTTP2Client {

    return HTTP2Client{
        .allocator = allocator,
        .url = url,
        .method = method,
        .headers = headers,
        .header_buf = header_buf,
        .request_body = body,
        .response_buffer = response_buffer,
        .result_callback = callback,
        .redirect_type = redirect_type,
        .connected_url = url,
        .async_http_id = bun.http.async_http_id_monotonic.fetchAdd(1, .monotonic),
    };
}

pub fn deinit(self: *HTTP2Client) void {
    // Clean up connection and all associated resources
    if (self.connection) |*conn| {
        // Ensure all streams are properly cleaned up
        var iterator = conn.streams.iterator();
        while (iterator.next()) |entry| {
            const stream = entry.value_ptr.*;
            
            // Send RST_STREAM for any open streams before cleanup
            if (stream.state != .closed and conn.socket != null) {
                conn.sendRstStream(stream.id, .CANCEL) catch {};
            }
            
            stream.deinit();
            self.allocator.destroy(stream);
        }
        conn.streams.clearAndFree();
        
        conn.deinit();
    }
    
    // Clean up any other allocated resources
    if (self.signals.aborted != null) {
        _ = bun.http.socket_async_http_abort_tracker.swapRemove(self.async_http_id);
    }
}

pub fn start(self: *HTTP2Client, body: HTTPRequestBody, response_buffer: *MutableString) void {
    self.request_body = body;
    self.response_buffer = response_buffer;

    // Check for abort signal before starting
    if (self.signals.get(.aborted)) {
        log("Request aborted before start", .{});
        self.fail(error.Aborted);
        return;
    }

    // Connect to the server
    self.connect() catch |err| {
        self.fail(err);
        return;
    };
}

fn connect(self: *HTTP2Client) !void {
    log("Connecting to {s}://{s}:{d}", .{ self.url.protocol, self.url.hostname, self.url.getPortAuto() });

    // Check abort signal during connection
    if (self.signals.get(.aborted)) {
        log("Request aborted during connect", .{});
        return error.Aborted;
    }

    // Update connection state
    self.connection_state = .connecting;

    // Initialize HTTP/2 connection state
    self.connection = try Connection.init(self.allocator);
    if (self.connection) |*conn| {
        conn.state = .connecting;
    }

    // Establish TLS connection with ALPN negotiation for HTTP/2
    // Create a temporary HTTPClient to handle connection establishment
    const is_ssl = self.url.isHTTPS();
    
    // Create minimal HTTPClient for connection establishment
    // Initialize with default values to avoid garbage memory
    var temp_client = HTTPClient{
        .allocator = self.allocator,
        .url = self.url,
        .method = self.method,
        .header_entries = self.headers,
        .header_buf = self.header_buf,
        .signals = self.signals,
        .async_http_id = self.async_http_id,
        .http_proxy = self.http_proxy,
        .flags = self.flags,
        .verbose = self.verbose,
        .tls_props = self.tls_props,
        .redirect_type = self.redirect_type,
        .hostname = null,
        .unix_socket_path = .{},
        .connected_url = URL{},
        .decompressor = .{},
        .state = .none,
        .request_body = .{ .bytes = "" },
        .progress_node = null,
        .aborted = false,
        .should_use_http2 = false,
        .allow_retry = true,
        .cloned_headers_buf = false,
        .result_callback = undefined,
    };
    
    // Connect with comptime SSL parameter
    if (is_ssl) {
        var socket = bun.http.http_thread.connect(&temp_client, true) catch |err| {
            log("HTTP/2 HTTPS connection failed: {}", .{err});
            self.connection_state = .failed;
            return err;
        };

        if (socket.isClosed()) {
            log("HTTP/2 HTTPS socket closed immediately", .{});
            self.connection_state = .failed;
            return error.ConnectionClosed;
        }

        if (temp_client.should_use_http2) {
            log("ALPN negotiated HTTP/2, proceeding with HTTP/2 client", .{});
            // Transfer socket to HTTP/2 client
            try self.onOpen(true, socket);
        } else {
            log("ALPN did not negotiate HTTP/2, falling back to HTTP/1.1", .{});
            return error.HTTP2NotNegotiated;
        }
    } else {
        log("HTTP/2 requires HTTPS, falling back to HTTP/1.1", .{});
        return error.HTTP2RequiresHTTPS;
    }
}

pub fn onOpen(self: *HTTP2Client, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) !void {
    log("HTTP/2 connection opened", .{});

    // Check abort signal after connection opens
    if (self.signals.get(.aborted)) {
        log("Request aborted after connection opened", .{});
        return self.closeAndAbort(is_ssl, socket);
    }

    // Update connection state
    self.connection_state = .active;
    if (self.connection) |*conn| {
        conn.state = .active;
        conn.socket = socket;
    }

    // ALPN negotiation is now handled by the main HTTPClient
    // We assume HTTP/2 was already negotiated if we reach this point

    // Send HTTP/2 connection preface
    try self.sendConnectionPreface(is_ssl, socket);
}

fn fallbackToHTTP1(self: *HTTP2Client, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) !void {
    log("Falling back to HTTP/1.1 from HTTP/2", .{});

    // Create HTTP/1.1 client with current request configuration  
    const reconstructed_header_buf = try self.allocator.dupe(u8, self.header_buf);
    
    var http1_client = HTTPClient{
        .allocator = self.allocator,
        .method = self.method,
        .url = self.url,
        .header_entries = self.headers,
        .header_buf = reconstructed_header_buf,
        .result_callback = self.result_callback,
    };

    // Transfer configuration from HTTP/2 client
    http1_client.http_proxy = self.http_proxy;
    http1_client.signals = self.signals;
    http1_client.flags = self.flags;
    http1_client.verbose = self.verbose;
    http1_client.tls_props = self.tls_props;

    // Proceed with HTTP/1.1 handshake
    return http1_client.firstCall(is_ssl, socket);
}

fn sendConnectionPreface(self: *HTTP2Client, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) !void {
    log("Sending HTTP/2 connection preface", .{});

    // Send the connection preface
    const preface_bytes = HTTP2_CONNECTION_PREFACE;
    const bytes_written = socket.write(preface_bytes);
    if (bytes_written != preface_bytes.len) {
        return self.fail(error.ConnectionPreFaceFailed);
    }

    // Send initial SETTINGS frame
    try self.sendSettingsFrame(is_ssl, socket);
}

fn sendSettingsFrame(self: *HTTP2Client, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) !void {
    log("Sending SETTINGS frame", .{});

    const settings_frame = FrameHeader{
        .length = @sizeOf(FullSettingsPayload),
        .type = @intFromEnum(FrameType.HTTP_FRAME_SETTINGS),
        .flags = 0, // No ACK flag for initial settings
        .streamIdentifier = 0, // Settings frame always uses stream 0
    };

    // Write frame header
    var header_bytes: [9]u8 = undefined;
    std.mem.writeInt(u24, header_bytes[0..3], settings_frame.length, .big);
    header_bytes[3] = settings_frame.type;
    header_bytes[4] = settings_frame.flags;
    std.mem.writeInt(u32, header_bytes[5..9], settings_frame.streamIdentifier, .big);

    var bytes_written = socket.write(&header_bytes);
    if (bytes_written != header_bytes.len) {
        return self.fail(error.SettingsFrameHeaderFailed);
    }

    // Write settings payload
    var settings_bytes: [@sizeOf(FullSettingsPayload)]u8 = undefined;
    const settings = &self.connection.?.local_settings;

    // Manually serialize settings to ensure correct byte order
    var offset: usize = 0;

    // Header table size
    std.mem.writeInt(u16, settings_bytes[offset .. offset + 2][0..2], @intFromEnum(SettingsType.SETTINGS_HEADER_TABLE_SIZE), .big);
    offset += 2;
    std.mem.writeInt(u32, settings_bytes[offset .. offset + 4][0..4], settings.headerTableSize, .big);
    offset += 4;

    // Enable push (disabled for client)
    std.mem.writeInt(u16, settings_bytes[offset .. offset + 2][0..2], @intFromEnum(SettingsType.SETTINGS_ENABLE_PUSH), .big);
    offset += 2;
    std.mem.writeInt(u32, settings_bytes[offset .. offset + 4][0..4], settings.enablePush, .big);
    offset += 4;

    // Max concurrent streams
    std.mem.writeInt(u16, settings_bytes[offset .. offset + 2][0..2], @intFromEnum(SettingsType.SETTINGS_MAX_CONCURRENT_STREAMS), .big);
    offset += 2;
    std.mem.writeInt(u32, settings_bytes[offset .. offset + 4][0..4], settings.maxConcurrentStreams, .big);
    offset += 4;

    // Initial window size
    std.mem.writeInt(u16, settings_bytes[offset .. offset + 2][0..2], @intFromEnum(SettingsType.SETTINGS_INITIAL_WINDOW_SIZE), .big);
    offset += 2;
    std.mem.writeInt(u32, settings_bytes[offset .. offset + 4][0..4], settings.initialWindowSize, .big);
    offset += 4;

    // Max frame size
    std.mem.writeInt(u16, settings_bytes[offset .. offset + 2][0..2], @intFromEnum(SettingsType.SETTINGS_MAX_FRAME_SIZE), .big);
    offset += 2;
    std.mem.writeInt(u32, settings_bytes[offset .. offset + 4][0..4], settings.maxFrameSize, .big);
    offset += 4;

    // Max header list size
    std.mem.writeInt(u16, settings_bytes[offset .. offset + 2][0..2], @intFromEnum(SettingsType.SETTINGS_MAX_HEADER_LIST_SIZE), .big);
    offset += 2;
    std.mem.writeInt(u32, settings_bytes[offset .. offset + 4][0..4], settings.maxHeaderListSize, .big);

    bytes_written = socket.write(&settings_bytes);
    if (bytes_written != settings_bytes.len) {
        return self.fail(error.SettingsFramePayloadFailed);
    }

    self.connection.?.settings_ack_pending = true;

    // Now send the HTTP request
    try self.sendRequest(socket);
}

fn sendRequest(self: *HTTP2Client, socket: NewHTTPContext(true).HTTPSocket) !void {
    log("Sending HTTP/2 request", .{});

    // Create a new stream for this request
    const stream = self.connection.?.createStream() catch |err| {
        log("Failed to create stream: {}", .{err});
        return err;
    };
    // Ensure stream cleanup on error
    errdefer self.connection.?.removeStream(stream.id);

    stream.setState(.open);

    // Build headers for HTTP/2 with proper error handling
    var header_list = std.ArrayList(HeaderField).init(self.allocator);
    defer {
        // Clean up all allocated header strings
        for (header_list.items) |header| {
            self.allocator.free(header.name);
            self.allocator.free(header.value);
        }
        header_list.deinit();
    }

    // Add HTTP/2 pseudo-headers with error handling
    const method_name = self.allocator.dupe(u8, ":method") catch |err| {
        log("Failed to allocate method header name: {}", .{err});
        return err;
    };
    errdefer self.allocator.free(method_name);

    const method_value = self.allocator.dupe(u8, @tagName(self.method)) catch |err| {
        log("Failed to allocate method header value: {}", .{err});
        self.allocator.free(method_name);
        return err;
    };
    errdefer self.allocator.free(method_value);

    header_list.append(.{
        .name = method_name,
        .value = method_value,
        .never_index = false,
        .hpack_index = 255,
    }) catch |err| {
        self.allocator.free(method_name);
        self.allocator.free(method_value);
        return err;
    };

    const scheme_name = self.allocator.dupe(u8, ":scheme") catch |err| {
        log("Failed to allocate scheme header name: {}", .{err});
        return err;
    };
    errdefer self.allocator.free(scheme_name);

    const scheme_value = self.allocator.dupe(u8, if (self.url.isHTTPS()) "https" else "http") catch |err| {
        log("Failed to allocate scheme header value: {}", .{err});
        self.allocator.free(scheme_name);
        return err;
    };
    errdefer self.allocator.free(scheme_value);

    header_list.append(.{
        .name = scheme_name,
        .value = scheme_value,
        .never_index = false,
        .hpack_index = 255,
    }) catch |err| {
        self.allocator.free(scheme_name);
        self.allocator.free(scheme_value);
        return err;
    };

    const authority_name = self.allocator.dupe(u8, ":authority") catch |err| {
        log("Failed to allocate authority header name: {}", .{err});
        return err;
    };
    errdefer self.allocator.free(authority_name);

    const authority_value = self.allocator.dupe(u8, self.url.hostname) catch |err| {
        log("Failed to allocate authority header value: {}", .{err});
        self.allocator.free(authority_name);
        return err;
    };
    errdefer self.allocator.free(authority_value);

    header_list.append(.{
        .name = authority_name,
        .value = authority_value,
        .never_index = false,
        .hpack_index = 255,
    }) catch |err| {
        self.allocator.free(authority_name);
        self.allocator.free(authority_value);
        return err;
    };

    const path = if (self.url.path.len > 0) self.url.path else "/";
    const path_with_query = if (self.url.search.len > 0)
        std.fmt.allocPrint(self.allocator, "{s}{s}", .{ path, self.url.search }) catch |err| {
            log("Failed to allocate path with query: {}", .{err});
            return err;
        }
    else
        self.allocator.dupe(u8, path) catch |err| {
            log("Failed to allocate path: {}", .{err});
            return err;
        };
    defer self.allocator.free(path_with_query);

    const path_name = self.allocator.dupe(u8, ":path") catch |err| {
        log("Failed to allocate path header name: {}", .{err});
        return err;
    };
    errdefer self.allocator.free(path_name);

    const path_value = self.allocator.dupe(u8, path_with_query) catch |err| {
        log("Failed to allocate path header value: {}", .{err});
        self.allocator.free(path_name);
        return err;
    };
    errdefer self.allocator.free(path_value);

    header_list.append(.{
        .name = path_name,
        .value = path_value,
        .never_index = false,
        .hpack_index = 255,
    }) catch |err| {
        self.allocator.free(path_name);
        self.allocator.free(path_value);
        return err;
    };

    // Add regular headers with error handling
    var i: usize = 0;
    while (i < self.headers.len) : (i += 1) {
        const header = self.headers.get(i);
        const header_name = self.allocator.dupe(u8, header.name.slice(self.header_buf)) catch |err| {
            log("Failed to allocate header name: {}", .{err});
            return err;
        };
        errdefer self.allocator.free(header_name);

        const header_value = self.allocator.dupe(u8, header.value.slice(self.header_buf)) catch |err| {
            log("Failed to allocate header value: {}", .{err});
            self.allocator.free(header_name);
            return err;
        };
        errdefer self.allocator.free(header_value);

        header_list.append(.{
            .name = header_name,
            .value = header_value,
            .never_index = false,
            .hpack_index = 255,
        }) catch |err| {
            self.allocator.free(header_name);
            self.allocator.free(header_value);
            return err;
        };
    }

    // Encode headers using HPACK
    var header_buffer: [8192]u8 = undefined;
    var header_buffer_len: usize = 0;

    for (header_list.items) |header| {
        header_buffer_len = self.connection.?.hpack_encoder.encode(
            header.name,
            header.value,
            header.never_index,
            &header_buffer,
            header_buffer_len,
        ) catch |err| {
            log("HPACK encoding failed: {}", .{err});
            return err;
        };

        // Validate that we don't exceed buffer size
        if (header_buffer_len >= header_buffer.len) {
            log("Header buffer overflow", .{});
            return error.HeadersTooBig;
        }
    }

    // Send HEADERS frame
    const has_body = switch (self.request_body) {
        .bytes => |bytes| bytes.len > 0,
        else => true, // Assume other body types have content
    };

    const headers_flags: u8 = if (has_body)
        @intFromEnum(HeadersFrameFlags.END_HEADERS)
    else
        @intFromEnum(HeadersFrameFlags.END_HEADERS) | @intFromEnum(HeadersFrameFlags.END_STREAM);

    self.sendHeadersFrame(socket, stream.id, headers_flags, header_buffer[0..header_buffer_len]) catch |err| {
        log("Failed to send headers frame: {}", .{err});
        return err;
    };

    // Send body if present
    if (has_body) {
        self.sendDataFrame(socket, stream) catch |err| {
            log("Failed to send data frame: {}", .{err});
            return err;
        };
    }

    // Headers successfully sent, clear errdefer for stream removal
    // (stream ownership now belongs to connection)
}

fn sendHeadersFrame(self: *HTTP2Client, socket: NewHTTPContext(true).HTTPSocket, stream_id: u32, flags: u8, header_data: []const u8) !void {
    const headers_frame = FrameHeader{
        .length = @intCast(header_data.len),
        .type = @intFromEnum(FrameType.HTTP_FRAME_HEADERS),
        .flags = flags,
        .streamIdentifier = stream_id,
    };

    // Write frame header
    var header_bytes: [9]u8 = undefined;
    std.mem.writeInt(u24, header_bytes[0..3], headers_frame.length, .big);
    header_bytes[3] = headers_frame.type;
    header_bytes[4] = headers_frame.flags;
    std.mem.writeInt(u32, header_bytes[5..9], headers_frame.streamIdentifier, .big);

    var bytes_written = socket.write(&header_bytes);
    if (bytes_written != header_bytes.len) {
        return self.fail(error.HeadersFrameHeaderFailed);
    }

    // Write headers payload
    bytes_written = socket.write(header_data);
    if (bytes_written != header_data.len) {
        return self.fail(error.HeadersFramePayloadFailed);
    }

    log("Sent HEADERS frame for stream {d} ({d} bytes)", .{ stream_id, header_data.len });
}

fn sendDataFrame(self: *HTTP2Client, socket: NewHTTPContext(true).HTTPSocket, stream: *Stream) !void {
    const body_data = switch (self.request_body) {
        .bytes => |bytes| bytes,
        else => {
            log("Unsupported request body type", .{});
            return self.fail(error.UnsupportedBodyType);
        },
    };

    if (body_data.len == 0) return;

    // For simplicity, send all data in one frame
    // In production, this should be chunked based on peer's max frame size
    const data_flags: u8 = @intFromEnum(DataFrameFlags.END_STREAM);

    const data_frame = FrameHeader{
        .length = @intCast(body_data.len),
        .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
        .flags = data_flags,
        .streamIdentifier = stream.id,
    };

    // Write frame header
    var header_bytes: [9]u8 = undefined;
    std.mem.writeInt(u24, header_bytes[0..3], data_frame.length, .big);
    header_bytes[3] = data_frame.type;
    header_bytes[4] = data_frame.flags;
    std.mem.writeInt(u32, header_bytes[5..9], data_frame.streamIdentifier, .big);

    var bytes_written = socket.write(&header_bytes);
    if (bytes_written != header_bytes.len) {
        return self.fail(error.DataFrameHeaderFailed);
    }

    // Write data payload
    bytes_written = socket.write(body_data);
    if (bytes_written != body_data.len) {
        return self.fail(error.DataFramePayloadFailed);
    }

    log("Sent DATA frame for stream {d} ({d} bytes)", .{ stream.id, body_data.len });
    stream.setState(.half_closed_local);
}

pub fn onData(
    self: *HTTP2Client,
    comptime is_ssl: bool,
    data: []const u8,
    context: *NewHTTPContext(is_ssl),
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    _ = context;

    log("Received HTTP/2 data: {d} bytes", .{data.len});

    // Check abort signal during data processing
    if (self.signals.get(.aborted)) {
        log("Request aborted during data processing", .{});
        self.closeAndAbort(is_ssl, socket);
        return;
    }

    // Parse HTTP/2 frames
    self.parseFrames(data) catch |err| {
        log("Frame parsing error: {}", .{err});
        self.closeAndFail(err, is_ssl, socket);
    };
}

fn parseFrames(self: *HTTP2Client, data: []const u8) !void {
    var offset: usize = 0;

    while (offset < data.len) {
        // Need at least 9 bytes for frame header
        if (offset + 9 > data.len) {
            log("Incomplete frame header, buffering needed", .{});
            break;
        }

        // Parse frame header
        const length = std.mem.readInt(u24, data[offset .. offset + 3], .big);
        const frame_type = data[offset + 3];
        const flags = data[offset + 4];
        const stream_id = std.mem.readInt(u32, data[offset + 5 .. offset + 9], .big) & 0x7FFFFFFF; // Clear reserved bit

        offset += 9;

        // Check if we have the complete frame
        if (offset + length > data.len) {
            log("Incomplete frame payload, buffering needed", .{});
            break;
        }

        const payload = data[offset .. offset + length];
        offset += length;

        log("Received frame: type={d}, flags={d}, stream={d}, length={d}", .{ frame_type, flags, stream_id, length });

        // Process frame based on type
        try self.processFrame(frame_type, flags, stream_id, payload);
    }
}

fn processFrame(self: *HTTP2Client, frame_type: u8, flags: u8, stream_id: u32, payload: []const u8) !void {
    // Validate frame type
    const ftype = @as(FrameType, @enumFromInt(frame_type)) catch {
        log("Invalid frame type: {d}", .{frame_type});
        return error.ProtocolError;
    };

    // Validate stream ID for frame types that require specific stream restrictions
    switch (ftype) {
        .HTTP_FRAME_SETTINGS, .HTTP_FRAME_PING, .HTTP_FRAME_GOAWAY => {
            if (stream_id != 0) {
                log("Frame type {d} must use stream ID 0, got {d}", .{ frame_type, stream_id });
                return error.ProtocolError;
            }
        },
        .HTTP_FRAME_WINDOW_UPDATE => {
            // Window update can be for connection (stream 0) or specific stream
        },
        .HTTP_FRAME_HEADERS, .HTTP_FRAME_DATA, .HTTP_FRAME_RST_STREAM => {
            if (stream_id == 0) {
                log("Frame type {d} cannot use stream ID 0", .{frame_type});
                return error.ProtocolError;
            }
            // Check if stream ID is valid for client (odd numbers only)
            if (stream_id % 2 == 0) {
                log("Invalid stream ID for client: {d} (must be odd)", .{stream_id});
                return error.ProtocolError;
            }
        },
        else => {
            // Unknown frame types are allowed but ignored
        },
    }

    // Validate payload size for specific frame types
    switch (ftype) {
        .HTTP_FRAME_SETTINGS => {
            if ((flags & @intFromEnum(SettingsFlags.ACK)) == 0 and payload.len % 6 != 0) {
                log("SETTINGS frame payload size must be multiple of 6, got {d}", .{payload.len});
                return error.FrameSizeError;
            }
        },
        .HTTP_FRAME_WINDOW_UPDATE => {
            if (payload.len != 4) {
                log("WINDOW_UPDATE frame payload must be 4 bytes, got {d}", .{payload.len});
                return error.FrameSizeError;
            }
        },
        .HTTP_FRAME_PING => {
            if (payload.len != 8) {
                log("PING frame payload must be 8 bytes, got {d}", .{payload.len});
                return error.FrameSizeError;
            }
        },
        .HTTP_FRAME_RST_STREAM => {
            if (payload.len != 4) {
                log("RST_STREAM frame payload must be 4 bytes, got {d}", .{payload.len});
                return error.FrameSizeError;
            }
        },
        .HTTP_FRAME_GOAWAY => {
            if (payload.len < 8) {
                log("GOAWAY frame payload must be at least 8 bytes, got {d}", .{payload.len});
                return error.FrameSizeError;
            }
        },
        else => {},
    }

    // Check connection state before processing
    if (self.connection) |*conn| {
        if (conn.state == .failed or conn.state == .connection_closed) {
            log("Received frame on closed/error connection", .{});
            return;
        }

        // Check if we've received GOAWAY and this stream is beyond the limit
        if (conn.goaway_received and stream_id > conn.last_stream_id and stream_id != 0) {
            log("Received frame for stream {d} after GOAWAY (last_stream_id={d})", .{ stream_id, conn.last_stream_id });
            return;
        }
    }

    switch (ftype) {
        .HTTP_FRAME_SETTINGS => try self.processSettingsFrame(flags, payload),
        .HTTP_FRAME_HEADERS => try self.processHeadersFrame(stream_id, flags, payload),
        .HTTP_FRAME_DATA => try self.processDataFrame(stream_id, flags, payload),
        .HTTP_FRAME_WINDOW_UPDATE => try self.processWindowUpdateFrame(stream_id, payload),
        .HTTP_FRAME_PING => try self.processPingFrame(flags, payload),
        .HTTP_FRAME_GOAWAY => try self.processGoAwayFrame(payload),
        .HTTP_FRAME_RST_STREAM => try self.processRstStreamFrame(stream_id, payload),
        else => {
            log("Ignoring unsupported frame type: {d}", .{frame_type});
        },
    }
}

fn processSettingsFrame(self: *HTTP2Client, flags: u8, payload: []const u8) !void {
    log("Processing SETTINGS frame, flags={d}", .{flags});

    if (flags & @intFromEnum(SettingsFlags.ACK) != 0) {
        // This is a SETTINGS ACK
        self.connection.?.settings_ack_pending = false;
        log("Received SETTINGS ACK", .{});
        return;
    }

    // Parse settings
    var offset: usize = 0;
    while (offset + 6 <= payload.len) {
        const setting_id = std.mem.readInt(u16, payload[offset .. offset + 2], .big);
        const setting_value = std.mem.readInt(u32, payload[offset + 2 .. offset + 6], .big);
        offset += 6;

        log("Setting: id={d}, value={d}", .{ setting_id, setting_value });

        // Update peer settings
        const unit = SettingsPayloadUnit{
            .type = setting_id,
            .value = setting_value,
        };
        self.connection.?.peer_settings.updateWith(unit);
    }

    // Send SETTINGS ACK
    try self.sendSettingsAck();
}

fn sendSettingsAck(self: *HTTP2Client) !void {
    if (self.connection.?.socket) |socket| {
        const ack_frame = FrameHeader{
            .length = 0,
            .type = @intFromEnum(FrameType.HTTP_FRAME_SETTINGS),
            .flags = @intFromEnum(SettingsFlags.ACK),
            .streamIdentifier = 0,
        };

        var header_bytes: [9]u8 = undefined;
        std.mem.writeInt(u24, header_bytes[0..3], ack_frame.length, .big);
        header_bytes[3] = ack_frame.type;
        header_bytes[4] = ack_frame.flags;
        std.mem.writeInt(u32, header_bytes[5..9], ack_frame.streamIdentifier, .big);

        const bytes_written = socket.write(&header_bytes);
        if (bytes_written != header_bytes.len) {
            return error.SettingsAckFailed;
        }

        log("Sent SETTINGS ACK", .{});
    }
}

fn sendRstStream(self: *HTTP2Client, stream_id: u32, error_code: ErrorCode) !void {
    try self.connection.?.sendRstStream(stream_id, error_code);
}

fn processHeadersFrame(self: *HTTP2Client, stream_id: u32, flags: u8, payload: []const u8) !void {
    log("Processing HEADERS frame for stream {d}", .{stream_id});

    const stream = self.connection.?.getStream(stream_id) orelse {
        log("Received headers for unknown stream {d}", .{stream_id});
        return;
    };

    // Keep track of allocated headers for cleanup on error
    var allocated_headers = std.ArrayList(HeaderField).init(self.allocator);
    defer {
        // Clean up allocated headers on error
        for (allocated_headers.items) |header| {
            self.allocator.free(header.name);
            self.allocator.free(header.value);
        }
        allocated_headers.deinit();
    }

    // Decode HPACK headers
    var offset: usize = 0;
    while (offset < payload.len) {
        const result = self.connection.?.hpack_decoder.decode(payload[offset..]) catch |err| {
            log("HPACK decode error: {}", .{err});
            return err;
        };

        // Allocate header strings with error handling
        const name = self.allocator.dupe(u8, result.name) catch |err| {
            log("Failed to allocate header name: {}", .{err});
            return err;
        };

        const value = self.allocator.dupe(u8, result.value) catch |err| {
            self.allocator.free(name);
            log("Failed to allocate header value: {}", .{err});
            return err;
        };

        const header_field = HeaderField{
            .name = name,
            .value = value,
            .never_index = result.never_index,
            .hpack_index = result.well_know,
        };

        // Add to temporary list for cleanup on error
        allocated_headers.append(header_field) catch |err| {
            self.allocator.free(name);
            self.allocator.free(value);
            return err;
        };

        log("Header: {s}: {s}", .{ result.name, result.value });
        offset += result.next;

        if (result.next == 0) break; // Prevent infinite loop
    }

    // Transfer headers to stream (only on success)
    for (allocated_headers.items) |header| {
        try stream.response_headers.append(header);
    }
    // Clear the temporary list without deallocating (ownership transferred)
    allocated_headers.clearRetainingCapacity();

    if (flags & @intFromEnum(HeadersFrameFlags.END_HEADERS) != 0) {
        stream.end_headers_received = true;
        stream.headers_received = true;
    }

    if (flags & @intFromEnum(HeadersFrameFlags.END_STREAM) != 0) {
        stream.end_stream_received = true;
        stream.setState(.half_closed_remote);

        // Check if response is complete
        if (stream.headers_received and stream.end_stream_received) {
            try self.completeResponse(stream);
        }
    }
}

fn processDataFrame(self: *HTTP2Client, stream_id: u32, flags: u8, payload: []const u8) !void {
    log("Processing DATA frame for stream {d} ({d} bytes)", .{ stream_id, payload.len });

    const stream = self.connection.?.getStream(stream_id) orelse {
        log("Received data for unknown stream {d}", .{stream_id});
        return;
    };

    // Update flow control windows
    self.connection.?.consumeConnectionWindow(payload.len);
    stream.window_size -= @intCast(payload.len);

    // Append data to response buffer
    try stream.response_data.appendSlice(payload);

    // Send WINDOW_UPDATE if we've consumed significant data
    const window_threshold = DEFAULT_SETTINGS.initialWindowSize / 2;
    if (stream.window_size < window_threshold) {
        const increment = DEFAULT_SETTINGS.initialWindowSize - @as(u32, @intCast(stream.window_size));
        try self.connection.?.sendWindowUpdate(stream_id, increment);
        stream.window_size += @intCast(increment);
    }

    // Send connection-level WINDOW_UPDATE if needed
    if (self.connection.?.connection_window_size < window_threshold) {
        const increment = DEFAULT_SETTINGS.initialWindowSize - @as(u32, @intCast(self.connection.?.connection_window_size));
        try self.connection.?.sendWindowUpdate(0, increment);
        self.connection.?.connection_window_size += @intCast(increment);
    }

    if (flags & @intFromEnum(DataFrameFlags.END_STREAM) != 0) {
        stream.end_stream_received = true;
        stream.setState(.half_closed_remote);

        // Check if response is complete
        if (stream.headers_received and stream.end_stream_received) {
            try self.completeResponse(stream);
        }
    }
}

fn processWindowUpdateFrame(self: *HTTP2Client, stream_id: u32, payload: []const u8) !void {
    if (payload.len < 4) {
        log("WINDOW_UPDATE frame too short: {d} bytes", .{payload.len});
        return error.FrameSizeError;
    }

    const window_increment_raw = std.mem.readInt(u32, payload[0..4], .big);
    const window_increment = window_increment_raw & 0x7FFFFFFF;
    log("Window update: stream={d}, increment={d}", .{ stream_id, window_increment });

    // Validate window increment (RFC 7540, Section 6.9.1)
    if (window_increment == 0) {
        log("WINDOW_UPDATE with zero increment is invalid", .{});
        if (stream_id == 0) {
            // Connection error
            self.fail(error.ProtocolError);
        } else {
            // Stream error - send RST_STREAM
            try self.sendRstStream(stream_id, .PROTOCOL_ERROR);
        }
        return;
    }

    if (stream_id == 0) {
        // Connection-level window update
        const old_window = self.connection.?.connection_window_size;
        const new_window = old_window + @as(i32, @intCast(window_increment));

        // Check for window size overflow (RFC 7540, Section 6.9.1)
        if (new_window > std.math.maxInt(i31)) {
            log("Connection window size overflow: {d} + {d}", .{ old_window, window_increment });
            self.fail(error.FlowControlError);
            return;
        }

        self.connection.?.connection_window_size = new_window;
        log("Connection window updated: {d} -> {d}", .{ old_window, new_window });
    } else {
        // Stream-level window update
        if (self.connection.?.getStream(stream_id)) |stream| {
            const old_window = stream.window_size;
            const new_window = old_window + @as(i32, @intCast(window_increment));

            // Check for window size overflow
            if (new_window > std.math.maxInt(i31)) {
                log("Stream {d} window size overflow: {d} + {d}", .{ stream_id, old_window, window_increment });
                try self.sendRstStream(stream_id, .FLOW_CONTROL_ERROR);
                return;
            }

            stream.window_size = new_window;
            log("Stream {d} window updated: {d} -> {d}", .{ stream_id, old_window, new_window });
        } else {
            // Window update for unknown stream - ignore silently as per RFC 7540
            log("Ignoring WINDOW_UPDATE for unknown stream {d}", .{stream_id});
        }
    }
}

fn processPingFrame(self: *HTTP2Client, flags: u8, payload: []const u8) !void {
    log("Processing PING frame, flags={d}", .{flags});

    if (flags & @intFromEnum(PingFrameFlags.ACK) != 0) {
        // This is a PING ACK, nothing to do
        return;
    }

    // Send PING ACK
    if (self.connection.?.socket) |socket| {
        const ping_frame = FrameHeader{
            .length = 8,
            .type = @intFromEnum(FrameType.HTTP_FRAME_PING),
            .flags = @intFromEnum(PingFrameFlags.ACK),
            .streamIdentifier = 0,
        };

        var header_bytes: [9]u8 = undefined;
        std.mem.writeInt(u24, header_bytes[0..3], ping_frame.length, .big);
        header_bytes[3] = ping_frame.type;
        header_bytes[4] = ping_frame.flags;
        std.mem.writeInt(u32, header_bytes[5..9], ping_frame.streamIdentifier, .big);

        var bytes_written = socket.write(&header_bytes);
        if (bytes_written != header_bytes.len) {
            return error.PingAckHeaderFailed;
        }

        // Echo the ping payload
        bytes_written = socket.write(payload);
        if (bytes_written != payload.len) {
            return error.PingAckPayloadFailed;
        }

        log("Sent PING ACK", .{});
    }
}

fn processGoAwayFrame(self: *HTTP2Client, payload: []const u8) !void {
    if (payload.len < 8) return error.GoAwayTooShort;

    const last_stream_id = std.mem.readInt(u32, payload[0..4], .big) & 0x7FFFFFFF;
    const error_code = std.mem.readInt(u32, payload[4..8], .big);

    log("Received GOAWAY: last_stream={d}, error_code={d}", .{ last_stream_id, error_code });

    self.connection.?.goaway_received = true;
    self.connection.?.last_stream_id = last_stream_id;

    // Fail the connection
    const err_code = @as(ErrorCode, @enumFromInt(error_code));
    const err = switch (err_code) {
        .NO_ERROR => error.ConnectionClosed,
        .PROTOCOL_ERROR => error.ProtocolError,
        .INTERNAL_ERROR => error.InternalError,
        .FLOW_CONTROL_ERROR => error.FlowControlError,
        else => error.HTTP2Error,
    };

    self.fail(err);
}

fn processRstStreamFrame(self: *HTTP2Client, stream_id: u32, payload: []const u8) !void {
    if (payload.len < 4) {
        log("RST_STREAM frame too short: {d} bytes", .{payload.len});
        return error.FrameSizeError;
    }

    const error_code = std.mem.readInt(u32, payload[0..4], .big);
    log("Received RST_STREAM: stream={d}, error_code={d}", .{ stream_id, error_code });

    // Get the stream before removing it to check its state
    const stream = self.connection.?.getStream(stream_id);
    if (stream == null) {
        log("Received RST_STREAM for unknown stream {d}", .{stream_id});
        return; // Ignore RST_STREAM for unknown streams
    }

    // Categorize the error more precisely
    const err_code = @as(ErrorCode, @enumFromInt(error_code)) catch {
        log("Unknown RST_STREAM error code: {d}", .{error_code});
        return error.ProtocolError;
    };

    const stream_error = switch (err_code) {
        .NO_ERROR => error.StreamClosed,
        .PROTOCOL_ERROR => error.StreamProtocolError,
        .INTERNAL_ERROR => error.StreamInternalError,
        .FLOW_CONTROL_ERROR => error.StreamFlowControlError,
        .STREAM_CLOSED => error.StreamClosed,
        .FRAME_SIZE_ERROR => error.StreamFrameSizeError,
        .REFUSED_STREAM => error.StreamRefused,
        .CANCEL => error.StreamCancelled,
        .COMPRESSION_ERROR => error.StreamCompressionError,
        .CONNECT_ERROR => error.StreamConnectError,
        .ENHANCE_YOUR_CALM => error.StreamEnhanceYourCalm,
        .INADEQUATE_SECURITY => error.StreamInadequateSecurity,
        .HTTP_1_1_REQUIRED => error.StreamHTTP11Required,
        else => error.StreamError,
    };

    // Set stream state to closed before removal
    if (stream) |s| {
        s.setState(.closed);
    }

    // Remove the stream
    self.connection.?.removeStream(stream_id);

    // Check if this is a critical error or if we have no more streams
    const should_fail_connection = switch (err_code) {
        .PROTOCOL_ERROR, .INTERNAL_ERROR, .COMPRESSION_ERROR => true,
        .REFUSED_STREAM, .CANCEL => self.connection.?.streams.count() == 0,
        else => self.connection.?.streams.count() == 0,
    };

    if (should_fail_connection) {
        log("Failing connection due to RST_STREAM: {s}", .{@errorName(stream_error)});
        self.fail(stream_error);
    }
}

fn completeResponse(self: *HTTP2Client, stream: *Stream) !void {
    log("Completing response for stream {d}", .{stream.id});

    // Build response buffer from headers and data
    self.response_buffer.list.clearRetainingCapacity();

    // Find status header and reason phrase
    var status_code: u16 = 200;
    var reason_phrase: []const u8 = "OK";
    
    for (stream.response_headers.items) |header| {
        if (strings.eql(header.name, ":status")) {
            status_code = std.fmt.parseInt(u16, header.value, 10) catch 200;
            // Set appropriate reason phrase based on status code
            reason_phrase = switch (status_code) {
                200 => "OK",
                201 => "Created",
                204 => "No Content",
                301 => "Moved Permanently",
                302 => "Found",
                304 => "Not Modified",
                400 => "Bad Request",
                401 => "Unauthorized",
                403 => "Forbidden",
                404 => "Not Found",
                405 => "Method Not Allowed",
                500 => "Internal Server Error",
                502 => "Bad Gateway",
                503 => "Service Unavailable",
                else => "Unknown",
            };
            break;
        }
    }

    // Build HTTP/1.1 style response for compatibility
    const status_line = try std.fmt.allocPrint(self.allocator, "HTTP/1.1 {d} {s}\r\n", .{ status_code, reason_phrase });
    defer self.allocator.free(status_line);

    try self.response_buffer.list.appendSlice(status_line);

    // Add headers (skip pseudo-headers)
    for (stream.response_headers.items) |header| {
        if (!strings.startsWith(header.name, ":")) {
            const header_line = try std.fmt.allocPrint(self.allocator, "{s}: {s}\r\n", .{ header.name, header.value });
            defer self.allocator.free(header_line);
            try self.response_buffer.list.appendSlice(header_line);
        }
    }

    // End headers
    try self.response_buffer.list.appendSlice("\r\n");

    // Add body
    try self.response_buffer.list.appendSlice(stream.response_data.items);

    // Clean up stream
    stream.setState(.closed);
    self.connection.?.removeStream(stream.id);

    // Success callback
    const result = HTTPClientResult{
        .metadata = null, // TODO: Implement proper metadata
        .fail = null,
        .has_more = false,
    };

    self.result_callback.function(self.result_callback.ctx, @ptrCast(self), result);
}

pub fn onClose(self: *HTTP2Client, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    _ = socket;

    log("HTTP/2 connection closed", .{});

    if (self.connection) |*conn| {
        conn.socket = null;
    }

    // Fail any pending requests
    if (!self.isFinished()) {
        self.fail(error.ConnectionClosed);
    }
}

pub fn onTimeout(self: *HTTP2Client, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    _ = socket;

    log("HTTP/2 connection timeout", .{});
    self.fail(error.Timeout);
}

pub fn onConnectError(self: *HTTP2Client) void {
    log("HTTP/2 connection error", .{});
    self.fail(error.ConnectionFailed);
}

pub fn onWritable(self: *HTTP2Client, need_flush: bool, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    _ = self;
    _ = need_flush;
    _ = socket;

    // HTTP/2 doesn't use traditional request writing like HTTP/1.1
    // Requests are sent immediately in onOpen after the handshake
}

fn fail(self: *HTTP2Client, err: anyerror) void {
    log("HTTP/2 client failed: {}", .{err});

    if (self.isFinished()) return;

    // Clean up connection state
    self.connection_state = .failed;
    if (self.connection) |*conn| {
        conn.state = .failed;
        conn.error_code = switch (err) {
            error.ProtocolError => .PROTOCOL_ERROR,
            error.InternalError => .INTERNAL_ERROR,
            error.FlowControlError => .FLOW_CONTROL_ERROR,
            error.StreamError => .STREAM_CLOSED,
            error.ConnectionClosed => .NO_ERROR,
            error.Aborted => .CANCEL,
            else => .INTERNAL_ERROR,
        };

        // Clean up all active streams
        var iterator = conn.streams.iterator();
        while (iterator.next()) |entry| {
            entry.value_ptr.*.setState(.closed);
            entry.value_ptr.*.deinit();
            self.allocator.destroy(entry.value_ptr.*);
        }
        conn.streams.clearAndFree();
    }

    // Update internal state
    self.state.stage = .fail;

    const result = HTTPClientResult{
        .fail = err,
        .metadata = null,
        .has_more = false,
    };

    self.result_callback.function(self.result_callback.ctx, @ptrCast(self), result);
}

fn isFinished(self: *HTTP2Client) bool {
    return self.state.stage == .done;
}

// Compatibility functions to integrate with existing HTTPClient interface
pub fn closeAndFail(self: *HTTP2Client, err: anyerror, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    log("closeAndFail: {s}", .{@errorName(err)});

    // Update connection state
    self.connection_state = .closing;
    if (self.connection) |*conn| {
        conn.state = .closing;
    }

    // Unregister abort tracker if present
    if (self.signals.aborted != null) {
        // Remove from global abort tracker if registered
        _ = bun.http.socket_async_http_abort_tracker.swapRemove(self.async_http_id);
    }

    // Close socket if not already closed
    if (!socket.isClosed()) {
        NewHTTPContext(is_ssl).terminateSocket(socket);
    }

    // Update state to closed
    self.connection_state = .connection_closed;
    if (self.connection) |*conn| {
        conn.state = .connection_closed;
        conn.socket = null;
    }

    self.fail(err);
}

pub fn closeAndAbort(self: *HTTP2Client, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    log("closeAndAbort", .{});
    self.closeAndFail(error.Aborted, comptime is_ssl, socket);
}

pub fn progressUpdate(self: *HTTP2Client, comptime is_ssl: bool, context: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    _ = self;
    _ = context;
    _ = socket;
    // TODO: Implement progress updates if needed
}

pub fn firstCall(self: *HTTP2Client, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    _ = self;
    _ = socket;
    // HTTP/2 handshake is handled in onOpen
}

// Export HeaderField for external use
pub const ExportedHeaderField = HeaderField;
