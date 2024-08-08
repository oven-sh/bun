type ImportMetaObject = Partial<ImportMeta>;

$visibility = "Private";
export function loadCJS2ESM(this: ImportMetaObject, resolvedSpecifier: string) {
  var loader = Loader;
  var queue = $createFIFO();
  let key = resolvedSpecifier;
  const registry = loader.registry;

  while (key) {
    // we need to explicitly check because state could be $ModuleFetch
    // it will throw this error if we do not:
    //    $throwTypeError("Requested module is already fetched.");
    let entry = registry.$get(key)!,
      moduleRecordPromise,
      state = 0,
      // entry.fetch is a Promise<SourceCode>
      // SourceCode is not a string, it's a JSC::SourceCode object
      fetch: Promise<SourceCode> | undefined;

    if (entry) {
      ({ state, fetch } = entry);
    }

    if (
      !entry ||
      // if we need to fetch it
      (state <= $ModuleFetch &&
        // either:
        // - we've never fetched it
        // - a fetch is in progress
        (!$isPromise(fetch) ||
          ($getPromiseInternalField(fetch, $promiseFieldFlags) & $promiseStateMask) === $promiseStatePending))
    ) {
      // force it to be no longer pending
      $fulfillModuleSync(key);

      entry = registry.$get(key)!;

      // the state can transition here
      // https://github.com/oven-sh/bun/issues/8965
      if (entry) {
        ({ state = 0, fetch } = entry);
      }
    }

    if (state < $ModuleLink && $isPromise(fetch)) {
      // This will probably never happen, but just in case
      if (($getPromiseInternalField(fetch, $promiseFieldFlags) & $promiseStateMask) === $promiseStatePending) {
        throw new TypeError(`require() async module "${key}" is unsupported. use "await import()" instead.`);
      }

      // this pulls it out of the promise without delaying by a tick
      // the promise is already fullfilled by $fullfillModuleSync
      const sourceCodeObject = $getPromiseInternalField(fetch, $promiseFieldReactionsOrResult);
      moduleRecordPromise = loader.parseModule(key, sourceCodeObject);
    }
    let mod = entry?.module;

    if (moduleRecordPromise && $isPromise(moduleRecordPromise)) {
      let reactionsOrResult = $getPromiseInternalField(moduleRecordPromise, $promiseFieldReactionsOrResult);
      let flags = $getPromiseInternalField(moduleRecordPromise, $promiseFieldFlags);
      let state = flags & $promiseStateMask;
      // this branch should never happen, but just to be safe
      if (state === $promiseStatePending || (reactionsOrResult && $isPromise(reactionsOrResult))) {
        throw new TypeError(`require() async module "${key}" is unsupported. use "await import()" instead.`);
      } else if (state === $promiseStateRejected) {
        if (!reactionsOrResult?.message) {
          throw new TypeError(
            `${
              reactionsOrResult + "" ? reactionsOrResult : "An error occurred"
            } occurred while parsing module \"${key}\"`,
          );
        }

        throw reactionsOrResult;
      }
      entry.module = mod = reactionsOrResult;
    } else if (moduleRecordPromise && !mod) {
      entry.module = mod = moduleRecordPromise as LoaderModule;
    }

    // This is very similar to "requestInstantiate" in ModuleLoader.js in JavaScriptCore.
    $setStateToMax(entry, $ModuleLink);
    const dependenciesMap = mod.dependenciesMap;
    const requestedModules = loader.requestedModules(mod);
    const dependencies = $newArrayWithSize<string>(requestedModules.length);
    for (var i = 0, length = requestedModules.length; i < length; ++i) {
      const depName = requestedModules[i];
      // optimization: if it starts with a slash then it's an absolute path
      // we don't need to run the resolver a 2nd time
      const depKey = depName[0] === "/" ? depName : loader.resolve(depName, key);
      const depEntry = loader.ensureRegistered(depKey);

      if (depEntry.state < $ModuleLink) {
        queue.push(depKey);
      }

      $putByValDirect(dependencies, i, depEntry);
      dependenciesMap.$set(depName, depEntry);
    }

    entry.dependencies = dependencies;
    // All dependencies resolved, set instantiate and satisfy field directly.
    entry.instantiate = Promise.$resolve(entry);
    entry.satisfy = Promise.$resolve(entry);
    entry.isSatisfied = true;

    key = queue.shift();
    while (key && (registry.$get(key)?.state ?? $ModuleFetch) >= $ModuleLink) {
      key = queue.shift();
    }
  }

  var linkAndEvaluateResult = loader.linkAndEvaluateModule(resolvedSpecifier, undefined);
  if (linkAndEvaluateResult && $isPromise(linkAndEvaluateResult)) {
    // if you use top-level await, or any dependencies use top-level await, then we throw here
    // this means the module will still actually load eventually, but that's okay.
    throw new TypeError(
      `require() async module \"${resolvedSpecifier}\" is unsupported. use "await import()" instead.`,
    );
  }

  return registry.$get(resolvedSpecifier);
}

$visibility = "Private";
export function requireESM(this: ImportMetaObject, resolved) {
  var entry = Loader.registry.$get(resolved);

  if (!entry || !entry.evaluated) {
    entry = $loadCJS2ESM(resolved);
  }

  if (!entry || !entry.evaluated || !entry.module) {
    throw new TypeError(`require() failed to evaluate module "${resolved}". This is an internal consistentency error.`);
  }
  var exports = Loader.getModuleNamespaceObject(entry.module);

  return exports;
}

$visibility = "Private";
export function internalRequire(this: ImportMetaObject, id) {
  var cached = $requireMap.$get(id);
  const last5 = id.substring(id.length - 5);
  if (cached) {
    return cached.exports;
  }

  // TODO: remove this hardcoding
  if (last5 === ".json" && !id.endsWith?.("package.json")) {
    var fs = (globalThis[Symbol.for("_fs")] ||= Bun.fs());
    var exports = JSON.parse(fs.readFileSync(id, "utf8"));
    $requireMap.$set(id, $createCommonJSModule(id, exports, true, undefined));
    return exports;
  } else if (last5 === ".node") {
    const module = $createCommonJSModule(id, {}, true, undefined);
    process.dlopen(module, id);
    $requireMap.$set(id, module);
    return module.exports;
  } else if (last5 === ".toml") {
    var fs = (globalThis[Symbol.for("_fs")] ||= Bun.fs());
    var exports = Bun.TOML.parse(fs.readFileSync(id, "utf8"));
    $requireMap.$set(id, $createCommonJSModule(id, exports, true, undefined));
    return exports;
  } else {
    var exports = $requireESM(id);
    const cachedModule = $requireMap.$get(id);
    if (cachedModule) {
      return cachedModule.exports;
    }
    $requireMap.$set(id, $createCommonJSModule(id, exports, true, undefined));
    return exports;
  }
}

$visibility = "Private";
export function createRequireCache() {
  var moduleMap = new Map();
  var inner = {};
  return new Proxy(inner, {
    get(target, key: string) {
      const entry = $requireMap.$get(key);
      if (entry) return entry;

      const esm = Loader.registry.$get(key);
      if (esm?.evaluated) {
        const namespace = Loader.getModuleNamespaceObject(esm.module);
        const mod = $createCommonJSModule(key, namespace, true, undefined);
        $requireMap.$set(key, mod);
        return mod;
      }

      return inner[key];
    },
    set(target, key: string, value) {
      $requireMap.$set(key, value);
      return true;
    },

    has(target, key: string) {
      return $requireMap.$has(key) || Boolean(Loader.registry.$get(key)?.evaluated);
    },

    deleteProperty(target, key: string) {
      moduleMap.$delete(key);
      $requireMap.$delete(key);
      Loader.registry.$delete(key);
      return true;
    },

    ownKeys(target) {
      var array = [...$requireMap.$keys()];
      for (const key of Loader.registry.$keys()) {
        if (!array.includes(key) && Loader.registry.$get(key)?.evaluated) {
          $arrayPush(array, key);
        }
      }
      return array;
    },

    // In Node, require.cache has a null prototype
    getPrototypeOf(target) {
      return null;
    },

    getOwnPropertyDescriptor(target, key: string) {
      if ($requireMap.$has(key) || Loader.registry.$get(key)?.evaluated) {
        return {
          configurable: true,
          enumerable: true,
        };
      }
    },
  });
}

$getter;
export function main(this: ImportMetaObject) {
  return this.path === Bun.main && Bun.isMainThread;
}
