import type { GlobScanOptions } from "bun";
const { validateObject, validateString, validateFunction, validateArray } = require("internal/validators");
const { join: pathJoin, sep } = require("node:path");

const isWindows = process.platform === "win32";

// Glob metacharacters — a path segment containing any of these is a wildcard
// segment. A segment with none is matched literally and can be treated as part
// of the cwd. Backslash is a glob escape on POSIX, so we flag it conservatively
// (on Windows `validatePattern` converts `/` → `sep` before we see the pattern,
// and segments are split on `sep` here, so they never contain separators).
// Written as a char-code scan to sidestep the builtin bundler's custom regex
// parser, which doesn't like `]` inside regex character classes.
function hasGlobMeta(seg: string): boolean {
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i);
    //  *       ?       [       ]       {       }       !       \
    if (c === 42 || c === 63 || c === 91 || c === 93 || c === 123 || c === 125 || c === 33 || c === 92) {
      return true;
    }
  }
  return false;
}

interface GlobOptions {
  /** @default process.cwd() */
  cwd?: string;
  exclude?: ((ent: string) => boolean) | string[];
  /**
   * Should glob return paths as {@link Dirent} objects. `false` for strings.
   * @default false */
  withFileTypes?: boolean;
}

async function* glob(pattern: string | string[], options?: GlobOptions): AsyncGenerator<string> {
  const patterns = validatePattern(pattern);
  const globOptions = mapOptions(options || {});
  const exclude = globOptions.exclude;
  const excludeGlobs = Array.isArray(exclude)
    ? exclude.flatMap(pattern => [new Bun.Glob(pattern), new Bun.Glob(pattern.replace(/\/+$/, "") + "/**")])
    : null;

  for (const pat of patterns) {
    const { pattern: scanPattern, cwd: scanCwd, prefix } = splitLiteralPrefix(pat, globOptions.cwd as string);
    let scanner: AsyncIterable<string>;
    try {
      scanner = new Bun.Glob(scanPattern).scan({ ...globOptions, cwd: scanCwd });
    } catch (err) {
      if (isMissingPath(err)) continue;
      throw err;
    }
    try {
      for await (const ent of scanner) {
        const full = prefix ? prefix + ent : ent;
        if (typeof exclude === "function") {
          if (exclude(full)) continue;
        } else if (excludeGlobs) {
          if (excludeGlobs.some(glob => glob.match(full))) {
            continue;
          }
        }

        yield full;
      }
    } catch (err) {
      if (isMissingPath(err)) continue;
      throw err;
    }
  }
}

function* globSync(pattern: string | string[], options?: GlobOptions): Generator<string> {
  const patterns = validatePattern(pattern);
  const globOptions = mapOptions(options || {});
  const exclude = globOptions.exclude;
  const excludeGlobs = Array.isArray(exclude)
    ? exclude.flatMap(pattern => [new Bun.Glob(pattern), new Bun.Glob(pattern.replace(/\/+$/, "") + "/**")])
    : null;

  for (const pat of patterns) {
    const { pattern: scanPattern, cwd: scanCwd, prefix } = splitLiteralPrefix(pat, globOptions.cwd as string);
    let iter: Iterable<string>;
    try {
      iter = new Bun.Glob(scanPattern).scanSync({ ...globOptions, cwd: scanCwd });
    } catch (err) {
      if (isMissingPath(err)) continue;
      throw err;
    }
    try {
      for (const ent of iter) {
        const full = prefix ? prefix + ent : ent;
        if (typeof exclude === "function") {
          if (exclude(full)) continue;
        } else if (excludeGlobs) {
          if (excludeGlobs.some(glob => glob.match(full))) {
            continue;
          }
        }

        yield full;
      }
    } catch (err) {
      if (isMissingPath(err)) continue;
      throw err;
    }
  }
}

// When a literal prefix gets folded into `cwd`, opening that cwd can fail if
// the path is missing (ENOENT) or names a regular file rather than a directory
// (ENOTDIR). Node and pre-PR Bun both return `[]` in these cases.
function isMissingPath(err: unknown): boolean {
  const code = (err as any)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Node's `fs.glob` follows directory symlinks only for **literal** path
 * segments (no wildcards). `Bun.Glob` has a single `followSymlinks` boolean,
 * which can't express that — so we do it here: peel off the contiguous literal
 * prefix into the cwd and pass only the wildcard portion to `Bun.Glob`, with
 * `followSymlinks: false`. The original prefix is prepended back to each yield
 * so the output paths match what the user wrote (absolute for absolute
 * patterns, relative for relative ones).
 *
 * The final path segment is never consumed — it always goes to `Bun.Glob` so
 * the native matcher drives the actual `readdir`/`match`. This keeps the
 * no-wildcard case (`foo/bar.txt`) indistinguishable from pre-fix behavior.
 */
function splitLiteralPrefix(pattern: string, cwd: string): { pattern: string; cwd: string; prefix: string } {
  const separator = isWindows ? sep : "/";
  // Absolute patterns: anchor scanning at the filesystem root and consume the
  // full leading literal run. `validatePattern` has already swapped `/` for
  // `sep` on Windows, so we test against the platform separator (and the
  // Windows drive-letter / UNC shapes `C:...` and `\\host\share\...`).
  const isAbsolute =
    pattern.startsWith(separator) || (isWindows && (/^[a-zA-Z]:/.test(pattern) || pattern.startsWith("\\\\")));

  // A trailing separator turns `split` into `[..., '']` — the empty tail would
  // become our "final segment" and leave `Bun.Glob` scanning an empty pattern,
  // so drop any trailing separators before splitting. `a/` is a match on the
  // directory `a`; Node and pre-PR Bun both treat it that way.
  const trimmed = stripTrailingSep(pattern, separator);
  const parts = trimmed.split(separator);
  // Find the first segment that contains glob metacharacters. Everything
  // strictly before it is the literal prefix; the wildcard segment and
  // everything after is the remainder pattern handed to Bun.Glob. We never
  // consume the final segment — it must go to the matcher so Bun.Glob performs
  // the actual directory read / match.
  let stop = 0;
  for (; stop < parts.length - 1; stop++) {
    if (hasGlobMeta(parts[stop])) break;
  }

  // Nothing to peel off for a relative pattern with a wildcard in segment 0.
  if (stop === 0 && !isAbsolute) {
    return { pattern, cwd, prefix: "" };
  }

  const literalSegs = parts.slice(0, stop);
  const remainder = parts.slice(stop).join(separator);
  const literalPath = literalSegs.join(separator) || (isAbsolute ? separator : ".");
  const newCwd = isAbsolute ? literalPath : pathJoin(cwd, literalPath);
  // Prefix preserves what the user wrote: absolute patterns emit absolute
  // paths, relative patterns keep their literal prefix visible (matching Node).
  const prefix = literalSegs.length === 0 ? "" : literalSegs.join(separator) + separator;
  return { pattern: remainder, cwd: newCwd, prefix };
}

function stripTrailingSep(s: string, sep: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === sep) end--;
  // Keep a leading separator (rooted path) — don't strip down to empty.
  return end === 0 ? s : s.slice(0, end);
}

function validatePattern(pattern: string | string[]): string[] {
  if (Array.isArray(pattern)) {
    validateArray(pattern, "pattern");
    return pattern.map(p => {
      validateString(p, "pattern");
      return isWindows ? p.replaceAll("/", sep) : p;
    });
  }

  validateString(pattern, "pattern");
  return [isWindows ? pattern.replaceAll("/", sep) : pattern];
}

function mapOptions(options: GlobOptions): GlobScanOptions & { exclude: GlobOptions["exclude"] } {
  validateObject(options, "options");

  let exclude = options.exclude ?? no;
  if (Array.isArray(exclude)) {
    validateArray(exclude, "options.exclude");
    if (isWindows) {
      exclude = exclude.map((pattern: string) => pattern.replaceAll("\\", "/"));
    }
  } else {
    validateFunction(exclude, "options.exclude");
  }

  if (options.withFileTypes) {
    throw new TypeError("fs.glob does not support options.withFileTypes yet. Please open an issue on GitHub.");
  }

  return {
    // NOTE: this is subtly different from Glob's default behavior.
    // `process.cwd()` may be overridden by JS code, but native code will used the
    // cached `getcwd` on BunProcess.
    cwd: options?.cwd ?? process.cwd(),
    // Node's `fs.glob` does not descend into directory symlinks through
    // wildcard segments; the literal prefix is pre-peeled into `cwd` by
    // `splitLiteralPrefix`, and everything after the first wildcard is
    // scanned without following symlinks.
    // https://github.com/oven-sh/bun/issues/29699
    followSymlinks: false,
    // https://github.com/oven-sh/bun/issues/20507
    onlyFiles: false,
    exclude,
  };
}

// `var` avoids TDZ checks.
var no = _ => false;

export default { glob, globSync };
