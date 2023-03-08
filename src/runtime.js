const tagSymbol = Symbol.for("CommonJSTransformed");
const cjsRequireSymbol = Symbol.for("CommonJS");
var __create = Object.create;
var __descs = Object.getOwnPropertyDescriptors;
var __defProp = Object.defineProperty;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;

export var __markAsModule = target => __defProp(target, "__esModule", { value: true, configurable: true });

export var __reExport = (target, mod, copyDefault, desc) => {
  if ((mod && typeof mod === "object") || typeof mod === "function")
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(target, key) && (copyDefault || key !== "default"))
        __defProp(target, key, {
          get: () => mod[key],
          configurable: true,
          enumerable: !(desc = __getOwnPropDesc(mod, key)) || desc.enumerable,
        });
  return target;
};

// lazy require to prevent loading one icon from a design system
export var $$lzy = (target, mod, props) => {
  for (let key in props) {
    if (!__hasOwnProp.call(target, key))
      __defProp(target, key, {
        get: () => mod()[props[key]],
        enumerable: true,
        configurable: true,
      });
  }
  return target;
};

export var __toModule = mod => {
  return __reExport(
    __markAsModule(
      __defProp(
        mod != null ? __create(__getProtoOf(mod)) : {},
        "default",
        mod && mod.__esModule && "default" in mod
          ? { get: () => mod.default, enumerable: true, configurable: true }
          : { value: mod, enumerable: true, configurable: true },
      ),
    ),
    mod,
  );
};

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
          Object.defineProperties(mod_exports, Object.getOwnPropertyDescriptors(origExports));
        } else {
          mod_exports = __create(__getProtoOf(mod_exports), Object.getOwnPropertyDescriptors(mod_exports));
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

export var __internalIsCommonJSNamespace = namespace =>
  namespace != null &&
  typeof namespace === "object" &&
  ((namespace.default && namespace.default[cjsRequireSymbol]) || namespace[cjsRequireSymbol]);

// require()
export var __require = namespace => {
  if (__internalIsCommonJSNamespace(namespace)) {
    return namespace.default();
  }

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
      set: newValue => (all[name] = () => newValue),
    });
};

export var __exportValue = (target, all) => {
  for (var name in all) {
    __defProp(target, name, {
      get: () => all[name],
      set: newValue => (all[name] = newValue),
      enumerable: true,
      configurable: true,
    });
  }
};

export var __exportDefault = (target, value) => {
  __defProp(target, "default", {
    get: () => value,
    set: newValue => (value = newValue),
    enumerable: true,
    configurable: true,
  });
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

export var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if ((decorator = decorators[i])) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

export var __decorateParam = (index, decorator) => (target, key) => decorator(target, key, index);

// Converts the module from CommonJS to ESM
export var __toESM = (mod, isNodeMode) => {
  return __reExport(
    __markAsModule(
      __defProp(
        mod != null ? __create(__getProtoOf(mod)) : {},
        "default",

        // If the importer is not in node compatibility mode and this is an ESM
        // file that has been converted to a CommonJS file using a Babel-
        // compatible transform (i.e. "__esModule" has been set), then forward
        // "default" to the export named "default". Otherwise set "default" to
        // "module.exports" for node compatibility.
        !isNodeMode && mod && mod.__esModule
          ? { get: () => mod.default, enumerable: true }
          : { value: mod, enumerable: true },
      ),
    ),
    mod,
  );
};

// Converts the module from ESM to CommonJS
export var __toCommonJS = /* @__PURE__ */ (cache => {
  return (mod, temp) => {
    return (
      (cache && cache.get(mod)) ||
      ((temp = __reExport(__markAsModule({}), mod, /* copyDefault */ 1)), cache && cache.set(mod, temp), temp)
    );
  };
})(typeof WeakMap !== "undefined" ? new WeakMap() : 0);

export var __esm = (fn, res) =>
  function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])((fn = 0))), res;
  };
