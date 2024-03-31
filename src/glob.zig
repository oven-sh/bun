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
const bun = @import("root").bun;

const eqlComptime = @import("./string_immutable.zig").eqlComptime;
const expect = std.testing.expect;
const isAllAscii = @import("./string_immutable.zig").isAllASCII;
const math = std.math;
const mem = std.mem;
const isWindows = @import("builtin").os.tag == .windows;

const Allocator = std.mem.Allocator;
const Arena = std.heap.ArenaAllocator;
const ArrayList = std.ArrayListUnmanaged;
const ArrayListManaged = std.ArrayList;
const BunString = bun.String;
const C = @import("./c.zig");
const CodepointIterator = @import("./string_immutable.zig").PackedCodepointIterator;
const Codepoint = CodepointIterator.Cursor.CodePointType;
const Dirent = @import("./bun.js/node/types.zig").Dirent;
const DirIterator = @import("./bun.js/node/dir_iterator.zig");
const EntryKind = @import("./bun.js/node/types.zig").Dirent.Kind;
const GlobAscii = @import("./glob_ascii.zig");
const JSC = bun.JSC;
const Maybe = JSC.Maybe;
const PathLike = @import("./bun.js/node/types.zig").PathLike;
const PathString = @import("./string_types.zig").PathString;
const ResolvePath = @import("./resolver/resolve_path.zig");
const Syscall = bun.sys;
const ZigString = @import("./bun.js/bindings/bindings.zig").ZigString;

// const Codepoint = u32;
const Cursor = CodepointIterator.Cursor;

const log = bun.Output.scoped(.Glob, false);

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

        pathBuf: bun.PathBuffer = undefined,
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
                log("Iterator init pattern={s}", .{this.walker.pattern});
                var path_buf: *[bun.MAX_PATH_BYTES]u8 = &this.walker.pathBuf;
                const root_path = this.walker.cwd;
                @memcpy(path_buf[0..root_path.len], root_path[0..root_path.len]);
                path_buf[root_path.len] = 0;
                const root_path_z = path_buf[0..root_path.len :0];
                const cwd_fd = switch (Syscall.open(root_path_z, std.os.O.DIRECTORY | std.os.O.RDONLY, 0)) {
                    .err => |err| return .{ .err = this.walker.handleSysErrWithPath(err, root_path_z) },
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
                if (fd == this.cwd_fd or fd == bun.invalid_fd) return;
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
                log("transition => {s}", .{work_item.path});
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
                this.iter_state.directory.fd = bun.invalid_fd;

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

                log("Transition(dirpath={s}, fd={}, component_idx={d})", .{ dir_path, fd, component_idx });

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
                            log("dir: {s} entry: {s}", .{ dir.dir_path, entry.name.slice() });

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
            return try this.initWithCwd(
                arena,
                pattern,
                bun.fs.FileSystem.instance.top_level_dir,
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

        pub fn debugPatternComopnents(this: *GlobWalker) void {
            const pattern = this.pattern;
            const components = &this.patternComponents;
            const ptr = @intFromPtr(this);
            log("GlobWalker(0x{x}) components:", .{ptr});
            for (components.items) |cmp| {
                if (cmp.syntax_hint == .None) {
                    continue;
                }
                switch (cmp.syntax_hint) {
                    .Single => log("  *", .{}),
                    .Double => log("  **", .{}),
                    .Dot => log("  .", .{}),
                    .DotBack => log("  ../", .{}),
                    .Literal, .WildcardFilepath, .None => log("  hint={s} component_str={s}", .{ @tagName(cmp.syntax_hint), pattern[cmp.start .. cmp.start + cmp.len] }),
                }
            }
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

            if (bun.Environment.allow_assert) {
                this.debugPatternComopnents();
            }

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
                log("walker: matched path: {s}", .{path});
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
            log("matchPatternImpl: {s}", .{filepath});
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
            return filepath.len > 0 and filepath[0] == '.';
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
                                // The fast path checks that path[1..] == pattern[1..],
                                // this will obviously not work if additional
                                // glob syntax is present in the pattern, so we
                                // must not apply this optimization if we see
                                // special glob syntax.
                                //
                                // This is not a complete check, there can be
                                // false negatives, but that's okay, it just
                                // means we don't apply the optimization.
                                //
                                // We also don't need to look for the `!` token,
                                // because that only applies negation if at the
                                // beginning of the string.
                                '[', '{', '?', '*' => break :out_of_check_wildcard_filepath,
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
