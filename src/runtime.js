// Since runtime.js loads first in the bundler, Ref.none will point at this
// value. And since it isnt exported, it will always be tree-shaken away.
var __INVALID__REF__;

var tagSymbol;
var cjsRequireSymbol;
// This ordering is deliberate so that the printer does optimizes these into a
// single destructuring assignment.
var __create = Object.create;
var __descs = Object.getOwnPropertyDescriptors;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;

export var __markAsModule = target => __defProp(target, "__esModule", { value: true, configurable: true });

// This is used to implement "export * from" statements. It copies properties
// from the imported module to the current module's ESM export object. If the
// current module is an entry point and the target format is CommonJS, we
// also copy the properties to "module.exports" in addition to our module's
// internal ESM export object.
export var __reExport = (target, mod, secondTarget) => {
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(target, key) && key !== "default")
      __defProp(target, key, {
        get: () => mod[key],
        enumerable: true,
      });

  if (secondTarget) {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(secondTarget, key) && key !== "default")
        __defProp(secondTarget, key, {
          get: () => mod[key],
          enumerable: true,
        });

    return secondTarget;
  }
};

// Converts the module from CommonJS to ESM. When in node mode (i.e. in an
// ".mjs" file, package.json has "type: module", or the "__esModule" export
// in the CommonJS file is falsy or missing), the "default" property is
// overridden to point to the original CommonJS exports object instead.
export var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to =
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;

  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true,
      });

  return to;
};

// Converts the module from ESM to CommonJS. This clones the input module
// object with the addition of a non-enumerable "__esModule" property set
// to "true", which overwrites any existing export named "__esModule".
var __moduleCache = /* @__PURE__ */ new WeakMap();
export var __toCommonJS = /* @__PURE__ */ from => {
  var entry = __moduleCache.get(from),
    desc;
  if (entry) return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if ((from && typeof from === "object") || typeof from === "function")
    __getOwnPropNames(from).map(
      key =>
        !__hasOwnProp.call(entry, key) &&
        __defProp(entry, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        }),
    );
  __moduleCache.set(from, entry);
  return entry;
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

// When you do know the module is CJS
export var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// When you don't know if the module is going to be ESM or CJS
export var __cJS2eSM = (cb, name) => {
  var mod;
  var origExports;
  var has_run = false;
  tagSymbol ??= Symbol.for("CommonJSTransformed");
  cjsRequireSymbol ??= Symbol.for("CommonJS");

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

export var __internalIsCommonJSNamespace = /* @__PURE__ */ namespace =>
  namespace != null &&
  typeof namespace === "object" &&
  ((namespace.default && namespace.default[cjsRequireSymbol]) || namespace[cjsRequireSymbol]);

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

export var __export = /* @__PURE__ */ (target, all) => {
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

export var __legacyDecorateClassTS = function (decorators, target, key, desc) {
  var c = arguments.length,
    r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
    d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
    r = Reflect.decorate(decorators, target, key, desc);
  else
    for (var i = decorators.length - 1; i >= 0; i--)
      if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};

export var __legacyDecorateParamTS = (index, decorator) => (target, key) => decorator(target, key, index);

export var __legacyMetadataTS = (k, v) => {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};

export var __esm = (fn, res) => () => (fn && (res = fn((fn = 0))), res);

// This is used for JSX inlining with React.
export var $$typeof = /* @__PURE__ */ Symbol.for("react.element");
