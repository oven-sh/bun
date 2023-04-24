const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const http = @import("../../http.zig");
const JavaScript = @import("../javascript.zig");
const QueryStringMap = @import("../../url.zig").QueryStringMap;
const CombinedScanner = @import("../../url.zig").CombinedScanner;
const bun = @import("root").bun;
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
const Index = @import("../../ast/base.zig").Index;

pub const JSBundler = struct {
    const OwnedString = bun.MutableString;

    pub const Config = struct {
        target: options.Platform = options.Platform.browser,
        entry_points: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        hot: bool = false,
        define: bun.StringMap = bun.StringMap.init(bun.default_allocator, true),
        dir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        outdir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        serve: Serve = .{},
        jsx: options.JSX.Pragma = .{},
        code_splitting: bool = false,
        minify: Minify = .{},
        server_components: ServerComponents = ServerComponents{},

        names: Names = .{},
        label: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        external: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        sourcemap: options.SourceMapOption = .none,

        pub const List = bun.StringArrayHashMapUnmanaged(Config);

        pub fn fromJS(globalThis: *JSC.JSGlobalObject, config: JSC.JSValue, plugins: *?*Plugin, allocator: std.mem.Allocator) !Config {
            var this = Config{
                .entry_points = bun.StringSet.init(allocator),
                .external = bun.StringSet.init(allocator),
                .define = bun.StringMap.init(allocator, true),
                .dir = OwnedString.initEmpty(allocator),
                .label = OwnedString.initEmpty(allocator),
                .outdir = OwnedString.initEmpty(allocator),
                .names = .{
                    .owned_entry_point = OwnedString.initEmpty(allocator),
                    .owned_chunk = OwnedString.initEmpty(allocator),
                },
            };
            errdefer this.deinit(allocator);
            errdefer if (plugins.*) |plugin| plugin.deinit();

            if (try config.getOptionalEnum(globalThis, "target", options.Platform)) |target| {
                this.target = target;
            }

            if (try config.getOptional(globalThis, "hot", bool)) |hot| {
                this.hot = hot;
            }

            if (try config.getOptional(globalThis, "splitting", bool)) |hot| {
                this.code_splitting = hot;
            }

            if (try config.getOptional(globalThis, "outdir", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.outdir.appendSliceExact(slice.slice()) catch unreachable;
            }

            if (config.getTruthy(globalThis, "minify")) |hot| {
                if (hot.isBoolean()) {
                    this.minify.whitespace = hot.coerce(bool, globalThis);
                    this.minify.syntax = this.minify.whitespace;
                    this.minify.identifiers = this.minify.whitespace;
                } else if (hot.isObject()) {
                    if (try hot.getOptional(globalThis, "whitespace", bool)) |whitespace| {
                        this.minify.whitespace = whitespace;
                    }
                    if (try hot.getOptional(globalThis, "syntax", bool)) |syntax| {
                        this.minify.syntax = syntax;
                    }
                    if (try hot.getOptional(globalThis, "identifiers", bool)) |syntax| {
                        this.minify.identifiers = syntax;
                    }
                } else {
                    globalThis.throwInvalidArguments("Expected minify to be a boolean or an object", .{});
                    return error.JSException;
                }
            }

            if (try config.getArray(globalThis, "entrypoints")) |entry_points| {
                var iter = entry_points.arrayIterator(globalThis);
                while (iter.next()) |entry_point| {
                    var slice = entry_point.toSliceOrNull(globalThis) orelse {
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

            if (try config.getArray(globalThis, "external")) |externals| {
                var iter = externals.arrayIterator(globalThis);
                while (iter.next()) |entry_point| {
                    var slice = entry_point.toSliceOrNull(globalThis) orelse {
                        globalThis.throwInvalidArguments("Expected external to be an array of strings", .{});
                        return error.JSException;
                    };
                    defer slice.deinit();
                    try this.external.insert(slice.slice());
                }
            }

            if (try config.getOptional(globalThis, "label", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.label.appendSliceExact(slice.slice()) catch unreachable;
            }

            if (try config.getOptional(globalThis, "dir", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.dir.appendSliceExact(slice.slice()) catch unreachable;
            } else {
                this.dir.appendSliceExact(globalThis.bunVM().bundler.fs.top_level_dir) catch unreachable;
            }

            if (try config.getObject(globalThis, "naming")) |naming| {
                if (try naming.getOptional(globalThis, "entrypoint", ZigString.Slice)) |slice| {
                    defer slice.deinit();
                    this.names.owned_entry_point.appendSliceExact(slice.slice()) catch unreachable;
                    this.names.entry_point.data = this.names.owned_entry_point.list.items;
                }

                if (try naming.getOptional(globalThis, "chunk", ZigString.Slice)) |slice| {
                    defer slice.deinit();
                    this.names.owned_chunk.appendSliceExact(slice.slice()) catch unreachable;
                    this.names.chunk.data = this.names.owned_chunk.list.items;
                }
            }

            if (try config.getArray(globalThis, "plugins")) |array| {
                var iter = array.arrayIterator(globalThis);
                while (iter.next()) |plugin| {
                    if (try plugin.getObject(globalThis, "SECRET_SERVER_COMPONENTS_INTERNALS")) |internals| {
                        if (internals.get(globalThis, "router")) |router_value| {
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
                                var slice = client_name.toSliceOrNull(globalThis) orelse {
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
                                var slice = server_name.toSliceOrNull(globalThis) orelse {
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

                        continue;
                    }

                    // var decl = PluginDeclaration{
                    //     .name = OwnedString.initEmpty(allocator),
                    //     .setup = .{},
                    // };
                    // defer decl.deinit();

                    // if (try plugin.getOptional(globalThis, "name", ZigString.Slice)) |slice| {
                    //     defer slice.deinit();
                    //     decl.name.appendSliceExact(slice.slice()) catch unreachable;
                    // }

                    if (try plugin.getFunction(globalThis, "setup")) |_| {
                        // decl.setup.set(globalThis, setup);
                    } else {
                        globalThis.throwInvalidArguments("Expected plugin to have a setup() function", .{});
                        return error.JSError;
                    }

                    var bun_plugins: *Plugin = plugins.* orelse brk: {
                        plugins.* = Plugin.create(
                            globalThis,
                            switch (this.target) {
                                .bun, .bun_macro => JSC.JSGlobalObject.BunPluginTarget.bun,
                                .node => JSC.JSGlobalObject.BunPluginTarget.node,
                                else => .browser,
                            },
                        );
                        break :brk plugins.*.?;
                    };

                    const plugin_result = bun_plugins.addPlugin(globalThis, plugin);

                    if (plugin_result.toError()) |err| {
                        globalThis.throwValue(err);
                        bun_plugins.deinit();
                        return error.JSError;
                    }
                }
            }

            return this;
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
            identifiers: bool = false,
            syntax: bool = false,
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
            self.external.deinit();
            self.define.deinit();
            self.dir.deinit();
            self.serve.deinit(allocator);
            self.server_components.deinit(allocator);
            self.names.deinit();
            self.label.deinit();
            self.outdir.deinit();
        }
    };

    fn build(
        globalThis: *JSC.JSGlobalObject,
        arguments: []const JSC.JSValue,
    ) JSC.JSValue {
        var plugins: ?*Plugin = null;
        const config = Config.fromJS(globalThis, arguments[0], &plugins, globalThis.allocator()) catch {
            return JSC.JSValue.jsUndefined();
        };

        return bun.BundleV2.generateFromJavaScript(
            config,
            plugins,
            globalThis,
            globalThis.bunVM().eventLoop(),
            bun.default_allocator,
        ) catch {
            return JSC.JSValue.jsUndefined();
        };
    }

    pub fn buildFn(
        // this
        _: void,
        globalThis: *JSC.JSGlobalObject,
        // function
        _: js.JSObjectRef,
        // thisObject
        _: js.JSObjectRef,
        arguments_: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return build(globalThis, @ptrCast([]const JSC.JSValue, arguments_)).asObjectRef();
    }

    pub const Resolve = struct {
        import_record: *bun.ImportRecord,
        source_file: string = "",
        default_namespace: string = "",

        /// Null means the Resolve is aborted
        completion: ?*bun.BundleV2.JSBundleCompletionTask = null,

        value: Value,

        pub const Value = union(enum) {
            err: logger.Msg,
            success: struct {
                path: []const u8 = "",
                namespace: []const u8 = "",

                pub fn deinit(this: *@This()) void {
                    bun.default_allocator.destroy(this.path);
                    bun.default_allocator.destroy(this.namespace);
                }
            },
            no_match: void,
            pending: JSC.JSPromise.Strong,
            consumed: void,

            fn badPluginError() Value {
                return .{
                    .err = logger.Msg{
                        .data = .{
                            .text = bun.default_allocator.dupe(u8, "onResolve plugin returned an invalid value") catch unreachable,
                        },
                    },
                };
            }

            pub fn consume(this: *Value) Value {
                const result = this.*;
                this.* = .{ .consumed = {} };
                return result;
            }

            pub fn fromJS(globalObject: *JSC.JSGlobalObject, source_file: []const u8, default_namespace: string, value: JSC.JSValue) Value {
                if (value.isEmptyOrUndefinedOrNull()) {
                    return .{ .no_match = {} };
                }

                if (value.toError(globalObject)) |err| {
                    return .{ .err = logger.Msg.fromJS(bun.default_allocator, globalObject, source_file, err) catch unreachable };
                }

                // I think we already do this check?
                if (!value.isObject()) return badPluginError();

                var namespace = ZigString.Slice.fromUTF8NeverFree(default_namespace);

                if (value.getOptional(globalObject, "namespace", ZigString.Slice) catch return badPluginError()) |namespace_slice| {
                    namespace = namespace_slice;
                }

                const path = value.getOptional(globalObject, "path", ZigString.Slice) catch {
                    namespace.deinit();
                    return badPluginError();
                };

                return .{
                    .success = .{
                        .path = path.cloneWithAllocator(bun.default_allocator).slice(),
                        .namespace = namespace.slice(),
                    },
                };
            }

            pub fn deinit(this: *Resolve.Value) void {
                switch (this.*) {
                    .pending => |*pending| {
                        pending.deinit();
                    },
                    .success => |*success| {
                        success.deinit();
                    },
                    .err => |*err| {
                        err.deinit(bun.default_allocator);
                    },
                    .consumed => {},
                }
                this.* = .{ .consumed = {} };
            }
        };

        pub fn deinit(this: *Resolve) void {
            this.value.deinit();
            if (this.completion) |completion|
                completion.deref();
        }

        const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

        pub fn runOnJSThread(this: *Load) void {
            var completion = this.completion orelse {
                this.deinit();
                return;
            };

            const result = completion.plugins.?.matchOnResolve(
                completion.globalThis,
                this.path,
                this.namespace,
                this,
            );

            this.value = Value.fromJS(completion.globalThis, this.source_file, this.default_namespace, result);
            completion.bundler.onResolveAsync(this);
        }
    };

    pub const Load = struct {
        source_index: Index,
        default_loader: options.Loader,
        path: []const u8 = "",
        namespace: []const u8 = "",

        /// Null means the task was aborted.
        completion: ?*bun.BundleV2.JSBundleCompletionTask = null,

        value: Value,
        js_task: JSC.AnyTask = undefined,
        task: JSC.AnyEventLoop.Task = undefined,
        parse_task: *bun.ParseTask = undefined,

        pub fn create(
            completion: *bun.BundleV2.JSBundleCompletionTask,
            source_index: Index,
            default_loader: options.Loader,
            path: Fs.Path,
        ) Load {
            return Load{
                .source_index = source_index,
                .default_loader = default_loader,
                .completion = completion,
                .value = .{ .pending = .{} },
                .path = path.text,
                .namespace = path.namespace,
            };
        }

        pub const Value = union(enum) {
            err: logger.Msg,
            success: struct {
                source_code: []const u8 = "",
                loader: options.Loader = options.Loader.file,
            },
            pending: JSC.JSPromise.Strong,
            consumed: void,

            pub fn deinit(this: *Value) void {
                switch (this.*) {
                    .pending => |*pending| {
                        pending.strong.deinit();
                    },
                    .success => |success| {
                        bun.default_allocator.destroy(success.source_code);
                    },
                    .err => |*err| {
                        err.deinit(bun.default_allocator);
                    },
                    .consumed => {},
                }
                this.* = .{ .consumed = {} };
            }

            pub fn consume(this: *Value) Value {
                const result = this.*;
                this.* = .{ .consumed = {} };
                return result;
            }
        };

        pub fn deinit(this: *Load) void {
            this.value.deinit();
            if (this.completion) |completion|
                completion.deref();
        }

        const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

        pub fn runOnJSThread(this: *Load) void {
            var completion = this.completion orelse {
                this.deinit();
                return;
            };

            const err = completion.plugins.?.matchOnLoad(
                completion.globalThis,
                this.path,
                this.namespace,
                this,
            );

            if (this.value == .pending) {
                if (!err.isEmptyOrUndefinedOrNull()) {
                    var code = ZigString.Empty;
                    JSBundlerPlugin__OnLoadAsync(this, err, &code, .js);
                }
            }
        }

        pub fn dispatch(this: *Load) void {
            var completion = this.completion orelse {
                this.deinit();
                return;
            };
            completion.ref();

            this.js_task = AnyTask.init(this);
            var concurrent_task = bun.default_allocator.create(JSC.ConcurrentTask) catch {
                completion.deref();
                this.deinit();
                return;
            };
            concurrent_task.* = JSC.ConcurrentTask{
                .auto_delete = true,
                .task = this.js_task.task(),
            };
            completion.jsc_event_loop.enqueueTaskConcurrent(concurrent_task);
        }

        export fn JSBundlerPlugin__getDefaultLoader(this: *Load) options.Loader {
            return this.default_loader;
        }

        export fn JSBundlerPlugin__OnLoadAsync(
            this: *Load,
            error_value: JSC.JSValue,
            source_code: *ZigString,
            loader: options.Loader,
        ) void {
            if (this.completion) |completion| {
                if (error_value.toError()) |err| {
                    if (this.value == .pending) this.value.pending.strong.deinit();
                    this.value = .{
                        .err = logger.Msg.fromJS(bun.default_allocator, completion.globalThis, this.path, err) catch unreachable,
                    };
                } else if (!error_value.isEmptyOrUndefinedOrNull() and error_value.isCell() and error_value.jsType() == .JSPromise) {
                    this.value.pending.strong.set(completion.globalThis, error_value);
                    return;
                } else {
                    if (this.value == .pending) this.value.pending.strong.deinit();
                    this.value = .{
                        .success = .{
                            .source_code = source_code.toSliceClone(bun.default_allocator).slice(),
                            .loader = loader,
                        },
                    };
                }

                completion.bundler.onLoadAsync(this);
            } else {
                this.deinit();
            }
        }

        comptime {
            _ = JSBundlerPlugin__getDefaultLoader;
            _ = JSBundlerPlugin__OnLoadAsync;
        }
    };

    pub const Plugin = opaque {
        extern fn JSBundlerPlugin__create(*JSC.JSGlobalObject, JSC.JSGlobalObject.BunPluginTarget) *Plugin;
        pub fn create(globalObject: *JSC.JSGlobalObject, target: JSC.JSGlobalObject.BunPluginTarget) *Plugin {
            return JSBundlerPlugin__create(globalObject, target);
        }

        extern fn JSBundlerPlugin__tombestone(*Plugin) void;

        extern fn JSBundlerPlugin__anyMatches(
            *Plugin,
            namespaceString: *const ZigString,
            path: *const ZigString,
            bool,
        ) bool;

        extern fn JSBundlerPlugin__matchOnLoad(
            *JSC.JSGlobalObject,
            *Plugin,
            namespaceString: *const ZigString,
            path: *const ZigString,
            context: *anyopaque,
        ) JSValue;

        extern fn JSBundlerPlugin__matchOnResolve(
            *JSC.JSGlobalObject,
            *Plugin,
            namespaceString: *const ZigString,
            path: *const ZigString,
            importer: *const ZigString,
            context: *anyopaque,
        ) JSValue;

        pub fn hasAnyMatches(
            this: *Plugin,
            path: *const Fs.Path,
            is_onLoad: bool,
        ) bool {
            const namespace_string = if (strings.eqlComptime(path.namespace, "file"))
                ZigString.Empty
            else
                ZigString.fromUTF8(path.namespace);
            const path_string = ZigString.fromUTF8(path.text);
            return JSBundlerPlugin__anyMatches(this, &namespace_string, &path_string, is_onLoad);
        }

        pub fn matchOnLoad(
            this: *Plugin,
            globalThis: *JSC.JSGlobalObject,
            path: []const u8,
            namespace: []const u8,
            context: *anyopaque,
        ) JSC.JSValue {
            const namespace_string = if (strings.eqlComptime(namespace, "file"))
                ZigString.Empty
            else
                ZigString.fromUTF8(namespace);
            const path_string = ZigString.fromUTF8(path);
            return JSBundlerPlugin__matchOnLoad(globalThis, this, &namespace_string, &path_string, context);
        }

        pub fn matchOnResolve(
            this: *Plugin,
            globalThis: *JSC.JSGlobalObject,
            path: []const u8,
            namespace: []const u8,
            importer: []const u8,
            context: *anyopaque,
        ) JSC.JSValue {
            const namespace_string = if (strings.eqlComptime(namespace, "file"))
                ZigString.Empty
            else
                ZigString.fromUTF8(namespace);
            const path_string = ZigString.fromUTF8(path);
            const importer_string = ZigString.fromUTF8(importer);
            return JSBundlerPlugin__matchOnResolve(globalThis, this, &namespace_string, &path_string, &importer_string, context);
        }

        pub fn addPlugin(
            this: *Plugin,
            globalObject: *JSC.JSGlobalObject,
            object: JSC.JSValue,
        ) JSValue {
            return setupJSBundlerPlugin(this, globalObject, object);
        }

        pub fn deinit(this: *Plugin) void {
            JSBundlerPlugin__tombestone(this);
        }

        pub fn setConfig(this: *Plugin, config: *anyopaque) void {
            JSBundlerPlugin__setConfig(this, config);
        }

        extern fn JSBundlerPlugin__setConfig(*Plugin, *anyopaque) void;

        extern fn setupJSBundlerPlugin(
            *Plugin,
            *JSC.JSGlobalObject,
            JSC.JSValue,
        ) JSValue;
    };
};
