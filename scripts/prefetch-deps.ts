/**
 * Warm a read-only prefetch cache for the build's network downloads.
 *
 * Run at CI-image bake time from bootstrap.{sh,ps1}. Produces a directory
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

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { resolveConfig, type Config, type PartialConfig } from "./build/config.ts";
import { resolveToolchain } from "./build/configure.ts";
import { allDeps } from "./build/deps/index.ts";
import { downloadWithRetry, extractTarGz, extractZip, prefetchPathForUrl } from "./build/download.ts";
import { zigCompilerSafe, zigDownloadUrl } from "./build/zig.ts";

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
// them. WebKit prebuilt URL varies by (musl, baseline, debug|lto, asan); zig
// by host + safe. Iterate the cross-product, dedupe URLs.
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
  /** If set, also extract into `<extractedDir>/<name>/` and write `<stamp>`. */
  extract?: {
    name: string;
    stamp: string;
    value: string;
    kind: "tar.gz" | "zip";
    /** Paths (relative to extracted root) to delete before stamping — mirrors fetchPrebuilt's rmAfterExtract. */
    rm?: string[];
  };
}

const items = new Map<string, Item>();
function add(item: Item): void {
  if (!items.has(item.url)) items.set(item.url, item);
}

for (const partial of variants) {
  let cfg: Config;
  try {
    cfg = resolveConfig(partial, toolchain);
  } catch {
    continue; // e.g. asan+lto rejected — skip the combo.
  }

  for (const dep of allDeps) {
    if (dep.enabled !== undefined && !dep.enabled(cfg)) continue;
    const src = dep.source(cfg);
    if (src.kind === "github-archive") {
      add({ url: `https://github.com/${src.repo}/archive/${src.commit}.tar.gz` });
    } else if (src.kind === "prebuilt") {
      const destDir = src.destDir ?? resolve(cfg.vendorDir, dep.name);
      add({
        url: src.url,
        extract: {
          name: basename(destDir),
          stamp: ".identity",
          value: src.identity,
          kind: "tar.gz",
          rm: src.rmAfterExtract,
        },
      });
    }
  }

  // Zig — host-only download. Only the variant CI actually uses on this host
  // gets pre-EXTRACTED to extracted/zig/ (the build's dest is always
  // vendor/zig regardless of safe, so only one extracted tree can match);
  // both URLs go into by-url/ so a safe-flag flip still avoids the network.
  const ciSafe = zigCompilerSafe(cfg);
  for (const safe of [false, true]) {
    const url = zigDownloadUrl(cfg, safe);
    const stampValue = `${cfg.zigCommit}${safe ? "-safe" : ""}`;
    add({
      url,
      extract: safe === ciSafe ? { name: "zig", stamp: ".zig-commit", value: stampValue, kind: "zip" } : undefined,
    });
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
let missing = 0;

async function fetchOne(item: Item): Promise<void> {
  // Same key the build's downloadWithRetry will look up — keeps producer and
  // consumer in lockstep without duplicating the hash.
  const path = prefetchPathForUrl(item.url, dest)!;

  if (existsSync(path)) {
    skipped++;
  } else {
    try {
      await downloadWithRetry(item.url, path, basename(new URL(item.url).pathname));
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
  const stampPath = resolve(out, item.extract.stamp);
  // Compare contents, not just presence — re-running after a version bump
  // must replace the old tree, not skip it (the build's tryPrefetchExtracted
  // would otherwise mismatch forever and never get the extracted speedup).
  if (existsSync(stampPath) && readFileSync(stampPath, "utf8").trim() === item.extract.value) return;

  // Extract → hoist single top-level dir → apply rmAfterExtract → stamp.
  // Mirrors fetchPrebuilt/fetchZig so the resulting tree is byte-identical
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
    await writeFile(resolve(hoist, item.extract.stamp), item.extract.value + "\n");
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
  for (let item; (item = queue.shift()); ) await fetchOne(item);
});
await Promise.all(workers);

let bytes = 0;
for (const f of await readdir(byUrlDir)) bytes += (await stat(resolve(byUrlDir, f))).size;

console.log(
  `\nprefetch: ${ok} downloads cached (${skipped} already present, ${missing} no-artifact) — ${(bytes / 1e6).toFixed(0)} MB in ${byUrlDir}`,
);
