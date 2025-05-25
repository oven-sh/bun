// This is a Next.js-compatible file-system router.
// It uses the filesystem to infer entry points.
// Despite being Next.js-compatible, it's not tied to Next.js.
// It does not handle the framework parts of rendering pages.
// All it does is resolve URL paths to the appropriate entry point and parse URL params/query.
const Router = @This();

const Api = @import("./api/schema.zig").Api;
const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const PathString = bun.PathString;
const HashedString = bun.HashedString;
const Environment = bun.Environment;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const DirInfo = @import("./resolver/dir_info.zig");
const Fs = @import("./fs.zig");
const Options = @import("./options.zig");
const URLPath = @import("./http/url_path.zig");
const PathnameScanner = @import("./url.zig").PathnameScanner;
const CodepointIterator = @import("./string_immutable.zig").CodepointIterator;

const index_route_hash = @as(u32, @truncate(bun.hash("$$/index-route$$-!(@*@#&*%-901823098123")));

pub const Param = struct {
    name: string,
    value: string,

    pub const List = std.MultiArrayList(Param);
};

dir: StoredFileDescriptorType = .invalid,
routes: Routes,
loaded_routes: bool = false,
allocator: std.mem.Allocator,
fs: *Fs.FileSystem,
config: Options.RouteConfig,

pub fn init(
    fs: *Fs.FileSystem,
    allocator: std.mem.Allocator,
    config: Options.RouteConfig,
) !Router {
    return Router{
        .routes = Routes{
            .config = config,
            .allocator = allocator,
            .static = bun.StringHashMap(*Route).init(allocator),
        },
        .fs = fs,
        .allocator = allocator,
        .config = config,
    };
}

pub fn deinit(this: *Router) void {
    if (comptime Environment.isWindows) {
        for (this.routes.list.items(.filepath)) |abs_path| {
            this.allocator.free(abs_path);
        }
    }
}

pub fn getEntryPoints(this: *const Router) []const string {
    return this.routes.list.items(.filepath);
}

pub fn getPublicPaths(this: *const Router) []const string {
    return this.routes.list.items(.public_path);
}

pub fn routeIndexByHash(this: *const Router, hash: u32) ?usize {
    if (hash == index_route_hash) {
        return this.routes.index_id;
    }

    return std.mem.indexOfScalar(u32, this.routes.list.items(.hash), hash);
}

pub fn getNames(this: *const Router) []const string {
    return this.routes.list.items(.name);
}

pub const banned_dirs = [_]string{
    "node_modules",
};

const RouteIndex = struct {
    route: *Route,
    name: string,
    match_name: string,
    filepath: string,
    public_path: string,
    hash: u32,

    pub const List = std.MultiArrayList(RouteIndex);
};

pub const Routes = struct {
    list: RouteIndex.List = RouteIndex.List{},
    dynamic: []*Route = &[_]*Route{},
    dynamic_names: []string = &[_]string{},
    dynamic_match_names: []string = &[_]string{},

    /// completely static children of indefinite depth
    /// `"blog/posts"`
    /// `"dashboard"`
    /// `"profiles"`
    /// this is a fast path?
    static: bun.StringHashMap(*Route),

    /// Corresponds to "index.js" on the filesystem
    index: ?*Route = null,
    index_id: ?usize = 0,

    allocator: std.mem.Allocator,
    config: Options.RouteConfig,

    // This is passed here and propagated through Match
    // We put this here to avoid loading the FrameworkConfig for the client, on the server.
    client_framework_enabled: bool = false,

    pub fn matchPageWithAllocator(this: *Routes, _: string, url_path: URLPath, params: *Param.List, allocator: std.mem.Allocator) ?Match {
        // Trim trailing slash
        var path = url_path.path;
        var redirect = false;

        // Normalize trailing slash
        // "/foo/bar/index/" => "/foo/bar/index"
        if (path.len > 0 and path[path.len - 1] == '/') {
            path = path[0 .. path.len - 1];
            redirect = true;
        }

        // Normal case: "/foo/bar/index" => "/foo/bar"
        // Pathological: "/foo/bar/index/index/index/index/index/index" => "/foo/bar"
        // Extremely pathological: "/index/index/index/index/index/index/index" => "index"
        while (strings.endsWith(path, "/index")) {
            path = path[0 .. path.len - "/index".len];
            redirect = true;
        }

        if (strings.eqlComptime(path, "index")) {
            path = "";
            redirect = true;
        }

        // one final time, trim trailing slash
        while (path.len > 0 and path[path.len - 1] == '/') {
            path = path[0 .. path.len - 1];
            redirect = true;
        }

        if (strings.eqlComptime(path, ".")) {
            path = "";
            redirect = false;
        }

        if (path.len == 0) {
            if (this.index) |index| {
                return Match{
                    .params = params,
                    .name = index.name,
                    .path = index.abs_path.slice(),
                    .pathname = url_path.pathname,
                    .basename = index.basename,
                    .hash = index_route_hash,
                    .file_path = index.abs_path.slice(),
                    .query_string = url_path.query_string,
                    .client_framework_enabled = this.client_framework_enabled,
                };
            }

            return null;
        }

        const MatchContextType = struct {
            params: Param.List,
        };
        var matcher = MatchContextType{ .params = params.* };
        defer params.* = matcher.params;

        if (this.match(allocator, path, *MatchContextType, &matcher)) |route| {
            return Match{
                .params = params,
                .name = route.name,
                .path = route.abs_path.slice(),
                .pathname = url_path.pathname,
                .basename = route.basename,
                .hash = route.full_hash,
                .file_path = route.abs_path.slice(),
                .query_string = url_path.query_string,
                .client_framework_enabled = this.client_framework_enabled,
            };
        }

        return null;
    }

    pub fn matchPage(this: *Routes, _: string, url_path: URLPath, params: *Param.List) ?Match {
        return this.matchPageWithAllocator("", url_path, params, this.allocator);
    }

    fn matchDynamic(this: *Routes, allocator: std.mem.Allocator, path: string, comptime MatchContext: type, ctx: MatchContext) ?*Route {
        // its cleaned, so now we search the big list of strings
        for (this.dynamic_names, this.dynamic_match_names, this.dynamic) |case_sensitive_name, name, route| {
            if (Pattern.match(path, case_sensitive_name[1..], name, allocator, *@TypeOf(ctx.params), &ctx.params, true)) {
                return route;
            }
        }

        return null;
    }

    fn match(this: *Routes, allocator: std.mem.Allocator, pathname_: string, comptime MatchContext: type, ctx: MatchContext) ?*Route {
        const pathname = std.mem.trimLeft(u8, pathname_, "/");

        if (pathname.len == 0) {
            return this.index;
        }

        return this.static.get(pathname) orelse
            this.matchDynamic(allocator, pathname, MatchContext, ctx);
    }
};

const RouteLoader = struct {
    allocator: std.mem.Allocator,
    fs: *FileSystem,
    config: Options.RouteConfig,
    route_dirname_len: u16 = 0,

    dedupe_dynamic: std.AutoArrayHashMap(u32, string),
    log: *Logger.Log,
    index: ?*Route = null,
    static_list: bun.StringHashMap(*Route),
    all_routes: std.ArrayListUnmanaged(*Route),

    pub fn appendRoute(this: *RouteLoader, route: Route) void {
        // /index.js
        if (route.full_hash == index_route_hash) {
            const new_route = this.allocator.create(Route) catch unreachable;
            this.index = new_route;
            new_route.* = route;
            this.all_routes.append(this.allocator, new_route) catch unreachable;
            return;
        }

        // static route
        if (route.param_count == 0) {
            const entry = this.static_list.getOrPut(route.match_name.slice()) catch unreachable;

            if (entry.found_existing) {
                const source = Logger.Source.initEmptyFile(route.abs_path.slice());
                this.log.addErrorFmt(
                    &source,
                    Logger.Loc.Empty,
                    this.allocator,
                    "Route \"{s}\" is already defined by {s}",
                    .{ route.name, entry.value_ptr.*.abs_path.slice() },
                ) catch unreachable;
                return;
            }

            const new_route = this.allocator.create(Route) catch unreachable;
            new_route.* = route;

            // Handle static routes with uppercase characters by ensuring exact case still matches
            // Longer-term:
            // - We should have an option for controlling this behavior
            // - We should have an option for allowing case-sensitive matching
            // - But the default should be case-insensitive matching
            // This hack is below the engineering quality bar I'm happy with.
            // It will cause unexpected behavior.
            if (route.has_uppercase) {
                const static_entry = this.static_list.getOrPut(route.name[1..]) catch unreachable;
                if (static_entry.found_existing) {
                    const source = Logger.Source.initEmptyFile(route.abs_path.slice());
                    this.log.addErrorFmt(
                        &source,
                        Logger.Loc.Empty,
                        this.allocator,
                        "Route \"{s}\" is already defined by {s}",
                        .{ route.name, static_entry.value_ptr.*.abs_path.slice() },
                    ) catch unreachable;

                    return;
                }

                static_entry.value_ptr.* = new_route;
            }

            entry.value_ptr.* = new_route;
            this.all_routes.append(this.allocator, new_route) catch unreachable;

            return;
        }

        {
            const entry = this.dedupe_dynamic.getOrPutValue(route.full_hash, route.abs_path.slice()) catch unreachable;
            if (entry.found_existing) {
                const source = Logger.Source.initEmptyFile(route.abs_path.slice());
                this.log.addErrorFmt(
                    &source,
                    Logger.Loc.Empty,
                    this.allocator,
                    "Route \"{s}\" is already defined by {s}",
                    .{ route.name, entry.value_ptr.* },
                ) catch unreachable;
                return;
            }
        }

        {
            const new_route = this.allocator.create(Route) catch unreachable;
            new_route.* = route;
            this.all_routes.append(this.allocator, new_route) catch unreachable;
        }
    }

    pub fn loadAll(
        allocator: std.mem.Allocator,
        config: Options.RouteConfig,
        log: *Logger.Log,
        comptime ResolverType: type,
        resolver: *ResolverType,
        root_dir_info: *const DirInfo,
        base_dir: []const u8,
    ) Routes {
        var route_dirname_len: u16 = 0;

        const relative_dir = FileSystem.instance.relative(base_dir, config.dir);
        if (!strings.hasPrefixComptime(relative_dir, "..")) {
            route_dirname_len = @as(u16, @truncate(relative_dir.len + @as(usize, @intFromBool(config.dir[config.dir.len - 1] != std.fs.path.sep))));
        }

        var this = RouteLoader{
            .allocator = allocator,
            .log = log,
            .fs = resolver.fs,
            .config = config,
            .static_list = bun.StringHashMap(*Route).init(allocator),
            .dedupe_dynamic = std.AutoArrayHashMap(u32, string).init(allocator),
            .all_routes = .{},
            .route_dirname_len = route_dirname_len,
        };
        defer this.dedupe_dynamic.deinit();
        this.load(ResolverType, resolver, root_dir_info, base_dir);
        if (this.all_routes.items.len == 0) return Routes{
            .static = this.static_list,
            .config = config,
            .allocator = allocator,
        };

        std.sort.pdq(*Route, this.all_routes.items, Route.Sorter{}, Route.Sorter.sortByName);

        var route_list = RouteIndex.List{};
        route_list.setCapacity(allocator, this.all_routes.items.len) catch unreachable;

        var dynamic_start: ?usize = null;
        var index_id: ?usize = null;

        for (this.all_routes.items, 0..) |route, i| {
            if (@intFromEnum(route.kind) > @intFromEnum(Pattern.Tag.static) and dynamic_start == null) {
                dynamic_start = i;
            }

            if (route.full_hash == index_route_hash) index_id = i;

            route_list.appendAssumeCapacity(.{
                .name = route.name,
                .filepath = route.abs_path.slice(),
                .match_name = route.match_name.slice(),
                .public_path = route.public_path.slice(),
                .route = route,
                .hash = route.full_hash,
            });
        }

        var dynamic: []*Route = &[_]*Route{};
        var dynamic_names: []string = &[_]string{};
        var dynamic_match_names: []string = &[_]string{};

        if (dynamic_start) |dynamic_i| {
            dynamic = route_list.items(.route)[dynamic_i..];
            dynamic_names = route_list.items(.name)[dynamic_i..];
            dynamic_match_names = route_list.items(.match_name)[dynamic_i..];

            if (index_id) |index_i| {
                if (index_i > dynamic_i) {
                    // Due to the sorting order, the index route can be the last route.
                    // We don't want to attempt to match the index route or different stuff will break.
                    dynamic = dynamic[0 .. dynamic.len - 1];
                    dynamic_names = dynamic_names[0 .. dynamic_names.len - 1];
                    dynamic_match_names = dynamic_match_names[0 .. dynamic_match_names.len - 1];
                }
            }
        }

        return Routes{
            .list = route_list,
            .dynamic = dynamic,
            .dynamic_names = dynamic_names,
            .dynamic_match_names = dynamic_match_names,
            .static = this.static_list,
            .index = this.index,
            .config = config,
            .allocator = allocator,
            .index_id = index_id,
        };
    }

    pub fn load(
        this: *RouteLoader,
        comptime ResolverType: type,
        resolver: *ResolverType,
        root_dir_info: *const DirInfo,
        base_dir: []const u8,
    ) void {
        var fs = this.fs;

        if (root_dir_info.getEntriesConst()) |entries| {
            var iter = entries.data.iterator();
            outer: while (iter.next()) |entry_ptr| {
                const entry = entry_ptr.value_ptr.*;
                if (entry.base()[0] == '.') {
                    continue :outer;
                }

                switch (entry.kind(&fs.fs, false)) {
                    .dir => {
                        inline for (banned_dirs) |banned_dir| {
                            if (strings.eqlComptime(entry.base(), comptime banned_dir)) {
                                continue :outer;
                            }
                        }

                        var abs_parts = [_]string{ entry.dir, entry.base() };
                        if (resolver.readDirInfoIgnoreError(fs.abs(&abs_parts))) |_dir_info| {
                            const dir_info: *const DirInfo = _dir_info;

                            this.load(
                                ResolverType,
                                resolver,
                                dir_info,
                                base_dir,
                            );
                        }
                    },

                    .file => {
                        const extname = std.fs.path.extension(entry.base());
                        // exclude "." or ""
                        if (extname.len < 2) continue;

                        for (this.config.extensions) |_extname| {
                            if (strings.eql(extname[1..], _extname)) {
                                // length is extended by one
                                // entry.dir is a string with a trailing slash
                                if (comptime Environment.isDebug) {
                                    bun.assert(bun.path.isSepAny(entry.dir[base_dir.len - 1]));
                                }

                                const public_dir = entry.dir.ptr[base_dir.len - 1 .. entry.dir.len];

                                if (Route.parse(
                                    entry.base(),
                                    extname,
                                    entry,
                                    this.log,
                                    this.allocator,
                                    public_dir,
                                    this.route_dirname_len,
                                )) |route| {
                                    this.appendRoute(route);
                                }
                                break;
                            }
                        }
                    },
                }
            }
        }
    }
};

// This loads routes recursively, in depth-first order.
// it does not currently handle duplicate exact route matches. that's undefined behavior, for now.
pub fn loadRoutes(
    this: *Router,
    log: *Logger.Log,
    root_dir_info: *const DirInfo,
    comptime ResolverType: type,
    resolver: *ResolverType,
    base_dir: []const u8,
) anyerror!void {
    if (this.loaded_routes) return;
    this.routes = RouteLoader.loadAll(this.allocator, this.config, log, ResolverType, resolver, root_dir_info, base_dir);
    this.loaded_routes = true;
}

pub const TinyPtr = packed struct(u32) {
    offset: u16 = 0,
    len: u16 = 0,

    pub inline fn str(this: TinyPtr, slice: string) string {
        return if (this.len > 0) slice[this.offset .. this.offset + this.len] else "";
    }
    pub inline fn toStringPointer(this: TinyPtr) Api.StringPointer {
        return Api.StringPointer{ .offset = this.offset, .length = this.len };
    }

    pub inline fn eql(a: TinyPtr, b: TinyPtr) bool {
        return @as(u32, @bitCast(a)) == @as(u32, @bitCast(b));
    }

    pub fn from(parent: string, in: string) TinyPtr {
        if (in.len == 0 or parent.len == 0) return TinyPtr{};

        const right = @intFromPtr(in.ptr) + in.len;
        const end = @intFromPtr(parent.ptr) + parent.len;
        if (comptime Environment.isDebug) {
            bun.assert(end < right);
        }

        const length = @max(end, right) - right;
        const offset = @max(@intFromPtr(in.ptr), @intFromPtr(parent.ptr)) - @intFromPtr(parent.ptr);
        return TinyPtr{ .offset = @as(u16, @truncate(offset)), .len = @as(u16, @truncate(length)) };
    }
};

pub const Route = struct {
    /// Public display name for the route.
    /// "/", "/index" is "/"
    /// "/foo/index.js" becomes "/foo"
    /// case-sensitive, has leading slash
    name: string,

    /// Name used for matching.
    /// - Omits leading slash
    /// - Lowercased
    /// This is [inconsistent with Next.js](https://github.com/vercel/next.js/issues/21498)
    match_name: PathString,

    basename: string,
    full_hash: u32,
    param_count: u16,

    // On windows we need to normalize this path to have forward slashes.
    // To avoid modifying memory we do not own, allocate another buffer
    abs_path: if (Environment.isWindows) struct {
        path: string,

        pub fn slice(this: @This()) string {
            return this.path;
        }

        pub fn isEmpty(this: @This()) bool {
            return this.path.len == 0;
        }
    } else PathString,

    /// URL-safe path for the route's transpiled script relative to project's top level directory
    /// - It might not share a prefix with the absolute path due to symlinks.
    /// - It has a leading slash
    public_path: PathString,

    kind: Pattern.Tag = Pattern.Tag.static,

    has_uppercase: bool = false,

    pub const Ptr = TinyPtr;

    pub const index_route_name: string = "/";
    threadlocal var route_file_buf: bun.PathBuffer = undefined;
    threadlocal var second_route_file_buf: bun.PathBuffer = undefined;
    threadlocal var normalized_abs_path_buf: bun.windows.PathBuffer = undefined;

    pub const Sorter = struct {
        const sort_table: [std.math.maxInt(u8)]u8 = brk: {
            var table: [std.math.maxInt(u8)]u8 = undefined;
            for (&table, 0..) |*t, i| t.* = @as(u8, @intCast(i));

            // move dynamic routes to the bottom
            table['['] = 252;
            table[']'] = 253;
            // of each segment
            table['/'] = 254;
            break :brk table;
        };

        pub fn sortByNameString(_: @This(), lhs: string, rhs: string) bool {
            const math = std.math;

            const n = @min(lhs.len, rhs.len);
            for (lhs[0..n], rhs[0..n]) |lhs_i, rhs_i| {
                switch (math.order(sort_table[lhs_i], sort_table[rhs_i])) {
                    .eq => continue,
                    .lt => return true,
                    .gt => return false,
                }
            }
            return math.order(lhs.len, rhs.len) == .lt;
        }

        pub fn sortByName(ctx: @This(), a: *Route, b: *Route) bool {
            const a_name = a.match_name.slice();
            const b_name = b.match_name.slice();

            // route order determines route match order
            // - static routes go first because we match those first
            // - dynamic, catch-all, and optional catch all routes are sorted lexicographically, except "[", "]" appear last so that deepest routes are tested first
            // - catch-all & optional catch-all appear at the end because we want to test those at the end.
            return switch (std.math.order(@intFromEnum(a.kind), @intFromEnum(b.kind))) {
                .eq => switch (a.kind) {
                    // static + dynamic are sorted alphabetically
                    .static, .dynamic => @call(
                        .always_inline,
                        sortByNameString,
                        .{
                            ctx,
                            a_name,
                            b_name,
                        },
                    ),
                    // catch all and optional catch all must appear below dynamic
                    .catch_all, .optional_catch_all => switch (std.math.order(a.param_count, b.param_count)) {
                        .eq => @call(
                            .always_inline,
                            sortByNameString,
                            .{
                                ctx,
                                a_name,
                                b_name,
                            },
                        ),
                        .lt => false,
                        .gt => true,
                    },
                },
                .lt => true,
                .gt => false,
            };
        }
    };

    pub fn parse(
        base_: string,
        extname: string,
        entry: *Fs.FileSystem.Entry,
        log: *Logger.Log,
        allocator: std.mem.Allocator,
        public_dir_: string,
        routes_dirname_len: u16,
    ) ?Route {
        var abs_path_str: string = if (entry.abs_path.isEmpty())
            ""
        else
            entry.abs_path.slice();

        const base = base_[0 .. base_.len - extname.len];

        const public_dir = std.mem.trim(u8, public_dir_, std.fs.path.sep_str);

        // this is a path like
        // "/pages/index.js"
        // "/pages/foo/index.ts"
        // "/pages/foo/bar.tsx"
        // the name we actually store will often be this one
        var public_path: string = brk: {
            if (base.len == 0) break :brk public_dir;
            var buf: []u8 = &route_file_buf;

            if (public_dir.len > 0) {
                route_file_buf[0] = '/';
                buf = buf[1..];
                bun.copy(u8, buf, public_dir);
            }
            buf[public_dir.len] = '/';
            buf = buf[public_dir.len + 1 ..];
            bun.copy(u8, buf, base);
            buf = buf[base.len..];
            bun.copy(u8, buf, extname);
            buf = buf[extname.len..];

            if (comptime Environment.isWindows) {
                bun.path.platformToPosixInPlace(u8, route_file_buf[0 .. @intFromPtr(buf.ptr) - @intFromPtr(&route_file_buf)]);
            }

            break :brk route_file_buf[0 .. @intFromPtr(buf.ptr) - @intFromPtr(&route_file_buf)];
        };

        var name = public_path[0 .. public_path.len - extname.len];

        while (name.len > 1 and name[name.len - 1] == '/') {
            name = name[0 .. name.len - 1];
        }

        name = name[routes_dirname_len..];

        if (strings.endsWith(name, "/index")) {
            name = name[0 .. name.len - 6];
        }

        name = std.mem.trimRight(u8, name, "/");

        var match_name: string = name;

        var validation_result = Pattern.ValidationResult{};
        const is_index = name.len == 0;

        var has_uppercase = false;
        if (name.len > 0) {
            validation_result = Pattern.validate(
                name[1..],
                allocator,
                log,
            ) orelse return null;

            var name_i: usize = 0;
            while (!has_uppercase and name_i < public_path.len) : (name_i += 1) {
                has_uppercase = public_path[name_i] >= 'A' and public_path[name_i] <= 'Z';
            }

            const name_offset = @intFromPtr(name.ptr) - @intFromPtr(public_path.ptr);

            if (has_uppercase) {
                public_path = FileSystem.DirnameStore.instance.append(@TypeOf(public_path), public_path) catch unreachable;
                name = public_path[name_offset..][0..name.len];
                match_name = FileSystem.DirnameStore.instance.appendLowerCase(@TypeOf(name[1..]), name[1..]) catch unreachable;
            } else {
                public_path = FileSystem.DirnameStore.instance.append(@TypeOf(public_path), public_path) catch unreachable;
                name = public_path[name_offset..][0..name.len];
                match_name = name[1..];
            }

            if (Environment.allow_assert) bun.assert(match_name[0] != '/');
            if (Environment.allow_assert) bun.assert(name[0] == '/');
        } else {
            name = Route.index_route_name;
            match_name = Route.index_route_name;

            public_path = FileSystem.DirnameStore.instance.append(@TypeOf(public_path), public_path) catch unreachable;
        }

        if (abs_path_str.len == 0) {
            var file: std.fs.File = undefined;
            var needs_close = false;
            defer if (needs_close) file.close();
            if (entry.cache.fd.unwrapValid()) |valid| {
                file = valid.stdFile();
            } else {
                var parts = [_]string{ entry.dir, entry.base() };
                abs_path_str = FileSystem.instance.absBuf(&parts, &route_file_buf);
                route_file_buf[abs_path_str.len] = 0;
                const buf = route_file_buf[0..abs_path_str.len :0];
                file = std.fs.openFileAbsoluteZ(buf, .{ .mode = .read_only }) catch |err| {
                    log.addErrorFmt(null, Logger.Loc.Empty, allocator, "{s} opening route: {s}", .{ @errorName(err), abs_path_str }) catch unreachable;
                    return null;
                };
                FileSystem.setMaxFd(file.handle);

                needs_close = FileSystem.instance.fs.needToCloseFiles();
                if (!needs_close) entry.cache.fd = .fromStdFile(file);
            }

            const _abs = bun.getFdPath(.fromStdFile(file), &route_file_buf) catch |err| {
                log.addErrorFmt(null, Logger.Loc.Empty, allocator, "{s} resolving route: {s}", .{ @errorName(err), abs_path_str }) catch unreachable;
                return null;
            };

            abs_path_str = FileSystem.DirnameStore.instance.append(@TypeOf(_abs), _abs) catch unreachable;
            entry.abs_path = PathString.init(abs_path_str);
        }

        const abs_path = if (comptime Environment.isWindows)
            allocator.dupe(u8, bun.path.platformToPosixBuf(u8, abs_path_str, &normalized_abs_path_buf)) catch bun.outOfMemory()
        else
            PathString.init(abs_path_str);

        if (comptime Environment.allow_assert and Environment.isWindows) {
            bun.assert(!strings.containsChar(name, '\\'));
            bun.assert(!strings.containsChar(public_path, '\\'));
            bun.assert(!strings.containsChar(match_name, '\\'));
            bun.assert(!strings.containsChar(abs_path, '\\'));
            bun.assert(!strings.containsChar(entry.base(), '\\'));
        }

        return Route{
            .name = name,
            .basename = entry.base(),
            .public_path = PathString.init(public_path),
            .match_name = PathString.init(match_name),
            .full_hash = if (is_index)
                index_route_hash
            else
                @as(u32, @truncate(bun.hash(name))),
            .param_count = validation_result.param_count,
            .kind = validation_result.kind,
            .abs_path = if (comptime Environment.isWindows) .{
                .path = abs_path,
            } else abs_path,
            .has_uppercase = has_uppercase,
        };
    }
};

threadlocal var params_list: Param.List = undefined;

pub fn match(app: *Router, comptime Server: type, server: Server, comptime RequestContextType: type, ctx: *RequestContextType) !void {
    ctx.matched_route = null;

    // If there's an extname assume it's an asset and not a page
    switch (ctx.url.extname.len) {
        0 => {},
        // json is used for updating the route client-side without a page reload
        "json".len => {
            if (!strings.eqlComptime(ctx.url.extname, "json")) {
                try ctx.handleRequest();
                return;
            }
        },
        else => {
            try ctx.handleRequest();
            return;
        },
    }

    params_list.shrinkRetainingCapacity(0);
    if (app.routes.matchPage(app.config.dir, ctx.url, &params_list)) |route| {
        if (route.redirect_path) |redirect| {
            try ctx.handleRedirect(redirect);
            return;
        }

        bun.assert(route.path.len > 0);

        if (comptime @hasField(std.meta.Child(Server), "watcher")) {
            if (server.watcher.watchloop_handle == null) {
                server.watcher.start() catch {};
            }
        }

        // ctx.matched_route = route;
        // RequestContextType.JavaScriptHandler.enqueue(ctx, server, &params_list) catch {
        //     server.javascript_enabled = false;
        // };
    }

    if (!ctx.controlled and !ctx.has_called_done) {
        try ctx.handleRequest();
    }
}

pub const Match = struct {
    /// normalized url path from the request
    path: string,
    /// raw url path from the request
    pathname: string,
    /// absolute filesystem path to the entry point
    file_path: string,
    /// route name, like `"posts/[id]"`
    name: string,

    client_framework_enabled: bool = false,

    /// basename of the route in the file system, including file extension
    basename: string,

    hash: u32,
    params: *Param.List,
    redirect_path: ?string = null,
    query_string: string = "",

    pub inline fn hasParams(this: Match) bool {
        return this.params.len > 0;
    }

    pub fn paramsIterator(this: *const Match) PathnameScanner {
        return PathnameScanner.init(this.pathname, this.name, this.params);
    }

    pub fn nameWithBasename(file_path: string, dir: string) string {
        var name = file_path;
        if (strings.indexOf(name, dir)) |i| {
            name = name[i + dir.len ..];
        }

        return name[0 .. name.len - std.fs.path.extension(name).len];
    }

    pub fn pathnameWithoutLeadingSlash(this: *const Match) string {
        return std.mem.trimLeft(u8, this.pathname, "/");
    }
};

const FileSystem = Fs.FileSystem;

const MockRequestContextType = struct {
    controlled: bool = false,
    url: URLPath,
    match_file_path_buf: [1024]u8 = undefined,

    handle_request_called: bool = false,
    redirect_called: bool = false,
    matched_route: ?Match = null,
    has_called_done: bool = false,

    pub fn handleRequest(this: *MockRequestContextType) !void {
        this.handle_request_called = true;
    }

    pub fn handleRedirect(this: *MockRequestContextType, _: string) !void {
        this.redirect_called = true;
    }

    pub const JavaScriptHandler = struct {
        pub fn enqueue(_: *MockRequestContextType, _: *MockServer, _: *Router.Param.List) !void {}
    };
};

pub const MockServer = struct {
    watchloop_handle: ?StoredFileDescriptorType = null,
    watcher: Watcher = Watcher{},

    pub const Watcher = struct {
        watchloop_handle: ?StoredFileDescriptorType = null,
        pub fn start(_: *Watcher) anyerror!void {}
    };
};

fn makeTest(cwd_path: string, data: anytype) !void {
    Output.initTest();
    bun.assert(cwd_path.len > 1 and !strings.eql(cwd_path, "/") and !strings.endsWith(cwd_path, "bun"));
    const bun_tests_dir = try std.fs.cwd().makeOpenPath("bun-test-scratch", .{});
    bun_tests_dir.deleteTree(cwd_path) catch {};

    const cwd = try bun_tests_dir.makeOpenPath(cwd_path, .{});
    try cwd.setAsCwd();

    const Data = @TypeOf(data);
    const fields: []const std.builtin.Type.StructField = comptime std.meta.fields(Data);
    inline for (fields) |field| {
        @setEvalBranchQuota(9999);
        const value = @field(data, field.name);

        if (std.fs.path.dirname(field.name)) |dir| {
            try cwd.makePath(dir);
        }
        var file = try cwd.createFile(field.name, .{ .truncate = true });
        try file.writeAll(value);

        file.close();
    }
}

const expect = std.testing.expect;
const expectEqual = std.testing.expectEqual;
const expectEqualStrings = std.testing.expectEqualStrings;
const expectStr = std.testing.expectEqualStrings;
const Logger = bun.logger;

pub const Test = struct {
    pub fn makeRoutes(comptime testName: string, data: anytype) !Routes {
        Output.initTest();
        try makeTest(testName, data);
        const JSAst = bun.JSAst;
        JSAst.Expr.Data.Store.create(default_allocator);
        JSAst.Stmt.Data.Store.create(default_allocator);
        const fs = try FileSystem.init(null);
        const top_level_dir = fs.top_level_dir;

        var pages_parts = [_]string{ top_level_dir, "pages" };
        const pages_dir = try Fs.FileSystem.instance.absAlloc(default_allocator, &pages_parts);
        // _ = try std.fs.makeDirAbsolute(
        //     pages_dir,
        // );
        const router = try Router.init(&FileSystem.instance, default_allocator, Options.RouteConfig{
            .dir = pages_dir,
            .routes_enabled = true,
            .extensions = &.{"js"},
        });

        const Resolver = @import("./resolver/resolver.zig").Resolver;
        var logger = Logger.Log.init(default_allocator);
        errdefer {
            logger.print(Output.errorWriter()) catch {};
        }

        const opts = Options.BundleOptions{
            .target = .browser,
            .loaders = undefined,
            .define = undefined,
            .log = &logger,
            .routes = router.config,
            .entry_points = &.{},
            .out_extensions = bun.StringHashMap(string).init(default_allocator),
            .transform_options = std.mem.zeroes(Api.TransformOptions),
            .external = Options.ExternalModules.init(
                default_allocator,
                &FileSystem.instance.fs,
                FileSystem.instance.top_level_dir,
                &.{},
                &logger,
                .browser,
            ),
        };

        var resolver = Resolver.init1(default_allocator, &logger, &FileSystem.instance, opts);

        const root_dir = (try resolver.readDirInfo(pages_dir)).?;
        return RouteLoader.loadAll(default_allocator, opts.routes, &logger, Resolver, &resolver, root_dir);
        // try router.loadRoutes(root_dir, Resolver, &resolver, 0, true);
        // var entry_points = try router.getEntryPoints(default_allocator);

        // try expectEqual(std.meta.fieldNames(@TypeOf(data)).len, entry_points.len);
        // return router;
    }

    pub fn make(comptime testName: string, data: anytype) !Router {
        try makeTest(testName, data);
        const JSAst = bun.JSAst;
        JSAst.Expr.Data.Store.create(default_allocator);
        JSAst.Stmt.Data.Store.create(default_allocator);
        const fs = try FileSystem.initWithForce(null, true);
        const top_level_dir = fs.top_level_dir;

        var pages_parts = [_]string{ top_level_dir, "pages" };
        const pages_dir = try Fs.FileSystem.instance.absAlloc(default_allocator, &pages_parts);
        // _ = try std.fs.makeDirAbsolute(
        //     pages_dir,
        // );
        var router = try Router.init(&FileSystem.instance, default_allocator, Options.RouteConfig{
            .dir = pages_dir,
            .routes_enabled = true,
            .extensions = &.{"js"},
        });

        const Resolver = @import("./resolver/resolver.zig").Resolver;
        var logger = Logger.Log.init(default_allocator);
        errdefer {
            logger.print(Output.errorWriter()) catch {};
        }

        const opts = Options.BundleOptions{
            .target = .browser,
            .loaders = undefined,
            .define = undefined,
            .log = &logger,
            .routes = router.config,
            .entry_points = &.{},
            .out_extensions = bun.StringHashMap(string).init(default_allocator),
            .transform_options = std.mem.zeroes(Api.TransformOptions),
            .external = Options.ExternalModules.init(
                default_allocator,
                &FileSystem.instance.fs,
                FileSystem.instance.top_level_dir,
                &.{},
                &logger,
                .browser,
            ),
        };

        var resolver = Resolver.init1(default_allocator, &logger, &FileSystem.instance, opts);

        const root_dir = (try resolver.readDirInfo(pages_dir)).?;
        try router.loadRoutes(
            &logger,
            root_dir,
            Resolver,
            &resolver,
            FileSystem.instance.top_level_dir,
        );
        const entry_points = router.getEntryPoints();

        try expectEqual(std.meta.fieldNames(@TypeOf(data)).len, entry_points.len);
        return router;
    }
};

const Pattern = struct {
    value: Value,
    len: RoutePathInt = 0,

    /// Match a filesystem route pattern to a URL path.
    pub fn match(
        // `path` must be lowercased and have no leading slash
        path: string,
        /// case-sensitive, must not have a leading slash
        name: string,
        /// case-insensitive, must not have a leading slash
        match_name: string,
        allocator: std.mem.Allocator,
        comptime ParamsListType: type,
        params: ParamsListType,
        comptime allow_optional_catch_all: bool,
    ) bool {
        var offset: RoutePathInt = 0;
        var path_ = path;
        while (offset < name.len) {
            var pattern = Pattern.init(match_name, offset) catch unreachable;
            offset = pattern.len;

            switch (pattern.value) {
                .static => |str| {
                    const segment = path_[0 .. std.mem.indexOfScalar(u8, path_, '/') orelse path_.len];
                    if (!str.eql(segment)) {
                        params.shrinkRetainingCapacity(0);
                        return false;
                    }

                    path_ = if (segment.len < path_.len)
                        path_[segment.len + 1 ..]
                    else
                        "";

                    if (path_.len == 0 and pattern.isEnd(name)) return true;
                },
                .dynamic => |dynamic| {
                    if (std.mem.indexOfScalar(u8, path_, '/')) |i| {
                        params.append(allocator, .{
                            .name = dynamic.str(name),
                            .value = path_[0..i],
                        }) catch unreachable;
                        path_ = path_[i + 1 ..];

                        if (pattern.isEnd(name)) {
                            params.shrinkRetainingCapacity(0);
                            return false;
                        }

                        continue;
                    } else if (pattern.isEnd(name)) {
                        params.append(allocator, .{
                            .name = dynamic.str(name),
                            .value = path_,
                        }) catch unreachable;
                        return true;
                    } else if (comptime allow_optional_catch_all) {
                        pattern = Pattern.init(match_name, offset) catch unreachable;

                        if (pattern.value == .optional_catch_all) {
                            params.append(allocator, .{
                                .name = dynamic.str(name),
                                .value = path_,
                            }) catch unreachable;
                            path_ = "";
                        }

                        return true;
                    }

                    if (comptime !allow_optional_catch_all) {
                        return true;
                    }
                },
                .catch_all => |dynamic| {
                    if (path_.len > 0) {
                        params.append(allocator, .{
                            .name = dynamic.str(name),
                            .value = path_,
                        }) catch unreachable;
                        return true;
                    }

                    return false;
                },
                .optional_catch_all => |dynamic| {
                    if (comptime allow_optional_catch_all) {
                        if (path_.len > 0) params.append(allocator, .{
                            .name = dynamic.str(name),
                            .value = path_,
                        }) catch unreachable;

                        return true;
                    }

                    return false;
                },
            }
        }

        return false;
    }

    pub const ValidationResult = struct {
        param_count: u16 = 0,
        kind: Tag = Tag.static,
    };
    /// Validate a Route pattern, returning the number of route parameters.
    /// `null` means invalid. Error messages are logged.
    /// That way, we can provide a list of all invalid routes rather than failing the first time.
    pub fn validate(input: string, allocator: std.mem.Allocator, log: *Logger.Log) ?ValidationResult {
        if (CodepointIterator.needsUTF8Decoding(input)) {
            const source = Logger.Source.initEmptyFile(input);
            log.addErrorFmt(
                &source,
                Logger.Loc.Empty,
                allocator,
                "Route name must be plaintext",
                .{},
            ) catch unreachable;
            return null;
        }

        var count: u16 = 0;
        var offset: RoutePathInt = 0;
        bun.assert(input.len > 0);
        var kind: u4 = @intFromEnum(Tag.static);
        const end = @as(u32, @truncate(input.len - 1));
        while (offset < end) {
            const pattern: Pattern = Pattern.initUnhashed(input, offset) catch |err| {
                const source = Logger.Source.initEmptyFile(input);
                switch (err) {
                    error.CatchAllMustBeAtTheEnd => {
                        log.addErrorFmt(
                            &source,
                            Logger.Loc.Empty,
                            allocator,
                            "Catch-all route must be at the end of the path",
                            .{},
                        ) catch unreachable;
                    },
                    error.InvalidCatchAllRoute => {
                        log.addErrorFmt(
                            &source,
                            Logger.Loc.Empty,
                            allocator,
                            "Invalid catch-all route, e.g. should be [...param]",
                            .{},
                        ) catch unreachable;
                    },
                    error.InvalidOptionalCatchAllRoute => {
                        log.addErrorFmt(
                            &source,
                            Logger.Loc.Empty,
                            allocator,
                            "Invalid optional catch-all route, e.g. should be [[...param]]",
                            .{},
                        ) catch unreachable;
                    },
                    error.InvalidRoutePattern => {
                        log.addErrorFmt(
                            &source,
                            Logger.Loc.Empty,
                            allocator,
                            "Invalid dynamic route",
                            .{},
                        ) catch unreachable;
                    },
                    error.MissingParamName => {
                        log.addErrorFmt(
                            &source,
                            Logger.Loc.Empty,
                            allocator,
                            "Route is missing a parameter name, e.g. [param]",
                            .{},
                        ) catch unreachable;
                    },
                    error.PatternMissingClosingBracket => {
                        log.addErrorFmt(
                            &source,
                            Logger.Loc.Empty,
                            allocator,
                            "Route is missing a closing bracket]",
                            .{},
                        ) catch unreachable;
                    },
                }
                return null;
            };
            offset = pattern.len;
            kind = @max(@intFromEnum(@as(Pattern.Tag, pattern.value)), kind);
            count += @as(u16, @intCast(@intFromBool(@intFromEnum(@as(Pattern.Tag, pattern.value)) > @intFromEnum(Pattern.Tag.static))));
        }

        return ValidationResult{ .param_count = count, .kind = @as(Tag, @enumFromInt(kind)) };
    }

    pub fn eql(a: Pattern, b: Pattern) bool {
        return a.len == b.len and a.value.eql(b.value);
    }

    pub const PatternParseError = error{
        CatchAllMustBeAtTheEnd,
        InvalidCatchAllRoute,
        InvalidOptionalCatchAllRoute,
        InvalidRoutePattern,
        MissingParamName,
        PatternMissingClosingBracket,
    };

    const RoutePathInt = u16;

    pub fn init(input: string, offset_: RoutePathInt) PatternParseError!Pattern {
        return initMaybeHash(input, offset_, true);
    }

    pub fn isEnd(this: Pattern, input: string) bool {
        return @as(usize, this.len) >= input.len - 1;
    }

    pub fn initUnhashed(input: string, offset_: RoutePathInt) PatternParseError!Pattern {
        return initMaybeHash(input, offset_, false);
    }

    inline fn initMaybeHash(input: string, offset_: RoutePathInt, comptime do_hash: bool) PatternParseError!Pattern {
        const initHashedString = if (comptime do_hash) HashedString.init else HashedString.initNoHash;

        var offset: RoutePathInt = offset_;

        while (input.len > @as(usize, offset) and input[offset] == '/') {
            offset += 1;
        }

        if (input.len == 0 or input.len <= @as(usize, offset)) return Pattern{
            .value = .{ .static = HashedString.empty },
            .len = @as(RoutePathInt, @truncate(@min(input.len, @as(usize, offset)))),
        };

        var i: RoutePathInt = offset;

        var tag = Tag.static;
        const end = @as(RoutePathInt, @intCast(input.len - 1));

        if (offset == end) return Pattern{ .len = offset, .value = .{ .static = HashedString.empty } };

        while (i <= end) : (i += 1) {
            switch (input[i]) {
                '/' => {
                    return Pattern{ .len = @min(i + 1, end), .value = .{ .static = initHashedString(input[offset..i]) } };
                },
                '[' => {
                    if (i > offset) {
                        return Pattern{ .len = i, .value = .{ .static = initHashedString(input[offset..i]) } };
                    }

                    tag = Tag.dynamic;

                    var param = TinyPtr{};

                    i += 1;

                    param.offset = i;

                    if (i >= end) return error.InvalidRoutePattern;

                    switch (input[i]) {
                        '/', ']' => return error.MissingParamName,
                        '[' => {
                            tag = Tag.optional_catch_all;

                            if (end < i + 4) {
                                return error.InvalidOptionalCatchAllRoute;
                            }

                            i += 1;

                            if (!strings.hasPrefixComptime(input[i..], "...")) return error.InvalidOptionalCatchAllRoute;
                            i += 3;
                            param.offset = i;
                        },
                        '.' => {
                            tag = Tag.catch_all;
                            i += 1;

                            if (end < i + 2) {
                                return error.InvalidCatchAllRoute;
                            }

                            if (!strings.hasPrefixComptime(input[i..], "..")) return error.InvalidCatchAllRoute;
                            i += 2;

                            param.offset = i;
                        },
                        else => {},
                    }

                    i += 1;
                    while (i <= end and input[i] != ']') : (i += 1) {
                        if (input[i] == '/') return error.InvalidRoutePattern;
                    }

                    if (i > end) return error.PatternMissingClosingBracket;

                    param.len = i - param.offset;

                    i += 1;

                    if (tag == Tag.optional_catch_all) {
                        if (input[i] != ']') return error.PatternMissingClosingBracket;
                        i += 1;
                    }

                    if (@intFromEnum(tag) > @intFromEnum(Tag.dynamic) and i <= end) return error.CatchAllMustBeAtTheEnd;

                    return Pattern{
                        .len = @min(i + 1, end),
                        .value = switch (tag) {
                            .dynamic => .{
                                .dynamic = param,
                            },
                            .catch_all => .{ .catch_all = param },
                            .optional_catch_all => .{ .optional_catch_all = param },
                            else => unreachable,
                        },
                    };
                },
                else => {},
            }
        }
        return Pattern{ .len = i, .value = .{ .static = HashedString.init(input[offset..i]) } };
    }

    pub const Tag = enum(u4) {
        static = 0,
        dynamic = 1,
        catch_all = 2,
        optional_catch_all = 3,
    };

    pub const Value = union(Tag) {
        static: HashedString,
        dynamic: TinyPtr,
        catch_all: TinyPtr,
        optional_catch_all: TinyPtr,

        pub fn eql(a: Value, b: Value) bool {
            return @as(Tag, a) == @as(Tag, b) and switch (a) {
                .static => HashedString.eql(a.static, b.static),
                .dynamic => a.dynamic.eql(b.dynamic),
                .catch_all => a.catch_all.eql(b.catch_all),
                .optional_catch_all => a.optional_catch_all.eql(b.optional_catch_all),
            };
        }
    };
};

test "Pattern Match" {
    Output.initTest();
    const Entry = Param;

    const regular_list = .{
        .@"404" = .{
            "404",
            &[_]Entry{},
        },
        .@"[teamSlug]" = .{
            "value",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "value" },
            },
        },
        .@"hi/hello/[teamSlug]" = .{
            "hi/hello/123",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "123" },
            },
        },
        .@"hi/[teamSlug]/hello" = .{
            "hi/123/hello",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "123" },
            },
        },
        .@"[teamSlug]/hi/hello" = .{
            "123/hi/hello",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "123" },
            },
        },
        .@"[teamSlug]/[project]" = .{
            "team/bacon",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "team" },
                .{ .name = "project", .value = "bacon" },
            },
        },
        .@"lemon/[teamSlug]/[project]" = .{
            "lemon/team/bacon",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "team" },
                .{ .name = "project", .value = "bacon" },
            },
        },
        .@"[teamSlug]/[project]/lemon" = .{
            "team/bacon/lemon",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "team" },
                .{ .name = "project", .value = "bacon" },
            },
        },
        .@"[teamSlug]/lemon/[project]" = .{
            "team/lemon/lemon",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "team" },
                .{ .name = "project", .value = "lemon" },
            },
        },

        .@"[teamSlug]/lemon/[...project]" = .{
            "team/lemon/lemon-bacon-cheese/wow/brocollini",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "team" },
                .{ .name = "project", .value = "lemon-bacon-cheese/wow/brocollini" },
            },
        },

        .@"[teamSlug]/lemon/[project]/[[...slug]]" = .{
            "team/lemon/lemon/slugggg",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "team" },
                .{ .name = "project", .value = "lemon" },
                .{ .name = "slug", .value = "slugggg" },
            },
        },
    };

    const optional_catch_all = .{
        .@"404" = .{
            "404",
            &[_]Entry{},
        },
        .@"404/[[...slug]]" = .{
            "404",
            &[_]Entry{},
        },

        .@"404a/[[...slug]]" = .{
            "404a",
            &[_]Entry{},
        },

        .@"[teamSlug]/lemon/[project]/[[...slug]]" = .{
            "team/lemon/lemon/slugggg",
            &[_]Entry{
                .{ .name = "teamSlug", .value = "team" },
                .{ .name = "project", .value = "lemon" },
                .{ .name = "slug", .value = "slugggg" },
            },
        },
    };

    const TestList = struct {
        pub fn run(comptime list: anytype) usize {
            const ParamListType = std.MultiArrayList(Entry);
            var parameters = ParamListType{};
            var failures: usize = 0;
            inline for (comptime std.meta.fieldNames(@TypeOf(list))) |pattern| {
                parameters.shrinkRetainingCapacity(0);

                const part = comptime @field(list, pattern);
                const pathname = part.@"0";
                const entries = part.@"1";
                fail: {
                    if (!Pattern.match(pathname, pattern, pattern, default_allocator, *ParamListType, &parameters, true)) {
                        Output.prettyErrorln("Expected pattern <b>\"{s}\"<r> to match <b>\"{s}\"<r>", .{ pattern, pathname });
                        failures += 1;
                        break :fail;
                    }

                    if (comptime entries.len > 0) {
                        for (parameters.items(.name), 0..) |entry_name, i| {
                            if (!strings.eql(entry_name, entries[i].name)) {
                                failures += 1;
                                Output.prettyErrorln("{s} -- Expected name <b>\"{s}\"<r> but received <b>\"{s}\"<r> for path {s}", .{ pattern, entries[i].name, parameters.get(i).name, pathname });
                                break :fail;
                            }
                            if (!strings.eql(parameters.get(i).value, entries[i].value)) {
                                failures += 1;
                                Output.prettyErrorln("{s} -- Expected value <b>\"{s}\"<r> but received <b>\"{s}\"<r> for path {s}", .{ pattern, entries[i].value, parameters.get(i).value, pathname });
                                break :fail;
                            }
                        }
                    }

                    if (parameters.len != entries.len) {
                        Output.prettyErrorln("Expected parameter count for <b>\"{s}\"<r> to match <b>\"{s}\"<r>", .{ pattern, pathname });
                        failures += 1;
                        break :fail;
                    }
                }
            }
            return failures;
        }
    };

    if (TestList.run(regular_list) > 0) try expect(false);
    if (TestList.run(optional_catch_all) > 0) try expect(false);
}

test "Github API Route Loader" {
    var server = MockServer{};
    var ctx = MockRequestContextType{
        .url = try URLPath.parse("/hi"),
    };
    const fixtures = @import("./test/fixtures.zig");
    var router = try Test.make("routes-github-api", fixtures.github_api_routes_list);

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/organizations") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(!route.hasParams());
        try expectEqualStrings(route.name, "/organizations");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/app/installations/") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(!route.hasParams());
        try expectEqualStrings(route.name, "/app/installations");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/app/installations/123") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try expectEqualStrings(route.name, "/app/installations/[installation_id]");
        try expectEqualStrings(route.params.get(0).name, "installation_id");
        try expectEqualStrings(route.params.get(0).value, "123");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/codes_of_conduct/") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(!route.hasParams());
        try expectEqualStrings(route.name, "/codes_of_conduct");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/codes_of_conduct/123") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try expectEqualStrings(route.name, "/codes_of_conduct/[key]");
        try expectEqualStrings(route.params.get(0).name, "key");
        try expectEqualStrings(route.params.get(0).value, "123");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/codes_of_conduct/123/") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try expectEqualStrings(route.name, "/codes_of_conduct/[key]");
        try expectEqualStrings(route.params.get(0).name, "key");
        try expectEqualStrings(route.params.get(0).value, "123");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/orgs/123/index") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try expectEqualStrings(route.name, "/orgs/[org]");
        try expectEqualStrings(route.params.get(0).name, "org");
        try expectEqualStrings(route.params.get(0).value, "123");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/orgs/123/actions/permissions") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try expectEqualStrings(route.name, "/orgs/[org]/actions/permissions");
        try expectEqualStrings(route.params.get(0).name, "org");
        try expectEqualStrings(route.params.get(0).value, "123");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/orgs/orgg/teams/teamm/discussions/123/comments/999/reactions") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try expectEqualStrings(route.name, "/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/comments/[comment_number]/reactions");
        try expectEqualStrings(route.params.get(0).name, "org");
        try expectEqualStrings(route.params.get(0).value, "orgg");

        try expectEqualStrings(route.params.get(1).name, "team_slug");
        try expectEqualStrings(route.params.get(1).value, "teamm");

        try expectEqualStrings(route.params.get(2).name, "discussion_number");
        try expectEqualStrings(route.params.get(2).value, "123");

        try expectEqualStrings(route.params.get(3).name, "comment_number");
        try expectEqualStrings(route.params.get(3).value, "999");
    }
    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/repositories/123/environments/production/not-real") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try expectEqualStrings(route.name, "/repositories/[repository_id]/[...jarred-fake-catch-all]");
        try expectEqualStrings(route.params.get(0).name, "repository_id");
        try expectEqualStrings(route.params.get(0).value, "123");

        try expectEqualStrings(route.params.get(1).name, "jarred-fake-catch-all");
        try expectEqualStrings(route.params.get(1).value, "environments/production/not-real");

        try expectEqual(route.params.len, 2);
    }
}

test "Sample Route Loader" {
    var server = MockServer{};
    var ctx = MockRequestContextType{
        .url = try URLPath.parse("/hi"),
    };
    const fixtures = @import("./test/fixtures.zig");
    var router = try Test.make("routes-sample", fixtures.sample_route_list);

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/foo") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(!route.hasParams());
        try expectEqualStrings(route.name, "/Foo");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/Foo") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(!route.hasParams());
        try expectEqualStrings(route.name, "/Foo");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(!route.hasParams());
        try expectEqualStrings(route.name, "/");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/index") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(!route.hasParams());
        try expectEqualStrings(route.name, "/");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/Bacon/file") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(route.hasParams());
        try expectEqualStrings(route.name, "/[TitleCaseParam]/file");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/Bacon") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(route.hasParams());
        try expectEqualStrings(route.name, "/[TitleCaseParam]");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/Bacon/snow") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(route.hasParams());
        try expectEqualStrings(route.name, "/[TitleCaseParam]/[snake_case_param]");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/Bacon/snow/file") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(route.hasParams());
        try expectEqualStrings(route.name, "/[TitleCaseParam]/[snake_case_param]/file");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/Bacon/snow/bacon") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(route.hasParams());
        try expectEqualStrings(route.name, "/[TitleCaseParam]/[snake_case_param]/bacon");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/Bacon/snow/bacon/index") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(route.hasParams());
        try expectEqualStrings(route.name, "/[TitleCaseParam]/[snake_case_param]/bacon");
        try expectEqualStrings(route.params.get(0).name, "TitleCaseParam");
        try expectEqualStrings(route.params.get(0).value, "Bacon");

        try expectEqualStrings(route.params.get(1).name, "snake_case_param");
        try expectEqualStrings(route.params.get(1).value, "snow");
    }

    {
        ctx = MockRequestContextType{ .url = try URLPath.parse("/Bacon/snow/bacon/catch-all-should-happen") };
        try router.match(*MockServer, &server, MockRequestContextType, &ctx);
        var route = ctx.matched_route.?;
        try std.testing.expect(route.hasParams());
        try expectEqualStrings(route.name, "/[...catch-all-at-root]");
        try expectEqualStrings(route.params.get(0).name, "catch-all-at-root");
        try expectEqualStrings(route.params.get(0).value, "Bacon/snow/bacon/catch-all-should-happen");
    }
}

test "Routes basic" {
    var server = MockServer{};
    var ctx = MockRequestContextType{
        .url = try URLPath.parse("/hi"),
    };

    var router = try Test.make("routes-basic", .{
        .@"pages/hi.js" = "//hi",
        .@"pages/index.js" = "//index",
        .@"pages/blog/hi.js" = "//blog/hi",
    });
    try router.match(*MockServer, &server, MockRequestContextType, &ctx);
    try expectEqualStrings(ctx.matched_route.?.name, "/hi");

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/"),
    };

    try router.match(*MockServer, &server, MockRequestContextType, &ctx);
    try expectEqualStrings(ctx.matched_route.?.name, "/");

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/blog/hi"),
    };

    try router.match(*MockServer, &server, MockRequestContextType, &ctx);
    try expectEqualStrings(ctx.matched_route.?.name, "/blog/hi");

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/blog/hey"),
    };

    try router.match(*MockServer, &server, MockRequestContextType, &ctx);
    try expect(ctx.matched_route == null);

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/blog/"),
    };

    try router.match(*MockServer, &server, MockRequestContextType, &ctx);
    try expect(ctx.matched_route == null);

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/pages/hi"),
    };

    try router.match(*MockServer, &server, MockRequestContextType, &ctx);
    try expect(ctx.matched_route == null);
}

test "Dynamic routes" {
    var server = MockServer{};
    var ctx = MockRequestContextType{
        .url = try URLPath.parse("/blog/hi"),
    };
    var router = try Test.make("routes-dynamic", .{
        .@"pages/index.js" = "//index.js",
        .@"pages/blog/hi.js" = "//blog-hi",
        .@"pages/posts/[id].js" = "//hi",
        // .@"pages/blog/posts/bacon.js" = "//index",
    });

    try router.match(*MockServer, &server, MockRequestContextType, &ctx);
    try expectEqualStrings(ctx.matched_route.?.name, "/blog/hi");

    var params = ctx.matched_route.?.paramsIterator();
    try expect(params.next() == null);

    ctx.matched_route = null;

    ctx.url = try URLPath.parse("/posts/123");
    try router.match(*MockServer, &server, MockRequestContextType, &ctx);

    params = ctx.matched_route.?.paramsIterator();

    try expectEqualStrings(ctx.matched_route.?.name, "/posts/[id]");
    try expectEqualStrings(params.next().?.rawValue(ctx.matched_route.?.pathname), "123");

    // ctx = MockRequestContextType{
    //     .url = try URLPath.parse("/"),
    // };

    // try router.match(*MockServer, &server,  &server, MockRequestContextType, &ctx);
    // try expectEqualStrings(ctx.matched_route.name, "index");
}

test "Pattern" {
    const pattern = "[dynamic]/static/[dynamic2]/static2/[...catch_all]";

    const dynamic = try Pattern.init(pattern, 0);
    try expectStr(@tagName(dynamic.value), "dynamic");
    const static = try Pattern.init(pattern, dynamic.len);
    try expectStr(@tagName(static.value), "static");
    const dynamic2 = try Pattern.init(pattern, static.len);
    try expectStr(@tagName(dynamic2.value), "dynamic");
    const static2 = try Pattern.init(pattern, dynamic2.len);
    try expectStr(@tagName(static2.value), "static");
    const catch_all = try Pattern.init(pattern, static2.len);
    try expectStr(@tagName(catch_all.value), "catch_all");

    try expectStr(dynamic.value.dynamic.str(pattern), "dynamic");
    try expectStr(static.value.static.str(), "static");
    try expectStr(dynamic2.value.dynamic.str(pattern), "dynamic2");
    try expectStr(static2.value.static.str(), "static2");
    try expectStr(catch_all.value.catch_all.str(pattern), "catch_all");
}
