const Output = bun.Output;
const Global = bun.Global;
const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const Allocator = std.mem.Allocator;
const List = std.ArrayListUnmanaged;

const WHITESPACE: []const u8 = " \t\n\r";

// TODO: calculate this for different systems
const PAGE_SIZE = 16384;

const debug = bun.Output.scoped(.patch, false);

/// All strings point to the original patch file text
pub const PatchFilePart = union(enum) {
    file_patch: *FilePatch,
    file_deletion: *FileDeletion,
    file_creation: *FileCreation,
    file_rename: *FileRename,
    file_mode_change: *FileModeChange,

    pub fn deinit(this: *PatchFilePart, allocator: Allocator) void {
        switch (this.*) {
            .file_patch => this.file_patch.deinit(allocator),
            .file_deletion => this.file_deletion.deinit(allocator),
            .file_creation => this.file_creation.deinit(allocator),
            .file_rename => this.file_rename.deinit(allocator),
            .file_mode_change => this.file_mode_change.deinit(allocator),
        }
    }
};

pub const PatchFile = struct {
    parts: List(PatchFilePart) = .{},

    const ScratchBuffer = struct {
        buf: std.ArrayList(u8),

        fn deinit(scratch: *@This()) void {
            scratch.buf.deinit();
        }

        fn clear(scratch: *@This()) void {
            scratch.buf.clearRetainingCapacity();
        }

        fn dupeZ(scratch: *@This(), path: []const u8) [:0]const u8 {
            const start = scratch.buf.items.len;
            scratch.buf.appendSlice(path) catch unreachable;
            scratch.buf.append(0) catch unreachable;
            return scratch.buf.items[start .. start + path.len :0];
        }
    };

    pub fn deinit(this: *PatchFile, allocator: Allocator) void {
        for (this.parts.items) |*part| part.deinit(allocator);
        this.parts.deinit(allocator);
    }

    const ApplyState = struct {
        pathbuf: bun.PathBuffer = undefined,
        patch_dir_abs_path: ?[:0]const u8 = null,

        fn patchDirAbsPath(state: *@This(), fd: bun.FileDescriptor) JSC.Maybe([:0]const u8) {
            if (state.patch_dir_abs_path) |p| return .{ .result = p };
            return switch (bun.sys.getFdPath(fd, &state.pathbuf)) {
                .result => |p| {
                    state.patch_dir_abs_path = state.pathbuf[0..p.len :0];
                    return .{ .result = state.patch_dir_abs_path.? };
                },
                .err => |e| return .{ .err = e.withFd(fd) },
            };
        }
    };

    pub fn apply(this: *const PatchFile, allocator: Allocator, patch_dir: bun.FileDescriptor) ?JSC.SystemError {
        var state: ApplyState = .{};
        var sfb = std.heap.stackFallback(1024, allocator);
        var arena = bun.ArenaAllocator.init(sfb.get());

        for (this.parts.items) |*part| {
            defer _ = arena.reset(.retain_capacity);
            switch (part.*) {
                .file_deletion => {
                    const pathz = arena.allocator().dupeZ(u8, part.file_deletion.path) catch bun.outOfMemory();

                    if (bun.sys.unlinkat(patch_dir, pathz).asErr()) |e| {
                        return e.withPath(pathz).toSystemError();
                    }
                },
                .file_rename => {
                    const from_path = arena.allocator().dupeZ(u8, part.file_rename.from_path) catch bun.outOfMemory();
                    const to_path = arena.allocator().dupeZ(u8, part.file_rename.to_path) catch bun.outOfMemory();

                    if (std.fs.path.dirname(to_path)) |todir| {
                        const abs_patch_dir = switch (state.patchDirAbsPath(patch_dir)) {
                            .result => |p| p,
                            .err => |e| return e.toSystemError(),
                        };
                        const path_to_make = bun.path.joinZ(&[_][]const u8{
                            abs_patch_dir,
                            todir,
                        }, .auto);
                        var nodefs = bun.JSC.Node.NodeFS{};
                        if (nodefs.mkdirRecursive(.{
                            .path = .{ .string = bun.PathString.init(path_to_make) },
                            .recursive = true,
                            .mode = 0o755,
                        }, .sync).asErr()) |e| return e.toSystemError();
                    }

                    if (bun.sys.renameat(patch_dir, from_path, patch_dir, to_path).asErr()) |e| {
                        return e.toSystemError();
                    }
                },
                .file_creation => {
                    const filepath = bun.PathString.init(arena.allocator().dupeZ(u8, part.file_creation.path) catch bun.outOfMemory());
                    const filedir = bun.path.dirname(filepath.slice(), .auto);
                    const mode = part.file_creation.mode;

                    var nodefs = bun.JSC.Node.NodeFS{};
                    if (filedir.len > 0) {
                        if (nodefs.mkdirRecursive(.{
                            .path = .{ .string = bun.PathString.init(filedir) },
                            .recursive = true,
                            .mode = @intCast(@intFromEnum(mode)),
                        }, .sync).asErr()) |e| return e.toSystemError();
                    }

                    const newfile_fd = switch (bun.sys.openat(
                        patch_dir,
                        filepath.sliceAssumeZ(),
                        bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC,
                        mode.toBunMode(),
                    )) {
                        .result => |fd| fd,
                        .err => |e| return e.withPath(filepath.slice()).toSystemError(),
                    };
                    defer _ = bun.sys.close(newfile_fd);

                    const hunk = part.file_creation.hunk orelse {
                        continue;
                    };

                    const last_line = hunk.parts.items[0].lines.items.len -| 1;

                    const no_newline_at_end_of_file = hunk.parts.items[0].no_newline_at_end_of_file;

                    const count = count: {
                        var total: usize = 0;
                        for (hunk.parts.items[0].lines.items, 0..) |line, i| {
                            total += line.len;
                            total += @intFromBool(i < last_line);
                        }
                        total += @intFromBool(!no_newline_at_end_of_file);
                        break :count total;
                    };

                    const file_alloc = if (count <= PAGE_SIZE) arena.allocator() else bun.default_allocator;

                    // TODO: this additional allocation is probably not necessary in all cases and should be avoided or use stack buffer
                    const file_contents = brk: {
                        var contents = file_alloc.alloc(u8, count) catch bun.outOfMemory();
                        var i: usize = 0;
                        for (hunk.parts.items[0].lines.items, 0..) |line, idx| {
                            @memcpy(contents[i .. i + line.len], line);
                            i += line.len;
                            if (idx < last_line or !no_newline_at_end_of_file) {
                                contents[i] = '\n';
                                i += 1;
                            }
                        }
                        break :brk contents;
                    };
                    defer file_alloc.free(file_contents);

                    var written: usize = 0;
                    while (written < file_contents.len) {
                        switch (bun.sys.write(newfile_fd, file_contents[written..])) {
                            .result => |bytes| written += bytes,
                            .err => |e| return e.withPath(filepath.slice()).toSystemError(),
                        }
                    }
                },
                .file_patch => {
                    // TODO: should we compute the hash of the original file and check it against the on in the patch?
                    if (applyPatch(part.file_patch, &arena, patch_dir, &state).asErr()) |e| {
                        return e.toSystemError();
                    }
                },
                .file_mode_change => {
                    const newmode = part.file_mode_change.new_mode;
                    const filepath = arena.allocator().dupeZ(u8, part.file_mode_change.path) catch bun.outOfMemory();
                    if (comptime bun.Environment.isPosix) {
                        if (bun.sys.fchmodat(patch_dir, filepath, newmode.toBunMode(), 0).asErr()) |e| {
                            return e.toSystemError();
                        }
                    }

                    if (comptime bun.Environment.isWindows) {
                        const absfilepath = switch (state.patchDirAbsPath(patch_dir)) {
                            .result => |p| p,
                            .err => |e| return e.toSystemError(),
                        };
                        const fd = switch (bun.sys.open(bun.path.joinZ(&[_][]const u8{ absfilepath, filepath }, .auto), bun.O.RDWR, 0)) {
                            .err => |e| return e.toSystemError(),
                            .result => |f| f,
                        };
                        defer _ = bun.sys.close(fd);
                        if (bun.sys.fchmod(fd, newmode.toBunMode()).asErr()) |e| {
                            return e.toSystemError();
                        }
                    }
                },
            }
        }

        return null;
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
        arena: *bun.ArenaAllocator,
        patch_dir: bun.FileDescriptor,
        state: *ApplyState,
    ) JSC.Maybe(void) {
        const file_path: [:0]const u8 = arena.allocator().dupeZ(u8, patch.path) catch bun.outOfMemory();

        // Need to get the mode of the original file
        // And also get the size to read file into memory
        const stat = switch (if (bun.Environment.isPosix)
            bun.sys.fstatat(patch_dir, file_path)
        else
            bun.sys.stat(
                switch (state.patchDirAbsPath(patch_dir)) {
                    .result => |p| bun.path.joinZ(&[_][]const u8{ p, file_path }, .auto),
                    .err => |e| return .{ .err = e },
                },
            )) {
            .err => |e| return .{ .err = e.withPath(file_path) },
            .result => |stat| stat,
        };

        // Purposefully use `bun.default_allocator` here because if the file size is big like
        // 1gb we don't want to have 1gb hanging around in memory until arena is cleared
        //
        // But if the file size is small, like less than a single page, it's probably ok
        // to use the arena
        const use_arena: bool = stat.size <= PAGE_SIZE;
        const file_alloc = if (use_arena) arena.allocator() else bun.default_allocator;
        const filebuf = patch_dir.asDir().readFileAlloc(file_alloc, file_path, 1024 * 1024 * 1024 * 4) catch return .{ .err = bun.sys.Error.fromCode(.INVAL, .read).withPath(file_path) };
        defer file_alloc.free(filebuf);

        var file_line_count: usize = 0;
        const lines_count = brk: {
            var count: usize = 0;
            var iter = std.mem.splitScalar(u8, filebuf, '\n');
            while (iter.next()) |_| : (count += 1) {}
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

        // TODO: i hate this
        var lines = std.ArrayListUnmanaged([]const u8).initCapacity(bun.default_allocator, lines_count) catch bun.outOfMemory();
        defer lines.deinit(bun.default_allocator);
        {
            var iter = std.mem.splitScalar(u8, filebuf, '\n');
            var i: usize = 0;
            while (iter.next()) |line| : (i += 1) {
                lines.append(bun.default_allocator, line) catch bun.outOfMemory();
            }
            bun.debugAssert(i == file_line_count);
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
                        const lines_to_insert = lines.addManyAt(bun.default_allocator, line_cursor, part.lines.items.len) catch bun.outOfMemory();
                        @memcpy(lines_to_insert, part.lines.items);
                        line_cursor += @intCast(part.lines.items.len);
                        if (part.no_newline_at_end_of_file) {
                            _ = lines.pop();
                        }
                    },
                    .deletion => {
                        // TODO: check if the lines match in the original file?
                        lines.replaceRange(bun.default_allocator, line_cursor, part.lines.items.len, &.{}) catch bun.outOfMemory();
                        if (part.no_newline_at_end_of_file) {
                            lines.append(bun.default_allocator, "") catch bun.outOfMemory();
                        }
                        // line_cursor -= part.lines.items.len;
                    },
                }
            }
        }

        const file_fd = switch (bun.sys.openat(
            patch_dir,
            file_path,
            bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC,
            @intCast(stat.mode),
        )) {
            .err => |e| return .{ .err = e.withPath(file_path) },
            .result => |fd| fd,
        };
        defer {
            _ = bun.sys.close(file_fd);
        }

        const contents = std.mem.join(bun.default_allocator, "\n", lines.items) catch bun.outOfMemory();
        defer bun.default_allocator.free(contents);

        var written: usize = 0;
        while (written < contents.len) {
            written += switch (bun.sys.write(file_fd, contents[written..])) {
                .result => |w| w,
                .err => |e| return .{ .err = e.withPath(file_path) },
            };
        }

        return JSC.Maybe(void).success;
    }
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

    pub fn toBunMode(this: FileMode) bun.Mode {
        return @intCast(@intFromEnum(this));
    }

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

    /// Does not allocate
    pub fn deinit(_: *FileRename, _: Allocator) void {}
};

pub const FileModeChange = struct {
    path: []const u8,
    old_mode: FileMode,
    new_mode: FileMode,

    /// Does not allocate
    pub fn deinit(_: *FileModeChange, _: Allocator) void {}
};

pub const FilePatch = struct {
    path: []const u8,
    hunks: List(Hunk),
    before_hash: ?[]const u8,
    after_hash: ?[]const u8,

    pub fn deinit(this: *FilePatch, allocator: Allocator) void {
        for (this.hunks.items) |*hunk| hunk.deinit(allocator);
        this.hunks.deinit(allocator);
        bun.destroy(this);
    }
};

pub const FileDeletion = struct {
    path: []const u8,
    mode: FileMode,
    hunk: ?*Hunk,
    hash: ?[]const u8,

    pub fn deinit(this: *FileDeletion, allocator: Allocator) void {
        if (this.hunk) |hunk| hunk.deinit(allocator);
        bun.destroy(this);
    }
};

pub const FileCreation = struct {
    path: []const u8,
    mode: FileMode,
    hunk: ?*Hunk,
    hash: ?[]const u8,

    pub fn deinit(this: *FileCreation, allocator: Allocator) void {
        if (this.hunk) |hunk| hunk.deinit(allocator);
        bun.destroy(this);
    }
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
                            const value = file.hunks.items[0];
                            file.hunks.items[0] = .{
                                .header = Hunk.Header.zeroes,
                            };
                            break :brk bun.new(Hunk, value);
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
                            const value = file.hunks.items[0];
                            file.hunks.items[0] = .{
                                .header = Hunk.Header.zeroes,
                            };
                            break :brk bun.new(Hunk, value);
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
        if (file_.len == 0) return;
        const end = brk: {
            var iter = std.mem.splitBackwardsScalar(u8, file_, '\n');
            var prev: usize = file_.len;
            if (iter.next()) |last_line| {
                if (last_line.len == 0) {
                    prev = iter.index.?;
                }
            }
            break :brk prev;
        };
        if (end == 0 or end > file_.len) return;
        const file = file_[0..end];
        var lines = LookbackIterator.fromInner(std.mem.splitScalar(u8, file, '\n'));

        while (lines.next()) |line| {
            switch (this.state) {
                .parsing_header => {
                    if (bun.strings.hasPrefix(line, "@@")) {
                        this.state = .parsing_hunks;
                        this.current_file_patch.hunks = .{};
                        lines.back();
                    } else if (bun.strings.hasPrefix(line, "diff --git ")) {
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
                    } else if (bun.strings.hasPrefix(line, "old mode ")) {
                        this.current_file_patch.old_mode = std.mem.trim(u8, line["old mode ".len..], WHITESPACE);
                    } else if (bun.strings.hasPrefix(line, "new mode ")) {
                        this.current_file_patch.new_mode = std.mem.trim(u8, line["new mode ".len..], WHITESPACE);
                    } else if (bun.strings.hasPrefix(line, "deleted file mode ")) {
                        this.current_file_patch.deleted_file_mode = std.mem.trim(u8, line["deleted file mode ".len..], WHITESPACE);
                    } else if (bun.strings.hasPrefix(line, "new file mode ")) {
                        this.current_file_patch.new_file_mode = std.mem.trim(u8, line["new file mode ".len..], WHITESPACE);
                    } else if (bun.strings.hasPrefix(line, "rename from ")) {
                        this.current_file_patch.rename_from = std.mem.trim(u8, line["rename from ".len..], WHITESPACE);
                    } else if (bun.strings.hasPrefix(line, "rename to ")) {
                        this.current_file_patch.rename_to = std.mem.trim(u8, line["rename to ".len..], WHITESPACE);
                    } else if (bun.strings.hasPrefix(line, "index ")) {
                        const hashes = parseDiffHashes(line["index ".len..]) orelse continue;
                        this.current_file_patch.before_hash = hashes[0];
                        this.current_file_patch.after_hash = hashes[1];
                    } else if (bun.strings.hasPrefix(line, "--- ")) {
                        this.current_file_patch.from_path = std.mem.trim(u8, line["--- a/".len..], WHITESPACE);
                    } else if (bun.strings.hasPrefix(line, "+++ ")) {
                        this.current_file_patch.to_path = std.mem.trim(u8, line["+++ b/".len..], WHITESPACE);
                    }
                },
                .parsing_hunks => {
                    if (opts.support_legacy_diffs and bun.strings.hasPrefix(line, "--- a/")) {
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
                            if (!bun.strings.hasPrefix(line, "\\ No newline at end of file")) {
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

                            this.current_hunk_mutation_part.?.lines.append(bun.default_allocator, line[@min(1, line.len)..]) catch unreachable;
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
            var set = bun.bit_set.IntegerBitSet(256).initEmpty();
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
            .line_count = std.fmt.parseInt(u32, line_nr_count, 10) catch return ParseErr.bad_header_line,
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
        bun.debugAssert(!bun.strings.hasPrefix(line, "index "));

        // From @pnpm/patch-package the regex is this:
        // const match = line.match(/(\w+)\.\.(\w+)/)

        const delimiter_start = std.mem.indexOf(u8, line, "..") orelse return null;

        const VALID_CHARS: bun.bit_set.IntegerBitSet(256) = comptime brk: {
            var bitset = bun.bit_set.IntegerBitSet(256).initEmpty();
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
        const b_part_end = if (bun.strings.indexAnyComptime(line[b_part_start..], " \n\r\t")) |pos|
            pos + b_part_start
        else
            line.len;

        const b_part = line[b_part_start..b_part_end];
        for (a_part) |c| if (!VALID_CHARS.isSet(c)) return null;
        for (b_part) |c| if (!VALID_CHARS.isSet(c)) return null;

        return .{ a_part, b_part };
    }

    fn parseDiffLinePaths(line: []const u8) ?struct { []const u8, []const u8 } {
        // From @pnpm/patch-package the regex is this:
        // const match = line.match(/^diff --git a\/(.*?) b\/(.*?)\s*$/)

        const prefix = "diff --git a/";
        if (!bun.strings.hasPrefix(line, prefix)) return null;
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

pub const TestingAPIs = struct {
    pub fn makeDiff(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments_ = callframe.arguments_old(2);
        var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

        const old_folder_jsval = arguments.nextEat() orelse {
            return globalThis.throw("expected 2 strings", .{});
        };
        const old_folder_bunstr = old_folder_jsval.toBunString(globalThis);
        defer old_folder_bunstr.deref();

        const new_folder_jsval = arguments.nextEat() orelse {
            return globalThis.throw("expected 2 strings", .{});
        };
        const new_folder_bunstr = new_folder_jsval.toBunString(globalThis);
        defer new_folder_bunstr.deref();

        const old_folder = old_folder_bunstr.toUTF8(bun.default_allocator);
        defer old_folder.deinit();

        const new_folder = new_folder_bunstr.toUTF8(bun.default_allocator);
        defer new_folder.deinit();

        return switch (gitDiffInternal(bun.default_allocator, old_folder.slice(), new_folder.slice()) catch |e| {
            return globalThis.throwError(e, "failed to make diff");
        }) {
            .result => |s| {
                defer s.deinit();
                return bun.String.fromBytes(s.items).toJS(globalThis);
            },
            .err => |e| {
                defer e.deinit();
                return globalThis.throw("failed to make diff: {s}", .{e.items});
            },
        };
    }
    const ApplyArgs = struct {
        patchfile_txt: JSC.ZigString.Slice,
        patchfile: PatchFile,
        dirfd: bun.FileDescriptor,

        pub fn deinit(this: *ApplyArgs) void {
            this.patchfile_txt.deinit();
            this.patchfile.deinit(bun.default_allocator);
            if (bun.FileDescriptor.cwd().eq(this.dirfd)) {
                _ = bun.sys.close(this.dirfd);
            }
        }
    };
    pub fn apply(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        var args = switch (parseApplyArgs(globalThis, callframe)) {
            .err => |e| return e,
            .result => |a| a,
        };
        defer args.deinit();

        if (args.patchfile.apply(bun.default_allocator, args.dirfd)) |err| {
            return globalThis.throwValue(err.toErrorInstance(globalThis));
        }

        return .true;
    }
    /// Used in JS tests, see `internal-for-testing.ts` and patch tests.
    pub fn parse(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments_ = callframe.arguments_old(2);
        var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

        const patchfile_src_js = arguments.nextEat() orelse {
            return globalThis.throw("TestingAPIs.parse: expected at least 1 argument, got 0", .{});
        };
        const patchfile_src_bunstr = patchfile_src_js.toBunString(globalThis);
        const patchfile_src = patchfile_src_bunstr.toUTF8(bun.default_allocator);

        var patchfile = parsePatchFile(patchfile_src.slice()) catch |e| {
            if (e == error.hunk_header_integrity_check_failed) {
                return globalThis.throwError(e, "this indicates either that the supplied patch file was incorrect, or there is a bug in Bun. Please check your .patch file, or open a GitHub issue :)");
            } else {
                return globalThis.throwError(e, "failed to parse patch file");
            }
        };
        defer patchfile.deinit(bun.default_allocator);

        const str = try std.json.stringifyAlloc(bun.default_allocator, patchfile, .{});
        const outstr = bun.String.fromUTF8(str);
        return outstr.toJS(globalThis);
    }

    pub fn parseApplyArgs(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSC.Node.Maybe(ApplyArgs, JSC.JSValue) {
        const arguments_ = callframe.arguments_old(2);
        var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

        const patchfile_js = arguments.nextEat() orelse {
            globalThis.throw("apply: expected at least 1 argument, got 0", .{}) catch {};
            return .{ .err = .undefined };
        };

        const dir_fd = if (arguments.nextEat()) |dir_js| brk: {
            var bunstr = dir_js.toBunString(globalThis);
            defer bunstr.deref();
            const path = bunstr.toOwnedSliceZ(bun.default_allocator) catch unreachable;
            defer bun.default_allocator.free(path);

            break :brk switch (bun.sys.open(path, bun.O.DIRECTORY | bun.O.RDONLY, 0)) {
                .err => |e| {
                    globalThis.throwValue(e.withPath(path).toJSC(globalThis)) catch {};
                    return .{ .err = .undefined };
                },
                .result => |fd| fd,
            };
        } else bun.FileDescriptor.cwd();

        const patchfile_bunstr = patchfile_js.toBunString(globalThis);
        defer patchfile_bunstr.deref();
        const patchfile_src = patchfile_bunstr.toUTF8(bun.default_allocator);

        const patch_file = parsePatchFile(patchfile_src.slice()) catch |e| {
            if (bun.FileDescriptor.cwd().eq(dir_fd)) {
                _ = bun.sys.close(dir_fd);
            }

            patchfile_src.deinit();
            globalThis.throwError(e, "failed to parse patchfile") catch {};
            return .{ .err = .undefined };
        };

        return .{
            .result = ApplyArgs{
                .dirfd = dir_fd,
                .patchfile = patch_file,
                .patchfile_txt = patchfile_src,
            },
        };
    }
};

pub fn spawnOpts(
    old_folder: []const u8,
    new_folder: []const u8,
    cwd: [:0]const u8,
    git: [:0]const u8,
    loop: *JSC.AnyEventLoop,
) bun.spawn.sync.Options {
    const argv: []const []const u8 = brk: {
        const ARGV = &[_][:0]const u8{
            "git",
            "-c",
            "core.safecrlf=false",
            "diff",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--ignore-cr-at-eol",
            "--irreversible-delete",
            "--full-index",
            "--no-index",
        };
        const argv_buf = bun.default_allocator.alloc([]const u8, ARGV.len + 2) catch bun.outOfMemory();
        argv_buf[0] = git;
        for (1..ARGV.len) |i| {
            argv_buf[i] = ARGV[i];
        }
        argv_buf[ARGV.len] = old_folder;
        argv_buf[ARGV.len + 1] = new_folder;
        break :brk argv_buf;
    };

    const envp: [:null]?[*:0]const u8 = brk: {
        const env_arr = &[_][:0]const u8{
            "GIT_CONFIG_NOSYSTEM",
            "HOME",
            "XDG_CONFIG_HOME",
            "USERPROFILE",
        };
        const PATH = bun.getenvZ("PATH");
        const envp_buf = bun.default_allocator.allocSentinel(?[*:0]const u8, env_arr.len + @as(usize, if (PATH != null) 1 else 0), null) catch bun.outOfMemory();
        for (0..env_arr.len) |i| {
            envp_buf[i] = env_arr[i].ptr;
        }
        if (PATH) |p| {
            envp_buf[envp_buf.len - 1] = @ptrCast(p.ptr);
        }
        break :brk envp_buf;
    };

    return bun.spawn.sync.Options{
        .stdout = .buffer,
        .stderr = .buffer,
        .cwd = cwd,
        .envp = envp,
        .argv = argv,
        .windows = if (bun.Environment.isWindows) .{ .loop = switch (loop.*) {
            .js => |x| .{ .js = x },
            .mini => |*x| .{ .mini = x },
        } } else {},
    };
}

pub fn diffPostProcess(result: *bun.spawn.sync.Result, old_folder: []const u8, new_folder: []const u8) !bun.JSC.Node.Maybe(std.ArrayList(u8), std.ArrayList(u8)) {
    var stdout = std.ArrayList(u8).init(bun.default_allocator);
    var stderr = std.ArrayList(u8).init(bun.default_allocator);

    std.mem.swap(std.ArrayList(u8), &stdout, &result.stdout);
    std.mem.swap(std.ArrayList(u8), &stderr, &result.stderr);

    var deinit_stdout = true;
    var deinit_stderr = true;
    defer {
        if (deinit_stdout) stdout.deinit();
        if (deinit_stderr) stderr.deinit();
    }

    if (stderr.items.len > 0) {
        deinit_stderr = false;
        return .{ .err = stderr };
    }

    debug("Before postprocess: {s}\n", .{stdout.items});
    try gitDiffPostprocess(&stdout, old_folder, new_folder);
    deinit_stdout = false;
    return .{ .result = stdout };
}

pub fn gitDiffPreprocessPaths(
    allocator: std.mem.Allocator,
    old_folder_: []const u8,
    new_folder_: []const u8,
    comptime sentinel: bool,
) [2]if (sentinel) [:0]const u8 else []const u8 {
    const bump = if (sentinel) 1 else 0;
    const old_folder = if (comptime bun.Environment.isWindows) brk: {
        // backslash in the path fucks everything up
        const cpy = allocator.alloc(u8, old_folder_.len + bump) catch bun.outOfMemory();
        @memcpy(cpy[0..old_folder_.len], old_folder_);
        std.mem.replaceScalar(u8, cpy, '\\', '/');
        if (sentinel) {
            cpy[old_folder_.len] = 0;
            break :brk cpy[0..old_folder_.len :0];
        }
        break :brk cpy;
    } else old_folder_;
    const new_folder = if (comptime bun.Environment.isWindows) brk: {
        const cpy = allocator.alloc(u8, new_folder_.len + bump) catch bun.outOfMemory();
        @memcpy(cpy[0..new_folder_.len], new_folder_);
        std.mem.replaceScalar(u8, cpy, '\\', '/');
        if (sentinel) {
            cpy[new_folder_.len] = 0;
            break :brk cpy[0..new_folder_.len :0];
        }
        break :brk cpy;
    } else new_folder_;

    if (bun.Environment.isPosix and sentinel) {
        return .{
            allocator.dupeZ(u8, old_folder) catch bun.outOfMemory(),
            allocator.dupeZ(u8, new_folder) catch bun.outOfMemory(),
        };
    }

    return .{ old_folder, new_folder };
}

pub fn gitDiffInternal(
    allocator: std.mem.Allocator,
    old_folder_: []const u8,
    new_folder_: []const u8,
) !bun.JSC.Node.Maybe(std.ArrayList(u8), std.ArrayList(u8)) {
    const paths = gitDiffPreprocessPaths(allocator, old_folder_, new_folder_, false);
    const old_folder = paths[0];
    const new_folder = paths[1];

    defer if (comptime bun.Environment.isWindows) {
        allocator.free(old_folder);
        allocator.free(new_folder);
    };

    var child_proc = std.process.Child.init(
        &[_][]const u8{
            "git",
            "-c",
            "core.safecrlf=false",
            "diff",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--ignore-cr-at-eol",
            "--irreversible-delete",
            "--full-index",
            "--no-index",
            old_folder,
            new_folder,
        },
        allocator,
    );
    // unfortunately, git diff returns non-zero exit codes even when it succeeds.
    // we have to check that stderr was not empty to know if it failed
    child_proc.stdout_behavior = .Pipe;
    child_proc.stderr_behavior = .Pipe;
    var map = std.process.EnvMap.init(allocator);
    defer map.deinit();
    if (bun.getenvZ("PATH")) |v| try map.put("PATH", v);
    try map.put("GIT_CONFIG_NOSYSTEM", "1");
    try map.put("HOME", "");
    try map.put("XDG_CONFIG_HOME", "");
    try map.put("USERPROFILE", "");

    child_proc.env_map = &map;
    var stdout = std.ArrayList(u8).init(allocator);
    var stderr = std.ArrayList(u8).init(allocator);
    var deinit_stdout = true;
    var deinit_stderr = true;
    defer {
        if (deinit_stdout) stdout.deinit();
        if (deinit_stderr) stderr.deinit();
    }
    try child_proc.spawn();
    try child_proc.collectOutput(&stdout, &stderr, 1024 * 1024 * 4);
    _ = try child_proc.wait();
    if (stderr.items.len > 0) {
        deinit_stderr = false;
        return .{ .err = stderr };
    }

    debug("Before postprocess: {s}\n", .{stdout.items});
    try gitDiffPostprocess(&stdout, old_folder, new_folder);
    deinit_stdout = false;
    return .{ .result = stdout };
}

/// Now we need to do the equivalent of these regex subtitutions.
///
/// Assume that:
///   aFolder = old_folder = "the_old_folder"
///   bFolder = new_folder = "the_new_folder"
///
/// We use the --src-prefix=a/ and --dst-prefix=b/ options with git diff,
/// so the paths end up looking like so:
///
/// - a/the_old_folder/package.json
/// - b/the_old_folder/package.json
/// - a/the_older_folder/src/index.js
/// - b/the_older_folder/src/index.js
///
/// We need to strip out all references to "the_old_folder" and "the_new_folder":
/// - a/package.json
/// - b/package.json
/// - a/src/index.js
/// - b/src/index.js
///
/// The operations look roughy like the following sequence of substitutions and regexes:
///   .replace(new RegExp(`(a|b)(${escapeStringRegexp(`/${removeTrailingAndLeadingSlash(aFolder)}/`)})`, "g"), "$1/")
///   .replace(new RegExp(`(a|b)${escapeStringRegexp(`/${removeTrailingAndLeadingSlash(bFolder)}/`)}`, "g"), "$1/")
///   .replace(new RegExp(escapeStringRegexp(`${aFolder}/`), "g"), "")
///   .replace(new RegExp(escapeStringRegexp(`${bFolder}/`), "g"), "");
fn gitDiffPostprocess(stdout: *std.ArrayList(u8), old_folder: []const u8, new_folder: []const u8) !void {
    const old_folder_trimmed = std.mem.trim(u8, old_folder, "/");
    const new_folder_trimmed = std.mem.trim(u8, new_folder, "/");

    var old_buf: bun.PathBuffer = undefined;
    var new_buf: bun.PathBuffer = undefined;

    const @"a/$old_folder/", const @"b/$new_folder/" = brk: {
        old_buf[0] = 'a';
        old_buf[1] = '/';
        @memcpy(old_buf[2..][0..old_folder_trimmed.len], old_folder_trimmed);
        old_buf[2 + old_folder_trimmed.len] = '/';

        new_buf[0] = 'b';
        new_buf[1] = '/';
        @memcpy(new_buf[2..][0..new_folder_trimmed.len], new_folder_trimmed);
        new_buf[2 + new_folder_trimmed.len] = '/';

        break :brk .{ old_buf[0 .. 2 + old_folder_trimmed.len + 1], new_buf[0 .. 2 + new_folder_trimmed.len + 1] };
    };

    // const @"$old_folder/" = @"a/$old_folder/"[2..];
    // const @"$new_folder/" = @"b/$new_folder/"[2..];

    // these vars are here to disambguate `a/$OLD_FOLDER` when $OLD_FOLDER itself contains "a/"
    // basically if $OLD_FOLDER contains "a/" then the code will replace it
    // so we need to not run that code path
    var saw_a_folder: ?usize = null;
    var saw_b_folder: ?usize = null;
    var line_idx: u32 = 0;

    var line_iter = std.mem.splitScalar(u8, stdout.items, '\n');
    while (line_iter.next()) |line| {
        if (!shouldSkipLine(line)) {
            if (std.mem.indexOf(u8, line, @"a/$old_folder/")) |idx| {
                const @"$old_folder/ start" = idx + 2;
                const line_start = line_iter.index.? - 1 - line.len;
                line_iter.index.? -= 1 + line.len;
                try stdout.replaceRange(line_start + @"$old_folder/ start", old_folder_trimmed.len + 1, "");
                saw_a_folder = line_idx;
                continue;
            }
            if (std.mem.indexOf(u8, line, @"b/$new_folder/")) |idx| {
                const @"$new_folder/ start" = idx + 2;
                const line_start = line_iter.index.? - 1 - line.len;
                try stdout.replaceRange(line_start + @"$new_folder/ start", new_folder_trimmed.len + 1, "");
                line_iter.index.? -= new_folder_trimmed.len + 1;
                saw_b_folder = line_idx;
                continue;
            }
            if (saw_a_folder == null or saw_a_folder.? != line_idx) {
                if (std.mem.indexOf(u8, line, old_folder)) |idx| {
                    if (idx + old_folder.len < line.len and line[idx + old_folder.len] == '/') {
                        const line_start = line_iter.index.? - 1 - line.len;
                        line_iter.index.? -= 1 + line.len;
                        try stdout.replaceRange(line_start + idx, old_folder.len + 1, "");
                        saw_a_folder = line_idx;
                        continue;
                    }
                }
            }
            if (saw_b_folder == null or saw_b_folder.? != line_idx) {
                if (std.mem.indexOf(u8, line, new_folder)) |idx| {
                    if (idx + new_folder.len < line.len and line[idx + new_folder.len] == '/') {
                        const line_start = line_iter.index.? - 1 - line.len;
                        line_iter.index.? -= 1 + line.len;
                        try stdout.replaceRange(line_start + idx, new_folder.len + 1, "");
                        saw_b_folder = line_idx;
                        continue;
                    }
                }
            }
        }

        line_idx += 1;
        saw_a_folder = null;
        saw_b_folder = null;
    }
}

/// We need to remove occurences of "a/" and "b/" and "$old_folder/" and
/// "$new_folder/" but we don't want to remove them from the actual patch
/// content (maybe someone had a/$old_folder/foo.txt in the changed files).
///
/// To do that we have to skip the lines in the patch file that correspond
/// to changes.
///
/// ```patch
///
/// diff --git a/numbers.txt b/banana.txt
/// old mode 100644
/// new mode 100755
/// similarity index 96%
/// rename from numbers.txt
/// rename to banana.txt
/// index fbf1785..92d2c5f
/// --- a/numbers.txt
/// +++ b/banana.txt
/// @@ -1,4 +1,4 @@
/// -one
/// +ne
///
///  two
/// ```
fn shouldSkipLine(line: []const u8) bool {
    return line.len == 0 or
        (switch (line[0]) {
        ' ', '-', '+' => true,
        else => false,
    } and
        // line like: "--- a/numbers.txt" or "+++ b/numbers.txt" we should not skip
        (!(line.len >= 4 and (std.mem.eql(u8, line[0..4], "--- ") or std.mem.eql(u8, line[0..4], "+++ ")))));
}
