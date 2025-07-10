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
    // https://github.com/nodejs/node/blob/a9546024975d0bfb0a8ae47da323b10fb5cbb88b/lib/internal/fs/glob.js#L655
    followSymlinks: true,
    // https://github.com/oven-sh/bun/issues/20507
    onlyFiles: false,
    exclude,
  };
}

// `var` avoids TDZ checks.
var no = _ => false;

export default { glob, globSync };
