const std = @import("std");
const Api = @import("./api/schema.zig").Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const JSC = bun.JSC;

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

    pub fn isFile(this: *const URL) bool {
        return strings.eqlComptime(this.protocol, "file");
    }

    pub fn isBlob(this: *const URL) bool {
        return this.href.len == JSC.WebCore.ObjectURLRegistry.specifier_len and strings.hasPrefixComptime(this.href, "blob:");
    }

    pub fn fromJS(js_value: JSC.JSValue, globalObject: *JSC.JSGlobalObject, allocator: std.mem.Allocator) !URL {
        var href = JSC.URL.hrefFromJS(globalObject, js_value);
        if (href.tag == .Dead) {
            return error.InvalidURL;
        }

        return URL.parse(try href.toOwnedSlice(allocator));
    }

    pub fn fromString(allocator: std.mem.Allocator, input: bun.String) !URL {
        var href = JSC.URL.hrefFromString(input);
        if (href.tag == .Dead) {
            return error.InvalidURL;
        }

        defer href.deref();
        return URL.parse(try href.toOwnedSlice(allocator));
    }

    pub fn fromUTF8(allocator: std.mem.Allocator, input: []const u8) !URL {
        return fromString(allocator, bun.String.fromUTF8(input));
    }

    pub fn isLocalhost(this: *const URL) bool {
        return this.hostname.len == 0 or strings.eqlComptime(this.hostname, "localhost") or strings.eqlComptime(this.hostname, "0.0.0.0");
    }

    pub inline fn isUnix(this: *const URL) bool {
        return strings.hasPrefixComptime(this.protocol, "unix");
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

    pub inline fn isS3(this: *const URL) bool {
        return strings.eqlComptime(this.protocol, "s3");
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

    pub fn s3Path(this: *const URL) string {
        // we need to remove protocol if exists and ignore searchParams, should be host + pathname
        const href = if (this.protocol.len > 0 and this.href.len > this.protocol.len + 2) this.href[this.protocol.len + 2 ..] else this.href;
        return href[0 .. href.len - (this.search.len + this.hash.len)];
    }

    pub fn displayHost(this: *const URL) bun.fmt.HostFormatter {
        return bun.fmt.HostFormatter{
            .host = if (this.host.len > 0) this.host else this.displayHostname(),
            .port = if (this.port.len > 0) this.getPort() else null,
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
        return (this.getPort() orelse 0) > 0;
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

    pub fn parse(base: string) URL {
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
            offset += @as(u31, @intCast(q));
            url.path = base[path_offset..][0..q];
            can_update_path = false;
            url.search = base[offset..];
        }

        if (strings.indexOfChar(base[offset..], '#')) |hash| {
            offset += @as(u31, @intCast(hash));
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
                url.pathname = base[path_offset..@min(
                    @min(offset + url.search.len, base.len),
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
                url.path = url.path[@min(
                    @max(@intFromPtr(trimmed.ptr) - @intFromPtr(url.path.ptr), 1) - 1,
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

        while (url.pathname.len > 1 and @as(u16, @bitCast(url.pathname[0..2].*)) == comptime std.mem.readInt(u16, "//", .little)) {
            url.pathname = url.pathname[1..];
        }

        url.origin = std.mem.trim(u8, url.origin, "/ ?#");
        return url;
    }

    pub fn parseProtocol(url: *URL, str: string) ?u31 {
        if (str.len < "://".len) return null;
        for (0..str.len) |i| {
            switch (str[i]) {
                '/', '?', '%' => {
                    return null;
                },
                ':' => {
                    if (i + 3 <= str.len and str[i + 1] == '/' and str[i + 2] == '/') {
                        url.protocol = str[0..i];
                        return @intCast(i + 3);
                    }
                },
                else => {},
            }
        }

        return null;
    }

    pub fn parseUsername(url: *URL, str: string) ?u31 {
        // reset it
        url.username = "";

        if (str.len < "@".len) return null;
        for (0..str.len) |i| {
            switch (str[i]) {
                ':', '@' => {
                    // we found a username, everything before this point in the slice is a username
                    url.username = str[0..i];
                    return @intCast(i + 1);
                },
                // if we reach a slash or "?", there's no username
                '?', '/' => {
                    return null;
                },
                else => {},
            }
        }
        return null;
    }

    pub fn parsePassword(url: *URL, str: string) ?u31 {
        // reset it
        url.password = "";

        if (str.len < "@".len) return null;
        for (0..str.len) |i| {
            switch (str[i]) {
                '@' => {
                    // we found a password, everything before this point in the slice is a password
                    url.password = str[0..i];
                    if (Environment.allow_assert) bun.assert(str[i..].len < 2 or std.mem.readInt(u16, str[i..][0..2], .little) != std.mem.readInt(u16, "//", .little));
                    return @intCast(i + 1);
                },
                // if we reach a slash or "?", there's no password
                '?', '/' => {
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
                    // alright, we found the slash or "?"
                    '?', '/' => {
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

            // look for the first "/" or "?"
            // if we have a slash or "?", anything before that is the host
            // anything before the colon is the hostname
            // anything after the colon but before the slash is the port
            // the origin is the scheme before the slash

            var colon_i: ?u31 = null;
            while (i < str.len) : (i += 1) {
                colon_i = if (colon_i == null and str[i] == ':') i else colon_i;

                switch (str[i]) {
                    // alright, we found the slash or "?"
                    '?', '/' => {
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
        const VisitedMap = bun.bit_set.ArrayBitSet(usize, 2048);

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
            bun.assert(name_slice.length > 0);
            var result = Result{ .name = this.map.str(name_slice), .values = target[0..1] };
            target[0] = this.map.str(slice.items(.value)[this.i]);

            this.visited.set(this.i);
            this.i += 1;

            var remainder_hashes = slice.items(.name_hash)[this.i..];
            const remainder_values = slice.items(.value)[this.i..];

            var target_i: usize = 1;
            var current_i: usize = 0;

            while (std.mem.indexOfScalar(u64, remainder_hashes[current_i..], hash)) |next_index| {
                const real_i = current_i + next_index + this.i;
                if (comptime Environment.isDebug) {
                    bun.assert(!this.visited.isSet(real_i));
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
        const hash = bun.hash(input);
        return std.mem.indexOfScalar(u64, this.list.items(.name_hash), hash);
    }

    pub fn get(this: *const QueryStringMap, input: string) ?string {
        const hash = bun.hash(input);
        const _slice = this.list.slice();
        const i = std.mem.indexOfScalar(u64, _slice.items(.name_hash), hash) orelse return null;
        return this.str(_slice.items(.value)[i]);
    }

    pub fn has(this: *const QueryStringMap, input: string) bool {
        return this.getIndex(input) != null;
    }

    pub fn getAll(this: *const QueryStringMap, input: string, target: []string) usize {
        const hash = bun.hash(input);
        const _slice = this.list.slice();
        return @call(bun.callmod_inline, getAllWithHashFromOffset, .{ this, target, hash, 0, _slice });
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
            bun.assert(count > 0); // We should not call initWithScanner when there are no path params

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

            name.length = @as(u32, @truncate(name_slice.len));
            name.offset = buf_writer_pos;
            try writer.writeAll(name_slice);
            buf_writer_pos += @as(u32, @truncate(name_slice.len));

            const name_hash: u64 = bun.hash(name_slice);

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
                name_hash = bun.hash(buf.items[name.offset..][0..name.length]);
            } else {
                name_hash = bun.hash(result.rawName(scanner.query.query_string));
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
                if (Environment.allow_assert) bun.assert(!result.name_needs_decoding);
                if (Environment.allow_assert) bun.assert(!result.value_needs_decoding);

                const name = result.name;
                const value = result.value;
                const name_hash: u64 = bun.hash(result.rawName(query_string));
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
        const writer = buf.writer();
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
                name_hash = bun.hash(buf.items[name.offset..][0..name.length]);
            } else {
                name_hash = bun.hash(result.rawName(query_string));
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
        return @call(bun.callmod_inline, decodeFaultTolerant, .{ Writer, writer, input, null, false });
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
                    written += @as(u32, @truncate(i - start));
                },
            }
        }

        return written;
    }
};

pub const FormData = struct {
    fields: Map,
    buffer: []const u8,
    const log = Output.scoped(.FormData, false);

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
                return Encoding{ .URLEncoded = {} };

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
            const this = try allocator.create(AsyncFormData);
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

        pub fn toJS(this: *AsyncFormData, global: *JSC.JSGlobalObject, data: []const u8, promise: JSC.AnyPromise) void {
            if (this.encoding == .Multipart and this.encoding.Multipart.len == 0) {
                log("AsnycFormData.toJS -> promise.reject missing boundary", .{});
                promise.reject(global, JSC.ZigString.init("FormData missing boundary").toErrorInstance(global));
                return;
            }

            const js_value = bun.FormData.toJS(
                global,
                data,
                this.encoding,
            ) catch |err| {
                log("AsnycFormData.toJS -> failed ", .{});
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

        var boundary_end = strings.indexOfChar(begin, ';') orelse @as(u32, @truncate(begin.len));
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
            name: JSC.ZigString,
            value: JSC.ZigString,
            blob: ?*JSC.WebCore.Blob = null,
        };
    };

    pub fn toJS(globalThis: *JSC.JSGlobalObject, input: []const u8, encoding: Encoding) !JSC.JSValue {
        switch (encoding) {
            .URLEncoded => {
                var str = JSC.ZigString.fromUTF8(strings.withoutUTF8BOM(input));
                return JSC.DOMFormData.createFromURLQuery(globalThis, &str);
            },
            .Multipart => |boundary| return toJSFromMultipartData(globalThis, input, boundary),
        }
    }

    pub fn fromMultipartData(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        JSC.markBinding(@src());

        const args_ = callframe.arguments_old(2);

        const args = args_.ptr[0..2];

        const input_value = args[0];
        const boundary_value = args[1];
        var boundary_slice = JSC.ZigString.Slice.empty;
        defer boundary_slice.deinit();

        var encoding = Encoding{
            .URLEncoded = {},
        };

        if (input_value.isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArguments("input must not be empty", .{});
        }

        if (!boundary_value.isEmptyOrUndefinedOrNull()) {
            if (boundary_value.asArrayBuffer(globalThis)) |array_buffer| {
                if (array_buffer.byteSlice().len > 0)
                    encoding = .{ .Multipart = array_buffer.byteSlice() };
            } else if (boundary_value.isString()) {
                boundary_slice = try boundary_value.toSliceOrNull(globalThis);
                if (boundary_slice.len > 0) {
                    encoding = .{ .Multipart = boundary_slice.slice() };
                }
            } else {
                return globalThis.throwInvalidArguments("boundary must be a string or ArrayBufferView", .{});
            }
        }
        var input_slice = JSC.ZigString.Slice{};
        defer input_slice.deinit();
        var input: []const u8 = "";

        if (input_value.asArrayBuffer(globalThis)) |array_buffer| {
            input = array_buffer.byteSlice();
        } else if (input_value.isString()) {
            input_slice = try input_value.toSliceOrNull(globalThis);
            input = input_slice.slice();
        } else if (input_value.as(JSC.WebCore.Blob)) |blob| {
            input = blob.sharedView();
        } else {
            return globalThis.throwInvalidArguments("input must be a string or ArrayBufferView", .{});
        }

        return FormData.toJS(globalThis, input, encoding) catch |err| return globalThis.throwError(err, "while parsing FormData");
    }

    comptime {
        const jsFunctionFromMultipartData = JSC.toJSHostFunction(fromMultipartData);
        if (!JSC.is_bindgen)
            @export(jsFunctionFromMultipartData, .{ .name = "FormData__jsFunctionFromMultipartData" });
    }

    pub fn toJSFromMultipartData(
        globalThis: *JSC.JSGlobalObject,
        input: []const u8,
        boundary: []const u8,
    ) !JSC.JSValue {
        const form_data_value = JSC.DOMFormData.create(globalThis);
        form_data_value.ensureStillAlive();
        const form = JSC.DOMFormData.fromJS(form_data_value) orelse {
            log("failed to create DOMFormData.fromJS", .{});
            return error.@"failed to parse multipart data";
        };
        const Wrapper = struct {
            globalThis: *JSC.JSGlobalObject,
            form: *JSC.DOMFormData,

            pub fn onEntry(wrap: *@This(), name: bun.Semver.String, field: Field, buf: []const u8) void {
                const value_str = field.value.slice(buf);
                var key = JSC.ZigString.initUTF8(name.slice(buf));

                if (field.is_file) {
                    const filename_str = field.filename.slice(buf);

                    var blob = JSC.WebCore.Blob.create(value_str, bun.default_allocator, wrap.globalThis, false);
                    defer blob.detach();
                    var filename = JSC.ZigString.initUTF8(filename_str);
                    const content_type: []const u8 = brk: {
                        if (!field.content_type.isEmpty()) {
                            break :brk field.content_type.slice(buf);
                        }
                        if (filename_str.len > 0) {
                            const extension = std.fs.path.extension(filename_str);
                            if (extension.len > 0) {
                                if (bun.http.MimeType.byExtensionNoDefault(extension[1..extension.len])) |mime| {
                                    break :brk mime.value;
                                }
                            }
                        }

                        if (bun.http.MimeType.sniff(value_str)) |mime| {
                            break :brk mime.value;
                        }

                        break :brk "";
                    };

                    if (content_type.len > 0) {
                        if (!field.content_type.isEmpty()) {
                            blob.content_type_allocated = true;
                            blob.content_type = bun.default_allocator.dupe(u8, content_type) catch @panic("failed to allocate memory for blob content type");
                            blob.content_type_was_set = true;
                        } else {
                            blob.content_type = content_type;
                            blob.content_type_was_set = false;
                            blob.content_type_allocated = false;
                        }
                    }

                    wrap.form.appendBlob(wrap.globalThis, &key, &blob, &filename);
                } else {
                    var value = JSC.ZigString.initUTF8(
                        // > Each part whose `Content-Disposition` header does not
                        // > contain a `filename` parameter must be parsed into an
                        // > entry whose value is the UTF-8 decoded without BOM
                        // > content of the part. This is done regardless of the
                        // > presence or the value of a `Content-Type` header and
                        // > regardless of the presence or the value of a
                        // > `charset` parameter.
                        strings.withoutUTF8BOM(value_str),
                    );
                    wrap.form.append(&key, &value);
                }
            }
        };

        {
            var wrap = Wrapper{
                .globalThis = globalThis,
                .form = form,
            };

            forEachMultipartEntry(input, boundary, *Wrapper, &wrap, Wrapper.onEntry) catch |err| {
                log("failed to parse multipart data", .{});
                return err;
            };
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
                                        i += @intFromBool(field_value.len > i + 1 and field_value[i + 1] == '"');
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
                bun.assert(strings.eqlLong(parent[i..][0..in.len], in, false));
            }

            return Api.StringPointer{
                .offset = @as(u32, @truncate(i)),
                .length = @as(u32, @truncate(in.len)),
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

            const slice = this.query_string[this.i..];
            relative_i = 0;
            var name = Api.StringPointer{ .offset = @as(u32, @truncate(this.i)), .length = 0 };
            var value = Api.StringPointer{ .offset = 0, .length = 0 };
            var name_needs_decoding = false;

            while (relative_i < slice.len) {
                const char = slice[relative_i];
                switch (char) {
                    '=' => {
                        name.length = @as(u32, @truncate(relative_i));
                        relative_i += 1;

                        value.offset = @as(u32, @truncate(relative_i + this.i));

                        const offset = relative_i;
                        var value_needs_decoding = false;
                        while (relative_i < slice.len and slice[relative_i] != '&') : (relative_i += 1) {
                            value_needs_decoding = value_needs_decoding or switch (slice[relative_i]) {
                                '%', '+' => true,
                                else => false,
                            };
                        }
                        value.length = @as(u32, @truncate(relative_i - offset));
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
                            name.length = @as(u32, @truncate(relative_i));
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

            name.length = @as(u32, @truncate(relative_i));
            return Result{ .name = name, .value = value, .name_needs_decoding = name_needs_decoding };
        }
    }
};

const expect = std.testing.expect;
const expectString = std.testing.expectEqualStrings;
const expectEqual = std.testing.expectEqual;
