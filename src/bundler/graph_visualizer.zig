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
        
        return .all; // Default to all if set but not recognized
    }

    pub const DumpStage = enum {
        none,
        after_scan,
        after_compute, 
        after_chunks,
        after_link,
        all,
    };

    pub fn dumpGraphState(
        ctx: *bundler.LinkerContext,
        stage: []const u8,
        chunks: ?[]const Chunk,
    ) !void {
        if (!shouldDump()) return;
        
        const dump_stage = getDumpStage();
        const should_dump_now = switch (dump_stage) {
            .none => false,
            .all => true,
            .after_scan => strings.eqlComptime(stage, "after_scan"),
            .after_compute => strings.eqlComptime(stage, "after_compute"),
            .after_chunks => strings.eqlComptime(stage, "after_chunks"),
            .after_link => strings.eqlComptime(stage, "after_link"),
        };
        
        if (!should_dump_now) return;
        
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
        imports: []ImportInfo,
    };
    
    const ExportInfo = struct {
        source: u32,
        name: []const u8,
        ref: []const u8,
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
                        
                        parts_data.?[j] = .{
                            .index = j,
                            .stmt_count = part.stmts.len,
                            .import_record_count = part.import_record_indices.len,
                            .declared_symbol_count = part.declared_symbols.entries.len,
                            .can_be_removed_if_unused = part.can_be_removed_if_unused,
                            .force_tree_shaking = part.force_tree_shaking,
                            .symbol_uses = symbol_uses,
                            .dependencies = deps,
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
            };
        }
        
        // Build symbol data
        var by_source = try allocator.alloc(SourceSymbols, ctx.graph.symbols.symbols_for_source.len);
        var total_symbols: usize = 0;
        for (ctx.graph.symbols.symbols_for_source.slice(), 0..) |symbols, source_idx| {
            total_symbols += symbols.len;
            
            var symbol_infos = try allocator.alloc(SymbolInfo, symbols.len);
            for (symbols.slice(), 0..) |symbol, j| {
                symbol_infos[j] = .{
                    .inner_index = j,
                    .kind = @tagName(symbol.kind),
                    .original_name = symbol.original_name,
                    .link = if (symbol.link.isValid()) 
                        try std.fmt.allocPrint(allocator, "{}", .{symbol.link}) 
                    else null,
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
        
        // Collect all exports
        var exports_list = try std.ArrayList(ExportInfo).initCapacity(allocator, @min(total_exports, 1000));
        for (ast_named_exports, 0..) |exports, source_idx| {
            if (exports.count() == 0) continue;
            
            var iter = exports.iterator();
            while (iter.next()) |entry| {
                if (exports_list.items.len >= 1000) break; // Limit for performance
                
                try exports_list.append(.{
                    .source = @intCast(source_idx),
                    .name = entry.key_ptr.*,
                    .ref = try std.fmt.allocPrint(allocator, "{}", .{entry.value_ptr.ref}),
                });
            }
            if (exports_list.items.len >= 1000) break;
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
                
                chunks_data.?[i] = .{
                    .index = i,
                    .is_entry_point = chunk.entry_point.is_entry_point,
                    .source_index = chunk.entry_point.source_index,
                    .files_in_chunk = files_in_chunk,
                    .cross_chunk_import_count = chunk.cross_chunk_imports.len,
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
        };
    }
    
    fn generateVisualizerHTML(allocator: std.mem.Allocator, output_dir: []const u8, timestamp: i64) !void {
        const html_content = @embedFile("./graph_visualizer.html");
        
        const filename = try std.fmt.allocPrint(allocator, "{s}/visualizer_{d}.html", .{
            output_dir,
            timestamp,
        });
        
        const file = try std.fs.cwd().createFile(filename, .{});
        defer file.close();
        try file.writeAll(html_content);
        
        debug("Visualizer HTML written to: {s}", .{filename});
    }
};