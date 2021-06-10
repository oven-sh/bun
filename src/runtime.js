var $$mod$ = Symbol.for;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;

export var __markAsModule = (target) =>
  __defProp(target, "__esModule", { value: true });

export var __reExport = (target, module, desc) => {
  if ((module && typeof module === "object") || typeof module === "function") {
    for (let key of __getOwnPropNames(module))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, {
          get: () => module[key],
          enumerable:
            !(desc = __getOwnPropDesc(module, key)) || desc.enumerable,
        });
  }
  return target;
};

export var $$lz = (target, module, props) => {
  for (key in props) {
    if (!__hasOwnProp.call(target, key) && key !== "default")
      __defProp(target, key, {
        get: () => module()[props[key]],
        enumerable: true,
      });
  }
  return target;
};

export var __toModule = (module) => {
  return __reExport(
    __markAsModule(
      __defProp(
        module != null ? __create(__getProtoOf(module)) : {},
        "default",
        module && module.__esModule && "default" in module
          ? { get: () => module.default, enumerable: true }
          : { value: module, enumerable: true }
      )
    ),
    module
  );
};

export var __commonJS =
  (cb, name, mod = {}) =>
  () => {
    return (
      mod,
      // friendly name for any errors while requiring
      (__name(cb, name),
      cb((mod = { exports: {} }), mod.exports),
      __name(mod, name),
      mod),
      // Don't add a name to exports incase it exports "name"
      mod.exports
    );
  };

var require_cache = new WeakMap();

export var __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  RequireFailedError: class {},
};

__name(
  __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.RequireFailedError,
  "RequireFailedError"
);
__name(
  __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.Module,
  "Module"
);

export var __require = (namespace) => {
  var entry = require_cache.get(namespace);
  if (typeof entry !== "undefined") {
    return entry;
  }

  var target =
    Object.prototype.hasOwnProperty.call(namespace, "default") &&
    Object.keys(namespace).length === 1
      ? namespace["default"]
      : namespace;

  if (typeof target !== "function") {
    throw new __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.RequireFailedError(
      `Couldn't find module "${
        typeof namespace === "string"
          ? namespace
          : namespace.name || namespace.displayName || namespace.toString()
      }"`
    );
  }

  var exports = target();
  require_cache.set(namespace, exports);
  return exports;
};

if (
  !(
    "__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE" in
    globalThis
  )
) {
  globalThis.__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE =
    new Map();
}

if (
  !(
    "__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_REGISTRY" in
    globalThis
  )
) {
  globalThis.__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_REGISTRY =
    new Map();
}

// Like require() but accepts:
// - package_json_hash
// - package_json_name
// - module_path
// This locks the require to a specific package version
// This is also slightly faster to generate since we don't need to allocate additional strings
// for import paths
export var $$r = (package_json_hash, package_json_name, module_path) => {
  // Symbol is useful here because it gives us:
  // - A built-in "description" property for providing friendlier errors. Potentially shared across multiple tabs depending on engine implementaion, saving a little memory.
  // - Guranteed uniqueness, letting the JS engine deal with mapping import paths to unique identifiers instead of us
  // - Relatively cheap in-memory size, costs one machine word
  // - Shouldn't cause de-opts from mixing short strings and long strings
  // - auto-incrementing integer ID is an alternative, but a stable key means we don't worry about generating a manifest ahead of time and we don't worry about the order of the module declarations
  return __load(
    // The displayed description is everything after the first slash
    Symbol.for(`${package_json_hash}/${package_json_name}/${module_path}`)
  );
};

export var __load = (id) => {
  if (
    globalThis.__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.has(
      id
    )
  ) {
    return globalThis.__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.get(
      id
    );
  }

  const namespace =
    globalThis.__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_REGISTRY.get(
      id
    );

  const target =
    Object.prototype.hasOwnProperty.call(namespace, "default") &&
    Object.keys(namespace).length === 1
      ? namespace["default"]
      : namespace;

  if (typeof target !== "function") {
    throw new __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.RequireFailedError(
      `Couldn't find module "${namespace.description.substring(
        namespace.description.indexOf("/") + 1
      )}"`
    );
  }

  globalThis.__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.set(
    id,
    target()
  );

  // It might be slightly slower to do this extra get, but only returning from the map
  // might be a better hint to a JS engine that "target" doesn't escape this function
  return globalThis.__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.get(
    id
  );
};

export var $$m = (package_json_hash, package_json_name, module_path, cb) => {
  globalThis.__SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_REGISTRY.set(
    Symbol.for(`${package_json_hash}/${package_json_name}/${module_path}`),
    __commonJS(cb, `${package_json_name}/${module_path}`)
  );
};

export var __name = (target, name) => {
  Object.defineProperty(target, "name", {
    value: name,
    enumerable: false,
    configurable: true,
  });

  return target;
};

export const __esModule = true;

// Used to implement ES6 exports to CommonJS
export var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

export var __reExport = (target, module, desc) => {
  if ((module && typeof module === "object") || typeof module === "function")
    for (let key of __getOwnPropNames(module))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, {
          get: () => module[key],
          enumerable:
            !(desc = __getOwnPropDesc(module, key)) || desc.enumerable,
        });
  return target;
};
