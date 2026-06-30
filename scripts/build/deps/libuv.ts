/**
 * libuv — cross-platform async I/O. Bun uses it on Windows ONLY, for the
 * event loop and file I/O (Windows' IOCP model needs a proper abstraction
 * layer). On unix, bun's event loop is custom (kqueue/epoll direct).
 *
 * On POSIX, node-api addons that reference libuv symbols are served by
 * src/jsc/bindings/uv-posix-stubs.c + uv-posix-polyfills*.c, with headers
 * from src/jsc/bindings/libuv/ (see flags.ts) — vendor libuv is not built.
 */

import type { Dependency } from "../source.ts";

// Tip of oven-sh/libuv's `dylan/win-appcontainer` branch (oven-sh/libuv#5) —
// the `bun` branch (upstream f3ce527e + the win-pipe CancelIoEx race fix +
// ConPTY support in uv_spawn) plus AppContainer (lowbox) support: LOCAL\
// internal pipe names, bounded+randomized access-denied retries, console read
// cancellation without input injection (and exact-fill line-read fixes),
// sandbox-rewritten junction readback, bind EACCES/EADDRINUSE
// disambiguation, the NUL-device pipe fallback for ignored stdio, and
// uv_pipe/realpath/stat error-reporting fixes, plus uv_os_is_app_container().
// To bump upstream, rebase the `bun` branch and update this SHA.
const LIBUV_COMMIT = "5374c844778b26e1844563f08f417c78d2c23b3d";

// prettier-ignore
const SHARED = [
  "fs-poll", "idna", "inet", "random", "strscpy", "strtok", "thread-common",
  "threadpool", "timer", "uv-common", "uv-data-getter-setters", "version",
];

// prettier-ignore
const WIN = [
  "async", "core", "detect-wakeup", "dl", "error", "fs", "fs-event",
  "getaddrinfo", "getnameinfo", "handle", "loop-watcher", "pipe", "thread",
  "poll", "process", "process-stdio", "signal", "snprintf", "stream", "tcp",
  "tty", "udp", "util", "winapi", "winsock",
];

export const libuv: Dependency = {
  name: "libuv",

  enabled: cfg => cfg.windows,

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/libuv",
    commit: LIBUV_COMMIT,
  }),

  // Re-arm the AFD ioctl before poll_cb (matching wepoll's
  // port__update_events_if_polling-before-return). AFD is level-triggered
  // (ReactOS AfdSelect: `Events & FCB->PollState` checked on IRP arrival),
  // so a peer RST that lands during poll_cb is caught by the freshly-
  // submitted req. Upstream libuv re-arms *after* poll_cb, leaving a gap
  // an in-process loopback fetch().abort() can fall into. To upstream:
  // send to libuv/libuv with the wepoll/ReactOS references in the patch
  // comment as the rationale.
  patches: ["patches/libuv/win-poll-rearm-before-callback.patch"],

  build: () => ({
    kind: "direct",
    sources: [...SHARED.map(s => `src/${s}.c`), ...WIN.map(s => `src/win/${s}.c`)],
    includes: ["include", "src"],
    defines: {
      WIN32_LEAN_AND_MEAN: true,
      _CRT_DECLARE_NONSTDC_NAMES: 0,
      WIN32: true,
      _WINDOWS: true,
    },
    cflags: [
      // Hex literal required — sdkddkver.h token-pastes `ver##0000`.
      "-D_WIN32_WINNT=0x0A00",
      "/clang:-fno-strict-aliasing",
      "-Wno-int-conversion",
      "/wd4996",
    ],
  }),

  provides: () => ({
    libs: [],
    includes: ["include"],
  }),
};
