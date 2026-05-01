/**
 * libarchive — multi-format archive reader/writer. Bun uses it for tarball
 * extraction during `bun install` (npm packages ship as tarballs) and
 * `bun pm pack`.
 *
 * Minimal config: tar + gzip only. Every other codec backend (bz2/lzma/lz4/
 * zstd/openssl/iconv/...) is left out of config.h, so the corresponding
 * `archive_*_support_*` calls compile to "format not supported" stubs.
 *
 * DirectBuild: cmake's configure step here was ~22s of try_compile probes
 * to fill in config.h. We replace it with a static per-target header and
 * compile the source list straight into our ninja graph. Side benefit:
 * the cmake build was non-hermetic — it would detect host libacl/libmd
 * and emit references bun never links. The hand-written config.h omits
 * those entirely.
 */

import type { Config } from "../config.ts";
import type { Dependency } from "../source.ts";
import { depBuildDir } from "../source.ts";

const LIBARCHIVE_COMMIT = "ded82291ab41d5e355831b96b0e1ff49e24d8939";

// The unconditional list from libarchive/CMakeLists.txt + the two blake2
// reference impls (added when libb2 isn't linked, which it never is here).
// All formats/filters compile even though most are stubbed at runtime —
// bun's bindings call archive_read_support_{format,filter}_all, which
// reference every registration symbol.
// prettier-ignore
const SOURCES = [
  "archive_acl", "archive_check_magic", "archive_cmdline", "archive_cryptor",
  "archive_digest", "archive_entry", "archive_entry_copy_stat",
  "archive_entry_link_resolver", "archive_entry_sparse", "archive_entry_stat",
  "archive_entry_strmode", "archive_entry_xattr", "archive_hmac", "archive_match",
  "archive_options", "archive_pack_dev", "archive_parse_date", "archive_pathmatch",
  "archive_ppmd8", "archive_ppmd7", "archive_random", "archive_rb", "archive_read",
  "archive_read_add_passphrase", "archive_read_append_filter",
  "archive_read_data_into_fd", "archive_read_disk_entry_from_file",
  "archive_read_disk_posix", "archive_read_disk_set_standard_lookup",
  "archive_read_extract", "archive_read_extract2", "archive_read_open_fd",
  "archive_read_open_file", "archive_read_open_filename", "archive_read_open_memory",
  "archive_read_set_format", "archive_read_set_options",
  "archive_read_support_filter_all", "archive_read_support_filter_by_code",
  "archive_read_support_filter_bzip2", "archive_read_support_filter_compress",
  "archive_read_support_filter_gzip", "archive_read_support_filter_grzip",
  "archive_read_support_filter_lrzip", "archive_read_support_filter_lz4",
  "archive_read_support_filter_lzop", "archive_read_support_filter_none",
  "archive_read_support_filter_program", "archive_read_support_filter_rpm",
  "archive_read_support_filter_uu", "archive_read_support_filter_xz",
  "archive_read_support_filter_zstd", "archive_read_support_format_7zip",
  "archive_read_support_format_all", "archive_read_support_format_ar",
  "archive_read_support_format_by_code", "archive_read_support_format_cab",
  "archive_read_support_format_cpio", "archive_read_support_format_empty",
  "archive_read_support_format_iso9660", "archive_read_support_format_lha",
  "archive_read_support_format_mtree", "archive_read_support_format_rar",
  "archive_read_support_format_rar5", "archive_read_support_format_raw",
  "archive_read_support_format_tar", "archive_read_support_format_warc",
  "archive_read_support_format_xar", "archive_read_support_format_zip",
  "archive_string", "archive_string_sprintf", "archive_time", "archive_util",
  "archive_version_details", "archive_virtual", "archive_write",
  "archive_write_disk_posix", "archive_write_disk_set_standard_lookup",
  "archive_write_open_fd", "archive_write_open_file", "archive_write_open_filename",
  "archive_write_open_memory", "archive_write_add_filter",
  "archive_write_add_filter_b64encode", "archive_write_add_filter_by_name",
  "archive_write_add_filter_bzip2", "archive_write_add_filter_compress",
  "archive_write_add_filter_grzip", "archive_write_add_filter_gzip",
  "archive_write_add_filter_lrzip", "archive_write_add_filter_lz4",
  "archive_write_add_filter_lzop", "archive_write_add_filter_none",
  "archive_write_add_filter_program", "archive_write_add_filter_uuencode",
  "archive_write_add_filter_xz", "archive_write_add_filter_zstd",
  "archive_write_set_format", "archive_write_set_format_7zip",
  "archive_write_set_format_ar", "archive_write_set_format_by_name",
  "archive_write_set_format_cpio", "archive_write_set_format_cpio_binary",
  "archive_write_set_format_cpio_newc", "archive_write_set_format_cpio_odc",
  "archive_write_set_format_filter_by_ext", "archive_write_set_format_gnutar",
  "archive_write_set_format_iso9660", "archive_write_set_format_mtree",
  "archive_write_set_format_pax", "archive_write_set_format_raw",
  "archive_write_set_format_shar", "archive_write_set_format_ustar",
  "archive_write_set_format_v7tar", "archive_write_set_format_warc",
  "archive_write_set_format_xar", "archive_write_set_format_zip",
  "archive_write_set_options", "archive_write_set_passphrase",
  "filter_fork_posix", "xxhash",
  "archive_blake2sp_ref", "archive_blake2s_ref",
];

const SOURCES_WIN = [
  "archive_entry_copy_bhfi",
  "archive_read_disk_windows",
  "archive_windows",
  "archive_write_disk_windows",
  "filter_fork_windows",
];

export const libarchive: Dependency = {
  name: "libarchive",
  versionMacro: "LIBARCHIVE",

  source: () => ({
    kind: "github-archive",
    repo: "libarchive/libarchive",
    commit: LIBARCHIVE_COMMIT,
  }),

  patches: [
    "patches/libarchive/archive_write_add_filter_gzip.c.patch",
    // Propagate ARCHIVE_RETRY from the client read callback up through
    // the gzip filter and tar reader so the worker-thread extract loop
    // in `bun install` can yield and resume as HTTP chunks arrive. See
    // src/install/TarballStream.zig.
    "patches/libarchive/nonblocking-read.patch",
  ],

  // zlib-ng generates zlib.h during its own build; libarchive's gzip filter
  // includes it. We don't link zlib here (bun's final link does), just need
  // the header on -I.
  fetchDeps: ["zlib"],

  build: cfg => ({
    kind: "direct",
    sources: [...SOURCES, ...(cfg.windows ? SOURCES_WIN : [])].map(s => `libarchive/${s}.c`),
    // zlib's build dir holds the generated zlib.h (subst'd from .in) that
    // the gzip filter includes. Absolute path → emitDirect quotes it.
    // android: archive.h does `#include <android_lf.h>` under __ANDROID__;
    // that header lives under contrib/android/include.
    includes: ["libarchive", depBuildDir(cfg, "zlib"), ...(cfg.abi === "android" ? ["contrib/android/include"] : [])],
    pic: true,
    defines: {
      HAVE_CONFIG_H: 1,
      LIBARCHIVE_STATIC: 1,
      // ELF-only; clang-cl doesn't support __attribute__((visibility)).
      ...(!cfg.windows && { __LIBARCHIVE_ENABLE_VISIBILITY: true }),
      // Upstream's CMakeLists sets this on MSVC; the DirectBuild conversion
      // missed it (97× -Wdeprecated-declarations on localtime/strncpy/etc).
      ...(cfg.windows && { _CRT_SECURE_NO_DEPRECATE: true }),
    },
    cflags: [
      ...(cfg.windows ? [] : ["-fvisibility=hidden"]),
      // Vendored C; const-discard casts in archive_options/_pack_dev/etc.
      "-Wno-incompatible-pointer-types-discards-qualifiers",
    ],
    headers: { "config.h": configH(cfg) },
  }),

  provides: cfg => ({
    libs: [],
    includes: cfg.abi === "android" ? ["libarchive", "contrib/android/include"] : ["libarchive"],
  }),
};

// ───────────────────────────────────────────────────────────────────────────
// config.h — replaces cmake's feature-detection pass
// ───────────────────────────────────────────────────────────────────────────
//
// Mirrors the relevant subset of build/cmake/config.h.in for our four
// targets (linux-gnu, linux-musl, darwin, windows). Anything not defined
// here makes libarchive take its portable fallback.
//
// Deliberately omitted regardless of host:
//   - HAVE_{BZLIB,LZMA,LZ4,ZSTD,OPENSSL,NETTLE,MBEDTLS,ICONV,LIBXML2,EXPAT,
//     LIBB2}_H — codecs we don't ship.
//   - HAVE_LIB{ACL,ATTR,MD} / ARCHIVE_ACL_* / ARCHIVE_CRYPTO_* — the cmake
//     build would pick these up if dev headers happen to be installed,
//     producing a non-hermetic binary. Bun never calls the ACL/digest entry
//     points, so the extra code was dead-stripped anyway.
//
// If a libarchive bump adds a new HAVE_* check, the worst case is a missed
// optimization. The two cases that fail loudly are SIZEOF_LONG/WCHAR_T and
// the struct-stat-nsec field name — both pinned per-target below.

const def1 = (names: string[]) => names.map(n => `#define ${n} 1`).join("\n");

// prettier-ignore
const ALWAYS = def1([
  "HAVE_INT16_T", "HAVE_INT32_T", "HAVE_INT64_T", "HAVE_INTMAX_T",
  "HAVE_UINT8_T", "HAVE_UINT16_T", "HAVE_UINT32_T", "HAVE_UINT64_T", "HAVE_UINTMAX_T",
  "HAVE_DECL_INT32_MAX", "HAVE_DECL_INT32_MIN", "HAVE_DECL_INT64_MAX", "HAVE_DECL_INT64_MIN",
  "HAVE_DECL_INTMAX_MAX", "HAVE_DECL_INTMAX_MIN", "HAVE_DECL_SIZE_MAX",
  "HAVE_DECL_UINT32_MAX", "HAVE_DECL_UINT64_MAX", "HAVE_DECL_UINTMAX_MAX",
  "HAVE_CTYPE_H", "HAVE_ERRNO_H", "HAVE_FCNTL_H", "HAVE_LIMITS_H", "HAVE_LOCALE_H",
  "HAVE_SIGNAL_H", "HAVE_STDARG_H", "HAVE_STDINT_H", "HAVE_STDIO_H", "HAVE_STDLIB_H",
  "HAVE_STRING_H", "HAVE_TIME_H", "HAVE_WCHAR_H", "HAVE_WCTYPE_H", "HAVE_SYS_STAT_H",
  "HAVE_SYS_TYPES_H", "HAVE_INTTYPES_H",
  "HAVE_EILSEQ", "HAVE_WCHAR_T", "HAVE_FSTAT", "HAVE_GETPID", "HAVE_MEMMOVE",
  "HAVE_MEMORY_H", "HAVE_MKDIR", "HAVE_SETLOCALE", "HAVE_STRCHR", "HAVE_STRDUP",
  "HAVE_STRERROR", "HAVE_STRFTIME", "HAVE_STRNLEN", "HAVE_STRRCHR", "HAVE_TZSET",
  "HAVE_VPRINTF", "HAVE_WCRTOMB", "HAVE_WCSCMP", "HAVE_WCSCPY", "HAVE_WCSLEN",
  "HAVE_WCTOMB", "HAVE_WMEMCMP", "HAVE_WMEMCPY", "HAVE_WMEMMOVE", "HAVE_MBRTOWC",
  "HAVE_ZLIB_H",
]);

// POSIX: every non-Windows target (linux glibc, linux musl, darwin).
// prettier-ignore
const POSIX = def1([
  "HAVE_DECL_SSIZE_MAX", "HAVE_DECL_STRERROR_R",
  "HAVE_DIRENT_H", "HAVE_DLFCN_H", "HAVE_FNMATCH_H", "HAVE_GRP_H", "HAVE_LANGINFO_H",
  "HAVE_PATHS_H", "HAVE_POLL_H", "HAVE_PTHREAD_H", "HAVE_PWD_H", "HAVE_REGEX_H",
  "HAVE_SPAWN_H", "HAVE_STRINGS_H", "HAVE_SYS_CDEFS_H", "HAVE_SYS_IOCTL_H",
  "HAVE_SYS_MOUNT_H", "HAVE_SYS_PARAM_H", "HAVE_SYS_POLL_H", "HAVE_SYS_SELECT_H",
  "HAVE_SYS_STATVFS_H", "HAVE_SYS_TIME_H", "HAVE_SYS_UTSNAME_H", "HAVE_SYS_WAIT_H",
  "HAVE_UNISTD_H", "HAVE_UTIME_H",
  "HAVE_CHOWN", "HAVE_CHROOT", "HAVE_CTIME_R", "HAVE_DIRFD",
  "HAVE_FCHDIR", "HAVE_FCHMOD", "HAVE_FCHOWN", "HAVE_FCNTL", "HAVE_FDOPENDIR",
  "HAVE_FNMATCH", "HAVE_FORK", "HAVE_FSEEKO", "HAVE_FSTATAT", "HAVE_FSTATVFS",
  "HAVE_FTRUNCATE", "HAVE_FUTIMENS", "HAVE_FUTIMES", "HAVE_GETEGID", "HAVE_GETEUID",
  "HAVE_GETGRGID_R", "HAVE_GETGRNAM_R", "HAVE_GETLINE", "HAVE_GETPWNAM_R",
  "HAVE_GETPWUID_R", "HAVE_GMTIME_R", "HAVE_LCHOWN", "HAVE_LINK", "HAVE_LINKAT",
  "HAVE_LOCALTIME_R", "HAVE_LSTAT", "HAVE_LUTIMES", "HAVE_MKFIFO", "HAVE_MKNOD",
  "HAVE_MKSTEMP", "HAVE_NL_LANGINFO", "HAVE_OPENAT", "HAVE_PIPE", "HAVE_POLL",
  "HAVE_POSIX_SPAWNP", "HAVE_READLINK", "HAVE_READLINKAT", "HAVE_SELECT",
  "HAVE_SETENV", "HAVE_SIGACTION", "HAVE_STATVFS", "HAVE_STRERROR_R",
  "HAVE_SYMLINK", "HAVE_SYSCONF", "HAVE_TCGETATTR", "HAVE_TCSETATTR", "HAVE_TIMEGM",
  "HAVE_UNLINKAT", "HAVE_UNSETENV", "HAVE_UTIME", "HAVE_UTIMENSAT", "HAVE_UTIMES",
  "HAVE_VFORK",
  "HAVE_STRUCT_STAT_ST_BLKSIZE", "HAVE_STRUCT_TM_TM_GMTOFF",
]);

// Linux-only. xattr via <sys/xattr.h> directly — modern glibc/musl ship it,
// no -lattr needed.
// prettier-ignore
const LINUX = def1([
  "HAVE_LINUX_FIEMAP_H", "HAVE_LINUX_FS_H", "HAVE_LINUX_MAGIC_H", "HAVE_LINUX_TYPES_H",
  "HAVE_SYS_STATFS_H", "HAVE_SYS_SYSMACROS_H", "HAVE_SYS_VFS_H", "HAVE_SYS_XATTR_H",
  "HAVE_STATFS", "HAVE_FSTATFS", "HAVE_FUTIMESAT",
  "HAVE_FGETXATTR", "HAVE_FLISTXATTR", "HAVE_FSETXATTR", "HAVE_GETXATTR",
  "HAVE_LGETXATTR", "HAVE_LISTXATTR", "HAVE_LLISTXATTR", "HAVE_LSETXATTR",
  "HAVE_STRUCT_STAT_ST_MTIM_TV_NSEC",
  "HAVE_WORKING_FS_IOC_GETFLAGS",
  "MAJOR_IN_SYSMACROS", "ARCHIVE_XATTR_LINUX",
]);

// FreeBSD: BSD-style stat (st_mtim, st_flags, st_birthtim), extattr_* xattr
// API, chflags family. No <sys/xattr.h> — extattr lives in <sys/extattr.h>.
// prettier-ignore
const FREEBSD = def1([
  "HAVE_ARC4RANDOM_BUF",
  "HAVE_SYS_EXTATTR_H", "HAVE_SYS_MOUNT_H",
  "HAVE_STATFS", "HAVE_FSTATFS",
  "HAVE_LCHMOD", "HAVE_LCHFLAGS", "HAVE_CHFLAGS", "HAVE_FCHFLAGS",
  "HAVE_EXTATTR_GET_FILE", "HAVE_EXTATTR_LIST_FILE", "HAVE_EXTATTR_SET_FD",
  "HAVE_EXTATTR_SET_FILE", "HAVE_DECL_EXTATTR_NAMESPACE_USER",
  "HAVE_STRUCT_STAT_ST_MTIM_TV_NSEC", "HAVE_STRUCT_STAT_ST_BIRTHTIM",
  "HAVE_STRUCT_STAT_ST_FLAGS",
  "HAVE_READPASSPHRASE", "HAVE_READPASSPHRASE_H",
  "ARCHIVE_XATTR_FREEBSD",
]);

// prettier-ignore
const DARWIN = def1([
  // arc4random_buf: BSD libc + glibc≥2.36 only. Bun's Linux CI targets
  // older glibc, so Linux falls back to /dev/urandom.
  "HAVE_ARC4RANDOM_BUF",
  "HAVE_SYS_XATTR_H", "HAVE_COPYFILE_H",
  "HAVE_FSTATFS", "HAVE_STATFS", "HAVE_LCHMOD", "HAVE_LCHFLAGS", "HAVE_CHFLAGS",
  "HAVE_FCHFLAGS",
  "HAVE_FGETXATTR", "HAVE_FLISTXATTR", "HAVE_FSETXATTR", "HAVE_GETXATTR",
  "HAVE_LISTXATTR", "HAVE_SETXATTR",
  "HAVE_STRUCT_STAT_ST_MTIMESPEC_TV_NSEC", "HAVE_STRUCT_STAT_ST_BIRTHTIME",
  "HAVE_STRUCT_STAT_ST_BIRTHTIMESPEC_TV_NSEC", "HAVE_STRUCT_STAT_ST_FLAGS",
  "HAVE_STRUCT_STATFS_F_IOSIZE",
  "ARCHIVE_XATTR_DARWIN",
]);

// Windows: clang-cl + UCRT. archive_windows.h supplies most POSIX shims;
// this declares what the UCRT actually has. No ARCHIVE_CRYPTO_*_WIN — we
// don't need digests for tar/gzip and it would pull in bcrypt.lib.
// prettier-ignore
const WINDOWS = def1([
  "HAVE_IO_H", "HAVE_DIRECT_H", "HAVE_PROCESS_H", "HAVE_SYS_UTIME_H", "HAVE_WINDOWS_H",
  "HAVE_WINCRYPT_H",
  "HAVE__CTIME64_S", "HAVE__FSEEKI64", "HAVE__GET_TIMEZONE", "HAVE__GMTIME64_S",
  "HAVE__LOCALTIME64_S", "HAVE__MKGMTIME64",
  "HAVE_STRNCPY_S", "HAVE_WCSCPY_S", "HAVE_WCSNCPY_S",
]) + `
/* POSIX type fallbacks — UCRT's <sys/types.h> doesn't define these.
   Values match cmake's WIN32 branch (CMakeLists.txt CHECK_TYPE_SIZE block). */
#define gid_t short
#define uid_t short
#define id_t short
#define mode_t unsigned short
#define pid_t int
#define ssize_t int64_t
`;

function configH(cfg: Config): string {
  const longSize = cfg.windows ? 4 : 8;
  const wcharSize = cfg.windows ? 2 : 4;
  const platform = cfg.windows ? WINDOWS : `${POSIX}\n${cfg.darwin ? DARWIN : cfg.freebsd ? FREEBSD : LINUX}`;

  // Feature-test macros must come before any system header. archive_platform.h
  // includes config.h first, so defining them here is early enough.
  const featureTest = cfg.windows
    ? "#define NTDDI_VERSION 0x0A000000\n#define _WIN32_WINNT 0x0A00\n#define WINVER 0x0A00"
    : "#define _GNU_SOURCE 1\n#define _DARWIN_C_SOURCE 1\n#define __EXTENSIONS__ 1";

  return `/* Generated by scripts/build/deps/libarchive.ts for ${cfg.os}-${cfg.arch} */
#define __LIBARCHIVE_CONFIG_H_INCLUDED 1
${featureTest}

#define SIZEOF_SHORT 2
#define SIZEOF_INT 4
#define SIZEOF_LONG ${longSize}
#define SIZEOF_LONG_LONG 8
#define SIZEOF_UNSIGNED_SHORT 2
#define SIZEOF_UNSIGNED 4
#define SIZEOF_UNSIGNED_LONG ${longSize}
#define SIZEOF_UNSIGNED_LONG_LONG 8
#define SIZEOF_WCHAR_T ${wcharSize}
#define ICONV_CONST

#define LIBARCHIVE_VERSION_NUMBER "3008007"
#define LIBARCHIVE_VERSION_STRING "3.8.7"
#define BSDTAR_VERSION_STRING "3.8.7"
#define BSDCPIO_VERSION_STRING "3.8.7"
#define BSDCAT_VERSION_STRING "3.8.7"
#define BSDUNZIP_VERSION_STRING "3.8.7"
#define VERSION "3.8.7"

${ALWAYS}

${platform}
`;
}
