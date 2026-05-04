//! `JSBundleCompletionTask` and the JS-facing entrypoints for `Bun.build()`.
//! Moved from inside `BundleV2` so `bundler/` is free of JSC types. Aliased
//! back as `BundleV2.JSBundleCompletionTask` etc.

pub const BuildResult = bv2.BundleV2.BuildResult;
pub const Result = bv2.BundleV2.Result;

pub const JSBundleThread = BundleThread(JSBundleCompletionTask);

pub fn createAndScheduleCompletionTask(
    config: bun.jsc.API.JSBundler.Config,
    plugins: ?*bun.jsc.API.JSBundler.Plugin,
    globalThis: *jsc.JSGlobalObject,
    event_loop: *bun.jsc.EventLoop,
    _: std.mem.Allocator,
) OOM!*JSBundleCompletionTask {
    const completion = bun.new(JSBundleCompletionTask, .{
        .ref_count = .init(),
        .config = config,
        .jsc_event_loop = event_loop,
        .globalThis = globalThis,
        .poll_ref = Async.KeepAlive.init(),
        .env = globalThis.bunVM().transpiler.env,
        .plugins = plugins,
        .log = Logger.Log.init(bun.default_allocator),
        .task = undefined,
    });
    completion.task = JSBundleCompletionTask.TaskCompletion.init(completion);

    if (plugins) |plugin| {
        plugin.setConfig(completion);
    }

    // Ensure this exists before we spawn the thread to prevent any race
    // conditions from creating two
    _ = jsc.WorkPool.get();

    JSBundleThread.singleton.enqueue(completion);

    completion.poll_ref.ref(globalThis.bunVM());

    return completion;
}

pub fn generateFromJavaScript(
    config: bun.jsc.API.JSBundler.Config,
    plugins: ?*bun.jsc.API.JSBundler.Plugin,
    globalThis: *jsc.JSGlobalObject,
    event_loop: *bun.jsc.EventLoop,
    alloc: std.mem.Allocator,
) OOM!bun.jsc.JSValue {
    const completion = try createAndScheduleCompletionTask(config, plugins, globalThis, event_loop, alloc);
    completion.promise = jsc.JSPromise.Strong.init(globalThis);
    return completion.promise.value();
}

pub const JSBundleCompletionTask = struct {
    pub const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", @This().deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    config: bun.jsc.API.JSBundler.Config,
    jsc_event_loop: *bun.jsc.EventLoop,
    task: bun.jsc.AnyTask,
    globalThis: *jsc.JSGlobalObject,
    promise: jsc.JSPromise.Strong = .{},
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
    env: *bun.DotEnv.Loader,
    log: Logger.Log,
    cancelled: bool = false,

    html_build_task: ?*jsc.API.HTMLBundle.HTMLBundleRoute = null,

    result: Result = .{ .pending = {} },

    next: ?*JSBundleCompletionTask = null,
    transpiler: *BundleV2 = undefined,
    plugins: ?*bun.jsc.API.JSBundler.Plugin = null,
    started_at_ns: u64 = 0,

    pub fn configureBundler(
        completion: *JSBundleCompletionTask,
        transpiler: *Transpiler,
        alloc: std.mem.Allocator,
    ) !void {
        const config = &completion.config;

        // JSX config is already in API format
        const jsx_api = config.jsx;

        transpiler.* = try bun.Transpiler.init(
            alloc,
            &completion.log,
            api.TransformOptions{
                .define = if (config.define.count() > 0) config.define.toAPI() else null,
                .entry_points = config.entry_points.keys(),
                .target = config.target.toAPI(),
                .absolute_working_dir = if (config.dir.list.items.len > 0)
                    config.dir.sliceWithSentinel()
                else
                    null,
                .inject = &.{},
                .external = config.external.keys(),
                .main_fields = &.{},
                .extension_order = &.{},
                .env_files = &.{},
                .conditions = config.conditions.map.keys(),
                .ignore_dce_annotations = transpiler.options.ignore_dce_annotations,
                .drop = config.drop.map.keys(),
                .bunfig_path = transpiler.options.bunfig_path,
                .jsx = jsx_api,
            },
            completion.env,
        );
        transpiler.options.env.behavior = config.env_behavior;
        transpiler.options.env.prefix = config.env_prefix.slice();
        // Use the StringSet directly instead of the slice passed through TransformOptions
        transpiler.options.bundler_feature_flags = &config.features;
        if (config.force_node_env != .unspecified) {
            transpiler.options.force_node_env = config.force_node_env;
        }

        transpiler.options.entry_points = config.entry_points.keys();
        // Convert API JSX config back to options.JSX.Pragma
        transpiler.options.jsx = options.JSX.Pragma{
            .factory = if (config.jsx.factory.len > 0)
                try options.JSX.Pragma.memberListToComponentsIfDifferent(alloc, &.{}, config.jsx.factory)
            else
                options.JSX.Pragma.Defaults.Factory,
            .fragment = if (config.jsx.fragment.len > 0)
                try options.JSX.Pragma.memberListToComponentsIfDifferent(alloc, &.{}, config.jsx.fragment)
            else
                options.JSX.Pragma.Defaults.Fragment,
            .runtime = config.jsx.runtime,
            .development = config.jsx.development,
            .package_name = if (config.jsx.import_source.len > 0) config.jsx.import_source else "react",
            .classic_import_source = if (config.jsx.import_source.len > 0) config.jsx.import_source else "react",
            .side_effects = config.jsx.side_effects,
            .parse = true,
            .import_source = .{
                .development = if (config.jsx.import_source.len > 0)
                    try std.fmt.allocPrint(alloc, "{s}/jsx-dev-runtime", .{config.jsx.import_source})
                else
                    "react/jsx-dev-runtime",
                .production = if (config.jsx.import_source.len > 0)
                    try std.fmt.allocPrint(alloc, "{s}/jsx-runtime", .{config.jsx.import_source})
                else
                    "react/jsx-runtime",
            },
        };
        transpiler.options.no_macros = config.no_macros;
        transpiler.options.loaders = try options.loadersFromTransformOptions(alloc, config.loaders, config.target);
        transpiler.options.entry_naming = config.names.entry_point.data;
        transpiler.options.chunk_naming = config.names.chunk.data;
        transpiler.options.asset_naming = config.names.asset.data;

        transpiler.options.output_format = config.format;
        transpiler.options.bytecode = config.bytecode;
        transpiler.options.compile = config.compile != null;

        // For compile mode, set the public_path to the target-specific base path
        // This ensures embedded resources like yoga.wasm are correctly found
        if (config.compile) |compile_opts| {
            const base_public_path = bun.StandaloneModuleGraph.targetBasePublicPath(compile_opts.compile_target.os, "root/");
            transpiler.options.public_path = base_public_path;
        } else {
            transpiler.options.public_path = config.public_path.list.items;
        }

        transpiler.options.output_dir = config.outdir.slice();
        transpiler.options.root_dir = config.rootdir.slice();
        transpiler.options.minify_syntax = config.minify.syntax;
        transpiler.options.minify_whitespace = config.minify.whitespace;
        transpiler.options.minify_identifiers = config.minify.identifiers;
        transpiler.options.keep_names = config.minify.keep_names;
        transpiler.options.inlining = config.minify.syntax;
        transpiler.options.source_map = config.source_map;
        transpiler.options.packages = config.packages;
        transpiler.options.allow_unresolved = if (config.allow_unresolved) |*a| options.AllowUnresolved.fromStrings(a.keys()) else .all;
        transpiler.options.code_splitting = config.code_splitting;
        transpiler.options.emit_dce_annotations = config.emit_dce_annotations orelse !config.minify.whitespace;
        transpiler.options.ignore_dce_annotations = config.ignore_dce_annotations;
        transpiler.options.css_chunking = config.css_chunking;
        transpiler.options.compile_to_standalone_html = brk: {
            if (config.compile == null or config.target != .browser) break :brk false;
            // Only activate standalone HTML when all entrypoints are HTML files
            for (config.entry_points.keys()) |ep| {
                if (!bun.strings.hasSuffixComptime(ep, ".html")) break :brk false;
            }
            break :brk config.entry_points.count() > 0;
        };
        // When compiling to standalone HTML, don't use the bun executable compile path
        if (transpiler.options.compile_to_standalone_html) {
            transpiler.options.compile = false;
            config.compile = null;
        }
        transpiler.options.banner = config.banner.slice();
        transpiler.options.footer = config.footer.slice();
        transpiler.options.react_fast_refresh = config.react_fast_refresh;
        transpiler.options.metafile = config.metafile;
        transpiler.options.metafile_json_path = config.metafile_json_path.slice();
        transpiler.options.metafile_markdown_path = config.metafile_markdown_path.slice();
        if (config.optimize_imports.count() > 0) {
            transpiler.options.optimize_imports = &config.optimize_imports;
        }

        if (transpiler.options.compile) {
            // Emitting DCE annotations is nonsensical in --compile.
            transpiler.options.emit_dce_annotations = false;
        }

        transpiler.configureLinker();
        try transpiler.configureDefines();

        if (!transpiler.options.production) {
            try transpiler.options.conditions.appendSlice(&.{"development"});
        }
        transpiler.resolver.env_loader = transpiler.env;
        transpiler.resolver.opts = transpiler.options;
    }

    pub fn completeOnBundleThread(completion: *JSBundleCompletionTask) void {
        completion.jsc_event_loop.enqueueTaskConcurrent(jsc.ConcurrentTask.create(completion.task.task()));
    }

    pub const TaskCompletion = bun.jsc.AnyTask.New(JSBundleCompletionTask, onComplete);

    fn deinit(this: *JSBundleCompletionTask) void {
        this.result.deinit();
        this.log.deinit();
        this.poll_ref.disable();
        if (this.plugins) |plugin| {
            plugin.deinit();
        }
        this.config.deinit(bun.default_allocator);
        this.promise.deinit();
        bun.destroy(this);
    }

    fn doCompilation(this: *JSBundleCompletionTask, output_files: *std.array_list.Managed(options.OutputFile)) bun.StandaloneModuleGraph.CompileResult {
        const compile_options = &(this.config.compile orelse @panic("Unexpected: No compile options provided"));

        const entry_point_index: usize = brk: {
            for (output_files.items, 0..) |*output_file, i| {
                if (output_file.output_kind == .@"entry-point" and (output_file.side orelse .server) == .server) {
                    break :brk i;
                }
            }
            return bun.StandaloneModuleGraph.CompileResult.fail(.no_entry_point);
        };

        const output_file = &output_files.items[entry_point_index];
        const outbuf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(outbuf);

        // Always get an absolute path for the outfile to ensure it works correctly with PE metadata operations
        var full_outfile_path = if (this.config.outdir.slice().len > 0) brk: {
            const outdir_slice = this.config.outdir.slice();
            const top_level_dir = bun.fs.FileSystem.instance.top_level_dir;
            break :brk bun.path.joinAbsStringBuf(top_level_dir, outbuf, &[_][]const u8{ outdir_slice, compile_options.outfile.slice() }, .auto);
        } else if (std.fs.path.isAbsolute(compile_options.outfile.slice()))
            compile_options.outfile.slice()
        else brk: {
            // For relative paths, ensure we make them absolute relative to the current working directory
            const top_level_dir = bun.fs.FileSystem.instance.top_level_dir;
            break :brk bun.path.joinAbsStringBuf(top_level_dir, outbuf, &[_][]const u8{compile_options.outfile.slice()}, .auto);
        };

        // Add .exe extension for Windows targets if not already present
        if (compile_options.compile_target.os == .windows and !strings.hasSuffixComptime(full_outfile_path, ".exe")) {
            full_outfile_path = std.fmt.allocPrint(bun.default_allocator, "{s}.exe", .{full_outfile_path}) catch |err| bun.handleOom(err);
        } else {
            full_outfile_path = bun.handleOom(bun.default_allocator.dupe(u8, full_outfile_path));
        }

        const dirname = std.fs.path.dirname(full_outfile_path) orelse ".";
        const basename = std.fs.path.basename(full_outfile_path);

        var root_dir = bun.FD.cwd().stdDir();
        defer {
            if (bun.FD.fromStdDir(root_dir) != bun.FD.cwd()) {
                root_dir.close();
            }
        }

        // On Windows, don't change root_dir, just pass the full relative path
        // On POSIX, change root_dir to the target directory and pass basename
        const outfile_for_executable = if (Environment.isWindows) full_outfile_path else basename;

        if (Environment.isPosix and !(dirname.len == 0 or strings.eqlComptime(dirname, "."))) {
            // On POSIX, makeOpenPath and change root_dir
            root_dir = root_dir.makeOpenPath(dirname, .{}) catch |err| {
                return bun.StandaloneModuleGraph.CompileResult.failFmt("Failed to open output directory {s}: {s}", .{ dirname, @errorName(err) });
            };
        } else if (Environment.isWindows and !(dirname.len == 0 or strings.eqlComptime(dirname, "."))) {
            // On Windows, ensure directories exist but don't change root_dir
            _ = bun.makePath(root_dir, dirname) catch |err| {
                return bun.StandaloneModuleGraph.CompileResult.failFmt("Failed to create output directory {s}: {s}", .{ dirname, @errorName(err) });
            };
        }

        // Use the target-specific base path for compile mode, not the user-configured public_path
        const module_prefix = bun.StandaloneModuleGraph.targetBasePublicPath(compile_options.compile_target.os, "root/");

        const result = bun.StandaloneModuleGraph.toExecutable(
            &compile_options.compile_target,
            bun.default_allocator,
            output_files.items,
            root_dir,
            module_prefix,
            outfile_for_executable,
            this.env,
            this.config.format,
            .{
                .hide_console = compile_options.windows_hide_console,
                .icon = if (compile_options.windows_icon_path.slice().len > 0)
                    compile_options.windows_icon_path.slice()
                else
                    null,
                .title = if (compile_options.windows_title.slice().len > 0)
                    compile_options.windows_title.slice()
                else
                    null,
                .publisher = if (compile_options.windows_publisher.slice().len > 0)
                    compile_options.windows_publisher.slice()
                else
                    null,
                .version = if (compile_options.windows_version.slice().len > 0)
                    compile_options.windows_version.slice()
                else
                    null,
                .description = if (compile_options.windows_description.slice().len > 0)
                    compile_options.windows_description.slice()
                else
                    null,
                .copyright = if (compile_options.windows_copyright.slice().len > 0)
                    compile_options.windows_copyright.slice()
                else
                    null,
            },
            compile_options.exec_argv.slice(),
            if (compile_options.executable_path.slice().len > 0)
                compile_options.executable_path.slice()
            else
                null,
            .{
                .disable_default_env_files = !compile_options.autoload_dotenv,
                .disable_autoload_bunfig = !compile_options.autoload_bunfig,
                .disable_autoload_tsconfig = !compile_options.autoload_tsconfig,
                .disable_autoload_package_json = !compile_options.autoload_package_json,
            },
        ) catch |err| {
            return bun.StandaloneModuleGraph.CompileResult.failFmt("{s}", .{@errorName(err)});
        };

        if (result == .success) {
            output_file.dest_path = full_outfile_path;
            output_file.is_executable = true;
        }

        // Write external sourcemap files next to the compiled executable and
        // keep them in the output array. Destroy all other non-entry-point files.
        // With --splitting, there can be multiple sourcemap files (one per chunk).
        var kept: usize = 0;
        for (output_files.items, 0..) |*current, i| {
            if (i == entry_point_index) {
                output_files.items[kept] = current.*;
                kept += 1;
            } else if (result == .success and current.output_kind == .sourcemap and current.value == .buffer) {
                const sourcemap_bytes = current.value.buffer.bytes;
                if (sourcemap_bytes.len > 0) {
                    // Derive the .map filename from the sourcemap's own dest_path,
                    // placed in the same directory as the compiled executable.
                    const map_basename = if (current.dest_path.len > 0)
                        bun.path.basename(current.dest_path)
                    else
                        bun.path.basename(bun.handleOom(std.fmt.allocPrint(bun.default_allocator, "{s}.map", .{full_outfile_path})));

                    const sourcemap_full_path = if (dirname.len == 0 or strings.eqlComptime(dirname, "."))
                        bun.handleOom(bun.default_allocator.dupe(u8, map_basename))
                    else
                        bun.handleOom(std.fmt.allocPrint(bun.default_allocator, "{s}{c}{s}", .{ dirname, std.fs.path.sep, map_basename }));

                    // Write the sourcemap file to disk next to the executable
                    var pathbuf: bun.PathBuffer = undefined;
                    const write_path = if (Environment.isWindows) sourcemap_full_path else map_basename;
                    switch (bun.jsc.Node.fs.NodeFS.writeFileWithPathBuffer(
                        &pathbuf,
                        .{
                            .data = .{ .buffer = .{
                                .buffer = .{
                                    .ptr = @constCast(sourcemap_bytes.ptr),
                                    .len = @as(u32, @truncate(sourcemap_bytes.len)),
                                    .byte_len = @as(u32, @truncate(sourcemap_bytes.len)),
                                },
                            } },
                            .encoding = .buffer,
                            .dirfd = .fromStdDir(root_dir),
                            .file = .{ .path = .{
                                .string = bun.PathString.init(write_path),
                            } },
                        },
                    )) {
                        .err => |err| {
                            bun.Output.err(err, "failed to write sourcemap file '{s}'", .{write_path});
                            current.deinit();
                        },
                        .result => {
                            current.dest_path = sourcemap_full_path;
                            output_files.items[kept] = current.*;
                            kept += 1;
                        },
                    }
                } else {
                    current.deinit();
                }
            } else {
                current.deinit();
            }
        }
        output_files.items.len = kept;

        return result;
    }

    /// Returns true if the promises were handled and resolved from BundlePlugin.ts, returns false if the caller should imediately resolve
    fn runOnEndCallbacks(globalThis: *jsc.JSGlobalObject, plugin: *bun.jsc.API.JSBundler.Plugin, promise: *jsc.JSPromise, build_result: jsc.JSValue, rejection: bun.JSError!jsc.JSValue) bun.JSError!bool {
        const value = try plugin.runOnEndCallbacks(globalThis, promise, build_result, rejection);
        return value != .js_undefined;
    }

    fn toJSError(this: *JSBundleCompletionTask, promise: *jsc.JSPromise, globalThis: *jsc.JSGlobalObject) bun.JSTerminated!void {
        const throw_on_error = this.config.throw_on_error;

        const build_result = jsc.JSValue.createEmptyObject(globalThis, 3);
        build_result.put(globalThis, jsc.ZigString.static("outputs"), jsc.JSValue.createEmptyArray(globalThis, 0) catch return promise.reject(globalThis, error.JSError));
        build_result.put(
            globalThis,
            jsc.ZigString.static("success"),
            .false,
        );
        build_result.put(
            globalThis,
            jsc.ZigString.static("logs"),
            this.log.toJSArray(globalThis, bun.default_allocator) catch |err| {
                return promise.reject(globalThis, err);
            },
        );

        const didHandleCallbacks = if (this.plugins) |plugin| blk: {
            if (throw_on_error) {
                const aggregate_error = this.log.toJSAggregateError(globalThis, bun.String.static("Bundle failed"));
                break :blk runOnEndCallbacks(globalThis, plugin, promise, build_result, aggregate_error) catch |err| {
                    return promise.reject(globalThis, err);
                };
            } else {
                break :blk runOnEndCallbacks(globalThis, plugin, promise, build_result, .js_undefined) catch |err| {
                    return promise.reject(globalThis, err);
                };
            }
        } else false;

        if (!didHandleCallbacks) {
            if (throw_on_error) {
                const aggregate_error = this.log.toJSAggregateError(globalThis, bun.String.static("Bundle failed"));
                return promise.reject(globalThis, aggregate_error);
            } else {
                return promise.resolve(globalThis, build_result);
            }
        }
    }

    pub fn onComplete(this: *JSBundleCompletionTask) bun.JSTerminated!void {
        var globalThis = this.globalThis;
        defer this.deref();

        this.poll_ref.unref(globalThis.bunVM());
        if (this.cancelled) {
            return;
        }

        if (this.html_build_task) |html_build_task| {
            this.plugins = null;
            html_build_task.onComplete(this);
            return;
        }

        const promise = this.promise.swap();

        if (this.result == .value) {
            if (this.config.compile != null) {
                var compile_result = this.doCompilation(&this.result.value.output_files);
                defer compile_result.deinit();

                if (compile_result != .success) {
                    bun.handleOom(this.log.addError(null, Logger.Loc.Empty, bun.handleOom(this.log.msgs.allocator.dupe(u8, compile_result.err.slice()))));
                    this.result.value.deinit();
                    this.result = .{ .err = error.CompilationFailed };
                }
            }
        }

        switch (this.result) {
            .pending => unreachable,
            .err => try this.toJSError(promise, globalThis),
            .value => |*build| {
                const output_files = build.output_files.items;
                const output_files_js = jsc.JSValue.createEmptyArray(globalThis, output_files.len) catch return promise.reject(globalThis, error.JSError);
                if (output_files_js == .zero) {
                    @panic("Unexpected pending JavaScript exception in JSBundleCompletionTask.onComplete. This is a bug in Bun.");
                }

                var to_assign_on_sourcemap: jsc.JSValue = .zero;
                for (output_files, 0..) |*output_file, i| {
                    const result = output_file.toJS(
                        if (!this.config.outdir.isEmpty())
                            if (std.fs.path.isAbsolute(this.config.outdir.list.items))
                                bun.default_allocator.dupe(
                                    u8,
                                    bun.path.joinAbsString(
                                        this.config.outdir.slice(),
                                        &[_]string{output_file.dest_path},
                                        .auto,
                                    ),
                                ) catch unreachable
                            else
                                bun.default_allocator.dupe(
                                    u8,
                                    bun.path.joinAbsString(
                                        bun.fs.FileSystem.instance.top_level_dir,
                                        &[_]string{ this.config.dir.slice(), this.config.outdir.slice(), output_file.dest_path },
                                        .auto,
                                    ),
                                ) catch unreachable
                        else
                            bun.default_allocator.dupe(
                                u8,
                                output_file.dest_path,
                            ) catch unreachable,
                        globalThis,
                    );
                    if (to_assign_on_sourcemap != .zero) {
                        jsc.Codegen.JSBuildArtifact.sourcemapSetCached(to_assign_on_sourcemap, globalThis, result);
                        if (to_assign_on_sourcemap.as(jsc.API.BuildArtifact)) |to_assign_on_sourcemap_artifact| {
                            to_assign_on_sourcemap_artifact.sourcemap.set(globalThis, result);
                        }
                        to_assign_on_sourcemap = .zero;
                    }

                    if (output_file.source_map_index != std.math.maxInt(u32)) {
                        to_assign_on_sourcemap = result;
                    }

                    output_files_js.putIndex(globalThis, @as(u32, @intCast(i)), result) catch |err| {
                        return promise.reject(globalThis, err);
                    };
                }
                const build_output = jsc.JSValue.createEmptyObject(globalThis, 4);
                build_output.put(globalThis, jsc.ZigString.static("outputs"), output_files_js);
                build_output.put(globalThis, jsc.ZigString.static("success"), .true);
                build_output.put(
                    globalThis,
                    jsc.ZigString.static("logs"),
                    this.log.toJSArray(globalThis, bun.default_allocator) catch |err| {
                        return promise.reject(globalThis, err);
                    },
                );

                // Add metafile if it was generated
                // metafile: { json: <lazy parsed>, markdown?: string }
                if (build.metafile) |metafile| {
                    const metafile_js_str = bun.String.createUTF8ForJS(globalThis, metafile) catch |err| {
                        return promise.reject(globalThis, err);
                    };
                    const metafile_md_str: jsc.JSValue = if (build.metafile_markdown) |md|
                        (bun.String.createUTF8ForJS(globalThis, md) catch |err| {
                            return promise.reject(globalThis, err);
                        })
                    else
                        .js_undefined;
                    // Set up metafile object with json (lazy) and markdown (if present)
                    Bun__setupLazyMetafile(globalThis, build_output, metafile_js_str, metafile_md_str);
                }

                const didHandleCallbacks = if (this.plugins) |plugin| runOnEndCallbacks(globalThis, plugin, promise, build_output, .js_undefined) catch |err| {
                    return promise.reject(globalThis, err);
                } else false;

                if (!didHandleCallbacks) {
                    return promise.resolve(globalThis, build_output);
                }
            },
        }
    }
};

extern "C" fn Bun__setupLazyMetafile(globalThis: *jsc.JSGlobalObject, buildOutput: jsc.JSValue, metafileJsonString: jsc.JSValue, metafileMarkdownString: jsc.JSValue) callconv(jsc.conv) void;

const string = []const u8;

const std = @import("std");

const bv2 = @import("../bundler/bundle_v2.zig");
const BundleThread = bv2.BundleThread;
const BundleV2 = bv2.BundleV2;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Logger = bun.logger;
const OOM = bun.OOM;
const StandaloneModuleGraph = bun.StandaloneModuleGraph;
const String = bun.String;
const jsc = bun.jsc;
const logger = bun.logger;
const options = bun.options;
const sourcemap = bun.sourcemap;
const strings = bun.strings;
const Transpiler = bun.transpiler.Transpiler;
const api = bun.schema.api;
