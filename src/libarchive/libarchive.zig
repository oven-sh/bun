// @link "../deps/libarchive.a"

const lib = @import("./libarchive-bindings.zig");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FileDescriptorType = bun.FileDescriptor;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const struct_archive = lib.struct_archive;
const JSC = @import("bun").JSC;
pub const Seek = enum(c_int) {
    set = std.os.SEEK_SET,
    current = std.os.SEEK_CUR,
    end = std.os.SEEK_END,
};

pub const Flags = struct {
    pub const Extract = enum(c_int) {
        owner = lib.ARCHIVE_EXTRACT_OWNER,
        perm = lib.ARCHIVE_EXTRACT_PERM,
        time = lib.ARCHIVE_EXTRACT_TIME,
        no_overwrite = lib.ARCHIVE_EXTRACT_NO_OVERWRITE,
        unlink = lib.ARCHIVE_EXTRACT_UNLINK,
        acl = lib.ARCHIVE_EXTRACT_ACL,
        fflags = lib.ARCHIVE_EXTRACT_FFLAGS,
        xattr = lib.ARCHIVE_EXTRACT_XATTR,
        secure_symlinks = lib.ARCHIVE_EXTRACT_SECURE_SYMLINKS,
        secure_nodotdot = lib.ARCHIVE_EXTRACT_SECURE_NODOTDOT,
        no_autodir = lib.ARCHIVE_EXTRACT_NO_AUTODIR,
        no_overwrite_newer = lib.ARCHIVE_EXTRACT_NO_OVERWRITE_NEWER,
        sparse = lib.ARCHIVE_EXTRACT_SPARSE,
        mac_metadata = lib.ARCHIVE_EXTRACT_MAC_METADATA,
        no_hfs_compression = lib.ARCHIVE_EXTRACT_NO_HFS_COMPRESSION,
        hfs_compression_forced = lib.ARCHIVE_EXTRACT_HFS_COMPRESSION_FORCED,
        secure_noabsolutepaths = lib.ARCHIVE_EXTRACT_SECURE_NOABSOLUTEPATHS,
        clear_nochange_fflags = lib.ARCHIVE_EXTRACT_CLEAR_NOCHANGE_FFLAGS,
        safe_writes = lib.ARCHIVE_EXTRACT_SAFE_WRITES,
    };

    pub const Compression = enum(c_int) {
        none = lib.ARCHIVE_COMPRESSION_NONE,
        gzip = lib.ARCHIVE_COMPRESSION_GZIP,
        bzip2 = lib.ARCHIVE_COMPRESSION_BZIP2,
        compress = lib.ARCHIVE_COMPRESSION_COMPRESS,
        program = lib.ARCHIVE_COMPRESSION_PROGRAM,
        lzma = lib.ARCHIVE_COMPRESSION_LZMA,
        xz = lib.ARCHIVE_COMPRESSION_XZ,
        uu = lib.ARCHIVE_COMPRESSION_UU,
        rpm = lib.ARCHIVE_COMPRESSION_RPM,
        lzip = lib.ARCHIVE_COMPRESSION_LZIP,
        lrzip = lib.ARCHIVE_COMPRESSION_LRZIP,
    };

    pub const Format = enum(c_int) {
        base_mask = lib.ARCHIVE_FORMAT_BASE_MASK,
        cpio = lib.ARCHIVE_FORMAT_CPIO,
        cpio_posix = lib.ARCHIVE_FORMAT_CPIO_POSIX,
        cpio_bin_le = lib.ARCHIVE_FORMAT_CPIO_BIN_LE,
        cpio_bin_be = lib.ARCHIVE_FORMAT_CPIO_BIN_BE,
        cpio_svr4_nocrc = lib.ARCHIVE_FORMAT_CPIO_SVR4_NOCRC,
        cpio_svr4_crc = lib.ARCHIVE_FORMAT_CPIO_SVR4_CRC,
        cpio_afio_large = lib.ARCHIVE_FORMAT_CPIO_AFIO_LARGE,
        cpio_pwb = lib.ARCHIVE_FORMAT_CPIO_PWB,
        shar = lib.ARCHIVE_FORMAT_SHAR,
        shar_base = lib.ARCHIVE_FORMAT_SHAR_BASE,
        shar_dump = lib.ARCHIVE_FORMAT_SHAR_DUMP,
        tar = lib.ARCHIVE_FORMAT_TAR,
        tar_ustar = lib.ARCHIVE_FORMAT_TAR_USTAR,
        tar_pax_interchange = lib.ARCHIVE_FORMAT_TAR_PAX_INTERCHANGE,
        tar_pax_restricted = lib.ARCHIVE_FORMAT_TAR_PAX_RESTRICTED,
        tar_gnutar = lib.ARCHIVE_FORMAT_TAR_GNUTAR,
        iso9660 = lib.ARCHIVE_FORMAT_ISO9660,
        iso9660_rockridge = lib.ARCHIVE_FORMAT_ISO9660_ROCKRIDGE,
        zip = lib.ARCHIVE_FORMAT_ZIP,
        empty = lib.ARCHIVE_FORMAT_EMPTY,
        ar = lib.ARCHIVE_FORMAT_AR,
        ar_gnu = lib.ARCHIVE_FORMAT_AR_GNU,
        ar_bsd = lib.ARCHIVE_FORMAT_AR_BSD,
        mtree = lib.ARCHIVE_FORMAT_MTREE,
        raw = lib.ARCHIVE_FORMAT_RAW,
        xar = lib.ARCHIVE_FORMAT_XAR,
        lha = lib.ARCHIVE_FORMAT_LHA,
        cab = lib.ARCHIVE_FORMAT_CAB,
        rar = lib.ARCHIVE_FORMAT_RAR,
        @"7zip" = lib.ARCHIVE_FORMAT_7ZIP,
        warc = lib.ARCHIVE_FORMAT_WARC,
        rar_v5 = lib.ARCHIVE_FORMAT_RAR_V5,
    };

    pub const Filter = enum(c_int) {
        none = lib.ARCHIVE_FILTER_NONE,
        gzip = lib.ARCHIVE_FILTER_GZIP,
        bzip2 = lib.ARCHIVE_FILTER_BZIP2,
        compress = lib.ARCHIVE_FILTER_COMPRESS,
        program = lib.ARCHIVE_FILTER_PROGRAM,
        lzma = lib.ARCHIVE_FILTER_LZMA,
        xz = lib.ARCHIVE_FILTER_XZ,
        uu = lib.ARCHIVE_FILTER_UU,
        rpm = lib.ARCHIVE_FILTER_RPM,
        lzip = lib.ARCHIVE_FILTER_LZIP,
        lrzip = lib.ARCHIVE_FILTER_LRZIP,
        lzop = lib.ARCHIVE_FILTER_LZOP,
        grzip = lib.ARCHIVE_FILTER_GRZIP,
        lz4 = lib.ARCHIVE_FILTER_LZ4,
        zstd = lib.ARCHIVE_FILTER_ZSTD,
    };

    pub const EntryDigest = enum(c_int) {
        md5 = lib.ARCHIVE_ENTRY_DIGEST_MD5,
        rmd160 = lib.ARCHIVE_ENTRY_DIGEST_RMD160,
        sha1 = lib.ARCHIVE_ENTRY_DIGEST_SHA1,
        sha256 = lib.ARCHIVE_ENTRY_DIGEST_SHA256,
        sha384 = lib.ARCHIVE_ENTRY_DIGEST_SHA384,
        sha512 = lib.ARCHIVE_ENTRY_DIGEST_SHA512,
    };

    pub const EntryACL = enum(c_int) {
        entry_acl_execute = lib.ARCHIVE_ENTRY_ACL_EXECUTE,
        write = lib.ARCHIVE_ENTRY_ACL_WRITE,
        read = lib.ARCHIVE_ENTRY_ACL_READ,
        read_data = lib.ARCHIVE_ENTRY_ACL_READ_DATA,
        list_directory = lib.ARCHIVE_ENTRY_ACL_LIST_DIRECTORY,
        write_data = lib.ARCHIVE_ENTRY_ACL_WRITE_DATA,
        add_file = lib.ARCHIVE_ENTRY_ACL_ADD_FILE,
        append_data = lib.ARCHIVE_ENTRY_ACL_APPEND_DATA,
        add_subdirectory = lib.ARCHIVE_ENTRY_ACL_ADD_SUBDIRECTORY,
        read_named_attrs = lib.ARCHIVE_ENTRY_ACL_READ_NAMED_ATTRS,
        write_named_attrs = lib.ARCHIVE_ENTRY_ACL_WRITE_NAMED_ATTRS,
        delete_child = lib.ARCHIVE_ENTRY_ACL_DELETE_CHILD,
        read_attributes = lib.ARCHIVE_ENTRY_ACL_READ_ATTRIBUTES,
        write_attributes = lib.ARCHIVE_ENTRY_ACL_WRITE_ATTRIBUTES,
        delete = lib.ARCHIVE_ENTRY_ACL_DELETE,
        read_acl = lib.ARCHIVE_ENTRY_ACL_READ_ACL,
        write_acl = lib.ARCHIVE_ENTRY_ACL_WRITE_ACL,
        write_owner = lib.ARCHIVE_ENTRY_ACL_WRITE_OWNER,
        synchronize = lib.ARCHIVE_ENTRY_ACL_SYNCHRONIZE,
        perms_posix1_e = lib.ARCHIVE_ENTRY_ACL_PERMS_POSIX1E,
        perms_nfs4 = lib.ARCHIVE_ENTRY_ACL_PERMS_NFS4,
        entry_inherited = lib.ARCHIVE_ENTRY_ACL_ENTRY_INHERITED,
        entry_file_inherit = lib.ARCHIVE_ENTRY_ACL_ENTRY_FILE_INHERIT,
        entry_directory_inherit = lib.ARCHIVE_ENTRY_ACL_ENTRY_DIRECTORY_INHERIT,
        entry_no_propagate_inherit = lib.ARCHIVE_ENTRY_ACL_ENTRY_NO_PROPAGATE_INHERIT,
        entry_inherit_only = lib.ARCHIVE_ENTRY_ACL_ENTRY_INHERIT_ONLY,
        entry_successful_access = lib.ARCHIVE_ENTRY_ACL_ENTRY_SUCCESSFUL_ACCESS,
        entry_failed_access = lib.ARCHIVE_ENTRY_ACL_ENTRY_FAILED_ACCESS,
        inheritance_nfs4 = lib.ARCHIVE_ENTRY_ACL_INHERITANCE_NFS4,
        type_access = lib.ARCHIVE_ENTRY_ACL_TYPE_ACCESS,
        type_default = lib.ARCHIVE_ENTRY_ACL_TYPE_DEFAULT,
        type_allow = lib.ARCHIVE_ENTRY_ACL_TYPE_ALLOW,
        type_deny = lib.ARCHIVE_ENTRY_ACL_TYPE_DENY,
        type_audit = lib.ARCHIVE_ENTRY_ACL_TYPE_AUDIT,
        type_alarm = lib.ARCHIVE_ENTRY_ACL_TYPE_ALARM,
        type_posix1_e = lib.ARCHIVE_ENTRY_ACL_TYPE_POSIX1E,
        type_nfs4 = lib.ARCHIVE_ENTRY_ACL_TYPE_NFS4,
        user = lib.ARCHIVE_ENTRY_ACL_USER,
        user_obj = lib.ARCHIVE_ENTRY_ACL_USER_OBJ,
        group = lib.ARCHIVE_ENTRY_ACL_GROUP,
        group_obj = lib.ARCHIVE_ENTRY_ACL_GROUP_OBJ,
        mask = lib.ARCHIVE_ENTRY_ACL_MASK,
        other = lib.ARCHIVE_ENTRY_ACL_OTHER,
        everyone = lib.ARCHIVE_ENTRY_ACL_EVERYONE,
        style_extra_id = lib.ARCHIVE_ENTRY_ACL_STYLE_EXTRA_ID,
        style_mark_default = lib.ARCHIVE_ENTRY_ACL_STYLE_MARK_DEFAULT,
        style_solaris = lib.ARCHIVE_ENTRY_ACL_STYLE_SOLARIS,
        style_separator_comma = lib.ARCHIVE_ENTRY_ACL_STYLE_SEPARATOR_COMMA,
        style_compact = lib.ARCHIVE_ENTRY_ACL_STYLE_COMPACT,
    };
};

pub const Status = enum(c_int) {
    eof = lib.ARCHIVE_EOF,
    ok = lib.ARCHIVE_OK,
    retry = lib.ARCHIVE_RETRY,
    warn = lib.ARCHIVE_WARN,
    failed = lib.ARCHIVE_FAILED,
    fatal = lib.ARCHIVE_FATAL,
};

pub const BufferReadStream = struct {
    const Stream = @This();
    buf: []const u8,
    pos: usize = 0,

    block_size: usize = 16384,

    archive: *struct_archive,
    reading: bool = false,

    pub fn init(this: *BufferReadStream, buf: []const u8) void {
        this.* = BufferReadStream{
            .buf = buf,
            .pos = 0,
            .archive = lib.archive_read_new(),
            .reading = false,
        };
    }

    pub fn deinit(this: *BufferReadStream) void {
        _ = lib.archive_read_close(this.archive);
        // don't free it if we never actually read it
        // if (this.reading) {
        //     _ = lib.archive_read_free(this.archive);
        // }
    }

    pub fn openRead(this: *BufferReadStream) c_int {
        // lib.archive_read_set_open_callback(this.archive, this.);
        // _ = lib.archive_read_set_read_callback(this.archive, archive_read_callback);
        // _ = lib.archive_read_set_seek_callback(this.archive, archive_seek_callback);
        // _ = lib.archive_read_set_skip_callback(this.archive, archive_skip_callback);
        // _ = lib.archive_read_set_close_callback(this.archive, archive_close_callback);
        // // lib.archive_read_set_switch_callback(this.archive, this.archive_s);
        // _ = lib.archive_read_set_callback_data(this.archive, this);

        _ = lib.archive_read_support_format_tar(this.archive);
        _ = lib.archive_read_support_format_gnutar(this.archive);
        _ = lib.archive_read_support_compression_gzip(this.archive);

        // Ignore zeroed blocks in the archive, which occurs when multiple tar archives
        // have been concatenated together.
        // Without this option, only the contents of
        // the first concatenated archive would be read.
        _ = lib.archive_read_set_options(this.archive, "read_concatenated_archives");

        // _ = lib.archive_read_support_filter_none(this.archive);

        const rc = lib.archive_read_open_memory(this.archive, this.buf.ptr, this.buf.len);

        this.reading = rc > -1;

        // _ = lib.archive_read_support_compression_all(this.archive);

        return rc;
    }

    pub inline fn bufLeft(this: BufferReadStream) []const u8 {
        return this.buf[this.pos..];
    }

    pub inline fn fromCtx(ctx: *anyopaque) *Stream {
        return @ptrCast(*Stream, @alignCast(@alignOf(*Stream), ctx));
    }

    pub fn archive_close_callback(
        _: *struct_archive,
        _: *anyopaque,
    ) callconv(.C) c_int {
        return 0;
    }

    pub fn archive_read_callback(
        _: *struct_archive,
        ctx_: *anyopaque,
        buffer: [*c]*const anyopaque,
    ) callconv(.C) lib.la_ssize_t {
        var this = fromCtx(ctx_);
        const remaining = this.bufLeft();
        if (remaining.len == 0) return 0;

        const diff = std.math.min(remaining.len, this.block_size);
        buffer.* = remaining[0..diff].ptr;
        this.pos += diff;
        return @intCast(isize, diff);
    }

    pub fn archive_skip_callback(
        _: *struct_archive,
        ctx_: *anyopaque,
        offset: lib.la_int64_t,
    ) callconv(.C) lib.la_int64_t {
        var this = fromCtx(ctx_);

        const buflen = @intCast(isize, this.buf.len);
        const pos = @intCast(isize, this.pos);

        const proposed = pos + offset;
        const new_pos = std.math.min(std.math.max(proposed, 0), buflen - 1);
        this.pos = @intCast(usize, this.pos);
        return new_pos - pos;
    }

    pub fn archive_seek_callback(
        _: *struct_archive,
        ctx_: *anyopaque,
        offset: lib.la_int64_t,
        whence: c_int,
    ) callconv(.C) lib.la_int64_t {
        var this = fromCtx(ctx_);

        const buflen = @intCast(isize, this.buf.len);
        const pos = @intCast(isize, this.pos);

        switch (@intToEnum(Seek, whence)) {
            Seek.current => {
                const new_pos = std.math.max(std.math.min(pos + offset, buflen - 1), 0);
                this.pos = @intCast(usize, new_pos);
                return new_pos;
            },
            Seek.end => {
                const new_pos = std.math.max(std.math.min(buflen - offset, buflen), 0);
                this.pos = @intCast(usize, new_pos);
                return new_pos;
            },
            Seek.set => {
                const new_pos = std.math.max(std.math.min(offset, buflen - 1), 0);
                this.pos = @intCast(usize, new_pos);
                return new_pos;
            },
        }
    }

    // pub fn archive_write_callback(
    //     archive: *struct_archive,
    //     ctx_: *anyopaque,
    //     buffer: *const anyopaque,
    //     len: usize,
    // ) callconv(.C) lib.la_ssize_t {
    //     var this = fromCtx(ctx_);
    // }

    // pub fn archive_close_callback(
    //     archive: *struct_archive,
    //     ctx_: *anyopaque,
    // ) callconv(.C) c_int {
    //     var this = fromCtx(ctx_);
    // }
    // pub fn archive_free_callback(
    //     archive: *struct_archive,
    //     ctx_: *anyopaque,
    // ) callconv(.C) c_int {
    //     var this = fromCtx(ctx_);
    // }

    // pub fn archive_switch_callback(
    //     archive: *struct_archive,
    //     ctx1: *anyopaque,
    //     ctx2: *anyopaque,
    // ) callconv(.C) c_int {
    //     var this = fromCtx(ctx1);
    //     var that = fromCtx(ctx2);
    // }
};

const Kind = std.fs.File.Kind;

pub const Archive = struct {
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
                return @truncate(u32, k);
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
        fd: FileDescriptorType = 0,
        pub fn init(filepath: string, estimated_size: usize, allocator: std.mem.Allocator) !Plucker {
            return Plucker{
                .contents = try MutableString.init(allocator, estimated_size),
                .filename_hash = std.hash.Wyhash.hash(0, filepath),
                .fd = 0,
                .found = false,
            };
        }
    };

    pub fn getOverwritingFileList(
        file_buffer: []const u8,
        root: []const u8,
        ctx: *Archive.Context,
        comptime FilePathAppender: type,
        appender: FilePathAppender,
        comptime depth_to_skip: usize,
    ) !void {
        var entry: *lib.archive_entry = undefined;

        var stream: BufferReadStream = undefined;
        stream.init(file_buffer);
        defer stream.deinit();
        _ = stream.openRead();
        var archive = stream.archive;
        const dir: std.fs.IterableDir = brk: {
            const cwd = std.fs.cwd();

            // if the destination doesn't exist, we skip the whole thing since nothing can overwrite it.
            if (std.fs.path.isAbsolute(root)) {
                break :brk std.fs.openIterableDirAbsolute(root, .{}) catch return;
            } else {
                break :brk cwd.openIterableDir(root, .{}) catch return;
            }
        };

        loop: while (true) {
            const r = @intToEnum(Status, lib.archive_read_next_header(archive, &entry));

            switch (r) {
                Status.eof => break :loop,
                Status.retry => continue :loop,
                Status.failed, Status.fatal => return error.Fail,
                else => {
                    // do not use the utf8 name there
                    // it will require us to pull in libiconv
                    // though we should probably validate the utf8 here nonetheless
                    var pathname: [:0]const u8 = std.mem.sliceTo(lib.archive_entry_pathname(entry).?, 0);
                    var tokenizer = std.mem.tokenize(u8, bun.asByteSlice(pathname), std.fs.path.sep_str);
                    comptime var depth_i: usize = 0;
                    inline while (depth_i < depth_to_skip) : (depth_i += 1) {
                        if (tokenizer.next() == null) continue :loop;
                    }

                    var pathname_ = tokenizer.rest();
                    pathname = std.mem.sliceTo(pathname_.ptr[0..pathname_.len :0], 0);
                    const dirname = std.mem.trim(u8, std.fs.path.dirname(bun.asByteSlice(pathname)) orelse "", std.fs.path.sep_str);

                    const size = @intCast(usize, std.math.max(lib.archive_entry_size(entry), 0));
                    if (size > 0) {
                        var opened = dir.dir.openFileZ(pathname, .{ .mode = .write_only }) catch continue :loop;
                        var stat = try opened.stat();

                        if (stat.size > 0) {
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

                            var overwrite_entry = try ctx.overwrite_list.getOrPut(path_to_use);
                            if (!overwrite_entry.found_existing) {
                                overwrite_entry.key_ptr.* = try appender.append(@TypeOf(path_to_use), path_to_use);
                            }
                        }
                    }
                },
            }
        }
    }

    pub fn extractToDir(
        file_buffer: []const u8,
        dir_: std.fs.IterableDir,
        ctx: ?*Archive.Context,
        comptime ContextType: type,
        appender: ContextType,
        comptime depth_to_skip: usize,
        comptime close_handles: bool,
        comptime log: bool,
    ) !u32 {
        var entry: *lib.archive_entry = undefined;

        var stream: BufferReadStream = undefined;
        stream.init(file_buffer);
        defer stream.deinit();
        _ = stream.openRead();
        var archive = stream.archive;
        var count: u32 = 0;
        const dir = dir_.dir;
        const dir_fd = dir.fd;

        loop: while (true) {
            const r = @intToEnum(Status, lib.archive_read_next_header(archive, &entry));

            switch (r) {
                Status.eof => break :loop,
                Status.retry => continue :loop,
                Status.failed, Status.fatal => return error.Fail,
                else => {
                    var pathname: [:0]const u8 = bun.sliceTo(lib.archive_entry_pathname(entry).?, 0);

                    if (comptime ContextType != void and @hasDecl(std.meta.Child(ContextType), "onFirstDirectoryName")) {
                        if (appender.needs_first_dirname) {
                            appender.onFirstDirectoryName(strings.withoutTrailingSlash(bun.asByteSlice(pathname)));
                        }
                    }

                    var tokenizer = std.mem.tokenize(u8, bun.asByteSlice(pathname), std.fs.path.sep_str);
                    comptime var depth_i: usize = 0;

                    inline while (depth_i < depth_to_skip) : (depth_i += 1) {
                        if (tokenizer.next() == null) continue :loop;
                    }

                    var pathname_ = tokenizer.rest();
                    pathname = @intToPtr([*]const u8, @ptrToInt(pathname_.ptr))[0..pathname_.len :0];
                    if (pathname.len == 0) continue;

                    const kind = C.kindFromMode(lib.archive_entry_filetype(entry));

                    const slice = bun.asByteSlice(pathname);

                    if (comptime log) {
                        Output.prettyln(" {s}", .{pathname});
                    }

                    count += 1;

                    switch (kind) {
                        Kind.Directory => {
                            var mode = @intCast(i32, lib.archive_entry_perm(entry));

                            // if dirs are readable, then they should be listable
                            // https://github.com/npm/node-tar/blob/main/lib/mode-fix.js
                            if ((mode & 0o400) != 0)
                                mode |= 0o100;
                            if ((mode & 0o40) != 0)
                                mode |= 0o10;
                            if ((mode & 0o4) != 0)
                                mode |= 0o1;

                            std.os.mkdiratZ(dir_fd, pathname, @intCast(u32, mode)) catch |err| {
                                if (err == error.PathAlreadyExists or err == error.NotDir) break;
                                try dir.makePath(std.fs.path.dirname(slice) orelse return err);
                                try std.os.mkdiratZ(dir_fd, pathname, 0o777);
                            };
                        },
                        Kind.SymLink => {
                            const link_target = lib.archive_entry_symlink(entry).?;

                            std.os.symlinkatZ(link_target, dir_fd, pathname) catch |err| brk: {
                                switch (err) {
                                    error.AccessDenied, error.FileNotFound => {
                                        dir.makePath(std.fs.path.dirname(slice) orelse return err) catch {};
                                        break :brk try std.os.symlinkatZ(link_target, dir_fd, pathname);
                                    },
                                    else => {
                                        return err;
                                    },
                                }
                            };
                        },
                        Kind.File => {
                            const mode = @intCast(std.os.mode_t, lib.archive_entry_perm(entry));
                            const file = dir.createFileZ(pathname, .{ .truncate = true, .mode = mode }) catch |err| brk: {
                                switch (err) {
                                    error.AccessDenied, error.FileNotFound => {
                                        dir.makePath(std.fs.path.dirname(slice) orelse return err) catch {};
                                        break :brk try dir.createFileZ(pathname, .{
                                            .truncate = true,
                                            .mode = mode,
                                        });
                                    },
                                    else => {
                                        return err;
                                    },
                                }
                            };
                            defer if (comptime close_handles) file.close();

                            const entry_size = @max(lib.archive_entry_size(entry), 0);
                            const size = @intCast(usize, entry_size);
                            if (size > 0) {
                                if (ctx) |ctx_| {
                                    const hash: u64 = if (ctx_.pluckers.len > 0)
                                        std.hash.Wyhash.hash(0, slice)
                                    else
                                        @as(u64, 0);

                                    if (comptime ContextType != void and @hasDecl(std.meta.Child(ContextType), "appendMutable")) {
                                        var result = ctx.?.all_files.getOrPutAdapted(hash, Context.U64Context{}) catch unreachable;
                                        if (!result.found_existing) {
                                            result.value_ptr.* = (try appender.appendMutable(@TypeOf(slice), slice)).ptr;
                                        }
                                    }

                                    for (ctx_.pluckers) |*plucker_| {
                                        if (plucker_.filename_hash == hash) {
                                            try plucker_.contents.inflate(size);
                                            plucker_.contents.list.expandToCapacity();
                                            var read = lib.archive_read_data(archive, plucker_.contents.list.items.ptr, size);
                                            try plucker_.contents.inflate(@intCast(usize, read));
                                            plucker_.found = read > 0;
                                            plucker_.fd = file.handle;
                                            continue :loop;
                                        }
                                    }
                                }
                                // archive_read_data_into_fd reads in chunks of 1 MB
                                // #define	MAX_WRITE	(1024 * 1024)
                                if (size > 4096) {
                                    C.preallocate_file(
                                        file.handle,
                                        0,
                                        entry_size,
                                    ) catch {};
                                }

                                var retries_remaining: u8 = 5;
                                possibly_retry: while (retries_remaining != 0) : (retries_remaining -= 1) {
                                    switch (lib.archive_read_data_into_fd(archive, file.handle)) {
                                        lib.ARCHIVE_EOF => break :loop,
                                        lib.ARCHIVE_OK => break :possibly_retry,
                                        lib.ARCHIVE_RETRY => {
                                            if (comptime log) {
                                                Output.prettyErrorln("[libarchive] Error extracting {s}, retry {d} / {d}", .{ pathname_, retries_remaining, 5 });
                                            }
                                        },
                                        else => {
                                            if (comptime log) {
                                                const archive_error = std.mem.span(lib.archive_error_string(archive));
                                                Output.prettyErrorln("[libarchive] Error extracting {s}: {s}", .{ pathname_, archive_error });
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
        ctx: ?*Archive.Context,
        comptime FilePathAppender: type,
        appender: FilePathAppender,
        comptime depth_to_skip: usize,
        comptime close_handles: bool,
        comptime log: bool,
    ) !u32 {
        var dir: std.fs.IterableDir = brk: {
            const cwd = std.fs.cwd();
            cwd.makePath(
                root,
            ) catch {};

            if (std.fs.path.isAbsolute(root)) {
                break :brk try std.fs.openIterableDirAbsolute(root, .{});
            } else {
                break :brk try cwd.openIterableDir(root, .{});
            }
        };

        defer if (comptime close_handles) dir.close();
        return try extractToDir(file_buffer, dir, ctx, FilePathAppender, appender, depth_to_skip, close_handles, log);
    }
};
