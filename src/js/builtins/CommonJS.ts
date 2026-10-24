// This file contains functions used for the CommonJS module loader

interface RequiredESMNamespace {
  __esModule?: unknown;
  "module.exports"?: unknown;
}

$getter;
export function main() {
  return $requireMap.$get(Bun.main);
}

// This function is bound when constructing instances of CommonJSModule
$visibility = "Private";
export function require(this: JSCommonJSModule, _id: string) {
  // Do not use $tailCallForwardArguments here, it causes https://github.com/oven-sh/bun/issues/9225
  return $overridableRequire.$apply(this, arguments);
}

// overridableRequire can be overridden by setting `Module.prototype.require`
// Like Node, `this` is only used as the parent module and can be any value, even null.
$overriddenName = "require";
$visibility = "Private";
export function overridableRequire(this: JSCommonJSModule, originalId: string, options?: { paths?: string[] }) {
  // `filename` can be a user getter, so read it once, before the module is added to the require map.
  const parentFilename = this?.filename;
  const id = $resolveSync(originalId, parentFilename, false, false, options ? options.paths : undefined, this, options);
  // The global require cache, or the one of the Bun.ModuleGraph this module belongs to.
  const requireMap: RequireMap = this?.$requireMap || $requireMap;
  if (id.startsWith("node:")) {
    if (id !== originalId) {
      // A terrible special case where Node.js allows non-prefixed built-ins to
      // read the require cache. Though they never write to it, which is so silly.
      const existing = requireMap.$get(originalId);
      if (existing) {
        const c = $evaluateCommonJSModule(existing, this);
        if (c && c.indexOf(existing) === -1) {
          c.push(existing);
        }
        return existing.exports;
      }
    }

    return $requireNativeModule(id);
  } else {
    const existing = requireMap.$get(id);
    if (existing) {
      // Scenario where this is necessary:
      //
      // In an ES Module, we have:
      //
      //    import "react-dom/server"
      //    import "react"
      //
      // Synchronously, the "react" import is created first, and then the
      // "react-dom/server" import is created. Then, at ES Module link time, they
      // are evaluated. The "react-dom/server" import is evaluated first, and
      // require("react") was previously created as an ESM module, so we wait
      // for the ESM module to load
      //
      // ...and then when this code is reached, unless
      // we evaluate it "early", we'll get an empty object instead of the module
      // exports.
      //
      const c = $evaluateCommonJSModule(existing, this);
      if (c && c.indexOf(existing) === -1) {
        c.push(existing);
      }
      return existing.exports;
    }
  }

  // A resolved id may carry a `?query` suffix (part of the module cache key);
  // match the native-addon extension against the path portion only.
  // An addon that was compiled into an executable is a module of it, loaded like its other modules: the body of that module calls `process.dlopen`.
  const queryIndex = id.indexOf("?");
  if ((queryIndex === -1 ? id.endsWith(".node") : id.endsWith(".node", queryIndex)) && !$isHiddenFromRequireCache(id)) {
    return $internalRequire(id, this, requireMap);
  }

  if (id === "bun:test") {
    // Not `Bun.jest`: every executable with a computed `require()` holds this function, and naming it would keep the test runner in all of them.
    const requireTestModule: (filename: string) => object = $newCppFunction(
      "JSCommonJSModule.cpp",
      "jsFunctionRequireTestModule",
      1,
    );
    return requireTestModule(parentFilename);
  }

  // To handle import/export cycles, we need to create a module object and put
  // it into the map before we import it.
  const mod = $createCommonJSModule(id, {}, false, this);
  requireMap.$set(id, mod);

  var out: JSCommonJSModule | RequiredESMNamespace | -1;

  // This is where we load the module. We will see if Module._load and
  // Module._compile are actually important for compatibility.
  //
  // Note: we do not need to wrap this in a try/catch for release, if it throws
  // the C++ code will clear the module from the map.
  //
  if (IS_BUN_DEVELOPMENT) {
    $assert(mod.id === id);
    try {
      out = $requireCommonJS(
        id,
        mod,
        parentFilename,
        // did they pass a { type } object?
        $argumentCount(),
        // the object containing a "type" attribute, if they passed one
        // maybe this will be "paths" in the future too.
        $argument(1),
      );
    } catch (E) {
      $assert(requireMap.$get(id) === undefined, "Module " + JSON.stringify(id) + " should no longer be in the map");
      throw E;
    }
  } else {
    out = $requireCommonJS(id, mod, parentFilename, $argumentCount(), $argument(1));
  }

  // -1 means we need to lookup the module from the ESM registry.
  if (out === -1) {
    try {
      out = $requireESM(id, this) as RequiredESMNamespace;
    } catch (exception) {
      // Since the ESM code is mostly JS, we need to handle exceptions here.
      requireMap.$delete(id);
      throw exception;
    }

    const namespace = out;
    // In a require cycle the namespace is live while the module body is still
    // running, so an export named `__esModule` / `module.exports` may be in TDZ.
    let esModule, moduleExports;
    try {
      esModule = namespace.__esModule;
      moduleExports = namespace["module.exports"];
    } catch {}
    // In Bun, when __esModule is not defined, it's a CustomAccessor on the prototype.
    // Various libraries expect __esModule to be set when using ESM from require().
    // We don't want to always inject the __esModule export into every module,
    // And creating an Object wrapper causes the actual exports to not be own properties.
    // So instead of either of those, we make it so that the __esModule property can be set at runtime.
    // It only supports "true" and undefined. Anything non-truthy is treated as undefined.
    // https://github.com/oven-sh/bun/issues/14411
    if (esModule === undefined) {
      try {
        namespace.__esModule = true;
      } catch {
        // https://github.com/oven-sh/bun/issues/17816
      }
    }

    return (mod.exports = moduleExports ?? namespace);
  }

  const c = $evaluateCommonJSModule(mod, this);
  if (c && c.indexOf(mod) === -1) {
    c.push(mod);
  }
  return mod.exports;
}

// Called by native code with a `module.children` value that script has read or assigned.
$visibility = "Private";
export function pushObservableChild(children: JSCommonJSModule[] | undefined, child: JSCommonJSModule) {
  if (children && children.indexOf(child) === -1) {
    children.push(child);
  }
}

$visibility = "Private";
export function requireResolve(this: JSCommonJSModule, id: string, options: { paths?: string[] } = {}) {
  // Only `options.paths` extraction happens here; builtin bypass and paths
  // validation are native (functionImportMeta__resolveSyncPrivate).
  const paths = typeof options === "object" && options !== null ? options.paths : undefined;
  return $resolveSync(id, this.filename, false, true, paths, this, options ?? {});
}

$visibility = "Private";
export function internalRequire(id: string, parent: JSCommonJSModule, requireMap: RequireMap) {
  // A native addon is loaded once per process: its one module object is the global cache's,
  // which a Bun.ModuleGraph's cache then also points at.
  const loaded = $requireMap.$get(id);
  if (loaded) {
    $assert(requireMap !== $requireMap, "Module " + JSON.stringify(id) + " should not be in the map");
    requireMap.$set(id, loaded);
    return loaded.exports;
  }
  // `id` keys the module cache and may carry a `?query` suffix;
  // `process.dlopen` needs the on-disk path.
  const queryIndex = id.indexOf("?");
  const filename = queryIndex === -1 ? id : id.substring(0, queryIndex);
  $assert(filename.endsWith(".node"));

  const module = $createCommonJSModule(id, {}, true, requireMap === $requireMap ? parent : undefined);
  // Resolving the name has thrown in an executable that refuses native addons.
  if (CAN_LOAD_CODE_AT_RUN_TIME) {
    process.dlopen(module, filename);
  }
  $requireMap.$set(id, module);
  if (requireMap !== $requireMap) requireMap.$set(id, module);
  return module.exports;
}

$visibility = "Private";
export function loadEsmIntoCjs(resolvedSpecifier: string, requirer?: JSCommonJSModule) {
  // The JSC module loader pipeline is now pure C++. $esmLoadSync sets a VM
  // flag that makes the loader's internal promise reactions run immediately
  // (instead of queueing microtasks) whenever the upstream promise is already
  // settled. Because Bun resolves and reads source code synchronously, the
  // entire fetch → parse → link → evaluate chain completes within this call
  // for any module graph that does not use top-level await.
  return $esmLoadSync(resolvedSpecifier, requirer);
}

// `requirer`: the module whose require() this is. The ES module is loaded by the loader of the
// Bun.ModuleGraph that module belongs to, or the global object's.
$visibility = "Private";
export function requireESM(this: void, resolved: string, requirer?: JSCommonJSModule) {
  // `$esmLoadSync` answers from the registry for a record that is already
  // Evaluated, or still Evaluating because this require() sits inside its own
  // evaluation (a require cycle), before it loads anything.
  const exports = $loadEsmIntoCjs(resolved, requirer);
  if (exports === undefined) {
    throw new TypeError(`require() failed to evaluate module "${resolved}". This is an internal consistentency error.`);
  }
  return exports;
}

export function requireESMFromHijackedExtension(this: JSCommonJSModule, id: string) {
  $assert(this);
  // Runs inside `$require`, which removes the require map entry if the user's handler lets this throw.
  const namespace = $requireESM(id, this);

  // See `overridableRequire`: TDZ-safe reads for the require-cycle case.
  let esModule, moduleExports;
  try {
    esModule = namespace.__esModule;
    moduleExports = namespace["module.exports"];
  } catch {}
  // In Bun, when __esModule is not defined, it's a CustomAccessor on the prototype.
  // Various libraries expect __esModule to be set when using ESM from require().
  // We don't want to always inject the __esModule export into every module,
  // And creating an Object wrapper causes the actual exports to not be own properties.
  // So instead of either of those, we make it so that the __esModule property can be set at runtime.
  // It only supports "true" and undefined. Anything non-truthy is treated as undefined.
  // https://github.com/oven-sh/bun/issues/14411
  if (esModule === undefined) {
    try {
      namespace.__esModule = true;
    } catch {
      // https://github.com/oven-sh/bun/issues/17816
    }
  }

  this.exports = moduleExports ?? namespace;
}

$visibility = "Private";
// `requireMap`: the global require cache, or a Bun.ModuleGraph's together with one of
// the graph's modules (`owner`, which names the loader whose ES modules it also lists).
export function createRequireCache(requireMap: RequireMap, owner?: JSCommonJSModule) {
  var inner = {
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return { ...proxy };
    },
  };
  // Node.js never adds builtin modules to require.cache. Serving them from
  // the ESM registry would hand out the frozen module namespace object, which
  // breaks CJS patchers like require-in-the-middle that read require.cache
  // and expect a mutable exports object. The same applies to bun:* builtins.
  // Users can still write their own entries for builtins; those live in
  // $requireMap.
  const isBuiltinKey = (key: string | symbol) =>
    typeof key === "string" && (key.startsWith("node:") || key.startsWith("bun:"));
  // An executable that `bun build --compile --aot` made never lists its own files, which run once: the cache holds the files that were loaded from outside of the executable, as in a bundled executable.
  const hidesFiles = $isHiddenFromRequireCache();
  const isHidden = (key: string | symbol) => hidesFiles && $isHiddenFromRequireCache(key);
  const hasKey = (key: string) =>
    !isHidden(key) && (requireMap.$has(key) || (!isBuiltinKey(key) && $esmRegistryHasEvaluated(key, owner)));
  var proxy = new Proxy(inner, {
    get(_target, key: string) {
      if (isHidden(key)) return undefined;
      const entry = requireMap.$get(key);
      if (entry) return entry;

      if (!isBuiltinKey(key)) {
        const namespace = $esmNamespaceForCjs(key, owner);
        if (namespace !== undefined) {
          const mod = $createCommonJSModule(key, namespace, true, owner);
          requireMap.$set(key, mod);
          return mod;
        }
      }

      return inner[key];
    },
    set(_target, key: string, value) {
      $requireCacheWillSet(key, value, owner);
      requireMap.$set(key, value);
      return true;
    },

    has(_target, key: string) {
      return hasKey(key);
    },

    deleteProperty(_target, key: string) {
      if (isHidden(key)) return true;
      requireMap.$delete(key);
      $esmRegistryDelete(key, owner);
      $evictIsolationSourceProviderCache(key);
      return true;
    },

    ownKeys(_target) {
      var array = [...requireMap.$keys()];
      for (const key of $esmRegistryEvaluatedKeys(owner)) {
        if (!isBuiltinKey(key) && !requireMap.$has(key)) {
          $arrayPush(array, key);
        }
      }
      return hidesFiles ? array.filter(key => !isHidden(key)) : array;
    },

    // In Node, require.cache has a null prototype
    getPrototypeOf(_target) {
      return null;
    },

    getOwnPropertyDescriptor(_target, key: string) {
      if (hasKey(key)) {
        return {
          configurable: true,
          enumerable: true,
        };
      }
    },
  });

  return proxy;
}

type WrapperMutate = (start: string, end: string) => void;
export function getWrapperArrayProxy(onMutate: WrapperMutate, start: string, end: string) {
  const wrapper = [start, end];
  // onMutate throws what it refuses (--disallow-code-generation-from-strings=strict), which is then
  // not left in the array.
  function didMutate(previousStart: string, previousEnd: string) {
    try {
      onMutate(wrapper[0], wrapper[1]);
    } catch (error) {
      wrapper[0] = previousStart;
      wrapper[1] = previousEnd;
      throw error;
    }
    return true;
  }
  return new Proxy(wrapper, {
    set(_target, prop, value, receiver) {
      const previousStart = wrapper[0];
      const previousEnd = wrapper[1];
      Reflect.set(wrapper, prop, value, receiver);
      return didMutate(previousStart, previousEnd);
    },
    defineProperty(_target, prop, descriptor) {
      const previousStart = wrapper[0];
      const previousEnd = wrapper[1];
      Reflect.defineProperty(wrapper, prop, descriptor);
      return didMutate(previousStart, previousEnd);
    },
    deleteProperty(_target, prop) {
      const previousStart = wrapper[0];
      const previousEnd = wrapper[1];
      Reflect.deleteProperty(wrapper, prop);
      return didMutate(previousStart, previousEnd);
    },
  });
}
