/**
 * Clean build artifacts. Run with --help for presets.
 *
 * Node-compatible: no Bun APIs, so this works when bootstrapping without a
 * bun binary.
 */

import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allDeps } from "./deps/index.ts";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Machine-shared cache (ccache/zig/tarballs/webkit). Matches resolveConfig()'s
// non-CI default. `clean` is a dev-machine tool so we don't branch on CI here.
const sharedCacheDir = resolve(process.env.BUN_INSTALL || resolve(homedir(), ".bun"), "build-cache");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const preset = args.find(a => !a.startsWith("-")) ?? "debug";

const log = (msg: string) => console.log(`[clean] ${msg}`);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`usage: bun run clean [preset] [--dry-run]

presets:
  debug (default)  build/debug/
  release          build/release/
  debug-local      build/debug-local/
  release-local    build/release-local/
  zig              zig caches + bun-zig*.o across all profiles, .zig-cache, zig-out
  cpp              C++ obj/ + pch/ across all profiles
  cache            machine-shared build cache (~/.bun/build-cache: ccache, zig,
                   tarballs, prebuilt webkit) — affects ALL checkouts
  deep             build/, .zig-cache, zig-out, vendor/* (except manually
                   managed deps like WebKit)

flags:
  --dry-run        list what would be removed without deleting
  -h, --help       show this help`);
  process.exit(0);
}

/** List build/<profile> dirs. Replaces the one glob pattern we needed. */
function buildProfiles(): string[] {
  const build = resolve(cwd, "build");
  if (!existsSync(build)) return [];
  return readdirSync(build, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => resolve(build, e.name));
}

const profile = (name: string) => () => [resolve(cwd, "build", name)];

// Deps whose vendor/<name>/ dir is user-managed (manual clone, not fetched
// by the build system). `deep` skips these; everything else in allDeps gets
// its vendor dir nuked.
const userManagedDeps = new Set(["WebKit"]);

const presets: Record<string, () => string[]> = {
  "debug": profile("debug"),
  "release": profile("release"),
  "debug-local": profile("debug-local"),
  "release-local": profile("release-local"),

  zig: () => [
    ...buildProfiles().flatMap(p => [
      resolve(p, "cache", "zig"),
      // Single-object (cg=1) and shard (cg>1) outputs both match.
      ...(existsSync(p) ? readdirSync(p) : []).filter(f => /^bun-zig(\.\d+)?\.o$/.test(f)).map(f => resolve(p, f)),
    ]),
    resolve(sharedCacheDir, "zig"),
    resolve(cwd, "build", "debug", "zig-check-cache"),
    resolve(cwd, ".zig-cache"),
    resolve(cwd, "zig-out"),
  ],

  cpp: () => buildProfiles().flatMap(p => [resolve(p, "obj"), resolve(p, "pch")]),

  cache: () => [sharedCacheDir],

  deep: () => [
    resolve(cwd, "build"),
    resolve(cwd, "vendor", "zig"),
    resolve(cwd, ".zig-cache"),
    resolve(cwd, "zig-out"),
    ...allDeps.filter(d => !userManagedDeps.has(d.name)).map(d => resolve(cwd, "vendor", d.name)),
  ],
};

if (!(preset in presets)) {
  console.error(`[clean] unknown preset '${preset}'. available: ${Object.keys(presets).join(", ")}`);
  process.exit(1);
}

const targets = presets[preset]!().filter(t => {
  if (existsSync(t)) return true;
  if (dryRun) log(`skip ${t} (not present)`);
  return false;
});

if (targets.length === 0) {
  log("already clean");
} else if (dryRun) {
  for (const t of targets) log(`would remove ${t}`);
  log(`${targets.length} path(s) would be removed`);
} else {
  await Promise.all(
    targets.map(async t => {
      log(`rm -rf ${t}`);
      await rm(t, { recursive: true, force: true });
    }),
  );
  log(`${targets.length} path(s) removed`);
}
