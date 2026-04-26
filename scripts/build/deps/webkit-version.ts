/**
 * WebKit commit pin. Lives in its own leaf module so `config.ts` can import
 * the version without pulling in `webkit.ts` — which would transitively pull
 * `flags.ts → config.ts`, a cycle that some bundlers/loaders evaluate in an
 * order where the `webkit` Dependency export hits TDZ when `deps/index.ts`
 * later dereferences it.
 *
 * Override via `--webkit-version=<hash>` to test a branch.
 * From https://github.com/oven-sh/WebKit releases.
 */
export const WEBKIT_VERSION = "bdf6aab38a9c6f99df3fd1486406ab6b74180fbb";
