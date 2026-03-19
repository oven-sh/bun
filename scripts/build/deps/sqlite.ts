/**
 * SQLite — embedded SQL database. Backs bun:sqlite.
 *
 * Source lives IN THE BUN REPO at src/bun.js/bindings/sqlite/ — it's the
 * sqlite3 amalgamation (single .c file) plus a small CMakeLists.txt we
 * maintain. No fetch step; the source is tracked in git.
 *
 * Only built when staticSqlite=true. Otherwise bun dlopen()s the system
 * sqlite at runtime (macOS ships a recent sqlite; most linux distros don't,
 * so static is the default on linux).
 */

import type { Dependency } from "../source.ts";

export const sqlite: Dependency = {
  name: "sqlite",

  enabled: cfg => cfg.staticSqlite,

  source: () => ({
    kind: "in-tree",
    path: "src/bun.js/bindings/sqlite",
  }),

  build: () => ({
    kind: "nested-cmake",
    args: {},
  }),

  provides: () => ({
    libs: ["sqlite3"],
    includes: ["."],
  }),
};
