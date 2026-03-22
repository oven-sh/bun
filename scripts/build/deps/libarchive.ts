/**
 * libarchive — multi-format archive reader/writer. Bun uses it for tarball
 * extraction during `bun install` (npm packages ship as tarballs) and
 * `bun pm pack`.
 *
 * We configure it minimally: only tar + gzip support, everything else
 * disabled. No bzip2/lzma/zip/rar/etc. — if someone needs those they can
 * use a userland library. Keeping the surface small avoids linking against
 * a dozen codec libs we don't need.
 */

import type { Dependency } from "../source.ts";
import { depSourceDir } from "../source.ts";

const LIBARCHIVE_COMMIT = "9525f90ca4bd14c7b335e2f8c84a4607b0af6bdf";

export const libarchive: Dependency = {
  name: "libarchive",
  versionMacro: "LIBARCHIVE",

  source: () => ({
    kind: "github-archive",
    repo: "libarchive/libarchive",
    commit: LIBARCHIVE_COMMIT,
  }),

  patches: ["patches/libarchive/archive_write_add_filter_gzip.c.patch", "patches/libarchive/CMakeLists.txt.patch"],

  // libarchive's configure-time check_include_file("zlib.h") needs zlib's
  // headers on disk. We don't LINK zlib into libarchive (ENABLE_ZLIB=OFF) —
  // we just need the compile-time knowledge that deflate exists so
  // libarchive compiles its gzip filter instead of fork/exec'ing gzip(1).
  fetchDeps: ["zlib"],

  build: cfg => ({
    kind: "nested-cmake",
    targets: ["archive_static"],
    pic: true,
    libSubdir: "libarchive",

    // -I into zlib's SOURCE dir (vendor/zlib/). This is why fetchDeps exists:
    // the zlib source must be on disk before libarchive's configure runs.
    extraCFlags: [`-I${depSourceDir(cfg, "zlib")}`],

    args: {
      ENABLE_INSTALL: "OFF",
      ENABLE_TEST: "OFF",
      ENABLE_WERROR: "OFF",

      // ─── Codecs we DON'T want ───
      // Every ENABLE_X=OFF here is a codec that libarchive would otherwise
      // detect from the system and link against. We want a hermetic build:
      // tar + gzip, nothing else.
      ENABLE_BZip2: "OFF",
      ENABLE_CAT: "OFF",
      ENABLE_CPIO: "OFF",
      ENABLE_UNZIP: "OFF",
      ENABLE_EXPAT: "OFF",
      ENABLE_ICONV: "OFF",
      ENABLE_LIBB2: "OFF",
      ENABLE_LibGCC: "OFF",
      ENABLE_LIBXML2: "OFF",
      ENABLE_WIN32_XMLLITE: "OFF",
      ENABLE_LZ4: "OFF",
      ENABLE_LZMA: "OFF",
      ENABLE_LZO: "OFF",
      ENABLE_MBEDTLS: "OFF",
      ENABLE_NETTLE: "OFF",
      ENABLE_OPENSSL: "OFF",
      ENABLE_PCRE2POSIX: "OFF",
      ENABLE_PCREPOSIX: "OFF",
      ENABLE_ZSTD: "OFF",

      // ─── Gzip: "don't link zlib, but trust us, the header exists" ───
      // ENABLE_ZLIB=OFF stops libarchive from linking zlib itself (we link
      // it at the final bun link step). HAVE_ZLIB_H=ON overrides the
      // configure-time detection — without it, libarchive compiles its
      // gzip filter as a wrapper around /usr/bin/gzip (fork+exec per
      // archive), which is slow and breaks on systems without gzip.
      ENABLE_ZLIB: "OFF",
      HAVE_ZLIB_H: "ON",
    },
  }),

  provides: () => ({
    libs: ["archive"],
    includes: ["include"],
  }),
};
