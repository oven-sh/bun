var $$mod$ = Symbol.for;
var __create = Object.create;
var __descs = Object.getOwnPropertyDescriptors;
var __defProp = Object.defineProperty;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;

// We're disabling Object.freeze because it breaks CJS => ESM and can cause
// issues with Suspense and other things that expect the CJS module namespace
// to be mutable when the ESM module namespace is NOT mutable
// var __objectFreezePolyfill = new WeakSet();

// globalThis.Object.freeze = function freeze(obj) {
//   __objectFreezePolyfill.add(obj);
//   return obj;
// };

// globalThis.Object.isFrozen = function isFrozen(obj) {
//   return __objectFreezePolyfill.has(obj);
// };

export var __markAsModule = (target) =>
  __defProp(target, "__esModule", { value: true, configurable: true });

// lazy require to prevent loading one icon from a design system
export var $$lzy = (target, module, props) => {
  for (let key in props) {
    if (!__hasOwnProp.call(target, key))
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

var tagSymbol = Symbol.for("CommonJSTransformed");
var cjsRequireSymbol = Symbol.for("CommonJS");
export var __commonJS = (cb, name) => {
  var mod;
  var origExports;
  var has_run = false;

  const requireFunction = function load() {
    if (has_run) {
      return mod.exports;
    }

    has_run = true;
    cb(((mod = { exports: {} }), mod), mod.exports);

    var mod_exports = (origExports = mod.exports);

    const kind = typeof mod_exports;

    if ((kind === "object" || kind === "function") && !mod_exports[tagSymbol]) {
      const extensible = Object.isExtensible(mod_exports);
      if (!extensible) {
        // slow path: it's a function we need to wrap
        // example: webpack
        if (kind === "function") {
          mod_exports = function () {
            return origExports.apply(this, arguments);
          };
          Object.setPrototypeOf(mod_exports, __getProtoOf(origExports));
          Object.defineProperties(
            mod_exports,
            Object.getOwnPropertyDescriptors(origExports)
          );
        } else {
          mod_exports = __create(
            __getProtoOf(mod_exports),
            Object.getOwnPropertyDescriptors(mod_exports)
          );
        }
      }

      Object.defineProperty(mod_exports, tagSymbol, {
        value: true,
        enumerable: false,
        configurable: false,
      });

      if (!("default" in mod_exports)) {
        Object.defineProperty(mod_exports, "default", {
          get() {
            return origExports;
          },
          set(v) {
            if (v === mod.exports) return;
            origExports = v;
            return true;
          },
          // enumerable: false is important here
          enumerable: false,
          configurable: true,
        });
      }

      if (!extensible) {
        // can only be frozen if it's not extensible
        if (Object.isFrozen(origExports)) {
          Object.freeze(mod_exports);
        } else {
          Object.preventExtensions(mod_exports);
        }
      }
    }

    return mod_exports;
  };

  requireFunction[cjsRequireSymbol] = 1;
  return requireFunction;
};

export var __cJS2eSM = __commonJS;

export var __internalIsCommonJSNamespace = (namespace) =>
  namespace != null &&
  typeof namespace === "object" &&
  ((namespace.default && namespace.default[cjsRequireSymbol]) ||
    namespace[cjsRequireSymbol]);

// require()
export var __require = (namespace) => {
  if (__internalIsCommonJSNamespace(namespace)) {
    return namespace.default();
  }

  return namespace;
};

// require().default
// this currently does nothing
// get rid of this wrapper once we're more confident we do not need special handling for default
__require.d = (namespace) => {
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
  for (var name in all) {
    __defProp(target, name, {
      get: () => all[name],
      set: (newValue) => (all[name] = newValue),
      enumerable: true,
      configurable: true,
    });
  }
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

function hasAnyProps(obj) {
  for (let key in obj) return true;
  return false;
}

function mergeDefaultProps(props, defaultProps) {
  var result = __create(defaultProps, __descs(props));

  for (let key in defaultProps) {
    if (result[key] !== undefined) continue;

    result[key] = defaultProps[key];
  }
  return result;
}
export var __merge = (props, defaultProps) => {
  return !hasAnyProps(defaultProps)
    ? props
    : !hasAnyProps(props)
    ? defaultProps
    : mergeDefaultProps(props, defaultProps);
};
