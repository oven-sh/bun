/**
 * SQLite — embedded SQL database. Backs bun:sqlite.
 *
 * Source lives IN THE BUN REPO at src/jsc/bindings/sqlite/ — it's the
 * sqlite3 amalgamation (single .c file). No fetch step; tracked in git.
 *
 * Statically linked on every platform so bun:sqlite ships a consistent,
 * up-to-date SQLite. (Apple's system libsqlite3.dylib is years behind
 * and has SQLITE_OMIT_LOAD_EXTENSION compiled in.) Users can still point
 * bun:sqlite at another build at runtime with Database.setCustomSQLite().
 */

import type { Dependency } from "../source.ts";

export const sqlite: Dependency = {
  name: "sqlite",

  enabled: cfg => cfg.staticSqlite,

  source: () => ({
    kind: "in-tree",
    path: "src/jsc/bindings/sqlite",
  }),

  build: cfg => ({
    kind: "direct",
    sources: ["sqlite3.c"],
    includes: ["."],
    defines: {
      SQLITE_ENABLE_COLUMN_METADATA: true,
      SQLITE_MAX_VARIABLE_NUMBER: 250000,
      SQLITE_ENABLE_RTREE: 1,
      SQLITE_ENABLE_FTS3: 1,
      SQLITE_ENABLE_FTS3_PARENTHESIS: 1,
      SQLITE_ENABLE_FTS5: 1,
      SQLITE_ENABLE_JSON1: 1,
      SQLITE_ENABLE_MATH_FUNCTIONS: 1,
      SQLITE_ENABLE_UPDATE_DELETE_LIMIT: 1,
      SQLITE_UDL_CAPABLE_PARSER: 1,
    },
    cflags: [
      "-Wno-incompatible-pointer-types-discards-qualifiers",
      // Match the static CRT bun links; /U_DLL keeps sqlite from picking
      // the dllimport annotations meant for the DLL build.
      ...(cfg.windows ? ["/MT", "/U_DLL"] : []),
    ],
  }),

  provides: () => ({
    libs: [],
    includes: ["."],
  }),
};
