pub const StatsCommand = struct {
    const FileStats = struct {
        files: u32 = 0,
        lines: u32 = 0,
        loc: u32 = 0,
        imports: u32 = 0,
        exports: u32 = 0,
        classes: u32 = 0,
        functions: u32 = 0,
        components: u32 = 0,
        avg_size: u32 = 0,
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
        components: u32 = 0,
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
                    !std.mem.startsWith(u8, trimmed, "//"))
                {
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
        dest.classes += src.classes;
        dest.functions += src.functions;
        dest.components += src.components;
        // Recalculate average
        if (dest.files > 0) {
            dest.avg_size = dest.loc / dest.files;
        }
    }

    fn printTable(stats: *const CategoryStats, workspace_package_names: []const []const u8) void {
        _ = workspace_package_names;

        // More compact table like rails stats
        Output.pretty("+{s:-<22}+{s:-<8}+{s:-<8}+{s:-<8}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<7}+{s:-<7}+\n", .{ "-", "-", "-", "-", "-", "-", "-", "-", "-" });
        Output.pretty("| {s:<20} | {s:>6} | {s:>6} | {s:>6} | {s:>7} | {s:>7} | {s:>7} | {s:>5} | {s:>5} |\n", .{ "Name", "Files", "Lines", "LOC", "Classes", "Methods", "Imports", "M/C", "LOC/M" });
        Output.pretty("+{s:-<22}+{s:-<8}+{s:-<8}+{s:-<8}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<7}+{s:-<7}+\n", .{ "-", "-", "-", "-", "-", "-", "-", "-", "-" });

        const printRow = struct {
            fn print(name: []const u8, s: *const FileStats) void {
                const methods_per_class: f32 = if (s.classes > 0) @as(f32, @floatFromInt(s.functions)) / @as(f32, @floatFromInt(s.classes)) else 0;
                const loc_per_method: f32 = if (s.functions > 0) @as(f32, @floatFromInt(s.loc)) / @as(f32, @floatFromInt(s.functions)) else 0;

                Output.pretty("| {s:<20} | {d:>6} | {d:>6} | {d:>6} | {d:>7} | {d:>7} | {d:>7} | {d:>5.1} | {d:>5.0} |\n", .{
                    name,
                    s.files,
                    s.lines,
                    s.loc,
                    s.classes,
                    s.functions,
                    s.imports,
                    methods_per_class,
                    loc_per_method,
                });
            }
        }.print;

        // Language breakdown
        if (stats.typescript.files > 0) {
            printRow("TypeScript", &stats.typescript);
        }

        if (stats.javascript.files > 0) {
            printRow("JavaScript", &stats.javascript);
        }

        // Stylesheets
        if (stats.css.files > 0) {
            var css_stats = stats.css;
            css_stats.classes = 0;
            css_stats.functions = 0;
            css_stats.imports = 0;
            printRow("Stylesheets", &css_stats);
        }

        // Configuration
        if (stats.json.files > 0) {
            var config_stats = stats.json;
            config_stats.classes = 0;
            config_stats.functions = 0;
            config_stats.imports = 0;
            printRow("Configuration", &config_stats);
        }

        // Tests
        if (stats.tests.files > 0) {
            printRow("Tests", &stats.tests);
        }

        // Print separator and totals
        Output.pretty("+{s:-<22}+{s:-<8}+{s:-<8}+{s:-<8}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<7}+{s:-<7}+\n", .{ "-", "-", "-", "-", "-", "-", "-", "-", "-" });

        // Calculate code and test totals separately
        const code_loc = stats.total.loc -| stats.tests.loc -| stats.node_modules.loc;
        const test_loc = stats.tests.loc;

        var code_stats = stats.total;
        code_stats.loc = code_loc;
        code_stats.files = stats.total.files -| stats.tests.files -| stats.node_modules.files;
        printRow("Total Code", &code_stats);

        if (stats.tests.files > 0) {
            printRow("Total Tests", &stats.tests);
        }

        Output.pretty("+{s:-<22}+{s:-<8}+{s:-<8}+{s:-<8}+{s:-<9}+{s:-<9}+{s:-<9}+{s:-<7}+{s:-<7}+\n", .{ "-", "-", "-", "-", "-", "-", "-", "-", "-" });

        // Print code to test ratio at the bottom
        if (code_loc > 0 and test_loc > 0) {
            const ratio = @as(f32, @floatFromInt(test_loc)) / @as(f32, @floatFromInt(code_loc));
            Output.pretty("  Code to Test Ratio: 1:{d:.1}\n", .{ratio});
        }
    }

    fn printSummary(stats: *const CategoryStats, workspace_count: usize, reachable_count: usize, source_size: u64, elapsed_ms: u64) void {
        _ = workspace_count;
        _ = reachable_count;
        _ = source_size;
        _ = elapsed_ms;
        _ = stats;
        // Remove all the extra summary text - table is sufficient
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
        const ast_data = &graph.ast;

        // Get the MultiArrayList slices
        const sources = graph.input_files.items(.source);
        const loaders = graph.input_files.items(.loader);
        const import_records = ast_data.items(.import_records);
        const exports_kind = ast_data.items(.exports_kind);
        const named_exports = ast_data.items(.named_exports);
        const export_star_import_records = ast_data.items(.export_star_import_records);
        const parts_list = ast_data.items(.parts);

        // Process each reachable file
        for (result.reachable_files) |source_index| {
            const index = source_index.get();

            // Comprehensive bounds checking for all arrays
            if (index >= sources.len or index >= loaders.len) continue;

            // Skip the runtime file (index 0)
            if (index == 0) continue;

            const source = sources[index];
            const loader = loaders[index];
            const imports = if (index >= import_records.len) ImportRecord.List{} else import_records[index];
            const export_kind = if (index >= exports_kind.len) .none else exports_kind[index];

            // Only access named_exports and export_stars for non-CSS files
            const is_css = loader == .css;
            const named_exports_count: u32 = if (is_css or index >= named_exports.len) 0 else @intCast(named_exports[index].count());
            const export_stars_count: u32 = if (is_css or index >= export_star_import_records.len) 0 else @intCast(export_star_import_records[index].len);

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
            const export_count: u32 = named_exports_count + export_stars_count;

            // Count classes and functions using the parsed AST (for non-CSS files)
            var class_count: u32 = 0;
            var function_count: u32 = 0;

            // Only access parts for non-CSS files
            // When parts.len == 0, it means the AST is invalid/failed to parse
            // Skip files that failed to parse or have empty ASTs
            if (!is_css and index < parts_list.len and parts_list[index].len > 0) {
                // Try to safely access the parts
                const parts = parts_list[index].slice();

                // Iterate through all parts in the file
                for (parts) |part| {
                    // Iterate through all statements in the part
                    for (part.stmts) |stmt| {
                        switch (stmt.data) {
                            // Direct function declarations
                            .s_function => {
                                function_count += 1;
                            },
                            // Direct class declarations
                            .s_class => {
                                class_count += 1;
                            },
                            // Local variable declarations (const/let/var)
                            .s_local => |local| {
                                // Check each declaration's value
                                for (local.decls.slice()) |decl| {
                                    if (decl.value) |value_expr| {
                                        switch (value_expr.data) {
                                            .e_function => function_count += 1,
                                            .e_arrow => function_count += 1,
                                            .e_class => class_count += 1,
                                            else => {},
                                        }
                                    }
                                }
                            },
                            // Expression statements (e.g., anonymous functions)
                            .s_expr => |expr_stmt| {
                                switch (expr_stmt.value.data) {
                                    .e_function => function_count += 1,
                                    .e_arrow => function_count += 1,
                                    .e_class => class_count += 1,
                                    // Check for assignments that might contain functions/classes
                                    .e_binary => |binary| {
                                        if (binary.op == .bin_assign) {
                                            switch (binary.right.data) {
                                                .e_function => function_count += 1,
                                                .e_arrow => function_count += 1,
                                                .e_class => class_count += 1,
                                                else => {},
                                            }
                                        }
                                    },
                                    else => {},
                                }
                            },
                            // Export statements might also contain functions/classes
                            .s_export_default => |export_default| {
                                switch (export_default.value) {
                                    .stmt => |export_stmt| {
                                        switch (export_stmt.data) {
                                            .s_function => function_count += 1,
                                            .s_class => class_count += 1,
                                            else => {},
                                        }
                                    },
                                    .expr => |export_expr| {
                                        switch (export_expr.data) {
                                            .e_function => function_count += 1,
                                            .e_arrow => function_count += 1,
                                            .e_class => class_count += 1,
                                            else => {},
                                        }
                                    },
                                }
                            },
                            else => {},
                        }
                    }
                }
            }

            var file_stats = FileStats{
                .files = 1,
                .lines = line_stats.lines,
                .loc = line_stats.loc,
                .imports = import_count,
                .exports = export_count,
                .classes = class_count,
                .functions = function_count,
                .components = 0,
                .avg_size = line_stats.loc,
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

            // No need to track components

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

        // Set up the bundler context to be as permissive as possible
        ctx.args.target = .bun; // Use bun target to resolve test files and Bun-specific imports
        ctx.args.packages = .bundle; // Bundle mode to analyze all files
        ctx.args.ignore_dce_annotations = true; // Ignore DCE annotations that might cause errors

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

        // No "Analyzing X files..." message - just start processing

        // Suppress ALL bundler errors and warnings - we only care about collecting stats
        this_transpiler.log.level = .err; // Only show errors (highest level)
        this_transpiler.log.msgs.clearRetainingCapacity();

        _ = BundleV2.generateFromCLI(
            &this_transpiler,
            allocator,
            bun.jsc.AnyEventLoop.init(allocator),
            false, // no hot reload
            &reachable_file_count,
            &minify_duration,
            &source_code_size,
            &scanner,
        ) catch {
            // Silently ignore ALL bundler errors - we're just collecting stats
            // This includes BuildFailed, module resolution errors, syntax errors, etc.
            // Clear any logged errors so they don't get printed
            this_transpiler.log.msgs.clearRetainingCapacity();
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

const options = @import("../options.zig");
const std = @import("std");
const transpiler = @import("../transpiler.zig");
const BundleV2 = @import("../bundler/bundle_v2.zig").BundleV2;
const Command = @import("../cli.zig").Command;
const ImportRecord = @import("../import_record.zig").ImportRecord;

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const ast = bun.ast;
const strings = bun.strings;
