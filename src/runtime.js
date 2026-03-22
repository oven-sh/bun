// Since runtime.js loads first in the bundler, Ref.none will point at this
// value. And since it isnt exported, it will always be tree-shaken away.
var __INVALID__REF__;

// This ordering is deliberate so that the printer optimizes
// them into a single destructuring assignment.
var __create = Object.create;
var __descs = Object.getOwnPropertyDescriptors;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;

// Shared getter/setter functions: .bind(obj, key) avoids creating a closure
// and JSLexicalEnvironment per property. BoundFunction is much cheaper.
// Must be regular functions (not arrows) so .bind() can set `this`.
function __accessProp(key) {
  return this[key];
}

// This is used to implement "export * from" statements. It copies properties
// from the imported module to the current module's ESM export object. If the
// current module is an entry point and the target format is CommonJS, we
// also copy the properties to "module.exports" in addition to our module's
// internal ESM export object.
export var __reExport = (target, mod, secondTarget) => {
  var keys = __getOwnPropNames(mod);
  for (let key of keys)
    if (!__hasOwnProp.call(target, key) && key !== "default")
      __defProp(target, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true,
      });

  if (secondTarget) {
    for (let key of keys)
      if (!__hasOwnProp.call(secondTarget, key) && key !== "default")
        __defProp(secondTarget, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true,
        });

    return secondTarget;
  }
};

/*__PURE__*/
var __toESMCache_node;
/*__PURE__*/
var __toESMCache_esm;

// Converts the module from CommonJS to ESM. When in node mode (i.e. in an
// ".mjs" file, package.json has "type: module", or the "__esModule" export
// in the CommonJS file is falsy or missing), the "default" property is
// overridden to point to the original CommonJS exports object instead.
export var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? (__toESMCache_node ??= new WeakMap()) : (__toESMCache_esm ??= new WeakMap());
    var cached = cache.get(mod);
    if (cached) return cached;
  }
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
        get: __accessProp.bind(mod, key),
        enumerable: true,
      });

  if (canCache) cache.set(mod, to);
  return to;
};

// Converts the module from ESM to CommonJS. This clones the input module
// object with the addition of a non-enumerable "__esModule" property set
// to "true", which overwrites any existing export named "__esModule".
export var __toCommonJS = from => {
  var entry = (__moduleCache ??= new WeakMap()).get(from),
    desc;
  if (entry) return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if ((from && typeof from === "object") || typeof from === "function")
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  __moduleCache.set(from, entry);
  return entry;
};
/*__PURE__*/
var __moduleCache;

// When you do know the module is CJS
export var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

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
var __returnValue = v => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}

export var __export = /* @__PURE__ */ (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name),
    });
};

function __exportValueSetter(name, newValue) {
  this[name] = newValue;
}

export var __exportValue = (target, all) => {
  for (var name in all) {
    __defProp(target, name, {
      get: __accessProp.bind(all, name),
      set: __exportValueSetter.bind(all, name),
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

function __hasAnyProps(obj) {
  for (let key in obj) return true;
  return false;
}

function __mergeDefaultProps(props, defaultProps) {
  var result = __create(defaultProps, __descs(props));

  for (let key in defaultProps) {
    if (result[key] !== undefined) continue;

    result[key] = defaultProps[key];
  }
  return result;
}
export var __merge = (props, defaultProps) => {
  return !__hasAnyProps(defaultProps)
    ? props
    : !__hasAnyProps(props)
      ? defaultProps
      : __mergeDefaultProps(props, defaultProps);
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
  return (c > 3 && r && Object.defineProperty(target, key, r), r);
};

export var __legacyDecorateParamTS = (index, decorator) => (target, key) => decorator(target, key, index);

export var __legacyMetadataTS = (k, v) => {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};

// Internal helpers for ES decorators
var __knownSymbol = (name, symbol) => ((symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name));
var __typeError = msg => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) =>
  key in obj
    ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value })
    : (obj[key] = value);

// ES decorator helpers
export var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
export var __privateIn = (member, obj) =>
  Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
export var __privateGet = (obj, member, getter) => (
  __accessCheck(obj, member, "read from private field"),
  getter ? getter.call(obj) : member.get(obj)
);
export var __privateAdd = (obj, member, value) =>
  member.has(obj)
    ? __typeError("Cannot add the same private member more than once")
    : member instanceof WeakSet
      ? member.add(obj)
      : member.set(obj, value);
export var __privateSet = (obj, member, value, setter) => (
  __accessCheck(obj, member, "write to private field"),
  setter ? setter.call(obj, value) : member.set(obj, value),
  value
);
export var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

export var __decoratorStart = base => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = fn => (fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn);
var __decoratorContext = (kind, name, done, metadata, fns) => ({
  kind: __decoratorStrings[kind],
  name,
  metadata,
  addInitializer: fn => (done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null))),
});
export var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
export var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++)
    flags & 1 ? fns[i].call(self) : (value = fns[i].call(self, value));
  return value;
};
export var __decorateElement = (array, flags, name, decorators, target, extra) => {
  var fn,
    it,
    done,
    ctx,
    access,
    k = flags & 7,
    s = !!(flags & 8),
    p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? (s ? 1 : 2) : 0,
    key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []),
    extraInitializers = array[j] || (array[j] = []);
  var desc =
    k &&
    (!p && !s && (target = target.prototype),
    k < 5 &&
      (k > 3 || !p) &&
      __getOwnPropDesc(
        k < 4
          ? target
          : {
              get [name]() {
                return __privateGet(this, extra);
              },
              set [name](x) {
                __privateSet(this, extra, x);
              },
            },
        name,
      ));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);

  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name, (done = {}), array[3], extraInitializers);

    if (k) {
      ((ctx.static = s),
        (ctx.private = p),
        (access = ctx.access = { has: p ? x => __privateIn(target, x) : x => name in x }));
      if (k ^ 3)
        access.get = p
          ? x => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get)
          : x => x[name];
      if (k > 2)
        access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => (x[name] = y);
    }

    it = (0, decorators[i])(
      k ? (k < 4 ? (p ? extra : desc[key]) : k > 4 ? void 0 : { get: desc.get, set: desc.set }) : target,
      ctx,
    );
    done._ = 1;

    if (k ^ 4 || it === void 0)
      __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? (p ? (extra = it) : (desc[key] = it)) : (target = it));
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else
      (__expectFn((fn = it.get)) && (desc.get = fn),
        __expectFn((fn = it.set)) && (desc.set = fn),
        __expectFn((fn = it.init)) && initializers.unshift(fn));
  }

  return (
    k || __decoratorMetadata(array, target),
    desc && __defProp(target, name, desc),
    p ? (k ^ 4 ? extra : desc) : target
  );
};

export var __esm = (fn, res) => () => (fn && (res = fn((fn = 0))), res);

// This is used for JSX inlining with React.
export var $$typeof = /* @__PURE__ */ Symbol.for("react.element");

export var __jsonParse = /* @__PURE__ */ a => JSON.parse(a);

export var __promiseAll = args => Promise.all(args);
