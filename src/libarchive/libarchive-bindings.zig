const std = @import("std");
const bun = @import("root").bun;
const wchar_t = u16;
const la_int64_t = i64;
const la_ssize_t = isize;
const struct_archive = opaque {};
const struct_archive_entry = opaque {};
const archive_entry = struct_archive_entry;
const mode_t = bun.Mode;
const FILE = @import("std").c.FILE;
// const time_t = @import("std").c.time_t;
const dev_t = @import("std").c.dev_t;
const OOM = bun.OOM;
const c = bun.c;

pub const FileType = enum(mode_t) {
    regular = 0o100000,
    link = 0o120000,
    socket = 0o140000,
    character_oriented_device = 0o020000,
    block_oriented_device = 0o060000,
    directory = 0o040000,
    fifo = 0o010000,
};

pub const SymlinkType = enum(c_int) {
    none = 0,
    file = 1,
    directory = 2,
};

const time_t = isize;

pub const Flags = struct {
    pub const Extract = enum(c_int) {
        owner = c.ARCHIVE_EXTRACT_OWNER,
        perm = c.ARCHIVE_EXTRACT_PERM,
        time = c.ARCHIVE_EXTRACT_TIME,
        no_overwrite = c.ARCHIVE_EXTRACT_NO_OVERWRITE,
        unlink = c.ARCHIVE_EXTRACT_UNLINK,
        acl = c.ARCHIVE_EXTRACT_ACL,
        fflags = c.ARCHIVE_EXTRACT_FFLAGS,
        xattr = c.ARCHIVE_EXTRACT_XATTR,
        secure_symlinks = c.ARCHIVE_EXTRACT_SECURE_SYMLINKS,
        secure_nodotdot = c.ARCHIVE_EXTRACT_SECURE_NODOTDOT,
        no_autodir = c.ARCHIVE_EXTRACT_NO_AUTODIR,
        no_overwrite_newer = c.ARCHIVE_EXTRACT_NO_OVERWRITE_NEWER,
        sparse = c.ARCHIVE_EXTRACT_SPARSE,
        mac_metadata = c.ARCHIVE_EXTRACT_MAC_METADATA,
        no_hfs_compression = c.ARCHIVE_EXTRACT_NO_HFS_COMPRESSION,
        hfs_compression_forced = c.ARCHIVE_EXTRACT_HFS_COMPRESSION_FORCED,
        secure_noabsolutepaths = c.ARCHIVE_EXTRACT_SECURE_NOABSOLUTEPATHS,
        clear_nochange_fflags = c.ARCHIVE_EXTRACT_CLEAR_NOCHANGE_FFLAGS,
        safe_writes = c.ARCHIVE_EXTRACT_SAFE_WRITES,
    };

    // Deprecated
    // pub const Compression = enum(c_int) {
    //     none = ARCHIVE_COMPRESSION_NONE,
    //     gzip = ARCHIVE_COMPRESSION_GZIP,
    //     bzip2 = ARCHIVE_COMPRESSION_BZIP2,
    //     compress = ARCHIVE_COMPRESSION_COMPRESS,
    //     program = ARCHIVE_COMPRESSION_PROGRAM,
    //     lzma = ARCHIVE_COMPRESSION_LZMA,
    //     xz = ARCHIVE_COMPRESSION_XZ,
    //     uu = ARCHIVE_COMPRESSION_UU,
    //     rpm = ARCHIVE_COMPRESSION_RPM,
    //     lzip = ARCHIVE_COMPRESSION_LZIP,
    //     lrzip = ARCHIVE_COMPRESSION_LRZIP,
    // };

    pub const Format = enum(c_int) {
        base_mask = c.ARCHIVE_FORMAT_BASE_MASK,
        cpio = c.ARCHIVE_FORMAT_CPIO,
        cpio_posix = c.ARCHIVE_FORMAT_CPIO_POSIX,
        cpio_bin_le = c.ARCHIVE_FORMAT_CPIO_BIN_LE,
        cpio_bin_be = c.ARCHIVE_FORMAT_CPIO_BIN_BE,
        cpio_svr4_nocrc = c.ARCHIVE_FORMAT_CPIO_SVR4_NOCRC,
        cpio_svr4_crc = c.ARCHIVE_FORMAT_CPIO_SVR4_CRC,
        cpio_afio_large = c.ARCHIVE_FORMAT_CPIO_AFIO_LARGE,
        cpio_pwb = c.ARCHIVE_FORMAT_CPIO_PWB,
        shar = c.ARCHIVE_FORMAT_SHAR,
        shar_base = c.ARCHIVE_FORMAT_SHAR_BASE,
        shar_dump = c.ARCHIVE_FORMAT_SHAR_DUMP,
        tar = c.ARCHIVE_FORMAT_TAR,
        tar_ustar = c.ARCHIVE_FORMAT_TAR_USTAR,
        tar_pax_interchange = c.ARCHIVE_FORMAT_TAR_PAX_INTERCHANGE,
        tar_pax_restricted = c.ARCHIVE_FORMAT_TAR_PAX_RESTRICTED,
        tar_gnutar = c.ARCHIVE_FORMAT_TAR_GNUTAR,
        iso9660 = c.ARCHIVE_FORMAT_ISO9660,
        iso9660_rockridge = c.ARCHIVE_FORMAT_ISO9660_ROCKRIDGE,
        zip = c.ARCHIVE_FORMAT_ZIP,
        empty = c.ARCHIVE_FORMAT_EMPTY,
        ar = c.ARCHIVE_FORMAT_AR,
        ar_gnu = c.ARCHIVE_FORMAT_AR_GNU,
        ar_bsd = c.ARCHIVE_FORMAT_AR_BSD,
        mtree = c.ARCHIVE_FORMAT_MTREE,
        raw = c.ARCHIVE_FORMAT_RAW,
        xar = c.ARCHIVE_FORMAT_XAR,
        lha = c.ARCHIVE_FORMAT_LHA,
        cab = c.ARCHIVE_FORMAT_CAB,
        rar = c.ARCHIVE_FORMAT_RAR,
        @"7zip" = c.ARCHIVE_FORMAT_7ZIP,
        warc = c.ARCHIVE_FORMAT_WARC,
        rar_v5 = c.ARCHIVE_FORMAT_RAR_V5,
    };

    pub const Filter = enum(c_int) {
        none = c.ARCHIVE_FILTER_NONE,
        gzip = c.ARCHIVE_FILTER_GZIP,
        bzip2 = c.ARCHIVE_FILTER_BZIP2,
        compress = c.ARCHIVE_FILTER_COMPRESS,
        program = c.ARCHIVE_FILTER_PROGRAM,
        lzma = c.ARCHIVE_FILTER_LZMA,
        xz = c.ARCHIVE_FILTER_XZ,
        uu = c.ARCHIVE_FILTER_UU,
        rpm = c.ARCHIVE_FILTER_RPM,
        lzip = c.ARCHIVE_FILTER_LZIP,
        lrzip = c.ARCHIVE_FILTER_LRZIP,
        lzop = c.ARCHIVE_FILTER_LZOP,
        grzip = c.ARCHIVE_FILTER_GRZIP,
        lz4 = c.ARCHIVE_FILTER_LZ4,
        zstd = c.ARCHIVE_FILTER_ZSTD,
    };

    pub const EntryDigest = enum(c_int) {
        md5 = c.ARCHIVE_ENTRY_DIGEST_MD5,
        rmd160 = c.ARCHIVE_ENTRY_DIGEST_RMD160,
        sha1 = c.ARCHIVE_ENTRY_DIGEST_SHA1,
        sha256 = c.ARCHIVE_ENTRY_DIGEST_SHA256,
        sha384 = c.ARCHIVE_ENTRY_DIGEST_SHA384,
        sha512 = c.ARCHIVE_ENTRY_DIGEST_SHA512,
    };

    pub const EntryACL = enum(c_int) {
        entry_acl_execute = c.ARCHIVE_ENTRY_ACL_EXECUTE,
        write = c.ARCHIVE_ENTRY_ACL_WRITE,
        read = c.ARCHIVE_ENTRY_ACL_READ,
        read_data = c.ARCHIVE_ENTRY_ACL_READ_DATA,
        list_directory = c.ARCHIVE_ENTRY_ACL_LIST_DIRECTORY,
        write_data = c.ARCHIVE_ENTRY_ACL_WRITE_DATA,
        add_file = c.ARCHIVE_ENTRY_ACL_ADD_FILE,
        append_data = c.ARCHIVE_ENTRY_ACL_APPEND_DATA,
        add_subdirectory = c.ARCHIVE_ENTRY_ACL_ADD_SUBDIRECTORY,
        read_named_attrs = c.ARCHIVE_ENTRY_ACL_READ_NAMED_ATTRS,
        write_named_attrs = c.ARCHIVE_ENTRY_ACL_WRITE_NAMED_ATTRS,
        delete_child = c.ARCHIVE_ENTRY_ACL_DELETE_CHILD,
        read_attributes = c.ARCHIVE_ENTRY_ACL_READ_ATTRIBUTES,
        write_attributes = c.ARCHIVE_ENTRY_ACL_WRITE_ATTRIBUTES,
        delete = c.ARCHIVE_ENTRY_ACL_DELETE,
        read_acl = c.ARCHIVE_ENTRY_ACL_READ_ACL,
        write_acl = c.ARCHIVE_ENTRY_ACL_WRITE_ACL,
        write_owner = c.ARCHIVE_ENTRY_ACL_WRITE_OWNER,
        synchronize = c.ARCHIVE_ENTRY_ACL_SYNCHRONIZE,
        perms_posix1_e = c.ARCHIVE_ENTRY_ACL_PERMS_POSIX1E,
        perms_nfs4 = c.ARCHIVE_ENTRY_ACL_PERMS_NFS4,
        entry_inherited = c.ARCHIVE_ENTRY_ACL_ENTRY_INHERITED,
        entry_file_inherit = c.ARCHIVE_ENTRY_ACL_ENTRY_FILE_INHERIT,
        entry_directory_inherit = c.ARCHIVE_ENTRY_ACL_ENTRY_DIRECTORY_INHERIT,
        entry_no_propagate_inherit = c.ARCHIVE_ENTRY_ACL_ENTRY_NO_PROPAGATE_INHERIT,
        entry_inherit_only = c.ARCHIVE_ENTRY_ACL_ENTRY_INHERIT_ONLY,
        entry_successful_access = c.ARCHIVE_ENTRY_ACL_ENTRY_SUCCESSFUL_ACCESS,
        entry_failed_access = c.ARCHIVE_ENTRY_ACL_ENTRY_FAILED_ACCESS,
        inheritance_nfs4 = c.ARCHIVE_ENTRY_ACL_INHERITANCE_NFS4,
        type_access = c.ARCHIVE_ENTRY_ACL_TYPE_ACCESS,
        type_default = c.ARCHIVE_ENTRY_ACL_TYPE_DEFAULT,
        type_allow = c.ARCHIVE_ENTRY_ACL_TYPE_ALLOW,
        type_deny = c.ARCHIVE_ENTRY_ACL_TYPE_DENY,
        type_audit = c.ARCHIVE_ENTRY_ACL_TYPE_AUDIT,
        type_alarm = c.ARCHIVE_ENTRY_ACL_TYPE_ALARM,
        type_posix1_e = c.ARCHIVE_ENTRY_ACL_TYPE_POSIX1E,
        type_nfs4 = c.ARCHIVE_ENTRY_ACL_TYPE_NFS4,
        user = c.ARCHIVE_ENTRY_ACL_USER,
        user_obj = c.ARCHIVE_ENTRY_ACL_USER_OBJ,
        group = c.ARCHIVE_ENTRY_ACL_GROUP,
        group_obj = c.ARCHIVE_ENTRY_ACL_GROUP_OBJ,
        mask = c.ARCHIVE_ENTRY_ACL_MASK,
        other = c.ARCHIVE_ENTRY_ACL_OTHER,
        everyone = c.ARCHIVE_ENTRY_ACL_EVERYONE,
        style_extra_id = c.ARCHIVE_ENTRY_ACL_STYLE_EXTRA_ID,
        style_mark_default = c.ARCHIVE_ENTRY_ACL_STYLE_MARK_DEFAULT,
        style_solaris = c.ARCHIVE_ENTRY_ACL_STYLE_SOLARIS,
        style_separator_comma = c.ARCHIVE_ENTRY_ACL_STYLE_SEPARATOR_COMMA,
        style_compact = c.ARCHIVE_ENTRY_ACL_STYLE_COMPACT,
    };
};

pub const Archive = opaque {
    pub const Result = enum(i32) {
        eof = c.ARCHIVE_EOF,
        ok = c.ARCHIVE_OK,
        retry = c.ARCHIVE_RETRY,
        warn = c.ARCHIVE_WARN,
        failed = c.ARCHIVE_FAILED,
        fatal = c.ARCHIVE_FATAL,

        pub fn init(result: i32) Result {
            return @enumFromInt(result);
        }
    };

    const archive_version_number = c.archive_version_number;
    pub fn versionNumber() i32 {
        return archive_version_number();
    }
    const archive_version_string = c.archive_version_string;
    pub fn versionString() []const u8 {
        return bun.sliceTo(archive_version_string(), 0);
    }
    const archive_version_details = c.archive_version_details;
    pub fn versionDetails() []const u8 {
        return bun.sliceTo(archive_version_details(), 0);
    }
    const archive_zlib_version = c.archive_zlib_version;
    pub fn zlibVersion() []const u8 {
        return bun.sliceTo(archive_zlib_version(), 0);
    }
    const archive_liblzma_version = c.archive_liblzma_version;
    pub fn liblzmaVersion() []const u8 {
        return bun.sliceTo(archive_liblzma_version(), 0);
    }
    const archive_bzlib_version = c.archive_bzlib_version;
    pub fn bzlibVersion() []const u8 {
        return bun.sliceTo(archive_bzlib_version(), 0);
    }
    const archive_liblz4_version = c.archive_liblz4_version;
    pub fn liblz4Version() []const u8 {
        return bun.sliceTo(archive_liblz4_version(), 0);
    }
    const archive_libzstd_version = c.archive_libzstd_version;
    pub fn libzstdVersion() []const u8 {
        return bun.sliceTo(archive_libzstd_version(), 0);
    }

    const archive_error_string = c.archive_error_string;
    pub fn errorString(archive: *Archive) []const u8 {
        const err_str = archive_error_string(archive.cast());
        if (err_str == null) return "";
        return bun.sliceTo(err_str, 0);
    }

    const archive_write_new = c.archive_write_new;
    pub fn writeNew() *Archive {
        return @ptrCast(archive_write_new().?);
    }

    const archive_write_close = c.archive_write_close;
    pub fn writeClose(archive: *Archive) Result {
        return .init(archive_write_close(archive.cast()));
    }

    const archive_write_finish = c.archive_write_finish;
    pub fn writeFinish(archive: *Archive) Result {
        return .init(archive_write_finish(archive.cast()));
    }

    const archive_free = c.archive_free;
    pub fn free(archive: *Archive) Result {
        return .init(archive_free(archive.cast()));
    }

    const archive_write_set_options = c.archive_write_set_options;
    pub fn writeSetOptions(archive: *Archive, opts: [:0]const u8) Result {
        return .init(archive_write_set_options(archive.cast(), opts));
    }

    const archive_write_set_format_pax_restricted = c.archive_write_set_format_pax_restricted;
    pub fn writeSetFormatPaxRestricted(archive: *Archive) Result {
        return .init(archive_write_set_format_pax_restricted(archive.cast()));
    }

    const archive_write_set_format_gnutar = c.archive_write_set_format_gnutar;
    pub fn writeSetFormatGnutar(archive: *Archive) Result {
        return .init(archive_write_set_format_gnutar(archive.cast()));
    }

    const archive_write_set_format_7zip = c.archive_write_set_format_7zip;
    pub fn writeSetFormat7zip(archive: *Archive) Result {
        return .init(archive_write_set_format_7zip(archive.cast()));
    }

    const archive_write_set_format_pax = c.archive_write_set_format_pax;
    pub fn writeSetFormatPax(archive: *Archive) Result {
        return .init(archive_write_set_format_pax(archive.cast()));
    }

    const archive_write_set_format_ustar = c.archive_write_set_format_ustar;
    pub fn writeSetFormatUstar(archive: *Archive) Result {
        return .init(archive_write_set_format_ustar(archive.cast()));
    }

    const archive_write_set_format_zip = c.archive_write_set_format_zip;
    pub fn writeSetFormatZip(archive: *Archive) Result {
        return .init(archive_write_set_format_zip(archive.cast()));
    }

    const archive_write_set_format_shar = c.archive_write_set_format_shar;
    pub fn writeSetFormatShar(archive: *Archive) Result {
        return .init(archive_write_set_format_shar(archive.cast()));
    }

    const archive_write_set_format = c.archive_write_set_format;
    pub fn writeSetFormat(archive: *Archive, format: Flags.Format) Result {
        return .init(archive_write_set_format(archive.cast(), @intFromEnum(format)));
    }

    // deprecated
    //
    const archive_write_set_compression_gzip = c.archive_write_set_compression_gzip;
    // pub fn writeSetCompressionGzip(archive: *Archive) Result {
    // .init(    return archive_write_set_compression_gzip(archive.cast()));
    // }

    const archive_write_add_filter_gzip = c.archive_write_add_filter_gzip;
    pub fn writeAddFilterGzip(archive: *Archive) Result {
        return .init(archive_write_add_filter_gzip(archive.cast()));
    }

    const archive_write_add_filter = c.archive_write_add_filter;
    pub fn writeAddFilter(archive: *Archive, filter: Flags.Filter) Result {
        return .init(archive_write_add_filter(archive.cast(), @intFromEnum(filter)));
    }
    const archive_write_add_filter_by_name = c.archive_write_add_filter_by_name;
    pub fn writeAddFilterByName(archive: *Archive, name: [:0]const u8) Result {
        return .init(archive_write_add_filter_by_name(archive.cast(), name.ptr));
    }
    const archive_write_add_filter_b64encode = c.archive_write_add_filter_b64encode;
    pub fn writeAddFilterB64encode(archive: *Archive) Result {
        return .init(archive_write_add_filter_b64encode(archive.cast()));
    }
    const archive_write_add_filter_bzip2 = c.archive_write_add_filter_bzip2;
    // pub fn writeAddFilterBzip2(archive: *Archive) Result {
    // .init(    return archive_write_add_filter_bzip2(archive.cast()));
    // }
    const archive_write_add_filter_compress = c.archive_write_add_filter_compress;
    pub fn writeAddFilterCompress(archive: *Archive) Result {
        return .init(archive_write_add_filter_compress(archive.cast()));
    }
    const archive_write_add_filter_grzip = c.archive_write_add_filter_grzip;
    pub fn writeAddFilterGrzip(archive: *Archive) Result {
        return .init(archive_write_add_filter_grzip(archive.cast()));
    }
    const archive_write_add_filter_lrzip = c.archive_write_add_filter_lrzip;
    pub fn writeAddFilterLrzip(archive: *Archive) Result {
        return .init(archive_write_add_filter_lrzip(archive.cast()));
    }
    const archive_write_add_filter_lz4 = c.archive_write_add_filter_lz4;
    pub fn writeAddFilterLz4(archive: *Archive) Result {
        return .init(archive_write_add_filter_lz4(archive.cast()));
    }
    const archive_write_add_filter_lzip = c.archive_write_add_filter_lzip;
    pub fn writeAddFilterLzip(archive: *Archive) Result {
        return .init(archive_write_add_filter_lzip(archive.cast()));
    }
    const archive_write_add_filter_lzma = c.archive_write_add_filter_lzma;
    pub fn writeAddFilterLzma(archive: *Archive) Result {
        return .init(archive_write_add_filter_lzma(archive.cast()));
    }
    const archive_write_add_filter_lzop = c.archive_write_add_filter_lzop;
    pub fn writeAddFilterLzop(archive: *Archive) Result {
        return .init(archive_write_add_filter_lzop(archive.cast()));
    }
    const archive_write_add_filter_none = c.archive_write_add_filter_none;
    pub fn writeAddFilterNone(archive: *Archive) Result {
        return .init(archive_write_add_filter_none(archive.cast()));
    }
    const archive_write_add_filter_uuencode = c.archive_write_add_filter_uuencode;
    pub fn writeAddFilterUuencode(archive: *Archive) Result {
        return .init(archive_write_add_filter_uuencode(archive.cast()));
    }
    const archive_write_add_filter_xz = c.archive_write_add_filter_xz;
    pub fn writeAddFilterXz(archive: *Archive) Result {
        return .init(archive_write_add_filter_xz(archive.cast()));
    }
    const archive_write_add_filter_zstd = c.archive_write_add_filter_zstd;
    pub fn writeAddFilterZstd(archive: *Archive) Result {
        return .init(archive_write_add_filter_zstd(archive.cast()));
    }

    const archive_write_set_filter_option = c.archive_write_set_filter_option;
    pub fn writeSetFilterOption(archive: *Archive, m: ?[:0]const u8, o: [:0]const u8, v: [:0]const u8) Result {
        return .init(archive_write_set_filter_option(archive.cast(), m orelse null, o, v));
    }

    const archive_write_open_filename = c.archive_write_open_filename;
    pub fn writeOpenFilename(archive: *Archive, filename: [:0]const u8) Result {
        return .init(archive_write_open_filename(archive.cast(), filename));
    }

    const archive_write_open_fd = c.archive_write_open_fd;
    pub fn writeOpenFd(archive: *Archive, fd: bun.FileDescriptor) Result {
        return .init(archive_write_open_fd(archive.cast(), fd.cast()));
    }

    const archive_write_open_memory = c.archive_write_open_memory;
    pub fn writeOpenMemory(archive: *Archive, buf: ?*anyopaque, buf_size: usize, used: *usize) Result {
        return .init(archive_write_open_memory(archive.cast(), buf, buf_size, used));
    }

    const archive_write_header = c.archive_write_header;
    pub fn writeHeader(archive: *Archive, entry: *Entry) Result {
        return .init(archive_write_header(archive.cast(), entry.cast()));
    }

    const archive_write_data = c.archive_write_data;
    pub fn writeData(archive: *Archive, data: []const u8) isize {
        return archive_write_data(archive.cast(), data.ptr, data.len);
    }

    const archive_write_finish_entry = c.archive_write_finish_entry;
    pub fn writeFinishEntry(archive: *Archive) Result {
        return .init(archive_write_finish_entry(archive.cast()));
    }

    const archive_write_free = c.archive_write_free;
    pub fn writeFree(archive: *Archive) Result {
        return .init(archive_write_free(archive.cast()));
    }

    const archive_read_new = c.archive_read_new;
    pub fn readNew() *Archive {
        return @ptrCast(archive_read_new().?);
    }

    const archive_read_close = c.archive_read_close;
    pub fn readClose(archive: *Archive) Result {
        return .init(archive_read_close(archive.cast()));
    }

    const archive_read_free = c.archive_read_free;
    pub fn readFree(archive: *Archive) Result {
        return .init(archive_read_free(archive.cast()));
    }

    const archive_read_finish = c.archive_read_finish;
    pub fn readFinish(archive: *Archive) Result {
        return .init(archive_read_finish(archive.cast()));
    }

    // these are deprecated
    //
    const archive_read_support_compression_all = c.archive_read_support_compression_all;
    // pub fn readSupportCompressionAll(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_all(archive.cast()));
    // }
    const archive_read_support_compression_bzip2 = c.archive_read_support_compression_bzip2;
    // pub fn readSupportCompressionBzip2(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_bzip2(archive.cast()));
    // }
    const archive_read_support_compression_compress = c.archive_read_support_compression_compress;
    // pub fn readSupportCompressionCompress(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_compress(archive.cast()));
    // }
    const archive_read_support_compression_gzip = c.archive_read_support_compression_gzip;
    // pub fn readSupportCompressionGzip(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_gzip(archive.cast()));
    // }
    const archive_read_support_compression_lzip = c.archive_read_support_compression_lzip;
    // pub fn readSupportCompressionLzip(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_lzip(archive.cast()));
    // }
    const archive_read_support_compression_lzma = c.archive_read_support_compression_lzma;
    // pub fn readSupportCompressionLzma(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_lzma(archive.cast()));
    // }
    const archive_read_support_compression_none = c.archive_read_support_compression_none;
    // pub fn readSupportCompressionNone(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_none(archive.cast()));
    // }
    const archive_read_support_compression_rpm = c.archive_read_support_compression_rpm;
    // pub fn readSupportCompressionRpm(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_rpm(archive.cast()));
    // }
    const archive_read_support_compression_uu = c.archive_read_support_compression_uu;
    // pub fn readSupportCompressionUu(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_uu(archive.cast()));
    // }
    const archive_read_support_compression_xz = c.archive_read_support_compression_xz;
    // pub fn readSupportCompressionXz(archive: *Archive) Result {
    // .init(    return archive_read_support_compression_xz(archive.cast()));
    // }

    const archive_read_support_format_7zip = c.archive_read_support_format_7zip;
    pub fn readSupportFormat7zip(archive: *Archive) Result {
        return .init(archive_read_support_format_7zip(archive.cast()));
    }
    const archive_read_support_format_all = c.archive_read_support_format_all;
    pub fn readSupportFormatAll(archive: *Archive) Result {
        return .init(archive_read_support_format_all(archive.cast()));
    }
    const archive_read_support_format_ar = c.archive_read_support_format_ar;
    pub fn readSupportFormatAr(archive: *Archive) Result {
        return .init(archive_read_support_format_ar(archive.cast()));
    }
    const archive_read_support_format_by_code = c.archive_read_support_format_by_code;
    pub fn readSupportFormatByCode(archive: *Archive, code: i32) Result {
        return .init(archive_read_support_format_by_code(archive.cast(), code));
    }
    const archive_read_support_format_cab = c.archive_read_support_format_cab;
    pub fn readSupportFormatCab(archive: *Archive) Result {
        return .init(archive_read_support_format_cab(archive.cast()));
    }
    const archive_read_support_format_cpio = c.archive_read_support_format_cpio;
    pub fn readSupportFormatCpio(archive: *Archive) Result {
        return .init(archive_read_support_format_cpio(archive.cast()));
    }
    const archive_read_support_format_empty = c.archive_read_support_format_empty;
    pub fn readSupportFormatEmpty(archive: *Archive) Result {
        return .init(archive_read_support_format_empty(archive.cast()));
    }
    const archive_read_support_format_gnutar = c.archive_read_support_format_gnutar;
    pub fn readSupportFormatGnutar(archive: *Archive) Result {
        return .init(archive_read_support_format_gnutar(archive.cast()));
    }
    const archive_read_support_format_iso9660 = c.archive_read_support_format_iso9660;
    pub fn readSupportFormatIso9660(archive: *Archive) Result {
        return .init(archive_read_support_format_iso9660(archive.cast()));
    }
    const archive_read_support_format_lha = c.archive_read_support_format_lha;
    pub fn readSupportFormatLha(archive: *Archive) Result {
        return .init(archive_read_support_format_lha(archive.cast()));
    }
    const archive_read_support_format_mtree = c.archive_read_support_format_mtree;
    pub fn readSupportFormatMtree(archive: *Archive) Result {
        return .init(archive_read_support_format_mtree(archive.cast()));
    }
    const archive_read_support_format_rar = c.archive_read_support_format_rar;
    pub fn readSupportFormatRar(archive: *Archive) Result {
        return .init(archive_read_support_format_rar(archive.cast()));
    }
    const archive_read_support_format_rar5 = c.archive_read_support_format_rar5;
    pub fn readSupportFormatRar5(archive: *Archive) Result {
        return .init(archive_read_support_format_rar5(archive.cast()));
    }
    const archive_read_support_format_raw = c.archive_read_support_format_raw;
    pub fn readSupportFormatRaw(archive: *Archive) Result {
        return .init(archive_read_support_format_raw(archive.cast()));
    }
    const archive_read_support_format_tar = c.archive_read_support_format_tar;
    pub fn readSupportFormatTar(archive: *Archive) Result {
        return .init(archive_read_support_format_tar(archive.cast()));
    }
    const archive_read_support_format_warc = c.archive_read_support_format_warc;
    pub fn readSupportFormatWarc(archive: *Archive) Result {
        return .init(archive_read_support_format_warc(archive.cast()));
    }
    const archive_read_support_format_xar = c.archive_read_support_format_xar;
    pub fn readSupportFormatXar(archive: *Archive) Result {
        return .init(archive_read_support_format_xar(archive.cast()));
    }
    const archive_read_support_format_zip = c.archive_read_support_format_zip;
    pub fn readSupportFormatZip(archive: *Archive) Result {
        return .init(archive_read_support_format_zip(archive.cast()));
    }
    const archive_read_support_format_zip_streamable = c.archive_read_support_format_zip_streamable;
    pub fn readSupportFormatZipStreamable(archive: *Archive) Result {
        return .init(archive_read_support_format_zip_streamable(archive.cast()));
    }
    const archive_read_support_format_zip_seekable = c.archive_read_support_format_zip_seekable;
    pub fn readSupportFormatZipSeekable(archive: *Archive) Result {
        return .init(archive_read_support_format_zip_seekable(archive.cast()));
    }

    const archive_read_set_options = c.archive_read_set_options;
    pub fn readSetOptions(archive: *Archive, opts: [:0]const u8) Result {
        return .init(archive_read_set_options(archive.cast(), opts.ptr));
    }

    const archive_read_open_memory = c.archive_read_open_memory;
    pub fn readOpenMemory(archive: *Archive, buf: []const u8) Result {
        return .init(archive_read_open_memory(archive.cast(), buf.ptr, buf.len));
    }

    const archive_read_next_header = c.archive_read_next_header;
    pub fn readNextHeader(archive: *Archive, entry: **Entry) Result {
        return .init(archive_read_next_header(archive.cast(), @ptrCast(entry)));
    }
    const archive_read_next_header2 = c.archive_read_next_header2;
    pub fn readNextHeader2(archive: *Archive, entry: *Entry) Result {
        return .init(archive_read_next_header2(archive.cast(), @ptrCast(entry)));
    }

    const archive_read_data = c.archive_read_data;
    pub fn readData(archive: *Archive, buf: []u8) isize {
        return archive_read_data(archive.cast(), buf.ptr, buf.len);
    }
    const archive_read_data_into_fd = c.archive_read_data_into_fd;
    pub fn readDataIntoFd(archive: *Archive, fd: c_int) Result {
        return .init(archive_read_data_into_fd(archive.cast(), fd));
    }

    const archive_read_support_filter_all = c.archive_read_support_filter_all;
    pub fn readSupportFilterAll(archive: *Archive) Result {
        return .init(archive_read_support_filter_all(archive.cast()));
    }
    const archive_read_support_filter_by_code = c.archive_read_support_filter_by_code;
    pub fn readSupportFilterByCode(archive: *Archive, code: i32) Result {
        return .init(archive_read_support_filter_by_code(archive.cast(), code));
    }
    const archive_read_support_filter_bzip2 = c.archive_read_support_filter_bzip2;
    // pub fn readSupportFilterbZip2(archive: *Archive) Result {
    // .init(    return archive_read_support_filter_bzip2(archive.cast()));
    // }
    const archive_read_support_filter_compress = c.archive_read_support_filter_compress;
    pub fn readSupportFilterCompress(archive: *Archive) Result {
        return .init(archive_read_support_filter_compress(archive.cast()));
    }
    const archive_read_support_filter_gzip = c.archive_read_support_filter_gzip;
    pub fn readSupportFilterGzip(archive: *Archive) Result {
        return .init(archive_read_support_filter_gzip(archive.cast()));
    }
    const archive_read_support_filter_grzip = c.archive_read_support_filter_grzip;
    pub fn readSupportFilterGrzip(archive: *Archive) Result {
        return .init(archive_read_support_filter_grzip(archive.cast()));
    }
    const archive_read_support_filter_lrzip = c.archive_read_support_filter_lrzip;
    pub fn readSupportFilterLrzip(archive: *Archive) Result {
        return .init(archive_read_support_filter_lrzip(archive.cast()));
    }
    const archive_read_support_filter_lz4 = c.archive_read_support_filter_lz4;
    pub fn readSupportFilterLz4(archive: *Archive) Result {
        return .init(archive_read_support_filter_lz4(archive.cast()));
    }
    const archive_read_support_filter_lzip = c.archive_read_support_filter_lzip;
    pub fn readSupportFilterLzip(archive: *Archive) Result {
        return .init(archive_read_support_filter_lzip(archive.cast()));
    }
    const archive_read_support_filter_lzma = c.archive_read_support_filter_lzma;
    pub fn readSupportFilterLzma(archive: *Archive) Result {
        return .init(archive_read_support_filter_lzma(archive.cast()));
    }
    const archive_read_support_filter_lzop = c.archive_read_support_filter_lzop;
    pub fn readSupportFilterLzop(archive: *Archive) Result {
        return .init(archive_read_support_filter_lzop(archive.cast()));
    }
    const archive_read_support_filter_none = c.archive_read_support_filter_none;
    pub fn readSupportFilterNone(archive: *Archive) Result {
        return .init(archive_read_support_filter_none(archive.cast()));
    }
    const archive_read_support_filter_rpm = c.archive_read_support_filter_rpm;
    pub fn readSupportFilterRpm(archive: *Archive) Result {
        return .init(archive_read_support_filter_rpm(archive.cast()));
    }
    const archive_read_support_filter_uu = c.archive_read_support_filter_uu;
    pub fn readSupportFilterUu(archive: *Archive) Result {
        return .init(archive_read_support_filter_uu(archive.cast()));
    }
    const archive_read_support_filter_xz = c.archive_read_support_filter_xz;
    pub fn readSupportFilterXz(archive: *Archive) Result {
        return .init(archive_read_support_filter_xz(archive.cast()));
    }
    const archive_read_support_filter_zstd = c.archive_read_support_filter_zstd;
    pub fn readSupportFilterZstd(archive: *Archive) Result {
        return .init(archive_read_support_filter_zstd(archive.cast()));
    }

    fn cast(this: *Archive) *c.struct_archive {
        return @ptrCast(this);
    }

    pub const Entry = opaque {
        fn cast(this: *Entry) *c.struct_archive_entry {
            return @ptrCast(this);
        }

        const archive_entry_new = c.archive_entry_new;
        pub fn new() *Entry {
            return @ptrCast(archive_entry_new().?);
        }

        const archive_entry_new2 = c.archive_entry_new2;
        pub fn new2(archive: *Archive) *Entry {
            return @ptrCast(archive_entry_new2(archive.cast()).?);
        }

        const archive_entry_free = c.archive_entry_free;
        pub fn free(entry: *Entry) void {
            archive_entry_free(entry.cast());
        }

        const archive_entry_set_pathname = c.archive_entry_set_pathname;
        pub fn setPathname(entry: *Entry, name: [:0]const u8) void {
            archive_entry_set_pathname(entry.cast(), name);
        }

        const archive_entry_set_pathname_utf8 = c.archive_entry_set_pathname_utf8;
        pub fn setPathnameUtf8(entry: *Entry, name: [:0]const u8) void {
            archive_entry_set_pathname_utf8(entry.cast(), name);
        }

        const archive_entry_copy_pathname = c.archive_entry_copy_pathname;
        pub fn copyPathname(entry: *Entry, name: [:0]const u8) void {
            return archive_entry_copy_pathname(entry.cast(), name);
        }

        const archive_entry_copy_pathname_w = c.archive_entry_copy_pathname_w;
        pub fn copyPathnameW(entry: *Entry, name: [:0]const u16) void {
            return archive_entry_copy_pathname_w(entry.cast(), name);
        }

        const archive_entry_set_size = c.archive_entry_set_size;
        pub fn setSize(entry: *Entry, s: i64) void {
            archive_entry_set_size(entry.cast(), s);
        }

        const archive_entry_set_filetype = c.archive_entry_set_filetype;
        pub fn setFiletype(entry: *Entry, @"type": u32) void {
            archive_entry_set_filetype(entry.cast(), @"type");
        }

        const archive_entry_set_perm = c.archive_entry_set_perm;
        pub fn setPerm(entry: *Entry, p: bun.Mode) void {
            archive_entry_set_perm(entry.cast(), p);
        }

        const archive_entry_set_mode = c.archive_entry_set_mode;
        pub fn setMode(entry: *Entry, mode: bun.Mode) void {
            archive_entry_set_mode(entry.cast(), mode);
        }

        const archive_entry_set_mtime = c.archive_entry_set_mtime;
        pub fn setMtime(entry: *Entry, secs: isize, nsecs: c_long) void {
            archive_entry_set_mtime(entry.cast(), secs, nsecs);
        }

        const archive_entry_clear = c.archive_entry_clear;
        pub fn clear(entry: *Entry) *Entry {
            return @ptrCast(archive_entry_clear(entry.cast()).?);
        }

        const archive_entry_pathname = c.archive_entry_pathname;
        pub fn pathname(entry: *Entry) [:0]const u8 {
            return bun.sliceTo(archive_entry_pathname(entry.cast()), 0);
        }
        const archive_entry_pathname_utf8 = c.archive_entry_pathname_utf8;
        pub fn pathnameUtf8(entry: *Entry) [:0]const u8 {
            return bun.sliceTo(archive_entry_pathname_utf8(entry.cast()), 0);
        }
        const archive_entry_pathname_w = c.archive_entry_pathname_w;
        pub fn pathnameW(entry: *Entry) [:0]const u16 {
            return bun.sliceTo(archive_entry_pathname_w(entry.cast()), 0);
        }
        const archive_entry_filetype = c.archive_entry_filetype;
        pub fn filetype(entry: *Entry) bun.Mode {
            return archive_entry_filetype(entry.cast());
        }
        const archive_entry_perm = c.archive_entry_perm;
        pub fn perm(entry: *Entry) bun.Mode {
            return archive_entry_perm(entry.cast());
        }
        const archive_entry_size = c.archive_entry_size;
        pub fn size(entry: *Entry) i64 {
            return archive_entry_size(entry.cast());
        }
        const archive_entry_symlink = c.archive_entry_symlink;
        pub fn symlink(entry: *Entry) [:0]const u8 {
            return bun.sliceTo(archive_entry_symlink(entry.cast()), 0);
        }
        const archive_entry_symlink_utf8 = c.archive_entry_symlink_utf8;
        pub fn symlinkUtf8(entry: *Entry) [:0]const u8 {
            return bun.sliceTo(archive_entry_symlink_utf8(entry.cast()), 0);
        }
        const archive_entry_symlink_type = c.archive_entry_symlink_type;
        pub fn symlinkType(entry: *Entry) SymlinkType {
            return archive_entry_symlink_type(entry.cast());
        }
        const archive_entry_symlink_w = c.archive_entry_symlink_w;
        pub fn symlinkW(entry: *Entry) [:0]const u16 {
            return bun.sliceTo(archive_entry_symlink_w(entry.cast()), 0);
        }
    };

    pub const Iterator = struct {
        archive: *Archive,
        filter: std.EnumSet(std.fs.File.Kind),

        fn Result(comptime T: type) type {
            return union(enum) {
                err: struct {
                    archive: *Archive,
                    message: []const u8,
                },
                result: T,

                pub fn initErr(arch: *Archive, msg: []const u8) @This() {
                    return .{ .err = .{ .message = msg, .archive = arch } };
                }

                pub fn initRes(value: T) @This() {
                    return .{ .result = value };
                }
            };
        }

        pub fn init(tarball_bytes: []const u8) Iterator.Result(@This()) {
            const Return = Iterator.Result(@This());

            const archive = Archive.readNew();

            switch (archive.readSupportFormatTar()) {
                .failed, .fatal, .warn => {
                    return Return.initErr(archive, "failed to enable tar format support");
                },
                else => {},
            }
            switch (archive.readSupportFormatGnutar()) {
                .failed, .fatal, .warn => {
                    return Return.initErr(archive, "failed to enable gnutar format support");
                },
                else => {},
            }
            switch (archive.readSupportFilterGzip()) {
                .failed, .fatal, .warn => {
                    return Return.initErr(archive, "failed to enable support for gzip compression");
                },
                else => {},
            }

            switch (archive.readSetOptions("read_concatenated_archives")) {
                .failed, .fatal, .warn => {
                    return Return.initErr(archive, "failed to set option `read_concatenated_archives`");
                },
                else => {},
            }

            switch (archive.readOpenMemory(tarball_bytes)) {
                .failed, .fatal, .warn => {
                    return Return.initErr(archive, "failed to read tarball");
                },
                else => {},
            }

            return Return.initRes(.{
                .archive = archive,
                .filter = std.EnumSet(std.fs.File.Kind).initEmpty(),
            });
        }

        const NextEntry = struct {
            entry: *Archive.Entry,
            kind: std.fs.File.Kind,

            pub fn readEntryData(this: *const @This(), allocator: std.mem.Allocator, archive: *Archive) OOM!Iterator.Result([]const u8) {
                const Return = Iterator.Result([]const u8);
                const size = this.entry.size();
                if (size < 0) return Return.initErr(archive, "invalid archive entry size");

                const buf = try allocator.alloc(u8, @intCast(size));

                const read = archive.readData(buf);
                if (read < 0) {
                    return Return.initErr(archive, "failed to read archive data");
                }
                return Return.initRes(buf[0..@intCast(read)]);
            }
        };

        pub fn next(this: *@This()) Iterator.Result(?NextEntry) {
            const Return = Iterator.Result(?NextEntry);

            var entry: *Archive.Entry = undefined;
            while (true) {
                return switch (this.archive.readNextHeader(&entry)) {
                    .retry => continue,
                    .eof => Return.initRes(null),
                    .ok => {
                        const kind = bun.C.kindFromMode(entry.filetype());

                        if (this.filter.contains(kind)) continue;

                        return Return.initRes(.{
                            .entry = entry,
                            .kind = kind,
                        });
                    },
                    else => Return.initErr(this.archive, "failed to read archive header"),
                };
            }
        }

        pub fn deinit(this: *@This()) Iterator.Result(void) {
            const Return = Iterator.Result(void);

            switch (this.archive.readClose()) {
                .failed, .fatal, .warn => {
                    return Return.initErr(this.archive, "failed to close archive read");
                },
                else => {},
            }
            switch (this.archive.readFree()) {
                .failed, .fatal, .warn => {
                    return Return.initErr(this.archive, "failed to free archive read");
                },
                else => {},
            }

            return Return.initRes({});
        }
    };
};
