/**
 * All vendored dependencies. Import this to get the full list.
 *
 * Order matters for two reasons:
 *   1. `fetchDeps` relationships — a dep with fetchDeps must come AFTER the
 *      deps it references, so the referenced .ref stamp node exists in ninja
 *      when we add order-only edges to it. (zlib before libarchive.)
 *   2. Link order — when these libs hit the final link line, static linking
 *      resolves left-to-right. Deps that PROVIDE symbols should come after
 *      deps that USE them. This list becomes the link order.
 */

import type { Dependency } from "../source.ts";
import { boringssl } from "./boringssl.ts";
import { brotli } from "./brotli.ts";
import { cares } from "./cares.ts";
import { hdrhistogram } from "./hdrhistogram.ts";
import { highway } from "./highway.ts";
import { libarchive } from "./libarchive.ts";
import { libdeflate } from "./libdeflate.ts";
import { libuv } from "./libuv.ts";
import { lolhtml } from "./lolhtml.ts";
import { lshpack } from "./lshpack.ts";
import { mimalloc } from "./mimalloc.ts";
import { nodejsHeaders } from "./nodejs-headers.ts";
import { picohttpparser } from "./picohttpparser.ts";
import { sqlite } from "./sqlite.ts";
import { tinycc } from "./tinycc.ts";
import { webkit } from "./webkit.ts";
import { zlib } from "./zlib.ts";
import { zstd } from "./zstd.ts";

/**
 * All deps in dependency-resolution + link order.
 *
 * zlib FIRST — libarchive's fetchDeps references it.
 * brotli libs in internal dep order (common last on link line).
 * boringssl near the end — many things depend on crypto/ssl symbols.
 */
export const allDeps: readonly Dependency[] = [
  // Header-only / source-only first — no link order concerns.
  picohttpparser,
  nodejsHeaders,

  zlib,
  zstd,
  brotli,
  libdeflate,
  libarchive,
  cares,
  hdrhistogram,
  highway,
  libuv,
  lolhtml,
  lshpack,
  mimalloc,
  sqlite,
  tinycc,
  boringssl,
  // WebKit LAST in link order — WTF/JSC provide symbols that everything
  // above might reference (via JavaScriptCore types in headers).
  webkit,
];

// Re-export individuals for direct import when needed.
export {
  boringssl,
  brotli,
  cares,
  hdrhistogram,
  highway,
  libarchive,
  libdeflate,
  libuv,
  lolhtml,
  lshpack,
  mimalloc,
  nodejsHeaders,
  picohttpparser,
  sqlite,
  tinycc,
  webkit,
  zlib,
  zstd,
};
