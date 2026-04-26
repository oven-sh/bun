/**
 * Pinned dep version strings — isolated from any value imports so that
 * circular-import edges via larger dep modules (e.g. deps/webkit.ts imports
 * flags.ts/source.ts, which eventually reach deps/index.ts that imports
 * webkit.ts) can't delay evaluation of these consts.
 *
 * Bun 1.3.14's module loader evaluates importers before their dependencies
 * when such a cycle exists, producing a TDZ on the consts. Keeping the
 * version constants alone in a leaf module (no imports, no exports beyond
 * the consts) removes them from any cycle.
 *
 * When bumping a version, update the const here AND the comment in the
 * corresponding dep module (e.g. deps/webkit.ts).
 */

export const WEBKIT_VERSION = "bdf6aab38a9c6f99df3fd1486406ab6b74180fbb";
export const NODEJS_VERSION = "24.3.0";
export const NODEJS_ABI_VERSION = "137";
export const ZIG_COMMIT = "04e7f6ac1e009525bc00934f20199c68f04e0a24";
