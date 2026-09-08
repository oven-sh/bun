/**
 * SQLite — embedded SQL database. Backs bun:sqlite and node:sqlite.
 *
 * Source lives IN THE BUN REPO at src/jsc/bindings/sqlite/ — it's the
 * sqlite3 amalgamation (single .c file). No fetch step; tracked in git.
 *
 * Built when staticSqlite is true (the Linux/Windows default). On macOS
 * both bun:sqlite and node:sqlite dlopen the system libsqlite3.dylib at
 * runtime (LAZY_LOAD_SQLITE=1) so exactly one library is loaded per
 * process — see the corruption caveat in config.ts. Apple's build omits
 * load_extension/percentile()/geopoly/rbu (and, on older macOS releases,
 * the session extension); node:sqlite runtime-gates the affected APIs and
 * points at Database.setCustomSQLite() for a full build.
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
      // node:sqlite exposes createSession/applyChangeset + columns()
      // metadata. Match Node.js's compile-time feature set so those
      // APIs work identically. PREUPDATE_HOOK is a prerequisite for the
      // session extension.
      SQLITE_ENABLE_SESSION: 1,
      SQLITE_ENABLE_PREUPDATE_HOOK: 1,
      SQLITE_ENABLE_DBSTAT_VTAB: 1,
      SQLITE_ENABLE_GEOPOLY: 1,
      SQLITE_ENABLE_RBU: 1,
      SQLITE_ENABLE_PERCENTILE: 1,
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
