// Implementation for `require('node:module')._initPaths`.
export function _initPaths() {
  const homeDir: string | undefined = process.platform === "win32" ? process.env.USERPROFILE : Bun.env.HOME;
  const nodePath: string | undefined = process.platform === "win32" ? process.env.NODE_PATH : Bun.env.NODE_PATH;

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

  const nodePaths = nodePath ? nodePath.split(path.delimiter).filter(Boolean) : [];
  // CommonJS searches these from now on. The folders of `$HOME` and `$PREFIX` are listed, not searched.
  $bindgen("NodeModuleModule.bind.ts", "setGlobalFolders")(nodePaths);
  paths.unshift(...nodePaths);

  const M = require("node:module");
  M.globalPaths = paths;
}
