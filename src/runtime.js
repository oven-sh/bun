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
      (__name(cb, `export default ${name}`),
      cb((mod = { exports: {} }), mod.exports),
      __name(mod, name),
      mod),
      // Don't add a name to exports incase it exports "name"
      mod.exports
    );
  };

var require_cache = new WeakMap();

export var __SPEEDY_INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  RequireFailedError: class RequireFailedError {},
};

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
