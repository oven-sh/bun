//! This object is a description of a JS/TS bundle. It is created by importing a
//! JS/TS file with `{ type: "bundle" }`. The bundle is built at import time: in
//! dev mode a DevServer handles building + HMR, in prod mode a one-shot BundleV2
//! build produces static output files. The resulting files are available via the
//! `.files` and `.entrypoint` properties without needing `Bun.serve()`.
pub const JSBundle = @This();
pub const js = jsc.Codegen.JSJSBundle;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

/// JSBundle can be owned by JavaScript as well as any number of Server instances.
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,
global: *JSGlobalObject,
path: []const u8,
/// Actual entrypoint path determined after build (e.g., "/index.js").
/// null before the build completes.
actual_entrypoint: ?[]const u8 = null,
/// Cached JS array of BundleFile objects, populated after build.
files_value: jsc.Strong.Optional = .empty,
/// Cached entrypoint BundleFile JS value.
entrypoint_value: jsc.Strong.Optional = .empty,
/// Per-bundle config from import attributes (splitting, minify, sourcemap).
config: BundleImportConfig = .{},
/// Shared DevServer when running with --hot. Set at import time.
dev_server: ?*bun.bake.DevServer = null,
/// Generation counter for source map keys (mirrors RouteBundle.client_script_generation).
source_map_generation: u32 = 0,
/// Tracks progress of the build triggered by build().
build_state: enum { idle, building, complete, failed } = .idle,

/// Initialize a JSBundle given a path and optional config from import attributes.
pub fn init(global: *JSGlobalObject, path: []const u8, bundle_config: ?BundleImportConfig) !*JSBundle {
    return bun.new(JSBundle, .{
        .ref_count = .init(),
        .global = global,
        .path = try bun.default_allocator.dupe(u8, path),
        .config = bundle_config orelse .{},
    });
}

pub fn finalize(this: *JSBundle) void {
    this.deref();
}

fn deinit(this: *JSBundle) void {
    if (this.dev_server) |dev| {
        if (this.source_map_generation > 0) {
            dev.source_maps.unref(this.sourceMapId());
        }
        dev.removeStandaloneCallbackCtx(@ptrCast(this));
        this.dev_server = null;
    }
    if (this.actual_entrypoint) |ep| bun.default_allocator.free(ep);
    this.files_value.deinit();
    this.entrypoint_value.deinit();
    bun.default_allocator.free(this.path);
    bun.destroy(this);
}

/// Returns the entrypoint BundleFile after build, or undefined before build.
pub fn getEntrypoint(this: *JSBundle, _: *JSGlobalObject) bun.JSError!JSValue {
    if (this.entrypoint_value.get()) |v| return v;
    return .js_undefined;
}

/// Returns the list of BundleFile objects after build, or an empty array before build.
pub fn getFiles(this: *JSBundle, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    if (this.files_value.get()) |v| return v;
    // Return empty array before build completes
    const array = try jsc.JSValue.createEmptyArray(globalObject, 0);
    return array;
}

/// Build the bundle immediately, blocking until complete.
/// Called at import time for non-hot mode.
pub fn build(this: *JSBundle) !void {
    const global = this.global;
    const vm = global.bunVM();

    var config: JSBundler.Config = .{};
    errdefer config.deinit(bun.default_allocator);
    try config.entry_points.insert(this.path);

    if (vm.transpiler.options.transform_options.serve_public_path) |public_path| {
        if (public_path.len > 0) {
            try config.public_path.appendSlice(public_path);
        } else {
            try config.public_path.appendChar('/');
        }
    } else {
        try config.public_path.appendChar('/');
    }

    if (vm.transpiler.options.transform_options.serve_env_behavior != ._none) {
        config.env_behavior = vm.transpiler.options.transform_options.serve_env_behavior;
        if (config.env_behavior == .prefix) {
            try config.env_prefix.appendSlice(vm.transpiler.options.transform_options.serve_env_prefix orelse "");
        }
    }

    if (vm.transpiler.options.transform_options.serve_splitting) {
        config.code_splitting = vm.transpiler.options.transform_options.serve_splitting;
    }

    config.target = .browser;

    if (bun.cli.Command.get().args.serve_minify_identifiers) |minify_identifiers| {
        config.minify.identifiers = minify_identifiers;
    }
    if (bun.cli.Command.get().args.serve_minify_whitespace) |minify_whitespace| {
        config.minify.whitespace = minify_whitespace;
    }
    if (bun.cli.Command.get().args.serve_minify_syntax) |minify_syntax| {
        config.minify.syntax = minify_syntax;
    }

    if (bun.cli.Command.get().args.serve_define) |define| {
        bun.assert(define.keys.len == define.values.len);
        try config.define.map.ensureUnusedCapacity(define.keys.len);
        config.define.map.unmanaged.entries.len = define.keys.len;
        @memcpy(config.define.map.keys(), define.keys);
        for (config.define.map.values(), define.values) |*to, from| {
            to.* = bun.handleOom(config.define.map.allocator.dupe(u8, from));
        }
        try config.define.map.reIndex();
    }

    config.source_map = .linked;

    // Apply per-bundle config overrides from import attributes
    if (this.config.splitting) |s| config.code_splitting = s;
    if (this.config.minify) |m| {
        config.minify.syntax = m;
        config.minify.whitespace = m;
        config.minify.identifiers = m;
    }
    if (this.config.sourcemap) |s| config.source_map = s;
    if (this.config.target) |t| config.target = t;
    if (this.config.format) |f| config.format = f;
    if (this.config.naming) |n| {
        try config.names.owned_entry_point.appendSliceExact(n);
        config.names.entry_point.data = config.names.owned_entry_point.list.items;
        try config.names.owned_chunk.appendSliceExact(n);
        config.names.chunk.data = config.names.owned_chunk.list.items;
    }

    // Load plugins if configured
    var plugins: ?*jsc.API.JSBundler.Plugin = null;
    if (vm.transpiler.options.serve_plugins) |serve_plugins_config| {
        if (serve_plugins_config.len > 0) {
            plugins = jsc.API.JSBundler.Plugin.create(global, .browser);
            const bunfig_folder = bun.path.dirname(vm.transpiler.options.bunfig_path, .auto);
            var sfb = std.heap.stackFallback(@sizeOf(bun.String) * 4, bun.default_allocator);
            const alloc = sfb.get();
            const bunstring_array = bun.handleOom(alloc.alloc(bun.String, serve_plugins_config.len));
            defer alloc.free(bunstring_array);
            for (serve_plugins_config, bunstring_array) |raw_plugin, *out| {
                out.* = bun.String.init(raw_plugin);
            }
            const plugin_js_array = try bun.String.toJSArray(global, bunstring_array);
            const bunfig_folder_bunstr = try bun.String.createUTF8ForJS(global, bunfig_folder);

            vm.eventLoop().enter();
            const result = try bun.jsc.fromJSHostCall(global, @src(), JSBundlerPlugin__loadAndResolvePluginsForServe, .{ plugins.?, plugin_js_array, bunfig_folder_bunstr });
            vm.eventLoop().exit();

            if (global.tryTakeException()) |_| {
                plugins = null;
            } else if (!result.isEmptyOrUndefinedOrNull()) {
                if (result.asAnyPromise()) |promise| {
                    // Spin event loop until the promise resolves
                    while (promise.status() == .pending) {
                        vm.eventLoop().tick();
                    }
                    if (promise.status() == .rejected) {
                        plugins = null;
                    }
                } else if (result.toError()) |_| {
                    plugins = null;
                }
            }
        }
    }

    const completion_task = try bun.BundleV2.createAndScheduleCompletionTask(
        config,
        plugins,
        global,
        vm.eventLoop(),
        bun.default_allocator,
    );
    completion_task.started_at_ns = bun.getRoughTickCount(.allow_mocked_time).ns();
    completion_task.js_bundle_owner = this;

    // Keep a reference while building
    this.ref();
    this.build_state = .building;

    // Hold an extra ref on the completion task so we can safely check
    // its result after onComplete runs (which does defer deref).
    completion_task.ref();
    defer completion_task.deref();

    // Spin event loop until our onBuildComplete callback fires
    while (this.build_state == .building) {
        vm.eventLoop().tick();
    }
}

/// Called when a production BundleV2 build completes.
/// Populates files_value and entrypoint_value on the JSBundle.
pub fn onBuildComplete(this: *JSBundle, completion_task: *bun.BundleV2.JSBundleCompletionTask) void {
    defer this.deref();

    switch (completion_task.result) {
        .err => |err| {
            if (bun.Environment.enable_logs)
                debug("onBuildComplete: err - {s}", .{@errorName(err)});

            this.build_state = .failed;

            // Log errors to stderr
            switch (bun.Output.enable_ansi_colors_stderr) {
                inline else => |enable_ansi_colors| {
                    const writer = bun.Output.errorWriterBuffered();
                    completion_task.log.printWithEnableAnsiColors(writer, enable_ansi_colors) catch {};
                    writer.flush() catch {};
                },
            }
        },
        .value => |bundle| {
            if (bun.Environment.enable_logs)
                debug("onBuildComplete: success", .{});

            const globalThis = this.global;
            // Only expose this bundle's own direct files, not nested sub-build outputs
            const output_files = bundle.output_files.items[0..bundle.direct_file_count];

            // Log timing info
            const now = bun.getRoughTickCount(.allow_mocked_time).ns();
            const duration = now - completion_task.started_at_ns;
            var duration_f64: f64 = @floatFromInt(duration);
            duration_f64 /= std.time.ns_per_s;

            bun.Output.printElapsed(duration_f64);
            var byte_length: u64 = 0;
            for (output_files) |*output_file| {
                byte_length += output_file.size_without_sourcemap;
            }
            bun.Output.prettyErrorln(" <green>bundle<r> {s} <d>{d:.2} KB<r>", .{ std.fs.path.basename(this.path), @as(f64, @floatFromInt(byte_length)) / 1000.0 });
            bun.Output.flush();

            // Create BundleFile objects for each output file
            const files_array = jsc.JSValue.createEmptyArray(globalThis, output_files.len) catch null;
            var bundle_file_index: u32 = 0;
            var entrypoint_js_value: ?JSValue = null;

            for (output_files) |*output_file| {
                const blob = bun.handleOom(output_file.toBlob(bun.default_allocator, globalThis));
                const content_type = blob.contentTypeOrMimeType() orelse brk: {
                    bun.debugAssert(false);
                    break :brk output_file.loader.toMimeType(&.{}).value;
                };

                var route_path = output_file.dest_path;
                if (strings.hasPrefixComptime(route_path, "./") or strings.hasPrefixComptime(route_path, ".\\")) {
                    route_path = route_path[1..];
                }

                const file_name = if (route_path.len > 0 and route_path[0] == '/') route_path[1..] else route_path;
                const bundle_file_kind: BundleFile.OutputKind = switch (output_file.output_kind) {
                    .@"entry-point" => .@"entry-point",
                    .chunk => .chunk,
                    .asset => .asset,
                    .sourcemap => .sourcemap,
                    else => .asset,
                };
                const bundle_file = BundleFile.init(
                    file_name,
                    bundle_file_kind,
                    content_type,
                    output_file.size_without_sourcemap,
                    blob,
                );
                const bundle_file_js = BundleFile.toJS(bundle_file, globalThis);

                // Track entrypoint
                if (output_file.output_kind == .@"entry-point" and (output_file.loader.isJavaScriptLike() or output_file.loader == .css)) {
                    entrypoint_js_value = bundle_file_js;

                    // Set actual entrypoint path
                    var ep = output_file.dest_path;
                    if (strings.hasPrefixComptime(ep, "./") or strings.hasPrefixComptime(ep, ".\\")) {
                        ep = ep[2..];
                    } else if (ep.len > 0 and ep[0] == '/') {
                        ep = ep[1..];
                    }
                    if (this.actual_entrypoint) |old| bun.default_allocator.free(old);
                    this.actual_entrypoint = bun.handleOom(bun.default_allocator.dupe(u8, ep));
                }

                // Add to files array
                if (files_array) |arr| {
                    arr.putIndex(globalThis, bundle_file_index, bundle_file_js) catch {};
                }
                bundle_file_index += 1;
            }

            // Store BundleFile objects on the JSBundle
            if (files_array) |arr| {
                this.files_value = .create(arr, globalThis);
            }
            if (entrypoint_js_value) |ep_val| {
                this.entrypoint_value = .create(ep_val, globalThis);
            }

            this.build_state = .complete;
        },
        .pending => unreachable,
    }
}

/// Set actual_entrypoint from the source path in dev mode.
/// Creates BundleFile objects for the dev entrypoint.
pub fn updateDevEntrypoint(this: *JSBundle, payload: []const u8, _: *bun.bake.DevServer) void {
    const base = bun.path.basename(this.path);
    const dot_pos = std.mem.lastIndexOfScalar(u8, base, '.') orelse base.len;
    const name = base[0..dot_pos];
    var buf: [512]u8 = undefined;
    const ep = std.fmt.bufPrint(&buf, "{s}.js", .{name}) catch return;
    if (this.actual_entrypoint) |old| bun.default_allocator.free(old);
    this.actual_entrypoint = bun.handleOom(bun.default_allocator.dupe(u8, ep));

    const globalThis = this.global;
    var blob: jsc.WebCore.Blob = undefined;
    var file_size: u64 = 0;
    const content_type: []const u8 = "application/javascript";

    if (payload.len > 0) {
        file_size = @intCast(payload.len);
        blob = jsc.WebCore.Blob.create(payload, bun.default_allocator, globalThis, false);
    } else {
        blob = jsc.WebCore.Blob.initEmpty(globalThis);
    }

    if (this.entrypoint_value.get()) |existing_js| {
        // Reuse existing BundleFile — update blob in-place so JS references stay stable
        if (BundleFile.fromJSDirect(existing_js)) |existing| {
            existing.updateBlob(blob, file_size);
        }
    } else {
        // First build — create new BundleFile and array objects
        const bundle_file = BundleFile.init(
            ep,
            .@"entry-point",
            content_type,
            file_size,
            blob,
        );
        const bundle_file_js = BundleFile.toJS(bundle_file, globalThis);
        this.entrypoint_value = .create(bundle_file_js, globalThis);

        // files = [entrypoint]
        if (jsc.JSValue.createEmptyArray(globalThis, 1)) |arr| {
            arr.putIndex(globalThis, 0, bundle_file_js) catch {};
            this.files_value = .create(arr, globalThis);
        } else |_| {}
    }

    this.build_state = .complete;
}

pub fn sourceMapId(this: *const JSBundle) bun.bake.DevServer.SourceMapStore.Key {
    return .init(@as(u64, this.source_map_generation) << 32);
}

/// Called by DevServer after a build completes in standalone mode.
pub fn onDevServerBuildComplete(ctx: *anyopaque, dev: *bun.bake.DevServer, success: bool) void {
    const this: *JSBundle = @ptrCast(@alignCast(ctx));
    if (!success) return;

    // Unref the previous generation's sourcemap and bump to a new generation
    if (this.source_map_generation > 0) {
        dev.source_maps.unref(this.sourceMapId());
    }
    this.source_map_generation = std.crypto.random.int(u32);

    const script_id = this.sourceMapId();
    const payload = dev.generateStandaloneClientBundleForEntryPoint(this.path, script_id) catch |err| bun.handleOom(err);
    this.updateDevEntrypoint(payload, dev);
}

const debug = bun.Output.scoped(.JSBundle, .hidden);

const BundleFile = @import("./BundleFile.zig");
const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const JSBundler = jsc.API.JSBundler;
const BundleImportConfig = bun.ImportRecord.BundleImportConfig;

extern fn JSBundlerPlugin__loadAndResolvePluginsForServe(
    plugin: *jsc.API.JSBundler.Plugin,
    plugins: JSValue,
    bunfig_folder: JSValue,
) JSValue;
