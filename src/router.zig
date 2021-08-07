// This is a Next.js-compatible file-system router.
// It uses the filesystem to infer entry points.
// Despite being Next.js-compatible, it's not tied to Next.js.
// It does not handle the framework parts of rendering pages.
// All it does is resolve URL paths to the appropriate entry point and parse URL params/query.
const Router = @This();

const std = @import("std");
usingnamespace @import("global.zig");

const DirInfo = @import("./resolver/dir_info.zig");
const Fs = @import("./fs.zig");
const Options = @import("./options.zig");
const allocators = @import("./allocators.zig");
const URLPath = @import("./http/url_path.zig");

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
            .routes = Route.List{},
            .index = null,
            .allocator = allocator,
            .config = config,
        },
        .fs = fs,
        .allocator = allocator,
        .config = config,
    };
}

pub fn getEntryPoints(this: *const Router, allocator: *std.mem.Allocator) ![]const string {
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
            if (Fs.FileSystem.DirEntry.EntryStore.instance.at(this.routes.routes.items(.entry_index)[i])) |entry| {
                str_len += entry.base.len + entry.dir.len;
            }
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
            if (Fs.FileSystem.DirEntry.EntryStore.instance.at(this.routes.routes.items(.entry_index)[i])) |entry| {
                var parts = [_]string{ entry.dir, entry.base };
                entry_points[entry_point_i] = this.fs.absBuf(&parts, remain);
                remain = remain[entry_points[entry_point_i].len..];
                entry_point_i += 1;
            }
        }
    }

    return entry_points;
}

const banned_dirs = [_]string{
    "node_modules",
};

// This loads routes recursively, in depth-first order.
// it does not currently handle duplicate exact route matches. that's undefined behavior, for now.
pub fn loadRoutes(
    this: *Router,
    root_dir_info: *const DirInfo,
    comptime ResolverType: type,
    resolver: *ResolverType,
    parent: u16,
    comptime is_root: bool,
) anyerror!void {
    var fs = &this.fs.fs;
    if (root_dir_info.getEntriesConst()) |entries| {
        var iter = entries.data.iterator();
        outer: while (iter.next()) |entry_ptr| {
            const entry = Fs.FileSystem.DirEntry.EntryStore.instance.at(entry_ptr.value) orelse continue;
            if (entry.base[0] == '.') {
                continue :outer;
            }

            switch (entry.kind(fs)) {
                .dir => {
                    inline for (banned_dirs) |banned_dir| {
                        if (strings.eqlComptime(entry.base, comptime banned_dir)) {
                            continue :outer;
                        }
                    }
                    var abs_parts = [_]string{ entry.dir, entry.base };
                    if (resolver.readDirInfoIgnoreError(this.fs.abs(&abs_parts))) |_dir_info| {
                        const dir_info: *const DirInfo = _dir_info;

                        var route: Route = Route.parse(
                            entry.base,
                            Fs.PathName.init(entry.dir[this.config.dir.len..]).dirWithTrailingSlash(),
                            "",
                            entry_ptr.value,
                        );

                        route.parent = parent;

                        route.children.offset = @truncate(u16, this.routes.routes.len + 1);
                        try this.routes.routes.append(this.allocator, route);

                        // potential stack overflow!
                        try this.loadRoutes(
                            dir_info,
                            ResolverType,
                            resolver,
                            route.children.offset,
                            false,
                        );

                        this.routes.routes.items(.children)[route.children.offset - 1].len = @truncate(u16, this.routes.routes.len) - route.children.offset;
                    }
                },

                .file => {
                    const extname = std.fs.path.extension(entry.base);
                    // exclude "." or ""
                    if (extname.len < 2) continue;

                    for (this.config.extensions) |_extname| {
                        if (strings.eql(extname[1..], _extname)) {
                            var route = Route.parse(
                                entry.base,
                                // we extend the pointer length by one to get it's slash
                                entry.dir.ptr[this.config.dir.len..entry.dir.len],
                                extname,
                                entry_ptr.value,
                            );
                            route.parent = parent;

                            if (comptime is_root) {
                                if (strings.eqlComptime(route.name, "index")) {
                                    this.routes.index = @truncate(u32, this.routes.routes.len);
                                }
                            }

                            try this.routes.routes.append(
                                this.allocator,
                                route,
                            );
                        }
                    }
                },
            }
        }
    }

    if (comptime isDebug) {
        if (comptime is_root) {
            var i: usize = 0;
            Output.prettyln("Routes:", .{});
            while (i < this.routes.routes.len) : (i += 1) {
                const route = this.routes.routes.get(i);

                Output.prettyln("   {s}: {s}", .{ route.name, route.path });
            }
            Output.prettyln("  {d} routes", .{this.routes.routes.len});
            Output.flush();
        }
    }
}

const TinyPtr = packed struct {
    offset: u16 = 0,
    len: u16 = 0,
};

pub const Param = struct {
    key: TinyPtr,
    kind: RoutePart.Tag,
    value: TinyPtr,

    pub const List = std.MultiArrayList(Param);
};

pub const Route = struct {
    part: RoutePart,
    name: string,
    path: string,
    hash: u32,
    children: Ptr = Ptr{},
    parent: u16 = top_level_parent,
    entry_index: allocators.IndexType,

    full_hash: u32,

    pub const top_level_parent = std.math.maxInt(u16);

    pub const List = std.MultiArrayList(Route);
    pub const Ptr = TinyPtr;

    pub fn parse(base: string, dir: string, extname: string, entry_index: allocators.IndexType) Route {
        const ensure_slash = if (dir.len > 0 and dir[dir.len - 1] != '/') "/" else "";

        var parts = [3]string{ dir, ensure_slash, base };
        // this isn't really absolute, it's relative to the pages dir
        const absolute = Fs.FileSystem.instance.join(&parts);
        const name = base[0 .. base.len - extname.len];
        const start_index: usize = if (absolute[0] == '/') 1 else 0;
        var hash_path = absolute[start_index .. absolute.len - extname.len];

        return Route{
            .name = name,
            .path = base,
            .entry_index = entry_index,
            .hash = @truncate(
                u32,
                std.hash.Wyhash.hash(
                    0,
                    name,
                ),
            ),
            .full_hash = @truncate(
                u32,
                std.hash.Wyhash.hash(
                    0,
                    hash_path,
                ),
            ),
            .part = RoutePart.parse(name),
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
    routes: Route.List,
    index: ?u32,
    allocator: *std.mem.Allocator,
    config: Options.RouteConfig,

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
                if (Fs.FileSystem.DirEntry.EntryStore.instance.at(head.entry_index)) |entry| {
                    var parts = [_]string{ entry.dir, entry.base };
                    const file_path = Fs.FileSystem.instance.absBuf(&parts, this.matched_route_buf);

                    match_result = Match{
                        .path = head.path,
                        .name = file_path,
                        .params = this.params,
                        .hash = head.full_hash,
                        .query_string = this.url_path.query_string,
                        .pathname = this.url_path.pathname,
                        .basename = entry.base,
                        .file_path = file_path,
                    };

                    this.matched_route_buf[match_result.file_path.len] = 0;
                }
            }

            // Now that we know for sure the route will match, we append the param
            switch (head.part.tag) {
                .param => {
                    // account for the slashes
                    var segment_offset: u16 = segment_i;
                    for (this.segments[0..segment_i]) |segment| {
                        segment_offset += @truncate(u16, segment.len);
                    }
                    this.params.append(
                        this.allocator,
                        Param{
                            .key = .{ .offset = head.part.name.offset, .len = head.part.name.len },
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

        if (path.len == 0) {
            if (this.index) |index| {
                const entry = Fs.FileSystem.DirEntry.EntryStore.instance.at(this.routes.items(.entry_index)[index]).?;
                const parts = [_]string{ entry.dir, entry.base };

                return Match{
                    .params = params,
                    .name = "index",
                    .path = this.routes.items(.path)[index],
                    .file_path = Fs.FileSystem.instance.absBuf(&parts, file_path_buf),
                    .basename = entry.base,
                    .pathname = url_path.pathname,
                    .hash = index_route_hash,
                    .query_string = url_path.query_string,
                };
            }

            return null;
        }

        const full_hash = @truncate(u32, std.hash.Wyhash.hash(0, path));
        const routes_slice = this.routes.slice();

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
                        const entry = Fs.FileSystem.DirEntry.EntryStore.instance.at(routes_slice.items(.entry_index)[i + route.children.offset]).?;
                        const parts = [_]string{ entry.dir, entry.base };

                        return Match{
                            .params = params,
                            .name = routes_slice.items(.name)[i],
                            .path = routes_slice.items(.path)[i],
                            .pathname = url_path.pathname,
                            .basename = entry.base,
                            .hash = child_hash,
                            .file_path = Fs.FileSystem.instance.absBuf(&parts, file_path_buf),
                            .query_string = url_path.query_string,
                        };
                    }
                }
                // It's an exact route, there are no params
                // /foo/bar => /foo/bar.js
            } else {
                const entry = Fs.FileSystem.DirEntry.EntryStore.instance.at(route.entry_index).?;
                const parts = [_]string{ entry.dir, entry.base };
                return Match{
                    .params = params,
                    .name = route.name,
                    .path = route.path,
                    .redirect_path = if (redirect) path else null,
                    .hash = full_hash,
                    .basename = entry.base,
                    .pathname = url_path.pathname,
                    .query_string = url_path.query_string,
                    .file_path = Fs.FileSystem.instance.absBuf(&parts, file_path_buf),
                };
            }
        }

        var last_slash_i: usize = 0;
        var segments: []string = segments_buf[0..];
        var hashes: []u32 = segments_hash[0..];
        var segment_i: usize = 0;
        var splitter = std.mem.tokenize(path, "/");
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

        if (ctx.matchDynamicRoute(0, 0)) |_dynamic_route| {
            // route name == the filesystem path relative to the pages dir excluding the file extension
            var dynamic_route = _dynamic_route;
            dynamic_route.name = dynamic_route.name[this.config.dir.len..];
            dynamic_route.name = dynamic_route.name[0 .. dynamic_route.name.len - std.fs.path.extension(dynamic_route.file_path).len];
            std.debug.assert(dynamic_route.name.len > 0);
            if (dynamic_route.name[0] == '/') dynamic_route.name = dynamic_route.name[1..];

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

        // ??? render javascript ??

        if (server.watcher.watchloop_handle == null) {
            server.watcher.start() catch {};
        }

        ctx.matched_route = route;
        RequestContextType.JavaScriptHandler.enqueue(ctx, server, filepath_buf, &params_list) catch {
            server.javascript_enabled = false;
        };
    }

    if (!ctx.controlled) {
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

    /// basename of the route in the file system, including file extension
    basename: string,

    hash: u32,
    params: *Param.List,
    redirect_path: ?string = null,
    query_string: string = "",
};
