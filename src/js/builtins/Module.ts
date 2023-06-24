interface Module {
  id: string;
  path: string;

  $require(id: string): any;
  children: Module[];
}

$getter;
export function main() {
  return $requireMap.$get(Bun.main);
}

export function require(this: Module, id: string) {
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
    // are evaluated. The "react-dom/server" import is evaluated first, and it
    // require() react React was previously created as an ESM module, so we wait
    // for the ESM module to load ...and then when this code is reached, unless
    // we evaluate it "early", we'll get an empty object instead of the module
    // exports.
    $evaluateCommonJSModule(existing);
    return existing.exports;
  }

  if (id.endsWith(".json") || id.endsWith(".toml") || id.endsWith(".node")) {
    return $internalRequire(id);
  }

  let esm = Loader.registry.$get(id);
  if (esm?.evaluated) {
    const mod = esm.module;
    const namespace = Loader.getModuleNamespaceObject(mod);
    const exports =
      namespace?.[$commonJSSymbol] === 0 || namespace?.default?.[$commonJSSymbol] === 0 ? namespace.default : namespace;
    $requireMap.$set(id, $createCommonJSModule(id, exports, true));
    return exports;
  }

  let out = this.$require(id);

  // -1 means we need to lookup the module from the ESM registry.
  if (out === -1) {
    // To handle import/export cycles, we need to create a module object and put
    // it into the map before we import it.
    const mod = $createCommonJSModule(id, {}, false);
    $requireMap.$set(id, mod);

    try {
      out = $requireESM(id);
    } catch (exception) {
      // If the ESM module failed to load, we need to remove the module from the
      // CommonJS map as well. That way, if there's a syntax error, we don't
      // prevent you from reloading the module once you fix the syntax error.
      $requireMap.$delete(id);
      throw exception;
    }

    esm = Loader.registry.$get(id);

    // If we can pull out a ModuleNamespaceObject, let's do it.
    if (esm?.evaluated) {
      const namespace = Loader.getModuleNamespaceObject(esm!.module);
      return (mod.exports =
        // if they choose a module
        namespace?.[$commonJSSymbol] === 0 || namespace?.default?.[$commonJSSymbol] === 0
          ? namespace.default
          : namespace);
    }
  }

  const existing2 = $requireMap.$get(id);
  if (existing2) {
    $evaluateCommonJSModule(existing2);
    return existing2.exports;
  }

  return out;
}

export function requireResolve(this: Module, id: string) {
  return $resolveSync(id, this.path, false);
}
