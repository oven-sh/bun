const std = @import("std");
const logger = @import("root").bun.logger;
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const CodePoint = bun.CodePoint;
const C = bun.C;
const CodepointIterator = @import("./string_immutable.zig").CodepointIterator;
const Analytics = @import("./analytics/analytics_thread.zig");
const Fs = @import("./fs.zig");
const URL = @import("./url.zig").URL;
const Api = @import("./api/schema.zig").Api;
const which = @import("./which.zig").which;

pub const Loader = struct {
    map: *Map,
    allocator: std.mem.Allocator,

    @".env.local": ?logger.Source = null,
    @".env.development": ?logger.Source = null,
    @".env.production": ?logger.Source = null,
    @".env.test": ?logger.Source = null,
    @".env.development.local": ?logger.Source = null,
    @".env.production.local": ?logger.Source = null,
    @".env.test.local": ?logger.Source = null,
    @".env": ?logger.Source = null,

    quiet: bool = false,

    did_load_process: bool = false,

    const empty_string_value: string = "\"\"";

    pub fn isProduction(this: *const Loader) bool {
        const env = this.map.get("BUN_ENV") orelse this.map.get("NODE_ENV") orelse return false;
        return strings.eqlComptime(env, "production");
    }

    pub fn getNodePath(this: *Loader, fs: *Fs.FileSystem, buf: *Fs.PathBuffer) ?[:0]const u8 {
        if (this.get("NODE") orelse this.get("npm_node_execpath")) |node| {
            @memcpy(buf[0..node.len], node);
            buf[node.len] = 0;
            return buf[0..node.len :0];
        }

        if (which(buf, this.map.get("PATH") orelse return null, fs.top_level_dir, "node")) |node| {
            return node;
        }

        return null;
    }

    pub fn isCI(this: *const Loader) bool {
        return (this.map.get("CI") orelse
            this.map.get("TDDIUM") orelse
            this.map.get("JENKINS_URL") orelse
            this.map.get("bamboo.buildKey")) != null;
    }

    pub fn loadTracy(this: *const Loader) void {
        tracy: {
            if (this.get("BUN_TRACY") != null) {
                if (!bun.tracy.init()) {
                    Output.prettyErrorln("Failed to load Tracy. Is it installed in your include path?", .{});
                    Output.flush();
                    break :tracy;
                }

                bun.tracy.start();

                if (!bun.tracy.isConnected()) {
                    std.time.sleep(std.time.ns_per_ms * 10);
                }

                if (!bun.tracy.isConnected()) {
                    Output.prettyErrorln("Tracy is not connected. Is Tracy running on your computer?", .{});
                    Output.flush();
                    break :tracy;
                }
            }
        }
    }

    pub fn getHttpProxy(this: *Loader, url: URL) ?URL {
        // TODO: When Web Worker support is added, make sure to intern these strings
        var http_proxy: ?URL = null;

        if (url.isHTTP()) {
            if (this.map.get("http_proxy") orelse this.map.get("HTTP_PROXY")) |proxy| {
                if (proxy.len > 0) http_proxy = URL.parse(proxy);
            }
        } else {
            if (this.map.get("https_proxy") orelse this.map.get("HTTPS_PROXY")) |proxy| {
                if (proxy.len > 0) http_proxy = URL.parse(proxy);
            }
        }

        // NO_PROXY filter
        if (http_proxy != null) {
            if (this.map.get("no_proxy") orelse this.map.get("NO_PROXY")) |no_proxy_text| {
                if (no_proxy_text.len == 0) return http_proxy;

                var no_proxy_list = std.mem.split(u8, no_proxy_text, ",");
                var next = no_proxy_list.next();
                while (next != null) {
                    var host = next.?;
                    if (strings.eql(host, "*")) {
                        return null;
                    }
                    //strips .
                    if (host[0] == '.') {
                        host = host[1.. :0];
                    }
                    //hostname ends with suffix
                    if (strings.endsWith(url.hostname, host)) {
                        return null;
                    }
                    next = no_proxy_list.next();
                }
            }
        }
        return http_proxy;
    }
    pub fn loadNodeJSConfig(this: *Loader, fs: *Fs.FileSystem, override_node: []const u8) !bool {
        var buf: Fs.PathBuffer = undefined;

        var node_path_to_use = override_node;
        if (node_path_to_use.len == 0) {
            var node = this.getNodePath(fs, &buf) orelse return false;
            node_path_to_use = try fs.dirname_store.append([]const u8, bun.asByteSlice(node));
        }
        try this.map.put("NODE", node_path_to_use);
        try this.map.put("npm_node_execpath", node_path_to_use);
        return true;
    }

    pub fn get(this: *const Loader, key: string) ?string {
        var _key = key;
        if (_key.len > 0 and _key[0] == '$') {
            _key = key[1..];
        }

        if (_key.len == 0) return null;

        return this.map.get(_key);
    }

    pub fn getAuto(this: *const Loader, key: string) string {
        return this.get(key) orelse key;
    }

    /// Load values from the environment into Define.
    ///
    /// If there is a framework, values from the framework are inserted with a
    /// **lower priority** so that users may override defaults. Unlike regular
    /// defines, environment variables are loaded as JavaScript string literals.
    ///
    /// Empty enivronment variables become empty strings.
    pub fn copyForDefine(
        this: *Loader,
        comptime JSONStore: type,
        to_json: *JSONStore,
        comptime StringStore: type,
        to_string: *StringStore,
        framework_defaults: Api.StringMap,
        behavior: Api.DotEnvBehavior,
        prefix: string,
        allocator: std.mem.Allocator,
    ) ![]u8 {
        var iter = this.map.iter();
        var key_count: usize = 0;
        var string_map_hashes = try allocator.alloc(u64, framework_defaults.keys.len);
        defer allocator.free(string_map_hashes);
        const invalid_hash = std.math.maxInt(u64) - 1;
        @memset(string_map_hashes, invalid_hash);

        var key_buf: []u8 = "";
        // Frameworks determine an allowlist of values

        for (framework_defaults.keys, 0..) |key, i| {
            if (key.len > "process.env.".len and strings.eqlComptime(key[0.."process.env.".len], "process.env.")) {
                const hashable_segment = key["process.env.".len..];
                string_map_hashes[i] = bun.hash(hashable_segment);
            }
        }

        // We have to copy all the keys to prepend "process.env" :/
        var key_buf_len: usize = 0;
        var e_strings_to_allocate: usize = 0;

        if (behavior != .disable) {
            if (behavior == .prefix) {
                std.debug.assert(prefix.len > 0);

                while (iter.next()) |entry| {
                    if (strings.startsWith(entry.key_ptr.*, prefix)) {
                        key_buf_len += entry.key_ptr.len;
                        key_count += 1;
                        e_strings_to_allocate += 1;
                        std.debug.assert(entry.key_ptr.len > 0);
                    }
                }
            } else {
                while (iter.next()) |entry| {
                    if (entry.key_ptr.len > 0) {
                        key_buf_len += entry.key_ptr.len;
                        key_count += 1;
                        e_strings_to_allocate += 1;

                        std.debug.assert(entry.key_ptr.len > 0);
                    }
                }
            }

            if (key_buf_len > 0) {
                iter.reset();
                key_buf = try allocator.alloc(u8, key_buf_len + key_count * "process.env.".len);
                const js_ast = bun.JSAst;

                var e_strings = try allocator.alloc(js_ast.E.String, e_strings_to_allocate * 2);
                errdefer allocator.free(e_strings);
                errdefer allocator.free(key_buf);
                var key_fixed_allocator = std.heap.FixedBufferAllocator.init(key_buf);
                var key_allocator = key_fixed_allocator.allocator();

                if (behavior == .prefix) {
                    while (iter.next()) |entry| {
                        const value: string = entry.value_ptr.*;

                        if (strings.startsWith(entry.key_ptr.*, prefix)) {
                            const key_str = std.fmt.allocPrint(key_allocator, "process.env.{s}", .{entry.key_ptr.*}) catch unreachable;

                            e_strings[0] = js_ast.E.String{
                                .data = if (value.len > 0)
                                    @as([*]u8, @ptrFromInt(@intFromPtr(value.ptr)))[0..value.len]
                                else
                                    &[_]u8{},
                            };
                            var expr_data = js_ast.Expr.Data{ .e_string = &e_strings[0] };

                            _ = try to_string.getOrPutValue(
                                key_str,
                                .{
                                    .can_be_removed_if_unused = true,
                                    .call_can_be_unwrapped_if_unused = true,
                                    .value = expr_data,
                                },
                            );
                            e_strings = e_strings[1..];
                        } else {
                            const hash = bun.hash(entry.key_ptr.*);

                            std.debug.assert(hash != invalid_hash);

                            if (std.mem.indexOfScalar(u64, string_map_hashes, hash)) |key_i| {
                                e_strings[0] = js_ast.E.String{
                                    .data = if (value.len > 0)
                                        @as([*]u8, @ptrFromInt(@intFromPtr(value.ptr)))[0..value.len]
                                    else
                                        &[_]u8{},
                                };

                                var expr_data = js_ast.Expr.Data{ .e_string = &e_strings[0] };

                                _ = try to_string.getOrPutValue(
                                    framework_defaults.keys[key_i],
                                    .{
                                        .can_be_removed_if_unused = true,
                                        .call_can_be_unwrapped_if_unused = true,
                                        .value = expr_data,
                                    },
                                );
                                e_strings = e_strings[1..];
                            }
                        }
                    }
                } else {
                    while (iter.next()) |entry| {
                        const value: string = if (entry.value_ptr.*.len == 0) empty_string_value else entry.value_ptr.*;
                        const key = std.fmt.allocPrint(key_allocator, "process.env.{s}", .{entry.key_ptr.*}) catch unreachable;

                        e_strings[0] = js_ast.E.String{
                            .data = if (entry.value_ptr.*.len > 0)
                                @as([*]u8, @ptrFromInt(@intFromPtr(entry.value_ptr.*.ptr)))[0..value.len]
                            else
                                &[_]u8{},
                        };

                        var expr_data = js_ast.Expr.Data{ .e_string = &e_strings[0] };

                        _ = try to_string.getOrPutValue(
                            key,
                            .{
                                .can_be_removed_if_unused = true,
                                .call_can_be_unwrapped_if_unused = true,
                                .value = expr_data,
                            },
                        );
                        e_strings = e_strings[1..];
                    }
                }
            }
        }

        for (framework_defaults.keys, 0..) |key, i| {
            var value = framework_defaults.values[i];

            if (!to_string.contains(key) and !to_json.contains(key)) {
                _ = try to_json.getOrPutValue(key, value);
            }
        }

        return key_buf;
    }

    pub fn init(map: *Map, allocator: std.mem.Allocator) Loader {
        return Loader{
            .map = map,
            .allocator = allocator,
        };
    }

    pub fn loadProcess(this: *Loader) void {
        if (this.did_load_process) return;

        // This is a little weird because it's evidently stored line-by-line
        var source = logger.Source.initPathString("process.env", "");

        this.map.map.ensureTotalCapacity(std.os.environ.len) catch unreachable;
        for (std.os.environ) |env| {
            source.contents = bun.span(env);
            Parser.parse(&source, this.allocator, this.map, true, true);
        }
        this.did_load_process = true;

        if (this.map.get("HOME")) |home_folder| {
            Analytics.username_only_for_determining_project_id_and_never_sent = home_folder;
        } else if (this.map.get("USER")) |home_folder| {
            Analytics.username_only_for_determining_project_id_and_never_sent = home_folder;
        }
    }

    // mostly for tests
    pub fn loadFromString(this: *Loader, str: string, comptime overwrite: bool) void {
        var source = logger.Source.initPathString("test", str);
        Parser.parse(&source, this.allocator, this.map, overwrite, false);
        std.mem.doNotOptimizeAway(&source);
    }

    // .env.local goes first
    // Load .env.development if development
    // Load .env.production if !development
    // .env goes last
    pub fn load(
        this: *Loader,
        fs: *Fs.FileSystem.RealFS,
        dir: *Fs.FileSystem.DirEntry,
        comptime suffix: enum { development, production, @"test" },
    ) !void {
        const start = std.time.nanoTimestamp();
        var dir_handle: std.fs.Dir = std.fs.cwd();

        switch (comptime suffix) {
            .development => {
                if (dir.hasComptimeQuery(".env.development.local")) {
                    try this.loadEnvFile(fs, dir_handle, ".env.development.local", false);
                    Analytics.Features.dotenv = true;
                }
            },
            .production => {
                if (dir.hasComptimeQuery(".env.production.local")) {
                    try this.loadEnvFile(fs, dir_handle, ".env.production.local", false);
                    Analytics.Features.dotenv = true;
                }
            },
            .@"test" => {
                if (dir.hasComptimeQuery(".env.test.local")) {
                    try this.loadEnvFile(fs, dir_handle, ".env.test.local", false);
                    Analytics.Features.dotenv = true;
                }
            },
        }

        if (comptime suffix != .@"test") {
            if (dir.hasComptimeQuery(".env.local")) {
                try this.loadEnvFile(fs, dir_handle, ".env.local", false);
                Analytics.Features.dotenv = true;
            }
        }

        switch (comptime suffix) {
            .development => {
                if (dir.hasComptimeQuery(".env.development")) {
                    try this.loadEnvFile(fs, dir_handle, ".env.development", false);
                    Analytics.Features.dotenv = true;
                }
            },
            .production => {
                if (dir.hasComptimeQuery(".env.production")) {
                    try this.loadEnvFile(fs, dir_handle, ".env.production", false);
                    Analytics.Features.dotenv = true;
                }
            },
            .@"test" => {
                if (dir.hasComptimeQuery(".env.test")) {
                    try this.loadEnvFile(fs, dir_handle, ".env.test", false);
                    Analytics.Features.dotenv = true;
                }
            },
        }

        if (dir.hasComptimeQuery(".env")) {
            try this.loadEnvFile(fs, dir_handle, ".env", false);
            Analytics.Features.dotenv = true;
        }

        if (!this.quiet) this.printLoaded(start);
    }

    pub fn printLoaded(this: *Loader, start: i128) void {
        const count =
            @as(u8, @intCast(@intFromBool(this.@".env.development.local" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.production.local" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.test.local" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.local" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.development" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.production" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.test" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env" != null)));

        if (count == 0) return;
        const elapsed = @as(f64, @floatFromInt((std.time.nanoTimestamp() - start))) / std.time.ns_per_ms;

        const all = [_]string{
            ".env.development.local",
            ".env.production.local",
            ".env.test.local",
            ".env.local",
            ".env.development",
            ".env.production",
            ".env.test",
            ".env",
        };
        const loaded = [_]bool{
            this.@".env.development.local" != null,
            this.@".env.production.local" != null,
            this.@".env.test.local" != null,
            this.@".env.local" != null,
            this.@".env.development" != null,
            this.@".env.production" != null,
            this.@".env.test" != null,
            this.@".env" != null,
        };

        var loaded_i: u8 = 0;
        Output.printElapsed(elapsed);
        Output.prettyError(" <d>", .{});

        for (loaded, 0..) |yes, i| {
            if (yes) {
                loaded_i += 1;
                if (count == 1 or (loaded_i >= count and count > 1)) {
                    Output.prettyError("\"{s}\"", .{all[i]});
                } else {
                    Output.prettyError("\"{s}\", ", .{all[i]});
                }
            }
        }
        Output.prettyErrorln("<r>\n", .{});
        Output.flush();
    }

    pub fn loadEnvFile(this: *Loader, fs: *Fs.FileSystem.RealFS, dir: std.fs.Dir, comptime base: string, comptime override: bool) !void {
        _ = fs;
        if (@field(this, base) != null) {
            return;
        }

        var file = dir.openFile(base, .{ .mode = .read_only }) catch |err| {
            switch (err) {
                error.FileNotFound => {
                    // prevent retrying
                    @field(this, base) = logger.Source.initPathString(base, "");
                    return;
                },
                error.FileBusy, error.DeviceBusy, error.AccessDenied, error.IsDir => {
                    if (!this.quiet) {
                        Output.prettyErrorln("<r><red>{s}<r> error loading {s} file", .{ @errorName(err), base });
                    }

                    // prevent retrying
                    @field(this, base) = logger.Source.initPathString(base, "");
                    return;
                },
                else => {
                    return err;
                },
            }
        };
        defer file.close();

        const stat = try file.stat();
        const end = stat.size;

        if (end == 0) {
            @field(this, base) = logger.Source.initPathString(base, "");
            return;
        }

        var buf = try this.allocator.alloc(u8, end + 1);
        errdefer this.allocator.free(buf);
        const amount_read = try file.readAll(buf[0..end]);

        // The null byte here is mostly for debugging purposes.
        buf[end] = 0;

        const source = logger.Source.initPathString(base, buf[0..amount_read]);

        Parser.parse(
            &source,
            this.allocator,
            this.map,
            override,
            false,
        );

        @field(this, base) = source;
    }
};

const Parser = struct {
    pos: usize = 0,
    src: string,

    const whitespace_chars = "\t\x0B\x0C \xA0\n\r";
    // You get 4k. I hope you don't need more than that.
    threadlocal var value_buffer: [4096]u8 = undefined;

    fn skipLine(this: *Parser) void {
        if (strings.indexOfAny(this.src[this.pos..], "\n\r")) |i| {
            this.pos += i + 1;
        } else {
            this.pos = this.src.len;
        }
    }

    fn skipWhitespaces(this: *Parser) void {
        var i = this.pos;
        while (i < this.src.len) : (i += 1) {
            if (strings.indexOfChar(whitespace_chars, this.src[i]) == null) break;
        }
        this.pos = i;
    }

    fn parseKey(this: *Parser, comptime check_export: bool) ?string {
        if (comptime check_export) this.skipWhitespaces();
        const start = this.pos;
        var end = start;
        while (end < this.src.len) : (end += 1) {
            switch (this.src[end]) {
                'a'...'z', 'A'...'Z', '0'...'9', '_', '-', '.' => continue,
                else => break,
            }
        }
        if (end < this.src.len and start < end) {
            this.pos = end;
            this.skipWhitespaces();
            if (this.pos < this.src.len) {
                if (comptime check_export) {
                    if (end < this.pos and strings.eqlComptime(this.src[start..end], "export")) {
                        if (this.parseKey(false)) |key| return key;
                    }
                }
                switch (this.src[this.pos]) {
                    '=' => {
                        this.pos += 1;
                        return this.src[start..end];
                    },
                    ':' => {
                        const next = this.pos + 1;
                        if (next < this.src.len and strings.indexOfChar(whitespace_chars, this.src[next]) != null) {
                            this.pos += 2;
                            return this.src[start..end];
                        }
                    },
                    else => {},
                }
            }
        }
        this.pos = start;
        return null;
    }

    fn parseQuoted(this: *Parser, comptime quote: u8) ?string {
        if (comptime Environment.allow_assert) std.debug.assert(this.src[this.pos] == quote);
        const start = this.pos;
        var end = start + 1;
        while (end < this.src.len) : (end += 1) {
            switch (this.src[end]) {
                '\\' => end += 1,
                quote => {
                    end += 1;
                    this.pos = end;
                    this.skipWhitespaces();
                    if (this.pos >= this.src.len or
                        this.src[this.pos] == '#' or
                        strings.indexOfChar(this.src[end..this.pos], '\n') != null or
                        strings.indexOfChar(this.src[end..this.pos], '\r') != null)
                    {
                        var ptr: usize = 0;
                        var i = start;
                        while (i < end) {
                            switch (this.src[i]) {
                                '\\' => if (comptime quote == '"') {
                                    if (comptime Environment.allow_assert) std.debug.assert(i + 1 < end);
                                    switch (this.src[i + 1]) {
                                        'n' => {
                                            value_buffer[ptr] = '\n';
                                            ptr += 1;
                                            i += 1;
                                        },
                                        'r' => {
                                            value_buffer[ptr] = '\r';
                                            ptr += 1;
                                            i += 1;
                                        },
                                        else => {
                                            value_buffer[ptr] = this.src[i];
                                            value_buffer[ptr + 1] = this.src[i + 1];
                                            ptr += 2;
                                            i += 2;
                                        },
                                    }
                                } else {
                                    value_buffer[ptr] = '\\';
                                    ptr += 1;
                                    i += 1;
                                },
                                '\r' => {
                                    i += 1;
                                    if (i >= end or this.src[i] != '\n') {
                                        value_buffer[ptr] = '\n';
                                        ptr += 1;
                                    }
                                },
                                else => |c| {
                                    value_buffer[ptr] = c;
                                    ptr += 1;
                                    i += 1;
                                },
                            }
                        }
                        return value_buffer[0..ptr];
                    }
                    this.pos = start;
                },
                else => {},
            }
        }
        return null;
    }

    fn parseValue(this: *Parser, comptime is_process: bool) string {
        const start = this.pos;
        this.skipWhitespaces();
        var end = this.pos;
        if (end >= this.src.len) return this.src[this.src.len..];
        switch (this.src[end]) {
            inline '`', '"', '\'' => |quote| {
                if (this.parseQuoted(quote)) |value| {
                    return if (comptime is_process) value else value[1 .. value.len - 1];
                }
            },
            else => {},
        }
        end = start;
        while (end < this.src.len) : (end += 1) {
            switch (this.src[end]) {
                '#', '\r', '\n' => break,
                else => {},
            }
        }
        this.pos = end;
        return strings.trim(this.src[start..end], whitespace_chars);
    }

    inline fn writeBackwards(ptr: usize, bytes: []const u8) usize {
        const end = ptr;
        const start = end - bytes.len;
        bun.copy(u8, value_buffer[start..end], bytes);
        return start;
    }

    fn expandValue(map: *Map, value: string) ?string {
        if (value.len < 2) return null;
        var ptr = value_buffer.len;
        var pos = value.len - 2;
        var last = value.len;
        while (true) : (pos -= 1) {
            if (value[pos] == '$') {
                if (pos > 0 and value[pos - 1] == '\\') {
                    ptr = writeBackwards(ptr, value[pos..last]);
                    pos -= 1;
                } else {
                    var end = if (value[pos + 1] == '{') pos + 2 else pos + 1;
                    const key_start = end;
                    while (end < value.len) : (end += 1) {
                        switch (value[end]) {
                            'a'...'z', 'A'...'Z', '0'...'9', '_' => continue,
                            else => break,
                        }
                    }
                    const lookup_value = map.get(value[key_start..end]);
                    const default_value = if (strings.hasPrefixComptime(value[end..], ":-")) brk: {
                        end += ":-".len;
                        const value_start = end;
                        while (end < value.len) : (end += 1) {
                            switch (value[end]) {
                                '}', '\\' => break,
                                else => continue,
                            }
                        }
                        break :brk value[value_start..end];
                    } else "";
                    if (end < value.len and value[end] == '}') end += 1;
                    ptr = writeBackwards(ptr, value[end..last]);
                    ptr = writeBackwards(ptr, lookup_value orelse default_value);
                }
                last = pos;
            }
            if (pos == 0) {
                if (last == value.len) return null;
                break;
            }
        }
        if (last > 0) ptr = writeBackwards(ptr, value[0..last]);
        return value_buffer[ptr..];
    }

    fn _parse(
        this: *Parser,
        allocator: std.mem.Allocator,
        map: *Map,
        comptime override: bool,
        comptime is_process: bool,
    ) void {
        var count = map.map.count();
        while (this.pos < this.src.len) {
            const key = this.parseKey(true) orelse {
                this.skipLine();
                continue;
            };
            const value = this.parseValue(is_process);
            var entry = map.map.getOrPut(key) catch unreachable;
            if (entry.found_existing) {
                if (entry.index < count) {
                    // Allow keys defined later in the same file to override keys defined earlier
                    // https://github.com/oven-sh/bun/issues/1262
                    if (comptime !override) continue;
                } else {
                    allocator.free(entry.value_ptr.*);
                }
            }
            entry.value_ptr.* = allocator.dupe(u8, value) catch unreachable;
        }
        if (comptime !is_process) {
            var it = map.iter();
            while (it.next()) |entry| {
                if (count > 0) {
                    count -= 1;
                } else if (expandValue(map, entry.value_ptr.*)) |value| {
                    allocator.free(entry.value_ptr.*);
                    entry.value_ptr.* = allocator.dupe(u8, value) catch unreachable;
                }
            }
        }
    }

    pub fn parse(
        source: *const logger.Source,
        allocator: std.mem.Allocator,
        map: *Map,
        comptime override: bool,
        comptime is_process: bool,
    ) void {
        var parser = Parser{ .src = source.contents };
        parser._parse(allocator, map, override, is_process);
    }
};

pub const Map = struct {
    const HashTable = bun.StringArrayHashMap(string);

    map: HashTable,

    pub fn createNullDelimitedEnvMap(this: *Map, arena: std.mem.Allocator) ![:null]?[*:0]u8 {
        var env_map = &this.map;

        const envp_count = env_map.count();
        const envp_buf = try arena.allocSentinel(?[*:0]u8, envp_count, null);
        {
            var it = env_map.iterator();
            var i: usize = 0;
            while (it.next()) |pair| : (i += 1) {
                const env_buf = try arena.allocSentinel(u8, pair.key_ptr.len + pair.value_ptr.len + 1, 0);
                bun.copy(u8, env_buf, pair.key_ptr.*);
                env_buf[pair.key_ptr.len] = '=';
                bun.copy(u8, env_buf[pair.key_ptr.len + 1 ..], pair.value_ptr.*);
                envp_buf[i] = env_buf.ptr;
            }
            std.debug.assert(i == envp_count);
        }
        return envp_buf;
    }

    pub fn cloneToEnvMap(this: *Map, allocator: std.mem.Allocator) !std.process.EnvMap {
        var env_map = std.process.EnvMap.init(allocator);

        var iter_ = this.map.iterator();
        while (iter_.next()) |entry| {
            try env_map.putMove(bun.constStrToU8(entry.key_ptr.*), bun.constStrToU8(entry.value_ptr.*));
        }

        return env_map;
    }

    pub inline fn init(allocator: std.mem.Allocator) Map {
        return Map{ .map = HashTable.init(allocator) };
    }

    pub inline fn iter(this: *Map) HashTable.Iterator {
        return this.map.iterator();
    }

    pub inline fn put(this: *Map, key: string, value: string) !void {
        try this.map.put(key, value);
    }

    pub fn jsonStringify(self: *const @This(), options: anytype, writer: anytype) !void {
        var iterator = self.map.iterator();

        _ = try writer.writeAll("{");
        while (iterator.next()) |entry| {
            _ = try writer.writeAll("\n    ");

            std.json.stringify(entry.key_ptr.*, options, writer) catch unreachable;

            _ = try writer.writeAll(": ");

            std.json.stringify(entry.value_ptr.*, options, writer) catch unreachable;

            if (iterator.index <= self.map.count() - 1) {
                _ = try writer.writeAll(", ");
            }
        }

        try writer.writeAll("\n}");
    }

    pub inline fn get(
        this: *const Map,
        key: string,
    ) ?string {
        return this.map.get(key);
    }

    pub fn get_(
        this: *const Map,
        key: string,
    ) ?string {
        return this.map.get(key);
    }

    pub inline fn putDefault(this: *Map, key: string, value: string) !void {
        _ = try this.map.getOrPutValue(key, value);
    }

    pub inline fn getOrPut(this: *Map, key: string, value: string) !void {
        _ = try this.map.getOrPutValue(key, value);
    }
};

pub var instance: ?*Loader = null;

const expectString = std.testing.expectEqualStrings;
const expect = std.testing.expect;
test "DotEnv Loader - basic" {
    const VALID_ENV =
        \\API_KEY=verysecure
        \\process.env.WAT=ABCDEFGHIJKLMNOPQRSTUVWXYZZ10239457123
        \\DOUBLE-QUOTED_SHOULD_PRESERVE_NEWLINES="
        \\ya
        \\"
        \\DOUBLE_QUOTES_ESCAPABLE="\"yoooo\""
        \\SINGLE_QUOTED_SHOULDNT_PRESERVE_NEWLINES='yo
        \\'
        \\
        \\SINGLE_QUOTED_DOESNT_PRESERVES_QUOTES='yo'
        \\
        \\# Line Comment
        \\UNQUOTED_SHOULDNT_PRESERVE_NEWLINES_AND_TRIMS_TRAILING_SPACE=yo # Inline Comment
        \\
        \\      LEADING_SPACE_IS_TRIMMED=yes
        \\
        \\LEADING_SPACE_IN_UNQUOTED_VALUE_IS_TRIMMED=        yes
        \\
        \\SPACE_BEFORE_EQUALS_SIGN    =yes
        \\
        \\LINES_WITHOUT_EQUAL_ARE_IGNORED
        \\
        \\NO_VALUE_IS_EMPTY_STRING=
        \\LINES_WITHOUT_EQUAL_ARE_IGNORED
        \\
        \\IGNORING_DOESNT_BREAK_OTHER_LINES='yes'
        \\
        \\NESTED_VALUE='$API_KEY'
        \\
        \\NESTED_VALUE_WITH_CURLY_BRACES='${API_KEY}'
        \\NESTED_VALUE_WITHOUT_OPENING_CURLY_BRACE='$API_KEY}'
        \\
        \\RECURSIVE_NESTED_VALUE=$NESTED_VALUE:$API_KEY
        \\
        \\RECURSIVE_NESTED_VALUE_WITH_CURLY_BRACES=${NESTED_VALUE}:${API_KEY}
        \\
        \\NESTED_VALUES_RESPECT_ESCAPING='\$API_KEY'
        \\
        \\NESTED_VALUES_WITH_CURLY_BRACES_RESPECT_ESCAPING='\${API_KEY}'
        \\
        \\EMPTY_SINGLE_QUOTED_VALUE_IS_EMPTY_STRING=''
        \\
        \\EMPTY_DOUBLE_QUOTED_VALUE_IS_EMPTY_STRING=""
        \\
        \\VALUE_WITH_MULTIPLE_VALUES_SET_IN_SAME_FILE=''
        \\
        \\VALUE_WITH_MULTIPLE_VALUES_SET_IN_SAME_FILE='good'
        \\
    ;
    const source = logger.Source.initPathString(".env", VALID_ENV);
    var map = Map.init(default_allocator);
    inline for (.{ true, false }) |override| {
        Parser.parse(
            &source,
            default_allocator,
            &map,
            override,
            false,
        );
        try expectString(map.get("NESTED_VALUES_RESPECT_ESCAPING").?, "\\$API_KEY");
        try expectString(map.get("NESTED_VALUES_WITH_CURLY_BRACES_RESPECT_ESCAPING").?, "\\${API_KEY}");

        try expectString(map.get("NESTED_VALUE").?, "verysecure");
        try expectString(map.get("NESTED_VALUE_WITH_CURLY_BRACES").?, "verysecure");
        try expectString(map.get("NESTED_VALUE_WITHOUT_OPENING_CURLY_BRACE").?, "verysecure}");
        try expectString(map.get("RECURSIVE_NESTED_VALUE").?, "verysecure:verysecure");
        try expectString(map.get("RECURSIVE_NESTED_VALUE_WITH_CURLY_BRACES").?, "verysecure:verysecure");

        try expectString(map.get("API_KEY").?, "verysecure");
        try expectString(map.get("process.env.WAT").?, "ABCDEFGHIJKLMNOPQRSTUVWXYZZ10239457123");
        try expectString(map.get("DOUBLE-QUOTED_SHOULD_PRESERVE_NEWLINES").?, "\nya\n");
        try expectString(map.get("SINGLE_QUOTED_SHOULDNT_PRESERVE_NEWLINES").?, "yo");
        try expectString(map.get("SINGLE_QUOTED_DOESNT_PRESERVES_QUOTES").?, "yo");
        try expectString(map.get("UNQUOTED_SHOULDNT_PRESERVE_NEWLINES_AND_TRIMS_TRAILING_SPACE").?, "yo");
        try expect(map.get("LINES_WITHOUT_EQUAL_ARE_IGNORED") == null);
        try expectString(map.get("LEADING_SPACE_IS_TRIMMED").?, "yes");
        try expect(map.get("NO_VALUE_IS_EMPTY_STRING").?.len == 0);
        try expectString(map.get("IGNORING_DOESNT_BREAK_OTHER_LINES").?, "yes");
        try expectString(map.get("LEADING_SPACE_IN_UNQUOTED_VALUE_IS_TRIMMED").?, "yes");
        try expectString(map.get("SPACE_BEFORE_EQUALS_SIGN").?, "yes");
        try expectString(map.get("EMPTY_SINGLE_QUOTED_VALUE_IS_EMPTY_STRING").?, "");
        try expectString(map.get("EMPTY_DOUBLE_QUOTED_VALUE_IS_EMPTY_STRING").?, "");
        try expectString(map.get("VALUE_WITH_MULTIPLE_VALUES_SET_IN_SAME_FILE").?, "good");
    }
}

test "DotEnv Loader - Nested values with curly braces" {
    const VALID_ENV =
        \\DB_USER=postgres
        \\DB_PASS=xyz
        \\DB_HOST=localhost
        \\DB_PORT=5432
        \\DB_NAME=db
        \\
        \\DB_USER2=${DB_USER}
        \\
        \\DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?pool_timeout=30&connection_limit=22"
        \\
    ;
    const source = logger.Source.initPathString(".env", VALID_ENV);
    var map = Map.init(default_allocator);
    Parser.parse(
        &source,
        default_allocator,
        &map,
        true,
        false,
    );
    try expectString(map.get("DB_USER").?, "postgres");
    try expectString(map.get("DB_USER2").?, "postgres");
    try expectString(map.get("DATABASE_URL").?, "postgresql://postgres:xyz@localhost:5432/db?pool_timeout=30&connection_limit=22");
}

test "DotEnv Process" {
    var map = Map.init(default_allocator);
    var process = try std.process.getEnvMap(default_allocator);
    var loader = Loader.init(&map, default_allocator);
    loader.loadProcess();

    try expectString(loader.map.get("TMPDIR").?, bun.getenvZ("TMPDIR").?);
    try expect(loader.map.get("TMPDIR").?.len > 0);

    try expectString(loader.map.get("USER").?, process.get("USER").?);
    try expect(loader.map.get("USER").?.len > 0);
    try expectString(loader.map.get("HOME").?, process.get("HOME").?);
    try expect(loader.map.get("HOME").?.len > 0);
}

test "DotEnv Loader - copyForDefine" {
    const UserDefine = bun.StringArrayHashMap(string);
    const UserDefinesArray = @import("./defines.zig").UserDefinesArray;
    var map = Map.init(default_allocator);
    var loader = Loader.init(&map, default_allocator);
    const framework_keys = [_]string{ "process.env.BACON", "process.env.HOSTNAME" };
    const framework_values = [_]string{ "true", "\"localhost\"" };
    const framework = Api.StringMap{
        .keys = framework_keys[0..],
        .value = framework_values[0..],
    };

    const user_overrides: string =
        \\BACON=false
        \\HOSTNAME=example.com
        \\THIS_SHOULDNT_BE_IN_DEFINES_MAP=true
        \\
    ;

    const skip_user_overrides: string =
        \\THIS_SHOULDNT_BE_IN_DEFINES_MAP=true
        \\
    ;

    loader.loadFromString(skip_user_overrides, false);

    var user_defines = UserDefine.init(default_allocator);
    var env_defines = UserDefinesArray.init(default_allocator);
    var buf = try loader.copyForDefine(UserDefine, &user_defines, UserDefinesArray, &env_defines, framework, .disable, "", default_allocator);

    try expect(user_defines.get("process.env.THIS_SHOULDNT_BE_IN_DEFINES_MAP") == null);

    user_defines = UserDefine.init(default_allocator);
    env_defines = UserDefinesArray.init(default_allocator);

    loader.loadFromString(user_overrides, true);

    buf = try loader.copyForDefine(
        UserDefine,
        &user_defines,
        UserDefinesArray,
        &env_defines,
        framework,
        Api.DotEnvBehavior.load_all,
        "",
        default_allocator,
    );

    try expect(env_defines.get("process.env.BACON") != null);
    try expectString(env_defines.get("process.env.BACON").?.value.e_string.data, "false");
    try expectString(env_defines.get("process.env.HOSTNAME").?.value.e_string.data, "example.com");
    try expect(env_defines.get("process.env.THIS_SHOULDNT_BE_IN_DEFINES_MAP") != null);

    user_defines = UserDefine.init(default_allocator);
    env_defines = UserDefinesArray.init(default_allocator);

    buf = try loader.copyForDefine(UserDefine, &user_defines, UserDefinesArray, &env_defines, framework, .prefix, "HO", default_allocator);

    try expectString(env_defines.get("process.env.HOSTNAME").?.value.e_string.data, "example.com");
    try expect(env_defines.get("process.env.THIS_SHOULDNT_BE_IN_DEFINES_MAP") == null);
}
