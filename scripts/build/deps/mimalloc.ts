/**
 * mimalloc — Microsoft's memory allocator. Bun's global malloc replacement
 * on Linux, and the JS heap allocator everywhere.
 *
 * DirectBuild: compiles only `src/static.c`, mimalloc's unity TU that
 * #includes every other source. The cmake build also produced a per-file
 * `.a`, but linking that on apple/linux-release tripped duplicate-symbol
 * errors (microsoft/mimalloc#512) because the archive ended up containing
 * both static.c.o and the individual .o files. With one TU there's nothing
 * to duplicate, so the old object-vs-archive workaround is gone.
 */

import type { Dependency, DirectBuild } from "../source.ts";

const MIMALLOC_COMMIT = "f15aecb94fc8096008bf87b90c53ed682026914a";

export const mimalloc: Dependency = {
  name: "mimalloc",
  versionMacro: "MIMALLOC",

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/mimalloc",
    commit: MIMALLOC_COMMIT,
  }),

  build: cfg => {
    // ─── Override behavior (global malloc replacement) ───
    //   ASAN:    OFF — ASAN interceptors must see the real malloc.
    //   macOS:   OFF — overriding via zone/interpose breaks NAPI addons and
    //            system frameworks (SecureTransport etc.).
    //   Linux:   ON — the main win. All malloc/free routes through mimalloc,
    //            including WebKit's bmalloc when it falls back to system malloc.
    //   Windows: OFF — Bun links the static CRT and calls mi_* directly;
    //            alloc-override.c emits _expand/_msize/free which duplicate
    //            against libucrt(d) at link time.
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

      ...(cfg.release && { MI_BUILD_RELEASE: true }),
    };

    // Disable Transparent Huge Pages. Measured impact:
    //   bun --eval 1:  THP off = 30MB peak,  THP on = 52MB peak
    //   http-hello.js: THP off = 52MB peak,  THP on = 74MB peak
    // THP trades memory for (sometimes) latency; for a JS runtime the
    // memory cost isn't worth it. The cmake option only applies on Linux.
    if (cfg.linux) defines.MI_DEFAULT_ALLOW_THP = 0;

    if (cfg.abi === "musl") defines.MI_LIBC_MUSL = 1;
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
