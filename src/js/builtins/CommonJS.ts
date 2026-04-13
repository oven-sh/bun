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
export function overridableRequire(this: JSCommonJSModule, originalId: string, options: { paths?: string[] } = {}) {
  const id = $resolveSync(originalId, this.filename, false, false, options ? options.paths : undefined);
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

  if (id.endsWith(".node")) {
    return $internalRequire(id, this);
  }

  if (id === "bun:test") {
    return Bun.jest(this.filename);
  }

  // To handle import/export cycles, we need to create a module object and put
  // it into the map before we import it.
  const mod = $createCommonJSModule(id, {}, false, this);
  $requireMap.$set(id, mod);

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
      $assert($requireMap.$get(id) === undefined, "Module " + JSON.stringify(id) + " should no longer be in the map");
      throw E;
    }
  } else {
    out = this.$require(id, mod, $argumentCount(), $argument(1));
  }

  // -1 means we need to lookup the module from the ESM registry.
  if (out === -1) {
    try {
      out = $requireESM(id);
    } catch (exception) {
      // Since the ESM code is mostly JS, we need to handle exceptions here.
      $requireMap.$delete(id);
      throw exception;
    }

    // If we can pull out a ModuleNamespaceObject, let's do it.
    const namespace = $esmNamespaceForCjs(id);
    if (namespace !== undefined) {
      // In Bun, when __esModule is not defined, it's a CustomAccessor on the prototype.
      // Various libraries expect __esModule to be set when using ESM from require().
      // We don't want to always inject the __esModule export into every module,
      // And creating an Object wrapper causes the actual exports to not be own properties.
      // So instead of either of those, we make it so that the __esModule property can be set at runtime.
      // It only supports "true" and undefined. Anything non-truthy is treated as undefined.
      // https://github.com/oven-sh/bun/issues/14411
      if (namespace.__esModule === undefined) {
        try {
          namespace.__esModule = true;
        } catch {
          // https://github.com/oven-sh/bun/issues/17816
        }
      }

      return (mod.exports = namespace["module.exports"] ?? namespace);
    }
  }

  const c = $evaluateCommonJSModule(mod, this);
  if (c && c.indexOf(mod) === -1) {
    c.push(mod);
  }
  return mod.exports;
}

$visibility = "Private";
export function requireResolve(
  this: string | { filename?: string; id?: string },
  id: string,
  options: { paths?: string[] } = {},
) {
  return $resolveSync(
    id,
    typeof this === "string" ? this : (this?.filename ?? this?.id ?? ""),
    false,
    true,
    options ? options.paths : undefined,
  );
}

$visibility = "Private";
export function internalRequire(id: string, parent: JSCommonJSModule) {
  $assert($requireMap.$get(id) === undefined, "Module " + JSON.stringify(id) + " should not be in the map");
  $assert(id.endsWith(".node"));

  const module = $createCommonJSModule(id, {}, true, parent);
  process.dlopen(module, id);
  $requireMap.$set(id, module);
  return module.exports;
}

$visibility = "Private";
export function loadEsmIntoCjs(resolvedSpecifier: string) {
  // The JSC module loader pipeline is now pure C++. $esmLoadSync sets a VM
  // flag that makes the loader's internal promise reactions run immediately
  // (instead of queueing microtasks) whenever the upstream promise is already
  // settled. Because Bun resolves and reads source code synchronously, the
  // entire fetch → parse → link → evaluate chain completes within this call
  // for any module graph that does not use top-level await.
  return $esmLoadSync(resolvedSpecifier);
}

/* Legacy implementation removed: relied on the old JS-side JSModuleLoader
 * (Loader.registry JSMap, $setStateToMax, parseModule, etc.) which no longer
 * exists after the upstream module-loader rewrite.
function loadEsmIntoCjs__dead(resolvedSpecifier: string) {
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
      fetch: Promise<JSCSourceCodeObject> | undefined;

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
        registry.$delete(resolvedSpecifier);

        throw new TypeError(`require() async module "${key}" is unsupported. use "await import()" instead.`);
      }

      // this pulls it out of the promise without delaying by a tick
      // the promise is already fulfilled by $fulfillModuleSync
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
        registry.$delete(resolvedSpecifier);

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
    registry.$delete(resolvedSpecifier);

    // if you use top-level await, or any dependencies use top-level await, then we throw here
    // this means the module will still actually load eventually, but that's okay.
    throw new TypeError(
      `require() async module \"${resolvedSpecifier}\" is unsupported. use "await import()" instead.`,
    );
  }

  return registry.$get(resolvedSpecifier);
}
*/

$visibility = "Private";
export function requireESM(this, resolved: string) {
  var exports = $esmNamespaceForCjs(resolved);
  if (exports === undefined) {
    exports = $loadEsmIntoCjs(resolved);
  }
  if (exports === undefined) {
    throw new TypeError(`require() failed to evaluate module "${resolved}". This is an internal consistentency error.`);
  }
  return exports;
}

export function requireESMFromHijackedExtension(this: JSCommonJSModule, id: string) {
  $assert(this);
  try {
    $requireESM(id);
  } catch (exception) {
    // Since the ESM code is mostly JS, we need to handle exceptions here.
    $requireMap.$delete(id);
    throw exception;
  }

  // If we can pull out a ModuleNamespaceObject, let's do it.
  const namespace = $esmNamespaceForCjs(id);
  if (namespace !== undefined) {
    // In Bun, when __esModule is not defined, it's a CustomAccessor on the prototype.
    // Various libraries expect __esModule to be set when using ESM from require().
    // We don't want to always inject the __esModule export into every module,
    // And creating an Object wrapper causes the actual exports to not be own properties.
    // So instead of either of those, we make it so that the __esModule property can be set at runtime.
    // It only supports "true" and undefined. Anything non-truthy is treated as undefined.
    // https://github.com/oven-sh/bun/issues/14411
    if (namespace.__esModule === undefined) {
      try {
        namespace.__esModule = true;
      } catch {
        // https://github.com/oven-sh/bun/issues/17816
      }
    }

    this.exports = namespace["module.exports"] ?? namespace;
    return;
  }
}

$visibility = "Private";
export function createRequireCache() {
  var moduleMap = new Map();
  var inner = {
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return { ...proxy };
    },
  };
  var proxy = new Proxy(inner, {
    get(_target, key: string) {
      const entry = $requireMap.$get(key);
      if (entry) return entry;

      const namespace = $esmNamespaceForCjs(key);
      if (namespace !== undefined) {
        const mod = $createCommonJSModule(key, namespace, true, undefined);
        $requireMap.$set(key, mod);
        return mod;
      }

      return inner[key];
    },
    set(_target, key: string, value) {
      $requireMap.$set(key, value);
      return true;
    },

    has(_target, key: string) {
      return $requireMap.$has(key) || $esmNamespaceForCjs(key) !== undefined;
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
        if (!array.includes(key)) {
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
      if ($requireMap.$has(key) || $esmNamespaceForCjs(key) !== undefined) {
        return {
          configurable: true,
          enumerable: true,
        };
      }
    },
  });

  return proxy;
}

// `Module.prototype.load(filename)` — used by packages like `requizzle` that
// construct `new Module(...)` directly and expect Node's module-loader shape.
// Mirrors Node's lib/internal/modules/cjs/loader.js `Module.prototype.load`.
$overriddenName = "load";
$visibility = "Private";
export function modulePrototypeLoad(this: JSCommonJSModule, filename: string) {
  // Match Node's `assert(!this.loaded, 'Module already loaded')` so a
  // caller that catches the error and checks `e.code === 'ERR_ASSERTION'`
  // behaves the same way on both runtimes.
  const assert = require("node:assert");
  assert(!this.loaded, "Module already loaded");

  const Module = require("node:module");
  const path = require("node:path");

  // Update `filename`, `path` (= `m_dirname`, drives `__dirname`), and
  // `paths` before dispatching: the .js handler goes through the native
  // evaluate() path, which reads `this.path` for the module's __dirname.
  // Without this, `__dirname` would stay at whatever the constructor was
  // given, not where the file actually lives.
  const dirname = path.dirname(filename);
  this.filename = filename;
  this.path = dirname;
  this.paths = Module._nodeModulePaths(dirname);

  // Find the longest-matching registered extension, mirroring Node's
  // `findLongestRegisteredExtension` in lib/internal/modules/cjs/loader.js.
  // `path.extname` only returns the trailing suffix, so it would miss
  // compound extensions like `.test.js` or `.esm.js`.
  const basename = path.basename(filename);
  const extensions = Module._extensions;
  let handler: any;
  let startDot = basename.indexOf(".");
  while (startDot !== -1 && startDot !== basename.length - 1) {
    // Skip a leading dot so dotfiles like `.gitignore` don't match a
    // handler registered for the full filename. Node's
    // findLongestRegisteredExtension and Bun's native Zig equivalent
    // both do this.
    if (startDot === 0) {
      startDot = basename.indexOf(".", 1);
      continue;
    }
    const suffix = basename.slice(startDot);
    handler = extensions[suffix];
    if (handler) break;
    startDot = basename.indexOf(".", startDot + 1);
  }
  if (!handler) {
    handler = extensions[".js"];
  }

  // Don't let a throw from the handler leave the module permanently
  // marked "loaded" — otherwise a retry would hit the assert above.
  // `module._compile` sets `hasEvaluated=true` before running user code,
  // which is what `loaded` reflects, so we reset it on failure.
  try {
    handler.$call(extensions, this, filename);
  } catch (e) {
    this.loaded = false;
    throw e;
  }

  this.loaded = true;
}

type WrapperMutate = (start: string, end: string) => void;
export function getWrapperArrayProxy(onMutate: WrapperMutate) {
  const wrapper = ["(function(exports,require,module,__filename,__dirname){", "})"];
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
