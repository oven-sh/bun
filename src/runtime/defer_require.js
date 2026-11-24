// See src/js_parser/lower/defer_requires.rs. A `let` of a script is no property of the global object.
let $Bun_defer, $Bun_lazy;
(function (
  isLoadingChanged,
  isCaught,
  isLoading,
  isOfKnownPackage,
  textsOfCallees,
  makeLazy,
  isLazy,
  isPlain,
  makeAllLazy,
  setWantsWhole,
) {
  "use strict";
  const Module = process.getBuiltinModule("node:module");
  const { prototype, _cache: cache } = Module;
  const { require: ownRequire } = prototype;
  const { defineProperty, getOwnPropertyDescriptor, hasOwn, isExtensible } = Object;
  // Packages replace the members of these.
  const patched = /^(?:node:)?(?:fs|module|path|process)$/;
  // What these do while they load matters to code that does not require them.
  const patches =
    /^(?:@colors\/colors|colors|core-js|dotenv|graceful-fs|reflect-metadata|regenerator-runtime|should|sugar)(?:\/|$)|install|patch|polyfill|register|setup|shim|\/auto$/i;
  let lastRequire, wouldBeCaught;

  // By directory of a package, whether all is installed that it leaves to others to install, or else all of that which it
  // cannot do without.
  const installed = new Map();
  function hasPeers(root, withOptional) {
    const key = withOptional + root;
    let answer = installed.get(key);
    if (answer !== undefined) return answer;
    const { existsSync, readFileSync } = process.getBuiltinModule("node:fs");
    const manifest = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
    const { optionalDependencies, peerDependencies, peerDependenciesMeta } = manifest;
    const directories = Module._nodeModulePaths(root);
    answer = Object.keys({ ...optionalDependencies, ...peerDependencies, ...peerDependenciesMeta }).every(name => {
      const isOptional = peerDependencies?.[name] === undefined || peerDependenciesMeta?.[name]?.optional;
      // ESLint imports `jiti` for a configuration in TypeScript.
      if (isOptional && (!withOptional || name === "jiti")) return true;
      return directories.some(it => existsSync(`${it}/${name}/package.json`));
    });
    installed.set(key, answer);
    return answer;
  }

  // Who catches what `require` throws wants to know whether a package is installed. What a package starts with can be
  // loaded without what is optional.
  function canBeLoaded(specifier, file) {
    const root = /^.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+/.exec(file)?.[0];
    if (root === undefined) return Module.isBuiltin(file);
    return hasPeers(root, !/^(?:@[^/]+\/)?[^./][^/]*$/.test(specifier));
  }

  // What to require later. `undefined`: it cannot wait.
  function resolved(require, specifier, isMember) {
    if ((isMember && patched.test(specifier)) || patches.test(specifier)) return undefined;
    try {
      const file = require.resolve(specifier);
      return file in cache || (wouldBeCaught && !canBeLoaded(specifier, file)) ? undefined : file;
    } catch {
      // To require it says why.
      return undefined;
    }
  }

  // In the order in which they would have been loaded. `null`: nothing waits any more.
  let deferred = new Set();
  let loaded = 0;
  const lazy = new WeakMap();
  const refusal = Symbol();
  let refuses = false;
  // To leave a function by an exception leaves nothing half done if it only loads, remembers by `??=`, and reads one property last.
  const loads = /\([\w$]+\?\.\(\)\)|\brequire\("[^"\\]*"\)/g;
  const onlyRemembers = /^[^(]*\(\)(?!.*(?:[(`]|\+\+|--|\b(?:delete|new)\b|[.[].*[.[\0]))(?:[^=]|=>|\?\?=|\|\|=)*$/s;
  // @typescript-eslint/eslint-plugin, where `load` is `() => require("./rule")`
  const lazyRule = /^\(\) => \{\s*rule \?\?= load\(\)\.default;\s*return rule;\s*\}$/;
  const canBeLeft = text => lazyRule.test(text) || onlyRemembers.test(text.replace(loads, "\0"));
  function refuse() {
    if (!refuses) return;
    if (!isLoadingChanged() && !isCaught() && textsOfCallees($Bun_lazy.ifLoaded).every(canBeLeft)) throw refusal;
    refuses = false;
  }

  const made = new WeakSet();

  function resolvingBy(resolveFilename, require, file) {
    const now = Module._resolveFilename;
    if (now === resolveFilename) return require?.(file);
    Module._resolveFilename = resolveFilename;
    try {
      return require?.(file);
    } finally {
      if (Module._resolveFilename === resolveFilename) Module._resolveFilename = now;
    }
  }

  // By file. They are read as soon as the module is loaded, by whomever, before anything can change them.
  const membersOf = new Map();
  const { toString: sourceOf } = Function.prototype;
  const onlyReturns = /^[^(]*\(\)(?!.*(?:\+\+|--|\bnew\b))\s*(?:\{\s*return\s[^(.[=`;{}]+;?\s*\}|=>[^(.[=`;{}]+)$/s;
  const convertsNothing = /(?:\breturn\s|=>)(?:(?!\bin(?:stanceof)?\b)[\w$\s]|\|\||&&|\?\?)+[;\s}]*$/;
  function isThere(object, keys) {
    let left = keys.length;
    for (const key of keys) {
      left--;
      if (Object(object) !== object || isLazy(object, key)) return false;
      const found = getOwnPropertyDescriptor(object, key);
      if (found === undefined) return false;
      if (hasOwn(found, "value")) {
        object = found.value;
        continue;
      }
      const source = found.get === undefined ? "" : sourceOf.call(found.get);
      if (!onlyReturns.test(source)) return false;
      if (left === 0) return true;
      // To make the member calls it again.
      if (!convertsNothing.test(source)) return false;
      object = object[key];
    }
    return true;
  }
  function pickMembersOf(file, module) {
    const members = membersOf.get(file);
    if (members === undefined) return;
    membersOf.delete(file);
    for (const [keys, make] of members) {
      if (isThere(module, keys)) make();
    }
  }

  // Without `require`, `pick` makes the value of others like it. `member`: it picks one, and the keys that lead to it from the module.
  $Bun_defer = function (require, specifier, pick, member) {
    if (require !== undefined && require !== lastRequire) {
      lastRequire = require;
      wouldBeCaught = isCaught();
    }
    let value;
    let file;
    if (deferred === null || isLoadingChanged() || prototype.require !== ownRequire) {
      if (require !== undefined) value = require(specifier);
    } else if (require === undefined || (file = resolved(require, specifier, member !== undefined)) !== undefined) {
      const resolveFilename = Module._resolveFilename;
      let isMade = false;
      let isBeingMade = false;
      const make = () => {
        if (isMade) return value;
        refuse();
        // In a cycle. What there is so far is not to be kept.
        if (file !== undefined && file in cache && isLoading(file)) return pick ? pick(require(file)) : require(file);
        if (isBeingMade) return undefined;
        isBeingMade = true;
        let module;
        try {
          module = resolvingBy(resolveFilename, require, file);
          value = pick === undefined ? module : pick(module);
        } finally {
          isBeingMade = false;
        }
        isMade = true;
        made.add(make);
        loaded++;
        pickMembersOf(file, module);
        return value;
      };
      if (typeof member === "object") {
        const members = membersOf.get(file);
        if (members === undefined) membersOf.set(file, [[member, make]]);
        else members.push([member, make]);
      }
      if (deferred.add(make).size === 1) $Bun_lazy.onFirst?.();
      return make;
    } else value = require(specifier);
    if (pick !== undefined) value = pick(value);
    return () => value;
  };

  // What `object` has at `keys` is from `$Bun_defer`.
  $Bun_lazy = function (object, ...keys) {
    for (const key of keys) {
      const make = object[key];
      if (deferred?.has(make) && makeLazy(object, key)) {
        let all = lazy.get(object);
        if (all === undefined) lazy.set(object, (all = new Map()));
        all.set(key, make);
      } else object[key] = make();
    }
    return object;
  };

  // `object[key] = make()`
  $Bun_lazy.set = function (object, key, make, isStrict) {
    const isNew = () => !(key in object) && isExtensible(object);
    if (isPlain(object) && (isNew() || getOwnPropertyDescriptor(object, key)?.writable)) {
      object[key] = make;
      $Bun_lazy(object, key);
    } else if (isStrict) object[key] = make();
    else Reflect.set(Object(object), key, make(), object);
  };

  // src/runtime/typescript_front.rs
  $Bun_lazy.front = function (require, file, names, known) {
    // src/lint/driver/evaluate-stand-ins.js leaves alone what it has seen loaded.
    require.resolve(file);
    let whole;
    function load() {
      if (whole !== undefined) return whole;
      refuse();
      const front = cache[file];
      delete cache[file];
      setWantsWhole(true);
      try {
        return (whole = require(file));
      } finally {
        setWantsWhole(false);
        if (front === undefined) delete cache[file];
        else cache[file] = front;
      }
    }
    const exports = {};
    for (const name of names.split(" ")) {
      let it;
      const get = hasOwn(known, name)
        ? () => (it ??= known[name]({}))
        : () => (it ??= getOwnPropertyDescriptor(load(), name).get)();
      defineProperty(exports, name, { get, enumerable: true });
    }
    makeAllLazy(exports);
    return exports;
  };

  // Something has failed, maybe for want of what loading a module does. Returns whether anything was left to load.
  $Bun_lazy.loadAll = function () {
    if (deferred === null) return false;
    const all = deferred;
    deferred = null;
    let count = loaded;
    for (const make of all) {
      try {
        make();
      } catch {
        count = -1;
      }
    }
    return count !== loaded;
  };

  const { __lookupGetter__: getterOf } = Object.prototype;
  // For Bun's own scripts, which go through all that is loaded: the property, or `otherwise` if to read it loads a module.
  $Bun_lazy.ifLoaded = (object, key, otherwise) => {
    if (isLazy(object, key)) return otherwise;
    const getter = getterOf.call(object, key);
    if (!isOfKnownPackage(getter) || !canBeLeft(sourceOf.call(getter))) return object[key];
    const resolveFilename = Module._resolveFilename;
    Module._resolveFilename = function () {
      const file = Reflect.apply(resolveFilename, this, arguments);
      if (!(file in cache) && !Module.isBuiltin(file)) refuse();
      return file;
    };
    refuses = true;
    try {
      return object[key];
    } catch (error) {
      if (error === refusal) return otherwise;
      throw error;
    } finally {
      refuses = false;
      Module._resolveFilename = resolveFilename;
    }
  };

  // The value, and whether it is for good
  function valueOfLazy(object, key) {
    const make = lazy.get(object).get(key);
    return [make(), made.has(make)];
  }

  return [valueOfLazy, $Bun_lazy.ifLoaded, (file, module) => pickMembersOf(file, module.exports)];
});
