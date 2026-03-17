/**
 * mimalloc — Microsoft's memory allocator. Bun's global malloc replacement
 * on Linux, and the JS heap allocator everywhere.
 */

import type { Dependency, NestedCmakeBuild, Provides } from "../source.ts";

const MIMALLOC_COMMIT = "1beadf9651a7bfdec6b5367c380ecc3fe1c40d1a";

export const mimalloc: Dependency = {
  name: "mimalloc",
  versionMacro: "MIMALLOC",

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/mimalloc",
    commit: MIMALLOC_COMMIT,
  }),

  build: cfg => {
    const args: Record<string, string> = {
      // Always build both the static lib AND the object-library target.
      // We link the object file directly on some platforms (see provides()).
      MI_BUILD_STATIC: "ON",
      MI_BUILD_OBJECT: "ON",
      MI_BUILD_SHARED: "OFF",
      MI_BUILD_TESTS: "OFF",

      // Compile mimalloc's .c files as C++. Required because we link against
      // C++ code that uses mimalloc types, and C/C++ ABI can differ (notably
      // around structs with trailing flexible arrays).
      MI_USE_CXX: "ON",

      // Don't walk all heaps on exit. Bun's shutdown is already complicated
      // enough without mimalloc traversing every live allocation.
      MI_SKIP_COLLECT_ON_EXIT: "ON",

      // Disable Transparent Huge Pages. Measured impact:
      //   bun --eval 1:  THP off = 30MB peak,  THP on = 52MB peak
      //   http-hello.js: THP off = 52MB peak,  THP on = 74MB peak
      // THP trades memory for (sometimes) latency; for a JS runtime the
      // memory cost isn't worth it.
      MI_NO_THP: "1",
    };

    const extraCFlags: string[] = [];
    const extraCxxFlags: string[] = [];

    if (cfg.abi === "musl") {
      args.MI_LIBC_MUSL = "ON";
    }

    // ─── Override behavior (global malloc replacement) ───
    // The decision matrix:
    //   ASAN:  always OFF — ASAN interceptors must see the real malloc.
    //   macOS: OFF — macOS's malloc zones are sufficient and overriding
    //          causes issues with system frameworks (SecureTransport, etc.)
    //          that have their own allocator expectations.
    //   Linux: ON — this is the main win. All malloc/free goes through
    //          mimalloc, including WebKit's bmalloc when it falls back
    //          to system malloc.
    if (cfg.asan) {
      args.MI_TRACK_ASAN = "ON";
      args.MI_OVERRIDE = "OFF";
      args.MI_OSX_ZONE = "OFF";
      args.MI_OSX_INTERPOSE = "OFF";
      // Mimalloc's UBSan integration: sets up shadow memory annotations
      // so UBSan doesn't false-positive on mimalloc's type punning.
      args.MI_DEBUG_UBSAN = "ON";
    } else if (cfg.darwin) {
      args.MI_OVERRIDE = "OFF";
      args.MI_OSX_ZONE = "OFF";
      args.MI_OSX_INTERPOSE = "OFF";
    } else if (cfg.linux) {
      args.MI_OVERRIDE = "ON";
      args.MI_OSX_ZONE = "OFF";
      args.MI_OSX_INTERPOSE = "OFF";
    }
    // Windows: use mimalloc's defaults (no override; Windows has its own
    // mechanism via the static CRT we link).

    if (cfg.debug) {
      // Heavy debug checks: guard bytes, freed-memory poisoning, double-free
      // detection. Slow but catches memory bugs early.
      args.MI_DEBUG_FULL = "ON";
    }

    if (cfg.valgrind) {
      // Mimalloc annotations so valgrind understands its arena layout
      // (without this, every mimalloc alloc looks like a leak).
      args.MI_TRACK_VALGRIND = "ON";
    }

    // If mimalloc gets bumped to a version with MI_OPT_ARCH: pass
    // MI_NO_OPT_ARCH=ON to stop it setting -march=armv8.1-a on arm64
    // (SIGILLs on ARMv8.0 CPUs). Current pin has no arch-detection logic
    // so our global -march=armv8-a+crc (via CMAKE_CXX_FLAGS) is sufficient.

    // ─── Windows: silence the vendored-C-as-C++ warning flood ───
    // MI_USE_CXX=ON means .c files compile as C++. clang-cl then complains
    // about every C-ism: old-style casts, zero-as-null, C++98 compat, etc.
    // It's noise — mimalloc is correct C, just not idiomatic C++.
    if (cfg.windows) {
      extraCFlags.push("-w");
      extraCxxFlags.push("-w");
    }

    const spec: NestedCmakeBuild = {
      kind: "nested-cmake",
      targets: ["mimalloc-static", "mimalloc-obj"],
      args,
    };
    if (extraCFlags.length > 0) spec.extraCFlags = extraCFlags;
    if (extraCxxFlags.length > 0) spec.extraCxxFlags = extraCxxFlags;
    return spec;
  },

  provides: cfg => {
    // mimalloc's output library name depends on config flags passed to its
    // CMake. It appends suffixes based on what's enabled — there's no way
    // to override this, so we have to mirror its naming logic.
    let libname: string;
    if (cfg.windows) {
      libname = cfg.debug ? "mimalloc-static-debug" : "mimalloc-static";
    } else if (cfg.debug) {
      libname = cfg.asan ? "mimalloc-asan-debug" : "mimalloc-debug";
    } else {
      libname = "mimalloc";
    }

    // WORKAROUND: Link the object file directly, not the .a.
    //
    // Linking libmimalloc.a on macOS (and Linux release) produces duplicate
    // symbol errors at link time — mimalloc's static.c is a "unity build"
    // TU that #includes all other .c files, and libmimalloc.a ALSO contains
    // the individually-compiled .o files. The linker pulls both and barfs.
    // See https://github.com/microsoft/mimalloc/issues/512.
    //
    // The fix: link mimalloc-obj's single static.c.o directly. One TU, all
    // symbols, no archive index to confuse the linker.
    //
    // We only do this on apple + linux-release because the CMake build has
    // been working this way for years. Debug Linux uses the .a successfully
    // (possibly because -g changes symbol visibility in a way that dodges
    // the issue, or the debug .a is built differently — haven't dug into it).
    const useObjectFile = cfg.darwin || (cfg.linux && cfg.release);

    const provides: Provides = {
      libs: useObjectFile ? ["CMakeFiles/mimalloc-obj.dir/src/static.c.o"] : [libname],
      includes: ["include"],
    };
    return provides;
  },
};
