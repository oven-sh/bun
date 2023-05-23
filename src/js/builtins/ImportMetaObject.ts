type ImportMetaObject = Partial<ImportMeta>;

export function loadCJS2ESM(this: ImportMetaObject, resolvedSpecifier: string) {
  var loader = Loader;
  var queue = $createFIFO();
  var key = resolvedSpecifier;
  while (key) {
    // we need to explicitly check because state could be $ModuleFetch
    // it will throw this error if we do not:
    //    $throwTypeError("Requested module is already fetched.");
    var entry = loader.registry.$get(key);

    if (!entry || !entry.state || entry.state <= $ModuleFetch) {
      $fulfillModuleSync(key);
      entry = loader.registry.$get(key)!;
    }

    // entry.fetch is a Promise<SourceCode>
    // SourceCode is not a string, it's a JSC::SourceCode object
    // this pulls it out of the promise without delaying by a tick
    // the promise is already fullfilled by $fullfillModuleSync
    var sourceCodeObject = $getPromiseInternalField(entry.fetch, $promiseFieldReactionsOrResult);
    // parseModule() returns a Promise, but the value is already fulfilled
    // so we just pull it out of the promise here once again
    // But, this time we do it a little more carefully because this is a JSC function call and not bun source code
    var moduleRecordPromise = loader.parseModule(key, sourceCodeObject);
    var module = entry.module;
    if (!module && moduleRecordPromise && $isPromise(moduleRecordPromise)) {
      var reactionsOrResult = $getPromiseInternalField(moduleRecordPromise, $promiseFieldReactionsOrResult);
      var flags = $getPromiseInternalField(moduleRecordPromise, $promiseFieldFlags);
      var state = flags & $promiseStateMask;
      // this branch should never happen, but just to be safe
      if (state === $promiseStatePending || (reactionsOrResult && $isPromise(reactionsOrResult))) {
        throw new TypeError(`require() async module "${key}" is unsupported`);
      } else if (state === $promiseStateRejected) {
        // TODO: use SyntaxError but preserve the specifier
        throw new TypeError(`${reactionsOrResult?.message ?? "An error occurred"} while parsing module \"${key}\"`);
      }
      entry.module = module = reactionsOrResult;
    } else if (moduleRecordPromise && !module) {
      entry.module = module = moduleRecordPromise as LoaderModule;
    }

    // This is very similar to "requestInstantiate" in ModuleLoader.js in JavaScriptCore.
    $setStateToMax(entry, $ModuleLink);
    var dependenciesMap = module.dependenciesMap;
    var requestedModules = loader.requestedModules(module);
    var dependencies = $newArrayWithSize<string>(requestedModules.length);
    for (var i = 0, length = requestedModules.length; i < length; ++i) {
      var depName = requestedModules[i];
      // optimization: if it starts with a slash then it's an absolute path
      // we don't need to run the resolver a 2nd time
      var depKey = depName[0] === "/" ? depName : loader.resolve(depName, key);
      var depEntry = loader.ensureRegistered(depKey);
      if (depEntry.state < $ModuleLink) {
        queue.push(depKey);
      }

      $putByValDirect(dependencies, i, depEntry);
      dependenciesMap.$set(depName, depEntry);
    }

    entry.dependencies = dependencies;
    // All dependencies resolved, set instantiate and satisfy field directly.
    entry.instantiate = Promise.resolve(entry);
    entry.satisfy = Promise.resolve(entry);
    key = queue.shift();
    while (key && (loader.registry.$get(key)?.state ?? $ModuleFetch) >= $ModuleLink) {
      key = queue.shift();
    }
  }

  var linkAndEvaluateResult = loader.linkAndEvaluateModule(resolvedSpecifier, undefined);
  if (linkAndEvaluateResult && $isPromise(linkAndEvaluateResult)) {
    // if you use top-level await, or any dependencies use top-level await, then we throw here
    // this means the module will still actually load eventually, but that's okay.
    throw new TypeError(`require() async module \"${resolvedSpecifier}\" is unsupported`);
  }

  return loader.registry.$get(resolvedSpecifier);
}

export function requireESM(this: ImportMetaObject, resolved) {
  var entry = Loader.registry.$get(resolved);

  if (!entry || !entry.evaluated) {
    entry = $loadCJS2ESM(resolved);
  }

  if (!entry || !entry.evaluated || !entry.module) {
    throw new TypeError(`require() failed to evaluate module "${resolved}". This is an internal consistentency error.`);
  }
  var exports = Loader.getModuleNamespaceObject(entry.module);
  if (exports[$commonJSSymbol] === 0) {
    // CommonJS module created via `Bun::CommonJSModuleRecord`
    // We will refer to the requireMap to get the exports
    return;
  }

  var commonJS = exports.default;
  var cjs = commonJS?.[$commonJSSymbol];
  if (cjs === 0) {
    return commonJS;
  } else if (cjs && $isCallable(commonJS)) {
    return commonJS();
  }

  return exports;
}

export function internalRequire(this: ImportMetaObject, resolved) {
  var cached = $requireMap.$get(resolved);
  const last5 = resolved.substring(resolved.length - 5);
  if (cached) {
    if (last5 === ".node") {
      return cached.exports;
    }
    return cached;
  }

  // TODO: remove this hardcoding
  if (last5 === ".json") {
    var fs = (globalThis[Symbol.for("_fs")] ||= Bun.fs());
    var exports = JSON.parse(fs.readFileSync(resolved, "utf8"));
    $requireMap.$set(resolved, exports);
    return exports;
  } else if (last5 === ".node") {
    var module = { exports: {} };
    process.dlopen(module, resolved);
    $requireMap.$set(resolved, module);
    return module.exports;
  } else if (last5 === ".toml") {
    var fs = (globalThis[Symbol.for("_fs")] ||= Bun.fs());
    var exports = Bun.TOML.parse(fs.readFileSync(resolved, "utf8"));
    $requireMap.$set(resolved, exports);
    return exports;
  } else {
    var exports = $requireESM(resolved);
    const cachedExports = $requireMap.$get(resolved);
    if (cachedExports) {
      return cachedExports;
    }

    $requireMap.$set(resolved, exports);
    return exports;
  }
}

export function createRequireCache() {
  class Module {
    id;
    parent;
    filename;
    children = [];
    paths = [];

    constructor(filename) {
      this.id = filename;
      // TODO: windows
      const lastSlash = filename.lastIndexOf("/");
      if (lastSlash !== -1 && filename.length > lastSlash + 1) {
        this.filename = filename.substring(lastSlash + 1);
      } else {
        this.filename = filename;
      }
    }

    get loaded() {
      return true;
    }

    require(path) {
      return $internalRequire($resolveSync(path, this.id));
    }

    get exports() {
      return $requireMap.$get(this.id) ?? {};
    }

    set exports(value) {
      $requireMap.$set(this.id, value);
    }
  }

  var moduleMap = new Map();

  return new Proxy(
    {},
    {
      get(target, key: string) {
        const entry = $requireMap.$get(key);
        if (entry) {
          var mod = moduleMap.$get(key);
          if (!mod) {
            mod = new Module(key);
            moduleMap.$set(key, mod);
          }
          return mod;
        }
      },
      set(target, key: string, value) {
        if (!moduleMap.$has(key)) {
          moduleMap.$set(key, new Module(key));
        }

        $requireMap.$set(key, value?.exports);

        return true;
      },

      has(target, key: string) {
        return $requireMap.$has(key);
      },

      deleteProperty(target, key: string) {
        moduleMap.$delete(key);
        $requireMap.$delete(key);
        Loader.registry.$delete(key);
        return true;
      },

      ownKeys(target) {
        return [...$requireMap.$keys()];
      },

      // In Node, require.cache has a null prototype
      getPrototypeOf(target) {
        return null;
      },

      getOwnPropertyDescriptor(target, key: string) {
        if ($requireMap.$has(key)) {
          return {
            configurable: true,
            enumerable: true,
          };
        }
      },
    },
  );
}

$sloppy;
export function require(this: ImportMetaObject, name) {
  var from = this?.path ?? arguments.callee.path;

  if (typeof name !== "string") {
    throw new TypeError("require(name) must be a string");
  }

  return $internalRequire($resolveSync(name, from));
}

$getter;
export function main(this: ImportMetaObject) {
  return this.path === Bun.main;
}
