var fileURLToPath;

var pathsFunction = function paths() {
  return [];
};

export function createRequire(filename) {
  var filenameString = filename;
  const isURL =
    typeof filename === "object" && filename && filename instanceof URL;

  if (isURL) {
    fileURLToPath ||= globalThis[Symbol.for("Bun.lazy")]("fileURLToPath");
    filenameString = fileURLToPath(filename);
  }

  var pathObject = {
    path: filenameString,
    resolveSync,
  };
  var bunResolveSync = import.meta.resolveSync;
  var realRequire = import.meta.require;

  function resolveSync(id) {
    return arguments.length <= 1
      ? bunResolveSync.call(pathObject, id)
      : bunResolveSync.call(pathObject, id, arguments[1]);
  }

  var requireFunction = function require(id) {
    return realRequire.call(
      pathObject,
      bunResolveSync.call(pathObject, id, filenameString)
    );
  };

  requireFunction.resolve = function resolve(id, pathsArg) {
    if (arguments.length > 1 && pathsArg && typeof pathsArg === "object") {
      var { paths } = pathsArg;
      if (paths && Array.isArray(paths) && paths.length > 0) {
        return bunResolveSync.call(pathObject, id, paths[0]);
      }
    }

    return bunResolveSync.call(pathObject, id);
  };
  requireFunction.resolve.paths = pathsFunction;
  requireFunction.main = undefined;

  return requireFunction;
}

// this isn't exhaustive
export const builtinModules = ["node:path", "node:fs", "bun:ffi", "bun:sqlite"];

// noop
export function syncBuiltinESMExports() {}

export function findSourceMap(path) {
  throw new Error("findSourceMap is not implemented");
}

export function SourceMap() {
  throw new Error("SourceMap is not implemented");
}

export default {
  createRequire,
  syncBuiltinESMExports,
  findSourceMap,
  SourceMap,
};
