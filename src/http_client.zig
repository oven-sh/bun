// @link "/Users/jarred/Code/bun/src/deps/zlib/libz.a"

const picohttp = @import("./deps/picohttp.zig");
usingnamespace @import("./global.zig");
const std = @import("std");
const Headers = @import("./javascript/jsc/webcore/response.zig").Headers;
const URL = @import("./query_string_map.zig").URL;
const Method = @import("./http/method.zig").Method;
const iguanaTLS = @import("./deps/iguanaTLS/src/main.zig");
const Api = @import("./api/schema.zig").Api;
const Lock = @import("./lock.zig").Lock;
const HTTPClient = @This();
const SOCKET_FLAGS = os.SOCK_CLOEXEC;
const S2n = @import("./s2n.zig");
const Zlib = @import("./zlib.zig");

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
verbose: bool = isTest,
tcp_client: tcp.Client = undefined,
body_size: u32 = 0,
read_count: u32 = 0,
remaining_redirect_count: i8 = 127,
redirect_buf: [2048]u8 = undefined,
disable_shutdown: bool = false,
timeout: u32 = 0,
progress_node: ?*std.Progress.Node = null,

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
threadlocal var request_content_len_buf: [64]u8 = undefined;
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

pub const Encoding = enum {
    identity,
    gzip,
    deflate,
    brotli,
    chunked,
};

const content_encoding_hash = hashHeaderName("Content-Encoding");
const transfer_encoding_header = hashHeaderName("Transfer-Encoding");

const host_header_name = "Host";
const content_length_header_name = "Content-Length";
const content_length_header_hash = hashHeaderName("Content-Length");
const connection_header = picohttp.Header{ .name = "Connection", .value = "close" };
const accept_header = picohttp.Header{ .name = "Accept", .value = "*/*" };
const accept_header_hash = hashHeaderName("Accept");

const accept_encoding_no_compression = "identity";
const accept_encoding_compression = "deflate, gzip";
const accept_encoding_header_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_compression };
const accept_encoding_header_no_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_no_compression };

const accept_encoding_header = if (FeatureFlags.disable_compression_in_http_client)
    accept_encoding_header_no_compression
else
    accept_encoding_header_compression;

const accept_encoding_header_hash = hashHeaderName("Accept-Encoding");

const user_agent_header = picohttp.Header{ .name = "User-Agent", .value = "Bun.js " ++ Global.package_json_version };
const user_agent_header_hash = hashHeaderName("User-Agent");
const location_header_hash = hashHeaderName("Location");

pub fn headerStr(this: *const HTTPClient, ptr: Api.StringPointer) string {
    return this.header_buf[ptr.offset..][0..ptr.length];
}

threadlocal var server_name_buf: [1024]u8 = undefined;

pub fn buildRequest(this: *const HTTPClient, body_len: usize) picohttp.Request {
    var header_count: usize = 0;
    var header_entries = this.header_entries.slice();
    var header_names = header_entries.items(.name);
    var header_values = header_entries.items(.value);

    var override_accept_encoding = false;

    var override_user_agent = false;
    for (header_names) |head, i| {
        const name = this.headerStr(head);
        // Hash it as lowercase
        const hash = hashHeaderName(name);

        // Skip host and connection header
        // we manage those
        switch (hash) {
            host_header_hash,
            connection_header_hash,
            content_length_header_hash,
            => continue,
            else => {},
        }

        override_user_agent = override_user_agent or hash == user_agent_header_hash;

        override_accept_encoding = override_accept_encoding or hash == accept_encoding_header_hash;

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

    if (!override_accept_encoding) {
        request_headers_buf[header_count] = accept_encoding_header;
        header_count += 1;
    }

    if (body_len > 0) {
        request_headers_buf[header_count] = picohttp.Header{
            .name = content_length_header_name,
            .value = std.fmt.bufPrint(&request_content_len_buf, "{d}", .{body_len}) catch "0",
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
    client.setNoDelay(true) catch {};
    client.setReadBufferSize(http_req_buf.len) catch {};
    client.setQuickACK(true) catch {};

    if (this.timeout > 0) {
        client.setReadTimeout(this.timeout) catch {};
        client.setWriteTimeout(this.timeout) catch {};
    }

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

pub fn send(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) !picohttp.Response {
    // this prevents stack overflow
    redirect: while (this.remaining_redirect_count >= -1) {
        if (this.url.isHTTPS()) {
            return this.sendHTTPS(body, body_out_str) catch |err| {
                switch (err) {
                    error.Redirect => {
                        this.remaining_redirect_count -= 1;
                        continue :redirect;
                    },
                    else => return err,
                }
            };
        } else {
            return this.sendHTTP(body, body_out_str) catch |err| {
                switch (err) {
                    error.Redirect => {
                        this.remaining_redirect_count -= 1;
                        continue :redirect;
                    },
                    else => return err,
                }
            };
        }
    }

    return error.TooManyRedirects;
}

pub fn sendHTTP(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) !picohttp.Response {
    this.tcp_client = try this.connect();
    defer std.os.closeSocket(this.tcp_client.socket.fd);
    var request = buildRequest(this, body.len);
    if (this.verbose) {
        Output.prettyErrorln("{s}", .{request});
    }
    var client_writer = this.tcp_client.writer(SOCKET_FLAGS);
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

    var client_reader = this.tcp_client.reader(SOCKET_FLAGS);

    if (this.progress_node == null) {
        return this.processResponse(
            false,
            false,
            @TypeOf(client_reader),
            client_reader,
            body_out_str,
        );
    } else {
        return this.processResponse(
            false,
            true,
            @TypeOf(client_reader),
            client_reader,
            body_out_str,
        );
    }
}

const ZlibPool = struct {
    lock: Lock = Lock.init(),
    items: std.ArrayList(*MutableString),
    allocator: *std.mem.Allocator,
    pub var instance: ZlibPool = undefined;
    pub var loaded: bool = false;

    pub fn init(allocator: *std.mem.Allocator) ZlibPool {
        return ZlibPool{
            .allocator = allocator,
            .items = std.ArrayList(*MutableString).init(allocator),
        };
    }

    pub fn get(this: *ZlibPool) !*MutableString {
        this.lock.lock();
        defer this.lock.unlock();
        switch (this.items.items.len) {
            0 => {
                var mutable = try this.allocator.create(MutableString);
                mutable.* = try MutableString.init(this.allocator, 0);
                return mutable;
            },
            else => {
                return this.items.pop();
            },
        }

        return item;
    }

    pub fn put(this: *ZlibPool, mutable: *MutableString) !void {
        this.lock.lock();
        defer this.lock.unlock();
        mutable.reset();
        try this.items.append(mutable);
    }
};

pub fn processResponse(this: *HTTPClient, comptime is_https: bool, comptime report_progress: bool, comptime Client: type, client: Client, body_out_str: *MutableString) !picohttp.Response {
    var response: picohttp.Response = undefined;
    var read_length: usize = 0;
    {
        var read_headers_up_to: usize = 0;

        var req_buf_read: usize = std.math.maxInt(usize);
        defer this.read_count += @intCast(u32, read_length);

        restart: while (req_buf_read != 0) {
            req_buf_read = try client.read(http_req_buf[read_length..]);
            read_length += req_buf_read;
            if (comptime report_progress) {
                this.progress_node.?.activate();
                this.progress_node.?.setCompletedItems(read_length);
                this.progress_node.?.context.maybeRefresh();
            }

            var request_buffer = http_req_buf[0..read_length];
            read_headers_up_to = if (read_headers_up_to > read_length) read_length else read_headers_up_to;

            response = picohttp.Response.parseParts(request_buffer, &response_headers_buf, &read_headers_up_to) catch |err| {
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
    var encoding = Encoding.identity;
    var transfer_encoding = Encoding.identity;

    var location: string = "";

    if (this.verbose) {
        Output.prettyErrorln("Response: {s}", .{response});
    }

    for (response.headers) |header| {
        switch (hashHeaderName(header.name)) {
            content_length_header_hash => {
                content_length = std.fmt.parseInt(u32, header.value, 10) catch 0;
                try body_out_str.inflate(content_length);
                body_out_str.list.expandToCapacity();
                this.body_size = content_length;
            },
            content_encoding_hash => {
                if (strings.eqlComptime(header.value, "gzip")) {
                    encoding = Encoding.gzip;
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    encoding = Encoding.deflate;
                } else if (!strings.eqlComptime(header.value, "identity")) {
                    return error.UnsupportedContentEncoding;
                }
            },
            transfer_encoding_header => {
                if (strings.eqlComptime(header.value, "gzip")) {
                    transfer_encoding = Encoding.gzip;
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    transfer_encoding = Encoding.deflate;
                } else if (strings.eqlComptime(header.value, "identity")) {
                    transfer_encoding = Encoding.identity;
                } else if (strings.eqlComptime(header.value, "chunked")) {
                    transfer_encoding = Encoding.chunked;
                } else {
                    return error.UnsupportedTransferEncoding;
                }
            },
            location_header_hash => {
                location = header.value;
            },

            else => {},
        }
    }

    if (location.len > 0 and this.remaining_redirect_count > 0) {
        switch (response.status_code) {
            302, 301, 307, 308, 303 => {
                if (strings.indexOf(location, "://")) |i| {
                    const protocol_name = location[0..i];
                    if (strings.eqlComptime(protocol_name, "http") or strings.eqlComptime(protocol_name, "https")) {} else {
                        return error.UnsupportedRedirectProtocol;
                    }

                    std.mem.copy(u8, &this.redirect_buf, location);
                    this.url = URL.parse(location);
                } else {
                    const original_url = this.url;
                    this.url = URL.parse(std.fmt.bufPrint(
                        &this.redirect_buf,
                        "{s}://{s}{s}",
                        .{ original_url.displayProtocol(), original_url.displayHostname(), location },
                    ) catch return error.RedirectURLTooLong);
                }

                // https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/303
                if (response.status_code == 303) {
                    this.method = .GET;
                }

                return error.Redirect;
            },
            else => {},
        }
    }

    if (transfer_encoding == Encoding.chunked) {
        var decoder = std.mem.zeroes(picohttp.phr_chunked_decoder);
        var buffer_: *MutableString = body_out_str;

        switch (encoding) {
            Encoding.gzip, Encoding.deflate => {
                if (!ZlibPool.loaded) {
                    ZlibPool.instance = ZlibPool.init(default_allocator);
                    ZlibPool.loaded = true;
                }

                buffer_ = try ZlibPool.instance.get();
            },
            else => {},
        }

        var buffer = buffer_.*;

        var last_read: usize = 0;
        {
            var remainder = http_req_buf[@intCast(usize, response.bytes_read)..read_length];
            last_read = remainder.len;
            try buffer.inflate(std.math.max(remainder.len, 2048));
            buffer.list.expandToCapacity();
            std.mem.copy(u8, buffer.list.items, remainder);
        }

        // set consume_trailer to 1 to discard the trailing header
        // using content-encoding per chunk is not supported
        decoder.consume_trailer = 1;

        // these variable names are terrible
        // it's copypasta from https://github.com/h2o/picohttpparser#phr_decode_chunked
        // (but ported from C -> zig)
        var rret: usize = 0;
        var rsize: usize = last_read;
        var pret: isize = picohttp.phr_decode_chunked(&decoder, buffer.list.items.ptr, &rsize);
        var total_size = rsize;

        while (pret == -2) {
            if (buffer.list.items[total_size..].len < @intCast(usize, decoder.bytes_left_in_chunk) or buffer.list.items[total_size..].len < 512) {
                try buffer.inflate(std.math.max(total_size * 2, 1024));
                buffer.list.expandToCapacity();
            }

            rret = try client.read(buffer.list.items[total_size..]);

            if (rret == 0) {
                return error.ChunkedEncodingError;
            }

            rsize = rret;
            pret = picohttp.phr_decode_chunked(&decoder, buffer.list.items[total_size..].ptr, &rsize);
            if (pret == -1) return error.ChunkedEncodingParseError;

            total_size += rsize;

            if (comptime report_progress) {
                this.progress_node.?.activate();
                this.progress_node.?.setCompletedItems(total_size);
                this.progress_node.?.context.maybeRefresh();
            }
        }

        buffer.list.shrinkRetainingCapacity(total_size);
        buffer_.* = buffer;

        switch (encoding) {
            Encoding.gzip, Encoding.deflate => {
                body_out_str.list.expandToCapacity();
                defer ZlibPool.instance.put(buffer_) catch unreachable;
                var reader = try Zlib.ZlibReaderArrayList.init(buffer.list.items, &body_out_str.list, default_allocator);
                reader.readAll() catch |err| {
                    if (reader.errorMessage()) |msg| {
                        Output.prettyErrorln("<r><red>Zlib error<r>: <b>{s}<r>", .{msg});
                        Output.flush();
                    }
                    return err;
                };
            },
            else => {},
        }

        if (comptime report_progress) {
            this.progress_node.?.activate();
            this.progress_node.?.setCompletedItems(body_out_str.list.items.len);
            this.progress_node.?.context.maybeRefresh();
        }

        this.body_size = @intCast(u32, body_out_str.list.items.len);
        return response;
    }

    if (content_length > 0) {
        var remaining_content_length = content_length;
        var remainder = http_req_buf[@intCast(usize, response.bytes_read)..read_length];
        remainder = remainder[0..std.math.min(remainder.len, content_length)];
        var buffer_: *MutableString = body_out_str;

        switch (encoding) {
            Encoding.gzip, Encoding.deflate => {
                if (!ZlibPool.loaded) {
                    ZlibPool.instance = ZlibPool.init(default_allocator);
                    ZlibPool.loaded = true;
                }

                buffer_ = try ZlibPool.instance.get();
                if (buffer_.list.capacity < remaining_content_length) {
                    try buffer_.list.ensureUnusedCapacity(buffer_.allocator, remaining_content_length);
                }
                buffer_.list.items = buffer_.list.items.ptr[0..remaining_content_length];
            },
            else => {},
        }
        var buffer = buffer_.*;

        var body_size: usize = 0;
        if (remainder.len > 0) {
            std.mem.copy(u8, buffer.list.items, remainder);
            body_size = remainder.len;
            this.read_count += @intCast(u32, body_size);
            remaining_content_length -= @intCast(u32, remainder.len);
        }

        while (remaining_content_length > 0) {
            const size = @intCast(u32, try client.read(
                buffer.list.items[body_size..],
            ));
            this.read_count += size;
            if (size == 0) break;

            body_size += size;
            remaining_content_length -= size;

            if (comptime report_progress) {
                this.progress_node.?.activate();
                this.progress_node.?.setCompletedItems(body_size);
                this.progress_node.?.context.maybeRefresh();
            }
        }

        if (comptime report_progress) {
            this.progress_node.?.activate();
            this.progress_node.?.setCompletedItems(body_size);
            this.progress_node.?.context.maybeRefresh();
        }

        buffer.list.shrinkRetainingCapacity(body_size);
        buffer_.* = buffer;

        switch (encoding) {
            Encoding.gzip, Encoding.deflate => {
                body_out_str.list.expandToCapacity();
                defer ZlibPool.instance.put(buffer_) catch unreachable;
                var reader = try Zlib.ZlibReaderArrayList.init(buffer.list.items, &body_out_str.list, default_allocator);
                reader.readAll() catch |err| {
                    if (reader.errorMessage()) |msg| {
                        Output.prettyErrorln("<r><red>Zlib error<r>: <b>{s}<r>", .{msg});
                        Output.flush();
                    }
                    return err;
                };
            },
            else => {},
        }
    }

    if (comptime report_progress) {
        this.progress_node.?.activate();
        this.progress_node.?.setCompletedItems(body_out_str.list.items.len);
        this.progress_node.?.context.maybeRefresh();
    }

    return response;
}

pub fn sendHTTPS(this: *HTTPClient, body_str: []const u8, body_out_str: *MutableString) !picohttp.Response {
    var connection = try this.connect();
    S2n.boot(default_allocator);
    const hostname = this.url.displayHostname();
    std.mem.copy(u8, &server_name_buf, hostname);
    server_name_buf[hostname.len] = 0;
    var server_name = server_name_buf[0..hostname.len :0];

    var client = S2n.Connection.init(connection.socket.fd);
    try client.start(server_name);
    client.disable_shutdown = this.disable_shutdown;
    defer client.close() catch {};

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

    if (this.progress_node == null) {
        return try this.processResponse(true, false, @TypeOf(&client), &client, body_out_str);
    } else {
        return try this.processResponse(true, true, @TypeOf(&client), &client, body_out_str);
    }
}

// zig test src/http_client.zig --test-filter "sendHTTP - only" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test --test-no-exec
test "sendHTTP - only" {
    Output.initTest();
    defer Output.flush();

    var headers = try std.heap.c_allocator.create(Headers);
    headers.* = Headers{
        .entries = @TypeOf(headers.entries){},
        .buf = @TypeOf(headers.buf){},
        .used = 0,
        .allocator = std.heap.c_allocator,
    };

    // headers.appendHeader("X-What", "ok", true, true, false);
    headers.appendHeader("Accept-Encoding", "identity", true, true, false);

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
    try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
}

// zig test src/http_client.zig --test-filter "sendHTTP - gzip" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test --test-no-exec
test "sendHTTP - gzip" {
    Output.initTest();
    defer Output.flush();

    var headers = try std.heap.c_allocator.create(Headers);
    headers.* = Headers{
        .entries = @TypeOf(headers.entries){},
        .buf = @TypeOf(headers.buf){},
        .used = 0,
        .allocator = std.heap.c_allocator,
    };

    // headers.appendHeader("X-What", "ok", true, true, false);
    headers.appendHeader("Accept-Encoding", "gzip", true, true, false);

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
    try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
}

// zig test src/http_client.zig --test-filter "sendHTTPS - identity" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test --test-no-exec
test "sendHTTPS - identity" {
    Output.initTest();
    defer Output.flush();

    var headers = try std.heap.c_allocator.create(Headers);
    headers.* = Headers{
        .entries = @TypeOf(headers.entries){},
        .buf = @TypeOf(headers.buf){},
        .used = 0,
        .allocator = std.heap.c_allocator,
    };

    headers.appendHeader("X-What", "ok", true, true, false);
    headers.appendHeader("Accept-Encoding", "identity", true, true, false);

    var client = HTTPClient.init(
        std.heap.c_allocator,
        .GET,
        URL.parse("https://example.com/"),
        headers.entries,
        headers.buf.items,
    );
    var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
    var response = try client.sendHTTPS("", &body_out_str);
    try std.testing.expectEqual(response.status_code, 200);
    try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
}

test "sendHTTPS - gzip" {
    Output.initTest();
    defer Output.flush();

    var headers = try std.heap.c_allocator.create(Headers);
    headers.* = Headers{
        .entries = @TypeOf(headers.entries){},
        .buf = @TypeOf(headers.buf){},
        .used = 0,
        .allocator = std.heap.c_allocator,
    };

    headers.appendHeader("Accept-Encoding", "gzip", false, false, false);

    var client = HTTPClient.init(
        std.heap.c_allocator,
        .GET,
        URL.parse("https://example.com/"),
        headers.entries,
        headers.buf.items,
    );
    var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
    var response = try client.sendHTTPS("", &body_out_str);
    try std.testing.expectEqual(response.status_code, 200);
    try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
}

// zig test src/http_client.zig --test-filter "sendHTTPS - deflate" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test
test "sendHTTPS - deflate" {
    Output.initTest();
    defer Output.flush();

    var headers = try std.heap.c_allocator.create(Headers);
    headers.* = Headers{
        .entries = @TypeOf(headers.entries){},
        .buf = @TypeOf(headers.buf){},
        .used = 0,
        .allocator = std.heap.c_allocator,
    };

    headers.appendHeader("Accept-Encoding", "deflate", false, false, false);

    var client = HTTPClient.init(
        std.heap.c_allocator,
        .GET,
        URL.parse("https://example.com/"),
        headers.entries,
        headers.buf.items,
    );
    var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
    var response = try client.sendHTTPS("", &body_out_str);
    try std.testing.expectEqual(response.status_code, 200);
    try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
}

// zig test src/http_client.zig --test-filter "sendHTTP" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test

test "send - redirect" {
    Output.initTest();
    defer Output.flush();

    var headers = try std.heap.c_allocator.create(Headers);
    headers.* = Headers{
        .entries = @TypeOf(headers.entries){},
        .buf = @TypeOf(headers.buf){},
        .used = 0,
        .allocator = std.heap.c_allocator,
    };

    headers.appendHeader("Accept-Encoding", "gzip", false, false, false);

    var client = HTTPClient.init(
        std.heap.c_allocator,
        .GET,
        URL.parse("https://www.bun.sh/"),
        headers.entries,
        headers.buf.items,
    );
    try std.testing.expectEqualStrings(client.url.hostname, "www.bun.sh");
    var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
    var response = try client.send("", &body_out_str);
    try std.testing.expectEqual(response.status_code, 200);
    try std.testing.expectEqual(client.url.hostname, "bun.sh");
    try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
}
