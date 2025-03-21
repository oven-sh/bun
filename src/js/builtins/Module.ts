$getter;
export function main() {
  return $requireMap.$get(Bun.main);
}

$visibility = "Private";
export function require(this: CommonJSModuleRecord, id: string) {
  // Do not use $tailCallForwardArguments here, it causes https://github.com/oven-sh/bun/issues/9225
  return $overridableRequire.$apply(this, arguments);
}

// overridableRequire can be overridden by setting `Module.prototype.require`
$overriddenName = "require";
$visibility = "Private";
export function overridableRequire(this: CommonJSModuleRecord, originalId: string) {
  const id = $resolveSync(originalId, this.filename, false);
  if (id.startsWith('node:')) {
    if (id !== originalId) {
      // A terrible special case where Node.js allows non-prefixed built-ins to
      // read the require cache. Though they never write to it, which is so silly.
      const existing = $requireMap.$get(originalId);
      if (existing) {
        if ($evaluateCommonJSModule(existing, this)) {
          if (this.children.indexOf(existing) === -1) {
            this.children.push(existing);
          }
        }
        return existing.exports;
      }
    }
    
    return this.$requireNativeModule(id);
  } else {
    const existing = $requireMap.$get(id);
    if (existing) {
      // Scenario where this is necessary:
      //
      // In an ES Module, we have:
      //
      //    import "react-dom/server"
      //    import "react"
      //
      // Synchronously, the "react" import is created first, and then the
      // "react-dom/server" import is created. Then, at ES Module link time, they
      // are evaluated. The "react-dom/server" import is evaluated first, and
      // require("react") was previously created as an ESM module, so we wait
      // for the ESM module to load
      //
      // ...and then when this code is reached, unless
      // we evaluate it "early", we'll get an empty object instead of the module
      // exports.
      //
      if ($evaluateCommonJSModule(existing, this)) {
        if (this.children.indexOf(existing) === -1) {
          this.children.push(existing);
        }
      }
      return existing.exports;
    }
  }

  if (id.endsWith(".node")) {
    return $internalRequire(id);
  }

  if (id === "bun:test") {
    return Bun.jest(this.filename);
  }

  // To handle import/export cycles, we need to create a module object and put
  // it into the map before we import it.
  const mod = $createCommonJSModule(id, {}, false, this);
  $requireMap.$set(id, mod);

  // This is where we load the module. We will see if Module._load and
  // Module._compile are actually important for compatibility.
  //
  // Note: we do not need to wrap this in a try/catch for release, if it throws
  // the C++ code will clear the module from the map.
  //
  if (IS_BUN_DEVELOPMENT) {
    $assert(mod.id === id);
    try {
      var out = this.$require(
        id,
        mod,
        // did they pass a { type } object?
        $argumentCount(),
        // the object containing a "type" attribute, if they passed one
        // maybe this will be "paths" in the future too.
        $argument(1),
      );
    } catch (E) {
      $assert($requireMap.$get(id) === undefined, "Module " + JSON.stringify(id) + " should no longer be in the map");
      throw E;
    }
  } else {
    var out = this.$require(
      id,
      mod,
      $argumentCount(),
      $argument(1),
    );
  }

  // -1 means we need to lookup the module from the ESM registry.
  if (out === -1) {
    try {
      out = $requireESM(id);
    } catch (exception) {
      // Since the ESM code is mostly JS, we need to handle exceptions here.
      $requireMap.$delete(id);
      throw exception;
    }

    const esm = Loader.registry.$get(id);

    // If we can pull out a ModuleNamespaceObject, let's do it.
    if (esm?.evaluated && (esm.state ?? 0) >= $ModuleReady) {
      const namespace = Loader.getModuleNamespaceObject(esm!.module);
      // In Bun, when __esModule is not defined, it's a CustomAccessor on the prototype.
      // Various libraries expect __esModule to be set when using ESM from require().
      // We don't want to always inject the __esModule export into every module,
      // And creating an Object wrapper causes the actual exports to not be own properties.
      // So instead of either of those, we make it so that the __esModule property can be set at runtime.
      // It only supports "true" and undefined. Anything non-truthy is treated as undefined.
      // https://github.com/oven-sh/bun/issues/14411
      if (namespace.__esModule === undefined) {
        try {
          namespace.__esModule = true;
        } catch {
          // https://github.com/oven-sh/bun/issues/17816
        }
      }

      return (mod.exports = namespace["module.exports"] ?? namespace);
    }
  }

  if ($evaluateCommonJSModule(mod, this)) {
    if (this.children.indexOf(mod) === -1) {
      this.children.push(mod);
    }
  }
  return mod.exports;
}

$visibility = "Private";
export function requireResolve(this: string | { filename?: string; id?: string }, id: string) {
  return $resolveSync(id, typeof this === "string" ? this : this?.filename ?? this?.id ?? "", false, true);
}

type WrapperMutate = (start: string, end: string) => void;
export function getWrapperArrayProxy(onMutate: WrapperMutate) {
  const wrapper = ["(function(exports,require,module,__filename,__dirname){", "})"];
  return new Proxy(wrapper, {
    set(target, prop, value, receiver) {
      Reflect.set(target, prop, value, receiver);
      onMutate(wrapper[0], wrapper[1]);
      return true;
    },
    defineProperty(target, prop, descriptor) {
      Reflect.defineProperty(target, prop, descriptor);
      onMutate(wrapper[0], wrapper[1]);
      return true;
    },
    deleteProperty(target, prop) {
      Reflect.deleteProperty(target, prop);
      onMutate(wrapper[0], wrapper[1]);
      return true;
    },
  });
}
