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
        public_path: OwnedString = OwnedString.initEmpty(bun.default_allocator),

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
                    .owned_asset = OwnedString.initEmpty(allocator),
                },
            };
            errdefer this.deinit(allocator);
            errdefer if (plugins.*) |plugin| plugin.deinit();

            if (try config.getOptionalEnum(globalThis, "target", options.Platform)) |target| {
                this.target = target;
            }

            // if (try config.getOptional(globalThis, "hot", bool)) |hot| {
            //     this.hot = hot;
            // }

            if (try config.getOptional(globalThis, "splitting", bool)) |hot| {
                this.code_splitting = hot;
            }

            if (try config.getOptional(globalThis, "outdir", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.outdir.appendSliceExact(slice.slice()) catch unreachable;
            }

            if (config.getTruthy(globalThis, "minify")) |hot| {
                if (hot.isBoolean()) {
                    const value = hot.coerce(bool, globalThis);
                    this.minify.whitespace = value;
                    this.minify.syntax = value;
                    this.minify.identifiers = value;
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

            if (try config.getArray(globalThis, "entrypoints") orelse try config.getArray(globalThis, "entryPoints")) |entry_points| {
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

            if (try config.getOptional(globalThis, "publicPath", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.public_path.appendSliceExact(slice.slice()) catch unreachable;
            }

            if (config.getTruthy(globalThis, "naming")) |naming| {
                if (naming.isString()) {
                    if (try config.getOptional(globalThis, "naming", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        this.names.owned_entry_point.appendSliceExact(slice.slice()) catch unreachable;
                        this.names.entry_point.data = this.names.owned_entry_point.list.items;
                    }
                } else if (naming.isObject()) {
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

                    if (try naming.getOptional(globalThis, "asset", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        this.names.owned_asset.appendSliceExact(slice.slice()) catch unreachable;
                        this.names.asset.data = this.names.owned_asset.list.items;
                    }
                } else {
                    globalThis.throwInvalidArguments("Expected naming to be a string or an object", .{});
                    return error.JSException;
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

                    if (plugin.getOptional(globalThis, "name", ZigString.Slice) catch null) |slice| {
                        defer slice.deinit();
                        if (slice.len == 0) {
                            globalThis.throwInvalidArguments("Expected plugin to have a non-empty name", .{});
                            return error.JSError;
                        }
                    } else {
                        globalThis.throwInvalidArguments("Expected plugin to have a name", .{});
                        return error.JSError;
                    }

                    const function = (plugin.getFunction(globalThis, "setup") catch null) orelse {
                        globalThis.throwInvalidArguments("Expected plugin to have a setup() function", .{});
                        return error.JSError;
                    };

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

                    var plugin_result = bun_plugins.addPlugin(function);

                    if (!plugin_result.isEmptyOrUndefinedOrNull()) {
                        if (plugin_result.asAnyPromise()) |promise| {
                            globalThis.bunVM().waitForPromise(promise);
                            plugin_result = promise.result(globalThis.vm());
                        }
                    }

                    if (plugin_result.toError()) |err| {
                        globalThis.throwValue(err);
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

            owned_asset: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            asset: options.PathTemplate = options.PathTemplate.asset,

            pub fn deinit(self: *Names) void {
                self.owned_entry_point.deinit();
                self.owned_chunk.deinit();
                self.owned_asset.deinit();
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
            self.public_path.deinit();
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
        import_record: MiniImportRecord,

        /// Null means the Resolve is aborted
        completion: ?*bun.BundleV2.JSBundleCompletionTask = null,

        value: Value = .{ .pending = {} },

        js_task: JSC.AnyTask = undefined,
        task: JSC.AnyEventLoop.Task = undefined,

        pub const MiniImportRecord = struct {
            kind: bun.ImportKind,
            source_file: string = "",
            namespace: string = "",
            specifier: string = "",
            importer_source_index: ?u32 = null,
            import_record_index: u32 = 0,
            range: logger.Range = logger.Range.None,
            original_platform: options.Platform,
        };

        pub fn create(
            from: union(enum) {
                MiniImportRecord: MiniImportRecord,
                ImportRecord: struct {
                    importer_source_index: u32,
                    import_record_index: u32,
                    source_file: []const u8 = "",
                    original_platform: options.Platform,
                    record: *const bun.ImportRecord,
                },
            },
            completion: *bun.BundleV2.JSBundleCompletionTask,
        ) Resolve {
            completion.ref();

            return Resolve{
                .import_record = switch (from) {
                    .MiniImportRecord => from.MiniImportRecord,
                    .ImportRecord => |file| MiniImportRecord{
                        .kind = file.record.kind,
                        .source_file = file.source_file,
                        .namespace = file.record.path.namespace,
                        .specifier = file.record.path.text,
                        .importer_source_index = file.importer_source_index,
                        .import_record_index = file.import_record_index,
                        .range = file.record.range,
                        .original_platform = file.original_platform,
                    },
                },
                .completion = completion,
                .value = .{ .pending = {} },
            };
        }

        pub const Value = union(enum) {
            err: logger.Msg,
            success: struct {
                path: []const u8 = "",
                namespace: []const u8 = "",
                external: bool = false,

                pub fn deinit(this: *@This()) void {
                    bun.default_allocator.destroy(this.path);
                    bun.default_allocator.destroy(this.namespace);
                }
            },
            no_match: void,
            pending: void,
            consumed: void,

            pub fn consume(this: *Value) Value {
                const result = this.*;
                this.* = .{ .consumed = {} };
                return result;
            }

            pub fn deinit(this: *Resolve.Value) void {
                switch (this.*) {
                    .success => |*success| {
                        success.deinit();
                    },
                    .err => |*err| {
                        err.deinit(bun.default_allocator);
                    },
                    .no_match, .pending, .consumed => {},
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

        pub fn dispatch(this: *Resolve) void {
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

        pub fn runOnJSThread(this: *Resolve) void {
            var completion = this.completion orelse {
                this.deinit();
                return;
            };

            completion.plugins.?.matchOnResolve(
                completion.globalThis,
                this.import_record.specifier,
                this.import_record.namespace,
                this.import_record.source_file,
                this,
                this.import_record.kind,
            );
        }

        export fn JSBundlerPlugin__onResolveAsync(
            this: *Resolve,
            _: *anyopaque,
            path_value: JSValue,
            namespace_value: JSValue,
            external_value: JSValue,
        ) void {
            var completion = this.completion orelse {
                this.deinit();
                return;
            };
            if (path_value.isEmptyOrUndefinedOrNull() or namespace_value.isEmptyOrUndefinedOrNull()) {
                this.value = .{ .no_match = {} };
            } else {
                const path = path_value.toSliceCloneWithAllocator(completion.globalThis, bun.default_allocator) orelse @panic("Unexpected: path is not a string");
                const namespace = namespace_value.toSliceCloneWithAllocator(completion.globalThis, bun.default_allocator) orelse @panic("Unexpected: namespace is not a string");
                this.value = .{
                    .success = .{
                        .path = path.slice(),
                        .namespace = namespace.slice(),
                        .external = external_value.to(bool),
                    },
                };
            }

            completion.bundler.onResolveAsync(this);
        }

        comptime {
            _ = JSBundlerPlugin__onResolveAsync;
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

        /// Faster path: skip the extra threadpool dispatch when the file is not found
        was_file: bool = false,

        pub fn create(
            completion: *bun.BundleV2.JSBundleCompletionTask,
            source_index: Index,
            default_loader: options.Loader,
            path: Fs.Path,
        ) Load {
            completion.ref();
            return Load{
                .source_index = source_index,
                .default_loader = default_loader,
                .completion = completion,
                .value = .{ .pending = {} },
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
            pending: void,
            no_match: void,
            consumed: void,

            pub fn deinit(this: *Value) void {
                switch (this.*) {
                    .success => |success| {
                        bun.default_allocator.destroy(success.source_code);
                    },
                    .err => |*err| {
                        err.deinit(bun.default_allocator);
                    },
                    .no_match, .pending, .consumed => {},
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

            completion.plugins.?.matchOnLoad(
                completion.globalThis,
                this.path,
                this.namespace,
                this,
                this.default_loader,
            );
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

        export fn JSBundlerPlugin__onLoadAsync(
            this: *Load,
            _: *anyopaque,
            source_code_value: JSValue,
            loader_as_int: JSValue,
        ) void {
            var completion = this.completion orelse {
                this.deinit();
                return;
            };
            if (source_code_value.isEmptyOrUndefinedOrNull() or loader_as_int.isEmptyOrUndefinedOrNull()) {
                this.value = .{ .no_match = {} };

                if (this.was_file) {
                    // Faster path: skip the extra threadpool dispatch
                    completion.bundler.graph.pool.pool.schedule(bun.ThreadPool.Batch.from(&this.parse_task.task));
                    this.deinit();
                    return;
                }
            } else {
                var buffer_or_string: JSC.Node.SliceOrBuffer = JSC.Node.SliceOrBuffer.fromJS(completion.globalThis, bun.default_allocator, source_code_value) orelse
                    @panic("expected buffer or string");

                const source_code = switch (buffer_or_string) {
                    .buffer => |arraybuffer| bun.default_allocator.dupe(u8, arraybuffer.slice()) catch @panic("Out of memory in onLoad callback"),
                    .string => |slice| (slice.cloneIfNeeded(bun.default_allocator) catch @panic("Out of memory in onLoad callback")).slice(),
                };

                this.value = .{
                    .success = .{
                        .loader = @intToEnum(options.Loader, @intCast(u8, loader_as_int.to(i32))),
                        .source_code = source_code,
                    },
                };
            }

            completion.bundler.onLoadAsync(this);
        }

        comptime {
            _ = JSBundlerPlugin__onLoadAsync;
        }
    };

    pub const Plugin = opaque {
        extern fn JSBundlerPlugin__create(*JSC.JSGlobalObject, JSC.JSGlobalObject.BunPluginTarget) *Plugin;
        pub fn create(globalObject: *JSC.JSGlobalObject, target: JSC.JSGlobalObject.BunPluginTarget) *Plugin {
            var plugin = JSBundlerPlugin__create(globalObject, target);
            JSC.JSValue.fromCell(plugin).protect();
            return plugin;
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
            u8,
        ) void;

        extern fn JSBundlerPlugin__matchOnResolve(
            *JSC.JSGlobalObject,
            *Plugin,
            namespaceString: *const ZigString,
            path: *const ZigString,
            importer: *const ZigString,
            context: *anyopaque,
            u8,
        ) void;

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
            default_loader: options.Loader,
        ) void {
            const namespace_string = if (namespace.len == 0)
                ZigString.init("file")
            else
                ZigString.fromUTF8(namespace);
            const path_string = ZigString.fromUTF8(path);
            JSBundlerPlugin__matchOnLoad(globalThis, this, &namespace_string, &path_string, context, @enumToInt(default_loader));
        }

        pub fn matchOnResolve(
            this: *Plugin,
            globalThis: *JSC.JSGlobalObject,
            path: []const u8,
            namespace: []const u8,
            importer: []const u8,
            context: *anyopaque,
            import_record_kind: bun.ImportKind,
        ) void {
            const namespace_string = if (strings.eqlComptime(namespace, "file"))
                ZigString.Empty
            else
                ZigString.fromUTF8(namespace);
            const path_string = ZigString.fromUTF8(path);
            const importer_string = ZigString.fromUTF8(importer);
            JSBundlerPlugin__matchOnResolve(globalThis, this, &namespace_string, &path_string, &importer_string, context, @enumToInt(import_record_kind));
        }

        pub fn addPlugin(
            this: *Plugin,
            object: JSC.JSValue,
        ) JSValue {
            return JSBundlerPlugin__runSetupFunction(this, object);
        }

        pub fn deinit(this: *Plugin) void {
            JSBundlerPlugin__tombestone(this);
            JSC.JSValue.fromCell(this).unprotect();
        }

        pub fn setConfig(this: *Plugin, config: *anyopaque) void {
            JSBundlerPlugin__setConfig(this, config);
        }

        extern fn JSBundlerPlugin__setConfig(*Plugin, *anyopaque) void;

        extern fn JSBundlerPlugin__runSetupFunction(
            *Plugin,
            JSC.JSValue,
        ) JSValue;

        pub export fn JSBundlerPlugin__addError(
            ctx: *anyopaque,
            _: *Plugin,
            exception: JSValue,
            which: JSValue,
        ) void {
            switch (which.to(i32)) {
                0 => {
                    var this: *JSBundler.Resolve = bun.cast(*Resolve, ctx);
                    var completion = this.completion orelse return;
                    this.value = .{
                        .err = logger.Msg.fromJS(bun.default_allocator, completion.globalThis, this.import_record.source_file, exception) catch @panic("Out of memory in addError callback"),
                    };
                    completion.bundler.onResolveAsync(this);
                },
                1 => {
                    var this: *Load = bun.cast(*Load, ctx);
                    var completion = this.completion orelse return;
                    this.value = .{
                        .err = logger.Msg.fromJS(bun.default_allocator, completion.globalThis, this.path, exception) catch @panic("Out of memory in addError callback"),
                    };
                    completion.bundler.onLoadAsync(this);
                },
                else => @panic("invalid error type"),
            }
        }
    };
};
