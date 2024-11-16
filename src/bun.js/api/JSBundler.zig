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
const Mimalloc = @import("../../mimalloc_arena.zig");
const Runtime = @import("../../runtime.zig").Runtime;
const JSLexer = bun.js_lexer;
const Expr = JSAst.Expr;
const Index = @import("../../ast/base.zig").Index;

const debug = bun.Output.scoped(.Bundler, false);

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
        experimental_css: bool = false,
        css_chunking: bool = false,
        drop: bun.StringSet = bun.StringSet.init(bun.default_allocator),

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

            if (config.getTruthy(globalThis, "experimentalCss")) |enable_css| {
                this.experimental_css = if (enable_css.isBoolean())
                    enable_css.toBoolean()
                else if (enable_css.isObject()) true: {
                    if (enable_css.getTruthy(globalThis, "chunking")) |enable_chunking| {
                        this.css_chunking = if (enable_chunking.isBoolean()) enable_css.toBoolean() else false;
                    }

                    break :true true;
                } else false;
            }

            // Plugins must be resolved first as they are allowed to mutate the config JSValue
            if (try config.getArray(globalThis, "plugins")) |array| {
                const length = array.getLength(globalThis);
                var iter = array.arrayIterator(globalThis);
                var onstart_promise_array: JSValue = JSValue.undefined;
                var i: usize = 0;
                while (iter.next()) |plugin| : (i += 1) {
                    if (!plugin.isObject()) {
                        return globalThis.throwInvalidArguments2("Expected plugin to be an object", .{});
                    }

                    if (try plugin.getOptional(globalThis, "name", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (slice.len == 0) {
                            return globalThis.throwInvalidArguments2("Expected plugin to have a non-empty name", .{});
                        }
                    } else {
                        return globalThis.throwInvalidArguments2("Expected plugin to have a name", .{});
                    }

                    const function = try plugin.getFunction(globalThis, "setup") orelse {
                        return globalThis.throwInvalidArguments2("Expected plugin to have a setup() function", .{});
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
                    var plugin_result = try bun_plugins.addPlugin(function, config, onstart_promise_array, is_last);

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
                                    return globalThis.throwValue2(err);
                                },
                            }
                        }
                    }

                    if (plugin_result.toError()) |err| {
                        return globalThis.throwValue2(err);
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
                    this.target = .bun;
                }
            }

            if (try config.getOptionalEnum(globalThis, "target", options.Target)) |target| {
                this.target = target;

                if (target != .bun and this.bytecode) {
                    return globalThis.throwInvalidArguments2("target must be 'bun' when bytecode is true", .{});
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
                this.format = format;

                if (this.bytecode and format != .cjs) {
                    return globalThis.throwInvalidArguments2("format must be 'cjs' when bytecode is true. Eventually we'll add esm support as well.", .{});
                }
            }

            if (try config.getBooleanLoose(globalThis, "splitting")) |hot| {
                this.code_splitting = hot;
            }

            if (config.getTruthy(globalThis, "minify")) |minify| {
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
                    return globalThis.throwInvalidArguments2("Expected minify to be a boolean or an object", .{});
                }
            }

            if (try config.getArray(globalThis, "entrypoints") orelse try config.getArray(globalThis, "entryPoints")) |entry_points| {
                var iter = entry_points.arrayIterator(globalThis);
                while (iter.next()) |entry_point| {
                    var slice = entry_point.toSliceOrNull(globalThis) orelse {
                        return globalThis.throwInvalidArguments2("Expected entrypoints to be an array of strings", .{});
                    };
                    defer slice.deinit();
                    try this.entry_points.insert(slice.slice());
                }
            } else {
                return globalThis.throwInvalidArguments2("Expected entrypoints to be an array of strings", .{});
            }

            if (try config.getBooleanLoose(globalThis, "emitDCEAnnotations")) |flag| {
                this.emit_dce_annotations = flag;
            }

            if (try config.getBooleanLoose(globalThis, "ignoreDCEAnnotations")) |flag| {
                this.ignore_dce_annotations = flag;
            }

            if (config.getTruthy(globalThis, "conditions")) |conditions_value| {
                if (conditions_value.isString()) {
                    var slice = conditions_value.toSliceOrNull(globalThis) orelse {
                        return globalThis.throwInvalidArguments2("Expected conditions to be an array of strings", .{});
                    };
                    defer slice.deinit();
                    try this.conditions.insert(slice.slice());
                } else if (conditions_value.jsType().isArray()) {
                    var iter = conditions_value.arrayIterator(globalThis);
                    while (iter.next()) |entry_point| {
                        var slice = entry_point.toSliceOrNull(globalThis) orelse {
                            return globalThis.throwInvalidArguments2("Expected conditions to be an array of strings", .{});
                        };
                        defer slice.deinit();
                        try this.conditions.insert(slice.slice());
                    }
                } else {
                    return globalThis.throwInvalidArguments2("Expected conditions to be an array of strings", .{});
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
                    return error.JSError;
                };
                defer dir.close();

                var rootdir_buf: bun.PathBuffer = undefined;
                const rootdir = bun.getFdPath(bun.toFD(dir.fd), &rootdir_buf) catch |err| {
                    globalThis.throwPretty("{s}: failed to get full root directory path: {s}", .{ @errorName(err), path.slice() });
                    return error.JSError;
                };
                try this.rootdir.appendSliceExact(rootdir);
            }

            if (try config.getOwnArray(globalThis, "external")) |externals| {
                var iter = externals.arrayIterator(globalThis);
                while (iter.next()) |entry_point| {
                    var slice = entry_point.toSliceOrNull(globalThis) orelse {
                        return globalThis.throwInvalidArguments2("Expected external to be an array of strings", .{});
                    };
                    defer slice.deinit();
                    try this.external.insert(slice.slice());
                }
            }

            if (try config.getOwnArray(globalThis, "drop")) |drops| {
                var iter = drops.arrayIterator(globalThis);
                while (iter.next()) |entry| {
                    var slice = entry.toSliceOrNull(globalThis) orelse {
                        return globalThis.throwInvalidArguments2("Expected drop to be an array of strings", .{});
                    };
                    defer slice.deinit();
                    try this.drop.insert(slice.slice());
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
                try this.public_path.appendSliceExact(slice.slice());
            }

            if (config.getTruthy(globalThis, "naming")) |naming| {
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
                    return globalThis.throwInvalidArguments2("Expected naming to be a string or an object", .{});
                }
            }

            if (try config.getOwnObject(globalThis, "define")) |define| {
                if (!define.isObject()) {
                    return globalThis.throwInvalidArguments2("define must be an object", .{});
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
                        return globalThis.throwInvalidArguments2("define \"{s}\" must be a JSON string", .{prop});
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
                        return globalThis.throwInvalidArguments2("loader property names must be file extensions, such as '.txt'", .{});
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
            self.footer.deinit();
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
        const config = Config.fromJS(globalThis, arguments[0], &plugins, globalThis.allocator()) catch |err| {
            switch (err) {
                error.JSError => {
                    return .zero;
                },
                error.OutOfMemory => {
                    globalThis.throwOutOfMemory();
                    return .zero;
                },
            }
        };

        return bun.BundleV2.generateFromJavaScript(
            config,
            plugins,
            globalThis,
            globalThis.bunVM().eventLoop(),
            bun.default_allocator,
        ) catch |err| {
            switch (err) {
                error.OutOfMemory => {
                    globalThis.throwOutOfMemory();
                    return .zero;
                },
            }
        };
    }

    pub fn buildFn(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
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

    const DeferredTask = bun.bundle_v2.DeferredTask;

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

        // We only allow the user to call defer once right now
        called_defer: bool = false,

        const debug_deferred = bun.Output.scoped(.BUNDLER_DEFERRED, true);

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
            debug("Deinit Load(0{x}, {s})", .{ @intFromPtr(this), this.path });
            this.value.deinit();
            if (this.completion) |completion|
                completion.deref();
        }

        const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

        pub fn runOnJSThread(this: *Load) void {
            var completion: *bun.BundleV2.JSBundleCompletionTask = this.completion orelse {
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
            var completion: *bun.BundleV2.JSBundleCompletionTask = this.completion orelse {
                this.deinit();
                return;
            };
            completion.ref();

            this.js_task = AnyTask.init(this);
            const concurrent_task = JSC.ConcurrentTask.createFrom(&this.js_task);
            completion.jsc_event_loop.enqueueTaskConcurrent(concurrent_task);
        }

        export fn JSBundlerPlugin__onDefer(
            this: *Load,
            globalObject: *JSC.JSGlobalObject,
        ) JSValue {
            if (this.called_defer) {
                globalObject.throw("can't call .defer() more than once within an onLoad plugin", .{});
                return .undefined;
            }
            this.called_defer = true;

            _ = this.parse_task.ctx.graph.deferred_pending.fetchAdd(1, .acq_rel);
            _ = @atomicRmw(usize, &this.parse_task.ctx.graph.parse_pending, .Sub, 1, .acq_rel);

            debug_deferred("JSBundlerPlugin__onDefer(0x{x}, {s}) parse_pending={d} deferred_pending={d}", .{
                @intFromPtr(this),
                this.path,
                @atomicLoad(
                    usize,
                    &this.parse_task.ctx.graph.parse_pending,
                    .monotonic,
                ),
                this.parse_task.ctx.graph.deferred_pending.load(.monotonic),
            });

            defer this.parse_task.ctx.loop().wakeup();
            const promise: JSValue = if (this.completion) |c| c.plugins.?.appendDeferPromise() else return .undefined;
            return promise;
        }

        export fn JSBundlerPlugin__onLoadAsync(
            this: *Load,
            _: *anyopaque,
            source_code_value: JSValue,
            loader_as_int: JSValue,
        ) void {
            JSC.markBinding(@src());
            var completion: *bun.BundleV2.JSBundleCompletionTask = this.completion orelse {
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
                const loader: Api.Loader = @enumFromInt(loader_as_int.to(u8));
                const source_code = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(completion.globalThis, source_code_value, bun.default_allocator) catch
                // TODO:
                    @panic("Unexpected: source_code is not a string");
                this.value = .{
                    .success = .{
                        .loader = options.Loader.fromAPI(loader),
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

        extern fn JSBundlerPlugin__drainDeferred(*Plugin, rejected: bool) void;
        extern fn JSBundlerPlugin__appendDeferPromise(*Plugin, rejected: bool) JSValue;

        pub fn appendDeferPromise(this: *Plugin) JSValue {
            return JSBundlerPlugin__appendDeferPromise(this, false);
        }

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
            globalThis: *JSC.JSGlobalObject,
            path: []const u8,
            namespace: []const u8,
            context: *anyopaque,
            default_loader: options.Loader,
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
            onstart_promises_array: JSC.JSValue,
            is_last: bool,
        ) !JSValue {
            JSC.markBinding(@src());
            const tracer = bun.tracy.traceNamed(@src(), "JSBundler.addPlugin");
            defer tracer.end();
            const value = JSBundlerPlugin__runSetupFunction(this, object, config, onstart_promises_array, JSValue.jsBoolean(is_last));
            if (value == .zero) return error.JSError;
            return value;
        }

        pub fn drainDeferred(this: *Plugin, rejected: bool) void {
            JSBundlerPlugin__drainDeferred(this, rejected);
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
