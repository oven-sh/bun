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
