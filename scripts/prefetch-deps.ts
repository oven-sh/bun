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
 * No download depends on the target: the build image compiles for all of them, so this takes every dep's sources,
 * also those of a dep that the host's own target leaves out.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { resolveConfig } from "./build/config.ts";
import { resolveToolchain } from "./build/configure.ts";
import { ICU_URL } from "./build/deps/icu.ts";
import { allDeps } from "./build/deps/index.ts";
import { downloadWithRetry, extractTarGz, extractZip, prefetchPathForUrl } from "./build/download.ts";
import { depSource } from "./build/source.ts";
import { ensureWebKitSource } from "./build/webkit-source.ts";

const dest = process.argv[2];
if (dest === undefined) {
  process.stderr.write("Usage: bun scripts/prefetch-deps.ts <prefetchDir>\n");
  process.exit(1);
}
const byUrlDir = resolve(dest, "by-url");
const extractedDir = resolve(dest, "extracted");

const cfg = resolveConfig({ buildType: "Release", ci: true }, resolveToolchain());

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

// The tree as configure puts it in the cache, where cachedTreeDir() looks for it by the directory's name.
await ensureWebKitSource({ ...cfg, localDeps: { WebKit: resolve(extractedDir, basename(cfg.localDeps.WebKit!)) } });

const items: Item[] = [{ url: ICU_URL }];
for (const dep of allDeps) {
  // WebKit and ICU, above, come out as `local`.
  const src = depSource(cfg, dep);
  if (src.kind === "github-archive") {
    items.push({ url: `https://github.com/${src.repo}/archive/${src.commit}.tar.gz` });
  } else if (src.kind === "prebuilt") {
    const destDir = src.destDir ?? resolve(cfg.vendorDir, dep.name);
    items.push({
      url: src.url,
      extract: {
        name: basename(destDir),
        stamp: ".identity",
        value: src.identity,
        kind: "tar.gz",
        ...(src.rmAfterExtract !== undefined && { rm: src.rmAfterExtract }),
      },
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

async function fetchOne(item: Item): Promise<void> {
  // Same key the build's downloadWithRetry will look up — keeps producer and
  // consumer in lockstep without duplicating the hash.
  const path = prefetchPathForUrl(item.url, dest)!;

  if (existsSync(path)) {
    skipped++;
  } else {
    await downloadWithRetry(item.url, path, basename(new URL(item.url).pathname));
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
  // Mirrors fetchPrebuilt so the resulting tree is byte-identical
  // to what a real build would produce at the same identity. Best-effort:
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

// Bounded concurrency: enough to overlap GitHub CDN round-trips.
const queue = [...items];
const workers = Array.from({ length: 4 }, async () => {
  for (let item; (item = queue.shift());) await fetchOne(item);
});
await Promise.all(workers);

let bytes = 0;
for (const f of await readdir(byUrlDir)) bytes += (await stat(resolve(byUrlDir, f))).size;

console.log(
  `\nprefetch: ${ok} downloads cached (${skipped} already present) — ${(bytes / 1e6).toFixed(0)} MB in ${byUrlDir}`,
);
