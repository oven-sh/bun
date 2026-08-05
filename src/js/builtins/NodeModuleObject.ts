// `require('node:module')._initPaths`: re-reads NODE_PATH and refreshes `Module.globalPaths`.
export function _initPaths() {
  const homeDir = process.platform === "win32" ? process.env.USERPROFILE : Bun.env.HOME;
  const nodePath = process.env.NODE_PATH;

  // Sync the current NODE_PATH into the native resolver's env snapshot.
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
