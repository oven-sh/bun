const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
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
const resolve_path = @import("../../resolver/resolve_path.zig");
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

const To = Base.To;
const Request = WebCore.Request;
const String = bun.String;
const FetchEvent = WebCore.FetchEvent;
const MacroMap = @import("../../resolver/package_json.zig").MacroMap;
const TSConfigJSON = @import("../../resolver/tsconfig_json.zig").TSConfigJSON;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const logger = bun.logger;
const Loader = options.Loader;
const Target = options.Target;
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
        target: Target = Target.browser,
        entry_points: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        hot: bool = false,
        define: bun.StringMap = bun.StringMap.init(bun.default_allocator, false),
        loaders: ?Api.LoaderMap = null,
        dir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        outdir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        rootdir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        serve: Serve = .{},
        jsx: options.JSX.Pragma = .{},
        code_splitting: bool = false,
        minify: Minify = .{},
        server_components: ServerComponents = ServerComponents{},
        no_macros: bool = false,
        ignore_dce_annotations: bool = false,
        emit_dce_annotations: ?bool = null,
        names: Names = .{},
        external: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        source_map: options.SourceMapOption = .none,
        public_path: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        conditions: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        packages: options.PackagesOption = .bundle,

        pub const List = bun.StringArrayHashMapUnmanaged(Config);

        pub fn fromJS(globalThis: *JSC.JSGlobalObject, config: JSC.JSValue, plugins: *?*Plugin, allocator: std.mem.Allocator) !Config {
            var this = Config{
                .entry_points = bun.StringSet.init(allocator),
                .external = bun.StringSet.init(allocator),
                .define = bun.StringMap.init(allocator, true),
                .dir = OwnedString.initEmpty(allocator),
                .outdir = OwnedString.initEmpty(allocator),
                .rootdir = OwnedString.initEmpty(allocator),
                .names = .{
                    .owned_entry_point = OwnedString.initEmpty(allocator),
                    .owned_chunk = OwnedString.initEmpty(allocator),
                    .owned_asset = OwnedString.initEmpty(allocator),
                },
            };
            errdefer this.deinit(allocator);
            errdefer if (plugins.*) |plugin| plugin.deinit();

            // Plugins must be resolved first as they are allowed to mutate the config JSValue
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

                    var plugin_result = bun_plugins.addPlugin(function, config);

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

            if (config.getTruthy(globalThis, "macros")) |macros_flag| {
                if (!macros_flag.coerce(bool, globalThis)) {
                    this.no_macros = true;
                }
            }

            if (try config.getOptionalEnum(globalThis, "target", options.Target)) |target| {
                this.target = target;
            }

            var has_out_dir = false;
            if (try config.getOptional(globalThis, "outdir", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.outdir.appendSliceExact(slice.slice()) catch unreachable;
                has_out_dir = true;
            }

            if (config.getTruthy(globalThis, "sourcemap")) |source_map_js| {
                if (bun.FeatureFlags.breaking_changes_1_2 and config.isBoolean()) {
                    if (source_map_js == .true) {
                        this.source_map = if (has_out_dir)
                            .linked
                        else
                            .@"inline";
                    }
                } else if (!source_map_js.isEmptyOrUndefinedOrNull()) {
                    this.source_map = try source_map_js.toEnum(
                        globalThis,
                        "sourcemap",
                        options.SourceMapOption,
                    );
                }
            }

            if (try config.getOptionalEnum(globalThis, "packages", options.PackagesOption)) |packages| {
                this.packages = packages;
            }

            if (try config.getOptionalEnum(globalThis, "format", options.Format)) |format| {
                switch (format) {
                    .esm => {},
                    else => {
                        globalThis.throwInvalidArguments("Formats besides 'esm' are not implemented", .{});
                        return error.JSException;
                    },
                }
            }

            // if (try config.getOptional(globalThis, "hot", bool)) |hot| {
            //     this.hot = hot;
            // }

            if (try config.getOptional(globalThis, "splitting", bool)) |hot| {
                this.code_splitting = hot;
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

            if (config.getTruthy(globalThis, "emitDCEAnnotations")) |flag| {
                if (flag.coerce(bool, globalThis)) {
                    this.emit_dce_annotations = true;
                }
            }

            if (config.getTruthy(globalThis, "ignoreDCEAnnotations")) |flag| {
                if (flag.coerce(bool, globalThis)) {
                    this.ignore_dce_annotations = true;
                }
            }

            if (config.getTruthy(globalThis, "conditions")) |conditions_value| {
                if (conditions_value.isString()) {
                    var slice = conditions_value.toSliceOrNull(globalThis) orelse {
                        globalThis.throwInvalidArguments("Expected conditions to be an array of strings", .{});
                        return error.JSException;
                    };
                    defer slice.deinit();
                    try this.conditions.insert(slice.slice());
                } else if (conditions_value.jsType().isArray()) {
                    var iter = conditions_value.arrayIterator(globalThis);
                    while (iter.next()) |entry_point| {
                        var slice = entry_point.toSliceOrNull(globalThis) orelse {
                            globalThis.throwInvalidArguments("Expected conditions to be an array of strings", .{});
                            return error.JSException;
                        };
                        defer slice.deinit();
                        try this.conditions.insert(slice.slice());
                    }
                } else {
                    globalThis.throwInvalidArguments("Expected conditions to be an array of strings", .{});
                    return error.JSException;
                }
            }

            {
                const path: ZigString.Slice = brk: {
                    if (try config.getOptional(globalThis, "root", ZigString.Slice)) |slice| {
                        break :brk slice;
                    }

                    const entry_points = this.entry_points.keys();

                    if (entry_points.len == 1) {
                        break :brk ZigString.Slice.fromUTF8NeverFree(std.fs.path.dirname(entry_points[0]) orelse ".");
                    }

                    break :brk ZigString.Slice.fromUTF8NeverFree(resolve_path.getIfExistsLongestCommonPath(entry_points) orelse ".");
                };

                defer path.deinit();

                var dir = std.fs.cwd().openDir(path.slice(), .{}) catch |err| {
                    globalThis.throwPretty("{s}: failed to open root directory: {s}", .{ @errorName(err), path.slice() });
                    return error.JSException;
                };
                defer dir.close();

                var rootdir_buf: bun.PathBuffer = undefined;
                this.rootdir.appendSliceExact(try bun.getFdPath(bun.toFD(dir.fd), &rootdir_buf)) catch unreachable;
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

            // if (try config.getOptional(globalThis, "dir", ZigString.Slice)) |slice| {
            //     defer slice.deinit();
            //     this.appendSliceExact(slice.slice()) catch unreachable;
            // } else {
            //     this.appendSliceExact(globalThis.bunVM().bundler.fs.top_level_dir) catch unreachable;
            // }

            if (try config.getOptional(globalThis, "publicPath", ZigString.Slice)) |slice| {
                defer slice.deinit();
                this.public_path.appendSliceExact(slice.slice()) catch unreachable;
            }

            if (config.getTruthy(globalThis, "naming")) |naming| {
                if (naming.isString()) {
                    if (try config.getOptional(globalThis, "naming", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            this.names.owned_entry_point.appendSliceExact("./") catch unreachable;
                        }
                        this.names.owned_entry_point.appendSliceExact(slice.slice()) catch unreachable;
                        this.names.entry_point.data = this.names.owned_entry_point.list.items;
                    }
                } else if (naming.isObject()) {
                    if (try naming.getOptional(globalThis, "entry", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            this.names.owned_entry_point.appendSliceExact("./") catch unreachable;
                        }
                        this.names.owned_entry_point.appendSliceExact(slice.slice()) catch unreachable;
                        this.names.entry_point.data = this.names.owned_entry_point.list.items;
                    }

                    if (try naming.getOptional(globalThis, "chunk", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            this.names.owned_chunk.appendSliceExact("./") catch unreachable;
                        }
                        this.names.owned_chunk.appendSliceExact(slice.slice()) catch unreachable;
                        this.names.chunk.data = this.names.owned_chunk.list.items;
                    }

                    if (try naming.getOptional(globalThis, "asset", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            this.names.owned_asset.appendSliceExact("./") catch unreachable;
                        }
                        this.names.owned_asset.appendSliceExact(slice.slice()) catch unreachable;
                        this.names.asset.data = this.names.owned_asset.list.items;
                    }
                } else {
                    globalThis.throwInvalidArguments("Expected naming to be a string or an object", .{});
                    return error.JSException;
                }
            }

            if (try config.getObject(globalThis, "define")) |define| {
                if (!define.isObject()) {
                    globalThis.throwInvalidArguments("define must be an object", .{});
                    return error.JSException;
                }

                var define_iter = JSC.JSPropertyIterator(.{
                    .skip_empty_name = true,
                    .include_value = true,
                }).init(globalThis, define);
                defer define_iter.deinit();

                while (define_iter.next()) |prop| {
                    const property_value = define_iter.value;
                    const value_type = property_value.jsType();

                    if (!value_type.isStringLike()) {
                        globalThis.throwInvalidArguments("define \"{s}\" must be a JSON string", .{prop});
                        return error.JSException;
                    }

                    var val = JSC.ZigString.init("");
                    property_value.toZigString(&val, globalThis);
                    if (val.len == 0) {
                        val = JSC.ZigString.fromUTF8("\"\"");
                    }

                    const key = prop.toOwnedSlice(bun.default_allocator) catch bun.outOfMemory();

                    // value is always cloned
                    const value = val.toSlice(bun.default_allocator);
                    defer value.deinit();

                    // .insert clones the value, but not the key
                    try this.define.insert(key, value.slice());
                }
            }

            if (try config.getObject(globalThis, "loader")) |loaders| {
                var loader_iter = JSC.JSPropertyIterator(.{
                    .skip_empty_name = true,
                    .include_value = true,
                }).init(globalThis, loaders);
                defer loader_iter.deinit();

                var loader_names = try allocator.alloc(string, loader_iter.len);
                errdefer allocator.free(loader_names);
                var loader_values = try allocator.alloc(Api.Loader, loader_iter.len);
                errdefer allocator.free(loader_values);

                while (loader_iter.next()) |prop| {
                    if (!prop.hasPrefixComptime(".") or prop.length() < 2) {
                        globalThis.throwInvalidArguments("loader property names must be file extensions, such as '.txt'", .{});
                        return error.JSException;
                    }

                    loader_values[loader_iter.i] = try loader_iter.value.toEnumFromMap(
                        globalThis,
                        "loader",
                        Api.Loader,
                        options.Loader.api_names,
                    );
                    loader_names[loader_iter.i] = prop.toOwnedSlice(bun.default_allocator) catch bun.outOfMemory();
                }

                this.loaders = Api.LoaderMap{
                    .extensions = loader_names,
                    .loaders = loader_values,
                };
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
            if (self.loaders) |loaders| {
                for (loaders.extensions) |ext| {
                    bun.default_allocator.free(ext);
                }
                bun.default_allocator.free(loaders.loaders);
                bun.default_allocator.free(loaders.extensions);
            }
            self.names.deinit();
            self.outdir.deinit();
            self.rootdir.deinit();
            self.public_path.deinit();
            self.conditions.deinit();
        }
    };

    fn build(
        globalThis: *JSC.JSGlobalObject,
        arguments: []const JSC.JSValue,
    ) JSC.JSValue {
        if (arguments.len == 0 or !arguments[0].isObject()) {
            globalThis.throwInvalidArguments("Expected a config object to be passed to Bun.build", .{});
            return .undefined;
        }

        var plugins: ?*Plugin = null;
        const config = Config.fromJS(globalThis, arguments[0], &plugins, globalThis.allocator()) catch {
            return .undefined;
        };

        return bun.BundleV2.generateFromJavaScript(
            config,
            plugins,
            globalThis,
            globalThis.bunVM().eventLoop(),
            bun.default_allocator,
        ) catch {
            return .undefined;
        };
    }

    pub fn buildFn(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments = callframe.arguments(1);
        return build(globalThis, arguments.slice());
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
            original_target: Target,

            pub inline fn loader(_: *const MiniImportRecord) ?options.Loader {
                return null;
            }
        };

        pub fn create(
            from: union(enum) {
                MiniImportRecord: MiniImportRecord,
                ImportRecord: struct {
                    importer_source_index: u32,
                    import_record_index: u32,
                    source_file: []const u8 = "",
                    original_target: Target,
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
                        .original_target = file.original_target,
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
                    bun.default_allocator.free(this.path);
                    bun.default_allocator.free(this.namespace);
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
            bun.default_allocator.destroy(this);
        }

        const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

        pub fn dispatch(this: *Resolve) void {
            var completion = this.completion orelse {
                this.deinit();
                return;
            };
            completion.ref();

            this.js_task = AnyTask.init(this);
            completion.jsc_event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.create(this.js_task.task()));
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
                        bun.default_allocator.free(success.source_code);
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
            const concurrent_task = JSC.ConcurrentTask.createFrom(&this.js_task);
            completion.jsc_event_loop.enqueueTaskConcurrent(concurrent_task);
        }

        export fn JSBundlerPlugin__onLoadAsync(
            this: *Load,
            _: *anyopaque,
            source_code_value: JSValue,
            loader_as_int: JSValue,
        ) void {
            JSC.markBinding(@src());
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
                const source_code = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(completion.globalThis, source_code_value, bun.default_allocator) catch
                // TODO:
                    @panic("Unexpected: source_code is not a string");
                this.value = .{
                    .success = .{
                        .loader = @as(options.Loader, @enumFromInt(@as(u8, @intCast(loader_as_int.to(i32))))),
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
            JSC.markBinding(@src());
            const plugin = JSBundlerPlugin__create(globalObject, target);
            JSC.JSValue.fromCell(plugin).protect();
            return plugin;
        }

        extern fn JSBundlerPlugin__tombestone(*Plugin) void;

        extern fn JSBundlerPlugin__anyMatches(
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            bool,
        ) bool;

        extern fn JSBundlerPlugin__matchOnLoad(
            *JSC.JSGlobalObject,
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            context: *anyopaque,
            u8,
        ) void;

        extern fn JSBundlerPlugin__matchOnResolve(
            *JSC.JSGlobalObject,
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            importer: *const String,
            context: *anyopaque,
            u8,
        ) void;

        pub fn hasAnyMatches(
            this: *Plugin,
            path: *const Fs.Path,
            is_onLoad: bool,
        ) bool {
            JSC.markBinding(@src());
            const tracer = bun.tracy.traceNamed(@src(), "JSBundler.hasAnyMatches");
            defer tracer.end();

            const namespace_string = if (path.isFile())
                bun.String.empty
            else
                bun.String.createUTF8(path.namespace);
            const path_string = bun.String.createUTF8(path.text);
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
            JSC.markBinding(@src());
            const tracer = bun.tracy.traceNamed(@src(), "JSBundler.matchOnLoad");
            defer tracer.end();
            const namespace_string = if (namespace.len == 0)
                bun.String.static("file")
            else
                bun.String.createUTF8(namespace);
            const path_string = bun.String.createUTF8(path);
            defer namespace_string.deref();
            defer path_string.deref();
            JSBundlerPlugin__matchOnLoad(globalThis, this, &namespace_string, &path_string, context, @intFromEnum(default_loader));
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
            JSC.markBinding(@src());
            const tracer = bun.tracy.traceNamed(@src(), "JSBundler.matchOnResolve");
            defer tracer.end();
            const namespace_string = if (strings.eqlComptime(namespace, "file"))
                bun.String.empty
            else
                bun.String.createUTF8(namespace);
            const path_string = bun.String.createUTF8(path);
            const importer_string = bun.String.createUTF8(importer);
            defer namespace_string.deref();
            defer path_string.deref();
            defer importer_string.deref();
            JSBundlerPlugin__matchOnResolve(globalThis, this, &namespace_string, &path_string, &importer_string, context, @intFromEnum(import_record_kind));
        }

        pub fn addPlugin(
            this: *Plugin,
            object: JSC.JSValue,
            config: JSC.JSValue,
        ) JSValue {
            JSC.markBinding(@src());
            const tracer = bun.tracy.traceNamed(@src(), "JSBundler.addPlugin");
            defer tracer.end();
            return JSBundlerPlugin__runSetupFunction(this, object, config);
        }

        pub fn deinit(this: *Plugin) void {
            JSC.markBinding(@src());
            JSBundlerPlugin__tombestone(this);
            JSC.JSValue.fromCell(this).unprotect();
        }

        pub fn setConfig(this: *Plugin, config: *anyopaque) void {
            JSC.markBinding(@src());
            JSBundlerPlugin__setConfig(this, config);
        }

        extern fn JSBundlerPlugin__setConfig(*Plugin, *anyopaque) void;

        extern fn JSBundlerPlugin__runSetupFunction(
            *Plugin,
            JSC.JSValue,
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

const Blob = JSC.WebCore.Blob;
pub const BuildArtifact = struct {
    pub usingnamespace JSC.Codegen.JSBuildArtifact;

    blob: JSC.WebCore.Blob,
    loader: options.Loader = .file,
    path: []const u8 = "",
    hash: u64 = std.math.maxInt(u64),
    output_kind: OutputKind,
    sourcemap: JSC.Strong = .{},

    pub const OutputKind = enum {
        chunk,
        asset,
        @"entry-point",
        @"component-manifest",
        @"use client",
        @"use server",
        sourcemap,
    };

    pub fn deinit(this: *BuildArtifact) void {
        this.blob.deinit();
        this.sourcemap.deinit();

        bun.default_allocator.free(this.path);
    }

    pub fn getText(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        return @call(bun.callmod_inline, Blob.getText, .{ &this.blob, globalThis, callframe });
    }

    pub fn getJSON(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        return @call(bun.callmod_inline, Blob.getJSON, .{ &this.blob, globalThis, callframe });
    }
    pub fn getArrayBuffer(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSValue {
        return @call(bun.callmod_inline, Blob.getArrayBuffer, .{ &this.blob, globalThis, callframe });
    }
    pub fn getSlice(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        return @call(bun.callmod_inline, Blob.getSlice, .{ &this.blob, globalThis, callframe });
    }
    pub fn getType(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
    ) JSValue {
        return @call(bun.callmod_inline, Blob.getType, .{ &this.blob, globalThis });
    }

    pub fn getStream(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSValue {
        return @call(bun.callmod_inline, Blob.getStream, .{
            &this.blob,
            globalThis,
            callframe,
        });
    }

    pub fn getPath(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
    ) JSValue {
        return ZigString.fromUTF8(this.path).toJS(globalThis);
    }

    pub fn getLoader(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
    ) JSValue {
        return ZigString.fromUTF8(@tagName(this.loader)).toJS(globalThis);
    }

    pub fn getHash(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
    ) JSValue {
        var buf: [512]u8 = undefined;
        const out = std.fmt.bufPrint(&buf, "{any}", .{options.PathTemplate.hashFormatter(this.hash)}) catch @panic("Unexpected");
        return ZigString.init(out).toJS(globalThis);
    }

    pub fn getSize(this: *BuildArtifact, globalObject: *JSC.JSGlobalObject) JSValue {
        return @call(bun.callmod_inline, Blob.getSize, .{ &this.blob, globalObject });
    }

    pub fn getMimeType(this: *BuildArtifact, globalObject: *JSC.JSGlobalObject) JSValue {
        return @call(bun.callmod_inline, Blob.getType, .{ &this.blob, globalObject });
    }

    pub fn getOutputKind(this: *BuildArtifact, globalObject: *JSC.JSGlobalObject) JSValue {
        return ZigString.init(@tagName(this.output_kind)).toJS(globalObject);
    }

    pub fn getSourceMap(this: *BuildArtifact, _: *JSC.JSGlobalObject) JSValue {
        if (this.sourcemap.get()) |value| {
            return value;
        }

        return JSC.JSValue.jsNull();
    }

    pub fn finalize(this: *BuildArtifact) callconv(.C) void {
        this.deinit();

        bun.default_allocator.destroy(this);
    }

    pub fn writeFormat(this: *BuildArtifact, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        try writer.writeAll(comptime Output.prettyFmt("<r>BuildArtifact ", enable_ansi_colors));

        try writer.print(comptime Output.prettyFmt("(<blue>{s}<r>) {{\n", enable_ansi_colors), .{@tagName(this.output_kind)});

        {
            formatter.indent += 1;

            defer formatter.indent -= 1;
            try formatter.writeIndent(Writer, writer);
            try writer.print(
                comptime Output.prettyFmt(
                    "<r>path<r>: <green>\"{s}\"<r>",
                    enable_ansi_colors,
                ),
                .{this.path},
            );
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.print(
                comptime Output.prettyFmt(
                    "<r>loader<r>: <green>\"{s}\"<r>",
                    enable_ansi_colors,
                ),
                .{@tagName(this.loader)},
            );

            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);

            try writer.print(
                comptime Output.prettyFmt(
                    "<r>kind<r>: <green>\"{s}\"<r>",
                    enable_ansi_colors,
                ),
                .{@tagName(this.output_kind)},
            );

            if (this.hash != 0) {
                formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
                try writer.writeAll("\n");

                try formatter.writeIndent(Writer, writer);
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r>hash<r>: <green>\"{any}\"<r>",
                        enable_ansi_colors,
                    ),
                    .{options.PathTemplate.hashFormatter(this.hash)},
                );
            }

            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            formatter.resetLine();
            try this.blob.writeFormat(Formatter, formatter, writer, enable_ansi_colors);

            if (this.output_kind != .sourcemap) {
                formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                try writer.writeAll(
                    comptime Output.prettyFmt(
                        "<r>sourcemap<r>: ",
                        enable_ansi_colors,
                    ),
                );

                if (this.sourcemap.get()) |sourcemap_value| {
                    if (sourcemap_value.as(BuildArtifact)) |sourcemap| {
                        try sourcemap.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
                    } else {
                        try writer.writeAll(
                            comptime Output.prettyFmt(
                                "<yellow>null<r>",
                                enable_ansi_colors,
                            ),
                        );
                    }
                } else {
                    try writer.writeAll(
                        comptime Output.prettyFmt(
                            "<yellow>null<r>",
                            enable_ansi_colors,
                        ),
                    );
                }
            }
        }
        try writer.writeAll("\n");
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("}");
        formatter.resetLine();
    }
};

const Output = bun.Output;
