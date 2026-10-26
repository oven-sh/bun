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

// Converts the module from CommonJS to ESM. "default" is "module.exports",
// except outside node mode when "__esModule" is truthy and the module has its
// own "default" property. `bun run` uses the same rule.
export var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? (__toESMCache_node ??= new WeakMap()) : (__toESMCache_esm ??= new WeakMap());
    var cached = cache.get(mod);
    if (cached) return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to =
    isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default")
      ? __defProp(target, "default", { value: mod, enumerable: true })
      : target;

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
// (`deprecatedNamespaceObjectSetters`; `__exportGetters` replaces this in 1.5)
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

export var __exportGetters = /* @__PURE__ */ (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
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

// A module whose evaluation threw throws the same error on every later import.
export var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn((fn = 0));
    } catch (e) {
      err = [e];
    }
  if (err) throw err[0];
  return res;
};

// This is used for JSX inlining with React.
export var $$typeof = /* @__PURE__ */ Symbol.for("react.element");

export var __jsonParse = /* @__PURE__ */ a => JSON.parse(a);

export var __promiseAll = args => Promise.all(args);

// React Compiler memo-cache slot sentinels.
export var __MEMO_CACHE_SENTINEL = /* @__PURE__ */ Symbol.for("react.memo_cache_sentinel");
export var __EARLY_RETURN_SENTINEL = /* @__PURE__ */ Symbol.for("react.early_return_sentinel");

// The namespace of a CommonJS module whose `exports.x = ...` were lifted to
// bindings stands in for `module.exports`: a write through it assigns the
// binding, so every importer sees it.
export var __exportCjs = /* @__PURE__ */ (target, getters, setters) => {
  for (var name in getters)
    __defProp(target, name, {
      get: getters[name],
      set: setters[name],
      enumerable: true,
      configurable: true,
    });
};

// TC39 structs (https://github.com/tc39/proposal-structs), unshared and shared.
//
// The parser lowers `struct S extends P { ... }` to a class that is only a shell around the calls below
// (`lower_struct_class` in src/js_parser/parse/mod.rs):
//
//   h(P, shared)         the `extends` clause: checks that `P` is a struct of the same kind and returns it
//   t(kind, key, init)   the key of a method that stands for a field initializer or the constructor
//   d(S, shared, noProto)  the first static element: collects those methods and sets `S` up
//   z(S)                 the last static element: seals `S.prototype` once the static elements ran
//   b(newTarget, entry)  the start of the class constructor, e(...) its end
//   r()                  the struct whose constructor is running: the first statement of that constructor keeps it
//   s(this, struct)      the target of `super(...)` inside a struct constructor
//
// `new S(...)` therefore runs the class constructors of the whole chain, which only allocate the instance and
// add its private names, and `e` then does what the proposal's [[Construct]] does: defines every declared field
// as `undefined`, seals the instance, runs the field initializers of the chain (parent first), then the
// constructor of `S` itself with `this` bound. A parent's constructor runs only when that one calls `super()`.
export var __structBase = /* @__PURE__ */ (() => {
  // struct constructor -> { shared, records, initializer, parent, brands, chain }
  var infos = new WeakMap();
  // unshared instance -> the brands of its struct and of every struct it extends, which struct methods check
  var brandsOf = new WeakMap();
  // every shared struct instance, native or emulated
  var sharedObjects = new WeakSet();
  var emulatedObjects = new WeakSet();
  // key of a method standing for a field initializer or a constructor -> what it stands for
  var tags = new WeakMap();
  // the struct whose chain of class constructors is running, so a parent's constructor can tell it was
  // reached through `super()` of the `new` that started it
  var active;
  // the struct whose constructor is running (the target of `super(...)` is its parent's)
  var running;
  // `{ create(names) }` from src/js/internal/structs.ts: the native shared structs
  var native;

  // The parent of a struct whose `extends` expression is null but is not the literal `null`.
  var NullBase = function () {};
  NullBase.prototype = null;

  var keyOf = key => Reflect.ownKeys({ [key]: 0 })[0];

  var isShareable = value =>
    value !== null && typeof value === "object" ? sharedObjects.has(value) : typeof value !== "function";

  var brandedMethod = (target, brand) => {
    // A struct method exotic object: callable, not a constructor, without an own `length`.
    var wrapper = {
      method(...args) {
        var brands = brandsOf.get(this);
        if (brands === undefined || !brands.has(brand))
          throw new TypeError("Method called on an incompatible receiver; struct methods are not generic");
        return Reflect.apply(target, this, args);
      },
    }.method;
    delete wrapper.length;
    Reflect.defineProperty(wrapper, "name", { value: target.name });
    return wrapper;
  };

  // Only plain methods are non-generic; accessors, generators and async methods are not wrapped.
  // A plain method has the Function.prototype of its realm as its prototype and no `prototype` property of its own; a generator,
  // an async function and an async generator have another prototype (and a generator has `prototype`).
  var brandMethods = (proto, brand, functionPrototype) => {
    for (var key of Reflect.ownKeys(proto)) {
      var desc = Reflect.getOwnPropertyDescriptor(proto, key);
      var method = desc.value;
      if (
        typeof method !== "function" ||
        Reflect.getPrototypeOf(method) !== functionPrototype ||
        Reflect.getOwnPropertyDescriptor(method, "prototype") !== undefined
      )
        continue;
      desc.value = brandedMethod(method, brand);
      Reflect.defineProperty(proto, key, desc);
    }
  };

  var heritage = (parent, shared) => {
    if (parent === null) return NullBase;
    var info = typeof parent === "function" ? infos.get(parent) : undefined;
    if (info === undefined || info.shared !== shared)
      throw new TypeError(
        shared
          ? "A shared struct can only extend a shared struct or null"
          : "A struct can only extend a struct or null",
      );
    return parent;
  };

  var tag = (kind, key, hasInitializer) => {
    var symbol = Symbol();
    tags.set(symbol, { kind, key: kind === 0 ? keyOf(key) : undefined, hasInitializer });
    return symbol;
  };

  var setup = (struct, shared, nullPrototype) => {
    var proto = struct.prototype;
    var parent = infos.get(Reflect.getPrototypeOf(struct));
    var records = [];
    var initializer;
    for (var symbol of Object.getOwnPropertySymbols(proto)) {
      var stands = tags.get(symbol);
      if (stands === undefined) continue;
      tags.delete(symbol);
      var method = proto[symbol];
      delete proto[symbol];
      if (stands.kind === 2) initializer = method;
      else if (stands.kind === 0)
        records.push({ field: true, key: stands.key, init: stands.hasInitializer ? method : undefined });
      else records.push({ field: false, key: undefined, init: method });
    }
    if (nullPrototype) Reflect.setPrototypeOf(proto, null);
    // The prototype of a struct has no `constructor` property (a method that a script gave that name by a computed key stays).
    var own = Reflect.getOwnPropertyDescriptor(proto, "constructor");
    if (own !== undefined && own.value === struct) Reflect.deleteProperty(proto, "constructor");
    var root = parent === undefined ? struct : parent.root;
    var brand = {};
    var brands = new Set(parent === undefined ? [] : parent.brands);
    brands.add(brand);
    if (!shared) {
      var functionPrototype = Reflect.getPrototypeOf(root);
      if (functionPrototype === NullBase) functionPrototype = Reflect.getPrototypeOf(NullBase);
      brandMethods(proto, brand, functionPrototype);
    }
    var info = {
      shared,
      records,
      initializer,
      parent,
      root,
      brands,
      chain: parent === undefined ? [] : parent.chain.slice(),
      names: undefined,
    };
    info.chain.push(info);
    infos.set(struct, info);
  };

  var seal = struct => {
    Object.seal(struct.prototype);
    if (infos.get(struct).shared) Object.seal(struct);
  };

  var begin = (newTarget, isEntry) => {
    if (isEntry) active = newTarget;
    else if (active !== newTarget)
      throw new TypeError("A struct cannot be subclassed or constructed through another constructor");
  };

  var defineEmulatedField = (self, name) => {
    var value;
    Reflect.defineProperty(self, name, {
      get: () => value,
      set: v => {
        if (!isShareable(v)) throw new TypeError("Shared struct fields can only hold primitives or shared structs");
        value = v;
      },
      enumerable: true,
      configurable: false,
    });
  };

  // No native shared structs (this code runs somewhere else than Bun): an object of this agent only, with the
  // same layout and null prototype.
  var emulatedShared = names => {
    var self = Object.create(null);
    sharedObjects.add(self);
    emulatedObjects.add(self);
    for (var name of names) defineEmulatedField(self, name);
    Reflect.preventExtensions(self);
    return self;
  };

  var createShared = info => {
    var names = info.names;
    if (names === undefined) {
      names = info.names = [];
      for (var level of info.chain)
        for (var record of level.records) if (record.field && !names.includes(record.key)) names.push(record.key);
    }
    // Reading `Reflect.canBeShared` installs the native structs, whose module hands the hook over through `n`.
    if (native === undefined && typeof Reflect.canBeShared === "function" && native === undefined) {
      // nothing else to do
    }
    if (native === undefined) return emulatedShared(names);
    var created = native.create(names);
    sharedObjects.add(created);
    return created;
  };

  var defineField = (self, key, value) => {
    if (emulatedObjects.has(self)) self[key] = value;
    else Object.defineProperty(self, key, { value, writable: true, enumerable: true, configurable: false });
  };

  var runInitializer = (info, self, args) => {
    var previous = running;
    running = info;
    try {
      return Reflect.apply(info.initializer, self, args);
    } finally {
      running = previous;
    }
  };

  var end = (self, newTarget, args, isEntry) => {
    var info = infos.get(newTarget);
    if (isEntry) active = undefined;
    // The class constructors allocate an ordinary object; a shared struct is made once, by the first of them.
    if (info.shared && !sharedObjects.has(self)) {
      try {
        self = createShared(info);
      } catch (error) {
        active = undefined;
        throw error;
      }
    }
    if (!isEntry) return self;
    if (!info.shared) {
      for (var level of info.chain)
        for (var record of level.records) if (record.field) defineField(self, record.key, undefined);
      Reflect.preventExtensions(self);
      brandsOf.set(self, info.brands);
    }
    for (var level of info.chain) {
      for (var record of level.records) {
        if (record.init === undefined) continue;
        if (record.field) defineField(self, record.key, Reflect.apply(record.init, self, []));
        else Reflect.apply(record.init, self, []);
      }
    }
    if (info.initializer !== undefined) runInitializer(info, self, args);
    return self;
  };

  // `super(...)` in the constructor of the struct that `info` describes (see `r`): it calls the constructor of the parent of that
  // struct, whenever it runs, with the `this` the constructor was running on.
  var superCall =
    (self, info) =>
    (...args) => {
      var parent = info === undefined ? undefined : info.parent;
      if (parent === undefined) throw new TypeError("Super constructor is not a constructor");
      return parent.initializer === undefined ? undefined : runInitializer(parent, self, args);
    };

  return {
    h: heritage,
    t: tag,
    d: setup,
    z: seal,
    b: begin,
    e: end,
    s: superCall,
    r: () => running,
    n: hooks => {
      if (native === undefined) native = hooks;
    },
  };
})();
