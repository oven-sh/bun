/**
 * c-ares — async DNS resolver. Backs node:dns and the Happy Eyeballs logic
 * in bun's HTTP client. Async is the point — libc's getaddrinfo blocks.
 */

import type { Dependency } from "../source.ts";

const CARES_COMMIT = "3ac47ee46edd8ea40370222f91613fc16c434853";

export const cares: Dependency = {
  name: "cares",
  versionMacro: "C_ARES",

  source: () => ({
    kind: "github-archive",
    repo: "c-ares/c-ares",
    commit: CARES_COMMIT,
  }),

  build: () => ({
    kind: "nested-cmake",
    targets: ["c-ares"],
    // c-ares uses -fPIC internally for worker-thread sharing reasons (its
    // thread-local resolver state has to be position-independent on some
    // platforms). CARES_STATIC_PIC reflects this; we also set pic: true
    // so our flag tracking stays consistent.
    pic: true,
    args: {
      CARES_STATIC: "ON",
      CARES_STATIC_PIC: "ON",
      CARES_SHARED: "OFF",
      CARES_BUILD_TOOLS: "OFF",
      // Without this c-ares installs to ${prefix}/lib64 on some linux distros
      // (multilib convention). We never install, but it also affects the
      // build-tree output path on those systems.
      CMAKE_INSTALL_LIBDIR: "lib",
    },
    libSubdir: "lib",
  }),

  provides: () => ({
    libs: ["cares"],
    includes: ["include"],
  }),
};
