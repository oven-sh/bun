// Implementation for `require('node:module').findPackageJSON`.
// Given a specifier and an optional base URL/path, walk up the directory tree
// to find the nearest package.json. For bare specifiers, resolve the package
// first, then return its root package.json.
export function findPackageJSON(specifier: string | URL, base?: string | URL) {
  const path = require("node:path");
  const fs = require("node:fs");
  const { fileURLToPath } = require("node:url");

  if (typeof specifier !== "string") {
    if (specifier instanceof URL) {
      specifier = specifier.href;
    } else {
      throw $ERR_INVALID_ARG_TYPE("specifier", ["string", "URL"], specifier);
    }
  }

  // Convert base from URL to string if needed
  if (base !== undefined) {
    if (base instanceof URL) {
      base = base.href;
    } else if (typeof base !== "string") {
      throw $ERR_INVALID_ARG_TYPE("base", ["string", "URL"], base);
    }
  }

  // Convert file:// URLs to paths
  if (typeof specifier === "string" && specifier.startsWith("file://")) {
    specifier = fileURLToPath(specifier);
  }
  if (typeof base === "string" && base.startsWith("file://")) {
    base = fileURLToPath(base);
  }

  // Determine if this is a bare specifier (package name)
  const isBare =
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("\\") &&
    !(process.platform === "win32" && specifier.length >= 2 && specifier[1] === ":");

  if (isBare) {
    // For bare specifiers, resolve the package then find its root package.json
    if (base === undefined) {
      throw $ERR_INVALID_ARG_VALUE("specifier", specifier, "base is required for bare specifiers");
    }
    try {
      const resolved = $resolveSync(specifier + "/package.json", base, false, false, undefined);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // package.json subpath may not be exported, try resolving the package itself
    }
    try {
      const resolved = $resolveSync(specifier, base, false, false, undefined);
      // Walk up from the resolved path to find package.json
      let dir = path.dirname(resolved);
      while (true) {
        const candidate = path.join(dir, "package.json");
        if (fs.existsSync(candidate)) {
          return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
      }
    } catch {
      return undefined;
    }
  }

  // For relative specifiers, resolve against base
  let startDir: string;
  if (specifier.startsWith(".")) {
    if (base === undefined) {
      throw $ERR_INVALID_ARG_VALUE("specifier", specifier, "base is required for relative specifiers");
    }
    const baseDir = path.dirname(base);
    startDir = path.resolve(baseDir, specifier);
  } else {
    // Absolute specifier
    startDir = specifier;
  }

  // If startDir points to a file, start from its directory
  try {
    if (fs.statSync(startDir).isFile()) {
      startDir = path.dirname(startDir);
    }
  } catch {
    // Path doesn't exist as a file, treat as directory
  }

  // Walk up directory tree looking for package.json
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// Implementation for `require('node:module')._initPaths`. Exists only as a
// compatibility stub. Calling this does not affect the actual CommonJS loader.
export function _initPaths() {
  const homeDir = process.platform === "win32" ? process.env.USERPROFILE : Bun.env.HOME;
  const nodePath = process.platform === "win32" ? process.env.NODE_PATH : Bun.env.NODE_PATH;

  // process.execPath is $PREFIX/bin/node except on Windows where it is
  // $PREFIX\node.exe where $PREFIX is the root of the Node.js installation.
  const path = require("node:path");
  const prefixDir =
    process.platform === "win32" ? path.resolve(process.execPath, "..") : path.resolve(process.execPath, "..", "..");

  const paths = [path.resolve(prefixDir, "lib", "node")];

  if (homeDir) {
    paths.unshift(path.resolve(homeDir, ".node_libraries"));
    paths.unshift(path.resolve(homeDir, ".node_modules"));
  }

  if (nodePath) {
    paths.unshift(...nodePath.split(path.delimiter).filter(Boolean));
  }

  const M = require("node:module");
  M.globalPaths = paths;
}
