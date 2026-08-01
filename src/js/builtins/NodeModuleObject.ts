// Implementation for `require('node:module')._initPaths`. Re-reads
// `process.env.NODE_PATH`, pushes it to the native resolver's env map, and
// refreshes `Module.globalPaths`.
export function _initPaths() {
  const homeDir = process.platform === "win32" ? process.env.USERPROFILE : Bun.env.HOME;
  const nodePath = process.env.NODE_PATH;

  // The native resolver reads NODE_PATH from its own env snapshot, so sync the
  // current process.env value into it. This is what makes runtime-set NODE_PATH
  // take effect for subsequent require() calls.
  $newCppFunction("NodeModuleModule.cpp", "jsFunctionSetNodePathForRequire", 1)(nodePath);

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
