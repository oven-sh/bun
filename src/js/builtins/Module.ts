interface CommonJSModuleRecord {
  $require(id: string, mod: any): any;
  children: CommonJSModuleRecord[];
  exports: any;
  id: string;
  loaded: boolean;
  parent: undefined;
  path: string;
  paths: string[];
  require: typeof require;
}

$getter;
export function main() {
  return $requireMap.$get(Bun.main);
}

export function require(this: CommonJSModuleRecord, id: string) {
  const existing = $requireMap.$get(id) || $requireMap.$get((id = $resolveSync(id, this.path, false)));
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

  if (id.endsWith(".json") || id.endsWith(".toml") || id.endsWith(".node")) {
    return $internalRequire(id);
  }

  // To handle import/export cycles, we need to create a module object and put
  // it into the map before we import it.
  const mod = $createCommonJSModule(id, {}, false);
  $requireMap.$set(id, mod);

  // This is where we load the module. We will see if Module._load and
  // Module._compile are actually important for compatibility.
  //
  // Note: we do not need to wrap this in a try/catch, if it throws the C++ code will
  // clear the module from the map.
  //
  var out = this.$require(id, mod);

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
      return (mod.exports =
        // if they choose a module
        namespace.__esModule ? namespace : Object.create(namespace, { __esModule: { value: true } }));
    }
  }

  $evaluateCommonJSModule(mod);
  return mod.exports;
}

export function requireResolve(this: string | { path: string }, id: string) {
  // This try catch is needed because err.code on ESM resolves is ERR_MODULE_NOT_FOUND
  // while in require.resolve this error code is only MODULE_NOT_FOUND.
  // `local-pkg` will check for .code's exact value, and log extra messages if we don't match it.
  try {
    return $resolveSync(id, typeof this === "string" ? this : this?.path, false);
  } catch (error) {
    var e = new Error(`Cannot find module '${id}'`);
    e.code = "MODULE_NOT_FOUND";
    // e.requireStack = []; // TODO: we might have to implement this
    throw e;
  }
}

export function requireNativeModule(id: string) {
  // There might be a race condition here?
  let esm = Loader.registry.$get(id);
  if (esm?.evaluated && (esm.state ?? 0) >= $ModuleReady) {
    const exports = Loader.getModuleNamespaceObject(esm.module);
    return exports.default;
  }
  return $requireESM(id).default;
}
