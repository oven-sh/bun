const std = @import("std");
const Api = @import("./api/schema.zig").Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

// This is close to WHATWG URL, but we don't want the validation errors
pub const URL = struct {
    const log = Output.scoped(.URL, false);

    hash: string = "",
    /// hostname, but with a port
    /// `localhost:3000`
    host: string = "",
    /// hostname does not have a port
    /// `localhost`
    hostname: string = "",
    href: string = "",
    origin: string = "",
    password: string = "",
    pathname: string = "/",
    path: string = "/",
    port: string = "",
    protocol: string = "",
    search: string = "",
    searchParams: ?QueryStringMap = null,
    username: string = "",
    port_was_automatically_set: bool = false,

    pub fn isLocalhost(this: *const URL) bool {
        return this.hostname.len == 0 or strings.eqlComptime(this.hostname, "localhost") or strings.eqlComptime(this.hostname, "0.0.0.0");
    }

    pub fn displayProtocol(this: *const URL) string {
        if (this.protocol.len > 0) {
            return this.protocol;
        }

        if (this.getPort()) |port| {
            if (port == 443) {
                return "https";
            }
        }

        return "http";
    }

    pub inline fn isHTTPS(this: *const URL) bool {
        return strings.eqlComptime(this.protocol, "https");
    }

    pub inline fn isHTTP(this: *const URL) bool {
        return strings.eqlComptime(this.protocol, "http");
    }

    pub fn displayHostname(this: *const URL) string {
        if (this.hostname.len > 0) {
            return this.hostname;
        }

        return "localhost";
    }

    pub const HostFormatter = struct {
        host: string,
        port: string = "80",
        is_https: bool = false,

        pub fn format(formatter: HostFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (strings.indexOfChar(formatter.host, ':') != null) {
                try writer.writeAll(formatter.host);
                return;
            }

            try writer.writeAll(formatter.host);

            const is_port_optional = (formatter.is_https and (formatter.port.len == 0 or strings.eqlComptime(formatter.port, "443"))) or
                (!formatter.is_https and (formatter.port.len == 0 or strings.eqlComptime(formatter.port, "80")));
            if (!is_port_optional) {
                try writer.writeAll(":");
                try writer.writeAll(formatter.port);
                return;
            }
        }
    };
    pub fn displayHost(this: *const URL) HostFormatter {
        return HostFormatter{
            .host = if (this.host.len > 0) this.host else this.displayHostname(),
            .port = this.port,
            .is_https = this.isHTTPS(),
        };
    }

    pub fn hasHTTPLikeProtocol(this: *const URL) bool {
        return strings.eqlComptime(this.protocol, "http") or strings.eqlComptime(this.protocol, "https");
    }

    pub fn getPort(this: *const URL) ?u16 {
        return std.fmt.parseInt(u16, this.port, 10) catch null;
    }

    pub fn getPortAuto(this: *const URL) u16 {
        return this.getPort() orelse this.getDefaultPort();
    }

    pub fn getDefaultPort(this: *const URL) u16 {
        return if (this.isHTTPS()) @as(u16, 443) else @as(u16, 80);
    }

    pub fn hasValidPort(this: *const URL) bool {
        return (this.getPort() orelse 0) > 1;
    }

    pub fn isEmpty(this: *const URL) bool {
        return this.href.len == 0;
    }

    pub fn isAbsolute(this: *const URL) bool {
        return this.hostname.len > 0 and this.pathname.len > 0;
    }

    pub fn joinNormalize(out: []u8, prefix: string, dirname: string, basename: string, extname: string) string {
        var buf: [2048]u8 = undefined;

        var path_parts: [10]string = undefined;
        var path_end: usize = 0;

        path_parts[0] = "/";
        path_end += 1;

        if (prefix.len > 0) {
            path_parts[path_end] = prefix;
            path_end += 1;
        }

        if (dirname.len > 0) {
            path_parts[path_end] = std.mem.trim(u8, dirname, "/\\");
            path_end += 1;
        }

        if (basename.len > 0) {
            if (dirname.len > 0) {
                path_parts[path_end] = "/";
                path_end += 1;
            }

            path_parts[path_end] = std.mem.trim(u8, basename, "/\\");
            path_end += 1;
        }

        if (extname.len > 0) {
            path_parts[path_end] = extname;
            path_end += 1;
        }

        var buf_i: usize = 0;
        for (path_parts[0..path_end]) |part| {
            bun.copy(u8, buf[buf_i..], part);
            buf_i += part.len;
        }
        return resolve_path.normalizeStringBuf(buf[0..buf_i], out, false, .loose, false);
    }

    pub fn joinWrite(
        this: *const URL,
        comptime Writer: type,
        writer: Writer,
        prefix: string,
        dirname: string,
        basename: string,
        extname: string,
    ) !void {
        var out: [2048]u8 = undefined;
        const normalized_path = joinNormalize(&out, prefix, dirname, basename, extname);

        try writer.print("{s}/{s}", .{ this.origin, normalized_path });
    }

    pub fn joinAlloc(this: *const URL, allocator: std.mem.Allocator, prefix: string, dirname: string, basename: string, extname: string, absolute_path: string) !string {
        const has_uplevels = std.mem.indexOf(u8, dirname, "../") != null;

        if (has_uplevels) {
            return try std.fmt.allocPrint(allocator, "{s}/abs:{s}", .{ this.origin, absolute_path });
        } else {
            var out: [2048]u8 = undefined;

            const normalized_path = joinNormalize(&out, prefix, dirname, basename, extname);
            return try std.fmt.allocPrint(allocator, "{s}/{s}", .{ this.origin, normalized_path });
        }
    }

    pub fn parse(base_: string) URL {
        const base = std.mem.trim(u8, base_, &std.ascii.whitespace);
        if (base.len == 0) return URL{};
        var url = URL{};
        url.href = base;
        var offset: u31 = 0;
        switch (base[0]) {
            '@' => {
                offset += url.parsePassword(base[offset..]) orelse 0;
                offset += url.parseHost(base[offset..]) orelse 0;
            },
            '/', 'a'...'z', 'A'...'Z', '0'...'9', '-', '_', ':' => {
                const is_protocol_relative = base.len > 1 and base[1] == '/';
                if (is_protocol_relative) {
                    offset += 1;
                } else {
                    offset += url.parseProtocol(base[offset..]) orelse 0;
                }

                const is_relative_path = !is_protocol_relative and base[0] == '/';

                if (!is_relative_path) {

                    // if there's no protocol or @, it's ambiguous whether the colon is a port or a username.
                    if (offset > 0) {
                        // see https://github.com/oven-sh/bun/issues/1390
                        const first_at = strings.indexOfChar(base[offset..], '@') orelse 0;
                        const first_colon = strings.indexOfChar(base[offset..], ':') orelse 0;

                        if (first_at > first_colon and first_at < (strings.indexOfChar(base[offset..], '/') orelse std.math.maxInt(u32))) {
                            offset += url.parseUsername(base[offset..]) orelse 0;
                            offset += url.parsePassword(base[offset..]) orelse 0;
                        }
                    }

                    offset += url.parseHost(base[offset..]) orelse 0;
                }
            },
            else => {},
        }

        url.origin = base[0..offset];
        var hash_offset: u32 = std.math.maxInt(u32);

        if (offset > base.len) {
            return url;
        }

        const path_offset = offset;

        var can_update_path = true;
        if (base.len > offset + 1 and base[offset] == '/' and base[offset..].len > 0) {
            url.path = base[offset..];
            url.pathname = url.path;
        }

        if (strings.indexOfChar(base[offset..], '?')) |q| {
            offset += @intCast(u31, q);
            url.path = base[path_offset..][0..q];
            can_update_path = false;
            url.search = base[offset..];
        }

        if (strings.indexOfChar(base[offset..], '#')) |hash| {
            offset += @intCast(u31, hash);
            hash_offset = offset;
            if (can_update_path) {
                url.path = base[path_offset..][0..hash];
            }
            url.hash = base[offset..];

            if (url.search.len > 0) {
                url.search = url.search[0 .. url.search.len - url.hash.len];
            }
        }

        if (base.len > path_offset and base[path_offset] == '/' and offset > 0) {
            if (url.search.len > 0) {
                url.pathname = base[path_offset..std.math.min(
                    std.math.min(offset + url.search.len, base.len),
                    hash_offset,
                )];
            } else if (hash_offset < std.math.maxInt(u32)) {
                url.pathname = base[path_offset..hash_offset];
            }

            url.origin = base[0..path_offset];
        }

        if (url.path.len > 1) {
            const trimmed = std.mem.trim(u8, url.path, "/");
            if (trimmed.len > 1) {
                url.path = url.path[std.math.min(
                    std.math.max(@ptrToInt(trimmed.ptr) - @ptrToInt(url.path.ptr), 1) - 1,
                    hash_offset,
                )..];
            } else {
                url.path = "/";
            }
        } else {
            url.path = "/";
        }

        if (url.pathname.len == 0) {
            url.pathname = "/";
        }

        while (url.pathname.len > 1 and @bitCast(u16, url.pathname[0..2].*) == comptime std.mem.readIntNative(u16, "//")) {
            url.pathname = url.pathname[1..];
        }

        url.origin = std.mem.trim(u8, url.origin, "/ ?#");
        return url;
    }

    pub fn parseProtocol(url: *URL, str: string) ?u31 {
        var i: u31 = 0;
        if (str.len < "://".len) return null;
        while (i < str.len) : (i += 1) {
            switch (str[i]) {
                '/', '?', '%' => {
                    return null;
                },
                ':' => {
                    if (i + 3 <= str.len and str[i + 1] == '/' and str[i + 2] == '/') {
                        url.protocol = str[0..i];
                        return i + 3;
                    }
                },
                else => {},
            }
        }

        return null;
    }

    pub fn parseUsername(url: *URL, str: string) ?u31 {
        var i: u31 = 0;

        // reset it
        url.username = "";

        if (str.len < "@".len) return null;

        while (i < str.len) : (i += 1) {
            switch (str[i]) {
                ':', '@' => {
                    // we found a username, everything before this point in the slice is a username
                    url.username = str[0..i];
                    return i + 1;
                },
                // if we reach a slash, there's no username
                '/' => {
                    return null;
                },
                else => {},
            }
        }
        return null;
    }

    pub fn parsePassword(url: *URL, str: string) ?u31 {
        var i: u31 = 0;

        // reset it
        url.password = "";

        if (str.len < "@".len) return null;

        while (i < str.len) : (i += 1) {
            switch (str[i]) {
                '@' => {
                    // we found a password, everything before this point in the slice is a password
                    url.password = str[0..i];
                    if (Environment.allow_assert) std.debug.assert(str[i..].len < 2 or std.mem.readIntNative(u16, str[i..][0..2]) != std.mem.readIntNative(u16, "//"));
                    return i + 1;
                },
                // if we reach a slash, there's no password
                '/' => {
                    return null;
                },
                else => {},
            }
        }
        return null;
    }

    pub fn parseHost(url: *URL, str: string) ?u31 {
        var i: u31 = 0;

        // reset it
        url.host = "";
        url.hostname = "";
        url.port = "";

        //if starts with "[" so its IPV6
        if (str.len > 0 and str[0] == '[') {
            i = 1;
            var ipv6_i: ?u31 = null;
            var colon_i: ?u31 = null;

            while (i < str.len) : (i += 1) {
                ipv6_i = if (ipv6_i == null and str[i] == ']') i else ipv6_i;
                colon_i = if (ipv6_i != null and colon_i == null and str[i] == ':') i else colon_i;
                switch (str[i]) {
                    // alright, we found the slash
                    '/' => {
                        break;
                    },
                    else => {},
                }
            }

            url.host = str[0..i];
            if (ipv6_i) |ipv6| {
                //hostname includes "[" and "]"
                url.hostname = str[0 .. ipv6 + 1];
            }

            if (colon_i) |colon| {
                url.port = str[colon + 1 .. i];
            }
        } else {

            // look for the first "/"
            // if we have a slash, anything before that is the host
            // anything before the colon is the hostname
            // anything after the colon but before the slash is the port
            // the origin is the scheme before the slash

            var colon_i: ?u31 = null;
            while (i < str.len) : (i += 1) {
                colon_i = if (colon_i == null and str[i] == ':') i else colon_i;

                switch (str[i]) {
                    // alright, we found the slash
                    '/' => {
                        break;
                    },
                    else => {},
                }
            }

            url.host = str[0..i];
            if (colon_i) |colon| {
                url.hostname = str[0..colon];
                url.port = str[colon + 1 .. i];
            } else {
                url.hostname = str[0..i];
            }
        }

        return i;
    }
};

/// QueryString array-backed hash table that does few allocations and preserves the original order
pub const QueryStringMap = struct {
    allocator: std.mem.Allocator,
    slice: string,
    buffer: []u8,
    list: Param.List,
    name_count: ?usize = null,

    threadlocal var _name_count: [8]string = undefined;
    pub fn getNameCount(this: *QueryStringMap) usize {
        return this.list.len;
        // if (this.name_count == null) {
        //     var count: usize = 0;
        //     var iterate = this.iter();
        //     while (iterate.next(&_name_count) != null) {
        //         count += 1;
        //     }
        //     this.name_count = count;
        // }
        // return this.name_count.?;
    }

    pub fn iter(this: *const QueryStringMap) Iterator {
        return Iterator.init(this);
    }

    pub const Iterator = struct {
        // Assume no query string param map will exceed 2048 keys
        // Browsers typically limit URL lengths to around 64k
        const VisitedMap = std.bit_set.ArrayBitSet(usize, 2048);

        i: usize = 0,
        map: *const QueryStringMap,
        visited: VisitedMap,

        const Result = struct {
            name: string,
            values: []string,
        };

        pub fn init(map: *const QueryStringMap) Iterator {
            return Iterator{ .i = 0, .map = map, .visited = VisitedMap.initEmpty() };
        }

        pub fn next(this: *Iterator, target: []string) ?Result {
            while (this.visited.isSet(this.i)) : (this.i += 1) {}
            if (this.i >= this.map.list.len) return null;

            var slice = this.map.list.slice();
            const hash = slice.items(.name_hash)[this.i];
            const name_slice = slice.items(.name)[this.i];
            std.debug.assert(name_slice.length > 0);
            var result = Result{ .name = this.map.str(name_slice), .values = target[0..1] };
            target[0] = this.map.str(slice.items(.value)[this.i]);

            this.visited.set(this.i);
            this.i += 1;

            var remainder_hashes = slice.items(.name_hash)[this.i..];
            var remainder_values = slice.items(.value)[this.i..];

            var target_i: usize = 1;
            var current_i: usize = 0;

            while (std.mem.indexOfScalar(u64, remainder_hashes[current_i..], hash)) |next_index| {
                const real_i = current_i + next_index + this.i;
                if (comptime Environment.isDebug) {
                    std.debug.assert(!this.visited.isSet(real_i));
                }

                this.visited.set(real_i);
                target[target_i] = this.map.str(remainder_values[current_i + next_index]);
                target_i += 1;
                result.values = target[0..target_i];

                current_i += next_index + 1;
                if (target_i >= target.len) return result;
                if (real_i + 1 >= this.map.list.len) return result;
            }

            return result;
        }
    };

    pub fn str(this: *const QueryStringMap, ptr: Api.StringPointer) string {
        return this.slice[ptr.offset .. ptr.offset + ptr.length];
    }

    pub fn getIndex(this: *const QueryStringMap, input: string) ?usize {
        const hash = std.hash.Wyhash.hash(0, input);
        return std.mem.indexOfScalar(u64, this.list.items(.name_hash), hash);
    }

    pub fn get(this: *const QueryStringMap, input: string) ?string {
        const hash = std.hash.Wyhash.hash(0, input);
        const _slice = this.list.slice();
        const i = std.mem.indexOfScalar(u64, _slice.items(.name_hash), hash) orelse return null;
        return this.str(_slice.items(.value)[i]);
    }

    pub fn has(this: *const QueryStringMap, input: string) bool {
        return this.getIndex(input) != null;
    }

    pub fn getAll(this: *const QueryStringMap, input: string, target: []string) usize {
        const hash = std.hash.Wyhash.hash(0, input);
        const _slice = this.list.slice();
        return @call(.always_inline, getAllWithHashFromOffset, .{ this, target, hash, 0, _slice });
    }

    pub fn getAllWithHashFromOffset(this: *const QueryStringMap, target: []string, hash: u64, offset: usize, _slice: Param.List.Slice) usize {
        var remainder_hashes = _slice.items(.name_hash)[offset..];
        var remainder_values = _slice.items(.value)[offset..];
        var target_i: usize = 0;
        while (remainder_hashes.len > 0 and target_i < target.len) {
            const i = std.mem.indexOfScalar(u64, remainder_hashes, hash) orelse break;
            target[target_i] = this.str(remainder_values[i]);
            remainder_values = remainder_values[i + 1 ..];
            remainder_hashes = remainder_hashes[i + 1 ..];
            target_i += 1;
        }
        return target_i;
    }

    pub const Param = struct {
        name: Api.StringPointer,
        name_hash: u64,
        value: Api.StringPointer,

        pub const List = std.MultiArrayList(Param);
    };

    pub fn initWithScanner(
        allocator: std.mem.Allocator,
        _scanner: CombinedScanner,
    ) !?QueryStringMap {
        var list = Param.List{};
        var scanner = _scanner;

        var estimated_str_len: usize = 0;
        var count: usize = 0;

        var nothing_needs_decoding = true;

        while (scanner.pathname.next()) |result| {
            if (result.name_needs_decoding or result.value_needs_decoding) {
                nothing_needs_decoding = false;
            }
            estimated_str_len += result.name.length + result.value.length;
            count += 1;
        }

        if (Environment.allow_assert)
            std.debug.assert(count > 0); // We should not call initWithScanner when there are no path params

        while (scanner.query.next()) |result| {
            if (result.name_needs_decoding or result.value_needs_decoding) {
                nothing_needs_decoding = false;
            }
            estimated_str_len += result.name.length + result.value.length;
            count += 1;
        }

        if (count == 0) return null;

        try list.ensureTotalCapacity(allocator, count);
        scanner.reset();

        // this over-allocates
        // TODO: refactor this to support multiple slices instead of copying the whole thing
        var buf = try std.ArrayList(u8).initCapacity(allocator, estimated_str_len);
        var writer = buf.writer();
        var buf_writer_pos: u32 = 0;

        const Writer = @TypeOf(writer);
        while (scanner.pathname.next()) |result| {
            var name = result.name;
            var value = result.value;
            const name_slice = result.rawName(scanner.pathname.routename);

            name.length = @truncate(u32, name_slice.len);
            name.offset = buf_writer_pos;
            try writer.writeAll(name_slice);
            buf_writer_pos += @truncate(u32, name_slice.len);

            var name_hash: u64 = std.hash.Wyhash.hash(0, name_slice);

            value.length = PercentEncoding.decode(Writer, writer, result.rawValue(scanner.pathname.pathname)) catch continue;
            value.offset = buf_writer_pos;
            buf_writer_pos += value.length;

            list.appendAssumeCapacity(Param{ .name = name, .value = value, .name_hash = name_hash });
        }

        const route_parameter_begin = list.len;

        while (scanner.query.next()) |result| {
            var list_slice = list.slice();

            var name = result.name;
            var value = result.value;
            var name_hash: u64 = undefined;
            if (result.name_needs_decoding) {
                name.length = PercentEncoding.decode(Writer, writer, scanner.query.query_string[name.offset..][0..name.length]) catch continue;
                name.offset = buf_writer_pos;
                buf_writer_pos += name.length;
                name_hash = std.hash.Wyhash.hash(0, buf.items[name.offset..][0..name.length]);
            } else {
                name_hash = std.hash.Wyhash.hash(0, result.rawName(scanner.query.query_string));
                if (std.mem.indexOfScalar(u64, list_slice.items(.name_hash), name_hash)) |index| {

                    // query string parameters should not override route parameters
                    // see https://nextjs.org/docs/routing/dynamic-routes
                    if (index < route_parameter_begin) {
                        continue;
                    }

                    name = list_slice.items(.name)[index];
                } else {
                    name.length = PercentEncoding.decode(Writer, writer, scanner.query.query_string[name.offset..][0..name.length]) catch continue;
                    name.offset = buf_writer_pos;
                    buf_writer_pos += name.length;
                }
            }

            value.length = PercentEncoding.decode(Writer, writer, scanner.query.query_string[value.offset..][0..value.length]) catch continue;
            value.offset = buf_writer_pos;
            buf_writer_pos += value.length;

            list.appendAssumeCapacity(Param{ .name = name, .value = value, .name_hash = name_hash });
        }

        buf.expandToCapacity();
        return QueryStringMap{
            .list = list,
            .buffer = buf.items,
            .slice = buf.items[0..buf_writer_pos],
            .allocator = allocator,
        };
    }

    pub fn init(
        allocator: std.mem.Allocator,
        query_string: string,
    ) !?QueryStringMap {
        var list = Param.List{};

        var scanner = Scanner.init(query_string);
        var count: usize = 0;
        var estimated_str_len: usize = 0;

        var nothing_needs_decoding = true;
        while (scanner.next()) |result| {
            if (result.name_needs_decoding or result.value_needs_decoding) {
                nothing_needs_decoding = false;
            }
            estimated_str_len += result.name.length + result.value.length;
            count += 1;
        }

        if (count == 0) return null;

        scanner = Scanner.init(query_string);
        try list.ensureTotalCapacity(allocator, count);

        if (nothing_needs_decoding) {
            scanner = Scanner.init(query_string);
            while (scanner.next()) |result| {
                if (Environment.allow_assert) std.debug.assert(!result.name_needs_decoding);
                if (Environment.allow_assert) std.debug.assert(!result.value_needs_decoding);

                var name = result.name;
                var value = result.value;
                const name_hash: u64 = std.hash.Wyhash.hash(0, result.rawName(query_string));
                list.appendAssumeCapacity(Param{ .name = name, .value = value, .name_hash = name_hash });
            }

            return QueryStringMap{
                .list = list,
                .buffer = &[_]u8{},
                .slice = query_string,
                .allocator = allocator,
            };
        }

        var buf = try std.ArrayList(u8).initCapacity(allocator, estimated_str_len);
        var writer = buf.writer();
        var buf_writer_pos: u32 = 0;

        var list_slice = list.slice();
        const Writer = @TypeOf(writer);
        while (scanner.next()) |result| {
            var name = result.name;
            var value = result.value;
            var name_hash: u64 = undefined;
            if (result.name_needs_decoding) {
                name.length = PercentEncoding.decode(Writer, writer, query_string[name.offset..][0..name.length]) catch continue;
                name.offset = buf_writer_pos;
                buf_writer_pos += name.length;
                name_hash = std.hash.Wyhash.hash(0, buf.items[name.offset..][0..name.length]);
            } else {
                name_hash = std.hash.Wyhash.hash(0, result.rawName(query_string));
                if (std.mem.indexOfScalar(u64, list_slice.items(.name_hash), name_hash)) |index| {
                    name = list_slice.items(.name)[index];
                } else {
                    name.length = PercentEncoding.decode(Writer, writer, query_string[name.offset..][0..name.length]) catch continue;
                    name.offset = buf_writer_pos;
                    buf_writer_pos += name.length;
                }
            }

            value.length = PercentEncoding.decode(Writer, writer, query_string[value.offset..][0..value.length]) catch continue;
            value.offset = buf_writer_pos;
            buf_writer_pos += value.length;

            list.appendAssumeCapacity(Param{ .name = name, .value = value, .name_hash = name_hash });
        }

        buf.expandToCapacity();
        return QueryStringMap{
            .list = list,
            .buffer = buf.items,
            .slice = buf.items[0..buf_writer_pos],
            .allocator = allocator,
        };
    }

    pub fn deinit(this: *QueryStringMap) void {
        if (this.buffer.len > 0) {
            this.allocator.free(this.buffer);
        }

        if (this.list.len > 0) {
            this.list.deinit(this.allocator);
        }
    }
};

pub const PercentEncoding = struct {
    pub fn decode(comptime Writer: type, writer: Writer, input: string) !u32 {
        return @call(.always_inline, decodeFaultTolerant, .{ Writer, writer, input, null, false });
    }

    pub fn decodeFaultTolerant(
        comptime Writer: type,
        writer: Writer,
        input: string,
        needs_redirect: ?*bool,
        comptime fault_tolerant: bool,
    ) !u32 {
        var i: usize = 0;
        var written: u32 = 0;
        // unlike JavaScript's decodeURIComponent, we are not handling invalid surrogate pairs
        // we are assuming the input is valid ascii
        while (i < input.len) {
            switch (input[i]) {
                '%' => {
                    if (comptime fault_tolerant) {
                        if (!(i + 3 <= input.len and strings.isASCIIHexDigit(input[i + 1]) and strings.isASCIIHexDigit(input[i + 2]))) {
                            // i do not feel good about this
                            // create-react-app's public/index.html uses %PUBLIC_URL% in various tags
                            // This is an invalid %-encoded string, intended to be swapped out at build time by webpack-html-plugin
                            // We don't process HTML, so rewriting this URL path won't happen
                            // But we want to be a little more fault tolerant here than just throwing up an error for something that works in other tools
                            // So we just skip over it and issue a redirect
                            // We issue a redirect because various other tooling client-side may validate URLs
                            // We can't expect other tools to be as fault tolerant
                            if (i + "PUBLIC_URL%".len < input.len and strings.eqlComptime(input[i + 1 ..][0.."PUBLIC_URL%".len], "PUBLIC_URL%")) {
                                i += "PUBLIC_URL%".len + 1;
                                needs_redirect.?.* = true;
                                continue;
                            }
                            return error.DecodingError;
                        }
                    } else {
                        if (!(i + 3 <= input.len and strings.isASCIIHexDigit(input[i + 1]) and strings.isASCIIHexDigit(input[i + 2])))
                            return error.DecodingError;
                    }

                    try writer.writeByte((strings.toASCIIHexValue(input[i + 1]) << 4) | strings.toASCIIHexValue(input[i + 2]));
                    i += 3;
                    written += 1;
                    continue;
                },
                else => {
                    const start = i;
                    i += 1;

                    // scan ahead assuming .writeAll is faster than .writeByte one at a time
                    while (i < input.len and input[i] != '%') : (i += 1) {}
                    try writer.writeAll(input[start..i]);
                    written += @truncate(u32, i - start);
                },
            }
        }

        return written;
    }
};

pub const FormData = struct {
    fields: Map,
    buffer: []const u8,

    pub const Map = std.ArrayHashMapUnmanaged(
        bun.Semver.String,
        Field.Entry,
        bun.Semver.String.ArrayHashContext,
        false,
    );

    pub const Encoding = union(enum) {
        URLEncoded: void,
        Multipart: []const u8, // boundary

        pub fn get(content_type: []const u8) ?Encoding {
            if (strings.indexOf(content_type, "application/x-www-form-urlencoded") != null)
                return Encoding{ .URLEncoded = void{} };

            if (strings.indexOf(content_type, "multipart/form-data") == null) return null;

            const boundary = getBoundary(content_type) orelse return null;
            return .{
                .Multipart = boundary,
            };
        }
    };

    pub const AsyncFormData = struct {
        encoding: Encoding,
        allocator: std.mem.Allocator,

        pub fn init(allocator: std.mem.Allocator, encoding: Encoding) !*AsyncFormData {
            var this = try allocator.create(AsyncFormData);
            this.* = AsyncFormData{
                .encoding = switch (encoding) {
                    .Multipart => .{
                        .Multipart = try allocator.dupe(u8, encoding.Multipart),
                    },
                    else => encoding,
                },
                .allocator = allocator,
            };
            return this;
        }

        pub fn deinit(this: *AsyncFormData) void {
            if (this.encoding == .Multipart)
                this.allocator.free(this.encoding.Multipart);
            this.allocator.destroy(this);
        }

        pub fn toJS(this: *AsyncFormData, global: *bun.JSC.JSGlobalObject, data: []const u8, promise: bun.JSC.AnyPromise) void {
            if (this.encoding == .Multipart and this.encoding.Multipart.len == 0) {
                promise.reject(global, bun.JSC.ZigString.init("FormData missing boundary").toErrorInstance(global));
                return;
            }

            const js_value = bun.FormData.toJS(
                global,
                data,
                this.encoding,
            ) catch |err| {
                promise.reject(global, global.createErrorInstance("FormData {s}", .{@errorName(err)}));
                return;
            };

            promise.resolve(global, js_value);
        }
    };

    pub fn getBoundary(content_type: []const u8) ?[]const u8 {
        const boundary_index = strings.indexOf(content_type, "boundary=") orelse return null;
        const boundary_start = boundary_index + "boundary=".len;
        const begin = content_type[boundary_start..];
        if (begin.len == 0)
            return null;

        var boundary_end = strings.indexOfChar(begin, ';') orelse @truncate(u32, begin.len);
        if (begin[0] == '"' and boundary_end > 0 and begin[boundary_end -| 1] == '"') {
            boundary_end -|= 1;
            return begin[1..boundary_end];
        }

        return begin[0..boundary_end];
    }

    pub const Field = struct {
        value: bun.Semver.String = .{},
        filename: bun.Semver.String = .{},
        content_type: bun.Semver.String = .{},
        is_file: bool = false,
        zero_count: u8 = 0,

        pub const Entry = union(enum) {
            field: Field,
            list: bun.BabyList(Field),
        };

        pub const External = extern struct {
            name: bun.JSC.ZigString,
            value: bun.JSC.ZigString,
            blob: ?*bun.JSC.WebCore.Blob = null,
        };
    };

    pub fn toJS(globalThis: *bun.JSC.JSGlobalObject, input: []const u8, encoding: Encoding) !bun.JSC.JSValue {
        switch (encoding) {
            .URLEncoded => {
                var str = bun.JSC.ZigString.fromUTF8(input);
                return bun.JSC.DOMFormData.createFromURLQuery(globalThis, &str);
            },
            .Multipart => |boundary| return toJSFromMultipartData(globalThis, input, boundary),
        }
    }

    pub fn toJSFromMultipartData(
        globalThis: *bun.JSC.JSGlobalObject,
        input: []const u8,
        boundary: []const u8,
    ) !bun.JSC.JSValue {
        const form_data_value = bun.JSC.DOMFormData.create(globalThis);
        form_data_value.ensureStillAlive();
        var form = bun.JSC.DOMFormData.fromJS(form_data_value).?;
        const Wrapper = struct {
            globalThis: *bun.JSC.JSGlobalObject,
            form: *bun.JSC.DOMFormData,

            pub fn onEntry(wrap: *@This(), name: bun.Semver.String, field: Field, buf: []const u8) void {
                var value_str = field.value.slice(buf);
                var key = bun.JSC.ZigString.initUTF8(name.slice(buf));

                if (field.is_file) {
                    var filename_str = field.filename.slice(buf);

                    var blob = bun.JSC.WebCore.Blob.create(value_str, bun.default_allocator, wrap.globalThis, false);
                    defer blob.detach();
                    var filename = bun.JSC.ZigString.initUTF8(filename_str);
                    const content_type: []const u8 = brk: {
                        if (filename_str.len > 0) {
                            if (bun.HTTP.MimeType.byExtensionNoDefault(std.fs.path.extension(filename_str))) |mime| {
                                break :brk mime.value;
                            }
                        }

                        if (bun.HTTP.MimeType.sniff(value_str)) |mime| {
                            break :brk mime.value;
                        }

                        break :brk "";
                    };

                    if (content_type.len > 0) {
                        blob.content_type = content_type;
                        blob.content_type_allocated = false;
                    }

                    wrap.form.appendBlob(wrap.globalThis, &key, &blob, &filename);
                } else {
                    var value = bun.JSC.ZigString.initUTF8(value_str);
                    wrap.form.append(&key, &value);
                }
            }
        };

        {
            var wrap = Wrapper{
                .globalThis = globalThis,
                .form = form,
            };

            try forEachMultipartEntry(input, boundary, *Wrapper, &wrap, Wrapper.onEntry);
        }

        return form_data_value;
    }

    pub fn forEachMultipartEntry(
        input: []const u8,
        boundary: []const u8,
        comptime Ctx: type,
        ctx: Ctx,
        comptime iterator: fn (
            Ctx,
            bun.Semver.String,
            Field,
            string,
        ) void,
    ) !void {
        var slice = input;
        var subslicer = bun.Semver.SlicedString.init(input, input);

        var buf: [76]u8 = undefined;
        {
            const final_boundary = std.fmt.bufPrint(&buf, "--{s}--", .{boundary}) catch |err| {
                if (err == error.NoSpaceLeft) {
                    return error.@"boundary is too long";
                }

                return err;
            };
            const final_boundary_index = strings.lastIndexOf(input, final_boundary);
            if (final_boundary_index == null) {
                return error.@"missing final boundary";
            }
            slice = slice[0..final_boundary_index.?];
        }

        const separator = try std.fmt.bufPrint(&buf, "--{s}\r\n", .{boundary});
        var splitter = strings.split(slice, separator);
        _ = splitter.next(); // skip first boundary

        while (splitter.next()) |chunk| {
            var remain = chunk;
            const header_end = strings.indexOf(remain, "\r\n\r\n") orelse return error.@"is missing header end";
            const header = remain[0 .. header_end + 2];
            remain = remain[header_end + 4 ..];

            var field = Field{};
            var name: bun.Semver.String = .{};
            var filename: ?bun.Semver.String = null;
            var header_chunk = header;
            var is_file = false;
            while (header_chunk.len > 0 and (filename == null or name.len() == 0)) {
                const line_end = strings.indexOf(header_chunk, "\r\n") orelse return error.@"is missing header line end";
                const line = header_chunk[0..line_end];
                header_chunk = header_chunk[line_end + 2 ..];
                const colon = strings.indexOf(line, ":") orelse return error.@"is missing header colon separator";

                const key = line[0..colon];
                var value = if (line.len > colon + 1) line[colon + 1 ..] else "";
                if (strings.eqlCaseInsensitiveASCII(key, "content-disposition", true)) {
                    value = strings.trim(value, " ");
                    if (strings.hasPrefixComptime(value, "form-data;")) {
                        value = value["form-data;".len..];
                        value = strings.trim(value, " ");
                    }

                    while (strings.indexOf(value, "=")) |eql_start| {
                        const eql_key = strings.trim(value[0..eql_start], " ;");
                        value = value[eql_start + 1 ..];
                        if (strings.hasPrefixComptime(value, "\"")) {
                            value = value[1..];
                        }

                        var field_value = value;
                        {
                            var i: usize = 0;
                            while (i < field_value.len) : (i += 1) {
                                switch (field_value[i]) {
                                    '"' => {
                                        field_value = field_value[0..i];
                                        break;
                                    },
                                    '\\' => {
                                        i += @boolToInt(field_value.len > i + 1 and field_value[i + 1] == '"');
                                    },
                                    // the spec requires a end quote, but some browsers don't send it
                                    else => {},
                                }
                            }
                            value = value[@min(i + 1, value.len)..];
                        }

                        if (strings.eqlCaseInsensitiveASCII(eql_key, "name", true)) {
                            name = subslicer.sub(field_value).value();
                        } else if (strings.eqlCaseInsensitiveASCII(eql_key, "filename", true)) {
                            filename = subslicer.sub(field_value).value();
                            is_file = true;
                        }

                        if (!name.isEmpty() and filename != null) {
                            break;
                        }

                        if (strings.indexOfChar(value, ';')) |semi_start| {
                            value = value[semi_start + 1 ..];
                        } else {
                            break;
                        }
                    }
                } else if (value.len > 0 and field.content_type.isEmpty() and strings.eqlCaseInsensitiveASCII(key, "content-type", true)) {
                    field.content_type = subslicer.sub(strings.trim(value, "; \t")).value();
                }
            }

            if (name.len() + @as(usize, field.zero_count) == 0) {
                continue;
            }

            var body = remain;
            if (strings.endsWithComptime(body, "\r\n")) {
                body = body[0 .. body.len - 2];
            }
            field.value = subslicer.sub(body).value();
            field.filename = filename orelse .{};
            field.is_file = is_file;

            iterator(ctx, name, field, input);
        }
    }
};

const ParamsList = @import("./router.zig").Param.List;
pub const CombinedScanner = struct {
    query: Scanner,
    pathname: PathnameScanner,
    pub fn init(query_string: string, pathname: string, routename: string, url_params: *ParamsList) CombinedScanner {
        return CombinedScanner{
            .query = Scanner.init(query_string),
            .pathname = PathnameScanner.init(pathname, routename, url_params),
        };
    }

    pub fn reset(this: *CombinedScanner) void {
        this.query.reset();
        this.pathname.reset();
    }

    pub fn next(this: *CombinedScanner) ?Scanner.Result {
        return this.pathname.next() orelse this.query.next();
    }
};

fn stringPointerFromStrings(parent: string, in: string) Api.StringPointer {
    if (in.len == 0 or parent.len == 0) return Api.StringPointer{};

    if (bun.rangeOfSliceInBuffer(in, parent)) |range| {
        return Api.StringPointer{ .offset = range[0], .length = range[1] };
    } else {
        if (strings.indexOf(parent, in)) |i| {
            if (comptime Environment.allow_assert) {
                std.debug.assert(strings.eqlLong(parent[i..][0..in.len], in, false));
            }

            return Api.StringPointer{
                .offset = @truncate(u32, i),
                .length = @truncate(u32, in.len),
            };
        }
    }

    return Api.StringPointer{};
}

pub const PathnameScanner = struct {
    params: *ParamsList,
    pathname: string,
    routename: string,
    i: usize = 0,

    pub inline fn isDone(this: *const PathnameScanner) bool {
        return this.params.len <= this.i;
    }

    pub fn reset(this: *PathnameScanner) void {
        this.i = 0;
    }

    pub fn init(pathname: string, routename: string, params: *ParamsList) PathnameScanner {
        return PathnameScanner{
            .pathname = pathname,
            .routename = routename,
            .params = params,
        };
    }

    pub fn next(this: *PathnameScanner) ?Scanner.Result {
        if (this.isDone()) {
            return null;
        }

        defer this.i += 1;
        const param = this.params.get(this.i);

        return Scanner.Result{
            // TODO: fix this technical debt
            .name = stringPointerFromStrings(this.routename, param.name),
            .name_needs_decoding = false,
            // TODO: fix this technical debt
            .value = stringPointerFromStrings(this.pathname, param.value),
            .value_needs_decoding = strings.containsChar(param.value, '%'),
        };
    }
};

pub const Scanner = struct {
    query_string: string,
    i: usize,
    start: usize = 0,

    pub fn init(query_string: string) Scanner {
        if (query_string.len > 0 and query_string[0] == '?') {
            return Scanner{ .query_string = query_string, .i = 1, .start = 1 };
        }

        return Scanner{ .query_string = query_string, .i = 0, .start = 0 };
    }

    pub inline fn reset(this: *Scanner) void {
        this.i = this.start;
    }

    pub const Result = struct {
        name_needs_decoding: bool = false,
        value_needs_decoding: bool = false,
        name: Api.StringPointer,
        value: Api.StringPointer,

        pub inline fn rawName(this: *const Result, query_string: string) string {
            return if (this.name.length > 0) query_string[this.name.offset..][0..this.name.length] else "";
        }

        pub inline fn rawValue(this: *const Result, query_string: string) string {
            return if (this.value.length > 0) query_string[this.value.offset..][0..this.value.length] else "";
        }
    };

    /// Get the next query string parameter without allocating memory.
    pub fn next(this: *Scanner) ?Result {
        var relative_i: usize = 0;
        defer this.i += relative_i;

        // reuse stack space
        // otherwise we'd recursively call the function
        loop: while (true) {
            if (this.i >= this.query_string.len) return null;

            var slice = this.query_string[this.i..];
            relative_i = 0;
            var name = Api.StringPointer{ .offset = @truncate(u32, this.i), .length = 0 };
            var value = Api.StringPointer{ .offset = 0, .length = 0 };
            var name_needs_decoding = false;

            while (relative_i < slice.len) {
                const char = slice[relative_i];
                switch (char) {
                    '=' => {
                        name.length = @truncate(u32, relative_i);
                        relative_i += 1;

                        value.offset = @truncate(u32, relative_i + this.i);

                        const offset = relative_i;
                        var value_needs_decoding = false;
                        while (relative_i < slice.len and slice[relative_i] != '&') : (relative_i += 1) {
                            value_needs_decoding = value_needs_decoding or switch (slice[relative_i]) {
                                '%', '+' => true,
                                else => false,
                            };
                        }
                        value.length = @truncate(u32, relative_i - offset);
                        // If the name is empty and it's just a value, skip it.
                        // This is kind of an opinion. But, it's hard to see where that might be intentional.
                        if (name.length == 0) return null;
                        return Result{ .name = name, .value = value, .name_needs_decoding = name_needs_decoding, .value_needs_decoding = value_needs_decoding };
                    },
                    '%', '+' => {
                        name_needs_decoding = true;
                    },
                    '&' => {
                        // key&
                        if (relative_i > 0) {
                            name.length = @truncate(u32, relative_i);
                            return Result{ .name = name, .value = value, .name_needs_decoding = name_needs_decoding, .value_needs_decoding = false };
                        }

                        // &&&&&&&&&&&&&key=value
                        while (relative_i < slice.len and slice[relative_i] == '&') : (relative_i += 1) {}
                        this.i += relative_i;

                        // reuse stack space
                        continue :loop;
                    },
                    else => {},
                }

                relative_i += 1;
            }

            if (relative_i == 0) {
                return null;
            }

            name.length = @truncate(u32, relative_i);
            return Result{ .name = name, .value = value, .name_needs_decoding = name_needs_decoding };
        }
    }
};

const expect = std.testing.expect;
const expectString = std.testing.expectEqualStrings;
test "Scanner.init" {
    var scanner = Scanner.init("?hello=true");
    try expect(scanner.i == 1);
    scanner = Scanner.init("hello=true");
    try expect(scanner.i == 0);
}

test "Scanner.next" {
    var scanner = Scanner.init("?hello=true&welcome=to&the=what&is=this&1=100&&&&bacon&&&&what=true&ok&=100");
    var result: Scanner.Result = undefined;
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "hello");
    try expectString(result.rawValue(scanner.query_string), "true");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "welcome");
    try expectString(result.rawValue(scanner.query_string), "to");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "the");
    try expectString(result.rawValue(scanner.query_string), "what");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "is");
    try expectString(result.rawValue(scanner.query_string), "this");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "1");
    try expectString(result.rawValue(scanner.query_string), "100");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "bacon");
    try expectString(result.rawValue(scanner.query_string), "");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "what");
    try expectString(result.rawValue(scanner.query_string), "true");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "ok");
    try expectString(result.rawValue(scanner.query_string), "");
    try expect(scanner.next() == null);
}

test "Scanner.next - % encoded" {
    var scanner = Scanner.init("?foo%20=%201023%20&%20what%20the%20fuck%20=%20am%20i%20looking%20at");
    var result: Scanner.Result = undefined;
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding);
    try expect(result.value_needs_decoding);
    try expectString(result.rawName(scanner.query_string), "foo%20");
    try expectString(result.rawValue(scanner.query_string), "%201023%20");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding);
    try expect(result.value_needs_decoding);
    try expectString(result.rawName(scanner.query_string), "%20what%20the%20fuck%20");
    try expectString(result.rawValue(scanner.query_string), "%20am%20i%20looking%20at");
    try expect(scanner.next() == null);
}

test "PercentEncoding.decode" {
    var buffer: [4096]u8 = undefined;
    std.mem.set(u8, &buffer, 0);

    var stream = std.io.fixedBufferStream(&buffer);
    var writer = stream.writer();
    const Writer = @TypeOf(writer);

    {
        const written = try PercentEncoding.decode(Writer, writer, "hello%20world%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B");
        const correct = "hello world + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + +";
        try expect(written == correct.len);
        try expectString(buffer[0..written], correct);
    }

    stream.reset();

    {
        const correct = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        const written = try PercentEncoding.decode(Writer, writer, correct);
        try expect(written == correct.len);
        try expectString(buffer[0..written], correct);
    }

    stream.reset();

    {
        const correct = "hello my name is ?????";
        const written = try PercentEncoding.decode(Writer, writer, correct);
        try expect(written == correct.len);
        try expectString(buffer[0..written], correct);
    }
}

test "QueryStringMap (full)" {

    // This is copy pasted from a random twitter thread on Chrome
    const url = "?cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&dm_users=false&include_groups=true&include_inbox_timelines=true&include_ext_media_color=true&supports_reactions=true&muting_enabled=false&nsfw_filtering_enabled=false&cursor=GRwmkMCq6fLUnMAnFpDAquny1JzAJyUAAAA&filter_low_quality=true&include_quality=all&ext=mediaColor&ext=altText&ext=mediaStats&ext=highlightedLabel&ext=voiceInfo";
    // from chrome's devtools
    const fixture = .{
        .cards_platform = "Web-12",
        .include_cards = "1",
        .include_ext_alt_text = "true",
        .include_quote_count = "true",
        .include_reply_count = "1",
        .tweet_mode = "extended",
        .dm_users = "false",
        .include_groups = "true",
        .include_inbox_timelines = "true",
        .include_ext_media_color = "true",
        .supports_reactions = "true",
        .muting_enabled = "false",
        .nsfw_filtering_enabled = "false",
        .cursor = "GRwmkMCq6fLUnMAnFpDAquny1JzAJyUAAAA",
        .filter_low_quality = "true",
        .include_quality = "all",
        .ext = &[_]string{ "mediaColor", "altText", "mediaStats", "highlightedLabel", "voiceInfo" },
    };

    var map = (try QueryStringMap.init(std.testing.allocator, url)) orelse return try std.testing.expect(false);
    defer map.deinit();
    try expectString(fixture.cards_platform, map.get("cards_platform").?);
    try expectString(fixture.include_cards, map.get("include_cards").?);
    try expectString(fixture.include_ext_alt_text, map.get("include_ext_alt_text").?);
    try expectString(fixture.include_quote_count, map.get("include_quote_count").?);
    try expectString(fixture.include_reply_count, map.get("include_reply_count").?);
    try expectString(fixture.tweet_mode, map.get("tweet_mode").?);
    try expectString(fixture.dm_users, map.get("dm_users").?);
    try expectString(fixture.include_groups, map.get("include_groups").?);
    try expectString(fixture.include_inbox_timelines, map.get("include_inbox_timelines").?);
    try expectString(fixture.include_ext_media_color, map.get("include_ext_media_color").?);
    try expectString(fixture.supports_reactions, map.get("supports_reactions").?);
    try expectString(fixture.muting_enabled, map.get("muting_enabled").?);
    try expectString(fixture.nsfw_filtering_enabled, map.get("nsfw_filtering_enabled").?);
    try expectString(fixture.cursor, map.get("cursor").?);
    try expectString(fixture.filter_low_quality, map.get("filter_low_quality").?);
    try expectString(fixture.include_quality, map.get("include_quality").?);
    try expectString(fixture.ext[0], map.get("ext").?);

    var target: [fixture.ext.len]string = undefined;
    try expect((map.getAll("ext", &target)) == fixture.ext.len);

    for (target, 0..) |item, i| {
        try expectString(
            fixture.ext[i],
            item,
        );
    }
}

test "QueryStringMap not encoded" {
    const url = "?hey=1&wow=true";
    const fixture = .{
        .hey = "1",
        .wow = "true",
    };
    const url_slice = bun.asByteSlice(url);
    var map = (try QueryStringMap.init(std.testing.allocator, url_slice)) orelse return try std.testing.expect(false);
    try expect(map.buffer.len == 0);
    try expect(url_slice.ptr == map.slice.ptr);
    defer map.deinit();
    try expectString(fixture.hey, map.get("hey").?);
    try expectString(fixture.wow, map.get("wow").?);
}
const expectEqual = std.testing.expectEqual;
test "QueryStringMap Iterator" {
    // This is copy pasted from a random twitter thread on Chrome
    // The only difference from the one above is "ext" is moved before the last one
    // This is to test order of iteration
    const url = "?cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&dm_users=false&include_groups=true&include_inbox_timelines=true&include_ext_media_color=true&supports_reactions=true&muting_enabled=false&nsfw_filtering_enabled=false&cursor=GRwmkMCq6fLUnMAnFpDAquny1JzAJyUAAAA&filter_low_quality=true&ext=voiceInfo&include_quality=all&ext=mediaColor&ext=altText&ext=mediaStats&ext=highlightedLabel";
    // from chrome's devtools
    const fixture = .{
        .cards_platform = "Web-12",
        .include_cards = "1",
        .include_ext_alt_text = "true",
        .include_quote_count = "true",
        .include_reply_count = "1",
        .tweet_mode = "extended",
        .dm_users = "false",
        .include_groups = "true",
        .include_inbox_timelines = "true",
        .include_ext_media_color = "true",
        .supports_reactions = "true",
        .muting_enabled = "false",
        .nsfw_filtering_enabled = "false",
        .cursor = "GRwmkMCq6fLUnMAnFpDAquny1JzAJyUAAAA",
        .filter_low_quality = "true",
        .include_quality = "all",
        .ext = &[_]string{
            "voiceInfo",
            "mediaColor",
            "altText",
            "mediaStats",
            "highlightedLabel",
        },
    };

    var map = (try QueryStringMap.init(std.testing.allocator, url)) orelse return try std.testing.expect(false);
    defer map.deinit();
    var buf_: [48]string = undefined;
    var buf = buf_[0..48];
    var iter = map.iter();

    var result: QueryStringMap.Iterator.Result = iter.next(buf) orelse return try expect(false);
    try expectString("cards_platform", result.name);
    try expectString(fixture.cards_platform, result.values[0]);
    try expectEqual(result.values.len, 1);

    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_cards", result.name);
    try expectString(fixture.include_cards, result.values[0]);
    try expectEqual(result.values.len, 1);

    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_ext_alt_text", result.name);
    try expectString(fixture.include_ext_alt_text, result.values[0]);
    try expectEqual(result.values.len, 1);

    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_quote_count", result.name);
    try expectString(fixture.include_quote_count, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_reply_count", result.name);
    try expectString(fixture.include_reply_count, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("tweet_mode", result.name);
    try expectString(fixture.tweet_mode, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("dm_users", result.name);
    try expectString(fixture.dm_users, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_groups", result.name);
    try expectString(fixture.include_groups, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_inbox_timelines", result.name);
    try expectString(fixture.include_inbox_timelines, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_ext_media_color", result.name);
    try expectString(fixture.include_ext_media_color, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("supports_reactions", result.name);
    try expectString(fixture.supports_reactions, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("muting_enabled", result.name);
    try expectString(fixture.muting_enabled, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("nsfw_filtering_enabled", result.name);
    try expectString(fixture.nsfw_filtering_enabled, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("cursor", result.name);
    try expectString(fixture.cursor, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("filter_low_quality", result.name);
    try expectString(fixture.filter_low_quality, result.values[0]);
    try expectEqual(result.values.len, 1);

    result = iter.next(buf) orelse return try expect(false);
    try expectString("ext", result.name);
    try expectEqual(result.values.len, fixture.ext.len);
    for (fixture.ext, 0..) |ext, i| {
        try expectString(ext, result.values[i]);
    }

    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_quality", result.name);
    try expectString(fixture.include_quality, result.values[0]);
    try expectEqual(result.values.len, 1);

    try expect(iter.next(buf) == null);
}

test "URL - parse" {
    var url: URL = undefined;

    url = URL.parse("https://url.spec.whatwg.org/foo#include-credentials");
    try expectString("https", url.protocol);
    try expectString("url.spec.whatwg.org", url.host);
    try expectString("/foo", url.pathname);
    try expectString("#include-credentials", url.hash);

    url = URL.parse("https://url.spec.whatwg.org/#include-credentials");
    try expectString("https", url.protocol);
    try expectString("url.spec.whatwg.org", url.host);
    try expectString("/", url.pathname);
    try expectString("#include-credentials", url.hash);

    url = URL.parse("://url.spec.whatwg.org/#include-credentials");
    try expectString("", url.protocol);
    try expectString("url.spec.whatwg.org", url.host);
    try expectString("/", url.pathname);
    try expectString("#include-credentials", url.hash);

    url = URL.parse("/#include-credentials");
    try expectString("", url.protocol);
    try expectString("", url.host);
    try expectString("/", url.pathname);
    try expectString("#include-credentials", url.hash);

    url = URL.parse("https://username:password@url.spec.whatwg.org/#include-credentials");
    try expectString("https", url.protocol);
    try expectString("username", url.username);
    try expectString("password", url.password);
    try expectString("url.spec.whatwg.org", url.host);
    try expectString("/", url.pathname);
    try expectString("#include-credentials", url.hash);

    url = URL.parse("https://username:password@url.spec.whatwg.org:3000/#include-credentials");
    try expectString("https", url.protocol);
    try expectString("username", url.username);
    try expectString("password", url.password);
    try expectString("url.spec.whatwg.org:3000", url.host);
    try expectString("3000", url.port);
    try expectString("/", url.pathname);
    try expectString("#include-credentials", url.hash);

    url = URL.parse("example.com/#include-credentials");
    try expectString("", url.protocol);
    try expectString("", url.username);
    try expectString("", url.password);
    try expectString("example.com", url.host);
    try expectString("/", url.pathname);
    try expectString("#include-credentials", url.hash);

    url = URL.parse("example.com:8080/#include-credentials");
    try expectString("", url.protocol);
    try expectString("", url.username);
    try expectString("", url.password);
    try expectString("example.com:8080", url.host);
    try expectString("example.com", url.hostname);
    try expectString("8080", url.port);
    try expectString("/", url.pathname);
    try expectString("#include-credentials", url.hash);

    url = URL.parse("/src/index");
    try expectString("", url.protocol);
    try expectString("", url.username);
    try expectString("", url.password);
    try expectString("", url.host);
    try expectString("", url.hostname);
    try expectString("", url.port);
    try expectString("/src/index", url.path);
    try expectString("/src/index", url.pathname);

    try expectString("", url.hash);
    try expectString("", url.search);

    url = URL.parse("http://localhost:3000/");
    try expectString("http", url.protocol);
    try expectString("", url.username);
    try expectString("", url.password);
    try expectString("localhost:3000", url.host);
    try expectString("localhost", url.hostname);
    try expectString("3000", url.port);
    try expectString("/", url.path);
    try expectString("/", url.pathname);

    url = URL.parse("https://covid19.who.int/WHO-COVID-19-global-data.csv");
    try expectString("https", url.protocol);
    try expectString("", url.username);
    try expectString("", url.password);
    try expectString("covid19.who.int", url.host);
    try expectString("covid19.who.int", url.hostname);
    // try expectString("443", url.port);
    try expectString("/WHO-COVID-19-global-data.csv", url.path);
    try expectString("/WHO-COVID-19-global-data.csv", url.pathname);

    url = URL.parse("http://localhost:3000/@/example");
    try expectString("http", url.protocol);
    try expectString("", url.username);
    try expectString("", url.password);
    try expectString("localhost:3000", url.host);
    try expectString("localhost", url.hostname);
    try expectString("3000", url.port);
    try expectString("/@/example", url.path);
    try expectString("/@/example", url.pathname);

    url = URL.parse("http://admin:password@localhost:3000/@/example");
    try expectString("http", url.protocol);
    try expectString("admin", url.username);
    try expectString("password", url.password);
    try expectString("localhost:3000", url.host);
    try expectString("localhost", url.hostname);
    try expectString("3000", url.port);
    try expectString("/@/example", url.path);
    try expectString("/@/example", url.pathname);

    url = URL.parse("http://0.0.0.0:3000/@/example");
    try expectString("http", url.protocol);
    try expectString("", url.username);
    try expectString("", url.password);
    try expectString("0.0.0.0:3000", url.host);
    try expectString("0.0.0.0", url.hostname);
    try expectString("3000", url.port);
    try expectString("/@/example", url.path);
    try expectString("/@/example", url.pathname);

    url = URL.parse("http://admin:password@0.0.0.0:3000/@/example");
    try expectString("http", url.protocol);
    try expectString("admin", url.username);
    try expectString("password", url.password);
    try expectString("0.0.0.0:3000", url.host);
    try expectString("0.0.0.0", url.hostname);
    try expectString("3000", url.port);
    try expectString("/@/example", url.path);
    try expectString("/@/example", url.pathname);

    url = URL.parse("http://admin:password@0.0.0.0:3000");
    try expectString("http", url.protocol);
    try expectString("admin", url.username);
    try expectString("password", url.password);
    try expectString("0.0.0.0:3000", url.host);
    try expectString("0.0.0.0", url.hostname);
    try expectString("3000", url.port);

    url = URL.parse("http://admin:password@0.0.0.0:3000/");
    try expectString("http", url.protocol);
    try expectString("admin", url.username);
    try expectString("password", url.password);
    try expectString("0.0.0.0:3000", url.host);
    try expectString("0.0.0.0", url.hostname);
    try expectString("3000", url.port);

    url = URL.parse("http://admin:password@0.0.0.0:3000/@bacon");
    try expectString("http", url.protocol);
    try expectString("admin", url.username);
    try expectString("password", url.password);
    try expectString("0.0.0.0:3000", url.host);
    try expectString("0.0.0.0", url.hostname);
    try expectString("3000", url.port);
    try expectString("/@bacon", url.pathname);
}

test "URL - joinAlloc" {
    var url = URL.parse("http://localhost:3000");

    var absolute_url = try url.joinAlloc(default_allocator, "/_next/", "src/components", "button", ".js", "");
    try expectString(
        "http://localhost:3000/_next/src/components/button.js",
        absolute_url,
    );

    absolute_url = try url.joinAlloc(default_allocator, "compiled-", "src/components", "button", ".js", "");
    try expectString(
        "http://localhost:3000/compiled-src/components/button.js",
        absolute_url,
    );

    absolute_url = try url.joinAlloc(default_allocator, "compiled-", "", "button", ".js", "");
    try expectString("http://localhost:3000/compiled-button.js", absolute_url);
}
