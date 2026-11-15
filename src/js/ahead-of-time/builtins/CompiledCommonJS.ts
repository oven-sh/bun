// Functions of compiled programs alone: native code makes them where the program was compiled, and `bun run` never enters them.
// They belong to the CommonJS module loader (CommonJS.ts).

// Called by native code with a `module.children` value that script has read or assigned.
$visibility = "Private";
export function pushObservableChild(children: JSCommonJSModule[] | undefined, child: JSCommonJSModule) {
  if (children && children.indexOf(child) === -1) {
    children.push(child);
  }
}

$visibility = "Private";
export function createRequireCacheOverCompiledProgram(requireMap: RequireMap, owner?: JSCommonJSModule) {
  var inner = {
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return { ...proxy };
    },
  };
  const isBuiltinKey = (key: string | symbol) =>
    typeof key === "string" && (key.startsWith("node:") || key.startsWith("bun:"));
  // An executable that `bun build --compile --aot` made never lists its own files, which run once: the cache holds the files that were loaded from outside of the executable, as in a bundled executable.
  const hidesFiles = $isHiddenFromRequireCache();
  const isHidden = (key: string | symbol) => hidesFiles && $isHiddenFromRequireCache(key);
  const isRequiredCompiledBuiltin = (key: string) => $requireCacheCompiledEntry(key, owner, true) === true;
  const hasKey = (key: string) =>
    !(hidesFiles && $isHiddenFromRequireCache(key)) &&
    (requireMap.$has(key) ||
      (isBuiltinKey(key) ? isRequiredCompiledBuiltin(key) : $esmRegistryHasEvaluated(key, owner)));
  var proxy = new Proxy(inner, {
    get(_target, key: string) {
      const hidden = hidesFiles && $isHiddenFromRequireCache(key);
      if (hidden) return undefined;
      const entry = requireMap.$get(key);
      if (entry) return entry;
      if (hidden !== undefined) {
        const compiled = $requireCacheCompiledEntry(key, owner);
        if (compiled) return compiled;
      }

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
      $requireCacheDidDelete(key, owner);
      requireMap.$delete(key);
      $esmRegistryDelete(key, owner);
      $evictIsolationSourceProviderCache(key);
      return true;
    },

    ownKeys(_target) {
      var array = [...requireMap.$keys()];
      for (const key of $esmRegistryEvaluatedKeys(owner)) {
        if ((!isBuiltinKey(key) || isRequiredCompiledBuiltin(key)) && !requireMap.$has(key)) {
          $arrayPush(array, key);
        }
      }
      if (!hidesFiles) return array;
      var shown: string[] = [];
      for (var index = 0; index < array.length; index++) {
        if (!isHidden(array[index])) $arrayPush(shown, array[index]);
      }
      return shown;
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
