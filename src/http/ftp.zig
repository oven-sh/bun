const std = @import("std");
const bun = @import("../bun.zig");
const strings = bun.strings;
const MutableString = bun.MutableString;
const AsyncHTTP = @import("./AsyncHTTP.zig");
const HTTPClient = @import("../http.zig");
const HTTPClientResult = HTTPClient.HTTPClientResult;
const URL = @import("../url.zig").URL;
const picohttp = @import("../deps/picohttp.zig");
const Output = bun.Output;
const Environment = bun.Environment;
const Allocator = std.mem.Allocator;
const uws = bun.uws;
const HTTPThread = @import("./HTTPThread.zig");

const log = Output.scoped(.ftp, .visible);

pub const FTPClient = struct {
    control_socket: ?*uws.Socket = null,
    data_socket: ?*uws.Socket = null,
    context: *FTPContext = undefined,
    async_http: *AsyncHTTP,
    state: State = .initial,
    response_buffer: std.ArrayList(u8),
    allocator: Allocator,
    url: URL,
    passive_host: []const u8 = "",
    passive_port: u16 = 0,
    file_size: ?usize = null,
    transfer_complete: bool = false,

    const State = enum {
        initial,
        connecting,
        connected,
        user_sent,
        pass_sent,
        type_sent,
        size_requested,
        pasv_sent,
        retr_sent,
        receiving_data,
        completed,
        failed,
    };

    pub fn init(allocator: Allocator, async_http: *AsyncHTTP, url: URL) FTPClient {
        return .{
            .async_http = async_http,
            .response_buffer = std.ArrayList(u8).init(allocator),
            .allocator = allocator,
            .url = url,
        };
    }

    pub fn deinit(this: *FTPClient) void {
        this.response_buffer.deinit();
        if (this.control_socket) |socket| {
            socket.close(0, null);
        }
        if (this.data_socket) |socket| {
            socket.close(0, null);
        }
    }

    pub fn connect(this: *FTPClient, context: *FTPContext) !void {
        this.context = context;

        const hostname = this.url.hostname;
        const port = this.url.getPortAuto() orelse 21;

        log("Connecting to FTP server {}:{}", .{ hostname, port });

        // Create control connection socket
        this.control_socket = context.connect(hostname, port, this) catch |err| {
            log("Failed to connect to FTP server: {}", .{err});
            return err;
        };

        this.state = .connecting;
    }

    pub fn onControlConnect(this: *FTPClient, socket: *uws.Socket) void {
        log("Control connection established", .{});
        this.control_socket = socket;
        this.state = .connected;
    }

    pub fn onControlData(this: *FTPClient, data: []const u8) !void {
        log("Received control data: {s}", .{data});

        // Parse FTP response code
        if (data.len < 3) return;

        const code = std.fmt.parseInt(u16, data[0..3], 10) catch return;

        switch (this.state) {
            .connected => {
                if (code == 220) {
                    // Send USER command
                    const user = this.url.username orelse "anonymous";
                    const user_cmd = try std.fmt.allocPrint(this.allocator, "USER {s}\r\n", .{user});
                    defer this.allocator.free(user_cmd);

                    try this.sendCommand(user_cmd);
                    this.state = .user_sent;
                }
            },
            .user_sent => {
                if (code == 331 or code == 230) {
                    // Send PASS command if needed
                    if (code == 331) {
                        const pass = this.url.password orelse "anonymous@";
                        const pass_cmd = try std.fmt.allocPrint(this.allocator, "PASS {s}\r\n", .{pass});
                        defer this.allocator.free(pass_cmd);

                        try this.sendCommand(pass_cmd);
                        this.state = .pass_sent;
                    } else {
                        // No password needed, proceed to TYPE
                        try this.sendTypeCommand();
                    }
                }
            },
            .pass_sent => {
                if (code == 230) {
                    // Login successful, set binary mode
                    try this.sendTypeCommand();
                }
            },
            .type_sent => {
                if (code == 200) {
                    // Binary mode set, request file size
                    const path = this.url.pathname;
                    const size_cmd = try std.fmt.allocPrint(this.allocator, "SIZE {s}\r\n", .{path});
                    defer this.allocator.free(size_cmd);

                    try this.sendCommand(size_cmd);
                    this.state = .size_requested;
                }
            },
            .size_requested => {
                if (code == 213) {
                    // Parse file size
                    if (std.mem.indexOf(u8, data, " ")) |space_idx| {
                        const size_str = std.mem.trim(u8, data[space_idx + 1 ..], " \r\n");
                        this.file_size = std.fmt.parseInt(usize, size_str, 10) catch null;
                    }
                }
                // Request passive mode regardless of SIZE success
                try this.sendCommand("PASV\r\n");
                this.state = .pasv_sent;
            },
            .pasv_sent => {
                if (code == 227) {
                    // Parse PASV response: 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)
                    if (std.mem.indexOf(u8, data, "(")) |start| {
                        if (std.mem.indexOf(u8, data, ")")) |end| {
                            const addr_str = data[start + 1 .. end];
                            try this.parsePasvResponse(addr_str);

                            // Connect to data port
                            try this.connectDataPort();
                        }
                    }
                }
            },
            .retr_sent => {
                if (code == 150 or code == 125) {
                    // File transfer starting
                    this.state = .receiving_data;
                } else if (code == 226) {
                    // Transfer complete
                    this.transfer_complete = true;
                    try this.handleTransferComplete();
                }
            },
            .receiving_data => {
                if (code == 226) {
                    // Transfer complete
                    this.transfer_complete = true;
                    try this.handleTransferComplete();
                }
            },
            else => {},
        }
    }

    fn sendTypeCommand(this: *FTPClient) !void {
        try this.sendCommand("TYPE I\r\n");
        this.state = .type_sent;
    }

    fn parsePasvResponse(this: *FTPClient, addr_str: []const u8) !void {
        var parts = std.mem.tokenize(u8, addr_str, ",");
        var ip_parts: [4]u8 = undefined;
        var i: usize = 0;

        // Parse IP address parts
        while (i < 4) : (i += 1) {
            if (parts.next()) |part| {
                ip_parts[i] = try std.fmt.parseInt(u8, std.mem.trim(u8, part, " "), 10);
            } else {
                return error.InvalidPasvResponse;
            }
        }

        // Parse port parts
        const p1 = if (parts.next()) |part| try std.fmt.parseInt(u8, std.mem.trim(u8, part, " "), 10) else return error.InvalidPasvResponse;
        const p2 = if (parts.next()) |part| try std.fmt.parseInt(u8, std.mem.trim(u8, part, " "), 10) else return error.InvalidPasvResponse;

        const port = (@as(u16, p1) << 8) | p2;

        // Format IP address
        const ip_str = try std.fmt.allocPrint(this.allocator, "{}.{}.{}.{}", .{ ip_parts[0], ip_parts[1], ip_parts[2], ip_parts[3] });
        this.passive_host = ip_str;
        this.passive_port = port;

        log("PASV: Connecting to {}:{}", .{ this.passive_host, this.passive_port });
    }

    fn connectDataPort(this: *FTPClient) !void {
        this.data_socket = this.context.connectData(this.passive_host, this.passive_port, this) catch |err| {
            log("Failed to connect to data port: {}", .{err});
            return err;
        };
    }

    pub fn onDataConnect(this: *FTPClient, socket: *uws.Socket) !void {
        log("Data connection established", .{});
        this.data_socket = socket;

        // Send RETR command
        const path = this.url.pathname;
        const retr_cmd = try std.fmt.allocPrint(this.allocator, "RETR {s}\r\n", .{path});
        defer this.allocator.free(retr_cmd);

        try this.sendCommand(retr_cmd);
        this.state = .retr_sent;
    }

    pub fn onDataReceived(this: *FTPClient, data: []const u8) !void {
        log("Received {} bytes of data", .{data.len});
        try this.response_buffer.appendSlice(data);

        // Update AsyncHTTP response buffer
        _ = this.async_http.response_buffer.append(data) catch {
            return error.OutOfMemory;
        };
    }

    pub fn onDataClose(this: *FTPClient) void {
        log("Data connection closed", .{});
        this.data_socket = null;

        if (this.state == .receiving_data) {
            this.handleTransferComplete() catch |err| {
                log("Error handling transfer complete: {}", .{err});
                this.state = .failed;
            };
        }
    }

    fn handleTransferComplete(this: *FTPClient) !void {
        log("Transfer complete, received {} bytes", .{this.response_buffer.items.len});
        this.state = .completed;

        // Copy data to AsyncHTTP response buffer
        _ = this.async_http.response_buffer.append(this.response_buffer.items) catch {
            return error.OutOfMemory;
        };

        // Create a proper HTTP response metadata
        const metadata = HTTPClient.HTTPResponseMetadata{
            .url = this.url.href,
            .response = .{
                .status = "200",
                .status_code = 200,
            },
        };

        // Send completion callback to AsyncHTTP
        const result = HTTPClientResult{
            .body = this.async_http.response_buffer,
            .metadata = metadata,
            .body_size = .{ .content_length = this.response_buffer.items.len },
        };

        this.async_http.result_callback.run(this.async_http, result);
    }

    fn sendCommand(this: *FTPClient, command: []const u8) !void {
        if (this.control_socket) |socket| {
            log("Sending command: {s}", .{std.mem.trimRight(u8, command, "\r\n")});
            _ = socket.write(command, false);
        } else {
            return error.NotConnected;
        }
    }

    pub fn onError(this: *FTPClient, err: anyerror) void {
        log("FTP error: {}", .{err});
        this.state = .failed;

        const result = HTTPClient.HTTPClientResult{
            .err = err,
        };

        this.async_http.result_callback.run(this.async_http, result);
    }
};

pub const FTPContext = struct {
    loop: *uws.Loop,
    control_context: *uws.SocketContext,
    data_context: *uws.SocketContext,
    allocator: Allocator,

    pub fn init(allocator: Allocator, loop: *uws.Loop) !*FTPContext {
        const context = try allocator.create(FTPContext);
        context.* = .{
            .loop = loop,
            .control_context = try createSocketContext(loop, false),
            .data_context = try createSocketContext(loop, false),
            .allocator = allocator,
        };
        return context;
    }

    pub fn deinit(this: *FTPContext) void {
        this.control_context.deinit();
        this.data_context.deinit();
        this.allocator.destroy(this);
    }

    fn createSocketContext(loop: *uws.Loop, is_ssl: bool) !*uws.SocketContext {
        const options = uws.us_socket_context_options_t{};
        return uws.us_create_socket_context(@intFromBool(is_ssl), loop, @sizeOf(usize), options) orelse error.FailedToCreateContext;
    }

    pub fn connect(this: *FTPContext, hostname: []const u8, port: u16, client: *FTPClient) !*uws.Socket {
        return this.control_context.connect(hostname, port, client, 0) orelse error.ConnectionFailed;
    }

    pub fn connectData(this: *FTPContext, hostname: []const u8, port: u16, client: *FTPClient) !*uws.Socket {
        return this.data_context.connect(hostname, port, client, 0) orelse error.ConnectionFailed;
    }
};

pub fn handleFTPRequest(async_http: *AsyncHTTP) !void {
    const allocator = async_http.allocator;
    const url = async_http.url;

    // Create FTP client - allocate on heap since it needs to outlive this function
    const ftp_client = try allocator.create(FTPClient);
    ftp_client.* = FTPClient.init(allocator, async_http, url);

    // Get or create FTP context  - also heap allocated
    const loop = HTTPClient.http_thread.loop;
    const context = try FTPContext.init(allocator, loop);

    // Connect and perform FTP transfer
    ftp_client.connect(context) catch |err| {
        ftp_client.deinit();
        allocator.destroy(ftp_client);
        context.deinit();
        return err;
    };

    // The rest will be handled asynchronously via callbacks
    // The client will clean itself up when done
}