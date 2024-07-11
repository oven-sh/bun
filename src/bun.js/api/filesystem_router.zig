const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const JavaScript = @import("../javascript.zig");
const QueryStringMap = @import("../../url.zig").QueryStringMap;
const CombinedScanner = @import("../../url.zig").CombinedScanner;
const bun = @import("root").bun;
const string = bun.string;
const JSC = bun.JSC;
const js = JSC.C;
const WebCore = JSC.WebCore;
const Bundler = bun.bundler;
const VirtualMachine = JavaScript.VirtualMachine;
const ScriptSrcStream = std.io.FixedBufferStream([]u8);
const ZigString = JSC.ZigString;
const Fs = @import("../../fs.zig");
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;
const JSObject = JSC.JSObject;
const JSError = Base.JSError;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = bun.strings;

const To = Base.To;
const Request = WebCore.Request;

const URLPath = @import("../../http/url_path.zig");
const URL = @import("../../url.zig").URL;
const Log = bun.logger;
const Resolver = @import("../../resolver/resolver.zig").Resolver;
const Router = @import("../../router.zig");

const default_extensions = &[_][]const u8{
    "tsx",
    "jsx",
    "ts",
    "mjs",
    "cjs",
    "js",
};

pub const FileSystemRouter = struct {
    origin: ?*JSC.RefString = null,
    base_dir: ?*JSC.RefString = null,
    router: Router,
    arena: *bun.ArenaAllocator = undefined,
    allocator: std.mem.Allocator = undefined,
    asset_prefix: ?*JSC.RefString = null,

    pub usingnamespace JSC.Codegen.JSFileSystemRouter;

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) ?*FileSystemRouter {
        const argument_ = callframe.arguments(1);
        if (argument_.len == 0) {
            globalThis.throwInvalidArguments("Expected object", .{});
            return null;
        }

        const argument = argument_.ptr[0];
        if (argument.isEmptyOrUndefinedOrNull() or !argument.isObject()) {
            globalThis.throwInvalidArguments("Expected object", .{});
            return null;
        }
        var vm = globalThis.bunVM();

        var root_dir_path: ZigString.Slice = ZigString.Slice.fromUTF8NeverFree(vm.bundler.fs.top_level_dir);
        defer root_dir_path.deinit();
        var origin_str: ZigString.Slice = .{};
        var asset_prefix_slice: ZigString.Slice = .{};

        var out_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;
        if (argument.get(globalThis, "style")) |style_val| {
            if (!style_val.getZigString(globalThis).eqlComptime("nextjs")) {
                globalThis.throwInvalidArguments("Only 'nextjs' style is currently implemented", .{});
                return null;
            }
        } else {
            globalThis.throwInvalidArguments("Expected 'style' option (ex: \"style\": \"nextjs\")", .{});
            return null;
        }

        if (argument.get(globalThis, "dir")) |dir| {
            if (!dir.isString()) {
                globalThis.throwInvalidArguments("Expected dir to be a string", .{});
                return null;
            }
            const root_dir_path_ = dir.toSlice(globalThis, globalThis.allocator());
            if (!(root_dir_path_.len == 0 or strings.eqlComptime(root_dir_path_.slice(), "."))) {
                // resolve relative path if needed
                const path = root_dir_path_.slice();
                if (bun.path.Platform.isAbsolute(.auto, path)) {
                    root_dir_path = root_dir_path_;
                } else {
                    var parts = [_][]const u8{path};
                    root_dir_path = JSC.ZigString.Slice.fromUTF8NeverFree(bun.path.joinAbsStringBuf(Fs.FileSystem.instance.top_level_dir, &out_buf, &parts, .auto));
                }
            }
        } else {
            // dir is not optional
            globalThis.throwInvalidArguments("Expected dir to be a string", .{});
            return null;
        }
        var arena = globalThis.allocator().create(bun.ArenaAllocator) catch unreachable;
        arena.* = bun.ArenaAllocator.init(globalThis.allocator());
        const allocator = arena.allocator();
        var extensions = std.ArrayList(string).init(allocator);
        if (argument.get(globalThis, "fileExtensions")) |file_extensions| {
            if (!file_extensions.jsType().isArray()) {
                globalThis.throwInvalidArguments("Expected fileExtensions to be an Array", .{});
                origin_str.deinit();
                arena.deinit();
                globalThis.allocator().destroy(arena);
                return null;
            }

            var iter = file_extensions.arrayIterator(globalThis);
            extensions.ensureTotalCapacityPrecise(iter.len) catch unreachable;
            while (iter.next()) |val| {
                if (!val.isString()) {
                    globalThis.throwInvalidArguments("Expected fileExtensions to be an Array of strings", .{});
                    origin_str.deinit();
                    arena.deinit();
                    globalThis.allocator().destroy(arena);
                    return null;
                }
                if (val.getLength(globalThis) == 0) continue;
                extensions.appendAssumeCapacity((val.toSlice(globalThis, allocator).clone(allocator) catch unreachable).slice()[1..]);
            }
        }

        if (argument.getTruthy(globalThis, "assetPrefix")) |asset_prefix| {
            if (!asset_prefix.isString()) {
                globalThis.throwInvalidArguments("Expected assetPrefix to be a string", .{});
                origin_str.deinit();
                arena.deinit();
                globalThis.allocator().destroy(arena);
                return null;
            }

            asset_prefix_slice = asset_prefix.toSlice(globalThis, allocator).clone(allocator) catch unreachable;
        }
        const orig_log = vm.bundler.resolver.log;
        var log = Log.Log.init(allocator);
        vm.bundler.resolver.log = &log;
        defer vm.bundler.resolver.log = orig_log;

        const path_to_use = (root_dir_path.cloneWithTrailingSlash(allocator) catch unreachable).slice();

        const root_dir_info = vm.bundler.resolver.readDirInfo(path_to_use) catch {
            globalThis.throwValue(log.toJS(globalThis, globalThis.allocator(), "reading root directory"));
            origin_str.deinit();
            arena.deinit();
            globalThis.allocator().destroy(arena);
            return null;
        } orelse {
            globalThis.throw("Unable to find directory: {s}", .{root_dir_path.slice()});
            origin_str.deinit();
            arena.deinit();
            globalThis.allocator().destroy(arena);
            return null;
        };

        var router = Router.init(vm.bundler.fs, allocator, .{
            .dir = path_to_use,
            .extensions = if (extensions.items.len > 0) extensions.items else default_extensions,
            .asset_prefix_path = asset_prefix_slice.slice(),
        }) catch unreachable;

        router.loadRoutes(&log, root_dir_info, Resolver, &vm.bundler.resolver, router.config.dir) catch {
            globalThis.throwValue(log.toJS(globalThis, globalThis.allocator(), "loading routes"));
            origin_str.deinit();
            arena.deinit();
            globalThis.allocator().destroy(arena);
            return null;
        };

        if (argument.get(globalThis, "origin")) |origin| {
            if (!origin.isString()) {
                globalThis.throwInvalidArguments("Expected origin to be a string", .{});
                arena.deinit();
                globalThis.allocator().destroy(arena);
                return null;
            }
            origin_str = origin.toSlice(globalThis, globalThis.allocator());
        }

        if (log.errors + log.warnings > 0) {
            globalThis.throwValue(log.toJS(globalThis, globalThis.allocator(), "loading routes"));
            origin_str.deinit();
            arena.deinit();
            globalThis.allocator().destroy(arena);
            return null;
        }

        var fs_router = globalThis.allocator().create(FileSystemRouter) catch unreachable;
        fs_router.* = .{
            .origin = if (origin_str.len > 0) vm.refCountedString(origin_str.slice(), null, true) else null,
            .base_dir = vm.refCountedString(if (root_dir_info.abs_real_path.len > 0)
                root_dir_info.abs_real_path
            else
                root_dir_info.abs_path, null, true),
            .asset_prefix = if (asset_prefix_slice.len > 0) vm.refCountedString(asset_prefix_slice.slice(), null, true) else null,
            .router = router,
            .arena = arena,
            .allocator = allocator,
        };

        router.config.dir = fs_router.base_dir.?.slice();
        fs_router.base_dir.?.ref();

        return fs_router;
    }

    pub fn reload(this: *FileSystemRouter, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        const this_value = callframe.this();

        var arena = globalThis.allocator().create(bun.ArenaAllocator) catch unreachable;
        arena.* = bun.ArenaAllocator.init(globalThis.allocator());

        var allocator = arena.allocator();
        var vm = globalThis.bunVM();

        const orig_log = vm.bundler.resolver.log;
        var log = Log.Log.init(allocator);
        vm.bundler.resolver.log = &log;
        defer vm.bundler.resolver.log = orig_log;

        const root_dir_info = vm.bundler.resolver.readDirInfo(this.router.config.dir) catch {
            globalThis.throwValue(log.toJS(globalThis, globalThis.allocator(), "reading root directory"));
            return .zero;
        } orelse {
            globalThis.throw("Unable to find directory: {s}", .{this.router.config.dir});
            arena.deinit();
            globalThis.allocator().destroy(arena);
            return .zero;
        };

        var router = Router.init(vm.bundler.fs, allocator, .{
            .dir = allocator.dupe(u8, this.router.config.dir) catch unreachable,
            .extensions = allocator.dupe(string, this.router.config.extensions) catch unreachable,
            .asset_prefix_path = this.router.config.asset_prefix_path,
        }) catch unreachable;
        router.loadRoutes(&log, root_dir_info, Resolver, &vm.bundler.resolver, router.config.dir) catch {
            globalThis.throwValue(log.toJS(globalThis, globalThis.allocator(), "loading routes"));

            arena.deinit();
            globalThis.allocator().destroy(arena);
            return .zero;
        };

        this.arena.deinit();
        this.router.deinit();
        globalThis.allocator().destroy(this.arena);

        this.arena = arena;
        @This().routesSetCached(this_value, globalThis, JSC.JSValue.zero);
        this.allocator = allocator;
        this.router = router;
        return this_value;
    }

    pub fn match(this: *FileSystemRouter, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        const argument_ = callframe.arguments(2);
        if (argument_.len == 0) {
            globalThis.throwInvalidArguments("Expected string, Request or Response", .{});
            return JSValue.zero;
        }

        const argument = argument_.ptr[0];
        if (argument.isEmptyOrUndefinedOrNull() or !argument.isCell()) {
            globalThis.throwInvalidArguments("Expected string, Request or Response", .{});
            return JSValue.zero;
        }

        var path: ZigString.Slice = brk: {
            if (argument.isString()) {
                break :brk argument.toSlice(globalThis, globalThis.allocator()).clone(globalThis.allocator()) catch unreachable;
            }

            if (argument.isCell()) {
                if (argument.as(JSC.WebCore.Request)) |req| {
                    req.ensureURL() catch unreachable;
                    break :brk req.url.toUTF8(globalThis.allocator());
                }

                if (argument.as(JSC.WebCore.Response)) |resp| {
                    break :brk resp.url.toUTF8(globalThis.allocator());
                }
            }

            globalThis.throwInvalidArguments("Expected string, Request or Response", .{});
            return JSValue.zero;
        };

        if (path.len == 0 or (path.len == 1 and path.ptr[0] == '/')) {
            path = ZigString.Slice.fromUTF8NeverFree("/");
        }

        if (strings.hasPrefixComptime(path.slice(), "http://") or strings.hasPrefixComptime(path.slice(), "https://") or strings.hasPrefixComptime(path.slice(), "file://")) {
            const prev_path = path;
            path = ZigString.init(URL.parse(path.slice()).pathname).toSliceFast(globalThis.allocator()).clone(globalThis.allocator()) catch unreachable;
            prev_path.deinit();
        }

        const url_path = URLPath.parse(path.slice()) catch |err| {
            globalThis.throw("{s} parsing path: {s}", .{ @errorName(err), path.slice() });
            return JSValue.zero;
        };
        var params = Router.Param.List{};
        defer params.deinit(globalThis.allocator());
        const route = this.router.routes.matchPageWithAllocator(
            "",
            url_path,
            &params,
            globalThis.allocator(),
        ) orelse {
            return JSValue.jsNull();
        };

        var result = MatchedRoute.init(
            globalThis.allocator(),
            route,
            this.origin,
            this.asset_prefix,
            this.base_dir.?,
        ) catch unreachable;
        return result.toJS(globalThis);
    }

    pub fn getOrigin(this: *FileSystemRouter, globalThis: *JSC.JSGlobalObject) JSValue {
        if (this.origin) |origin| {
            return JSC.ZigString.init(origin.slice()).withEncoding().toJS(globalThis);
        }

        return JSValue.jsNull();
    }

    pub fn getRoutes(this: *FileSystemRouter, globalThis: *JSC.JSGlobalObject) JSValue {
        const paths = this.router.getEntryPoints() catch unreachable;
        const names = this.router.getNames() catch unreachable;
        var name_strings = bun.default_allocator.alloc(ZigString, names.len * 2) catch unreachable;
        defer bun.default_allocator.free(name_strings);
        var paths_strings = name_strings[names.len..];
        for (names, 0..) |name, i| {
            name_strings[i] = ZigString.init(name).withEncoding();
            paths_strings[i] = ZigString.init(paths[i]).withEncoding();
        }
        return JSC.JSValue.fromEntries(
            globalThis,
            name_strings.ptr,
            paths_strings.ptr,
            names.len,
            true,
        );
    }

    pub fn getStyle(_: *FileSystemRouter, globalThis: *JSC.JSGlobalObject) JSValue {
        return ZigString.static("nextjs").toJS(globalThis);
    }

    pub fn getAssetPrefix(this: *FileSystemRouter, globalThis: *JSC.JSGlobalObject) JSValue {
        if (this.asset_prefix) |asset_prefix| {
            return JSC.ZigString.init(asset_prefix.slice()).withEncoding().toJS(globalThis);
        }

        return JSValue.jsNull();
    }

    pub fn finalize(
        this: *FileSystemRouter,
    ) callconv(.C) void {
        if (this.asset_prefix) |prefix| {
            prefix.deref();
        }

        if (this.origin) |prefix| {
            prefix.deref();
        }

        if (this.base_dir) |dir| {
            dir.deref();
        }

        this.router.deinit();
        this.arena.deinit();
    }
};

pub const MatchedRoute = struct {
    route: *const Router.Match,
    route_holder: Router.Match = undefined,
    query_string_map: ?QueryStringMap = null,
    param_map: ?QueryStringMap = null,
    params_list_holder: Router.Param.List = .{},
    origin: ?*JSC.RefString = null,
    asset_prefix: ?*JSC.RefString = null,
    needs_deinit: bool = true,
    base_dir: ?*JSC.RefString = null,

    pub usingnamespace JSC.Codegen.JSMatchedRoute;

    pub fn getName(this: *MatchedRoute, globalThis: *JSC.JSGlobalObject) JSValue {
        return ZigString.init(this.route.name).withEncoding().toJS(globalThis);
    }

    pub fn init(
        allocator: std.mem.Allocator,
        match: Router.Match,
        origin: ?*JSC.RefString,
        asset_prefix: ?*JSC.RefString,
        base_dir: *JSC.RefString,
    ) !*MatchedRoute {
        const params_list = try match.params.clone(allocator);

        var route = try allocator.create(MatchedRoute);

        route.* = MatchedRoute{
            .route_holder = match,
            .route = undefined,
            .asset_prefix = asset_prefix,
            .origin = origin,
            .base_dir = base_dir,
        };
        base_dir.ref();
        route.params_list_holder = params_list;
        route.route = &route.route_holder;
        route.route_holder.params = &route.params_list_holder;
        if (origin) |o| {
            o.ref();
        }

        if (asset_prefix) |prefix| {
            prefix.ref();
        }

        return route;
    }

    pub fn deinit(this: *MatchedRoute) void {
        if (this.query_string_map) |*map| {
            map.deinit();
        }
        if (this.needs_deinit) {
            if (this.route.pathname.len > 0 and bun.Mimalloc.mi_is_in_heap_region(this.route.pathname.ptr)) {
                bun.Mimalloc.mi_free(@constCast(this.route.pathname.ptr));
            }

            this.params_list_holder.deinit(bun.default_allocator);
            this.params_list_holder = .{};
        }

        if (this.origin) |o| {
            o.deref();
        }

        if (this.asset_prefix) |prefix| {
            prefix.deref();
        }

        if (this.base_dir) |base|
            base.deref();

        bun.default_allocator.destroy(this);
    }

    pub fn getFilePath(
        this: *MatchedRoute,
        globalThis: *JSC.JSGlobalObject,
    ) JSValue {
        return ZigString.init(this.route.file_path)
            .withEncoding()
            .toJS(globalThis);
    }

    pub fn finalize(
        this: *MatchedRoute,
    ) callconv(.C) void {
        this.deinit();
    }

    pub fn getPathname(this: *MatchedRoute, globalThis: *JSC.JSGlobalObject) JSValue {
        return ZigString.init(this.route.pathname)
            .withEncoding()
            .toJS(globalThis);
    }

    pub fn getRoute(this: *MatchedRoute, globalThis: *JSC.JSGlobalObject) JSValue {
        return ZigString.init(this.route.name)
            .withEncoding()
            .toJS(globalThis);
    }

    const KindEnum = struct {
        pub const exact = "exact";
        pub const catch_all = "catch-all";
        pub const optional_catch_all = "optional-catch-all";
        pub const dynamic = "dynamic";

        // this is kinda stupid it should maybe just store it
        pub fn init(name: string) ZigString {
            if (strings.contains(name, "[[...")) {
                return ZigString.init(optional_catch_all);
            } else if (strings.contains(name, "[...")) {
                return ZigString.init(catch_all);
            } else if (strings.contains(name, "[")) {
                return ZigString.init(dynamic);
            } else {
                return ZigString.init(exact);
            }
        }
    };

    pub fn getKind(this: *MatchedRoute, globalThis: *JSC.JSGlobalObject) JSValue {
        return KindEnum.init(this.route.name).toJS(globalThis);
    }

    threadlocal var query_string_values_buf: [256]string = undefined;
    threadlocal var query_string_value_refs_buf: [256]ZigString = undefined;
    pub fn createQueryObject(ctx: js.JSContextRef, map: *QueryStringMap) JSValue {
        const QueryObjectCreator = struct {
            query: *QueryStringMap,
            pub fn create(this: *@This(), obj: *JSObject, global: *JSGlobalObject) void {
                var iter = this.query.iter();
                while (iter.next(&query_string_values_buf)) |entry| {
                    const entry_name = entry.name;
                    var str = ZigString.init(entry_name).withEncoding();

                    bun.assert(entry.values.len > 0);
                    if (entry.values.len > 1) {
                        var values = query_string_value_refs_buf[0..entry.values.len];
                        for (entry.values, 0..) |value, i| {
                            values[i] = ZigString.init(value).withEncoding();
                        }
                        obj.putRecord(global, &str, values.ptr, values.len);
                    } else {
                        query_string_value_refs_buf[0] = ZigString.init(entry.values[0]).withEncoding();

                        obj.putRecord(global, &str, &query_string_value_refs_buf, 1);
                    }
                }
            }
        };

        var creator = QueryObjectCreator{ .query = map };

        const value = JSObject.createWithInitializer(QueryObjectCreator, &creator, ctx, map.getNameCount());

        return value;
    }

    pub fn getScriptSrcString(
        origin: []const u8,
        comptime Writer: type,
        writer: Writer,
        file_path: string,
        client_framework_enabled: bool,
    ) void {
        var entry_point_tempbuf: bun.PathBuffer = undefined;
        // We don't store the framework config including the client parts in the server
        // instead, we just store a boolean saying whether we should generate this whenever the script is requested
        // this is kind of bad. we should consider instead a way to inline the contents of the script.
        if (client_framework_enabled) {
            JSC.API.Bun.getPublicPath(
                Bundler.ClientEntryPoint.generateEntryPointPath(
                    &entry_point_tempbuf,
                    Fs.PathName.init(file_path),
                ),
                origin,
                Writer,
                writer,
            );
        } else {
            JSC.API.Bun.getPublicPath(file_path, origin, Writer, writer);
        }
    }

    pub fn getScriptSrc(
        this: *MatchedRoute,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        var buf: bun.PathBuffer = undefined;
        var stream = std.io.fixedBufferStream(&buf);
        var writer = stream.writer();
        JSC.API.Bun.getPublicPathWithAssetPrefix(
            this.route.file_path,
            if (this.base_dir) |base_dir| base_dir.slice() else VirtualMachine.get().bundler.fs.top_level_dir,
            if (this.origin) |origin| URL.parse(origin.slice()) else URL{},
            if (this.asset_prefix) |prefix| prefix.slice() else "",
            @TypeOf(&writer),
            &writer,
            .posix,
        );
        return ZigString.init(buf[0..writer.context.pos])
            .withEncoding()
            .toJS(globalThis);
    }

    pub fn getParams(
        this: *MatchedRoute,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        if (this.route.params.len == 0)
            return JSValue.createEmptyObject(globalThis, 0);

        if (this.param_map == null) {
            this.param_map = QueryStringMap.initWithScanner(
                globalThis.allocator(),
                CombinedScanner.init(
                    "",
                    this.route.pathnameWithoutLeadingSlash(),
                    this.route.name,
                    this.route.params,
                ),
            ) catch
                unreachable;
        }

        return createQueryObject(globalThis, &this.param_map.?);
    }

    pub fn getQuery(
        this: *MatchedRoute,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        if (this.route.query_string.len == 0 and this.route.params.len == 0) {
            return JSValue.createEmptyObject(globalThis, 0);
        } else if (this.route.query_string.len == 0) {
            return this.getParams(globalThis);
        }

        if (this.query_string_map == null) {
            if (this.route.params.len > 0) {
                if (QueryStringMap.initWithScanner(globalThis.allocator(), CombinedScanner.init(
                    this.route.query_string,
                    this.route.pathnameWithoutLeadingSlash(),
                    this.route.name,

                    this.route.params,
                ))) |map| {
                    this.query_string_map = map;
                } else |_| {}
            } else {
                if (QueryStringMap.init(globalThis.allocator(), this.route.query_string)) |map| {
                    this.query_string_map = map;
                } else |_| {}
            }
        }

        // If it's still null, the query string has no names.
        if (this.query_string_map) |*map| {
            return createQueryObject(globalThis, map);
        }

        return JSValue.createEmptyObject(globalThis, 0);
    }
};
