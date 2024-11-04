//! Discovers routes from the filesystem, as instructed by the framework
//! configuration. Supports incrementally updating for DevServer, or
//! serializing to a binary for production builds.
const FrameworkRouter = @This();

pub const OpaqueFileId = bun.GenericIndex(u32, opaque {});

types: []const Type,

nodes: std.ArrayListUnmanaged(Route),
edges: std.ArrayListUnmanaged(Route.Edge),
freed_edges: std.ArrayListUnmanaged(Route.Edge.Index),

pub fn initEmpty(types: []const Type, allocator: Allocator) !FrameworkRouter {
    const nodes = try std.ArrayListUnmanaged(Route).initCapacity(allocator, types.len);
    for (0..types.len) |type_index|
        nodes.appendAssumeCapacity(allocator, .{
            .pattern = EncodedPattern.root,
            .type = Type.Index.init(type_index),
            .parent = .none,
            .first_child = .none,
            .file_page = .none,
            .file_layout = .none,
            .file_not_found = .none,
        });
    return .{
        .types = types,

        .nodes = .{},
        .edges = .{},
        .freed_edges = .{},
    };
}

fn deinit(fr: *FrameworkRouter, allocator: Allocator) void {
    fr.nodes.deinit(allocator);
    fr.edges.deinit(allocator);
    fr.freed_edges.deinit(allocator);
}

/// A logical route, for which layouts are looked up on after resolving.
/// Metadata for route files is specified out of line, either in DevServer where
/// it is an IncrementalGraph(.server).FileIndex or the production build context
/// where it is an entrypoint index.
pub const Route = struct {
    pattern: EncodedPattern,
    type: Type.Index,
    parent: Index.Optional,
    first_child: Edge.Index.Optional,
    file_page: OpaqueFileId.Optional,
    file_layout: OpaqueFileId.Optional,
    file_not_found: OpaqueFileId.Optional,

    inline fn filePtr(r: *Route, file_kind: FileKind) *OpaqueFileId.Optional {
        return &@field(r, "file_" ++ @tagName(file_kind));
    }

    pub const FileKind = enum {
        page,
        layout,
        not_found,
    };

    pub const Edge = struct {
        prev: Edge.Index.Optional,
        next: Edge.Index.Optional,
        id: Route.Index,
        pub const Index = bun.GenericIndex(u32, Edge);
    };
    pub const Index = bun.GenericIndex(u32, Route);
};

/// Native code for `FrameworkFileSystemRouterType`
pub const Type = struct {
    abs_root: []const u8,
    prefix: []const u8 = "/",
    ignore_underscores: bool = false,
    ignore_dirs: []const []const u8 = &.{ ".git", "node_modules" },
    extensions: []const []const u8,
    style: Style,

    pub const Index = bun.GenericIndex(u8, Type);
};

/// Route patterns are serialized in a stable byte format so it can be hashed
/// for map structures, and deserialized to `[]Part`
pub const EncodedPattern = struct {
    data: []const u8,

    pub const root: EncodedPattern = .{ .data = brk: {
        const parts: []const Part = .{.{ .text = "/" }};
        var bytes: [patternSerializedLength(parts)]u8 = undefined;
        var s = std.io.fixedBufferStream(&bytes);
        for (parts) |part|
            part.writeAsSerialized(s.writer()) catch unreachable;
        bun.assert(s.pos == s.buffer.len);
        const final = bytes;
        break :brk &final;
    } };

    pub fn patternSerializedLength(parts: []const Part) usize {
        var size: usize = 0;
        for (parts) |part| {
            size += @sizeOf(u32) + switch (part) {
                else => |t| t.len,
            };
        }
        return size;
    }

    pub fn initFromParts(parts: []const Part, allocator: Allocator) !EncodedPattern {
        const slice = try allocator.alloc(u8, patternSerializedLength(parts));
        var s = std.io.fixedBufferStream(slice);
        for (parts) |part|
            part.writeAsSerialized(s.writer()) catch
                unreachable; // enough space
        bun.assert(s.pos == s.buffer.len);
        return slice;
    }

    pub fn iterate(p: EncodedPattern) Iterator {
        return .{ .pattern = p, .offset = 0 };
    }

    const Iterator = struct {
        pattern: EncodedPattern,
        offset: usize,

        pub fn readWithSize(it: Iterator) !struct { Part, usize } {
            const header: Part.SerializedHeader = @bitCast(mem.readInt(
                u32,
                it.pattern.data[it.offset..][0..@sizeOf(u32)],
                .little,
            ));
            return .{
                switch (header.tag) {
                    inline else => |tag| @unionInit(
                        Part,
                        @tagName(tag),
                        it.pattern.data[it.offset..][0..header.len],
                    ),
                },
                @sizeOf(u32) + header.len,
            };
        }

        pub fn peek(it: Iterator) Part {
            return it.readWithSize().@"0";
        }

        pub fn next(it: *Iterator) ?Part {
            if (it.offset >= it.pattern.data)
                return null;
            const part, const len = it.readWithSize();
            it.offset += len;
            return part;
        }
    };
};

/// A part of a URL pattern
pub const Part = union(enum) {
    text: []const u8,
    param: []const u8,
    /// Does not affect URL matching, but does affect hierarchy.
    group: []const u8,
    /// Must be the last part of the pattern
    catch_all: []const u8,
    /// Must be the last part of the pattern
    catch_all_optional: []const u8,

    const SerializedHeader = packed struct(u32) {
        tag: @typeInfo(Part).Union.tag_type.?,
        len: u29,
    };

    pub fn writeAsSerialized(part: Part, writer: std.io.AnyWriter) !void {
        const payload = switch (part) {
            else => |t| t,
        };
        try writer.writeStructEndian(SerializedHeader{
            .tag = std.meta.activeTag(part),
            .len = @intCast(payload.len),
        }, .little);
        try writer.writeAll(payload);
    }
};

pub const ParsedPattern = struct {
    parts: []const Part,
    kind: Kind,

    pub const Kind = enum {
        /// Can be navigated to. Pages can have children, which allows having
        /// nested routes exactly how Remix allows them.
        page,
        /// Is not considered when resolving navigations, but is still a valid
        /// node in the route tree.
        layout,
        /// Another file related to a route
        extra,
    };
};

pub const Style = enum {
    @"nextjs-pages",
    @"nextjs-app-ui",
    @"nextjs-app-route",

    pub fn parse(style: Style, file_path: []const u8, ext: []const u8, log: *TinyLog, arena: Allocator) !?ParsedPattern {
        bun.assert(file_path[0] == '/');

        return switch (style) {
            .@"nextjs-pages" => parseNextJsPages(file_path, ext, log, arena),
            .@"nextjs-app-ui" => parseNextJsApp(file_path, ext, log, arena, .ui),
            .@"nextjs-app-route" => parseNextJsApp(file_path, ext, log, arena, .route),
        };
    }

    /// Implements the pages router parser from Next.js:
    /// https://nextjs.org/docs/getting-started/project-structure#pages-routing-conventions
    pub fn parseNextJsPages(file_path_raw: []const u8, ext: []const u8, log: *TinyLog, arena: Allocator) !?ParsedPattern {
        var file_path = file_path_raw[0 .. file_path_raw.len - ext.len];
        var kind: ParsedPattern.Kind = .page;
        if (strings.hasSuffixComptime(file_path, "/index")) {
            file_path.len -= "/index".len;
        } else if (strings.hasSuffixComptime(file_path, "/_layout")) {
            file_path.len -= "/_layout".len;
            kind = .layout;
        }
        if (file_path.len == 0) return .{
            .kind = kind,
            .parts = &.{.{ .text = "/" }},
        };
        const parts = try parseNextJsLikeRouteSegment(file_path_raw, file_path, log, arena, .pages);
        return .{
            .kind = kind,
            .parts = parts,
        };
    }

    /// Implements the app router parser from Next.js:
    /// https://nextjs.org/docs/getting-started/project-structure#app-routing-conventions
    pub fn parseNextJsApp(
        file_path_raw: []const u8,
        ext: []const u8,
        log: *TinyLog,
        arena: Allocator,
        comptime extract: enum { ui, route },
    ) !?ParsedPattern {
        const without_ext = file_path_raw[0 .. file_path_raw.len - ext.len];
        const basename = std.fs.path.basename(without_ext);
        const loader = bun.options.Loader.fromString(ext) orelse
            return null;

        // TODO: opengraph-image and metadata friends
        if (!loader.isJavaScriptLike())
            return null;

        const kind = bun.ComptimeStringMap(ParsedPattern.Kind, switch (extract) {
            .ui => .{
                .{ "page", .page },
                .{ "layout", .layout },

                .{ "default", .extra },
                .{ "template", .extra },
                .{ "error", .extra },
                .{ "loading", .extra },
                .{ "not-found", .extra },
            },
            .route => .{
                .{ "route", .page },
            },
        }).get(basename) orelse
            return null;

        const dirname = bun.path.dirname(without_ext, .posix);
        if (dirname.len <= 1) return .{
            .kind = kind,
            .parts = &.{.{ .text = "/" }},
        };
        const parts = try parseNextJsLikeRouteSegment(file_path_raw, dirname, log, arena, .app);
        return .{
            .kind = kind,
            .parts = parts,
        };
    }

    const NextRoutingConventions = enum { app, pages };
    fn parseNextJsLikeRouteSegment(
        raw_input: []const u8,
        route_segment: []const u8,
        log: *TinyLog,
        arena: Allocator,
        comptime conventions: NextRoutingConventions,
    ) ![]Part {
        var i: usize = 0;
        var parts: std.ArrayListUnmanaged(Part) = .{};
        const stop_chars = switch (conventions) {
            .pages => "[",
            .app => "[(@",
        };
        while (strings.indexOfAnyPosComptime(route_segment, stop_chars, i)) |start| {
            if (conventions == .pages or route_segment[start] == '[') {
                var end = strings.indexOfCharPos(route_segment, ']', start + 1) orelse
                    return log.fail("Missing \"]\" to match this route parameter", .{}, start, raw_input.len - start);

                const is_optional = route_segment[start + 1] == '[';

                const param_content = route_segment[start + 1 + @as(u64, @intFromBool(is_optional)) .. end];

                var has_ending_double_bracket = false;
                if (end + 1 < route_segment.len and route_segment[end + 1] == ']') {
                    end += 1;
                    has_ending_double_bracket = true;
                }
                const len = end - start + 1;

                const is_catch_all = strings.hasPrefixComptime(param_content, "...");
                const param_name = if (is_catch_all) param_content[3..] else param_content;

                if (param_name.len == 0)
                    return log.fail("Parameter needs a name", .{}, start, len);
                if (param_name[0] == '.')
                    return log.fail("Parameter name cannot start with \".\" (use \"...\" for catch-all)", .{}, start, len);
                if (is_optional and !is_catch_all)
                    return log.fail("Optional parameters can only be catch-all (change to \"[[...{s}]]\" or remove extra brackets)", .{param_name}, start, len);

                if (has_ending_double_bracket and !is_optional)
                    return log.fail("Extra \"]\" in route parameter", .{}, end, 1)
                else if (!has_ending_double_bracket and is_optional)
                    return log.fail("Missing second \"]\" to close optional route parameter", .{}, end, 1);

                if (route_segment[start - 1] != '/' or (end + 1 < route_segment.len and route_segment[end + 1] != '/'))
                    return log.fail("Parameters must take up the entire file name", .{}, start, len);

                if (is_catch_all and route_segment.len != end + 1)
                    return log.fail("Catch-all parameter must be at the end of a route", .{}, start, len);

                const between = route_segment[i..start];
                bun.assert(between.len > 0);
                try parts.append(arena, .{ .text = between });
                try parts.append(
                    arena,
                    if (is_optional)
                        .{ .catch_all_optional = param_name }
                    else if (is_catch_all)
                        .{ .catch_all = param_name }
                    else
                        .{ .param = param_name },
                );

                i = end + 1;
            } else if (route_segment[start] == '(') {
                const end = strings.indexOfCharPos(route_segment, ')', start + 1) orelse
                    return log.fail("Missing \")\" to match this route group", .{}, start, raw_input.len - start);

                const len = end - start + 1;

                const group_name = route_segment[start + 1 .. end];
                if (strings.hasPrefixComptime(group_name, "."))
                    return log.fail("Bun Bake currently does not support named slots and intercepted routes", .{}, start, len);

                if (route_segment[start - 1] != '/' or (end + 1 < route_segment.len and route_segment[end + 1] != '/'))
                    return log.fail("Route group marker must take up the entire file name", .{}, start, len);

                const between = route_segment[i..start];
                bun.assert(between.len > 0);
                try parts.append(arena, .{ .text = between });
                try parts.append(arena, .{ .group = group_name });

                i = end + 1;
            } else if (route_segment[start] == '@') {
                const end = strings.indexOfCharPos(route_segment, ')', start + 1) orelse
                    route_segment.len;
                const len = end - start + 1;
                return log.fail("Bun Bake currently does not support named slots and intercepted routes", .{}, start, len);
            }
        }
        if (route_segment[i..].len > 0)
            try parts.append(arena, .{ .text = route_segment[i..] });
        return parts.items;
    }
};

const InsertError = error{ RouteCollision, OutOfMemory };

/// Insert a new file, potentially creating a Route for that file.
/// Moves ownership of EncodedPattern into the FrameworkRouter
pub fn insert(
    fr: *FrameworkRouter,
    alloc: Allocator,
    ty: Type.Index,
    pattern: EncodedPattern,
    file_kind: Route.FileKind,
    file_id: OpaqueFileId,
    /// When `error.RouteCollision` is returned, this is set to the existing file index.
    out_colliding_file_id: *OpaqueFileId,
) InsertError!void {

    // The root route is the index of the type
    const walk_up = Route.Index.get(ty.get());
    const route = fr.routePtr(walk_up);

    const new_route_index = brk: {
        if (route.first_child.unwrap()) |first_child| {
            _ = first_child; // autofix
            @panic("TODO");
        } else {
            // Must append node
            const new_route_index = fr.newRoute(alloc, .{
                .pattern = pattern,
                .type = ty,
                .parent = walk_up,
                .first_child = .none,
                .file_page = .none,
                .file_layout = .none,
                .file_not_found = .none,
            });
            break :brk new_route_index;
        }
    };

    const new_route = fr.routePtr(new_route_index);
    if (new_route.filePtr(file_kind).unwrap()) |existing| {
        out_colliding_file_id.* = existing;
        return error.RouteCollision;
    }
    new_route.filePtr(file_kind).* = file_id;
}

fn routePtr(fr: *FrameworkRouter, i: Route.Index) *Route {
    return &fr.nodes.items[i.get()];
}

fn newRoute(fr: *FrameworkRouter, alloc: Allocator, route_data: Route) !Route.Index {
    const i = fr.nodes.items.len;
    fr.nodes.append(alloc, route_data);
    return Route.Index.init(@intCast(i));
}

fn newEdge(fr: *FrameworkRouter, alloc: Allocator, edge_data: Route.Edge) !Route.Edge.Index {
    if (fr.freed_edges.popOrNull()) |i| {
        fr.edges.items[i.get()] = edge_data;
        return i;
    } else {
        const i = fr.edges.items.len;
        try fr.edges.append(alloc, edge_data);
        return Route.Edge.Index.init(i);
    }
}

const PatternParseError = error{InvalidRoutePattern};

/// Non-allocating single message log, specialized for the messages from the route pattern parsers
pub const TinyLog = struct {
    msg: std.BoundedArray(u8, 512 + std.fs.max_path_bytes),
    cursor_at: u32,
    cursor_len: u32,

    pub const empty: TinyLog = .{ .cursor_at = std.math.maxInt(u32), .cursor_len = 0, .msg = .{} };

    pub fn fail(log: *TinyLog, comptime fmt: []const u8, args: anytype, cursor_at: usize, cursor_len: usize) PatternParseError {
        log.msg.len = @intCast(if (std.fmt.bufPrint(&log.msg.buffer, fmt, args)) |slice| slice.len else |_| brk: {
            // truncation should never happen because the buffer is HUGE. handle it anyways
            @memcpy(log.msg.buffer[log.msg.buffer.len - 3 ..], "...");
            break :brk log.msg.buffer.len;
        });
        log.cursor_at = @intCast(cursor_at);
        log.cursor_len = @intCast(cursor_len);
        return PatternParseError.InvalidRoutePattern;
    }
};

// `ctx` is a pointer to something which implements:
// - "fn getFileIdForRouter(ctx, abs_path: []const u8) File.Index"
// - "fn handleFileRouterError(ctx, ...) !void"
pub fn scan(
    fw: *FrameworkRouter,
    alloc: Allocator,
    ty: Type.Index,
    r: *Resolver,
    root_dir_path: []const u8,
    ctx: anytype,
) !void {
    comptime bun.assert(!@typeInfo(@TypeOf(ctx)).Pointer.is_const);
    const t = &fw.types[ty.get()];
    bun.assert(!strings.hasSuffixComptime(t.abs_root, "/"));
    const root_info = try r.readDirInfo(root_dir_path) orelse
        return error.RootDirMissing;
    var arena_state = std.heap.ArenaAllocator.init(alloc);
    defer arena_state.deinit();
    try fw.scanInner(alloc, t, ty, r, root_info, &arena_state, ctx);
}

pub fn scanInner(
    fw: *FrameworkRouter,
    alloc: Allocator,
    t: *const Type,
    t_index: Type.Index,
    r: *Resolver,
    dir_info: *DirInfo,
    arena_state: *std.heap.ArenaAllocator,
    ctx: anytype,
) !void {
    _ = ctx; // autofix
    const fs = r.fs;
    const fs_impl = &fs.fs;

    if (dir_info.getEntriesConst()) |entries| {
        var it = entries.data.iterator();
        outer: while (it.next()) |entry| {
            const file = entry.value_ptr.*;
            const base = file.base();
            switch (file.kind(fs_impl, false)) {
                .dir => {
                    if (t.ignore_underscores and bun.strings.hasPrefixComptime(base, "_"))
                        continue :outer;

                    for (t.ignore_dirs) |banned_dir| {
                        if (bun.strings.eqlLong(base, banned_dir, true)) {
                            continue :outer;
                        }
                    }

                    if (r.readDirInfoIgnoreError(fs.abs(&.{ entry.dir, entry.base() }))) |child_info| {
                        try fw.scanInner(alloc, r, child_info);
                    }
                },
                .file => {
                    const ext = std.fs.path.extension(base);

                    if (t.extensions.len > 0) {
                        for (t.extensions) |allowed_ext| {
                            if (strings.eql(ext, allowed_ext)) break;
                        } else continue :outer;
                    }

                    bun.assert(strings.startsWith(file.abs_path, t.abs_root));
                    var rel_path_buf: bun.PathBuffer = undefined;
                    const rel_path = bun.path.pathToPosixBuf(u8, file.abs_path[t.abs_root..], &rel_path_buf);
                    var log = TinyLog.empty;
                    defer arena_state.reset(.retain_capacity);
                    const parsed = (t.style.parse(rel_path, ext, &log, arena_state.allocator()) catch
                        @panic("TODO: propagate error message")) orelse continue :outer;
                    const encoded_pattern = EncodedPattern.initFromParts(parsed.parts, alloc);
                    var out_colliding_file_id: OpaqueFileId = 0;
                    fw.insert(alloc, t_index, encoded_pattern, switch (parsed.kind) {
                        .page => .page,
                        .layout => .layout,
                        .extra => @panic("TODO: extra files"),
                    }, 0, &out_colliding_file_id) catch
                        @panic("TODO: propagate error message");
                },
            }
        }

        //
    }
}

pub const JSFrameworkRouter = struct {
    pub usingnamespace JSC.Codegen.JSFrameworkFileSystemRouter;
    router: FrameworkRouter,

    const validators = bun.JSC.Node.validators;

    pub fn constructor(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) !*JSFrameworkRouter {
        const opts = callframe.argumentsAsArray(1)[0];
        if (!opts.isObject())
            return global.throwInvalidArguments2("FrameworkRouter needs an object as it's first argument", .{});

        const root = try opts.getOptional(global, "root", bun.String.Slice) orelse
            return global.throwInvalidArguments2("Missing options.root", .{});
        defer root.deinit();

        const style = try validators.validateStringEnum(
            Style,
            global,
            try opts.getOptional("style", JSValue) orelse .undefined,
            "style",
            .{},
        );

        const abs_root = try bun.default_allocator.dupe(u8, bun.path.joinAbs(bun.fs.FileSystem.instance.top_level_dir, .auto, root));
        errdefer bun.default_allocator.free(abs_root);

        const types = try bun.default_allocator.dupe(Type, &.{.{
            .abs_root = abs_root,
            .ignore_underscores = false,
            .extensions = &.{ ".tsx", ".ts", ".jsx", ".js" },
            .style = style,
        }});
        errdefer bun.default_allocator.free(types);

        const jsfr = bun.new(JSFrameworkRouter, .{
            .router = try FrameworkRouter.initEmpty(types, bun.default_allocator),
        });

        return jsfr;
    }

    pub fn finalize(this: *JSFrameworkRouter) void {
        this.router.deinit(bun.default_allocator);
        bun.default_allocator.free(this.router.types);
        bun.destroy(this);
    }

    pub fn parseRoutePattern(global: *JSGlobalObject, frame: *CallFrame) !JSValue {
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        const alloc = arena.allocator();

        if (frame.argumentsCount() < 2)
            return global.throwInvalidArguments2("parseRoutePattern takes two arguments", .{});

        const style_js, const filepath_js = frame.argumentsAsArray(2);
        const filepath = try filepath_js.toSlice2(global, alloc);
        defer filepath.deinit();
        const style_string = try style_js.toSlice2(global, alloc);
        defer style_string.deinit();

        const style = std.meta.stringToEnum(Style, style_string.slice()) orelse
            return global.throwInvalidArguments2("unknown router style {}", .{bun.fmt.quote(style_string.slice())});

        var log = TinyLog.empty;
        const parsed = style.parse(filepath.slice(), std.fs.path.extension(filepath.slice()), &log, alloc) catch |err| switch (err) {
            error.InvalidRoutePattern => {
                global.throw("{s} ({d}:{d})", .{ log.msg.slice(), log.cursor_at, log.cursor_len });
                return global.jsErrorFromCPP();
            },
            else => |e| return e,
        } orelse
            return .null;

        var rendered = try std.ArrayList(u8).initCapacity(alloc, filepath.slice().len);
        for (parsed.parts) |part| switch (part) {
            .text => |text| try rendered.appendSlice(text),
            .param => |param_name| try rendered.writer().print(":{s}", .{param_name}),
            .group => |label| try rendered.writer().print("({s})", .{label}),
            .catch_all => |param_name| try rendered.writer().print(":*{s}", .{param_name}),
            .catch_all_optional => |param_name| try rendered.writer().print(":*?{s}", .{param_name}),
        };

        var out = bun.String.init(rendered.items);
        const obj = JSValue.createEmptyObject(global, 2);
        obj.put(global, "kind", bun.String.static(@tagName(parsed.kind)).toJS(global));
        obj.put(global, "pattern", out.transferToJS(global));
        return obj;
    }
};

const std = @import("std");
const mem = std.mem;
const Allocator = mem.Allocator;

const bun = @import("root").bun;
const strings = bun.strings;
const Resolver = bun.resolver.Resolver;
const DirInfo = bun.resolver.DirInfo;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;
