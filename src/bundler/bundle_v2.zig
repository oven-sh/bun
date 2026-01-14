// This is Bun's JavaScript/TypeScript transpiler
//
// A lot of the implementation is based on the Go implementation of esbuild. Thank you Evan Wallace.
//
// # Memory management
//
// Zig is not a managed language, so we have to be careful about memory management.
// Manually freeing memory is error-prone and tedious, but garbage collection
// is slow and reference counting incurs a performance penalty.
//
// Bun's bundler relies on mimalloc's threadlocal heaps as arena allocators.
//
// When a new thread is spawned for a bundling job, it is given a threadlocal
// heap and all allocations are done on that heap. When the job is done, the
// threadlocal heap is destroyed and all memory is freed.
//
// There are a few careful gotchas to keep in mind:
//
// - A threadlocal heap cannot allocate memory on a different thread than the one that
//  created it. You will get a segfault if you try to do that.
//
// - Since the heaps are destroyed at the end of bundling, any globally shared
//   references to data must NOT be allocated on a threadlocal heap.
//
//   For example, package.json and tsconfig.json read from the filesystem must be
//   use the global allocator (bun.default_allocator) because bun's directory
//   entry cache and module resolution cache are globally shared across all
//   threads.
//
//   Additionally, `LinkerContext`'s allocator is also threadlocal.
//
// - Globally allocated data must be in a cache & reused, or we will create an infinite
//   memory leak over time. To do that, we have a DirnameStore, FilenameStore, and the other
//   data structures related to `BSSMap`. This still leaks memory, but not very
//   much since it only allocates the first time around.
//
//
// In development, it is strongly recommended to use either a debug build of
// mimalloc or Valgrind to help catch memory issues
// To use a debug build of mimalloc:
//
//     make mimalloc-debug
//

pub const logPartDependencyTree = Output.scoped(.part_dep_tree, .visible);

pub const MangledProps = std.AutoArrayHashMapUnmanaged(Ref, []const u8);
pub const PathToSourceIndexMap = @import("./PathToSourceIndexMap.zig");

pub const Watcher = bun.jsc.hot_reloader.NewHotReloader(BundleV2, EventLoop, true);

/// This assigns a concise, predictable, and unique `.pretty` attribute to a Path.
/// DevServer relies on pretty paths for identifying modules, so they must be unique.
pub fn genericPathWithPrettyInitialized(path: Fs.Path, target: options.Target, top_level_dir: string, allocator: std.mem.Allocator) !Fs.Path {
    const buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(buf);

    const is_node = bun.strings.eqlComptime(path.namespace, "node");
    if (is_node and
        (bun.strings.hasPrefixComptime(path.text, NodeFallbackModules.import_path) or
            !std.fs.path.isAbsolute(path.text)))
    {
        return path;
    }

    // "file" namespace should use the relative file path for its display name.
    // the "node" namespace is also put through this code path so that the
    // "node:" prefix is not emitted.
    if (path.isFile() or is_node) {
        const buf2 = if (target == .bake_server_components_ssr) bun.path_buffer_pool.get() else buf;
        defer if (target == .bake_server_components_ssr) bun.path_buffer_pool.put(buf2);
        const rel = bun.path.relativePlatformBuf(buf2, top_level_dir, path.text, .loose, false);
        var path_clone = path;
        // stack-allocated temporary is not leaked because dupeAlloc on the path will
        // move .pretty into the heap. that function also fixes some slash issues.
        if (target == .bake_server_components_ssr) {
            // the SSR graph needs different pretty names or else HMR mode will
            // confuse the two modules.
            path_clone.pretty = std.fmt.bufPrint(buf, "ssr:{s}", .{rel}) catch buf[0..];
        } else {
            path_clone.pretty = rel;
        }
        return path_clone.dupeAllocFixPretty(allocator);
    } else {
        // in non-file namespaces, standard filesystem rules do not apply.
        var path_clone = path;
        path_clone.pretty = std.fmt.bufPrint(buf, "{s}{f}:{s}", .{
            if (target == .bake_server_components_ssr) "ssr:" else "",
            // make sure that a namespace including a colon wont collide with anything
            std.fmt.Alt([]const u8, fmtEscapedNamespace){ .data = path.namespace },
            path.text,
        }) catch buf[0..];
        return path_clone.dupeAllocFixPretty(allocator);
    }
}

fn fmtEscapedNamespace(slice: []const u8, w: *std.Io.Writer) !void {
    var rest = slice;
    while (bun.strings.indexOfChar(rest, ':')) |i| {
        try w.writeAll(rest[0..i]);
        try w.writeAll("::");
        rest = rest[i + 1 ..];
    }
    try w.writeAll(rest);
}

pub const BundleV2 = struct {
    transpiler: *Transpiler,
    /// When Server Component is enabled, this is used for the client bundles
    /// and `transpiler` is used for the server bundles.
    client_transpiler: ?*Transpiler,
    /// See bake.Framework.ServerComponents.separate_ssr_graph
    ssr_transpiler: *Transpiler,
    /// When Bun Bake is used, the resolved framework is passed here
    framework: ?bake.Framework,
    graph: Graph,
    linker: LinkerContext,
    bun_watcher: ?*bun.Watcher,
    plugins: ?*jsc.API.JSBundler.Plugin,
    completion: ?*JSBundleCompletionTask,
    /// In-memory files that can be used as entrypoints or imported.
    /// This is a pointer to the FileMap in the completion config.
    file_map: ?*const jsc.API.JSBundler.FileMap,
    source_code_length: usize,

    /// There is a race condition where an onResolve plugin may schedule a task on the bundle thread before it's parsing task completes
    resolve_tasks_waiting_for_import_source_index: std.AutoArrayHashMapUnmanaged(Index.Int, BabyList(struct { to_source_index: Index, import_record_index: u32 })) = .{},

    /// Allocations not tracked by a threadlocal heap
    free_list: std.array_list.Managed([]const u8) = std.array_list.Managed([]const u8).init(bun.default_allocator),

    /// See the comment in `Chunk.OutputPiece`
    unique_key: u64 = 0,
    dynamic_import_entry_points: std.AutoArrayHashMap(Index.Int, void) = undefined,
    has_on_parse_plugins: bool = false,

    finalizers: std.ArrayListUnmanaged(CacheEntry.ExternalFreeFunction) = .{},

    drain_defer_task: DeferredBatchTask = .{},

    /// Set true by DevServer. Currently every usage of the transpiler (Bun.build
    /// and `bun build` cli) runs at the top of an event loop. When this is
    /// true, a callback is executed after all work is complete.
    ///
    /// You can find which callbacks are run by looking at the
    /// `finishFromBakeDevServer(...)` function here
    asynchronous: bool = false,
    thread_lock: bun.safety.ThreadLock,

    // if false we can skip TLA validation and propagation
    has_any_top_level_await_modules: bool = false,

    const BakeOptions = struct {
        framework: bake.Framework,
        client_transpiler: *Transpiler,
        ssr_transpiler: *Transpiler,
        plugins: ?*jsc.API.JSBundler.Plugin,
    };

    const debug = Output.scoped(.Bundle, .visible);

    pub inline fn loop(this: *BundleV2) *EventLoop {
        return &this.linker.loop;
    }

    /// Returns the jsc.EventLoop where plugin callbacks can be queued up on
    pub fn jsLoopForPlugins(this: *BundleV2) *jsc.EventLoop {
        bun.assert(this.plugins != null);
        if (this.completion) |completion|
            // From Bun.build
            return completion.jsc_event_loop
        else switch (this.loop().*) {
            // From bake where the loop running the bundle is also the loop
            // running the plugins.
            .js => |jsc_event_loop| return jsc_event_loop,
            // The CLI currently has no jsc event loop; for now, no plugin support
            .mini => @panic("No JavaScript event loop for transpiler plugins to run on"),
        }
    }

    fn ensureClientTranspiler(this: *BundleV2) void {
        if (this.client_transpiler == null) {
            _ = this.initializeClientTranspiler() catch |e| {
                std.debug.panic("Failed to initialize client transpiler: {s}", .{@errorName(e)});
            };
        }
    }

    fn initializeClientTranspiler(this: *BundleV2) !*Transpiler {
        @branchHint(.cold);
        const alloc = this.allocator();

        const this_transpiler = this.transpiler;
        const client_transpiler = try alloc.create(Transpiler);
        client_transpiler.* = this_transpiler.*;
        client_transpiler.options = this_transpiler.options;

        client_transpiler.options.target = .browser;
        client_transpiler.options.main_fields = options.Target.DefaultMainFields.get(options.Target.browser);
        client_transpiler.options.conditions = try options.ESMConditions.init(
            alloc,
            options.Target.browser.defaultConditions(),
            false,
            &.{},
        );

        // We need to make sure it has [hash] in the names so we don't get conflicts.
        if (this_transpiler.options.compile) {
            client_transpiler.options.asset_naming = bun.options.PathTemplate.asset.data;
            client_transpiler.options.chunk_naming = bun.options.PathTemplate.chunk.data;
            client_transpiler.options.entry_naming = "./[name]-[hash].[ext]";

            // Avoid setting a public path for --compile since all the assets
            // will be served relative to the server root.
            client_transpiler.options.public_path = "";
        }

        client_transpiler.setLog(this_transpiler.log);
        client_transpiler.setAllocator(alloc);
        client_transpiler.linker.resolver = &client_transpiler.resolver;
        client_transpiler.macro_context = js_ast.Macro.MacroContext.init(client_transpiler);
        const CacheSet = @import("../cache.zig");
        client_transpiler.resolver.caches = CacheSet.Set.init(alloc);

        try client_transpiler.configureDefines();
        client_transpiler.resolver.opts = client_transpiler.options;
        client_transpiler.resolver.env_loader = client_transpiler.env;
        this.client_transpiler = client_transpiler;
        return client_transpiler;
    }

    /// Most of the time, accessing .transpiler directly is OK. This is only
    /// needed when it is important to distinct between client and server
    ///
    /// Note that .log, .allocator, and other things are shared
    /// between the three transpiler configurations
    pub inline fn transpilerForTarget(noalias this: *BundleV2, target: options.Target) *Transpiler {
        if (!this.transpiler.options.server_components and this.linker.dev_server == null) {
            if (target == .browser and this.transpiler.options.target.isServerSide()) {
                return this.client_transpiler orelse this.initializeClientTranspiler() catch |e| {
                    std.debug.panic("Failed to initialize client transpiler: {s}", .{@errorName(e)});
                };
            }

            return this.transpiler;
        }

        return switch (target) {
            else => this.transpiler,
            .browser => this.client_transpiler.?,
            .bake_server_components_ssr => this.ssr_transpiler,
        };
    }

    /// By calling this function, it implies that the returned log *will* be
    /// written to. For DevServer, this allocates a per-file log for the sources
    /// it is called on. Function must be called on the bundle thread.
    pub fn logForResolutionFailures(this: *BundleV2, abs_path: []const u8, bake_graph: bake.Graph) *bun.logger.Log {
        if (this.transpiler.options.dev_server) |dev| {
            return bun.handleOom(dev.getLogForResolutionFailures(abs_path, bake_graph));
        }
        return this.transpiler.log;
    }

    pub inline fn pathToSourceIndexMap(this: *BundleV2, target: options.Target) *PathToSourceIndexMap {
        return this.graph.pathToSourceIndexMap(target);
    }

    const ReachableFileVisitor = struct {
        reachable: std.array_list.Managed(Index),
        visited: bun.bit_set.DynamicBitSet,
        all_import_records: []ImportRecord.List,
        all_loaders: []const Loader,
        all_urls_for_css: []const []const u8,
        redirects: []u32,
        redirect_map: PathToSourceIndexMap,
        dynamic_import_entry_points: *std.AutoArrayHashMap(Index.Int, void),
        /// Files which are Server Component Boundaries
        scb_bitset: ?bun.bit_set.DynamicBitSetUnmanaged,
        scb_list: ServerComponentBoundary.List.Slice,

        /// Files which are imported by JS and inlined in CSS
        additional_files_imported_by_js_and_inlined_in_css: *bun.bit_set.DynamicBitSetUnmanaged,
        /// Files which are imported by CSS and inlined in CSS
        additional_files_imported_by_css_and_inlined: *bun.bit_set.DynamicBitSetUnmanaged,

        const MAX_REDIRECTS: usize = 64;

        // Find all files reachable from all entry points. This order should be
        // deterministic given that the entry point order is deterministic, since the
        // returned order is the postorder of the graph traversal and import record
        // order within a given file is deterministic.
        pub fn visit(v: *@This(), source_index: Index, was_dynamic_import: bool, comptime check_dynamic_imports: bool) void {
            if (source_index.isInvalid()) return;

            if (v.visited.isSet(source_index.get())) {
                if (comptime check_dynamic_imports) {
                    if (was_dynamic_import) {
                        v.dynamic_import_entry_points.put(source_index.get(), {}) catch unreachable;
                    }
                }
                return;
            }
            v.visited.set(source_index.get());

            if (v.scb_bitset) |scb_bitset| {
                if (scb_bitset.isSet(source_index.get())) {
                    const scb_index = v.scb_list.getIndex(source_index.get()) orelse unreachable;
                    v.visit(Index.init(v.scb_list.list.items(.reference_source_index)[scb_index]), false, check_dynamic_imports);
                    v.visit(Index.init(v.scb_list.list.items(.ssr_source_index)[scb_index]), false, check_dynamic_imports);
                }
            }

            const is_js = v.all_loaders[source_index.get()].isJavaScriptLike();
            const is_css = v.all_loaders[source_index.get()].isCSS();

            const import_record_list_id = source_index;
            // when there are no import records, v index will be invalid
            if (import_record_list_id.get() < v.all_import_records.len) {
                const import_records = v.all_import_records[import_record_list_id.get()].slice();
                for (import_records) |*import_record| {
                    var other_source = import_record.source_index;
                    if (other_source.isValid()) {
                        var redirect_count: usize = 0;
                        while (getRedirectId(v.redirects[other_source.get()])) |redirect_id| : (redirect_count += 1) {
                            var other_import_records = v.all_import_records[other_source.get()].slice();
                            const other_import_record = &other_import_records[redirect_id];
                            import_record.source_index = other_import_record.source_index;
                            import_record.path = other_import_record.path;
                            other_source = other_import_record.source_index;
                            if (redirect_count == MAX_REDIRECTS) {
                                import_record.path.is_disabled = true;
                                import_record.source_index = Index.invalid;
                                break;
                            }

                            // Handle redirects to a builtin or external module
                            // https://github.com/oven-sh/bun/issues/3764
                            if (!other_source.isValid()) {
                                break;
                            }
                        }

                        // Mark if the file is imported by JS and its URL is inlined for CSS
                        const is_inlined = import_record.source_index.isValid() and v.all_urls_for_css[import_record.source_index.get()].len > 0;
                        if (is_js and is_inlined) {
                            v.additional_files_imported_by_js_and_inlined_in_css.set(import_record.source_index.get());
                        } else if (is_css and is_inlined) {
                            v.additional_files_imported_by_css_and_inlined.set(import_record.source_index.get());
                        }

                        v.visit(import_record.source_index, check_dynamic_imports and import_record.kind == .dynamic, check_dynamic_imports);
                    }
                }

                // Redirects replace the source file with another file
                if (getRedirectId(v.redirects[source_index.get()])) |redirect_id| {
                    const redirect_source_index = v.all_import_records[source_index.get()].slice()[redirect_id].source_index.get();
                    v.visit(Index.source(redirect_source_index), was_dynamic_import, check_dynamic_imports);
                    return;
                }
            }

            // Each file must come after its dependencies
            v.reachable.append(source_index) catch unreachable;
            if (comptime check_dynamic_imports) {
                if (was_dynamic_import) {
                    v.dynamic_import_entry_points.put(source_index.get(), {}) catch unreachable;
                }
            }
        }
    };

    pub fn findReachableFiles(this: *BundleV2) ![]Index {
        const trace = bun.perf.trace("Bundler.findReachableFiles");
        defer trace.end();

        // Create a quick index for server-component boundaries.
        // We need to mark the generated files as reachable, or else many files will appear missing.
        var sfa = std.heap.stackFallback(4096, this.allocator());
        const stack_alloc = sfa.get();
        var scb_bitset = if (this.graph.server_component_boundaries.list.len > 0)
            try this.graph.server_component_boundaries.slice().bitSet(stack_alloc, this.graph.input_files.len)
        else
            null;
        defer if (scb_bitset) |*b| b.deinit(stack_alloc);

        var additional_files_imported_by_js_and_inlined_in_css = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(stack_alloc, this.graph.input_files.len);
        var additional_files_imported_by_css_and_inlined = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(stack_alloc, this.graph.input_files.len);
        defer {
            additional_files_imported_by_js_and_inlined_in_css.deinit(stack_alloc);
            additional_files_imported_by_css_and_inlined.deinit(stack_alloc);
        }

        this.dynamic_import_entry_points = std.AutoArrayHashMap(Index.Int, void).init(this.allocator());

        const all_urls_for_css = this.graph.ast.items(.url_for_css);

        var visitor = ReachableFileVisitor{
            .reachable = try std.array_list.Managed(Index).initCapacity(this.allocator(), this.graph.entry_points.items.len + 1),
            .visited = try bun.bit_set.DynamicBitSet.initEmpty(this.allocator(), this.graph.input_files.len),
            .redirects = this.graph.ast.items(.redirect_import_record_index),
            .all_import_records = this.graph.ast.items(.import_records),
            .all_loaders = this.graph.input_files.items(.loader),
            .all_urls_for_css = all_urls_for_css,
            .redirect_map = this.pathToSourceIndexMap(this.transpiler.options.target).*,
            .dynamic_import_entry_points = &this.dynamic_import_entry_points,
            .scb_bitset = scb_bitset,
            .scb_list = if (scb_bitset != null)
                this.graph.server_component_boundaries.slice()
            else
                undefined, // will never be read since the above bitset is `null`
            .additional_files_imported_by_js_and_inlined_in_css = &additional_files_imported_by_js_and_inlined_in_css,
            .additional_files_imported_by_css_and_inlined = &additional_files_imported_by_css_and_inlined,
        };
        defer visitor.visited.deinit();

        // If we don't include the runtime, __toESM or __toCommonJS will not get
        // imported and weird things will happen
        visitor.visit(Index.runtime, false, false);

        switch (this.transpiler.options.code_splitting) {
            inline else => |check_dynamic_imports| {
                for (this.graph.entry_points.items) |entry_point| {
                    visitor.visit(entry_point, false, comptime check_dynamic_imports);
                }
            },
        }

        const DebugLog = bun.Output.Scoped(.ReachableFiles, .visible);
        if (DebugLog.isVisible()) {
            DebugLog.log("Reachable count: {d} / {d}", .{ visitor.reachable.items.len, this.graph.input_files.len });
            const sources: []Logger.Source = this.graph.input_files.items(.source);
            const targets: []options.Target = this.graph.ast.items(.target);
            for (visitor.reachable.items) |idx| {
                const source = sources[idx.get()];
                DebugLog.log("reachable file: #{d} {f} ({s}) target=.{s}", .{
                    source.index.get(),
                    bun.fmt.quote(source.path.pretty),
                    source.path.text,
                    @tagName(targets[idx.get()]),
                });
            }
        }

        const additional_files = this.graph.input_files.items(.additional_files);
        const unique_keys = this.graph.input_files.items(.unique_key_for_additional_file);
        const content_hashes = this.graph.input_files.items(.content_hash_for_additional_file);
        for (all_urls_for_css, 0..) |url_for_css, index| {
            if (url_for_css.len > 0) {
                // We like to inline additional files in CSS if they fit a size threshold
                // If we do inline a file in CSS, and it is not imported by JS, then we don't need to copy the additional file into the output directory
                if (additional_files_imported_by_css_and_inlined.isSet(index) and !additional_files_imported_by_js_and_inlined_in_css.isSet(index)) {
                    additional_files[index].clearRetainingCapacity();
                    unique_keys[index] = "";
                    content_hashes[index] = 0;
                }
            }
        }

        return visitor.reachable.toOwnedSlice();
    }

    fn isDone(this: *BundleV2) bool {
        this.thread_lock.assertLocked();

        if (this.graph.pending_items == 0) {
            if (this.graph.drainDeferredTasks(this)) {
                return false;
            }

            return true;
        }

        return false;
    }

    pub fn waitForParse(this: *BundleV2) void {
        this.loop().tick(this, &isDone);

        debug("Parsed {d} files, producing {d} ASTs", .{ this.graph.input_files.len, this.graph.ast.len });
    }

    pub fn scanForSecondaryPaths(this: *BundleV2) void {
        if (!this.graph.has_any_secondary_paths) {

            // Assert the boolean is accurate.
            if (comptime Environment.ci_assert) {
                for (this.graph.input_files.items(.secondary_path)) |secondary_path| {
                    if (secondary_path.len > 0) {
                        @panic("secondary_path is not empty");
                    }
                }
            }

            // No dual package hazard. Do nothing.
            return;
        }

        // Now that all files have been scanned, look for packages that are imported
        // both with "import" and "require". Rewrite any imports that reference the
        // "module" package.json field to the "main" package.json field instead.
        //
        // This attempts to automatically avoid the "dual package hazard" where a
        // package has both a CommonJS module version and an ECMAScript module
        // version and exports a non-object in CommonJS (often a function). If we
        // pick the "module" field and the package is imported with "require" then
        // code expecting a function will crash.
        const ast_import_records: []const ImportRecord.List = this.graph.ast.items(.import_records);
        const targets: []const options.Target = this.graph.ast.items(.target);
        const max_valid_source_index: Index = .init(this.graph.input_files.len);
        const secondary_paths: []const []const u8 = this.graph.input_files.items(.secondary_path);

        for (ast_import_records, targets) |*ast_import_record_list, target| {
            const import_records: []ImportRecord = ast_import_record_list.slice();
            const path_to_source_index_map = this.pathToSourceIndexMap(target);
            for (import_records) |*import_record| {
                const source_index = import_record.source_index.get();
                if (source_index >= max_valid_source_index.get()) {
                    continue;
                }
                const secondary_path = secondary_paths[source_index];
                if (secondary_path.len > 0) {
                    const secondary_source_index = path_to_source_index_map.get(secondary_path) orelse continue;
                    import_record.source_index = Index.init(secondary_source_index);
                    // Keep path in sync for determinism, diagnostics, and dev tooling.
                    import_record.path = this.graph.input_files.items(.source)[secondary_source_index].path;
                }
            }
        }
    }

    /// This runs on the Bundle Thread.
    pub fn runResolver(
        this: *BundleV2,
        import_record: bun.jsc.API.JSBundler.Resolve.MiniImportRecord,
        target: options.Target,
    ) void {
        const transpiler = this.transpilerForTarget(target);
        const source_dir = Fs.PathName.init(import_record.source_file).dirWithTrailingSlash();

        // Check the FileMap first for in-memory files
        if (this.file_map) |file_map| {
            if (file_map.resolve(import_record.source_file, import_record.specifier)) |_file_map_result| {
                var file_map_result = _file_map_result;
                var path_primary = file_map_result.path_pair.primary;
                const entry = bun.handleOom(this.pathToSourceIndexMap(target).getOrPut(this.allocator(), path_primary.text));
                if (!entry.found_existing) {
                    const loader: Loader = brk: {
                        const record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
                        if (record.loader) |out_loader| {
                            break :brk out_loader;
                        }
                        break :brk Fs.Path.init(path_primary.text).loader(&transpiler.options.loaders) orelse options.Loader.file;
                    };
                    // For virtual files, use the path text as-is (no relative path computation needed).
                    path_primary.pretty = bun.handleOom(this.allocator().dupe(u8, path_primary.text));
                    const idx = this.enqueueParseTask(
                        &file_map_result,
                        &.{
                            .path = path_primary,
                            .contents = "",
                        },
                        loader,
                        import_record.original_target,
                    ) catch |err| bun.handleOom(err);
                    entry.value_ptr.* = idx;
                    const record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
                    record.source_index = Index.init(idx);
                } else {
                    const record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
                    record.source_index = Index.init(entry.value_ptr.*);
                }
                return;
            }
        }

        var had_busted_dir_cache: bool = false;
        var resolve_result: _resolver.Result = while (true) break transpiler.resolver.resolve(
            source_dir,
            import_record.specifier,
            import_record.kind,
        ) catch |err| {
            // Only perform directory busting when hot-reloading is enabled
            if (err == error.ModuleNotFound) {
                if (this.transpiler.options.dev_server) |dev| {
                    if (!had_busted_dir_cache) {
                        // Only re-query if we previously had something cached.
                        if (transpiler.resolver.bustDirCacheFromSpecifier(import_record.source_file, import_record.specifier)) {
                            had_busted_dir_cache = true;
                            continue;
                        }
                    }

                    // Tell Bake's Dev Server to wait for the file to be imported.
                    dev.directory_watchers.trackResolutionFailure(
                        import_record.source_file,
                        import_record.specifier,
                        target.bakeGraph(),
                        this.graph.input_files.items(.loader)[import_record.importer_source_index],
                    ) catch |e| bun.handleOom(e);

                    // Turn this into an invalid AST, so that incremental mode skips it when printing.
                    this.graph.ast.items(.parts)[import_record.importer_source_index].len = 0;
                }
            }

            var handles_import_errors = false;
            var source: ?*const Logger.Source = null;
            const log = this.logForResolutionFailures(import_record.source_file, target.bakeGraph());

            var record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
            source = &this.graph.input_files.items(.source)[import_record.importer_source_index];
            handles_import_errors = record.flags.handles_import_errors;

            // Disable failing packages from being printed.
            // This may cause broken code to write.
            // However, doing this means we tell them all the resolve errors
            // Rather than just the first one.
            record.path.is_disabled = true;

            switch (err) {
                error.ModuleNotFound => {
                    const addError = Logger.Log.addResolveErrorWithTextDupe;

                    const path_to_use = import_record.specifier;

                    if (!handles_import_errors and !this.transpiler.options.ignore_module_resolution_errors) {
                        if (isPackagePath(import_record.specifier)) {
                            if (target == .browser and options.ExternalModules.isNodeBuiltin(path_to_use)) {
                                addError(
                                    log,
                                    source,
                                    import_record.range,
                                    this.allocator(),
                                    "Browser build cannot {s} Node.js module: \"{s}\". To use Node.js builtins, set target to 'node' or 'bun'",
                                    .{ import_record.kind.errorLabel(), path_to_use },
                                    import_record.kind,
                                ) catch unreachable;
                            } else {
                                addError(
                                    log,
                                    source,
                                    import_record.range,
                                    this.allocator(),
                                    "Could not resolve: \"{s}\". Maybe you need to \"bun install\"?",
                                    .{path_to_use},
                                    import_record.kind,
                                ) catch unreachable;
                            }
                        } else {
                            addError(
                                log,
                                source,
                                import_record.range,
                                this.allocator(),
                                "Could not resolve: \"{s}\"",
                                .{
                                    path_to_use,
                                },
                                import_record.kind,
                            ) catch unreachable;
                        }
                    }
                },
                // assume other errors are already in the log
                else => {},
            }
            return;
        };

        var out_source_index: ?Index = null;

        var path: *Fs.Path = resolve_result.path() orelse {
            var record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];

            // Disable failing packages from being printed.
            // This may cause broken code to write.
            // However, doing this means we tell them all the resolve errors
            // Rather than just the first one.
            record.path.is_disabled = true;
            return;
        };

        if (resolve_result.flags.is_external) {
            return;
        }

        if (path.pretty.ptr == path.text.ptr) {
            // TODO: outbase
            const rel = bun.path.relativePlatform(transpiler.fs.top_level_dir, path.text, .loose, false);
            path.pretty = bun.handleOom(this.allocator().dupe(u8, rel));
        }
        path.assertPrettyIsValid();

        path.assertFilePathIsAbsolute();
        const entry = bun.handleOom(this.pathToSourceIndexMap(target).getOrPut(this.allocator(), path.text));
        if (!entry.found_existing) {
            path.* = bun.handleOom(this.pathWithPrettyInitialized(path.*, target));
            entry.key_ptr.* = path.text;
            const loader: Loader = brk: {
                const record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
                if (record.loader) |out_loader| {
                    break :brk out_loader;
                }
                break :brk path.loader(&transpiler.options.loaders) orelse options.Loader.file;
                // HTML is only allowed at the entry point.
            };
            const idx = this.enqueueParseTask(
                &resolve_result,
                &.{
                    .path = path.*,
                    .contents = "",
                },
                loader,
                import_record.original_target,
            ) catch |err| bun.handleOom(err);
            entry.value_ptr.* = idx;
            out_source_index = Index.init(idx);

            if (resolve_result.path_pair.secondary) |*secondary| {
                if (!secondary.is_disabled and
                    secondary != path and
                    !strings.eqlLong(secondary.text, path.text, true))
                {
                    const secondary_path_to_copy = secondary.dupeAlloc(this.allocator()) catch |err| bun.handleOom(err);
                    this.graph.input_files.items(.secondary_path)[idx] = secondary_path_to_copy.text;
                    // Ensure the determinism pass runs.
                    this.graph.has_any_secondary_paths = true;
                }
            }

            // For non-javascript files, make all of these files share indices.
            // For example, it is silly to bundle index.css depended on by client+server twice.
            // It makes sense to separate these for JS because the target affects DCE
            if (this.transpiler.options.server_components and !loader.isJavaScriptLike()) {
                const a, const b = switch (target) {
                    else => .{ this.pathToSourceIndexMap(.browser), this.pathToSourceIndexMap(.bake_server_components_ssr) },
                    .browser => .{ this.pathToSourceIndexMap(this.transpiler.options.target), this.pathToSourceIndexMap(.bake_server_components_ssr) },
                    .bake_server_components_ssr => .{ this.pathToSourceIndexMap(this.transpiler.options.target), this.pathToSourceIndexMap(.browser) },
                };
                bun.handleOom(a.put(this.allocator(), entry.key_ptr.*, entry.value_ptr.*));
                if (this.framework.?.server_components.?.separate_ssr_graph)
                    bun.handleOom(b.put(this.allocator(), entry.key_ptr.*, entry.value_ptr.*));
            }
        } else {
            out_source_index = Index.init(entry.value_ptr.*);
        }

        if (out_source_index) |source_index| {
            const record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
            record.source_index = source_index;
        }
    }

    pub fn enqueueFileFromDevServerIncrementalGraphInvalidation(
        this: *BundleV2,
        path_slice: []const u8,
        target: options.Target,
    ) !void {
        // TODO: plugins with non-file namespaces
        const entry = try this.pathToSourceIndexMap(target).getOrPut(this.allocator(), path_slice);
        if (entry.found_existing) {
            return;
        }
        const t = this.transpilerForTarget(target);
        const result = t.resolveEntryPoint(path_slice) catch
            return;
        var path = result.path_pair.primary;
        this.incrementScanCounter();
        const source_index = Index.source(this.graph.input_files.len);
        const loader = brk: {
            const default = path.loader(&this.transpiler.options.loaders) orelse .file;
            break :brk default;
        };

        path = bun.handleOom(this.pathWithPrettyInitialized(path, target));
        path.assertPrettyIsValid();
        entry.key_ptr.* = path.text;
        entry.value_ptr.* = source_index.get();
        bun.handleOom(this.graph.ast.append(this.allocator(), JSAst.empty));

        try this.graph.input_files.append(this.allocator(), .{
            .source = .{
                .path = path,
                .contents = "",
                .index = source_index,
            },
            .loader = loader,
            .side_effects = result.primary_side_effects_data,
        });
        var task = try this.allocator().create(ParseTask);
        task.* = ParseTask.init(&result, source_index, this);
        task.loader = loader;
        task.task.node.next = null;
        task.tree_shaking = this.linker.options.tree_shaking;
        task.known_target = target;
        task.jsx.development = switch (t.options.force_node_env) {
            .development => true,
            .production => false,
            .unspecified => t.options.jsx.development,
        };

        // Handle onLoad plugins as entry points
        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
            if (loader.shouldCopyForBundling()) {
                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                bun.handleOom(additional_files.append(this.allocator(), .{ .source_index = task.source_index.get() }));
                this.graph.input_files.items(.side_effects)[source_index.get()] = .no_side_effects__pure_data;
                this.graph.estimated_file_loader_count += 1;
            }

            this.graph.pool.schedule(task);
        }
    }

    pub fn enqueueEntryItem(
        this: *BundleV2,
        resolve: _resolver.Result,
        is_entry_point: bool,
        target: options.Target,
    ) !?Index.Int {
        var result = resolve;
        var path = result.path() orelse return null;

        path.assertFilePathIsAbsolute();
        const entry = try this.pathToSourceIndexMap(target).getOrPut(this.allocator(), path.text);
        if (entry.found_existing) {
            return null;
        }
        this.incrementScanCounter();
        const source_index = Index.source(this.graph.input_files.len);

        const loader = brk: {
            const loader = path.loader(&this.transpiler.options.loaders) orelse .file;
            break :brk loader;
        };

        path.* = bun.handleOom(this.pathWithPrettyInitialized(path.*, target));
        path.assertPrettyIsValid();
        entry.key_ptr.* = path.text;
        entry.value_ptr.* = source_index.get();
        bun.handleOom(this.graph.ast.append(this.allocator(), JSAst.empty));

        try this.graph.input_files.append(this.allocator(), .{
            .source = .{
                .path = path.*,
                .contents = "",
                .index = source_index,
            },
            .loader = loader,
            .side_effects = resolve.primary_side_effects_data,
        });
        var task = try this.allocator().create(ParseTask);
        task.* = ParseTask.init(&result, source_index, this);
        task.loader = loader;
        task.task.node.next = null;
        task.tree_shaking = this.linker.options.tree_shaking;
        task.is_entry_point = is_entry_point;
        task.known_target = target;
        {
            const bundler = this.transpilerForTarget(target);
            task.jsx.development = switch (bundler.options.force_node_env) {
                .development => true,
                .production => false,
                .unspecified => bundler.options.jsx.development,
            };
        }

        // Handle onLoad plugins as entry points
        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
            if (loader.shouldCopyForBundling()) {
                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                bun.handleOom(additional_files.append(this.allocator(), .{ .source_index = task.source_index.get() }));
                this.graph.input_files.items(.side_effects)[source_index.get()] = _resolver.SideEffects.no_side_effects__pure_data;
                this.graph.estimated_file_loader_count += 1;
            }

            this.graph.pool.schedule(task);
        }

        try this.graph.entry_points.append(this.allocator(), source_index);

        return source_index.get();
    }

    /// `heap` is not freed when `deinit`ing the BundleV2
    pub fn init(
        transpiler: *Transpiler,
        bake_options: ?BakeOptions,
        alloc: std.mem.Allocator,
        event_loop: EventLoop,
        cli_watch_flag: bool,
        thread_pool: ?*ThreadPoolLib,
        heap: ThreadLocalArena,
    ) !*BundleV2 {
        transpiler.env.loadTracy();

        const this = try alloc.create(BundleV2);
        transpiler.options.mark_builtins_as_external = transpiler.options.target.isBun() or transpiler.options.target == .node;
        transpiler.resolver.opts.mark_builtins_as_external = transpiler.options.target.isBun() or transpiler.options.target == .node;

        this.* = .{
            .transpiler = transpiler,
            .client_transpiler = null,
            .ssr_transpiler = transpiler,
            .framework = null,
            .graph = .{
                .pool = undefined,
                .heap = heap,
                .kit_referenced_server_data = false,
                .kit_referenced_client_data = false,
                .build_graphs = .initFill(.{}),
            },
            .linker = .{
                .loop = event_loop,
                .graph = .{
                    .allocator = heap.allocator(),
                },
            },
            .bun_watcher = null,
            .plugins = null,
            .completion = null,
            .file_map = null,
            .source_code_length = 0,
            .thread_lock = .initLocked(),
        };
        if (bake_options) |bo| {
            this.client_transpiler = bo.client_transpiler;
            this.ssr_transpiler = bo.ssr_transpiler;
            this.framework = bo.framework;
            this.linker.framework = &this.framework.?;
            this.plugins = bo.plugins;
            if (transpiler.options.server_components) {
                bun.assert(this.client_transpiler.?.options.server_components);
                if (bo.framework.server_components.?.separate_ssr_graph)
                    bun.assert(this.ssr_transpiler.options.server_components);
            }
        }
        this.transpiler.allocator = heap.allocator();
        this.transpiler.resolver.allocator = heap.allocator();
        this.transpiler.linker.allocator = heap.allocator();
        this.transpiler.log.msgs.allocator = heap.allocator();
        this.transpiler.log.clone_line_text = true;

        // We don't expose an option to disable this. Bake forbids tree-shaking
        // since every export must is always exist in case a future module
        // starts depending on it.
        if (this.transpiler.options.output_format == .internal_bake_dev) {
            this.transpiler.options.tree_shaking = false;
            this.transpiler.resolver.opts.tree_shaking = false;
        } else {
            this.transpiler.options.tree_shaking = true;
            this.transpiler.resolver.opts.tree_shaking = true;
        }

        this.linker.resolver = &this.transpiler.resolver;
        this.linker.graph.code_splitting = transpiler.options.code_splitting;

        this.linker.options.minify_syntax = transpiler.options.minify_syntax;
        this.linker.options.minify_identifiers = transpiler.options.minify_identifiers;
        this.linker.options.minify_whitespace = transpiler.options.minify_whitespace;
        this.linker.options.emit_dce_annotations = transpiler.options.emit_dce_annotations;
        this.linker.options.ignore_dce_annotations = transpiler.options.ignore_dce_annotations;
        this.linker.options.banner = transpiler.options.banner;
        this.linker.options.footer = transpiler.options.footer;
        this.linker.options.css_chunking = transpiler.options.css_chunking;
        this.linker.options.source_maps = transpiler.options.source_map;
        this.linker.options.tree_shaking = transpiler.options.tree_shaking;
        this.linker.options.public_path = transpiler.options.public_path;
        this.linker.options.target = transpiler.options.target;
        this.linker.options.output_format = transpiler.options.output_format;
        this.linker.options.generate_bytecode_cache = transpiler.options.bytecode;
        this.linker.options.metafile = transpiler.options.metafile;

        this.linker.dev_server = transpiler.options.dev_server;

        const pool = try this.allocator().create(ThreadPool);
        if (cli_watch_flag) {
            Watcher.enableHotModuleReloading(this, null);
        }
        // errdefer pool.destroy();
        errdefer this.graph.heap.deinit();

        pool.* = try .init(this, thread_pool);
        this.graph.pool = pool;
        pool.start();
        return this;
    }

    pub fn allocator(this: *const BundleV2) std.mem.Allocator {
        return this.graph.heap.allocator();
    }

    const logScanCounter = bun.Output.scoped(.scan_counter, .visible);

    pub fn incrementScanCounter(this: *BundleV2) void {
        this.thread_lock.assertLocked();
        this.graph.pending_items += 1;
        logScanCounter(".pending_items + 1 = {d}", .{this.graph.pending_items});
    }

    pub fn decrementScanCounter(this: *BundleV2) void {
        this.thread_lock.assertLocked();
        this.graph.pending_items -= 1;
        logScanCounter(".pending_items - 1 = {d}", .{this.graph.pending_items});
        this.onAfterDecrementScanCounter();
    }

    pub fn onAfterDecrementScanCounter(this: *BundleV2) void {
        if (this.asynchronous and this.isDone()) {
            this.finishFromBakeDevServer(this.transpiler.options.dev_server orelse
                @panic("No dev server attached in asynchronous bundle job")) catch
                bun.outOfMemory();
        }
    }

    pub fn enqueueEntryPoints(
        this: *BundleV2,
        comptime variant: enum { normal, dev_server, bake_production },
        data: switch (variant) {
            .normal => []const []const u8,
            .dev_server => struct {
                files: bake.DevServer.EntryPointList,
                css_data: *std.AutoArrayHashMapUnmanaged(Index, CssEntryPointMeta),
            },
            .bake_production => bake.production.EntryPointMap,
        },
    ) !void {
        {
            // Add the runtime
            const rt = ParseTask.getRuntimeSource(this.transpiler.options.target);
            try this.graph.input_files.append(this.allocator(), Graph.InputFile{
                .source = rt.source,
                .loader = .js,
                .side_effects = _resolver.SideEffects.no_side_effects__pure_data,
            });

            // try this.graph.entry_points.append(allocator, Index.runtime);
            try this.graph.ast.append(this.allocator(), JSAst.empty);
            try this.pathToSourceIndexMap(this.transpiler.options.target).put(this.allocator(), "bun:wrap", Index.runtime.get());
            var runtime_parse_task = try this.allocator().create(ParseTask);
            runtime_parse_task.* = rt.parse_task;
            runtime_parse_task.ctx = this;
            runtime_parse_task.tree_shaking = true;
            runtime_parse_task.loader = .js;
            this.incrementScanCounter();
            this.graph.pool.schedule(runtime_parse_task);
        }

        // Bake reserves two source indexes at the start of the file list, but
        // gets its content set after the scan+parse phase, but before linking.
        //
        // The dev server does not use these, as it is implement in the HMR runtime.
        if (variant != .dev_server) {
            try this.reserveSourceIndexesForBake();
        } else {
            bun.assert(this.transpiler.options.dev_server != null);
        }

        {
            // Setup entry points
            const num_entry_points = switch (variant) {
                .normal => data.len,
                .bake_production => data.files.count(),
                .dev_server => data.files.set.count(),
            };

            try this.graph.entry_points.ensureUnusedCapacity(this.allocator(), num_entry_points);
            try this.graph.input_files.ensureUnusedCapacity(this.allocator(), num_entry_points);

            switch (variant) {
                .normal => {
                    for (data) |entry_point| {
                        if (this.enqueueEntryPointOnResolvePluginIfNeeded(entry_point, this.transpiler.options.target)) {
                            continue;
                        }

                        // Check FileMap first for in-memory entry points
                        if (this.file_map) |file_map| {
                            if (file_map.resolve("", entry_point)) |file_map_result| {
                                _ = try this.enqueueEntryItem(
                                    file_map_result,
                                    true,
                                    this.transpiler.options.target,
                                );
                                continue;
                            }
                        }

                        // no plugins were matched
                        const resolved = this.transpiler.resolveEntryPoint(entry_point) catch
                            continue;

                        _ = try this.enqueueEntryItem(
                            resolved,
                            true,
                            brk: {
                                const main_target = this.transpiler.options.target;

                                if (main_target.isServerSide()) {
                                    if (resolved.pathConst()) |path| {
                                        if (path.loader(&this.transpiler.options.loaders)) |loader| {
                                            if (loader == .html) {
                                                this.ensureClientTranspiler();
                                                break :brk .browser;
                                            }
                                        }
                                    }
                                }

                                break :brk main_target;
                            },
                        );
                    }
                },
                .dev_server => {
                    for (data.files.set.keys(), data.files.set.values()) |abs_path, flags| {

                        // Ensure we have the proper conditions set for client-side entrypoints.
                        const transpiler = if (flags.client and !flags.server and !flags.ssr)
                            this.transpilerForTarget(.browser)
                        else
                            this.transpiler;

                        const targets_to_check = [_]struct {
                            should_dispatch: bool,
                            target: options.Target,
                        }{
                            .{ .should_dispatch = flags.client, .target = .browser },
                            .{ .should_dispatch = flags.server, .target = this.transpiler.options.target },
                            .{ .should_dispatch = flags.ssr, .target = .bake_server_components_ssr },
                        };

                        var any_plugin_matched = false;
                        for (targets_to_check) |target_info| {
                            if (target_info.should_dispatch) {
                                if (this.enqueueEntryPointOnResolvePluginIfNeeded(abs_path, target_info.target)) {
                                    any_plugin_matched = true;
                                }
                            }
                        }

                        if (any_plugin_matched) {
                            continue;
                        }

                        // Fall back to normal resolution if no plugins matched
                        const resolved = transpiler.resolveEntryPoint(abs_path) catch |err| {
                            const dev = this.transpiler.options.dev_server orelse unreachable;
                            dev.handleParseTaskFailure(
                                err,
                                if (flags.client) .client else .server,
                                abs_path,
                                transpiler.log,
                                this,
                            ) catch |e| bun.handleOom(e);
                            transpiler.log.reset();
                            continue;
                        };

                        if (flags.client) brk: {
                            const source_index = try this.enqueueEntryItem(resolved, true, .browser) orelse break :brk;
                            if (flags.css) {
                                try data.css_data.putNoClobber(this.allocator(), Index.init(source_index), .{ .imported_on_server = false });
                            }
                        }
                        if (flags.server) _ = try this.enqueueEntryItem(resolved, true, this.transpiler.options.target);
                        if (flags.ssr) _ = try this.enqueueEntryItem(resolved, true, .bake_server_components_ssr);
                    }
                },
                .bake_production => {
                    for (data.files.keys()) |key| {
                        const abs_path = key.absPath();
                        const target = switch (key.side) {
                            .client => options.Target.browser,
                            .server => this.transpiler.options.target,
                        };

                        if (this.enqueueEntryPointOnResolvePluginIfNeeded(abs_path, target)) {
                            continue;
                        }

                        // no plugins matched
                        const resolved = this.transpiler.resolveEntryPoint(abs_path) catch
                            continue;

                        // TODO: wrap client files so the exports arent preserved.
                        _ = try this.enqueueEntryItem(resolved, true, target) orelse continue;
                    }
                },
            }
        }
    }

    fn cloneAST(this: *BundleV2) !void {
        const trace = bun.perf.trace("Bundler.cloneAST");
        defer trace.end();
        bun.safety.alloc.assertEq(this.allocator(), this.transpiler.allocator);
        bun.safety.alloc.assertEq(this.allocator(), this.linker.graph.allocator);
        this.linker.graph.ast = try this.graph.ast.clone(this.allocator());

        for (this.linker.graph.ast.items(.module_scope)) |*module_scope| {
            for (module_scope.children.slice()) |child| {
                child.parent = module_scope;
            }

            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.graph.heap.helpCatchMemoryIssues();
            }

            module_scope.generated = try module_scope.generated.clone(this.allocator());
        }

        // Some parts of the AST are owned by worker allocators at this point.
        // Transfer ownership to the graph heap.
        this.linker.graph.takeAstOwnership();
    }

    /// This generates the two asts for 'bun:bake/client' and 'bun:bake/server'. Both are generated
    /// at the same time in one pass over the SCB list.
    pub fn processServerComponentManifestFiles(this: *BundleV2) OOM!void {
        // If a server components is not configured, do nothing
        const fw = this.framework orelse return;
        const sc = fw.server_components orelse return;

        if (!this.graph.kit_referenced_server_data and
            !this.graph.kit_referenced_client_data) return;

        const alloc = this.allocator();

        var server = try AstBuilder.init(this.allocator(), &bake.server_virtual_source, this.transpiler.options.hot_module_reloading);
        var client = try AstBuilder.init(this.allocator(), &bake.client_virtual_source, this.transpiler.options.hot_module_reloading);

        var server_manifest_props: std.ArrayListUnmanaged(G.Property) = .{};
        var client_manifest_props: std.ArrayListUnmanaged(G.Property) = .{};

        const scbs = this.graph.server_component_boundaries.list.slice();
        const named_exports_array = this.graph.ast.items(.named_exports);

        const id_string = server.newExpr(E.String{ .data = "id" });
        const name_string = server.newExpr(E.String{ .data = "name" });
        const chunks_string = server.newExpr(E.String{ .data = "chunks" });
        const specifier_string = server.newExpr(E.String{ .data = "specifier" });
        const empty_array = server.newExpr(E.Array{});

        for (
            scbs.items(.use_directive),
            scbs.items(.source_index),
            scbs.items(.ssr_source_index),
        ) |use, source_id, ssr_index| {
            if (use == .client) {
                // TODO(@paperclover/bake): this file is being generated far too
                // early. we don't know which exports are dead and which exports
                // are live. Tree-shaking figures that out. However,
                // tree-shaking happens after import binding, which would
                // require this ast.
                //
                // The plan: change this to generate a stub ast which only has
                // `export const serverManifest = undefined;`, and then
                // re-generate this file later with the properly decided
                // manifest. However, I will probably reconsider how this
                // manifest is being generated when I write the whole
                // "production build" part of Bake.

                const keys = named_exports_array[source_id].keys();
                const client_manifest_items = try alloc.alloc(G.Property, keys.len);

                if (!sc.separate_ssr_graph) bun.todoPanic(@src(), "separate_ssr_graph=false", .{});

                const client_path = server.newExpr(E.String{
                    .data = try std.fmt.allocPrint(alloc, "{f}S{d:0>8}", .{
                        bun.fmt.hexIntLower(this.unique_key),
                        source_id,
                    }),
                });
                const ssr_path = server.newExpr(E.String{
                    .data = try std.fmt.allocPrint(alloc, "{f}S{d:0>8}", .{
                        bun.fmt.hexIntLower(this.unique_key),
                        ssr_index,
                    }),
                });

                for (keys, client_manifest_items) |export_name_string, *client_item| {
                    const server_key_string = try std.fmt.allocPrint(alloc, "{f}S{d:0>8}#{s}", .{
                        bun.fmt.hexIntLower(this.unique_key),
                        source_id,
                        export_name_string,
                    });
                    const export_name = server.newExpr(E.String{ .data = export_name_string });

                    // write dependencies on the underlying module, not the proxy
                    try server_manifest_props.append(alloc, .{
                        .key = server.newExpr(E.String{ .data = server_key_string }),
                        .value = server.newExpr(E.Object{
                            .properties = try G.Property.List.fromSlice(alloc, &.{
                                .{ .key = id_string, .value = client_path },
                                .{ .key = name_string, .value = export_name },
                                .{ .key = chunks_string, .value = empty_array },
                            }),
                        }),
                    });
                    client_item.* = .{
                        .key = export_name,
                        .value = server.newExpr(E.Object{
                            .properties = try G.Property.List.fromSlice(alloc, &.{
                                .{ .key = name_string, .value = export_name },
                                .{ .key = specifier_string, .value = ssr_path },
                            }),
                        }),
                    };
                }

                try client_manifest_props.append(alloc, .{
                    .key = client_path,
                    .value = server.newExpr(E.Object{
                        .properties = G.Property.List.fromOwnedSlice(client_manifest_items),
                    }),
                });
            } else {
                bun.todoPanic(@src(), "\"use server\"", .{});
            }
        }

        try server.appendStmt(S.Local{
            .kind = .k_const,
            .decls = try G.Decl.List.fromSlice(alloc, &.{.{
                .binding = Binding.alloc(alloc, B.Identifier{
                    .ref = try server.newSymbol(.other, "serverManifest"),
                }, Logger.Loc.Empty),
                .value = server.newExpr(E.Object{
                    .properties = G.Property.List.moveFromList(&server_manifest_props),
                }),
            }}),
            .is_export = true,
        });
        try server.appendStmt(S.Local{
            .kind = .k_const,
            .decls = try G.Decl.List.fromSlice(alloc, &.{.{
                .binding = Binding.alloc(alloc, B.Identifier{
                    .ref = try server.newSymbol(.other, "ssrManifest"),
                }, Logger.Loc.Empty),
                .value = server.newExpr(E.Object{
                    .properties = G.Property.List.moveFromList(&client_manifest_props),
                }),
            }}),
            .is_export = true,
        });

        this.graph.ast.set(Index.bake_server_data.get(), try server.toBundledAst(.bun));
        this.graph.ast.set(Index.bake_client_data.get(), try client.toBundledAst(.browser));
    }

    pub fn enqueueParseTask(
        this: *BundleV2,
        noalias resolve_result: *const _resolver.Result,
        source: *const Logger.Source,
        loader: Loader,
        known_target: options.Target,
    ) OOM!Index.Int {
        const source_index = Index.init(@as(u32, @intCast(this.graph.ast.len)));
        this.graph.ast.append(this.allocator(), JSAst.empty) catch unreachable;

        this.graph.input_files.append(this.allocator(), .{
            .source = source.*,
            .loader = loader,
            .side_effects = loader.sideEffects(),
        }) catch |err| bun.handleOom(err);
        var task = bun.handleOom(this.allocator().create(ParseTask));
        task.* = ParseTask.init(resolve_result, source_index, this);
        task.loader = loader;
        task.jsx = this.transpilerForTarget(known_target).options.jsx;
        task.task.node.next = null;
        task.io_task.node.next = null;
        task.tree_shaking = this.linker.options.tree_shaking;
        task.known_target = known_target;

        this.incrementScanCounter();

        // Handle onLoad plugins
        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
            if (loader.shouldCopyForBundling()) {
                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                bun.handleOom(additional_files.append(this.allocator(), .{ .source_index = task.source_index.get() }));
                this.graph.input_files.items(.side_effects)[source_index.get()] = _resolver.SideEffects.no_side_effects__pure_data;
                this.graph.estimated_file_loader_count += 1;
            }

            this.graph.pool.schedule(task);
        }

        return source_index.get();
    }

    pub fn enqueueParseTask2(
        this: *BundleV2,
        source: *const Logger.Source,
        loader: Loader,
        known_target: options.Target,
    ) OOM!Index.Int {
        const source_index = Index.init(@as(u32, @intCast(this.graph.ast.len)));
        this.graph.ast.append(this.allocator(), JSAst.empty) catch unreachable;

        this.graph.input_files.append(this.allocator(), .{
            .source = source.*,
            .loader = loader,
            .side_effects = loader.sideEffects(),
        }) catch |err| bun.handleOom(err);
        var task = bun.handleOom(this.allocator().create(ParseTask));
        task.* = .{
            .ctx = this,
            .path = source.path,
            .contents_or_fd = .{
                .contents = source.contents,
            },
            .side_effects = .has_side_effects,
            .jsx = if (known_target == .bake_server_components_ssr and !this.framework.?.server_components.?.separate_ssr_graph)
                this.transpiler.options.jsx
            else
                this.transpilerForTarget(known_target).options.jsx,
            .source_index = source_index,
            .module_type = .unknown,
            .emit_decorator_metadata = false, // TODO
            .package_version = "",
            .loader = loader,
            .tree_shaking = this.linker.options.tree_shaking,
            .known_target = known_target,
        };
        task.task.node.next = null;
        task.io_task.node.next = null;

        this.incrementScanCounter();

        // Handle onLoad plugins
        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
            if (loader.shouldCopyForBundling()) {
                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                bun.handleOom(additional_files.append(this.allocator(), .{ .source_index = task.source_index.get() }));
                this.graph.input_files.items(.side_effects)[source_index.get()] = _resolver.SideEffects.no_side_effects__pure_data;
                this.graph.estimated_file_loader_count += 1;
            }

            this.graph.pool.schedule(task);
        }
        return source_index.get();
    }

    /// Enqueue a ServerComponentParseTask.
    /// `source_without_index` is copied and assigned a new source index. That index is returned.
    pub fn enqueueServerComponentGeneratedFile(
        this: *BundleV2,
        data: ServerComponentParseTask.Data,
        source_without_index: Logger.Source,
    ) OOM!Index.Int {
        var new_source: Logger.Source = source_without_index;
        const source_index = this.graph.input_files.len;
        new_source.index = Index.init(source_index);
        try this.graph.input_files.append(this.allocator(), .{
            .source = new_source,
            .loader = .js,
            .side_effects = .has_side_effects,
        });
        try this.graph.ast.append(this.allocator(), JSAst.empty);

        const task = bun.new(ServerComponentParseTask, .{
            .data = data,
            .ctx = this,
            .source = new_source,
        });

        this.incrementScanCounter();

        this.graph.pool.worker_pool.schedule(.from(&task.task));

        return @intCast(source_index);
    }

    pub const DependenciesScanner = struct {
        ctx: *anyopaque,
        entry_points: []const []const u8,

        onFetch: *const fn (
            ctx: *anyopaque,
            result: *DependenciesScanner.Result,
        ) anyerror!void,

        pub const Result = struct {
            dependencies: bun.StringSet,
            reachable_files: []const Index,
            bundle_v2: *BundleV2,
        };
    };

    pub fn getAllDependencies(this: *BundleV2, reachable_files: []const Index, fetcher: *const DependenciesScanner) !void {

        // Find all external dependencies from reachable files
        var external_deps = bun.StringSet.init(bun.default_allocator);
        defer external_deps.deinit();

        const import_records = this.graph.ast.items(.import_records);

        for (reachable_files) |source_index| {
            const records: []const ImportRecord = import_records[source_index.get()].slice();
            for (records) |*record| {
                if (!record.source_index.isValid() and record.tag == .none) {
                    const path = record.path.text;
                    // External dependency
                    if (path.len > 0 and
                        // Check for either node or bun builtins
                        // We don't use the list from .bun because that includes third-party packages in some cases.
                        !jsc.ModuleLoader.HardcodedModule.Alias.has(path, .node, .{}) and
                        !strings.hasPrefixComptime(path, "bun:") and
                        !strings.eqlComptime(path, "bun"))
                    {
                        if (strings.isNPMPackageNameIgnoreLength(path)) {
                            try external_deps.insert(path);
                        }
                    }
                }
            }
        }
        var result = DependenciesScanner.Result{
            .dependencies = external_deps,
            .bundle_v2 = this,
            .reachable_files = reachable_files,
        };
        try fetcher.onFetch(fetcher.ctx, &result);
    }

    pub fn generateFromCLI(
        transpiler: *Transpiler,
        alloc: std.mem.Allocator,
        event_loop: EventLoop,
        enable_reloading: bool,
        reachable_files_count: *usize,
        minify_duration: *u64,
        source_code_size: *u64,
        fetcher: ?*DependenciesScanner,
    ) !BuildResult {
        var this = try BundleV2.init(
            transpiler,
            null,
            alloc,
            event_loop,
            enable_reloading,
            null,
            .init(),
        );
        this.unique_key = generateUniqueKey();

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        try this.enqueueEntryPoints(.normal, this.transpiler.options.entry_points);

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        this.waitForParse();

        minify_duration.* = @as(u64, @intCast(@divTrunc(@as(i64, @truncate(std.time.nanoTimestamp())) - @as(i64, @truncate(bun.cli.start_time)), @as(i64, std.time.ns_per_ms))));
        source_code_size.* = this.source_code_length;

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        this.scanForSecondaryPaths();

        try this.processServerComponentManifestFiles();

        const reachable_files = try this.findReachableFiles();
        reachable_files_count.* = reachable_files.len -| 1; // - 1 for the runtime

        try this.processFilesToCopy(reachable_files);

        try this.addServerComponentBoundariesAsExtraEntryPoints();

        try this.cloneAST();

        const chunks = try this.linker.link(
            this,
            this.graph.entry_points.items,
            this.graph.server_component_boundaries,
            reachable_files,
        );

        // Do this at the very end, after processing all the imports/exports so that we can follow exports as needed.
        if (fetcher) |fetch| {
            try this.getAllDependencies(reachable_files, fetch);
            return .{
                .output_files = std.array_list.Managed(options.OutputFile).init(alloc),
                .metafile = null,
            };
        }

        const output_files = try this.linker.generateChunksInParallel(chunks, false);

        // Generate metafile if requested
        const metafile: ?[]const u8 = if (this.linker.options.metafile)
            LinkerContext.MetafileBuilder.generate(bun.default_allocator, &this.linker, chunks) catch |err| blk: {
                bun.Output.warn("Failed to generate metafile: {s}", .{@errorName(err)});
                break :blk null;
            }
        else
            null;

        return .{
            .output_files = output_files,
            .metafile = metafile,
        };
    }

    pub fn generateFromBakeProductionCLI(
        entry_points: bake.production.EntryPointMap,
        server_transpiler: *Transpiler,
        bake_options: BakeOptions,
        alloc: std.mem.Allocator,
        event_loop: EventLoop,
    ) !std.array_list.Managed(options.OutputFile) {
        var this = try BundleV2.init(
            server_transpiler,
            bake_options,
            alloc,
            event_loop,
            false,
            null,
            .init(),
        );
        this.unique_key = generateUniqueKey();

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        try this.enqueueEntryPoints(.bake_production, entry_points);

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        this.waitForParse();

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        this.scanForSecondaryPaths();

        try this.processServerComponentManifestFiles();

        const reachable_files = try this.findReachableFiles();

        try this.processFilesToCopy(reachable_files);

        try this.addServerComponentBoundariesAsExtraEntryPoints();

        try this.cloneAST();

        const chunks = try this.linker.link(
            this,
            this.graph.entry_points.items,
            this.graph.server_component_boundaries,
            reachable_files,
        );

        if (chunks.len == 0) {
            return std.array_list.Managed(options.OutputFile).init(bun.default_allocator);
        }

        return try this.linker.generateChunksInParallel(chunks, false);
    }

    pub fn addServerComponentBoundariesAsExtraEntryPoints(this: *BundleV2) !void {
        // Prepare server component boundaries. Each boundary turns into two
        // entry points, a client entrypoint and a server entrypoint.
        //
        // TODO: This should be able to group components by the user specified
        // entry points. This way, using two component files in a route does not
        // create two separate chunks. (note: bake passes each route as an entrypoint)
        {
            const scbs = this.graph.server_component_boundaries.slice();
            try this.graph.entry_points.ensureUnusedCapacity(this.allocator(), scbs.list.len * 2);
            for (scbs.list.items(.source_index), scbs.list.items(.ssr_source_index)) |original_index, ssr_index| {
                inline for (.{ original_index, ssr_index }) |idx| {
                    this.graph.entry_points.appendAssumeCapacity(Index.init(idx));
                }
            }
        }
    }

    pub fn processFilesToCopy(this: *BundleV2, reachable_files: []const Index) !void {
        if (this.graph.estimated_file_loader_count > 0) {
            const file_allocators = this.graph.input_files.items(.allocator);
            const unique_key_for_additional_files = this.graph.input_files.items(.unique_key_for_additional_file);
            const content_hashes_for_additional_files = this.graph.input_files.items(.content_hash_for_additional_file);
            const sources: []const Logger.Source = this.graph.input_files.items(.source);
            const targets: []const options.Target = this.graph.ast.items(.target);
            var additional_output_files = std.array_list.Managed(options.OutputFile).init(this.transpiler.allocator);

            const additional_files: []BabyList(AdditionalFile) = this.graph.input_files.items(.additional_files);
            const loaders = this.graph.input_files.items(.loader);

            for (reachable_files) |reachable_source| {
                const index = reachable_source.get();
                const key = unique_key_for_additional_files[index];
                if (key.len > 0) {
                    var template = if (this.graph.html_imports.server_source_indices.len > 0 and this.transpiler.options.asset_naming.len == 0)
                        PathTemplate.assetWithTarget
                    else
                        PathTemplate.asset;

                    const target = targets[index];
                    const asset_naming = this.transpilerForTarget(target).options.asset_naming;
                    if (asset_naming.len > 0) {
                        template.data = asset_naming;
                    }

                    const source = &sources[index];

                    const output_path = brk: {
                        var pathname = source.path.name;

                        // TODO: outbase
                        pathname = Fs.PathName.init(bun.path.relativePlatform(this.transpiler.options.root_dir, source.path.text, .loose, false));

                        template.placeholder.name = pathname.base;
                        template.placeholder.dir = pathname.dir;
                        template.placeholder.ext = pathname.ext;
                        if (template.placeholder.ext.len > 0 and template.placeholder.ext[0] == '.')
                            template.placeholder.ext = template.placeholder.ext[1..];

                        if (template.needs(.hash)) {
                            template.placeholder.hash = content_hashes_for_additional_files[index];
                        }

                        if (template.needs(.target)) {
                            template.placeholder.target = @tagName(target);
                        }
                        break :brk bun.handleOom(std.fmt.allocPrint(bun.default_allocator, "{f}", .{template}));
                    };

                    const loader = loaders[index];

                    additional_output_files.append(options.OutputFile.init(.{
                        .source_index = .init(index),
                        .data = .{ .buffer = .{
                            .data = source.contents,
                            .allocator = file_allocators[index],
                        } },
                        .size = source.contents.len,
                        .output_path = output_path,
                        .input_path = bun.handleOom(bun.default_allocator.dupe(u8, source.path.text)),
                        .input_loader = .file,
                        .output_kind = .asset,
                        .loader = loader,
                        .hash = content_hashes_for_additional_files[index],
                        .side = .client,
                        .entry_point_index = null,
                        .is_executable = false,
                    })) catch unreachable;
                    additional_files[index].append(this.allocator(), AdditionalFile{
                        .output_file = @as(u32, @truncate(additional_output_files.items.len - 1)),
                    }) catch |err| bun.handleOom(err);
                }
            }

            this.graph.additional_output_files = additional_output_files.moveToUnmanaged();
        }
    }

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

    pub const BuildResult = struct {
        output_files: std.array_list.Managed(options.OutputFile),
        metafile: ?[]const u8 = null,

        pub fn deinit(this: *BuildResult) void {
            for (this.output_files.items) |*output_file| {
                output_file.deinit();
            }

            this.output_files.clearAndFree();

            if (this.metafile) |mf| {
                bun.default_allocator.free(mf);
                this.metafile = null;
            }
        }
    };

    pub const Result = union(enum) {
        pending: void,
        err: anyerror,
        value: BuildResult,

        pub fn deinit(this: *Result) void {
            switch (this.*) {
                .value => |*value| {
                    value.deinit();
                },
                else => {},
            }
        }
    };

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
            transpiler.options.code_splitting = config.code_splitting;
            transpiler.options.emit_dce_annotations = config.emit_dce_annotations orelse !config.minify.whitespace;
            transpiler.options.ignore_dce_annotations = config.ignore_dce_annotations;
            transpiler.options.css_chunking = config.css_chunking;
            transpiler.options.banner = config.banner.slice();
            transpiler.options.footer = config.footer.slice();
            transpiler.options.react_fast_refresh = config.react_fast_refresh;
            transpiler.options.metafile = config.metafile;

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

            for (output_files.items, 0..) |*current, i| {
                if (i != entry_point_index) {
                    current.deinit();
                }
            }

            const entry_point_output_file = output_files.swapRemove(entry_point_index);
            output_files.items.len = 1;
            output_files.items[0] = entry_point_output_file;

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

                    // Add metafile if it was generated (lazy parsing via getter)
                    if (build.metafile) |metafile| {
                        const metafile_js_str = bun.String.createUTF8ForJS(globalThis, metafile) catch |err| {
                            return promise.reject(globalThis, err);
                        };
                        // Set up lazy getter that parses JSON on first access and memoizes
                        Bun__setupLazyMetafile(globalThis, build_output, metafile_js_str);
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

    pub fn onLoadAsync(this: *BundleV2, load: *bun.jsc.API.JSBundler.Load) void {
        switch (this.loop().*) {
            .js => |jsc_event_loop| {
                jsc_event_loop.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(load, onLoadFromJsLoop));
            },
            .mini => |*mini| {
                mini.enqueueTaskConcurrentWithExtraCtx(
                    bun.jsc.API.JSBundler.Load,
                    BundleV2,
                    load,
                    BundleV2.onLoad,
                    .task,
                );
            },
        }
    }

    pub fn onResolveAsync(this: *BundleV2, resolve: *bun.jsc.API.JSBundler.Resolve) void {
        switch (this.loop().*) {
            .js => |jsc_event_loop| {
                jsc_event_loop.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(resolve, onResolveFromJsLoop));
            },
            .mini => |*mini| {
                mini.enqueueTaskConcurrentWithExtraCtx(
                    bun.jsc.API.JSBundler.Resolve,
                    BundleV2,
                    resolve,
                    BundleV2.onResolve,
                    .task,
                );
            },
        }
    }

    pub fn onLoadFromJsLoop(load: *bun.jsc.API.JSBundler.Load) void {
        onLoad(load, load.bv2);
    }

    pub fn onLoad(load: *bun.jsc.API.JSBundler.Load, this: *BundleV2) void {
        debug("onLoad: ({d}, {s})", .{ load.source_index.get(), @tagName(load.value) });
        defer load.deinit();
        defer {
            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.graph.heap.helpCatchMemoryIssues();
            }
        }
        const log = this.transpiler.log;

        // TODO: watcher

        switch (load.value.consume()) {
            .no_match => {
                const source = &this.graph.input_files.items(.source)[load.source_index.get()];
                // If it's a file namespace, we should run it through the parser like normal.
                // The file could be on disk.
                if (source.path.isFile()) {
                    this.graph.pool.schedule(load.parse_task);
                    return;
                }

                // When it's not a file, this is a build error and we should report it.
                // we have no way of loading non-files.
                log.addErrorFmt(source, Logger.Loc.Empty, bun.default_allocator, "Module not found {f} in namespace {f}", .{
                    bun.fmt.quote(source.path.pretty),
                    bun.fmt.quote(source.path.namespace),
                }) catch {};

                // An error occurred, prevent spinning the event loop forever
                this.decrementScanCounter();
            },
            .success => |code| {
                // When a plugin returns a file loader, we always need to populate additional_files
                const should_copy_for_bundling = code.loader.shouldCopyForBundling();
                if (should_copy_for_bundling) {
                    const source_index = load.source_index;
                    var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                    bun.handleOom(additional_files.append(this.allocator(), .{ .source_index = source_index.get() }));
                    this.graph.input_files.items(.side_effects)[source_index.get()] = .no_side_effects__pure_data;
                    this.graph.estimated_file_loader_count += 1;
                }
                this.graph.input_files.items(.loader)[load.source_index.get()] = code.loader;
                this.graph.input_files.items(.source)[load.source_index.get()].contents = code.source_code;
                this.graph.input_files.items(.is_plugin_file)[load.source_index.get()] = true;
                var parse_task = load.parse_task;
                parse_task.loader = code.loader;
                if (!should_copy_for_bundling) this.free_list.append(code.source_code) catch unreachable;
                parse_task.contents_or_fd = .{
                    .contents = code.source_code,
                };
                this.graph.pool.schedule(parse_task);

                if (this.bun_watcher) |watcher| add_watchers: {
                    if (!this.shouldAddWatcherPlugin(load.namespace, load.path)) break :add_watchers;

                    // TODO: support explicit watchFiles array. this is not done
                    // right now because DevServer requires a table to map
                    // watched files and dirs to their respective dependants.
                    const fd = if (bun.Watcher.requires_file_descriptors)
                        switch (bun.sys.open(
                            &(std.posix.toPosixPath(load.path) catch break :add_watchers),
                            bun.c.O_EVTONLY,
                            0,
                        )) {
                            .result => |fd| fd,
                            .err => break :add_watchers,
                        }
                    else
                        bun.invalid_fd;

                    _ = watcher.addFile(
                        fd,
                        load.path,
                        bun.Watcher.getHash(load.path),
                        code.loader,
                        bun.invalid_fd,
                        null,
                        true,
                    );
                }
            },
            .err => |msg| {
                if (this.transpiler.options.dev_server) |dev| {
                    const source = &this.graph.input_files.items(.source)[load.source_index.get()];
                    // A stack-allocated Log object containing the singular message
                    var msg_mut = msg;
                    const temp_log: Logger.Log = .{
                        .clone_line_text = false,
                        .errors = @intFromBool(msg.kind == .err),
                        .warnings = @intFromBool(msg.kind == .warn),
                        .msgs = std.array_list.Managed(Logger.Msg).fromOwnedSlice(this.allocator(), (&msg_mut)[0..1]),
                    };
                    dev.handleParseTaskFailure(
                        error.Plugin,
                        load.bakeGraph(),
                        source.path.keyForIncrementalGraph(),
                        &temp_log,
                        this,
                    ) catch |err| bun.handleOom(err);
                } else {
                    bun.handleOom(log.msgs.append(msg));
                    log.errors += @intFromBool(msg.kind == .err);
                    log.warnings += @intFromBool(msg.kind == .warn);
                }

                // An error occurred, prevent spinning the event loop forever
                this.decrementScanCounter();
            },
            .pending, .consumed => unreachable,
        }
    }

    pub fn onResolveFromJsLoop(resolve: *bun.jsc.API.JSBundler.Resolve) void {
        onResolve(resolve, resolve.bv2);
    }

    pub fn onResolve(resolve: *bun.jsc.API.JSBundler.Resolve, this: *BundleV2) void {
        defer resolve.deinit();
        defer this.decrementScanCounter();
        debug("onResolve: ({s}:{s}, {s})", .{ resolve.import_record.namespace, resolve.import_record.specifier, @tagName(resolve.value) });

        defer {
            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.graph.heap.helpCatchMemoryIssues();
            }
        }

        switch (resolve.value.consume()) {
            .no_match => {
                // If it's a file namespace, we should run it through the resolver like normal.
                //
                // The file could be on disk.
                if (strings.eqlComptime(resolve.import_record.namespace, "file")) {
                    if (resolve.import_record.kind == .entry_point_build) {
                        const target = resolve.import_record.original_target;
                        const resolved = this.transpilerForTarget(target).resolveEntryPoint(resolve.import_record.specifier) catch {
                            return;
                        };
                        const source_index = this.enqueueEntryItem(resolved, true, target) catch {
                            return;
                        };

                        // Store the original entry point name for virtual entries that fall back to file resolution
                        if (source_index) |idx| {
                            this.graph.entry_point_original_names.put(this.allocator(), idx, resolve.import_record.specifier) catch |err| bun.handleOom(err);
                        }
                        return;
                    }

                    this.runResolver(resolve.import_record, resolve.import_record.original_target);
                    return;
                }

                const log = this.logForResolutionFailures(resolve.import_record.source_file, resolve.import_record.original_target.bakeGraph());

                // When it's not a file, this is an error and we should report it.
                //
                // We have no way of loading non-files.
                if (resolve.import_record.kind == .entry_point_build) {
                    log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Module not found {f} in namespace {f}", .{
                        bun.fmt.quote(resolve.import_record.specifier),
                        bun.fmt.quote(resolve.import_record.namespace),
                    }) catch {};
                } else {
                    const source = &this.graph.input_files.items(.source)[resolve.import_record.importer_source_index];
                    log.addRangeErrorFmt(
                        source,
                        resolve.import_record.range,
                        bun.default_allocator,
                        "Module not found {f} in namespace {f}",
                        .{
                            bun.fmt.quote(resolve.import_record.specifier),
                            bun.fmt.quote(resolve.import_record.namespace),
                        },
                    ) catch {};
                }
            },
            .success => |result| {
                var out_source_index: ?Index = null;
                if (!result.external) {
                    var path = Fs.Path.init(result.path);
                    if (result.namespace.len == 0 or strings.eqlComptime(result.namespace, "file")) {
                        path.namespace = "file";
                    } else {
                        path.namespace = result.namespace;
                    }

                    const existing = this.pathToSourceIndexMap(resolve.import_record.original_target)
                        .getOrPutPath(this.allocator(), &path) catch |err| bun.handleOom(err);
                    if (!existing.found_existing) {
                        this.free_list.appendSlice(&.{ result.namespace, result.path }) catch {};
                        path = bun.handleOom(this.pathWithPrettyInitialized(path, resolve.import_record.original_target));
                        existing.key_ptr.* = path.text;

                        // We need to parse this
                        const source_index = Index.init(@as(u32, @intCast(this.graph.ast.len)));
                        existing.value_ptr.* = source_index.get();
                        out_source_index = source_index;
                        this.graph.ast.append(this.allocator(), JSAst.empty) catch unreachable;
                        const loader = path.loader(&this.transpiler.options.loaders) orelse options.Loader.file;

                        this.graph.input_files.append(this.allocator(), .{
                            .source = .{
                                .path = path,
                                .contents = "",
                                .index = source_index,
                            },
                            .loader = loader,
                            .side_effects = .has_side_effects,
                        }) catch unreachable;
                        var task = bun.default_allocator.create(ParseTask) catch unreachable;
                        task.* = ParseTask{
                            .ctx = this,
                            .path = path,
                            // unknown at this point:
                            .contents_or_fd = .{
                                .fd = .{
                                    .dir = bun.invalid_fd,
                                    .file = bun.invalid_fd,
                                },
                            },
                            .side_effects = .has_side_effects,
                            .jsx = this.transpilerForTarget(resolve.import_record.original_target).options.jsx,
                            .source_index = source_index,
                            .module_type = .unknown,
                            .loader = loader,
                            .tree_shaking = this.linker.options.tree_shaking,
                            .known_target = resolve.import_record.original_target,
                        };
                        task.task.node.next = null;
                        task.io_task.node.next = null;
                        this.incrementScanCounter();

                        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
                            if (loader.shouldCopyForBundling()) {
                                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                                bun.handleOom(additional_files.append(this.allocator(), .{ .source_index = task.source_index.get() }));
                                this.graph.input_files.items(.side_effects)[source_index.get()] = _resolver.SideEffects.no_side_effects__pure_data;
                                this.graph.estimated_file_loader_count += 1;
                            }

                            this.graph.pool.schedule(task);
                        }
                    } else {
                        out_source_index = Index.init(existing.value_ptr.*);
                        bun.default_allocator.free(result.namespace);
                        bun.default_allocator.free(result.path);
                    }
                } else {
                    bun.default_allocator.free(result.namespace);
                    bun.default_allocator.free(result.path);
                }

                if (out_source_index) |source_index| {
                    if (resolve.import_record.kind == .entry_point_build) {
                        this.graph.entry_points.append(this.allocator(), source_index) catch |err| bun.handleOom(err);

                        // Store the original entry point name for virtual entries
                        // This preserves the original name for output file naming
                        this.graph.entry_point_original_names.put(this.allocator(), source_index.get(), resolve.import_record.specifier) catch |err| bun.handleOom(err);
                    } else {
                        const source_import_records = &this.graph.ast.items(.import_records)[resolve.import_record.importer_source_index];
                        if (source_import_records.len <= resolve.import_record.import_record_index) {
                            const entry = this.resolve_tasks_waiting_for_import_source_index.getOrPut(
                                this.allocator(),
                                resolve.import_record.importer_source_index,
                            ) catch |err| bun.handleOom(err);
                            if (!entry.found_existing) {
                                entry.value_ptr.* = .{};
                            }
                            entry.value_ptr.append(
                                this.allocator(),
                                .{
                                    .to_source_index = source_index,
                                    .import_record_index = resolve.import_record.import_record_index,
                                },
                            ) catch |err| bun.handleOom(err);
                        } else {
                            const import_record: *ImportRecord = &source_import_records.slice()[resolve.import_record.import_record_index];
                            import_record.source_index = source_index;
                        }
                    }
                }
            },
            .err => |err| {
                const log = this.logForResolutionFailures(resolve.import_record.source_file, resolve.import_record.original_target.bakeGraph());
                log.msgs.append(err) catch unreachable;
                log.errors += @as(u32, @intFromBool(err.kind == .err));
                log.warnings += @as(u32, @intFromBool(err.kind == .warn));
            },
            .pending, .consumed => unreachable,
        }
    }

    pub fn deinitWithoutFreeingArena(this: *BundleV2) void {
        {
            // We do this first to make it harder for any dangling pointers to data to be used in there.
            var on_parse_finalizers = this.finalizers;
            this.finalizers = .{};
            for (on_parse_finalizers.items) |finalizer| {
                finalizer.call();
            }
            on_parse_finalizers.deinit(bun.default_allocator);
        }

        defer {
            this.graph.ast.deinit(this.allocator());
            this.graph.input_files.deinit(this.allocator());
            this.graph.entry_points.deinit(this.allocator());
            this.graph.entry_point_original_names.deinit(this.allocator());
        }

        if (this.graph.pool.workers_assignments.count() > 0) {
            {
                this.graph.pool.workers_assignments_lock.lock();
                defer this.graph.pool.workers_assignments_lock.unlock();
                for (this.graph.pool.workers_assignments.values()) |worker| {
                    worker.deinitSoon();
                }
                this.graph.pool.workers_assignments.deinit();
            }

            this.graph.pool.worker_pool.wakeForIdleEvents();
        }
        this.graph.pool.deinit();

        for (this.free_list.items) |free| {
            bun.default_allocator.free(free);
        }

        this.free_list.clearAndFree();
    }

    pub fn runFromJSInNewThread(
        this: *BundleV2,
        entry_points: []const []const u8,
    ) !BuildResult {
        this.unique_key = generateUniqueKey();

        if (this.transpiler.log.errors > 0) {
            return error.BuildFailed;
        }

        this.graph.heap.helpCatchMemoryIssues();

        try this.enqueueEntryPoints(.normal, entry_points);

        // We must wait for all the parse tasks to complete, even if there are errors.
        this.waitForParse();

        this.graph.heap.helpCatchMemoryIssues();

        if (this.transpiler.log.errors > 0) {
            return error.BuildFailed;
        }

        this.scanForSecondaryPaths();

        try this.processServerComponentManifestFiles();

        this.graph.heap.helpCatchMemoryIssues();

        try this.cloneAST();

        this.graph.heap.helpCatchMemoryIssues();

        const reachable_files = try this.findReachableFiles();

        try this.processFilesToCopy(reachable_files);

        try this.addServerComponentBoundariesAsExtraEntryPoints();

        const chunks = try this.linker.link(
            this,
            this.graph.entry_points.items,
            this.graph.server_component_boundaries,
            reachable_files,
        );

        if (this.transpiler.log.errors > 0) {
            return error.BuildFailed;
        }

        const output_files = try this.linker.generateChunksInParallel(chunks, false);

        // Generate metafile if requested
        const metafile: ?[]const u8 = if (this.linker.options.metafile)
            LinkerContext.MetafileBuilder.generate(bun.default_allocator, &this.linker, chunks) catch |err| blk: {
                bun.Output.warn("Failed to generate metafile: {s}", .{@errorName(err)});
                break :blk null;
            }
        else
            null;

        return .{
            .output_files = output_files,
            .metafile = metafile,
        };
    }

    fn shouldAddWatcherPlugin(bv2: *BundleV2, namespace: []const u8, path: []const u8) bool {
        return bun.strings.eqlComptime(namespace, "file") and
            std.fs.path.isAbsolute(path) and
            bv2.shouldAddWatcher(path);
    }

    fn shouldAddWatcher(bv2: *BundleV2, path: []const u8) bool {
        return if (bv2.transpiler.options.dev_server != null)
            bun.strings.indexOf(path, "/node_modules/") == null and
                (if (Environment.isWindows) bun.strings.indexOf(path, "\\node_modules\\") == null else true)
        else
            true; // `bun build --watch` has always watched node_modules
    }

    /// Dev Server uses this instead to run a subset of the transpiler, and to run it asynchronously.
    pub fn startFromBakeDevServer(this: *BundleV2, bake_entry_points: bake.DevServer.EntryPointList) !DevServerInput {
        this.unique_key = generateUniqueKey();

        this.graph.heap.helpCatchMemoryIssues();

        var ctx: DevServerInput = .{
            .css_entry_points = .{},
        };
        try this.enqueueEntryPoints(.dev_server, .{
            .files = bake_entry_points,
            .css_data = &ctx.css_entry_points,
        });

        this.graph.heap.helpCatchMemoryIssues();

        return ctx;
    }

    pub fn finishFromBakeDevServer(this: *BundleV2, dev_server: *bake.DevServer) bun.OOM!void {
        const start = &dev_server.current_bundle.?.start_data;

        this.graph.heap.helpCatchMemoryIssues();

        try this.cloneAST();

        this.graph.heap.helpCatchMemoryIssues();

        this.dynamic_import_entry_points = .init(this.allocator());
        var html_files: std.AutoArrayHashMapUnmanaged(Index, void) = .{};

        // Separate non-failing files into two lists: JS and CSS
        const js_reachable_files = reachable_files: {
            var css_total_files = try std.ArrayListUnmanaged(Index).initCapacity(this.allocator(), this.graph.css_file_count);
            try start.css_entry_points.ensureUnusedCapacity(this.allocator(), this.graph.css_file_count);
            var js_files = try std.ArrayListUnmanaged(Index).initCapacity(this.allocator(), this.graph.ast.len - this.graph.css_file_count - 1);

            const asts = this.graph.ast.slice();
            const css_asts = asts.items(.css);

            const input_files = this.graph.input_files.slice();
            const loaders = input_files.items(.loader);
            const sources = input_files.items(.source);
            for (
                asts.items(.parts)[1..],
                asts.items(.import_records)[1..],
                css_asts[1..],
                asts.items(.target)[1..],
                1..,
            ) |part_list, import_records, maybe_css, target, index| {
                // Dev Server proceeds even with failed files.
                // These files are filtered out via the lack of any parts.
                //
                // Actual empty files will contain a part exporting an empty object.
                if (part_list.len != 0) {
                    if (maybe_css != null) {
                        // CSS has restrictions on what files can be imported.
                        // This means the file can become an error after
                        // resolution, which is not usually the case.
                        css_total_files.appendAssumeCapacity(Index.init(index));
                        var log = Logger.Log.init(this.allocator());
                        defer log.deinit();
                        if (this.linker.scanCSSImports(
                            @intCast(index),
                            import_records.slice(),
                            css_asts,
                            sources,
                            loaders,
                            &log,
                        ) == .errors) {
                            // TODO: it could be possible for a plugin to change
                            // the type of loader from whatever it was into a
                            // css-compatible loader.
                            try dev_server.handleParseTaskFailure(
                                error.InvalidCssImport,
                                .client,
                                sources[index].path.text,
                                &log,
                                this,
                            );
                            // Since there is an error, do not treat it as a
                            // valid CSS chunk.
                            _ = start.css_entry_points.swapRemove(Index.init(index));
                        }
                    } else {
                        // HTML files are special cased because they correspond
                        // to routes in DevServer. They have a JS chunk too,
                        // derived off of the import record list.
                        if (loaders[index] == .html) {
                            try html_files.put(this.allocator(), Index.init(index), {});
                        } else {
                            js_files.appendAssumeCapacity(Index.init(index));

                            // Mark every part live.
                            for (part_list.slice()) |*p| {
                                p.is_live = true;
                            }
                        }

                        // Discover all CSS roots.
                        for (import_records.slice()) |*record| {
                            if (!record.source_index.isValid()) continue;
                            if (loaders[record.source_index.get()] != .css) continue;
                            if (asts.items(.parts)[record.source_index.get()].len == 0) {
                                record.source_index = Index.invalid;
                                continue;
                            }

                            const gop = start.css_entry_points.getOrPutAssumeCapacity(record.source_index);
                            if (target != .browser)
                                gop.value_ptr.* = .{ .imported_on_server = true }
                            else if (!gop.found_existing)
                                gop.value_ptr.* = .{ .imported_on_server = false };
                        }
                    }
                } else {
                    // Treat empty CSS files for removal.
                    _ = start.css_entry_points.swapRemove(Index.init(index));
                }
            }

            // Find CSS entry points. Originally, this was computed up front, but
            // failed files do not remember their loader, and plugins can
            // asynchronously decide a file is CSS.
            const css = asts.items(.css);
            for (this.graph.entry_points.items) |entry_point| {
                if (css[entry_point.get()] != null) {
                    try start.css_entry_points.put(
                        this.allocator(),
                        entry_point,
                        .{ .imported_on_server = false },
                    );
                }
            }

            break :reachable_files js_files.items;
        };

        this.graph.heap.helpCatchMemoryIssues();

        // HMR skips most of the linker! All linking errors are converted into
        // runtime errors to avoid a more complicated dependency graph. For
        // example, if you remove an exported symbol, we only rebuild the
        // changed file, then detect the missing export at runtime.
        //
        // Additionally, notice that we run this code generation even if we have
        // files that failed. This allows having a large build graph (importing
        // a new npm dependency), where one file that fails doesnt prevent the
        // passing files to get cached in the incremental graph.

        // The linker still has to be initialized as code generation expects
        // much of its state to be valid memory, even if empty.
        try this.linker.load(
            this,
            this.graph.entry_points.items,
            this.graph.server_component_boundaries,
            js_reachable_files,
        );

        this.graph.heap.helpCatchMemoryIssues();

        // Compute line offset tables and quoted contents, used in source maps.
        // Quoted contents will be default-allocated
        if (Environment.isDebug) for (js_reachable_files) |idx| {
            bun.assert(this.graph.ast.items(.parts)[idx.get()].len != 0); // will create a memory leak
        };
        this.linker.computeDataForSourceMap(@as([]Index.Int, @ptrCast(js_reachable_files)));
        errdefer {
            // reminder that the caller cannot handle this error, since source contents
            // are default-allocated. the only option is to crash here.
            bun.outOfMemory();
        }

        this.graph.heap.helpCatchMemoryIssues();

        // Generate chunks
        const js_part_ranges = try this.allocator().alloc(PartRange, js_reachable_files.len);
        const parts = this.graph.ast.items(.parts);
        for (js_reachable_files, js_part_ranges) |source_index, *part_range| {
            part_range.* = .{
                .source_index = source_index,
                .part_index_begin = 0,
                .part_index_end = parts[source_index.get()].len,
            };
        }

        const chunks = try this.allocator().alloc(
            Chunk,
            1 + start.css_entry_points.count() + html_files.count(),
        );

        // First is a chunk to contain all JavaScript modules.
        chunks[0] = .{
            .entry_point = .{
                .entry_point_id = 0,
                .source_index = 0,
                .is_entry_point = true,
            },
            .content = .{
                .javascript = .{
                    // TODO(@paperclover): remove this ptrCast when Source Index is fixed
                    .files_in_chunk_order = @ptrCast(js_reachable_files),
                    .parts_in_chunk_in_order = js_part_ranges,
                },
            },
            .output_source_map = SourceMap.SourceMapPieces.init(this.allocator()),
        };

        // Then all the distinct CSS bundles (these are JS->CSS, not CSS->CSS)
        for (chunks[1..][0..start.css_entry_points.count()], start.css_entry_points.keys()) |*chunk, entry_point| {
            const order = this.linker.findImportedFilesInCSSOrder(this.allocator(), &.{entry_point});
            chunk.* = .{
                .entry_point = .{
                    .entry_point_id = @intCast(entry_point.get()),
                    .source_index = entry_point.get(),
                    .is_entry_point = false,
                },
                .content = .{
                    .css = .{
                        .imports_in_chunk_in_order = order,
                        .asts = try this.allocator().alloc(bun.css.BundlerStyleSheet, order.len),
                    },
                },
                .output_source_map = SourceMap.SourceMapPieces.init(this.allocator()),
            };
        }

        // Then all HTML files
        for (html_files.keys(), chunks[1 + start.css_entry_points.count() ..]) |source_index, *chunk| {
            chunk.* = .{
                .entry_point = .{
                    .entry_point_id = @intCast(source_index.get()),
                    .source_index = source_index.get(),
                    .is_entry_point = false,
                },
                .content = .html,
                .output_source_map = SourceMap.SourceMapPieces.init(this.allocator()),
            };
        }

        this.graph.heap.helpCatchMemoryIssues();

        try this.linker.generateChunksInParallel(chunks, true);
        errdefer {
            // reminder that the caller cannot handle this error, since
            // the contents in this generation are default-allocated.
            bun.outOfMemory();
        }

        this.graph.heap.helpCatchMemoryIssues();

        try dev_server.finalizeBundle(this, &.{
            .chunks = chunks,
            .css_file_list = start.css_entry_points,
            .html_files = html_files,
        });
    }

    pub fn enqueueOnResolvePluginIfNeeded(
        this: *BundleV2,
        source_index: Index.Int,
        import_record: *const ImportRecord,
        source_file: []const u8,
        import_record_index: u32,
        original_target: options.Target,
    ) bool {
        if (this.plugins) |plugins| {
            if (plugins.hasAnyMatches(&import_record.path, false)) {
                // This is where onResolve plugins are enqueued
                var resolve: *jsc.API.JSBundler.Resolve = bun.default_allocator.create(jsc.API.JSBundler.Resolve) catch unreachable;
                debug("enqueue onResolve: {s}:{s}", .{
                    import_record.path.namespace,
                    import_record.path.text,
                });
                this.incrementScanCounter();

                resolve.* = jsc.API.JSBundler.Resolve.init(this, .{
                    .kind = import_record.kind,
                    .source_file = source_file,
                    .namespace = import_record.path.namespace,
                    .specifier = import_record.path.text,
                    .importer_source_index = source_index,
                    .import_record_index = import_record_index,
                    .range = import_record.range,
                    .original_target = original_target,
                });

                resolve.dispatch();
                return true;
            }
        }

        return false;
    }

    pub fn enqueueEntryPointOnResolvePluginIfNeeded(
        this: *BundleV2,
        entry_point: []const u8,
        target: options.Target,
    ) bool {
        if (this.plugins) |plugins| {
            var temp_path = Fs.Path.init(entry_point);
            temp_path.namespace = "file";
            if (plugins.hasAnyMatches(&temp_path, false)) {
                debug("Entry point '{s}' plugin match", .{entry_point});

                var resolve: *jsc.API.JSBundler.Resolve = bun.default_allocator.create(jsc.API.JSBundler.Resolve) catch unreachable;
                this.incrementScanCounter();

                resolve.* = jsc.API.JSBundler.Resolve.init(this, .{
                    .kind = .entry_point_build,
                    .source_file = "", // No importer for entry points
                    .namespace = "file",
                    .specifier = entry_point,
                    .importer_source_index = std.math.maxInt(u32), // Sentinel value for entry points
                    .import_record_index = 0,
                    .range = Logger.Range.None,
                    .original_target = target,
                });

                resolve.dispatch();
                return true;
            }
        }
        return false;
    }

    pub fn enqueueOnLoadPluginIfNeeded(this: *BundleV2, parse: *ParseTask) bool {
        const had_matches = enqueueOnLoadPluginIfNeededImpl(this, parse);
        if (had_matches) return true;

        if (bun.strings.eqlComptime(parse.path.namespace, "dataurl")) {
            const maybe_data_url = DataURL.parse(parse.path.text) catch return false;
            const data_url = maybe_data_url orelse return false;
            const maybe_decoded = data_url.decodeData(bun.default_allocator) catch return false;
            bun.handleOom(this.free_list.append(maybe_decoded));
            parse.contents_or_fd = .{
                .contents = maybe_decoded,
            };
            parse.loader = switch (data_url.decodeMimeType().category) {
                .javascript => .js,
                .css => .css,
                .json => .json,
                else => parse.loader,
            };
        }

        return false;
    }

    pub fn enqueueOnLoadPluginIfNeededImpl(this: *BundleV2, parse: *ParseTask) bool {
        if (this.plugins) |plugins| {
            if (plugins.hasAnyMatches(&parse.path, true)) {
                // This is where onLoad plugins are enqueued
                debug("enqueue onLoad: {s}:{s}", .{
                    parse.path.namespace,
                    parse.path.text,
                });
                const load = bun.handleOom(bun.default_allocator.create(jsc.API.JSBundler.Load));
                load.* = jsc.API.JSBundler.Load.init(this, parse);
                load.dispatch();
                return true;
            }
        }

        return false;
    }

    fn pathWithPrettyInitialized(this: *BundleV2, path: Fs.Path, target: options.Target) !Fs.Path {
        return genericPathWithPrettyInitialized(path, target, this.transpiler.fs.top_level_dir, this.allocator());
    }

    fn reserveSourceIndexesForBake(this: *BundleV2) !void {
        const fw = this.framework orelse return;
        _ = fw.server_components orelse return;

        // Call this after
        bun.assert(this.graph.input_files.len == 1);
        bun.assert(this.graph.ast.len == 1);

        try this.graph.ast.ensureUnusedCapacity(this.allocator(), 2);
        try this.graph.input_files.ensureUnusedCapacity(this.allocator(), 2);

        const server_source = bake.server_virtual_source;
        const client_source = bake.client_virtual_source;

        this.graph.input_files.appendAssumeCapacity(.{
            .source = server_source,
            .loader = .js,
            .side_effects = .no_side_effects__pure_data,
        });
        this.graph.input_files.appendAssumeCapacity(.{
            .source = client_source,
            .loader = .js,
            .side_effects = .no_side_effects__pure_data,
        });

        bun.assert(this.graph.input_files.items(.source)[Index.bake_server_data.get()].index.get() == Index.bake_server_data.get());
        bun.assert(this.graph.input_files.items(.source)[Index.bake_client_data.get()].index.get() == Index.bake_client_data.get());

        this.graph.ast.appendAssumeCapacity(JSAst.empty);
        this.graph.ast.appendAssumeCapacity(JSAst.empty);
    }

    // TODO: remove ResolveQueue
    //
    // Moving this to the Bundle thread was a significant perf improvement on Linux for first builds
    //
    // The problem is that module resolution has many mutexes.
    // The downside is cached resolutions are faster to do in threads since they only lock very briefly.
    fn runResolutionForParseTask(parse_result: *ParseTask.Result, this: *BundleV2) ResolveQueue {
        var ast = &parse_result.value.success.ast;
        const source = &parse_result.value.success.source;
        const loader = parse_result.value.success.loader;
        const source_dir = source.path.sourceDir();
        var estimated_resolve_queue_count: usize = 0;
        for (ast.import_records.slice()) |*import_record| {
            if (import_record.flags.is_internal) {
                import_record.tag = .runtime;
                import_record.source_index = Index.runtime;
            }

            if (import_record.flags.is_unused) {
                import_record.source_index = Index.invalid;
            }

            estimated_resolve_queue_count += @as(usize, @intFromBool(!(import_record.flags.is_internal or import_record.flags.is_unused or import_record.source_index.isValid())));
        }
        var resolve_queue = ResolveQueue.init(this.allocator());
        bun.handleOom(resolve_queue.ensureTotalCapacity(@intCast(estimated_resolve_queue_count)));

        var last_error: ?anyerror = null;

        outer: for (ast.import_records.slice(), 0..) |*import_record, i| {
            // Preserve original import specifier before resolution modifies path
            if (import_record.original_path.len == 0) {
                import_record.original_path = import_record.path.text;
            }

            if (
            // Don't resolve TypeScript types
            import_record.flags.is_unused or

                // Don't resolve the runtime
                import_record.flags.is_internal or

                // Don't resolve pre-resolved imports
                import_record.source_index.isValid())
            {
                continue;
            }

            if (this.framework) |fw| if (fw.server_components != null) {
                switch (ast.target.isServerSide()) {
                    inline else => |is_server| {
                        const src = if (is_server) bake.server_virtual_source else bake.client_virtual_source;
                        if (strings.eqlComptime(import_record.path.text, src.path.pretty)) {
                            if (this.transpiler.options.dev_server != null) {
                                import_record.flags.is_external_without_side_effects = true;
                                import_record.source_index = Index.invalid;
                            } else {
                                if (is_server) {
                                    this.graph.kit_referenced_server_data = true;
                                } else {
                                    this.graph.kit_referenced_client_data = true;
                                }
                                import_record.path.namespace = "bun";
                                import_record.source_index = src.index;
                            }
                            continue;
                        }
                    },
                }
            };

            if (strings.eqlComptime(import_record.path.text, "bun:wrap")) {
                import_record.path.namespace = "bun";
                import_record.tag = .runtime;
                import_record.path.text = "wrap";
                import_record.source_index = .runtime;
                continue;
            }

            if (ast.target.isBun()) {
                if (jsc.ModuleLoader.HardcodedModule.Alias.get(import_record.path.text, .bun, .{ .rewrite_jest_for_tests = this.transpiler.options.rewrite_jest_for_tests })) |replacement| {
                    // When bundling node builtins, remove the "node:" prefix.
                    // This supports special use cases where the bundle is put
                    // into a non-node module resolver that doesn't support
                    // node's prefix. https://github.com/oven-sh/bun/issues/18545
                    import_record.path.text = if (replacement.node_builtin and !replacement.node_only_prefix)
                        replacement.path[5..]
                    else
                        replacement.path;
                    import_record.tag = replacement.tag;
                    import_record.source_index = Index.invalid;
                    import_record.flags.is_external_without_side_effects = true;
                    continue;
                }

                if (strings.hasPrefixComptime(import_record.path.text, "bun:")) {
                    import_record.path = Fs.Path.init(import_record.path.text["bun:".len..]);
                    import_record.path.namespace = "bun";
                    import_record.source_index = Index.invalid;
                    import_record.flags.is_external_without_side_effects = true;

                    // don't link bun
                    continue;
                }
            }

            // By default, we treat .sqlite files as external.
            if (import_record.loader != null and import_record.loader.? == .sqlite) {
                import_record.flags.is_external_without_side_effects = true;
                continue;
            }

            if (import_record.loader != null and import_record.loader.? == .sqlite_embedded) {
                import_record.flags.is_external_without_side_effects = true;
            }

            if (this.enqueueOnResolvePluginIfNeeded(source.index.get(), import_record, source.path.text, @as(u32, @truncate(i)), ast.target)) {
                continue;
            }

            const transpiler: *Transpiler, const bake_graph: bake.Graph, const target: options.Target =
                if (import_record.tag == .bake_resolve_to_ssr_graph) brk: {
                    if (this.framework == null) {
                        this.logForResolutionFailures(source.path.text, .ssr).addErrorFmt(
                            source,
                            import_record.range.loc,
                            this.allocator(),
                            "The 'bunBakeGraph' import attribute cannot be used outside of a Bun Bake bundle",
                            .{},
                        ) catch @panic("unexpected log error");
                        continue;
                    }

                    const is_supported = this.framework.?.server_components != null and
                        this.framework.?.server_components.?.separate_ssr_graph;
                    if (!is_supported) {
                        this.logForResolutionFailures(source.path.text, .ssr).addErrorFmt(
                            source,
                            import_record.range.loc,
                            this.allocator(),
                            "Framework does not have a separate SSR graph to put this import into",
                            .{},
                        ) catch @panic("unexpected log error");
                        continue;
                    }

                    break :brk .{
                        this.ssr_transpiler,
                        .ssr,
                        .bake_server_components_ssr,
                    };
                } else .{
                    this.transpilerForTarget(ast.target),
                    ast.target.bakeGraph(),
                    ast.target,
                };

            // Check the FileMap first for in-memory files
            if (this.file_map) |file_map| {
                if (file_map.resolve(source.path.text, import_record.path.text)) |_file_map_result| {
                    var file_map_result = _file_map_result;
                    var path_primary = file_map_result.path_pair.primary;
                    const import_record_loader = import_record.loader orelse Fs.Path.init(path_primary.text).loader(&transpiler.options.loaders) orelse .file;
                    import_record.loader = import_record_loader;

                    if (this.pathToSourceIndexMap(target).get(path_primary.text)) |id| {
                        import_record.source_index = .init(id);
                        continue;
                    }

                    const resolve_entry = resolve_queue.getOrPut(path_primary.text) catch |err| bun.handleOom(err);
                    if (resolve_entry.found_existing) {
                        import_record.path = resolve_entry.value_ptr.*.path;
                        continue;
                    }

                    // For virtual files, use the path text as-is (no relative path computation needed).
                    path_primary.pretty = bun.handleOom(this.allocator().dupe(u8, path_primary.text));
                    import_record.path = path_primary;
                    resolve_entry.key_ptr.* = path_primary.text;
                    debug("created ParseTask from FileMap: {s}", .{path_primary.text});
                    const resolve_task = bun.handleOom(bun.default_allocator.create(ParseTask));
                    file_map_result.path_pair.primary = path_primary;
                    resolve_task.* = ParseTask.init(&file_map_result, Index.invalid, this);
                    resolve_task.known_target = target;
                    // Use transpiler JSX options, applying force_node_env like the disk path does
                    resolve_task.jsx = transpiler.options.jsx;
                    resolve_task.jsx.development = switch (transpiler.options.force_node_env) {
                        .development => true,
                        .production => false,
                        .unspecified => transpiler.options.jsx.development,
                    };
                    resolve_task.loader = import_record_loader;
                    resolve_task.tree_shaking = transpiler.options.tree_shaking;
                    resolve_task.side_effects = .has_side_effects;
                    resolve_entry.value_ptr.* = resolve_task;
                    continue;
                }
            }

            var had_busted_dir_cache = false;
            var resolve_result: _resolver.Result = inner: while (true) break transpiler.resolver.resolveWithFramework(
                source_dir,
                import_record.path.text,
                import_record.kind,
            ) catch |err| {
                const log = this.logForResolutionFailures(source.path.text, bake_graph);

                // Only perform directory busting when hot-reloading is enabled
                if (err == error.ModuleNotFound) {
                    if (this.bun_watcher != null) {
                        if (!had_busted_dir_cache) {
                            bun.Output.scoped(.watcher, .visible)("busting dir cache {s} -> {s}", .{ source.path.text, import_record.path.text });
                            // Only re-query if we previously had something cached.
                            if (transpiler.resolver.bustDirCacheFromSpecifier(
                                source.path.text,
                                import_record.path.text,
                            )) {
                                had_busted_dir_cache = true;
                                continue :inner;
                            }
                        }
                        if (this.transpiler.options.dev_server) |dev| {
                            // Tell DevServer about the resolution failure.
                            dev.directory_watchers.trackResolutionFailure(
                                source.path.text,
                                import_record.path.text,
                                ast.target.bakeGraph(), // use the source file target not the altered one
                                loader,
                            ) catch |e| bun.handleOom(e);
                        }
                    }
                }

                // Disable failing packages from being printed.
                // This may cause broken code to write.
                // However, doing this means we tell them all the resolve errors
                // Rather than just the first one.
                import_record.path.is_disabled = true;

                switch (err) {
                    error.ModuleNotFound => {
                        const addError = Logger.Log.addResolveErrorWithTextDupe;

                        if (!import_record.flags.handles_import_errors and !this.transpiler.options.ignore_module_resolution_errors) {
                            last_error = err;
                            if (isPackagePath(import_record.path.text)) {
                                if (ast.target == .browser and options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                    addError(
                                        log,
                                        source,
                                        import_record.range,
                                        this.allocator(),
                                        "Browser build cannot {s} Node.js builtin: \"{s}\"{s}",
                                        .{
                                            import_record.kind.errorLabel(),
                                            import_record.path.text,
                                            if (this.transpiler.options.dev_server == null)
                                                ". To use Node.js builtins, set target to 'node' or 'bun'"
                                            else
                                                "",
                                        },
                                        import_record.kind,
                                    ) catch |e| bun.handleOom(e);
                                } else if (!ast.target.isBun() and strings.eqlComptime(import_record.path.text, "bun")) {
                                    addError(
                                        log,
                                        source,
                                        import_record.range,
                                        this.allocator(),
                                        "Browser build cannot {s} Bun builtin: \"{s}\"{s}",
                                        .{
                                            import_record.kind.errorLabel(),
                                            import_record.path.text,
                                            if (this.transpiler.options.dev_server == null)
                                                ". When bundling for Bun, set target to 'bun'"
                                            else
                                                "",
                                        },
                                        import_record.kind,
                                    ) catch |e| bun.handleOom(e);
                                } else if (!ast.target.isBun() and strings.hasPrefixComptime(import_record.path.text, "bun:")) {
                                    addError(
                                        log,
                                        source,
                                        import_record.range,
                                        this.allocator(),
                                        "Browser build cannot {s} Bun builtin: \"{s}\"{s}",
                                        .{
                                            import_record.kind.errorLabel(),
                                            import_record.path.text,
                                            if (this.transpiler.options.dev_server == null)
                                                ". When bundling for Bun, set target to 'bun'"
                                            else
                                                "",
                                        },
                                        import_record.kind,
                                    ) catch |e| bun.handleOom(e);
                                } else {
                                    addError(
                                        log,
                                        source,
                                        import_record.range,
                                        this.allocator(),
                                        "Could not resolve: \"{s}\". Maybe you need to \"bun install\"?",
                                        .{import_record.path.text},
                                        import_record.kind,
                                    ) catch |e| bun.handleOom(e);
                                }
                            } else {
                                const buf = bun.path_buffer_pool.get();
                                defer bun.path_buffer_pool.put(buf);
                                const specifier_to_use = if (loader == .html and bun.strings.hasPrefix(import_record.path.text, bun.fs.FileSystem.instance.top_level_dir)) brk: {
                                    const specifier_to_use = import_record.path.text[bun.fs.FileSystem.instance.top_level_dir.len..];
                                    if (Environment.isWindows) {
                                        break :brk bun.path.pathToPosixBuf(u8, specifier_to_use, buf);
                                    }
                                    break :brk specifier_to_use;
                                } else import_record.path.text;
                                addError(
                                    log,
                                    source,
                                    import_record.range,
                                    this.allocator(),
                                    "Could not resolve: \"{s}\"",
                                    .{specifier_to_use},
                                    import_record.kind,
                                ) catch |e| bun.handleOom(e);
                            }
                        }
                    },
                    // assume other errors are already in the log
                    else => {
                        last_error = err;
                    },
                }
                continue :outer;
            };
            // if there were errors, lets go ahead and collect them all
            if (last_error != null) continue;

            const path: *Fs.Path = resolve_result.path() orelse {
                import_record.path.is_disabled = true;
                import_record.source_index = Index.invalid;

                continue;
            };

            if (resolve_result.flags.is_external) {
                if (resolve_result.flags.is_external_and_rewrite_import_path and !strings.eqlLong(resolve_result.path_pair.primary.text, import_record.path.text, true)) {
                    import_record.path = resolve_result.path_pair.primary;
                }
                import_record.flags.is_external_without_side_effects = resolve_result.primary_side_effects_data != .has_side_effects;
                continue;
            }

            if (this.transpiler.options.dev_server) |dev_server| brk: {
                if (path.loader(&this.transpiler.options.loaders) == .html and (import_record.loader == null or import_record.loader.? == .html)) {
                    // This use case is currently not supported. This error
                    // blocks an assertion failure because the DevServer
                    // reserves the HTML file's spot in IncrementalGraph for the
                    // route definition.
                    const log = this.logForResolutionFailures(source.path.text, bake_graph);
                    log.addRangeErrorFmt(
                        source,
                        import_record.range,
                        this.allocator(),
                        "Browser builds cannot import HTML files.",
                        .{},
                    ) catch |err| bun.handleOom(err);
                    continue;
                }

                if (loader == .css) {
                    // Do not use cached files for CSS.
                    break :brk;
                }

                import_record.source_index = Index.invalid;

                if (dev_server.isFileCached(path.text, bake_graph)) |entry| {
                    const rel = bun.path.relativePlatform(this.transpiler.fs.top_level_dir, path.text, .loose, false);
                    if (loader == .html and entry.kind == .asset) {
                        // Overload `path.text` to point to the final URL
                        // This information cannot be queried while printing because a lock wouldn't get held.
                        const hash = dev_server.assets.getHash(path.text) orelse @panic("cached asset not found");
                        import_record.path.text = path.text;
                        import_record.path.namespace = "file";
                        import_record.path.pretty = std.fmt.allocPrint(this.allocator(), bun.bake.DevServer.asset_prefix ++ "/{s}{s}", .{
                            &std.fmt.bytesToHex(std.mem.asBytes(&hash), .lower),
                            std.fs.path.extension(path.text),
                        }) catch |err| bun.handleOom(err);
                        import_record.path.is_disabled = false;
                    } else {
                        import_record.path.text = path.text;
                        import_record.path.pretty = rel;
                        import_record.path = bun.handleOom(this.pathWithPrettyInitialized(path.*, target));
                        if (loader == .html or entry.kind == .css) {
                            import_record.path.is_disabled = true;
                        }
                    }
                    continue;
                }
            }

            const import_record_loader = import_record.loader orelse path.loader(&transpiler.options.loaders) orelse .file;
            import_record.loader = import_record_loader;

            const is_html_entrypoint = import_record_loader == .html and target.isServerSide() and this.transpiler.options.dev_server == null;

            if (this.pathToSourceIndexMap(target).get(path.text)) |id| {
                if (this.transpiler.options.dev_server != null and loader != .html) {
                    import_record.path = this.graph.input_files.items(.source)[id].path;
                } else {
                    import_record.source_index = .init(id);
                }
                continue;
            }

            if (is_html_entrypoint) {
                import_record.kind = .html_manifest;
            }

            const resolve_entry = resolve_queue.getOrPut(path.text) catch |err| bun.handleOom(err);
            if (resolve_entry.found_existing) {
                import_record.path = resolve_entry.value_ptr.*.path;
                continue;
            }

            path.* = bun.handleOom(this.pathWithPrettyInitialized(path.*, target));

            import_record.path = path.*;
            resolve_entry.key_ptr.* = path.text;
            debug("created ParseTask: {s}", .{path.text});
            const resolve_task = bun.handleOom(bun.default_allocator.create(ParseTask));
            resolve_task.* = ParseTask.init(&resolve_result, Index.invalid, this);

            resolve_task.known_target = if (import_record.kind == .html_manifest)
                .browser
            else
                target;

            resolve_task.jsx = resolve_result.jsx;
            resolve_task.jsx.development = switch (transpiler.options.force_node_env) {
                .development => true,
                .production => false,
                .unspecified => transpiler.options.jsx.development,
            };

            resolve_task.loader = import_record_loader;
            resolve_task.tree_shaking = transpiler.options.tree_shaking;
            resolve_entry.value_ptr.* = resolve_task;
            if (resolve_result.path_pair.secondary) |*secondary| {
                if (!secondary.is_disabled and
                    secondary != path and
                    !strings.eqlLong(secondary.text, path.text, true))
                {
                    resolve_task.secondary_path_for_commonjs_interop = secondary.dupeAlloc(this.allocator()) catch |err| bun.handleOom(err);
                }
            }

            if (is_html_entrypoint) {
                this.generateServerHTMLModule(path, target, import_record, path.text) catch unreachable;
            }
        }

        if (last_error) |err| {
            debug("failed with error: {s}", .{@errorName(err)});
            resolve_queue.clearAndFree();
            parse_result.value = .{
                .err = .{
                    .err = err,
                    .step = .resolve,
                    .log = Logger.Log.init(bun.default_allocator),
                    .source_index = source.index,
                    .target = ast.target,
                },
            };
        }

        return resolve_queue;
    }

    fn generateServerHTMLModule(this: *BundleV2, path: *const Fs.Path, target: options.Target, import_record: *ImportRecord, path_text: []const u8) !void {
        // 1. Create the ast right here
        // 2. Create a separate "virutal" module that becomes the manifest later on.
        // 3. Add it to the graph
        const graph = &this.graph;
        const empty_html_file_source: Logger.Source = .{
            .path = path.*,
            .index = Index.source(graph.input_files.len),
            .contents = "",
        };
        var js_parser_options = bun.js_parser.Parser.Options.init(this.transpilerForTarget(target).options.jsx, .html);
        js_parser_options.bundle = true;

        const unique_key = try std.fmt.allocPrint(this.allocator(), "{f}H{d:0>8}", .{
            bun.fmt.hexIntLower(this.unique_key),
            graph.html_imports.server_source_indices.len,
        });

        const transpiler = this.transpilerForTarget(target);

        const ast_for_html_entrypoint = JSAst.init((try bun.js_parser.newLazyExportAST(
            this.allocator(),
            transpiler.options.define,
            js_parser_options,
            transpiler.log,
            Expr.init(
                E.String,
                E.String{
                    .data = unique_key,
                },
                Logger.Loc.Empty,
            ),
            &empty_html_file_source,

            // We replace this runtime API call's ref later via .link on the Symbol.
            "__jsonParse",
        )).?);

        var fake_input_file = Graph.InputFile{
            .source = empty_html_file_source,
            .side_effects = .no_side_effects__pure_data,
        };

        try graph.input_files.append(this.allocator(), fake_input_file);
        try graph.ast.append(this.allocator(), ast_for_html_entrypoint);

        import_record.source_index = fake_input_file.source.index;
        try this.pathToSourceIndexMap(target).put(this.allocator(), path_text, fake_input_file.source.index.get());
        try graph.html_imports.server_source_indices.append(this.allocator(), fake_input_file.source.index.get());
        this.ensureClientTranspiler();
    }

    const ResolveQueue = bun.StringHashMap(*ParseTask);

    pub fn onNotifyDefer(this: *BundleV2) void {
        this.thread_lock.assertLocked();
        this.graph.deferred_pending += 1;
        this.decrementScanCounter();
    }

    pub fn onNotifyDeferMini(_: *bun.jsc.API.JSBundler.Load, this: *BundleV2) void {
        this.onNotifyDefer();
    }

    pub fn onParseTaskComplete(parse_result: *ParseTask.Result, this: *BundleV2) void {
        const trace = bun.perf.trace("Bundler.onParseTaskComplete");
        const graph = &this.graph;
        defer trace.end();
        if (parse_result.external.function != null) {
            const source = switch (parse_result.value) {
                inline .empty, .err => |data| data.source_index.get(),
                .success => |val| val.source.index.get(),
            };
            const loader: Loader = graph.input_files.items(.loader)[source];
            if (!loader.shouldCopyForBundling()) {
                bun.handleOom(this.finalizers.append(bun.default_allocator, parse_result.external));
            } else {
                graph.input_files.items(.allocator)[source] = ExternalFreeFunctionAllocator.create(parse_result.external.function.?, parse_result.external.ctx.?);
            }
        }

        defer bun.default_allocator.destroy(parse_result);

        var diff: i32 = -1;
        defer {
            logScanCounter("in parse task .pending_items += {d} = {d}\n", .{ diff, @as(i32, @intCast(graph.pending_items)) + diff });
            graph.pending_items = @intCast(@as(i32, @intCast(graph.pending_items)) + diff);
            if (diff < 0)
                this.onAfterDecrementScanCounter();
        }

        var resolve_queue = ResolveQueue.init(this.allocator());
        defer resolve_queue.deinit();
        var process_log = true;

        if (parse_result.value == .success) {
            resolve_queue = runResolutionForParseTask(parse_result, this);
            if (parse_result.value == .err) {
                process_log = false;
            }
        }

        // To minimize contention, watchers are appended by the transpiler thread.
        if (this.bun_watcher) |watcher| {
            if (parse_result.watcher_data.fd != bun.invalid_fd) {
                const source = switch (parse_result.value) {
                    inline .empty, .err => |data| graph.input_files.items(.source)[data.source_index.get()],
                    .success => |val| val.source,
                };
                if (this.shouldAddWatcher(source.path.text)) {
                    _ = watcher.addFile(
                        parse_result.watcher_data.fd,
                        source.path.text,
                        bun.hash32(source.path.text),
                        graph.input_files.items(.loader)[source.index.get()],
                        parse_result.watcher_data.dir_fd,
                        null,
                        bun.Environment.isWindows,
                    );
                }
            }
        }

        switch (parse_result.value) {
            .empty => |empty_result| {
                const input_files = graph.input_files.slice();
                const side_effects = input_files.items(.side_effects);
                side_effects[empty_result.source_index.get()] = .no_side_effects__empty_ast;
                if (comptime Environment.allow_assert) {
                    debug("onParse({d}, {s}) = empty", .{
                        empty_result.source_index.get(),
                        input_files.items(.source)[empty_result.source_index.get()].path.text,
                    });
                }
            },
            .success => |*result| {
                result.log.cloneToWithRecycled(this.transpiler.log, true) catch unreachable;

                this.has_any_top_level_await_modules = this.has_any_top_level_await_modules or !result.ast.top_level_await_keyword.isEmpty();

                // Warning: `input_files` and `ast` arrays may resize in this function call
                // It is not safe to cache slices from them.
                graph.input_files.items(.source)[result.source.index.get()] = result.source;
                this.source_code_length += if (!result.source.index.isRuntime())
                    result.source.contents.len
                else
                    @as(usize, 0);

                graph.input_files.items(.unique_key_for_additional_file)[result.source.index.get()] = result.unique_key_for_additional_file;
                graph.input_files.items(.content_hash_for_additional_file)[result.source.index.get()] = result.content_hash_for_additional_file;
                if (result.unique_key_for_additional_file.len > 0 and result.loader.shouldCopyForBundling()) {
                    if (this.transpiler.options.dev_server) |dev| {
                        dev.putOrOverwriteAsset(
                            &result.source.path,
                            // SAFETY: when shouldCopyForBundling is true, the
                            // contents are allocated by bun.default_allocator
                            &.fromOwnedSlice(bun.default_allocator, @constCast(result.source.contents)),
                            result.content_hash_for_additional_file,
                        ) catch |err| bun.handleOom(err);
                    }
                }

                // Record which loader we used for this file
                graph.input_files.items(.loader)[result.source.index.get()] = result.loader;

                debug("onParse({d}, {s}) = {d} imports, {d} exports", .{
                    result.source.index.get(),
                    result.source.path.text,
                    result.ast.import_records.len,
                    result.ast.named_exports.count(),
                });

                var iter = resolve_queue.iterator();

                const path_to_source_index_map = this.pathToSourceIndexMap(result.ast.target);
                const original_target = result.ast.target;
                while (iter.next()) |entry| {
                    const value: *ParseTask = entry.value_ptr.*;
                    const loader = value.loader orelse value.path.loader(&this.transpiler.options.loaders) orelse options.Loader.file;
                    const is_html_entrypoint = loader == .html and original_target.isServerSide() and this.transpiler.options.dev_server == null;
                    const map: *PathToSourceIndexMap = if (is_html_entrypoint) this.pathToSourceIndexMap(.browser) else path_to_source_index_map;
                    const existing = map.getOrPut(this.allocator(), entry.key_ptr.*) catch unreachable;

                    // Originally, we attempted to avoid the "dual package
                    // hazard" right here by checking if pathToSourceIndexMap
                    // already contained the secondary_path for the ParseTask.
                    // That leads to a race condition where whichever parse task
                    // completes first ends up being used in the bundle. So we
                    // added `scanForSecondaryPaths` before `findReachableFiles`
                    // to prevent that.
                    //
                    // It would be nice, in theory, to find a way to bring that
                    // back because it means we can skip parsing the files we
                    // don't end up using.
                    //

                    if (!existing.found_existing) {
                        var new_task: *ParseTask = value;
                        var new_input_file = Graph.InputFile{
                            .source = Logger.Source.initEmptyFile(new_task.path.text),
                            .side_effects = value.side_effects,
                            .secondary_path = if (value.secondary_path_for_commonjs_interop) |*secondary_path| secondary_path.text else "",
                        };

                        graph.has_any_secondary_paths = graph.has_any_secondary_paths or new_input_file.secondary_path.len > 0;

                        new_input_file.source.index = Index.source(graph.input_files.len);
                        new_input_file.source.path = new_task.path;

                        // We need to ensure the loader is set or else importstar_ts/ReExportTypeOnlyFileES6 will fail.
                        new_input_file.loader = loader;
                        new_task.source_index = new_input_file.source.index;
                        new_task.ctx = this;
                        existing.value_ptr.* = new_task.source_index.get();

                        diff += 1;

                        graph.input_files.append(this.allocator(), new_input_file) catch unreachable;
                        graph.ast.append(this.allocator(), JSAst.empty) catch unreachable;

                        if (is_html_entrypoint) {
                            this.ensureClientTranspiler();
                            this.graph.entry_points.append(this.allocator(), new_input_file.source.index) catch unreachable;
                        }

                        if (this.enqueueOnLoadPluginIfNeeded(new_task)) {
                            continue;
                        }

                        if (loader.shouldCopyForBundling()) {
                            var additional_files: *BabyList(AdditionalFile) = &graph.input_files.items(.additional_files)[result.source.index.get()];
                            bun.handleOom(additional_files.append(this.allocator(), .{ .source_index = new_task.source_index.get() }));
                            new_input_file.side_effects = _resolver.SideEffects.no_side_effects__pure_data;
                            graph.estimated_file_loader_count += 1;
                        }

                        graph.pool.schedule(new_task);
                    } else {
                        if (loader.shouldCopyForBundling()) {
                            var additional_files: *BabyList(AdditionalFile) = &graph.input_files.items(.additional_files)[result.source.index.get()];
                            bun.handleOom(additional_files.append(this.allocator(), .{ .source_index = existing.value_ptr.* }));
                            graph.estimated_file_loader_count += 1;
                        }

                        bun.default_allocator.destroy(value);
                    }
                }

                var import_records = result.ast.import_records.clone(this.allocator()) catch unreachable;

                const input_file_loaders = graph.input_files.items(.loader);
                const save_import_record_source_index = this.transpiler.options.dev_server == null or
                    result.loader == .html or
                    result.loader.isCSS();

                if (this.resolve_tasks_waiting_for_import_source_index.fetchSwapRemove(result.source.index.get())) |pending_entry| {
                    var value = pending_entry.value;
                    for (value.slice()) |to_assign| {
                        if (save_import_record_source_index or
                            input_file_loaders[to_assign.to_source_index.get()].isCSS())
                        {
                            import_records.slice()[to_assign.import_record_index].source_index = to_assign.to_source_index;
                        }
                    }
                    value.deinit(this.allocator());
                }

                if (result.ast.css != null) {
                    graph.css_file_count += 1;
                }

                for (import_records.slice(), 0..) |*record, i| {
                    if (path_to_source_index_map.getPath(&record.path)) |source_index| {
                        if (save_import_record_source_index or input_file_loaders[source_index] == .css)
                            record.source_index.value = source_index;

                        if (getRedirectId(result.ast.redirect_import_record_index)) |compare| {
                            if (compare == @as(u32, @truncate(i))) {
                                path_to_source_index_map.put(
                                    this.allocator(),
                                    result.source.path.text,
                                    source_index,
                                ) catch unreachable;
                            }
                        }
                    }
                }
                result.ast.import_records = import_records;

                graph.ast.set(result.source.index.get(), result.ast);

                // For files with use directives, index and prepare the other side.
                if (result.use_directive != .none and if (this.framework.?.server_components.?.separate_ssr_graph)
                    ((result.use_directive == .client) == (result.ast.target == .browser))
                else
                    ((result.use_directive == .client) != (result.ast.target == .browser)))
                {
                    if (result.use_directive == .server)
                        bun.todoPanic(@src(), "\"use server\"", .{});

                    const reference_source_index, const ssr_index = if (this.framework.?.server_components.?.separate_ssr_graph) brk: {
                        // Enqueue two files, one in server graph, one in ssr graph.
                        const reference_source_index = this.enqueueServerComponentGeneratedFile(
                            .{ .client_reference_proxy = .{
                                .other_source = result.source,
                                .named_exports = result.ast.named_exports,
                            } },
                            result.source,
                        ) catch |err| bun.handleOom(err);

                        const ssr_source = &result.source;
                        ssr_source.path.pretty = ssr_source.path.text;
                        ssr_source.path = bun.handleOom(this.pathWithPrettyInitialized(ssr_source.path, .bake_server_components_ssr));
                        const ssr_index = this.enqueueParseTask2(
                            ssr_source,
                            graph.input_files.items(.loader)[result.source.index.get()],
                            .bake_server_components_ssr,
                        ) catch |err| bun.handleOom(err);

                        break :brk .{ reference_source_index, ssr_index };
                    } else brk: {
                        // Enqueue only one file
                        const server_source = &result.source;
                        server_source.path.pretty = server_source.path.text;
                        server_source.path = bun.handleOom(this.pathWithPrettyInitialized(server_source.path, this.transpiler.options.target));
                        const server_index = this.enqueueParseTask2(
                            server_source,
                            graph.input_files.items(.loader)[result.source.index.get()],
                            .browser,
                        ) catch |err| bun.handleOom(err);

                        break :brk .{ server_index, Index.invalid.get() };
                    };

                    graph.pathToSourceIndexMap(result.ast.target).put(
                        this.allocator(),
                        result.source.path.text,
                        reference_source_index,
                    ) catch |err| bun.handleOom(err);

                    graph.server_component_boundaries.put(
                        this.allocator(),
                        result.source.index.get(),
                        result.use_directive,
                        reference_source_index,
                        ssr_index,
                    ) catch |err| bun.handleOom(err);
                }
            },
            .err => |*err| {
                if (comptime Environment.enable_logs) {
                    debug("onParse() = err", .{});
                }

                if (process_log) {
                    if (this.transpiler.options.dev_server) |dev_server| {
                        dev_server.handleParseTaskFailure(
                            err.err,
                            err.target.bakeGraph(),
                            graph.input_files.items(.source)[err.source_index.get()].path.text,
                            &err.log,
                            this,
                        ) catch |e| bun.handleOom(e);
                    } else if (err.log.msgs.items.len > 0) {
                        err.log.cloneToWithRecycled(this.transpiler.log, true) catch unreachable;
                    } else {
                        this.transpiler.log.addErrorFmt(
                            null,
                            Logger.Loc.Empty,
                            this.transpiler.log.msgs.allocator,
                            "{s} while {s}",
                            .{ @errorName(err.err), @tagName(err.step) },
                        ) catch unreachable;
                    }
                }

                if (Environment.allow_assert and this.transpiler.options.dev_server != null) {
                    bun.assert(graph.ast.items(.parts)[err.source_index.get()].len == 0);
                }
            },
        }
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn getLoaders(vm: *BundleV2) *bun.options.Loader.HashTable {
        return &vm.transpiler.options.loaders;
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn bustDirCache(vm: *BundleV2, path: []const u8) bool {
        return vm.transpiler.resolver.bustDirCache(path);
    }
};

pub const BundleThread = @import("./BundleThread.zig").BundleThread;

pub const UseDirective = js_ast.UseDirective;
pub const ServerComponentBoundary = js_ast.ServerComponentBoundary;
pub const ServerComponentParseTask = @import("./ServerComponentParseTask.zig").ServerComponentParseTask;

const RefVoidMap = std.ArrayHashMapUnmanaged(Ref, void, Ref.ArrayHashCtx, false);
pub const RefImportData = std.ArrayHashMapUnmanaged(Ref, ImportData, Ref.ArrayHashCtx, false);
pub const ResolvedExports = bun.StringArrayHashMapUnmanaged(ExportData);
pub const TopLevelSymbolToParts = js_ast.Ast.TopLevelSymbolToParts;

pub const WrapKind = enum(u2) {
    none,
    cjs,
    esm,
};

pub const ImportData = struct {
    // This is an array of intermediate statements that re-exported this symbol
    // in a chain before getting to the final symbol. This can be done either with
    // "export * from" or "export {} from". If this is done with "export * from"
    // then this may not be the result of a single chain but may instead form
    // a diamond shape if this same symbol was re-exported multiple times from
    // different files.
    re_exports: Dependency.List = Dependency.List{},

    data: ImportTracker = .{},
};

pub const ExportData = struct {
    // Export star resolution happens first before import resolution. That means
    // it cannot yet determine if duplicate names from export star resolution are
    // ambiguous (point to different symbols) or not (point to the same symbol).
    // This issue can happen in the following scenario:
    //
    //   // entry.js
    //   export * from './a'
    //   export * from './b'
    //
    //   // a.js
    //   export * from './c'
    //
    //   // b.js
    //   export {x} from './c'
    //
    //   // c.js
    //   export let x = 1, y = 2
    //
    // In this case "entry.js" should have two exports "x" and "y", neither of
    // which are ambiguous. To handle this case, ambiguity resolution must be
    // deferred until import resolution time. That is done using this array.
    potentially_ambiguous_export_star_refs: BabyList(ImportData) = .{},

    // This is the file that the named export above came from. This will be
    // different from the file that contains this object if this is a re-export.
    data: ImportTracker = .{},
};

pub const JSMeta = struct {
    /// This is only for TypeScript files. If an import symbol is in this map, it
    /// means the import couldn't be found and doesn't actually exist. This is not
    /// an error in TypeScript because the import is probably just a type.
    ///
    /// Normally we remove all unused imports for TypeScript files during parsing,
    /// which automatically removes type-only imports. But there are certain re-
    /// export situations where it's impossible to tell if an import is a type or
    /// not:
    ///
    ///   import {typeOrNotTypeWhoKnows} from 'path';
    ///   export {typeOrNotTypeWhoKnows};
    ///
    /// Really people should be using the TypeScript "isolatedModules" flag with
    /// bundlers like this one that compile TypeScript files independently without
    /// type checking. That causes the TypeScript type checker to emit the error
    /// "Re-exporting a type when the '--isolatedModules' flag is provided requires
    /// using 'export type'." But we try to be robust to such code anyway.
    probably_typescript_type: RefVoidMap = .{},

    /// Imports are matched with exports in a separate pass from when the matched
    /// exports are actually bound to the imports. Here "binding" means adding non-
    /// local dependencies on the parts in the exporting file that declare the
    /// exported symbol to all parts in the importing file that use the imported
    /// symbol.
    ///
    /// This must be a separate pass because of the "probably TypeScript type"
    /// check above. We can't generate the part for the export namespace until
    /// we've matched imports with exports because the generated code must omit
    /// type-only imports in the export namespace code. And we can't bind exports
    /// to imports until the part for the export namespace is generated since that
    /// part needs to participate in the binding.
    ///
    /// This array holds the deferred imports to bind so the pass can be split
    /// into two separate passes.
    imports_to_bind: RefImportData = .{},

    /// This includes both named exports and re-exports.
    ///
    /// Named exports come from explicit export statements in the original file,
    /// and are copied from the "NamedExports" field in the AST.
    ///
    /// Re-exports come from other files and are the result of resolving export
    /// star statements (i.e. "export * from 'foo'").
    resolved_exports: ResolvedExports = .{},
    resolved_export_star: ExportData = ExportData{},

    /// Never iterate over "resolvedExports" directly. Instead, iterate over this
    /// array. Some exports in that map aren't meant to end up in generated code.
    /// This array excludes these exports and is also sorted, which avoids non-
    /// determinism due to random map iteration order.
    sorted_and_filtered_export_aliases: []const string = &[_]string{},

    /// This is merged on top of the corresponding map from the parser in the AST.
    /// You should call "TopLevelSymbolToParts" to access this instead of accessing
    /// it directly.
    top_level_symbol_to_parts_overlay: TopLevelSymbolToParts = .{},

    /// If this is an entry point, this array holds a reference to one free
    /// temporary symbol for each entry in "sortedAndFilteredExportAliases".
    /// These may be needed to store copies of CommonJS re-exports in ESM.
    cjs_export_copies: []const Ref = &[_]Ref{},

    /// The index of the automatically-generated part used to represent the
    /// CommonJS or ESM wrapper. This part is empty and is only useful for tree
    /// shaking and code splitting. The wrapper can't be inserted into the part
    /// because the wrapper contains other parts, which can't be represented by
    /// the current part system. Only wrapped files have one of these.
    wrapper_part_index: Index = Index.invalid,

    /// The index of the automatically-generated part used to handle entry point
    /// specific stuff. If a certain part is needed by the entry point, it's added
    /// as a dependency of this part. This is important for parts that are marked
    /// as removable when unused and that are not used by anything else. Only
    /// entry point files have one of these.
    entry_point_part_index: Index = Index.invalid,

    flags: Flags = .{},

    pub const Flags = packed struct(u8) {
        /// This is true if this file is affected by top-level await, either by having
        /// a top-level await inside this file or by having an import/export statement
        /// that transitively imports such a file. It is forbidden to call "require()"
        /// on these files since they are evaluated asynchronously.
        is_async_or_has_async_dependency: bool = false,

        /// If true, we need to insert "var exports = {};". This is the case for ESM
        /// files when the import namespace is captured via "import * as" and also
        /// when they are the target of a "require()" call.
        needs_exports_variable: bool = false,

        /// If true, the "__export(exports, { ... })" call will be force-included even
        /// if there are no parts that reference "exports". Otherwise this call will
        /// be removed due to the tree shaking pass. This is used when for entry point
        /// files when code related to the current output format needs to reference
        /// the "exports" variable.
        force_include_exports_for_entry_point: bool = false,

        /// This is set when we need to pull in the "__export" symbol in to the part
        /// at "nsExportPartIndex". This can't be done in "createExportsForFile"
        /// because of concurrent map hazards. Instead, it must be done later.
        needs_export_symbol_from_runtime: bool = false,

        /// Wrapped files must also ensure that their dependencies are wrapped. This
        /// flag is used during the traversal that enforces this invariant, and is used
        /// to detect when the fixed point has been reached.
        did_wrap_dependencies: bool = false,

        /// When a converted CommonJS module is import() dynamically
        /// We need ensure that the "default" export is set to the equivalent of module.exports
        /// (unless a "default" export already exists)
        needs_synthetic_default_export: bool = false,

        wrap: WrapKind = WrapKind.none,
    };
};

pub const AdditionalFile = union(enum) {
    source_index: Index.Int,
    output_file: Index.Int,
};

pub const EntryPoint = struct {
    /// This may be an absolute path or a relative path. If absolute, it will
    /// eventually be turned into a relative path by computing the path relative
    /// to the "outbase" directory. Then this relative path will be joined onto
    /// the "outdir" directory to form the final output path for this entry point.
    output_path: bun.PathString = bun.PathString.empty,

    /// This is the source index of the entry point. This file must have a valid
    /// entry point kind (i.e. not "none").
    source_index: Index.Int = 0,

    /// Manually specified output paths are ignored when computing the default
    /// "outbase" directory, which is computed as the lowest common ancestor of
    /// all automatically generated output paths.
    output_path_was_auto_generated: bool = false,

    pub const List = MultiArrayList(EntryPoint);

    pub const Kind = enum {
        none,
        user_specified,
        dynamic_import,
        html,

        pub fn outputKind(this: Kind) jsc.API.BuildArtifact.OutputKind {
            return switch (this) {
                .user_specified => .@"entry-point",
                else => .chunk,
            };
        }

        pub inline fn isEntryPoint(this: Kind) bool {
            return this != .none;
        }

        pub inline fn isUserSpecifiedEntryPoint(this: Kind) bool {
            return this == .user_specified;
        }

        // TODO: delete
        pub inline fn isServerEntryPoint(this: Kind) bool {
            return this == .user_specified;
        }
    };
};

const AstSourceIDMapping = struct {
    id: Index.Int,
    source_index: Index.Int,
};

pub const PartRange = struct {
    source_index: Index = Index.invalid,
    part_index_begin: u32 = 0,
    part_index_end: u32 = 0,
};

pub const StableRef = packed struct(u96) {
    stable_source_index: Index.Int,
    ref: Ref,

    pub fn isLessThan(_: void, a: StableRef, b: StableRef) bool {
        return a.stable_source_index < b.stable_source_index or
            (a.stable_source_index == b.stable_source_index and a.ref.innerIndex() < b.ref.innerIndex());
    }
};

pub const ImportTracker = struct {
    source_index: Index = Index.invalid,
    name_loc: Logger.Loc = Logger.Loc.Empty,
    import_ref: Ref = Ref.None,

    pub const Status = enum {
        /// The imported file has no matching export
        no_match,

        /// The imported file has a matching export
        found,

        /// The imported file is CommonJS and has unknown exports
        cjs,

        /// The import is missing but there is a dynamic fallback object
        dynamic_fallback,

        /// The import is missing but there is a dynamic fallback object
        /// and the file was originally CommonJS.
        dynamic_fallback_interop_default,

        /// The import was treated as a CommonJS import but the file is known to have no exports
        cjs_without_exports,

        /// The imported file was disabled by mapping it to false in the "browser"
        /// field of package.json
        disabled,

        /// The imported file is external and has unknown exports
        external,

        /// This is a missing re-export in a TypeScript file, so it's probably a type
        probably_typescript_type,
    };

    pub const Iterator = struct {
        status: Status = Status.no_match,
        value: ImportTracker = .{},
        import_data: []ImportData = &.{},
    };
};

pub const PathTemplate = options.PathTemplate;

pub const Chunk = @import("./Chunk.zig").Chunk;
pub const ChunkImport = @import("./Chunk.zig").ChunkImport;

pub const CrossChunkImport = struct {
    chunk_index: Index.Int = 0,
    sorted_import_items: CrossChunkImport.Item.List = undefined,

    pub const Item = struct {
        export_alias: string = "",
        ref: Ref = Ref.None,

        pub const List = bun.BabyList(Item);

        pub fn lessThan(_: void, a: CrossChunkImport.Item, b: CrossChunkImport.Item) bool {
            return strings.order(a.export_alias, b.export_alias) == .lt;
        }
    };

    pub fn lessThan(_: void, a: CrossChunkImport, b: CrossChunkImport) bool {
        return std.math.order(a.chunk_index, b.chunk_index) == .lt;
    }

    pub const List = std.array_list.Managed(CrossChunkImport);

    pub fn sortedCrossChunkImports(
        list: *List,
        chunks: []Chunk,
        imports_from_other_chunks: *Chunk.ImportsFromOtherChunks,
    ) !void {
        var result = list.*;
        defer {
            list.* = result;
        }

        result.clearRetainingCapacity();
        try result.ensureTotalCapacity(imports_from_other_chunks.count());

        const import_items_list = imports_from_other_chunks.values();
        const chunk_indices = imports_from_other_chunks.keys();
        for (chunk_indices, import_items_list) |chunk_index, import_items| {
            var chunk = &chunks[chunk_index];

            // Sort imports from a single chunk by alias for determinism
            const exports_to_other_chunks = &chunk.content.javascript.exports_to_other_chunks;
            // TODO: do we need to clone this array?
            for (import_items.slice()) |*item| {
                item.export_alias = exports_to_other_chunks.get(item.ref).?;
                bun.assert(item.export_alias.len > 0);
            }
            std.sort.pdq(CrossChunkImport.Item, import_items.slice(), {}, CrossChunkImport.Item.lessThan);

            result.append(CrossChunkImport{
                .chunk_index = chunk_index,
                .sorted_import_items = import_items,
            }) catch unreachable;
        }

        std.sort.pdq(CrossChunkImport, result.items, {}, CrossChunkImport.lessThan);
    }
};

pub const CompileResult = union(enum) {
    javascript: struct {
        source_index: Index.Int,
        result: js_printer.PrintResult,

        pub fn code(this: @This()) []const u8 {
            return switch (this.result) {
                .result => |result| result.code,
                else => "",
            };
        }
    },
    css: struct {
        result: bun.Maybe([]const u8, anyerror),
        source_index: Index.Int,
        source_map: ?bun.SourceMap.Chunk = null,
    },
    html: struct {
        source_index: Index.Int,
        code: []const u8,
        /// Offsets are used for DevServer to inject resources without re-bundling
        script_injection_offset: u32,
    },

    pub const empty = CompileResult{
        .javascript = .{
            .source_index = 0,
            .result = js_printer.PrintResult{
                .result = .{
                    .code = "",
                },
            },
        },
    };

    pub fn code(this: *const CompileResult) []const u8 {
        return switch (this.*) {
            .javascript => |r| r.code(),
            .css => |*c| switch (c.result) {
                .result => |v| v,
                .err => "",
            },
            .html => |*c| c.code,
        };
    }

    pub fn sourceMapChunk(this: *const CompileResult) ?SourceMap.Chunk {
        return switch (this.*) {
            .javascript => |r| switch (r.result) {
                .result => |r2| r2.source_map,
                else => null,
            },
            .css => |*c| c.source_map,
            .html => null,
        };
    }

    pub fn sourceIndex(this: *const CompileResult) Index.Int {
        return switch (this.*) {
            inline else => |*r| r.source_index,
        };
    }
};

pub const CompileResultForSourceMap = struct {
    source_map_chunk: SourceMap.Chunk,
    generated_offset: SourceMap.LineColumnOffset,
    source_index: u32,
};

pub const ContentHasher = struct {
    pub const Hash = std.hash.XxHash64;

    // xxhash64 outperforms Wyhash if the file is > 1KB or so
    hasher: Hash = .init(0),

    const log = bun.Output.scoped(.ContentHasher, .hidden);

    pub fn write(self: *ContentHasher, bytes: []const u8) void {
        log("HASH_UPDATE {d}:\n{s}\n----------\n", .{ bytes.len, std.mem.sliceAsBytes(bytes) });
        self.hasher.update(std.mem.asBytes(&bytes.len));
        self.hasher.update(bytes);
    }

    pub fn run(bytes: []const u8) u64 {
        var hasher = ContentHasher{};
        hasher.write(bytes);
        return hasher.digest();
    }

    pub fn writeInts(self: *ContentHasher, i: []const u32) void {
        log("HASH_UPDATE: {any}\n", .{i});
        self.hasher.update(std.mem.sliceAsBytes(i));
    }

    pub fn digest(self: *ContentHasher) u64 {
        return self.hasher.final();
    }
};

// non-allocating
// meant to be fast but not 100% thorough
// users can correctly put in a trailing slash if they want
// this is just being nice
pub fn cheapPrefixNormalizer(prefix: []const u8, suffix: []const u8) [2]string {
    if (prefix.len == 0) {
        const suffix_no_slash = bun.strings.removeLeadingDotSlash(suffix);
        return .{
            if (strings.hasPrefixComptime(suffix_no_slash, "../")) "" else "./",
            suffix_no_slash,
        };
    }

    // There are a few cases here we want to handle:
    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"] => "/foo/bar.js"
    if (strings.endsWithChar(prefix, '/') or (Environment.isWindows and strings.endsWithChar(prefix, '\\'))) {
        if (strings.startsWithChar(suffix, '/') or (Environment.isWindows and strings.startsWithChar(suffix, '\\'))) {
            return .{
                prefix[0..prefix.len],
                suffix[1..suffix.len],
            };
        }

        // It gets really complicated if we try to deal with URLs more than this
        // These would be ideal:
        // - example.com + ./out.js => example.com/out.js
        // - example.com/foo + ./out.js => example.com/fooout.js
        // - example.com/bar/ + ./out.js => example.com/bar/out.js
        // But it's not worth the complexity to handle these cases right now.
    }

    return .{
        prefix,
        bun.strings.removeLeadingDotSlash(suffix),
    };
}

fn getRedirectId(id: u32) ?u32 {
    if (id == std.math.maxInt(u32)) {
        return null;
    }
    return id;
}

pub fn targetFromHashbang(buffer: []const u8) ?options.Target {
    if (buffer.len > "#!/usr/bin/env bun".len) {
        if (strings.hasPrefixComptime(buffer, "#!/usr/bin/env bun")) {
            switch (buffer["#!/usr/bin/env bun".len]) {
                '\n', ' ' => return options.Target.bun,
                else => {},
            }
        }
    }
    return null;
}

pub const AstBuilder = @import("./AstBuilder.zig").AstBuilder;

pub const CssEntryPointMeta = struct {
    /// When this is true, a stub file is added to the Server's IncrementalGraph
    imported_on_server: bool,
};

/// The lifetime of this structure is tied to the bundler's arena
pub const DevServerInput = struct {
    css_entry_points: std.AutoArrayHashMapUnmanaged(Index, CssEntryPointMeta),
};

/// The lifetime of this structure is tied to the bundler's arena
pub const DevServerOutput = struct {
    chunks: []Chunk,
    css_file_list: std.AutoArrayHashMapUnmanaged(Index, CssEntryPointMeta),
    html_files: std.AutoArrayHashMapUnmanaged(Index, void),

    pub fn jsPseudoChunk(out: *const DevServerOutput) *Chunk {
        return &out.chunks[0];
    }

    pub fn cssChunks(out: *const DevServerOutput) []Chunk {
        return out.chunks[1..][0..out.css_file_list.count()];
    }

    pub fn htmlChunks(out: *const DevServerOutput) []Chunk {
        return out.chunks[1 + out.css_file_list.count() ..][0..out.html_files.count()];
    }
};

pub fn generateUniqueKey() u64 {
    const key = std.crypto.random.int(u64) & @as(u64, 0x0FFFFFFF_FFFFFFFF);
    // without this check, putting unique_key in an object key would
    // sometimes get converted to an identifier. ensuring it starts
    // with a number forces that optimization off.
    if (Environment.isDebug) {
        var buf: [16]u8 = undefined;
        const hex = std.fmt.bufPrint(&buf, "{f}", .{bun.fmt.hexIntLower(key)}) catch
            unreachable;
        switch (hex[0]) {
            '0'...'9' => {},
            else => Output.panic("unique key is a valid identifier: {s}", .{hex}),
        }
    }
    return key;
}

const ExternalFreeFunctionAllocator = struct {
    free_callback: *const fn (ctx: *anyopaque) callconv(.c) void,
    context: *anyopaque,

    const vtable: std.mem.Allocator.VTable = .{
        .alloc = &alloc,
        .free = &free,
        .resize = &std.mem.Allocator.noResize,
        .remap = &std.mem.Allocator.noRemap,
    };

    pub fn create(free_callback: *const fn (ctx: *anyopaque) callconv(.c) void, context: *anyopaque) std.mem.Allocator {
        return .{
            .ptr = bun.create(bun.default_allocator, ExternalFreeFunctionAllocator, .{
                .free_callback = free_callback,
                .context = context,
            }),
            .vtable = &vtable,
        };
    }

    fn alloc(_: *anyopaque, _: usize, _: std.mem.Alignment, _: usize) ?[*]u8 {
        return null;
    }

    fn free(ext_free_function: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize) void {
        const info: *ExternalFreeFunctionAllocator = @ptrCast(@alignCast(ext_free_function));
        info.free_callback(info.context);
        bun.default_allocator.destroy(info);
    }
};

/// Returns true if `allocator` definitely has a valid `.ptr`.
/// May return false even if `.ptr` is valid.
///
/// This function should check whether `allocator` matches any internal allocator types known to
/// have valid pointers. Allocators defined outside of this file, like `std.heap.ArenaAllocator`,
/// don't need to be checked.
pub fn allocatorHasPointer(allocator: std.mem.Allocator) bool {
    return allocator.vtable == &ExternalFreeFunctionAllocator.vtable;
}

pub const std = @import("std");
pub const lex = @import("../js_lexer.zig");
pub const Logger = @import("../logger.zig");
pub const Part = js_ast.Part;
pub const js_printer = @import("../js_printer.zig");
pub const js_ast = bun.ast;
pub const linker = @import("../linker.zig");
pub const SourceMap = bun.SourceMap;
pub const StringJoiner = bun.StringJoiner;
pub const base64 = bun.base64;
pub const Ref = bun.ast.Ref;
pub const ThreadLocalArena = bun.allocators.MimallocArena;
pub const BabyList = bun.collections.BabyList;
pub const Fs = @import("../fs.zig");
pub const api = bun.schema.api;
pub const _resolver = @import("../resolver/resolver.zig");
pub const ImportRecord = bun.ImportRecord;
pub const ImportKind = bun.ImportKind;
pub const allocators = bun.allocators;
pub const resolve_path = @import("../resolver/resolve_path.zig");
pub const runtime = @import("../runtime.zig");
pub const Timer = @import("../system_timer.zig");
pub const OOM = bun.OOM;

pub const HTMLScanner = @import("../HTMLScanner.zig");
pub const isPackagePath = _resolver.isPackagePath;
pub const NodeFallbackModules = @import("../node_fallbacks.zig");
pub const CacheEntry = @import("../cache.zig").Fs.Entry;
pub const URL = @import("../url.zig").URL;
pub const Resolver = _resolver.Resolver;
pub const TOML = bun.interchange.toml.TOML;
pub const Dependency = js_ast.Dependency;
pub const JSAst = js_ast.BundledAst;
pub const Loader = options.Loader;
pub const Index = bun.ast.Index;
pub const Symbol = js_ast.Symbol;
pub const EventLoop = bun.jsc.AnyEventLoop;
pub const MultiArrayList = bun.MultiArrayList;
pub const Stmt = js_ast.Stmt;
pub const Expr = js_ast.Expr;
pub const E = js_ast.E;
pub const S = js_ast.S;
pub const G = js_ast.G;
pub const B = js_ast.B;
pub const Binding = js_ast.Binding;
pub const AutoBitSet = bun.bit_set.AutoBitSet;
pub const renamer = bun.renamer;
pub const StableSymbolCount = renamer.StableSymbolCount;
pub const MinifyRenamer = renamer.MinifyRenamer;
pub const Scope = js_ast.Scope;
pub const jsc = bun.jsc;
pub const debugTreeShake = Output.scoped(.TreeShake, .hidden);
pub const debugPartRanges = Output.scoped(.PartRanges, .hidden);
pub const BitSet = bun.bit_set.DynamicBitSetUnmanaged;
pub const Async = bun.Async;
pub const Loc = Logger.Loc;
pub const bake = bun.bake;
pub const lol = bun.LOLHTML;
pub const DataURL = @import("../resolver/resolver.zig").DataURL;
pub const IndexStringMap = @import("./IndexStringMap.zig");
pub const DeferredBatchTask = @import("./DeferredBatchTask.zig").DeferredBatchTask;
pub const ThreadPool = @import("./ThreadPool.zig").ThreadPool;
pub const ParseTask = @import("./ParseTask.zig").ParseTask;
pub const LinkerContext = @import("./LinkerContext.zig").LinkerContext;
pub const LinkerGraph = @import("./LinkerGraph.zig").LinkerGraph;
pub const Graph = @import("./Graph.zig");

const string = []const u8;

// C++ binding for lazy metafile getter (defined in BundlerMetafile.cpp)
// Uses jsc.conv (SYSV_ABI on Windows x64) for proper calling convention
extern "C" fn Bun__setupLazyMetafile(globalThis: *jsc.JSGlobalObject, buildOutput: jsc.JSValue, metafileString: jsc.JSValue) callconv(jsc.conv) void;

const options = @import("../options.zig");

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const Output = bun.Output;
const ThreadPoolLib = bun.ThreadPool;
const Transpiler = bun.Transpiler;
const default_allocator = bun.default_allocator;
const strings = bun.strings;
