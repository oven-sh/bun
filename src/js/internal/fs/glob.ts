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

async function* glob(pattern: string | string[], options?: GlobOptions): AsyncGenerator<string> {
  const patterns = validatePattern(pattern);
  const globOptions = mapOptions(options || {});
  const exclude = globOptions.exclude;
  const excludeGlobs = Array.isArray(exclude)
    ? exclude.flatMap(pattern => [new Bun.Glob(pattern), new Bun.Glob(pattern.replace(/\/+$/, "") + "/**")])
    : null;

  for (const pat of patterns) {
    for await (const ent of new Bun.Glob(pat).scan(globOptions)) {
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
    for (const ent of new Bun.Glob(pat).scanSync(globOptions)) {
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

// `descendLiteralSymlinks` / `swallowMissingCwd` are internal `Bun.Glob`
// scan options (see `src/bun.js/api/glob.zig`) that the `node:fs.glob`
// layer uses to pick up Node-compatible semantics. They aren't part of
// the public `GlobScanOptions` type; widen the return type locally so
// the object literal below typechecks without exposing the knobs.
function mapOptions(
  options: GlobOptions,
): GlobScanOptions & {
  exclude: GlobOptions["exclude"];
  descendLiteralSymlinks: boolean;
  swallowMissingCwd: boolean;
} {
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
    // Node's `fs.glob` returns `[]` rather than throwing when the cwd is
    // missing, is a regular file, or hits a symlink cycle — let the walker
    // handle that natively.
    swallowMissingCwd: true,
    // https://github.com/oven-sh/bun/issues/20507
    onlyFiles: false,
    exclude,
  };
}

// `var` avoids TDZ checks.
var no = _ => false;

export default { glob, globSync };
