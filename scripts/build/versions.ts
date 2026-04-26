/**
 * `WEBKIT_VERSION` lives here — a leaf module with no imports from other
 * `scripts/build/` files — so that `config.ts` can read it without pulling
 * `deps/webkit.ts` into the `config.ts → deps/webkit.ts → flags.ts →
 * config.ts` ESM cycle. That cycle was latent for a long time but started
 * raising TDZ `ReferenceError` under the 1.3.14 WebKit module-loader rewrite
 * (see #29393); sync-child-of-async-parent scheduling no longer tolerates
 * top-level const reads across the SCC.
 *
 * `deps/webkit.ts` re-exports the constant so external consumers that
 * imported `{ WEBKIT_VERSION }` from the dep module keep working. The
 * Node.js and Zig pins (`NODEJS_VERSION`, `NODEJS_ABI_VERSION`, `ZIG_COMMIT`)
 * still live in their respective dep files — those don't participate in the
 * import cycle today, so there's no need to move them.
 */

export const WEBKIT_VERSION = "bdf6aab38a9c6f99df3fd1486406ab6b74180fbb";
