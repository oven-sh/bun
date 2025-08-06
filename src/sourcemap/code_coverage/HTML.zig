pub fn writeFormat(
    report: *const Report,
    base_path: []const u8,
    writer: anytype,
) !void {
    var filename = report.source_url.byteSlice();
    if (base_path.len > 0) {
        filename = std.fs.path.relative(std.heap.page_allocator, base_path, filename) catch filename;
    }

    const functions_fraction = report.functionCoverageFraction();
    const lines_fraction = report.linesCoverageFraction();

    // Generate HTML filename from source filename (replace slashes with underscores)
    var html_filename_buf: [std.fs.max_path_bytes]u8 = undefined;
    var safe_filename_buf: [std.fs.max_path_bytes]u8 = undefined;

    // Replace slashes with underscores in the filename
    var safe_len: usize = 0;
    for (filename) |char| {
        if (char == '/' or char == '\\') {
            safe_filename_buf[safe_len] = '_';
        } else {
            safe_filename_buf[safe_len] = char;
        }
        safe_len += 1;
    }
    const safe_filename = safe_filename_buf[0..safe_len];
    const html_filename = std.fmt.bufPrint(&html_filename_buf, "{s}.html", .{safe_filename}) catch filename;

    // Write HTML structure for this file's coverage
    try writer.print(
        \\    <tr data-file="{s}">
        \\      <td><a href="./{s}">{s}</a></td>
        \\      <td class="coverage {s}">{d:.2}%</td>
        \\      <td class="coverage {s}">{d:.2}%</td>
        \\      <td class="uncovered-lines">
    , .{ filename, html_filename, filename, if (functions_fraction >= 0.8) "good" else "bad", functions_fraction * 100.0, if (lines_fraction >= 0.8) "good" else "bad", lines_fraction * 100.0 });

    // Add uncovered line ranges
    const allocator = std.heap.page_allocator;
    var executable_lines_that_havent_been_executed = report.lines_which_have_executed.clone(allocator) catch return;
    defer executable_lines_that_havent_been_executed.deinit(allocator);
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

    if (prev_line != start_of_line_range or (prev_line > 0 and start_of_line_range > 0)) {
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
    _ = writeDetailedFileWithTree(report, base_path, source_path, null, writer) catch |err| return err;
}

pub fn writeDetailedFileWithTree(
    report: *const Report,
    base_path: []const u8,
    source_path: []const u8,
    sidebar_items: ?[]const SidebarItem,
    writer: anytype,
) !void {
    var filename = report.source_url.byteSlice();
    if (base_path.len > 0) {
        filename = std.fs.path.relative(std.heap.page_allocator, base_path, filename) catch filename;
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
    try writer.print("  <title>Coverage: {s}</title>\n", .{std.fs.path.basename(filename)});
    try writer.writeAll(
        \\  <style>
        \\    body { font-family: 'SF Mono', Monaco, monospace; margin: 0; padding: 0; background: #1e1e1e; color: #d4d4d4; display: flex; height: 100vh; }
        \\    .sidebar { width: 280px; background: #252526; border-right: 1px solid #3e3e3e; overflow-y: auto; flex-shrink: 0; }
        \\    .sidebar-header { padding: 15px 20px; background: #2d2d2d; border-bottom: 1px solid #3e3e3e; position: sticky; top: 0; z-index: 10; }
        \\    .sidebar-header h2 { margin: 0; font-size: 14px; font-weight: normal; color: #cccccc; }
        \\    .file-tree { padding: 10px 0; }
        \\    .file-tree-item { padding: 5px 20px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; text-decoration: none; color: #cccccc; font-size: 13px; }
        \\    .file-tree-item:hover { background: #2a2d2e; }
        \\    .file-tree-item.active { background: #37373d; }
        \\    .file-tree-item .file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        \\    .file-tree-item .coverage-badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; }
        \\    .file-tree-item .coverage-badge.good { background: #2d4f3e; color: #4ec9b0; }
        \\    .file-tree-item .coverage-badge.medium { background: #4a3c28; color: #dcdcaa; }
        \\    .file-tree-item .coverage-badge.bad { background: #5a2d2d; color: #f48771; }
        \\    .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        \\    .header { background: #2d2d2d; padding: 20px; border-bottom: 1px solid #3e3e3e; }
        \\    .header h1 { margin: 0 0 10px 0; font-size: 18px; font-weight: normal; color: #cccccc; }
        \\    .header .path { color: #858585; font-size: 14px; margin-bottom: 15px; }
        \\    .stats { display: flex; gap: 30px; font-size: 14px; }
        \\    .stat { display: flex; align-items: center; gap: 8px; }
        \\    .stat-label { color: #858585; }
        \\    .stat-value { font-weight: bold; }
        \\    .stat.good .stat-value { color: #4ec9b0; }
        \\    .stat.bad .stat-value { color: #f48771; }
        \\    .source-container { flex: 1; overflow-y: auto; }
        \\    .source-code { margin: 0; padding: 20px 0; font-size: 14px; line-height: 1.5; }
        \\    .line { display: flex; position: relative; align-items: flex-start; min-height: 1.5em; }
        \\    .line:hover { background: #2a2a2a; }
        \\    .line-number { display: inline-block; width: 60px; text-align: right; color: #858585; user-select: none; }
        \\    .line.covered { background: linear-gradient(90deg, #2d4f3e 0%, transparent 70%); }
        \\    .line.covered .line-number { color: #4ec9b0; }
        \\    .line.uncovered { background: linear-gradient(90deg, #5a2d2d 0%, transparent 70%); }
        \\    .line.uncovered .line-number { color: #f48771; }
        \\    .line.non-executable { opacity: 0.6; }
        \\    .hit-count { display: inline-block; width: 45px; text-align: right; color: #858585; font-size: 12px; margin-right: 15px; margin-left: 10px; user-select: none; }
        \\    .line.covered .hit-count { color: #4ec9b0; }
        \\    .back-link { position: absolute; right: 20px; top: 20px; color: #569cd6; text-decoration: none; }
        \\    .back-link:hover { text-decoration: underline; }
        \\    pre { margin: 0; display: inline; }
        \\    .code-content { white-space: pre; }
        \\  </style>
        \\</head>
        \\<body>
        \\  <div class="sidebar">
        \\    <div class="sidebar-header">
        \\      <h2>Files</h2>
        \\    </div>
        \\    <div class="file-tree">
    );

    // Add file tree items if we have sidebar items
    if (sidebar_items) |items| {
        for (items) |item| {
            const coverage_class = if (item.coverage >= 0.8) "good" else if (item.coverage >= 0.5) "medium" else "bad";
            const is_active = std.mem.eql(u8, item.filename, filename);

            try writer.print(
                \\      <a href="./{s}" class="file-tree-item{s}">
                \\        <span class="file-name">{s}</span>
                \\        <span class="coverage-badge {s}">{d:.0}%</span>
                \\      </a>
                \\
            , .{
                item.html_filename,
                if (is_active) " active" else "",
                std.fs.path.basename(item.filename),
                coverage_class,
                item.coverage * 100.0,
            });
        }
    }

    try writer.writeAll(
        \\    </div>
        \\  </div>
        \\  <div class="main-content">
        \\    <div class="header">
        \\      <a href="./index.html" class="back-link">← Back to summary</a>
        \\      <h1>Coverage Report</h1>
    );
    try writer.print("      <div class=\"path\">{s}</div>\n", .{filename});
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
        \\  <div class="source-container">
        \\    <div class="source-code">
    , .{
        if (lines_fraction >= 0.8) "good" else "bad",
        lines_fraction * 100.0,
        covered,
        total,
        if (functions_fraction >= 0.8) "good" else "bad",
        functions_fraction * 100.0,
    });

    // Try to read the source file
    const allocator = std.heap.page_allocator;
    const source_file = std.fs.cwd().openFile(source_path, .{}) catch {
        try writer.print("<div class=\"line\">Could not read source file: {s}</div>", .{source_path});
        try writer.writeAll("    </div>\n  </div>\n  </div>\n</body>\n</html>\n");
        return;
    };
    defer source_file.close();

    const source_contents = source_file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch {
        try writer.print("<div class=\"line\">Could not read source file: {s}</div>", .{source_path});
        try writer.writeAll("    </div>\n  </div>\n  </div>\n</body>\n</html>\n");
        return;
    };
    defer allocator.free(source_contents);

    // Split source into lines and annotate with coverage
    var lines = std.mem.splitScalar(u8, source_contents, '\n');
    var line_number: u32 = 1;
    const line_hits = report.line_hits.slice();

    while (lines.next()) |line| {
        const line_index = line_number - 1;
        const is_executable = line_index < report.executable_lines.bit_length and report.executable_lines.isSet(line_index);
        const is_covered = line_index < report.lines_which_have_executed.bit_length and report.lines_which_have_executed.isSet(line_index);
        const hit_count = if (line_index < line_hits.len) line_hits[line_index] else 0;

        const css_class = if (!is_executable)
            "line non-executable"
        else if (is_covered)
            "line covered"
        else
            "line uncovered";

        try writer.print("<div class=\"{s}\" data-line=\"{d}\">", .{ css_class, line_number });
        try writer.print("<span class=\"line-number\">{d}</span>", .{line_number});

        if (is_executable and hit_count > 0) {
            try writer.print("<span class=\"hit-count\">{d}x</span>", .{hit_count});
        } else if (is_executable) {
            try writer.writeAll("<span class=\"hit-count\"></span>");
        } else {
            try writer.writeAll("<span class=\"hit-count\" style=\"visibility: hidden;\"></span>");
        }

        try writer.writeAll("<span class=\"code-content\">");
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
        try writer.writeAll("</span></div>\n");
        line_number += 1;
    }

    try writer.writeAll("    </div>\n  </div>\n  </div>\n</body>\n</html>\n");
}

const bun = @import("bun");
const Report = bun.sourcemap.coverage.Report;

const std = @import("std");
const Output = bun.Output;
const Global = bun.Global;

/// Simplified sidebar data - only what's needed for the file tree
pub const SidebarItem = struct {
    filename: []const u8,
    html_filename: []const u8,
    coverage: f64,
};

pub fn writeHeader(writer: std.io.AnyWriter) !void {
    try writer.writeAll(
        \\<!DOCTYPE html>
        \\<html lang="en">
        \\<head>
        \\  <meta charset="UTF-8">
        \\  <meta name="viewport" content="width=device-width, initial-scale=1.0">
        \\  <title>Coverage Report</title>
        \\  <style>
        \\    body { font-family: 'SF Mono', Monaco, monospace; margin: 0; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
        \\    h1 { color: #569cd6; margin-bottom: 10px; }
        \\    .summary { background: #252526; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        \\    .summary p { margin: 5px 0; }
        \\    .files-table { background: #252526; border-radius: 5px; overflow: hidden; }
        \\    table { width: 100%; border-collapse: collapse; }
        \\    th { background: #2d2d2d; padding: 10px; text-align: left; font-weight: normal; color: #cccccc; }
        \\    td { padding: 10px; border-top: 1px solid #3e3e3e; }
        \\    tr:hover { background: #2a2d2e; }
        \\    a { color: #569cd6; text-decoration: none; }
        \\    a:hover { text-decoration: underline; }
        \\    .coverage { text-align: right; font-weight: bold; }
        \\    .coverage.good { color: #4ec9b0; }
        \\    .coverage.bad { color: #f48771; }
        \\    .uncovered-lines { color: #858585; font-size: 0.9em; }
        \\  </style>
        \\</head>
        \\<body>
        \\  <h1>Coverage Report</h1>
        \\  <div class="summary">
        \\    <p>Generated: 
    );
}

pub fn writeTimestamp(writer: std.io.AnyWriter) !void {
    const timestamp_ms = std.time.milliTimestamp();
    const seconds = @divTrunc(timestamp_ms, std.time.ms_per_s);
    const epoch_seconds = std.time.epoch.EpochSeconds{ .secs = @intCast(seconds) };
    const epoch_day = epoch_seconds.getEpochDay();
    const year_day = epoch_day.calculateYearDay();
    const month_day = year_day.calculateMonthDay();

    try writer.print("{d}-{d:0>2}-{d:0>2} {d:0>2}:{d:0>2}:{d:0>2}</p>\n  </div>\n", .{
        year_day.year,
        month_day.month.numeric(),
        month_day.day_index + 1,
        epoch_seconds.getDaySeconds().getHoursIntoDay(),
        epoch_seconds.getDaySeconds().getMinutesIntoHour(),
        epoch_seconds.getDaySeconds().getSecondsIntoMinute(),
    });

    try writer.writeAll(
        \\  <div class="files-table">
        \\    <table>
        \\      <thead>
        \\        <tr>
        \\          <th>File</th>
        \\          <th class="coverage">Functions</th>
        \\          <th class="coverage">Lines</th>
        \\          <th>Uncovered Lines</th>
        \\        </tr>
        \\      </thead>
        \\      <tbody>
        \\
    );
}

pub fn writeFooter(writer: std.io.AnyWriter) !void {
    try writer.writeAll(
        \\      </tbody>
        \\    </table>
        \\  </div>
        \\</body>
        \\</html>
        \\
    );
}

pub fn createDetailFile(
    report: *const Report,
    relative_dir: []const u8,
    reports_directory: []const u8,
    source_path: []const u8,
    sidebar_items: []const SidebarItem,
) !void {
    const relative_source_path = if (relative_dir.len > 0) bun.path.relative(relative_dir, source_path) else source_path;

    // Create HTML filename for this source file using the same logic as in writeFormat
    var detail_html_name_buf: bun.PathBuffer = undefined;
    var safe_filename_buf: [std.fs.max_path_bytes]u8 = undefined;

    // Replace slashes with underscores in the filename
    var safe_len: usize = 0;
    for (relative_source_path) |char| {
        if (char == '/' or char == '\\') {
            safe_filename_buf[safe_len] = '_';
        } else {
            safe_filename_buf[safe_len] = char;
        }
        safe_len += 1;
    }
    const safe_filename = safe_filename_buf[0..safe_len];
    const detail_html_filename = std.fmt.bufPrint(&detail_html_name_buf, "{s}.html", .{safe_filename}) catch return;

    // Write directly to final path
    const detail_path = bun.path.joinAbsStringBufZ(relative_dir, &detail_html_name_buf, &.{ reports_directory, detail_html_filename }, .auto);

    const detail_file = bun.sys.File.openat(
        .cwd(),
        detail_path,
        bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC,
        0o644,
    );

    switch (detail_file) {
        .err => |err| {
            Output.err(.lcovCoverageError, "Failed to create HTML detail file", .{});
            Output.printError("\n{s}", .{err});
            return;
        },
        .result => |file| {
            defer file.close();
            var detail_buffered_writer = std.io.bufferedWriter(file.writer());
            const detail_writer = detail_buffered_writer.writer();

            // Write detailed coverage HTML for this source file
            writeDetailedFileWithTree(
                report,
                relative_dir,
                source_path,
                sidebar_items,
                detail_writer,
            ) catch return;

            detail_buffered_writer.flush() catch return;
        },
    }
}
