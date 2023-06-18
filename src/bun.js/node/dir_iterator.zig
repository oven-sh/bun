// This is copied from std.fs.IterableDir.Iterator
// The differences are:
// - it returns errors in the expected format
// - doesn't mark BADF as unreachable
// - It uses PathString instead of []const u8

const builtin = @import("builtin");
const std = @import("std");
const os = std.os;

const Dir = std.fs.Dir;
const JSC = @import("root").bun.JSC;
const PathString = JSC.PathString;

const IteratorError = error{ AccessDenied, SystemResources } || os.UnexpectedError;
const mem = std.mem;
const strings = @import("root").bun.strings;
const Maybe = JSC.Maybe;
const File = std.fs.File;
const IteratorResult = struct {
    name: PathString,
    kind: Entry.Kind,
};

const Result = Maybe(?IteratorResult);

const Entry = JSC.Node.Dirent;

pub const Iterator = switch (builtin.os.tag) {
    .macos, .ios, .freebsd, .netbsd, .dragonfly, .openbsd, .solaris => struct {
        dir: Dir,
        seek: i64,
        buf: [8192]u8, // TODO align(@alignOf(os.system.dirent)),
        index: usize,
        end_index: usize,

        const Self = @This();

        pub const Error = IteratorError;

        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        const next = switch (builtin.os.tag) {
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
                    self.end_index = @intCast(usize, rc);
                }
                const darwin_entry = @ptrCast(*align(1) os.system.dirent, &self.buf[self.index]);
                const next_index = self.index + darwin_entry.reclen();
                self.index = next_index;

                const name = @ptrCast([*]u8, &darwin_entry.d_name)[0..darwin_entry.d_namlen];

                if (strings.eqlComptime(name, ".") or strings.eqlComptime(name, "..") or (darwin_entry.d_ino == 0)) {
                    continue :start_over;
                }

                const entry_kind = switch (darwin_entry.d_type) {
                    os.DT.BLK => Entry.Kind.BlockDevice,
                    os.DT.CHR => Entry.Kind.CharacterDevice,
                    os.DT.DIR => Entry.Kind.Directory,
                    os.DT.FIFO => Entry.Kind.NamedPipe,
                    os.DT.LNK => Entry.Kind.SymLink,
                    os.DT.REG => Entry.Kind.File,
                    os.DT.SOCK => Entry.Kind.UnixDomainSocket,
                    os.DT.WHT => Entry.Kind.Whiteout,
                    else => Entry.Kind.Unknown,
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
                const linux_entry = @ptrCast(*align(1) linux.dirent64, &self.buf[self.index]);
                const next_index = self.index + linux_entry.reclen();
                self.index = next_index;

                const name = mem.sliceTo(@ptrCast([*:0]u8, &linux_entry.d_name), 0);

                // skip . and .. entries
                if (strings.eqlComptime(name, ".") or strings.eqlComptime(name, "..")) {
                    continue :start_over;
                }

                const entry_kind = switch (linux_entry.d_type) {
                    linux.DT.BLK => Entry.Kind.BlockDevice,
                    linux.DT.CHR => Entry.Kind.CharacterDevice,
                    linux.DT.DIR => Entry.Kind.Directory,
                    linux.DT.FIFO => Entry.Kind.NamedPipe,
                    linux.DT.LNK => Entry.Kind.SymLink,
                    linux.DT.REG => Entry.Kind.File,
                    linux.DT.SOCK => Entry.Kind.UnixDomainSocket,
                    else => Entry.Kind.Unknown,
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
        buf: [8192]u8 align(@alignOf(os.windows.FILE_BOTH_DIR_INFORMATION)),
        index: usize,
        end_index: usize,
        first: bool,
        name_data: [256]u8,

        const Self = @This();

        pub const Error = IteratorError;

        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub fn next(self: *Self) Result {
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
                        .FileBothDirectoryInformation,
                        w.FALSE,
                        null,
                        if (self.first) @as(w.BOOLEAN, w.TRUE) else @as(w.BOOLEAN, w.FALSE),
                    );
                    self.first = false;
                    if (io.Information == 0) return .{ .result = null };
                    self.index = 0;
                    self.end_index = io.Information;
                    switch (rc) {
                        .SUCCESS => {},
                        .ACCESS_DENIED => return error.AccessDenied, // Double-check that the Dir was opened with iteration ability

                        else => return w.unexpectedStatus(rc),
                    }
                }

                const aligned_ptr = @alignCast(@alignOf(w.FILE_BOTH_DIR_INFORMATION), &self.buf[self.index]);
                const dir_info = @ptrCast(*w.FILE_BOTH_DIR_INFORMATION, aligned_ptr);
                if (dir_info.NextEntryOffset != 0) {
                    self.index += dir_info.NextEntryOffset;
                } else {
                    self.index = self.buf.len;
                }

                const name_utf16le = @ptrCast([*]u16, &dir_info.FileName)[0 .. dir_info.FileNameLength / 2];

                if (mem.eql(u16, name_utf16le, &[_]u16{'.'}) or mem.eql(u16, name_utf16le, &[_]u16{ '.', '.' }))
                    continue;
                // Trust that Windows gives us valid UTF-16LE
                const name_utf8_len = std.unicode.utf16leToUtf8(self.name_data[0..], name_utf16le) catch unreachable;
                const name_utf8 = self.name_data[0..name_utf8_len];
                const kind = blk: {
                    const attrs = dir_info.FileAttributes;
                    if (attrs & w.FILE_ATTRIBUTE_DIRECTORY != 0) break :blk Entry.Kind.Directory;
                    if (attrs & w.FILE_ATTRIBUTE_REPARSE_POINT != 0) break :blk Entry.Kind.SymLink;
                    break :blk Entry.Kind.File;
                };
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
                    switch (w.fd_readdir(self.dir.fd, &self.buf, self.buf.len, self.cookie, &bufused)) {
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
                const entry = @ptrCast(*align(1) w.dirent_t, &self.buf[self.index]);
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
                    .BLOCK_DEVICE => Entry.Kind.BlockDevice,
                    .CHARACTER_DEVICE => Entry.Kind.CharacterDevice,
                    .DIRECTORY => Entry.Kind.Directory,
                    .SYMBOLIC_LINK => Entry.Kind.SymLink,
                    .REGULAR_FILE => Entry.Kind.File,
                    .SOCKET_STREAM, .SOCKET_DGRAM => Entry.Kind.UnixDomainSocket,
                    else => Entry.Kind.Unknown,
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

const WrappedIterator = struct {
    iter: Iterator,
    const Self = @This();

    pub const Error = IteratorError;

    pub inline fn next(self: *Self) Result {
        return self.iter.next();
    }
};

pub fn iterate(self: Dir) WrappedIterator {
    return WrappedIterator{
        .iter = _iterate(self),
    };
}

fn _iterate(self: Dir) Iterator {
    switch (builtin.os.tag) {
        .macos,
        .ios,
        .freebsd,
        .netbsd,
        .dragonfly,
        .openbsd,
        .solaris,
        => return Iterator{
            .dir = self,
            .seek = 0,
            .index = 0,
            .end_index = 0,
            .buf = undefined,
        },
        .linux, .haiku => return Iterator{
            .dir = self,
            .index = 0,
            .end_index = 0,
            .buf = undefined,
        },
        .windows => return Iterator{
            .dir = self,
            .index = 0,
            .end_index = 0,
            .first = true,
            .buf = undefined,
            .name_data = undefined,
        },
        .wasi => return Iterator{
            .dir = self,
            .cookie = os.wasi.DIRCOOKIE_START,
            .index = 0,
            .end_index = 0,
            .buf = undefined,
        },
        else => @compileError("unimplemented"),
    }
}
