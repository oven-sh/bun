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

// Tip of oven-sh/libuv's `bun` branch — upstream f3ce527e + the win-pipe
// CancelIoEx race fix + ConPTY support in uv_spawn. To bump upstream, rebase
// the `bun` branch and update this SHA.
const LIBUV_COMMIT = "4dcfac4780d394e0dc2d3fb30335ca01b553eb46";

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

  patches: [
    // Re-arm the AFD ioctl before poll_cb (matching wepoll's
    // port__update_events_if_polling-before-return). AFD is level-triggered
    // (ReactOS AfdSelect: `Events & FCB->PollState` checked on IRP arrival),
    // so a peer RST that lands during poll_cb is caught by the freshly-
    // submitted req. Upstream libuv re-arms *after* poll_cb, leaving a gap
    // an in-process loopback fetch().abort() can fall into. To upstream:
    // send to libuv/libuv with the wepoll/ReactOS references in the patch
    // comment as the rationale.
    "patches/libuv/win-poll-rearm-before-callback.patch",
    // uv__tty_read_stop picked the cancellation path from mode.mode, but
    // uv_tty_set_mode flips mode.mode *between* stop/start. A synchronous
    // setRawMode(false); setRawMode(true) hits read_stop twice against the
    // same still-pending raw request; the second call sees mode=Normal,
    // takes the line-read path, and sets UV_HANDLE_CANCELLATION_PENDING —
    // which only uv_process_tty_read_line_req clears. The flag sticks, and
    // the next real cooked-read cancel is skipped, leaving ReadConsoleW
    // blocked until Enter (Ink reattach, readline reinit). Fix: dispatch on
    // read_line_buffer.len (the pending-request type), same as
    // uv__process_tty_read_req already does. Upstreamable as-is.
    "patches/libuv/win-tty-read-stop-match-pending-req.patch",
  ],

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
