/**
 * ls-hpack — HPACK header compression for HTTP/2. Litespeed's implementation;
 * faster than nghttp2's for our workloads.
 */

import type { Dependency, NestedCmakeBuild } from "../source.ts";

const LSHPACK_COMMIT = "8905c024b6d052f083a3d11d0a169b3c2735c8a1";

export const lshpack: Dependency = {
  name: "lshpack",
  versionMacro: "LSHPACK",

  source: () => ({
    kind: "github-archive",
    repo: "litespeedtech/ls-hpack",
    commit: LSHPACK_COMMIT,
  }),

  patches: ["patches/lshpack/CMakeLists.txt.patch"],

  build: cfg => {
    const spec: NestedCmakeBuild = {
      kind: "nested-cmake",
      args: {
        SHARED: "OFF",
        LSHPACK_XXH: "ON",
      },

      // FORCE Release even in debug builds.
      //
      // lshpack's Debug config adds -fsanitize=address in its own CMakeLists,
      // but doesn't link asan — it expects the consuming executable to. Our
      // debug link doesn't satisfy those symbols on darwin (the asan runtime
      // there is a dylib, not a static lib, so __asan_handle_no_return and
      // friends resolve at load time — but lshpack.a references them at link
      // time). Forcing Release drops the -fsanitize flag entirely.
      //
      // If we ever want to asan-test lshpack itself, do it in a separate
      // standalone build where asan linking is under our control.
      buildType: "Release",
    };
    if (cfg.windows) {
      spec.extraCFlags = ["-w"];
    }
    return spec;
  },

  provides: cfg => ({
    libs: ["ls-hpack"],
    // Windows needs compat/queue for <sys/queue.h> shim (LIST_HEAD/etc. macros
    // that don't exist on win32). On unix the real sys/queue.h is used.
    includes: cfg.windows ? [".", "compat/queue"] : ["."],
  }),
};
