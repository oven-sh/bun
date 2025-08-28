const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const JSC = bun.JSC;
const js_ast = bun.ast;
const bundler = bun.bundle_v2;
const Index = js_ast.Index;
const Ref = js_ast.Ref;
const Symbol = js_ast.Symbol;
const ImportRecord = bun.ImportRecord;
const DeclaredSymbol = js_ast.DeclaredSymbol;
const logger = bun.logger;
const Part = js_ast.Part;
const Chunk = bundler.Chunk;
const js_printer = bun.js_printer;
const JSON = bun.json;
const JSAst = bun.ast;

pub const GraphVisualizer = struct {
    const debug = Output.scoped(.GraphViz, .visible);
    
    pub fn shouldDump() bool {
        if (comptime !Environment.isDebug) return false;
        return bun.getenvZ("BUN_BUNDLER_GRAPH_DUMP") != null;
    }

    pub fn getDumpStage() DumpStage {
        const env_val = bun.getenvZ("BUN_BUNDLER_GRAPH_DUMP") orelse return .none;
        
        if (strings.eqlComptime(env_val, "all")) return .all;
        if (strings.eqlComptime(env_val, "scan")) return .after_scan;
        if (strings.eqlComptime(env_val, "compute")) return .after_compute;
        if (strings.eqlComptime(env_val, "chunks")) return .after_chunks;
        if (strings.eqlComptime(env_val, "link")) return .after_link;
        if (strings.eqlComptime(env_val, "generation")) return .after_generation;
        
        return .all; // Default to all if set but not recognized
    }

    pub const DumpStage = enum {
        none,
        after_scan,
        after_compute, 
        after_chunks,
        after_link,
        after_generation,
        all,
    };

    pub fn dumpGraphState(
        ctx: *bundler.LinkerContext,
        stage: []const u8,
        chunks: ?[]const Chunk,
    ) !void {
        debug("dumpGraphState called for stage: {s}", .{stage});
        
        if (!shouldDump()) {
            debug("shouldDump() returned false", .{});
            return;
        }
        
        const dump_stage = getDumpStage();
        debug("dump_stage: {}", .{dump_stage});
        
        const should_dump_now = switch (dump_stage) {
            .none => false,
            .all => true,
            .after_scan => strings.eqlComptime(stage, "after_scan"),
            .after_compute => strings.eqlComptime(stage, "after_compute"),
            .after_chunks => strings.eqlComptime(stage, "after_chunks"),
            .after_link => strings.eqlComptime(stage, "after_link"),
            .after_generation => strings.eqlComptime(stage, "after_generation"),
        };
        
        if (!should_dump_now) {
            debug("should_dump_now is false for stage {s}", .{stage});
            return;
        }
        
        debug("Proceeding with dump for stage: {s}", .{stage});
        
        debug("Dumping graph state: {s}", .{stage});
        
        var arena = std.heap.ArenaAllocator.init(default_allocator);
        defer arena.deinit();
        const allocator = arena.allocator();
        
        // Create output directory
        const output_dir = "/tmp/bun-bundler-debug";
        std.fs.cwd().makePath(output_dir) catch |err| {
            debug("Failed to create output directory: {}", .{err});
            return;
        };
        
        // Generate filename with timestamp
        const timestamp = std.time.milliTimestamp();
        const filename = try std.fmt.allocPrint(allocator, "{s}/bundler_graph_{s}_{d}.json", .{ 
            output_dir,
            stage,
            timestamp,
        });
        
        // Build the graph data structure
        const graph_data = try buildGraphData(ctx, allocator, stage, timestamp, chunks);
        
        // Convert to JSON AST
        const json_ast = try JSON.toAST(allocator, GraphData, graph_data);
        
        // Print JSON to buffer
        var stack_fallback = std.heap.stackFallback(1024 * 1024, allocator); // 1MB stack fallback
        const print_allocator = stack_fallback.get();
        
        const buffer_writer = js_printer.BufferWriter.init(print_allocator);
        var writer = js_printer.BufferPrinter.init(buffer_writer);
        defer writer.ctx.buffer.deinit();
        
        const source = &logger.Source.initEmptyFile(filename);
        _ = js_printer.printJSON(
            *js_printer.BufferPrinter,
            &writer,
            json_ast,
            source,
            .{ .mangled_props = null },
        ) catch |err| {
            debug("Failed to print JSON: {}", .{err});
            return;
        };
        
        // Write to file
        const file = try std.fs.cwd().createFile(filename, .{});
        defer file.close();
        try file.writeAll(writer.ctx.buffer.list.items);
        
        debug("Graph dump written to: {s}", .{filename});
        
        // Also generate the visualizer HTML
        try generateVisualizerHTML(allocator, output_dir, timestamp);
    }
    
    const GraphData = struct {
        stage: []const u8,
        timestamp: i64,
        metadata: Metadata,
        files: []FileData,
        symbols: SymbolData,
        entry_points: []EntryPointData,
        imports_and_exports: ImportsExports,
        chunks: ?[]ChunkData,
        dependency_graph: DependencyGraph,
        runtime_meta: RuntimeMeta,
        symbol_chains: []SymbolChain,
    };
    
    const SymbolChain = struct {
        export_name: []const u8,
        source_file: u32,
        chain: []ChainLink,
        has_conflicts: bool,
        conflict_sources: ?[]u32,
    };
    
    const ChainLink = struct {
        file_index: u32,
        symbol_name: []const u8,
        symbol_ref: []const u8,
        link_type: []const u8, // "export", "import", "re-export", "namespace"
    };
    
    const RuntimeMeta = struct {
        memory_usage_mb: f64,
        parse_graph_file_count: usize,
        estimated_file_loader_count: usize,
        has_css: bool,
        has_html: bool,
    };
    
    const Metadata = struct {
        total_files: usize,
        reachable_files: usize,
        entry_points: usize,
        code_splitting: bool,
        output_format: []const u8,
        target: []const u8,
        tree_shaking: bool,
        minify: bool,
    };
    
    const FileData = struct {
        index: usize,
        path: []const u8,
        loader: []const u8,
        source_length: usize,
        entry_point_kind: []const u8,
        part_count: usize,
        parts: ?[]PartData,
        named_exports_count: usize,
        named_imports_count: usize,
        flags: FileFlags,
        source_snippet: ?[]const u8,  // First 500 chars of source
        transformed_code: ?[]const u8, // Transformed output for this file
    };
    
    const FileFlags = struct {
        is_async: bool,
        needs_exports_variable: bool,
        needs_synthetic_default_export: bool,
        wrap: []const u8,
    };
    
    const PartData = struct {
        index: usize,
        stmt_count: usize,
        import_record_count: usize,
        declared_symbol_count: usize,
        can_be_removed_if_unused: bool,
        force_tree_shaking: bool,
        symbol_uses: []SymbolUse,
        dependencies: []PartDependency,
        import_records: []ImportRecordInfo,
        declared_symbols: []DeclaredSymbolInfo,
    };
    
    const ImportRecordInfo = struct {
        index: usize,
        kind: []const u8,
        path: []const u8,
        is_internal: bool,
    };
    
    const DeclaredSymbolInfo = struct {
        ref: []const u8,
        is_top_level: bool,
    };
    
    const SymbolUse = struct {
        ref: []const u8,
        count: u32,
    };
    
    const PartDependency = struct {
        source: u32,
        part: u32,
    };
    
    const SymbolData = struct {
        total_symbols: usize,
        by_source: []SourceSymbols,
    };
    
    const SourceSymbols = struct {
        source_index: usize,
        symbol_count: usize,
        symbols: []SymbolInfo,
    };
    
    const SymbolInfo = struct {
        inner_index: usize,
        kind: []const u8,
        original_name: []const u8,
        link: ?[]const u8,
        use_count_estimate: u32,
        chunk_index: ?u32,
        nested_scope_slot: ?u32,
        flags: SymbolFlags,
        namespace_alias: ?struct {
            namespace_ref: []const u8,
            alias: []const u8,
        },
    };
    
    const SymbolFlags = struct {
        must_not_be_renamed: bool,
        did_keep_name: bool,
        has_been_assigned_to: bool,
        must_start_with_capital_letter_for_jsx: bool,
        private_symbol_must_be_lowered: bool,
        remove_overwritten_function_declaration: bool,
        import_item_status: []const u8,
    };
    
    const EntryPointData = struct {
        source_index: u32,
        output_path: []const u8,
    };
    
    const ImportsExports = struct {
        total_exports: usize,
        total_imports: usize,
        total_import_records: usize,
        exports: []ExportInfo,
        resolved_exports: []ResolvedExportInfo,
        imports: []ImportInfo,
    };
    
    const ExportInfo = struct {
        source: u32,
        name: []const u8,
        ref: []const u8,
        original_symbol_name: ?[]const u8,
        alias_loc: i32,
    };
    
    const ResolvedExportInfo = struct {
        source: u32,
        export_alias: []const u8,
        target_source: ?u32,
        target_ref: ?[]const u8,
        potentially_ambiguous: bool,
        ambiguous_count: usize,
    };
    
    const ImportInfo = struct {
        source: u32,
        kind: []const u8,
        path: []const u8,
        target_source: ?u32,
    };
    
    const ChunkData = struct {
        index: usize,
        is_entry_point: bool,
        source_index: u32,
        files_in_chunk: []u32,
        cross_chunk_import_count: usize,
        cross_chunk_imports: []CrossChunkImportInfo,
        unique_key: []const u8,
        final_path: []const u8,
        content_type: []const u8,
        output_snippet: ?[]const u8, // First 1000 chars of output
        source_mappings: []SourceMapping,
    };
    
    const SourceMapping = struct {
        output_line: u32,
        output_column: u32,
        source_index: u32,
        source_line: u32,
        source_column: u32,
        symbol_name: ?[]const u8,
    };
    
    const CrossChunkImportInfo = struct {
        chunk_index: u32,
        import_kind: []const u8,
    };
    
    const DependencyGraph = struct {
        edges: []GraphEdge,
    };
    
    const GraphEdge = struct {
        from: NodeRef,
        to: NodeRef,
    };
    
    const NodeRef = struct {
        source: u32,
        part: u32,
    };
    
    fn buildGraphData(
        ctx: *bundler.LinkerContext,
        allocator: std.mem.Allocator,
        stage: []const u8,
        timestamp: i64,
        chunks: ?[]const Chunk,
    ) !GraphData {
        const sources = ctx.parse_graph.input_files.items(.source);
        const loaders = ctx.parse_graph.input_files.items(.loader);
        const ast_list = ctx.graph.ast.slice();
        const meta_list = ctx.graph.meta.slice();
        const files_list = ctx.graph.files.slice();
        
        // Build metadata
        const metadata = Metadata{
            .total_files = ctx.graph.files.len,
            .reachable_files = ctx.graph.reachable_files.len,
            .entry_points = ctx.graph.entry_points.len,
            .code_splitting = ctx.graph.code_splitting,
            .output_format = @tagName(ctx.options.output_format),
            .target = @tagName(ctx.options.target),
            .tree_shaking = ctx.options.tree_shaking,
            .minify = ctx.options.minify_syntax,
        };
        
        // Build file data
        var file_data_list = try allocator.alloc(FileData, ctx.graph.files.len);
        for (0..ctx.graph.files.len) |i| {
            var parts_data: ?[]PartData = null;
            
            if (i < ast_list.items(.parts).len) {
                const parts = ast_list.items(.parts)[i].slice();
                if (parts.len > 0) {
                    parts_data = try allocator.alloc(PartData, parts.len);
                    for (parts, 0..) |part, j| {
                        // Build symbol uses
                        var symbol_uses = try allocator.alloc(SymbolUse, part.symbol_uses.count());
                        var use_idx: usize = 0;
                        var use_iter = part.symbol_uses.iterator();
                        while (use_iter.next()) |entry| : (use_idx += 1) {
                            symbol_uses[use_idx] = .{
                                .ref = try std.fmt.allocPrint(allocator, "{}", .{entry.key_ptr.*}),
                                .count = entry.value_ptr.count_estimate,
                            };
                        }
                        
                        // Build dependencies
                        var deps = try allocator.alloc(PartDependency, part.dependencies.len);
                        for (part.dependencies.slice(), 0..) |dep, k| {
                            deps[k] = .{
                                .source = dep.source_index.get(),
                                .part = dep.part_index,
                            };
                        }
                        
                        // Build import records info
                        var import_records = try allocator.alloc(ImportRecordInfo, part.import_record_indices.len);
                        const ast_import_records = if (i < ast_list.items(.import_records).len) 
                            ast_list.items(.import_records)[i].slice() 
                        else 
                            &[_]ImportRecord{};
                        
                        for (part.import_record_indices.slice(), 0..) |record_idx, k| {
                            if (record_idx < ast_import_records.len) {
                                const record = ast_import_records[record_idx];
                                import_records[k] = .{
                                    .index = record_idx,
                                    .kind = @tagName(record.kind),
                                    .path = record.path.text,
                                    .is_internal = record.source_index.isValid(),
                                };
                            } else {
                                import_records[k] = .{
                                    .index = record_idx,
                                    .kind = "unknown",
                                    .path = "",
                                    .is_internal = false,
                                };
                            }
                        }
                        
                        // Build declared symbols info
                        var declared_symbols = try allocator.alloc(DeclaredSymbolInfo, part.declared_symbols.entries.len);
                        const decl_entries = part.declared_symbols.entries.slice();
                        for (decl_entries.items(.ref), decl_entries.items(.is_top_level), 0..) |ref, is_top_level, k| {
                            declared_symbols[k] = .{
                                .ref = try std.fmt.allocPrint(allocator, "{}", .{ref}),
                                .is_top_level = is_top_level,
                            };
                        }
                        
                        parts_data.?[j] = .{
                            .index = j,
                            .stmt_count = part.stmts.len,
                            .import_record_count = part.import_record_indices.len,
                            .declared_symbol_count = part.declared_symbols.entries.len,
                            .can_be_removed_if_unused = part.can_be_removed_if_unused,
                            .force_tree_shaking = part.force_tree_shaking,
                            .symbol_uses = symbol_uses,
                            .dependencies = deps,
                            .import_records = import_records,
                            .declared_symbols = declared_symbols,
                        };
                    }
                }
            }
            
            const path = if (i < sources.len) sources[i].path.text else "unknown";
            const loader = if (i < loaders.len) @tagName(loaders[i]) else "unknown";
            const entry_point_kind = @tagName(files_list.items(.entry_point_kind)[i]);
            
            var flags = FileFlags{
                .is_async = false,
                .needs_exports_variable = false,
                .needs_synthetic_default_export = false,
                .wrap = "none",
            };
            
            if (i < meta_list.items(.flags).len) {
                const meta_flags = meta_list.items(.flags)[i];
                flags = .{
                    .is_async = meta_flags.is_async_or_has_async_dependency,
                    .needs_exports_variable = meta_flags.needs_exports_variable,
                    .needs_synthetic_default_export = meta_flags.needs_synthetic_default_export,
                    .wrap = @tagName(meta_flags.wrap),
                };
            }
            
            const named_exports_count = if (i < ast_list.items(.named_exports).len) 
                ast_list.items(.named_exports)[i].count() else 0;
            const named_imports_count = if (i < ast_list.items(.named_imports).len)
                ast_list.items(.named_imports)[i].count() else 0;
            const part_count = if (i < ast_list.items(.parts).len)
                ast_list.items(.parts)[i].len else 0;
            
            // Get full source code
            const source_snippet = if (i < sources.len and sources[i].contents.len > 0) blk: {
                break :blk try allocator.dupe(u8, sources[i].contents);
            } else null;
            
            file_data_list[i] = .{
                .index = i,
                .path = path,
                .loader = loader,
                .source_length = if (i < sources.len) sources[i].contents.len else 0,
                .entry_point_kind = entry_point_kind,
                .part_count = part_count,
                .parts = parts_data,
                .named_exports_count = named_exports_count,
                .named_imports_count = named_imports_count,
                .flags = flags,
                .source_snippet = source_snippet,
                .transformed_code = null, // TODO: get from compile results
            };
        }
        
        // Build symbol data
        var by_source = try allocator.alloc(SourceSymbols, ctx.graph.symbols.symbols_for_source.len);
        var total_symbols: usize = 0;
        for (ctx.graph.symbols.symbols_for_source.slice(), 0..) |symbols, source_idx| {
            total_symbols += symbols.len;
            
            var symbol_infos = try allocator.alloc(SymbolInfo, symbols.len);
            for (symbols.slice(), 0..) |symbol, j| {
                const invalid_chunk_index = std.math.maxInt(u32);
                const invalid_nested_scope_slot = std.math.maxInt(u32);
                
                symbol_infos[j] = .{
                    .inner_index = j,
                    .kind = @tagName(symbol.kind),
                    .original_name = symbol.original_name,
                    .link = if (symbol.link.isValid()) 
                        try std.fmt.allocPrint(allocator, "Ref[inner={}, src={}, .symbol]", .{symbol.link.innerIndex(), symbol.link.sourceIndex()}) 
                    else null,
                    .use_count_estimate = symbol.use_count_estimate,
                    .chunk_index = if (symbol.chunk_index != invalid_chunk_index) symbol.chunk_index else null,
                    .nested_scope_slot = if (symbol.nested_scope_slot != invalid_nested_scope_slot) symbol.nested_scope_slot else null,
                    .flags = .{
                        .must_not_be_renamed = symbol.must_not_be_renamed,
                        .did_keep_name = symbol.did_keep_name,
                        .has_been_assigned_to = symbol.has_been_assigned_to,
                        .must_start_with_capital_letter_for_jsx = symbol.must_start_with_capital_letter_for_jsx,
                        .private_symbol_must_be_lowered = symbol.private_symbol_must_be_lowered,
                        .remove_overwritten_function_declaration = symbol.remove_overwritten_function_declaration,
                        .import_item_status = @tagName(symbol.import_item_status),
                    },
                    .namespace_alias = if (symbol.namespace_alias) |alias| .{
                        .namespace_ref = try std.fmt.allocPrint(allocator, "Ref[inner={}, src={}, .symbol]", .{alias.namespace_ref.innerIndex(), alias.namespace_ref.sourceIndex()}),
                        .alias = alias.alias,
                    } else null,
                };
            }
            
            by_source[source_idx] = .{
                .source_index = source_idx,
                .symbol_count = symbols.len,
                .symbols = symbol_infos,
            };
        }
        
        const symbol_data = SymbolData{
            .total_symbols = total_symbols,
            .by_source = by_source,
        };
        
        // Build entry points
        const entry_points = ctx.graph.entry_points.slice();
        var entry_point_data = try allocator.alloc(EntryPointData, entry_points.len);
        for (entry_points.items(.source_index), entry_points.items(.output_path), 0..) |source_idx, output_path, i| {
            entry_point_data[i] = .{
                .source_index = source_idx,
                .output_path = output_path.slice(),
            };
        }
        
        // Build imports and exports
        const ast_named_exports = ast_list.items(.named_exports);
        const ast_named_imports = ast_list.items(.named_imports);
        const import_records_list = ast_list.items(.import_records);
        
        var total_exports: usize = 0;
        var total_imports: usize = 0;
        var total_import_records: usize = 0;
        
        // Count totals
        for (ast_named_exports) |exports| {
            total_exports += exports.count();
        }
        for (ast_named_imports) |imports| {
            total_imports += imports.count();
        }
        for (import_records_list) |records| {
            total_import_records += records.len;
        }
        
        // Collect all exports with symbol resolution
        var exports_list = try std.ArrayList(ExportInfo).initCapacity(allocator, @min(total_exports, 1000));
        for (ast_named_exports, 0..) |exports, source_idx| {
            if (exports.count() == 0) continue;
            
            var iter = exports.iterator();
            while (iter.next()) |entry| {
                if (exports_list.items.len >= 1000) break; // Limit for performance
                
                const export_name = entry.key_ptr.*;
                const export_ref = entry.value_ptr.ref;
                
                // Get the actual symbol name
                var original_symbol_name: ?[]const u8 = null;
                if (export_ref.isValid() and source_idx < ctx.graph.symbols.symbols_for_source.len) {
                    const symbols = ctx.graph.symbols.symbols_for_source.at(export_ref.sourceIndex());
                    if (export_ref.innerIndex() < symbols.len) {
                        original_symbol_name = symbols.at(export_ref.innerIndex()).original_name;
                    }
                }
                
                try exports_list.append(.{
                    .source = @intCast(source_idx),
                    .name = export_name,
                    .ref = try std.fmt.allocPrint(allocator, "Ref[inner={}, src={}, .symbol]", .{export_ref.innerIndex(), export_ref.sourceIndex()}),
                    .original_symbol_name = original_symbol_name,
                    .alias_loc = entry.value_ptr.alias_loc.start,
                });
            }
            if (exports_list.items.len >= 1000) break;
        }
        
        // Also track resolved exports if available
        const meta_resolved_exports = meta_list.items(.resolved_exports);
        var resolved_exports_list = try std.ArrayList(ResolvedExportInfo).initCapacity(allocator, 1000);
        for (meta_resolved_exports, 0..) |resolved, source_idx| {
            if (resolved.count() == 0) continue;
            
            var iter = resolved.iterator();
            while (iter.next()) |entry| {
                if (resolved_exports_list.items.len >= 1000) break;
                
                const export_alias = entry.key_ptr.*;
                const export_data = entry.value_ptr.*;
                
                try resolved_exports_list.append(.{
                    .source = @intCast(source_idx),
                    .export_alias = export_alias,
                    .target_source = if (export_data.data.source_index.isValid()) export_data.data.source_index.get() else null,
                    .target_ref = if (export_data.data.import_ref.isValid()) 
                        try std.fmt.allocPrint(allocator, "Ref[inner={}, src={}, .symbol]", .{export_data.data.import_ref.innerIndex(), export_data.data.import_ref.sourceIndex()}) 
                    else null,
                    .potentially_ambiguous = export_data.potentially_ambiguous_export_star_refs.len > 0,
                    .ambiguous_count = export_data.potentially_ambiguous_export_star_refs.len,
                });
            }
            if (resolved_exports_list.items.len >= 1000) break;
        }
        
        // Collect all imports
        var imports_list = try std.ArrayList(ImportInfo).initCapacity(allocator, @min(total_import_records, 1000));
        for (import_records_list, 0..) |records, source_idx| {
            if (records.len == 0) continue;
            
            for (records.slice()[0..@min(records.len, 100)]) |record| {
                if (imports_list.items.len >= 1000) break; // Limit for performance
                
                try imports_list.append(.{
                    .source = @intCast(source_idx),
                    .kind = @tagName(record.kind),
                    .path = record.path.text,
                    .target_source = if (record.source_index.isValid()) record.source_index.get() else null,
                });
            }
            if (imports_list.items.len >= 1000) break;
        }
        
        const imports_exports = ImportsExports{
            .total_exports = total_exports,
            .total_imports = total_imports,
            .total_import_records = total_import_records,
            .exports = exports_list.items,
            .resolved_exports = resolved_exports_list.items,
            .imports = imports_list.items,
        };
        
        // Build chunks data
        var chunks_data: ?[]ChunkData = null;
        if (chunks) |chunk_list| {
            chunks_data = try allocator.alloc(ChunkData, chunk_list.len);
            for (chunk_list, 0..) |chunk, i| {
                // Collect files in chunk
                var files_in_chunk = try allocator.alloc(u32, chunk.files_with_parts_in_chunk.count());
                var file_iter = chunk.files_with_parts_in_chunk.iterator();
                var j: usize = 0;
                while (file_iter.next()) |entry| : (j += 1) {
                    files_in_chunk[j] = entry.key_ptr.*;
                }
                
                // Build cross-chunk imports info
                var cross_chunk_imports = try allocator.alloc(CrossChunkImportInfo, chunk.cross_chunk_imports.len);
                for (chunk.cross_chunk_imports.slice(), 0..) |import, k| {
                    cross_chunk_imports[k] = .{
                        .chunk_index = import.chunk_index,
                        .import_kind = @tagName(import.import_kind),
                    };
                }
                
                // Get full output code from compile results
                var output_snippet: ?[]const u8 = null;
                if (chunk.compile_results_for_chunk.len > 0 and chunk.content == .javascript) {
                    // Concatenate all JavaScript compile results
                    var total_len: usize = 0;
                    for (chunk.compile_results_for_chunk) |result| {
                        if (result == .javascript) {
                            total_len += result.javascript.code().len;
                        }
                    }
                    
                    if (total_len > 0) {
                        var output_buf = try allocator.alloc(u8, total_len);
                        var offset: usize = 0;
                        
                        for (chunk.compile_results_for_chunk) |result| {
                            if (result == .javascript) {
                                const code = result.javascript.code();
                                @memcpy(output_buf[offset..][0..code.len], code);
                                offset += code.len;
                            }
                        }
                        
                        output_snippet = output_buf;
                    }
                }
                
                // TODO: Extract actual source mappings from chunk.output_source_map
                // For now, just use empty mappings
                const source_mappings: []SourceMapping = &.{};
                
                chunks_data.?[i] = .{
                    .index = i,
                    .is_entry_point = chunk.entry_point.is_entry_point,
                    .source_index = chunk.entry_point.source_index,
                    .files_in_chunk = files_in_chunk,
                    .cross_chunk_import_count = chunk.cross_chunk_imports.len,
                    .cross_chunk_imports = cross_chunk_imports,
                    .unique_key = chunk.unique_key,
                    .final_path = chunk.final_rel_path,
                    .content_type = @tagName(chunk.content),
                    .output_snippet = output_snippet,
                    .source_mappings = source_mappings,
                };
            }
        }
        
        // Build dependency graph
        const parts_lists = ast_list.items(.parts);
        var edges = try std.ArrayList(GraphEdge).initCapacity(allocator, 1000);
        
        for (parts_lists, 0..) |parts, source_idx| {
            for (parts.slice(), 0..) |part, part_idx| {
                for (part.dependencies.slice()) |dep| {
                    if (edges.items.len >= 1000) break; // Limit for performance
                    
                    try edges.append(.{
                        .from = .{ .source = @intCast(source_idx), .part = @intCast(part_idx) },
                        .to = .{ .source = dep.source_index.get(), .part = dep.part_index },
                    });
                }
                if (edges.items.len >= 1000) break;
            }
            if (edges.items.len >= 1000) break;
        }
        
        const dependency_graph = DependencyGraph{
            .edges = edges.items,
        };
        
        // Build runtime meta
        const has_css = ctx.parse_graph.css_file_count > 0;
        const has_html = blk: {
            for (loaders) |loader| {
                if (loader == .html) break :blk true;
            }
            break :blk false;
        };
        
        const runtime_meta = RuntimeMeta{
            .memory_usage_mb = 0, // TODO: calculate actual memory usage
            .parse_graph_file_count = ctx.parse_graph.input_files.len,
            .estimated_file_loader_count = ctx.parse_graph.estimated_file_loader_count,
            .has_css = has_css,
            .has_html = has_html,
        };
        
        // Build symbol resolution chains
        const symbol_chains = try buildSymbolChains(allocator, ctx, exports_list.items, resolved_exports_list.items);
        
        return GraphData{
            .stage = stage,
            .timestamp = timestamp,
            .metadata = metadata,
            .files = file_data_list,
            .symbols = symbol_data,
            .entry_points = entry_point_data,
            .imports_and_exports = imports_exports,
            .chunks = chunks_data,
            .dependency_graph = dependency_graph,
            .runtime_meta = runtime_meta,
            .symbol_chains = symbol_chains,
        };
    }
    
    fn buildSymbolChains(
        allocator: std.mem.Allocator, 
        ctx: anytype, 
        exports: []const ExportInfo,
        resolved_exports: []const ResolvedExportInfo,
    ) ![]SymbolChain {
        _ = ctx; // Will use for more detailed symbol lookups
        var chains = std.ArrayList(SymbolChain).init(allocator);
        defer chains.deinit();
        
        // Track each unique export and build its resolution chain
        var seen = std.StringHashMap(void).init(allocator);
        defer seen.deinit();
        
        // Process resolved exports (these have full resolution info)
        for (resolved_exports) |resolved| {
            const key = try std.fmt.allocPrint(allocator, "{s}@{}", .{resolved.export_alias, resolved.source});
            if (seen.contains(key)) continue;
            try seen.put(key, {});
            
            var chain_links = std.ArrayList(ChainLink).init(allocator);
            
            // Add export link
            try chain_links.append(.{
                .file_index = resolved.source,
                .symbol_name = resolved.export_alias,
                .symbol_ref = resolved.target_ref orelse "unresolved",
                .link_type = if (resolved.target_source != null and resolved.target_source.? != resolved.source) "re-export" else "export",
            });
            
            // If it's a re-export, trace to the target
            if (resolved.target_source) |target| {
                if (target != resolved.source) {
                    // Find the original symbol name at target
                    const original_name = resolved.export_alias;
                    if (resolved.target_ref) |ref| {
                        // Parse ref to get indices
                        // Format: "Ref[inner=X, src=Y, .symbol]"
                        // This is a simplified extraction - in production would need proper parsing
                        if (std.mem.indexOf(u8, ref, "inner=")) |inner_start| {
                            if (std.mem.indexOf(u8, ref[inner_start..], ",")) |_| {
                                // Get symbol from graph if possible
                                // For now, just mark it as imported
                                try chain_links.append(.{
                                    .file_index = target,
                                    .symbol_name = original_name,
                                    .symbol_ref = ref,
                                    .link_type = "import",
                                });
                            }
                        }
                    }
                }
            }
            
            try chains.append(.{
                .export_name = resolved.export_alias,
                .source_file = resolved.source,
                .chain = try chain_links.toOwnedSlice(),
                .has_conflicts = resolved.potentially_ambiguous,
                .conflict_sources = if (resolved.potentially_ambiguous) 
                    try allocator.dupe(u32, &[_]u32{resolved.source}) 
                else null,
            });
        }
        
        // Also process direct exports that might not be in resolved
        for (exports) |exp| {
            const key = try std.fmt.allocPrint(allocator, "{s}@{}", .{exp.name, exp.source});
            if (seen.contains(key)) continue;
            try seen.put(key, {});
            
            var chain_links = std.ArrayList(ChainLink).init(allocator);
            try chain_links.append(.{
                .file_index = exp.source,
                .symbol_name = exp.original_symbol_name orelse exp.name,
                .symbol_ref = exp.ref,
                .link_type = "export",
            });
            
            try chains.append(.{
                .export_name = exp.name,
                .source_file = exp.source,
                .chain = try chain_links.toOwnedSlice(),
                .has_conflicts = false,
                .conflict_sources = null,
            });
        }
        
        return try chains.toOwnedSlice();
    }
    
    fn generateVisualizerHTML(allocator: std.mem.Allocator, output_dir: []const u8, timestamp: i64) !void {
        // Generate original graph visualizer
        const graph_html = @embedFile("./graph_visualizer.html");
        const graph_filename = try std.fmt.allocPrint(allocator, "{s}/visualizer_{d}.html", .{
            output_dir,
            timestamp,
        });
        
        const graph_file = try std.fs.cwd().createFile(graph_filename, .{});
        defer graph_file.close();
        try graph_file.writeAll(graph_html);
        
        debug("Graph visualizer HTML written to: {s}", .{graph_filename});
        
        // Generate code flow visualizer
        const flow_html = @embedFile("./code_flow_visualizer.html");
        const flow_filename = try std.fmt.allocPrint(allocator, "{s}/code_flow_{d}.html", .{
            output_dir,
            timestamp,
        });
        
        const flow_file = try std.fs.cwd().createFile(flow_filename, .{});
        defer flow_file.close();
        try flow_file.writeAll(flow_html);
        
        debug("Code flow visualizer HTML written to: {s}", .{flow_filename});
    }
};