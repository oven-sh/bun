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
  // An external CommonJS re-export target may set "module.exports" to null,
  // undefined, or a primitive; only objects and functions have named exports.
  var keys = (mod && typeof mod === "object") || typeof mod === "function" ? __getOwnPropNames(mod) : [];
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
  // A CommonJS module may legitimately set "module.exports" to null,
  // undefined, or a primitive; only objects and functions have named exports.
  if ((mod && typeof mod === "object") || typeof mod === "function")
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

// React Compiler memo-cache slot sentinels.
export var __MEMO_CACHE_SENTINEL = /* @__PURE__ */ Symbol.for("react.memo_cache_sentinel");
export var __EARLY_RETURN_SENTINEL = /* @__PURE__ */ Symbol.for("react.early_return_sentinel");

// Runtime for the zod transform (src/js_parser/zod.rs): __zod(thunk, irJson, refs) returns a schema stand-in whose own parse/safeParse/parseAsync/safeParseAsync run a validator compiled from the IR.

// Touching anything else (.shape, ._zod, .extend, instanceof via zod's Symbol.hasInstance, ...) calls the thunk and upgrades the stand-in in place into the real schema.

// The validator only proves success: any failed check, unsupported construct, refinement Promise, or explicit parse params re-runs through zod, so error objects, custom messages, catch values, and async validation are always zod's own. Invariant: a fast-path success must match zod's success, value aliasing included.

var __zodStateSymbol;
var __zodFail = {};
var __zodCompileCache;
var __zodProtoHandler;

function __zodState(x) {
  // Own symbol property; reading it never hits the lazy prototype proxy.
  return x[__zodStateSymbol];
}

// Each wrapper's prototype is a Proxy whose target carries the wrapper and its state; after materialization the prototype is swapped to the real schema's, so traps cannot re-enter.
function __zodGetProtoHandler() {
  return (__zodProtoHandler ??= {
    get(t, key) {
      // `await schema` / Promise.resolve(schema) probes "then"; answer without materializing.
      if (key === "then") return undefined;
      __zodMaterialize(t.s, t.w);
      return t.w[key];
    },
    has(t, key) {
      if (key === "then") return false;
      __zodMaterialize(t.s, t.w);
      return key in t.w;
    },
    // Fires when a prototype walk passes through (ordinary instanceof, nested getPrototypeOf).
    getPrototypeOf(t) {
      __zodMaterialize(t.s, t.w);
      return Object.getPrototypeOf(t.w);
    },
  });
}

function __zodMaterialize(state, wrapper) {
  var real = state.real;
  if (real !== undefined) return real;
  real = (0, state.thunk)();
  if (real === null || typeof real !== "object" || !real._zod) {
    throw new TypeError("zod transform: thunk did not produce a schema");
  }
  state.real = real;
  // Upgrade in place: copy the real schema's own property descriptors (parse closures, non-enumerable _zod) and adopt its prototype.
  var keys = Reflect.ownKeys(real);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    Object.defineProperty(wrapper, k, Object.getOwnPropertyDescriptor(real, k));
  }
  Object.setPrototypeOf(wrapper, Object.getPrototypeOf(real));
  return real;
}

function __zodEnsureCompiled(state) {
  var json = state.ir;
  var cache = (__zodCompileCache ??= new Map());
  var fn = cache.get(json);
  if (fn === undefined) {
    fn = null;
    try {
      var root = JSON.parse(json);
      if (root && root.v === 1) {
        fn = __zodCompile(root.n);
      }
    } catch {
      fn = null;
    }
    cache.set(json, fn);
  }
  state.compiled = fn;
  return fn;
}

function __zodRun(state, wrapper, data, params, mode) {
  if (state.real === undefined && params === undefined) {
    var compiled = state.compiled;
    if (compiled === undefined) compiled = __zodEnsureCompiled(state);
    if (compiled !== null) {
      var r = compiled(data, state.refs);
      if (r !== __zodFail) {
        return mode & 1 ? { success: true, data: r } : r;
      }
    }
  }
  var real = __zodMaterialize(state, wrapper);
  switch (mode) {
    case 0:
      return real.parse(data, params);
    case 1:
      return real.safeParse(data, params);
    case 2:
      return real.parseAsync(data, params);
    default:
      return real.safeParseAsync(data, params);
  }
}

export var __zod = (thunk, ir, refs) => {
  __zodStateSymbol ??= Symbol.for("__bunZodLazy");
  var state = {
    thunk,
    ir,
    refs: refs || [],
    node: undefined,
    compiled: undefined,
    real: undefined,
  };
  var wrapper = {
    parse: (data, params) => __zodRun(state, wrapper, data, params, 0),
    safeParse: (data, params) => __zodRun(state, wrapper, data, params, 1),
    parseAsync: async (data, params) => __zodRun(state, wrapper, data, params, 2),
    safeParseAsync: async (data, params) => __zodRun(state, wrapper, data, params, 3),
  };
  wrapper[__zodStateSymbol] = state;
  Object.setPrototypeOf(wrapper, new Proxy({ s: state, w: wrapper }, __zodGetProtoHandler()));
  return wrapper;
};

// IR compiler: each node becomes fn(value, refs) -> value | __zodFail; fail means "let the real schema decide", never "invalid".

function __zodIsObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Mirrors zod's util.isPlainObject (used by z.record).
function __zodIsPlainObject(o) {
  if (!__zodIsObject(o)) return false;
  var ctor = o.constructor;
  if (ctor === undefined) return true;
  if (typeof ctor !== "function") return true;
  var prot = ctor.prototype;
  if (!__zodIsObject(prot)) return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
  return true;
}

// Mirrors zod's util.floatSafeRemainder.
function __zodFloatSafeRemainder(val, step) {
  var ratio = val / step;
  var rounded = Math.round(ratio);
  var tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - rounded) < tolerance) return 0;
  return ratio - rounded;
}

// Mirrors zod's util.shallowClone (default values are cloned per use).
function __zodShallowClone(o) {
  if (__zodIsPlainObject(o)) return { ...o };
  if (Array.isArray(o)) return [...o];
  if (o instanceof Map) return new Map(o);
  if (o instanceof Set) return new Set(o);
  return o;
}

// Static optionality from the IR, mirroring _zod.optin/_zod.optout; null = depends on a runtime ref.
function __zodOptIn(n) {
  switch (n.k) {
    case "opt":
      return true;
    case "def":
    case "catch":
      return true;
    case "nul":
      return __zodOptIn(n.i);
    case "rfn":
      return __zodOptIn(n.i);
    case "uni":
    case "dun": {
      var any = false;
      for (var i = 0; i < n.o.length; i++) {
        var o = __zodOptIn(n.o[i]);
        if (o === null) return null;
        if (o) any = true;
      }
      return any;
    }
    case "ref":
      return null;
    default:
      return false;
  }
}

function __zodOptOut(n) {
  switch (n.k) {
    case "opt":
      return true;
    case "def":
      return false;
    case "catch":
      return __zodOptOut(n.i);
    case "nul":
      return __zodOptOut(n.i);
    case "rfn":
      return __zodOptOut(n.i);
    case "uni":
    case "dun": {
      var any = false;
      for (var i = 0; i < n.o.length; i++) {
        var o = __zodOptOut(n.o[i]);
        if (o === null) return null;
        if (o) any = true;
      }
      return any;
    }
    case "ref":
      return null;
    default:
      return false;
  }
}

// Whether a __zodFail from this node proves zod rejects the input; only past such failures may a union try its next option.
function __zodConclusive(n) {
  switch (n.k) {
    case "str":
    case "num":
    case "bool":
    case "big":
    case "date": {
      // Coercion wraps a possibly-throwing conversion in try/catch, masking throws zod would propagate.
      if (n.co === 1) return false;
      var cs = n.c;
      if (cs) {
        // A runtime regex ref may not be a real RegExp; zod calls whatever .test it has.
        for (var ci = 0; ci < cs.length; ci++) if (cs[ci][0] === "rer") return false;
      }
      return true;
    }
    case "lit":
    case "undef":
    case "void":
    case "null":
    case "any":
    case "unk":
    case "never":
    case "nan":
      return true;
    case "enum":
      return n.r === undefined;
    case "opt":
    case "nul":
    case "non":
    case "def":
      return __zodConclusive(n.i);
    case "obj": {
      for (var pi = 0; pi < n.p.length; pi++) if (!__zodConclusive(n.p[pi][1])) return false;
      return n.ca === undefined || n.ca.k === "never" || __zodConclusive(n.ca);
    }
    case "arr":
      return __zodConclusive(n.i);
    case "tup": {
      for (var ti = 0; ti < n.it.length; ti++) if (!__zodConclusive(n.it[ti])) return false;
      return n.rest === undefined || __zodConclusive(n.rest);
    }
    case "rec":
      return __zodConclusive(n.v);
    case "uni":
    case "dun": {
      for (var ui = 0; ui < n.o.length; ui++) if (!__zodConclusive(n.o[ui])) return false;
      return true;
    }
    default:
      // catch (inner failure means zod succeeds), rfn (Promise), ref, opq: a failure proves nothing.
      return false;
  }
}

// Runtime optionality for ref children: wrappers answer from their IR, real schemas from _zod; materializes opaque wrappers.
function __zodRefOpt(child, out) {
  if (child !== null && (typeof child === "object" || typeof child === "function")) {
    var state = __zodState(child);
    if (state && state.real === undefined) {
      var node = state.node;
      if (node === undefined) {
        try {
          var root = JSON.parse(state.ir);
          node = state.node = root && root.v === 1 ? root.n : null;
        } catch {
          node = state.node = null;
        }
      }
      if (node !== null && node.k !== "opq") {
        var r = out ? __zodOptOut(node) : __zodOptIn(node);
        if (r !== null) return r;
      }
      __zodMaterialize(state, child);
    }
    var zi = child._zod;
    if (zi) return (out ? zi.optout : zi.optin) === "optional";
  }
  return false;
}

// Runs a ref child (wrapper fast path, or a real schema's `_zod.run`).
function __zodRunRef(child, v) {
  if (child === null || (typeof child !== "object" && typeof child !== "function")) {
    return __zodFail;
  }
  var state = __zodState(child);
  if (state && state.real === undefined) {
    var compiled = state.compiled;
    if (compiled === undefined) compiled = __zodEnsureCompiled(state);
    if (compiled !== null) {
      return compiled(v, state.refs);
    }
    __zodMaterialize(state, child);
  }
  var zi = child._zod;
  if (!zi) return __zodFail;
  var result = zi.run({ value: v, issues: [] }, { async: false });
  if (result instanceof Promise) return __zodFail;
  if (result.issues.length !== 0) return __zodFail;
  return result.value;
}

function __zodNum(spec, refs) {
  return typeof spec === "number" ? spec : refs[spec.r];
}

function __zodStr(spec, refs) {
  return typeof spec === "string" ? spec : refs[spec.r];
}

// Ordered checks for a primitive/array node, applying overwrites in sequence; null when a check does not fit the node kind (broken schemas defer their construction error to materialization).
function __zodCompileChecks(kind, checks) {
  if (!checks || checks.length === 0) return null;
  var fns = [];
  for (var i = 0; i < checks.length; i++) {
    var c = checks[i];
    var tag = c[0];
    var fn = null;
    switch (tag) {
      case "gte":
        if (kind === "num" || kind === "big" || kind === "date") {
          fn = (spec => (v, refs) => (v >= __zodNum(spec, refs) ? v : __zodFail))(c[1]);
        }
        break;
      case "lte":
        if (kind === "num" || kind === "big" || kind === "date") {
          fn = (spec => (v, refs) => (v <= __zodNum(spec, refs) ? v : __zodFail))(c[1]);
        }
        break;
      case "gt":
        if (kind === "num" || kind === "big" || kind === "date") {
          fn = (spec => (v, refs) => (v > __zodNum(spec, refs) ? v : __zodFail))(c[1]);
        }
        break;
      case "lt":
        if (kind === "num" || kind === "big" || kind === "date") {
          fn = (spec => (v, refs) => (v < __zodNum(spec, refs) ? v : __zodFail))(c[1]);
        }
        break;
      case "mof":
        if (kind === "num") {
          fn = (spec => (v, refs) => (__zodFloatSafeRemainder(v, __zodNum(spec, refs)) === 0 ? v : __zodFail))(c[1]);
        }
        break;
      case "int":
        if (kind === "num") {
          fn = v => (Number.isInteger(v) && Number.isSafeInteger(v) ? v : __zodFail);
        }
        break;
      case "minl":
        if (kind === "str" || kind === "arr") {
          fn = (spec => (v, refs) => (v.length >= __zodNum(spec, refs) ? v : __zodFail))(c[1]);
        }
        break;
      case "maxl":
        if (kind === "str" || kind === "arr") {
          fn = (spec => (v, refs) => (v.length <= __zodNum(spec, refs) ? v : __zodFail))(c[1]);
        }
        break;
      case "lenl":
        if (kind === "str" || kind === "arr") {
          fn = (spec => (v, refs) => (v.length === __zodNum(spec, refs) ? v : __zodFail))(c[1]);
        }
        break;
      case "re":
        if (kind === "str") {
          var re;
          try {
            re = new RegExp(c[1], c[2]);
          } catch {
            return null;
          }
          fn = (pattern => v => {
            pattern.lastIndex = 0;
            return pattern.test(v) ? v : __zodFail;
          })(re);
        }
        break;
      case "rer":
        if (kind === "str") {
          fn = (idx => (v, refs) => {
            var pattern = refs[idx];
            if (!(pattern instanceof RegExp)) return __zodFail;
            pattern.lastIndex = 0;
            return pattern.test(v) ? v : __zodFail;
          })(c[1]);
        }
        break;
      case "sw":
        if (kind === "str") {
          fn = (spec => (v, refs) => (v.startsWith(__zodStr(spec, refs)) ? v : __zodFail))(c[1]);
        }
        break;
      case "ew":
        if (kind === "str") {
          fn = (spec => (v, refs) => (v.endsWith(__zodStr(spec, refs)) ? v : __zodFail))(c[1]);
        }
        break;
      case "inc":
        if (kind === "str") {
          fn = (spec => (v, refs) => (v.includes(__zodStr(spec, refs)) ? v : __zodFail))(c[1]);
        }
        break;
      case "lc":
        if (kind === "str") fn = v => (v === v.toLowerCase() ? v : __zodFail);
        break;
      case "uc":
        if (kind === "str") fn = v => (v === v.toUpperCase() ? v : __zodFail);
        break;
      case "trim":
        if (kind === "str") fn = v => v.trim();
        break;
      case "tlc":
        if (kind === "str") fn = v => v.toLowerCase();
        break;
      case "tuc":
        if (kind === "str") fn = v => v.toUpperCase();
        break;
      case "norm":
        if (kind === "str") fn = v => v.normalize();
        break;
    }
    if (fn === null) return null;
    fns.push(fn);
  }
  if (fns.length === 1) return fns[0];
  return (v, refs) => {
    for (var j = 0; j < fns.length; j++) {
      v = fns[j](v, refs);
      if (v === __zodFail) return __zodFail;
    }
    return v;
  };
}

function __zodCompile(n) {
  switch (n.k) {
    case "str": {
      var strChecks = __zodCompileChecks("str", n.c);
      if (n.c && n.c.length !== 0 && strChecks === null) return null;
      var strCoerce = n.co === 1;
      return (v, refs) => {
        if (strCoerce) {
          try {
            v = String(v);
          } catch {}
        }
        if (typeof v !== "string") return __zodFail;
        return strChecks === null ? v : strChecks(v, refs);
      };
    }
    case "num": {
      var numChecks = __zodCompileChecks("num", n.c);
      if (n.c && n.c.length !== 0 && numChecks === null) return null;
      var numCoerce = n.co === 1;
      return (v, refs) => {
        if (numCoerce) {
          try {
            v = Number(v);
          } catch {}
        }
        if (typeof v !== "number" || Number.isNaN(v) || !Number.isFinite(v)) return __zodFail;
        return numChecks === null ? v : numChecks(v, refs);
      };
    }
    case "bool": {
      var boolCoerce = n.co === 1;
      return v => {
        if (boolCoerce) v = Boolean(v);
        return typeof v === "boolean" ? v : __zodFail;
      };
    }
    case "big": {
      var bigChecks = __zodCompileChecks("big", n.c);
      if (n.c && n.c.length !== 0 && bigChecks === null) return null;
      var bigCoerce = n.co === 1;
      return (v, refs) => {
        if (bigCoerce) {
          try {
            v = BigInt(v);
          } catch {}
        }
        if (typeof v !== "bigint") return __zodFail;
        return bigChecks === null ? v : bigChecks(v, refs);
      };
    }
    case "date": {
      var dateChecks = __zodCompileChecks("date", n.c);
      if (n.c && n.c.length !== 0 && dateChecks === null) return null;
      var dateCoerce = n.co === 1;
      return (v, refs) => {
        if (dateCoerce) {
          try {
            v = new Date(v);
          } catch {}
        }
        if (!(v instanceof Date) || Number.isNaN(v.getTime())) return __zodFail;
        return dateChecks === null ? v : dateChecks(v, refs);
      };
    }
    case "lit": {
      var litSet = new Set(n.vs);
      if (n.u === 1) litSet.add(undefined);
      var litRefs = n.rs || null;
      return (v, refs) => {
        if (litSet.has(v)) return v;
        if (litRefs !== null) {
          for (var i = 0; i < litRefs.length; i++) {
            var lv = refs[litRefs[i]];
            if (lv === v || (lv !== lv && v !== v)) return v;
          }
        }
        return __zodFail;
      };
    }
    case "enum": {
      if (n.r !== undefined) {
        var enumIdx = n.r;
        return (v, refs) => {
          var arr = refs[enumIdx];
          if (!Array.isArray(arr)) return __zodFail;
          return arr.includes(v) ? v : __zodFail;
        };
      }
      var enumSet = new Set(n.vs);
      return v => (enumSet.has(v) ? v : __zodFail);
    }
    case "undef":
    case "void":
      return v => (v === undefined ? v : __zodFail);
    case "null":
      return v => (v === null ? v : __zodFail);
    case "any":
    case "unk":
      return v => v;
    case "never":
      return () => __zodFail;
    case "nan":
      return v => (typeof v === "number" && Number.isNaN(v) ? v : __zodFail);
    case "opt": {
      var optInner = __zodCompile(n.i);
      if (optInner === null) return null;
      var optInnerOptIn = __zodOptIn(n.i);
      var optInnerConc = __zodConclusive(n.i);
      var optInnerNode = n.i;
      return (v, refs) => {
        var innerOptIn = optInnerOptIn;
        if (innerOptIn === null) {
          innerOptIn = optInnerNode.k === "ref" ? __zodRefOpt(refs[optInnerNode.r], false) : false;
        }
        if (innerOptIn) {
          // Mirrors $ZodOptional handleOptionalResult: run the inner type first; a conclusive failure on undefined input collapses to undefined.
          var r = optInner(v, refs);
          if (r === __zodFail) {
            if (!optInnerConc) return __zodFail;
            return v === undefined ? undefined : __zodFail;
          }
          return r;
        }
        if (v === undefined) return undefined;
        return optInner(v, refs);
      };
    }
    case "nul": {
      var nulInner = __zodCompile(n.i);
      if (nulInner === null) return null;
      return (v, refs) => (v === null ? null : nulInner(v, refs));
    }
    case "non": {
      var nonInner = __zodCompile(n.i);
      if (nonInner === null) return null;
      return (v, refs) => {
        var r = nonInner(v, refs);
        if (r === __zodFail || r === undefined) return __zodFail;
        return r;
      };
    }
    case "def": {
      var defInner = __zodCompile(n.i);
      if (defInner === null) return null;
      var defIsPrefault = n.pf === 1;
      var defRef = n.r;
      var defParsed = defRef === undefined ? n.v : undefined;
      var getDefault = refs => {
        // Mirrors zod's defaultValue getter: functions are invoked, values shallow-cloned, on every access.
        var dv = defRef === undefined ? defParsed : refs[defRef];
        return typeof dv === "function" ? dv() : __zodShallowClone(dv);
      };
      if (defIsPrefault) {
        return (v, refs) => {
          if (v === undefined) v = getDefault(refs);
          return defInner(v, refs);
        };
      }
      return (v, refs) => {
        if (v === undefined) return getDefault(refs);
        var r = defInner(v, refs);
        if (r === __zodFail) return __zodFail;
        if (r === undefined) return getDefault(refs);
        return r;
      };
    }
    case "catch": {
      var catchInner = __zodCompile(n.i);
      if (catchInner === null) return null;
      // Inner success passes through; inner failure needs zod's finalized error for the catch callback, so it delegates.
      return (v, refs) => catchInner(v, refs);
    }
    case "rfn": {
      var rfnInner = __zodCompile(n.i);
      if (rfnInner === null) return null;
      var rfnIdx = n.r;
      return (v, refs) => {
        var r = rfnInner(v, refs);
        if (r === __zodFail) return __zodFail;
        var fn = refs[rfnIdx];
        if (typeof fn !== "function") return __zodFail;
        var out = fn(r);
        if (out && typeof out.then === "function") return __zodFail;
        return out ? r : __zodFail;
      };
    }
    case "obj": {
      var propKeys = [];
      var propFns = [];
      var propOptIn = [];
      var propOptOut = [];
      var propRefIdx = [];
      for (var pi = 0; pi < n.p.length; pi++) {
        var pNode = n.p[pi][1];
        var pFn = __zodCompile(pNode);
        if (pFn === null) return null;
        propKeys.push(n.p[pi][0]);
        propFns.push(pFn);
        propOptIn.push(__zodOptIn(pNode));
        propOptOut.push(__zodOptOut(pNode));
        propRefIdx.push(pNode.k === "ref" ? pNode.r : -1);
      }
      var keyCount = propKeys.length;
      var keySet = null;
      var caFn = null;
      var caNever = false;
      var caNode = n.ca;
      var caOptIn = false;
      var caOptOut = false;
      if (caNode !== undefined) {
        keySet = new Set(propKeys);
        if (caNode.k === "never") {
          caNever = true;
        } else {
          caFn = __zodCompile(caNode);
          if (caFn === null) return null;
          caOptIn = __zodOptIn(caNode) === true;
          caOptOut = __zodOptOut(caNode) === true;
        }
      }
      return (v, refs) => {
        if (!__zodIsObject(v)) return __zodFail;
        var out = {};
        for (var i = 0; i < keyCount; i++) {
          var key = propKeys[i];
          var r = propFns[i](v[key], refs);
          var oin = propOptIn[i];
          var oout = propOptOut[i];
          if (oin === null || oout === null) {
            var child = propRefIdx[i] >= 0 ? refs[propRefIdx[i]] : undefined;
            oin = __zodRefOpt(child, false);
            oout = __zodRefOpt(child, true);
          }
          if (r === __zodFail) {
            if (oin && oout && !(key in v)) continue;
            return __zodFail;
          }
          if (!oin && !(key in v)) return __zodFail;
          if (r === undefined) {
            if (key in v) out[key] = undefined;
          } else {
            out[key] = r;
          }
        }
        if (keySet !== null) {
          for (var uk in v) {
            if (uk === "__proto__") continue;
            if (keySet.has(uk)) continue;
            if (caNever) return __zodFail;
            var cr = caFn(v[uk], refs);
            if (cr === __zodFail) {
              if (caOptIn && caOptOut && !(uk in v)) continue;
              return __zodFail;
            }
            if (cr === undefined) {
              if (uk in v) out[uk] = undefined;
            } else {
              out[uk] = cr;
            }
          }
        }
        return out;
      };
    }
    case "arr": {
      var arrEl = __zodCompile(n.i);
      if (arrEl === null) return null;
      var arrChecks = __zodCompileChecks("arr", n.c);
      if (n.c && n.c.length !== 0 && arrChecks === null) return null;
      return (v, refs) => {
        if (!Array.isArray(v)) return __zodFail;
        if (arrChecks !== null && arrChecks(v, refs) === __zodFail) return __zodFail;
        var len = v.length;
        var out = new Array(len);
        for (var i = 0; i < len; i++) {
          var r = arrEl(v[i], refs);
          if (r === __zodFail) return __zodFail;
          out[i] = r;
        }
        return out;
      };
    }
    case "tup": {
      var tupFns = [];
      for (var ti = 0; ti < n.it.length; ti++) {
        var tNode = n.it[ti];
        // Optional tuple tails have truncation semantics the fast path does not model; defer those tuples.
        if (__zodOptIn(tNode) !== false || __zodOptOut(tNode) !== false) return null;
        var tFn = __zodCompile(tNode);
        if (tFn === null) return null;
        tupFns.push(tFn);
      }
      var tupLen = tupFns.length;
      var restFn = null;
      if (n.rest !== undefined) {
        restFn = __zodCompile(n.rest);
        if (restFn === null) return null;
      }
      return (v, refs) => {
        if (!Array.isArray(v)) return __zodFail;
        if (v.length < tupLen) return __zodFail;
        if (restFn === null && v.length > tupLen) return __zodFail;
        var out = new Array(v.length);
        for (var i = 0; i < tupLen; i++) {
          var r = tupFns[i](v[i], refs);
          if (r === __zodFail) return __zodFail;
          out[i] = r;
        }
        if (restFn !== null) {
          for (var j = tupLen; j < v.length; j++) {
            var rr = restFn(v[j], refs);
            if (rr === __zodFail) return __zodFail;
            out[j] = rr;
          }
        }
        return out;
      };
    }
    case "rec": {
      var recVal = __zodCompile(n.v);
      if (recVal === null) return null;
      return (v, refs) => {
        if (!__zodIsPlainObject(v)) return __zodFail;
        var keys = Reflect.ownKeys(v);
        var out = {};
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          // Symbol keys fail string key schemas in zod; delegate.
          if (typeof key !== "string") return __zodFail;
          if (key === "__proto__") continue;
          if (!Object.prototype.propertyIsEnumerable.call(v, key)) continue;
          var r = recVal(v[key], refs);
          if (r === __zodFail) return __zodFail;
          out[key] = r;
        }
        return out;
      };
    }
    case "uni": {
      var uniFns = [];
      var uniConc = [];
      for (var ui = 0; ui < n.o.length; ui++) {
        var uFn = __zodCompile(n.o[ui]);
        if (uFn === null) return null;
        uniFns.push(uFn);
        uniConc.push(__zodConclusive(n.o[ui]));
      }
      var uniLen = uniFns.length;
      return (v, refs) => {
        for (var i = 0; i < uniLen; i++) {
          var r = uniFns[i](v, refs);
          if (r !== __zodFail) return r;
          // An inconclusive failure cannot rule out zod accepting this option, and zod returns the first success in order; delegate.
          if (!uniConc[i]) return __zodFail;
        }
        return __zodFail;
      };
    }
    case "dun": {
      var dunDisc = n.d;
      var dunMap = new Map();
      for (var di = 0; di < n.o.length; di++) {
        var option = n.o[di];
        var dFn = __zodCompile(option);
        if (dFn === null) return null;
        var values = __zodDiscValues(option, dunDisc);
        if (values === null) return null;
        for (var vi = 0; vi < values.length; vi++) {
          // Duplicate discriminator values throw in zod; defer to it.
          if (dunMap.has(values[vi])) return null;
          dunMap.set(values[vi], dFn);
        }
      }
      return (v, refs) => {
        if (!__zodIsObject(v)) return __zodFail;
        var dFn2 = dunMap.get(v[dunDisc]);
        if (dFn2 === undefined) return __zodFail;
        return dFn2(v, refs);
      };
    }
    case "ref": {
      var refIdx = n.r;
      return (v, refs) => __zodRunRef(refs[refIdx], v);
    }
    case "opq":
      return () => __zodFail;
    default:
      return null;
  }
}

// Statically-known discriminator values for one dun option.
function __zodDiscValues(option, disc) {
  if (option.k === "rfn") return __zodDiscValues(option.i, disc);
  if (option.k !== "obj") return null;
  for (var i = 0; i < option.p.length; i++) {
    if (option.p[i][0] === disc) {
      var node = option.p[i][1];
      if (node.k === "lit" && node.rs === undefined) {
        var vals = node.vs.slice();
        if (node.u === 1) vals.push(undefined);
        return vals;
      }
      if (node.k === "enum" && node.vs !== undefined) return node.vs.slice();
      return null;
    }
  }
  return null;
}
