// This is copied from std.fs.Dir.Iterator
// The differences are:
// - it returns errors in the expected format
// - doesn't mark BADF as unreachable
// - It uses PathString instead of []const u8
// - Windows can be configured to return []const u16

const builtin = @import("builtin");
const std = @import("std");
const os = std.os;

const Dir = std.fs.Dir;
const JSC = @import("root").bun.JSC;
const PathString = JSC.PathString;
const bun = @import("root").bun;

const IteratorError = error{ AccessDenied, SystemResources } || os.UnexpectedError;
const mem = std.mem;
const strings = @import("root").bun.strings;
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

            const Self = @This();

            pub const Error = IteratorError;

            fn fd(self: *Self) os.fd_t {
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
                        const rc = os.system.__getdirentries64(
                            self.dir.fd,
                            &self.buf,
                            self.buf.len,
                            &self.seek,
                        );

                        if (rc < 1) {
                            if (rc == 0) return Result{ .result = null };
                            if (Result.errnoSys(rc, .getdirentries64)) |err| {
                                return err;
                            }
                        }

                        self.index = 0;
                        self.end_index = @as(usize, @intCast(rc));
                    }
                    const darwin_entry = @as(*align(1) os.system.dirent, @ptrCast(&self.buf[self.index]));
                    const next_index = self.index + darwin_entry.reclen();
                    self.index = next_index;

                    const name = @as([*]u8, @ptrCast(&darwin_entry.d_name))[0..darwin_entry.d_namlen];

                    if (strings.eqlComptime(name, ".") or strings.eqlComptime(name, "..") or (darwin_entry.d_ino == 0)) {
                        continue :start_over;
                    }

                    const entry_kind = switch (darwin_entry.d_type) {
                        os.DT.BLK => Entry.Kind.block_device,
                        os.DT.CHR => Entry.Kind.character_device,
                        os.DT.DIR => Entry.Kind.directory,
                        os.DT.FIFO => Entry.Kind.named_pipe,
                        os.DT.LNK => Entry.Kind.sym_link,
                        os.DT.REG => Entry.Kind.file,
                        os.DT.SOCK => Entry.Kind.unix_domain_socket,
                        os.DT.WHT => Entry.Kind.whiteout,
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
            const linux = os.linux;

            pub const Error = IteratorError;

            fn fd(self: *Self) os.fd_t {
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
                    const next_index = self.index + linux_entry.reclen();
                    self.index = next_index;

                    const name = mem.sliceTo(@as([*:0]u8, @ptrCast(&linux_entry.d_name)), 0);

                    // skip . and .. entries
                    if (strings.eqlComptime(name, ".") or strings.eqlComptime(name, "..")) {
                        continue :start_over;
                    }

                    const entry_kind = switch (linux_entry.d_type) {
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
            dir: Dir,
            buf: [8192]u8 align(@alignOf(os.windows.FILE_DIRECTORY_INFORMATION)),
            index: usize,
            end_index: usize,
            first: bool,
            name_data: if (use_windows_ospath) [257]u16 else [513]u8,

            const Self = @This();

            pub const Error = IteratorError;

            const ResultT = if (use_windows_ospath) ResultW else Result;

            fn fd(self: *Self) os.fd_t {
                return self.dir.fd;
            }

            /// Memory such as file names referenced in this returned entry becomes invalid
            /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
            pub fn next(self: *Self) ResultT {
                while (true) {
                    const w = os.windows;
                    if (self.index >= self.end_index) {
                        var io: w.IO_STATUS_BLOCK = undefined;

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
                            bun.sys.syslog("NtQueryDirectoryFile({d}) = 0", .{
                                @intFromPtr(self.dir.fd),
                            });
                            return .{ .result = null };
                        }
                        self.index = 0;
                        self.end_index = io.Information;
                        // If the handle is not a directory, we'll get STATUS_INVALID_PARAMETER.
                        if (rc == .INVALID_PARAMETER) {
                            bun.sys.syslog("NtQueryDirectoryFile({d}) = {s}", .{ @intFromPtr(self.dir.fd), @tagName(rc) });
                            return .{
                                .err = .{
                                    .errno = @intFromEnum(bun.C.SystemErrno.ENOTDIR),
                                    .syscall = .NtQueryDirectoryFile,
                                },
                            };
                        }

                        if (rc == .NO_MORE_FILES) {
                            bun.sys.syslog("NtQueryDirectoryFile({d}) = {s}", .{ @intFromPtr(self.dir.fd), @tagName(rc) });
                            self.end_index = self.index;
                            return .{ .result = null };
                        }

                        if (rc != .SUCCESS) {
                            bun.sys.syslog("NtQueryDirectoryFile({d}) = {s}", .{ @intFromPtr(self.dir.fd), @tagName(rc) });

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

                        bun.sys.syslog("NtQueryDirectoryFile({d}) = {d}", .{ @intFromPtr(self.dir.fd), self.end_index });
                    }

                    const dir_info: *w.FILE_DIRECTORY_INFORMATION = @ptrCast(@alignCast(&self.buf[self.index]));
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
                        if (attrs & w.FILE_ATTRIBUTE_DIRECTORY != 0) break :blk Entry.Kind.directory;
                        if (attrs & w.FILE_ATTRIBUTE_REPARSE_POINT != 0) break :blk Entry.Kind.sym_link;
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

            fn fd(self: *Self) os.fd_t {
                return self.dir.fd;
            }

            /// Memory such as file names referenced in this returned entry becomes invalid
            /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
            pub fn next(self: *Self) Result {
                // We intentinally use fd_readdir even when linked with libc,
                // since its implementation is exactly the same as below,
                // and we avoid the code complexity here.
                const w = os.wasi;
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
                            else => |err| return os.unexpectedErrno(err),
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

const PathType = enum { u8, u16 };

pub fn NewWrappedIterator(comptime path_type: PathType) type {
    const IteratorType = if (path_type == .u16) IteratorW else Iterator;
    const ResultType = if (path_type == .u16) ResultW else Result;
    return struct {
        iter: IteratorType,
        const Self = @This();

        pub inline fn next(self: *Self) ResultType {
            return self.iter.next();
        }

        pub inline fn fd(self: *Self) os.fd_t {
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
                        .cookie = os.wasi.DIRCOOKIE_START,
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
