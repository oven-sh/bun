function resolve(request, args) {
  if (typeof args === "object" && args?.paths?.length) {
    return this.resolveSync(request, args);
  }

  return this.resolveSync(request);
}

// not implemented
resolve.paths = () => [];

function require(pathString) {
  // this refers to an ImportMeta instance
  const resolved = this.resolveSync(pathString);
  if (
    !resolved.endsWith(".node") &&
    !resolved.endsWith(".json") &&
    !resolved.endsWith(".toml")
  ) {
    throw new Error(
      "Dynamic require() in Bun.js currently only supports .node, .json, and .toml files.\n\tConsider using ESM import() instead."
    );
  }

  return this.require(resolved);
}

const main = {
  get() {
    return Bun.main;
  },
  set() {
    return false;
  },
  configurable: false,
};

export function createRequire(filename) {
  var filenameString = filename;
  const isURL =
    typeof filename === "object" && filename && filename instanceof URL;
  if (isURL) {
    filenameString = filename.pathname;
  }

  var lastSlash = filenameString.lastIndexOf(
    // TODO: WINDOWS
    // windows is more complicated here
    // but we don't support windows yet
    process.platform !== "win32" ? "/" : "\\"
  );
  var customImportMeta = {
    ...import.meta,
    path: filenameString,
    file:
      lastSlash > -1 ? filenameString.substring(lastSlash + 1) : filenameString,
    dir: lastSlash > -1 ? filenameString.substring(0, lastSlash) : "",
  };

  if (isURL) {
    customImportMeta.url = filename;
  } else {
    // lazy because URL is slow and also can throw
    Object.defineProperty(customImportMeta, "url", {
      get() {
        const value = new URL("file://" + customImportMeta.path).href;
        Object.defineProperty(customImportMeta, "url", {
          value,
        });
        return value;
      },
      configurable: true,
    });
  }

  var bound = require.bind(customImportMeta);
  bound.resolve = resolve.bind(customImportMeta);

  // do this one lazily
  Object.defineProperty(bound, "main", main);

  return bound;
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
