const bun = @import("bun");
const std = @import("std");
const LineOffsetTable = bun.sourcemap.LineOffsetTable;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const LinesHits = @import("../baby_list.zig").BabyList(u32);
const Output = bun.Output;
const prettyFmt = Output.prettyFmt;

/// Our code coverage currently only deals with lines of code, not statements or branches.
/// JSC doesn't expose function names in their coverage data, so we don't include that either :(.
/// Since we only need to store line numbers, our job gets simpler
///
/// We can use two bitsets to store code coverage data for a given file
/// 1. executable_lines
/// 2. lines_which_have_executed
///
/// Not all lines of code are executable. Comments, whitespace, empty lines, etc. are not executable.
/// It's not a problem for anyone if comments, whitespace, empty lines etc are not executed, so those should always be omitted from coverage reports
///
/// We use two bitsets since the typical size will be decently small,
/// bitsets are simple and bitsets are relatively fast to construct and query
///
pub const Report = struct {
    source_url: bun.JSC.ZigString.Slice,
    executable_lines: Bitset,
    lines_which_have_executed: Bitset,
    line_hits: LinesHits = .{},
    functions: std.ArrayListUnmanaged(Block),
    functions_which_have_executed: Bitset,
    stmts_which_have_executed: Bitset,
    stmts: std.ArrayListUnmanaged(Block),
    total_lines: u32 = 0,

    pub fn linesCoverageFraction(this: *const Report) f64 {
        var intersected = this.executable_lines.clone(bun.default_allocator) catch bun.outOfMemory();
        defer intersected.deinit(bun.default_allocator);
        intersected.setIntersection(this.lines_which_have_executed);

        const total_count: f64 = @floatFromInt(this.executable_lines.count());
        if (total_count == 0) {
            return 1.0;
        }

        const intersected_count: f64 = @floatFromInt(intersected.count());

        return (intersected_count / total_count);
    }

    pub fn stmtsCoverageFraction(this: *const Report) f64 {
        const total_count: f64 = @floatFromInt(this.stmts.items.len);

        if (total_count == 0) {
            return 1.0;
        }

        return ((@as(f64, @floatFromInt(this.stmts_which_have_executed.count()))) / (total_count));
    }

    pub fn functionCoverageFraction(this: *const Report) f64 {
        const total_count: f64 = @floatFromInt(this.functions.items.len);
        if (total_count == 0) {
            return 1.0;
        }
        return (@as(f64, @floatFromInt(this.functions_which_have_executed.count())) / total_count);
    }

    pub const Text = struct {
        pub fn writeFormatWithValues(
            filename: []const u8,
            max_filename_length: usize,
            vals: Fraction,
            failing: Fraction,
            failed: bool,
            writer: anytype,
            indent_name: bool,
            comptime enable_colors: bool,
        ) !void {
            if (comptime enable_colors) {
                if (failed) {
                    try writer.writeAll(comptime prettyFmt("<r><b><red>", true));
                } else {
                    try writer.writeAll(comptime prettyFmt("<r><b><green>", true));
                }
            }

            if (indent_name) {
                try writer.writeAll(" ");
            }

            try writer.writeAll(filename);
            try writer.writeByteNTimes(' ', (max_filename_length - filename.len + @as(usize, @intFromBool(!indent_name))));
            try writer.writeAll(comptime prettyFmt("<r><d> | <r>", enable_colors));

            if (comptime enable_colors) {
                if (vals.functions < failing.functions) {
                    try writer.writeAll(comptime prettyFmt("<b><red>", true));
                } else {
                    try writer.writeAll(comptime prettyFmt("<b><green>", true));
                }
            }

            try writer.print("{d: >7.2}", .{vals.functions * 100.0});
            // try writer.writeAll(comptime prettyFmt("<r><d> | <r>", enable_colors));
            // if (comptime enable_colors) {
            //     // if (vals.stmts < failing.stmts) {
            //     try writer.writeAll(comptime prettyFmt("<d>", true));
            //     // } else {
            //     //     try writer.writeAll(comptime prettyFmt("<d>", true));
            //     // }
            // }
            // try writer.print("{d: >8.2}", .{vals.stmts * 100.0});
            try writer.writeAll(comptime prettyFmt("<r><d> | <r>", enable_colors));

            if (comptime enable_colors) {
                if (vals.lines < failing.lines) {
                    try writer.writeAll(comptime prettyFmt("<b><red>", true));
                } else {
                    try writer.writeAll(comptime prettyFmt("<b><green>", true));
                }
            }

            try writer.print("{d: >7.2}", .{vals.lines * 100.0});
        }

        pub fn writeFormat(
            report: *const Report,
            max_filename_length: usize,
            fraction: *Fraction,
            base_path: []const u8,
            writer: anytype,
            comptime enable_colors: bool,
        ) !void {
            const failing = fraction.*;
            const fns = report.functionCoverageFraction();
            const lines = report.linesCoverageFraction();
            const stmts = report.stmtsCoverageFraction();
            fraction.functions = fns;
            fraction.lines = lines;
            fraction.stmts = stmts;

            const failed = fns < failing.functions or lines < failing.lines; // or stmts < failing.stmts;
            fraction.failing = failed;

            var filename = report.source_url.slice();
            if (base_path.len > 0) {
                filename = bun.path.relative(base_path, filename);
            }

            try writeFormatWithValues(
                filename,
                max_filename_length,
                fraction.*,
                failing,
                failed,
                writer,
                true,
                enable_colors,
            );

            try writer.writeAll(comptime prettyFmt("<r><d> | <r>", enable_colors));

            var executable_lines_that_havent_been_executed = report.lines_which_have_executed.clone(bun.default_allocator) catch bun.outOfMemory();
            defer executable_lines_that_havent_been_executed.deinit(bun.default_allocator);
            executable_lines_that_havent_been_executed.toggleAll();

            // This sets statements in executed scopes
            executable_lines_that_havent_been_executed.setIntersection(report.executable_lines);

            var iter = executable_lines_that_havent_been_executed.iterator(.{});
            var start_of_line_range: usize = 0;
            var prev_line: usize = 0;
            var is_first = true;

            while (iter.next()) |next_line| {
                if (next_line == (prev_line + 1)) {
                    prev_line = next_line;
                    continue;
                } else if (is_first and start_of_line_range == 0 and prev_line == 0) {
                    start_of_line_range = next_line;
                    prev_line = next_line;
                    continue;
                }

                if (is_first) {
                    is_first = false;
                } else {
                    try writer.print(comptime prettyFmt("<r><d>,<r>", enable_colors), .{});
                }

                if (start_of_line_range == prev_line) {
                    try writer.print(comptime prettyFmt("<red>{d}", enable_colors), .{start_of_line_range + 1});
                } else {
                    try writer.print(comptime prettyFmt("<red>{d}-{d}", enable_colors), .{ start_of_line_range + 1, prev_line + 1 });
                }

                prev_line = next_line;
                start_of_line_range = next_line;
            }

            if (prev_line != start_of_line_range) {
                if (is_first) {
                    is_first = false;
                } else {
                    try writer.print(comptime prettyFmt("<r><d>,<r>", enable_colors), .{});
                }

                if (start_of_line_range == prev_line) {
                    try writer.print(comptime prettyFmt("<red>{d}", enable_colors), .{start_of_line_range + 1});
                } else {
                    try writer.print(comptime prettyFmt("<red>{d}-{d}", enable_colors), .{ start_of_line_range + 1, prev_line + 1 });
                }
            }
        }
    };

    pub const Lcov = struct {
        pub fn writeFormat(
            report: *const Report,
            base_path: []const u8,
            writer: anytype,
        ) !void {
            var filename = report.source_url.slice();
            if (base_path.len > 0) {
                filename = bun.path.relative(base_path, filename);
            }

            // TN: test name
            // Empty value appears fine. For example, `TN:`.
            try writer.writeAll("TN:\n");

            // SF: Source File path
            // For example, `SF:path/to/source.ts`
            try writer.print("SF:{s}\n", .{filename});

            // ** Per-function coverage not supported yet, since JSC does not support function names yet. **
            // FN: line number,function name

            // FNF: functions found
            try writer.print("FNF:{d}\n", .{report.functions.items.len});

            // FNH: functions hit
            try writer.print("FNH:{d}\n", .{report.functions_which_have_executed.count()});

            // ** Track all executable lines **
            // Executable lines that were not hit should be marked as 0
            var executable_lines = report.executable_lines.clone(bun.default_allocator) catch bun.outOfMemory();
            defer executable_lines.deinit(bun.default_allocator);
            var iter = executable_lines.iterator(.{});

            // ** Branch coverage not supported yet, since JSC does not support those yet. ** //
            // BRDA: line, block, (expressions,count)+
            // BRF: branches found
            // BRH: branches hit
            const line_hits = report.line_hits.slice();
            while (iter.next()) |line| {
                // DA: line number, hit count
                try writer.print("DA:{d},{d}\n", .{ line + 1, line_hits[line] });
            }

            // LF: lines found
            try writer.print("LF:{d}\n", .{report.total_lines});

            // LH: lines hit
            try writer.print("LH:{d}\n", .{report.lines_which_have_executed.count()});

            try writer.writeAll("end_of_record\n");
        }
    };

    pub const Html = struct {
        pub fn writeIndexFile(
            reports: []const *const Report,
            base_path: []const u8,
            total_fraction: Fraction,
            writer: anytype,
        ) !void {
            try writer.writeAll(
                \\<!DOCTYPE html>
                \\<html lang="en">
                \\<head>
                \\    <meta charset="UTF-8">
                \\    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                \\    <title>Code Coverage Report</title>
                \\    <style>
                \\        * { margin: 0; padding: 0; box-sizing: border-box; }
                \\        body { 
                \\            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; 
                \\            background: #f8f9fa; color: #212529; line-height: 1.6; 
                \\        }
                \\        .header { 
                \\            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                \\            color: white; padding: 2rem 0; text-align: center; 
                \\        }
                \\        .header h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
                \\        .header p { font-size: 1.1rem; opacity: 0.9; }
                \\        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
                \\        .summary { 
                \\            background: white; border-radius: 12px; padding: 2rem; 
                \\            box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 2rem; 
                \\        }
                \\        .summary h2 { margin-bottom: 1.5rem; color: #495057; }
                \\        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
                \\        .metric { 
                \\            text-align: center; padding: 1.5rem; border-radius: 8px; 
                \\            background: #f8f9fa; border: 2px solid #e9ecef; 
                \\        }
                \\        .metric.high { border-color: #28a745; background: #d4edda; }
                \\        .metric.medium { border-color: #ffc107; background: #fff3cd; }
                \\        .metric.low { border-color: #dc3545; background: #f8d7da; }
                \\        .metric-value { font-size: 2rem; font-weight: bold; margin-bottom: 0.5rem; }
                \\        .metric.high .metric-value { color: #155724; }
                \\        .metric.medium .metric-value { color: #856404; }
                \\        .metric.low .metric-value { color: #721c24; }
                \\        .metric-label { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px; }
                \\        .files-table { 
                \\            background: white; border-radius: 12px; padding: 2rem; 
                \\            box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
                \\        }
                \\        .files-table h2 { margin-bottom: 1.5rem; color: #495057; }
                \\        table { width: 100%; border-collapse: collapse; }
                \\        th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #e9ecef; }
                \\        th { background: #f8f9fa; font-weight: 600; color: #495057; }
                \\        tr:hover { background: #f8f9fa; }
                \\        .file-link { color: #667eea; text-decoration: none; font-weight: 500; }
                \\        .file-link:hover { text-decoration: underline; }
                \\        .coverage-bar { 
                \\            width: 60px; height: 8px; background: #e9ecef; border-radius: 4px; 
                \\            position: relative; overflow: hidden; 
                \\        }
                \\        .coverage-fill { 
                \\            height: 100%; border-radius: 4px; transition: width 0.3s ease; 
                \\        }
                \\        .coverage-fill.high { background: #28a745; }
                \\        .coverage-fill.medium { background: #ffc107; }
                \\        .coverage-fill.low { background: #dc3545; }
                \\        .coverage-text { font-weight: 600; }
                \\        .coverage-text.high { color: #155724; }
                \\        .coverage-text.medium { color: #856404; }
                \\        .coverage-text.low { color: #721c24; }
                \\        .footer { 
                \\            text-align: center; padding: 2rem; color: #6c757d; 
                \\            font-size: 0.9rem; 
                \\        }
                \\        @media (max-width: 768px) {
                \\            .container { padding: 1rem; }
                \\            .header h1 { font-size: 2rem; }
                \\            .metrics { grid-template-columns: 1fr; }
                \\            table { font-size: 0.9rem; }
                \\            th, td { padding: 0.75rem; }
                \\        }
                \\    </style>
                \\</head>
                \\<body>
                \\    <div class="header">
                \\        <h1>📊 Code Coverage Report</h1>
                \\        <p>Generated by Bun Test Runner</p>
                \\    </div>
                \\    <div class="container">
                \\        <div class="summary">
                \\            <h2>📈 Coverage Summary</h2>
                \\            <div class="metrics">
                \\
            );

            const functions_percent = total_fraction.functions * 100.0;
            const lines_percent = total_fraction.lines * 100.0;

            const functions_level = getCoverageLevel(functions_percent);
            const lines_level = getCoverageLevel(lines_percent);

            try writer.print(
                \\                <div class="metric {s}">
                \\                    <div class="metric-value">{d:.1}%</div>
                \\                    <div class="metric-label">Functions</div>
                \\                </div>
                \\                <div class="metric {s}">
                \\                    <div class="metric-value">{d:.1}%</div>
                \\                    <div class="metric-label">Lines</div>
                \\                </div>
                \\
            , .{ functions_level, functions_percent, lines_level, lines_percent });

            try writer.writeAll(
                \\            </div>
                \\        </div>
                \\        <div class="files-table">
                \\            <h2>📁 Files</h2>
                \\            <table>
                \\                <thead>
                \\                    <tr>
                \\                        <th>File</th>
                \\                        <th>Functions</th>
                \\                        <th>Lines</th>
                \\                        <th>Coverage</th>
                \\                    </tr>
                \\                </thead>
                \\                <tbody>
                \\
            );

            for (reports) |report| {
                var filename = report.source_url.slice();
                if (base_path.len > 0) {
                    filename = bun.path.relative(base_path, filename);
                }

                const functions_frac = report.functionCoverageFraction();
                const lines_frac = report.linesCoverageFraction();
                const functions_pct = functions_frac * 100.0;
                const lines_pct = lines_frac * 100.0;
                const avg_pct = (functions_pct + lines_pct) / 2.0;

                const functions_lvl = getCoverageLevel(functions_pct);
                const lines_lvl = getCoverageLevel(lines_pct);
                const avg_lvl = getCoverageLevel(avg_pct);

                // Generate HTML filename
                const html_filename_buf = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(html_filename_buf);
                const safe_filename_buf = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(safe_filename_buf);
                const replacements_made = std.mem.replace(u8, filename, std.fs.path.sep_str, "_", safe_filename_buf);
                // Calculate the correct length: original length + (replacements * (replacement_length - original_length))
                const safe_filename_len = filename.len + replacements_made * ("_".len - std.fs.path.sep_str.len);
                const safe_filename = if (replacements_made > 0) safe_filename_buf[0..safe_filename_len] else filename;
                const html_filename = std.fmt.bufPrintZ(html_filename_buf, "{s}.html", .{safe_filename}) catch continue;

                try writer.print(
                    \\                    <tr>
                    \\                        <td><a href="{s}" class="file-link">{s}</a></td>
                    \\                        <td>
                    \\                            <span class="coverage-text {s}">{d:.1}%</span>
                    \\                            <div class="coverage-bar">
                    \\                                <div class="coverage-fill {s}" style="width: {d:.1}%"></div>
                    \\                            </div>
                    \\                        </td>
                    \\                        <td>
                    \\                            <span class="coverage-text {s}">{d:.1}%</span>
                    \\                            <div class="coverage-bar">
                    \\                                <div class="coverage-fill {s}" style="width: {d:.1}%"></div>
                    \\                            </div>
                    \\                        </td>
                    \\                        <td>
                    \\                            <div class="coverage-bar">
                    \\                                <div class="coverage-fill {s}" style="width: {d:.1}%"></div>
                    \\                            </div>
                    \\                        </td>
                    \\                    </tr>
                    \\
                , .{ html_filename, filename, functions_lvl, functions_pct, functions_lvl, functions_pct, lines_lvl, lines_pct, lines_lvl, lines_pct, avg_lvl, avg_pct });
            }

            try writer.writeAll(
                \\                </tbody>
                \\            </table>
                \\        </div>
                \\    </div>
                \\    <div class="footer">
                \\        Generated with ❤️ by Bun Test Runner
                \\    </div>
                \\</body>
                \\</html>
                \\
            );
        }

        pub fn writeFileReport(
            report: *const Report,
            source_content: []const u8,
            base_path: []const u8,
            writer: anytype,
        ) !void {
            var filename = report.source_url.slice();
            if (base_path.len > 0) {
                filename = bun.path.relative(base_path, filename);
            }

            const functions_frac = report.functionCoverageFraction();
            const lines_frac = report.linesCoverageFraction();
            const functions_pct = functions_frac * 100.0;
            const lines_pct = lines_frac * 100.0;

            const functions_lvl = getCoverageLevel(functions_pct);
            const lines_lvl = getCoverageLevel(lines_pct);

            try writer.print(
                \\<!DOCTYPE html>
                \\<html lang="en">
                \\<head>
                \\    <meta charset="UTF-8">
                \\    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                \\    <title>Coverage: {s}</title>
                \\    <style>
                \\        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                \\        body {{ 
                \\            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; 
                \\            background: #f8f9fa; color: #212529; line-height: 1.6; 
                \\        }}
                \\        .header {{ 
                \\            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                \\            color: white; padding: 1.5rem 0; 
                \\        }}
                \\        .header-content {{ max-width: 1200px; margin: 0 auto; padding: 0 2rem; }}
                \\        .header h1 {{ font-size: 1.8rem; margin-bottom: 0.5rem; }}
                \\        .back-link {{ color: rgba(255,255,255,0.9); text-decoration: none; font-size: 0.9rem; }}
                \\        .back-link:hover {{ text-decoration: underline; }}
                \\        .container {{ max-width: 1200px; margin: 0 auto; padding: 2rem; }}
                \\        .file-summary {{ 
                \\            background: white; border-radius: 12px; padding: 2rem; 
                \\            box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 2rem; 
                \\        }}
                \\        .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }}
                \\        .metric {{ 
                \\            text-align: center; padding: 1.5rem; border-radius: 8px; 
                \\            background: #f8f9fa; border: 2px solid #e9ecef; 
                \\        }}
                \\        .metric.high {{ border-color: #28a745; background: #d4edda; }}
                \\        .metric.medium {{ border-color: #ffc107; background: #fff3cd; }}
                \\        .metric.low {{ border-color: #dc3545; background: #f8d7da; }}
                \\        .metric-value {{ font-size: 2rem; font-weight: bold; margin-bottom: 0.5rem; }}
                \\        .metric.high .metric-value {{ color: #155724; }}
                \\        .metric.medium .metric-value {{ color: #856404; }}
                \\        .metric.low .metric-value {{ color: #721c24; }}
                \\        .metric-label {{ font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px; }}
                \\        .source-code {{ 
                \\            background: white; border-radius: 12px; 
                \\            box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; 
                \\        }}
                \\        .source-header {{ 
                \\            background: #f8f9fa; padding: 1rem 2rem; border-bottom: 1px solid #e9ecef; 
                \\            font-weight: 600; color: #495057; 
                \\        }}
                \\        .source-content {{ 
                \\            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; 
                \\            font-size: 0.9rem; line-height: 1.4; overflow-x: auto; 
                \\        }}
                \\        .line {{ display: flex; }}
                \\        .line-number {{ 
                \\            background: #f8f9fa; color: #6c757d; padding: 0.25rem 1rem; 
                \\            text-align: right; min-width: 60px; user-select: none; 
                \\            border-right: 1px solid #e9ecef; 
                \\        }}
                \\        .line-content {{ padding: 0.25rem 1rem; flex: 1; white-space: pre; }}
                \\        .line.covered {{ background: rgba(40, 167, 69, 0.1); }}
                \\        .line.uncovered {{ background: rgba(220, 53, 69, 0.1); }}
                \\        .line.not-executable {{ }}
                \\        .legend {{ 
                \\            background: white; border-radius: 12px; padding: 1.5rem; 
                \\            box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 2rem; 
                \\        }}
                \\        .legend h3 {{ margin-bottom: 1rem; color: #495057; }}
                \\        .legend-items {{ display: flex; gap: 2rem; flex-wrap: wrap; }}
                \\        .legend-item {{ display: flex; align-items: center; gap: 0.5rem; }}
                \\        .legend-color {{ width: 16px; height: 16px; border-radius: 3px; }}
                \\        .legend-color.covered {{ background: rgba(40, 167, 69, 0.3); }}
                \\        .legend-color.uncovered {{ background: rgba(220, 53, 69, 0.3); }}
                \\        .legend-color.not-executable {{ background: transparent; }}
                \\        @media (max-width: 768px) {{
                \\            .container {{ padding: 1rem; }}
                \\            .header h1 {{ font-size: 1.5rem; }}
                \\            .metrics {{ grid-template-columns: 1fr; }}
                \\            .legend-items {{ flex-direction: column; gap: 1rem; }}
                \\        }}
                \\    </style>
                \\</head>
                \\<body>
                \\    <div class="header">
                \\        <div class="header-content">
                \\            <a href="index.html" class="back-link">← Back to Summary</a>
                \\            <h1>📄 {s}</h1>
                \\        </div>
                \\    </div>
                \\    <div class="container">
                \\        <div class="file-summary">
                \\            <div class="metrics">
                \\                <div class="metric {s}">
                \\                    <div class="metric-value">{d:.1}%</div>
                \\                    <div class="metric-label">Functions</div>
                \\                </div>
                \\                <div class="metric {s}">
                \\                    <div class="metric-value">{d:.1}%</div>
                \\                    <div class="metric-label">Lines</div>
                \\                </div>
                \\            </div>
                \\        </div>
                \\        <div class="legend">
                \\            <h3>🎨 Legend</h3>
                \\            <div class="legend-items">
                \\                <div class="legend-item">
                \\                    <div class="legend-color covered"></div>
                \\                    <span>Covered lines</span>
                \\                </div>
                \\                <div class="legend-item">
                \\                    <div class="legend-color uncovered"></div>
                \\                    <span>Uncovered lines</span>
                \\                </div>
                \\                <div class="legend-item">
                \\                    <div class="legend-color not-executable"></div>
                \\                    <span>Not executable</span>
                \\                </div>
                \\            </div>
                \\        </div>
                \\        <div class="source-code">
                \\            <div class="source-header">Source Code</div>
                \\            <div class="source-content">
                \\
            , .{ filename, filename, functions_lvl, functions_pct, lines_lvl, lines_pct });

            // Split source content into lines
            var lines = std.mem.splitScalar(u8, source_content, '\n');
            var line_num: u32 = 0;

            while (lines.next()) |line| {
                line_num += 1;

                const is_executable = report.executable_lines.isSet(line_num - 1);
                const is_covered = report.lines_which_have_executed.isSet(line_num - 1);

                const class_name = if (!is_executable)
                    "not-executable"
                else if (is_covered)
                    "covered"
                else
                    "uncovered";

                try writer.print(
                    \\                <div class="line {s}">
                    \\                    <div class="line-number">{d}</div>
                    \\                    <div class="line-content">{s}</div>
                    \\                </div>
                    \\
                , .{ class_name, line_num, std.mem.trimRight(u8, line, " \t\r") });
            }

            try writer.writeAll(
                \\            </div>
                \\        </div>
                \\    </div>
                \\</body>
                \\</html>
                \\
            );
        }

        inline fn getCoverageLevel(percent: f64) []const u8 {
            return if (percent >= 80.0) "high" else if (percent >= 50.0) "medium" else "low";
        }
    };

    pub fn deinit(this: *Report, allocator: std.mem.Allocator) void {
        this.executable_lines.deinit(allocator);
        this.lines_which_have_executed.deinit(allocator);
        this.line_hits.deinitWithAllocator(allocator);
        this.functions.deinit(allocator);
        this.stmts.deinit(allocator);
        this.functions_which_have_executed.deinit(allocator);
        this.stmts_which_have_executed.deinit(allocator);
    }

    extern fn CodeCoverage__withBlocksAndFunctions(
        *bun.JSC.VM,
        i32,
        *anyopaque,
        bool,
        *const fn (
            *Generator,
            [*]const BasicBlockRange,
            usize,
            usize,
            bool,
        ) callconv(.C) void,
    ) bool;

    const Generator = struct {
        allocator: std.mem.Allocator,
        byte_range_mapping: *ByteRangeMapping,
        result: *?Report,

        pub fn do(
            this: *@This(),
            blocks_ptr: [*]const BasicBlockRange,
            blocks_len: usize,
            function_start_offset: usize,
            ignore_sourcemap: bool,
        ) callconv(.C) void {
            const blocks: []const BasicBlockRange = blocks_ptr[0..function_start_offset];
            var function_blocks: []const BasicBlockRange = blocks_ptr[function_start_offset..blocks_len];
            if (function_blocks.len > 1) {
                function_blocks = function_blocks[1..];
            }

            if (blocks.len == 0) {
                return;
            }

            this.result.* = this.byte_range_mapping.generateReportFromBlocks(
                this.allocator,
                this.byte_range_mapping.source_url,
                blocks,
                function_blocks,
                ignore_sourcemap,
            ) catch null;
        }
    };

    pub fn generate(
        globalThis: *bun.JSC.JSGlobalObject,
        allocator: std.mem.Allocator,
        byte_range_mapping: *ByteRangeMapping,
        ignore_sourcemap_: bool,
    ) ?Report {
        bun.JSC.markBinding(@src());
        const vm = globalThis.vm();

        var result: ?Report = null;

        var generator = Generator{
            .result = &result,
            .allocator = allocator,
            .byte_range_mapping = byte_range_mapping,
        };

        if (!CodeCoverage__withBlocksAndFunctions(
            vm,
            byte_range_mapping.source_id,
            &generator,
            ignore_sourcemap_,
            &Generator.do,
        )) {
            return null;
        }

        return result;
    }
};

const BasicBlockRange = extern struct {
    startOffset: c_int = 0,
    endOffset: c_int = 0,
    hasExecuted: bool = false,
    executionCount: usize = 0,
};

pub const ByteRangeMapping = struct {
    line_offset_table: LineOffsetTable.List = .{},
    source_id: i32,
    source_url: bun.JSC.ZigString.Slice,

    pub fn isLessThan(_: void, a: ByteRangeMapping, b: ByteRangeMapping) bool {
        return bun.strings.order(a.source_url.slice(), b.source_url.slice()) == .lt;
    }

    pub const HashMap = std.HashMap(u64, ByteRangeMapping, bun.IdentityContext(u64), std.hash_map.default_max_load_percentage);

    pub fn deinit(this: *ByteRangeMapping) void {
        this.line_offset_table.deinit(bun.default_allocator);
    }

    pub threadlocal var map: ?*HashMap = null;
    pub fn generate(str: bun.String, source_contents_str: bun.String, source_id: i32) callconv(.C) void {
        var _map = map orelse brk: {
            map = bun.JSC.VirtualMachine.get().allocator.create(HashMap) catch bun.outOfMemory();
            map.?.* = HashMap.init(bun.JSC.VirtualMachine.get().allocator);
            break :brk map.?;
        };
        var slice = str.toUTF8(bun.default_allocator);
        const hash = bun.hash(slice.slice());
        var entry = _map.getOrPut(hash) catch bun.outOfMemory();
        if (entry.found_existing) {
            entry.value_ptr.deinit();
        }

        var source_contents = source_contents_str.toUTF8(bun.default_allocator);
        defer source_contents.deinit();

        entry.value_ptr.* = compute(source_contents.slice(), source_id, slice);
    }

    pub fn getSourceID(this: *ByteRangeMapping) callconv(.C) i32 {
        return this.source_id;
    }

    pub fn find(path: bun.String) callconv(.C) ?*ByteRangeMapping {
        var slice = path.toUTF8(bun.default_allocator);
        defer slice.deinit();

        var map_ = map orelse return null;
        const hash = bun.hash(slice.slice());
        const entry = map_.getPtr(hash) orelse return null;
        return entry;
    }

    pub fn generateReportFromBlocks(
        this: *ByteRangeMapping,
        allocator: std.mem.Allocator,
        source_url: bun.JSC.ZigString.Slice,
        blocks: []const BasicBlockRange,
        function_blocks: []const BasicBlockRange,
        ignore_sourcemap: bool,
    ) !Report {
        const line_starts = this.line_offset_table.items(.byte_offset_to_start_of_line);

        var executable_lines: Bitset = Bitset{};
        var lines_which_have_executed: Bitset = Bitset{};
        const parsed_mappings_ = bun.JSC.VirtualMachine.get().source_mappings.get(source_url.slice());
        defer if (parsed_mappings_) |parsed_mapping| parsed_mapping.deref();
        var line_hits = LinesHits{};

        var functions = std.ArrayListUnmanaged(Block){};
        try functions.ensureTotalCapacityPrecise(allocator, function_blocks.len);
        errdefer functions.deinit(allocator);
        var functions_which_have_executed: Bitset = try Bitset.initEmpty(allocator, function_blocks.len);
        errdefer functions_which_have_executed.deinit(allocator);
        var stmts_which_have_executed: Bitset = try Bitset.initEmpty(allocator, blocks.len);
        errdefer stmts_which_have_executed.deinit(allocator);

        var stmts = std.ArrayListUnmanaged(Block){};
        try stmts.ensureTotalCapacityPrecise(allocator, function_blocks.len);
        errdefer stmts.deinit(allocator);

        errdefer executable_lines.deinit(allocator);
        errdefer lines_which_have_executed.deinit(allocator);
        var line_count: u32 = 0;

        if (ignore_sourcemap or parsed_mappings_ == null) {
            line_count = @truncate(line_starts.len);
            executable_lines = try Bitset.initEmpty(allocator, line_count);
            lines_which_have_executed = try Bitset.initEmpty(allocator, line_count);
            line_hits = try LinesHits.initCapacity(allocator, line_count);
            line_hits.len = line_count;
            const line_hits_slice = line_hits.slice();
            @memset(line_hits_slice, 0);

            errdefer line_hits.deinitWithAllocator(allocator);

            for (blocks, 0..) |block, i| {
                if (block.endOffset < 0 or block.startOffset < 0) continue; // does not map to anything

                const min: usize = @intCast(@min(block.startOffset, block.endOffset));
                const max: usize = @intCast(@max(block.startOffset, block.endOffset));
                var min_line: u32 = std.math.maxInt(u32);
                var max_line: u32 = 0;

                const has_executed = block.hasExecuted or block.executionCount > 0;

                for (min..max) |byte_offset| {
                    const new_line_index = LineOffsetTable.findIndex(line_starts, .{ .start = @intCast(byte_offset) }) orelse continue;
                    const line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset >= byte_offset) {
                        continue;
                    }

                    const line: u32 = @intCast(new_line_index);
                    min_line = @min(min_line, line);
                    max_line = @max(max_line, line);

                    executable_lines.set(line);
                    if (has_executed) {
                        lines_which_have_executed.set(line);
                        line_hits_slice[line] += 1;
                    }
                }

                if (min_line != std.math.maxInt(u32)) {
                    if (has_executed)
                        stmts_which_have_executed.set(i);

                    try stmts.append(allocator, .{
                        .start_line = min_line,
                        .end_line = max_line,
                    });
                }
            }

            for (function_blocks, 0..) |function, i| {
                if (function.endOffset < 0 or function.startOffset < 0) continue; // does not map to anything

                const min: usize = @intCast(@min(function.startOffset, function.endOffset));
                const max: usize = @intCast(@max(function.startOffset, function.endOffset));
                var min_line: u32 = std.math.maxInt(u32);
                var max_line: u32 = 0;

                for (min..max) |byte_offset| {
                    const new_line_index = LineOffsetTable.findIndex(line_starts, .{ .start = @intCast(byte_offset) }) orelse continue;
                    const line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset >= byte_offset) {
                        continue;
                    }

                    const line: u32 = @intCast(new_line_index);
                    min_line = @min(min_line, line);
                    max_line = @max(max_line, line);
                }

                const did_fn_execute = function.executionCount > 0 or function.hasExecuted;

                // only mark the lines as executable if the function has not executed
                // functions that have executed have non-executable lines in them and thats fine.
                if (!did_fn_execute) {
                    const end = @min(max_line, line_count);
                    @memset(line_hits_slice[min_line..end], 0);
                    for (min_line..end) |line| {
                        executable_lines.set(line);
                        lines_which_have_executed.unset(line);
                    }
                }

                try functions.append(allocator, .{
                    .start_line = min_line,
                    .end_line = max_line,
                });

                if (did_fn_execute)
                    functions_which_have_executed.set(i);
            }
        } else if (parsed_mappings_) |parsed_mapping| {
            line_count = @as(u32, @truncate(parsed_mapping.input_line_count)) + 1;
            executable_lines = try Bitset.initEmpty(allocator, line_count);
            lines_which_have_executed = try Bitset.initEmpty(allocator, line_count);
            line_hits = try LinesHits.initCapacity(allocator, line_count);
            line_hits.len = line_count;
            const line_hits_slice = line_hits.slice();
            @memset(line_hits_slice, 0);
            errdefer line_hits.deinitWithAllocator(allocator);

            for (blocks, 0..) |block, i| {
                if (block.endOffset < 0 or block.startOffset < 0) continue; // does not map to anything

                const min: usize = @intCast(@min(block.startOffset, block.endOffset));
                const max: usize = @intCast(@max(block.startOffset, block.endOffset));
                var min_line: u32 = std.math.maxInt(u32);
                var max_line: u32 = 0;
                const has_executed = block.hasExecuted or block.executionCount > 0;

                for (min..max) |byte_offset| {
                    const new_line_index = LineOffsetTable.findIndex(line_starts, .{ .start = @intCast(byte_offset) }) orelse continue;
                    const line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset >= byte_offset) {
                        continue;
                    }
                    const column_position = byte_offset -| line_start_byte_offset;

                    if (parsed_mapping.mappings.find(@intCast(new_line_index), @intCast(column_position))) |*point| {
                        if (point.original.lines < 0) continue;

                        const line: u32 = @as(u32, @intCast(point.original.lines));

                        executable_lines.set(line);
                        if (has_executed) {
                            lines_which_have_executed.set(line);
                            line_hits_slice[line] += 1;
                        }

                        min_line = @min(min_line, line);
                        max_line = @max(max_line, line);
                    }
                }

                if (min_line != std.math.maxInt(u32)) {
                    try stmts.append(allocator, .{
                        .start_line = min_line,
                        .end_line = max_line,
                    });

                    if (has_executed)
                        stmts_which_have_executed.set(i);
                }
            }

            for (function_blocks, 0..) |function, i| {
                if (function.endOffset < 0 or function.startOffset < 0) continue; // does not map to anything

                const min: usize = @intCast(@min(function.startOffset, function.endOffset));
                const max: usize = @intCast(@max(function.startOffset, function.endOffset));
                var min_line: u32 = std.math.maxInt(u32);
                var max_line: u32 = 0;

                for (min..max) |byte_offset| {
                    const new_line_index = LineOffsetTable.findIndex(line_starts, .{ .start = @intCast(byte_offset) }) orelse continue;
                    const line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset >= byte_offset) {
                        continue;
                    }

                    const column_position = byte_offset -| line_start_byte_offset;

                    if (parsed_mapping.mappings.find(@intCast(new_line_index), @intCast(column_position))) |point| {
                        if (point.original.lines < 0) continue;

                        const line: u32 = @as(u32, @intCast(point.original.lines));
                        min_line = @min(min_line, line);
                        max_line = @max(max_line, line);
                    }
                }

                // no sourcemaps? ignore it
                if (min_line == std.math.maxInt(u32) and max_line == 0) {
                    continue;
                }

                const did_fn_execute = function.executionCount > 0 or function.hasExecuted;

                // only mark the lines as executable if the function has not executed
                // functions that have executed have non-executable lines in them and thats fine.
                if (!did_fn_execute) {
                    const end = @min(max_line, line_count);
                    for (min_line..end) |line| {
                        executable_lines.set(line);
                        lines_which_have_executed.unset(line);
                        line_hits_slice[line] = 0;
                    }
                }

                try functions.append(allocator, .{
                    .start_line = min_line,
                    .end_line = max_line,
                });
                if (did_fn_execute)
                    functions_which_have_executed.set(i);
            }
        } else {
            unreachable;
        }

        return .{
            .source_url = source_url,
            .functions = functions,
            .executable_lines = executable_lines,
            .lines_which_have_executed = lines_which_have_executed,
            .line_hits = line_hits,
            .total_lines = line_count,
            .stmts = stmts,
            .functions_which_have_executed = functions_which_have_executed,
            .stmts_which_have_executed = stmts_which_have_executed,
        };
    }

    pub fn findExecutedLines(
        globalThis: *bun.JSC.JSGlobalObject,
        source_url: bun.String,
        blocks_ptr: [*]const BasicBlockRange,
        blocks_len: usize,
        function_start_offset: usize,
        ignore_sourcemap: bool,
    ) callconv(.C) bun.JSC.JSValue {
        var this = ByteRangeMapping.find(source_url) orelse return bun.JSC.JSValue.null;

        const blocks: []const BasicBlockRange = blocks_ptr[0..function_start_offset];
        var function_blocks: []const BasicBlockRange = blocks_ptr[function_start_offset..blocks_len];
        if (function_blocks.len > 1) {
            function_blocks = function_blocks[1..];
        }
        var url_slice = source_url.toUTF8(bun.default_allocator);
        defer url_slice.deinit();
        var report = this.generateReportFromBlocks(bun.default_allocator, url_slice, blocks, function_blocks, ignore_sourcemap) catch {
            return globalThis.throwOutOfMemoryValue();
        };
        defer report.deinit(bun.default_allocator);

        var coverage_fraction = Fraction{};

        var mutable_str = bun.MutableString.initEmpty(bun.default_allocator);
        defer mutable_str.deinit();
        var buffered_writer = mutable_str.bufferedWriter();
        var writer = buffered_writer.writer();

        Report.Text.writeFormat(&report, source_url.utf8ByteLength(), &coverage_fraction, "", &writer, false) catch {
            return globalThis.throwOutOfMemoryValue();
        };

        buffered_writer.flush() catch {
            return globalThis.throwOutOfMemoryValue();
        };

        return bun.String.createUTF8ForJS(globalThis, mutable_str.slice()) catch return .zero;
    }

    pub fn compute(source_contents: []const u8, source_id: i32, source_url: bun.JSC.ZigString.Slice) ByteRangeMapping {
        return ByteRangeMapping{
            .line_offset_table = LineOffsetTable.generate(bun.JSC.VirtualMachine.get().allocator, source_contents, 0),
            .source_id = source_id,
            .source_url = source_url,
        };
    }
};

comptime {
    if (bun.Environment.isNative) {
        @export(&ByteRangeMapping.generate, .{ .name = "ByteRangeMapping__generate" });
        @export(&ByteRangeMapping.findExecutedLines, .{ .name = "ByteRangeMapping__findExecutedLines" });
        @export(&ByteRangeMapping.find, .{ .name = "ByteRangeMapping__find" });
        @export(&ByteRangeMapping.getSourceID, .{ .name = "ByteRangeMapping__getSourceID" });
    }
}

pub const Fraction = struct {
    functions: f64 = 0.9,
    lines: f64 = 0.9,

    // This metric is less accurate right now
    stmts: f64 = 0.75,

    failing: bool = false,
};

pub const Block = struct {
    start_line: u32 = 0,
    end_line: u32 = 0,
};
