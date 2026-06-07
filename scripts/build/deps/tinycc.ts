/**
 * TinyCC — small embeddable C compiler. Powers bun:ffi's JIT-compile path,
 * where user-provided C gets compiled and linked at runtime.
 *
 * Disabled on windows-arm64 (tinycc doesn't have an arm64-coff backend).
 *
 * Built via DirectBuild — no cmake sub-process. The old overlay
 * CMakeLists.txt had two recurring ASAN workarounds for the c2str host
 * tool (Linux ASLR/shadow-map, macOS 26.4 dyld deadlock); DirectBuild's
 * no-sanitize-on-host-tools policy sidesteps both.
 */

import type { Dependency, DirectBuild } from "../source.ts";

const TINYCC_COMMIT = "12882eee073cfe5c7621bcfadf679e1372d4537b";

export const tinycc: Dependency = {
  name: "tinycc",
  versionMacro: "TINYCC",

  // The cfg.tinycc flag already encodes the windows-arm64 exclusion
  // (see config.ts: `tinycc ?? !(windows && arm64)`).
  enabled: cfg => cfg.tinycc,

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/tinycc",
    commit: TINYCC_COMMIT,
  }),

  patches: ["patches/tinycc/tcc.h.patch"],

  build: cfg => {
    const sources = ["libtcc.c", "tccpp.c", "tccgen.c", "tccdbg.c", "tccelf.c", "tccasm.c", "tccrun.c"];
    if (cfg.arm64) sources.push("arm64-gen.c", "arm64-link.c", "arm64-asm.c");
    else sources.push("x86_64-gen.c", "x86_64-link.c", "i386-asm.c");
    if (cfg.darwin) sources.push("tccmacho.c");
    if (cfg.windows) sources.push("tccpe.c");

    const defines: Record<string, string | number | true> = {
      CONFIG_TCC_PREDEFS: true,
      ONE_SOURCE: 0,
      TCC_LIBTCC1: "",
      CONFIG_TCC_BACKTRACE: 0,
      // TCC_VERSION only appears in CLI help (tcc.c, not built) and DWARF
      // producer string. Use the commit hash for both so bumping TINYCC_COMMIT
      // is the only thing to update.
      TCC_VERSION: TINYCC_COMMIT.slice(0, 8),
      TCC_GITHASH: TINYCC_COMMIT.slice(0, 8),
    };
    if (cfg.darwin) {
      defines.TCC_TARGET_MACHO = true;
      defines.CONFIG_CODESIGN = true;
      defines.CONFIG_NEW_MACHO = true;
      // CONFIG_USR_INCLUDE was set to sysroot in the cmake version. tccrun
      // uses it to find system headers at runtime; bun:ffi doesn't exercise
      // that path (we only use libtcc as a backend, not the full preprocessor
      // driver) so we leave it at the default.
    }
    if (cfg.windows) defines.CONFIG_WIN32 = true;

    const spec: DirectBuild = {
      kind: "direct",
      sources,
      defines,
      includes: [".", "include"],
      cflags: ["-fno-strict-aliasing"],
      // tcc sources #include "config.h" — autotools would generate it,
      // we just stub it.
      headers: { "config.h": "" },
      // conftest.c with -DC2STR compiles to a tool that turns tccdefs.h
      // (C macros) into tccdefs_.h (C string literal for embedding).
      // tccpp.c includes the generated file.
      codegen: {
        tool: "conftest.c",
        toolDefines: { C2STR: true },
        args: ["include/tccdefs.h", "$out"],
        output: "tccdefs_.h",
      },
    };

    // clang-cl is noisy about tinycc's old-C idioms.
    if (cfg.windows) spec.cflags!.push("-w");

    return spec;
  },

  provides: () => ({
    libs: [],
    includes: [],
  }),
};
