const picohttp = @import("picohttp");
usingnamespace @import("./global.zig");
const std = @import("std");
const Headers = @import("./javascript/jsc/webcore/response.zig").Headers;
const URL = @import("./query_string_map.zig").URL;
const Method = @import("./http.zig").Method;
const iguanaTLS = @import("iguanaTLS");
const Api = @import("./api/schema.zig").Api;

const HTTPClient = @This();
const SOCKET_FLAGS = os.SOCK_CLOEXEC;

fn writeRequest(
    comptime Writer: type,
    writer: Writer,
    request: picohttp.Request,
    body: string,
    // header_hashes: []u64,
) !void {
    try writer.writeAll(request.method);
    try writer.writeAll(" ");
    try writer.writeAll(request.path);
    try writer.writeAll(" HTTP/1.1\r\n");

    for (request.headers) |header, i| {
        try writer.writeAll(header.name);
        try writer.writeAll(": ");
        try writer.writeAll(header.value);
        try writer.writeAll("\r\n");
    }
}

method: Method,
header_entries: Headers.Entries,
header_buf: string,
url: URL,
allocator: *std.mem.Allocator,
verbose: bool = false,

pub fn init(allocator: *std.mem.Allocator, method: Method, url: URL, header_entries: Headers.Entries, header_buf: string) HTTPClient {
    return HTTPClient{
        .allocator = allocator,
        .method = method,
        .url = url,
        .header_entries = header_entries,
        .header_buf = header_buf,
    };
}

threadlocal var response_headers_buf: [256]picohttp.Header = undefined;
threadlocal var request_headers_buf: [256]picohttp.Header = undefined;
threadlocal var header_name_hashes: [256]u64 = undefined;
// threadlocal var resolver_cache
const tcp = std.x.net.tcp;
const ip = std.x.net.ip;

const IPv4 = std.x.os.IPv4;
const IPv6 = std.x.os.IPv6;
const Socket = std.x.os.Socket;
const os = std.os;

// lowercase hash header names so that we can be sure
fn hashHeaderName(name: string) u64 {
    var hasher = std.hash.Wyhash.init(0);
    var remain: string = name;
    var buf: [32]u8 = undefined;
    var buf_slice: []u8 = std.mem.span(&buf);

    while (remain.len > 0) {
        var end = std.math.min(hasher.buf.len, remain.len);

        hasher.update(strings.copyLowercase(std.mem.span(remain[0..end]), buf_slice));
        remain = remain[end..];
    }
    return hasher.final();
}

const host_header_hash = hashHeaderName("Host");
const connection_header_hash = hashHeaderName("Connection");

const content_encoding_hash = hashHeaderName("Content-Encoding");
const host_header_name = "Host";
const content_length_header_name = "Content-Length";
const content_length_header_hash = hashHeaderName("Content-Length");
const connection_header = picohttp.Header{ .name = "Connection", .value = "close" };
const accept_header = picohttp.Header{ .name = "Accept", .value = "*/*" };
const accept_header_hash = hashHeaderName("Accept");
const user_agent_header = picohttp.Header{ .name = "User-Agent", .value = "Bun.js " ++ Global.package_json_version };
const user_agent_header_hash = hashHeaderName("User-Agent");

pub fn headerStr(this: *const HTTPClient, ptr: Api.StringPointer) string {
    return this.header_buf[ptr.offset..][0..ptr.length];
}

pub fn buildRequest(this: *const HTTPClient, body_len: usize) picohttp.Request {
    var header_count: usize = 0;
    var header_entries = this.header_entries.slice();
    var header_names = header_entries.items(.name);
    var header_values = header_entries.items(.value);

    var override_user_agent = false;
    for (header_names) |head, i| {
        const name = this.headerStr(head);
        // Hash it as lowercase
        const hash = hashHeaderName(request_headers_buf[header_count].name);

        // Skip host and connection header
        // we manage those
        switch (hash) {
            host_header_hash,
            connection_header_hash,
            content_length_header_hash,
            accept_header_hash,
            => continue,
            else => {},
        }

        override_user_agent = override_user_agent or hash == user_agent_header_hash;

        request_headers_buf[header_count] = picohttp.Header{
            .name = name,
            .value = this.headerStr(header_values[i]),
        };

        // header_name_hashes[header_count] = hash;

        // // ensure duplicate headers come after each other
        // if (header_count > 2) {
        //     var head_i: usize = header_count - 1;
        //     while (head_i > 0) : (head_i -= 1) {
        //         if (header_name_hashes[head_i] == header_name_hashes[header_count]) {
        //             std.mem.swap(picohttp.Header, &header_name_hashes[header_count], &header_name_hashes[head_i + 1]);
        //             std.mem.swap(u64, &request_headers_buf[header_count], &request_headers_buf[head_i + 1]);
        //             break;
        //         }
        //     }
        // }
        header_count += 1;
    }

    // request_headers_buf[header_count] = connection_header;
    // header_count += 1;

    if (!override_user_agent) {
        request_headers_buf[header_count] = user_agent_header;
        header_count += 1;
    }

    request_headers_buf[header_count] = accept_header;
    header_count += 1;

    request_headers_buf[header_count] = picohttp.Header{
        .name = host_header_name,
        .value = this.url.hostname,
    };
    header_count += 1;

    if (body_len > 0) {
        request_headers_buf[header_count] = picohttp.Header{
            .name = host_header_name,
            .value = this.url.hostname,
        };
        header_count += 1;
    }

    return picohttp.Request{
        .method = @tagName(this.method),
        .path = this.url.pathname,
        .minor_version = 1,
        .headers = request_headers_buf[0..header_count],
    };
}

pub fn connect(
    this: *HTTPClient,
) !tcp.Client {
    var client: tcp.Client = try tcp.Client.init(tcp.Domain.ip, .{ .close_on_exec = true });
    const port = this.url.getPortAuto();

    // if (this.url.isLocalhost()) {
    //     try client.connect(
    //         try std.x.os.Socket.Address.initIPv4(try std.net.Address.resolveIp("localhost", port), port),
    //     );
    // } else {
    // } else if (this.url.isDomainName()) {
    var stream = try std.net.tcpConnectToHost(default_allocator, this.url.hostname, port);
    client.socket = std.x.os.Socket.from(stream.handle);
    // }
    // } else if (this.url.getIPv4Address()) |ip_addr| {
    //     try client.connect(std.x.os.Socket.Address(ip_addr, port));
    // } else if (this.url.getIPv6Address()) |ip_addr| {
    //     try client.connect(std.x.os.Socket.Address.initIPv6(ip_addr, port));
    // } else {
    //     return error.MissingHostname;
    // }

    return client;
}

threadlocal var http_req_buf: [65436]u8 = undefined;

pub inline fn send(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) !picohttp.Response {
    if (this.url.isHTTPS()) {
        return this.sendHTTPS(body, body_out_str);
    } else {
        return this.sendHTTP(body, body_out_str);
    }
}

pub fn sendHTTP(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) !picohttp.Response {
    var client = try this.connect();
    defer {
        std.os.closeSocket(client.socket.fd);
    }
    var request = buildRequest(this, body.len);
    if (this.verbose) {
        Output.prettyErrorln("{s}", .{request});
    }
    var client_writer = client.writer(SOCKET_FLAGS);
    {
        var client_writer_buffered = std.io.bufferedWriter(client_writer);
        var client_writer_buffered_writer = client_writer_buffered.writer();

        try writeRequest(@TypeOf(&client_writer_buffered_writer), &client_writer_buffered_writer, request, body);
        try client_writer_buffered_writer.writeAll("\r\n");
        try client_writer_buffered.flush();
    }

    if (body.len > 0) {
        try client_writer.writeAll(body);
    }

    var client_reader = client.reader(SOCKET_FLAGS);
    var req_buf_len = try client_reader.readAll(&http_req_buf);
    var request_buffer = http_req_buf[0..req_buf_len];
    var response: picohttp.Response = undefined;

    {
        var response_length: usize = 0;
        restart: while (true) {
            response = picohttp.Response.parseParts(request_buffer, &response_headers_buf, &response_length) catch |err| {
                switch (err) {
                    error.ShortRead => {
                        continue :restart;
                    },
                    else => {
                        return err;
                    },
                }
            };
            break :restart;
        }
    }

    body_out_str.reset();
    var content_length: u32 = 0;
    for (response.headers) |header| {
        switch (hashHeaderName(header.name)) {
            content_length_header_hash => {
                content_length = std.fmt.parseInt(u32, header.value, 10) catch 0;
                // Always write a sentinel
                try body_out_str.inflate(content_length + 1);
                body_out_str.list.expandToCapacity();
                body_out_str.list.items[content_length] = 0;
            },
            content_encoding_hash => {
                return error.UnsupportedEncoding;
            },
            else => {},
        }
    }

    if (content_length > 0) {
        var remaining_content_length = content_length;
        var remainder = http_req_buf[@intCast(u32, response.bytes_read)..];
        remainder = remainder[0..std.math.min(remainder.len, content_length)];

        var body_size: usize = 0;
        if (remainder.len > 0) {
            std.mem.copy(u8, body_out_str.list.items, remainder);
            body_size = @intCast(u32, remainder.len);
            remaining_content_length -= @intCast(u32, remainder.len);
        }

        while (remaining_content_length > 0) {
            const size = @intCast(u32, try client.read(body_out_str.list.items[body_size..], SOCKET_FLAGS));
            if (size == 0) break;

            body_size += size;
            remaining_content_length -= size;
        }

        body_out_str.list.items.len = body_size;
    }

    return response;
}

pub fn sendHTTPS(this: *HTTPClient, body_str: []const u8, body_out_str: *MutableString) !picohttp.Response {
    var connection = try this.connect();

    var arena = std.heap.ArenaAllocator.init(this.allocator);
    defer arena.deinit();

    var rand = blk: {
        var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
        try std.os.getrandom(&seed);
        break :blk &std.rand.DefaultCsprng.init(seed).random;
    };

    var client = try iguanaTLS.client_connect(
        .{
            .rand = rand,
            .temp_allocator = &arena.allocator,
            .reader = connection.reader(SOCKET_FLAGS),
            .writer = connection.writer(SOCKET_FLAGS),
            .cert_verifier = .none,
            .protocols = &[_][]const u8{"http/1.1"},
        },
        this.url.hostname,
    );

    defer {
        client.close_notify() catch {};
    }

    var request = buildRequest(this, body_str.len);
    if (this.verbose) {
        Output.prettyErrorln("{s}", .{request});
    }
    const body = body_str;

    var client_writer = client.writer();
    {
        var client_writer_buffered = std.io.bufferedWriter(client_writer);
        var client_writer_buffered_writer = client_writer_buffered.writer();

        try writeRequest(@TypeOf(&client_writer_buffered_writer), &client_writer_buffered_writer, request, body);
        try client_writer_buffered_writer.writeAll("\r\n");
        try client_writer_buffered.flush();
    }

    if (body.len > 0) {
        try client_writer.writeAll(body);
    }

    var client_reader = client.reader();
    var req_buf_len = try client_reader.readAll(&http_req_buf);
    var request_buffer = http_req_buf[0..req_buf_len];
    var response: picohttp.Response = undefined;

    {
        var response_length: usize = 0;
        restart: while (true) {
            response = picohttp.Response.parseParts(request_buffer, &response_headers_buf, &response_length) catch |err| {
                switch (err) {
                    error.ShortRead => {
                        continue :restart;
                    },
                    else => {
                        return err;
                    },
                }
            };
            break :restart;
        }
    }

    body_out_str.reset();
    var content_length: u32 = 0;
    for (response.headers) |header| {
        if (this.verbose) {
            Output.prettyErrorln("Response: {s}", .{response});
        }

        switch (hashHeaderName(header.name)) {
            content_length_header_hash => {
                content_length = std.fmt.parseInt(u32, header.value, 10) catch 0;
                try body_out_str.inflate(content_length);
                body_out_str.list.expandToCapacity();
            },
            content_encoding_hash => {
                return error.UnsupportedEncoding;
            },
            else => {},
        }
    }

    if (content_length > 0) {
        var remaining_content_length = content_length;
        var remainder = http_req_buf[@intCast(u32, response.bytes_read)..];
        remainder = remainder[0..std.math.min(remainder.len, content_length)];

        var body_size: usize = 0;
        if (remainder.len > 0) {
            std.mem.copy(u8, body_out_str.list.items, remainder);
            body_size = @intCast(u32, remainder.len);
            remaining_content_length -= @intCast(u32, remainder.len);
        }

        while (remaining_content_length > 0) {
            const size = @intCast(u32, try client.read(
                body_out_str.list.items[body_size..],
            ));
            if (size == 0) break;

            body_size += size;
            remaining_content_length -= size;
        }

        body_out_str.list.shrinkRetainingCapacity(body_size);
    }

    return response;
}

// zig test src/http_client.zig --test-filter "sendHTTP" -lc -lc++ /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache
test "sendHTTP" {
    var headers = try std.heap.c_allocator.create(Headers);
    headers.* = Headers{
        .entries = @TypeOf(headers.entries){},
        .buf = @TypeOf(headers.buf){},
        .used = 0,
        .allocator = std.heap.c_allocator,
    };

    headers.appendHeader("X-What", "ok", true, true, false);

    var client = HTTPClient.init(
        std.heap.c_allocator,
        .GET,
        URL.parse("http://example.com/"),
        headers.entries,
        headers.buf.items,
    );
    var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
    var response = try client.sendHTTP("", &body_out_str);
    try std.testing.expectEqual(response.status_code, 200);
    try std.testing.expectEqual(body_out_str.list.items.len, 1256);
}

// zig test src/http_client.zig --test-filter "sendHTTPS" -lc -lc++ /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache
test "sendHTTPS" {
    var headers = try std.heap.c_allocator.create(Headers);
    headers.* = Headers{
        .entries = @TypeOf(headers.entries){},
        .buf = @TypeOf(headers.buf){},
        .used = 0,
        .allocator = std.heap.c_allocator,
    };

    headers.appendHeader("X-What", "ok", true, true, false);

    var client = HTTPClient.init(
        std.heap.c_allocator,
        .GET,
        URL.parse("https://hookb.in/aBnOOWN677UXQ9kkQ2g3"),
        headers.entries,
        headers.buf.items,
    );
    var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
    var response = try client.sendHTTPS("", &body_out_str);
    try std.testing.expectEqual(response.status_code, 200);
    try std.testing.expectEqual(body_out_str.list.items.len, 1256);
}
