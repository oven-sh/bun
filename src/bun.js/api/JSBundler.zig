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
const Transpiler = bun.transpiler;
const options = @import("../../options.zig");
const resolve_path = @import("../../resolver/resolve_path.zig");
const VirtualMachine = JavaScript.VirtualMachine;
const ScriptSrcStream = std.io.FixedBufferStream([]u8);
const ZigString = JSC.ZigString;
const Fs = @import("../../fs.zig");
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;
const JSObject = JSC.JSObject;
const JSValue = bun.JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = bun.strings;
const JSError = bun.JSError;
const OOM = bun.OOM;

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
const Mimalloc = @import("../../allocators/mimalloc_arena.zig");
const Runtime = @import("../../runtime.zig").Runtime;
const JSLexer = bun.js_lexer;
const Expr = JSAst.Expr;
const Index = @import("../../ast/base.zig").Index;

const debug = bun.Output.scoped(.Transpiler, false);

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
        no_macros: bool = false,
        ignore_dce_annotations: bool = false,
        emit_dce_annotations: ?bool = null,
        names: Names = .{},
        external: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        source_map: options.SourceMapOption = .none,
        public_path: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        conditions: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        packages: options.PackagesOption = .bundle,
        format: options.Format = .esm,
        bytecode: bool = false,
        banner: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        footer: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        css_chunking: bool = false,
        drop: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        has_any_on_before_parse: bool = false,
        throw_on_error: bool = true,
        env_behavior: Api.DotEnvBehavior = .disable,
        env_prefix: OwnedString = OwnedString.initEmpty(bun.default_allocator),

        pub const List = bun.StringArrayHashMapUnmanaged(Config);

        pub fn fromJS(globalThis: *JSC.JSGlobalObject, config: JSC.JSValue, plugins: *?*Plugin, allocator: std.mem.Allocator) JSError!Config {
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

            var did_set_target = false;
            if (try config.getOptionalEnum(globalThis, "target", options.Target)) |target| {
                this.target = target;
                did_set_target = true;
            }

            // Plugins must be resolved first as they are allowed to mutate the config JSValue
            if (try config.getArray(globalThis, "plugins")) |array| {
                const length = array.getLength(globalThis);
                var iter = array.arrayIterator(globalThis);
                var onstart_promise_array: JSValue = JSValue.undefined;
                var i: usize = 0;
                while (iter.next()) |plugin| : (i += 1) {
                    if (!plugin.isObject()) {
                        return globalThis.throwInvalidArguments("Expected plugin to be an object", .{});
                    }

                    if (try plugin.getOptional(globalThis, "name", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (slice.len == 0) {
                            return globalThis.throwInvalidArguments("Expected plugin to have a non-empty name", .{});
                        }
                    } else {
                        return globalThis.throwInvalidArguments("Expected plugin to have a name", .{});
                    }

                    const function = try plugin.getFunction(globalThis, "setup") orelse {
                        return globalThis.throwInvalidArguments("Expected plugin to have a setup() function", .{});
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

                    const is_last = i == length - 1;
                    var plugin_result = try bun_plugins.addPlugin(function, config, onstart_promise_array, is_last, false);

                    if (!plugin_result.isEmptyOrUndefinedOrNull()) {
                        if (plugin_result.asAnyPromise()) |promise| {
                            promise.setHandled(globalThis.vm());
                            globalThis.bunVM().waitForPromise(promise);
                            switch (promise.unwrap(globalThis.vm(), .mark_handled)) {
                                .pending => unreachable,
                                .fulfilled => |val| {
                                    plugin_result = val;
                                },
                                .rejected => |err| {
                                    return globalThis.throwValue(err);
                                },
                            }
                        }
                    }

                    if (plugin_result.toError()) |err| {
                        return globalThis.throwValue(err);
                    } else if (globalThis.hasException()) {
                        return error.JSError;
                    }

                    onstart_promise_array = plugin_result;
                }
            }

            if (try config.getBooleanLoose(globalThis, "macros")) |macros_flag| {
                this.no_macros = !macros_flag;
            }

            if (try config.getBooleanLoose(globalThis, "bytecode")) |bytecode| {
                this.bytecode = bytecode;

                if (bytecode) {
                    // Default to CJS for bytecode, since esm doesn't really work yet.
                    this.format = .cjs;
                    if (did_set_target and this.target != .bun and this.bytecode) {
                        return globalThis.throwInvalidArguments("target must be 'bun' when bytecode is true", .{});
                    }
                    this.target = .bun;
                }
            }

            var has_out_dir = false;
            if (try config.getOptional(globalThis, "outdir", ZigString.Slice)) |slice| {
                defer slice.deinit();
                try this.outdir.appendSliceExact(slice.slice());
                has_out_dir = true;
            }

            if (try config.getOptional(globalThis, "banner", ZigString.Slice)) |slice| {
                defer slice.deinit();
                try this.banner.appendSliceExact(slice.slice());
            }

            if (try config.getOptional(globalThis, "footer", ZigString.Slice)) |slice| {
                defer slice.deinit();
                try this.footer.appendSliceExact(slice.slice());
            }

            if (try config.getTruthy(globalThis, "sourcemap")) |source_map_js| {
                if (config.isBoolean()) {
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

            if (try config.get(globalThis, "env")) |env| {
                if (env != .undefined) {
                    if (env == .null or env == .false or (env.isNumber() and env.asNumber() == 0)) {
                        this.env_behavior = .disable;
                    } else if (env == .true or (env.isNumber() and env.asNumber() == 1)) {
                        this.env_behavior = .load_all;
                    } else if (env.isString()) {
                        const slice = try env.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        if (strings.eqlComptime(slice.slice(), "inline")) {
                            this.env_behavior = .load_all;
                        } else if (strings.eqlComptime(slice.slice(), "disable")) {
                            this.env_behavior = .disable;
                        } else if (strings.indexOfChar(slice.slice(), '*')) |asterisk| {
                            if (asterisk > 0) {
                                this.env_behavior = .prefix;
                                try this.env_prefix.appendSliceExact(slice.slice()[0..asterisk]);
                            } else {
                                this.env_behavior = .load_all;
                            }
                        } else {
                            return globalThis.throwInvalidArguments("env must be 'inline', 'disable', or a string with a '*' character", .{});
                        }
                    } else {
                        return globalThis.throwInvalidArguments("env must be 'inline', 'disable', or a string with a '*' character", .{});
                    }
                }
            }

            if (try config.getOptionalEnum(globalThis, "packages", options.PackagesOption)) |packages| {
                this.packages = packages;
            }

            if (try config.getOptionalEnum(globalThis, "format", options.Format)) |format| {
                this.format = format;

                if (this.bytecode and format != .cjs) {
                    return globalThis.throwInvalidArguments("format must be 'cjs' when bytecode is true. Eventually we'll add esm support as well.", .{});
                }
            }

            if (try config.getBooleanLoose(globalThis, "splitting")) |hot| {
                this.code_splitting = hot;
            }

            if (try config.getTruthy(globalThis, "minify")) |minify| {
                if (minify.isBoolean()) {
                    const value = minify.toBoolean();
                    this.minify.whitespace = value;
                    this.minify.syntax = value;
                    this.minify.identifiers = value;
                } else if (minify.isObject()) {
                    if (try minify.getBooleanLoose(globalThis, "whitespace")) |whitespace| {
                        this.minify.whitespace = whitespace;
                    }
                    if (try minify.getBooleanLoose(globalThis, "syntax")) |syntax| {
                        this.minify.syntax = syntax;
                    }
                    if (try minify.getBooleanLoose(globalThis, "identifiers")) |syntax| {
                        this.minify.identifiers = syntax;
                    }
                } else {
                    return globalThis.throwInvalidArguments("Expected minify to be a boolean or an object", .{});
                }
            }

            if (try config.getArray(globalThis, "entrypoints") orelse try config.getArray(globalThis, "entryPoints")) |entry_points| {
                var iter = entry_points.arrayIterator(globalThis);
                while (iter.next()) |entry_point| {
                    var slice = try entry_point.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.entry_points.insert(slice.slice());
                }
            } else {
                return globalThis.throwInvalidArguments("Expected entrypoints to be an array of strings", .{});
            }

            if (try config.getBooleanLoose(globalThis, "emitDCEAnnotations")) |flag| {
                this.emit_dce_annotations = flag;
            }

            if (try config.getBooleanLoose(globalThis, "ignoreDCEAnnotations")) |flag| {
                this.ignore_dce_annotations = flag;
            }

            if (try config.getTruthy(globalThis, "conditions")) |conditions_value| {
                if (conditions_value.isString()) {
                    var slice = try conditions_value.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.conditions.insert(slice.slice());
                } else if (conditions_value.jsType().isArray()) {
                    var iter = conditions_value.arrayIterator(globalThis);
                    while (iter.next()) |entry_point| {
                        var slice = try entry_point.toSliceOrNull(globalThis);
                        defer slice.deinit();
                        try this.conditions.insert(slice.slice());
                    }
                } else {
                    return globalThis.throwInvalidArguments("Expected conditions to be an array of strings", .{});
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
                    return globalThis.throwPretty("{s}: failed to open root directory: {s}", .{ @errorName(err), path.slice() });
                };
                defer dir.close();

                var rootdir_buf: bun.PathBuffer = undefined;
                const rootdir = bun.getFdPath(bun.toFD(dir.fd), &rootdir_buf) catch |err| {
                    return globalThis.throwPretty("{s}: failed to get full root directory path: {s}", .{ @errorName(err), path.slice() });
                };
                try this.rootdir.appendSliceExact(rootdir);
            }

            if (try config.getOwnArray(globalThis, "external")) |externals| {
                var iter = externals.arrayIterator(globalThis);
                while (iter.next()) |entry_point| {
                    var slice = try entry_point.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.external.insert(slice.slice());
                }
            }

            if (try config.getOwnArray(globalThis, "drop")) |drops| {
                var iter = drops.arrayIterator(globalThis);
                while (iter.next()) |entry| {
                    var slice = try entry.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.drop.insert(slice.slice());
                }
            }

            // if (try config.getOptional(globalThis, "dir", ZigString.Slice)) |slice| {
            //     defer slice.deinit();
            //     this.appendSliceExact(slice.slice()) catch unreachable;
            // } else {
            //     this.appendSliceExact(globalThis.bunVM().transpiler.fs.top_level_dir) catch unreachable;
            // }

            if (try config.getOptional(globalThis, "publicPath", ZigString.Slice)) |slice| {
                defer slice.deinit();
                try this.public_path.appendSliceExact(slice.slice());
            }

            if (try config.getTruthy(globalThis, "naming")) |naming| {
                if (naming.isString()) {
                    if (try config.getOptional(globalThis, "naming", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            try this.names.owned_entry_point.appendSliceExact("./");
                        }
                        try this.names.owned_entry_point.appendSliceExact(slice.slice());
                        this.names.entry_point.data = this.names.owned_entry_point.list.items;
                    }
                } else if (naming.isObject()) {
                    if (try naming.getOptional(globalThis, "entry", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            try this.names.owned_entry_point.appendSliceExact("./");
                        }
                        try this.names.owned_entry_point.appendSliceExact(slice.slice());
                        this.names.entry_point.data = this.names.owned_entry_point.list.items;
                    }

                    if (try naming.getOptional(globalThis, "chunk", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            try this.names.owned_chunk.appendSliceExact("./");
                        }
                        try this.names.owned_chunk.appendSliceExact(slice.slice());
                        this.names.chunk.data = this.names.owned_chunk.list.items;
                    }

                    if (try naming.getOptional(globalThis, "asset", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            try this.names.owned_asset.appendSliceExact("./");
                        }
                        try this.names.owned_asset.appendSliceExact(slice.slice());
                        this.names.asset.data = this.names.owned_asset.list.items;
                    }
                } else {
                    return globalThis.throwInvalidArguments("Expected naming to be a string or an object", .{});
                }
            }

            if (try config.getOwnObject(globalThis, "define")) |define| {
                if (!define.isObject()) {
                    return globalThis.throwInvalidArguments("define must be an object", .{});
                }

                var define_iter = try JSC.JSPropertyIterator(.{
                    .skip_empty_name = true,
                    .include_value = true,
                }).init(globalThis, define);
                defer define_iter.deinit();

                while (try define_iter.next()) |prop| {
                    const property_value = define_iter.value;
                    const value_type = property_value.jsType();

                    if (!value_type.isStringLike()) {
                        return globalThis.throwInvalidArguments("define \"{s}\" must be a JSON string", .{prop});
                    }

                    var val = JSC.ZigString.init("");
                    property_value.toZigString(&val, globalThis);
                    if (val.len == 0) {
                        val = JSC.ZigString.fromUTF8("\"\"");
                    }

                    const key = try prop.toOwnedSlice(bun.default_allocator);

                    // value is always cloned
                    const value = val.toSlice(bun.default_allocator);
                    defer value.deinit();

                    // .insert clones the value, but not the key
                    try this.define.insert(key, value.slice());
                }
            }

            if (try config.getOwnObject(globalThis, "loader")) |loaders| {
                var loader_iter = try JSC.JSPropertyIterator(.{
                    .skip_empty_name = true,
                    .include_value = true,
                }).init(globalThis, loaders);
                defer loader_iter.deinit();

                var loader_names = try allocator.alloc(string, loader_iter.len);
                errdefer allocator.free(loader_names);
                var loader_values = try allocator.alloc(Api.Loader, loader_iter.len);
                errdefer allocator.free(loader_values);

                while (try loader_iter.next()) |prop| {
                    if (!prop.hasPrefixComptime(".") or prop.length() < 2) {
                        return globalThis.throwInvalidArguments("loader property names must be file extensions, such as '.txt'", .{});
                    }

                    loader_values[loader_iter.i] = try loader_iter.value.toEnumFromMap(
                        globalThis,
                        "loader",
                        Api.Loader,
                        options.Loader.api_names,
                    );
                    loader_names[loader_iter.i] = try prop.toOwnedSlice(bun.default_allocator);
                }

                this.loaders = Api.LoaderMap{
                    .extensions = loader_names,
                    .loaders = loader_values,
                };
            }

            if (try config.getBooleanStrict(globalThis, "throw")) |flag| {
                this.throw_on_error = flag;
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
            self.drop.deinit();
            self.banner.deinit();
            self.env_prefix.deinit();
            self.footer.deinit();
        }
    };

    fn build(
        globalThis: *JSC.JSGlobalObject,
        arguments: []const JSC.JSValue,
    ) bun.JSError!JSC.JSValue {
        if (arguments.len == 0 or !arguments[0].isObject()) {
            return globalThis.throwInvalidArguments("Expected a config object to be passed to Bun.build", .{});
        }

        var plugins: ?*Plugin = null;
        const config = try Config.fromJS(globalThis, arguments[0], &plugins, globalThis.allocator());

        return bun.BundleV2.generateFromJavaScript(
            config,
            plugins,
            globalThis,
            globalThis.bunVM().eventLoop(),
            bun.default_allocator,
        );
    }

    pub fn buildFn(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const arguments = callframe.arguments_old(1);
        return build(globalThis, arguments.slice());
    }

    pub const Resolve = struct {
        bv2: *BundleV2,
        import_record: MiniImportRecord,
        value: Value,

        js_task: JSC.AnyTask,
        task: JSC.AnyEventLoop.Task,

        pub const MiniImportRecord = struct {
            kind: bun.ImportKind,
            source_file: string = "",
            namespace: string = "",
            specifier: string = "",
            importer_source_index: ?u32 = null,
            import_record_index: u32 = 0,
            range: logger.Range = logger.Range.None,
            original_target: Target,

            // pub inline fn loader(_: *const MiniImportRecord) ?options.Loader {
            //     return null;
            // }
        };

        pub fn init(bv2: *bun.BundleV2, record: MiniImportRecord) Resolve {
            return .{
                .bv2 = bv2,
                .import_record = record,
                .value = .pending,

                .task = undefined,
                .js_task = undefined,
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
            no_match,
            pending,
            consumed,

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
            bun.default_allocator.destroy(this);
        }

        const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

        pub fn dispatch(this: *Resolve) void {
            this.js_task = AnyTask.init(this);
            this.bv2.jsLoopForPlugins().enqueueTaskConcurrent(JSC.ConcurrentTask.create(this.js_task.task()));
        }

        pub fn runOnJSThread(this: *Resolve) void {
            this.bv2.plugins.?.matchOnResolve(
                this.import_record.specifier,
                this.import_record.namespace,
                this.import_record.source_file,
                this,
                this.import_record.kind,
            );
        }

        export fn JSBundlerPlugin__onResolveAsync(
            resolve: *Resolve,
            _: *anyopaque,
            path_value: JSValue,
            namespace_value: JSValue,
            external_value: JSValue,
        ) void {
            if (path_value.isEmptyOrUndefinedOrNull() or namespace_value.isEmptyOrUndefinedOrNull()) {
                resolve.value = .{ .no_match = {} };
            } else {
                const global = resolve.bv2.plugins.?.globalObject();
                const path = path_value.toSliceCloneWithAllocator(global, bun.default_allocator) orelse @panic("Unexpected: path is not a string");
                const namespace = namespace_value.toSliceCloneWithAllocator(global, bun.default_allocator) orelse @panic("Unexpected: namespace is not a string");
                resolve.value = .{
                    .success = .{
                        .path = path.slice(),
                        .namespace = namespace.slice(),
                        .external = external_value.to(bool),
                    },
                };
            }

            resolve.bv2.onResolveAsync(resolve);
        }

        comptime {
            _ = JSBundlerPlugin__onResolveAsync;
        }
    };

    const DeferredTask = bun.bundle_v2.DeferredTask;

    pub const Load = struct {
        bv2: *BundleV2,

        source_index: Index,
        default_loader: options.Loader,
        path: []const u8,
        namespace: []const u8,

        value: Value,
        js_task: JSC.AnyTask,
        task: JSC.AnyEventLoop.Task,
        parse_task: *bun.ParseTask,
        /// Faster path: skip the extra threadpool dispatch when the file is not found
        was_file: bool,
        /// Defer may only be called once
        called_defer: bool,

        const debug_deferred = bun.Output.scoped(.BUNDLER_DEFERRED, true);

        pub fn init(bv2: *bun.BundleV2, parse: *bun.bundle_v2.ParseTask) Load {
            return .{
                .bv2 = bv2,
                .parse_task = parse,
                .source_index = parse.source_index,
                .default_loader = parse.path.loader(&bv2.transpiler.options.loaders) orelse .js,
                .value = .pending,
                .path = parse.path.text,
                .namespace = parse.path.namespace,
                .was_file = false,
                .called_defer = false,
                .task = undefined,
                .js_task = undefined,
            };
        }

        pub fn bakeGraph(load: *const Load) bun.bake.Graph {
            return load.parse_task.known_target.bakeGraph();
        }

        pub const Value = union(enum) {
            err: logger.Msg,
            success: struct {
                source_code: []const u8 = "",
                loader: options.Loader = .file,
            },
            pending,
            no_match,
            /// The value has been de-initialized or left over from `consume()`
            consumed,

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

            /// Moves the value, replacing the original with `.consumed`. It is
            /// safe to `deinit()` the consumed value, but the memory in `err`
            /// and `success` must be freed by the caller.
            pub fn consume(this: *Value) Value {
                const result = this.*;
                this.* = .{ .consumed = {} };
                return result;
            }
        };

        pub fn deinit(this: *Load) void {
            debug("Deinit Load(0{x}, {s})", .{ @intFromPtr(this), this.path });
            this.value.deinit();
        }

        const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

        pub fn runOnJSThread(load: *Load) void {
            load.bv2.plugins.?.matchOnLoad(
                load.path,
                load.namespace,
                load,
                load.default_loader,
                load.bakeGraph() != .client,
            );
        }

        pub fn dispatch(this: *Load) void {
            this.js_task = AnyTask.init(this);
            const concurrent_task = JSC.ConcurrentTask.createFrom(&this.js_task);
            this.bv2.jsLoopForPlugins().enqueueTaskConcurrent(concurrent_task);
        }

        export fn JSBundlerPlugin__onDefer(load: *Load, global: *JSC.JSGlobalObject) JSValue {
            return JSC.toJSHostValue(global, load.onDefer(global));
        }
        fn onDefer(this: *Load, globalObject: *JSC.JSGlobalObject) bun.JSError!JSValue {
            if (this.called_defer) {
                return globalObject.throw("Can't call .defer() more than once within an onLoad plugin", .{});
            }
            this.called_defer = true;

            debug_deferred("JSBundlerPlugin__onDefer(0x{x}, {s})", .{ @intFromPtr(this), this.path });

            // Notify the bundler thread about the deferral. This will decrement
            // the pending item counter and increment the deferred counter.
            switch (this.parse_task.ctx.loop().*) {
                .js => |jsc_event_loop| {
                    jsc_event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this.parse_task.ctx, BundleV2.onNotifyDefer));
                },
                .mini => |*mini| {
                    mini.enqueueTaskConcurrentWithExtraCtx(
                        Load,
                        BundleV2,
                        this,
                        BundleV2.onNotifyDeferMini,
                        .task,
                    );
                },
            }

            return this.bv2.plugins.?.appendDeferPromise();
        }

        export fn JSBundlerPlugin__onLoadAsync(
            this: *Load,
            _: *anyopaque,
            source_code_value: JSValue,
            loader_as_int: JSValue,
        ) void {
            JSC.markBinding(@src());
            if (source_code_value.isEmptyOrUndefinedOrNull() or loader_as_int.isEmptyOrUndefinedOrNull()) {
                this.value = .{ .no_match = {} };

                if (this.was_file) {
                    // Faster path: skip the extra threadpool dispatch
                    this.bv2.graph.pool.pool.schedule(bun.ThreadPool.Batch.from(&this.parse_task.task));
                    this.deinit();
                    return;
                }
            } else {
                const loader: Api.Loader = @enumFromInt(loader_as_int.to(u8));
                const source_code = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(this.bv2.plugins.?.globalObject(), source_code_value, bun.default_allocator) catch
                // TODO:
                    @panic("Unexpected: source_code is not a string");
                this.value = .{
                    .success = .{
                        .loader = options.Loader.fromAPI(loader),
                        .source_code = source_code,
                    },
                };
            }

            this.bv2.onLoadAsync(this);
        }

        comptime {
            _ = JSBundlerPlugin__onLoadAsync;
        }
    };

    pub const Plugin = opaque {
        extern fn JSBundlerPlugin__create(*JSC.JSGlobalObject, JSC.JSGlobalObject.BunPluginTarget) *Plugin;
        pub fn create(global: *JSC.JSGlobalObject, target: JSC.JSGlobalObject.BunPluginTarget) *Plugin {
            JSC.markBinding(@src());
            const plugin = JSBundlerPlugin__create(global, target);
            JSC.JSValue.fromCell(plugin).protect();
            return plugin;
        }

        extern fn JSBundlerPlugin__callOnBeforeParsePlugins(
            *Plugin,
            bun_context: *anyopaque,
            namespace: *const String,
            path: *const String,
            on_before_parse_args: ?*anyopaque,
            on_before_parse_result: ?*anyopaque,
            should_continue: *i32,
        ) i32;

        pub fn callOnBeforeParsePlugins(this: *Plugin, ctx: *anyopaque, namespace: *const String, path: *const String, on_before_parse_args: ?*anyopaque, on_before_parse_result: ?*anyopaque, should_continue: *i32) i32 {
            return JSBundlerPlugin__callOnBeforeParsePlugins(this, ctx, namespace, path, on_before_parse_args, on_before_parse_result, should_continue);
        }

        extern fn JSBundlerPlugin__hasOnBeforeParsePlugins(*Plugin) i32;
        pub fn hasOnBeforeParsePlugins(this: *Plugin) bool {
            return JSBundlerPlugin__hasOnBeforeParsePlugins(this) != 0;
        }

        extern fn JSBundlerPlugin__tombstone(*Plugin) void;
        pub fn deinit(this: *Plugin) void {
            JSC.markBinding(@src());
            JSBundlerPlugin__tombstone(this);
            JSC.JSValue.fromCell(this).unprotect();
        }

        extern fn JSBundlerPlugin__globalObject(*Plugin) *JSC.JSGlobalObject;
        pub const globalObject = JSBundlerPlugin__globalObject;

        extern fn JSBundlerPlugin__anyMatches(
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            bool,
        ) bool;

        extern fn JSBundlerPlugin__matchOnLoad(
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            context: *anyopaque,
            u8,
            bool,
        ) void;

        extern fn JSBundlerPlugin__matchOnResolve(
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            importer: *const String,
            context: *anyopaque,
            u8,
        ) void;

        extern fn JSBundlerPlugin__drainDeferred(*Plugin, rejected: bool) void;
        extern fn JSBundlerPlugin__appendDeferPromise(*Plugin) JSValue;
        pub const appendDeferPromise = JSBundlerPlugin__appendDeferPromise;

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
            defer namespace_string.deref();
            defer path_string.deref();
            return JSBundlerPlugin__anyMatches(this, &namespace_string, &path_string, is_onLoad);
        }

        pub fn matchOnLoad(
            this: *Plugin,
            path: []const u8,
            namespace: []const u8,
            context: *anyopaque,
            default_loader: options.Loader,
            is_server_side: bool,
        ) void {
            JSC.markBinding(@src());
            const tracer = bun.tracy.traceNamed(@src(), "JSBundler.matchOnLoad");
            defer tracer.end();
            debug("JSBundler.matchOnLoad(0x{x}, {s}, {s})", .{ @intFromPtr(this), namespace, path });
            const namespace_string = if (namespace.len == 0)
                bun.String.static("file")
            else
                bun.String.createUTF8(namespace);
            const path_string = bun.String.createUTF8(path);
            defer namespace_string.deref();
            defer path_string.deref();
            JSBundlerPlugin__matchOnLoad(this, &namespace_string, &path_string, context, @intFromEnum(default_loader), is_server_side);
        }

        pub fn matchOnResolve(
            this: *Plugin,
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
            JSBundlerPlugin__matchOnResolve(this, &namespace_string, &path_string, &importer_string, context, @intFromEnum(import_record_kind));
        }

        pub fn addPlugin(
            this: *Plugin,
            object: JSC.JSValue,
            config: JSC.JSValue,
            onstart_promises_array: JSC.JSValue,
            is_last: bool,
            is_bake: bool,
        ) !JSValue {
            JSC.markBinding(@src());
            const tracer = bun.tracy.traceNamed(@src(), "JSBundler.addPlugin");
            defer tracer.end();
            return JSBundlerPlugin__runSetupFunction(
                this,
                object,
                config,
                onstart_promises_array,
                JSValue.jsBoolean(is_last),
                JSValue.jsBoolean(is_bake),
            ).unwrap();
        }

        pub fn drainDeferred(this: *Plugin, rejected: bool) void {
            JSBundlerPlugin__drainDeferred(this, rejected);
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
            JSC.JSValue,
            JSC.JSValue,
            JSC.JSValue,
        ) JSValue.MaybeException;

        pub export fn JSBundlerPlugin__addError(
            ctx: *anyopaque,
            plugin: *Plugin,
            exception: JSValue,
            which: JSValue,
        ) void {
            switch (which.to(i32)) {
                0 => {
                    const resolve: *JSBundler.Resolve = bun.cast(*Resolve, ctx);
                    resolve.value = .{
                        .err = logger.Msg.fromJS(
                            bun.default_allocator,
                            plugin.globalObject(),
                            resolve.import_record.source_file,
                            exception,
                        ) catch bun.outOfMemory(),
                    };
                    resolve.bv2.onResolveAsync(resolve);
                },
                1 => {
                    const load: *Load = bun.cast(*Load, ctx);
                    load.value = .{
                        .err = logger.Msg.fromJS(
                            bun.default_allocator,
                            plugin.globalObject(),
                            load.path,
                            exception,
                        ) catch bun.outOfMemory(),
                    };
                    load.bv2.onLoadAsync(load);
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
        sourcemap,
        bytecode,

        pub fn isFileInStandaloneMode(this: OutputKind) bool {
            return this != .sourcemap and this != .bytecode;
        }
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
    ) bun.JSError!JSC.JSValue {
        return @call(bun.callmod_inline, Blob.getText, .{ &this.blob, globalThis, callframe });
    }

    pub fn getJSON(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        return @call(bun.callmod_inline, Blob.getJSON, .{ &this.blob, globalThis, callframe });
    }
    pub fn getArrayBuffer(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSValue {
        return @call(bun.callmod_inline, Blob.getArrayBuffer, .{ &this.blob, globalThis, callframe });
    }
    pub fn getSlice(
        this: *BuildArtifact,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
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
    ) bun.JSError!JSValue {
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
        const out = std.fmt.bufPrint(&buf, "{any}", .{bun.fmt.truncatedHash32(this.hash)}) catch @panic("Unexpected");
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
                    .{bun.fmt.truncatedHash32(this.hash)},
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
const BundleV2 = bun.bundle_v2.BundleV2;
