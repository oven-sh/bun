//! Discovers routes from the filesystem, as instructed by the framework
//! configuration. Agnotic to all different paradigms. Supports incrementally
//! updating for DevServer, or serializing to a binary for use in production.
const FrameworkRouter = @This();

/// Metadata for route files is specified out of line, either in DevServer where
/// it is an IncrementalGraph(.server).FileIndex or the production build context
/// where it is an entrypoint index.
pub const OpaqueFileId = bun.GenericIndex(u32, opaque {});

/// Absolute path to root directory of the router.
root: []const u8,
types: []Type,
routes: std.ArrayListUnmanaged(Route),
/// Keys are full URL, with leading /, no trailing /
/// Value is Route Index
static_routes: StaticRouteMap,
/// A flat list of all dynamic patterns.
///
/// Used to detect routes that have the same effective URL. Examples:
/// - `/hello/[foo]/bar` and `/hello/[baz]`bar`
/// - `/(one)/abc/def` and `/(two)/abc/def`
///
/// Note that file that match to the same exact route are already caught as
/// errors since the Route cannot store a list of files. Examples:
/// - `/about/index.tsx` and `/about.tsx` with style `.nextjs-pages`
/// Key in this map is EncodedPattern.
///
/// Root files are not caught using this technique, since every route tree has a
/// root. This check is special cased.
// TODO: no code to sort this data structure
dynamic_routes: DynamicRouteMap,

/// The above structure is optimized for incremental updates, but
/// production has a different set of requirements:
/// - Trivially serializable to a binary file (no pointers)
/// - As little memory indirection as possible.
/// - Routes cannot be updated after serilaization.
pub const Serialized = struct {
    // TODO:
};

const StaticRouteMap = bun.StringArrayHashMapUnmanaged(Route.Index);
const DynamicRouteMap = std.ArrayHashMapUnmanaged(EncodedPattern, Route.Index, EncodedPattern.EffectiveURLContext, true);

/// A logical route, for which layouts are looked up on after resolving a route.
pub const Route = struct {
    part: Part,
    type: Type.Index,

    parent: Index.Optional,
    first_child: Route.Index.Optional,
    prev_sibling: Route.Index.Optional,
    next_sibling: Route.Index.Optional,

    // Note: A route may be associated with no files, in which it is just a
    // construct for building the tree.
    file_page: OpaqueFileId.Optional = .none,
    file_layout: OpaqueFileId.Optional = .none,
    // file_not_found: OpaqueFileId.Optional = .none,

    /// Only used by DevServer, if this route is 1. navigatable & 2. has been requested at least once
    bundle: bun.bake.DevServer.RouteBundle.Index.Optional = .none,

    inline fn filePtr(r: *Route, file_kind: FileKind) *OpaqueFileId.Optional {
        return &switch (file_kind) {
            inline else => |kind| @field(r, "file_" ++ @tagName(kind)),
        };
    }

    pub const FileKind = enum {
        page,
        layout,
        // not_found,
    };

    pub const Index = bun.GenericIndex(u31, Route);
};

/// Native code for `FrameworkFileSystemRouterType`
pub const Type = struct {
    abs_root: []const u8,
    prefix: []const u8 = "/",
    ignore_underscores: bool = false,
    ignore_dirs: []const []const u8 = &.{ ".git", "node_modules" },
    extensions: []const []const u8,
    style: Style,
    allow_layouts: bool,
    /// `FrameworkRouter` itself does not use this value.
    client_file: OpaqueFileId.Optional,
    /// `FrameworkRouter` itself does not use this value.
    server_file: OpaqueFileId,
    /// `FrameworkRouter` itself does not use this value.
    server_file_string: JSC.Strong,

    pub fn rootRouteIndex(type_index: Index) Route.Index {
        return Route.Index.init(type_index.get());
    }

    pub const Index = bun.GenericIndex(u8, Type);
};

pub fn initEmpty(root: []const u8, types: []Type, allocator: Allocator) !FrameworkRouter {
    bun.assert(std.fs.path.isAbsolute(root));

    var routes = try std.ArrayListUnmanaged(Route).initCapacity(allocator, types.len);
    errdefer routes.deinit(allocator);

    for (types, 0..) |*ty, type_index| {
        ty.abs_root = bun.strings.withoutTrailingSlashWindowsPath(ty.abs_root);
        bun.assert(bun.strings.hasPrefix(ty.abs_root, root));

        routes.appendAssumeCapacity(.{
            .part = .{ .text = "" },
            .type = Type.Index.init(@intCast(type_index)),
            .parent = .none,
            .prev_sibling = .none,
            .next_sibling = .none,
            .first_child = .none,
            .file_page = .none,
            .file_layout = .none,
            // .file_not_found = .none,
        });
    }
    return .{
        .root = bun.strings.withoutTrailingSlashWindowsPath(root),
        .types = types,
        .routes = routes,
        .dynamic_routes = .{},
        .static_routes = .{},
    };
}

pub fn deinit(fr: *FrameworkRouter, allocator: Allocator) void {
    fr.routes.deinit(allocator);
    allocator.free(fr.types);
}

pub fn scanAll(fr: *FrameworkRouter, allocator: Allocator, r: *Resolver, ctx: anytype) !void {
    for (fr.types, 0..) |ty, i| {
        _ = ty;
        try fr.scan(allocator, FrameworkRouter.Type.Index.init(@intCast(i)), r, ctx);
    }
}

/// Route patterns are serialized in a stable byte format so it can be treated
/// as a string, while easily decodable as []Part.
pub const EncodedPattern = struct {
    data: []const u8,

    /// `/` is represented by zero bytes
    pub const root: EncodedPattern = .{ .data = &.{} };

    pub fn patternSerializedLength(parts: []const Part) usize {
        var size: usize = 0;
        for (parts) |part| {
            size += @sizeOf(u32) + switch (part) {
                inline else => |t| t.len,
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
        return .{ .data = slice };
    }

    pub fn iterate(p: EncodedPattern) Iterator {
        return .{ .pattern = p, .offset = 0 };
    }

    pub fn partAt(pattern: EncodedPattern, byte_offset: usize) ?Part {
        return (Iterator{
            .pattern = pattern,
            .offset = byte_offset,
        }).peek();
    }

    const Iterator = struct {
        pattern: EncodedPattern,
        offset: usize,

        pub fn readWithSize(it: Iterator) struct { Part, usize } {
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
                        it.pattern.data[it.offset + @sizeOf(u32) ..][0..header.len],
                    ),
                },
                @sizeOf(u32) + header.len,
            };
        }

        pub fn peek(it: Iterator) Part {
            return it.readWithSize().@"0";
        }

        pub fn next(it: *Iterator) ?Part {
            if (it.offset >= it.pattern.data.len)
                return null;
            const part, const len = it.readWithSize();
            it.offset += len;
            return part;
        }
    };

    pub fn effectiveURLHash(k: EncodedPattern) usize {
        // The strategy is to write all bytes, then hash them. Avoiding
        // multiple hash calls on small chunks. Allocation is not needed
        // since the upper bound is known (file path limits)
        var stack_space: [std.fs.max_path_bytes * 2]u8 = undefined;
        var stream = std.io.fixedBufferStream(&stack_space);
        const w = stream.writer();
        var it = k.iterate();
        while (it.next()) |item| switch (item) {
            .text => |text| {
                w.writeAll("/") catch unreachable;
                w.writeAll(text) catch unreachable;
            },
            // param names are not visible
            .param => w.writeAll(":") catch unreachable,
            .catch_all => w.writeAll(":.") catch unreachable,
            .catch_all_optional => w.writeAll(":?") catch unreachable,
            // groups are completely unobservable
            .group => continue,
        };
        return bun.hash(stream.getWritten());
    }

    fn matches(p: EncodedPattern, path: []const u8, params: *MatchedParams) bool {
        var param_num: usize = 0;
        var it = p.iterate();
        var i: usize = 1;
        while (it.next()) |part| {
            switch (part) {
                .text => |expect| {
                    if (path.len < i + expect.len or
                        !(path.len == i + expect.len or path[i + expect.len] == '/'))
                        return false;
                    if (!strings.eql(path[i..][0..expect.len], expect))
                        return false;
                    i += 1 + expect.len;
                },
                .param => |name| {
                    const end = strings.indexOfCharPos(path, '/', i) orelse path.len;
                    params.params.len = @intCast(param_num + 1);
                    params.params.buffer[param_num] = .{
                        .key = name,
                        .value = path[i..end],
                    };
                    param_num += 1;
                    i = if (end == path.len) end else end + 1;
                },
                .catch_all_optional => return true,
                .catch_all => break,
                .group => continue,
            }
        }
        return i == path.len;
    }

    pub const EffectiveURLContext = struct {
        pub fn hash(_: @This(), p: EncodedPattern) u32 {
            return @truncate(p.effectiveURLHash());
        }

        pub fn eql(_: @This(), a: EncodedPattern, b: EncodedPattern, _: usize) bool {
            return a.effectiveURLHash() == b.effectiveURLHash();
        }
    };
};

/// Wrapper around a slice to provide same interface to be used in `insert`
/// but with the allocation being backed by a plain string, which each
/// part separated by slashes.
const StaticPattern = struct {
    route_path: []const u8,

    pub fn iterate(p: StaticPattern) Iterator {
        return .{ .pattern = p, .offset = 0 };
    }

    const Iterator = struct {
        pattern: StaticPattern,
        offset: usize,

        pub fn readWithSize(it: Iterator) struct { Part, usize } {
            const next_i = bun.strings.indexOfCharPos(it.pattern.route_path, '/', it.offset + 1) orelse
                it.pattern.route_path.len;
            const text = it.pattern.route_path[it.offset + 1 .. next_i];
            return .{ .{ .text = text }, text.len + 1 };
        }

        pub fn peek(it: Iterator) Part {
            return it.readWithSize().@"0";
        }

        pub fn next(it: *Iterator) ?Part {
            if (it.offset >= it.pattern.route_path.len)
                return null;
            const part, const len = it.readWithSize();
            it.offset += len;
            return part;
        }
    };
};

/// A part of a URL pattern
pub const Part = union(enum(u3)) {
    /// Does not contain slashes. One per slash.
    text: []const u8,
    param: []const u8,
    /// Must be the last part of the pattern
    catch_all_optional: []const u8,
    /// Must be the last part of the pattern
    catch_all: []const u8,
    /// Does not affect URL matching, but does affect hierarchy.
    group: []const u8,

    const SerializedHeader = packed struct(u32) {
        tag: @typeInfo(Part).Union.tag_type.?,
        len: u29,
    };

    pub fn writeAsSerialized(part: Part, writer: anytype) !void {
        switch (part) {
            .text => |text| {
                bun.assert(text.len > 0);
                bun.assert(bun.strings.indexOfChar(text, '/') == null);
            },
            else => {},
        }
        const payload = switch (part) {
            inline else => |t| t,
        };
        try writer.writeInt(u32, @bitCast(SerializedHeader{
            .tag = std.meta.activeTag(part),
            .len = @intCast(payload.len),
        }), .little);
        try writer.writeAll(payload);
    }

    pub fn eql(a: Part, b: Part) bool {
        if (std.meta.activeTag(a) != std.meta.activeTag(b))
            return false;
        return switch (a) {
            inline else => |payload, tag| bun.strings.eql(
                payload,
                @field(b, @tagName(tag)),
            ),
        };
    }

    pub fn format(part: Part, comptime fmt: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        comptime bun.assert(fmt.len == 0);
        try writer.writeAll("Part \"");
        try part.toStringForInternalUse(writer);
        try writer.writeAll("\"");
    }

    fn toStringForInternalUse(part: Part, writer: anytype) !void {
        switch (part) {
            .text => |text| try writer.print("/{s}", .{text}),
            .param => |param_name| try writer.print("/:{s}", .{param_name}),
            .group => |label| try writer.print("/({s})", .{label}),
            .catch_all => |param_name| try writer.print("/:*{s}", .{param_name}),
            .catch_all_optional => |param_name| try writer.print("/:*?{s}", .{param_name}),
        }
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

pub const Style = union(enum) {
    nextjs_pages,
    nextjs_app_ui,
    nextjs_app_routes,
    javascript_defined: JSC.Strong,

    pub const map = bun.ComptimeStringMap(Style, .{
        .{ "nextjs-pages", .nextjs_pages },
        .{ "nextjs-app-ui", .nextjs_app_ui },
        .{ "nextjs-app-routes", .nextjs_app_routes },
    });
    pub const error_message = "'style' must be either \"nextjs-pages\", \"nextjs-app-ui\", \"nextjs-app-routes\", or a function.";

    pub fn fromJS(value: JSValue, global: *JSC.JSGlobalObject) !Style {
        if (value.isString()) {
            const bun_string = try value.toBunString2(global);
            var sfa = std.heap.stackFallback(4096, bun.default_allocator);
            const utf8 = bun_string.toUTF8(sfa.get());
            defer utf8.deinit();
            if (map.get(utf8.slice())) |style| {
                return style;
            }
        } else if (value.isCallable(global.vm())) {
            return .{ .javascript_defined = JSC.Strong.create(value, global) };
        }

        return global.throwInvalidArguments(error_message, .{});
    }

    pub fn deinit(style: *Style) void {
        switch (style.*) {
            .javascript_defined => |*strong| strong.deinit(),
            else => {},
        }
    }

    pub const UiOrRoutes = enum { ui, routes };
    const NextRoutingConvention = enum { app, pages };

    pub fn parse(style: Style, file_path: []const u8, ext: []const u8, log: *TinyLog, allow_layouts: bool, arena: Allocator) !?ParsedPattern {
        bun.assert(file_path[0] == '/');

        return switch (style) {
            .nextjs_pages => parseNextJsPages(file_path, ext, log, allow_layouts, arena),
            .nextjs_app_ui => parseNextJsApp(file_path, ext, log, allow_layouts, arena, .ui),
            .nextjs_app_routes => parseNextJsApp(file_path, ext, log, allow_layouts, arena, .routes),

            // The strategy for this should be to collect a list of candidates,
            // then batch-call the javascript handler and collect all results.
            // This will avoid most of the back-and-forth native<->js overhead.
            .javascript_defined => @panic("TODO: customizable Style"),
        };
    }

    /// Implements the pages router parser from Next.js:
    /// https://nextjs.org/docs/getting-started/project-structure#pages-routing-conventions
    pub fn parseNextJsPages(file_path_raw: []const u8, ext: []const u8, log: *TinyLog, allow_layouts: bool, arena: Allocator) !?ParsedPattern {
        var file_path = file_path_raw[0 .. file_path_raw.len - ext.len];
        var kind: ParsedPattern.Kind = .page;
        if (strings.hasSuffixComptime(file_path, "/index")) {
            file_path.len -= "/index".len;
        } else if (allow_layouts and strings.hasSuffixComptime(file_path, "/_layout")) {
            file_path.len -= "/_layout".len;
            kind = .layout;
        }
        if (file_path.len == 0) return .{
            .kind = kind,
            .parts = &.{},
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
        allow_layouts: bool,
        arena: Allocator,
        comptime extract: UiOrRoutes,
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
            .routes => .{
                .{ "route", .page },
            },
        }).get(basename) orelse
            return null;

        if (kind == .layout and !allow_layouts) return null;

        const dirname = bun.path.dirname(without_ext, .posix);
        if (dirname.len <= 1) return .{
            .kind = kind,
            .parts = &.{},
        };
        const parts = try parseNextJsLikeRouteSegment(file_path_raw, dirname, log, arena, .app);
        return .{
            .kind = kind,
            .parts = parts,
        };
    }

    fn parseNextJsLikeRouteSegment(
        raw_input: []const u8,
        route_segment: []const u8,
        log: *TinyLog,
        arena: Allocator,
        comptime conventions: NextRoutingConvention,
    ) ![]Part {
        var i: usize = 1;
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
                // Potential future proofing
                if (std.mem.indexOfAny(u8, param_name, "?*{}()=:#,")) |bad_char_index|
                    return log.fail("Parameter name cannot contain \"{c}\"", .{param_name[bad_char_index]}, start + bad_char_index, 1);

                if (has_ending_double_bracket and !is_optional)
                    return log.fail("Extra \"]\" in route parameter", .{}, end, 1)
                else if (!has_ending_double_bracket and is_optional)
                    return log.fail("Missing second \"]\" to close optional route parameter", .{}, end, 1);

                if (route_segment[start - 1] != '/' or (end + 1 < route_segment.len and route_segment[end + 1] != '/'))
                    return log.fail("Parameters must take up the entire file name", .{}, start, len);

                if (is_catch_all and route_segment.len != end + 1)
                    return log.fail("Catch-all parameter must be at the end of a route", .{}, start, len);

                const between = route_segment[i..start];
                var it = std.mem.tokenizeScalar(u8, between, '/');
                while (it.next()) |part|
                    try parts.append(arena, .{ .text = part });
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
                var it = std.mem.tokenizeScalar(u8, between, '/');
                while (it.next()) |part|
                    try parts.append(arena, .{ .text = part });
                try parts.append(arena, .{ .group = group_name });

                i = end + 1;
            } else if (route_segment[start] == '@') {
                const end = strings.indexOfCharPos(route_segment, ')', start + 1) orelse
                    route_segment.len;
                const len = end - start + 1;
                return log.fail("Bun Bake currently does not support named slots and intercepted routes", .{}, start, len);
            }
        }
        if (route_segment[i..].len > 0) {
            var it = std.mem.tokenizeScalar(u8, route_segment[i..], '/');
            while (it.next()) |part|
                try parts.append(arena, .{ .text = part });
        }
        return parts.items;
    }
};

const InsertError = error{ RouteCollision, OutOfMemory };
const InsertKind = enum {
    static,
    dynamic,

    fn Pattern(kind: InsertKind) type {
        return switch (kind) {
            .dynamic => EncodedPattern,
            .static => StaticPattern,
        };
    }
};

/// Insert a new file, potentially creating a Route for that file.
/// Moves ownership of EncodedPattern into the FrameworkRouter.
///
/// This function is designed so that any insertion order will create an
/// equivalent routing tree, but it does not guarantee that route indices
/// would match up if a different insertion order was picked.
pub fn insert(
    fr: *FrameworkRouter,
    alloc: Allocator,
    ty: Type.Index,
    comptime insertion_kind: InsertKind,
    pattern: insertion_kind.Pattern(),
    file_kind: Route.FileKind,
    file_path: []const u8,
    ctx: InsertionContext,
    /// When `error.RouteCollision` is returned, this is set to the existing file index.
    out_colliding_file_id: *OpaqueFileId,
) InsertError!void {
    // The root route is the index of the type
    const root_route = Type.rootRouteIndex(ty);

    const new_route_index = brk: {
        var input_it = pattern.iterate();
        var current_part = input_it.next() orelse
            break :brk root_route;

        var route_index = root_route;
        var route = fr.routePtr(root_route);
        outer: while (true) {
            var next = route.first_child.unwrap();
            while (next) |current| {
                const child = fr.routePtr(current);
                if (current_part.eql(child.part)) {
                    current_part = input_it.next() orelse
                        break :brk current; // found it!

                    route_index = current;
                    route = fr.routePtr(current);
                    continue :outer;
                }
                next = fr.routePtr(next.?).next_sibling.unwrap() orelse
                    break;
            }

            // Must add to this child
            var new_route_index = try fr.newRoute(alloc, .{
                .part = current_part,
                .type = ty,
                .parent = route_index.toOptional(),
                .first_child = .none,
                .prev_sibling = Route.Index.Optional.init(next),
                .next_sibling = .none,
            });

            if (next) |attach| {
                fr.routePtr(attach).next_sibling = new_route_index.toOptional();
            } else {
                fr.routePtr(route_index).first_child = new_route_index.toOptional();
            }

            // Build each part out as another node in the routing graph. This makes
            // inserting routes simpler to implement, but could technically be avoided.
            while (input_it.next()) |next_part| {
                const newer_route_index = try fr.newRoute(alloc, .{
                    .part = next_part,
                    .type = ty,
                    .parent = new_route_index.toOptional(),
                    .first_child = .none,
                    .prev_sibling = Route.Index.Optional.init(next),
                    .next_sibling = .none,
                });
                fr.routePtr(new_route_index).first_child = newer_route_index.toOptional();
                new_route_index = newer_route_index;
            }

            break :brk new_route_index;
        }
    };

    const file_id = try ctx.vtable.getFileIdForRouter(ctx.opaque_ctx, file_path, new_route_index, file_kind);

    const new_route = fr.routePtr(new_route_index);
    if (new_route.filePtr(file_kind).unwrap()) |existing| {
        if (existing == file_id) {
            return; // exact match already exists. Hot-reloading code hits this
        }
        out_colliding_file_id.* = existing;
        return error.RouteCollision;
    }
    new_route.filePtr(file_kind).* = file_id.toOptional();

    if (file_kind == .page) switch (insertion_kind) {
        .static => {
            const gop = try fr.static_routes.getOrPut(
                alloc,
                if (pattern.route_path.len == 0) "/" else pattern.route_path,
            );
            if (gop.found_existing) {
                @panic("TODO: propagate aliased route error");
            }
            gop.value_ptr.* = new_route_index;
        },
        .dynamic => {
            const gop = try fr.dynamic_routes.getOrPut(alloc, pattern);
            if (gop.found_existing) {
                @panic("TODO: propagate aliased route error");
            }
            gop.value_ptr.* = new_route_index;
        },
    };
}

/// An enforced upper bound of 64 unique patterns allows routing to use no heap allocation
pub const MatchedParams = struct {
    pub const max_count = 64;

    params: std.BoundedArray(Entry, max_count),

    pub const Entry = struct {
        key: []const u8,
        value: []const u8,
    };
};

/// Fast enough for development to be seamless, but avoids building a
/// complicated data structure that production uses to efficiently map
/// urls to routes instead of this tree-traversal algorithm.
pub fn matchSlow(fr: *FrameworkRouter, path: []const u8, params: *MatchedParams) ?Route.Index {
    params.* = .{ .params = .{} };

    bun.assert(path[0] == '/');
    if (fr.static_routes.get(path)) |static| {
        return static;
    }

    for (fr.dynamic_routes.keys(), 0..) |pattern, i| {
        if (pattern.matches(path, params)) {
            return fr.dynamic_routes.values()[i];
        }
    }

    return null;
}

pub fn routePtr(fr: *FrameworkRouter, i: Route.Index) *Route {
    return &fr.routes.items[i.get()];
}

pub fn typePtr(fr: *FrameworkRouter, i: Type.Index) *Type {
    return &fr.types[i.get()];
}

fn newRoute(fr: *FrameworkRouter, alloc: Allocator, route_data: Route) !Route.Index {
    const i = fr.routes.items.len;
    try fr.routes.append(alloc, route_data);
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

/// Non-allocating single message log, specialized for the messages from the route pattern parsers.
/// DevServer uses this to special-case the printing of these messages to highlight the offending part of the filename
pub const TinyLog = struct {
    msg: std.BoundedArray(u8, 512 + std.fs.max_path_bytes),
    cursor_at: u32,
    cursor_len: u32,

    pub const empty: TinyLog = .{ .cursor_at = std.math.maxInt(u32), .cursor_len = 0, .msg = .{} };

    pub fn fail(log: *TinyLog, comptime fmt: []const u8, args: anytype, cursor_at: usize, cursor_len: usize) PatternParseError {
        log.write(fmt, args);
        log.cursor_at = @intCast(cursor_at);
        log.cursor_len = @intCast(cursor_len);
        return PatternParseError.InvalidRoutePattern;
    }

    pub fn write(log: *TinyLog, comptime fmt: []const u8, args: anytype) void {
        log.msg.len = @intCast(if (std.fmt.bufPrint(&log.msg.buffer, fmt, args)) |slice| slice.len else |_| brk: {
            // truncation should never happen because the buffer is HUGE. handle it anyways
            @memcpy(log.msg.buffer[log.msg.buffer.len - 3 ..], "...");
            break :brk log.msg.buffer.len;
        });
    }

    pub fn print(log: *const TinyLog, rel_path: []const u8) void {
        const after = rel_path[@max(0, log.cursor_at)..];
        bun.Output.errGeneric("\"{s}<blue>{s}<r>{s}\" is not a valid route", .{
            rel_path[0..@max(0, log.cursor_at)],
            after[0..@min(log.cursor_len, after.len)],
            after[@min(log.cursor_len, after.len)..],
        });
        const w = bun.Output.errorWriterBuffered();
        w.writeByteNTimes(' ', "error: \"".len + log.cursor_at) catch return;
        if (bun.Output.enable_ansi_colors_stderr) {
            const symbols = bun.fmt.TableSymbols.unicode;
            bun.Output.prettyError("<blue>" ++ symbols.topColumnSep(), .{});
            if (log.cursor_len > 1) {
                w.writeBytesNTimes(symbols.horizontalEdge(), log.cursor_len - 1) catch return;
            }
        } else {
            if (log.cursor_len <= 1) {
                w.writeAll("|") catch return;
            } else {
                w.writeByteNTimes('-', log.cursor_len - 1) catch return;
            }
        }
        w.writeByte('\n') catch return;
        w.writeByteNTimes(' ', "error: \"".len + log.cursor_at) catch return;
        w.writeAll(log.msg.slice()) catch return;
        bun.Output.prettyError("<r>\n", .{});
        bun.Output.flush();
    }
};

/// Interface for connecting FrameworkRouter to another codebase
pub const InsertionContext = struct {
    opaque_ctx: *anyopaque,
    vtable: *const VTable,
    const VTable = struct {
        getFileIdForRouter: *const fn (*anyopaque, abs_path: []const u8, associated_route: Route.Index, kind: Route.FileKind) bun.OOM!OpaqueFileId,
        onRouterSyntaxError: *const fn (*anyopaque, rel_path: []const u8, fail: TinyLog) bun.OOM!void,
        onRouterCollisionError: *const fn (*anyopaque, rel_path: []const u8, other_id: OpaqueFileId, file_kind: Route.FileKind) bun.OOM!void,
    };
    pub fn wrap(comptime T: type, ctx: *T) InsertionContext {
        const wrapper = struct {
            fn getFileIdForRouter(opaque_ctx: *anyopaque, abs_path: []const u8, associated_route: Route.Index, kind: Route.FileKind) bun.OOM!OpaqueFileId {
                const cast_ctx: *T = @alignCast(@ptrCast(opaque_ctx));
                return try cast_ctx.getFileIdForRouter(abs_path, associated_route, kind);
            }
            fn onRouterSyntaxError(opaque_ctx: *anyopaque, rel_path: []const u8, log: TinyLog) bun.OOM!void {
                const cast_ctx: *T = @alignCast(@ptrCast(opaque_ctx));
                if (!@hasDecl(T, "onRouterSyntaxError")) @panic("TODO: onRouterSyntaxError for " ++ @typeName(T));
                return try cast_ctx.onRouterSyntaxError(rel_path, log);
            }
            fn onRouterCollisionError(opaque_ctx: *anyopaque, rel_path: []const u8, other_id: OpaqueFileId, file_kind: Route.FileKind) bun.OOM!void {
                const cast_ctx: *T = @alignCast(@ptrCast(opaque_ctx));
                if (!@hasDecl(T, "onRouterCollisionError")) @panic("TODO: onRouterCollisionError for " ++ @typeName(T));
                return try cast_ctx.onRouterCollisionError(rel_path, other_id, file_kind);
            }
        };
        return .{
            .opaque_ctx = ctx,
            .vtable = comptime &.{
                .getFileIdForRouter = &wrapper.getFileIdForRouter,
                .onRouterSyntaxError = &wrapper.onRouterSyntaxError,
                .onRouterCollisionError = &wrapper.onRouterCollisionError,
            },
        };
    }
};

pub fn scan(
    fw: *FrameworkRouter,
    alloc: Allocator,
    ty: Type.Index,
    r: *Resolver,
    ctx: InsertionContext,
) bun.OOM!void {
    const t = &fw.types[ty.get()];
    bun.assert(!strings.hasSuffixComptime(t.abs_root, "/"));
    bun.assert(std.fs.path.isAbsolute(t.abs_root));
    const root_info = r.readDirInfoIgnoreError(t.abs_root) orelse
        return;
    var arena_state = std.heap.ArenaAllocator.init(alloc);
    defer arena_state.deinit();
    try fw.scanInner(alloc, t, ty, r, root_info, &arena_state, ctx);
}

fn scanInner(
    fr: *FrameworkRouter,
    alloc: Allocator,
    t: *const Type,
    t_index: Type.Index,
    r: *Resolver,
    dir_info: *const DirInfo,
    arena_state: *std.heap.ArenaAllocator,
    ctx: InsertionContext,
) bun.OOM!void {
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

                    if (r.readDirInfoIgnoreError(fs.abs(&.{ file.dir, file.base() }))) |child_info| {
                        try fr.scanInner(alloc, t, t_index, r, child_info, arena_state, ctx);
                    }
                },
                .file => {
                    const ext = std.fs.path.extension(base);

                    if (t.extensions.len > 0) {
                        for (t.extensions) |allowed_ext| {
                            if (strings.eql(ext, allowed_ext)) break;
                        } else continue :outer;
                    }

                    var rel_path_buf: bun.PathBuffer = undefined;
                    var full_rel_path = bun.path.relativeNormalizedBuf(
                        rel_path_buf[1..],
                        fr.root,
                        fs.abs(&.{ file.dir, file.base() }),
                        .auto,
                        true,
                    );
                    rel_path_buf[0] = '/';
                    bun.path.platformToPosixInPlace(u8, rel_path_buf[0..full_rel_path.len]);
                    const rel_path = if (t.abs_root.len == fr.root.len)
                        rel_path_buf[0 .. full_rel_path.len + 1]
                    else
                        full_rel_path[t.abs_root.len - fr.root.len - 1 ..];
                    var log = TinyLog.empty;
                    defer _ = arena_state.reset(.retain_capacity);
                    const parsed = (t.style.parse(rel_path, ext, &log, t.allow_layouts, arena_state.allocator()) catch {
                        log.cursor_at += @intCast(t.abs_root.len - fr.root.len);
                        try ctx.vtable.onRouterSyntaxError(ctx.opaque_ctx, full_rel_path, log);
                        continue :outer;
                    }) orelse continue :outer;

                    if (parsed.kind == .page and t.ignore_underscores and bun.strings.hasPrefixComptime(base, "_"))
                        continue :outer;

                    var static_total_len: usize = 0;
                    var param_count: usize = 0;
                    for (parsed.parts) |part| {
                        switch (part) {
                            .text => |data| static_total_len += 1 + data.len,

                            .param,
                            .catch_all,
                            .catch_all_optional,
                            => param_count += 1,

                            .group => {},
                        }
                    }

                    if (param_count > 64) {
                        log.write("Pattern cannot have more than 64 param", .{});
                        try ctx.vtable.onRouterSyntaxError(ctx.opaque_ctx, full_rel_path, log);
                        continue :outer;
                    }

                    var out_colliding_file_id: OpaqueFileId = undefined;

                    const file_kind: Route.FileKind = switch (parsed.kind) {
                        .page => .page,
                        .layout => .layout,
                        .extra => @panic("TODO: associate extra files with route"),
                    };

                    const result = switch (param_count > 0) {
                        inline else => |has_dynamic_comptime| result: {
                            const pattern = if (has_dynamic_comptime)
                                try EncodedPattern.initFromParts(parsed.parts, alloc)
                            else static_route: {
                                const allocation = try bun.default_allocator.alloc(u8, static_total_len);
                                var s = std.io.fixedBufferStream(allocation);
                                for (parsed.parts) |part|
                                    switch (part) {
                                        .text => |data| {
                                            _ = s.write("/") catch unreachable;
                                            _ = s.write(data) catch unreachable;
                                        },
                                        .group => {},
                                        .param, .catch_all, .catch_all_optional => unreachable,
                                    };
                                bun.assert(s.getWritten().len == allocation.len);
                                break :static_route StaticPattern{ .route_path = allocation };
                            };

                            break :result fr.insert(
                                alloc,
                                t_index,
                                if (has_dynamic_comptime) .dynamic else .static,
                                pattern,
                                file_kind,
                                fs.abs(&.{ file.dir, file.base() }),
                                ctx,
                                &out_colliding_file_id,
                            );
                        },
                    };

                    result catch |err| switch (err) {
                        error.OutOfMemory => |e| return e,
                        error.RouteCollision => {
                            try ctx.vtable.onRouterCollisionError(
                                ctx.opaque_ctx,
                                full_rel_path,
                                out_colliding_file_id,
                                file_kind,
                            );
                        },
                    };
                },
            }
        }
    }
}

/// This binding is currently only intended for testing FrameworkRouter, and not
/// production usage. It uses a slower but easier to use pattern for object
/// creation. A production-grade JS api would be able to re-use objects.
pub const JSFrameworkRouter = struct {
    pub const codegen = JSC.Codegen.JSFrameworkFileSystemRouter;
    pub usingnamespace codegen;

    files: std.ArrayListUnmanaged(bun.String),
    router: FrameworkRouter,
    stored_parse_errors: std.ArrayListUnmanaged(struct {
        // Owned by bun.default_allocator
        rel_path: []const u8,
        log: TinyLog,
    }),

    const validators = bun.JSC.Node.validators;

    pub fn getBindings(global: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.JSObject.create(.{
            .parseRoutePattern = global.createHostFunction("parseRoutePattern", parseRoutePattern, 1),
            .FrameworkRouter = codegen.getConstructor(global),
        }, global).toJS();
    }

    pub fn constructor(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) !*JSFrameworkRouter {
        const opts = callframe.argumentsAsArray(1)[0];
        if (!opts.isObject())
            return global.throwInvalidArguments("FrameworkRouter needs an object as it's first argument", .{});

        const root = try opts.getOptional(global, "root", bun.String.Slice) orelse
            return global.throwInvalidArguments("Missing options.root", .{});
        defer root.deinit();

        var style = try Style.fromJS(try opts.getOptional(global, "style", JSValue) orelse .undefined, global);
        errdefer style.deinit();

        const abs_root = try bun.default_allocator.dupe(u8, bun.strings.withoutTrailingSlash(
            bun.path.joinAbs(bun.fs.FileSystem.instance.top_level_dir, .auto, root.slice()),
        ));
        errdefer bun.default_allocator.free(abs_root);

        const types = try bun.default_allocator.dupe(Type, &.{.{
            .abs_root = abs_root,
            .ignore_underscores = false,
            .extensions = &.{ ".tsx", ".ts", ".jsx", ".js" },
            .style = style,
            .allow_layouts = true,
            // Unused by JSFrameworkRouter
            .client_file = undefined,
            .server_file = undefined,
            .server_file_string = undefined,
        }});
        errdefer bun.default_allocator.free(types);

        const jsfr = bun.new(JSFrameworkRouter, .{
            .router = try FrameworkRouter.initEmpty(abs_root, types, bun.default_allocator),
            .files = .{},
            .stored_parse_errors = .{},
        });

        try jsfr.router.scan(
            bun.default_allocator,
            Type.Index.init(0),
            &global.bunVM().transpiler.resolver,
            InsertionContext.wrap(JSFrameworkRouter, jsfr),
        );
        if (jsfr.stored_parse_errors.items.len > 0) {
            const arr = JSValue.createEmptyArray(global, jsfr.stored_parse_errors.items.len);
            for (jsfr.stored_parse_errors.items, 0..) |*item, i| {
                arr.putIndex(
                    global,
                    @intCast(i),
                    global.createErrorInstance("Invalid route {}: {s}", .{
                        bun.fmt.quote(item.rel_path),
                        item.log.msg.slice(),
                    }),
                );
            }
            return global.throwValue(global.createAggregateErrorWithArray(
                bun.String.static("Errors scanning routes"),
                arr,
            ));
        }

        return jsfr;
    }

    pub fn match(jsfr: *JSFrameworkRouter, global: *JSGlobalObject, callframe: *JSC.CallFrame) !JSValue {
        const path_js = callframe.argumentsAsArray(1)[0];
        const path_str = try path_js.toBunString2(global);
        defer path_str.deref();
        const path_slice = path_str.toSlice(bun.default_allocator);
        defer path_slice.deinit();

        var params_out: MatchedParams = undefined;
        if (jsfr.router.matchSlow(path_slice.slice(), &params_out)) |index| {
            var sfb = std.heap.stackFallback(4096, bun.default_allocator);
            const alloc = sfb.get();

            return JSC.JSObject.create(.{
                .params = if (params_out.params.len > 0) params: {
                    const obj = JSValue.createEmptyObject(global, params_out.params.len);
                    for (params_out.params.slice()) |param| {
                        const value = bun.String.createUTF8(param.value);
                        defer value.deref();
                        obj.put(global, param.key, value.toJS(global));
                    }
                    break :params obj;
                } else .null,
                .route = try jsfr.routeToJsonInverse(global, index, alloc),
            }, global).toJS();
        }

        return .null;
    }

    pub fn toJSON(jsfr: *JSFrameworkRouter, global: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        _ = callframe;

        var sfb = std.heap.stackFallback(4096, bun.default_allocator);
        const alloc = sfb.get();

        return jsfr.routeToJson(global, Route.Index.init(0), alloc);
    }

    fn routeToJson(jsfr: *JSFrameworkRouter, global: *JSGlobalObject, route_index: Route.Index, allocator: Allocator) !JSValue {
        const route = jsfr.router.routePtr(route_index);
        return JSC.JSObject.create(.{
            .part = try partToJS(global, route.part, allocator),
            .page = jsfr.fileIdToJS(global, route.file_page),
            .layout = jsfr.fileIdToJS(global, route.file_layout),
            // .notFound = jsfr.fileIdToJS(global, route.file_not_found),
            .children = brk: {
                var len: usize = 0;
                var next = route.first_child.unwrap();
                while (next) |r| : (next = jsfr.router.routePtr(r).next_sibling.unwrap())
                    len += 1;
                const arr = JSValue.createEmptyArray(global, len);
                next = route.first_child.unwrap();
                var i: u32 = 0;
                while (next) |r| : (next = jsfr.router.routePtr(r).next_sibling.unwrap()) {
                    arr.putIndex(global, i, try routeToJson(jsfr, global, r, allocator));
                    i += 1;
                }
                break :brk arr;
            },
        }, global).toJS();
    }

    fn routeToJsonInverse(jsfr: *JSFrameworkRouter, global: *JSGlobalObject, route_index: Route.Index, allocator: Allocator) !JSValue {
        const route = jsfr.router.routePtr(route_index);
        return JSC.JSObject.create(.{
            .part = try partToJS(global, route.part, allocator),
            .page = jsfr.fileIdToJS(global, route.file_page),
            .layout = jsfr.fileIdToJS(global, route.file_layout),
            // .notFound = jsfr.fileIdToJS(global, route.file_not_found),
            .parent = if (route.parent.unwrap()) |parent|
                try routeToJsonInverse(jsfr, global, parent, allocator)
            else
                .null,
        }, global).toJS();
    }

    pub fn finalize(this: *JSFrameworkRouter) void {
        this.files.deinit(bun.default_allocator);
        this.router.deinit(bun.default_allocator);
        for (this.stored_parse_errors.items) |i| bun.default_allocator.free(i.rel_path);
        this.stored_parse_errors.deinit(bun.default_allocator);
        bun.destroy(this);
    }

    pub fn parseRoutePattern(global: *JSGlobalObject, frame: *CallFrame) !JSValue {
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        const alloc = arena.allocator();

        if (frame.argumentsCount() < 2)
            return global.throwInvalidArguments("parseRoutePattern takes two arguments", .{});

        const style_js, const filepath_js = frame.argumentsAsArray(2);
        const filepath = try filepath_js.toSlice(global, alloc);
        defer filepath.deinit();
        var style = try Style.fromJS(style_js, global);
        errdefer style.deinit();

        var log = TinyLog.empty;
        const parsed = style.parse(filepath.slice(), std.fs.path.extension(filepath.slice()), &log, true, alloc) catch |err| switch (err) {
            error.InvalidRoutePattern => {
                return global.throw("{s} ({d}:{d})", .{ log.msg.slice(), log.cursor_at, log.cursor_len });
            },
            else => |e| return e,
        } orelse
            return .null;

        var rendered = try std.ArrayList(u8).initCapacity(alloc, filepath.slice().len);
        for (parsed.parts) |part| try part.toStringForInternalUse(rendered.writer());

        var out = bun.String.init(rendered.items);
        const obj = JSValue.createEmptyObject(global, 2);
        obj.put(global, "kind", bun.String.static(@tagName(parsed.kind)).toJS(global));
        obj.put(global, "pattern", out.transferToJS(global));
        return obj;
    }

    fn encodedPatternToJS(global: *JSGlobalObject, pattern: EncodedPattern, temp_allocator: Allocator) !JSValue {
        var rendered = try std.ArrayList(u8).initCapacity(temp_allocator, pattern.data.len);
        defer rendered.deinit();
        var it = pattern.iterate();
        while (it.next()) |part| try part.toStringForInternalUse(rendered.writer());
        var str = bun.String.createUTF8(rendered.items);
        return str.transferToJS(global);
    }

    fn partToJS(global: *JSGlobalObject, part: Part, temp_allocator: Allocator) !JSValue {
        var rendered = std.ArrayList(u8).init(temp_allocator);
        defer rendered.deinit();
        try part.toStringForInternalUse(rendered.writer());
        var str = bun.String.createUTF8(rendered.items);
        return str.transferToJS(global);
    }

    pub fn getFileIdForRouter(jsfr: *JSFrameworkRouter, abs_path: []const u8, _: Route.Index, _: Route.FileKind) !OpaqueFileId {
        try jsfr.files.append(bun.default_allocator, bun.String.createUTF8(abs_path));
        return OpaqueFileId.init(@intCast(jsfr.files.items.len - 1));
    }

    pub fn onRouterSyntaxError(jsfr: *JSFrameworkRouter, rel_path: []const u8, log: TinyLog) !void {
        const rel_path_dupe = try bun.default_allocator.dupe(u8, rel_path);
        errdefer bun.default_allocator.free(rel_path_dupe);
        try jsfr.stored_parse_errors.append(bun.default_allocator, .{
            .rel_path = rel_path_dupe,
            .log = log,
        });
    }

    pub fn fileIdToJS(jsfr: *JSFrameworkRouter, global: *JSGlobalObject, id: OpaqueFileId.Optional) JSValue {
        return jsfr.files.items[(id.unwrap() orelse return .null).get()].toJS(global);
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
