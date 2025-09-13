const std = @import("std");
const bun = @import("../bun.zig");
const uws = bun.uws;
const AsyncHTTP = @import("./AsyncHTTP.zig");
const HTTPClient = @import("../http.zig");
const HTTPClientResult = HTTPClient.HTTPClientResult;
const HTTPThread = @import("./HTTPThread.zig");
const URL = @import("../url.zig").URL;
const Output = bun.Output;
const MutableString = bun.MutableString;
const strings = bun.strings;

const log = Output.scoped(.ftp, .visible);

pub const FTPSocket = uws.NewSocketHandler(false);
pub const FTPDataSocket = uws.NewSocketHandler(false);

const FTPState = enum {
    initial,
    connecting,
    connected,
    user_sent,
    pass_sent,
    type_sent,
    cwd_sent,
    pasv_sent,
    port_sent,
    epsv_sent,
    size_requested,
    list_sent,
    retr_sent,
    stor_sent,
    rest_sent,
    receiving_data,
    sending_data,
    completed,
    failed,
};

const FTPCommand = enum {
    download,
    upload,
    list,
    nlst,
    size,
    mdtm,
};

pub const FTPContext = struct {
    control_context: *uws.SocketContext,
    data_context: *uws.SocketContext,

    pub fn init(loop: *uws.Loop) !*FTPContext {
        const ctx = try bun.default_allocator.create(FTPContext);
        errdefer bun.default_allocator.destroy(ctx);

        // Create control socket context
        ctx.control_context = uws.SocketContext.createNoSSLContext(loop, @sizeOf(usize)) orelse {
            return error.FailedToCreateControlContext;
        };
        errdefer ctx.control_context.deinit(false);

        // Create data socket context
        ctx.data_context = uws.SocketContext.createNoSSLContext(loop, @sizeOf(usize)) orelse {
            ctx.control_context.deinit(false);
            return error.FailedToCreateDataContext;
        };

        // Set up control socket callbacks using raw C API
        const c = uws.c;
        c.us_socket_context_on_open(0, ctx.control_context, FTPControlHandler.onOpenWrapper);
        c.us_socket_context_on_data(0, ctx.control_context, FTPControlHandler.onDataWrapper);
        c.us_socket_context_on_close(0, ctx.control_context, FTPControlHandler.onCloseWrapper);
        c.us_socket_context_on_writable(0, ctx.control_context, FTPControlHandler.onWritableWrapper);
        c.us_socket_context_on_timeout(0, ctx.control_context, FTPControlHandler.onTimeoutWrapper);
        c.us_socket_context_on_connect_error(0, ctx.control_context, FTPControlHandler.onConnectErrorWrapper);

        // Set up data socket callbacks using raw C API
        c.us_socket_context_on_open(0, ctx.data_context, FTPDataHandler.onOpenWrapper);
        c.us_socket_context_on_data(0, ctx.data_context, FTPDataHandler.onDataWrapper);
        c.us_socket_context_on_close(0, ctx.data_context, FTPDataHandler.onCloseWrapper);
        c.us_socket_context_on_writable(0, ctx.data_context, FTPDataHandler.onWritableWrapper);
        c.us_socket_context_on_timeout(0, ctx.data_context, FTPDataHandler.onTimeoutWrapper);
        c.us_socket_context_on_connect_error(0, ctx.data_context, FTPDataHandler.onConnectErrorWrapper);

        return ctx;
    }

    pub fn deinit(ctx: *FTPContext) void {
        ctx.control_context.deinit(false);
        ctx.data_context.deinit(false);
        bun.default_allocator.destroy(ctx);
    }
};

pub const FTPClient = struct {
    allocator: std.mem.Allocator,
    async_http: *AsyncHTTP,
    url: URL,
    state: FTPState = .initial,
    command: FTPCommand = .download,

    control_socket: ?FTPSocket = null,
    data_socket: ?FTPDataSocket = null,

    response_buffer: MutableString,
    control_buffer: std.ArrayList(u8),

    passive_host: []u8 = "",
    passive_port: u16 = 0,
    active_port: u16 = 0,

    file_size: ?usize = null,
    file_path: []const u8 = "",
    upload_data: []const u8 = "",
    resume_offset: usize = 0,

    last_response_code: u16 = 0,
    last_response: []u8 = "",

    use_epsv: bool = false,
    use_active: bool = false,
    binary_mode: bool = true,

    pub fn init(allocator: std.mem.Allocator, async_http: *AsyncHTTP) *FTPClient {
        const client = allocator.create(FTPClient) catch bun.outOfMemory();
        client.* = .{
            .allocator = allocator,
            .async_http = async_http,
            .url = async_http.url,
            .response_buffer = async_http.response_buffer,
            .control_buffer = std.ArrayList(u8).init(allocator),
        };
        return client;
    }

    pub fn deinit(this: *FTPClient) void {
        if (this.control_socket) |socket| {
            socket.close(0, null);
        }
        if (this.data_socket) |socket| {
            socket.close(0, null);
        }
        this.control_buffer.deinit();
        if (this.passive_host.len > 0) {
            this.allocator.free(this.passive_host);
        }
        if (this.last_response.len > 0) {
            this.allocator.free(this.last_response);
        }
        this.allocator.destroy(this);
    }

    pub fn connect(this: *FTPClient, ctx: *FTPContext) !void {
        const hostname = this.url.hostname;
        const port = this.url.getPort() orelse 21;

        log("Connecting to FTP server {s}:{}", .{ hostname, port });

        // Allocate hostname buffer
        const host_buf = try this.allocator.dupeZ(u8, hostname);
        defer this.allocator.free(host_buf);

        var has_dns_resolved: i32 = 0;
        const socket = ctx.control_context.connect(
            false,
            host_buf.ptr,
            @intCast(port),
            0,
            @sizeOf(usize),
            &has_dns_resolved,
        );

        if (socket) |sock| {
            this.control_socket = @ptrCast(sock);
            // Store reference to FTPClient in socket ext
            if (this.control_socket.?.ext(usize)) |ext| {
                ext.* = @intFromPtr(this);
            }
            this.state = .connecting;
        } else {
            return error.ConnectionFailed;
        }
    }

    pub fn sendCommand(this: *FTPClient, comptime fmt: []const u8, args: anytype) !void {
        const command = try std.fmt.allocPrint(this.allocator, fmt ++ "\r\n", args);
        defer this.allocator.free(command);

        log("FTP >> {s}", .{std.mem.trimRight(u8, command, "\r\n")});

        if (this.control_socket) |socket| {
            _ = socket.write(command, false);
        } else {
            return error.NotConnected;
        }
    }

    pub fn processResponse(this: *FTPClient, data: []const u8) !void {
        // Append to control buffer
        try this.control_buffer.appendSlice(data);

        // Process complete lines
        while (std.mem.indexOf(u8, this.control_buffer.items, "\r\n")) |end| {
            const line = this.control_buffer.items[0..end];
            defer {
                // Remove processed line from buffer
                const to_remove = end + 2;
                std.mem.copyForwards(u8, this.control_buffer.items[0..], this.control_buffer.items[to_remove..]);
                this.control_buffer.items.len -= to_remove;
            }

            log("FTP << {s}", .{line});

            // Parse response code
            if (line.len >= 3) {
                const code = std.fmt.parseInt(u16, line[0..3], 10) catch continue;
                this.last_response_code = code;

                if (this.last_response.len > 0) {
                    this.allocator.free(this.last_response);
                }
                this.last_response = try this.allocator.dupe(u8, line);

                // Handle multi-line responses (code followed by -)
                if (line.len > 3 and line[3] == '-') {
                    continue; // Wait for completion line
                }

                try this.handleResponse(code, line);
            }
        }
    }

    fn handleResponse(this: *FTPClient, code: u16, response: []const u8) !void {
        switch (this.state) {
            .connecting => {
                if (code == 220) {
                    // Send USER command
                    const user = if (this.url.username.len > 0) this.url.username else "anonymous";
                    try this.sendCommand("USER {s}", .{user});
                    this.state = .user_sent;
                } else {
                    return error.InvalidWelcome;
                }
            },
            .user_sent => {
                if (code == 230) {
                    // No password needed
                    try this.sendBinaryMode();
                } else if (code == 331) {
                    // Password required
                    const pass = if (this.url.password.len > 0) this.url.password else "anonymous@";
                    try this.sendCommand("PASS {s}", .{pass});
                    this.state = .pass_sent;
                } else {
                    return error.AuthenticationFailed;
                }
            },
            .pass_sent => {
                if (code == 230) {
                    try this.sendBinaryMode();
                } else {
                    return error.AuthenticationFailed;
                }
            },
            .type_sent => {
                if (code == 200) {
                    // Check if we need to change directory
                    const path = this.url.pathname;
                    if (std.fs.path.dirname(path)) |dir| {
                        if (!strings.eqlComptime(dir, "/") and dir.len > 0) {
                            try this.sendCommand("CWD {s}", .{dir});
                            this.state = .cwd_sent;
                            return;
                        }
                    }

                    // Otherwise proceed with the command
                    try this.executeCommand();
                } else {
                    // Type command failed, continue anyway
                    try this.executeCommand();
                }
            },
            .cwd_sent => {
                if (code == 250 or code == 200) {
                    try this.executeCommand();
                } else if (code == 550) {
                    // Directory not found
                    this.completeWithError(error.DirectoryNotFound, 404);
                } else {
                    return error.DirectoryChangeFailed;
                }
            },
            .size_requested => {
                if (code == 213) {
                    // Parse file size
                    if (std.mem.indexOf(u8, response, " ")) |space| {
                        const size_str = std.mem.trim(u8, response[space + 1 ..], " \r\n");
                        this.file_size = std.fmt.parseInt(usize, size_str, 10) catch null;
                    }
                }
                // Continue with passive/active mode regardless
                try this.setupDataConnection();
            },
            .pasv_sent => {
                if (code == 227) {
                    try this.parsePasvResponse(response);
                    try this.connectDataPort();
                } else {
                    // Try EPSV if PASV failed
                    if (!this.use_epsv) {
                        this.use_epsv = true;
                        try this.sendCommand("EPSV", .{});
                        this.state = .epsv_sent;
                    } else {
                        return error.PassiveModeFailed;
                    }
                }
            },
            .epsv_sent => {
                if (code == 229) {
                    try this.parseEpsvResponse(response);
                    try this.connectDataPort();
                } else {
                    return error.PassiveModeFailed;
                }
            },
            .port_sent => {
                if (code == 200) {
                    // PORT command accepted, send transfer command
                    try this.sendTransferCommand();
                } else {
                    return error.ActiveModeFailed;
                }
            },
            .rest_sent => {
                if (code == 350) {
                    // REST accepted, send RETR
                    try this.sendCommand("RETR {s}", .{std.fs.path.basename(this.file_path)});
                    this.state = .retr_sent;
                } else {
                    // REST not supported, continue without resume
                    this.resume_offset = 0;
                    try this.sendCommand("RETR {s}", .{std.fs.path.basename(this.file_path)});
                    this.state = .retr_sent;
                }
            },
            .retr_sent, .list_sent, .stor_sent => {
                if (code == 150 or code == 125) {
                    // Transfer starting
                    this.state = if (this.command == .upload) .sending_data else .receiving_data;
                } else if (code == 226) {
                    // Transfer complete
                    this.completeTransfer();
                } else if (code == 550) {
                    // File not found
                    this.completeWithError(error.FileNotFound, 404);
                } else {
                    return error.TransferFailed;
                }
            },
            .receiving_data, .sending_data => {
                if (code == 226) {
                    // Transfer complete
                    this.completeTransfer();
                }
            },
            else => {},
        }
    }

    fn sendBinaryMode(this: *FTPClient) !void {
        const type_cmd = if (this.binary_mode) "TYPE I" else "TYPE A";
        try this.sendCommand("{s}", .{type_cmd});
        this.state = .type_sent;
    }

    fn executeCommand(this: *FTPClient) !void {
        this.file_path = this.url.pathname;

        // Determine command from URL or method
        if (this.async_http.method == .PUT) {
            this.command = .upload;
        } else if (strings.endsWithComptime(this.file_path, "/")) {
            this.command = .list;
        } else {
            this.command = .download;
        }

        // Request file size for downloads
        if (this.command == .download) {
            try this.sendCommand("SIZE {s}", .{std.fs.path.basename(this.file_path)});
            this.state = .size_requested;
        } else {
            try this.setupDataConnection();
        }
    }

    fn setupDataConnection(this: *FTPClient) !void {
        if (this.use_active) {
            try this.setupActiveMode();
        } else {
            try this.sendCommand("PASV", .{});
            this.state = .pasv_sent;
        }
    }

    fn setupActiveMode(_: *FTPClient) !void {
        // TODO: Implement active mode
        return error.ActiveModeNotImplemented;
    }

    fn sendTransferCommand(this: *FTPClient) !void {
        const basename = std.fs.path.basename(this.file_path);

        switch (this.command) {
            .download => {
                if (this.resume_offset > 0) {
                    try this.sendCommand("REST {}", .{this.resume_offset});
                    this.state = .rest_sent;
                } else {
                    try this.sendCommand("RETR {s}", .{basename});
                    this.state = .retr_sent;
                }
            },
            .upload => {
                try this.sendCommand("STOR {s}", .{basename});
                this.state = .stor_sent;
            },
            .list => {
                try this.sendCommand("LIST", .{});
                this.state = .list_sent;
            },
            .nlst => {
                try this.sendCommand("NLST", .{});
                this.state = .list_sent;
            },
            else => return error.UnsupportedCommand,
        }
    }

    fn parsePasvResponse(this: *FTPClient, response: []const u8) !void {
        // Parse PASV response: 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)
        const start = std.mem.indexOf(u8, response, "(") orelse return error.InvalidPasvResponse;
        const end = std.mem.indexOf(u8, response, ")") orelse return error.InvalidPasvResponse;

        if (start >= end) return error.InvalidPasvResponse;

        const addr_str = response[start + 1 .. end];
        var parts = std.mem.tokenizeScalar(u8, addr_str, ',');

        var ip_parts: [4]u8 = undefined;
        var i: usize = 0;

        // Parse IP parts
        while (i < 4) : (i += 1) {
            const part = parts.next() orelse return error.InvalidPasvResponse;
            ip_parts[i] = try std.fmt.parseInt(u8, std.mem.trim(u8, part, " "), 10);
        }

        // Parse port parts
        const p1_str = parts.next() orelse return error.InvalidPasvResponse;
        const p2_str = parts.next() orelse return error.InvalidPasvResponse;

        const p1 = try std.fmt.parseInt(u8, std.mem.trim(u8, p1_str, " "), 10);
        const p2 = try std.fmt.parseInt(u8, std.mem.trim(u8, p2_str, " "), 10);

        this.passive_port = (@as(u16, p1) << 8) | p2;

        // Format IP address
        if (this.passive_host.len > 0) {
            this.allocator.free(this.passive_host);
        }
        this.passive_host = try std.fmt.allocPrint(this.allocator, "{}.{}.{}.{}", .{
            ip_parts[0], ip_parts[1], ip_parts[2], ip_parts[3],
        });

        log("PASV: Will connect to {s}:{}", .{ this.passive_host, this.passive_port });
    }

    fn parseEpsvResponse(this: *FTPClient, response: []const u8) !void {
        // Parse EPSV response: 229 Entering Extended Passive Mode (|||port|)
        const start = std.mem.indexOf(u8, response, "(") orelse return error.InvalidEpsvResponse;
        const end = std.mem.indexOf(u8, response, ")") orelse return error.InvalidEpsvResponse;

        if (start >= end) return error.InvalidEpsvResponse;

        const port_str = response[start + 1 .. end];
        var parts = std.mem.tokenizeScalar(u8, port_str, '|');

        // Skip the first three parts
        _ = parts.next();
        _ = parts.next();
        _ = parts.next();

        const port_part = parts.next() orelse return error.InvalidEpsvResponse;
        this.passive_port = try std.fmt.parseInt(u16, port_part, 10);

        // Use the same host as control connection
        if (this.passive_host.len > 0) {
            this.allocator.free(this.passive_host);
        }
        this.passive_host = try this.allocator.dupe(u8, this.url.hostname);

        log("EPSV: Will connect to {s}:{}", .{ this.passive_host, this.passive_port });
    }

    fn connectDataPort(this: *FTPClient) !void {
        const ctx = HTTPClient.ftp_context orelse return error.NoFTPContext;

        // Allocate hostname buffer
        const host_buf = try this.allocator.dupeZ(u8, this.passive_host);
        defer this.allocator.free(host_buf);

        var has_dns_resolved: i32 = 0;
        const socket = ctx.data_context.connect(
            false,
            host_buf.ptr,
            @intCast(this.passive_port),
            0,
            @sizeOf(usize),
            &has_dns_resolved,
        );

        if (socket) |sock| {
            this.data_socket = @ptrCast(sock);
            // Store reference to FTPClient in socket ext
            if (this.data_socket.?.ext(usize)) |ext| {
                ext.* = @intFromPtr(this);
            }
        } else {
            return error.DataConnectionFailed;
        }
    }

    pub fn onDataReceived(this: *FTPClient, data: []const u8) !void {
        log("Received {} bytes of data", .{data.len});
        _ = this.response_buffer.append(data) catch {
            return error.OutOfMemory;
        };
    }

    pub fn onDataSocketOpened(this: *FTPClient) !void {
        log("Data connection established", .{});
        // Send the transfer command now that data connection is ready
        try this.sendTransferCommand();
    }

    pub fn onDataSocketClosed(this: *FTPClient) void {
        log("Data connection closed", .{});
        this.data_socket = null;

        if (this.state == .receiving_data or this.state == .sending_data) {
            // Data transfer may be complete, wait for 226 response
        }
    }

    fn completeTransfer(this: *FTPClient) void {
        this.state = .completed;

        // Map FTP status to HTTP status
        const http_status: u16 = switch (this.last_response_code) {
            226, 250 => 200, // Success
            550 => 404, // File not found
            530 => 401, // Not logged in
            else => 500, // Server error
        };

        // Create response metadata
        const metadata = HTTPClient.HTTPResponseMetadata{
            .url = this.url.href,
            .response = .{
                .status = if (http_status == 200) "200 OK" else "500 Internal Server Error",
                .status_code = http_status,
            },
        };

        // Add FTP-specific headers
        // TODO: Add headers support when picohttp is imported
        // var headers = std.ArrayList(picohttp.Header).init(this.allocator);
        // defer headers.deinit();

        // if (this.file_size) |size| {
        //     const size_str = std.fmt.allocPrint(this.allocator, "{}", .{size}) catch "";
        //     headers.append(.{
        //         .name = "Content-Length",
        //         .value = size_str,
        //     }) catch {};
        // }

        // headers.append(.{
        //     .name = "X-FTP-Response-Code",
        //     .value = std.fmt.allocPrint(this.allocator, "{}", .{this.last_response_code}) catch "",
        // }) catch {};

        const result = HTTPClientResult{
            .body = this.response_buffer,
            .metadata = metadata,
            .body_size = .{ .content_length = this.response_buffer.list.items.len },
        };

        this.async_http.result_callback.run(this.async_http, result);
    }

    fn completeWithError(this: *FTPClient, err: anyerror, status: u16) void {
        this.state = .failed;

        const metadata = HTTPClient.HTTPResponseMetadata{
            .url = this.url.href,
            .response = .{
                .status = switch (status) {
                    404 => "404 Not Found",
                    401 => "401 Unauthorized",
                    else => "500 Internal Server Error",
                },
                .status_code = status,
            },
        };

        const result = HTTPClientResult{
            .fail = err,
            .metadata = metadata,
        };

        this.async_http.result_callback.run(this.async_http, result);
    }
};

const FTPControlHandler = struct {
    fn getClient(ptr: *anyopaque) *FTPClient {
        const int_ptr = @as(*usize, @ptrCast(@alignCast(ptr)));
        return @ptrFromInt(int_ptr.*);
    }

    pub fn onOpen(ptr: *anyopaque, socket: FTPSocket) void {
        const this = getClient(ptr);
        log("Control connection opened", .{});
        this.control_socket = socket;
        this.state = .connected;
    }

    pub fn onData(ptr: *anyopaque, socket: FTPSocket, data: []const u8) void {
        const this = getClient(ptr);
        _ = socket;
        this.processResponse(data) catch |err| {
            log("Error processing response: {}", .{err});
            this.completeWithError(err, 500);
        };
    }

    pub fn onClose(ptr: *anyopaque, socket: FTPSocket, err_code: c_int, reason: ?*anyopaque) void {
        const this = getClient(ptr);
        _ = socket;
        _ = err_code;
        _ = reason;
        log("Control connection closed", .{});
        this.control_socket = null;

        if (this.state != .completed and this.state != .failed) {
            this.completeWithError(error.ConnectionClosed, 500);
        }
    }

    pub fn onWritable(ptr: *anyopaque, socket: FTPSocket) void {
        const this = getClient(ptr);
        _ = this;
        _ = socket;
    }

    pub fn onTimeout(ptr: *anyopaque, socket: FTPSocket) void {
        const this = getClient(ptr);
        _ = socket;
        log("Control connection timeout", .{});
        this.completeWithError(error.Timeout, 500);
    }

    pub fn onConnectError(ptr: *anyopaque, socket: FTPSocket, err_code: c_int) void {
        const this = getClient(ptr);
        _ = socket;
        log("Control connection error: {}", .{err_code});
        this.completeWithError(error.ConnectionFailed, 500);
    }
};

const FTPDataHandler = struct {
    fn getClient(ptr: *anyopaque) *FTPClient {
        const int_ptr = @as(*usize, @ptrCast(@alignCast(ptr)));
        return @ptrFromInt(int_ptr.*);
    }

    pub fn onOpen(ptr: *anyopaque, socket: FTPDataSocket) void {
        const this = getClient(ptr);
        _ = socket;
        this.onDataSocketOpened() catch |err| {
            log("Error on data socket open: {}", .{err});
            this.completeWithError(err, 500);
        };
    }

    pub fn onData(ptr: *anyopaque, socket: FTPDataSocket, data: []const u8) void {
        const this = getClient(ptr);
        _ = socket;
        this.onDataReceived(data) catch |err| {
            log("Error receiving data: {}", .{err});
            this.completeWithError(err, 500);
        };
    }

    pub fn onClose(ptr: *anyopaque, socket: FTPDataSocket, err_code: c_int, reason: ?*anyopaque) void {
        const this = getClient(ptr);
        _ = socket;
        _ = err_code;
        _ = reason;
        this.onDataSocketClosed();
    }

    pub fn onWritable(ptr: *anyopaque, socket: FTPDataSocket) void {
        const this = getClient(ptr);
        _ = socket;
        if (this.state == .sending_data and this.upload_data.len > 0) {
            // Send upload data
            if (this.data_socket) |sock| {
                _ = sock.write(this.upload_data, true);
                this.upload_data = "";
            }
        }
    }

    pub fn onTimeout(ptr: *anyopaque, socket: FTPDataSocket) void {
        const this = getClient(ptr);
        _ = socket;
        log("Data connection timeout", .{});
        this.completeWithError(error.DataTimeout, 500);
    }

    pub fn onConnectError(ptr: *anyopaque, socket: FTPDataSocket, err_code: c_int) void {
        const this = getClient(ptr);
        _ = socket;
        log("Data connection error: {}", .{err_code});
        this.completeWithError(error.DataConnectionFailed, 500);
    }
};

pub fn handleFTPRequest(async_http: *AsyncHTTP) !void {
    const allocator = async_http.allocator;

    // Initialize response buffer if needed
    if (async_http.response_buffer.list.capacity == 0) {
        async_http.response_buffer.allocator = allocator;
    }

    // Get or create FTP context
    if (HTTPClient.ftp_context == null) {
        HTTPClient.ftp_context = try FTPContext.init(HTTPClient.http_thread.loop.loop);
    }
    const ctx = HTTPClient.ftp_context.?;

    // Create FTP client
    const client = FTPClient.init(allocator, async_http);

    // Connect to FTP server
    try client.connect(ctx);

    // The rest is handled asynchronously via callbacks
}