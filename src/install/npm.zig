const URL = @import("../url.zig").URL;
const bun = @import("root").bun;
const std = @import("std");
const MutableString = @import("../string_mutable.zig").MutableString;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const PackageManager = @import("./install.zig").PackageManager;
const ExternalStringMap = @import("./install.zig").ExternalStringMap;
const ExternalPackageNameHashList = bun.install.ExternalPackageNameHashList;
const PackageNameHash = bun.install.PackageNameHash;
const ExternalStringList = @import("./install.zig").ExternalStringList;
const ExternalSlice = @import("./install.zig").ExternalSlice;
const initializeStore = @import("./install.zig").initializeMiniStore;
const logger = bun.logger;
const Output = bun.Output;
const Integrity = @import("./integrity.zig").Integrity;
const Bin = @import("./bin.zig").Bin;
const Environment = bun.Environment;
const Aligner = @import("./install.zig").Aligner;
const HTTPClient = bun.http;
const JSON = bun.JSON;
const default_allocator = bun.default_allocator;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const SlicedString = Semver.SlicedString;
const FileSystem = @import("../fs.zig").FileSystem;
const Dependency = @import("./dependency.zig");
const VersionedURL = @import("./versioned_url.zig");
const VersionSlice = @import("./install.zig").VersionSlice;
const ObjectPool = @import("../pool.zig").ObjectPool;
const Api = @import("../api/schema.zig").Api;
const DotEnv = @import("../env_loader.zig");
const http = bun.http;
const OOM = bun.OOM;
const Global = bun.Global;
const PublishCommand = bun.CLI.PublishCommand;
const File = bun.sys.File;

const Npm = @This();

const WhoamiError = OOM || error{
    NeedAuth,
    ProbablyInvalidAuth,
};

pub fn whoami(allocator: std.mem.Allocator, manager: *PackageManager) WhoamiError!string {
    const registry = manager.options.scope;

    if (registry.user.len > 0) {
        const sep = strings.indexOfChar(registry.user, ':').?;
        return registry.user[0..sep];
    }

    if (registry.url.username.len > 0) return registry.url.username;

    if (registry.token.len == 0) {
        return error.NeedAuth;
    }

    const auth_type = if (manager.options.publish_config.auth_type) |auth_type| @tagName(auth_type) else "web";
    const ci_name = bun.detectCI();

    var print_buf = std.ArrayList(u8).init(allocator);
    defer print_buf.deinit();
    var print_writer = print_buf.writer();

    var headers: http.HeaderBuilder = .{};

    {
        headers.count("accept", "*/*");
        headers.count("accept-encoding", "gzip,deflate");

        try print_writer.print("Bearer {s}", .{registry.token});
        headers.count("authorization", print_buf.items);
        print_buf.clearRetainingCapacity();

        // no otp needed, just use auth-type from options
        headers.count("npm-auth-type", auth_type);
        headers.count("npm-command", "whoami");

        try print_writer.print("{s} {s} {s} workspaces/{}{s}{s}", .{
            Global.user_agent,
            Global.os_name,
            Global.arch_name,
            // TODO: figure out how npm determines workspaces=true
            false,
            if (ci_name != null) " ci/" else "",
            ci_name orelse "",
        });
        headers.count("user-agent", print_buf.items);
        print_buf.clearRetainingCapacity();

        headers.count("Connection", "keep-alive");
        headers.count("Host", registry.url.host);
    }

    try headers.allocate(allocator);

    {
        headers.append("accept", "*/*");
        headers.append("accept-encoding", "gzip/deflate");

        try print_writer.print("Bearer {s}", .{registry.token});
        headers.append("authorization", print_buf.items);
        print_buf.clearRetainingCapacity();

        headers.append("npm-auth-type", auth_type);
        headers.append("npm-command", "whoami");

        try print_writer.print("{s} {s} {s} workspaces/{}{s}{s}", .{
            Global.user_agent,
            Global.os_name,
            Global.arch_name,
            false,
            if (ci_name != null) " ci/" else "",
            ci_name orelse "",
        });
        headers.append("user-agent", print_buf.items);
        print_buf.clearRetainingCapacity();

        headers.append("Connection", "keep-alive");
        headers.append("Host", registry.url.host);
    }

    try print_writer.print("{s}/-/whoami", .{
        strings.withoutTrailingSlash(registry.url.href),
    });

    var response_buf = try MutableString.init(allocator, 1024);

    const url = URL.parse(print_buf.items);

    var req = http.AsyncHTTP.initSync(
        allocator,
        .GET,
        url,
        headers.entries,
        headers.content.ptr.?[0..headers.content.len],
        &response_buf,
        "",
        null,
        null,
        .follow,
    );

    const res = req.sendSync() catch |err| {
        switch (err) {
            error.OutOfMemory => |oom| return oom,
            else => {
                Output.err(err, "whoami request failed to send", .{});
                Global.crash();
            },
        }
    };

    if (res.status_code >= 400) {
        const otp_response = false;
        try responseError(
            allocator,
            &req,
            &res,
            null,
            &response_buf,
            otp_response,
        );
    }

    if (res.headers.getIfOtherIsAbsent("npm-notice", "x-local-cache")) |notice| {
        Output.printError("\n", .{});
        Output.note("{s}", .{notice});
        Output.flush();
    }

    var log = logger.Log.init(allocator);
    const source = logger.Source.initPathString("???", response_buf.list.items);
    const json = JSON.parseUTF8(&source, &log, allocator) catch |err| {
        switch (err) {
            error.OutOfMemory => |oom| return oom,
            else => {
                Output.err(err, "failed to parse '/-/whoami' response body as JSON", .{});
                Global.crash();
            },
        }
    };

    const username, _ = try json.getString(allocator, "username") orelse {
        // no username, invalid auth probably
        return error.ProbablyInvalidAuth;
    };
    return username;
}

pub fn responseError(
    allocator: std.mem.Allocator,
    req: *const http.AsyncHTTP,
    res: *const bun.picohttp.Response,
    // `<name>@<version>`
    pkg_id: ?struct { string, string },
    response_body: *MutableString,
    comptime otp_response: bool,
) OOM!noreturn {
    const message = message: {
        var log = logger.Log.init(allocator);
        const source = logger.Source.initPathString("???", response_body.list.items);
        const json = JSON.parseUTF8(&source, &log, allocator) catch |err| {
            switch (err) {
                error.OutOfMemory => |oom| return oom,
                else => break :message null,
            }
        };

        const @"error", _ = try json.getString(allocator, "error") orelse break :message null;
        break :message @"error";
    };

    Output.prettyErrorln("\n<red>{d}<r>{s}{s}: {s}\n", .{
        res.status_code,
        if (res.status.len > 0) " " else "",
        res.status,
        bun.fmt.redactedNpmUrl(req.url.href),
    });

    if (res.status_code == 404 and pkg_id != null) {
        const package_name, const package_version = pkg_id.?;
        Output.prettyErrorln("\n - '{s}@{s}' does not exist in this registry", .{ package_name, package_version });
    } else {
        if (message) |msg| {
            if (comptime otp_response) {
                if (res.status_code == 401 and strings.containsComptime(msg, "You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.")) {
                    Output.prettyErrorln("\n - Received invalid OTP", .{});
                    Global.crash();
                }
            }
            Output.prettyErrorln("\n - {s}", .{msg});
        }
    }

    Global.crash();
}

pub const Registry = struct {
    pub const default_url = "https://registry.npmjs.org/";
    pub const default_url_hash = bun.Wyhash11.hash(0, strings.withoutTrailingSlash(default_url));
    pub const BodyPool = ObjectPool(MutableString, MutableString.init2048, true, 8);

    pub const Scope = struct {
        name: string = "",
        // https://github.com/npm/npm-registry-fetch/blob/main/lib/auth.js#L96
        // base64("${username}:${password}")
        auth: string = "",
        // URL may contain these special suffixes in the pathname:
        //  :_authToken
        //  :username
        //  :_password
        //  :_auth
        url: URL,
        url_hash: u64,
        token: string = "",

        // username and password combo, `user:pass`
        user: string = "",

        pub fn hash(str: string) u64 {
            return String.Builder.stringHash(str);
        }

        pub fn getName(name: string) string {
            if (name.len == 0 or name[0] != '@') return name;

            if (strings.indexOfChar(name, '/')) |i| {
                return name[1..i];
            }

            return name[1..];
        }

        pub fn fromAPI(name: string, registry_: Api.NpmRegistry, allocator: std.mem.Allocator, env: *DotEnv.Loader) OOM!Scope {
            var registry = registry_;

            // Support $ENV_VAR for registry URLs
            if (strings.startsWithChar(registry_.url, '$')) {
                // If it became "$ENV_VAR/", then we need to remove the trailing slash
                if (env.get(strings.trim(registry_.url[1..], "/"))) |replaced_url| {
                    if (replaced_url.len > 1) {
                        registry.url = replaced_url;
                    }
                }
            }

            var url = URL.parse(registry.url);
            var auth: string = "";
            var user: []u8 = "";
            var needs_normalize = false;

            if (registry.token.len == 0) {
                outer: {
                    if (registry.password.len == 0) {
                        var pathname = url.pathname;
                        defer {
                            url.pathname = pathname;
                            url.path = pathname;
                        }
                        var needs_to_check_slash = true;
                        while (strings.lastIndexOfChar(pathname, ':')) |colon| {
                            var segment = pathname[colon + 1 ..];
                            pathname = pathname[0..colon];
                            needs_to_check_slash = false;
                            needs_normalize = true;
                            if (pathname.len > 1 and pathname[pathname.len - 1] == '/') {
                                pathname = pathname[0 .. pathname.len - 1];
                            }

                            const eql_i = strings.indexOfChar(segment, '=') orelse continue;
                            const value = segment[eql_i + 1 ..];
                            segment = segment[0..eql_i];

                            // https://github.com/yarnpkg/yarn/blob/6db39cf0ff684ce4e7de29669046afb8103fce3d/src/registries/npm-registry.js#L364
                            // Bearer Token
                            if (strings.eqlComptime(segment, "_authToken")) {
                                registry.token = value;
                                break :outer;
                            }

                            if (strings.eqlComptime(segment, "_auth")) {
                                auth = value;
                                break :outer;
                            }

                            if (strings.eqlComptime(segment, "username")) {
                                registry.username = value;
                                continue;
                            }

                            if (strings.eqlComptime(segment, "_password")) {
                                registry.password = value;
                                continue;
                            }
                        }

                        // In this case, there is only one.
                        if (needs_to_check_slash) {
                            if (strings.lastIndexOfChar(pathname, '/')) |last_slash| {
                                var remain = pathname[last_slash + 1 ..];
                                if (strings.indexOfChar(remain, '=')) |eql_i| {
                                    const segment = remain[0..eql_i];
                                    const value = remain[eql_i + 1 ..];

                                    // https://github.com/yarnpkg/yarn/blob/6db39cf0ff684ce4e7de29669046afb8103fce3d/src/registries/npm-registry.js#L364
                                    // Bearer Token
                                    if (strings.eqlComptime(segment, "_authToken")) {
                                        registry.token = value;
                                        pathname = pathname[0 .. last_slash + 1];
                                        needs_normalize = true;
                                        break :outer;
                                    }

                                    if (strings.eqlComptime(segment, "_auth")) {
                                        auth = value;
                                        pathname = pathname[0 .. last_slash + 1];
                                        needs_normalize = true;
                                        break :outer;
                                    }

                                    if (strings.eqlComptime(segment, "username")) {
                                        registry.username = value;
                                        pathname = pathname[0 .. last_slash + 1];
                                        needs_normalize = true;
                                        break :outer;
                                    }

                                    if (strings.eqlComptime(segment, "_password")) {
                                        registry.password = value;
                                        pathname = pathname[0 .. last_slash + 1];
                                        needs_normalize = true;
                                        break :outer;
                                    }
                                }
                            }
                        }
                    }

                    registry.username = env.getAuto(registry.username);
                    registry.password = env.getAuto(registry.password);

                    if (registry.username.len > 0 and registry.password.len > 0 and auth.len == 0) {
                        var output_buf = try allocator.alloc(u8, registry.username.len + registry.password.len + 1 + std.base64.standard.Encoder.calcSize(registry.username.len + registry.password.len + 1));
                        user = output_buf[0 .. registry.username.len + registry.password.len + 1];
                        @memcpy(user[0..registry.username.len], registry.username);
                        user[registry.username.len] = ':';
                        @memcpy(user[registry.username.len + 1 ..][0..registry.password.len], registry.password);
                        output_buf = output_buf[user.len..];
                        auth = std.base64.standard.Encoder.encode(output_buf, user);
                        break :outer;
                    }
                }
            }

            registry.token = env.getAuto(registry.token);

            if (needs_normalize) {
                url = URL.parse(
                    try std.fmt.allocPrint(allocator, "{s}://{}/{s}/", .{
                        url.displayProtocol(),
                        url.displayHost(),
                        strings.trim(url.pathname, "/"),
                    }),
                );
            }

            const url_hash = hash(strings.withoutTrailingSlash(url.href));

            return Scope{
                .name = name,
                .url = url,
                .url_hash = url_hash,
                .token = registry.token,
                .auth = auth,
                .user = user,
            };
        }
    };

    pub const Map = std.HashMapUnmanaged(u64, Scope, IdentityContext(u64), 80);

    const PackageVersionResponse = union(Tag) {
        pub const Tag = enum {
            cached,
            fresh,
            not_found,
        };

        cached: PackageManifest,
        fresh: PackageManifest,
        not_found: void,
    };

    const Pico = bun.picohttp;
    pub fn getPackageMetadata(
        allocator: std.mem.Allocator,
        scope: *const Registry.Scope,
        response: Pico.Response,
        body: []const u8,
        log: *logger.Log,
        package_name: string,
        loaded_manifest: ?PackageManifest,
        package_manager: *PackageManager,
    ) !PackageVersionResponse {
        switch (response.status_code) {
            400 => return error.BadRequest,
            429 => return error.TooManyRequests,
            404 => return PackageVersionResponse{ .not_found = {} },
            500...599 => return error.HTTPInternalServerError,
            304 => return PackageVersionResponse{
                .cached = loaded_manifest.?,
            },
            else => {},
        }

        var newly_last_modified: string = "";
        var new_etag: string = "";
        for (response.headers.list) |header| {
            if (!(header.name.len == "last-modified".len or header.name.len == "etag".len)) continue;

            const hashed = HTTPClient.hashHeaderName(header.name);

            switch (hashed) {
                HTTPClient.hashHeaderConst("last-modified") => {
                    newly_last_modified = header.value;
                },
                HTTPClient.hashHeaderConst("etag") => {
                    new_etag = header.value;
                },
                else => {},
            }
        }

        var new_etag_buf: [64]u8 = undefined;

        if (new_etag.len < new_etag_buf.len) {
            bun.copy(u8, &new_etag_buf, new_etag);
            new_etag = new_etag_buf[0..new_etag.len];
        }

        if (try PackageManifest.parse(
            allocator,
            scope,
            log,
            body,
            package_name,
            newly_last_modified,
            new_etag,
            @as(u32, @truncate(@as(u64, @intCast(@max(0, std.time.timestamp()))))) + 300,
        )) |package| {
            if (package_manager.options.enable.manifest_cache) {
                PackageManifest.Serializer.saveAsync(
                    &package,
                    scope,
                    package_manager.getTemporaryDirectory(),
                    package_manager.getCacheDirectory(),
                );
            }

            return PackageVersionResponse{ .fresh = package };
        }

        return error.PackageFailedToParse;
    }
};

const VersionMap = std.ArrayHashMapUnmanaged(Semver.Version, PackageVersion, Semver.Version.HashContext, false);
const DistTagMap = extern struct {
    tags: ExternalStringList = ExternalStringList{},
    versions: VersionSlice = VersionSlice{},
};

const PackageVersionList = ExternalSlice(PackageVersion);
const ExternVersionMap = extern struct {
    keys: VersionSlice = VersionSlice{},
    values: PackageVersionList = PackageVersionList{},

    pub fn findKeyIndex(this: ExternVersionMap, buf: []const Semver.Version, find: Semver.Version) ?u32 {
        for (this.keys.get(buf), 0..) |key, i| {
            if (key.eql(find)) {
                return @as(u32, @truncate(i));
            }
        }

        return null;
    }
};

pub fn Negatable(comptime T: type) type {
    return struct {
        added: T = T.none,
        removed: T = T.none,
        had_wildcard: bool = false,
        had_unrecognized_values: bool = false,

        // https://github.com/pnpm/pnpm/blob/1f228b0aeec2ef9a2c8577df1d17186ac83790f9/config/package-is-installable/src/checkPlatform.ts#L56-L86
        // https://github.com/npm/cli/blob/fefd509992a05c2dfddbe7bc46931c42f1da69d7/node_modules/npm-install-checks/lib/index.js#L2-L96
        pub fn combine(this: Negatable(T)) T {
            const added = if (this.had_wildcard) T.all_value else @intFromEnum(this.added);
            const removed = @intFromEnum(this.removed);

            // If none were added or removed, all are allowed
            if (added == 0 and removed == 0) {
                if (this.had_unrecognized_values) {
                    return T.none;
                }

                // []
                return T.all;
            }

            // If none were added, but some were removed, return the inverse of the removed
            if (added == 0 and removed != 0) {
                // ["!linux", "!darwin"]
                return @enumFromInt(T.all_value & ~removed);
            }

            if (removed == 0) {
                // ["linux", "darwin"]
                return @enumFromInt(added);
            }

            // - ["linux", "!darwin"]
            return @enumFromInt(added & ~removed);
        }

        pub fn apply(this: *Negatable(T), str: []const u8) void {
            if (str.len == 0) {
                return;
            }

            if (strings.eqlComptime(str, "any")) {
                this.had_wildcard = true;
                return;
            }

            if (strings.eqlComptime(str, "none")) {
                this.had_unrecognized_values = true;
                return;
            }

            const is_not = str[0] == '!';
            const offset: usize = @intFromBool(is_not);

            const field: u16 = T.NameMap.get(str[offset..]) orelse {
                if (!is_not)
                    this.had_unrecognized_values = true;
                return;
            };

            if (is_not) {
                this.* = .{ .added = this.added, .removed = @enumFromInt(@intFromEnum(this.removed) | field) };
            } else {
                this.* = .{ .added = @enumFromInt(@intFromEnum(this.added) | field), .removed = this.removed };
            }
        }

        pub fn fromJson(allocator: std.mem.Allocator, expr: JSON.Expr) OOM!T {
            var this = T.none.negatable();
            switch (expr.data) {
                .e_array => |arr| {
                    const items = arr.slice();
                    if (items.len > 0) {
                        for (items) |item| {
                            if (item.asString(allocator)) |value| {
                                this.apply(value);
                            }
                        }
                    }
                },
                .e_string => |str| {
                    this.apply(str.data);
                },
                else => {},
            }

            return this.combine();
        }

        /// writes to a one line json array with a trailing comma and space, or writes a string
        pub fn toJson(field: T, writer: anytype) @TypeOf(writer).Error!void {
            if (field == .none) {
                // [] means everything, so unrecognized value
                try writer.writeAll(
                    \\"none"
                );
                return;
            }

            const kvs = T.NameMap.kvs;
            var removed: u8 = 0;
            for (kvs) |kv| {
                if (!field.has(kv.value)) {
                    removed += 1;
                }
            }
            const included = kvs.len - removed;
            const print_included = removed > kvs.len - removed;

            const one = (print_included and included == 1) or (!print_included and removed == 1);

            if (!one) {
                try writer.writeAll("[ ");
            }

            for (kvs) |kv| {
                const has = field.has(kv.value);
                if (has and print_included) {
                    try writer.print(
                        \\"{s}"
                    , .{kv.key});
                    if (one) return;
                    try writer.writeAll(", ");
                } else if (!has and !print_included) {
                    try writer.print(
                        \\"!{s}"
                    , .{kv.key});
                    if (one) return;
                    try writer.writeAll(", ");
                }
            }

            try writer.writeByte(']');
        }
    };
}

/// https://nodejs.org/api/os.html#osplatform
pub const OperatingSystem = enum(u16) {
    none = 0,
    all = all_value,

    _,

    pub const aix: u16 = 1 << 1;
    pub const darwin: u16 = 1 << 2;
    pub const freebsd: u16 = 1 << 3;
    pub const linux: u16 = 1 << 4;
    pub const openbsd: u16 = 1 << 5;
    pub const sunos: u16 = 1 << 6;
    pub const win32: u16 = 1 << 7;
    pub const android: u16 = 1 << 8;

    pub const all_value: u16 = aix | darwin | freebsd | linux | openbsd | sunos | win32 | android;

    pub const current: OperatingSystem = switch (Environment.os) {
        .linux => @enumFromInt(linux),
        .mac => @enumFromInt(darwin),
        .windows => @enumFromInt(win32),
        else => @compileError("Unsupported operating system: " ++ @tagName(Environment.os)),
    };

    pub fn isMatch(this: OperatingSystem) bool {
        return (@intFromEnum(this) & @intFromEnum(current)) != 0;
    }

    pub inline fn has(this: OperatingSystem, other: u16) bool {
        return (@intFromEnum(this) & other) != 0;
    }

    pub const NameMap = bun.ComptimeStringMap(u16, .{
        .{ "aix", aix },
        .{ "darwin", darwin },
        .{ "freebsd", freebsd },
        .{ "linux", linux },
        .{ "openbsd", openbsd },
        .{ "sunos", sunos },
        .{ "win32", win32 },
        .{ "android", android },
    });

    pub const current_name = switch (Environment.os) {
        .linux => "linux",
        .mac => "darwin",
        .windows => "win32",
        else => @compileError("Unsupported operating system: " ++ @tagName(current)),
    };

    pub fn negatable(this: OperatingSystem) Negatable(OperatingSystem) {
        return .{ .added = this, .removed = .none };
    }

    const JSC = bun.JSC;
    pub fn jsFunctionOperatingSystemIsMatch(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const args = callframe.arguments_old(1);
        var operating_system = negatable(.none);
        var iter = args.ptr[0].arrayIterator(globalObject);
        while (iter.next()) |item| {
            const slice = item.toSlice(globalObject, bun.default_allocator);
            defer slice.deinit();
            operating_system.apply(slice.slice());
            if (globalObject.hasException()) return .zero;
        }
        if (globalObject.hasException()) return .zero;
        return JSC.JSValue.jsBoolean(operating_system.combine().isMatch());
    }
};

pub const Libc = enum(u8) {
    none = 0,
    all = all_value,
    _,

    pub const glibc: u8 = 1 << 1;
    pub const musl: u8 = 1 << 2;

    pub const all_value: u8 = glibc | musl;

    pub const NameMap = bun.ComptimeStringMap(u8, .{
        .{ "glibc", glibc },
        .{ "musl", musl },
    });

    pub inline fn has(this: Libc, other: u8) bool {
        return (@intFromEnum(this) & other) != 0;
    }

    pub fn negatable(this: Libc) Negatable(Libc) {
        return .{ .added = this, .removed = .none };
    }

    // TODO:
    pub const current: Libc = @intFromEnum(glibc);

    const JSC = bun.JSC;
    pub fn jsFunctionLibcIsMatch(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const args = callframe.arguments_old(1);
        var libc = negatable(.none);
        var iter = args.ptr[0].arrayIterator(globalObject);
        while (iter.next()) |item| {
            const slice = item.toSlice(globalObject, bun.default_allocator);
            defer slice.deinit();
            libc.apply(slice.slice());
            if (globalObject.hasException()) return .zero;
        }
        if (globalObject.hasException()) return .zero;
        return JSC.JSValue.jsBoolean(libc.combine().isMatch());
    }
};

/// https://docs.npmjs.com/cli/v8/configuring-npm/package-json#cpu
/// https://nodejs.org/api/os.html#osarch
pub const Architecture = enum(u16) {
    none = 0,
    all = all_value,
    _,

    pub const arm: u16 = 1 << 1;
    pub const arm64: u16 = 1 << 2;
    pub const ia32: u16 = 1 << 3;
    pub const mips: u16 = 1 << 4;
    pub const mipsel: u16 = 1 << 5;
    pub const ppc: u16 = 1 << 6;
    pub const ppc64: u16 = 1 << 7;
    pub const s390: u16 = 1 << 8;
    pub const s390x: u16 = 1 << 9;
    pub const x32: u16 = 1 << 10;
    pub const x64: u16 = 1 << 11;

    pub const all_value: u16 = arm | arm64 | ia32 | mips | mipsel | ppc | ppc64 | s390 | s390x | x32 | x64;

    pub const current: Architecture = switch (Environment.arch) {
        .arm64 => @enumFromInt(arm64),
        .x64 => @enumFromInt(x64),
        else => @compileError("Specify architecture: " ++ Environment.arch),
    };

    pub const current_name = switch (Environment.arch) {
        .arm64 => "arm64",
        .x64 => "x64",
        else => @compileError("Unsupported architecture: " ++ @tagName(current)),
    };

    pub const NameMap = bun.ComptimeStringMap(u16, .{
        .{ "arm", arm },
        .{ "arm64", arm64 },
        .{ "ia32", ia32 },
        .{ "mips", mips },
        .{ "mipsel", mipsel },
        .{ "ppc", ppc },
        .{ "ppc64", ppc64 },
        .{ "s390", s390 },
        .{ "s390x", s390x },
        .{ "x32", x32 },
        .{ "x64", x64 },
    });

    pub inline fn has(this: Architecture, other: u16) bool {
        return (@intFromEnum(this) & other) != 0;
    }

    pub fn isMatch(this: Architecture) bool {
        return @intFromEnum(this) & @intFromEnum(current) != 0;
    }

    pub fn negatable(this: Architecture) Negatable(Architecture) {
        return .{ .added = this, .removed = .none };
    }

    const JSC = bun.JSC;
    pub fn jsFunctionArchitectureIsMatch(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const args = callframe.arguments_old(1);
        var architecture = negatable(.none);
        var iter = args.ptr[0].arrayIterator(globalObject);
        while (iter.next()) |item| {
            const slice = item.toSlice(globalObject, bun.default_allocator);
            defer slice.deinit();
            architecture.apply(slice.slice());
            if (globalObject.hasException()) return .zero;
        }
        if (globalObject.hasException()) return .zero;
        return JSC.JSValue.jsBoolean(architecture.combine().isMatch());
    }
};

pub const PackageVersion = extern struct {
    /// `"integrity"` field || `"shasum"` field
    /// https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#dist
    // Splitting this into it's own array ends up increasing the final size a little bit.
    integrity: Integrity = Integrity{},

    /// "dependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#dependencies)
    dependencies: ExternalStringMap = ExternalStringMap{},

    /// `"optionalDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies)
    optional_dependencies: ExternalStringMap = ExternalStringMap{},

    /// `"peerDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependencies)
    /// if `non_optional_peer_dependencies_start` is > 0, then instead of alphabetical, the first N items are optional
    peer_dependencies: ExternalStringMap = ExternalStringMap{},

    /// `"devDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#devdependencies)
    /// We deliberately choose not to populate this field.
    /// We keep it in the data layout so that if it turns out we do need it, we can add it without invalidating everyone's history.
    dev_dependencies: ExternalStringMap = ExternalStringMap{},

    bundled_dependencies: ExternalPackageNameHashList = .{},

    /// `"bin"` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
    bin: Bin = Bin{},

    /// `"engines"` field in package.json
    engines: ExternalStringMap = ExternalStringMap{},

    /// `"peerDependenciesMeta"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependenciesmeta)
    /// if `non_optional_peer_dependencies_start` is > 0, then instead of alphabetical, the first N items of `peer_dependencies` are optional
    non_optional_peer_dependencies_start: u32 = 0,

    man_dir: ExternalString = ExternalString{},

    /// can be empty!
    /// When empty, it means that the tarball URL can be inferred
    tarball_url: ExternalString = ExternalString{},

    unpacked_size: u32 = 0,
    file_count: u32 = 0,

    /// `"os"` field in package.json
    os: OperatingSystem = OperatingSystem.all,
    /// `"cpu"` field in package.json
    cpu: Architecture = Architecture.all,

    /// `"libc"` field in package.json, not exposed in npm registry api yet.
    libc: Libc = Libc.none,

    /// `hasInstallScript` field in registry API.
    has_install_script: bool = false,

    pub fn allDependenciesBundled(this: *const PackageVersion) bool {
        return this.bundled_dependencies.isInvalid();
    }
};

comptime {
    if (@sizeOf(Npm.PackageVersion) != 232) {
        @compileError(std.fmt.comptimePrint("Npm.PackageVersion has unexpected size {d}", .{@sizeOf(Npm.PackageVersion)}));
    }
}

pub const NpmPackage = extern struct {
    /// HTTP response headers
    last_modified: String = String{},
    etag: String = String{},

    /// "modified" in the JSON
    modified: String = String{},
    public_max_age: u32 = 0,

    name: ExternalString = ExternalString{},

    releases: ExternVersionMap = ExternVersionMap{},
    prereleases: ExternVersionMap = ExternVersionMap{},
    dist_tags: DistTagMap = DistTagMap{},

    versions_buf: VersionSlice = VersionSlice{},
    string_lists_buf: ExternalStringList = ExternalStringList{},
};

pub const PackageManifest = struct {
    pkg: NpmPackage = .{},

    string_buf: []const u8 = &[_]u8{},
    versions: []const Semver.Version = &[_]Semver.Version{},
    external_strings: []const ExternalString = &[_]ExternalString{},
    // We store this in a separate buffer so that we can dedupe contiguous identical versions without an extra pass
    external_strings_for_versions: []const ExternalString = &[_]ExternalString{},
    package_versions: []const PackageVersion = &[_]PackageVersion{},
    extern_strings_bin_entries: []const ExternalString = &[_]ExternalString{},
    bundled_deps_buf: []const PackageNameHash = &.{},

    pub inline fn name(this: *const PackageManifest) string {
        return this.pkg.name.slice(this.string_buf);
    }

    pub fn byteLength(this: *const PackageManifest, scope: *const Registry.Scope) usize {
        var counter = std.io.countingWriter(std.io.null_writer);
        const writer = counter.writer();

        Serializer.write(this, scope, @TypeOf(writer), writer) catch return 0;
        return counter.bytes_written;
    }

    pub const Serializer = struct {
        // - v0.0.3: added serialization of registry url. it's used to invalidate when it changes
        // - v0.0.4: fixed bug with cpu & os tag not being added correctly
        // - v0.0.5: added bundled dependencies
        pub const version = "bun-npm-manifest-cache-v0.0.5\n";
        const header_bytes: string = "#!/usr/bin/env bun\n" ++ version;

        pub const sizes = blk: {
            if (header_bytes.len != 49)
                @compileError("header bytes must be exactly 49 bytes long, length is not serialized");

            // skip name
            const fields = std.meta.fields(Npm.PackageManifest);

            const Data = struct {
                size: usize,
                name: []const u8,
                alignment: usize,
            };
            var data: [fields.len]Data = undefined;
            for (fields, &data) |field_info, *dat| {
                dat.* = .{
                    .size = @sizeOf(field_info.type),
                    .name = field_info.name,
                    .alignment = if (@sizeOf(field_info.type) == 0) 1 else field_info.alignment,
                };
            }
            const Sort = struct {
                fn lessThan(_: void, lhs: Data, rhs: Data) bool {
                    return lhs.alignment > rhs.alignment;
                }
            };
            std.sort.pdq(Data, &data, {}, Sort.lessThan);
            var sizes_bytes: [fields.len]usize = undefined;
            var names: [fields.len][]const u8 = undefined;
            for (data, &sizes_bytes, &names) |elem, *size_, *name_| {
                size_.* = elem.size;
                name_.* = elem.name;
            }
            break :blk .{
                .bytes = sizes_bytes,
                .fields = names,
            };
        };

        pub fn writeArray(comptime Writer: type, writer: Writer, comptime Type: type, array: []const Type, pos: *u64) !void {
            const bytes = std.mem.sliceAsBytes(array);
            if (bytes.len == 0) {
                try writer.writeInt(u64, 0, .little);
                pos.* += 8;
                return;
            }

            try writer.writeInt(u64, bytes.len, .little);
            pos.* += 8;
            pos.* += try Aligner.write(Type, Writer, writer, pos.*);

            try writer.writeAll(
                bytes,
            );
            pos.* += bytes.len;
        }

        pub fn readArray(stream: *std.io.FixedBufferStream([]const u8), comptime Type: type) ![]const Type {
            var reader = stream.reader();
            const byte_len = try reader.readInt(u64, .little);
            if (byte_len == 0) {
                return &[_]Type{};
            }

            stream.pos += Aligner.skipAmount(Type, stream.pos);
            const remaining = stream.buffer[@min(stream.pos, stream.buffer.len)..];
            if (remaining.len < byte_len) {
                return error.BufferTooSmall;
            }
            const result_bytes = remaining[0..byte_len];
            const result = @as([*]const Type, @ptrCast(@alignCast(result_bytes.ptr)))[0 .. result_bytes.len / @sizeOf(Type)];
            stream.pos += result_bytes.len;
            return result;
        }

        pub fn write(this: *const PackageManifest, scope: *const Registry.Scope, comptime Writer: type, writer: Writer) !void {
            var pos: u64 = 0;
            try writer.writeAll(header_bytes);
            pos += header_bytes.len;

            try writer.writeInt(u64, scope.url_hash, .little);
            try writer.writeInt(u64, strings.withoutTrailingSlash(scope.url.href).len, .little);

            pos += 128 / 8;

            inline for (sizes.fields) |field_name| {
                if (comptime strings.eqlComptime(field_name, "pkg")) {
                    const bytes = std.mem.asBytes(&this.pkg);
                    pos += try Aligner.write(NpmPackage, Writer, writer, pos);
                    try writer.writeAll(
                        bytes,
                    );
                    pos += bytes.len;
                } else {
                    const field = @field(this, field_name);
                    try writeArray(Writer, writer, std.meta.Child(@TypeOf(field)), field, &pos);
                }
            }
        }

        fn writeFile(
            this: *const PackageManifest,
            scope: *const Registry.Scope,
            tmp_path: [:0]const u8,
            tmpdir: std.fs.Dir,
            cache_dir: std.fs.Dir,
            outpath: [:0]const u8,
        ) !void {
            // 64 KB sounds like a lot but when you consider that this is only about 6 levels deep in the stack, it's not that much.
            var stack_fallback = std.heap.stackFallback(64 * 1024, bun.default_allocator);

            const allocator = stack_fallback.get();
            var buffer = try std.ArrayList(u8).initCapacity(allocator, this.byteLength(scope) + 64);
            defer buffer.deinit();
            const writer = &buffer.writer();
            try Serializer.write(this, scope, @TypeOf(writer), writer);
            // --- Perf Improvement #1 ----
            // Do not forget to buffer writes!
            //
            // PS C:\bun> hyperfine "bun-debug install --ignore-scripts" "bun install --ignore-scripts" --prepare="del /s /q bun.lockb && del /s /q C:\Users\window\.bun\install\cache"
            // Benchmark 1: bun-debug install --ignore-scripts
            //   Time (mean ± σ):      1.266 s ±  0.284 s    [User: 1.631 s, System: 0.205 s]
            //   Range (min … max):    1.071 s …  1.804 s    10 runs
            //
            //   Warning: Statistical outliers were detected. Consider re-running this benchmark on a quiet system without any interferences from other programs. It might help to use the '--warmup' or '--prepare' options.
            //
            // Benchmark 2: bun install --ignore-scripts
            //   Time (mean ± σ):      3.202 s ±  0.095 s    [User: 0.255 s, System: 0.172 s]
            //   Range (min … max):    3.058 s …  3.371 s    10 runs
            //
            // Summary
            //   bun-debug install --ignore-scripts ran
            //     2.53 ± 0.57 times faster than bun install --ignore-scripts
            // --- Perf Improvement #2 ----
            // GetFinalPathnameByHandle is very expensive if called many times
            // We skip calling it when we are giving an absolute file path.
            // This needs many more call sites, doesn't have much impact on this location.
            var realpath_buf: bun.PathBuffer = undefined;
            const path_to_use_for_opening_file = if (Environment.isWindows)
                bun.path.joinAbsStringBufZ(PackageManager.get().temp_dir_path, &realpath_buf, &.{ PackageManager.get().temp_dir_path, tmp_path }, .auto)
            else
                tmp_path;

            var is_using_o_tmpfile = if (Environment.isLinux) false else {};
            const file = brk: {
                const flags = bun.O.WRONLY;
                const mask = if (Environment.isPosix) 0o664 else 0;

                // Do our best to use O_TMPFILE, so that if this process is interrupted, we don't leave a temporary file behind.
                // O_TMPFILE is Linux-only. Not all filesystems support O_TMPFILE.
                // https://manpages.debian.org/testing/manpages-dev/openat.2.en.html#O_TMPFILE
                if (Environment.isLinux) {
                    switch (bun.sys.File.openat(cache_dir, ".", flags | bun.O.TMPFILE, mask)) {
                        .err => {
                            const warner = struct {
                                var did_warn = std.atomic.Value(bool).init(false);

                                pub fn warnOnce() void {
                                    if (!did_warn.swap(true, .monotonic)) {
                                        // This is not an error. Nor is it really a warning.
                                        Output.note("Linux filesystem or kernel lacks O_TMPFILE support. Using a fallback instead.", .{});
                                        Output.flush();
                                    }
                                }
                            };
                            if (PackageManager.verbose_install)
                                warner.warnOnce();
                        },
                        .result => |f| {
                            is_using_o_tmpfile = true;
                            break :brk f;
                        },
                    }
                }

                break :brk try bun.sys.File.openat(
                    tmpdir,
                    path_to_use_for_opening_file,
                    flags | bun.O.CREAT | bun.O.TRUNC,
                    if (Environment.isPosix) 0o664 else 0,
                ).unwrap();
            };

            {
                errdefer file.close();
                try file.writeAll(buffer.items).unwrap();
            }
            if (comptime Environment.isWindows) {
                var realpath2_buf: bun.PathBuffer = undefined;
                var did_close = false;
                errdefer if (!did_close) file.close();

                const cache_dir_abs = PackageManager.get().cache_directory_path;
                const cache_path_abs = bun.path.joinAbsStringBufZ(cache_dir_abs, &realpath2_buf, &.{ cache_dir_abs, outpath }, .auto);
                file.close();
                did_close = true;
                try bun.sys.renameat(bun.FD.cwd(), path_to_use_for_opening_file, bun.FD.cwd(), cache_path_abs).unwrap();
            } else if (Environment.isLinux and is_using_o_tmpfile) {
                defer file.close();
                // Attempt #1.
                bun.sys.linkatTmpfile(file.handle, bun.toFD(cache_dir), outpath).unwrap() catch {
                    // Attempt #2: the file may already exist. Let's unlink and try again.
                    bun.sys.unlinkat(bun.toFD(cache_dir), outpath).unwrap() catch {};
                    try bun.sys.linkatTmpfile(file.handle, bun.toFD(cache_dir), outpath).unwrap();

                    // There is no attempt #3. This is a cache, so it's not essential.
                };
            } else {
                defer file.close();
                // Attempt #1. Rename the file.
                const rc = bun.sys.renameat(bun.toFD(tmpdir), tmp_path, bun.toFD(cache_dir), outpath);

                switch (rc) {
                    .err => |err| {
                        // Fallback path: atomically swap from <tmp>/*.npm -> <cache>/*.npm, then unlink the temporary file.
                        defer {
                            // If atomically swapping fails, then we should still unlink the temporary file as a courtesy.
                            bun.sys.unlinkat(bun.toFD(tmpdir), tmp_path).unwrap() catch {};
                        }

                        if (switch (err.getErrno()) {
                            .EXIST, .NOTEMPTY, .OPNOTSUPP => true,
                            else => false,
                        }) {

                            // Atomically swap the old file with the new file.
                            try bun.sys.renameat2(bun.toFD(tmpdir.fd), tmp_path, bun.toFD(cache_dir.fd), outpath, .{
                                .exchange = true,
                            }).unwrap();

                            // Success.
                            return;
                        }
                    },
                    .result => {},
                }

                try rc.unwrap();
            }
        }

        /// We save into a temporary directory and then move the file to the cache directory.
        /// Saving the files to the manifest cache doesn't need to prevent application exit.
        /// It's an optional cache.
        /// Therefore, we choose to not increment the pending task count or wake up the main thread.
        ///
        /// This might leave temporary files in the temporary directory that will never be moved to the cache directory. We'll see if anyone asks about that.
        pub fn saveAsync(this: *const PackageManifest, scope: *const Registry.Scope, tmpdir: std.fs.Dir, cache_dir: std.fs.Dir) void {
            const SaveTask = struct {
                manifest: PackageManifest,
                scope: *const Registry.Scope,
                tmpdir: std.fs.Dir,
                cache_dir: std.fs.Dir,

                task: bun.ThreadPool.Task = .{ .callback = &run },
                pub usingnamespace bun.New(@This());

                pub fn run(task: *bun.ThreadPool.Task) void {
                    const save_task: *@This() = @fieldParentPtr("task", task);
                    defer {
                        save_task.destroy();
                    }

                    Serializer.save(&save_task.manifest, save_task.scope, save_task.tmpdir, save_task.cache_dir) catch |err| {
                        if (PackageManager.verbose_install) {
                            Output.warn("Error caching manifest for {s}: {s}", .{ save_task.manifest.name(), @errorName(err) });
                            Output.flush();
                        }
                    };
                }
            };

            const task = SaveTask.new(.{
                .manifest = this.*,
                .scope = scope,
                .tmpdir = tmpdir,
                .cache_dir = cache_dir,
            });

            const batch = bun.ThreadPool.Batch.from(&task.task);
            PackageManager.get().thread_pool.schedule(batch);
        }

        fn manifestFileName(buf: []u8, file_id: u64, scope: *const Registry.Scope) ![:0]const u8 {
            const file_id_hex_fmt = bun.fmt.hexIntLower(file_id);
            return if (scope.url_hash == Registry.default_url_hash)
                try std.fmt.bufPrintZ(buf, "{any}.npm", .{file_id_hex_fmt})
            else
                try std.fmt.bufPrintZ(buf, "{any}-{any}.npm", .{ file_id_hex_fmt, bun.fmt.hexIntLower(scope.url_hash) });
        }

        pub fn save(this: *const PackageManifest, scope: *const Registry.Scope, tmpdir: std.fs.Dir, cache_dir: std.fs.Dir) !void {
            const file_id = bun.Wyhash11.hash(0, this.name());
            var dest_path_buf: [512 + 64]u8 = undefined;
            var out_path_buf: [("18446744073709551615".len * 2) + "_".len + ".npm".len + 1]u8 = undefined;
            var dest_path_stream = std.io.fixedBufferStream(&dest_path_buf);
            var dest_path_stream_writer = dest_path_stream.writer();
            const file_id_hex_fmt = bun.fmt.hexIntLower(file_id);
            const hex_timestamp: usize = @intCast(@max(std.time.milliTimestamp(), 0));
            const hex_timestamp_fmt = bun.fmt.hexIntLower(hex_timestamp);
            try dest_path_stream_writer.print("{any}.npm-{any}", .{ file_id_hex_fmt, hex_timestamp_fmt });
            try dest_path_stream_writer.writeByte(0);
            const tmp_path: [:0]u8 = dest_path_buf[0 .. dest_path_stream.pos - 1 :0];
            const out_path = try manifestFileName(&out_path_buf, file_id, scope);
            try writeFile(this, scope, tmp_path, tmpdir, cache_dir, out_path);
        }

        pub fn loadByFileID(allocator: std.mem.Allocator, scope: *const Registry.Scope, cache_dir: std.fs.Dir, file_id: u64) !?PackageManifest {
            var file_path_buf: [512 + 64]u8 = undefined;
            const file_name = try manifestFileName(&file_path_buf, file_id, scope);
            const cache_file = File.openat(cache_dir, file_name, bun.O.RDONLY, 0).unwrap() catch return null;
            defer cache_file.close();

            delete: {
                return loadByFile(allocator, scope, cache_file) catch break :delete orelse break :delete;
            }

            // delete the outdated/invalid manifest
            try bun.sys.unlinkat(bun.toFD(cache_dir), file_name).unwrap();
            return null;
        }

        pub fn loadByFile(allocator: std.mem.Allocator, scope: *const Registry.Scope, manifest_file: File) !?PackageManifest {
            const bytes = try manifest_file.readToEnd(allocator).unwrap();
            errdefer allocator.free(bytes);

            if (bytes.len < header_bytes.len) {
                return null;
            }

            const manifest = try readAll(bytes, scope) orelse return null;

            if (manifest.versions.len == 0) {
                // it's impossible to publish a package with zero versions, bust
                // invalid entry
                return null;
            }

            return manifest;
        }

        fn readAll(bytes: []const u8, scope: *const Registry.Scope) !?PackageManifest {
            if (!strings.eqlComptime(bytes[0..header_bytes.len], header_bytes)) {
                return null;
            }
            var pkg_stream = std.io.fixedBufferStream(bytes);
            pkg_stream.pos = header_bytes.len;

            var reader = pkg_stream.reader();
            var package_manifest = PackageManifest{};

            const registry_hash = try reader.readInt(u64, .little);
            if (scope.url_hash != registry_hash) {
                return null;
            }

            const registry_length = try reader.readInt(u64, .little);
            if (strings.withoutTrailingSlash(scope.url.href).len != registry_length) {
                return null;
            }

            inline for (sizes.fields) |field_name| {
                if (comptime strings.eqlComptime(field_name, "pkg")) {
                    pkg_stream.pos = std.mem.alignForward(usize, pkg_stream.pos, @alignOf(Npm.NpmPackage));
                    package_manifest.pkg = try reader.readStruct(NpmPackage);
                } else {
                    @field(package_manifest, field_name) = try readArray(
                        &pkg_stream,
                        std.meta.Child(@TypeOf(@field(package_manifest, field_name))),
                    );
                }
            }

            return package_manifest;
        }
    };

    pub const bindings = struct {
        const JSC = bun.JSC;
        const JSValue = JSC.JSValue;
        const JSGlobalObject = JSC.JSGlobalObject;
        const CallFrame = JSC.CallFrame;
        const ZigString = JSC.ZigString;

        pub fn generate(global: *JSGlobalObject) JSValue {
            const obj = JSValue.createEmptyObject(global, 1);
            const parseManifestString = ZigString.static("parseManifest");
            obj.put(global, parseManifestString, JSC.createCallback(global, parseManifestString, 2, jsParseManifest));
            return obj;
        }

        pub fn jsParseManifest(global: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
            const args = callFrame.arguments_old(2).slice();
            if (args.len < 2 or !args[0].isString() or !args[1].isString()) {
                return global.throw("expected manifest filename and registry string arguments", .{});
            }

            const manifest_filename_str = args[0].toBunString(global);
            defer manifest_filename_str.deref();

            const manifest_filename = manifest_filename_str.toUTF8(bun.default_allocator);
            defer manifest_filename.deinit();

            const registry_str = args[1].toBunString(global);
            defer registry_str.deref();

            const registry = registry_str.toUTF8(bun.default_allocator);
            defer registry.deinit();

            const manifest_file = std.fs.openFileAbsolute(manifest_filename.slice(), .{}) catch |err| {
                return global.throw("failed to open manifest file \"{s}\": {s}", .{ manifest_filename.slice(), @errorName(err) });
            };
            defer manifest_file.close();

            const scope: Registry.Scope = .{
                .url_hash = Registry.Scope.hash(strings.withoutTrailingSlash(registry.slice())),
                .url = .{
                    .host = strings.withoutTrailingSlash(strings.withoutPrefixComptime(registry.slice(), "http://")),
                    .hostname = strings.withoutTrailingSlash(strings.withoutPrefixComptime(registry.slice(), "http://")),
                    .href = registry.slice(),
                    .origin = strings.withoutTrailingSlash(registry.slice()),
                    .protocol = if (strings.indexOfChar(registry.slice(), ':')) |colon| registry.slice()[0..colon] else "",
                },
            };

            const maybe_package_manifest = Serializer.loadByFile(bun.default_allocator, &scope, File.from(manifest_file)) catch |err| {
                return global.throw("failed to load manifest file: {s}", .{@errorName(err)});
            };

            const package_manifest: PackageManifest = maybe_package_manifest orelse {
                return global.throw("manifest is invalid ", .{});
            };

            var buf: std.ArrayListUnmanaged(u8) = .{};
            const writer = buf.writer(bun.default_allocator);

            // TODO: we can add more information. for now just versions is fine

            try writer.print("{{\"name\":\"{s}\",\"versions\":[", .{package_manifest.name()});

            for (package_manifest.versions, 0..) |version, i| {
                if (i == package_manifest.versions.len - 1)
                    try writer.print("\"{}\"]}}", .{version.fmt(package_manifest.string_buf)})
                else
                    try writer.print("\"{}\",", .{version.fmt(package_manifest.string_buf)});
            }

            var result = bun.String.fromUTF8(buf.items);
            defer result.deref();

            return result.toJSByParseJSON(global);
        }
    };

    pub fn str(self: *const PackageManifest, external: *const ExternalString) string {
        return external.slice(self.string_buf);
    }

    pub fn reportSize(this: *const PackageManifest) void {
        Output.prettyErrorln(
            \\ Versions count:            {d}
            \\ External Strings count:    {d}
            \\ Package Versions count:    {d}
            \\
            \\ Bytes:
            \\
            \\  Versions:   {d}
            \\  External:   {d}
            \\  Packages:   {d}
            \\  Strings:    {d}
            \\  Total:      {d}
        , .{
            this.versions.len,
            this.external_strings.len,
            this.package_versions.len,

            std.mem.sliceAsBytes(this.versions).len,
            std.mem.sliceAsBytes(this.external_strings).len,
            std.mem.sliceAsBytes(this.package_versions).len,
            std.mem.sliceAsBytes(this.string_buf).len,
            std.mem.sliceAsBytes(this.versions).len +
                std.mem.sliceAsBytes(this.external_strings).len +
                std.mem.sliceAsBytes(this.package_versions).len +
                std.mem.sliceAsBytes(this.string_buf).len,
        });
        Output.flush();
    }

    pub const FindResult = struct {
        version: Semver.Version,
        package: *const PackageVersion,
    };

    pub fn findByVersion(this: *const PackageManifest, version: Semver.Version) ?FindResult {
        const list = if (!version.tag.hasPre()) this.pkg.releases else this.pkg.prereleases;
        const values = list.values.get(this.package_versions);
        const keys = list.keys.get(this.versions);
        const index = list.findKeyIndex(this.versions, version) orelse return null;
        return .{
            // Be sure to use the struct from the list in the NpmPackage
            // That is the one we can correctly recover the original version string for
            .version = keys[index],
            .package = &values[index],
        };
    }

    pub fn findByDistTag(this: *const PackageManifest, tag: string) ?FindResult {
        const versions = this.pkg.dist_tags.versions.get(this.versions);
        for (this.pkg.dist_tags.tags.get(this.external_strings), 0..) |tag_str, i| {
            if (strings.eql(tag_str.slice(this.string_buf), tag)) {
                return this.findByVersion(versions[i]);
            }
        }

        return null;
    }

    pub fn findBestVersion(this: *const PackageManifest, group: Semver.Query.Group, group_buf: string) ?FindResult {
        const left = group.head.head.range.left;
        // Fast path: exact version
        if (left.op == .eql) {
            return this.findByVersion(left.version);
        }

        if (this.findByDistTag("latest")) |result| {
            if (group.satisfies(result.version, group_buf, this.string_buf)) {
                if (group.flags.isSet(Semver.Query.Group.Flags.pre)) {
                    if (left.version.order(result.version, group_buf, this.string_buf) == .eq) {
                        // if prerelease, use latest if semver+tag match range exactly
                        return result;
                    }
                } else {
                    return result;
                }
            }
        }

        {
            // This list is sorted at serialization time.
            const releases = this.pkg.releases.keys.get(this.versions);
            var i = releases.len;

            while (i > 0) : (i -= 1) {
                const version = releases[i - 1];

                if (group.satisfies(version, group_buf, this.string_buf)) {
                    return .{
                        .version = version,
                        .package = &this.pkg.releases.values.get(this.package_versions)[i - 1],
                    };
                }
            }
        }

        if (group.flags.isSet(Semver.Query.Group.Flags.pre)) {
            const prereleases = this.pkg.prereleases.keys.get(this.versions);
            var i = prereleases.len;
            while (i > 0) : (i -= 1) {
                const version = prereleases[i - 1];

                // This list is sorted at serialization time.
                if (group.satisfies(version, group_buf, this.string_buf)) {
                    const packages = this.pkg.prereleases.values.get(this.package_versions);
                    return .{
                        .version = version,
                        .package = &packages[i - 1],
                    };
                }
            }
        }

        return null;
    }

    const ExternalStringMapDeduper = std.HashMap(u64, ExternalStringList, IdentityContext(u64), 80);

    /// This parses [Abbreviated metadata](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-metadata-format)
    fn parse(
        allocator: std.mem.Allocator,
        scope: *const Registry.Scope,
        log: *logger.Log,
        json_buffer: []const u8,
        expected_name: []const u8,
        last_modified: []const u8,
        etag: []const u8,
        public_max_age: u32,
    ) !?PackageManifest {
        const source = logger.Source.initPathString(expected_name, json_buffer);
        initializeStore();
        defer bun.JSAst.Stmt.Data.Store.memory_allocator.?.pop();
        var arena = bun.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const json = JSON.parseUTF8(
            &source,
            log,
            arena.allocator(),
        ) catch return null;

        if (json.asProperty("error")) |error_q| {
            if (error_q.expr.asString(allocator)) |err| {
                log.addErrorFmt(&source, logger.Loc.Empty, allocator, "npm error: {s}", .{err}) catch unreachable;
                return null;
            }
        }

        var result: PackageManifest = bun.serializable(PackageManifest{});

        var string_pool = String.Builder.StringPool.init(default_allocator);
        defer string_pool.deinit();
        var all_extern_strings_dedupe_map = ExternalStringMapDeduper.initContext(default_allocator, .{});
        defer all_extern_strings_dedupe_map.deinit();
        var version_extern_strings_dedupe_map = ExternalStringMapDeduper.initContext(default_allocator, .{});
        defer version_extern_strings_dedupe_map.deinit();
        var optional_peer_dep_names = std.ArrayList(u64).init(default_allocator);
        defer optional_peer_dep_names.deinit();

        var bundled_deps_set = bun.StringSet.init(allocator);
        defer bundled_deps_set.deinit();
        var bundle_all_deps = false;

        var bundled_deps_count: usize = 0;

        var string_builder = String.Builder{
            .string_pool = string_pool,
        };

        if (PackageManager.verbose_install) {
            if (json.asProperty("name")) |name_q| {
                const received_name = name_q.expr.asString(allocator) orelse return null;
                // If this manifest is coming from the default registry, make sure it's the expected one. If it's not
                // from the default registry we don't check because the registry might have a different name in the manifest.
                // https://github.com/oven-sh/bun/issues/4925
                if (scope.url_hash == Registry.default_url_hash and !strings.eqlLong(expected_name, received_name, true)) {
                    Output.warn("Package name mismatch. Expected <b>\"{s}\"<r> but received <red>\"{s}\"<r>", .{ expected_name, received_name });
                }
            }
        }

        string_builder.count(expected_name);

        if (json.asProperty("modified")) |name_q| {
            const field = name_q.expr.asString(allocator) orelse return null;

            string_builder.count(field);
        }

        const DependencyGroup = struct { prop: string, field: string };
        const dependency_groups = comptime [_]DependencyGroup{
            .{ .prop = "dependencies", .field = "dependencies" },
            .{ .prop = "optionalDependencies", .field = "optional_dependencies" },
            .{ .prop = "peerDependencies", .field = "peer_dependencies" },
        };

        var release_versions_len: usize = 0;
        var pre_versions_len: usize = 0;
        var dependency_sum: usize = 0;
        var extern_string_count: usize = 0;
        var extern_string_count_bin: usize = 0;
        var tarball_urls_count: usize = 0;
        get_versions: {
            if (json.asProperty("versions")) |versions_q| {
                if (versions_q.expr.data != .e_object) break :get_versions;

                const versions = versions_q.expr.data.e_object.properties.slice();
                for (versions) |prop| {
                    const version_name = prop.key.?.asString(allocator) orelse continue;
                    const sliced_version = SlicedString.init(version_name, version_name);
                    const parsed_version = Semver.Version.parse(sliced_version);

                    if (Environment.allow_assert) bun.assertWithLocation(parsed_version.valid, @src());
                    if (!parsed_version.valid) {
                        log.addErrorFmt(&source, prop.value.?.loc, allocator, "Failed to parse dependency {s}", .{version_name}) catch unreachable;
                        continue;
                    }

                    if (parsed_version.version.tag.hasPre()) {
                        pre_versions_len += 1;
                        extern_string_count += 1;
                    } else {
                        extern_string_count += @as(usize, @intFromBool(strings.indexOfChar(version_name, '+') != null));
                        release_versions_len += 1;
                    }

                    string_builder.count(version_name);

                    if (prop.value.?.asProperty("dist")) |dist_q| {
                        if (dist_q.expr.get("tarball")) |tarball_prop| {
                            if (tarball_prop.data == .e_string) {
                                const tarball = tarball_prop.data.e_string.slice(allocator);
                                string_builder.count(tarball);
                                tarball_urls_count += @as(usize, @intFromBool(tarball.len > 0));
                            }
                        }
                    }

                    bin: {
                        if (prop.value.?.asProperty("bin")) |bin| {
                            switch (bin.expr.data) {
                                .e_object => |obj| {
                                    switch (obj.properties.len) {
                                        0 => {
                                            break :bin;
                                        },
                                        1 => {},
                                        else => {
                                            extern_string_count_bin += obj.properties.len * 2;
                                        },
                                    }

                                    for (obj.properties.slice()) |bin_prop| {
                                        string_builder.count(bin_prop.key.?.asString(allocator) orelse break :bin);
                                        string_builder.count(bin_prop.value.?.asString(allocator) orelse break :bin);
                                    }
                                },
                                .e_string => {
                                    if (bin.expr.asString(allocator)) |str_| {
                                        string_builder.count(str_);
                                        break :bin;
                                    }
                                },
                                else => {},
                            }
                        }

                        if (prop.value.?.asProperty("directories")) |dirs| {
                            if (dirs.expr.asProperty("bin")) |bin_prop| {
                                if (bin_prop.expr.asString(allocator)) |str_| {
                                    string_builder.count(str_);
                                    break :bin;
                                }
                            }
                        }
                    }

                    bundled_deps_set.map.clearRetainingCapacity();
                    bundle_all_deps = false;
                    if (prop.value.?.get("bundleDependencies") orelse prop.value.?.get("bundledDependencies")) |bundled_deps_expr| {
                        switch (bundled_deps_expr.data) {
                            .e_boolean => |boolean| {
                                bundle_all_deps = boolean.value;
                            },
                            .e_array => |arr| {
                                for (arr.slice()) |bundled_dep| {
                                    try bundled_deps_set.insert(bundled_dep.asString(allocator) orelse continue);
                                }
                            },
                            else => {},
                        }
                    }

                    inline for (dependency_groups) |pair| {
                        if (prop.value.?.asProperty(pair.prop)) |versioned_deps| {
                            if (versioned_deps.expr.data == .e_object) {
                                dependency_sum += versioned_deps.expr.data.e_object.properties.len;
                                const properties = versioned_deps.expr.data.e_object.properties.slice();
                                for (properties) |property| {
                                    if (property.key.?.asString(allocator)) |key| {
                                        if (!bundle_all_deps and bundled_deps_set.swapRemove(key)) {
                                            // swap remove the dependency name because it could exist in
                                            // multiple behavior groups.
                                            bundled_deps_count += 1;
                                        }
                                        string_builder.count(key);
                                        string_builder.count(property.value.?.asString(allocator) orelse "");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        extern_string_count += dependency_sum;

        var dist_tags_count: usize = 0;
        if (json.asProperty("dist-tags")) |dist| {
            if (dist.expr.data == .e_object) {
                const tags = dist.expr.data.e_object.properties.slice();
                for (tags) |tag| {
                    if (tag.key.?.asString(allocator)) |key| {
                        string_builder.count(key);
                        extern_string_count += 2;

                        string_builder.count((tag.value.?.asString(allocator) orelse ""));
                        dist_tags_count += 1;
                    }
                }
            }
        }

        if (last_modified.len > 0) {
            string_builder.count(last_modified);
        }

        if (etag.len > 0) {
            string_builder.count(etag);
        }

        var versioned_packages = try allocator.alloc(PackageVersion, release_versions_len + pre_versions_len);
        const all_semver_versions = try allocator.alloc(Semver.Version, release_versions_len + pre_versions_len + dist_tags_count);
        var all_extern_strings = try allocator.alloc(ExternalString, extern_string_count + tarball_urls_count);
        var version_extern_strings = try allocator.alloc(ExternalString, dependency_sum);
        var extern_strings_bin_entries = try allocator.alloc(ExternalString, extern_string_count_bin);
        var all_extern_strings_bin_entries = extern_strings_bin_entries;
        var all_tarball_url_strings = try allocator.alloc(ExternalString, tarball_urls_count);
        var tarball_url_strings = all_tarball_url_strings;
        const bundled_deps_buf = try allocator.alloc(PackageNameHash, bundled_deps_count);
        var bundled_deps_offset: usize = 0;

        if (versioned_packages.len > 0) {
            const versioned_packages_bytes = std.mem.sliceAsBytes(versioned_packages);
            @memset(versioned_packages_bytes, 0);
        }
        if (all_semver_versions.len > 0) {
            const all_semver_versions_bytes = std.mem.sliceAsBytes(all_semver_versions);
            @memset(all_semver_versions_bytes, 0);
        }
        if (all_extern_strings.len > 0) {
            const all_extern_strings_bytes = std.mem.sliceAsBytes(all_extern_strings);
            @memset(all_extern_strings_bytes, 0);
        }
        if (version_extern_strings.len > 0) {
            const version_extern_strings_bytes = std.mem.sliceAsBytes(version_extern_strings);
            @memset(version_extern_strings_bytes, 0);
        }

        var versioned_package_releases = versioned_packages[0..release_versions_len];
        const all_versioned_package_releases = versioned_package_releases;
        var versioned_package_prereleases = versioned_packages[release_versions_len..][0..pre_versions_len];
        const all_versioned_package_prereleases = versioned_package_prereleases;
        var _versions_open = all_semver_versions;
        const all_release_versions = _versions_open[0..release_versions_len];
        _versions_open = _versions_open[release_versions_len..];
        const all_prerelease_versions = _versions_open[0..pre_versions_len];
        _versions_open = _versions_open[pre_versions_len..];
        var dist_tag_versions = _versions_open[0..dist_tags_count];
        var release_versions = all_release_versions;
        var prerelease_versions = all_prerelease_versions;

        var extern_strings = all_extern_strings;
        string_builder.cap += (string_builder.cap % 64) + 64;
        string_builder.cap *= 2;

        try string_builder.allocate(allocator);

        var string_buf: string = "";
        if (string_builder.ptr) |ptr| {
            // 0 it out for better determinism
            @memset(ptr[0..string_builder.cap], 0);

            string_buf = ptr[0..string_builder.cap];
        }

        // Using `expected_name` instead of the name from the manifest. Custom registries might
        // have a different name than the dependency name in package.json.
        result.pkg.name = string_builder.append(ExternalString, expected_name);

        get_versions: {
            if (json.asProperty("versions")) |versions_q| {
                if (versions_q.expr.data != .e_object) break :get_versions;

                const versions = versions_q.expr.data.e_object.properties.slice();

                const all_dependency_names_and_values = all_extern_strings[0..dependency_sum];

                // versions change more often than names
                // so names go last because we are better able to dedupe at the end
                var dependency_values = version_extern_strings;
                var dependency_names = all_dependency_names_and_values;
                var prev_extern_bin_group: ?[]ExternalString = null;
                const empty_version = bun.serializable(PackageVersion{
                    .bin = Bin.init(),
                });

                for (versions) |prop| {
                    const version_name = prop.key.?.asString(allocator) orelse continue;
                    var sliced_version = SlicedString.init(version_name, version_name);
                    var parsed_version = Semver.Version.parse(sliced_version);

                    if (Environment.allow_assert) bun.assertWithLocation(parsed_version.valid, @src());
                    // We only need to copy the version tags if it contains pre and/or build
                    if (parsed_version.version.tag.hasBuild() or parsed_version.version.tag.hasPre()) {
                        const version_string = string_builder.append(String, version_name);
                        sliced_version = version_string.sliced(string_buf);
                        parsed_version = Semver.Version.parse(sliced_version);
                        if (Environment.allow_assert) {
                            bun.assertWithLocation(parsed_version.valid, @src());
                            bun.assertWithLocation(parsed_version.version.tag.hasBuild() or parsed_version.version.tag.hasPre(), @src());
                        }
                    }
                    if (!parsed_version.valid) continue;

                    bundled_deps_set.map.clearRetainingCapacity();
                    bundle_all_deps = false;
                    if (prop.value.?.get("bundleDependencies") orelse prop.value.?.get("bundledDependencies")) |bundled_deps_expr| {
                        switch (bundled_deps_expr.data) {
                            .e_boolean => |boolean| {
                                bundle_all_deps = boolean.value;
                            },
                            .e_array => |arr| {
                                for (arr.slice()) |bundled_dep| {
                                    try bundled_deps_set.insert(bundled_dep.asString(allocator) orelse continue);
                                }
                            },
                            else => {},
                        }
                    }

                    var package_version: PackageVersion = empty_version;

                    if (prop.value.?.asProperty("cpu")) |cpu_q| {
                        package_version.cpu = try Negatable(Architecture).fromJson(allocator, cpu_q.expr);
                    }

                    if (prop.value.?.asProperty("os")) |os_q| {
                        package_version.os = try Negatable(OperatingSystem).fromJson(allocator, os_q.expr);
                    }

                    if (prop.value.?.asProperty("libc")) |libc| {
                        package_version.libc = try Negatable(Libc).fromJson(allocator, libc.expr);
                    }

                    if (prop.value.?.asProperty("hasInstallScript")) |has_install_script| {
                        switch (has_install_script.expr.data) {
                            .e_boolean => |val| {
                                package_version.has_install_script = val.value;
                            },
                            else => {},
                        }
                    }

                    bin: {
                        // bins are extremely repetitive
                        // We try to avoid storing copies the string
                        if (prop.value.?.asProperty("bin")) |bin| {
                            switch (bin.expr.data) {
                                .e_object => |obj| {
                                    switch (obj.properties.len) {
                                        0 => {},
                                        1 => {
                                            const bin_name = obj.properties.ptr[0].key.?.asString(allocator) orelse break :bin;
                                            const value = obj.properties.ptr[0].value.?.asString(allocator) orelse break :bin;

                                            package_version.bin = .{
                                                .tag = .named_file,
                                                .value = .{
                                                    .named_file = .{
                                                        string_builder.append(String, bin_name),
                                                        string_builder.append(String, value),
                                                    },
                                                },
                                            };
                                        },
                                        else => {
                                            var group_slice = extern_strings_bin_entries[0 .. obj.properties.len * 2];

                                            var is_identical = if (prev_extern_bin_group) |bin_group| bin_group.len == group_slice.len else false;
                                            var group_i: u32 = 0;

                                            for (obj.properties.slice()) |bin_prop| {
                                                group_slice[group_i] = string_builder.append(ExternalString, bin_prop.key.?.asString(allocator) orelse break :bin);
                                                if (is_identical) {
                                                    is_identical = group_slice[group_i].hash == prev_extern_bin_group.?[group_i].hash;
                                                    if (comptime Environment.allow_assert) {
                                                        if (is_identical) {
                                                            const first = group_slice[group_i].slice(string_builder.allocatedSlice());
                                                            const second = prev_extern_bin_group.?[group_i].slice(string_builder.allocatedSlice());
                                                            if (!strings.eqlLong(first, second, true)) {
                                                                Output.panic("Bin group is not identical: {s} != {s}", .{ first, second });
                                                            }
                                                        }
                                                    }
                                                }
                                                group_i += 1;

                                                group_slice[group_i] = string_builder.append(ExternalString, bin_prop.value.?.asString(allocator) orelse break :bin);
                                                if (is_identical) {
                                                    is_identical = group_slice[group_i].hash == prev_extern_bin_group.?[group_i].hash;
                                                    if (comptime Environment.allow_assert) {
                                                        if (is_identical) {
                                                            const first = group_slice[group_i].slice(string_builder.allocatedSlice());
                                                            const second = prev_extern_bin_group.?[group_i].slice(string_builder.allocatedSlice());
                                                            if (!strings.eqlLong(first, second, true)) {
                                                                Output.panic("Bin group is not identical: {s} != {s}", .{ first, second });
                                                            }
                                                        }
                                                    }
                                                }
                                                group_i += 1;
                                            }

                                            if (is_identical) {
                                                group_slice = prev_extern_bin_group.?;
                                            } else {
                                                prev_extern_bin_group = group_slice;
                                                extern_strings_bin_entries = extern_strings_bin_entries[group_slice.len..];
                                            }

                                            package_version.bin = .{
                                                .tag = .map,
                                                .value = .{ .map = ExternalStringList.init(all_extern_strings_bin_entries, group_slice) },
                                            };
                                        },
                                    }

                                    break :bin;
                                },
                                .e_string => |stri| {
                                    if (stri.data.len > 0) {
                                        package_version.bin = .{
                                            .tag = .file,
                                            .value = .{
                                                .file = string_builder.append(String, stri.data),
                                            },
                                        };
                                        break :bin;
                                    }
                                },
                                else => {},
                            }
                        }

                        if (prop.value.?.asProperty("directories")) |dirs| {
                            // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                            // Because of the way the bin directive works,
                            // specifying both a bin path and setting
                            // directories.bin is an error. If you want to
                            // specify individual files, use bin, and for all
                            // the files in an existing bin directory, use
                            // directories.bin.
                            if (dirs.expr.asProperty("bin")) |bin_prop| {
                                if (bin_prop.expr.asString(allocator)) |str_| {
                                    if (str_.len > 0) {
                                        package_version.bin = .{
                                            .tag = .dir,
                                            .value = .{
                                                .dir = string_builder.append(String, str_),
                                            },
                                        };
                                        break :bin;
                                    }
                                }
                            }
                        }
                    }

                    integrity: {
                        if (prop.value.?.asProperty("dist")) |dist| {
                            if (dist.expr.data == .e_object) {
                                if (dist.expr.asProperty("tarball")) |tarball_q| {
                                    if (tarball_q.expr.data == .e_string and tarball_q.expr.data.e_string.len() > 0) {
                                        package_version.tarball_url = string_builder.append(ExternalString, tarball_q.expr.data.e_string.slice(allocator));
                                        tarball_url_strings[0] = package_version.tarball_url;
                                        tarball_url_strings = tarball_url_strings[1..];
                                    }
                                }

                                if (dist.expr.asProperty("fileCount")) |file_count_| {
                                    if (file_count_.expr.data == .e_number) {
                                        package_version.file_count = file_count_.expr.data.e_number.toU32();
                                    }
                                }

                                if (dist.expr.asProperty("unpackedSize")) |file_count_| {
                                    if (file_count_.expr.data == .e_number) {
                                        package_version.unpacked_size = file_count_.expr.data.e_number.toU32();
                                    }
                                }

                                if (dist.expr.asProperty("integrity")) |shasum| {
                                    if (shasum.expr.asString(allocator)) |shasum_str| {
                                        package_version.integrity = Integrity.parse(shasum_str);
                                        if (package_version.integrity.tag.isSupported()) break :integrity;
                                    }
                                }

                                if (dist.expr.asProperty("shasum")) |shasum| {
                                    if (shasum.expr.asString(allocator)) |shasum_str| {
                                        package_version.integrity = Integrity.parseSHASum(shasum_str) catch Integrity{};
                                    }
                                }
                            }
                        }
                    }

                    var non_optional_peer_dependency_offset: usize = 0;

                    inline for (dependency_groups) |pair| {
                        if (prop.value.?.asProperty(comptime pair.prop)) |versioned_deps| {
                            if (versioned_deps.expr.data == .e_object) {
                                const items = versioned_deps.expr.data.e_object.properties.slice();
                                var count = items.len;

                                var this_names = dependency_names[0..count];
                                var this_versions = dependency_values[0..count];

                                var name_hasher = bun.Wyhash11.init(0);
                                var version_hasher = bun.Wyhash11.init(0);

                                const is_peer = comptime strings.eqlComptime(pair.prop, "peerDependencies");

                                if (comptime is_peer) {
                                    optional_peer_dep_names.clearRetainingCapacity();

                                    if (prop.value.?.asProperty("peerDependenciesMeta")) |meta| {
                                        if (meta.expr.data == .e_object) {
                                            const meta_props = meta.expr.data.e_object.properties.slice();
                                            try optional_peer_dep_names.ensureUnusedCapacity(meta_props.len);
                                            for (meta_props) |meta_prop| {
                                                if (meta_prop.value.?.asProperty("optional")) |optional| {
                                                    if (optional.expr.data != .e_boolean or !optional.expr.data.e_boolean.value) {
                                                        continue;
                                                    }

                                                    optional_peer_dep_names.appendAssumeCapacity(String.Builder.stringHash(meta_prop.key.?.asString(allocator) orelse unreachable));
                                                }
                                            }
                                        }
                                    }
                                }

                                const bundled_deps_begin = bundled_deps_offset;

                                var i: usize = 0;

                                for (items) |item| {
                                    const name_str = item.key.?.asString(allocator) orelse if (comptime Environment.allow_assert) unreachable else continue;
                                    const version_str = item.value.?.asString(allocator) orelse if (comptime Environment.allow_assert) unreachable else continue;

                                    this_names[i] = string_builder.append(ExternalString, name_str);
                                    this_versions[i] = string_builder.append(ExternalString, version_str);

                                    if (!bundle_all_deps and bundled_deps_set.swapRemove(name_str)) {
                                        bundled_deps_buf[bundled_deps_offset] = this_names[i].hash;
                                        bundled_deps_offset += 1;
                                    }

                                    if (comptime is_peer) {
                                        if (std.mem.indexOfScalar(u64, optional_peer_dep_names.items, this_names[i].hash) != null) {
                                            // For optional peer dependencies, we store a length instead of a whole separate array
                                            // To make that work, we have to move optional peer dependencies to the front of the array
                                            //
                                            if (non_optional_peer_dependency_offset != i) {
                                                const current_name = this_names[i];
                                                this_names[i] = this_names[non_optional_peer_dependency_offset];
                                                this_names[non_optional_peer_dependency_offset] = current_name;

                                                const current_version = this_versions[i];
                                                this_versions[i] = this_versions[non_optional_peer_dependency_offset];
                                                this_versions[non_optional_peer_dependency_offset] = current_version;
                                            }

                                            non_optional_peer_dependency_offset += 1;
                                        }

                                        if (optional_peer_dep_names.items.len == 0) {
                                            const names_hash_bytes = @as([8]u8, @bitCast(this_names[i].hash));
                                            name_hasher.update(&names_hash_bytes);
                                            const versions_hash_bytes = @as([8]u8, @bitCast(this_versions[i].hash));
                                            version_hasher.update(&versions_hash_bytes);
                                        }
                                    } else {
                                        const names_hash_bytes = @as([8]u8, @bitCast(this_names[i].hash));
                                        name_hasher.update(&names_hash_bytes);
                                        const versions_hash_bytes = @as([8]u8, @bitCast(this_versions[i].hash));
                                        version_hasher.update(&versions_hash_bytes);
                                    }

                                    i += 1;
                                }

                                count = i;

                                if (bundle_all_deps) {
                                    package_version.bundled_dependencies = ExternalPackageNameHashList.invalid;
                                } else {
                                    package_version.bundled_dependencies = ExternalPackageNameHashList.init(
                                        bundled_deps_buf,
                                        bundled_deps_buf[bundled_deps_begin..bundled_deps_offset],
                                    );
                                }

                                var name_list = ExternalStringList.init(all_extern_strings, this_names);
                                var version_list = ExternalStringList.init(version_extern_strings, this_versions);

                                if (comptime is_peer) {
                                    package_version.non_optional_peer_dependencies_start = @as(u32, @truncate(non_optional_peer_dependency_offset));
                                }

                                if (count > 0 and
                                    ((comptime !is_peer) or
                                    optional_peer_dep_names.items.len == 0))
                                {
                                    const name_map_hash = name_hasher.final();
                                    const version_map_hash = version_hasher.final();

                                    const name_entry = try all_extern_strings_dedupe_map.getOrPut(name_map_hash);
                                    if (name_entry.found_existing) {
                                        name_list = name_entry.value_ptr.*;
                                        this_names = name_list.mut(all_extern_strings);
                                    } else {
                                        name_entry.value_ptr.* = name_list;
                                        dependency_names = dependency_names[count..];
                                    }

                                    const version_entry = try version_extern_strings_dedupe_map.getOrPut(version_map_hash);
                                    if (version_entry.found_existing) {
                                        version_list = version_entry.value_ptr.*;
                                        this_versions = version_list.mut(version_extern_strings);
                                    } else {
                                        version_entry.value_ptr.* = version_list;
                                        dependency_values = dependency_values[count..];
                                    }
                                }

                                if (comptime is_peer) {
                                    if (optional_peer_dep_names.items.len > 0) {
                                        dependency_names = dependency_names[count..];
                                        dependency_values = dependency_values[count..];
                                    }
                                }

                                @field(package_version, pair.field) = ExternalStringMap{
                                    .name = name_list,
                                    .value = version_list,
                                };

                                if (comptime Environment.allow_assert) {
                                    const dependencies_list = @field(package_version, pair.field);

                                    bun.assertWithLocation(dependencies_list.name.off < all_extern_strings.len, @src());
                                    bun.assertWithLocation(dependencies_list.value.off < all_extern_strings.len, @src());
                                    bun.assertWithLocation(dependencies_list.name.off + dependencies_list.name.len < all_extern_strings.len, @src());
                                    bun.assertWithLocation(dependencies_list.value.off + dependencies_list.value.len < all_extern_strings.len, @src());

                                    bun.assertWithLocation(std.meta.eql(dependencies_list.name.get(all_extern_strings), this_names), @src());
                                    bun.assertWithLocation(std.meta.eql(dependencies_list.value.get(version_extern_strings), this_versions), @src());
                                    var j: usize = 0;
                                    const name_dependencies = dependencies_list.name.get(all_extern_strings);

                                    if (comptime is_peer) {
                                        if (optional_peer_dep_names.items.len == 0) {
                                            while (j < name_dependencies.len) : (j += 1) {
                                                const dep_name = name_dependencies[j];
                                                bun.assertWithLocation(std.mem.eql(u8, dep_name.slice(string_buf), this_names[j].slice(string_buf)), @src());
                                                bun.assertWithLocation(std.mem.eql(u8, dep_name.slice(string_buf), items[j].key.?.asString(allocator).?), @src());
                                            }

                                            j = 0;
                                            while (j < dependencies_list.value.len) : (j += 1) {
                                                const dep_name = dependencies_list.value.get(version_extern_strings)[j];

                                                bun.assertWithLocation(std.mem.eql(u8, dep_name.slice(string_buf), this_versions[j].slice(string_buf)), @src());
                                                bun.assertWithLocation(std.mem.eql(u8, dep_name.slice(string_buf), items[j].value.?.asString(allocator).?), @src());
                                            }
                                        }
                                    } else {
                                        while (j < name_dependencies.len) : (j += 1) {
                                            const dep_name = name_dependencies[j];
                                            bun.assertWithLocation(std.mem.eql(u8, dep_name.slice(string_buf), this_names[j].slice(string_buf)), @src());
                                            bun.assertWithLocation(std.mem.eql(u8, dep_name.slice(string_buf), items[j].key.?.asString(allocator).?), @src());
                                        }

                                        j = 0;
                                        while (j < dependencies_list.value.len) : (j += 1) {
                                            const dep_name = dependencies_list.value.get(version_extern_strings)[j];

                                            bun.assertWithLocation(std.mem.eql(u8, dep_name.slice(string_buf), this_versions[j].slice(string_buf)), @src());
                                            bun.assertWithLocation(std.mem.eql(u8, dep_name.slice(string_buf), items[j].value.?.asString(allocator).?), @src());
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (!parsed_version.version.tag.hasPre()) {
                        release_versions[0] = parsed_version.version.min();
                        versioned_package_releases[0] = package_version;
                        release_versions = release_versions[1..];
                        versioned_package_releases = versioned_package_releases[1..];
                    } else {
                        prerelease_versions[0] = parsed_version.version.min();
                        versioned_package_prereleases[0] = package_version;
                        prerelease_versions = prerelease_versions[1..];
                        versioned_package_prereleases = versioned_package_prereleases[1..];
                    }
                }

                extern_strings = all_extern_strings[all_dependency_names_and_values.len - dependency_names.len ..];
                version_extern_strings = version_extern_strings[0 .. version_extern_strings.len - dependency_values.len];
            }
        }

        if (json.asProperty("dist-tags")) |dist| {
            if (dist.expr.data == .e_object) {
                const tags = dist.expr.data.e_object.properties.slice();
                var extern_strings_slice = extern_strings[0..dist_tags_count];
                var dist_tag_i: usize = 0;

                for (tags) |tag| {
                    if (tag.key.?.asString(allocator)) |key| {
                        extern_strings_slice[dist_tag_i] = string_builder.append(ExternalString, key);

                        const version_name = tag.value.?.asString(allocator) orelse continue;

                        const dist_tag_value_literal = string_builder.append(ExternalString, version_name);

                        const sliced_string = dist_tag_value_literal.value.sliced(string_buf);

                        dist_tag_versions[dist_tag_i] = Semver.Version.parse(sliced_string).version.min();
                        dist_tag_i += 1;
                    }
                }

                result.pkg.dist_tags = DistTagMap{
                    .tags = ExternalStringList.init(all_extern_strings, extern_strings_slice[0..dist_tag_i]),
                    .versions = VersionSlice.init(all_semver_versions, dist_tag_versions[0..dist_tag_i]),
                };

                if (comptime Environment.allow_assert) {
                    bun.assertWithLocation(std.meta.eql(result.pkg.dist_tags.versions.get(all_semver_versions), dist_tag_versions[0..dist_tag_i]), @src());
                    bun.assertWithLocation(std.meta.eql(result.pkg.dist_tags.tags.get(all_extern_strings), extern_strings_slice[0..dist_tag_i]), @src());
                }

                extern_strings = extern_strings[dist_tag_i..];
            }
        }

        if (last_modified.len > 0) {
            result.pkg.last_modified = string_builder.append(String, last_modified);
        }

        if (etag.len > 0) {
            result.pkg.etag = string_builder.append(String, etag);
        }

        if (json.asProperty("modified")) |name_q| {
            const field = name_q.expr.asString(allocator) orelse return null;

            result.pkg.modified = string_builder.append(String, field);
        }

        result.pkg.releases.keys = VersionSlice.init(all_semver_versions, all_release_versions);
        result.pkg.releases.values = PackageVersionList.init(versioned_packages, all_versioned_package_releases);

        result.pkg.prereleases.keys = VersionSlice.init(all_semver_versions, all_prerelease_versions);
        result.pkg.prereleases.values = PackageVersionList.init(versioned_packages, all_versioned_package_prereleases);

        const max_versions_count = @max(all_release_versions.len, all_prerelease_versions.len);

        // Sort the list of packages in a deterministic order
        // Usually, npm will do this for us.
        // But, not always.
        // See https://github.com/oven-sh/bun/pull/6611
        //
        // The tricky part about this code is we need to sort two different arrays.
        // To do that, we create a 3rd array, containing indices into the other 2 arrays.
        // Creating a 3rd array is expensive! But mostly expensive if the size of the integers is large
        // Most packages don't have > 65,000 versions
        // So instead of having a hardcoded limit of how many packages we can sort, we ask
        //    > "How many bytes do we need to store the indices?"
        // We decide what size of integer to use based on that.
        const how_many_bytes_to_store_indices = switch (max_versions_count) {
            // log2(0) == Infinity
            0 => 0,
            // log2(1) == 0
            1 => 1,

            else => std.math.divCeil(usize, std.math.log2_int_ceil(usize, max_versions_count), 8) catch 0,
        };

        switch (how_many_bytes_to_store_indices) {
            inline 1...8 => |int_bytes| {
                const Int = std.meta.Int(.unsigned, int_bytes * 8);

                const ExternVersionSorter = struct {
                    string_bytes: []const u8,
                    all_versions: []const Semver.Version,
                    all_versioned_packages: []const PackageVersion,

                    pub fn isLessThan(this: @This(), left: Int, right: Int) bool {
                        return this.all_versions[left].order(this.all_versions[right], this.string_bytes, this.string_bytes) == .lt;
                    }
                };

                var all_indices = try bun.default_allocator.alloc(Int, max_versions_count);
                defer bun.default_allocator.free(all_indices);
                const releases_list = .{ &result.pkg.releases, &result.pkg.prereleases };

                var all_cloned_versions = try bun.default_allocator.alloc(Semver.Version, max_versions_count);
                defer bun.default_allocator.free(all_cloned_versions);

                var all_cloned_packages = try bun.default_allocator.alloc(PackageVersion, max_versions_count);
                defer bun.default_allocator.free(all_cloned_packages);

                inline for (0..2) |release_i| {
                    var release = releases_list[release_i];
                    const indices = all_indices[0..release.keys.len];
                    const cloned_packages = all_cloned_packages[0..release.keys.len];
                    const cloned_versions = all_cloned_versions[0..release.keys.len];
                    const versioned_packages_ = @constCast(release.values.get(versioned_packages));
                    const semver_versions_ = @constCast(release.keys.get(all_semver_versions));
                    @memcpy(cloned_packages, versioned_packages_);
                    @memcpy(cloned_versions, semver_versions_);

                    for (indices, 0..indices.len) |*dest, i| {
                        dest.* = @truncate(i);
                    }

                    const sorter = ExternVersionSorter{
                        .string_bytes = string_buf,
                        .all_versions = semver_versions_,
                        .all_versioned_packages = versioned_packages_,
                    };
                    std.sort.pdq(Int, indices, sorter, ExternVersionSorter.isLessThan);

                    for (indices, versioned_packages_, semver_versions_) |i, *pkg, *version| {
                        pkg.* = cloned_packages[i];
                        version.* = cloned_versions[i];
                    }

                    if (comptime Environment.allow_assert) {
                        if (cloned_versions.len > 1) {
                            // Sanity check:
                            // When reading the versions, we iterate through the
                            // list backwards to choose the highest matching
                            // version
                            const first = semver_versions_[0];
                            const second = semver_versions_[1];
                            const order = second.order(first, string_buf, string_buf);
                            bun.assertWithLocation(order == .gt, @src());
                        }
                    }
                }
            },
            else => {
                bun.assertWithLocation(max_versions_count == 0, @src());
            },
        }

        if (extern_strings.len + tarball_urls_count > 0) {
            const src = std.mem.sliceAsBytes(all_tarball_url_strings[0 .. all_tarball_url_strings.len - tarball_url_strings.len]);
            if (src.len > 0) {
                var dst = std.mem.sliceAsBytes(all_extern_strings[all_extern_strings.len - extern_strings.len ..]);
                bun.assertWithLocation(dst.len >= src.len, @src());
                @memcpy(dst[0..src.len], src);
            }

            all_extern_strings = all_extern_strings[0 .. all_extern_strings.len - extern_strings.len];
        }

        result.pkg.string_lists_buf.off = 0;
        result.pkg.string_lists_buf.len = @as(u32, @truncate(all_extern_strings.len));

        result.pkg.versions_buf.off = 0;
        result.pkg.versions_buf.len = @as(u32, @truncate(all_semver_versions.len));

        result.versions = all_semver_versions;
        result.external_strings = all_extern_strings;
        result.external_strings_for_versions = version_extern_strings;
        result.package_versions = versioned_packages;
        result.extern_strings_bin_entries = all_extern_strings_bin_entries[0 .. all_extern_strings_bin_entries.len - extern_strings_bin_entries.len];
        result.bundled_deps_buf = bundled_deps_buf;
        result.pkg.public_max_age = public_max_age;

        if (string_builder.ptr) |ptr| {
            result.string_buf = ptr[0..string_builder.len];
        }

        return result;
    }
};

const assert = bun.assert;
