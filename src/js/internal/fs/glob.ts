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

async function* glob(pattern: string | string[], options?: GlobOptions): AsyncGenerator<string | any> {
  const patterns = validatePattern(pattern);
  const globOptions = mapOptions(options || {});
  const exclude = globOptions.exclude;
  const withFileTypes = options?.withFileTypes || false;
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

      if (withFileTypes) {
        yield createDirent(ent, globOptions.cwd);
      } else {
        yield ent;
      }
    }
  }
}

function* globSync(pattern: string | string[], options?: GlobOptions): Generator<string | any> {
  const patterns = validatePattern(pattern);
  const globOptions = mapOptions(options || {});
  const exclude = globOptions.exclude;
  const withFileTypes = options?.withFileTypes || false;
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

      if (withFileTypes) {
        yield createDirent(ent, globOptions.cwd);
      } else {
        yield ent;
      }
    }
  }
}

function createDirent(path: string, cwd?: string): any {
  const { basename, dirname, resolve, join } = require("node:path");
  const { lstatSync } = require("node:fs");

  try {
    // Construct the full path if cwd is provided
    const fullPath = cwd ? join(cwd, path) : path;

    // Use lstatSync to get file info without following symlinks
    const stats = lstatSync(fullPath);
    const name = basename(path);
    // The parent path should be the directory containing the matched file
    const parentPath = cwd ? resolve(cwd, dirname(path)) : resolve(dirname(path));

    // Get the file type number that matches DirEntType enum from the C++ code
    let type: number;
    if (stats.isFile()) {
      type = 1; // File
    } else if (stats.isDirectory()) {
      type = 2; // Directory
    } else if (stats.isSymbolicLink()) {
      type = 3; // SymLink
    } else if (stats.isFIFO()) {
      type = 4; // NamedPipe
    } else if (stats.isSocket()) {
      type = 5; // UnixDomainSocket
    } else if (stats.isCharacterDevice()) {
      type = 6; // CharacterDevice
    } else if (stats.isBlockDevice()) {
      type = 7; // BlockDevice
    } else {
      type = 0; // Unknown
    }

    // Create a Dirent-like object compatible with Node.js Dirent
    return {
      name,
      parentPath,
      path: parentPath,
      isFile() {
        return type === 1;
      },
      isDirectory() {
        return type === 2;
      },
      isSymbolicLink() {
        return type === 3;
      },
      isBlockDevice() {
        return type === 7;
      },
      isCharacterDevice() {
        return type === 6;
      },
      isFIFO() {
        return type === 4;
      },
      isSocket() {
        return type === 5;
      },
    };
  } catch (err) {
    // If stat fails (e.g., broken symlink), create a Dirent with unknown type
    const name = basename(path);
    const parentPath = cwd ? resolve(cwd, dirname(path)) : resolve(dirname(path));
    return {
      name,
      parentPath,
      path: parentPath,
      isFile() {
        return false;
      },
      isDirectory() {
        return false;
      },
      isSymbolicLink() {
        return false;
      },
      isBlockDevice() {
        return false;
      },
      isCharacterDevice() {
        return false;
      },
      isFIFO() {
        return false;
      },
      isSocket() {
        return false;
      },
    };
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

  // withFileTypes is now supported

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
