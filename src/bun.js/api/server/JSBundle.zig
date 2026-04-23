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

    // Check if another build (e.g. a worker's sub-build) already produced
    // output for this same (path, config). Reuse it to ensure identical
    // manifests between the server and worker.
    if (vm.bundle_sub_build_cache.lookup(this.path, this.config)) |snap| {
        defer snap.deref();
        this.populateFromCacheSnapshot(snap, global);
        this.build_state = .complete;
        return;
    }

    // The JSBundler.Config is a minimal container for entry points and
    // output dir. The actual transpiler configuration (env, defines, target,
    // minify, sourcemap, naming) is handled by configureTranspilerForBundle
    // on the BundleThread, using this.config (BundleImportConfig).
    // See src/bundler/BUNDLE_IMPORTS.md.
    var config: JSBundler.Config = .{};
    errdefer config.deinit(bun.default_allocator);
    try config.entry_points.insert(this.path);

    if (vm.transpiler.options.transform_options.serve_public_path) |public_path| {
        if (public_path.len > 0) {
            try config.public_path.appendSlice(public_path);
        }
    }

    config.css_chunking = true;

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
    completion_task.bundle_import_config = this.config;

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
            // Include ALL output files (direct + sub-build) so nested ?bundle
            // outputs are accessible through .files on the JSBundle.
            const output_files = bundle.output_files.items;

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

            for (output_files, 0..) |*output_file, file_idx| {
                var blob = bun.handleOom(output_file.toBlob(bun.default_allocator, globalThis));
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

                // Compress if configured (skip sourcemaps)
                var file_size: u64 = output_file.size_without_sourcemap;
                var encoding_str: ?[]const u8 = null;
                if (this.config.compress != null and output_file.output_kind != .sourcemap) {
                    if (compressBlob(&blob, globalThis)) |compressed| {
                        blob.deinit();
                        blob = compressed.blob;
                        file_size = compressed.size;
                        encoding_str = compressed.encoding;
                    }
                }

                const bundle_file = BundleFile.init(
                    file_name,
                    bundle_file_kind,
                    content_type,
                    file_size,
                    blob,
                    encoding_str,
                );
                const bundle_file_js = BundleFile.toJS(bundle_file, globalThis);

                // Track entrypoint — only from direct files, not sub-build outputs
                if (file_idx < bundle.direct_file_count and
                    output_file.output_kind == .@"entry-point" and
                    (output_file.loader.isJavaScriptLike() or output_file.loader == .css))
                {
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

            // Seed the VM-wide sub-build cache so other builds of the same
            // entry (e.g. a worker's sub-build) reuse this result. Also
            // check if another build already seeded the cache — if so, use
            // THAT result to ensure identical manifests regardless of build
            // order.
            const vm_cache = &globalThis.bunVM().bundle_sub_build_cache;
            if (vm_cache.lookup(this.path, this.config)) |snap| {
                // Another build (e.g. worker's sub-build) already built this
                // entry. Use its result for identical manifests.
                defer snap.deref();
                this.populateFromCacheSnapshot(snap, globalThis);
                this.build_state = .complete;
            } else {
                // First build of this entry — seed cache and use our result.
                var ep_idx: ?u32 = null;
                for (output_files, 0..) |*of, idx| {
                    if (of.output_kind == .@"entry-point") {
                        ep_idx = @intCast(idx);
                        break;
                    }
                }
                const snap = vm_cache.insert(
                    this.path,
                    this.config,
                    output_files,
                    ep_idx,
                    bundle.direct_file_count,
                ) catch null;
                if (snap) |s| s.deref();

                // Store BundleFile objects on the JSBundle
                if (files_array) |arr| {
                    this.files_value = .create(arr, globalThis);
                }
                if (entrypoint_js_value) |ep_val| {
                    this.entrypoint_value = .create(ep_val, globalThis);
                }
                this.build_state = .complete;
            }
        },
        .pending => unreachable,
    }
}

/// Populate files_value and entrypoint_value from a SubBuildCache snapshot.
/// Used when another build already produced output for this (path, config).
fn populateFromCacheSnapshot(this: *JSBundle, snap: *const bun.bundle_v2.SubBuildCache.Snapshot, globalThis: *jsc.JSGlobalObject) void {
    const output_files = snap.materialize() catch return;
    defer bun.default_allocator.free(output_files);

    // Only use direct files (not nested sub-build outputs) — same as
    // patchSubBuildExports which uses `result.output_files[0..direct_file_count]`.
    const direct_count: u32 = @min(snap.direct_file_count, @as(u32, @intCast(output_files.len)));

    // Count visible files (excluding sourcemaps etc) for array sizing
    var visible_count: u32 = 0;
    for (output_files[0..direct_count]) |*of| {
        switch (of.output_kind) {
            .sourcemap, .bytecode, .module_info => {},
            else => visible_count += 1,
        }
    }

    const files_array = jsc.JSValue.createEmptyArray(globalThis, visible_count) catch return;
    var entrypoint_js_value: ?jsc.JSValue = null;

    var actual_idx: u32 = 0;
    for (output_files[0..direct_count]) |*output_file| {
        // Skip sourcemaps/bytecode/metafiles — same as patchSubBuildExports
        switch (output_file.output_kind) {
            .sourcemap, .bytecode, .module_info, .@"metafile-json", .@"metafile-markdown" => continue,
            else => {},
        }
        var blob = bun.handleOom(output_file.toBlob(bun.default_allocator, globalThis));
        const content_type = blob.contentTypeOrMimeType() orelse
            output_file.loader.toMimeType(&.{}).value;

        var route_path = output_file.dest_path;
        if (bun.strings.hasPrefixComptime(route_path, "./") or bun.strings.hasPrefixComptime(route_path, ".\\"))
            route_path = route_path[1..];
        const file_name = if (route_path.len > 0 and route_path[0] == '/') route_path[1..] else route_path;

        const bundle_file_kind: BundleFile.OutputKind = switch (output_file.output_kind) {
            .@"entry-point" => .@"entry-point",
            .chunk => .chunk,
            .asset => .asset,
            .sourcemap => .sourcemap,
            else => .asset,
        };

        var file_size: u64 = output_file.size_without_sourcemap;
        var encoding_str: ?[]const u8 = null;
        if (this.config.compress != null and output_file.output_kind != .sourcemap) {
            if (compressBlob(&blob, globalThis)) |compressed| {
                blob.deinit();
                blob = compressed.blob;
                file_size = compressed.size;
                encoding_str = compressed.encoding;
            }
        }

        const bundle_file = BundleFile.init(file_name, bundle_file_kind, content_type, file_size, blob, encoding_str);
        const bundle_file_js = BundleFile.toJS(bundle_file, globalThis);

        if (output_file.output_kind == .@"entry-point" and
            (output_file.loader.isJavaScriptLike() or output_file.loader == .css))
        {
            entrypoint_js_value = bundle_file_js;
            var ep = output_file.dest_path;
            if (bun.strings.hasPrefixComptime(ep, "./") or bun.strings.hasPrefixComptime(ep, ".\\"))
                ep = ep[2..]
            else if (ep.len > 0 and ep[0] == '/')
                ep = ep[1..];
            if (this.actual_entrypoint) |old| bun.default_allocator.free(old);
            this.actual_entrypoint = bun.handleOom(bun.default_allocator.dupe(u8, ep));
        }

        files_array.putIndex(globalThis, actual_idx, bundle_file_js) catch {};
        actual_idx += 1;
    }

    this.files_value.deinit();
    this.files_value = .create(files_array, globalThis);
    if (entrypoint_js_value) |ep_val| {
        this.entrypoint_value.deinit();
        this.entrypoint_value = .create(ep_val, globalThis);
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
            null,
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

/// Register this JSBundle with the VM's shared incremental DevServer so it
/// participates in HMR rebuilds. Triggers an initial build and blocks the
/// event loop until that build completes.
///
/// Used by ModuleLoader for `?bundle` imports when running with `--hot`.
pub fn attachToSharedDevServer(this: *JSBundle, vm: *bun.jsc.VirtualMachine) !void {
    const dev = try vm.getOrCreateSharedDevServer();

    // Idempotent — same fn pointer for every JSBundle.
    dev.standalone_callback_fn = onDevServerBuildComplete;

    // Register this bundle as a callback context. The DevServer fires
    // `onDevServerBuildComplete` for every registered ctx after each build,
    // and the per-bundle `getFileIndex` check skips bundles whose entry
    // wasn't in the current build's graph.
    try dev.standalone_callback_ctxs.append(bun.default_allocator, @ptrCast(this));
    this.dev_server = dev;

    // Add the entry point. `addStandaloneEntryPoint` dedupes.
    _ = try dev.addStandaloneEntryPoint(this.path, this.config);

    this.build_state = .building;

    // If a build is already in flight, queue a follow-up via
    // `needs_standalone_rebuild` — `startNextBundleIfPresent` runs it after
    // the current bundle finalizes. Starting a new build here would trip
    // `assert(current_bundle == null)` in `startAsyncBundle`.
    //
    // Re-entry happens when a prior `?bundle` import is still in its spin
    // loop: ticking the event loop drives JSC microtasks that resolve more
    // ESM imports, which call back into us synchronously.
    if (dev.current_bundle == null) {
        try dev.startStandaloneBuild();
    } else {
        dev.needs_standalone_rebuild = true;
    }

    // Spin the event loop until the build completes (or fails). The build
    // dispatch is async — `finishFromBakeDevServer` calls
    // `invokeStandaloneCallback` which fires `onDevServerBuildComplete`
    // which transitions `build_state` to `.complete` or `.failed`.
    while (this.build_state == .building) {
        vm.eventLoop().tick();
    }
}

/// Called by DevServer after a build completes in standalone mode.
/// This is invoked for ALL registered JSBundles, even those whose entry
/// points may not be in the current build (e.g. during re-entrant loading
/// where multiple ?bundle imports trigger sequential builds).
pub fn onDevServerBuildComplete(ctx: *anyopaque, dev: *bun.bake.DevServer, success: bool) void {
    const this: *JSBundle = @ptrCast(@alignCast(ctx));
    if (!success) {
        // If a caller is currently waiting on `attachToSharedDevServer`'s
        // initial build, mark it failed so the spin loop exits. Subsequent
        // (post-initial) failures leave `.complete` alone — `.files` keeps
        // the previous good output until the next successful build.
        if (this.build_state == .building) {
            this.build_state = .failed;
        }
        return;
    }

    // Skip if our entry point wasn't in this build's graph. This happens
    // during re-entrant module loading when multiple ?bundle imports trigger
    // sequential builds — the callback fires for ALL registered JSBundles.
    _ = dev.client_graph.getFileIndex(this.path) orelse return;

    // Unref the previous generation's sourcemap and bump to a new generation
    if (this.source_map_generation > 0) {
        dev.source_maps.unref(this.sourceMapId());
    }
    this.source_map_generation = std.crypto.random.int(u32);

    const script_id = this.sourceMapId();
    const is_worker = if (this.config.target) |t| t == .worker else false;
    const payload = dev.generateStandaloneClientBundleForEntryPoint(this.path, script_id, is_worker) catch |err| bun.handleOom(err);
    this.updateDevEntrypoint(payload, dev);

    const globalThis = this.global;

    // CSS files are traced by generateStandaloneClientBundleForEntryPoint
    // and left in current_css_files for us to read.
    const css_ids = dev.client_graph.current_css_files.items;
    const sub_files = dev.sub_build_files;

    // Rebuild the files array: entrypoint + CSS files + sub-build files
    const total_files: u32 = 1 + @as(u32, @intCast(css_ids.len)) + @as(u32, @intCast(sub_files.count()));
    const arr = jsc.JSValue.createEmptyArray(globalThis, total_files) catch return;
    var idx: u32 = 0;

    // Entry 0 = the main JS entrypoint
    if (this.entrypoint_value.get()) |ep_js| {
        arr.putIndex(globalThis, idx, ep_js) catch {};
    }
    idx += 1;

    // CSS files from the asset store
    for (css_ids) |css_id| {
        const asset = dev.assets.get(css_id) orelse continue;
        const css_bytes = asset.blob.slice();
        if (css_bytes.len == 0) continue;

        var name_buf: [16 + ".css".len]u8 = undefined;
        const css_name = std.fmt.bufPrint(&name_buf, "{s}.css", .{
            &std.fmt.bytesToHex(std.mem.asBytes(&css_id), .lower),
        }) catch continue;

        var css_blob = jsc.WebCore.Blob.create(css_bytes, bun.default_allocator, globalThis, false);
        var css_size: u64 = @intCast(css_bytes.len);
        var css_encoding: ?[]const u8 = null;

        if (this.config.compress != null) {
            if (compressBlob(&css_blob, globalThis)) |compressed| {
                css_blob.deinit();
                css_blob = compressed.blob;
                css_size = compressed.size;
                css_encoding = compressed.encoding;
            }
        }

        const css_file = BundleFile.init(css_name, .asset, "text/css", css_size, css_blob, css_encoding);
        arr.putIndex(globalThis, idx, BundleFile.toJS(css_file, globalThis)) catch {};
        idx += 1;
    }

    // Sub-build output files (from nested ?bundle imports)
    for (sub_files.keys(), sub_files.values()) |name, file| {
        const mime = file.loader.toMimeType(&.{name}).value;
        var blob = jsc.WebCore.Blob.create(file.content, bun.default_allocator, globalThis, false);
        var file_size: u64 = @intCast(file.content.len);
        var encoding: ?[]const u8 = null;

        if (this.config.compress != null) {
            if (compressBlob(&blob, globalThis)) |compressed| {
                blob.deinit();
                blob = compressed.blob;
                file_size = compressed.size;
                encoding = compressed.encoding;
            }
        }

        const bundle_file = BundleFile.init(name, .chunk, mime, file_size, blob, encoding);
        arr.putIndex(globalThis, idx, BundleFile.toJS(bundle_file, globalThis)) catch {};
        idx += 1;
    }

    this.files_value.deinit();
    this.files_value = .create(arr, globalThis);
}

const CompressResult = struct {
    blob: jsc.WebCore.Blob,
    size: u64,
    encoding: []const u8,
};

/// Gzip-compress a blob's content. Returns null if compression fails or input is empty.
fn compressGzip(input: []const u8) ?[]u8 {
    if (input.len == 0) return null;
    const compressor = bun.libdeflate.Compressor.alloc(6) orelse return null;
    defer compressor.deinit();
    const max_size = compressor.maxBytesNeeded(input, .gzip);
    const output = bun.default_allocator.alloc(u8, max_size) catch return null;
    const result = compressor.gzip(input, output);
    if (result.written == 0) {
        bun.default_allocator.free(output);
        return null;
    }
    return bun.default_allocator.realloc(output, result.written) catch output[0..result.written];
}

/// Compress a blob's content using gzip. Returns a new blob with compressed
/// content, or null if compression fails. Caller must deinit the old blob
/// if this returns non-null.
fn compressBlob(blob: *const jsc.WebCore.Blob, globalThis: *JSGlobalObject) ?CompressResult {
    const input = blob.sharedView();
    const compressed = compressGzip(input) orelse return null;
    return .{
        .blob = jsc.WebCore.Blob.create(compressed, bun.default_allocator, globalThis, false),
        .size = @intCast(compressed.len),
        .encoding = "gzip",
    };
}

const debug = bun.Output.scoped(.JSBundle, .hidden);

const BundleFile = @import("./BundleFile.zig");
const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
const libdeflate = bun.libdeflate;

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
