const std = @import("std");
const bun = @import("root").bun;
const Syscall = @import("../sys.zig");
const Arena = std.heap.ArenaAllocator;
const os = std.os;
const builtin = @import("builtin");
const Maybe = @import("../bun.js/node/types.zig").Maybe;
const ResolvePath = @import("../resolver/resolve_path.zig");
const Allocator = std.mem.Allocator;
const DirIterator = @import("../bun.js/node/dir_iterator.zig");

/// rmdir implementation, but specifically mimicking `rm` behaviour
pub fn RmdirShell(comptime Ctx: type) type {
    const Handler = struct {
        ctx: *Ctx,

        pub fn writeToStdout(this: *Ctx, comptime fmt: []const u8, args: anytype) Maybe(void) {
            return this.writeToStdout(fmt, args);
        }
    };

    return struct {
        const print = bun.Output.scoped(.RmdirShell, false);

        ctx: *Ctx,
        allocator: Allocator,
        opts: Opts,
        cwd: bun.FileDescriptor,
        absolute: bool = false,
        entries_to_delete: []const [*:0]const u8,
        dir_path_buffer: ?*[bun.MAX_PATH_BYTES]u8 = null,
        dir_path_len: usize = 0,
        // err: ?Syscall.Error = null,

        pub fn arena(this: *@This()) Allocator {
            return this.allocator;
        }

        const Dir = std.fs.Dir;

        pub fn run(this: *@This()) ?Syscall.Error {
            var pathbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const cwd_path_no_sentinel = switch (bun.sys.getcwd(&pathbuf)) {
                .result => |p| p,
                .err => |e| {
                    return e;
                },
            };
            pathbuf[cwd_path_no_sentinel.len] = 0;
            const cwd_path = pathbuf[0..cwd_path_no_sentinel.len :0];
            for (this.entries_to_delete) |entry_raw| {
                const entry = entry_raw[0..std.mem.len(entry_raw) :0];
                if (this.opts.recursive) {
                    switch (this.deleteTree(this.cwd, cwd_path, entry)) {
                        .result => {},
                        .err => |e| {
                            return e;
                        },
                    }
                }
            }

            return null;
        }

        pub fn deleteTree(this: *@This(), self: bun.FileDescriptor, self_path: [:0]const u8, sub_path: [:0]const u8) Maybe(void) {
            _ = this;
            _ = self;
            _ = self_path;
            _ = sub_path;
        }

        /// Modified version of `std.fs.deleteTree`:
        /// - nonsense instances of `unreachable` removed
        /// - uses Bun's syscall functions
        /// - can pass a Context which allows you to inspect which files/directories have been deleted (needed for shell's implementation of rm with verbose flag)
        /// - throws errors if ENOENT is encountered, unless rm -v option is used
        ///
        /// Whether `full_path` describes a symlink, file, or directory, this function
        /// removes it. If it cannot be removed because it is a non-empty directory,
        /// this function recursively removes its entries and then tries again.
        /// This operation is not atomic on most file systems.
        pub fn deleteTreeOld(this: *@This(), self: bun.FileDescriptor, self_path: [:0]const u8, sub_path: [:0]const u8) Maybe(void) {
            const is_absolute = ResolvePath.Platform.auto.isAbsolute(sub_path);
            this.absolute = is_absolute;
            if (!is_absolute) {
                const slice = this.arena().alloc(u8, bun.MAX_PATH_BYTES) catch bun.outOfMemory();
                this.dir_path_buffer = @ptrCast(slice.ptr);
            }

            const resolved_sub_path = if (is_absolute)
                sub_path
            else
                ResolvePath.joinZ(&[_][:0]const u8{ self_path, sub_path }, .auto);

            // Avoiding processing root directort if preserve root option is set
            // FIXME supoprt windows (std.fs.diskdesignator() something something)
            if (this.opts.preserve_root and std.mem.eql(u8, resolved_sub_path[0..resolved_sub_path.len], "/"))
                return Maybe(void).success;

            var initial_iterable = switch (this.deleteTreeOpenInitialSubpath(self, sub_path, .file, 0)) {
                .result => |r| r orelse return Maybe(void).success,
                .err => |e| return .{ .err = e },
            };

            const StackItem = struct {
                name: [:0]const u8,
                parent_dir: bun.FileDescriptor,
                dir_path_len: usize,
                iter: DirIterator.WrappedIterator,
            };

            // DirIterator.WrappedIterator is quite large so just two of these equals ~16.496 kB
            var stack = std.BoundedArray(StackItem, 2){};
            defer {
                for (stack.slice()) |*item| {
                    item.iter.iter.dir.close();
                }
            }

            stack.appendAssumeCapacity(StackItem{
                .name = sub_path,
                .dir_path_len = 0,
                .parent_dir = self,
                .iter = initial_iterable,
            });

            process_stack: while (stack.len != 0) {
                var top: *StackItem = &(stack.slice()[stack.len - 1]);
                const parent_dir_path_len = top.dir_path_len;
                var dir_path_len: usize = 0;
                if (!this.absolute) {
                    dir_path_len = top.dir_path_len + top.name.len;
                    @memcpy(this.dir_path_buffer.?[top.dir_path_len..dir_path_len], top.name[0..top.name.len]);
                }
                defer {
                    if (!this.absolute) {
                        this.dir_path_buffer.?[parent_dir_path_len] = 0;
                    }
                }

                var entry_ = top.iter.next();
                while (switch (entry_) {
                    .err => @panic("FIXME TODO errors"),
                    .result => |ent| ent,
                    // gotta be careful not to pop otherwise this won't work
                }) |entry| : (entry_ = top.iter.next()) {
                    var treat_as_dir = entry.kind == .directory;
                    handle_entry: while (true) {
                        if (treat_as_dir) {
                            if (stack.ensureUnusedCapacity(1)) {
                                var iterable_dir = switch (this.openIterableDir(top.iter.iter.dir.fd, entry.name.sliceAssumeZ())) {
                                    .result => |iter| iter,
                                    .err => |e| {
                                        const errno = errnocast(e.errno);
                                        switch (errno) {
                                            @as(u16, @intFromEnum(bun.C.E.NOTDIR)) => {
                                                treat_as_dir = false;
                                                continue :handle_entry;
                                            },
                                            @as(u16, @intFromEnum(bun.C.E.NOENT)) => {
                                                if (this.opts.force) {
                                                    switch (this.verboseDeleted(entry.name.sliceAssumeZ(), dir_path_len)) {
                                                        .result => {},
                                                        .err => |e2| return Maybe(void).initErr(e2),
                                                    }
                                                    break :handle_entry;
                                                }
                                                return .{ .err = e };
                                            },
                                            else => return .{ .err = e },
                                        }
                                    },
                                };

                                stack.appendAssumeCapacity(StackItem{
                                    .name = entry.name.sliceAssumeZ(),
                                    .parent_dir = top.iter.iter.dir.fd,
                                    .dir_path_len = dir_path_len,
                                    .iter = iterable_dir,
                                });

                                continue :process_stack;
                            } else |_| {
                                // FIXME
                                // switch (this.deleteTreeMinStackSizeWithKindHint(top.iter.iter.dir.fd, entry.name.sliceAssumeZ(), entry.kind)) {
                                //     .result => {},
                                //     .err => |e| return .{ .err = e },
                                // }
                                // try top.iter.dir.deleteTreeMinStackSizeWithKindHint(entry.name, entry.kind);
                                break :handle_entry;
                            }
                        } else {
                            switch (this.deleteFile(bun.toFD(top.iter.iter.dir.fd), entry.name.sliceAssumeZ(), dir_path_len)) {
                                .result => |try_as_dir| {
                                    if (try_as_dir) {
                                        treat_as_dir = true;
                                        continue :handle_entry;
                                    }
                                    break :handle_entry;
                                },
                                .err => |e| {
                                    switch (e.getErrno()) {
                                        bun.C.E.NOENT => {
                                            if (this.opts.force) {
                                                switch (this.verboseDeleted(entry.name.sliceAssumeZ(), dir_path_len)) {
                                                    .result => {},
                                                    .err => |e2| return Maybe(void).initErr(e2),
                                                }
                                                break :handle_entry;
                                            }
                                            return .{ .err = e };
                                        },
                                        bun.C.E.ISDIR, bun.C.E.NOTEMPTY => {
                                            treat_as_dir = true;
                                            continue :handle_entry;
                                        },
                                        else => return .{ .err = e },
                                    }
                                },
                            }
                        }
                    }
                }

                // On Windows, we can't delete until the dir's handle has been closed, so
                // close it before we try to delete.
                _ = Syscall.close(top.iter.iter.dir.fd);
                // top.iter.dir.close();

                // In order to avoid double-closing the directory when cleaning up
                // the stack in the case of an error, we save the relevant portions and
                // pop the value from the stack.
                const parent_dir = top.parent_dir;
                const name = top.name;
                _ = stack.pop();

                var need_to_retry: bool = false;

                switch (this.deleteDir(parent_dir, name, parent_dir_path_len)) {
                    .result => {},
                    .err => |e| {
                        switch (errnocast(e.errno)) {
                            @intFromEnum(bun.C.E.NOTEMPTY) => need_to_retry = true,
                            else => return .{ .err = e },
                        }
                    },
                }

                if (need_to_retry) {
                    // Since we closed the handle that the previous iterator used, we
                    // need to re-open the dir and re-create the iterator.
                    var iterable_dir = iterable_dir: {
                        var treat_as_dir = true;
                        handle_entry: while (true) {
                            if (treat_as_dir) {
                                break :iterable_dir switch (this.openIterableDir(parent_dir, name)) {
                                    .result => |iter| iter,
                                    .err => |e| {
                                        switch (errnocast(e.errno)) {
                                            @intFromEnum(bun.C.E.NOTDIR) => {
                                                treat_as_dir = false;
                                                continue :handle_entry;
                                            },
                                            @intFromEnum(bun.C.E.NOENT) => {
                                                if (this.opts.force) {
                                                    switch (this.verboseDeleted(name, parent_dir_path_len)) {
                                                        .err => |e2| return .{ .err = e2 },
                                                        else => {},
                                                    }
                                                    continue :process_stack;
                                                }

                                                return .{ .err = e };
                                            },
                                            else => return .{ .err = e },
                                        }
                                    },
                                };
                            } else {
                                switch (this.deleteFile(bun.toFD(top.iter.iter.dir.fd), name, parent_dir_path_len)) {
                                    .result => |try_as_dir| {
                                        if (try_as_dir) {
                                            treat_as_dir = true;
                                            continue :handle_entry;
                                        }
                                        continue :process_stack;
                                    },
                                    .err => |e| {
                                        const errno = errnocast(e.errno);

                                        switch (errno) {
                                            @intFromEnum(bun.C.E.NOENT) => {
                                                if (this.opts.force) {
                                                    switch (this.verboseDeleted(name, parent_dir_path_len)) {
                                                        .result => {},
                                                        .err => |e2| return Maybe(void).initErr(e2),
                                                    }
                                                    continue :process_stack;
                                                }
                                                return .{ .err = e };
                                            },
                                            @intFromEnum(bun.C.E.ISDIR) => {
                                                treat_as_dir = true;
                                                continue :handle_entry;
                                            },
                                            else => return .{ .err = e },
                                        }
                                    },
                                }
                            }
                        }
                    };

                    // We know there is room on the stack since we are just re-adding
                    // the StackItem that we previously popped.
                    stack.appendAssumeCapacity(StackItem{
                        .name = name,
                        .parent_dir = parent_dir,
                        .dir_path_len = parent_dir_path_len,
                        .iter = iterable_dir,
                    });

                    continue :process_stack;
                }
            }

            return Maybe(void).success;
        }

        /// If the --preserve-root option is set, will return true if the
        /// file descriptor points to root directory. Otherwise will always
        /// return false
        fn preserveRootCheck(this: *@This(), fd: anytype) Maybe(bool) {
            if (this.opts.preserve_root) {
                var pathbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const path = bun.getFdPath(fd, &pathbuf) catch |err| {
                    const errno = switch (err) {
                        .FileNotFound => bun.C.E.NOENT,
                        .AccessDenied => bun.C.E.ACCES,
                        .NameTooLong => bun.C.E.NAMETOOLONG,
                        .NotSupported => bun.C.E.NOTSUP,
                        .NotDir => bun.C.E.NOTDIR,
                        .SymLinkLoop => bun.C.E.LOOP,
                        .InputOutput => bun.C.E.IO,
                        .FileTooBig => bun.C.E.FBIG,
                        .IsDir => bun.C.E.ISDIR,
                        .ProcessFdQuotaExceeded => bun.C.E.MFILE,
                        .SystemFdQuotaExceeded => bun.C.E.NFILE,
                        .NoDevice => bun.C.E.NODEV,
                        .SystemResources => bun.C.E.NOSYS, // or EAGAIN if it's a temporary lack of resources
                        .NoSpaceLeft => bun.C.E.NOSPC,
                        .FileSystem => bun.C.E.IO, // or another appropriate error if there's a more specific cause
                        .BadPathName => bun.C.E.NOENT, // ENOENT or EINVAL, depending on the situation
                        .DeviceBusy => bun.C.E.BUSY,
                        .SharingViolation => bun.C.E.ACCES, // For POSIX, EACCES might be the closest match
                        .PipeBusy => bun.C.E.BUSY,
                        .InvalidHandle => bun.C.E.BADF,
                        .InvalidUtf8 => bun.C.E.INVAL,
                        .NetworkNotFound => bun.C.E.NOENT, // or ENETUNREACH depending on context
                        .PathAlreadyExists => bun.C.E.EXIST,
                        .Unexpected => bun.C.E.INVAL, // or another error that makes sense in the context
                    };

                    return Maybe(bool).errno(errno);
                };
                // FIXME windows
                return .{ .result = std.mem.eql(u8, path, "/") };
            }

            return .{ .result = false };
        }

        fn openIterableDir(this: *@This(), self: bun.FileDescriptor, sub_path: [:0]const u8) Maybe(DirIterator.WrappedIterator) {
            _ = this;
            const fd = switch (Syscall.openat(self, sub_path, os.O.DIRECTORY | os.O.RDONLY | os.O.CLOEXEC, 0)) {
                .err => |e| {
                    return .{ .err = e };
                },
                .result => |fd| fd,
            };

            var dir = std.fs.Dir{ .fd = bun.fdcast(fd) };
            var iterator = DirIterator.iterate(dir);
            return .{ .result = iterator };
        }

        /// On successful delete, returns null.
        fn deleteTreeOpenInitialSubpath(this: *@This(), self: bun.FileDescriptor, sub_path: [:0]const u8, kind_hint: std.fs.File.Kind, dir_path_len: usize) Maybe(?DirIterator.WrappedIterator) {
            return iterable_dir: {
                // Treat as a file by default
                var treat_as_dir = kind_hint == .directory;

                handle_entry: while (true) {
                    if (treat_as_dir) {
                        const fd = switch (Syscall.openat(self, sub_path, os.O.DIRECTORY | os.O.RDONLY | os.O.CLOEXEC, 0)) {
                            .err => |e| {
                                switch (errnocast(e.errno)) {
                                    @as(u16, @intFromEnum(bun.C.E.NOTDIR)) => {
                                        treat_as_dir = false;
                                        continue :handle_entry;
                                    },
                                    @as(u16, @intFromEnum(bun.C.E.NOENT)) => {
                                        if (this.opts.force) {
                                            // That's fine, we were trying to remove this directory anyway.
                                            break :handle_entry;
                                        }
                                        return .{ .err = e };
                                    },
                                    else => return Maybe(?DirIterator.WrappedIterator).initErr(e),
                                }
                            },
                            .result => |fd| fd,
                        };
                        var dir = std.fs.Dir{ .fd = bun.fdcast(fd) };
                        var iterator = DirIterator.iterate(dir);
                        break :iterable_dir .{ .result = iterator };
                    } else {
                        switch (this.deleteFile(self, sub_path, dir_path_len)) {
                            .result => |try_as_dir| {
                                if (try_as_dir) {
                                    treat_as_dir = true;
                                    continue :handle_entry;
                                }
                                return .{ .result = null };
                            },
                            .err => |e| {
                                switch (e.getErrno()) {
                                    bun.C.E.NOENT => return if (this.opts.force) .{ .result = null } else .{ .err = e },
                                    // Is a dir
                                    bun.C.E.ISDIR, bun.C.E.NOTEMPTY => {
                                        treat_as_dir = true;
                                        continue :handle_entry;
                                    },
                                    else => return Maybe(?DirIterator.WrappedIterator).initErr(e),
                                }
                            },
                        }
                    }
                }
            };
        }

        pub fn deleteDir(
            this: *@This(),
            parentfd: bun.FileDescriptor,
            subpath: [:0]const u8,
            dir_path_len: usize,
        ) Maybe(void) {
            switch (Syscall.unlinkatWithFlags(parentfd, subpath, std.os.AT.REMOVEDIR)) {
                .result => return this.verboseDeleted(subpath, dir_path_len),
                .err => |e| {
                    const errno = errnocast(e.errno);
                    if (@intFromEnum(bun.C.E.NOENT) == errno and this.opts.force) {
                        return this.verboseDeleted(subpath, dir_path_len);
                    }
                    return .{ .err = e };
                },
            }
        }

        /// Returns true if path actually pointed to a directory, and the caller should process that.
        pub fn deleteFile(
            this: *@This(),
            dirfd: bun.FileDescriptor,
            subpath: [:0]const u8,
            dir_path_len: usize,
        ) Maybe(bool) {
            switch (Syscall.unlinkat(dirfd, subpath)) {
                .result => return switch (this.verboseDeleted(subpath, dir_path_len)) {
                    .result => .{ .result = false },
                    .err => |e| .{ .err = e },
                },
                .err => |e| {
                    switch (e.getErrno()) {
                        bun.C.E.ISDIR => {
                            return .{ .result = true };
                        },
                        // non-Linux POSIX systems return EPERM when trying to delete a directory, so
                        // we need to handle that case specifically
                        bun.C.E.PERM => {
                            switch (builtin.os.tag) {
                                // The entry could be a directory, or this is a regular permissions error, so we
                                // call unlinktat with AT_REMOVEDIR flag. This will tell us if it is a directory, or it is a permissions error.
                                .macos, .ios, .freebsd, .netbsd, .dragonfly, .openbsd, .solaris, .illumos => {
                                    if (this.opts.remove_empty_dirs) {
                                        return switch (Syscall.unlinkatWithFlags(dirfd, subpath, std.os.AT.REMOVEDIR)) {
                                            .result => switch (this.verboseDeleted(subpath, dir_path_len)) {
                                                .result => .{ .result = false },
                                                .err => |e2| Maybe(bool).initErr(e2),
                                            },
                                            .err => |e2| {
                                                const errno = e2.getErrno();
                                                return switch (errno) {
                                                    bun.C.E.NOTEMPTY => .{ .result = true },
                                                    // It was a regular permissions error, return the original error
                                                    bun.C.E.NOTDIR => .{ .err = e },
                                                    else => .{ .err = e2 },
                                                };
                                            },
                                        };
                                    }
                                    return .{ .result = true };
                                },
                                else => return .{ .err = e },
                            }
                        },
                        else => return .{ .err = e },
                    }
                },
            }
        }

        pub fn verboseDeleted(this: *@This(), path: [:0]const u8, dir_path_len: usize) Maybe(void) {
            if (this.opts.verbose) {
                defer {
                    if (!this.absolute) {
                        this.dir_path_buffer.?[dir_path_len] = 0;
                    }
                }
                print("deleted: {s}", .{path});

                const fullpath = if (this.absolute) path else brk: {
                    const end = dir_path_len + path.len;
                    @memcpy(this.dir_path_buffer.?[dir_path_len .. dir_path_len + path.len], path);
                    this.dir_path_buffer.?[end] = 0;
                    break :brk this.dir_path_buffer.?[0..end];
                };

                return Handler.writeToStdout(this.ctx, "{s}\n", .{fullpath});
            }

            return Maybe(void).success;
        }
    };
}

pub const Opts = struct {
    /// `--no-preserve-root` / `--preserve-root`
    ///
    /// If set to false, then allow the recursive removal of the root directory.
    /// Safety feature to prevent accidental deletion of the root directory.
    preserve_root: bool = true,

    /// `-f`, `--force`
    ///
    /// Ignore nonexistent files and arguments, never prompt.
    force: bool = false,

    /// Configures how the user should be prompted on removal of files.
    prompt_behaviour: PromptBehaviour = .never,

    /// `-r`, `-R`, `--recursive`
    ///
    /// Remove directories and their contents recursively.
    recursive: bool = false,

    /// `-v`, `--verbose`
    ///
    /// Explain what is being done (prints which files/dirs are being deleted).
    verbose: bool = false,

    /// `-d`, `--dir`
    ///
    /// Remove empty directories. This option permits you to remove a directory
    /// without specifying `-r`/`-R`/`--recursive`, provided that the directory is
    /// empty.
    remove_empty_dirs: bool = false,

    const PromptBehaviour = union(enum) {
        /// `--interactive=never`
        ///
        /// Default
        never,

        /// `-I`, `--interactive=once`
        ///
        /// Once before removing more than three files, or when removing recursively.
        once: struct {
            removed_count: u32 = 0,
        },

        /// `-i`, `--interactive=always`
        ///
        /// Prompt before every removal.
        always,
    };
};

inline fn errnocast(errno: anytype) u16 {
    return @intCast(errno);
}
