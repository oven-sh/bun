var $$mod$ = Symbol.for;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;

export var __markAsModule = (target) =>
  __defProp(target, "__esModule", { value: true, configurable: true });

// lazy require to prevent loading one icon from a design system
export var $$lzy = (target, module, props) => {
  for (let key in props) {
    if (!__hasOwnProp.call(target, key) && key !== "default")
      __defProp(target, key, {
        get: () => module()[props[key]],
        enumerable: true,
        configurable: true,
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
          ? { get: () => module.default, enumerable: true, configurable: true }
          : { value: module, enumerable: true, configurable: true }
      )
    ),
    module
  );
};

var tagSymbol = Symbol("CommonJSTransformed");
var cjsRequireSymbol = Symbol("CommonJS");
export var __commonJS = (cb, name) => {
  var mod = {};
  var has_run = false;

  const requireFunction = function load() {
    if (has_run) {
      return mod.exports;
    }
    has_run = true;

    mod = { exports: {} };

    cb(mod, mod.exports);

    const kind = typeof mod.exports;

    // If it's a default-only export, don't crash if they call .default on the module
    if (
      kind === "object" &&
      "default" in mod.exports &&
      !mod.exports[tagSymbol] &&
      Object.keys(mod.exports).length === 1
    ) {
      // if mod.exports.default === true this won't work because we can't define a property on a boolean
      if (
        typeof mod.exports.default === "object" ||
        typeof mod.exports.default === "function"
      ) {
        mod.exports = mod.exports.default;

        Object.defineProperty(mod.exports, "default", {
          get() {
            return mod.exports;
          },
          enumerable: true,
          configurable: true,
        });
      }

      // If it's a namespace export without .default, pretend .default is the same as mod.exports
    } else if (
      (kind === "function" || kind === "object") &&
      !("default" in mod.exports)
    ) {
      var defaultValue = mod.exports;
      Object.defineProperty(mod.exports, "default", {
        get() {
          return defaultValue;
        },
        set(value) {
          defaultValue = value;
        },
        enumerable: true,
        configurable: true,
      });
    }

    if (kind === "object" && !mod.exports[tagSymbol]) {
      Object.defineProperty(mod.exports, tagSymbol, {
        value: true,
        enumerable: false,
        configurable: false,
      });
    }

    return mod.exports;
  };

  requireFunction[cjsRequireSymbol] = true;
  return requireFunction;
};

export var __cJS2eSM = __commonJS;

var require_cache = new WeakMap();

export var __BUN_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  RequireFailedError: class {},
};

// __name(
//   __BUN_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.RequireFailedError,
//   "RequireFailedError"
// );
// __name(
//   __BUN_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__MODULE_LOAD_CACHE.Module,
//   "Module"
// );

export var __require = (namespace) => {
  const namespaceType = typeof namespace;
  if (namespaceType === "function" && namespace[cjsRequireSymbol])
    return namespace();

  if (
    namespaceType === "object" &&
    "default" in namespace &&
    namespace.default[cjsRequireSymbol]
  )
    return namespace.default();

  return namespace;
};

export var $$m = __commonJS;

export var __name = (target, name) => {
  Object.defineProperty(target, "name", {
    value: name,
    enumerable: false,
    configurable: true,
  });

  return target;
};

// ESM export -> CJS export
// except, writable incase something re-exports
export var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => (all[name] = () => newValue),
    });
};

export var __exportValue = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: () => all[name],
      set: (newValue) => (all[name] = newValue),
      enumerable: true,
      configurable: true,
    });
};

export var __exportDefault = (target, value) => {
  __defProp(target, "default", {
    get: () => value,
    set: (newValue) => (value = newValue),
    enumerable: true,
    configurable: true,
  });
};

export var __reExport = (target, module, desc) => {
  if ((module && typeof module === "object") || typeof module === "function")
    for (let key of __getOwnPropNames(module))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, {
          get: () => module[key],
          configurable: true,
          enumerable:
            !(desc = __getOwnPropDesc(module, key)) || desc.enumerable,
        });
  return target;
};

if (typeof globalThis.process === "undefined") {
  globalThis.process = {
    env: {},
  };
}
