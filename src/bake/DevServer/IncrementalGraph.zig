/// The paradigm of Bake's incremental state is to store a separate list of files
/// than the Graph in bundle_v2. When watch events happen, the bundler is run on
/// the changed files, excluding non-stale files via `isFileStale`.
///
/// Upon bundle completion, both `client_graph` and `server_graph` have their
/// `receiveChunk` methods called with all new chunks, counting the total length
/// needed. A call to `takeJSBundle` joins all of the chunks, resulting in the
/// code to send to client or evaluate on the server.
///
/// Then, `processChunkDependencies` is called on each chunk to update the
/// list of imports. When a change in imports is detected, the dependencies
/// are updated accordingly.
///
/// Since all routes share the two graphs, bundling a new route that shared
/// a module from a previously bundled route will perform the same exclusion
/// behavior that rebuilds use. This also ensures that two routes on the server
/// do not emit duplicate dependencies. By tracing `imports` on each file in
/// the module graph recursively, the full bundle for any given route can
/// be re-materialized (required when pressing Cmd+R after any client update)
///
/// Since source mappings are all relative to their previous mapping, each
/// chunk's mappings can be stored in the graph, and very trivially built into
/// JSON source map files (`takeSourceMap`), even after hot updates. The
/// lifetime for these sourcemaps is a bit tricky and depend on the lifetime of
/// of WebSocket connections; see comments in `Assets` for more details.
pub fn IncrementalGraph(side: bake.Side) type {
    return struct {
        // Unless otherwise mentioned, all data structures use DevServer's allocator.
        // All arrays are indexed by FileIndex, except for the two edge-related arrays.

        /// Keys are absolute paths for the "file" namespace, or the
        /// pretty-formatted path value that appear in imports. Absolute paths
        /// are stored so the watcher can quickly query and invalidate them.
        /// Key slices are owned by `dev.allocator`
        bundled_files: bun.StringArrayHashMapUnmanaged(File),
        /// Track bools for files which are "stale", meaning they should be
        /// re-bundled before being used. Resizing this is usually deferred
        /// until after a bundle, since resizing the bit-set requires an
        /// exact size, instead of the log approach that dynamic arrays use.
        stale_files: DynamicBitSetUnmanaged,

        // TODO: rename `dependencies` to something that clearly indicates direction.
        // such as "parent" or "consumer"

        /// Start of a file's 'dependencies' linked list. These are the other
        /// files that have imports to this file. Walk this list to discover
        /// what files are to be reloaded when something changes.
        first_dep: ArrayListUnmanaged(EdgeIndex.Optional),
        /// Start of a file's 'imports' linked lists. These are the files that
        /// this file imports.
        first_import: ArrayListUnmanaged(EdgeIndex.Optional),
        /// `File` objects act as nodes in a directional many-to-many graph,
        /// where edges represent the imports between modules. An 'dependency'
        /// is a file that must to be notified when it `imported` changes. This
        /// is implemented using an array of `Edge` objects that act as linked
        /// list nodes; each file stores the first imports and dependency.
        edges: ArrayListUnmanaged(Edge),
        /// HMR Dependencies are added and removed very frequently, but indexes
        /// must remain stable. This free list allows re-use of freed indexes,
        /// so garbage collection can run less often.
        edges_free_list: ArrayListUnmanaged(EdgeIndex),

        /// Byte length of every file queued for concatenation
        current_chunk_len: usize = 0,
        /// All part contents
        current_chunk_parts: ArrayListUnmanaged(switch (side) {
            .client => FileIndex,
            // These slices do not outlive the bundler, and must
            // be joined before its arena is deinitialized.
            .server => []const u8,
        }),

        /// Asset IDs, which can be printed as hex in '/_bun/asset/{hash}.css'
        current_css_files: switch (side) {
            .client => ArrayListUnmanaged(u64),
            .server => void,
        },

        pub const empty: @This() = .{
            .bundled_files = .empty,
            .stale_files = .empty,
            .first_dep = .empty,
            .first_import = .empty,

            .edges = .empty,
            .edges_free_list = .empty,

            .current_chunk_len = 0,
            .current_chunk_parts = .empty,

            .current_css_files = if (side == .client) .empty,
        };

        pub const File = switch (side) {
            // The server's incremental graph does not store previously bundled
            // code because there is only one instance of the server. Instead,
            // it stores which module graphs it is a part of. This makes sure
            // that recompilation knows what bundler options to use.
            .server => packed struct(u8) {
                /// Is this file built for the Server graph.
                is_rsc: bool,
                /// Is this file built for the SSR graph.
                is_ssr: bool,
                /// If set, the client graph contains a matching file.
                /// The server
                is_client_component_boundary: bool,
                /// If this file is a route root, the route can be looked up in
                /// the route list. This also stops dependency propagation.
                is_route: bool,
                /// If the file has an error, the failure can be looked up
                /// in the `.failures` map.
                failed: bool,
                /// CSS and Asset files get special handling
                kind: FileKind,

                unused: enum(u1) { unused } = .unused,

                fn stopsDependencyTrace(file: @This()) bool {
                    return file.is_client_component_boundary;
                }

                pub fn fileKind(file: @This()) FileKind {
                    return file.kind;
                }
            },
            .client => struct {
                /// Content depends on `flags.kind`
                /// See function wrappers to safely read into this data
                content: extern union {
                    /// Allocated by `dev.allocator`. Access with `.jsCode()`
                    /// When stale, the code is "", otherwise it contains at
                    /// least one non-whitespace character, as empty chunks
                    /// contain at least a function wrapper.
                    js_code_ptr: [*]const u8,
                    /// Access with `.cssAssetId()`
                    css_asset_id: u64,

                    unknown: enum(u32) { unknown = 0 },
                },
                /// Separated from the pointer to reduce struct size.
                /// Parser does not support files >4gb anyways.
                code_len: u32,
                flags: Flags,
                source_map: PackedMap.RefOrEmpty.Untagged,

                const Flags = packed struct(u32) {
                    /// Kind determines the data representation in `content`, as
                    /// well as how this file behaves when tracing.
                    kind: FileKind,
                    /// If the file has an error, the failure can be looked up
                    /// in the `.failures` map.
                    failed: bool,
                    /// For JS files, this is a component root; the server contains a matching file.
                    is_hmr_root: bool,
                    /// This is a file is an entry point to the framework.
                    /// Changing this will always cause a full page reload.
                    is_special_framework_file: bool,
                    /// If this file has a HTML RouteBundle. The bundle index is tucked away in:
                    /// `graph.source_maps.items[i].extra.empty.html_bundle_route_index`
                    is_html_route: bool,
                    /// A CSS root is the first file in a CSS bundle, aka the
                    /// one that the JS or HTML file points into.
                    ///
                    /// There are many complicated rules when CSS files
                    /// reference each other, none of which are modelled in
                    /// IncrementalGraph. Instead, any change to downstream
                    /// files will find the CSS root, and queue it for a
                    /// re-bundle. Additionally, CSS roots only have one level
                    /// of imports, as the code in `finalizeBundle` will add all
                    /// referenced files as edges directly to the root, creating
                    /// a flat list instead of a tree. Those downstream files
                    /// remaining empty; only present so that invalidation can
                    /// trace them to this root.
                    is_css_root: bool,
                    /// Affects `file.source_map`
                    source_map_state: PackedMap.RefOrEmpty.Tag,

                    unused: enum(u24) { unused } = .unused,
                };

                comptime {
                    const d = std.debug;
                    if (!Environment.isDebug) {
                        d.assert(@sizeOf(@This()) == @sizeOf(u64) * 3);
                        d.assert(@alignOf(@This()) == @alignOf([*]u8));
                    }
                }

                fn initJavaScript(code_slice: []const u8, flags: Flags, source_map: PackedMap.RefOrEmpty) @This() {
                    assert(flags.kind == .js or flags.kind == .asset);
                    assert(flags.source_map_state == std.meta.activeTag(source_map));
                    return .{
                        .content = .{ .js_code_ptr = code_slice.ptr },
                        .code_len = @intCast(code_slice.len),
                        .flags = flags,
                        .source_map = source_map.untag(),
                    };
                }

                fn initCSS(asset_id: u64, flags: Flags) @This() {
                    assert(flags.kind == .css);
                    assert(flags.source_map_state == .empty);
                    return .{
                        .content = .{ .css_asset_id = asset_id },
                        .code_len = 0, // unused
                        .flags = flags,
                        .source_map = .blank_empty,
                    };
                }

                fn initUnknown(flags: Flags, empty_map: PackedMap.RefOrEmpty.Empty) @This() {
                    assert(flags.source_map_state == .empty);
                    return .{
                        .content = .{ .unknown = .unknown }, // unused
                        .code_len = 0, // unused
                        .flags = flags,
                        .source_map = .{ .empty = empty_map },
                    };
                }

                fn jsCode(file: @This()) []const u8 {
                    assert(file.flags.kind.hasInlinejscodeChunk());
                    return file.content.js_code_ptr[0..file.code_len];
                }

                fn cssAssetId(file: @This()) u64 {
                    assert(file.flags.kind == .css);
                    return file.content.css_asset_id;
                }

                inline fn stopsDependencyTrace(_: @This()) bool {
                    return false;
                }

                pub fn fileKind(file: @This()) FileKind {
                    return file.flags.kind;
                }

                fn sourceMap(file: @This()) PackedMap.RefOrEmpty {
                    return file.source_map.decode(file.flags.source_map_state);
                }

                fn setSourceMap(file: *@This(), new_source_map: PackedMap.RefOrEmpty) void {
                    file.flags.source_map_state = new_source_map;
                    file.source_map = new_source_map.untag();
                }
            },
        };

        fn freeFileContent(g: *IncrementalGraph(.client), key: []const u8, file: *File, css: enum { unref_css, ignore_css }) void {
            switch (file.flags.kind) {
                .js, .asset => {
                    g.owner().allocator.free(file.jsCode());
                    switch (file.sourceMap()) {
                        .ref => |ptr| {
                            ptr.derefWithContext(g.owner());
                            file.setSourceMap(.blank_empty);
                        },
                        .empty => {},
                    }
                },
                .css => if (css == .unref_css) {
                    g.owner().assets.unrefByPath(key);
                },
                .unknown => {},
            }
        }

        // If this data structure is not clear, see `DirectoryWatchStore.Dep`
        // for a simpler example. It is more complicated here because this
        // structure is two-way.
        pub const Edge = struct {
            /// The file with the import statement
            dependency: FileIndex,
            /// The file the import statement references.
            imported: FileIndex,

            /// Next edge in the "imports" linked list for the `dependency` file.
            /// Used to iterate through all files that `dependency` imports.
            next_import: EdgeIndex.Optional,

            /// Next edge in the "dependencies" linked list for the `imported` file.
            /// Used to iterate through all files that import `imported`.
            next_dependency: EdgeIndex.Optional,

            /// Previous edge in the "dependencies" linked list for the `imported` file.
            /// Enables bidirectional traversal and efficient removal from the middle of the list.
            prev_dependency: EdgeIndex.Optional,
        };

        /// An index into `bundled_files`, `stale_files`, `first_dep`, `first_import`
        /// Top bits cannot be relied on due to `SerializedFailure.Owner.Packed`
        pub const FileIndex = bun.GenericIndex(u30, File);
        pub const react_refresh_index = if (side == .client) FileIndex.init(0);

        /// An index into `edges`
        pub const EdgeIndex = bun.GenericIndex(u32, Edge);

        pub fn deinit(g: *@This(), allocator: Allocator) void {
            _ = VoidFieldTypes(@This()){
                .bundled_files = {
                    for (g.bundled_files.keys(), g.bundled_files.values()) |k, *v| {
                        allocator.free(k);
                        if (side == .client)
                            g.freeFileContent(k, v, .ignore_css);
                    }
                    g.bundled_files.deinit(allocator);
                },
                .stale_files = g.stale_files.deinit(allocator),
                .first_dep = g.first_dep.deinit(allocator),
                .first_import = g.first_import.deinit(allocator),
                .edges = g.edges.deinit(allocator),
                .edges_free_list = g.edges_free_list.deinit(allocator),
                .current_chunk_len = {},
                .current_chunk_parts = g.current_chunk_parts.deinit(allocator),
                .current_css_files = if (side == .client) g.current_css_files.deinit(allocator),
            };
        }

        const MemoryCost = struct {
            graph: usize,
            code: usize,
            source_maps: usize,
        };

        /// Does NOT count @sizeOf(@This())
        pub fn memoryCostDetailed(g: *@This(), new_dedupe_bits: u32) @This().MemoryCost {
            var graph: usize = 0;
            var code: usize = 0;
            var source_maps: usize = 0;
            graph += DevServer.memoryCostArrayHashMap(g.bundled_files);
            graph += g.stale_files.bytes().len;
            graph += DevServer.memoryCostArrayList(g.first_dep);
            graph += DevServer.memoryCostArrayList(g.first_import);
            graph += DevServer.memoryCostArrayList(g.edges);
            graph += DevServer.memoryCostArrayList(g.edges_free_list);
            graph += DevServer.memoryCostArrayList(g.current_chunk_parts);
            if (side == .client) {
                graph += DevServer.memoryCostArrayList(g.current_css_files);
                for (g.bundled_files.values()) |*file| {
                    if (file.flags.kind.hasInlinejscodeChunk()) code += file.code_len;
                    switch (file.sourceMap()) {
                        .ref => |ptr| {
                            source_maps += ptr.data.memoryCostWithDedupe(new_dedupe_bits);
                        },
                        .empty => {},
                    }
                }
            }
            return .{
                .graph = graph,
                .code = code,
                .source_maps = source_maps,
            };
        }

        pub fn getFileIndex(g: *@This(), path: []const u8) ?FileIndex {
            return if (g.bundled_files.getIndex(path)) |i| FileIndex.init(@intCast(i)) else null;
        }

        /// Prefer calling .values() and indexing manually if accessing more than one
        pub fn getFileByIndex(g: *@This(), index: FileIndex) File {
            return g.bundled_files.values()[index.get()];
        }

        pub fn htmlRouteBundleIndex(g: *@This(), index: FileIndex) RouteBundle.Index {
            if (Environment.allow_assert) {
                assert(g.bundled_files.values()[index.get()].flags.is_html_route);
            }
            return .init(@intCast((g.bundled_files.values()[index.get()].source_map.empty.html_bundle_route_index.unwrap() orelse
                @panic("Internal assertion failure: HTML bundle not registered correctly")).get()));
        }

        /// Tracks a bundled code chunk for cross-bundle chunks,
        /// ensuring it has an entry in `bundled_files`.
        ///
        /// For client, takes ownership of the code slice (must be default allocated)
        ///
        /// For server, the code is temporarily kept in the
        /// `current_chunk_parts` array, where it must live until
        /// takeJSBundle is called. Then it can be freed.
        pub fn receiveChunk(
            g: *@This(),
            ctx: *HotUpdateContext,
            index: bun.ast.Index,
            content: union(enum) {
                js: struct {
                    code: []const u8,
                    source_map: ?struct {
                        chunk: SourceMap.Chunk,
                        escaped_source: []u8,
                    },
                },
                css: u64,
            },
            is_ssr_graph: bool,
        ) !void {
            const dev = g.owner();
            dev.graph_safety_lock.assertLocked();

            const path = ctx.sources[index.get()].path;
            const key = path.keyForIncrementalGraph();

            if (Environment.allow_assert) {
                switch (content) {
                    .css => {},
                    .js => |js| if (bun.strings.isAllWhitespace(js.code)) {
                        // Should at least contain the function wrapper
                        bun.Output.panic("Empty chunk is impossible: {s} {s}", .{
                            key,
                            switch (side) {
                                .client => "client",
                                .server => if (is_ssr_graph) "ssr" else "server",
                            },
                        });
                    },
                }
            }

            // Dump to filesystem if enabled
            if (bun.FeatureFlags.bake_debugging_features and content == .js) if (dev.dump_dir) |dump_dir| {
                DevServer.dumpBundleForChunk(dev, dump_dir, side, key, content.js.code, true, is_ssr_graph);
            };

            const gop = try g.bundled_files.getOrPut(dev.allocator, key);
            const file_index = FileIndex.init(@intCast(gop.index));

            if (!gop.found_existing) {
                gop.key_ptr.* = try dev.allocator.dupe(u8, key);
                try g.first_dep.append(dev.allocator, .none);
                try g.first_import.append(dev.allocator, .none);
            }

            if (g.stale_files.bit_length > gop.index) {
                g.stale_files.unset(gop.index);
            }

            ctx.getCachedIndex(side, index).* = .init(FileIndex.init(@intCast(gop.index)));

            switch (side) {
                .client => {
                    var flags: File.Flags = .{
                        .failed = false,
                        .is_hmr_root = ctx.server_to_client_bitset.isSet(index.get()),
                        .is_special_framework_file = false,
                        .is_html_route = false,
                        .is_css_root = content == .css, // non-root CSS files never get registered in this function
                        .kind = switch (content) {
                            .js => if (ctx.loaders[index.get()].isJavaScriptLike()) .js else .asset,
                            .css => .css,
                        },
                        .source_map_state = .empty,
                    };
                    if (gop.found_existing) {
                        // Free the original content + old source map
                        g.freeFileContent(key, gop.value_ptr, .ignore_css);

                        // Free a failure if it exists
                        if (gop.value_ptr.flags.failed) {
                            const kv = dev.bundling_failures.fetchSwapRemoveAdapted(
                                SerializedFailure.Owner{ .client = file_index },
                                SerializedFailure.ArrayHashAdapter{},
                            ) orelse
                                Output.panic("Missing SerializedFailure in IncrementalGraph", .{});
                            try dev.incremental_result.failures_removed.append(
                                dev.allocator,
                                kv.key,
                            );
                        }

                        // Persist some flags
                        flags.is_special_framework_file = gop.value_ptr.flags.is_special_framework_file;
                        flags.is_html_route = gop.value_ptr.flags.is_html_route;
                    }
                    switch (content) {
                        .css => |css| gop.value_ptr.* = .initCSS(css, flags),
                        .js => |js| {
                            dev.allocation_scope.assertOwned(js.code);

                            // Insert new source map or patch existing empty source map.
                            const source_map: PackedMap.RefOrEmpty = brk: {
                                if (js.source_map) |source_map| {
                                    bun.debugAssert(!flags.is_html_route); // suspect behind #17956
                                    if (source_map.chunk.buffer.len() > 0) {
                                        dev.allocation_scope.assertOwned(source_map.chunk.buffer.list.items);
                                        dev.allocation_scope.assertOwned(source_map.escaped_source);
                                        flags.source_map_state = .ref;
                                        break :brk .{ .ref = PackedMap.newNonEmpty(
                                            source_map.chunk,
                                            source_map.escaped_source,
                                        ) };
                                    }
                                    var take = source_map.chunk.buffer;
                                    take.deinit();
                                    dev.allocator.free(source_map.escaped_source);
                                }

                                // Must precompute this. Otherwise, source maps won't have
                                // the info needed to concatenate VLQ mappings.
                                const count: u32 = @intCast(bun.strings.countChar(js.code, '\n'));
                                break :brk .{ .empty = .{
                                    .line_count = .init(count),
                                    .html_bundle_route_index = if (flags.is_html_route) ri: {
                                        assert(gop.found_existing);
                                        assert(gop.value_ptr.flags.source_map_state == .empty);
                                        break :ri gop.value_ptr.source_map.empty.html_bundle_route_index;
                                    } else .none,
                                } };
                            };

                            gop.value_ptr.* = .initJavaScript(js.code, flags, source_map);

                            // Track JavaScript chunks for concatenation
                            try g.current_chunk_parts.append(dev.allocator, file_index);
                            g.current_chunk_len += js.code.len;
                        },
                    }
                },
                .server => {
                    if (!gop.found_existing) {
                        const client_component_boundary = ctx.server_to_client_bitset.isSet(index.get());

                        gop.value_ptr.* = .{
                            .is_rsc = !is_ssr_graph,
                            .is_ssr = is_ssr_graph,
                            .is_route = false,
                            .is_client_component_boundary = client_component_boundary,
                            .failed = false,
                            .kind = switch (content) {
                                .js => .js,
                                .css => .css,
                            },
                        };

                        if (client_component_boundary) {
                            try dev.incremental_result.client_components_added.append(dev.allocator, file_index);
                        }
                    } else {
                        gop.value_ptr.kind = switch (content) {
                            .js => .js,
                            .css => .css,
                        };

                        if (is_ssr_graph) {
                            gop.value_ptr.is_ssr = true;
                        } else {
                            gop.value_ptr.is_rsc = true;
                        }

                        if (ctx.server_to_client_bitset.isSet(index.get())) {
                            gop.value_ptr.is_client_component_boundary = true;
                            try dev.incremental_result.client_components_added.append(dev.allocator, file_index);
                        } else if (gop.value_ptr.is_client_component_boundary) {
                            const client_graph = &g.owner().client_graph;
                            const client_index = client_graph.getFileIndex(gop.key_ptr.*) orelse
                                Output.panic("Client graph's SCB was already deleted", .{});
                            client_graph.disconnectAndDeleteFile(client_index);
                            gop.value_ptr.is_client_component_boundary = false;

                            try dev.incremental_result.client_components_removed.append(dev.allocator, file_index);
                        }

                        if (gop.value_ptr.failed) {
                            gop.value_ptr.failed = false;
                            const kv = dev.bundling_failures.fetchSwapRemoveAdapted(
                                SerializedFailure.Owner{ .server = file_index },
                                SerializedFailure.ArrayHashAdapter{},
                            ) orelse
                                Output.panic("Missing failure in IncrementalGraph", .{});
                            try dev.incremental_result.failures_removed.append(
                                dev.allocator,
                                kv.key,
                            );
                        }
                    }
                    if (content == .js) {
                        try g.current_chunk_parts.append(dev.allocator, content.js.code);
                        g.current_chunk_len += content.js.code.len;
                        if (content.js.source_map) |source_map| {
                            var take = source_map.chunk.buffer;
                            take.deinit();
                            dev.allocator.free(source_map.escaped_source);
                        }
                    }
                },
            }
        }

        const TempLookup = extern struct {
            edge_index: EdgeIndex,
            seen: bool,

            const HashTable = AutoArrayHashMapUnmanaged(FileIndex, TempLookup);
        };

        /// Second pass of IncrementalGraph indexing
        /// - Updates dependency information for each file
        /// - Resolves what the HMR roots are
        pub fn processChunkDependencies(
            g: *@This(),
            ctx: *HotUpdateContext,
            comptime mode: enum { normal, css },
            bundle_graph_index: bun.ast.Index,
            temp_alloc: Allocator,
        ) bun.OOM!void {
            const log = bun.Output.scoped(.processChunkDependencies, false);
            const file_index: FileIndex = ctx.getCachedIndex(side, bundle_graph_index).*.unwrap() orelse
                @panic("unresolved index"); // do not process for failed chunks
            log("index id={d} {}:", .{
                file_index.get(),
                bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
            });

            // Build a map from the existing import list. Later, entries that
            // were not marked as `.seen = true` will be freed.
            var quick_lookup: TempLookup.HashTable = .{};
            defer quick_lookup.deinit(temp_alloc);
            {
                var it: ?EdgeIndex = g.first_import.items[file_index.get()].unwrap();
                while (it) |edge_index| {
                    const dep = g.edges.items[edge_index.get()];
                    it = dep.next_import.unwrap();
                    assert(dep.dependency == file_index);
                    try quick_lookup.putNoClobber(temp_alloc, dep.imported, .{
                        .seen = false,
                        .edge_index = edge_index,
                    });
                }
            }

            // `processChunkImportRecords` appends items into `quick_lookup`,
            // but those entries always have .seen = true. Snapshot the length
            // of original entries so that the new ones can be ignored when
            // removing edges.
            const quick_lookup_values_to_care_len = quick_lookup.count();

            // A new import linked list is constructed. A side effect of this
            // approach is that the order of the imports is reversed on every
            // save. However, the ordering here doesn't matter.
            var new_imports: EdgeIndex.Optional = .none;
            defer g.first_import.items[file_index.get()] = new_imports;

            // (CSS chunks are not present on the server side)
            if (mode == .normal and side == .server) {
                if (ctx.server_seen_bit_set.isSet(file_index.get())) return;

                const file = &g.bundled_files.values()[file_index.get()];

                // Process both files in the server-components graph at the same
                // time. If they were done separately, the second would detach
                // the edges the first added.
                if (file.is_rsc and file.is_ssr) {
                    // The non-ssr file is always first.
                    // TODO:
                    // const ssr_index = ctx.scbs.getSSRIndex(bundle_graph_index.get()) orelse {
                    //     @panic("Unexpected missing server-component-boundary entry");
                    // };
                    // try g.processChunkImportRecords(ctx, &quick_lookup, &new_imports, file_index, bun.ast.Index.init(ssr_index));
                }
            }

            switch (mode) {
                .normal => try g.processChunkImportRecords(ctx, temp_alloc, &quick_lookup, &new_imports, file_index, bundle_graph_index),
                .css => try g.processCSSChunkImportRecords(ctx, temp_alloc, &quick_lookup, &new_imports, file_index, bundle_graph_index),
            }

            // We need to add this here to not trip up
            // `checkEdgeRemoval(edge_idx)` (which checks that there no
            // references to `edge_idx`.
            //
            // I don't think `g.first_import.items[file_index]` is ever read
            // from again in this function, so this is safe.
            g.first_import.items[file_index.get()] = .none;

            // '.seen = false' means an import was removed and should be freed
            for (quick_lookup.values()[0..quick_lookup_values_to_care_len]) |val| {
                if (!val.seen) {
                    g.owner().incremental_result.had_adjusted_edges = true;

                    // Unlink from dependency list. At this point the edge is
                    // already detached from the import list.
                    g.disconnectEdgeFromDependencyList(val.edge_index);

                    // With no references to this edge, it can be freed
                    g.freeEdge(val.edge_index);
                }
            }

            if (side == .server) {
                // Follow this file to the route to mark it as stale.
                try g.traceDependencies(file_index, ctx.gts, .stop_at_boundary, file_index);
            } else {
                // Follow this file to the HTML route or HMR root to mark the client bundle as stale.
                try g.traceDependencies(file_index, ctx.gts, .stop_at_boundary, file_index);
            }
        }

        /// When we delete an edge, we need to delete it by connecting the
        /// previous dependency (importer) edge to the next depedenency
        /// (importer) edge.
        ///
        /// DO NOT ONLY CALL THIS FUNCTION TO TRY TO DELETE AN EDGE, YOU MUST DELETE
        /// THE IMPORTS TOO!
        fn disconnectEdgeFromDependencyList(g: *@This(), edge_index: EdgeIndex) void {
            const edge = &g.edges.items[edge_index.get()];
            const imported = edge.imported.get();
            const log = bun.Output.scoped(.disconnectEdgeFromDependencyList, true);
            log("detach edge={d} | id={d} {} -> id={d} {} (first_dep={d})", .{
                edge_index.get(),
                edge.dependency.get(),
                bun.fmt.quote(g.bundled_files.keys()[edge.dependency.get()]),
                imported,
                bun.fmt.quote(g.bundled_files.keys()[edge.imported.get()]),
                if (g.first_dep.items[imported].unwrap()) |first_dep| first_dep.get() else 42069000,
            });

            // Delete this edge by connecting the previous dependency to the
            // next dependency and vice versa
            if (edge.prev_dependency.unwrap()) |prev| {
                const prev_dependency = &g.edges.items[prev.get()];
                prev_dependency.next_dependency = edge.next_dependency;

                if (edge.next_dependency.unwrap()) |next| {
                    const next_dependency = &g.edges.items[next.get()];
                    next_dependency.prev_dependency = edge.prev_dependency;
                }
            } else {
                // If no prev dependency, this better be the first one!
                assert_eql(g.first_dep.items[edge.imported.get()].unwrap(), edge_index);

                // The edge has no prev dependency, but it *might* have a next dependency!
                if (edge.next_dependency.unwrap()) |next| {
                    const next_dependency = &g.edges.items[next.get()];
                    next_dependency.prev_dependency = .none;
                    g.first_dep.items[edge.imported.get()] = next.toOptional();
                } else {
                    g.first_dep.items[edge.imported.get()] = .none;
                }
            }
        }

        fn processCSSChunkImportRecords(
            g: *@This(),
            ctx: *HotUpdateContext,
            temp_alloc: Allocator,
            quick_lookup: *TempLookup.HashTable,
            new_imports: *EdgeIndex.Optional,
            file_index: FileIndex,
            bundler_index: bun.ast.Index,
        ) !void {
            bun.assert(bundler_index.isValid());
            bun.assert(ctx.loaders[bundler_index.get()].isCSS());

            var sfb = std.heap.stackFallback(@sizeOf(bun.ast.Index) * 64, temp_alloc);
            const queue_alloc = sfb.get();

            // This queue avoids stack overflow.
            // Infinite loop is prevented by the tracing bits in `processEdgeAttachment`.
            var queue: ArrayListUnmanaged(bun.ast.Index) = .empty;
            defer queue.deinit(queue_alloc);

            for (ctx.import_records[bundler_index.get()].slice()) |import_record| {
                const result = try processEdgeAttachment(g, ctx, temp_alloc, quick_lookup, new_imports, file_index, import_record, .css);
                if (result == .@"continue" and import_record.source_index.isValid()) {
                    try queue.append(queue_alloc, import_record.source_index);
                }
            }

            while (queue.pop()) |index| {
                for (ctx.import_records[index.get()].slice()) |import_record| {
                    const result = try processEdgeAttachment(g, ctx, temp_alloc, quick_lookup, new_imports, file_index, import_record, .css);
                    if (result == .@"continue" and import_record.source_index.isValid()) {
                        try queue.append(queue_alloc, import_record.source_index);
                    }
                }
            }
        }

        fn processEdgeAttachment(
            g: *@This(),
            ctx: *HotUpdateContext,
            temp_alloc: Allocator,
            quick_lookup: *TempLookup.HashTable,
            new_imports: *EdgeIndex.Optional,
            file_index: FileIndex,
            import_record: bun.ImportRecord,
            comptime mode: enum {
                js_or_html,
                /// When set, the graph tracing state bits are used to prevent
                /// infinite recursion. This is only done for CSS, since it:
                /// - Recursively processes its imports
                /// - Does not use its tracing bits for anything else
                css,
            },
        ) bun.OOM!enum { @"continue", stop } {
            const log = bun.Output.scoped(.processEdgeAttachment, false);

            // When an import record is duplicated, it gets marked unused.
            // This happens in `ConvertESMExportsForHmr.deduplicatedImport`
            // There is still a case where deduplication must happen.
            if (import_record.is_unused) return .stop;
            if (import_record.source_index.isRuntime()) return .stop;

            const key = import_record.path.keyForIncrementalGraph();
            log("processEdgeAttachment({s}, {})", .{ key, import_record.source_index });

            // Attempt to locate the FileIndex from bundle_v2's Source.Index
            const imported_file_index: FileIndex, const kind = brk: {
                if (import_record.source_index.isValid()) {
                    const kind: FileKind = if (mode == .css)
                        switch (ctx.loaders[import_record.source_index.get()]) {
                            .css => .css,
                            else => .asset,
                        };
                    if (ctx.getCachedIndex(side, import_record.source_index).*.unwrap()) |i| {
                        break :brk .{ i, kind };
                    } else if (mode == .css) {
                        const index = (try g.insertEmpty(key, kind)).index;
                        // TODO: make this more clear that:
                        // temp_alloc == bv2.graph.allocator
                        try ctx.gts.resize(side, temp_alloc, index.get() + 1);
                        break :brk .{ index, kind };
                    }
                }

                break :brk switch (mode) {
                    // All invalid source indices are external URLs that cannot be watched.
                    .css => return .stop,
                    // Check IncrementalGraph to find an file from a prior build.
                    .js_or_html => .{
                        .init(@intCast(
                            g.bundled_files.getIndex(key) orelse
                                // Not tracked in IncrementalGraph. This can be hit for
                                // certain external files.
                                return .@"continue",
                        )),
                        {},
                    },
                };
            };

            if (Environment.isDebug) {
                bun.assert(imported_file_index.get() < g.bundled_files.count());
            }

            // For CSS files visiting other CSS files, prevent infinite
            // recursion.  CSS files visiting assets cannot cause recursion
            // since assets cannot import other files.
            if (mode == .css and kind == .css) {
                if (ctx.gts.bits(side).isSet(imported_file_index.get()))
                    return .stop;
                ctx.gts.bits(side).set(imported_file_index.get());
            }

            const gop = try quick_lookup.getOrPut(temp_alloc, imported_file_index);
            if (gop.found_existing) {
                // If the edge has already been seen, it will be skipped
                // to ensure duplicate edges never exist.
                if (gop.value_ptr.seen) return .@"continue";
                const lookup = gop.value_ptr;
                lookup.seen = true;
                const dep = &g.edges.items[lookup.edge_index.get()];
                dep.next_import = new_imports.*;
                new_imports.* = lookup.edge_index.toOptional();
            } else {
                // A new edge is needed to represent the dependency and import.
                const first_dep = &g.first_dep.items[imported_file_index.get()];
                const edge = try g.newEdge(.{
                    .next_import = new_imports.*,
                    .next_dependency = first_dep.*,
                    .prev_dependency = .none,
                    .imported = imported_file_index,
                    .dependency = file_index,
                });
                if (first_dep.*.unwrap()) |dep| {
                    g.edges.items[dep.get()].prev_dependency = edge.toOptional();
                }
                new_imports.* = edge.toOptional();
                first_dep.* = edge.toOptional();

                g.owner().incremental_result.had_adjusted_edges = true;

                // To prevent duplicates, add into the quick lookup map
                // the file index so that it does exist.
                gop.value_ptr.* = .{
                    .edge_index = edge,
                    .seen = true,
                };

                log("attach edge={d} | id={d} {} -> id={d} {}", .{
                    edge.get(),
                    file_index.get(),
                    bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
                    imported_file_index.get(),
                    bun.fmt.quote(g.bundled_files.keys()[imported_file_index.get()]),
                });
            }

            return .@"continue";
        }

        fn processChunkImportRecords(
            g: *@This(),
            ctx: *HotUpdateContext,
            temp_alloc: Allocator,
            quick_lookup: *TempLookup.HashTable,
            new_imports: *EdgeIndex.Optional,
            file_index: FileIndex,
            index: bun.ast.Index,
        ) !void {
            bun.assert(index.isValid());
            // don't call this function for CSS sources
            bun.assert(ctx.loaders[index.get()] != .css);

            const log = bun.Output.scoped(.processChunkDependencies, false);
            for (ctx.import_records[index.get()].slice()) |import_record| {
                // When an import record is duplicated, it gets marked unused.
                // This happens in `ConvertESMExportsForHmr.deduplicatedImport`
                // There is still a case where deduplication must happen.
                if (import_record.is_unused) continue;

                if (!import_record.source_index.isRuntime()) try_index_record: {
                    // TODO: move this block into a function
                    const key = import_record.path.keyForIncrementalGraph();
                    const imported_file_index: FileIndex = brk: {
                        if (import_record.source_index.isValid()) {
                            if (ctx.getCachedIndex(side, import_record.source_index).*.unwrap()) |i| {
                                break :brk i;
                            }
                        }
                        break :brk .init(@intCast(
                            g.bundled_files.getIndex(key) orelse
                                break :try_index_record,
                        ));
                    };

                    if (Environment.isDebug) {
                        bun.assert(imported_file_index.get() < g.bundled_files.count());
                    }

                    const gop = try quick_lookup.getOrPut(temp_alloc, imported_file_index);
                    if (gop.found_existing) {
                        // If the edge has already been seen, it will be skipped
                        // to ensure duplicate edges never exist.
                        if (gop.value_ptr.seen) continue;
                        const lookup = gop.value_ptr;
                        lookup.seen = true;
                        const dep = &g.edges.items[lookup.edge_index.get()];
                        dep.next_import = new_imports.*;
                        new_imports.* = lookup.edge_index.toOptional();
                    } else {
                        // A new edge is needed to represent the dependency and import.
                        const first_dep = &g.first_dep.items[imported_file_index.get()];
                        const edge = try g.newEdge(.{
                            .next_import = new_imports.*,
                            .next_dependency = first_dep.*,
                            .prev_dependency = .none,
                            .imported = imported_file_index,
                            .dependency = file_index,
                        });
                        if (first_dep.*.unwrap()) |dep| {
                            g.edges.items[dep.get()].prev_dependency = edge.toOptional();
                        }
                        new_imports.* = edge.toOptional();
                        first_dep.* = edge.toOptional();

                        g.owner().incremental_result.had_adjusted_edges = true;

                        // To prevent duplicates, add into the quick lookup map
                        // the file index so that it does exist.
                        gop.value_ptr.* = .{
                            .edge_index = edge,
                            .seen = true,
                        };

                        log("attach edge={d} | id={d} {} -> id={d} {}", .{
                            edge.get(),
                            file_index.get(),
                            bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
                            imported_file_index.get(),
                            bun.fmt.quote(g.bundled_files.keys()[imported_file_index.get()]),
                        });
                    }
                }
            }
        }

        const TraceDependencyGoal = enum {
            stop_at_boundary,
            no_stop,
        };

        pub fn traceDependencies(
            g: *@This(),
            file_index: FileIndex,
            gts: *GraphTraceState,
            goal: TraceDependencyGoal,
            from_file_index: FileIndex,
        ) !void {
            g.owner().graph_safety_lock.assertLocked();

            if (Environment.enable_logs) {
                igLog("traceDependencies(.{s}, {}{s})", .{
                    @tagName(side),
                    bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
                    if (gts.bits(side).isSet(file_index.get())) " [already visited]" else "",
                });
            }

            if (gts.bits(side).isSet(file_index.get()))
                return;
            gts.bits(side).set(file_index.get());

            const file = g.bundled_files.values()[file_index.get()];

            switch (side) {
                .server => {
                    const dev = g.owner();
                    if (file.is_route) {
                        const route_index = dev.route_lookup.get(file_index) orelse
                            Output.panic("Route not in lookup index: {d} {}", .{ file_index.get(), bun.fmt.quote(g.bundled_files.keys()[file_index.get()]) });
                        igLog("\\<- Route", .{});

                        try dev.incremental_result.framework_routes_affected.append(dev.allocator, route_index);
                    }
                    if (file.is_client_component_boundary) {
                        try dev.incremental_result.client_components_affected.append(dev.allocator, file_index);
                    }
                },
                .client => {
                    const dev = g.owner();
                    if (file.flags.is_hmr_root) {
                        const key = g.bundled_files.keys()[file_index.get()];
                        const index = dev.server_graph.getFileIndex(key) orelse
                            Output.panic("Server Incremental Graph is missing component for {}", .{bun.fmt.quote(key)});
                        try dev.server_graph.traceDependencies(index, gts, goal, index);
                    } else if (file.flags.is_html_route) {
                        const route_bundle_index = dev.client_graph.htmlRouteBundleIndex(file_index);

                        // If the HTML file itself was modified, or an asset was
                        // modified, this must be a hard reload. Otherwise just
                        // invalidate the script tag.
                        const list = if (from_file_index == file_index or
                            g.bundled_files.values()[from_file_index.get()].flags.kind == .asset)
                            &dev.incremental_result.html_routes_hard_affected
                        else
                            &dev.incremental_result.html_routes_soft_affected;

                        try list.append(dev.allocator, route_bundle_index);

                        if (goal == .stop_at_boundary)
                            return;
                    }
                },
            }

            // Certain files do not propagate updates to dependencies.
            // This is how updating a client component doesn't cause
            // a server-side reload.
            if (goal == .stop_at_boundary) {
                if (file.stopsDependencyTrace()) {
                    igLog("\\<- this file stops propagation", .{});
                    return;
                }
            }

            // Recurse
            var it: ?EdgeIndex = g.first_dep.items[file_index.get()].unwrap();
            while (it) |dep_index| {
                const edge = g.edges.items[dep_index.get()];
                it = edge.next_dependency.unwrap();
                try g.traceDependencies(
                    edge.dependency,
                    gts,
                    goal,
                    file_index,
                );
            }
        }

        pub fn traceImports(g: *@This(), file_index: FileIndex, gts: *GraphTraceState, comptime goal: DevServer.TraceImportGoal) !void {
            g.owner().graph_safety_lock.assertLocked();

            if (Environment.enable_logs) {
                igLog("traceImports(.{s}, .{s}, {}{s})", .{
                    @tagName(side),
                    @tagName(goal),
                    bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
                    if (gts.bits(side).isSet(file_index.get())) " [already visited]" else "",
                });
            }

            if (gts.bits(side).isSet(file_index.get()))
                return;
            gts.bits(side).set(file_index.get());

            const file = g.bundled_files.values()[file_index.get()];

            switch (side) {
                .server => {
                    if (file.is_client_component_boundary or file.kind == .css) {
                        const dev = g.owner();
                        const key = g.bundled_files.keys()[file_index.get()];
                        const index = dev.client_graph.getFileIndex(key) orelse
                            Output.panic("Client Incremental Graph is missing component for {}", .{bun.fmt.quote(key)});
                        try dev.client_graph.traceImports(index, gts, goal);

                        if (Environment.isDebug and file.kind == .css) {
                            // Server CSS files never have imports. They are
                            // purely a reference to the client graph.
                            bun.assert(g.first_import.items[file_index.get()] == .none);
                        }
                    }
                    if (goal == .find_errors and file.failed) {
                        const fail = g.owner().bundling_failures.getKeyAdapted(
                            SerializedFailure.Owner{ .server = file_index },
                            SerializedFailure.ArrayHashAdapter{},
                        ) orelse
                            @panic("Failed to get bundling failure");
                        try g.owner().incremental_result.failures_added.append(g.owner().allocator, fail);
                    }
                },
                .client => {
                    if (file.flags.kind == .css) {
                        // It is only possible to find CSS roots by tracing.
                        bun.debugAssert(file.flags.is_css_root);

                        if (goal == .find_css) {
                            try g.current_css_files.append(g.owner().allocator, file.cssAssetId());
                        }

                        // See the comment on `is_css_root` on how CSS roots
                        // have a slightly different meaning for their assets.
                        // Regardless, CSS can't import JS, so this trace is done.
                        return;
                    }

                    if (goal == .find_client_modules) {
                        try g.current_chunk_parts.append(g.owner().allocator, file_index);
                        g.current_chunk_len += file.code_len;
                    }

                    if (goal == .find_errors and file.flags.failed) {
                        const fail = g.owner().bundling_failures.getKeyAdapted(
                            SerializedFailure.Owner{ .client = file_index },
                            SerializedFailure.ArrayHashAdapter{},
                        ) orelse
                            @panic("Failed to get bundling failure");
                        try g.owner().incremental_result.failures_added.append(g.owner().allocator, fail);
                        return;
                    }
                },
            }

            // Recurse
            var it: ?EdgeIndex = g.first_import.items[file_index.get()].unwrap();
            while (it) |dep_index| {
                const edge = g.edges.items[dep_index.get()];
                it = edge.next_import.unwrap();
                try g.traceImports(edge.imported, gts, goal);
            }
        }

        /// Never takes ownership of `abs_path`
        /// Marks a chunk but without any content. Used to track dependencies to files that don't exist.
        pub fn insertStale(g: *@This(), abs_path: []const u8, is_ssr_graph: bool) bun.OOM!FileIndex {
            return g.insertStaleExtra(abs_path, is_ssr_graph, false);
        }

        pub fn insertStaleExtra(g: *@This(), abs_path: []const u8, is_ssr_graph: bool, is_route: bool) bun.OOM!FileIndex {
            g.owner().graph_safety_lock.assertLocked();
            const dev_allocator = g.owner().allocator;

            debug.log("Insert stale: {s}", .{abs_path});
            const gop = try g.bundled_files.getOrPut(dev_allocator, abs_path);
            const file_index = FileIndex.init(@intCast(gop.index));

            if (!gop.found_existing) {
                gop.key_ptr.* = try dev_allocator.dupe(u8, abs_path);
                try g.first_dep.append(dev_allocator, .none);
                try g.first_import.append(dev_allocator, .none);
            } else {
                if (side == .server) {
                    if (is_route) gop.value_ptr.*.is_route = true;
                }
            }

            if (g.stale_files.bit_length > gop.index) {
                g.stale_files.set(gop.index);
            }

            switch (side) {
                .client => {
                    var flags: File.Flags = .{
                        .failed = false,
                        .is_hmr_root = false,
                        .is_special_framework_file = false,
                        .is_html_route = is_route,
                        .is_css_root = false,
                        .source_map_state = .empty,
                        .kind = .unknown,
                    };
                    var source_map = PackedMap.RefOrEmpty.blank_empty.empty;
                    if (gop.found_existing) {
                        g.freeFileContent(gop.key_ptr.*, gop.value_ptr, .unref_css);

                        flags.is_html_route = flags.is_html_route or gop.value_ptr.flags.is_html_route;
                        flags.failed = gop.value_ptr.flags.failed;
                        flags.is_special_framework_file = gop.value_ptr.flags.is_special_framework_file;
                        flags.is_hmr_root = gop.value_ptr.flags.is_hmr_root;
                        flags.is_css_root = gop.value_ptr.flags.is_css_root;
                        source_map = gop.value_ptr.source_map.empty;
                    }
                    gop.value_ptr.* = File.initUnknown(flags, source_map);
                },
                .server => {
                    if (!gop.found_existing) {
                        gop.value_ptr.* = .{
                            .is_rsc = !is_ssr_graph,
                            .is_ssr = is_ssr_graph,
                            .is_route = is_route,
                            .is_client_component_boundary = false,
                            .failed = false,
                            .kind = .unknown,
                        };
                    } else if (is_ssr_graph) {
                        gop.value_ptr.is_ssr = true;
                    } else {
                        gop.value_ptr.is_rsc = true;
                    }
                },
            }

            return file_index;
        }

        /// Returns the key that was inserted.
        pub fn insertEmpty(g: *@This(), abs_path: []const u8, kind: FileKind) bun.OOM!struct {
            index: FileIndex,
            key: []const u8,
        } {
            g.owner().graph_safety_lock.assertLocked();
            const dev_allocator = g.owner().allocator;
            const gop = try g.bundled_files.getOrPut(dev_allocator, abs_path);
            if (!gop.found_existing) {
                gop.key_ptr.* = try dev_allocator.dupe(u8, abs_path);
                gop.value_ptr.* = switch (side) {
                    .client => File.initUnknown(.{
                        .failed = false,
                        .is_hmr_root = false,
                        .is_special_framework_file = false,
                        .is_html_route = false,
                        .is_css_root = false,
                        .source_map_state = .empty,
                        .kind = kind,
                    }, PackedMap.RefOrEmpty.blank_empty.empty),
                    .server => .{
                        .is_rsc = false,
                        .is_ssr = false,
                        .is_route = false,
                        .is_client_component_boundary = false,
                        .failed = false,
                        .kind = kind,
                    },
                };
                try g.first_dep.append(dev_allocator, .none);
                try g.first_import.append(dev_allocator, .none);
                try g.ensureStaleBitCapacity(true);
            }
            return .{ .index = .init(@intCast(gop.index)), .key = gop.key_ptr.* };
        }

        /// Server CSS files are just used to be targets for graph traversal.
        /// Its content lives only on the client.
        pub fn insertCssFileOnServer(g: *@This(), ctx: *HotUpdateContext, index: bun.ast.Index, abs_path: []const u8) bun.OOM!void {
            g.owner().graph_safety_lock.assertLocked();
            const dev_allocator = g.owner().allocator;

            debug.log("Insert stale: {s}", .{abs_path});
            const gop = try g.bundled_files.getOrPut(dev_allocator, abs_path);
            const file_index: FileIndex = .init(@intCast(gop.index));

            if (!gop.found_existing) {
                gop.key_ptr.* = try dev_allocator.dupe(u8, abs_path);
                try g.first_dep.append(dev_allocator, .none);
                try g.first_import.append(dev_allocator, .none);
            }

            switch (side) {
                .client => @compileError("not implemented: use receiveChunk"),
                .server => gop.value_ptr.* = .{
                    .is_rsc = false,
                    .is_ssr = false,
                    .is_route = false,
                    .is_client_component_boundary = false,
                    .failed = false,
                    .kind = .css,
                },
            }

            ctx.getCachedIndex(.server, index).* = .init(file_index);
        }

        pub fn insertFailure(
            g: *@This(),
            comptime mode: enum { abs_path, index },
            key: switch (mode) {
                .abs_path => []const u8,
                .index => FileIndex,
            },
            log: *const Log,
            is_ssr_graph: bool,
        ) bun.OOM!void {
            g.owner().graph_safety_lock.assertLocked();

            const dev_allocator = g.owner().allocator;

            const Gop = std.StringArrayHashMapUnmanaged(File).GetOrPutResult;
            // found_existing is destructured separately so that it is
            // comptime-known true when mode == .index
            const gop: Gop, const found_existing, const file_index = switch (mode) {
                .abs_path => brk: {
                    const gop = try g.bundled_files.getOrPut(dev_allocator, key);
                    break :brk .{ gop, gop.found_existing, FileIndex.init(@intCast(gop.index)) };
                },
                // When given an index, no fetch is needed.
                .index => brk: {
                    const slice = g.bundled_files.entries.slice();
                    break :brk .{
                        .{
                            .key_ptr = &slice.items(.key)[key.get()],
                            .value_ptr = &slice.items(.value)[key.get()],
                            .found_existing = true,
                            .index = key.get(),
                        },
                        true,
                        key,
                    };
                },
            };

            if (!found_existing) {
                comptime assert(mode == .abs_path);
                gop.key_ptr.* = try dev_allocator.dupe(u8, key);
                try g.first_dep.append(dev_allocator, .none);
                try g.first_import.append(dev_allocator, .none);
            }

            try g.ensureStaleBitCapacity(true);
            g.stale_files.set(gop.index);

            switch (side) {
                .client => {
                    var flags: File.Flags = .{
                        .failed = true,
                        .is_hmr_root = false,
                        .is_special_framework_file = false,
                        .is_html_route = false,
                        .is_css_root = false,
                        .kind = .unknown,
                        .source_map_state = .empty,
                    };
                    var source_map = PackedMap.RefOrEmpty.blank_empty.empty;
                    if (found_existing) {
                        g.freeFileContent(gop.key_ptr.*, gop.value_ptr, .unref_css);
                        flags.is_html_route = gop.value_ptr.flags.is_html_route;
                        flags.is_special_framework_file = gop.value_ptr.flags.is_special_framework_file;
                        flags.is_hmr_root = gop.value_ptr.flags.is_hmr_root;
                        flags.is_css_root = gop.value_ptr.flags.is_css_root;
                        source_map = gop.value_ptr.source_map.empty;
                    }
                    gop.value_ptr.* = File.initUnknown(flags, source_map);
                },
                .server => {
                    if (!gop.found_existing) {
                        gop.value_ptr.* = .{
                            .is_rsc = !is_ssr_graph,
                            .is_ssr = is_ssr_graph,
                            .is_route = false,
                            .is_client_component_boundary = false,
                            .failed = true,
                            .kind = .unknown,
                        };
                    } else {
                        if (is_ssr_graph) {
                            gop.value_ptr.is_ssr = true;
                        } else {
                            gop.value_ptr.is_rsc = true;
                        }
                        gop.value_ptr.failed = true;
                    }
                },
            }

            const dev = g.owner();

            const fail_owner: SerializedFailure.Owner = switch (side) {
                .server => .{ .server = file_index },
                .client => .{ .client = file_index },
            };
            // TODO: DevServer should get a stdio manager which can process
            // the error list as it changes while also supporting a REPL
            log.print(Output.errorWriter()) catch {};
            const failure = failure: {
                const relative_path_buf = dev.relative_path_buf.lock();
                defer dev.relative_path_buf.unlock();
                // this string is just going to be memcpy'd into the log buffer
                const owner_display_name = dev.relativePath(relative_path_buf, gop.key_ptr.*);
                break :failure try SerializedFailure.initFromLog(
                    dev,
                    fail_owner,
                    owner_display_name,
                    log.msgs.items,
                );
            };
            const fail_gop = try dev.bundling_failures.getOrPut(dev.allocator, failure);
            try dev.incremental_result.failures_added.append(dev.allocator, failure);
            if (fail_gop.found_existing) {
                try dev.incremental_result.failures_removed.append(dev.allocator, fail_gop.key_ptr.*);
                fail_gop.key_ptr.* = failure;
            }
        }

        pub fn onFileDeleted(g: *@This(), abs_path: []const u8, bv2: *bun.BundleV2) void {
            const index = g.getFileIndex(abs_path) orelse return;

            const keys = g.bundled_files.keys();

            // Disconnect all imports
            var it: ?EdgeIndex = g.first_import.items[index.get()].unwrap();
            g.first_import.items[index.get()] = .none;
            while (it) |edge_index| {
                const dep = g.edges.items[edge_index.get()];
                it = dep.next_import.unwrap();
                assert(dep.dependency == index);

                g.disconnectEdgeFromDependencyList(edge_index);
                g.freeEdge(edge_index);
            }

            // Rebuild all dependencies
            it = g.first_dep.items[index.get()].unwrap();
            while (it) |edge_index| {
                const dep = g.edges.items[edge_index.get()];
                it = dep.next_dependency.unwrap();
                assert(dep.imported == index);

                bv2.enqueueFileFromDevServerIncrementalGraphInvalidation(
                    keys[dep.dependency.get()],
                    switch (side) {
                        .client => .browser,
                        .server => .bun,
                    },
                ) catch bun.outOfMemory();
            }

            // Bust the resolution caches of the dir containing this file,
            // so that it cannot be resolved.
            const dirname = std.fs.path.dirname(abs_path) orelse abs_path;
            _ = bv2.transpiler.resolver.bustDirCache(dirname);

            // Additionally, clear the cached entry of the file from the path to
            // source index map.
            const hash = bun.hash(abs_path);
            for (&bv2.graph.build_graphs.values) |*map| {
                _ = map.remove(hash);
            }
        }

        pub fn ensureStaleBitCapacity(g: *@This(), are_new_files_stale: bool) !void {
            try g.stale_files.resize(
                g.owner().allocator,
                std.mem.alignForward(
                    usize,
                    @max(g.bundled_files.count(), g.stale_files.bit_length),
                    // allocate 8 in 8 usize chunks
                    std.mem.byte_size_in_bits * @sizeOf(usize) * 8,
                ),
                are_new_files_stale,
            );
        }

        /// Given a set of paths, mark the relevant files as stale and append
        /// them into `entry_points`. This is called whenever a file is changed,
        /// and a new bundle has to be run.
        pub fn invalidate(g: *@This(), paths: []const []const u8, entry_points: *EntryPointList, alloc: Allocator) !void {
            g.owner().graph_safety_lock.assertLocked();
            const keys = g.bundled_files.keys();
            const values = g.bundled_files.values();
            for (paths) |path| {
                const index = g.bundled_files.getIndex(path) orelse {
                    // Cannot enqueue because it's impossible to know what
                    // targets to bundle for. Instead, a failing bundle must
                    // retrieve the list of files and add them as stale.
                    continue;
                };
                g.stale_files.set(index);
                const data = &values[index];
                switch (side) {
                    .client => switch (data.flags.kind) {
                        .css => {
                            if (data.flags.is_css_root) {
                                try entry_points.appendCss(alloc, path);
                            }

                            var it = g.first_dep.items[index].unwrap();
                            while (it) |edge_index| {
                                const entry = g.edges.items[edge_index.get()];
                                const dep = entry.dependency;
                                g.stale_files.set(dep.get());

                                const dep_file = values[dep.get()];
                                if (dep_file.flags.is_css_root) {
                                    try entry_points.appendCss(alloc, keys[dep.get()]);
                                }

                                it = entry.next_dependency.unwrap();
                            }
                        },
                        .asset => {
                            var it = g.first_dep.items[index].unwrap();
                            while (it) |edge_index| {
                                const entry = g.edges.items[edge_index.get()];
                                const dep = entry.dependency;
                                g.stale_files.set(dep.get());

                                const dep_file = values[dep.get()];
                                // Assets violate the "do not reprocess
                                // unchanged files" rule by reprocessing ALL
                                // dependencies, instead of just the CSS roots.
                                //
                                // This is currently required to force HTML
                                // bundles to become up to date with the new
                                // asset URL. Additionally, it is currently seen
                                // as a bit nicer in HMR to do this for all JS
                                // files, though that could be reconsidered.
                                if (dep_file.flags.is_css_root) {
                                    try entry_points.appendCss(alloc, keys[dep.get()]);
                                } else {
                                    try entry_points.appendJs(alloc, keys[dep.get()], .client);
                                }

                                it = entry.next_dependency.unwrap();
                            }

                            try entry_points.appendJs(alloc, path, .client);
                        },
                        // When re-bundling SCBs, only bundle the server. Otherwise
                        // the bundler gets confused and bundles both sides without
                        // knowledge of the boundary between them.
                        .js, .unknown => if (!data.flags.is_hmr_root) {
                            try entry_points.appendJs(alloc, path, .client);
                        },
                    },
                    .server => {
                        if (data.is_rsc)
                            try entry_points.appendJs(alloc, path, .server);
                        if (data.is_ssr and !data.is_client_component_boundary)
                            try entry_points.appendJs(alloc, path, .ssr);
                    },
                }
            }
        }

        pub fn reset(g: *@This()) void {
            g.owner().graph_safety_lock.assertLocked();
            g.current_chunk_len = 0;
            g.current_chunk_parts.clearRetainingCapacity();
            if (side == .client) g.current_css_files.clearRetainingCapacity();
        }

        const TakeJSBundleOptions = switch (side) {
            .client => struct {
                kind: ChunkKind,
                script_id: SourceMapStore.Key,
                initial_response_entry_point: []const u8 = "",
                react_refresh_entry_point: []const u8 = "",
                console_log: bool,
            },
            .server => struct {
                kind: ChunkKind,
            },
        };

        pub fn takeJSBundle(
            g: *@This(),
            options: *const TakeJSBundleOptions,
        ) ![]u8 {
            var chunk = std.ArrayList(u8).init(g.owner().allocator);
            try g.takeJSBundleToList(&chunk, options);
            bun.assert(chunk.items.len == chunk.capacity);
            return chunk.items;
        }

        pub fn takeJSBundleToList(
            g: *@This(),
            list: *std.ArrayList(u8),
            options: *const TakeJSBundleOptions,
        ) !void {
            const kind = options.kind;
            g.owner().graph_safety_lock.assertLocked();
            // initial bundle needs at least the entry point
            // hot updates shouldn't be emitted if there are no chunks
            assert(g.current_chunk_len > 0);

            const runtime: bake.HmrRuntime = switch (kind) {
                .initial_response => bun.bake.getHmrRuntime(side),
                .hmr_chunk => switch (side) {
                    .server => comptime .init("({"),
                    .client => comptime .init("self[Symbol.for(\"bun:hmr\")]({\n"),
                },
            };

            // A small amount of metadata is present at the end of the chunk
            // to inform the HMR runtime some crucial entry-point info. The
            // exact upper bound of this can be calculated, but is not to
            // avoid worrying about windows paths.
            var end_sfa = std.heap.stackFallback(65536, g.owner().allocator);
            var end_list = std.ArrayList(u8).initCapacity(end_sfa.get(), 65536) catch unreachable;
            defer end_list.deinit();
            const end = end: {
                const w = end_list.writer();
                switch (kind) {
                    .initial_response => {
                        if (side == .server) @panic("unreachable");
                        try w.writeAll("}, {\n  main: ");
                        const initial_response_entry_point = options.initial_response_entry_point;
                        if (initial_response_entry_point.len > 0) {
                            const relative_path_buf = g.owner().relative_path_buf.lock();
                            defer g.owner().relative_path_buf.unlock();
                            try bun.js_printer.writeJSONString(
                                g.owner().relativePath(relative_path_buf, initial_response_entry_point),
                                @TypeOf(w),
                                w,
                                .utf8,
                            );
                        } else {
                            try w.writeAll("null");
                        }
                        try w.writeAll(",\n  bun: \"" ++ bun.Global.package_json_version_with_canary ++ "\"");
                        try w.writeAll(",\n  generation: \"");
                        const generation: u32 = @intCast(options.script_id.get() >> 32);
                        try w.print("{s}", .{std.fmt.fmtSliceHexLower(std.mem.asBytes(&generation))});
                        try w.writeAll("\",\n  version: \"");
                        try w.writeAll(&g.owner().configuration_hash_key);

                        if (options.console_log) {
                            try w.writeAll("\",\n  console: true");
                        } else {
                            try w.writeAll("\",\n  console: false");
                        }

                        if (options.react_refresh_entry_point.len > 0) {
                            try w.writeAll(",\n  refresh: ");
                            const relative_path_buf = g.owner().relative_path_buf.lock();
                            defer g.owner().relative_path_buf.unlock();
                            try bun.js_printer.writeJSONString(
                                g.owner().relativePath(relative_path_buf, options.react_refresh_entry_point),
                                @TypeOf(w),
                                w,
                                .utf8,
                            );
                        }
                        try w.writeAll("\n})");
                    },
                    .hmr_chunk => switch (side) {
                        .client => {
                            try w.writeAll("}, \"");
                            try w.writeAll(&std.fmt.bytesToHex(std.mem.asBytes(&options.script_id), .lower));
                            try w.writeAll("\")");
                        },
                        .server => try w.writeAll("})"),
                    },
                }
                if (side == .client) {
                    try w.writeAll("\n//# sourceMappingURL=" ++ DevServer.client_prefix ++ "/");
                    try w.writeAll(&std.fmt.bytesToHex(std.mem.asBytes(&options.script_id), .lower));
                    try w.writeAll(".js.map\n");
                }
                break :end end_list.items;
            };

            const files = g.bundled_files.values();

            const start = list.items.len;
            if (start == 0)
                try list.ensureTotalCapacityPrecise(g.current_chunk_len + runtime.code.len + end.len)
            else
                try list.ensureUnusedCapacity(g.current_chunk_len + runtime.code.len + end.len);

            list.appendSliceAssumeCapacity(runtime.code);
            for (g.current_chunk_parts.items) |entry| {
                list.appendSliceAssumeCapacity(switch (side) {
                    // entry is an index into files
                    .client => files[entry.get()].jsCode(),
                    // entry is the '[]const u8' itself
                    .server => entry,
                });
            }
            list.appendSliceAssumeCapacity(end);

            if (bun.FeatureFlags.bake_debugging_features) if (g.owner().dump_dir) |dump_dir| {
                const rel_path_escaped = switch (kind) {
                    .initial_response => "latest_chunk.js",
                    .hmr_chunk => "latest_hmr.js",
                };
                DevServer.dumpBundle(dump_dir, switch (side) {
                    .client => .client,
                    .server => .server,
                }, rel_path_escaped, list.items[start..], false) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());
                    Output.warn("Could not dump bundle: {}", .{err});
                };
            };
        }

        pub const SourceMapGeneration = struct {
            json: []u8,
            mappings: bun.StringPointer,
            file_paths: [][]const u8,
        };

        /// Uses `arena` as a temporary allocator, fills in all fields of `out` except ref_count
        pub fn takeSourceMap(g: *@This(), arena: std.mem.Allocator, gpa: Allocator, out: *SourceMapStore.Entry) bun.OOM!void {
            if (side == .server) @compileError("not implemented");

            const paths = g.bundled_files.keys();
            const files = g.bundled_files.values();

            // This buffer is temporary, holding the quoted source paths, joined with commas.
            var source_map_strings = std.ArrayList(u8).init(arena);
            defer source_map_strings.deinit();

            const buf = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(buf);

            var file_paths = try ArrayListUnmanaged([]const u8).initCapacity(gpa, g.current_chunk_parts.items.len);
            errdefer file_paths.deinit(gpa);
            var contained_maps: bun.MultiArrayList(PackedMap.RefOrEmpty) = .empty;
            try contained_maps.ensureTotalCapacity(gpa, g.current_chunk_parts.items.len);
            errdefer contained_maps.deinit(gpa);

            var overlapping_memory_cost: u32 = 0;

            for (g.current_chunk_parts.items) |file_index| {
                file_paths.appendAssumeCapacity(paths[file_index.get()]);
                const source_map = files[file_index.get()].sourceMap();
                contained_maps.appendAssumeCapacity(source_map.dupeRef());
                if (source_map == .ref) {
                    overlapping_memory_cost += @intCast(source_map.ref.data.memoryCost());
                }
            }

            overlapping_memory_cost += @intCast(contained_maps.memoryCost() + DevServer.memoryCostSlice(file_paths.items));

            out.* = .{
                .ref_count = out.ref_count,
                .paths = file_paths.items,
                .files = contained_maps,
                .overlapping_memory_cost = overlapping_memory_cost,
            };
        }

        fn disconnectAndDeleteFile(g: *@This(), file_index: FileIndex) void {
            bun.assert(g.first_dep.items[file_index.get()] == .none); // must have no dependencies

            // Disconnect all imports
            {
                var it: ?EdgeIndex = g.first_import.items[file_index.get()].unwrap();
                g.first_import.items[file_index.get()] = .none;
                while (it) |edge_index| {
                    const dep = g.edges.items[edge_index.get()];
                    it = dep.next_import.unwrap();
                    assert(dep.dependency == file_index);

                    g.disconnectEdgeFromDependencyList(edge_index);
                    g.freeEdge(edge_index);

                    // TODO: a flag to this function which is queues all
                    // direct importers to rebuild themselves, which will
                    // display the bundling errors.
                }
            }

            const keys = g.bundled_files.keys();

            g.owner().allocator.free(keys[file_index.get()]);
            keys[file_index.get()] = ""; // cannot be `undefined` as it may be read by hashmap logic

            assert_eql(g.first_dep.items[file_index.get()], .none);
            assert_eql(g.first_import.items[file_index.get()], .none);

            // TODO: it is infeasible to swapRemove a file since
            // FrameworkRouter, SerializedFailure, and more structures contains
            // file indices to the server graph.  Instead, `file_index` should
            // go in a free-list for use by new files.
        }

        fn newEdge(g: *@This(), edge: Edge) !EdgeIndex {
            if (g.edges_free_list.pop()) |index| {
                g.edges.items[index.get()] = edge;
                return index;
            }

            const index = EdgeIndex.init(@intCast(g.edges.items.len));
            try g.edges.append(g.owner().allocator, edge);
            return index;
        }

        /// Does nothing besides release the `Edge` for reallocation by `newEdge`
        /// Caller must detach the dependency from the linked list it is in.
        fn freeEdge(g: *@This(), edge_index: EdgeIndex) void {
            igLog("IncrementalGraph(0x{x}, {s}).freeEdge({d})", .{ @intFromPtr(g), @tagName(side), edge_index.get() });
            defer g.checkEdgeRemoval(edge_index);
            if (Environment.isDebug) {
                g.edges.items[edge_index.get()] = undefined;
            }

            if (edge_index.get() == (g.edges.items.len - 1)) {
                g.edges.items.len -= 1;
            } else {
                g.edges_free_list.append(g.owner().allocator, edge_index) catch {
                    // Leak an edge object; Ok since it may get cleaned up by
                    // the next incremental graph garbage-collection cycle.
                };
            }
        }

        /// It is very easy to call `g.freeEdge(idx)` but still keep references
        /// to the idx around, basically causing use-after-free with more steps
        /// and no asan to check it since we are dealing with indices and not
        /// pointers to memory.
        ///
        /// So we'll check it manually by making sure there are no references to
        /// `edge_index` in the graph.
        fn checkEdgeRemoval(g: *@This(), edge_index: EdgeIndex) void {
            // Enable this on any builds with asan enabled so we can catch stuff
            // in CI too
            const enabled = bun.asan.enabled or bun.Environment.ci_assert;
            if (comptime !enabled) return;

            for (g.first_dep.items) |maybe_first_dep| {
                if (maybe_first_dep.unwrap()) |first_dep| {
                    bun.assert_neql(first_dep.get(), edge_index.get());
                }
            }

            for (g.first_import.items) |maybe_first_import| {
                if (maybe_first_import.unwrap()) |first_import| {
                    bun.assert_neql(first_import.get(), edge_index.get());
                }
            }

            for (g.edges.items) |edge| {
                const in_free_list = in_free_list: {
                    for (g.edges_free_list.items) |free_edge_index| {
                        if (free_edge_index.get() == edge_index.get()) {
                            break :in_free_list true;
                        }
                    }
                    break :in_free_list false;
                };

                if (in_free_list) continue;

                bun.assert_neql(edge.prev_dependency.unwrapGet(), edge_index.get());
                bun.assert_neql(edge.next_import.unwrapGet(), edge_index.get());
                bun.assert_neql(edge.next_dependency.unwrapGet(), edge_index.get());
            }
        }

        pub fn owner(g: *@This()) *DevServer {
            return @alignCast(@fieldParentPtr(@tagName(side) ++ "_graph", g));
        }
    };
}

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const assert = bun.assert;
const assert_eql = bun.assert_eql;
const bake = bun.bake;
const DynamicBitSetUnmanaged = bun.bit_set.DynamicBitSetUnmanaged;
const Log = bun.logger.Log;
const VoidFieldTypes = bun.meta.VoidFieldTypes;

const DevServer = bake.DevServer;
const ChunkKind = DevServer.ChunkKind;
const EntryPointList = DevServer.EntryPointList;
const FileKind = DevServer.FileKind;
const GraphTraceState = DevServer.GraphTraceState;
const HotUpdateContext = DevServer.HotUpdateContext;
const PackedMap = DevServer.PackedMap;
const RouteBundle = DevServer.RouteBundle;
const SerializedFailure = DevServer.SerializedFailure;
const SourceMapStore = DevServer.SourceMapStore;
const debug = DevServer.debug;
const igLog = DevServer.igLog;

const FrameworkRouter = bake.FrameworkRouter;
const Route = FrameworkRouter.Route;

const BundleV2 = bun.bundle_v2.BundleV2;
const Chunk = bun.bundle_v2.Chunk;

const SourceMap = bun.sourcemap;
const VLQ = SourceMap.VLQ;

const std = @import("std");
const ArrayListUnmanaged = std.ArrayListUnmanaged;
const AutoArrayHashMapUnmanaged = std.AutoArrayHashMapUnmanaged;
const Allocator = std.mem.Allocator;
