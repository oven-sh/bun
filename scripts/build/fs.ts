/**
 * Filesystem utilities used at configure time.
 *
 * Separate from shell.ts because "quote a shell argument" and "write a
 * file idempotently" share nothing except being utility functions.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Write `content` to `path` only if different (or file doesn't exist).
 * Returns whether a write happened.
 *
 * Used throughout the build system for configure-time generated files
 * (PCH wrapper, dep versions header, build.ninja itself). Preserving
 * mtimes on unchanged content is what makes idempotent re-configure
 * actually cheap: ninja sees no changes, does nothing. Without this,
 * every configure touches everything and ninja at minimum re-stats.
 *
 * Synchronous because configure is single-threaded and the files are
 * small. Async would add await noise for no concurrency benefit.
 */
export function writeIfChanged(path: string, content: string): boolean {
  try {
    if (readFileSync(path, "utf8") === content) return false;
  } catch {
    // File doesn't exist (or unreadable) — fall through to write.
  }
  writeFileSync(path, content);
  return true;
}

/**
 * Create multiple directories (and their parents). Deduplicates so
 * `["a/b/c", "a/b/d"]` only stats/creates `a/b` once.
 *
 * Used at configure time to pre-create all object-file parent dirs —
 * ninja doesn't mkdir, and we don't want N×mkdir syscalls for the same
 * directory when compiling N files that share a parent.
 */
export function mkdirAll(dirs: Iterable<string>): void {
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    mkdirSync(dir, { recursive: true });
    seen.add(dir);
  }
}
