//! `bun-cc-corpus`: compiles the C libraries vendored for Bun, one translation unit per
//! file, and reports what the compiler rejects.
//!
//! ```text
//! bun-cc-corpus [--lib <name>]... [--target <arch>-<os>] [--jobs <n>] [--timeout <seconds>] [--list] [--failures] [--externs] [--gnuc <x.y.z>]
//! ```
//!
//! `--gnuc 4.2.1` compiles everything as `-fgnuc-version=4.2.1` would.
//! `--failures` lists every failing file instead of three per class; `--externs` ends with
//! the names the compiled units leave for the loader to resolve, and how many units use each.
//!
//! Every library is a row of [`LIBRARIES`]: where it lives, the include directories and
//! macros its real build uses (see `scripts/build/deps/<lib>.ts`), which files to compile,
//! and which files to skip, each with the reason. Nothing is written anywhere: results
//! stay in memory and the summary goes to stdout.
//!
//! The vendored sources are looked for in `$BUN_CC_CORPUS_VENDOR`, or else in
//! `<repo>/vendor` (the checkout the generated headers were configured for) and then
//! `~/code/bun/vendor`; the generated configuration headers in
//! `$BUN_CC_CORPUS_BUILD` (default `<repo>/build/release-local/deps`). The libraries that
//! come from other checkouts are found through `$BUN_CC_CORPUS_NODE` (default
//! `~/code/node/deps`), `$BUN_CC_CORPUS_WEBKIT` (`~/code/WebKit`) and
//! `$BUN_CC_CORPUS_LLVM` (`~/code/llvm-project-bun`); one that is not on disk is
//! reported as not found and nothing else.

// A standalone command-line tool: it may only depend on std, so it reads files, prints and
// spawns threads with std rather than bun_sys / bun_core.
#![allow(clippy::disallowed_methods, clippy::disallowed_macros)]

use std::collections::BTreeMap;
use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use bun_cc::{CompileOptions, HostFiles, Target};

static HOST_FILES: HostFiles = HostFiles;

/// One library of the corpus. Paths are relative to `root`, which starts with `$VENDOR`,
/// `$REPO`, `$NODE`, `$WEBKIT` or `$LLVM`; include directories may start with any of them
/// and with `$BUILD`.
struct Library {
    name: &'static str,
    root: &'static str,
    include_dirs: &'static [&'static str],
    /// `NAME` or `NAME=value`.
    defines: &'static [&'static str],
    /// `dir/*.c` (that directory), `dir/**.c` (recursively), a file, or `@list`: every
    /// quoted `something.c` in that file (a gyp source list).
    sources: &'static [&'static str],
    /// A relative path, a directory prefix ending in `/`, or `*suffix`; and why.
    skip: &'static [(&'static str, &'static str)],
}

const LIBRARIES: &[Library] = &[
    Library {
        name: "picohttpparser",
        root: "$VENDOR/picohttpparser",
        include_dirs: &["."],
        defines: &[],
        sources: &["*.c"],
        skip: &[(
            "test.c",
            "needs picotest, a git submodule that is not vendored",
        )],
    },
    Library {
        name: "sqlite",
        root: "$REPO/src/jsc/bindings/sqlite",
        include_dirs: &["."],
        defines: &[
            "SQLITE_ENABLE_COLUMN_METADATA=1",
            "SQLITE_MAX_VARIABLE_NUMBER=250000",
            "SQLITE_ENABLE_RTREE=1",
            "SQLITE_ENABLE_FTS3=1",
            "SQLITE_ENABLE_FTS3_PARENTHESIS=1",
            "SQLITE_ENABLE_FTS5=1",
            "SQLITE_ENABLE_JSON1=1",
            "SQLITE_ENABLE_MATH_FUNCTIONS=1",
            "SQLITE_ENABLE_UPDATE_DELETE_LIMIT=1",
            "SQLITE_UDL_CAPABLE_PARSER=1",
            "SQLITE_ENABLE_SESSION=1",
            "SQLITE_ENABLE_PREUPDATE_HOOK=1",
            "SQLITE_ENABLE_DBSTAT_VTAB=1",
            "SQLITE_ENABLE_GEOPOLY=1",
            "SQLITE_ENABLE_RBU=1",
            "SQLITE_ENABLE_PERCENTILE=1",
        ],
        sources: &["sqlite3.c"],
        skip: &[],
    },
    Library {
        name: "zlib",
        root: "$VENDOR/zlib",
        include_dirs: &[".", "arch/generic", "arch/x86", "$BUILD/zlib"],
        defines: &[
            "ZLIB_COMPAT",
            "WITH_GZFILEOP",
            "WITH_OPTIM",
            "INFLATE_STRICT",
            "HAVE_ATTRIBUTE_ALIGNED",
            "HAVE_BUILTIN_ASSUME_ALIGNED",
            "HAVE_BUILTIN_CTZ",
            "HAVE_BUILTIN_CTZLL",
            "HAVE_VISIBILITY_HIDDEN",
            "HAVE_VISIBILITY_INTERNAL",
            "HAVE_POSIX_MEMALIGN",
            "_LARGEFILE64_SOURCE=1",
            "__USE_LARGEFILE64",
            "HAVE_SYS_AUXV_H",
            "X86_FEATURES",
            // Not X86_HAVE_XSAVE_INTRIN: there is no _xgetbv here.
            "HAVE_CPUID_GNU",
            "X86_SSE2",
            "X86_SSSE3",
            "X86_SSE41",
        ],
        sources: &[
            "*.c",
            "arch/generic/*.c",
            "arch/x86/*.c",
            "test/*.c",
            "tools/*.c",
        ],
        skip: &[(
            "arch/x86/slide_hash_avx2.c",
            "AVX2 (256-bit vector) intrinsics; its only guard is the build system",
        )],
    },
    Library {
        name: "libdeflate",
        root: "$VENDOR/libdeflate",
        include_dirs: &["."],
        defines: &[],
        sources: &["lib/**.c", "programs/*.c"],
        skip: &[],
    },
    Library {
        name: "brotli",
        root: "$VENDOR/brotli",
        include_dirs: &["c/include"],
        defines: &[],
        sources: &["c/**.c"],
        skip: &[],
    },
    Library {
        name: "zstd",
        root: "$VENDOR/zstd",
        include_dirs: &[
            "lib",
            "lib/common",
            "lib/compress",
            "programs",
            "zlibWrapper",
        ],
        defines: &[
            "ZSTD_MULTITHREAD",
            "ZSTD_LEGACY_SUPPORT=0",
            "ZSTD_DISABLE_ASM=1",
            "XXH_NAMESPACE=ZSTD_",
        ],
        sources: &[
            "lib/**.c",
            "programs/*.c",
            "examples/*.c",
            "tests/*.c",
            "zlibWrapper/*.c",
        ],
        skip: &[],
    },
    Library {
        name: "cares",
        root: "$VENDOR/cares",
        include_dirs: &["include", "src/lib", "src/lib/include", "$BUILD/cares"],
        defines: &[
            "HAVE_CONFIG_H=1",
            "CARES_BUILDING_LIBRARY",
            "_GNU_SOURCE",
            "_POSIX_C_SOURCE=200809",
            "_XOPEN_SOURCE=700",
        ],
        sources: &["src/lib/**.c", "src/tools/*.c"],
        skip: &[],
    },
    Library {
        name: "libarchive",
        root: "$VENDOR/libarchive",
        include_dirs: &["libarchive", "$BUILD/zlib", "$BUILD/libarchive"],
        defines: &[
            "HAVE_CONFIG_H=1",
            "LIBARCHIVE_STATIC=1",
            "__LIBARCHIVE_ENABLE_VISIBILITY",
        ],
        sources: &["libarchive/*.c"],
        skip: &[],
    },
    Library {
        name: "mimalloc",
        root: "$VENDOR/mimalloc",
        include_dirs: &["include"],
        defines: &[
            "MI_STATIC_LIB",
            "MI_SKIP_COLLECT_ON_EXIT=1",
            "MI_NO_PROCESS_DETACH=1",
            "MI_BUILD_RELEASE",
            "MI_DEFAULT_ALLOW_THP=0",
            "MI_MALLOC_OVERRIDE",
            "MI_CMAKE_BUILD_TYPE=release",
            // mimalloc's mi_atomic_pause for a compiler that is neither GNU C nor MSVC names two
            // identifiers only its MSVC wrapper defines; these are their C11 spellings.
            "mi_atomic_thread_fence=atomic_thread_fence",
            "mi_memory_order_seq_cst=memory_order_seq_cst",
        ],
        sources: &["src/*.c", "src/prim/*.c", "test/*.c"],
        skip: &[
            ("src/free.c", "a fragment that alloc.c includes"),
            ("src/alloc-override.c", "a fragment that alloc.c includes"),
            ("src/page-queue.c", "a fragment that page.c includes"),
            (
                "test/test-commit-fail.c",
                "needs a debug build of mimalloc (MI_DEBUG > 0)",
            ),
            (
                "test/main-override.c",
                "calls _expand, which only the Windows C runtime has",
            ),
        ],
    },
    Library {
        name: "lshpack",
        root: "$VENDOR/lshpack",
        include_dirs: &[".", "deps/xxhash"],
        defines: &[
            "XXH_HEADER_NAME=\"xxhash.h\"",
            "LS_HPACK_USE_LARGE_TABLES=1",
            "LS_HPACK_BSS_LARGE_TABLES=1",
        ],
        sources: &["*.c", "deps/xxhash/*.c", "bin/*.c", "test/*.c"],
        skip: &[],
    },
    Library {
        name: "lsqpack",
        root: "$VENDOR/lsqpack",
        include_dirs: &[".", "deps/xxhash", "test"],
        defines: &["XXH_HEADER_NAME=\"xxhash.h\"", "TEST_DATA=\"testdata\""],
        sources: &["*.c", "deps/xxhash/*.c", "bin/*.c", "test/*.c"],
        skip: &[],
    },
    Library {
        name: "hdrhistogram",
        root: "$VENDOR/hdrhistogram",
        include_dirs: &["include", "src", "$BUILD/zlib"],
        defines: &["HDR_NO_AVX2_DISPATCH", "_GNU_SOURCE"],
        sources: &["src/*.c", "examples/*.c", "test/*.c"],
        skip: &[],
    },
    Library {
        name: "libspng",
        root: "$VENDOR/libspng",
        include_dirs: &["spng", "$BUILD/zlib"],
        defines: &["SPNG_STATIC", "SPNG_SSE=4"],
        sources: &["spng/*.c", "examples/*.c", "tests/*.c"],
        skip: &[],
    },
    Library {
        name: "libwebp",
        root: "$VENDOR/libwebp",
        include_dirs: &[".", "src"],
        defines: &[],
        sources: &[
            "src/**.c",
            "sharpyuv/*.c",
            "extras/*.c",
            "imageio/*.c",
            "examples/*.c",
        ],
        skip: &[],
    },
    Library {
        name: "libjpeg-turbo",
        root: "$VENDOR/libjpeg-turbo",
        include_dirs: &["src", "$BUILD/libjpeg-turbo"],
        defines: &["BUN_8BIT_ONLY", "USE_CLZ_INTRINSIC"],
        sources: &["src/*.c", "simd/*.c"],
        skip: &[
            (
                "src/jccolext.c",
                "a fragment that jccolor.c includes once per pixel format",
            ),
            (
                "src/jdcolext.c",
                "a fragment that jdcolor.c includes once per pixel format",
            ),
            ("src/jdcol565.c", "a fragment that jdcolor.c includes"),
            (
                "src/jdmrgext.c",
                "a fragment that jdmerge.c includes once per pixel format",
            ),
            ("src/jdmrg565.c", "a fragment that jdmerge.c includes"),
            (
                "src/jstdhuff.c",
                "a fragment that jcparam.c and jdhuff.c include",
            ),
            (
                "src/turbojpeg-mp.c",
                "a fragment that turbojpeg.c includes once per sample size",
            ),
        ],
    },
    Library {
        name: "libuv",
        root: "$VENDOR/libuv",
        include_dirs: &["include", "src"],
        defines: &[
            "_GNU_SOURCE",
            "_POSIX_C_SOURCE=200112",
            "_FILE_OFFSET_BITS=64",
            "_LARGEFILE_SOURCE",
        ],
        sources: &["src/*.c", "src/unix/*.c", "test/*.c", "docs/code/**.c"],
        skip: &[
            ("src/unix/aix.c", "AIX"),
            ("src/unix/aix-common.c", "AIX"),
            ("src/unix/ibmi.c", "IBM i"),
            ("src/unix/os390.c", "z/OS"),
            ("src/unix/os390-syscalls.c", "z/OS"),
            ("src/unix/os390-proctitle.c", "z/OS"),
            ("src/unix/darwin.c", "macOS"),
            ("src/unix/darwin-proctitle.c", "macOS"),
            ("src/unix/fsevents.c", "macOS"),
            ("src/unix/kqueue.c", "macOS and the BSDs"),
            ("src/unix/bsd-ifaddrs.c", "the BSDs"),
            ("src/unix/bsd-proctitle.c", "the BSDs"),
            ("src/unix/freebsd.c", "FreeBSD"),
            ("src/unix/netbsd.c", "NetBSD"),
            ("src/unix/openbsd.c", "OpenBSD"),
            ("src/unix/random-getentropy.c", "the BSDs and macOS"),
            ("src/unix/sunos.c", "Solaris"),
            ("src/unix/haiku.c", "Haiku"),
            ("src/unix/hurd.c", "GNU Hurd"),
            ("src/unix/qnx.c", "QNX"),
            ("src/unix/cygwin.c", "Cygwin"),
            ("src/unix/posix-poll.c", "platforms without epoll or kqueue"),
            ("test/runner-win.c", "Windows"),
        ],
    },
    Library {
        name: "tinycc",
        root: "$VENDOR/tinycc",
        include_dirs: &[".", "include", "$BUILD/tinycc"],
        defines: &[
            "CONFIG_TCC_PREDEFS",
            "ONE_SOURCE=1",
            "TCC_LIBTCC1=\"\"",
            "CONFIG_TCC_BACKTRACE=0",
            "TCC_VERSION=\"corpus\"",
            "TCC_GITHASH=\"corpus\"",
        ],
        sources: &["tcc.c", "lib/*.c", "tests/tests2/*.c"],
        skip: &[
            (
                "tcc.c",
                "80-bit long double arithmetic: tcc folds floating constants in long double",
            ),
            ("lib/libtcc1.c", "80-bit long double arithmetic"),
            (
                "lib/lib-arm64.c",
                "long double (the AArch64 quad soft-float routines)",
            ),
            (
                "lib/armeabi.c",
                "32-bit ARM, with top-level inline assembly",
            ),
            ("lib/lib-riscv.c", "RISC-V"),
            ("lib/bt-dll.c", "Windows"),
            (
                "lib/bt-exe.c",
                "needs the definitions tccrun.c has when built with CONFIG_TCC_BACKTRACE_ONLY",
            ),
            (
                "tests/tests2/101_cleanup.c",
                "80-bit long double arithmetic",
            ),
            (
                "tests/tests2/111_conversion.c",
                "80-bit long double arithmetic",
            ),
            (
                "tests/tests2/22_floating_point.c",
                "80-bit long double arithmetic",
            ),
            (
                "tests/tests2/73_arm64.c",
                "long double (static initializers)",
            ),
            ("tests/tests2/85_asm-outside-function.c", "inline assembly"),
            ("tests/tests2/98_al_ax_extend.c", "inline assembly"),
            ("tests/tests2/99_fastcall.c", "inline assembly"),
            ("tests/tests2/127_asm_goto.c", "inline assembly"),
            ("tests/tests2/138_arm64_encoding.c", "inline assembly"),
            ("tests/tests2/140_arm64_extasm.c", "inline assembly"),
            ("tests/tests2/145_winarm64_interlocked.c", "Windows"),
            (
                "tests/tests2/34_array_assignment.c",
                "assigns to an array: a tcc extension GCC rejects too",
            ),
            (
                "tests/tests2/102_alignas.c",
                "implicit int: a tcc leniency GCC 14 rejects too",
            ),
        ],
    },
    Library {
        name: "tinycc-units",
        root: "$VENDOR/tinycc",
        include_dirs: &[".", "include", "$BUILD/tinycc"],
        defines: &[
            "CONFIG_TCC_PREDEFS",
            "ONE_SOURCE=0",
            "TCC_LIBTCC1=\"\"",
            "CONFIG_TCC_BACKTRACE=0",
            "TCC_VERSION=\"corpus\"",
            "TCC_GITHASH=\"corpus\"",
        ],
        // The way Bun builds it: one unit per file.
        sources: &[
            "libtcc.c",
            "tccpp.c",
            "tccgen.c",
            "tccdbg.c",
            "tccelf.c",
            "tccasm.c",
            "tccrun.c",
            "x86_64-gen.c",
            "x86_64-link.c",
            "i386-asm.c",
        ],
        skip: &[
            (
                "tccpp.c",
                "80-bit long double arithmetic: floating constants are assembled in long double",
            ),
            (
                "tccgen.c",
                "80-bit long double arithmetic: constant folding",
            ),
        ],
    },
    Library {
        name: "lsquic",
        root: "$VENDOR/lsquic",
        include_dirs: &[
            "include",
            "src/liblsquic",
            "$VENDOR/boringssl/include",
            "$VENDOR/lshpack",
            "$VENDOR/lshpack/deps/xxhash",
            "$VENDOR/lsqpack",
            "$BUILD/zlib",
            "$VENDOR/zlib",
        ],
        defines: &[
            // Written for GNU C only (see `compile_one`).
            "__GNUC__=4",
            "HAVE_BORINGSSL=1",
            "XXH_HEADER_NAME=\"xxhash.h\"",
            "LS_QPACK_USE_LARGE_TABLES=1",
            "LS_HPACK_BSS_LARGE_TABLES=1",
            "LSQPACK_ENC_LOGGER_HEADER=\"lsquic_qpack_enc_logger.h\"",
            "LSQPACK_DEC_LOGGER_HEADER=\"lsquic_qpack_dec_logger.h\"",
            "LSQUIC_DEBUG_NEXT_ADV_TICK=0",
            "LSQUIC_CONN_STATS=1",
            "LSQUIC_QIR=0",
            "LSQUIC_WEBTRANSPORT_SERVER_SUPPORT=0",
            "LSQUIC_LOWEST_LOG_LEVEL=LSQ_LOG_INFO",
        ],
        sources: &["src/liblsquic/*.c"],
        skip: &[
            (
                "src/liblsquic/common_cert_set_2.c",
                "a fragment that lsquic_crt_compress.c includes",
            ),
            (
                "src/liblsquic/common_cert_set_3.c",
                "a fragment that lsquic_crt_compress.c includes",
            ),
        ],
    },
    Library {
        name: "openssl",
        root: "$NODE/openssl",
        include_dirs: &[
            "config/archs/linux-x86_64/no-asm/include",
            "config/archs/linux-x86_64/no-asm",
            "config/archs/linux-x86_64/no-asm/providers/common/include",
            "openssl",
            "openssl/include",
            "openssl/crypto",
            "openssl/crypto/include",
            "openssl/crypto/modes",
            "openssl/crypto/ec/curve448",
            "openssl/crypto/ec/curve448/arch_32",
            "openssl/providers/common/include",
            "openssl/providers/fips/include",
            "openssl/providers/implementations/include",
            "config",
            "$NODE/brotli/c/include",
            "$NODE/zlib",
            "$NODE/zstd/lib",
        ],
        defines: &[
            "NDEBUG",
            "OPENSSL_USE_NODELETE",
            "L_ENDIAN",
            "OPENSSL_BUILDING_OPENSSL",
            "BROTLI",
            "ZLIB",
            "ZSTD",
            "OPENSSL_PIC",
            "OPENSSL_NO_ASM",
            "OPENSSLDIR=\"/etc/ssl\"",
            "ENGINESDIR=\"/dev/null\"",
            "MODULESDIR=\"/usr/lib/ossl-modules\"",
            "OPENSSL_API_COMPAT=0x10100001L",
            "STATIC_LEGACY",
        ],
        // The library as Node builds it for linux-x86_64 without assembly.
        sources: &["@config/archs/linux-x86_64/no-asm/openssl.gypi"],
        skip: &[
            (
                "openssl/crypto/cversion.c",
                "needs buildinf.h, which the build writes",
            ),
            (
                "openssl/crypto/info.c",
                "needs buildinf.h, which the build writes",
            ),
        ],
    },
    Library {
        name: "nghttp2",
        root: "$NODE/nghttp2",
        include_dirs: &["lib/includes", "lib"],
        defines: &[
            "BUILDING_NGHTTP2",
            "NGHTTP2_STATICLIB",
            "HAVE_CONFIG_H",
            "_U_=",
        ],
        sources: &["lib/*.c"],
        skip: &[],
    },
    Library {
        name: "ngtcp2",
        root: "$NODE/ngtcp2",
        include_dirs: &[
            ".",
            "ngtcp2/lib/includes",
            "ngtcp2/crypto/includes",
            "ngtcp2/lib",
            "ngtcp2/crypto",
            "nghttp3/lib/includes",
            "nghttp3/lib",
            "$NODE/openssl/config/archs/linux-x86_64/no-asm/include",
            "$NODE/openssl/openssl/include",
        ],
        defines: &[
            "BUILDING_NGTCP2",
            "NGTCP2_STATICLIB",
            "BUILDING_NGHTTP3",
            "NGHTTP3_STATICLIB",
            "HAVE_UNISTD_H",
            "HAVE_ARPA_INET_H",
            "HAVE_NETINET_IN_H",
            "_U_=",
        ],
        sources: &["@ngtcp2.gyp"],
        skip: &[(
            "ngtcp2/crypto/boringssl/boringssl.c",
            "the BoringSSL backend; Node builds the OpenSSL one",
        )],
    },
    Library {
        name: "llhttp",
        root: "$NODE/llhttp",
        include_dirs: &[".", "include"],
        defines: &[],
        sources: &["src/*.c"],
        skip: &[],
    },
    Library {
        name: "uvwasi",
        root: "$NODE/uvwasi",
        include_dirs: &["include", "$NODE/uv/include"],
        defines: &["_GNU_SOURCE", "_POSIX_C_SOURCE=200112"],
        sources: &["src/*.c"],
        skip: &[],
    },
    Library {
        name: "zlib-classic",
        root: "$NODE/zlib",
        include_dirs: &["."],
        defines: &[
            "ZLIB_IMPLEMENTATION",
            "HAVE_HIDDEN",
            // What zlib.gyp adds on x64.
            "ADLER32_SIMD_SSSE3",
            "X86_NOT_WINDOWS",
            "INFLATE_CHUNK_SIMD_SSE2",
            "INFLATE_CHUNK_READ_64LE",
        ],
        sources: &["*.c", "contrib/optimizations/*.c"],
        skip: &[],
    },
    Library {
        name: "cares-node",
        root: "$NODE/cares",
        include_dirs: &["include", "src/lib", "src/lib/include", "config/linux"],
        defines: &[
            // Written for GNU C only (see `compile_one`).
            "__GNUC__=4",
            "HAVE_CONFIG_H",
            "CARES_BUILDING_LIBRARY",
            "_LARGEFILE_SOURCE",
            "_FILE_OFFSET_BITS=64",
            "_GNU_SOURCE",
        ],
        sources: &["src/lib/**.c"],
        skip: &[],
    },
    Library {
        name: "libpas",
        root: "$WEBKIT/Source/bmalloc/libpas/src/libpas",
        include_dirs: &["."],
        defines: &[
            // Written for GNU C only (see `compile_one`).
            "__GNUC__=4",
            "_GNU_SOURCE",
        ],
        sources: &["*.c"],
        skip: &[],
    },
    Library {
        name: "compiler-rt",
        root: "$LLVM/compiler-rt/lib/builtins",
        include_dirs: &["."],
        defines: &[
            // Written for GNU C only (see `compile_one`).
            "__GNUC__=4",
        ],
        sources: &["*.c"],
        skip: &[
            ("extendhfxf2.c", "long double"),
            ("fixunsxfdi.c", "long double"),
            ("fixunsxfsi.c", "long double"),
            ("fixunsxfti.c", "long double"),
            ("fixxfdi.c", "long double"),
            ("fixxfti.c", "long double"),
            ("floatdixf.c", "long double"),
            ("floattixf.c", "long double"),
            ("floatundixf.c", "long double"),
            ("floatuntixf.c", "long double"),
            ("truncxfhf2.c", "long double"),
            ("divxc3.c", "long double"),
            ("mulxc3.c", "long double"),
            ("powixf2.c", "long double"),
            ("truncdfbf2.c", "the __bf16 type"),
            ("truncsfbf2.c", "the __bf16 type"),
            (
                "gcc_personality_v0.c",
                "C++ exception handling (__builtin_eh_return_data_regno)",
            ),
            ("crtbegin.c", "top-level inline assembly"),
            (
                "atomic.c",
                "the runtime's own 16-byte atomic operations, written with the builtins",
            ),
        ],
    },
    Library {
        name: "boringssl",
        root: "$VENDOR/boringssl",
        include_dirs: &["include"],
        defines: &["BORINGSSL_IMPLEMENTATION", "OPENSSL_NO_ASM"],
        sources: &["crypto/**.c", "ssl/**.c"],
        skip: &[],
    },
];

struct Job {
    library: usize,
    /// Path relative to the library root, for display.
    relative: String,
    path: String,
}

enum Outcome {
    /// `needs_link`: the unit compiled, but it declares thread-local variables that another
    /// unit defines, which only `compile_many` can resolve.
    Ok {
        warnings: usize,
        needs_link: bool,
        /// Local arrays and structures the compiler replaced by their elements.
        replaced: usize,
        /// Byte-by-byte integer reads and writes that became one load, one store.
        combined: (usize, usize),
        /// With `--externs`: the symbols the unit imports.
        externs: Vec<String>,
    },
    /// The first error: message, and `file:line:col`.
    Failed {
        message: String,
        place: String,
    },
    TimedOut,
    Unreadable(String),
}

#[derive(Clone)]
struct Paths {
    /// In order of preference; a library comes from the first one that has it.
    vendor: Vec<String>,
    repo: String,
    build: String,
    node: String,
    webkit: String,
    llvm: String,
}

impl Paths {
    fn discover() -> Paths {
        let repo = std::env::var("BUN_CC_CORPUS_REPO").unwrap_or_else(|_| {
            // This file is <repo>/src/cc/corpus.rs.
            let manifest = env!("CARGO_MANIFEST_DIR");
            match manifest.strip_suffix("/src/cc") {
                Some(repo) => repo.to_string(),
                None => format!("{manifest}/../.."),
            }
        });
        let home = std::env::var("HOME").unwrap_or_default();
        let vendor = match std::env::var("BUN_CC_CORPUS_VENDOR") {
            Ok(dir) => vec![dir],
            Err(_) => vec![format!("{repo}/vendor"), format!("{home}/code/bun/vendor")],
        };
        let build = std::env::var("BUN_CC_CORPUS_BUILD")
            .unwrap_or_else(|_| format!("{repo}/build/release-local/deps"));
        let other = |variable: &str, default: &str| {
            std::env::var(variable).unwrap_or_else(|_| format!("{home}/{default}"))
        };
        Paths {
            vendor,
            repo,
            build,
            node: other("BUN_CC_CORPUS_NODE", "code/node/deps"),
            webkit: other("BUN_CC_CORPUS_WEBKIT", "code/WebKit"),
            llvm: other("BUN_CC_CORPUS_LLVM", "code/llvm-project-bun"),
        }
    }

    fn expand(&self, path: &str) -> String {
        if let Some(rest) = path.strip_prefix("$VENDOR/") {
            let library = match (0..rest.len()).find(|&i| rest.as_bytes()[i] == b'/') {
                Some(slash) => &rest[..slash],
                None => rest,
            };
            let home = self
                .vendor
                .iter()
                .find(|dir| std::fs::metadata(format!("{dir}/{library}")).is_ok())
                .or_else(|| self.vendor.last());
            if let Some(dir) = home {
                return format!("{dir}/{rest}");
            }
        }
        for (variable, value) in [
            ("$REPO", &self.repo),
            ("$BUILD", &self.build),
            ("$NODE", &self.node),
            ("$WEBKIT", &self.webkit),
            ("$LLVM", &self.llvm),
        ] {
            if let Some(rest) = path.strip_prefix(variable) {
                return format!("{value}{rest}");
            }
        }
        path.to_string()
    }
}

/// The `.c` files under `dir`, relative to `root`, sorted.
fn walk(root: &str, dir: &str, recursive: bool, suffix: &str, out: &mut Vec<String>) {
    let full = if dir.is_empty() {
        root.to_string()
    } else {
        format!("{root}/{dir}")
    };
    let Ok(entries) = std::fs::read_dir(&full) else {
        return;
    };
    let mut names: Vec<(String, bool)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let is_dir = entry.file_type().ok()?.is_dir();
            Some((name, is_dir))
        })
        .collect();
    names.sort();
    for (name, is_dir) in names {
        let relative = if dir.is_empty() {
            name.clone()
        } else {
            format!("{dir}/{name}")
        };
        if is_dir {
            if recursive && !name.starts_with('.') {
                walk(root, &relative, true, suffix, out);
            }
        } else if name.ends_with(suffix) {
            out.push(relative);
        }
    }
}

fn skip_reason(library: &Library, relative: &str) -> Option<&'static str> {
    library.skip.iter().find_map(|(pattern, reason)| {
        let matches = if let Some(suffix) = pattern.strip_prefix('*') {
            relative.ends_with(suffix)
        } else if pattern.ends_with('/') {
            relative.starts_with(pattern)
        } else {
            relative == *pattern
        };
        matches.then_some(*reason)
    })
}

/// The files of `library` to compile, and the ones skipped with their reasons.
fn files_of(library: &Library, root: &str) -> (Vec<String>, Vec<(String, &'static str)>) {
    let mut found = Vec::new();
    for pattern in library.sources {
        if let Some(dir) = pattern.strip_suffix("**.c") {
            walk(root, dir.trim_end_matches('/'), true, ".c", &mut found);
        } else if let Some(dir) = pattern.strip_suffix("*.c") {
            walk(root, dir.trim_end_matches('/'), false, ".c", &mut found);
        } else if let Some(list) = pattern.strip_prefix('@') {
            let text = std::fs::read_to_string(format!("{root}/{list}")).unwrap_or_default();
            // Every '...' or "..." that names a .c file.
            let bytes = text.as_bytes();
            let mut at = 0;
            while at < bytes.len() {
                let quote = bytes[at];
                at += 1;
                if quote != b'\'' && quote != b'"' {
                    continue;
                }
                let start = at;
                while at < bytes.len() && bytes[at] != quote && bytes[at] != b'\n' {
                    at += 1;
                }
                let name = &text[start..at.min(text.len())];
                at += 1;
                if name.ends_with(".c") && !name.starts_with('<') {
                    found.push(name.trim_start_matches("./").to_string());
                }
            }
        } else {
            found.push((*pattern).to_string());
        }
    }
    found.sort();
    found.dedup();
    let mut compile = Vec::new();
    let mut skipped = Vec::new();
    for relative in found {
        match skip_reason(library, &relative) {
            Some(reason) => skipped.push((relative, reason)),
            None => compile.push(relative),
        }
    }
    (compile, skipped)
}

fn compile_one(
    library: &Library,
    paths: &Paths,
    path: &str,
    target: Target,
    want_externs: bool,
    gnu_version: Option<(u32, u32, u32)>,
) -> Outcome {
    let source = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) => return Outcome::Unreadable(e.to_string()),
    };
    let root = paths.expand(library.root);
    let include_dirs = library
        .include_dirs
        .iter()
        .map(|dir| {
            if dir.starts_with('$') || dir.starts_with('/') {
                paths.expand(dir)
            } else if *dir == "." {
                root.clone()
            } else {
                format!("{root}/{dir}")
            }
        })
        .collect();
    // A library written for GNU C alone says so with `__GNUC__=4` among its macros: it is
    // always compiled as `-fgnuc-version=4.2.1` at least.
    let needs_gnu = library.defines.iter().any(|d| d.starts_with("__GNUC__"));
    let gnu_version = gnu_version.or_else(|| needs_gnu.then_some((4, 2, 1)));
    let defines = library
        .defines
        .iter()
        .filter(|define| !define.starts_with("__GNUC"))
        .map(
            |define| match (0..define.len()).find(|&i| define.as_bytes()[i] == b'=') {
                Some(eq) => (define[..eq].to_string(), Some(define[eq + 1..].to_string())),
                None => ((*define).to_string(), None),
            },
        )
        .collect();
    let options = CompileOptions {
        target,
        include_dirs,
        system_include_dirs: bun_cc::default_system_include_dirs(target),
        defines,
        undefines: Vec::new(),
        gnu_version,
        replace_aggregates: true,
        file_provider: &HOST_FILES,
    };
    match bun_cc::compile_with_warnings(&source, path, &options) {
        Ok(output) => Outcome::Ok {
            warnings: output.warnings.len(),
            needs_link: false,
            replaced: output.replaced_aggregates,
            combined: output.combined_accesses,
            externs: if want_externs {
                extern_names(&output.bir)
            } else {
                Vec::new()
            },
        },
        Err(diagnostics)
            if !diagnostics.is_empty()
                && diagnostics.iter().all(|d| {
                    d.message.starts_with("thread-local variable ")
                        && d.message.ends_with("not defined in any translation unit")
                }) =>
        {
            Outcome::Ok {
                warnings: 0,
                needs_link: true,
                replaced: 0,
                combined: (0, 0),
                externs: Vec::new(),
            }
        }
        Err(diagnostics) => match diagnostics.first() {
            Some(d) => Outcome::Failed {
                message: d.message.clone(),
                place: format!("{}:{}:{}", d.file, d.line, d.col),
            },
            None => Outcome::Failed {
                message: "failed without a diagnostic".to_string(),
                place: path.to_string(),
            },
        },
    }
}

/// The `extern N: name ...` lines of the module's disassembly.
fn extern_names(bir: &[u8]) -> Vec<String> {
    let Ok(text) = bun_cc::disassemble(bir) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("extern ") else {
            continue;
        };
        let mut words = rest.split_whitespace();
        if let (Some(_index), Some(name)) = (words.next(), words.next()) {
            names.push(name.to_string());
        }
    }
    names
}

/// Replaces quoted names and numbers so that messages about different identifiers group.
fn message_class(message: &str) -> String {
    let mut out = String::new();
    let mut in_quote = false;
    for c in message.chars() {
        if c == '\'' {
            in_quote = !in_quote;
            if in_quote {
                out.push_str("'…'");
            }
            continue;
        }
        if !in_quote {
            out.push(c);
        }
    }
    out
}

fn usage() -> ExitCode {
    eprintln!(
        "usage: bun-cc-corpus [--lib <name>]... [--target <arch>-<os>] [--jobs <n>] [--timeout <seconds>] [--list] [--failures] [--externs] [--gnuc <x.y.z>]"
    );
    ExitCode::FAILURE
}

fn main() -> ExitCode {
    let mut only: Vec<String> = Vec::new();
    let mut target = Target::parse("x86_64-linux").unwrap_or_else(Target::host);
    let mut jobs = std::thread::available_parallelism().map_or(4, usize::from);
    let mut timeout = Duration::from_secs(30);
    let mut list_only = false;
    let mut show_failures = false;
    let mut want_externs = false;
    let mut gnu_version = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--lib" => match args.next() {
                Some(name) => only.push(name),
                None => return usage(),
            },
            "--target" => match args.next().as_deref().and_then(Target::parse) {
                Some(t) => target = t,
                None => return usage(),
            },
            "--jobs" => match args.next().and_then(|n| n.parse().ok()) {
                Some(n) if n > 0 => jobs = n,
                _ => return usage(),
            },
            "--timeout" => match args.next().and_then(|n| n.parse().ok()) {
                Some(seconds) => timeout = Duration::from_secs(seconds),
                None => return usage(),
            },
            "--list" => list_only = true,
            "--failures" => show_failures = true,
            "--externs" => want_externs = true,
            "--gnuc" => match args.next().as_deref().and_then(bun_cc::parse_gnu_version) {
                Some(version) => gnu_version = version,
                None => return usage(),
            },
            _ => return usage(),
        }
    }
    for name in &only {
        if !LIBRARIES.iter().any(|l| l.name == name) {
            eprintln!("bun-cc-corpus: no library named '{name}'; there are:");
            for library in LIBRARIES {
                eprintln!("  {}", library.name);
            }
            return ExitCode::FAILURE;
        }
    }

    let paths = Paths::discover();
    let started = Instant::now();
    let mut work: Vec<Job> = Vec::new();
    let mut skipped: Vec<Vec<(String, &'static str)>> = Vec::new();
    let mut missing: Vec<bool> = Vec::new();
    for (index, library) in LIBRARIES.iter().enumerate() {
        let root = paths.expand(library.root);
        let selected = only.is_empty() || only.iter().any(|n| n == library.name);
        let exists = std::fs::metadata(&root).is_ok();
        missing.push(selected && !exists);
        if !selected || !exists {
            skipped.push(Vec::new());
            continue;
        }
        let (compile, skip) = files_of(library, &root);
        skipped.push(skip);
        for relative in compile {
            work.push(Job {
                library: index,
                path: format!("{root}/{relative}"),
                relative,
            });
        }
    }
    if list_only {
        for job in &work {
            println!("{} {}", LIBRARIES[job.library].name, job.relative);
        }
        return ExitCode::SUCCESS;
    }

    // Workers pull the next file; each compilation runs on a thread of its own so that a
    // runaway one can be abandoned after the timeout.
    let next = AtomicUsize::new(0);
    let (sender, receiver) = mpsc::channel::<(usize, Outcome, Duration)>();
    std::thread::scope(|scope| {
        for _ in 0..jobs.min(work.len().max(1)) {
            let sender = sender.clone();
            let (work, next, paths) = (&work, &next, &paths);
            scope.spawn(move || {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(job) = work.get(index) else { break };
                    let began = Instant::now();
                    let (done, wait) = mpsc::channel();
                    let library = &LIBRARIES[job.library];
                    let job_paths = paths.clone();
                    let path = job.path.clone();
                    let spawned = std::thread::Builder::new().spawn(move || {
                        let _ = done.send(compile_one(
                            library,
                            &job_paths,
                            &path,
                            target,
                            want_externs,
                            gnu_version,
                        ));
                    });
                    let outcome = match spawned {
                        Ok(_) => wait.recv_timeout(timeout).unwrap_or(Outcome::TimedOut),
                        Err(e) => Outcome::Unreadable(format!("cannot start a thread: {e}")),
                    };
                    let _ = sender.send((index, outcome, began.elapsed()));
                }
            });
        }
        drop(sender);
    });
    let mut outcomes: Vec<Option<(Outcome, Duration)>> = Vec::new();
    outcomes.resize_with(work.len(), || None);
    for (index, outcome, elapsed) in receiver {
        outcomes[index] = Some((outcome, elapsed));
    }

    // ── Report ──
    let mut imported: BTreeMap<String, usize> = BTreeMap::new();
    let mut total_ok = 0usize;
    let mut total_failed = 0usize;
    let mut total_skipped = 0usize;
    for (index, library) in LIBRARIES.iter().enumerate() {
        if missing[index] {
            println!(
                "{}: not found at {}",
                library.name,
                paths.expand(library.root)
            );
            continue;
        }
        let mine: Vec<usize> = (0..work.len())
            .filter(|&i| work[i].library == index)
            .collect();
        if mine.is_empty() && skipped[index].is_empty() {
            continue;
        }
        let mut ok = 0usize;
        let mut need_link = 0usize;
        let mut warnings = 0usize;
        let mut slowest: Option<(Duration, &str)> = None;
        // Message class -> (count, examples).
        let mut replaced = 0usize;
        let mut combined = (0usize, 0usize);
        let mut classes: BTreeMap<String, (usize, Vec<String>)> = BTreeMap::new();
        for &i in &mine {
            let Some((outcome, elapsed)) = &outcomes[i] else {
                continue;
            };
            if slowest.is_none_or(|(d, _)| *elapsed > d) {
                slowest = Some((*elapsed, &work[i].relative));
            }
            let (class, example) = match outcome {
                Outcome::Ok {
                    warnings: w,
                    needs_link,
                    replaced: r,
                    combined: c,
                    externs,
                } => {
                    replaced += r;
                    combined = (combined.0 + c.0, combined.1 + c.1);
                    for name in externs {
                        *imported.entry(name.clone()).or_default() += 1;
                    }
                    ok += 1;
                    need_link += usize::from(*needs_link);
                    warnings += w;
                    continue;
                }
                Outcome::Failed { message, place } => {
                    (message_class(message), format!("{place}: {message}"))
                }
                Outcome::TimedOut => (
                    format!("timed out after {} s", timeout.as_secs()),
                    work[i].relative.clone(),
                ),
                Outcome::Unreadable(e) => (format!("cannot read: {e}"), work[i].relative.clone()),
            };
            let entry = classes.entry(class).or_default();
            entry.0 += 1;
            if entry.1.len() < 3 || show_failures {
                entry.1.push(example);
            }
        }
        let failed = mine.len() - ok;
        total_ok += ok;
        total_failed += failed;
        total_skipped += skipped[index].len();
        print!(
            "{}: {ok} ok / {failed} failed / {} skipped",
            library.name,
            skipped[index].len()
        );
        if warnings > 0 {
            print!(" ({warnings} warnings)");
        }
        if need_link > 0 {
            print!(" ({need_link} declare thread-locals that another unit defines)");
        }
        if replaced > 0 {
            print!(" ({replaced} local aggregates replaced)");
        }
        if combined != (0, 0) {
            print!(
                " ({} loads, {} stores combined from bytes)",
                combined.0, combined.1
            );
        }
        if let Some((elapsed, file)) = slowest {
            print!("   slowest {:.2} s {file}", elapsed.as_secs_f64());
        }
        println!();
        let mut ordered: Vec<(&String, &(usize, Vec<String>))> = classes.iter().collect();
        ordered.sort_by(|a, b| b.1.0.cmp(&a.1.0).then(a.0.cmp(b.0)));
        for (class, (count, examples)) in ordered {
            println!("  {count:4} x {class}");
            for example in examples {
                println!("         {example}");
            }
        }
        // Skips are grouped by reason.
        let mut reasons: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for (file, reason) in &skipped[index] {
            reasons.entry(reason).or_default().push(file);
        }
        for (reason, files) in reasons {
            println!("  skipped {} ({reason})", files.len());
        }
    }
    if want_externs {
        println!("externs ({} names; units using each):", imported.len());
        for (name, count) in &imported {
            println!("  {count:5} {name}");
        }
    }
    println!(
        "total: {total_ok} ok / {total_failed} failed / {total_skipped} skipped in {:.1} s",
        started.elapsed().as_secs_f64()
    );
    if total_failed > 0 {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
