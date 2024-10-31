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
export function overridableRequire(this: CommonJSModuleRecord, id: string) {
  const existing = $requireMap.$get(id) || $requireMap.$get((id = $resolveSync(id, this.id, false)));
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
    $evaluateCommonJSModule(existing);
    return existing.exports;
  }

  if (id.endsWith(".node")) {
    return $internalRequire(id);
  }

  // To handle import/export cycles, we need to create a module object and put
  // it into the map before we import it.
  const mod = $createCommonJSModule(id, {}, false, this);
  $requireMap.$set(id, mod);

  // This is where we load the module. We will see if Module._load and
  // Module._compile are actually important for compatibility.
  //
  // Note: we do not need to wrap this in a try/catch, if it throws the C++ code will
  // clear the module from the map.
  //
  var out = this.$require(
    id,
    mod,
    // did they pass a { type } object?
    $argumentCount(),
    // the object containing a "type" attribute, if they passed one
    // maybe this will be "paths" in the future too.
    arguments[1],
  );

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
        namespace.__esModule = true;
      }

      return (mod.exports = namespace);
    }
  }

  $evaluateCommonJSModule(mod);
  return mod.exports;
}

$visibility = "Private";
export function requireResolve(this: string | { id: string }, id: string) {
  return $resolveSync(id, typeof this === "string" ? this : this?.id, false);
}

$visibility = "Private";
export function requireNativeModule(id: string) {
  let esm = Loader.registry.$get(id);
  if (esm?.evaluated && (esm.state ?? 0) >= $ModuleReady) {
    const exports = Loader.getModuleNamespaceObject(esm.module);
    return exports.default;
  }
  return $requireESM(id).default;
}
