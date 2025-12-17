const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const Environment = bun.Environment;

/// Represents a range of changed lines
pub const LineRange = struct {
    start: u32,
    count: u32,
};

/// Represents changed line ranges in a single file
pub const ChangedFile = struct {
    path: []const u8,
    /// Bit set where each bit represents whether that line was changed (added/modified)
    /// Line numbers are 1-indexed in the bitset (bit 0 is unused, bit 1 = line 1)
    changed_lines: Bitset,
    total_lines: u32,

    /// Check if a line number (1-indexed) was changed
    pub fn isLineChanged(self: *const ChangedFile, line: u32) bool {
        if (line == 0 or line > self.total_lines) return false;
        return self.changed_lines.isSet(line);
    }
};

/// Map of file paths to their changed lines
pub const ChangedFilesMap = std.StringHashMapUnmanaged(ChangedFile);

/// Result of parsing git diff output
pub const GitDiffResult = struct {
    files: ChangedFilesMap,
    allocator: std.mem.Allocator,
    error_message: ?[]const u8 = null,

    pub fn deinit(self: *GitDiffResult) void {
        // Iterate over both keys and values to properly free all memory
        var iter = self.files.iterator();
        while (iter.next()) |entry| {
            // Free the bitset in ChangedFile
            entry.value_ptr.changed_lines.deinit(self.allocator);
            // Free the path string (key and value.path point to same allocation)
            self.allocator.free(entry.key_ptr.*);
        }
        self.files.deinit(self.allocator);
        if (self.error_message) |msg| {
            self.allocator.free(msg);
        }
    }

    pub fn getChangedFile(self: *const GitDiffResult, path: []const u8) ?*const ChangedFile {
        return self.files.getPtr(path);
    }
};

/// Parses git diff output to extract changed files and line numbers
/// The diff should be in unified format (git diff -U0)
pub fn parseGitDiff(allocator: std.mem.Allocator, diff_output: []const u8) !GitDiffResult {
    var result = GitDiffResult{
        .files = ChangedFilesMap{},
        .allocator = allocator,
    };
    errdefer result.deinit();

    var lines_iter = std.mem.splitScalar(u8, diff_output, '\n');
    var current_file: ?[]const u8 = null;
    var changed_lines_list = std.array_list.Managed(LineRange).init(allocator);
    defer changed_lines_list.deinit();

    while (lines_iter.next()) |line| {
        // Look for diff headers: +++ b/path/to/file
        if (std.mem.startsWith(u8, line, "+++ b/")) {
            // Save previous file's changes if any
            if (current_file) |file_path| {
                try saveChangedFile(&result.files, allocator, file_path, changed_lines_list.items);
                changed_lines_list.clearRetainingCapacity();
            }
            current_file = line[6..];
        }
        // Also handle +++ /dev/null for deleted files (skip them)
        else if (std.mem.startsWith(u8, line, "+++ /dev/null")) {
            current_file = null;
            changed_lines_list.clearRetainingCapacity();
        }
        // Look for hunk headers: @@ -old_start,old_count +new_start,new_count @@
        else if (std.mem.startsWith(u8, line, "@@") and current_file != null) {
            // Parse the +new_start,new_count part
            if (parseHunkHeader(line)) |hunk| {
                if (hunk.new_count > 0) {
                    try changed_lines_list.append(.{
                        .start = hunk.new_start,
                        .count = hunk.new_count,
                    });
                }
            }
        }
    }

    // Save last file's changes
    if (current_file) |file_path| {
        try saveChangedFile(&result.files, allocator, file_path, changed_lines_list.items);
    }

    return result;
}

const HunkInfo = struct {
    new_start: u32,
    new_count: u32,
};

fn parseHunkHeader(line: []const u8) ?HunkInfo {
    // Format: @@ -old_start,old_count +new_start,new_count @@
    // or: @@ -old_start +new_start,new_count @@
    // or: @@ -old_start,old_count +new_start @@
    // or: @@ -old_start +new_start @@

    // Find the + part
    const plus_idx = std.mem.indexOf(u8, line, " +") orelse return null;
    const after_plus = line[plus_idx + 2 ..];

    // Find the end of the new section (next space or @@)
    var end_idx: usize = 0;
    for (after_plus, 0..) |c, i| {
        if (c == ' ' or c == '@') {
            end_idx = i;
            break;
        }
    }
    if (end_idx == 0) end_idx = after_plus.len;

    const new_section = after_plus[0..end_idx];

    // Parse new_start,new_count
    if (std.mem.indexOf(u8, new_section, ",")) |comma_idx| {
        const start_str = new_section[0..comma_idx];
        const count_str = new_section[comma_idx + 1 ..];

        const new_start = std.fmt.parseInt(u32, start_str, 10) catch return null;
        const new_count = std.fmt.parseInt(u32, count_str, 10) catch return null;

        return HunkInfo{
            .new_start = new_start,
            .new_count = new_count,
        };
    } else {
        // No comma means count is 1
        const new_start = std.fmt.parseInt(u32, new_section, 10) catch return null;
        return HunkInfo{
            .new_start = new_start,
            .new_count = 1,
        };
    }
}

fn saveChangedFile(
    files: *ChangedFilesMap,
    allocator: std.mem.Allocator,
    file_path: []const u8,
    ranges: []const LineRange,
) !void {
    if (ranges.len == 0) return;

    // Find max line number to size the bitset
    var max_line: u32 = 0;
    for (ranges) |range| {
        const end_line = range.start + range.count - 1;
        if (end_line > max_line) max_line = end_line;
    }

    // Create bitset for changed lines (1-indexed, so need max_line + 1 bits)
    var changed_lines = try Bitset.initEmpty(allocator, max_line + 1);
    errdefer changed_lines.deinit(allocator);

    // Set bits for all changed lines
    for (ranges) |range| {
        var line = range.start;
        const end_line = range.start + range.count;
        while (line < end_line) : (line += 1) {
            changed_lines.set(line);
        }
    }

    // Duplicate the path since it points into the diff buffer
    const owned_path = try allocator.dupe(u8, file_path);
    errdefer allocator.free(owned_path);

    try files.put(allocator, owned_path, ChangedFile{
        .path = owned_path,
        .changed_lines = changed_lines,
        .total_lines = max_line,
    });
}

/// Runs git diff and returns the changed files map
/// base_branch: the branch to diff against (e.g., "main", "origin/main")
/// cwd: working directory for git command (null for current directory)
pub fn getChangedFiles(allocator: std.mem.Allocator, base_branch: []const u8, cwd: ?[]const u8) !GitDiffResult {
    var path_buf: bun.PathBuffer = undefined;
    const git_path = bun.which(&path_buf, bun.env_var.PATH.get() orelse "", cwd orelse "", "git") orelse {
        return GitDiffResult{
            .files = ChangedFilesMap{},
            .allocator = allocator,
            .error_message = try allocator.dupe(u8, "git is not installed or not in PATH"),
        };
    };

    // Run: git diff <base_branch>...HEAD -U0 --no-color
    // The ... syntax shows changes since the branches diverged
    const diff_ref = try std.fmt.allocPrint(allocator, "{s}...HEAD", .{base_branch});
    defer allocator.free(diff_ref);

    const proc = bun.spawnSync(&.{
        .argv = &.{ git_path, "diff", diff_ref, "-U0", "--no-color" },
        .stdout = .buffer,
        .stderr = .buffer,
        .stdin = .ignore,
        .cwd = cwd orelse "",
        .envp = null,
        .windows = if (Environment.isWindows) .{
            .loop = bun.jsc.EventLoopHandle.init(bun.jsc.MiniEventLoop.initGlobal(null, null)),
        } else {},
    }) catch |err| {
        return GitDiffResult{
            .files = ChangedFilesMap{},
            .allocator = allocator,
            .error_message = try std.fmt.allocPrint(allocator, "Failed to run git diff: {s}", .{@errorName(err)}),
        };
    };

    switch (proc) {
        .err => |err| {
            return GitDiffResult{
                .files = ChangedFilesMap{},
                .allocator = allocator,
                .error_message = try std.fmt.allocPrint(allocator, "Failed to spawn git process: {any}", .{err}),
            };
        },
        .result => |result| {
            defer result.deinit();

            if (!result.isOK()) {
                // Try the simpler diff if the three-dot syntax fails
                // (happens when base_branch doesn't exist or is the same as current)
                const proc2 = bun.spawnSync(&.{
                    .argv = &.{ git_path, "diff", base_branch, "-U0", "--no-color" },
                    .stdout = .buffer,
                    .stderr = .buffer,
                    .stdin = .ignore,
                    .cwd = cwd orelse "",
                    .envp = null,
                    .windows = if (Environment.isWindows) .{
                        .loop = bun.jsc.EventLoopHandle.init(bun.jsc.MiniEventLoop.initGlobal(null, null)),
                    } else {},
                }) catch |err| {
                    return GitDiffResult{
                        .files = ChangedFilesMap{},
                        .allocator = allocator,
                        .error_message = try std.fmt.allocPrint(allocator, "Failed to run git diff: {s}", .{@errorName(err)}),
                    };
                };

                switch (proc2) {
                    .err => |err2| {
                        return GitDiffResult{
                            .files = ChangedFilesMap{},
                            .allocator = allocator,
                            .error_message = try std.fmt.allocPrint(allocator, "Failed to spawn git process: {any}", .{err2}),
                        };
                    },
                    .result => |result2| {
                        defer result2.deinit();

                        if (!result2.isOK()) {
                            return GitDiffResult{
                                .files = ChangedFilesMap{},
                                .allocator = allocator,
                                .error_message = try std.fmt.allocPrint(allocator, "git diff failed: {s}", .{result2.stderr.items}),
                            };
                        }

                        return parseGitDiff(allocator, result2.stdout.items);
                    },
                }
            }

            return parseGitDiff(allocator, result.stdout.items);
        },
    }
}

test "parseHunkHeader" {
    // Standard format with counts
    {
        const res = parseHunkHeader("@@ -10,5 +20,3 @@ function foo()");
        try std.testing.expect(res != null);
        try std.testing.expectEqual(@as(u32, 20), res.?.new_start);
        try std.testing.expectEqual(@as(u32, 3), res.?.new_count);
    }

    // No old count
    {
        const res = parseHunkHeader("@@ -10 +20,3 @@");
        try std.testing.expect(res != null);
        try std.testing.expectEqual(@as(u32, 20), res.?.new_start);
        try std.testing.expectEqual(@as(u32, 3), res.?.new_count);
    }

    // No new count (single line change)
    {
        const res = parseHunkHeader("@@ -10,5 +20 @@");
        try std.testing.expect(res != null);
        try std.testing.expectEqual(@as(u32, 20), res.?.new_start);
        try std.testing.expectEqual(@as(u32, 1), res.?.new_count);
    }

    // Both single line
    {
        const res = parseHunkHeader("@@ -10 +20 @@");
        try std.testing.expect(res != null);
        try std.testing.expectEqual(@as(u32, 20), res.?.new_start);
        try std.testing.expectEqual(@as(u32, 1), res.?.new_count);
    }
}

test "parseGitDiff" {
    const diff =
        \\diff --git a/src/foo.ts b/src/foo.ts
        \\index 1234567..abcdefg 100644
        \\--- a/src/foo.ts
        \\+++ b/src/foo.ts
        \\@@ -10,3 +10,5 @@ function existing() {
        \\+  // new line
        \\+  console.log("hello");
        \\@@ -20,0 +22,2 @@
        \\+function newFunction() {
        \\+}
        \\diff --git a/src/bar.ts b/src/bar.ts
        \\new file mode 100644
        \\index 0000000..1234567
        \\--- /dev/null
        \\+++ b/src/bar.ts
        \\@@ -0,0 +1,10 @@
        \\+// new file content
    ;

    var res = try parseGitDiff(std.testing.allocator, diff);
    defer res.deinit();

    try std.testing.expectEqual(@as(usize, 2), res.files.count());

    // Check foo.ts changes
    const foo = res.files.get("src/foo.ts");
    try std.testing.expect(foo != null);
    try std.testing.expect(foo.?.isLineChanged(10));
    try std.testing.expect(foo.?.isLineChanged(11));
    try std.testing.expect(foo.?.isLineChanged(12));
    try std.testing.expect(foo.?.isLineChanged(13));
    try std.testing.expect(foo.?.isLineChanged(14));
    try std.testing.expect(foo.?.isLineChanged(22));
    try std.testing.expect(foo.?.isLineChanged(23));
    try std.testing.expect(!foo.?.isLineChanged(9));
    try std.testing.expect(!foo.?.isLineChanged(15));

    // Check bar.ts - new file with lines 1-10
    const bar = res.files.get("src/bar.ts");
    try std.testing.expect(bar != null);
    try std.testing.expect(bar.?.isLineChanged(1));
    try std.testing.expect(bar.?.isLineChanged(10));
    try std.testing.expect(!bar.?.isLineChanged(0));
    try std.testing.expect(!bar.?.isLineChanged(11));
}
