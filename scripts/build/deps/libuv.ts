/**
 * libuv — cross-platform async I/O. Bun uses it on Windows ONLY, for the
 * event loop and file I/O (Windows' IOCP model needs a proper abstraction
 * layer). On unix, bun's event loop is custom (kqueue/epoll direct).
 *
 * On POSIX, node-api addons that reference libuv symbols are served by
 * src/bun.js/bindings/uv-posix-stubs.c + uv-posix-polyfills*.c, with headers
 * from src/bun.js/bindings/libuv/ (see flags.ts) — vendor libuv is not built.
 */

import type { Dependency } from "../source.ts";

// Tip of oven-sh/libuv's `bun` branch — upstream f3ce527e + the win-pipe
// CancelIoEx race fix + ConPTY support in uv_spawn. To bump upstream, rebase
// the `bun` branch and update this SHA.
const LIBUV_COMMIT = "4dcfac4780d394e0dc2d3fb30335ca01b553eb46";

export const libuv: Dependency = {
  name: "libuv",

  enabled: cfg => cfg.windows,

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/libuv",
    commit: LIBUV_COMMIT,
  }),

  build: () => ({
    kind: "nested-cmake",
    targets: ["uv_a"],
    args: {
      LIBUV_BUILD_SHARED: "OFF",
      LIBUV_BUILD_TESTS: "OFF",
      LIBUV_BUILD_BENCH: "OFF",
    },
    // libuv's windows code has a handful of int-conversion warnings that
    // clang-cl elevates. /DWIN32 /D_WINDOWS are what MSVC's cmake preset
    // would add automatically; libuv's headers gate win32 paths on them.
    extraCFlags: ["/DWIN32", "/D_WINDOWS", "-Wno-int-conversion"],
  }),

  provides: () => ({
    // uv_a → libuv.lib (the cmake target sets OUTPUT_NAME=libuv on Windows
    // to avoid conflicts with system uv.lib).
    libs: ["libuv"],
    includes: ["include"],
  }),
};
