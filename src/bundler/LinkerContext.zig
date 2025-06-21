pub const LinkerContext = struct {
    pub const debug = Output.scoped(.LinkerCtx, false);
    pub const CompileResult = bundler.CompileResult;

    parse_graph: *Graph = undefined,
    graph: LinkerGraph = undefined,
    allocator: std.mem.Allocator = undefined,
    log: *Logger.Log = undefined,

    resolver: *Resolver = undefined,
    cycle_detector: std.ArrayList(ImportTracker) = undefined,

    /// We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    cjs_runtime_ref: Ref = Ref.None,
    esm_runtime_ref: Ref = Ref.None,

    /// We may need to refer to the CommonJS "module" symbol for exports
    unbound_module_ref: Ref = Ref.None,

    options: LinkerOptions = .{},

    wait_group: ThreadPoolLib.WaitGroup = .{},

    ambiguous_result_pool: std.ArrayList(MatchImport) = undefined,

    loop: EventLoop,

    /// string buffer containing pre-formatted unique keys
    unique_key_buf: []u8 = "",

    /// string buffer containing prefix for each unique keys
    unique_key_prefix: string = "",

    source_maps: SourceMapData = .{},

    /// This will eventually be used for reference-counting LinkerContext
    /// to know whether or not we can free it safely.
    pending_task_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    ///
    has_any_css_locals: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    /// Used by Bake to extract []CompileResult before it is joined
    dev_server: ?*bun.bake.DevServer = null,
    framework: ?*const bake.Framework = null,

    mangled_props: MangledProps = .{},

    pub fn pathWithPrettyInitialized(this: *LinkerContext, path: Fs.Path) !Fs.Path {
        return bundler.genericPathWithPrettyInitialized(path, this.options.target, this.resolver.fs.top_level_dir, this.graph.allocator);
    }

    pub const LinkerOptions = struct {
        generate_bytecode_cache: bool = false,
        output_format: options.Format = .esm,
        ignore_dce_annotations: bool = false,
        emit_dce_annotations: bool = true,
        tree_shaking: bool = true,
        minify_whitespace: bool = false,
        minify_syntax: bool = false,
        minify_identifiers: bool = false,
        banner: []const u8 = "",
        footer: []const u8 = "",
        css_chunking: bool = false,
        source_maps: options.SourceMapOption = .none,
        target: options.Target = .browser,

        mode: Mode = .bundle,

        public_path: []const u8 = "",

        pub const Mode = enum {
            passthrough,
            bundle,
        };
    };

    pub const SourceMapData = struct {
        line_offset_wait_group: sync.WaitGroup = .{},
        line_offset_tasks: []Task = &.{},

        quoted_contents_wait_group: sync.WaitGroup = .{},
        quoted_contents_tasks: []Task = &.{},

        pub const Task = struct {
            ctx: *LinkerContext,
            source_index: Index.Int,
            thread_task: ThreadPoolLib.Task = .{ .callback = &runLineOffset },

            pub fn runLineOffset(thread_task: *ThreadPoolLib.Task) void {
                var task: *Task = @fieldParentPtr("thread_task", thread_task);
                defer {
                    task.ctx.markPendingTaskDone();
                    task.ctx.source_maps.line_offset_wait_group.finish();
                }

                const worker = ThreadPool.Worker.get(@fieldParentPtr("linker", task.ctx));
                defer worker.unget();
                SourceMapData.computeLineOffsets(task.ctx, worker.allocator, task.source_index);
            }

            pub fn runQuotedSourceContents(thread_task: *ThreadPoolLib.Task) void {
                var task: *Task = @fieldParentPtr("thread_task", thread_task);
                defer {
                    task.ctx.markPendingTaskDone();
                    task.ctx.source_maps.quoted_contents_wait_group.finish();
                }

                const worker = ThreadPool.Worker.get(@fieldParentPtr("linker", task.ctx));
                defer worker.unget();

                // Use the default allocator when using DevServer and the file
                // was generated. This will be preserved so that remapping
                // stack traces can show the source code, even after incremental
                // rebuilds occur.
                const allocator = if (worker.ctx.transpiler.options.dev_server) |dev|
                    dev.allocator
                else
                    worker.allocator;

                SourceMapData.computeQuotedSourceContents(task.ctx, allocator, task.source_index);
            }
        };

        pub fn computeLineOffsets(this: *LinkerContext, allocator: std.mem.Allocator, source_index: Index.Int) void {
            debug("Computing LineOffsetTable: {d}", .{source_index});
            const line_offset_table: *bun.sourcemap.LineOffsetTable.List = &this.graph.files.items(.line_offset_table)[source_index];

            const source: *const Logger.Source = &this.parse_graph.input_files.items(.source)[source_index];
            const loader: options.Loader = this.parse_graph.input_files.items(.loader)[source_index];

            if (!loader.canHaveSourceMap()) {
                // This is not a file which we support generating source maps for
                line_offset_table.* = .{};
                return;
            }

            const approximate_line_count = this.graph.ast.items(.approximate_newline_count)[source_index];

            line_offset_table.* = bun.sourcemap.LineOffsetTable.generate(
                allocator,
                source.contents,

                // We don't support sourcemaps for source files with more than 2^31 lines
                @as(i32, @intCast(@as(u31, @truncate(approximate_line_count)))),
            );
        }

        pub fn computeQuotedSourceContents(this: *LinkerContext, allocator: std.mem.Allocator, source_index: Index.Int) void {
            debug("Computing Quoted Source Contents: {d}", .{source_index});
            const loader: options.Loader = this.parse_graph.input_files.items(.loader)[source_index];
            const quoted_source_contents: *string = &this.graph.files.items(.quoted_source_contents)[source_index];
            if (!loader.canHaveSourceMap()) {
                quoted_source_contents.* = "";
                return;
            }

            const source: *const Logger.Source = &this.parse_graph.input_files.items(.source)[source_index];
            const mutable = MutableString.initEmpty(allocator);
            quoted_source_contents.* = (js_printer.quoteForJSON(source.contents, mutable, false) catch bun.outOfMemory()).list.items;
        }
    };

    pub fn isExternalDynamicImport(this: *LinkerContext, record: *const ImportRecord, source_index: u32) bool {
        return this.graph.code_splitting and
            record.kind == .dynamic and
            this.graph.files.items(.entry_point_kind)[record.source_index.get()].isEntryPoint() and
            record.source_index.get() != source_index;
    }

    pub fn shouldIncludePart(c: *LinkerContext, source_index: Index.Int, part: Part) bool {
        // As an optimization, ignore parts containing a single import statement to
        // an internal non-wrapped file. These will be ignored anyway and it's a
        // performance hit to spin up a goroutine only to discover this later.
        if (part.stmts.len == 1) {
            if (part.stmts[0].data == .s_import) {
                const record = c.graph.ast.items(.import_records)[source_index].at(part.stmts[0].data.s_import.import_record_index);
                if (record.source_index.isValid() and c.graph.meta.items(.flags)[record.source_index.get()].wrap == .none) {
                    return false;
                }
            }
        }

        return true;
    }

    pub fn load(
        this: *LinkerContext,
        bundle: *BundleV2,
        entry_points: []Index,
        server_component_boundaries: ServerComponentBoundary.List,
        reachable: []Index,
    ) !void {
        const trace = bun.perf.trace("Bundler.CloneLinkerGraph");
        defer trace.end();
        this.parse_graph = &bundle.graph;

        this.graph.code_splitting = bundle.transpiler.options.code_splitting;
        this.log = bundle.transpiler.log;

        this.resolver = &bundle.transpiler.resolver;
        this.cycle_detector = std.ArrayList(ImportTracker).init(this.allocator);

        this.graph.reachable_files = reachable;

        const sources: []const Logger.Source = this.parse_graph.input_files.items(.source);

        try this.graph.load(entry_points, sources, server_component_boundaries, bundle.dynamic_import_entry_points.keys());
        bundle.dynamic_import_entry_points.deinit();
        this.wait_group.init();
        this.ambiguous_result_pool = std.ArrayList(MatchImport).init(this.allocator);

        var runtime_named_exports = &this.graph.ast.items(.named_exports)[Index.runtime.get()];

        this.esm_runtime_ref = runtime_named_exports.get("__esm").?.ref;
        this.cjs_runtime_ref = runtime_named_exports.get("__commonJS").?.ref;

        if (this.options.output_format == .cjs) {
            this.unbound_module_ref = this.graph.generateNewSymbol(Index.runtime.get(), .unbound, "module");
        }

        if (this.options.output_format == .cjs or this.options.output_format == .iife) {
            const exports_kind = this.graph.ast.items(.exports_kind);
            const ast_flags_list = this.graph.ast.items(.flags);
            const meta_flags_list = this.graph.meta.items(.flags);

            for (entry_points) |entry_point| {
                var ast_flags: js_ast.BundledAst.Flags = ast_flags_list[entry_point.get()];

                // Loaders default to CommonJS when they are the entry point and the output
                // format is not ESM-compatible since that avoids generating the ESM-to-CJS
                // machinery.
                if (ast_flags.has_lazy_export) {
                    exports_kind[entry_point.get()] = .cjs;
                }

                // Entry points with ES6 exports must generate an exports object when
                // targeting non-ES6 formats. Note that the IIFE format only needs this
                // when the global name is present, since that's the only way the exports
                // can actually be observed externally.
                if (ast_flags.uses_export_keyword) {
                    ast_flags.uses_exports_ref = true;
                    ast_flags_list[entry_point.get()] = ast_flags;
                    meta_flags_list[entry_point.get()].force_include_exports_for_entry_point = true;
                }
            }
        }
    }

    pub fn computeDataForSourceMap(
        this: *LinkerContext,
        reachable: []const Index.Int,
    ) void {
        bun.assert(this.options.source_maps != .none);
        this.source_maps.line_offset_wait_group.init();
        this.source_maps.quoted_contents_wait_group.init();
        this.source_maps.line_offset_wait_group.counter = @as(u32, @truncate(reachable.len));
        this.source_maps.quoted_contents_wait_group.counter = @as(u32, @truncate(reachable.len));
        this.source_maps.line_offset_tasks = this.allocator.alloc(SourceMapData.Task, reachable.len) catch unreachable;
        this.source_maps.quoted_contents_tasks = this.allocator.alloc(SourceMapData.Task, reachable.len) catch unreachable;

        var batch = ThreadPoolLib.Batch{};
        var second_batch = ThreadPoolLib.Batch{};
        for (reachable, this.source_maps.line_offset_tasks, this.source_maps.quoted_contents_tasks) |source_index, *line_offset, *quoted| {
            line_offset.* = .{
                .ctx = this,
                .source_index = source_index,
                .thread_task = .{ .callback = &SourceMapData.Task.runLineOffset },
            };
            quoted.* = .{
                .ctx = this,
                .source_index = source_index,
                .thread_task = .{ .callback = &SourceMapData.Task.runQuotedSourceContents },
            };
            batch.push(.from(&line_offset.thread_task));
            second_batch.push(.from(&quoted.thread_task));
        }

        // line offsets block sooner and are faster to compute, so we should schedule those first
        batch.push(second_batch);

        this.scheduleTasks(batch);
    }

    pub fn scheduleTasks(this: *LinkerContext, batch: ThreadPoolLib.Batch) void {
        _ = this.pending_task_count.fetchAdd(@as(u32, @truncate(batch.len)), .monotonic);
        this.parse_graph.pool.worker_pool.schedule(batch);
    }

    pub fn markPendingTaskDone(this: *LinkerContext) void {
        _ = this.pending_task_count.fetchSub(1, .monotonic);
    }

    fn processHtmlImportFiles(this: *LinkerContext) void {
        const server_source_indices = &this.parse_graph.html_imports.server_source_indices;
        const html_source_indices = &this.parse_graph.html_imports.html_source_indices;
        if (server_source_indices.len > 0) {
            const input_files: []const Logger.Source = this.parse_graph.input_files.items(.source);
            const map = this.parse_graph.pathToSourceIndexMap(.browser);
            const parts: []const BabyList(js_ast.Part) = this.graph.ast.items(.parts);
            const actual_ref = this.graph.runtimeFunction("__jsonParse");

            for (server_source_indices.slice()) |html_import| {
                const source = &input_files[html_import];
                const source_index = map.get(source.path.hashKey()) orelse {
                    @panic("Assertion failed: HTML import file not found in pathToSourceIndexMap");
                };

                html_source_indices.push(this.graph.allocator, source_index) catch bun.outOfMemory();

                // S.LazyExport is a call to __jsonParse.
                const original_ref = parts[html_import]
                    .at(1)
                    .stmts[0]
                    .data
                    .s_lazy_export
                    .e_call
                    .target
                    .data
                    .e_import_identifier
                    .ref;

                // Make the __jsonParse in that file point to the __jsonParse in the runtime chunk.
                this.graph.symbols.get(original_ref).?.link = actual_ref;

                // When --splitting is enabled, we have to make sure we import the __jsonParse function.
                this.graph.generateSymbolImportAndUse(
                    html_import,
                    Index.part(1).get(),
                    actual_ref,
                    1,
                    Index.runtime,
                ) catch bun.outOfMemory();
            }
        }
    }

    pub noinline fn link(
        this: *LinkerContext,
        bundle: *BundleV2,
        entry_points: []Index,
        server_component_boundaries: ServerComponentBoundary.List,
        reachable: []Index,
    ) ![]Chunk {
        try this.load(
            bundle,
            entry_points,
            server_component_boundaries,
            reachable,
        );

        if (this.options.source_maps != .none) {
            this.computeDataForSourceMap(@as([]Index.Int, @ptrCast(reachable)));
        }

        this.processHtmlImportFiles();

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        try this.scanImportsAndExports();

        // Stop now if there were errors
        if (this.log.hasErrors()) {
            return error.BuildFailed;
        }

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        try this.treeShakingAndCodeSplitting();

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        const chunks = try this.computeChunks(bundle.unique_key);

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        try this.computeCrossChunkDependencies(chunks);

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        this.graph.symbols.followAll();

        return chunks;
    }

    pub fn checkForMemoryCorruption(this: *LinkerContext) void {
        // For this to work, you need mimalloc's debug build enabled.
        //    make mimalloc-debug
        this.parse_graph.heap.helpCatchMemoryIssues();
    }

    pub const computeChunks = @import("linker_context/computeChunks.zig").computeChunks;

    pub const findAllImportedPartsInJSOrder = @import("linker_context/findAllImportedPartsInJSOrder.zig").findAllImportedPartsInJSOrder;
    pub const findImportedPartsInJSOrder = @import("linker_context/findAllImportedPartsInJSOrder.zig").findImportedPartsInJSOrder;
    pub const findImportedFilesInCSSOrder = @import("linker_context/findImportedFilesInCSSOrder.zig").findImportedFilesInCSSOrder;
    pub const findImportedCSSFilesInJSOrder = @import("linker_context/findImportedCSSFilesInJSOrder.zig").findImportedCSSFilesInJSOrder;

    pub fn generateNamedExportInFile(this: *LinkerContext, source_index: Index.Int, module_ref: Ref, name: []const u8, alias: []const u8) !struct { Ref, u32 } {
        const ref = this.graph.generateNewSymbol(source_index, .other, name);
        const part_index = this.graph.addPartToFile(source_index, .{
            .declared_symbols = js_ast.DeclaredSymbol.List.fromSlice(
                this.allocator,
                &[_]js_ast.DeclaredSymbol{
                    .{ .ref = ref, .is_top_level = true },
                },
            ) catch unreachable,
            .can_be_removed_if_unused = true,
        }) catch unreachable;

        try this.graph.generateSymbolImportAndUse(source_index, part_index, module_ref, 1, Index.init(source_index));
        var top_level = &this.graph.meta.items(.top_level_symbol_to_parts_overlay)[source_index];
        var parts_list = this.allocator.alloc(u32, 1) catch unreachable;
        parts_list[0] = part_index;

        top_level.put(this.allocator, ref, BabyList(u32).init(parts_list)) catch unreachable;

        var resolved_exports = &this.graph.meta.items(.resolved_exports)[source_index];
        resolved_exports.put(this.allocator, alias, ExportData{
            .data = ImportTracker{
                .source_index = Index.init(source_index),
                .import_ref = ref,
            },
        }) catch unreachable;
        return .{ ref, part_index };
    }

    pub const generateCodeForLazyExport = @import("linker_context/generateCodeForLazyExport.zig").generateCodeForLazyExport;
    pub const scanImportsAndExports = @import("linker_context/scanImportsAndExports.zig").scanImportsAndExports;
    pub const doStep5 = @import("linker_context/doStep5.zig").doStep5;
    pub const createExportsForFile = @import("linker_context/doStep5.zig").createExportsForFile;

    pub fn scanCSSImports(
        this: *LinkerContext,
        file_source_index: u32,
        file_import_records: []ImportRecord,
        // slices from Graph
        css_asts: []const ?*bun.css.BundlerStyleSheet,
        sources: []const Logger.Source,
        loaders: []const Loader,
        log: *Logger.Log,
    ) enum { ok, errors } {
        for (file_import_records) |*record| {
            if (record.source_index.isValid()) {
                // Other file is not CSS
                if (css_asts[record.source_index.get()] == null) {
                    const source = &sources[file_source_index];
                    const loader = loaders[record.source_index.get()];

                    switch (loader) {
                        .jsx, .js, .ts, .tsx, .napi, .sqlite, .json, .jsonc, .html, .sqlite_embedded => {
                            log.addErrorFmt(
                                source,
                                record.range.loc,
                                this.allocator,
                                "Cannot import a \".{s}\" file into a CSS file",
                                .{@tagName(loader)},
                            ) catch bun.outOfMemory();
                        },
                        .css, .file, .toml, .wasm, .base64, .dataurl, .text, .bunsh => {},
                    }
                }
            }
        }
        return if (log.errors > 0) .errors else .ok;
    }

    const MatchImport = struct {
        alias: string = "",
        kind: MatchImport.Kind = MatchImport.Kind.ignore,
        namespace_ref: Ref = Ref.None,
        source_index: u32 = 0,
        name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with sourceIndex, ignore if zero,
        other_source_index: u32 = 0,
        other_name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with otherSourceIndex, ignore if zero,
        ref: Ref = Ref.None,

        pub const Kind = enum {
            /// The import is either external or undefined
            ignore,

            /// "sourceIndex" and "ref" are in use
            normal,

            /// "namespaceRef" and "alias" are in use
            namespace,

            /// Both "normal" and "namespace"
            normal_and_namespace,

            /// The import could not be evaluated due to a cycle
            cycle,

            /// The import is missing but came from a TypeScript file
            probably_typescript_type,

            /// The import resolved to multiple symbols via "export * from"
            ambiguous,
        };
    };

    pub fn getSource(c: *LinkerContext, index: usize) *const Logger.Source {
        return &c.parse_graph.input_files.items(.source)[index];
    }

    pub fn treeShakingAndCodeSplitting(c: *LinkerContext) !void {
        const trace = bun.perf.trace("Bundler.treeShakingAndCodeSplitting");
        defer trace.end();

        const parts = c.graph.ast.items(.parts);
        const import_records = c.graph.ast.items(.import_records);
        const css_reprs = c.graph.ast.items(.css);
        const side_effects = c.parse_graph.input_files.items(.side_effects);
        const entry_point_kinds = c.graph.files.items(.entry_point_kind);
        const entry_points = c.graph.entry_points.items(.source_index);
        const distances = c.graph.files.items(.distance_from_entry_point);

        {
            const trace2 = bun.perf.trace("Bundler.markFileLiveForTreeShaking");
            defer trace2.end();

            // Tree shaking: Each entry point marks all files reachable from itself
            for (entry_points) |entry_point| {
                c.markFileLiveForTreeShaking(
                    entry_point,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                    css_reprs,
                );
            }
        }

        {
            const trace2 = bun.perf.trace("Bundler.markFileReachableForCodeSplitting");
            defer trace2.end();

            const file_entry_bits: []AutoBitSet = c.graph.files.items(.entry_bits);
            // AutoBitSet needs to be initialized if it is dynamic
            if (AutoBitSet.needsDynamic(entry_points.len)) {
                for (file_entry_bits) |*bits| {
                    bits.* = try AutoBitSet.initEmpty(c.allocator, entry_points.len);
                }
            } else if (file_entry_bits.len > 0) {
                // assert that the tag is correct
                bun.assert(file_entry_bits[0] == .static);
            }

            // Code splitting: Determine which entry points can reach which files. This
            // has to happen after tree shaking because there is an implicit dependency
            // between live parts within the same file. All liveness has to be computed
            // first before determining which entry points can reach which files.
            for (entry_points, 0..) |entry_point, i| {
                c.markFileReachableForCodeSplitting(
                    entry_point,
                    i,
                    distances,
                    0,
                    parts,
                    import_records,
                    file_entry_bits,
                    css_reprs,
                );
            }
        }
    }

    pub const ChunkMeta = struct {
        imports: Map,
        exports: Map,
        dynamic_imports: std.AutoArrayHashMap(Index.Int, void),

        pub const Map = std.AutoArrayHashMap(Ref, void);
    };

    pub const computeCrossChunkDependencies = @import("linker_context/computeCrossChunkDependencies.zig").computeCrossChunkDependencies;

    pub const GenerateChunkCtx = struct {
        wg: *sync.WaitGroup,
        c: *LinkerContext,
        chunks: []Chunk,
        chunk: *Chunk,
    };

    pub const postProcessJSChunk = @import("linker_context/postProcessJSChunk.zig").postProcessJSChunk;
    pub const postProcessCSSChunk = @import("linker_context/postProcessCSSChunk.zig").postProcessCSSChunk;
    pub const postProcessHTMLChunk = @import("linker_context/postProcessHTMLChunk.zig").postProcessHTMLChunk;
    pub fn generateChunk(ctx: GenerateChunkCtx, chunk: *Chunk, chunk_index: usize) void {
        defer ctx.wg.finish();
        const worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
        defer worker.unget();
        switch (chunk.content) {
            .javascript => postProcessJSChunk(ctx, worker, chunk, chunk_index) catch |err| Output.panic("TODO: handle error: {s}", .{@errorName(err)}),
            .css => postProcessCSSChunk(ctx, worker, chunk) catch |err| Output.panic("TODO: handle error: {s}", .{@errorName(err)}),
            .html => postProcessHTMLChunk(ctx, worker, chunk) catch |err| Output.panic("TODO: handle error: {s}", .{@errorName(err)}),
        }
    }

    pub const renameSymbolsInChunk = @import("linker_context/renameSymbolsInChunk.zig").renameSymbolsInChunk;

    pub fn generateJSRenamer(ctx: GenerateChunkCtx, chunk: *Chunk, chunk_index: usize) void {
        defer ctx.wg.finish();
        var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
        defer worker.unget();
        switch (chunk.content) {
            .javascript => generateJSRenamer_(ctx, worker, chunk, chunk_index),
            .css => {},
            .html => {},
        }
    }

    fn generateJSRenamer_(ctx: GenerateChunkCtx, worker: *ThreadPool.Worker, chunk: *Chunk, chunk_index: usize) void {
        _ = chunk_index;
        chunk.renamer = ctx.c.renameSymbolsInChunk(
            worker.allocator,
            chunk,
            chunk.content.javascript.files_in_chunk_order,
        ) catch @panic("TODO: handle error");
    }

    pub const generateChunksInParallel = @import("linker_context/generateChunksInParallel.zig").generateChunksInParallel;
    pub const generateCompileResultForJSChunk = @import("linker_context/generateCompileResultForJSChunk.zig").generateCompileResultForJSChunk;
    pub const generateCompileResultForCssChunk = @import("linker_context/generateCompileResultForCssChunk.zig").generateCompileResultForCssChunk;
    pub const generateCompileResultForHtmlChunk = @import("linker_context/generateCompileResultForHtmlChunk.zig").generateCompileResultForHtmlChunk;

    pub const prepareCssAstsForChunk = @import("linker_context/prepareCssAstsForChunk.zig").prepareCssAstsForChunk;
    pub const PrepareCssAstTask = @import("linker_context/prepareCssAstsForChunk.zig").PrepareCssAstTask;

    pub fn generateSourceMapForChunk(
        c: *LinkerContext,
        isolated_hash: u64,
        worker: *ThreadPool.Worker,
        results: std.MultiArrayList(CompileResultForSourceMap),
        chunk_abs_dir: string,
        can_have_shifts: bool,
    ) !sourcemap.SourceMapPieces {
        const trace = bun.perf.trace("Bundler.generateSourceMapForChunk");
        defer trace.end();

        var j = StringJoiner{ .allocator = worker.allocator };

        const sources = c.parse_graph.input_files.items(.source);
        const quoted_source_map_contents = c.graph.files.items(.quoted_source_contents);

        // Entries in `results` do not 1:1 map to source files, the mapping
        // is actually many to one, where a source file can have multiple chunks
        // in the sourcemap.
        //
        // This hashmap is going to map:
        //    `source_index` (per compilation) in a chunk
        //   -->
        //    Which source index in the generated sourcemap, referred to
        //    as the "mapping source index" within this function to be distinct.
        var source_id_map = std.AutoArrayHashMap(u32, i32).init(worker.allocator);
        defer source_id_map.deinit();

        const source_indices = results.items(.source_index);

        j.pushStatic(
            \\{
            \\  "version": 3,
            \\  "sources": [
        );
        if (source_indices.len > 0) {
            {
                const index = source_indices[0];
                var path = sources[index].path;
                try source_id_map.putNoClobber(index, 0);

                if (path.isFile()) {
                    const rel_path = try std.fs.path.relative(worker.allocator, chunk_abs_dir, path.text);
                    path.pretty = rel_path;
                }

                var quote_buf = try MutableString.init(worker.allocator, path.pretty.len + 2);
                quote_buf = try js_printer.quoteForJSON(path.pretty, quote_buf, false);
                j.pushStatic(quote_buf.list.items); // freed by arena
            }

            var next_mapping_source_index: i32 = 1;
            for (source_indices[1..]) |index| {
                const gop = try source_id_map.getOrPut(index);
                if (gop.found_existing) continue;

                gop.value_ptr.* = next_mapping_source_index;
                next_mapping_source_index += 1;

                var path = sources[index].path;

                if (path.isFile()) {
                    const rel_path = try std.fs.path.relative(worker.allocator, chunk_abs_dir, path.text);
                    path.pretty = rel_path;
                }

                var quote_buf = try MutableString.init(worker.allocator, path.pretty.len + ", ".len + 2);
                quote_buf.appendAssumeCapacity(", ");
                quote_buf = try js_printer.quoteForJSON(path.pretty, quote_buf, false);
                j.pushStatic(quote_buf.list.items); // freed by arena
            }
        }

        j.pushStatic(
            \\],
            \\  "sourcesContent": [
        );

        const source_indices_for_contents = source_id_map.keys();
        if (source_indices_for_contents.len > 0) {
            j.pushStatic("\n    ");
            j.pushStatic(quoted_source_map_contents[source_indices_for_contents[0]]);

            for (source_indices_for_contents[1..]) |index| {
                j.pushStatic(",\n    ");
                j.pushStatic(quoted_source_map_contents[index]);
            }
        }
        j.pushStatic(
            \\
            \\  ],
            \\  "mappings": "
        );

        const mapping_start = j.len;
        var prev_end_state = sourcemap.SourceMapState{};
        var prev_column_offset: i32 = 0;
        const source_map_chunks = results.items(.source_map_chunk);
        const offsets = results.items(.generated_offset);
        for (source_map_chunks, offsets, source_indices) |chunk, offset, current_source_index| {
            const mapping_source_index = source_id_map.get(current_source_index) orelse
                unreachable; // the pass above during printing of "sources" must add the index

            var start_state = sourcemap.SourceMapState{
                .source_index = mapping_source_index,
                .generated_line = offset.lines,
                .generated_column = offset.columns,
            };

            if (offset.lines == 0) {
                start_state.generated_column += prev_column_offset;
            }

            try sourcemap.appendSourceMapChunk(&j, worker.allocator, prev_end_state, start_state, chunk.buffer.list.items);

            prev_end_state = chunk.end_state;
            prev_end_state.source_index = mapping_source_index;
            prev_column_offset = chunk.final_generated_column;

            if (prev_end_state.generated_line == 0) {
                prev_end_state.generated_column += start_state.generated_column;
                prev_column_offset += start_state.generated_column;
            }
        }
        const mapping_end = j.len;

        if (comptime FeatureFlags.source_map_debug_id) {
            j.pushStatic("\",\n  \"debugId\": \"");
            j.push(
                try std.fmt.allocPrint(worker.allocator, "{}", .{bun.sourcemap.DebugIDFormatter{ .id = isolated_hash }}),
                worker.allocator,
            );
            j.pushStatic("\",\n  \"names\": []\n}");
        } else {
            j.pushStatic("\",\n  \"names\": []\n}");
        }

        const done = try j.done(worker.allocator);
        bun.assert(done[0] == '{');

        var pieces = sourcemap.SourceMapPieces.init(worker.allocator);
        if (can_have_shifts) {
            try pieces.prefix.appendSlice(done[0..mapping_start]);
            try pieces.mappings.appendSlice(done[mapping_start..mapping_end]);
            try pieces.suffix.appendSlice(done[mapping_end..]);
        } else {
            try pieces.prefix.appendSlice(done);
        }

        return pieces;
    }

    pub fn generateIsolatedHash(c: *LinkerContext, chunk: *const Chunk) u64 {
        const trace = bun.perf.trace("Bundler.generateIsolatedHash");
        defer trace.end();

        var hasher = ContentHasher{};

        // Mix the file names and part ranges of all of the files in this chunk into
        // the hash. Objects that appear identical but that live in separate files or
        // that live in separate parts in the same file must not be merged. This only
        // needs to be done for JavaScript files, not CSS files.
        if (chunk.content == .javascript) {
            const sources = c.parse_graph.input_files.items(.source);
            for (chunk.content.javascript.parts_in_chunk_in_order) |part_range| {
                const source: *Logger.Source = &sources[part_range.source_index.get()];

                const file_path = brk: {
                    if (source.path.isFile()) {
                        // Use the pretty path as the file name since it should be platform-
                        // independent (relative paths and the "/" path separator)
                        if (source.path.text.ptr == source.path.pretty.ptr) {
                            source.path = c.pathWithPrettyInitialized(source.path) catch bun.outOfMemory();
                        }
                        source.path.assertPrettyIsValid();

                        break :brk source.path.pretty;
                    } else {
                        // If this isn't in the "file" namespace, just use the full path text
                        // verbatim. This could be a source of cross-platform differences if
                        // plugins are storing platform-specific information in here, but then
                        // that problem isn't caused by esbuild itself.
                        break :brk source.path.text;
                    }
                };

                // Include the path namespace in the hash
                hasher.write(source.path.namespace);

                // Then include the file path
                hasher.write(file_path);

                // Then include the part range
                hasher.writeInts(&[_]u32{
                    part_range.part_index_begin,
                    part_range.part_index_end,
                });
            }
        }

        // Hash the output path template as part of the content hash because we want
        // any import to be considered different if the import's output path has changed.
        hasher.write(chunk.template.data);

        const public_path = if (chunk.is_browser_chunk_from_server_build)
            @as(*bundler.BundleV2, @fieldParentPtr("linker", c)).transpilerForTarget(.browser).options.public_path
        else
            c.options.public_path;

        // Also hash the public path. If provided, this is used whenever files
        // reference each other such as cross-chunk imports, asset file references,
        // and source map comments. We always include the hash in all chunks instead
        // of trying to figure out which chunks will include the public path for
        // simplicity and for robustness to code changes in the future.
        if (public_path.len > 0) {
            hasher.write(public_path);
        }

        // Include the generated output content in the hash. This excludes the
        // randomly-generated import paths (the unique keys) and only includes the
        // data in the spans between them.
        if (chunk.intermediate_output == .pieces) {
            for (chunk.intermediate_output.pieces.slice()) |piece| {
                hasher.write(piece.data());
            }
        } else {
            var el = chunk.intermediate_output.joiner.head;
            while (el) |e| : (el = e.next) {
                hasher.write(e.slice);
            }
        }

        // Also include the source map data in the hash. The source map is named the
        // same name as the chunk name for ease of discovery. So we want the hash to
        // change if the source map data changes even if the chunk data doesn't change.
        // Otherwise the output path for the source map wouldn't change and the source
        // map wouldn't end up being updated.
        //
        // Note that this means the contents of all input files are included in the
        // hash because of "sourcesContent", so changing a comment in an input file
        // can now change the hash of the output file. This only happens when you
        // have source maps enabled (and "sourcesContent", which is on by default).
        //
        // The generated positions in the mappings here are in the output content
        // *before* the final paths have been substituted. This may seem weird.
        // However, I think this shouldn't cause issues because a) the unique key
        // values are all always the same length so the offsets are deterministic
        // and b) the final paths will be folded into the final hash later.
        hasher.write(chunk.output_source_map.prefix.items);
        hasher.write(chunk.output_source_map.mappings.items);
        hasher.write(chunk.output_source_map.suffix.items);

        return hasher.digest();
    }

    pub fn validateTLA(
        c: *LinkerContext,
        source_index: Index.Int,
        tla_keywords: []const Logger.Range,
        tla_checks: []js_ast.TlaCheck,
        input_files: []const Logger.Source,
        import_records: []const ImportRecord,
        meta_flags: []JSMeta.Flags,
        ast_import_records: []const bun.BabyList(ImportRecord),
    ) bun.OOM!js_ast.TlaCheck {
        var result_tla_check: *js_ast.TlaCheck = &tla_checks[source_index];

        if (result_tla_check.depth == 0) {
            result_tla_check.depth = 1;
            if (tla_keywords[source_index].len > 0) {
                result_tla_check.parent = source_index;
            }

            for (import_records, 0..) |record, import_record_index| {
                if (Index.isValid(record.source_index) and (record.kind == .require or record.kind == .stmt)) {
                    const parent = try c.validateTLA(
                        record.source_index.get(),
                        tla_keywords,
                        tla_checks,
                        input_files,
                        ast_import_records[record.source_index.get()].slice(),
                        meta_flags,
                        ast_import_records,
                    );
                    if (Index.isInvalid(Index.init(parent.parent))) {
                        continue;
                    }

                    // Follow any import chains
                    if (record.kind == .stmt and (Index.isInvalid(Index.init(result_tla_check.parent)) or parent.depth < result_tla_check.depth)) {
                        result_tla_check.depth = parent.depth + 1;
                        result_tla_check.parent = record.source_index.get();
                        result_tla_check.import_record_index = @intCast(import_record_index);
                        continue;
                    }

                    // Require of a top-level await chain is forbidden
                    if (record.kind == .require) {
                        var notes = std.ArrayList(Logger.Data).init(c.allocator);

                        var tla_pretty_path: string = "";
                        var other_source_index = record.source_index.get();

                        // Build up a chain of notes for all of the imports
                        while (true) {
                            const parent_result_tla_keyword = tla_keywords[other_source_index];
                            const parent_tla_check = tla_checks[other_source_index];
                            const parent_source_index = other_source_index;

                            if (parent_result_tla_keyword.len > 0) {
                                const source = &input_files[other_source_index];
                                tla_pretty_path = source.path.pretty;
                                notes.append(Logger.Data{
                                    .text = std.fmt.allocPrint(c.allocator, "The top-level await in {s} is here:", .{tla_pretty_path}) catch bun.outOfMemory(),
                                    .location = .initOrNull(source, parent_result_tla_keyword),
                                }) catch bun.outOfMemory();
                                break;
                            }

                            if (!Index.isValid(Index.init(parent_tla_check.parent))) {
                                try notes.append(Logger.Data{
                                    .text = "unexpected invalid index",
                                });
                                break;
                            }

                            other_source_index = parent_tla_check.parent;

                            try notes.append(Logger.Data{
                                .text = try std.fmt.allocPrint(c.allocator, "The file {s} imports the file {s} here:", .{
                                    input_files[parent_source_index].path.pretty,
                                    input_files[other_source_index].path.pretty,
                                }),
                                .location = .initOrNull(&input_files[parent_source_index], ast_import_records[parent_source_index].slice()[tla_checks[parent_source_index].import_record_index].range),
                            });
                        }

                        const source: *const Logger.Source = &input_files[source_index];
                        const imported_pretty_path = source.path.pretty;
                        const text: string = if (strings.eql(imported_pretty_path, tla_pretty_path))
                            try std.fmt.allocPrint(c.allocator, "This require call is not allowed because the imported file \"{s}\" contains a top-level await", .{imported_pretty_path})
                        else
                            try std.fmt.allocPrint(c.allocator, "This require call is not allowed because the transitive dependency \"{s}\" contains a top-level await", .{tla_pretty_path});

                        try c.log.addRangeErrorWithNotes(source, record.range, text, notes.items);
                    }
                }
            }

            // Make sure that if we wrap this module in a closure, the closure is also
            // async. This happens when you call "import()" on this module and code
            // splitting is off.
            if (Index.isValid(Index.init(result_tla_check.parent))) {
                meta_flags[source_index].is_async_or_has_async_dependency = true;
            }
        }

        return result_tla_check.*;
    }

    pub const StmtList = struct {
        inside_wrapper_prefix: std.ArrayList(Stmt),
        outside_wrapper_prefix: std.ArrayList(Stmt),
        inside_wrapper_suffix: std.ArrayList(Stmt),

        all_stmts: std.ArrayList(Stmt),

        pub fn reset(this: *StmtList) void {
            this.inside_wrapper_prefix.clearRetainingCapacity();
            this.outside_wrapper_prefix.clearRetainingCapacity();
            this.inside_wrapper_suffix.clearRetainingCapacity();
            this.all_stmts.clearRetainingCapacity();
        }

        pub fn deinit(this: *StmtList) void {
            this.inside_wrapper_prefix.deinit();
            this.outside_wrapper_prefix.deinit();
            this.inside_wrapper_suffix.deinit();
            this.all_stmts.deinit();
        }

        pub fn init(allocator: std.mem.Allocator) StmtList {
            return .{
                .inside_wrapper_prefix = std.ArrayList(Stmt).init(allocator),
                .outside_wrapper_prefix = std.ArrayList(Stmt).init(allocator),
                .inside_wrapper_suffix = std.ArrayList(Stmt).init(allocator),
                .all_stmts = std.ArrayList(Stmt).init(allocator),
            };
        }
    };

    pub fn shouldRemoveImportExportStmt(
        c: *LinkerContext,
        stmts: *StmtList,
        loc: Logger.Loc,
        namespace_ref: Ref,
        import_record_index: u32,
        allocator: std.mem.Allocator,
        ast: *const JSAst,
    ) !bool {
        const record = ast.import_records.at(import_record_index);
        // Is this an external import?
        if (!record.source_index.isValid()) {
            // Keep the "import" statement if import statements are supported
            if (c.options.output_format.keepES6ImportExportSyntax()) {
                return false;
            }

            // Otherwise, replace this statement with a call to "require()"
            stmts.inside_wrapper_prefix.append(
                Stmt.alloc(
                    S.Local,
                    S.Local{
                        .decls = G.Decl.List.fromSlice(
                            allocator,
                            &.{
                                .{
                                    .binding = Binding.alloc(
                                        allocator,
                                        B.Identifier{
                                            .ref = namespace_ref,
                                        },
                                        loc,
                                    ),
                                    .value = Expr.init(
                                        E.RequireString,
                                        E.RequireString{
                                            .import_record_index = import_record_index,
                                        },
                                        loc,
                                    ),
                                },
                            },
                        ) catch unreachable,
                    },
                    record.range.loc,
                ),
            ) catch unreachable;
            return true;
        }

        // We don't need a call to "require()" if this is a self-import inside a
        // CommonJS-style module, since we can just reference the exports directly.
        if (ast.exports_kind == .cjs and c.graph.symbols.follow(namespace_ref).eql(ast.exports_ref)) {
            return true;
        }

        const other_flags = c.graph.meta.items(.flags)[record.source_index.get()];
        switch (other_flags.wrap) {
            .none => {},
            .cjs => {
                // Replace the statement with a call to "require()" if this module is not wrapped
                try stmts.inside_wrapper_prefix.append(
                    Stmt.alloc(S.Local, .{
                        .decls = try G.Decl.List.fromSlice(
                            allocator,
                            &.{
                                .{
                                    .binding = Binding.alloc(allocator, B.Identifier{
                                        .ref = namespace_ref,
                                    }, loc),
                                    .value = Expr.init(E.RequireString, .{
                                        .import_record_index = import_record_index,
                                    }, loc),
                                },
                            },
                        ),
                    }, loc),
                );
            },
            .esm => {
                // Ignore this file if it's not included in the bundle. This can happen for
                // wrapped ESM files but not for wrapped CommonJS files because we allow
                // tree shaking inside wrapped ESM files.
                if (!c.graph.files_live.isSet(record.source_index.get())) {
                    return true;
                }

                const wrapper_ref = c.graph.ast.items(.wrapper_ref)[record.source_index.get()];
                if (wrapper_ref.isEmpty()) {
                    return true;
                }

                // Replace the statement with a call to "init()"
                const value: Expr = brk: {
                    const default = Expr.init(E.Call, .{
                        .target = Expr.initIdentifier(
                            wrapper_ref,
                            loc,
                        ),
                    }, loc);

                    if (other_flags.is_async_or_has_async_dependency) {
                        // This currently evaluates sibling dependencies in serial instead of in
                        // parallel, which is incorrect. This should be changed to store a promise
                        // and await all stored promises after all imports but before any code.
                        break :brk Expr.init(E.Await, .{
                            .value = default,
                        }, loc);
                    }

                    break :brk default;
                };

                try stmts.inside_wrapper_prefix.append(
                    Stmt.alloc(S.SExpr, .{
                        .value = value,
                    }, loc),
                );
            },
        }

        return true;
    }

    pub const convertStmtsForChunk = @import("linker_context/convertStmtsForChunk.zig").convertStmtsForChunk;
    pub const convertStmtsForChunkForDevServer = @import("linker_context/convertStmtsForChunkForDevServer.zig").convertStmtsForChunkForDevServer;

    pub fn runtimeFunction(c: *LinkerContext, name: []const u8) Ref {
        return c.graph.runtimeFunction(name);
    }

    pub const generateCodeForFileInChunkJS = @import("linker_context/generateCodeForFileInChunkJS.zig").generateCodeForFileInChunkJS;

    pub fn printCodeForFileInChunkJS(
        c: *LinkerContext,
        r: renamer.Renamer,
        allocator: std.mem.Allocator,
        writer: *js_printer.BufferWriter,
        out_stmts: []Stmt,
        ast: *const js_ast.BundledAst,
        flags: JSMeta.Flags,
        to_esm_ref: Ref,
        to_commonjs_ref: Ref,
        runtime_require_ref: ?Ref,
        source_index: Index,
        source: *const bun.logger.Source,
    ) js_printer.PrintResult {
        const parts_to_print = &[_]Part{
            .{ .stmts = out_stmts },
        };

        const print_options = js_printer.Options{
            .bundling = true,
            // TODO: IIFE
            .indent = .{},
            .commonjs_named_exports = ast.commonjs_named_exports,
            .commonjs_named_exports_ref = ast.exports_ref,
            .commonjs_module_ref = if (ast.flags.uses_module_ref)
                ast.module_ref
            else
                Ref.None,
            .commonjs_named_exports_deoptimized = flags.wrap == .cjs,
            .commonjs_module_exports_assigned_deoptimized = ast.flags.commonjs_module_exports_assigned_deoptimized,
            // .const_values = c.graph.const_values,
            .ts_enums = c.graph.ts_enums,

            .minify_whitespace = c.options.minify_whitespace,
            .minify_syntax = c.options.minify_syntax,
            .module_type = c.options.output_format,
            .print_dce_annotations = c.options.emit_dce_annotations,
            .has_run_symbol_renamer = true,

            .allocator = allocator,
            .source_map_allocator = if (c.dev_server != null and
                c.parse_graph.input_files.items(.loader)[source_index.get()].isJavaScriptLike())
                // The loader check avoids globally allocating asset source maps
                writer.buffer.allocator
            else
                allocator,
            .to_esm_ref = to_esm_ref,
            .to_commonjs_ref = to_commonjs_ref,
            .require_ref = switch (c.options.output_format) {
                .cjs => null, // use unbounded global
                else => runtime_require_ref,
            },
            .require_or_import_meta_for_source_callback = .init(
                LinkerContext,
                requireOrImportMetaForSource,
                c,
            ),
            .line_offset_tables = c.graph.files.items(.line_offset_table)[source_index.get()],
            .target = c.options.target,

            .hmr_ref = if (c.options.output_format == .internal_bake_dev)
                ast.wrapper_ref
            else
                .None,

            .input_files_for_dev_server = if (c.options.output_format == .internal_bake_dev)
                c.parse_graph.input_files.items(.source)
            else
                null,
            .mangled_props = &c.mangled_props,
        };

        writer.buffer.reset();
        var printer = js_printer.BufferPrinter.init(writer.*);
        defer writer.* = printer.ctx;

        switch (c.options.source_maps != .none and !source_index.isRuntime()) {
            inline else => |enable_source_maps| {
                return js_printer.printWithWriter(
                    *js_printer.BufferPrinter,
                    &printer,
                    ast.target,
                    ast.toAST(),
                    source,
                    print_options,
                    ast.import_records.slice(),
                    parts_to_print,
                    r,
                    enable_source_maps,
                );
            },
        }
    }

    pub const PendingPartRange = struct {
        part_range: PartRange,
        task: ThreadPoolLib.Task,
        ctx: *GenerateChunkCtx,
        i: u32 = 0,
    };

    pub fn requireOrImportMetaForSource(
        c: *LinkerContext,
        source_index: Index.Int,
        was_unwrapped_require: bool,
    ) js_printer.RequireOrImportMeta {
        const flags = c.graph.meta.items(.flags)[source_index];
        return .{
            .exports_ref = if (flags.wrap == .esm or (was_unwrapped_require and c.graph.ast.items(.flags)[source_index].force_cjs_to_esm))
                c.graph.ast.items(.exports_ref)[source_index]
            else
                Ref.None,
            .is_wrapper_async = flags.is_async_or_has_async_dependency,
            .wrapper_ref = c.graph.ast.items(.wrapper_ref)[source_index],

            .was_unwrapped_require = was_unwrapped_require and c.graph.ast.items(.flags)[source_index].force_cjs_to_esm,
        };
    }

    const SubstituteChunkFinalPathResult = struct {
        j: StringJoiner,
        shifts: []sourcemap.SourceMapShifts,
    };

    pub fn mangleLocalCss(c: *LinkerContext) void {
        if (c.has_any_css_locals.load(.monotonic) == 0) return;

        const all_css_asts: []?*bun.css.BundlerStyleSheet = c.graph.ast.items(.css);
        const all_symbols: []Symbol.List = c.graph.ast.items(.symbols);
        const all_sources: []Logger.Source = c.parse_graph.input_files.items(.source);

        // Collect all local css names
        var sfb = std.heap.stackFallback(512, c.allocator);
        const allocator = sfb.get();
        var local_css_names = std.AutoHashMap(bun.bundle_v2.Ref, void).init(allocator);
        defer local_css_names.deinit();

        for (all_css_asts, 0..) |maybe_css_ast, source_index| {
            if (maybe_css_ast) |css_ast| {
                if (css_ast.local_scope.count() == 0) continue;
                const symbols = all_symbols[source_index];
                for (symbols.sliceConst(), 0..) |*symbol_, inner_index| {
                    var symbol = symbol_;
                    if (symbol.kind == .local_css) {
                        const ref = ref: {
                            var ref = Ref.init(@intCast(inner_index), @intCast(source_index), false);
                            ref.tag = .symbol;
                            while (symbol.hasLink()) {
                                ref = symbol.link;
                                symbol = all_symbols[ref.source_index].at(ref.inner_index);
                            }
                            break :ref ref;
                        };

                        const entry = local_css_names.getOrPut(ref) catch bun.outOfMemory();
                        if (entry.found_existing) continue;

                        const source = all_sources[ref.source_index];

                        const original_name = symbol.original_name;
                        const path_hash = bun.css.css_modules.hash(
                            allocator,
                            "{s}",
                            // use path relative to cwd for determinism
                            .{source.path.pretty},
                            false,
                        );

                        const final_generated_name = std.fmt.allocPrint(c.graph.allocator, "{s}_{s}", .{ original_name, path_hash }) catch bun.outOfMemory();
                        c.mangled_props.put(c.allocator, ref, final_generated_name) catch bun.outOfMemory();
                    }
                }
            }
        }
    }

    pub fn appendIsolatedHashesForImportedChunks(
        c: *LinkerContext,
        hash: *ContentHasher,
        chunks: []Chunk,
        index: u32,
        chunk_visit_map: *AutoBitSet,
    ) void {
        // Only visit each chunk at most once. This is important because there may be
        // cycles in the chunk import graph. If there's a cycle, we want to include
        // the hash of every chunk involved in the cycle (along with all of their
        // dependencies). This depth-first traversal will naturally do that.
        if (chunk_visit_map.isSet(index)) {
            return;
        }
        chunk_visit_map.set(index);

        // Visit the other chunks that this chunk imports before visiting this chunk
        const chunk = &chunks[index];
        for (chunk.cross_chunk_imports.slice()) |import| {
            c.appendIsolatedHashesForImportedChunks(
                hash,
                chunks,
                import.chunk_index,
                chunk_visit_map,
            );
        }

        // Mix in hashes for referenced asset paths (i.e. the "file" loader)
        switch (chunk.intermediate_output) {
            .pieces => |pieces| for (pieces.slice()) |piece| {
                if (piece.query.kind == .asset) {
                    var from_chunk_dir = std.fs.path.dirnamePosix(chunk.final_rel_path) orelse "";
                    if (strings.eqlComptime(from_chunk_dir, "."))
                        from_chunk_dir = "";

                    const source_index = piece.query.index;
                    const additional_files: []AdditionalFile = c.parse_graph.input_files.items(.additional_files)[source_index].slice();
                    bun.assert(additional_files.len > 0);
                    switch (additional_files[0]) {
                        .output_file => |output_file_id| {
                            const path = c.parse_graph.additional_output_files.items[output_file_id].dest_path;
                            hash.write(bun.path.relativePlatform(from_chunk_dir, path, .posix, false));
                        },
                        .source_index => {},
                    }
                }
            },
            else => {},
        }

        // Mix in the hash for this chunk
        hash.write(std.mem.asBytes(&chunk.isolated_hash));
    }

    pub const writeOutputFilesToDisk = @import("linker_context/writeOutputFilesToDisk.zig").writeOutputFilesToDisk;

    // Sort cross-chunk exports by chunk name for determinism
    pub fn sortedCrossChunkExportItems(
        c: *LinkerContext,
        export_refs: ChunkMeta.Map,
        list: *std.ArrayList(StableRef),
    ) void {
        var result = list.*;
        defer list.* = result;
        result.clearRetainingCapacity();
        result.ensureTotalCapacity(export_refs.count()) catch unreachable;
        result.items.len = export_refs.count();
        for (export_refs.keys(), result.items) |export_ref, *item| {
            if (comptime Environment.allow_assert)
                debugTreeShake("Export name: {s} (in {s})", .{
                    c.graph.symbols.get(export_ref).?.original_name,
                    c.parse_graph.input_files.get(export_ref.sourceIndex()).source.path.text,
                });
            item.* = .{
                .stable_source_index = c.graph.stable_source_indices[export_ref.sourceIndex()],
                .ref = export_ref,
            };
        }
        std.sort.pdq(StableRef, result.items, {}, StableRef.isLessThan);
    }

    pub fn markFileReachableForCodeSplitting(
        c: *LinkerContext,
        source_index: Index.Int,
        entry_points_count: usize,
        distances: []u32,
        distance: u32,
        parts: []bun.BabyList(Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        file_entry_bits: []AutoBitSet,
        css_reprs: []?*bun.css.BundlerStyleSheet,
    ) void {
        if (!c.graph.files_live.isSet(source_index))
            return;

        const cur_dist = distances[source_index];
        const traverse_again = distance < cur_dist;
        if (traverse_again) {
            distances[source_index] = distance;
        }
        const out_dist = distance + 1;

        var bits = &file_entry_bits[source_index];

        // Don't mark this file more than once
        if (bits.isSet(entry_points_count) and !traverse_again)
            return;

        bits.set(entry_points_count);

        if (comptime bun.Environment.enable_logs)
            debugTreeShake(
                "markFileReachableForCodeSplitting(entry: {d}): {s} {s} ({d})",
                .{
                    entry_points_count,
                    c.parse_graph.input_files.items(.source)[source_index].path.pretty,
                    @tagName(c.parse_graph.ast.items(.target)[source_index].bakeGraph()),
                    out_dist,
                },
            );

        if (css_reprs[source_index] != null) {
            for (import_records[source_index].slice()) |*record| {
                if (record.source_index.isValid() and !c.isExternalDynamicImport(record, source_index)) {
                    c.markFileReachableForCodeSplitting(
                        record.source_index.get(),
                        entry_points_count,
                        distances,
                        out_dist,
                        parts,
                        import_records,
                        file_entry_bits,
                        css_reprs,
                    );
                }
            }
            return;
        }

        for (import_records[source_index].slice()) |*record| {
            if (record.source_index.isValid() and !c.isExternalDynamicImport(record, source_index)) {
                c.markFileReachableForCodeSplitting(
                    record.source_index.get(),
                    entry_points_count,
                    distances,
                    out_dist,
                    parts,
                    import_records,
                    file_entry_bits,
                    css_reprs,
                );
            }
        }

        const parts_in_file = parts[source_index].slice();
        for (parts_in_file) |part| {
            for (part.dependencies.slice()) |dependency| {
                if (dependency.source_index.get() != source_index) {
                    c.markFileReachableForCodeSplitting(
                        dependency.source_index.get(),
                        entry_points_count,
                        distances,
                        out_dist,
                        parts,
                        import_records,
                        file_entry_bits,
                        css_reprs,
                    );
                }
            }
        }
    }

    pub fn markFileLiveForTreeShaking(
        c: *LinkerContext,
        source_index: Index.Int,
        side_effects: []_resolver.SideEffects,
        parts: []bun.BabyList(Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        entry_point_kinds: []EntryPoint.Kind,
        css_reprs: []?*bun.css.BundlerStyleSheet,
    ) void {
        if (comptime bun.Environment.allow_assert) {
            debugTreeShake("markFileLiveForTreeShaking({d}, {s} {s}) = {s}", .{
                source_index,
                c.parse_graph.input_files.get(source_index).source.path.pretty,
                @tagName(c.parse_graph.ast.items(.target)[source_index].bakeGraph()),
                if (c.graph.files_live.isSet(source_index)) "already seen" else "first seen",
            });
        }

        defer if (Environment.allow_assert) {
            debugTreeShake("end()", .{});
        };

        if (c.graph.files_live.isSet(source_index)) return;
        c.graph.files_live.set(source_index);

        if (source_index >= c.graph.ast.len) {
            bun.assert(false);
            return;
        }

        if (css_reprs[source_index] != null) {
            for (import_records[source_index].slice()) |*record| {
                const other_source_index = record.source_index.get();
                if (record.source_index.isValid()) {
                    c.markFileLiveForTreeShaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                }
            }
            return;
        }

        for (parts[source_index].slice(), 0..) |part, part_index| {
            var can_be_removed_if_unused = part.can_be_removed_if_unused;

            if (can_be_removed_if_unused and part.tag == .commonjs_named_export) {
                if (c.graph.meta.items(.flags)[source_index].wrap == .cjs) {
                    can_be_removed_if_unused = false;
                }
            }

            // Also include any statement-level imports
            for (part.import_record_indices.slice()) |import_index| {
                const record = import_records[source_index].at(import_index);
                if (record.kind != .stmt)
                    continue;

                if (record.source_index.isValid()) {
                    const other_source_index = record.source_index.get();

                    // Don't include this module for its side effects if it can be
                    // considered to have no side effects
                    const se = side_effects[other_source_index];

                    if (se != .has_side_effects and
                        !c.options.ignore_dce_annotations)
                    {
                        continue;
                    }

                    // Otherwise, include this module for its side effects
                    c.markFileLiveForTreeShaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                } else if (record.is_external_without_side_effects) {
                    // This can be removed if it's unused
                    continue;
                }

                // If we get here then the import was included for its side effects, so
                // we must also keep this part
                can_be_removed_if_unused = false;
            }

            // Include all parts in this file with side effects, or just include
            // everything if tree-shaking is disabled. Note that we still want to
            // perform tree-shaking on the runtime even if tree-shaking is disabled.
            if (!can_be_removed_if_unused or
                (!part.force_tree_shaking and
                    !c.options.tree_shaking and
                    entry_point_kinds[source_index].isEntryPoint()))
            {
                c.markPartLiveForTreeShaking(
                    @intCast(part_index),
                    source_index,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                    css_reprs,
                );
            }
        }
    }

    pub fn markPartLiveForTreeShaking(
        c: *LinkerContext,
        part_index: Index.Int,
        source_index: Index.Int,
        side_effects: []_resolver.SideEffects,
        parts: []bun.BabyList(Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        entry_point_kinds: []EntryPoint.Kind,
        css_reprs: []?*bun.css.BundlerStyleSheet,
    ) void {
        const part: *Part = &parts[source_index].slice()[part_index];

        // only once
        if (part.is_live) {
            return;
        }
        part.is_live = true;

        if (comptime bun.Environment.isDebug) {
            debugTreeShake("markPartLiveForTreeShaking({d}): {s}:{d} = {d}, {s}", .{
                source_index,
                c.parse_graph.input_files.get(source_index).source.path.pretty,
                part_index,
                if (part.stmts.len > 0) part.stmts[0].loc.start else Logger.Loc.Empty.start,
                if (part.stmts.len > 0) @tagName(part.stmts[0].data) else @tagName(Stmt.empty().data),
            });
        }

        defer if (Environment.allow_assert) {
            debugTreeShake("end()", .{});
        };

        // Include the file containing this part
        c.markFileLiveForTreeShaking(
            source_index,
            side_effects,
            parts,
            import_records,
            entry_point_kinds,
            css_reprs,
        );

        if (Environment.enable_logs and part.dependencies.slice().len == 0) {
            logPartDependencyTree("markPartLiveForTreeShaking {d}:{d} | EMPTY", .{
                source_index, part_index,
            });
        }

        for (part.dependencies.slice()) |dependency| {
            if (Environment.enable_logs and source_index != 0 and dependency.source_index.get() != 0) {
                logPartDependencyTree("markPartLiveForTreeShaking: {d}:{d} --> {d}:{d}\n", .{
                    source_index, part_index, dependency.source_index.get(), dependency.part_index,
                });
            }

            c.markPartLiveForTreeShaking(
                dependency.part_index,
                dependency.source_index.get(),
                side_effects,
                parts,
                import_records,
                entry_point_kinds,
                css_reprs,
            );
        }
    }

    pub fn matchImportWithExport(
        c: *LinkerContext,
        init_tracker: ImportTracker,
        re_exports: *std.ArrayList(js_ast.Dependency),
    ) MatchImport {
        const cycle_detector_top = c.cycle_detector.items.len;
        defer c.cycle_detector.shrinkRetainingCapacity(cycle_detector_top);

        var tracker = init_tracker;
        var ambiguous_results = std.ArrayList(MatchImport).init(c.allocator);
        defer ambiguous_results.clearAndFree();

        var result: MatchImport = MatchImport{};
        const named_imports = c.graph.ast.items(.named_imports);

        loop: while (true) {
            // Make sure we avoid infinite loops trying to resolve cycles:
            //
            //   // foo.js
            //   export {a as b} from './foo.js'
            //   export {b as c} from './foo.js'
            //   export {c as a} from './foo.js'
            //
            // This uses a O(n^2) array scan instead of a O(n) map because the vast
            // majority of cases have one or two elements
            for (c.cycle_detector.items[cycle_detector_top..]) |prev_tracker| {
                if (std.meta.eql(tracker, prev_tracker)) {
                    result = .{ .kind = .cycle };
                    break :loop;
                }
            }

            if (tracker.source_index.isInvalid()) {
                // External
                break;
            }

            const prev_source_index = tracker.source_index.get();
            c.cycle_detector.append(tracker) catch bun.outOfMemory();

            // Resolve the import by one step
            const advanced = c.advanceImportTracker(&tracker);
            const next_tracker = advanced.value;
            const status = advanced.status;
            const potentially_ambiguous_export_star_refs = advanced.import_data;

            switch (status) {
                .cjs, .cjs_without_exports, .disabled, .external => {
                    if (status == .external and c.options.output_format.keepES6ImportExportSyntax()) {
                        // Imports from external modules should not be converted to CommonJS
                        // if the output format preserves the original ES6 import statements
                        break;
                    }

                    // If it's a CommonJS or external file, rewrite the import to a
                    // property access. Don't do this if the namespace reference is invalid
                    // though. This is the case for star imports, where the import is the
                    // namespace.
                    const named_import: js_ast.NamedImport = named_imports[prev_source_index].get(tracker.import_ref).?;

                    if (named_import.namespace_ref != null and named_import.namespace_ref.?.isValid()) {
                        if (result.kind == .normal) {
                            result.kind = .normal_and_namespace;
                            result.namespace_ref = named_import.namespace_ref.?;
                            result.alias = named_import.alias.?;
                        } else {
                            result = .{
                                .kind = .namespace,
                                .namespace_ref = named_import.namespace_ref.?,
                                .alias = named_import.alias.?,
                            };
                        }
                    }

                    // Warn about importing from a file that is known to not have any exports
                    if (status == .cjs_without_exports) {
                        const source = c.getSource(tracker.source_index.get());
                        c.log.addRangeWarningFmt(
                            source,
                            source.rangeOfIdentifier(named_import.alias_loc.?),
                            c.allocator,
                            "Import \"{s}\" will always be undefined because the file \"{s}\" has no exports",
                            .{
                                named_import.alias.?,
                                source.path.pretty,
                            },
                        ) catch unreachable;
                    }
                },

                .dynamic_fallback_interop_default => {
                    // if the file was rewritten from CommonJS into ESM
                    // and the developer imported an export that doesn't exist
                    // We don't do a runtime error since that CJS would have returned undefined.
                    const named_import: js_ast.NamedImport = named_imports[prev_source_index].get(tracker.import_ref).?;

                    if (named_import.namespace_ref != null and named_import.namespace_ref.?.isValid()) {
                        const symbol = c.graph.symbols.get(tracker.import_ref).?;
                        symbol.import_item_status = .missing;
                        result.kind = .normal_and_namespace;
                        result.namespace_ref = tracker.import_ref;
                        result.alias = named_import.alias.?;
                        result.name_loc = named_import.alias_loc orelse Logger.Loc.Empty;
                    }
                },

                .dynamic_fallback => {
                    // If it's a file with dynamic export fallback, rewrite the import to a property access
                    const named_import: js_ast.NamedImport = named_imports[prev_source_index].get(tracker.import_ref).?;
                    if (named_import.namespace_ref != null and named_import.namespace_ref.?.isValid()) {
                        if (result.kind == .normal) {
                            result.kind = .normal_and_namespace;
                            result.namespace_ref = next_tracker.import_ref;
                            result.alias = named_import.alias.?;
                        } else {
                            result = .{
                                .kind = .namespace,
                                .namespace_ref = next_tracker.import_ref,
                                .alias = named_import.alias.?,
                            };
                        }
                    }
                },
                .no_match => {
                    // Report mismatched imports and exports
                    const symbol = c.graph.symbols.get(tracker.import_ref).?;
                    const named_import: js_ast.NamedImport = named_imports[prev_source_index].get(tracker.import_ref).?;
                    const source = c.getSource(prev_source_index);

                    const next_source = c.getSource(next_tracker.source_index.get());
                    const r = source.rangeOfIdentifier(named_import.alias_loc.?);

                    // Report mismatched imports and exports
                    if (symbol.import_item_status == .generated) {
                        // This is a debug message instead of an error because although it
                        // appears to be a named import, it's actually an automatically-
                        // generated named import that was originally a property access on an
                        // import star namespace object. Normally this property access would
                        // just resolve to undefined at run-time instead of failing at binding-
                        // time, so we emit a debug message and rewrite the value to the literal
                        // "undefined" instead of emitting an error.
                        symbol.import_item_status = .missing;

                        if (c.resolver.opts.target == .browser and JSC.ModuleLoader.HardcodedModule.Alias.has(next_source.path.pretty, .bun)) {
                            c.log.addRangeWarningFmtWithNote(
                                source,
                                r,
                                c.allocator,
                                "Browser polyfill for module \"{s}\" doesn't have a matching export named \"{s}\"",
                                .{
                                    next_source.path.pretty,
                                    named_import.alias.?,
                                },
                                "Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options.",
                                .{},
                                r,
                            ) catch unreachable;
                        } else {
                            c.log.addRangeWarningFmt(
                                source,
                                r,
                                c.allocator,
                                "Import \"{s}\" will always be undefined because there is no matching export in \"{s}\"",
                                .{
                                    named_import.alias.?,
                                    next_source.path.pretty,
                                },
                            ) catch unreachable;
                        }
                    } else if (c.resolver.opts.target == .browser and bun.strings.hasPrefixComptime(next_source.path.text, NodeFallbackModules.import_path)) {
                        c.log.addRangeErrorFmtWithNote(
                            source,
                            r,
                            c.allocator,
                            "Browser polyfill for module \"{s}\" doesn't have a matching export named \"{s}\"",
                            .{
                                next_source.path.pretty,
                                named_import.alias.?,
                            },
                            "Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options.",
                            .{},
                            r,
                        ) catch unreachable;
                    } else {
                        c.log.addRangeErrorFmt(
                            source,
                            r,
                            c.allocator,
                            "No matching export in \"{s}\" for import \"{s}\"",
                            .{
                                next_source.path.pretty,
                                named_import.alias.?,
                            },
                        ) catch unreachable;
                    }
                },
                .probably_typescript_type => {
                    // Omit this import from any namespace export code we generate for
                    // import star statements (i.e. "import * as ns from 'path'")
                    result = .{ .kind = .probably_typescript_type };
                },
                .found => {

                    // If there are multiple ambiguous results due to use of "export * from"
                    // statements, trace them all to see if they point to different things.
                    for (potentially_ambiguous_export_star_refs) |*ambiguous_tracker| {
                        // If this is a re-export of another import, follow the import
                        if (named_imports[ambiguous_tracker.data.source_index.get()].contains(ambiguous_tracker.data.import_ref)) {
                            const ambig = c.matchImportWithExport(ambiguous_tracker.data, re_exports);
                            ambiguous_results.append(ambig) catch unreachable;
                        } else {
                            ambiguous_results.append(.{
                                .kind = .normal,
                                .source_index = ambiguous_tracker.data.source_index.get(),
                                .ref = ambiguous_tracker.data.import_ref,
                                .name_loc = ambiguous_tracker.data.name_loc,
                            }) catch unreachable;
                        }
                    }

                    // Defer the actual binding of this import until after we generate
                    // namespace export code for all files. This has to be done for all
                    // import-to-export matches, not just the initial import to the final
                    // export, since all imports and re-exports must be merged together
                    // for correctness.
                    result = .{
                        .kind = .normal,
                        .source_index = next_tracker.source_index.get(),
                        .ref = next_tracker.import_ref,
                        .name_loc = next_tracker.name_loc,
                    };

                    // Depend on the statement(s) that declared this import symbol in the
                    // original file
                    {
                        const deps = c.topLevelSymbolsToParts(prev_source_index, tracker.import_ref);
                        re_exports.ensureUnusedCapacity(deps.len) catch unreachable;
                        for (deps) |dep| {
                            re_exports.appendAssumeCapacity(
                                .{
                                    .part_index = dep,
                                    .source_index = tracker.source_index,
                                },
                            );
                        }
                    }

                    // If this is a re-export of another import, continue for another
                    // iteration of the loop to resolve that import as well
                    const next_id = next_tracker.source_index.get();
                    if (named_imports[next_id].contains(next_tracker.import_ref)) {
                        tracker = next_tracker;
                        continue :loop;
                    }
                },
            }

            break :loop;
        }

        // If there is a potential ambiguity, all results must be the same
        for (ambiguous_results.items) |ambig| {
            if (!std.meta.eql(ambig, result)) {
                if (result.kind == ambig.kind and
                    ambig.kind == .normal and
                    ambig.name_loc.start != 0 and
                    result.name_loc.start != 0)
                {
                    return .{
                        .kind = .ambiguous,
                        .source_index = result.source_index,
                        .name_loc = result.name_loc,
                        .other_source_index = ambig.source_index,
                        .other_name_loc = ambig.name_loc,
                    };
                }

                return .{ .kind = .ambiguous };
            }
        }

        return result;
    }

    pub fn topLevelSymbolsToParts(c: *LinkerContext, id: u32, ref: Ref) []u32 {
        return c.graph.topLevelSymbolToParts(id, ref);
    }

    pub fn topLevelSymbolsToPartsForRuntime(c: *LinkerContext, ref: Ref) []u32 {
        return topLevelSymbolsToParts(c, Index.runtime.get(), ref);
    }

    pub fn createWrapperForFile(
        c: *LinkerContext,
        wrap: WrapKind,
        wrapper_ref: Ref,
        wrapper_part_index: *Index,
        source_index: Index.Int,
    ) void {
        switch (wrap) {
            // If this is a CommonJS file, we're going to need to generate a wrapper
            // for the CommonJS closure. That will end up looking something like this:
            //
            //   var require_foo = __commonJS((exports, module) => {
            //     ...
            //   });
            //
            // However, that generation is special-cased for various reasons and is
            // done later on. Still, we're going to need to ensure that this file
            // both depends on the "__commonJS" symbol and declares the "require_foo"
            // symbol. Instead of special-casing this during the reachability analysis
            // below, we just append a dummy part to the end of the file with these
            // dependencies and let the general-purpose reachability analysis take care
            // of it.
            .cjs => {
                const common_js_parts = c.topLevelSymbolsToPartsForRuntime(c.cjs_runtime_ref);

                for (common_js_parts) |part_id| {
                    const runtime_parts = c.graph.ast.items(.parts)[Index.runtime.get()].slice();
                    const part: *Part = &runtime_parts[part_id];
                    const symbol_refs = part.symbol_uses.keys();
                    for (symbol_refs) |ref| {
                        if (ref.eql(c.cjs_runtime_ref)) continue;
                    }
                }

                // Generate a dummy part that depends on the "__commonJS" symbol.
                const dependencies: []js_ast.Dependency = if (c.options.output_format != .internal_bake_dev) brk: {
                    const dependencies = c.allocator.alloc(js_ast.Dependency, common_js_parts.len) catch bun.outOfMemory();
                    for (common_js_parts, dependencies) |part, *cjs| {
                        cjs.* = .{
                            .part_index = part,
                            .source_index = Index.runtime,
                        };
                    }
                    break :brk dependencies;
                } else &.{};
                var symbol_uses: Part.SymbolUseMap = .empty;
                symbol_uses.put(c.allocator, wrapper_ref, .{ .count_estimate = 1 }) catch bun.outOfMemory();
                const part_index = c.graph.addPartToFile(
                    source_index,
                    .{
                        .stmts = &.{},
                        .symbol_uses = symbol_uses,
                        .declared_symbols = js_ast.DeclaredSymbol.List.fromSlice(
                            c.allocator,
                            &[_]js_ast.DeclaredSymbol{
                                .{ .ref = c.graph.ast.items(.exports_ref)[source_index], .is_top_level = true },
                                .{ .ref = c.graph.ast.items(.module_ref)[source_index], .is_top_level = true },
                                .{ .ref = c.graph.ast.items(.wrapper_ref)[source_index], .is_top_level = true },
                            },
                        ) catch unreachable,
                        .dependencies = Dependency.List.init(dependencies),
                    },
                ) catch unreachable;
                bun.assert(part_index != js_ast.namespace_export_part_index);
                wrapper_part_index.* = Index.part(part_index);

                // Bake uses a wrapping approach that does not use __commonJS
                if (c.options.output_format != .internal_bake_dev) {
                    c.graph.generateSymbolImportAndUse(
                        source_index,
                        part_index,
                        c.cjs_runtime_ref,
                        1,
                        Index.runtime,
                    ) catch unreachable;
                }
            },

            .esm => {
                // If this is a lazily-initialized ESM file, we're going to need to
                // generate a wrapper for the ESM closure. That will end up looking
                // something like this:
                //
                //   var init_foo = __esm(() => {
                //     ...
                //   });
                //
                // This depends on the "__esm" symbol and declares the "init_foo" symbol
                // for similar reasons to the CommonJS closure above.
                const esm_parts = if (wrapper_ref.isValid() and c.options.output_format != .internal_bake_dev)
                    c.topLevelSymbolsToPartsForRuntime(c.esm_runtime_ref)
                else
                    &.{};

                // generate a dummy part that depends on the "__esm" symbol
                const dependencies = c.allocator.alloc(js_ast.Dependency, esm_parts.len) catch unreachable;
                for (esm_parts, dependencies) |part, *esm| {
                    esm.* = .{
                        .part_index = part,
                        .source_index = Index.runtime,
                    };
                }

                var symbol_uses: Part.SymbolUseMap = .empty;
                symbol_uses.put(c.allocator, wrapper_ref, .{ .count_estimate = 1 }) catch bun.outOfMemory();
                const part_index = c.graph.addPartToFile(
                    source_index,
                    .{
                        .symbol_uses = symbol_uses,
                        .declared_symbols = js_ast.DeclaredSymbol.List.fromSlice(c.allocator, &[_]js_ast.DeclaredSymbol{
                            .{ .ref = wrapper_ref, .is_top_level = true },
                        }) catch unreachable,
                        .dependencies = Dependency.List.init(dependencies),
                    },
                ) catch unreachable;
                bun.assert(part_index != js_ast.namespace_export_part_index);
                wrapper_part_index.* = Index.part(part_index);
                if (wrapper_ref.isValid() and c.options.output_format != .internal_bake_dev) {
                    c.graph.generateSymbolImportAndUse(
                        source_index,
                        part_index,
                        c.esm_runtime_ref,
                        1,
                        Index.runtime,
                    ) catch bun.outOfMemory();
                }
            },
            else => {},
        }
    }

    pub fn advanceImportTracker(c: *LinkerContext, tracker: *const ImportTracker) ImportTracker.Iterator {
        const id = tracker.source_index.get();
        var named_imports: *JSAst.NamedImports = &c.graph.ast.items(.named_imports)[id];
        var import_records = c.graph.ast.items(.import_records)[id];
        const exports_kind: []const js_ast.ExportsKind = c.graph.ast.items(.exports_kind);
        const ast_flags = c.graph.ast.items(.flags);

        const named_import: js_ast.NamedImport = named_imports.get(tracker.import_ref) orelse
            // TODO: investigate if this is a bug
            // It implies there are imports being added without being resolved
            return .{
                .value = .{},
                .status = .external,
            };

        // Is this an external file?
        const record: *const ImportRecord = import_records.at(named_import.import_record_index);
        if (!record.source_index.isValid()) {
            return .{
                .value = .{},
                .status = .external,
            };
        }

        // Is this a disabled file?
        const other_source_index = record.source_index.get();
        const other_id = other_source_index;

        if (other_id > c.graph.ast.len or c.parse_graph.input_files.items(.source)[other_source_index].path.is_disabled) {
            return .{
                .value = .{
                    .source_index = record.source_index,
                },
                .status = .disabled,
            };
        }

        const flags = ast_flags[other_id];

        // Is this a named import of a file without any exports?
        if (!named_import.alias_is_star and
            flags.has_lazy_export and

            // CommonJS exports
            !flags.uses_export_keyword and !strings.eqlComptime(named_import.alias orelse "", "default") and
            // ESM exports
            !flags.uses_exports_ref and !flags.uses_module_ref)
        {
            // Just warn about it and replace the import with "undefined"
            return .{
                .value = .{
                    .source_index = Index.source(other_source_index),
                    .import_ref = Ref.None,
                },
                .status = .cjs_without_exports,
            };
        }
        const other_kind = exports_kind[other_id];
        // Is this a CommonJS file?
        if (other_kind == .cjs) {
            return .{
                .value = .{
                    .source_index = Index.source(other_source_index),
                    .import_ref = Ref.None,
                },
                .status = .cjs,
            };
        }

        // Match this import star with an export star from the imported file
        if (named_import.alias_is_star) {
            const matching_export = c.graph.meta.items(.resolved_export_star)[other_id];
            if (matching_export.data.import_ref.isValid()) {
                // Check to see if this is a re-export of another import
                return .{
                    .value = matching_export.data,
                    .status = .found,
                    .import_data = matching_export.potentially_ambiguous_export_star_refs.slice(),
                };
            }
        }

        // Match this import up with an export from the imported file
        if (c.graph.meta.items(.resolved_exports)[other_id].get(named_import.alias.?)) |matching_export| {
            // Check to see if this is a re-export of another import
            return .{
                .value = .{
                    .source_index = matching_export.data.source_index,
                    .import_ref = matching_export.data.import_ref,
                    .name_loc = matching_export.data.name_loc,
                },
                .status = .found,
                .import_data = matching_export.potentially_ambiguous_export_star_refs.slice(),
            };
        }

        // Is this a file with dynamic exports?
        const is_commonjs_to_esm = flags.force_cjs_to_esm;
        if (other_kind.isESMWithDynamicFallback() or is_commonjs_to_esm) {
            return .{
                .value = .{
                    .source_index = Index.source(other_source_index),
                    .import_ref = c.graph.ast.items(.exports_ref)[other_id],
                },
                .status = if (is_commonjs_to_esm)
                    .dynamic_fallback_interop_default
                else
                    .dynamic_fallback,
            };
        }

        // Missing re-exports in TypeScript files are indistinguishable from types
        const other_loader = c.parse_graph.input_files.items(.loader)[other_id];
        if (named_import.is_exported and other_loader.isTypeScript()) {
            return .{
                .value = .{},
                .status = .probably_typescript_type,
            };
        }

        return .{
            .value = .{
                .source_index = Index.source(other_source_index),
            },
            .status = .no_match,
        };
    }

    pub fn matchImportsWithExportsForFile(
        c: *LinkerContext,
        named_imports_ptr: *JSAst.NamedImports,
        imports_to_bind: *RefImportData,
        source_index: Index.Int,
    ) void {
        var named_imports = named_imports_ptr.clone(c.allocator) catch bun.outOfMemory();
        defer named_imports_ptr.* = named_imports;

        const Sorter = struct {
            imports: *JSAst.NamedImports,

            pub fn lessThan(self: @This(), a_index: usize, b_index: usize) bool {
                const a_ref = self.imports.keys()[a_index];
                const b_ref = self.imports.keys()[b_index];

                return std.math.order(a_ref.innerIndex(), b_ref.innerIndex()) == .lt;
            }
        };
        const sorter = Sorter{
            .imports = &named_imports,
        };
        named_imports.sort(sorter);

        for (named_imports.keys(), named_imports.values()) |ref, named_import| {
            // Re-use memory for the cycle detector
            c.cycle_detector.clearRetainingCapacity();

            const import_ref = ref;

            var re_exports = std.ArrayList(js_ast.Dependency).init(c.allocator);
            const result = c.matchImportWithExport(.{
                .source_index = Index.source(source_index),
                .import_ref = import_ref,
            }, &re_exports);

            switch (result.kind) {
                .normal => {
                    imports_to_bind.put(
                        c.allocator,
                        import_ref,
                        .{
                            .re_exports = bun.BabyList(js_ast.Dependency).init(re_exports.items),
                            .data = .{
                                .source_index = Index.source(result.source_index),
                                .import_ref = result.ref,
                            },
                        },
                    ) catch unreachable;
                },
                .namespace => {
                    c.graph.symbols.get(import_ref).?.namespace_alias = js_ast.G.NamespaceAlias{
                        .namespace_ref = result.namespace_ref,
                        .alias = result.alias,
                    };
                },
                .normal_and_namespace => {
                    imports_to_bind.put(
                        c.allocator,
                        import_ref,
                        .{
                            .re_exports = bun.BabyList(js_ast.Dependency).init(re_exports.items),
                            .data = .{
                                .source_index = Index.source(result.source_index),
                                .import_ref = result.ref,
                            },
                        },
                    ) catch unreachable;

                    c.graph.symbols.get(import_ref).?.namespace_alias = js_ast.G.NamespaceAlias{
                        .namespace_ref = result.namespace_ref,
                        .alias = result.alias,
                    };
                },
                .cycle => {
                    const source = &c.parse_graph.input_files.items(.source)[source_index];
                    const r = lex.rangeOfIdentifier(source, named_import.alias_loc orelse Logger.Loc{});
                    c.log.addRangeErrorFmt(
                        source,
                        r,
                        c.allocator,
                        "Detected cycle while resolving import \"{s}\"",
                        .{
                            named_import.alias.?,
                        },
                    ) catch unreachable;
                },
                .probably_typescript_type => {
                    c.graph.meta.items(.probably_typescript_type)[source_index].put(
                        c.allocator,
                        import_ref,
                        {},
                    ) catch unreachable;
                },
                .ambiguous => {
                    const source = &c.parse_graph.input_files.items(.source)[source_index];

                    const r = lex.rangeOfIdentifier(source, named_import.alias_loc orelse Logger.Loc{});

                    // TODO: log locations of the ambiguous exports

                    const symbol: *Symbol = c.graph.symbols.get(import_ref).?;
                    if (symbol.import_item_status == .generated) {
                        symbol.import_item_status = .missing;
                        c.log.addRangeWarningFmt(
                            source,
                            r,
                            c.allocator,
                            "Import \"{s}\" will always be undefined because there are multiple matching exports",
                            .{
                                named_import.alias.?,
                            },
                        ) catch unreachable;
                    } else {
                        c.log.addRangeErrorFmt(
                            source,
                            r,
                            c.allocator,
                            "Ambiguous import \"{s}\" has multiple matching exports",
                            .{
                                named_import.alias.?,
                            },
                        ) catch unreachable;
                    }
                },
                .ignore => {},
            }
        }
    }

    pub fn breakOutputIntoPieces(
        c: *LinkerContext,
        allocator: std.mem.Allocator,
        j: *StringJoiner,
        count: u32,
    ) !Chunk.IntermediateOutput {
        const trace = bun.perf.trace("Bundler.breakOutputIntoPieces");
        defer trace.end();

        const OutputPiece = Chunk.OutputPiece;

        if (!j.contains(c.unique_key_prefix))
            // There are like several cases that prohibit this from being checked more trivially, example:
            // 1. dynamic imports
            // 2. require()
            // 3. require.resolve()
            // 4. externals
            return .{ .joiner = j.* };

        var pieces = try std.ArrayList(OutputPiece).initCapacity(allocator, count);
        const complete_output = try j.done(allocator);
        var output = complete_output;

        const prefix = c.unique_key_prefix;

        outer: while (true) {
            // Scan for the next piece boundary
            const boundary = strings.indexOf(output, prefix) orelse
                break;

            // Try to parse the piece boundary
            const start = boundary + prefix.len;
            if (start + 9 > output.len) {
                // Not enough bytes to parse the piece index
                break;
            }

            const kind: OutputPiece.Query.Kind = switch (output[start]) {
                'A' => .asset,
                'C' => .chunk,
                'S' => .scb,
                'H' => .html_import,
                else => {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break;
                },
            };

            var index: usize = 0;
            for (output[start..][1..9].*) |char| {
                if (char < '0' or char > '9') {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break :outer;
                }

                index = (index * 10) + (@as(usize, char) - '0');
            }

            // Validate the boundary
            switch (kind) {
                .asset, .scb => if (index >= c.graph.files.len) {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break;
                },
                .chunk => if (index >= count) {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break;
                },
                .html_import => if (index >= c.parse_graph.html_imports.server_source_indices.len) {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break;
                },
                else => unreachable,
            }

            try pieces.append(OutputPiece.init(output[0..boundary], .{
                .kind = kind,
                .index = @intCast(index),
            }));
            output = output[boundary + prefix.len + 9 ..];
        }

        try pieces.append(OutputPiece.init(output, OutputPiece.Query.none));

        return .{
            .pieces = bun.BabyList(Chunk.OutputPiece).init(pieces.items),
        };
    }
};

const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FeatureFlags = bun.FeatureFlags;

const std = @import("std");
const lex = @import("../js_lexer.zig");
const Logger = @import("../logger.zig");
const options = @import("../options.zig");
const Part = js_ast.Part;
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
const sourcemap = bun.sourcemap;
const StringJoiner = bun.StringJoiner;
const base64 = bun.base64;
pub const Ref = @import("../ast/base.zig").Ref;
pub const ThreadPoolLib = @import("../thread_pool.zig");
const BabyList = @import("../baby_list.zig").BabyList;
pub const Fs = @import("../fs.zig");
const _resolver = @import("../resolver/resolver.zig");
const sync = bun.ThreadPool;
const ImportRecord = bun.ImportRecord;
const runtime = @import("../runtime.zig");

const NodeFallbackModules = @import("../node_fallbacks.zig");
const Resolver = _resolver.Resolver;
const Dependency = js_ast.Dependency;
const JSAst = js_ast.BundledAst;
const Loader = options.Loader;
pub const Index = @import("../ast/base.zig").Index;
const Symbol = js_ast.Symbol;
const EventLoop = bun.JSC.AnyEventLoop;
const MultiArrayList = bun.MultiArrayList;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const E = js_ast.E;
const S = js_ast.S;
const G = js_ast.G;
const B = js_ast.B;
const Binding = js_ast.Binding;
const AutoBitSet = bun.bit_set.AutoBitSet;
const renamer = bun.renamer;
const JSC = bun.JSC;
const debugTreeShake = Output.scoped(.TreeShake, true);
const Loc = Logger.Loc;
const bake = bun.bake;
const bundler = bun.bundle_v2;
const BundleV2 = bundler.BundleV2;
const Graph = bundler.Graph;
const LinkerGraph = bundler.LinkerGraph;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;
const ImportTracker = bundler.ImportTracker;
const MangledProps = bundler.MangledProps;
const Chunk = bundler.Chunk;
const ServerComponentBoundary = bundler.ServerComponentBoundary;
const PartRange = bundler.PartRange;
const JSMeta = bundler.JSMeta;
const ExportData = bundler.ExportData;
const EntryPoint = bundler.EntryPoint;
const RefImportData = bundler.RefImportData;
const StableRef = bundler.StableRef;
const CompileResultForSourceMap = bundler.CompileResultForSourceMap;
const ContentHasher = bundler.ContentHasher;
const WrapKind = bundler.WrapKind;
const genericPathWithPrettyInitialized = bundler.genericPathWithPrettyInitialized;
const AdditionalFile = bundler.AdditionalFile;
const logPartDependencyTree = bundler.logPartDependencyTree;
