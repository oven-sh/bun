// @link "../deps/libarchive.a"

pub const lib = @import("./libarchive-bindings.zig");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FileDescriptorType = bun.FileDescriptor;
const default_allocator = bun.default_allocator;
const c = bun.c;
const std = @import("std");
const Archive = lib.Archive;
pub const Seek = enum(c_int) {
    set = std.posix.SEEK_SET,
    current = std.posix.SEEK_CUR,
    end = std.posix.SEEK_END,
};

pub const BufferReadStream = struct {
    const Stream = @This();
    buf: []const u8,
    pos: usize = 0,

    block_size: usize = 16384,

    archive: *Archive,
    reading: bool = false,

    pub fn init(this: *BufferReadStream, buf: []const u8) void {
        this.* = BufferReadStream{
            .buf = buf,
            .pos = 0,
            .archive = Archive.readNew(),
            .reading = false,
        };
    }

    pub fn deinit(this: *BufferReadStream) void {
        _ = this.archive.readClose();
        // don't free it if we never actually read it
        // if (this.reading) {
        //     _ = lib.archive_read_free(this.archive);
        // }
    }

    pub fn openRead(this: *BufferReadStream) Archive.Result {
        // lib.archive_read_set_open_callback(this.archive, this.);
        // _ = lib.archive_read_set_read_callback(this.archive, archive_read_callback);
        // _ = lib.archive_read_set_seek_callback(this.archive, archive_seek_callback);
        // _ = lib.archive_read_set_skip_callback(this.archive, archive_skip_callback);
        // _ = lib.archive_read_set_close_callback(this.archive, archive_close_callback);
        // // lib.archive_read_set_switch_callback(this.archive, this.archive_s);
        // _ = lib.archive_read_set_callback_data(this.archive, this);

        _ = this.archive.readSupportFormatTar();
        _ = this.archive.readSupportFormatGnutar();
        _ = this.archive.readSupportFilterGzip();

        // Ignore zeroed blocks in the archive, which occurs when multiple tar archives
        // have been concatenated together.
        // Without this option, only the contents of
        // the first concatenated archive would be read.
        _ = this.archive.readSetOptions("read_concatenated_archives");

        // _ = lib.archive_read_support_filter_none(this.archive);

        const rc = this.archive.readOpenMemory(this.buf);

        this.reading = @intFromEnum(rc) > -1;

        // _ = lib.archive_read_support_compression_all(this.archive);

        return rc;
    }

    pub inline fn bufLeft(this: BufferReadStream) []const u8 {
        return this.buf[this.pos..];
    }

    pub inline fn fromCtx(ctx: *anyopaque) *Stream {
        return @as(*Stream, @ptrCast(@alignCast(ctx)));
    }

    pub fn archive_close_callback(
        _: *Archive,
        _: *anyopaque,
    ) callconv(.C) c_int {
        return 0;
    }

    pub fn archive_read_callback(
        _: *Archive,
        ctx_: *anyopaque,
        buffer: [*c]*const anyopaque,
    ) callconv(.C) lib.la_ssize_t {
        var this = fromCtx(ctx_);
        const remaining = this.bufLeft();
        if (remaining.len == 0) return 0;

        const diff = @min(remaining.len, this.block_size);
        buffer.* = remaining[0..diff].ptr;
        this.pos += diff;
        return @as(isize, @intCast(diff));
    }

    pub fn archive_skip_callback(
        _: *Archive,
        ctx_: *anyopaque,
        offset: lib.la_int64_t,
    ) callconv(.C) lib.la_int64_t {
        var this = fromCtx(ctx_);

        const buflen = @as(isize, @intCast(this.buf.len));
        const pos = @as(isize, @intCast(this.pos));

        const proposed = pos + offset;
        const new_pos = @min(@max(proposed, 0), buflen - 1);
        this.pos = @as(usize, @intCast(this.pos));
        return new_pos - pos;
    }

    pub fn archive_seek_callback(
        _: *Archive,
        ctx_: *anyopaque,
        offset: lib.la_int64_t,
        whence: c_int,
    ) callconv(.C) lib.la_int64_t {
        var this = fromCtx(ctx_);

        const buflen = @as(isize, @intCast(this.buf.len));
        const pos = @as(isize, @intCast(this.pos));

        switch (@as(Seek, @enumFromInt(whence))) {
            Seek.current => {
                const new_pos = @max(@min(pos + offset, buflen - 1), 0);
                this.pos = @as(usize, @intCast(new_pos));
                return new_pos;
            },
            Seek.end => {
                const new_pos = @max(@min(buflen - offset, buflen), 0);
                this.pos = @as(usize, @intCast(new_pos));
                return new_pos;
            },
            Seek.set => {
                const new_pos = @max(@min(offset, buflen - 1), 0);
                this.pos = @as(usize, @intCast(new_pos));
                return new_pos;
            },
        }
    }

    // pub fn archive_write_callback(
    //     archive: *Archive,
    //     ctx_: *anyopaque,
    //     buffer: *const anyopaque,
    //     len: usize,
    // ) callconv(.C) lib.la_ssize_t {
    //     var this = fromCtx(ctx_);
    // }

    // pub fn archive_close_callback(
    //     archive: *Archive,
    //     ctx_: *anyopaque,
    // ) callconv(.C) c_int {
    //     var this = fromCtx(ctx_);
    // }
    // pub fn archive_free_callback(
    //     archive: *Archive,
    //     ctx_: *anyopaque,
    // ) callconv(.C) c_int {
    //     var this = fromCtx(ctx_);
    // }

    // pub fn archive_switch_callback(
    //     archive: *Archive,
    //     ctx1: *anyopaque,
    //     ctx2: *anyopaque,
    // ) callconv(.C) c_int {
    //     var this = fromCtx(ctx1);
    //     var that = fromCtx(ctx2);
    // }
};

pub const Archiver = struct {
    // impl: *lib.archive = undefined,
    // buf: []const u8 = undefined,
    // dir: FileDescriptorType = 0,

    pub const Context = struct {
        pluckers: []Plucker = &[_]Plucker{},
        overwrite_list: bun.StringArrayHashMap(void),
        all_files: EntryMap,
        pub const EntryMap = std.ArrayHashMap(u64, [*c]u8, U64Context, false);

        pub const U64Context = struct {
            pub fn hash(_: @This(), k: u64) u32 {
                return @as(u32, @truncate(k));
            }
            pub fn eql(_: @This(), a: u64, b: u64, _: usize) bool {
                return a == b;
            }
        };
    };

    pub const Plucker = struct {
        contents: MutableString,
        filename_hash: u64 = 0,
        found: bool = false,
        fd: FileDescriptorType,

        pub fn init(filepath: bun.OSPathSlice, estimated_size: usize, allocator: std.mem.Allocator) !Plucker {
            return Plucker{
                .contents = try MutableString.init(allocator, estimated_size),
                .filename_hash = bun.hash(std.mem.sliceAsBytes(filepath)),
                .fd = .invalid,
                .found = false,
            };
        }
    };

    pub fn getOverwritingFileList(
        file_buffer: []const u8,
        root: []const u8,
        ctx: *Archiver.Context,
        comptime FilePathAppender: type,
        appender: FilePathAppender,
        comptime depth_to_skip: usize,
    ) !void {
        var entry: *Archive.Entry = undefined;

        var stream: BufferReadStream = undefined;
        stream.init(file_buffer);
        defer stream.deinit();
        _ = stream.openRead();
        const archive = stream.archive;
        const dir: std.fs.Dir = brk: {
            const cwd = std.fs.cwd();

            // if the destination doesn't exist, we skip the whole thing since nothing can overwrite it.
            if (std.fs.path.isAbsolute(root)) {
                break :brk std.fs.openDirAbsolute(root, .{}) catch return;
            } else {
                break :brk cwd.openDir(root, .{}) catch return;
            }
        };

        loop: while (true) {
            const r = archive.readNextHeader(&entry);

            switch (r) {
                .eof => break :loop,
                .retry => continue :loop,
                .failed, .fatal => return error.Fail,
                else => {
                    // do not use the utf8 name there
                    // it will require us to pull in libiconv
                    // though we should probably validate the utf8 here nonetheless
                    var pathname = entry.pathname();
                    var tokenizer = std.mem.tokenizeScalar(u8, bun.asByteSlice(pathname), std.fs.path.sep);
                    comptime var depth_i: usize = 0;
                    inline while (depth_i < depth_to_skip) : (depth_i += 1) {
                        if (tokenizer.next() == null) continue :loop;
                    }

                    var pathname_ = tokenizer.rest();
                    pathname = std.mem.sliceTo(pathname_.ptr[0..pathname_.len :0], 0);
                    const dirname = std.mem.trim(u8, std.fs.path.dirname(bun.asByteSlice(pathname)) orelse "", std.fs.path.sep_str);

                    const size: usize = @intCast(@max(entry.size(), 0));
                    if (size > 0) {
                        var opened = dir.openFileZ(pathname, .{ .mode = .write_only }) catch continue :loop;
                        defer opened.close();
                        const stat_size = try opened.getEndPos();

                        if (stat_size > 0) {
                            const is_already_top_level = dirname.len == 0;
                            const path_to_use_: string = brk: {
                                const __pathname: string = bun.asByteSlice(pathname);

                                if (is_already_top_level) break :brk __pathname;

                                const index = std.mem.indexOfScalar(u8, __pathname, std.fs.path.sep).?;
                                break :brk __pathname[0..index];
                            };
                            var temp_buf: [1024]u8 = undefined;
                            bun.copy(u8, &temp_buf, path_to_use_);
                            var path_to_use: string = temp_buf[0..path_to_use_.len];
                            if (!is_already_top_level) {
                                temp_buf[path_to_use_.len] = std.fs.path.sep;
                                path_to_use = temp_buf[0 .. path_to_use_.len + 1];
                            }

                            const overwrite_entry = try ctx.overwrite_list.getOrPut(path_to_use);
                            if (!overwrite_entry.found_existing) {
                                overwrite_entry.key_ptr.* = try appender.append(@TypeOf(path_to_use), path_to_use);
                            }
                        }
                    }
                },
            }
        }
    }

    pub const ExtractOptions = struct {
        depth_to_skip: usize,
        close_handles: bool = true,
        log: bool = false,
        npm: bool = false,
    };

    pub fn extractToDir(
        file_buffer: []const u8,
        dir: std.fs.Dir,
        ctx: ?*Archiver.Context,
        comptime ContextType: type,
        appender: ContextType,
        options: ExtractOptions,
    ) !u32 {
        var entry: *Archive.Entry = undefined;

        var stream: BufferReadStream = undefined;
        stream.init(file_buffer);
        defer stream.deinit();
        _ = stream.openRead();
        const archive = stream.archive;
        var count: u32 = 0;
        const dir_fd = dir.fd;

        var normalized_buf: bun.OSPathBuffer = undefined;

        loop: while (true) {
            const r = archive.readNextHeader(&entry);

            switch (r) {
                .eof => break :loop,
                .retry => continue :loop,
                .failed, .fatal => return error.Fail,
                else => {
                    // TODO:
                    // Due to path separator replacement and other copies that happen internally, libarchive changes the
                    // storage type of paths on windows to wide character strings. Using `archive_entry_pathname` or `archive_entry_pathname_utf8`
                    // on an wide character string will return null if there are non-ascii characters.
                    // (this can be seen by installing @fastify/send, which has a path "@fastify\send\test\fixtures\snow ☃")
                    //
                    // Ideally, we find a way to tell libarchive to not convert the strings to wide characters and also to not
                    // replace path separators. We can do both of these with our own normalization and utf8/utf16 string conversion code.
                    var pathname: bun.OSPathSliceZ = if (comptime Environment.isWindows)
                        entry.pathnameW()
                    else
                        entry.pathname();

                    if (comptime ContextType != void and @hasDecl(std.meta.Child(ContextType), "onFirstDirectoryName")) {
                        if (appender.needs_first_dirname) {
                            if (comptime Environment.isWindows) {
                                const list = std.ArrayList(u8).init(default_allocator);
                                var result = try strings.toUTF8ListWithType(list, []const u16, pathname[0..pathname.len]);
                                // onFirstDirectoryName copies the contents of pathname to another buffer, safe to free
                                defer result.deinit();
                                appender.onFirstDirectoryName(strings.withoutTrailingSlash(result.items));
                            } else {
                                appender.onFirstDirectoryName(strings.withoutTrailingSlash(bun.asByteSlice(pathname)));
                            }
                        }
                    }

                    const kind = bun.sys.kindFromMode(entry.filetype());

                    if (options.npm) {
                        // - ignore entries other than files (`true` can only be returned if type is file)
                        //   https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L419-L441
                        if (kind != .file) continue;

                        // TODO: .npmignore, or .gitignore if it doesn't exist
                        // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L434
                    }

                    // strip and normalize the path
                    var tokenizer = std.mem.tokenizeScalar(bun.OSPathChar, pathname, '/');
                    for (0..options.depth_to_skip) |_| {
                        if (tokenizer.next() == null) continue :loop;
                    }

                    const rest = tokenizer.rest();
                    pathname = rest.ptr[0..rest.len :0];

                    const normalized = bun.path.normalizeBufT(bun.OSPathChar, pathname, &normalized_buf, .auto);
                    normalized_buf[normalized.len] = 0;
                    const path: [:0]bun.OSPathChar = normalized_buf[0..normalized.len :0];
                    if (path.len == 0 or path.len == 1 and path[0] == '.') continue;

                    if (options.npm and Environment.isWindows) {
                        // When writing files on Windows, translate the characters to their
                        // 0xf000 higher-encoded versions.
                        // https://github.com/isaacs/node-tar/blob/0510c9ea6d000c40446d56674a7efeec8e72f052/lib/winchars.js
                        var remain = path;
                        if (strings.startsWithWindowsDriveLetterT(bun.OSPathChar, remain)) {
                            // don't encode `:` from the drive letter
                            // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/tar/lib/unpack.js#L327
                            remain = remain[2..];
                        }

                        for (remain) |*char| {
                            switch (char.*) {
                                '|', '<', '>', '?', ':' => char.* += 0xf000,
                                else => {},
                            }
                        }
                    }

                    const path_slice: bun.OSPathSlice = path.ptr[0..path.len];

                    if (options.log) {
                        Output.prettyln(" {}", .{bun.fmt.fmtOSPath(path_slice, .{})});
                    }

                    count += 1;

                    switch (kind) {
                        .directory => {
                            var mode = @as(i32, @intCast(entry.perm()));

                            // if dirs are readable, then they should be listable
                            // https://github.com/npm/node-tar/blob/main/lib/mode-fix.js
                            if ((mode & 0o400) != 0)
                                mode |= 0o100;
                            if ((mode & 0o40) != 0)
                                mode |= 0o10;
                            if ((mode & 0o4) != 0)
                                mode |= 0o1;

                            if (comptime Environment.isWindows) {
                                try bun.MakePath.makePath(u16, dir, path);
                            } else {
                                std.posix.mkdiratZ(dir_fd, pathname, @intCast(mode)) catch |err| {
                                    // It's possible for some tarballs to return a directory twice, with and
                                    // without `./` in the beginning. So if it already exists, continue to the
                                    // next entry.
                                    if (err == error.PathAlreadyExists or err == error.NotDir) continue;
                                    bun.makePath(dir, std.fs.path.dirname(path_slice) orelse return err) catch {};
                                    std.posix.mkdiratZ(dir_fd, pathname, 0o777) catch {};
                                };
                            }
                        },
                        .sym_link => {
                            const link_target = entry.symlink();
                            if (Environment.isPosix) {
                                bun.sys.symlinkat(link_target, .fromNative(dir_fd), path).unwrap() catch |err| brk: {
                                    switch (err) {
                                        error.EPERM, error.ENOENT => {
                                            dir.makePath(std.fs.path.dirname(path_slice) orelse return err) catch {};
                                            break :brk try bun.sys.symlinkat(link_target, .fromNative(dir_fd), path).unwrap();
                                        },
                                        else => return err,
                                    }
                                };
                            }
                        },
                        .file => {
                            // first https://github.com/npm/cli/blob/feb54f7e9a39bd52519221bae4fafc8bc70f235e/node_modules/pacote/lib/fetcher.js#L65-L66
                            // this.fmode = opts.fmode || 0o666
                            //
                            // then https://github.com/npm/cli/blob/feb54f7e9a39bd52519221bae4fafc8bc70f235e/node_modules/pacote/lib/fetcher.js#L402-L411
                            //
                            // we simplify and turn it into `entry.mode || 0o666` because we aren't accepting a umask or fmask option.
                            const mode: bun.Mode = if (comptime Environment.isWindows) 0 else @intCast(entry.perm() | 0o666);

                            const flags = bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC;
                            const file_handle_native: bun.FD = if (Environment.isWindows)
                                switch (bun.sys.openatWindows(.fromNative(dir_fd), path, flags, 0)) {
                                    .result => |fd| fd,
                                    .err => |e| switch (e.errno) {
                                        @intFromEnum(bun.sys.E.PERM),
                                        @intFromEnum(bun.sys.E.NOENT),
                                        => brk: {
                                            bun.MakePath.makePath(u16, dir, bun.Dirname.dirname(u16, path_slice) orelse return bun.errnoToZigErr(e.errno)) catch {};
                                            break :brk try bun.sys.openatWindows(.fromNative(dir_fd), path, flags, 0).unwrap();
                                        },
                                        else => return bun.errnoToZigErr(e.errno),
                                    },
                                }
                            else
                                .fromStdFile(dir.createFileZ(path, .{
                                    .truncate = true,
                                    .mode = mode,
                                }) catch |err|
                                    switch (err) {
                                        error.AccessDenied, error.FileNotFound => brk: {
                                            dir.makePath(std.fs.path.dirname(path_slice) orelse return err) catch {};
                                            break :brk try dir.createFileZ(path, .{
                                                .truncate = true,
                                                .mode = mode,
                                            });
                                        },
                                        else => return err,
                                    });

                            const file_handle = brk: {
                                errdefer _ = file_handle_native.close();
                                break :brk try file_handle_native.makeLibUVOwned();
                            };

                            var plucked_file = false;
                            defer if (options.close_handles and !plucked_file) {
                                // On windows, AV hangs these closes really badly.
                                // 'bun i @mui/icons-material' takes like 20 seconds to extract
                                // mostly spend on waiting for things to close closing
                                //
                                // Using Async.Closer defers closing the file to a different thread,
                                // which can make the NtSetInformationFile call fail.
                                //
                                // Using async closing doesnt actually improve end user performance
                                // probably because our process is still waiting on AV to do it's thing.
                                //
                                // But this approach does not actually solve the problem, it just
                                // defers the close to a different thread. And since we are already
                                // on a worker thread, that doesn't help us.
                                file_handle.close();
                            };

                            const size: usize = @intCast(@max(entry.size(), 0));
                            if (size > 0) {
                                if (ctx) |ctx_| {
                                    const hash: u64 = if (ctx_.pluckers.len > 0)
                                        bun.hash(std.mem.sliceAsBytes(path_slice))
                                    else
                                        @as(u64, 0);

                                    if (comptime ContextType != void and @hasDecl(std.meta.Child(ContextType), "appendMutable")) {
                                        const result = ctx.?.all_files.getOrPutAdapted(hash, Context.U64Context{}) catch unreachable;
                                        if (!result.found_existing) {
                                            result.value_ptr.* = (try appender.appendMutable(@TypeOf(path_slice), path_slice)).ptr;
                                        }
                                    }

                                    for (ctx_.pluckers) |*plucker_| {
                                        if (plucker_.filename_hash == hash) {
                                            try plucker_.contents.inflate(size);
                                            plucker_.contents.list.expandToCapacity();
                                            const read = archive.readData(plucker_.contents.list.items);
                                            try plucker_.contents.inflate(@as(usize, @intCast(read)));
                                            plucker_.found = read > 0;
                                            plucker_.fd = file_handle;
                                            plucked_file = true;
                                            continue :loop;
                                        }
                                    }
                                }
                                // archive_read_data_into_fd reads in chunks of 1 MB
                                // #define    MAX_WRITE    (1024 * 1024)
                                if (comptime Environment.isLinux) {
                                    if (size > 1_000_000) {
                                        bun.sys.preallocate_file(
                                            file_handle.cast(),
                                            0,
                                            @intCast(size),
                                        ) catch {};
                                    }
                                }

                                var retries_remaining: u8 = 5;
                                possibly_retry: while (retries_remaining != 0) : (retries_remaining -= 1) {
                                    switch (archive.readDataIntoFd(file_handle.uv())) {
                                        .eof => break :loop,
                                        .ok => break :possibly_retry,
                                        .retry => {
                                            if (options.log) {
                                                Output.err("libarchive error", "extracting {}, retry {d} / {d}", .{
                                                    bun.fmt.fmtOSPath(path_slice, .{}),
                                                    retries_remaining,
                                                    5,
                                                });
                                            }
                                        },
                                        else => {
                                            if (options.log) {
                                                const archive_error = bun.sliceTo(lib.Archive.errorString(@ptrCast(archive)), 0);
                                                Output.err("libarchive error", "extracting {}: {s}", .{
                                                    bun.fmt.fmtOSPath(path_slice, .{}),
                                                    archive_error,
                                                });
                                            }
                                            return error.Fail;
                                        },
                                    }
                                }
                            }
                        },
                        else => {},
                    }
                },
            }
        }

        return count;
    }

    pub fn extractToDisk(
        file_buffer: []const u8,
        root: []const u8,
        ctx: ?*Archiver.Context,
        comptime FilePathAppender: type,
        appender: FilePathAppender,
        comptime options: ExtractOptions,
    ) !u32 {
        var dir: std.fs.Dir = brk: {
            const cwd = std.fs.cwd();
            cwd.makePath(
                root,
            ) catch {};

            if (std.fs.path.isAbsolute(root)) {
                break :brk try std.fs.openDirAbsolute(root, .{});
            } else {
                break :brk try cwd.openDir(root, .{});
            }
        };

        defer if (comptime options.close_handles) dir.close();
        return try extractToDir(file_buffer, dir, ctx, FilePathAppender, appender, options);
    }
};
