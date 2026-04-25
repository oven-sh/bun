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
  // Dedup across patterns — two expanded brace alternatives can match the
  // same file (`{a,*}/*.txt` expands to `a/*.txt` + `*/*.txt`), and the
  // public `pattern` API also accepts an array. Skip the Set allocation when
  // there's only one pattern (the common case).
  const seen: Set<string> | null = patterns.length > 1 ? new Set() : null;

  for (const pat of patterns) {
    const { pattern: scanPattern, cwd: scanCwd, prefix } = splitLiteralPrefix(pat, globOptions.cwd as string);
    let iter: AsyncIterator<string>;
    try {
      iter = new Bun.Glob(scanPattern).scan({ ...globOptions, cwd: scanCwd })[Symbol.asyncIterator]();
    } catch (err) {
      if (isMissingPath(err)) continue;
      throw err;
    }
    while (true) {
      // Only swallow ENOENT/ENOTDIR from the scanner's own readdir/open —
      // not from user-provided `exclude` callbacks, which should propagate.
      let step: IteratorResult<string>;
      try {
        step = await iter.next();
      } catch (err) {
        if (isMissingPath(err)) break;
        throw err;
      }
      if (step.done) break;
      const full = prefix ? prefix + step.value : step.value;
      if (typeof exclude === "function") {
        if (exclude(full)) continue;
      } else if (excludeGlobs) {
        if (excludeGlobs.some(glob => glob.match(full))) {
          continue;
        }
      }
      if (seen !== null) {
        if (seen.has(full)) continue;
        seen.add(full);
      }

      yield full;
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
  const seen: Set<string> | null = patterns.length > 1 ? new Set() : null;

  for (const pat of patterns) {
    const { pattern: scanPattern, cwd: scanCwd, prefix } = splitLiteralPrefix(pat, globOptions.cwd as string);
    // `scanSync` eagerly walks, so any ENOENT/ENOTDIR from opening `scanCwd`
    // is thrown here and caught; the yield loop below never sees a scanner
    // error, which keeps user-thrown `exclude` errors propagating.
    let iter: Iterable<string>;
    try {
      iter = new Bun.Glob(scanPattern).scanSync({ ...globOptions, cwd: scanCwd });
    } catch (err) {
      if (isMissingPath(err)) continue;
      throw err;
    }
    for (const ent of iter) {
      const full = prefix ? prefix + ent : ent;
      if (typeof exclude === "function") {
        if (exclude(full)) continue;
      } else if (excludeGlobs) {
        if (excludeGlobs.some(glob => glob.match(full))) {
          continue;
        }
      }
      if (seen !== null) {
        if (seen.has(full)) continue;
        seen.add(full);
      }

      yield full;
    }
  }
}

// When a literal prefix gets folded into `cwd`, opening that cwd can fail if
// the path is missing (ENOENT), names a regular file rather than a directory
// (ENOTDIR), or traverses a symlink cycle (ELOOP — a self-referential symlink
// like `loop -> loop` in the literal prefix). All three produce empty results
// in Node; we match that by treating them as "no match".
function isMissingPath(err: unknown): boolean {
  const code = (err as any)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

/**
 * Peel the leading literal segments of `pattern` onto `cwd`. Everything from
 * the first wildcard segment onwards is returned as the remainder pattern.
 *
 * The per-segment "wildcards don't cross symlinks, literals do" rule is
 * enforced inside the walker via `descendLiteralSymlinks` (see `mapOptions`),
 * so this function exists for the remaining reasons:
 *
 *   - anchor absolute patterns at the filesystem root (or drive root on
 *     Windows) without walking through cwd first;
 *   - skip a needless readdir of the literal-prefix directory when the
 *     pattern has one, e.g. `a/b/*.ts` opens `cwd/a/b` directly;
 *   - preserve what the user wrote in output paths (absolute stays absolute,
 *     relative keeps its literal prefix) by prepending `prefix` back on each
 *     yield.
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
  // Windows drive-letter `C:\...` and UNC `\\host\share\...` shapes). A bare
  // `C:foo` (no separator after the colon) is drive-*relative*, not absolute.
  const isAbsolute =
    pattern.startsWith(separator) ||
    (isWindows && (pattern.startsWith("\\\\") || (pattern.length >= 3 && /^[a-zA-Z]:[\\/]/.test(pattern))));

  // A trailing separator turns `split` into `[..., '']` — the empty tail would
  // become our "final segment" and leave `Bun.Glob` scanning an empty pattern,
  // so drop any trailing separators before splitting. `Bun.Glob` uses a
  // trailing separator as a "directories only" filter (`a/*/`), so we keep
  // track of whether one was present and re-append it to the remainder.
  const trimmed = stripTrailingSep(pattern, separator);
  const hadTrailingSep = trimmed.length !== pattern.length;
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

  // Empty segments come from consecutive separators in the pattern
  // (`a//b/*.txt`). Node collapses those in its output and in `Minimatch`
  // pattern matching, so we strip them here too before re-assembling the
  // literal prefix — keeping only the leading empties that carry path-root
  // meaning:
  //   POSIX  `/foo/*.txt`    → `['',   'foo',   '*.txt']` keep idx 0
  //   Windows UNC `\\s\sh\…` → `['','','s','sh','*.txt']` keep idx 0 **and** 1
  //   (UNC's double leading `\\` is how Windows distinguishes network paths
  //    from a drive-rooted single-backslash path.)
  const uncLeadingEmpties = isWindows && isAbsolute && pattern.startsWith("\\\\") ? 2 : isAbsolute ? 1 : 0;
  const rawLiteralSegs = parts.slice(0, stop);
  const literalSegs: string[] = [];
  for (let i = 0; i < rawLiteralSegs.length; i++) {
    if (rawLiteralSegs[i] !== "" || i < uncLeadingEmpties) literalSegs.push(rawLiteralSegs[i]);
  }
  let remainder = parts.slice(stop).join(separator);
  if (hadTrailingSep) remainder += separator;
  // If the remainder is empty, the pattern was entirely separators (`'/'`,
  // `'//'`, `'\\\\'` etc.) — let Bun.Glob handle it directly so `fs.globSync('/')`
  // yields `['/']` the way Node does.
  if (remainder === "") {
    return { pattern, cwd, prefix: "" };
  }
  let literalPath = literalSegs.join(separator) || (isAbsolute ? separator : ".");
  // On Windows, `C:` alone means "current dir on drive C"; to scan the drive
  // root we need `C:\`. Append the separator whenever the literal prefix ends
  // in a drive letter. `pathJoin` already handles this for relative cwds, but
  // when the pattern itself is absolute we assign `literalPath` as-is.
  if (isWindows && isAbsolute && /^[a-zA-Z]:$/.test(literalPath)) {
    literalPath += separator;
  }
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
  const raw = Array.isArray(pattern)
    ? (validateArray(pattern, "pattern"),
      pattern.map(p => {
        validateString(p, "pattern");
        return p;
      }))
    : (validateString(pattern, "pattern"), [pattern]);

  // Expand brace alternatives up-front (`{a,b}/*` → `a/*`, `b/*`). This
  // matches Node's minimatch-powered semantics, and it's also what makes the
  // walker's "literals cross symlinks, wildcards don't" rule work correctly
  // for mixed braces like `{link,d*}/*.txt` — each alternative becomes its
  // own scan with its own literal-prefix classification.
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    for (const e of expandBraces(p)) {
      if (!seen.has(e)) {
        seen.add(e);
        expanded.push(e);
      }
    }
  }
  return isWindows ? expanded.map(p => p.replaceAll("/", sep)) : expanded;
}

/**
 * Expand top-level brace alternatives in a glob pattern, preserving escaped
 * braces (`\{`) and nested braces. `{a,b}/c` → `['a/c', 'b/c']`; `{a,{b,c}}` →
 * `['a', 'b', 'c']`; `\{a,b\}` → `['\\{a,b\\}']` (unchanged).
 *
 * This is a small subset of minimatch's expansion — we don't handle numeric
 * ranges (`{1..3}`). Those are rare in filesystem globs and both Bun.Glob and
 * Node's fs.glob already treat them as literal braces.
 */
function expandBraces(pattern: string): string[] {
  const open = findTopLevelBrace(pattern);
  if (open === -1) return [pattern];
  const close = findMatchingBrace(pattern, open);
  // Unbalanced `{…`: leave the `{` alone but keep walking past it so that a
  // later balanced brace group (`a{b/{link,d*}/*.txt`) still expands.
  if (close === -1) {
    return expandBraces(pattern.slice(open + 1)).map(tail => pattern.slice(0, open + 1) + tail);
  }
  const head = pattern.slice(0, open);
  const braceSrc = pattern.slice(open, close + 1);
  const suffix = pattern.slice(close + 1);
  const body = pattern.slice(open + 1, close);
  const alternatives = splitTopLevelCommas(body);
  // Single-alternative braces (`{abc}`) aren't expansion per Node/minimatch —
  // keep them literal. But still recurse into the suffix so a later
  // `{p,q}` brace group doesn't get stranded (`{abc}/{p,q}` must expand the
  // second group).
  if (alternatives.length <= 1) {
    return expandBraces(suffix).map(tail => head + braceSrc + tail);
  }
  // Hoist the tail expansion out of the inner loop — it's loop-invariant
  // (`suffix` is fixed for this frame), so `expandBraces(suffix)` would
  // otherwise be recomputed once per `(alt × sub)` pair.
  const tails = expandBraces(suffix);
  const out: string[] = [];
  for (const alt of alternatives) {
    for (const sub of expandBraces(alt)) {
      for (const tail of tails) {
        out.push(head + sub + tail);
      }
    }
  }
  return out;
}

// On Windows backslash is the path separator, not a glob escape — treating
// it as an escape here would skip the character after any `\`, so
// `a\{link,d*}\*.txt` would hide its `{` from the scanner. POSIX uses `\` as
// a glob escape, so keep the skip there.
const BACKSLASH_ESCAPES = !isWindows;

function findTopLevelBrace(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (BACKSLASH_ESCAPES && c === 92 /* \ */) {
      i++; // skip the escaped char
      continue;
    }
    if (c === 123 /* { */) return i;
  }
  return -1;
}

function findMatchingBrace(s: string, open: number): number {
  let depth = 1;
  for (let i = open + 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (BACKSLASH_ESCAPES && c === 92 /* \ */) {
      i++;
      continue;
    }
    if (c === 123 /* { */) depth++;
    else if (c === 125 /* } */) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (BACKSLASH_ESCAPES && c === 92 /* \ */) {
      i++;
      continue;
    }
    if (c === 123 /* { */) depth++;
    else if (c === 125 /* } */) depth--;
    else if (c === 44 /* , */ && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
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
    // wildcard segments; the leading literal prefix is pre-peeled into `cwd`
    // by `splitLiteralPrefix`, and `descendLiteralSymlinks` handles the
    // mid-pattern case (a literal segment *after* a wildcard may still cross
    // a symlink in GlobWalker).
    // https://github.com/oven-sh/bun/issues/29699
    followSymlinks: false,
    descendLiteralSymlinks: true,
    // https://github.com/oven-sh/bun/issues/20507
    onlyFiles: false,
    exclude,
  } as GlobScanOptions & { exclude: GlobOptions["exclude"] };
}

// `var` avoids TDZ checks.
var no = _ => false;

export default { glob, globSync };
