// This file contains functions used for the CommonJS module loader

$getter;
export function main() {
  return $requireMap.$get(Bun.main);
}

// This function is bound when constructing instances of CommonJSModule
$visibility = "Private";
export function require(this: JSCommonJSModule, _: string) {
  // Do not use $tailCallForwardArguments here, it causes https://github.com/oven-sh/bun/issues/9225
  return $overridableRequire.$apply(this, arguments);
}

// overridableRequire can be overridden by setting `Module.prototype.require`
$overriddenName = "require";
$visibility = "Private";
export function overridableRequire(this: JSCommonJSModule, originalId: string, options?: { paths?: string[] }) {
  const id = $resolveSync(originalId, this.filename, false, false, options ? options.paths : undefined, this, options);
  if (id.startsWith("node:")) {
    if (id !== originalId) {
      // A terrible special case where Node.js allows non-prefixed built-ins to
      // read the require cache. Though they never write to it, which is so silly.
      const existing = $requireMap.$get(originalId);
      if (existing) {
        const c = $evaluateCommonJSModule(existing, this);
        if (c && c.indexOf(existing) === -1) {
          c.push(existing);
        }
        return existing.exports;
      }
    }

    return this.$requireNativeModule(id);
  } else {
    const existing = $requireMap.$get(id);
    if (existing && existing.$esModule && this.$moduleGraph !== undefined) {
      // The entry is the host's instance of an ES module. A Bun.unsafe.ModuleGraph's
      // modules get their graph's own, which never enters the require cache.
      return $requireESMExports($requireESM(id, this.$moduleGraph));
    }
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
  const queryIndex = id.indexOf("?");
  if (queryIndex === -1 ? id.endsWith(".node") : id.endsWith(".node", queryIndex)) {
    return $internalRequire(id, this);
  }

  if (id === "bun:test") {
    return Bun.jest(this.filename);
  }

  // To handle import/export cycles, the module object has to be in the map before
  // the module evaluates. Whether `id` is an ES module is not known yet, and an ES
  // module is not found in the map while it evaluates (a require cycle gets its live
  // namespace from the module loader instead), so $require puts `mod` into the map
  // itself, once `id` turns out to be anything else.
  const mod = $createCommonJSModule(id, {}, false, this);
  const graph = this.$moduleGraph;

  var out: LoaderModule | -1;

  // This is where we load the module. We will see if Module._load and
  // Module._compile are actually important for compatibility.
  //
  // Note: we do not need to wrap this in a try/catch for release, if it throws
  // the C++ code will clear the module from the map.
  //
  if (IS_BUN_DEVELOPMENT) {
    $assert(mod.id === id);
    try {
      out = this.$require(
        id,
        mod,
        // did they pass a { type } object?
        $argumentCount(),
        // the object containing a "type" attribute, if they passed one
        // maybe this will be "paths" in the future too.
        $argument(1),
      );
    } catch (E) {
      $assert($requireMap.$get(id) !== mod, "Module " + JSON.stringify(id) + " should no longer be in the map");
      throw E;
    }
  } else {
    out = this.$require(id, mod, $argumentCount(), $argument(1));
  }

  // -1 means we need to lookup the module from the ESM registry.
  if (out === -1) {
    const exports = $requireESMExports($requireESM(id, graph));
    // A Bun.unsafe.ModuleGraph's ES module instances never enter the (shared) require cache.
    if (graph !== undefined) return exports;
    mod.$esModule = true;
    $requireMap.$set(id, mod);
    return (mod.exports = exports);
  }

  // A wrapped Module._extensions handler loaded the graph's instance of an ES module into `mod`.
  if (graph !== undefined && mod.$esModule) return mod.exports;

  const c = $evaluateCommonJSModule(mod, this);
  if (c && c.indexOf(mod) === -1) {
    c.push(mod);
  }
  return mod.exports;
}

$visibility = "Private";
export function requireResolve(this: JSCommonJSModule, id: string, options: { paths?: string[] } = {}) {
  // Only `options.paths` extraction happens here; builtin bypass and paths
  // validation are native (functionImportMeta__resolveSyncPrivate).
  const paths = typeof options === "object" && options !== null ? options.paths : undefined;
  return $resolveSync(id, this.filename, false, true, paths, this, options ?? {});
}

$visibility = "Private";
export function internalRequire(id: string, parent: JSCommonJSModule) {
  $assert($requireMap.$get(id) === undefined, "Module " + JSON.stringify(id) + " should not be in the map");
  // `id` keys the module cache and may carry a `?query` suffix;
  // `process.dlopen` needs the on-disk path.
  const queryIndex = id.indexOf("?");
  const filename = queryIndex === -1 ? id : id.substring(0, queryIndex);
  $assert(filename.endsWith(".node"));

  const module = $createCommonJSModule(id, {}, true, parent);
  process.dlopen(module, filename);
  $requireMap.$set(id, module);
  return module.exports;
}

$visibility = "Private";
export function loadEsmIntoCjs(resolvedSpecifier: string, graph?: object) {
  // The JSC module loader pipeline is now pure C++. $esmLoadSync sets a VM
  // flag that makes the loader's internal promise reactions run immediately
  // (instead of queueing microtasks) whenever the upstream promise is already
  // settled. Because Bun resolves and reads source code synchronously, the
  // entire fetch → parse → link → evaluate chain completes within this call
  // for any module graph that does not use top-level await.
  return $esmLoadSync(resolvedSpecifier, graph);
}

// `graph` is the Bun.unsafe.ModuleGraph whose instance of the module to load, or
// undefined for the global object's own.
$visibility = "Private";
export function requireESM(this, resolved: string, graph?: object) {
  // `$esmLoadSync` answers from the registry for a record that is already
  // Evaluated, or still Evaluating because this require() sits inside its own
  // evaluation (a require cycle), before it loads anything.
  const exports = $loadEsmIntoCjs(resolved, graph);
  if (exports === undefined) {
    throw new TypeError(`require() failed to evaluate module "${resolved}". This is an internal consistentency error.`);
  }
  return exports;
}

// What require() returns for an ES module's namespace.
$visibility = "Private";
export function requireESMExports(namespace) {
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

  return moduleExports ?? namespace;
}

export function requireESMFromHijackedExtension(this: JSCommonJSModule, id: string) {
  $assert(this);
  // The handler ran with `this` in the require cache, as handlers expect. See
  // `overridableRequire`: an ES module is not found there while it evaluates.
  if ($requireMap.$get(id) === this) $requireMap.$delete(id);
  const graph = $requiringModuleGraph();
  const namespace = $requireESM(id, graph);

  this.$esModule = true;
  this.exports = $requireESMExports(namespace);
  // A Bun.unsafe.ModuleGraph's ES module instances never enter the (shared) require cache.
  if (graph === undefined) $requireMap.$set(id, this);
}

$visibility = "Private";
export function createRequireCache() {
  var moduleMap = new Map();
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
  const hasKey = (key: string) => $requireMap.$has(key) || (!isBuiltinKey(key) && $esmRegistryHasEvaluated(key));
  var proxy = new Proxy(inner, {
    get(_target, key: string) {
      const entry = $requireMap.$get(key);
      if (entry) return entry;

      if (!isBuiltinKey(key)) {
        const namespace = $esmNamespaceForCjs(key);
        if (namespace !== undefined) {
          const mod = $createCommonJSModule(key, namespace, true, undefined);
          mod.$esModule = true;
          $requireMap.$set(key, mod);
          return mod;
        }
      }

      return inner[key];
    },
    set(_target, key: string, value) {
      $requireMap.$set(key, value);
      return true;
    },

    has(_target, key: string) {
      return hasKey(key);
    },

    deleteProperty(_target, key: string) {
      moduleMap.$delete(key);
      $requireMap.$delete(key);
      $esmRegistryDelete(key);
      $evictIsolationSourceProviderCache(key);
      return true;
    },

    ownKeys(_target) {
      var array = [...$requireMap.$keys()];
      for (const key of $esmRegistryEvaluatedKeys()) {
        if (!isBuiltinKey(key) && !$requireMap.$has(key)) {
          $arrayPush(array, key);
        }
      }
      return array;
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
  return new Proxy(wrapper, {
    set(_target, prop, value, receiver) {
      Reflect.set(wrapper, prop, value, receiver);
      onMutate(wrapper[0], wrapper[1]);
      return true;
    },
    defineProperty(_target, prop, descriptor) {
      Reflect.defineProperty(wrapper, prop, descriptor);
      onMutate(wrapper[0], wrapper[1]);
      return true;
    },
    deleteProperty(_target, prop) {
      Reflect.deleteProperty(wrapper, prop);
      onMutate(wrapper[0], wrapper[1]);
      return true;
    },
  });
}
