import type { GlobScanOptions } from "bun";
const { validateObject, validateString, validateFunction, validateArray } = require("internal/validators");
const { sep } = require("node:path");

const isWindows = process.platform === "win32";

interface GlobOptions {
  /** @default process.cwd() */
  cwd?: string;
  exclude?: ((ent: string) => boolean) | string[];
  /**
   * Should glob return paths as {@link Dirent} objects. `false` for strings.
   * @default false */
  withFileTypes?: boolean;
}

// When `fs.glob`'s cwd is missing, names a file, or traverses a symlink
// cycle, Node returns an empty match set rather than throwing. `Bun.Glob`
// throws. Catch only those three codes here and swallow them — anything
// else (including errors from a user-provided `exclude` callback) must
// propagate.
function isMissingPath(err: unknown): boolean {
  const code = (err as any)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

async function* glob(pattern: string | string[], options?: GlobOptions): AsyncGenerator<string> {
  const patterns = validatePattern(pattern);
  const globOptions = mapOptions(options || {});
  const exclude = globOptions.exclude;
  const excludeGlobs = Array.isArray(exclude)
    ? exclude.flatMap(pattern => [new Bun.Glob(pattern), new Bun.Glob(pattern.replace(/\/+$/, "") + "/**")])
    : null;

  for (const pat of patterns) {
    let iter: AsyncIterator<string>;
    try {
      iter = new Bun.Glob(pat).scan(globOptions)[Symbol.asyncIterator]();
    } catch (err) {
      if (isMissingPath(err)) continue;
      throw err;
    }
    // Narrow the try/catch to the scanner — `exclude()` below throwing
    // must propagate, it shouldn't be mistaken for a scanner ENOENT.
    while (true) {
      let step: IteratorResult<string>;
      try {
        step = await iter.next();
      } catch (err) {
        if (isMissingPath(err)) break;
        throw err;
      }
      if (step.done) break;
      const ent = step.value;
      if (typeof exclude === "function") {
        if (exclude(ent)) continue;
      } else if (excludeGlobs) {
        if (excludeGlobs.some(glob => glob.match(ent))) {
          continue;
        }
      }

      yield ent;
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
    // `scanSync` walks eagerly, so any ENOENT/ENOTDIR/ELOOP from opening
    // cwd lands here and is caught; the iteration loop below only sees
    // user-thrown errors from `exclude`, which should propagate.
    let iter: Iterable<string>;
    try {
      iter = new Bun.Glob(pat).scanSync(globOptions);
    } catch (err) {
      if (isMissingPath(err)) continue;
      throw err;
    }
    for (const ent of iter) {
      if (typeof exclude === "function") {
        if (exclude(ent)) continue;
      } else if (excludeGlobs) {
        if (excludeGlobs.some(glob => glob.match(ent))) {
          continue;
        }
      }

      yield ent;
    }
  }
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

// `descendLiteralSymlinks` is an internal `Bun.Glob` scan option (see
// `src/bun.js/api/glob.zig`) — not part of the public `GlobScanOptions`
// type, only consumed by `node:fs.glob`. Widen the return type locally so
// the object literal below typechecks without exposing the knob publicly.
function mapOptions(
  options: GlobOptions,
): GlobScanOptions & { exclude: GlobOptions["exclude"]; descendLiteralSymlinks: boolean } {
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
    // Node's `fs.glob` does not follow directory symlinks under wildcards
    // (it would infinite-loop on pnpm-style symlink cycles). The walker
    // still descends through *literal* path segments that name a symlink,
    // so e.g. `link/*.txt` with `link` a symlinked directory keeps working.
    followSymlinks: false,
    descendLiteralSymlinks: true,
    // https://github.com/oven-sh/bun/issues/20507
    onlyFiles: false,
    exclude,
  };
}

// `var` avoids TDZ checks.
var no = _ => false;

export default { glob, globSync };
