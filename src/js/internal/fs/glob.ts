import type { GlobScanOptions } from "bun";
const { validateObject, validateString, validateFunction } = require("internal/validators");

const isWindows = process.platform === "win32";

interface GlobOptions {
  /** @default process.cwd() */
  cwd?: string;
  exclude?: (ent: string) => boolean;
  /**
   * Should glob return paths as {@link Dirent} objects. `false` for strings.
   * @default false */
  withFileTypes?: boolean;
}

interface ExtendedGlobOptions extends GlobScanOptions {
  exclude(ent: string): boolean;
}

async function* glob(pattern: string | string[], options: GlobOptions): AsyncGenerator<string> {
  pattern = validatePattern(pattern);
  const globOptions = mapOptions(options);
  let it = new Bun.Glob(pattern).scan(globOptions);
  const exclude = globOptions.exclude;

  for await (const ent of it) {
    if (exclude(ent)) continue;
    yield ent;
  }
}

function* globSync(pattern: string | string[], options: GlobOptions): Generator<string> {
  pattern = validatePattern(pattern);
  const globOptions = mapOptions(options);
  const g = new Bun.Glob(pattern);
  const exclude = globOptions.exclude;
  for (const ent of g.scanSync(globOptions)) {
    if (exclude(ent)) continue;
    yield ent;
  }
}

function validatePattern(pattern: string | string[]): string {
  if ($isArray(pattern)) {
    throw new TypeError("fs.glob does not support arrays of patterns yet. Please open an issue on GitHub.");
  }
  validateString(pattern, "pattern");
  return isWindows ? pattern.replaceAll("/", "\\") : pattern;
}

function mapOptions(options: GlobOptions): ExtendedGlobOptions {
  validateObject(options, "options");

  const exclude = options.exclude ?? no;
  validateFunction(exclude, "options.exclude");

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
    exclude,
  };
}

// `var` avoids TDZ checks.
var no = _ => false;

export default { glob, globSync };
