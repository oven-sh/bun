const std = @import("std");
const bun = @import("../bun.zig");
const AsyncHTTP = @import("./AsyncHTTP.zig");
const HTTPClient = @import("../http.zig");
const HTTPClientResult = HTTPClient.HTTPClientResult;
const URL = @import("../url.zig").URL;
const Output = bun.Output;
const net = std.net;

const log = Output.scoped(.ftp, .visible);

const FTPState = enum {
    initial,
    connecting,
    connected,
    authenticating,
    authenticated,
    requesting_pasv,
    pasv_received,
    requesting_file,
    receiving_data,
    completed,
    failed,
};

pub const FTPClient = struct {
    allocator: std.mem.Allocator,
    async_http: *AsyncHTTP,
    url: URL,
    state: FTPState = .initial,
    control_stream: ?net.Stream = null,
    data_stream: ?net.Stream = null,
    response_buffer: std.ArrayList(u8),
    passive_addr: ?net.Address = null,
    file_size: ?usize = null,

    pub fn init(allocator: std.mem.Allocator, async_http: *AsyncHTTP) FTPClient {
        return .{
            .allocator = allocator,
            .async_http = async_http,
            .url = async_http.url,
            .response_buffer = std.ArrayList(u8).init(allocator),
        };
    }

    pub fn deinit(self: *FTPClient) void {
        if (self.control_stream) |stream| {
            stream.close();
        }
        if (self.data_stream) |stream| {
            stream.close();
        }
        self.response_buffer.deinit();
    }

    pub fn execute(self: *FTPClient) !void {
        const hostname = self.url.hostname;
        const port = self.url.getPort() orelse 21;

        log("Connecting to FTP server {s}:{}", .{ hostname, port });

        // Connect to FTP server
        const address = net.Address.parseIp(hostname, port) catch blk: {
            // If parseIp fails, try resolving hostname
            const addr_list = try net.getAddressList(self.allocator, hostname, port);
            defer addr_list.deinit();
            if (addr_list.addrs.len == 0) return error.HostNotFound;
            break :blk addr_list.addrs[0];
        };

        self.control_stream = try net.tcpConnectToAddress(address);
        self.state = .connected;

        // Read welcome message
        var welcome_buf: [1024]u8 = undefined;
        const welcome_len = try self.control_stream.?.read(&welcome_buf);
        const welcome = welcome_buf[0..welcome_len];
        log("Server welcome: {s}", .{std.mem.trim(u8, welcome, "\r\n")});

        // Check for 220 response code
        if (!std.mem.startsWith(u8, welcome, "220")) {
            return error.InvalidServerResponse;
        }

        // Send USER command
        const user = if (self.url.username.len > 0) self.url.username else "anonymous";
        try self.sendCommand("USER {s}\r\n", .{user});
        const user_response = try self.readResponse();

        // Check for 331 (password required) or 230 (no password needed)
        if (std.mem.startsWith(u8, user_response, "331")) {
            // Send PASS command
            const pass = if (self.url.password.len > 0) self.url.password else "anonymous@";
            try self.sendCommand("PASS {s}\r\n", .{pass});
            const pass_response = try self.readResponse();

            if (!std.mem.startsWith(u8, pass_response, "230")) {
                return error.AuthenticationFailed;
            }
        } else if (!std.mem.startsWith(u8, user_response, "230")) {
            return error.AuthenticationFailed;
        }

        self.state = .authenticated;

        // Set binary mode
        try self.sendCommand("TYPE I\r\n", .{});
        const type_response = try self.readResponse();
        if (!std.mem.startsWith(u8, type_response, "200")) {
            log("Warning: Failed to set binary mode", .{});
        }

        // Request file size (optional)
        const path = self.url.pathname;
        try self.sendCommand("SIZE {s}\r\n", .{path});
        const size_response = try self.readResponse();
        if (std.mem.startsWith(u8, size_response, "213")) {
            // Parse file size
            if (std.mem.indexOf(u8, size_response, " ")) |space_idx| {
                const size_str = std.mem.trim(u8, size_response[space_idx + 1 ..], " \r\n");
                self.file_size = std.fmt.parseInt(usize, size_str, 10) catch null;
                log("File size: {} bytes", .{self.file_size.?});
            }
        }

        // Enter passive mode
        try self.sendCommand("PASV\r\n", .{});
        const pasv_response = try self.readResponse();

        if (!std.mem.startsWith(u8, pasv_response, "227")) {
            return error.PassiveModeFailed;
        }

        // Parse PASV response: 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)
        self.passive_addr = try self.parsePasvResponse(pasv_response);
        self.state = .pasv_received;

        // Connect to data port
        log("Connecting to data port: {}", .{self.passive_addr.?});
        self.data_stream = try net.tcpConnectToAddress(self.passive_addr.?);

        // Request file
        try self.sendCommand("RETR {s}\r\n", .{path});
        const retr_response = try self.readResponse();

        if (!std.mem.startsWith(u8, retr_response, "150") and
            !std.mem.startsWith(u8, retr_response, "125")) {
            return error.FileRetrievalFailed;
        }

        self.state = .receiving_data;

        // Read data from data connection
        var data_buf: [8192]u8 = undefined;
        while (true) {
            const bytes_read = self.data_stream.?.read(&data_buf) catch |err| {
                if (err == error.EndOfStream) break;
                return err;
            };
            if (bytes_read == 0) break;

            try self.response_buffer.appendSlice(data_buf[0..bytes_read]);
        }

        // Close data connection
        self.data_stream.?.close();
        self.data_stream = null;

        // Read transfer complete message
        const complete_response = try self.readResponse();
        if (!std.mem.startsWith(u8, complete_response, "226")) {
            log("Warning: Unexpected completion response: {s}", .{complete_response});
        }

        self.state = .completed;
        log("Transfer complete, received {} bytes", .{self.response_buffer.items.len});

        // Send QUIT command
        try self.sendCommand("QUIT\r\n", .{});
        _ = self.readResponse() catch {}; // Ignore QUIT response

        // Close control connection
        self.control_stream.?.close();
        self.control_stream = null;
    }

    fn sendCommand(self: *FTPClient, comptime fmt: []const u8, args: anytype) !void {
        const command = try std.fmt.allocPrint(self.allocator, fmt, args);
        defer self.allocator.free(command);

        log("Sending: {s}", .{std.mem.trimRight(u8, command, "\r\n")});
        _ = try self.control_stream.?.write(command);
    }

    fn readResponse(self: *FTPClient) ![]const u8 {
        var response_buf: [1024]u8 = undefined;
        const len = try self.control_stream.?.read(&response_buf);
        const response = response_buf[0..len];
        log("Received: {s}", .{std.mem.trimRight(u8, response, "\r\n")});
        return response;
    }

    fn parsePasvResponse(_: *FTPClient, response: []const u8) !net.Address {
        // Find the parentheses
        const start = std.mem.indexOf(u8, response, "(") orelse return error.InvalidPasvResponse;
        const end = std.mem.indexOf(u8, response, ")") orelse return error.InvalidPasvResponse;

        if (start >= end) return error.InvalidPasvResponse;

        const addr_str = response[start + 1 .. end];
        var parts = std.mem.tokenizeScalar(u8, addr_str, ',');

        var ip_parts: [4]u8 = undefined;
        var i: usize = 0;

        // Parse IP address parts
        while (i < 4) : (i += 1) {
            const part = parts.next() orelse return error.InvalidPasvResponse;
            ip_parts[i] = try std.fmt.parseInt(u8, std.mem.trim(u8, part, " "), 10);
        }

        // Parse port parts
        const p1_str = parts.next() orelse return error.InvalidPasvResponse;
        const p2_str = parts.next() orelse return error.InvalidPasvResponse;

        const p1 = try std.fmt.parseInt(u8, std.mem.trim(u8, p1_str, " "), 10);
        const p2 = try std.fmt.parseInt(u8, std.mem.trim(u8, p2_str, " "), 10);

        const port = (@as(u16, p1) << 8) | p2;

        // Create IP address string
        var ip_buf: [16]u8 = undefined;
        const ip_str = try std.fmt.bufPrint(&ip_buf, "{}.{}.{}.{}", .{
            ip_parts[0], ip_parts[1], ip_parts[2], ip_parts[3],
        });

        return try net.Address.parseIp(ip_str, port);
    }

    pub fn getResponseData(self: *FTPClient) []const u8 {
        return self.response_buffer.items;
    }
};

pub fn handleFTPRequest(async_http: *AsyncHTTP) !void {
    const allocator = async_http.allocator;

    // Initialize response buffer if needed
    if (async_http.response_buffer.list.capacity == 0) {
        async_http.response_buffer.allocator = allocator;
    }

    // Create and execute FTP client
    var ftp_client = FTPClient.init(allocator, async_http);
    defer ftp_client.deinit();

    ftp_client.execute() catch |err| {
        log("FTP error: {}", .{err});

        // Return error result
        const result = HTTPClientResult{
            .fail = err,
        };
        async_http.result_callback.run(async_http, result);
        return;
    };

    // Copy response data to AsyncHTTP buffer
    const response_data = ftp_client.getResponseData();
    _ = try async_http.response_buffer.append(response_data);

    // Create metadata
    const metadata = HTTPClient.HTTPResponseMetadata{
        .url = async_http.url.href,
        .response = .{
            .status = "200",
            .status_code = 200,
        },
    };

    // Create success result
    const result = HTTPClientResult{
        .body = async_http.response_buffer,
        .metadata = metadata,
        .body_size = .{ .content_length = response_data.len },
    };

    // Send callback
    async_http.result_callback.run(async_http, result);
}