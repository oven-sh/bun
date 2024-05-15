const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const List = std.ArrayListUnmanaged;

const WHITESPACE: []const u8 = " \t\n\r";

/// All strings point to the original patch file text
pub const PatchFilePart = union(enum) {
    file_patch: *FilePatch,
    file_deletion: *FileDeletion,
    file_creation: *FileCreation,
    file_rename: *FileRename,
    file_mode_change: *FileModeChange,
};

pub const PatchFile = struct {
    parts: List(PatchFilePart) = .{},

    // TODO: should we compute the hash of the original file and check it against the one in the patch file?
    pub fn apply(this: *const PatchFile, patch_dir: []const u8) !void {
        try std.os.chdir(patch_dir);

        var file_contents_buf = std.ArrayListUnmanaged(u8){};
        defer file_contents_buf.deinit(bun.default_allocator);

        for (this.parts.items) |*part| {
            switch (part.*) {
                .file_deletion => {
                    try std.os.unlink(part.file_deletion.path);
                },
                .file_rename => {
                    try std.os.rename(part.file_rename.from_path, part.file_rename.to_path);
                },
                .file_creation => {
                    defer file_contents_buf.clearRetainingCapacity();
                    // TODO: create directories if it doesn't exist
                    try std.os.mkdir(std.fs.path.dirname(part.file_creation.path) orelse @panic("OOPS"), 0o777);
                    const hunk = part.file_creation.hunk orelse {
                        try std.fs.cwd().writeFile(part.file_creation.path, "");
                        continue;
                    };
                    const file_contents = brk: {
                        const count = count: {
                            var total: usize = 0;
                            for (hunk.parts.items[0].lines.items) |line| {
                                total += line.len;
                            }
                            break :count total;
                        };
                        try file_contents_buf.ensureTotalCapacity(bun.default_allocator, count);
                        var contents = file_contents_buf.items[0..count];
                        var i: usize = 0;
                        for (hunk.parts.items[0].lines.items) |line| {
                            @memcpy(contents[i .. i + line.len], line);
                            i += line.len;
                        }
                        break :brk contents;
                    };
                    try std.fs.cwd().writeFile(part.file_creation.path, file_contents);
                },
                .file_patch => {
                    try applyPatch(part.file_patch);
                },
                .file_mode_change => {},
            }
        }
    }

    /// Invariants:
    /// - Hunk parts are ordered by first to last in file
    /// - The original starting line and the patched starting line are equal in the first hunk part
    ///
    /// TODO: this is a very naive and slow implementation which works by creating a list of lines
    /// we can speed it up by:
    /// - If file size <= PAGE_SIZE, read the whole file into memory. memcpy/memmove the file contents around will be fast
    /// - If file size > PAGE_SIZE, rather than making a list of lines, make a list of chunks
    fn applyPatch(
        patch: *const FilePatch,
    ) !void {
        // TODO: calculate this for different targets
        const PAGE_SIZE = 16384;
        _ = PAGE_SIZE; // autofix

        const file_path: []const u8 = patch.path;

        const stat = try std.os.fstatat(std.fs.cwd().fd, file_path, 0);
        // if (stat.size <= PAGE_SIZE) {
        //     // try applyPatchSmall(patch);
        //     @panic("wait");
        // }

        const filebuf = try std.fs.cwd().readFileAlloc(bun.default_allocator, file_path, 1024 * 1024 * 1024 * 4);
        defer bun.default_allocator.free(filebuf);
        var file_line_count: usize = 0;
        const lines_count = brk: {
            var count: usize = 1;
            for (filebuf) |c| if (c == '\n') {
                count += 1;
            };
            file_line_count = count;

            // Adjust to account for the changes
            for (patch.hunks.items) |*hunk| {
                count = @intCast(@as(i64, @intCast(count)) + @as(i64, @intCast(hunk.header.patched.len)) - @as(i64, @intCast(hunk.header.original.len)));
                for (hunk.parts.items) |*part_| {
                    const part: *PatchMutationPart = part_;
                    switch (part.type) {
                        .deletion => {
                            // deleting the no newline pragma so we are actually adding a line
                            count += if (part.no_newline_at_end_of_file) 1 else 0;
                        },
                        .insertion => {
                            count -= if (part.no_newline_at_end_of_file) 1 else 0;
                        },
                        .context => {},
                    }
                }
            }

            break :brk count;
        };

        var lines = try std.ArrayListUnmanaged([]const u8).initCapacity(bun.default_allocator, lines_count);
        defer lines.deinit(bun.default_allocator);
        {
            var iter = std.mem.splitScalar(u8, filebuf, '\n');
            var i: usize = 0;
            while (iter.next()) |line| : (i += 1) {
                if (i >= lines_count) {
                    // TODO: return error
                    @panic("line count mismatch");
                }
                try lines.append(bun.default_allocator, line);
            }
        }

        for (patch.hunks.items) |*hunk| {
            var line_cursor = hunk.header.patched.start - 1;
            for (hunk.parts.items) |*part_| {
                const part: *PatchMutationPart = part_;
                switch (part.type) {
                    .context => {
                        // TODO: check if the lines match in the original file?
                        line_cursor += @intCast(part.lines.items.len);
                    },
                    .insertion => {
                        const lines_to_insert = try lines.addManyAt(bun.default_allocator, line_cursor, part.lines.items.len);
                        @memcpy(lines_to_insert, part.lines.items);
                        line_cursor += @intCast(part.lines.items.len);
                        if (part.no_newline_at_end_of_file) {
                            _ = lines.pop();
                        }
                    },
                    .deletion => {
                        // TODO: check if the lines match in the original file?
                        try lines.replaceRange(bun.default_allocator, line_cursor, part.lines.items.len, &.{});
                        if (part.no_newline_at_end_of_file) {
                            try lines.append(bun.default_allocator, "\n");
                        }
                        // line_cursor -= part.lines.items.len;
                    },
                }
            }
        }

        const contents = try std.mem.join(bun.default_allocator, "\n", lines.items);
        defer bun.default_allocator.free(contents);

        try std.fs.cwd().writeFile2(.{ .data = contents, .sub_path = file_path, .flags = .{ .mode = stat.mode } });
    }

    fn applyPatch2(patch: *const FilePatch) !void {
        const file_path: []const u8 = patch.path;
        const stat = try std.os.fstatat(std.fs.cwd().fd, file_path, 0);
        const srcfile = try std.os.mmap(null, stat.size, std.os.PROT.READ, std.os.MAP.SHARED, -1, 0);
        _ = srcfile; // autofix

        var result = List(u8){};
        defer result.deinit(bun.default_allocator);

        const last = patch.hunks.items.len -| 1;
        _ = last; // autofix
        for (patch.hunks.items, 0..) |*hunk, i| {
            _ = hunk; // autofix
            _ = i; // autofix

            // if (result.) {}
        }
    }

    // const Chunk = union(enum) {
    //     range: Range,
    //     hunk: *const Hunk,

    //     /// zero based line start and length
    //     const Range = struct { start: usize, len: usize };

    //     const Builder = struct {
    //         result: List(Chunk) = .{},

    //         fn build(
    //             this: *Builder,
    //             allocator: Allocator,
    //             patch: *const FilePatch,
    //             stat: std.os.Stat,
    //         ) !List(Chunk) {
    //             const file_size: usize = stat.size;

    //             const last = patch.hunks.items.len -| 1;
    //             for (patch.hunks.items, 0..) |*hunk, i| {
    //                 // Add a filler range to fill in the gaps between hunks
    //                 if (this.result.items.len == 0) {
    //                     this.result.append(
    //                         allocator,
    //                         .{ .range = .{ .start = 0, .len = hunk.header.original.start - 1 } },
    //                     ) catch unreachable;
    //                 } else {
    //                     var prev = &this.result.items[this.result.items.len - 1];
    //                     switch (prev) {
    //                         .range => {
    //                             const diff = hunk.header.original.start - 1 - (prev.range.start + prev.range.len);
    //                             prev.range.len += diff;
    //                         },
    //                         .hunk => {
    //                             const diff = hunk.header.original.start - 1 - (prev.hunk.header.original.start - 1 + prev.hunk.header.original.len);
    //                             const new_range: Range = .{
    //                                 .start = prev.hunk.header.original.start - 1 + prev.hunk.header.original.len,
    //                                 .len = diff,
    //                             };
    //                             try this.result.append(bun.default_allocator, .{ .range = new_range });
    //                         },
    //                     }
    //                 }

    //                 try this.result.append(bun.default_allocator, .{ .hunk = hunk });

    //                 if (i == last) {
    //                     const diff = file_size - (hunk.header.original.start - 1 + hunk.header.original.len);
    //                     const new_range: Range = .{
    //                         .start = hunk.header.original.start - 1 + hunk.header.original.len,
    //                         .len = diff,
    //                     };
    //                     try this.result.append(bun.default_allocator, .{ .range = new_range });
    //                 }
    //             }
    //         }
    //     };

    //     fn fromPatch(allocator: Allocator, patch: *const FilePatch) !List(Chunk) {
    //         var builder = .{};
    //         try builder.build(allocator, patch);
    //     }
    // };

    // fn applyPatchSmall(patch: *const FilePatch, stat: std.os.Stat) !void {
    //     const file_path: []const u8 = patch.path;
    //     const total_size = brk: {
    //         var total: usize = stat.size;
    //         for (patch.hunks.items) |*hunk| {
    //             total += @as(i64, @intCast(hunk.header.patched.len)) -
    //                 @as(i64, @intCast(hunk.header.original.len));
    //         }
    //         break :brk total;
    //     };

    //     var membuf = try bun.default_allocator.alloc(u8, total_size);
    //     _ = try std.fs.cwd().readFile(file_path, membuf);

    //     var cursor_line: usize = 0;
    //     var cursor_byte: usize = 0;
    //     for (patch.hunks.items) |*hunk| {
    //         const hunk_start = hunk.header.patched.start - 1;
    //         // not sure when this happens, maybe not necessary
    //         if (hunk_start < 0) continue;

    //         const line_diff = hunk_start - cursor_line;

    //         for (0..line_diff) |_| {
    //             cursor_byte += std.mem.indexOf(u8, membuf[cursor_byte..], '\n') + 1;
    //             cursor_line += 1;
    //         }

    //         for (hunk.parts.items) |*part_| {
    //             const part: *PatchMutationPart = part_;
    //             switch (part.type) {
    //                 .deletion,
    //             }
    //         }
    //     }
    // }
};

const FileDeets = struct {
    diff_line_from_path: ?[]const u8 = null,
    diff_line_to_path: ?[]const u8 = null,
    old_mode: ?[]const u8 = null,
    new_mode: ?[]const u8 = null,
    deleted_file_mode: ?[]const u8 = null,
    new_file_mode: ?[]const u8 = null,
    rename_from: ?[]const u8 = null,
    rename_to: ?[]const u8 = null,
    before_hash: ?[]const u8 = null,
    after_hash: ?[]const u8 = null,
    from_path: ?[]const u8 = null,
    to_path: ?[]const u8 = null,
    hunks: List(Hunk) = .{},

    fn takeHunks(this: *FileDeets) List(Hunk) {
        const hunks = this.hunks;
        this.hunks = .{};
        return hunks;
    }

    fn deinit(this: *FileDeets, allocator: Allocator) void {
        for (this.hunks.items) |*hunk| {
            hunk.deinit(allocator);
        }
        this.hunks.deinit(allocator);
    }

    fn nullifyEmptyStrings(this: *FileDeets) void {
        const fields: []const std.builtin.Type.StructField = std.meta.fields(FileDeets);

        inline for (fields) |field| {
            if (field.type == ?[]const u8) {
                const value = @field(this, field.name);
                if (value != null and value.?.len == 0) {
                    @field(this, field.name) = null;
                }
            }
        }
    }
};

pub const PatchMutationPart = struct {
    type: PartType,
    lines: List([]const u8) = .{},
    /// This technically can only be on the last part of a hunk
    no_newline_at_end_of_file: bool = false,

    /// Ensure context, insertion, deletion values are in sync with HunkLineType enum
    pub const PartType = enum(u2) { context = 0, insertion, deletion };

    pub fn deinit(this: *PatchMutationPart, allocator: Allocator) void {
        this.lines.deinit(allocator);
    }
};

pub const Hunk = struct {
    header: Header,
    parts: List(PatchMutationPart) = .{},

    pub const Header = struct {
        original: struct {
            start: u32,
            len: u32,
        },
        patched: struct {
            start: u32,
            len: u32,
        },

        pub const zeroes = std.mem.zeroes(Header);
    };

    pub fn deinit(this: *Hunk, allocator: Allocator) void {
        for (this.parts.items) |*part| {
            part.deinit(allocator);
        }
        this.parts.deinit(allocator);
    }

    pub fn verifyIntegrity(this: *const Hunk) bool {
        var original_length: usize = 0;
        var patched_length: usize = 0;

        for (this.parts.items) |part| {
            switch (part.type) {
                .context => {
                    patched_length += part.lines.items.len;
                    original_length += part.lines.items.len;
                },
                .insertion => patched_length += part.lines.items.len,
                .deletion => original_length += part.lines.items.len,
            }
        }

        if (original_length != this.header.original.len or patched_length != this.header.patched.len) return false;
        return true;
    }
};

pub const FileMode = enum(u32) {
    non_executable = 0o644,
    executable = 0o755,

    pub fn fromU32(mode: u32) ?FileMode {
        switch (mode) {
            0o644 => return .non_executable,
            0o755 => return .executable,
            else => return null,
        }
    }
};

pub const FileRename = struct {
    from_path: []const u8,
    to_path: []const u8,
};

pub const FileModeChange = struct {
    path: []const u8,
    old_mode: FileMode,
    new_mode: FileMode,
};

pub const FilePatch = struct {
    path: []const u8,
    hunks: List(Hunk),
    before_hash: ?[]const u8,
    after_hash: ?[]const u8,
};

pub const FileDeletion = struct {
    path: []const u8,
    mode: FileMode,
    hunk: ?*Hunk,
    hash: ?[]const u8,
};

pub const FileCreation = struct {
    path: []const u8,
    mode: FileMode,
    hunk: ?*Hunk,
    hash: ?[]const u8,
};

pub const PatchFilePartKind = enum {
    file_patch,
    file_deletion,
    file_creation,
    file_rename,
    file_mode_change,
};

const ParseErr = error{
    unrecognized_pragma,
    no_newline_at_eof_pragma_encountered_without_context,
    hunk_lines_encountered_before_hunk_header,
    hunk_header_integrity_check_failed,
    bad_diff_line,
    bad_header_line,
    rename_from_and_to_not_give,
    no_path_given_for_file_deletion,
    no_path_given_for_file_creation,
    bad_file_mode,
};

/// NOTE: the returned `PatchFile` struct will contain pointers to original file text so make sure to not deallocate `file`
pub fn parsePatchFile(file: []const u8) ParseErr!PatchFile {
    var lines_parser = PatchLinesParser{};
    defer lines_parser.deinit(bun.default_allocator, false);

    lines_parser.parse(file, .{}) catch |err| brk: {
        // TODO: the parser can be refactored to remove this as it is a hacky workaround, like detecting while parsing if legacy diffs are used
        if (err == ParseErr.hunk_header_integrity_check_failed) {
            lines_parser.reset(bun.default_allocator);
            break :brk try lines_parser.parse(file, .{ .support_legacy_diffs = true });
        }
        return err;
    };

    const files = lines_parser.result.items;
    return try patchFileSecondPass(files);
}

fn patchFileSecondPass(files: []FileDeets) ParseErr!PatchFile {
    var result: PatchFile = .{};

    for (files) |*file| {
        const ty: PatchFilePartKind = if (file.rename_from != null and file.rename_from.?.len > 0)
            .file_rename
        else if (file.deleted_file_mode != null and file.deleted_file_mode.?.len > 0)
            .file_deletion
        else if (file.new_file_mode != null and file.new_file_mode.?.len > 0)
            .file_creation
        else if (file.hunks.items.len > 0)
            .file_patch
        else
            .file_mode_change;

        var destination_file_path: ?[]const u8 = null;

        switch (ty) {
            .file_rename => {
                if (file.rename_from == null or file.rename_to == null) return ParseErr.rename_from_and_to_not_give;

                result.parts.append(
                    bun.default_allocator,
                    .{
                        .file_rename = bun.new(
                            FileRename,
                            FileRename{
                                .from_path = file.rename_from.?,
                                .to_path = file.rename_to.?,
                            },
                        ),
                    },
                ) catch unreachable;

                destination_file_path = file.rename_to;
            },
            .file_deletion => {
                const path = file.diff_line_from_path orelse file.from_path orelse {
                    return ParseErr.no_path_given_for_file_deletion;
                };
                result.parts.append(bun.default_allocator, .{
                    .file_deletion = bun.new(FileDeletion, FileDeletion{
                        .hunk = if (file.hunks.items.len > 0) brk: {
                            var value = file.hunks.items[0];
                            file.hunks.items[0] = .{
                                .header = Hunk.Header.zeroes,
                            };
                            break :brk bun.dupe(Hunk, &value);
                        } else null,
                        .path = path,
                        .mode = parseFileMode(file.deleted_file_mode.?) orelse {
                            return ParseErr.bad_file_mode;
                        },
                        .hash = file.before_hash,
                    }),
                }) catch unreachable;
            },
            .file_creation => {
                const path = file.diff_line_to_path orelse file.to_path orelse {
                    return ParseErr.no_path_given_for_file_creation;
                };
                result.parts.append(bun.default_allocator, .{
                    .file_creation = bun.new(FileCreation, FileCreation{
                        .hunk = if (file.hunks.items.len > 0) brk: {
                            var value = file.hunks.items[0];
                            file.hunks.items[0] = .{
                                .header = Hunk.Header.zeroes,
                            };
                            break :brk bun.dupe(Hunk, &value);
                        } else null,
                        .path = path,
                        .mode = parseFileMode(file.new_file_mode.?) orelse {
                            return ParseErr.bad_file_mode;
                        },
                        .hash = file.after_hash,
                    }),
                }) catch unreachable;
            },
            .file_patch, .file_mode_change => {
                destination_file_path = file.to_path orelse file.diff_line_to_path;
            },
        }

        if (destination_file_path != null and file.old_mode != null and file.new_mode != null and !std.mem.eql(u8, file.old_mode.?, file.new_mode.?)) {
            result.parts.append(bun.default_allocator, .{
                .file_mode_change = bun.new(FileModeChange, FileModeChange{
                    .path = destination_file_path.?,
                    .old_mode = parseFileMode(file.old_mode.?) orelse {
                        return ParseErr.bad_file_mode;
                    },
                    .new_mode = parseFileMode(file.new_mode.?) orelse {
                        return ParseErr.bad_file_mode;
                    },
                }),
            }) catch unreachable;
        }

        if (destination_file_path != null and file.hunks.items.len > 0) {
            result.parts.append(bun.default_allocator, .{
                .file_patch = bun.new(FilePatch, FilePatch{
                    .path = destination_file_path.?,
                    .hunks = file.takeHunks(),
                    .before_hash = file.before_hash,
                    .after_hash = file.after_hash,
                }),
            }) catch unreachable;
        }
    }

    return result;
}

fn parseFileMode(mode: []const u8) ?FileMode {
    const parsed_mode = (std.fmt.parseInt(u32, mode, 8) catch return null) & 0o777;
    return FileMode.fromU32(parsed_mode);
}

const LookbackIterator = struct {
    inner: std.mem.SplitIterator(u8, .scalar),
    prev_index: usize = 0,

    pub fn fromInner(inner: std.mem.SplitIterator(u8, .scalar)) LookbackIterator {
        return LookbackIterator{ .inner = inner };
    }

    pub fn next(this: *LookbackIterator) ?[]const u8 {
        this.prev_index = this.inner.index orelse this.prev_index;
        return this.inner.next();
    }

    pub fn back(this: *LookbackIterator) void {
        this.inner.index = this.prev_index;
    }
};

const PatchLinesParser = struct {
    result: List(FileDeets) = .{},
    current_file_patch: FileDeets = .{},
    state: State = .parsing_header,
    current_hunk: ?Hunk = null,
    current_hunk_mutation_part: ?PatchMutationPart = null,

    const State = enum { parsing_header, parsing_hunks };

    const HunkLineType = enum(u3) {
        /// Additional context
        context = 0,

        /// Example:
        /// + sjfskdjfsdf
        insertion,

        /// Example:
        /// - sjfskdjfsdf
        deletion,

        /// Example:
        /// @@ -1,3 +1,3 @@
        header,

        /// Example:
        /// \ No newline at end of file
        pragma,
    };

    fn deinit(this: *PatchLinesParser, allocator: Allocator, comptime clear_result_retaining_capacity: bool) void {
        this.current_file_patch.deinit(allocator);
        if (this.current_hunk) |*hunk| hunk.deinit(allocator);
        if (this.current_hunk_mutation_part) |*part| part.deinit(allocator);
        for (this.result.items) |*file_deet| file_deet.deinit(allocator);
        if (comptime clear_result_retaining_capacity) {
            this.result.clearRetainingCapacity();
        } else {
            this.result.deinit(allocator);
        }
    }

    fn reset(this: *PatchLinesParser, allocator: Allocator) void {
        this.deinit(allocator, true);
        this.result.clearRetainingCapacity();
        this.* = .{
            .result = this.result,
        };
    }

    pub fn parse(
        this: *PatchLinesParser,
        file_: []const u8,
        opts: struct { support_legacy_diffs: bool = false },
    ) ParseErr!void {
        const end = brk: {
            var iter = std.mem.splitBackwardsScalar(u8, file_, '\n');
            var prev: usize = file_.len;
            while (iter.next()) |last_line| {
                if (last_line.len == 0) {
                    prev = iter.index.?;
                } else break;
            }
            break :brk prev;
        };
        if (end == 0 or end > file_.len) return;
        const file = file_[0..end];
        var lines = LookbackIterator.fromInner(std.mem.splitScalar(u8, file, '\n'));

        while (lines.next()) |line| {
            switch (this.state) {
                .parsing_header => {
                    if (std.mem.startsWith(u8, line, "@@")) {
                        this.state = .parsing_hunks;
                        this.current_file_patch.hunks = .{};
                        lines.back();
                    } else if (std.mem.startsWith(u8, line, "diff --git ")) {
                        if (this.current_file_patch.diff_line_from_path != null) {
                            this.commitFilePatch();
                        }
                        // Equivalent to:
                        // const match = line.match(/^diff --git a\/(.*?) b\/(.*?)\s*$/)
                        // currentFilePatch.diffLineFromPath = match[1]
                        // currentFilePatch.diffLineToPath = match[2]
                        const match = parseDiffLinePaths(line) orelse {
                            // TODO: store line somewhere
                            return ParseErr.bad_diff_line;
                        };
                        this.current_file_patch.diff_line_from_path = match[0];
                        this.current_file_patch.diff_line_to_path = match[1];
                    } else if (std.mem.startsWith(u8, line, "old mode ")) {
                        this.current_file_patch.old_mode = std.mem.trim(u8, line["old mode ".len..], WHITESPACE);
                    } else if (std.mem.startsWith(u8, line, "new mode ")) {
                        this.current_file_patch.new_mode = std.mem.trim(u8, line["new mode ".len..], WHITESPACE);
                    } else if (std.mem.startsWith(u8, line, "deleted file mode ")) {
                        this.current_file_patch.deleted_file_mode = std.mem.trim(u8, line["deleted file mode ".len..], WHITESPACE);
                    } else if (std.mem.startsWith(u8, line, "new file mode ")) {
                        this.current_file_patch.new_file_mode = std.mem.trim(u8, line["new file mode ".len..], WHITESPACE);
                    } else if (std.mem.startsWith(u8, line, "rename from ")) {
                        this.current_file_patch.rename_from = std.mem.trim(u8, line["rename from ".len..], WHITESPACE);
                    } else if (std.mem.startsWith(u8, line, "rename to ")) {
                        this.current_file_patch.rename_to = std.mem.trim(u8, line["rename to ".len..], WHITESPACE);
                    } else if (std.mem.startsWith(u8, line, "index ")) {
                        const hashes = parseDiffHashes(line["index ".len..]) orelse continue;
                        this.current_file_patch.before_hash = hashes[0];
                        this.current_file_patch.after_hash = hashes[1];
                    } else if (std.mem.startsWith(u8, line, "--- ")) {
                        this.current_file_patch.from_path = std.mem.trim(u8, line["--- a/".len..], WHITESPACE);
                    } else if (std.mem.startsWith(u8, line, "+++ ")) {
                        this.current_file_patch.to_path = std.mem.trim(u8, line["+++ b/".len..], WHITESPACE);
                    }
                },
                .parsing_hunks => {
                    if (opts.support_legacy_diffs and std.mem.startsWith(u8, line, "--- a/")) {
                        this.state = .parsing_header;
                        this.commitFilePatch();
                        lines.back();
                        continue;
                    }
                    // parsing hunks
                    const hunk_line_type: HunkLineType = brk: {
                        if (line.len == 0)
                            // treat blank lines as context
                            break :brk .context;

                        break :brk switch (line[0]) {
                            '@' => @as(HunkLineType, .header),
                            '-' => @as(HunkLineType, .deletion),
                            '+' => @as(HunkLineType, .insertion),
                            ' ' => @as(HunkLineType, .context),
                            '\\' => @as(HunkLineType, .pragma),
                            '\r' => @as(HunkLineType, .context),
                            else => null,
                        } orelse {
                            // unrecognized, bail out
                            this.state = .parsing_header;
                            this.commitFilePatch();
                            lines.back();
                            continue;
                        };
                    };

                    switch (hunk_line_type) {
                        .header => {
                            this.commitHunk();
                            this.current_hunk = try parseHunkHeaderLine(line);
                        },
                        .pragma => {
                            if (!std.mem.startsWith(u8, line, "\\ No newline at end of file")) {
                                // TODO: store line
                                return ParseErr.unrecognized_pragma;
                            }
                            if (this.current_hunk_mutation_part == null) {
                                return ParseErr.no_newline_at_eof_pragma_encountered_without_context;
                            }
                            this.current_hunk_mutation_part.?.no_newline_at_end_of_file = true;
                        },
                        .insertion, .deletion, .context => {
                            if (this.current_hunk == null) {
                                return ParseErr.hunk_lines_encountered_before_hunk_header;
                            }
                            if (this.current_hunk_mutation_part != null and @intFromEnum(this.current_hunk_mutation_part.?.type) != @intFromEnum(hunk_line_type)) {
                                this.current_hunk.?.parts.append(bun.default_allocator, this.current_hunk_mutation_part.?) catch unreachable;
                                this.current_hunk_mutation_part = null;
                            }

                            if (this.current_hunk_mutation_part == null) {
                                this.current_hunk_mutation_part = .{
                                    .type = @enumFromInt(@intFromEnum(hunk_line_type)),
                                };
                            }

                            this.current_hunk_mutation_part.?.lines.append(bun.default_allocator, line[1..]) catch unreachable;
                        },
                    }
                },
            }
        }

        this.commitFilePatch();

        for (this.result.items) |file_deet| {
            for (file_deet.hunks.items) |hunk| {
                if (!hunk.verifyIntegrity()) {
                    return ParseErr.hunk_header_integrity_check_failed;
                }
            }
        }
    }

    fn commitHunk(this: *PatchLinesParser) void {
        if (this.current_hunk) |*hunk| {
            if (this.current_hunk_mutation_part) |mutation_part| {
                hunk.parts.append(bun.default_allocator, mutation_part) catch unreachable;
                this.current_hunk_mutation_part = null;
            }
            this.current_file_patch.hunks.append(bun.default_allocator, hunk.*) catch unreachable;
            this.current_hunk = null;
        }
    }

    fn commitFilePatch(this: *PatchLinesParser) void {
        this.commitHunk();
        this.current_file_patch.nullifyEmptyStrings();
        this.result.append(bun.default_allocator, this.current_file_patch) catch unreachable;
        this.current_file_patch = .{};
    }

    fn parseHunkHeaderLineImpl(text_: []const u8) ParseErr!struct { line_nr: u32, line_count: u32, rest: []const u8 } {
        var text = text_;
        const DIGITS = brk: {
            var set = std.bit_set.IntegerBitSet(256).initEmpty();
            for ('0'..'9' + 1) |c| set.set(c);
            break :brk set;
        };

        // @@ -100,32 +100,32 @@
        //     ^
        const line_nr_start: usize = 0;
        var line_nr_end: usize = 0;
        var saw_comma: bool = false;
        var saw_whitespace: bool = false;
        while (line_nr_end < text.len) {
            if (text[line_nr_end] == ',') {
                saw_comma = true;
                break;
            } else if (text[line_nr_end] == ' ') {
                saw_whitespace = true;
                break;
            }
            if (!DIGITS.isSet(text[line_nr_end])) return ParseErr.bad_header_line;
            line_nr_end += 1;
        }
        if (!saw_comma and !saw_whitespace) return ParseErr.bad_header_line;
        const line_nr = text[line_nr_start..line_nr_end];
        var line_nr_count: []const u8 = "1";
        if (line_nr_end + 1 >= text.len) return ParseErr.bad_header_line;

        text = text[line_nr_end..];
        if (text.len == 0) return ParseErr.bad_header_line;

        // @@ -100,32 +100,32 @@
        //        ^
        //        but the comma can be optional
        if (saw_comma) {
            text = text[1..];
            saw_whitespace = false;
            const first_col_start = 0;
            var first_col_end: usize = 0;
            while (first_col_end < text.len) {
                if (text[first_col_end] == ' ') {
                    saw_whitespace = true;
                    break;
                }
                if (!DIGITS.isSet(text[first_col_end])) return ParseErr.bad_header_line;
                first_col_end += 1;
            }
            if (!saw_whitespace) return ParseErr.bad_header_line;
            line_nr_count = text[first_col_start..first_col_end];
            text = text[first_col_end..];
        }

        return .{
            .line_nr = @max(1, std.fmt.parseInt(u32, line_nr, 10) catch return ParseErr.bad_header_line),
            .line_count = @max(1, std.fmt.parseInt(u32, line_nr_count, 10) catch return ParseErr.bad_header_line),
            .rest = text,
        };
    }

    fn parseHunkHeaderLine(line_: []const u8) ParseErr!Hunk {
        //  const match = headerLine.trim()
        //    .match(/^@@ -(\d+)(,(\d+))? \+(\d+)(,(\d+))? @@.*/)

        var line = std.mem.trim(u8, line_, WHITESPACE);
        // @@ -100,32 +100,32 @@
        // ^^^^
        // this part
        if (!(line.len >= 4 and line[0] == '@' and line[1] == '@' and line[2] == ' ' and line[3] == '-'))
            // TODO: store line
            return ParseErr.bad_header_line;

        if (line.len <= 4) return ParseErr.bad_header_line;

        // @@ -100,32 +100,32 @@
        //     ^
        line = line[4..];

        const first_result = try parseHunkHeaderLineImpl(line);
        // @@ -100,32 +100,32 @@
        //           ^
        line = first_result.rest;
        if (line.len < 2 or line[1] != '+') return ParseErr.bad_header_line;
        line = line[2..];

        const second_result = try parseHunkHeaderLineImpl(line);
        // @@ -100,32 +100,32 @@
        //                   ^
        line = second_result.rest;

        if (line.len >= 3 and line[0] == ' ' and line[1] == '@' and line[2] == '@') {
            return Hunk{
                .header = .{
                    .original = .{ .start = first_result.line_nr, .len = first_result.line_count },
                    .patched = .{ .start = second_result.line_nr, .len = second_result.line_count },
                },
            };
        }

        return ParseErr.bad_header_line;
    }

    fn parseDiffHashes(line: []const u8) ?struct { []const u8, []const u8 } {
        // index 2de83dd..842652c 100644
        //       ^
        //       we expect that we are here
        bun.debugAssert(!std.mem.startsWith(u8, line, "index "));

        // From @pnpm/patch-package the regex is this:
        // const match = line.match(/(\w+)\.\.(\w+)/)

        const delimiter_start = std.mem.indexOf(u8, line, "..") orelse return null;

        const VALID_CHARS: std.bit_set.IntegerBitSet(256) = comptime brk: {
            var bitset = std.bit_set.IntegerBitSet(256).initEmpty();
            // TODO: the regex uses \w which is [a-zA-Z0-9_]
            for ('0'..'9' + 1) |c| bitset.set(c);
            for ('a'..'z' + 1) |c| bitset.set(c);
            for ('A'..'Z' + 1) |c| bitset.set(c);
            bitset.set('_');
            break :brk bitset;
        };

        const a_part = line[0..delimiter_start];
        for (a_part) |c| if (!VALID_CHARS.isSet(c)) return null;

        const b_part_start = delimiter_start + 2;
        if (b_part_start >= line.len) return null;
        const lmao_bro = line[b_part_start..];
        std.mem.doNotOptimizeAway(lmao_bro);
        const b_part_end = if (std.mem.indexOfAny(u8, line[b_part_start..], " \n\r\t")) |pos| pos + b_part_start else line.len;

        const b_part = line[b_part_start..b_part_end];
        for (a_part) |c| if (!VALID_CHARS.isSet(c)) return null;
        for (b_part) |c| if (!VALID_CHARS.isSet(c)) return null;

        return .{ a_part, b_part };
    }

    fn parseDiffLinePaths(line: []const u8) ?struct { []const u8, []const u8 } {
        // From @pnpm/patch-package the regex is this:
        // const match = line.match(/^diff --git a\/(.*?) b\/(.*?)\s*$/)

        const prefix = "diff --git a/";
        if (!std.mem.startsWith(u8, line, prefix)) return null;
        // diff --git a/banana.ts b/banana.ts
        //              ^
        var rest = line[prefix.len..];
        if (rest.len == 0) return null;

        const a_path_start_index = 0;
        var a_path_end_index: usize = 0;
        var b_path_start_index: usize = 0;

        var i: usize = 0;
        while (true) {
            const start_of_b_part = std.mem.indexOfScalar(u8, rest[i..], 'b') orelse return null;
            i += start_of_b_part;
            if (i > 0 and rest[i - 1] == ' ' and i + 1 < rest.len and rest[i + 1] == '/') {
                // diff --git a/banana.ts b/banana.ts
                //                       ^  ^
                //                       |  |
                //    a_path_end_index   +  |
                //    b_path_start_index    +
                a_path_end_index = i - 1;
                b_path_start_index = i + 2;
                break;
            }
            i += 1;
        }

        const a_path = rest[a_path_start_index..a_path_end_index];
        const b_path = std.mem.trimRight(u8, rest[b_path_start_index..], " \n\r\t");
        return .{ a_path, b_path };
    }
};
