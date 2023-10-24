// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/Module.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(id) {  const existing = __intrinsic__requireMap.__intrinsic__get(id) || __intrinsic__requireMap.__intrinsic__get((id = __intrinsic__resolveSync(id, this.path, false)));
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
    __intrinsic__evaluateCommonJSModule(existing);
    return existing.exports;
  }

  if (id.endsWith(".node")) {
    return __intrinsic__internalRequire(id);
  }

  // To handle import/export cycles, we need to create a module object and put
  // it into the map before we import it.
  const mod = __intrinsic__createCommonJSModule(id, {}, false, this);
  __intrinsic__requireMap.__intrinsic__set(id, mod);

  // This is where we load the module. We will see if Module._load and
  // Module._compile are actually important for compatibility.
  //
  // Note: we do not need to wrap this in a try/catch, if it throws the C++ code will
  // clear the module from the map.
  //
  var out = this.__intrinsic__require(id, mod);

  // -1 means we need to lookup the module from the ESM registry.
  if (out === -1) {
    try {
      out = __intrinsic__requireESM(id);
    } catch (exception) {
      // Since the ESM code is mostly JS, we need to handle exceptions here.
      __intrinsic__requireMap.__intrinsic__delete(id);
      throw exception;
    }

    const esm = Loader.registry.__intrinsic__get(id);

    // If we can pull out a ModuleNamespaceObject, let's do it.
    if (esm?.evaluated && (esm.state ?? 0) >= __intrinsic__ModuleReady) {
      const namespace = Loader.getModuleNamespaceObject(esm!.module);
      return (mod.exports =
        // if they choose a module
        namespace.__esModule ? namespace : Object.create(namespace, { __esModule: { value: true } }));
    }
  }

  __intrinsic__evaluateCommonJSModule(mod);
  return mod.exports;
}).$$capture_end$$;
