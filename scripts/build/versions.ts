/**
 * Pinned dep-version constants.
 *
 * Kept in a leaf module (no imports from other build/ files) so that
 * `config.ts` can read them without pulling `deps/webkit.ts` into the
 * `config.ts → deps/webkit.ts → flags.ts → config.ts` ESM cycle. That cycle
 * was latent for a long time but started raising TDZ `ReferenceError` under
 * the 1.3.14 WebKit module-loader rewrite (see #29393); sync-child-of-async-
 * parent scheduling no longer tolerates top-level const reads across the SCC.
 *
 * The actual version strings are re-exported from each dep file
 * (`deps/webkit.ts`, `deps/nodejs-headers.ts`, `zig.ts`) so external
 * consumers that imported `{ WEBKIT_VERSION }` from the dep module keep
 * working.
 */

export const WEBKIT_VERSION = "bdf6aab38a9c6f99df3fd1486406ab6b74180fbb";
