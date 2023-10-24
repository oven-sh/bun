// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ImportMetaObject.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  var moduleMap = new Map();
  var inner = {};
  return new Proxy(inner, {
    get(target, key: string) {
      const entry = __intrinsic__requireMap.__intrinsic__get(key);
      if (entry) return entry;

      const esm = Loader.registry.__intrinsic__get(key);
      if (esm?.evaluated) {
        const namespace = Loader.getModuleNamespaceObject(esm.module);
        const mod = __intrinsic__createCommonJSModule(key, namespace, true, undefined);
        __intrinsic__requireMap.__intrinsic__set(key, mod);
        return mod;
      }

      return inner[key];
    },
    set(target, key: string, value) {
      __intrinsic__requireMap.__intrinsic__set(key, value);
      return true;
    },

    has(target, key: string) {
      return __intrinsic__requireMap.__intrinsic__has(key) || Boolean(Loader.registry.__intrinsic__get(key)?.evaluated);
    },

    deleteProperty(target, key: string) {
      moduleMap.__intrinsic__delete(key);
      __intrinsic__requireMap.__intrinsic__delete(key);
      Loader.registry.__intrinsic__delete(key);
      return true;
    },

    ownKeys(target) {
      var array = [...__intrinsic__requireMap.__intrinsic__keys()];
      for (const key of Loader.registry.__intrinsic__keys()) {
        if (!array.includes(key) && Loader.registry.__intrinsic__get(key)?.evaluated) {
          __intrinsic__arrayPush(array, key);
        }
      }
      return array;
    },

    // In Node, require.cache has a null prototype
    getPrototypeOf(target) {
      return null;
    },

    getOwnPropertyDescriptor(target, key: string) {
      if (__intrinsic__requireMap.__intrinsic__has(key) || Loader.registry.__intrinsic__get(key)?.evaluated) {
        return {
          configurable: true,
          enumerable: true,
        };
      }
    },
  });
}).$$capture_end$$;
