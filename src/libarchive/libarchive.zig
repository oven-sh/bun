// @link "../deps/libarchive.a"

const lib = @import("./libarchive-bindings.zig");
const bun = @import("root").bun;
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
const JSC = bun.JSC;
pub const Seek = enum(c_int) {
    set = std.posix.SEEK_SET,
    current = std.posix.SEEK_CUR,
    end = std.posix.SEEK_END,
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
        return @as(*Stream, @ptrCast(@alignCast(ctx)));
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

        const diff = @min(remaining.len, this.block_size);
        buffer.* = remaining[0..diff].ptr;
        this.pos += diff;
        return @as(isize, @intCast(diff));
    }

    pub fn archive_skip_callback(
        _: *struct_archive,
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
        _: *struct_archive,
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
        fd: FileDescriptorType = .zero,
        pub fn init(filepath: bun.OSPathSlice, estimated_size: usize, allocator: std.mem.Allocator) !Plucker {
            return Plucker{
                .contents = try MutableString.init(allocator, estimated_size),
                .filename_hash = bun.hash(std.mem.sliceAsBytes(filepath)),
                .fd = .zero,
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
            const r = @as(Status, @enumFromInt(lib.archive_read_next_header(archive, &entry)));

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

                    const size = @as(usize, @intCast(@max(lib.archive_entry_size(entry), 0)));
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
        ctx: ?*Archive.Context,
        comptime ContextType: type,
        appender: ContextType,
        options: ExtractOptions,
    ) !u32 {
        var entry: *lib.archive_entry = undefined;

        var stream: BufferReadStream = undefined;
        stream.init(file_buffer);
        defer stream.deinit();
        _ = stream.openRead();
        const archive = stream.archive;
        var count: u32 = 0;
        const dir_fd = dir.fd;

        var normalized_buf: bun.OSPathBuffer = undefined;

        loop: while (true) {
            const r: Status = @enumFromInt(lib.archive_read_next_header(archive, &entry));

            switch (r) {
                Status.eof => break :loop,
                Status.retry => continue :loop,
                Status.failed, Status.fatal => return error.Fail,
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
                        std.mem.sliceTo(lib.archive_entry_pathname_w(entry), 0)
                    else
                        std.mem.sliceTo(lib.archive_entry_pathname(entry), 0);

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

                    const kind = C.kindFromMode(lib.archive_entry_filetype(entry));

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

                        for (remain) |*c| {
                            switch (c.*) {
                                '|', '<', '>', '?', ':' => c.* += 0xf000,
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
                        Kind.directory => {
                            var mode = @as(i32, @intCast(lib.archive_entry_perm(entry)));

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
                                std.posix.mkdiratZ(dir_fd, pathname, @as(u32, @intCast(mode))) catch |err| {
                                    // It's possible for some tarballs to return a directory twice, with and
                                    // without `./` in the beginning. So if it already exists, continue to the
                                    // next entry.
                                    if (err == error.PathAlreadyExists or err == error.NotDir) continue;
                                    bun.makePath(dir, std.fs.path.dirname(path_slice) orelse return err) catch {};
                                    std.posix.mkdiratZ(dir_fd, pathname, 0o777) catch {};
                                };
                            }
                        },
                        Kind.sym_link => {
                            const link_target = lib.archive_entry_symlink(entry).?;
                            if (Environment.isPosix) {
                                std.posix.symlinkatZ(link_target, dir_fd, path) catch |err| brk: {
                                    switch (err) {
                                        error.AccessDenied, error.FileNotFound => {
                                            dir.makePath(std.fs.path.dirname(path_slice) orelse return err) catch {};
                                            break :brk try std.posix.symlinkatZ(link_target, dir_fd, path);
                                        },
                                        else => {
                                            return err;
                                        },
                                    }
                                };
                            }
                        },
                        Kind.file => {
                            const mode: bun.Mode = if (comptime Environment.isWindows) 0 else @intCast(lib.archive_entry_perm(entry));

                            const file_handle_native = brk: {
                                if (Environment.isWindows) {
                                    const flags = bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC;
                                    switch (bun.sys.openatWindows(bun.toFD(dir_fd), path, flags)) {
                                        .result => |fd| break :brk fd,
                                        .err => |e| switch (e.errno) {
                                            @intFromEnum(bun.C.E.PERM), @intFromEnum(bun.C.E.NOENT) => {
                                                bun.MakePath.makePath(u16, dir, bun.Dirname.dirname(u16, path_slice) orelse return bun.errnoToZigErr(e.errno)) catch {};
                                                break :brk try bun.sys.openatWindows(bun.toFD(dir_fd), path, flags).unwrap();
                                            },
                                            else => {
                                                return bun.errnoToZigErr(e.errno);
                                            },
                                        },
                                    }
                                } else {
                                    break :brk (dir.createFileZ(path, .{ .truncate = true, .mode = mode }) catch |err| {
                                        switch (err) {
                                            error.AccessDenied, error.FileNotFound => {
                                                dir.makePath(std.fs.path.dirname(path_slice) orelse return err) catch {};
                                                break :brk (try dir.createFileZ(path, .{
                                                    .truncate = true,
                                                    .mode = mode,
                                                })).handle;
                                            },
                                            else => {
                                                return err;
                                            },
                                        }
                                    }).handle;
                                }
                            };
                            const file_handle = brk: {
                                errdefer _ = bun.sys.close(file_handle_native);
                                break :brk try bun.toLibUVOwnedFD(file_handle_native);
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
                                _ = bun.sys.close(file_handle);
                            };

                            const entry_size = @max(lib.archive_entry_size(entry), 0);
                            const size = @as(usize, @intCast(entry_size));
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
                                            const read = lib.archive_read_data(archive, plucker_.contents.list.items.ptr, size);
                                            try plucker_.contents.inflate(@as(usize, @intCast(read)));
                                            plucker_.found = read > 0;
                                            plucker_.fd = file_handle;
                                            plucked_file = true;
                                            continue :loop;
                                        }
                                    }
                                }
                                // archive_read_data_into_fd reads in chunks of 1 MB
                                // #define	MAX_WRITE	(1024 * 1024)
                                if (comptime Environment.isLinux) {
                                    if (size > 1_000_000) {
                                        C.preallocate_file(
                                            file_handle.cast(),
                                            0,
                                            entry_size,
                                        ) catch {};
                                    }
                                }

                                var retries_remaining: u8 = 5;
                                possibly_retry: while (retries_remaining != 0) : (retries_remaining -= 1) {
                                    switch (lib.archive_read_data_into_fd(archive, bun.uvfdcast(file_handle))) {
                                        lib.ARCHIVE_EOF => break :loop,
                                        lib.ARCHIVE_OK => break :possibly_retry,
                                        lib.ARCHIVE_RETRY => {
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
                                                const archive_error = std.mem.span(lib.archive_error_string(archive));
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
        ctx: ?*Archive.Context,
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
