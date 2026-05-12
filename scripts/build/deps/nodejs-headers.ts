/**
 * Node.js headers — for N-API compatibility.
 *
 * Downloaded from nodejs.org releases. Headers-only (no libs). After
 * extraction we delete `openssl/` and `uv/` subdirs — bun uses BoringSSL
 * (not OpenSSL) and its own libuv, and the bundled headers conflict.
 */

import { resolve } from "node:path";
import type { Dependency } from "../source.ts";

/**
 * Node.js compat version — reported via process.version, used for headers
 * download URL, and passed to zig as -Dreported_nodejs_version.
 * Override via `--nodejs-version=X.Y.Z` to test a bump.
 */
export const NODEJS_VERSION = "24.3.0";

/** Node.js NODE_MODULE_VERSION — for native addon ABI compat. */
export const NODEJS_ABI_VERSION = "137";

export const nodejsHeaders: Dependency = {
  name: "nodejs",

  source: cfg => ({
    kind: "prebuilt",
    url: `https://nodejs.org/dist/v${cfg.nodejsVersion}/node-v${cfg.nodejsVersion}-headers.tar.gz`,
    identity: cfg.nodejsVersion,
    // Delete headers that conflict with BoringSSL / our libuv.
    // Tarball top-level is `node-v<version>/` (hoisted), inside is `include/node/`.
    rmAfterExtract: ["include/node/openssl", "include/node/uv", "include/node/uv.h"],
    destDir: resolve(cfg.cacheDir, `nodejs-headers-${cfg.nodejsVersion}`),
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({
    libs: [],
    // Both include/ and include/node/ — some files use <node/foo.h>,
    // some use <foo.h>. CMake adds both.
    includes: ["include", "include/node"],
  }),
};
