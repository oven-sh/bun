/**
 * mimalloc — Microsoft's memory allocator. Bun's global malloc replacement
 * on Linux and macOS, and the JS heap allocator everywhere.
 *
 * DirectBuild: compiles only `src/static.c`, mimalloc's unity TU that
 * #includes every other source. The cmake build also produced a per-file
 * `.a`, but linking that on apple/linux-release tripped duplicate-symbol
 * errors (microsoft/mimalloc#512) because the archive ended up containing
 * both static.c.o and the individual .o files. With one TU there's nothing
 * to duplicate, so the old object-vs-archive workaround is gone.
 */

import type { Config } from "../config.ts";
import type { Dependency, DirectBuild } from "../source.ts";

const MIMALLOC_COMMIT = "92ef6587c57b262f6e6abf513f7776a2f8d12aeb";

/**
 * macOS: src/jsc/bindings/MimallocOverrideDarwin.cpp defines the C allocation
 * functions and operator new/delete on top of mimalloc. ASAN has to see the
 * real ones.
 */
export const overridesDarwinAllocator = (cfg: Pick<Config, "darwin" | "asan">): boolean => cfg.darwin && !cfg.asan;

/**
 * The C allocation functions that file defines. They stay local to the
 * executable, which therefore imports none of them. Spelled as in C.
 */
export const replacedLibcAllocationSymbols: readonly string[] = [
  "malloc",
  "calloc",
  "realloc",
  "reallocf",
  "free",
  "valloc",
  "aligned_alloc",
  "posix_memalign",
  "strdup",
  "strndup",
];

/**
 * Every replaceable form of operator new and operator delete, as the Itanium
 * ABI mangles it. The macOS executable exports them: libc++.1.dylib allocates
 * and releases std::string buffers that inlined code in bun also allocates and
 * releases, and dyld binds an image to the executable's operators only if they
 * are exported.
 */
export const replacedOperatorNewSymbols: readonly string[] = ["w", "a"].flatMap(form => [
  `_Zn${form}m`,
  `_Zn${form}mRKSt9nothrow_t`,
  `_Zn${form}mSt11align_val_t`,
  `_Zn${form}mSt11align_val_tRKSt9nothrow_t`,
  ...[`_Zd${form === "w" ? "l" : "a"}Pv`].flatMap(del => [
    del,
    `${del}m`,
    `${del}RKSt9nothrow_t`,
    `${del}St11align_val_t`,
    `${del}mSt11align_val_t`,
    `${del}St11align_val_tRKSt9nothrow_t`,
  ]),
]);

export const mimalloc: Dependency = {
  name: "mimalloc",
  versionMacro: "MIMALLOC",

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/mimalloc",
    commit: MIMALLOC_COMMIT,
  }),

  // What the two `hand-out-` patches add is switched on only while the ahead-of-time compiler runs, and costs every
  // free a test: a build without the compiler leaves them out.
  patches: cfg => [
    "patches/mimalloc/new-oom-hook.patch",
    ...(cfg.aot
      ? ["patches/mimalloc/hand-out-last-freed.patch", "patches/mimalloc/hand-out-resident-slices.patch"]
      : []),
    "patches/mimalloc/secure-guard-pages-are-protected.patch",
    "patches/mimalloc/out-of-memory-is-no-corruption.patch",
    ...(cfg.lockEnvironment ? ["patches/mimalloc/environment-sets-sizes-and-pace-only.patch"] : []),
  ],

  build: cfg => {
    // ─── Override behavior (global malloc replacement) ───
    //   ASAN:    OFF — ASAN interceptors must see the real malloc.
    //   macOS:   OFF here — mimalloc's own override replaces the default
    //            malloc zone or interposes, which also changes the allocator
    //            under NAPI addons and system frameworks. bun's override
    //            (overridesDarwinAllocator above) covers the executable only.
    //   Linux:   ON — the main win. All malloc/free routes through mimalloc,
    //            including WebKit's bmalloc when it falls back to system malloc.
    //   Windows: OFF — Bun links the static CRT and calls mi_* directly;
    //            alloc-override.c emits _expand/_msize/free which duplicate
    //            against libucrt(d) at link time. The C deps that would
    //            otherwise sit on the uCRT heap are pointed at mimalloc one
    //            by one instead (ICU and libuv in bun_runtime::bin_entry's
    //            use_mimalloc_in_dependencies, BoringSSL via the hooks in
    //            boringssl.ts, c-ares via ares_library_init_mem).
    const override = cfg.linux && !cfg.asan;

    const defines: Record<string, string | number | true> = {
      // The .a path; gates symbol visibility in mimalloc/internal.h.
      MI_STATIC_LIB: true,

      // Don't walk all heaps on exit. Bun's shutdown is already complicated
      // enough without mimalloc traversing every live allocation.
      MI_SKIP_COLLECT_ON_EXIT: 1,

      // Go further: skip mi_process_done entirely. It exists for the
      // dlopen/dlclose-a-static-mimalloc case (issue #281); Bun is a static
      // exe that exits via _exit, so the OS reclaims everything. Running it
      // tears down locks/TLS while other static destructors may still call
      // free(). MI_SKIP_COLLECT_ON_EXIT only skips the heap walk inside it.
      MI_NO_PROCESS_DETACH: 1,

      // mi_free finds a block's page through the page map. Without this, page
      // meta data sits at 256 MiB boundaries, every arena must start on one, and
      // mi_manage_os_memory_ex refuses JSC's structure heap once its reservation
      // is 256 MiB or less (JSC halves it under `ulimit -v`): abort on startup.
      MI_FREE_USE_PAGEMAP: 1,

      ...(cfg.release && { MI_BUILD_RELEASE: true }),
    };

    // Opt mimalloc's arenas out of Transparent Huge Pages. Only matters when
    // /sys/kernel/mm/transparent_hugepage/enabled is `always` (RHEL, Amazon
    // Linux, Arch); under `madvise` nothing in bun asks for huge pages anyway.
    // Measured on an `always` box (release, x64):
    //   bun -e 1:           THP off = 30MB peak,  THP on = 54MB peak
    //   Bun.serve hello:    THP off = 46MB rss,   THP on = 68MB rss
    // mimalloc does this per mapping (MADV_NOHUGEPAGE), not per process, so
    // spawned children keep the system THP policy. JSC's reservations and
    // bun_alloc's lazy arena opt out the same way on their side.
    if (cfg.linux) defines.MI_DEFAULT_ALLOW_THP = 0;

    if (cfg.abi === "musl") defines.MI_LIBC_MUSL = 1;
    if (cfg.hardened) defines.MI_SECURE = 1;
    if (override) defines.MI_MALLOC_OVERRIDE = true;

    if (cfg.debug) {
      // Heavy debug checks: guard bytes, freed-memory poisoning, double-free
      // detection. Slow but catches memory bugs early. The cmake build sets
      // MI_DEBUG=2 for plain Debug; MI_DEBUG_FULL=ON bumps to 3.
      defines.MI_DEBUG = 3;
    }

    if (cfg.asan) {
      defines.MI_TRACK_ASAN = 1;
      // Shadow-memory annotations so UBSan doesn't false-positive on
      // mimalloc's internal type punning.
      defines.MI_UBSAN = 1;
    }

    // Mimalloc annotations so valgrind understands its arena layout
    // (without this, every mimalloc alloc looks like a leak).
    if (cfg.valgrind) defines.MI_TRACK_VALGRIND = 1;

    const cflags = [
      "-fvisibility=hidden",
      "-Wno-deprecated",
      "-Wno-static-in-inline",
      // Bare token (mi_stringify() pastes it into the banner string), so
      // it can't go through DirectBuild.defines which would quote it.
      `-DMI_CMAKE_BUILD_TYPE=${cfg.buildType.toLowerCase()}`,
    ];

    // TLS model: initial-exec for the static link into bun's executable
    // (one DTV slot, no __tls_get_addr indirection). musl static needs
    // local-dynamic — initial-exec there can SIGSEGV on dlopen of native
    // addons because musl's static TLS block is fixed-size. ELF/Mach-O
    // only — clang-cl doesn't recognize -ftls-model (COFF has no TLS
    // models; mimalloc's cmake gates it behind NOT WIN32 too).
    if (!cfg.windows) {
      cflags.push(cfg.abi === "musl" ? "-ftls-model=local-dynamic" : "-ftls-model=initial-exec");
    }

    if (override) cflags.push("-fno-builtin-malloc");
    if (override || overridesDarwinAllocator(cfg)) {
      // `operator new` ends in mi_new here. See patches/mimalloc/new-oom-hook.patch.
      // The value is a function name, and a `defines` entry would quote it.
      cflags.push("-DMI_NEW_OOM=Bun__outOfMemory");
    }

    // ─── Windows: silence the vendored-C-as-C++ warning flood ───
    // lang:"c++" means .c compiles as C++; clang-cl then complains about
    // every C-ism (old-style casts, zero-as-null, C++98 compat). Noise —
    // mimalloc is correct C, just not idiomatic C++.
    if (cfg.windows) cflags.push("-w");

    const spec: DirectBuild = {
      kind: "direct",
      // Compile as C++. Required because we link against C++ code that uses
      // mimalloc types, and C/C++ ABI can differ (notably around structs
      // with trailing flexible arrays).
      lang: "cxx",
      sources: ["src/static.c"],
      includes: ["include"],
      defines,
      cflags,
      pic: true,
    };
    return spec;
  },

  provides: () => ({
    libs: [],
    includes: ["include"],
  }),
};
