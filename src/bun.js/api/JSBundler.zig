const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const http = @import("../../http.zig");
const JavaScript = @import("../javascript.zig");
const QueryStringMap = @import("../../url.zig").QueryStringMap;
const CombinedScanner = @import("../../url.zig").CombinedScanner;
const bun = @import("bun");
const string = bun.string;
const JSC = bun.JSC;
const js = JSC.C;
const WebCore = @import("../webcore/response.zig");
const Bundler = bun.bundler;
const options = @import("../../options.zig");
const VirtualMachine = JavaScript.VirtualMachine;
const ScriptSrcStream = std.io.FixedBufferStream([]u8);
const ZigString = JSC.ZigString;
const Fs = @import("../../fs.zig");
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;
const JSObject = JSC.JSObject;
const JSError = Base.JSError;
const JSValue = bun.JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = bun.strings;
const NewClass = Base.NewClass;
const To = Base.To;
const Request = WebCore.Request;

const FetchEvent = WebCore.FetchEvent;
const MacroMap = @import("../../resolver/package_json.zig").MacroMap;
const TSConfigJSON = @import("../../resolver/tsconfig_json.zig").TSConfigJSON;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const logger = bun.logger;
const Loader = options.Loader;
const Platform = options.Platform;
const JSAst = bun.JSAst;
const JSParser = bun.js_parser;
const JSPrinter = bun.js_printer;
const ScanPassResult = JSParser.ScanPassResult;
const Mimalloc = @import("../../mimalloc_arena.zig");
const Runtime = @import("../../runtime.zig").Runtime;
const JSLexer = bun.js_lexer;
const Expr = JSAst.Expr;

pub const JSBundler = struct {
    heap: Mimalloc.Arena,
    allocator: std.mem.Allocator,
    configs: Config.List = .{},
    has_pending_activity: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(true),

    pub usingnamespace JSC.Codegen.JSBundler;

    const OwnedString = bun.MutableString;

    pub const Config = struct {
        target: options.Platform = options.Platform.browser,
        entry_points: std.BufSet = std.BufSet.init(bun.default_allocator),
        hot: bool = false,
        define: std.BufMap = std.BufMap.init(bun.default_allocator),
        dir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        serve: Serve = .{},
        jsx: options.JSX.Pragma = .{},
        code_splitting: bool = false,
        minify: Minify = .{},
        server_components: ServerComponents = ServerComponents{},
        plugins: PluginDeclaration.List = .{},

        names: Names = .{},
        label: OwnedString = OwnedString.initEmpty(bun.default_allocator),

        pub const List = bun.StringArrayHashMapUnmanaged(Config);

        ///
        /// { name: "", setup: (build) {} }
        pub const PluginDeclaration = struct {
            name: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            setup: JSC.Strong = .{},

            pub const List = std.ArrayListUnmanaged(PluginDeclaration);

            pub fn deinit(this: *PluginDeclaration) void {
                this.name.deinit();
                this.setup.deinit();
            }
        };

        pub fn fromJS(globalThis: *JSC.JSGlobalObject, config: JSC.JSValue, allocator: std.mem.Allocator) !Config {
            var this = Config{
                .entry_points = std.BufSet.init(allocator),
                .define = std.BufMap.init(allocator),
                .dir = OwnedString.initEmpty(allocator),
                .label = OwnedString.initEmpty(allocator),
                .names = .{
                    .owned_entry_point = OwnedString.initEmpty(allocator),
                    .owned_chunk = OwnedString.initEmpty(allocator),
                },
            };
            errdefer this.deinit(allocator);

            if (try config.getOptionalEnum(globalThis, "target", options.Platform)) |target| {
                this.target = target;
            }

            if (try config.getOptional(globalThis, "hot", bool)) |hot| {
                this.hot = hot;
            }

            if (try config.getOptional(globalThis, "splitting", bool)) |hot| {
                this.code_splitting = hot;
            }

            if (try config.getOptional(globalThis, "minifyWhitespace", bool)) |hot| {
                this.minify.whitespace = hot;
            }

            if (try config.getArray(globalThis, "entrypoints")) |entry_points| {
                var iter = entry_points.arrayIterator(globalThis);
                while (iter.next()) |entry_point| {
                    var slice = entry_point.toSliceOrNull(globalThis, allocator) orelse {
                        globalThis.throwInvalidArguments("Expected entrypoints to be an array of strings", .{});
                        return error.JSException;
                    };
                    defer slice.deinit();
                    try this.entry_points.insert(slice.slice());
                }
            } else {
                globalThis.throwInvalidArguments("Expected entrypoints to be an array of strings", .{});
                return error.JSException;
            }

            if (try config.getOptional(globalThis, "name", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.label.appendSliceExact(slice.slice()) catch unreachable;
            }

            if (try config.getOptional(globalThis, "dir", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.dir.appendSliceExact(slice.slice()) catch unreachable;
            } else {
                this.dir.appendSliceExact(globalThis.bunVM().bundler.fs.top_level_dir) catch unreachable;
            }

            if (try config.getOptional(globalThis, "entryNames", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.names.owned_entry_point.appendSliceExact(slice.slice()) catch unreachable;
                this.names.entry_point.data = this.names.owned_entry_point.list.items;
            }

            if (try config.getOptional(globalThis, "chunkNames", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.names.owned_chunk.appendSliceExact(slice.slice()) catch unreachable;
                this.names.chunk.data = this.names.owned_chunk.list.items;
            }

            if (try config.getArray(globalThis, "plugins")) |array| {
                var iter = array.arrayIterator(globalThis);
                while (iter.next()) |plugin| {
                    var decl = PluginDeclaration{
                        .name = OwnedString.initEmpty(allocator),
                        .setup = .{},
                    };
                    errdefer decl.deinit();

                    if (plugin.getObject(globalThis, "SECRET_SERVER_COMPONENTS_INTERNALS")) |internals| {
                        if (try internals.get(globalThis, "router")) |router_value| {
                            if (router_value.as(JSC.API.FileSystemRouter) != null) {
                                this.server_components.router.set(globalThis, router_value);
                            } else {
                                globalThis.throwInvalidArguments("Expected router to be a Bun.FileSystemRouter", .{});
                                return error.JSError;
                            }
                        }

                        const directive_object = (try internals.getObject(globalThis, "directive")) orelse {
                            globalThis.throwInvalidArguments("Expected directive to be an object", .{});
                            return error.JSError;
                        };

                        if (try directive_object.getArray(globalThis, "client")) |client_names_array| {
                            var array_iter = client_names_array.arrayIterator(globalThis);
                            while (array_iter.next()) |client_name| {
                                var slice = client_name.toSliceOrNull(globalThis, allocator) orelse {
                                    globalThis.throwInvalidArguments("Expected directive.client to be an array of strings", .{});
                                    return error.JSException;
                                };
                                defer slice.deinit();
                                try this.server_components.client.append(allocator, OwnedString.initCopy(allocator, slice.slice()) catch unreachable);
                            }
                        } else {
                            globalThis.throwInvalidArguments("Expected directive.client to be an array of strings", .{});
                            return error.JSException;
                        }

                        if (try directive_object.getArray(globalThis, "server")) |server_names_array| {
                            var array_iter = server_names_array.arrayIterator(globalThis);
                            while (array_iter.next()) |server_name| {
                                var slice = server_name.toSliceOrNull(globalThis, allocator) orelse {
                                    globalThis.throwInvalidArguments("Expected directive.server to be an array of strings", .{});
                                    return error.JSException;
                                };
                                defer slice.deinit();
                                try this.server_components.server.append(allocator, OwnedString.initCopy(allocator, slice.slice()) catch unreachable);
                            }
                        } else {
                            globalThis.throwInvalidArguments("Expected directive.server to be an array of strings", .{});
                            return error.JSException;
                        }
                    }

                    if (try plugin.getOptional(globalThis, "name", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        decl.name.appendSliceExact(slice.slice()) catch unreachable;
                    }

                    if (try plugin.getFunction(globalThis, "setup", JSC.JSValue)) |setup| {
                        decl.setup.set(globalThis, setup);
                    } else {
                        globalThis.throwInvalidArguments("Expected plugin to have a setup() function", .{});
                        return error.JSError;
                    }

                    try this.plugins.append(allocator, decl);
                }
            }

            return config;
        }

        pub const Names = struct {
            owned_entry_point: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            entry_point: options.PathTemplate = options.PathTemplate.file,
            owned_chunk: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            chunk: options.PathTemplate = options.PathTemplate.chunk,

            pub fn deinit(self: *Names) void {
                self.owned_entry_point.deinit();
                self.owned_chunk.deinit();
            }
        };

        pub const ServerComponents = struct {
            router: JSC.Strong = .{},
            client: std.ArrayListUnmanaged(OwnedString) = .{},
            server: std.ArrayListUnmanaged(OwnedString) = .{},

            pub fn deinit(self: *ServerComponents, allocator: std.mem.Allocator) void {
                self.router.deinit();
                self.client.clearAndFree(allocator);
                self.server.clearAndFree(allocator);
            }
        };

        pub const Minify = struct {
            whitespace: bool = false,
        };

        pub const Serve = struct {
            handler_path: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            prefix: OwnedString = OwnedString.initEmpty(bun.default_allocator),

            pub fn deinit(self: *Serve, allocator: std.mem.Allocator) void {
                _ = allocator;
                self.handler_path.deinit();
                self.prefix.deinit();
            }
        };

        pub fn deinit(self: *Config, allocator: std.mem.Allocator) void {
            self.entry_points.deinit();
            self.define.deinit();
            self.dir.deinit();
            self.serve.deinit(allocator);
            self.plugins.deinit();
            self.server_components.deinit(allocator);
            self.names.deinit();
            self.label.deinit();
        }
    };

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*JSBundler {
        var temp = std.heap.ArenaAllocator.init(getAllocator(globalThis));
        const arguments = callframe.arguments(3);
        var args = JSC.Node.ArgumentsSlice.init(
            globalThis.bunVM(),
            arguments.ptr[0..arguments.len],
        );
        _ = args;

        defer temp.deinit();

        return null;
    }

    pub fn handleRequest(
        this: *JSBundler,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        _ = callframe;
        _ = globalThis;
        _ = this;

        return .zero;
    }

    pub fn write(
        this: *JSBundler,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        _ = callframe;
        _ = globalThis;
        _ = this;

        return .zero;
    }

    pub fn hasPendingActivity(this: *JSBundler) callconv(.C) bool {
        @fence(.Acquire);
        return this.has_pending_activity.load(.Acquire);
    }

    pub fn finalize(
        this: *JSBundler,
    ) callconv(.C) void {
        this.heap.deinit();
        JSC.VirtualMachine.get().allocator.destroy(this);
    }
};
