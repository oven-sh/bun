var $$mod$ = Symbol.for;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;

export var __markAsModule = (target) =>
  __defProp(target, "__esModule", { value: true });

// lazy require to prevent loading one icon from a design system
export var $$lzy = (target, module, props) => {
  for (let key in props) {
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

export var __commonJS = (cb, name) => {
  var mod = {};
  var has_run = false;

  return {
    [`#init_${name}`]() {
      if (has_run) {
        return mod.exports;
      }
      has_run = true;
      __name(cb);

      mod = { exports: {} };

      cb(mod, mod.exports);

      // If it's a default-only export, don't crash if they call .default on the module
      if (
        typeof mod.exports === "object" &&
        "default" in mod.exports &&
        Object.keys(mod.exports).len === 1
      ) {
        mod.exports = mod.exports.default;
        Object.defineProperty(mod.exports, "default", {
          get() {
            return mod.exports;
          },
          enumerable: true,
        });
        // If it's a namespace export without .default, pretend .default is the same as mod.exports
      } else if (
        typeof mod.exports === "object" &&
        !("default" in mod.exports)
      ) {
        Object.defineProperty(mod.exports, "default", {
          get() {
            return mod.exports;
          },
          enumerable: true,
        });
      }

      return mod.exports;
    },
  }[`#init_${name}`];
};

var require_cache = new WeakMap();

export var __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  RequireFailedError: class {},
};

// __name(
//   __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.RequireFailedError,
//   "RequireFailedError"
// );
// __name(
//   __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.Module,
//   "Module"
// );

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

export var $$m = (package_json_name, module_path, cb) => {
  return __commonJS(cb, `${package_json_name}/${module_path}`);
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
