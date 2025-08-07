pub fn writeFormatWithSidebarItem(
    report: *const Report,
    sidebar_item: SidebarItem,
    writer: anytype,
) !void {
    const filename = sidebar_item.filename;
    const html_filename = sidebar_item.html_filename;

    const functions_fraction = report.functionCoverageFraction();
    const lines_fraction = report.linesCoverageFraction();

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

        if (prev_line == start_of_line_range) {
            try writer.print("{d}", .{prev_line + 1});
        } else {
            try writer.print("{d}-{d}", .{ start_of_line_range + 1, prev_line + 1 });
        }
    }

    try writer.writeAll(
        \\      </td>
        \\    </tr>
    );
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
    sidebar_items: []const SidebarItem,
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

    // Write common page header
    var title_buf: [256]u8 = undefined;
    const title = std.fmt.bufPrint(&title_buf, "Coverage: {s}", .{std.fs.path.basename(filename)}) catch "Coverage Report";
    try writePageHeader(title, sidebar_items, filename, writer);

    // Write the main content specific to detailed file view
    try writer.writeAll(
        \\  <div class="main-content">
        \\    <div class="header">
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
        try writer.writeAll("    </div>\n  </div>\n");
        try writePageFooter(writer);
        return;
    };
    defer source_file.close();

    const source_contents = source_file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch {
        try writer.print("<div class=\"line\">Could not read source file: {s}</div>", .{source_path});
        try writer.writeAll("    </div>\n  </div>\n");
        try writePageFooter(writer);
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

        try writer.print("<div class=\"{s}\" id=\"{d}\">", .{ css_class, line_number });
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

    try writer.writeAll("    </div>\n  </div>\n");
    try writePageFooter(writer);
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

/// Writes the common HTML header including HEAD, CSS, and sidebar opening
/// Stops at <div class="main-content"> so content can be added after
pub fn writePageHeader(
    title: []const u8,
    sidebar_items: []const SidebarItem,
    active_filename: ?[]const u8,
    writer: anytype,
) !void {
    // Write HTML header
    try writer.writeAll(
        \\<!DOCTYPE html>
        \\<html lang="en">
        \\<head>
        \\  <meta charset="UTF-8">
        \\  <meta name="viewport" content="width=device-width, initial-scale=1.0">
    );
    try writer.print("  <title>{s}</title>\n", .{title});
    try writer.writeAll(
        \\  <style>
        \\    body { font-family: 'SF Mono', Monaco, monospace; margin: 0; padding: 0; background: #1e1e1e; color: #d4d4d4; display: flex; height: 100vh; }
        \\    .sidebar { width: 280px; background: #252526; border-right: 1px solid #3e3e3e; overflow-y: auto; flex-shrink: 0; }
        \\    .sidebar-header { padding: 15px 20px; background: #2d2d2d; border-bottom: 1px solid #3e3e3e; position: sticky; top: 0; z-index: 10; }
        \\    .sidebar-header h2 { margin: 0; font-size: 14px; font-weight: normal; color: #cccccc; }
        \\    .file-tree { padding: 10px 0; }
        \\    .tree-folder summary { padding: 5px 10px; cursor: pointer; display: flex; align-items: center; color: #cccccc; font-size: 13px; user-select: none; list-style: none; }
        \\    .tree-folder summary::-webkit-details-marker { display: none; }
        \\    .tree-folder summary:hover { background: #2a2d2e; }
        \\    .tree-folder:not([open]):has(.file-tree-item.active) > summary { background-color: #37373d; }
        \\    .tree-chevron { display: inline-block; width: 12px; margin-right: 4px; transition: transform 0.2s; }
        \\    .tree-folder[open] .tree-chevron { transform: rotate(0deg); }
        \\    .tree-folder:not([open]) .tree-chevron { transform: rotate(-90deg); }
        \\    .file-tree-item { padding: 5px 10px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; text-decoration: none; color: #cccccc; font-size: 13px; }
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
        \\    pre { margin: 0; display: inline; }
        \\    .code-content { white-space: pre; }
        \\    /* Index page specific styles */
        \\    .main-content.index { padding: 20px; overflow-y: auto; }
        \\    h1 { color: #569cd6; margin: 0 0 20px 0; font-size: 24px; }
        \\    .summary { background: #252526; padding: 20px; border-radius: 5px; margin-bottom: 30px; }
        \\    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
        \\    .summary-item { }
        \\    .summary-label { color: #858585; font-size: 12px; margin-bottom: 5px; }
        \\    .summary-value { font-size: 24px; font-weight: bold; }
        \\    .summary-value.good { color: #4ec9b0; }
        \\    .summary-value.medium { color: #dcdcaa; }
        \\    .summary-value.bad { color: #f48771; }
        \\    .summary-detail { color: #858585; font-size: 12px; margin-top: 5px; }
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
        \\  <script>
        \\    // SessionStorage keys
        \\    const SIDEBAR_SCROLL_KEY = 'coverage-sidebar-scroll';
        \\    const FOLDER_STATES_KEY = 'coverage-folder-states';
        \\    
        \\    // Save sidebar scroll position
        \\    function saveSidebarScroll() {
        \\      const sidebar = document.querySelector('.sidebar');
        \\      if (sidebar) {
        \\        sessionStorage.setItem(SIDEBAR_SCROLL_KEY, sidebar.scrollTop);
        \\      }
        \\    }
        \\    
        \\    // Restore sidebar scroll position
        \\    function restoreSidebarScroll() {
        \\      const sidebar = document.querySelector('.sidebar');
        \\      const scrollPos = sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
        \\      if (sidebar && scrollPos) {
        \\        sidebar.scrollTop = parseInt(scrollPos, 10);
        \\      }
        \\    }
        \\    
        \\    // Save folder states (open/closed)
        \\    function saveFolderStates() {
        \\      const folders = document.querySelectorAll('.tree-folder');
        \\      const states = {};
        \\      folders.forEach((folder, index) => {
        \\        const folderPath = getFolderPath(folder);
        \\        states[folderPath] = folder.open;
        \\      });
        \\      sessionStorage.setItem(FOLDER_STATES_KEY, JSON.stringify(states));
        \\    }
        \\    
        \\    // Get a unique path identifier for a folder
        \\    function getFolderPath(folder) {
        \\      const summary = folder.querySelector('summary');
        \\      const pathComponents = [];
        \\      let current = folder;
        \\      
        \\      while (current) {
        \\        const summaryText = current.querySelector('summary > span:last-child');
        \\        if (summaryText) {
        \\          pathComponents.unshift(summaryText.textContent);
        \\        }
        \\        current = current.parentElement.closest('.tree-folder');
        \\      }
        \\      
        \\      return pathComponents.join('/');
        \\    }
        \\    
        \\    // Restore folder states
        \\    function restoreFolderStates() {
        \\      const statesJson = sessionStorage.getItem(FOLDER_STATES_KEY);
        \\      if (!statesJson) return;
        \\      
        \\      try {
        \\        const states = JSON.parse(statesJson);
        \\        const folders = document.querySelectorAll('.tree-folder');
        \\        
        \\        folders.forEach((folder) => {
        \\          const folderPath = getFolderPath(folder);
        \\          if (folderPath in states) {
        \\            folder.open = states[folderPath];
        \\          }
        \\        });
        \\      } catch (e) {
        \\        console.error('Failed to restore folder states:', e);
        \\      }
        \\    }
        \\    
        \\    // Initialize when DOM is ready
        \\    document.addEventListener('DOMContentLoaded', function() {
        \\      // Restore states
        \\      restoreFolderStates();
        \\      restoreSidebarScroll();
        \\      
        \\      // Save scroll position on scroll
        \\      const sidebar = document.querySelector('.sidebar');
        \\      if (sidebar) {
        \\        sidebar.addEventListener('scroll', saveSidebarScroll);
        \\      }
        \\      
        \\      // Save folder states when folders are toggled
        \\      const folders = document.querySelectorAll('.tree-folder');
        \\      folders.forEach(folder => {
        \\        folder.addEventListener('toggle', saveFolderStates);
        \\      });
        \\      
        \\      // Save state when clicking file links
        \\      const fileLinks = document.querySelectorAll('.file-tree-item');
        \\      fileLinks.forEach(link => {
        \\        link.addEventListener('click', function() {
        \\          saveSidebarScroll();
        \\          saveFolderStates();
        \\        });
        \\      });
        \\    });
        \\    
        \\    // Save state before unload (for browser back/forward)
        \\    window.addEventListener('beforeunload', function() {
        \\      saveSidebarScroll();
        \\      saveFolderStates();
        \\    });
        \\    
        \\    // Restore states when navigating with browser back/forward buttons
        \\    window.addEventListener('popstate', function() {
        \\      restoreFolderStates();
        \\      restoreSidebarScroll();
        \\    });
        \\    
        \\    // Also handle pageshow event for better browser compatibility
        \\    window.addEventListener('pageshow', function(event) {
        \\      restoreFolderStates();
        \\      restoreSidebarScroll();
        \\    });
        \\  </script>
        \\</head>
        \\<body>
        \\  <div class="sidebar">
        \\    <div class="sidebar-header">
        \\      <h2>Files</h2>
        \\    </div>
        \\    <div class="file-tree">
    );

    // Add Home/Summary tab at the top
    const is_index = active_filename == null;
    try writer.print(
        \\      <a href="./index.html" class="file-tree-item{s}">
        \\        <span class="file-name">Summary</span>
        \\      </a>
        \\      <div style="height: 1px; background: #3e3e3e; margin: 10px 0;"></div>
        \\
    , .{if (is_index) " active" else ""});

    // Build tree structure from file paths
    try writeFileTreeItems(sidebar_items, active_filename, writer);

    try writer.writeAll(
        \\    </div>
        \\  </div>
    );
}

fn writeFileTreeItems(
    sidebar_items: []const SidebarItem,
    active_filename: ?[]const u8,
    writer: anytype,
) !void {
    const allocator = std.heap.page_allocator;

    // Stack to track current directory path
    var path_stack = std.ArrayList([]const u8).init(allocator);
    defer path_stack.deinit();

    for (sidebar_items) |item| {
        // Split the filename into path components
        var path_components = std.ArrayList([]const u8).init(allocator);
        defer path_components.deinit();

        var iter = std.mem.tokenizeAny(u8, item.filename, "/\\");
        while (iter.next()) |component| {
            try path_components.append(component);
        }

        // Compare with current stack to find common prefix
        var common_depth: usize = 0;
        while (common_depth < path_stack.items.len and
            common_depth < path_components.items.len - 1)
        {
            if (!std.mem.eql(u8, path_stack.items[common_depth], path_components.items[common_depth])) {
                break;
            }
            common_depth += 1;
        }

        // Close folders that are no longer in the path
        var i = path_stack.items.len;
        while (i > common_depth) {
            i -= 1;
            // Write closing details tag for each level
            for (0..i + 1) |_| {
                try writer.writeAll("  ");
            }
            try writer.writeAll("</details>\n");
        }

        // Open new folders
        i = common_depth;
        while (i < path_components.items.len - 1) {
            // Update stack
            if (i >= path_stack.items.len) {
                try path_stack.append(path_components.items[i]);
            } else {
                path_stack.items[i] = path_components.items[i];
            }

            // Write folder opening with proper indentation
            for (0..i + 1) |_| {
                try writer.writeAll("  ");
            }
            try writer.writeAll("<details class=\"tree-folder\" open>\n");
            for (0..i + 2) |_| {
                try writer.writeAll("  ");
            }
            try writer.print(
                \\<summary style="padding-left: {d}px;">
                \\  <span class="tree-chevron">▼</span>
                \\  <span>{s}</span>
                \\</summary>
                \\
            , .{
                10 + (i * 17), // Base padding of 10px + 17px per depth level
                path_components.items[i],
            });

            i += 1;
        }

        // Resize stack to current depth
        try path_stack.resize(path_components.items.len - 1);

        // Write the file item with proper indentation
        const coverage_class = if (item.coverage >= 0.8) "good" else if (item.coverage >= 0.5) "medium" else "bad";
        const is_active = if (active_filename) |active| std.mem.eql(u8, item.filename, active) else false;

        // Indent based on the depth (number of parent folders)
        for (0..path_stack.items.len + 1) |_| {
            try writer.writeAll("  ");
        }

        const file_basename = path_components.items[path_components.items.len - 1];
        try writer.print(
            \\<a href="./{s}" class="file-tree-item{s}" style="padding-left: {d}px;">
            \\  <span class="file-name">{s}</span>
            \\  <span class="coverage-badge {s}">{d:.0}%</span>
            \\</a>
            \\
        , .{
            item.html_filename,
            if (is_active) " active" else "",
            10 + (path_stack.items.len * 17), // Base padding of 26px + 17px per depth level
            file_basename,
            coverage_class,
            item.coverage * 100.0,
        });
    }

    // Close any remaining open folders
    var i = path_stack.items.len;
    while (i > 0) {
        i -= 1;
        for (0..i + 1) |_| {
            try writer.writeAll("  ");
        }
        try writer.writeAll("</details>\n");
    }
}

/// Writes the common HTML footer closing all tags
pub fn writePageFooter(writer: anytype) !void {
    try writer.writeAll("</body>\n</html>\n");
}

pub fn writeIndexPage(
    reports: []const Report,
    sidebar_items: []const SidebarItem,
    writer: anytype,
) !void {
    // Calculate overall statistics
    var total_functions: usize = 0;
    var covered_functions: usize = 0;
    var total_lines: usize = 0;
    var covered_lines: usize = 0;

    for (reports) |report| {
        const exec_lines = report.executable_lines.count();
        const covered_exec_lines = report.lines_which_have_executed.count();

        total_functions += report.functions_which_have_executed.bit_length;
        covered_functions += report.functions_which_have_executed.count();
        total_lines += exec_lines;
        covered_lines += covered_exec_lines;
    }

    const overall_functions = if (total_functions > 0) @as(f64, @floatFromInt(covered_functions)) / @as(f64, @floatFromInt(total_functions)) else 0.0;
    const overall_lines = if (total_lines > 0) @as(f64, @floatFromInt(covered_lines)) / @as(f64, @floatFromInt(total_lines)) else 0.0;

    // Write common page header (null for active_filename means index page is active)
    try writePageHeader("Coverage Report", sidebar_items, null, writer);

    // Write the main content specific to index page
    try writer.writeAll(
        \\  <div class="main-content index">
        \\    <div class="header">
        \\      <h1>Coverage Report</h1>
        \\    </div>
        \\    <div class="summary">
        \\      <div class="summary-grid">
        \\        <div class="summary-item">
        \\          <div class="summary-label">Overall Lines</div>
    );

    const lines_class = if (overall_lines >= 0.8) "good" else if (overall_lines >= 0.5) "medium" else "bad";
    try writer.print(
        \\          <div class="summary-value {s}">{d:.1}%</div>
        \\          <div class="summary-detail">{d} / {d} lines</div>
        \\        </div>
        \\        <div class="summary-item">
        \\          <div class="summary-label">Overall Functions</div>
    , .{
        lines_class,
        overall_lines * 100.0,
        covered_lines,
        total_lines,
    });

    const func_class = if (overall_functions >= 0.8) "good" else if (overall_functions >= 0.5) "medium" else "bad";
    try writer.print(
        \\          <div class="summary-value {s}">{d:.1}%</div>
        \\          <div class="summary-detail">{d} / {d} functions</div>
        \\        </div>
        \\        <div class="summary-item">
        \\          <div class="summary-label">Generated</div>
        \\          <div class="summary-value" style="font-size: 14px; color: #858585;">
    , .{
        func_class,
        overall_functions * 100.0,
        covered_functions,
        total_functions,
    });

    // Add timestamp
    const timestamp_ms = std.time.milliTimestamp();
    const seconds = @divTrunc(timestamp_ms, std.time.ms_per_s);
    const epoch_seconds = std.time.epoch.EpochSeconds{ .secs = @intCast(seconds) };
    const epoch_day = epoch_seconds.getEpochDay();
    const year_day = epoch_day.calculateYearDay();
    const month_day = year_day.calculateMonthDay();

    try writer.print("{d}-{d:0>2}-{d:0>2} {d:0>2}:{d:0>2}:{d:0>2}", .{
        year_day.year,
        month_day.month.numeric(),
        month_day.day_index + 1,
        epoch_seconds.getDaySeconds().getHoursIntoDay(),
        epoch_seconds.getDaySeconds().getMinutesIntoHour(),
        epoch_seconds.getDaySeconds().getSecondsIntoMinute(),
    });

    try writer.writeAll(
        \\          </div>
        \\        </div>
        \\      </div>
        \\    </div>
        \\    <div class="files-table">
        \\      <table>
        \\        <thead>
        \\          <tr>
        \\            <th>File</th>
        \\            <th class="coverage">Functions</th>
        \\            <th class="coverage">Lines</th>
        \\            <th>Uncovered Lines</th>
        \\          </tr>
        \\        </thead>
        \\        <tbody>
    );

    // Write each file's summary row
    for (reports, sidebar_items) |report, sidebar_item| {
        try writeFormatWithSidebarItem(&report, sidebar_item, writer);
    }

    try writer.writeAll(
        \\        </tbody>
        \\      </table>
        \\    </div>
    );

    try writePageFooter(writer);
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
