/**
 * Warm a read-only prefetch cache for the build's network downloads.
 *
 * Run at CI-image bake time by the `prefetch` tool of scripts/build/ci-images/spec.ts. Produces a directory
 * that, when pointed at via `BUN_BUILD_PREFETCH_DIR`, lets a fresh build
 * complete with no network round-trips for matching dep versions.
 *
 * Layout written (matches what scripts/build/download.ts consults):
 *   <prefetchDir>/by-url/<sha256(url)[:32]>      raw downloaded bytes
 *   <prefetchDir>/extracted/<basename(dest)>/    pre-extracted prebuilt trees
 *
 * Everything is content-addressed: a dep version bump in scripts/build/deps/
 * changes the URL → different by-url key → cache miss → build downloads it.
 * The image doesn't need rebuilding when versions change; the baked cache just
 * becomes a partial hit until the next image refresh.
 *
 * Usage:
 *   bun scripts/prefetch-deps.ts <prefetchDir>
 *
 * Enumerates variants on the dimensions that affect download URLs (asan, lto,
 * baseline, musl) for the current host os/arch. Variants without a published
 * artifact are skipped — better to over-enumerate and 404 than to miss one.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { resolveConfig, type Config, type PartialConfig } from "./build/config.ts";
import { resolveToolchain } from "./build/configure.ts";
import { allDeps } from "./build/deps/index.ts";
import {
  downloadRetry,
  downloadWithRetry,
  extractTarGz,
  extractZip,
  pinnedSha256,
  prebuiltIsCurrent,
  prefetchPathForUrl,
  sha256OfFile,
  stampPrebuilt,
} from "./build/download.ts";

const dest = process.argv[2];
if (dest === undefined) {
  process.stderr.write("Usage: bun scripts/prefetch-deps.ts <prefetchDir>\n");
  process.exit(1);
}
const byUrlDir = resolve(dest, "by-url");
const extractedDir = resolve(dest, "extracted");

// ───────────────────────────────────────────────────────────────────────────
// Enumerate URL-affecting config variants for the current host.
//
// github-archive sources are config-independent, so one base config covers
// them. WebKit prebuilt URL varies by (musl, baseline, debug|lto, asan).
// Iterate the cross-product, dedupe URLs.
// ───────────────────────────────────────────────────────────────────────────

const toolchain = resolveToolchain();
const base: PartialConfig = { buildType: "Release", ci: true, webkit: "prebuilt" };
const baseCfg = resolveConfig(base, toolchain);

const variants: PartialConfig[] = [];
for (const asan of [false, true]) {
  for (const lto of [false, true]) {
    for (const baseline of baseCfg.x64 ? [false, true] : [false]) {
      for (const abi of baseCfg.linux ? (["gnu", "musl"] as const) : [undefined]) {
        variants.push({ ...base, asan, lto, baseline, ...(abi !== undefined && { abi }) });
      }
    }
  }
}

interface Item {
  url: string;
  sha256?: string | undefined;
  /** If set, also extract into `<extractedDir>/<name>/` and stamp it. */
  extract?: {
    name: string;
    identity: string;
    kind: "tar.gz" | "zip";
    /** Paths (relative to extracted root) to delete before stamping — mirrors fetchPrebuilt's rmAfterExtract. */
    rm?: string[];
  };
}

const items = new Map<string, Item>();
const extractNames = new Set<string>();
/** Variants the release does not have: every file it does have is pinned. */
const unpinned = new Set<string>();
function add(item: Item): void {
  if (items.has(item.url)) return;
  // Only one item may claim a given extracted/<name>/ — with parallel workers
  // two would race on the same staging dir. First-wins is fine: today no two
  // distinct URLs map to the same name (each WebKit suffix produces a unique
  // destDir basename), so this is a guard against future drift, not a tie-
  // break that matters.
  if (item.extract !== undefined) {
    if (extractNames.has(item.extract.name)) item = { url: item.url, sha256: item.sha256 };
    else extractNames.add(item.extract.name);
  }
  items.set(item.url, item);
}

for (const partial of variants) {
  let cfg: Config;
  try {
    cfg = resolveConfig(partial, toolchain);
  } catch (err) {
    // A variant this host cannot configure (a missing cross SDK, an option
    // combination resolveConfig rejects) is skipped — loudly, so a bake that
    // silently lost a target's sources is visible in the log.
    console.warn(`prefetch: skipping ${JSON.stringify(partial)}: ${(err as Error).message}`);
    continue;
  }

  for (const dep of allDeps) {
    if (dep.enabled !== undefined && !dep.enabled(cfg)) continue;
    const src = dep.source(cfg);
    if (src.kind === "github-archive") {
      add({ url: `https://github.com/${src.repo}/archive/${src.commit}.tar.gz` });
    } else if (src.kind === "prebuilt") {
      const destDir = src.destDir ?? resolve(cfg.vendorDir, dep.name);
      const sha256 = src.sha256sums !== undefined ? pinnedSha256(src.sha256sums, src.url) : undefined;
      if (src.sha256sums !== undefined && sha256 === undefined) {
        unpinned.add(src.url);
        continue;
      }
      add({
        url: src.url,
        sha256,
        extract: {
          name: basename(destDir),
          identity: src.identity,
          kind: "tar.gz",
          ...(src.rmAfterExtract !== undefined && { rm: src.rmAfterExtract }),
        },
      });
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Download (and extract prebuilts) into the prefetch dir. by-url entries are
// kept even after extraction so the build can fall through to the raw-file
// path if its dest naming ever drifts from `extracted/<basename>`.
// ───────────────────────────────────────────────────────────────────────────

await mkdir(byUrlDir, { recursive: true });
await mkdir(extractedDir, { recursive: true });

let ok = 0;
let skipped = 0;
let missing = unpinned.size;
for (const url of unpinned) console.log(`  (skip — no sha256 is pinned for ${url})`);

async function fetchOne(item: Item): Promise<void> {
  // Same key the build's downloadWithRetry will look up — keeps producer and
  // consumer in lockstep without duplicating the hash.
  const path = prefetchPathForUrl(item.url, dest)!;

  if (existsSync(path) && (item.sha256 === undefined || sha256OfFile(path) === item.sha256)) {
    skipped++;
  } else {
    try {
      const name = basename(new URL(item.url).pathname);
      await downloadWithRetry(item.url, path, name, downloadRetry, undefined, item.sha256);
    } catch (err) {
      // 404 = the enumerated variant has no published artifact — expected,
      // the build will just download that one if it ever needs it. Anything
      // else (CDN outage, TLS, disk write) means a real failure that would
      // leave the cache silently incomplete; fail loud so the bake operator
      // sees it instead of shipping an empty image.
      if (err instanceof Error && /\bHTTP 404\b/.test(err.message)) {
        console.log(`  (skip — no artifact at ${item.url})`);
        missing++;
        return;
      }
      throw err;
    }
  }
  ok++;

  if (item.extract === undefined) return;
  const out = resolve(extractedDir, item.extract.name);
  // Compare contents, not just presence — re-running after a version bump
  // must replace the old tree, not skip it (the build's tryPrefetchExtracted
  // would otherwise mismatch forever and never get the extracted speedup).
  if (prebuiltIsCurrent(out, item.extract.identity, item.sha256)) return;

  // Extract → hoist single top-level dir → apply rmAfterExtract → stamp.
  // Mirrors fetchPrebuilt so the resulting tree is byte-identical
  // to what a real build would produce at the same identity. Best-effort —
  // a corrupt tarball or full disk for one variant shouldn't abort the rest;
  // the build still has the by-url file to fall back on.
  const staging = `${out}.staging`;
  try {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    if (item.extract.kind === "zip") await extractZip(path, staging);
    else await extractTarGz(path, staging, 0);
    const entries = await readdir(staging);
    const hoist = entries.length === 1 ? resolve(staging, entries[0]!) : staging;
    for (const p of item.extract.rm ?? []) await rm(resolve(hoist, p), { recursive: true, force: true });
    await stampPrebuilt(hoist, item.extract.identity, item.sha256);
    await rm(out, { recursive: true, force: true });
    await rename(hoist, out);
    console.log(`  extracted → ${out}`);
  } catch (err) {
    console.log(`  (extract failed for ${item.extract.name}: ${(err as Error).message})`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// Bounded concurrency: enough to overlap GitHub CDN round-trips, not so many
// that 8× ~200MB WebKit tarballs in flight at once exhaust memory/disk.
const queue = [...items.values()];
const workers = Array.from({ length: 4 }, async () => {
  for (let item; (item = queue.shift());) await fetchOne(item);
});
await Promise.all(workers);

let bytes = 0;
for (const f of await readdir(byUrlDir)) bytes += (await stat(resolve(byUrlDir, f))).size;

console.log(
  `\nprefetch: ${ok} downloads cached (${skipped} already present, ${missing} no-artifact) — ${(bytes / 1e6).toFixed(0)} MB in ${byUrlDir}`,
);
