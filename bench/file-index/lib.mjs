// Shared helpers for the Bun.FileIndex benchmarks.
//
// Every benchmark builds its tree deterministically (seeded PRNG) so the
// numbers are comparable across runs and machines. Nothing here is timed.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

export const hasFileIndex = typeof Bun !== "undefined" && typeof Bun.FileIndex === "function";

/** Deterministic 32-bit LCG → float in [0, 1). */
export function rng(seed = 0x5f1de) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
}

const DIR_WORDS = [
  "src",
  "lib",
  "core",
  "util",
  "internal",
  "api",
  "server",
  "client",
  "components",
  "hooks",
  "models",
  "controllers",
  "views",
  "routes",
  "services",
  "test",
  "vendor",
  "pkg",
  "tools",
  "scripts",
  "assets",
  "styles",
  "types",
  "parser",
  "runtime",
];
const FILE_WORDS = [
  "index",
  "main",
  "app",
  "config",
  "helpers",
  "constants",
  "logger",
  "router",
  "store",
  "schema",
  "client",
  "server",
  "worker",
  "stream",
  "buffer",
  "socket",
  "parser",
  "lexer",
  "printer",
  "resolver",
  "loader",
  "watcher",
  "cache",
  "queue",
];
const EXTS = ["ts", "tsx", "js", "jsx", "json", "css", "md", "txt"];

/**
 * `count` deterministic `/`-separated relative file paths, depth 1-4, no
 * duplicates, no dotfiles. The same (count, seed) always yields the same list.
 */
export function syntheticPaths(count, seed = 1) {
  const rand = rng(seed);
  const pick = list => list[(rand() * list.length) | 0];
  const out = new Array(count);
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    let rel;
    do {
      const depth = 1 + ((rand() * 4) | 0);
      const parts = [];
      for (let d = 1; d < depth; d++) parts.push(`${pick(DIR_WORDS)}${(rand() * 12) | 0}`);
      parts.push(`${pick(FILE_WORDS)}_${i}.${pick(EXTS)}`);
      rel = parts.join("/");
    } while (seen.has(rel));
    seen.add(rel);
    out[i] = rel;
  }
  return out;
}

/** Every implied directory of `paths` (relative, `/`-separated), deduplicated. */
export function impliedDirs(paths) {
  const dirs = new Set();
  for (const rel of paths) {
    let i = rel.indexOf("/");
    while (i !== -1) {
      dirs.add(rel.slice(0, i));
      i = rel.indexOf("/", i + 1);
    }
  }
  return [...dirs];
}

/** A fresh temp directory; call the returned `cleanup` when done. */
export function tempRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  process.on("exit", cleanup);
  return { root, cleanup };
}

/**
 * Materialize `paths` under `root`. `contents` is a string or `(rel) => string`.
 * Returns the number of files written.
 */
export function writeTree(root, paths, contents = "") {
  const made = new Set();
  for (const rel of paths) {
    const slash = rel.lastIndexOf("/");
    if (slash !== -1) {
      const dir = rel.slice(0, slash);
      if (!made.has(dir)) {
        mkdirSync(join(root, ...dir.split("/")), { recursive: true });
        let i = dir.indexOf("/");
        made.add(dir);
        while (i !== -1) {
          made.add(dir.slice(0, i));
          i = dir.indexOf("/", i + 1);
        }
      }
    }
    writeFileSync(join(root, ...rel.split("/")), typeof contents === "function" ? contents(rel) : contents);
  }
  return paths.length;
}

/** True if `cmd` is runnable (`cmd --version` exits 0). */
export function hasBinary(cmd) {
  try {
    return spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/** Normalize a path list from an external tool to sorted, `/`-separated. */
export function normalizePaths(list) {
  return list
    .filter(Boolean)
    .map(p => (sep === "\\" ? p.replaceAll("\\", "/") : p))
    .sort();
}

/** Throws unless `actual === expected`; benchmarks call this before timing. */
export function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`correctness check failed: ${what}: expected ${expected}, got ${actual}`);
  }
}
