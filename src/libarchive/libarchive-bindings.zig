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
        owner = ARCHIVE_EXTRACT_OWNER,
        perm = ARCHIVE_EXTRACT_PERM,
        time = ARCHIVE_EXTRACT_TIME,
        no_overwrite = ARCHIVE_EXTRACT_NO_OVERWRITE,
        unlink = ARCHIVE_EXTRACT_UNLINK,
        acl = ARCHIVE_EXTRACT_ACL,
        fflags = ARCHIVE_EXTRACT_FFLAGS,
        xattr = ARCHIVE_EXTRACT_XATTR,
        secure_symlinks = ARCHIVE_EXTRACT_SECURE_SYMLINKS,
        secure_nodotdot = ARCHIVE_EXTRACT_SECURE_NODOTDOT,
        no_autodir = ARCHIVE_EXTRACT_NO_AUTODIR,
        no_overwrite_newer = ARCHIVE_EXTRACT_NO_OVERWRITE_NEWER,
        sparse = ARCHIVE_EXTRACT_SPARSE,
        mac_metadata = ARCHIVE_EXTRACT_MAC_METADATA,
        no_hfs_compression = ARCHIVE_EXTRACT_NO_HFS_COMPRESSION,
        hfs_compression_forced = ARCHIVE_EXTRACT_HFS_COMPRESSION_FORCED,
        secure_noabsolutepaths = ARCHIVE_EXTRACT_SECURE_NOABSOLUTEPATHS,
        clear_nochange_fflags = ARCHIVE_EXTRACT_CLEAR_NOCHANGE_FFLAGS,
        safe_writes = ARCHIVE_EXTRACT_SAFE_WRITES,
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
        base_mask = ARCHIVE_FORMAT_BASE_MASK,
        cpio = ARCHIVE_FORMAT_CPIO,
        cpio_posix = ARCHIVE_FORMAT_CPIO_POSIX,
        cpio_bin_le = ARCHIVE_FORMAT_CPIO_BIN_LE,
        cpio_bin_be = ARCHIVE_FORMAT_CPIO_BIN_BE,
        cpio_svr4_nocrc = ARCHIVE_FORMAT_CPIO_SVR4_NOCRC,
        cpio_svr4_crc = ARCHIVE_FORMAT_CPIO_SVR4_CRC,
        cpio_afio_large = ARCHIVE_FORMAT_CPIO_AFIO_LARGE,
        cpio_pwb = ARCHIVE_FORMAT_CPIO_PWB,
        shar = ARCHIVE_FORMAT_SHAR,
        shar_base = ARCHIVE_FORMAT_SHAR_BASE,
        shar_dump = ARCHIVE_FORMAT_SHAR_DUMP,
        tar = ARCHIVE_FORMAT_TAR,
        tar_ustar = ARCHIVE_FORMAT_TAR_USTAR,
        tar_pax_interchange = ARCHIVE_FORMAT_TAR_PAX_INTERCHANGE,
        tar_pax_restricted = ARCHIVE_FORMAT_TAR_PAX_RESTRICTED,
        tar_gnutar = ARCHIVE_FORMAT_TAR_GNUTAR,
        iso9660 = ARCHIVE_FORMAT_ISO9660,
        iso9660_rockridge = ARCHIVE_FORMAT_ISO9660_ROCKRIDGE,
        zip = ARCHIVE_FORMAT_ZIP,
        empty = ARCHIVE_FORMAT_EMPTY,
        ar = ARCHIVE_FORMAT_AR,
        ar_gnu = ARCHIVE_FORMAT_AR_GNU,
        ar_bsd = ARCHIVE_FORMAT_AR_BSD,
        mtree = ARCHIVE_FORMAT_MTREE,
        raw = ARCHIVE_FORMAT_RAW,
        xar = ARCHIVE_FORMAT_XAR,
        lha = ARCHIVE_FORMAT_LHA,
        cab = ARCHIVE_FORMAT_CAB,
        rar = ARCHIVE_FORMAT_RAR,
        @"7zip" = ARCHIVE_FORMAT_7ZIP,
        warc = ARCHIVE_FORMAT_WARC,
        rar_v5 = ARCHIVE_FORMAT_RAR_V5,
    };

    pub const Filter = enum(c_int) {
        none = ARCHIVE_FILTER_NONE,
        gzip = ARCHIVE_FILTER_GZIP,
        bzip2 = ARCHIVE_FILTER_BZIP2,
        compress = ARCHIVE_FILTER_COMPRESS,
        program = ARCHIVE_FILTER_PROGRAM,
        lzma = ARCHIVE_FILTER_LZMA,
        xz = ARCHIVE_FILTER_XZ,
        uu = ARCHIVE_FILTER_UU,
        rpm = ARCHIVE_FILTER_RPM,
        lzip = ARCHIVE_FILTER_LZIP,
        lrzip = ARCHIVE_FILTER_LRZIP,
        lzop = ARCHIVE_FILTER_LZOP,
        grzip = ARCHIVE_FILTER_GRZIP,
        lz4 = ARCHIVE_FILTER_LZ4,
        zstd = ARCHIVE_FILTER_ZSTD,
    };

    pub const EntryDigest = enum(c_int) {
        md5 = ARCHIVE_ENTRY_DIGEST_MD5,
        rmd160 = ARCHIVE_ENTRY_DIGEST_RMD160,
        sha1 = ARCHIVE_ENTRY_DIGEST_SHA1,
        sha256 = ARCHIVE_ENTRY_DIGEST_SHA256,
        sha384 = ARCHIVE_ENTRY_DIGEST_SHA384,
        sha512 = ARCHIVE_ENTRY_DIGEST_SHA512,
    };

    pub const EntryACL = enum(c_int) {
        entry_acl_execute = ARCHIVE_ENTRY_ACL_EXECUTE,
        write = ARCHIVE_ENTRY_ACL_WRITE,
        read = ARCHIVE_ENTRY_ACL_READ,
        read_data = ARCHIVE_ENTRY_ACL_READ_DATA,
        list_directory = ARCHIVE_ENTRY_ACL_LIST_DIRECTORY,
        write_data = ARCHIVE_ENTRY_ACL_WRITE_DATA,
        add_file = ARCHIVE_ENTRY_ACL_ADD_FILE,
        append_data = ARCHIVE_ENTRY_ACL_APPEND_DATA,
        add_subdirectory = ARCHIVE_ENTRY_ACL_ADD_SUBDIRECTORY,
        read_named_attrs = ARCHIVE_ENTRY_ACL_READ_NAMED_ATTRS,
        write_named_attrs = ARCHIVE_ENTRY_ACL_WRITE_NAMED_ATTRS,
        delete_child = ARCHIVE_ENTRY_ACL_DELETE_CHILD,
        read_attributes = ARCHIVE_ENTRY_ACL_READ_ATTRIBUTES,
        write_attributes = ARCHIVE_ENTRY_ACL_WRITE_ATTRIBUTES,
        delete = ARCHIVE_ENTRY_ACL_DELETE,
        read_acl = ARCHIVE_ENTRY_ACL_READ_ACL,
        write_acl = ARCHIVE_ENTRY_ACL_WRITE_ACL,
        write_owner = ARCHIVE_ENTRY_ACL_WRITE_OWNER,
        synchronize = ARCHIVE_ENTRY_ACL_SYNCHRONIZE,
        perms_posix1_e = ARCHIVE_ENTRY_ACL_PERMS_POSIX1E,
        perms_nfs4 = ARCHIVE_ENTRY_ACL_PERMS_NFS4,
        entry_inherited = ARCHIVE_ENTRY_ACL_ENTRY_INHERITED,
        entry_file_inherit = ARCHIVE_ENTRY_ACL_ENTRY_FILE_INHERIT,
        entry_directory_inherit = ARCHIVE_ENTRY_ACL_ENTRY_DIRECTORY_INHERIT,
        entry_no_propagate_inherit = ARCHIVE_ENTRY_ACL_ENTRY_NO_PROPAGATE_INHERIT,
        entry_inherit_only = ARCHIVE_ENTRY_ACL_ENTRY_INHERIT_ONLY,
        entry_successful_access = ARCHIVE_ENTRY_ACL_ENTRY_SUCCESSFUL_ACCESS,
        entry_failed_access = ARCHIVE_ENTRY_ACL_ENTRY_FAILED_ACCESS,
        inheritance_nfs4 = ARCHIVE_ENTRY_ACL_INHERITANCE_NFS4,
        type_access = ARCHIVE_ENTRY_ACL_TYPE_ACCESS,
        type_default = ARCHIVE_ENTRY_ACL_TYPE_DEFAULT,
        type_allow = ARCHIVE_ENTRY_ACL_TYPE_ALLOW,
        type_deny = ARCHIVE_ENTRY_ACL_TYPE_DENY,
        type_audit = ARCHIVE_ENTRY_ACL_TYPE_AUDIT,
        type_alarm = ARCHIVE_ENTRY_ACL_TYPE_ALARM,
        type_posix1_e = ARCHIVE_ENTRY_ACL_TYPE_POSIX1E,
        type_nfs4 = ARCHIVE_ENTRY_ACL_TYPE_NFS4,
        user = ARCHIVE_ENTRY_ACL_USER,
        user_obj = ARCHIVE_ENTRY_ACL_USER_OBJ,
        group = ARCHIVE_ENTRY_ACL_GROUP,
        group_obj = ARCHIVE_ENTRY_ACL_GROUP_OBJ,
        mask = ARCHIVE_ENTRY_ACL_MASK,
        other = ARCHIVE_ENTRY_ACL_OTHER,
        everyone = ARCHIVE_ENTRY_ACL_EVERYONE,
        style_extra_id = ARCHIVE_ENTRY_ACL_STYLE_EXTRA_ID,
        style_mark_default = ARCHIVE_ENTRY_ACL_STYLE_MARK_DEFAULT,
        style_solaris = ARCHIVE_ENTRY_ACL_STYLE_SOLARIS,
        style_separator_comma = ARCHIVE_ENTRY_ACL_STYLE_SEPARATOR_COMMA,
        style_compact = ARCHIVE_ENTRY_ACL_STYLE_COMPACT,
    };
};

const ARCHIVE_VERSION_ONLY_STRING = "3.5.3dev";
const ARCHIVE_VERSION_STRING = "libarchive " ++ ARCHIVE_VERSION_ONLY_STRING;
const ARCHIVE_EOF = @as(c_int, 1);
const ARCHIVE_OK = @as(c_int, 0);
const ARCHIVE_RETRY = -@as(c_int, 10);
const ARCHIVE_WARN = -@as(c_int, 20);
const ARCHIVE_FAILED = -@as(c_int, 25);
const ARCHIVE_FATAL = -@as(c_int, 30);
const ARCHIVE_FILTER_NONE = @as(c_int, 0);
const ARCHIVE_FILTER_GZIP = @as(c_int, 1);
const ARCHIVE_FILTER_BZIP2 = @as(c_int, 2);
const ARCHIVE_FILTER_COMPRESS = @as(c_int, 3);
const ARCHIVE_FILTER_PROGRAM = @as(c_int, 4);
const ARCHIVE_FILTER_LZMA = @as(c_int, 5);
const ARCHIVE_FILTER_XZ = @as(c_int, 6);
const ARCHIVE_FILTER_UU = @as(c_int, 7);
const ARCHIVE_FILTER_RPM = @as(c_int, 8);
const ARCHIVE_FILTER_LZIP = @as(c_int, 9);
const ARCHIVE_FILTER_LRZIP = @as(c_int, 10);
const ARCHIVE_FILTER_LZOP = @as(c_int, 11);
const ARCHIVE_FILTER_GRZIP = @as(c_int, 12);
const ARCHIVE_FILTER_LZ4 = @as(c_int, 13);
const ARCHIVE_FILTER_ZSTD = @as(c_int, 14);
// Deprecated
// pub const ARCHIVE_COMPRESSION_NONE = ARCHIVE_FILTER_NONE;
// pub const ARCHIVE_COMPRESSION_GZIP = ARCHIVE_FILTER_GZIP;
// pub const ARCHIVE_COMPRESSION_BZIP2 = ARCHIVE_FILTER_BZIP2;
// pub const ARCHIVE_COMPRESSION_COMPRESS = ARCHIVE_FILTER_COMPRESS;
// pub const ARCHIVE_COMPRESSION_PROGRAM = ARCHIVE_FILTER_PROGRAM;
// pub const ARCHIVE_COMPRESSION_LZMA = ARCHIVE_FILTER_LZMA;
// pub const ARCHIVE_COMPRESSION_XZ = ARCHIVE_FILTER_XZ;
// pub const ARCHIVE_COMPRESSION_UU = ARCHIVE_FILTER_UU;
// pub const ARCHIVE_COMPRESSION_RPM = ARCHIVE_FILTER_RPM;
// pub const ARCHIVE_COMPRESSION_LZIP = ARCHIVE_FILTER_LZIP;
// pub const ARCHIVE_COMPRESSION_LRZIP = ARCHIVE_FILTER_LRZIP;
const ARCHIVE_FORMAT_BASE_MASK = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xff0000, .hexadecimal);
const ARCHIVE_FORMAT_CPIO = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000, .hexadecimal);
const ARCHIVE_FORMAT_CPIO_POSIX = ARCHIVE_FORMAT_CPIO | @as(c_int, 1);
const ARCHIVE_FORMAT_CPIO_BIN_LE = ARCHIVE_FORMAT_CPIO | @as(c_int, 2);
const ARCHIVE_FORMAT_CPIO_BIN_BE = ARCHIVE_FORMAT_CPIO | @as(c_int, 3);
const ARCHIVE_FORMAT_CPIO_SVR4_NOCRC = ARCHIVE_FORMAT_CPIO | @as(c_int, 4);
const ARCHIVE_FORMAT_CPIO_SVR4_CRC = ARCHIVE_FORMAT_CPIO | @as(c_int, 5);
const ARCHIVE_FORMAT_CPIO_AFIO_LARGE = ARCHIVE_FORMAT_CPIO | @as(c_int, 6);
const ARCHIVE_FORMAT_CPIO_PWB = ARCHIVE_FORMAT_CPIO | @as(c_int, 7);
const ARCHIVE_FORMAT_SHAR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x20000, .hexadecimal);
const ARCHIVE_FORMAT_SHAR_BASE = ARCHIVE_FORMAT_SHAR | @as(c_int, 1);
const ARCHIVE_FORMAT_SHAR_DUMP = ARCHIVE_FORMAT_SHAR | @as(c_int, 2);
const ARCHIVE_FORMAT_TAR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x30000, .hexadecimal);
const ARCHIVE_FORMAT_TAR_USTAR = ARCHIVE_FORMAT_TAR | @as(c_int, 1);
const ARCHIVE_FORMAT_TAR_PAX_INTERCHANGE = ARCHIVE_FORMAT_TAR | @as(c_int, 2);
const ARCHIVE_FORMAT_TAR_PAX_RESTRICTED = ARCHIVE_FORMAT_TAR | @as(c_int, 3);
const ARCHIVE_FORMAT_TAR_GNUTAR = ARCHIVE_FORMAT_TAR | @as(c_int, 4);
const ARCHIVE_FORMAT_ISO9660 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x40000, .hexadecimal);
const ARCHIVE_FORMAT_ISO9660_ROCKRIDGE = ARCHIVE_FORMAT_ISO9660 | @as(c_int, 1);
const ARCHIVE_FORMAT_ZIP = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x50000, .hexadecimal);
const ARCHIVE_FORMAT_EMPTY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x60000, .hexadecimal);
const ARCHIVE_FORMAT_AR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x70000, .hexadecimal);
const ARCHIVE_FORMAT_AR_GNU = ARCHIVE_FORMAT_AR | @as(c_int, 1);
const ARCHIVE_FORMAT_AR_BSD = ARCHIVE_FORMAT_AR | @as(c_int, 2);
const ARCHIVE_FORMAT_MTREE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x80000, .hexadecimal);
const ARCHIVE_FORMAT_RAW = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x90000, .hexadecimal);
const ARCHIVE_FORMAT_XAR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xA0000, .hexadecimal);
const ARCHIVE_FORMAT_LHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xB0000, .hexadecimal);
const ARCHIVE_FORMAT_CAB = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xC0000, .hexadecimal);
const ARCHIVE_FORMAT_RAR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xD0000, .hexadecimal);
const ARCHIVE_FORMAT_7ZIP = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xE0000, .hexadecimal);
const ARCHIVE_FORMAT_WARC = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xF0000, .hexadecimal);
const ARCHIVE_FORMAT_RAR_V5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x100000, .hexadecimal);
const ARCHIVE_READ_FORMAT_CAPS_NONE = @as(c_int, 0);
const ARCHIVE_READ_FORMAT_CAPS_ENCRYPT_DATA = @as(c_int, 1) << @as(c_int, 0);
const ARCHIVE_READ_FORMAT_CAPS_ENCRYPT_METADATA = @as(c_int, 1) << @as(c_int, 1);
const ARCHIVE_READ_FORMAT_ENCRYPTION_UNSUPPORTED = -@as(c_int, 2);
const ARCHIVE_READ_FORMAT_ENCRYPTION_DONT_KNOW = -@as(c_int, 1);
const ARCHIVE_EXTRACT_OWNER = @as(c_int, 0x0001);
const ARCHIVE_EXTRACT_PERM = @as(c_int, 0x0002);
const ARCHIVE_EXTRACT_TIME = @as(c_int, 0x0004);
const ARCHIVE_EXTRACT_NO_OVERWRITE = @as(c_int, 0x0008);
const ARCHIVE_EXTRACT_UNLINK = @as(c_int, 0x0010);
const ARCHIVE_EXTRACT_ACL = @as(c_int, 0x0020);
const ARCHIVE_EXTRACT_FFLAGS = @as(c_int, 0x0040);
const ARCHIVE_EXTRACT_XATTR = @as(c_int, 0x0080);
const ARCHIVE_EXTRACT_SECURE_SYMLINKS = @as(c_int, 0x0100);
const ARCHIVE_EXTRACT_SECURE_NODOTDOT = @as(c_int, 0x0200);
const ARCHIVE_EXTRACT_NO_AUTODIR = @as(c_int, 0x0400);
const ARCHIVE_EXTRACT_NO_OVERWRITE_NEWER = @as(c_int, 0x0800);
const ARCHIVE_EXTRACT_SPARSE = @as(c_int, 0x1000);
const ARCHIVE_EXTRACT_MAC_METADATA = @as(c_int, 0x2000);
const ARCHIVE_EXTRACT_NO_HFS_COMPRESSION = @as(c_int, 0x4000);
const ARCHIVE_EXTRACT_HFS_COMPRESSION_FORCED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x8000, .hexadecimal);
const ARCHIVE_EXTRACT_SECURE_NOABSOLUTEPATHS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000, .hexadecimal);
const ARCHIVE_EXTRACT_CLEAR_NOCHANGE_FFLAGS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x20000, .hexadecimal);
const ARCHIVE_EXTRACT_SAFE_WRITES = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x40000, .hexadecimal);
const ARCHIVE_READDISK_RESTORE_ATIME = @as(c_int, 0x0001);
const ARCHIVE_READDISK_HONOR_NODUMP = @as(c_int, 0x0002);
const ARCHIVE_READDISK_MAC_COPYFILE = @as(c_int, 0x0004);
const ARCHIVE_READDISK_NO_TRAVERSE_MOUNTS = @as(c_int, 0x0008);
const ARCHIVE_READDISK_NO_XATTR = @as(c_int, 0x0010);
const ARCHIVE_READDISK_NO_ACL = @as(c_int, 0x0020);
const ARCHIVE_READDISK_NO_FFLAGS = @as(c_int, 0x0040);
const ARCHIVE_MATCH_MTIME = @as(c_int, 0x0100);
const ARCHIVE_MATCH_CTIME = @as(c_int, 0x0200);
const ARCHIVE_MATCH_NEWER = @as(c_int, 0x0001);
const ARCHIVE_MATCH_OLDER = @as(c_int, 0x0002);
const ARCHIVE_MATCH_EQUAL = @as(c_int, 0x0010);

pub const Archive = opaque {
    pub const Result = enum(i32) {
        eof = ARCHIVE_EOF,
        ok = ARCHIVE_OK,
        retry = ARCHIVE_RETRY,
        warn = ARCHIVE_WARN,
        failed = ARCHIVE_FAILED,
        fatal = ARCHIVE_FATAL,
    };

    extern fn archive_version_number() c_int;
    pub fn versionNumber() i32 {
        return archive_version_number();
    }
    extern fn archive_version_string() [*c]const u8;
    pub fn versionString() []const u8 {
        return bun.sliceTo(archive_version_string(), 0);
    }
    extern fn archive_version_details() [*c]const u8;
    pub fn versionDetails() []const u8 {
        return bun.sliceTo(archive_version_details(), 0);
    }
    extern fn archive_zlib_version() [*c]const u8;
    pub fn zlibVersion() []const u8 {
        return bun.sliceTo(archive_zlib_version(), 0);
    }
    extern fn archive_liblzma_version() [*c]const u8;
    pub fn liblzmaVersion() []const u8 {
        return bun.sliceTo(archive_liblzma_version(), 0);
    }
    extern fn archive_bzlib_version() [*c]const u8;
    pub fn bzlibVersion() []const u8 {
        return bun.sliceTo(archive_bzlib_version(), 0);
    }
    extern fn archive_liblz4_version() [*c]const u8;
    pub fn liblz4Version() []const u8 {
        return bun.sliceTo(archive_liblz4_version(), 0);
    }
    extern fn archive_libzstd_version() [*c]const u8;
    pub fn libzstdVersion() []const u8 {
        return bun.sliceTo(archive_libzstd_version(), 0);
    }

    extern fn archive_error_string(*Archive) [*c]const u8;
    pub fn errorString(archive: *Archive) []const u8 {
        const err_str = archive_error_string(archive);
        if (err_str == null) return "";
        return bun.sliceTo(err_str, 0);
    }

    extern fn archive_write_new() *Archive;
    pub fn writeNew() *Archive {
        return archive_write_new();
    }

    extern fn archive_write_close(*Archive) Result;
    pub fn writeClose(archive: *Archive) Result {
        return archive_write_close(archive);
    }

    extern fn archive_write_finish(*Archive) Result;
    pub fn writeFinish(archive: *Archive) Result {
        return archive_write_finish(archive);
    }

    extern fn archive_free(*Archive) Result;
    pub fn free(archive: *Archive) Result {
        return archive_free(archive);
    }

    extern fn archive_write_set_options(_a: *Archive, opts: [*c]const u8) Result;
    pub fn writeSetOptions(archive: *Archive, opts: [:0]const u8) Result {
        return archive_write_set_options(archive, opts);
    }

    extern fn archive_write_set_format_pax_restricted(*Archive) Result;
    pub fn writeSetFormatPaxRestricted(archive: *Archive) Result {
        return archive_write_set_format_pax_restricted(archive);
    }

    extern fn archive_write_set_format_gnutar(*Archive) Result;
    pub fn writeSetFormatGnutar(archive: *Archive) Result {
        return archive_write_set_format_gnutar(archive);
    }

    extern fn archive_write_set_format_7zip(*Archive) Result;
    pub fn writeSetFormat7zip(archive: *Archive) Result {
        return archive_write_set_format_7zip(archive);
    }

    extern fn archive_write_set_format_pax(*Archive) Result;
    pub fn writeSetFormatPax(archive: *Archive) Result {
        return archive_write_set_format_pax(archive);
    }

    extern fn archive_write_set_format_ustar(*Archive) Result;
    pub fn writeSetFormatUstar(archive: *Archive) Result {
        return archive_write_set_format_ustar(archive);
    }

    extern fn archive_write_set_format_zip(*Archive) Result;
    pub fn writeSetFormatZip(archive: *Archive) Result {
        return archive_write_set_format_zip(archive);
    }

    extern fn archive_write_set_format_shar(*Archive) Result;
    pub fn writeSetFormatShar(archive: *Archive) Result {
        return archive_write_set_format_shar(archive);
    }

    extern fn archive_write_set_format(*struct_archive, format_code: i32) Result;
    pub fn writeSetFormat(archive: *Archive, format: Flags.Format) Result {
        return archive_write_set_format(archive, @intFromEnum(format));
    }

    // deprecated
    //
    // extern fn archive_write_set_compression_gzip(*Archive) Result;
    // pub fn writeSetCompressionGzip(archive: *Archive) Result {
    //     return archive_write_set_compression_gzip(archive);
    // }

    extern fn archive_write_add_filter_gzip(*Archive) Result;
    pub fn writeAddFilterGzip(archive: *Archive) Result {
        return archive_write_add_filter_gzip(archive);
    }

    extern fn archive_write_add_filter(*Archive, filter_code: i32) Result;
    pub fn writeAddFilter(archive: *Archive, filter: Flags.Filter) Result {
        return archive_write_add_filter(archive, @intFromEnum(filter));
    }
    extern fn archive_write_add_filter_by_name(*Archive, name: [*c]const u8) Result;
    pub fn writeAddFilterByName(archive: *Archive, name: [:0]const u8) Result {
        return archive_write_add_filter_by_name(archive, name.ptr);
    }
    extern fn archive_write_add_filter_b64encode(*Archive) Result;
    pub fn writeAddFilterB64encode(archive: *Archive) Result {
        return archive_write_add_filter_b64encode(archive);
    }
    // extern fn archive_write_add_filter_bzip2(*Archive) Result;
    // pub fn writeAddFilterBzip2(archive: *Archive) Result {
    //     return archive_write_add_filter_bzip2(archive);
    // }
    extern fn archive_write_add_filter_compress(*Archive) Result;
    pub fn writeAddFilterCompress(archive: *Archive) Result {
        return archive_write_add_filter_compress(archive);
    }
    extern fn archive_write_add_filter_grzip(*Archive) Result;
    pub fn writeAddFilterGrzip(archive: *Archive) Result {
        return archive_write_add_filter_grzip(archive);
    }
    extern fn archive_write_add_filter_lrzip(*Archive) Result;
    pub fn writeAddFilterLrzip(archive: *Archive) Result {
        return archive_write_add_filter_lrzip(archive);
    }
    extern fn archive_write_add_filter_lz4(*Archive) Result;
    pub fn writeAddFilterLz4(archive: *Archive) Result {
        return archive_write_add_filter_lz4(archive);
    }
    extern fn archive_write_add_filter_lzip(*Archive) Result;
    pub fn writeAddFilterLzip(archive: *Archive) Result {
        return archive_write_add_filter_lzip(archive);
    }
    extern fn archive_write_add_filter_lzma(*Archive) Result;
    pub fn writeAddFilterLzma(archive: *Archive) Result {
        return archive_write_add_filter_lzma(archive);
    }
    extern fn archive_write_add_filter_lzop(*Archive) Result;
    pub fn writeAddFilterLzop(archive: *Archive) Result {
        return archive_write_add_filter_lzop(archive);
    }
    extern fn archive_write_add_filter_none(*Archive) Result;
    pub fn writeAddFilterNone(archive: *Archive) Result {
        return archive_write_add_filter_none(archive);
    }
    extern fn archive_write_add_filter_uuencode(*Archive) Result;
    pub fn writeAddFilterUuencode(archive: *Archive) Result {
        return archive_write_add_filter_uuencode(archive);
    }
    extern fn archive_write_add_filter_xz(*Archive) Result;
    pub fn writeAddFilterXz(archive: *Archive) Result {
        return archive_write_add_filter_xz(archive);
    }
    extern fn archive_write_add_filter_zstd(*Archive) Result;
    pub fn writeAddFilterZstd(archive: *Archive) Result {
        return archive_write_add_filter_zstd(archive);
    }

    extern fn archive_write_set_filter_option(*Archive, [*c]const u8, [*c]const u8, [*c]const u8) Result;
    pub fn writeSetFilterOption(archive: *Archive, m: ?[:0]const u8, o: [:0]const u8, v: [:0]const u8) Result {
        return archive_write_set_filter_option(archive, m orelse null, o, v);
    }

    extern fn archive_write_open_filename(*Archive, [*c]const u8) Result;
    pub fn writeOpenFilename(archive: *Archive, filename: [:0]const u8) Result {
        return archive_write_open_filename(archive, filename);
    }

    extern fn archive_write_open_fd(*Archive, _fd: c_int) Result;
    pub fn writeOpenFd(archive: *Archive, fd: bun.FileDescriptor) Result {
        return archive_write_open_fd(archive, fd.cast());
    }

    extern fn archive_write_open_memory(*Archive, _buffer: ?*anyopaque, _buffSize: usize, _used: [*c]usize) Result;
    pub fn writeOpenMemory(archive: *Archive, buf: ?*anyopaque, buf_size: usize, used: *usize) Result {
        return archive_write_open_memory(archive, buf, buf_size, used);
    }

    extern fn archive_write_header(*Archive, *Entry) Result;
    pub fn writeHeader(archive: *Archive, entry: *Entry) Result {
        return archive_write_header(archive, entry);
    }

    extern fn archive_write_data(*Archive, ?*const anyopaque, usize) isize;
    pub fn writeData(archive: *Archive, data: []const u8) isize {
        return archive_write_data(archive, data.ptr, data.len);
    }

    extern fn archive_write_finish_entry(*Archive) Result;
    pub fn writeFinishEntry(archive: *Archive) Result {
        return archive_write_finish_entry(archive);
    }

    extern fn archive_write_free(*Archive) Result;
    pub fn writeFree(archive: *Archive) Result {
        return archive_write_free(archive);
    }

    extern fn archive_read_new() *Archive;
    pub fn readNew() *Archive {
        return archive_read_new();
    }

    extern fn archive_read_close(*Archive) Result;
    pub fn readClose(archive: *Archive) Result {
        return archive_read_close(archive);
    }

    pub extern fn archive_read_free(*Archive) Result;
    pub fn readFree(archive: *Archive) Result {
        return archive_read_free(archive);
    }

    pub extern fn archive_read_finish(*Archive) Result;
    pub fn readFinish(archive: *Archive) Result {
        return archive_read_finish(archive);
    }

    // these are deprecated
    //
    // extern fn archive_read_support_compression_all(*Archive) Result;
    // pub fn readSupportCompressionAll(archive: *Archive) Result {
    //     return archive_read_support_compression_all(archive);
    // }
    // extern fn archive_read_support_compression_bzip2(*Archive) Result;
    // pub fn readSupportCompressionBzip2(archive: *Archive) Result {
    //     return archive_read_support_compression_bzip2(archive);
    // }
    // extern fn archive_read_support_compression_compress(*Archive) Result;
    // pub fn readSupportCompressionCompress(archive: *Archive) Result {
    //     return archive_read_support_compression_compress(archive);
    // }
    // extern fn archive_read_support_compression_gzip(*Archive) Result;
    // pub fn readSupportCompressionGzip(archive: *Archive) Result {
    //     return archive_read_support_compression_gzip(archive);
    // }
    // extern fn archive_read_support_compression_lzip(*Archive) Result;
    // pub fn readSupportCompressionLzip(archive: *Archive) Result {
    //     return archive_read_support_compression_lzip(archive);
    // }
    // extern fn archive_read_support_compression_lzma(*Archive) Result;
    // pub fn readSupportCompressionLzma(archive: *Archive) Result {
    //     return archive_read_support_compression_lzma(archive);
    // }
    // extern fn archive_read_support_compression_none(*Archive) Result;
    // pub fn readSupportCompressionNone(archive: *Archive) Result {
    //     return archive_read_support_compression_none(archive);
    // }
    // extern fn archive_read_support_compression_rpm(*Archive) Result;
    // pub fn readSupportCompressionRpm(archive: *Archive) Result {
    //     return archive_read_support_compression_rpm(archive);
    // }
    // extern fn archive_read_support_compression_uu(*Archive) Result;
    // pub fn readSupportCompressionUu(archive: *Archive) Result {
    //     return archive_read_support_compression_uu(archive);
    // }
    // extern fn archive_read_support_compression_xz(*Archive) Result;
    // pub fn readSupportCompressionXz(archive: *Archive) Result {
    //     return archive_read_support_compression_xz(archive);
    // }

    extern fn archive_read_support_format_7zip(*Archive) Result;
    pub fn readSupportFormat7zip(archive: *Archive) Result {
        return archive_read_support_format_7zip(archive);
    }
    extern fn archive_read_support_format_all(*Archive) Result;
    pub fn readSupportFormatAll(archive: *Archive) Result {
        return archive_read_support_format_all(archive);
    }
    extern fn archive_read_support_format_ar(*Archive) Result;
    pub fn readSupportFormatAr(archive: *Archive) Result {
        return archive_read_support_format_ar(archive);
    }
    extern fn archive_read_support_format_by_code(*Archive, c_int) Result;
    pub fn readSupportFormatByCode(archive: *Archive, code: i32) Result {
        return archive_read_support_format_by_code(archive, code);
    }
    extern fn archive_read_support_format_cab(*Archive) Result;
    pub fn readSupportFormatCab(archive: *Archive) Result {
        return archive_read_support_format_cab(archive);
    }
    extern fn archive_read_support_format_cpio(*Archive) Result;
    pub fn readSupportFormatCpio(archive: *Archive) Result {
        return archive_read_support_format_cpio(archive);
    }
    extern fn archive_read_support_format_empty(*Archive) Result;
    pub fn readSupportFormatEmpty(archive: *Archive) Result {
        return archive_read_support_format_empty(archive);
    }
    extern fn archive_read_support_format_gnutar(*Archive) Result;
    pub fn readSupportFormatGnutar(archive: *Archive) Result {
        return archive_read_support_format_gnutar(archive);
    }
    extern fn archive_read_support_format_iso9660(*Archive) Result;
    pub fn readSupportFormatIso9660(archive: *Archive) Result {
        return archive_read_support_format_iso9660(archive);
    }
    extern fn archive_read_support_format_lha(*Archive) Result;
    pub fn readSupportFormatLha(archive: *Archive) Result {
        return archive_read_support_format_lha(archive);
    }
    extern fn archive_read_support_format_mtree(*Archive) Result;
    pub fn readSupportFormatMtree(archive: *Archive) Result {
        return archive_read_support_format_mtree(archive);
    }
    extern fn archive_read_support_format_rar(*Archive) Result;
    pub fn readSupportFormatRar(archive: *Archive) Result {
        return archive_read_support_format_rar(archive);
    }
    extern fn archive_read_support_format_rar5(*Archive) Result;
    pub fn readSupportFormatRar5(archive: *Archive) Result {
        return archive_read_support_format_rar5(archive);
    }
    extern fn archive_read_support_format_raw(*Archive) Result;
    pub fn readSupportFormatRaw(archive: *Archive) Result {
        return archive_read_support_format_raw(archive);
    }
    extern fn archive_read_support_format_tar(*Archive) Result;
    pub fn readSupportFormatTar(archive: *Archive) Result {
        return archive_read_support_format_tar(archive);
    }
    extern fn archive_read_support_format_warc(*Archive) Result;
    pub fn readSupportFormatWarc(archive: *Archive) Result {
        return archive_read_support_format_warc(archive);
    }
    extern fn archive_read_support_format_xar(*Archive) Result;
    pub fn readSupportFormatXar(archive: *Archive) Result {
        return archive_read_support_format_xar(archive);
    }
    extern fn archive_read_support_format_zip(*Archive) Result;
    pub fn readSupportFormatZip(archive: *Archive) Result {
        return archive_read_support_format_zip(archive);
    }
    extern fn archive_read_support_format_zip_streamable(*Archive) Result;
    pub fn readSupportFormatZipStreamable(archive: *Archive) Result {
        return archive_read_support_format_zip_streamable(archive);
    }
    extern fn archive_read_support_format_zip_seekable(*Archive) Result;
    pub fn readSupportFormatZipSeekable(archive: *Archive) Result {
        return archive_read_support_format_zip_seekable(archive);
    }

    extern fn archive_read_set_options(*Archive, [*c]const u8) Result;
    pub fn readSetOptions(archive: *Archive, opts: [:0]const u8) Result {
        return archive_read_set_options(archive, opts.ptr);
    }

    extern fn archive_read_open_memory(*Archive, ?*const anyopaque, usize) Result;
    pub fn readOpenMemory(archive: *Archive, buf: []const u8) Result {
        return archive_read_open_memory(archive, buf.ptr, buf.len);
    }

    extern fn archive_read_next_header(*Archive, **Entry) Result;
    pub fn readNextHeader(archive: *Archive, entry: **Entry) Result {
        return archive_read_next_header(archive, entry);
    }
    extern fn archive_read_next_header2(*Archive, *Entry) Result;
    pub fn readNextHeader2(archive: *Archive, entry: *Entry) Result {
        return archive_read_next_header2(archive, entry);
    }

    extern fn archive_read_data(*Archive, ?*anyopaque, usize) isize;
    pub fn readData(archive: *Archive, buf: []u8) isize {
        return archive_read_data(archive, buf.ptr, buf.len);
    }
    extern fn archive_read_data_into_fd(*Archive, fd: c_int) Result;
    pub fn readDataIntoFd(archive: *Archive, fd: c_int) Result {
        return archive_read_data_into_fd(archive, fd);
    }

    extern fn archive_read_support_filter_all(*Archive) Result;
    pub fn readSupportFilterAll(archive: *Archive) Result {
        return archive_read_support_filter_all(archive);
    }
    extern fn archive_read_support_filter_by_code(*Archive, c_int) Result;
    pub fn readSupportFilterByCode(archive: *Archive, code: i32) Result {
        return archive_read_support_filter_by_code(archive, code);
    }
    // extern fn archive_read_support_filter_bzip2(*Archive) Result;
    // pub fn readSupportFilterbZip2(archive: *Archive) Result {
    //     return archive_read_support_filter_bzip2(archive);
    // }
    extern fn archive_read_support_filter_compress(*Archive) Result;
    pub fn readSupportFilterCompress(archive: *Archive) Result {
        return archive_read_support_filter_compress(archive);
    }
    extern fn archive_read_support_filter_gzip(*Archive) Result;
    pub fn readSupportFilterGzip(archive: *Archive) Result {
        return archive_read_support_filter_gzip(archive);
    }
    extern fn archive_read_support_filter_grzip(*Archive) Result;
    pub fn readSupportFilterGrzip(archive: *Archive) Result {
        return archive_read_support_filter_grzip(archive);
    }
    extern fn archive_read_support_filter_lrzip(*Archive) Result;
    pub fn readSupportFilterLrzip(archive: *Archive) Result {
        return archive_read_support_filter_lrzip(archive);
    }
    extern fn archive_read_support_filter_lz4(*Archive) Result;
    pub fn readSupportFilterLz4(archive: *Archive) Result {
        return archive_read_support_filter_lz4(archive);
    }
    extern fn archive_read_support_filter_lzip(*Archive) Result;
    pub fn readSupportFilterLzip(archive: *Archive) Result {
        return archive_read_support_filter_lzip(archive);
    }
    extern fn archive_read_support_filter_lzma(*Archive) Result;
    pub fn readSupportFilterLzma(archive: *Archive) Result {
        return archive_read_support_filter_lzma(archive);
    }
    extern fn archive_read_support_filter_lzop(*Archive) Result;
    pub fn readSupportFilterLzop(archive: *Archive) Result {
        return archive_read_support_filter_lzop(archive);
    }
    extern fn archive_read_support_filter_none(*Archive) Result;
    pub fn readSupportFilterNone(archive: *Archive) Result {
        return archive_read_support_filter_none(archive);
    }
    extern fn archive_read_support_filter_rpm(*Archive) Result;
    pub fn readSupportFilterRpm(archive: *Archive) Result {
        return archive_read_support_filter_rpm(archive);
    }
    extern fn archive_read_support_filter_uu(*Archive) Result;
    pub fn readSupportFilterUu(archive: *Archive) Result {
        return archive_read_support_filter_uu(archive);
    }
    extern fn archive_read_support_filter_xz(*Archive) Result;
    pub fn readSupportFilterXz(archive: *Archive) Result {
        return archive_read_support_filter_xz(archive);
    }
    extern fn archive_read_support_filter_zstd(*Archive) Result;
    pub fn readSupportFilterZstd(archive: *Archive) Result {
        return archive_read_support_filter_zstd(archive);
    }

    pub const Entry = opaque {
        extern fn archive_entry_new() *Entry;
        pub fn new() *Entry {
            return archive_entry_new();
        }

        extern fn archive_entry_new2(*Archive) *Entry;
        pub fn new2(archive: *Archive) *Entry {
            return archive_entry_new2(archive);
        }

        extern fn archive_entry_free(*Entry) void;
        pub fn free(entry: *Entry) void {
            archive_entry_free(entry);
        }

        extern fn archive_entry_set_pathname(*Entry, [*c]const u8) void;
        pub fn setPathname(entry: *Entry, name: [:0]const u8) void {
            archive_entry_set_pathname(entry, name);
        }

        extern fn archive_entry_set_pathname_utf8(*Entry, [*c]const u8) void;
        pub fn setPathnameUtf8(entry: *Entry, name: [:0]const u8) void {
            archive_entry_set_pathname_utf8(entry, name);
        }

        extern fn archive_entry_copy_pathname(*Entry, [*c]const u8) void;
        pub fn copyPathname(entry: *Entry, name: [:0]const u8) void {
            return archive_entry_copy_pathname(entry, name);
        }

        extern fn archive_entry_copy_pathname_w(*Entry, [*c]const u16) void;
        pub fn copyPathnameW(entry: *Entry, name: [:0]const u16) void {
            return archive_entry_copy_pathname_w(entry, name);
        }

        extern fn archive_entry_set_size(*Entry, i64) void;
        pub fn setSize(entry: *Entry, s: i64) void {
            archive_entry_set_size(entry, s);
        }

        extern fn archive_entry_set_filetype(*Entry, c_uint) void;
        pub fn setFiletype(entry: *Entry, @"type": u32) void {
            archive_entry_set_filetype(entry, @"type");
        }

        extern fn archive_entry_set_perm(*Entry, bun.Mode) void;
        pub fn setPerm(entry: *Entry, p: bun.Mode) void {
            archive_entry_set_perm(entry, p);
        }

        extern fn archive_entry_set_mode(*Entry, bun.Mode) void;
        pub fn setMode(entry: *Entry, mode: bun.Mode) void {
            archive_entry_set_mode(entry, mode);
        }

        extern fn archive_entry_set_mtime(*Entry, isize, c_long) void;
        pub fn setMtime(entry: *Entry, secs: isize, nsecs: c_long) void {
            archive_entry_set_mtime(entry, secs, nsecs);
        }

        extern fn archive_entry_clear(*Entry) *Entry;
        pub fn clear(entry: *Entry) *Entry {
            return archive_entry_clear(entry);
        }

        extern fn archive_entry_pathname(*Entry) [*c]const u8;
        pub fn pathname(entry: *Entry) [:0]const u8 {
            return bun.sliceTo(archive_entry_pathname(entry), 0);
        }
        extern fn archive_entry_pathname_utf8(*Entry) [*c]const u8;
        pub fn pathnameUtf8(entry: *Entry) [:0]const u8 {
            return bun.sliceTo(archive_entry_pathname_utf8(entry), 0);
        }
        extern fn archive_entry_pathname_w(*Entry) [*c]const u16;
        pub fn pathnameW(entry: *Entry) [:0]const u16 {
            return bun.sliceTo(archive_entry_pathname_w(entry), 0);
        }
        extern fn archive_entry_filetype(*Entry) bun.Mode;
        pub fn filetype(entry: *Entry) bun.Mode {
            return archive_entry_filetype(entry);
        }
        extern fn archive_entry_perm(*Entry) bun.Mode;
        pub fn perm(entry: *Entry) bun.Mode {
            return archive_entry_perm(entry);
        }
        extern fn archive_entry_size(*Entry) i64;
        pub fn size(entry: *Entry) i64 {
            return archive_entry_size(entry);
        }
        extern fn archive_entry_symlink(*Entry) [*c]const u8;
        pub fn symlink(entry: *Entry) [:0]const u8 {
            return bun.sliceTo(archive_entry_symlink(entry), 0);
        }
        pub extern fn archive_entry_symlink_utf8(*Entry) [*c]const u8;
        pub fn symlinkUtf8(entry: *Entry) [:0]const u8 {
            return bun.sliceTo(archive_entry_symlink_utf8(entry), 0);
        }
        pub extern fn archive_entry_symlink_type(*Entry) SymlinkType;
        pub fn symlinkType(entry: *Entry) SymlinkType {
            return archive_entry_symlink_type(entry);
        }
        pub extern fn archive_entry_symlink_w(*Entry) [*c]const u16;
        pub fn symlinkW(entry: *Entry) [:0]const u16 {
            return bun.sliceTo(archive_entry_symlink_w(entry), 0);
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

                pub fn err(arch: *Archive, msg: []const u8) @This() {
                    return .{ .err = .{ .message = msg, .archive = arch } };
                }

                pub fn res(value: T) @This() {
                    return .{ .result = value };
                }
            };
        }

        pub fn init(tarball_bytes: []const u8) Iterator.Result(@This()) {
            const Return = Iterator.Result(@This());

            const archive = Archive.readNew();

            switch (archive.readSupportFormatTar()) {
                .failed, .fatal, .warn => {
                    return Return.err(archive, "failed to enable tar format support");
                },
                else => {},
            }
            switch (archive.readSupportFormatGnutar()) {
                .failed, .fatal, .warn => {
                    return Return.err(archive, "failed to enable gnutar format support");
                },
                else => {},
            }
            switch (archive.readSupportFilterGzip()) {
                .failed, .fatal, .warn => {
                    return Return.err(archive, "failed to enable support for gzip compression");
                },
                else => {},
            }

            switch (archive.readSetOptions("read_concatenated_archives")) {
                .failed, .fatal, .warn => {
                    return Return.err(archive, "failed to set option `read_concatenated_archives`");
                },
                else => {},
            }

            switch (archive.readOpenMemory(tarball_bytes)) {
                .failed, .fatal, .warn => {
                    return Return.err(archive, "failed to read tarball");
                },
                else => {},
            }

            return Return.res(.{
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
                if (size < 0) return Return.err(archive, "invalid archive entry size");

                const buf = try allocator.alloc(u8, @intCast(size));

                const read = archive.readData(buf);
                if (read < 0) {
                    return Return.err(archive, "failed to read archive data");
                }
                return Return.res(buf[0..@intCast(read)]);
            }
        };

        pub fn next(this: *@This()) Iterator.Result(?NextEntry) {
            const Return = Iterator.Result(?NextEntry);

            var entry: *Archive.Entry = undefined;
            while (true) {
                return switch (this.archive.readNextHeader(&entry)) {
                    .retry => continue,
                    .eof => Return.res(null),
                    .ok => {
                        const kind = bun.C.kindFromMode(entry.filetype());

                        if (this.filter.contains(kind)) continue;

                        return Return.res(.{
                            .entry = entry,
                            .kind = kind,
                        });
                    },
                    else => Return.err(this.archive, "failed to read archive header"),
                };
            }
        }

        pub fn deinit(this: *@This()) Iterator.Result(void) {
            const Return = Iterator.Result(void);

            switch (this.archive.readClose()) {
                .failed, .fatal, .warn => {
                    return Return.err(this.archive, "failed to close archive read");
                },
                else => {},
            }
            switch (this.archive.readFree()) {
                .failed, .fatal, .warn => {
                    return Return.err(this.archive, "failed to free archive read");
                },
                else => {},
            }

            return Return.res({});
        }
    };
};

pub const archive_read_callback = *const fn (*struct_archive, *anyopaque, [*c]*const anyopaque) callconv(.C) la_ssize_t;
pub const archive_skip_callback = *const fn (*struct_archive, *anyopaque, la_int64_t) callconv(.C) la_int64_t;
pub const archive_seek_callback = *const fn (*struct_archive, *anyopaque, la_int64_t, c_int) callconv(.C) la_int64_t;
pub const archive_write_callback = *const fn (*struct_archive, *anyopaque, ?*const anyopaque, usize) callconv(.C) la_ssize_t;
pub const archive_open_callback = *const fn (*struct_archive, *anyopaque) callconv(.C) c_int;
pub const archive_close_callback = *const fn (*struct_archive, *anyopaque) callconv(.C) c_int;
pub const archive_free_callback = *const fn (*struct_archive, *anyopaque) callconv(.C) c_int;
pub const archive_switch_callback = *const fn (*struct_archive, *anyopaque, ?*anyopaque) callconv(.C) c_int;
pub const archive_passphrase_callback = *const fn (*struct_archive, *anyopaque) callconv(.C) [*c]const u8;
pub extern fn archive_read_support_compression_program(*struct_archive, command: [*c]const u8) c_int;
pub extern fn archive_read_support_compression_program_signature(*struct_archive, [*c]const u8, ?*const anyopaque, usize) c_int;
pub extern fn archive_read_support_filter_program(*struct_archive, command: [*c]const u8) c_int;
pub extern fn archive_read_support_filter_program_signature(*struct_archive, [*c]const u8, ?*const anyopaque, usize) c_int;
pub extern fn archive_read_set_format(*struct_archive, c_int) c_int;
pub extern fn archive_read_append_filter(*struct_archive, c_int) c_int;
pub extern fn archive_read_append_filter_program(*struct_archive, [*c]const u8) c_int;
pub extern fn archive_read_append_filter_program_signature(*struct_archive, [*c]const u8, ?*const anyopaque, usize) c_int;
pub extern fn archive_read_set_open_callback(*struct_archive, ?archive_open_callback) c_int;
pub extern fn archive_read_set_read_callback(*struct_archive, ?archive_read_callback) c_int;
pub extern fn archive_read_set_seek_callback(*struct_archive, ?archive_seek_callback) c_int;
pub extern fn archive_read_set_skip_callback(*struct_archive, ?archive_skip_callback) c_int;
pub extern fn archive_read_set_close_callback(*struct_archive, ?archive_close_callback) c_int;
pub extern fn archive_read_set_switch_callback(*struct_archive, ?archive_switch_callback) c_int;
pub extern fn archive_read_set_callback_data(*struct_archive, ?*anyopaque) c_int;
pub extern fn archive_read_set_callback_data2(*struct_archive, ?*anyopaque, c_uint) c_int;
pub extern fn archive_read_add_callback_data(*struct_archive, ?*anyopaque, c_uint) c_int;
pub extern fn archive_read_append_callback_data(*struct_archive, ?*anyopaque) c_int;
pub extern fn archive_read_prepend_callback_data(*struct_archive, ?*anyopaque) c_int;
pub extern fn archive_read_open1(*struct_archive) c_int;
pub extern fn archive_read_open(*struct_archive, _client_data: ?*anyopaque, ?archive_open_callback, ?archive_read_callback, ?archive_close_callback) c_int;
pub extern fn archive_read_open2(*struct_archive, _client_data: ?*anyopaque, ?archive_open_callback, ?archive_read_callback, ?archive_skip_callback, ?archive_close_callback) c_int;
pub extern fn archive_read_open_filename(*struct_archive, _filename: [*c]const u8, _block_size: usize) c_int;
pub extern fn archive_read_open_filenames(*struct_archive, _filenames: [*c][*c]const u8, _block_size: usize) c_int;
pub extern fn archive_read_open_filename_w(*struct_archive, _filename: [*c]const wchar_t, _block_size: usize) c_int;
pub extern fn archive_read_open_file(*struct_archive, _filename: [*c]const u8, _block_size: usize) c_int;
pub extern fn archive_read_open_memory2(a: *struct_archive, buff: ?*const anyopaque, size: usize, read_size: usize) c_int;
pub extern fn archive_read_open_fd(*struct_archive, _fd: c_int, _block_size: usize) c_int;
pub extern fn archive_read_open_FILE(*struct_archive, _file: [*c]FILE) c_int;
pub extern fn archive_read_header_position(*struct_archive) la_int64_t;
pub extern fn archive_read_has_encrypted_entries(*struct_archive) c_int;
pub extern fn archive_read_format_capabilities(*struct_archive) c_int;
pub extern fn archive_seek_data(*struct_archive, la_int64_t, c_int) la_int64_t;
pub extern fn archive_read_data_block(a: *struct_archive, buff: [*c]*const anyopaque, size: [*c]usize, offset: [*c]la_int64_t) c_int;
pub extern fn archive_read_data_skip(*struct_archive) c_int;
pub extern fn archive_read_set_format_option(_a: *struct_archive, m: [*c]const u8, o: [*c]const u8, v: [*c]const u8) c_int;
pub extern fn archive_read_set_filter_option(_a: *struct_archive, m: [*c]const u8, o: [*c]const u8, v: [*c]const u8) c_int;
pub extern fn archive_read_add_passphrase(*struct_archive, [*c]const u8) c_int;
pub extern fn archive_read_set_passphrase_callback(*struct_archive, client_data: ?*anyopaque, ?archive_passphrase_callback) c_int;
pub extern fn archive_read_extract(*struct_archive, *struct_archive_entry, flags: c_int) c_int;
pub extern fn archive_read_extract2(*struct_archive, *struct_archive_entry, *struct_archive) c_int;
pub extern fn archive_read_extract_set_progress_callback(*struct_archive, _progress_func: ?*const fn (?*anyopaque) callconv(.C) void, _user_data: ?*anyopaque) void;
pub extern fn archive_read_extract_set_skip_file(*struct_archive, la_int64_t, la_int64_t) void;
pub extern fn archive_write_set_bytes_per_block(*struct_archive, bytes_per_block: c_int) c_int;
pub extern fn archive_write_get_bytes_per_block(*struct_archive) c_int;
pub extern fn archive_write_set_bytes_in_last_block(*struct_archive, bytes_in_last_block: c_int) c_int;
pub extern fn archive_write_get_bytes_in_last_block(*struct_archive) c_int;
pub extern fn archive_write_set_skip_file(*struct_archive, la_int64_t, la_int64_t) c_int;
// Deprecated
// pub extern fn archive_write_set_compression_bzip2(*struct_archive) c_int;
// pub extern fn archive_write_set_compression_compress(*struct_archive) c_int;
// pub extern fn archive_write_set_compression_lzip(*struct_archive) c_int;
// pub extern fn archive_write_set_compression_lzma(*struct_archive) c_int;
// pub extern fn archive_write_set_compression_none(*struct_archive) c_int;
// pub extern fn archive_write_set_compression_program(*struct_archive, cmd: [*c]const u8) c_int;
// pub extern fn archive_write_set_compression_xz(*struct_archive) c_int;
pub extern fn archive_write_set_format_by_name(*struct_archive, name: [*c]const u8) c_int;
pub extern fn archive_write_set_format_ar_bsd(*struct_archive) c_int;
pub extern fn archive_write_set_format_ar_svr4(*struct_archive) c_int;
pub extern fn archive_write_set_format_cpio(*struct_archive) c_int;
pub extern fn archive_write_set_format_cpio_bin(*struct_archive) c_int;
pub extern fn archive_write_set_format_cpio_newc(*struct_archive) c_int;
pub extern fn archive_write_set_format_cpio_odc(*struct_archive) c_int;
pub extern fn archive_write_set_format_cpio_pwb(*struct_archive) c_int;
pub extern fn archive_write_set_format_iso9660(*struct_archive) c_int;
pub extern fn archive_write_set_format_mtree(*struct_archive) c_int;
pub extern fn archive_write_set_format_mtree_classic(*struct_archive) c_int;
pub extern fn archive_write_set_format_raw(*struct_archive) c_int;
pub extern fn archive_write_set_format_shar_dump(*struct_archive) c_int;
pub extern fn archive_write_set_format_v7tar(*struct_archive) c_int;
pub extern fn archive_write_set_format_warc(*struct_archive) c_int;
pub extern fn archive_write_set_format_xar(*struct_archive) c_int;
pub extern fn archive_write_set_format_filter_by_ext(a: *struct_archive, filename: [*c]const u8) c_int;
pub extern fn archive_write_set_format_filter_by_ext_def(a: *struct_archive, filename: [*c]const u8, def_ext: [*c]const u8) c_int;
pub extern fn archive_write_zip_set_compression_deflate(*struct_archive) c_int;
pub extern fn archive_write_zip_set_compression_store(*struct_archive) c_int;
pub extern fn archive_write_open(*struct_archive, ?*anyopaque, ?archive_open_callback, ?archive_write_callback, ?archive_close_callback) c_int;
pub extern fn archive_write_open2(*struct_archive, ?*anyopaque, ?archive_open_callback, ?archive_write_callback, ?archive_close_callback, ?archive_free_callback) c_int;
pub extern fn archive_write_open_filename_w(*struct_archive, _file: [*c]const wchar_t) c_int;
pub extern fn archive_write_open_file(*struct_archive, _file: [*c]const u8) c_int;
pub extern fn archive_write_open_FILE(*struct_archive, [*c]FILE) c_int;
pub extern fn archive_write_data_block(*struct_archive, ?*const anyopaque, usize, la_int64_t) la_ssize_t;
pub extern fn archive_write_fail(*struct_archive) c_int;
pub extern fn archive_write_set_format_option(_a: *struct_archive, m: [*c]const u8, o: [*c]const u8, v: [*c]const u8) c_int;
pub extern fn archive_write_set_option(_a: *struct_archive, m: [*c]const u8, o: [*c]const u8, v: [*c]const u8) c_int;
pub extern fn archive_write_set_passphrase(_a: *struct_archive, p: [*c]const u8) c_int;
pub extern fn archive_write_set_passphrase_callback(*struct_archive, client_data: ?*anyopaque, ?archive_passphrase_callback) c_int;
pub extern fn archive_write_disk_new() *struct_archive;
pub extern fn archive_write_disk_set_skip_file(*struct_archive, la_int64_t, la_int64_t) c_int;
pub extern fn archive_write_disk_set_options(*struct_archive, flags: c_int) c_int;
pub extern fn archive_write_disk_set_standard_lookup(*struct_archive) c_int;
pub extern fn archive_write_disk_set_group_lookup(*struct_archive, ?*anyopaque, ?*const fn (?*anyopaque, [*c]const u8, la_int64_t) callconv(.C) la_int64_t, ?*const fn (?*anyopaque) callconv(.C) void) c_int;
pub extern fn archive_write_disk_set_user_lookup(*struct_archive, ?*anyopaque, ?*const fn (?*anyopaque, [*c]const u8, la_int64_t) callconv(.C) la_int64_t, ?*const fn (?*anyopaque) callconv(.C) void) c_int;
pub extern fn archive_write_disk_gid(*struct_archive, [*c]const u8, la_int64_t) la_int64_t;
pub extern fn archive_write_disk_uid(*struct_archive, [*c]const u8, la_int64_t) la_int64_t;
pub extern fn archive_read_disk_new() *struct_archive;
pub extern fn archive_read_disk_set_symlink_logical(*struct_archive) c_int;
pub extern fn archive_read_disk_set_symlink_physical(*struct_archive) c_int;
pub extern fn archive_read_disk_set_symlink_hybrid(*struct_archive) c_int;
pub extern fn archive_read_disk_entry_from_file(*struct_archive, *struct_archive_entry, c_int, [*c]const struct_stat) c_int;
pub extern fn archive_read_disk_gname(*struct_archive, la_int64_t) [*c]const u8;
pub extern fn archive_read_disk_uname(*struct_archive, la_int64_t) [*c]const u8;
pub extern fn archive_read_disk_set_standard_lookup(*struct_archive) c_int;
pub extern fn archive_read_disk_set_gname_lookup(*struct_archive, ?*anyopaque, ?*const fn (?*anyopaque, la_int64_t) callconv(.C) [*c]const u8, ?*const fn (?*anyopaque) callconv(.C) void) c_int;
pub extern fn archive_read_disk_set_uname_lookup(*struct_archive, ?*anyopaque, ?*const fn (?*anyopaque, la_int64_t) callconv(.C) [*c]const u8, ?*const fn (?*anyopaque) callconv(.C) void) c_int;
pub extern fn archive_read_disk_open(*struct_archive, [*c]const u8) c_int;
pub extern fn archive_read_disk_open_w(*struct_archive, [*c]const wchar_t) c_int;
pub extern fn archive_read_disk_descend(*struct_archive) c_int;
pub extern fn archive_read_disk_can_descend(*struct_archive) c_int;
pub extern fn archive_read_disk_current_filesystem(*struct_archive) c_int;
pub extern fn archive_read_disk_current_filesystem_is_synthetic(*struct_archive) c_int;
pub extern fn archive_read_disk_current_filesystem_is_remote(*struct_archive) c_int;
pub extern fn archive_read_disk_set_atime_restored(*struct_archive) c_int;
pub extern fn archive_read_disk_set_behavior(*struct_archive, flags: c_int) c_int;
pub extern fn archive_read_disk_set_matching(*struct_archive, _matching: *struct_archive, _excluded_func: ?*const fn (*struct_archive, ?*anyopaque, *struct_archive_entry) callconv(.C) void, _client_data: ?*anyopaque) c_int;
pub extern fn archive_read_disk_set_metadata_filter_callback(*struct_archive, _metadata_filter_func: ?*const fn (*struct_archive, ?*anyopaque, *struct_archive_entry) callconv(.C) c_int, _client_data: ?*anyopaque) c_int;
pub extern fn archive_filter_count(*struct_archive) c_int;
pub extern fn archive_filter_bytes(*struct_archive, c_int) la_int64_t;
pub extern fn archive_filter_code(*struct_archive, c_int) c_int;
pub extern fn archive_filter_name(*struct_archive, c_int) [*c]const u8;
pub extern fn archive_position_compressed(*struct_archive) la_int64_t;
pub extern fn archive_position_uncompressed(*struct_archive) la_int64_t;
pub extern fn archive_compression_name(*struct_archive) [*c]const u8;
pub extern fn archive_compression(*struct_archive) c_int;
pub extern fn archive_errno(*struct_archive) c_int;
pub extern fn archive_format_name(*struct_archive) [*c]const u8;
pub extern fn archive_format(*struct_archive) c_int;
pub extern fn archive_clear_error(*struct_archive) void;
pub extern fn archive_set_error(*struct_archive, _err: c_int, fmt: [*c]const u8, ...) void;
pub extern fn archive_copy_error(dest: *struct_archive, src: *struct_archive) void;
pub extern fn archive_file_count(*struct_archive) c_int;
pub extern fn archive_match_new() *struct_archive;
pub extern fn archive_match_free(*struct_archive) c_int;
pub extern fn archive_match_excluded(*struct_archive, *struct_archive_entry) c_int;
pub extern fn archive_match_path_excluded(*struct_archive, *struct_archive_entry) c_int;
pub extern fn archive_match_set_inclusion_recursion(*struct_archive, c_int) c_int;
pub extern fn archive_match_exclude_pattern(*struct_archive, [*c]const u8) c_int;
pub extern fn archive_match_exclude_pattern_w(*struct_archive, [*c]const wchar_t) c_int;
pub extern fn archive_match_exclude_pattern_from_file(*struct_archive, [*c]const u8, _nullSeparator: c_int) c_int;
pub extern fn archive_match_exclude_pattern_from_file_w(*struct_archive, [*c]const wchar_t, _nullSeparator: c_int) c_int;
pub extern fn archive_match_include_pattern(*struct_archive, [*c]const u8) c_int;
pub extern fn archive_match_include_pattern_w(*struct_archive, [*c]const wchar_t) c_int;
pub extern fn archive_match_include_pattern_from_file(*struct_archive, [*c]const u8, _nullSeparator: c_int) c_int;
pub extern fn archive_match_include_pattern_from_file_w(*struct_archive, [*c]const wchar_t, _nullSeparator: c_int) c_int;
pub extern fn archive_match_path_unmatched_inclusions(*struct_archive) c_int;
pub extern fn archive_match_path_unmatched_inclusions_next(*struct_archive, [*c][*c]const u8) c_int;
pub extern fn archive_match_path_unmatched_inclusions_next_w(*struct_archive, [*c][*c]const wchar_t) c_int;
pub extern fn archive_match_time_excluded(*struct_archive, *struct_archive_entry) c_int;
pub extern fn archive_match_include_time(*struct_archive, _flag: c_int, _sec: time_t, _nsec: c_long) c_int;
pub extern fn archive_match_include_date(*struct_archive, _flag: c_int, _datestr: [*c]const u8) c_int;
pub extern fn archive_match_include_date_w(*struct_archive, _flag: c_int, _datestr: [*c]const wchar_t) c_int;
pub extern fn archive_match_include_file_time(*struct_archive, _flag: c_int, _pathname: [*c]const u8) c_int;
pub extern fn archive_match_include_file_time_w(*struct_archive, _flag: c_int, _pathname: [*c]const wchar_t) c_int;
pub extern fn archive_match_exclude_entry(*struct_archive, _flag: c_int, *struct_archive_entry) c_int;
pub extern fn archive_match_owner_excluded(*struct_archive, *struct_archive_entry) c_int;
pub extern fn archive_match_include_uid(*struct_archive, la_int64_t) c_int;
pub extern fn archive_match_include_gid(*struct_archive, la_int64_t) c_int;
pub extern fn archive_match_include_uname(*struct_archive, [*c]const u8) c_int;
pub extern fn archive_match_include_uname_w(*struct_archive, [*c]const wchar_t) c_int;
pub extern fn archive_match_include_gname(*struct_archive, [*c]const u8) c_int;
pub extern fn archive_match_include_gname_w(*struct_archive, [*c]const wchar_t) c_int;
pub extern fn archive_utility_string_sort([*c][*c]u8) c_int;

pub extern fn archive_entry_clone(*struct_archive_entry) *struct_archive_entry;
pub extern fn archive_entry_atime(*struct_archive_entry) time_t;
pub extern fn archive_entry_atime_nsec(*struct_archive_entry) c_long;
pub extern fn archive_entry_atime_is_set(*struct_archive_entry) c_int;
pub extern fn archive_entry_birthtime(*struct_archive_entry) time_t;
pub extern fn archive_entry_birthtime_nsec(*struct_archive_entry) c_long;
pub extern fn archive_entry_birthtime_is_set(*struct_archive_entry) c_int;
pub extern fn archive_entry_ctime(*struct_archive_entry) time_t;
pub extern fn archive_entry_ctime_nsec(*struct_archive_entry) c_long;
pub extern fn archive_entry_ctime_is_set(*struct_archive_entry) c_int;
pub extern fn archive_entry_dev(*struct_archive_entry) dev_t;
pub extern fn archive_entry_dev_is_set(*struct_archive_entry) c_int;
pub extern fn archive_entry_devmajor(*struct_archive_entry) dev_t;
pub extern fn archive_entry_devminor(*struct_archive_entry) dev_t;
pub extern fn archive_entry_fflags(*struct_archive_entry, [*c]u64, [*c]u64) void;
pub extern fn archive_entry_fflags_text(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_gid(*struct_archive_entry) la_int64_t;
pub extern fn archive_entry_gname(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_gname_utf8(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_gname_w(*struct_archive_entry) [*c]const wchar_t;
pub extern fn archive_entry_hardlink(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_hardlink_utf8(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_hardlink_w(*struct_archive_entry) [*c]const wchar_t;
pub extern fn archive_entry_ino(*struct_archive_entry) la_int64_t;
pub extern fn archive_entry_ino64(*struct_archive_entry) la_int64_t;
pub extern fn archive_entry_ino_is_set(*struct_archive_entry) c_int;
pub extern fn archive_entry_mode(*struct_archive_entry) mode_t;
pub extern fn archive_entry_mtime(*struct_archive_entry) time_t;
pub extern fn archive_entry_mtime_nsec(*struct_archive_entry) c_long;
pub extern fn archive_entry_mtime_is_set(*struct_archive_entry) c_int;
pub extern fn archive_entry_nlink(*struct_archive_entry) c_uint;
pub extern fn archive_entry_rdev(*struct_archive_entry) dev_t;
pub extern fn archive_entry_rdevmajor(*struct_archive_entry) dev_t;
pub extern fn archive_entry_rdevminor(*struct_archive_entry) dev_t;
pub extern fn archive_entry_sourcepath(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_sourcepath_w(*struct_archive_entry) [*c]const wchar_t;
pub extern fn archive_entry_size_is_set(*struct_archive_entry) c_int;
pub extern fn archive_entry_strmode(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_uid(*struct_archive_entry) la_int64_t;
pub extern fn archive_entry_uname(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_uname_utf8(*struct_archive_entry) [*c]const u8;
pub extern fn archive_entry_uname_w(*struct_archive_entry) [*c]const wchar_t;
pub extern fn archive_entry_is_data_encrypted(*struct_archive_entry) c_int;
pub extern fn archive_entry_is_metadata_encrypted(*struct_archive_entry) c_int;
pub extern fn archive_entry_is_encrypted(*struct_archive_entry) c_int;
pub extern fn archive_entry_set_atime(*struct_archive_entry, time_t, c_long) void;
pub extern fn archive_entry_unset_atime(*struct_archive_entry) void;
pub extern fn archive_entry_set_birthtime(*struct_archive_entry, time_t, c_long) void;
pub extern fn archive_entry_unset_birthtime(*struct_archive_entry) void;
pub extern fn archive_entry_set_ctime(*struct_archive_entry, time_t, c_long) void;
pub extern fn archive_entry_unset_ctime(*struct_archive_entry) void;
pub extern fn archive_entry_set_dev(*struct_archive_entry, dev_t) void;
pub extern fn archive_entry_set_devmajor(*struct_archive_entry, dev_t) void;
pub extern fn archive_entry_set_devminor(*struct_archive_entry, dev_t) void;
pub extern fn archive_entry_set_fflags(*struct_archive_entry, u64, u64) void;
pub extern fn archive_entry_copy_fflags_text(*struct_archive_entry, [*c]const u8) [*c]const u8;
pub extern fn archive_entry_copy_fflags_text_w(*struct_archive_entry, [*c]const wchar_t) [*c]const wchar_t;
pub extern fn archive_entry_set_gid(*struct_archive_entry, la_int64_t) void;
pub extern fn archive_entry_set_gname(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_set_gname_utf8(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_gname(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_gname_w(*struct_archive_entry, [*c]const wchar_t) void;
pub extern fn archive_entry_update_gname_utf8(*struct_archive_entry, [*c]const u8) c_int;
pub extern fn archive_entry_set_hardlink(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_set_hardlink_utf8(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_hardlink(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_hardlink_w(*struct_archive_entry, [*c]const wchar_t) void;
pub extern fn archive_entry_update_hardlink_utf8(*struct_archive_entry, [*c]const u8) c_int;
pub extern fn archive_entry_set_ino(*struct_archive_entry, la_int64_t) void;
pub extern fn archive_entry_set_ino64(*struct_archive_entry, la_int64_t) void;
pub extern fn archive_entry_set_link(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_set_link_utf8(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_link(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_link_w(*struct_archive_entry, [*c]const wchar_t) void;
pub extern fn archive_entry_update_link_utf8(*struct_archive_entry, [*c]const u8) c_int;
pub extern fn archive_entry_unset_mtime(*struct_archive_entry) void;
pub extern fn archive_entry_set_nlink(*struct_archive_entry, c_uint) void;
pub extern fn archive_entry_update_pathname_utf8(*struct_archive_entry, [*c]const u8) c_int;
pub extern fn archive_entry_set_rdev(*struct_archive_entry, dev_t) void;
pub extern fn archive_entry_set_rdevmajor(*struct_archive_entry, dev_t) void;
pub extern fn archive_entry_set_rdevminor(*struct_archive_entry, dev_t) void;
pub extern fn archive_entry_unset_size(*struct_archive_entry) void;
pub extern fn archive_entry_copy_sourcepath(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_sourcepath_w(*struct_archive_entry, [*c]const wchar_t) void;
pub extern fn archive_entry_set_symlink(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_set_symlink_type(*struct_archive_entry, c_int) void;
pub extern fn archive_entry_set_symlink_utf8(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_symlink(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_symlink_w(*struct_archive_entry, [*c]const wchar_t) void;
pub extern fn archive_entry_update_symlink_utf8(*struct_archive_entry, [*c]const u8) c_int;
pub extern fn archive_entry_set_uid(*struct_archive_entry, la_int64_t) void;
pub extern fn archive_entry_set_uname(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_set_uname_utf8(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_uname(*struct_archive_entry, [*c]const u8) void;
pub extern fn archive_entry_copy_uname_w(*struct_archive_entry, [*c]const wchar_t) void;
pub extern fn archive_entry_update_uname_utf8(*struct_archive_entry, [*c]const u8) c_int;
pub extern fn archive_entry_set_is_data_encrypted(*struct_archive_entry, is_encrypted: u8) void;
pub extern fn archive_entry_set_is_metadata_encrypted(*struct_archive_entry, is_encrypted: u8) void;
pub const struct_stat = opaque {};
pub extern fn archive_entry_stat(*struct_archive_entry) ?*const struct_stat;
pub extern fn archive_entry_copy_stat(*struct_archive_entry, ?*const struct_stat) void;
pub extern fn archive_entry_mac_metadata(*struct_archive_entry, [*c]usize) ?*const anyopaque;
pub extern fn archive_entry_copy_mac_metadata(*struct_archive_entry, ?*const anyopaque, usize) void;
pub extern fn archive_entry_digest(*struct_archive_entry, c_int) [*c]const u8;
pub extern fn archive_entry_acl_clear(*struct_archive_entry) void;
pub extern fn archive_entry_acl_add_entry(*struct_archive_entry, c_int, c_int, c_int, c_int, [*c]const u8) c_int;
pub extern fn archive_entry_acl_add_entry_w(*struct_archive_entry, c_int, c_int, c_int, c_int, [*c]const wchar_t) c_int;
pub extern fn archive_entry_acl_reset(*struct_archive_entry, c_int) c_int;
pub extern fn archive_entry_acl_next(*struct_archive_entry, c_int, [*c]c_int, [*c]c_int, [*c]c_int, [*c]c_int, [*c][*c]const u8) c_int;
pub extern fn archive_entry_acl_to_text_w(*struct_archive_entry, [*c]la_ssize_t, c_int) [*c]wchar_t;
pub extern fn archive_entry_acl_to_text(*struct_archive_entry, [*c]la_ssize_t, c_int) [*c]u8;
pub extern fn archive_entry_acl_from_text_w(*struct_archive_entry, [*c]const wchar_t, c_int) c_int;
pub extern fn archive_entry_acl_from_text(*struct_archive_entry, [*c]const u8, c_int) c_int;
pub extern fn archive_entry_acl_text_w(*struct_archive_entry, c_int) [*c]const wchar_t;
pub extern fn archive_entry_acl_text(*struct_archive_entry, c_int) [*c]const u8;
pub extern fn archive_entry_acl_types(*struct_archive_entry) c_int;
pub extern fn archive_entry_acl_count(*struct_archive_entry, c_int) c_int;
pub const struct_archive_acl = opaque {};
pub extern fn archive_entry_acl(*struct_archive_entry) *struct_archive_acl;
pub extern fn archive_entry_xattr_clear(*struct_archive_entry) void;
pub extern fn archive_entry_xattr_add_entry(*struct_archive_entry, [*c]const u8, ?*const anyopaque, usize) void;
pub extern fn archive_entry_xattr_count(*struct_archive_entry) c_int;
pub extern fn archive_entry_xattr_reset(*struct_archive_entry) c_int;
pub extern fn archive_entry_xattr_next(*struct_archive_entry, [*c][*c]const u8, [*c]?*const anyopaque, [*c]usize) c_int;
pub extern fn archive_entry_sparse_clear(*struct_archive_entry) void;
pub extern fn archive_entry_sparse_add_entry(*struct_archive_entry, la_int64_t, la_int64_t) void;
pub extern fn archive_entry_sparse_count(*struct_archive_entry) c_int;
pub extern fn archive_entry_sparse_reset(*struct_archive_entry) c_int;
pub extern fn archive_entry_sparse_next(*struct_archive_entry, [*c]la_int64_t, [*c]la_int64_t) c_int;
pub const struct_archive_entry_linkresolver = opaque {};
pub extern fn archive_entry_linkresolver_new() *struct_archive_entry_linkresolver;
pub extern fn archive_entry_linkresolver_set_strategy(*struct_archive_entry_linkresolver, c_int) void;
pub extern fn archive_entry_linkresolver_free(*struct_archive_entry_linkresolver) void;
pub extern fn archive_entry_linkify(*struct_archive_entry_linkresolver, [*c]*struct_archive_entry, [*c]*struct_archive_entry) void;
pub extern fn archive_entry_partial_links(res: *struct_archive_entry_linkresolver, links: [*c]c_uint) *struct_archive_entry;

pub const archive_acl = struct_archive_acl;
pub const archive_entry_linkresolver = struct_archive_entry_linkresolver;

pub const AE_SYMLINK_TYPE_UNDEFINED = @as(c_int, 0);
pub const AE_SYMLINK_TYPE_FILE = @as(c_int, 1);
pub const AE_SYMLINK_TYPE_DIRECTORY = @as(c_int, 2);
pub const ARCHIVE_ENTRY_DIGEST_MD5 = @as(c_int, 0x00000001);
pub const ARCHIVE_ENTRY_DIGEST_RMD160 = @as(c_int, 0x00000002);
pub const ARCHIVE_ENTRY_DIGEST_SHA1 = @as(c_int, 0x00000003);
pub const ARCHIVE_ENTRY_DIGEST_SHA256 = @as(c_int, 0x00000004);
pub const ARCHIVE_ENTRY_DIGEST_SHA384 = @as(c_int, 0x00000005);
pub const ARCHIVE_ENTRY_DIGEST_SHA512 = @as(c_int, 0x00000006);
pub const ARCHIVE_ENTRY_ACL_EXECUTE = @as(c_int, 0x00000001);
pub const ARCHIVE_ENTRY_ACL_WRITE = @as(c_int, 0x00000002);
pub const ARCHIVE_ENTRY_ACL_READ = @as(c_int, 0x00000004);
pub const ARCHIVE_ENTRY_ACL_READ_DATA = @as(c_int, 0x00000008);
pub const ARCHIVE_ENTRY_ACL_LIST_DIRECTORY = @as(c_int, 0x00000008);
pub const ARCHIVE_ENTRY_ACL_WRITE_DATA = @as(c_int, 0x00000010);
pub const ARCHIVE_ENTRY_ACL_ADD_FILE = @as(c_int, 0x00000010);
pub const ARCHIVE_ENTRY_ACL_APPEND_DATA = @as(c_int, 0x00000020);
pub const ARCHIVE_ENTRY_ACL_ADD_SUBDIRECTORY = @as(c_int, 0x00000020);
pub const ARCHIVE_ENTRY_ACL_READ_NAMED_ATTRS = @as(c_int, 0x00000040);
pub const ARCHIVE_ENTRY_ACL_WRITE_NAMED_ATTRS = @as(c_int, 0x00000080);
pub const ARCHIVE_ENTRY_ACL_DELETE_CHILD = @as(c_int, 0x00000100);
pub const ARCHIVE_ENTRY_ACL_READ_ATTRIBUTES = @as(c_int, 0x00000200);
pub const ARCHIVE_ENTRY_ACL_WRITE_ATTRIBUTES = @as(c_int, 0x00000400);
pub const ARCHIVE_ENTRY_ACL_DELETE = @as(c_int, 0x00000800);
pub const ARCHIVE_ENTRY_ACL_READ_ACL = @as(c_int, 0x00001000);
pub const ARCHIVE_ENTRY_ACL_WRITE_ACL = @as(c_int, 0x00002000);
pub const ARCHIVE_ENTRY_ACL_WRITE_OWNER = @as(c_int, 0x00004000);
pub const ARCHIVE_ENTRY_ACL_SYNCHRONIZE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00008000, .hexadecimal);
pub const ARCHIVE_ENTRY_ACL_PERMS_POSIX1E = (ARCHIVE_ENTRY_ACL_EXECUTE | ARCHIVE_ENTRY_ACL_WRITE) | ARCHIVE_ENTRY_ACL_READ;
pub const ARCHIVE_ENTRY_ACL_PERMS_NFS4 = (((((((((((((((ARCHIVE_ENTRY_ACL_EXECUTE | ARCHIVE_ENTRY_ACL_READ_DATA) | ARCHIVE_ENTRY_ACL_LIST_DIRECTORY) | ARCHIVE_ENTRY_ACL_WRITE_DATA) | ARCHIVE_ENTRY_ACL_ADD_FILE) | ARCHIVE_ENTRY_ACL_APPEND_DATA) | ARCHIVE_ENTRY_ACL_ADD_SUBDIRECTORY) | ARCHIVE_ENTRY_ACL_READ_NAMED_ATTRS) | ARCHIVE_ENTRY_ACL_WRITE_NAMED_ATTRS) | ARCHIVE_ENTRY_ACL_DELETE_CHILD) | ARCHIVE_ENTRY_ACL_READ_ATTRIBUTES) | ARCHIVE_ENTRY_ACL_WRITE_ATTRIBUTES) | ARCHIVE_ENTRY_ACL_DELETE) | ARCHIVE_ENTRY_ACL_READ_ACL) | ARCHIVE_ENTRY_ACL_WRITE_ACL) | ARCHIVE_ENTRY_ACL_WRITE_OWNER) | ARCHIVE_ENTRY_ACL_SYNCHRONIZE;
pub const ARCHIVE_ENTRY_ACL_ENTRY_INHERITED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x01000000, .hexadecimal);
pub const ARCHIVE_ENTRY_ACL_ENTRY_FILE_INHERIT = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x02000000, .hexadecimal);
pub const ARCHIVE_ENTRY_ACL_ENTRY_DIRECTORY_INHERIT = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x04000000, .hexadecimal);
pub const ARCHIVE_ENTRY_ACL_ENTRY_NO_PROPAGATE_INHERIT = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x08000000, .hexadecimal);
pub const ARCHIVE_ENTRY_ACL_ENTRY_INHERIT_ONLY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000000, .hexadecimal);
pub const ARCHIVE_ENTRY_ACL_ENTRY_SUCCESSFUL_ACCESS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x20000000, .hexadecimal);
pub const ARCHIVE_ENTRY_ACL_ENTRY_FAILED_ACCESS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x40000000, .hexadecimal);
pub const ARCHIVE_ENTRY_ACL_INHERITANCE_NFS4 = (((((ARCHIVE_ENTRY_ACL_ENTRY_FILE_INHERIT | ARCHIVE_ENTRY_ACL_ENTRY_DIRECTORY_INHERIT) | ARCHIVE_ENTRY_ACL_ENTRY_NO_PROPAGATE_INHERIT) | ARCHIVE_ENTRY_ACL_ENTRY_INHERIT_ONLY) | ARCHIVE_ENTRY_ACL_ENTRY_SUCCESSFUL_ACCESS) | ARCHIVE_ENTRY_ACL_ENTRY_FAILED_ACCESS) | ARCHIVE_ENTRY_ACL_ENTRY_INHERITED;
pub const ARCHIVE_ENTRY_ACL_TYPE_ACCESS = @as(c_int, 0x00000100);
pub const ARCHIVE_ENTRY_ACL_TYPE_DEFAULT = @as(c_int, 0x00000200);
pub const ARCHIVE_ENTRY_ACL_TYPE_ALLOW = @as(c_int, 0x00000400);
pub const ARCHIVE_ENTRY_ACL_TYPE_DENY = @as(c_int, 0x00000800);
pub const ARCHIVE_ENTRY_ACL_TYPE_AUDIT = @as(c_int, 0x00001000);
pub const ARCHIVE_ENTRY_ACL_TYPE_ALARM = @as(c_int, 0x00002000);
pub const ARCHIVE_ENTRY_ACL_TYPE_POSIX1E = ARCHIVE_ENTRY_ACL_TYPE_ACCESS | ARCHIVE_ENTRY_ACL_TYPE_DEFAULT;
pub const ARCHIVE_ENTRY_ACL_TYPE_NFS4 = ((ARCHIVE_ENTRY_ACL_TYPE_ALLOW | ARCHIVE_ENTRY_ACL_TYPE_DENY) | ARCHIVE_ENTRY_ACL_TYPE_AUDIT) | ARCHIVE_ENTRY_ACL_TYPE_ALARM;
pub const ARCHIVE_ENTRY_ACL_USER = @as(c_int, 10001);
pub const ARCHIVE_ENTRY_ACL_USER_OBJ = @as(c_int, 10002);
pub const ARCHIVE_ENTRY_ACL_GROUP = @as(c_int, 10003);
pub const ARCHIVE_ENTRY_ACL_GROUP_OBJ = @as(c_int, 10004);
pub const ARCHIVE_ENTRY_ACL_MASK = @as(c_int, 10005);
pub const ARCHIVE_ENTRY_ACL_OTHER = @as(c_int, 10006);
pub const ARCHIVE_ENTRY_ACL_EVERYONE = @as(c_int, 10107);
pub const ARCHIVE_ENTRY_ACL_STYLE_EXTRA_ID = @as(c_int, 0x00000001);
pub const ARCHIVE_ENTRY_ACL_STYLE_MARK_DEFAULT = @as(c_int, 0x00000002);
pub const ARCHIVE_ENTRY_ACL_STYLE_SOLARIS = @as(c_int, 0x00000004);
pub const ARCHIVE_ENTRY_ACL_STYLE_SEPARATOR_COMMA = @as(c_int, 0x00000008);
pub const ARCHIVE_ENTRY_ACL_STYLE_COMPACT = @as(c_int, 0x00000010);
pub const OLD_ARCHIVE_ENTRY_ACL_STYLE_EXTRA_ID = @as(c_int, 1024);
pub const OLD_ARCHIVE_ENTRY_ACL_STYLE_MARK_DEFAULT = @as(c_int, 2048);
