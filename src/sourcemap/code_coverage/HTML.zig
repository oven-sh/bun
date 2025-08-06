pub fn writeFormat(
    report: *const Report,
    base_path: []const u8,
    writer: anytype,
) !void {
    var filename = report.source_url.slice();
    if (base_path.len > 0) {
        filename = bun.path.relative(base_path, filename);
    }

    const functions_fraction = report.functionCoverageFraction();
    const lines_fraction = report.linesCoverageFraction();

    // Generate HTML filename from source filename
    var html_filename_buf: bun.PathBuffer = undefined;
    const html_filename = std.fmt.bufPrint(&html_filename_buf, "{s}.html", .{bun.path.basename(filename)}) catch filename;

    // Write HTML structure for this file's coverage
    try writer.print(
        \\    <tr data-file="{s}">
        \\      <td><a href="{s}">{s}</a></td>
        \\      <td class="coverage">{d:.2}%</td>
        \\      <td class="coverage">{d:.2}%</td>
        \\      <td class="uncovered-lines">
    , .{ filename, html_filename, filename, functions_fraction * 100.0, lines_fraction * 100.0 });

    // Add uncovered line ranges
    var executable_lines_that_havent_been_executed = report.lines_which_have_executed.clone(bun.default_allocator) catch bun.outOfMemory();
    defer executable_lines_that_havent_been_executed.deinit(bun.default_allocator);
    executable_lines_that_havent_been_executed.toggleAll();
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
            try writer.writeAll(", ");
        }

        if (start_of_line_range == prev_line) {
            try writer.print("{d}", .{start_of_line_range + 1});
        } else {
            try writer.print("{d}-{d}", .{ start_of_line_range + 1, prev_line + 1 });
        }

        prev_line = next_line;
        start_of_line_range = next_line;
    }

    if (prev_line != start_of_line_range) {
        if (is_first) {
            is_first = false;
        } else {
            try writer.writeAll(", ");
        }

        if (start_of_line_range == prev_line) {
            try writer.print("{d}", .{start_of_line_range + 1});
        } else {
            try writer.print("{d}-{d}", .{ start_of_line_range + 1, prev_line + 1 });
        }
    }

    try writer.writeAll("</td>\n    </tr>\n");
}

pub fn writeDetailedFile(
    report: *const Report,
    base_path: []const u8,
    source_path: []const u8,
    writer: anytype,
) !void {
    var filename = report.source_url.slice();
    if (base_path.len > 0) {
        filename = bun.path.relative(base_path, filename);
    }

    const functions_fraction = report.functionCoverageFraction();
    const lines_fraction = report.linesCoverageFraction();
    const covered = report.lines_which_have_executed.count();
    const total = report.executable_lines.count();

    // Write HTML header
    try writer.writeAll(
        \\<!DOCTYPE html>
        \\<html lang="en">
        \\<head>
        \\  <meta charset="UTF-8">
        \\  <meta name="viewport" content="width=device-width, initial-scale=1.0">
    );
    try writer.print("  <title>Coverage: {s}</title>\n", .{bun.path.basename(filename)});
    try writer.writeAll(
        \\  <style>
        \\    body { font-family: 'SF Mono', Monaco, monospace; margin: 0; padding: 0; background: #1e1e1e; color: #d4d4d4; }
        \\    .header { background: #2d2d2d; padding: 20px; border-bottom: 1px solid #3e3e3e; position: sticky; top: 0; z-index: 100; }
        \\    .header h1 { margin: 0 0 10px 0; font-size: 18px; font-weight: normal; color: #cccccc; }
        \\    .header .path { color: #858585; font-size: 14px; margin-bottom: 15px; }
        \\    .stats { display: flex; gap: 30px; font-size: 14px; }
        \\    .stat { display: flex; align-items: center; gap: 8px; }
        \\    .stat-label { color: #858585; }
        \\    .stat-value { font-weight: bold; }
        \\    .stat.good .stat-value { color: #4ec9b0; }
        \\    .stat.bad .stat-value { color: #f48771; }
        \\    .source-code { margin: 0; padding: 20px 0; font-size: 14px; line-height: 1.5; }
        \\    .line { display: block; padding: 0 20px; white-space: pre; position: relative; }
        \\    .line:hover { background: #2a2a2a; }
        \\    .line-number { display: inline-block; width: 60px; text-align: right; color: #858585; margin-right: 20px; user-select: none; }
        \\    .line.covered { background: linear-gradient(90deg, #2d4f3e 0%, transparent 70%); }
        \\    .line.covered .line-number { color: #4ec9b0; }
        \\    .line.uncovered { background: linear-gradient(90deg, #5a2d2d 0%, transparent 70%); }
        \\    .line.uncovered .line-number { color: #f48771; }
        \\    .line.non-executable { opacity: 0.6; }
        \\    .hit-count { position: absolute; left: 90px; color: #858585; font-size: 12px; min-width: 30px; }
        \\    .line.covered .hit-count { color: #4ec9b0; }
        \\    .back-link { position: absolute; right: 20px; top: 20px; color: #569cd6; text-decoration: none; }
        \\    .back-link:hover { text-decoration: underline; }
        \\  </style>
        \\</head>
        \\<body>
        \\  <div class="header">
        \\    <a href="index.html" class="back-link">← Back to summary</a>
        \\    <h1>Coverage Report</h1>
    );
    try writer.print("    <div class=\"path\">{s}</div>\n", .{filename});
    try writer.print(
        \\    <div class="stats">
        \\      <div class="stat {s}">
        \\        <span class="stat-label">Lines:</span>
        \\        <span class="stat-value">{d:.1}%</span>
        \\        <span class="stat-label">({d}/{d})</span>
        \\      </div>
        \\      <div class="stat {s}">
        \\        <span class="stat-label">Functions:</span>
        \\        <span class="stat-value">{d:.1}%</span>
        \\      </div>
        \\    </div>
        \\  </div>
        \\  <pre class="source-code">
    , .{
        if (lines_fraction >= 0.8) "good" else "bad",
        lines_fraction * 100.0,
        covered,
        total,
        if (functions_fraction >= 0.8) "good" else "bad",
        functions_fraction * 100.0,
    });

    // Try to read the source file
    const source_contents = bun.sys.File.readFrom(bun.FD.cwd(), source_path, bun.default_allocator).unwrap() catch brk: {
        // If we can't read the file, just show a message
        try writer.print("<div class=\"line\">Could not read source file: {s}</div>", .{source_path});
        break :brk "";
    };
    defer if (source_contents.len > 0) bun.default_allocator.free(source_contents);

    if (source_contents.len > 0) {
        // Split source into lines and annotate with coverage
        var lines = std.mem.splitScalar(u8, source_contents, '\n');
        var line_number: u32 = 1;
        const line_hits = report.line_hits.slice();

        while (lines.next()) |line| {
            const line_index = line_number - 1;
            const is_executable = report.executable_lines.isSet(line_index);
            const is_covered = report.lines_which_have_executed.isSet(line_index);
            const hit_count = if (line_index < line_hits.len) line_hits[line_index] else 0;

            const css_class = if (!is_executable)
                "line non-executable"
            else if (is_covered)
                "line covered"
            else
                "line uncovered";

            try writer.print("<span class=\"{s}\" data-line=\"{d}\">", .{ css_class, line_number });
            try writer.print("<span class=\"line-number\">{d}</span>", .{line_number});

            if (is_executable and hit_count > 0) {
                try writer.print("<span class=\"hit-count\">{d}x</span>", .{hit_count});
            }

            // HTML escape the source line
            for (line) |char| {
                switch (char) {
                    '<' => try writer.writeAll("&lt;"),
                    '>' => try writer.writeAll("&gt;"),
                    '&' => try writer.writeAll("&amp;"),
                    '"' => try writer.writeAll("&quot;"),
                    '\'' => try writer.writeAll("&#39;"),
                    else => try writer.writeByte(char),
                }
            }
            try writer.writeAll("</span>\n");
            line_number += 1;
        }
    }

    try writer.writeAll("  </pre>\n</body>\n</html>\n");
}

const bun = @import("bun");
const Report = bun.sourcemap.coverage.Report;

const std = @import("std");
