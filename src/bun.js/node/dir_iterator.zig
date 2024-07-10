// This is copied from std.fs.Dir.Iterator
// The differences are:
// - it returns errors in the expected format
// - doesn't mark BADF as unreachable
// - It uses PathString instead of []const u8
// - Windows can be configured to return []const u16

const builtin = @import("builtin");
const std = @import("std");
const posix = std.posix;

const Dir = std.fs.Dir;
const JSC = bun.JSC;
const PathString = JSC.PathString;
const bun = @import("root").bun;

const IteratorError = error{ AccessDenied, SystemResources } || posix.UnexpectedError;
const mem = std.mem;
const strings = bun.strings;
const Maybe = JSC.Maybe;
const File = std.fs.File;

pub const IteratorResult = struct {
    name: PathString,
    kind: Entry.Kind,
};
const Result = Maybe(?IteratorResult);

const IteratorResultW = struct {
    // fake PathString to have less `if (Environment.isWindows) ...`
    name: struct {
        data: [:0]const u16,

        pub fn slice(this: @This()) []const u16 {
            return this.data;
        }

        pub fn sliceAssumeZ(this: @This()) [:0]const u16 {
            return this.data;
        }
    },
    kind: Entry.Kind,
};
const ResultW = Maybe(?IteratorResultW);

const Entry = JSC.Node.Dirent;

pub const Iterator = NewIterator(false);
pub const IteratorW = NewIterator(true);

pub fn NewIterator(comptime use_windows_ospath: bool) type {
    return switch (builtin.os.tag) {
        .macos, .ios, .freebsd, .netbsd, .dragonfly, .openbsd, .solaris => struct {
            dir: Dir,
            seek: i64,
            buf: [8192]u8, // TODO align(@alignOf(os.system.dirent)),
            index: usize,
            end_index: usize,
            received_eof: bool = false,

            const Self = @This();

            pub const Error = IteratorError;

            fn fd(self: *Self) posix.fd_t {
                return self.dir.fd;
            }

            /// Memory such as file names referenced in this returned entry becomes invalid
            /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
            pub const next = switch (builtin.os.tag) {
                .macos, .ios => nextDarwin,
                // .freebsd, .netbsd, .dragonfly, .openbsd => nextBsd,
                // .solaris => nextSolaris,
                else => @compileError("unimplemented"),
            };

            fn nextDarwin(self: *Self) Result {
                start_over: while (true) {
                    if (self.index >= self.end_index) {
                        if (self.received_eof) {
                            return .{ .result = null };
                        }

                        // getdirentries64() writes to the last 4 bytes of the
                        // buffer to indicate EOF. If that value is not zero, we
                        // have reached the end of the directory and we can skip
                        // the extra syscall.
                        // https://github.com/apple-oss-distributions/xnu/blob/94d3b452840153a99b38a3a9659680b2a006908e/bsd/vfs/vfs_syscalls.c#L10444-L10470
                        const GETDIRENTRIES64_EXTENDED_BUFSIZE = 1024;
                        comptime bun.assert(@sizeOf(@TypeOf(self.buf)) >= GETDIRENTRIES64_EXTENDED_BUFSIZE);
                        self.received_eof = false;
                        // Always zero the bytes where the flag will be written
                        // so we don't confuse garbage with EOF.
                        self.buf[self.buf.len - 4 ..][0..4].* = .{ 0, 0, 0, 0 };

                        const rc = posix.system.__getdirentries64(
                            self.dir.fd,
                            &self.buf,
                            self.buf.len,
                            &self.seek,
                        );

                        if (rc < 1) {
                            if (rc == 0) {
                                self.received_eof = true;
                                return Result{ .result = null };
                            }

                            if (Result.errnoSys(rc, .getdirentries64)) |err| {
                                return err;
                            }
                        }

                        self.index = 0;
                        self.end_index = @as(usize, @intCast(rc));
                        self.received_eof = self.end_index <= (self.buf.len - 4) and @as(u32, @bitCast(self.buf[self.buf.len - 4 ..][0..4].*)) == 1;
                    }
                    const darwin_entry = @as(*align(1) posix.system.dirent, @ptrCast(&self.buf[self.index]));
                    const next_index = self.index + darwin_entry.reclen;
                    self.index = next_index;

                    const name = @as([*]u8, @ptrCast(&darwin_entry.name))[0..darwin_entry.namlen];

                    if (strings.eqlComptime(name, ".") or strings.eqlComptime(name, "..") or (darwin_entry.ino == 0)) {
                        continue :start_over;
                    }

                    const entry_kind = switch (darwin_entry.type) {
                        posix.DT.BLK => Entry.Kind.block_device,
                        posix.DT.CHR => Entry.Kind.character_device,
                        posix.DT.DIR => Entry.Kind.directory,
                        posix.DT.FIFO => Entry.Kind.named_pipe,
                        posix.DT.LNK => Entry.Kind.sym_link,
                        posix.DT.REG => Entry.Kind.file,
                        posix.DT.SOCK => Entry.Kind.unix_domain_socket,
                        posix.DT.WHT => Entry.Kind.whiteout,
                        else => Entry.Kind.unknown,
                    };
                    return .{
                        .result = IteratorResult{
                            .name = PathString.init(name),
                            .kind = entry_kind,
                        },
                    };
                }
            }
        },
        .linux => struct {
            dir: Dir,
            // The if guard is solely there to prevent compile errors from missing `linux.dirent64`
            // definition when compiling for other OSes. It doesn't do anything when compiling for Linux.
            buf: [8192]u8 align(if (builtin.os.tag != .linux) 1 else @alignOf(linux.dirent64)),
            index: usize,
            end_index: usize,

            const Self = @This();
            const linux = std.os.linux;

            pub const Error = IteratorError;

            fn fd(self: *Self) posix.fd_t {
                return self.dir.fd;
            }

            /// Memory such as file names referenced in this returned entry becomes invalid
            /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
            pub fn next(self: *Self) Result {
                start_over: while (true) {
                    if (self.index >= self.end_index) {
                        const rc = linux.getdents64(self.dir.fd, &self.buf, self.buf.len);
                        if (Result.errnoSys(rc, .getdents64)) |err| return err;
                        if (rc == 0) return .{ .result = null };
                        self.index = 0;
                        self.end_index = rc;
                    }
                    const linux_entry = @as(*align(1) linux.dirent64, @ptrCast(&self.buf[self.index]));
                    const next_index = self.index + linux_entry.reclen;
                    self.index = next_index;

                    const name = mem.sliceTo(@as([*:0]u8, @ptrCast(&linux_entry.name)), 0);

                    // skip . and .. entries
                    if (strings.eqlComptime(name, ".") or strings.eqlComptime(name, "..")) {
                        continue :start_over;
                    }

                    const entry_kind = switch (linux_entry.type) {
                        linux.DT.BLK => Entry.Kind.block_device,
                        linux.DT.CHR => Entry.Kind.character_device,
                        linux.DT.DIR => Entry.Kind.directory,
                        linux.DT.FIFO => Entry.Kind.named_pipe,
                        linux.DT.LNK => Entry.Kind.sym_link,
                        linux.DT.REG => Entry.Kind.file,
                        linux.DT.SOCK => Entry.Kind.unix_domain_socket,
                        else => Entry.Kind.unknown,
                    };
                    return .{
                        .result = IteratorResult{
                            .name = PathString.init(name),
                            .kind = entry_kind,
                        },
                    };
                }
            }
        },
        .windows => struct {
            const FILE_DIRECTORY_INFORMATION = std.os.windows.FILE_DIRECTORY_INFORMATION;
            // While the official api docs guarantee FILE_BOTH_DIR_INFORMATION to be aligned properly
            // this may not always be the case (e.g. due to faulty VM/Sandboxing tools)
            const FILE_DIRECTORY_INFORMATION_PTR = *align(2) FILE_DIRECTORY_INFORMATION;
            dir: Dir,

            // This structure must be aligned on a LONGLONG (8-byte) boundary.
            // If a buffer contains two or more of these structures, the
            // NextEntryOffset value in each entry, except the last, falls on an
            // 8-byte boundary.
            // https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_directory_information
            buf: [8192]u8 align(8),
            index: usize,
            end_index: usize,
            first: bool,
            name_data: if (use_windows_ospath) [257]u16 else [513]u8,

            const Self = @This();

            pub const Error = IteratorError;

            const ResultT = if (use_windows_ospath) ResultW else Result;

            fn fd(self: *Self) posix.fd_t {
                return self.dir.fd;
            }

            /// Memory such as file names referenced in this returned entry becomes invalid
            /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
            pub fn next(self: *Self) ResultT {
                while (true) {
                    const w = std.os.windows;
                    if (self.index >= self.end_index) {
                        var io: w.IO_STATUS_BLOCK = undefined;
                        if (self.first) {
                            // > Any bytes inserted for alignment SHOULD be set to zero, and the receiver MUST ignore them
                            @memset(&self.buf, 0);
                        }

                        const rc = w.ntdll.NtQueryDirectoryFile(
                            self.dir.fd,
                            null,
                            null,
                            null,
                            &io,
                            &self.buf,
                            self.buf.len,
                            .FileDirectoryInformation,
                            w.FALSE,
                            null,
                            if (self.first) @as(w.BOOLEAN, w.TRUE) else @as(w.BOOLEAN, w.FALSE),
                        );

                        self.first = false;
                        if (io.Information == 0) {
                            bun.sys.syslog("NtQueryDirectoryFile({}) = 0", .{bun.toFD(self.dir.fd)});
                            return .{ .result = null };
                        }
                        self.index = 0;
                        self.end_index = io.Information;
                        // If the handle is not a directory, we'll get STATUS_INVALID_PARAMETER.
                        if (rc == .INVALID_PARAMETER) {
                            bun.sys.syslog("NtQueryDirectoryFile({}) = {s}", .{ bun.toFD(self.dir.fd), @tagName(rc) });
                            return .{
                                .err = .{
                                    .errno = @intFromEnum(bun.C.SystemErrno.ENOTDIR),
                                    .syscall = .NtQueryDirectoryFile,
                                },
                            };
                        }

                        if (rc == .NO_MORE_FILES) {
                            bun.sys.syslog("NtQueryDirectoryFile({}) = {s}", .{ bun.toFD(self.dir.fd), @tagName(rc) });
                            self.end_index = self.index;
                            return .{ .result = null };
                        }

                        if (rc != .SUCCESS) {
                            bun.sys.syslog("NtQueryDirectoryFile({}) = {s}", .{ bun.toFD(self.dir.fd), @tagName(rc) });

                            if ((bun.windows.Win32Error.fromNTStatus(rc).toSystemErrno())) |errno| {
                                return .{
                                    .err = .{
                                        .errno = @intFromEnum(errno),
                                        .syscall = .NtQueryDirectoryFile,
                                    },
                                };
                            }

                            return .{
                                .err = .{
                                    .errno = @intFromEnum(bun.C.SystemErrno.EUNKNOWN),
                                    .syscall = .NtQueryDirectoryFile,
                                },
                            };
                        }

                        bun.sys.syslog("NtQueryDirectoryFile({}) = {d}", .{ bun.toFD(self.dir.fd), self.end_index });
                    }

                    const dir_info: FILE_DIRECTORY_INFORMATION_PTR = @ptrCast(@alignCast(&self.buf[self.index]));
                    if (dir_info.NextEntryOffset != 0) {
                        self.index += dir_info.NextEntryOffset;
                    } else {
                        self.index = self.buf.len;
                    }

                    const dir_info_name = @as([*]const u16, @ptrCast(&dir_info.FileName))[0 .. dir_info.FileNameLength / 2];

                    if (mem.eql(u16, dir_info_name, &[_]u16{'.'}) or mem.eql(u16, dir_info_name, &[_]u16{ '.', '.' }))
                        continue;

                    const kind = blk: {
                        const attrs = dir_info.FileAttributes;
                        const isdir = attrs & w.FILE_ATTRIBUTE_DIRECTORY != 0;
                        const islink = attrs & w.FILE_ATTRIBUTE_REPARSE_POINT != 0;
                        // on windows symlinks can be directories, too. We prioritize the
                        // "sym_link" kind over the "directory" kind
                        // this will coerce into either .file or .directory later
                        // once the symlink is read
                        if (islink) break :blk Entry.Kind.sym_link;
                        if (isdir) break :blk Entry.Kind.directory;
                        break :blk Entry.Kind.file;
                    };

                    if (use_windows_ospath) {
                        const length = dir_info.FileNameLength / 2;
                        @memcpy(self.name_data[0..length], @as([*]u16, @ptrCast(&dir_info.FileName))[0..length]);
                        self.name_data[length] = 0;
                        const name_utf16le = self.name_data[0..length :0];

                        return .{
                            .result = IteratorResultW{
                                .kind = kind,
                                .name = .{ .data = name_utf16le },
                            },
                        };
                    }

                    // Trust that Windows gives us valid UTF-16LE
                    const name_utf8 = strings.fromWPath(self.name_data[0..], dir_info_name);

                    return .{
                        .result = IteratorResult{
                            .name = PathString.init(name_utf8),
                            .kind = kind,
                        },
                    };
                }
            }
        },
        .wasi => struct {
            dir: Dir,
            buf: [8192]u8, // TODO align(@alignOf(os.wasi.dirent_t)),
            cookie: u64,
            index: usize,
            end_index: usize,

            const Self = @This();

            pub const Error = IteratorError;

            fn fd(self: *Self) posix.fd_t {
                return self.dir.fd;
            }

            /// Memory such as file names referenced in this returned entry becomes invalid
            /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
            pub fn next(self: *Self) Result {
                // We intentinally use fd_readdir even when linked with libc,
                // since its implementation is exactly the same as below,
                // and we avoid the code complexity here.
                const w = posix.wasi;
                start_over: while (true) {
                    if (self.index >= self.end_index) {
                        var bufused: usize = undefined;
                        switch (w.fd_readdir(self.fd, &self.buf, self.buf.len, self.cookie, &bufused)) {
                            .SUCCESS => {},
                            .BADF => unreachable, // Dir is invalid or was opened without iteration ability
                            .FAULT => unreachable,
                            .NOTDIR => unreachable,
                            .INVAL => unreachable,
                            .NOTCAPABLE => return error.AccessDenied,
                            else => |err| return posix.unexpectedErrno(err),
                        }
                        if (bufused == 0) return null;
                        self.index = 0;
                        self.end_index = bufused;
                    }
                    const entry = @as(*align(1) w.dirent_t, @ptrCast(&self.buf[self.index]));
                    const entry_size = @sizeOf(w.dirent_t);
                    const name_index = self.index + entry_size;
                    const name = mem.span(self.buf[name_index .. name_index + entry.d_namlen]);

                    const next_index = name_index + entry.d_namlen;
                    self.index = next_index;
                    self.cookie = entry.d_next;

                    // skip . and .. entries
                    if (strings.eqlComptime(name, ".") or strings.eqlComptime(name, "..")) {
                        continue :start_over;
                    }

                    const entry_kind = switch (entry.d_type) {
                        .BLOCK_DEVICE => Entry.Kind.block_device,
                        .CHARACTER_DEVICE => Entry.Kind.character_device,
                        .DIRECTORY => Entry.Kind.directory,
                        .SYMBOLIC_LINK => Entry.Kind.sym_link,
                        .REGULAR_FILE => Entry.Kind.file,
                        .SOCKET_STREAM, .SOCKET_DGRAM => Entry.Kind.unix_domain_socket,
                        else => Entry.Kind.unknown,
                    };
                    return IteratorResult{
                        .name = name,
                        .kind = entry_kind,
                    };
                }
            }
        },
        else => @compileError("unimplemented"),
    };
}

pub const PathType = enum { u8, u16 };

pub fn NewWrappedIterator(comptime path_type: PathType) type {
    const IteratorType = if (path_type == .u16) IteratorW else Iterator;
    const ResultType = if (path_type == .u16) ResultW else Result;
    return struct {
        iter: IteratorType,
        const Self = @This();

        pub inline fn next(self: *Self) ResultType {
            return self.iter.next();
        }

        pub inline fn fd(self: *Self) posix.fd_t {
            return self.iter.fd();
        }

        pub const Error = IteratorError;

        pub fn init(dir: Dir) Self {
            return Self{
                .iter = switch (builtin.os.tag) {
                    .macos,
                    .ios,
                    .freebsd,
                    .netbsd,
                    .dragonfly,
                    .openbsd,
                    .solaris,
                    => IteratorType{
                        .dir = dir,
                        .seek = 0,
                        .index = 0,
                        .end_index = 0,
                        .buf = undefined,
                    },
                    .linux, .haiku => IteratorType{
                        .dir = dir,
                        .index = 0,
                        .end_index = 0,
                        .buf = undefined,
                    },
                    .windows => IteratorType{
                        .dir = dir,
                        .index = 0,
                        .end_index = 0,
                        .first = true,
                        .buf = undefined,
                        .name_data = undefined,
                    },
                    .wasi => IteratorType{
                        .dir = dir,
                        .cookie = posix.wasi.DIRCOOKIE_START,
                        .index = 0,
                        .end_index = 0,
                        .buf = undefined,
                    },
                    else => @compileError("unimplemented"),
                },
            };
        }
    };
}

pub const WrappedIterator = NewWrappedIterator(.u8);
pub const WrappedIteratorW = NewWrappedIterator(.u16);

pub fn iterate(self: Dir, comptime path_type: PathType) NewWrappedIterator(path_type) {
    return NewWrappedIterator(path_type).init(self);
}
