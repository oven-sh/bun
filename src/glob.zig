// Portions of this file are derived from works under the MIT License:
//
// Copyright (c) 2023 Devon Govett
// Copyright (c) 2023 Stephen Gregoratto
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
const std = @import("std");
const math = std.math;
const mem = std.mem;
const BunString = bun.String;
const expect = std.testing.expect;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;
const ArrayListManaged = std.ArrayList;
const DirIterator = @import("./bun.js/node/dir_iterator.zig");
const bun = @import("root").bun;
const Syscall = bun.sys;
const PathLike = @import("./bun.js/node/types.zig").PathLike;
const Maybe = @import("./bun.js/node/types.zig").Maybe;
const Dirent = @import("./bun.js/node/types.zig").Dirent;
const PathString = @import("./string_types.zig").PathString;
const ZigString = @import("./bun.js/bindings/bindings.zig").ZigString;
const isAllAscii = @import("./string_immutable.zig").isAllASCII;
const EntryKind = @import("./bun.js/node/types.zig").Dirent.Kind;
const Arena = std.heap.ArenaAllocator;
const GlobAscii = @import("./glob_ascii.zig");
const C = @import("./c.zig");
const ResolvePath = @import("./resolver/resolve_path.zig");
const eqlComptime = @import("./string_immutable.zig").eqlComptime;

const isWindows = @import("builtin").os.tag == .windows;

const CodepointIterator = @import("./string_immutable.zig").PackedCodepointIterator;
const Codepoint = CodepointIterator.Cursor.CodePointType;
// const Codepoint = u32;
const Cursor = CodepointIterator.Cursor;

const CursorState = struct {
    cursor: CodepointIterator.Cursor = .{},
    /// The index in terms of codepoints
    // cp_idx: usize,

    fn init(iterator: *const CodepointIterator) CursorState {
        var this_cursor: CodepointIterator.Cursor = .{};
        _ = iterator.next(&this_cursor);
        return .{
            // .cp_idx = 0,
            .cursor = this_cursor,
        };
    }

    /// Return cursor pos of next codepoint without modifying the current.
    ///
    /// NOTE: If there is no next codepoint (cursor is at the last one), then
    /// the returned cursor will have `c` as zero value and `i` will be >=
    /// sourceBytes.len
    fn peek(this: *const CursorState, iterator: *const CodepointIterator) CursorState {
        var cpy = this.*;
        // If outside of bounds
        if (!iterator.next(&cpy.cursor)) {
            // This will make `i >= sourceBytes.len`
            cpy.cursor.i += cpy.cursor.width;
            cpy.cursor.width = 1;
            cpy.cursor.c = CodepointIterator.ZeroValue;
        }
        // cpy.cp_idx += 1;
        return cpy;
    }

    fn bump(this: *CursorState, iterator: *const CodepointIterator) void {
        if (!iterator.next(&this.cursor)) {
            this.cursor.i += this.cursor.width;
            this.cursor.width = 1;
            this.cursor.c = CodepointIterator.ZeroValue;
        }
        // this.cp_idx += 1;
    }

    inline fn manualBumpAscii(this: *CursorState, i: u32, nextCp: Codepoint) void {
        this.cursor.i += i;
        this.cursor.c = nextCp;
        this.cursor.width = 1;
    }

    inline fn manualPeekAscii(this: *CursorState, i: u32, nextCp: Codepoint) CursorState {
        return .{
            .cursor = CodepointIterator.Cursor{
                .i = this.cursor.i + i,
                .c = @truncate(nextCp),
                .width = 1,
            },
        };
    }
};

pub const BunGlobWalker = GlobWalker_(null, false);

fn dummyFilterTrue(val: []const u8) bool {
    _ = val;
    return true;
}

fn dummyFilterFalse(val: []const u8) bool {
    _ = val;
    return false;
}

pub fn GlobWalker_(
    comptime ignore_filter_fn: ?*const fn ([]const u8) bool,
    comptime sentinel: bool,
) type {
    const is_ignored: *const fn ([]const u8) bool = if (comptime ignore_filter_fn) |func| func else dummyFilterFalse;
    const stdJoin = comptime if (!sentinel) std.fs.path.join else std.fs.path.joinZ;
    const bunJoin = comptime if (!sentinel) ResolvePath.join else ResolvePath.joinZ;
    const MatchedPath = comptime if (!sentinel) []const u8 else [:0]const u8;

    return struct {
        const GlobWalker = @This();
        pub const Result = Maybe(void);

        arena: Arena = undefined,

        /// not owned by this struct
        pattern: []const u8 = "",

        pattern_codepoints: []u32 = &[_]u32{},
        cp_len: u32 = 0,

        /// If the pattern contains "./" or "../"
        has_relative_components: bool = false,

        patternComponents: ArrayList(Component) = .{},
        matchedPaths: ArrayList(BunString) = .{},
        i: u32 = 0,

        dot: bool = false,
        absolute: bool = false,
        cwd: []const u8 = "",
        follow_symlinks: bool = false,
        error_on_broken_symlinks: bool = false,
        only_files: bool = true,

        pathBuf: [bun.MAX_PATH_BYTES]u8 = undefined,
        // iteration state
        workbuf: ArrayList(WorkItem) = ArrayList(WorkItem){},

        /// The glob walker references the .directory.path so its not safe to
        /// copy/move this
        const IterState = union(enum) {
            /// Pops the next item off the work stack
            get_next,
            /// Currently iterating over a directory
            directory: Directory,

            const Directory = struct {
                fd: bun.FileDescriptor,
                iter: DirIterator.WrappedIterator,
                path: [bun.MAX_PATH_BYTES]u8,
                dir_path: [:0]const u8,

                component_idx: u32,
                pattern: *Component,
                next_pattern: ?*Component,
                is_last: bool,

                iter_closed: bool = false,
                at_cwd: bool = false,
            };
        };

        pub const Iterator = struct {
            walker: *GlobWalker,
            iter_state: IterState = .get_next,
            cwd_fd: bun.FileDescriptor = .zero,
            empty_dir_path: [0:0]u8 = [0:0]u8{},
            /// This is to make sure in debug/tests that we are closing file descriptors
            /// We should only have max 2 open at a time. One for the cwd, and one for the
            /// directory being iterated on.
            fds_open: if (bun.Environment.allow_assert) usize else u0 = 0,

            pub fn init(this: *Iterator) !Maybe(void) {
                var path_buf: *[bun.MAX_PATH_BYTES]u8 = &this.walker.pathBuf;
                const root_path = this.walker.cwd;
                @memcpy(path_buf[0..root_path.len], root_path[0..root_path.len]);
                path_buf[root_path.len] = 0;
                const cwd_fd = switch (Syscall.open(@ptrCast(path_buf[0 .. root_path.len + 1]), std.os.O.DIRECTORY | std.os.O.RDONLY, 0)) {
                    .err => |err| return .{ .err = this.walker.handleSysErrWithPath(err, @ptrCast(path_buf[0 .. root_path.len + 1])) },
                    .result => |fd| fd,
                };

                if (bun.Environment.allow_assert) {
                    this.fds_open += 1;
                }

                this.cwd_fd = cwd_fd;

                const root_work_item = WorkItem.new(this.walker.cwd, 0, .directory);
                switch (try this.transitionToDirIterState(root_work_item, true)) {
                    .err => |err| return .{ .err = err },
                    else => {},
                }

                return Maybe(void).success;
            }

            pub fn deinit(this: *Iterator) void {
                this.closeCwdFd();
                switch (this.iter_state) {
                    .directory => |dir| {
                        if (!dir.iter_closed) {
                            this.closeDisallowingCwd(dir.fd);
                        }
                    },
                    else => {},
                }

                while (this.walker.workbuf.popOrNull()) |work_item| {
                    if (work_item.fd) |fd| {
                        this.closeDisallowingCwd(fd);
                    }
                }

                if (bun.Environment.allow_assert) {
                    std.debug.assert(this.fds_open == 0);
                }
            }

            pub fn closeCwdFd(this: *Iterator) void {
                if (this.cwd_fd == .zero) return;
                _ = Syscall.close(this.cwd_fd);
                if (bun.Environment.allow_assert) this.fds_open -= 1;
            }

            pub fn closeDisallowingCwd(this: *Iterator, fd: bun.FileDescriptor) void {
                if (fd == this.cwd_fd) return;
                _ = Syscall.close(fd);
                if (bun.Environment.allow_assert) this.fds_open -= 1;
            }

            pub fn bumpOpenFds(this: *Iterator) void {
                if (bun.Environment.allow_assert) {
                    this.fds_open += 1;
                    // If this is over 2 then this means that there is a bug in the iterator code
                    std.debug.assert(this.fds_open <= 2);
                }
            }

            fn transitionToDirIterState(
                this: *Iterator,
                work_item: WorkItem,
                comptime root: bool,
            ) !Maybe(void) {
                this.iter_state = .{ .directory = .{
                    .fd = .zero,
                    .iter = undefined,
                    .path = undefined,
                    .dir_path = undefined,
                    .component_idx = 0,
                    .pattern = undefined,
                    .next_pattern = null,
                    .is_last = false,
                    .iter_closed = false,
                    .at_cwd = false,
                } };

                var dir_path: [:0]u8 = dir_path: {
                    if (comptime root) {
                        if (!this.walker.absolute) {
                            this.iter_state.directory.path[0] = 0;
                            break :dir_path this.iter_state.directory.path[0..0 :0];
                        }
                    }
                    // TODO Optimization: On posix systems filepaths are already null byte terminated so we can skip this if thats the case
                    @memcpy(this.iter_state.directory.path[0..work_item.path.len], work_item.path);
                    this.iter_state.directory.path[work_item.path.len] = 0;
                    break :dir_path this.iter_state.directory.path[0..work_item.path.len :0];
                };

                var had_dot_dot = false;
                const component_idx = this.walker.skipSpecialComponents(work_item.idx, &dir_path, &this.iter_state.directory.path, &had_dot_dot);

                this.iter_state.directory.dir_path = dir_path;
                this.iter_state.directory.component_idx = component_idx;
                this.iter_state.directory.pattern = &this.walker.patternComponents.items[component_idx];
                this.iter_state.directory.next_pattern = if (component_idx + 1 < this.walker.patternComponents.items.len) &this.walker.patternComponents.items[component_idx + 1] else null;
                this.iter_state.directory.is_last = component_idx == this.walker.patternComponents.items.len - 1;
                this.iter_state.directory.at_cwd = false;

                const fd: bun.FileDescriptor = fd: {
                    if (work_item.fd) |fd| break :fd fd;
                    if (comptime root) {
                        if (had_dot_dot) break :fd switch (Syscall.openat(this.cwd_fd, dir_path, std.os.O.DIRECTORY | std.os.O.RDONLY, 0)) {
                            .err => |err| return .{
                                .err = this.walker.handleSysErrWithPath(err, dir_path),
                            },
                            .result => |fd_| brk: {
                                this.bumpOpenFds();
                                break :brk fd_;
                            },
                        };

                        this.iter_state.directory.at_cwd = true;
                        break :fd this.cwd_fd;
                    }

                    break :fd switch (Syscall.openat(this.cwd_fd, dir_path, std.os.O.DIRECTORY | std.os.O.RDONLY, 0)) {
                        .err => |err| return .{
                            .err = this.walker.handleSysErrWithPath(err, dir_path),
                        },
                        .result => |fd_| brk: {
                            this.bumpOpenFds();
                            break :brk fd_;
                        },
                    };
                };

                this.iter_state.directory.fd = fd;
                const iterator = DirIterator.iterate(fd.asDir(), .u8);
                this.iter_state.directory.iter = iterator;
                this.iter_state.directory.iter_closed = false;

                return Maybe(void).success;
            }

            pub fn next(this: *Iterator) !Maybe(?MatchedPath) {
                while (true) {
                    switch (this.iter_state) {
                        .get_next => {
                            // Done
                            if (this.walker.workbuf.items.len == 0) return .{ .result = null };
                            const work_item = this.walker.workbuf.pop();
                            switch (work_item.kind) {
                                .directory => {
                                    switch (try this.transitionToDirIterState(work_item, false)) {
                                        .err => |err| return .{ .err = err },
                                        else => {},
                                    }
                                    continue;
                                },
                                .symlink => {
                                    var scratch_path_buf: *[bun.MAX_PATH_BYTES]u8 = &this.walker.pathBuf;
                                    @memcpy(scratch_path_buf[0..work_item.path.len], work_item.path);
                                    scratch_path_buf[work_item.path.len] = 0;
                                    var symlink_full_path_z: [:0]u8 = scratch_path_buf[0..work_item.path.len :0];
                                    const entry_name = symlink_full_path_z[work_item.entry_start..symlink_full_path_z.len];

                                    var has_dot_dot = false;
                                    const component_idx = this.walker.skipSpecialComponents(work_item.idx, &symlink_full_path_z, scratch_path_buf, &has_dot_dot);
                                    var pattern = this.walker.patternComponents.items[component_idx];
                                    const next_pattern = if (component_idx + 1 < this.walker.patternComponents.items.len) &this.walker.patternComponents.items[component_idx + 1] else null;
                                    const is_last = component_idx == this.walker.patternComponents.items.len - 1;

                                    this.iter_state = .get_next;
                                    const maybe_dir_fd: ?bun.FileDescriptor = switch (Syscall.openat(this.cwd_fd, symlink_full_path_z, std.os.O.DIRECTORY | std.os.O.RDONLY, 0)) {
                                        .err => |err| brk: {
                                            if (@as(usize, @intCast(err.errno)) == @as(usize, @intFromEnum(bun.C.E.NOTDIR))) {
                                                break :brk null;
                                            }
                                            if (this.walker.error_on_broken_symlinks) return .{ .err = this.walker.handleSysErrWithPath(err, symlink_full_path_z) };
                                            // Broken symlink, but if `only_files` is false we still want to append
                                            // it to the matched paths
                                            if (!this.walker.only_files) {
                                                // (See case A and B in the comment for `matchPatternFile()`)
                                                // When we encounter a symlink we call the catch all
                                                // matching function: `matchPatternImpl()` to see if we can avoid following the symlink.
                                                // So for case A, we just need to check if the pattern is the last pattern.
                                                if (is_last or
                                                    (pattern.syntax_hint == .Double and
                                                    component_idx + 1 == this.walker.patternComponents.items.len -| 1 and
                                                    next_pattern.?.syntax_hint != .Double and
                                                    this.walker.matchPatternImpl(next_pattern.?, entry_name)))
                                                {
                                                    return .{ .result = try this.walker.prepareMatchedPathSymlink(symlink_full_path_z) };
                                                }
                                            }
                                            continue;
                                        },
                                        .result => |fd| brk: {
                                            this.bumpOpenFds();
                                            break :brk fd;
                                        },
                                    };

                                    const dir_fd = maybe_dir_fd orelse {
                                        // No directory file descriptor, it's a file
                                        if (is_last)
                                            return .{ .result = try this.walker.prepareMatchedPathSymlink(symlink_full_path_z) };

                                        if (pattern.syntax_hint == .Double and
                                            component_idx + 1 == this.walker.patternComponents.items.len -| 1 and
                                            next_pattern.?.syntax_hint != .Double and
                                            this.walker.matchPatternImpl(next_pattern.?, entry_name))
                                        {
                                            return .{ .result = try this.walker.prepareMatchedPathSymlink(symlink_full_path_z) };
                                        }

                                        continue;
                                    };

                                    var add_dir: bool = false;
                                    // TODO this function calls `matchPatternImpl(pattern,
                                    // entry_name)` which is redundant because we already called
                                    // that when we first encountered the symlink
                                    const recursion_idx_bump_ = this.walker.matchPatternDir(&pattern, next_pattern, entry_name, component_idx, is_last, &add_dir);

                                    if (recursion_idx_bump_) |recursion_idx_bump| {
                                        try this.walker.workbuf.append(
                                            this.walker.arena.allocator(),
                                            WorkItem.newWithFd(work_item.path, component_idx + recursion_idx_bump, .directory, dir_fd),
                                        );
                                    }

                                    if (add_dir and !this.walker.only_files) {
                                        return .{ .result = try this.walker.prepareMatchedPathSymlink(symlink_full_path_z) };
                                    }

                                    continue;
                                },
                            }
                        },
                        .directory => |*dir| {
                            const entry = switch (dir.iter.next()) {
                                .err => |err| {
                                    if (!dir.at_cwd) this.closeDisallowingCwd(dir.fd);
                                    dir.iter_closed = true;
                                    return .{ .err = this.walker.handleSysErrWithPath(err, dir.dir_path) };
                                },
                                .result => |ent| ent,
                            } orelse {
                                if (!dir.at_cwd) this.closeDisallowingCwd(dir.fd);
                                dir.iter_closed = true;
                                this.iter_state = .get_next;
                                continue;
                            };

                            const dir_iter_state: *const IterState.Directory = &this.iter_state.directory;

                            const entry_name = entry.name.slice();
                            switch (entry.kind) {
                                .file => {
                                    const matches = this.walker.matchPatternFile(entry_name, dir_iter_state.component_idx, dir.is_last, dir_iter_state.pattern, dir_iter_state.next_pattern);
                                    if (matches) {
                                        const prepared = try this.walker.prepareMatchedPath(entry_name, dir.dir_path);
                                        return .{ .result = prepared };
                                    }
                                    continue;
                                },
                                .directory => {
                                    var add_dir: bool = false;
                                    const recursion_idx_bump_ = this.walker.matchPatternDir(dir_iter_state.pattern, dir_iter_state.next_pattern, entry_name, dir_iter_state.component_idx, dir_iter_state.is_last, &add_dir);

                                    if (recursion_idx_bump_) |recursion_idx_bump| {
                                        const subdir_parts: []const []const u8 = &[_][]const u8{
                                            dir.dir_path[0..dir.dir_path.len],
                                            entry_name,
                                        };

                                        const subdir_entry_name = try this.walker.join(subdir_parts);

                                        try this.walker.workbuf.append(
                                            this.walker.arena.allocator(),
                                            WorkItem.new(subdir_entry_name, dir_iter_state.component_idx + recursion_idx_bump, .directory),
                                        );
                                    }

                                    if (add_dir and !this.walker.only_files) {
                                        const prepared_path = try this.walker.prepareMatchedPath(entry_name, dir.dir_path);
                                        return .{ .result = prepared_path };
                                    }

                                    continue;
                                },
                                .sym_link => {
                                    if (this.walker.follow_symlinks) {
                                        // Following a symlink requires additional syscalls, so
                                        // we first try it against our "catch-all" pattern match
                                        // function
                                        const matches = this.walker.matchPatternImpl(dir_iter_state.pattern, entry_name);
                                        if (!matches) continue;

                                        const subdir_parts: []const []const u8 = &[_][]const u8{
                                            dir.dir_path[0..dir.dir_path.len],
                                            entry_name,
                                        };
                                        const entry_start: u32 = @intCast(if (dir.dir_path.len == 0) 0 else dir.dir_path.len + 1);

                                        // const subdir_entry_name = try this.arena.allocator().dupe(u8, ResolvePath.join(subdir_parts, .auto));
                                        const subdir_entry_name = try this.walker.join(subdir_parts);

                                        try this.walker.workbuf.append(
                                            this.walker.arena.allocator(),
                                            WorkItem.newSymlink(subdir_entry_name, dir_iter_state.component_idx, entry_start),
                                        );

                                        continue;
                                    }

                                    if (this.walker.only_files) continue;

                                    const matches = this.walker.matchPatternFile(entry_name, dir_iter_state.component_idx, dir_iter_state.is_last, dir_iter_state.pattern, dir_iter_state.next_pattern);
                                    if (matches) {
                                        const prepared_path = try this.walker.prepareMatchedPath(entry_name, dir.dir_path);
                                        return .{ .result = prepared_path };
                                    }

                                    continue;
                                },
                                else => continue,
                            }
                        },
                    }
                }
            }
        };

        const WorkItem = struct {
            path: []const u8,
            idx: u32,
            kind: Kind,
            entry_start: u32 = 0,
            fd: ?bun.FileDescriptor = null,

            const Kind = enum {
                directory,
                symlink,
            };

            fn new(path: []const u8, idx: u32, kind: Kind) WorkItem {
                return .{
                    .path = path,
                    .idx = idx,
                    .kind = kind,
                };
            }

            fn newWithFd(path: []const u8, idx: u32, kind: Kind, fd: bun.FileDescriptor) WorkItem {
                return .{
                    .path = path,
                    .idx = idx,
                    .kind = kind,
                    .fd = fd,
                };
            }

            fn newSymlink(path: []const u8, idx: u32, entry_start: u32) WorkItem {
                return .{
                    .path = path,
                    .idx = idx,
                    .kind = .symlink,
                    .entry_start = entry_start,
                };
            }
        };

        /// A component is each part of a glob pattern, separated by directory
        /// separator:
        /// `src/**/*.ts` -> `src`, `**`, `*.ts`
        const Component = struct {
            start: u32,
            len: u32,

            syntax_hint: SyntaxHint = .None,
            is_ascii: bool = false,

            /// Only used when component is not ascii
            unicode_set: bool = false,
            start_cp: u32 = 0,
            end_cp: u32 = 0,

            const SyntaxHint = enum {
                None,
                Single,
                Double,
                /// Uses special fast-path matching for components like: `*.ts`
                WildcardFilepath,
                /// Uses special fast-patch matching for literal components e.g.
                /// "node_modules", becomes memcmp
                Literal,
                /// ./fixtures/*.ts
                /// ^
                Dot,
                /// ../
                DotBack,
            };
        };

        /// The arena parameter is dereferenced and copied if all allocations go well and nothing goes wrong
        pub fn init(
            this: *GlobWalker,
            arena: *Arena,
            pattern: []const u8,
            dot: bool,
            absolute: bool,
            follow_symlinks: bool,
            error_on_broken_symlinks: bool,
            only_files: bool,
        ) !Maybe(void) {
            errdefer arena.deinit();
            var cwd: []const u8 = undefined;
            switch (Syscall.getcwd(&this.pathBuf)) {
                .err => |err| {
                    return .{ .err = err };
                },
                .result => |result| {
                    const copiedCwd = try arena.allocator().alloc(u8, result.len);
                    @memcpy(copiedCwd, result);
                    cwd = copiedCwd;
                },
            }

            return try this.initWithCwd(
                arena,
                pattern,
                cwd,
                dot,
                absolute,
                follow_symlinks,
                error_on_broken_symlinks,
                only_files,
            );
        }

        pub fn convertUtf8ToCodepoints(codepoints: []u32, pattern: []const u8) void {
            _ = bun.simdutf.convert.utf8.to.utf32.le(pattern, codepoints);
        }

        /// `cwd` should be allocated with the arena
        /// The arena parameter is dereferenced and copied if all allocations go well and nothing goes wrong
        pub fn initWithCwd(
            this: *GlobWalker,
            arena: *Arena,
            pattern: []const u8,
            cwd: []const u8,
            dot: bool,
            absolute: bool,
            follow_symlinks: bool,
            error_on_broken_symlinks: bool,
            only_files: bool,
        ) !Maybe(void) {
            var patternComponents = ArrayList(Component){};
            try GlobWalker.buildPatternComponents(
                arena,
                &patternComponents,
                pattern,
                &this.cp_len,
                &this.pattern_codepoints,
                &this.has_relative_components,
            );

            this.cwd = cwd;

            this.patternComponents = patternComponents;
            this.pattern = pattern;
            this.arena = arena.*;
            this.dot = dot;
            this.absolute = absolute;
            this.follow_symlinks = follow_symlinks;
            this.error_on_broken_symlinks = error_on_broken_symlinks;
            this.only_files = only_files;

            return Maybe(void).success;
        }

        /// NOTE This also calls deinit on the arena, if you don't want to do that then
        pub fn deinit(this: *GlobWalker, comptime clear_arena: bool) void {
            if (comptime clear_arena) {
                this.arena.deinit();
            }
        }

        pub fn handleSysErrWithPath(
            this: *GlobWalker,
            err: Syscall.Error,
            path_buf: [:0]const u8,
        ) Syscall.Error {
            std.mem.copyForwards(u8, this.pathBuf[0 .. path_buf.len + 1], @as([]const u8, @ptrCast(path_buf[0 .. path_buf.len + 1])));
            return err.withPath(this.pathBuf[0 .. path_buf.len + 1]);
        }

        pub fn walk(this: *GlobWalker) !Maybe(void) {
            if (this.patternComponents.items.len == 0) return Maybe(void).success;

            var iter = GlobWalker.Iterator{ .walker = this };
            defer iter.deinit();
            switch (try iter.init()) {
                .err => |err| return .{ .err = err },
                else => {},
            }

            while (switch (try iter.next()) {
                .err => |err| return .{ .err = err },
                .result => |matched_path| matched_path,
            }) |path| {
                try this.matchedPaths.append(this.arena.allocator(), BunString.fromBytes(path));
            }

            return Maybe(void).success;
        }

        // NOTE you must check that the pattern at `idx` has `syntax_hint == .Dot` or
        // `syntax_hint == .DotBack` first
        fn collapseDots(
            this: *GlobWalker,
            idx: u32,
            dir_path: *[:0]u8,
            path_buf: *[bun.MAX_PATH_BYTES]u8,
            encountered_dot_dot: *bool,
        ) u32 {
            var component_idx = idx;
            var len = dir_path.len;
            while (component_idx < this.patternComponents.items.len) {
                switch (this.patternComponents.items[component_idx].syntax_hint) {
                    .Dot => {
                        defer component_idx += 1;
                        if (len + 2 >= bun.MAX_PATH_BYTES) @panic("Invalid path");
                        if (len == 0) {
                            path_buf[len] = '.';
                            path_buf[len + 1] = 0;
                            len += 1;
                        } else {
                            path_buf[len] = '/';
                            path_buf[len + 1] = '.';
                            path_buf[len + 2] = 0;
                            len += 2;
                        }
                    },
                    .DotBack => {
                        defer component_idx += 1;
                        encountered_dot_dot.* = true;
                        if (dir_path.len + 3 >= bun.MAX_PATH_BYTES) @panic("Invalid path");
                        if (len == 0) {
                            path_buf[len] = '.';
                            path_buf[len + 1] = '.';
                            path_buf[len + 2] = 0;
                            len += 2;
                        } else {
                            path_buf[len] = '/';
                            path_buf[len + 1] = '.';
                            path_buf[len + 2] = '.';
                            path_buf[len + 3] = 0;
                            len += 3;
                        }
                    },
                    else => break,
                }
            }

            dir_path.len = len;

            return component_idx;
        }

        // NOTE you must check that the pattern at `idx` has `syntax_hint == .Double` first
        fn collapseSuccessiveDoubleWildcards(this: *GlobWalker, idx: u32) u32 {
            var component_idx = idx;
            const pattern = this.patternComponents.items[idx];
            _ = pattern;
            // Collapse successive double wildcards
            while (component_idx + 1 < this.patternComponents.items.len and
                this.patternComponents.items[component_idx + 1].syntax_hint == .Double) : (component_idx += 1)
            {}
            return component_idx;
        }

        pub fn skipSpecialComponents(
            this: *GlobWalker,
            work_item_idx: u32,
            dir_path: *[:0]u8,
            scratch_path_buf: *[bun.MAX_PATH_BYTES]u8,
            encountered_dot_dot: *bool,
        ) u32 {
            var component_idx = work_item_idx;

            // Skip `.` and `..` while also appending them to `dir_path`
            component_idx = switch (this.patternComponents.items[component_idx].syntax_hint) {
                .Dot => this.collapseDots(
                    component_idx,
                    dir_path,
                    scratch_path_buf,
                    encountered_dot_dot,
                ),
                .DotBack => this.collapseDots(
                    component_idx,
                    dir_path,
                    scratch_path_buf,
                    encountered_dot_dot,
                ),
                else => component_idx,
            };

            // Skip to the last `**` if there is a chain of them
            component_idx = switch (this.patternComponents.items[component_idx].syntax_hint) {
                .Double => this.collapseSuccessiveDoubleWildcards(component_idx),
                else => component_idx,
            };

            return component_idx;
        }

        fn matchPatternDir(
            this: *GlobWalker,
            pattern: *Component,
            next_pattern: ?*Component,
            entry_name: []const u8,
            component_idx: u32,
            is_last: bool,
            add: *bool,
        ) ?u32 {
            if (!this.dot and GlobWalker.startsWithDot(entry_name)) return null;
            if (is_ignored(entry_name)) return null;

            // Handle double wildcard `**`, this could possibly
            // propagate the `**` to the directory's children
            if (pattern.syntax_hint == .Double) {
                // Stop the double wildcard if it matches the pattern afer it
                // Example: src/**/*.js
                // - Matches: src/bun.js/
                //            src/bun.js/foo/bar/baz.js
                if (!is_last and this.matchPatternImpl(next_pattern.?, entry_name)) {
                    // But if the next pattern is the last
                    // component, it should match and propagate the
                    // double wildcard recursion to the directory's
                    // children
                    if (component_idx + 1 == this.patternComponents.items.len - 1) {
                        add.* = true;
                        return 0;
                    }

                    // In the normal case skip over the next pattern
                    // since we matched it, example:
                    // BEFORE: src/**/node_modules/**/*.js
                    //              ^
                    //  AFTER: src/**/node_modules/**/*.js
                    //                             ^
                    return 2;
                }

                if (is_last) {
                    add.* = true;
                }

                return 0;
            }

            const matches = this.matchPatternImpl(pattern, entry_name);
            if (matches) {
                if (is_last) {
                    add.* = true;
                    return null;
                }
                return 1;
            }

            return null;
        }

        /// A file can only match if:
        /// a) it matches against the the last pattern, or
        /// b) it matches the next pattern, provided the current
        ///    pattern is a double wildcard and the next pattern is
        ///    not a double wildcard
        ///
        /// Examples:
        /// a -> `src/foo/index.ts` matches
        /// b -> `src/**/*.ts` (on 2nd pattern) matches
        fn matchPatternFile(
            this: *GlobWalker,
            entry_name: []const u8,
            component_idx: u32,
            is_last: bool,
            pattern: *Component,
            next_pattern: ?*Component,
        ) bool {
            // Handle case b)
            if (!is_last) return pattern.syntax_hint == .Double and
                component_idx + 1 == this.patternComponents.items.len -| 1 and
                next_pattern.?.syntax_hint != .Double and
                this.matchPatternImpl(next_pattern.?, entry_name);

            // Handle case a)
            return this.matchPatternImpl(pattern, entry_name);
        }

        fn matchPatternImpl(
            this: *GlobWalker,
            pattern_component: *Component,
            filepath: []const u8,
        ) bool {
            if (!this.dot and GlobWalker.startsWithDot(filepath)) return false;
            if (is_ignored(filepath)) return false;

            return switch (pattern_component.syntax_hint) {
                .Double, .Single => true,
                .WildcardFilepath => if (comptime !isWindows)
                    matchWildcardFilepath(this.pattern[pattern_component.start .. pattern_component.start + pattern_component.len], filepath)
                else
                    this.matchPatternSlow(pattern_component, filepath),
                .Literal => if (comptime !isWindows)
                    matchWildcardLiteral(this.pattern[pattern_component.start .. pattern_component.start + pattern_component.len], filepath)
                else
                    this.matchPatternSlow(pattern_component, filepath),
                else => this.matchPatternSlow(pattern_component, filepath),
            };
        }

        fn matchPatternSlow(this: *GlobWalker, pattern_component: *Component, filepath: []const u8) bool {
            // windows filepaths are utf-16 so GlobAscii.match will never work
            if (comptime !isWindows) {
                if (pattern_component.is_ascii and isAllAscii(filepath))
                    return GlobAscii.match(
                        this.pattern[pattern_component.start .. pattern_component.start + pattern_component.len],
                        filepath,
                    );
            }
            const codepoints = this.componentStringUnicode(pattern_component);
            return matchImpl(
                codepoints,
                filepath,
            );
        }

        fn componentStringUnicode(this: *GlobWalker, pattern_component: *Component) []const u32 {
            if (comptime isWindows) {
                return this.componentStringUnicodeWindows(pattern_component);
            } else {
                return this.componentStringUnicodePosix(pattern_component);
            }
        }

        fn componentStringUnicodeWindows(this: *GlobWalker, pattern_component: *Component) []const u32 {
            return this.pattern_codepoints[pattern_component.start_cp..pattern_component.end_cp];
        }

        fn componentStringUnicodePosix(this: *GlobWalker, pattern_component: *Component) []const u32 {
            if (pattern_component.unicode_set) return this.pattern_codepoints[pattern_component.start_cp..pattern_component.end_cp];

            const codepoints = this.pattern_codepoints[pattern_component.start_cp..pattern_component.end_cp];
            GlobWalker.convertUtf8ToCodepoints(
                codepoints,
                this.pattern[pattern_component.start .. pattern_component.start + pattern_component.len],
            );
            pattern_component.unicode_set = true;
            return codepoints;
        }

        fn prepareMatchedPathSymlink(this: *GlobWalker, symlink_full_path: []const u8) !MatchedPath {
            if (comptime !sentinel) return try this.arena.allocator().dupe(u8, symlink_full_path);
            return try this.arena.allocator().dupeZ(u8, symlink_full_path);
        }

        fn prepareMatchedPath(this: *GlobWalker, entry_name: []const u8, dir_name: [:0]const u8) !MatchedPath {
            const subdir_parts: []const []const u8 = &[_][]const u8{
                dir_name[0..dir_name.len],
                entry_name,
            };
            const name = try this.join(subdir_parts);
            // if (comptime sentinel) return name[0 .. name.len - 1 :0];
            return name;
        }

        fn appendMatchedPath(
            this: *GlobWalker,
            entry_name: []const u8,
            dir_name: [:0]const u8,
        ) !void {
            const subdir_parts: []const []const u8 = &[_][]const u8{
                dir_name[0..dir_name.len],
                entry_name,
            };
            const name = try this.join(subdir_parts);
            try this.matchedPaths.append(this.arena.allocator(), BunString.fromBytes(name));
        }

        fn appendMatchedPathSymlink(this: *GlobWalker, symlink_full_path: []const u8) !void {
            const name = try this.arena.allocator().dupe(u8, symlink_full_path);
            try this.matchedPaths.append(this.arena.allocator(), BunString.fromBytes(name));
        }

        inline fn join(this: *GlobWalker, subdir_parts: []const []const u8) !MatchedPath {
            if (!this.absolute) {
                // If relative paths enabled, stdlib join is preferred over
                // ResolvePath.joinBuf because it doesn't try to normalize the path
                return try stdJoin(this.arena.allocator(), subdir_parts);
            }

            const out = try this.arena.allocator().dupe(u8, bunJoin(subdir_parts, .auto));
            if (comptime sentinel) return out[0 .. out.len - 1 :0];

            return out;
        }

        inline fn startsWithDot(filepath: []const u8) bool {
            if (comptime !isWindows) {
                return filepath[0] == '.';
            } else {
                return filepath[1] == '.';
            }
        }

        fn hasLeadingDot(filepath: []const u8, comptime allow_non_utf8: bool) bool {
            if (comptime bun.Environment.isWindows and allow_non_utf8) {
                // utf-16
                if (filepath.len >= 4 and filepath[1] == '.' and filepath[3] == '/')
                    return true;
            } else {
                if (filepath.len >= 2 and filepath[0] == '.' and filepath[1] == '/')
                    return true;
            }

            return false;
        }

        /// NOTE This doesn't check that there is leading dot, use `hasLeadingDot()` to do that
        fn removeLeadingDot(filepath: []const u8, comptime allow_non_utf8: bool) []const u8 {
            if (comptime bun.Environment.allow_assert) std.debug.assert(hasLeadingDot(filepath, allow_non_utf8));
            if (comptime bun.Environment.isWindows and allow_non_utf8) {
                return filepath[4..];
            } else {
                return filepath[2..];
            }
        }

        fn checkSpecialSyntax(pattern: []const u8) bool {
            if (pattern.len < 16) {
                for (pattern[0..]) |c| {
                    switch (c) {
                        '*', '[', '{', '?', '!' => return true,
                        else => {},
                    }
                }
                return false;
            }

            const syntax_tokens = comptime [_]u8{ '*', '[', '{', '?', '!' };
            const needles: [syntax_tokens.len]@Vector(16, u8) = comptime needles: {
                var needles: [syntax_tokens.len]@Vector(16, u8) = undefined;
                for (syntax_tokens, 0..) |tok, i| {
                    needles[i] = @splat(tok);
                }
                break :needles needles;
            };

            var i: usize = 0;
            while (i + 16 <= pattern.len) : (i += 16) {
                const haystack: @Vector(16, u8) = pattern[i..][0..16].*;
                inline for (needles) |needle| {
                    if (std.simd.firstTrue(needle == haystack) != null) return true;
                }
            }

            if (i < pattern.len) {
                for (pattern[i..]) |c| {
                    inline for (syntax_tokens) |tok| {
                        if (c == tok) return true;
                    }
                }
            }

            return false;
        }

        fn addComponent(
            allocator: Allocator,
            pattern: []const u8,
            patternComponents: *ArrayList(Component),
            start_cp: u32,
            end_cp: u32,
            start_byte: u32,
            end_byte: u32,
            has_relative_patterns: *bool,
        ) !void {
            var component: Component = .{
                .start = start_byte,
                .len = end_byte - start_byte,
                .start_cp = start_cp,
                .end_cp = end_cp,
            };
            if (component.len == 0) return;

            out: {
                if (component.len == 1 and pattern[component.start] == '.') {
                    component.syntax_hint = .Dot;
                    has_relative_patterns.* = true;
                    break :out;
                }
                if (component.len == 2 and pattern[component.start] == '.' and pattern[component.start] == '.') {
                    component.syntax_hint = .DotBack;
                    has_relative_patterns.* = true;
                    break :out;
                }

                if (!GlobWalker.checkSpecialSyntax(pattern[component.start .. component.start + component.len])) {
                    component.syntax_hint = .Literal;
                    break :out;
                }

                switch (component.len) {
                    1 => {
                        if (pattern[component.start] == '*') {
                            component.syntax_hint = .Single;
                        }
                        break :out;
                    },
                    2 => {
                        if (pattern[component.start] == '*' and pattern[component.start + 1] == '*') {
                            component.syntax_hint = .Double;
                            break :out;
                        }
                    },
                    else => {},
                }

                out_of_check_wildcard_filepath: {
                    if (component.len > 1 and
                        pattern[component.start] == '*' and
                        pattern[component.start + 1] == '.' and
                        component.start + 2 < pattern.len)
                    {
                        for (pattern[component.start + 2 ..]) |c| {
                            switch (c) {
                                '[', '{', '!', '?' => break :out_of_check_wildcard_filepath,
                                else => {},
                            }
                        }
                        component.syntax_hint = .WildcardFilepath;
                        break :out;
                    }
                }
            }

            if (component.syntax_hint != .Single and component.syntax_hint != .Double) {
                if (isAllAscii(pattern[component.start .. component.start + component.len])) {
                    component.is_ascii = true;
                }
            } else {
                component.is_ascii = true;
            }

            try patternComponents.append(allocator, component);
        }

        fn buildPatternComponents(
            arena: *Arena,
            patternComponents: *ArrayList(Component),
            pattern: []const u8,
            out_cp_len: *u32,
            out_pattern_cp: *[]u32,
            has_relative_patterns: *bool,
        ) !void {
            var start_cp: u32 = 0;
            var start_byte: u32 = 0;

            const iter = CodepointIterator.init(pattern);
            var cursor = CodepointIterator.Cursor{};

            var cp_len: u32 = 0;
            var prevIsBackslash = false;
            while (iter.next(&cursor)) : (cp_len += 1) {
                const c = cursor.c;

                switch (c) {
                    '\\' => {
                        if (comptime isWindows) {
                            const end_cp = cp_len;
                            try addComponent(
                                arena.allocator(),
                                pattern,
                                patternComponents,
                                start_cp,
                                end_cp,
                                start_byte,
                                cursor.i,
                                has_relative_patterns,
                            );
                            start_cp = cp_len + 1;
                            start_byte = cursor.i + cursor.width;
                            continue;
                        }

                        if (prevIsBackslash) {
                            prevIsBackslash = false;
                            continue;
                        }

                        prevIsBackslash = true;
                    },
                    '/' => {
                        var end_cp = cp_len;
                        var end_byte = cursor.i;
                        // is last char
                        if (cursor.i + cursor.width == pattern.len) {
                            end_cp += 1;
                            end_byte += cursor.width;
                        }
                        try addComponent(
                            arena.allocator(),
                            pattern,
                            patternComponents,
                            start_cp,
                            end_cp,
                            start_byte,
                            end_byte,
                            has_relative_patterns,
                        );
                        start_cp = cp_len + 1;
                        start_byte = cursor.i + cursor.width;
                    },
                    // TODO: Support other escaping glob syntax
                    else => {},
                }
            }

            out_cp_len.* = cp_len;

            const codepoints = try arena.allocator().alloc(u32, cp_len);
            // On Windows filepaths are UTF-16 so its better to fill the codepoints buffer upfront
            if (comptime isWindows) {
                GlobWalker.convertUtf8ToCodepoints(codepoints, pattern);
            }
            out_pattern_cp.* = codepoints;

            const end_cp = cp_len;
            try addComponent(
                arena.allocator(),
                pattern,
                patternComponents,
                start_cp,
                end_cp,
                start_byte,
                @intCast(pattern.len),
                has_relative_patterns,
            );
        }
    };
}

// From: https://github.com/The-King-of-Toasters/globlin
/// State for matching a glob against a string
pub const GlobState = struct {
    // These store character indices into the glob and path strings.
    path_index: CursorState = .{},
    glob_index: u32 = 0,
    // When we hit a * or **, we store the state for backtracking.
    wildcard: Wildcard = .{},
    globstar: Wildcard = .{},

    fn init(path_iter: *const CodepointIterator) GlobState {
        var this = GlobState{};
        // this.glob_index = CursorState.init(glob_iter);
        this.path_index = CursorState.init(path_iter);
        return this;
    }

    fn skipBraces(self: *GlobState, glob: []const u32, stop_on_comma: bool) BraceState {
        var braces: u32 = 1;
        var in_brackets = false;
        while (self.glob_index < glob.len and braces > 0) : (self.glob_index += 1) {
            switch (glob[self.glob_index]) {
                // Skip nested braces
                '{' => if (!in_brackets) {
                    braces += 1;
                },
                '}' => if (!in_brackets) {
                    braces -= 1;
                },
                ',' => if (stop_on_comma and braces == 1 and !in_brackets) {
                    self.glob_index += 1;
                    return .Comma;
                },
                '*', '?', '[' => |c| if (!in_brackets) {
                    if (c == '[')
                        in_brackets = true;
                },
                ']' => in_brackets = false,
                '\\' => self.glob_index += 1,
                else => {},
            }
        }

        if (braces != 0)
            return .Invalid;
        return .EndBrace;
    }

    inline fn backtrack(self: *GlobState) void {
        self.glob_index = self.wildcard.glob_index;
        self.path_index = self.wildcard.path_index;
    }
};

const Wildcard = struct {
    // Using u32 rather than usize for these results in 10% faster performance.
    // glob_index: CursorState = .{},
    glob_index: u32 = 0,
    path_index: CursorState = .{},
};

const BraceState = enum { Invalid, Comma, EndBrace };

const BraceStack = struct {
    stack: [10]GlobState = undefined,
    len: u32 = 0,
    longest_brace_match: CursorState = .{},

    inline fn push(self: *BraceStack, state: *const GlobState) GlobState {
        self.stack[self.len] = state.*;
        self.len += 1;
        return GlobState{
            .path_index = state.path_index,
            .glob_index = state.glob_index + 1,
        };
    }

    inline fn pop(self: *BraceStack, state: *const GlobState) GlobState {
        self.len -= 1;
        const s = GlobState{
            .glob_index = state.glob_index,
            .path_index = self.longest_brace_match,
            // Restore star state if needed later.
            .wildcard = self.stack[self.len].wildcard,
            .globstar = self.stack[self.len].globstar,
        };
        if (self.len == 0)
            self.longest_brace_match = .{};
        return s;
    }

    inline fn last(self: *const BraceStack) *const GlobState {
        return &self.stack[self.len - 1];
    }
};

/// This function checks returns a boolean value if the pathname `path` matches
/// the pattern `glob`.
///
/// The supported pattern syntax for `glob` is:
///
/// "?"
///     Matches any single character.
/// "*"
///     Matches zero or more characters, except for path separators ('/' or '\').
/// "**"
///     Matches zero or more characters, including path separators.
///     Must match a complete path segment, i.e. followed by a path separator or
///     at the end of the pattern.
/// "[ab]"
///     Matches one of the characters contained in the brackets.
///     Character ranges (e.g. "[a-z]") are also supported.
///     Use "[!ab]" or "[^ab]" to match any character *except* those contained
///     in the brackets.
/// "{a,b}"
///     Match one of the patterns contained in the braces.
///     Any of the wildcards listed above can be used in the sub patterns.
///     Braces may be nested up to 10 levels deep.
/// "!"
///     Negates the result when at the start of the pattern.
///     Multiple "!" characters negate the pattern multiple times.
/// "\"
///     Used to escape any of the special characters above.
pub fn matchImpl(glob: []const u32, path: []const u8) bool {
    const path_iter = CodepointIterator.init(path);

    // This algorithm is based on https://research.swtch.com/glob
    var state = GlobState.init(&path_iter);
    // Store the state when we see an opening '{' brace in a stack.
    // Up to 10 nested braces are supported.
    var brace_stack = BraceStack{};

    // First, check if the pattern is negated with a leading '!' character.
    // Multiple negations can occur.
    var negated = false;
    while (state.glob_index < glob.len and glob[state.glob_index] == '!') {
        negated = !negated;
        state.glob_index += 1;
    }

    while (state.glob_index < glob.len or state.path_index.cursor.i < path.len) {
        if (state.glob_index < glob.len) {
            switch (glob[state.glob_index]) {
                '*' => {
                    const is_globstar = state.glob_index + 1 < glob.len and glob[state.glob_index + 1] == '*';
                    // const is_globstar = state.glob_index.cursor.i + state.glob_index.cursor.width < glob.len and
                    //     state.glob_index.peek(&glob_iter).cursor.c == '*';
                    if (is_globstar) {
                        // Coalesce multiple ** segments into one.
                        var index = state.glob_index + 2;
                        state.glob_index = skipGlobstars(glob, &index) - 2;
                    }

                    state.wildcard.glob_index = state.glob_index;
                    state.wildcard.path_index = state.path_index.peek(&path_iter);

                    // ** allows path separators, whereas * does not.
                    // However, ** must be a full path component, i.e. a/**/b not a**b.
                    if (is_globstar) {
                        // Skip wildcards
                        state.glob_index += 2;

                        if (glob.len == state.glob_index) {
                            // A trailing ** segment without a following separator.
                            state.globstar = state.wildcard;
                        } else if (glob[state.glob_index] == '/' and
                            (state.glob_index < 3 or glob[state.glob_index - 3] == '/'))
                        {
                            // Matched a full /**/ segment. If the last character in the path was a separator,
                            // skip the separator in the glob so we search for the next character.
                            // In effect, this makes the whole segment optional so that a/**/b matches a/b.
                            if (state.path_index.cursor.i == 0 or
                                (state.path_index.cursor.i < path.len and
                                isSeparator(path[state.path_index.cursor.i - 1])))
                            {
                                state.glob_index += 1;
                            }

                            // The allows_sep flag allows separator characters in ** matches.
                            // one is a '/', which prevents a/**/b from matching a/bb.
                            state.globstar = state.wildcard;
                        }
                    } else {
                        state.glob_index += 1;
                    }

                    // If we are in a * segment and hit a separator,
                    // either jump back to a previous ** or end the wildcard.
                    if (state.globstar.path_index.cursor.i != state.wildcard.path_index.cursor.i and
                        state.path_index.cursor.i < path.len and
                        isSeparator(state.path_index.cursor.c))
                    {
                        // Special case: don't jump back for a / at the end of the glob.
                        if (state.globstar.path_index.cursor.i > 0 and state.path_index.cursor.i + state.path_index.cursor.width < path.len) {
                            state.glob_index = state.globstar.glob_index;
                            state.wildcard.glob_index = state.globstar.glob_index;
                        } else {
                            state.wildcard.path_index.cursor.i = 0;
                        }
                    }

                    // If the next char is a special brace separator,
                    // skip to the end of the braces so we don't try to match it.
                    if (brace_stack.len > 0 and
                        state.glob_index < glob.len and
                        (glob[state.glob_index] == ',' or glob[state.glob_index] == '}'))
                    {
                        if (state.skipBraces(glob, false) == .Invalid)
                            return false; // invalid pattern!
                    }

                    continue;
                },
                '?' => if (state.path_index.cursor.i < path.len) {
                    if (!isSeparator(state.path_index.cursor.c)) {
                        state.glob_index += 1;
                        state.path_index.bump(&path_iter);
                        continue;
                    }
                },
                '[' => if (state.path_index.cursor.i < path.len) {
                    state.glob_index += 1;
                    const c = state.path_index.cursor.c;

                    // Check if the character class is negated.
                    var class_negated = false;
                    if (state.glob_index < glob.len and
                        (glob[state.glob_index] == '^' or glob[state.glob_index] == '!'))
                    {
                        class_negated = true;
                        state.glob_index += 1;
                    }

                    // Try each range.
                    var first = true;
                    var is_match = false;
                    while (state.glob_index < glob.len and (first or glob[state.glob_index] != ']')) {
                        var low = glob[state.glob_index];
                        if (!unescape(&low, glob, &state.glob_index))
                            return false; // Invalid pattern
                        state.glob_index += 1;

                        // If there is a - and the following character is not ],
                        // read the range end character.
                        const high = if (state.glob_index + 1 < glob.len and
                            glob[state.glob_index] == '-' and glob[state.glob_index + 1] != ']')
                        blk: {
                            state.glob_index += 1;
                            var h = glob[state.glob_index];
                            if (!unescape(&h, glob, &state.glob_index))
                                return false; // Invalid pattern!
                            state.glob_index += 1;
                            break :blk h;
                        } else low;

                        if (low <= c and c <= high)
                            is_match = true;
                        first = false;
                    }
                    if (state.glob_index >= glob.len)
                        return false; // Invalid pattern!
                    state.glob_index += 1;
                    if (is_match != class_negated) {
                        state.path_index.bump(&path_iter);
                        continue;
                    }
                },
                '{' => if (state.path_index.cursor.i < path.len) {
                    if (brace_stack.len >= brace_stack.stack.len)
                        return false; // Invalid pattern! Too many nested braces.

                    // Push old state to the stack, and reset current state.
                    state = brace_stack.push(&state);
                    continue;
                },
                '}' => if (brace_stack.len > 0) {
                    // If we hit the end of the braces, we matched the last option.
                    brace_stack.longest_brace_match = if (state.path_index.cursor.i >= brace_stack.longest_brace_match.cursor.i)
                        state.path_index
                    else
                        brace_stack.longest_brace_match;
                    state.glob_index += 1;
                    state = brace_stack.pop(&state);
                    continue;
                },
                ',' => if (brace_stack.len > 0) {
                    // If we hit a comma, we matched one of the options!
                    // But we still need to check the others in case there is a longer match.
                    brace_stack.longest_brace_match = if (state.path_index.cursor.i >= brace_stack.longest_brace_match.cursor.i)
                        state.path_index
                    else
                        brace_stack.longest_brace_match;
                    state.path_index = brace_stack.last().path_index;
                    state.glob_index += 1;
                    state.wildcard = Wildcard{};
                    state.globstar = Wildcard{};
                    continue;
                },
                else => |c| if (state.path_index.cursor.i < path.len) {
                    var cc = c;
                    // Match escaped characters as literals.
                    if (!unescape(&cc, glob, &state.glob_index))
                        return false; // Invalid pattern;

                    const is_match = if (cc == '/')
                        isSeparator(state.path_index.cursor.c)
                    else
                        state.path_index.cursor.c == cc;

                    if (is_match) {
                        if (brace_stack.len > 0 and
                            state.glob_index > 0 and
                            glob[state.glob_index - 1] == '}')
                        {
                            brace_stack.longest_brace_match = state.path_index;
                            state = brace_stack.pop(&state);
                        }
                        state.glob_index += 1;
                        state.path_index.bump(&path_iter);

                        // If this is not a separator, lock in the previous globstar.
                        if (cc != '/')
                            state.globstar.path_index.cursor.i = 0;

                        continue;
                    }
                },
            }
        }
        // If we didn't match, restore state to the previous star pattern.
        if (state.wildcard.path_index.cursor.i > 0 and state.wildcard.path_index.cursor.i <= path.len) {
            state.backtrack();
            continue;
        }

        if (brace_stack.len > 0) {
            // If in braces, find next option and reset path to index where we saw the '{'
            switch (state.skipBraces(glob, true)) {
                .Invalid => return false,
                .Comma => {
                    state.path_index = brace_stack.last().path_index;
                    continue;
                },
                .EndBrace => {},
            }

            // Hit the end. Pop the stack.
            // If we matched a previous option, use that.
            if (brace_stack.longest_brace_match.cursor.i > 0) {
                state = brace_stack.pop(&state);
                continue;
            } else {
                // Didn't match. Restore state, and check if we need to jump back to a star pattern.
                state = brace_stack.last().*;
                brace_stack.len -= 1;
                if (state.wildcard.path_index.cursor.i > 0 and state.wildcard.path_index.cursor.i <= path.len) {
                    state.backtrack();
                    continue;
                }
            }
        }

        return negated;
    }

    return !negated;
}

pub inline fn isSeparator(c: Codepoint) bool {
    if (comptime @import("builtin").os.tag == .windows) return c == '/' or c == '\\';
    return c == '/';
}

inline fn unescape(c: *u32, glob: []const u32, glob_index: *u32) bool {
    if (c.* == '\\') {
        glob_index.* += 1;
        if (glob_index.* >= glob.len)
            return false; // Invalid pattern!

        c.* = switch (glob[glob_index.*]) {
            'a' => '\x61',
            'b' => '\x08',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            else => |cc| cc,
        };
    }

    return true;
}

const GLOB_STAR_MATCH_STR: []const u32 = &[_]u32{ '/', '*', '*' };
// src/**/**/foo.ts
inline fn skipGlobstars(glob: []const u32, glob_index: *u32) u32 {
    // Coalesce multiple ** segments into one.
    while (glob_index.* + 3 <= glob.len and
        // std.mem.eql(u8, glob[glob_index.*..][0..3], "/**"))
        std.mem.eql(u32, glob[glob_index.*..][0..3], GLOB_STAR_MATCH_STR))
    {
        glob_index.* += 3;
    }

    return glob_index.*;
}

const MatchAscii = struct {};

pub fn matchWildcardFilepath(glob: []const u8, path: []const u8) bool {
    const needle = glob[1..];
    const needle_len: u32 = @intCast(needle.len);
    if (path.len < needle_len) return false;
    return std.mem.eql(u8, needle, path[path.len - needle_len ..]);
}

pub fn matchWildcardLiteral(literal: []const u8, path: []const u8) bool {
    return std.mem.eql(u8, literal, path);
}

// test "basic" {
//     try expect(match("abc", "abc"));
//     try expect(match("*", "abc"));
//     try expect(match("*", ""));
//     try expect(match("**", ""));
//     try expect(match("*c", "abc"));
//     try expect(!match("*b", "abc"));
//     try expect(match("a*", "abc"));
//     try expect(!match("b*", "abc"));
//     try expect(match("a*", "a"));
//     try expect(match("*a", "a"));
//     try expect(match("a*b*c*d*e*", "axbxcxdxe"));
//     try expect(match("a*b*c*d*e*", "axbxcxdxexxx"));
//     try expect(match("a*b?c*x", "abxbbxdbxebxczzx"));
//     try expect(!match("a*b?c*x", "abxbbxdbxebxczzy"));

//     try expect(match("a/*/test", "a/foo/test"));
//     try expect(!match("a/*/test", "a/foo/bar/test"));
//     try expect(match("a/**/test", "a/foo/test"));
//     try expect(match("a/**/test", "a/foo/bar/test"));
//     try expect(match("a/**/b/c", "a/foo/bar/b/c"));
//     try expect(match("a\\*b", "a*b"));
//     try expect(!match("a\\*b", "axb"));

//     try expect(match("[abc]", "a"));
//     try expect(match("[abc]", "b"));
//     try expect(match("[abc]", "c"));
//     try expect(!match("[abc]", "d"));
//     try expect(match("x[abc]x", "xax"));
//     try expect(match("x[abc]x", "xbx"));
//     try expect(match("x[abc]x", "xcx"));
//     try expect(!match("x[abc]x", "xdx"));
//     try expect(!match("x[abc]x", "xay"));
//     try expect(match("[?]", "?"));
//     try expect(!match("[?]", "a"));
//     try expect(match("[*]", "*"));
//     try expect(!match("[*]", "a"));

//     try expect(match("[a-cx]", "a"));
//     try expect(match("[a-cx]", "b"));
//     try expect(match("[a-cx]", "c"));
//     try expect(!match("[a-cx]", "d"));
//     try expect(match("[a-cx]", "x"));

//     try expect(!match("[^abc]", "a"));
//     try expect(!match("[^abc]", "b"));
//     try expect(!match("[^abc]", "c"));
//     try expect(match("[^abc]", "d"));
//     try expect(!match("[!abc]", "a"));
//     try expect(!match("[!abc]", "b"));
//     try expect(!match("[!abc]", "c"));
//     try expect(match("[!abc]", "d"));
//     try expect(match("[\\!]", "!"));

//     try expect(match("a*b*[cy]*d*e*", "axbxcxdxexxx"));
//     try expect(match("a*b*[cy]*d*e*", "axbxyxdxexxx"));
//     try expect(match("a*b*[cy]*d*e*", "axbxxxyxdxexxx"));

//     try expect(match("test.{jpg,png}", "test.jpg"));
//     try expect(match("test.{jpg,png}", "test.png"));
//     try expect(match("test.{j*g,p*g}", "test.jpg"));
//     try expect(match("test.{j*g,p*g}", "test.jpxxxg"));
//     try expect(match("test.{j*g,p*g}", "test.jxg"));
//     try expect(!match("test.{j*g,p*g}", "test.jnt"));
//     try expect(match("test.{j*g,j*c}", "test.jnc"));
//     try expect(match("test.{jpg,p*g}", "test.png"));
//     try expect(match("test.{jpg,p*g}", "test.pxg"));
//     try expect(!match("test.{jpg,p*g}", "test.pnt"));
//     try expect(match("test.{jpeg,png}", "test.jpeg"));
//     try expect(!match("test.{jpeg,png}", "test.jpg"));
//     try expect(match("test.{jpeg,png}", "test.png"));
//     try expect(match("test.{jp\\,g,png}", "test.jp,g"));
//     try expect(!match("test.{jp\\,g,png}", "test.jxg"));
//     try expect(match("test/{foo,bar}/baz", "test/foo/baz"));
//     try expect(match("test/{foo,bar}/baz", "test/bar/baz"));
//     try expect(!match("test/{foo,bar}/baz", "test/baz/baz"));
//     try expect(match("test/{foo*,bar*}/baz", "test/foooooo/baz"));
//     try expect(match("test/{foo*,bar*}/baz", "test/barrrrr/baz"));
//     try expect(match("test/{*foo,*bar}/baz", "test/xxxxfoo/baz"));
//     try expect(match("test/{*foo,*bar}/baz", "test/xxxxbar/baz"));
//     try expect(match("test/{foo/**,bar}/baz", "test/bar/baz"));
//     try expect(!match("test/{foo/**,bar}/baz", "test/bar/test/baz"));

//     try expect(!match("*.txt", "some/big/path/to/the/needle.txt"));
//     try expect(match(
//         "some/**/needle.{js,tsx,mdx,ts,jsx,txt}",
//         "some/a/bigger/path/to/the/crazy/needle.txt",
//     ));
//     try expect(match(
//         "some/**/{a,b,c}/**/needle.txt",
//         "some/foo/a/bigger/path/to/the/crazy/needle.txt",
//     ));
//     try expect(!match(
//         "some/**/{a,b,c}/**/needle.txt",
//         "some/foo/d/bigger/path/to/the/crazy/needle.txt",
//     ));
//     try expect(match("a/{a{a,b},b}", "a/aa"));
//     try expect(match("a/{a{a,b},b}", "a/ab"));
//     try expect(!match("a/{a{a,b},b}", "a/ac"));
//     try expect(match("a/{a{a,b},b}", "a/b"));
//     try expect(!match("a/{a{a,b},b}", "a/c"));
//     try expect(match("a/{b,c[}]*}", "a/b"));
//     try expect(match("a/{b,c[}]*}", "a/c}xx"));
// }

// // The below tests are based on Bash and micromatch.
// // https://github.com/micromatch/picomatch/blob/master/test/bash.js
// test "bash" {
//     try expect(!match("a*", "*"));
//     try expect(!match("a*", "**"));
//     try expect(!match("a*", "\\*"));
//     try expect(!match("a*", "a/*"));
//     try expect(!match("a*", "b"));
//     try expect(!match("a*", "bc"));
//     try expect(!match("a*", "bcd"));
//     try expect(!match("a*", "bdir/"));
//     try expect(!match("a*", "Beware"));
//     try expect(match("a*", "a"));
//     try expect(match("a*", "ab"));
//     try expect(match("a*", "abc"));

//     try expect(!match("\\a*", "*"));
//     try expect(!match("\\a*", "**"));
//     try expect(!match("\\a*", "\\*"));

//     try expect(match("\\a*", "a"));
//     try expect(!match("\\a*", "a/*"));
//     try expect(match("\\a*", "abc"));
//     try expect(match("\\a*", "abd"));
//     try expect(match("\\a*", "abe"));
//     try expect(!match("\\a*", "b"));
//     try expect(!match("\\a*", "bb"));
//     try expect(!match("\\a*", "bcd"));
//     try expect(!match("\\a*", "bdir/"));
//     try expect(!match("\\a*", "Beware"));
//     try expect(!match("\\a*", "c"));
//     try expect(!match("\\a*", "ca"));
//     try expect(!match("\\a*", "cb"));
//     try expect(!match("\\a*", "d"));
//     try expect(!match("\\a*", "dd"));
//     try expect(!match("\\a*", "de"));
// }

// test "bash directories" {
//     try expect(!match("b*/", "*"));
//     try expect(!match("b*/", "**"));
//     try expect(!match("b*/", "\\*"));
//     try expect(!match("b*/", "a"));
//     try expect(!match("b*/", "a/*"));
//     try expect(!match("b*/", "abc"));
//     try expect(!match("b*/", "abd"));
//     try expect(!match("b*/", "abe"));
//     try expect(!match("b*/", "b"));
//     try expect(!match("b*/", "bb"));
//     try expect(!match("b*/", "bcd"));
//     try expect(match("b*/", "bdir/"));
//     try expect(!match("b*/", "Beware"));
//     try expect(!match("b*/", "c"));
//     try expect(!match("b*/", "ca"));
//     try expect(!match("b*/", "cb"));
//     try expect(!match("b*/", "d"));
//     try expect(!match("b*/", "dd"));
//     try expect(!match("b*/", "de"));
// }

// test "bash escaping" {
//     try expect(!match("\\^", "*"));
//     try expect(!match("\\^", "**"));
//     try expect(!match("\\^", "\\*"));
//     try expect(!match("\\^", "a"));
//     try expect(!match("\\^", "a/*"));
//     try expect(!match("\\^", "abc"));
//     try expect(!match("\\^", "abd"));
//     try expect(!match("\\^", "abe"));
//     try expect(!match("\\^", "b"));
//     try expect(!match("\\^", "bb"));
//     try expect(!match("\\^", "bcd"));
//     try expect(!match("\\^", "bdir/"));
//     try expect(!match("\\^", "Beware"));
//     try expect(!match("\\^", "c"));
//     try expect(!match("\\^", "ca"));
//     try expect(!match("\\^", "cb"));
//     try expect(!match("\\^", "d"));
//     try expect(!match("\\^", "dd"));
//     try expect(!match("\\^", "de"));

//     try expect(match("\\*", "*"));
//     // try expect(match("\\*", "\\*"));
//     try expect(!match("\\*", "**"));
//     try expect(!match("\\*", "a"));
//     try expect(!match("\\*", "a/*"));
//     try expect(!match("\\*", "abc"));
//     try expect(!match("\\*", "abd"));
//     try expect(!match("\\*", "abe"));
//     try expect(!match("\\*", "b"));
//     try expect(!match("\\*", "bb"));
//     try expect(!match("\\*", "bcd"));
//     try expect(!match("\\*", "bdir/"));
//     try expect(!match("\\*", "Beware"));
//     try expect(!match("\\*", "c"));
//     try expect(!match("\\*", "ca"));
//     try expect(!match("\\*", "cb"));
//     try expect(!match("\\*", "d"));
//     try expect(!match("\\*", "dd"));
//     try expect(!match("\\*", "de"));

//     try expect(!match("a\\*", "*"));
//     try expect(!match("a\\*", "**"));
//     try expect(!match("a\\*", "\\*"));
//     try expect(!match("a\\*", "a"));
//     try expect(!match("a\\*", "a/*"));
//     try expect(!match("a\\*", "abc"));
//     try expect(!match("a\\*", "abd"));
//     try expect(!match("a\\*", "abe"));
//     try expect(!match("a\\*", "b"));
//     try expect(!match("a\\*", "bb"));
//     try expect(!match("a\\*", "bcd"));
//     try expect(!match("a\\*", "bdir/"));
//     try expect(!match("a\\*", "Beware"));
//     try expect(!match("a\\*", "c"));
//     try expect(!match("a\\*", "ca"));
//     try expect(!match("a\\*", "cb"));
//     try expect(!match("a\\*", "d"));
//     try expect(!match("a\\*", "dd"));
//     try expect(!match("a\\*", "de"));

//     try expect(match("*q*", "aqa"));
//     try expect(match("*q*", "aaqaa"));
//     try expect(!match("*q*", "*"));
//     try expect(!match("*q*", "**"));
//     try expect(!match("*q*", "\\*"));
//     try expect(!match("*q*", "a"));
//     try expect(!match("*q*", "a/*"));
//     try expect(!match("*q*", "abc"));
//     try expect(!match("*q*", "abd"));
//     try expect(!match("*q*", "abe"));
//     try expect(!match("*q*", "b"));
//     try expect(!match("*q*", "bb"));
//     try expect(!match("*q*", "bcd"));
//     try expect(!match("*q*", "bdir/"));
//     try expect(!match("*q*", "Beware"));
//     try expect(!match("*q*", "c"));
//     try expect(!match("*q*", "ca"));
//     try expect(!match("*q*", "cb"));
//     try expect(!match("*q*", "d"));
//     try expect(!match("*q*", "dd"));
//     try expect(!match("*q*", "de"));

//     try expect(match("\\**", "*"));
//     try expect(match("\\**", "**"));
//     try expect(!match("\\**", "\\*"));
//     try expect(!match("\\**", "a"));
//     try expect(!match("\\**", "a/*"));
//     try expect(!match("\\**", "abc"));
//     try expect(!match("\\**", "abd"));
//     try expect(!match("\\**", "abe"));
//     try expect(!match("\\**", "b"));
//     try expect(!match("\\**", "bb"));
//     try expect(!match("\\**", "bcd"));
//     try expect(!match("\\**", "bdir/"));
//     try expect(!match("\\**", "Beware"));
//     try expect(!match("\\**", "c"));
//     try expect(!match("\\**", "ca"));
//     try expect(!match("\\**", "cb"));
//     try expect(!match("\\**", "d"));
//     try expect(!match("\\**", "dd"));
//     try expect(!match("\\**", "de"));
// }

// test "bash classes" {
//     try expect(!match("a*[^c]", "*"));
//     try expect(!match("a*[^c]", "**"));
//     try expect(!match("a*[^c]", "\\*"));
//     try expect(!match("a*[^c]", "a"));
//     try expect(!match("a*[^c]", "a/*"));
//     try expect(!match("a*[^c]", "abc"));
//     try expect(match("a*[^c]", "abd"));
//     try expect(match("a*[^c]", "abe"));
//     try expect(!match("a*[^c]", "b"));
//     try expect(!match("a*[^c]", "bb"));
//     try expect(!match("a*[^c]", "bcd"));
//     try expect(!match("a*[^c]", "bdir/"));
//     try expect(!match("a*[^c]", "Beware"));
//     try expect(!match("a*[^c]", "c"));
//     try expect(!match("a*[^c]", "ca"));
//     try expect(!match("a*[^c]", "cb"));
//     try expect(!match("a*[^c]", "d"));
//     try expect(!match("a*[^c]", "dd"));
//     try expect(!match("a*[^c]", "de"));
//     try expect(!match("a*[^c]", "baz"));
//     try expect(!match("a*[^c]", "bzz"));
//     try expect(!match("a*[^c]", "BZZ"));
//     try expect(!match("a*[^c]", "beware"));
//     try expect(!match("a*[^c]", "BewAre"));

//     try expect(match("a[X-]b", "a-b"));
//     try expect(match("a[X-]b", "aXb"));

//     try expect(!match("[a-y]*[^c]", "*"));
//     try expect(match("[a-y]*[^c]", "a*"));
//     try expect(!match("[a-y]*[^c]", "**"));
//     try expect(!match("[a-y]*[^c]", "\\*"));
//     try expect(!match("[a-y]*[^c]", "a"));
//     try expect(match("[a-y]*[^c]", "a123b"));
//     try expect(!match("[a-y]*[^c]", "a123c"));
//     try expect(match("[a-y]*[^c]", "ab"));
//     try expect(!match("[a-y]*[^c]", "a/*"));
//     try expect(!match("[a-y]*[^c]", "abc"));
//     try expect(match("[a-y]*[^c]", "abd"));
//     try expect(match("[a-y]*[^c]", "abe"));
//     try expect(!match("[a-y]*[^c]", "b"));
//     try expect(match("[a-y]*[^c]", "bd"));
//     try expect(match("[a-y]*[^c]", "bb"));
//     try expect(match("[a-y]*[^c]", "bcd"));
//     try expect(match("[a-y]*[^c]", "bdir/"));
//     try expect(!match("[a-y]*[^c]", "Beware"));
//     try expect(!match("[a-y]*[^c]", "c"));
//     try expect(match("[a-y]*[^c]", "ca"));
//     try expect(match("[a-y]*[^c]", "cb"));
//     try expect(!match("[a-y]*[^c]", "d"));
//     try expect(match("[a-y]*[^c]", "dd"));
//     try expect(match("[a-y]*[^c]", "dd"));
//     try expect(match("[a-y]*[^c]", "dd"));
//     try expect(match("[a-y]*[^c]", "de"));
//     try expect(match("[a-y]*[^c]", "baz"));
//     try expect(match("[a-y]*[^c]", "bzz"));
//     try expect(match("[a-y]*[^c]", "bzz"));
//     // assert(!isMatch('bzz', '[a-y]*[^c]', { regex: true }));
//     try expect(!match("[a-y]*[^c]", "BZZ"));
//     try expect(match("[a-y]*[^c]", "beware"));
//     try expect(!match("[a-y]*[^c]", "BewAre"));

//     try expect(match("a\\*b/*", "a*b/ooo"));
//     try expect(match("a\\*?/*", "a*b/ooo"));

//     try expect(!match("a[b]c", "*"));
//     try expect(!match("a[b]c", "**"));
//     try expect(!match("a[b]c", "\\*"));
//     try expect(!match("a[b]c", "a"));
//     try expect(!match("a[b]c", "a/*"));
//     try expect(match("a[b]c", "abc"));
//     try expect(!match("a[b]c", "abd"));
//     try expect(!match("a[b]c", "abe"));
//     try expect(!match("a[b]c", "b"));
//     try expect(!match("a[b]c", "bb"));
//     try expect(!match("a[b]c", "bcd"));
//     try expect(!match("a[b]c", "bdir/"));
//     try expect(!match("a[b]c", "Beware"));
//     try expect(!match("a[b]c", "c"));
//     try expect(!match("a[b]c", "ca"));
//     try expect(!match("a[b]c", "cb"));
//     try expect(!match("a[b]c", "d"));
//     try expect(!match("a[b]c", "dd"));
//     try expect(!match("a[b]c", "de"));
//     try expect(!match("a[b]c", "baz"));
//     try expect(!match("a[b]c", "bzz"));
//     try expect(!match("a[b]c", "BZZ"));
//     try expect(!match("a[b]c", "beware"));
//     try expect(!match("a[b]c", "BewAre"));

//     try expect(!match("a[\"b\"]c", "*"));
//     try expect(!match("a[\"b\"]c", "**"));
//     try expect(!match("a[\"b\"]c", "\\*"));
//     try expect(!match("a[\"b\"]c", "a"));
//     try expect(!match("a[\"b\"]c", "a/*"));
//     try expect(match("a[\"b\"]c", "abc"));
//     try expect(!match("a[\"b\"]c", "abd"));
//     try expect(!match("a[\"b\"]c", "abe"));
//     try expect(!match("a[\"b\"]c", "b"));
//     try expect(!match("a[\"b\"]c", "bb"));
//     try expect(!match("a[\"b\"]c", "bcd"));
//     try expect(!match("a[\"b\"]c", "bdir/"));
//     try expect(!match("a[\"b\"]c", "Beware"));
//     try expect(!match("a[\"b\"]c", "c"));
//     try expect(!match("a[\"b\"]c", "ca"));
//     try expect(!match("a[\"b\"]c", "cb"));
//     try expect(!match("a[\"b\"]c", "d"));
//     try expect(!match("a[\"b\"]c", "dd"));
//     try expect(!match("a[\"b\"]c", "de"));
//     try expect(!match("a[\"b\"]c", "baz"));
//     try expect(!match("a[\"b\"]c", "bzz"));
//     try expect(!match("a[\"b\"]c", "BZZ"));
//     try expect(!match("a[\"b\"]c", "beware"));
//     try expect(!match("a[\"b\"]c", "BewAre"));

//     try expect(!match("a[\\\\b]c", "*"));
//     try expect(!match("a[\\\\b]c", "**"));
//     try expect(!match("a[\\\\b]c", "\\*"));
//     try expect(!match("a[\\\\b]c", "a"));
//     try expect(!match("a[\\\\b]c", "a/*"));
//     try expect(match("a[\\\\b]c", "abc"));
//     try expect(!match("a[\\\\b]c", "abd"));
//     try expect(!match("a[\\\\b]c", "abe"));
//     try expect(!match("a[\\\\b]c", "b"));
//     try expect(!match("a[\\\\b]c", "bb"));
//     try expect(!match("a[\\\\b]c", "bcd"));
//     try expect(!match("a[\\\\b]c", "bdir/"));
//     try expect(!match("a[\\\\b]c", "Beware"));
//     try expect(!match("a[\\\\b]c", "c"));
//     try expect(!match("a[\\\\b]c", "ca"));
//     try expect(!match("a[\\\\b]c", "cb"));
//     try expect(!match("a[\\\\b]c", "d"));
//     try expect(!match("a[\\\\b]c", "dd"));
//     try expect(!match("a[\\\\b]c", "de"));
//     try expect(!match("a[\\\\b]c", "baz"));
//     try expect(!match("a[\\\\b]c", "bzz"));
//     try expect(!match("a[\\\\b]c", "BZZ"));
//     try expect(!match("a[\\\\b]c", "beware"));
//     try expect(!match("a[\\\\b]c", "BewAre"));

//     try expect(!match("a[\\b]c", "*"));
//     try expect(!match("a[\\b]c", "**"));
//     try expect(!match("a[\\b]c", "\\*"));
//     try expect(!match("a[\\b]c", "a"));
//     try expect(!match("a[\\b]c", "a/*"));
//     try expect(!match("a[\\b]c", "abc"));
//     try expect(!match("a[\\b]c", "abd"));
//     try expect(!match("a[\\b]c", "abe"));
//     try expect(!match("a[\\b]c", "b"));
//     try expect(!match("a[\\b]c", "bb"));
//     try expect(!match("a[\\b]c", "bcd"));
//     try expect(!match("a[\\b]c", "bdir/"));
//     try expect(!match("a[\\b]c", "Beware"));
//     try expect(!match("a[\\b]c", "c"));
//     try expect(!match("a[\\b]c", "ca"));
//     try expect(!match("a[\\b]c", "cb"));
//     try expect(!match("a[\\b]c", "d"));
//     try expect(!match("a[\\b]c", "dd"));
//     try expect(!match("a[\\b]c", "de"));
//     try expect(!match("a[\\b]c", "baz"));
//     try expect(!match("a[\\b]c", "bzz"));
//     try expect(!match("a[\\b]c", "BZZ"));
//     try expect(!match("a[\\b]c", "beware"));
//     try expect(!match("a[\\b]c", "BewAre"));

//     try expect(!match("a[b-d]c", "*"));
//     try expect(!match("a[b-d]c", "**"));
//     try expect(!match("a[b-d]c", "\\*"));
//     try expect(!match("a[b-d]c", "a"));
//     try expect(!match("a[b-d]c", "a/*"));
//     try expect(match("a[b-d]c", "abc"));
//     try expect(!match("a[b-d]c", "abd"));
//     try expect(!match("a[b-d]c", "abe"));
//     try expect(!match("a[b-d]c", "b"));
//     try expect(!match("a[b-d]c", "bb"));
//     try expect(!match("a[b-d]c", "bcd"));
//     try expect(!match("a[b-d]c", "bdir/"));
//     try expect(!match("a[b-d]c", "Beware"));
//     try expect(!match("a[b-d]c", "c"));
//     try expect(!match("a[b-d]c", "ca"));
//     try expect(!match("a[b-d]c", "cb"));
//     try expect(!match("a[b-d]c", "d"));
//     try expect(!match("a[b-d]c", "dd"));
//     try expect(!match("a[b-d]c", "de"));
//     try expect(!match("a[b-d]c", "baz"));
//     try expect(!match("a[b-d]c", "bzz"));
//     try expect(!match("a[b-d]c", "BZZ"));
//     try expect(!match("a[b-d]c", "beware"));
//     try expect(!match("a[b-d]c", "BewAre"));

//     try expect(!match("a?c", "*"));
//     try expect(!match("a?c", "**"));
//     try expect(!match("a?c", "\\*"));
//     try expect(!match("a?c", "a"));
//     try expect(!match("a?c", "a/*"));
//     try expect(match("a?c", "abc"));
//     try expect(!match("a?c", "abd"));
//     try expect(!match("a?c", "abe"));
//     try expect(!match("a?c", "b"));
//     try expect(!match("a?c", "bb"));
//     try expect(!match("a?c", "bcd"));
//     try expect(!match("a?c", "bdir/"));
//     try expect(!match("a?c", "Beware"));
//     try expect(!match("a?c", "c"));
//     try expect(!match("a?c", "ca"));
//     try expect(!match("a?c", "cb"));
//     try expect(!match("a?c", "d"));
//     try expect(!match("a?c", "dd"));
//     try expect(!match("a?c", "de"));
//     try expect(!match("a?c", "baz"));
//     try expect(!match("a?c", "bzz"));
//     try expect(!match("a?c", "BZZ"));
//     try expect(!match("a?c", "beware"));
//     try expect(!match("a?c", "BewAre"));

//     try expect(match("*/man*/bash.*", "man/man1/bash.1"));

//     try expect(match("[^a-c]*", "*"));
//     try expect(match("[^a-c]*", "**"));
//     try expect(!match("[^a-c]*", "a"));
//     try expect(!match("[^a-c]*", "a/*"));
//     try expect(!match("[^a-c]*", "abc"));
//     try expect(!match("[^a-c]*", "abd"));
//     try expect(!match("[^a-c]*", "abe"));
//     try expect(!match("[^a-c]*", "b"));
//     try expect(!match("[^a-c]*", "bb"));
//     try expect(!match("[^a-c]*", "bcd"));
//     try expect(!match("[^a-c]*", "bdir/"));
//     try expect(match("[^a-c]*", "Beware"));
//     try expect(match("[^a-c]*", "Beware"));
//     try expect(!match("[^a-c]*", "c"));
//     try expect(!match("[^a-c]*", "ca"));
//     try expect(!match("[^a-c]*", "cb"));
//     try expect(match("[^a-c]*", "d"));
//     try expect(match("[^a-c]*", "dd"));
//     try expect(match("[^a-c]*", "de"));
//     try expect(!match("[^a-c]*", "baz"));
//     try expect(!match("[^a-c]*", "bzz"));
//     try expect(match("[^a-c]*", "BZZ"));
//     try expect(!match("[^a-c]*", "beware"));
//     try expect(match("[^a-c]*", "BewAre"));
// }

// test "bash wildmatch" {
//     try expect(!match("a[]-]b", "aab"));
//     try expect(!match("[ten]", "ten"));
//     try expect(match("]", "]"));
//     try expect(match("a[]-]b", "a-b"));
//     try expect(match("a[]-]b", "a]b"));
//     try expect(match("a[]]b", "a]b"));
//     try expect(match("a[\\]a\\-]b", "aab"));
//     try expect(match("t[a-g]n", "ten"));
//     try expect(match("t[^a-g]n", "ton"));
// }

// test "bash slashmatch" {
//     // try expect(!match("f[^eiu][^eiu][^eiu][^eiu][^eiu]r", "foo/bar"));
//     try expect(match("foo[/]bar", "foo/bar"));
//     try expect(match("f[^eiu][^eiu][^eiu][^eiu][^eiu]r", "foo-bar"));
// }

// test "bash extra_stars" {
//     try expect(!match("a**c", "bbc"));
//     try expect(match("a**c", "abc"));
//     try expect(!match("a**c", "bbd"));

//     try expect(!match("a***c", "bbc"));
//     try expect(match("a***c", "abc"));
//     try expect(!match("a***c", "bbd"));

//     try expect(!match("a*****?c", "bbc"));
//     try expect(match("a*****?c", "abc"));
//     try expect(!match("a*****?c", "bbc"));

//     try expect(match("?*****??", "bbc"));
//     try expect(match("?*****??", "abc"));

//     try expect(match("*****??", "bbc"));
//     try expect(match("*****??", "abc"));

//     try expect(match("?*****?c", "bbc"));
//     try expect(match("?*****?c", "abc"));

//     try expect(match("?***?****c", "bbc"));
//     try expect(match("?***?****c", "abc"));
//     try expect(!match("?***?****c", "bbd"));

//     try expect(match("?***?****?", "bbc"));
//     try expect(match("?***?****?", "abc"));

//     try expect(match("?***?****", "bbc"));
//     try expect(match("?***?****", "abc"));

//     try expect(match("*******c", "bbc"));
//     try expect(match("*******c", "abc"));

//     try expect(match("*******?", "bbc"));
//     try expect(match("*******?", "abc"));

//     try expect(match("a*cd**?**??k", "abcdecdhjk"));
//     try expect(match("a**?**cd**?**??k", "abcdecdhjk"));
//     try expect(match("a**?**cd**?**??k***", "abcdecdhjk"));
//     try expect(match("a**?**cd**?**??***k", "abcdecdhjk"));
//     try expect(match("a**?**cd**?**??***k**", "abcdecdhjk"));
//     try expect(match("a****c**?**??*****", "abcdecdhjk"));
// }

// test "stars" {
//     try expect(!match("*.js", "a/b/c/z.js"));
//     try expect(!match("*.js", "a/b/z.js"));
//     try expect(!match("*.js", "a/z.js"));
//     try expect(match("*.js", "z.js"));

//     // try expect(!match("*/*", "a/.ab"));
//     // try expect(!match("*", ".ab"));

//     try expect(match("z*.js", "z.js"));
//     try expect(match("*/*", "a/z"));
//     try expect(match("*/z*.js", "a/z.js"));
//     try expect(match("a/z*.js", "a/z.js"));

//     try expect(match("*", "ab"));
//     try expect(match("*", "abc"));

//     try expect(!match("f*", "bar"));
//     try expect(!match("*r", "foo"));
//     try expect(!match("b*", "foo"));
//     try expect(!match("*", "foo/bar"));
//     try expect(match("*c", "abc"));
//     try expect(match("a*", "abc"));
//     try expect(match("a*c", "abc"));
//     try expect(match("*r", "bar"));
//     try expect(match("b*", "bar"));
//     try expect(match("f*", "foo"));

//     try expect(match("*abc*", "one abc two"));
//     try expect(match("a*b", "a         b"));

//     try expect(!match("*a*", "foo"));
//     try expect(match("*a*", "bar"));
//     try expect(match("*abc*", "oneabctwo"));
//     try expect(!match("*-bc-*", "a-b.c-d"));
//     try expect(match("*-*.*-*", "a-b.c-d"));
//     try expect(match("*-b*c-*", "a-b.c-d"));
//     try expect(match("*-b.c-*", "a-b.c-d"));
//     try expect(match("*.*", "a-b.c-d"));
//     try expect(match("*.*-*", "a-b.c-d"));
//     try expect(match("*.*-d", "a-b.c-d"));
//     try expect(match("*.c-*", "a-b.c-d"));
//     try expect(match("*b.*d", "a-b.c-d"));
//     try expect(match("a*.c*", "a-b.c-d"));
//     try expect(match("a-*.*-d", "a-b.c-d"));
//     try expect(match("*.*", "a.b"));
//     try expect(match("*.b", "a.b"));
//     try expect(match("a.*", "a.b"));
//     try expect(match("a.b", "a.b"));

//     try expect(!match("**-bc-**", "a-b.c-d"));
//     try expect(match("**-**.**-**", "a-b.c-d"));
//     try expect(match("**-b**c-**", "a-b.c-d"));
//     try expect(match("**-b.c-**", "a-b.c-d"));
//     try expect(match("**.**", "a-b.c-d"));
//     try expect(match("**.**-**", "a-b.c-d"));
//     try expect(match("**.**-d", "a-b.c-d"));
//     try expect(match("**.c-**", "a-b.c-d"));
//     try expect(match("**b.**d", "a-b.c-d"));
//     try expect(match("a**.c**", "a-b.c-d"));
//     try expect(match("a-**.**-d", "a-b.c-d"));
//     try expect(match("**.**", "a.b"));
//     try expect(match("**.b", "a.b"));
//     try expect(match("a.**", "a.b"));
//     try expect(match("a.b", "a.b"));

//     try expect(match("*/*", "/ab"));
//     try expect(match(".", "."));
//     try expect(!match("a/", "a/.b"));
//     try expect(match("/*", "/ab"));
//     try expect(match("/??", "/ab"));
//     try expect(match("/?b", "/ab"));
//     try expect(match("/*", "/cd"));
//     try expect(match("a", "a"));
//     try expect(match("a/.*", "a/.b"));
//     try expect(match("?/?", "a/b"));
//     try expect(match("a/**/j/**/z/*.md", "a/b/c/d/e/j/n/p/o/z/c.md"));
//     try expect(match("a/**/z/*.md", "a/b/c/d/e/z/c.md"));
//     try expect(match("a/b/c/*.md", "a/b/c/xyz.md"));
//     try expect(match("a/b/c/*.md", "a/b/c/xyz.md"));
//     try expect(match("a/*/z/.a", "a/b/z/.a"));
//     try expect(!match("bz", "a/b/z/.a"));
//     try expect(match("a/**/c/*.md", "a/bb.bb/aa/b.b/aa/c/xyz.md"));
//     try expect(match("a/**/c/*.md", "a/bb.bb/aa/bb/aa/c/xyz.md"));
//     try expect(match("a/*/c/*.md", "a/bb.bb/c/xyz.md"));
//     try expect(match("a/*/c/*.md", "a/bb/c/xyz.md"));
//     try expect(match("a/*/c/*.md", "a/bbbb/c/xyz.md"));
//     try expect(match("*", "aaa"));
//     try expect(match("*", "ab"));
//     try expect(match("ab", "ab"));

//     try expect(!match("*/*/*", "aaa"));
//     try expect(!match("*/*/*", "aaa/bb/aa/rr"));
//     try expect(!match("aaa*", "aaa/bba/ccc"));
//     // try expect(!match("aaa**", "aaa/bba/ccc"));
//     try expect(!match("aaa/*", "aaa/bba/ccc"));
//     try expect(!match("aaa/*ccc", "aaa/bba/ccc"));
//     try expect(!match("aaa/*z", "aaa/bba/ccc"));
//     try expect(!match("*/*/*", "aaa/bbb"));
//     try expect(!match("*/*jk*/*i", "ab/zzz/ejkl/hi"));
//     try expect(match("*/*/*", "aaa/bba/ccc"));
//     try expect(match("aaa/**", "aaa/bba/ccc"));
//     try expect(match("aaa/*", "aaa/bbb"));
//     try expect(match("*/*z*/*/*i", "ab/zzz/ejkl/hi"));
//     try expect(match("*j*i", "abzzzejklhi"));

//     try expect(match("*", "a"));
//     try expect(match("*", "b"));
//     try expect(!match("*", "a/a"));
//     try expect(!match("*", "a/a/a"));
//     try expect(!match("*", "a/a/b"));
//     try expect(!match("*", "a/a/a/a"));
//     try expect(!match("*", "a/a/a/a/a"));

//     try expect(!match("*/*", "a"));
//     try expect(match("*/*", "a/a"));
//     try expect(!match("*/*", "a/a/a"));

//     try expect(!match("*/*/*", "a"));
//     try expect(!match("*/*/*", "a/a"));
//     try expect(match("*/*/*", "a/a/a"));
//     try expect(!match("*/*/*", "a/a/a/a"));

//     try expect(!match("*/*/*/*", "a"));
//     try expect(!match("*/*/*/*", "a/a"));
//     try expect(!match("*/*/*/*", "a/a/a"));
//     try expect(match("*/*/*/*", "a/a/a/a"));
//     try expect(!match("*/*/*/*", "a/a/a/a/a"));

//     try expect(!match("*/*/*/*/*", "a"));
//     try expect(!match("*/*/*/*/*", "a/a"));
//     try expect(!match("*/*/*/*/*", "a/a/a"));
//     try expect(!match("*/*/*/*/*", "a/a/b"));
//     try expect(!match("*/*/*/*/*", "a/a/a/a"));
//     try expect(match("*/*/*/*/*", "a/a/a/a/a"));
//     try expect(!match("*/*/*/*/*", "a/a/a/a/a/a"));

//     try expect(!match("a/*", "a"));
//     try expect(match("a/*", "a/a"));
//     try expect(!match("a/*", "a/a/a"));
//     try expect(!match("a/*", "a/a/a/a"));
//     try expect(!match("a/*", "a/a/a/a/a"));

//     try expect(!match("a/*/*", "a"));
//     try expect(!match("a/*/*", "a/a"));
//     try expect(match("a/*/*", "a/a/a"));
//     try expect(!match("a/*/*", "b/a/a"));
//     try expect(!match("a/*/*", "a/a/a/a"));
//     try expect(!match("a/*/*", "a/a/a/a/a"));

//     try expect(!match("a/*/*/*", "a"));
//     try expect(!match("a/*/*/*", "a/a"));
//     try expect(!match("a/*/*/*", "a/a/a"));
//     try expect(match("a/*/*/*", "a/a/a/a"));
//     try expect(!match("a/*/*/*", "a/a/a/a/a"));

//     try expect(!match("a/*/*/*/*", "a"));
//     try expect(!match("a/*/*/*/*", "a/a"));
//     try expect(!match("a/*/*/*/*", "a/a/a"));
//     try expect(!match("a/*/*/*/*", "a/a/b"));
//     try expect(!match("a/*/*/*/*", "a/a/a/a"));
//     try expect(match("a/*/*/*/*", "a/a/a/a/a"));

//     try expect(!match("a/*/a", "a"));
//     try expect(!match("a/*/a", "a/a"));
//     try expect(match("a/*/a", "a/a/a"));
//     try expect(!match("a/*/a", "a/a/b"));
//     try expect(!match("a/*/a", "a/a/a/a"));
//     try expect(!match("a/*/a", "a/a/a/a/a"));

//     try expect(!match("a/*/b", "a"));
//     try expect(!match("a/*/b", "a/a"));
//     try expect(!match("a/*/b", "a/a/a"));
//     try expect(match("a/*/b", "a/a/b"));
//     try expect(!match("a/*/b", "a/a/a/a"));
//     try expect(!match("a/*/b", "a/a/a/a/a"));

//     try expect(!match("*/**/a", "a"));
//     try expect(!match("*/**/a", "a/a/b"));
//     try expect(match("*/**/a", "a/a"));
//     try expect(match("*/**/a", "a/a/a"));
//     try expect(match("*/**/a", "a/a/a/a"));
//     try expect(match("*/**/a", "a/a/a/a/a"));

//     try expect(!match("*/", "a"));
//     try expect(!match("*/*", "a"));
//     try expect(!match("a/*", "a"));
//     // try expect(!match("*/*", "a/"));
//     // try expect(!match("a/*", "a/"));
//     try expect(!match("*", "a/a"));
//     try expect(!match("*/", "a/a"));
//     try expect(!match("*/", "a/x/y"));
//     try expect(!match("*/*", "a/x/y"));
//     try expect(!match("a/*", "a/x/y"));
//     // try expect(match("*", "a/"));
//     try expect(match("*", "a"));
//     try expect(match("*/", "a/"));
//     try expect(match("*{,/}", "a/"));
//     try expect(match("*/*", "a/a"));
//     try expect(match("a/*", "a/a"));

//     try expect(!match("a/**/*.txt", "a.txt"));
//     try expect(match("a/**/*.txt", "a/x/y.txt"));
//     try expect(!match("a/**/*.txt", "a/x/y/z"));

//     try expect(!match("a/*.txt", "a.txt"));
//     try expect(match("a/*.txt", "a/b.txt"));
//     try expect(!match("a/*.txt", "a/x/y.txt"));
//     try expect(!match("a/*.txt", "a/x/y/z"));

//     try expect(match("a*.txt", "a.txt"));
//     try expect(!match("a*.txt", "a/b.txt"));
//     try expect(!match("a*.txt", "a/x/y.txt"));
//     try expect(!match("a*.txt", "a/x/y/z"));

//     try expect(match("*.txt", "a.txt"));
//     try expect(!match("*.txt", "a/b.txt"));
//     try expect(!match("*.txt", "a/x/y.txt"));
//     try expect(!match("*.txt", "a/x/y/z"));

//     try expect(!match("a*", "a/b"));
//     try expect(!match("a/**/b", "a/a/bb"));
//     try expect(!match("a/**/b", "a/bb"));

//     try expect(!match("*/**", "foo"));
//     try expect(!match("**/", "foo/bar"));
//     try expect(!match("**/*/", "foo/bar"));
//     try expect(!match("*/*/", "foo/bar"));

//     try expect(match("**/..", "/home/foo/.."));
//     try expect(match("**/a", "a"));
//     try expect(match("**", "a/a"));
//     try expect(match("a/**", "a/a"));
//     try expect(match("a/**", "a/"));
//     // try expect(match("a/**", "a"));
//     try expect(!match("**/", "a/a"));
//     // try expect(match("**/a/**", "a"));
//     // try expect(match("a/**", "a"));
//     try expect(!match("**/", "a/a"));
//     try expect(match("*/**/a", "a/a"));
//     // try expect(match("a/**", "a"));
//     try expect(match("*/**", "foo/"));
//     try expect(match("**/*", "foo/bar"));
//     try expect(match("*/*", "foo/bar"));
//     try expect(match("*/**", "foo/bar"));
//     try expect(match("**/", "foo/bar/"));
//     // try expect(match("**/*", "foo/bar/"));
//     try expect(match("**/*/", "foo/bar/"));
//     try expect(match("*/**", "foo/bar/"));
//     try expect(match("*/*/", "foo/bar/"));

//     try expect(!match("*/foo", "bar/baz/foo"));
//     try expect(!match("**/bar/*", "deep/foo/bar"));
//     try expect(!match("*/bar/**", "deep/foo/bar/baz/x"));
//     try expect(!match("/*", "ef"));
//     try expect(!match("foo?bar", "foo/bar"));
//     try expect(!match("**/bar*", "foo/bar/baz"));
//     // try expect(!match("**/bar**", "foo/bar/baz"));
//     try expect(!match("foo**bar", "foo/baz/bar"));
//     try expect(!match("foo*bar", "foo/baz/bar"));
//     // try expect(match("foo/**", "foo"));
//     try expect(match("/*", "/ab"));
//     try expect(match("/*", "/cd"));
//     try expect(match("/*", "/ef"));
//     try expect(match("a/**/j/**/z/*.md", "a/b/j/c/z/x.md"));
//     try expect(match("a/**/j/**/z/*.md", "a/j/z/x.md"));

//     try expect(match("**/foo", "bar/baz/foo"));
//     try expect(match("**/bar/*", "deep/foo/bar/baz"));
//     try expect(match("**/bar/**", "deep/foo/bar/baz/"));
//     try expect(match("**/bar/*/*", "deep/foo/bar/baz/x"));
//     try expect(match("foo/**/**/bar", "foo/b/a/z/bar"));
//     try expect(match("foo/**/bar", "foo/b/a/z/bar"));
//     try expect(match("foo/**/**/bar", "foo/bar"));
//     try expect(match("foo/**/bar", "foo/bar"));
//     try expect(match("*/bar/**", "foo/bar/baz/x"));
//     try expect(match("foo/**/**/bar", "foo/baz/bar"));
//     try expect(match("foo/**/bar", "foo/baz/bar"));
//     try expect(match("**/foo", "XXX/foo"));
// }

// test "globstars" {
//     try expect(match("**/*.js", "a/b/c/d.js"));
//     try expect(match("**/*.js", "a/b/c.js"));
//     try expect(match("**/*.js", "a/b.js"));
//     try expect(match("a/b/**/*.js", "a/b/c/d/e/f.js"));
//     try expect(match("a/b/**/*.js", "a/b/c/d/e.js"));
//     try expect(match("a/b/c/**/*.js", "a/b/c/d.js"));
//     try expect(match("a/b/**/*.js", "a/b/c/d.js"));
//     try expect(match("a/b/**/*.js", "a/b/d.js"));
//     try expect(!match("a/b/**/*.js", "a/d.js"));
//     try expect(!match("a/b/**/*.js", "d.js"));

//     try expect(!match("**c", "a/b/c"));
//     try expect(!match("a/**c", "a/b/c"));
//     try expect(!match("a/**z", "a/b/c"));
//     try expect(!match("a/**b**/c", "a/b/c/b/c"));
//     try expect(!match("a/b/c**/*.js", "a/b/c/d/e.js"));
//     try expect(match("a/**/b/**/c", "a/b/c/b/c"));
//     try expect(match("a/**b**/c", "a/aba/c"));
//     try expect(match("a/**b**/c", "a/b/c"));
//     try expect(match("a/b/c**/*.js", "a/b/c/d.js"));

//     try expect(!match("a/**/*", "a"));
//     try expect(!match("a/**/**/*", "a"));
//     try expect(!match("a/**/**/**/*", "a"));
//     try expect(!match("**/a", "a/"));
//     try expect(!match("a/**/*", "a/"));
//     try expect(!match("a/**/**/*", "a/"));
//     try expect(!match("a/**/**/**/*", "a/"));
//     try expect(!match("**/a", "a/b"));
//     try expect(!match("a/**/j/**/z/*.md", "a/b/c/j/e/z/c.txt"));
//     try expect(!match("a/**/b", "a/bb"));
//     try expect(!match("**/a", "a/c"));
//     try expect(!match("**/a", "a/b"));
//     try expect(!match("**/a", "a/x/y"));
//     try expect(!match("**/a", "a/b/c/d"));
//     try expect(match("**", "a"));
//     try expect(match("**/a", "a"));
//     // try expect(match("a/**", "a"));
//     try expect(match("**", "a/"));
//     try expect(match("**/a/**", "a/"));
//     try expect(match("a/**", "a/"));
//     try expect(match("a/**/**", "a/"));
//     try expect(match("**/a", "a/a"));
//     try expect(match("**", "a/b"));
//     try expect(match("*/*", "a/b"));
//     try expect(match("a/**", "a/b"));
//     try expect(match("a/**/*", "a/b"));
//     try expect(match("a/**/**/*", "a/b"));
//     try expect(match("a/**/**/**/*", "a/b"));
//     try expect(match("a/**/b", "a/b"));
//     try expect(match("**", "a/b/c"));
//     try expect(match("**/*", "a/b/c"));
//     try expect(match("**/**", "a/b/c"));
//     try expect(match("*/**", "a/b/c"));
//     try expect(match("a/**", "a/b/c"));
//     try expect(match("a/**/*", "a/b/c"));
//     try expect(match("a/**/**/*", "a/b/c"));
//     try expect(match("a/**/**/**/*", "a/b/c"));
//     try expect(match("**", "a/b/c/d"));
//     try expect(match("a/**", "a/b/c/d"));
//     try expect(match("a/**/*", "a/b/c/d"));
//     try expect(match("a/**/**/*", "a/b/c/d"));
//     try expect(match("a/**/**/**/*", "a/b/c/d"));
//     try expect(match("a/b/**/c/**/*.*", "a/b/c/d.e"));
//     try expect(match("a/**/f/*.md", "a/b/c/d/e/f/g.md"));
//     try expect(match("a/**/f/**/k/*.md", "a/b/c/d/e/f/g/h/i/j/k/l.md"));
//     try expect(match("a/b/c/*.md", "a/b/c/def.md"));
//     try expect(match("a/*/c/*.md", "a/bb.bb/c/ddd.md"));
//     try expect(match("a/**/f/*.md", "a/bb.bb/cc/d.d/ee/f/ggg.md"));
//     try expect(match("a/**/f/*.md", "a/bb.bb/cc/dd/ee/f/ggg.md"));
//     try expect(match("a/*/c/*.md", "a/bb/c/ddd.md"));
//     try expect(match("a/*/c/*.md", "a/bbbb/c/ddd.md"));

//     try expect(match("foo/bar/**/one/**/*.*", "foo/bar/baz/one/image.png"));
//     try expect(match("foo/bar/**/one/**/*.*", "foo/bar/baz/one/two/image.png"));
//     try expect(match("foo/bar/**/one/**/*.*", "foo/bar/baz/one/two/three/image.png"));
//     try expect(!match("a/b/**/f", "a/b/c/d/"));
//     // try expect(match("a/**", "a"));
//     try expect(match("**", "a"));
//     // try expect(match("a{,/**}", "a"));
//     try expect(match("**", "a/"));
//     try expect(match("a/**", "a/"));
//     try expect(match("**", "a/b/c/d"));
//     try expect(match("**", "a/b/c/d/"));
//     try expect(match("**/**", "a/b/c/d/"));
//     try expect(match("**/b/**", "a/b/c/d/"));
//     try expect(match("a/b/**", "a/b/c/d/"));
//     try expect(match("a/b/**/", "a/b/c/d/"));
//     try expect(match("a/b/**/c/**/", "a/b/c/d/"));
//     try expect(match("a/b/**/c/**/d/", "a/b/c/d/"));
//     try expect(match("a/b/**/**/*.*", "a/b/c/d/e.f"));
//     try expect(match("a/b/**/*.*", "a/b/c/d/e.f"));
//     try expect(match("a/b/**/c/**/d/*.*", "a/b/c/d/e.f"));
//     try expect(match("a/b/**/d/**/*.*", "a/b/c/d/e.f"));
//     try expect(match("a/b/**/d/**/*.*", "a/b/c/d/g/e.f"));
//     try expect(match("a/b/**/d/**/*.*", "a/b/c/d/g/g/e.f"));
//     try expect(match("a/b-*/**/z.js", "a/b-c/z.js"));
//     try expect(match("a/b-*/**/z.js", "a/b-c/d/e/z.js"));

//     try expect(match("*/*", "a/b"));
//     try expect(match("a/b/c/*.md", "a/b/c/xyz.md"));
//     try expect(match("a/*/c/*.md", "a/bb.bb/c/xyz.md"));
//     try expect(match("a/*/c/*.md", "a/bb/c/xyz.md"));
//     try expect(match("a/*/c/*.md", "a/bbbb/c/xyz.md"));

//     try expect(match("**/*", "a/b/c"));
//     try expect(match("**/**", "a/b/c"));
//     try expect(match("*/**", "a/b/c"));
//     try expect(match("a/**/j/**/z/*.md", "a/b/c/d/e/j/n/p/o/z/c.md"));
//     try expect(match("a/**/z/*.md", "a/b/c/d/e/z/c.md"));
//     try expect(match("a/**/c/*.md", "a/bb.bb/aa/b.b/aa/c/xyz.md"));
//     try expect(match("a/**/c/*.md", "a/bb.bb/aa/bb/aa/c/xyz.md"));
//     try expect(!match("a/**/j/**/z/*.md", "a/b/c/j/e/z/c.txt"));
//     try expect(!match("a/b/**/c{d,e}/**/xyz.md", "a/b/c/xyz.md"));
//     try expect(!match("a/b/**/c{d,e}/**/xyz.md", "a/b/d/xyz.md"));
//     try expect(!match("a/**/", "a/b"));
//     // try expect(!match("**/*", "a/b/.js/c.txt"));
//     try expect(!match("a/**/", "a/b/c/d"));
//     try expect(!match("a/**/", "a/bb"));
//     try expect(!match("a/**/", "a/cb"));
//     try expect(match("/**", "/a/b"));
//     try expect(match("**/*", "a.b"));
//     try expect(match("**/*", "a.js"));
//     try expect(match("**/*.js", "a.js"));
//     // try expect(match("a/**/", "a/"));
//     try expect(match("**/*.js", "a/a.js"));
//     try expect(match("**/*.js", "a/a/b.js"));
//     try expect(match("a/**/b", "a/b"));
//     try expect(match("a/**b", "a/b"));
//     try expect(match("**/*.md", "a/b.md"));
//     try expect(match("**/*", "a/b/c.js"));
//     try expect(match("**/*", "a/b/c.txt"));
//     try expect(match("a/**/", "a/b/c/d/"));
//     try expect(match("**/*", "a/b/c/d/a.js"));
//     try expect(match("a/b/**/*.js", "a/b/c/z.js"));
//     try expect(match("a/b/**/*.js", "a/b/z.js"));
//     try expect(match("**/*", "ab"));
//     try expect(match("**/*", "ab/c"));
//     try expect(match("**/*", "ab/c/d"));
//     try expect(match("**/*", "abc.js"));

//     try expect(!match("**/", "a"));
//     try expect(!match("**/a/*", "a"));
//     try expect(!match("**/a/*/*", "a"));
//     try expect(!match("*/a/**", "a"));
//     try expect(!match("a/**/*", "a"));
//     try expect(!match("a/**/**/*", "a"));
//     try expect(!match("**/", "a/b"));
//     try expect(!match("**/b/*", "a/b"));
//     try expect(!match("**/b/*/*", "a/b"));
//     try expect(!match("b/**", "a/b"));
//     try expect(!match("**/", "a/b/c"));
//     try expect(!match("**/**/b", "a/b/c"));
//     try expect(!match("**/b", "a/b/c"));
//     try expect(!match("**/b/*/*", "a/b/c"));
//     try expect(!match("b/**", "a/b/c"));
//     try expect(!match("**/", "a/b/c/d"));
//     try expect(!match("**/d/*", "a/b/c/d"));
//     try expect(!match("b/**", "a/b/c/d"));
//     try expect(match("**", "a"));
//     try expect(match("**/**", "a"));
//     try expect(match("**/**/*", "a"));
//     try expect(match("**/**/a", "a"));
//     try expect(match("**/a", "a"));
//     // try expect(match("**/a/**", "a"));
//     // try expect(match("a/**", "a"));
//     try expect(match("**", "a/b"));
//     try expect(match("**/**", "a/b"));
//     try expect(match("**/**/*", "a/b"));
//     try expect(match("**/**/b", "a/b"));
//     try expect(match("**/b", "a/b"));
//     // try expect(match("**/b/**", "a/b"));
//     // try expect(match("*/b/**", "a/b"));
//     try expect(match("a/**", "a/b"));
//     try expect(match("a/**/*", "a/b"));
//     try expect(match("a/**/**/*", "a/b"));
//     try expect(match("**", "a/b/c"));
//     try expect(match("**/**", "a/b/c"));
//     try expect(match("**/**/*", "a/b/c"));
//     try expect(match("**/b/*", "a/b/c"));
//     try expect(match("**/b/**", "a/b/c"));
//     try expect(match("*/b/**", "a/b/c"));
//     try expect(match("a/**", "a/b/c"));
//     try expect(match("a/**/*", "a/b/c"));
//     try expect(match("a/**/**/*", "a/b/c"));
//     try expect(match("**", "a/b/c/d"));
//     try expect(match("**/**", "a/b/c/d"));
//     try expect(match("**/**/*", "a/b/c/d"));
//     try expect(match("**/**/d", "a/b/c/d"));
//     try expect(match("**/b/**", "a/b/c/d"));
//     try expect(match("**/b/*/*", "a/b/c/d"));
//     try expect(match("**/d", "a/b/c/d"));
//     try expect(match("*/b/**", "a/b/c/d"));
//     try expect(match("a/**", "a/b/c/d"));
//     try expect(match("a/**/*", "a/b/c/d"));
//     try expect(match("a/**/**/*", "a/b/c/d"));
// }

// test "utf8" {
//     try expect(match("フ*/**/*", "フォルダ/aaa.js"));
//     try expect(match("フォ*/**/*", "フォルダ/aaa.js"));
//     try expect(match("フォル*/**/*", "フォルダ/aaa.js"));
//     try expect(match("フ*ル*/**/*", "フォルダ/aaa.js"));
//     try expect(match("フォルダ/**/*", "フォルダ/aaa.js"));
// }

// test "negation" {
//     try expect(!match("!*", "abc"));
//     try expect(!match("!abc", "abc"));
//     try expect(!match("*!.md", "bar.md"));
//     try expect(!match("foo!.md", "bar.md"));
//     try expect(!match("\\!*!*.md", "foo!.md"));
//     try expect(!match("\\!*!*.md", "foo!bar.md"));
//     try expect(match("*!*.md", "!foo!.md"));
//     try expect(match("\\!*!*.md", "!foo!.md"));
//     try expect(match("!*foo", "abc"));
//     try expect(match("!foo*", "abc"));
//     try expect(match("!xyz", "abc"));
//     try expect(match("*!*.*", "ba!r.js"));
//     try expect(match("*.md", "bar.md"));
//     try expect(match("*!*.*", "foo!.md"));
//     try expect(match("*!*.md", "foo!.md"));
//     try expect(match("*!.md", "foo!.md"));
//     try expect(match("*.md", "foo!.md"));
//     try expect(match("foo!.md", "foo!.md"));
//     try expect(match("*!*.md", "foo!bar.md"));
//     try expect(match("*b*.md", "foobar.md"));

//     try expect(!match("a!!b", "a"));
//     try expect(!match("a!!b", "aa"));
//     try expect(!match("a!!b", "a/b"));
//     try expect(!match("a!!b", "a!b"));
//     try expect(match("a!!b", "a!!b"));
//     try expect(!match("a!!b", "a/!!/b"));

//     try expect(!match("!a/b", "a/b"));
//     try expect(match("!a/b", "a"));
//     try expect(match("!a/b", "a.b"));
//     try expect(match("!a/b", "a/a"));
//     try expect(match("!a/b", "a/c"));
//     try expect(match("!a/b", "b/a"));
//     try expect(match("!a/b", "b/b"));
//     try expect(match("!a/b", "b/c"));

//     try expect(!match("!abc", "abc"));
//     try expect(match("!!abc", "abc"));
//     try expect(!match("!!!abc", "abc"));
//     try expect(match("!!!!abc", "abc"));
//     try expect(!match("!!!!!abc", "abc"));
//     try expect(match("!!!!!!abc", "abc"));
//     try expect(!match("!!!!!!!abc", "abc"));
//     try expect(match("!!!!!!!!abc", "abc"));

//     // try expect(!match("!(*/*)", "a/a"));
//     // try expect(!match("!(*/*)", "a/b"));
//     // try expect(!match("!(*/*)", "a/c"));
//     // try expect(!match("!(*/*)", "b/a"));
//     // try expect(!match("!(*/*)", "b/b"));
//     // try expect(!match("!(*/*)", "b/c"));
//     // try expect(!match("!(*/b)", "a/b"));
//     // try expect(!match("!(*/b)", "b/b"));
//     // try expect(!match("!(a/b)", "a/b"));
//     try expect(!match("!*", "a"));
//     try expect(!match("!*", "a.b"));
//     try expect(!match("!*/*", "a/a"));
//     try expect(!match("!*/*", "a/b"));
//     try expect(!match("!*/*", "a/c"));
//     try expect(!match("!*/*", "b/a"));
//     try expect(!match("!*/*", "b/b"));
//     try expect(!match("!*/*", "b/c"));
//     try expect(!match("!*/b", "a/b"));
//     try expect(!match("!*/b", "b/b"));
//     try expect(!match("!*/c", "a/c"));
//     try expect(!match("!*/c", "a/c"));
//     try expect(!match("!*/c", "b/c"));
//     try expect(!match("!*/c", "b/c"));
//     try expect(!match("!*a*", "bar"));
//     try expect(!match("!*a*", "fab"));
//     // try expect(!match("!a/(*)", "a/a"));
//     // try expect(!match("!a/(*)", "a/b"));
//     // try expect(!match("!a/(*)", "a/c"));
//     // try expect(!match("!a/(b)", "a/b"));
//     try expect(!match("!a/*", "a/a"));
//     try expect(!match("!a/*", "a/b"));
//     try expect(!match("!a/*", "a/c"));
//     try expect(!match("!f*b", "fab"));
//     // try expect(match("!(*/*)", "a"));
//     // try expect(match("!(*/*)", "a.b"));
//     // try expect(match("!(*/b)", "a"));
//     // try expect(match("!(*/b)", "a.b"));
//     // try expect(match("!(*/b)", "a/a"));
//     // try expect(match("!(*/b)", "a/c"));
//     // try expect(match("!(*/b)", "b/a"));
//     // try expect(match("!(*/b)", "b/c"));
//     // try expect(match("!(a/b)", "a"));
//     // try expect(match("!(a/b)", "a.b"));
//     // try expect(match("!(a/b)", "a/a"));
//     // try expect(match("!(a/b)", "a/c"));
//     // try expect(match("!(a/b)", "b/a"));
//     // try expect(match("!(a/b)", "b/b"));
//     // try expect(match("!(a/b)", "b/c"));
//     try expect(match("!*", "a/a"));
//     try expect(match("!*", "a/b"));
//     try expect(match("!*", "a/c"));
//     try expect(match("!*", "b/a"));
//     try expect(match("!*", "b/b"));
//     try expect(match("!*", "b/c"));
//     try expect(match("!*/*", "a"));
//     try expect(match("!*/*", "a.b"));
//     try expect(match("!*/b", "a"));
//     try expect(match("!*/b", "a.b"));
//     try expect(match("!*/b", "a/a"));
//     try expect(match("!*/b", "a/c"));
//     try expect(match("!*/b", "b/a"));
//     try expect(match("!*/b", "b/c"));
//     try expect(match("!*/c", "a"));
//     try expect(match("!*/c", "a.b"));
//     try expect(match("!*/c", "a/a"));
//     try expect(match("!*/c", "a/b"));
//     try expect(match("!*/c", "b/a"));
//     try expect(match("!*/c", "b/b"));
//     try expect(match("!*a*", "foo"));
//     // try expect(match("!a/(*)", "a"));
//     // try expect(match("!a/(*)", "a.b"));
//     // try expect(match("!a/(*)", "b/a"));
//     // try expect(match("!a/(*)", "b/b"));
//     // try expect(match("!a/(*)", "b/c"));
//     // try expect(match("!a/(b)", "a"));
//     // try expect(match("!a/(b)", "a.b"));
//     // try expect(match("!a/(b)", "a/a"));
//     // try expect(match("!a/(b)", "a/c"));
//     // try expect(match("!a/(b)", "b/a"));
//     // try expect(match("!a/(b)", "b/b"));
//     // try expect(match("!a/(b)", "b/c"));
//     try expect(match("!a/*", "a"));
//     try expect(match("!a/*", "a.b"));
//     try expect(match("!a/*", "b/a"));
//     try expect(match("!a/*", "b/b"));
//     try expect(match("!a/*", "b/c"));
//     try expect(match("!f*b", "bar"));
//     try expect(match("!f*b", "foo"));

//     try expect(!match("!.md", ".md"));
//     try expect(match("!**/*.md", "a.js"));
//     // try expect(!match("!**/*.md", "b.md"));
//     try expect(match("!**/*.md", "c.txt"));
//     try expect(match("!*.md", "a.js"));
//     try expect(!match("!*.md", "b.md"));
//     try expect(match("!*.md", "c.txt"));
//     try expect(!match("!*.md", "abc.md"));
//     try expect(match("!*.md", "abc.txt"));
//     try expect(!match("!*.md", "foo.md"));
//     try expect(match("!.md", "foo.md"));

//     try expect(match("!*.md", "a.js"));
//     try expect(match("!*.md", "b.txt"));
//     try expect(!match("!*.md", "c.md"));
//     try expect(!match("!a/*/a.js", "a/a/a.js"));
//     try expect(!match("!a/*/a.js", "a/b/a.js"));
//     try expect(!match("!a/*/a.js", "a/c/a.js"));
//     try expect(!match("!a/*/*/a.js", "a/a/a/a.js"));
//     try expect(match("!a/*/*/a.js", "b/a/b/a.js"));
//     try expect(match("!a/*/*/a.js", "c/a/c/a.js"));
//     try expect(!match("!a/a*.txt", "a/a.txt"));
//     try expect(match("!a/a*.txt", "a/b.txt"));
//     try expect(match("!a/a*.txt", "a/c.txt"));
//     try expect(!match("!a.a*.txt", "a.a.txt"));
//     try expect(match("!a.a*.txt", "a.b.txt"));
//     try expect(match("!a.a*.txt", "a.c.txt"));
//     try expect(!match("!a/*.txt", "a/a.txt"));
//     try expect(!match("!a/*.txt", "a/b.txt"));
//     try expect(!match("!a/*.txt", "a/c.txt"));

//     try expect(match("!*.md", "a.js"));
//     try expect(match("!*.md", "b.txt"));
//     try expect(!match("!*.md", "c.md"));
//     // try expect(!match("!**/a.js", "a/a/a.js"));
//     // try expect(!match("!**/a.js", "a/b/a.js"));
//     // try expect(!match("!**/a.js", "a/c/a.js"));
//     try expect(match("!**/a.js", "a/a/b.js"));
//     try expect(!match("!a/**/a.js", "a/a/a/a.js"));
//     try expect(match("!a/**/a.js", "b/a/b/a.js"));
//     try expect(match("!a/**/a.js", "c/a/c/a.js"));
//     try expect(match("!**/*.md", "a/b.js"));
//     try expect(match("!**/*.md", "a.js"));
//     try expect(!match("!**/*.md", "a/b.md"));
//     // try expect(!match("!**/*.md", "a.md"));
//     try expect(!match("**/*.md", "a/b.js"));
//     try expect(!match("**/*.md", "a.js"));
//     try expect(match("**/*.md", "a/b.md"));
//     try expect(match("**/*.md", "a.md"));
//     try expect(match("!**/*.md", "a/b.js"));
//     try expect(match("!**/*.md", "a.js"));
//     try expect(!match("!**/*.md", "a/b.md"));
//     // try expect(!match("!**/*.md", "a.md"));
//     try expect(match("!*.md", "a/b.js"));
//     try expect(match("!*.md", "a.js"));
//     try expect(match("!*.md", "a/b.md"));
//     try expect(!match("!*.md", "a.md"));
//     try expect(match("!**/*.md", "a.js"));
//     // try expect(!match("!**/*.md", "b.md"));
//     try expect(match("!**/*.md", "c.txt"));
// }

// test "question_mark" {
//     try expect(match("?", "a"));
//     try expect(!match("?", "aa"));
//     try expect(!match("?", "ab"));
//     try expect(!match("?", "aaa"));
//     try expect(!match("?", "abcdefg"));

//     try expect(!match("??", "a"));
//     try expect(match("??", "aa"));
//     try expect(match("??", "ab"));
//     try expect(!match("??", "aaa"));
//     try expect(!match("??", "abcdefg"));

//     try expect(!match("???", "a"));
//     try expect(!match("???", "aa"));
//     try expect(!match("???", "ab"));
//     try expect(match("???", "aaa"));
//     try expect(!match("???", "abcdefg"));

//     try expect(!match("a?c", "aaa"));
//     try expect(match("a?c", "aac"));
//     try expect(match("a?c", "abc"));
//     try expect(!match("ab?", "a"));
//     try expect(!match("ab?", "aa"));
//     try expect(!match("ab?", "ab"));
//     try expect(!match("ab?", "ac"));
//     try expect(!match("ab?", "abcd"));
//     try expect(!match("ab?", "abbb"));
//     try expect(match("a?b", "acb"));

//     try expect(!match("a/?/c/?/e.md", "a/bb/c/dd/e.md"));
//     try expect(match("a/??/c/??/e.md", "a/bb/c/dd/e.md"));
//     try expect(!match("a/??/c.md", "a/bbb/c.md"));
//     try expect(match("a/?/c.md", "a/b/c.md"));
//     try expect(match("a/?/c/?/e.md", "a/b/c/d/e.md"));
//     try expect(!match("a/?/c/???/e.md", "a/b/c/d/e.md"));
//     try expect(match("a/?/c/???/e.md", "a/b/c/zzz/e.md"));
//     try expect(!match("a/?/c.md", "a/bb/c.md"));
//     try expect(match("a/??/c.md", "a/bb/c.md"));
//     try expect(match("a/???/c.md", "a/bbb/c.md"));
//     try expect(match("a/????/c.md", "a/bbbb/c.md"));
// }

// test "braces" {
//     try expect(match("{a,b,c}", "a"));
//     try expect(match("{a,b,c}", "b"));
//     try expect(match("{a,b,c}", "c"));
//     try expect(!match("{a,b,c}", "aa"));
//     try expect(!match("{a,b,c}", "bb"));
//     try expect(!match("{a,b,c}", "cc"));

//     try expect(match("a/{a,b}", "a/a"));
//     try expect(match("a/{a,b}", "a/b"));
//     try expect(!match("a/{a,b}", "a/c"));
//     try expect(!match("a/{a,b}", "b/b"));
//     try expect(!match("a/{a,b,c}", "b/b"));
//     try expect(match("a/{a,b,c}", "a/c"));
//     try expect(match("a{b,bc}.txt", "abc.txt"));

//     try expect(match("foo[{a,b}]baz", "foo{baz"));

//     try expect(!match("a{,b}.txt", "abc.txt"));
//     try expect(!match("a{a,b,}.txt", "abc.txt"));
//     try expect(!match("a{b,}.txt", "abc.txt"));
//     try expect(match("a{,b}.txt", "a.txt"));
//     try expect(match("a{b,}.txt", "a.txt"));
//     try expect(match("a{a,b,}.txt", "aa.txt"));
//     try expect(match("a{a,b,}.txt", "aa.txt"));
//     try expect(match("a{,b}.txt", "ab.txt"));
//     try expect(match("a{b,}.txt", "ab.txt"));

//     // try expect(match("{a/,}a/**", "a"));
//     try expect(match("a{a,b/}*.txt", "aa.txt"));
//     try expect(match("a{a,b/}*.txt", "ab/.txt"));
//     try expect(match("a{a,b/}*.txt", "ab/a.txt"));
//     // try expect(match("{a/,}a/**", "a/"));
//     try expect(match("{a/,}a/**", "a/a/"));
//     // try expect(match("{a/,}a/**", "a/a"));
//     try expect(match("{a/,}a/**", "a/a/a"));
//     try expect(match("{a/,}a/**", "a/a/"));
//     try expect(match("{a/,}a/**", "a/a/a/"));
//     try expect(match("{a/,}b/**", "a/b/a/"));
//     try expect(match("{a/,}b/**", "b/a/"));
//     try expect(match("a{,/}*.txt", "a.txt"));
//     try expect(match("a{,/}*.txt", "ab.txt"));
//     try expect(match("a{,/}*.txt", "a/b.txt"));
//     try expect(match("a{,/}*.txt", "a/ab.txt"));

//     try expect(match("a{,.*{foo,db},\\(bar\\)}.txt", "a.txt"));
//     try expect(!match("a{,.*{foo,db},\\(bar\\)}.txt", "adb.txt"));
//     try expect(match("a{,.*{foo,db},\\(bar\\)}.txt", "a.db.txt"));

//     try expect(match("a{,*.{foo,db},\\(bar\\)}.txt", "a.txt"));
//     try expect(!match("a{,*.{foo,db},\\(bar\\)}.txt", "adb.txt"));
//     try expect(match("a{,*.{foo,db},\\(bar\\)}.txt", "a.db.txt"));

//     // try expect(match("a{,.*{foo,db},\\(bar\\)}", "a"));
//     try expect(!match("a{,.*{foo,db},\\(bar\\)}", "adb"));
//     try expect(match("a{,.*{foo,db},\\(bar\\)}", "a.db"));

//     // try expect(match("a{,*.{foo,db},\\(bar\\)}", "a"));
//     try expect(!match("a{,*.{foo,db},\\(bar\\)}", "adb"));
//     try expect(match("a{,*.{foo,db},\\(bar\\)}", "a.db"));

//     try expect(!match("{,.*{foo,db},\\(bar\\)}", "a"));
//     try expect(!match("{,.*{foo,db},\\(bar\\)}", "adb"));
//     try expect(!match("{,.*{foo,db},\\(bar\\)}", "a.db"));
//     try expect(match("{,.*{foo,db},\\(bar\\)}", ".db"));

//     try expect(!match("{,*.{foo,db},\\(bar\\)}", "a"));
//     try expect(match("{*,*.{foo,db},\\(bar\\)}", "a"));
//     try expect(!match("{,*.{foo,db},\\(bar\\)}", "adb"));
//     try expect(match("{,*.{foo,db},\\(bar\\)}", "a.db"));

//     try expect(!match("a/b/**/c{d,e}/**/xyz.md", "a/b/c/xyz.md"));
//     try expect(!match("a/b/**/c{d,e}/**/xyz.md", "a/b/d/xyz.md"));
//     try expect(match("a/b/**/c{d,e}/**/xyz.md", "a/b/cd/xyz.md"));
//     try expect(match("a/b/**/{c,d,e}/**/xyz.md", "a/b/c/xyz.md"));
//     try expect(match("a/b/**/{c,d,e}/**/xyz.md", "a/b/d/xyz.md"));
//     try expect(match("a/b/**/{c,d,e}/**/xyz.md", "a/b/e/xyz.md"));

//     try expect(match("*{a,b}*", "xax"));
//     try expect(match("*{a,b}*", "xxax"));
//     try expect(match("*{a,b}*", "xbx"));

//     try expect(match("*{*a,b}", "xba"));
//     try expect(match("*{*a,b}", "xb"));

//     try expect(!match("*??", "a"));
//     try expect(!match("*???", "aa"));
//     try expect(match("*???", "aaa"));
//     try expect(!match("*****??", "a"));
//     try expect(!match("*****???", "aa"));
//     try expect(match("*****???", "aaa"));

//     try expect(!match("a*?c", "aaa"));
//     try expect(match("a*?c", "aac"));
//     try expect(match("a*?c", "abc"));

//     try expect(match("a**?c", "abc"));
//     try expect(!match("a**?c", "abb"));
//     try expect(match("a**?c", "acc"));
//     try expect(match("a*****?c", "abc"));

//     try expect(match("*****?", "a"));
//     try expect(match("*****?", "aa"));
//     try expect(match("*****?", "abc"));
//     try expect(match("*****?", "zzz"));
//     try expect(match("*****?", "bbb"));
//     try expect(match("*****?", "aaaa"));

//     try expect(!match("*****??", "a"));
//     try expect(match("*****??", "aa"));
//     try expect(match("*****??", "abc"));
//     try expect(match("*****??", "zzz"));
//     try expect(match("*****??", "bbb"));
//     try expect(match("*****??", "aaaa"));

//     try expect(!match("?*****??", "a"));
//     try expect(!match("?*****??", "aa"));
//     try expect(match("?*****??", "abc"));
//     try expect(match("?*****??", "zzz"));
//     try expect(match("?*****??", "bbb"));
//     try expect(match("?*****??", "aaaa"));

//     try expect(match("?*****?c", "abc"));
//     try expect(!match("?*****?c", "abb"));
//     try expect(!match("?*****?c", "zzz"));

//     try expect(match("?***?****c", "abc"));
//     try expect(!match("?***?****c", "bbb"));
//     try expect(!match("?***?****c", "zzz"));

//     try expect(match("?***?****?", "abc"));
//     try expect(match("?***?****?", "bbb"));
//     try expect(match("?***?****?", "zzz"));

//     try expect(match("?***?****", "abc"));
//     try expect(match("*******c", "abc"));
//     try expect(match("*******?", "abc"));
//     try expect(match("a*cd**?**??k", "abcdecdhjk"));
//     try expect(match("a**?**cd**?**??k", "abcdecdhjk"));
//     try expect(match("a**?**cd**?**??k***", "abcdecdhjk"));
//     try expect(match("a**?**cd**?**??***k", "abcdecdhjk"));
//     try expect(match("a**?**cd**?**??***k**", "abcdecdhjk"));
//     try expect(match("a****c**?**??*****", "abcdecdhjk"));

//     try expect(!match("a/?/c/?/*/e.md", "a/b/c/d/e.md"));
//     try expect(match("a/?/c/?/*/e.md", "a/b/c/d/e/e.md"));
//     try expect(match("a/?/c/?/*/e.md", "a/b/c/d/efghijk/e.md"));
//     try expect(match("a/?/**/e.md", "a/b/c/d/efghijk/e.md"));
//     try expect(!match("a/?/e.md", "a/bb/e.md"));
//     try expect(match("a/??/e.md", "a/bb/e.md"));
//     try expect(!match("a/?/**/e.md", "a/bb/e.md"));
//     try expect(match("a/?/**/e.md", "a/b/ccc/e.md"));
//     try expect(match("a/*/?/**/e.md", "a/b/c/d/efghijk/e.md"));
//     try expect(match("a/*/?/**/e.md", "a/b/c/d/efgh.ijk/e.md"));
//     try expect(match("a/*/?/**/e.md", "a/b.bb/c/d/efgh.ijk/e.md"));
//     try expect(match("a/*/?/**/e.md", "a/bbb/c/d/efgh.ijk/e.md"));

//     try expect(match("a/*/ab??.md", "a/bbb/abcd.md"));
//     try expect(match("a/bbb/ab??.md", "a/bbb/abcd.md"));
//     try expect(match("a/bbb/ab???md", "a/bbb/abcd.md"));
// }

// fn matchSame(str: []const u8) bool {
//     return match(str, str);
// }
// test "fuzz_tests" {
//     // https://github.com/devongovett/glob-match/issues/1
//     try expect(!matchSame(
//         "{*{??*{??**,Uz*zz}w**{*{**a,z***b*[!}w??*azzzzzzzz*!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!z[za,z&zz}w**z*z*}",
//     ));
//     try expect(!matchSame(
//         "**** *{*{??*{??***\x05 *{*{??*{??***0x5,\x00U\x00}]*****0x1,\x00***\x00,\x00\x00}w****,\x00U\x00}]*****0x1,\x00***\x00,\x00\x00}w*****0x1***{}*.*\x00\x00*\x00",
//     ));
// }
