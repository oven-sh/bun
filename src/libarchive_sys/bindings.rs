#![allow(non_camel_case_types, non_upper_case_globals, clippy::missing_safety_doc)]

use core::ffi::{c_char, c_int, c_long, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};

use bun_str::{ZStr, WStr};
use bun_sys::{self, Fd, File, FileKind, Mode};
use enumset::EnumSet;

#[allow(non_camel_case_types)]
type wchar_t = u16;

// Match libarchive's platform-specific type definitions
pub type la_int64_t = i64;
pub type la_ssize_t = isize;

/// Opaque libarchive `struct archive` (alias of [`Archive`]).
pub type struct_archive = Archive;
/// Opaque libarchive `struct archive_entry` (alias of [`ArchiveEntry`]).
pub type struct_archive_entry = ArchiveEntry;
// const time_t = @import("std").c.time_t;

#[allow(non_camel_case_types)]
type mode_t = Mode;

#[repr(u32)] // TODO(port): Zig used `enum(mode_t)`; mode_t width is platform-specific
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FileType {
    Regular = 0o100000,
    Link = 0o120000,
    Socket = 0o140000,
    CharacterOrientedDevice = 0o020000,
    BlockOrientedDevice = 0o060000,
    Directory = 0o040000,
    Fifo = 0o010000,
}

#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SymlinkType {
    None = 0,
    File = 1,
    Directory = 2,
}

#[allow(non_camel_case_types)]
type time_t = isize;

pub mod flags {
    use super::*;

    #[repr(i32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Extract {
        Owner = ARCHIVE_EXTRACT_OWNER,
        Perm = ARCHIVE_EXTRACT_PERM,
        Time = ARCHIVE_EXTRACT_TIME,
        NoOverwrite = ARCHIVE_EXTRACT_NO_OVERWRITE,
        Unlink = ARCHIVE_EXTRACT_UNLINK,
        Acl = ARCHIVE_EXTRACT_ACL,
        Fflags = ARCHIVE_EXTRACT_FFLAGS,
        Xattr = ARCHIVE_EXTRACT_XATTR,
        SecureSymlinks = ARCHIVE_EXTRACT_SECURE_SYMLINKS,
        SecureNodotdot = ARCHIVE_EXTRACT_SECURE_NODOTDOT,
        NoAutodir = ARCHIVE_EXTRACT_NO_AUTODIR,
        NoOverwriteNewer = ARCHIVE_EXTRACT_NO_OVERWRITE_NEWER,
        Sparse = ARCHIVE_EXTRACT_SPARSE,
        MacMetadata = ARCHIVE_EXTRACT_MAC_METADATA,
        NoHfsCompression = ARCHIVE_EXTRACT_NO_HFS_COMPRESSION,
        HfsCompressionForced = ARCHIVE_EXTRACT_HFS_COMPRESSION_FORCED,
        SecureNoabsolutepaths = ARCHIVE_EXTRACT_SECURE_NOABSOLUTEPATHS,
        ClearNochangeFflags = ARCHIVE_EXTRACT_CLEAR_NOCHANGE_FFLAGS,
        SafeWrites = ARCHIVE_EXTRACT_SAFE_WRITES,
    }

    // Deprecated: Compression enum (see Zig source)

    #[repr(i32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Format {
        BaseMask = ARCHIVE_FORMAT_BASE_MASK,
        Cpio = ARCHIVE_FORMAT_CPIO,
        CpioPosix = ARCHIVE_FORMAT_CPIO_POSIX,
        CpioBinLe = ARCHIVE_FORMAT_CPIO_BIN_LE,
        CpioBinBe = ARCHIVE_FORMAT_CPIO_BIN_BE,
        CpioSvr4Nocrc = ARCHIVE_FORMAT_CPIO_SVR4_NOCRC,
        CpioSvr4Crc = ARCHIVE_FORMAT_CPIO_SVR4_CRC,
        CpioAfioLarge = ARCHIVE_FORMAT_CPIO_AFIO_LARGE,
        CpioPwb = ARCHIVE_FORMAT_CPIO_PWB,
        Shar = ARCHIVE_FORMAT_SHAR,
        SharBase = ARCHIVE_FORMAT_SHAR_BASE,
        SharDump = ARCHIVE_FORMAT_SHAR_DUMP,
        Tar = ARCHIVE_FORMAT_TAR,
        TarUstar = ARCHIVE_FORMAT_TAR_USTAR,
        TarPaxInterchange = ARCHIVE_FORMAT_TAR_PAX_INTERCHANGE,
        TarPaxRestricted = ARCHIVE_FORMAT_TAR_PAX_RESTRICTED,
        TarGnutar = ARCHIVE_FORMAT_TAR_GNUTAR,
        Iso9660 = ARCHIVE_FORMAT_ISO9660,
        Iso9660Rockridge = ARCHIVE_FORMAT_ISO9660_ROCKRIDGE,
        Zip = ARCHIVE_FORMAT_ZIP,
        Empty = ARCHIVE_FORMAT_EMPTY,
        Ar = ARCHIVE_FORMAT_AR,
        ArGnu = ARCHIVE_FORMAT_AR_GNU,
        ArBsd = ARCHIVE_FORMAT_AR_BSD,
        Mtree = ARCHIVE_FORMAT_MTREE,
        Raw = ARCHIVE_FORMAT_RAW,
        Xar = ARCHIVE_FORMAT_XAR,
        Lha = ARCHIVE_FORMAT_LHA,
        Cab = ARCHIVE_FORMAT_CAB,
        Rar = ARCHIVE_FORMAT_RAR,
        SevenZip = ARCHIVE_FORMAT_7ZIP,
        Warc = ARCHIVE_FORMAT_WARC,
        RarV5 = ARCHIVE_FORMAT_RAR_V5,
    }

    #[repr(i32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Filter {
        None = ARCHIVE_FILTER_NONE,
        Gzip = ARCHIVE_FILTER_GZIP,
        Bzip2 = ARCHIVE_FILTER_BZIP2,
        Compress = ARCHIVE_FILTER_COMPRESS,
        Program = ARCHIVE_FILTER_PROGRAM,
        Lzma = ARCHIVE_FILTER_LZMA,
        Xz = ARCHIVE_FILTER_XZ,
        Uu = ARCHIVE_FILTER_UU,
        Rpm = ARCHIVE_FILTER_RPM,
        Lzip = ARCHIVE_FILTER_LZIP,
        Lrzip = ARCHIVE_FILTER_LRZIP,
        Lzop = ARCHIVE_FILTER_LZOP,
        Grzip = ARCHIVE_FILTER_GRZIP,
        Lz4 = ARCHIVE_FILTER_LZ4,
        Zstd = ARCHIVE_FILTER_ZSTD,
    }

    #[repr(i32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum EntryDigest {
        Md5 = ARCHIVE_ENTRY_DIGEST_MD5,
        Rmd160 = ARCHIVE_ENTRY_DIGEST_RMD160,
        Sha1 = ARCHIVE_ENTRY_DIGEST_SHA1,
        Sha256 = ARCHIVE_ENTRY_DIGEST_SHA256,
        Sha384 = ARCHIVE_ENTRY_DIGEST_SHA384,
        Sha512 = ARCHIVE_ENTRY_DIGEST_SHA512,
    }

    /// Zig's `EntryACL` enum has many duplicate discriminant values (e.g.
    /// `read_data` == `list_directory` == 0x8). Rust enums forbid that, so this
    /// is ported as a transparent newtype with associated consts.
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub struct EntryAcl(pub c_int);
    impl EntryAcl {
        pub const ENTRY_ACL_EXECUTE: Self = Self(ARCHIVE_ENTRY_ACL_EXECUTE);
        pub const WRITE: Self = Self(ARCHIVE_ENTRY_ACL_WRITE);
        pub const READ: Self = Self(ARCHIVE_ENTRY_ACL_READ);
        pub const READ_DATA: Self = Self(ARCHIVE_ENTRY_ACL_READ_DATA);
        pub const LIST_DIRECTORY: Self = Self(ARCHIVE_ENTRY_ACL_LIST_DIRECTORY);
        pub const WRITE_DATA: Self = Self(ARCHIVE_ENTRY_ACL_WRITE_DATA);
        pub const ADD_FILE: Self = Self(ARCHIVE_ENTRY_ACL_ADD_FILE);
        pub const APPEND_DATA: Self = Self(ARCHIVE_ENTRY_ACL_APPEND_DATA);
        pub const ADD_SUBDIRECTORY: Self = Self(ARCHIVE_ENTRY_ACL_ADD_SUBDIRECTORY);
        pub const READ_NAMED_ATTRS: Self = Self(ARCHIVE_ENTRY_ACL_READ_NAMED_ATTRS);
        pub const WRITE_NAMED_ATTRS: Self = Self(ARCHIVE_ENTRY_ACL_WRITE_NAMED_ATTRS);
        pub const DELETE_CHILD: Self = Self(ARCHIVE_ENTRY_ACL_DELETE_CHILD);
        pub const READ_ATTRIBUTES: Self = Self(ARCHIVE_ENTRY_ACL_READ_ATTRIBUTES);
        pub const WRITE_ATTRIBUTES: Self = Self(ARCHIVE_ENTRY_ACL_WRITE_ATTRIBUTES);
        pub const DELETE: Self = Self(ARCHIVE_ENTRY_ACL_DELETE);
        pub const READ_ACL: Self = Self(ARCHIVE_ENTRY_ACL_READ_ACL);
        pub const WRITE_ACL: Self = Self(ARCHIVE_ENTRY_ACL_WRITE_ACL);
        pub const WRITE_OWNER: Self = Self(ARCHIVE_ENTRY_ACL_WRITE_OWNER);
        pub const SYNCHRONIZE: Self = Self(ARCHIVE_ENTRY_ACL_SYNCHRONIZE);
        pub const PERMS_POSIX1_E: Self = Self(ARCHIVE_ENTRY_ACL_PERMS_POSIX1E);
        pub const PERMS_NFS4: Self = Self(ARCHIVE_ENTRY_ACL_PERMS_NFS4);
        pub const ENTRY_INHERITED: Self = Self(ARCHIVE_ENTRY_ACL_ENTRY_INHERITED);
        pub const ENTRY_FILE_INHERIT: Self = Self(ARCHIVE_ENTRY_ACL_ENTRY_FILE_INHERIT);
        pub const ENTRY_DIRECTORY_INHERIT: Self = Self(ARCHIVE_ENTRY_ACL_ENTRY_DIRECTORY_INHERIT);
        pub const ENTRY_NO_PROPAGATE_INHERIT: Self = Self(ARCHIVE_ENTRY_ACL_ENTRY_NO_PROPAGATE_INHERIT);
        pub const ENTRY_INHERIT_ONLY: Self = Self(ARCHIVE_ENTRY_ACL_ENTRY_INHERIT_ONLY);
        pub const ENTRY_SUCCESSFUL_ACCESS: Self = Self(ARCHIVE_ENTRY_ACL_ENTRY_SUCCESSFUL_ACCESS);
        pub const ENTRY_FAILED_ACCESS: Self = Self(ARCHIVE_ENTRY_ACL_ENTRY_FAILED_ACCESS);
        pub const INHERITANCE_NFS4: Self = Self(ARCHIVE_ENTRY_ACL_INHERITANCE_NFS4);
        pub const TYPE_ACCESS: Self = Self(ARCHIVE_ENTRY_ACL_TYPE_ACCESS);
        pub const TYPE_DEFAULT: Self = Self(ARCHIVE_ENTRY_ACL_TYPE_DEFAULT);
        pub const TYPE_ALLOW: Self = Self(ARCHIVE_ENTRY_ACL_TYPE_ALLOW);
        pub const TYPE_DENY: Self = Self(ARCHIVE_ENTRY_ACL_TYPE_DENY);
        pub const TYPE_AUDIT: Self = Self(ARCHIVE_ENTRY_ACL_TYPE_AUDIT);
        pub const TYPE_ALARM: Self = Self(ARCHIVE_ENTRY_ACL_TYPE_ALARM);
        pub const TYPE_POSIX1_E: Self = Self(ARCHIVE_ENTRY_ACL_TYPE_POSIX1E);
        pub const TYPE_NFS4: Self = Self(ARCHIVE_ENTRY_ACL_TYPE_NFS4);
        pub const USER: Self = Self(ARCHIVE_ENTRY_ACL_USER);
        pub const USER_OBJ: Self = Self(ARCHIVE_ENTRY_ACL_USER_OBJ);
        pub const GROUP: Self = Self(ARCHIVE_ENTRY_ACL_GROUP);
        pub const GROUP_OBJ: Self = Self(ARCHIVE_ENTRY_ACL_GROUP_OBJ);
        pub const MASK: Self = Self(ARCHIVE_ENTRY_ACL_MASK);
        pub const OTHER: Self = Self(ARCHIVE_ENTRY_ACL_OTHER);
        pub const EVERYONE: Self = Self(ARCHIVE_ENTRY_ACL_EVERYONE);
        pub const STYLE_EXTRA_ID: Self = Self(ARCHIVE_ENTRY_ACL_STYLE_EXTRA_ID);
        pub const STYLE_MARK_DEFAULT: Self = Self(ARCHIVE_ENTRY_ACL_STYLE_MARK_DEFAULT);
        pub const STYLE_SOLARIS: Self = Self(ARCHIVE_ENTRY_ACL_STYLE_SOLARIS);
        pub const STYLE_SEPARATOR_COMMA: Self = Self(ARCHIVE_ENTRY_ACL_STYLE_SEPARATOR_COMMA);
        pub const STYLE_COMPACT: Self = Self(ARCHIVE_ENTRY_ACL_STYLE_COMPACT);
    }
}

const ARCHIVE_EOF: c_int = 1;
const ARCHIVE_OK: c_int = 0;
const ARCHIVE_RETRY: c_int = -10;
const ARCHIVE_WARN: c_int = -20;
const ARCHIVE_FAILED: c_int = -25;
const ARCHIVE_FATAL: c_int = -30;
const ARCHIVE_FILTER_NONE: c_int = 0;
const ARCHIVE_FILTER_GZIP: c_int = 1;
const ARCHIVE_FILTER_BZIP2: c_int = 2;
const ARCHIVE_FILTER_COMPRESS: c_int = 3;
const ARCHIVE_FILTER_PROGRAM: c_int = 4;
const ARCHIVE_FILTER_LZMA: c_int = 5;
const ARCHIVE_FILTER_XZ: c_int = 6;
const ARCHIVE_FILTER_UU: c_int = 7;
const ARCHIVE_FILTER_RPM: c_int = 8;
const ARCHIVE_FILTER_LZIP: c_int = 9;
const ARCHIVE_FILTER_LRZIP: c_int = 10;
const ARCHIVE_FILTER_LZOP: c_int = 11;
const ARCHIVE_FILTER_GRZIP: c_int = 12;
const ARCHIVE_FILTER_LZ4: c_int = 13;
const ARCHIVE_FILTER_ZSTD: c_int = 14;
// Deprecated: ARCHIVE_COMPRESSION_* (aliases of ARCHIVE_FILTER_*)
const ARCHIVE_FORMAT_BASE_MASK: c_int = 0xff0000;
const ARCHIVE_FORMAT_CPIO: c_int = 0x10000;
const ARCHIVE_FORMAT_CPIO_POSIX: c_int = ARCHIVE_FORMAT_CPIO | 1;
const ARCHIVE_FORMAT_CPIO_BIN_LE: c_int = ARCHIVE_FORMAT_CPIO | 2;
const ARCHIVE_FORMAT_CPIO_BIN_BE: c_int = ARCHIVE_FORMAT_CPIO | 3;
const ARCHIVE_FORMAT_CPIO_SVR4_NOCRC: c_int = ARCHIVE_FORMAT_CPIO | 4;
const ARCHIVE_FORMAT_CPIO_SVR4_CRC: c_int = ARCHIVE_FORMAT_CPIO | 5;
const ARCHIVE_FORMAT_CPIO_AFIO_LARGE: c_int = ARCHIVE_FORMAT_CPIO | 6;
const ARCHIVE_FORMAT_CPIO_PWB: c_int = ARCHIVE_FORMAT_CPIO | 7;
const ARCHIVE_FORMAT_SHAR: c_int = 0x20000;
const ARCHIVE_FORMAT_SHAR_BASE: c_int = ARCHIVE_FORMAT_SHAR | 1;
const ARCHIVE_FORMAT_SHAR_DUMP: c_int = ARCHIVE_FORMAT_SHAR | 2;
const ARCHIVE_FORMAT_TAR: c_int = 0x30000;
const ARCHIVE_FORMAT_TAR_USTAR: c_int = ARCHIVE_FORMAT_TAR | 1;
const ARCHIVE_FORMAT_TAR_PAX_INTERCHANGE: c_int = ARCHIVE_FORMAT_TAR | 2;
const ARCHIVE_FORMAT_TAR_PAX_RESTRICTED: c_int = ARCHIVE_FORMAT_TAR | 3;
const ARCHIVE_FORMAT_TAR_GNUTAR: c_int = ARCHIVE_FORMAT_TAR | 4;
const ARCHIVE_FORMAT_ISO9660: c_int = 0x40000;
const ARCHIVE_FORMAT_ISO9660_ROCKRIDGE: c_int = ARCHIVE_FORMAT_ISO9660 | 1;
const ARCHIVE_FORMAT_ZIP: c_int = 0x50000;
const ARCHIVE_FORMAT_EMPTY: c_int = 0x60000;
const ARCHIVE_FORMAT_AR: c_int = 0x70000;
const ARCHIVE_FORMAT_AR_GNU: c_int = ARCHIVE_FORMAT_AR | 1;
const ARCHIVE_FORMAT_AR_BSD: c_int = ARCHIVE_FORMAT_AR | 2;
const ARCHIVE_FORMAT_MTREE: c_int = 0x80000;
const ARCHIVE_FORMAT_RAW: c_int = 0x90000;
const ARCHIVE_FORMAT_XAR: c_int = 0xA0000;
const ARCHIVE_FORMAT_LHA: c_int = 0xB0000;
const ARCHIVE_FORMAT_CAB: c_int = 0xC0000;
const ARCHIVE_FORMAT_RAR: c_int = 0xD0000;
const ARCHIVE_FORMAT_7ZIP: c_int = 0xE0000;
const ARCHIVE_FORMAT_WARC: c_int = 0xF0000;
const ARCHIVE_FORMAT_RAR_V5: c_int = 0x100000;
const ARCHIVE_EXTRACT_OWNER: c_int = 0x0001;
const ARCHIVE_EXTRACT_PERM: c_int = 0x0002;
const ARCHIVE_EXTRACT_TIME: c_int = 0x0004;
const ARCHIVE_EXTRACT_NO_OVERWRITE: c_int = 0x0008;
const ARCHIVE_EXTRACT_UNLINK: c_int = 0x0010;
const ARCHIVE_EXTRACT_ACL: c_int = 0x0020;
const ARCHIVE_EXTRACT_FFLAGS: c_int = 0x0040;
const ARCHIVE_EXTRACT_XATTR: c_int = 0x0080;
const ARCHIVE_EXTRACT_SECURE_SYMLINKS: c_int = 0x0100;
const ARCHIVE_EXTRACT_SECURE_NODOTDOT: c_int = 0x0200;
const ARCHIVE_EXTRACT_NO_AUTODIR: c_int = 0x0400;
const ARCHIVE_EXTRACT_NO_OVERWRITE_NEWER: c_int = 0x0800;
const ARCHIVE_EXTRACT_SPARSE: c_int = 0x1000;
const ARCHIVE_EXTRACT_MAC_METADATA: c_int = 0x2000;
const ARCHIVE_EXTRACT_NO_HFS_COMPRESSION: c_int = 0x4000;
const ARCHIVE_EXTRACT_HFS_COMPRESSION_FORCED: c_int = 0x8000;
const ARCHIVE_EXTRACT_SECURE_NOABSOLUTEPATHS: c_int = 0x10000;
const ARCHIVE_EXTRACT_CLEAR_NOCHANGE_FFLAGS: c_int = 0x20000;
const ARCHIVE_EXTRACT_SAFE_WRITES: c_int = 0x40000;

// ───────────────────────────────────────────────────────────────────────────
// Archive (opaque FFI handle)
// ───────────────────────────────────────────────────────────────────────────

/// Opaque libarchive `struct archive` handle. Always used behind `*mut Archive`.
#[repr(C)]
pub struct Archive {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ArchiveResult {
    Eof = ARCHIVE_EOF,
    Ok = ARCHIVE_OK,
    Retry = ARCHIVE_RETRY,
    Warn = ARCHIVE_WARN,
    Failed = ARCHIVE_FAILED,
    Fatal = ARCHIVE_FATAL,
}

unsafe extern "C" {
    fn archive_version_number() -> c_int;
    fn archive_version_string() -> *const c_char;
    fn archive_version_details() -> *const c_char;
    fn archive_zlib_version() -> *const c_char;
    fn archive_liblzma_version() -> *const c_char;
    fn archive_bzlib_version() -> *const c_char;
    fn archive_liblz4_version() -> *const c_char;
    fn archive_libzstd_version() -> *const c_char;
    fn archive_error_string(a: *mut Archive) -> *const c_char;
    fn archive_write_new() -> *mut Archive;
    fn archive_write_close(a: *mut Archive) -> ArchiveResult;
    fn archive_write_finish(a: *mut Archive) -> ArchiveResult;
    fn archive_free(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_options(a: *mut Archive, opts: *const c_char) -> ArchiveResult;
    fn archive_write_set_format_pax_restricted(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_format_gnutar(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_format_7zip(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_format_pax(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_format_ustar(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_format_zip(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_format_shar(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_format(a: *mut Archive, format_code: i32) -> ArchiveResult;
    fn archive_write_add_filter_gzip(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter(a: *mut Archive, filter_code: i32) -> ArchiveResult;
    fn archive_write_add_filter_by_name(a: *mut Archive, name: *const c_char) -> ArchiveResult;
    fn archive_write_add_filter_b64encode(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_compress(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_grzip(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_lrzip(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_lz4(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_lzip(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_lzma(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_lzop(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_none(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_uuencode(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_xz(a: *mut Archive) -> ArchiveResult;
    fn archive_write_add_filter_zstd(a: *mut Archive) -> ArchiveResult;
    fn archive_write_set_filter_option(a: *mut Archive, m: *const c_char, o: *const c_char, v: *const c_char) -> ArchiveResult;
    fn archive_write_open_filename(a: *mut Archive, filename: *const c_char) -> ArchiveResult;
    fn archive_write_open_fd(a: *mut Archive, fd: c_int) -> ArchiveResult;
    fn archive_write_open_memory(a: *mut Archive, buffer: *mut c_void, buff_size: usize, used: *mut usize) -> ArchiveResult;
    fn archive_write_header(a: *mut Archive, e: *mut ArchiveEntry) -> ArchiveResult;
    fn archive_write_data(a: *mut Archive, data: *const c_void, len: usize) -> isize;
    fn archive_write_finish_entry(a: *mut Archive) -> ArchiveResult;
    fn archive_write_free(a: *mut Archive) -> ArchiveResult;
    fn archive_read_new() -> *mut Archive;
    fn archive_read_close(a: *mut Archive) -> ArchiveResult;
    pub fn archive_read_free(a: *mut Archive) -> ArchiveResult;
    pub fn archive_read_finish(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_7zip(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_all(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_ar(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_by_code(a: *mut Archive, code: c_int) -> ArchiveResult;
    fn archive_read_support_format_cab(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_cpio(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_empty(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_gnutar(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_iso9660(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_lha(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_mtree(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_rar(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_rar5(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_raw(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_tar(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_warc(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_xar(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_zip(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_zip_streamable(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_format_zip_seekable(a: *mut Archive) -> ArchiveResult;
    fn archive_read_set_options(a: *mut Archive, opts: *const c_char) -> ArchiveResult;
    fn archive_read_open_memory(a: *mut Archive, buf: *const c_void, size: usize) -> ArchiveResult;
    fn archive_read_next_header(a: *mut Archive, entry: *mut *mut ArchiveEntry) -> ArchiveResult;
    fn archive_read_next_header2(a: *mut Archive, entry: *mut ArchiveEntry) -> ArchiveResult;
    fn archive_read_data(a: *mut Archive, buf: *mut c_void, len: usize) -> isize;
    fn archive_read_data_into_fd(a: *mut Archive, fd: c_int) -> ArchiveResult;
    fn archive_read_support_filter_all(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_by_code(a: *mut Archive, code: c_int) -> ArchiveResult;
    fn archive_read_support_filter_compress(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_gzip(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_grzip(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_lrzip(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_lz4(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_lzip(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_lzma(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_lzop(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_none(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_rpm(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_uu(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_xz(a: *mut Archive) -> ArchiveResult;
    fn archive_read_support_filter_zstd(a: *mut Archive) -> ArchiveResult;
}

#[inline(always)]
fn p(a: &Archive) -> *mut Archive {
    a as *const Archive as *mut Archive
}

impl Archive {
    pub fn version_number() -> i32 {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_version_number() }
    }
    pub fn version_string() -> &'static [u8] {
        // SAFETY: archive_version_string returns a static NUL-terminated C string.
        unsafe { core::ffi::CStr::from_ptr(archive_version_string()) }.to_bytes()
    }
    pub fn version_details() -> &'static [u8] {
        // SAFETY: libarchive returns a NUL-terminated static C string.
        unsafe { core::ffi::CStr::from_ptr(archive_version_details()) }.to_bytes()
    }
    pub fn zlib_version() -> &'static [u8] {
        // SAFETY: libarchive returns a NUL-terminated static C string.
        unsafe { core::ffi::CStr::from_ptr(archive_zlib_version()) }.to_bytes()
    }
    pub fn liblzma_version() -> &'static [u8] {
        // SAFETY: libarchive returns a NUL-terminated static C string.
        unsafe { core::ffi::CStr::from_ptr(archive_liblzma_version()) }.to_bytes()
    }
    pub fn bzlib_version() -> &'static [u8] {
        // SAFETY: libarchive returns a NUL-terminated static C string.
        unsafe { core::ffi::CStr::from_ptr(archive_bzlib_version()) }.to_bytes()
    }
    pub fn liblz4_version() -> &'static [u8] {
        // SAFETY: libarchive returns a NUL-terminated static C string.
        unsafe { core::ffi::CStr::from_ptr(archive_liblz4_version()) }.to_bytes()
    }
    pub fn libzstd_version() -> &'static [u8] {
        // SAFETY: libarchive returns a NUL-terminated static C string.
        unsafe { core::ffi::CStr::from_ptr(archive_libzstd_version()) }.to_bytes()
    }

    pub fn error_string(&self) -> &[u8] {
        // SAFETY: returns NUL-terminated string owned by libarchive, valid until next call.
        let err_str = unsafe { archive_error_string(p(self)) };
        if err_str.is_null() {
            return b"";
        }
        // SAFETY: libarchive returns a NUL-terminated static C string.
        unsafe { core::ffi::CStr::from_ptr(err_str) }.to_bytes()
    }

    pub fn write_new() -> *mut Archive {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_new() }
    }

    pub fn write_close(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_close(p(self)) }
    }

    pub fn write_finish(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_finish(p(self)) }
    }

    pub fn free(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_free(p(self)) }
    }

    pub fn write_set_options(&self, opts: &ZStr) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_options(p(self), opts.as_ptr().cast()) }
    }

    pub fn write_set_format_pax_restricted(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_format_pax_restricted(p(self)) }
    }

    pub fn write_set_format_gnutar(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_format_gnutar(p(self)) }
    }

    pub fn write_set_format_7zip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_format_7zip(p(self)) }
    }

    pub fn write_set_format_pax(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_format_pax(p(self)) }
    }

    pub fn write_set_format_ustar(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_format_ustar(p(self)) }
    }

    pub fn write_set_format_zip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_format_zip(p(self)) }
    }

    pub fn write_set_format_shar(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_format_shar(p(self)) }
    }

    pub fn write_set_format(&self, format: flags::Format) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_set_format(p(self), format as i32) }
    }

    // deprecated: archive_write_set_compression_gzip

    pub fn write_add_filter_gzip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_gzip(p(self)) }
    }

    pub fn write_add_filter(&self, filter: flags::Filter) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter(p(self), filter as i32) }
    }
    pub fn write_add_filter_by_name(&self, name: &ZStr) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_by_name(p(self), name.as_ptr().cast()) }
    }
    pub fn write_add_filter_b64encode(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_b64encode(p(self)) }
    }
    // pub fn write_add_filter_bzip2 — disabled in Zig
    pub fn write_add_filter_compress(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_compress(p(self)) }
    }
    pub fn write_add_filter_grzip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_grzip(p(self)) }
    }
    pub fn write_add_filter_lrzip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_lrzip(p(self)) }
    }
    pub fn write_add_filter_lz4(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_lz4(p(self)) }
    }
    pub fn write_add_filter_lzip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_lzip(p(self)) }
    }
    pub fn write_add_filter_lzma(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_lzma(p(self)) }
    }
    pub fn write_add_filter_lzop(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_lzop(p(self)) }
    }
    pub fn write_add_filter_none(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_none(p(self)) }
    }
    pub fn write_add_filter_uuencode(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_uuencode(p(self)) }
    }
    pub fn write_add_filter_xz(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_xz(p(self)) }
    }
    pub fn write_add_filter_zstd(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_add_filter_zstd(p(self)) }
    }

    pub fn write_set_filter_option(&self, m: Option<&ZStr>, o: &ZStr, v: &ZStr) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe {
            archive_write_set_filter_option(
                p(self),
                m.map_or(core::ptr::null(), |s| s.as_ptr().cast()),
                o.as_ptr().cast(),
                v.as_ptr().cast(),
            )
        }
    }

    pub fn write_open_filename(&self, filename: &ZStr) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_open_filename(p(self), filename.as_ptr().cast()) }
    }

    pub fn write_open_fd(&self, fd: Fd) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_open_fd(p(self), fd.cast()) }
    }

    pub fn write_open_memory(&self, buf: *mut c_void, buf_size: usize, used: &mut usize) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_open_memory(p(self), buf, buf_size, used) }
    }

    pub fn write_header(&self, entry: &ArchiveEntry) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_header(p(self), entry as *const _ as *mut _) }
    }

    pub fn write_data(&self, data: &[u8]) -> isize {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_data(p(self), data.as_ptr().cast(), data.len()) }
    }

    pub fn write_finish_entry(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_finish_entry(p(self)) }
    }

    pub fn write_free(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_write_free(p(self)) }
    }

    pub fn read_new() -> *mut Archive {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_new() }
    }

    pub fn read_close(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_close(p(self)) }
    }

    pub fn read_free(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_free(p(self)) }
    }

    pub fn read_finish(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_finish(p(self)) }
    }

    // deprecated: archive_read_support_compression_* (see Zig source)

    pub fn read_support_format_7zip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_7zip(p(self)) }
    }
    pub fn read_support_format_all(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_all(p(self)) }
    }
    pub fn read_support_format_ar(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_ar(p(self)) }
    }
    pub fn read_support_format_by_code(&self, code: i32) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_by_code(p(self), code) }
    }
    pub fn read_support_format_cab(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_cab(p(self)) }
    }
    pub fn read_support_format_cpio(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_cpio(p(self)) }
    }
    pub fn read_support_format_empty(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_empty(p(self)) }
    }
    pub fn read_support_format_gnutar(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_gnutar(p(self)) }
    }
    pub fn read_support_format_iso9660(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_iso9660(p(self)) }
    }
    pub fn read_support_format_lha(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_lha(p(self)) }
    }
    pub fn read_support_format_mtree(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_mtree(p(self)) }
    }
    pub fn read_support_format_rar(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_rar(p(self)) }
    }
    pub fn read_support_format_rar5(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_rar5(p(self)) }
    }
    pub fn read_support_format_raw(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_raw(p(self)) }
    }
    pub fn read_support_format_tar(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_tar(p(self)) }
    }
    pub fn read_support_format_warc(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_warc(p(self)) }
    }
    pub fn read_support_format_xar(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_xar(p(self)) }
    }
    pub fn read_support_format_zip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_zip(p(self)) }
    }
    pub fn read_support_format_zip_streamable(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_zip_streamable(p(self)) }
    }
    pub fn read_support_format_zip_seekable(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_format_zip_seekable(p(self)) }
    }

    pub fn read_set_options(&self, opts: &ZStr) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_set_options(p(self), opts.as_ptr().cast()) }
    }

    pub fn read_open_memory(&self, buf: &[u8]) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_open_memory(p(self), buf.as_ptr().cast(), buf.len()) }
    }

    pub fn read_next_header(&self, entry: &mut *mut ArchiveEntry) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_next_header(p(self), entry) }
    }
    pub fn read_next_header2(&self, entry: &ArchiveEntry) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_next_header2(p(self), entry as *const _ as *mut _) }
    }

    pub fn next(&self, offset: &mut i64) -> Option<Block> {
        let mut buff: *const c_void = core::ptr::null();
        let mut size: usize = 0;
        // SAFETY: archive_read_data_block writes buff/size/offset; pointers are valid.
        let r = unsafe { archive_read_data_block(p(self), &mut buff, &mut size, offset) };
        if r == ArchiveResult::Eof {
            return None;
        }
        if r != ArchiveResult::Ok {
            return Some(Block { bytes: &[] as *const [u8], offset: *offset, result: r });
        }
        // SAFETY: libarchive guarantees buff[0..size] is valid until the next read call.
        let ptr = buff.cast::<u8>();
        let bytes = core::ptr::slice_from_raw_parts(ptr, size);
        Some(Block { bytes, offset: *offset, result: r })
    }

    pub fn read_data(&self, buf: &mut [u8]) -> isize {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_data(p(self), buf.as_mut_ptr().cast(), buf.len()) }
    }

    pub fn write_zeros_to_file(file: File, count: usize) -> ArchiveResult {
        // Use uninit + memset instead of comptime zero-init to reduce binary size
        let mut zero_buf: [u8; 16 * 1024] = [0u8; 16 * 1024];
        // PERF(port): Zig used `undefined` + @memset to avoid a 16KB zeroed static — profile in Phase B
        let _ = &mut zero_buf;
        let mut remaining = count;
        while remaining > 0 {
            let to_write = &zero_buf[..remaining.min(zero_buf.len())];
            match file.write_all(to_write) {
                bun_sys::Result::Err(_) => return ArchiveResult::Failed,
                bun_sys::Result::Ok(()) => {}
            }
            remaining -= to_write.len();
        }
        ArchiveResult::Ok
    }

    /// Reads data from the archive and writes it to the given file descriptor.
    /// This is a port of libarchive's archive_read_data_into_fd with optimizations:
    /// - Uses pwrite when possible to avoid needing lseek for sparse file handling
    /// - Falls back to lseek + write if pwrite is not available
    /// - Falls back to writing zeros if lseek is not available
    /// - Truncates the file to the final size to handle trailing sparse holes
    pub fn read_data_into_fd(
        &self,
        fd: Fd,
        can_use_pwrite: &mut bool,
        can_use_lseek: &mut bool,
    ) -> ArchiveResult {
        let mut target_offset: i64 = 0; // Updated by archive.next() - where this block should be written
        let mut actual_offset: i64 = 0; // Where we've actually written to (for write() path)
        let mut final_offset: i64 = 0; // Track the furthest point we need the file to extend to
        let file = File { handle: fd };

        while let Some(block) = self.next(&mut target_offset) {
            if block.result != ArchiveResult::Ok {
                return block.result;
            }
            // SAFETY: block.bytes was set from archive_read_data_block; valid until next read call.
            let data: &[u8] = unsafe { &*block.bytes };

            // Track the furthest point we need to write to (for final truncation)
            final_offset = final_offset.max(block.offset + i64::try_from(data.len()).unwrap());

            #[cfg(unix)]
            {
                // Try pwrite first - it handles sparse files without needing lseek
                if *can_use_pwrite {
                    match file.pwrite_all(data, block.offset) {
                        bun_sys::Result::Err(_) => {
                            *can_use_pwrite = false;
                            bun_core::Output::debug_warn(
                                "libarchive: falling back to write() after pwrite() failure",
                            );
                            // Fall through to lseek+write path
                        }
                        bun_sys::Result::Ok(()) => {
                            // pwrite doesn't update file position, but track logical position for fallback
                            actual_offset = actual_offset
                                .max(block.offset + i64::try_from(data.len()).unwrap());
                            continue;
                        }
                    }
                }
            }

            // Handle mismatch between actual position and target position
            if block.offset != actual_offset {
                'seek: {
                    if *can_use_lseek {
                        match bun_sys::set_file_offset(fd, u64::try_from(block.offset).unwrap()) {
                            bun_sys::Result::Err(_) => *can_use_lseek = false,
                            bun_sys::Result::Ok(_) => {
                                actual_offset = block.offset;
                                break 'seek;
                            }
                        }
                    }

                    // lseek failed or not available
                    if block.offset > actual_offset {
                        // Write zeros to fill the gap
                        let zero_count = usize::try_from(block.offset - actual_offset).unwrap();
                        let zero_result = Self::write_zeros_to_file(file, zero_count);
                        if zero_result != ArchiveResult::Ok {
                            return zero_result;
                        }
                        actual_offset = block.offset;
                    } else {
                        // Can't seek backward without lseek
                        return ArchiveResult::Failed;
                    }
                }
            }

            match file.write_all(data) {
                bun_sys::Result::Err(_) => return ArchiveResult::Failed,
                bun_sys::Result::Ok(()) => {
                    actual_offset += i64::try_from(data.len()).unwrap();
                }
            }
        }

        // Handle trailing sparse hole by truncating file to final size
        // This extends the file to include any trailing zeros without actually writing them
        if final_offset > actual_offset {
            let _ = bun_sys::ftruncate(fd, final_offset);
        }

        ArchiveResult::Ok
    }

    pub fn read_support_filter_all(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_all(p(self)) }
    }
    pub fn read_support_filter_by_code(&self, code: i32) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_by_code(p(self), code) }
    }
    // pub fn read_support_filter_bzip2 — disabled in Zig
    pub fn read_support_filter_compress(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_compress(p(self)) }
    }
    pub fn read_support_filter_gzip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_gzip(p(self)) }
    }
    pub fn read_support_filter_grzip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_grzip(p(self)) }
    }
    pub fn read_support_filter_lrzip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_lrzip(p(self)) }
    }
    pub fn read_support_filter_lz4(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_lz4(p(self)) }
    }
    pub fn read_support_filter_lzip(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_lzip(p(self)) }
    }
    pub fn read_support_filter_lzma(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_lzma(p(self)) }
    }
    pub fn read_support_filter_lzop(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_lzop(p(self)) }
    }
    pub fn read_support_filter_none(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_none(p(self)) }
    }
    pub fn read_support_filter_rpm(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_rpm(p(self)) }
    }
    pub fn read_support_filter_uu(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_uu(p(self)) }
    }
    pub fn read_support_filter_xz(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_xz(p(self)) }
    }
    pub fn read_support_filter_zstd(&self) -> ArchiveResult {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_read_support_filter_zstd(p(self)) }
    }
}

/// One block returned by [`Archive::next`].
pub struct Block {
    /// Borrowed from libarchive's internal buffer; valid until the next read call.
    // TODO(port): lifetime — Zig had `[]const u8` defaulting to "".
    pub bytes: *const [u8],
    pub offset: i64,
    pub result: ArchiveResult,
}

// ───────────────────────────────────────────────────────────────────────────
// Archive::Entry (opaque FFI handle)
// ───────────────────────────────────────────────────────────────────────────

/// Opaque libarchive `struct archive_entry` handle.
#[repr(C)]
pub struct ArchiveEntry {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn archive_entry_new() -> *mut ArchiveEntry;
    fn archive_entry_new2(a: *mut Archive) -> *mut ArchiveEntry;
    fn archive_entry_free(e: *mut ArchiveEntry);
    fn archive_entry_set_pathname(e: *mut ArchiveEntry, name: *const c_char);
    fn archive_entry_set_pathname_utf8(e: *mut ArchiveEntry, name: *const c_char);
    fn archive_entry_copy_pathname(e: *mut ArchiveEntry, name: *const c_char);
    fn archive_entry_copy_pathname_w(e: *mut ArchiveEntry, name: *const u16);
    fn archive_entry_set_size(e: *mut ArchiveEntry, s: i64);
    fn archive_entry_set_filetype(e: *mut ArchiveEntry, t: c_uint);
    fn archive_entry_set_perm(e: *mut ArchiveEntry, p: Mode);
    fn archive_entry_set_mode(e: *mut ArchiveEntry, m: Mode);
    fn archive_entry_set_mtime(e: *mut ArchiveEntry, secs: isize, nsecs: c_long);
    fn archive_entry_clear(e: *mut ArchiveEntry) -> *mut ArchiveEntry;
    fn archive_entry_pathname(e: *mut ArchiveEntry) -> *const c_char;
    fn archive_entry_pathname_utf8(e: *mut ArchiveEntry) -> *const c_char;
    fn archive_entry_pathname_w(e: *mut ArchiveEntry) -> *const u16;
    fn archive_entry_filetype(e: *mut ArchiveEntry) -> Mode;
    fn archive_entry_perm(e: *mut ArchiveEntry) -> Mode;
    fn archive_entry_size(e: *mut ArchiveEntry) -> i64;
    fn archive_entry_symlink(e: *mut ArchiveEntry) -> *const c_char;
    pub fn archive_entry_symlink_utf8(e: *mut ArchiveEntry) -> *const c_char;
    pub fn archive_entry_symlink_type(e: *mut ArchiveEntry) -> SymlinkType;
    pub fn archive_entry_symlink_w(e: *mut ArchiveEntry) -> *const u16;
}

#[inline(always)]
fn ep(e: &ArchiveEntry) -> *mut ArchiveEntry {
    e as *const ArchiveEntry as *mut ArchiveEntry
}

impl ArchiveEntry {
    pub fn new() -> *mut ArchiveEntry {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_new() }
    }

    pub fn new2(archive: &Archive) -> *mut ArchiveEntry {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_new2(p(archive)) }
    }

    pub fn free(&self) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_free(ep(self)) }
    }

    pub fn set_pathname(&self, name: &ZStr) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_set_pathname(ep(self), name.as_ptr().cast()) }
    }

    pub fn set_pathname_utf8(&self, name: &ZStr) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_set_pathname_utf8(ep(self), name.as_ptr().cast()) }
    }

    pub fn copy_pathname(&self, name: &ZStr) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_copy_pathname(ep(self), name.as_ptr().cast()) }
    }

    pub fn copy_pathname_w(&self, name: &WStr) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_copy_pathname_w(ep(self), name.as_ptr()) }
    }

    pub fn set_size(&self, s: i64) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_set_size(ep(self), s) }
    }

    pub fn set_filetype(&self, type_: u32) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_set_filetype(ep(self), type_) }
    }

    pub fn set_perm(&self, perm: Mode) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_set_perm(ep(self), perm) }
    }

    pub fn set_mode(&self, mode: Mode) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_set_mode(ep(self), mode) }
    }

    pub fn set_mtime(&self, secs: isize, nsecs: c_long) {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_set_mtime(ep(self), secs, nsecs) }
    }

    pub fn clear(&self) -> *mut ArchiveEntry {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_clear(ep(self)) }
    }

    pub fn pathname(&self) -> &ZStr {
        // SAFETY: returns NUL-terminated string owned by the entry.
        unsafe { ZStr::from_ptr(archive_entry_pathname(ep(self)).cast()) }
    }
    pub fn pathname_utf8(&self) -> &ZStr {
        // SAFETY: libarchive returns a NUL-terminated string owned by the handle.
        unsafe { ZStr::from_ptr(archive_entry_pathname_utf8(ep(self)).cast()) }
    }
    pub fn pathname_w(&self) -> &WStr {
        // SAFETY: libarchive returns a NUL-terminated string owned by the handle.
        unsafe { WStr::from_ptr(archive_entry_pathname_w(ep(self))) }
    }
    pub fn filetype(&self) -> Mode {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_filetype(ep(self)) }
    }
    pub fn perm(&self) -> Mode {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_perm(ep(self)) }
    }
    pub fn size(&self) -> i64 {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_size(ep(self)) }
    }
    pub fn mtime(&self) -> i64 {
        // SAFETY: FFI call on valid opaque libarchive handle.
        i64::try_from(unsafe { archive_entry_mtime(ep(self).cast()) }).unwrap()
    }
    pub fn symlink(&self) -> &ZStr {
        // SAFETY: libarchive returns a NUL-terminated string owned by the handle.
        unsafe { ZStr::from_ptr(archive_entry_symlink(ep(self)).cast()) }
    }
    pub fn symlink_utf8(&self) -> &ZStr {
        // SAFETY: libarchive returns a NUL-terminated string owned by the handle.
        unsafe { ZStr::from_ptr(archive_entry_symlink_utf8(ep(self)).cast()) }
    }
    pub fn symlink_type(&self) -> SymlinkType {
        // SAFETY: FFI call on valid opaque libarchive handle.
        unsafe { archive_entry_symlink_type(ep(self)) }
    }
    pub fn symlink_w(&self) -> &WStr {
        // SAFETY: libarchive returns a NUL-terminated string owned by the handle.
        unsafe { WStr::from_ptr(archive_entry_symlink_w(ep(self))) }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Archive::Iterator
// ───────────────────────────────────────────────────────────────────────────

pub struct ArchiveIterator {
    pub archive: *mut Archive,
    // TODO(port): Zig used `std.EnumSet(std.fs.File.Kind)`; mapped to bun_sys::FileKind.
    pub filter: EnumSet<FileKind>,
}

/// Generic result type used by [`ArchiveIterator`] (Zig: `Iterator.Result(T)`).
pub enum IteratorResult<T> {
    Err {
        archive: *mut Archive,
        message: &'static [u8],
    },
    Result(T),
}

impl<T> IteratorResult<T> {
    pub fn init_err(arch: *mut Archive, msg: &'static [u8]) -> Self {
        Self::Err { message: msg, archive: arch }
    }

    pub fn init_res(value: T) -> Self {
        Self::Result(value)
    }
}

impl ArchiveIterator {
    pub fn init(tarball_bytes: &[u8]) -> IteratorResult<Self> {
        let archive = Archive::read_new();
        // SAFETY: archive_read_new() returns a non-null handle owned by libarchive.
        let a = unsafe { &*archive };

        match a.read_support_format_tar() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return IteratorResult::init_err(archive, b"failed to enable tar format support");
            }
            _ => {}
        }
        match a.read_support_format_gnutar() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return IteratorResult::init_err(archive, b"failed to enable gnutar format support");
            }
            _ => {}
        }
        match a.read_support_filter_gzip() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return IteratorResult::init_err(
                    archive,
                    b"failed to enable support for gzip compression",
                );
            }
            _ => {}
        }

        // TODO(port): need a const ZStr literal helper for "read_concatenated_archives"
        // SAFETY: byte literal is NUL-terminated and 'static.
        match a.read_set_options(unsafe { ZStr::from_ptr(b"read_concatenated_archives\0".as_ptr()) })
        {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return IteratorResult::init_err(
                    archive,
                    b"failed to set option `read_concatenated_archives`",
                );
            }
            _ => {}
        }

        match a.read_open_memory(tarball_bytes) {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return IteratorResult::init_err(archive, b"failed to read tarball");
            }
            _ => {}
        }

        IteratorResult::init_res(Self {
            archive,
            filter: EnumSet::empty(),
        })
    }

    pub fn next(&mut self) -> IteratorResult<Option<NextEntry>> {
        // SAFETY: self.archive is valid for the lifetime of the iterator.
        let a = unsafe { &*self.archive };
        let mut entry: *mut ArchiveEntry = core::ptr::null_mut();
        loop {
            return match a.read_next_header(&mut entry) {
                ArchiveResult::Retry => continue,
                ArchiveResult::Eof => IteratorResult::init_res(None),
                ArchiveResult::Ok => {
                    // SAFETY: entry was set by archive_read_next_header on Ok.
                    let kind = bun_sys::kind_from_mode(unsafe { (*entry).filetype() });

                    if self.filter.contains(kind) {
                        continue;
                    }

                    IteratorResult::init_res(Some(NextEntry { entry, kind }))
                }
                _ => IteratorResult::init_err(self.archive, b"failed to read archive header"),
            };
        }
    }

    // TODO(port): Zig `deinit` returns `Iterator.Result(void)`; cannot be `Drop`.
    // Per PORTING.md, explicit early release is exposed as `close(self)` taking ownership.
    pub fn close(self) -> IteratorResult<()> {
        // SAFETY: self.archive is valid until read_free.
        let a = unsafe { &*self.archive };
        match a.read_close() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return IteratorResult::init_err(self.archive, b"failed to close archive read");
            }
            _ => {}
        }
        match a.read_free() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return IteratorResult::init_err(self.archive, b"failed to free archive read");
            }
            _ => {}
        }

        IteratorResult::init_res(())
    }
}

pub struct NextEntry {
    pub entry: *mut ArchiveEntry,
    // TODO(port): Zig used `std.fs.File.Kind`; mapped to bun_sys::FileKind.
    pub kind: FileKind,
}

impl NextEntry {
    pub fn read_entry_data(
        &self,
        archive: &Archive,
    ) -> Result<IteratorResult<Box<[u8]>>, bun_alloc::AllocError> {
        // SAFETY: self.entry is the libarchive-owned entry from read_next_header.
        let size = unsafe { (*self.entry).size() };
        if size < 0 {
            return Ok(IteratorResult::init_err(p(archive), b"invalid archive entry size"));
        }

        let mut buf = vec![0u8; usize::try_from(size).unwrap()];

        let read = archive.read_data(&mut buf);
        if read < 0 {
            return Ok(IteratorResult::init_err(p(archive), b"failed to read archive data"));
        }
        buf.truncate(usize::try_from(read).unwrap());
        Ok(IteratorResult::init_res(buf.into_boxed_slice()))
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Callback typedefs + free-standing externs
// ───────────────────────────────────────────────────────────────────────────

pub type archive_read_callback =
    unsafe extern "C" fn(*mut struct_archive, *mut c_void, *mut *const c_void) -> la_ssize_t;
pub type archive_skip_callback =
    unsafe extern "C" fn(*mut struct_archive, *mut c_void, la_int64_t) -> la_int64_t;
pub type archive_seek_callback =
    unsafe extern "C" fn(*mut struct_archive, *mut c_void, la_int64_t, c_int) -> la_int64_t;
pub type archive_write_callback =
    unsafe extern "C" fn(*mut struct_archive, *mut c_void, *const c_void, usize) -> la_ssize_t;
pub type archive_open_callback = unsafe extern "C" fn(*mut struct_archive, *mut c_void) -> c_int;
pub type archive_close_callback = unsafe extern "C" fn(*mut struct_archive, *mut c_void) -> c_int;
pub type archive_free_callback = unsafe extern "C" fn(*mut struct_archive, *mut c_void) -> c_int;
pub type archive_switch_callback =
    unsafe extern "C" fn(*mut struct_archive, *mut c_void, *mut c_void) -> c_int;
pub type archive_passphrase_callback =
    unsafe extern "C" fn(*mut struct_archive, *mut c_void) -> *const c_char;

unsafe extern "C" {
    pub fn archive_read_support_compression_program(a: *mut struct_archive, command: *const c_char) -> c_int;
    pub fn archive_read_support_compression_program_signature(a: *mut struct_archive, cmd: *const c_char, sig: *const c_void, sig_len: usize) -> c_int;
    pub fn archive_read_support_filter_program(a: *mut struct_archive, command: *const c_char) -> c_int;
    pub fn archive_read_support_filter_program_signature(a: *mut struct_archive, cmd: *const c_char, sig: *const c_void, sig_len: usize) -> c_int;
    pub fn archive_read_set_format(a: *mut struct_archive, code: c_int) -> c_int;
    pub fn archive_read_append_filter(a: *mut struct_archive, code: c_int) -> c_int;
    pub fn archive_read_append_filter_program(a: *mut struct_archive, cmd: *const c_char) -> c_int;
    pub fn archive_read_append_filter_program_signature(a: *mut struct_archive, cmd: *const c_char, sig: *const c_void, sig_len: usize) -> c_int;
    pub fn archive_read_set_open_callback(a: *mut struct_archive, cb: Option<archive_open_callback>) -> c_int;
    pub fn archive_read_set_read_callback(a: *mut struct_archive, cb: Option<archive_read_callback>) -> c_int;
    pub fn archive_read_set_seek_callback(a: *mut struct_archive, cb: Option<archive_seek_callback>) -> c_int;
    pub fn archive_read_set_skip_callback(a: *mut struct_archive, cb: Option<archive_skip_callback>) -> c_int;
    pub fn archive_read_set_close_callback(a: *mut struct_archive, cb: Option<archive_close_callback>) -> c_int;
    pub fn archive_read_set_switch_callback(a: *mut struct_archive, cb: Option<archive_switch_callback>) -> c_int;
    pub fn archive_read_set_callback_data(a: *mut struct_archive, data: *mut c_void) -> c_int;
    pub fn archive_read_set_callback_data2(a: *mut struct_archive, data: *mut c_void, idx: c_uint) -> c_int;
    pub fn archive_read_add_callback_data(a: *mut struct_archive, data: *mut c_void, idx: c_uint) -> c_int;
    pub fn archive_read_append_callback_data(a: *mut struct_archive, data: *mut c_void) -> c_int;
    pub fn archive_read_prepend_callback_data(a: *mut struct_archive, data: *mut c_void) -> c_int;
    pub fn archive_read_open1(a: *mut struct_archive) -> c_int;
    pub fn archive_read_open(a: *mut struct_archive, client_data: *mut c_void, open: Option<archive_open_callback>, read: Option<archive_read_callback>, close: Option<archive_close_callback>) -> c_int;
    pub fn archive_read_open2(a: *mut struct_archive, client_data: *mut c_void, open: Option<archive_open_callback>, read: Option<archive_read_callback>, skip: Option<archive_skip_callback>, close: Option<archive_close_callback>) -> c_int;
    pub fn archive_read_open_filename(a: *mut struct_archive, filename: *const c_char, block_size: usize) -> c_int;
    pub fn archive_read_open_filenames(a: *mut struct_archive, filenames: *mut *const c_char, block_size: usize) -> c_int;
    pub fn archive_read_open_filename_w(a: *mut struct_archive, filename: *const wchar_t, block_size: usize) -> c_int;
    pub fn archive_read_open_file(a: *mut struct_archive, filename: *const c_char, block_size: usize) -> c_int;
    pub fn archive_read_open_memory2(a: *mut struct_archive, buff: *const c_void, size: usize, read_size: usize) -> c_int;
    pub fn archive_read_open_fd(a: *mut struct_archive, fd: c_int, block_size: usize) -> c_int;
    pub fn archive_read_open_FILE(a: *mut struct_archive, file: *mut FILE) -> c_int;
    pub fn archive_read_header_position(a: *mut struct_archive) -> la_int64_t;
    pub fn archive_read_has_encrypted_entries(a: *mut struct_archive) -> c_int;
    pub fn archive_read_format_capabilities(a: *mut struct_archive) -> c_int;
    pub fn archive_seek_data(a: *mut struct_archive, off: la_int64_t, whence: c_int) -> la_int64_t;
    pub fn archive_read_data_block(a: *mut struct_archive, buff: *mut *const c_void, size: *mut usize, offset: *mut la_int64_t) -> ArchiveResult;
    pub fn archive_read_data_skip(a: *mut struct_archive) -> c_int;
    pub fn archive_read_set_format_option(a: *mut struct_archive, m: *const c_char, o: *const c_char, v: *const c_char) -> c_int;
    pub fn archive_read_set_filter_option(a: *mut struct_archive, m: *const c_char, o: *const c_char, v: *const c_char) -> c_int;
    pub fn archive_read_add_passphrase(a: *mut struct_archive, pass: *const c_char) -> c_int;
    pub fn archive_read_set_passphrase_callback(a: *mut struct_archive, client_data: *mut c_void, cb: Option<archive_passphrase_callback>) -> c_int;
    pub fn archive_read_extract(a: *mut struct_archive, e: *mut struct_archive_entry, flags: c_int) -> c_int;
    pub fn archive_read_extract2(a: *mut struct_archive, e: *mut struct_archive_entry, dst: *mut struct_archive) -> c_int;
    pub fn archive_read_extract_set_progress_callback(a: *mut struct_archive, progress_func: Option<unsafe extern "C" fn(*mut c_void)>, user_data: *mut c_void);
    pub fn archive_read_extract_set_skip_file(a: *mut struct_archive, dev: la_int64_t, ino: la_int64_t);
    pub fn archive_write_set_bytes_per_block(a: *mut struct_archive, bytes_per_block: c_int) -> c_int;
    pub fn archive_write_get_bytes_per_block(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_bytes_in_last_block(a: *mut struct_archive, bytes_in_last_block: c_int) -> c_int;
    pub fn archive_write_get_bytes_in_last_block(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_skip_file(a: *mut struct_archive, dev: la_int64_t, ino: la_int64_t) -> c_int;
    // Deprecated: archive_write_set_compression_*
    pub fn archive_write_set_format_by_name(a: *mut struct_archive, name: *const c_char) -> c_int;
    pub fn archive_write_set_format_ar_bsd(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_ar_svr4(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_cpio(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_cpio_bin(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_cpio_newc(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_cpio_odc(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_cpio_pwb(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_iso9660(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_mtree(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_mtree_classic(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_raw(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_shar_dump(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_v7tar(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_warc(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_xar(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_filter_by_ext(a: *mut struct_archive, filename: *const c_char) -> c_int;
    pub fn archive_write_set_format_filter_by_ext_def(a: *mut struct_archive, filename: *const c_char, def_ext: *const c_char) -> c_int;
    pub fn archive_write_zip_set_compression_deflate(a: *mut struct_archive) -> c_int;
    pub fn archive_write_zip_set_compression_store(a: *mut struct_archive) -> c_int;
    pub fn archive_write_open(a: *mut struct_archive, client_data: *mut c_void, open: Option<archive_open_callback>, write: Option<archive_write_callback>, close: Option<archive_close_callback>) -> c_int;
    pub fn archive_write_open2(a: *mut struct_archive, client_data: *mut c_void, open: Option<archive_open_callback>, write: Option<archive_write_callback>, close: Option<archive_close_callback>, free: Option<archive_free_callback>) -> c_int;
    pub fn archive_write_open_filename_w(a: *mut struct_archive, file: *const wchar_t) -> c_int;
    pub fn archive_write_open_file(a: *mut struct_archive, file: *const c_char) -> c_int;
    pub fn archive_write_open_FILE(a: *mut struct_archive, file: *mut FILE) -> c_int;
    pub fn archive_write_data_block(a: *mut struct_archive, buff: *const c_void, len: usize, off: la_int64_t) -> la_ssize_t;
    pub fn archive_write_fail(a: *mut struct_archive) -> c_int;
    pub fn archive_write_set_format_option(a: *mut struct_archive, m: *const c_char, o: *const c_char, v: *const c_char) -> c_int;
    pub fn archive_write_set_option(a: *mut struct_archive, m: *const c_char, o: *const c_char, v: *const c_char) -> c_int;
    pub fn archive_write_set_passphrase(a: *mut struct_archive, p: *const c_char) -> c_int;
    pub fn archive_write_set_passphrase_callback(a: *mut struct_archive, client_data: *mut c_void, cb: Option<archive_passphrase_callback>) -> c_int;
    pub fn archive_write_disk_new() -> *mut struct_archive;
    pub fn archive_write_disk_set_skip_file(a: *mut struct_archive, dev: la_int64_t, ino: la_int64_t) -> c_int;
    pub fn archive_write_disk_set_options(a: *mut struct_archive, flags: c_int) -> c_int;
    pub fn archive_write_disk_set_standard_lookup(a: *mut struct_archive) -> c_int;
    pub fn archive_write_disk_set_group_lookup(a: *mut struct_archive, data: *mut c_void, lookup: Option<unsafe extern "C" fn(*mut c_void, *const c_char, la_int64_t) -> la_int64_t>, cleanup: Option<unsafe extern "C" fn(*mut c_void)>) -> c_int;
    pub fn archive_write_disk_set_user_lookup(a: *mut struct_archive, data: *mut c_void, lookup: Option<unsafe extern "C" fn(*mut c_void, *const c_char, la_int64_t) -> la_int64_t>, cleanup: Option<unsafe extern "C" fn(*mut c_void)>) -> c_int;
    pub fn archive_write_disk_gid(a: *mut struct_archive, name: *const c_char, id: la_int64_t) -> la_int64_t;
    pub fn archive_write_disk_uid(a: *mut struct_archive, name: *const c_char, id: la_int64_t) -> la_int64_t;
    pub fn archive_read_disk_new() -> *mut struct_archive;
    pub fn archive_read_disk_set_symlink_logical(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_set_symlink_physical(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_set_symlink_hybrid(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_entry_from_file(a: *mut struct_archive, e: *mut struct_archive_entry, fd: c_int, st: *const struct_stat) -> c_int;
    pub fn archive_read_disk_gname(a: *mut struct_archive, gid: la_int64_t) -> *const c_char;
    pub fn archive_read_disk_uname(a: *mut struct_archive, uid: la_int64_t) -> *const c_char;
    pub fn archive_read_disk_set_standard_lookup(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_set_gname_lookup(a: *mut struct_archive, data: *mut c_void, lookup: Option<unsafe extern "C" fn(*mut c_void, la_int64_t) -> *const c_char>, cleanup: Option<unsafe extern "C" fn(*mut c_void)>) -> c_int;
    pub fn archive_read_disk_set_uname_lookup(a: *mut struct_archive, data: *mut c_void, lookup: Option<unsafe extern "C" fn(*mut c_void, la_int64_t) -> *const c_char>, cleanup: Option<unsafe extern "C" fn(*mut c_void)>) -> c_int;
    pub fn archive_read_disk_open(a: *mut struct_archive, path: *const c_char) -> c_int;
    pub fn archive_read_disk_open_w(a: *mut struct_archive, path: *const wchar_t) -> c_int;
    pub fn archive_read_disk_descend(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_can_descend(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_current_filesystem(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_current_filesystem_is_synthetic(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_current_filesystem_is_remote(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_set_atime_restored(a: *mut struct_archive) -> c_int;
    pub fn archive_read_disk_set_behavior(a: *mut struct_archive, flags: c_int) -> c_int;
    pub fn archive_read_disk_set_matching(a: *mut struct_archive, matching: *mut struct_archive, excluded_func: Option<unsafe extern "C" fn(*mut struct_archive, *mut c_void, *mut struct_archive_entry)>, client_data: *mut c_void) -> c_int;
    pub fn archive_read_disk_set_metadata_filter_callback(a: *mut struct_archive, metadata_filter_func: Option<unsafe extern "C" fn(*mut struct_archive, *mut c_void, *mut struct_archive_entry) -> c_int>, client_data: *mut c_void) -> c_int;
    pub fn archive_filter_count(a: *mut struct_archive) -> c_int;
    pub fn archive_filter_bytes(a: *mut struct_archive, n: c_int) -> la_int64_t;
    pub fn archive_filter_code(a: *mut struct_archive, n: c_int) -> c_int;
    pub fn archive_filter_name(a: *mut struct_archive, n: c_int) -> *const c_char;
    pub fn archive_position_compressed(a: *mut struct_archive) -> la_int64_t;
    pub fn archive_position_uncompressed(a: *mut struct_archive) -> la_int64_t;
    pub fn archive_compression_name(a: *mut struct_archive) -> *const c_char;
    pub fn archive_compression(a: *mut struct_archive) -> c_int;
    pub fn archive_errno(a: *mut struct_archive) -> c_int;
    pub fn archive_format_name(a: *mut struct_archive) -> *const c_char;
    pub fn archive_format(a: *mut struct_archive) -> c_int;
    pub fn archive_clear_error(a: *mut struct_archive);
    pub fn archive_set_error(a: *mut struct_archive, err: c_int, fmt: *const c_char, ...);
    pub fn archive_copy_error(dest: *mut struct_archive, src: *mut struct_archive);
    pub fn archive_file_count(a: *mut struct_archive) -> c_int;
    pub fn archive_match_new() -> *mut struct_archive;
    pub fn archive_match_free(a: *mut struct_archive) -> c_int;
    pub fn archive_match_excluded(a: *mut struct_archive, e: *mut struct_archive_entry) -> c_int;
    pub fn archive_match_path_excluded(a: *mut struct_archive, e: *mut struct_archive_entry) -> c_int;
    pub fn archive_match_set_inclusion_recursion(a: *mut struct_archive, enabled: c_int) -> c_int;
    pub fn archive_match_exclude_pattern(a: *mut struct_archive, pattern: *const c_char) -> c_int;
    pub fn archive_match_exclude_pattern_w(a: *mut struct_archive, pattern: *const wchar_t) -> c_int;
    pub fn archive_match_exclude_pattern_from_file(a: *mut struct_archive, path: *const c_char, null_separator: c_int) -> c_int;
    pub fn archive_match_exclude_pattern_from_file_w(a: *mut struct_archive, path: *const wchar_t, null_separator: c_int) -> c_int;
    pub fn archive_match_include_pattern(a: *mut struct_archive, pattern: *const c_char) -> c_int;
    pub fn archive_match_include_pattern_w(a: *mut struct_archive, pattern: *const wchar_t) -> c_int;
    pub fn archive_match_include_pattern_from_file(a: *mut struct_archive, path: *const c_char, null_separator: c_int) -> c_int;
    pub fn archive_match_include_pattern_from_file_w(a: *mut struct_archive, path: *const wchar_t, null_separator: c_int) -> c_int;
    pub fn archive_match_path_unmatched_inclusions(a: *mut struct_archive) -> c_int;
    pub fn archive_match_path_unmatched_inclusions_next(a: *mut struct_archive, p: *mut *const c_char) -> c_int;
    pub fn archive_match_path_unmatched_inclusions_next_w(a: *mut struct_archive, p: *mut *const wchar_t) -> c_int;
    pub fn archive_match_time_excluded(a: *mut struct_archive, e: *mut struct_archive_entry) -> c_int;
    pub fn archive_match_include_time(a: *mut struct_archive, flag: c_int, sec: time_t, nsec: c_long) -> c_int;
    pub fn archive_match_include_date(a: *mut struct_archive, flag: c_int, datestr: *const c_char) -> c_int;
    pub fn archive_match_include_date_w(a: *mut struct_archive, flag: c_int, datestr: *const wchar_t) -> c_int;
    pub fn archive_match_include_file_time(a: *mut struct_archive, flag: c_int, pathname: *const c_char) -> c_int;
    pub fn archive_match_include_file_time_w(a: *mut struct_archive, flag: c_int, pathname: *const wchar_t) -> c_int;
    pub fn archive_match_exclude_entry(a: *mut struct_archive, flag: c_int, e: *mut struct_archive_entry) -> c_int;
    pub fn archive_match_owner_excluded(a: *mut struct_archive, e: *mut struct_archive_entry) -> c_int;
    pub fn archive_match_include_uid(a: *mut struct_archive, uid: la_int64_t) -> c_int;
    pub fn archive_match_include_gid(a: *mut struct_archive, gid: la_int64_t) -> c_int;
    pub fn archive_match_include_uname(a: *mut struct_archive, name: *const c_char) -> c_int;
    pub fn archive_match_include_uname_w(a: *mut struct_archive, name: *const wchar_t) -> c_int;
    pub fn archive_match_include_gname(a: *mut struct_archive, name: *const c_char) -> c_int;
    pub fn archive_match_include_gname_w(a: *mut struct_archive, name: *const wchar_t) -> c_int;
    pub fn archive_utility_string_sort(strings: *mut *mut c_char) -> c_int;

    pub fn archive_entry_clone(e: *mut struct_archive_entry) -> *mut struct_archive_entry;
    pub fn archive_entry_atime(e: *mut struct_archive_entry) -> time_t;
    pub fn archive_entry_atime_nsec(e: *mut struct_archive_entry) -> c_long;
    pub fn archive_entry_atime_is_set(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_birthtime(e: *mut struct_archive_entry) -> time_t;
    pub fn archive_entry_birthtime_nsec(e: *mut struct_archive_entry) -> c_long;
    pub fn archive_entry_birthtime_is_set(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_ctime(e: *mut struct_archive_entry) -> time_t;
    pub fn archive_entry_ctime_nsec(e: *mut struct_archive_entry) -> c_long;
    pub fn archive_entry_ctime_is_set(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_dev(e: *mut struct_archive_entry) -> dev_t;
    pub fn archive_entry_dev_is_set(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_devmajor(e: *mut struct_archive_entry) -> dev_t;
    pub fn archive_entry_devminor(e: *mut struct_archive_entry) -> dev_t;
    pub fn archive_entry_fflags(e: *mut struct_archive_entry, set: *mut u64, clear: *mut u64);
    pub fn archive_entry_fflags_text(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_gid(e: *mut struct_archive_entry) -> la_int64_t;
    pub fn archive_entry_gname(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_gname_utf8(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_gname_w(e: *mut struct_archive_entry) -> *const wchar_t;
    pub fn archive_entry_hardlink(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_hardlink_utf8(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_hardlink_w(e: *mut struct_archive_entry) -> *const wchar_t;
    pub fn archive_entry_ino(e: *mut struct_archive_entry) -> la_int64_t;
    pub fn archive_entry_ino64(e: *mut struct_archive_entry) -> la_int64_t;
    pub fn archive_entry_ino_is_set(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_mode(e: *mut struct_archive_entry) -> mode_t;
    pub fn archive_entry_mtime(e: *mut struct_archive_entry) -> time_t;
    pub fn archive_entry_mtime_nsec(e: *mut struct_archive_entry) -> c_long;
    pub fn archive_entry_mtime_is_set(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_nlink(e: *mut struct_archive_entry) -> c_uint;
    pub fn archive_entry_rdev(e: *mut struct_archive_entry) -> dev_t;
    pub fn archive_entry_rdevmajor(e: *mut struct_archive_entry) -> dev_t;
    pub fn archive_entry_rdevminor(e: *mut struct_archive_entry) -> dev_t;
    pub fn archive_entry_sourcepath(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_sourcepath_w(e: *mut struct_archive_entry) -> *const wchar_t;
    pub fn archive_entry_size_is_set(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_strmode(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_uid(e: *mut struct_archive_entry) -> la_int64_t;
    pub fn archive_entry_uname(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_uname_utf8(e: *mut struct_archive_entry) -> *const c_char;
    pub fn archive_entry_uname_w(e: *mut struct_archive_entry) -> *const wchar_t;
    pub fn archive_entry_is_data_encrypted(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_is_metadata_encrypted(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_is_encrypted(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_set_atime(e: *mut struct_archive_entry, t: time_t, ns: c_long);
    pub fn archive_entry_unset_atime(e: *mut struct_archive_entry);
    pub fn archive_entry_set_birthtime(e: *mut struct_archive_entry, t: time_t, ns: c_long);
    pub fn archive_entry_unset_birthtime(e: *mut struct_archive_entry);
    pub fn archive_entry_set_ctime(e: *mut struct_archive_entry, t: time_t, ns: c_long);
    pub fn archive_entry_unset_ctime(e: *mut struct_archive_entry);
    pub fn archive_entry_set_dev(e: *mut struct_archive_entry, d: dev_t);
    pub fn archive_entry_set_devmajor(e: *mut struct_archive_entry, d: dev_t);
    pub fn archive_entry_set_devminor(e: *mut struct_archive_entry, d: dev_t);
    pub fn archive_entry_set_fflags(e: *mut struct_archive_entry, set: u64, clear: u64);
    pub fn archive_entry_copy_fflags_text(e: *mut struct_archive_entry, s: *const c_char) -> *const c_char;
    pub fn archive_entry_copy_fflags_text_w(e: *mut struct_archive_entry, s: *const wchar_t) -> *const wchar_t;
    pub fn archive_entry_set_gid(e: *mut struct_archive_entry, gid: la_int64_t);
    pub fn archive_entry_set_gname(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_set_gname_utf8(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_gname(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_gname_w(e: *mut struct_archive_entry, s: *const wchar_t);
    pub fn archive_entry_update_gname_utf8(e: *mut struct_archive_entry, s: *const c_char) -> c_int;
    pub fn archive_entry_set_hardlink(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_set_hardlink_utf8(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_hardlink(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_hardlink_w(e: *mut struct_archive_entry, s: *const wchar_t);
    pub fn archive_entry_update_hardlink_utf8(e: *mut struct_archive_entry, s: *const c_char) -> c_int;
    pub fn archive_entry_set_ino(e: *mut struct_archive_entry, ino: la_int64_t);
    pub fn archive_entry_set_ino64(e: *mut struct_archive_entry, ino: la_int64_t);
    pub fn archive_entry_set_link(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_set_link_utf8(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_link(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_link_w(e: *mut struct_archive_entry, s: *const wchar_t);
    pub fn archive_entry_update_link_utf8(e: *mut struct_archive_entry, s: *const c_char) -> c_int;
    pub fn archive_entry_unset_mtime(e: *mut struct_archive_entry);
    pub fn archive_entry_set_nlink(e: *mut struct_archive_entry, n: c_uint);
    pub fn archive_entry_update_pathname_utf8(e: *mut struct_archive_entry, s: *const c_char) -> c_int;
    pub fn archive_entry_set_rdev(e: *mut struct_archive_entry, d: dev_t);
    pub fn archive_entry_set_rdevmajor(e: *mut struct_archive_entry, d: dev_t);
    pub fn archive_entry_set_rdevminor(e: *mut struct_archive_entry, d: dev_t);
    pub fn archive_entry_unset_size(e: *mut struct_archive_entry);
    pub fn archive_entry_copy_sourcepath(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_sourcepath_w(e: *mut struct_archive_entry, s: *const wchar_t);
    pub fn archive_entry_set_symlink(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_set_symlink_type(e: *mut struct_archive_entry, t: c_int);
    pub fn archive_entry_set_symlink_utf8(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_symlink(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_symlink_w(e: *mut struct_archive_entry, s: *const wchar_t);
    pub fn archive_entry_update_symlink_utf8(e: *mut struct_archive_entry, s: *const c_char) -> c_int;
    pub fn archive_entry_set_uid(e: *mut struct_archive_entry, uid: la_int64_t);
    pub fn archive_entry_set_uname(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_set_uname_utf8(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_uname(e: *mut struct_archive_entry, s: *const c_char);
    pub fn archive_entry_copy_uname_w(e: *mut struct_archive_entry, s: *const wchar_t);
    pub fn archive_entry_update_uname_utf8(e: *mut struct_archive_entry, s: *const c_char) -> c_int;
    pub fn archive_entry_set_is_data_encrypted(e: *mut struct_archive_entry, is_encrypted: u8);
    pub fn archive_entry_set_is_metadata_encrypted(e: *mut struct_archive_entry, is_encrypted: u8);
    pub fn archive_entry_stat(e: *mut struct_archive_entry) -> *const struct_stat;
    pub fn archive_entry_copy_stat(e: *mut struct_archive_entry, st: *const struct_stat);
    pub fn archive_entry_mac_metadata(e: *mut struct_archive_entry, size: *mut usize) -> *const c_void;
    pub fn archive_entry_copy_mac_metadata(e: *mut struct_archive_entry, data: *const c_void, size: usize);
    pub fn archive_entry_digest(e: *mut struct_archive_entry, kind: c_int) -> *const c_char;
    pub fn archive_entry_acl_clear(e: *mut struct_archive_entry);
    pub fn archive_entry_acl_add_entry(e: *mut struct_archive_entry, type_: c_int, permset: c_int, tag: c_int, qual: c_int, name: *const c_char) -> c_int;
    pub fn archive_entry_acl_add_entry_w(e: *mut struct_archive_entry, type_: c_int, permset: c_int, tag: c_int, qual: c_int, name: *const wchar_t) -> c_int;
    pub fn archive_entry_acl_reset(e: *mut struct_archive_entry, want_type: c_int) -> c_int;
    pub fn archive_entry_acl_next(e: *mut struct_archive_entry, want_type: c_int, type_: *mut c_int, permset: *mut c_int, tag: *mut c_int, qual: *mut c_int, name: *mut *const c_char) -> c_int;
    pub fn archive_entry_acl_to_text_w(e: *mut struct_archive_entry, len: *mut la_ssize_t, flags: c_int) -> *mut wchar_t;
    pub fn archive_entry_acl_to_text(e: *mut struct_archive_entry, len: *mut la_ssize_t, flags: c_int) -> *mut c_char;
    pub fn archive_entry_acl_from_text_w(e: *mut struct_archive_entry, text: *const wchar_t, type_: c_int) -> c_int;
    pub fn archive_entry_acl_from_text(e: *mut struct_archive_entry, text: *const c_char, type_: c_int) -> c_int;
    pub fn archive_entry_acl_text_w(e: *mut struct_archive_entry, flags: c_int) -> *const wchar_t;
    pub fn archive_entry_acl_text(e: *mut struct_archive_entry, flags: c_int) -> *const c_char;
    pub fn archive_entry_acl_types(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_acl_count(e: *mut struct_archive_entry, want_type: c_int) -> c_int;
    pub fn archive_entry_acl(e: *mut struct_archive_entry) -> *mut struct_archive_acl;
    pub fn archive_entry_xattr_clear(e: *mut struct_archive_entry);
    pub fn archive_entry_xattr_add_entry(e: *mut struct_archive_entry, name: *const c_char, value: *const c_void, size: usize);
    pub fn archive_entry_xattr_count(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_xattr_reset(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_xattr_next(e: *mut struct_archive_entry, name: *mut *const c_char, value: *mut *const c_void, size: *mut usize) -> c_int;
    pub fn archive_entry_sparse_clear(e: *mut struct_archive_entry);
    pub fn archive_entry_sparse_add_entry(e: *mut struct_archive_entry, offset: la_int64_t, length: la_int64_t);
    pub fn archive_entry_sparse_count(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_sparse_reset(e: *mut struct_archive_entry) -> c_int;
    pub fn archive_entry_sparse_next(e: *mut struct_archive_entry, offset: *mut la_int64_t, length: *mut la_int64_t) -> c_int;
    pub fn archive_entry_linkresolver_new() -> *mut struct_archive_entry_linkresolver;
    pub fn archive_entry_linkresolver_set_strategy(r: *mut struct_archive_entry_linkresolver, format: c_int);
    pub fn archive_entry_linkresolver_free(r: *mut struct_archive_entry_linkresolver);
    pub fn archive_entry_linkify(r: *mut struct_archive_entry_linkresolver, e1: *mut *mut struct_archive_entry, e2: *mut *mut struct_archive_entry);
    pub fn archive_entry_partial_links(res: *mut struct_archive_entry_linkresolver, links: *mut c_uint) -> *mut struct_archive_entry;
}

#[repr(C)]
pub struct struct_stat {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(C)]
pub struct struct_archive_acl {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(C)]
pub struct struct_archive_entry_linkresolver {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

pub type archive_acl = struct_archive_acl;
pub type archive_entry_linkresolver = struct_archive_entry_linkresolver;

pub const AE_SYMLINK_TYPE_UNDEFINED: c_int = 0;
pub const AE_SYMLINK_TYPE_FILE: c_int = 1;
pub const AE_SYMLINK_TYPE_DIRECTORY: c_int = 2;
pub const ARCHIVE_ENTRY_DIGEST_MD5: c_int = 0x00000001;
pub const ARCHIVE_ENTRY_DIGEST_RMD160: c_int = 0x00000002;
pub const ARCHIVE_ENTRY_DIGEST_SHA1: c_int = 0x00000003;
pub const ARCHIVE_ENTRY_DIGEST_SHA256: c_int = 0x00000004;
pub const ARCHIVE_ENTRY_DIGEST_SHA384: c_int = 0x00000005;
pub const ARCHIVE_ENTRY_DIGEST_SHA512: c_int = 0x00000006;
pub const ARCHIVE_ENTRY_ACL_EXECUTE: c_int = 0x00000001;
pub const ARCHIVE_ENTRY_ACL_WRITE: c_int = 0x00000002;
pub const ARCHIVE_ENTRY_ACL_READ: c_int = 0x00000004;
pub const ARCHIVE_ENTRY_ACL_READ_DATA: c_int = 0x00000008;
pub const ARCHIVE_ENTRY_ACL_LIST_DIRECTORY: c_int = 0x00000008;
pub const ARCHIVE_ENTRY_ACL_WRITE_DATA: c_int = 0x00000010;
pub const ARCHIVE_ENTRY_ACL_ADD_FILE: c_int = 0x00000010;
pub const ARCHIVE_ENTRY_ACL_APPEND_DATA: c_int = 0x00000020;
pub const ARCHIVE_ENTRY_ACL_ADD_SUBDIRECTORY: c_int = 0x00000020;
pub const ARCHIVE_ENTRY_ACL_READ_NAMED_ATTRS: c_int = 0x00000040;
pub const ARCHIVE_ENTRY_ACL_WRITE_NAMED_ATTRS: c_int = 0x00000080;
pub const ARCHIVE_ENTRY_ACL_DELETE_CHILD: c_int = 0x00000100;
pub const ARCHIVE_ENTRY_ACL_READ_ATTRIBUTES: c_int = 0x00000200;
pub const ARCHIVE_ENTRY_ACL_WRITE_ATTRIBUTES: c_int = 0x00000400;
pub const ARCHIVE_ENTRY_ACL_DELETE: c_int = 0x00000800;
pub const ARCHIVE_ENTRY_ACL_READ_ACL: c_int = 0x00001000;
pub const ARCHIVE_ENTRY_ACL_WRITE_ACL: c_int = 0x00002000;
pub const ARCHIVE_ENTRY_ACL_WRITE_OWNER: c_int = 0x00004000;
pub const ARCHIVE_ENTRY_ACL_SYNCHRONIZE: c_int = 0x00008000;
pub const ARCHIVE_ENTRY_ACL_PERMS_POSIX1E: c_int =
    ARCHIVE_ENTRY_ACL_EXECUTE | ARCHIVE_ENTRY_ACL_WRITE | ARCHIVE_ENTRY_ACL_READ;
pub const ARCHIVE_ENTRY_ACL_PERMS_NFS4: c_int = ARCHIVE_ENTRY_ACL_EXECUTE
    | ARCHIVE_ENTRY_ACL_READ_DATA
    | ARCHIVE_ENTRY_ACL_LIST_DIRECTORY
    | ARCHIVE_ENTRY_ACL_WRITE_DATA
    | ARCHIVE_ENTRY_ACL_ADD_FILE
    | ARCHIVE_ENTRY_ACL_APPEND_DATA
    | ARCHIVE_ENTRY_ACL_ADD_SUBDIRECTORY
    | ARCHIVE_ENTRY_ACL_READ_NAMED_ATTRS
    | ARCHIVE_ENTRY_ACL_WRITE_NAMED_ATTRS
    | ARCHIVE_ENTRY_ACL_DELETE_CHILD
    | ARCHIVE_ENTRY_ACL_READ_ATTRIBUTES
    | ARCHIVE_ENTRY_ACL_WRITE_ATTRIBUTES
    | ARCHIVE_ENTRY_ACL_DELETE
    | ARCHIVE_ENTRY_ACL_READ_ACL
    | ARCHIVE_ENTRY_ACL_WRITE_ACL
    | ARCHIVE_ENTRY_ACL_WRITE_OWNER
    | ARCHIVE_ENTRY_ACL_SYNCHRONIZE;
pub const ARCHIVE_ENTRY_ACL_ENTRY_INHERITED: c_int = 0x01000000;
pub const ARCHIVE_ENTRY_ACL_ENTRY_FILE_INHERIT: c_int = 0x02000000;
pub const ARCHIVE_ENTRY_ACL_ENTRY_DIRECTORY_INHERIT: c_int = 0x04000000;
pub const ARCHIVE_ENTRY_ACL_ENTRY_NO_PROPAGATE_INHERIT: c_int = 0x08000000;
pub const ARCHIVE_ENTRY_ACL_ENTRY_INHERIT_ONLY: c_int = 0x10000000;
pub const ARCHIVE_ENTRY_ACL_ENTRY_SUCCESSFUL_ACCESS: c_int = 0x20000000;
pub const ARCHIVE_ENTRY_ACL_ENTRY_FAILED_ACCESS: c_int = 0x40000000;
pub const ARCHIVE_ENTRY_ACL_INHERITANCE_NFS4: c_int = ARCHIVE_ENTRY_ACL_ENTRY_FILE_INHERIT
    | ARCHIVE_ENTRY_ACL_ENTRY_DIRECTORY_INHERIT
    | ARCHIVE_ENTRY_ACL_ENTRY_NO_PROPAGATE_INHERIT
    | ARCHIVE_ENTRY_ACL_ENTRY_INHERIT_ONLY
    | ARCHIVE_ENTRY_ACL_ENTRY_SUCCESSFUL_ACCESS
    | ARCHIVE_ENTRY_ACL_ENTRY_FAILED_ACCESS
    | ARCHIVE_ENTRY_ACL_ENTRY_INHERITED;
pub const ARCHIVE_ENTRY_ACL_TYPE_ACCESS: c_int = 0x00000100;
pub const ARCHIVE_ENTRY_ACL_TYPE_DEFAULT: c_int = 0x00000200;
pub const ARCHIVE_ENTRY_ACL_TYPE_ALLOW: c_int = 0x00000400;
pub const ARCHIVE_ENTRY_ACL_TYPE_DENY: c_int = 0x00000800;
pub const ARCHIVE_ENTRY_ACL_TYPE_AUDIT: c_int = 0x00001000;
pub const ARCHIVE_ENTRY_ACL_TYPE_ALARM: c_int = 0x00002000;
pub const ARCHIVE_ENTRY_ACL_TYPE_POSIX1E: c_int =
    ARCHIVE_ENTRY_ACL_TYPE_ACCESS | ARCHIVE_ENTRY_ACL_TYPE_DEFAULT;
pub const ARCHIVE_ENTRY_ACL_TYPE_NFS4: c_int = ARCHIVE_ENTRY_ACL_TYPE_ALLOW
    | ARCHIVE_ENTRY_ACL_TYPE_DENY
    | ARCHIVE_ENTRY_ACL_TYPE_AUDIT
    | ARCHIVE_ENTRY_ACL_TYPE_ALARM;
pub const ARCHIVE_ENTRY_ACL_USER: c_int = 10001;
pub const ARCHIVE_ENTRY_ACL_USER_OBJ: c_int = 10002;
pub const ARCHIVE_ENTRY_ACL_GROUP: c_int = 10003;
pub const ARCHIVE_ENTRY_ACL_GROUP_OBJ: c_int = 10004;
pub const ARCHIVE_ENTRY_ACL_MASK: c_int = 10005;
pub const ARCHIVE_ENTRY_ACL_OTHER: c_int = 10006;
pub const ARCHIVE_ENTRY_ACL_EVERYONE: c_int = 10107;
pub const ARCHIVE_ENTRY_ACL_STYLE_EXTRA_ID: c_int = 0x00000001;
pub const ARCHIVE_ENTRY_ACL_STYLE_MARK_DEFAULT: c_int = 0x00000002;
pub const ARCHIVE_ENTRY_ACL_STYLE_SOLARIS: c_int = 0x00000004;
pub const ARCHIVE_ENTRY_ACL_STYLE_SEPARATOR_COMMA: c_int = 0x00000008;
pub const ARCHIVE_ENTRY_ACL_STYLE_COMPACT: c_int = 0x00000010;
pub const OLD_ARCHIVE_ENTRY_ACL_STYLE_EXTRA_ID: c_int = 1024;
pub const OLD_ARCHIVE_ENTRY_ACL_STYLE_MARK_DEFAULT: c_int = 2048;

/// Growing memory buffer for archive writes with libarchive callbacks
pub struct GrowingBuffer {
    pub list: Vec<u8>,
    pub had_error: bool,
}

impl Default for GrowingBuffer {
    fn default() -> Self {
        Self { list: Vec::new(), had_error: false }
    }
}

impl GrowingBuffer {
    pub fn init() -> GrowingBuffer {
        GrowingBuffer::default()
    }

    // Zig `deinit` only freed `list`; Vec drops automatically — no explicit Drop needed.

    pub fn to_owned_slice(&mut self) -> Result<Box<[u8]>, bun_alloc::AllocError> {
        if self.had_error {
            return Err(bun_alloc::AllocError);
        }
        Ok(core::mem::take(&mut self.list).into_boxed_slice())
    }

    pub unsafe extern "C" fn open_callback(_a: *mut struct_archive, client_data: *mut c_void) -> c_int {
        // SAFETY: client_data is a *mut GrowingBuffer registered via archive_write_open*.
        let this = unsafe { &mut *(client_data as *mut GrowingBuffer) };
        this.list.clear();
        this.had_error = false;
        0
    }

    pub unsafe extern "C" fn write_callback(
        _a: *mut struct_archive,
        client_data: *mut c_void,
        buff: *const c_void,
        length: usize,
    ) -> la_ssize_t {
        // SAFETY: client_data is a *mut GrowingBuffer registered via archive_write_open*.
        let this = unsafe { &mut *(client_data as *mut GrowingBuffer) };
        if buff.is_null() || length == 0 {
            return 0;
        }
        // SAFETY: buff[0..length] is valid for reads per libarchive contract.
        let data = unsafe { core::slice::from_raw_parts(buff.cast::<u8>(), length) };
        // Vec::try_reserve + extend to mirror Zig's `appendSlice catch` OOM handling.
        if this.list.try_reserve(length).is_err() {
            this.had_error = true;
            return -1;
        }
        this.list.extend_from_slice(data);
        la_ssize_t::try_from(length).unwrap()
    }

    pub unsafe extern "C" fn close_callback(_a: *mut struct_archive, _client_data: *mut c_void) -> c_int {
        0
    }
}

// TODO(port): platform-specific libc types — verify in Phase B.
#[allow(non_camel_case_types)]
type dev_t = u64;
/// Opaque libc `FILE` (only used as `*mut FILE` across FFI).
#[repr(C)]
pub struct FILE {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/libarchive_sys/bindings.zig (1506 lines)
//   confidence: medium
//   todos:      7
//   notes:      EntryACL ported as newtype (duplicate discriminants); std.fs.File.Kind→bun_sys::FileKind; Iterator.deinit→close(self) (returns value, consumes); Block.bytes is raw *const [u8]
// ──────────────────────────────────────────────────────────────────────────
