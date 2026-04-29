import type { GlobScanOptions } from "bun";
const { validateObject, validateString, validateFunction, validateArray, validateBoolean } = require("internal/validators");
const { basename, dirname, join, sep } = require("node:path");

const isWindows = process.platform === "win32";

// S_IFMT mask and type constants for extracting file type from stat mode
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const S_IFIFO = 0o010000;
const S_IFSOCK = 0o140000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;

function modeToDirentType(mode: number): number {
  switch (mode & S_IFMT) {
    case S_IFREG:
      return 1; // UV_DIRENT_FILE
    case S_IFDIR:
      return 2; // UV_DIRENT_DIR
    case S_IFLNK:
      return 3; // UV_DIRENT_LINK
    case S_IFIFO:
      return 4; // UV_DIRENT_FIFO
    case S_IFSOCK:
      return 5; // UV_DIRENT_SOCKET
    case S_IFCHR:
      return 6; // UV_DIRENT_CHAR
    case S_IFBLK:
      return 7; // UV_DIRENT_BLOCK
    default:
      return 0; // UV_DIRENT_UNKNOWN
  }
}

// Lazily loaded to avoid circular dependency: internal/fs/glob -> node:fs -> node:fs/promises -> internal/fs/glob
var _lstatSync: typeof import("node:fs").lstatSync | undefined;
var _lstat: typeof import("node:fs").lstat | undefined;
var _Dirent: typeof import("node:fs").Dirent | undefined;

function lazyFs() {
  if (!_lstatSync) {
    const fs = require("node:fs");
    _lstatSync = fs.lstatSync;
    _lstat = fs.lstat;
    _Dirent = fs.Dirent;
  }
}

function pathToDirentSync(ent: string, cwd: string) {
  lazyFs();
  const entPath = join(cwd, ent);
  const name = basename(entPath);
  const parentPath = dirname(entPath);
  try {
    const type = modeToDirentType(_lstatSync!(entPath).mode);
    return new _Dirent!(name, type, parentPath);
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function pathToDirentAsync(ent: string, cwd: string): Promise<import("node:fs").Dirent | null> {
  lazyFs();
  const entPath = join(cwd, ent);
  const name = basename(entPath);
  const parentPath = dirname(entPath);
  return new Promise((res, reject) => {
    _lstat!(entPath, (err, stats) => {
      if (err) {
        if (err.code === "ENOENT") return res(null);
        return reject(err);
      }
      res(new _Dirent!(name, modeToDirentType(stats!.mode), parentPath));
    });
  });
}

interface GlobOptions {
  /** @default process.cwd() */
  cwd?: string;
  exclude?: ((ent: string | import("node:fs").Dirent) => boolean) | string[];
  /**
   * Should glob return paths as {@link Dirent} objects. `false` for strings.
   * @default false */
  withFileTypes?: boolean;
}

async function* glob(pattern: string | string[], options?: GlobOptions): AsyncGenerator<string | import("node:fs").Dirent> {
  const patterns = validatePattern(pattern);
  const globOptions = mapOptions(options || {});
  const exclude = globOptions.exclude;
  const withFileTypes = globOptions.withFileTypes;
  const cwd = globOptions.cwd!;
  const excludeGlobs = Array.isArray(exclude)
    ? exclude.flatMap(pattern => [new Bun.Glob(pattern), new Bun.Glob(pattern.replace(/\/+$/, "") + "/**")])
    : null;

  for (const pat of patterns) {
    for await (const ent of new Bun.Glob(pat).scan(globOptions)) {
      if (excludeGlobs) {
        if (excludeGlobs.some(glob => glob.match(ent))) {
          continue;
        }
      }

      if (withFileTypes) {
        const dirent = await pathToDirentAsync(ent, cwd);
        if (dirent === null) continue;
        if (typeof exclude === "function" && exclude(dirent)) continue;
        yield dirent;
      } else {
        if (typeof exclude === "function" && exclude(ent)) continue;
        yield ent;
      }
    }
  }
}

function* globSync(pattern: string | string[], options?: GlobOptions): Generator<string | import("node:fs").Dirent> {
  const patterns = validatePattern(pattern);
  const globOptions = mapOptions(options || {});
  const exclude = globOptions.exclude;
  const withFileTypes = globOptions.withFileTypes;
  const cwd = globOptions.cwd!;
  const excludeGlobs = Array.isArray(exclude)
    ? exclude.flatMap(pattern => [new Bun.Glob(pattern), new Bun.Glob(pattern.replace(/\/+$/, "") + "/**")])
    : null;

  for (const pat of patterns) {
    for (const ent of new Bun.Glob(pat).scanSync(globOptions)) {
      if (excludeGlobs) {
        if (excludeGlobs.some(glob => glob.match(ent))) {
          continue;
        }
      }

      if (withFileTypes) {
        const dirent = pathToDirentSync(ent, cwd);
        if (dirent === null) continue;
        if (typeof exclude === "function" && exclude(dirent)) continue;
        yield dirent;
      } else {
        if (typeof exclude === "function" && exclude(ent)) continue;
        yield ent;
      }
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

function mapOptions(options: GlobOptions): GlobScanOptions & { exclude: GlobOptions["exclude"]; withFileTypes: boolean } {
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

  const withFileTypes = options.withFileTypes;
  if (withFileTypes !== undefined) {
    validateBoolean(withFileTypes, "options.withFileTypes");
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
    withFileTypes: withFileTypes ?? false,
  };
}

// `var` avoids TDZ checks.
var no = _ => false;

export default { glob, globSync };
