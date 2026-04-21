/**
 * Unified source bundling — WebKit-style.
 *
 * Concatenates N small .cpp files into one translation unit by writing
 * `UnifiedSource-<dir>-<n>.cpp` files that contain only `#include "abs.cpp"`
 * lines, then compiling those instead of the originals.
 *
 * Why: Bun has ~550 .cpp files, ~330 of them under 200 lines. Each compile
 * spends most of its time re-parsing the same JSC/WebCore headers. Bundling
 * 8 files into one TU means 1 header parse instead of 8 — same code, 1/8th
 * the redundant frontend work. WebKit reports a 3–4× clean-build speedup
 * from this technique alone.
 *
 * Algorithm (matches WebKit's generate-unified-source-bundles):
 *   - Group sources by parent directory. Files from different directories
 *     never share a bundle — keeps `using namespace WebCore` in webcore/
 *     from leaking into bindings/ etc.
 *   - Sort each group by basename for determinism.
 *   - Walk each group filling bundles of `bundleSize` (default 8).
 *   - Files in `noUnify` compile standalone (large enough to saturate a
 *     core alone, or have per-file flag overrides, or are known to conflict).
 *
 * Pitfalls (handled by convention, not by this script — fix at the source):
 *   - File-static names from N files now share a TU. On collision, wrap the
 *     statics in an anonymous or `namespace FILENAME { }` block, or rename.
 *   - `using namespace X;` at file scope leaks into later includes in the
 *     same bundle.
 *   - A file may build only because an earlier sibling already pulled a
 *     header. When bundle composition shifts (file added/removed), the
 *     missing include surfaces. Fix the include; don't reorder bundles.
 *
 * Incremental builds: editing one .cpp recompiles its whole bundle (8 files).
 * Acceptable — the bundle compile is still fast, and ccache handles the
 * common case of unchanged bundles. Set `cfg.unifiedSources = false` for
 * fine-grained incremental during heavy single-file iteration.
 */

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Config } from "./config.ts";
import { fileOverrides } from "./flags.ts";
import { writeIfChanged } from "./fs.ts";
import { slash } from "./shell.ts";

/**
 * Directories whose files all compile standalone. Reasons inline.
 * Matched as a prefix of `relative(cwd, abs)`.
 */
const noUnifyDirs: readonly string[] = [];

/**
 * Files that must compile standalone. Reasons inline.
 * Paths are repo-root-relative; matched against `relative(cwd, abs)`.
 */
const noUnify = new Set<string>([
  // Files with per-file flag overrides can't share a TU with files that
  // need different flags. Pulled from flags.ts so the two lists can't drift.
  ...fileOverrides.map(o => o.file),

  // Heavy single-file TUs that already saturate a core. Bundling them with
  // siblings would serialize work that should run in parallel.
  "src/bun.js/bindings/ZigGlobalObject.cpp",
  "src/bun.js/bindings/BunObject.cpp",
  "src/bun.js/bindings/bindings.cpp",
  "src/bun.js/bindings/BunProcess.cpp",
  "src/bun.js/bindings/JSBuffer.cpp",
  "src/bun.js/bindings/KeyObject.cpp",
  "src/bun.js/bindings/napi.cpp",
  "src/bun.js/bindings/webcore/SerializedScriptValue.cpp",
  "src/bun.js/bindings/webcore/HTTPParsers.cpp",

  // Duplicates static MIME-parsing helpers from JSMIMEParams.cpp verbatim;
  // both end up in the same bundle. TODO: extract helpers to a shared header.
  "src/bun.js/bindings/webcore/JSMIMEType.cpp",

  // These instantiate JSDOMConvert templates with JSC::* types whose toJS()
  // overloads live in namespace WebCore — ADL can't find them, so they rely
  // on ordinary lookup at template definition time. That fails if an earlier
  // file in the bundle already parsed JSDOMConvertInterface.h /
  // JSDOMWrapperCache.h before the overload was visible.
  "src/bun.js/bindings/webcore/JSWasmStreamingCompiler.cpp",
  "src/bun.js/bindings/webcore/JSDOMPromiseDeferred.cpp",
  "src/bun.js/bindings/webcore/JSMessageEventCustom.cpp",
  "src/bun.js/bindings/sqlite/JSSQLStatement.cpp",

  // WebKit-derived crypto algorithm impls share file-static helper names
  // (`aesAlgorithm`, `cryptEncrypt`, `ALG128`, `IVSIZE`, ...) — upstream
  // also compiles these outside unified sources. The remaining ~70
  // webcrypto files (JS bindings, key types) bundle cleanly.
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_CBC.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_CBCOpenSSL.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_CFB.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_CFBOpenSSL.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_CTR.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_CTROpenSSL.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_GCM.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_GCMOpenSSL.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmAES_KW.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmECDSA.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmHMAC.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmRSAES_PKCS1_v1_5.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmRSASSA_PKCS1_v1_5.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmRSA_OAEP.cpp",
  "src/bun.js/bindings/webcrypto/CryptoAlgorithmRSA_PSS.cpp",
  "src/bun.js/bindings/webcrypto/SubtleCrypto.cpp",
]);

/** How many .cpp files per bundle. WebKit defaults to 8; we use 16. */
const bundleSize = 16;

export interface UnifiedSplit {
  /** Generated UnifiedSource-*.cpp absolute paths to compile. */
  unified: string[];
  /** Sources that compile standalone (no-unify list, or alone in their dir). */
  standalone: string[];
  /**
   * Original .cpp paths that were bundled (i.e. NOT in `standalone`). Used to
   * emit per-file compile_commands.json entries so clangd works when the user
   * opens an individual source instead of the bundle.
   */
  bundled: string[];
}

/**
 * Generate unified-source bundle files under `<buildDir>/unified/` and return
 * the split. Idempotent — `writeIfChanged` preserves mtimes, so a no-op
 * configure produces no rebuilds.
 *
 * `cxxSources` must be absolute paths (the glob output). Generated codegen
 * .cpp files should NOT be passed here — those are already large single TUs
 * (ZigGeneratedClasses.cpp etc.) and are added to the compile list separately
 * in bun.ts.
 */
export function generateUnifiedSources(cfg: Config, cxxSources: readonly string[]): UnifiedSplit {
  const outDir = resolve(cfg.buildDir, "unified");
  mkdirSync(outDir, { recursive: true });

  const standalone: string[] = [];
  const byDir = new Map<string, string[]>();

  for (const abs of cxxSources) {
    // slash(): noUnify keys and the dir tag below are posix-style.
    const rel = slash(relative(cfg.cwd, abs));
    if (noUnify.has(rel) || noUnifyDirs.some(d => rel.startsWith(d))) {
      standalone.push(abs);
      continue;
    }
    const dir = dirname(rel);
    let arr = byDir.get(dir);
    if (arr === undefined) byDir.set(dir, (arr = []));
    arr.push(abs);
  }

  const unified: string[] = [];
  const bundled: string[] = [];
  // Stable iteration: sort directory keys and basenames by code unit (default
  // .sort()) so bundle composition is identical regardless of glob order or
  // host LC_COLLATE.
  for (const dir of [...byDir.keys()].sort()) {
    const files = byDir.get(dir)!.sort((a, b) => (basename(a) < basename(b) ? -1 : 1));

    // Single file in a directory: no point wrapping it. Compile directly so
    // compiler diagnostics point at the real path.
    if (files.length === 1) {
      standalone.push(files[0]!);
      continue;
    }

    const tag = dir.replace(/[^A-Za-z0-9]+/g, "_");
    for (let i = 0; i < files.length; i += bundleSize) {
      const chunk = files.slice(i, i + bundleSize);
      const n = i / bundleSize;
      const out = resolve(outDir, `UnifiedSource-${tag}-${n}.cpp`);
      // Absolute include paths: the bundle lives in buildDir but the sources
      // are in src/. -I doesn't help for #include "foo.cpp"; absolute is
      // simplest and matches what compile_commands.json consumers expect.
      // slash(): clang accepts forward slashes everywhere; native backslashes
      // in `#include "C:\..."` are escape sequences.
      const body = chunk.map(f => `#include "${slash(f)}"`).join("\n") + "\n";
      writeIfChanged(out, body);
      unified.push(out);
      bundled.push(...chunk);
    }
  }

  // Prune stale bundles from previous configures (e.g. a directory shrank
  // from 3 bundles to 1). They're not in the ninja graph so they wouldn't be
  // built, but leaving them confuses grep/clangd indexing.
  const live = new Set(unified.map(p => basename(p)));
  for (const f of readdirSync(outDir)) {
    if (f.endsWith(".cpp") && !live.has(f)) rmSync(resolve(outDir, f));
  }

  return { unified, standalone, bundled };
}
