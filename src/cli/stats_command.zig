const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const Command = @import("../cli.zig").Command;
const strings = bun.strings;
const logger = bun.logger;
const options = @import("../options.zig");
const transpiler = @import("../transpiler.zig");
const BundleV2 = @import("../bundler/bundle_v2.zig").BundleV2;
const Graph = @import("../bundler/Graph.zig");
const BundledAst = @import("../ast/BundledAst.zig");
const ImportRecord = @import("../import_record.zig").ImportRecord;

pub const StatsCommand = struct {
    const FileStats = struct {
        files: u32 = 0,
        lines: u32 = 0,
        loc: u32 = 0,
        imports: u32 = 0,
        exports: u32 = 0,
    };

    const CategoryStats = struct {
        typescript: FileStats = .{},
        javascript: FileStats = .{},
        commonjs: FileStats = .{},
        esmodules: FileStats = .{},
        css: FileStats = .{},
        json: FileStats = .{},
        tests: FileStats = .{},
        node_modules: FileStats = .{},
        workspace_packages: std.StringHashMap(FileStats),
        total: FileStats = .{},
    };

    const StatsContext = struct {
        stats: CategoryStats,
        allocator: std.mem.Allocator,
        workspace_packages: [][]const u8,
    };

    fn countLinesAndLOC(content: []const u8) struct { lines: u32, loc: u32 } {
        var lines: u32 = if (content.len > 0) 1 else 0;
        var loc: u32 = 0;
        
        var i: usize = 0;
        var line_start: usize = 0;
        var in_block_comment = false;
        
        while (i < content.len) : (i += 1) {
            if (content[i] == '\n') {
                const line = content[line_start..i];
                const trimmed = std.mem.trim(u8, line, " \t\r");
                
                // Check for block comments
                if (std.mem.indexOf(u8, trimmed, "/*") != null) {
                    in_block_comment = true;
                }
                if (std.mem.indexOf(u8, trimmed, "*/") != null) {
                    in_block_comment = false;
                } else if (trimmed.len > 0 and 
                          !in_block_comment and
                          !std.mem.startsWith(u8, trimmed, "//")) {
                    loc += 1;
                }
                
                lines += 1;
                line_start = i + 1;
            }
        }
        
        // Handle last line without newline
        if (line_start < content.len) {
            const line = content[line_start..];
            const trimmed = std.mem.trim(u8, line, " \t\r");
            if (trimmed.len > 0 and !in_block_comment and !std.mem.startsWith(u8, trimmed, "//")) {
                loc += 1;
            }
        }
        
        return .{ .lines = lines, .loc = loc };
    }

    fn addStats(dest: *FileStats, src: *const FileStats) void {
        dest.files += src.files;
        dest.lines += src.lines;
        dest.loc += src.loc;
        dest.imports += src.imports;
        dest.exports += src.exports;
    }

    fn printTable(stats: *const CategoryStats, workspace_package_names: []const []const u8) void {
        _ = workspace_package_names; // TODO: implement workspace package stats
        
        // Print header
        Output.pretty("+{s:-<18}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<9}+\n", .{ 
            "-", "-", "-", "-", "-", "-" 
        });
        Output.pretty("| {s:<16} | {s:>7} | {s:>7} | {s:>7} | {s:>7} | {s:>7} |\n", .{
            "Name", "Files", "Lines", "LOC", "Imports", "Exports"
        });
        Output.pretty("+{s:-<18}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<9}+\n", .{ 
            "-", "-", "-", "-", "-", "-" 
        });
        
        // Print rows
        if (stats.typescript.files > 0) {
            Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {d:>7} | {d:>7} |\n", .{
                "TypeScript", stats.typescript.files, stats.typescript.lines, 
                stats.typescript.loc, stats.typescript.imports, stats.typescript.exports
            });
        }
        
        if (stats.javascript.files > 0) {
            Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {d:>7} | {d:>7} |\n", .{
                "JavaScript", stats.javascript.files, stats.javascript.lines,
                stats.javascript.loc, stats.javascript.imports, stats.javascript.exports
            });
        }
        
        if (stats.commonjs.files > 0) {
            Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {d:>7} | {d:>7} |\n", .{
                "CommonJS modules", stats.commonjs.files, stats.commonjs.lines,
                stats.commonjs.loc, stats.commonjs.imports, stats.commonjs.exports
            });
        }
        
        if (stats.esmodules.files > 0) {
            Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {d:>7} | {d:>7} |\n", .{
                "ES modules", stats.esmodules.files, stats.esmodules.lines,
                stats.esmodules.loc, stats.esmodules.imports, stats.esmodules.exports
            });
        }
        
        if (stats.css.files > 0) {
            Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {s:>7} | {s:>7} |\n", .{
                "CSS", stats.css.files, stats.css.lines, stats.css.loc, "-", "-"
            });
        }
        
        if (stats.json.files > 0) {
            Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {s:>7} | {s:>7} |\n", .{
                "JSON", stats.json.files, stats.json.lines, stats.json.loc, "-", "-"
            });
        }
        
        if (stats.tests.files > 0) {
            Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {d:>7} | {d:>7} |\n", .{
                "Tests", stats.tests.files, stats.tests.lines,
                stats.tests.loc, stats.tests.imports, stats.tests.exports
            });
        }
        
        if (stats.node_modules.files > 0) {
            Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {s:>7} | {s:>7} |\n", .{
                "node_modules", stats.node_modules.files, stats.node_modules.lines,
                stats.node_modules.loc, "-", "-"
            });
        }
        
        // Print total
        Output.pretty("+{s:-<18}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<9}+\n", .{ 
            "-", "-", "-", "-", "-", "-" 
        });
        Output.pretty("| {s:<16} | {d:>7} | {d:>7} | {d:>7} | {d:>7} | {d:>7} |\n", .{
            "Total", stats.total.files, stats.total.lines,
            stats.total.loc, stats.total.imports, stats.total.exports
        });
        Output.pretty("+{s:-<18}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<9}+\n", .{ 
            "-", "-", "-", "-", "-", "-" 
        });
    }

    fn printSummary(stats: *const CategoryStats, workspace_count: usize, reachable_count: usize, source_size: u64, elapsed_ms: u64) void {
        const code_loc = stats.total.loc -| stats.node_modules.loc -| stats.tests.loc;
        const test_loc = stats.tests.loc;
        const deps_loc = stats.node_modules.loc;
        
        Output.pretty("\n", .{});
        
        // Speed flex message
        Output.pretty("<green>✓<r> Analyzed <b>{d}<r> LOC across <b>{d}<r> files in <cyan>{d}ms<r>\n", .{
            stats.total.loc,
            stats.total.files,
            elapsed_ms,
        });
        
        Output.pretty("\n", .{});
        Output.pretty("Files analyzed: {d}\n", .{reachable_count});
        Output.pretty("Code LOC: {d}\n", .{code_loc});
        Output.pretty("Test LOC: {d}\n", .{test_loc});
        Output.pretty("Deps LOC: {d}\n", .{deps_loc});
        
        if (code_loc > 0 and test_loc > 0) {
            const ratio = @as(f32, @floatFromInt(test_loc)) / @as(f32, @floatFromInt(code_loc));
            Output.pretty("Code to Test Ratio: 1 : {d:.1}\n", .{ratio});
        }
        
        Output.pretty("Workspace Packages: {d}\n", .{workspace_count});
        
        // Use actual source size from bundler
        if (source_size > 0) {
            const size_mb = @as(f32, @floatFromInt(source_size)) / 1024.0 / 1024.0;
            Output.pretty("Total Source Size: {d:.1} MB\n", .{size_mb});
        }
    }

    fn getWorkspacePackages(allocator: std.mem.Allocator) ![][]const u8 {
        // For now, return empty list
        // TODO: Parse package.json properly
        return allocator.alloc([]const u8, 0) catch &.{};
    }

    fn onStatsCollect(
        ctx_: *anyopaque,
        result: *BundleV2.DependenciesScanner.Result,
    ) anyerror!void {
        const ctx = @as(*StatsContext, @ptrCast(@alignCast(ctx_)));
        const bundle = result.bundle_v2;
        
        // Access the parsed graph data
        const graph = &bundle.graph;
        const ast = &graph.ast;
        
        // Get the MultiArrayList slices
        const sources = graph.input_files.items(.source);
        const loaders = graph.input_files.items(.loader);
        const import_records = ast.items(.import_records);
        const exports_kind = ast.items(.exports_kind);
        const named_exports = ast.items(.named_exports);
        const export_star_import_records = ast.items(.export_star_import_records);
        
        // Process each reachable file
        for (result.reachable_files) |source_index| {
            const index = source_index.get();
            if (index >= sources.len) continue;
            
            // Skip the runtime file (index 0)
            if (index == 0) continue;
            
            const source = sources[index];
            const loader = loaders[index];
            const imports = if (index < import_records.len) import_records[index] else ImportRecord.List{};
            const export_kind = if (index < exports_kind.len) exports_kind[index] else .none;
            const named_export_map = if (index < named_exports.len) named_exports[index] else bun.StringArrayHashMapUnmanaged(bun.ast.NamedExport){};
            const export_stars = if (index < export_star_import_records.len) export_star_import_records[index] else &[_]u32{};
            
            // Get source content and path
            const source_contents = source.contents;
            const path_text = source.path.text;
            
            // Skip virtual files and bun: files
            if (strings.hasPrefixComptime(path_text, "bun:") or 
                strings.hasPrefixComptime(path_text, "node:") or
                strings.hasPrefixComptime(path_text, "<") or
                strings.eqlComptime(path_text, "bun")) continue;
            
            // Count lines and LOC
            const line_stats = countLinesAndLOC(source_contents);
            
            // Categorize file
            const is_test = std.mem.indexOf(u8, path_text, ".test.") != null or 
                           std.mem.indexOf(u8, path_text, ".spec.") != null or
                           std.mem.indexOf(u8, path_text, "__tests__") != null;
            const is_node_modules = std.mem.indexOf(u8, path_text, "node_modules") != null;
            
            // Determine workspace package
            var workspace_pkg: ?[]const u8 = null;
            for (ctx.workspace_packages) |pkg_name| {
                if (std.mem.indexOf(u8, path_text, pkg_name) != null and !is_node_modules) {
                    workspace_pkg = pkg_name;
                    break;
                }
            }
            
            // Count imports and exports
            const import_count: u32 = @intCast(imports.len);
            const export_count: u32 = @intCast(named_export_map.count() + export_stars.len);
            
            var file_stats = FileStats{
                .files = 1,
                .lines = line_stats.lines,
                .loc = line_stats.loc,
                .imports = import_count,
                .exports = export_count,
            };
            
            // Determine module type from exports_kind
            const is_commonjs = export_kind == .cjs;
            const is_esm = export_kind == .esm;
            
            // Update appropriate category based on loader type
            switch (loader) {
                .tsx, .ts => {
                    addStats(&ctx.stats.typescript, &file_stats);
                    if (is_commonjs) {
                        addStats(&ctx.stats.commonjs, &file_stats);
                    } else if (is_esm) {
                        addStats(&ctx.stats.esmodules, &file_stats);
                    }
                },
                .jsx, .js => {
                    addStats(&ctx.stats.javascript, &file_stats);
                    if (is_commonjs) {
                        addStats(&ctx.stats.commonjs, &file_stats);
                    } else if (is_esm) {
                        addStats(&ctx.stats.esmodules, &file_stats);
                    }
                },
                .css => {
                    file_stats.imports = 0;
                    file_stats.exports = 0;
                    addStats(&ctx.stats.css, &file_stats);
                },
                .json => {
                    file_stats.imports = 0;
                    file_stats.exports = 0;
                    addStats(&ctx.stats.json, &file_stats);
                },
                else => {},
            }
            
            // Add to category totals
            if (is_node_modules) {
                file_stats.imports = 0;
                file_stats.exports = 0;
                addStats(&ctx.stats.node_modules, &file_stats);
            } else if (is_test) {
                addStats(&ctx.stats.tests, &file_stats);
            } else if (workspace_pkg) |pkg| {
                if (ctx.stats.workspace_packages.getPtr(pkg)) |pkg_stats| {
                    addStats(pkg_stats, &file_stats);
                }
            }
            
            // Always add to total
            addStats(&ctx.stats.total, &file_stats);
        }
    }

    fn findAllJSFiles(allocator: std.mem.Allocator, dir_path: []const u8) ![][]const u8 {
        var files = std.ArrayList([]const u8).init(allocator);
        errdefer {
            for (files.items) |file| {
                allocator.free(file);
            }
            files.deinit();
        }
        
        // Simple recursive directory walker
        var stack = std.ArrayList([]const u8).init(allocator);
        defer {
            for (stack.items) |item| {
                allocator.free(item);
            }
            stack.deinit();
        }
        
        try stack.append(try allocator.dupe(u8, dir_path));
        
        while (stack.items.len > 0) {
            const current_dir = stack.pop() orelse break;
            defer allocator.free(current_dir);
            
            // Skip node_modules and hidden directories
            if (std.mem.indexOf(u8, current_dir, "node_modules") != null or
                std.mem.indexOf(u8, current_dir, "/.git") != null or
                std.mem.indexOf(u8, current_dir, "/.next") != null) continue;
            
            var dir = std.fs.openDirAbsolute(current_dir, .{ .iterate = true }) catch |err| {
                if (err == error.NotDir or err == error.FileNotFound) continue;
                return err;
            };
            defer dir.close();
            
            var iter = dir.iterate();
            while (try iter.next()) |entry| {
                const full_path = try std.fs.path.join(allocator, &.{ current_dir, entry.name });
                
                switch (entry.kind) {
                    .directory => {
                        // Add directory to stack for processing
                        try stack.append(full_path);
                    },
                    .file => {
                        // Check if it's a JS/TS/JSON/CSS file
                        const ext = std.fs.path.extension(entry.name);
                        const is_js_file = std.mem.eql(u8, ext, ".js") or
                                          std.mem.eql(u8, ext, ".jsx") or
                                          std.mem.eql(u8, ext, ".ts") or
                                          std.mem.eql(u8, ext, ".tsx") or
                                          std.mem.eql(u8, ext, ".mjs") or
                                          std.mem.eql(u8, ext, ".cjs") or
                                          std.mem.eql(u8, ext, ".mts") or
                                          std.mem.eql(u8, ext, ".cts") or
                                          std.mem.eql(u8, ext, ".json") or
                                          std.mem.eql(u8, ext, ".css");
                        
                        if (is_js_file) {
                            try files.append(full_path);
                        } else {
                            allocator.free(full_path);
                        }
                    },
                    else => {
                        allocator.free(full_path);
                    },
                }
            }
        }
        
        return files.toOwnedSlice();
    }
    
    pub fn exec(ctx: Command.Context) !void {
        Global.configureAllocator(.{ .long_running = true });
        const allocator = ctx.allocator;
        const log = ctx.log;
        
        const start_time = std.time.nanoTimestamp();
        
        // Set up the bundler context similar to build command
        ctx.args.target = .browser; // Default target for analysis
        ctx.args.packages = .bundle; // Bundle mode to analyze all files
        
        // Get workspace packages
        const workspace_packages = try getWorkspacePackages(allocator);
        defer {
            for (workspace_packages) |pkg| {
                allocator.free(pkg);
            }
            allocator.free(workspace_packages);
        }
        
        // Initialize stats context
        var stats_ctx = StatsContext{
            .stats = CategoryStats{
                .workspace_packages = std.StringHashMap(FileStats).init(allocator),
            },
            .allocator = allocator,
            .workspace_packages = workspace_packages,
        };
        defer stats_ctx.stats.workspace_packages.deinit();
        
        // Initialize workspace package stats
        for (workspace_packages) |pkg| {
            try stats_ctx.stats.workspace_packages.put(pkg, FileStats{});
        }
        
        // Set up transpiler
        var this_transpiler = try transpiler.Transpiler.init(allocator, log, ctx.args, null);
        
        // Handle entry points based on user input
        var allocated_entry_points: ?[][]const u8 = null;
        defer if (allocated_entry_points) |entry_points| {
            for (entry_points) |entry| {
                allocator.free(entry);
            }
            allocator.free(entry_points);
        };
        
        if (ctx.args.entry_points.len > 0) {
            // User provided entry points - use them directly
            this_transpiler.options.entry_points = ctx.args.entry_points;
        } else {
            // No entry points provided - walk directory to find all JS/TS files
            const cwd = try std.process.getCwdAlloc(allocator);
            defer allocator.free(cwd);
            
            allocated_entry_points = try findAllJSFiles(allocator, cwd);
            this_transpiler.options.entry_points = allocated_entry_points.?;
        }
        
        this_transpiler.options.output_dir = ""; // No output needed
        this_transpiler.options.write = false; // Don't write files
        this_transpiler.configureLinker();
        try this_transpiler.configureDefines();
        
        // Set up the dependencies scanner to collect stats
        var scanner = BundleV2.DependenciesScanner{
            .ctx = &stats_ctx,
            .entry_points = this_transpiler.options.entry_points,
            .onFetch = onStatsCollect,
        };
        
        // Run the bundler to parse all files
        var reachable_file_count: usize = 0;
        var minify_duration: u64 = 0;
        var source_code_size: u64 = 0;
        
        if (this_transpiler.options.entry_points.len == 0) {
            Output.prettyErrorln("<red>error<r>: No files found to analyze", .{});
            return;
        }
        
        Output.pretty("Analyzing {d} files...\n", .{this_transpiler.options.entry_points.len});
        Output.flush();
        
        _ = BundleV2.generateFromCLI(
            &this_transpiler,
            allocator,
            bun.jsc.AnyEventLoop.init(allocator),
            false, // no hot reload
            &reachable_file_count,
            &minify_duration,
            &source_code_size,
            &scanner,
        ) catch |err| {
            // It's okay if bundling fails, we still collected stats
            if (err != error.BuildFailed) {
                return err;
            }
        };
        
        // Calculate elapsed time
        const end_time = std.time.nanoTimestamp();
        const elapsed_ns = @as(u64, @intCast(end_time - start_time));
        const elapsed_ms = elapsed_ns / std.time.ns_per_ms;
        
        // Print results
        printTable(&stats_ctx.stats, workspace_packages);
        printSummary(&stats_ctx.stats, workspace_packages.len, reachable_file_count, source_code_size, elapsed_ms);
    }
};