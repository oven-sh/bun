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

// `__esm` for a module that reaches a top-level await. It runs when the specification says: see
// InnerModuleEvaluation, AsyncModuleExecutionFulfilled and GatherAvailableAncestors in ECMA-262.
var __esmEvaluator = /* @__PURE__ */ (() => {
  // status: 0 new, 1 evaluating, 2 evaluating-async, 3 evaluated. order: undefined unset, -1 done.
  var stack = [],
    index = 0,
    order = 0,
    importer;

  var executeAsync = module => {
    module.executing = 1;
    var promise = module.body();
    module.executing = 0;
    promise.then(
      () => {
        if (module.status == 3) return;
        module.order = -1;
        module.status = 3;
        var ready = [];
        gather(module, ready);
        execute(
          ready.sort((a, b) => a.order - b.order),
          0,
        );
      },
      error => reject(module, error),
    );
  };

  // `gathered`: a parent can register later, while the module waits for its turn in `execute`.
  var gather = (module, ready) => {
    while (module.gathered < module.parents.length) {
      var parent = module.parents[module.gathered++];
      if (parent.ready != ready && !parent.root.error && !--parent.pending) {
        parent.ready = ready;
        ready.push(parent);
        if (!parent.hasTLA) gather(parent, ready);
      }
    }
  };

  var execute = (ready, i) => {
    for (; i < ready.length; i++) {
      var module = ready[i];
      if (module.status == 3) continue;
      if (module.resolve) {
        // The code that waits continues in a job of its own, and the rest comes after it.
        module.status = 3;
        module.resolve();
        Promise.resolve().then(() => execute(ready, i + 1));
        return;
      }
      if (module.hasTLA) executeAsync(module);
      else
        try {
          module.body();
          module.order = -1;
          module.status = 3;
          gather(module, ready);
        } catch (error) {
          reject(module, error);
        }
    }
  };

  var reject = (module, error) => {
    if (module.status == 3) return;
    module.error = [error];
    module.order = -1;
    module.status = 3;
    for (var parent of module.parents) reject(parent, error);
    if (module.reject) module.reject(error);
  };

  var evaluateInner = module => {
    var parent = importer;
    module.status = 1;
    module.index = module.ancestor = index++;
    module.stack = stack;
    stack.push(module);
    importer = module;
    module.imports();
    importer = parent;
    if (module.pending || module.hasTLA) {
      module.order = order++;
      if (!module.pending) executeAsync(module);
    } else module.body();
    if (module.ancestor == module.index)
      do {
        var member = stack.pop();
        member.status = member.order === undefined ? 3 : 2;
        member.root = module;
      } while (member != module);
  };

  var evaluate = (module, parent) => {
    if (!module.status) {
      if (stack.length) evaluateInner(module);
      else
        try {
          evaluateInner(module);
        } catch (error) {
          for (var failed of stack) {
            failed.status = 3;
            failed.error = [error];
            failed.root = failed;
          }
          stack = [];
          importer = undefined;
          throw error;
        }
    }
    if (!parent) return;
    var required = module;
    if (module.status == 1) {
      // An `import()` in a body that is still running led here, and the module is above that body.
      if (module.stack != stack) return;
      parent.ancestor = Math.min(parent.ancestor, module.ancestor);
    } else if ((required = module.root).error) throw required.error[0];
    // The same, and the module is that body. It may be waiting for the `import()`.
    if (required.order >= 0 && !required.executing) {
      parent.pending++;
      required.parents.push(parent);
    }
  };

  return [
    (imports, body, hasTLA) => {
      var module = { imports, body, hasTLA, status: 0, pending: 0, parents: [], gathered: 0 };
      return (parent = importer) => evaluate(module, parent);
    },
    (...wrappers) => {
      var waiter = { hasTLA: 1, status: 2, pending: 0, parents: [] };
      waiter.root = waiter;
      var outerStack = stack,
        outerImporter = importer;
      stack = [];
      importer = undefined;
      try {
        for (var wrapper of wrappers) wrapper(waiter);
      } catch (error) {
        // The modules that have started have it as a parent.
        waiter.status = 3;
        waiter.error = [error];
        throw error;
      } finally {
        stack = outerStack;
        importer = outerImporter;
      }
      if (waiter.pending) {
        waiter.order = order++;
        return new Promise((resolve, reject) => {
          waiter.resolve = resolve;
          waiter.reject = reject;
        });
      }
    },
  ];
})();

// `var init_x = __esmAsync(() => { imports }, () => { body }, hasTLA)`. `init_x()` starts the module.
export var __esmAsync = /* @__PURE__ */ (() => __esmEvaluator[0])();

// For code outside of a wrapper: `await __esmWait(init_x, init_y)` starts the modules and waits for them.
export var __esmWait = /* @__PURE__ */ (() => __esmEvaluator[1])();

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
