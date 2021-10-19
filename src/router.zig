// This is a Next.js-compatible file-system router.
// It uses the filesystem to infer entry points.
// Despite being Next.js-compatible, it's not tied to Next.js.
// It does not handle the framework parts of rendering pages.
// All it does is resolve URL paths to the appropriate entry point and parse URL params/query.
const Router = @This();

const Api = @import("./api/schema.zig").Api;
const std = @import("std");
usingnamespace @import("global.zig");

const DirInfo = @import("./resolver/dir_info.zig");
const Fs = @import("./fs.zig");
const Options = @import("./options.zig");
const allocators = @import("./allocators.zig");
const URLPath = @import("./http/url_path.zig");
const PathnameScanner = @import("./query_string_map.zig").PathnameScanner;
const CodepointIterator = @import("./string_immutable.zig").CodepointIterator;

const index_route_hash = @truncate(u32, std.hash.Wyhash.hash(0, "index"));
const arbitrary_max_route = 4096;

dir: StoredFileDescriptorType = 0,
routes: RouteMap,
loaded_routes: bool = false,
allocator: *std.mem.Allocator,
fs: *Fs.FileSystem,
config: Options.RouteConfig,

pub fn init(
    fs: *Fs.FileSystem,
    allocator: *std.mem.Allocator,
    config: Options.RouteConfig,
) !Router {
    return Router{
        .routes = RouteMap{
            .routes = RouteGroup.Root.initEmpty(),
            .index = null,
            .allocator = allocator,
            .config = config,
        },
        .fs = fs,
        .allocator = allocator,
        .config = config,
    };
}

pub const EntryPointList = struct {
    entry_points: []const string,
    buffer: []u8,
};
pub fn getEntryPointsWithBuffer(this: *const Router, allocator: *std.mem.Allocator, comptime absolute: bool) !EntryPointList {
    var i: u16 = 0;
    const route_count: u16 = @truncate(u16, this.routes.routes.len);

    var count: usize = 0;
    var str_len: usize = 0;

    while (i < route_count) : (i += 1) {
        const children = this.routes.routes.items(.children)[i];
        count += @intCast(
            usize,
            @boolToInt(children.len == 0),
        );
        if (children.len == 0) {
            const entry = this.routes.routes.items(.entry)[i];
            str_len += entry.base().len + entry.dir.len;
        }
    }

    var buffer = try allocator.alloc(u8, str_len + count);
    var remain = buffer;
    var entry_points = try allocator.alloc(string, count);

    i = 0;
    var entry_point_i: usize = 0;
    while (i < route_count) : (i += 1) {
        const children = this.routes.routes.items(.children)[i];
        if (children.len == 0) {
            const entry = this.routes.routes.items(.entry)[i];
            if (comptime absolute) {
                var parts = [_]string{ entry.dir, entry.base() };
                entry_points[entry_point_i] = this.fs.absBuf(&parts, remain);
            } else {
                var parts = [_]string{ "/", this.config.asset_prefix_path, this.fs.relativeTo(entry.dir), entry.base() };
                entry_points[entry_point_i] = this.fs.joinBuf(&parts, remain);
            }

            remain = remain[entry_points[entry_point_i].len..];
            entry_point_i += 1;
        }
    }

    return EntryPointList{ .entry_points = entry_points, .buffer = buffer };
}

pub fn getEntryPoints(this: *const Router, allocator: *std.mem.Allocator) ![]const string {
    const list = try getEntryPointsWithBuffer(this, allocator, true);
    return list.entry_points;
}

const banned_dirs = [_]string{
    "node_modules",
};

const RouteEntry = struct {
    route: *Route,
    hash: u32,

    pub const List = std.MultiArrayList(RouteEntry);

    pub fn indexInList(hashes: []u32, hash: u32) ?u32 {
        for (hashes) |hash_, i| {
            if (hash_ == hash) return @truncate(u32, i);
        }

        return null;
    }
};

pub const RouteGroup = struct {
    /// **Static child routes**
    /// Each key's pointer starts at the offset of the pattern string
    ///
    /// When no more dynamic paramters exist for the route, it will live in this hash table.
    ///
    /// index routes live in the parent's `RouteGroup` and do not have `"index"` in the key
    ///
    /// `"edit"` -> `"pages/posts/[id]/edit.js"`
    /// `"posts/all"` -> `"pages/posts/all.js"` 
    /// `"posts"` -> `"pages/posts/index.js"` or `"pages/posts.js"`        

    static: std.StringArrayHashMapUnmanaged(*Route) = std.StringArrayHashMapUnmanaged(*Route){},
    child: ?*RouteGroup = null,

/// **Dynamic Route**
///
/// When it's the final pattern in the route and there was no index route, this route will match. Only matches when there is still text for a single segment.
///
/// `posts/[id]` -> `"pages/posts/[id].js"`

    dynamic: ?*Route = null,

    /// **Catch all route**
///
/// 
///
/// `posts/[id]` -> `"pages/posts/[id].js"`
    catch_all: ?*Route = null,
    catch_all_is_optional: bool = false,

    offset: u32 = 0,

    pub const zero = RouteGroup{};

    pub fn isEmpty(this: *const RouteGroup) bool {
        this.dy
        return this.static.count() == 0 and this.child == null and this.index == null and this.dynamic == null and this.catch_all == null;
    }

    pub fn init() RouteGroup {
        return RouteGroup{
            .index = null,
            .static = std.StringArrayHashMapUnmanaged(*Route){},
        };
    }

    pub fn insert(this: *RouteGroup, allocator: *std.mem.Allocator, routes: []*Route, offset: u32) u32 {
        if (comptime isDebug) {
            std.debug.assert(offset > 0);
            std.debug.assert(this.offset == 0 or this.offset == offset);
        }

        this.offset = offset;

        var i: usize = 0;
        while (i < routes.len) {
            var j: usize = i + 1;
            defer i = j;
        }
    }

    pub const Root = struct {
        all: []*Route = &[_]*Route{},

        /// completely static children of indefinite depth
        /// `"blog/posts"`
        /// `"dashboard"`
        /// `"profiles"`
        /// this is a fast path?
        static: std.StringHashMap(*Route),

        /// The root can only have one of these 
        /// These routes have at least one parameter somewhere
        children: ?RouteGroup = null,

        /// Corresponds to "index.js" on the filesystem
        index: ?*Route = null,

        pub fn initEmpty() Root {
            return Root{
                .static = std.StringHashMap(*Route).init(default_allocator),
                .children = std.StringArrayHashMap(RouteGroup).init(default_allocator),
            };
        }

        pub fn insert(this: *Root, allocator: *std.mem.Allocator, log: *Logger.Log, children: []*Route) void {
            var i: u32 = 0;
            var end = @intCast(u32, children.len);
            var j: u32 = 0;
            while (i < children.len) {
                var route = children[i];

                if (comptime isDebug) {
                    std.debug.assert(route.param_count > 0);
                }

                const first_pattern = Pattern.init(route.name, 0) catch unreachable;

                // Since routes are sorted by [ appearing last
                // and we make all static routes fit into a separate hash table first
                // we can assume that if the pattern is the last one, it's a dynamic route of some kind
                if (first_pattern.isEnd(route.name)) {
                    switch (first_pattern.value) {
                        .static => unreachable, // thats a bug
                        .dynamic => {
                            if (this.dynamic != null) {
                                log.addErrorFmt(null, Logger.Loc.Empty, allocator,
                                    \\Multiple dynamic routes can't be on the root route. Rename either:
                                    \\
                                    \\ {s}
                                    \\ {s}
                                    \\
                                , .{
                                    route.abs_path.str(), this.dynamic.?.abs_path.str(),
                                });
                            }

                            this.dynamic = route;
                        },
                        .optional_catch_all, .catch_all => {
                            if (this.fallback != null) {
                                log.addErrorFmt(null, Logger.Loc.Empty, allocator,
                                    \\Multiple catch-all routes can't be on the root route. Rename either:
                                    \\
                                    \\  {s}
                                    \\  {s}
                                    \\
                                , .{
                                    route.abs_path.str(), this.fallback.?.abs_path.str(),
                                });
                            }

                            this.fallback = route;
                        },
                    }

                    return;
                }

                j = i + 1;
                defer i = j;

                if (j >= children.len) {
                    var entry = this.children.getOrPut(hashed_string.str()) catch unreachable;
                    if (!entry.found_existing) {
                        entry.value_ptr.* = RouteGroup.init(allocator);
                    }

                    _ = entry.value_ptr.insert(routes[@maximum(@as(usize, i), 1) - 1 ..], 0);
                    return;
                }

                var second_route = children[j];
                var second_pattern = Pattern.init(second_route.name, 0) catch unreachable;
                var prev_pattern = second_pattern;
                while (j < children.len and first_pattern.eql(second_pattern)) : (j += 1) {
                    prev_pattern = second_pattern;
                    second_route = children[j];
                }

                if (this.children == null) {
                    this.children = RouteGroup.init(allocator);
                }

                this.children.?.insert(routes[i..j], first_pattern.len);
            }
        }
    };
};

const RouteLoader = struct {
    allocator: *std.mem.Allocator,
    fs: *FileSystem,
    config: Options.RouteConfig,

    list: RouteEntry.List,
    log: *Logger.Log,
    index: ?*Route = null,
    static_list: std.StringHashMap(*Route),

    all_routes: std.ArrayListUnmanaged(*Route),

    pub fn appendRoute(this: *RouteLoader, route: Route) void {
        // /index.js
        if (route.full_hash == index_route_hash) {
            var new_route = this.allocator.create(Route) catch unreachable;
            this.index = new_route;
            this.all_routes.append(this.allocator, new_route) catch unreachable;
            return;
        }

        // static route
        if (route.param_count == 0) {
            var entry = this.static_list.getOrPut(route.name) catch unreachable;

            if (entry.found_existing) {
                const source = Logger.Source.initEmptyFile(route.abs_path.slice());
                this.log.addErrorFmt(
                    &source,
                    Logger.Loc.Empty,
                    this.allocator,
                    "Route {s} is already defined by {s}",
                    .{ route.name, entry.value_ptr.*.abs_path.slice() },
                ) catch unreachable;
                return;
            }

            var new_route = this.allocator.create(Route) catch unreachable;
            new_route.* = route;
            entry.value_ptr.* = new_route;
            this.all_routes.append(this.allocator, new_route) catch unreachable;
            return;
        }

        // dynamic-ish
        {
            // This becomes a dead pointer at the end
            var slice = this.list.slice();

            const hashes = slice.items(.hash);
            if (std.mem.indexOfScalar(u32, hashes, route.full_hash)) |i| {
                const routes = slice.items(.route);

                if (comptime isDebug) {
                    std.debug.assert(strings.eql(routes[i].name, route.name));
                }

                const source = Logger.Source.initEmptyFile(route.abs_path.slice());
                this.log.addErrorFmt(
                    &source,
                    Logger.Loc.Empty,
                    this.allocator,
                    "Route {s} is already defined by {s}",
                    .{ route.name, routes[i].abs_path.slice() },
                ) catch unreachable;
                return;
            }
        }

        {
            var new_route = this.allocator.create(Route) catch unreachable;
            new_route.* = route;

            this.list.append(
                this.allocator,
                .{
                    .hash = route.full_hash,
                    .route = new_route,
                },
            ) catch unreachable;
            this.all_routes.append(this.allocator, new_route) catch unreachable;
        }
    }

    pub fn loadAll(allocator: *std.mem.Allocator, config: Options.RouteConfig, log: *Logger.Log, comptime ResolverType: type, resolver: *ResolverType, root_dir_info: *const DirInfo) RouteGroup.Root {
        var this = RouteLoader{
            .allocator = allocator,
            .log = log,
            .fs = resolver.fs,
            .config = config,
            .list = .{},
            .static_list = std.StringHashMap(*Route).init(allocator),
            .all_routes = .{},
        };
        this.load(ResolverType, resolver, root_dir_info);
        if (this.list.len + this.static_list.count() == 0) return RouteGroup.Root.initEmpty();

        var root = RouteGroup.Root{
            .all = this.all_routes.toOwnedSlice(allocator),
            .index = this.index,
            .static = this.static_list,
            .children = std.StringArrayHashMap(RouteGroup).init(this.allocator),
        };

        var list = this.list.toOwnedSlice();

        var routes = list.items(.route);

        if (routes.len > 0) {
            std.sort.sort(*Route, routes, Route.Sorter{}, Route.Sorter.sortByName);
            for (routes) |route| {
                Output.prettyErrorln("\nName: <b>{s}<r>", .{route.name});
            }
            // root.insert(allocator, log, routes);
        }

        // return root;
        return root;
    }

    pub fn load(this: *RouteLoader, comptime ResolverType: type, resolver: *ResolverType, root_dir_info: *const DirInfo) void {
        var fs = this.fs;

        if (root_dir_info.getEntriesConst()) |entries| {
            var iter = entries.data.iterator();
            outer: while (iter.next()) |entry_ptr| {
                const entry = entry_ptr.value;
                if (entry.base()[0] == '.') {
                    continue :outer;
                }

                switch (entry.kind(&fs.fs)) {
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
                            );
                        }
                    },

                    .file => {
                        const extname = std.fs.path.extension(entry.base());
                        // exclude "." or ""
                        if (extname.len < 2) continue;

                        for (this.config.extensions) |_extname| {
                            if (strings.eql(extname[1..], _extname)) {
                                if (Route.parse(
                                    entry.base_lowercase(),
                                    // we extend the pointer length by one to get it's slash
                                    entry.dir.ptr[this.config.dir.len..entry.dir.len],
                                    extname,
                                    entry,
                                    this.log,
                                    this.allocator,
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
    root_dir_info: *const DirInfo,
    comptime ResolverType: type,
    resolver: *ResolverType,
    comptime is_root: bool,
) anyerror!void {}

pub const TinyPtr = packed struct {
    offset: u32 = 0,
    len: u32 = 0,

    pub inline fn str(this: TinyPtr, slice: string) string {
        return if (this.len > 0) slice[this.offset .. this.offset + this.len] else "";
    }
    pub inline fn toStringPointer(this: TinyPtr) Api.StringPointer {
        return Api.StringPointer{ .offset = this.offset, .length = this.len };
    }

    pub inline fn eql(a: TinyPtr, b: TinyPtr) bool {
        return @bitCast(u64, a) == @bitCast(u64, b);
    }
};

pub const Param = struct {
    key: TinyPtr,
    kind: RoutePart.Tag,
    value: TinyPtr,

    pub const List = std.MultiArrayList(Param);
};

pub const Route = struct {
    name: string,
    entry: *Fs.FileSystem.Entry,
    full_hash: u32,
    param_count: u16,
    abs_path: PathString,

    pub const Ptr = TinyPtr;

    pub const index_route_name: string = "index";
    var route_file_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    pub const Sorter = struct {
        const sort_table: [std.math.maxInt(u8)]u8 = brk: {
            var table: [std.math.maxInt(u8)]u8 = undefined;
            var i: u16 = 0;
            while (i < @as(u16, table.len)) {
                table[i] = @intCast(u8, i);
                i += 1;
            }
            // move dynamic routes to the bottom
            table['['] = 252;
            table[']'] = 253;
            // of each segment
            table['/'] = 1;
            break :brk table;
        };

        pub fn sortByNameString(ctx: @This(), lhs: string, rhs: string) bool {
            const math = std.math;

            const n = @minimum(lhs.len, rhs.len);
            var i: usize = 0;
            while (i < n) : (i += 1) {
                switch (math.order(sort_table[lhs[i]], sort_table[rhs[i]])) {
                    .eq => continue,
                    .lt => return true,
                    .gt => return false,
                }
            }
            return math.order(lhs.len, rhs.len) == .lt;
        }

        pub fn sortByName(ctx: @This(), a: *Route, b: *Route) bool {
            return @call(.{ .modifier = .always_inline }, sortByNameString, .{ ctx, a.name, b.name });
        }
    };

    pub fn parse(
        base_: string,
        dir: string,
        extname: string,
        entry: *Fs.FileSystem.Entry,
        log: *Logger.Log,
        allocator: *std.mem.Allocator,
    ) ?Route {
        var abs_path_str: string = if (entry.abs_path.isEmpty())
            ""
        else
            entry.abs_path.slice();

        var base = base_[0 .. base_.len - extname.len];

        if (strings.eql(base, "index")) {
            base = "";
        }

        var route_name: string = std.mem.trimRight(u8, dir, "/");

        var name: string = brk: {
            if (route_name.len == 0) break :brk base;
            _ = strings.copyLowercase(route_name, &route_file_buf);
            route_file_buf[route_name.len] = '/';
            std.mem.copy(u8, route_file_buf[route_name.len + 1 ..], base);
            break :brk route_file_buf[0 .. route_name.len + 1 + base.len];
        };

        while (name.len > 0 and name[name.len - 1] == '/') {
            name = name[0 .. name.len - 1];
        }

        name = std.mem.trimLeft(u8, name, "/");

        var param_count: u16 = 0;

        if (name.len > 0) {
            param_count = Pattern.validate(
                name,
                allocator,
                log,
            ) orelse return null;
            name = FileSystem.DirnameStore.instance.append(@TypeOf(name), name) catch unreachable;
        } else {
            name = Route.index_route_name;
        }

        if (abs_path_str.len == 0) {
            var file: std.fs.File = undefined;
            var needs_close = false;
            defer if (needs_close) file.close();
            if (entry.cache.fd != 0) {
                file = std.fs.File{ .handle = entry.cache.fd };
            } else {
                var parts = [_]string{ entry.dir, entry.base() };
                abs_path_str = FileSystem.instance.absBuf(&parts, &route_file_buf);
                route_file_buf[abs_path_str.len] = 0;
                var buf = route_file_buf[0..abs_path_str.len :0];
                file = std.fs.openFileAbsoluteZ(buf, .{ .read = true }) catch |err| {
                    log.addErrorFmt(null, Logger.Loc.Empty, allocator, "{s} opening route: {s}", .{ @errorName(err), abs_path_str }) catch unreachable;
                    return null;
                };
                FileSystem.setMaxFd(file.handle);

                needs_close = FileSystem.instance.fs.needToCloseFiles();
                if (!needs_close) entry.cache.fd = file.handle;
            }

            var _abs = std.os.getFdPath(file.handle, &route_file_buf) catch |err| {
                log.addErrorFmt(null, Logger.Loc.Empty, allocator, "{s} resolving route: {s}", .{ @errorName(err), abs_path_str }) catch unreachable;
                return null;
            };

            abs_path_str = FileSystem.DirnameStore.instance.append(@TypeOf(_abs), _abs) catch unreachable;
            entry.abs_path = PathString.init(abs_path_str);
        }

        return Route{
            .name = name,
            .entry = entry,
            .full_hash = @truncate(u32, std.hash.Wyhash.hash(0, abs_path_str)),
            .param_count = param_count,
            .abs_path = entry.abs_path,
        };
    }
};

// Reference: https://nextjs.org/docs/routing/introduction
// Examples:
// - pages/index.js => /
// - pages/foo.js => /foo
// - pages/foo/index.js => /foo
// - pages/foo/[bar] => {/foo/bacon, /foo/bar, /foo/baz, /foo/10293012930}
// - pages/foo/[...bar] => {/foo/bacon/toast, /foo/bar/what, /foo/baz, /foo/10293012930}
// Syntax:
// - [param-name]
// - Catch All: [...param-name]
// - Optional Catch All: [[...param-name]]
// Invalid syntax:
// - pages/foo/hello-[bar]
// - pages/foo/[bar]-foo
pub const RouteMap = struct {
    routes: RouteGroup.Root,
    index: ?u32,
    allocator: *std.mem.Allocator,
    config: Options.RouteConfig,

    // This is passed here and propagated through Match
    // We put this here to avoid loading the FrameworkConfig for the client, on the server.
    client_framework_enabled: bool = false,

    pub threadlocal var segments_buf: [128]string = undefined;
    pub threadlocal var segments_hash: [128]u32 = undefined;

    pub fn routePathLen(this: *const RouteMap, _ptr: u16) u16 {
        return this.appendRoutePath(_ptr, &[_]u8{}, false);
    }

    // This is probably really slow
    // But it might be fine because it's mostly looking up within the same array
    // and that array is probably in the cache line
    var ptr_buf: [arbitrary_max_route]u16 = undefined;
    // TODO: skip copying parent dirs when it's another file in the same parent dir
    pub fn appendRoutePath(this: *const RouteMap, tail: u16, buf: []u8, comptime write: bool) u16 {
        var head: u16 = this.routes.items(.parent)[tail];

        var ptr_buf_count: i32 = 0;
        var written: u16 = 0;
        while (!(head == Route.top_level_parent)) : (ptr_buf_count += 1) {
            ptr_buf[@intCast(usize, ptr_buf_count)] = head;
            head = this.routes.items(.parent)[head];
        }

        var i: usize = @intCast(usize, ptr_buf_count);
        var remain = buf;
        while (i > 0) : (i -= 1) {
            const path = this.routes.items(.path)[
                @intCast(
                    usize,
                    ptr_buf[i],
                )
            ];
            if (comptime write) {
                std.mem.copy(u8, remain, path);

                remain = remain[path.len..];
                remain[0] = std.fs.path.sep;
                remain = remain[1..];
            }
            written += @truncate(u16, path.len + 1);
        }

        {
            const path = this.routes.items(.path)[tail];
            if (comptime write) {
                std.mem.copy(u8, remain, path);
            }
            written += @truncate(u16, path.len);
        }

        return written;
    }

    const MatchContext = struct {
        params: *Param.List,
        segments: []string,
        hashes: []u32,
        map: *RouteMap,
        allocator: *std.mem.Allocator,
        redirect_path: ?string = "",
        url_path: URLPath,

        matched_route_buf: []u8 = undefined,

        file_path: string = "",

        pub fn matchDynamicRoute(
            this: *MatchContext,
            head_i: u16,
            segment_i: u16,
        ) ?Match {
            const start_len = this.params.len;
            var head = this.map.routes.get(head_i);
            const remaining: []string = this.segments[segment_i + 1 ..];

            if ((remaining.len > 0 and head.children.len == 0)) {
                return null;
            }

            switch (head.part.tag) {
                .exact => {
                    // is it the end of an exact match?
                    if (!(this.hashes.len > segment_i and this.hashes[segment_i] == head.hash)) {
                        return null;
                    }
                },
                else => {},
            }

            var match_result: Match = undefined;
            if (head.children.len > 0 and remaining.len > 0) {
                var child_i = head.children.offset;
                const last = child_i + head.children.len;
                var matched = false;
                while (child_i < last) : (child_i += 1) {
                    if (this.matchDynamicRoute(child_i, segment_i + 1)) |res| {
                        match_result = res;
                        matched = true;
                        break;
                    }
                }

                if (!matched) {
                    this.params.shrinkRetainingCapacity(start_len);
                    return null;
                }
                // this is a folder
            } else if (remaining.len == 0 and head.children.len > 0) {
                this.params.shrinkRetainingCapacity(start_len);
                return null;
            } else {
                const entry = head.entry;
                var parts = [_]string{ entry.dir, entry.base() };
                const file_path = Fs.FileSystem.instance.absBuf(&parts, this.matched_route_buf);

                match_result = Match{
                    .path = head.path,
                    .name = Match.nameWithBasename(file_path, this.map.config.dir),
                    .params = this.params,
                    .hash = head.full_hash,
                    .query_string = this.url_path.query_string,
                    .pathname = this.url_path.pathname,
                    .basename = entry.base(),
                    .file_path = file_path,
                };

                this.matched_route_buf[match_result.file_path.len] = 0;
            }

            // Now that we know for sure the route will match, we append the param
            switch (head.part.tag) {
                .param => {
                    // account for the slashes
                    var segment_offset: u16 = segment_i;
                    for (this.segments[0..segment_i]) |segment| {
                        segment_offset += @truncate(u16, segment.len);
                    }
                    var total_offset: u16 = 0;

                    var current_i: u16 = head.parent;
                    const slices = this.map.routes;
                    const names = slices.items(.name);
                    const parents = slices.items(.parent);
                    while (current_i != Route.top_level_parent) : (current_i = parents[current_i]) {
                        total_offset += @truncate(u16, names[current_i].len);
                    }

                    this.params.append(
                        this.allocator,
                        Param{
                            .key = .{ .offset = head.part.name.offset + total_offset + segment_i, .len = head.part.name.len },
                            .value = .{ .offset = segment_offset, .len = @truncate(u16, this.segments[segment_i].len) },
                            .kind = head.part.tag,
                        },
                    ) catch unreachable;
                },
                else => {},
            }

            return match_result;
        }
    };

    // This makes many passes over the list of routes
    // However, most of those passes are basically array.indexOf(number) and then smallerArray.indexOf(number)
    pub fn matchPage(this: *RouteMap, routes_dir: string, file_path_buf: []u8, url_path: URLPath, params: *Param.List) ?Match {
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

        if (strings.eqlComptime(path, ".")) {
            path = "";
            redirect = false;
        }

        const routes_slice = this.routes.slice();

        if (path.len == 0) {
            if (this.index) |index| {
                const entry = routes_slice.items(.entry)[index];
                const parts = [_]string{ entry.dir, entry.base() };

                return Match{
                    .params = params,
                    .name = routes_slice.items(.name)[index],
                    .path = routes_slice.items(.path)[index],
                    .pathname = url_path.pathname,
                    .basename = entry.base(),
                    .hash = index_route_hash,
                    .file_path = Fs.FileSystem.instance.absBuf(&parts, file_path_buf),
                    .query_string = url_path.query_string,
                    .client_framework_enabled = this.client_framework_enabled,
                };
            }

            return null;
        }

        const full_hash = @truncate(u32, std.hash.Wyhash.hash(0, path));

        // Check for an exact match
        // These means there are no params.
        if (std.mem.indexOfScalar(u32, routes_slice.items(.full_hash), full_hash)) |exact_match| {
            const route = this.routes.get(exact_match);
            // It might be a folder with an index route
            // /bacon/index.js => /bacon
            if (route.children.len > 0) {
                const children = routes_slice.items(.hash)[route.children.offset .. route.children.offset + route.children.len];
                for (children) |child_hash, i| {
                    if (child_hash == index_route_hash) {
                        const entry = routes_slice.items(.entry)[i + route.children.offset];
                        const parts = [_]string{ entry.dir, entry.base() };
                        const file_path = Fs.FileSystem.instance.absBuf(&parts, file_path_buf);
                        return Match{
                            .params = params,
                            .name = Match.nameWithBasename(file_path, this.config.dir),
                            .path = routes_slice.items(.path)[i],
                            .pathname = url_path.pathname,
                            .basename = entry.base(),
                            .hash = child_hash,
                            .file_path = file_path,
                            .query_string = url_path.query_string,
                            .client_framework_enabled = this.client_framework_enabled,
                        };
                    }
                }
                // It's an exact route, there are no params
                // /foo/bar => /foo/bar.js
            } else {
                const entry = route.entry;
                const parts = [_]string{ entry.dir, entry.base() };
                const file_path = Fs.FileSystem.instance.absBuf(&parts, file_path_buf);
                return Match{
                    .params = params,
                    .name = Match.nameWithBasename(file_path, this.config.dir),
                    .path = route.path,
                    .redirect_path = if (redirect) path else null,
                    .hash = full_hash,
                    .basename = entry.base(),
                    .pathname = url_path.pathname,
                    .query_string = url_path.query_string,
                    .file_path = file_path,
                    .client_framework_enabled = this.client_framework_enabled,
                };
            }
        }

        var last_slash_i: usize = 0;
        var segments: []string = segments_buf[0..];
        var hashes: []u32 = segments_hash[0..];
        var segment_i: usize = 0;
        var splitter = std.mem.tokenize(u8, path, "/");
        while (splitter.next()) |part| {
            if (part.len == 0 or (part.len == 1 and part[0] == '.')) continue;
            segments[segment_i] = part;
            hashes[segment_i] = @truncate(u32, std.hash.Wyhash.hash(0, part));
            segment_i += 1;
        }
        segments = segments[0..segment_i];
        hashes = hashes[0..segment_i];

        // Now, we've established that there is no exact match.
        // Something will be dynamic
        // There are three tricky things about this.
        // 1. It's possible that the correct route is a catch-all route or an optional catch-all route.
        // 2. Given routes like this:
        //      * [name]/[id]
        //      * foo/[id]
        //    If the URL is /foo/123
        //    Then the correct route is foo/[id]
        var ctx = MatchContext{
            .params = params,
            .segments = segments,
            .hashes = hashes,
            .map = this,
            .redirect_path = if (redirect) path else null,
            .allocator = this.allocator,
            .url_path = url_path,
            .matched_route_buf = file_path_buf,
        };

        // iterate over the top-level routes
        if (ctx.matchDynamicRoute(0, 0)) |_dynamic_route| {
            // route name == the filesystem path relative to the pages dir excluding the file extension
            var dynamic_route = _dynamic_route;
            dynamic_route.client_framework_enabled = this.client_framework_enabled;
            return dynamic_route;
        }

        return null;
    }
};

// This is a u32
pub const RoutePart = packed struct {
    name: Ptr,
    tag: Tag,

    pub fn str(this: RoutePart, name: string) string {
        return switch (this.tag) {
            .exact => name,
            else => name[this.name.offset..][0..this.name.len],
        };
    }

    pub const Ptr = packed struct {
        offset: u14,
        len: u14,
    };

    pub const Tag = enum(u4) {
        optional_catch_all = 1,
        catch_all = 2,
        param = 3,
        exact = 4,
    };

    pub fn parse(base: string) RoutePart {
        std.debug.assert(base.len > 0);

        var part = RoutePart{
            .name = Ptr{ .offset = 0, .len = @truncate(u14, base.len) },
            .tag = .exact,
        };

        if (base[0] == '[') {
            if (base.len > 1) {
                switch (base[1]) {
                    ']' => {},

                    '[' => {
                        // optional catch all
                        if (strings.eqlComptime(base[1..std.math.min(base.len, 5)], "[...")) {
                            part.name.len = @truncate(u14, std.mem.indexOfScalar(u8, base[5..], ']') orelse return part);
                            part.name.offset = 5;
                            part.tag = .optional_catch_all;
                        }
                    },
                    '.' => {
                        // regular catch all
                        if (strings.eqlComptime(base[1..std.math.min(base.len, 4)], "...")) {
                            part.name.len = @truncate(u14, std.mem.indexOfScalar(u8, base[4..], ']') orelse return part);
                            part.name.offset = 4;
                            part.tag = .catch_all;
                        }
                    },
                    else => {
                        part.name.len = @truncate(u14, std.mem.indexOfScalar(u8, base[1..], ']') orelse return part);
                        part.tag = .param;
                        part.name.offset = 1;
                    },
                }
            }
        }

        return part;
    }
};

threadlocal var params_list: Param.List = undefined;
pub fn match(app: *Router, server: anytype, comptime RequestContextType: type, ctx: *RequestContextType) !void {
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
    var filepath_buf = std.mem.span(&ctx.match_file_path_buf);
    if (app.routes.matchPage(app.config.dir, filepath_buf, ctx.url, &params_list)) |route| {
        if (route.redirect_path) |redirect| {
            try ctx.handleRedirect(redirect);
            return;
        }

        std.debug.assert(route.path.len > 0);

        if (server.watcher.watchloop_handle == null) {
            server.watcher.start() catch {};
        }

        ctx.matched_route = route;
        RequestContextType.JavaScriptHandler.enqueue(ctx, server, filepath_buf, &params_list) catch {
            server.javascript_enabled = false;
        };
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

const Pattern = struct {
    value: Value,
    len: u32 = 0,

    // pub fn match(path: string, name: string, params: *para) bool {
    //     var offset: u32 = 0;
    //     var path_i: u32 = 0;
    //     while (offset < name.len) {
    //         var pattern = Pattern.init(name, 0) catch unreachable;
    //         var path_ = path[path_i..];

    //         switch (pattern.value) {
    //             .static => |str| {
    //                 if (!strings.eql(str, path_[0..str.len])) {
    //                     return false;
    //                 }

    //                 path_ = path_[str.len..];
    //                 offset = pattern.len;
    //             },
    //         }
    //     }

    //     return true;
    // }

    /// Validate a Route pattern, returning the number of route parameters.
    /// `null` means invalid. Error messages are logged. 
    /// That way, we can provide a list of all invalid routes rather than failing the first time.
    pub fn validate(input: string, allocator: *std.mem.Allocator, log: *Logger.Log) ?u16 {
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
        var offset: u32 = 0;
        std.debug.assert(input.len > 0);

        const end = @truncate(u32, input.len - 1);
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
            count += @intCast(u16, @boolToInt(@enumToInt(@as(Pattern.Tag, pattern.value)) > @enumToInt(Pattern.Tag.static)));
        }

        return count;
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

    pub fn init(input: string, offset_: u32) PatternParseError!Pattern {
        return initMaybeHash(input, offset_, true);
    }

    pub fn isEnd(this: Pattern, input: string) bool {
        return @as(usize, this.len) >= input.len;
    }

    pub fn initUnhashed(input: string, offset_: u32) PatternParseError!Pattern {
        return initMaybeHash(input, offset_, false);
    }

    inline fn initMaybeHash(input: string, offset_: u32, comptime do_hash: bool) PatternParseError!Pattern {
        const initHashedString = if (comptime do_hash) HashedString.init else HashedString.initNoHash;

        var offset: u32 = offset_;

        while (input.len > @as(usize, offset) and input[offset] == '/') {
            offset += 1;
        }

        if (input.len == 0 or input.len <= @as(usize, offset)) return Pattern{
            .value = .{ .static = HashedString.empty },
            .len = @truncate(u32, @minimum(input.len, @as(usize, offset))),
        };

        var i: u32 = offset;

        var tag = Tag.static;
        const end = @intCast(u32, input.len - 1);

        if (offset == end) return Pattern{ .len = offset, .value = .{ .static = HashedString.empty } };

        while (i <= end) : (i += 1) {
            switch (input[i]) {
                '/' => {
                    return Pattern{ .len = i, .value = .{ .static = initHashedString(input[offset..i]) } };
                },
                '[' => {
                    if (i > offset) {
                        return Pattern{ .len = i, .value = .{ .static = initHashedString(input[offset..i]) } };
                    }

                    tag = Tag.dynamic;

                    var param = TinyPtr{};
                    var catch_all_start = i;

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

                            const catch_all_dot_start = i;
                            if (!strings.eqlComptimeIgnoreLen(input[i..][0..3], "...")) return error.InvalidOptionalCatchAllRoute;
                            i += 4;
                            param.offset = i;
                        },
                        '.' => {
                            tag = Tag.catch_all;
                            i += 1;

                            if (end < i + 2) {
                                return error.InvalidCatchAllRoute;
                            }

                            if (!strings.eqlComptimeIgnoreLen(input[i..][0..2], "..")) return error.InvalidCatchAllRoute;
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
                        i += 1;

                        if (input[i] != ']') return error.PatternMissingClosingBracket;
                    }

                    if (@enumToInt(tag) > @enumToInt(Tag.dynamic) and i <= end) return error.CatchAllMustBeAtTheEnd;

                    return Pattern{
                        .len = @minimum(end, i),
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

    pub fn handleRedirect(this: *MockRequestContextType, pathname: string) !void {
        this.redirect_called = true;
    }

    pub const JavaScriptHandler = struct {
        pub fn enqueue(ctx: *MockRequestContextType, server: *MockServer, filepath_buf: []u8, params: *Router.Param.List) !void {}
    };
};

pub const MockServer = struct {
    watchloop_handle: ?StoredFileDescriptorType = null,
    watcher: Watcher = Watcher{},

    pub const Watcher = struct {
        watchloop_handle: ?StoredFileDescriptorType = null,
        pub fn start(this: *Watcher) anyerror!void {}
    };
};

fn makeTest(cwd_path: string, data: anytype) !void {
    std.debug.assert(cwd_path.len > 1 and !strings.eql(cwd_path, "/") and !strings.endsWith(cwd_path, "bun"));
    const bun_tests_dir = try std.fs.cwd().makeOpenPath("bun-test-scratch", .{ .iterate = true });
    bun_tests_dir.deleteTree(cwd_path) catch {};

    const cwd = try bun_tests_dir.makeOpenPath(cwd_path, .{ .iterate = true });
    try cwd.setAsCwd();

    const Data = @TypeOf(data);
    const fields: []const std.builtin.TypeInfo.StructField = comptime std.meta.fields(Data);
    inline for (fields) |field| {
        @setEvalBranchQuota(9999);
        const value = @field(data, field.name);

        if (std.fs.path.dirname(field.name)) |dir| {
            try cwd.makePath(dir);
        }
        var file = try cwd.createFile(field.name, .{ .truncate = true });
        try file.writeAll(std.mem.span(value));
        file.close();
    }
}

const expect = std.testing.expect;
const expectEqual = std.testing.expectEqual;
const expectEqualStrings = std.testing.expectEqualStrings;
const expectStr = std.testing.expectEqualStrings;
const Logger = @import("./logger.zig");

pub const Test = struct {
    pub fn makeRoot(comptime testName: string, data: anytype) !RouteGroup.Root {
        try makeTest(testName, data);
        const JSAst = @import("./js_ast.zig");
        JSAst.Expr.Data.Store.create(default_allocator);
        JSAst.Stmt.Data.Store.create(default_allocator);
        var fs = try FileSystem.init1(default_allocator, null);
        var top_level_dir = fs.top_level_dir;

        var pages_parts = [_]string{ top_level_dir, "pages" };
        var pages_dir = try Fs.FileSystem.instance.absAlloc(default_allocator, &pages_parts);
        // _ = try std.fs.makeDirAbsolute(
        //     pages_dir,
        // );
        var router = try Router.init(&FileSystem.instance, default_allocator, Options.RouteConfig{
            .dir = pages_dir,
            .routes_enabled = true,
            .extensions = &.{"js"},
        });
        Output.initTest();

        const Resolver = @import("./resolver/resolver.zig").Resolver;
        var logger = Logger.Log.init(default_allocator);
        errdefer {
            logger.printForLogLevel(Output.errorWriter()) catch {};
        }

        var opts = Options.BundleOptions{
            .resolve_mode = .lazy,
            .platform = .browser,
            .loaders = undefined,
            .define = undefined,
            .log = &logger,
            .routes = router.config,
            .entry_points = &.{},
            .out_extensions = std.StringHashMap(string).init(default_allocator),
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

        var root_dir = (try resolver.readDirInfo(pages_dir)).?;
        var entries = root_dir.getEntries().?;
        return RouteLoader.loadAll(default_allocator, opts.routes, &logger, Resolver, &resolver, root_dir);
        // try router.loadRoutes(root_dir, Resolver, &resolver, 0, true);
        // var entry_points = try router.getEntryPoints(default_allocator);

        // try expectEqual(std.meta.fieldNames(@TypeOf(data)).len, entry_points.len);
        // return router;
    }
};

test "Route Loader" {
    var server = MockServer{};
    var ctx = MockRequestContextType{
        .url = try URLPath.parse("/hi"),
    };
    var router = try Test.makeRoot("routes-basic", github_api_routes_list);
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
    try router.match(&server, MockRequestContextType, &ctx);
    try expectEqualStrings(ctx.matched_route.?.name, "hi");

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/"),
    };

    try router.match(&server, MockRequestContextType, &ctx);
    try expectEqualStrings(ctx.matched_route.?.name, "/index");

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/blog/hi"),
    };

    try router.match(&server, MockRequestContextType, &ctx);
    try expectEqualStrings(ctx.matched_route.?.name, "blog/hi");

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/blog/hey"),
    };

    try router.match(&server, MockRequestContextType, &ctx);
    try expect(ctx.matched_route == null);

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/blog/"),
    };

    try router.match(&server, MockRequestContextType, &ctx);
    try expect(ctx.matched_route == null);

    ctx = MockRequestContextType{
        .url = try URLPath.parse("/pages/hi"),
    };

    try router.match(&server, MockRequestContextType, &ctx);
    try expect(ctx.matched_route == null);
}

test "Dynamic routes" {
    var server = MockServer{};
    var ctx = MockRequestContextType{
        .url = try URLPath.parse("/blog/hi"),
    };
    var filepath_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var router = try Test.make("routes-dynamic", .{
        .@"pages/index.js" = "//index.js",
        .@"pages/blog/hi.js" = "//blog-hi",
        .@"pages/posts/[id].js" = "//hi",
        // .@"pages/blog/posts/bacon.js" = "//index",
    });

    try router.match(&server, MockRequestContextType, &ctx);
    try expectEqualStrings(ctx.matched_route.?.name, "blog/hi");

    var params = ctx.matched_route.?.paramsIterator();
    try expect(params.next() == null);

    ctx.matched_route = null;

    ctx.url = try URLPath.parse("/posts/123");
    try router.match(&server, MockRequestContextType, &ctx);

    params = ctx.matched_route.?.paramsIterator();

    try expectEqualStrings(ctx.matched_route.?.name, "/posts/[id]");
    try expectEqualStrings(params.next().?.rawValue(ctx.matched_route.?.pathname), "123");

    // ctx = MockRequestContextType{
    //     .url = try URLPath.parse("/"),
    // };

    // try router.match(&server, MockRequestContextType, &ctx);
    // try expectEqualStrings(ctx.matched_route.name, "index");
}

test "Pattern" {
    const pattern = "[dynamic]/static/[dynamic2]/[...catch_all]";

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
    try expectStr(static.value.static, "/static/");
    try expectStr(dynamic2.value.dynamic.str(pattern), "dynamic2");
    try expectStr(static2.value.static, "/");
    try expectStr(catch_all.value.catch_all.str(pattern), "catch_all");
}

const github_api_routes_list = .{
    .@"pages/[...catch-all-at-root].js" = "//pages/[...catch-all-at-root].js",
    .@"pages/index.js" = "//pages/index.js",
    .@"pages/app.js" = "//pages/app.js",
    .@"pages/app/installations.js" = "//pages/app/installations.js",
    .@"pages/app/installations/[installation_id].js" = "//pages/app/installations/[installation_id].js",
    .@"pages/apps/[app_slug].js" = "//pages/apps/[app_slug].js",
    .@"pages/codes_of_conduct.js" = "//pages/codes_of_conduct.js",
    .@"pages/codes_of_conduct/[key].js" = "//pages/codes_of_conduct/[key].js",
    .@"pages/emojis.js" = "//pages/emojis.js",
    .@"pages/events.js" = "//pages/events.js",
    .@"pages/feeds.js" = "//pages/feeds.js",
    .@"pages/gitignore/templates.js" = "//pages/gitignore/templates.js",
    .@"pages/gitignore/templates/[name].js" = "//pages/gitignore/templates/[name].js",
    .@"pages/installation/repositories.js" = "//pages/installation/repositories.js",
    .@"pages/licenses.js" = "//pages/licenses.js",
    .@"pages/licenses/[license].js" = "//pages/licenses/[license].js",
    .@"pages/meta.js" = "//pages/meta.js",
    .@"pages/networks/[owner]/[repo]/events.js" = "//pages/networks/[owner]/[repo]/events.js",
    .@"pages/octocat.js" = "//pages/octocat.js",
    .@"pages/organizations.js" = "//pages/organizations.js",
    .@"pages/orgs/[org]/index.js" = "//pages/orgs/[org].js",
    .@"pages/orgs/[org]/actions/permissions.js" = "//pages/orgs/[org]/actions/permissions.js",
    .@"pages/orgs/[org]/actions/permissions/repositories.js" = "//pages/orgs/[org]/actions/permissions/repositories.js",
    .@"pages/orgs/[org]/actions/permissions/selected-actions.js" = "//pages/orgs/[org]/actions/permissions/selected-actions.js",
    .@"pages/orgs/[org]/actions/runner-groups.js" = "//pages/orgs/[org]/actions/runner-groups.js",
    .@"pages/orgs/[org]/actions/runner-groups/[runner_group_id].js" = "//pages/orgs/[org]/actions/runner-groups/[runner_group_id].js",
    .@"pages/orgs/[org]/actions/runner-groups/[runner_group_id]/repositories.js" = "//pages/orgs/[org]/actions/runner-groups/[runner_group_id]/repositories.js",
    .@"pages/orgs/[org]/actions/runner-groups/[runner_group_id]/runners.js" = "//pages/orgs/[org]/actions/runner-groups/[runner_group_id]/runners.js",
    .@"pages/orgs/[org]/actions/runners.js" = "//pages/orgs/[org]/actions/runners.js",
    .@"pages/orgs/[org]/actions/runners/[runner_id].js" = "//pages/orgs/[org]/actions/runners/[runner_id].js",
    .@"pages/orgs/[org]/actions/runners/downloads.js" = "//pages/orgs/[org]/actions/runners/downloads.js",
    .@"pages/orgs/[org]/actions/secrets.js" = "//pages/orgs/[org]/actions/secrets.js",
    .@"pages/orgs/[org]/actions/secrets/[secret_name].js" = "//pages/orgs/[org]/actions/secrets/[secret_name].js",
    .@"pages/orgs/[org]/actions/secrets/[secret_name]/repositories.js" = "//pages/orgs/[org]/actions/secrets/[secret_name]/repositories.js",
    .@"pages/orgs/[org]/actions/secrets/public-key.js" = "//pages/orgs/[org]/actions/secrets/public-key.js",
    .@"pages/orgs/[org]/audit-log.js" = "//pages/orgs/[org]/audit-log.js",
    .@"pages/orgs/[org]/blocks.js" = "//pages/orgs/[org]/blocks.js",
    .@"pages/orgs/[org]/blocks/[username].js" = "//pages/orgs/[org]/blocks/[username].js",
    .@"pages/orgs/[org]/credential-authorizations.js" = "//pages/orgs/[org]/credential-authorizations.js",
    .@"pages/orgs/[org]/events.js" = "//pages/orgs/[org]/events.js",
    .@"pages/orgs/[org]/external-group/[group_id].js" = "//pages/orgs/[org]/external-group/[group_id].js",
    .@"pages/orgs/[org]/external-groups.js" = "//pages/orgs/[org]/external-groups.js",
    .@"pages/orgs/[org]/failed_invitations.js" = "//pages/orgs/[org]/failed_invitations.js",
    .@"pages/orgs/[org]/hooks.js" = "//pages/orgs/[org]/hooks.js",
    .@"pages/orgs/[org]/hooks/[hook_id].js" = "//pages/orgs/[org]/hooks/[hook_id].js",
    .@"pages/orgs/[org]/hooks/[hook_id]/config.js" = "//pages/orgs/[org]/hooks/[hook_id]/config.js",
    .@"pages/orgs/[org]/hooks/[hook_id]/deliveries.js" = "//pages/orgs/[org]/hooks/[hook_id]/deliveries.js",
    .@"pages/orgs/[org]/hooks/[hook_id]/deliveries/[delivery_id].js" = "//pages/orgs/[org]/hooks/[hook_id]/deliveries/[delivery_id].js",
    .@"pages/orgs/[org]/installations.js" = "//pages/orgs/[org]/installations.js",
    .@"pages/orgs/[org]/interaction-limits.js" = "//pages/orgs/[org]/interaction-limits.js",
    .@"pages/orgs/[org]/invitations.js" = "//pages/orgs/[org]/invitations.js",
    .@"pages/orgs/[org]/invitations/[invitation_id]/teams.js" = "//pages/orgs/[org]/invitations/[invitation_id]/teams.js",
    .@"pages/orgs/[org]/members.js" = "//pages/orgs/[org]/members.js",
    .@"pages/orgs/[org]/members/[username].js" = "//pages/orgs/[org]/members/[username].js",
    .@"pages/orgs/[org]/memberships/[username].js" = "//pages/orgs/[org]/memberships/[username].js",
    .@"pages/orgs/[org]/outside_collaborators.js" = "//pages/orgs/[org]/outside_collaborators.js",
    .@"pages/orgs/[org]/projects.js" = "//pages/orgs/[org]/projects.js",
    .@"pages/orgs/[org]/public_members.js" = "//pages/orgs/[org]/public_members.js",
    .@"pages/orgs/[org]/public_members/[username].js" = "//pages/orgs/[org]/public_members/[username].js",
    .@"pages/orgs/[org]/repos.js" = "//pages/orgs/[org]/repos.js",
    .@"pages/orgs/[org]/secret-scanning/alerts.js" = "//pages/orgs/[org]/secret-scanning/alerts.js",
    .@"pages/orgs/[org]/team-sync/groups.js" = "//pages/orgs/[org]/team-sync/groups.js",
    .@"pages/orgs/[org]/teams.js" = "//pages/orgs/[org]/teams.js",
    .@"pages/orgs/[org]/teams/[team_slug].js" = "//pages/orgs/[org]/teams/[team_slug].js",
    .@"pages/orgs/[org]/teams/[team_slug]/discussions.js" = "//pages/orgs/[org]/teams/[team_slug]/discussions.js",
    .@"pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number].js" = "//pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number].js",
    .@"pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/comments.js" = "//pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/comments.js",
    .@"pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/comments/[comment_number].js" = "//pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/comments/[comment_number].js",
    .@"pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/comments/[comment_number]/reactions.js" = "//pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/comments/[comment_number]/reactions.js",
    .@"pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/reactions.js" = "//pages/orgs/[org]/teams/[team_slug]/discussions/[discussion_number]/reactions.js",
    .@"pages/orgs/[org]/teams/[team_slug]/invitations.js" = "//pages/orgs/[org]/teams/[team_slug]/invitations.js",
    .@"pages/orgs/[org]/teams/[team_slug]/members.js" = "//pages/orgs/[org]/teams/[team_slug]/members.js",
    .@"pages/orgs/[org]/teams/[team_slug]/memberships/[username].js" = "//pages/orgs/[org]/teams/[team_slug]/memberships/[username].js",
    .@"pages/orgs/[org]/teams/[team_slug]/projects.js" = "//pages/orgs/[org]/teams/[team_slug]/projects.js",
    .@"pages/orgs/[org]/teams/[team_slug]/projects/[project_id].js" = "//pages/orgs/[org]/teams/[team_slug]/projects/[project_id].js",
    .@"pages/orgs/[org]/teams/[team_slug]/repos.js" = "//pages/orgs/[org]/teams/[team_slug]/repos.js",
    .@"pages/orgs/[org]/teams/[team_slug]/repos/[owner]/[repo].js" = "//pages/orgs/[org]/teams/[team_slug]/repos/[owner]/[repo].js",
    .@"pages/orgs/[org]/teams/[team_slug]/teams.js" = "//pages/orgs/[org]/teams/[team_slug]/teams.js",
    .@"pages/projects/[project_id].js" = "//pages/projects/[project_id].js",
    .@"pages/projects/[project_id]/collaborators.js" = "//pages/projects/[project_id]/collaborators.js",
    .@"pages/projects/[project_id]/collaborators/[username]/permission.js" = "//pages/projects/[project_id]/collaborators/[username]/permission.js",
    .@"pages/projects/[project_id]/columns.js" = "//pages/projects/[project_id]/columns.js",
    .@"pages/projects/columns/[column_id].js" = "//pages/projects/columns/[column_id].js",
    .@"pages/projects/columns/[column_id]/cards.js" = "//pages/projects/columns/[column_id]/cards.js",
    .@"pages/projects/columns/cards/[card_id].js" = "//pages/projects/columns/cards/[card_id].js",
    .@"pages/rate_limit.js" = "//pages/rate_limit.js",
    .@"pages/repos/[owner]/[repo].js" = "//pages/repos/[owner]/[repo].js",
    .@"pages/repos/[owner]/[repo]/actions/artifacts.js" = "//pages/repos/[owner]/[repo]/actions/artifacts.js",
    .@"pages/repos/[owner]/[repo]/actions/artifacts/[artifact_id].js" = "//pages/repos/[owner]/[repo]/actions/artifacts/[artifact_id].js",
    .@"pages/repos/[owner]/[repo]/actions/artifacts/[artifact_id]/[archive_format].js" = "//pages/repos/[owner]/[repo]/actions/artifacts/[artifact_id]/[archive_format].js",
    .@"pages/repos/[owner]/[repo]/actions/jobs/[job_id].js" = "//pages/repos/[owner]/[repo]/actions/jobs/[job_id].js",
    .@"pages/repos/[owner]/[repo]/actions/jobs/[job_id]/logs.js" = "//pages/repos/[owner]/[repo]/actions/jobs/[job_id]/logs.js",
    .@"pages/repos/[owner]/[repo]/actions/permissions.js" = "//pages/repos/[owner]/[repo]/actions/permissions.js",
    .@"pages/repos/[owner]/[repo]/actions/permissions/selected-actions.js" = "//pages/repos/[owner]/[repo]/actions/permissions/selected-actions.js",
    .@"pages/repos/[owner]/[repo]/actions/runners.js" = "//pages/repos/[owner]/[repo]/actions/runners.js",
    .@"pages/repos/[owner]/[repo]/actions/runners/[runner_id].js" = "//pages/repos/[owner]/[repo]/actions/runners/[runner_id].js",
    .@"pages/repos/[owner]/[repo]/actions/runners/downloads.js" = "//pages/repos/[owner]/[repo]/actions/runners/downloads.js",
    .@"pages/repos/[owner]/[repo]/actions/runs.js" = "//pages/repos/[owner]/[repo]/actions/runs.js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id].js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id].js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id]/approvals.js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id]/approvals.js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id]/artifacts.js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id]/artifacts.js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id]/attempts/[attempt_number].js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id]/attempts/[attempt_number].js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id]/attempts/[attempt_number]/jobs.js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id]/attempts/[attempt_number]/jobs.js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id]/attempts/[attempt_number]/logs.js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id]/attempts/[attempt_number]/logs.js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id]/jobs.js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id]/jobs.js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id]/logs.js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id]/logs.js",
    .@"pages/repos/[owner]/[repo]/actions/runs/[run_id]/pending_deployments.js" = "//pages/repos/[owner]/[repo]/actions/runs/[run_id]/pending_deployments.js",
    .@"pages/repos/[owner]/[repo]/actions/secrets.js" = "//pages/repos/[owner]/[repo]/actions/secrets.js",
    .@"pages/repos/[owner]/[repo]/actions/secrets/[secret_name].js" = "//pages/repos/[owner]/[repo]/actions/secrets/[secret_name].js",
    .@"pages/repos/[owner]/[repo]/actions/secrets/public-key.js" = "//pages/repos/[owner]/[repo]/actions/secrets/public-key.js",
    .@"pages/repos/[owner]/[repo]/actions/workflows.js" = "//pages/repos/[owner]/[repo]/actions/workflows.js",
    .@"pages/repos/[owner]/[repo]/actions/workflows/[workflow_id].js" = "//pages/repos/[owner]/[repo]/actions/workflows/[workflow_id].js",
    .@"pages/repos/[owner]/[repo]/actions/workflows/[workflow_id]/runs.js" = "//pages/repos/[owner]/[repo]/actions/workflows/[workflow_id]/runs.js",
    .@"pages/repos/[owner]/[repo]/assignees.js" = "//pages/repos/[owner]/[repo]/assignees.js",
    .@"pages/repos/[owner]/[repo]/assignees/[assignee].js" = "//pages/repos/[owner]/[repo]/assignees/[assignee].js",
    .@"pages/repos/[owner]/[repo]/autolinks.js" = "//pages/repos/[owner]/[repo]/autolinks.js",
    .@"pages/repos/[owner]/[repo]/autolinks/[autolink_id].js" = "//pages/repos/[owner]/[repo]/autolinks/[autolink_id].js",
    .@"pages/repos/[owner]/[repo]/branches.js" = "//pages/repos/[owner]/[repo]/branches.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch].js" = "//pages/repos/[owner]/[repo]/branches/[branch].js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/enforce_admins.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/enforce_admins.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/required_pull_request_reviews.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/required_pull_request_reviews.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/required_signatures.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/required_signatures.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/required_status_checks.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/required_status_checks.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/required_status_checks/contexts.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/required_status_checks/contexts.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/restrictions.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/restrictions.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/restrictions/apps.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/restrictions/apps.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/restrictions/teams.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/restrictions/teams.js",
    .@"pages/repos/[owner]/[repo]/branches/[branch]/protection/restrictions/users.js" = "//pages/repos/[owner]/[repo]/branches/[branch]/protection/restrictions/users.js",
    .@"pages/repos/[owner]/[repo]/check-runs/[check_run_id].js" = "//pages/repos/[owner]/[repo]/check-runs/[check_run_id].js",
    .@"pages/repos/[owner]/[repo]/check-runs/[check_run_id]/annotations.js" = "//pages/repos/[owner]/[repo]/check-runs/[check_run_id]/annotations.js",
    .@"pages/repos/[owner]/[repo]/check-suites/[check_suite_id].js" = "//pages/repos/[owner]/[repo]/check-suites/[check_suite_id].js",
    .@"pages/repos/[owner]/[repo]/check-suites/[check_suite_id]/check-runs.js" = "//pages/repos/[owner]/[repo]/check-suites/[check_suite_id]/check-runs.js",
    .@"pages/repos/[owner]/[repo]/code-scanning/alerts.js" = "//pages/repos/[owner]/[repo]/code-scanning/alerts.js",
    .@"pages/repos/[owner]/[repo]/code-scanning/alerts/[alert_number].js" = "//pages/repos/[owner]/[repo]/code-scanning/alerts/[alert_number].js",
    .@"pages/repos/[owner]/[repo]/code-scanning/alerts/[alert_number]/instances.js" = "//pages/repos/[owner]/[repo]/code-scanning/alerts/[alert_number]/instances.js",
    .@"pages/repos/[owner]/[repo]/code-scanning/analyses.js" = "//pages/repos/[owner]/[repo]/code-scanning/analyses.js",
    .@"pages/repos/[owner]/[repo]/code-scanning/analyses/[analysis_id].js" = "//pages/repos/[owner]/[repo]/code-scanning/analyses/[analysis_id].js",
    .@"pages/repos/[owner]/[repo]/code-scanning/sarifs/[sarif_id].js" = "//pages/repos/[owner]/[repo]/code-scanning/sarifs/[sarif_id].js",
    .@"pages/repos/[owner]/[repo]/collaborators.js" = "//pages/repos/[owner]/[repo]/collaborators.js",
    .@"pages/repos/[owner]/[repo]/collaborators/[username].js" = "//pages/repos/[owner]/[repo]/collaborators/[username].js",
    .@"pages/repos/[owner]/[repo]/collaborators/[username]/permission.js" = "//pages/repos/[owner]/[repo]/collaborators/[username]/permission.js",
    .@"pages/repos/[owner]/[repo]/comments.js" = "//pages/repos/[owner]/[repo]/comments.js",
    .@"pages/repos/[owner]/[repo]/comments/[comment_id].js" = "//pages/repos/[owner]/[repo]/comments/[comment_id].js",
    .@"pages/repos/[owner]/[repo]/comments/[comment_id]/reactions.js" = "//pages/repos/[owner]/[repo]/comments/[comment_id]/reactions.js",
    .@"pages/repos/[owner]/[repo]/commits.js" = "//pages/repos/[owner]/[repo]/commits.js",
    .@"pages/repos/[owner]/[repo]/commits/[commit_sha]/branches-where-head.js" = "//pages/repos/[owner]/[repo]/commits/[commit_sha]/branches-where-head.js",
    .@"pages/repos/[owner]/[repo]/commits/[commit_sha]/comments.js" = "//pages/repos/[owner]/[repo]/commits/[commit_sha]/comments.js",
    .@"pages/repos/[owner]/[repo]/commits/[commit_sha]/pulls.js" = "//pages/repos/[owner]/[repo]/commits/[commit_sha]/pulls.js",
    .@"pages/repos/[owner]/[repo]/commits/[ref].js" = "//pages/repos/[owner]/[repo]/commits/[ref].js",
    .@"pages/repos/[owner]/[repo]/commits/[ref]/check-runs.js" = "//pages/repos/[owner]/[repo]/commits/[ref]/check-runs.js",
    .@"pages/repos/[owner]/[repo]/commits/[ref]/check-suites.js" = "//pages/repos/[owner]/[repo]/commits/[ref]/check-suites.js",
    .@"pages/repos/[owner]/[repo]/commits/[ref]/status.js" = "//pages/repos/[owner]/[repo]/commits/[ref]/status.js",
    .@"pages/repos/[owner]/[repo]/commits/[ref]/statuses.js" = "//pages/repos/[owner]/[repo]/commits/[ref]/statuses.js",
    .@"pages/repos/[owner]/[repo]/community/profile.js" = "//pages/repos/[owner]/[repo]/community/profile.js",
    .@"pages/repos/[owner]/[repo]/compare/[basehead].js" = "//pages/repos/[owner]/[repo]/compare/[basehead].js",
    .@"pages/repos/[owner]/[repo]/contents/[path].js" = "//pages/repos/[owner]/[repo]/contents/[path].js",
    .@"pages/repos/[owner]/[repo]/contributors.js" = "//pages/repos/[owner]/[repo]/contributors.js",
    .@"pages/repos/[owner]/[repo]/deployments.js" = "//pages/repos/[owner]/[repo]/deployments.js",
    .@"pages/repos/[owner]/[repo]/deployments/[deployment_id].js" = "//pages/repos/[owner]/[repo]/deployments/[deployment_id].js",
    .@"pages/repos/[owner]/[repo]/deployments/[deployment_id]/statuses.js" = "//pages/repos/[owner]/[repo]/deployments/[deployment_id]/statuses.js",
    .@"pages/repos/[owner]/[repo]/deployments/[deployment_id]/statuses/[status_id].js" = "//pages/repos/[owner]/[repo]/deployments/[deployment_id]/statuses/[status_id].js",
    .@"pages/repos/[owner]/[repo]/environments.js" = "//pages/repos/[owner]/[repo]/environments.js",
    .@"pages/repos/[owner]/[repo]/environments/[environment_name].js" = "//pages/repos/[owner]/[repo]/environments/[environment_name].js",
    .@"pages/repos/[owner]/[repo]/events.js" = "//pages/repos/[owner]/[repo]/events.js",
    .@"pages/repos/[owner]/[repo]/forks.js" = "//pages/repos/[owner]/[repo]/forks.js",
    .@"pages/repos/[owner]/[repo]/git/blobs/[file_sha].js" = "//pages/repos/[owner]/[repo]/git/blobs/[file_sha].js",
    .@"pages/repos/[owner]/[repo]/git/commits/[commit_sha].js" = "//pages/repos/[owner]/[repo]/git/commits/[commit_sha].js",
    .@"pages/repos/[owner]/[repo]/git/matching-refs/[ref].js" = "//pages/repos/[owner]/[repo]/git/matching-refs/[ref].js",
    .@"pages/repos/[owner]/[repo]/git/ref/[ref].js" = "//pages/repos/[owner]/[repo]/git/ref/[ref].js",
    .@"pages/repos/[owner]/[repo]/git/tags/[tag_sha].js" = "//pages/repos/[owner]/[repo]/git/tags/[tag_sha].js",
    .@"pages/repos/[owner]/[repo]/git/trees/[tree_sha].js" = "//pages/repos/[owner]/[repo]/git/trees/[tree_sha].js",
    .@"pages/repos/[owner]/[repo]/hooks.js" = "//pages/repos/[owner]/[repo]/hooks.js",
    .@"pages/repos/[owner]/[repo]/hooks/[hook_id].js" = "//pages/repos/[owner]/[repo]/hooks/[hook_id].js",
    .@"pages/repos/[owner]/[repo]/hooks/[hook_id]/config.js" = "//pages/repos/[owner]/[repo]/hooks/[hook_id]/config.js",
    .@"pages/repos/[owner]/[repo]/hooks/[hook_id]/deliveries.js" = "//pages/repos/[owner]/[repo]/hooks/[hook_id]/deliveries.js",
    .@"pages/repos/[owner]/[repo]/hooks/[hook_id]/deliveries/[delivery_id].js" = "//pages/repos/[owner]/[repo]/hooks/[hook_id]/deliveries/[delivery_id].js",
    .@"pages/repos/[owner]/[repo]/import.js" = "//pages/repos/[owner]/[repo]/import.js",
    .@"pages/repos/[owner]/[repo]/import/authors.js" = "//pages/repos/[owner]/[repo]/import/authors.js",
    .@"pages/repos/[owner]/[repo]/import/large_files.js" = "//pages/repos/[owner]/[repo]/import/large_files.js",
    .@"pages/repos/[owner]/[repo]/interaction-limits.js" = "//pages/repos/[owner]/[repo]/interaction-limits.js",
    .@"pages/repos/[owner]/[repo]/invitations.js" = "//pages/repos/[owner]/[repo]/invitations.js",
    .@"pages/repos/[owner]/[repo]/issues.js" = "//pages/repos/[owner]/[repo]/issues.js",
    .@"pages/repos/[owner]/[repo]/issues/[issue_number].js" = "//pages/repos/[owner]/[repo]/issues/[issue_number].js",
    .@"pages/repos/[owner]/[repo]/issues/[issue_number]/comments.js" = "//pages/repos/[owner]/[repo]/issues/[issue_number]/comments.js",
    .@"pages/repos/[owner]/[repo]/issues/[issue_number]/events.js" = "//pages/repos/[owner]/[repo]/issues/[issue_number]/events.js",
    .@"pages/repos/[owner]/[repo]/issues/[issue_number]/labels.js" = "//pages/repos/[owner]/[repo]/issues/[issue_number]/labels.js",
    .@"pages/repos/[owner]/[repo]/issues/[issue_number]/reactions.js" = "//pages/repos/[owner]/[repo]/issues/[issue_number]/reactions.js",
    .@"pages/repos/[owner]/[repo]/issues/[issue_number]/timeline.js" = "//pages/repos/[owner]/[repo]/issues/[issue_number]/timeline.js",
    .@"pages/repos/[owner]/[repo]/issues/comments.js" = "//pages/repos/[owner]/[repo]/issues/comments.js",
    .@"pages/repos/[owner]/[repo]/issues/comments/[comment_id].js" = "//pages/repos/[owner]/[repo]/issues/comments/[comment_id].js",
    .@"pages/repos/[owner]/[repo]/issues/comments/[comment_id]/reactions.js" = "//pages/repos/[owner]/[repo]/issues/comments/[comment_id]/reactions.js",
    .@"pages/repos/[owner]/[repo]/issues/events.js" = "//pages/repos/[owner]/[repo]/issues/events.js",
    .@"pages/repos/[owner]/[repo]/issues/events/[event_id].js" = "//pages/repos/[owner]/[repo]/issues/events/[event_id].js",
    .@"pages/repos/[owner]/[repo]/keys.js" = "//pages/repos/[owner]/[repo]/keys.js",
    .@"pages/repos/[owner]/[repo]/keys/[key_id].js" = "//pages/repos/[owner]/[repo]/keys/[key_id].js",
    .@"pages/repos/[owner]/[repo]/labels.js" = "//pages/repos/[owner]/[repo]/labels.js",
    .@"pages/repos/[owner]/[repo]/labels/[name].js" = "//pages/repos/[owner]/[repo]/labels/[name].js",
    .@"pages/repos/[owner]/[repo]/languages.js" = "//pages/repos/[owner]/[repo]/languages.js",
    .@"pages/repos/[owner]/[repo]/license.js" = "//pages/repos/[owner]/[repo]/license.js",
    .@"pages/repos/[owner]/[repo]/milestones.js" = "//pages/repos/[owner]/[repo]/milestones.js",
    .@"pages/repos/[owner]/[repo]/milestones/[milestone_number].js" = "//pages/repos/[owner]/[repo]/milestones/[milestone_number].js",
    .@"pages/repos/[owner]/[repo]/milestones/[milestone_number]/labels.js" = "//pages/repos/[owner]/[repo]/milestones/[milestone_number]/labels.js",
    .@"pages/repos/[owner]/[repo]/pages.js" = "//pages/repos/[owner]/[repo]/pages.js",
    .@"pages/repos/[owner]/[repo]/pages/builds.js" = "//pages/repos/[owner]/[repo]/pages/builds.js",
    .@"pages/repos/[owner]/[repo]/pages/builds/[build_id].js" = "//pages/repos/[owner]/[repo]/pages/builds/[build_id].js",
    .@"pages/repos/[owner]/[repo]/pages/builds/latest.js" = "//pages/repos/[owner]/[repo]/pages/builds/latest.js",
    .@"pages/repos/[owner]/[repo]/pages/health.js" = "//pages/repos/[owner]/[repo]/pages/health.js",
    .@"pages/repos/[owner]/[repo]/projects.js" = "//pages/repos/[owner]/[repo]/projects.js",
    .@"pages/repos/[owner]/[repo]/pulls.js" = "//pages/repos/[owner]/[repo]/pulls.js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number].js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number].js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number]/comments.js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number]/comments.js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number]/commits.js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number]/commits.js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number]/files.js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number]/files.js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number]/merge.js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number]/merge.js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number]/requested_reviewers.js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number]/requested_reviewers.js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number]/reviews.js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number]/reviews.js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number]/reviews/[review_id].js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number]/reviews/[review_id].js",
    .@"pages/repos/[owner]/[repo]/pulls/[pull_number]/reviews/[review_id]/comments.js" = "//pages/repos/[owner]/[repo]/pulls/[pull_number]/reviews/[review_id]/comments.js",
    .@"pages/repos/[owner]/[repo]/pulls/comments.js" = "//pages/repos/[owner]/[repo]/pulls/comments.js",
    .@"pages/repos/[owner]/[repo]/pulls/comments/[comment_id].js" = "//pages/repos/[owner]/[repo]/pulls/comments/[comment_id].js",
    .@"pages/repos/[owner]/[repo]/pulls/comments/[comment_id]/reactions.js" = "//pages/repos/[owner]/[repo]/pulls/comments/[comment_id]/reactions.js",
    .@"pages/repos/[owner]/[repo]/readme.js" = "//pages/repos/[owner]/[repo]/readme.js",
    .@"pages/repos/[owner]/[repo]/readme/[dir].js" = "//pages/repos/[owner]/[repo]/readme/[dir].js",
    .@"pages/repos/[owner]/[repo]/releases.js" = "//pages/repos/[owner]/[repo]/releases.js",
    .@"pages/repos/[owner]/[repo]/releases/[release_id].js" = "//pages/repos/[owner]/[repo]/releases/[release_id].js",
    .@"pages/repos/[owner]/[repo]/releases/[release_id]/assets.js" = "//pages/repos/[owner]/[repo]/releases/[release_id]/assets.js",
    .@"pages/repos/[owner]/[repo]/releases/assets/[asset_id].js" = "//pages/repos/[owner]/[repo]/releases/assets/[asset_id].js",
    .@"pages/repos/[owner]/[repo]/releases/latest.js" = "//pages/repos/[owner]/[repo]/releases/latest.js",
    .@"pages/repos/[owner]/[repo]/releases/tags/[tag].js" = "//pages/repos/[owner]/[repo]/releases/tags/[tag].js",
    .@"pages/repos/[owner]/[repo]/secret-scanning/alerts.js" = "//pages/repos/[owner]/[repo]/secret-scanning/alerts.js",
    .@"pages/repos/[owner]/[repo]/secret-scanning/alerts/[alert_number].js" = "//pages/repos/[owner]/[repo]/secret-scanning/alerts/[alert_number].js",
    .@"pages/repos/[owner]/[repo]/stargazers.js" = "//pages/repos/[owner]/[repo]/stargazers.js",
    .@"pages/repos/[owner]/[repo]/stats/code_frequency.js" = "//pages/repos/[owner]/[repo]/stats/code_frequency.js",
    .@"pages/repos/[owner]/[repo]/stats/commit_activity.js" = "//pages/repos/[owner]/[repo]/stats/commit_activity.js",
    .@"pages/repos/[owner]/[repo]/stats/contributors.js" = "//pages/repos/[owner]/[repo]/stats/contributors.js",
    .@"pages/repos/[owner]/[repo]/stats/participation.js" = "//pages/repos/[owner]/[repo]/stats/participation.js",
    .@"pages/repos/[owner]/[repo]/stats/punch_card.js" = "//pages/repos/[owner]/[repo]/stats/punch_card.js",
    .@"pages/repos/[owner]/[repo]/subscribers.js" = "//pages/repos/[owner]/[repo]/subscribers.js",
    .@"pages/repos/[owner]/[repo]/tags.js" = "//pages/repos/[owner]/[repo]/tags.js",
    .@"pages/repos/[owner]/[repo]/tarball/[ref].js" = "//pages/repos/[owner]/[repo]/tarball/[ref].js",
    .@"pages/repos/[owner]/[repo]/teams.js" = "//pages/repos/[owner]/[repo]/teams.js",
    .@"pages/repos/[owner]/[repo]/topics.js" = "//pages/repos/[owner]/[repo]/topics.js",
    .@"pages/repos/[owner]/[repo]/traffic/clones.js" = "//pages/repos/[owner]/[repo]/traffic/clones.js",
    .@"pages/repos/[owner]/[repo]/traffic/popular/paths.js" = "//pages/repos/[owner]/[repo]/traffic/popular/paths.js",
    .@"pages/repos/[owner]/[repo]/traffic/popular/referrers.js" = "//pages/repos/[owner]/[repo]/traffic/popular/referrers.js",
    .@"pages/repos/[owner]/[repo]/traffic/views.js" = "//pages/repos/[owner]/[repo]/traffic/views.js",
    .@"pages/repos/[owner]/[repo]/zipball/[ref].js" = "//pages/repos/[owner]/[repo]/zipball/[ref].js",
    .@"pages/repositories.js" = "//pages/repositories.js",
    .@"pages/repositories/[repository_id]/environments/[environment_name]/secrets.js" = "//pages/repositories/[repository_id]/environments/[environment_name]/secrets.js",
    .@"pages/repositories/[repository_id]/environments/[environment_name]/secrets/[secret_name].js" = "//pages/repositories/[repository_id]/environments/[environment_name]/secrets/[secret_name].js",
    .@"pages/repositories/[repository_id]/environments/[environment_name]/secrets/public-key.js" = "//pages/repositories/[repository_id]/environments/[environment_name]/secrets/public-key.js",
    .@"pages/scim/v2/enterprises/[enterprise]/Groups.js" = "//pages/scim/v2/enterprises/[enterprise]/Groups.js",
    .@"pages/scim/v2/enterprises/[enterprise]/Groups/[scim_group_id].js" = "//pages/scim/v2/enterprises/[enterprise]/Groups/[scim_group_id].js",
    .@"pages/scim/v2/enterprises/[enterprise]/Users.js" = "//pages/scim/v2/enterprises/[enterprise]/Users.js",
    .@"pages/scim/v2/enterprises/[enterprise]/Users/[scim_user_id].js" = "//pages/scim/v2/enterprises/[enterprise]/Users/[scim_user_id].js",
    .@"pages/scim/v2/organizations/[org]/Users.js" = "//pages/scim/v2/organizations/[org]/Users.js",
    .@"pages/scim/v2/organizations/[org]/Users/[scim_user_id].js" = "//pages/scim/v2/organizations/[org]/Users/[scim_user_id].js",
    .@"pages/search/code.js" = "//pages/search/code.js",
    .@"pages/search/commits.js" = "//pages/search/commits.js",
    .@"pages/search/issues.js" = "//pages/search/issues.js",
    .@"pages/search/labels.js" = "//pages/search/labels.js",
    .@"pages/search/repositories.js" = "//pages/search/repositories.js",
    .@"pages/search/topics.js" = "//pages/search/topics.js",
    .@"pages/search/users.js" = "//pages/search/users.js",
    .@"pages/teams/[team_id].js" = "//pages/teams/[team_id].js",
    .@"pages/teams/[team_id]/discussions.js" = "//pages/teams/[team_id]/discussions.js",
    .@"pages/teams/[team_id]/discussions/[discussion_number].js" = "//pages/teams/[team_id]/discussions/[discussion_number].js",
    .@"pages/teams/[team_id]/discussions/[discussion_number]/comments.js" = "//pages/teams/[team_id]/discussions/[discussion_number]/comments.js",
    .@"pages/teams/[team_id]/discussions/[discussion_number]/comments/[comment_number].js" = "//pages/teams/[team_id]/discussions/[discussion_number]/comments/[comment_number].js",
    .@"pages/teams/[team_id]/discussions/[discussion_number]/comments/[comment_number]/reactions.js" = "//pages/teams/[team_id]/discussions/[discussion_number]/comments/[comment_number]/reactions.js",
    .@"pages/teams/[team_id]/discussions/[discussion_number]/reactions.js" = "//pages/teams/[team_id]/discussions/[discussion_number]/reactions.js",
    .@"pages/teams/[team_id]/invitations.js" = "//pages/teams/[team_id]/invitations.js",
    .@"pages/teams/[team_id]/members.js" = "//pages/teams/[team_id]/members.js",
    .@"pages/teams/[team_id]/members/[username].js" = "//pages/teams/[team_id]/members/[username].js",
    .@"pages/teams/[team_id]/memberships/[username].js" = "//pages/teams/[team_id]/memberships/[username].js",
    .@"pages/teams/[team_id]/projects.js" = "//pages/teams/[team_id]/projects.js",
    .@"pages/teams/[team_id]/projects/[project_id].js" = "//pages/teams/[team_id]/projects/[project_id].js",
    .@"pages/teams/[team_id]/repos.js" = "//pages/teams/[team_id]/repos.js",
    .@"pages/teams/[team_id]/repos/[owner]/[repo].js" = "//pages/teams/[team_id]/repos/[owner]/[repo].js",
    .@"pages/teams/[team_id]/teams.js" = "//pages/teams/[team_id]/teams.js",
    .@"pages/users.js" = "//pages/users.js",
    .@"pages/users/[username].js" = "//pages/users/[username].js",
    .@"pages/users/[username]/events.js" = "//pages/users/[username]/events.js",
    .@"pages/users/[username]/events/public.js" = "//pages/users/[username]/events/public.js",
    .@"pages/users/[username]/followers.js" = "//pages/users/[username]/followers.js",
    .@"pages/users/[username]/following.js" = "//pages/users/[username]/following.js",
    .@"pages/users/[username]/following/[target_user].js" = "//pages/users/[username]/following/[target_user].js",
    .@"pages/users/[username]/gpg_keys.js" = "//pages/users/[username]/gpg_keys.js",
    .@"pages/users/[username]/keys.js" = "//pages/users/[username]/keys.js",
    .@"pages/users/[username]/orgs.js" = "//pages/users/[username]/orgs.js",
    .@"pages/users/[username]/received_events.js" = "//pages/users/[username]/received_events.js",
    .@"pages/users/[username]/received_events/public.js" = "//pages/users/[username]/received_events/public.js",
    .@"pages/users/[username]/repos.js" = "//pages/users/[username]/repos.js",
    .@"pages/users/[username]/starred.js" = "//pages/users/[username]/starred.js",
    .@"pages/users/[username]/subscriptions.js" = "//pages/users/[username]/subscriptions.js",
    .@"pages/zen.js" = "//pages/zen.js",
};
